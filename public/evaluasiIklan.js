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

  // Uses all store orders and actual shop ad spend, so cross-product sales are included.
  // A day without orders is unknown until order coverage can prove zero sales.
  function untungToko(sumber, iklanHarian, dari, sampai) {
    const periode = sumber && sumber.ringkasan && sumber.ringkasan.periode;
    if (!periode || periode.dari > dari || periode.sampai < sampai) return null;
    const perHari = new Map();
    for (const it of sumber.items || []) {
      const d = String(it.waktuPesanan || '').slice(0, 10);
      if (d < dari || d > sampai) continue;
      if (!Number.isFinite(it.totalPenghasilan) || (!it.dikembalikan && (!Number.isFinite(it.hpp) || !Number.isFinite(it.untung)))) return null;
      perHari.set(d, (perHari.get(d) || 0) + (it.dikembalikan ? it.totalPenghasilan : it.untung));
    }
    let total = 0;
    for (const d of tanggal(dari, sampai)) {
      if (!perHari.has(d) || !iklanHarian || !Number.isFinite(iklanHarian[d])) return null;
      total += perHari.get(d) - iklanHarian[d];
    }
    return total / 7;
  }

  function evaluasiPerubahan(data, sumber, hariIni) {
    const riwayat = (data.riwayatSetelan || []).filter(u => u.tanggal <= hariIni);
    const t = riwayat.map(u => u.tanggal).sort().pop();
    if (!t || t < geser(hariIni, -28)) return null;
    const kelompok = riwayat.filter(u => u.tanggal === t);
    const cekLagi = geser(t, 15);
    const hasil = { tanggal: t, kelompok, cekLagi, dariSebelum: geser(t, -7), sampaiSebelum: geser(t, -1), dariSesudah: geser(t, 1), sampaiSesudah: geser(t, 7) };
    if (hariIni < cekLagi) return { ...hasil, status: 'tunggu' };
    // Multiple edits to one campaign that day, or edits in the baseline, are not a clean comparison.
    if (new Set(kelompok.map(u => u.campaignId)).size !== kelompok.length || riwayat.some(u => u.tanggal >= hasil.dariSebelum && u.tanggal < t)) {
      return { ...hasil, status: 'campur' };
    }
    const sebelum = untungToko(sumber, data.biayaTokoHarian, hasil.dariSebelum, hasil.sampaiSebelum);
    const sesudah = untungToko(sumber, data.biayaTokoHarian, hasil.dariSesudah, hasil.sampaiSesudah);
    if (!data.dataSiapEvaluasi || sebelum === null || sesudah === null) return { ...hasil, status: 'data' };
    // Compare rounded rupiah so floating point noise cannot trigger a reversal.
    return { ...hasil, sebelum, sesudah, status: Math.round(sesudah) < Math.round(sebelum) ? 'turun' : 'tetap-naik' };
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

  function terapkanEvaluasiToko(baris, evaluasi, data, dasarLengkap) {
    const ubah = new Set(['naikkan', 'turunkan', 'tambah', 'kurangi']);
    const tahan = (b, alasan) => { b.keputusan = 'tunggu'; b.alasan = alasan; b.targetBaru = null; b.modalBaru = b.modal; };
    let tertahan = !data.dataSiapEvaluasi || !dasarLengkap;
    for (const b of baris) {
      b.evaluasi = evaluasi;
      if (['jeda', 'isi-hpp', 'toko'].includes(b.keputusan)) continue;
      const u = evaluasi && evaluasi.kelompok.find(u => u.idProduk === b.p.idProduk);
      if (evaluasi && ['tunggu', 'data', 'campur', 'turun'].includes(evaluasi.status)) tertahan = true;
      if (u && evaluasi.status === 'turun' && data.dataSiapEvaluasi) {
        const hanyaNaikTarget = evaluasi.kelompok.every(v => v.targetLama > 0 && v.targetBaru > v.targetLama && v.modalLama === v.modalBaru);
        if (hanyaNaikTarget && b.target === u.targetBaru && b.modal === u.modalBaru) {
          b.keputusan = 'kembalikan'; b.alasan = 'untung-turun'; b.modalBaru = b.modal;
          b.targetBaru = Math.max(u.targetLama, Math.ceil((b.target / 1.2) * 10 - 1e-9) / 10);
        } else { tahan(b, 'tinjau-hasil'); b.keputusan = 'tinjau'; }
      } else if (u && evaluasi.status === 'tetap-naik') {
        b.keputusan = 'lanjut'; b.alasan = 'hasil-baik'; b.targetBaru = null; b.modalBaru = b.modal;
      } else if (ubah.has(b.keputusan) && pernahDikembalikan(data.riwayatSetelan, b.p.idProduk)) {
        tahan(b, 'sudah-kembali');
      }
    }
    // A rollback takes priority. Otherwise offer just one new store-level experiment.
    let dipilih = false;
    for (const b of baris) {
      if (['jeda', 'isi-hpp', 'toko', 'kembalikan', 'tinjau'].includes(b.keputusan)) continue;
      if (tertahan) {
        tahan(b, evaluasi && evaluasi.status === 'tunggu' ? 'uji-berjalan' : evaluasi && evaluasi.status === 'campur' ? 'uji-campur' : evaluasi && evaluasi.status === 'turun' ? 'tinjau-hasil' : 'data-toko');
        if (evaluasi) b.bisaDiubahLagi = evaluasi.cekLagi;
      } else if (ubah.has(b.keputusan)) {
        if (dipilih) tahan(b, 'satu-uji');
        else dipilih = true;
      }
    }
    return baris;
  }

  const api = { geser, metrikTerbaru, untungToko, evaluasiPerubahan, pernahDikembalikan, terapkanEvaluasiToko };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EvaluasiIklan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
