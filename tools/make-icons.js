/* Generates the PWA icons. Run: node tools/make-icons.js
   No dependencies: raw PNG encoding on top of Node's zlib, same rule as the
   rest of the project. Re-run it if the brand colours change. */

const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const BG = [15, 23, 42];      // --bg   #0f172a
const FG = [59, 130, 246];    // --accent #3b82f6

// ── PNG encoding ───────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// pixels: (x, y) -> [r, g, b]
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0;                       // filter: none
    for (let x = 0; x < size; x++) {
      const c = pixel(x, y);
      raw[p++] = c[0]; raw[p++] = c[1]; raw[p++] = c[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 2;    // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ── the mark: a barbell ────────────────────────────────────────────────────

function rounded(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// `inset` leaves a safe margin so a maskable icon survives being cropped to a
// circle on Android.
function mark(size, inset) {
  const s = size, m = inset * s;
  const L = 0.14 * s + m;          // outer edge of the left plate
  const R = 0.86 * s - m;          // outer edge of the right plate
  const plateW = 0.105 * s;        // narrow and tall, so it reads as a
  const plateH = 0.25 * s;         // dumbbell rather than a letter H
  const collarW = 0.055 * s;
  const collarH = 0.155 * s;
  const mid = 0.5 * s;
  const bar = [L + plateW, mid - 0.042 * s, R - plateW, mid + 0.042 * s];
  const r = 0.03 * s;

  const box = (x0, w, h) => [x0, mid - h, x0 + w, mid + h];
  const parts = [
    [...bar, r * 0.5],
    [...box(L, plateW, plateH), r],                          // left plate
    [...box(R - plateW, plateW, plateH), r],                 // right plate
    [...box(L + plateW, collarW, collarH), r * 0.7],         // left collar
    [...box(R - plateW - collarW, collarW, collarH), r * 0.7]
  ];

  return (x, y) => {
    for (const p of parts) if (rounded(x, y, p[0], p[1], p[2], p[3], p[4])) return FG;
    return BG;
  };
}

// ── write them ─────────────────────────────────────────────────────────────

const out = path.join(__dirname, '..', 'icons');
fs.mkdirSync(out, { recursive: true });

const files = [
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  // Maskable icons get cropped, so the mark sits further in.
  ['icon-192-maskable.png', 192, 0.10],
  ['icon-512-maskable.png', 512, 0.10],
  // iOS home screen. No transparency, no rounding: iOS applies its own.
  ['apple-touch-icon.png', 180, 0.04]
];

for (const [name, size, inset] of files) {
  fs.writeFileSync(path.join(out, name), png(size, mark(size, inset)));
  console.log('  ' + name.padEnd(26) + size + 'x' + size);
}
console.log('icons written to ' + out);
