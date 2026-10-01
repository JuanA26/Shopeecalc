const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const E = require('../public/evaluasiIklan');
const { hitungAnalisisIklan } = require('../analisisIklan');
const change = { campaignId: '1', idProduk: 'p', tanggal: '2026-09-15', targetLama: 9, targetBaru: 10.8, modalLama: 60000, modalBaru: 60000 };
function fixture(afterProfit = 80000) {
  const data = { dataSiapEvaluasi: true, riwayatSetelan: [{ ...change }], biayaTokoHarian: {} };
  const sumber = { ringkasan: { periode: { dari: '2026-09-01', sampai: '2026-10-01' } }, items: [] };
  for (let i = 1; i <= 30; i++) {
    const d = `2026-09-${String(i).padStart(2, '0')}`;
    data.biayaTokoHarian[d] = 20000;
    sumber.items.push({ idProduk: 'other-product', waktuPesanan: d, totalPenghasilan: 200000, hpp: 50000, untung: i <= 15 ? 120000 : afterProfit });
  }
  return { data, sumber };
}
const row = (id = 'p') => ({ p: { idProduk: id }, keputusan: 'naikkan', alasan: '', target: 10.8, targetBaru: 12.9, modal: 60000, modalBaru: 60000 });
function extract(name) {
  const s = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const i = s.indexOf(`function ${name}(`); assert.ok(i >= 0);
  return s.slice(i, s.indexOf('\n}', i) + 2);
}

test('recent profit replaces old losses in the API verdict; recent losses replace old gains', () => {
  function analyze(oldGmv, recentGmv) {
    const perHari = {}; let omzet = 0;
    for (let i = 1; i <= 30; i++) {
      const gmv = i >= 16 && i <= 22 ? recentGmv : oldGmv;
      perHari[`2026-09-${String(i).padStart(2, '0')}`] = { biaya: 100000, omzet: gmv, omzetLangsung: gmv }; omzet += gmv;
    }
    const k = { kodeProduk: 'p', namaIklan: 'Fixture', status: 'Berjalan', tanggalMulaiIso: '2026-09-01', tanggalSelesaiIso: '',
      modeBidding: 'GMV Max ROAS', dilihat: 100, klik: 10, terjual: 100, terjualLangsung: 100, biaya: 3000000, omzet, omzetLangsung: omzet, perHari };
    return hitungAnalisisIklan([k], new Map([['p', { hpp: 50000 }]]), 0.78, { p: { harga: 100000, rasio: 0.78, pcs: 100 } },
      { tanggalLaporanIso: '2026-09-30', tingkatCair: 0.75, setelanApi: { p: { perubahan: change } } }).produk[0];
  }
  const improved = analyze(200000, 1000000);
  assert.ok(improved.berjalan.untungLangsung < 0);
  assert.equal(improved.aksi, 'untung');
  assert.ok(Math.abs(improved.penilaian.untungLangsung - 770000) < 0.001);
  const worsened = analyze(1000000, 200000);
  assert.ok(worsened.berjalan.untungLangsung > 0);
  assert.equal(worsened.aksi, 'rugi');
});

test('daily evidence distinguishes missing days from explicit zeros and excludes immature days', () => {
  const k = { kodeProduk: 'p', status: 'Berjalan', tanggalMulaiIso: '2026-09-01', perHari: {} };
  assert.equal(E.metrikTerbaru([k], 'p', change, '2026-09-29').alasan, 'waktu');
  assert.equal(E.metrikTerbaru([k], 'p', change, '2026-09-30').alasan, 'data');
  for (let i = 16; i <= 22; i++) k.perHari[`2026-09-${i}`] = { biaya: 0, omzet: 0, omzetLangsung: 0 };
  k.perHari['2026-09-29'] = { biaya: 1000000, omzet: 0, omzetLangsung: 0 };
  const m = E.metrikTerbaru([k], 'p', change, '2026-09-30');
  assert.equal(m.siap, true); assert.equal(m.biaya, 0);
  delete k.perHari['2026-09-19']; assert.equal(E.metrikTerbaru([k], 'p', change, '2026-09-30').siap, false);
});

// The changed ad (campaign 1, product p): 40 rb spend a day, ROAS minimum 6.
// Days 1–15 before the change on 15/09, days 16–30 after. omzet = Shopee-credited sales.
function iklan(data, sebelum, sesudah) {
  const perHari = {};
  for (let i = 1; i <= 30; i++) {
    const [langsung, shopee] = i <= 15 ? sebelum : sesudah;
    perHari[`2026-09-${String(i).padStart(2, '0')}`] = { biaya: 40000, omzetLangsung: langsung, omzet: shopee };
  }
  data.kampanye = [{ campaignId: '1', kodeProduk: 'p', status: 'Berjalan', perHari }];
  return data;
}
const SEBELUM = [300000, 600000]; // langsung 10 rb/day, Shopee 60 rb/day
const BURUK = [120000, 240000];   // −30 rb and −60 rb
const BAIK = [480000, 960000];    // +30 rb and +60 rb
const KECIL = [330000, 660000];   // +5 rb and +10 rb: noise
const rowP = (extra = {}) => ({ ...row(), p: { idProduk: 'p', roasImpas: 6 }, ...extra });
const rowQ = () => ({ ...row('q'), p: { idProduk: 'q', roasImpas: 6 } });

test('store profit of the latest 7 mature days: incl. other products and returns; needs complete data', () => {
  const { sumber, data } = fixture();
  const toko = () => E.rincianUntungToko(sumber, data.biayaTokoHarian, '2026-09-16', '2026-09-22');
  assert.equal(toko().nilai, 60000);
  sumber.items.push({ waktuPesanan: '2026-09-16', dikembalikan: true, totalPenghasilan: -7000 });
  assert.equal(toko().nilai, 59000);
  sumber.items[15].hpp = null; sumber.items[15].untung = null; assert.equal(toko().alasan, 'hpp');
  sumber.items[15].hpp = 50000; sumber.items[15].untung = 80000; delete data.biayaTokoHarian['2026-09-18'];
  assert.equal(toko().alasan, 'hari');
  data.biayaTokoHarian['2026-09-18'] = 20000;
  sumber.items = sumber.items.filter(i => i.waktuPesanan !== '2026-09-18');
  assert.equal(toko().alasan, 'hari');
});

test('per-ad before/after judge leaves out busy store days in either week', () => {
  const { data } = fixture();
  iklan(data, SEBELUM, SEBELUM); // flat: 10 rb/day direct before and after the change on 15/09
  data.kampanye[0].perHari['2026-09-13'].omzetLangsung += 1000000; // 9.9-style spike in the week before
  assert.equal(E.hasilIklan(data, 'p', '2026-09-30', 6).status, 'buruk'); // without store data: looks worse
  data.penghasilanHarian = {};
  for (let i = 1; i <= 30; i++) data.penghasilanHarian[`2026-09-${String(i).padStart(2, '0')}`] = 200000;
  data.penghasilanHarian['2026-09-13'] = 1000000;
  assert.deepEqual([...E.hariRamai(data.penghasilanHarian, '2026-09-08', '2026-09-22')], ['2026-09-13']);
  const h = E.hasilIklan(data, 'p', '2026-09-30', 6);
  assert.equal(h.status, 'belum-jelas'); assert.equal(h.bedaLangsung, 0); assert.equal(h.sebelum.hari, 6);
  assert.equal(h.ramai.join(), '2026-09-13');
  // A real change on ordinary days is still judged.
  iklan(data, SEBELUM, BURUK); assert.equal(E.hasilIklan(data, 'p', '2026-09-30', 6).status, 'buruk');
  // Fewer than 4 ordinary days in a week: the busy stretch is the norm, so all 7 days are compared.
  for (const d of ['2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20']) data.penghasilanHarian[d] = 1000000;
  const semua = E.hasilIklan(data, 'p', '2026-09-30', 6);
  assert.equal(semua.ramai.length, 0); assert.equal(semua.sebelum.hari, 7);
});

test('each change is judged by its own direct contribution; Shopee broad movement is context', () => {
  const { data } = fixture();
  iklan(data, SEBELUM, BURUK);
  assert.equal(E.hasilIklan(data, 'p', '2026-09-29', 6).status, 'tunggu');
  const h = E.hasilIklan(data, 'p', '2026-09-30', 6);
  assert.equal(h.status, 'buruk'); assert.equal(h.bedaLangsung, -30000); assert.equal(h.bedaShopee, -60000);
  assert.equal(E.hasilIklan(iklan(data, SEBELUM, BAIK), 'p', '2026-09-30', 6).status, 'baik');
  assert.equal(E.hasilIklan(iklan(data, SEBELUM, KECIL), 'p', '2026-09-30', 6).status, 'belum-jelas');
  // Direct up 25 rb despite a broad decline: keep the directly observed improvement.
  assert.equal(E.hasilIklan(iklan(data, [300000, 1200000], [450000, 600000]), 'p', '2026-09-30', 6).status, 'baik');
  // A broad decline alone must not reverse a setting change.
  let broadOnly = E.hasilIklan(iklan(data, [300000, 1200000], [300000, 600000]), 'p', '2026-09-30', 6);
  assert.equal(broadOnly.status, 'belum-jelas'); assert.equal(broadOnly.bedaLangsung, 0); assert.equal(broadOnly.bedaShopee, -100000);
  const held = rowP(); E.terapkanEvaluasiToko([held], data, true, '2026-09-30');
  assert.equal(held.keputusan, 'lanjut'); assert.equal(held.alasan, 'belum-jelas');
  // A direct decline still triggers rollback even when broad attribution improves.
  broadOnly = E.hasilIklan(iklan(data, [300000, 600000], [120000, 1200000]), 'p', '2026-09-30', 6);
  assert.equal(broadOnly.status, 'buruk');
  iklan(data, SEBELUM, BURUK); delete data.kampanye[0].perHari['2026-09-19'];
  assert.equal(E.hasilIklan(data, 'p', '2026-09-30', 6).status, 'data');
  iklan(data, SEBELUM, BURUK); data.riwayatSetelan.unshift({ ...change, tanggal: '2026-09-10' });
  assert.equal(E.hasilIklan(data, 'p', '2026-09-30', 6).status, 'campur');
});

test('a worse ad is reversed even when store profit is flat; a store drop alone reverses nothing', () => {
  const { data, sumber } = fixture(120000);
  iklan(data, SEBELUM, BURUK);
  const rows = [rowP(), rowQ()];
  E.terapkanEvaluasiToko(rows, data, true, '2026-09-30');
  assert.equal(rows[0].keputusan, 'kembalikan'); assert.equal(rows[0].targetBaru, 9); assert.equal(rows[0].modalBaru, 60000);
  assert.equal(rows[1].keputusan, 'naikkan'); // a reversal no longer holds other ads
  const lagi = fixture(80000); iklan(lagi.data, SEBELUM, KECIL);
  const tetap = rowP({ keputusan: 'lanjut', targetBaru: null });
  E.terapkanEvaluasiToko([tetap], lagi.data, true, '2026-09-30');
  assert.equal(tetap.keputusan, 'lanjut'); assert.equal(tetap.alasan, 'belum-jelas');
  const pause = { ...row('unsafe'), keputusan: 'jeda', modalBaru: 0 };
  E.terapkanEvaluasiToko([pause], data, false, '2026-09-29');
  assert.equal(pause.keputusan, 'jeda');
});

test('an unclear raise is not repeated; a good result lets the steps continue; several ads may change at once', () => {
  const { data, sumber } = fixture(120000);
  iklan(data, SEBELUM, KECIL);
  let rows = [rowP(), rowQ()];
  E.terapkanEvaluasiToko(rows, data, true, '2026-09-30');
  assert.equal(rows[0].keputusan, 'lanjut'); assert.equal(rows[0].alasan, 'belum-jelas'); assert.equal(rows[0].targetBaru, null);
  assert.equal(rows[1].keputusan, 'naikkan');
  // Still blocked after the 28-day result window: no clear gain was ever shown.
  rows = [rowP()]; E.terapkanEvaluasiToko(rows, data, true, '2026-11-01');
  assert.equal(rows[0].keputusan, 'lanjut');
  iklan(data, SEBELUM, BAIK);
  rows = [rowP(), rowQ(), { ...row('r'), p: { idProduk: 'r', roasImpas: 6 } }];
  E.terapkanEvaluasiToko(rows, data, true, '2026-09-30');
  assert.ok(rows.every(b => b.keputusan === 'naikkan'));
});

test('growth step (lower target): unclear → stop lowering; worse → back up; good → may lower again (user, 01/10)', () => {
  const { data } = fixture();
  data.riwayatSetelan = [{ ...change, targetLama: 13, targetBaru: 11.1 }];
  const tumbuh = () => ({ ...rowP(), keputusan: 'tumbuh', target: 11.1, targetBaru: 9.5 });
  iklan(data, SEBELUM, KECIL);
  let b = tumbuh(); E.terapkanEvaluasiToko([b], data, true, '2026-09-30');
  assert.equal(b.keputusan, 'lanjut'); assert.equal(b.alasan, 'belum-jelas-turun'); assert.equal(b.targetBaru, null);
  iklan(data, SEBELUM, BURUK);
  b = tumbuh(); E.terapkanEvaluasiToko([b], data, true, '2026-09-30');
  assert.equal(b.keputusan, 'kembalikan'); assert.equal(b.targetBaru, 13); // 11.1 × 1.2 = 13.3, capped at the old 13
  iklan(data, SEBELUM, BAIK);
  b = tumbuh(); E.terapkanEvaluasiToko([b], data, true, '2026-09-30');
  assert.equal(b.keputusan, 'tumbuh'); assert.equal(b.targetBaru, 9.5);
  // Incomplete data holds a growth step like any other change.
  b = tumbuh(); E.terapkanEvaluasiToko([b], data, false, '2026-09-30');
  assert.equal(b.keputusan, 'tunggu'); assert.equal(b.ditahan, 'tumbuh');
});

test('budget-only changes reverse the budget; a large store drop holds nothing (brake removed 30/09)', () => {
  const { data } = fixture(-580000); // store after ads: 100 rb → −600 rb a day
  data.riwayatSetelan = [{ ...change, targetLama: 10.8, targetBaru: 10.8, modalLama: 50000, modalBaru: 60000 }];
  iklan(data, SEBELUM, BURUK);
  const rows = [rowP(), rowQ()];
  E.terapkanEvaluasiToko(rows, data, true, '2026-09-30');
  assert.equal(rows[0].keputusan, 'kembalikan'); assert.equal(rows[0].modalBaru, 50000); assert.equal(rows[0].targetBaru, null);
  assert.equal(rows[1].keputusan, 'naikkan'); assert.equal(rows[1].alasan, '');
  // Incomplete data still holds new changes.
  const tahan = [rowQ()]; E.terapkanEvaluasiToko(tahan, data, false, '2026-09-30');
  assert.equal(tahan[0].alasan, 'data-toko');
});

test('a pending change on one ad does not hold others; mixed trials are reviewed; rollback does not loop', () => {
  const { data, sumber } = fixture();
  iklan(data, SEBELUM, BURUK);
  const rows = [rowP(), rowQ()];
  E.terapkanEvaluasiToko(rows, data, true, '2026-09-29');
  assert.equal(rows[1].keputusan, 'naikkan'); assert.equal(rows[1].alasan, ''); // q was not changed: not held
  data.riwayatSetelan[0].modalBaru = 70000;
  const mixed = rowP(); E.terapkanEvaluasiToko([mixed], data, true, '2026-09-30');
  assert.equal(mixed.keputusan, 'tinjau'); assert.equal(mixed.alasan, 'tinjau-iklan');
  data.riwayatSetelan = [{ ...change }, { ...change, tanggal: '2026-09-30', targetLama: 10.8, targetBaru: 9 }];
  const repeat = row(); E.terapkanEvaluasiToko([repeat], data, true);
  assert.equal(repeat.alasan, 'sudah-kembali'); assert.equal(repeat.targetBaru, null);
});

test('dashboard shows numbered simple steps: HPP first, then extend period; no per-ad list', () => {
  for (const decision of ['lanjut', 'tunggu']) {
    const nodes = {}, b = { ...row(), keputusan: decision, p: { idProduk: 'p', namaProduk: 'Sample product' }, berakhir: '2026-10-02' };
    const hpp = { ...row('h'), keputusan: 'isi-hpp', p: { idProduk: 'h', namaProduk: 'No cost product' } };
    const { data, sumber } = fixture(); data.dataSiapEvaluasi = false;
    const dataBelumLengkap = { dasar: { alasan: 'hpp', produkTanpaHpp: [{ namaProduk: 'Best seller without HPP' }] }, sinkron: null };
    vm.runInNewContext(extract('renderTugas') + ';renderTugas()', {
      document: { getElementById: id => nodes[id] || (nodes[id] = { removeAttribute() {} }) }, hariIniWib: () => '2026-09-30', formatTanggalPendek: s => s,
      untungTokoPerMinggu: () => null, untungTokoPerBulan: () => null, dataIklan: data, sumberIklan: () => sumber,
      keputusanBerjalan: () => ({ baris: [b, hpp], dataBelumLengkap }), PERLU_TINDAKAN: new Set(['isi-hpp']), namaSingkat: s => s, namaRapi: s => s, escapeHtml: s => s,
      tanggalSingkat: s => s, kalimatKeputusan: () => 'Tetap dulu.', EvaluasiIklan: E, labelKeputusan: () => ['', 'pill-abu'], alasanTugas: () => '', akunBacaSaja: false,
      formatRupiahRingkas: n => String(n), renderSaranIklan: () => {}, langkahStok: () => [],
    });
    const html = nodes.tugasDaftar.innerHTML;
    assert.ok(html.indexOf('Isi HPP') < html.indexOf('Tidak Terbatas'));
    assert.match(html, /No cost product/); assert.match(html, /Best seller without HPP/); assert.match(html, /data-ke-hpp/);
    // A price box per product (saved on the Dashboard itself), keyed by product ID.
    assert.match(html, /data-hpp-id="h"/); assert.equal((html.match(/data-simpan-hpp/g) || []).length, 2);
    assert.match(html, /sebelum 2026-10-02/);
    assert.match(nodes.tugasLain.innerHTML, /jangan diubah/); assert.doesNotMatch(nodes.tugasLain.innerHTML, /Sample product/);
    assert.equal(nodes.tugasHasil.innerHTML, '');
  }
});

test('Dashboard stock steps: buy the products that run out, lower prices of active unsold products only; max 3 named', () => {
  const ctx = { MAKS_PRODUK_LANGKAH_STOK: 3, namaRapi: s => s, escapeHtml: s => s, teksPcs: n => `${n} pcs`, formatRupiah: n => `Rp ${n}` };
  vm.runInNewContext(extract('langkahStok') + ';this.f = langkahStok', ctx);
  const beli = ['A', 'B', 'C', 'D'].map((nama, i) => ({ nama, pcsBeli: 10 + i }));
  const cuci = [
    { nama: 'Arsip', status: 'UNLIST', saran: 50000, sudahTurun: false },
    { nama: 'Turun', status: 'NORMAL', saran: 60000, sudahTurun: false },
    { nama: 'Sudah', status: 'NORMAL', saran: 70000, sudahTurun: true },
    { nama: 'TanpaHpp', status: 'NORMAL', saran: null, sudahTurun: false },
  ];
  ctx.dataStok = { beliLagi: { beli, jangan: [] }, cuciGudang: { produk: cuci } };
  const [a, b] = ctx.f();
  assert.equal(a.judul, 'Beli lagi barang yang hampir habis');
  assert.match(a.isi, /A<\/span><strong>beli 10 pcs/); assert.doesNotMatch(a.isi, />D</); assert.match(a.isi, /\+ 1 produk lagi/);
  assert.match(a.isi, /data-ke-stok="kartuBeliLagi"/);
  assert.equal(b.judul, 'Turunkan harga barang yang tidak laku');
  assert.match(b.isi, /Turun<\/span><strong>jadi Rp 60000/);
  for (const nama of ['Arsip', 'Sudah', 'TanpaHpp']) assert.doesNotMatch(b.isi, new RegExp(`>${nama}<`));
  ctx.dataStok = { beliLagi: { beli: [], jangan: [] }, cuciGudang: { produk: [cuci[2]] } };
  assert.equal(ctx.f().length, 0);
  ctx.dataStok = null;
  assert.equal(ctx.f().length, 0);
});

test('Dashboard week comparison leaves out busy days (> 1.8 × median payout) and compares per day', () => {
  const ctx = { geserHari: E.geser, EvaluasiIklan: E };
  vm.runInNewContext(extract('bandingMingguBiasa') + ';this.f = bandingMingguBiasa', ctx);
  // 1–28 Sep: 200 rb payout, 80 rb profit, 20 rb ads a day. Week A = 8–14 Sep, week B = 15–21 Sep.
  const items = [], perHari = {};
  for (let i = 1; i <= 28; i++) {
    const d = `2026-09-${String(i).padStart(2, '0')}`;
    items.push({ waktuPesanan: d, totalPenghasilan: 200000, hpp: 1, untung: 80000 }); perHari[d] = { biaya: 20000 };
  }
  const kampanye = [{ perHari }];
  const biasa = ctx.f(items, kampanye, '2026-09-08', '2026-09-15');
  assert.equal(biasa.selisih, 0); assert.equal(biasa.a, 60000); assert.equal(biasa.iklanA, 20000); assert.equal(biasa.ramai.length, 0);
  // 9.9 sells 5× a normal day: the week before no longer looks 3,2 jt better.
  Object.assign(items[8], { totalPenghasilan: 1000000, untung: 400000 });
  const r = ctx.f(items, kampanye, '2026-09-08', '2026-09-15');
  assert.equal(r.selisih, 0); assert.equal(r.ramai.join(), '2026-09-09');
  // A real change on ordinary days still shows, per day; a day without orders counts as zero sales.
  for (const it of items) if (it.waktuPesanan >= '2026-09-15') it.untung = 50000;
  assert.equal(ctx.f(items, kampanye, '2026-09-08', '2026-09-15').selisih, -30000);
  assert.equal(ctx.f(items, [{ kodeProduk: 'x' }], '2026-09-08', '2026-09-15'), null); // no daily ad spend: old weekly line
  // Two weeks against two (the 4-week card uses n = 4): the busy day is left out of the longer span too.
  const dua = ctx.f(items, kampanye, '2026-09-01', '2026-09-15', 2);
  assert.equal(dua.ramai.join(), '2026-09-09'); assert.equal(dua.a, 60000); assert.equal(dua.b, 30000);
});

test('4-week card judges ads and profit per ordinary day when daily data exists', () => {
  const weeks = ['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27'].map(mulai => ({ mulai, lengkap: true, iklanLengkap: true, biayaIklan: 100, untungSetelahIklan: 100 }));
  const ctx = { weeks, geserHari: E.geser };
  vm.runInNewContext(extract('aturanMingguan') + ';this.f = aturanMingguan', ctx);
  assert.equal(ctx.f({ minggu: weeks }).teks, 'Pertahankan. Cek lagi minggu depan.'); // weekly sums: flat
  // Per ordinary day: ads +20%, profit down → no budget increase; busy days are counted in the detail.
  const r = ctx.f({ minggu: weeks }, (a, b, n) => (n === 2 && a === '2026-07-06' && b === '2026-07-20'
    ? { a: 100, b: 90, iklanA: 50, iklanB: 60, ramai: ['2026-07-07'] } : null));
  assert.equal(r.kelas, 'aturan-kurangi');
  assert.match(r.detail, /per hari biasa: biaya iklan \+20%, untung -10%\. 1 hari ramai tidak dihitung\./);
});

test('a small share of sales without HPP is estimated; a large share still holds all ads', () => {
  const { data, sumber } = fixture();
  // Week 16-22 Sep: 7 orders of 200 rb. Add one small order without HPP (1.4% of payout).
  sumber.items.push({ idProduk: 'baru', namaProduk: 'Produk baru', waktuPesanan: '2026-09-17', totalPenghasilan: 20000, hpp: null, untung: null });
  const kecil = E.rincianUntungToko(sumber, data.biayaTokoHarian, '2026-09-16', '2026-09-22');
  assert.equal(kecil.alasan, null);
  // 80 rb profit − 20 rb ads per day; margin 40% of payout, so the 20 rb order adds 8 rb over the week.
  assert.ok(Math.abs(kecil.nilai - (60000 + 8000 / 7)) < 0.001);
  sumber.items.push({ idProduk: 'baru', namaProduk: 'Produk baru', waktuPesanan: '2026-09-18', totalPenghasilan: 200000, hpp: null, untung: null });
  const besar = E.rincianUntungToko(sumber, data.biayaTokoHarian, '2026-09-16', '2026-09-22');
  assert.equal(besar.alasan, 'hpp'); assert.equal(besar.nilai, null);
  assert.equal(besar.produkTanpaHpp[0].namaProduk, 'Produk baru');
  const rows = [row(), row('q')];
  E.terapkanEvaluasiToko(rows, data, besar.nilai !== null);
  assert.ok(rows.every(b => b.keputusan === 'tunggu' && b.alasan === 'data-toko'));
});

test('the missing-data banner names the reason once, with the HPP share and products', () => {
  const ctx = { EvaluasiIklan: E, escapeHtml: s => s, namaRapi: s => s, tanggalSingkat: s => s };
  vm.runInNewContext(extract('bannerDataBelumLengkap') + ';globalThis.f = bannerDataBelumLengkap', ctx);
  assert.equal(ctx.f(null), '');
  const html = ctx.f({ dasar: { alasan: 'hpp', bagianTanpaHpp: 0.12, dari: 'a', sampai: 'b', produkTanpaHpp: [{ namaProduk: 'Blus X' }] },
    sinkron: { jenis: 'antrean', menunggu: 3, macet: 1 } });
  assert.match(html, /12%/); assert.match(html, /Blus X/); assert.match(html, /data-ke-hpp/); assert.match(html, /4 pesanan/);
});

test('same-day edits of one campaign count as one change (user, 2026-09-29)', () => {
  const { gabungUbahSehari } = require('../sinkronIklan');
  const u = (tanggal, modalLama, modalBaru, campaignId = 'c') => ({ campaignId, idProduk: 'p', tanggal, targetLama: 12, targetBaru: 12, modalLama, modalBaru });
  // Kulot balon on 28/09: 50,000 → 76,129 → 77,097 becomes one budget change 50,000 → 77,097.
  const r = gabungUbahSehari([u('2026-09-20', 40000, 50000), u('2026-09-28', 50000, 76129), u('2026-09-28', 76129, 77097), u('2026-09-28', 60000, 70000, 'd')]);
  assert.deepEqual(r.map((x) => [x.campaignId, x.tanggal, x.modalLama, x.modalBaru]),
    [['c', '2026-09-20', 40000, 50000], ['c', '2026-09-28', 50000, 77097], ['d', '2026-09-28', 60000, 70000]]);
  // An edit undone the same day is no change.
  assert.deepEqual(gabungUbahSehari([u('2026-09-28', 50000, 60000), u('2026-09-28', 60000, 50000)]), []);
  // The merged change is judged normally (not 'campur').
  const data = { dataSiapEvaluasi: true, kampanye: [], riwayatSetelan: gabungUbahSehari([u('2026-09-28', 50000, 76129), u('2026-09-28', 76129, 77097)]) };
  assert.equal(E.hasilIklan(data, 'p', '2026-10-13', 6).status, 'data'); // no campaign data in this fixture, but not 'campur'
});

test('a new zone counts only after it held three days (user, 2026-10-01)', () => {
  assert.equal(E.tahanZona(['abu', 'abu', 'untung']).zona, 'abu');
  assert.equal(E.tahanZona(['abu', 'untung', 'abu', 'untung']).zona, 'abu'); // back and forth: never 3 in a row
  assert.equal(E.tahanZona(['abu', 'untung', 'untung', 'untung']).zona, 'untung');
  const r = E.tahanZona(['rugi', 'rugi', 'abu', 'abu']);
  assert.deepEqual([r.zona, r.mentah, r.hariBaru], ['rugi', 'abu', 2]);
  assert.equal(E.tahanZona(['rugi', 'rugi', null, 'untung']).zona, 'untung'); // a gap (change, missing data) restarts
  assert.equal(E.tahanZona([]).zona, null);

  // Direct ROAS 8 per day, then 2 from 10/09 (broad stays 10); minimum 5. The 7-day window (today−14…today−8)
  // first holds 4 weak days on 21/09, so the raw zone turns abu that day and the held zone two days later.
  const perHari = {};
  for (let d = '2026-07-01'; d <= '2026-09-30'; d = E.geser(d, 1)) perHari[d] = { biaya: 10000, omzet: 100000, omzetLangsung: d < '2026-09-10' ? 80000 : 20000 };
  const kampanye = [{ kodeProduk: 'p', status: 'Berjalan', tanggalMulaiIso: '2026-07-01', perHari }];
  const z = (hari) => E.zonaStabil(kampanye, 'p', null, hari, 5);
  assert.deepEqual([z('2026-09-20').zona, z('2026-09-20').mentah], ['untung', 'untung']);
  assert.deepEqual([z('2026-09-21').zona, z('2026-09-21').mentah, z('2026-09-21').hariBaru], ['untung', 'abu', 1]);
  assert.deepEqual([z('2026-09-22').zona, z('2026-09-22').hariBaru], ['untung', 2]);
  assert.equal(z('2026-09-23').zona, 'abu');
  // A settings change restarts the history: 15 days later the first ready window counts at once.
  assert.equal(E.zonaStabil(kampanye, 'p', { tanggal: '2026-09-06' }, '2026-09-21', 5).zona, 'abu');

  // The verdict follows the held zone and says what the latest window shows.
  const hasil = hitungAnalisisIklan([{ kodeProduk: 'p', namaIklan: 'p', status: 'Berjalan', tanggalMulaiIso: '2026-07-01', tanggalSelesaiIso: '2026-09-21',
    biaya: 100000, omzet: 1000000, omzetLangsung: 800000, terjual: 10, terjualLangsung: 8, dilihat: 0, klik: 0, perHari }],
  new Map([['p', { hpp: 51000 }]]), 0.78, { p: { harga: 100000, rasio: 0.78, pcs: 10 } },
  { tanggalLaporanIso: '2026-09-21', tingkatCair: 0.75, setelanApi: { p: {} } }).produk[0];
  assert.ok(Math.abs(hasil.roasImpas - 1 / (0.27 * 0.75)) < 1e-9); // minimum ≈ 4.9, as in the series above
  assert.equal(hasil.zona.mentah, 'abu');
  assert.equal(hasil.aksi, 'untung');
  assert.match(hasil.tindakan, /Angka terbaru belum tentu untung; dipakai kalau bertahan 3 hari\./);
});
