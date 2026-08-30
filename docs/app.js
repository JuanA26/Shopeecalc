// ============================================================================
// Kalkulator Untung Toko Shopee — versi statis (tanpa server).
// Semua pemrosesan (baca Excel, hitung margin, simpan HPP) terjadi di browser
// ini saja. Daftar HPP disimpan sebagai file CSV yang Anda unduh/unggah sendiri,
// plus disalin otomatis ke localStorage browser ini sebagai cadangan ringan.
// ============================================================================

// ====== Util tampilan ======
const formatRupiah = (angka) => {
  if (angka === null || angka === undefined || isNaN(angka)) return '-';
  return 'Rp ' + Math.round(angka).toLocaleString('id-ID');
};
const formatPersen = (angka) => {
  if (angka === null || angka === undefined || isNaN(angka)) return '-';
  return angka.toFixed(1).replace('.', ',') + '%';
};
const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const potongNama = (nama, maxKarakter = 80) => {
  const teks = String(nama ?? '');
  if (teks.length <= maxKarakter) return teks;
  return teks.slice(0, maxKarakter).trimEnd() + '…';
};

function waktuSekarang() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ====== Baca file Excel Shopee (dijalankan di browser lewat SheetJS) ======
const SHEET_NAME = 'Penghasilan';
const HEADER_ROW = 3;
const KOLOM_EXCEL = {
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

function excelSerialKeTanggal(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number') {
    const d = new Date(Math.round((value - 25569) * 86400 * 1000));
    if (isNaN(d.getTime())) return String(value);
    return d.toISOString().slice(0, 10);
  }
  return String(value);
}

async function bacaFileShopee(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });

  if (!workbook.SheetNames.includes(SHEET_NAME)) {
    throw new Error(`Sheet "${SHEET_NAME}" tidak ditemukan di file ini. Sheet yang ada: ${workbook.SheetNames.join(', ')}`);
  }

  const sheet = workbook.Sheets[SHEET_NAME];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });

  if (rows.length < HEADER_ROW) {
    throw new Error('Format file tidak dikenali (baris header tidak ditemukan).');
  }

  const headerRow = rows[HEADER_ROW - 1];
  const colIndexByField = {};
  headerRow.forEach((headerText, idx) => {
    const field = KOLOM_EXCEL[String(headerText).trim()];
    if (field) colIndexByField[field] = idx;
  });

  const missing = Object.values(KOLOM_EXCEL).filter((f) => !(f in colIndexByField));
  if (missing.length) {
    throw new Error(`Ada kolom yang tidak ditemukan di file ini (mungkin format Shopee berubah): ${missing.join(', ')}`);
  }

  const dataRows = rows.slice(HEADER_ROW);
  const items = [];

  for (const row of dataRows) {
    const get = (field) => row[colIndexByField[field]];
    const lihat = String(get('lihatBerdasarkan') || '').trim();

    // Hanya baris "Sku" (per unit produk terjual, sudah punya bagian Total
    // Penghasilan-nya masing-masing). Baris "Order" (ringkasan per pesanan) dilewati.
    if (lihat.toLowerCase() !== 'sku') continue;

    const idProduk = String(get('idProduk') || '').trim();
    const namaProduk = String(get('namaProduk') || '').trim();
    const noPesanan = String(get('noPesanan') || '').trim();
    if (!noPesanan || !idProduk || idProduk === '-') continue;

    const totalPenghasilan = Number(get('totalPenghasilan')) || 0;
    const hargaProduk = Number(get('hargaProduk')) || 0;
    const jumlahPengembalian = Math.abs(Number(get('jumlahPengembalian')) || 0);
    const dikembalikan = jumlahPengembalian > 0;

    items.push({
      noPesanan, idProduk, namaProduk,
      waktuPesanan: excelSerialKeTanggal(get('waktuPesanan')),
      tanggalDilepaskan: excelSerialKeTanggal(get('tanggalDilepaskan')),
      totalPenghasilan, hargaProduk, dikembalikan, jumlahPengembalian,
    });
  }

  if (items.length === 0) {
    throw new Error('Tidak ada data produk yang terbaca dari file ini. Pastikan ini file "Income" dari Shopee dengan sheet "Penghasilan".');
  }

  return items;
}

// ====== Hitung margin (Untung = Total Penghasilan − HPP) ======
function hitungMargin(items, daftarHppMap) {
  let totalPenghasilan = 0, totalHpp = 0, totalUntung = 0, jumlahBelumAdaHpp = 0, jumlahDikembalikan = 0;

  const hasil = items.map((item) => {
    const rec = daftarHppMap.get(item.idProduk);
    const punyaHpp = !!rec;
    const hpp = punyaHpp ? rec.hpp : null;

    totalPenghasilan += item.totalPenghasilan;

    // Pesanan yang dikembalikan/di-refund: barangnya kembali ke penjual, jadi HPP
    // tidak dianggap hilang — bukan untung, tapi juga bukan rugi.
    if (item.dikembalikan) {
      jumlahDikembalikan += 1;
      return { ...item, hpp, untung: 0, marginPersen: null };
    }

    const untung = punyaHpp ? item.totalPenghasilan - hpp : null;
    const marginPersen = punyaHpp && item.totalPenghasilan !== 0 ? (untung / item.totalPenghasilan) * 100 : null;

    if (punyaHpp) { totalHpp += hpp; totalUntung += untung; } else { jumlahBelumAdaHpp += 1; }

    return { ...item, hpp, untung, marginPersen };
  });

  const ringkasan = {
    jumlahBaris: hasil.length,
    totalPenghasilan, totalHpp, totalUntung,
    marginRataRataPersen: totalPenghasilan !== 0 ? (totalUntung / totalPenghasilan) * 100 : null,
    jumlahBelumAdaHpp, jumlahDikembalikan,
  };

  return { items: hasil, ringkasan };
}

// ====== CSV (format untuk daftar HPP) ======
const HEADER_CSV = ['ID Produk', 'Nama Produk', 'Harga Modal (HPP)', 'Terakhir Diubah'];

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function daftarHppKeCsv(daftarHppMap) {
  const baris = [HEADER_CSV.join(',')];
  for (const r of daftarHppMap.values()) {
    baris.push([csvEscape(r.id_produk), csvEscape(r.nama_produk), csvEscape(r.hpp), csvEscape(r.terakhir_diubah)].join(','));
  }
  return '﻿' + baris.join('\r\n'); // BOM di depan supaya Excel baca UTF-8 dgn benar
}

function parseCsvMentah(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\r') {
      // dilewati, ditangani lewat karakter \n
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

function csvKeDaftarHpp(text) {
  const rows = parseCsvMentah(text);
  if (rows.length < 1) throw new Error('File CSV kosong.');

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = {
    id: header.findIndex((h) => h.includes('id produk') || h === 'id_produk' || h === 'id'),
    nama: header.findIndex((h) => h.includes('nama produk') || h === 'nama_produk' || h === 'nama'),
    hpp: header.findIndex((h) => h.includes('harga modal') || h.includes('hpp')),
    diubah: header.findIndex((h) => h.includes('terakhir') || h.includes('diubah')),
  };
  if (idx.id === -1 || idx.hpp === -1) {
    throw new Error('Format CSV tidak dikenali — pastikan ada kolom "ID Produk" dan "Harga Modal (HPP)".');
  }

  const map = new Map();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;
    const id = (r[idx.id] || '').trim();
    if (!id) continue;
    const hpp = Number(r[idx.hpp]) || 0;
    const nama = idx.nama !== -1 ? (r[idx.nama] || '').trim() : '';
    const diubah = idx.diubah !== -1 ? (r[idx.diubah] || '').trim() : '';
    map.set(id, { id_produk: id, nama_produk: nama, hpp, terakhir_diubah: diubah || waktuSekarang() });
  }
  return map;
}

function unduhTeks(namaFile, teks, tipe = 'text/csv;charset=utf-8') {
  const blob = new Blob([teks], { type: tipe });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = namaFile;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ====== State ======
const LS_KEY = 'shopee_margin_calc_hpp_v1';
let daftarHpp = new Map(); // id_produk -> { id_produk, nama_produk, hpp, terakhir_diubah }
let dataHasilUpload = null; // { items, ringkasan }
let adaPerubahanBelumDiunduh = false;

function muatDariLocalStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) daftarHpp = new Map(arr.map((r) => [r.id_produk, r]));
  } catch (e) {
    console.warn('Gagal membaca cadangan HPP dari localStorage:', e);
  }
}

function simpanKeLocalStorage() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify([...daftarHpp.values()]));
  } catch (e) {
    console.warn('Gagal menyimpan cadangan HPP ke localStorage (mode privat?):', e);
  }
}

function tandaiBelumDiunduh(status) {
  adaPerubahanBelumDiunduh = status;
  document.getElementById('pesanBelumDiunduh').classList.toggle('tersembunyi', !status);
}

window.addEventListener('beforeunload', (e) => {
  if (!adaPerubahanBelumDiunduh) return;
  e.preventDefault();
  e.returnValue = '';
});

// ====== Elemen ======
const inputFile = document.getElementById('inputFile');
const tombolProses = document.getElementById('tombolProses');
const pesanErrorUpload = document.getElementById('pesanErrorUpload');
const pesanLoading = document.getElementById('pesanLoading');
const areaRingkasan = document.getElementById('areaRingkasan');
const inputCari = document.getElementById('inputCari');
const isiTabelData = document.getElementById('isiTabelData');

const inputCariHpp = document.getElementById('inputCariHpp');
const hppBaruId = document.getElementById('hppBaruId');
const hppBaruNama = document.getElementById('hppBaruNama');
const hppBaruNilai = document.getElementById('hppBaruNilai');
const tombolTambahHpp = document.getElementById('tombolTambahHpp');
const pesanErrorHpp = document.getElementById('pesanErrorHpp');
const isiTabelHpp = document.getElementById('isiTabelHpp');

const tombolUnduhCsv = document.getElementById('tombolUnduhCsv');
const inputCsv = document.getElementById('inputCsv');
const tombolUnggahCsv = document.getElementById('tombolUnggahCsv');
const pesanCsv = document.getElementById('pesanCsv');

// ====== Tab ======
document.querySelectorAll('.tab-tombol').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-tombol').forEach((b) => b.classList.remove('aktif'));
    document.querySelectorAll('.tab-isi').forEach((s) => s.classList.remove('aktif'));
    btn.classList.add('aktif');
    document.getElementById(btn.dataset.tab).classList.add('aktif');
  });
});

// ====== Upload & Hitung ======
inputFile.addEventListener('change', () => {
  tombolProses.disabled = !inputFile.files.length;
});

tombolProses.addEventListener('click', async () => {
  if (!inputFile.files.length) return;
  pesanErrorUpload.classList.add('tersembunyi');
  pesanLoading.classList.remove('tersembunyi');
  areaRingkasan.classList.add('tersembunyi');
  tombolProses.disabled = true;

  try {
    const items = await bacaFileShopee(inputFile.files[0]);
    dataHasilUpload = hitungMargin(items, daftarHpp);
    renderRingkasan(dataHasilUpload.ringkasan);
    renderTabelData(dataHasilUpload.items);
    renderTabelHpp();
    areaRingkasan.classList.remove('tersembunyi');
  } catch (err) {
    console.error(err);
    pesanErrorUpload.textContent = err.message || 'Gagal membaca file ini. Pastikan ini file Excel "Income" asli dari Shopee.';
    pesanErrorUpload.classList.remove('tersembunyi');
  } finally {
    pesanLoading.classList.add('tersembunyi');
    tombolProses.disabled = false;
  }
});

function renderRingkasan(r) {
  document.getElementById('ringkasanPendapatan').textContent = formatRupiah(r.totalPenghasilan);
  document.getElementById('ringkasanUntung').textContent = formatRupiah(r.totalUntung);
  document.getElementById('ringkasanMargin').textContent = formatPersen(r.marginRataRataPersen);
  document.getElementById('ringkasanBelumHpp').textContent = `${r.jumlahBelumAdaHpp} produk`;
  document.getElementById('kartuBelumHpp').classList.toggle('tersembunyi', r.jumlahBelumAdaHpp === 0);
  document.getElementById('ringkasanDikembalikan').textContent = `${r.jumlahDikembalikan || 0} pesanan`;
  document.getElementById('kartuDikembalikan').classList.toggle('tersembunyi', !r.jumlahDikembalikan);
}

function renderTabelData(items) {
  const kataKunci = inputCari.value.trim().toLowerCase();
  const filtered = !kataKunci
    ? items
    : items.filter((it) =>
        [it.noPesanan, it.namaProduk, it.idProduk].some((v) => String(v).toLowerCase().includes(kataKunci))
      );

  if (!filtered.length) {
    isiTabelData.innerHTML = `<tr><td colspan="9" class="teks-redup">Tidak ada data yang cocok.</td></tr>`;
    return;
  }

  isiTabelData.innerHTML = filtered
    .map((it) => {
      const punyaHpp = it.hpp !== null && it.hpp !== undefined;
      const kelasBaris = it.dikembalikan ? 'baris-dikembalikan' : (punyaHpp ? '' : 'baris-peringatan');
      const kelasUntung = it.dikembalikan ? 'teks-redup' : punyaHpp ? (it.untung >= 0 ? 'untung-positif' : 'untung-negatif') : 'teks-redup';

      const selHpp = it.dikembalikan
        ? '<span class="teks-redup" title="Tidak relevan — pesanan ini dikembalikan.">-</span>'
        : punyaHpp
        ? formatRupiah(it.hpp)
        : `<div class="sel-hpp-cepat">
             <input type="number" class="input-hpp-cepat" placeholder="Isi HPP" min="0"
                    data-id="${escapeHtml(it.idProduk)}" data-nama="${escapeHtml(it.namaProduk)}">
             <button type="button" class="tombol tombol-mini simpan-hpp-cepat"
                     data-id="${escapeHtml(it.idProduk)}" data-nama="${escapeHtml(it.namaProduk)}">Simpan</button>
           </div>`;

      const totalPenghasilanTampil = it.dikembalikan
        ? `${formatRupiah(it.totalPenghasilan)}<span class="tag-refund" title="Pesanan ini dikembalikan / di-refund ke pembeli sebesar ${formatRupiah(it.jumlahPengembalian)} (menurut kolom &quot;Jumlah Pengembalian Dana ke Pembeli&quot; di file Shopee).">↩ Dikembalikan</span>`
        : formatRupiah(it.totalPenghasilan);

      const untungTampil = it.dikembalikan
        ? '<span title="Barang dikembalikan ke Anda, jadi tidak dihitung untung maupun rugi.">Rp 0</span>'
        : punyaHpp ? formatRupiah(it.untung) : 'Belum diisi';
      const marginTampil = it.dikembalikan ? '-' : punyaHpp ? formatPersen(it.marginPersen) : '-';

      return `
        <tr class="${kelasBaris}">
          <td data-label="No. Pesanan">${escapeHtml(it.noPesanan)}</td>
          <td data-label="Tanggal Pesanan">${escapeHtml(it.waktuPesanan)}</td>
          <td data-label="Tanggal Dana Cair">${escapeHtml(it.tanggalDilepaskan)}</td>
          <td class="kolom-nama" data-label="Nama Produk" title="${escapeHtml(it.namaProduk)}">${escapeHtml(potongNama(it.namaProduk))}</td>
          <td data-label="ID Produk">${escapeHtml(it.idProduk)}</td>
          <td class="kolom-total" data-label="Total Penghasilan">${totalPenghasilanTampil}</td>
          <td class="kolom-hpp" data-label="Harga Modal (HPP)">${selHpp}</td>
          <td class="${kelasUntung}" data-label="Untung">${untungTampil}</td>
          <td class="${kelasUntung}" data-label="Margin %">${marginTampil}</td>
        </tr>`;
    })
    .join('');

  isiTabelData.querySelectorAll('.simpan-hpp-cepat').forEach((tombol) => {
    tombol.addEventListener('click', () => {
      const input = tombol.parentElement.querySelector('.input-hpp-cepat');
      simpanHpp(tombol.dataset.id, tombol.dataset.nama, input.value);
    });
  });
  isiTabelData.querySelectorAll('.input-hpp-cepat').forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      simpanHpp(input.dataset.id, input.dataset.nama, input.value);
    });
  });
}

// Simpan satu nilai HPP ke daftar (Map + localStorage), lalu refresh kedua tabel.
function simpanHpp(idProduk, namaProduk, nilaiMentah) {
  const nilai = Number(nilaiMentah);
  if (!Number.isFinite(nilai) || nilai < 0) {
    alert('Isi Harga Modal (HPP) dengan angka yang benar (tidak boleh kosong / minus) sebelum menyimpan.');
    return;
  }
  const existing = daftarHpp.get(idProduk);
  daftarHpp.set(idProduk, {
    id_produk: idProduk,
    nama_produk: namaProduk || (existing && existing.nama_produk) || '',
    hpp: nilai,
    terakhir_diubah: waktuSekarang(),
  });
  simpanKeLocalStorage();
  tandaiBelumDiunduh(true);
  hitungUlangDanTampilkanUlang();
}

function hapusHpp(idProduk) {
  daftarHpp.delete(idProduk);
  simpanKeLocalStorage();
  tandaiBelumDiunduh(true);
  hitungUlangDanTampilkanUlang();
}

function hitungUlangDanTampilkanUlang() {
  if (dataHasilUpload) {
    dataHasilUpload = hitungMargin(dataHasilUpload.items, daftarHpp);
    renderRingkasan(dataHasilUpload.ringkasan);
    renderTabelData(dataHasilUpload.items);
  }
  renderTabelHpp();
}

inputCari.addEventListener('input', () => {
  if (dataHasilUpload) renderTabelData(dataHasilUpload.items);
});

// ====== Tab HPP ======
function gabunganProdukUntukTabelHpp() {
  const sudahAda = new Set(daftarHpp.keys());
  const belumPunyaHpp = [];
  if (dataHasilUpload) {
    for (const it of dataHasilUpload.items) {
      if (sudahAda.has(it.idProduk) || belumPunyaHpp.some((r) => r.id_produk === it.idProduk)) continue;
      belumPunyaHpp.push({ id_produk: it.idProduk, nama_produk: it.namaProduk, hpp: null, terakhir_diubah: null });
    }
  }
  return [...belumPunyaHpp, ...daftarHpp.values()];
}

function renderTabelHpp() {
  const kataKunci = inputCariHpp.value.trim().toLowerCase();
  const semua = gabunganProdukUntukTabelHpp();
  const filtered = !kataKunci
    ? semua
    : semua.filter((r) => [r.id_produk, r.nama_produk].some((v) => String(v).toLowerCase().includes(kataKunci)));

  if (!filtered.length) {
    isiTabelHpp.innerHTML = `<tr><td colspan="5" class="teks-redup">Belum ada produk. Tambahkan di atas, atau unggah file dulu di tab "Unggah &amp; Lihat Data".</td></tr>`;
    return;
  }

  isiTabelHpp.innerHTML = filtered
    .map((r) => {
      const punyaHpp = r.hpp !== null;
      const selHpp = punyaHpp
        ? `<input type="number" class="input-hpp-tabel" min="0" value="${r.hpp}" data-id="${escapeHtml(r.id_produk)}" data-nama="${escapeHtml(r.nama_produk || '')}">`
        : `<div class="sel-hpp-cepat">
             <input type="number" class="input-hpp-tabel-baru" placeholder="Isi HPP" min="0" data-id="${escapeHtml(r.id_produk)}" data-nama="${escapeHtml(r.nama_produk || '')}">
             <button type="button" class="tombol tombol-mini simpan-hpp-tabel-baru" data-id="${escapeHtml(r.id_produk)}" data-nama="${escapeHtml(r.nama_produk || '')}">Simpan</button>
           </div>`;

      return `
        <tr class="${punyaHpp ? '' : 'baris-peringatan'}">
          <td data-label="ID Produk">${escapeHtml(r.id_produk)}</td>
          <td class="kolom-nama" data-label="Nama Produk" title="${escapeHtml(r.nama_produk || '')}">${r.nama_produk ? escapeHtml(potongNama(r.nama_produk)) : '-'}</td>
          <td class="kolom-hpp" data-label="Harga Modal (HPP)">${selHpp}</td>
          <td data-label="Terakhir Diubah">${r.terakhir_diubah ? escapeHtml(r.terakhir_diubah) : '<span class="teks-redup">Belum diisi</span>'}</td>
          <td data-label="">${punyaHpp ? `<button class="tombol tombol-hapus" data-hapus="${escapeHtml(r.id_produk)}">Hapus</button>` : ''}</td>
        </tr>`;
    })
    .join('');

  isiTabelHpp.querySelectorAll('.input-hpp-tabel').forEach((input) => {
    input.addEventListener('change', () => simpanHpp(input.dataset.id, input.dataset.nama, input.value));
  });
  isiTabelHpp.querySelectorAll('.simpan-hpp-tabel-baru').forEach((tombol) => {
    tombol.addEventListener('click', () => {
      const input = tombol.parentElement.querySelector('.input-hpp-tabel-baru');
      simpanHpp(tombol.dataset.id, tombol.dataset.nama, input.value);
    });
  });
  isiTabelHpp.querySelectorAll('.input-hpp-tabel-baru').forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      simpanHpp(input.dataset.id, input.dataset.nama, input.value);
    });
  });
  isiTabelHpp.querySelectorAll('[data-hapus]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!confirm('Hapus harga modal produk ini?')) return;
      hapusHpp(btn.dataset.hapus);
    });
  });
}

inputCariHpp.addEventListener('input', renderTabelHpp);

tombolTambahHpp.addEventListener('click', () => {
  pesanErrorHpp.classList.add('tersembunyi');
  const id = hppBaruId.value.trim();
  const nama = hppBaruNama.value.trim();
  const nilaiMentah = hppBaruNilai.value;

  if (!id) { pesanErrorHpp.textContent = 'ID Produk wajib diisi.'; pesanErrorHpp.classList.remove('tersembunyi'); return; }
  const nilai = Number(nilaiMentah);
  if (!Number.isFinite(nilai) || nilai < 0) { pesanErrorHpp.textContent = 'Harga Modal harus berupa angka.'; pesanErrorHpp.classList.remove('tersembunyi'); return; }

  simpanHpp(id, nama, nilaiMentah);
  hppBaruId.value = '';
  hppBaruNama.value = '';
  hppBaruNilai.value = '';
});

// ====== CSV: unduh / unggah ======
tombolUnduhCsv.addEventListener('click', () => {
  const csv = daftarHppKeCsv(daftarHpp);
  const tanggal = new Date().toISOString().slice(0, 10);
  unduhTeks(`harga-modal-shopee-${tanggal}.csv`, csv);
  tandaiBelumDiunduh(false);
});
document.getElementById('tombolUnduhDariBanner').addEventListener('click', () => tombolUnduhCsv.click());

inputCsv.addEventListener('change', () => {
  tombolUnggahCsv.disabled = !inputCsv.files.length;
});

tombolUnggahCsv.addEventListener('click', async () => {
  pesanCsv.classList.add('tersembunyi');
  if (!inputCsv.files.length) return;

  if (adaPerubahanBelumDiunduh) {
    const lanjut = confirm(
      'Ada perubahan HPP yang belum diunduh. Mengunggah file CSV ini akan MENGGANTI ' +
      'seluruh daftar HPP yang sedang tampil dan perubahan itu akan hilang.\n\n' +
      'Lanjutkan mengunggah?'
    );
    if (!lanjut) return;
  }

  try {
    const teks = await inputCsv.files[0].text();
    daftarHpp = csvKeDaftarHpp(teks);
    simpanKeLocalStorage();
    tandaiBelumDiunduh(false);
    hitungUlangDanTampilkanUlang();
    inputCsv.value = '';
    tombolUnggahCsv.disabled = true;
  } catch (err) {
    pesanCsv.textContent = err.message || 'Gagal membaca file CSV ini.';
    pesanCsv.classList.remove('tersembunyi');
  }
});

// ====== Mulai ======
muatDariLocalStorage();
renderTabelHpp();
