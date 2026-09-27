// Log server yang bisa dibaca dari aplikasi (halaman Pengaturan, /api/log) — log Render hanya bisa
// dilihat pemilik akun Render. console.log/warn/error tetap tampil seperti biasa, dan juga disimpan
// di tabel log_server (paling banyak BATAS baris terbaru). Isinya status sinkron & error; tidak ada
// token atau kata sandi yang pernah ditulis ke log (cek sebelum menambah console.* baru).
const util = require('node:util');

const BATAS = 500;

function pasangLogServer(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS log_server (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    waktu TEXT NOT NULL,
    level TEXT NOT NULL,
    pesan TEXT NOT NULL
  )`);
  const simpan = db.prepare('INSERT INTO log_server (waktu, level, pesan) VALUES (?, ?, ?)');
  const pangkas = db.prepare('DELETE FROM log_server WHERE id <= (SELECT MAX(id) FROM log_server) - ?');
  let tulisan = 0;
  for (const [fungsi, level] of [['log', 'info'], ['warn', 'peringatan'], ['error', 'error']]) {
    const asli = console[fungsi].bind(console);
    console[fungsi] = (...args) => {
      asli(...args);
      try {
        simpan.run(new Date().toISOString(), level, util.format(...args).slice(0, 2000));
        if (++tulisan % 50 === 0) pangkas.run(BATAS);
      } catch (_) { /* log tidak boleh membuat server gagal */ }
    };
  }
  pangkas.run(BATAS);

  const terbaru = db.prepare('SELECT waktu, level, pesan FROM log_server ORDER BY id DESC LIMIT ?');
  const hitung = db.prepare("SELECT level, COUNT(*) AS n FROM log_server WHERE waktu >= ? AND level <> 'info' GROUP BY level");
  return {
    terbaru: (n = 100) => terbaru.all(Math.min(Math.max(1, n | 0), BATAS)),
    // Jumlah peringatan/error 24 jam terakhir (tanpa isi pesan) — untuk /api/kesehatan yang publik.
    ringkas24Jam: () => {
      const hasil = { peringatan: 0, error: 0 };
      for (const r of hitung.all(new Date(Date.now() - 24 * 3600e3).toISOString())) hasil[r.level] = r.n;
      return hasil;
    },
  };
}

module.exports = { pasangLogServer };
