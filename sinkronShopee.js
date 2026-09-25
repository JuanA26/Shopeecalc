// Sinkron otomatis pesanan yang dananya sudah dilepas dari Shopee Open Platform API ke SQLite
// — pengganti unggah file Excel "Income" (sudah dilepas). Hasilnya disimpan di tabel
// api_pesanan / api_pesanan_item (db.js) dengan bentuk baris yang sama seperti baris "Sku"
// di Excel, supaya perhitungan margin di server.js bisa dipakai apa adanya.
//
// Alur per sinkron:
//   1. get_escrow_list      — daftar order_sn + waktu dana dilepas, per jendela 14 hari.
//   2. get_escrow_detail(_batch) — rincian penghasilan per pesanan: escrow_amount (yang
//      benar-benar diterima) + daftar barang dengan jumlah pcs ASLI (tidak perlu ditebak
//      seperti di Excel, §5 PROJECT_NOTES.md).
//   3. get_order_detail     — tanggal pesanan dibuat + status.
//   4. get_return_detail    — hanya untuk pesanan yang punya retur: barang mana yang diretur.
// Semua endpoint di atas baca-saja (lihat ENDPOINT_BACA_SAJA di shopeeApi.js).

const JENDELA_HARI = 14; // get_escrow_list: rentang per panggilan dibuat pendek supaya aman
const UKURAN_BATCH = 50; // batas order_sn per panggilan get_escrow_detail_batch / get_order_detail
const HARI_AWAL_DEFAULT = 90; // sinkron pertama menarik 90 hari ke belakang
const HARI_TUMPANG_TINDIH = 3; // sinkron dana berikutnya mundur 3 hari dari batas terakhir (cuma panggilan daftar, murah)
const DETIK_TUMPANG_ORDER = 60 * 60; // sinkron pesanan berikutnya mundur 1 jam — pesanan yang statusnya tidak berubah dilewati
const PARALEL = 4; // jumlah panggilan API yang boleh jalan bersamaan (jauh di bawah batas laju Shopee)
const DETIK_SEHARI = 86400;
const BATAS_ULANG = 200; // maksimal pesanan dari tabel sinkron_ulang yang dicoba lagi per sinkron (per jenis)

// Antrean ambil-ulang (tabel sinkron_ulang, db.js): pesanan yang pengambilannya tidak lengkap
// dicatat, lalu dicoba lagi di sinkron berikutnya sampai berhasil.
function antreanUlang(db, shopId, jenis) {
  shopId = String(shopId);
  const pilih = db.prepare('SELECT order_sn FROM sinkron_ulang WHERE shop_id = ? AND jenis = ? ORDER BY percobaan, pertama, order_sn LIMIT ?');
  const tambah = db.prepare(
    `INSERT INTO sinkron_ulang (shop_id, order_sn, jenis) VALUES (?, ?, ?)
     ON CONFLICT(shop_id, order_sn, jenis) DO NOTHING`
  );
  const buang = db.prepare('DELETE FROM sinkron_ulang WHERE shop_id = ? AND order_sn = ? AND jenis = ?');
  const hitung = db.prepare('SELECT COUNT(*) AS n FROM sinkron_ulang WHERE shop_id = ? AND jenis = ?');
  return {
    daftar: () => {
      const ids = pilih.all(shopId, jenis, BATAS_ULANG).map((r) => r.order_sn);
      // Rotate even when the API omits a row or throws before processing its response.
      const tandai = db.prepare('UPDATE sinkron_ulang SET percobaan = percobaan + 1 WHERE shop_id = ? AND jenis = ? AND order_sn = ?');
      for (const sn of ids) tandai.run(shopId, jenis, sn);
      return ids;
    },
    catat: (sn) => tambah.run(shopId, sn, jenis),
    hapus: (sn) => buang.run(shopId, sn, jenis),
    sisa: () => hitung.get(shopId, jenis).n,
  };
}

// Tanggal WIB (GMT+7, zona waktu Shopee Indonesia & file Excel-nya) dari unix detik.
function tanggalWib(ts) {
  if (!ts) return '';
  return new Date((Number(ts) + 7 * 3600) * 1000).toISOString().slice(0, 10);
}

function cekError(hasil, namaEndpoint) {
  if (hasil && hasil.error) {
    throw new Error(`Shopee menolak ${namaEndpoint}: ${hasil.error}${hasil.message ? ' — ' + hasil.message : ''}`);
  }
  return (hasil && hasil.response) || {};
}

// Jalankan fn untuk tiap potongan (batch) dengan paling banyak `n` sekaligus, urutan hasil tetap.
async function paralel(daftar, n, fn) {
  const hasil = new Array(daftar.length);
  let berikut = 0;
  let gagal = false; // satu gagal → pekerja lain berhenti mengambil potongan baru (tidak menulis ke DB setelah sinkron dinyatakan gagal)
  const pekerja = Array.from({ length: Math.min(n, daftar.length) }, async () => {
    while (berikut < daftar.length && !gagal) {
      const i = berikut++;
      try {
        hasil[i] = await fn(daftar[i], i);
      } catch (err) {
        gagal = true;
        throw err;
      }
    }
  });
  await Promise.all(pekerja);
  return hasil;
}
const potong = (daftar, ukuran) => Array.from({ length: Math.ceil(daftar.length / ukuran) }, (_, i) => daftar.slice(i * ukuran, (i + 1) * ukuran));

// Status retur yang dianggap barangnya benar-benar kembali & uangnya dikembalikan.
// Pesanan di sini semuanya sudah dilepas dananya, jadi retur yang masih "diproses" jarang;
// yang dibatalkan jelas tidak dihitung.
function returDihitung(retur) {
  const status = String(retur.status || '').toUpperCase();
  return status !== 'CANCELLED' && Number(retur.refund_amount || 0) > 0;
}

// Ubah satu escrow detail (+ rincian returnya) jadi baris-baris per barang.
// Aturan pembagian meniru file Excel Income (dicek 2026-09-25 pada file 24–30 Agustus:
// Total Penghasilan tiap baris Sku = total pesanan × harga baris ÷ jumlah harga baris yang
// TIDAK diretur; baris yang diretur Total Penghasilan-nya 0).
function susunBarisPesanan(escrow, daftarRetur = []) {
  const income = escrow.order_income || {};
  const escrowAmount = Number(income.escrow_amount) || 0;

  // Sisa pcs yang diretur per model (atau per item kalau model_id kosong).
  const sisaRetur = new Map();
  for (const retur of daftarRetur) {
    if (!returDihitung(retur)) continue;
    for (const it of retur.item || []) {
      const kunci = String(it.model_id || it.item_id || '');
      sisaRetur.set(kunci, (sisaRetur.get(kunci) || 0) + (Number(it.amount) || 0));
    }
  }

  const baris = [];
  for (const it of income.items || []) {
    const jumlah = Math.max(1, Number(it.quantity_purchased) || 1);
    // discounted_price = harga setelah diskon penjual, SUBTOTAL untuk semua pcs baris ini
    // (sama seperti "Harga Produk" di Excel untuk baris multi-pcs).
    const subtotal = Number(it.discounted_price) || Number(it.original_price) || 0;
    const hargaSatuan = subtotal / jumlah;
    const dasar = {
      idProduk: String(it.item_id),
      modelId: it.model_id ? String(it.model_id) : '',
      namaProduk: it.item_name || '',
      namaModel: it.model_name || '',
    };

    const kunci = String(it.model_id || it.item_id || '');
    const diretur = Math.min(jumlah, sisaRetur.get(kunci) || sisaRetur.get(String(it.item_id)) || 0);
    if (diretur > 0) {
      const kunciPakai = sisaRetur.has(kunci) ? kunci : String(it.item_id);
      sisaRetur.set(kunciPakai, sisaRetur.get(kunciPakai) - diretur);
    }
    const tetap = jumlah - diretur;

    if (tetap > 0) {
      baris.push({ ...dasar, jumlah: tetap, hargaProduk: Math.round(hargaSatuan * tetap), dikembalikan: false, jumlahPengembalian: 0 });
    }
    if (diretur > 0) {
      const harga = Math.round(hargaSatuan * diretur);
      baris.push({ ...dasar, jumlah: diretur, hargaProduk: harga, dikembalikan: true, jumlahPengembalian: harga });
    }
  }

  // Bagi escrow_amount ke baris yang tidak diretur, sebanding harga. Kalau semuanya diretur
  // (retur penuh), angkanya (biasanya ongkir yang tetap ditanggung, bisa minus) dibagi ke
  // semua baris supaya total pendapatan tetap sama dengan yang benar-benar diterima.
  const penerima = baris.some((b) => !b.dikembalikan) ? baris.filter((b) => !b.dikembalikan) : baris;
  const totalHarga = penerima.reduce((t, b) => t + b.hargaProduk, 0);
  let sisa = escrowAmount;
  penerima.forEach((b, i) => {
    const bagian = i === penerima.length - 1
      ? sisa
      : Math.round(totalHarga ? (escrowAmount * b.hargaProduk) / totalHarga : escrowAmount / penerima.length);
    b.totalPenghasilan = bagian;
    sisa -= bagian;
  });
  for (const b of baris) if (b.totalPenghasilan === undefined) b.totalPenghasilan = 0;
  return baris;
}

// Ambil escrow detail untuk banyak pesanan. get_escrow_detail_batch didokumentasikan
// dengan parameter array; kalau ternyata ditolak, jatuh ke get_escrow_detail satu per satu
// (terbukti jalan di produksi, §21) dan ingat supaya tidak mencoba batch lagi.
let batchEscrowDitolak = false;
async function ambilEscrowDetail(panggil, daftarSn) {
  if (!batchEscrowDitolak) {
    try {
      const hasil = await panggil('/api/v2/payment/get_escrow_detail_batch', {
        method: 'POST',
        body: { order_sn_list: daftarSn },
      });
      const resp = cekError(hasil, 'get_escrow_detail_batch');
      const daftar = Array.isArray(resp) ? resp : resp.escrow_detail_list || resp.order_income_list || null;
      if (Array.isArray(daftar)) return daftar.map((x) => x.escrow_detail || x);
      throw new Error('bentuk respons batch tidak dikenali');
    } catch (err) {
      console.warn(`[SINKRON] get_escrow_detail_batch gagal (${err.message}) — pakai get_escrow_detail satu per satu.`);
      batchEscrowDitolak = true;
    }
  }
  return paralel(daftarSn, PARALEL, async (sn) =>
    cekError(await panggil('/api/v2/payment/get_escrow_detail', { query: { order_sn: sn } }), 'get_escrow_detail'));
}
const modeEscrow = () => (batchEscrowDitolak ? 'satu-per-satu' : 'batch');

async function ambilOrderDetail(panggil, daftarSn) {
  const hasil = await panggil('/api/v2/order/get_order_detail', {
    query: { order_sn_list: daftarSn.join(','), response_optional_fields: 'order_status,create_time' },
  });
  const resp = cekError(hasil, 'get_order_detail');
  return new Map((resp.order_list || []).map((o) => [o.order_sn, o]));
}

async function ambilRetur(panggil, returnSn) {
  const hasil = await panggil('/api/v2/returns/get_return_detail', { query: { return_sn: returnSn } });
  return cekError(hasil, 'get_return_detail');
}

// Semua order_sn yang dananya dilepas dalam rentang [dari, sampai] (unix detik).
async function daftarEscrow(panggil, dari, sampai) {
  const hasil = new Map();
  for (let awal = dari; awal < sampai; awal += JENDELA_HARI * DETIK_SEHARI) {
    const akhir = Math.min(sampai, awal + JENDELA_HARI * DETIK_SEHARI);
    for (let halaman = 1; ; halaman++) {
      const resp = cekError(
        await panggil('/api/v2/payment/get_escrow_list', {
          query: { release_time_from: awal, release_time_to: akhir, page_size: 100, page_no: halaman },
        }),
        'get_escrow_list'
      );
      for (const e of resp.escrow_list || []) hasil.set(e.order_sn, e.escrow_release_time);
      if (!resp.more || !(resp.escrow_list || []).length) break;
    }
  }
  return hasil;
}

// Semua order_sn yang dibuat ATAU berubah status dalam rentang [dari, sampai] — pakai
// time_range_field=update_time supaya pesanan lama yang baru batal/selesai ikut terambil ulang.
async function daftarOrderBerubah(panggil, dari, sampai) {
  const hasil = new Map(); // order_sn → status menurut daftar
  for (let awal = dari; awal < sampai; awal += JENDELA_HARI * DETIK_SEHARI) {
    const akhir = Math.min(sampai, awal + JENDELA_HARI * DETIK_SEHARI);
    let cursor = '';
    for (;;) {
      const query = { time_range_field: 'update_time', time_from: awal, time_to: akhir, page_size: 100, response_optional_fields: 'order_status' };
      if (cursor) query.cursor = cursor;
      const resp = cekError(await panggil('/api/v2/order/get_order_list', { query }), 'get_order_list');
      for (const o of resp.order_list || []) hasil.set(o.order_sn, o.order_status || null);
      if (!resp.more || !resp.next_cursor) break;
      cursor = resp.next_cursor;
    }
  }
  return hasil;
}

// Langkah pesanan (per tanggal dibuat): simpan status + barang semua pesanan yang berubah.
async function sinkronOrder({ db, panggil, shopId, dari, sampai, onProgres }) {
  if (onProgres) onProgres({ tahap: 'pesanan', selesai: 0, total: null }); // total belum diketahui: sedang mendaftar
  const terdaftar = await daftarOrderBerubah(panggil, dari, sampai);
  // Lewati pesanan yang sudah tersimpan dengan status yang sama — tidak ada yang perlu diunduh ulang.
  const statusLama = db.prepare('SELECT status FROM api_order WHERE order_sn = ?');
  const daftar = [...terdaftar].filter(([sn, status]) => {
    const lama = statusLama.get(sn);
    return !lama || !status || lama.status !== status;
  }).map(([sn]) => sn);
  // Pesanan yang dulu tidak ada di respons get_order_detail: jendela sinkron sudah lewat, jadi
  // diambil ulang langsung per order_sn (kalau tidak, status batal/selesai-nya tidak pernah masuk).
  const ulang = antreanUlang(db, shopId, 'order');
  const sudahDaftar = new Set(daftar);
  for (const sn of ulang.daftar()) if (!sudahDaftar.has(sn)) daftar.push(sn);
  const simpanOrder = db.prepare(
    `INSERT INTO api_order (order_sn, shop_id, tanggal_pesanan, create_time, update_time, status) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(order_sn) DO UPDATE SET tanggal_pesanan = excluded.tanggal_pesanan, create_time = excluded.create_time,
       update_time = excluded.update_time, status = excluded.status`
  );
  const hapusItem = db.prepare('DELETE FROM api_order_item WHERE order_sn = ?');
  const simpanItem = db.prepare(
    `INSERT INTO api_order_item (order_sn, baris, id_produk, model_id, nama_produk, nama_model, jumlah, harga_satuan)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  if (onProgres) onProgres({ tahap: 'pesanan', selesai: 0, total: daftar.length });
  let selesai = 0;
  let terlewat = 0;
  await paralel(potong(daftar, UKURAN_BATCH), PARALEL, async (potongan) => {
    const resp = cekError(
      await panggil('/api/v2/order/get_order_detail', {
        query: { order_sn_list: potongan.join(','), response_optional_fields: 'item_list,order_status,create_time,update_time' },
      }),
      'get_order_detail'
    );
    const ada = new Set((resp.order_list || []).map((o) => o.order_sn));
    db.exec('BEGIN');
    try {
      for (const sn of potongan) {
        if (ada.has(sn)) ulang.hapus(sn);
        else { ulang.catat(sn); terlewat += 1; }
      }
      for (const o of resp.order_list || []) {
        simpanOrder.run(o.order_sn, String(shopId), tanggalWib(o.create_time), o.create_time || null, o.update_time || null, o.order_status || null);
        hapusItem.run(o.order_sn);
        (o.item_list || []).forEach((it, idx) =>
          simpanItem.run(
            o.order_sn, idx, String(it.item_id), it.model_id ? String(it.model_id) : '', it.item_name || '', it.model_name || '',
            Math.max(1, Number(it.model_quantity_purchased) || 1), Number(it.model_discounted_price) || Number(it.model_original_price) || 0
          )
        );
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    selesai += potongan.length;
    if (onProgres) onProgres({ tahap: 'pesanan', selesai, total: daftar.length });
  });
  if (terlewat) console.warn(`[SINKRON] ${terlewat} pesanan tidak ada di respons get_order_detail — dicoba lagi di sinkron berikutnya.`);
  return { diperiksa: terdaftar.size, diperbarui: daftar.length - terlewat, terlewat };
}

// Sinkron satu toko. `panggil(path, opsi)` = callShopApi yang sudah terikat token toko ini.
// opsi.hariMundur: paksa tarik ulang N hari ke belakang (mis. untuk menambah riwayat lama).
// Urutan: pesanan dulu (cepat, supaya penjualan hari ini langsung ada), lalu dana cair.
async function sinkronkan({ db, panggil, shopId, hariMundur, onProgres } = {}) {
  const sekarang = Math.floor(Date.now() / 1000);
  const state = db.prepare('SELECT * FROM sinkron_shopee WHERE shop_id = ?').get(shopId) || {};

  // Explicit historical sync also repairs stored rows, in bounded, persistent batches.
  // Normal scheduled syncs only drain the queue; they do not repeatedly seed it.
  if (hariMundur) {
    const awal = tanggalWib(sekarang - hariMundur * DETIK_SEHARI);
    const akhir = tanggalWib(sekarang);
    const seed = db.prepare(`INSERT OR IGNORE INTO sinkron_ulang (shop_id, order_sn, jenis)
      SELECT shop_id, order_sn, ? FROM api_pesanan
      WHERE shop_id = ? AND tanggal_dilepaskan BETWEEN ? AND ?`);
    db.exec('BEGIN');
    try {
      seed.run('retur', String(shopId), awal, akhir);
      seed.run('order', String(shopId), awal, akhir);
      db.prepare(`INSERT OR IGNORE INTO sinkron_ulang (shop_id, order_sn, jenis)
        SELECT shop_id, order_sn, 'order' FROM api_order
        WHERE shop_id = ? AND tanggal_pesanan BETWEEN ? AND ?`).run(String(shopId), awal, akhir);
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); throw err; }
  }

  let dariOrder;
  if (hariMundur) dariOrder = sekarang - hariMundur * DETIK_SEHARI;
  else if (state.order_ts) dariOrder = state.order_ts - DETIK_TUMPANG_ORDER;
  else dariOrder = sekarang - HARI_AWAL_DEFAULT * DETIK_SEHARI;
  const hasilOrder = await sinkronOrder({ db, panggil, shopId, dari: dariOrder, sampai: sekarang, onProgres });

  let dari;
  if (hariMundur) dari = sekarang - hariMundur * DETIK_SEHARI;
  else if (state.sampai_ts) dari = state.sampai_ts - HARI_TUMPANG_TINDIH * DETIK_SEHARI;
  else dari = sekarang - HARI_AWAL_DEFAULT * DETIK_SEHARI;

  if (onProgres) onProgres({ tahap: 'dana', selesai: 0, total: null });
  const escrow = await daftarEscrow(panggil, dari, sekarang);
  const sudahAda = db.prepare('SELECT 1 FROM api_pesanan WHERE order_sn = ?');
  // Terbaru dulu: sinkron pertama (90 hari) bisa belasan menit, jadi periode yang paling sering
  // dilihat (30 hari terakhir) harus sudah terisi duluan.
  const baru = [...escrow.keys()]
    .filter((sn) => !sudahAda.get(sn))
    .sort((a, b) => escrow.get(b) - escrow.get(a));
  const jumlahBaru = baru.length;
  // Pesanan yang rincian returnya dulu gagal diambil: sudah tersimpan (seolah tanpa retur), jadi
  // filter "sudah ada" di atas melewatinya. Ambil ulang di belakang antrean sampai returnya terbaca.
  const ulangRetur = antreanUlang(db, shopId, 'retur');
  const sudahAntre = new Set(baru);
  for (const sn of ulangRetur.daftar()) if (!sudahAntre.has(sn)) baru.push(sn);
  if (onProgres) onProgres({ tahap: 'dana', selesai: 0, total: baru.length });

  // tanggal_dilepaskan: pesanan ambil-ulang bisa di luar jendela get_escrow_list (tanggalnya
  // kosong) — pertahankan tanggal yang sudah tersimpan.
  const simpanPesanan = db.prepare(
    `INSERT INTO api_pesanan (order_sn, shop_id, waktu_pesanan, tanggal_dilepaskan, escrow_amount, status_pesanan, ada_retur, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(order_sn) DO UPDATE SET waktu_pesanan = COALESCE(NULLIF(excluded.waktu_pesanan, ''), api_pesanan.waktu_pesanan),
       tanggal_dilepaskan = COALESCE(NULLIF(excluded.tanggal_dilepaskan, ''), api_pesanan.tanggal_dilepaskan),
       escrow_amount = excluded.escrow_amount, status_pesanan = excluded.status_pesanan, ada_retur = excluded.ada_retur, synced_at = excluded.synced_at`
  );
  const hapusItem = db.prepare('DELETE FROM api_pesanan_item WHERE order_sn = ?');
  const simpanItem = db.prepare(
    `INSERT INTO api_pesanan_item (order_sn, baris, id_produk, model_id, nama_produk, nama_model, jumlah, harga_produk, total_penghasilan, dikembalikan, jumlah_pengembalian)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  // Tanggal dibuat & status biasanya sudah ada dari langkah pesanan — get_order_detail hanya
  // untuk yang belum tersimpan (mis. pesanan lama di luar jendela langkah pesanan).
  const orderTersimpan = db.prepare('SELECT create_time, status FROM api_order WHERE order_sn = ?');
  let selesai = 0;
  const terlewat = []; // order_sn yang tidak ada di respons Shopee — dicoba lagi di sinkron berikutnya
  await paralel(potong(baru, UKURAN_BATCH), PARALEL, async (potongan) => {
    const dikenal = new Map();
    for (const sn of potongan) {
      const o = orderTersimpan.get(sn);
      if (o && o.create_time) dikenal.set(sn, { order_sn: sn, create_time: o.create_time, order_status: o.status });
    }
    const belumDikenal = potongan.filter((sn) => !dikenal.has(sn));
    const [daftarDetail, orderDetail] = await Promise.all([
      ambilEscrowDetail(panggil, potongan),
      belumDikenal.length ? ambilOrderDetail(panggil, belumDikenal) : new Map(),
    ]);

    const adaDetail = new Set(daftarDetail.map((d) => d.order_sn));
    for (const sn of potongan) if (!adaDetail.has(sn)) terlewat.push(sn);
    const siapSimpan = [];
    for (const detail of daftarDetail) {
      const sn = detail.order_sn;
      if (!sn) continue;
      let returGagal = false;
      const daftarRetur = (await Promise.all((detail.return_order_sn_list || []).map((returnSn) =>
        ambilRetur(panggil, returnSn).catch((err) => {
          console.warn(`[SINKRON] Rincian retur ${returnSn} (pesanan ${sn}) gagal diambil: ${err.message} — dicoba lagi nanti.`);
          returGagal = true;
          return null;
        })))).filter(Boolean);
      const order = dikenal.get(sn) || orderDetail.get(sn) || {};
      siapSimpan.push({ sn, detail, order, baris: susunBarisPesanan(detail, daftarRetur), adaRetur: daftarRetur.some(returDihitung), returGagal });
    }

    db.exec('BEGIN');
    try {
      for (const p of siapSimpan) {
        simpanPesanan.run(
          p.sn, String(shopId), tanggalWib(p.order.create_time), tanggalWib(escrow.get(p.sn)),
          Number(p.detail.order_income && p.detail.order_income.escrow_amount) || 0,
          p.order.order_status || null, p.adaRetur ? 1 : 0
        );
        hapusItem.run(p.sn);
        p.baris.forEach((b, idx) =>
          simpanItem.run(p.sn, idx, b.idProduk, b.modelId, b.namaProduk, b.namaModel, b.jumlah, b.hargaProduk, b.totalPenghasilan, b.dikembalikan ? 1 : 0, b.jumlahPengembalian)
        );
        // Tetap disimpan (angka terbaik yang ada), tapi diantre supaya returnya dibaca ulang.
        if (p.returGagal) ulangRetur.catat(p.sn); else ulangRetur.hapus(p.sn);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    selesai += potongan.length;
    if (onProgres) onProgres({ tahap: 'dana', selesai, total: baru.length });
  });

  if (terlewat.length) console.warn(`[SINKRON] ${terlewat.length} pesanan cair tidak ada di respons escrow — dicoba lagi nanti.`);
  const returTertunda = ulangRetur.sisa();
  if (returTertunda) console.warn(`[SINKRON] ${returTertunda} pesanan menunggu rincian retur diambil ulang.`);
  // Batas "sudah ditarik" tidak boleh melewati pesanan yang terlewat, supaya sinkron berikutnya
  // (yang mulai dari batas itu dikurangi 3 hari) masih mendaftarnya lagi. Pesanan ambil-ulang
  // retur tidak ikut: sudah tersimpan dan tetap ada di antrean sinkron_ulang.
  const terlewatBaru = terlewat.filter((sn) => escrow.has(sn) && !sudahAda.get(sn));
  const sampai = terlewatBaru.length ? Math.min(...terlewatBaru.map((sn) => escrow.get(sn))) : sekarang;
  return {
    dari, sampai, dilihat: escrow.size, baru: jumlahBaru - terlewatBaru.length,
    orderDiperiksa: hasilOrder.diperiksa, orderBerubah: hasilOrder.diperbarui, orderSampai: sekarang,
    orderTerlewat: antreanUlang(db, shopId, 'order').sisa(), returTertunda,
  };
}

// Status pesanan yang belum/tidak jadi penjualan — tidak ditampilkan sama sekali.
const STATUS_BUKAN_PENJUALAN = new Set(['UNPAID', 'CANCELLED', 'IN_CANCEL']);

// Bagian harga jual yang benar-benar diterima penjual (Σ penghasilan ÷ Σ harga) dari pesanan
// yang sudah cair 60 hari terakhir — dipakai untuk memperkirakan penghasilan pesanan yang
// belum cair. null kalau belum ada data.
function rasioPencairanToko(db, shopId) {
  const r = db.prepare(
    `SELECT SUM(i.total_penghasilan) AS penghasilan, SUM(i.harga_produk) AS harga
     FROM api_pesanan p JOIN api_pesanan_item i ON i.order_sn = p.order_sn
     WHERE p.shop_id = ? AND i.dikembalikan = 0 AND p.tanggal_dilepaskan >= date('now', '-60 days')`
  ).get(String(shopId));
  return r && r.harga > 0 ? r.penghasilan / r.harga : null;
}

// Bagian pesanan yang benar-benar jadi penjualan (0–1), DIUKUR dari status pesanan Shopee —
// pengganti tebakan 85% untuk "tingkat pesanan iklan dibayar" di Analisis Iklan. Omzet iklan
// Shopee menghitung pesanan saat DIBUAT, termasuk yang lalu tidak dibayar / batal / diretur
// (iklan.shopee.co.id/learn/faq/549/2200). Di sini: pcs pesanan yang dibuat 90 s/d 14 hari lalu
// (statusnya sudah final) → pcs yang tidak UNPAID/CANCELLED/IN_CANCEL/TO_RETURN dan tidak diretur.
// Per produk ditarik ke angka toko (PENYANGGA_CAIR pcs semu) supaya produk dengan sedikit
// pesanan tidak loncat ke 0% / 100%. Batasan: ini angka SEMUA pesanan, bukan hanya pesanan
// iklan (Shopee tidak memberi status per pesanan iklan). null kalau datanya belum cukup.
const STATUS_TIDAK_DIBAYAR = ['UNPAID', 'CANCELLED', 'IN_CANCEL', 'TO_RETURN'];
const PENYANGGA_CAIR = 20;
function tingkatCairTerukur(db, shopId, hariIni) {
  shopId = String(shopId);
  const geser = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const sampai = geser(hariIni, -14);
  const tertua = (db.prepare('SELECT MIN(tanggal_pesanan) AS t FROM api_order WHERE shop_id = ?').get(shopId) || {}).t;
  if (!tertua) return null;
  const dari = tertua > geser(hariIni, -90) ? tertua : geser(hariIni, -90);
  if (dari > sampai) return null;
  const rows = db.prepare(
    `WITH ordered AS (
       SELECT order_sn, id_produk, SUM(jumlah) AS jumlah
       FROM api_order_item GROUP BY order_sn, id_produk
     ), returned AS (
       SELECT order_sn, id_produk, SUM(jumlah) AS jumlah
       FROM api_pesanan_item WHERE dikembalikan = 1 GROUP BY order_sn, id_produk
     )
     SELECT i.id_produk, SUM(i.jumlah) AS dibuat,
       SUM(CASE WHEN o.status IN (${STATUS_TIDAK_DIBAYAR.map(() => '?').join(',')})
                THEN 0 ELSE MAX(0, i.jumlah - COALESCE(r.jumlah, 0)) END) AS dibayar
     FROM api_order o JOIN ordered i ON i.order_sn = o.order_sn
     LEFT JOIN returned r ON r.order_sn = i.order_sn AND r.id_produk = i.id_produk
     WHERE o.shop_id = ? AND o.tanggal_pesanan BETWEEN ? AND ?
     GROUP BY i.id_produk`
  ).all(...STATUS_TIDAK_DIBAYAR, shopId, dari, sampai);
  const dibuat = rows.reduce((a, r) => a + r.dibuat, 0);
  const dibayar = rows.reduce((a, r) => a + r.dibayar, 0);
  if (dibuat < 100) return null; // terlalu sedikit untuk dipercaya
  const toko = dibayar / dibuat;
  const perProduk = {};
  for (const r of rows) perProduk[r.id_produk] = (r.dibayar + PENYANGGA_CAIR * toko) / (r.dibuat + PENYANGGA_CAIR);
  return { toko, perProduk, pcsDibuat: dibuat, pcsDibayar: dibayar, dari, sampai };
}

// Baris-baris pesanan dengan TANGGAL PESANAN dalam [dari, sampai] (YYYY-MM-DD), bentuknya
// sama seperti baris "Sku" Excel Income. Pesanan yang sudah cair → angka pasti dari
// api_pesanan_item. Yang belum cair → dari api_order_item, penghasilannya = harga × rasio
// pencairan toko, ditandai perkiraan: true.
function bacaItemPesanan(db, shopId, dari, sampai, rasioPerkiraan) {
  const pasti = db.prepare(
    // Tanggal pesanan dari api_pesanan; kalau kosong (rincian pesanan gagal diambil waktu itu)
    // pakai tanggal dari api_order, supaya pesanan itu tidak hilang dari semua periode.
    `SELECT p.order_sn, COALESCE(NULLIF(p.waktu_pesanan, ''), o.tanggal_pesanan) AS waktu_pesanan, p.tanggal_dilepaskan, i.*
     FROM api_pesanan p JOIN api_pesanan_item i ON i.order_sn = p.order_sn
     LEFT JOIN api_order o ON o.order_sn = p.order_sn
     WHERE p.shop_id = ? AND COALESCE(NULLIF(p.waktu_pesanan, ''), o.tanggal_pesanan) BETWEEN ? AND ?`
  ).all(String(shopId), dari, sampai).map((r) => ({
    noPesanan: r.order_sn,
    idProduk: r.id_produk,
    namaProduk: r.nama_produk,
    namaModel: r.nama_model || '',
    waktuPesanan: r.waktu_pesanan || '',
    tanggalDilepaskan: r.tanggal_dilepaskan,
    totalPenghasilan: r.total_penghasilan,
    hargaProduk: r.harga_produk,
    dikembalikan: !!r.dikembalikan,
    jumlahPengembalian: r.jumlah_pengembalian,
    jumlah: r.jumlah,
    perkiraan: false,
  }));

  const perkiraan = db.prepare(
    `SELECT o.order_sn, o.tanggal_pesanan, o.status, i.*
     FROM api_order o JOIN api_order_item i ON i.order_sn = o.order_sn
     WHERE o.shop_id = ? AND o.tanggal_pesanan BETWEEN ? AND ?
       AND NOT EXISTS (SELECT 1 FROM api_pesanan p WHERE p.order_sn = o.order_sn)`
  ).all(String(shopId), dari, sampai)
    .filter((r) => !STATUS_BUKAN_PENJUALAN.has(r.status))
    .map((r) => {
      const harga = Math.round(r.harga_satuan * r.jumlah);
      const diretur = r.status === 'TO_RETURN';
      return {
        noPesanan: r.order_sn,
        idProduk: r.id_produk,
        namaProduk: r.nama_produk,
        namaModel: r.nama_model || '',
        waktuPesanan: r.tanggal_pesanan,
        tanggalDilepaskan: '',
        totalPenghasilan: diretur ? 0 : Math.round(harga * rasioPerkiraan),
        hargaProduk: harga,
        dikembalikan: diretur,
        jumlahPengembalian: diretur ? harga : 0,
        jumlah: r.jumlah,
        perkiraan: true,
        statusPesanan: r.status,
      };
    });

  return [...pasti, ...perkiraan].sort(
    (a, b) => b.waktuPesanan.localeCompare(a.waktuPesanan) || a.noPesanan.localeCompare(b.noPesanan)
  );
}

module.exports = { modeEscrow, sinkronkan, bacaItemPesanan, rasioPencairanToko, tingkatCairTerukur, susunBarisPesanan, tanggalWib, HARI_AWAL_DEFAULT };
