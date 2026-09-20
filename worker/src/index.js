/* Beast Mode push worker.

   It knows three things about a client: where to push, what timezone they are
   in, and which clock times to wake them at. It never sees an item name, a
   completion, a plan or a streak. The phone works out what the notification
   says when the push arrives.

   Deploy:  npx wrangler deploy
   Secret:  npx wrangler secret put VAPID_PRIVATE_JWK
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
