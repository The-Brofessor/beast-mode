/* Tests for the push worker's scheduling. Run: node --test worker/

   These cover the parts that decide WHO gets woken and WHEN, with a fake KV
   and a stubbed fetch. They do not prove a real push is delivered: that needs
   a live endpoint and a browser subscription, and is verified by hand once
   after deploying. */

const test = require('node:test');
const assert = require('node:assert');

const { webcrypto } = require('node:crypto');

let W, TEST_JWK, TEST_PUB;

test.before(async () => {
  W = await import('./src/index.js');
  // A throwaway key pair generated per run, so no private key is ever
  // committed and the real signing path is exercised end to end.
  const pair = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  TEST_JWK = JSON.stringify(await webcrypto.subtle.exportKey('jwk', pair.privateKey));
  const raw = await webcrypto.subtle.exportKey('raw', pair.publicKey);
  TEST_PUB = Buffer.from(raw).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
});

// ── a KV stand-in with the same surface the worker uses ────────────────────

function fakeKV(records) {
  const map = new Map(Object.entries(records || {}));
  return {
    map,
    async get(k) { return map.has(k) ? map.get(k) : null; },
    async put(k, v) { map.set(k, v); },
    async delete(k) { map.delete(k); },
    async list({ prefix, cursor }) {
      const keys = [...map.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name }));
      return { keys, list_complete: true, cursor: null };
    }
  };
}

function env(kv, opts) {
  return Object.assign({
    SUBS: kv,
    VAPID_PUBLIC_KEY: TEST_PUB,
    VAPID_SUBJECT: 'mailto:test@example.com',
    VAPID_PRIVATE_JWK: TEST_JWK
  }, opts);
}

function withFetch(statusFor, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { status: typeof statusFor === 'function' ? statusFor(url) : statusFor };
  };
  return fn(calls).finally(() => { globalThis.fetch = real; });
}

const sub = over => JSON.stringify(Object.assign({
  endpoint: 'https://push.example.com/abc',
  tz: 'UTC', slots: ['08:00'], quiet: null, updatedAt: '2026-09-20T00:00:00Z'
}, over));

// UTC instant for a given wall clock, so the tests do not depend on the
// machine's own timezone.
const utc = (h, m) => new Date(Date.UTC(2026, 8, 16, h, m, 0));   // a Wednesday

// ── local time ─────────────────────────────────────────────────────────────

test('localNow converts to a named timezone and a Monday-first weekday', () => {
  assert.deepStrictEqual(W.localNow('UTC', utc(8, 5)), { hhmm: '08:05', day: 2 });
  // New York is UTC-4 in September, so 08:05 UTC is 04:05 local, same day.
  assert.deepStrictEqual(W.localNow('America/New_York', utc(8, 5)), { hhmm: '04:05', day: 2 });
  // And the date can roll backwards across the offset.
  assert.strictEqual(W.localNow('America/New_York', utc(2, 0)).day, 1);
});

test('the cron window matches the interval the slot check assumes', () => {
  assert.strictEqual(W.CRON_WINDOW_MIN, 15);
});

// ── firing ─────────────────────────────────────────────────────────────────

test('a slot fires once inside its window and not outside it', async () => {
  for (const [h, m, expected] of [[8, 0, 1], [8, 14, 1], [8, 15, 0], [7, 59, 0]]) {
    const kv = fakeKV({ 'sub:a': sub() });
    await withFetch(201, async () => {
      const r = await W.fireDue(env(kv), utc(h, m));
      assert.strictEqual(r.sent, expected,
        'at ' + h + ':' + String(m).padStart(2, '0') + ' expected ' + expected);
    });
  }
});

test('each client is woken in their own timezone', async () => {
  // Both want 08:00 local. At 12:00 UTC it is 08:00 in New York only.
  const kv = fakeKV({
    'sub:ny': sub({ tz: 'America/New_York', endpoint: 'https://push.example.com/ny' }),
    'sub:utc': sub({ tz: 'UTC', endpoint: 'https://push.example.com/utc' })
  });
  await withFetch(201, async calls => {
    const r = await W.fireDue(env(kv), utc(12, 0));
    assert.strictEqual(r.sent, 1);
    assert.match(calls[0].url, /\/ny$/);
  });
});

test('quiet hours suppress a slot, including across midnight', async () => {
  const kv = fakeKV({ 'sub:a': sub({ slots: ['23:00'], quiet: { from: '22:00', to: '07:00' } }) });
  await withFetch(201, async () => {
    assert.strictEqual((await W.fireDue(env(kv), utc(23, 0))).sent, 0);
  });
  const kv2 = fakeKV({ 'sub:a': sub({ slots: ['08:00'], quiet: { from: '22:00', to: '07:00' } }) });
  await withFetch(201, async () => {
    assert.strictEqual((await W.fireDue(env(kv2), utc(8, 0))).sent, 1);
  });
});

test('a gone subscription is deleted rather than retried forever', async () => {
  const kv = fakeKV({ 'sub:a': sub(), 'sub:b': sub({ endpoint: 'https://push.example.com/gone' }) });
  await withFetch(url => url.endsWith('/gone') ? 410 : 201, async () => {
    const r = await W.fireDue(env(kv), utc(8, 0));
    assert.strictEqual(r.sent, 1);
    assert.strictEqual(r.cleaned, 1);
    assert.strictEqual(kv.map.has('sub:b'), false);
    assert.strictEqual(kv.map.has('sub:a'), true);
  });
});

test('a bad timezone falls back to UTC instead of stopping the run', async () => {
  const kv = fakeKV({ 'sub:bad': sub({ tz: 'Not/AZone' }), 'sub:ok': sub() });
  await withFetch(201, async () => {
    const r = await W.fireDue(env(kv), utc(8, 0));
    assert.strictEqual(r.scanned, 2);
    assert.strictEqual(r.sent, 2);
  });
});

test('the push carries no body, so nothing about the client travels', async () => {
  const kv = fakeKV({ 'sub:a': sub() });
  await withFetch(201, async calls => {
    await W.fireDue(env(kv), utc(8, 0));
    const init = calls[0].init;
    assert.strictEqual(init.body, undefined);
    assert.strictEqual(init.headers['content-length'], '0');
    assert.match(init.headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
    assert.ok(init.headers.Authorization.endsWith(', k=' + TEST_PUB));
  });
});

test('several slots in a day each fire at their own time', async () => {
  const kv = fakeKV({ 'sub:a': sub({ slots: ['08:00', '12:00', '21:00'] }) });
  for (const [h, expected] of [[8, 1], [12, 1], [21, 1], [15, 0]]) {
    await withFetch(201, async () => {
      assert.strictEqual((await W.fireDue(env(kv), utc(h, 0))).sent, expected);
    });
  }
});

// ── subscribe ──────────────────────────────────────────────────────────────

async function post(path, body, e) {
  return W.default.fetch(
    new Request('https://w.example.com' + path, {
      method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' }
    }), e);
}

test('subscribe stores only the fields the worker needs', async () => {
  const kv = fakeKV({});
  const res = await post('/subscribe', {
    id: 'client1',
    sub: { endpoint: 'https://push.example.com/x', keys: { p256dh: 'k', auth: 'a' } },
    tz: 'America/New_York', slots: ['08:00', 'nonsense', '21:00'],
    quiet: { from: '22:00', to: '07:00' },
    plan: 'this should not be stored', name: 'Vince'
  }, env(kv));
  assert.strictEqual(res.status, 200);

  const stored = JSON.parse(kv.map.get('sub:client1'));
  assert.deepStrictEqual(Object.keys(stored).sort(),
    ['endpoint', 'quiet', 'slots', 'tz', 'updatedAt']);
  assert.deepStrictEqual(stored.slots, ['08:00', '21:00']);   // the junk slot is dropped
  assert.strictEqual(stored.name, undefined);
  assert.strictEqual(stored.plan, undefined);
});

test('subscribe refuses incomplete input', async () => {
  const kv = fakeKV({});
  assert.strictEqual((await post('/subscribe', { id: 'a' }, env(kv))).status, 400);
  assert.strictEqual((await post('/subscribe', { sub: { endpoint: 'x' }, slots: [] }, env(kv))).status, 400);
  assert.strictEqual(kv.map.size, 0);
});

test('unsubscribe removes the record', async () => {
  const kv = fakeKV({ 'sub:a': sub() });
  assert.strictEqual((await post('/unsubscribe', { id: 'a' }, env(kv))).status, 200);
  assert.strictEqual(kv.map.size, 0);
});
