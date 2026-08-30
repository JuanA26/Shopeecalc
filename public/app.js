// ====== Util ======
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

const inputCariHpp = document.getElementById('inputCariHpp');
const hppBaruId = document.getElementById('hppBaruId');
const hppBaruNama = document.getElementById('hppBaruNama');
const hppBaruNilai = document.getElementById('hppBaruNilai');
const tombolTambahHpp = document.getElementById('tombolTambahHpp');
const pesanErrorHpp = document.getElementById('pesanErrorHpp');
const isiTabelHpp = document.getElementById('isiTabelHpp');

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
  labelUsername.textContent = `👤 ${username}`;
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
    .map((it, idx) => {
      const punyaHpp = it.hpp !== null;
      const kelasBaris = it.dikembalikan ? 'baris-dikembalikan' : (punyaHpp ? '' : 'baris-peringatan');
      const kelasUntung = it.dikembalikan
        ? 'teks-redup'
        : punyaHpp ? (it.untung >= 0 ? 'untung-positif' : 'untung-negatif') : 'teks-redup';

      // Pesanan yang dikembalikan tidak perlu diminta isi HPP (barangnya kembali ke
      // penjual, jadi HPP tidak relevan buat baris ini) — cukup tampilkan tanda "-".
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

    const untung = punyaHpp ? it.totalPenghasilan - hpp : null;
    const marginPersen = punyaHpp && it.totalPenghasilan !== 0 ? (untung / it.totalPenghasilan) * 100 : null;

    if (punyaHpp) { totalHpp += hpp; totalUntung += untung; } else { jumlahBelumAdaHpp += 1; }

    return { ...it, hpp, untung, marginPersen };
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

function renderTabelHpp() {
  const kataKunci = inputCariHpp.value.trim().toLowerCase();
  const semua = gabunganProdukUntukTabelHpp();
  const filtered = !kataKunci
    ? semua
    : semua.filter((r) => [r.id_produk, r.nama_produk].some((v) => String(v).toLowerCase().includes(kataKunci)));

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
          <td data-label="ID Produk">${escapeHtml(r.id_produk)}</td>
          <td class="kolom-nama" data-label="Nama Produk" title="${escapeHtml(r.nama_produk || '')}">${r.nama_produk ? escapeHtml(potongNama(r.nama_produk)) : '-'}</td>
          <td class="kolom-hpp" data-label="Harga Modal (HPP)">${selHpp}</td>
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

// ====== Mulai ======
cekSesi();
