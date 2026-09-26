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
  mulaiDataOtomatis();
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
  // Grafik tren diukur dari lebar kartunya — gambar ulang begitu halamannya kelihatan.
  if (idHalaman === 'halamanKalkulator' && dataHasilUpload) renderTren();
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
const tombolSinkron = document.getElementById('tombolSinkron');
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
  tombolSinkron.classList.toggle('tersembunyi', !terhubung);
  document.getElementById('tautanHubungkan').classList.toggle('tersembunyi', terhubung);
  tombolTampilkan.disabled = !terhubung;
  if (!terhubung) {
    teksStatusSinkron.textContent = 'Toko belum terhubung ke Shopee. Hubungkan sekali, setelah itu data diambil otomatis.';
    return;
  }
  const bagian = [];
  if (s.sedangBerjalan) bagian.push('Sedang mengambil data dari Shopee...');
  else if (s.terakhirSelesai) {
    const waktu = new Date(s.terakhirSelesai).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    bagian.push(s.status === 'gagal' ? `Sinkron terakhir gagal (${waktu})` : `Terakhir diperbarui ${waktu}`);
  } else bagian.push('Belum pernah sinkron');
  if (s.jumlahPesanan) bagian.push(`${s.jumlahPesanan.toLocaleString('id-ID')} pesanan tersimpan (${formatTanggalPendek(s.tanggalTerlama)} – ${formatTanggalPendek(s.tanggalTerbaru)})`);
  bagian.push('otomatis tiap 30 menit');
  if (s.ulangTertunda) bagian.push(`${s.ulangTertunda} pemeriksaan menunggu — dilanjutkan otomatis`);
  if (s.ulangMacet) bagian.push(`${s.ulangMacet} pesanan belum bisa diperiksa ulang — tetap dicoba otomatis`);
  teksStatusSinkron.textContent = bagian.join(' · ');
  tombolSinkron.disabled = !!s.sedangBerjalan;
  tampilkanErrorSinkron(s.status === 'gagal' && s.pesan ? `Sinkron terakhir gagal: ${s.pesan}` : '');
  renderProgres(s);
}

// ====== Progress bar sinkron ======
// Dua langkah jadi satu bar 0–100%: langkah 1 (pesanan) = 0–50%, langkah 2 (rincian dana cair)
// = 50–100%. Selama jumlahnya belum diketahui (server masih mendaftar pesanan), bar bergerak
// bolak-balik. Setelah selesai: hijau "Selesai" beberapa detik lalu menghilang; gagal: merah.
let progresTadiBerjalan = false;
let jedaPudarProgres = null;
function renderProgres(s) {
  const el = document.getElementById('progresSinkron');
  const isi = document.getElementById('progresIsi');
  const trek = document.getElementById('progresTrek');
  const label = document.getElementById('progresLabel');
  const angka = document.getElementById('progresAngka');
  const lPesanan = document.getElementById('langkahPesanan');
  const lDana = document.getElementById('langkahDana');

  if (s && s.sedangBerjalan) {
    clearTimeout(jedaPudarProgres);
    progresTadiBerjalan = true;
    el.classList.remove('tersembunyi', 'selesai', 'gagal', 'memudar');
    const p = s.progres || { tahap: 'pesanan', selesai: 0, total: null };
    const idx = p.tahap === 'pesanan' ? 0 : 1; // 'dana' & 'iklan' = langkah 2
    lPesanan.className = 'langkah-progres ' + (idx === 0 ? 'aktif' : 'beres');
    lDana.className = 'langkah-progres' + (idx === 1 ? ' aktif' : '');
    const namaLangkah = idx === 0 ? 'Mengambil pesanan' : p.tahap === 'iklan' ? 'Mengambil data iklan' : 'Mengambil rincian dana cair';
    if (p.total === null || p.total === undefined) {
      el.classList.add('tak-tentu');
      label.textContent = `Langkah ${idx + 1} dari 2 · ${idx === 0 ? 'Mencari pesanan di Shopee...' : p.tahap === 'iklan' ? 'Mengambil data iklan dari Shopee...' : 'Mencari pesanan yang dananya cair...'}`;
      angka.textContent = '';
      trek.removeAttribute('aria-valuenow');
      return;
    }
    el.classList.remove('tak-tentu');
    const persen = Math.round(((idx + (p.total ? p.selesai / p.total : 1)) / 2) * 100);
    isi.style.width = `${persen}%`;
    trek.setAttribute('aria-valuenow', String(persen));
    label.textContent = `Langkah ${idx + 1} dari 2 · ${namaLangkah}`;
    angka.textContent = p.total
      ? `${p.selesai.toLocaleString('id-ID')} / ${p.total.toLocaleString('id-ID')} · ${persen}%`
      : `tidak ada yang berubah · ${persen}%`;
    return;
  }

  if (!progresTadiBerjalan) return; // tidak sedang (dan tidak baru saja) sinkron: biarkan tersembunyi
  progresTadiBerjalan = false;
  const gagal = s && s.status === 'gagal';
  el.classList.remove('tak-tentu', 'memudar', 'tersembunyi');
  el.classList.add(gagal ? 'gagal' : 'selesai');
  isi.style.width = '100%';
  trek.setAttribute('aria-valuenow', '100');
  // Gagal: jangan tandai langkah mana pun "beres" — belum tentu langkah 1 selesai.
  lPesanan.className = 'langkah-progres' + (gagal ? '' : ' beres');
  lDana.className = 'langkah-progres' + (gagal ? '' : ' beres');
  // Ringkasan hasil: tidak ada yang baru → "Data sudah terbaru"; kalau ada, sebutkan berapa.
  const nOrder = (s && s.jumlahOrderBerubah) || 0, nDana = (s && s.jumlahBaru) || 0;
  const bagianBaru = [];
  if (nOrder) bagianBaru.push(`${nOrder.toLocaleString('id-ID')} pesanan baru/berubah`);
  if (nDana) bagianBaru.push(`${nDana.toLocaleString('id-ID')} dana cair baru`);
  label.textContent = gagal
    ? '✕ Gagal mengambil data — lihat pesan di bawah'
    : s && s.ulangTertunda ? `Pemeriksaan bertahap — ${s.ulangTertunda} masih menunggu`
    : bagianBaru.length ? `✓ Selesai — ${bagianBaru.join(' · ')}` : '✓ Data sudah terbaru — tidak ada pesanan baru';
  angka.textContent = '';
  clearTimeout(jedaPudarProgres);
  if (!gagal) {
    jedaPudarProgres = setTimeout(() => {
      el.classList.add('memudar');
      jedaPudarProgres = setTimeout(() => el.classList.add('tersembunyi'), 600);
    }, 3500);
  }
}

async function muatStatusSinkron() {
  try {
    renderStatusSinkron(await apiFetch('/api/sinkron/status'));
  } catch (err) {
    teksStatusSinkron.textContent = 'Gagal memeriksa koneksi ke Shopee.';
  }
}

async function sinkronSekarang() {
  tombolSinkron.disabled = true;
  sedangMengikutiSinkron = true; // pemeriksa semenit tidak perlu ikut memantau
  tampilkanErrorSinkron('');
  renderProgres({ sedangBerjalan: true, progres: null });
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
    renderStatusSinkron(hasil);
    await muatDataPenjualan();
    muatDataPenjualanIklan();
  } catch (err) {
    pantau = false; clearInterval(penjadwal);
    await muatStatusSinkron(); // status "gagal" → bar merah
    tampilkanErrorSinkron(err.message);
    await muatDataPenjualanDiam(); // tetap tampilkan data yang sudah tersimpan, pesan error dibiarkan
  } finally {
    pantau = false; clearInterval(penjadwal);
    sedangMengikutiSinkron = false;
    tombolSinkron.disabled = false;
  }
}
tombolSinkron.addEventListener('click', () => sinkronSekarang());

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
  const approx = r.penghasilanPerkiraan ? '<span class="tanda-kira" title="Sebagian masih perkiraan — dana belum cair">≈</span>' : '';
  document.getElementById('ringkasanOmzet').textContent = formatRupiah(r.totalOmzet || 0);
  document.getElementById('ketOmzet').textContent = `${(r.jumlahPesanan || 0).toLocaleString('id-ID')} pesanan · ${(r.totalPcs || 0).toLocaleString('id-ID')} pcs`;
  document.getElementById('ringkasanPendapatan').innerHTML = approx + escapeHtml(formatRupiah(r.totalPenghasilan));
  document.getElementById('ringkasanUntung').innerHTML = approx + escapeHtml(formatRupiah(r.totalUntung));
  const catatan = document.getElementById('catatanPerkiraan');
  catatan.classList.toggle('tersembunyi', !r.penghasilanPerkiraan);
  if (r.penghasilanPerkiraan) {
    catatan.textContent = `≈ Termasuk ${r.jumlahPesananPerkiraan} pesanan yang dananya belum cair (${formatRupiah(r.penghasilanPerkiraan)}): ` +
      `penghasilannya diperkirakan ${formatPersen((r.rasioPerkiraan || 0) * 100)} dari harga jual (rata-rata pesanan cair 60 hari terakhir). ` +
      'Angka pasti muncul otomatis setelah dana cair.';
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
  for (let d = dari; d <= sampai; d = tambahHari(d, 1)) {
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

      // Jumlah pcs langsung dari Shopee (model_quantity_purchased / quantity_purchased).
      const selJumlah = it.dikembalikan
        ? '<span class="teks-redup" title="Tidak relevan — pesanan ini dikembalikan.">-</span>'
        : String(it.jumlah);

      // Pesanan yang dananya belum cair: penghasilan = harga jual × rasio pencairan toko
      // (perkiraan), ditandai "≈" dan pill "Belum cair" supaya jelas bukan angka final.
      const approx = it.perkiraan ? '≈ ' : '';
      const selDanaCair = it.perkiraan
        ? `<span class="pill pill-abu" title="Dana pesanan ini belum dilepas Shopee — penghasilan & untungnya masih perkiraan.">Belum cair</span>`
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

  // Field lain dari server (rasioPencairan, biayaPenjual, sheetTerbaca) tidak berubah
  // karena HPP — dipertahankan lewat spread.
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

// Gabungkan daftar HPP yang sudah tersimpan dengan produk-produk yang muncul di file
// yang baru diunggah tapi belum punya HPP — supaya semuanya kelihatan & bisa diisi di sini juga,
// tidak perlu ketik ulang ID Produk secara manual.
// Total penjualan per produk dari file yang sedang diunggah (pcs & penghasilan, tanpa
// baris yang dikembalikan). Dipakai untuk mengurutkan daftar "Belum Diisi" supaya
// produk yang paling banyak menghasilkan uang ada di atas — itulah yang paling penting
// diisi HPP-nya dulu. Dihitung sekali per unggahan.
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
    `<strong>${belum.length} produk</strong> yang terjual di periode ini belum ada HPP — nilai penjualannya ` +
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
let filterIklan = 'semua';  // 'semua' | zona vonis: 'untung' | 'abu' | 'rugi' | 'jeda' | 'tunggu' | 'isi-hpp'
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

// Tanggal dana dilepaskan paling akhir di file Income — sampai tanggal itu pesanan sudah
// pasti cair; dipakai server untuk tahu periode kampanye mana yang sudah bisa diukur.
// Tanggal pertama periode data penjualan yang dipakai Analisis Iklan — kampanye yang mulai
// sebelum ini tidak bisa diukur batas pesanan dibayarnya (analisisIklan.js).
function tanggalDataMulaiSaatIni() {
  const s = sumberIklan();
  return (s && s.ringkasan && s.ringkasan.periode && s.ringkasan.periode.dari) || '';
}

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

// Data iklan otomatis: server menyusun kampanye dari hasil sinkron Shopee Ads API (90 hari
// terakhir, sama dengan data penjualan halaman ini) lalu menghitung dengan rumus yang sama
// seperti file CSV. File unggahan (cadangan) menggantikannya sampai halaman dimuat ulang.
const statusIklanShopee = document.getElementById('statusIklanShopee');
const waktuSingkat = (iso) => new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
function teksStatusIklan(body) {
  const st = body.statusIklan || {};
  const gagal = st.status === 'gagal' ? ` <span class="teks-merah">Sinkron iklan terakhir gagal: ${escapeHtml(st.pesan || '')}</span>` : '';
  if (body.kosong) {
    return (st.status === 'gagal' ? 'Data iklan belum bisa diambil dari Shopee.' : 'Data iklan belum ada — diambil otomatis saat sinkron berikutnya (tiap 30 menit, atau tombol "Sinkron Sekarang" di Kalkulator Margin).') + gagal;
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
const tambahHari = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const seninIso = (iso) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return null; const d = new Date(iso + 'T00:00:00Z'); const geser = (d.getUTCDay() + 6) % 7; return tambahHari(iso, -geser); };
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
        const h = tambahHari(k.tanggalMulaiIso, i);
        const t = ambil(seninIso(h));
        t.biayaIklan += perHari; t.pcsIklan += pcsPerHari; t.adaIklan = true;
      }
      if (!iklanMulai || k.tanggalMulaiIso < iklanMulai) iklanMulai = k.tanggalMulaiIso;
      if (akhir > iklanSelesai) iklanSelesai = akhir;
    }
  }
  if (dataIklan && dataIklan.rentangData) { iklanMulai = dataIklan.rentangData.dari; iklanSelesai = dataIklan.rentangData.sampai; }
  const batasLengkap = tambahHari(hariIniWib(), -JEDA_LENGKAP_HARI);
  // Minggu yang terpotong awal data (periode halaman, atau pesanan tersimpan paling awal) tidak lengkap.
  const awalData = [tanggalDataMulaiSaatIni(), minPesanan].filter(Boolean).sort().pop() || minRilis;
  const daftar = [...minggu.values()].sort((a, b) => a.mulai.localeCompare(b.mulai)).map((t) => {
    const selesai = tambahHari(t.mulai, 6);
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
function aturanMingguan(data) {
  const lengkap = data.minggu.filter((t) => t.lengkap && t.iklanLengkap);
  if (lengkap.length < 4) return { kelas: '', teks: 'Perlu minimal 4 minggu data lengkap (Income + iklan) untuk menilai.', detail: '' };
  const n = Math.min(4, Math.floor(lengkap.length / 2));
  const akhir = lengkap.slice(-n), awal = lengkap.slice(-2 * n, -n);
  const dibandingkan = [...awal, ...akhir];
  if (dibandingkan.some((t, i) => i > 0 && t.mulai !== tambahHari(dibandingkan[i - 1].mulai, 7))) {
    return { kelas: '', teks: 'Ada minggu yang datanya belum lengkap — periksa sinkron sebelum mengubah modal.', detail: '' };
  }
  const jml = (arr, f) => arr.reduce((a, t) => a + t[f], 0);
  const iklanA = jml(awal, 'biayaIklan'), iklanB = jml(akhir, 'biayaIklan');
  const untungA = jml(awal, 'untungSetelahIklan'), untungB = jml(akhir, 'untungSetelahIklan');
  const pctIklan = iklanA ? (iklanB - iklanA) / iklanA : 0;
  const pctUntung = untungA ? (untungB - untungA) / Math.abs(untungA) : 0;
  const detail = `${n} minggu terakhir vs ${n} minggu sebelumnya: biaya iklan ${pctIklan >= 0 ? '+' : ''}${Math.round(pctIklan * 100)}%, untung setelah iklan ${pctUntung >= 0 ? '+' : ''}${Math.round(pctUntung * 100)}%.`;
  if (pctIklan >= 0.1 && untungB <= untungA) return { kelas: 'aturan-kurangi', teks: 'Iklan naik, untung tidak naik → jangan tambah Modal Harian dulu.', detail };
  if (pctIklan <= -0.1 && untungB >= untungA * 0.95) return { kelas: 'aturan-aman', teks: 'Iklan dikurangi, untung tidak turun → pertahankan.', detail };
  if (untungB > untungA && pctIklan >= 0.1) return { kelas: 'aturan-aman', teks: 'Iklan naik dan untung ikut naik → pertahankan.', detail };
  if (pctUntung <= -0.15) return { kelas: '', teks: 'Untung turun → cek iklan, harga, stok, dan retur.', detail };
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
    if (t.untungSetelahIklan !== null) isi += `<rect class="${t.untungSetelahIklan >= 0 ? 'batang-untung' : 'batang-rugi'}${kelasBelum}" x="${xU}" y="${yU}" width="${lebar}" height="${Math.max(hU, 1)}" rx="2"/>`;
    isi += `<rect class="batang-iklan${kelasBelum}" x="${xI}" y="${nol - hI}" width="${lebar}" height="${Math.max(hI, 1)}" rx="2"/>`;
    isi += `<text class="nilai" x="${x + lebarSlot / 2}" y="${(t.untungSetelahIklan >= 0 ? yU : nol + hU) + (t.untungSetelahIklan >= 0 ? -4 : 12)}" text-anchor="middle">${t.untungSetelahIklan === null ? '?' : escapeHtml(formatRupiahRingkas(t.untungSetelahIklan).replace('Rp ', ''))}</text>`;
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
    aturanEl.innerHTML = 'Buka Kalkulator Margin (data penjualan) untuk melihat apakah anggaran iklan perlu diubah.';
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
    klaim = `<small class="klaim-iklan">Rasio pcs atribusi iklan terhadap pcs toko <strong>${pct(akhir)}</strong> minggu ${labelMinggu(akhir.mulai)}–${labelMinggu(akhir.selesai)} (awal periode ${pct(awal)}). Ini bukan ukuran tambahan penjualan. Uji pengurangan iklan untuk menilai dampaknya.</small>`;
  }
  aturanEl.innerHTML = `<span>${escapeHtml(aturan.teks)}</span>` +
    (aturan.detail ? `<small>${escapeHtml(aturan.detail)}</small>` : '') + klaim;
  grafik.innerHTML = grafikMingguanSvg(tampil);
  const lengkapTerakhir = [...data.minggu].reverse().find((t) => t.lengkap);
  isi.innerHTML = tampil.map((t) => {
    const belum = !t.lengkap || !t.iklanLengkap;
    const kelas = (belum ? 'minggu-belum' : '') + (lengkapTerakhir && t.mulai === lengkapTerakhir.mulai ? ' minggu-terakhir' : '');
    const iklan = !dataIklan ? '<span class="teks-redup">-</span>' : t.iklanLengkap ? formatRupiah(t.biayaIklan) : `<span title="Di luar periode data iklan">${formatRupiah(t.biayaIklan)}*</span>`;
    return `<tr class="${kelas.trim()}">
      <td data-label="Minggu">${labelMinggu(t.mulai)} – ${labelMinggu(t.selesai)}${belum ? ' <span class="pill pill-abu">belum lengkap</span>' : ''}</td>
      <td class="kolom-angka" data-label="Terjual">${t.adaIncome ? `${t.pcs} pcs` : 'Data belum lengkap'}</td>
      <td class="kolom-angka" data-label="Untung Kotor">${t.untungKotor === null ? '—' : formatRupiah(t.untungKotor)}</td>
      <td class="kolom-angka" data-label="Biaya Iklan">${iklan}</td>
      <td class="kolom-angka ${t.untungSetelahIklan === null ? 'teks-redup' : t.untungSetelahIklan >= 0 ? 'untung-positif' : 'untung-negatif'}" data-label="Untung Setelah Iklan">${t.untungSetelahIklan === null ? '—' : formatRupiah(t.untungSetelahIklan)}</td>
      <td class="kolom-angka" data-label="Diklaim Iklan">${t.klaimIklan === null ? '<span class="teks-redup">-</span>' : `${Math.round(t.klaimIklan * 100)}%`}</td>
    </tr>`;
  }).join('');
  catatan.textContent = `Minggu Senin–Minggu menurut tanggal pesanan. "Belum lengkap" = minggu yang belum lewat ${JEDA_LENGKAP_HARI} hari (pesanan masih bisa batal) atau terpotong awal data. Pesanan yang dananya belum cair dihitung dengan perkiraan. Untung kotor untuk produk tanpa HPP diperkirakan dari margin produk lain minggu itu. "Diklaim iklan" = pcs yang Shopee catat sebagai hasil iklan (termasuk produk lain & pesanan batal) dibanding pcs yang benar-benar dibayar.`;
  catatan.textContent += ' Minggu tanpa baris pesanan tetap menampilkan biaya iklan; untung belum diketahui (?).';
  return { data, lengkapTerakhir };
}

function renderRingkasanIklan(r) {
  const rasioPersen = (r.rasioPencairan * 100).toFixed(1).replace('.', ',');
  const catatan = document.getElementById('catatanRasioIklan');
  const periode = dataIklan.periode ? `${dariApi() ? 'Data iklan' : 'Periode file'}: <strong>${escapeHtml(dataIklan.periode)}</strong> · ${r.jumlahKampanye} kampanye, ${r.jumlahProduk} produk. ` : '';
  const cairPersen = Math.round((r.tingkatCair ?? 0.85) * 100);
  const sumberCair = {
    pengaturan: ' — angka yang diisi sendiri di bagian "Semua produk &amp; rincian".',
    terukur: ' — diukur dari status pesanan Shopee toko ini (90–14 hari lalu); tiap produk memakai angkanya sendiri kalau pesanannya cukup.',
  }[dataIklan.sumberTingkatCair] || ' — angka standar, bisa diubah di bagian "Semua produk &amp; rincian".';
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
    ketModal.textContent = dariApi()
      ? (kep.baris.length ? 'Anggaran iklan tanpa batas di Seller Centre' : 'Tidak ada iklan yang sedang berjalan') + ` · biaya ${formatRupiahRingkas(r.totalBiaya)} dalam 90 hari`
      : `Isi Modal Harian tiap iklan di tabel bawah · biaya ${formatRupiahRingkas(r.totalBiaya)} dalam periode file`;
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
    ketUntung.textContent = 'Setelah biaya iklan · buka Kalkulator Margin untuk memuat data';
  }

  const hitung = (k) => kep.baris.filter((b) => b.keputusan === k).length;
  const perluTindakan = kep.baris.filter((b) => PERLU_TINDAKAN.has(b.keputusan)).length;
  document.getElementById('iklanRugi').textContent = `${perluTindakan} iklan`;
  document.getElementById('iklanKetRugi').innerHTML =
    [['tambah', 'titik-hijau', 'tambah modal'], ['naikkan', 'titik-biru', 'naikkan target'], ['turunkan', 'titik-kuning', 'target terlalu tinggi'],
      ['kurangi', 'titik-oranye-tua', 'kurangi modal'], ['jeda', 'titik-merah', 'jeda'], ['lanjut', 'titik-hijau', 'biarkan'], ['tunggu', 'titik-abu', 'tunggu']]
      .filter(([k]) => hitung(k)).map(([k, titik, teks]) => `<span class="titik ${titik}"></span>${hitung(k)} ${teks}`).join(' · ') || '-';
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
  if (p.aksi === 'untung') return 'baris-untung';
  if (p.aksi === 'abu') return 'baris-ragu';
  if (p.aksi === 'rugi') return 'baris-kurangi';
  if (p.aksi === 'tunggu' || p.aksi === 'toko') return '';
  return 'baris-rugi'; // jeda
}
const LABEL_AKSI = { 'isi-hpp': ['Isi HPP dulu', 'pill-kuning'], jeda: ['Jeda', 'pill-merah'], rugi: ['Rugi', 'pill-oranye'], abu: ['Belum tentu', 'pill-biru'], untung: ['Untung', 'pill-hijau'], tunggu: ['Tunggu', 'pill-abu'], toko: ['Iklan toko', 'pill-abu'] };

// Satu baris produk di tabel sederhana + (kalau dibuka) baris rincian di bawahnya.
function barisProdukIklan(p, kampanyePerProduk) {
  const terbuka = produkTerbuka.has(p.idProduk);
  const [labelAksi, pillAksi] = LABEL_AKSI[p.aksi] || ['-', 'pill-abu'];
  const kelasTindakan = p.aksi === 'untung' ? 'tindakan-untung' : p.aksi === 'isi-hpp' ? 'tindakan-hpp' : p.aksi === 'jeda' ? 'tindakan-rugi' : '';
  const hppTampil = p.hpp === null ? 'belum diisi' : formatRupiah(p.hpp);

  const warnaUntung = (v) => (v >= 0 ? 'untung-positif' : 'untung-negatif');
  const untungTampil = p.untungLangsung === null
    ? '<span class="teks-redup" title="Belum bisa dihitung — HPP produk ini belum diisi">-</span>'
    : `<div class="untung-dua" title="Atas: hitungan Shopee (termasuk produk lain yang ikut terbeli). Bawah: hanya produk ini.">
         <span class="${warnaUntung(p.untungLuas)}"><small>Shopee</small>${formatRupiahRingkas(p.untungLuas)}</span>
         <span class="${warnaUntung(p.untungLangsung)}"><small>ketat</small>${formatRupiahRingkas(p.untungLangsung)}</span>
       </div>`;

  // ROAS langsung minimum (impas). Untuk "jeda"/iklan toko tidak relevan (—).
  let saranTarget = '-';
  if (p.aksi === 'jeda' || p.aksi === 'toko') saranTarget = '<span class="teks-redup">—</span>';
  else if (p.roasImpas !== null) saranTarget = `<strong>${formatRoas(p.roasImpas)}</strong>`;

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
      <td class="kolom-angka" data-label="ROAS Minimum">${saranTarget}</td>
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
  const cairPersen = Math.round(((dataIklan && dataIklan.ringkasan.tingkatCair) ?? 0.85) * 100);
  const dibayar = !p.kampanyeTerukur
    ? [`≈ ${cairPersen}%`, 'perkiraan (belum ada kampanye yang bisa diukur dari data penjualan)']
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
    ${kotak('Harga jual per pcs', formatRupiahRingkas(p.hargaRata), `HPP ${escapeHtml(hppTampil)} · ${p.sumberHarga === 'income' ? 'dari data penjualan' : p.sumberHarga === 'langsung' ? 'dari penjualan langsung iklan' : 'perkiraan dari omzet Shopee'}`)}
    ${kotak('Potongan Shopee', p.rasioPencairan ? formatPersen((1 - p.rasioPencairan) * 100) : '-', p.sumberHarga === 'income' ? 'produk ini, dari data penjualan' : 'rata-rata toko')}
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
        <td class="kolom-angka" title="${k.capTerukur ? 'Terukur: semua pesanan produk ini di data penjualan pada periode kampanye + 7 hari' : 'Perkiraan dari tingkat pesanan dibayar toko'}">${k.capTerukur ? `≤ ${k.pesananDibayarMaks} / ${k.terjualLangsung}` : `<span class="teks-redup">~${cairPersen}%</span>`}</td>
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
// Tujuan: untung toko per minggu setelah iklan (keputusan pengguna 2026-09-26). Zona per produk
// dari analisisIklan.js (vonis), lalu SATU perubahan per iklan per minggu, bertahap:
//   zona 'untung' → 'tambah'  : Modal Harian +20% kalau modalnya hampir selalu habis (≥ 90%
//                               rata-rata 7 hari) dan untung toko mingguan tidak sedang turun
//                               sementara iklan naik; kalau tidak → 'lanjut'.
//   zona 'abu'/'rugi' → 'naikkan' : Target ROAS +20% (panduan Shopee: ≤ 20% per perubahan),
//                               paling tinggi batas Shopee (rekomendasi tertinggi × 1,25).
//                   → di/atas batas: 'rugi' → 'kurangi' (Modal Harian −50%; target jangan naik lagi);
//                     'abu' di atas batas → 'turunkan' (≤ 20% per langkah, sampai batas); di batas → 'lanjut'.
//   'tunggu'  : tahap belajar 7 hari, atau Target/Modal baru diubah < 7 hari lalu.
//   'jeda'    : harga di bawah modal / 0% pesanan dibayar (vonis 'jeda').
//   'isi-hpp' / 'toko' : belum bisa dinilai / iklan level toko.
// Angka ROAS/untung diambil dari kampanye yang sedang berjalan (p.berjalan).
const bulatkanModal = (rp) => Math.max(0, Math.round(rp / 5000) * 5000);
const bulatkanTargetBawah = (n) => Math.floor(n * 10 + 1e-9) / 10; // 10,78 → 10,7: tidak lewat batas
const LANGKAH_TARGET = 1.2;       // naik 20% per langkah (FAQ GMV Max Shopee: ≤ 20% sekali ubah)
const LANGKAH_MODAL = 1.2;        // tambah modal 20% per langkah (percobaan toko, bukan aturan Shopee)
const MODAL_HABIS = 0.9;          // rata-rata biaya ≥ 90% Modal Harian = iklan dibatasi modal
const HARI_TUNGGU_UBAH = 7;       // setelah Target/Modal diubah, tunggu 7 hari sebelum dinilai lagi
const PERLU_TINDAKAN = new Set(['jeda', 'kurangi', 'naikkan', 'turunkan', 'tambah', 'isi-hpp']);
const metrikBerjalan = (p) => p.berjalan || p;
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

// Rata-rata biaya per hari selama 7 hari penuh terakhir (tanpa hari ini) ÷ Modal Harian.
function pemakaianModal(idProduk, modal) {
  if (!dariApi() || !modal) return null;
  const harian = harianProduk(idProduk);
  const hariIni = hariIniWib();
  let biaya = 0;
  for (let i = 1; i <= 7; i++) biaya += (harian[geserHari(hariIni, -i)] || {}).biaya || 0;
  return biaya / 7 / modal;
}

function keputusanBerjalan() {
  const baris = [];
  if (!dataIklan) return { baris, modalSekarang: 0, modalSaran: null, belumDiisi: 0 };
  const berjalan = dataIklan.produk.filter((p) => p.sedangBerjalan > 0);
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
    let keputusan = 'lanjut', modalBaru = modal, targetBaru = null, alasan = '';
    const zonaIklan = ['untung', 'abu', 'rugi'].includes(p.aksi);
    if (p.aksi === 'isi-hpp') keputusan = 'isi-hpp';
    else if (p.aksi === 'toko') keputusan = 'toko';
    else if (p.aksi === 'tunggu') keputusan = 'tunggu';
    else if (p.aksi === 'jeda') { keputusan = 'jeda'; modalBaru = 0; }
    else if (zonaIklan && baruDiubah) { keputusan = 'tunggu'; alasan = 'baru-diubah'; }
    else if (p.aksi === 'untung') {
      const pakai = pemakaianModal(p.idProduk, modal);
      if (pakai !== null && pakai >= MODAL_HABIS && !tokoTurun) { keputusan = 'tambah'; modalBaru = bulatkanModal(modal * LANGKAH_MODAL); }
      else alasan = pakai !== null && pakai >= MODAL_HABIS ? 'toko-turun' : '';
    } else {
      // Zona abu-abu / rugi: naikkan target bertahap; di batas Shopee, rugi → kurangi modal.
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
      } else if (dasar !== null) {
        targetBaru = bulatkanTargetBawah(dasar * LANGKAH_TARGET);
        if (batasShopee !== null && targetBaru >= batasShopee) { targetBaru = batasShopee; alasan = 'ke-batas'; }
        keputusan = 'naikkan';
      }
    }
    if (modal !== null) { modalSekarang += modal; adaModal = true; modalSaran += modalBaru !== null ? modalBaru : modal; }
    else if (!tanpaBatas && p.aksi !== 'toko') belumDiisi += 1; // iklan toko tidak punya modal harian sendiri
    baris.push({ p, target, modal, minimal: p.targetDisarankan, keputusan, modalBaru, targetBaru, alasan, tanpaBatas, modeAuto,
      rekomendasi: st.rekomendasi || null, batasShopee, perubahan, bisaDiubahLagi, berakhir: berakhirSegera(p.idProduk) });
  }
  const urutan = { jeda: 0, kurangi: 1, turunkan: 2, naikkan: 3, tambah: 4, 'isi-hpp': 5, tunggu: 6, lanjut: 7, toko: 8 };
  baris.sort((a, b) => urutan[a.keputusan] - urutan[b.keputusan] || b.p.biaya - a.p.biaya);
  return { baris, modalSekarang, modalSaran: adaModal ? modalSaran : null, belumDiisi, tokoTurun };
}

const LABEL_KEPUTUSAN = {
  'isi-hpp': ['Isi HPP dulu', 'pill-kuning', 'baris-peringatan'],
  jeda: ['Jeda', 'pill-merah', 'baris-rugi'],
  turunkan: ['Target terlalu tinggi', 'pill-kuning', 'baris-peringatan'],
  naikkan: ['Naikkan target', 'pill-biru', 'baris-ragu'],
  kurangi: ['Kurangi modal', 'pill-oranye', 'baris-kurangi'],
  tambah: ['Tambah modal', 'pill-hijau', 'baris-untung'],
  tunggu: ['Tunggu', 'pill-abu', ''],
  lanjut: ['Biarkan', 'pill-hijau', 'baris-untung'],
  toko: ['Iklan toko', 'pill-abu', ''],
};

// Catatan kecil di bawah kalimat keputusan: iklan yang segera berakhir, dan target yang sudah
// di atas batas Shopee (iklan jadi jarang tayang).
function catatanKeputusanTeks(b) {
  const f = formatRoas;
  const catatan = [];
  if (b.berakhir && b.keputusan !== 'jeda') {
    catatan.push(`Berakhir ${tanggalSingkat(b.berakhir)} — ubah Periode jadi Tidak Terbatas; jangan buat iklan baru.`);
  }
  if (b.alasan === 'di-atas-batas') {
    catatan.push(`Target ${f(b.target)} sudah di atas batas Shopee (${f(b.batasShopee)}). Jangan dinaikkan lagi; iklan jadi jarang tayang.`);
  }
  if (b.alasan === 'ke-batas' || b.alasan === 'di-batas') {
    catatan.push(`${f(b.batasShopee)} = target tertinggi. Lebih tinggi dari ini iklan hampir tidak tayang (Shopee menyarankan paling tinggi ${f(b.rekomendasi.tinggi)}).`);
  }
  if (b.keputusan === 'turunkan') {
    catatan.push(`Batas tertinggi ${f(b.batasShopee)} (Shopee menyarankan paling tinggi ${f(b.rekomendasi.tinggi)}). Di atasnya iklan hampir tidak tayang.`);
  }
  if (b.keputusan === 'lanjut' && b.target !== null && b.batasShopee !== null && b.target > b.batasShopee + 0.05) {
    catatan.push(`Target ${f(b.target)} di atas batas Shopee (${f(b.batasShopee)}) — iklan bisa jarang tayang.`);
  }
  return catatan;
}
function catatanKeputusan(b) {
  return catatanKeputusanTeks(b).map((t) => `<small class="catatan-keputusan">${escapeHtml(t)}</small>`).join('');
}

const rupiahPendek = (n) => formatRupiahRingkas(n).replace('Rp ', '');
function kalimatKeputusan(b) {
  const f = formatRoas;
  switch (b.keputusan) {
    case 'isi-hpp': return 'Isi HPP di Kalkulator Margin.';
    case 'jeda': case 'toko': return b.p.tindakan;
    case 'tunggu': return b.alasan === 'baru-diubah'
      ? `Baru diubah ${tanggalSingkat(b.perubahan.tanggal)} — jangan diubah sampai ${tanggalSingkat(b.bisaDiubahLagi)}.`
      : b.p.tindakan;
    case 'naikkan': return b.target === null
      ? `Ganti ke GMV Max ROAS, target ${f(b.targetBaru)}.`
      : `Ubah Target ROAS ${f(b.target)} → ${f(b.targetBaru)}.`;
    case 'turunkan': return `Target ${f(b.target)} terlalu tinggi. Ubah Target ROAS ke ${f(b.targetBaru)}.`;
    case 'kurangi': return b.modal !== null
      ? `Turunkan Modal Harian ${rupiahPendek(b.modal)} → ${rupiahPendek(b.modalBaru)}. Target tetap.`
      : 'Batasi Modal Harian (sekarang tanpa batas). Target tetap.';
    case 'tambah': return `Naikkan Modal Harian ${rupiahPendek(b.modal)} → ${rupiahPendek(b.modalBaru)}. Target tetap.`;
    default:
      if (b.alasan === 'toko-turun') return 'Biarkan. Untung toko belum naik — jangan tambah modal dulu.';
      if (b.alasan === 'di-batas' || b.alasan === 'di-atas-batas') return 'Biarkan. Target sudah di batas tertinggi.';
      return 'Tidak ada yang perlu diubah.';
  }
}

// Alasan satu kalimat untuk kartu Tugas Minggu Ini (orang tua): kenapa perubahan ini.
function alasanTugas(b) {
  switch (b.keputusan) {
    case 'tambah': return 'Iklan untung dan modalnya hampir selalu habis.';
    case 'naikkan': return b.p.aksi === 'rugi' ? 'Iklan masih rugi. Naikkan sedikit dulu, jangan dimatikan.' : 'Belum tentu untung. Naikkan sedikit supaya lebih hemat.';
    case 'turunkan': return 'Iklan jadi jarang tayang.';
    case 'kurangi': return 'Masih rugi, dan target tidak bisa dinaikkan lagi.';
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
  document.getElementById('ketTabelKeputusan').innerHTML = dariApi()
    ? '<strong>Modal Harian</strong> dan <strong>Target ROAS</strong> diambil otomatis dari Seller Centre. Klik baris untuk rincian.'
    : 'Isi <strong>Modal Harian</strong> dan <strong>Target ROAS</strong> yang sekarang terpasang di Seller Centre (sekali saja, disimpan). Klik baris untuk rincian.';

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

  const kampanyePerProduk = new Map();
  for (const k of dataIklan.kampanye) {
    if (!kampanyePerProduk.has(k.kodeProduk)) kampanyePerProduk.set(k.kodeProduk, []);
    kampanyePerProduk.get(k.kodeProduk).push(k);
  }

  isi.innerHTML = kep.baris.map((b) => {
    const p = b.p;
    const [label, pill, kelasBaris] = LABEL_KEPUTUSAN[b.keputusan];
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
  const perluUbah = (items) => items.filter((p) => ['jeda', 'rugi', 'abu'].includes(p.aksi)).length;
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
      ? grup('Sedang berjalan', 'grup-berjalan', berjalan, perluUbah(berjalan) ? `${perluUbah(berjalan)} belum tentu untung` : 'semua untung', false, true)
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

// ====== Tugas Minggu Ini (Dashboard) ======
// Untuk orang tua: untung toko setelah iklan di atas, lalu satu kartu per iklan yang perlu diubah
// di Seller Centre (dari keputusanBerjalan), iklan yang baru diubah (tunggu 7 hari), dan hasil
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

// Untung iklan satu produk per hari (hanya produk itu: omzet langsung × dibayar × margin − biaya),
// rata-rata di [dari, sampai]. null kalau tidak ada angka harian.
function untungIklanPerHari(p, dari, sampai) {
  if (p.marginPerRp === null || p.marginPerRp === undefined) return null;
  const harian = harianProduk(p.idProduk);
  let total = 0, hari = 0;
  for (let iso = dari; iso <= sampai; iso = geserHari(iso, 1)) {
    const v = harian[iso] || { biaya: 0, omzetLangsung: 0 };
    total += v.omzetLangsung * p.tingkatCair * p.marginPerRp - v.biaya;
    hari += 1;
  }
  return hari ? total / hari : null;
}

// "Target 9 → 10,8 · Modal 60 rb → 75 rb"
function teksPerubahan(u) {
  const f = formatRoas;
  const bagian = [];
  if ((u.targetLama || null) !== (u.targetBaru || null)) bagian.push(`Target ${u.targetLama ? f(u.targetLama) : 'Auto'} → ${u.targetBaru ? f(u.targetBaru) : 'Auto'}`);
  if ((u.modalLama || null) !== (u.modalBaru || null)) bagian.push(`Modal ${u.modalLama ? rupiahPendek(u.modalLama) : 'tanpa batas'} → ${u.modalBaru ? rupiahPendek(u.modalBaru) : 'tanpa batas'}`);
  return bagian.join(' · ') || 'Setelan diubah';
}

function kartuTugas(b) {
  const [label, pill] = LABEL_KEPUTUSAN[b.keputusan];
  const catatan = catatanKeputusanTeks(b).map((t) => `<small class="tugas-catatan">${escapeHtml(t)}</small>`).join('');
  const alasan = alasanTugas(b);
  return `<div class="tugas-item">
      <div class="tugas-atas"><span class="tugas-nama" title="${escapeHtml(b.p.namaProduk)}">${escapeHtml(namaSingkat(b.p.namaProduk, 40))}</span><span class="pill ${pill}">${escapeHtml(label)}</span></div>
      <div class="tugas-aksi">${escapeHtml(kalimatKeputusan(b))}</div>
      ${alasan ? `<small class="tugas-alasan">${escapeHtml(alasan)}</small>` : ''}${catatan}
    </div>`;
}

function renderTugas() {
  const untungEl = document.getElementById('tugasUntung');
  const daftarEl = document.getElementById('tugasDaftar');
  const lainEl = document.getElementById('tugasLain');
  const hasilEl = document.getElementById('tugasHasil');
  document.getElementById('tugasTanggal').textContent = formatTanggalPendek(hariIniWib());

  // 1. Untung toko: minggu lengkap terakhir + bulan ini vs bulan lalu.
  const mingguan = untungTokoPerMinggu();
  const lengkap = mingguan ? mingguan.minggu.filter((t) => t.lengkap && t.untungSetelahIklan !== null) : [];
  const perBulan = untungTokoPerBulan();
  if (lengkap.length) {
    const akhir = lengkap[lengkap.length - 1], sebelum = lengkap[lengkap.length - 2];
    const selisih = sebelum ? akhir.untungSetelahIklan - sebelum.untungSetelahIklan : null;
    const hariIni = hariIniWib(), bulanIni = hariIni.slice(0, 7);
    const bulanLalu = geserHari(`${bulanIni}-01`, -1).slice(0, 7);
    const namaBulan = (k) => new Date(`${k}-01T00:00:00`).toLocaleDateString('id-ID', { month: 'long' });
    const bIni = perBulan && perBulan.get(bulanIni), bLalu = perBulan && perBulan.get(bulanLalu);
    const baris = bIni && bIni.untungSetelahIklan !== null
      ? `<div class="tugas-bulan">${namaBulan(bulanIni)} sampai hari ini: <strong>${formatRupiahRingkas(bIni.untungSetelahIklan)}</strong>` +
        (bLalu && bLalu.untungSetelahIklan !== null ? ` · ${namaBulan(bulanLalu)}: ${formatRupiahRingkas(bLalu.untungSetelahIklan)}` : '') + '</div>'
      : '';
    untungEl.innerHTML = `<div class="label-ringkasan">Untung toko minggu ${labelMinggu(akhir.mulai)}–${labelMinggu(akhir.selesai)} (setelah iklan)</div>
      <div class="angka-ringkasan${akhir.untungSetelahIklan < 0 ? ' angka-negatif' : ''}">${formatRupiah(akhir.untungSetelahIklan)}</div>
      ${selisih !== null ? `<div class="tugas-selisih ${selisih >= 0 ? 'untung-positif' : 'untung-negatif'}">${selisih >= 0 ? 'Naik' : 'Turun'} ${formatRupiahRingkas(Math.abs(selisih))} dari minggu sebelumnya</div>` : ''}
      ${baris}`;
  } else {
    untungEl.innerHTML = '<div class="keterangan">Untung toko muncul setelah data penjualan dan iklan termuat.</div>';
  }

  // 2. Yang perlu diubah di Seller Centre.
  if (!dataIklan) { daftarEl.innerHTML = '<p class="keterangan">Memuat data iklan...</p>'; lainEl.innerHTML = ''; hasilEl.innerHTML = ''; return; }
  const kep = keputusanBerjalan();
  const tugas = kep.baris.filter((b) => PERLU_TINDAKAN.has(b.keputusan));
  daftarEl.innerHTML = tugas.length
    ? `<p class="tugas-judul">${tugas.length} hal yang perlu diubah di Seller Centre</p>` + tugas.map(kartuTugas).join('')
    : '<p class="tugas-judul">Tidak ada yang perlu diubah minggu ini.</p>';

  // 3. Iklan lain: baru diubah (tunggu) dan yang dibiarkan.
  const baruDiubah = kep.baris.filter((b) => b.alasan === 'baru-diubah');
  const dibiarkan = kep.baris.filter((b) => !PERLU_TINDAKAN.has(b.keputusan) && b.alasan !== 'baru-diubah' && b.keputusan !== 'toko');
  let lain = '';
  if (baruDiubah.length) {
    lain += `<p class="tugas-judul-kecil">Sudah diubah — tunggu 7 hari</p><ul class="tugas-baris">` + baruDiubah.map((b) =>
      `<li><span>${escapeHtml(namaSingkat(b.p.namaProduk, 32))}</span><small>${escapeHtml(teksPerubahan(b.perubahan))} · ${tanggalSingkat(b.perubahan.tanggal)} · cek lagi ${tanggalSingkat(b.bisaDiubahLagi)}</small></li>`).join('') + '</ul>';
  }
  if (dibiarkan.length) {
    lain += `<p class="tugas-judul-kecil">Jangan diubah minggu ini (${dibiarkan.length} iklan)</p><ul class="tugas-baris">` + dibiarkan.map((b) =>
      `<li><span>${escapeHtml(namaSingkat(b.p.namaProduk, 32))}</span><small>${escapeHtml(kalimatKeputusan(b))}</small></li>`).join('') + '</ul>';
  }
  lainEl.innerHTML = lain;

  // 4. Hasil perubahan 7–28 hari lalu: untung iklan per hari 7 hari sebelum vs sesudah diubah.
  const kemarin = geserHari(hariIniWib(), -1);
  const hasil = kep.baris.filter((b) => b.perubahan && b.alasan !== 'baru-diubah' && b.bisaDiubahLagi <= hariIniWib()).map((b) => {
    const t = b.perubahan.tanggal;
    const sebelum = untungIklanPerHari(b.p, geserHari(t, -7), geserHari(t, -1));
    const akhir = geserHari(t, 7) < kemarin ? geserHari(t, 7) : kemarin;
    const sesudah = untungIklanPerHari(b.p, geserHari(t, 1), akhir);
    return { b, sebelum, sesudah };
  }).filter((h) => h.sebelum !== null && h.sesudah !== null);
  hasilEl.innerHTML = hasil.length
    ? `<p class="tugas-judul-kecil">Hasil perubahan sebelumnya (untung iklan per hari, hanya produk itu)</p><ul class="tugas-baris">` + hasil.map(({ b, sebelum, sesudah }) => {
      const naik = sesudah > sebelum;
      return `<li><span>${escapeHtml(namaSingkat(b.p.namaProduk, 32))}</span><small>${escapeHtml(teksPerubahan(b.perubahan))} (${tanggalSingkat(b.perubahan.tanggal)}): ${escapeHtml(formatRupiahRingkas(sebelum))} → <strong class="${naik ? 'untung-positif' : 'untung-negatif'}">${escapeHtml(formatRupiahRingkas(sesudah))}</strong> per hari</small></li>`;
    }).join('') + '</ul>'
    : '';
}

// ====== Mulai ======
cekSesi();
