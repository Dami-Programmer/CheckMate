// Draws the CheckMate icon (green rounded square + white check mark) as PNGs
// in static/icons/. No image tools needed. Run: npm run icons
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const GREEN = [31, 122, 77];
const WHITE = [255, 255, 255];
const SS = 4; // supersampling for smooth edges

// Distance from point p to segment a-b.
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Coverage at (x, y) in a 0..1 square: returns [inside background, inside check mark].
function sample(x, y) {
  const r = 0.22, m = 0.02; // corner radius, margin
  const cx = Math.min(Math.max(x, m + r), 1 - m - r);
  const cy = Math.min(Math.max(y, m + r), 1 - m - r);
  const inBg = Math.hypot(x - cx, y - cy) <= r;
  const w = 0.075; // half the stroke width
  const inCheck =
    distToSegment(x, y, 0.27, 0.52, 0.43, 0.68) <= w || distToSegment(x, y, 0.43, 0.68, 0.74, 0.34) <= w;
  return [inBg, inBg && inCheck];
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4); // filter byte + RGBA
    for (let x = 0; x < size; x++) {
      let bg = 0, ck = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const [b, c] = sample((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          bg += b; ck += c;
        }
      const n = SS * SS, a = bg / n, t = bg ? ck / bg : 0;
      const o = 1 + x * 4;
      for (let i = 0; i < 3; i++) row[o + i] = Math.round(GREEN[i] * (1 - t) + WHITE[i] * t);
      row[o + 3] = Math.round(a * 255);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("static/icons", { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(`static/icons/${size}.png`, png(size));
  console.log(`static/icons/${size}.png`);
}
