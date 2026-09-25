// Klien Shopee Open Platform API v2 — signing HMAC-SHA256, link otorisasi OAuth, dan
// pemanggilan API level-toko yang sudah ditandatangani. Detail alur & endpoint diverifikasi
// langsung dari open.shopee.com/developer-guide (App management, Authorization and
// Authentication, API calls) 2026-09-23 — lihat §10/§19 PROJECT_NOTES.md (folder induk)
// untuk konteks kenapa modul ini dibuat dan urutan kerja yang direncanakan.
const crypto = require('crypto');

const HOST = {
  sandbox: {
    api: 'https://openplatform.sandbox.test-stable.shopee.sg',
    auth: 'https://open.sandbox.test-stable.shopee.com',
  },
  production: {
    api: 'https://partner.shopeemobile.com',
    auth: 'https://open.shopee.com',
  },
};

// Batas waktu per panggilan: tanpa ini satu permintaan yang menggantung membuat sinkron tidak
// pernah selesai, dan semua sinkron berikutnya ikut terkunci sampai server di-restart.
const BATAS_WAKTU_MS = 30 * 1000;

function getEnv() {
  return process.env.SHOPEE_ENV === 'production' ? 'production' : 'sandbox';
}

function getConfig() {
  const env = getEnv();
  const partnerId = Number(process.env.SHOPEE_PARTNER_ID);
  const partnerKey = process.env.SHOPEE_PARTNER_KEY;
  if (!partnerId || !partnerKey) {
    throw new Error('SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY belum diisi di .env — lihat .env.example.');
  }
  return { env, partnerId, partnerKey, api: HOST[env].api, auth: HOST[env].auth };
}

function hmac(partnerKey, baseString) {
  return crypto.createHmac('sha256', partnerKey).update(baseString).digest('hex');
}

// Pagar keras: aplikasi ini HANYA boleh MEMBACA data toko (pesanan, income, info toko),
// tidak pernah mengubahnya — tidak ada fitur di kalkulator margin yang butuh menulis balik ke
// Shopee (update produk, batalkan pesanan, ubah setelan iklan, dsb), jadi tidak ada alasan
// modul ini bisa memanggil endpoint jenis itu, sengaja atau tidak sengaja (bug, typo path,
// endpoint baru yang lupa dicek dulu). callShopApi() menolak apa pun yang tidak ada di daftar
// ini SEBELUM request dikirim ke Shopee — kalau butuh endpoint baru, tambahkan ke sini dulu
// dengan sadar (dan pastikan itu memang endpoint "get_"/pembacaan, bukan tindakan).
const ENDPOINT_BACA_SAJA = new Set([
  '/api/v2/shop/get_shop_info',
  '/api/v2/order/get_order_list',
  '/api/v2/order/get_order_detail',
  '/api/v2/payment/get_escrow_detail',
  '/api/v2/payment/get_escrow_list',
  '/api/v2/payment/get_escrow_detail_batch',
  '/api/v2/payment/get_income_detail',
  '/api/v2/payment/get_wallet_transaction_list',
  '/api/v2/payment/get_payout_detail',
  '/api/v2/payment/get_payout_info',
  '/api/v2/logistics/get_tracking_number',
  '/api/v2/logistics/get_tracking_info',
  // Modul Returns juga punya endpoint TINDAKAN (confirm, dispute, offer, accept_offer, ...) —
  // cuma get_return_detail yang dibuka: dipakai sinkronShopee.js untuk tahu barang MANA di
  // satu pesanan yang diretur (escrow detail hanya memberi daftar nomor returnya).
  '/api/v2/returns/get_return_detail',
  // Modul Ads — hanya laporan & setelan yang DIBACA (dicek di open.shopee.com 2026-09-25, semua
  // bisa dipanggil app "Seller In House System"). Endpoint create_/edit_ kampanye (termasuk
  // create/edit_gms_product_campaign) sengaja TIDAK dibuka: aplikasi hanya memberi saran, orang
  // yang mengubah iklan di Seller Centre (§13.5 PROJECT_NOTES.md).
  '/api/v2/ads/get_gms_campaign_performance', // POST; total per periode (start ≠ end, maks 1 bln)
  '/api/v2/ads/get_gms_item_performance', // POST; per produk, ada metrik direct_*
  '/api/v2/ads/list_gms_user_deleted_item', // POST; produk yang dikeluarkan dari GMV Max
  '/api/v2/ads/check_create_gms_product_campaign_eligibility', // cuma cek, tidak membuat apa-apa
  '/api/v2/ads/get_product_level_campaign_id_list',
  '/api/v2/ads/get_product_level_campaign_setting_info', // anggaran, roas_target, status
  '/api/v2/ads/get_product_campaign_daily_performance', // harian, ada direct_gmv
  '/api/v2/ads/get_all_cpc_ads_daily_performance', // total toko harian
  // reference_id di endpoint ini hanya penanda anti-duplikat untuk create_ yang TIDAK kita panggil.
  '/api/v2/ads/get_product_recommended_roi_target',
]);

// Tautan otorisasi (Seller in House System): seller login lalu redirect balik ke redirectUri
// dengan ?code=...&shop_id=.... auth_type selalu "seller" karena ini toko sendiri, bukan
// aplikasi ISV yang mengotorisasi merchant/supplier pihak lain.
function buildAuthUrl(redirectUri, state) {
  const { partnerId, auth } = getConfig();
  const params = new URLSearchParams({
    partner_id: String(partnerId),
    auth_type: 'seller',
    redirect_uri: redirectUri,
    response_type: 'code',
  });
  if (state) params.set('state', state);
  return `${auth}/auth?${params.toString()}`;
}

// Public API (tanpa access_token): dipakai untuk tukar code -> token dan refresh token.
async function callPublicApi(path, body) {
  const { partnerId, partnerKey, api } = getConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = hmac(partnerKey, `${partnerId}${path}${timestamp}`);
  const url = `${api}${path}?partner_id=${partnerId}&timestamp=${timestamp}&sign=${sign}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(BATAS_WAKTU_MS),
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ partner_id: partnerId, ...body }),
  });
  return res.json();
}

// shop_id WAJIB angka di body JSON: disimpan sebagai teks di SQLite, dan access_token/get
// menolak string ("the format of shop_id parameter is wrong" — terjadi di produksi 2026-09-25
// saat refresh pertama setelah 4 jam).
function getAccessToken({ code, shopId }) {
  return callPublicApi('/api/v2/auth/token/get', { code, shop_id: Number(shopId) });
}

function refreshAccessToken({ refreshToken, shopId }) {
  return callPublicApi('/api/v2/auth/access_token/get', { refresh_token: refreshToken, shop_id: Number(shopId) });
}

// Shop API (butuh access_token + shop_id), sudah ditandatangani. method GET pakai `query`
// (masuk ke query string), method POST pakai `body` (masuk ke request body JSON).
async function callShopApi(path, { shopId, accessToken, method = 'GET', query = {}, body } = {}) {
  if (!ENDPOINT_BACA_SAJA.has(path)) {
    throw new Error(
      `Ditolak: "${path}" bukan endpoint baca-saja yang terdaftar di ENDPOINT_BACA_SAJA ` +
      `(shopeeApi.js). Kalkulator margin ini sengaja dibatasi cuma boleh MEMBACA data ` +
      `Shopee — kalau endpoint ini memang cuma mengambil data (nama diawali get_/list_), ` +
      `tambahkan ke daftar itu dulu dengan sadar.`
    );
  }
  const { partnerId, partnerKey, api } = getConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = hmac(partnerKey, `${partnerId}${path}${timestamp}${accessToken}${shopId}`);
  const params = new URLSearchParams({
    partner_id: String(partnerId),
    timestamp: String(timestamp),
    access_token: accessToken,
    shop_id: String(shopId),
    sign,
  });
  for (const [k, v] of Object.entries(query)) params.set(k, v);
  const url = `${api}${path}?${params.toString()}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(BATAS_WAKTU_MS),
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
  });
  return res.json();
}

module.exports = { getEnv, buildAuthUrl, getAccessToken, refreshAccessToken, callShopApi };
