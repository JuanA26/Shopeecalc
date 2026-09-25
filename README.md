# Kalkulator Margin Shopee (Shopee Margin Calc)

**Live (server version):** https://shopee-margin-calc.onrender.com — this is the version actively used and developed; see below.

> **Status (2026-09-24):** the deployed site is still the calculator-only build (commit `c1041fd`). Everything described in §3 items 5–6 (multi-sheet Income exports, ranked missing-HPP list, the **Analisis Iklan** page) is finished and reviewed locally but **deliberately not deployed yet** — it ships together with the Shopee Open Platform API integration (order + ads sync replacing the manual exports). That integration is in progress: OAuth/signing is built and verified against Shopee's sandbox (see `shopeeApi.js` below), and a Go Live review is pending with Shopee to unlock real production data. Until all of this lands, run it locally (§1) to use the finished-but-undeployed features. Full details/history: `PROJECT_NOTES.md` in the parent folder, §20 onwards.

This repo has **two versions** of the same calculator — pick whichever matches how you want to use it:

| | [`docs/`](docs/) — static version | [webapp root](.) — server version |
|---|---|---|
| **Hosting** | GitHub Pages, free forever, no signup | Render (or similar), ~$7/month |
| **HPP data stored as** | A CSV file you download/upload yourself | Server-side SQLite database |
| **Shared live data across people/devices?** | No — CSV is the sync mechanism | Yes — everyone sees the same data instantly |
| **Login required?** | No | Yes |
| **Data ever leaves your browser?** | No — 100% client-side, nothing to trust a server with | The HPP + accounts live server-side (uploaded sales data still never persists — see below) |

If you're the only one using it, or a couple of you but don't need everyone to see the exact same numbers at the same instant, **use `docs/`** — it's simpler, free, and more private by construction. If you need several people genuinely sharing one live, always-in-sync price list, use the server version.

Everything below this point describes the **server version**. The static version is covered in its own section [near the end of this file](#the-static-docs-version--github-pages).

---

A small private web app that:

- Accepts the **Income Excel file exported from Shopee Seller Center** (it reads the `Penghasilan` sheet).
- Shows a table per sold unit: order number, order date, date funds released, product name + ID, and `Total Penghasilan` (Shopee's net payout for that unit, after all their fees).
- Lets you enter a **HPP (Harga Pokok Penjualan / cost price)** per Product ID in a separate tab. That cost is saved permanently and reused automatically on every future upload.
- Computes profit (`Total Penghasilan − HPP`) and margin % (`profit / Total Penghasilan`) per line, plus overall totals.
- Requires login. There is no public sign-up — accounts are created by you from the command line.
- The UI text is in simple Bahasa Indonesia (built for non-technical family members to use).

**What is *not* stored on the server:** the actual sales data (order numbers, income amounts) from an uploaded Excel file is processed in memory for that request only and sent back to your browser — it is never written to disk or the database. The only thing persisted long-term is the HPP (cost) table and the login accounts. This was a deliberate choice to minimize how much sensitive sales history sits on a server.

---

## 1. Run it locally first

```bash
cd webapp
npm install
copy .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
```

Open `.env` and set `SESSION_SECRET` to a long random string. Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Create your first login account:

```bash
node scripts/add-user.js saya "GantiDenganPasswordKuat123"
```

Run one of these for every trusted person who needs their own login (e.g. `node scripts/add-user.js ibu "..."`). Re-running with the same username changes that person's password.

Start the app:

```bash
npm start
```

Visit `http://localhost:3000`, log in, and try uploading the Excel file.

---

## 2. On privacy / who can access it — my recommendation

You asked how to keep this private to just you and people you choose. Here's the trade-off, and what I'd actually do:

### Your situation: "me + a few trusted people, from anywhere"
Because you need access from multiple locations/devices (not just one PC), the app **must** run on a server reachable over the internet — there's no way around exposing *some* URL publicly. Privacy then comes from **who can authenticate**, not from hiding the URL. So:

1. **Login is mandatory and already built in** (this app has no public data or public sign-up page — every route except `/api/login` requires a session).
2. **Only create accounts for people you've explicitly decided should have access**, using `scripts/add-user.js` yourself. Never expose an admin/signup UI.
3. **Always deploy behind HTTPS** (every option below gives you this for free) — otherwise passwords and financial data travel in plaintext.
4. **Use long, unique, random passwords per person** (a password manager, not something guessable). Consider rotating them if anyone with access changes (e.g. staff turnover).
5. **Optional extra layer:** put the app behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) or [Tailscale](https://tailscale.com/) so that even the login page isn't reachable by a random person on the internet — only people on an allow-list (by email, or by being on your private network) can even load the page. This is the strongest option if you want to be extra careful, at the cost of a bit more setup. I'd suggest starting without this and adding it later if you want more peace of mind.
6. **Back up `webapp/data/app.db` regularly** (it's the only thing with lasting value — your HPP list and accounts) since it's small and irreplaceable if the host's disk is lost.
7. Keep the Excel files themselves (raw sales exports) off any public/shared cloud drive unless that drive itself is private — this app doesn't store them, but you still have the original files on your PC.

### Where to actually host it
Pick one depending on how hands-on you want to be:

| Option | Effort | Notes |
|---|---|---|
| **Render.com / Fly.io / Railway** (small free or ~$5/mo tier) | Low | Easiest. Push code, add a persistent disk/volume for `webapp/data`, set the `SESSION_SECRET` env var in their dashboard. Gives you HTTPS automatically. This is what I'd pick. |
| **Your own always-on PC / home server + Tailscale** | Medium | No public exposure at all — only devices you've added to your Tailscale network can reach it, from anywhere in the world, without opening any ports. Very private, but requires that machine to stay on. |
| **A cheap VPS (e.g. DigitalOcean, Hetzner) + Caddy for HTTPS** | Medium-High | More control, but you're responsible for OS updates/security patches yourself. |

I did **not** create any accounts or push anything on your behalf — that's your call to make. Below are the concrete steps for the Render path (what I'd pick), which this repo is already set up for via `render.yaml`.

### A note on the SQLite database + hosting platforms
This app uses Node's built-in SQLite (a single file at `webapp/data/app.db`) — no separate database server to manage. The one thing to get right on any host: **make sure the data folder is a persistent volume/disk**, not the platform's ephemeral filesystem, or your HPP entries and accounts will vanish on every redeploy/restart. The `DATA_DIR` env var (see `db.js`) lets you point the database at wherever that platform's persistent disk is mounted — `render.yaml` already wires this up for Render.

### Step-by-step: GitHub + Render

GitHub only stores your code — it can't run this app by itself (GitHub Pages is static-only). Render is what actually runs the server, and it deploys straight from your GitHub repo.

1. **Push to GitHub** (from inside `webapp/`):
   ```bash
   git init
   git add -A
   git commit -m "Initial commit"
   ```
   Create a new **private** repo on github.com (no README/license — you already have files), then:
   ```bash
   git remote add origin https://github.com/<youruser>/<yourrepo>.git
   git branch -M main
   git push -u origin main
   ```
2. **Create a Render account** at render.com (free to sign up), connect your GitHub account.
3. **New → Blueprint**, pick your repo. Render reads `render.yaml` automatically and sets up the web service, the persistent disk, and a random `SESSION_SECRET` for you.
4. Render will ask you to fill in `ADMIN_ACCOUNTS` (the one variable marked "sync: false" in `render.yaml`) — enter your login accounts right there, formatted as:
   ```
   aaron:SomeStrongPassword1,ibu:AnotherStrongPassword2
   ```
   Every account listed here is created automatically the first time the server starts — no shell/SSH access needed. (You can add more people later the same way: edit this env var and trigger a redeploy — accounts that already exist are left untouched.)
5. Deploy. Render gives you an HTTPS URL (`https://your-app.onrender.com`) — that's what you and your trusted people use to log in.
6. **Cost note:** persistent disks require Render's paid **Starter** plan (roughly $7/month at time of writing) — their free tier doesn't support attached disks, and without one your HPP data would be wiped on every redeploy.

From then on, `git push` to your repo auto-deploys the new version — no manual redeploy step.

---

## 3. Day-to-day usage (for the person using the site)

1. Log in. You land on a **Dashboard** with two cards: "Kalkulator Margin" and "Analisis Iklan" (each shows its headline numbers once a file has been uploaded).
2. Click **"Buka Kalkulator"** on that card (or "Kalkulator Margin" in the nav bar at the top) to get to the calculator itself, which has two tabs:
   - **"Unggah & Lihat Data"**: choose the Excel file downloaded from Shopee, click **"Proses File"**. A table appears with every sold item and its margin.
   - **"Atur Harga Modal (HPP)"**: view/edit/add the cost price for any product by its Product ID. This list is permanent and shared by everyone who logs in. You can also **bulk import/export the whole HPP list as a CSV file** (e.g. to migrate from the static version, or keep a backup) — buttons for both are in that tab.
3. Rows highlighted in yellow mean that product doesn't have a HPP yet — you can type it right into that row (press Enter to save), or go to the HPP tab. In the HPP tab, the **"Belum Diisi"** filter lists those products ordered by how much they sold in the uploaded file (a "Terjual (file ini)" column shows pcs and revenue), so you can fill in the ones that matter most first.
   Long date ranges: Shopee splits big exports into sheets named "Penghasilan - 1", "- 2", … — these load fine, all sheets are read and combined.
4. Click any column header (No. Pesanan, Jumlah, Untung, Margin %, etc.) to sort the table by that column — click again to reverse the order.
5. **Analisis Iklan** (nav bar): upload the **"Data Keseluruhan Iklan"** CSV from Seller Centre (Iklan Shopee → Unduh Data), ideally after uploading an Income file. The page answers four questions, in this order, with colours and one number each:
   1. **Anggaran Iklan** — a one-line rule from the store's weekly profit ("iklan naik, untung tidak naik → kurangi Modal Harian"), the share of the store's paid sales that ads claim ("iklan mengklaim N% penjualan" — near 100% means ads are just relabelling sales that would have happened anyway), and the total daily budget now → suggested. The weekly chart/table sits in a dropdown under it. This is the store-level verdict on whether ads pay off; Shopee's per-ad ROAS can't tell you that because it credits ads with other products and with sales that would have happened anyway.
   2. **Iklan yang Sedang Berjalan** — one row per running campaign. Type the **Modal Harian** and **Target ROAS** currently set in Seller Centre once (they're saved). Each row then shows *sekarang → saran* for the budget, *sekarang (minimal) ✓* for the target (minimal = ROAS minimum + 2), a small line with Shopee's ROAS and the direct ROAS vs the minimum (red when below — the ad may not be profitable even though Shopee says "Baik"), and one decision: **Lanjut**, **Kurangi modal** (halve, when the store rule says cut — the worst strict-profit campaigns first), **Naikkan target** (set target below the minimum), **Jeda** (margin ≤ 8% or even Shopee's ROAS below the minimum), **Tunggu** (campaign younger than 7 days — Shopee's learning phase, nothing is judged yet) or **Isi HPP dulu**. Running products are judged on their *running* campaign only, not the 3-month total. Click a row for the details.
   3. **Mulai Iklankan** — organic best-sellers with margin ≥ 20% and no ads, each with its target minimum.
   4. **Semua produk & rincian** (collapsed) — the full per-product table incl. ended campaigns, and the reading guide.
   Prices and Shopee's cut per product come from the Income file when loaded (otherwise the direct ad price and a 78% default, with a note). **Cancelled / unpaid orders:** Shopee counts ad sales when an order is *placed*, including orders that are later cancelled or never paid; the Income file only has paid-out orders. The app therefore (a) applies a store-wide paid-order rate to all ad sales — default 85%, editable under "Semua produk & rincian" (use 100 − "Tingkat Pesanan Tidak Terselesaikan" from Seller Centre), and (b) for campaigns that ended long enough ago for every order to be paid out, measures a hard upper bound from the Income file itself (paid ad orders can't exceed the product's total paid orders in the campaign window) and shows it per campaign ("Dibayar ≤ 14 / 29"). The ROAS minimum and the strict profit include this. Ad rows without a product code (Shopee's shop-level "Iklan Produk Otomatis" / Shop GMV Max) are kept as one "Iklan Toko" line so their cost isn't lost. Nothing from the uploaded files is stored on the server; only the typed Target ROAS / Modal Harian per product (table `iklan_setelan`) and the paid-order rate (table `pengaturan`) are.
6. **Jumlah (pcs) column:** Shopee's export doesn't always tell you how many units a row represents — when someone buys several of the same product in one order, Shopee sometimes bundles them into a single row. The app auto-detects this from price patterns in the file and multiplies HPP accordingly, but you can always correct the number yourself by typing directly into the "Jumlah" box — a "Reset" link appears if you want to go back to the auto-detected value.

---

## 4. Project structure

```
webapp/
  server.js         Express server: auth, HPP API (incl. CSV import/export), upload/parse endpoint,
                     manual "Jumlah" (pcs) override API, ads-analysis endpoints
  analisisIklan.js  Reads the Seller Centre "Data Keseluruhan Iklan" CSV and computes per-product
                     break-even ROAS / profit after ads from HPP + selling price + payout ratio,
                     and picks one Seller Centre action per product
  db.js             SQLite setup (users, product_hpp, order_item_jumlah, iklan_setelan, pengaturan,
                     shopee_token tables)
  parseExcel.js     Reads the Shopee "Penghasilan" sheet into clean rows, incl. auto-detecting
                     when a row represents more than 1 pcs of the same product (no explicit
                     quantity column exists in Shopee's export — see code comments for the method)
  shopeeApi.js      Shopee Open Platform API v2 client: HMAC signing, OAuth link/token exchange,
                     and a hard-allowlisted read-only request helper (see PROJECT_NOTES.md §20) —
                     not yet used by the UI, only by the /api/shopee/* test routes in server.js
  scripts/add-user.js   CLI to create/update login accounts
  public/           Frontend (Bahasa Indonesia UI): index.html, style.css, app.js
  data/app.db       SQLite database (gitignored — back this up, don't commit it)
  Dockerfile        For deploying to any container host
  docs/             The static version — see below
```

---

## The static (`docs/`) version — GitHub Pages

A completely self-contained rewrite with **no server, no database, no login**. Everything —
reading the Shopee Excel file, computing margins, storing HPP — happens in your browser.
Nothing is ever sent anywhere.

**How HPP data works here:** instead of a database, your cost list lives in a CSV file you
download and re-upload yourself (via the buttons in the "Atur Harga Modal" tab), plus an
automatic copy in that browser's local storage as a convenience so it survives a normal
refresh. If you edit HPP data and try to close the tab without downloading the updated CSV,
a banner (and the browser's own "leave site?" prompt) reminds you first — but browsers don't
allow a fully custom message there, and it won't catch a crash or force-quit, so make a habit
of clicking "Unduh CSV" after making changes you care about.

**Deploying it (free, forever):**

1. Push this repo to GitHub (see steps above if you haven't already).
2. On GitHub: **Settings → Pages** (left sidebar) → under "Build and deployment", set
   **Source: Deploy from a branch** → **Branch: `main`, folder: `/docs`** → Save.
3. GitHub gives you a URL like `https://<youruser>.github.io/<yourrepo>/` within a minute or two.
   That's it — no build step, no account, no ongoing cost.

**Keeping it updated:** any time you `git push` a change to `main`, GitHub Pages redeploys
automatically (takes a minute or so).

**Using it on multiple devices:** open the page on each device, and use "Unduh CSV" on one /
"Unggah CSV" on the other to carry your price list between them — there's no live sync.
