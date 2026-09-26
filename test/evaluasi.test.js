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

test('store comparison includes other products and return costs; requires mature complete evidence', () => {
  const { data, sumber } = fixture();
  assert.equal(E.evaluasiPerubahan(data, sumber, '2026-09-29').status, 'tunggu');
  let r = E.evaluasiPerubahan(data, sumber, '2026-09-30');
  assert.equal(r.status, 'turun'); assert.equal(r.sebelum, 100000); assert.equal(r.sesudah, 60000);
  sumber.items.push({ waktuPesanan: '2026-09-16', dikembalikan: true, totalPenghasilan: -7000 });
  assert.equal(E.evaluasiPerubahan(data, sumber, '2026-09-30').sesudah, 59000);
  data.dataSiapEvaluasi = false; assert.equal(E.evaluasiPerubahan(data, sumber, '2026-09-30').status, 'data');
  data.dataSiapEvaluasi = true;
  sumber.items[15].hpp = null; assert.equal(E.evaluasiPerubahan(data, sumber, '2026-09-30').status, 'data');
  sumber.items[15].hpp = 50000; delete data.biayaTokoHarian['2026-09-18'];
  assert.equal(E.evaluasiPerubahan(data, sumber, '2026-09-30').status, 'data');
  data.biayaTokoHarian['2026-09-18'] = 20000;
  sumber.items = sumber.items.filter(i => i.waktuPesanan !== '2026-09-18');
  assert.equal(E.evaluasiPerubahan(data, sumber, '2026-09-30').status, 'data');
});

test('lower store profit reverses a numeric target raise even when direct ROAS improves', () => {
  const { data, sumber } = fixture();
  const b = row(); b.keputusan = 'tambah'; b.p.aksi = 'untung';
  const other = row('other');
  E.terapkanEvaluasiToko([b, other], E.evaluasiPerubahan(data, sumber, '2026-09-30'), data, true);
  assert.equal(b.keputusan, 'kembalikan'); assert.equal(b.targetBaru, 9); assert.equal(b.modalBaru, 60000);
  assert.equal(other.keputusan, 'tunggu');
  const pause = { ...row('unsafe'), keputusan: 'jeda', modalBaru: 0 };
  E.terapkanEvaluasiToko([pause], E.evaluasiPerubahan(data, sumber, '2026-09-29'), data, false);
  assert.equal(pause.keputusan, 'jeda');
});

test('improving store profit preserves tested settings; only one new ad can be tried', () => {
  const { data, sumber } = fixture(180000);
  const rows = [row(), row('q'), row('r')];
  E.terapkanEvaluasiToko(rows, E.evaluasiPerubahan(data, sumber, '2026-09-30'), data, true);
  assert.equal(rows[0].keputusan, 'lanjut'); assert.equal(rows[0].targetBaru, null);
  assert.equal(rows[1].keputusan, 'naikkan'); assert.equal(rows[2].alasan, 'satu-uji');
});

test('pending, overlapping and mixed trials block tuning; rollback does not create a raise/lower loop', () => {
  const { data, sumber } = fixture();
  const rows = [row(), row('q')];
  E.terapkanEvaluasiToko(rows, E.evaluasiPerubahan(data, sumber, '2026-09-29'), data, true);
  assert.ok(rows.every(b => b.keputusan === 'tunggu'));
  data.riwayatSetelan.unshift({ ...change, idProduk: 'q', campaignId: '2', tanggal: '2026-09-10' });
  assert.equal(E.evaluasiPerubahan(data, sumber, '2026-09-30').status, 'campur');
  data.riwayatSetelan.shift(); data.riwayatSetelan[0].modalBaru = 70000;
  const mixed = row(); E.terapkanEvaluasiToko([mixed], E.evaluasiPerubahan(data, sumber, '2026-09-30'), data, true);
  assert.equal(mixed.keputusan, 'tinjau');
  data.riwayatSetelan = [{ ...change }, { ...change, tanggal: '2026-09-30', targetLama: 10.8, targetBaru: 9 }];
  const repeat = row(); E.terapkanEvaluasiToko([repeat], null, data, true);
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
      keputusanBerjalan: () => ({ baris: [b, hpp], dataBelumLengkap }), PERLU_TINDAKAN: new Set(['isi-hpp']), namaSingkat: s => s, escapeHtml: s => s,
      tanggalSingkat: s => s, kalimatKeputusan: () => 'Tetap dulu.', EvaluasiIklan: E, labelKeputusan: () => ['', 'pill-abu'], alasanTugas: () => '',
      formatRupiahRingkas: n => String(n),
    });
    const html = nodes.tugasDaftar.innerHTML;
    assert.ok(html.indexOf('Isi HPP') < html.indexOf('Tidak Terbatas'));
    assert.match(html, /No cost product/); assert.match(html, /Best seller without HPP/); assert.match(html, /data-ke-hpp/);
    assert.match(html, /sebelum 2026-10-02/);
    assert.match(nodes.tugasLain.innerHTML, /jangan diubah/); assert.doesNotMatch(nodes.tugasLain.innerHTML, /Sample product/);
    assert.equal(nodes.tugasHasil.innerHTML, '');
  }
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
  E.terapkanEvaluasiToko(rows, null, data, besar.nilai !== null);
  assert.ok(rows.every(b => b.keputusan === 'tunggu' && b.alasan === 'data-toko'));
});

test('the missing-data banner names the reason once, with the HPP share and products', () => {
  const ctx = { EvaluasiIklan: E, escapeHtml: s => s, namaSingkat: s => s, tanggalSingkat: s => s };
  vm.runInNewContext(extract('bannerDataBelumLengkap') + ';globalThis.f = bannerDataBelumLengkap', ctx);
  assert.equal(ctx.f(null), '');
  const html = ctx.f({ dasar: { alasan: 'hpp', bagianTanpaHpp: 0.12, dari: 'a', sampai: 'b', produkTanpaHpp: [{ namaProduk: 'Blus X' }] },
    sinkron: { jenis: 'antrean', menunggu: 3, macet: 1 } });
  assert.match(html, /12%/); assert.match(html, /Blus X/); assert.match(html, /data-ke-hpp/); assert.match(html, /4 pesanan/);
});
