# Beast Mode push worker

Reminders for items with a due-by time. Runs on Cloudflare's free tier.

## What it knows about a client

Three things: a push endpoint, a timezone name, and a list of clock times.

It never sees an item name, a completion, a plan, a streak or a client's name.
The push it sends has **no body at all**. When the phone wakes, the service
worker reads a small mirror in IndexedDB and writes the notification text on
the device.

## Setup

Once, and it takes about ten minutes.

**1. Install the CLI and sign in.**

```bash
npx wrangler login
```

**2. Generate the VAPID keys.**

```bash
node worker/generate-vapid.js
```

It prints a public key and a private key. The public key is safe to publish.
The private key is a secret: do not commit it, do not paste it into chat.

**3. Create the KV namespace.**

```bash
npx wrangler kv namespace create SUBS
```

Copy the `id` it prints into `worker/wrangler.toml`.

**4. Put the public key into `wrangler.toml`** as `VAPID_PUBLIC_KEY`, and check
`VAPID_SUBJECT` is your email.

**5. Store the private key as a secret.**

```bash
cd worker
npx wrangler secret put VAPID_PRIVATE_JWK
```

Paste the whole JSON object when it asks.

**6. Deploy.**

```bash
npx wrangler deploy
```

It prints the worker URL, something like
`https://beast-mode-push.<your-subdomain>.workers.dev`.

**7. Point the app at it.** In `index.html`, set the two constants near the top
of the reminders section:

```js
var PUSH_URL = 'https://beast-mode-push.<your-subdomain>.workers.dev';
var VAPID_PUBLIC_KEY = '<the public key from step 2>';
```

Both are empty by default, which keeps reminders switched off and the app
working normally for anyone who never sets this up.

**8. Check it is alive.**

```bash
curl https://beast-mode-push.<your-subdomain>.workers.dev/health
```

## Testing a real push

The tests cover who gets woken and when. They do not prove delivery, which
needs a live browser subscription. Once after deploying:

1. Open the app on your phone, add it to the home screen (required on iPhone),
   and turn reminders on from the Profile tab.
2. Add an item with a due-by a few minutes ahead and leave it unticked.
3. Wait for the next quarter hour.

If nothing arrives, `npx wrangler tail` shows the cron runs live.

## Cost

Cloudflare's free tier covers 100,000 worker requests and 100,000 KV reads a
day, and cron triggers are included. A cron every 15 minutes with a handful of
clients uses a tiny fraction of that.

## Notes

- **iPhone needs the app installed.** Web push on iOS works only for a PWA
  added to the home screen, on iOS 16.4 or later. The install card in the app
  tells clients how.
- **`CRON_WINDOW_MIN` in `src/index.js` must match the cron in
  `wrangler.toml`.** They are 15 and `*/15` now. Change one without the other
  and slots either fire twice or are missed.
- A subscription that returns 404 or 410 is deleted automatically, so a client
  who uninstalls stops being pushed to without anyone doing anything.

## Tests

```bash
node --test worker/worker.test.js
```

A fake KV and a stubbed fetch, with a throwaway VAPID key generated per run so
the real signing path is exercised and no private key is ever committed.
