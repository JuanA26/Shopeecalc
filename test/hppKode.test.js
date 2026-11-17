const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Real schema (db.js) in a throwaway folder; no credentials, no network.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hppkode-test-'));
process.env.DATA_DIR = dataDir;
const db = require('../db');
const { kodeVarian, bacaPetaHpp } = require('../hppKode');
const { daftarStok, modalPerKode } = require('../sinkronStok');
const { saranBeliLagi } = require('../stokSaran');
const { hitungAnalisisIklan } = require('../analisisIklan');
after(() => { db.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('item code from the variant name (real names from the 17/11 export)', () => {
  const kasus = {
    '9669 Grey': '9669', '2190.2 Pink Nude': '2190.2', '21031-R Brown': '21031-R', '600-1 Coffee': '600-1',
    '0510 Coffee': '0510', '510 Green': '510', // different items at different prices: never merged
    '[9918-1] Hitam': '9918-1', '(24022-5)': '24022-5', 'KODE 35': '35', 'Kode 715,Purple': '715', 'MODEL 59,ALLSIZED': '59',
    '2502-3 A10,Ivory': '2502-3', 'P0L0 Hitam': 'P0L0', '9316-AL0': '9316-AL0', '1-71107B': '1-71107B', 'A-2602 Hitam': 'A-2602', 'V32 P0L0 Hitam': 'V32', 'L01/N01': 'L01/N01', 'C3630.1FFM': 'C3630.1',
    '2096-Dusty': '2096', '56360-Brownies': '56360', '2476PITABrownies90cm': '2476', '8818Coffee': '8818', '8621(butter)Brownies': '8621',
    // No code: colour only, style words, sizes, empty.
    Hitam: null, 'Hitam,1 ukuran': null, 'Hitam,XL': null, 'P 0 l 0 Brownies': null, 'PITA Khakis 94cm': null, '3XL': null, '': null,
  };
  for (const [nama, kode] of Object.entries(kasus)) assert.equal(kodeVarian(nama), kode, nama);
});

test('HPP per line: item-code HPP first, then product HPP; a code without its own HPP uses the product HPP', () => {
  db.prepare("INSERT INTO product_hpp (id_produk, nama_produk, hpp) VALUES ('J', 'Jacket', 120000), ('K', 'Kaos', 50000)").run();
  db.prepare("INSERT INTO hpp_kode (id_produk, kode, hpp) VALUES ('J', '510', 140000), ('J', '0510', 125000), ('B', '9669', 90000)").run();
  const peta = bacaPetaHpp(db);
  assert.equal(peta.hppVarian('J', '510 Green'), 140000);
  assert.equal(peta.hppVarian('J', '0510 Coffee'), 125000);
  assert.equal(peta.hppVarian('J', '611996 Cream'), 120000); // code without HPP → product
  assert.equal(peta.hppVarian('J', 'Khakis'), 120000);       // no code → product
  assert.equal(peta.hppVarian('K', '510 Green'), 50000);     // codes belong to one product only
  assert.equal(peta.hppVarian('B', '9669 Grey'), 90000);     // code HPP without product HPP
  assert.equal(peta.hppVarian('B', '2190 Blue'), null);      // ... other codes stay unknown
  assert.equal(peta.hppVarian('X', '9669 Grey'), null);
  assert.deepEqual([peta.adaHpp('B'), peta.adaHpp('X')], [true, false]);
});

test('stock modal per variant for products with code HPPs; other products unchanged', () => {
  const peta = bacaPetaHpp(db);
  const v = (id, nama, stok) => ({ id_produk: id, model_id: nama, nama_varian: nama, stok, status: 'MODEL_NORMAL' });
  const varian = [v('J', '510 Green', 2), v('J', '0510 Coffee', 4), v('J', 'Khakis', 1), v('J', '052 Choco', 0),
    v('K', '510 Green', 10), v('B', '9669 Grey', 3), v('B', '2190 Blue', 5)];
  const mk = modalPerKode(varian, peta);
  assert.deepEqual([...mk.keys()].sort(), ['B', 'J']); // K has no code HPP: old path
  const baris = [
    { id_produk: 'J', nama_produk: 'Jacket', status: 'NORMAL', stok: 7, stok_maks_varian: 4 },
    { id_produk: 'K', nama_produk: 'Kaos', status: 'NORMAL', stok: 10, stok_maks_varian: 10 },
    { id_produk: 'B', nama_produk: 'Blouse', status: 'NORMAL', stok: 8, stok_maks_varian: 5 },
  ];
  const per = Object.fromEntries(daftarStok(baris, peta.produk, new Map(), mk).map((p) => [p.idProduk, p]));
  assert.equal(per.J.modal, 2 * 140000 + 4 * 125000 + 1 * 120000);
  assert.equal(per.J.hpp, per.J.modal / 7);
  assert.equal(per.J.hppPerKode, true);
  assert.equal(per.K.modal, 10 * 50000);
  assert.equal(per.K.hppPerKode, false);
  assert.deepEqual([per.B.dihitung, per.B.modal, per.B.hpp], ['tanpa-hpp', null, null]); // 2190 in stock has no HPP
});

test('Beli lagi: modal and weekly profit use each variant code HPP', () => {
  const peta = bacaPetaHpp(db);
  const produk = [{ idProduk: 'J', nama: 'Jacket', status: 'NORMAL', dihitung: 'dihitung', hpp: 130000 }];
  const varianStok = [{ id_produk: 'J', model_id: 'a', nama_varian: '510 Green', stok: 0, status: 'MODEL_NORMAL' },
    { id_produk: 'J', model_id: 'b', nama_varian: '0510 Coffee', stok: 0, status: 'MODEL_NORMAL' }];
  const jual = (model, nama) => ({ idProduk: 'J', modelId: model, namaModel: nama, jumlah: 3, waktuPesanan: '2026-11-10', totalPenghasilan: 600000 });
  const h = saranBeliLagi({ produk, varianStok, items: [jual('a', '510 Green'), jual('b', '0510 Coffee')], petaHpp: peta.produk,
    hppVarian: peta.hppVarian, hariIni: '2026-11-17' });
  const b = h.beli[0];
  assert.deepEqual(b.varian.map((x) => [x.nama, x.hpp, x.beli]), [['510 Green', 140000, 4], ['0510 Coffee', 125000, 4]]);
  assert.equal(b.modal, 4 * 140000 + 4 * 125000);
  assert.equal(b.untungMinggu, Math.round((1200000 - 3 * 140000 - 3 * 125000) / 30 * 7));

  // A sold code without its own HPP and no product HPP: profit unknown (never counted as HPP 0).
  const blouse = [{ idProduk: 'B', nama: 'Blouse', status: 'NORMAL', dihitung: 'dihitung', hpp: 90000 }];
  const vb = [{ id_produk: 'B', model_id: 'a', nama_varian: '9669 Grey', stok: 0, status: 'MODEL_NORMAL' },
    { id_produk: 'B', model_id: 'b', nama_varian: '2190 Blue', stok: 0, status: 'MODEL_NORMAL' }];
  const jb = (model, nama) => ({ idProduk: 'B', modelId: model, namaModel: nama, jumlah: 3, waktuPesanan: '2026-11-10', totalPenghasilan: 100000 });
  const hb = saranBeliLagi({ produk: blouse, varianStok: vb, items: [jb('a', '9669 Grey'), jb('b', '2190 Blue')], petaHpp: peta.produk,
    hppVarian: peta.hppVarian, hariIni: '2026-11-17' });
  assert.deepEqual([hb.beli.length, hb.jangan.length], [1, 0]); // a fake "rugi" would wrongly block the restock
  assert.deepEqual([hb.beli[0].untungMinggu, hb.beli[0].modal], [null, null]);
});

test('ad economics use the sales-weighted HPP sent with the sales data, else the product HPP', () => {
  const hppMap = new Map([['J', { hpp: 120000, namaProduk: 'Jacket' }]]);
  const income = { harga: 230000, rasio: 0.8, pcs: 10, perHari: {} };
  const a = hitungAnalisisIklan([], hppMap, 0.8, { J: { ...income, hpp: 133000 } });
  assert.equal(a.ekonomiProduk.J.hpp, 133000);
  const b = hitungAnalisisIklan([], hppMap, 0.8, { J: income });
  assert.equal(b.ekonomiProduk.J.hpp, 120000);
});
