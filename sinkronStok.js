// Sinkron stok produk dari Shopee (modul Product, baca-saja) untuk kartu "Modal di stok" di
// Dashboard: berapa uang (HPP × pcs) yang sedang tertahan di barang.
//
// Alur per sinkron (dicek di open.shopee.com 2026-10-01):
//   1. get_item_list       — semua produk per status (NORMAL = tampil, UNLIST = diarsipkan,
//                            BANNED/REVIEWING = tidak tampil). Produk yang dihapus tidak ikut.
//   2. get_item_base_info  — nama, status, has_model, stok produk tanpa varian (maks 50 per panggilan).
//   3. get_model_list      — stok per varian, hanya untuk produk bervarian yang perlu dibaca ulang.
// Stok fisik = Σ seller_stock + Σ shopee_stock (stock_info_v2). Stok yang dipesan untuk promo
// (total_reserved_stock) sudah termasuk di situ; barang yang sudah dipesan pembeli sudah keluar.
// FAQ Shopee: open.shopee.com/faq/59 ("calculation logic of stock_info_v2").
const { potong, cekError } = require('./util');

const STATUS_PRODUK = ['NORMAL', 'UNLIST', 'BANNED', 'REVIEWING'];
const UKURAN_HALAMAN = 100; // batas page_size get_item_list
const MAKS_ID = 50;         // batas item_id_list get_item_base_info
const PARALEL = 4;
const UMUR_MAKS_DETIK = 24 * 3600; // stok varian dibaca ulang paling lambat sekali sehari
// Satu varian dengan stok sebanyak ini hampir pasti angka asal (mis. 999), bukan barang di rak.
// Produk seperti ini tidak ikut dihitung dan ditandai supaya dicek di Seller Centre.
const BATAS_STOK_TIDAK_WAJAR = 500;

const jumlahStok = (info) => {
  const v2 = (info && info.stock_info_v2) || {};
  const tambah = (daftar) => (daftar || []).reduce((t, s) => t + (Number(s.stock) || 0), 0);
  return tambah(v2.seller_stock) + tambah(v2.shopee_stock);
};

async function daftarProduk(panggil) {
  const hasil = new Map(); // id → { status, update }
  for (const status of STATUS_PRODUK) {
    for (let offset = 0; ;) {
      const r = cekError(await panggil('/api/v2/product/get_item_list', {
        query: { offset, page_size: UKURAN_HALAMAN, item_status: status },
      }), 'get_item_list');
      for (const it of r.item || []) hasil.set(String(it.item_id), { status: it.item_status || status, update: Number(it.update_time) || 0 });
      if (!r.has_next_page || !(r.next_offset > offset)) break;
      offset = r.next_offset;
    }
  }
  return hasil;
}

// Jalankan fn untuk tiap potongan dengan paling banyak `n` sekaligus.
async function paralel(daftar, n, fn) {
  let berikut = 0;
  await Promise.all(Array.from({ length: Math.min(n, daftar.length) }, async () => {
    while (berikut < daftar.length) await fn(daftar[berikut++]);
  }));
}

// Stok varian dibaca ulang kalau produknya berubah (update_time), punya pesanan baru/berubah
// sejak sinkron stok terakhir (sinkron_shopee.stok_ts; update_time produk belum tentu ikut
// berubah saat stok berkurang karena pesanan), atau angkanya sudah ≥ 24 jam.
async function sinkronStok({ db, panggil, shopId, sekarang = Math.floor(Date.now() / 1000) }) {
  shopId = String(shopId);
  const produk = await daftarProduk(panggil);
  const ids = [...produk.keys()];

  const dasar = new Map();
  await paralel(potong(ids, MAKS_ID), PARALEL, async (bagian) => {
    const r = cekError(await panggil('/api/v2/product/get_item_base_info', { query: { item_id_list: bagian.join(',') } }), 'get_item_base_info');
    for (const it of r.item_list || []) dasar.set(String(it.item_id), it);
  });

  const lama = new Map(db.prepare('SELECT id_produk, update_time, diambil_ts, ada_varian, stok, stok_maks_varian, jumlah_varian FROM stok_produk WHERE shop_id = ?')
    .all(shopId).map((r) => [r.id_produk, r]));
  const status = db.prepare('SELECT stok_ts FROM sinkron_shopee WHERE shop_id = ?').get(shopId) || {};
  const terjualBaru = new Set(status.stok_ts
    ? db.prepare(`SELECT DISTINCT i.id_produk FROM api_order o JOIN api_order_item i ON i.order_sn = o.order_sn
        WHERE o.shop_id = ? AND o.update_time >= ?`).all(shopId, status.stok_ts - 3600).map((r) => r.id_produk)
    : []);

  const baris = [];
  const perluVarian = [];
  for (const id of ids) {
    const it = dasar.get(id);
    if (!it) continue; // tidak ada di respons: baris lama dipertahankan sampai sinkron berikutnya
    const l = lama.get(id);
    const update = Number(it.update_time) || produk.get(id).update;
    const b = { id, nama: it.item_name || '', status: it.item_status || produk.get(id).status, update, adaVarian: it.has_model ? 1 : 0 };
    if (!it.has_model) {
      const stok = jumlahStok(it);
      Object.assign(b, { stok, maks: stok, jumlahVarian: 1, diambil: sekarang });
    } else if (l && l.ada_varian && l.update_time === update && !terjualBaru.has(id) && sekarang - (l.diambil_ts || 0) < UMUR_MAKS_DETIK) {
      Object.assign(b, { stok: l.stok, maks: l.stok_maks_varian, jumlahVarian: l.jumlah_varian, diambil: l.diambil_ts });
    } else {
      perluVarian.push(b);
    }
    baris.push(b);
  }

  // Satu produk gagal tidak menggagalkan semuanya: angka lamanya dipakai (atau produknya
  // dilewati kalau belum pernah terbaca) dan dibaca lagi di sinkron berikutnya.
  let gagal = 0;
  await paralel(perluVarian, PARALEL, async (b) => {
    try {
      const r = cekError(await panggil('/api/v2/product/get_model_list', { query: { item_id: b.id } }), 'get_model_list');
      const stokVarian = (r.model || []).map(jumlahStok);
      Object.assign(b, {
        stok: stokVarian.reduce((t, s) => t + s, 0), maks: stokVarian.length ? Math.max(...stokVarian) : 0,
        jumlahVarian: stokVarian.length, diambil: sekarang,
      });
    } catch (err) {
      gagal++;
      b.lewati = true;
      if (gagal === 1) console.warn(`[SINKRON STOK] Varian produk ${b.id} gagal dibaca: ${err.message} — dicoba lagi nanti.`);
    }
  });
  if (gagal) console.warn(`[SINKRON STOK] ${gagal} produk bervarian belum terbaca; angka lamanya dipakai.`);

  const simpan = db.prepare(
    `INSERT INTO stok_produk (shop_id, id_produk, nama_produk, status, update_time, ada_varian, stok, stok_maks_varian, jumlah_varian, diambil_ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(shop_id, id_produk) DO UPDATE SET nama_produk = excluded.nama_produk, status = excluded.status,
       update_time = excluded.update_time, ada_varian = excluded.ada_varian, stok = excluded.stok,
       stok_maks_varian = excluded.stok_maks_varian, jumlah_varian = excluded.jumlah_varian, diambil_ts = excluded.diambil_ts`
  );
  db.exec('BEGIN');
  try {
    for (const b of baris) if (!b.lewati) simpan.run(shopId, b.id, b.nama, b.status, b.update, b.adaVarian, b.stok, b.maks, b.jumlahVarian, b.diambil);
    // Produk yang sudah dihapus (tidak ada lagi di daftar mana pun) dibuang.
    db.prepare('DELETE FROM stok_produk WHERE shop_id = ? AND id_produk NOT IN (SELECT value FROM json_each(?))').run(shopId, JSON.stringify(ids));
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  return { produk: baris.length, varianDibaca: perluVarian.length - gagal, gagal };
}

// Ringkasan untuk kartu Dashboard, per pilihan: semua / aktif (tampil di toko) / tersembunyi
// (diarsipkan, diblokir, sedang ditinjau). Produk tanpa HPP atau dengan stok tidak wajar tidak
// ikut di total, tapi dihitung terpisah supaya halaman bisa menyebutnya.
const KELOMPOK_STOK = { semua: () => true, aktif: (s) => s === 'NORMAL', tersembunyi: (s) => s !== 'NORMAL' };
function ringkasStok(baris, petaHpp, teratas = 10) {
  const hasil = {};
  for (const [kunci, cocok] of Object.entries(KELOMPOK_STOK)) {
    const r = { modal: 0, pcs: 0, produk: 0, tanpaHpp: { produk: 0, pcs: 0 }, tidakWajar: [], teratas: [] };
    const dihitung = [];
    for (const b of baris) {
      if (!cocok(b.status) || !(b.stok > 0)) continue;
      const hpp = petaHpp.get(b.id_produk);
      const p = { idProduk: b.id_produk, nama: b.nama_produk || '', status: b.status, stok: b.stok, stokMaksVarian: b.stok_maks_varian, hpp: hpp ?? null };
      if (b.stok_maks_varian >= BATAS_STOK_TIDAK_WAJAR) { r.tidakWajar.push(p); continue; }
      if (!(hpp > 0)) { r.tanpaHpp.produk++; r.tanpaHpp.pcs += b.stok; continue; }
      p.modal = b.stok * hpp;
      r.modal += p.modal; r.pcs += b.stok; r.produk++;
      dihitung.push(p);
    }
    r.teratas = dihitung.sort((a, b) => b.modal - a.modal).slice(0, teratas);
    r.tidakWajar.sort((a, b) => b.stok - a.stok);
    hasil[kunci] = r;
  }
  return hasil;
}

module.exports = { sinkronStok, ringkasStok, jumlahStok, BATAS_STOK_TIDAK_WAJAR, STATUS_PRODUK };
