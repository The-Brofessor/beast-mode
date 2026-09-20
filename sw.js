/* Beast Mode service worker.

   Bump CACHE on every deploy. GitHub Pages serves with a 600s cache and no
   revalidation, so without a new cache name an installed app can sit on old
   files well past a push. The deploy checklist in CLAUDE.md names this step. */

var CACHE = 'beast-mode-v2.4.0';

// Everything the checklist needs to open with no signal.
var SHELL = [
  './',
  './index.html',
  './beast-core.js',
  './lz-string.min.js',
  './manifest.webmanifest',
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
