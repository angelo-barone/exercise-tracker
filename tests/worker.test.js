// Tests the sync Worker with an in-memory stand-in for Cloudflare KV. Uses only the FAKE test data.
// Run: node tests/worker.test.js   (Node 22 or newer)
const fs = require('fs'), path = require('path');
const fake = JSON.parse(fs.readFileSync(path.join(__dirname, 'fake-test-data.json')));
const results = [];
const ok = (name, cond, extra = '') => { results.push([cond ? 'PASS' : 'FAIL', name, extra]); };

class FakeKV {
  constructor() { this.m = new Map(); this.puts = 0; }
  async get(k, type) { const v = this.m.get(k); if (v === undefined) return null; return type === 'json' ? JSON.parse(v) : v; }
  async put(k, v) { this.puts++; this.m.set(k, v); }
}

(async () => {
  const mod = await import(path.join(__dirname, '..', 'worker', 'index.js'));
  const worker = mod.default;
  const env = { LOGBOOK: new FakeKV(), WRITE_KEY: 'w-secret-123', READ_KEY: 'r-secret-456' };
  const call = (method, p, { key, body, raw } = {}) => worker.fetch(new Request('https://w.example' + p, {
    method, headers: Object.assign({ 'Content-Type': 'application/json' }, key ? { Authorization: 'Bearer ' + key } : {}),
    body: raw !== undefined ? raw : (body ? JSON.stringify(body) : undefined)
  }), env);
  const payload = (data) => ({ app: 'pplx2-logbook', format: 1, sentAt: new Date().toISOString(), appVersion: '2.5.0', data });
  const good = payload(fake.data);
  const nSessions = Object.keys(fake.data.sessions).length;

  let r = await call('OPTIONS', '/sync');
  ok('preflight answers 204 with the GitHub Pages origin', r.status === 204 && r.headers.get('Access-Control-Allow-Origin') === 'https://angelo-barone.github.io' && /Authorization/.test(r.headers.get('Access-Control-Allow-Headers')));

  r = await call('POST', '/sync', { body: good });
  ok('send with no key is refused', r.status === 401);
  r = await call('POST', '/sync', { key: 'wrong', body: good });
  ok('send with wrong key is refused', r.status === 401);
  r = await call('POST', '/sync', { key: 'r-secret-456', body: good });
  ok('the read key cannot send', r.status === 401);
  ok('nothing stored after refused sends', env.LOGBOOK.puts === 0);

  r = await call('POST', '/sync', { key: 'w-secret-123', raw: '{not json' });
  ok('broken JSON is refused', r.status === 400);
  r = await call('POST', '/sync', { key: 'w-secret-123', body: { app: 'other', data: fake.data } });
  ok('wrong app is refused', r.status === 400);
  r = await call('POST', '/sync', { key: 'w-secret-123', body: { app: 'pplx2-logbook', data: { custom: {}, progress: {}, notes: {} } } });
  ok('missing collections are refused', r.status === 400);
  r = await call('POST', '/sync', { key: 'w-secret-123', raw: 'x'.repeat(4 * 1024 * 1024 + 5) });
  ok('oversize body is refused', r.status === 413);

  r = await call('POST', '/sync', { key: 'w-secret-123', body: good });
  let j = await r.json();
  ok('good send accepted', r.status === 200 && j.ok && j.summary.sessions === nSessions, JSON.stringify(j.summary));
  ok('good send answers with the origin header', r.headers.get('Access-Control-Allow-Origin') === 'https://angelo-barone.github.io');

  r = await call('GET', '/data');
  ok('read with no key is refused', r.status === 401);
  r = await call('GET', '/data', { key: 'w-secret-123' });
  ok('the send key cannot read', r.status === 401);
  r = await call('GET', '/data', { key: 'r-secret-456' });
  j = await r.json();
  ok('read returns exactly what was sent', r.status === 200 && JSON.stringify(j.data) === JSON.stringify(fake.data));
  r = await call('GET', '/status', { key: 'r-secret-456' });
  j = await r.json();
  ok('status has counts and no data', r.status === 200 && j.summary.sessions === nSessions && !('data' in j) && j.summary.lastSession > j.summary.firstSession, JSON.stringify(j.summary));

  // a wipe must not destroy the copy Claude can read
  const empty = JSON.parse(JSON.stringify(fake.data)); empty.sessions = {};
  r = await call('POST', '/sync', { key: 'w-secret-123', body: payload(empty) });
  j = await r.json();
  ok('send with fewer workouts is accepted and flagged', r.status === 200 && j.keptPrevious === true);
  r = await call('GET', '/data?copy=previous', { key: 'r-secret-456' });
  j = await r.json();
  ok('the bigger copy is kept as previous', r.status === 200 && Object.keys(j.data.sessions).length === nSessions);
  r = await call('GET', '/data', { key: 'r-secret-456' });
  j = await r.json();
  ok('latest is the new (smaller) copy', Object.keys(j.data.sessions).length === 0);

  r = await call('GET', '/nope', { key: 'r-secret-456' });
  ok('unknown path is 404', r.status === 404);
  const env2 = { LOGBOOK: new FakeKV(), WRITE_KEY: 'a', READ_KEY: 'b' };
  r = await worker.fetch(new Request('https://w.example/data', { headers: { Authorization: 'Bearer b' } }), env2);
  ok('read before anything was sent is 404', r.status === 404);
  const env3 = { LOGBOOK: new FakeKV() };
  r = await worker.fetch(new Request('https://w.example/sync', { method: 'POST', headers: { Authorization: 'Bearer ' }, body: JSON.stringify(good) }), env3);
  ok('with no keys configured nothing is accepted', r.status === 401);

  // keys made by /setup, no secrets typed anywhere
  const env4 = { LOGBOOK: new FakeKV() };
  const w4 = (method, p, key, body) => worker.fetch(new Request('https://logbook-sync.example.workers.dev' + p, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, key ? { Authorization: 'Bearer ' + key } : {}), body: body ? JSON.stringify(body) : undefined }), env4);
  r = await w4('POST', '/sync', '', good);
  ok('setup: before setup nothing is accepted', r.status === 401);
  r = await w4('GET', '/setup');
  j = await r.json();
  const wk = (j.syncCode || '').split('#')[1] || '';
  ok('setup: first visit makes a sync code and a read key', r.status === 200 && j.syncCode.startsWith('https://logbook-sync.example.workers.dev#') && /^[A-Za-z0-9_-]{40,}$/.test(wk) && /^[A-Za-z0-9_-]{40,}$/.test(j.readKey) && wk !== j.readKey, j.syncCode);
  r = await w4('GET', '/setup');
  ok('setup: second visit is closed and shows no keys', r.status === 410 && !JSON.stringify(await r.json()).includes(wk));
  r = await w4('POST', '/sync', wk, good);
  ok('setup: the new write key sends', r.status === 200);
  r = await w4('GET', '/data', wk);
  ok('setup: the write key cannot read', r.status === 401);
  r = await w4('GET', '/status', j.readKey);
  const st = await r.json();
  ok('setup: the new read key reads', r.status === 200 && st.summary.sessions === nSessions);
  r = await w4('POST', '/sync', j.readKey, good);
  ok('setup: the read key cannot send', r.status === 401);
  r = await worker.fetch(new Request('https://w.example/setup'), env);
  ok('setup: closed when keys are set as secrets', r.status === 410);

  console.log(results.map(x => x.join('  ')).join('\n'));
  console.log(results.filter(x => x[0] === 'FAIL').length + ' failed of ' + results.length);
  process.exit(results.some(x => x[0] === 'FAIL') ? 1 : 0);
})();
