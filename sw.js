/* Beast Mode service worker.

   Bump CACHE on every deploy. GitHub Pages serves with a 600s cache and no
   revalidation, so without a new cache name an installed app can sit on old
   files well past a push. The deploy checklist in CLAUDE.md names this step. */

var CACHE = 'beast-mode-v2.12.0-a2';

// Everything the checklist needs to open with no signal.
var SHELL = [
  './',
  './index.html',
  './beast-core.js',
  './lz-string.min.js',
  './manifest.webmanifest',
  './fonts/inter-latin.woff2',
  './fonts/barlow-condensed-600.woff2',
  './fonts/barlow-condensed-700.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      // A single failed file would reject addAll and leave the worker
      // uninstalled, so each one is allowed to fail on its own.
      .then(function (c) {
        return Promise.all(SHELL.map(function (url) {
          return c.add(url).catch(function () {});
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // shorteners, nothing else

  // HTML goes to the network first, so a deploy reaches an installed app on
  // the next open rather than whenever the cache name happens to change.
  // Cache is the fallback, which is what keeps the checklist usable offline.
  var isPage = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').indexOf('text/html') !== -1;

  if (isPage) {
    e.respondWith(
      fetch(req)
        .then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
          return res;
        })
        .catch(function () {
          return caches.match(req).then(function (hit) {
            return hit || caches.match('./index.html');
          });
        })
    );
    return;
  }

  // Scripts, icons and the manifest are served from cache and refreshed in the
  // background, so the app opens instantly and still picks up new files.
  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});

/* ── push ─────────────────────────────────────────────────────────────────

   The push arrives with no body. Everything the notification says is read
   from IndexedDB on this device, which is why no plan data has to sit on the
   server. localStorage is not available in a worker, so the page keeps a
   small mirror in IndexedDB for exactly this.                              */

var DB = 'bm2';
var STORE = 'reminders';

function readMirror() {
  return new Promise(function (resolve) {
    var open;
    try { open = indexedDB.open(DB, 1); } catch (e) { return resolve(null); }
    open.onupgradeneeded = function () {
      if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE);
    };
    open.onerror = function () { resolve(null); };
    open.onsuccess = function () {
      var db = open.result;
      if (!db.objectStoreNames.contains(STORE)) { resolve(null); return; }
      var req = db.transaction(STORE, 'readonly').objectStore(STORE).get('current');
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { resolve(null); };
    };
  });
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function nowLocal() {
  var d = new Date();
  return {
    date: d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()),
    hhmm: pad2(d.getHours()) + ':' + pad2(d.getMinutes())
  };
}

self.addEventListener('push', function (e) {
  e.waitUntil(readMirror().then(function (m) {
    var now = nowLocal();
    var title = 'Beast Mode';

    // Every push must show a notification. Browsers treat a silent push as
    // abuse: Safari can revoke the permission, Chrome shows its own generic
    // notice. So when this phone's copy of today's list is out of date or has
    // nothing for this slot, it still says something true and useful.
    var body = 'Open Beast Mode to see what’s left today.';

    if (m && Array.isArray(m.due)) {
      // The page writes one row per slot for today. Pick the slot closest at
      // or before now, so a push that lands a minute late still matches.
      var best = null;
      m.due.forEach(function (row) {
        if (row.date !== now.date) return;
        if (row.slot <= now.hhmm && (!best || row.slot > best.slot)) best = row;
      });
      if (best && best.text) body = best.text;
    }

    return self.registration.showNotification(title, {
      body: body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: 'beast-mode-due',      // a second push replaces rather than stacks
      renotify: true,
      data: { url: './index.html' }
    });
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || './index.html';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].url.indexOf('index.html') !== -1 && 'focus' in list[i]) return list[i].focus();
    }
    return clients.openWindow(url);
  }));
});
