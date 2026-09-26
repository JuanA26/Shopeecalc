const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

// Real schema (db.js) in a throwaway folder; synthetic shop data only.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ekspor-test-'));
process.env.DATA_DIR = dataDir;
const db = require('../db');
const { bacaItemPesanan } = require('../sinkronShopee');
const { susunEkspor } = require('../eksporData');
const { buatXlsx } = require('../xlsx');
after(() => { db.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

const geser = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// Same rule as hitungMargin in server.js: profit = payout − HPP × pcs; returned rows keep their payout balance.
const margin = (items) => {
  const hpp = new Map(db.prepare('SELECT id_produk, hpp FROM product_hpp').all().map((r) => [r.id_produk, r.hpp]));
  return { items: items.map((it) => {
    const h = hpp.has(it.idProduk) ? hpp.get(it.idProduk) : null;
    if (it.dikembalikan) return { ...it, hpp: h, hppTotal: 0, untung: it.totalPenghasilan, marginPersen: null };
    return { ...it, hpp: h, hppTotal: h === null ? null : h * it.jumlah, untung: h === null ? null : it.totalPenghasilan - h * it.jumlah, marginPersen: null };
  }) };
};

// Minimal unzip: central directory → inflate each entry and check its CRC.
function unzip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const hasil = {};
  for (let i = 0; i < n; i++) {
    const crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), off = buf.readUInt32LE(p + 42);
    const nama = buf.toString('utf8', p + 46, p + 46 + nlen);
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const data = zlib.inflateRawSync(buf.subarray(start, start + csize));
    assert.equal(zlib.crc32(data), crc, `crc ${nama}`);
    hasil[nama] = data.toString('utf8');
    p += 46 + nlen;
  }
  return hasil;
}

test('export workbook: store profit per week, change before/after, and a valid xlsx', () => {
  const shop = '123', hariIni = '2026-09-30', ubah = '2026-09-10';
  db.prepare("INSERT INTO product_hpp (id_produk, nama_produk, hpp) VALUES ('A', 'Blus A', 50000)").run();
  const pesanan = db.prepare('INSERT INTO api_pesanan (order_sn, shop_id, waktu_pesanan, tanggal_dilepaskan, escrow_amount) VALUES (?, ?, ?, ?, ?)');
  const item = db.prepare('INSERT INTO api_pesanan_item (order_sn, baris, id_produk, nama_produk, jumlah, harga_produk, total_penghasilan) VALUES (?, 0, ?, ?, 1, ?, ?)');
  const toko = db.prepare('INSERT INTO iklan_toko_harian (shop_id, tanggal, biaya, omzet, omzet_langsung) VALUES (?, ?, ?, ?, ?)');
  const harian = db.prepare("INSERT INTO iklan_harian (campaign_id, tanggal, shop_id, biaya, omzet, omzet_langsung) VALUES ('C1', ?, ?, ?, ?, ?)");
  for (let d = '2026-09-01'; d <= '2026-09-20'; d = geser(d, 1)) {
    const setelah = d > ubah;
    // One order of product A per day (profit 30 rb before, 40 rb after the change).
    pesanan.run(`A${d}`, shop, d, d, setelah ? 90000 : 80000);
    item.run(`A${d}`, 'A', 'Blus A', 100000, setelah ? 90000 : 80000);
    toko.run(shop, d, 10000, 200000, 100000);
    harian.run(d, shop, 10000, 200000, setelah ? 150000 : 100000);
  }
  // Product without HPP on one day: estimated at that week's known margin.
  pesanan.run('B1', shop, '2026-09-02', '2026-09-02', 20000);
  item.run('B1', 'B', 'Celana B', 25000, 20000);
  db.prepare("INSERT INTO iklan_kampanye (campaign_id, shop_id, id_produk, nama_iklan, status, budget_harian, target_roas, mulai, selesai) VALUES ('C1', ?, 'A', 'Iklan A', 'ongoing', 60000, 10.8, '2026-09-01', '')").run(shop);
  db.prepare("INSERT INTO iklan_riwayat_setelan (shop_id, campaign_id, id_produk, tanggal, target_lama, target_baru, modal_lama, modal_baru) VALUES (?, 'C1', 'A', ?, 9, 10.8, 60000, 60000)").run(shop, ubah);

  const sheets = susunEkspor(db, shop, { margin, bacaItemPesanan, rasioPerkiraan: 0.78, hariIni,
    keputusan: [{ idProduk: 'A', namaProduk: 'Blus A', keputusan: 'tunggu', target: 10.8, token: 'ignored' }], versi: 'test', sinkron: { 'sinkron.status': 'sukses' } });
  const s = Object.fromEntries(sheets.map((x) => [x.nama, x]));
  const kol = (nama, k) => s[nama].kolom.indexOf(k);

  // Change history: 7 days before (3–9 Sep) vs after (11–17 Sep), change day skipped.
  const r = s.Riwayat_Setelan.baris[0];
  assert.equal(r[kol('Riwayat_Setelan', 'jenis')], 'target naik');
  assert.equal(r[kol('Riwayat_Setelan', 'sebelum_roas_langsung')], 10);
  assert.equal(r[kol('Riwayat_Setelan', 'sesudah_roas_langsung')], 15);
  assert.equal(r[kol('Riwayat_Setelan', 'sebelum_untung_toko_per_hari')], 20000); // 30 rb − 10 rb ads
  assert.equal(r[kol('Riwayat_Setelan', 'sesudah_untung_toko_per_hari')], 30000);
  assert.equal(r[kol('Riwayat_Setelan', 'matang')], 'ya');

  // Week of Mon 31 Aug: B's 20 rb payout is estimated at A's 37.5% margin (30/80).
  const m = s.Mingguan.baris.find((b) => b[0] === '2026-08-31');
  assert.equal(m[kol('Mingguan', 'untung_diketahui')], 180000); // 6 days × 30 rb
  assert.equal(m[kol('Mingguan', 'untung_perkiraan')], 187500);
  assert.equal(m[kol('Mingguan', 'untung_setelah_iklan')], null, 'week starts before ad data: not complete');
  const w = s.Mingguan.baris.find((b) => b[0] === '2026-09-07');
  assert.equal(w[kol('Mingguan', 'untung_setelah_iklan')], 4 * 30000 + 3 * 40000 - 7 * 10000); // 7–10 Sep before, 11–13 after

  // Current decisions are copied, unknown fields dropped.
  assert.equal(s.Keputusan_Sekarang.baris[0][0], 'A');
  assert.equal(s.Keputusan_Sekarang.baris[0].length, s.Keputusan_Sekarang.kolom.length);
  assert.ok(!JSON.stringify(sheets).includes('access_token'));

  const files = unzip(buatXlsx(sheets));
  assert.ok(files['xl/workbook.xml'].includes('name="Riwayat_Setelan"'));
  assert.equal(Object.keys(files).filter((f) => f.startsWith('xl/worksheets/')).length, sheets.length);
  assert.match(files['xl/worksheets/sheet1.xml'], /<pane ySplit="1"/);
});
