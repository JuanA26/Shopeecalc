const { test } = require('node:test');
const assert = require('node:assert/strict');
const { saranIklan } = require('../public/saranIklan');

// Today 2026-09-27 → measured up to 20/09; last 4 weeks = 24/08–20/09, the 4 before = 27/07–23/08.
// Every product: price 100 rb, margin 25% (untung 25 rb per pcs) → at 80% paid, ROAS minimum 5.
function jual(id, tanggal, n, opsi = {}) {
  return Array.from({ length: n }, () => ({ idProduk: id, namaProduk: `HAPPY SHOP - Produk ${id}`, waktuPesanan: tanggal, jumlah: 1,
    hargaProduk: 100000, hpp: opsi.tanpaHpp ? null : 75000, untung: opsi.tanpaHpp ? null : 25000, dikembalikan: !!opsi.retur }));
}
function iklan(id, status, hari, biaya, omzetLangsung) {
  const perHari = {};
  for (let i = 0; i < hari; i++) perHari[`2026-09-${String(1 + i).padStart(2, '0')}`] = { biaya, omzetLangsung, omzet: omzetLangsung * 3 };
  return { kodeProduk: id, namaIklan: `Iklan ${id}`, status, perHari };
}

test('saran iklan: restart past winners, try organic sellers, replace losing running ads', () => {
  const items = [
    ...jual('menang', '2026-09-10', 6), ...jual('laris', '2026-09-05', 12), ...jual('rugi', '2026-09-05', 20),
    ...jual('sedikit', '2026-09-05', 5), ...jual('tipis', '2026-09-05', 12).map(it => ({ ...it, hpp: 90000, untung: 10000 })),
    ...jual('retur', '2026-09-05', 10), ...jual('retur', '2026-09-06', 2, { retur: true }), ...jual('tanpa-hpp', '2026-09-05', 12, { tanpaHpp: true }),
    ...jual('baru-diiklan', '2026-09-05', 12), ...jual('lama', '2026-07-01', 30),
  ];
  const kampanye = [
    iklan('menang', 'Selesai', 15, 40000, 400000),     // ROAS 10 vs minimum 5
    iklan('rugi', 'Berjalan', 15, 40000, 80000),       // ROAS 2: −24 rb/day
    iklan('baru-diiklan', 'Berjalan', 3, 40000, 80000),
    iklan('sepi', 'Selesai', 15, 40000, 400000),       // no sales in the window: not judged
    { kodeProduk: 'iklan-toko', tokoLevel: true, status: 'Berjalan', perHari: { '2026-09-01': { biaya: 99, omzetLangsung: 0 } } },
    { ...iklan('nanti', 'Berjalan', 0, 0, 0), perHari: { '2026-09-25': { biaya: 900000, omzetLangsung: 0 } } }, // after 20/09: ignored
  ];
  const s = saranIklan(items, kampanye, '2026-09-27', 0.8);
  assert.equal(s.sampai, '2026-09-20'); assert.equal(s.dari, '2026-07-27');
  assert.deepEqual(s.ulang.map(p => p.idProduk), ['menang']);
  assert.equal(Math.round(s.ulang[0].untungIklan), 15 * (400000 / 5 - 40000));
  assert.deepEqual(s.coba.map(p => p.idProduk), ['laris']);        // not: too few, thin margin, returns, no HPP, advertised, old sales
  assert.deepEqual(s.ganti.map(p => p.idProduk), ['rugi']);        // not: running only 3 days
  assert.equal(Math.round(s.ganti[0].untungIklan), 15 * (80000 / 5 - 40000));
  assert.equal(saranIklan(items, kampanye, '2026-09-27', 0).coba.length, 0);
});

test('a past winner restarts in ROAS mode at the target of its most profitable ROAS campaign', () => {
  const items = jual('menang', '2026-09-10', 6);
  const run = (target, hari, biaya, omzet, mulai) => {
    const perHari = {};
    for (let i = 0; i < hari; i++) perHari[`2026-08-${String(mulai + i).padStart(2, '0')}`] = { biaya, omzetLangsung: omzet, omzet: omzet * 3 };
    return { kodeProduk: 'menang', namaIklan: 'Iklan menang', status: 'Selesai', targetRoas: target, perHari };
  };
  // Minimum 5: target 12 made 10 × (300 rb/5 − 40 rb) = 200 rb; target 8 made 10 × (500 rb/5 − 40 rb) = 600 rb.
  // An Auto run (target 0) made the most but has no target to reuse.
  let s = saranIklan(items, [run(12, 10, 40000, 300000, 1), run(8, 10, 40000, 500000, 11), run(0, 5, 40000, 900000, 21)], '2026-09-27', 0.8);
  assert.equal(s.ulang[0].targetTerbaik, 8);
  s = saranIklan(items, [run(0, 10, 40000, 500000, 1)], '2026-09-27', 0.8);
  assert.equal(s.ulang[0].targetTerbaik, null); // only Auto before → Auto again
});

test('Ganti judges only mature spend from the running campaign, in both directions', () => {
  const items = jual('produk', '2026-09-10', 1); // minimum ROAS = 5
  const run = (status, month, days, spend, direct) => ({
    kodeProduk: 'produk', status, perHari: Object.fromEntries(Array.from({ length: days }, (_, i) =>
      [`2026-${month}-${String(i + 1).padStart(2, '0')}`, { biaya: spend, omzetLangsung: direct }])),
  });
  // Old losses must not make a profitable current campaign look replaceable.
  let s = saranIklan(items, [run('Berakhir', '08', 10, 50000, 0), run('Berjalan', '09', 15, 10000, 100000)], '2026-09-27', 0.8);
  assert.deepEqual(s.ganti, []);
  // Old gains must not hide a large current loss; the displayed loss/days come from that campaign.
  s = saranIklan(items, [run('Berakhir', '08', 10, 10000, 500000), run('Berjalan', '09', 15, 50000, 0)], '2026-09-27', 0.8);
  assert.equal(s.ganti.length, 1);
  assert.equal(s.ganti[0].untungIklan, -750000);
  assert.equal(s.ganti[0].hari, 15);
  // Even a large past loss cannot supply the current campaign's ten spending days.
  s = saranIklan(items, [run('Berakhir', '08', 10, 50000, 0), run('Berjalan', '09', 9, 50000, 0)], '2026-09-27', 0.8);
  assert.deepEqual(s.ganti, []);
});
