const { test } = require('node:test');
const assert = require('node:assert/strict');

// Fake keys and a stubbed fetch: nothing is sent to Shopee.
process.env.SHOPEE_PARTNER_ID = '1';
process.env.SHOPEE_PARTNER_KEY = 'kunci-tes';
const api = require('../shopeeApi');
api.JEDA_BATAS_LAJU_MS.splice(0, api.JEDA_BATAS_LAJU_MS.length, 1, 1, 1);

function stubFetch(balasan) {
  const panggilan = [];
  global.fetch = async (url) => {
    panggilan.push(url);
    const b = balasan[Math.min(panggilan.length - 1, balasan.length - 1)];
    return new Response(typeof b === 'string' ? b : JSON.stringify(b), { status: b.status || 200 });
  };
  return panggilan;
}
const panggil = () => api.callShopApi('/api/v2/ads/get_all_cpc_ads_daily_performance', { shopId: 9, accessToken: 't', query: { a: 1 } });

test('rate-limit replies are retried with a fresh signature, then succeed', async () => {
  const log = stubFetch([{ error: 'error_rate_limit', message: 'Too many requests' }, { error: 'error_rate_limit' }, { response: { ok: 1 } }]);
  assert.deepEqual(await panggil(), { response: { ok: 1 } });
  assert.equal(log.length, 3);
});

test('gives up after three retries and returns the rate-limit error', async () => {
  const log = stubFetch([{ error: 'error_rate_limit', message: 'Too many requests' }]);
  assert.equal((await panggil()).error, 'error_rate_limit');
  assert.equal(log.length, 4);
});

test('other errors are not retried; an HTML reply gives a readable error', async () => {
  let log = stubFetch([{ error: 'error_param', message: 'bad' }]);
  assert.equal((await panggil()).error, 'error_param');
  assert.equal(log.length, 1);
  log = stubFetch(['<html>502 Bad Gateway</html>']);
  await assert.rejects(panggil(), /bukan JSON/);
});

test('write endpoints are refused before any request is sent', async () => {
  const log = stubFetch([{ response: {} }]);
  await assert.rejects(api.callShopApi('/api/v2/ads/create_gms_product_campaign', { shopId: 9, accessToken: 't' }), /Ditolak/);
  assert.equal(log.length, 0);
});
