/* Kode barang dari nama varian Shopee, dipakai server (HPP per kode) dan browser (tab HPP).
   Satu listing sering berisi beberapa barang berbeda (kode 9669, 2190.2, 0510 ...), masing-masing
   dengan harga jual dan HPP sendiri. Nama varian toko ini ditulis "<kode> <warna>", kadang dengan
   ukuran sesudah koma: "2190.2 Blue", "21031-R Brown", "[9918-1] Hitam", "KODE 35", "2502-3 A10,Ivory".
   Kode = awal pilihan pertama (sebelum koma) yang memuat angka. Tanpa kode ("Hitam", "P 0 l 0 Coffee")
   → null: baris itu memakai HPP produk. 0510 dan 510 sengaja dibedakan (barang berbeda, harga beda). */
(function (root) {
  // Awalan opsional 0–2 huruf (A-2602, C3630, V32), angka, lalu potongan ".1" "-3" "/N01" "-P010",
  // lalu satu huruf akhiran yang tidak diikuti huruf lain, boleh diikuti angka (21031-R, 71107B, P0L0;
  // bukan "2096-Dusty").
  const POLA_KODE = /^([A-Z]{0,2}-?\d+(?:[.\-/][A-Z]{0,2}\d+)*(?:-?[A-Z](?![A-Z])\d*)?)/;
  // Ukuran yang kebetulan berangka (3XL, 4L) bukan kode.
  const POLA_UKURAN = /^\d?X{0,3}L$/;

  function kodeVarian(namaModel) {
    let t = String(namaModel || '').split(',')[0].trim().toUpperCase();
    t = t.replace(/^(?:KODE|MODEL)\s+/, '').replace(/^[[(]\s*/, '');
    const m = t.match(POLA_KODE);
    if (!m || !/\d/.test(m[1])) return null;
    const kode = m[1];
    const sisa = t.slice(kode.length);
    if (POLA_UKURAN.test(kode + (sisa.match(/^[A-Z]*/) || [''])[0])) return null;
    return kode;
  }

  const api = { kodeVarian };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KodeVarian = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
