/* "Saran iklan": which products to advertise, from 90 days of sales and ad data (user, 2026-09-27).
   Pure calculation shared by the browser and the regression tests. Suggestions only; a human decides. */
(function (root) {
  const geser = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  // Thresholds from the 2026-09-27 analysis of the shop's export (Jul–Sep 2026).
  const SARAN = {
    ulangBiayaMin: 150000,  // enough past ad spend to judge
    ulangRoasKali: 1.2,     // past direct ROAS ≥ 1.2 × break-even
    ulangPcsMin: 4,         // still selling: ≥ 4 pcs in the last 4 weeks
    ulangReturMax: 0.10,
    cobaBiayaMax: 50000,    // (almost) never advertised
    cobaPcsMin: 8,          // ≥ 2 pcs a week without ads
    cobaMarginMin: 0.20,    // ≥ 20% of price left after payout deductions and HPP
    cobaReturMax: 0.05,
    gantiHariMin: 10,       // ≥ 10 days with ad spend
    gantiRugiMin: 100000,   // lost ≥ 100 rb on direct sales
    gantiRoasKali: 0.6,     // direct ROAS < 0.6 × break-even
    maks: 5,
  };

  // items: sales rows (/api/pesanan), kampanye: ad campaigns with perHari, tingkatCair: paid share of ad orders.
  // Everything is measured up to today−7, so recent orders and ad attribution have settled.
  function saranIklan(items, kampanye, hariIni, tingkatCair) {
    const sampai = geser(hariIni, -7), dariA = geser(sampai, -27), dariB = geser(sampai, -55);
    const produk = new Map();
    const ambil = (id, nama) => {
      let p = produk.get(id);
      if (!p) produk.set(id, p = { idProduk: id, nama: nama || id, pcsA: 0, pcs: 0, retur: 0, harga: 0, hargaHpp: 0, untung: 0,
        biaya: 0, omzetLangsung: 0, hari: 0, berjalan: false, biayaBerjalan: 0, omzetBerjalan: 0, hariBerjalan: 0, kampanye: [] });
      if (nama && p.nama === id) p.nama = nama;
      return p;
    };
    for (const it of items || []) {
      const d = String(it.waktuPesanan || '').slice(0, 10);
      if (!it.idProduk || d < dariB || d > sampai) continue;
      const p = ambil(it.idProduk, it.namaProduk), pcs = it.jumlah || 1;
      p.pcs += pcs;
      if (it.dikembalikan) { p.retur += pcs; continue; }
      if (d >= dariA) p.pcsA += pcs;
      p.harga += it.hargaProduk || 0;
      if (Number.isFinite(it.hpp) && Number.isFinite(it.untung)) { p.hargaHpp += it.hargaProduk || 0; p.untung += it.untung; }
    }
    for (const k of kampanye || []) {
      if (k.tokoLevel || !k.kodeProduk) continue;
      const p = ambil(k.kodeProduk, k.namaProduk || k.namaIklan);
      if (k.status === 'Berjalan') p.berjalan = true;
      const c = { targetRoas: k.targetRoas || 0, biaya: 0, omzetLangsung: 0 };
      for (const [d, v] of Object.entries(k.perHari || {})) {
        if (d > sampai) continue;
        p.biaya += v.biaya || 0; p.omzetLangsung += v.omzetLangsung || 0;
        c.biaya += v.biaya || 0; c.omzetLangsung += v.omzetLangsung || 0;
        if (v.biaya > 0) p.hari += 1;
        if (k.status === 'Berjalan') {
          p.biayaBerjalan += v.biaya || 0; p.omzetBerjalan += v.omzetLangsung || 0;
          if (v.biaya > 0) p.hariBerjalan += 1;
        }
      }
      p.kampanye.push(c);
    }
    const ulang = [], coba = [], ganti = [];
    for (const p of produk.values()) {
      p.margin = p.hargaHpp > 0 ? p.untung / p.hargaHpp : null;
      if (!(p.margin > 0) || !(tingkatCair > 0)) continue;
      p.roasMinimum = 1 / (p.margin * tingkatCair);
      p.roasLangsung = p.biaya > 0 ? p.omzetLangsung / p.biaya : null;
      p.untungIklan = p.omzetLangsung / p.roasMinimum - p.biaya; // direct profit after ad spend
      p.bagianRetur = p.pcs ? p.retur / p.pcs : 0;
      if (p.berjalan) {
        const untungBerjalan = p.omzetBerjalan / p.roasMinimum - p.biayaBerjalan;
        const roasBerjalan = p.biayaBerjalan > 0 ? p.omzetBerjalan / p.biayaBerjalan : null;
        if (p.hariBerjalan >= SARAN.gantiHariMin && untungBerjalan <= -SARAN.gantiRugiMin && roasBerjalan < SARAN.gantiRoasKali * p.roasMinimum) {
          ganti.push({ ...p, biaya: p.biayaBerjalan, omzetLangsung: p.omzetBerjalan, hari: p.hariBerjalan,
            roasLangsung: roasBerjalan, untungIklan: untungBerjalan });
        }
      } else if (p.biaya >= SARAN.ulangBiayaMin) {
        if (p.untungIklan > 0 && p.roasLangsung >= SARAN.ulangRoasKali * p.roasMinimum && p.pcsA >= SARAN.ulangPcsMin && p.bagianRetur <= SARAN.ulangReturMax) {
          p.targetTerbaik = targetTerbaik(p);
          ulang.push(p);
        }
      } else if (p.biaya < SARAN.cobaBiayaMax && p.pcsA >= SARAN.cobaPcsMin && p.margin >= SARAN.cobaMarginMin && p.bagianRetur <= SARAN.cobaReturMax) {
        p.untungPerMinggu = p.pcsA * (p.harga / Math.max(1, p.pcs - p.retur)) * p.margin / 4;
        coba.push(p);
      }
    }
    ulang.sort((a, b) => b.untungIklan / b.hari - a.untungIklan / a.hari);
    coba.sort((a, b) => b.untungPerMinggu - a.untungPerMinggu);
    ganti.sort((a, b) => a.untungIklan - b.untungIklan);
    return { dari: dariB, sampai, ulang: ulang.slice(0, SARAN.maks), coba: coba.slice(0, SARAN.maks), ganti };
  }

  // Restart a past winner in ROAS mode at the target of its most profitable ROAS-mode campaign
  // (user, 2026-09-28: all three replacements on 27/09 made their profit in ROAS mode; Auto ads in this
  // shop reached a median direct ROAS of 2.1 vs 4.6 in ROAS mode). null = no profitable ROAS-mode run.
  function targetTerbaik(p) {
    let terbaik = null, untungTerbaik = 0;
    for (const c of p.kampanye) {
      const untung = c.omzetLangsung / p.roasMinimum - c.biaya;
      if (c.targetRoas > 0 && untung > untungTerbaik) { terbaik = c.targetRoas; untungTerbaik = untung; }
    }
    return terbaik;
  }

  const api = { SARAN, saranIklan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SaranIklan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
