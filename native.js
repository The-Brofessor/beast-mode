/* The native shell's side of the app (native app brief, 2026-09-25).

   Loaded by index.html on the web and in the iPhone app alike. On the web it
   does nothing: BeastNative.isNative is false and ready resolves at once.
   Inside the app (Capacitor) it does three things:

   1. Storage. iOS may clear a web view's localStorage when the phone is low
      on space, so every bm2.* key is also written to Capacitor Preferences,
      and Preferences is read back into localStorage before the app boots.
      The app keeps using localStorage as it always has.
   2. Links. A tapped plan or intake link opens the app instead of Safari;
      onLink hands the app the link, as if it had been pasted.
   3. Nothing else yet: push arrives with the Apple account.

   A classic script, like beast-core.js, so the app's inline handlers and
   boot code can see window.BeastNative. */
(function () {
  'use strict';

  var cap = window.Capacitor;
  var isNative = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());

  function plugin(name) {
    if (!isNative) return null;
    try { return cap.registerPlugin ? cap.registerPlugin(name) : (cap.Plugins || {})[name] || null; }
    catch (e) { return (cap.Plugins || {})[name] || null; }
  }

  var OURS = /^bm2\./;
  var Prefs = plugin('Preferences');
  var App = plugin('App');

  // localStorage is the app's working copy; Preferences is the one iOS keeps.
  function mirror() {
    var proto = window.Storage && Storage.prototype;
    if (!proto || proto.__bmMirrored) return;
    var set = proto.setItem, remove = proto.removeItem;
    proto.setItem = function (k, v) {
      set.call(this, k, v);
      if (this === window.localStorage && OURS.test(k)) Prefs.set({ key: k, value: String(v) }).catch(function () {});
    };
    proto.removeItem = function (k) {
      remove.call(this, k);
      if (this === window.localStorage && OURS.test(k)) Prefs.remove({ key: k }).catch(function () {});
    };
    proto.__bmMirrored = true;
  }

  async function restore() {
    var got = await Prefs.keys();
    var keys = (got && got.keys || []).filter(function (k) { return OURS.test(k); });
    if (keys.length) {
      // Preferences wins: it is the copy that survives. Every value is read
      // first and written in one go, so the app never sees half of them.
      var vals = [];
      for (var i = 0; i < keys.length; i++) {
        var r = await Prefs.get({ key: keys[i] });
        if (r && r.value !== null && r.value !== undefined) vals.push([keys[i], r.value]);
      }
      var changed = vals.some(function (kv) { return localStorage.getItem(kv[0]) !== kv[1]; });
      vals.forEach(function (kv) { localStorage.setItem(kv[0], kv[1]); });
      // The app already started without them (the 3-second wait ran out):
      // start it again on the kept copy rather than let it run on the other.
      if (timedOut && changed) location.reload();
    } else {
      // First run of a build with this file: whatever the web view holds
      // goes to Preferences once.
      for (var j = 0; j < localStorage.length; j++) {
        var k = localStorage.key(j);
        if (OURS.test(k)) await Prefs.set({ key: k, value: localStorage.getItem(k) });
      }
    }
  }

  // Boot waits for this, never for long: after 3 seconds the app starts on
  // what the web view holds rather than hang on a blank screen. Writes reach
  // Preferences only once the restore has finished, so an app started early
  // can never overwrite the kept copy with an empty one (CTO, 2026-09-25).
  var timedOut = false;
  var restored = !isNative || !Prefs ? Promise.resolve() : restore().catch(function () {}).then(mirror);
  var ready = !isNative || !Prefs ? Promise.resolve() : Promise.race([
    restored,
    new Promise(function (res) { setTimeout(function () { timedOut = true; res(); }, 3000); })
  ]);

  // A link can arrive before the app has booted (the tap that launched it)
  // or while it is open. A launch can report the same tap twice (the launch
  // URL and the open event), so one link inside 5 seconds counts once; the
  // same link tapped again later opens again. Links that come before the
  // app is listening wait for it.
  var linkFns = [], waiting = [], seen = {};
  function deliver(url) {
    if (!url) return;
    var now = Date.now();
    if (seen[url] && now - seen[url] < 5000) return;
    seen[url] = now;
    if (!linkFns.length) { waiting.push(url); return; }
    linkFns.forEach(function (fn) { try { fn(url); } catch (e) {} });
  }
  function onLink(fn) {
    linkFns.push(fn);
    waiting.splice(0).forEach(function (url) { try { fn(url); } catch (e) {} });
    if (!App) return;
    App.getLaunchUrl().then(function (r) { if (r && r.url) deliver(r.url); }).catch(function () {});
  }
  if (App) App.addListener('appUrlOpen', function (e) { deliver(e && e.url); });

  window.BeastNative = { isNative: isNative, ready: ready, onLink: onLink };
})();
