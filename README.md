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
- Sessions are stored in SQLite (table `sesi`), so a redeploy does not log anyone out. Login is paused
  for 15 minutes after 10 wrong passwords from one IP. Responses carry a Content Security Policy (no
  inline scripts), `X-Frame-Options: DENY` and `nosniff`; data-changing requests from other origins are
  refused.
- Back up the database (`app.db`): it holds the HPP list and accounts.

**Debugging and read-only access** (for the owner or a helper/agent, without sharing a password):
- `GET /api/kesehatan` — public, no login. Version, last order/ads sync (status, time, error text),
  retry queue, how many warnings/errors were logged in 24 h, and whether any order carries a pay-per-sale
  ad fee (yes/no). No sales figures, product names,
  order numbers or log text.
- `GET /api/log?n=100` — login required. The server's last log lines (sync results, Shopee refusals,
  errors; kept in the `log_server` table, max 500). Also on Pengaturan → Diagnostik → "Log server".
- **Read-only accounts:** list usernames in `AKUN_BACA_SAJA` (comma-separated) and create them via
  `ADMIN_ACCOUNTS` as usual. They see everything and can download the Excel, but can't change HPP or
  settings, start a Shopee sync or reconnect the shop (403). The header shows "baca saja".
- Shopee "rate limit" replies are retried after 2, 5 and 10 s. A manual sync within 1 minute of a
  successful one is skipped, and Pengaturan only fetches on open when data is over 30 minutes old.

## 3. Using the site

### Look and feel
Built for older users: 16 px base text, high-contrast grey, buttons at least 44 px tall. On phones the
menu sits at the bottom (icon + label). Short fade-in animations and a one-time profit count-up are
skipped when the device asks for reduced motion.

### Data status (top bar, every page)
A small button shows how fresh the data is ("Diperbarui 5 mnt lalu"; yellow after 1 hour, red if the last
fetch failed). Pressing it fetches orders and ads from Shopee now (read-only): it shows "Memperbarui 40%"
with a progress line under the top bar, then "✓ Selesai" for a few seconds. Scheduled syncs show up the
same way. Read-only accounts only reload stored data. Hover (desktop) for the exact time or error.

### Pengaturan (gear button next to Keluar)
- **Diagnostik:** sync and ads-sync status, orders waiting to be re-fetched, stored order range (not yet
  paid out / cancelled), products sold in 30 days without HPP, running ads, recorded setting changes,
  pay-per-sale ad fees (Shopee's `pay_per_sale`; should be none, warns if any), app version, and **Log server** (last 60 server log lines).
- **Unduh data (Excel):** one .xlsx workbook for analysis (e.g. by Claude): README, Status, current ad
  decisions, setting-change history with 7 days before/after (campaign ROAS and store profit per day),
  profit per month/week/day, products, HPP, campaigns, daily ad figures and every order item. It contains
  no passwords, Shopee tokens or buyer data. Built without extra dependencies (`xlsx.js`, `eksporData.js`).
- **Hitungan iklan:** the data period and payout ratio used for the ads maths, the paid-order rate
  override, and a short guide to how the ad advice is chosen.

### Dashboard
On a wide screen: store profit and shortcut cards on the left, the weekly tasks on the right. On a
phone: profit, then tasks, then shortcuts.
- **Tugas Minggu Ini** (top): last complete week's store profit after ads (change vs the week before per ordinary day: days with payout > 1.8 × the 28-day median are left out and named), this
  month so far vs last month, then short numbered steps: (1) **Isi HPP** for products whose missing cost
  price holds the ad advice, with a price box + Simpan per product (and a button to the HPP tab); (2) **Ubah Periode jadi Tidak Terbatas** for
  ads ending soon; (3) one step per ad that needs a target/budget change, with the exact old → new
  value. All other ads get one line ("jangan diubah"). New trials are limited to one ad at a time.
  Profit is labelled as an estimate.
- **Hasil percobaan:** each settings change is judged by **the changed ad's direct product contribution**, seven days
  before vs seven days after (the change day is skipped), on change date +15 after seven full days for
  delayed attribution. The direct change must reach 20 rb/day to count as a clear improvement or decline;
  the broad Shopee figure remains in the owner's details as context, because it can include products with
  different margins. **Lebih baik** keeps the setting and the steps continue; **lebih buruk** returns towards the old target or budget (at most 20%
  per step); **belum jelas** keeps the setting, and after a target raise that ad's target is not raised
  again. Missing data is never zero profit.
- **Store profit does not hold changes.** It swings about ±400 rb/day between ordinary weeks with demand and
  sale days, far more than one ad setting can move it. The weekly card still stops budget increases when ad
  spend rose over 4 weeks and store profit did not (per ordinary day: busy days, payout > 1.8 × the
  8-week median, are left out of both halves).
- Missing HPP for more than 5% of the week's payout (smaller gaps are estimated at the margin of the
  other products), missing daily records, stale/failed syncs, retries, or overlapping changes block new
  trials. The reason is shown once as a yellow banner (with an "Isi HPP" button), not on every ad. Several edits of one ad on the same day count as one change (first old value → last new value). Mixed target/budget changes with worse results require review. A target increase followed by
  a reversal is not automatically repeated while that pair remains in the 90-day change history.
- Changes made in Seller Centre are detected automatically by the next sync; nothing to tick.
- **Saran iklan** (collapsed dropdown under the tasks; suggestions, not tasks). Measured up to today−7
  with the product's own margin and break-even ROAS: **Iklankan lagi** = not advertised now, ≥ 150 rb past
  spend, past direct ROAS ≥ 1.2 × break-even with a profit, still ≥ 4 pcs in the last 4 weeks;
  **Coba iklankan** = (almost) never advertised, ≥ 8 pcs in 4 weeks, margin ≥ 20%, returns ≤ 5%.
- **Ganti iklan** (a numbered step): the currently running campaign with ≥ 10 mature days of spend, a direct loss ≥ 100 rb and
  direct ROAS < 0.6 × break-even is replaced rather than tuned. It shows which ad to turn off and which
  product to advertise instead (Iklankan lagi first, then Coba iklankan; Tidak Terbatas, 50 rb/day).
  A past winner restarts in **GMV Max ROAS at the target of its most profitable ROAS-mode campaign**
  (capped at the Shopee limit when known; otherwise the page asks the seller to check that limit); a never-advertised product starts in **ROAS mode at Shopee's middle recommended target** (not below its break-even, capped at the limit; user 30/09, Shopee's FAQ treats such items as regular products), or on **Auto** when Shopee gives no recommendation, reviewed after 7–14 days. A clearly worse result from
  the latest setting change (≤ 28 days old) is reviewed for reversal before replacement. In this shop Auto ads reached a median
  direct ROAS of 2.1 vs 4.6 in ROAS mode, and past winners made their profit in ROAS mode. Why: 20% target steps up to the limit raise the target by about 30% at most, while these
  ads need 1.7× or more; 90% of this shop's ROAS-mode campaigns already beat their target on Shopee's
  ROAS. Without a replacement product the budget is halved instead. A replacement does not take the
  one-trial-at-a-time slot; a recently changed ad still waits for its result.
- Estimated ad contribution excludes any conditional **Proteksi ROAS Saldo 1:1** credit; the app does not
  read eligibility or received credits. This is disclosed in the owner's ad details.
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
- Yellow rows = no HPP yet (type it straight into the row). Running-ad products without HPP are listed
  too, even without sales in the period. Click a column header to sort.
- **Sync:**
  - Runs every 30 minutes and only downloads new or changed orders.
  - The data-status button in the top bar forces it and shows the progress.
  - Pending retry checks continue automatically in batches. Failed checks rotate so later records
    can still recover. After 10 failed attempts an order is listed as "belum bisa diperiksa ulang":
    it is still retried every sync, but no longer keeps the sync looking unfinished.
  - If it keeps ending red, read the message. The app renews Shopee's token itself; if Shopee refuses,
    authorize again at `/auth/shopee/authorize` (saved data is kept).

### Analisis Iklan
Ads data (last 90 days, every product campaign, plus the budget and target set in Seller Centre) comes
from Shopee automatically. A summary line (running ads, total daily budget, how many need work) sits above
the **running ads in one table, grouped in five sections**. Each row: product with its current target and
budget (orange tag when the ad ends soon) · one action word (Matikan, Ganti, Ubah, Tunggu, Biarkan) with the
exact instruction. Rows show no profit figures: most ads are below break-even on their own product (a strict
measure), which reads as failure next to "Biarkan". **Rincian** on a row opens the numbers: direct ROAS vs the
minimum, Shopee's ROAS and recommended range, price/HPP, margin, paid rate, the ad's profit on its own product
over the latest seven mature days (today−14 to today−8) and that product's campaigns. On phones each row
stacks. The groups, most urgent first:

1. **Hentikan** (red): turn the ad off. Only when price ≤ cost or no ad orders are ever paid.
2. **Ganti** (red): a big loser (see "Ganti iklan" above). The row names the product to advertise instead.
3. **Ubah** (yellow): one exact change, e.g. "Ubah Target ROAS 13,5 → 16,2", with the reason. Also
   reversals of a change that made things worse, and "Isi HPP" for ads without a cost price.
4. **Masa Belajar** (blue): ads in their first days, or changed less than 15 days ago (the card shows the
   change and when the result comes out). Don't touch.
5. **Lanjutkan** (green): nothing to change. A short note says why when that isn't obvious:
   data is incomplete, the last change worked, or the target is already at the limit. Several ads can be
   changed at once (each is judged on its own direct sales); within a group, the biggest 7-day loss comes
   first.

Notices appear once at the top: missing data (yellow, with an "Isi HPP" button), a large store-profit drop,
and how many ads end soon ("ubah Periode jadi Tidak Terbatas"; the rows carry the date).

How each ad's change is chosen (the trial checks above take priority over this ladder):
- Each ad first gets a zone from **direct ROAS** (sales of the advertised product only) and Shopee's ROAS
  against the **ROAS minimum**, over the same seven mature days under the current settings.
- **Untung** (direct ≥ minimum) → **Tambah modal** +20% if it spent ≥ 90% of its daily budget on average
  and weekly store profit isn't falling while ads rise; otherwise leave it.
- **Belum tentu** (only Shopee's ROAS ≥ minimum) or **Rugi** (both below) → **Naikkan target** by 20%
  (Shopee's guidance: at most 20% per change). Auto ads: switch to ROAS mode at Shopee ROAS + 20%.
- **Target limit** = Shopee's highest recommendation × 1.25 (an advisory delivery ceiling). A raise stops
  at the limit. At or above it: a losing ad → **Kurangi modal** (halve the budget); a "belum tentu" ad
  above the limit → lowered by at most 20% per step towards the limit.

Below the table:
- **Untung toko per minggu:** store profit after ads vs ad spend for the last 8 weeks, with the budget
  check (last 4 complete weeks vs the 4 before) and the daily budget if every change is applied.
- **Iklan yang sudah selesai** (collapsed): products advertised in the last 90 days that are not running
  now, with direct ROAS, profit and zone, so losing ads aren't repeated.
- The paid-rate override and the reading guide are in Pengaturan → Hitungan iklan.

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
  - A value typed in Pengaturan → Hitungan iklan overrides it.
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
recovery against a mock Shopee). Trial tests cover recent vs old performance, store-profit reversals,
cross-product sales, missing/zero days, overlapping changes, parallel per-ad changes and expiry reminders.
`keamanan.test.js` starts the real server and checks headers, the cross-site block, the login limit,
that sessions survive a restart, the public health check, the log and read-only accounts.
`shopeeApi.test.js` checks the rate-limit retry and the read-only endpoint guard. `ekspor.test.js` checks the Excel export. No Shopee credentials are needed.
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
  eksporData.js     Pengaturan export: builds the analysis workbook sheets
  xlsx.js           Minimal dependency-free .xlsx writer
  util.js           Shared helpers (WIB dates, batching, Shopee error check, HTML escaping)
  sesiSqlite.js     Login sessions stored in SQLite
  logServer.js      Keeps the last 500 server log lines in SQLite (/api/log, Pengaturan)
  scripts/add-user.js   Create/update login accounts
  test/             Regression tests (npm test)
  public/           Frontend: index.html, app.js, style.css (no build step)
                    evaluasiIklan.js: shared mature-window and store-profit trial calculations
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
