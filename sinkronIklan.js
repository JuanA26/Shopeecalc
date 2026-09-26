// Sinkron iklan dari Shopee Ads API — pengganti file CSV "Data Keseluruhan Iklan" di halaman
// Analisis Iklan. Semua panggilan baca-saja (ENDPOINT_BACA_SAJA di shopeeApi.js). Bentuk
// respons asli dicek lewat probe di produksi 2026-09-25 (§26 PROJECT_NOTES.md):
//   - Iklan orang tua (Seller Centre "Iklan Produk · GMV Max ROAS/Auto") = kampanye LEVEL PRODUK
//     (get_product_level_*), bukan kampanye GMS toko (yang itu tidak dipakai, biayanya 0).
//   - get_product_level_campaign_id_list: SEMUA kampanye sejak 2022 (±1.400), urut dari terlama.
//   - get_product_campaign_daily_performance: `response` berupa OBJEK {campaign_list: [...]},
//     bukan array seperti di dokumentasi; maks 100 kampanye per panggilan; rentang ≤ 1 bulan.
//   - Tanggal di API Ads berformat DD-MM-YYYY.
const crypto = require('crypto');
const { tanggalWib } = require('./sinkronShopee');
const { KODE_IKLAN_TOKO } = require('./analisisIklan');

const HARI_AWAL = 90;        // sinkron pertama: 90 hari ke belakang (sama dengan data penjualan halaman iklan)
const HARI_ULANG = 10;       // sinkron berikutnya menarik ulang 10 hari terakhir: omzet satu hari masih bisa bertambah sampai 7 hari kemudian (atribusi 7 hari setelah klik)
const JENDELA_HARI = 28;     // rentang per panggilan harian (batas Shopee 1 bulan)
const MAKS_ID = 100;         // batas campaign_id_list per panggilan
const STATUS_SELESAI = new Set(['closed', 'ended', 'deleted']);

const tambahHari = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const keShopee = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`; // 2026-09-25 → 25-09-2026
const dariShopee = (t) => { const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(t || '')); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };
const potong = (daftar, ukuran) => Array.from({ length: Math.ceil(daftar.length / ukuran) }, (_, i) => daftar.slice(i * ukuran, (i + 1) * ukuran));
const angka = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function cekError(hasil, namaEndpoint) {
  if (hasil && hasil.error) {
    throw new Error(`Shopee menolak ${namaEndpoint}: ${hasil.error}${hasil.message ? ' — ' + hasil.message : ''}`);
  }
  return (hasil && hasil.response) || {};
}

// Rentang [dari, sampai] dipecah jadi jendela ≤ JENDELA_HARI. Jendela satu hari dimundurkan
// sehari (sebagian endpoint Ads menolak tanggal mulai = tanggal selesai).
function jendela(dari, sampai) {
  const hasil = [];
  for (let a = dari; a <= sampai; a = tambahHari(a, JENDELA_HARI)) {
    const b = tambahHari(a, JENDELA_HARI - 1) < sampai ? tambahHari(a, JENDELA_HARI - 1) : sampai;
    hasil.push(a === b ? [tambahHari(a, -1), b] : [a, b]);
  }
  return hasil;
}

async function daftarIdKampanye(panggil) {
  const ids = [];
  for (let offset = 0; ; offset += 5000) {
    const r = cekError(await panggil('/api/v2/ads/get_product_level_campaign_id_list', {
      query: { ad_type: 'all', offset: String(offset), limit: '5000' },
    }), 'get_product_level_campaign_id_list');
    for (const c of r.campaign_list || []) ids.push(String(c.campaign_id));
    if (!r.has_next_page || !(r.campaign_list || []).length) break;
  }
  return ids;
}

function barisKampanye(c, shopId) {
  const ci = c.common_info || {};
  const produk = Array.isArray(ci.item_id_list) && ci.item_id_list.length === 1 ? String(ci.item_id_list[0]) : null;
  const durasi = ci.campaign_duration || {};
  return {
    campaign_id: String(c.campaign_id),
    shop_id: String(shopId),
    id_produk: produk,
    nama_iklan: ci.ad_name || '',
    status: ci.campaign_status || '',
    bidding_method: ci.bidding_method || '',
    placement: ci.campaign_placement || '',
    budget_harian: angka(ci.campaign_budget),
    target_roas: c.auto_bidding_info ? angka(c.auto_bidding_info.roas_target) : 0,
    mulai: tanggalWib(durasi.start_time),
    selesai: durasi.end_time ? tanggalWib(durasi.end_time) : '',
  };
}

// Sinkron satu toko. `panggil(path, opsi)` = callShopApi yang sudah terikat token toko ini.
// Mengembalikan { kampanyeBaru, kampanyeDiperbarui, barisHarian, dari, sampai }.
async function sinkronIklan({ db, panggil, shopId, iklanSampai, hariIni = tanggalWib(Math.floor(Date.now() / 1000)) }) {
  shopId = String(shopId);

  // 1) Setelan kampanye: yang belum pernah dilihat + yang belum selesai (target/anggaran/status
  //    bisa berubah) + yang baru selesai seminggu terakhir.
  const semuaId = await daftarIdKampanye(panggil);
  const lama = new Map(db.prepare('SELECT campaign_id, status, selesai, target_roas, budget_harian FROM iklan_kampanye WHERE shop_id = ?').all(shopId).map((r) => [r.campaign_id, r]));
  const batasBaruSelesai = tambahHari(hariIni, -7);
  const perluSetelan = semuaId.filter((id) => {
    const r = lama.get(id);
    return !r || !STATUS_SELESAI.has(r.status) || (r.selesai && r.selesai >= batasBaruSelesai);
  });
  const simpanKampanye = db.prepare(
    `INSERT INTO iklan_kampanye (campaign_id, shop_id, id_produk, nama_iklan, status, bidding_method, placement, budget_harian, target_roas, mulai, selesai, updated_at)
     VALUES (@campaign_id, @shop_id, @id_produk, @nama_iklan, @status, @bidding_method, @placement, @budget_harian, @target_roas, @mulai, @selesai, datetime('now'))
     ON CONFLICT(campaign_id) DO UPDATE SET id_produk = excluded.id_produk, nama_iklan = excluded.nama_iklan, status = excluded.status,
       bidding_method = excluded.bidding_method, placement = excluded.placement, budget_harian = excluded.budget_harian,
       target_roas = excluded.target_roas, mulai = excluded.mulai, selesai = excluded.selesai, updated_at = excluded.updated_at`
  );
  // Target/Modal yang berbeda dari yang tersimpan = diubah di Seller Centre sejak sinkron lalu.
  const simpanRiwayat = db.prepare(
    `INSERT INTO iklan_riwayat_setelan (shop_id, campaign_id, id_produk, tanggal, target_lama, target_baru, modal_lama, modal_baru)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const beda = (a, b) => Math.abs((a || 0) - (b || 0)) > 1e-6;
  let kampanyeBaru = 0;
  for (const kelompok of potong(perluSetelan, MAKS_ID)) {
    const r = cekError(await panggil('/api/v2/ads/get_product_level_campaign_setting_info', {
      query: { info_type_list: '1,3', campaign_id_list: kelompok.join(',') },
    }), 'get_product_level_campaign_setting_info');
    db.exec('BEGIN');
    try {
      for (const c of r.campaign_list || []) {
        const baris = barisKampanye(c, shopId);
        const sebelum = lama.get(baris.campaign_id);
        if (!sebelum) kampanyeBaru += 1;
        else if (beda(sebelum.target_roas, baris.target_roas) || beda(sebelum.budget_harian, baris.budget_harian)) {
          simpanRiwayat.run(shopId, baris.campaign_id, baris.id_produk, hariIni, sebelum.target_roas, baris.target_roas, sebelum.budget_harian, baris.budget_harian);
        }
        simpanKampanye.run(baris);
      }
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); throw err; }
  }

  // 1b) Rekomendasi Target ROAS Shopee untuk produk yang sedang beriklan (sekali sehari per
  //     produk). Gagal di sini tidak menggagalkan sinkron — rekomendasi hanya pelengkap.
  const perluRekomendasi = db.prepare(
    `SELECT DISTINCT k.id_produk FROM iklan_kampanye k
     LEFT JOIN iklan_rekomendasi r ON r.shop_id = k.shop_id AND r.id_produk = k.id_produk
     WHERE k.shop_id = ? AND k.status = 'ongoing' AND k.id_produk IS NOT NULL
       AND (r.updated_at IS NULL OR r.updated_at < datetime('now', '-20 hours'))`
  ).all(shopId).map((r) => r.id_produk);
  const simpanRekomendasi = db.prepare(
    `INSERT INTO iklan_rekomendasi (shop_id, id_produk, rendah, tengah, tinggi, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(shop_id, id_produk) DO UPDATE SET rendah = excluded.rendah, tengah = excluded.tengah, tinggi = excluded.tinggi, updated_at = excluded.updated_at`
  );
  let rekomendasiGagal = 0;
  for (const idProduk of perluRekomendasi) {
    try {
      const r = cekError(await panggil('/api/v2/ads/get_product_recommended_roi_target', {
        // reference_id: penanda acak anti-duplikat yang diminta endpoint ini.
        query: { reference_id: crypto.randomUUID(), item_id: idProduk },
      }), 'get_product_recommended_roi_target');
      const nilai = (b) => (b && Number(b.value) > 0 ? Number(b.value) : null);
      if (nilai(r.upper_bound) !== null) simpanRekomendasi.run(shopId, idProduk, nilai(r.lower_bound), nilai(r.exact), nilai(r.upper_bound));
    } catch (err) {
      rekomendasiGagal += 1;
      console.error(`[SINKRON IKLAN] Rekomendasi ROAS ${idProduk} gagal:`, err.message);
    }
  }

  // 2) Angka harian. Pertama kali 90 hari; berikutnya HARI_ULANG hari terakhir.
  const dari = iklanSampai ? tambahHari(iklanSampai < hariIni ? iklanSampai : hariIni, -HARI_ULANG) : tambahHari(hariIni, -(HARI_AWAL - 1));
  const sampai = hariIni;
  const pertamaKali = !iklanSampai;
  const kampanye = db.prepare('SELECT campaign_id, status, mulai, selesai FROM iklan_kampanye WHERE shop_id = ?').all(shopId);
  const aktifTerakhir = new Map(db.prepare('SELECT campaign_id, MAX(tanggal) AS t FROM iklan_harian WHERE shop_id = ? GROUP BY campaign_id').all(shopId).map((r) => [r.campaign_id, r.t]));

  const hapusHarian = db.prepare('DELETE FROM iklan_harian WHERE campaign_id = ? AND tanggal BETWEEN ? AND ?');
  const simpanHarian = db.prepare(
    `INSERT OR REPLACE INTO iklan_harian (campaign_id, tanggal, shop_id, dilihat, klik, biaya, omzet, omzet_langsung, terjual, terjual_langsung)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let barisHarian = 0;
  for (const [a, b] of jendela(dari, sampai)) {
    // Kampanye yang periodenya menyentuh jendela ini. Kampanye selesai tanpa tanggal selesai
    // (jarang): ikut saat sinkron pertama, sesudahnya hanya kalau masih ada aktivitas belakangan.
    const ids = kampanye.filter((k) => {
      if (k.mulai && k.mulai > b) return false;
      if (!STATUS_SELESAI.has(k.status)) return true;
      if (k.selesai) return k.selesai >= a;
      return pertamaKali || (aktifTerakhir.get(k.campaign_id) || '') >= tambahHari(a, -14);
    }).map((k) => k.campaign_id);
    for (const kelompok of potong(ids, MAKS_ID)) {
      const r = cekError(await panggil('/api/v2/ads/get_product_campaign_daily_performance', {
        query: { start_date: keShopee(a), end_date: keShopee(b), campaign_id_list: kelompok.join(',') },
      }), 'get_product_campaign_daily_performance');
      const daftar = (Array.isArray(r) ? r : [r]).flatMap((s) => (s && s.campaign_list) || []);
      db.exec('BEGIN');
      try {
        for (const c of daftar) {
          const id = String(c.campaign_id);
          hapusHarian.run(id, a, b); // hanya kampanye yang ADA di respons, supaya respons terpotong tidak menghapus data
          for (const m of c.metrics_list || []) {
            const tgl = dariShopee(m.date);
            if (!tgl) continue;
            const v = [angka(m.impression), angka(m.clicks), angka(m.expense), angka(m.broad_gmv), angka(m.direct_gmv), angka(m.broad_order_amount), angka(m.direct_order_amount)];
            // Keep explicit zero days: an absent row means unknown, not zero activity.
            simpanHarian.run(id, tgl, shopId, ...v);
            barisHarian += 1;
          }
        }
        db.exec('COMMIT');
      } catch (err) { db.exec('ROLLBACK'); throw err; }
    }

    // 3) Total toko per hari (untuk iklan di luar kampanye produk).
    const toko = cekError(await panggil('/api/v2/ads/get_all_cpc_ads_daily_performance', {
      query: { start_date: keShopee(a), end_date: keShopee(b) },
    }), 'get_all_cpc_ads_daily_performance');
    const simpanToko = db.prepare(
      `INSERT OR REPLACE INTO iklan_toko_harian (shop_id, tanggal, dilihat, klik, biaya, omzet, omzet_langsung, terjual, terjual_langsung)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    db.exec('BEGIN');
    try {
      for (const d of Array.isArray(toko) ? toko : []) {
        const tgl = dariShopee(d.date);
        if (tgl) simpanToko.run(shopId, tgl, angka(d.impression), angka(d.clicks), angka(d.expense), angka(d.broad_gmv), angka(d.direct_gmv), angka(d.broad_item_sold), angka(d.direct_item_sold));
      }
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); throw err; }
  }

  return { kampanyeBaru, kampanyeDiperbarui: perluSetelan.length, barisHarian, dari, sampai, rekomendasi: perluRekomendasi.length - rekomendasiGagal };
}

// ---------- Baca untuk halaman Analisis Iklan ----------
// Status API → istilah Seller Centre (analisisIklan.js memakai 'Berjalan' untuk kampanye aktif).
const STATUS_TAMPIL = { ongoing: 'Berjalan', paused: 'Dijeda', scheduled: 'Terjadwal', ended: 'Berakhir', closed: 'Berakhir', deleted: 'Dihapus' };
const isoKeTampil = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const kosong = () => ({ dilihat: 0, klik: 0, biaya: 0, omzet: 0, omzetLangsung: 0, terjual: 0, terjualLangsung: 0 });

// Susun baris kampanye dengan bentuk yang sama seperti parseShopeeAdsCsv().kampanye, dari data
// tersimpan dalam [dari, sampai], supaya hitungAnalisisIklan() dipakai apa adanya. Tambahan:
// perHari { iso: { biaya, terjual } } (biaya iklan per hari yang sebenarnya, untuk kartu
// mingguan), campaignId, targetRoas, budgetHarian.
function kampanyeDariDb(db, shopId, dari, sampai) {
  shopId = String(shopId);
  const harian = db.prepare(
    `SELECT campaign_id, tanggal, dilihat, klik, biaya, omzet, omzet_langsung, terjual, terjual_langsung
     FROM iklan_harian WHERE shop_id = ? AND tanggal BETWEEN ? AND ? ORDER BY tanggal`
  ).all(shopId, dari, sampai);
  const infoKampanye = new Map(db.prepare('SELECT * FROM iklan_kampanye WHERE shop_id = ?').all(shopId).map((r) => [r.campaign_id, r]));

  const perKampanye = new Map();
  const jumlahPerHari = new Map(); // tanggal → jumlah semua kampanye (untuk selisih iklan toko)
  for (const h of harian) {
    let k = perKampanye.get(h.campaign_id);
    if (!k) { k = { ...kosong(), perHari: {} }; perKampanye.set(h.campaign_id, k); }
    const v = { dilihat: h.dilihat, klik: h.klik, biaya: h.biaya, omzet: h.omzet, omzetLangsung: h.omzet_langsung, terjual: h.terjual, terjualLangsung: h.terjual_langsung };
    for (const f of Object.keys(v)) k[f] += v[f];
    k.perHari[h.tanggal] = { biaya: h.biaya, terjual: h.terjual, omzet: h.omzet, omzetLangsung: h.omzet_langsung };
    const j = jumlahPerHari.get(h.tanggal) || kosong();
    for (const f of Object.keys(v)) j[f] += v[f];
    jumlahPerHari.set(h.tanggal, j);
  }
  // Kampanye yang sedang berjalan tapi belum ada angka (baru mulai) tetap ditampilkan.
  for (const [id, info] of infoKampanye) {
    if (info.status === 'ongoing' && !perKampanye.has(id) && (!info.mulai || info.mulai <= sampai)) perKampanye.set(id, { ...kosong(), perHari: {} });
  }

  const kampanye = [];
  for (const [id, t] of perKampanye) {
    const info = infoKampanye.get(id) || {};
    const tokoLevel = !info.id_produk;
    // Tanpa tanggal selesai: sampai hari ini (supaya umur kampanye berjalan terhitung benar).
    const selesaiIso = info.selesai || (info.status === 'ongoing' ? sampai : '');
    const mode = info.bidding_method === 'manual' ? 'Manual' : info.target_roas > 0 ? 'GMV Max ROAS' : 'GMV Max Auto';
    kampanye.push({
      namaIklan: info.nama_iklan || `Kampanye ${id}`,
      status: STATUS_TAMPIL[info.status] || info.status || '',
      kodeProduk: tokoLevel ? KODE_IKLAN_TOKO : info.id_produk,
      tokoLevel,
      modeBidding: mode,
      tanggalMulai: isoKeTampil(info.mulai),
      tanggalMulaiIso: info.mulai || '',
      tanggalSelesai: info.selesai ? isoKeTampil(info.selesai) : 'Tidak terbatas',
      tanggalSelesaiIso: selesaiIso,
      dilihat: t.dilihat, klik: t.klik, terjual: t.terjual, terjualLangsung: t.terjualLangsung,
      omzet: t.omzet, omzetLangsung: t.omzetLangsung, biaya: t.biaya,
      perHari: t.perHari,
      campaignId: id,
      targetRoas: info.target_roas || 0,
      budgetHarian: info.budget_harian || 0,
    });
  }

  // Iklan di luar kampanye produk = total toko − jumlah kampanye. Selisih per hari bisa minus
  // (Shopee mencatat total toko & per kampanye tidak persis bersamaan), jadi dijumlahkan BERSIH
  // dulu; baru totalnya yang tidak boleh minus.
  const toko = db.prepare(
    `SELECT tanggal, dilihat, klik, biaya, omzet, omzet_langsung, terjual, terjual_langsung
     FROM iklan_toko_harian WHERE shop_id = ? AND tanggal BETWEEN ? AND ? ORDER BY tanggal`
  ).all(shopId, dari, sampai);
  const sisa = { ...kosong(), perHari: {} };
  let mulaiSisa = '', akhirSisa = '';
  for (const d of toko) {
    const j = jumlahPerHari.get(d.tanggal) || kosong();
    const s = {
      dilihat: d.dilihat - j.dilihat, klik: d.klik - j.klik, biaya: d.biaya - j.biaya,
      omzet: d.omzet - j.omzet, omzetLangsung: d.omzet_langsung - j.omzetLangsung,
      terjual: d.terjual - j.terjual, terjualLangsung: d.terjual_langsung - j.terjualLangsung,
    };
    if (Math.abs(s.biaya) < 1) continue;
    for (const f of Object.keys(s)) sisa[f] += s[f];
    sisa.perHari[d.tanggal] = { biaya: s.biaya, terjual: s.terjual };
    if (s.biaya > 0) { if (!mulaiSisa) mulaiSisa = d.tanggal; akhirSisa = d.tanggal; }
  }
  for (const f of Object.keys(kosong())) sisa[f] = Math.max(0, sisa[f]);
  if (sisa.biaya >= 1) {
    // "Berjalan" hanya kalau masih ada biayanya 3 hari terakhir (selisih kecil bisa sekadar
    // beda waktu pencatatan Shopee).
    const baru = Object.entries(sisa.perHari).some(([tgl, v]) => tgl >= tambahHari(sampai, -2) && v.biaya >= 1000);
    const { perHari, ...angkaSisa } = sisa;
    kampanye.push({
      namaIklan: 'di luar kampanye produk',
      status: baru ? 'Berjalan' : 'Berakhir',
      kodeProduk: KODE_IKLAN_TOKO,
      tokoLevel: true,
      modeBidding: '',
      tanggalMulai: isoKeTampil(mulaiSisa), tanggalMulaiIso: mulaiSisa,
      tanggalSelesai: isoKeTampil(akhirSisa), tanggalSelesaiIso: akhirSisa,
      ...angkaSisa,
      perHari,
      campaignId: null, targetRoas: 0, budgetHarian: 0,
    });
  }

  // Setelan yang terpasang di Seller Centre per produk (kampanye yang sedang berjalan):
  // pengganti isian manual Target ROAS / Modal Harian (tabel iklan_setelan).
  const setelan = {};
  for (const info of infoKampanye.values()) {
    if (info.status !== 'ongoing' || !info.id_produk) continue;
    const s = setelan[info.id_produk] || (setelan[info.id_produk] = { target_roas: null, modal_harian: 0, tanpa_batas: false, mode: '' });
    if (info.target_roas > 0) s.target_roas = s.target_roas === null ? info.target_roas : Math.max(s.target_roas, info.target_roas);
    if (info.budget_harian > 0) s.modal_harian += info.budget_harian; else s.tanpa_batas = true;
    s.mode = info.target_roas > 0 ? 'GMV Max ROAS' : 'GMV Max Auto';
  }
  for (const s of Object.values(setelan)) if (!s.modal_harian) s.modal_harian = null;
  // Rekomendasi Target ROAS Shopee (rendah/tengah/tinggi) untuk produk yang sedang beriklan.
  for (const r of db.prepare('SELECT id_produk, rendah, tengah, tinggi FROM iklan_rekomendasi WHERE shop_id = ?').all(shopId)) {
    if (setelan[r.id_produk]) setelan[r.id_produk].rekomendasi = { rendah: r.rendah, tengah: r.tengah, tinggi: r.tinggi };
  }
  // Keep 90 days of changes, including ended campaigns, to detect overlapping store trials.
  const kampanyeBerjalan = new Set([...infoKampanye.values()].filter((i) => i.status === 'ongoing').map((i) => i.campaign_id));
  const riwayat = db.prepare(
    `SELECT campaign_id, id_produk, tanggal, target_lama, target_baru, modal_lama, modal_baru FROM iklan_riwayat_setelan
     WHERE shop_id = ? AND tanggal >= ? ORDER BY tanggal, id`
  ).all(shopId, tambahHari(sampai, -90));
  const riwayatSetelan = riwayat.map(r => ({ campaignId: r.campaign_id, idProduk: r.id_produk, tanggal: r.tanggal,
    targetLama: r.target_lama || null, targetBaru: r.target_baru || null,
    modalLama: r.modal_lama || null, modalBaru: r.modal_baru || null }));
  for (const r of riwayat) {
    const s = r.id_produk && setelan[r.id_produk];
    if (!s || !kampanyeBerjalan.has(r.campaign_id)) continue;
    s.perubahan = { tanggal: r.tanggal, targetLama: r.target_lama || null, targetBaru: r.target_baru || null, modalLama: r.modal_lama || null, modalBaru: r.modal_baru || null };
  }

  return { kampanye, setelan, riwayatSetelan, biayaTokoHarian: Object.fromEntries(toko.map(d => [d.tanggal, d.biaya])), adaData: harian.length > 0 || toko.length > 0 };
}

module.exports = { sinkronIklan, kampanyeDariDb, jendela };
