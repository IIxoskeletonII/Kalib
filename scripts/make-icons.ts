// Generates the PWA icons procedurally (no image toolchain needed): a rounded dark tile with a
// cyan "K" drawn from three strokes. Run with `npm run icons`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const OUT = join(import.meta.dirname, '..', 'public', 'icons');
const BG = [0x12, 0x14, 0x17] as const;
const FG = [0x3a, 0xd3, 0xc0] as const;

type Seg = [number, number, number, number];
// K glyph in unit coordinates (x1, y1, x2, y2).
const K: Seg[] = [
  [0.33, 0.25, 0.33, 0.75],
  [0.35, 0.51, 0.66, 0.25],
  [0.4, 0.47, 0.68, 0.75],
];
const STROKE = 0.13;

function distToSeg(px: number, py: number, [x1, y1, x2, y2]: Seg): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Coverage (0..1) of the glyph and of the tile at a unit-square point. */
function sample(u: number, v: number, radius: number): { tile: number; glyph: number } {
  // Rounded-square tile.
  const ax = Math.abs(u - 0.5) - (0.5 - radius);
  const ay = Math.abs(v - 0.5) - (0.5 - radius);
  const outside = Math.hypot(Math.max(ax, 0), Math.max(ay, 0)) - radius;
  const tile = outside <= 0 ? 1 : 0;
  let glyph = 0;
  for (const s of K) if (distToSeg(u, v, s) <= STROKE / 2) glyph = 1;
  return { tile, glyph };
}

function render(size: number, opts: { maskable: boolean; scale?: number }): Uint8Array {
  const ss = 4;
  const radius = opts.maskable ? 0 : 0.22;
  const scale = opts.scale ?? (opts.maskable ? 0.8 : 1);
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let tile = 0;
      let glyph = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss) / size;
          const v = (y + (sy + 0.5) / ss) / size;
          // Glyph is scaled about the centre (maskable icons keep content in the safe zone).
          const gu = (u - 0.5) / scale + 0.5;
          const gv = (v - 0.5) / scale + 0.5;
          const s = sample(u, v, radius);
          tile += s.tile;
          glyph += sample(gu, gv, radius).glyph;
        }
      }
      tile /= ss * ss;
      glyph /= ss * ss;
      const i = (y * size + x) * 4;
      px[i] = Math.round(BG[0] + (FG[0] - BG[0]) * glyph);
      px[i + 1] = Math.round(BG[1] + (FG[1] - BG[1]) * glyph);
      px[i + 2] = Math.round(BG[2] + (FG[2] - BG[2]) * glyph);
      px[i + 3] = Math.round(255 * tile);
    }
  }
  return px;
}

// --- minimal PNG writer ----------------------------------------------------------------
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size: number, rgba: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
const files: [string, number, { maskable: boolean; scale?: number }][] = [
  ['icon-192.png', 192, { maskable: false }],
  ['icon-512.png', 512, { maskable: false }],
  ['icon-512-maskable.png', 512, { maskable: true }],
  // iOS applies its own mask; supply a full-bleed square.
  ['apple-touch-icon.png', 180, { maskable: true, scale: 0.9 }],
];
for (const [name, size, opts] of files) {
  writeFileSync(join(OUT, name), png(size, render(size, opts)));
  console.log(`${name} ${size}px`);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="22" fill="#121417"/>
<g stroke="#3ad3c0" stroke-width="13" stroke-linecap="round" fill="none">
<line x1="33" y1="25" x2="33" y2="75"/><line x1="35" y1="51" x2="66" y2="25"/><line x1="40" y1="47" x2="68" y2="75"/>
</g></svg>
`;
writeFileSync(join(OUT, 'icon.svg'), svg);
console.log('icon.svg');
