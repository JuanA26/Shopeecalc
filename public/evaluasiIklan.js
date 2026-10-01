/* Pure calculations shared by the API, browser and regression tests. */
(function (root) {
  const geser = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const tanggal = (dari, sampai) => {
    const hasil = [];
    for (let d = dari; d <= sampai; d = geser(d, 1)) hasil.push(d);
    return hasil;
  };

  // Seven full days, followed by seven full days for attribution. Never fill gaps with zero.
  function metrikTerbaru(kampanye, idProduk, perubahan, hariIni) {
    const sampai = geser(hariIni, -8), dari = geser(sampai, -6);
    const aktif = kampanye.filter(k => k.kodeProduk === idProduk && k.status === 'Berjalan');
    const siapTanggal = perubahan ? geser(perubahan.tanggal, 15) : null;
    if (siapTanggal && hariIni < siapTanggal) return { siap: false, alasan: 'waktu', siapTanggal, dari, sampai };
    if (!aktif.length || aktif.some(k => !k.tanggalMulaiIso || k.tanggalMulaiIso > dari)) {
      const mulai = aktif.map(k => k.tanggalMulaiIso).filter(Boolean).sort().pop();
      return { siap: false, alasan: 'waktu', siapTanggal: mulai ? geser(mulai, 14) : null, dari, sampai };
    }
    const m = { siap: true, dari, sampai, biaya: 0, omzet: 0, omzetLangsung: 0 };
    for (const k of aktif) for (const d of tanggal(dari, sampai)) {
      const v = k.perHari && k.perHari[d];
      if (!v || !['biaya', 'omzet', 'omzetLangsung'].every(f => Number.isFinite(v[f]))) {
        return { ...m, siap: false, alasan: 'data' };
      }
      for (const f of ['biaya', 'omzet', 'omzetLangsung']) m[f] += v[f];
    }
    m.roasLangsung = m.biaya ? m.omzetLangsung / m.biaya : null;
    m.roasShopee = m.biaya ? m.omzet / m.biaya : null;
    return m;
  }

  // Zone of one mature 7-day window (same order as analisisIklan.vonis): direct ROAS ≥ minimum → untung;
  // only Shopee's broad ROAS ≥ minimum → abu; else rugi. null = no ready window or no spend.
  const zonaJendela = (m, roasMin) => (!m || !m.siap || !(m.biaya > 0) || !(roasMin > 0) ? null
    : m.omzetLangsung / m.biaya >= roasMin ? 'untung' : m.omzet / m.biaya >= roasMin ? 'abu' : 'rugi');

  // A zone change counts only after the new zone held HARI_ZONA_TAHAN days in a row (user, 2026-10-01): one
  // sale more or less moved the 7-day zone of low-volume ads back and forth (replay 07/08–01/10: 40 changes,
  // 18 undone within a week; with the hold 9 and 2, accuracy unchanged; reports/verdict-stability-2026-10-01.md).
  // seri = raw zones oldest → newest; null (no ready window) restarts the history.
  const HARI_ZONA_TAHAN = 3;
  function tahanZona(seri) {
    let stabil = null, calon = null, n = 0;
    for (const z of seri) {
      if (!z) { stabil = calon = null; n = 0; continue; }
      if (stabil === null || z === stabil) { stabil = z; calon = null; n = 0; continue; }
      if (z === calon) n += 1; else { calon = z; n = 1; }
      if (n >= HARI_ZONA_TAHAN) { stabil = z; calon = null; n = 0; }
    }
    return { zona: stabil, mentah: seri.length ? seri[seri.length - 1] : null, hariBaru: calon ? n : 0 };
  }

  // Raw zones of the windows judged on each of the last `lihat` days up to hariIni, then the hold.
  function zonaStabil(kampanye, idProduk, perubahan, hariIni, roasMin, lihat = 28) {
    const seri = [];
    for (let i = lihat; i >= 0; i--) seri.push(zonaJendela(metrikTerbaru(kampanye, idProduk, perubahan, geser(hariIni, -i)), roasMin));
    return tahanZona(seri);
  }

  // Orders without HPP may be at most this share of the week's payout; they are estimated with the
  // margin of orders that do have HPP (same method as the weekly profit card).
  const BATAS_TANPA_HPP = 0.05;

  // Uses all store orders and actual shop ad spend, so cross-product sales are included.
  // A day without orders is unknown until order coverage can prove zero sales.
  // Returns { nilai (per day) | null, alasan: null | 'periode' | 'hpp' | 'hari', bagianTanpaHpp, produkTanpaHpp }.
  function rincianUntungToko(sumber, iklanHarian, dari, sampai) {
    const periode = sumber && sumber.ringkasan && sumber.ringkasan.periode;
    const hasil = { nilai: null, alasan: null, bagianTanpaHpp: 0, produkTanpaHpp: [] };
    if (!periode || periode.dari > dari || periode.sampai < sampai) return { ...hasil, alasan: 'periode' };
    const perHari = new Map(), tanpaHpp = new Map();
    let diketahui = 0, untungDiketahui = 0, kosong = 0;
    for (const it of sumber.items || []) {
      const d = String(it.waktuPesanan || '').slice(0, 10);
      if (d < dari || d > sampai) continue;
      if (!Number.isFinite(it.totalPenghasilan)) return { ...hasil, alasan: 'hari' };
      const h = perHari.get(d) || { tetap: 0, kosong: 0 };
      perHari.set(d, h);
      if (it.dikembalikan) h.tetap += it.totalPenghasilan;
      else if (Number.isFinite(it.hpp) && Number.isFinite(it.untung)) {
        h.tetap += it.untung; diketahui += it.totalPenghasilan; untungDiketahui += it.untung;
      } else {
        h.kosong += it.totalPenghasilan; kosong += it.totalPenghasilan;
        const k = it.idProduk || it.namaProduk || '?';
        const t = tanpaHpp.get(k) || { idProduk: it.idProduk || '', namaProduk: it.namaProduk || '', penghasilan: 0 };
        t.penghasilan += it.totalPenghasilan; tanpaHpp.set(k, t);
      }
    }
    hasil.bagianTanpaHpp = kosong > 0 ? kosong / (diketahui + kosong) : 0;
    hasil.produkTanpaHpp = [...tanpaHpp.values()].sort((a, b) => b.penghasilan - a.penghasilan);
    if (kosong > 0 && (!(diketahui > 0) || hasil.bagianTanpaHpp > BATAS_TANPA_HPP)) return { ...hasil, alasan: 'hpp' };
    const margin = diketahui > 0 ? untungDiketahui / diketahui : 0;
    let total = 0;
    for (const d of tanggal(dari, sampai)) {
      if (!perHari.has(d) || !iklanHarian || !Number.isFinite(iklanHarian[d])) return { ...hasil, alasan: 'hari' };
      const h = perHari.get(d);
      total += h.tetap + h.kosong * margin - iklanHarian[d];
    }
    return { ...hasil, nilai: total / 7 };
  }

  // Each change is judged by the changed ad's own profit (user, 2026-09-27). Store profit swings
  // ±400 rb/day between ordinary weeks, far more than one ad can move it, so it holds nothing
  // (store brake removed 30/09, user: every drop on record came with flat ad spend).
  // Thresholds = 80th percentile of |after − before| over 150 no-change windows on this shop's ads
  // (Jul–Sep 2026); smaller moves count as noise.
  const BEDA_LANGSUNG = 20000;
  const BEDA_SHOPEE = 60000;

  // Busy days (user, 30/09): store payout > 1.8 × the median day of the reference period (at least the
  // 28 days ending with `sampai`). Sale days (9.9, 25th, 15th) run 2–4× a normal day and swing any
  // comparison, so week comparisons and the per-ad before/after judge leave them out.
  // penghasilanHarian = { iso: store payout of that order date }; returns the busy days in dari…sampai.
  const BATAS_HARI_RAMAI = 1.8;
  const MIN_HARI_BIASA = 4;
  function hariRamai(penghasilanHarian, dari, sampai) {
    if (!penghasilanHarian) return [];
    const rentang = tanggal(dari, sampai);
    const acuan = tanggal(geser(sampai, 1 - Math.max(28, rentang.length)), sampai)
      .map(d => penghasilanHarian[d]).filter(n => n > 0).sort((a, b) => a - b);
    if (!acuan.length) return [];
    const tengah = (acuan[(acuan.length - 1) >> 1] + acuan[acuan.length >> 1]) / 2;
    return rentang.filter(d => penghasilanHarian[d] > BATAS_HARI_RAMAI * tengah);
  }

  // Per day over seven full days of one campaign: profit on the advertised product (langsung) and
  // a broad scenario (shopee). The broad scenario applies this SKU's margin to other products too;
  // keep it for context, never as the automatic setting-change verdict. Days in `lewati` (busy days)
  // are left out; the average is over the remaining days.
  function untungIklanHarian(k, dari, sampai, roasMin, lewati) {
    let biaya = 0, omzet = 0, omzetLangsung = 0, hari = 0;
    for (const d of tanggal(dari, sampai)) {
      if (lewati && lewati.has(d)) continue;
      const v = k.perHari && k.perHari[d];
      if (!v || !['biaya', 'omzet', 'omzetLangsung'].every(f => Number.isFinite(v[f]))) return null;
      biaya += v.biaya; omzet += v.omzet; omzetLangsung += v.omzetLangsung; hari += 1;
    }
    if (!hari) return null;
    return { biaya: biaya / hari, langsung: (omzetLangsung / roasMin - biaya) / hari, shopee: (omzet / roasMin - biaya) / hari, hari };
  }

  // The product's latest recorded change, judged at T+15.
  // Only direct contribution decides the automatic result; broad attribution is context.
  function hasilIklan(data, idProduk, hariIni, roasMin) {
    const riwayat = (data.riwayatSetelan || []).filter(u => u.idProduk === idProduk && u.tanggal <= hariIni);
    const u = riwayat[riwayat.length - 1];
    if (!u) return null;
    const t = u.tanggal;
    const hasil = { u, tanggal: t, cekLagi: geser(t, 15), baru: hariIni <= geser(t, 28) };
    if (hariIni < hasil.cekLagi) return { ...hasil, status: 'tunggu' };
    // Another edit of this product on the same day or in the seven days before is not a clean comparison.
    if (riwayat.some(v => v !== u && v.tanggal >= geser(t, -7))) return { ...hasil, status: 'campur' };
    const k = (data.kampanye || []).find(k => k.campaignId === u.campaignId);
    if (!k || !(roasMin > 0) || !data.dataSiapEvaluasi) return { ...hasil, status: 'data' };
    // Busy days in either week are left out of both averages (user, 30/09). A week needs at least
    // MIN_HARI_BIASA ordinary days; otherwise the busy stretch is the norm and all days are compared.
    let ramai = hariRamai(data.penghasilanHarian, geser(t, -7), geser(t, 7)).filter(d => d !== t);
    const biasa = (dari) => tanggal(dari, geser(dari, 6)).filter(d => !ramai.includes(d)).length;
    if (biasa(geser(t, -7)) < MIN_HARI_BIASA || biasa(geser(t, 1)) < MIN_HARI_BIASA) ramai = [];
    const lewati = new Set(ramai);
    const sebelum = untungIklanHarian(k, geser(t, -7), geser(t, -1), roasMin, lewati);
    const sesudah = untungIklanHarian(k, geser(t, 1), geser(t, 7), roasMin, lewati);
    if (!sebelum || !sesudah) return { ...hasil, ramai, status: 'data' };
    const bedaLangsung = sesudah.langsung - sebelum.langsung, bedaShopee = sesudah.shopee - sebelum.shopee;
    const status = bedaLangsung >= BEDA_LANGSUNG ? 'baik' : bedaLangsung <= -BEDA_LANGSUNG ? 'buruk' : 'belum-jelas';
    return { ...hasil, sebelum, sesudah, bedaLangsung, bedaShopee, status, ramai };
  }

  // Remember a raise followed by a return towards the old target; do not immediately repeat it.
  function pernahDikembalikan(riwayat, idProduk) {
    const daftar = (riwayat || []).filter(u => u.idProduk === idProduk);
    return daftar.some((u, i) => {
      const sebelum = daftar.slice(0, i).filter(v => v.campaignId === u.campaignId).pop();
      return sebelum && sebelum.targetBaru > sebelum.targetLama && sebelum.targetLama > 0 &&
        u.targetLama === sebelum.targetBaru && u.targetBaru < u.targetLama && u.targetBaru >= sebelum.targetLama;
    });
  }

  function terapkanEvaluasiToko(baris, data, dasarLengkap, hariIni) {
    const ubah = new Set(['naikkan', 'turunkan', 'tambah', 'kurangi']);
    // ditahan = the change that was held back.
    const tahan = (b, alasan) => { if (ubah.has(b.keputusan)) b.ditahan = b.keputusan; b.keputusan = 'tunggu'; b.alasan = alasan; b.targetBaru = null; b.modalBaru = b.modal; };
    // Each ad is judged on its own direct sales, so several ads may be changed at once (user, 30/09).
    // New changes wait only for complete data (sync, HPP, the latest 7 mature days).
    const tahanUji = !data.dataSiapEvaluasi || !dasarLengkap ? 'data-toko' : null;
    for (const b of baris) {
      if (['jeda', 'isi-hpp', 'toko', 'ganti'].includes(b.keputusan)) continue;
      const h = hariIni ? hasilIklan(data, b.p.idProduk, hariIni, b.p.roasImpas) : null;
      b.hasilIklan = h;
      const u = h && h.u;
      const hanyaTarget = !!u && u.targetLama > 0 && u.targetBaru > 0 && u.targetBaru !== u.targetLama && u.modalLama === u.modalBaru;
      const hanyaModal = !!u && u.modalLama > 0 && u.modalBaru > 0 && u.modalBaru !== u.modalLama && u.targetLama === u.targetBaru;
      const naikTarget = hanyaTarget && u.targetBaru > u.targetLama;
      if (h && h.status === 'buruk' && b.target === u.targetBaru && b.modal === u.modalBaru && (hanyaTarget || hanyaModal)) {
        // Back towards the old value, at most 20% per step.
        b.keputusan = 'kembalikan'; b.alasan = 'untung-iklan-turun'; b.targetBaru = null; b.modalBaru = b.modal;
        if (hanyaModal) b.modalBaru = u.modalLama;
        else b.targetBaru = naikTarget ? Math.max(u.targetLama, Math.ceil((b.target / 1.2) * 10 - 1e-9) / 10)
          : Math.min(u.targetLama, Math.floor(b.target * 1.2 * 10 + 1e-9) / 10);
      } else if (h && h.baru && h.status === 'buruk') {
        tahan(b, 'tinjau-iklan'); b.keputusan = 'tinjau'; // several settings changed together: the owner decides
      } else if (h && h.baru && ['campur', 'data'].includes(h.status)) {
        tahan(b, h.status === 'campur' ? 'uji-campur' : 'data-iklan');
      } else if (h && naikTarget && ['belum-jelas', 'buruk'].includes(h.status) && b.keputusan === 'naikkan') {
        // A raise without a clear gain is not repeated: higher targets shrink volume.
        b.keputusan = 'lanjut'; b.alasan = 'belum-jelas'; b.targetBaru = null; b.modalBaru = b.modal;
      } else if (ubah.has(b.keputusan) && pernahDikembalikan(data.riwayatSetelan, b.p.idProduk)) {
        tahan(b, 'sudah-kembali');
      } else if (h && h.baru && h.status === 'baik' && b.keputusan === 'lanjut') {
        b.alasan = 'hasil-baik';
      } else if (h && h.baru && h.status === 'belum-jelas' && b.keputusan === 'lanjut') {
        b.alasan = 'belum-jelas';
      }
    }
    // Reversals, reviews and replacements are never held.
    if (tahanUji) for (const b of baris) {
      if (['jeda', 'isi-hpp', 'toko', 'ganti', 'kembalikan', 'tinjau'].includes(b.keputusan)) continue;
      tahan(b, tahanUji);
    }
    return baris;
  }

  const api = { geser, metrikTerbaru, zonaJendela, HARI_ZONA_TAHAN, tahanZona, zonaStabil, rincianUntungToko, BATAS_TANPA_HPP, BEDA_LANGSUNG, BEDA_SHOPEE, BATAS_HARI_RAMAI, hariRamai,
    untungIklanHarian, hasilIklan, pernahDikembalikan, terapkanEvaluasiToko };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EvaluasiIklan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
