// native.js against a stand-in for the iPhone shell: a fake Capacitor with
// Preferences and App, and a fake localStorage. Node's runner only.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, 'native.js'), 'utf8');

function fakeStorage(init) {
  const data = new Map(Object.entries(init || {}));
  function Storage() {}
  Storage.prototype.getItem = function (k) { return data.has(k) ? data.get(k) : null; };
  Storage.prototype.setItem = function (k, v) { data.set(k, String(v)); };
  Storage.prototype.removeItem = function (k) { data.delete(k); };
  Storage.prototype.key = function (i) { return Array.from(data.keys())[i] || null; };
  const ls = new Storage();
  Object.defineProperty(ls, 'length', { get: () => data.size });
  return { Storage, ls, data };
}

function run({ native = true, prefs = {}, local = {}, launchUrl = null, slow = 0, fastTimeout = false } = {}) {
  const store = new Map(Object.entries(prefs));
  const listeners = {};
  const Preferences = {
    keys: async () => ({ keys: Array.from(store.keys()) }),
    get: async ({ key }) => { if (slow) await new Promise((r) => setTimeout(r, slow)); return { value: store.has(key) ? store.get(key) : null }; },
    set: async ({ key, value }) => { store.set(key, value); },
    remove: async ({ key }) => { store.delete(key); }
  };
  const App = {
    getLaunchUrl: async () => (launchUrl ? { url: launchUrl } : {}),
    addListener: (name, fn) => { listeners[name] = fn; }
  };
  const { Storage, ls, data } = fakeStorage(local);
  const reloads = [];
  const win = {
    Storage, localStorage: ls, Promise, Date,
    setTimeout: fastTimeout ? (fn, ms) => setTimeout(fn, ms === 3000 ? 0 : ms) : setTimeout,
    location: { reload: () => reloads.push(1) },
    Capacitor: native ? { isNativePlatform: () => true, registerPlugin: (n) => ({ Preferences, App })[n] } : undefined
  };
  win.window = win;
  vm.runInNewContext(SRC, win);
  return { win, store, data, listeners, reloads, native: win.BeastNative };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('on the web it does nothing and is ready at once', async () => {
  const { native, data } = run({ native: false, local: { 'bm2.client': 'x' } });
  assert.strictEqual(native.isNative, false);
  await native.ready;
  assert.strictEqual(data.get('bm2.client'), 'x');
});

test('what iOS kept is read back before boot, and wins over the web view', async () => {
  const { native, data } = run({ prefs: { 'bm2.client': 'kept', other: 'z' }, local: { 'bm2.client': 'stale' } });
  await native.ready;
  assert.strictEqual(data.get('bm2.client'), 'kept');
  assert.strictEqual(data.has('other'), false, 'only bm2 keys come back');
});

test('the first run copies the web view into Preferences once', async () => {
  const { native, store } = run({ local: { 'bm2.client': 'a', 'bm2.prefs': 'b', unrelated: 'c' } });
  await native.ready;
  assert.strictEqual(store.get('bm2.client'), 'a');
  assert.strictEqual(store.get('bm2.prefs'), 'b');
  assert.strictEqual(store.has('unrelated'), false);
});

test('after boot, bm2 writes and removals reach Preferences; others do not', async () => {
  const { native, win, store } = run();
  await native.ready;
  win.localStorage.setItem('bm2.client', '{"v":2}');
  win.localStorage.setItem('scratch', '1');
  await tick();
  assert.strictEqual(store.get('bm2.client'), '{"v":2}');
  assert.strictEqual(store.has('scratch'), false);
  win.localStorage.removeItem('bm2.client');
  await tick();
  assert.strictEqual(store.has('bm2.client'), false);
});

test('the link that launched the app is handed over once, even if reported twice', async () => {
  const url = 'https://app.thebrofessor.coach/#intake=abc';
  const { native, listeners } = run({ launchUrl: url });
  const got = [];
  listeners.appUrlOpen({ url });           // before the app listens: it waits
  native.onLink((u) => got.push(u));
  await tick();
  assert.deepStrictEqual(got, [url]);
});

test('a link tapped while the app is open is handed over', async () => {
  const { native, listeners } = run();
  const got = [];
  native.onLink((u) => got.push(u));
  listeners.appUrlOpen({ url: 'https://thebrofessor.coach/p/chris' });
  assert.deepStrictEqual(got, ['https://thebrofessor.coach/p/chris']);
});

test('when the wait runs out, nothing the app writes reaches the kept copy until it is read back, then the app starts again', async () => {
  const { native, win, store, reloads } = run({ prefs: { 'bm2.client': 'kept' }, slow: 30, fastTimeout: true });
  await native.ready;                       // timed out: the app boots on an empty web view
  win.localStorage.setItem('bm2.client', 'empty-app');
  await tick();
  assert.strictEqual(store.get('bm2.client'), 'kept', 'the early write did not overwrite the kept copy');
  await new Promise((r) => setTimeout(r, 80));
  assert.strictEqual(win.localStorage.getItem('bm2.client'), 'kept');
  assert.strictEqual(reloads.length, 1, 'started again on the kept copy');
});
