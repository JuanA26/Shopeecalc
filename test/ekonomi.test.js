const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hitungEkonomiProduk, untungLangsung } = require('../public/ekonomiProduk');
const { hitungAnalisisIklan } = require('../analisisIklan');
const { saranIklan } = require('../public/saranIklan');
const { untungIklanHarian } = require('../public/evaluasiIklan');

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const dasar = { hpp: 53000, income: { harga: 100000, rasio: 0.78, pcs: 10 }, tingkatCair: 0.73 };

test('shared economics retain product paid rates, zero, manual override and fallback provenance', () => {
  const e = hitungEkonomiProduk({ ...dasar, tingkatCairPerProduk: 0.6 });
  near(e.marginPerRp, 0.25); near(e.roasImpas, 1 / 0.15);
  near(untungLangsung(e, 600000, 100000), -10000);
  assert.equal(e.sumberTingkatCair, 'produk'); assert.equal(e.sumberRasio, 'produk');
  near(hitungEkonomiProduk(dasar).roasImpas, 1 / (0.25 * 0.73));
  const zero = hitungEkonomiProduk({ ...dasar, tingkatCairPerProduk: 0 });
  assert.equal(zero.tingkatCair, 0); assert.equal(zero.roasImpas, null);
  assert.equal(untungLangsung(zero, 600000, 100000), -100000);
  const manual = hitungEkonomiProduk({ ...dasar, tingkatCair: 0.9, sumberTingkatCair: 'pengaturan' });
  assert.equal(manual.tingkatCair, 0.9); assert.equal(manual.sumberTingkatCair, 'pengaturan');
  const fallback = hitungEkonomiProduk({ hpp: 50000, iklan: { omzetLangsung: 200000, terjualLangsung: 2 } });
  assert.equal(fallback.sumberHarga, 'langsung'); assert.equal(fallback.sumberRasio, 'default');
  assert.equal(fallback.tingkatCair, 0.85); assert.equal(fallback.sumberTingkatCair, 'default');
  const shop = hitungEkonomiProduk({ ...dasar, income: { harga: 500000, rasio: 0.95, pcs: 2 },
    iklan: { omzetLangsung: 200000, terjualLangsung: 2 }, rasioPencairan: 0.8, tingkatCairPerProduk: NaN });
  assert.equal(shop.hargaRata, 100000); assert.equal(shop.rasioPencairan, 0.8);
  assert.equal(shop.tingkatCair, 0.73); assert.equal(shop.sumberRasio, 'toko');
});

test('missing HPP/price and nonpositive margins never become advertising candidates', () => {
  for (const [input, reason] of [[{ ...dasar, hpp: null }, 'hpp'], [{ hpp: 10 }, 'harga'],
    [{ ...dasar, hpp: 78000 }, 'margin'], [{ ...dasar, hpp: 80000 }, 'margin'],
    [{ ...dasar, tingkatCairPerProduk: 0 }, 'tingkat-cair']]) {
    const e = hitungEkonomiProduk(input);
    assert.equal(e.roasImpas, null); assert.equal(e.alasan, reason);
    const s = saranIklan([{ idProduk: 'p', waktuPesanan: '2026-09-10', jumlah: 12 }], [], '2026-09-27', { p: e });
    assert.equal(s.coba.length, 0);
  }
  assert.equal(hitungEkonomiProduk({ ...dasar, hpp: 0 }).hpp, 0);
  assert.equal(untungLangsung(hitungEkonomiProduk({}), 100, 10), null);
});

function fixture(direct, paid = 0.6) {
  const perHari = Object.fromEntries(Array.from({ length: 15 }, (_, i) =>
    [`2026-09-${String(i + 1).padStart(2, '0')}`, { biaya: 40000, omzetLangsung: direct, omzet: direct * 3 }]));
  const k = { kodeProduk: 'p', status: 'Berjalan', namaIklan: 'Fixture', tanggalMulaiIso: '2026-09-01',
    biaya: 600000, omzetLangsung: direct * 15, omzet: direct * 45, terjualLangsung: direct * 15 / 100000,
    terjual: direct * 45 / 100000, klik: 10, dilihat: 100, perHari };
  const items = ['p', 'organic', 'no-hpp'].map(idProduk => ({ idProduk, waktuPesanan: '2026-09-10', jumlah: 12 }));
  const hpp = new Map([['p', { hpp: 53000 }], ['organic', { hpp: 53000 }]]);
  const income = Object.fromEntries(items.map(p => [p.idProduk, dasar.income]));
  const analysis = hitungAnalisisIklan([k], hpp, 0.78, income,
    { tanggalLaporanIso: '2026-09-27', tingkatCair: 0.73, tingkatCairPerProduk: { p: paid, organic: paid } });
  return { analysis, items, saran: saranIklan(items, analysis.kampanye, '2026-09-27', analysis.ekonomiProduk) };
}

test('verdict, Ganti and change evaluation agree for identical campaign data; organic candidates share economics', () => {
  const { analysis: a, saran: s } = fixture(140000);
  assert.equal(s.ganti.length, 1); // ROAS 3.5 < 60% of 6.67; the old shop rate missed this loss.
  near(s.ganti[0].roasMinimum, a.produk[0].roasImpas);
  near(s.ganti[0].untungIklan, a.produk[0].untungLangsung);
  near(s.ganti[0].untungIklan, -285000);
  const daily = untungIklanHarian(a.kampanye[0], '2026-09-01', '2026-09-07', a.produk[0].roasImpas);
  near(daily.langsung, -19000);
  assert.deepEqual(s.coba.map(p => p.idProduk), ['organic']);
  near(s.coba[0].roasMinimum, a.produk[0].roasImpas);
  assert.equal(a.ekonomiProduk['no-hpp'].alasan, 'hpp');
  assert.deepEqual(saranIklan([], [], '2026-09-27'), { dari: '2026-07-27', sampai: '2026-09-20', ulang: [], coba: [], ganti: [] });
});

test('a repeat candidate cannot qualify using a different paid rate from its verdict', () => {
  const { analysis: a, items } = fixture(280000); // ROAS 7: clears 1.2 × 5.48 but not 1.2 × 6.67.
  a.kampanye[0].status = 'Selesai';
  const s = saranIklan(items, a.kampanye, '2026-09-27', a.ekonomiProduk);
  assert.equal(s.ulang.length, 0);
  const e = { ...a.ekonomiProduk, p: hitungEkonomiProduk(dasar) };
  assert.equal(saranIklan(items, a.kampanye, '2026-09-27', e).ulang.length, 1);
});

test('browser selection consumes response economics and HPP recalculation replaces the shared values', () => {
  const { analysis, items } = fixture(140000);
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const fn = source.match(/function saranIklanSekarang\(\) \{[\s\S]*?\n\}/)[0];
  const ctx = vm.createContext({ dataIklan: analysis, SaranIklan: { saranIklan }, sumberIklan: () => ({ items }),
    dariApi: () => true, hariIniWib: () => '2026-09-27' });
  const s = vm.runInContext(fn + '\nsaranIklanSekarang()', ctx);
  near(s.ganti[0].roasMinimum, analysis.produk[0].roasImpas);
  const updated = hitungAnalisisIklan(analysis.kampanye, new Map([['p', { hpp: 63000 }]]), 0.78,
    { p: dasar.income }, { tingkatCair: 0.73, tingkatCairPerProduk: { p: 0.6 }, tanggalLaporanIso: '2026-09-27' });
  ctx.dataIklan = updated;
  const next = vm.runInContext('saranIklanSekarang()', ctx);
  near(next.ganti[0].roasMinimum, 1 / (0.15 * 0.6));
  near(next.ganti[0].roasMinimum, updated.produk[0].roasImpas);
  assert.notEqual(next.ganti[0].roasMinimum, s.ganti[0].roasMinimum);
});
