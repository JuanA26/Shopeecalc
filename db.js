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
`);

module.exports = db;
