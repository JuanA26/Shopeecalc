require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');

const db = require('./db');
const { parseShopeeIncomeFile } = require('./parseExcel');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

if (!process.env.SESSION_SECRET) {
  console.warn(
    '[PERINGATAN] SESSION_SECRET tidak diset di .env — memakai kunci acak sementara.\n' +
    'Ini artinya semua orang akan ter-logout setiap kali server di-restart.\n' +
    'Set SESSION_SECRET di file .env untuk produksi.'
  );
}

app.set('trust proxy', 1); // perlu kalau dideploy di belakang reverse proxy/https (Render, Fly.io, dll)

// Bikin akun-akun login otomatis dari environment variable, kalau di-set dan akunnya
// belum ada. Berguna waktu deploy ke hosting yang tidak kasih akses shell/terminal
// (jadi tidak perlu jalankan scripts/add-user.js secara manual di server).
// Aman dijalankan berkali-kali tiap start — hanya bikin akun yang BELUM ada, tidak
// pernah menimpa password akun yang sudah ada (supaya ganti password lewat web/CLI
// tidak keindus balik oleh env var lama setiap restart).
//
// Dua cara pakai (boleh salah satu, boleh dua-duanya):
//   ADMIN_USERNAME=aaron / ADMIN_PASSWORD=... untuk satu akun
//   ADMIN_ACCOUNTS="aaron:passwordA,ibu:passwordB" untuk beberapa akun sekaligus
(function bootstrapAdmin() {
  const daftarAkun = [];

  if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
    daftarAkun.push([process.env.ADMIN_USERNAME, process.env.ADMIN_PASSWORD]);
  }

  if (process.env.ADMIN_ACCOUNTS) {
    for (const pasangan of process.env.ADMIN_ACCOUNTS.split(',')) {
      const idx = pasangan.indexOf(':');
      if (idx === -1) continue;
      const username = pasangan.slice(0, idx).trim();
      const password = pasangan.slice(idx + 1).trim();
      if (username && password) daftarAkun.push([username, password]);
    }
  }

  for (const [username, password] of daftarAkun) {
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) continue;
    const hash = bcrypt.hashSync(password, 12);
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
    console.log(`[SETUP] Akun "${username}" dibuat otomatis dari environment variable.`);
  }
})();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    name: 'smc.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // 'auto' = aman untuk kedua kasus: menandai cookie "Secure" saat koneksi benar-benar
      // HTTPS (langsung atau lewat reverse proxy, berkat `trust proxy` di atas), tapi tidak
      // memblokir cookie saat masih dites lokal lewat http://localhost.
      secure: 'auto',
      maxAge: 1000 * 60 * 60 * 12, // 12 jam
    },
  })
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

// ---------- Auth middleware ----------
function requireLogin(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'Belum login.' });
}

// ---------- Rute Auth ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan password wajib diisi.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
  if (!user) {
    return res.status(401).json({ error: 'Username atau password salah.' });
  }

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'Username atau password salah.' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ ok: true, username: user.username });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('smc.sid');
    res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  if (req.session && req.session.userId) {
    return res.json({ loggedIn: true, username: req.session.username });
  }
  res.json({ loggedIn: false });
});

// ---------- Rute HPP (Harga Pokok Penjualan) ----------
app.get('/api/hpp', requireLogin, (req, res) => {
  const rows = db.prepare('SELECT * FROM product_hpp ORDER BY updated_at DESC').all();
  res.json(rows);
});

app.put('/api/hpp/:idProduk', requireLogin, (req, res) => {
  const idProduk = String(req.params.idProduk || '').trim();
  const { hpp, namaProduk } = req.body || {};

  if (!idProduk) return res.status(400).json({ error: 'ID Produk wajib diisi.' });
  const hppNum = Number(hpp);
  if (!Number.isFinite(hppNum) || hppNum < 0) {
    return res.status(400).json({ error: 'Nilai HPP harus berupa angka dan tidak boleh negatif.' });
  }

  db.prepare(
    `INSERT INTO product_hpp (id_produk, nama_produk, hpp, updated_at, updated_by)
     VALUES (?, ?, ?, datetime('now'), ?)
     ON CONFLICT(id_produk) DO UPDATE SET
       hpp = excluded.hpp,
       nama_produk = COALESCE(NULLIF(excluded.nama_produk, ''), product_hpp.nama_produk),
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`
  ).run(idProduk, namaProduk || '', hppNum, req.session.username);

  const row = db.prepare('SELECT * FROM product_hpp WHERE id_produk = ?').get(idProduk);
  res.json(row);
});

app.delete('/api/hpp/:idProduk', requireLogin, (req, res) => {
  const idProduk = String(req.params.idProduk || '').trim();
  db.prepare('DELETE FROM product_hpp WHERE id_produk = ?').run(idProduk);
  res.json({ ok: true });
});

// ---------- Rute koreksi manual "Jumlah" (pcs) per baris pesanan ----------
// Menimpa tebakan otomatis dari hitungJumlahPcsPerBaris() (lihat parseExcel.js)
// untuk satu baris tertentu. Kuncinya order_sn + id_produk + hargaProduk (bukan
// cuma order_sn + id_produk) karena satu pesanan bisa punya lebih dari satu baris
// Sku untuk produk yang SAMA — hargaProduk baris itulah yang membedakannya.
app.put('/api/jumlah/:orderSn/:idProduk/:hargaProduk', requireLogin, (req, res) => {
  const orderSn = String(req.params.orderSn || '').trim();
  const idProduk = String(req.params.idProduk || '').trim();
  const hargaProduk = Number(req.params.hargaProduk);
  const jumlahNum = Number(req.body && req.body.jumlah);

  if (!orderSn || !idProduk) return res.status(400).json({ error: 'No. Pesanan dan ID Produk wajib diisi.' });
  if (!Number.isInteger(jumlahNum) || jumlahNum < 1) {
    return res.status(400).json({ error: 'Jumlah harus berupa bilangan bulat, minimal 1.' });
  }

  db.prepare(
    `INSERT INTO order_item_jumlah (order_sn, id_produk, harga_produk, jumlah, updated_at, updated_by)
     VALUES (?, ?, ?, ?, datetime('now'), ?)
     ON CONFLICT(order_sn, id_produk, harga_produk) DO UPDATE SET
       jumlah = excluded.jumlah,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`
  ).run(orderSn, idProduk, hargaProduk, jumlahNum, req.session.username);

  res.json({ ok: true, orderSn, idProduk, hargaProduk, jumlah: jumlahNum });
});

// Hapus koreksi manual — baris ini kembali memakai tebakan otomatis lagi.
app.delete('/api/jumlah/:orderSn/:idProduk/:hargaProduk', requireLogin, (req, res) => {
  const orderSn = String(req.params.orderSn || '').trim();
  const idProduk = String(req.params.idProduk || '').trim();
  const hargaProduk = Number(req.params.hargaProduk);
  db.prepare(
    'DELETE FROM order_item_jumlah WHERE order_sn = ? AND id_produk = ? AND harga_produk = ?'
  ).run(orderSn, idProduk, hargaProduk);
  res.json({ ok: true });
});

// Bungkus satu nilai jadi field CSV yang aman (tanda kutip kalau perlu, sesuai
// format CSV standar) — dipakai saat mengekspor.
function csvField(nilai) {
  const teks = String(nilai ?? '');
  if (/[",\n\r]/.test(teks)) {
    return '"' + teks.replace(/"/g, '""') + '"';
  }
  return teks;
}

// Ekspor semua data HPP jadi file CSV — untuk cadangan/backup atau kalau perlu
// dipindah/diperiksa di luar aplikasi (mis. dibuka di Excel).
app.get('/api/hpp/export-csv', requireLogin, (req, res) => {
  const rows = db.prepare('SELECT * FROM product_hpp ORDER BY id_produk').all();

  const header = ['ID Produk', 'Nama Produk', 'Harga Modal (HPP)', 'Terakhir Diubah'];
  const baris = rows.map((r) =>
    [r.id_produk, r.nama_produk || '', r.hpp, r.updated_at].map(csvField).join(',')
  );
  const csv = '﻿' + [header.join(','), ...baris].join('\r\n') + '\r\n';

  const tanggal = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="harga-modal-shopee-${tanggal}.csv"`);
  res.send(csv);
});

// Baca satu baris CSV yang mungkin berisi field bertanda kutip (mendukung koma
// di dalam nama produk yang dibungkus tanda kutip, sesuai format CSV standar).
function parseCsvLine(line) {
  const hasil = [];
  let field = '';
  let dalamKutip = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (dalamKutip) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { dalamKutip = false; }
      else { field += c; }
    } else if (c === '"') {
      dalamKutip = true;
    } else if (c === ',') {
      hasil.push(field);
      field = '';
    } else {
      field += c;
    }
  }
  hasil.push(field);
  return hasil;
}

// Impor massal dari file CSV dengan format yang sama dengan yang diunduh dari
// versi statis (kolom: ID Produk, Nama Produk, Harga Modal (HPP), ...).
// Berguna untuk memindahkan data HPP yang sudah ada ke versi server ini.
app.post('/api/hpp/import-csv', requireLogin, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Tidak ada file yang diunggah.' });
  }

  const teks = req.file.buffer.toString('utf8').replace(/^﻿/, '');
  const baris = teks.split(/\r\n|\r|\n/).filter((b) => b.trim() !== '');
  if (baris.length < 2) {
    return res.status(400).json({ error: 'File CSV kosong atau tidak punya baris data.' });
  }

  const header = parseCsvLine(baris[0]).map((h) => h.trim().toLowerCase());
  const idxId = header.findIndex((h) => h.includes('id produk'));
  const idxNama = header.findIndex((h) => h.includes('nama produk'));
  const idxHpp = header.findIndex((h) => h.includes('harga modal'));

  if (idxId === -1 || idxHpp === -1) {
    return res.status(400).json({
      error: 'Format CSV tidak dikenali. Pastikan ada kolom "ID Produk" dan "Harga Modal (HPP)".',
    });
  }

  const upsert = db.prepare(
    `INSERT INTO product_hpp (id_produk, nama_produk, hpp, updated_at, updated_by)
     VALUES (?, ?, ?, datetime('now'), ?)
     ON CONFLICT(id_produk) DO UPDATE SET
       hpp = excluded.hpp,
       nama_produk = COALESCE(NULLIF(excluded.nama_produk, ''), product_hpp.nama_produk),
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`
  );

  let ditambahkan = 0;
  let diperbarui = 0;
  let dilewati = 0;

  for (let i = 1; i < baris.length; i++) {
    const kolom = parseCsvLine(baris[i]);
    const idProduk = String(kolom[idxId] || '').trim();
    const namaProduk = idxNama !== -1 ? String(kolom[idxNama] || '').trim() : '';
    const hppNum = Number(kolom[idxHpp]);

    if (!idProduk || !Number.isFinite(hppNum) || hppNum < 0) {
      dilewati += 1;
      continue;
    }

    const sudahAda = db.prepare('SELECT 1 FROM product_hpp WHERE id_produk = ?').get(idProduk);
    upsert.run(idProduk, namaProduk, hppNum, req.session.username);
    if (sudahAda) diperbarui += 1; else ditambahkan += 1;
  }

  res.json({ ok: true, ditambahkan, diperbarui, dilewati });
});

// ---------- Rute Upload & Hitung Margin ----------
app.post('/api/upload', requireLogin, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Tidak ada file yang diunggah.' });
  }

  let items;
  try {
    items = parseShopeeIncomeFile(req.file.buffer);
  } catch (err) {
    console.error(err);
    const message = err.userFacing
      ? err.message
      : 'Gagal membaca file ini. Pastikan ini adalah file Excel "Income" asli yang diunduh dari Shopee.';
    return res.status(400).json({ error: message });
  }

  // Ambil semua HPP yang sudah tersimpan, lalu gabungkan ke tiap baris.
  const hppRows = db.prepare('SELECT id_produk, hpp FROM product_hpp').all();
  const hppMap = new Map(hppRows.map((r) => [r.id_produk, r.hpp]));

  // Ambil semua koreksi manual "Jumlah" (pcs) yang pernah disimpan, kunci per baris
  // (No. Pesanan + ID Produk + Harga Produk baris itu — lihat catatan skema di
  // db.js soal kenapa perlu 3 kolom) — kalau ada, ini menimpa tebakan otomatis
  // dari parseExcel.js untuk baris itu saja.
  const jumlahRows = db.prepare('SELECT order_sn, id_produk, harga_produk, jumlah FROM order_item_jumlah').all();
  const jumlahOverrideMap = new Map(
    jumlahRows.map((r) => [`${r.order_sn}|${r.id_produk}|${r.harga_produk}`, r.jumlah])
  );

  let totalPenghasilan = 0;
  let totalHpp = 0;
  let totalUntung = 0;
  let jumlahBelumAdaHpp = 0;
  let jumlahDikembalikan = 0;

  const hasil = items.map((item) => {
    const hpp = hppMap.has(item.idProduk) ? hppMap.get(item.idProduk) : null;
    const punyaHpp = hpp !== null;

    // Jumlah pcs baris ini: pakai koreksi manual kalau pernah disimpan untuk
    // pesanan+produk ini, kalau tidak pakai tebakan otomatis dari parseExcel.js.
    // jumlahOtomatis tetap disertakan di respons supaya UI bisa menunjukkan kalau
    // suatu baris sedang dikoreksi manual (beda dari tebakan aslinya).
    const jumlahOtomatis = item.jumlah;
    const overrideJumlah = jumlahOverrideMap.get(`${item.noPesanan}|${item.idProduk}|${item.hargaProduk}`);
    const jumlah = overrideJumlah !== undefined ? overrideJumlah : jumlahOtomatis;

    totalPenghasilan += item.totalPenghasilan;

    // Pesanan yang dikembalikan/di-refund: barangnya kembali ke penjual (proses retur
    // Shopee mengharuskan pembeli mengirim balik sebelum dana dikembalikan), jadi HPP-nya
    // TIDAK dianggap hilang — bukan untung, tapi juga bukan rugi. Baris ini sengaja tidak
    // dihitung ke Total Untung/HPP, dan tidak perlu diminta isi HPP juga.
    if (item.dikembalikan) {
      jumlahDikembalikan += 1;
      return { ...item, jumlah, jumlahOtomatis, hpp, untung: 0, marginPersen: null };
    }

    // HPP dikali jumlah pcs dulu sebelum dikurangkan — HPP yang disimpan selalu per 1 pcs.
    const hppTotal = hpp !== null ? hpp * jumlah : null;
    const untung = punyaHpp ? item.totalPenghasilan - hppTotal : null;
    const marginPersen =
      punyaHpp && item.totalPenghasilan !== 0 ? (untung / item.totalPenghasilan) * 100 : null;

    if (punyaHpp) {
      totalHpp += hppTotal;
      totalUntung += untung;
    } else {
      jumlahBelumAdaHpp += 1;
    }

    return {
      ...item,
      jumlah,
      jumlahOtomatis,
      hpp,
      hppTotal,
      untung,
      marginPersen,
    };
  });

  const ringkasan = {
    jumlahBaris: hasil.length,
    totalPenghasilan,
    totalHpp,
    totalUntung,
    marginRataRataPersen: totalPenghasilan !== 0 ? (totalUntung / totalPenghasilan) * 100 : null,
    jumlahBelumAdaHpp,
    jumlahDikembalikan,
  };

  res.json({ items: hasil, ringkasan });
});

app.listen(PORT, () => {
  console.log(`Shopee Margin Calc jalan di http://localhost:${PORT}`);
});
