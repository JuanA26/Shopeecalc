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

test('an ad whose current zone is untung is never replaced, however big its campaign loss (user, 01/10)', () => {
  // Lost early, profitable now: tumbuh / lanjut stay; the replacement goes to the next loser.
  const rows = [row('pulih', 'tumbuh', { p: { idProduk: 'pulih', aksi: 'untung' } }), row('tenang', 'lanjut', { p: { idProduk: 'tenang', aksi: 'untung' } }), row('rugi', 'naikkan')];
  ctx.terapkanGanti(rows, { ganti: [rugi('pulih', -600000), rugi('tenang', -500000), rugi('rugi', -200000)], ulang: [{ idProduk: 'w', nama: 'W', untungIklan: 1 }], coba: [] });
  assert.equal(rows[0].keputusan, 'tumbuh'); assert.equal(rows[0].rugiBesar, undefined);
  assert.equal(rows[1].keputusan, 'lanjut');
  assert.equal(rows[2].keputusan, 'ganti'); assert.equal(rows[2].pengganti.idProduk, 'w');
});

test('replacement leaves HPP, pause, reversal and shop rows alone, and is never held', () => {
  const rows = ['isi-hpp', 'jeda', 'kembalikan', 'toko'].map((k, i) => row(`x${i}`, k));
  const before = JSON.stringify(rows);
  ctx.terapkanGanti(rows, { ganti: rows.map((r) => rugi(r.p.idProduk, -200000)), ulang: [{ idProduk: 'w', nama: 'W', untungIklan: 1 }], coba: [] });
  assert.equal(JSON.stringify(rows), before);

  const trial = [{ ...row('g', 'ganti'), pengganti: { idProduk: 'w' } }, row('t', 'naikkan'), row('u', 'naikkan')];
  E.terapkanEvaluasiToko(trial, { dataSiapEvaluasi: true, riwayatSetelan: [] }, true);
  assert.equal(trial[0].keputusan, 'ganti');
  assert.equal(trial[1].keputusan, 'naikkan'); assert.equal(trial[2].keputusan, 'naikkan'); // no one-at-a-time limit (30/09)
  // Missing data holds trials, but not a replacement.
  const held = [{ ...row('g', 'ganti'), pengganti: { idProduk: 'w' } }, row('t', 'naikkan')];
  E.terapkanEvaluasiToko(held, { dataSiapEvaluasi: false, riwayatSetelan: [] }, true);
  assert.equal(held[0].keputusan, 'ganti'); assert.equal(held[1].alasan, 'data-toko');
});

test('a worse result from the latest settings change takes priority over Ganti and does not consume its replacement', () => {
  const rows = [row('loser', 'naikkan'), row('other', 'naikkan')];
  const candidate = { idProduk: 'winner', nama: 'Winner', untungIklan: 400000 };
  ctx.terapkanGanti(rows, { ganti: [rugi('loser', -300000), rugi('other', -200000)], ulang: [candidate], coba: [] },
    (b) => b.p.idProduk === 'loser' ? { status: 'buruk', baru: true } : null);
  assert.equal(rows[0].keputusan, 'naikkan'); // the trial judge may now return it to the old setting
  assert.equal(rows[1].keputusan, 'ganti');
  assert.equal(rows[1].pengganti.idProduk, 'winner');
});

test('an old worse result (> 28 days) does not block Ganti: the trial judge would not offer Tinjau for it', () => {
  // Target and budget changed together on 01/08, direct profit fell; today 30/09.
  const perHari = {};
  for (let d = -7; d <= 7; d++) if (d) perHari[E.geser('2026-08-01', d)] = { biaya: 60000, omzet: 300000, omzetLangsung: d < 0 ? 300000 : 100000 };
  const data = { dataSiapEvaluasi: true, kampanye: [{ campaignId: 'c', kodeProduk: 'loser', status: 'Berjalan', perHari }],
    riwayatSetelan: [{ idProduk: 'loser', campaignId: 'c', tanggal: '2026-08-01', targetLama: 8, targetBaru: 10, modalLama: 50000, modalBaru: 60000 }] };
  const rows = [row('loser', 'naikkan', { p: { idProduk: 'loser', aksi: 'rugi', roasImpas: 5 } })];
  ctx.terapkanGanti(rows, { ganti: [rugi('loser', -400000)], ulang: [{ idProduk: 'w', nama: 'W', untungIklan: 1 }], coba: [] },
    (b) => E.hasilIklan(data, b.p.idProduk, '2026-09-30', 5));
  E.terapkanEvaluasiToko(rows, data, true, '2026-09-30');
  assert.equal(rows[0].keputusan, 'ganti'); // before the fix: 'naikkan', i.e. tuned instead of replaced
});

test('each running ad lands in exactly one group', () => {
  const hariIni = '2026-09-30';
  const g = (b) => ctx.grupIklan(b, hariIni);
  assert.equal(g(row('a', 'jeda')), 'hentikan');
  assert.equal(g(row('a', 'ganti')), 'ganti');
  for (const k of ['naikkan', 'turunkan', 'tambah', 'tumbuh', 'kurangi', 'kembalikan', 'tinjau', 'isi-hpp']) assert.equal(g(row('a', k)), 'ubah', k);
  assert.equal(g(row('a', 'tunggu', { p: { idProduk: 'a', aksi: 'tunggu' } })), 'belajar'); // new ad
  assert.equal(g(row('a', 'tunggu', { perubahan: { tanggal: '2026-09-20' } })), 'belajar'); // changed 10 days ago
  assert.equal(g(row('a', 'lanjut', { perubahan: { tanggal: '2026-09-15' } })), 'lanjut'); // result is out (day 15)
  assert.equal(g(row('a', 'tunggu', { p: { idProduk: 'a', aksi: 'tunggu', penilaian: { siap: false, alasan: 'data' } } })), 'lanjut'); // missing data ≠ learning
  assert.equal(g(row('a', 'tunggu', { alasan: 'satu-uji' })), 'lanjut'); // queued
  assert.equal(g(row('a', 'toko', { p: { idProduk: 'a', aksi: 'toko' } })), 'lanjut');
});

test('new-ad target: past winner at its best target; never advertised at Shopee middle (≥ break-even); both capped; none → Auto', () => {
  const rek = { w: { rendah: 8, tengah: 10, tinggi: 11 }, n: { rendah: 5, tengah: 6, tinggi: 9 }, m: { rendah: 3, tengah: 4, tinggi: 8 } };
  const c = { dataIklan: { rekomendasiProduk: rek }, setelanProduk: () => ({}), formatRoas: (n) => n.toFixed(1).replace('.', ','),
    batasTargetShopee: (st) => (st.rekomendasi && st.rekomendasi.tinggi ? Math.floor(st.rekomendasi.tinggi * 1.25 * 10 + 1e-9) / 10 : null) };
  vm.runInNewContext(`${extract('targetPengganti')};${extract('modePengganti')};globalThis.t = targetPengganti; globalThis.m = modePengganti;`, c);
  assert.equal(c.m({ idProduk: 'w', targetTerbaik: 15, roasMinimum: 6 }), 'GMV Max ROAS, Target 13,7'); // 11 × 1.25
  assert.equal(c.m({ idProduk: 'x', targetTerbaik: 15, roasMinimum: 6 }), 'GMV Max ROAS, Target 15,0 (cek batas Shopee)');
  assert.equal(c.t({ idProduk: 'n', roasMinimum: 5.2 }).target, 6);    // Shopee middle above break-even
  assert.equal(c.t({ idProduk: 'm', roasMinimum: 5.21 }).target, 5.3); // break-even (rounded up) above Shopee middle
  assert.equal(c.m({ idProduk: 'y', roasMinimum: 5 }), 'GMV Max Auto (cek setelah 7–14 hari)'); // no recommendation yet
});
