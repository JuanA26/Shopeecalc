// ====== Util ======
const formatRupiah = (angka) => {
  if (angka === null || angka === undefined || isNaN(angka)) return '-';
  return 'Rp ' + Math.round(angka).toLocaleString('id-ID');
};
// Rupiah ringkas untuk tempat sempit: "Rp 4,1 jt", "Rp 850 rb". Nilai lengkapnya
// tetap ditaruh di tooltip oleh pemanggilnya.
const formatRupiahRingkas = (angka) => {
  if (angka === null || angka === undefined || isNaN(angka)) return '-';
  const abs = Math.abs(angka);
  const tanda = angka < 0 ? '-' : '';
  if (abs >= 1e9) return `${tanda}Rp ${(abs / 1e9).toFixed(2).replace('.', ',')} M`;
  if (abs >= 1e6) return `${tanda}Rp ${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1).replace('.', ',')} jt`;
  if (abs >= 1e3) return `${tanda}Rp ${Math.round(abs / 1e3)} rb`;
  return `${tanda}Rp ${Math.round(abs)}`;
};
const formatPersen = (angka) => {
  if (angka === null || angka === undefined || isNaN(angka)) return '-';
  return angka.toFixed(1).replace('.', ',') + '%';
};
// Margin % ditampilkan sebagai pill berwarna supaya langsung terbaca sekilas:
// hijau ≥ 25%, kuning 10–25%, merah < 10% (termasuk minus).
const pillMargin = (persen) => {
  if (persen === null || persen === undefined || isNaN(persen)) return '-';
  const warna = persen >= 25 ? 'pill-hijau' : persen >= 10 ? 'pill-kuning' : 'pill-merah';
  return `<span class="pill pill-margin ${warna}">${formatPersen(persen)}</span>`;
};
const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Nama produk Shopee bisa 100+ karakter. Daripada mengandalkan CSS untuk "memotong"
// tampilannya (beberapa browser malah menampilkan sepotong baris berikutnya yang
// terlihat terpotong tidak rapi), teksnya langsung dipotong di sini + "..." —
// nama lengkapnya tetap ada lewat atribut title (tooltip saat mouse diarahkan ke situ).
const potongNama = (nama, maxKarakter = 80) => {
  const teks = String(nama ?? '');
  if (teks.length <= maxKarakter) return teks;
  return teks.slice(0, maxKarakter).trimEnd() + '…';
};

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  let body = null;
  try { body = await res.json(); } catch (_) { /* respon kosong, tidak apa */ }
  if (!res.ok) {
    throw new Error((body && body.error) || `Terjadi kesalahan (${res.status}).`);
  }
  return body;
}

// ====== State ======
let dataHasilUpload = null; // { items, ringkasan }
let daftarHpp = [];         // dari GET /api/hpp
let sortKolom = null;       // nama kolom yang sedang diurutkan di tabel Data, mis. "marginPersen"
let sortArah = 1;           // 1 = naik (A-Z / kecil-besar), -1 = turun

// ====== Elemen ======
const halamanLogin = document.getElementById('halamanLogin');
const aplikasiUtama = document.getElementById('aplikasiUtama');
const formLogin = document.getElementById('formLogin');
const pesanErrorLogin = document.getElementById('pesanErrorLogin');
const labelUsername = document.getElementById('labelUsername');
const tombolLogout = document.getElementById('tombolLogout');

const inputFile = document.getElementById('inputFile');
const tombolProses = document.getElementById('tombolProses');
const pesanErrorUpload = document.getElementById('pesanErrorUpload');
const pesanLoading = document.getElementById('pesanLoading');
const areaRingkasan = document.getElementById('areaRingkasan');
const inputCari = document.getElementById('inputCari');
const isiTabelData = document.getElementById('isiTabelData');
const infoJumlahData = document.getElementById('infoJumlahData');

const inputCariHpp = document.getElementById('inputCariHpp');
const hppBaruId = document.getElementById('hppBaruId');
const hppBaruNama = document.getElementById('hppBaruNama');
const hppBaruNilai = document.getElementById('hppBaruNilai');
const tombolTambahHpp = document.getElementById('tombolTambahHpp');
const pesanErrorHpp = document.getElementById('pesanErrorHpp');
const isiTabelHpp = document.getElementById('isiTabelHpp');

const inputCsvHpp = document.getElementById('inputCsvHpp');
const tombolImporCsv = document.getElementById('tombolImporCsv');
const pesanLoadingCsv = document.getElementById('pesanLoadingCsv');
const pesanErrorCsv = document.getElementById('pesanErrorCsv');
const pesanSuksesCsv = document.getElementById('pesanSuksesCsv');

// ====== Login / Sesi ======
async function cekSesi() {
  const info = await apiFetch('/api/me');
  if (info.loggedIn) {
    tampilkanAplikasi(info.username);
  } else {
    tampilkanLogin();
  }
}

function tampilkanLogin() {
  halamanLogin.classList.remove('tersembunyi');
  aplikasiUtama.classList.add('tersembunyi');
}

function tampilkanAplikasi(username) {
  halamanLogin.classList.add('tersembunyi');
  aplikasiUtama.classList.remove('tersembunyi');
  labelUsername.textContent = username;
  document.getElementById('avatarUser').textContent = String(username || '?').slice(0, 1);
  muatDaftarHpp();
  muatSetelanIklan();
  muatPengaturan();
}

formLogin.addEventListener('submit', async (e) => {
  e.preventDefault();
  pesanErrorLogin.classList.add('tersembunyi');
  const username = document.getElementById('inputUsername').value.trim();
  const password = document.getElementById('inputPassword').value;
  try {
    const hasil = await apiFetch('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    tampilkanAplikasi(hasil.username);
  } catch (err) {
    pesanErrorLogin.textContent = err.message;
    pesanErrorLogin.classList.remove('tersembunyi');
  }
});

tombolLogout.addEventListener('click', async () => {
  await apiFetch('/api/logout', { method: 'POST' });
  dataHasilUpload = null;
  dataIklan = null;
  tampilkanLogin();
});

// ====== Navigasi halaman (nav bar horizontal di atas) ======
function bukaHalaman(idHalaman) {
  document.querySelectorAll('.nav-item[data-page]').forEach((b) => b.classList.toggle('aktif', b.dataset.page === idHalaman));
  document.querySelectorAll('.halaman').forEach((s) => s.classList.toggle('aktif', s.id === idHalaman));
}

document.querySelectorAll('.nav-item[data-page]').forEach((btn) => {
  btn.addEventListener('click', () => bukaHalaman(btn.dataset.page));
});

// Tombol "Buka Kalkulator" dsb. di dalam widget Dashboard pindah halaman juga
document.querySelectorAll('[data-buka-halaman]').forEach((btn) => {
  btn.addEventListener('click', () => bukaHalaman(btn.dataset.bukaHalaman));
});

// Sub-tab di dalam halaman Kalkulator Margin: "Unggah & Lihat Data" vs "Atur Harga Modal (HPP)"
document.querySelectorAll('.pill-filter[data-subtab]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pill-filter[data-subtab]').forEach((b) => b.classList.remove('aktif'));
    document.querySelectorAll('.subtab-isi').forEach((s) => s.classList.remove('aktif'));
    btn.classList.add('aktif');
    document.getElementById(btn.dataset.subtab).classList.add('aktif');
  });
});

// ====== Upload & Hitung ======
const dropzoneFile = document.getElementById('dropzoneFile');
const namaFile = document.getElementById('namaFile');
function perbaruiNamaFile() {
  const ada = inputFile.files.length > 0;
  tombolProses.disabled = !ada;
  namaFile.textContent = ada ? inputFile.files[0].name : 'Pilih file Income (.xlsx) dari Shopee';
  dropzoneFile.classList.toggle('terisi', ada);
}
inputFile.addEventListener('change', perbaruiNamaFile);
// Seret & lepas file ke area unggah (selain klik) — file yang dilepas dimasukkan ke
// input yang sama, jadi alur "Proses File" di bawah tidak berubah.
['dragenter', 'dragover'].forEach((ev) => dropzoneFile.addEventListener(ev, (e) => { e.preventDefault(); dropzoneFile.classList.add('seret'); }));
['dragleave', 'drop'].forEach((ev) => dropzoneFile.addEventListener(ev, (e) => { e.preventDefault(); dropzoneFile.classList.remove('seret'); }));
dropzoneFile.addEventListener('drop', (e) => {
  if (e.dataTransfer && e.dataTransfer.files.length) {
    inputFile.files = e.dataTransfer.files;
    perbaruiNamaFile();
  }
});

tombolProses.addEventListener('click', async () => {
  if (!inputFile.files.length) return;
  pesanErrorUpload.classList.add('tersembunyi');
  pesanLoading.classList.remove('tersembunyi');
  areaRingkasan.classList.add('tersembunyi');
  tombolProses.disabled = true;

  const formData = new FormData();
  formData.append('file', inputFile.files[0]);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Gagal memproses file.');
    dataHasilUpload = body;
    renderRingkasan(body.ringkasan);
    renderTabelData(body.items);
    renderTabelHpp(); // refresh tab HPP juga, supaya produk dari file ini langsung kelihatan di sana
    areaRingkasan.classList.remove('tersembunyi');
    hitungUlangIklan(); // rasio pencairan & harga dari file ini dipakai halaman Analisis Iklan juga
    if (!dataIklan) renderMingguan(); // belum ada file iklan: tetap tampilkan untung toko per minggu
  } catch (err) {
    pesanErrorUpload.textContent = err.message;
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

  // Widget "Kalkulator Margin" di Dashboard ikut diperbarui dengan angka yang sama
  document.getElementById('widgetUntung').textContent = formatRupiah(r.totalUntung);
  document.getElementById('widgetMargin').textContent = formatPersen(r.marginRataRataPersen);
  document.getElementById('widgetKalkulatorKosong').classList.add('tersembunyi');
  document.getElementById('widgetKalkulatorIsi').classList.remove('tersembunyi');
}

// Nilai satu baris untuk kolom tertentu, dipakai buat urutkan tabel Data.
// Baris yang "dikembalikan" untungnya dianggap 0 (sama seperti yang ditampilkan),
// dan HPP yang belum diisi (null) selalu ditaruh paling akhir apa pun arah urutannya
// — supaya "belum diisi" tidak nyampur di tengah angka yang sudah lengkap.
function nilaiUntukUrut(it, kolom) {
  switch (kolom) {
    case 'jumlah': return it.jumlah;
    case 'totalPenghasilan': return it.totalPenghasilan;
    case 'hpp': return it.hpp === null ? null : (it.hppTotal ?? it.hpp);
    case 'untung': return it.dikembalikan ? 0 : it.untung;
    case 'marginPersen': return it.dikembalikan ? 0 : it.marginPersen;
    default: return it[kolom];
  }
}

function urutkanItems(items) {
  if (!sortKolom) return items;
  return [...items].sort((a, b) => {
    const va = nilaiUntukUrut(a, sortKolom);
    const vb = nilaiUntukUrut(b, sortKolom);
    if (va === null || va === undefined) return vb === null || vb === undefined ? 0 : 1;
    if (vb === null || vb === undefined) return -1;
    if (typeof va === 'string' || typeof vb === 'string') {
      return String(va).localeCompare(String(vb), 'id') * sortArah;
    }
    return (va - vb) * sortArah;
  });
}

// Dipakai tabel Data (default) dan tabel Analisis Iklan — cukup beri selector tabel +
// kolom/arah urut yang sedang aktif untuk tabel itu.
function perbaruiIndikatorUrutHeader(selectorTabel = '#tabelData', kolom = sortKolom, arah = sortArah) {
  document.querySelectorAll(`${selectorTabel} .th-urut`).forEach((th) => {
    const aktif = th.dataset.urut === kolom;
    th.classList.toggle('urut-aktif', aktif);
    const panahLama = th.querySelector('.panah-urut');
    if (panahLama) panahLama.remove();
    const naik = '<path d="m6 15 6-6 6 6"/>';
    const turun = '<path d="m6 9 6 6 6-6"/>';
    const isi = aktif ? (arah === 1 ? naik : turun) : '<path d="m8 9 4-4 4 4"/><path d="m8 15 4 4 4-4"/>';
    const panah = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    panah.setAttribute('class', 'ikon panah-urut');
    panah.setAttribute('viewBox', '0 0 24 24');
    panah.innerHTML = isi;
    // Di kolom angka (rata kanan) chevron ditaruh di depan judul supaya angka di bawahnya
    // tetap sejajar dengan ujung kanan judul.
    if (th.classList.contains('kolom-angka')) th.prepend(panah); else th.appendChild(panah);
  });
}

function renderTabelData(items) {
  const kataKunci = inputCari.value.trim().toLowerCase();
  const filtered = urutkanItems(
    !kataKunci
      ? items
      : items.filter((it) =>
          [it.noPesanan, it.namaProduk, it.idProduk].some((v) => String(v).toLowerCase().includes(kataKunci))
        )
  );

  // Total baris & total pcs yang lagi ditampilkan (ikut berubah kalau lagi dicari/difilter),
  // supaya kelihatan langsung berapa banyak yang terjual tanpa harus menghitung manual.
  const totalPcsTampil = filtered.reduce((jumlah, it) => jumlah + (it.jumlah || 0), 0);
  infoJumlahData.textContent = `${filtered.length} baris · ${totalPcsTampil} pcs`;

  if (!filtered.length) {
    isiTabelData.innerHTML = `<tr><td colspan="10" class="teks-redup">Tidak ada data yang cocok.</td></tr>`;
    return;
  }

  isiTabelData.innerHTML = filtered
    .map((it, idx) => {
      const punyaHpp = it.hpp !== null;
      const kelasBaris = it.dikembalikan ? 'baris-dikembalikan' : (punyaHpp ? '' : 'baris-peringatan');
      const kelasUntung = it.dikembalikan
        ? 'teks-redup'
        : punyaHpp ? (it.untung >= 0 ? 'untung-positif' : 'untung-negatif') : 'teks-redup';

      // Pesanan yang dikembalikan tidak perlu diminta isi HPP (barangnya kembali ke
      // penjual, jadi HPP tidak relevan buat baris ini) — cukup tampilkan tanda "-".
      // Baris yang jumlah pcs-nya >1 (lihat kolom "Jumlah"): tampilkan total HPP-nya
      // (yang sudah dikali jumlah pcs) sebagai angka utama, dengan HPP per-pcs kecil
      // di bawahnya supaya tetap transparan dari mana angkanya berasal.
      const selHpp = it.dikembalikan
        ? '<span class="teks-redup" title="Tidak relevan — pesanan ini dikembalikan.">-</span>'
        : punyaHpp
        ? it.jumlah > 1
          ? `${formatRupiah(it.hppTotal)}<br><span class="pill pill-abu" title="HPP per 1 pcs: ${formatRupiah(it.hpp)}, dikali jumlah pcs di kolom &quot;Jumlah&quot; sebelah kiri.">${formatRupiah(it.hpp)}/pcs</span>`
          : formatRupiah(it.hpp)
        : `<div class="sel-hpp-cepat">
             <input type="number" class="input-hpp-cepat" placeholder="Isi HPP" min="0"
                    data-id="${escapeHtml(it.idProduk)}" data-nama="${escapeHtml(it.namaProduk)}">
             <button type="button" class="tombol tombol-mini simpan-hpp-cepat"
                     data-id="${escapeHtml(it.idProduk)}" data-nama="${escapeHtml(it.namaProduk)}">Simpan</button>
           </div>`;

      // Jumlah pcs: defaultnya 1, otomatis naik kalau baris ini terdeteksi mewakili
      // beberapa pcs produk yang sama (lihat parseExcel.js). Selalu bisa dikoreksi
      // manual di sini — border oranye + tombol "Reset" muncul kalau nilainya
      // sedang beda dari tebakan otomatis, supaya jelas kapan itu koreksi manual.
      const jumlahDiubahManual = !it.dikembalikan && it.jumlah !== it.jumlahOtomatis;
      const selJumlah = it.dikembalikan
        ? '<span class="teks-redup" title="Tidak relevan — pesanan ini dikembalikan.">-</span>'
        : `<div class="sel-jumlah">
             <input type="number" class="input-jumlah${jumlahDiubahManual ? ' diubah-manual' : ''}" min="1" step="1"
                    value="${it.jumlah}" data-order="${escapeHtml(it.noPesanan)}" data-id="${escapeHtml(it.idProduk)}"
                    data-harga="${it.hargaProduk}"
                    title="Jumlah pcs pada baris ini (dipakai untuk mengalikan HPP). Tebakan otomatis: ${it.jumlahOtomatis} pcs.">
             ${jumlahDiubahManual ? `<button type="button" class="tombol-reset-jumlah" data-order="${escapeHtml(it.noPesanan)}" data-id="${escapeHtml(it.idProduk)}" data-harga="${it.hargaProduk}">Reset ke ${it.jumlahOtomatis}</button>` : ''}
           </div>`;

      const totalPenghasilanTampil = it.dikembalikan
        ? `${formatRupiah(it.totalPenghasilan)}<br><span class="pill pill-kuning" title="Pesanan ini dikembalikan / di-refund ke pembeli sebesar ${formatRupiah(it.jumlahPengembalian)} (menurut kolom &quot;Jumlah Pengembalian Dana ke Pembeli&quot; di file Shopee).">Dikembalikan</span>`
        : formatRupiah(it.totalPenghasilan);

      const untungTampil = it.dikembalikan
        ? '<span title="Barang dikembalikan ke Anda, jadi tidak dihitung untung maupun rugi.">Rp 0</span>'
        : punyaHpp ? formatRupiah(it.untung) : 'Belum diisi';
      const marginTampil = it.dikembalikan ? '-' : punyaHpp ? pillMargin(it.marginPersen) : '-';

      return `
        <tr class="${kelasBaris}">
          <td data-label="No. Pesanan">${escapeHtml(it.noPesanan)}</td>
          <td data-label="Tanggal Pesanan">${escapeHtml(it.waktuPesanan)}</td>
          <td data-label="Tanggal Dana Cair">${escapeHtml(it.tanggalDilepaskan)}</td>
          <td class="kolom-nama" data-label="Nama Produk" title="${escapeHtml(it.namaProduk)}">${escapeHtml(potongNama(it.namaProduk))}</td>
          <td class="kolom-id" data-label="ID Produk">${escapeHtml(it.idProduk)}</td>
          <td class="kolom-jumlah kolom-tengah" data-label="Jumlah">${selJumlah}</td>
          <td class="kolom-total kolom-angka" data-label="Total Penghasilan">${totalPenghasilanTampil}</td>
          <td class="kolom-hpp kolom-angka" data-label="Harga Modal (HPP)">${selHpp}</td>
          <td class="${kelasUntung} kolom-angka" data-label="Untung">${untungTampil}</td>
          <td class="${kelasUntung} kolom-angka" data-label="Margin %">${marginTampil}</td>
        </tr>`;
    })
    .join('');

  // Isi cepat HPP langsung dari tabel data (untuk baris yang ditandai kuning):
  // bisa disimpan dengan klik tombol "Simpan" ATAU dengan menekan Enter di kotaknya.
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

  // Kolom "Jumlah": simpan otomatis begitu kotaknya kehilangan fokus (blur) atau
  // saat tekan Enter — sama seperti pola isi HPP, tidak perlu tombol "Simpan" terpisah.
  isiTabelData.querySelectorAll('.input-jumlah').forEach((input) => {
    const nilaiAwal = input.value;
    const simpanKalauBerubah = () => {
      if (input.value !== nilaiAwal) {
        simpanJumlah(input.dataset.order, input.dataset.id, input.dataset.harga, input.value);
      }
    };
    input.addEventListener('blur', simpanKalauBerubah);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    });
  });
  isiTabelData.querySelectorAll('.tombol-reset-jumlah').forEach((tombol) => {
    tombol.addEventListener('click', () => resetJumlah(tombol.dataset.order, tombol.dataset.id, tombol.dataset.harga));
  });
}

// Baris pesanan+produk yang dituju: cocokkan lewat No. Pesanan + ID Produk + Harga
// Produk baris itu — order_sn+id_produk saja BISA tidak unik (satu pesanan boleh
// punya >1 baris Sku untuk produk yang sama, lihat catatan di db.js/server.js).
function cariItemJumlah(orderSn, idProduk, hargaProduk) {
  return dataHasilUpload.items.find(
    (it) => it.noPesanan === orderSn && it.idProduk === idProduk && String(it.hargaProduk) === String(hargaProduk)
  );
}

// Simpan koreksi manual jumlah pcs untuk satu baris pesanan+produk, lalu hitung
// ulang untung/margin di tabel yang sedang tampil (tanpa perlu unggah ulang file).
async function simpanJumlah(orderSn, idProduk, hargaProduk, nilaiMentah) {
  const nilai = Number(nilaiMentah);
  if (!Number.isInteger(nilai) || nilai < 1) {
    alert('Jumlah harus berupa bilangan bulat, minimal 1.');
    renderTabelData(dataHasilUpload.items); // kembalikan tampilan ke nilai semula
    return;
  }
  try {
    await apiFetch(
      `/api/jumlah/${encodeURIComponent(orderSn)}/${encodeURIComponent(idProduk)}/${encodeURIComponent(hargaProduk)}`,
      { method: 'PUT', body: JSON.stringify({ jumlah: nilai }) }
    );
    const item = cariItemJumlah(orderSn, idProduk, hargaProduk);
    if (item) item.jumlah = nilai;
    hitungUlangDanTampilkanUlang();
  } catch (err) {
    alert(err.message);
  }
}

// Hapus koreksi manual — baris ini kembali memakai tebakan otomatis.
async function resetJumlah(orderSn, idProduk, hargaProduk) {
  try {
    await apiFetch(
      `/api/jumlah/${encodeURIComponent(orderSn)}/${encodeURIComponent(idProduk)}/${encodeURIComponent(hargaProduk)}`,
      { method: 'DELETE' }
    );
    const item = cariItemJumlah(orderSn, idProduk, hargaProduk);
    if (item) item.jumlah = item.jumlahOtomatis;
    hitungUlangDanTampilkanUlang();
  } catch (err) {
    alert(err.message);
  }
}

// Fungsi bersama: simpan satu nilai HPP ke server, lalu refresh tabel Data & tabel HPP.
async function simpanHpp(idProduk, namaProduk, nilaiMentah) {
  const nilai = Number(nilaiMentah);
  if (!Number.isFinite(nilai) || nilai < 0) {
    alert('Isi Harga Modal (HPP) dengan angka yang benar (tidak boleh kosong / minus) sebelum menyimpan.');
    return;
  }
  try {
    await apiFetch(`/api/hpp/${encodeURIComponent(idProduk)}`, {
      method: 'PUT',
      body: JSON.stringify({ hpp: nilai, namaProduk }),
    });
    await muatDaftarHpp();
    hitungUlangDanTampilkanUlang();
  } catch (err) {
    alert(err.message);
  }
}

// Setelah HPP baru disimpan, hitung ulang untung/margin di data yang sedang tampil (tanpa upload ulang)
function hitungUlangDanTampilkanUlang() {
  if (!dataHasilUpload) return;
  const hppMap = new Map(daftarHpp.map((r) => [r.id_produk, r.hpp]));

  let totalPenghasilan = 0, totalHpp = 0, totalUntung = 0, jumlahBelumAdaHpp = 0, jumlahDikembalikan = 0;

  dataHasilUpload.items = dataHasilUpload.items.map((it) => {
    const punyaHpp = hppMap.has(it.idProduk);
    const hpp = punyaHpp ? hppMap.get(it.idProduk) : null;

    totalPenghasilan += it.totalPenghasilan;

    // Sama seperti di server: pesanan yang dikembalikan tidak dihitung untung/rugi
    // (barangnya kembali ke penjual), dan tidak perlu diminta isi HPP.
    if (it.dikembalikan) {
      jumlahDikembalikan += 1;
      return { ...it, hpp, untung: 0, marginPersen: null };
    }

    // HPP dikali jumlah pcs (auto-terdeteksi atau hasil koreksi manual — lihat kolom
    // "Jumlah") sebelum dikurangkan, sama seperti logika di server.js.
    const hppTotal = punyaHpp ? hpp * it.jumlah : null;
    const untung = punyaHpp ? it.totalPenghasilan - hppTotal : null;
    const marginPersen = punyaHpp && it.totalPenghasilan !== 0 ? (untung / it.totalPenghasilan) * 100 : null;

    if (punyaHpp) { totalHpp += hppTotal; totalUntung += untung; } else { jumlahBelumAdaHpp += 1; }

    return { ...it, hpp, hppTotal, untung, marginPersen };
  });

  // Field lain dari server (rasioPencairan, biayaPenjual, sheetTerbaca) tidak berubah
  // karena HPP — dipertahankan lewat spread.
  dataHasilUpload.ringkasan = {
    ...dataHasilUpload.ringkasan,
    jumlahBaris: dataHasilUpload.items.length,
    totalPenghasilan, totalHpp, totalUntung,
    marginRataRataPersen: totalPenghasilan !== 0 ? (totalUntung / totalPenghasilan) * 100 : null,
    jumlahBelumAdaHpp,
    jumlahDikembalikan,
  };

  renderRingkasan(dataHasilUpload.ringkasan);
  renderTabelData(dataHasilUpload.items);
}

inputCari.addEventListener('input', () => {
  if (dataHasilUpload) renderTabelData(dataHasilUpload.items);
});

// Klik judul kolom untuk urutkan tabel Data — klik lagi di kolom yang sama untuk
// membalik arahnya (naik/turun), klik kolom lain untuk pindah urutan ke situ.
document.querySelectorAll('#tabelData .th-urut').forEach((th) => {
  th.addEventListener('click', () => {
    if (sortKolom === th.dataset.urut) {
      sortArah *= -1;
    } else {
      sortKolom = th.dataset.urut;
      sortArah = 1;
    }
    perbaruiIndikatorUrutHeader();
    if (dataHasilUpload) renderTabelData(dataHasilUpload.items);
  });
});
perbaruiIndikatorUrutHeader();

// ====== Tab HPP ======
async function muatDaftarHpp() {
  daftarHpp = await apiFetch('/api/hpp');
  renderTabelHpp();
  hitungUlangIklan();
}

// Gabungkan daftar HPP yang sudah tersimpan dengan produk-produk yang muncul di file
// yang baru diunggah tapi belum punya HPP — supaya semuanya kelihatan & bisa diisi di sini juga,
// tidak perlu ketik ulang ID Produk secara manual.
// Total penjualan per produk dari file yang sedang diunggah (pcs & penghasilan, tanpa
// baris yang dikembalikan). Dipakai untuk mengurutkan daftar "Belum Diisi" supaya
// produk yang paling banyak menghasilkan uang ada di atas — itulah yang paling penting
// diisi HPP-nya dulu. Dihitung sekali per unggahan.
let penjualanPerProdukCache = { sumber: null, peta: new Map() };
function penjualanPerProduk() {
  if (!dataHasilUpload) return new Map();
  if (penjualanPerProdukCache.sumber === dataHasilUpload) return penjualanPerProdukCache.peta;
  const peta = new Map();
  for (const it of dataHasilUpload.items) {
    if (it.dikembalikan) continue;
    const t = peta.get(it.idProduk) || { pcs: 0, penghasilan: 0, hargaProduk: 0 };
    t.pcs += it.jumlah || 1;
    t.penghasilan += it.totalPenghasilan || 0;
    t.hargaProduk += it.hargaProduk || 0; // harga jual total baris (sudah dikali pcs untuk baris multi-pcs)
    peta.set(it.idProduk, t);
  }
  penjualanPerProdukCache = { sumber: dataHasilUpload, peta };
  return peta;
}

function gabunganProdukUntukTabelHpp() {
  const sudahAda = new Set(daftarHpp.map((r) => r.id_produk));
  const penjualan = penjualanPerProduk();
  const belumPunyaHpp = [];

  if (dataHasilUpload) {
    for (const it of dataHasilUpload.items) {
      if (sudahAda.has(it.idProduk) || belumPunyaHpp.some((r) => r.id_produk === it.idProduk)) continue;
      belumPunyaHpp.push({
        id_produk: it.idProduk,
        nama_produk: it.namaProduk,
        hpp: null,
        updated_at: null,
        updated_by: null,
      });
    }
  }

  const tempel = (r) => {
    const p = penjualan.get(r.id_produk);
    return { ...r, terjualPcs: p ? p.pcs : 0, terjualRp: p ? p.penghasilan : 0 };
  };

  // Produk yang belum ada HPP ditaruh di atas supaya langsung kelihatan perlu diisi —
  // diurutkan dari yang penjualannya paling besar di file yang diunggah.
  const belum = belumPunyaHpp.map(tempel).sort((a, b) => b.terjualRp - a.terjualRp);
  return [...belum, ...daftarHpp.map(tempel)];
}

// Kalimat ringkas di atas tabel HPP: berapa produk belum ada HPP & berapa nilai
// penjualannya di file yang diunggah. Disembunyikan kalau belum ada unggahan
// atau semua produk sudah punya HPP.
function renderRingkasanBelumHpp(semua) {
  const el = document.getElementById('ringkasanBelumHpp2');
  const belum = semua.filter((r) => r.hpp === null && r.terjualRp > 0);
  if (!dataHasilUpload || !belum.length) { el.classList.add('tersembunyi'); return; }
  const totalRp = belum.reduce((t, r) => t + r.terjualRp, 0);
  el.innerHTML =
    `<strong>${belum.length} produk</strong> di file yang diunggah belum ada HPP — nilai penjualannya ` +
    `<strong title="${escapeHtml(formatRupiah(totalRp))}">${formatRupiahRingkas(totalRp)}</strong>. ` +
    `Daftar di bawah diurutkan dari yang penjualannya paling besar: isi yang di atas dulu.`;
  el.classList.remove('tersembunyi');
}

let filterHpp = 'semua'; // 'semua' | 'belum' | 'sudah'

function renderTabelHpp() {
  const kataKunci = inputCariHpp.value.trim().toLowerCase();
  const semua = gabunganProdukUntukTabelHpp();
  renderRingkasanBelumHpp(semua);
  let filtered = !kataKunci
    ? semua
    : semua.filter((r) => [r.id_produk, r.nama_produk].some((v) => String(v).toLowerCase().includes(kataKunci)));

  if (filterHpp === 'belum') filtered = filtered.filter((r) => r.hpp === null);
  if (filterHpp === 'sudah') filtered = filtered.filter((r) => r.hpp !== null);

  if (!filtered.length) {
    isiTabelHpp.innerHTML = `<tr><td colspan="7" class="teks-redup">Belum ada produk. Tambahkan di atas, atau unggah file dulu di tab "Unggah &amp; Lihat Data".</td></tr>`;
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
          <td class="kolom-id" data-label="ID Produk">${escapeHtml(r.id_produk)}</td>
          <td class="kolom-nama" data-label="Nama Produk" title="${escapeHtml(r.nama_produk || '')}">${r.nama_produk ? escapeHtml(potongNama(r.nama_produk)) : '-'}</td>
          <td class="kolom-angka kolom-terjual" data-label="Terjual (file ini)">${
            r.terjualPcs
              ? `<span title="${escapeHtml(formatRupiah(r.terjualRp))}">${r.terjualPcs} pcs &middot; ${formatRupiahRingkas(r.terjualRp)}</span>`
              : '<span class="teks-redup">-</span>'
          }</td>
          <td class="kolom-hpp kolom-angka" data-label="Harga Modal (HPP)">${selHpp}</td>
          <td data-label="Terakhir Diubah">${r.updated_at ? escapeHtml(r.updated_at) : '<span class="teks-redup">Belum diisi</span>'}</td>
          <td data-label="Oleh">${escapeHtml(r.updated_by || '-')}</td>
          <td data-label="">${punyaHpp ? `<button class="tombol tombol-hapus" data-hapus="${escapeHtml(r.id_produk)}">Hapus</button>` : ''}</td>
        </tr>`;
    })
    .join('');

  // Baris yang sudah punya HPP: ubah nilainya, simpan otomatis saat pindah fokus (blur/Enter).
  isiTabelHpp.querySelectorAll('.input-hpp-tabel').forEach((input) => {
    input.addEventListener('change', () => simpanHpp(input.dataset.id, input.dataset.nama, input.value));
  });

  // Baris yang belum punya HPP (termasuk hasil unggahan): isi + klik Simpan (atau tekan Enter).
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
    btn.addEventListener('click', async () => {
      if (!confirm('Hapus harga modal produk ini?')) return;
      await apiFetch(`/api/hpp/${encodeURIComponent(btn.dataset.hapus)}`, { method: 'DELETE' });
      await muatDaftarHpp();
      hitungUlangDanTampilkanUlang();
    });
  });
}

inputCariHpp.addEventListener('input', renderTabelHpp);

document.querySelectorAll('.pill-filter[data-filter-hpp]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pill-filter[data-filter-hpp]').forEach((b) => b.classList.remove('aktif'));
    btn.classList.add('aktif');
    filterHpp = btn.dataset.filterHpp;
    renderTabelHpp();
  });
});

tombolTambahHpp.addEventListener('click', async () => {
  pesanErrorHpp.classList.add('tersembunyi');
  const id = hppBaruId.value.trim();
  const nama = hppBaruNama.value.trim();
  const nilaiMentah = hppBaruNilai.value;

  if (!id) { pesanErrorHpp.textContent = 'ID Produk wajib diisi.'; pesanErrorHpp.classList.remove('tersembunyi'); return; }
  const nilai = Number(nilaiMentah);
  if (!Number.isFinite(nilai) || nilai < 0) { pesanErrorHpp.textContent = 'Harga Modal harus berupa angka.'; pesanErrorHpp.classList.remove('tersembunyi'); return; }

  try {
    await apiFetch(`/api/hpp/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ hpp: nilai, namaProduk: nama }),
    });
    hppBaruId.value = '';
    hppBaruNama.value = '';
    hppBaruNilai.value = '';
    await muatDaftarHpp();
    hitungUlangDanTampilkanUlang();
  } catch (err) {
    pesanErrorHpp.textContent = err.message;
    pesanErrorHpp.classList.remove('tersembunyi');
  }
});

// ====== Impor CSV ======
const namaFileCsv = document.getElementById('namaFileCsv');
function perbaruiNamaFileCsv() {
  const ada = inputCsvHpp.files.length > 0;
  tombolImporCsv.disabled = !ada;
  namaFileCsv.textContent = ada ? inputCsvHpp.files[0].name : 'Belum ada file';
  namaFileCsv.classList.toggle('terisi', ada);
}
inputCsvHpp.addEventListener('change', perbaruiNamaFileCsv);

tombolImporCsv.addEventListener('click', async () => {
  if (!inputCsvHpp.files.length) return;
  pesanErrorCsv.classList.add('tersembunyi');
  pesanSuksesCsv.classList.add('tersembunyi');
  pesanLoadingCsv.classList.remove('tersembunyi');
  tombolImporCsv.disabled = true;

  const formData = new FormData();
  formData.append('file', inputCsvHpp.files[0]);

  try {
    const res = await fetch('/api/hpp/import-csv', { method: 'POST', body: formData });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Gagal mengimpor file CSV.');

    pesanSuksesCsv.textContent =
      `Selesai: ${body.ditambahkan} produk baru ditambahkan, ${body.diperbarui} diperbarui` +
      (body.dilewati ? `, ${body.dilewati} baris dilewati (data tidak valid).` : '.');
    pesanSuksesCsv.classList.remove('tersembunyi');
    inputCsvHpp.value = '';
    perbaruiNamaFileCsv();
    await muatDaftarHpp();
    hitungUlangDanTampilkanUlang();
  } catch (err) {
    pesanErrorCsv.textContent = err.message;
    pesanErrorCsv.classList.remove('tersembunyi');
  } finally {
    pesanLoadingCsv.classList.add('tersembunyi');
    tombolImporCsv.disabled = !inputCsvHpp.files.length;
  }
});

// ====== Analisis Iklan ======
// Alur sama dengan unggah Income: pilih file CSV "Data Keseluruhan Iklan" → Proses → server
// menggabungkan dengan HPP dan rasio pencairan → tabel per produk dengan vonis + kalimat
// tindakan. Data hanya di memori halaman ini (dataIklan), tidak disimpan di server.
let dataIklan = null;       // { produk, kampanye, ringkasan, sumberRasio, periode, namaToko }
let sortKolomIklan = 'biaya';
let sortArahIklan = -1;     // biaya terbesar di atas: di situ uang paling banyak dipertaruhkan
let filterIklan = 'semua';  // 'semua' | 'jeda' | 'ubah-target' | 'biarkan' | 'isi-hpp'
const produkTerbuka = new Set(); // idProduk yang rincian kampanyenya sedang dibuka
let grupBerakhirTerbuka = false;   // grup "Sudah berakhir" di tabel terlipat sampai diklik
const keputusanTerbuka = new Set(); // baris tabel keputusan yang rinciannya sedang dibuka
let daftarSetelan = new Map();      // idProduk → { target_roas, modal_harian } (dari GET /api/iklan/setelan)
let aturanTerakhir = null;          // hasil aturanMingguan() terakhir, dipakai tabel keputusan
let pengaturanToko = {};            // { tingkat_cair: '0.85', ... } dari GET /api/pengaturan

// Pengaturan toko (sekarang cuma "tingkat pesanan iklan dibayar"). Dimuat saat login; kotak
// isiannya ada di bagian "Semua produk & rincian" halaman Analisis Iklan.
const inputTingkatCair = document.getElementById('inputTingkatCair');
async function muatPengaturan() {
  try {
    pengaturanToko = await apiFetch('/api/pengaturan');
  } catch (err) {
    console.error('Gagal memuat pengaturan:', err);
    pengaturanToko = {};
  }
  const n = Number(pengaturanToko.tingkat_cair);
  inputTingkatCair.value = Number.isFinite(n) && n > 0 && n <= 1 ? Math.round(n * 100) : '';
}
inputTingkatCair.addEventListener('change', async () => {
  const mentah = inputTingkatCair.value.trim();
  const persen = mentah === '' ? null : Number(mentah);
  if (persen !== null && (!Number.isFinite(persen) || persen < 1 || persen > 100)) { alert('Isi angka 1–100 (persen).'); return; }
  try {
    const row = await apiFetch('/api/pengaturan/tingkat_cair', { method: 'PUT', body: JSON.stringify({ nilai: persen === null ? null : persen / 100 }) });
    if (row.nilai === null) delete pengaturanToko.tingkat_cair; else pengaturanToko.tingkat_cair = row.nilai;
    hitungUlangIklan();
  } catch (err) {
    alert(err.message);
  }
});
inputTingkatCair.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inputTingkatCair.blur(); } });

async function muatSetelanIklan() {
  try {
    const rows = await apiFetch('/api/iklan/setelan');
    daftarSetelan = new Map(rows.map((r) => [r.id_produk, r]));
  } catch (err) {
    console.error('Gagal memuat setelan iklan:', err);
  }
}

// Simpan Target ROAS / Modal Harian yang terpasang di Seller Centre untuk satu produk,
// lalu hitung ulang keputusan (tanpa unggah ulang).
async function simpanSetelanIklan(idProduk, field, nilaiMentah) {
  const nilai = nilaiMentah === '' ? null : Number(nilaiMentah);
  if (nilai !== null && (!Number.isFinite(nilai) || nilai < 0)) { alert('Isi dengan angka (tidak boleh minus).'); return; }
  try {
    const row = await apiFetch(`/api/iklan/setelan/${encodeURIComponent(idProduk)}`, {
      method: 'PUT',
      body: JSON.stringify({ [field]: nilai }),
    });
    daftarSetelan.set(idProduk, row);
    if (dataIklan) { renderKeputusan(); renderRingkasanIklan(dataIklan.ringkasan); }
  } catch (err) {
    alert(err.message);
  }
}

const inputFileIklan = document.getElementById('inputFileIklan');
const tombolProsesIklan = document.getElementById('tombolProsesIklan');
const dropzoneIklan = document.getElementById('dropzoneIklan');
const namaFileIklan = document.getElementById('namaFileIklan');
const pesanErrorIklan = document.getElementById('pesanErrorIklan');
const pesanLoadingIklan = document.getElementById('pesanLoadingIklan');
const areaIklan = document.getElementById('areaIklan');
const inputCariIklan = document.getElementById('inputCariIklan');
const isiTabelIklan = document.getElementById('isiTabelIklan');
const infoJumlahIklan = document.getElementById('infoJumlahIklan');

function perbaruiNamaFileIklan() {
  const ada = inputFileIklan.files.length > 0;
  tombolProsesIklan.disabled = !ada;
  namaFileIklan.textContent = ada ? inputFileIklan.files[0].name : 'Pilih file "Data Keseluruhan Iklan" (.csv)';
  dropzoneIklan.classList.toggle('terisi', ada);
}
inputFileIklan.addEventListener('change', perbaruiNamaFileIklan);
['dragenter', 'dragover'].forEach((ev) => dropzoneIklan.addEventListener(ev, (e) => { e.preventDefault(); dropzoneIklan.classList.add('seret'); }));
['dragleave', 'drop'].forEach((ev) => dropzoneIklan.addEventListener(ev, (e) => { e.preventDefault(); dropzoneIklan.classList.remove('seret'); }));
dropzoneIklan.addEventListener('drop', (e) => {
  if (e.dataTransfer && e.dataTransfer.files.length) {
    inputFileIklan.files = e.dataTransfer.files;
    perbaruiNamaFileIklan();
  }
});

// Rasio pencairan dari file Income yang sedang diunggah (Σ penghasilan ÷ Σ harga produk);
// null kalau belum ada unggahan → server memakai angka default dan halaman menampilkan catatan.
function rasioPencairanSaatIni() {
  const r = dataHasilUpload && dataHasilUpload.ringkasan;
  return r && r.rasioPencairan ? r.rasioPencairan : null;
}

// Harga jual per pcs & rasio pencairan tiap produk dari file Income yang diunggah —
// dikirim ke server supaya analisis iklan memakai harga produk yang sebenarnya, bukan
// tebakan dari omzet iklan (yang tercampur produk lain). Kosong kalau belum ada unggahan.
function produkIncomeSaatIni() {
  const hasil = {};
  for (const [id, t] of penjualanPerProduk()) {
    if (!t.pcs || !t.hargaProduk) continue;
    // Server hanya memakai harga/rasio kalau pcs ≥ 3; perHari dipakai untuk batas pesanan
    // iklan yang dibayar (analisisIklan.js: batasDibayarKampanye).
    hasil[id] = { harga: t.hargaProduk / t.pcs, rasio: t.penghasilan / t.hargaProduk, pcs: t.pcs, perHari: {} };
  }
  for (const it of dataHasilUpload.items) {
    if (it.dikembalikan || !hasil[it.idProduk]) continue;
    const iso = String(it.waktuPesanan || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
    const h = hasil[it.idProduk].perHari;
    const t = h[iso] || (h[iso] = { pcs: 0, harga: 0 });
    t.pcs += it.jumlah || 1;
    t.harga += it.hargaProduk || 0;
  }
  return hasil;
}

// Tanggal dana dilepaskan paling akhir di file Income — sampai tanggal itu pesanan sudah
// pasti cair; dipakai server untuk tahu periode kampanye mana yang sudah bisa diukur.
function tanggalRilisTerakhirSaatIni() {
  if (!dataHasilUpload) return '';
  let maks = '';
  for (const it of dataHasilUpload.items) { const r = String(it.tanggalDilepaskan || '').slice(0, 10); if (r > maks) maks = r; }
  return maks;
}

tombolProsesIklan.addEventListener('click', async () => {
  if (!inputFileIklan.files.length) return;
  pesanErrorIklan.classList.add('tersembunyi');
  pesanLoadingIklan.classList.remove('tersembunyi');
  tombolProsesIklan.disabled = true;

  const formData = new FormData();
  formData.append('file', inputFileIklan.files[0]);
  const rasio = rasioPencairanSaatIni();
  if (rasio) {
    formData.append('rasioPencairan', String(rasio));
    formData.append('produkIncome', JSON.stringify(produkIncomeSaatIni()));
    formData.append('tanggalRilisTerakhir', tanggalRilisTerakhirSaatIni());
  }

  try {
    const res = await fetch('/api/iklan/upload', { method: 'POST', body: formData });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Gagal memproses file.');
    dataIklan = body;
    produkTerbuka.clear();
    grupBerakhirTerbuka = false;
    renderIklan();
    areaIklan.classList.remove('tersembunyi');
  } catch (err) {
    pesanErrorIklan.textContent = err.message;
    pesanErrorIklan.classList.remove('tersembunyi');
  } finally {
    pesanLoadingIklan.classList.add('tersembunyi');
    tombolProsesIklan.disabled = false;
  }
});

// Hitung ulang vonis dengan HPP terbaru / rasio pencairan terbaru tanpa unggah ulang file —
// server hanya perlu baris kampanye yang sudah dibaca tadi.
async function hitungUlangIklan() {
  if (!dataIklan) return;
  try {
    const body = await apiFetch('/api/iklan/hitung-ulang', {
      method: 'POST',
      body: JSON.stringify({
        kampanye: dataIklan.kampanye,
        rasioPencairan: rasioPencairanSaatIni(),
        produkIncome: produkIncomeSaatIni(),
        periode: dataIklan.periode,
        namaToko: dataIklan.namaToko,
        tanggalLaporanIso: dataIklan.tanggalLaporanIso,
        tanggalRilisTerakhir: tanggalRilisTerakhirSaatIni(),
      }),
    });
    dataIklan = body;
    renderIklan();
  } catch (err) {
    console.error('Gagal menghitung ulang analisis iklan:', err);
  }
}

// ROAS ditampilkan satu desimal gaya Indonesia: 4.63 → "4,6".
const formatRoas = (n) => (n === null || n === undefined || !Number.isFinite(n) ? '-' : n.toFixed(1).replace('.', ','));

function renderIklan() {
  renderMingguan();
  renderKeputusan();
  renderRingkasanIklan(dataIklan.ringkasan);
  renderCobaIklan();
  renderTabelIklan();
}

// Nama produk Shopee dimulai "HAPPY SHOP - " lalu 100+ karakter; untuk daftar ringkas
// cukup awalannya saja.
const namaSingkat = (nama, maks = 46) => potongNama(String(nama || '').replace(/^HAPPY SHOP\s*-\s*/i, ''), maks);

// Produk yang layak DICOBA diiklankan: laku sendiri tanpa iklan (dari file Income yang
// diunggah), margin sehat, dan tidak ada di file iklan. Hanya ada kalau file Income diunggah.
function kandidatCobaIklan() {
  if (!dataHasilUpload) return null;
  const sudahDiiklankan = new Set(dataIklan.produk.map((p) => p.idProduk));
  const hppMap = new Map(daftarHpp.map((r) => [r.id_produk, r]));
  const kandidat = [];
  for (const [idProduk, t] of penjualanPerProduk()) {
    if (sudahDiiklankan.has(idProduk) || t.pcs < 10) continue;
    const info = hppMap.get(idProduk);
    if (!info || info.hpp === null) continue;
    const untung = t.penghasilan - info.hpp * t.pcs;
    const margin = t.penghasilan ? untung / t.penghasilan : 0;
    if (margin < 0.2) continue;
    kandidat.push({ idProduk, namaProduk: info.nama_produk || idProduk, pcs: t.pcs, penghasilan: t.penghasilan, margin, rasio: t.hargaProduk ? t.penghasilan / t.hargaProduk : null });
  }
  return kandidat.sort((a, b) => b.pcs - a.pcs).slice(0, 8);
}

function renderCobaIklan() {
  const kartu = document.getElementById('kartuCobaIklan');
  const coba = kandidatCobaIklan();
  if (!coba || !coba.length) { kartu.classList.add('tersembunyi'); return; }
  document.getElementById('daftarCobaIklan').innerHTML = coba
    .map((k) => {
      // Target ROAS minimal calon iklan = 1 ÷ (margin per Rp omzet) + 2, dengan margin per Rp
      // omzet = margin atas penghasilan × rasio pencairan (omzet = penghasilan ÷ rasio).
      // Rasio pencairan produk itu sendiri (bukan rata-rata toko), dan pesanan iklan yang
      // batal/tidak dibayar ikut diperhitungkan (tingkatCair) — sama seperti di server.
      const rasio = k.rasio || (dataIklan && dataIklan.ringkasan.rasioPencairan) || 0.78;
      const cair = (dataIklan && dataIklan.ringkasan.tingkatCair) || 0.85;
      const impas = k.margin > 0 ? 1 / (k.margin * rasio * cair) : null;
      const targetMin = impas === null ? '-' : formatRoas(impas + 2);
      return `<li><span class="nama-singkat" title="${escapeHtml(k.namaProduk)}">${escapeHtml(namaSingkat(k.namaProduk, 60))}<small>${escapeHtml(k.idProduk)} · ${k.pcs} pcs · margin ${Math.round(k.margin * 100)}%</small></span><span class="nilai">target min ${targetMin}</span></li>`;
    })
    .join('');
  kartu.classList.remove('tersembunyi');
}

// ====== Untung toko per minggu (penentu apakah iklan secara keseluruhan menguntungkan) ======
// Dari file Income (per tanggal pesanan) + biaya iklan per kampanye yang dibagi rata per hari.
// Minggu = Senin–Minggu. Minggu yang belum lengkap (dana pesanan belum semua cair — jeda
// pesanan→cair biasanya ≤ 11 hari — atau sebelum awal file) ditandai dan tidak dipakai
// untuk aturan.
const JEDA_CAIR_HARI = 11;
const tambahHari = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const seninIso = (iso) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return null; const d = new Date(iso + 'T00:00:00Z'); const geser = (d.getUTCDay() + 6) % 7; return tambahHari(iso, -geser); };
const labelMinggu = (iso) => { const [, m, d] = iso.split('-'); return `${Number(d)}/${Number(m)}`; };

function untungTokoPerMinggu() {
  if (!dataHasilUpload) return null;
  const minggu = new Map();
  const ambil = (k) => { let t = minggu.get(k); if (!t) { t = { mulai: k, pcs: 0, penghasilan: 0, penghasilanDiketahui: 0, untungDiketahui: 0, biayaIklan: 0, pcsIklan: 0, adaIklan: false }; minggu.set(k, t); } return t; };
  let minRilis = '', maxRilis = '';
  for (const it of dataHasilUpload.items) {
    if (it.dikembalikan) continue;
    const k = seninIso(it.waktuPesanan);
    if (!k) continue;
    const t = ambil(k);
    t.pcs += it.jumlah || 1;
    t.penghasilan += it.totalPenghasilan || 0;
    if (it.hpp !== null && it.untung !== null && it.untung !== undefined) { t.penghasilanDiketahui += it.totalPenghasilan || 0; t.untungDiketahui += it.untung; }
    const r = it.tanggalDilepaskan || '';
    if (r && (!minRilis || r < minRilis)) minRilis = r;
    if (r > maxRilis) maxRilis = r;
  }
  // Biaya iklan dibagi rata per hari kampanye, sampai tanggal laporan file iklan.
  let iklanMulai = '', iklanSelesai = '';
  if (dataIklan) {
    const batas = dataIklan.tanggalLaporanIso || '';
    for (const k of dataIklan.kampanye) {
      if (!k.tanggalMulaiIso) continue;
      let akhir = k.tanggalSelesaiIso || k.tanggalMulaiIso;
      if (batas && akhir > batas) akhir = batas;
      if (akhir < k.tanggalMulaiIso) akhir = k.tanggalMulaiIso;
      const hari = Math.round((Date.parse(akhir) - Date.parse(k.tanggalMulaiIso)) / 86400000) + 1;
      const perHari = k.biaya / hari;
      const pcsPerHari = k.terjual / hari; // pcs yang DIKLAIM iklan (atribusi luas, termasuk produk lain & pesanan batal)
      for (let i = 0; i < hari; i++) {
        const h = tambahHari(k.tanggalMulaiIso, i);
        const t = ambil(seninIso(h));
        t.biayaIklan += perHari; t.pcsIklan += pcsPerHari; t.adaIklan = true;
      }
      if (!iklanMulai || k.tanggalMulaiIso < iklanMulai) iklanMulai = k.tanggalMulaiIso;
      if (akhir > iklanSelesai) iklanSelesai = akhir;
    }
  }
  const batasLengkap = maxRilis ? tambahHari(maxRilis, -JEDA_CAIR_HARI) : '';
  const daftar = [...minggu.values()].sort((a, b) => a.mulai.localeCompare(b.mulai)).map((t) => {
    const selesai = tambahHari(t.mulai, 6);
    // Untung kotor: baris tanpa HPP diperkirakan pakai margin baris yang ada HPP-nya minggu itu.
    const marginDiketahui = t.penghasilanDiketahui ? t.untungDiketahui / t.penghasilanDiketahui : 0;
    const untungKotor = t.untungDiketahui + (t.penghasilan - t.penghasilanDiketahui) * marginDiketahui;
    const lengkap = t.pcs > 0 && t.mulai >= minRilis && selesai <= batasLengkap;
    const iklanLengkap = !!dataIklan && t.mulai >= (iklanMulai || '9999') && selesai <= (iklanSelesai || '');
    // Berapa bagian penjualan toko yang diklaim iklan. Mendekati (atau melewati) 100% =
    // iklan hanya menempel pada penjualan yang memang terjadi, bukan menambah.
    const klaimIklan = t.pcs > 0 && dataIklan ? t.pcsIklan / t.pcs : null;
    return { ...t, selesai, untungKotor, untungSetelahIklan: untungKotor - t.biayaIklan, klaimIklan, lengkap, iklanLengkap, adaIncome: t.pcs > 0 };
  }).filter((t) => t.adaIncome);
  return { minggu: daftar, minRilis, maxRilis, iklanMulai, iklanSelesai };
}

// Aturan satu kalimat: bandingkan N minggu lengkap terakhir dengan N minggu sebelumnya
// (N = 4 kalau datanya ≥ 8 minggu, supaya naik-turun mingguan tidak mengecoh; minimal 2).
function aturanMingguan(data) {
  const lengkap = data.minggu.filter((t) => t.lengkap && t.iklanLengkap);
  if (lengkap.length < 4) return { kelas: '', teks: 'Perlu minimal 4 minggu data lengkap (Income + iklan) untuk menilai.', detail: '' };
  const n = Math.min(4, Math.floor(lengkap.length / 2));
  const akhir = lengkap.slice(-n), awal = lengkap.slice(-2 * n, -n);
  const jml = (arr, f) => arr.reduce((a, t) => a + t[f], 0);
  const iklanA = jml(awal, 'biayaIklan'), iklanB = jml(akhir, 'biayaIklan');
  const untungA = jml(awal, 'untungSetelahIklan'), untungB = jml(akhir, 'untungSetelahIklan');
  const pctIklan = iklanA ? (iklanB - iklanA) / iklanA : 0;
  const pctUntung = untungA ? (untungB - untungA) / Math.abs(untungA) : 0;
  const detail = `${n} minggu terakhir vs ${n} minggu sebelumnya: biaya iklan ${pctIklan >= 0 ? '+' : ''}${Math.round(pctIklan * 100)}%, untung setelah iklan ${pctUntung >= 0 ? '+' : ''}${Math.round(pctUntung * 100)}%.`;
  if (pctIklan >= 0.1 && untungB <= untungA) return { kelas: 'aturan-kurangi', teks: 'Iklan naik, untung tidak naik → kurangi Modal Harian.', detail };
  if (pctIklan <= -0.1 && untungB >= untungA * 0.95) return { kelas: 'aturan-aman', teks: 'Iklan dikurangi, untung tidak turun → pertahankan.', detail };
  if (untungB > untungA && pctIklan >= 0.1) return { kelas: 'aturan-aman', teks: 'Iklan naik dan untung ikut naik → pertahankan.', detail };
  if (pctUntung <= -0.15) return { kelas: '', teks: 'Untung turun walau iklan tetap → bukan soal iklan; cek harga & stok.', detail };
  return { kelas: '', teks: 'Pertahankan, cek lagi minggu depan.', detail };
}

function grafikMingguanSvg(minggu) {
  const W = 720, H = 170, padKiri = 8, padBawah = 26, padAtas = 14;
  const n = minggu.length;
  const lebarSlot = (W - padKiri * 2) / n;
  const maks = Math.max(1, ...minggu.map((t) => Math.max(Math.abs(t.untungSetelahIklan), t.biayaIklan, t.untungKotor)));
  const tinggiArea = H - padAtas - padBawah;
  const nol = padAtas + tinggiArea * (maks / (maks + Math.max(0, -Math.min(0, ...minggu.map((t) => t.untungSetelahIklan)))));
  const skala = (v) => (nol - padAtas) * (v / maks);
  let isi = `<line class="sumbu" x1="${padKiri}" x2="${W - padKiri}" y1="${nol}" y2="${nol}"/>`;
  minggu.forEach((t, i) => {
    const x = padKiri + i * lebarSlot;
    const lebar = Math.min(26, lebarSlot * 0.32);
    const xU = x + lebarSlot / 2 - lebar - 2, xI = x + lebarSlot / 2 + 2;
    const hU = skala(Math.abs(t.untungSetelahIklan)), hI = skala(t.biayaIklan);
    const kelasBelum = t.lengkap && t.iklanLengkap ? '' : ' batang-belum';
    const yU = t.untungSetelahIklan >= 0 ? nol - hU : nol;
    isi += `<rect class="${t.untungSetelahIklan >= 0 ? 'batang-untung' : 'batang-rugi'}${kelasBelum}" x="${xU}" y="${yU}" width="${lebar}" height="${Math.max(hU, 1)}" rx="2"/>`;
    isi += `<rect class="batang-iklan${kelasBelum}" x="${xI}" y="${nol - hI}" width="${lebar}" height="${Math.max(hI, 1)}" rx="2"/>`;
    isi += `<text class="nilai" x="${x + lebarSlot / 2}" y="${(t.untungSetelahIklan >= 0 ? yU : nol + hU) + (t.untungSetelahIklan >= 0 ? -4 : 12)}" text-anchor="middle">${escapeHtml(formatRupiahRingkas(t.untungSetelahIklan).replace('Rp ', ''))}</text>`;
    isi += `<text x="${x + lebarSlot / 2}" y="${H - 8}" text-anchor="middle">${labelMinggu(t.mulai)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Untung toko per minggu">${isi}</svg>
    <div class="legenda-grafik"><span>Untung setelah iklan</span><span class="leg-iklan">Biaya iklan</span></div>`;
}

function renderMingguan() {
  const kartu = document.getElementById('kartuMingguan');
  const aturanEl = document.getElementById('aturanMingguan');
  const grafik = document.getElementById('grafikMingguan');
  const isi = document.getElementById('isiTabelMingguan');
  const catatan = document.getElementById('catatanMingguan');
  const data = untungTokoPerMinggu();
  if (!data || !data.minggu.length) {
    aturanTerakhir = null;
    aturanEl.className = 'aturan-mingguan';
    aturanEl.innerHTML = 'Unggah file Income di Kalkulator Margin untuk melihat apakah anggaran iklan perlu diubah.';
    grafik.innerHTML = ''; isi.innerHTML = ''; catatan.textContent = '';
    return null;
  }
  // Tampilkan sampai 8 minggu terakhir yang punya data Income.
  const tampil = data.minggu.slice(-8);
  const aturan = aturanMingguan(data);
  aturanTerakhir = aturan;
  aturanEl.className = `aturan-mingguan ${aturan.kelas}`;
  const lengkapIklan = data.minggu.filter((t) => t.lengkap && t.iklanLengkap && t.klaimIklan !== null);
  let klaim = '';
  if (lengkapIklan.length >= 2) {
    const akhir = lengkapIklan[lengkapIklan.length - 1], awal = lengkapIklan[0];
    const pct = (t) => `${Math.round(t.klaimIklan * 100)}%`;
    klaim = `<small class="klaim-iklan">Iklan mengklaim <strong>${pct(akhir)}</strong> penjualan toko minggu ${labelMinggu(akhir.mulai)}–${labelMinggu(akhir.selesai)} (awal periode ${pct(awal)}). Mendekati 100% = iklan cuma menempel pada penjualan yang memang terjadi.</small>`;
  }
  aturanEl.innerHTML = `<span>${escapeHtml(aturan.teks)}</span>` +
    (aturan.detail ? `<small>${escapeHtml(aturan.detail)}</small>` : '') + klaim;
  grafik.innerHTML = grafikMingguanSvg(tampil);
  const lengkapTerakhir = [...data.minggu].reverse().find((t) => t.lengkap);
  isi.innerHTML = tampil.map((t) => {
    const belum = !t.lengkap || !t.iklanLengkap;
    const kelas = (belum ? 'minggu-belum' : '') + (lengkapTerakhir && t.mulai === lengkapTerakhir.mulai ? ' minggu-terakhir' : '');
    const iklan = !dataIklan ? '<span class="teks-redup">-</span>' : t.iklanLengkap ? formatRupiah(t.biayaIklan) : `<span title="Di luar periode file iklan">${formatRupiah(t.biayaIklan)}*</span>`;
    return `<tr class="${kelas.trim()}">
      <td data-label="Minggu">${labelMinggu(t.mulai)} – ${labelMinggu(t.selesai)}${belum ? ' <span class="pill pill-abu">belum lengkap</span>' : ''}</td>
      <td class="kolom-angka" data-label="Terjual">${t.pcs} pcs</td>
      <td class="kolom-angka" data-label="Untung Kotor">${formatRupiah(t.untungKotor)}</td>
      <td class="kolom-angka" data-label="Biaya Iklan">${iklan}</td>
      <td class="kolom-angka ${t.untungSetelahIklan >= 0 ? 'untung-positif' : 'untung-negatif'}" data-label="Untung Setelah Iklan">${formatRupiah(t.untungSetelahIklan)}</td>
      <td class="kolom-angka" data-label="Diklaim Iklan">${t.klaimIklan === null ? '<span class="teks-redup">-</span>' : `${Math.round(t.klaimIklan * 100)}%`}</td>
    </tr>`;
  }).join('');
  catatan.textContent = `Minggu Senin–Minggu menurut tanggal pesanan. "Belum lengkap" = dana pesanan belum semua cair (≈ ${JEDA_CAIR_HARI} hari) atau di luar periode file. Untung kotor untuk produk tanpa HPP diperkirakan dari margin produk lain minggu itu. "Diklaim iklan" = pcs yang Shopee catat sebagai hasil iklan (termasuk produk lain & pesanan batal) dibanding pcs yang benar-benar dibayar.`;
  return { data, lengkapTerakhir };
}

function renderRingkasanIklan(r) {
  const rasioPersen = (r.rasioPencairan * 100).toFixed(1).replace('.', ',');
  const catatan = document.getElementById('catatanRasioIklan');
  const periode = dataIklan.periode ? `Periode file: <strong>${escapeHtml(dataIklan.periode)}</strong> · ${r.jumlahKampanye} kampanye, ${r.jumlahProduk} produk. ` : '';
  const cairPersen = Math.round((r.tingkatCair || 0.85) * 100);
  const catatanCair = ` Pesanan iklan dihitung <strong>${cairPersen}%</strong> dibayar (sisanya batal / tidak dibayar)` +
    (dataIklan.sumberTingkatCair === 'pengaturan' ? '.' : ' — angka standar, bisa diubah di bagian "Semua produk &amp; rincian".');
  if (dataIklan.sumberRasio === 'upload') {
    catatan.innerHTML = periode + `Potongan Shopee dihitung dari file Income yang diunggah: rata-rata <strong>${rasioPersen}%</strong> dari harga jual yang cair ke penjual.` + catatanCair;
    catatan.classList.remove('catatan-default');
  } else {
    catatan.innerHTML = periode + `Memakai rasio pencairan standar <strong>${rasioPersen}%</strong> (belum ada file Income yang diunggah). Unggah file Income di Kalkulator Margin supaya angkanya pas dengan toko ini.` + catatanCair;
    catatan.classList.add('catatan-default');
  }

  // Biaya iklan sekarang = Σ Modal Harian yang diisi untuk iklan yang sedang berjalan.
  const kep = keputusanBerjalan();
  const modalEl = document.getElementById('iklanModalSekarang');
  const ketModal = document.getElementById('iklanKetModal');
  if (kep.modalSekarang > 0) {
    modalEl.textContent = `${formatRupiahRingkas(kep.modalSekarang)}/hari`;
    ketModal.textContent = `≈ ${formatRupiahRingkas(kep.modalSekarang * 7)}/minggu` +
      (kep.modalSaran !== null && kep.modalSaran !== kep.modalSekarang ? ` → saran ${formatRupiahRingkas(kep.modalSaran)}/hari` : '') +
      (kep.belumDiisi ? ` · ${kep.belumDiisi} iklan belum diisi modalnya` : '');
  } else {
    modalEl.textContent = '-';
    ketModal.textContent = `Isi Modal Harian tiap iklan di tabel bawah · biaya ${formatRupiahRingkas(r.totalBiaya)} dalam periode file`;
  }

  // Untung toko minggu lengkap terakhir (dari file Income), vs minggu sebelumnya.
  const untung = document.getElementById('iklanUntung');
  const ketUntung = document.getElementById('iklanKetUntung');
  const wUntung = document.getElementById('widgetIklanUntung');
  const mingguan = untungTokoPerMinggu();
  const lengkap = mingguan ? mingguan.minggu.filter((t) => t.lengkap) : [];
  if (lengkap.length) {
    const akhir = lengkap[lengkap.length - 1], sebelum = lengkap[lengkap.length - 2];
    untung.textContent = formatRupiah(akhir.untungSetelahIklan);
    untung.classList.toggle('angka-negatif', akhir.untungSetelahIklan < 0);
    wUntung.textContent = formatRupiah(akhir.untungSetelahIklan);
    wUntung.classList.toggle('angka-negatif', akhir.untungSetelahIklan < 0);
    const banding = sebelum ? ` · minggu sebelumnya ${formatRupiahRingkas(sebelum.untungSetelahIklan)}` : '';
    ketUntung.textContent = `Minggu ${labelMinggu(akhir.mulai)}–${labelMinggu(akhir.selesai)}, setelah biaya iklan${banding}`;
  } else {
    untung.textContent = '-'; untung.classList.remove('angka-negatif');
    wUntung.textContent = '-'; wUntung.classList.remove('angka-negatif');
    ketUntung.textContent = 'Setelah biaya iklan · unggah file Income untuk melihat';
  }

  const hitung = (k) => kep.baris.filter((b) => b.keputusan === k).length;
  const perluTindakan = kep.baris.filter((b) => PERLU_TINDAKAN.has(b.keputusan)).length;
  document.getElementById('iklanRugi').textContent = `${perluTindakan} iklan`;
  document.getElementById('iklanKetRugi').innerHTML =
    `<span class="titik titik-merah"></span>${hitung('jeda')} jeda · <span class="titik titik-oranye-tua"></span>${hitung('kurangi')} kurangi · <span class="titik titik-biru"></span>${hitung('naikkan')} naikkan target · <span class="titik titik-hijau"></span>${hitung('lanjut')} lanjut` +
    (hitung('tunggu') ? ` · <span class="titik titik-abu"></span>${hitung('tunggu')} tunggu` : '');
  document.getElementById('kartuIklanRugi').classList.toggle('kartu-merah', perluTindakan > 0);

  document.getElementById('iklanBelumHpp').textContent = `${r.jumlahBelumHpp} produk`;
  document.getElementById('iklanKetBelumHpp').innerHTML =
    `<span class="titik titik-kuning"></span>Biaya ${formatRupiahRingkas(r.biayaBelumHpp)} belum bisa dinilai`;
  document.getElementById('kartuIklanBelumHpp').classList.toggle('tersembunyi', r.jumlahBelumHpp === 0);

  // Widget di Dashboard
  document.getElementById('widgetIklanBiaya').textContent = kep.modalSekarang > 0 ? `${formatRupiahRingkas(kep.modalSekarang)}/hari` : formatRupiah(r.totalBiaya);
  document.getElementById('widgetIklanRugi').textContent = `${perluTindakan} dari ${kep.baris.length} iklan`;
  document.getElementById('widgetIklanKosong').classList.add('tersembunyi');
  document.getElementById('widgetIklanIsi').classList.remove('tersembunyi');
}

// Nilai yang belum bisa dihitung (null) selalu di bawah, apa pun arah urutnya.
function urutkanProdukIklan(produk) {
  return [...produk].sort((a, b) => {
    const va = a[sortKolomIklan];
    const vb = b[sortKolomIklan];
    if (va === null || va === undefined) return vb === null || vb === undefined ? 0 : 1;
    if (vb === null || vb === undefined) return -1;
    if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb), 'id') * sortArahIklan;
    return (va - vb) * sortArahIklan;
  });
}

function kelasBarisIklan(p) {
  if (p.aksi === 'isi-hpp') return 'baris-peringatan';
  if (p.aksi === 'biarkan') return 'baris-untung';
  if (p.aksi === 'ubah-target') return 'baris-ragu';
  if (p.aksi === 'tunggu' || p.aksi === 'toko') return '';
  return 'baris-rugi'; // jeda
}
const LABEL_AKSI = { 'isi-hpp': ['Isi HPP dulu', 'pill-kuning'], jeda: ['Jeda', 'pill-merah'], 'ubah-target': ['Ubah Target', 'pill-biru'], biarkan: ['Biarkan', 'pill-hijau'], tunggu: ['Tunggu', 'pill-abu'], toko: ['Iklan toko', 'pill-abu'] };

// Satu baris produk di tabel sederhana + (kalau dibuka) baris rincian di bawahnya.
function barisProdukIklan(p, kampanyePerProduk) {
  const terbuka = produkTerbuka.has(p.idProduk);
  const [labelAksi, pillAksi] = LABEL_AKSI[p.aksi] || ['-', 'pill-abu'];
  const kelasTindakan = p.aksi === 'biarkan' ? 'tindakan-untung' : p.aksi === 'isi-hpp' ? 'tindakan-hpp' : p.aksi === 'jeda' ? 'tindakan-rugi' : '';
  const hppTampil = p.hpp === null ? 'belum diisi' : formatRupiah(p.hpp);

  const warnaUntung = (v) => (v >= 0 ? 'untung-positif' : 'untung-negatif');
  const untungTampil = p.untungLangsung === null
    ? '<span class="teks-redup" title="Belum bisa dihitung — HPP produk ini belum diisi">-</span>'
    : `<div class="untung-dua" title="Atas: hitungan Shopee (termasuk produk lain yang ikut terbeli). Bawah: hanya produk ini.">
         <span class="${warnaUntung(p.untungLuas)}"><small>Shopee</small>${formatRupiahRingkas(p.untungLuas)}</span>
         <span class="${warnaUntung(p.untungLangsung)}"><small>ketat</small>${formatRupiahRingkas(p.untungLangsung)}</span>
       </div>`;

  // Saran target: angka untuk diisi di Seller Centre. Untuk "jeda" tidak relevan (—).
  let saranTarget = '-';
  if (p.aksi === 'jeda') saranTarget = '<span class="teks-redup" title="Jeda iklannya — target berapa pun tidak menolong">—</span>';
  else if (p.aksi === 'toko') saranTarget = '<span class="teks-redup">—</span>';
  else if (p.targetDisarankan !== null) saranTarget = `<strong>${formatRoas(p.targetDisarankan)}</strong>`;

  const roasSekarang = p.roasShopee === null ? '-' : formatRoas(p.roasShopee);
  const roasKelas = p.roasImpas !== null && p.roasShopee !== null && p.roasShopee < p.roasImpas ? 'untung-negatif' : '';

  const barisProduk = `
    <tr class="baris-produk ${kelasBarisIklan(p)}${terbuka ? ' terbuka' : ''}" data-id="${escapeHtml(p.idProduk)}">
      <td class="kolom-nama" data-label="Produk" title="${escapeHtml(p.namaProduk)}">
        <div class="produk-iklan">
          <span class="nama"><svg class="ikon panah-baris" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>${escapeHtml(namaSingkat(p.namaProduk, 64))}</span>
          <span class="sub"><span class="kolom-id">${escapeHtml(p.idProduk)}</span>${p.sedangBerjalan ? `<span class="pill pill-hijau">${p.sedangBerjalan} berjalan</span>` : ''}${p.jumlahKampanye > 1 ? `<span>${p.jumlahKampanye} kampanye</span>` : ''}</span>
        </div>
      </td>
      <td class="kolom-angka" data-label="Biaya Iklan">${formatRupiah(p.biaya)}</td>
      <td class="kolom-angka ${roasKelas}" data-label="ROAS di Shopee Sekarang">${roasSekarang}</td>
      <td class="kolom-angka" data-label="Saran Target ROAS">${saranTarget}</td>
      <td class="kolom-angka" data-label="Untung Setelah Iklan">${untungTampil}</td>
      <td class="kolom-tindakan ${kelasTindakan}" data-label="Di Seller Centre"><span class="pill pill-aksi ${pillAksi}">${labelAksi}</span> ${escapeHtml(p.tindakan)}</td>
    </tr>`;

  if (!terbuka) return barisProduk;
  return barisProduk + barisRincianIklan(p, kampanyePerProduk, 6);
}

// Baris rincian (dropdown) di bawah satu produk: kotak-kotak angka + tabel tiap kampanye.
function barisRincianIklan(p, kampanyePerProduk, colspan) {
  const hppTampil = p.hpp === null ? 'belum diisi' : formatRupiah(p.hpp);
  const kotak = (label, nilai, ket) => `<div><div class="label-ringkasan">${label}</div><div class="nilai">${nilai}${ket ? ` <small>${ket}</small>` : ''}</div></div>`;
  const cairPersen = Math.round(((dataIklan && dataIklan.ringkasan.tingkatCair) || 0.85) * 100);
  const dibayar = !p.kampanyeTerukur
    ? [`≈ ${cairPersen}%`, 'perkiraan (belum ada kampanye yang bisa diukur dari file Income)']
    : p.dibayarMaksTerukur < p.terjualLangsungTerukur
      ? [`≤ ${p.dibayarMaksTerukur} dari ${p.terjualLangsungTerukur}`, `terukur di ${p.kampanyeTerukur} kampanye yang sudah cair; sisanya pasti batal / tidak dibayar`]
      : [`≈ ${cairPersen}%`, `${p.kampanyeTerukur} kampanye yang sudah cair tidak menunjukkan pesanan batal; dipakai angka toko`];
  const b = p.berjalan;
  const kotakBerjalan = b
    ? kotak('Kampanye berjalan', `hari ke-${b.hari} · ROAS Shopee <strong>${formatRoas(b.roasShopee)}</strong> · langsung <strong>${formatRoas(b.roasLangsung)}</strong>`,
        b.untungLangsung === null ? 'biaya ' + formatRupiahRingkas(b.biaya) : `ketat ${formatRupiahRingkas(b.untungLangsung)} · biaya ${formatRupiahRingkas(b.biaya)} — vonis memakai angka ini`)
    : '';
  const rincianAngka = `<div class="detail-grid">
    ${kotakBerjalan}
    ${kotak('ROAS langsung', `<strong>${formatRoas(p.roasLangsung)}</strong>`, b ? 'gabungan semua kampanye, hanya produk ini' : 'hanya produk ini')}
    ${kotak('ROAS minimum', formatRoas(p.roasImpas), p.roasImpas === null && p.marginPerRp !== null ? 'tidak mungkin' : 'di bawah ini pasti rugi (sudah termasuk pesanan batal)')}
    ${kotak('Pesanan iklan dibayar', dibayar[0], dibayar[1])}
    ${kotak('Margin per Rp omzet', p.marginPerRp === null ? '-' : formatPersen(p.marginPerRp * 100), 'setelah potongan Shopee & HPP')}
    ${kotak('Omzet versi Shopee', formatRupiahRingkas(p.omzet), `${p.terjual} pcs`)}
    ${kotak('Omzet langsung', formatRupiahRingkas(p.omzetLangsung), `${p.terjualLangsung} pcs`)}
    ${kotak('Untung versi Shopee', p.untungLuas === null ? '-' : formatRupiah(p.untungLuas), 'termasuk produk lain')}
    ${kotak('Untung hitungan ketat', p.untungLangsung === null ? '-' : formatRupiah(p.untungLangsung), 'produk ini saja')}
    ${kotak('Harga jual per pcs', formatRupiahRingkas(p.hargaRata), `HPP ${escapeHtml(hppTampil)} · ${p.sumberHarga === 'income' ? 'dari file Income' : p.sumberHarga === 'langsung' ? 'dari penjualan langsung iklan' : 'perkiraan dari omzet Shopee'}`)}
    ${kotak('Potongan Shopee', p.rasioPencairan ? formatPersen((1 - p.rasioPencairan) * 100) : '-', p.sumberHarga === 'income' ? 'produk ini, dari file Income' : 'rata-rata toko')}
    ${kotak('Mode', escapeHtml(p.modeBidding || '-'), '')}
  </div>`;

  const kampanye = (kampanyePerProduk.get(p.idProduk) || [])
    .slice()
    .sort((a, b) => (b.tanggalMulaiIso || '').localeCompare(a.tanggalMulaiIso || ''));
  const barisKampanye = kampanye
    .map((k) => `
      <tr>
        <td class="nama-kampanye" title="${escapeHtml(k.namaIklan)}">${escapeHtml(namaSingkat(k.namaIklan, 60))}</td>
        <td>${k.status === 'Berjalan' ? '<span class="pill pill-hijau">Berjalan</span>' : `<span class="pill pill-abu">${escapeHtml(k.status || '-')}</span>`}</td>
        <td>${escapeHtml(k.modeBidding.replace(/GMV Max /g, '') || '-')}</td>
        <td>${escapeHtml(k.tanggalMulai)} – ${escapeHtml(k.tanggalSelesai)}</td>
        <td class="kolom-angka">${formatRupiah(k.biaya)}</td>
        <td class="kolom-angka" title="Omzet versi Shopee: ${escapeHtml(formatRupiah(k.omzet))}">${formatRupiah(k.omzetLangsung)}</td>
        <td class="kolom-angka">${formatRoas(k.roasShopee)}</td>
        <td class="kolom-angka"><strong>${formatRoas(k.roasLangsung)}</strong></td>
        <td class="kolom-angka" title="${k.capTerukur ? 'Terukur: semua pesanan produk ini di file Income pada periode kampanye + 7 hari' : 'Perkiraan dari tingkat pesanan dibayar toko'}">${k.capTerukur ? `≤ ${k.pesananDibayarMaks} / ${k.terjualLangsung}` : `<span class="teks-redup">~${cairPersen}%</span>`}</td>
        <td class="kolom-angka">${k.untungLangsung === null ? '-' : `<span class="${k.untungLangsung >= 0 ? 'untung-positif' : 'untung-negatif'}">${formatRupiah(k.untungLangsung)}</span>`}</td>
      </tr>`)
    .join('');

  return `
    <tr class="baris-detail">
      <td colspan="${colspan}" data-label="">
        ${rincianAngka}
        <p class="detail-judul">Tiap kampanye</p>
        <table class="tabel-detail">
          <thead>
            <tr>
              <th>Nama Iklan</th><th>Status</th><th>Mode</th><th>Periode</th>
              <th class="kolom-angka">Biaya</th><th class="kolom-angka">Omzet Langsung</th>
              <th class="kolom-angka">ROAS Shopee</th><th class="kolom-angka">ROAS Langsung</th>
              <th class="kolom-angka" title="Pesanan langsung yang benar-benar dibayar (batas atas terukur) / pesanan langsung menurut Shopee">Dibayar</th>
              <th class="kolom-angka">Untung / Rugi</th>
            </tr>
          </thead>
          <tbody>${barisKampanye}</tbody>
        </table>
      </td>
    </tr>`;
}

// ====== Keputusan untuk iklan yang sedang berjalan ======
// Menggabungkan: vonis per produk (skala Shopee), setelan yang terpasang (Target ROAS &
// Modal Harian, diketik orang tua), dan aturan mingguan toko. Satu keputusan per iklan:
//   'isi-hpp'  → belum bisa dinilai
//   'jeda'     → margin tipis / ROAS Shopee di bawah impas (vonis 'jeda')
//   'naikkan'  → target terpasang di bawah target minimal
//   'kurangi'  → toko: iklan naik tapi untung tidak → Modal Harian dipotong 50% untuk
//                iklan dengan hitungan ketat paling minus
//   'tunggu'   → kampanye belum 7 hari (tahap belajar): jangan diubah, jangan dinilai
//   'toko'     → iklan level toko (tanpa produk), hanya modalnya yang dihitung
//   'lanjut'   → tidak ada yang perlu diubah
// Angka ROAS/untung untuk keputusan diambil dari kampanye yang sedang berjalan (p.berjalan).
const bulatkanModal = (rp) => Math.max(0, Math.round(rp / 5000) * 5000);
const PERLU_TINDAKAN = new Set(['jeda', 'kurangi', 'naikkan', 'isi-hpp']);
const metrikBerjalan = (p) => p.berjalan || p;

function keputusanBerjalan() {
  const baris = [];
  if (!dataIklan) return { baris, modalSekarang: 0, modalSaran: null, belumDiisi: 0 };
  const berjalan = dataIklan.produk.filter((p) => p.sedangBerjalan > 0);
  const perluKurangi = !!(aturanTerakhir && aturanTerakhir.kelas === 'aturan-kurangi');
  // Kandidat dipotong: hitungan ketat minus, urut dari paling minus. Kalau tidak ada yang
  // minus tapi toko tetap bilang kurangi: potong 3 dengan ketat terkecil.
  let dipotong = new Set();
  if (perluKurangi) {
    const dinilai = berjalan.filter((p) => !['jeda', 'isi-hpp', 'tunggu', 'toko'].includes(p.aksi) && metrikBerjalan(p).untungLangsung !== null)
      .sort((a, b) => metrikBerjalan(a).untungLangsung - metrikBerjalan(b).untungLangsung);
    const minus = dinilai.filter((p) => metrikBerjalan(p).untungLangsung < 0);
    dipotong = new Set((minus.length ? minus : dinilai.slice(0, 3)).map((p) => p.idProduk));
  }
  let modalSekarang = 0, modalSaran = 0, belumDiisi = 0, adaModal = false;
  for (const p of berjalan) {
    const st = daftarSetelan.get(p.idProduk) || {};
    const target = Number.isFinite(st.target_roas) ? st.target_roas : null;
    const modal = Number.isFinite(st.modal_harian) ? st.modal_harian : null;
    const minimal = p.targetDisarankan;
    let keputusan, modalBaru = modal;
    if (p.aksi === 'isi-hpp') keputusan = 'isi-hpp';
    else if (p.aksi === 'toko') keputusan = 'toko';
    else if (p.aksi === 'tunggu') keputusan = 'tunggu';
    else if (p.aksi === 'jeda') { keputusan = 'jeda'; modalBaru = 0; }
    else if (target !== null && minimal !== null && target < minimal) keputusan = 'naikkan';
    else if (dipotong.has(p.idProduk)) { keputusan = 'kurangi'; modalBaru = modal !== null ? bulatkanModal(modal / 2) : null; }
    else keputusan = 'lanjut';
    if (modal !== null) { modalSekarang += modal; adaModal = true; modalSaran += modalBaru !== null ? modalBaru : modal; }
    else belumDiisi += 1;
    baris.push({ p, target, modal, minimal, keputusan, modalBaru });
  }
  const urutan = { jeda: 0, kurangi: 1, naikkan: 2, 'isi-hpp': 3, tunggu: 4, lanjut: 5, toko: 6 };
  baris.sort((a, b) => urutan[a.keputusan] - urutan[b.keputusan] || b.p.biaya - a.p.biaya);
  return { baris, modalSekarang, modalSaran: adaModal ? modalSaran : null, belumDiisi, perluKurangi };
}

const LABEL_KEPUTUSAN = {
  'isi-hpp': ['Isi HPP dulu', 'pill-kuning', 'baris-peringatan'],
  jeda: ['Jeda', 'pill-merah', 'baris-rugi'],
  naikkan: ['Naikkan target', 'pill-biru', 'baris-ragu'],
  kurangi: ['Kurangi modal', 'pill-oranye', 'baris-kurangi'],
  tunggu: ['Tunggu', 'pill-abu', ''],
  lanjut: ['Lanjut', 'pill-hijau', 'baris-untung'],
  toko: ['Iklan toko', 'pill-abu', ''],
};

function kalimatKeputusan(b) {
  const f = formatRoas;
  switch (b.keputusan) {
    case 'isi-hpp': return 'Isi HPP di Kalkulator Margin.';
    case 'jeda': case 'tunggu': case 'toko': return b.p.tindakan;
    case 'naikkan': return `Ubah Target ROAS ${f(b.target)} → ${f(b.minimal)}.`;
    case 'kurangi': return b.modal !== null
      ? `Turunkan Modal Harian ke ${formatRupiahRingkas(b.modalBaru)}. Target tetap.`
      : 'Turunkan Modal Harian 50%. Target tetap.';
    default: return b.target === null && b.modal === null ? 'Tidak ada yang perlu diubah.' : 'Tidak ada yang perlu diubah.';
  }
}

// Baris kecil di bawah nama produk di tabel keputusan: ROAS Shopee (yang dinilai Shopee
// terhadap target) dan ROAS Langsung vs minimum (batas bawah untung) — dari kampanye yang
// sedang berjalan. Merah kalau ROAS Langsung di bawah minimum: iklan ini belum tentu untung
// walau Shopee bilang "Baik".
function subRoasBerjalan(p) {
  if (p.aksi === 'toko') return '';
  const m = metrikBerjalan(p);
  const hari = p.berjalan ? `<span>hari ke-${p.berjalan.hari}</span>` : '';
  const langsung = p.roasImpas === null
    ? `<span>langsung ${formatRoas(m.roasLangsung)}</span>`
    : `<span class="${m.roasLangsung !== null && m.roasLangsung < p.roasImpas ? 'roas-rendah' : ''}" title="ROAS Langsung (hanya produk ini) dibanding ROAS minimum">langsung ${formatRoas(m.roasLangsung)} · min ${formatRoas(p.roasImpas)}</span>`;
  return `${hari}<span>Shopee ${formatRoas(m.roasShopee)}</span>${langsung}`;
}

function renderKeputusan() {
  const isi = document.getElementById('isiTabelKeputusan');
  const info = document.getElementById('infoKeputusan');
  const aturanEl = document.getElementById('aturanMingguan');
  const kep = keputusanBerjalan();

  // Baris anggaran (di kartu 1) — angka sekarang → saran, kalau modal sudah diisi.
  if (kep.modalSekarang > 0) {
    const sekarang = `Sekarang <strong>${formatRupiahRingkas(kep.modalSekarang)}/hari</strong> (≈ ${formatRupiahRingkas(kep.modalSekarang * 7)}/minggu)`;
    const saran = kep.modalSaran !== null && kep.modalSaran !== kep.modalSekarang
      ? ` → <strong>${formatRupiahRingkas(kep.modalSaran)}/hari</strong> selama 2 minggu, lalu cek lagi.`
      : ' → tetap.';
    const tambahan = kep.belumDiisi ? ` <small>(${kep.belumDiisi} iklan belum diisi modalnya)</small>` : '';
    const ada = aturanEl.querySelector('.baris-anggaran');
    if (ada) ada.remove();
    aturanEl.insertAdjacentHTML('beforeend', `<span class="baris-anggaran">${sekarang}${saran}${tambahan}</span>`);
  }

  if (!kep.baris.length) {
    isi.innerHTML = '<tr><td colspan="4" class="teks-redup">Tidak ada iklan yang sedang berjalan di file ini.</td></tr>';
    info.textContent = '';
    return;
  }
  const perlu = kep.baris.filter((b) => PERLU_TINDAKAN.has(b.keputusan)).length;
  info.textContent = `${kep.baris.length} iklan · ${perlu ? `${perlu} perlu diubah` : 'semua lanjut'}`;

  const kampanyePerProduk = new Map();
  for (const k of dataIklan.kampanye) {
    if (!kampanyePerProduk.has(k.kodeProduk)) kampanyePerProduk.set(k.kodeProduk, []);
    kampanyePerProduk.get(k.kodeProduk).push(k);
  }

  isi.innerHTML = kep.baris.map((b) => {
    const p = b.p;
    const [label, pill, kelasBaris] = LABEL_KEPUTUSAN[b.keputusan];
    const terbuka = keputusanTerbuka.has(p.idProduk);
    const inputModal = `<input type="number" step="5000" min="0" class="input-setelan${b.modal === null ? ' kosong' : ''}" data-id="${escapeHtml(p.idProduk)}" data-field="modalHarian" value="${b.modal === null ? '' : b.modal}" placeholder="Rp/hari" title="Modal Harian yang terpasang di Seller Centre">`;
    const saranModal = b.keputusan === 'jeda'
      ? '<span class="panah">→</span> <span class="saran nol">0</span>'
      : b.keputusan === 'kurangi'
        ? `<span class="panah">→</span> <span class="saran turun">${b.modalBaru !== null ? formatRupiahRingkas(b.modalBaru).replace('Rp ', '') : '−50%'}</span>`
        : b.modal !== null ? '<span class="panah">→</span> <span class="saran">tetap</span>' : '';
    const inputTarget = `<input type="number" step="0.1" min="0" class="input-setelan${b.target === null ? ' kosong' : ''}${b.keputusan === 'naikkan' ? ' terlalu-rendah' : ''}" data-id="${escapeHtml(p.idProduk)}" data-field="targetRoas" value="${b.target === null ? '' : b.target}" placeholder="target" title="Target ROAS yang terpasang di Seller Centre">`;
    const infoTarget = b.minimal === null
      ? '<span class="min">—</span>'
      : b.keputusan === 'naikkan'
        ? `<span class="panah">→</span> <span class="saran">${formatRoas(b.minimal)}</span>`
        : `<span class="min">(min ${formatRoas(b.minimal)})</span>${b.target !== null && b.keputusan !== 'jeda' ? ' <span class="ok">✓</span>' : ''}`;
    const baris = `
      <tr class="baris-produk ${kelasBaris}${terbuka ? ' terbuka' : ''}" data-id="${escapeHtml(p.idProduk)}">
        <td class="kolom-nama" data-label="Produk" title="${escapeHtml(p.namaProduk)}">
          <div class="produk-iklan">
            <span class="nama"><svg class="ikon panah-baris" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>${escapeHtml(namaSingkat(p.namaProduk, 56))}</span>
            <span class="sub"><span class="kolom-id">${escapeHtml(p.idProduk)}</span>${subRoasBerjalan(p)}</span>
          </div>
        </td>
        <td class="kolom-tengah" data-label="Modal Harian"><span class="sel-setelan"><span class="prefix">Rp</span>${inputModal}${saranModal}</span></td>
        <td class="kolom-tengah" data-label="Target ROAS"><span class="sel-setelan">${inputTarget}${infoTarget}</span></td>
        <td class="kolom-tindakan" data-label="Keputusan"><span class="pill pill-aksi ${pill}">${label}</span> ${escapeHtml(kalimatKeputusan(b))}</td>
      </tr>`;
    return terbuka ? baris + barisRincianIklan(p, kampanyePerProduk, 4) : baris;
  }).join('');

  isi.querySelectorAll('tr.baris-produk').forEach((tr) => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('input')) return; // klik di kotak isian bukan untuk buka rincian
      const id = tr.dataset.id;
      if (keputusanTerbuka.has(id)) keputusanTerbuka.delete(id); else keputusanTerbuka.add(id);
      renderKeputusan();
    });
  });
  isi.querySelectorAll('.input-setelan').forEach((input) => {
    const awal = input.value;
    input.addEventListener('change', () => { if (input.value !== awal) simpanSetelanIklan(input.dataset.id, input.dataset.field, input.value); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
  });
}

function renderTabelIklan() {
  const kataKunci = inputCariIklan.value.trim().toLowerCase();
  let daftar = dataIklan.produk;
  if (kataKunci) {
    daftar = daftar.filter((p) => [p.namaProduk, p.idProduk, p.namaIklan].some((v) => String(v || '').toLowerCase().includes(kataKunci)));
  }
  if (filterIklan !== 'semua') daftar = daftar.filter((p) => p.aksi === filterIklan);
  daftar = urutkanProdukIklan(daftar);

  const totalBiaya = daftar.reduce((t, p) => t + p.biaya, 0);
  infoJumlahIklan.textContent = `${daftar.length} produk · biaya ${formatRupiahRingkas(totalBiaya)}`;

  if (!daftar.length) {
    isiTabelIklan.innerHTML = `<tr><td colspan="6" class="teks-redup">Tidak ada produk yang cocok.</td></tr>`;
    return;
  }

  const kampanyePerProduk = new Map();
  for (const k of dataIklan.kampanye) {
    if (!kampanyePerProduk.has(k.kodeProduk)) kampanyePerProduk.set(k.kodeProduk, []);
    kampanyePerProduk.get(k.kodeProduk).push(k);
  }

  // Yang sedang berjalan di atas — itu yang bisa diubah sekarang; yang sudah berakhir
  // di bawah sebagai catatan.
  const berjalan = daftar.filter((p) => p.sedangBerjalan > 0);
  const berakhir = daftar.filter((p) => !p.sedangBerjalan);
  const perluUbah = (items) => items.filter((p) => p.aksi === 'jeda' || p.aksi === 'ubah-target').length;
  // Grup "Sudah berakhir" bisa dilipat (default: terlipat) — halaman ini untuk
  // "apa yang harus diubah sekarang"; yang sudah berakhir hanya catatan.
  const grup = (judul, kelas, items, ket, bisaDilipat, terbuka) => {
    if (!items.length) return '';
    const panah = bisaDilipat ? `<svg class="ikon panah-baris${terbuka ? ' buka' : ''}" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>` : '';
    const header = `<tr class="baris-grup ${kelas}${bisaDilipat ? ' bisa-dilipat' : ''}" data-grup="${kelas}"><td colspan="6" data-label="">${panah}${judul} (${items.length})${ket ? `<span class="pill pill-abu">${ket}</span>` : ''}${bisaDilipat && !terbuka ? '<span class="petunjuk-lipat">klik untuk melihat</span>' : ''}</td></tr>`;
    return header + (bisaDilipat && !terbuka ? '' : items.map((p) => barisProdukIklan(p, kampanyePerProduk)).join(''));
  };

  isiTabelIklan.innerHTML =
    (berjalan.length
      ? grup('Sedang berjalan', 'grup-berjalan', berjalan, perluUbah(berjalan) ? `${perluUbah(berjalan)} perlu diubah` : 'semua aman', false, true)
      : `<tr class="baris-grup grup-berjalan"><td colspan="6" data-label="">Sedang berjalan (0)<span class="pill pill-abu">tidak ada iklan yang sedang berjalan di file ini</span></td></tr>`) +
    grup('Sudah berakhir', 'grup-berakhir', berakhir, perluUbah(berakhir) ? `${perluUbah(berakhir)} rugi — jangan diulang` : 'catatan untuk iklan berikutnya', true, grupBerakhirTerbuka);

  isiTabelIklan.querySelectorAll('tr.baris-grup.bisa-dilipat').forEach((tr) => {
    tr.addEventListener('click', () => { grupBerakhirTerbuka = !grupBerakhirTerbuka; renderTabelIklan(); });
  });

  isiTabelIklan.querySelectorAll('tr.baris-produk').forEach((tr) => {
    tr.addEventListener('click', () => {
      const id = tr.dataset.id;
      if (produkTerbuka.has(id)) produkTerbuka.delete(id); else produkTerbuka.add(id);
      renderTabelIklan();
    });
  });
}

inputCariIklan.addEventListener('input', () => { if (dataIklan) renderTabelIklan(); });

document.querySelectorAll('.pill-filter[data-filter-iklan]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pill-filter[data-filter-iklan]').forEach((b) => b.classList.remove('aktif'));
    btn.classList.add('aktif');
    filterIklan = btn.dataset.filterIklan;
    if (dataIklan) renderTabelIklan();
  });
});

document.querySelectorAll('#tabelIklan .th-urut').forEach((th) => {
  th.addEventListener('click', () => {
    if (sortKolomIklan === th.dataset.urut) {
      sortArahIklan *= -1;
    } else {
      sortKolomIklan = th.dataset.urut;
      // Kolom angka: klik pertama = terbesar di atas (yang biasanya ingin dilihat); teks = A-Z.
      sortArahIklan = th.classList.contains('kolom-angka') ? -1 : 1;
    }
    perbaruiIndikatorUrutHeader('#tabelIklan', sortKolomIklan, sortArahIklan);
    if (dataIklan) renderTabelIklan();
  });
});
perbaruiIndikatorUrutHeader('#tabelIklan', sortKolomIklan, sortArahIklan);

// ====== Mulai ======
cekSesi();
