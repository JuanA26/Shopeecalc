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
