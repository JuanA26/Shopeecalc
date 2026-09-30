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
  const untungToko = (sumber, iklanHarian, dari, sampai) => rincianUntungToko(sumber, iklanHarian, dari, sampai).nilai;

  // Each change is judged by the changed ad's own profit (user, 2026-09-27). Store profit swings
  // ±400 rb/day between ordinary weeks, far more than one ad can move it, so it is only a safety check.
  // Thresholds = 80th percentile of |after − before| over 150 no-change windows on this shop's ads
  // (Jul–Sep 2026); smaller moves count as noise. Store limit ≈ 90th percentile of store windows.
  const BEDA_LANGSUNG = 20000;
  const BEDA_SHOPEE = 60000;
  const BATAS_TURUN_TOKO = 700000;

  // Per day over seven full days of one campaign: profit on the advertised product (langsung) and
  // a broad scenario (shopee). The broad scenario applies this SKU's margin to other products too;
  // keep it for context, never as the automatic setting-change verdict.
  function untungIklanHarian(k, dari, sampai, roasMin) {
    let biaya = 0, omzet = 0, omzetLangsung = 0;
    for (const d of tanggal(dari, sampai)) {
      const v = k.perHari && k.perHari[d];
      if (!v || !['biaya', 'omzet', 'omzetLangsung'].every(f => Number.isFinite(v[f]))) return null;
      biaya += v.biaya; omzet += v.omzet; omzetLangsung += v.omzetLangsung;
    }
    return { biaya: biaya / 7, langsung: (omzetLangsung / roasMin - biaya) / 7, shopee: (omzet / roasMin - biaya) / 7 };
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
    const sebelum = untungIklanHarian(k, geser(t, -7), geser(t, -1), roasMin);
    const sesudah = untungIklanHarian(k, geser(t, 1), geser(t, 7), roasMin);
    if (!sebelum || !sesudah) return { ...hasil, status: 'data' };
    const bedaLangsung = sesudah.langsung - sebelum.langsung, bedaShopee = sesudah.shopee - sebelum.shopee;
    const status = bedaLangsung >= BEDA_LANGSUNG ? 'baik' : bedaLangsung <= -BEDA_LANGSUNG ? 'buruk' : 'belum-jelas';
    return { ...hasil, sebelum, sesudah, bedaLangsung, bedaShopee, status };
  }

  // Rolling store safety check (user, 30/09): whole-store profit per day over the latest 7 mature days
  // (today−14…today−8) vs the 7 days before. It works while several ads change on different days and
  // never reverses anything; a drop ≥ BATAS_TURUN_TOKO holds new changes until it no longer shows.
  // On the 29/09 export (52 windows, Aug–Sep) it fired on 1 day in 52 without a known cause.
  function cekToko(data, sumber, hariIni) {
    const sampaiSesudah = geser(hariIni, -8), dariSesudah = geser(sampaiSesudah, -6);
    const sampaiSebelum = geser(dariSesudah, -1), dariSebelum = geser(sampaiSebelum, -6);
    const hasil = { dariSebelum, sampaiSebelum, dariSesudah, sampaiSesudah };
    const sebelum = untungToko(sumber, data.biayaTokoHarian, dariSebelum, sampaiSebelum);
    const sesudah = untungToko(sumber, data.biayaTokoHarian, dariSesudah, sampaiSesudah);
    if (!data.dataSiapEvaluasi || sebelum === null || sesudah === null) return { ...hasil, status: 'data' };
    return { ...hasil, sebelum, sesudah, status: 'selesai', turunJauh: sesudah - sebelum <= -BATAS_TURUN_TOKO };
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

  function terapkanEvaluasiToko(baris, toko, data, dasarLengkap, hariIni) {
    const ubah = new Set(['naikkan', 'turunkan', 'tambah', 'kurangi']);
    // ditahan = the change that was held back.
    const tahan = (b, alasan) => { if (ubah.has(b.keputusan)) b.ditahan = b.keputusan; b.keputusan = 'tunggu'; b.alasan = alasan; b.targetBaru = null; b.modalBaru = b.modal; };
    // Each ad is judged on its own direct sales, so several ads may be changed at once (user, 30/09).
    // New changes wait only for complete data and the store safety check.
    const tahanUji = !data.dataSiapEvaluasi || !dasarLengkap || (toko && toko.status === 'data') ? 'data-toko'
      : toko && toko.turunJauh ? 'toko-turun-jauh' : null;
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

  const api = { geser, metrikTerbaru, untungToko, rincianUntungToko, BATAS_TANPA_HPP, BEDA_LANGSUNG, BEDA_SHOPEE, BATAS_TURUN_TOKO,
    untungIklanHarian, hasilIklan, cekToko, pernahDikembalikan, terapkanEvaluasiToko };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EvaluasiIklan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
