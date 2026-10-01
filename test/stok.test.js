const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Real schema (db.js) in a throwaway folder; no credentials, no network.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stok-test-'));
process.env.DATA_DIR = dataDir;
const db = require('../db');
const { sinkronStok, daftarStok, ringkasStok, hitungTerjual, BATAS_STOK_TIDAK_WAJAR } = require('../sinkronStok');
const { callShopApi } = require('../shopeeApi');
after(() => { db.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

const stok = (seller, shopee = 0) => ({ stock_info_v2: { summary_info: {}, seller_stock: [{ location_id: 'A', stock: seller }], shopee_stock: shopee ? [{ location_id: 'S', stock: String(shopee) }] : [] } });

// Mock Shopee product module. `toko.produk[id]` = { status, update, nama, stok } or { ..., varian: [n, ...] }.
function mockShopee(toko) {
  const log = [];
  const panggil = async (p, { query = {} } = {}) => {
    log.push(p.split('/').pop());
    if (p.endsWith('/product/get_item_list')) {
      const semua = Object.entries(toko.produk).filter(([, x]) => x.status === query.item_status);
      const halaman = semua.slice(query.offset, query.offset + query.page_size);
      const lanjut = query.offset + query.page_size < semua.length;
      return { response: { item: halaman.map(([id, x]) => ({ item_id: Number(id), item_status: x.status, update_time: x.update })), has_next_page: lanjut, next_offset: query.offset + query.page_size } };
    }
    if (p.endsWith('/product/get_item_base_info')) {
      const ids = String(query.item_id_list).split(',');
      assert.ok(ids.length <= 50);
      return { response: { item_list: ids.map((id) => {
        const x = toko.produk[id];
        return { item_id: Number(id), item_name: x.nama, item_status: x.status, update_time: x.update, has_model: !!x.varian, ...(x.varian ? {} : stok(x.stok)) };
      }) } };
    }
    if (p.endsWith('/product/get_model_list')) {
      if (toko.gagal && toko.gagal.has(String(query.item_id))) return { error: 'error_server', message: 'coba lagi' };
      return { response: { model: toko.produk[query.item_id].varian.map((n) => stok(n)) } };
    }
    throw new Error('unexpected endpoint ' + p);
  };
  return { panggil, log };
}
const baca = (shop) => Object.fromEntries(db.prepare('SELECT * FROM stok_produk WHERE shop_id = ?').all(shop).map((r) => [r.id_produk, r]));

test('stock endpoints are allowed read-only; stock-changing product endpoints stay blocked', async () => {
  for (const p of ['update_stock', 'update_item', 'unlist_item', 'delete_item', 'update_price']) {
    await assert.rejects(callShopApi(`/api/v2/product/${p}`, { shopId: 9, accessToken: 't' }), /Ditolak/);
  }
});

test('sync counts seller + Shopee warehouse stock, sums variants, pages through statuses', async () => {
  const produk = { 1: { status: 'NORMAL', update: 100, nama: 'Kaos', stok: 7 } };
  for (let i = 0; i < 120; i++) produk[1000 + i] = { status: 'UNLIST', update: 100, nama: `Lama ${i}`, stok: 1 };
  produk[2] = { status: 'NORMAL', update: 100, nama: 'Gamis', varian: [3, 0, 12] };
  produk[3] = { status: 'BANNED', update: 100, nama: 'Diblokir', stok: 2 };
  const { panggil } = mockShopee({ produk });
  // Shopee warehouse stock counts too (stock is a string there).
  const asli = panggil;
  const denganGudang = async (p, o) => {
    const r = await asli(p, o);
    if (p.endsWith('get_item_base_info')) for (const it of r.response.item_list) if (it.item_id === 1) Object.assign(it, stok(7, 5));
    return r;
  };
  await sinkronStok({ db, panggil: denganGudang, shopId: 'a', sekarang: 1000 });
  const r = baca('a');
  assert.equal(Object.keys(r).length, 123);
  assert.equal(r[1].stok, 12);
  assert.equal(r[2].stok, 15);
  assert.equal(r[2].stok_maks_varian, 12);
  assert.equal(r[2].jumlah_varian, 3);
  assert.equal(r[3].status, 'BANNED');
});

test('variant stock is re-read only when the product changed, sold, or is a day old; deleted products disappear', async () => {
  const toko = { produk: {
    10: { status: 'NORMAL', update: 100, nama: 'A', varian: [5, 5] },
    11: { status: 'NORMAL', update: 100, nama: 'B', varian: [4] },
    12: { status: 'NORMAL', update: 100, nama: 'C', varian: [1] },
    13: { status: 'UNLIST', update: 100, nama: 'D', stok: 9 },
  } };
  const m = mockShopee(toko);
  await sinkronStok({ db, panggil: m.panggil, shopId: 'b', sekarang: 10000 });
  db.prepare("INSERT OR REPLACE INTO sinkron_shopee (shop_id, stok_ts) VALUES ('b', 10000)").run();
  assert.equal(m.log.filter((x) => x === 'get_model_list').length, 3);

  // B edited in Seller Centre (update_time moves); C sold (order updated after the last stock sync); D deleted.
  toko.produk[11] = { ...toko.produk[11], update: 200, varian: [2] };
  toko.produk[12].varian = [0];
  delete toko.produk[13];
  db.prepare("INSERT INTO api_order (order_sn, shop_id, tanggal_pesanan, update_time, status) VALUES ('O1', 'b', '2026-10-01', 10500, 'READY_TO_SHIP')").run();
  db.prepare("INSERT INTO api_order_item (order_sn, baris, id_produk, jumlah, harga_satuan) VALUES ('O1', 0, '12', 1, 50000)").run();
  m.log.length = 0;
  await sinkronStok({ db, panggil: m.panggil, shopId: 'b', sekarang: 11000 });
  assert.equal(m.log.filter((x) => x === 'get_model_list').length, 2); // B and C, not A
  let r = baca('b');
  assert.equal(r[10].stok, 10);
  assert.equal(r[11].stok, 2);
  assert.equal(r[12].stok, 0);
  assert.equal(r[13], undefined);

  // A day later every variant product is read again.
  m.log.length = 0;
  await sinkronStok({ db, panggil: m.panggil, shopId: 'b', sekarang: 11000 + 24 * 3600 });
  assert.equal(m.log.filter((x) => x === 'get_model_list').length, 3);
});

test('one failing variant read keeps the old number and does not fail the sync', async () => {
  const toko = { produk: { 20: { status: 'NORMAL', update: 1, nama: 'E', varian: [6] }, 21: { status: 'NORMAL', update: 1, nama: 'F', varian: [8] } } };
  const m = mockShopee(toko);
  await sinkronStok({ db, panggil: m.panggil, shopId: 'c', sekarang: 5000 });
  toko.produk[20] = { ...toko.produk[20], update: 2, varian: [1] };
  toko.produk[21] = { ...toko.produk[21], update: 2, varian: [3] };
  toko.gagal = new Set(['20']);
  const h = await sinkronStok({ db, panggil: m.panggil, shopId: 'c', sekarang: 6000 });
  assert.equal(h.gagal, 1);
  const r = baca('c');
  assert.equal(r[20].stok, 6);
  assert.equal(r[20].update_time, 1); // still marked old, so it is read again next time
  assert.equal(r[21].stok, 3);
});

test('product list and summary: groups, missing HPP, implausible stock, sold-out, days of stock', () => {
  const baris = [
    { id_produk: '1', nama_produk: 'Aktif murah', status: 'NORMAL', stok: 10, stok_maks_varian: 4 },
    { id_produk: '2', nama_produk: 'Aktif mahal', status: 'NORMAL', stok: 5, stok_maks_varian: 5 },
    { id_produk: '3', nama_produk: 'Arsip', status: 'UNLIST', stok: 20, stok_maks_varian: 20 },
    { id_produk: '4', nama_produk: 'Tanpa HPP', status: 'NORMAL', stok: 7, stok_maks_varian: 7 },
    { id_produk: '5', nama_produk: '999', status: 'NORMAL', stok: 1000, stok_maks_varian: BATAS_STOK_TIDAK_WAJAR + 499 },
    { id_produk: '6', nama_produk: 'Habis', status: 'NORMAL', stok: 0, stok_maks_varian: 0 },
    { id_produk: '7', nama_produk: 'Ditinjau', status: 'REVIEWING', stok: 2, stok_maks_varian: 2 },
  ];
  const hpp = new Map([['1', 20000], ['2', 100000], ['3', 30000], ['5', 50000], ['6', 10000], ['7', 40000]]);
  // Sold in the last 30 days: returns and older orders don't count.
  const terjual = hitungTerjual([
    { idProduk: '1', jumlah: 3, waktuPesanan: '2026-09-20' }, { idProduk: '1', jumlah: 2, waktuPesanan: '2026-09-25 10:00' },
    { idProduk: '1', jumlah: 9, waktuPesanan: '2026-08-01' }, { idProduk: '2', jumlah: 4, waktuPesanan: '2026-09-21', dikembalikan: true },
  ], '2026-09-02');
  const daftar = daftarStok(baris, hpp, terjual);
  const per = Object.fromEntries(daftar.map((p) => [p.idProduk, p]));
  assert.deepEqual(daftar.map((p) => p.idProduk).slice(0, 4), ['3', '2', '1', '7']); // biggest modal first
  assert.deepEqual([per[4].dihitung, per[5].dihitung, per[6].dihitung, per[1].dihitung], ['tanpa-hpp', 'tidak-wajar', 'habis', 'dihitung']);
  assert.equal(per[5].modal, null);
  assert.equal(per[1].terjual30, 5);
  assert.equal(per[1].cukupHari, 60); // 10 pcs ÷ (5 pcs / 30 days)
  assert.equal(per[2].terjual30, 0);
  assert.equal(per[2].cukupHari, null);

  const r = ringkasStok(daftar);
  assert.equal(r.semua.modal, 10 * 20000 + 5 * 100000 + 20 * 30000 + 2 * 40000);
  assert.equal(r.semua.pcs, 37);
  assert.equal(r.semua.produk, 4);
  assert.deepEqual(r.semua.tanpaHpp, { produk: 1, pcs: 7 });
  assert.deepEqual(r.semua.tidakWajar, { produk: 1, pcs: 1000 });
  assert.equal(r.semua.habis, 1);
  assert.equal(r.aktif.modal, 10 * 20000 + 5 * 100000);
  assert.equal(r.tersembunyi.modal, 20 * 30000 + 2 * 40000);
  assert.equal(r.tersembunyi.tidakWajar.produk, 0);
});
