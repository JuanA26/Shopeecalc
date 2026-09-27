// Penyimpanan sesi login di SQLite (pengganti MemoryStore bawaan express-session).
// MemoryStore kehilangan semua sesi tiap server restart — artinya setiap deploy membuat semua
// orang (termasuk orang tua di HP) harus login ulang. Sesi di sini bertahan selama cookie-nya
// masih berlaku, dan yang kedaluwarsa dibersihkan berkala.
const session = require('express-session');

class SesiSqlite extends session.Store {
  constructor(db, { bersihkanTiapMs = 60 * 60 * 1000 } = {}) {
    super();
    db.exec(`CREATE TABLE IF NOT EXISTS sesi (
      sid TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      kedaluwarsa INTEGER NOT NULL
    )`);
    this.q = {
      ambil: db.prepare('SELECT data FROM sesi WHERE sid = ? AND kedaluwarsa > ?'),
      simpan: db.prepare(`INSERT INTO sesi (sid, data, kedaluwarsa) VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET data = excluded.data, kedaluwarsa = excluded.kedaluwarsa`),
      perpanjang: db.prepare('UPDATE sesi SET kedaluwarsa = ? WHERE sid = ?'),
      hapus: db.prepare('DELETE FROM sesi WHERE sid = ?'),
      bersihkan: db.prepare('DELETE FROM sesi WHERE kedaluwarsa <= ?'),
    };
    this.bersihkan();
    setInterval(() => this.bersihkan(), bersihkanTiapMs).unref();
  }

  static kedaluwarsa(sess) {
    const c = sess && sess.cookie;
    const t = c && c.expires ? new Date(c.expires).getTime() : Date.now() + ((c && c.originalMaxAge) || 24 * 3600e3);
    return Number.isFinite(t) ? t : Date.now() + 24 * 3600e3;
  }

  get(sid, cb) {
    try {
      const r = this.q.ambil.get(sid, Date.now());
      cb(null, r ? JSON.parse(r.data) : null);
    } catch (err) { cb(err); }
  }

  set(sid, sess, cb = () => {}) {
    try { this.q.simpan.run(sid, JSON.stringify(sess), SesiSqlite.kedaluwarsa(sess)); cb(null); } catch (err) { cb(err); }
  }

  touch(sid, sess, cb = () => {}) {
    try { this.q.perpanjang.run(SesiSqlite.kedaluwarsa(sess), sid); cb(null); } catch (err) { cb(err); }
  }

  destroy(sid, cb = () => {}) {
    try { this.q.hapus.run(sid); cb(null); } catch (err) { cb(err); }
  }

  bersihkan() {
    try { this.q.bersihkan.run(Date.now()); } catch (_) { /* dicoba lagi di putaran berikutnya */ }
  }
}

module.exports = SesiSqlite;
