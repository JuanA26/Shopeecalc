/* Product economics shared by ad analysis and candidate selection. No campaign thresholds here. */
(function (root) {
  const RASIO_PENCAIRAN_DEFAULT = 0.78;
  const TINGKAT_CAIR_DEFAULT = 0.85;
  const rate = n => Number.isFinite(n) && n >= 0 && n <= 1;
  const payout = n => rate(n) && n > 0;

  function tingkatCairProduk(produk, toko) {
    return rate(produk) ? produk : rate(toko) ? toko : TINGKAT_CAIR_DEFAULT;
  }

  function hitungEkonomiProduk({ hpp, income, iklan = {}, rasioPencairan, tingkatCair, tingkatCairPerProduk,
    sumberTingkatCair } = {}) {
    hpp = Number.isFinite(hpp) ? hpp : null;
    const adaIncome = income && Number.isFinite(income.harga) && income.harga > 0 && income.pcs >= 3;
    let hargaRata = 0, sumberHarga = null;
    if (adaIncome) { hargaRata = income.harga; sumberHarga = 'income'; }
    else if (iklan.terjualLangsung > 0) { hargaRata = iklan.omzetLangsung / iklan.terjualLangsung; sumberHarga = 'langsung'; }
    else if (iklan.terjual > 0) { hargaRata = iklan.omzet / iklan.terjual; sumberHarga = 'luas'; }
    if (!(Number.isFinite(hargaRata) && hargaRata > 0)) { hargaRata = 0; sumberHarga = null; }
    const rasioProduk = adaIncome && payout(income.rasio);
    const rasio = rasioProduk ? income.rasio : payout(rasioPencairan) ? rasioPencairan : RASIO_PENCAIRAN_DEFAULT;
    const cair = tingkatCairProduk(tingkatCairPerProduk, tingkatCair);
    const marginPerRp = hpp !== null && hargaRata > 0 ? (hargaRata * rasio - hpp) / hargaRata : null;
    const roasImpas = marginPerRp > 0 && cair > 0 ? 1 / (marginPerRp * cair) : null;
    return { hpp, hargaRata, sumberHarga, rasioPencairan: rasio, tingkatCair: cair, marginPerRp, roasImpas,
      sumberRasio: rasioProduk ? 'produk' : payout(rasioPencairan) ? 'toko' : 'default',
      sumberTingkatCair: rate(tingkatCairPerProduk) ? 'produk' : rate(tingkatCair) ? (sumberTingkatCair || 'toko') : 'default',
      lengkap: marginPerRp !== null,
      alasan: hpp === null ? 'hpp' : !hargaRata ? 'harga' : marginPerRp <= 0 ? 'margin' : cair === 0 ? 'tingkat-cair' : null };
  }

  function untungLangsung(ekonomi, omzetLangsung, biaya) {
    if (!ekonomi || !Number.isFinite(ekonomi.marginPerRp) || !rate(ekonomi.tingkatCair) ||
      !Number.isFinite(omzetLangsung) || !Number.isFinite(biaya)) return null;
    return omzetLangsung * ekonomi.marginPerRp * ekonomi.tingkatCair - biaya;
  }

  const api = { hitungEkonomiProduk, tingkatCairProduk, untungLangsung, RASIO_PENCAIRAN_DEFAULT, TINGKAT_CAIR_DEFAULT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EkonomiProduk = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
