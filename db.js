// Lapisan database sederhana pakai node:sqlite (bawaan Node.js, tidak perlu install driver native).
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// Bisa dioverride lewat env DATA_DIR — perlu ini kalau di-deploy ke platform yang
// menyediakan persistent disk di path tertentu (misalnya Render: /var/data).
// Kalau tidak diset, dipakai folder ./data lokal seperti biasa.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS product_hpp (
    id_produk TEXT PRIMARY KEY,
    nama_produk TEXT,
    hpp REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by TEXT
  );

  -- Koreksi manual jumlah pcs per baris pesanan, dipakai untuk menimpa tebakan
  -- otomatis dari hitungJumlahPcsPerBaris() di parseExcel.js kalau ternyata salah.
  -- Beda dengan product_hpp (berlaku untuk SEMUA pesanan produk itu), ini spesifik
  -- per baris karena jumlah pcs memang beda-beda tiap transaksi, bukan sifat tetap
  -- dari produknya.
  --
  -- Kuncinya HARUS 3 kolom (order_sn + id_produk + harga_produk), bukan cuma 2:
  -- satu pesanan bisa punya lebih dari satu baris Sku untuk produk yang SAMA
  -- (persis kasus yang sedang dikoreksi fitur ini) — order_sn+id_produk saja tidak
  -- cukup unik untuk baris seperti itu, tapi harga_produk baris tsb (Rupiah, dari
  -- kolom "Harga Produk" Shopee) selalu beda antar baris dalam kasus ini.
  -- Setelan iklan yang sedang dipasang orang tua di Seller Centre (Target ROAS & Modal
  -- Harian) per produk. TIDAK ada di file ekspor Shopee, jadi diketik sekali di halaman
  -- Analisis Iklan supaya aplikasi bisa membandingkan "sekarang" vs "minimal/saran".
  CREATE TABLE IF NOT EXISTS iklan_setelan (
    id_produk TEXT PRIMARY KEY,
    target_roas REAL,
    modal_harian REAL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by TEXT
  );

  -- Pengaturan toko yang cuma satu angka (bukan per produk), mis. 'tingkat_cair' =
  -- bagian pesanan iklan yang benar-benar dibayar (0–1). Kunci → nilai teks.
  CREATE TABLE IF NOT EXISTS pengaturan (
    kunci TEXT PRIMARY KEY,
    nilai TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by TEXT
  );

  CREATE TABLE IF NOT EXISTS order_item_jumlah (
    order_sn TEXT NOT NULL,
    id_produk TEXT NOT NULL,
    harga_produk REAL NOT NULL,
    jumlah INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by TEXT,
    PRIMARY KEY (order_sn, id_produk, harga_produk)
  );

  -- Token OAuth Shopee Open Platform (lihat shopeeApi.js + §10/§19 PROJECT_NOTES.md),
  -- satu baris per shop_id. access_token berlaku 4 jam, refresh_token 30 hari — server.js
  -- yang tanggung jawab refresh sebelum kedaluwarsa, disimpan di sini (bukan .env),
  -- karena ini dinamis per toko dan berbeda antara environment sandbox/production.
  CREATE TABLE IF NOT EXISTS shopee_token (
    shop_id TEXT PRIMARY KEY,
    env TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expire_in INTEGER NOT NULL,
    obtained_at INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Pesanan yang dananya sudah dilepas, hasil sinkron otomatis dari Shopee API (lihat
  -- sinkronShopee.js) — pengganti file Excel "Income". Beda dari unggahan Excel (yang cuma
  -- diproses di memori), data ini DISIMPAN supaya kalkulator bisa langsung tampil tanpa
  -- unggah apa pun. Username pembeli sengaja tidak disimpan. Tanggal = tanggal WIB (YYYY-MM-DD).
  CREATE TABLE IF NOT EXISTS api_pesanan (
    order_sn TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL,
    waktu_pesanan TEXT,
    tanggal_dilepaskan TEXT NOT NULL,
    escrow_amount REAL NOT NULL,
    status_pesanan TEXT,
    ada_retur INTEGER NOT NULL DEFAULT 0,
    synced_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_api_pesanan_tanggal ON api_pesanan (shop_id, tanggal_dilepaskan);

  -- Satu baris per barang di pesanan (bentuknya sama dengan baris "Sku" di Excel Income):
  -- harga_produk = subtotal baris (sudah dikali jumlah), total_penghasilan = bagian
  -- escrow_amount pesanan untuk baris ini (dibagi sebanding harga, persis cara Shopee
  -- membaginya di Excel). Barang yang diretur jadi baris sendiri dengan dikembalikan = 1.
  CREATE TABLE IF NOT EXISTS api_pesanan_item (
    order_sn TEXT NOT NULL,
    baris INTEGER NOT NULL,
    id_produk TEXT NOT NULL,
    model_id TEXT,
    nama_produk TEXT,
    nama_model TEXT,
    jumlah INTEGER NOT NULL,
    harga_produk REAL NOT NULL,
    total_penghasilan REAL NOT NULL,
    dikembalikan INTEGER NOT NULL DEFAULT 0,
    jumlah_pengembalian REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (order_sn, baris)
  );

  -- Status sinkron per toko: sampai_ts = batas atas rentang tanggal-cair yang sudah ditarik
  -- (unix detik), dipakai sinkron berikutnya supaya cuma menarik yang baru.
  CREATE TABLE IF NOT EXISTS sinkron_shopee (
    shop_id TEXT PRIMARY KEY,
    sampai_ts INTEGER,
    dari_ts INTEGER,
    terakhir_mulai TEXT,
    terakhir_selesai TEXT,
    status TEXT,
    pesan TEXT,
    jumlah_baru INTEGER
  );

  -- SEMUA pesanan per tanggal dibuat (termasuk yang belum cair / batal), dari get_order_list +
  -- get_order_detail — dipakai untuk penjualan hari ini & tren harian, karena dana baru cair
  -- beberapa hari setelah pesanan. Pesanan yang sudah cair tetap memakai angka pasti dari
  -- api_pesanan; yang belum, penghasilannya diperkirakan (lihat server.js /api/pesanan).
  CREATE TABLE IF NOT EXISTS api_order (
    order_sn TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL,
    tanggal_pesanan TEXT NOT NULL,
    create_time INTEGER,
    update_time INTEGER,
    status TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_api_order_tanggal ON api_order (shop_id, tanggal_pesanan);

  -- harga_satuan = model_discounted_price (per 1 pcs, sudah diverifikasi §20.3/§21).
  CREATE TABLE IF NOT EXISTS api_order_item (
    order_sn TEXT NOT NULL,
    baris INTEGER NOT NULL,
    id_produk TEXT NOT NULL,
    model_id TEXT,
    nama_produk TEXT,
    nama_model TEXT,
    jumlah INTEGER NOT NULL,
    harga_satuan REAL NOT NULL,
    PRIMARY KEY (order_sn, baris)
  );
`);

// Kolom yang ditambahkan setelah tabel sinkron_shopee sudah ada di produksi.
try { db.exec('ALTER TABLE sinkron_shopee ADD COLUMN order_ts INTEGER'); } catch (_) { /* sudah ada */ }

module.exports = db;
