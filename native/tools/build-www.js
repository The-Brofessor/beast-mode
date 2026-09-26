// Copies the web app from the repo root into native/www, the folder
// Capacitor bundles into the iPhone app. The web app stays the one source:
// nothing in www is edited by hand, and www is not committed.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, '..', 'www');

// The app's own files. sw.js stays out: the app's web view has no service
// worker, and native.js tells the app it is inside the native shell.
const FILES = ['index.html', 'beast-core.js', 'native.js', 'lz-string.min.js', 'manifest.webmanifest'];
const DIRS = ['icons', 'fonts'];

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const src = path.join(from, name), dst = path.join(to, name);
    if (fs.statSync(src).isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const f of FILES) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) { console.error('Missing ' + f + ' in the repo root.'); process.exit(1); }
  fs.copyFileSync(src, path.join(OUT, f));
}
for (const d of DIRS) copyDir(path.join(ROOT, d), path.join(OUT, d));
console.log('Copied the web app into native/www.');
