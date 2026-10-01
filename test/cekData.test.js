// Diagnostik data checks (cekData.js): estimate share of the Dashboard week, late failures, multi-pcs price.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Real schema (db.js) in a throwaway folder; no credentials, no network.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cekdata-test-'));
process.env.DATA_DIR = dataDir;
const db = require('../db');
const { perkiraanMingguTerakhir, gagalSetelahTujuhHari, cekHargaMultiPcs } = require('../cekData');
after(() => { db.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

const TOKO = '1';
const HARI = 86400;
const order = db.prepare('INSERT INTO api_order (order_sn, shop_id, tanggal_pesanan, create_time, update_time, status) VALUES (?, ?, ?, ?, ?, ?)');
const orderItem = db.prepare('INSERT INTO api_order_item (order_sn, baris, id_produk, model_id, jumlah, harga_satuan) VALUES (?, ?, ?, ?, ?, ?)');
const pesanan = db.prepare('INSERT INTO api_pesanan (order_sn, shop_id, waktu_pesanan, tanggal_dilepaskan, escrow_amount) VALUES (?, ?, ?, ?, ?)');
const pesananItem = db.prepare(`INSERT INTO api_pesanan_item (order_sn, baris, id_produk, model_id, jumlah, harga_produk, total_penghasilan, dikembalikan)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
// One order: status, pcs × unit price, days until the last update; `cair` = released lines [pcs, line price, returned].
function pesan(sn, tanggal, status, pcs, satuan, hariUbah = 2, cair = null) {
  const c = Date.parse(tanggal + 'T03:00:00Z') / 1000;
  order.run(sn, TOKO, tanggal, c, c + hariUbah * HARI, status);
  orderItem.run(sn, 1, 'p', 'm', pcs, satuan);
  if (!cair) return;
  pesanan.run(sn, TOKO, tanggal, '2026-09-22', cair.reduce((a, [, h, r]) => a + (r ? 0 : h * 0.8), 0));
  cair.forEach(([n, h, r], i) => pesananItem.run(sn, i + 1, 'p', 'm', n, h, r ? 0 : h * 0.8, r ? 1 : 0));
}

test('Diagnostik checks: estimated share of the headline week, late failures, multi-pcs line price', () => {
  // Headline week for 01/10 = 14–20/09 (the last Monday–Sunday that ended ≥ 7 days ago).
  pesan('lunas', '2026-09-15', 'COMPLETED', 1, 100000, 7, [[1, 100000, false]]);
  pesan('jalan', '2026-09-16', 'SHIPPED', 1, 100000);
  const m = perkiraanMingguTerakhir(db, TOKO, '2026-10-01');
  assert.equal(m.dari, '2026-09-14'); assert.equal(m.sampai, '2026-09-20');
  assert.ok(Math.abs(m.bagian - 0.5) < 0.01, `bagian ${m.bagian}`); // 80 rb paid out + ~80 rb estimated

  // Orders of 03/07–01/09: still a sale after 7 days = 6 pcs; failed later = 3 pcs.
  pesan('selesai', '2026-08-01', 'COMPLETED', 2, 50000, 9, [[2, 100000, false]]);           // multi-pcs, line price = 2 × unit
  pesan('batal-cepat', '2026-08-02', 'CANCELLED', 1, 50000, 1);                             // cancelled within 7 days: not counted
  pesan('batal-telat', '2026-08-03', 'CANCELLED', 1, 50000, 10);                            // failed later
  pesan('retur-jalan', '2026-08-04', 'TO_RETURN', 1, 50000);                                // failed later
  pesan('retur-sebagian', '2026-08-05', 'COMPLETED', 2, 60000, 12, [[1, 60000, false], [1, 60000, true]]); // 1 of 2 returned
  pesan('belum-bayar', '2026-08-06', 'UNPAID', 1, 50000);
  pesan('harga-satuan', '2026-07-01', 'COMPLETED', 3, 40000, 9, [[3, 40000, false]]);       // outside the window; escrow gave one unit
  const g = gagalSetelahTujuhHari(db, TOKO, '2026-10-01');
  assert.equal(g.pcs, 6); assert.equal(g.gagal, 3); assert.equal(g.bagian, 0.5);

  assert.deepEqual(cekHargaMultiPcs(db, TOKO), { dicek: 3, cocok: 2, perPcs: 1, lain: 0, satuDicek: 1, satuCocok: 1 });
});
