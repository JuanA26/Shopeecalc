// HPP per baris: HPP kode barang (tabel hpp_kode) kalau ada, kalau tidak HPP produk (product_hpp).
// Satu tempat untuk semua yang memakai HPP: untung per pesanan (server.js hitungMargin), stok
// (sinkronStok.js / stokSaran.js) dan Excel. Kode dibaca dari nama varian (public/kodeVarian.js).
const { kodeVarian } = require('./public/kodeVarian');

// Peta HPP dari database. hppVarian(idProduk, namaVarian) → HPP per pcs atau null (belum diisi).
function bacaPetaHpp(db) {
  const produk = new Map(db.prepare('SELECT id_produk, hpp FROM product_hpp').all().map((r) => [r.id_produk, r.hpp]));
  const kode = new Map();
  for (const r of db.prepare('SELECT id_produk, kode, hpp FROM hpp_kode').all()) {
    if (!kode.has(r.id_produk)) kode.set(r.id_produk, new Map());
    kode.get(r.id_produk).set(r.kode, r.hpp);
  }
  return {
    produk,
    kode,
    hppVarian(idProduk, namaVarian) {
      const k = kodeVarian(namaVarian);
      const perKode = k && kode.get(idProduk);
      if (perKode && perKode.has(k)) return perKode.get(k);
      return produk.has(idProduk) ? produk.get(idProduk) : null;
    },
    // Ada HPP apa pun (produk atau salah satu kode) — untuk daftar "belum ada HPP".
    adaHpp: (idProduk) => produk.has(idProduk) || kode.has(idProduk),
  };
}

module.exports = { bacaPetaHpp, kodeVarian };
