// Membaca file Excel hasil unduhan Shopee (sheet "Penghasilan") dan mengubahnya
// menjadi daftar baris per-produk yang siap dihitung margin-nya.
const XLSX = require('xlsx');

// Nama sheet data utama. Untuk rentang tanggal panjang (>~10.000 baris) Shopee
// memecahnya jadi beberapa sheet: "Penghasilan - 1", "Penghasilan - 2", dst. —
// semuanya dibaca lalu digabung (lihat cariSheetPenghasilan()).
const SHEET_PREFIX = 'Penghasilan';
const SHEET_BIAYA = 'Seller Fee'; // rincian biaya per pesanan (ada di file rentang panjang)
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

// File "Income" dari Shopee TIDAK punya kolom jumlah pcs eksplisit. Tapi kalau
// pembeli beli >1 pcs produk yang sama dalam satu pesanan, kadang Shopee
// menggabungkannya ke satu baris Sku dengan "Harga Produk" & "Total Penghasilan"
// yang sudah dikali jumlah pcs-nya (bukan 1 baris = 1 pcs seperti baris lainnya) —
// kalau tidak dikoreksi, HPP cuma dikurangi 1x padahal harusnya dikali jumlah pcs,
// sehingga Untung jadi jauh lebih besar dari yang sebenarnya.
//
// Caranya mendeteksi: harga jual 1 pcs suatu produk biasanya konsisten di seluruh
// file (dari baris-baris lain yang murni 1 pcs). Jadi kita ambil "Harga Produk"
// TERKECIL yang pernah muncul untuk tiap ID Produk sebagai patokan harga 1 pcs,
// lalu baris lain dibagi dengan patokan itu untuk menebak jumlah pcs-nya
// (dibulatkan ke bilangan bulat terdekat). Sudah diverifikasi manual terhadap
// data asli: pola ini konsisten (rasio harga antar-baris produk yang sama selalu
// kelipatan bulat yang bersih, dan patokan harga 1 pcs-nya cocok dengan pesanan
// lain yang murni 1 pcs untuk produk yang sama).
function hitungJumlahPcsPerBaris(items) {
  const hargaSatuanMinimum = new Map();
  for (const it of items) {
    if (it.hargaProduk > 0) {
      const skrg = hargaSatuanMinimum.get(it.idProduk);
      if (skrg === undefined || it.hargaProduk < skrg) hargaSatuanMinimum.set(it.idProduk, it.hargaProduk);
    }
  }
  for (const it of items) {
    const hargaSatuan = hargaSatuanMinimum.get(it.idProduk);
    it.jumlah = hargaSatuan ? Math.max(1, Math.round(it.hargaProduk / hargaSatuan)) : 1;
  }
}

// Semua sheet yang namanya "Penghasilan" atau "Penghasilan - N", diurutkan sesuai N
// supaya urutan baris di hasil gabungan sama seperti di file aslinya.
function cariSheetPenghasilan(workbook) {
  return workbook.SheetNames
    .map((nama) => {
      const m = nama.trim().match(new RegExp(`^${SHEET_PREFIX}(?:\\s*-\\s*(\\d+))?$`, 'i'));
      return m ? { nama, urutan: m[1] ? Number(m[1]) : 0 } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.urutan - b.urutan)
    .map((x) => x.nama);
}

// Membaca satu sheet Penghasilan menjadi daris baris item (belum dihitung jumlah pcs-nya).
function bacaSheetPenghasilan(sheet, namaSheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1, // array-of-arrays, biar kita kontrol posisi header sendiri
    raw: true,
    defval: '',
  });

  if (rows.length < HEADER_ROW) {
    const err = new Error(`Format file tidak dikenali (baris header tidak ditemukan di sheet "${namaSheet}").`);
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
      `Ada kolom yang tidak ditemukan di sheet "${namaSheet}" (mungkin format Shopee berubah): ${missing.join(', ')}`
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

  return items;
}

// Sheet "Seller Fee" (hanya ada di file rentang panjang): satu baris per pesanan dengan
// rincian biaya yang dipotong Shopee, dikelompokkan jadi 5 kategori. Angkanya NEGATIF di
// file (potongan) — kita simpan sebagai angka positif "biaya". Dipakai nanti untuk melihat
// biaya per kategori (Gratis Ongkir XTRA, Promo XTRA, dll) — kalau sheet-nya tidak ada,
// hasilnya map kosong dan tidak apa-apa.
const KOLOM_BIAYA = {
  'No. Pesanan': 'noPesanan',
  'Biaya Platform': 'platform',
  'Biaya Gratis Ongkir XTRA': 'gratisOngkirXtra',
  'Biaya Layanan': 'layanan',
  'Biaya Promosi': 'promosi',
  'Biaya Lainnya': 'lainnya',
};

function bacaSheetBiaya(workbook) {
  const biayaPerPesanan = new Map();
  const sheet = workbook.Sheets[SHEET_BIAYA];
  if (!sheet) return biayaPerPesanan;

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  // Baris header tidak selalu di posisi yang sama (baris 1 biasanya kosong) — cari
  // baris pertama yang memuat "No. Pesanan".
  const idxHeader = rows.findIndex((r) => r.some((c) => String(c).trim() === 'No. Pesanan'));
  if (idxHeader === -1) return biayaPerPesanan;

  const colIndexByField = {};
  rows[idxHeader].forEach((headerText, idx) => {
    const field = KOLOM_BIAYA[String(headerText).trim()];
    if (field) colIndexByField[field] = idx;
  });
  if (!('noPesanan' in colIndexByField)) return biayaPerPesanan;

  for (const row of rows.slice(idxHeader + 1)) {
    const noPesanan = String(row[colIndexByField.noPesanan] || '').trim();
    if (!noPesanan) continue;
    const ambil = (field) => (field in colIndexByField ? Math.abs(Number(row[colIndexByField[field]]) || 0) : 0);
    biayaPerPesanan.set(noPesanan, {
      platform: ambil('platform'),
      gratisOngkirXtra: ambil('gratisOngkirXtra'),
      layanan: ambil('layanan'),
      promosi: ambil('promosi'),
      lainnya: ambil('lainnya'),
    });
  }
  return biayaPerPesanan;
}

// Membaca seluruh workbook: gabungan semua sheet Penghasilan + (kalau ada) rincian biaya.
// Mengembalikan { items, biayaPerPesanan }.
function parseShopeeIncomeWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });

  const namaSheet = cariSheetPenghasilan(workbook);
  if (namaSheet.length === 0) {
    const err = new Error(
      `Sheet "${SHEET_PREFIX}" tidak ditemukan di file ini. Sheet yang ada: ${workbook.SheetNames.join(', ')}`
    );
    err.userFacing = true;
    throw err;
  }

  const items = [];
  for (const nama of namaSheet) {
    items.push(...bacaSheetPenghasilan(workbook.Sheets[nama], nama));
  }

  if (items.length === 0) {
    const err = new Error(
      'Tidak ada data produk yang terbaca dari file ini. Pastikan ini file "Income" dari Shopee dengan sheet "Penghasilan".'
    );
    err.userFacing = true;
    throw err;
  }

  // Jumlah pcs ditebak dari harga terkecil per produk di SELURUH file, jadi harus
  // dijalankan setelah semua sheet digabung (bukan per sheet).
  hitungJumlahPcsPerBaris(items);

  return { items, biayaPerPesanan: bacaSheetBiaya(workbook), sheetTerbaca: namaSheet };
}

// Dipertahankan untuk kompatibilitas: hanya daftar item-nya.
function parseShopeeIncomeFile(buffer) {
  return parseShopeeIncomeWorkbook(buffer).items;
}

module.exports = { parseShopeeIncomeFile, parseShopeeIncomeWorkbook };
