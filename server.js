require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');

const db = require('./db');
const { parseCsvLine, parseShopeeAdsCsv, hitungAnalisisIklan, RASIO_PENCAIRAN_DEFAULT, TINGKAT_CAIR_DEFAULT } = require('./analisisIklan');
const shopeeApi = require('./shopeeApi');
const { sinkronkan, bacaItemPesanan, rasioPencairanToko, tingkatCairTerukur, modeEscrow } = require('./sinkronShopee');
const { sinkronIklan, kampanyeDariDb } = require('./sinkronIklan');

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

// Batas dinaikkan dari 100 kb bawaan: /api/iklan/hitung-ulang mengirim balik semua baris
// kampanye (ratusan baris × ~0,5 kb) supaya tidak perlu unggah ulang file.
app.use(express.json({ limit: '2mb' }));
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
  // fieldSize: field teks "produkIncome" (harga & penjualan harian per produk dari file
  // Income, dikirim bersama CSV iklan) bisa beberapa ratus KB — default multer 1 MB.
  limits: { fileSize: 25 * 1024 * 1024, fieldSize: 8 * 1024 * 1024 }, // 25 MB / 8 MB
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

// parseCsvLine() dipakai bersama dengan pembaca CSV iklan — lihat analisisIklan.js.

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

// ---------- Hitung Margin ----------
// Gabungkan HPP ke baris-baris pesanan (dari sinkronShopee.js bacaItemPesanan()) lalu hitung
// untung/margin. Baris perkiraan (dana belum cair) ikut dihitung, tapi totalnya juga
// dilaporkan terpisah supaya UI bisa bilang berapa bagian yang masih perkiraan.
function hitungMargin(items, infoTambahan) {
  const hppRows = db.prepare('SELECT id_produk, hpp FROM product_hpp').all();
  const hppMap = new Map(hppRows.map((r) => [r.id_produk, r.hpp]));

  let totalPenghasilan = 0;
  let totalHpp = 0;
  let totalUntung = 0;
  let penghasilanDenganHpp = 0; // pendapatan dari baris yang punya HPP — penyebut margin
  // Dihitung sebagai jumlah PRODUK / PESANAN berbeda (tile menulis "N produk" / "N pesanan"),
  // bukan jumlah baris — satu produk tanpa HPP yang terjual 10 kali tetap 1 produk.
  const produkBelumAdaHpp = new Set();
  const pesananDikembalikan = new Set();
  let penghasilanPerkiraan = 0;
  let totalOmzet = 0; // Σ harga jual (sebelum potongan Shopee), tanpa yang dikembalikan
  let totalPcs = 0;
  const pesananLaku = new Set();
  const pesananPerkiraan = new Set();

  const hasil = items.map((item) => {
    const hpp = hppMap.has(item.idProduk) ? hppMap.get(item.idProduk) : null;
    const punyaHpp = hpp !== null;

    totalPenghasilan += item.totalPenghasilan;
    if (item.perkiraan) { penghasilanPerkiraan += item.totalPenghasilan; pesananPerkiraan.add(item.noPesanan); }

    // Asumsi stok retur kembali layak jual: HPP tidak dibebankan lagi.
    // Tetap hitung saldo pencairan (misalnya potongan ongkir retur) sebagai untung/rugi.
    if (item.dikembalikan) {
      pesananDikembalikan.add(item.noPesanan);
      totalUntung += item.totalPenghasilan;
      penghasilanDenganHpp += item.totalPenghasilan;
      return { ...item, hpp, hppTotal: 0, untung: item.totalPenghasilan, marginPersen: null };
    }

    totalOmzet += item.hargaProduk || 0;
    totalPcs += item.jumlah || 0;
    pesananLaku.add(item.noPesanan);

    // HPP dikali jumlah pcs dulu sebelum dikurangkan — HPP yang disimpan selalu per 1 pcs.
    const hppTotal = punyaHpp ? hpp * item.jumlah : null;
    const untung = punyaHpp ? item.totalPenghasilan - hppTotal : null;
    const marginPersen =
      punyaHpp && item.totalPenghasilan !== 0 ? (untung / item.totalPenghasilan) * 100 : null;

    if (punyaHpp) {
      totalHpp += hppTotal;
      totalUntung += untung;
      penghasilanDenganHpp += item.totalPenghasilan;
    } else {
      produkBelumAdaHpp.add(item.idProduk);
    }

    return { ...item, hpp, hppTotal, untung, marginPersen };
  });

  // Rasio pencairan untuk halaman Analisis Iklan: Σ Total Penghasilan ÷ Σ Harga Produk
  // (nilai jual sebelum potongan Shopee) — hanya dari baris yang SUDAH cair & tidak
  // dikembalikan (baris perkiraan justru dihitung pakai rasio ini, jadi tidak boleh ikut).
  const cair = hasil.filter((it) => !it.dikembalikan && !it.perkiraan);
  const hargaCair = cair.reduce((t, it) => t + (it.hargaProduk || 0), 0);

  const ringkasan = {
    jumlahBaris: hasil.length,
    totalPenghasilan,
    totalHpp,
    totalUntung,
    // Untung ÷ pendapatan dari produk yang SUDAH ada HPP-nya saja: produk tanpa HPP tidak punya
    // untung yang diketahui, jadi pendapatannya juga tidak ikut penyebut (dulu ikut → margin terbaca rendah).
    marginRataRataPersen: penghasilanDenganHpp !== 0 ? (totalUntung / penghasilanDenganHpp) * 100 : null,
    penghasilanDenganHpp,
    jumlahBelumAdaHpp: produkBelumAdaHpp.size,
    jumlahDikembalikan: pesananDikembalikan.size,
    totalOmzet,
    totalPcs,
    jumlahPesanan: pesananLaku.size,
    penghasilanPerkiraan,
    jumlahPesananPerkiraan: pesananPerkiraan.size,
    totalHargaProduk: hargaCair,
    rasioPencairan: hargaCair ? cair.reduce((t, it) => t + it.totalPenghasilan, 0) / hargaCair : null,
    ...infoTambahan,
  };

  return { items: hasil, ringkasan };
}

// ---------- Data pesanan dari sinkron Shopee API ----------
const tanggalValid = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

// Token toko untuk environment yang sedang aktif (production di Render, bisa sandbox di lokal).
function barisTokenAktif() {
  return db.prepare('SELECT * FROM shopee_token WHERE env = ? ORDER BY updated_at DESC LIMIT 1').get(shopeeApi.getEnv());
}

// Pesanan per TANGGAL PESANAN [dari, sampai]. Kosong bukan error (mis. "Hari ini" pagi-pagi).
app.get('/api/pesanan', requireLogin, (req, res) => {
  const { dari, sampai } = req.query;
  if (!tanggalValid(dari) || !tanggalValid(sampai)) {
    return res.status(400).json({ error: 'Tanggal "dari" dan "sampai" wajib diisi (format YYYY-MM-DD).' });
  }
  const token = barisTokenAktif();
  if (!token) return res.status(400).json({ error: 'Toko belum terhubung ke Shopee.' });

  const rasioToko = rasioPencairanToko(db, token.shop_id);
  const rasioPerkiraan = rasioToko || RASIO_PENCAIRAN_DEFAULT;
  const items = bacaItemPesanan(db, token.shop_id, dari, sampai, rasioPerkiraan);
  res.json(hitungMargin(items, { sumber: 'api', periode: { dari, sampai }, rasioPerkiraan, sumberRasioPerkiraan: rasioToko ? 'toko' : 'default' }));
});

// ---------- Sinkron otomatis ----------
let sinkronBerjalan = null; // Promise sinkron yang sedang jalan — cegah dua sinkron bersamaan
let progresSinkron = null;   // { tahap: 'pesanan'|'dana', selesai, total } untuk UI

function jalankanSinkron(opsi = {}) {
  if (sinkronBerjalan) return sinkronBerjalan;
  const token = barisTokenAktif();
  if (!token) return Promise.reject(new Error('Toko belum terhubung ke Shopee.'));
  const shopId = token.shop_id;

  const tulisStatus = (kolom) => {
    const nama = Object.keys(kolom);
    db.prepare(
      `INSERT INTO sinkron_shopee (shop_id, ${nama.join(', ')}) VALUES (?, ${nama.map(() => '?').join(', ')})
       ON CONFLICT(shop_id) DO UPDATE SET ${nama.map((n) => `${n} = excluded.${n}`).join(', ')}`
    ).run(shopId, ...Object.values(kolom));
  };
  tulisStatus({ terakhir_mulai: new Date().toISOString(), status: 'berjalan', pesan: null });

  // Token diambil ulang tiap panggilan: sinkron panjang bisa melewati batas 4 jam token.
  const panggil = async (path, o) => {
    const t = await ambilTokenAktif(shopId);
    return shopeeApi.callShopApi(path, { shopId: t.shop_id, accessToken: t.access_token, ...o });
  };

  progresSinkron = null;
  // Iklan disinkron SETELAH pesanan, berhasil atau tidak; statusnya dicatat terpisah (kolom
  // iklan_*) supaya iklan yang gagal tidak membuat sinkron pesanan dianggap gagal, dan sebaliknya.
  const lanjutIklan = async () => {
    progresSinkron = { tahap: 'iklan', selesai: null, total: null };
    const lama = db.prepare('SELECT iklan_sampai FROM sinkron_shopee WHERE shop_id = ?').get(shopId) || {};
    try {
      const h = await sinkronIklan({ db, panggil, shopId, iklanSampai: lama.iklan_sampai || null });
      tulisStatus({ iklan_sampai: h.sampai, iklan_status: 'sukses', iklan_pesan: null, iklan_selesai: new Date().toISOString() });
      console.log(`[SINKRON IKLAN] Selesai: ${h.kampanyeBaru} kampanye baru, ${h.kampanyeDiperbarui} setelan dibaca, ${h.barisHarian} baris harian (${h.dari} s/d ${h.sampai}).`);
    } catch (err) {
      console.error('[SINKRON IKLAN] Gagal:', err.message);
      tulisStatus({ iklan_status: 'gagal', iklan_pesan: err.message, iklan_selesai: new Date().toISOString() });
    }
  };

  sinkronBerjalan = sinkronkan({ db, panggil, shopId, hariMundur: opsi.hariMundur, onProgres: (p) => { progresSinkron = p; } })
    .then(async (hasil) => { await lanjutIklan(); return hasil; }, async (err) => { await lanjutIklan(); throw err; })
    .then((hasil) => {
      const lama = db.prepare('SELECT sampai_ts, dari_ts FROM sinkron_shopee WHERE shop_id = ?').get(shopId) || {};
      tulisStatus({
        sampai_ts: Math.max(lama.sampai_ts || 0, hasil.sampai),
        dari_ts: lama.dari_ts ? Math.min(lama.dari_ts, hasil.dari) : hasil.dari,
        terakhir_selesai: new Date().toISOString(),
        status: 'sukses',
        pesan: null,
        jumlah_baru: hasil.baru,
        order_ts: hasil.orderSampai,
        order_berubah: hasil.orderBerubah,
      });
      console.log(`[SINKRON] Selesai: ${hasil.orderBerubah} dari ${hasil.orderDiperiksa} pesanan baru/berubah, ${hasil.baru} dana cair baru dari ${hasil.dilihat} (escrow: ${modeEscrow()}); diambil ulang nanti: ${hasil.orderTerlewat} pesanan, ${hasil.returTertunda} retur.`);
      return hasil;
    })
    .catch((err) => {
      console.error('[SINKRON] Gagal:', err.message);
      tulisStatus({ terakhir_selesai: new Date().toISOString(), status: 'gagal', pesan: err.message });
      throw err;
    })
    .finally(() => { sinkronBerjalan = null; progresSinkron = null; });
  return sinkronBerjalan;
}

function statusSinkron() {
  const token = barisTokenAktif();
  if (!token) return { terhubung: false, env: shopeeApi.getEnv() };
  const s = db.prepare('SELECT * FROM sinkron_shopee WHERE shop_id = ?').get(token.shop_id) || {};
  const agg = db.prepare(
    // Semua pesanan per tanggal dibuat (api_order) + yang cair tapi belum ada di api_order
    // (dari sinkron sebelum langkah pesanan ada).
    `SELECT COUNT(*) AS jumlah, MIN(tgl) AS terlama, MAX(tgl) AS terbaru FROM (
       SELECT order_sn, tanggal_pesanan AS tgl FROM api_order WHERE shop_id = ?1
       UNION SELECT order_sn, waktu_pesanan AS tgl FROM api_pesanan WHERE shop_id = ?1 AND waktu_pesanan <> ''
     )`
  ).get(token.shop_id);
  return {
    terhubung: true,
    env: shopeeApi.getEnv(),
    shopId: token.shop_id,
    sedangBerjalan: !!sinkronBerjalan,
    progres: progresSinkron,
    status: s.status || null,
    pesan: s.pesan || null,
    terakhirSelesai: s.terakhir_selesai || null,
    jumlahBaru: s.jumlah_baru ?? null,
    jumlahOrderBerubah: s.order_berubah ?? null,
    ulangTertunda: db.prepare('SELECT COUNT(*) AS n FROM sinkron_ulang WHERE shop_id = ?').get(String(token.shop_id)).n,
    modeEscrow: modeEscrow(),
    iklan: { status: s.iklan_status || null, pesan: s.iklan_pesan || null, terakhirSelesai: s.iklan_selesai || null, sampai: s.iklan_sampai || null },
    jumlahPesanan: agg.jumlah,
    tanggalTerlama: agg.terlama,
    tanggalTerbaru: agg.terbaru,
  };
}

app.get('/api/sinkron/status', requireLogin, (req, res) => res.json(statusSinkron()));

// Sinkron sekarang (tombol di UI). Body opsional { hariMundur: N } untuk menarik ulang
// riwayat N hari ke belakang (maks. 365).
app.post('/api/sinkron', requireLogin, async (req, res) => {
  const n = Number(req.body && req.body.hariMundur);
  const hariMundur = Number.isInteger(n) && n > 0 ? Math.min(n, 365) : undefined;
  if (hariMundur && sinkronBerjalan) return res.status(409).json({ error: 'Sinkron masih berjalan. Coba periksa ulang setelah selesai.' });
  try {
    await jalankanSinkron({ hariMundur });
    res.json(statusSinkron());
  } catch (err) {
    res.status(500).json({ error: `Sinkron gagal: ${err.message}`, ...statusSinkron() });
  }
});

// Jadwal: sekali 20 detik setelah server nyala, lalu tiap 30 menit (sinkron lanjutan cuma
// beberapa panggilan API, jadi murah; penjualan hari ini jadi hampir langsung terlihat). Diam saja kalau toko
// belum terhubung atau partner key belum diisi (mis. lokal tanpa .env Shopee).
const JEDA_SINKRON_MS = 30 * 60 * 1000;
function sinkronTerjadwal() {
  if (!process.env.SHOPEE_PARTNER_ID || !process.env.SHOPEE_PARTNER_KEY || !barisTokenAktif()) return;
  jalankanSinkron().catch(() => { /* sudah dicatat di sinkron_shopee + log */ });
}
if (process.env.SINKRON_OTOMATIS !== 'off') {
  setTimeout(sinkronTerjadwal, 20 * 1000);
  setInterval(sinkronTerjadwal, JEDA_SINKRON_MS);
}

// ---------- Rute Analisis Iklan ----------
// Ambil semua HPP tersimpan dalam bentuk Map<idProduk, { hpp, namaProduk }> untuk digabung
// dengan data iklan. Nama produk dari tabel HPP lebih rapi daripada "Nama Iklan" Shopee.
function petaHppUntukIklan() {
  const rows = db.prepare('SELECT id_produk, nama_produk, hpp FROM product_hpp WHERE hpp IS NOT NULL').all();
  return new Map(rows.map((r) => [r.id_produk, { hpp: r.hpp, namaProduk: r.nama_produk || '' }]));
}

// Rasio pencairan dikirim klien dari file Income yang sedang diunggah di sesi itu
// (ringkasan.totalPenghasilan ÷ ringkasan.totalHargaProduk). Server tidak menyimpan
// data penjualan, jadi kalau tidak ada, pakai default dan beri tahu klien sumbernya.
function rasioDariPermintaan(nilaiMentah) {
  const n = Number(nilaiMentah);
  if (Number.isFinite(n) && n > 0 && n <= 1) return { rasio: n, sumberRasio: 'upload' };
  return { rasio: RASIO_PENCAIRAN_DEFAULT, sumberRasio: 'default' };
}

// Harga & rasio pencairan per produk dari file Income di sesi klien: objek
// { idProduk: { harga, rasio, pcs } }. Di multipart dikirim sebagai string JSON.
function produkIncomeDariPermintaan(mentah) {
  if (!mentah) return {};
  try {
    const obj = typeof mentah === 'string' ? JSON.parse(mentah) : mentah;
    return obj && typeof obj === 'object' ? obj : {};
  } catch (_) {
    return {};
  }
}

// ---------- Pengaturan toko (satu angka per kunci) ----------
const KUNCI_PENGATURAN = new Set(['tingkat_cair']);

function bacaPengaturan(kunci) {
  const row = db.prepare('SELECT nilai FROM pengaturan WHERE kunci = ?').get(kunci);
  return row ? row.nilai : null;
}

// Tingkat pesanan iklan yang dibayar (0–1). Urutan: angka yang diisi sendiri di halaman
// (pengaturan, menimpa semuanya) → diukur dari status pesanan Shopee (toko + per produk) →
// default 85%. tingkatCairTerukur ikut dikirim ke klien supaya kotak isian bisa menunjukkannya.
function tingkatCairSaatIni() {
  const token = barisTokenAktif();
  const terukur = token ? tingkatCairTerukur(db, token.shop_id, new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)) : null;
  const tingkatCairTerukurToko = terukur ? terukur.toko : null;
  const n = Number(bacaPengaturan('tingkat_cair'));
  if (Number.isFinite(n) && n > 0 && n <= 1) return { tingkatCair: n, sumberTingkatCair: 'pengaturan', tingkatCairTerukurToko };
  if (terukur) return { tingkatCair: terukur.toko, tingkatCairPerProduk: terukur.perProduk, sumberTingkatCair: 'terukur', tingkatCairTerukurToko };
  return { tingkatCair: TINGKAT_CAIR_DEFAULT, sumberTingkatCair: 'default', tingkatCairTerukurToko };
}

function opsiAnalisisIklan(tanggalLaporanIso, tanggalRilisTerakhir, tanggalDataMulai) {
  const iso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
  return { ...tingkatCairSaatIni(), tanggalLaporanIso: iso(tanggalLaporanIso), tanggalRilisTerakhir: iso(tanggalRilisTerakhir), tanggalDataMulai: iso(tanggalDataMulai) };
}

app.get('/api/pengaturan', requireLogin, (req, res) => {
  const rows = db.prepare('SELECT kunci, nilai FROM pengaturan').all();
  res.json(Object.fromEntries(rows.map((r) => [r.kunci, r.nilai])));
});

// Simpan satu pengaturan; nilai null/kosong = hapus (kembali ke default).
app.put('/api/pengaturan/:kunci', requireLogin, (req, res) => {
  const kunci = String(req.params.kunci || '');
  if (!KUNCI_PENGATURAN.has(kunci)) return res.status(400).json({ error: 'Pengaturan tidak dikenal.' });
  const mentah = req.body ? req.body.nilai : null;
  if (mentah === null || mentah === undefined || mentah === '') {
    db.prepare('DELETE FROM pengaturan WHERE kunci = ?').run(kunci);
    return res.json({ kunci, nilai: null });
  }
  const n = Number(mentah);
  if (kunci === 'tingkat_cair' && !(Number.isFinite(n) && n > 0 && n <= 1)) {
    return res.status(400).json({ error: 'Tingkat pesanan dibayar harus antara 1 dan 100 persen.' });
  }
  db.prepare(
    `INSERT INTO pengaturan (kunci, nilai, updated_at, updated_by) VALUES (?, ?, datetime('now'), ?)
     ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).run(kunci, String(n), req.session.username);
  res.json({ kunci, nilai: String(n) });
});

// Unggah CSV "Data Keseluruhan Iklan" dari Seller Centre → analisis per produk + per kampanye.
// Semuanya diproses di memori — tidak ada yang disimpan ke database.
app.post('/api/iklan/upload', requireLogin, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Tidak ada file yang diunggah.' });
  }

  let hasilParse;
  try {
    hasilParse = parseShopeeAdsCsv(req.file.buffer);
  } catch (err) {
    console.error(err);
    const message = err.userFacing
      ? err.message
      : 'Gagal membaca file ini. Pastikan ini file CSV "Data Keseluruhan Iklan" asli dari Seller Centre Shopee.';
    return res.status(400).json({ error: message });
  }

  const { rasio, sumberRasio } = rasioDariPermintaan(req.body && req.body.rasioPencairan);
  const produkIncome = produkIncomeDariPermintaan(req.body && req.body.produkIncome);
  const opsi = opsiAnalisisIklan(hasilParse.tanggalLaporanIso, req.body && req.body.tanggalRilisTerakhir, req.body && req.body.tanggalDataMulai);
  const analisis = hitungAnalisisIklan(hasilParse.kampanye, petaHppUntukIklan(), rasio, produkIncome, opsi);
  res.json({ ...analisis, sumberRasio, sumberTingkatCair: opsi.sumberTingkatCair, tingkatCairTerukurToko: opsi.tingkatCairTerukurToko, periode: hasilParse.periode, namaToko: hasilParse.namaToko, tanggalLaporanIso: hasilParse.tanggalLaporanIso });
});

// Analisis iklan dari data Shopee Ads API yang tersimpan (sinkronIklan.js) — pengganti unggah CSV.
// Body sama dengan hitung-ulang (rasio & harga per produk dari data penjualan halaman) + dari/sampai.
app.post('/api/iklan/dari-shopee', requireLogin, (req, res) => {
  const token = barisTokenAktif();
  if (!token) return res.status(400).json({ error: 'Toko belum terhubung ke Shopee.' });
  const body = req.body || {};
  const sampai = tanggalValid(body.sampai) ? body.sampai : new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const dari = tanggalValid(body.dari) ? body.dari : sampai;
  const { kampanye, setelan, adaData } = kampanyeDariDb(db, token.shop_id, dari, sampai);
  const s = db.prepare('SELECT iklan_status, iklan_pesan, iklan_selesai, iklan_sampai FROM sinkron_shopee WHERE shop_id = ?').get(token.shop_id) || {};
  const statusIklan = { status: s.iklan_status || null, pesan: s.iklan_pesan || null, terakhirSelesai: s.iklan_selesai || null };
  if (!adaData && !kampanye.length) return res.json({ kosong: true, statusIklan });
  const { rasio, sumberRasio } = rasioDariPermintaan(body.rasioPencairan);
  const opsi = opsiAnalisisIklan(sampai, body.tanggalRilisTerakhir, body.tanggalDataMulai);
  const analisis = hitungAnalisisIklan(kampanye, petaHppUntukIklan(), rasio, produkIncomeDariPermintaan(body.produkIncome), opsi);
  const tampil = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  res.json({
    ...analisis, sumber: 'api', setelanApi: setelan, rentangData: { dari, sampai }, statusIklan,
    sumberRasio, sumberTingkatCair: opsi.sumberTingkatCair, tingkatCairTerukurToko: opsi.tingkatCairTerukurToko,
    periode: `${tampil(dari)} - ${tampil(sampai)}`, namaToko: '', tanggalLaporanIso: sampai,
  });
});

// Hitung ulang dengan HPP terbaru dari database, tanpa unggah ulang file — dipakai klien
// setelah pengguna mengisi HPP produk yang tadinya kuning ("belum ada HPP").
app.post('/api/iklan/hitung-ulang', requireLogin, (req, res) => {
  const kampanye = req.body && Array.isArray(req.body.kampanye) ? req.body.kampanye : null;
  if (!kampanye || !kampanye.length) {
    return res.status(400).json({ error: 'Tidak ada data kampanye untuk dihitung ulang.' });
  }
  const { rasio, sumberRasio } = rasioDariPermintaan(req.body.rasioPencairan);
  const opsi = opsiAnalisisIklan(req.body.tanggalLaporanIso, req.body.tanggalRilisTerakhir, req.body.tanggalDataMulai);
  const analisis = hitungAnalisisIklan(kampanye, petaHppUntukIklan(), rasio, produkIncomeDariPermintaan(req.body.produkIncome), opsi);
  res.json({ ...analisis, sumberRasio, sumberTingkatCair: opsi.sumberTingkatCair, tingkatCairTerukurToko: opsi.tingkatCairTerukurToko, periode: req.body.periode || '', namaToko: req.body.namaToko || '', tanggalLaporanIso: req.body.tanggalLaporanIso || '' });
});

// ---------- Setelan iklan per produk (Target ROAS & Modal Harian yang dipasang di Seller Centre) ----------
app.get('/api/iklan/setelan', requireLogin, (req, res) => {
  res.json(db.prepare('SELECT id_produk, target_roas, modal_harian, updated_at, updated_by FROM iklan_setelan').all());
});

// Simpan salah satu / keduanya. Kirim null (atau kosong) untuk menghapus nilai.
app.put('/api/iklan/setelan/:idProduk', requireLogin, (req, res) => {
  const idProduk = String(req.params.idProduk || '').trim();
  if (!idProduk) return res.status(400).json({ error: 'ID Produk wajib diisi.' });
  const angkaAtauNull = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const body = req.body || {};
  const target = angkaAtauNull(body.targetRoas);
  const modal = angkaAtauNull(body.modalHarian);
  if (target === undefined || modal === undefined) {
    return res.status(400).json({ error: 'Target ROAS dan Modal Harian harus berupa angka (tidak boleh minus).' });
  }
  const lama = db.prepare('SELECT target_roas, modal_harian FROM iklan_setelan WHERE id_produk = ?').get(idProduk) || {};
  const targetBaru = 'targetRoas' in body ? target : lama.target_roas ?? null;
  const modalBaru = 'modalHarian' in body ? modal : lama.modal_harian ?? null;
  db.prepare(
    `INSERT INTO iklan_setelan (id_produk, target_roas, modal_harian, updated_at, updated_by)
     VALUES (?, ?, ?, datetime('now'), ?)
     ON CONFLICT(id_produk) DO UPDATE SET
       target_roas = excluded.target_roas,
       modal_harian = excluded.modal_harian,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`
  ).run(idProduk, targetBaru, modalBaru, req.session.username);
  res.json(db.prepare('SELECT id_produk, target_roas, modal_harian, updated_at, updated_by FROM iklan_setelan WHERE id_produk = ?').get(idProduk));
});

// ---------- Shopee Open Platform API — OAuth + tes ambil data ----------
// Lihat shopeeApi.js untuk signing/endpoint, §10/§19 PROJECT_NOTES.md (folder induk) untuk
// konteks. Tahap sekarang: sandbox saja (SHOPEE_ENV=sandbox di .env, Test Partner ID/Key
// dari App yang baru dibuat) — belum Go Live, jadi belum bisa ambil data toko asli.

function redirectUriDariRequest(req) {
  return process.env.SHOPEE_REDIRECT_URL || `${req.protocol}://${req.get('host')}/auth/shopee/callback`;
}

// Ambil access_token yang masih berlaku untuk satu shop_id, refresh dulu ke Shopee kalau
// sudah (atau hampir) kedaluwarsa. Dilempar error kalau belum pernah otorisasi sama sekali.
// Refresh yang sedang berjalan per shop_id. Refresh token Shopee sekali pakai (tiap refresh
// memberi yang baru dan mematikan yang lama), jadi panggilan paralel (sinkron menjalankan 4
// sekaligus) harus menunggu SATU refresh yang sama — kalau tidak, yang kedua gagal.
const refreshBerjalan = new Map();

async function ambilTokenAktif(shopId) {
  const baris = shopId
    ? db.prepare('SELECT * FROM shopee_token WHERE shop_id = ?').get(String(shopId))
    : db.prepare('SELECT * FROM shopee_token ORDER BY updated_at DESC LIMIT 1').get();
  if (!baris) throw new Error('Belum ada toko yang diotorisasi. Buka /auth/shopee/authorize dulu.');

  const umurDetik = Math.floor(Date.now() / 1000) - baris.obtained_at;
  const masihSegar = umurDetik < baris.expire_in - 300; // beri jeda 5 menit sebelum benar-benar kedaluwarsa
  if (masihSegar) return baris;

  if (!refreshBerjalan.has(baris.shop_id)) {
    const janji = (async () => {
      const hasil = await shopeeApi.refreshAccessToken({ refreshToken: baris.refresh_token, shopId: baris.shop_id });
      if (hasil.error) throw new Error(`Gagal refresh token: ${hasil.error} — ${hasil.message || ''}`);
      db.prepare(
        `UPDATE shopee_token SET access_token = ?, refresh_token = ?, expire_in = ?, obtained_at = ?, updated_at = datetime('now')
         WHERE shop_id = ?`
      ).run(hasil.access_token, hasil.refresh_token, hasil.expire_in, Math.floor(Date.now() / 1000), baris.shop_id);
      return { ...baris, access_token: hasil.access_token, refresh_token: hasil.refresh_token, expire_in: hasil.expire_in };
    })().finally(() => refreshBerjalan.delete(baris.shop_id));
    refreshBerjalan.set(baris.shop_id, janji);
  }
  return refreshBerjalan.get(baris.shop_id);
}

// Langkah 1: buka ini di browser (harus sudah login ke app dulu) untuk diarahkan ke halaman
// otorisasi Shopee. Sandbox: login pakai Sandbox Shop Account (dibuat di Console > Test
// Account-Sandbox v2), BUKAN akun Shopee asli.
app.get('/auth/shopee/authorize', requireLogin, (req, res) => {
  try {
    const url = shopeeApi.buildAuthUrl(redirectUriDariRequest(req), req.session.userId);
    res.redirect(url);
  } catch (err) {
    res.status(500).send(`Gagal bikin link otorisasi: ${err.message}`);
  }
});

// Langkah 2: Shopee redirect balik ke sini dengan ?code=...&shop_id=... setelah seller
// menyetujui otorisasi. Tukar code jadi access_token/refresh_token dan simpan per shop_id.
app.get('/auth/shopee/callback', requireLogin, async (req, res) => {
  const { code, shop_id: shopId } = req.query;
  if (!code || !shopId) {
    return res.status(400).send('Callback tidak lengkap — code atau shop_id tidak ada di URL.');
  }
  // shop_id Shopee selalu angka; tolak yang lain — nilainya ikut ditulis ke halaman balasan (cegah XSS).
  if (!/^\d+$/.test(String(shopId))) return res.status(400).send('shop_id tidak valid.');
  try {
    const hasil = await shopeeApi.getAccessToken({ code: String(code), shopId: String(shopId) });
    if (hasil.error) {
      return res.status(400).send(`Shopee menolak tukar token: ${hasil.error} — ${hasil.message || ''}`);
    }
    db.prepare(
      `INSERT INTO shopee_token (shop_id, env, access_token, refresh_token, expire_in, obtained_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(shop_id) DO UPDATE SET
         env = excluded.env, access_token = excluded.access_token, refresh_token = excluded.refresh_token,
         expire_in = excluded.expire_in, obtained_at = excluded.obtained_at, updated_at = excluded.updated_at`
    ).run(String(shopId), shopeeApi.getEnv(), hasil.access_token, hasil.refresh_token, hasil.expire_in, Math.floor(Date.now() / 1000));
    jalankanSinkron().catch(() => { /* status gagal tercatat, terlihat di halaman Kalkulator */ });
    res.send(`Otorisasi berhasil untuk shop_id ${shopId} (environment: ${shopeeApi.getEnv()}). Data penjualan sedang diambil otomatis — <a href="/">kembali ke aplikasi</a>.`);
  } catch (err) {
    res.status(500).send(`Gagal tukar code jadi token: ${err.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`Shopee Margin Calc jalan di http://localhost:${PORT}`);
});
