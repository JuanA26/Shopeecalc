const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { hitungAnalisisIklan } = require('../analisisIklan');
const { tingkatCairTerukur, susunBarisPesanan } = require('../sinkronShopee');

const campaign = (extra = {}) => ({
  kodeProduk: 'p', namaIklan: 'Fixture', status: 'Berjalan',
  tanggalMulaiIso: '2026-09-01', tanggalSelesaiIso: '', modeBidding: 'GMV Max ROAS',
  dilihat: 100, klik: 10, terjual: 10, terjualLangsung: 10,
  omzet: 1000000, omzetLangsung: 1000000, biaya: 100000, ...extra,
});
const analyze = (k, options = {}) => hitungAnalisisIklan([k], new Map([['p', { hpp: 50000 }]]),
  0.78, { p: { harga: 100000, rasio: 0.78, pcs: 10 } },
  { tanggalLaporanIso: '2026-09-25', tingkatCair: 0.75, ...options });

test('profit, paid rate and break-even agree with a hand calculation', () => {
  const p = analyze(campaign()).produk[0];
  assert.equal(p.marginPerRp, 0.28);
  assert.ok(Math.abs(p.roasImpas - 1 / 0.21) < 1e-12);
  assert.ok(Math.abs(p.untungLangsung - 110000) < 1e-8);
  const atBreakEven = analyze(campaign({ biaya: 210000 })).produk[0];
  assert.ok(Math.abs(atBreakEven.untungLangsung) < 1e-8);
});

test('new zero-activity campaigns remain visible and wait for data', () => {
  const result = analyze(campaign({ biaya: 0, omzet: 0, omzetLangsung: 0,
    terjual: 0, terjualLangsung: 0, tanggalMulaiIso: '2026-09-24' }));
  assert.equal(result.produk.length, 1);
  assert.equal(result.produk[0].aksi, 'tunggu');
  assert.equal(analyze(campaign({ biaya: 0, omzet: 0, omzetLangsung: 0,
    terjual: 0, terjualLangsung: 0 })).produk[0].aksi, 'tunggu');
  // Ended campaigns with sales but no spend in the window are not "waiting".
  assert.notEqual(analyze(campaign({ status: 'Berakhir', biaya: 0 })).produk[0].aksi, 'tunggu');
});

test('a measured zero paid rate never falls back to 85% or emits Infinity', () => {
  for (const options of [{ tingkatCair: 0 }, { tingkatCairPerProduk: { p: 0 } }]) {
    const p = analyze(campaign(), options).produk[0];
    assert.equal(p.tingkatCair, 0);
    assert.equal(p.untungLangsung, -100000);
    assert.equal(p.roasImpas, null);
    assert.equal(p.aksi, 'jeda');
  }
});

test('partial returns subtract units once across multiple variants of a product', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE api_order(order_sn TEXT, shop_id TEXT, tanggal_pesanan TEXT, status TEXT);
      CREATE TABLE api_order_item(order_sn TEXT, id_produk TEXT, jumlah INTEGER);
      CREATE TABLE api_pesanan_item(order_sn TEXT, id_produk TEXT, jumlah INTEGER, dikembalikan INTEGER);
      INSERT INTO api_order VALUES ('one','shop','2026-08-01','COMPLETED'),
        ('two','shop','2026-08-02','CANCELLED'), ('other','another-shop','2026-08-01','COMPLETED');
      INSERT INTO api_order_item VALUES ('one','p',60),('one','p',40),('two','p',20),('other','p',1000);
      INSERT INTO api_pesanan_item VALUES ('one','p',10,1),('one','p',90,0);`);
    const r = tingkatCairTerukur(db, 'shop', '2026-09-25');
    assert.equal(r.pcsDibuat, 120);
    assert.equal(r.pcsDibayar, 90);
    assert.equal(r.toko, 0.75);
    assert.equal(r.perProduk.p, 0.75);
    db.exec("UPDATE api_pesanan_item SET jumlah=200 WHERE dikembalikan=1");
    assert.equal(tingkatCairTerukur(db, 'shop', '2026-09-25').toko, 0);
  } finally { db.close(); }
});

// Load existing pure functions without starting Express, accessing credentials or a disk DB.
function sourceFunction(file, name) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

test('ad-only weeks retain spending without inventing profit, and gaps prevent comparisons', () => {
  const dates = `const tambahHari=(iso,n)=>{const d=new Date(iso+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};`;
  const context = {
    sumberIklan: () => ({ items: [] }),
    dataIklan: { kampanye: [{ perHari: { '2026-08-10': { biaya: 100000, terjual: 0 } } }],
      rentangData: { dari: '2026-08-03', sampai: '2026-08-16' } },
    seninIso: iso => iso, hariIniWib: () => '2026-09-25', tanggalDataMulaiSaatIni: () => '2026-08-03', JEDA_LENGKAP_HARI: 7,
    escapeHtml: s => s, formatRupiahRingkas: n => `Rp ${n}`, labelMinggu: iso => iso,
  };
  const result = vm.runInNewContext(`${dates}${sourceFunction('public/app.js','untungTokoPerMinggu')};untungTokoPerMinggu()`, context);
  assert.equal(result.minggu.length, 1);
  assert.equal(result.minggu[0].biayaIklan, 100000);
  assert.equal(result.minggu[0].untungSetelahIklan, null);
  assert.equal(result.minggu[0].lengkap, false);
  const svg = vm.runInNewContext(`(${sourceFunction('public/app.js','grafikMingguanSvg')})(weeks)`, { ...context, weeks: result.minggu });
  assert.match(svg, /batang-iklan/); assert.match(svg, />\?<\/text>/); assert.doesNotMatch(svg, /NaN|batang-rugi/);
  const weeks = ['2026-07-06','2026-07-13','2026-07-27','2026-08-03'].map(mulai => ({ mulai, lengkap:true, iklanLengkap:true, biayaIklan:100, untungSetelahIklan:100 }));
  const rule = vm.runInNewContext(`${dates}${sourceFunction('public/app.js','aturanMingguan')};aturanMingguan({minggu:weeks})`, { weeks });
  assert.equal(rule.kelas, ''); assert.match(rule.teks, /belum lengkap/);
});

test('payout allocation conserves money, including a full-return deduction', () => {
  const rows = susunBarisPesanan({ order_income: { escrow_amount: -12000,
    items: [{ item_id: 1, quantity_purchased: 2, discounted_price: 200000 }] } },
  [{ status: 'ACCEPTED', refund_amount: 200000, item: [{ item_id: 1, amount: 2 }] }]);
  assert.equal(rows.reduce((sum, r) => sum + r.totalPenghasilan, 0), -12000);
  assert.equal(rows[0].dikembalikan, true);
  const calc = vm.runInNewContext(`(${sourceFunction('server.js', 'hitungMargin')})`, {
    db: { prepare: () => ({ all: () => [{ id_produk: 'sale', hpp: 50000 }] }) },
  });
  const result = calc([...rows, { idProduk: 'sale', noPesanan: 'paid', jumlah: 2,
    hargaProduk: 200000, totalPenghasilan: 156000, dikembalikan: false }]);
  assert.equal(result.ringkasan.totalUntung, 44000);
  assert.equal(result.items[0].untung, -12000);
});

test('daily and weekly charts include return costs without counting returned units as sales', () => {
  const items = [{ idProduk: 'p', waktuPesanan: '2026-08-03', dikembalikan: true,
    totalPenghasilan: -12000, untung: -12000, hpp: null, jumlah: 2, hargaProduk: 200000 }];
  const dates = `const tambahHari = (iso,n) => { const d=new Date(iso+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); };`;
  const context = {
    dataHasilUpload: { items, ringkasan: { periode: { dari: '2026-08-03', sampai: '2026-08-03' } } },
    METRIK_TREN: { untung: {}, omzet: {}, pcs: {}, pesanan: {} },
    sumberIklan: () => ({ items }), dataIklan: null, JEDA_LENGKAP_HARI: 7,
    seninIso: () => '2026-08-03', hariIniWib: () => '2026-09-25', tanggalDataMulaiSaatIni: () => '2026-08-03',
  };
  const daily = vm.runInNewContext(`${dates}\n${sourceFunction('public/app.js', 'dataTrenHarian')}\ndataTrenHarian()`, context);
  assert.equal(daily[0].untung, -12000);
  assert.equal(daily[0].pcs, 0);
  const weekly = vm.runInNewContext(`${dates}\n${sourceFunction('public/app.js', 'untungTokoPerMinggu')}\nuntungTokoPerMinggu()`, { ...context });
  assert.equal(weekly.minggu[0].untungSetelahIklan, -12000);
  assert.equal(weekly.minggu[0].pcs, 0);
  items.push({ waktuPesanan: '2026-08-03', dikembalikan: false,
    totalPenghasilan: 100000, untung: null, hpp: null, jumlah: 1 });
  const missingHpp = vm.runInNewContext(`${dates}\n${sourceFunction('public/app.js', 'untungTokoPerMinggu')}\nuntungTokoPerMinggu()`, { ...context });
  assert.equal(missingHpp.minggu[0].untungKotor, -12000, 'return balances must not imply a 100% margin for missing HPP');
});

test('profit zones: direct above break-even, only broad above it, both below, price below cost', () => {
  // Break-even = 1 / 0.21 ≈ 4.76 (see the hand calculation above).
  assert.equal(analyze(campaign()).produk[0].aksi, 'untung');
  assert.equal(analyze(campaign({ omzetLangsung: 300000, omzet: 900000 })).produk[0].aksi, 'abu');
  assert.equal(analyze(campaign({ omzetLangsung: 300000, omzet: 400000 })).produk[0].aksi, 'rugi');
  const belowCost = hitungAnalisisIklan([campaign()], new Map([['p', { hpp: 90000 }]]), 0.78,
    { p: { harga: 100000, rasio: 0.78, pcs: 10 } }, { tanggalLaporanIso: '2026-09-25', tingkatCair: 0.75 });
  assert.equal(belowCost.produk[0].aksi, 'jeda');
});

test('running-ad ladder: target cap, budget steps on mature days, and attribution wait', () => {
  const src = ['keputusanBerjalan', 'harianProduk', 'pemakaianModal'].map((n) => sourceFunction('public/app.js', n)).join('\n');
  const run = (produk, setelan, { aturan = null, perHari = null } = {}) => vm.runInNewContext(`${src};keputusanBerjalan()`, {
    dataIklan: { sumber: 'api', produk: [{ idProduk: 'p', sedangBerjalan: 1, biaya: 1, targetDisarankan: 7, berjalan: { roasShopee: 9 }, ...produk }],
      kampanye: [{ kodeProduk: 'p', status: 'Berjalan', perHari: perHari || {} }], setelanApi: { p: setelan } },
    aturanTerakhir: aturan, hariIniWib: () => '2026-10-10',
    geserHari: (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); },
    bulatkanModal: (rp) => Math.max(0, Math.round(rp / 5000) * 5000), bulatkanTargetBawah: (n) => Math.floor(n * 10 + 1e-9) / 10,
    LANGKAH_TARGET: 1.2, LANGKAH_MODAL: 1.2, MODAL_HABIS: 0.9, HARI_TUNGGU_UBAH: 15,
    batasTargetShopee: (st) => (st.rekomendasi ? Math.floor(st.rekomendasi.tinggi * 1.25 * 10 + 1e-9) / 10 : null),
    metrikBerjalan: (p) => p.berjalan || p, dariApi: () => true, setelanProduk: () => setelan, berakhirSegera: () => null,
  }).baris[0];
  const rek = (tinggi) => ({ rendah: 8, tengah: 10, tinggi });
  // Losing ad (like blouse V14): 11 × 1.2 = 13.2 would pass the cap 10.2 × 1.25 = 12.7.
  let b = run({ aksi: 'rugi' }, { target_roas: 11, modal_harian: 55000, rekomendasi: rek(10.2) });
  assert.equal(b.keputusan, 'naikkan'); assert.equal(b.targetBaru, 12.7); assert.equal(b.alasan, 'ke-batas');
  // Already above the cap: a losing ad gets less budget (a lower target would spend more);
  // a maybe-profitable ad steps down at most 20% towards the cap.
  b = run({ aksi: 'rugi' }, { target_roas: 13, modal_harian: 55000, rekomendasi: rek(10.2) });
  assert.equal(b.keputusan, 'kurangi'); assert.equal(b.alasan, 'di-atas-batas');
  b = run({ aksi: 'abu' }, { target_roas: 11, modal_harian: 55000, rekomendasi: rek(5) });
  assert.equal(b.keputusan, 'turunkan'); assert.equal(b.targetBaru, 9.2);
  b = run({ aksi: 'abu' }, { target_roas: 13, modal_harian: 55000, rekomendasi: rek(10.2) });
  assert.equal(b.keputusan, 'turunkan'); assert.equal(b.targetBaru, 12.7);
  b = run({ aksi: 'rugi' }, { target_roas: 12.7, modal_harian: 55000, rekomendasi: rek(10.2) });
  assert.equal(b.keputusan, 'kurangi'); assert.equal(b.modalBaru, 30000);
  b = run({ aksi: 'abu' }, { target_roas: 12.7, modal_harian: 55000, rekomendasi: rek(10.2) });
  assert.equal(b.keputusan, 'lanjut'); assert.equal(b.alasan, 'di-batas');
  b = run({ aksi: 'abu' }, { target_roas: 9, modal_harian: 60000, rekomendasi: rek(13.5) });
  assert.equal(b.keputusan, 'naikkan'); assert.equal(b.targetBaru, 10.8);
  // Profitable ad that spends ≥ 90% of its budget: +20% budget, unless store profit is falling.
  const penuh = {}; for (let i = 8; i <= 14; i++) {
    const d = new Date('2026-10-10T00:00:00Z'); d.setUTCDate(d.getUTCDate() - i);
    penuh[d.toISOString().slice(0, 10)] = { biaya: 57000 };
  }
  b = run({ aksi: 'untung' }, { target_roas: 9, modal_harian: 60000 }, { perHari: penuh });
  assert.equal(b.keputusan, 'tambah'); assert.equal(b.modalBaru, 70000);
  b = run({ aksi: 'untung' }, { target_roas: 9, modal_harian: 60000 }, { perHari: penuh, aturan: { kelas: 'aturan-kurangi' } });
  assert.equal(b.keputusan, 'lanjut'); assert.equal(b.alasan, 'toko-turun');
  // Exclude change day, collect seven days, then allow seven full days for attribution.
  b = run({ aksi: 'rugi' }, { target_roas: 9, modal_harian: 60000, perubahan: { tanggal: '2026-10-07' } });
  assert.equal(b.keputusan, 'tunggu'); assert.equal(b.bisaDiubahLagi, '2026-10-22');
});
