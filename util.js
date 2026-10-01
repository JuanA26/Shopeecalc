// Pembantu kecil yang dipakai beberapa modul server (sinkron, analisis, ekspor, server.js).
// Semua tanggal berbentuk 'YYYY-MM-DD' dalam WIB (GMT+7), zona waktu Shopee Indonesia.

const JAM_WIB = 7 * 3600;

// Tanggal WIB dari unix detik ('' kalau kosong).
const tanggalWib = (ts) => (ts ? new Date((Number(ts) + JAM_WIB) * 1000).toISOString().slice(0, 10) : '');

// Tanggal WIB hari ini.
const hariIniWib = () => tanggalWib(Math.floor(Date.now() / 1000));

// Geser tanggal 'YYYY-MM-DD' sebanyak n hari (boleh minus).
function geserHari(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const tanggalValid = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

// Pecah daftar jadi potongan berukuran paling banyak `ukuran`.
const potong = (daftar, ukuran) => Array.from({ length: Math.ceil(daftar.length / ukuran) }, (_, i) => daftar.slice(i * ukuran, (i + 1) * ukuran));

// Respons Shopee: lempar error yang bisa dibaca kalau ditolak, kalau tidak kembalikan `response`.
function cekError(hasil, namaEndpoint) {
  if (hasil && hasil.error) {
    throw new Error(`Shopee menolak ${namaEndpoint}: ${hasil.error}${hasil.message ? ' — ' + hasil.message : ''}`);
  }
  return (hasil && hasil.response) || {};
}

// Angka HPP dari sel CSV: "48000", "48.000", "Rp 48.000" → 48000. Sel kosong atau bukan angka → null
// (dilewati, bukan disimpan sebagai HPP 0: HPP 0 dihitung untung penuh).
function angkaHpp(teks) {
  let t = String(teks ?? '').replace(/^\s*rp\.?\s*/i, '').replace(/\s/g, '');
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ''); // titik ribuan
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

// Teks aman untuk disisipkan ke HTML balasan server (halaman OAuth).
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

module.exports = { tanggalWib, hariIniWib, geserHari, tanggalValid, potong, cekError, escapeHtml, angkaHpp };
