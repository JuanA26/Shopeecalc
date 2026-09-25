// Analisis Iklan: baca file CSV "Data Keseluruhan Iklan" dari Seller Centre Shopee,
// lalu gabungkan dengan HPP (harga modal) supaya kelihatan iklan mana yang benar-benar
// untung dan mana yang rugi — sesuatu yang Shopee sendiri tidak bisa tunjukkan karena
// Shopee tidak tahu harga modal kita.
//
// Istilah yang dipakai di sini:
//   omzet          = "Omzet Penjualan" di file Shopee. Atribusi LUAS: semua pesanan dalam
//                    7 hari setelah klik / 1 hari setelah lihat iklan, termasuk produk LAIN
//                    yang ikut dibeli dan pesanan yang akhirnya batal/dikembalikan.
//   omzetLangsung  = "Penjualan Langsung (GMV Langsung)": hanya produk yang diiklankan itu
//                    sendiri. Angka ini yang paling jujur — dipakai untuk vonis untung/rugi.
//   roasShopee     = omzet ÷ biaya ("Efektifitas Iklan" — angka besar yang dilihat di
//                    Seller Centre). roasLangsung = omzetLangsung ÷ biaya.
//   rasioPencairan = berapa bagian dari harga jual yang benar-benar cair ke penjual setelah
//                    semua potongan Shopee (Σ Total Penghasilan ÷ Σ Harga Produk di file
//                    Income; sekitar 0,78). Kalau belum ada file Income yang diunggah, pakai
//                    RASIO_PENCAIRAN_DEFAULT dan UI menampilkan catatannya.
//   tingkatCair    = bagian pesanan iklan yang benar-benar dibayar. Shopee menghitung omzet
//                    iklan saat pesanan DIBUAT, termasuk yang lalu batal / tidak dibayar /
//                    dikembalikan (resmi: iklan.shopee.co.id/learn/faq/549/2200). Di file
//                    Income hanya ada pesanan yang cair. Dipakai dua cara: (1) angka toko
//                    (pengaturan, default TINGKAT_CAIR_DEFAULT) untuk semua kampanye, dan
//                    (2) untuk kampanye yang sudah berakhir dan dananya pasti sudah cair,
//                    batas atas yang TERUKUR: pesanan iklan yang dibayar tidak mungkin lebih
//                    dari semua pesanan produk itu di file Income pada periode kampanye.
//   hargaRata      = harga jual per pcs produk ini. Diambil (urutan prioritas) dari file Income
//                    (harga sebenarnya), lalu omzetLangsung ÷ terjualLangsung, dan baru terakhir
//                    omzet ÷ terjual. Omzet LUAS tidak boleh dipakai kalau ada pilihan lain:
//                    ia mencampur produk lain di pesanan yang sama, jadi harga produk murah
//                    kelihatan 40–65% lebih mahal dari kenyataan (diukur 2026-09-20).
//   marginPerRp    = untung bersih per Rp 1 omzet iklan = (hargaRata × rasio − HPP) ÷ hargaRata.
//   roasImpas      = 1 ÷ (marginPerRp × tingkatCair): ROAS MINIMUM — di bawah ini iklan pasti
//                    rugi bahkan kalau semua omzet iklan benar-benar tambahan. Bukan jaminan
//                    untung di atasnya, karena omzet luas Shopee juga memuat penjualan yang
//                    memang akan terjadi tanpa iklan.
//   targetDisarankan = roasImpas + 2 — angka untuk diisi di kolom "Target ROAS" Seller Centre.
//                    Praktik umum penjual (minimum + 2–4 poin, karena ROAS yang dicapai Shopee
//                    biasanya 2–4 poin di bawah target). Shopee sendiri menyarankan target dari
//                    performa kompetitor, bukan dari margin.
//
// Skala mana yang dipakai untuk vonis? Target ROAS di Seller Centre dinilai Shopee terhadap
// omzet LUAS (roasShopee; Proteksi ROAS pun memakai "Broad GMV"). Jadi target & vonis per
// produk memakai skala Shopee — sama seperti panduan penjual. Angka LANGSUNG (ketat) tetap
// ditampilkan sebagai batas bawah untung; dan vonis untuk TOKO (apakah iklan secara
// keseluruhan menguntungkan) diambil dari tren mingguan untung toko vs biaya iklan di sisi
// klien (app.js: untungTokoPerMinggu), bukan per produk.
//
// Produk yang sedang beriklan dinilai dari KAMPANYE YANG SEDANG BERJALAN saja (p.berjalan),
// bukan gabungan 3 bulan: Shopee mengulang tahap belajar tiap kampanye, jadi kampanye lama
// tidak meramalkan yang sekarang. Gabungan tetap ada untuk tabel "Semua produk".

const RASIO_PENCAIRAN_DEFAULT = 0.78;
const TINGKAT_CAIR_DEFAULT = 0.85; // 85% pesanan iklan dianggap dibayar kalau belum ada angka toko
const MARGIN_TIPIS = 0.08;          // ≤ 8% per Rp omzet: iklan tidak bisa untung di target berapa pun
const PENYANGGA_TARGET = 2;         // poin di atas ROAS minimum
const HARI_BELAJAR = 7;             // tahap belajar GMV Max: jangan diubah/dinilai sebelum 7 hari (FAQ Shopee)
const EKOR_ATRIBUSI_HARI = 7;       // pesanan sampai 7 hari setelah klik masih dihitung iklan
const JEDA_CAIR_HARI = 14;          // periode kampanye dianggap sudah cair semua ≥ 14 hari setelah akhirnya
const KODE_IKLAN_TOKO = 'iklan-toko'; // baris "Iklan Produk Otomatis" / Shop GMV Max (tanpa Kode Produk)

// Baca satu baris CSV yang mungkin berisi field bertanda kutip (koma di dalam nama
// produk yang dibungkus tanda kutip, tanda kutip ganda "" = satu tanda kutip).
function parseCsvLine(line) {
  const hasil = [];
  let field = '';
  let dalamKutip = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (dalamKutip) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { dalamKutip = false; }
      else { field += c; }
    } else if (c === '"') {
      dalamKutip = true;
    } else if (c === ',') {
      hasil.push(field);
      field = '';
    } else {
      field += c;
    }
  }
  hasil.push(field);
  return hasil;
}

// Angka di file Shopee: "12345", "12345.67", "3.67%", "-" (= nol), kadang "1,234".
function angka(teks) {
  const bersih = String(teks ?? '').replace(/%/g, '').replace(/,/g, '').trim();
  if (bersih === '' || bersih === '-') return 0;
  const n = Number(bersih);
  return Number.isFinite(n) ? n : 0;
}

// "27/08/2026 00:00:00" → { tampil: "27/08/2026", iso: "2026-08-27" }. iso dipakai untuk
// mengurutkan/membandingkan, tampil untuk ditunjukkan ke pengguna apa adanya.
function tanggalShopee(teks) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(teks ?? '').trim());
  if (!m) return { tampil: String(teks ?? '').trim(), iso: '' };
  return { tampil: `${m[1]}/${m[2]}/${m[3]}`, iso: `${m[3]}-${m[2]}-${m[1]}` };
}

const tambahHari = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const selisihHari = (isoA, isoB) => Math.round((Date.parse(isoB) - Date.parse(isoA)) / 86400000);
const isoKeTampil = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : iso);

function errorPengguna(pesan) {
  const err = new Error(pesan);
  err.userFacing = true;
  return err;
}

// Baca file CSV ekspor "Data Keseluruhan Iklan" → { kampanye: [...], periode, namaToko }.
// Format file: UTF-8 dengan BOM; 6 baris pembuka (judul, Username, Nama Toko, ID Toko, Waktu
// Laporan, Periode), baris kosong, lalu header yang diawali "Urutan,". Header dicari, bukan
// dihitung barisnya, supaya tetap jalan kalau Shopee menambah/mengurangi baris pembuka.
function parseShopeeAdsCsv(buffer) {
  const teks = buffer.toString('utf8').replace(/^﻿/, '');
  const baris = teks.split(/\r\n|\r|\n/);

  const idxHeader = baris.findIndex((b) => b.startsWith('Urutan,'));
  if (idxHeader === -1) {
    throw errorPengguna(
      'Format file tidak dikenali. Pastikan ini file CSV "Data Keseluruhan Iklan" yang diunduh ' +
      'dari Seller Centre Shopee (Iklan Shopee → Unduh Data).'
    );
  }

  // Info pembuka: "Periode,19/06/2026 - 19/09/2026", "Nama Toko,Happy Shop Bjm"
  let periode = '';
  let namaToko = '';
  let tanggalLaporanIso = ''; // "Waktu Laporan Dibuat,19/09/2026 23:02" → 2026-09-19
  for (const b of baris.slice(0, idxHeader)) {
    const kolom = parseCsvLine(b);
    const label = (kolom[0] || '').trim().toLowerCase();
    if (label === 'periode') periode = (kolom[1] || '').trim();
    if (label.startsWith('waktu laporan')) tanggalLaporanIso = tanggalShopee(kolom[1]).iso;
    if (label === 'nama toko') namaToko = (kolom[1] || '').trim();
  }

  const header = parseCsvLine(baris[idxHeader]).map((h) => h.trim());
  const idx = (nama) => header.findIndex((h) => h.toLowerCase() === nama.toLowerCase());
  const kolomWajib = {
    nama: idx('Nama Iklan'),
    status: idx('Status'),
    kode: idx('Kode Produk'),
    mode: idx('Mode Bidding'),
    mulai: idx('Tanggal Mulai'),
    selesai: idx('Tanggal Selesai'),
    dilihat: idx('Dilihat'),
    klik: idx('Jumlah Klik'),
    terjual: idx('Produk Terjual'),
    terjualLangsung: idx('Terjual Langsung'),
    omzet: idx('Omzet Penjualan'),
    omzetLangsung: idx('Penjualan Langsung (GMV Langsung)'),
    biaya: idx('Biaya'),
  };
  const hilang = Object.entries(kolomWajib).filter(([, i]) => i === -1).map(([k]) => k);
  if (hilang.length) {
    throw errorPengguna(
      'Beberapa kolom yang dibutuhkan tidak ada di file ini (' + hilang.join(', ') + '). ' +
      'Pastikan mengunduh laporan "Data Keseluruhan Iklan" tanpa mengubah kolomnya.'
    );
  }

  const kampanye = [];
  for (let i = idxHeader + 1; i < baris.length; i++) {
    if (baris[i].trim() === '') continue;
    const k = parseCsvLine(baris[i]);
    let kode = String(k[kolomWajib.kode] || '').trim();
    // Baris tanpa Kode Produk = iklan level toko ("Iklan Produk Otomatis" / Shop GMV Max).
    // Tidak bisa digabung dengan HPP, tapi biayanya tetap biaya — jadi disimpan sebagai
    // satu "produk" semu supaya total biaya & kartu mingguan tidak kehilangan uang itu.
    const tokoLevel = !kode || kode === '-';
    if (tokoLevel) kode = KODE_IKLAN_TOKO;

    const mulai = tanggalShopee(k[kolomWajib.mulai]);
    const selesai = tanggalShopee(k[kolomWajib.selesai]);
    kampanye.push({
      namaIklan: String(k[kolomWajib.nama] || '').trim(),
      status: String(k[kolomWajib.status] || '').trim(),
      kodeProduk: kode,
      tokoLevel,
      modeBidding: String(k[kolomWajib.mode] || '').trim(),
      tanggalMulai: mulai.tampil,
      tanggalMulaiIso: mulai.iso,
      tanggalSelesai: selesai.tampil,
      tanggalSelesaiIso: selesai.iso,
      dilihat: angka(k[kolomWajib.dilihat]),
      klik: angka(k[kolomWajib.klik]),
      terjual: angka(k[kolomWajib.terjual]),
      terjualLangsung: angka(k[kolomWajib.terjualLangsung]),
      omzet: angka(k[kolomWajib.omzet]),
      omzetLangsung: angka(k[kolomWajib.omzetLangsung]),
      biaya: angka(k[kolomWajib.biaya]),
    });
  }

  if (!kampanye.length) {
    throw errorPengguna('File terbaca, tapi tidak ada baris iklan di dalamnya.');
  }

  // Kalau tanggal laporan tidak ada, pakai tanggal akhir periode ("19/06/2026 - 19/09/2026").
  if (!tanggalLaporanIso) {
    const m = /-\s*(\d{2}\/\d{2}\/\d{4})\s*$/.exec(periode);
    if (m) tanggalLaporanIso = tanggalShopee(m[1]).iso;
  }
  return { kampanye, periode, namaToko, tanggalLaporanIso };
}

const bagi = (a, b) => (b ? a / b : null);

// Vonis per produk = SATU tindakan di Seller Centre, supaya orang tua tinggal mengikuti:
//   'isi-hpp'     : belum bisa dinilai, isi HPP dulu.
//   'toko'        : iklan level toko, tidak ada produknya — dinilai lewat kartu mingguan.
//   'tunggu'      : kampanye yang berjalan belum 7 hari (tahap belajar) — jangan diubah dulu.
//   'jeda'        : margin terlalu tipis (target yang dibutuhkan pasti di atas batas Shopee),
//                   atau ROAS Shopee di bawah minimum (rugi bahkan dengan angka Shopee).
//   'ubah-target' : ROAS Shopee di atas minimum tapi di bawah target (minimum + 2): isi target.
//   'biarkan'     : ROAS Shopee sudah ≥ target.
// Untuk produk yang sedang beriklan, ROAS & untung diambil dari kampanye yang berjalan saja.
// Kalimatnya SENGAJA pendek — halaman ini dibaca orang tua non-teknis.
function vonis(p) {
  const f = formatAngka;
  if (p.tokoLevel) {
    return { status: 'toko', aksi: 'toko', tindakan: 'Iklan level toko — nilai lewat kartu mingguan.' };
  }
  if (p.hpp === null) {
    return { status: 'belum-hpp', aksi: 'isi-hpp', tindakan: 'Isi HPP dulu.' };
  }
  if (p.berjalan && p.berjalan.hari < HARI_BELAJAR) {
    const sampai = isoKeTampil(tambahHari(p.berjalan.tanggalMulaiIso, HARI_BELAJAR));
    return { status: 'tunggu', aksi: 'tunggu', tindakan: `Masih belajar — cek lagi ${sampai}.` };
  }
  const m = p.berjalan || p;
  if (!p.hargaRata) {
    return {
      status: 'rugi', aksi: 'jeda',
      tindakan: m.biaya > 0 ? 'Jeda — belum ada penjualan.' : 'Belum ada biaya & penjualan.',
    };
  }
  if (p.marginPerRp <= MARGIN_TIPIS) {
    return {
      status: 'tipis', aksi: 'jeda',
      tindakan: p.marginPerRp > 0 ? `Jeda — margin cuma ${Math.round(p.marginPerRp * 100)}%.` : 'Jeda — harga di bawah modal.',
    };
  }
  if (m.roasShopee === null || m.roasShopee < p.roasImpas) {
    return { status: 'rugi', aksi: 'jeda', tindakan: `Jeda — ROAS ${f(m.roasShopee)} di bawah minimum ${f(p.roasImpas)}.` };
  }
  if (m.roasShopee < p.targetDisarankan) {
    return { status: 'ragu', aksi: 'ubah-target', tindakan: `Naikkan Target ROAS ke ${f(p.targetDisarankan)}.` };
  }
  return { status: 'untung', aksi: 'biarkan', tindakan: `Biarkan. Target jangan di bawah ${f(p.roasImpas)}.` };
}

// 4.6 → "4,6" (gaya Indonesia), untuk kalimat tindakan.
function formatAngka(n) {
  if (n === null || !Number.isFinite(n)) return '-';
  return (Math.round(n * 10) / 10).toFixed(1).replace('.', ',');
}

// Batas atas TERUKUR pesanan iklan yang dibayar, untuk satu kampanye yang periodenya sudah
// pasti cair: min(pesanan langsung menurut Shopee, semua pesanan produk itu di file Income
// dalam periode kampanye + 7 hari ekor atribusi). Pesanan yang dibayar dari iklan tidak
// mungkin melebihi keduanya. Mengembalikan null kalau tidak bisa diukur (belum cair semua,
// tidak ada data harian, kampanye masih berjalan).
function batasDibayarKampanye(k, perHari, tanggalLaporanIso, tanggalRilisTerakhir, tanggalDataMulai) {
  if (!perHari || !k.tanggalMulaiIso || !tanggalRilisTerakhir) return null;
  // Kampanye yang mulai sebelum data penjualan tersedia: pesanan hari-hari awalnya tidak ada di
  // data, jadi batasnya akan terlalu kecil (merugikan iklan). Lebih baik tidak diukur.
  if (tanggalDataMulai && k.tanggalMulaiIso < tanggalDataMulai) return null;
  let akhir = k.tanggalSelesaiIso || k.tanggalMulaiIso;
  if (tanggalLaporanIso && akhir > tanggalLaporanIso) akhir = tanggalLaporanIso;
  if (k.status === 'Berjalan') return null;
  const akhirEkor = tambahHari(akhir, EKOR_ATRIBUSI_HARI);
  if (selisihHari(akhirEkor, tanggalRilisTerakhir) < JEDA_CAIR_HARI) return null;
  let pcs = 0;
  let harga = 0;
  for (const [iso, t] of Object.entries(perHari)) {
    if (iso >= k.tanggalMulaiIso && iso <= akhirEkor) { pcs += t.pcs || 0; harga += t.harga || 0; }
  }
  return { pcs, harga };
}

// Gabungkan semua kampanye per produk, hitung margin/minimum/untung, beri vonis.
//   kampanye      : hasil parseShopeeAdsCsv().kampanye
//   hppMap        : Map<idProduk, { hpp, namaProduk }>
//   rasioPencairan: angka 0–1, atau null → pakai default
//   produkIncome  : (opsional) Map/objek idProduk → { harga, rasio, pcs, perHari } dari file
//                   Income yang sedang diunggah — harga & rasio pencairan produk itu sendiri,
//                   plus perHari { 'YYYY-MM-DD': { pcs, harga } } untuk batas pesanan dibayar.
//   opsi          : { tingkatCair, tanggalLaporanIso, tanggalRilisTerakhir }
function hitungAnalisisIklan(kampanye, hppMap, rasioPencairan, produkIncome, opsi = {}) {
  const rasio =
    Number.isFinite(rasioPencairan) && rasioPencairan > 0 && rasioPencairan <= 1
      ? rasioPencairan
      : RASIO_PENCAIRAN_DEFAULT;
  const tingkatCair =
    Number.isFinite(opsi.tingkatCair) && opsi.tingkatCair > 0 && opsi.tingkatCair <= 1
      ? opsi.tingkatCair
      : TINGKAT_CAIR_DEFAULT;
  const tanggalLaporanIso = opsi.tanggalLaporanIso || '';
  const tanggalRilisTerakhir = opsi.tanggalRilisTerakhir || '';
  const tanggalDataMulai = opsi.tanggalDataMulai || '';
  const incomeMap = produkIncome instanceof Map ? produkIncome : new Map(Object.entries(produkIncome || {}));

  // Per kampanye: umur (hari berjalan sampai tanggal laporan) & batas pesanan dibayar.
  for (const k of kampanye) {
    let akhir = k.tanggalSelesaiIso || k.tanggalMulaiIso;
    if (tanggalLaporanIso && akhir > tanggalLaporanIso) akhir = tanggalLaporanIso;
    k.hariBerjalan = k.tanggalMulaiIso && akhir >= k.tanggalMulaiIso ? selisihHari(k.tanggalMulaiIso, akhir) + 1 : 1;
    const inc = incomeMap.get(k.kodeProduk);
    const batas = batasDibayarKampanye(k, inc && inc.perHari, tanggalLaporanIso, tanggalRilisTerakhir, tanggalDataMulai);
    k.capTerukur = batas !== null;
    if (batas) {
      k.pesananDibayarMaks = Math.min(k.terjualLangsung, batas.pcs);
      k.omzetLangsungCair = Math.min(k.omzetLangsung * tingkatCair, batas.harga);
    } else {
      k.pesananDibayarMaks = null;
      k.omzetLangsungCair = k.omzetLangsung * tingkatCair;
    }
  }

  // Agregasi per Kode Produk — satu produk bisa punya banyak kampanye (berurutan atau tumpang tindih).
  const perProduk = new Map();
  const kosong = () => ({ dilihat: 0, klik: 0, terjual: 0, terjualLangsung: 0, omzet: 0, omzetLangsung: 0, omzetLangsungCair: 0, biaya: 0 });
  const tambah = (t, k) => {
    t.dilihat += k.dilihat; t.klik += k.klik; t.terjual += k.terjual; t.terjualLangsung += k.terjualLangsung;
    t.omzet += k.omzet; t.omzetLangsung += k.omzetLangsung; t.omzetLangsungCair += k.omzetLangsungCair; t.biaya += k.biaya;
  };
  for (const k of kampanye) {
    let p = perProduk.get(k.kodeProduk);
    if (!p) {
      p = {
        idProduk: k.kodeProduk,
        tokoLevel: !!k.tokoLevel,
        namaProduk: '',
        namaIklan: k.namaIklan,
        jumlahKampanye: 0,
        sedangBerjalan: 0,
        modeBidding: new Set(),
        tanggalMulaiIso: k.tanggalMulaiIso,
        tanggalSelesaiIso: k.tanggalSelesaiIso,
        ...kosong(),
        // Batas pesanan dibayar yang terukur (hanya kampanye yang bisa diukur).
        kampanyeTerukur: 0, terjualLangsungTerukur: 0, dibayarMaksTerukur: 0,
        berjalan: null,
      };
      perProduk.set(k.kodeProduk, p);
    }
    p.jumlahKampanye += 1;
    if (k.modeBidding) p.modeBidding.add(k.modeBidding);
    if (k.tanggalMulaiIso && (!p.tanggalMulaiIso || k.tanggalMulaiIso < p.tanggalMulaiIso)) p.tanggalMulaiIso = k.tanggalMulaiIso;
    if (k.tanggalSelesaiIso && k.tanggalSelesaiIso > p.tanggalSelesaiIso) p.tanggalSelesaiIso = k.tanggalSelesaiIso;
    // Nama iklan terbaru dianggap paling mewakili produknya.
    if (k.tanggalMulaiIso >= (p.namaIklanIso || '')) { p.namaIklan = k.namaIklan; p.namaIklanIso = k.tanggalMulaiIso; }
    tambah(p, k);
    if (k.capTerukur) { p.kampanyeTerukur += 1; p.terjualLangsungTerukur += k.terjualLangsung; p.dibayarMaksTerukur += k.pesananDibayarMaks; }
    if (k.status === 'Berjalan') {
      p.sedangBerjalan += 1;
      if (!p.berjalan) p.berjalan = { jumlah: 0, tanggalMulaiIso: k.tanggalMulaiIso, hari: 0, ...kosong() };
      p.berjalan.jumlah += 1;
      if (k.tanggalMulaiIso && (!p.berjalan.tanggalMulaiIso || k.tanggalMulaiIso < p.berjalan.tanggalMulaiIso)) p.berjalan.tanggalMulaiIso = k.tanggalMulaiIso;
      p.berjalan.hari = Math.max(p.berjalan.hari, k.hariBerjalan);
      tambah(p.berjalan, k);
    }
  }

  const produk = [];
  const ringkasan = {
    rasioPencairan: rasio,
    tingkatCair,
    jumlahKampanye: kampanye.length,
    jumlahProduk: 0,
    totalBiaya: 0,
    totalOmzet: 0,
    totalOmzetLangsung: 0,
    // Untung setelah iklan hanya bisa dijumlahkan untuk produk yang HPP-nya ada.
    untungLangsung: 0,
    untungLuas: 0,
    biayaDinilai: 0,
    // Jumlah produk per tindakan di Seller Centre (lihat vonis()).
    jumlahBiarkan: 0,
    jumlahUbahTarget: 0,
    jumlahJeda: 0,
    biayaJeda: 0,      // biaya yang selama ini terbuang di iklan yang harus dijeda
    jumlahTunggu: 0,
    jumlahBelumHpp: 0,
    biayaBelumHpp: 0,
    biayaToko: 0,      // iklan level toko (tanpa produk)
  };

  for (const p of perProduk.values()) {
    // Produk tanpa biaya dan tanpa penjualan (kampanye kosong) tidak perlu ditampilkan.
    if (p.biaya === 0 && p.terjual === 0) continue;

    const infoHpp = p.tokoLevel ? null : hppMap.get(p.idProduk);
    const hpp = infoHpp && Number.isFinite(infoHpp.hpp) ? infoHpp.hpp : null;
    p.namaProduk = p.tokoLevel ? 'Iklan Toko (GMV Max) — ' + p.namaIklan : (infoHpp && infoHpp.namaProduk) || p.namaIklan;
    p.hpp = hpp;
    p.roasShopee = bagi(p.omzet, p.biaya);
    p.roasLangsung = bagi(p.omzetLangsung, p.biaya);
    // Harga per pcs & rasio pencairan: dari file Income kalau produk ini ada di sana
    // (≥ 3 pcs), kalau tidak dari penjualan langsung iklan, terakhir dari omzet luas.
    const inc = incomeMap.get(p.idProduk);
    const adaIncome = inc && Number.isFinite(inc.harga) && inc.harga > 0 && (inc.pcs || 0) >= 3;
    if (adaIncome) {
      p.hargaRata = inc.harga;
      p.sumberHarga = 'income';
    } else if (p.terjualLangsung > 0) {
      p.hargaRata = p.omzetLangsung / p.terjualLangsung;
      p.sumberHarga = 'langsung';
    } else if (p.terjual > 0) {
      p.hargaRata = p.omzet / p.terjual;
      p.sumberHarga = 'luas';
    } else {
      p.hargaRata = 0;
      p.sumberHarga = null;
    }
    const rasioProduk = adaIncome && Number.isFinite(inc.rasio) && inc.rasio > 0 && inc.rasio <= 1 ? inc.rasio : rasio;
    p.rasioPencairan = rasioProduk;

    const hitungUntung = (t, m) => {
      t.roasShopee = bagi(t.omzet, t.biaya);
      t.roasLangsung = bagi(t.omzetLangsung, t.biaya);
      if (m === null) { t.untungLangsung = hpp !== null ? -t.biaya : null; t.untungLuas = t.untungLangsung; return; }
      t.untungLangsung = t.omzetLangsungCair * m - t.biaya;
      t.untungLuas = t.omzet * tingkatCair * m - t.biaya;
    };
    if (hpp !== null && p.hargaRata > 0) {
      p.marginPerRp = (p.hargaRata * rasioProduk - hpp) / p.hargaRata;
      p.roasImpas = p.marginPerRp > 0 ? 1 / (p.marginPerRp * tingkatCair) : null;
      p.targetDisarankan = p.roasImpas !== null ? p.roasImpas + PENYANGGA_TARGET : null;
      hitungUntung(p, p.marginPerRp);
      if (p.berjalan) hitungUntung(p.berjalan, p.marginPerRp);
    } else {
      // HPP ada tapi tidak ada penjualan: yang pasti hanya biayanya hilang. Tanpa HPP
      // (atau iklan toko): tidak bisa dihitung.
      p.marginPerRp = null; p.roasImpas = null; p.targetDisarankan = null;
      hitungUntung(p, null);
      if (p.berjalan) hitungUntung(p.berjalan, null);
    }

    const v = vonis(p);
    p.status = v.status;
    p.aksi = v.aksi;
    p.tindakan = v.tindakan;
    p.modeBidding = [...p.modeBidding].sort().join(' / ');
    delete p.namaIklanIso;

    ringkasan.jumlahProduk += 1;
    ringkasan.totalBiaya += p.biaya;
    ringkasan.totalOmzet += p.omzet;
    ringkasan.totalOmzetLangsung += p.omzetLangsung;
    if (p.status === 'toko') {
      ringkasan.biayaToko += p.biaya;
    } else if (p.status === 'belum-hpp') {
      ringkasan.jumlahBelumHpp += 1;
      ringkasan.biayaBelumHpp += p.biaya;
    } else {
      ringkasan.untungLangsung += p.untungLangsung;
      ringkasan.untungLuas += p.untungLuas;
      ringkasan.biayaDinilai += p.biaya;
      if (p.aksi === 'biarkan') ringkasan.jumlahBiarkan += 1;
      else if (p.aksi === 'ubah-target') ringkasan.jumlahUbahTarget += 1;
      else if (p.aksi === 'tunggu') ringkasan.jumlahTunggu += 1;
      else { ringkasan.jumlahJeda += 1; ringkasan.biayaJeda += p.biaya; }
    }

    produk.push(p);
  }

  // Default: biaya terbesar di atas — di situlah uang paling banyak dipertaruhkan.
  produk.sort((a, b) => b.biaya - a.biaya);

  ringkasan.roasShopee = bagi(ringkasan.totalOmzet, ringkasan.totalBiaya);
  ringkasan.roasLangsung = bagi(ringkasan.totalOmzetLangsung, ringkasan.totalBiaya);

  // Untung per kampanye (pakai margin produknya) supaya rincian per kampanye juga
  // bisa menunjukkan mana yang menyeret produk itu ke rugi.
  const marginProduk = new Map(produk.map((p) => [p.idProduk, p.marginPerRp]));
  const kampanyeDinilai = kampanye.map((k) => {
    const m = marginProduk.get(k.kodeProduk);
    return {
      ...k,
      roasShopee: bagi(k.omzet, k.biaya),
      roasLangsung: bagi(k.omzetLangsung, k.biaya),
      untungLangsung: m === null || m === undefined ? null : k.omzetLangsungCair * m - k.biaya,
    };
  });

  return { produk, kampanye: kampanyeDinilai, ringkasan };
}

module.exports = {
  parseCsvLine,
  parseShopeeAdsCsv,
  hitungAnalisisIklan,
  RASIO_PENCAIRAN_DEFAULT,
  TINGKAT_CAIR_DEFAULT,
  KODE_IKLAN_TOKO,
};
