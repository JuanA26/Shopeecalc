// Saran stok untuk halaman Stok (dan satu langkah pendek di Dashboard):
//   "Beli lagi"   — varian yang laku dan habis sebelum barang baru sempat datang;
//   "Cuci gudang" — produk yang tidak laku 60 hari: harga turun supaya uangnya kembali.
// Hanya saran. Harga dan stok tetap diubah orang di Seller Centre (aplikasi baca-saja ke Shopee).
// Aturan (user, 01/10): barang datang ± 1 minggu setelah dipesan; cuci gudang dua tahap 60 / 120 hari.
const { geserHari, tanggalWib } = require('./util');
const { daftarStok, ringkasStok, hitungTerjual } = require('./sinkronStok');
const { STATUS_BUKAN_PENJUALAN } = require('./sinkronShopee');

const LAMA_KIRIM_HARI = 7;     // pesan ke pemasok → stok masuk Shopee
const BATAS_HARI_BELI = 14;    // beli sekarang kalau stok varian habis dalam < 14 hari (kirim 7 + cadangan 7)
const CUKUP_HARI = 28;         // setelah barang datang, stok cukup untuk 4 minggu
const MIN_PCS_PRODUK = 4;      // produk terjual ≥ 4 pcs dalam 30 hari (sama dengan Saran iklan)
const MIN_PCS_VARIAN = 2;      // varian terjual ≥ 2 pcs dalam 30 hari (1 pcs bisa kebetulan)
const BATAS_RETUR = 0.15;      // ≥ 15% pcs diretur dalam 60 hari ...
const MIN_RETUR_PCS = 3;       // ... dan paling sedikit 3 pcs → "jangan beli lagi"
const TAHAP_1_HARI = 60;       // tidak laku 60 hari → turunkan ke harga impas (dana cair = HPP)
const TAHAP_2_HARI = 120;      // tidak laku 120 hari → boleh sampai 30% di bawah HPP
const POTONG_TAHAP_2 = 0.3;
const BULAT_HARGA = 1000;      // harga saran dibulatkan ke atas per Rp 1.000

const hariAntara = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const bulatAtas = (n) => Math.ceil(n / BULAT_HARGA - 1e-9) * BULAT_HARGA;

// Penjualan per produk dan per varian dari baris bacaItemPesanan (60 hari terakhir).
function rekapPenjualan(items, petaHpp, hariIni) {
  const dari30 = geserHari(hariIni, -29);
  const produk = new Map(), varian = new Map();
  for (const it of items) {
    const tgl = String(it.waktuPesanan || '').slice(0, 10);
    const r = produk.get(it.idProduk) || { pcs30: 0, untung30: 0, pcs60: 0, retur60: 0 };
    r.pcs60 += it.jumlah || 0;
    if (it.dikembalikan) r.retur60 += it.jumlah || 0;
    else if (tgl >= dari30) {
      r.pcs30 += it.jumlah || 0;
      const hpp = petaHpp.get(it.idProduk);
      r.untung30 += (it.totalPenghasilan || 0) - (hpp > 0 ? hpp : 0) * (it.jumlah || 0);
      const k = `${it.idProduk}|${it.modelId || ''}`;
      varian.set(k, (varian.get(k) || 0) + (it.jumlah || 0));
    }
    produk.set(it.idProduk, r);
  }
  return { produk, varian };
}

// produk = daftarStok(); varianStok = baris stok_varian; items = bacaItemPesanan 60 hari (hariIni−59 … hariIni).
// Hasil: beli (urut: paling cepat habis, lalu untung per minggu) + jangan (hampir habis, tapi rugi/banyak retur).
function saranBeliLagi({ produk, varianStok, items, petaHpp, hariIni }) {
  const jual = rekapPenjualan(items, petaHpp, hariIni);
  const perProduk = new Map();
  for (const v of varianStok) {
    if (v.status === 'MODEL_UNAVAILABLE') continue;
    if (!perProduk.has(v.id_produk)) perProduk.set(v.id_produk, []);
    perProduk.get(v.id_produk).push(v);
  }
  const beli = [], jangan = [];
  for (const p of produk) {
    const r = jual.produk.get(p.idProduk);
    if (p.status !== 'NORMAL' || p.dihitung === 'tidak-wajar' || !r || r.pcs30 < MIN_PCS_PRODUK) continue;
    const varian = [];
    for (const v of perProduk.get(p.idProduk) || []) {
      const laku = jual.varian.get(`${p.idProduk}|${v.model_id}`) || 0;
      if (laku < MIN_PCS_VARIAN) continue;
      const perHari = laku / 30, sisaHari = Math.floor(v.stok / perHari);
      if (sisaHari >= BATAS_HARI_BELI) continue;
      varian.push({ nama: v.nama_varian || '', stok: v.stok, laku30: laku, sisaHari,
        beli: Math.max(1, Math.ceil(perHari * (LAMA_KIRIM_HARI + CUKUP_HARI) - v.stok)) });
    }
    if (!varian.length) continue;
    varian.sort((a, b) => a.sisaHari - b.sisaHari || b.laku30 - a.laku30);
    const pcsBeli = varian.reduce((t, v) => t + v.beli, 0);
    const adaHpp = p.hpp > 0;
    const baris = {
      idProduk: p.idProduk, nama: p.nama, hpp: p.hpp, varian, pcsBeli, modal: adaHpp ? pcsBeli * p.hpp : null,
      terjual30: r.pcs30, untungMinggu: adaHpp ? Math.round(r.untung30 / 30 * 7) : null, habisDalam: varian[0].sisaHari,
      jangan: adaHpp && r.untung30 <= 0 ? { alasan: 'rugi' }
        : r.retur60 >= MIN_RETUR_PCS && r.retur60 / r.pcs60 >= BATAS_RETUR ? { alasan: 'retur', persen: Math.round(r.retur60 / r.pcs60 * 100) }
        : null,
    };
    (baris.jangan ? jangan : beli).push(baris);
  }
  beli.sort((a, b) => a.habisDalam - b.habisDalam || (b.untungMinggu ?? -Infinity) - (a.untungMinggu ?? -Infinity));
  jangan.sort((a, b) => a.habisDalam - b.habisDalam);
  return {
    beli, jangan,
    ringkas: { produk: beli.length, pcs: beli.reduce((t, b) => t + b.pcsBeli, 0), modal: beli.reduce((t, b) => t + (b.modal || 0), 0),
      tanpaHpp: beli.filter((b) => b.modal === null).length },
  };
}

// produk = daftarStok(); lakuTerakhir = Map idProduk → tanggal pesanan terakhir (bukan batal/belum bayar);
// dataMulai = tanggal pesanan paling awal yang tersimpan (sebelum itu tidak diketahui); rasio = rasio pencairan toko.
// "Tidak laku sejak" = paling akhir dari: pesanan terakhir, produk dibuat, data mulai.
function saranCuciGudang({ produk, lakuTerakhir, dataMulai, hariIni, rasio }) {
  const daftar = [];
  for (const p of produk) {
    if (!(p.stok > 0) || p.dihitung === 'tidak-wajar') continue;
    const terakhir = lakuTerakhir.get(p.idProduk) || '';
    const dibuat = tanggalWib(p.dibuatTs);
    const sejak = [terakhir, dibuat, dataMulai || ''].sort().pop();
    if (!sejak) continue;
    const hari = hariAntara(sejak, hariIni);
    if (hari < TAHAP_1_HARI) continue;
    const tahap = hari >= TAHAP_2_HARI ? 2 : 1;
    const adaHpp = p.hpp > 0;
    const impas = adaHpp ? bulatAtas(p.hpp / rasio) : null;
    const saran = adaHpp ? (tahap === 2 ? bulatAtas(p.hpp * (1 - POTONG_TAHAP_2) / rasio) : impas) : null;
    const sudahTurun = saran !== null && p.hargaMaks > 0 && p.hargaMaks <= saran;
    daftar.push({
      idProduk: p.idProduk, nama: p.nama, status: p.status, stok: p.stok, hpp: p.hpp, modal: p.modal,
      // dariMana: 'laku' (pesanan terakhir) · 'dibuat' (belum pernah laku sejak dibuat) · 'data' (tidak laku sejak awal data; bisa lebih lama)
      hargaMin: p.hargaMin, hargaMaks: p.hargaMaks, sejak, hari, pernahLaku: !!terakhir, dariMana: sejak === terakhir ? 'laku' : sejak === dibuat ? 'dibuat' : 'data', tahap,
      impas, saran, sudahTurun, tahap2Mulai: tahap === 1 ? geserHari(sejak, TAHAP_2_HARI) : null,
      uangKembali: adaHpp ? Math.round(p.stok * (sudahTurun ? p.hargaMaks : saran) * rasio) : null,
    });
  }
  daftar.sort((a, b) => (b.modal ?? -1) - (a.modal ?? -1) || b.stok - a.stok);
  const jumlah = (f) => daftar.filter(f).length;
  return {
    produk: daftar,
    ringkas: { produk: daftar.length, pcs: daftar.reduce((t, p) => t + p.stok, 0), modal: daftar.reduce((t, p) => t + (p.modal || 0), 0),
      tahap2: jumlah((p) => p.tahap === 2), tanpaHpp: jumlah((p) => !(p.hpp > 0)), tersembunyi: jumlah((p) => p.status !== 'NORMAL'),
      perluTurun: jumlah((p) => p.saran !== null && !p.sudahTurun) },
    rasio,
  };
}

// Semua angka halaman Stok dari database (dipakai /api/stok dan sheet Excel, supaya selalu sama).
// bacaItemPesanan dan rasio dioper dari pemanggil (sinkronShopee.js), seperti di eksporData.js.
function hitungStokLengkap(db, shopId, hariIni, { bacaItemPesanan, rasio }) {
  const shop = String(shopId);
  const petaHpp = new Map(db.prepare('SELECT id_produk, hpp FROM product_hpp').all().map((r) => [r.id_produk, r.hpp]));
  const items = bacaItemPesanan(db, shop, geserHari(hariIni, -59), hariIni, rasio);
  const produk = daftarStok(db.prepare('SELECT * FROM stok_produk WHERE shop_id = ?').all(shop), petaHpp, hitungTerjual(items, geserHari(hariIni, -29)));
  const bukan = [...STATUS_BUKAN_PENJUALAN].map((x) => `'${x}'`).join(', ');
  const lakuTerakhir = new Map(db.prepare(`SELECT id_produk, MAX(t) AS t FROM (
      SELECT i.id_produk, o.tanggal_pesanan AS t FROM api_order o JOIN api_order_item i ON i.order_sn = o.order_sn
        WHERE o.shop_id = ? AND o.status NOT IN (${bukan})
      UNION ALL SELECT i.id_produk, substr(p.waktu_pesanan, 1, 10) FROM api_pesanan p JOIN api_pesanan_item i ON i.order_sn = p.order_sn
        WHERE p.shop_id = ? AND p.waktu_pesanan <> '') GROUP BY id_produk`).all(shop, shop).map((r) => [r.id_produk, r.t]));
  const dataMulai = String(db.prepare(`SELECT MIN(t) AS t FROM (SELECT MIN(tanggal_pesanan) AS t FROM api_order WHERE shop_id = ?
    UNION ALL SELECT MIN(waktu_pesanan) FROM api_pesanan WHERE shop_id = ? AND waktu_pesanan <> '')`).get(shop, shop).t || '').slice(0, 10);
  const varianStok = db.prepare('SELECT * FROM stok_varian WHERE shop_id = ?').all(shop);
  return {
    produk, kelompok: ringkasStok(produk),
    // varianSiap false = stok per varian belum pernah tersimpan (sebelum sinkron stok pertama setelah fitur ini).
    beliLagi: { ...saranBeliLagi({ produk, varianStok, items, petaHpp, hariIni }), varianSiap: varianStok.length > 0 },
    cuciGudang: saranCuciGudang({ produk, lakuTerakhir, dataMulai, hariIni, rasio }),
    dataMulai,
  };
}

const ATURAN_STOK = { LAMA_KIRIM_HARI, BATAS_HARI_BELI, CUKUP_HARI, MIN_PCS_PRODUK, MIN_PCS_VARIAN, BATAS_RETUR, MIN_RETUR_PCS,
  TAHAP_1_HARI, TAHAP_2_HARI, POTONG_TAHAP_2 };

module.exports = { saranBeliLagi, saranCuciGudang, hitungStokLengkap, ATURAN_STOK };
