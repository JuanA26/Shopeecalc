// Membaca file Excel hasil unduhan Shopee (sheet "Penghasilan") dan mengubahnya
// menjadi daftar baris per-produk yang siap dihitung margin-nya.
const XLSX = require('xlsx');

const SHEET_NAME = 'Penghasilan';
const HEADER_ROW = 3; // baris ke-3 (index 2) berisi nama kolom asli dari Shopee

// Nama kolom yang kita butuhkan dari file Shopee, dan nama field internal kita.
const COLUMNS = {
  'Lihat berdasarkan': 'lihatBerdasarkan',
  'No. Pesanan': 'noPesanan',
  'ID Produk': 'idProduk',
  'Nama Produk': 'namaProduk',
  'Waktu Pesanan Dibuat': 'waktuPesanan',
  'Tanggal Dana Dilepaskan': 'tanggalDilepaskan',
  'Total Penghasilan': 'totalPenghasilan',
  'Harga Produk': 'hargaProduk',
  'Jumlah Pengembalian Dana ke Pembeli': 'jumlahPengembalian',
};

function excelSerialToDateString(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number') {
    // Serial tanggal Excel (basis 1899-12-30)
    const d = new Date(Math.round((value - 25569) * 86400 * 1000));
    if (isNaN(d.getTime())) return String(value);
    return d.toISOString().slice(0, 10);
  }
  return String(value);
}

function parseShopeeIncomeFile(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });

  if (!workbook.SheetNames.includes(SHEET_NAME)) {
    const err = new Error(
      `Sheet "${SHEET_NAME}" tidak ditemukan di file ini. Sheet yang ada: ${workbook.SheetNames.join(', ')}`
    );
    err.userFacing = true;
    throw err;
  }

  const sheet = workbook.Sheets[SHEET_NAME];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1, // array-of-arrays, biar kita kontrol posisi header sendiri
    raw: true,
    defval: '',
  });

  if (rows.length < HEADER_ROW) {
    const err = new Error('Format file tidak dikenali (baris header tidak ditemukan).');
    err.userFacing = true;
    throw err;
  }

  const headerRow = rows[HEADER_ROW - 1];
  const colIndexByField = {};
  headerRow.forEach((headerText, idx) => {
    const field = COLUMNS[String(headerText).trim()];
    if (field) colIndexByField[field] = idx;
  });

  const missing = Object.values(COLUMNS).filter((f) => !(f in colIndexByField));
  if (missing.length) {
    const err = new Error(
      `Ada kolom yang tidak ditemukan di file ini (mungkin format Shopee berubah): ${missing.join(', ')}`
    );
    err.userFacing = true;
    throw err;
  }

  const dataRows = rows.slice(HEADER_ROW);
  const items = [];

  for (const row of dataRows) {
    const get = (field) => row[colIndexByField[field]];
    const lihat = String(get('lihatBerdasarkan') || '').trim();

    // Kita hanya ambil baris "Sku": itu adalah baris per unit produk yang terjual,
    // sudah punya bagian Total Penghasilan-nya masing-masing.
    // Baris "Order" adalah baris ringkasan per pesanan (ID/Nama Produk kosong) dan kita lewati.
    if (lihat.toLowerCase() !== 'sku') continue;

    const idProduk = String(get('idProduk') || '').trim();
    const namaProduk = String(get('namaProduk') || '').trim();
    const noPesanan = String(get('noPesanan') || '').trim();

    if (!noPesanan || !idProduk || idProduk === '-') continue;

    const totalPenghasilan = Number(get('totalPenghasilan')) || 0;
    const hargaProduk = Number(get('hargaProduk')) || 0;
    // Shopee mencatat pengembalian dana ke pembeli sebagai angka NEGATIF di kolom ini
    // (mis. -198500 kalau harga produknya 198500). Kita simpan sebagai angka positif
    // (jumlah yang dikembalikan) supaya lebih gampang dipakai di tampilan.
    const jumlahPengembalianMentah = Number(get('jumlahPengembalian')) || 0;
    const jumlahPengembalian = Math.abs(jumlahPengembalianMentah);
    const dikembalikan = jumlahPengembalian > 0;

    items.push({
      noPesanan,
      idProduk,
      namaProduk,
      waktuPesanan: excelSerialToDateString(get('waktuPesanan')),
      tanggalDilepaskan: excelSerialToDateString(get('tanggalDilepaskan')),
      totalPenghasilan,
      hargaProduk,
      dikembalikan,
      jumlahPengembalian,
    });
  }

  if (items.length === 0) {
    const err = new Error(
      'Tidak ada data produk yang terbaca dari file ini. Pastikan ini file "Income" dari Shopee dengan sheet "Penghasilan".'
    );
    err.userFacing = true;
    throw err;
  }

  return items;
}

module.exports = { parseShopeeIncomeFile };
