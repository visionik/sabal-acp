// A minimal PNG encoder for indexed-colour pictures, scaled up by whole pixels
// so the blocky originals stay sharp when a client resizes them.
import { deflateSync } from 'node:zlib';
import type { Bitmap } from './bdp.js';

/** The ZX Spectrum palette: eight normal colours, then eight bright ones. */
export const SPECTRUM_PALETTE: readonly (readonly [number, number, number])[] = [
  [0x00, 0x00, 0x00], [0x00, 0x00, 0xd7], [0xd7, 0x00, 0x00], [0xd7, 0x00, 0xd7],
  [0x00, 0xd7, 0x00], [0x00, 0xd7, 0xd7], [0xd7, 0xd7, 0x00], [0xd7, 0xd7, 0xd7],
  [0x00, 0x00, 0x00], [0x00, 0x00, 0xff], [0xff, 0x00, 0x00], [0xff, 0x00, 0xff],
  [0x00, 0xff, 0x00], [0x00, 0xff, 0xff], [0xff, 0xff, 0x00], [0xff, 0xff, 0xff],
];

export function encodePng(
  bitmap: Bitmap,
  palette: readonly (readonly [number, number, number])[] = SPECTRUM_PALETTE,
  scale = 4,
): Buffer {
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    const src = Math.floor(y / scale) * bitmap.width;
    const row = y * (width + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) raw[row + 1 + x] = bitmap.pixels[src + Math.floor(x / scale)]!;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 3, 0, 0, 0], 8); // 8-bit indexed colour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('PLTE', Buffer.from(palette.flat())),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

let table: Uint32Array | undefined;
function crc32(buf: Buffer): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
