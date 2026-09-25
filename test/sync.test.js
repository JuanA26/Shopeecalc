const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Real schema (db.js) in a throwaway folder; no credentials, no network.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sinkron-test-'));
process.env.DATA_DIR = dataDir;
const db = require('../db');
const { sinkronkan } = require('../sinkronShopee');
after(() => { db.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

// Mock Shopee: `shopee` holds what each endpoint currently returns; tests change it between syncs.
function mockShopee(shopee) {
  return async (p, opsi = {}) => {
    const q = opsi.query || {};
    if (p.endsWith('/order/get_order_list')) return { response: { order_list: shopee.orderList, more: false } };
    if (p.endsWith('/order/get_order_detail')) {
      const sn = String(q.order_sn_list).split(',');
      return { response: { order_list: sn.filter((s) => shopee.orderDetail[s]).map((s) => shopee.orderDetail[s]) } };
    }
    if (p.endsWith('/payment/get_escrow_list')) return { response: { escrow_list: shopee.escrowList, more: false } };
    if (p.endsWith('/payment/get_escrow_detail_batch')) {
      return { response: opsi.body.order_sn_list.filter((s) => shopee.escrowDetail[s]).map((s) => shopee.escrowDetail[s]) };
    }
    if (p.endsWith('/returns/get_return_detail')) {
      return shopee.returFails ? { error: 'error_server', message: 'timeout' } : { response: shopee.returDetail[q.return_sn] };
    }
    throw new Error('unexpected endpoint ' + p);
  };
}
const now = Math.floor(Date.now() / 1000);
const antrean = (shop, jenis) => db.prepare('SELECT order_sn FROM sinkron_ulang WHERE shop_id = ? AND jenis = ?').all(shop, jenis).map((r) => r.order_sn);

test('retry rotation reaches the 201st order despite persistent failures and isolates shops', async () => {
  const insert = db.prepare("INSERT INTO sinkron_ulang(shop_id,order_sn,jenis) VALUES (?,?,'order')");
  for (let i = 0; i < 201; i++) insert.run('rotation', `ROT${String(i).padStart(3, '0')}`);
  insert.run('other-shop', 'OTHER');
  const seen = [];
  const api = mockShopee({ orderList: [], escrowList: [], escrowDetail: {},
    orderDetail: { ROT200: { order_sn: 'ROT200', create_time: now, order_status: 'COMPLETED', item_list: [] } } });
  const panggil = (p, o) => {
    if (p.endsWith('/order/get_order_detail')) seen.push(...o.query.order_sn_list.split(','));
    return api(p, o);
  };
  await sinkronkan({ db, panggil, shopId: 'rotation' });
  assert.equal(seen.includes('ROT200'), false);
  await sinkronkan({ db, panggil, shopId: 'rotation' });
  assert.equal(seen.includes('ROT200'), true);
  assert.equal(seen.includes('OTHER'), false);
  assert.equal(antrean('rotation', 'order').includes('ROT200'), false);
});

test('explicit historical sync repairs stored returns and same-status orders, then drains without duplicates', async () => {
  const date = require('../sinkronShopee').tanggalWib(now - 86400);
  db.prepare(`INSERT INTO api_pesanan(order_sn,shop_id,waktu_pesanan,tanggal_dilepaskan,escrow_amount)
    VALUES ('OLD','repair',?,?, -12000)`).run(date,date);
  db.exec(`INSERT INTO api_pesanan_item(order_sn,baris,id_produk,jumlah,harga_produk,total_penghasilan)
    VALUES ('OLD',0,'1',2,100000,-12000)`);
  db.prepare(`INSERT INTO api_order(order_sn,shop_id,tanggal_pesanan,status) VALUES ('OLD','repair',?,'COMPLETED')`).run(date);
  const shopee = {
    orderList: [{ order_sn: 'OLD', order_status: 'COMPLETED' }], escrowList: [],
    orderDetail: { OLD: { order_sn: 'OLD', create_time: now - 86400, order_status: 'COMPLETED',
      item_list: [{ item_id: 1, model_quantity_purchased: 2, model_discounted_price: 50000 }] } },
    escrowDetail: { OLD: { order_sn: 'OLD', return_order_sn_list: ['ROLD'], order_income: {
      escrow_amount: -12000, items: [{ item_id: 1, quantity_purchased: 2, discounted_price: 100000 }] } } },
    returDetail: { ROLD: { status: 'ACCEPTED', refund_amount: 100000, item: [{ item_id: 1, amount: 2 }] } },
    returFails: true,
  };
  const panggil = mockShopee(shopee);
  await sinkronkan({ db, panggil, shopId: 'repair', hariMundur: 90 });
  assert.equal(db.prepare("SELECT jumlah FROM api_order_item WHERE order_sn='OLD'").get().jumlah, 2);
  assert.deepEqual(antrean('repair','retur'), ['OLD']);
  shopee.orderList = []; shopee.returFails = false;
  await sinkronkan({ db, panggil, shopId: 'repair' });
  const row = db.prepare("SELECT dikembalikan,jumlah FROM api_pesanan_item WHERE order_sn='OLD'").get();
  assert.equal(row.dikembalikan, 1); assert.equal(row.jumlah, 2);
  assert.equal(db.prepare("SELECT tanggal_dilepaskan FROM api_pesanan WHERE order_sn='OLD'").get().tanggal_dilepaskan, date);
  assert.deepEqual(antrean('repair','retur'), []);
  await sinkronkan({ db, panggil, shopId: 'repair', hariMundur: 90 });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM api_pesanan_item WHERE order_sn='OLD'").get().n, 1);
});

test('a failed return lookup is queued and corrected on the next sync', async () => {
  const shopee = {
    orderList: [], escrowList: [{ order_sn: 'RET1', escrow_release_time: now - 86400 }],
    orderDetail: { RET1: { order_sn: 'RET1', create_time: now - 10 * 86400, order_status: 'COMPLETED' } },
    escrowDetail: { RET1: { order_sn: 'RET1', return_order_sn_list: ['R1'], order_income: { escrow_amount: -12000,
      items: [{ item_id: 1, quantity_purchased: 1, discounted_price: 100000 }] } } },
    returDetail: { R1: { status: 'ACCEPTED', refund_amount: 100000, item: [{ item_id: 1, amount: 1 }] } },
    returFails: true,
  };
  const panggil = mockShopee(shopee);
  const pertama = await sinkronkan({ db, panggil, shopId: 's1' });
  const item = () => db.prepare('SELECT dikembalikan, total_penghasilan FROM api_pesanan_item WHERE order_sn = ?').all('RET1');
  assert.deepEqual(item().map((r) => r.dikembalikan), [0], 'stored as best effort while the return is unknown');
  assert.deepEqual(antrean('s1', 'retur'), ['RET1']);
  assert.equal(pertama.returTertunda, 1);
  const tanggal = db.prepare('SELECT tanggal_dilepaskan FROM api_pesanan WHERE order_sn = ?').get('RET1').tanggal_dilepaskan;

  shopee.returFails = false;
  shopee.escrowList = []; // the release date is already outside the escrow window
  const kedua = await sinkronkan({ db, panggil, shopId: 's1' });
  assert.deepEqual(item().map((r) => ({ ...r })), [{ dikembalikan: 1, total_penghasilan: -12000 }]);
  assert.deepEqual(antrean('s1', 'retur'), []);
  assert.equal(kedua.returTertunda, 0);
  assert.equal(db.prepare('SELECT tanggal_dilepaskan FROM api_pesanan WHERE order_sn = ?').get('RET1').tanggal_dilepaskan, tanggal,
    'a retry outside the escrow window keeps the stored release date');
});

test('an order missing from get_order_detail is retried by order_sn after its window has passed', async () => {
  const shopee = {
    orderList: [{ order_sn: 'MISS1', order_status: 'READY_TO_SHIP' }], orderDetail: {},
    escrowList: [], escrowDetail: {}, returDetail: {},
  };
  const panggil = mockShopee(shopee);
  const pertama = await sinkronkan({ db, panggil, shopId: 's2' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM api_order WHERE order_sn = ?').get('MISS1').n, 0);
  assert.deepEqual(antrean('s2', 'order'), ['MISS1']);
  assert.equal(pertama.orderTerlewat, 1);
  assert.equal(pertama.orderBerubah, 0, 'a missing order is not reported as updated');

  shopee.orderList = []; // the order no longer appears in the (later) update_time window
  shopee.orderDetail.MISS1 = { order_sn: 'MISS1', create_time: now - 86400, update_time: now - 3600, order_status: 'CANCELLED',
    item_list: [{ item_id: 7, model_quantity_purchased: 2, model_discounted_price: 50000 }] };
  const kedua = await sinkronkan({ db, panggil, shopId: 's2' });
  assert.equal(db.prepare('SELECT status FROM api_order WHERE order_sn = ?').get('MISS1').status, 'CANCELLED');
  assert.equal(db.prepare('SELECT SUM(jumlah) AS n FROM api_order_item WHERE order_sn = ?').get('MISS1').n, 2);
  assert.deepEqual(antrean('s2', 'order'), []);
  assert.equal(kedua.orderTerlewat, 0);
});
