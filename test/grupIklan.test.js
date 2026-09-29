// Analisis Iklan groups (Hentikan · Ganti · Ubah · Masa Belajar · Lanjutkan) and the "ganti" rule (user, 2026-09-28).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const E = require('../public/evaluasiIklan');

function extract(name) {
  const s = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const i = s.indexOf(`function ${name}(`); assert.ok(i >= 0, name);
  return s.slice(i, s.indexOf('\n}', i) + 2);
}
const geserHari = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ctx = { geserHari, HARI_TUNGGU_UBAH: 15, bulatkanModal: (rp) => Math.max(0, Math.round(rp / 5000) * 5000) };
vm.runInNewContext(`${extract('terapkanGanti')};${extract('grupIklan')};globalThis.terapkanGanti = terapkanGanti; globalThis.grupIklan = grupIklan;`, ctx);

const row = (id, keputusan, extra = {}) => ({ p: { idProduk: id, aksi: 'rugi' }, keputusan, alasan: '', target: 10, targetBaru: 12, modal: 60000, modalBaru: 60000, perubahan: null, ...extra });
const rugi = (id, untungIklan, hari = 20) => ({ idProduk: id, untungIklan, hari });

test('big losers are replaced (past winners first, then new candidates); without a candidate the budget is halved', () => {
  const rows = [row('a', 'naikkan'), row('b', 'lanjut', { p: { idProduk: 'b', aksi: 'abu' } }), row('c', 'naikkan'), row('d', 'tunggu', { p: { idProduk: 'd', aksi: 'tunggu' } })];
  const saran = {
    ganti: [rugi('b', -500000), rugi('a', -300000), rugi('c', -150000), rugi('d', -120000)],
    ulang: [{ idProduk: 'w', nama: 'Winner', untungIklan: 400000 }], coba: [{ idProduk: 'n', nama: 'New', pcsA: 12 }],
  };
  ctx.terapkanGanti(rows, saran);
  const [a, b, c, d] = rows;
  assert.equal(b.keputusan, 'ganti'); assert.equal(b.pengganti.idProduk, 'w'); assert.equal(b.pengganti.jenis, 'ulang'); // biggest loss first
  assert.equal(a.keputusan, 'ganti'); assert.equal(a.pengganti.idProduk, 'n'); assert.equal(a.pengganti.jenis, 'coba');
  assert.equal(a.targetBaru, null); assert.equal(a.modalBaru, 0); assert.equal(a.rugiBesar.rugi, 300000); assert.equal(a.rugiBesar.hari, 20);
  assert.equal(c.keputusan, 'kurangi'); assert.equal(c.modalBaru, 30000); assert.equal(c.targetBaru, null); // no candidate left
  assert.equal(d.keputusan, 'tunggu'); // still learning: never replaced
});

test('replacement leaves HPP, pause, reversal and shop rows alone, and never takes the one-trial slot', () => {
  const rows = ['isi-hpp', 'jeda', 'kembalikan', 'toko'].map((k, i) => row(`x${i}`, k));
  const before = JSON.stringify(rows);
  ctx.terapkanGanti(rows, { ganti: rows.map((r) => rugi(r.p.idProduk, -200000)), ulang: [{ idProduk: 'w', nama: 'W', untungIklan: 1 }], coba: [] });
  assert.equal(JSON.stringify(rows), before);

  const trial = [{ ...row('g', 'ganti'), pengganti: { idProduk: 'w' } }, row('t', 'naikkan'), row('u', 'naikkan')];
  E.terapkanEvaluasiToko(trial, null, { dataSiapEvaluasi: true, riwayatSetelan: [] }, true);
  assert.equal(trial[0].keputusan, 'ganti');
  assert.equal(trial[1].keputusan, 'naikkan'); // the one trial this round
  assert.equal(trial[2].keputusan, 'tunggu'); assert.equal(trial[2].alasan, 'satu-uji'); assert.equal(trial[2].ditahan, 'naikkan');
  // Missing data holds trials, but not a replacement.
  const held = [{ ...row('g', 'ganti'), pengganti: { idProduk: 'w' } }, row('t', 'naikkan')];
  E.terapkanEvaluasiToko(held, null, { dataSiapEvaluasi: false, riwayatSetelan: [] }, true);
  assert.equal(held[0].keputusan, 'ganti'); assert.equal(held[1].alasan, 'data-toko');
});

test('a worse result from the latest settings change takes priority over Ganti and does not consume its replacement', () => {
  const rows = [row('loser', 'naikkan'), row('other', 'naikkan')];
  const candidate = { idProduk: 'winner', nama: 'Winner', untungIklan: 400000 };
  ctx.terapkanGanti(rows, { ganti: [rugi('loser', -300000), rugi('other', -200000)], ulang: [candidate], coba: [] },
    (b) => b.p.idProduk === 'loser' ? { status: 'buruk' } : null);
  assert.equal(rows[0].keputusan, 'naikkan'); // the trial judge may now return it to the old setting
  assert.equal(rows[1].keputusan, 'ganti');
  assert.equal(rows[1].pengganti.idProduk, 'winner');
});

test('each running ad lands in exactly one group', () => {
  const hariIni = '2026-09-30';
  const g = (b) => ctx.grupIklan(b, hariIni);
  assert.equal(g(row('a', 'jeda')), 'hentikan');
  assert.equal(g(row('a', 'ganti')), 'ganti');
  for (const k of ['naikkan', 'turunkan', 'tambah', 'kurangi', 'kembalikan', 'tinjau', 'isi-hpp']) assert.equal(g(row('a', k)), 'ubah', k);
  assert.equal(g(row('a', 'tunggu', { p: { idProduk: 'a', aksi: 'tunggu' } })), 'belajar'); // new ad
  assert.equal(g(row('a', 'tunggu', { perubahan: { tanggal: '2026-09-20' } })), 'belajar'); // changed 10 days ago
  assert.equal(g(row('a', 'lanjut', { perubahan: { tanggal: '2026-09-15' } })), 'lanjut'); // result is out (day 15)
  assert.equal(g(row('a', 'tunggu', { p: { idProduk: 'a', aksi: 'tunggu', penilaian: { siap: false, alasan: 'data' } } })), 'lanjut'); // missing data ≠ learning
  assert.equal(g(row('a', 'tunggu', { alasan: 'satu-uji' })), 'lanjut'); // queued
  assert.equal(g(row('a', 'toko', { p: { idProduk: 'a', aksi: 'toko' } })), 'lanjut');
});
