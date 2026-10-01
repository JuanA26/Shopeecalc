// Semua logika halaman (tanpa framework, tanpa build). Urutan bagian di file ini:
//   Util · State · Elemen · Login/Sesi · Navigasi halaman
//   Data otomatis dari Shopee (sinkron) + progress bar
//   Kalkulator Margin: tren harian, tabel pesanan · Tab HPP · Impor CSV HPP
//   Analisis Iklan: muat data iklan, untung toko per minggu, tabel semua produk,
//     keputusanBerjalan() = saran per iklan (aturan: notes/calculations.md)
//   Tugas Minggu Ini (Dashboard) · Pengaturan (diagnostik + unduh Excel) · Mulai
// Perhitungan murni yang juga dipakai server/tes ada di evaluasiIklan.js.
// Cari bagian dengan "// ======".

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
    // Sesi login habis (12 jam) saat halaman masih terbuka: kembali ke layar login, jangan
    // tampilkan error membingungkan di setiap kartu. /api/login sendiri dikecualikan.
    if (res.status === 401 && !url.startsWith('/api/login') && typeof tampilkanLogin === 'function') tampilkanLogin();
    throw new Error((body && body.error) || `Terjadi kesalahan (${res.status}).`);
  }
  return body;
}

// ====== State ======
let dataHasilUpload = null; // { items, ringkasan } — periode yang dipilih di Kalkulator
// Data penjualan 90 hari terakhir khusus untuk Analisis Iklan: analisis iklan butuh rentang
// panjang dengan dana yang sudah cair, jadi tidak ikut periode Kalkulator (mis. "Hari ini").
let dataPenjualanIklan = null;
const sumberIklan = () => dataPenjualanIklan || dataHasilUpload;
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
    tampilkanAplikasi(info.username, info.bacaSaja);
  } else {
    tampilkanLogin();
  }
}

function tampilkanLogin() {
  halamanLogin.classList.remove('tersembunyi');
  aplikasiUtama.classList.add('tersembunyi');
}

// Akun baca-saja (AKUN_BACA_SAJA di server): bisa melihat semua, tidak memicu sinkron/mengubah data.
let akunBacaSaja = false;
function tampilkanAplikasi(username, bacaSaja = false) {
  akunBacaSaja = !!bacaSaja;
  halamanLogin.classList.add('tersembunyi');
  aplikasiUtama.classList.remove('tersembunyi');
  labelUsername.textContent = username;
  document.getElementById('labelBacaSaja').classList.toggle('tersembunyi', !akunBacaSaja);
  document.body.classList.toggle('akun-baca-saja', akunBacaSaja);
  document.getElementById('avatarUser').textContent = String(username || '?').slice(0, 1);
  muatDaftarHpp();
  muatSetelanIklan();
  muatPengaturan();
  mulaiDataOtomatis();
}

formLogin.addEventListener('submit', async (e) => {
  e.preventDefault();
  pesanErrorLogin.classList.add('tersembunyi');
  const username = document.getElementById('inputUsername').value.trim();
  const password = document.getElementById('inputPassword').value;
  try {
    const hasil = await apiFetch('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    tampilkanAplikasi(hasil.username, hasil.bacaSaja);
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
  // Grafik tren diukur dari lebar kartunya — gambar ulang begitu halamannya kelihatan.
  if (idHalaman === 'halamanKalkulator' && dataHasilUpload) renderTren();
  if (idHalaman === 'halamanPengaturan') muatDiagnostik();
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
    if (btn.dataset.subtab === 'subUpload' && dataHasilUpload) renderTren();
  });
});

// Data penjualan baru (dari sinkron Shopee) →
// tampilkan di kalkulator, tab HPP, dan dipakai halaman Analisis Iklan.
function terapkanDataPenjualan(body) {
  dataHasilUpload = body;
  renderRingkasan(body.ringkasan);
  renderTabelData(body.items);
  renderTabelHpp(); // refresh tab HPP juga, supaya produk dari data ini langsung kelihatan di sana
  areaRingkasan.classList.remove('tersembunyi');
  renderTren();
  hitungUlangIklan(); // rasio pencairan & harga dari data ini dipakai halaman Analisis Iklan juga
  if (!dataIklan) { renderMingguan(); renderTugas(); } // belum ada data iklan: tetap tampilkan untung toko per minggu
}

// ====== Data otomatis dari Shopee (sinkron API) ======
const tanggalDari = document.getElementById('tanggalDari');
const tanggalSampai = document.getElementById('tanggalSampai');
const tombolTampilkan = document.getElementById('tombolTampilkan');
const teksStatusSinkron = document.getElementById('statusSinkron');
const pesanErrorSinkron = document.getElementById('pesanErrorSinkron');
const pesanLoadingSinkron = document.getElementById('pesanLoadingSinkron');
let statusSinkronTerakhir = null;

// "Hari ini" menurut kalender WIB (GMT+7) — server memberi tanggal pesanan dalam WIB (sama seperti
// laporan Shopee), jadi periode juga harus WIB, bukan jam HP. Tanpa ini, di Banjarmasin (WITA,
// +1 jam) pukul 00.00–01.00 "Hari ini" meminta tanggal WIB yang belum dimulai → kosong.
const hariIniWib = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
// Tanggal ISO + n hari (aritmetika UTC murni, tanpa zona waktu).
const geserHari = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const formatTanggalPendek = (iso) =>
  iso ? new Date(iso + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
const tanggalSingkat = (iso) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : '-');
// "1 Okt 14.05": jam HP (waktuSingkat) atau jam WIB (waktuWib, untuk teks yang menyebut "WIB").
const waktuSingkat = (iso) => new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const waktuWib = (iso) => (iso ? new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }) : '-');

// [dari, sampai] sebagai string YYYY-MM-DD (kalender WIB).
function rentangPeriode(kode) {
  const hariIni = hariIniWib();
  const awalBulan = hariIni.slice(0, 8) + '01';
  if (kode === 'hari-ini') return [hariIni, hariIni];
  if (kode === 'bulan-ini') return [awalBulan, hariIni];
  if (kode === 'bulan-lalu') { const akhirLalu = geserHari(awalBulan, -1); return [akhirLalu.slice(0, 8) + '01', akhirLalu]; }
  return [geserHari(hariIni, -(Number(kode) - 1)), hariIni];
}

function pilihPeriode(kode) {
  document.querySelectorAll('.pill-filter[data-periode]').forEach((b) => b.classList.toggle('aktif', b.dataset.periode === kode));
  const [dari, sampai] = rentangPeriode(kode);
  tanggalDari.value = dari;
  tanggalSampai.value = sampai;
}

document.querySelectorAll('.pill-filter[data-periode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    pilihPeriode(btn.dataset.periode);
    // "Hari ini": ambil pesanan terbaru dulu kalau sinkron terakhir sudah > 5 menit lalu.
    const s = statusSinkronTerakhir;
    const basi = s && s.terhubung && !s.sedangBerjalan && (!s.terakhirSelesai || Date.now() - Date.parse(s.terakhirSelesai) > 5 * 60 * 1000);
    if (btn.dataset.periode === 'hari-ini' && basi) sinkronSekarang(); else muatDataPenjualan();
  });
});
// Ubah tanggal manual → tidak ada pill periode yang aktif lagi
[tanggalDari, tanggalSampai].forEach((el) => el.addEventListener('change', () => {
  document.querySelectorAll('.pill-filter[data-periode]').forEach((b) => b.classList.remove('aktif'));
}));
tombolTampilkan.addEventListener('click', () => muatDataPenjualan());

function tampilkanLoadingSinkron(teks) {
  document.getElementById('teksLoadingSinkron').textContent = teks;
  pesanLoadingSinkron.classList.toggle('tersembunyi', !teks);
}
function tampilkanErrorSinkron(teks) {
  pesanErrorSinkron.textContent = teks || '';
  pesanErrorSinkron.classList.toggle('tersembunyi', !teks);
}

async function muatDataPenjualan() {
  if (!statusSinkronTerakhir || !statusSinkronTerakhir.terhubung) return;
  if (!tanggalDari.value || !tanggalSampai.value) return;
  if (tanggalDari.value > tanggalSampai.value) { tampilkanErrorSinkron('Tanggal "Dari" tidak boleh sesudah tanggal "Sampai".'); return; }
  tampilkanErrorSinkron('');
  tampilkanLoadingSinkron('Memuat data...');
  tombolTampilkan.disabled = true;
  try {
    const q = new URLSearchParams({ dari: tanggalDari.value, sampai: tanggalSampai.value });
    terapkanDataPenjualan(await apiFetch(`/api/pesanan?${q}`));
  } catch (err) {
    tampilkanErrorSinkron(err.message);
  } finally {
    tampilkanLoadingSinkron('');
    tombolTampilkan.disabled = false;
  }
}

function renderStatusSinkron(s) {
  statusSinkronTerakhir = s;
  const terhubung = !!(s && s.terhubung);
  document.getElementById('tautanHubungkan').classList.toggle('tersembunyi', terhubung);
  tombolTampilkan.disabled = !terhubung;
  if (!terhubung) {
    teksStatusSinkron.textContent = 'Toko belum terhubung ke Shopee. Cukup hubungkan sekali, lalu data diambil otomatis.';
    renderStatusData();
    return;
  }
  const bagian = [];
  if (s.sedangBerjalan) bagian.push('Sedang mengambil data dari Shopee...');
  else if (s.terakhirSelesai) {
    const waktu = waktuSingkat(s.terakhirSelesai);
    bagian.push(s.status === 'gagal' ? `Sinkron terakhir gagal (${waktu})` : `Terakhir diperbarui ${waktu}`);
  } else bagian.push('Belum pernah sinkron');
  if (s.jumlahPesanan) bagian.push(`${s.jumlahPesanan.toLocaleString('id-ID')} pesanan tersimpan (${formatTanggalPendek(s.tanggalTerlama)} – ${formatTanggalPendek(s.tanggalTerbaru)})`);
  bagian.push('otomatis tiap 30 menit');
  if (s.ulangTertunda) bagian.push(`${s.ulangTertunda} pesanan menunggu diperiksa. Dilanjutkan otomatis`);
  if (s.ulangMacet) bagian.push(`${s.ulangMacet} pesanan belum bisa diperiksa. Tetap dicoba otomatis`);
  teksStatusSinkron.textContent = bagian.join(' · ');
  tampilkanErrorSinkron(s.status === 'gagal' && s.pesan ? `Sinkron terakhir gagal: ${s.pesan}` : '');
  renderStatusData();
}

// ====== Status data di bar atas (semua halaman) ======
// Satu tombol kecil: "Diperbarui 5 mnt lalu" → tekan untuk ambil data terbaru dari Shopee.
// Saat berjalan: "Memperbarui 40%" + garis kemajuan di bawah bar atas. Langkah 1 (pesanan) =
// 0–50%, langkah 2 (dana cair / iklan) = 50–100%; selama jumlahnya belum diketahui garisnya
// bergerak bolak-balik. Selesai: "✓ Selesai" beberapa detik; gagal: merah "Gagal · coba lagi".
const tombolStatusData = document.getElementById('tombolStatusData');
const LAMA_DATA_MS = 60 * 60 * 1000; // jadwal tiap 30 menit: > 1 jam berarti ada yang terlewat
let hasilSinkronBaru = null;         // { gagal, teks } — tampil sebentar setelah sinkron selesai
let jedaHasilSinkron = null;
let progresTadiBerjalan = false;
let sinkronKlienAktif = false;       // sinkron dipicu dari browser ini dan belum selesai
let sinkronKlien = null;             // janjinya (klik ganda / unduh Excel menunggu yang sama)
let sinkronDilewati = false;         // tidak ada sinkron baru (baca saja / < 1 menit): jangan ulangi angka lama

function waktuRelatif(iso) {
  const menit = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (!(menit >= 1)) return 'baru saja';
  if (menit < 60) return `${menit} mnt lalu`;
  const jam = Math.floor(menit / 60);
  if (jam < 24) return `${jam} jam lalu`;
  return `${Math.floor(jam / 24)} hari lalu`;
}

function aturStatusData(kelas, panjang, pendek, judul) {
  tombolStatusData.className = `status-data ${kelas}`;
  document.getElementById('statusDataPanjang').textContent = panjang;
  document.getElementById('statusDataPendek').textContent = pendek;
  tombolStatusData.title = judul;
  tombolStatusData.setAttribute('aria-label', `${panjang}. ${judul}`);
}
function umumkanStatusData(teks) { document.getElementById('umumkanStatusData').textContent = teks; }

function renderStatusData() {
  const s = statusSinkronTerakhir;
  const bar = document.getElementById('progresHeader');
  const isi = document.getElementById('progresHeaderIsi');
  if (!s || !s.terhubung) { tombolStatusData.classList.add('tersembunyi'); bar.classList.add('tersembunyi'); return; }
  const otomatis = 'Data diambil otomatis tiap 30 menit.';
  const caraTekan = akunBacaSaja ? 'Akun baca saja: tekan untuk memuat ulang data.' : 'Tekan untuk mengambil data terbaru.';

  if (s.sedangBerjalan || sinkronKlienAktif) {
    clearTimeout(jedaHasilSinkron); hasilSinkronBaru = null;
    if (!progresTadiBerjalan) umumkanStatusData('Memperbarui data dari Shopee...');
    progresTadiBerjalan = true;
    const p = s.sedangBerjalan ? s.progres : null;
    const idx = !p || p.tahap === 'pesanan' ? 0 : 1;
    const nama = !p ? 'Menghubungi Shopee' : idx === 0 ? 'Mengambil pesanan' : p.tahap === 'iklan' ? 'Mengambil data iklan' : 'Mengambil dana cair';
    const tentu = !!p && p.total !== null && p.total !== undefined;
    const persen = tentu ? Math.round(((idx + (p.total ? p.selesai / p.total : 1)) / 2) * 100) : null;
    bar.classList.remove('tersembunyi', 'selesai', 'gagal');
    bar.classList.toggle('tak-tentu', !tentu);
    if (tentu) { isi.style.width = `${persen}%`; bar.setAttribute('aria-valuenow', String(persen)); } else bar.removeAttribute('aria-valuenow');
    const rincian = tentu && p.total ? ` · ${p.selesai.toLocaleString('id-ID')} dari ${p.total.toLocaleString('id-ID')}` : '';
    aturStatusData('berjalan', persen !== null ? `Memperbarui ${persen}%` : 'Memperbarui...', persen !== null ? `${persen}%` : 'Memperbarui',
      `Langkah ${idx + 1} dari 2: ${nama}${rincian}. Data lama tetap bisa dilihat.`);
    tombolStatusData.disabled = true;
    return;
  }

  tombolStatusData.disabled = false;
  if (progresTadiBerjalan) {
    // Baru saja selesai: tampilkan hasilnya sebentar.
    progresTadiBerjalan = false;
    const gagal = s.status === 'gagal';
    const nOrder = s.jumlahOrderBerubah || 0, nDana = s.jumlahBaru || 0;
    const baru = [];
    if (nOrder) baru.push(`${nOrder.toLocaleString('id-ID')} pesanan baru/berubah`);
    if (nDana) baru.push(`${nDana.toLocaleString('id-ID')} dana cair baru`);
    hasilSinkronBaru = {
      gagal,
      teks: gagal ? 'Gagal mengambil data' : sinkronDilewati ? 'Selesai · data sudah terbaru' : baru.length ? `Selesai · ${baru.join(' · ')}` : 'Selesai · tidak ada pesanan baru',
      singkat: nOrder && !sinkronDilewati ? `✓ ${nOrder.toLocaleString('id-ID')} pesanan baru` : '✓ Data sudah terbaru',
    };
    sinkronDilewati = false;
    umumkanStatusData(hasilSinkronBaru.teks);
    isi.style.width = '100%';
    bar.classList.remove('tak-tentu');
    bar.classList.add(gagal ? 'gagal' : 'selesai');
    clearTimeout(jedaHasilSinkron);
    jedaHasilSinkron = setTimeout(() => { hasilSinkronBaru = null; renderStatusData(); }, 4000);
  }
  if (hasilSinkronBaru && !hasilSinkronBaru.gagal) {
    aturStatusData('selesai', hasilSinkronBaru.singkat, '✓ Selesai', `${hasilSinkronBaru.teks}. ${otomatis}`);
    return;
  }
  if (!hasilSinkronBaru) {
    bar.classList.add('tersembunyi');
    bar.classList.remove('selesai', 'gagal');
    isi.style.width = '0';
  }

  if (s.status === 'gagal') {
    aturStatusData('gagal', 'Gagal · coba lagi', 'Gagal',
      `Gagal mengambil data dari Shopee${s.pesan ? `: ${s.pesan.replace(/\.+$/, '')}` : ''}. Data lama tetap dipakai. ${caraTekan}`);
    return;
  }
  if (!s.terakhirSelesai) { aturStatusData('lama', 'Belum pernah diperbarui', 'Belum', `${otomatis} ${caraTekan}`); return; }
  const rel = waktuRelatif(s.terakhirSelesai);
  const lama = Date.now() - Date.parse(s.terakhirSelesai) > LAMA_DATA_MS;
  aturStatusData(lama ? 'lama' : 'segar', `Diperbarui ${rel}`, rel,
    `Terakhir diperbarui ${waktuWib(s.terakhirSelesai)} WIB. ${otomatis} ${caraTekan}`);
}
// "5 mnt lalu" ikut bertambah walau halaman dibiarkan terbuka.
setInterval(() => { if (statusSinkronTerakhir && !statusSinkronTerakhir.sedangBerjalan && !sinkronKlienAktif) renderStatusData(); }, 30 * 1000);

async function muatStatusSinkron() {
  try {
    renderStatusSinkron(await apiFetch('/api/sinkron/status'));
  } catch (err) {
    teksStatusSinkron.textContent = 'Gagal memeriksa koneksi ke Shopee.';
  }
}

function sinkronSekarang() {
  if (sinkronKlien) return sinkronKlien;
  sinkronKlienAktif = true;
  sedangMengikutiSinkron = true; // pemeriksa semenit tidak perlu ikut memantau
  renderStatusData();
  sinkronKlien = (async () => {
    // Akun baca-saja tidak memicu permintaan ke Shopee; cukup muat ulang data yang tersimpan.
    if (akunBacaSaja) {
      try { await muatDataPenjualan(); await muatDataPenjualanIklan(); } finally { sinkronKlienAktif = false; sinkronDilewati = true; await muatStatusSinkron(); }
      return;
    }
    tampilkanErrorSinkron('');
    // Pantau kemajuan selama permintaan sinkron berjalan (respons POST baru datang setelah selesai).
    let pantau = true;
    const penjadwal = setInterval(async () => {
      try {
        const s = await apiFetch('/api/sinkron/status');
        if (pantau && s.sedangBerjalan) renderStatusSinkron(s);
      } catch (_) { /* abaikan, coba lagi di putaran berikutnya */ }
    }, 1500);
    try {
      const hasil = await apiFetch('/api/sinkron', { method: 'POST', body: '{}' });
      pantau = false; clearInterval(penjadwal);
      sinkronKlienAktif = false;
      sinkronDilewati = !!hasil.dilewati;
      renderStatusSinkron(hasil);
      await muatDataPenjualan();
      await muatDataPenjualanIklan();
    } catch (err) {
      pantau = false; clearInterval(penjadwal);
      sinkronKlienAktif = false;
      await muatStatusSinkron(); // status "gagal" → tombol merah
      tampilkanErrorSinkron(err.message);
      await muatDataPenjualanDiam(); // tetap tampilkan data yang sudah tersimpan, pesan error dibiarkan
    } finally {
      pantau = false; clearInterval(penjadwal);
      if (document.getElementById('halamanPengaturan').classList.contains('aktif')) muatDiagnostik();
    }
  })().finally(() => { sinkronKlien = null; sinkronKlienAktif = false; sedangMengikutiSinkron = false; });
  return sinkronKlien;
}
tombolStatusData.addEventListener('click', () => sinkronSekarang());

async function muatDataPenjualanIklan() {
  const sampai = hariIniWib();
  const dari = geserHari(sampai, -89);
  try {
    const q = new URLSearchParams({ dari, sampai });
    dataPenjualanIklan = await apiFetch(`/api/pesanan?${q}`);
  } catch (_) { /* belum terhubung / belum ada data — Analisis Iklan memakai angka standar */ }
  if (!dataIklan || dataIklan.sumber === 'api') await muatIklanDariShopee();
  else hitungUlangIklan();
  if (!dataIklan) { renderMingguan(); renderTugas(); }
}

// Dipanggil sekali setelah login: cek koneksi, lalu langsung tampilkan 30 hari terakhir.
// Kalau belum pernah ada data sama sekali (baru terhubung), jalankan sinkron dulu.
async function mulaiDataOtomatis() {
  pilihPeriode('30');
  await muatStatusSinkron();
  const s = statusSinkronTerakhir;
  if (!s || !s.terhubung) return;
  if (s.sedangBerjalan) await ikutiSinkronBerjalan();
  else if (!s.jumlahPesanan) await sinkronSekarang();
  else await muatDataPenjualan();
  muatDataPenjualanIklan();
  // Sinkron terjadwal (tiap 30 menit di server) bisa mulai saat halaman sedang dibuka: cek
  // sekali semenit, kalau sedang jalan tampilkan progress bar dan muat ulang datanya setelahnya.
  if (!pemeriksaSinkron) {
    pemeriksaSinkron = setInterval(async () => {
      if (sedangMengikutiSinkron || !statusSinkronTerakhir || !statusSinkronTerakhir.terhubung) return;
      await muatStatusSinkron();
      if (statusSinkronTerakhir && statusSinkronTerakhir.sedangBerjalan) { await ikutiSinkronBerjalan(); muatDataPenjualanIklan(); }
    }, 60 * 1000);
  }
}
let pemeriksaSinkron = null;
let sedangMengikutiSinkron = false;

// Sinkron terjadwal sedang jalan di server (bisa belasan menit untuk yang pertama): tampilkan
// dulu data yang sudah tersimpan, perbarui status tiap 5 detik & data tiap 30 detik, lalu
// muat ulang sekali lagi setelah selesai. Pesanan terbaru diambil duluan (sinkronShopee.js).
async function ikutiSinkronBerjalan() {
  sedangMengikutiSinkron = true;
  try {
    if (statusSinkronTerakhir.jumlahPesanan) await muatDataPenjualanDiam();
    let putaran = 0;
    while (statusSinkronTerakhir && statusSinkronTerakhir.sedangBerjalan) {
      await new Promise((r) => setTimeout(r, 2000));
      await muatStatusSinkron();
      if (++putaran % 15 === 0) await muatDataPenjualanDiam(); // data tiap ±30 detik
    }
    await muatDataPenjualan();
  } finally {
    sedangMengikutiSinkron = false;
  }
}

// Muat data tanpa menampilkan pesan "belum ada pesanan" — dipakai selama sinkron masih jalan,
// saat periode yang dipilih mungkin memang belum terisi.
async function muatDataPenjualanDiam() {
  try {
    const q = new URLSearchParams({ dari: tanggalDari.value, sampai: tanggalSampai.value });
    terapkanDataPenjualan(await apiFetch(`/api/pesanan?${q}`));
  } catch (_) { /* belum ada data di periode ini — tunggu putaran berikutnya */ }
}

// "30 hari terakhir · 27 Agu – 25 Sep 2026" — nama pill yang aktif (kalau ada) + rentang tanggalnya.
const NAMA_PERIODE = { 'hari-ini': 'Hari ini', 7: '7 hari terakhir', 30: '30 hari terakhir', 'bulan-ini': 'Bulan ini', 'bulan-lalu': 'Bulan lalu' };
function teksPeriode({ dari, sampai }) {
  const aktif = document.querySelector('.pill-filter[data-periode].aktif');
  const nama = aktif ? NAMA_PERIODE[aktif.dataset.periode] : 'Periode pilihan';
  const tgl = (iso, tahun) => new Date(iso + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', ...(tahun ? { year: 'numeric' } : {}) });
  const rentang = dari === sampai ? tgl(dari, true) : `${tgl(dari, dari.slice(0, 4) !== sampai.slice(0, 4))} – ${tgl(sampai, true)}`;
  return `${nama} · ${rentang}`;
}

function renderRingkasan(r) {
  // "≈" kecil di depan angka yang sebagian masih perkiraan (dana belum cair).
  const approx = r.penghasilanPerkiraan ? '<span class="tanda-kira" title="Sebagian masih perkiraan karena dana belum cair">≈</span>' : '';
  document.getElementById('ringkasanOmzet').textContent = formatRupiah(r.totalOmzet || 0);
  document.getElementById('ketOmzet').textContent = `${(r.jumlahPesanan || 0).toLocaleString('id-ID')} pesanan · ${(r.totalPcs || 0).toLocaleString('id-ID')} pcs`;
  document.getElementById('ringkasanPendapatan').innerHTML = approx + escapeHtml(formatRupiah(r.totalPenghasilan));
  document.getElementById('ringkasanUntung').innerHTML = approx + escapeHtml(formatRupiah(r.totalUntung));
  const catatan = document.getElementById('catatanPerkiraan');
  catatan.classList.toggle('tersembunyi', !r.penghasilanPerkiraan);
  if (r.penghasilanPerkiraan) {
    catatan.textContent = `≈ Termasuk ${r.jumlahPesananPerkiraan} pesanan yang dananya belum cair (${formatRupiah(r.penghasilanPerkiraan)}): ` +
      `penghasilannya diperkirakan ${formatPersen((r.rasioPerkiraan || 0) * 100)} dari harga jual (rata-rata 60 hari terakhir). ` +
      'Angka pasti muncul setelah dana cair.';
  }
  document.getElementById('ringkasanMargin').textContent = formatPersen(r.marginRataRataPersen);
  document.getElementById('ringkasanBelumHpp').textContent = `${r.jumlahBelumAdaHpp} produk`;
  document.getElementById('kartuBelumHpp').classList.toggle('tersembunyi', r.jumlahBelumAdaHpp === 0);
  document.getElementById('ringkasanDikembalikan').textContent = `${r.jumlahDikembalikan || 0} pesanan`;
  document.getElementById('kartuDikembalikan').classList.toggle('tersembunyi', !r.jumlahDikembalikan);

  // Widget "Kalkulator Margin" di Dashboard ikut diperbarui dengan angka yang sama
  document.getElementById('widgetUntung').textContent = formatRupiah(r.totalUntung);
  document.getElementById('widgetMargin').textContent = formatPersen(r.marginRataRataPersen);
  document.getElementById('widgetKalkulatorKosong').classList.add('tersembunyi');
  // Periode angka di widget = periode yang sedang dipilih di Kalkulator.
  const elPeriode = document.getElementById('widgetPeriode');
  elPeriode.textContent = r.periode ? teksPeriode(r.periode) : '';
  elPeriode.classList.toggle('tersembunyi', !r.periode);
  document.getElementById('widgetKalkulatorIsi').classList.remove('tersembunyi');
}

// ====== Tren Penjualan Harian ======
// Satu kolom per hari untuk SATU ukuran (Omzet / Untung / Pesanan / Pcs, pilih lewat pill) +
// garis rata-rata 7 hari untuk meredam naik-turun harian (Sabtu/Minggu, tanggal kembar).
// Sengaja satu sumbu saja: Rp dan jumlah pesanan beda skala, jadi tidak digabung di satu
// grafik dua-sumbu (mudah salah baca). Arahkan/ketuk kolom untuk melihat semua angka hari itu.
let metrikTren = 'omzet';
const METRIK_TREN = {
  omzet: { label: 'Omzet', rupiah: true },
  untung: { label: 'Untung', rupiah: true },
  pesanan: { label: 'Pesanan', rupiah: false },
  pcs: { label: 'Pcs', rupiah: false },
};

function dataTrenHarian() {
  const { dari, sampai } = (dataHasilUpload.ringkasan && dataHasilUpload.ringkasan.periode) || {};
  if (!dari || !sampai) return [];
  const hari = new Map();
  for (let d = dari; d <= sampai; d = geserHari(d, 1)) {
    hari.set(d, { tanggal: d, omzet: 0, untung: 0, pesananSet: new Set(), pcs: 0, perkiraan: false, belumHpp: 0 });
  }
  for (const it of dataHasilUpload.items) {
    const h = hari.get(it.waktuPesanan);
    if (!h) continue;
    if (!it.dikembalikan) {
      h.omzet += it.hargaProduk || 0;
      h.pcs += it.jumlah || 0;
      h.pesananSet.add(it.noPesanan);
    }
    if (it.untung !== null && it.untung !== undefined) h.untung += it.untung; else h.belumHpp += 1;
    if (it.perkiraan) h.perkiraan = true;
  }
  const daftar = [...hari.values()].map((h) => ({ ...h, pesanan: h.pesananSet.size }));
  // Rata-rata 7 hari ke belakang (termasuk hari itu); kosong untuk 6 hari pertama.
  daftar.forEach((h, i) => {
    h.rata = {};
    for (const m of Object.keys(METRIK_TREN)) {
      h.rata[m] = i >= 6 ? daftar.slice(i - 6, i + 1).reduce((t, x) => t + x[m], 0) / 7 : null;
    }
  });
  return daftar;
}

// Skala sumbu Y yang "bulat" (0, 500 rb, 1 jt, ...) mencakup min..maks.
function skalaBulat(min, maks, jumlahTik = 4) {
  const rentang = maks - min || 1;
  const kasar = rentang / jumlahTik;
  const pangkat = 10 ** Math.floor(Math.log10(kasar));
  const langkah = [1, 2, 2.5, 5, 10].map((k) => k * pangkat).find((k) => k >= kasar);
  const bawah = Math.floor(min / langkah) * langkah;
  const atas = Math.ceil(maks / langkah) * langkah || langkah;
  const tik = [];
  for (let v = bawah; v <= atas + langkah / 2; v += langkah) tik.push(Math.round(v * 1e6) / 1e6);
  return { bawah, atas, tik };
}

const namaHari = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });

function renderTren() {
  const kartu = document.getElementById('kartuTren');
  const area = document.getElementById('areaGrafikTren');
  const daftar = dataHasilUpload ? dataTrenHarian() : [];
  document.getElementById('tooltipTren').classList.add('tersembunyi');
  // Satu hari (mis. "Hari ini") tidak butuh grafik — angka ringkasan di atas sudah menjawabnya.
  kartu.classList.toggle('tersembunyi', daftar.length < 2);
  if (daftar.length < 2) return;

  const m = metrikTren;
  const info = METRIK_TREN[m];
  const fmt = (v) => (info.rupiah ? formatRupiahRingkas(v) : Math.round(v).toLocaleString('id-ID'));
  const adaRata = daftar.length >= 10;
  const adaPerkiraan = m === 'untung' && daftar.some((h) => h.perkiraan);

  const lebar = Math.max(300, area.clientWidth || 600);
  const tinggi = 240;
  const kiri = info.rupiah ? 62 : 40, kanan = 8, atas = 10, bawah = 26;
  const nilai = daftar.map((h) => h[m]);
  const { bawah: yMin, atas: yMaks, tik } = skalaBulat(Math.min(0, ...nilai), Math.max(0, ...nilai));
  const y = (v) => atas + (tinggi - atas - bawah) * (1 - (v - yMin) / (yMaks - yMin));
  const langkahX = (lebar - kiri - kanan) / daftar.length;
  const lebarBatang = Math.max(2, Math.min(28, langkahX - 2)); // selalu ada celah ≥ 2px antar kolom
  const x = (i) => kiri + langkahX * i + langkahX / 2;
  const radius = Math.min(4, lebarBatang / 2);

  // Kolom dengan ujung membulat 4px di sisi data (atas untuk positif, bawah untuk negatif).
  const batang = (i, v) => {
    const x0 = x(i) - lebarBatang / 2, x1 = x0 + lebarBatang, y0 = y(0), y1 = y(v);
    if (Math.abs(y1 - y0) < 0.5) return '';
    const r = Math.min(radius, Math.abs(y1 - y0));
    const arah = y1 < y0 ? 1 : -1; // 1 = ke atas
    return `M${x0},${y0} V${y1 + arah * r} Q${x0},${y1} ${x0 + r},${y1} H${x1 - r} Q${x1},${y1} ${x1},${y1 + arah * r} V${y0} Z`;
  };

  const garisGrid = tik.map((v) => `
    <line x1="${kiri}" x2="${lebar - kanan}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? 'grafik-nol' : 'grafik-grid'}"/>
    <text x="${kiri - 6}" y="${y(v) + 4}" class="grafik-label" text-anchor="end">${escapeHtml(fmt(v))}</text>`).join('');

  const setiap = Math.ceil(daftar.length / Math.max(2, Math.floor((lebar - kiri) / 44)));
  // Label dihitung mundur dari hari terakhir supaya hari terbaru selalu berlabel.
  const labelX = daftar.map((h, i) => {
    if ((daftar.length - 1 - i) % setiap !== 0) return '';
    const [, bl, tg] = h.tanggal.split('-');
    return `<text x="${x(i)}" y="${tinggi - 8}" class="grafik-label" text-anchor="middle">${Number(tg)}/${Number(bl)}</text>`;
  }).join('');

  const kolom = daftar.map((h, i) => {
    const kelas = h[m] < 0 ? 'grafik-batang negatif' : m === 'untung' && h.perkiraan ? 'grafik-batang perkiraan' : 'grafik-batang';
    return `<path d="${batang(i, h[m])}" class="${kelas}" data-i="${i}"/>`;
  }).join('');

  let garisRata = '';
  if (adaRata) {
    const titik = daftar.map((h, i) => (h.rata[m] === null ? null : `${x(i)},${y(h.rata[m])}`)).filter(Boolean);
    garisRata = `<polyline points="${titik.join(' ')}" class="grafik-rata"/>`;
  }

  // Area sentuh selebar satu hari penuh (lebih besar dari kolomnya) untuk hover/ketuk.
  const sentuh = daftar.map((h, i) =>
    `<rect x="${kiri + langkahX * i}" y="${atas}" width="${langkahX}" height="${tinggi - atas - bawah}" class="grafik-sentuh" data-i="${i}"/>`).join('');

  area.innerHTML = `<svg viewBox="0 0 ${lebar} ${tinggi}" width="${lebar}" height="${tinggi}" role="img"
      aria-label="${escapeHtml(info.label)} per hari, ${escapeHtml(daftar[0].tanggal)} sampai ${escapeHtml(daftar[daftar.length - 1].tanggal)}">
      ${garisGrid}${kolom}${garisRata}${labelX}${sentuh}</svg>`;

  document.getElementById('legendaTren').innerHTML =
    `<span><span class="swatch-batang"></span>${escapeHtml(info.label)} per hari</span>` +
    (adaRata ? '<span><span class="swatch-garis"></span>Rata-rata 7 hari</span>' : '') +
    (adaPerkiraan ? '<span><span class="swatch-batang perkiraan"></span>Ada perkiraan (dana belum cair)</span>' : '') +
    (m === 'untung' && daftar.some((h) => h.belumHpp) ? '<span class="teks-redup">Produk tanpa HPP tidak dihitung</span>' : '');

  const tooltip = document.getElementById('tooltipTren');
  const svg = area.querySelector('svg');
  const tampilkan = (i) => {
    const h = daftar[i];
    svg.querySelectorAll('.grafik-batang').forEach((b) => b.classList.toggle('redup', b.dataset.i !== String(i)));
    const approx = h.perkiraan ? '≈ ' : '';
    tooltip.innerHTML = `<strong>${escapeHtml(namaHari(h.tanggal))}</strong>
      <div><span>Omzet</span><span>${formatRupiah(h.omzet)}</span></div>
      <div><span>Untung</span><span>${approx}${formatRupiah(h.untung)}</span></div>
      <div><span>Pesanan</span><span>${h.pesanan}</span></div>
      <div><span>Pcs</span><span>${h.pcs}</span></div>
      ${h.rata[m] !== null && adaRata ? `<div class="teks-redup"><span>Rata-rata 7 hari</span><span>${escapeHtml(fmt(h.rata[m]))}</span></div>` : ''}
      ${h.belumHpp ? `<div class="teks-redup">${h.belumHpp} baris belum ada HPP</div>` : ''}`;
    tooltip.classList.remove('tersembunyi');
    const kotak = area.getBoundingClientRect();
    const skala = kotak.width / lebar;
    const px = x(i) * skala;
    const lebarTip = tooltip.offsetWidth;
    // Di samping kolom yang ditunjuk (kanan, atau kiri kalau mepet), di bagian atas plot.
    const kananKolom = px + (lebarBatang * skala) / 2 + 10;
    const kiriTip = kananKolom + lebarTip <= kotak.width ? kananKolom : Math.max(0, px - (lebarBatang * skala) / 2 - 10 - lebarTip);
    tooltip.style.left = `${area.offsetLeft + kiriTip}px`;
    tooltip.style.top = `${area.offsetTop + 4}px`;
  };
  const sembunyikan = () => {
    tooltip.classList.add('tersembunyi');
    svg.querySelectorAll('.grafik-batang').forEach((b) => b.classList.remove('redup'));
  };
  svg.querySelectorAll('.grafik-sentuh').forEach((r) => {
    r.addEventListener('pointerenter', () => tampilkan(Number(r.dataset.i)));
    r.addEventListener('click', () => tampilkan(Number(r.dataset.i)));
  });
  svg.addEventListener('pointerleave', sembunyikan);
}

document.querySelectorAll('.pill-filter[data-metrik]').forEach((btn) => {
  btn.addEventListener('click', () => {
    metrikTren = btn.dataset.metrik;
    document.querySelectorAll('.pill-filter[data-metrik]').forEach((b) => b.classList.toggle('aktif', b === btn));
    renderTren();
  });
});
let jedaResizeTren = null;
window.addEventListener('resize', () => {
  clearTimeout(jedaResizeTren);
  jedaResizeTren = setTimeout(() => { if (dataHasilUpload) renderTren(); }, 150);
});

// Nilai satu baris untuk kolom tertentu, dipakai buat urutkan tabel Data.
// Saldo retur tetap ikut untung/rugi,
// dan HPP yang belum diisi (null) selalu ditaruh paling akhir apa pun arah urutannya
// — supaya "belum diisi" tidak nyampur di tengah angka yang sudah lengkap.
function nilaiUntukUrut(it, kolom) {
  switch (kolom) {
    case 'jumlah': return it.jumlah;
    case 'totalPenghasilan': return it.totalPenghasilan;
    case 'hpp': return it.hpp === null ? null : (it.hppTotal ?? it.hpp);
    case 'untung': return it.untung;
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
        ? '<span class="teks-redup" title="Pesanan ini dikembalikan.">-</span>'
        : punyaHpp
        ? it.jumlah > 1
          ? `${formatRupiah(it.hppTotal)}<br><span class="pill pill-abu" title="HPP per 1 pcs: ${formatRupiah(it.hpp)}, dikali jumlah pcs di kolom &quot;Jumlah&quot; sebelah kiri.">${formatRupiah(it.hpp)}/pcs</span>`
          : formatRupiah(it.hpp)
        : `<div class="sel-hpp-cepat">
             <input type="number" class="input-hpp-cepat" placeholder="Isi HPP" min="0"
                    data-hpp-id="${escapeHtml(it.idProduk)}" data-hpp-nama="${escapeHtml(it.namaProduk)}">
             <button type="button" class="tombol tombol-mini simpan-hpp-cepat" data-simpan-hpp>Simpan</button>
           </div>`;

      // Jumlah pcs langsung dari Shopee (model_quantity_purchased / quantity_purchased).
      const selJumlah = it.dikembalikan
        ? '<span class="teks-redup" title="Pesanan ini dikembalikan.">-</span>'
        : String(it.jumlah);

      // Pesanan yang dananya belum cair: penghasilan = harga jual × rasio pencairan toko
      // (perkiraan), ditandai "≈" dan pill "Belum cair" supaya jelas bukan angka final.
      const approx = it.perkiraan ? '≈ ' : '';
      const selDanaCair = it.perkiraan
        ? `<span class="pill pill-abu" title="Dana pesanan ini belum cair. Penghasilan dan untungnya masih perkiraan.">Belum cair</span>`
        : escapeHtml(it.tanggalDilepaskan);

      const totalPenghasilanTampil = it.dikembalikan
        ? `${formatRupiah(it.totalPenghasilan)}<br><span class="pill pill-kuning" title="Pesanan ini dikembalikan / di-refund ke pembeli sebesar ${formatRupiah(it.jumlahPengembalian)}.">Dikembalikan</span>`
        : approx + formatRupiah(it.totalPenghasilan);

      const untungTampil = it.dikembalikan
        ? `<span title="HPP dianggap kembali menjadi stok. Potongan atau saldo retur tetap dihitung.">${formatRupiah(it.untung)}</span>`
        : punyaHpp ? approx + formatRupiah(it.untung) : 'Belum diisi';
      const marginTampil = it.dikembalikan ? '-' : punyaHpp ? pillMargin(it.marginPersen) : '-';

      return `
        <tr class="${kelasBaris}">
          <td data-label="No. Pesanan">${escapeHtml(it.noPesanan)}</td>
          <td data-label="Tanggal Pesanan">${escapeHtml(it.waktuPesanan)}</td>
          <td data-label="Tanggal Dana Cair">${selDanaCair}</td>
          <td class="kolom-nama" data-label="Nama Produk" title="${escapeHtml(it.namaProduk)}">${escapeHtml(potongNama(it.namaProduk))}${it.namaModel ? `<br><span class="teks-redup teks-varian">${escapeHtml(it.namaModel)}</span>` : ''}</td>
          <td class="kolom-id" data-label="ID Produk">${escapeHtml(it.idProduk)}</td>
          <td class="kolom-jumlah kolom-tengah" data-label="Jumlah">${selJumlah}</td>
          <td class="kolom-total kolom-angka" data-label="Total Penghasilan">${totalPenghasilanTampil}</td>
          <td class="kolom-hpp kolom-angka" data-label="Harga Modal (HPP)">${selHpp}</td>
          <td class="${kelasUntung} kolom-angka" data-label="Untung">${untungTampil}</td>
          <td class="${kelasUntung} kolom-angka" data-label="Margin %">${marginTampil}</td>
        </tr>`;
    })
    .join('');
  // Isi cepat HPP (baris kuning): tombol Simpan atau Enter, lewat simpanHppLangkah() di bawah.
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
    muatDataPenjualanIklan(); // untung per minggu di Analisis Iklan ikut HPP baru
  } catch (err) {
    alert(err.message);
  }
}

// Setelah HPP baru disimpan, hitung ulang untung/margin di data yang sedang tampil (tanpa upload ulang)
function hitungUlangDanTampilkanUlang() {
  if (!dataHasilUpload) return;
  const hppMap = new Map(daftarHpp.map((r) => [r.id_produk, r.hpp]));

  let totalPenghasilan = 0, totalHpp = 0, totalUntung = 0, penghasilanDenganHpp = 0;
  const produkBelumAdaHpp = new Set(), pesananDikembalikan = new Set(); // jumlah berbeda, sama seperti server

  dataHasilUpload.items = dataHasilUpload.items.map((it) => {
    const punyaHpp = hppMap.has(it.idProduk);
    const hpp = punyaHpp ? hppMap.get(it.idProduk) : null;

    totalPenghasilan += it.totalPenghasilan;

    // Sama seperti server: HPP kembali ke stok, saldo pencairan retur tetap dihitung.
    if (it.dikembalikan) {
      pesananDikembalikan.add(it.noPesanan);
      totalUntung += it.totalPenghasilan;
      penghasilanDenganHpp += it.totalPenghasilan;
      return { ...it, hpp, hppTotal: 0, untung: it.totalPenghasilan, marginPersen: null };
    }

    // HPP dikali jumlah pcs (auto-terdeteksi atau hasil koreksi manual — lihat kolom
    // "Jumlah") sebelum dikurangkan, sama seperti logika di server.js.
    const hppTotal = punyaHpp ? hpp * it.jumlah : null;
    const untung = punyaHpp ? it.totalPenghasilan - hppTotal : null;
    const marginPersen = punyaHpp && it.totalPenghasilan !== 0 ? (untung / it.totalPenghasilan) * 100 : null;

    if (punyaHpp) { totalHpp += hppTotal; totalUntung += untung; penghasilanDenganHpp += it.totalPenghasilan; } else { produkBelumAdaHpp.add(it.idProduk); }

    return { ...it, hpp, hppTotal, untung, marginPersen };
  });

  // Field lain dari server (rasioPencairan, periode, ...) tidak berubah karena HPP — dipertahankan lewat spread.
  dataHasilUpload.ringkasan = {
    ...dataHasilUpload.ringkasan,
    jumlahBaris: dataHasilUpload.items.length,
    totalPenghasilan, totalHpp, totalUntung,
    // Sama seperti server: margin hanya dari produk yang punya HPP.
    marginRataRataPersen: penghasilanDenganHpp !== 0 ? (totalUntung / penghasilanDenganHpp) * 100 : null,
    penghasilanDenganHpp,
    jumlahBelumAdaHpp: produkBelumAdaHpp.size,
    jumlahDikembalikan: pesananDikembalikan.size,
  };

  renderRingkasan(dataHasilUpload.ringkasan);
  renderTabelData(dataHasilUpload.items);
  renderTren();
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

// Total penjualan per produk dari data penjualan yang sedang dimuat (pcs & penghasilan, tanpa
// baris yang dikembalikan). Dipakai untuk mengurutkan daftar "Belum Diisi" supaya produk yang
// paling banyak menghasilkan uang ada di atas. Dihitung sekali per data.
let penjualanPerProdukCache = { sumber: null, peta: new Map() };
function penjualanPerProduk(sumber = dataHasilUpload) {
  if (!sumber) return new Map();
  if (penjualanPerProdukCache.sumber === sumber) return penjualanPerProdukCache.peta;
  const peta = new Map();
  for (const it of sumber.items) {
    if (it.dikembalikan) continue;
    const t = peta.get(it.idProduk) || { pcs: 0, penghasilan: 0, hargaProduk: 0, pcsCair: 0, penghasilanCair: 0, hargaCair: 0 };
    t.pcs += it.jumlah || 1;
    t.penghasilan += it.totalPenghasilan || 0;
    t.hargaProduk += it.hargaProduk || 0; // harga jual total baris (sudah dikali pcs untuk baris multi-pcs)
    // Angka pasti (dana sudah cair) — dipakai Analisis Iklan; baris perkiraan dihitung dari
    // rasio toko, jadi tidak boleh ikut menentukan rasio per produk.
    if (!it.perkiraan) { t.pcsCair += it.jumlah || 1; t.penghasilanCair += it.totalPenghasilan || 0; t.hargaCair += it.hargaProduk || 0; }
    peta.set(it.idProduk, t);
  }
  penjualanPerProdukCache = { sumber, peta };
  return peta;
}

// Daftar HPP tersimpan + produk yang terjual (atau sedang beriklan) tapi belum punya HPP, supaya
// semuanya bisa diisi di sini tanpa mengetik ID Produk.
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

  // Produk yang sedang diiklankan tapi belum laku di periode ini tetap perlu HPP: tanpa itu iklannya
  // tidak bisa dinilai (langkah "Isi HPP" di Dashboard menampilkannya).
  for (const p of (dataIklan && dataIklan.produk) || []) {
    if (!(p.sedangBerjalan > 0) || p.aksi === 'toko' || sudahAda.has(p.idProduk) || belumPunyaHpp.some((r) => r.id_produk === p.idProduk)) continue;
    belumPunyaHpp.push({ id_produk: p.idProduk, nama_produk: p.namaProduk, hpp: null, updated_at: null, updated_by: null });
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
    `<strong>${belum.length} produk</strong> yang terjual di periode ini belum ada HPP. Nilai penjualannya ` +
    `<strong title="${escapeHtml(formatRupiah(totalRp))}">${formatRupiahRingkas(totalRp)}</strong>. ` +
    `Isi dari atas dulu: yang paling laku ada di atas.`;
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
             <input type="number" class="input-hpp-tabel-baru" placeholder="Isi HPP" min="0" data-hpp-id="${escapeHtml(r.id_produk)}" data-hpp-nama="${escapeHtml(r.nama_produk || '')}">
             <button type="button" class="tombol tombol-mini simpan-hpp-tabel-baru" data-simpan-hpp>Simpan</button>
           </div>`;

      return `
        <tr class="${punyaHpp ? '' : 'baris-peringatan'}">
          <td class="kolom-id" data-label="ID Produk">${escapeHtml(r.id_produk)}</td>
          <td class="kolom-nama" data-label="Nama Produk" title="${escapeHtml(r.nama_produk || '')}">${r.nama_produk ? escapeHtml(potongNama(r.nama_produk)) : '-'}</td>
          <td class="kolom-angka kolom-terjual" data-label="Terjual (periode ini)">${
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

  // Baris yang belum punya HPP: Simpan atau Enter, lewat simpanHppLangkah() di bawah.

  isiTabelHpp.querySelectorAll('[data-hapus]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Hapus harga modal produk ini?')) return;
      try {
        await apiFetch(`/api/hpp/${encodeURIComponent(btn.dataset.hapus)}`, { method: 'DELETE' });
        await muatDaftarHpp();
        hitungUlangDanTampilkanUlang();
      } catch (err) {
        alert(err.message);
      }
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
// Data iklan otomatis dari Shopee (muatIklanDariShopee); file CSV "Data Keseluruhan Iklan" hanya
// cadangan tersembunyi. Server menggabungkan dengan HPP dan rasio pencairan → vonis per produk.
let dataIklan = null;       // { produk, kampanye, ringkasan, sumberRasio, periode, namaToko }
let sortKolomIklan = 'biaya';
let sortArahIklan = -1;     // biaya terbesar di atas: di situ uang paling banyak dipertaruhkan
const produkTerbuka = new Set(); // idProduk yang rincian kampanyenya sedang dibuka
const keputusanTerbuka = new Set(); // baris tabel keputusan yang rinciannya sedang dibuka
const iklanTerbuka = new Set();     // iklan berjalan yang "Rincian"-nya sedang dibuka
let kepGrupTerakhir = null;         // keputusan terakhir yang ditampilkan di daftar iklan berjalan
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
  const r = sumberIklan() && sumberIklan().ringkasan;
  return r && r.rasioPencairan ? r.rasioPencairan : null;
}

// Harga jual per pcs & rasio pencairan tiap produk dari file Income yang diunggah —
// dikirim ke server supaya analisis iklan memakai harga produk yang sebenarnya, bukan
// tebakan dari omzet iklan (yang tercampur produk lain). Kosong kalau belum ada unggahan.
function produkIncomeSaatIni() {
  const hasil = {};
  for (const [id, t] of penjualanPerProduk(sumberIklan())) {
    if (!t.pcsCair || !t.hargaCair) continue;
    // Server hanya memakai harga/rasio kalau pcs ≥ 3; perHari dipakai untuk batas pesanan
    // iklan yang dibayar (analisisIklan.js: batasDibayarKampanye).
    hasil[id] = { harga: t.hargaCair / t.pcsCair, rasio: t.penghasilanCair / t.hargaCair, pcs: t.pcsCair, perHari: {} };
  }
  for (const it of sumberIklan().items) {
    if (it.dikembalikan || it.perkiraan || !hasil[it.idProduk]) continue;
    const iso = String(it.waktuPesanan || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
    const h = hasil[it.idProduk].perHari;
    const t = h[iso] || (h[iso] = { pcs: 0, harga: 0 });
    t.pcs += it.jumlah || 1;
    t.harga += it.hargaProduk || 0;
  }
  return hasil;
}

// Tanggal pertama periode data penjualan yang dipakai Analisis Iklan — kampanye yang mulai
// sebelum ini tidak bisa diukur batas pesanan dibayarnya (analisisIklan.js).
function tanggalDataMulaiSaatIni() {
  const s = sumberIklan();
  return (s && s.ringkasan && s.ringkasan.periode && s.ringkasan.periode.dari) || '';
}

// Tanggal dana cair paling akhir di data penjualan — sampai tanggal itu pesanan sudah pasti cair;
// dipakai server untuk tahu periode kampanye mana yang sudah bisa diukur.
function tanggalRilisTerakhirSaatIni() {
  if (!sumberIklan()) return '';
  let maks = '';
  for (const it of sumberIklan().items) { const r = String(it.tanggalDilepaskan || '').slice(0, 10); if (r > maks) maks = r; }
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
    formData.append('tanggalDataMulai', tanggalDataMulaiSaatIni());
  }

  try {
    const res = await fetch('/api/iklan/upload', { method: 'POST', body: formData });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Gagal memproses file.');
    dataIklan = body;
    statusIklanShopee.innerHTML = `Memakai file yang diunggah (<strong>${escapeHtml(body.periode || '')}</strong>). Muat ulang halaman untuk kembali ke data otomatis dari Shopee.`;
    produkTerbuka.clear();
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

// Data iklan otomatis: server menyusun kampanye dari hasil sinkron Shopee Ads API (90 hari
// terakhir, sama dengan data penjualan halaman ini) lalu menghitung dengan rumus yang sama
// seperti file CSV. File unggahan (cadangan) menggantikannya sampai halaman dimuat ulang.
const statusIklanShopee = document.getElementById('statusIklanShopee');
function teksStatusIklan(body) {
  const st = body.statusIklan || {};
  const gagal = st.status === 'gagal' ? ` <span class="teks-merah">Sinkron iklan terakhir gagal: ${escapeHtml(st.pesan || '')}</span>` : '';
  if (body.kosong) {
    return (st.status === 'gagal' ? 'Data iklan belum bisa diambil dari Shopee.' : 'Data iklan belum ada. Diambil otomatis tiap 30 menit, atau tekan tombol status data di atas.') + gagal;
  }
  const waktu = st.terakhirSelesai ? ` · diperbarui ${waktuSingkat(st.terakhirSelesai)}` : '';
  return `Otomatis dari Shopee · <strong>${escapeHtml(body.periode)}</strong>${waktu}.` + gagal;
}
let muatIklanBerjalan = null;
async function muatIklanDariShopee() {
  if (muatIklanBerjalan) return muatIklanBerjalan; // beberapa pemicu sekaligus → satu permintaan
  muatIklanBerjalan = (async () => {
    const sampai = hariIniWib();
    const dari = geserHari(sampai, -89);
    const adaPenjualan = !!sumberIklan();
    try {
      const body = await apiFetch('/api/iklan/dari-shopee', {
        method: 'POST',
        body: JSON.stringify({
          dari, sampai,
          rasioPencairan: rasioPencairanSaatIni(),
          produkIncome: adaPenjualan ? produkIncomeSaatIni() : {},
          tanggalRilisTerakhir: tanggalRilisTerakhirSaatIni(),
          tanggalDataMulai: tanggalDataMulaiSaatIni(),
        }),
      });
      if (dataIklan && dataIklan.sumber !== 'api') return; // file unggahan dipakai sementara itu
      statusIklanShopee.innerHTML = teksStatusIklan(body);
      if (body.kosong) return;
      dataIklan = body;
      renderIklan();
      renderTabelHpp(); // produk iklan tanpa HPP ikut muncul di tab HPP
      areaIklan.classList.remove('tersembunyi');
    } catch (err) {
      if (!dataIklan || dataIklan.sumber === 'api') statusIklanShopee.textContent = `Gagal memuat data iklan: ${err.message}`;
    }
  })().finally(() => { muatIklanBerjalan = null; });
  return muatIklanBerjalan;
}

// Hitung ulang vonis dengan HPP terbaru / rasio pencairan terbaru tanpa unggah ulang file —
// server hanya perlu baris kampanye yang sudah dibaca tadi.
async function hitungUlangIklan() {
  if (!dataIklan) return;
  if (dataIklan.sumber === 'api') return muatIklanDariShopee();
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
        tanggalDataMulai: tanggalDataMulaiSaatIni(),
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
  renderTugas();
  renderRingkasanIklan(dataIklan.ringkasan);
  renderTabelIklan();
}

// Nama produk Shopee dimulai "HAPPY SHOP - " lalu 100+ karakter; untuk daftar ringkas
// cukup awalannya saja.
const namaSingkat = (nama, maks = 46) => potongNama(String(nama || '').replace(/^HAPPY SHOP\s*-\s*/i, ''), maks);

// ====== Untung toko per minggu (penentu apakah iklan secara keseluruhan menguntungkan) ======
// Dari data penjualan (per tanggal pesanan) + biaya iklan per hari. Minggu = Senin–Minggu.
// Pesanan yang belum cair IKUT dihitung (penghasilannya perkiraan, ≈ 78% harga): kalau dibuang,
// minggu-minggu terakhir selalu kelihatan lebih rendah (±10% pesanan belum cair setelah 11 hari)
// dan aturan jadi condong ke "kurangi". Minggu dianggap lengkap kalau sudah lewat
// JEDA_LENGKAP_HARI (pembatalan & atribusi iklan 7 hari sudah selesai) dan tidak terpotong
// awal data; minggu yang belum lengkap ditandai dan tidak dipakai untuk aturan.
const JEDA_LENGKAP_HARI = 7;
const seninIso = (iso) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return null; const d = new Date(iso + 'T00:00:00Z'); const geser = (d.getUTCDay() + 6) % 7; return geserHari(iso, -geser); };
const labelMinggu = (iso) => { const [, m, d] = iso.split('-'); return `${Number(d)}/${Number(m)}`; };

function untungTokoPerMinggu() {
  if (!sumberIklan()) return null;
  const minggu = new Map();
  const ambil = (k) => { let t = minggu.get(k); if (!t) { t = { mulai: k, pcs: 0, penghasilan: 0, penghasilanDiketahui: 0, untungDiketahui: 0, biayaIklan: 0, pcsIklan: 0, adaIklan: false }; minggu.set(k, t); } return t; };
  let minRilis = '', maxRilis = '', minPesanan = '';
  for (const it of sumberIklan().items) {
    const k = seninIso(it.waktuPesanan);
    if (!k) continue;
    const t = ambil(k);
    t.adaIncome = true;
    if (!minPesanan || it.waktuPesanan < minPesanan) minPesanan = String(it.waktuPesanan).slice(0, 10);
    if (!it.dikembalikan) t.pcs += it.jumlah || 1;
    if (it.dikembalikan) {
      t.saldoRetur = (t.saldoRetur || 0) + (it.totalPenghasilan || 0);
    } else {
      t.penghasilan += it.totalPenghasilan || 0;
      if (it.hpp !== null && it.untung !== null && it.untung !== undefined) { t.penghasilanDiketahui += it.totalPenghasilan || 0; t.untungDiketahui += it.untung; }
    }
    const r = it.tanggalDilepaskan || '';
    if (r && (!minRilis || r < minRilis)) minRilis = r;
    if (r > maxRilis) maxRilis = r;
  }
  // Biaya iklan dibagi rata per hari kampanye, sampai tanggal laporan file iklan.
  let iklanMulai = '', iklanSelesai = '';
  if (dataIklan) {
    const batas = dataIklan.tanggalLaporanIso || '';
    for (const k of dataIklan.kampanye) {
      if (k.perHari) {
        for (const [h, v] of Object.entries(k.perHari)) {
          const t = ambil(seninIso(h));
          t.biayaIklan += v.biaya; t.pcsIklan += v.terjual; t.adaIklan = true;
        }
        continue;
      }
      if (!k.tanggalMulaiIso) continue;
      let akhir = k.tanggalSelesaiIso || k.tanggalMulaiIso;
      if (batas && akhir > batas) akhir = batas;
      if (akhir < k.tanggalMulaiIso) akhir = k.tanggalMulaiIso;
      const hari = Math.round((Date.parse(akhir) - Date.parse(k.tanggalMulaiIso)) / 86400000) + 1;
      const perHari = k.biaya / hari;
      const pcsPerHari = k.terjual / hari; // pcs yang DIKLAIM iklan (atribusi luas, termasuk produk lain & pesanan batal)
      for (let i = 0; i < hari; i++) {
        const h = geserHari(k.tanggalMulaiIso, i);
        const t = ambil(seninIso(h));
        t.biayaIklan += perHari; t.pcsIklan += pcsPerHari; t.adaIklan = true;
      }
      if (!iklanMulai || k.tanggalMulaiIso < iklanMulai) iklanMulai = k.tanggalMulaiIso;
      if (akhir > iklanSelesai) iklanSelesai = akhir;
    }
  }
  if (dataIklan && dataIklan.rentangData) { iklanMulai = dataIklan.rentangData.dari; iklanSelesai = dataIklan.rentangData.sampai; }
  const batasLengkap = geserHari(hariIniWib(), -JEDA_LENGKAP_HARI);
  // Minggu yang terpotong awal data (periode halaman, atau pesanan tersimpan paling awal) tidak lengkap.
  const awalData = [tanggalDataMulaiSaatIni(), minPesanan].filter(Boolean).sort().pop() || minRilis;
  const daftar = [...minggu.values()].sort((a, b) => a.mulai.localeCompare(b.mulai)).map((t) => {
    const selesai = geserHari(t.mulai, 6);
    // Untung kotor: baris tanpa HPP diperkirakan pakai margin baris yang ada HPP-nya minggu itu.
    const marginDiketahui = t.penghasilanDiketahui ? t.untungDiketahui / t.penghasilanDiketahui : 0;
    // No order rows is not proof of zero sales: coverage has not been established.
    const untungKotor = t.adaIncome ? t.untungDiketahui + (t.penghasilan - t.penghasilanDiketahui) * marginDiketahui + (t.saldoRetur || 0) : null;
    const lengkap = !!t.adaIncome && t.mulai >= awalData && selesai <= batasLengkap;
    const iklanLengkap = !!dataIklan && t.mulai >= (iklanMulai || '9999') && selesai <= (iklanSelesai || '');
    // Rasio atribusi, bukan bukti tambahan penjualan. Penyebut & pembilang berbeda
    // (pesanan batal, waktu atribusi, produk lain), sehingga bisa melebihi 100%.
    const klaimIklan = t.pcs > 0 && dataIklan ? t.pcsIklan / t.pcs : null;
    return { ...t, selesai, untungKotor, untungSetelahIklan: untungKotor === null ? null : untungKotor - t.biayaIklan, klaimIklan, lengkap, iklanLengkap };
  });
  return { minggu: daftar, minRilis, maxRilis, iklanMulai, iklanSelesai };
}

// Aturan satu kalimat: bandingkan N minggu lengkap terakhir dengan N minggu sebelumnya
// (N = 4 kalau datanya ≥ 8 minggu, supaya naik-turun mingguan tidak mengecoh; minimal 2).
// banding(mulaiA, mulaiB, n) = bandingMingguBiasa untuk n minggu (user, 30/09: hari ramai tidak dihitung);
// tanpa banding atau tanpa biaya iklan harian → jumlah minggu apa adanya.
function aturanMingguan(data, banding) {
  const lengkap = data.minggu.filter((t) => t.lengkap && t.iklanLengkap);
  if (lengkap.length < 4) return { kelas: '', teks: 'Perlu data lengkap 4 minggu dulu.', detail: '' };
  const n = Math.min(4, Math.floor(lengkap.length / 2));
  const akhir = lengkap.slice(-n), awal = lengkap.slice(-2 * n, -n);
  const dibandingkan = [...awal, ...akhir];
  if (dibandingkan.some((t, i) => i > 0 && t.mulai !== geserHari(dibandingkan[i - 1].mulai, 7))) {
    return { kelas: '', teks: 'Ada minggu yang datanya belum lengkap. Jangan ubah modal dulu.', detail: '' };
  }
  const jml = (arr, f) => arr.reduce((a, t) => a + t[f], 0);
  const biasa = banding ? banding(awal[0].mulai, akhir[0].mulai, n) : null;
  const iklanA = biasa ? biasa.iklanA : jml(awal, 'biayaIklan'), iklanB = biasa ? biasa.iklanB : jml(akhir, 'biayaIklan');
  const untungA = biasa ? biasa.a : jml(awal, 'untungSetelahIklan'), untungB = biasa ? biasa.b : jml(akhir, 'untungSetelahIklan');
  const pctIklan = iklanA ? (iklanB - iklanA) / iklanA : 0;
  const pctUntung = untungA ? (untungB - untungA) / Math.abs(untungA) : 0;
  const persen = (x) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`;
  const detail = `${n} minggu terakhir dibanding ${n} minggu sebelumnya${biasa ? ', per hari biasa' : ''}: biaya iklan ${persen(pctIklan)}, untung ${persen(pctUntung)}.` +
    (biasa && biasa.ramai.length ? ` ${biasa.ramai.length} hari ramai tidak dihitung.` : '');
  if (pctIklan >= 0.1 && untungB <= untungA) return { kelas: 'aturan-kurangi', teks: 'Biaya iklan naik, untung tidak ikut naik. Jangan tambah modal dulu.', detail };
  if (pctIklan <= -0.1 && untungB >= untungA * 0.95) return { kelas: 'aturan-aman', teks: 'Biaya iklan turun, untung tetap. Pertahankan.', detail };
  if (untungB > untungA && pctIklan >= 0.1) return { kelas: 'aturan-aman', teks: 'Biaya iklan naik, untung ikut naik. Pertahankan.', detail };
  if (pctUntung <= -0.15) return { kelas: '', teks: 'Untung turun. Cek iklan, harga, stok, dan retur.', detail };
  return { kelas: '', teks: 'Pertahankan. Cek lagi minggu depan.', detail };
}

function grafikMingguanSvg(minggu) {
  const n = minggu.length;
  // Minggu rugi: label angkanya di bawah batang, jadi beri ruang supaya tidak menimpa tanggal.
  const adaRugi = minggu.some((t) => t.untungSetelahIklan < 0);
  const W = 720, H = adaRugi ? 184 : 170, padKiri = 8, padBawah = adaRugi ? 40 : 26, padAtas = 14;
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
    if (t.untungSetelahIklan !== null) isi += `<rect class="${t.untungSetelahIklan >= 0 ? 'batang-untung' : 'batang-rugi'}${kelasBelum}" x="${xU}" y="${yU}" width="${lebar}" height="${Math.max(hU, 1)}" rx="2"/>`;
    isi += `<rect class="batang-iklan${kelasBelum}" x="${xI}" y="${nol - hI}" width="${lebar}" height="${Math.max(hI, 1)}" rx="2"/>`;
    isi += `<text class="nilai" x="${x + lebarSlot / 2}" y="${(t.untungSetelahIklan >= 0 ? yU : nol + hU) + (t.untungSetelahIklan >= 0 ? -4 : 12)}" text-anchor="middle">${t.untungSetelahIklan === null ? '?' : escapeHtml(formatRupiahRingkas(t.untungSetelahIklan).replace('Rp ', ''))}</text>`;
    isi += `<text x="${x + lebarSlot / 2}" y="${H - 8}" text-anchor="middle">${labelMinggu(t.mulai)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Untung toko per minggu">${isi}</svg>
    <div class="legenda-grafik"><span>Untung setelah iklan</span><span class="leg-iklan">Biaya iklan</span></div>`;
}

function renderMingguan() {
  const aturanEl = document.getElementById('aturanMingguan');
  const grafik = document.getElementById('grafikMingguan');
  const data = untungTokoPerMinggu();
  if (!data || !data.minggu.length) {
    aturanTerakhir = null;
    aturanEl.className = 'aturan-mingguan';
    aturanEl.innerHTML = 'Untung toko per minggu muncul setelah data penjualan masuk.';
    grafik.innerHTML = '';
    return null;
  }
  // Grafik: sampai 8 minggu terakhir. Aturan satu kalimat di atasnya (dipakai juga untuk keputusan modal).
  const aturan = aturanMingguan(data, (a, b, n) => bandingMingguBiasa(sumberIklan().items, dataIklan && dataIklan.kampanye, a, b, n));
  aturanTerakhir = aturan;
  aturanEl.className = `aturan-mingguan ${aturan.kelas}`;
  aturanEl.innerHTML = `<span>${escapeHtml(aturan.teks)}</span>` + (aturan.detail ? `<small>${escapeHtml(aturan.detail)}</small>` : '');
  grafik.innerHTML = grafikMingguanSvg(data.minggu.slice(-8)) +
    '<p class="catatan-grafik">Satu batang = Senin–Minggu, menurut tanggal pesanan. Batang pucat = minggu belum lengkap.</p>';
  return { data, lengkapTerakhir: [...data.minggu].reverse().find((t) => t.lengkap) };
}

function renderRingkasanIklan(r) {
  const rasioPersen = (r.rasioPencairan * 100).toFixed(1).replace('.', ',');
  const catatan = document.getElementById('catatanRasioIklan');
  const periode = dataIklan.periode ? `${dariApi() ? 'Data iklan' : 'Periode file'}: <strong>${escapeHtml(dataIklan.periode)}</strong> · ${r.jumlahKampanye} kampanye, ${r.jumlahProduk} produk. ` : '';
  const cairPersen = Math.round((r.tingkatCair ?? 0.85) * 100);
  const sumberCair = {
    pengaturan: ' — angka yang diisi sendiri di bawah.',
    terukur: ' — diukur dari status pesanan Shopee toko ini (90–14 hari lalu); tiap produk memakai angkanya sendiri kalau pesanannya cukup.',
  }[dataIklan.sumberTingkatCair] || ' — angka standar, bisa diubah di bawah.';
  const catatanCair = ` Pesanan iklan dihitung <strong>${cairPersen}%</strong> dibayar (sisanya batal / tidak dibayar / diretur)` + sumberCair;
  // Kotak isian: kosong = pakai angka terukur (ditunjukkan sebagai placeholder).
  const terukur = dataIklan.tingkatCairTerukurToko;
  inputTingkatCair.placeholder = Number.isFinite(terukur) ? String(Math.round(terukur * 100)) : '85';
  if (dataIklan.sumberRasio === 'upload') {
    catatan.innerHTML = periode + `Potongan Shopee dihitung dari data penjualan yang sudah cair: rata-rata <strong>${rasioPersen}%</strong> dari harga jual yang cair ke penjual.` + catatanCair;
    catatan.classList.remove('catatan-default');
  } else {
    catatan.innerHTML = periode + `Memakai rasio pencairan standar <strong>${rasioPersen}%</strong> (data penjualan belum dimuat). Buka Kalkulator Margin supaya angkanya pas dengan toko ini.` + catatanCair;
    catatan.classList.add('catatan-default');
  }

  // Widget "Analisis Iklan" di Dashboard: biaya iklan sekarang, untung toko minggu lalu, perlu diubah.
  const kep = keputusanBerjalan();
  const wUntung = document.getElementById('widgetIklanUntung');
  const mingguan = untungTokoPerMinggu();
  const lengkap = mingguan ? mingguan.minggu.filter((t) => t.lengkap) : [];
  const akhir = lengkap[lengkap.length - 1];
  wUntung.textContent = akhir ? formatRupiah(akhir.untungSetelahIklan) : '-';
  wUntung.classList.toggle('angka-negatif', !!akhir && akhir.untungSetelahIklan < 0);
  const perluTindakan = kep.baris.filter((b) => PERLU_TINDAKAN.has(b.keputusan)).length;
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
  if (p.aksi === 'jeda') return 'baris-rugi';
  return '';
}
const LABEL_AKSI = { 'isi-hpp': ['Isi HPP dulu', 'pill-kuning'], jeda: ['Jeda', 'pill-merah'], rugi: ['Rugi', 'pill-oranye'], abu: ['Belum tentu', 'pill-biru'], untung: ['Untung', 'pill-hijau'], tunggu: ['Tunggu', 'pill-abu'], toko: ['Iklan toko', 'pill-abu'] };

// Nama produk Shopee ditulis huruf besar semua. Di Analisis Iklan: "Atasan Kaos Wanita 31#…"
// (lebih mudah dibaca), dipotong di akhir kata.
const namaRapi = (nama, maks = 46) => {
  let teks = String(nama || '').replace(/^HAPPY SHOP\s*-\s*/i, '').toLowerCase().replace(/(^|[^a-z0-9'])([a-z])/g, (_, a, b) => a + b.toUpperCase());
  teks = teks.replace(/\b(Gmv|Roas)\b/g, (k) => k.toUpperCase());
  if (teks.length <= maks) return teks;
  teks = teks.slice(0, maks + 1);
  const spasi = teks.lastIndexOf(' ');
  return (spasi > maks * 0.6 ? teks.slice(0, spasi) : teks.slice(0, maks)).replace(/[\s,\-–\[(]+$/, '') + '…';
};
// "15–21 Sep" (bulan sama) atau "28 Sep – 4 Okt".
const rentangTanggal = (dari, sampai) => {
  const [a, b] = [tanggalSingkat(dari), tanggalSingkat(sampai)];
  const [ha, ...ba] = a.split(' '), [, ...bb] = b.split(' ');
  return ba.join(' ') === bb.join(' ') ? `${ha}–${b}` : `${a} – ${b}`;
};

function kampanyePerProdukMap() {
  const peta = new Map();
  for (const k of dataIklan.kampanye) {
    if (!peta.has(k.kodeProduk)) peta.set(k.kodeProduk, []);
    peta.get(k.kodeProduk).push(k);
  }
  return peta;
}

const warnaUntung = (v) => (v >= 0 ? 'untung-positif' : 'untung-negatif');

// Satu baris produk di tabel "Semua produk" + (kalau dibuka) rinciannya di bawah.
function barisProdukIklan(p, kampanyePerProduk) {
  const terbuka = produkTerbuka.has(p.idProduk);
  const [labelAksi, pillAksi] = LABEL_AKSI[p.aksi] || ['-', 'pill-abu'];
  const roasRendah = p.roasImpas !== null && p.roasLangsung !== null && p.roasLangsung < p.roasImpas;
  const roas = p.aksi === 'toko' || p.roasLangsung === null
    ? '<span class="teks-redup">-</span>'
    : `<span class="${roasRendah ? 'untung-negatif' : ''}">${formatRoas(p.roasLangsung)}</span>` +
      `<small>${p.roasImpas !== null ? `min ${formatRoas(p.roasImpas)} · ` : ''}Shopee ${formatRoas(p.roasShopee)}</small>`;
  const untung = p.untungLangsung === null
    ? '<span class="teks-redup" title="Belum bisa dihitung. HPP produk ini belum diisi.">-</span>'
    : `<span class="${warnaUntung(p.untungLangsung)}">${formatRupiahRingkas(p.untungLangsung)}</span>` +
      `<small>Shopee ${formatRupiahRingkas(p.untungLuas)}</small>`;
  const baris = `
    <tr class="baris-produk ${kelasBarisIklan(p)}${terbuka ? ' terbuka' : ''}" data-id="${escapeHtml(p.idProduk)}">
      <td class="kolom-nama" data-label="Produk" title="${escapeHtml(p.namaProduk)}">
        <span class="nama-produk-iklan"><svg class="ikon panah-baris" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>${escapeHtml(namaRapi(p.namaProduk, 60))}</span>
        ${p.jumlahKampanye > 1 ? `<small class="teks-redup">${p.jumlahKampanye} kampanye</small>` : ''}
      </td>
      <td class="kolom-angka" data-label="Biaya">${formatRupiahRingkas(p.biaya)}</td>
      <td class="kolom-angka sel-dua" data-label="ROAS langsung">${roas}</td>
      <td class="kolom-angka sel-dua" data-label="Untung">${untung}</td>
      <td data-label="Status"><span class="pill ${pillAksi}" title="${escapeHtml(p.tindakan || '')}">${labelAksi}</span></td>
    </tr>`;
  return terbuka ? baris + barisRincianIklan(p, kampanyePerProduk, 5) : baris;
}

// Rincian satu produk (untuk Aaron): angka penting dalam satu kotak, lalu riwayat kampanyenya.
// Dipakai di daftar iklan berjalan (b = baris keputusan) dan di tabel "Semua produk" (b = null).
function panelRincianIklan(p, kampanyePerProduk, b = null) {
  const m = metrikBerjalan(p);
  const cairPersen = Math.round((p.tingkatCair ?? (dataIklan && dataIklan.ringkasan.tingkatCair) ?? 0.85) * 100);
  const dibayar = p.kampanyeTerukur && p.dibayarMaksTerukur < p.terjualLangsungTerukur
    ? `≤ ${p.dibayarMaksTerukur} dari ${p.terjualLangsungTerukur}`
    : `≈ ${cairPersen}%`;
  const sumberCair = { produk: 'data produk', toko: 'rata-rata toko', terukur: 'rata-rata toko',
    pengaturan: 'isian Pengaturan', default: 'perkiraan awal' }[p.sumberTingkatCair];
  const rendah = p.roasImpas !== null && m.roasLangsung !== null && m.roasLangsung < p.roasImpas;
  const item = (label, nilai) => `<div><dt>${label}</dt><dd>${nilai}</dd></div>`;
  const rek = b && b.rekomendasi && b.rekomendasi.rendah && b.rekomendasi.tinggi
    ? item('Saran Shopee', `${formatRoas(b.rekomendasi.rendah)}–${formatRoas(b.rekomendasi.tinggi)}${b.batasShopee ? ` <small>batas ${formatRoas(b.batasShopee)}</small>` : ''}`)
    : '';
  // Untung iklan 7 hari matang terakhir, hanya produk ini (di baris tidak ditampilkan; lihat KATA_GRUP).
  const h7 = untungIklanTujuhHari(p);
  const periode7 = p.penilaian && p.penilaian.siap ? ` <small>${rentangTanggal(p.penilaian.dari, p.penilaian.sampai)}</small>` : ' <small>selama berjalan</small>';
  const hasil7 = h7 ? item('Untung iklan', `<span class="${warnaUntung(h7.untung)}">${rupiahPendek(h7.untung)}</span>${periode7}`) : '';
  const angka = p.aksi === 'toko' ? '' : '<dl class="rincian-angka">' +
    item('ROAS langsung', `<span class="${rendah ? 'untung-negatif' : ''}">${formatRoas(m.roasLangsung)}</span>`) +
    item('ROAS minimum', p.roasImpas !== null ? formatRoas(p.roasImpas) : p.marginPerRp !== null ? 'tidak mungkin' : '-') +
    item('ROAS Shopee', formatRoas(m.roasShopee)) + rek +
    item('Harga / HPP', `${rupiahPendek(p.hargaRata)} / ${p.hpp === null ? 'belum diisi' : rupiahPendek(p.hpp)}`) +
    item('Margin', p.marginPerRp === null ? '-' : formatPersen(p.marginPerRp * 100)) +
    item('Pesanan dibayar', dibayar + (sumberCair ? ` <small>${sumberCair}</small>` : '')) + hasil7 +
    '</dl>';

  const catatan = b ? catatanKeputusanTeks(b).filter((t) => !t.startsWith('Berakhir')) : [p.tindakan].filter(Boolean);
  if (p.aksi !== 'toko') catatan.push('ROAS minimum untuk menilai hasil produk ini. Target di Shopee memakai hitungan berbeda.');
  const kampanye = (kampanyePerProduk.get(p.idProduk) || [])
    .slice()
    .sort((x, y) => (y.tanggalMulaiIso || '').localeCompare(x.tanggalMulaiIso || ''));
  const barisKampanye = kampanye.map((k) => {
    const periode = k.tanggalSelesaiIso ? rentangTanggal(k.tanggalMulaiIso, k.tanggalSelesaiIso) : `${tanggalSingkat(k.tanggalMulaiIso)} – sekarang`;
    return `<tr>
      <td title="${escapeHtml(k.namaIklan)}">${k.status === 'Berjalan' ? '<span class="titik titik-hijau" title="Berjalan"></span>' : ''}${periode}</td>
      <td>${escapeHtml(String(k.modeBidding || '-').replace(/GMV Max /g, ''))}${k.targetRoas ? ` ${formatRoas(k.targetRoas)}` : ''}</td>
      <td class="kolom-angka">${rupiahPendek(k.biaya)}</td>
      <td class="kolom-angka">${formatRoas(k.roasLangsung)}</td>
      <td class="kolom-angka">${k.untungLangsung === null || k.untungLangsung === undefined ? '-' : `<span class="${warnaUntung(k.untungLangsung)}">${rupiahPendek(k.untungLangsung)}</span>`}</td>
    </tr>`;
  }).join('');
  return `<div class="rincian-produk">
    ${angka}
    ${catatan.map((t) => `<p class="rincian-catatan">${escapeHtml(t)}</p>`).join('')}
    ${barisKampanye ? `<div class="tabel-scroll tabel-kampanye-bungkus"><table class="tabel-kampanye">
      <thead><tr><th>Kampanye</th><th>Mode</th><th class="kolom-angka">Biaya</th><th class="kolom-angka" title="ROAS langsung (hanya produk ini)">ROAS</th><th class="kolom-angka" title="Untung setelah iklan, hanya produk ini">Untung</th></tr></thead>
      <tbody>${barisKampanye}</tbody>
    </table></div>` : ''}
    <p class="rincian-id">ID produk ${escapeHtml(p.idProduk)}</p>
  </div>`;
}

function barisRincianIklan(p, kampanyePerProduk, colspan) {
  return `<tr class="baris-detail"><td colspan="${colspan}" data-label="">${panelRincianIklan(p, kampanyePerProduk)}</td></tr>`;
}

// ====== Keputusan untuk iklan yang sedang berjalan ======
// Tujuan: untung toko per minggu setelah iklan (keputusan pengguna 2026-09-26). Zona per produk
// dari analisisIklan.js (vonis), lalu calon perubahan bertahap. Evaluasi untung toko di bawah
// membatasi SATU percobaan baru dan dapat mengembalikan target jika untung toko turun:
//   zona 'untung' → 'tambah'  : Modal Harian +20% kalau modalnya hampir selalu habis (≥ 90%
//                               rata-rata 7 hari) dan untung toko mingguan tidak sedang turun
//                               sementara iklan naik; kalau tidak → 'lanjut'.
//   zona 'untung' → 'tumbuh'  : modal jarang habis (< 90%), ROAS langsung ≥ 1,2 × minimum, mode ROAS
//                               → Target ROAS −15% supaya lebih sering tayang (user, 01/10: tumbuh),
//                               tidak di bawah saran Shopee terendah / titik impas.
//   zona 'abu' → 'lanjut'       : mungkin untung lewat produk lain; jangan kurangi tayangnya (user, 01/10).
//   zona 'rugi' → 'naikkan' : Target ROAS +20% (panduan Shopee: ≤ 20% per perubahan),
//                               paling tinggi batas Shopee (rekomendasi tertinggi × 1,25).
//                   → di/atas batas: 'rugi' → 'kurangi' (Modal Harian −50%; target jangan naik lagi);
//                     'abu' di atas batas → 'turunkan' (≤ 20% per langkah, sampai batas); di batas → 'lanjut'.
//   'tunggu'  : belum ada tujuh hari penuh hasil yang sudah matang pada setelan sekarang.
//   'jeda'    : harga di bawah modal / 0% pesanan dibayar (vonis 'jeda').
//   'isi-hpp' / 'toko' : belum bisa dinilai / iklan level toko.
// Angka API memakai p.penilaian (jendela matang); CSV memakai p.berjalan (agregat).
const bulatkanModal = (rp) => Math.max(0, Math.round(rp / 5000) * 5000);
const bulatkanTargetBawah = (n) => Math.floor(n * 10 + 1e-9) / 10; // 10,78 → 10,7: tidak lewat batas
const LANGKAH_TARGET = 1.2;       // naik 20% per langkah (FAQ GMV Max Shopee: ≤ 20% sekali ubah)
const LANGKAH_MODAL = 1.2;        // tambah modal 20% per langkah (percobaan toko, bukan aturan Shopee)
const MODAL_HABIS = 0.9;          // rata-rata biaya ≥ 90% Modal Harian = iklan dibatasi modal
const LANGKAH_TUMBUH = 0.85;      // turunkan target 15% untuk tumbuh (user, 01/10)
const RUANG_TUMBUH = 1.2;         // hanya kalau ROAS langsung ≥ 1,2 × minimum (sama dengan Saran "ulang")
const HARI_TUNGGU_UBAH = 15;      // abaikan hari perubahan; 7 hari hasil + 7 hari atribusi penuh
const MODAL_IKLAN_BARU = 50000;    // iklan pengganti: 40–50 rb/hari (reports/saran-iklan-2026-09-27.md)
const PERLU_TINDAKAN = new Set(['jeda', 'ganti', 'kurangi', 'naikkan', 'turunkan', 'tambah', 'tumbuh', 'isi-hpp', 'kembalikan', 'tinjau']);
const metrikBerjalan = (p) => p.penilaian && p.penilaian.siap ? p.penilaian : p.berjalan || p;
const dariApi = () => !!(dataIklan && dataIklan.sumber === 'api');
function setelanProduk(idProduk) {
  if (dariApi()) return (dataIklan.setelanApi || {})[idProduk] || {};
  return daftarSetelan.get(idProduk) || {};
}

// Shopee tidak menyarankan Target ROAS lebih dari 25% di atas rekomendasi tertingginya — di atas
// itu iklan makin jarang tayang (iklan.shopee.co.id/learn/faq/555/1804).
const BATAS_ATAS_REKOMENDASI = 1.25;
const batasTargetShopee = (st) => (st.rekomendasi && st.rekomendasi.tinggi ? bulatkanTargetBawah(st.rekomendasi.tinggi * BATAS_ATAS_REKOMENDASI) : null);

// Tanggal selesai terdekat kampanye yang sedang berjalan untuk produk ini, kalau ≤ 7 hari lagi
// (kampanye "Tidak terbatas" tidak dihitung). Kampanye baru = tahap belajar 7 hari dari nol,
// jadi lebih baik periodenya diperpanjang (FAQ GMV Max ROAS menyarankan periode Tidak Terbatas).
function berakhirSegera(idProduk) {
  const hariIni = hariIniWib(), batas = geserHari(hariIni, 7);
  let terdekat = null;
  for (const k of dataIklan.kampanye) {
    if (k.kodeProduk !== idProduk || k.status !== 'Berjalan' || !/^\d{2}\/\d{2}\/\d{4}$/.test(k.tanggalSelesai || '')) continue;
    const iso = k.tanggalSelesaiIso;
    if (iso && iso >= hariIni && iso <= batas && (!terdekat || iso < terdekat)) terdekat = iso;
  }
  return terdekat;
}

// Angka harian kampanye yang sedang berjalan untuk satu produk: { iso: { biaya, omzetLangsung } }.
// Hanya ada di data API (perHari); file CSV tidak punya angka harian.
function harianProduk(idProduk) {
  const hasil = {};
  for (const k of dataIklan.kampanye) {
    if (k.kodeProduk !== idProduk || k.status !== 'Berjalan' || !k.perHari) continue;
    for (const [iso, v] of Object.entries(k.perHari)) {
      const t = hasil[iso] || (hasil[iso] = { biaya: 0, omzetLangsung: 0 });
      t.biaya += v.biaya || 0; t.omzetLangsung += v.omzetLangsung || 0;
    }
  }
  return hasil;
}

// Rata-rata biaya pada tujuh hari matang yang sama dengan vonis ÷ Modal Harian.
function pemakaianModal(idProduk, modal) {
  if (!dariApi() || !modal) return null;
  const berjalan = dataIklan.kampanye.filter((k) => k.kodeProduk === idProduk && k.status === 'Berjalan');
  if (!berjalan.length) return null;
  const harian = harianProduk(idProduk);
  const akhir = geserHari(hariIniWib(), -7);
  let biaya = 0;
  for (let i = 1; i <= 7; i++) {
    const d = geserHari(akhir, -i);
    if (!berjalan.every((k) => k.perHari && k.perHari[d] && Number.isFinite(k.perHari[d].biaya))) return null;
    biaya += harian[d].biaya;
  }
  return biaya / 7 / modal;
}

// Daftar Saran iklan (saranIklan.js) dari data yang sedang dimuat; null tanpa data API/penjualan.
function saranIklanSekarang() {
  const sumber = sumberIklan();
  if (!dariApi() || !sumber || typeof SaranIklan === 'undefined') return null;
  return SaranIklan.saranIklan(sumber.items, dataIklan.kampanye, hariIniWib(), dataIklan.ekonomiProduk);
}

// Iklan yang rugi besar ("boleh diganti" di Saran iklan) diganti, bukan dinaikkan targetnya
// (user, 2026-09-28). ROAS langsungnya < 0,6 × minimum, sedangkan langkah target 20% sampai batas
// Shopee (× 1,25) paling banyak menaikkan target ±30%, dan Shopee ROAS 90% iklan toko ini sudah di
// atas targetnya. Pengganti: "iklankan lagi" dulu, lalu "coba iklankan", satu per iklan.
// Tanpa pengganti → kurangi Modal Harian 50%. Iklan yang masih belajar (< 7 hari) tidak diganti.
function terapkanGanti(baris, saran, hasilTerakhir) {
  if (!saran || !saran.ganti.length) return;
  const pengganti = [...saran.ulang.map((p) => ({ ...p, jenis: 'ulang' })), ...saran.coba.map((p) => ({ ...p, jenis: 'coba' }))];
  const bisaDiganti = new Set(['naikkan', 'turunkan', 'tumbuh', 'kurangi', 'lanjut', 'tunggu']);
  for (const rugi of saran.ganti) { // paling rugi dulu
    const b = baris.find((x) => x.p.idProduk === rugi.idProduk);
    if (!b || !bisaDiganti.has(b.keputusan) || b.p.aksi === 'tunggu') continue;
    // A clearly worse result from this ad's latest settings change takes priority: the trial gate
    // below can then offer Kembalikan/Tinjau instead of skipping the result for a replacement.
    // Only a recent result (≤ 28 days): the gate always offers Tinjau for those, while an older one
    // could fall through to "naikkan" with no replacement.
    const hasil = hasilTerakhir && hasilTerakhir(b);
    if (hasil && hasil.status === 'buruk' && hasil.baru) continue;
    b.rugiBesar = { rugi: -rugi.untungIklan, hari: rugi.hari };
    b.targetBaru = null; b.alasan = 'rugi-besar';
    const pg = pengganti.shift();
    if (pg) { b.keputusan = 'ganti'; b.pengganti = pg; b.modalBaru = 0; }
    else { b.keputusan = 'kurangi'; b.modalBaru = b.modal !== null ? bulatkanModal(b.modal / 2) : null; }
  }
}

function penghasilanHarianToko() {
  const sumber = sumberIklan();
  if (!sumber) return null;
  const harian = {};
  for (const it of sumber.items) {
    if (it.dikembalikan) continue;
    const d = String(it.waktuPesanan || '').slice(0, 10);
    if (d) harian[d] = (harian[d] || 0) + (it.totalPenghasilan || 0);
  }
  return harian;
}

function keputusanBerjalan() {
  const baris = [];
  if (!dataIklan) return { baris, modalSekarang: 0, modalSaran: null, belumDiisi: 0 };
  const berjalan = dataIklan.produk.filter((p) => p.sedangBerjalan > 0);
  let dataBelumLengkap = null; // kenapa semua iklan ditahan: ditampilkan SEKALI sebagai banner
  // Penghasilan toko per tanggal pesanan: hasil perubahan per iklan tidak menghitung hari ramai.
  dataIklan.penghasilanHarian = penghasilanHarianToko();
  // Untung toko mingguan turun sementara iklan naik → jangan tambah modal dulu.
  const tokoTurun = !!(aturanTerakhir && aturanTerakhir.kelas === 'aturan-kurangi');
  const hariIni = hariIniWib();
  let modalSekarang = 0, modalSaran = 0, belumDiisi = 0, adaModal = false;
  for (const p of berjalan) {
    const st = setelanProduk(p.idProduk);
    const tanpaBatas = !!st.tanpa_batas;
    const modeAuto = dariApi() && st.mode === 'GMV Max Auto';
    const target = Number.isFinite(st.target_roas) ? st.target_roas : null;
    const modal = Number.isFinite(st.modal_harian) ? st.modal_harian : null;
    const batasShopee = batasTargetShopee(st);
    const perubahan = st.perubahan || null;
    const bisaDiubahLagi = perubahan ? geserHari(perubahan.tanggal, HARI_TUNGGU_UBAH) : null;
    const baruDiubah = !!(perubahan && bisaDiubahLagi > hariIni);
    const m = metrikBerjalan(p);
    let keputusan = 'lanjut', modalBaru = modal, targetBaru = null, alasan = '', pakai = null;
    const zonaIklan = ['untung', 'abu', 'rugi'].includes(p.aksi);
    if (p.aksi === 'isi-hpp') keputusan = 'isi-hpp';
    else if (p.aksi === 'toko') keputusan = 'toko';
    else if (p.aksi === 'tunggu') keputusan = 'tunggu';
    else if (p.aksi === 'jeda') { keputusan = 'jeda'; modalBaru = 0; }
    else if (zonaIklan && baruDiubah) { keputusan = 'tunggu'; alasan = 'baru-diubah'; }
    else if (p.aksi === 'untung') {
      pakai = pemakaianModal(p.idProduk, modal);
      const habis = pakai !== null && pakai >= MODAL_HABIS;
      if (habis && !tokoTurun) { keputusan = 'tambah'; modalBaru = bulatkanModal(modal * LANGKAH_MODAL); }
      else if (habis) alasan = 'toko-turun';
      else if (pakai !== null && target !== null && !modeAuto && p.roasImpas > 0 && m.roasLangsung >= RUANG_TUMBUH * p.roasImpas) {
        // Untung, tapi modal jarang habis: targetnya yang menahan tayang. Turunkan 15% supaya tumbuh
        // (user, 01/10), tidak di bawah saran Shopee terendah dan titik impas produk ini.
        const rek = st.rekomendasi;
        const bawah = Math.max(rek && rek.rendah > 0 ? rek.rendah : 0, Math.ceil(p.roasImpas * 10 - 1e-9) / 10);
        const baru = Math.max(bawah, Math.ceil(target * LANGKAH_TUMBUH * 10 - 1e-9) / 10);
        if (baru >= target - 0.05) alasan = 'di-bawah';
        else if (tokoTurun) alasan = 'toko-turun-target';
        else { keputusan = 'tumbuh'; targetBaru = baru; }
      }
    } else {
      // Zona abu-abu: biarkan (mungkin untung lewat produk lain; user 01/10: tumbuh), kecuali target di
      // atas batas Shopee. Zona rugi: naikkan target bertahap; di batas Shopee → kurangi modal.
      const dasar = target !== null ? target : m.roasShopee || (st.rekomendasi && st.rekomendasi.tengah) || null;
      const diAtas = target !== null && batasShopee !== null && target > batasShopee + 0.05;
      if (diAtas && p.aksi === 'abu') {
        // Mungkin untung lewat produk lain tapi jarang tayang: turunkan bertahap (≤ 20%) ke batas.
        keputusan = 'turunkan'; targetBaru = Math.max(batasShopee, Math.ceil((target / LANGKAH_TARGET) * 10 - 1e-9) / 10);
      } else if (target !== null && batasShopee !== null && target >= batasShopee - 0.05) {
        // Rugi dan target sudah di/atas batas: menurunkan target = lebih banyak biaya untuk iklan
        // yang rugi, jadi yang dikurangi modalnya.
        if (p.aksi === 'rugi') { keputusan = 'kurangi'; modalBaru = modal !== null ? bulatkanModal(modal / 2) : null; }
        alasan = diAtas ? 'di-atas-batas' : 'di-batas';
      } else if (p.aksi === 'abu') {
        alasan = 'abu';
      } else if (dasar !== null) {
        targetBaru = bulatkanTargetBawah(dasar * LANGKAH_TARGET);
        if (batasShopee !== null && targetBaru >= batasShopee) { targetBaru = batasShopee; alasan = 'ke-batas'; }
        keputusan = 'naikkan';
      }
    }
    if (modal !== null) { modalSekarang += modal; adaModal = true; modalSaran += modalBaru !== null ? modalBaru : modal; }
    else if (!tanpaBatas && p.aksi !== 'toko') belumDiisi += 1; // iklan toko tidak punya modal harian sendiri
    baris.push({ p, target, modal, minimal: p.targetDisarankan, keputusan, modalBaru, targetBaru, alasan, pakai, tanpaBatas, modeAuto,
      rekomendasi: st.rekomendasi || null, batasShopee, perubahan, bisaDiubahLagi, berakhir: p.aksi === 'toko' ? null : berakhirSegera(p.idProduk) });
  }
  // Keputusan sama: rugi 7 hari paling besar dulu (user, 30/09), lalu biaya paling besar.
  const untung7 = (b) => { const h = untungIklanTujuhHari(b.p); return h ? h.untung : 0; };
  const urutkan = () => baris.sort((a, b) => urutan[a.keputusan] - urutan[b.keputusan] || untung7(a) - untung7(b) || b.p.biaya - a.p.biaya);
  const urutan = { jeda: 0, ganti: 0, kembalikan: 1, tinjau: 1, kurangi: 2, turunkan: 3, naikkan: 4, tambah: 5, tumbuh: 5, 'isi-hpp': 6, tunggu: 7, lanjut: 8, toko: 9 };
  terapkanGanti(baris, saranIklanSekarang(), (b) => EvaluasiIklan.hasilIklan(dataIklan, b.p.idProduk, hariIni, b.p.roasImpas));
  urutkan();
  if (dariApi() && Array.isArray(dataIklan.riwayatSetelan)) {
    const sampai = geserHari(hariIni, -8);
    const dasar = EvaluasiIklan.rincianUntungToko(sumberIklan(), dataIklan.biayaTokoHarian, geserHari(sampai, -6), sampai);
    dasar.dari = geserHari(sampai, -6); dasar.sampai = sampai;
    EvaluasiIklan.terapkanEvaluasiToko(baris, dataIklan, dasar.nilai !== null, hariIni);
    if (baris.some((b) => b.alasan === 'data-toko')) {
      dataBelumLengkap = { dasar: dasar.nilai === null ? dasar : null, sinkron: dataIklan.sinkronBelumSiap || (dataIklan.dataSiapEvaluasi ? null : { jenis: 'gagal' }) };
    }
    modalSaran = baris.reduce((n, b) => n + (b.modalBaru ?? b.modal ?? 0), 0);
    urutkan();
  }
  return { baris, modalSekarang, modalSaran: adaModal ? modalSaran : null, belumDiisi, tokoTurun, dataBelumLengkap };
}

// Satu banner kuning untuk "data belum lengkap" (bukan kalimat yang sama di setiap iklan).
function bannerDataBelumLengkap(info) {
  if (!info) return '';
  const alasan = [];
  const d = info.dasar;
  if (d && d.alasan === 'hpp') {
    const nama = d.produkTanpaHpp.slice(0, 3).map((t) => escapeHtml(namaRapi(t.namaProduk || t.idProduk, 32))).join(', ');
    alasan.push(`HPP belum diisi untuk <strong>${Math.round(d.bagianTanpaHpp * 100)}%</strong> penjualan ${tanggalSingkat(d.dari)}–${tanggalSingkat(d.sampai)} (batasnya ${Math.round(EvaluasiIklan.BATAS_TANPA_HPP * 100)}%).` +
      (nama ? ` Paling besar: ${nama}.` : ''));
  } else if (d) {
    alasan.push(`Data penjualan atau biaya iklan ${tanggalSingkat(d.dari)}–${tanggalSingkat(d.sampai)} belum lengkap. Tunggu data berikutnya.`);
  }
  const s = info.sinkron;
  if (s) {
    alasan.push(s.jenis === 'antrean'
      ? `${s.menunggu + s.macet} pesanan masih diambil lagi dari Shopee${s.macet ? ` (${s.macet} macet)` : ''}.`
      : s.jenis === 'lama' ? 'Data Shopee belum masuk dalam 24 jam terakhir.' : 'Pengambilan data Shopee terakhir gagal.');
  }
  const tombol = d && d.alasan === 'hpp' ? '<button type="button" class="tombol-kecil" data-ke-hpp>Isi HPP</button>' : '';
  return `<div class="banner-data"><strong>Data belum lengkap. Target dan modal iklan tetap dulu.</strong>` +
    alasan.map((t) => `<span>${t}</span>`).join('') + tombol + '</div>';
}

// Kotak HPP kosong (langkah "Isi HPP" di Dashboard, baris kuning di tabel Data dan tab HPP):
// input[data-hpp-id] + tombol [data-simpan-hpp] di sebelahnya; Simpan atau Enter. Setelah data
// dimuat ulang, produk itu pindah dari daftar "belum diisi".
async function simpanHppLangkah(input) {
  if (!input || !input.value) { if (input) input.focus(); return; }
  const tombol = input.parentElement.querySelector('[data-simpan-hpp]');
  tombol.disabled = true; input.disabled = true;
  tombol.textContent = 'Menyimpan...';
  await simpanHpp(input.dataset.hppId, input.dataset.hppNama, input.value);
  tombol.disabled = false; input.disabled = false;
  tombol.textContent = 'Simpan';
}
document.addEventListener('click', (e) => {
  const tombol = e.target.closest('[data-simpan-hpp]');
  if (tombol) simpanHppLangkah(tombol.parentElement.querySelector('input[data-hpp-id]'));
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches && e.target.matches('input[data-hpp-id]')) simpanHppLangkah(e.target);
});

// Tombol "Isi HPP" di banner: buka Kalkulator Margin → tab HPP → filter "Belum Diisi".
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-ke-hpp]')) return;
  bukaHalaman('halamanKalkulator');
  const tab = document.querySelector('.pill-filter[data-subtab="subHpp"]');
  if (tab) tab.click();
  const belum = document.querySelector('.pill-filter[data-filter-hpp="belum"]');
  if (belum) belum.click();
  window.scrollTo(0, 0);
});

const LABEL_KEPUTUSAN = {
  kembalikan: ['Kembalikan target', 'pill-kuning', 'baris-peringatan'],
  tinjau: ['Periksa hasil', 'pill-kuning', 'baris-peringatan'],
  'isi-hpp': ['Isi HPP dulu', 'pill-kuning', 'baris-peringatan'],
  jeda: ['Jeda', 'pill-merah', 'baris-rugi'],
  ganti: ['Ganti iklan', 'pill-merah', 'baris-rugi'],
  turunkan: ['Target terlalu tinggi', 'pill-kuning', 'baris-peringatan'],
  naikkan: ['Naikkan target', 'pill-biru', 'baris-ragu'],
  kurangi: ['Kurangi modal', 'pill-oranye', 'baris-kurangi'],
  tambah: ['Tambah modal', 'pill-hijau', 'baris-untung'],
  tumbuh: ['Turunkan target', 'pill-hijau', 'baris-untung'],
  tunggu: ['Tunggu', 'pill-abu', ''],
  lanjut: ['Biarkan', 'pill-hijau', 'baris-untung'],
  toko: ['Iklan toko', 'pill-abu', ''],
};
// "Tunggu" punya beberapa sebab; beri warna berbeda supaya tidak semuanya abu-abu.
const LABEL_TUNGGU = {
  'baru-diubah': ['Tunggu hasil', 'pill-biru'],
  'data-toko': ['Data belum lengkap', 'pill-kuning'],
  'uji-campur': ['Periksa dulu', 'pill-kuning'],
  'tinjau-hasil': ['Periksa dulu', 'pill-kuning'],
  'tinjau-iklan': ['Periksa dulu', 'pill-kuning'],
  'data-iklan': ['Data belum lengkap', 'pill-kuning'],
  'sudah-kembali': ['Tetap', 'pill-abu'],
};
function labelKeputusan(b) {
  const dasar = LABEL_KEPUTUSAN[b.keputusan];
  const t = b.keputusan === 'tunggu' && LABEL_TUNGGU[b.alasan];
  if (b.keputusan === 'kembalikan' && b.targetBaru === null) return ['Kembalikan modal', dasar[1], dasar[2]];
  return t ? [t[0], t[1], dasar[2]] : dasar;
}

// Catatan kecil di bawah kalimat keputusan: iklan yang segera berakhir, dan target yang sudah
// di atas batas Shopee (iklan jadi jarang tayang).
function catatanKeputusanTeks(b) {
  const f = formatRoas;
  const catatan = [];
  if (b.berakhir && b.keputusan !== 'jeda') {
    catatan.push(`Berakhir ${tanggalSingkat(b.berakhir)}. Ubah Periode jadi Tidak Terbatas.`);
  }
  if (b.alasan === 'di-atas-batas') {
    catatan.push(`Target ${f(b.target)} sudah di atas batas (${f(b.batasShopee)}). Jangan dinaikkan lagi. Iklan bisa jarang tayang.`);
  }
  if (b.alasan === 'ke-batas' || b.alasan === 'di-batas' || b.keputusan === 'turunkan') {
    catatan.push(`Batas tertinggi ${f(b.batasShopee)} (saran Shopee paling tinggi ${f(b.rekomendasi.tinggi)}). Lebih tinggi bisa mengurangi penjualan.`);
  }
  if (b.keputusan === 'lanjut' && b.target !== null && b.batasShopee !== null && b.target > b.batasShopee + 0.05) {
    catatan.push(`Target ${f(b.target)} di atas batas (${f(b.batasShopee)}). Iklan bisa jarang tayang.`);
  }
  const z = b.p.zona; // zona baru dipakai setelah bertahan HARI_ZONA_TAHAN hari (evaluasiIklan.js)
  if (z && z.zona && z.mentah && z.mentah !== z.zona) {
    const nama = { untung: 'untung', abu: 'belum tentu untung', rugi: 'rugi' };
    catatan.push(`Hasil terbaru: ${nama[z.mentah]} (${z.hariBaru} dari ${EvaluasiIklan.HARI_ZONA_TAHAN} hari). Saran memakai ${nama[z.zona]} sampai itu bertahan.`);
  }
  const h = b.hasilIklan;
  if (h && Number.isFinite(h.bedaLangsung) && Number.isFinite(h.bedaShopee)) {
    const beda = (n) => `${n > 0 ? '+' : ''}${formatRupiahRingkas(n)}`;
    catatan.push(`Hasil perubahan: ${beda(h.bedaLangsung)}/hari dari produk ini (versi Shopee ${beda(h.bedaShopee)}/hari).` +
      (h.ramai && h.ramai.length ? ` Hari ramai tidak dihitung: ${h.ramai.map(tanggalSingkat).join(', ')}.` : ''));
  }
  return catatan;
}
function catatanKeputusan(b) {
  return catatanKeputusanTeks(b).map((t) => `<small class="catatan-keputusan${t.startsWith('Berakhir') ? ' catatan-berakhir' : ''}">${escapeHtml(t)}</small>`).join('');
}

const rupiahPendek = (n) => formatRupiahRingkas(n).replace('Rp ', '');
function kalimatKeputusan(b) {
  const f = formatRoas;
  const pesan = {
    'uji-campur': 'Ada dua perubahan berdekatan. Periksa hasilnya dulu.',
    'data-toko': 'Tetap dulu. Lihat catatan kuning di atas.',
    'tinjau-hasil': 'Untung toko turun. Periksa hasil perubahan dulu.',
    'tinjau-iklan': 'Untung iklan ini turun setelah beberapa setelan diubah. Periksa dulu.',
    'data-iklan': 'Tetap dulu. Data harian iklan ini belum lengkap.',
    'sudah-kembali': 'Target sudah dikembalikan. Jangan diubah lagi dulu.',
    'hasil-baik': 'Hasil bagus. Biarkan.',
    'belum-jelas': 'Hasil belum jelas. Biarkan, target tidak dinaikkan lagi.',
    'belum-jelas-turun': 'Hasil belum jelas. Biarkan, target tidak diturunkan lagi.',
    abu: 'Biarkan. Iklan ini juga membawa pembeli ke produk lain.',
    'di-bawah': 'Biarkan. Target sudah serendah saran Shopee.',
    'toko-turun-target': 'Biarkan. Target belum diturunkan karena untung toko belum naik.',
  };
  if (pesan[b.alasan]) return pesan[b.alasan];
  switch (b.keputusan) {
    case 'kembalikan': return b.targetBaru === null
      ? `Ubah Modal Harian ${rupiahPendek(b.modal)} → ${rupiahPendek(b.modalBaru)}. Target tetap.`
      : `Ubah Target ROAS ${f(b.target)} → ${f(b.targetBaru)}. Modal tetap.`;
    case 'isi-hpp': return 'Isi HPP di Kalkulator Margin.';
    case 'ganti': return `Matikan iklan ini. Pasang iklan baru untuk ${namaSingkat(b.pengganti.nama, 40)}.`;
    case 'jeda': case 'toko': return b.p.tindakan;
    case 'tunggu': return b.alasan === 'baru-diubah'
      ? `Baru diubah ${tanggalSingkat(b.perubahan.tanggal)}. Jangan diubah sampai ${tanggalSingkat(b.bisaDiubahLagi)}.`
      : b.p.tindakan;
    case 'naikkan': return b.target === null
      ? `Ganti ke GMV Max ROAS, target ${f(b.targetBaru)}.`
      : `Ubah Target ROAS ${f(b.target)} → ${f(b.targetBaru)}.`;
    case 'turunkan': return `Target ${f(b.target)} terlalu tinggi. Ubah Target ROAS ke ${f(b.targetBaru)}.`;
    case 'tumbuh': return `Ubah Target ROAS ${f(b.target)} → ${f(b.targetBaru)}. Modal tetap.`;
    case 'kurangi': return b.modal !== null
      ? `Turunkan Modal Harian ${rupiahPendek(b.modal)} → ${rupiahPendek(b.modalBaru)}. Target tetap.`
      : 'Beri batas Modal Harian (sekarang tanpa batas). Target tetap.';
    case 'tambah': return `Naikkan Modal Harian ${rupiahPendek(b.modal)} → ${rupiahPendek(b.modalBaru)}. Target tetap.`;
    default:
      if (b.alasan === 'toko-turun') return 'Biarkan. Modal belum ditambah karena untung toko belum naik.';
      if (b.alasan === 'di-batas' || b.alasan === 'di-atas-batas') return 'Biarkan. Target sudah di batas tertinggi.';
      return 'Tidak ada yang perlu diubah.';
  }
}

// Penurunan untung langsung yang melewati batas, mis. "25 rb".
function turunHasil(h) {
  if (!h) return '';
  return rupiahPendek(Math.abs(h.bedaLangsung));
}

// Alasan satu kalimat untuk kartu Tugas Minggu Ini (orang tua): kenapa perubahan ini.
function alasanTugas(b) {
  switch (b.keputusan) {
    case 'kembalikan': return `Untung iklan ini turun ${turunHasil(b.hasilIklan)}/hari setelah perubahan.`;
    case 'tinjau': return 'Beberapa setelan diubah bersama, jadi penyebabnya belum jelas.';
    case 'tambah': return 'Iklan untung dan modalnya hampir selalu habis.';
    case 'naikkan': return 'Naikkan sedikit supaya biaya iklan lebih hemat.';
    case 'turunkan': return 'Target terlalu tinggi, iklan jarang tayang.';
    case 'tumbuh': return `Iklan untung, tapi modal hanya terpakai ${Math.round(b.pakai * 100)}%. Turunkan sedikit supaya lebih sering tayang.`;
    case 'kurangi': return b.rugiBesar
      ? `Rugi ${rupiahPendek(b.rugiBesar.rugi)} dalam ${b.rugiBesar.hari} hari. Belum ada produk pengganti.`
      : 'Masih rugi. Target sudah di batas tertinggi.';
    case 'ganti': return `Rugi ${rupiahPendek(b.rugiBesar.rugi)} dalam ${b.rugiBesar.hari} hari. Menaikkan target tidak cukup.`;
    case 'jeda': return 'Iklan ini tidak mungkin untung.';
    case 'isi-hpp': return 'Belum bisa dinilai tanpa harga modal.';
    default: return '';
  }
}

// Baris kecil di bawah nama produk di tabel keputusan: ROAS Shopee (yang dinilai Shopee
// terhadap target) dan ROAS Langsung vs minimum (batas bawah untung) — dari kampanye yang
// sedang berjalan. Merah kalau ROAS Langsung di bawah minimum: iklan ini belum tentu untung
// walau Shopee bilang "Baik".
function subRoasBerjalan(p) {
  if (p.aksi === 'toko') return '';
  const m = metrikBerjalan(p);
  if (p.penilaian && !p.penilaian.siap) return '<span>Menunggu data harian untuk penilaian</span>';
  const hari = p.penilaian ? `<span>${tanggalSingkat(p.penilaian.dari)}–${tanggalSingkat(p.penilaian.sampai)}</span>` : p.berjalan ? `<span>hari ke-${p.berjalan.hari}</span>` : '';
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
  document.getElementById('ketTabelKeputusan').innerHTML = dariApi()
    ? '<strong>Modal Harian</strong> dan <strong>Target ROAS</strong> diambil otomatis dari Seller Centre. Klik baris untuk rincian.'
    : 'Isi <strong>Modal Harian</strong> dan <strong>Target ROAS</strong> yang sekarang terpasang di Seller Centre (sekali saja, disimpan). Klik baris untuk rincian.';
  renderGrupIklan(kep);
  // Data API: setelan & rincian sudah ada di daftar iklan berjalan; tabel ini hanya untuk file CSV.
  document.getElementById('bagianKeputusan').classList.toggle('tersembunyi', dariApi());

  // Baris anggaran (di kartu 1) — angka sekarang → saran, kalau modal sudah diisi.
  if (kep.modalSekarang > 0) {
    const sekarang = `Sekarang <strong>${formatRupiahRingkas(kep.modalSekarang)}/hari</strong> (≈ ${formatRupiahRingkas(kep.modalSekarang * 7)}/minggu)`;
    const saran = kep.modalSaran !== null && kep.modalSaran !== kep.modalSekarang
      ? ` → <strong>${formatRupiahRingkas(kep.modalSaran)}/hari</strong> kalau semua saran dijalankan.`
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
  info.textContent = `${kep.baris.length} iklan · ${perlu ? `${perlu} perlu diubah` : 'tidak ada yang perlu diubah'}`;

  const kampanyePerProduk = kampanyePerProdukMap();

  isi.innerHTML = kep.baris.map((b) => {
    const p = b.p;
    const [label, pill, kelasBaris] = labelKeputusan(b);
    const terbuka = keputusanTerbuka.has(p.idProduk);
    const toko = p.aksi === 'toko'; // iklan toko: tidak punya modal/target per produk
    const inputModal = toko ? '' : dariApi()
      ? `<span class="nilai-setelan" title="Modal Harian di Seller Centre (otomatis dari Shopee)">${b.modal !== null ? formatRupiahRingkas(b.modal).replace('Rp ', '') : b.tanpaBatas ? 'tanpa batas' : '-'}</span>`
      : `<input type="number" step="5000" min="0" class="input-setelan${b.modal === null ? ' kosong' : ''}" data-id="${escapeHtml(p.idProduk)}" data-field="modalHarian" value="${b.modal === null ? '' : b.modal}" placeholder="Rp/hari" title="Modal Harian yang terpasang di Seller Centre">`;
    const saranModal = toko ? '' : b.keputusan === 'jeda'
      ? '<span class="panah">→</span> <span class="saran nol">0</span>'
      : b.keputusan === 'kurangi'
        ? `<span class="panah">→</span> <span class="saran turun">${b.modalBaru !== null ? rupiahPendek(b.modalBaru) : 'batasi'}</span>`
        : b.keputusan === 'tambah'
          ? `<span class="panah">→</span> <span class="saran naik">${rupiahPendek(b.modalBaru)}</span>`
          : b.modal !== null ? '<span class="panah">→</span> <span class="saran">tetap</span>' : '';
    const inputTarget = toko ? '' : dariApi()
      ? `<span class="nilai-setelan${b.targetBaru !== null ? ' terlalu-rendah' : ''}" title="Target ROAS di Seller Centre (otomatis dari Shopee)">${b.target !== null ? formatRoas(b.target) : 'Auto'}</span>`
      : `<input type="number" step="0.1" min="0" class="input-setelan${b.target === null ? ' kosong' : ''}${b.targetBaru !== null ? ' terlalu-rendah' : ''}" data-id="${escapeHtml(p.idProduk)}" data-field="targetRoas" value="${b.target === null ? '' : b.target}" placeholder="target" title="Target ROAS yang terpasang di Seller Centre">`;
    const infoTarget = toko ? '' : b.targetBaru !== null
      ? `<span class="panah">→</span> <span class="saran">${formatRoas(b.targetBaru)}</span>`
      : b.target !== null && b.keputusan !== 'jeda' ? '<span class="panah">→</span> <span class="saran">tetap</span>' : '';
    const infoRekomendasi = !toko && b.rekomendasi && b.rekomendasi.rendah && b.rekomendasi.tinggi
      ? `<small class="rekomendasi-shopee" title="Rekomendasi Target ROAS Shopee (rendah–tinggi). Shopee tidak menyarankan lebih dari 25% di atas angka tertinggi.">Shopee ${formatRoas(b.rekomendasi.rendah)}–${formatRoas(b.rekomendasi.tinggi)}</small>`
      : '';
    const baris = `
      <tr class="baris-produk ${kelasBaris}${terbuka ? ' terbuka' : ''}" data-id="${escapeHtml(p.idProduk)}">
        <td class="kolom-nama" data-label="Produk" title="${escapeHtml(p.namaProduk)}">
          <div class="produk-iklan">
            <span class="nama"><svg class="ikon panah-baris" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>${escapeHtml(namaSingkat(p.namaProduk, 56))}</span>
            <span class="sub"><span class="kolom-id">${escapeHtml(p.idProduk)}</span>${subRoasBerjalan(p)}</span>
          </div>
        </td>
        <td class="kolom-tengah" data-label="Modal Harian"><span class="sel-setelan">${toko || (dariApi() && b.modal === null) ? '' : '<span class="prefix">Rp</span>'}${inputModal}${saranModal}</span></td>
        <td class="kolom-tengah" data-label="Target ROAS"><span class="sel-setelan">${inputTarget}${infoTarget}</span>${infoRekomendasi}</td>
        <td class="kolom-tindakan" data-label="Keputusan"><span class="pill pill-aksi ${pill}">${label}</span> ${escapeHtml(kalimatKeputusan(b))}${catatanKeputusan(b)}</td>
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

// ====== Analisis Iklan: iklan berjalan per kelompok (user, 2026-09-28) ======
// Satu kelompok per iklan; urutan = yang paling perlu dikerjakan dulu. Warna menurut arti:
// merah = matikan, kuning = kerjakan, biru = tunggu hasil, hijau = baik-baik saja.
const GRUP_IKLAN = [
  { kunci: 'hentikan', judul: 'Hentikan', ket: 'Matikan di Seller Centre.', warna: 'merah' },
  { kunci: 'ganti', judul: 'Ganti', ket: 'Iklan baru: Periode Tidak Terbatas, Modal Harian 50 rb. Cek stok dulu.', warna: 'merah' },
  { kunci: 'ubah', judul: 'Ubah', ket: 'Ubah di Seller Centre.', warna: 'kuning' },
  { kunci: 'belajar', judul: 'Masa Belajar', ket: 'Jangan diubah dulu.', warna: 'biru' },
  { kunci: 'lanjut', judul: 'Lanjutkan', ket: 'Tidak perlu diubah.', warna: 'hijau' },
];
function grupIklan(b, hariIni) {
  if (b.keputusan === 'jeda') return 'hentikan';
  if (b.keputusan === 'ganti') return 'ganti';
  if (['naikkan', 'turunkan', 'tambah', 'tumbuh', 'kurangi', 'kembalikan', 'tinjau', 'isi-hpp'].includes(b.keputusan)) return 'ubah';
  // Belum bisa dinilai karena waktu (iklan baru, belum ada biaya, atau baru diubah) = masa belajar.
  if (b.p.aksi === 'tunggu' && !(b.p.penilaian && b.p.penilaian.alasan === 'data')) return 'belajar';
  if (b.perubahan && geserHari(b.perubahan.tanggal, HARI_TUNGGU_UBAH) > hariIni) return 'belajar';
  return 'lanjut';
}

// "Target 13,5 → 16,0 · Modal 75 rb → 50 rb" dari catatan perubahan terakhir.
function teksPerubahan(u) {
  const bagian = [];
  if (u.targetLama && u.targetBaru && u.targetLama !== u.targetBaru) bagian.push(`Target ${formatRoas(u.targetLama)} → ${formatRoas(u.targetBaru)}`);
  if (u.modalLama && u.modalBaru && u.modalLama !== u.modalBaru) bagian.push(`Modal ${rupiahPendek(u.modalLama)} → ${rupiahPendek(u.modalBaru)}`);
  return bagian.join(' · ');
}

// Untung iklan dari produk ini sendiri: 7 hari matang terakhir (atau selama berjalan); null = belum ada.
function untungIklanTujuhHari(p) {
  if (p.aksi === 'toko' || !(p.roasImpas > 0) || (p.penilaian && !p.penilaian.siap)) return null;
  const m = metrikBerjalan(p);
  return m.biaya > 0 ? { untung: m.omzetLangsung / p.roasImpas - m.biaya, m } : null;
}

// Satu kata tindakan per iklan (user, 30/09): orang tua cukup melihat apa yang harus dilakukan.
// Angka untung/rugi per iklan hanya di "Rincian" (untuk Aaron).
const KATA_GRUP = { hentikan: 'Matikan', ganti: 'Ganti', ubah: 'Ubah', belajar: 'Tunggu', lanjut: 'Biarkan' };

// Kalimat utama (tanpa mengulang kata tindakan) dan catatan kecil per iklan, menurut kelompoknya.
function isiKartuIklan(b, grup, hariIni) {
  const p = b.p;
  const kata = KATA_GRUP[grup];
  switch (grup) {
    case 'hentikan': return { kata, aksi: String(p.tindakan || '').replace(/^Jeda — (\S)/, (_, h) => h.toUpperCase()) };
    case 'ganti': return { kata, aksi: 'Matikan iklan ini. Pasang iklan baru:',
      tambahan: `<span class="iklan-pengganti" title="${escapeHtml(b.pengganti.nama)}">${escapeHtml(namaRapi(b.pengganti.nama, 44))}</span>` +
        `<span class="iklan-mode">${escapeHtml(modePengganti(b.pengganti))}</span>`,
      ket: `Penggantinya ${buktiPengganti(b.pengganti)}` };
    case 'ubah': {
      if (b.keputusan === 'isi-hpp') return { kata: 'Isi HPP', aksi: 'Harga modal belum diisi.', tombolHpp: true };
      const kalimat = kalimatKeputusan(b).replace(/^Ubah (\S)/, (_, h) => h.toUpperCase());
      return { kata, aksi: kalimat, ket: alasanTugas(b) };
    }
    case 'belajar': {
      if (b.perubahan && geserHari(b.perubahan.tanggal, HARI_TUNGGU_UBAH) > hariIni) {
        const apa = teksPerubahan(b.perubahan);
        return { kata, aksi: `Sampai ${tanggalSingkat(geserHari(b.perubahan.tanggal, HARI_TUNGGU_UBAH))}.`, ket: `Baru diubah ${tanggalSingkat(b.perubahan.tanggal)}${apa ? ` (${apa})` : ''}.` };
      }
      if (p.berjalan && p.berjalan.hari < 7 && p.berjalan.tanggalMulaiIso) {
        return { kata, aksi: `Sampai ${tanggalSingkat(geserHari(p.berjalan.tanggalMulaiIso, 7))}.`, ket: `Iklan baru, hari ke-${p.berjalan.hari}.` };
      }
      if (p.penilaian && p.penilaian.siapTanggal) return { kata, aksi: `Sampai ${tanggalSingkat(p.penilaian.siapTanggal)}.`, ket: 'Iklan baru. Hasilnya belum lengkap.' };
      return { kata, aksi: 'Belum ada biaya iklan.', ket: 'Cek lagi dalam beberapa hari.' };
    }
    default: {
      if (p.aksi === 'toko') return { kata, aksi: 'Iklan toko. Dinilai dari untung toko per minggu.' };
      const catatan = {
        'hasil-baik': 'Perubahan terakhir berhasil.',
        'belum-jelas': 'Target tidak dinaikkan lagi dulu.',
        'belum-jelas-turun': 'Target tidak diturunkan lagi dulu.',
        'sudah-kembali': 'Target sudah dikembalikan. Jangan diubah lagi dulu.',
        abu: 'Iklan ini juga membawa pembeli ke produk lain.',
        'di-bawah': 'Target sudah serendah saran Shopee.',
        'toko-turun-target': 'Target tidak diturunkan dulu.',
        'uji-campur': 'Ada dua perubahan berdekatan. Tunggu dulu.',
        'data-toko': 'Tunggu data lengkap.',
        'data-iklan': 'Tunggu data lengkap.',
        'toko-turun': 'Modal tidak ditambah dulu.',
        'di-batas': 'Target sudah di batas tertinggi.',
        'di-atas-batas': 'Target sudah di batas tertinggi.',
      }[b.alasan];
      return { kata, aksi: catatan || '' };
    }
  }
}

// Satu baris per iklan: produk + setelan sekarang · kata tindakan + petunjuk · tombol "Rincian"
// (angka-angkanya, untuk Aaron) yang membuka panel di bawah baris itu.
function barisIklan(b, grup, hariIni, kampanyePerProduk) {
  const p = b.p;
  const isi = isiKartuIklan(b, grup, hariIni);
  const setelan = p.aksi === 'toko' ? ['Iklan toko'] : [
    b.target !== null ? `Target ${formatRoas(b.target)}` : b.modeAuto ? 'GMV Max Auto' : '',
    b.modal !== null ? `${rupiahPendek(b.modal)}/hari` : b.tanpaBatas ? 'Modal tanpa batas' : '',
  ].filter(Boolean);
  const berakhir = b.berakhir && !['jeda', 'ganti'].includes(b.keputusan) ? `<span class="tanda-berakhir">Berakhir ${tanggalSingkat(b.berakhir)}</span>` : '';
  const terbuka = iklanTerbuka.has(p.idProduk);
  const idPanel = `rincian-iklan-${escapeHtml(p.idProduk)}`;
  return `<div class="iklan-baris${terbuka ? ' terbuka' : ''}">` +
    '<div class="iklan-produk">' +
      `<div class="iklan-nama" title="${escapeHtml(p.namaProduk)}">${escapeHtml(namaRapi(p.namaProduk, 52))}</div>` +
      `<div class="iklan-setelan">${setelan.map((t) => `<span>${t}</span>`).join('')}${berakhir}</div>` +
    '</div>' +
    '<div class="iklan-tindakan">' +
      `<span class="iklan-kata">${escapeHtml(isi.kata)}</span>` +
      '<div class="iklan-petunjuk">' +
        (isi.aksi ? `<div class="iklan-aksi">${escapeHtml(isi.aksi)}</div>` : '') + (isi.tambahan || '') +
        (isi.ket ? `<div class="iklan-ket">${escapeHtml(isi.ket)}</div>` : '') +
        (isi.tombolHpp ? '<button type="button" class="tombol tombol-kecil" data-ke-hpp>Isi HPP</button>' : '') +
      '</div>' +
    '</div>' +
    `<button type="button" class="tombol-rincian" data-rincian-iklan="${escapeHtml(p.idProduk)}" aria-expanded="${terbuka}" aria-controls="${idPanel}">` +
      'Rincian <svg class="ikon" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></button>' +
    (terbuka ? `<div class="iklan-rincian" id="${idPanel}">${panelRincianIklan(p, kampanyePerProduk, b)}</div>` : '') +
  '</div>';
}

// Pemberitahuan di atas daftar: data belum lengkap, iklan yang segera berakhir.
function pemberitahuanIklan(kep) {
  let atas = bannerDataBelumLengkap(kep.dataBelumLengkap);
  const berakhir = kep.baris.filter((b) => b.berakhir && !['jeda', 'ganti'].includes(b.keputusan)).map((b) => b.berakhir).sort();
  if (berakhir.length) {
    const kapan = berakhir[0] === berakhir[berakhir.length - 1] ? tanggalSingkat(berakhir[0]) : `mulai ${tanggalSingkat(berakhir[0])}`;
    atas += `<div class="banner-berakhir"><strong>${berakhir.length} iklan berakhir ${kapan}.</strong> ` +
      '<span>Ubah Periode jadi <strong>Tidak Terbatas</strong> di iklan yang sama. Jangan buat iklan baru.</span></div>';
  }
  return atas ? `<div class="iklan-pemberitahuan">${atas}</div>` : '';
}

function renderGrupIklan(kep) {
  const el = document.getElementById('grupIklan');
  if (!el) return;
  const hariIni = hariIniWib();
  const atas = pemberitahuanIklan(kep);
  if (!kep.baris.length) {
    el.innerHTML = atas + '<div class="kartu"><p class="keterangan">Tidak ada iklan yang sedang berjalan.</p></div>';
    return;
  }
  const perGrup = new Map(GRUP_IKLAN.map((g) => [g.kunci, []]));
  for (const b of kep.baris) perGrup.get(grupIklan(b, hariIni)).push(b);
  const perlu = ['hentikan', 'ganti', 'ubah'].reduce((n, k) => n + perGrup.get(k).length, 0);
  const ringkas = (angka, label, kelas = '') => `<div class="ringkas-item ${kelas}"><span class="ringkas-angka">${angka}</span><span class="ringkas-label">${label}</span></div>`;
  const kampanyePerProduk = kampanyePerProdukMap();
  kepGrupTerakhir = kep;
  el.innerHTML = atas + '<div class="kartu kartu-iklan-berjalan">' +
    '<div class="iklan-ringkas">' +
      ringkas(kep.baris.length, 'iklan berjalan') +
      (kep.modalSekarang > 0 ? ringkas(formatRupiahRingkas(kep.modalSekarang), 'modal per hari') : '') +
      ringkas(perlu, 'perlu dikerjakan', perlu ? 'ringkas-perlu' : 'ringkas-beres') +
    '</div>' +
    '<div class="iklan-kepala" aria-hidden="true"><span>Iklan</span><span>Yang harus dilakukan</span></div>' +
    GRUP_IKLAN.filter((g) => perGrup.get(g.kunci).length).map((g) => {
      const daftar = perGrup.get(g.kunci);
      return `<section class="iklan-grup grup-${g.warna}" aria-label="${g.judul}">` +
        `<h3 class="iklan-grup-judul"><span class="grup-judul">${g.judul}</span><span class="grup-jumlah">${daftar.length}</span><span class="grup-ket">${g.ket}</span></h3>` +
        daftar.map((b) => barisIklan(b, g.kunci, hariIni, kampanyePerProduk)).join('') + '</section>';
    }).join('') + '</div>';
}

// Tombol "Rincian" di daftar iklan berjalan: buka/tutup angka iklan itu.
document.getElementById('grupIklan').addEventListener('click', (e) => {
  const tombol = e.target.closest('[data-rincian-iklan]');
  if (!tombol) return;
  const id = tombol.dataset.rincianIklan;
  if (iklanTerbuka.has(id)) iklanTerbuka.delete(id); else iklanTerbuka.add(id);
  renderGrupIklan(kepGrupTerakhir || keputusanBerjalan());
  const baru = document.querySelector(`[data-rincian-iklan="${CSS.escape(id)}"]`);
  if (baru) baru.focus();
});

// "Iklan yang sudah selesai": produk yang tidak sedang beriklan (90 hari), untuk tidak mengulang yang rugi.
function renderTabelIklan() {
  const daftar = urutkanProdukIklan(dataIklan.produk.filter((p) => !p.sedangBerjalan));
  const rugi = daftar.filter((p) => ['jeda', 'rugi', 'abu'].includes(p.aksi)).length;
  infoJumlahIklan.textContent = daftar.length ? `${daftar.length} produk${rugi ? ` · ${rugi} tidak untung` : ''}` : '';
  document.getElementById('kartuIklanSelesai').classList.toggle('tersembunyi', !daftar.length);
  if (!daftar.length) { isiTabelIklan.innerHTML = ''; return; }
  const kampanyePerProduk = kampanyePerProdukMap();
  isiTabelIklan.innerHTML = daftar.map((p) => barisProdukIklan(p, kampanyePerProduk)).join('');
  isiTabelIklan.querySelectorAll('tr.baris-produk').forEach((tr) => {
    tr.addEventListener('click', () => {
      const id = tr.dataset.id;
      if (produkTerbuka.has(id)) produkTerbuka.delete(id); else produkTerbuka.add(id);
      renderTabelIklan();
    });
  });
}


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

// ====== Tugas Minggu Ini (Dashboard) ======
// Untuk orang tua: untung toko setelah iklan di atas, lalu satu kartu per iklan yang perlu diubah
// di Seller Centre (dari keputusanBerjalan), iklan yang baru diubah (tunggu tanggal cek), dan hasil
// perubahan sebelumnya. Perubahan dikenali otomatis dari sinkron (iklan_riwayat_setelan), jadi
// tidak ada yang perlu dicentang.

// Untung toko per bulan (tanggal pesanan) setelah biaya iklan harian. Sama dengan kartu mingguan:
// pesanan belum cair memakai perkiraan, produk tanpa HPP memakai margin produk lain bulan itu.
function untungTokoPerBulan() {
  const sumber = sumberIklan();
  if (!sumber) return null;
  const bulan = new Map();
  const ambil = (k) => { let t = bulan.get(k); if (!t) { t = { bulan: k, penghasilan: 0, penghasilanDiketahui: 0, untungDiketahui: 0, saldoRetur: 0, biayaIklan: 0, adaIncome: false }; bulan.set(k, t); } return t; };
  for (const it of sumber.items) {
    const k = String(it.waktuPesanan || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(k)) continue;
    const t = ambil(k);
    t.adaIncome = true;
    if (it.dikembalikan) { t.saldoRetur += it.totalPenghasilan || 0; continue; }
    t.penghasilan += it.totalPenghasilan || 0;
    if (it.hpp !== null && it.untung !== null && it.untung !== undefined) { t.penghasilanDiketahui += it.totalPenghasilan || 0; t.untungDiketahui += it.untung; }
  }
  let adaBiayaHarian = false;
  if (dataIklan) {
    for (const k of dataIklan.kampanye) {
      if (!k.perHari) continue;
      adaBiayaHarian = true;
      for (const [iso, v] of Object.entries(k.perHari)) ambil(iso.slice(0, 7)).biayaIklan += v.biaya || 0;
    }
  }
  for (const t of bulan.values()) {
    const margin = t.penghasilanDiketahui ? t.untungDiketahui / t.penghasilanDiketahui : 0;
    t.untungKotor = t.adaIncome ? t.untungDiketahui + (t.penghasilan - t.penghasilanDiketahui) * margin + t.saldoRetur : null;
    t.untungSetelahIklan = t.untungKotor === null || !adaBiayaHarian ? null : t.untungKotor - t.biayaIklan;
  }
  return bulan;
}

// Hari ramai (user, 30/09; EvaluasiIklan.hariRamai): penghasilan hari itu > 1,8 × median harian 28 hari
// terakhir (9.9, tanggal 25, 15, 17 Agustus, ...). Satu hari promo bisa membuat minggu kelihatan naik/turun
// jutaan, jadi perbandingan minggu di Dashboard memakai rata-rata per hari dari hari biasa saja.
// Juga dipakai aturan 4 minggu (n = 4): pembandingnya median seluruh 8 minggu itu.
// Hasil (per hari biasa): { a, b, iklanA, iklanB, selisih (b − a), ramai: [iso] } atau null kalau biaya
// iklan harian tidak ada.
function bandingMingguBiasa(items, kampanye, mulaiA, mulaiB, n = 1) {
  if (!kampanye || !kampanye.some((k) => k.perHari)) return null;
  const akhirB = geserHari(mulaiB, 7 * n - 1), dari = geserHari(akhirB, -Math.max(28, 14 * n) + 1);
  const hari = new Map();
  const ambil = (d) => { let h = hari.get(d); if (!h) { h = { penghasilan: 0, diketahui: 0, untungDiketahui: 0, retur: 0, biaya: 0 }; hari.set(d, h); } return h; };
  for (const it of items) {
    const d = String(it.waktuPesanan || '').slice(0, 10);
    if (d < dari || d > akhirB) continue;
    const h = ambil(d);
    if (it.dikembalikan) { h.retur += it.totalPenghasilan || 0; continue; }
    h.penghasilan += it.totalPenghasilan || 0;
    if (it.hpp !== null && it.untung !== null && it.untung !== undefined) { h.diketahui += it.totalPenghasilan || 0; h.untungDiketahui += it.untung; }
  }
  for (const k of kampanye) {
    if (!k.perHari) continue;
    for (const [d, v] of Object.entries(k.perHari)) if (d >= dari && d <= akhirB) ambil(d).biaya += v.biaya || 0;
  }
  const harian = {};
  for (const [d, h] of hari) harian[d] = h.penghasilan;
  const daftarRamai = new Set(EvaluasiIklan.hariRamai(harian, mulaiA, akhirB));
  const ramai = (d) => daftarRamai.has(d);
  // Sama dengan kartu mingguan: produk tanpa HPP memakai margin produk lain di hari-hari itu.
  const rata = (mulai) => {
    const t = { penghasilan: 0, diketahui: 0, untungDiketahui: 0, retur: 0, biaya: 0 };
    let jumlah = 0;
    for (let i = 0; i < 7 * n; i++) {
      const d = geserHari(mulai, i);
      if (ramai(d)) continue;
      jumlah += 1;
      const h = hari.get(d);
      if (h) for (const f of Object.keys(t)) t[f] += h[f];
    }
    if (!jumlah) return null;
    const margin = t.diketahui ? t.untungDiketahui / t.diketahui : 0;
    return { untung: (t.untungDiketahui + (t.penghasilan - t.diketahui) * margin + t.retur - t.biaya) / jumlah, iklan: t.biaya / jumlah };
  };
  const a = rata(mulaiA), b = rata(mulaiB);
  if (a === null || b === null) return null;
  const semua = [];
  for (let i = 0; i < 14 * n; i++) if (ramai(geserHari(mulaiA, i))) semua.push(geserHari(mulaiA, i));
  return { a: a.untung, b: b.untung, iklanA: a.iklan, iklanB: b.iklan, selisih: b.untung - a.untung, ramai: semua };
}

// Baris "naik/turun dari minggu sebelumnya" di bawah angka untung Dashboard.
function barisSelisihMinggu(sebelum, akhir) {
  if (!sebelum || geserHari(sebelum.mulai, 7) !== akhir.mulai) return '';
  const banding = dataIklan && sumberIklan() ? bandingMingguBiasa(sumberIklan().items, dataIklan.kampanye, sebelum.mulai, akhir.mulai) : null;
  if (!banding) {
    const selisih = akhir.untungSetelahIklan - sebelum.untungSetelahIklan;
    return `<div class="tugas-selisih ${selisih >= 0 ? 'untung-positif' : 'untung-negatif'}">${selisih >= 0 ? 'Naik' : 'Turun'} ${formatRupiahRingkas(Math.abs(selisih))} dari minggu sebelumnya</div>`;
  }
  const naik = banding.selisih >= 0, ada = banding.ramai.length > 0;
  const arah = ada ? `Hari biasa: ${naik ? 'naik' : 'turun'}` : naik ? 'Naik' : 'Turun';
  return `<div class="tugas-selisih ${naik ? 'untung-positif' : 'untung-negatif'}">${arah} ${formatRupiahRingkas(Math.abs(banding.selisih))}/hari dari minggu sebelumnya</div>` +
    (ada ? `<small class="keterangan">Hari ramai tidak dihitung: ${banding.ramai.map(tanggalSingkat).join(', ')}.</small>` : '');
}

// Angka untung "menghitung naik" sekali (±0,7 detik) saat pertama tampil. Tidak dijalankan kalau
// perangkat meminta "kurangi gerakan"; angka akhir selalu sama dengan formatRupiah(nilai).
let sudahHitungNaik = false;
function hitungNaik(el, nilai) {
  if (!el || sudahHitungNaik || typeof window === 'undefined' || !window.matchMedia ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  sudahHitungNaik = true;
  const mulai = performance.now(), lama = 700;
  const langkah = (t) => {
    const k = Math.min(1, (t - mulai) / lama), e = 1 - Math.pow(1 - k, 3);
    el.textContent = formatRupiah(k < 1 ? Math.round(nilai * e) : nilai);
    if (k < 1) requestAnimationFrame(langkah);
  };
  requestAnimationFrame(langkah);
}

function renderTugas() {
  const untungEl = document.getElementById('tugasUntung');
  const daftarEl = document.getElementById('tugasDaftar');
  const lainEl = document.getElementById('tugasLain');
  const hasilEl = document.getElementById('tugasHasil');
  document.getElementById('tugasTanggal').textContent = formatTanggalPendek(hariIniWib());

  // 1. Untung toko: minggu lengkap terakhir + bulan ini vs bulan lalu.
  const mingguan = untungTokoPerMinggu();
  const lengkap = mingguan ? mingguan.minggu.filter((t) => t.lengkap && t.iklanLengkap && t.untungSetelahIklan !== null) : [];
  const perBulan = untungTokoPerBulan();
  if (lengkap.length) {
    const akhir = lengkap[lengkap.length - 1], sebelum = lengkap[lengkap.length - 2];
    const hariIni = hariIniWib(), bulanIni = hariIni.slice(0, 7);
    const bulanLalu = geserHari(`${bulanIni}-01`, -1).slice(0, 7);
    const namaBulan = (k) => new Date(`${k}-01T00:00:00`).toLocaleDateString('id-ID', { month: 'long' });
    const bIni = perBulan && perBulan.get(bulanIni), bLalu = perBulan && perBulan.get(bulanLalu);
    const baris = bIni && bIni.untungSetelahIklan !== null
      ? `<div class="tugas-bulan">${namaBulan(bulanIni)} sampai hari ini: <strong>${formatRupiahRingkas(bIni.untungSetelahIklan)}</strong>` +
        (bLalu && bLalu.untungSetelahIklan !== null ? ` · ${namaBulan(bulanLalu)}: ${formatRupiahRingkas(bLalu.untungSetelahIklan)}` : '') + '</div>'
      : '';
    untungEl.innerHTML = `<div class="label-ringkasan">Untung toko ${labelMinggu(akhir.mulai)}–${labelMinggu(akhir.selesai)}, setelah iklan</div>
      <div class="angka-ringkasan${akhir.untungSetelahIklan < 0 ? ' angka-negatif' : ''}" id="angkaUntungTugas">${formatRupiah(akhir.untungSetelahIklan)}</div>
      ${barisSelisihMinggu(sebelum, akhir)}
      ${baris}<small class="keterangan">Perkiraan. Belum termasuk biaya operasional.</small>`;
    untungEl.removeAttribute('aria-busy');
    hitungNaik(document.getElementById('angkaUntungTugas'), akhir.untungSetelahIklan);
  } else {
    untungEl.innerHTML = '<div class="keterangan">Untung toko muncul setelah data penjualan dan iklan masuk.</div>';
    untungEl.removeAttribute('aria-busy');
  }

  // 2. Langkah bernomor untuk orang tua: satu hal per langkah, urut dari yang paling perlu.
  if (!dataIklan) { daftarEl.innerHTML = '<p class="keterangan">Memuat data iklan...</p>'; lainEl.innerHTML = ''; hasilEl.innerHTML = ''; return; }
  const kep = keputusanBerjalan();
  const langkah = [];

  // a. Isi HPP: iklan tanpa HPP + produk terlaris tanpa HPP yang menahan saran iklan.
  const info = kep.dataBelumLengkap;
  const tanpaHpp = new Map(); // idProduk → nama
  for (const b of kep.baris.filter((b) => b.keputusan === 'isi-hpp')) tanpaHpp.set(b.p.idProduk, b.p.namaProduk);
  if (info && info.dasar && info.dasar.alasan === 'hpp') {
    for (const t of info.dasar.produkTanpaHpp) if (!tanpaHpp.has(t.idProduk)) tanpaHpp.set(t.idProduk, t.namaProduk || t.idProduk);
  }
  if (tanpaHpp.size) {
    const MAKS_ISI = 5;
    const daftar = [...tanpaHpp];
    const baris = daftar.slice(0, MAKS_ISI).map(([id, nama]) => `<li class="isi-hpp-baris"><span>${escapeHtml(namaRapi(nama, 40))}</span>` +
      (akunBacaSaja ? '' : `<span class="isi-hpp-kotak"><span class="prefix">Rp</span><input type="number" inputmode="numeric" min="0" step="500" placeholder="harga modal" aria-label="Harga modal ${escapeHtml(nama)}" data-hpp-id="${escapeHtml(id)}" data-hpp-nama="${escapeHtml(nama)}"><button type="button" class="tombol tombol-utama" data-simpan-hpp>Simpan</button></span>`) +
      '</li>').join('');
    const lagi = daftar.length > MAKS_ISI ? `<li class="langkah-lagi">+ ${daftar.length - MAKS_ISI} produk lagi</li>` : '';
    langkah.push({ warna: 'kuning', judul: 'Isi HPP (harga modal)', isi: `<ul class="langkah-daftar daftar-isi-hpp">${baris}${lagi}</ul>` +
      '<button type="button" class="tombol tombol-kecil tombol-langkah-kedua" data-ke-hpp>Buka daftar HPP</button>' +
      `<small class="langkah-ket">Isi harga modal per pcs, lalu tekan Simpan.${info ? ' Setelah itu saran iklan muncul lagi.' : ''}</small>` });
  } else if (info) {
    langkah.push({ warna: 'abu', judul: 'Tunggu data dari Shopee', isi: '<small class="langkah-ket">Tidak perlu apa-apa. Cek lagi besok.</small>' });
  }

  // b. Perpanjang periode iklan yang segera berakhir (paling dekat dulu).
  const perpanjang = kep.baris.filter((b) => b.berakhir && !['jeda', 'ganti'].includes(b.keputusan)).sort((a, b) => a.berakhir.localeCompare(b.berakhir));
  if (perpanjang.length) {
    langkah.push({ warna: 'oranye', judul: 'Ubah Periode iklan jadi Tidak Terbatas', isi:
      '<ul class="langkah-daftar">' + perpanjang.map((b) => `<li><span>${escapeHtml(namaRapi(b.p.namaProduk, 40))}</span><strong>sebelum ${tanggalSingkat(b.berakhir)}</strong></li>`).join('') + '</ul>' +
      '<small class="langkah-ket">Ubah iklan yang sama. Jangan buat iklan baru.</small>' });
  }

  // c. Perubahan target/modal: satu langkah per iklan.
  for (const b of kep.baris.filter((b) => PERLU_TINDAKAN.has(b.keputusan) && b.keputusan !== 'isi-hpp')) {
    if (b.keputusan === 'ganti') {
      langkah.push({ ubah: true, warna: 'merah', judul: 'Ganti iklan', isi: langkahGanti(b) });
      continue;
    }
    const [, pill] = labelKeputusan(b);
    langkah.push({ ubah: true, warna: pill.replace('pill-', ''), judul: kalimatKeputusan(b), isi:
      `<div class="langkah-produk">${escapeHtml(namaRapi(b.p.namaProduk, 40))}</div>` +
      (alasanTugas(b) ? `<small class="langkah-ket">${escapeHtml(alasanTugas(b))}</small>` : '') });
  }

  daftarEl.innerHTML = langkah.length
    ? langkah.map((l, i) => `<div class="tugas-langkah langkah-${l.warna}"><div class="langkah-kepala"><span class="langkah">${i + 1}</span><span class="langkah-judul">${escapeHtml(l.judul)}</span></div>${l.isi}</div>`).join('')
    : '<p class="tugas-judul">Tidak ada tugas minggu ini.</p>';

  // 3. Satu kalimat untuk iklan lain (tanpa daftar panjang).
  const dicoba = kep.baris.filter((b) => b.bisaDiubahLagi && b.alasan === 'baru-diubah');
  const cekLagi = dicoba.map((b) => b.bisaDiubahLagi).sort().pop();
  lainEl.innerHTML = kep.baris.some((b) => !PERLU_TINDAKAN.has(b.keputusan) && b.keputusan !== 'toko')
    ? `<p class="tugas-lain">Target dan modal ${langkah.some((l) => l.ubah) ? 'iklan lain' : 'semua iklan'}: <strong>jangan diubah</strong>${cekLagi ? ` sampai ${tanggalSingkat(cekLagi)}` : ' dulu'}.</p>`
    : '';

  // Hasil perubahan (≤ 28 hari): satu baris per iklan yang dinilai, dengan untung iklan itu sendiri.
  // Hasil "buruk" sudah menjadi langkah di atas.
  const teksHasil = { baik: 'hasil bagus', 'belum-jelas': 'hasil belum jelas' };
  const barisHasil = kep.baris.filter((b) => b.hasilIklan && b.hasilIklan.baru && teksHasil[b.hasilIklan.status] && !['kembalikan', 'tinjau'].includes(b.keputusan))
    .map((b) => `<p class="tugas-lain">${escapeHtml(namaRapi(b.p.namaProduk, 32))}: <strong>${teksHasil[b.hasilIklan.status]}${PERLU_TINDAKAN.has(b.keputusan) ? '' : ', biarkan'}</strong>.</p>`);
  hasilEl.innerHTML = barisHasil.join('');
  renderSaranIklan();
}

// "Ganti iklan": matikan yang rugi, pasang penggantinya (langkah Dashboard dan kartu Analisis Iklan).
const buktiPengganti = (pg) => (pg.jenis === 'ulang' ? `dulu untung ${rupiahPendek(pg.untungIklan)} dari iklan.` : `laku ${pg.pcsA} pcs dalam 4 minggu tanpa iklan.`);
// Mode iklan pengganti (user, 2026-09-28): produk yang dulu untung → GMV Max ROAS di target kampanye
// ROAS-nya yang paling untung (paling tinggi batas Shopee kalau diketahui); belum pernah → Auto.
// Target iklan baru (pengganti / Saran iklan), selalu GMV Max ROAS kalau ada angkanya:
// - dulu untung di mode ROAS → target terbaik dulu;
// - belum pernah (user, 30/09; Shopee: produk reguler → ROAS) → target tengah Shopee, tidak di bawah
//   titik impas produk itu.
// Keduanya dibatasi rekomendasi tertinggi Shopee × 1,25. Rekomendasi juga diambil untuk produk yang
// tidak sedang beriklan (rekomendasiProduk). null = belum ada angka → GMV Max Auto.
function targetPengganti(pg) {
  const st = setelanProduk(pg.idProduk);
  const rekomendasi = st.rekomendasi || (dataIklan && dataIklan.rekomendasiProduk || {})[pg.idProduk];
  const batas = batasTargetShopee({ rekomendasi });
  const impas = pg.roasMinimum > 0 ? Math.ceil(pg.roasMinimum * 10 - 1e-9) / 10 : 0;
  const dasar = pg.targetTerbaik || (rekomendasi && rekomendasi.tengah > 0 ? Math.max(rekomendasi.tengah, impas) : null);
  if (!dasar) return null;
  return { target: batas !== null ? Math.min(dasar, batas) : dasar, pasti: batas !== null };
}
function modePengganti(pg) {
  const t = targetPengganti(pg);
  if (!t) return 'GMV Max Auto (cek setelah 7–14 hari)';
  return `GMV Max ROAS, Target ${formatRoas(t.target)}${t.pasti ? '' : ' (cek batas Shopee)'}`;
}
function ketPengganti(b) {
  const bukti = buktiPengganti(b.pengganti);
  return `${bukti[0].toUpperCase()}${bukti.slice(1)} Cek stok dulu. ${modePengganti(b.pengganti)}, Periode Tidak Terbatas, Modal Harian ${rupiahPendek(MODAL_IKLAN_BARU)}.`;
}
const namaPengganti = (b) => `<strong title="${escapeHtml(b.pengganti.nama)}">${escapeHtml(namaRapi(b.pengganti.nama, 40))}</strong>`;
function langkahGanti(b) {
  return `<ol class="ganti-daftar"><li>Matikan: <strong title="${escapeHtml(b.p.namaProduk)}">${escapeHtml(namaRapi(b.p.namaProduk, 40))}</strong>` +
    `<small class="langkah-ket">${escapeHtml(alasanTugas(b))}</small></li>` +
    `<li>Pasang iklan baru: ${namaPengganti(b)}<small class="langkah-ket">${escapeHtml(ketPengganti(b))}</small></li></ol>`;
}

// Saran iklan: dropdown kecil di Tugas Minggu Ini (saranIklan.js). Pilihan, bukan tugas.
function renderSaranIklan() {
  const el = document.getElementById('saranIklan');
  if (!el) return;
  const s = saranIklanSekarang();
  if (!s) { el.hidden = true; return; }
  const bagian = (judul, ket, daftar, nilai) => (daftar.length
    ? `<h3 class="saran-judul">${judul}</h3><small class="langkah-ket">${ket}</small><ul class="langkah-daftar">` +
      daftar.map((p) => `<li><span title="${escapeHtml(namaRapi(p.nama, 200))}">${escapeHtml(namaRapi(p.nama, 32))}</span><strong>${nilai(p)}</strong></li>`).join('') + '</ul>'
    : '');
  const isi = bagian('Iklankan lagi', 'Dulu untung dari iklan. Pasang GMV Max ROAS dengan target yang tertulis.', s.ulang,
    (p) => { const t = targetPengganti(p); return `untung ${rupiahPendek(p.untungIklan)} · ${t ? `target ${formatRoas(t.target)}` : 'Auto'}`; }) +
    bagian('Coba iklankan', 'Laku tanpa iklan dan untungnya cukup. Pasang GMV Max ROAS dengan target yang tertulis. Tanpa target: GMV Max Auto.', s.coba,
      (p) => { const t = targetPengganti(p); return `${p.pcsA} terjual / 4 minggu · ${t ? `target ${formatRoas(t.target)}` : 'Auto'}`; });
  el.hidden = !isi;
  document.getElementById('saranIklanIsi').innerHTML = isi &&
    isi + '<small class="langkah-ket">Cek stok dulu. Periode Tidak Terbatas. Boleh beberapa sekaligus.</small>';
}

// ====== Pengaturan: diagnostik + unduh data ======
async function muatDiagnostik() {
  const el = document.getElementById('isiDiagnostik');
  try {
    const d = await apiFetch('/api/diagnostik');
    const ok = (baik, teks) => `<span class="status-titik ${baik ? 'baik' : 'perhatian'}"></span>${teks}`;
    const s = d.sinkron;
    const baris = [
      ['Sinkron pesanan', ok(s.status === 'sukses', `${escapeHtml(s.status || '-')} · ${waktuWib(s.terakhirSelesai)}`)],
      ['Sinkron iklan', ok(s.iklanStatus === 'sukses', `${escapeHtml(s.iklanStatus || '-')} · ${waktuWib(s.iklanTerakhirSelesai)}`)],
      ['Pesanan diambil ulang', ok(!s.ulangTertunda && !s.ulangMacet, `${s.ulangTertunda || 0} menunggu · ${s.ulangMacet || 0} macet`)],
      ['Pesanan tersimpan', `${(d.pesanan.jumlah || 0).toLocaleString('id-ID')} (${tanggalSingkat(d.pesanan.dari)} – ${tanggalSingkat(d.pesanan.sampai)}) · ${(d.pesanan.belumCair || 0).toLocaleString('id-ID')} belum cair · ${(d.pesanan.batal || 0).toLocaleString('id-ID')} batal/belum dibayar`],
      ['Produk tanpa HPP', ok(!d.tanpaHpp30.produk, d.tanpaHpp30.produk
        ? `${d.tanpaHpp30.produk} produk terjual 30 hari terakhir · ${formatRupiahRingkas(d.tanpaHpp30.penghasilan)}${d.tanpaHpp30.bagian !== null ? ` (${Math.round(d.tanpaHpp30.bagian * 100)}% penjualan)` : ''}`
        : `Semua produk yang terjual 30 hari terakhir sudah ada HPP`)],
      ['Iklan', `${d.iklan.kampanyeBerjalan || 0} berjalan · data ${tanggalSingkat(d.iklan.dari)} – ${tanggalSingkat(d.iklan.sampai)} · ${d.iklan.perubahanTercatat || 0} perubahan tercatat`],
      ['Biaya iklan per pesanan', d.payPerSale.pesanan
        ? ok(false, `${d.payPerSale.pesanan.toLocaleString('id-ID')} pesanan kena biaya ini sejak ${tanggalSingkat(d.payPerSale.sejak)} · ${formatRupiahRingkas(d.payPerSale.total)}. Untung toko sudah benar. Hitungan di Analisis Iklan belum memperhitungkannya.`)
        : ok(true, d.payPerSale.dicek ? `Tidak ada (${d.payPerSale.dicek.toLocaleString('id-ID')} pesanan dicek)` : 'Belum ada data dari Shopee')],
      ['Pesanan iklan dibayar', d.tingkatCairTerukur !== null ? `${Math.round(d.tingkatCairTerukur * 100)}% (terukur)` : '-'],
      ['Versi aplikasi', escapeHtml(d.versi)],
    ];
    if (s.pesan || s.iklanPesan) baris.push(['Pesan terakhir', escapeHtml([s.pesan, s.iklanPesan].filter(Boolean).join(' · '))]);
    el.innerHTML = '<dl class="daftar-diagnostik">' + baris.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('') + '</dl>';
  } catch (err) {
    el.innerHTML = `<p class="pesan-error">${escapeHtml(err.message)}</p>`;
  }
  muatLogServer();
}

// Log server terbaru (sinkron selesai/gagal, penolakan Shopee), terbaru di atas.
async function muatLogServer() {
  const el = document.getElementById('isiLogServer');
  try {
    const log = await apiFetch('/api/log?n=60');
    el.innerHTML = log.length
      ? '<ol class="daftar-log">' + log.map((l) => `<li class="log-${escapeHtml(l.level)}"><time>${waktuWib(l.waktu)}</time> ${escapeHtml(l.pesan)}</li>`).join('') + '</ol>'
      : '<p class="keterangan">Belum ada log.</p>';
  } catch (err) {
    el.innerHTML = `<p class="pesan-error">${escapeHtml(err.message)}</p>`;
  }
}
document.getElementById('tombolDiagnostik').addEventListener('click', muatDiagnostik);

// Saran iklan yang sedang tampil ikut dikirim, karena dihitung di browser.
function keputusanUntukEkspor() {
  try {
    if (!dataIklan) return [];
    return keputusanBerjalan().baris.map((b) => ({
      idProduk: b.p.idProduk, namaProduk: b.p.namaProduk, keputusan: b.keputusan, label: labelKeputusan(b)[0], kalimat: kalimatKeputusan(b),
      alasan: b.alasan || '', zona: b.p.aksi, target: b.target, targetBaru: b.targetBaru, modal: b.modal, modalBaru: b.modalBaru,
      batasShopee: b.batasShopee, roasLangsung: metrikBerjalan(b.p).roasLangsung ?? null, roasMinimum: b.p.roasImpas ?? null,
      berakhir: b.berakhir || '', bisaDiubahLagi: b.bisaDiubahLagi || '', zonaTerbaru: b.p.zona ? b.p.zona.mentah : null,
    }));
  } catch (err) {
    console.error('Saran iklan tidak ikut ekspor:', err); // file tetap dibuat, tanpa sheet keputusan
    return [];
  }
}
document.getElementById('tombolEkspor').addEventListener('click', async () => {
  const tombol = document.getElementById('tombolEkspor'), pesan = document.getElementById('pesanEkspor');
  tombol.disabled = true;
  pesan.innerHTML = '<span class="spinner"></span> Menyiapkan file... (bisa 10–30 detik)';
  try {
    if (sinkronKlien) await sinkronKlien;
    if (muatIklanBerjalan) await muatIklanBerjalan;
    else if (!dataIklan) await muatDataPenjualanIklan();
    const keputusan = keputusanUntukEkspor();
    const res = await fetch('/api/ekspor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keputusan }) });
    if (!res.ok) {
      if (res.status === 401) tampilkanLogin();
      let body = null; try { body = await res.json(); } catch (_) { /* bukan JSON */ }
      throw new Error((body && body.error) || `Terjadi kesalahan (${res.status}).`);
    }
    const blob = await res.blob();
    const nama = (/filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '') || [])[1] || 'happyshop-data.xlsx';
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = nama; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    pesan.textContent = `Selesai: ${nama} (${Math.max(1, Math.round(blob.size / 1024)).toLocaleString('id-ID')} KB)` +
      (keputusan.length ? ` · ${keputusan.length} saran iklan ikut tersimpan.` : ' · Belum ada data iklan, jadi saran iklan tidak ikut.');
  } catch (err) {
    pesan.innerHTML = `<span class="pesan-error">${escapeHtml(err.message)}</span>`;
  } finally {
    tombol.disabled = false;
  }
});

// ====== Mulai ======
cekSesi();
