// Ekspor data diagnostik (halaman Pengaturan → "Unduh data"): satu workbook Excel untuk dianalisis
// Claude/pemilik. Hanya data toko (pesanan, HPP, iklan, riwayat setelan, status sinkron). TIDAK
// memuat token, kata sandi, atau data pembeli (username pembeli memang tidak disimpan).
const geser = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const seninDari = (iso) => { const d = new Date(iso + 'T00:00:00Z'); return geser(iso, -((d.getUTCDay() + 6) % 7)); };
const bagi = (a, b) => (b ? a / b : null);
const bulat = (n, d = 0) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);

// Kelompok untung per tanggal/minggu/bulan. untung_perkiraan memakai cara kartu mingguan aplikasi:
// baris tanpa HPP diperkirakan pakai margin baris ber-HPP di kelompok yang sama, + saldo retur.
function kelompokkan(items, kunci) {
  const peta = new Map();
  for (const it of items) {
    const d = String(it.waktuPesanan || '').slice(0, 10);
    if (!d) continue;
    const k = kunci(d);
    let g = peta.get(k);
    if (!g) {
      g = { kunci: k, pesanan: new Set(), pcs: 0, omzet: 0, penghasilan: 0, penghasilanHpp: 0, hpp: 0, untungDiketahui: 0,
        saldoRetur: 0, pcsRetur: 0, penghasilanBelumCair: 0, pesananBelumCair: new Set() };
      peta.set(k, g);
    }
    if (it.dikembalikan) { g.saldoRetur += it.totalPenghasilan || 0; g.pcsRetur += it.jumlah || 0; continue; }
    g.pesanan.add(it.noPesanan); g.pcs += it.jumlah || 0; g.omzet += it.hargaProduk || 0; g.penghasilan += it.totalPenghasilan || 0;
    if (it.perkiraan) { g.penghasilanBelumCair += it.totalPenghasilan || 0; g.pesananBelumCair.add(it.noPesanan); }
    if (it.hpp !== null && it.untung !== null) { g.penghasilanHpp += it.totalPenghasilan || 0; g.hpp += it.hppTotal || 0; g.untungDiketahui += it.untung; }
  }
  for (const g of peta.values()) {
    const margin = bagi(g.untungDiketahui, g.penghasilanHpp) ?? 0;
    g.untungPerkiraan = g.untungDiketahui + (g.penghasilan - g.penghasilanHpp) * margin + g.saldoRetur;
    g.bagianTanpaHpp = bagi(g.penghasilan - g.penghasilanHpp, g.penghasilan);
  }
  return peta;
}

function susunEkspor(db, shopId, { margin, rasioPerkiraan, bacaItemPesanan, hariIni, keputusan, versi, sinkron }) {
  const shop = String(shopId);
  const awal = db.prepare(`SELECT MIN(t) AS t FROM (SELECT MIN(tanggal_pesanan) AS t FROM api_order WHERE shop_id = ?
    UNION ALL SELECT MIN(waktu_pesanan) FROM api_pesanan WHERE shop_id = ? AND waktu_pesanan <> '')`).get(shop, shop).t || hariIni;
  const items = margin(bacaItemPesanan(db, shop, String(awal).slice(0, 10), hariIni, rasioPerkiraan)).items;

  // ---- Iklan ----
  const kampanye = db.prepare('SELECT * FROM iklan_kampanye WHERE shop_id = ? ORDER BY mulai DESC').all(shop);
  const produkKampanye = new Map(kampanye.map((k) => [k.campaign_id, k.id_produk]));
  const namaKampanye = new Map(kampanye.map((k) => [k.campaign_id, k.nama_iklan]));
  const harian = db.prepare('SELECT * FROM iklan_harian WHERE shop_id = ? ORDER BY tanggal, campaign_id').all(shop);
  const tokoHarian = db.prepare('SELECT * FROM iklan_toko_harian WHERE shop_id = ? ORDER BY tanggal').all(shop);
  const rekomendasi = new Map(db.prepare('SELECT * FROM iklan_rekomendasi WHERE shop_id = ?').all(shop).map((r) => [r.id_produk, r]));
  const riwayat = db.prepare('SELECT * FROM iklan_riwayat_setelan WHERE shop_id = ? ORDER BY tanggal, id').all(shop);
  const biayaToko = new Map(tokoHarian.map((r) => [r.tanggal, r]));
  const biayaKampanyeHari = new Map();
  for (const h of harian) biayaKampanyeHari.set(h.tanggal, (biayaKampanyeHari.get(h.tanggal) || 0) + h.biaya);

  // ---- Harian / mingguan / bulanan ----
  const perHari = kelompokkan(items, (d) => d);
  const iklanKelompok = (kunci) => {
    const peta = new Map();
    for (const r of tokoHarian) {
      const k = kunci(r.tanggal);
      const g = peta.get(k) || { biaya: 0, omzet: 0, omzetLangsung: 0, terjual: 0, hari: 0 };
      g.biaya += r.biaya; g.omzet += r.omzet; g.omzetLangsung += r.omzet_langsung; g.terjual += r.terjual; g.hari += 1;
      peta.set(k, g);
    }
    return peta;
  };
  const kolomRingkas = ['pesanan', 'pcs', 'omzet', 'penghasilan', 'penghasilan_belum_cair', 'hpp', 'untung_diketahui',
    'bagian_penghasilan_tanpa_hpp', 'saldo_retur', 'pcs_retur', 'untung_perkiraan', 'biaya_iklan_toko', 'hari_data_iklan',
    'omzet_iklan_shopee', 'omzet_iklan_langsung', 'pcs_diklaim_iklan', 'untung_setelah_iklan', 'biaya_iklan_persen_omzet'];
  const barisRingkas = (g, ik, hariPeriode) => {
    const iklanLengkap = ik && ik.hari === hariPeriode;
    return [g.pesanan.size, g.pcs, bulat(g.omzet), bulat(g.penghasilan), bulat(g.penghasilanBelumCair), bulat(g.hpp), bulat(g.untungDiketahui),
      bulat(g.bagianTanpaHpp, 4), bulat(g.saldoRetur), g.pcsRetur, bulat(g.untungPerkiraan),
      ik ? bulat(ik.biaya) : null, ik ? ik.hari : 0, ik ? bulat(ik.omzet) : null, ik ? bulat(ik.omzetLangsung) : null, ik ? bulat(ik.terjual) : null,
      iklanLengkap ? bulat(g.untungPerkiraan - ik.biaya) : null, ik && g.omzet ? bulat(ik.biaya / g.omzet, 4) : null];
  };
  const iklanHari = iklanKelompok((d) => d);
  const hariSemua = [...new Set([...perHari.keys(), ...iklanHari.keys()])].sort();
  const kosong = () => ({ pesanan: new Set(), pcs: 0, omzet: 0, penghasilan: 0, penghasilanBelumCair: 0, hpp: 0,
    untungDiketahui: 0, bagianTanpaHpp: null, saldoRetur: 0, pcsRetur: 0, untungPerkiraan: 0 });
  const sheetHarian = hariSemua.map((d) => {
    const ik = iklanHari.get(d);
    return [d, ...barisRingkas(perHari.get(d) || kosong(), ik, 1), ik ? bulat(biayaKampanyeHari.get(d) || 0) : null];
  });

  const perMinggu = kelompokkan(items, seninDari), iklanMinggu = iklanKelompok(seninDari);
  const mingguSemua = [...new Set([...perMinggu.keys(), ...iklanMinggu.keys()])].sort();
  const sheetMingguan = mingguSemua.map((m) => {
    const selesai = geser(m, 6);
    const lengkap = selesai < geser(hariIni, -7);
    return [m, selesai, lengkap ? 'ya' : 'belum (pesanan bisa batal / atribusi iklan belum matang)', ...barisRingkas(perMinggu.get(m) || kosong(), iklanMinggu.get(m), 7)];
  });

  const bulanDari = (d) => d.slice(0, 7);
  const perBulan = kelompokkan(items, bulanDari), iklanBulan = iklanKelompok(bulanDari);
  const bulanSemua = [...new Set([...perBulan.keys(), ...iklanBulan.keys()])].sort();
  const hariDalamBulan = (b) => new Date(Date.UTC(+b.slice(0, 4), +b.slice(5, 7), 0)).getUTCDate();
  const sheetBulanan = bulanSemua.map((b) => [b, ...barisRingkas(perBulan.get(b) || kosong(), iklanBulan.get(b), b === hariIni.slice(0, 7) ? Number(hariIni.slice(8)) : hariDalamBulan(b))]);

  // ---- Produk ----
  const hppRows = db.prepare('SELECT id_produk, nama_produk, hpp, updated_at FROM product_hpp ORDER BY nama_produk').all();
  const hppMap = new Map(hppRows.map((r) => [r.id_produk, r]));
  const produk = new Map();
  const ambilProduk = (id, nama) => {
    let p = produk.get(id);
    if (!p) { p = { id, nama: nama || '', pcs: 0, omzet: 0, penghasilan: 0, untung: 0, pcsHpp: 0, pcsRetur: 0, pertama: '', terakhir: '', biayaIklan: 0, omzetIklan: 0, omzetLangsung: 0, terjualLangsung: 0 }; produk.set(id, p); }
    if (!p.nama && nama) p.nama = nama;
    return p;
  };
  for (const it of items) {
    const p = ambilProduk(it.idProduk, it.namaProduk);
    const d = String(it.waktuPesanan || '').slice(0, 10);
    if (it.dikembalikan) { p.pcsRetur += it.jumlah || 0; continue; }
    p.pcs += it.jumlah || 0; p.omzet += it.hargaProduk || 0; p.penghasilan += it.totalPenghasilan || 0;
    if (it.untung !== null) { p.untung += it.untung; p.pcsHpp += it.jumlah || 0; }
    if (d && (!p.pertama || d < p.pertama)) p.pertama = d;
    if (d > p.terakhir) p.terakhir = d;
  }
  for (const h of harian) {
    const id = produkKampanye.get(h.campaign_id);
    if (!id) continue;
    const p = ambilProduk(id, namaKampanye.get(h.campaign_id));
    p.biayaIklan += h.biaya; p.omzetIklan += h.omzet; p.omzetLangsung += h.omzet_langsung; p.terjualLangsung += h.terjual_langsung;
  }
  const berjalan = new Set(kampanye.filter((k) => k.status === 'ongoing').map((k) => k.id_produk));
  const sheetProduk = [...produk.values()].sort((a, b) => b.omzet - a.omzet).map((p) => {
    const h = hppMap.get(p.id);
    return [p.id, p.nama, h ? h.hpp : null, p.pcs, bulat(p.omzet), bulat(p.penghasilan), h ? bulat(p.untung) : null,
      h ? bulat(bagi(p.untung, p.penghasilan), 4) : null, p.pcsRetur, p.pertama, p.terakhir, bulat(p.biayaIklan), bulat(p.omzetIklan),
      bulat(p.omzetLangsung), bulat(p.terjualLangsung), bulat(bagi(p.omzetLangsung, p.biayaIklan), 2), berjalan.has(p.id) ? 'ya' : ''];
  });

  // ---- Kampanye ----
  const totalKampanye = new Map();
  for (const h of harian) {
    const t = totalKampanye.get(h.campaign_id) || { biaya: 0, omzet: 0, omzetLangsung: 0, terjual: 0, terjualLangsung: 0, klik: 0, dilihat: 0, hari: 0, pertama: '', terakhir: '' };
    t.biaya += h.biaya; t.omzet += h.omzet; t.omzetLangsung += h.omzet_langsung; t.terjual += h.terjual; t.terjualLangsung += h.terjual_langsung;
    t.klik += h.klik; t.dilihat += h.dilihat; t.hari += 1;
    if (!t.pertama || h.tanggal < t.pertama) t.pertama = h.tanggal;
    if (h.tanggal > t.terakhir) t.terakhir = h.tanggal;
    totalKampanye.set(h.campaign_id, t);
  }
  const sheetKampanye = kampanye.map((k) => {
    const t = totalKampanye.get(k.campaign_id) || {};
    const r = rekomendasi.get(k.id_produk) || {};
    const mode = k.target_roas ? 'GMV Max ROAS' : 'GMV Max Auto';
    return [k.campaign_id, k.id_produk, k.nama_iklan, k.status, mode, k.target_roas || null, k.budget_harian === 0 ? 'tanpa batas' : k.budget_harian,
      k.mulai, k.selesai || 'tidak terbatas', r.rendah ?? null, r.tengah ?? null, r.tinggi ?? null,
      bulat(t.biaya), bulat(t.omzet), bulat(t.omzetLangsung), t.terjual ?? null, t.terjualLangsung ?? null, t.klik ?? null, t.dilihat ?? null,
      bulat(bagi(t.omzet, t.biaya), 2), bulat(bagi(t.omzetLangsung, t.biaya), 2), t.hari ?? 0, t.pertama || '', t.terakhir || ''];
  });

  const sheetIklanHarian = harian.map((h) => [h.tanggal, h.campaign_id, produkKampanye.get(h.campaign_id) || '', h.dilihat, h.klik, bulat(h.biaya),
    bulat(h.omzet), bulat(h.omzet_langsung), h.terjual, h.terjual_langsung, bulat(bagi(h.omzet, h.biaya), 2), bulat(bagi(h.omzet_langsung, h.biaya), 2)]);
  const sheetIklanToko = tokoHarian.map((r) => {
    const kamp = biayaKampanyeHari.get(r.tanggal) || 0;
    return [r.tanggal, r.dilihat, r.klik, bulat(r.biaya), bulat(r.omzet), bulat(r.omzet_langsung), r.terjual, r.terjual_langsung, bulat(kamp), bulat(r.biaya - kamp)];
  });

  // ---- Riwayat setelan + sebelum/sesudah ----
  // Kampanye: 7 hari sebelum (T−7…T−1) vs 7 hari sesudah (T+1…T+7), hari perubahan dilewati.
  // Toko: untung perkiraan semua produk − biaya iklan toko, rentang yang sama. Observasi, bukan bukti sebab.
  const jumlahRentang = (dari, sampai, fn) => { let t = 0, n = 0; for (let d = dari; d <= sampai; d = geser(d, 1)) { const v = fn(d); if (v !== null) { t += v; n += 1; } } return { t, n }; };
  const harianPer = new Map();
  for (const h of harian) harianPer.set(`${h.campaign_id}|${h.tanggal}`, h);
  const sheetRiwayat = riwayat.map((u) => {
    const s0 = geser(u.tanggal, -7), s1 = geser(u.tanggal, -1), p0 = geser(u.tanggal, 1), p1 = geser(u.tanggal, 7);
    const kamp = (f) => (d) => { const h = harianPer.get(`${u.campaign_id}|${d}`); return h ? h[f] : (biayaToko.has(d) ? 0 : null); };
    const untung = (d) => (perHari.has(d) && biayaToko.has(d) ? perHari.get(d).untungPerkiraan - biayaToko.get(d).biaya : null);
    const b = { biaya: jumlahRentang(s0, s1, kamp('biaya')), omzet: jumlahRentang(s0, s1, kamp('omzet')), langsung: jumlahRentang(s0, s1, kamp('omzet_langsung')), toko: jumlahRentang(s0, s1, untung) };
    const a = { biaya: jumlahRentang(p0, p1, kamp('biaya')), omzet: jumlahRentang(p0, p1, kamp('omzet')), langsung: jumlahRentang(p0, p1, kamp('omzet_langsung')), toko: jumlahRentang(p0, p1, untung) };
    const lain = riwayat.filter((v) => v.id !== u.id && v.tanggal >= s0 && v.tanggal <= p1).length;
    const jenis = [u.target_baru !== u.target_lama ? (u.target_baru > u.target_lama ? 'target naik' : 'target turun') : '',
      u.modal_baru !== u.modal_lama ? (u.modal_baru > u.modal_lama ? 'modal naik' : 'modal turun') : ''].filter(Boolean).join(' + ');
    return [u.tanggal, u.campaign_id, u.id_produk, namaKampanye.get(u.campaign_id) || '', jenis, u.target_lama, u.target_baru, u.modal_lama, u.modal_baru,
      bulat(b.biaya.t), bulat(b.omzet.t), bulat(b.langsung.t), bulat(bagi(b.langsung.t, b.biaya.t), 2),
      bulat(a.biaya.t), bulat(a.omzet.t), bulat(a.langsung.t), bulat(bagi(a.langsung.t, a.biaya.t), 2),
      b.toko.n === 7 ? bulat(b.toko.t / 7) : null, a.toko.n === 7 ? bulat(a.toko.t / 7) : null, b.toko.n, a.toko.n,
      hariIni >= geser(u.tanggal, 15) ? 'ya' : `belum (matang ${geser(u.tanggal, 15)})`, lain];
  });

  // ---- Keputusan aplikasi saat ini (dikirim halaman, karena dihitung di browser) ----
  const sheetKeputusan = (Array.isArray(keputusan) ? keputusan : []).slice(0, 300).map((k) => [
    k.idProduk, k.namaProduk, k.keputusan, k.label, k.kalimat, k.alasan, k.zona, k.target, k.targetBaru, k.modal, k.modalBaru,
    k.batasShopee, k.roasLangsung, k.roasMinimum, k.berakhir, k.bisaDiubahLagi,
  ].map((v) => (typeof v === 'string' ? v.slice(0, 500) : typeof v === 'number' && Number.isFinite(v) ? v : v === null || v === undefined ? null : String(v).slice(0, 500))));

  // ---- Status & README ----
  const cair = new Set(items.filter((i) => !i.perkiraan).map((i) => i.noPesanan)).size;
  const belumCair = new Set(items.filter((i) => i.perkiraan).map((i) => i.noPesanan)).size;
  const tanpaHpp = [...produk.values()].filter((p) => !hppMap.has(p.id) && p.pcs > 0).length;
  const sheetStatus = [
    ['dibuat', new Date().toISOString()], ['hari_ini_wib', hariIni], ['versi_aplikasi', versi || 'lokal'],
    ['data_pesanan_dari', String(awal).slice(0, 10)], ['data_pesanan_sampai', hariIni],
    ['pesanan_sudah_cair', cair], ['pesanan_belum_cair', belumCair], ['baris_barang', items.length],
    ['produk_terjual_tanpa_hpp', tanpaHpp], ['produk_dengan_hpp', hppRows.length],
    ['rasio_pencairan_perkiraan', bulat(rasioPerkiraan, 4)],
    ['kampanye_iklan', kampanye.length], ['kampanye_berjalan', kampanye.filter((k) => k.status === 'ongoing').length],
    ['data_iklan_dari', tokoHarian[0]?.tanggal || ''], ['data_iklan_sampai', tokoHarian[tokoHarian.length - 1]?.tanggal || ''],
    ['perubahan_setelan_tercatat', riwayat.length],
    ...Object.entries(sinkron || {}).map(([k, v]) => [k, v]),
    ...db.prepare('SELECT kunci, nilai FROM pengaturan ORDER BY kunci').all().map((r) => [`pengaturan.${r.kunci}`, r.nilai]),
  ];

  const readme = [
    ['Tentang file', 'Data toko Happy Shop Bjm dari aplikasi Shopee Margin Calc, untuk dianalisis (mis. oleh Claude). Mata uang Rupiah; tanggal = WIB (YYYY-MM-DD); tanggal pesanan kecuali disebut lain.'],
    ['Privasi', 'Tidak ada token, kata sandi, atau data pembeli. No. pesanan hanya untuk mencocokkan dengan Seller Centre.'],
    ['Status', 'Status sinkron, cakupan data, versi aplikasi, pengaturan.'],
    ['Bulanan / Mingguan / Harian', 'Untung toko per periode. untung_diketahui = penghasilan − HPP (hanya barang ber-HPP). untung_perkiraan = untung_diketahui + penghasilan tanpa HPP × margin barang ber-HPP periode itu + saldo_retur. untung_setelah_iklan = untung_perkiraan − biaya_iklan_toko, hanya kalau data iklan lengkap setiap hari. Minggu = Senin–Minggu.'],
    ['Pesanan_Item', 'Satu baris per barang per pesanan. penghasilan = bagian dana cair (escrow) untuk barang itu. perkiraan = ya → dana belum cair, penghasilan diperkirakan dari rasio pencairan toko. dikembalikan = ya → barang diretur; HPP tidak dibebankan (stok dianggap kembali), penghasilan = saldo retur.'],
    ['Produk', 'Total per produk seluruh periode + biaya dan omzet iklan produk itu.'],
    ['HPP', 'Harga modal per pcs yang diisi di aplikasi. Produk tanpa baris di sini belum punya HPP.'],
    ['Iklan_Kampanye / Iklan_Harian', 'Kampanye GMV Max dari Shopee Ads API. omzet = atribusi luas Shopee (termasuk produk lain, 7 hari setelah klik, termasuk pesanan batal). omzet_langsung = hanya produk yang diiklankan. Angka hari terakhir masih bisa naik sampai 7 hari.'],
    ['Iklan_Toko_Harian', 'Total iklan seluruh toko per hari. selisih = iklan di luar kampanye produk (iklan toko).'],
    ['Riwayat_Setelan', 'Setiap perubahan Target ROAS / Modal Harian yang terlihat saat sinkron. Sebelum = 7 hari sebelum tanggal perubahan, sesudah = 7 hari setelahnya (hari perubahan dilewati). untung_toko_per_hari = untung perkiraan semua produk − biaya iklan toko (rata-rata 7 hari; kosong kalau ada hari tanpa data). matang = sudah lewat 15 hari (atribusi lengkap). perubahan_lain_berdekatan > 0 berarti hasil bercampur. Ini observasi, bukan bukti sebab-akibat.'],
    ['Keputusan_Sekarang', 'Saran aplikasi untuk tiap iklan yang sedang berjalan saat file diunduh (sama dengan halaman Analisis Iklan). Kosong kalau data iklan belum termuat di halaman.'],
    ['Aturan aplikasi', 'Tujuan: untung toko per minggu setelah iklan. Target ROAS naik ≤ 20% per langkah, batas = rekomendasi tertinggi Shopee × 1,25. Satu percobaan iklan pada satu waktu; hasil dinilai setelah 15 hari dengan membandingkan untung toko sebelum/sesudah.'],
    ['Saran pertanyaan untuk Claude', 'Mis.: "Analisis tren untung toko per minggu", "Apakah perubahan target di Riwayat_Setelan menaikkan untung toko?", "Produk mana yang untung setelah biaya iklan?", "Cek data yang janggal atau tidak lengkap".'],
  ];

  const kolomKep = ['id_produk', 'nama_produk', 'keputusan', 'label', 'saran', 'alasan_kode', 'zona', 'target_sekarang', 'target_saran', 'modal_sekarang',
    'modal_saran', 'batas_target_shopee', 'roas_langsung_penilaian', 'roas_minimum', 'iklan_berakhir', 'bisa_diubah_lagi'];

  return [
    { nama: 'README', kolom: ['bagian', 'penjelasan'], baris: readme },
    { nama: 'Status', kolom: ['kunci', 'nilai'], baris: sheetStatus },
    { nama: 'Keputusan_Sekarang', kolom: kolomKep, baris: sheetKeputusan },
    { nama: 'Riwayat_Setelan', kolom: ['tanggal', 'campaign_id', 'id_produk', 'nama_iklan', 'jenis', 'target_lama', 'target_baru', 'modal_lama', 'modal_baru',
      'sebelum_biaya', 'sebelum_omzet_shopee', 'sebelum_omzet_langsung', 'sebelum_roas_langsung', 'sesudah_biaya', 'sesudah_omzet_shopee',
      'sesudah_omzet_langsung', 'sesudah_roas_langsung', 'sebelum_untung_toko_per_hari', 'sesudah_untung_toko_per_hari', 'hari_data_sebelum',
      'hari_data_sesudah', 'matang', 'perubahan_lain_berdekatan'], baris: sheetRiwayat },
    { nama: 'Bulanan', kolom: ['bulan', ...kolomRingkas], baris: sheetBulanan },
    { nama: 'Mingguan', kolom: ['senin', 'minggu', 'lengkap', ...kolomRingkas], baris: sheetMingguan },
    { nama: 'Harian', kolom: ['tanggal', ...kolomRingkas, 'biaya_iklan_kampanye_produk'], baris: sheetHarian },
    { nama: 'Produk', kolom: ['id_produk', 'nama_produk', 'hpp_per_pcs', 'pcs', 'omzet', 'penghasilan', 'untung', 'margin_dari_penghasilan', 'pcs_retur',
      'pertama_terjual', 'terakhir_terjual', 'biaya_iklan', 'omzet_iklan_shopee', 'omzet_iklan_langsung', 'pcs_iklan_langsung', 'roas_langsung', 'sedang_diiklankan'], baris: sheetProduk },
    { nama: 'HPP', kolom: ['id_produk', 'nama_produk', 'hpp_per_pcs', 'diubah'], baris: hppRows.map((r) => [r.id_produk, r.nama_produk, r.hpp, r.updated_at]) },
    { nama: 'Iklan_Kampanye', kolom: ['campaign_id', 'id_produk', 'nama_iklan', 'status', 'mode', 'target_roas', 'modal_harian', 'mulai', 'selesai',
      'rekomendasi_rendah', 'rekomendasi_tengah', 'rekomendasi_tinggi', 'biaya', 'omzet_shopee', 'omzet_langsung', 'pcs_shopee', 'pcs_langsung',
      'klik', 'dilihat', 'roas_shopee', 'roas_langsung', 'hari_ada_data', 'data_pertama', 'data_terakhir'], baris: sheetKampanye },
    { nama: 'Iklan_Harian', kolom: ['tanggal', 'campaign_id', 'id_produk', 'dilihat', 'klik', 'biaya', 'omzet_shopee', 'omzet_langsung', 'pcs_shopee',
      'pcs_langsung', 'roas_shopee', 'roas_langsung'], baris: sheetIklanHarian },
    { nama: 'Iklan_Toko_Harian', kolom: ['tanggal', 'dilihat', 'klik', 'biaya', 'omzet_shopee', 'omzet_langsung', 'pcs_shopee', 'pcs_langsung',
      'biaya_kampanye_produk', 'selisih_iklan_toko'], baris: sheetIklanToko },
    { nama: 'Pesanan_Item', kolom: ['tanggal_pesanan', 'no_pesanan', 'id_produk', 'nama_produk', 'variasi', 'pcs', 'harga_produk', 'penghasilan', 'hpp_per_pcs',
      'hpp_total', 'untung', 'margin_persen', 'dikembalikan', 'jumlah_pengembalian', 'perkiraan', 'tanggal_dana_cair', 'status'],
    baris: items.map((it) => [String(it.waktuPesanan || '').slice(0, 10), it.noPesanan, it.idProduk, it.namaProduk, it.namaModel, it.jumlah,
      bulat(it.hargaProduk), bulat(it.totalPenghasilan), it.hpp, bulat(it.hppTotal), bulat(it.untung), bulat(it.marginPersen, 2),
      it.dikembalikan ? 'ya' : '', bulat(it.jumlahPengembalian), it.perkiraan ? 'ya' : '', it.tanggalDilepaskan || '', it.statusPesanan || ''])
      .sort((a, b) => a[0].localeCompare(b[0]) || String(a[1]).localeCompare(String(b[1]))) },
  ];
}

module.exports = { susunEkspor, kelompokkan };
