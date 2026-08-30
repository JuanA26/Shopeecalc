// Skrip untuk menambah / mengganti password akun login.
// Pakai ini dari terminal, JANGAN buat halaman "daftar akun" publik di web-nya.
//
// Cara pakai:
//   node scripts/add-user.js <username> <password>
//
// Contoh:
//   node scripts/add-user.js ibu "password-yang-kuat-123"
//   node scripts/add-user.js saya "password-lain-456"

const bcrypt = require('bcryptjs');
const db = require('../db');

const [, , username, password] = process.argv;

if (!username || !password) {
  console.error('Cara pakai: node scripts/add-user.js <username> <password>');
  process.exit(1);
}

if (password.length < 8) {
  console.error('Password sebaiknya minimal 8 karakter.');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 12);

db.prepare(
  `INSERT INTO users (username, password_hash) VALUES (?, ?)
   ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash`
).run(username.trim(), hash);

console.log(`OK — akun "${username}" sudah dibuat/diperbarui.`);
