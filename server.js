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

  let totalPenghasilan = 0;
  let totalHpp = 0;
  let totalUntung = 0;
  let jumlahBelumAdaHpp = 0;
  let jumlahDikembalikan = 0;

  const hasil = items.map((item) => {
    const hpp = hppMap.has(item.idProduk) ? hppMap.get(item.idProduk) : null;
    const punyaHpp = hpp !== null;

    totalPenghasilan += item.totalPenghasilan;

    // Pesanan yang dikembalikan/di-refund: barangnya kembali ke penjual (proses retur
    // Shopee mengharuskan pembeli mengirim balik sebelum dana dikembalikan), jadi HPP-nya
    // TIDAK dianggap hilang — bukan untung, tapi juga bukan rugi. Baris ini sengaja tidak
    // dihitung ke Total Untung/HPP, dan tidak perlu diminta isi HPP juga.
    if (item.dikembalikan) {
      jumlahDikembalikan += 1;
      return { ...item, hpp, untung: 0, marginPersen: null };
    }

    const untung = punyaHpp ? item.totalPenghasilan - hpp : null;
    const marginPersen =
      punyaHpp && item.totalPenghasilan !== 0 ? (untung / item.totalPenghasilan) * 100 : null;

    if (punyaHpp) {
      totalHpp += hpp;
      totalUntung += untung;
    } else {
      jumlahBelumAdaHpp += 1;
    }

    return {
      ...item,
      hpp,
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
