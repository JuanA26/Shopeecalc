// ====== Util ======
const formatRupiah = (angka) => {
  if (angka === null || angka === undefined || isNaN(angka)) return '-';
  return 'Rp ' + Math.round(angka).toLocaleString('id-ID');
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

function perbaruiIndikatorUrutHeader() {
  document.querySelectorAll('#tabelData .th-urut').forEach((th) => {
    const aktif = th.dataset.urut === sortKolom;
    th.classList.toggle('urut-aktif', aktif);
    const panahLama = th.querySelector('.panah-urut');
    if (panahLama) panahLama.remove();
    const naik = '<path d="m6 15 6-6 6 6"/>';
    const turun = '<path d="m6 9 6 6 6-6"/>';
    const isi = aktif ? (sortArah === 1 ? naik : turun) : '<path d="m8 9 4-4 4 4"/><path d="m8 15 4 4 4-4"/>';
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

  dataHasilUpload.ringkasan = {
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
}

// Gabungkan daftar HPP yang sudah tersimpan dengan produk-produk yang muncul di file
// yang baru diunggah tapi belum punya HPP — supaya semuanya kelihatan & bisa diisi di sini juga,
// tidak perlu ketik ulang ID Produk secara manual.
function gabunganProdukUntukTabelHpp() {
  const sudahAda = new Set(daftarHpp.map((r) => r.id_produk));
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

  // Produk yang belum ada HPP ditaruh di atas supaya langsung kelihatan perlu diisi.
  return [...belumPunyaHpp, ...daftarHpp];
}

let filterHpp = 'semua'; // 'semua' | 'belum' | 'sudah'

function renderTabelHpp() {
  const kataKunci = inputCariHpp.value.trim().toLowerCase();
  const semua = gabunganProdukUntukTabelHpp();
  let filtered = !kataKunci
    ? semua
    : semua.filter((r) => [r.id_produk, r.nama_produk].some((v) => String(v).toLowerCase().includes(kataKunci)));

  if (filterHpp === 'belum') filtered = filtered.filter((r) => r.hpp === null);
  if (filterHpp === 'sudah') filtered = filtered.filter((r) => r.hpp !== null);

  if (!filtered.length) {
    isiTabelHpp.innerHTML = `<tr><td colspan="6" class="teks-redup">Belum ada produk. Tambahkan di atas, atau unggah file dulu di tab "Unggah &amp; Lihat Data".</td></tr>`;
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

// ====== Mulai ======
cekSesi();
