import zlib from 'node:zlib';

// Jarvis app icon, drawn on the fly (holographic rings on deep navy). Used for the installed app and the browser tab.
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c });
const crc32 = buf => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0 };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t) };

function draw(S) {
  const raw = Buffer.alloc((S * 3 + 1) * S);
  const px = 1 / S, c = S / 2;
  for (let y = 0; y < S; y++) {
    raw[y * (S * 3 + 1)] = 0;
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5 - c) / S, dy = (y + 0.5 - c) / S, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
      // soft blue glow around the rings and core
      let glow = 0.55 * Math.exp(-((r - 0.30) ** 2) / 0.0012) + 0.35 * Math.exp(-((r - 0.19) ** 2) / 0.0008) + 0.9 * Math.exp(-(r ** 2) / 0.004);
      glow += 0.18 * smooth(0.31, 0.19, r) * smooth(0.0, 0.12, r); // faint fill between rings
      // crisp rings
      const ring = (rad, w) => 1 - smooth(w / 2 - px, w / 2 + px, Math.abs(r - rad));
      const outer = ring(0.30, 0.02), inner = ring(0.19, 0.013);
      // tick marks
      const step = Math.PI / 12, off = Math.abs(((a % step) + step) % step - step / 2) - step / 2;
      const long = Math.round(a / step) % 6 === 0;
      const tick = (1 - smooth(0.0035 - px, 0.0035 + px, Math.abs(off) * r)) * smooth(0.333 - px, 0.333 + px, r) * (1 - smooth((long ? 0.38 : 0.36) - px, (long ? 0.38 : 0.36) + px, r));
      const core = 1 - smooth(0.05 - px, 0.05 + px, r);
      let R = 1 + 40 * glow, G = 4 + 110 * glow, B = 10 + 255 * glow;
      const mix = (v, cr, cg, cb) => { R += (cr - R) * v; G += (cg - G) * v; B += (cb - B) * v };
      mix(inner, 90, 150, 255); mix(outer, 125, 185, 255); mix(tick * 0.9, 80, 140, 240); mix(core, 205, 228, 255);
      const i = y * (S * 3 + 1) + 1 + x * 3;
      raw[i] = Math.min(255, R); raw[i + 1] = Math.min(255, G); raw[i + 2] = Math.min(255, B);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const cache = new Map();
export async function GET(req) {
  const s = Math.min(1024, Math.max(16, Number(new URL(req.url).searchParams.get('s')) || 512));
  if (!cache.has(s)) cache.set(s, draw(s));
  return new Response(cache.get(s), { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=604800, immutable' } });
}
