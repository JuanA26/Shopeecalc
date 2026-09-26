# Kalkulator Margin Shopee (Shopee Margin Calc)

**Live:** https://shopee-margin-calc.onrender.com (server version, the one in use)

A small private web app for one Shopee shop. It pulls orders, payouts and ad data **automatically from the
Shopee Open Platform API** (read-only), combines them with the cost price (HPP) you enter per product,
and shows:

- **Contribution profit** per sale and per period (payout − HPP), by order date, including estimates for unsettled orders.
- **Estimated ad profitability** (GMV Max), and one suggested action per ad for Seller Centre. Attribution does not prove additional sales caused by ads.

The UI is in simple Bahasa Indonesia and login is required. There is no public sign-up.

This repo also contains an older **static version** in [`docs/`](docs/) (GitHub Pages, no server). It is
frozen; see [the end of this file](#the-static-docs-version).

---

## 1. Run it locally

```bash
cd webapp
npm install
copy .env.example .env        # PowerShell: Copy-Item .env.example .env
```

In `.env`, set `SESSION_SECRET` to a long random string
(`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) and the `SHOPEE_*` values.
Then create a login and start:

```bash
node scripts/add-user.js saya "GantiDenganPasswordKuat123"   # re-run to change a password
npm start                                                     # http://localhost:3000
```

Sales data needs a one-time shop authorization at `/auth/shopee/authorize`.

## 2. Deploy (Render)

`render.yaml` sets up everything: New → Blueprint → pick the repo.

- **Plan:** Starter (~$7/month). The free tier has no persistent disk, and the SQLite file
  (`DATA_DIR`) must be on one or all data is lost on redeploy.
- **Env vars to fill in:**
  - `ADMIN_ACCOUNTS`, e.g. `aaron:Pass1,ibu:Pass2`. Accounts are created on start; existing ones are left
    untouched.
  - `SHOPEE_PARTNER_ID` / `SHOPEE_PARTNER_KEY` (live keys from the Shopee Open Platform console).
- After that, every `git push` to `main` redeploys automatically.

**Access and privacy:**
- Every route except login requires a session. Only create accounts for people you trust, with long,
  unique passwords.
- Back up the database (`app.db`): it holds the HPP list and accounts.

## 3. Using the site

### Dashboard
- **Tugas Minggu Ini** (top): last complete week's store profit after ads (vs the week before), this
  month so far vs last month, then one card per ad that needs a change in Seller Centre, with the
  exact old → new value. Below: ads changed less than 7 days ago (wait), ads to leave alone, and the
  result of earlier changes (the ad's own profit per day, 7 days before vs after).
- Changes made in Seller Centre are detected automatically by the next sync; nothing to tick.
- Two cards below: Kalkulator Margin (profit for the period chosen there) and Analisis Iklan.

### Kalkulator Margin
- **Lihat Data Penjualan:**
  - Choose Hari ini / 7 hari / 30 hari / Bulan ini / Bulan lalu or your own dates. Periods are **by order
    date** on the WIB calendar.
  - You get tiles (Omzet, Pendapatan, Untung, margin), a daily trend chart, and a table of every sold item.
  - Orders whose funds aren't released yet show **"Belum cair"** with an **≈** estimate. The exact figure
    replaces it automatically. Cancelled and unpaid orders are left out.
- **Atur Harga Modal (HPP):** set the cost price per Product ID (shared by all users). Bulk CSV
  import/export. The "Belum Diisi" filter lists products without HPP, best sellers first.
- Yellow rows = no HPP yet (type it straight into the row). Click a column header to sort.
- **Sync:**
  - Runs every 30 minutes and only downloads new or changed orders.
  - "Sinkron Sekarang" forces it; a progress bar shows the steps.
  - Pending retry checks continue automatically in batches. Failed checks rotate so later records
    can still recover. After 10 failed attempts an order is listed as "belum bisa diperiksa ulang":
    it is still retried every sync, but no longer keeps the sync looking unfinished.
  - If it keeps ending red, read the message. The app renews Shopee's token itself; if Shopee refuses,
    authorize again at `/auth/shopee/authorize` (saved data is kept).

### Analisis Iklan
Ads data (last 90 days, every product campaign, plus the budget and target set in Seller Centre) comes
from Shopee automatically. The page answers four questions:

1. **Anggaran Iklan:** the store-level check.
   - Weekly profit after ads, last 4 complete weeks vs the 4 before. If ads went up but profit didn't:
     "jangan tambah Modal Harian dulu" (no budget increases are suggested until that changes).
   - The attribution ratio compares ad-attributed units with shop units. It does not prove whether
     ads caused those sales or the sales would have happened anyway.
   - Weeks with ad spend but no order rows remain visible with unknown profit. Gaps prevent comparing
     nonconsecutive weeks for a budget recommendation.
2. **Iklan yang Sedang Berjalan:** one row per running ad, showing the budget and target from Seller Centre
   and **one change**. The goal is store profit after ads, so losing ads are tuned step by step
   rather than paused. Each ad first gets a zone, from **direct ROAS** (sales of the advertised
   product only) and Shopee's ROAS against the **ROAS minimum**:
   - **Untung** (direct ≥ minimum) → **Tambah modal** +20% if it spent ≥ 90% of its daily budget on
     average over the last 7 days and weekly store profit isn't falling while ads rise; otherwise **Biarkan**.
   - **Belum tentu** (only Shopee's ROAS ≥ minimum) or **Rugi** (both below) → **Naikkan target**
     by 20% (Shopee's guidance: at most 20% per change). Auto ads: switch to ROAS mode at Shopee ROAS + 20%.
   - **Target limit** = Shopee's highest recommendation × 1.25; above it ads barely deliver. A raise
     stops at the limit, with a note. At or above the limit: a losing ad → **Kurangi modal** (halve
     the budget; a lower target would spend more on a losing ad); a "belum tentu" ad above the
     limit → **Target terlalu tinggi**, lowered by at most 20% per step towards the limit.
   - **Tunggu:** the ad is younger than 7 days, has no spend yet, or its target/budget was changed
     less than 7 days ago.
   - **Jeda:** only when price is below cost or no ad orders are ever paid.
   - **Isi HPP dulu:** the product has no HPP.
   - Each row also shows Shopee's recommended target range, and a note when the ad ends within 7 days
     (extend it as "Tidak Terbatas" instead of creating a new one, which restarts learning).
3. **Semua produk & rincian** (collapsed): every product incl. ended ads, its zone and ROAS minimum,
   plus the reading guide.

The ads CSV from Seller Centre can still be uploaded under "Cadangan" if the automatic data fails.

## 4. How the numbers are calculated

**Kalkulator**
- **Omzet** = selling price (after the shop's own discounts) × pcs, non-returned items.
- **Pendapatan** = what Shopee pays out. It's exact for released orders (split over items by price, like
  Shopee's Income report). Otherwise ≈ price × the shop's payout ratio of the last 60 days.
- **Untung** = payout − HPP × pcs for items with HPP, plus returned-item payout balances.
- **Margin** = Untung ÷ payout for those same rows, including return balances.
- Returned items have no HPP expense under the assumption that stock is reusable. Their payout balance
  still affects profit, including negative return/shipping deductions. Refund-only and damaged stock
  need separate cost accounting.

**Analisis Iklan**
- **Margin per Rp of sales** = (price × payout ratio − HPP) ÷ price, from the product's own paid-out
  orders.
- **Paid-order rate:** Shopee counts ad sales when an order is *placed*, including orders later
  cancelled, unpaid or returned. The app measures the share that actually became sales from the shop's
  own order statuses (orders from 90 to 14 days ago, per product where there's enough data).
  - A value typed under "Semua produk & rincian" overrides it.
  - It is 85% when there isn't enough data.
- **ROAS minimum** = 1 ÷ (margin × paid-order rate). It estimates direct-product break-even under the
  price, payout and paid-rate assumptions; cross-product contribution is not measured by this formula.
- A measured zero paid rate is preserved. Partial returns remove only returned units from the
  measured rate. Active zero-activity campaigns stay visible while waiting for data.
- Targets are on Shopee's own (broad) ROAS scale; the app raises them in 20% steps and watches
  direct ROAS, because the link between the two scales is different for every ad.
- **Iklan Toko:** ad spend outside product campaigns (shop total − Σ campaigns) is kept as one line so
  its cost isn't lost.

## 5. Tests

Run `npm test` for the regression tests (profit and break-even maths, paid-order rate with partial
returns, payout split, return deductions, ad-only weeks, retry rotation, stuck retries and historical
recovery against a mock Shopee). No Shopee credentials are needed.
The calculator excludes business overhead unless it is already part of HPP/payout deductions.

## 6. Project structure

```
webapp/
  server.js         Express: login, HPP API (incl. CSV), sales data, sync scheduler/status, ads routes
  shopeeApi.js      Shopee API v2 client: HMAC signing, OAuth, read-only endpoint allowlist
  sinkronShopee.js  Order + payout sync into SQLite; measured paid-order rate
  sinkronIklan.js   Ads sync (campaigns, daily performance, shop totals, recommended ROAS)
  analisisIklan.js  Ads maths and per-ad decision; parser for the Seller Centre ads CSV
  db.js             SQLite schema (users, HPP, settings, Shopee token, orders, payouts, ads)
  scripts/add-user.js   Create/update login accounts
  test/             Regression tests (npm test)
  public/           Frontend: index.html, app.js, style.css (no build step)
  data/app.db       SQLite database (gitignored; back it up)
  Dockerfile        For other container hosts
```

**Stored on the server:** HPP list, accounts, the Shopee token, and synced orders, payouts and ad metrics.
Buyer usernames are **not** stored. Nothing is ever written to Shopee: every API path must be on the
read-only allowlist in `shopeeApi.js`.

---

## The static (`docs/`) version

Frozen, older version with **no server, no database, no login**. It reads an uploaded Shopee Income Excel
file entirely in the browser. HPP lives in a CSV you download/upload yourself (plus a copy in the browser's
local storage), so use "Unduh CSV" after changes and carry the file between devices yourself.

**Publish it (free):** GitHub → Settings → Pages → Deploy from a branch → `main`, folder `/docs`. It
redeploys on every push.
