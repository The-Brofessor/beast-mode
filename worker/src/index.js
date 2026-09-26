/* Beast Mode push worker.

   It knows three things about a client: where to push, what timezone they are
   in, and which clock times to wake them at. It never sees an item name, a
   completion, a plan or a streak. The phone works out what the notification
   says when the push arrives.

   Deploy:  npx wrangler deploy
   Secrets: npx wrangler secret put VAPID_PRIVATE_JWK
            npx wrangler secret put APNS_KEY   (the iPhone app's push key, .p8)
*/

const CRON_WINDOW_MIN = 15;   // must match the cron in wrangler.toml

// ── helpers ────────────────────────────────────────────────────────────────

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', ...cors() }
});

function cors() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type'
  };
}

function b64urlToBytes(s) {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - pad.length % 4) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function bytesToB64url(bytes) {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Local wall-clock time in a named timezone, as 'HH:MM' and a weekday index
// with Monday as 0. Intl does the DST work, which is the whole reason the
// client sends a timezone name rather than a fixed offset.
function localNow(tz, now) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit',
    weekday: 'short', hour12: false
  }).formatToParts(now);
  const get = t => (parts.find(p => p.type === t) || {}).value;
  const days = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return { hhmm: get('hour') + ':' + get('minute'), day: days[get('weekday')] };
}

function minutesOf(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// ── VAPID ──────────────────────────────────────────────────────────────────

async function vapidHeader(endpoint, env) {
  const aud = new URL(endpoint).origin;
  const header = { typ: 'JWT', alg: 'ES256' };
  const body = {
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || 'mailto:admin@example.com'
  };
  const enc = o => bytesToB64url(new TextEncoder().encode(JSON.stringify(o)));
  const signingInput = enc(header) + '.' + enc(body);

  const key = await crypto.subtle.importKey(
    'jwk', JSON.parse(env.VAPID_PRIVATE_JWK),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key,
    new TextEncoder().encode(signingInput)
  );

  return 'vapid t=' + signingInput + '.' + bytesToB64url(sig) + ', k=' + env.VAPID_PUBLIC_KEY;
}

// A push with no body. The service worker builds the notification from the
// device's own data, so there is nothing to encrypt and nothing to leak.
async function sendPush(sub, env) {
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(sub.endpoint, env),
      TTL: '900',
      'content-length': '0'
    }
  });
  return res.status;
}

// ── Apple push (APNs) ──────────────────────────────────────────────────────
// For the native iPhone app (native app brief, 2026-09-25). A token signed
// with Chris's push key (.p8, the APNS_KEY secret) proves the push is ours;
// Apple allows one token per key to be reused for up to an hour, so it is
// kept for 50 minutes. TestFlight and App Store builds use the production
// host; APNS_HOST points a Xcode debug build at the sandbox.

const APNS_TOPIC = 'coach.thebrofessor.beastmode';
let apnsJwt = null;   // { token, at, kid }

function pemToDer(pem) {
  const b64 = String(pem).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

async function apnsToken(env, nowMs) {
  if (apnsJwt && apnsJwt.kid === env.APNS_KEY_ID && nowMs - apnsJwt.at < 50 * 60 * 1000) return apnsJwt.token;
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(env.APNS_KEY),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const enc = o => bytesToB64url(new TextEncoder().encode(JSON.stringify(o)));
  const input = enc({ alg: 'ES256', kid: env.APNS_KEY_ID }) + '.' + enc({ iss: env.APNS_TEAM_ID, iat: Math.floor(nowMs / 1000) });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(input));
  apnsJwt = { token: input + '.' + bytesToB64url(sig), at: nowMs, kid: env.APNS_KEY_ID };
  return apnsJwt.token;
}

export function apnsReady(env) {
  return !!(env.APNS_KEY && env.APNS_KEY_ID && env.APNS_TEAM_ID);
}

// { status, reason }: 200 is delivered to Apple; 410 or BadDeviceToken means
// the phone no longer takes pushes (the app was deleted).
export async function sendApns(deviceToken, alert, env, nowMs = Date.now()) {
  const host = env.APNS_HOST || 'https://api.push.apple.com';
  const res = await fetch(host + '/3/device/' + deviceToken, {
    method: 'POST',
    headers: {
      authorization: 'bearer ' + await apnsToken(env, nowMs),
      'apns-topic': APNS_TOPIC,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-expiration': '0',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ aps: { alert: { title: alert.title, body: alert.body }, sound: 'default' } })
  });
  let reason = '';
  if (res.status !== 200) { try { reason = (await res.json()).reason || ''; } catch { /* no body */ } }
  return { status: res.status, reason };
}

const DEVICE_TOKEN = /^[0-9a-fA-F]{64,200}$/;

// POST /device { id, token, tz }: the iPhone app's device token, stored
// under the same id as a web push subscription. Nothing else is kept.
async function device(req, env) {
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
  const { id, token, tz } = body || {};
  if (!id || typeof id !== 'string' || id.length > 100) return json({ error: 'Missing id' }, 400);
  if (!DEVICE_TOKEN.test(String(token || ''))) return json({ error: 'Missing device token' }, 400);
  await env.SUBS.put('dev:' + id, JSON.stringify({
    token: token.toLowerCase(), tz: typeof tz === 'string' ? tz : 'UTC', updatedAt: new Date().toISOString()
  }));
  return json({ ok: true });
}

// POST /device/test { id }: one test notification to that phone, and only to
// that phone. At most one a minute per phone.
async function deviceTest(req, env) {
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
  const id = body && typeof body.id === 'string' ? body.id : '';
  const raw = id ? await env.SUBS.get('dev:' + id) : null;
  if (!raw) return json({ error: 'This phone is not signed up for notifications yet.' }, 404);
  if (!apnsReady(env)) return json({ error: 'Notifications are not set up on the server yet.' }, 503);
  if (await env.SUBS.get('devtest:' + id) !== null) return json({ error: 'One test a minute. Try again shortly.' }, 429);
  await env.SUBS.put('devtest:' + id, '1', { expirationTtl: 60 });
  const rec = JSON.parse(raw);
  const out = await sendApns(rec.token, { title: 'Beast Mode', body: 'Notifications work. Now go crush the day.' }, env);
  if (out.status === 410 || out.reason === 'BadDeviceToken' || out.reason === 'Unregistered') await env.SUBS.delete('dev:' + id);
  return out.status === 200 ? json({ ok: true }) : json({ error: 'Apple said no: ' + (out.reason || out.status), status: out.status, reason: out.reason }, 502);
}

// ── routes ─────────────────────────────────────────────────────────────────

async function subscribe(req, env) {
  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'Bad JSON' }, 400); }

  const { id, sub, tz, slots, quiet } = body || {};
  if (!id || !sub || !sub.endpoint) return json({ error: 'Missing id or subscription' }, 400);
  if (!Array.isArray(slots)) return json({ error: 'Missing slots' }, 400);

  // Only these fields are stored. Anything else a client sends is dropped.
  const record = {
    endpoint: sub.endpoint,
    tz: typeof tz === 'string' ? tz : 'UTC',
    slots: slots.filter(s => minutesOf(s) !== null).slice(0, 24),
    quiet: quiet && quiet.from && quiet.to ? { from: quiet.from, to: quiet.to } : null,
    updatedAt: new Date().toISOString()
  };
  await env.SUBS.put('sub:' + id, JSON.stringify(record));
  return json({ ok: true, slots: record.slots.length });
}

async function unsubscribe(req, env) {
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
  if (!body || !body.id) return json({ error: 'Missing id' }, 400);
  await env.SUBS.delete('sub:' + body.id);
  await env.SUBS.delete('dev:' + body.id);   // the iPhone app's token too
  return json({ ok: true });
}

// ── cron ───────────────────────────────────────────────────────────────────

async function fireDue(env, now) {
  let cursor, sent = 0, cleaned = 0, scanned = 0;

  do {
    const page = await env.SUBS.list({ prefix: 'sub:', cursor });
    cursor = page.list_complete ? null : page.cursor;

    for (const key of page.keys) {
      scanned++;
      const raw = await env.SUBS.get(key.name);
      if (!raw) continue;
      let rec;
      try { rec = JSON.parse(raw); } catch { continue; }

      let local;
      try { local = localNow(rec.tz, now); }
      catch { local = localNow('UTC', now); }   // a bad tz must not stop the run

      const mins = minutesOf(local.hhmm);
      const due = rec.slots.some(s => {
        const m = minutesOf(s);
        // Fires once per slot: the window is [slot, slot + cron interval).
        return m !== null && mins >= m && mins < m + CRON_WINDOW_MIN;
      });
      if (!due) continue;

      if (rec.quiet) {
        const a = minutesOf(rec.quiet.from), b = minutesOf(rec.quiet.to);
        const quiet = a <= b ? (mins >= a && mins < b) : (mins >= a || mins < b);
        if (quiet) continue;
      }

      const status = await sendPush({ endpoint: rec.endpoint }, env);
      if (status === 404 || status === 410) {
        // The browser has thrown the subscription away; stop pushing to it.
        await env.SUBS.delete(key.name);
        cleaned++;
      } else if (status >= 200 && status < 300) {
        sent++;
      }
    }
  } while (cursor);

  return { scanned, sent, cleaned };
}

// ── entry ──────────────────────────────────────────────────────────────────

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors() });
    const path = new URL(req.url).pathname;

    if (req.method === 'POST' && path === '/subscribe') return subscribe(req, env);
    if (req.method === 'POST' && path === '/unsubscribe') return unsubscribe(req, env);
    if (req.method === 'POST' && path === '/device') return device(req, env);
    if (req.method === 'POST' && path === '/device/test') return deviceTest(req, env);
    if (req.method === 'GET' && path === '/health') return json({ ok: true });

    return json({ error: 'Not found' }, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(fireDue(env, new Date(event.scheduledTime)));
  }
};

// Exported for the tests, which exercise the scheduling maths without a
// network or a KV binding.
export { localNow, minutesOf, fireDue, CRON_WINDOW_MIN };
