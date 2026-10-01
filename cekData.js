// Data checks for Pengaturan → Diagnostik (and the Excel Status sheet). Read-only queries on the stored
// orders; they answer open questions about the profit maths (reports/system-check-2026-10-01.md D, E).
const { bacaItemPesanan, rasioPencairanToko } = require('./sinkronShopee');
const { RASIO_PENCAIRAN_DEFAULT } = require('./public/ekonomiProduk');
const { geserHari } = require('./util');

// Dashboard headline week (last Monday–Sunday that ended ≥ 7 days ago): how much of its payout is still an
// estimate (price × payout ratio, not yet released). Estimates stay at full value until an order fails.
function perkiraanMingguTerakhir(db, shopId, hariIni) {
  const akhir = geserHari(hariIni, -7);
  let dari = geserHari(akhir, -((new Date(akhir + 'T00:00:00Z').getUTCDay() + 6) % 7));
  if (geserHari(dari, 6) > akhir) dari = geserHari(dari, -7);
  const sampai = geserHari(dari, 6);
  let total = 0, perkiraan = 0;
  for (const it of bacaItemPesanan(db, shopId, dari, sampai, rasioPencairanToko(db, shopId) || RASIO_PENCAIRAN_DEFAULT)) {
    if (it.dikembalikan) continue;
    total += it.totalPenghasilan || 0;
    if (it.perkiraan) perkiraan += it.totalPenghasilan || 0;
  }
  return { dari, sampai, total, perkiraan, bagian: total ? perkiraan / total : null };
}

// Orders created 90–30 days ago (final now): share of pcs, still a sale 7 days after ordering, that later
// failed (cancelled ≥ 7 days after ordering, TO_RETURN, or returned after payout). Upper bound: the time of a
// return is unknown, so every return counts. Tells whether estimated payouts need a discount.
function gagalSetelahTujuhHari(db, shopId, hariIni) {
  const dari = geserHari(hariIni, -90), sampai = geserHari(hariIni, -30);
  const r = db.prepare(
    `WITH o AS (
       SELECT o.status, o.create_time AS c, o.update_time AS u,
         (SELECT COALESCE(SUM(jumlah), 0) FROM api_order_item i WHERE i.order_sn = o.order_sn) AS pcs,
         (SELECT COALESCE(SUM(jumlah), 0) FROM api_pesanan_item r WHERE r.order_sn = o.order_sn AND r.dikembalikan = 1) AS retur
       FROM api_order o WHERE o.shop_id = ? AND o.tanggal_pesanan BETWEEN ? AND ?)
     SELECT
       SUM(CASE WHEN status = 'UNPAID' THEN 0
                WHEN status IN ('CANCELLED', 'IN_CANCEL') AND (c IS NULL OR u IS NULL OR u - c < 604800) THEN 0
                ELSE pcs END) AS dasar,
       SUM(CASE WHEN status IN ('CANCELLED', 'IN_CANCEL') AND c IS NOT NULL AND u IS NOT NULL AND u - c >= 604800 THEN pcs
                WHEN status = 'TO_RETURN' THEN pcs
                ELSE MIN(retur, pcs) END) AS gagal
     FROM o`
  ).get(String(shopId), dari, sampai) || {};
  return { dari, sampai, pcs: r.dasar || 0, gagal: r.gagal || 0, bagian: r.dasar ? r.gagal / r.dasar : null };
}

// Escrow items[].discounted_price is read as the LINE subtotal (susunBarisPesanan). Check it on released
// multi-pcs lines against the order detail (model_discounted_price is per pcs, verified): stored line price
// ≈ unit × pcs → right; ≈ one unit → escrow gives a unit price and multi-pcs prices are too low.
function cekHargaMultiPcs(db, shopId) {
  const rows = db.prepare(
    `WITH e AS (SELECT order_sn, id_produk, COALESCE(model_id, '') AS m, SUM(jumlah) AS j, SUM(harga_produk) AS h
                FROM api_pesanan_item GROUP BY order_sn, id_produk, COALESCE(model_id, '')),
          d AS (SELECT order_sn, id_produk, COALESCE(model_id, '') AS m, SUM(jumlah) AS j, MAX(harga_satuan) AS s
                FROM api_order_item GROUP BY order_sn, id_produk, COALESCE(model_id, ''))
     SELECT d.j, d.s, e.h FROM e JOIN d ON d.order_sn = e.order_sn AND d.id_produk = e.id_produk AND d.m = e.m
     JOIN api_pesanan p ON p.order_sn = e.order_sn
     WHERE p.shop_id = ? AND d.j = e.j AND d.s > 0`
  ).all(String(shopId));
  const hasil = { dicek: 0, cocok: 0, perPcs: 0, lain: 0, satuDicek: 0, satuCocok: 0 };
  const dekat = (a, b) => Math.abs(a - b) <= 0.02 * b;
  for (const r of rows) {
    if (r.j === 1) { hasil.satuDicek += 1; if (dekat(r.h, r.s)) hasil.satuCocok += 1; continue; }
    hasil.dicek += 1;
    if (dekat(r.h, r.s * r.j)) hasil.cocok += 1;
    else if (dekat(r.h, r.s)) hasil.perPcs += 1;
    else hasil.lain += 1;
  }
  return hasil;
}

module.exports = { perkiraanMingguTerakhir, gagalSetelahTujuhHari, cekHargaMultiPcs };
