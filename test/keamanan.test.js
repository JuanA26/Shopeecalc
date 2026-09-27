const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Real server.js in a child process with a throwaway database and a test account. No Shopee keys,
// automatic sync off, so nothing leaves this machine.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keamanan-test-'));
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
let server = null;

async function nyalakan() {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, SESSION_SECRET: 'tes-rahasia', ADMIN_ACCOUNTS: 'tes:benar123',
      SINKRON_OTOMATIS: 'off', SHOPEE_PARTNER_ID: '', SHOPEE_PARTNER_KEY: '' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    try { await fetch(`${BASE}/api/me`); return; } catch (_) { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server tidak menyala');
}
async function matikan() {
  if (!server) return;
  const s = server; server = null;
  await new Promise((r) => { s.once('exit', r); s.kill(); });
}
after(async () => { await matikan(); fs.rmSync(dataDir, { recursive: true, force: true }); });

const login = (username, password, headers = {}) => fetch(`${BASE}/api/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ username, password }),
});

test('security headers, cross-site block, login limit, and login survives a restart', async () => {
  await nyalakan();

  const halaman = await fetch(`${BASE}/`);
  assert.match(halaman.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(halaman.headers.get('x-frame-options'), 'DENY');
  assert.equal(halaman.headers.get('x-content-type-options'), 'nosniff');

  // A request that changes data from another site is refused before it reaches the route.
  assert.equal((await login('tes', 'benar123', { Origin: 'https://situs-lain.example' })).status, 403);
  // Wrong input types are a clean 400, not a crash.
  assert.equal((await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"username":5,"password":[]}' })).status, 400);
  // Malformed JSON gets a JSON error, not an HTML stack trace.
  const rusak = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{rusak' });
  assert.equal(rusak.status, 400);
  assert.ok((await rusak.json()).error);

  // Correct login from the app's own origin; the session cookie is HttpOnly.
  const ok = await login('tes', 'benar123', { Origin: BASE });
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/i);
  const sid = cookie.split(';')[0];
  assert.equal((await (await fetch(`${BASE}/api/me`, { headers: { Cookie: sid } })).json()).loggedIn, true);

  // Sessions are stored in SQLite: still logged in after the server restarts (every deploy).
  await matikan();
  await nyalakan();
  assert.equal((await (await fetch(`${BASE}/api/me`, { headers: { Cookie: sid } })).json()).loggedIn, true);

  // After 10 wrong passwords, even the right one is refused for a while.
  for (let i = 0; i < 10; i++) assert.equal((await login('tes', 'salah')).status, 401);
  assert.equal((await login('tes', 'benar123')).status, 429);
});
