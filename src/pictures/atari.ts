// SAGA pictures from the Atari 8-bit releases (the US art, run-length encoded).
//
// The pictures fill the second disk, one after another, read as raw sectors
// rather than as files. Each has a small header (size, position, four colours)
// and pairs of bytes that paint two rows of four double-width pixels, filling
// the picture column by column.
//
// This follows the Atari RLE notes on the Adventure International Memorial
// site (http://aimemorial.if-legends.org/gfxarle.html) and David Lodge's
// arledraw.c (https://github.com/tautology0/textadventuregraphics, MIT; see
// NOTICE).

import type { Bitmap } from './bdp.js';
import { crc32 } from './png.js';

export const ATARI_WIDTH = 280;
export const ATARI_HEIGHT = 160;

export interface AtariDisk {
  /** Byte offset (in the disk's sectors, after any skipped sector) of the first picture. */
  readonly start: number;
  /** How many pictures follow, one after another. */
  readonly count: number;
  /** A sector (1-based) in the middle of the pictures that holds disk bookkeeping, to cut out. */
  readonly skipSector?: number;
  /** CRC-32 of the first 256 bytes of the pictures, to recognise the disk. */
  readonly crc: number;
  /** The older encoding used by the first releases: every run is a repeat. */
  readonly old?: boolean;
}

/** The sectors of an .atr disk image with 128-byte sectors, or undefined. */
export function loadAtr(data: Uint8Array): Uint8Array | undefined {
  if (data.length < 16 + 128 || data[0] !== 0x96 || data[1] !== 0x02) return undefined;
  if ((data[4]! | (data[5]! << 8)) !== 128) return undefined;
  return data.subarray(16);
}

/** The disk's picture data with any bookkeeping sector removed, if this is the right disk. */
export function pictureData(sectors: Uint8Array, disk: AtariDisk): Uint8Array | undefined {
  let data = sectors;
  if (disk.skipSector) {
    const at = (disk.skipSector - 1) * 128;
    if (sectors.length < at + 128) return undefined;
    data = new Uint8Array(sectors.length - 128);
    data.set(sectors.subarray(0, at));
    data.set(sectors.subarray(at + 128), at);
  }
  if (data.length < disk.start + 256) return undefined;
  return crc32(data.subarray(disk.start, disk.start + 256)) === disk.crc ? data : undefined;
}

/** Where each picture starts. */
export function pictureOffsets(data: Uint8Array, disk: AtariDisk): number[] {
  const offsets: number[] = [];
  let p = disk.start;
  while (offsets.length < disk.count && p + 10 < data.length) {
    while (p < data.length && data[p] === 0) p++; // pictures may be padded with zeros
    const size = data[p]! | (data[p + 1]! << 8);
    if (!size) break;
    offsets.push(p);
    p += size;
  }
  return offsets;
}

/** Draw one picture: pixels index `colours`, which are Atari colour numbers. */
export function drawAtari(data: Uint8Array, offset: number, old = false): { bitmap: Bitmap; colours: number[] } {
  const end = offset + (data[offset]! | (data[offset + 1]! << 8));
  const left = data[offset + 2]! - 3; // in 8-pixel columns, after a 3-column margin
  const top = data[offset + 3]!;
  const right = data[offset + 4]!;
  const bottom = data[offset + 5]! - (old ? 2 : 0);
  // Colour registers 1-3, then the background.
  const colours = [data[offset + 9]!, data[offset + 6]!, data[offset + 7]!, data[offset + 8]!];
  const pixels = new Uint8Array(ATARI_WIDTH * ATARI_HEIGHT);
  let x = left * 8;
  let y = top;

  const row = (byte: number) => {
    for (let k = 0; k < 4; k++) {
      const colour = (byte >> (6 - 2 * k)) & 3;
      for (let dx = 0; dx < 2; dx++) {
        const px = x + 2 * k + dx;
        if (px >= 0 && px < ATARI_WIDTH && y >= 0 && y < ATARI_HEIGHT) pixels[y * ATARI_WIDTH + px] = colour;
      }
    }
    y++;
  };
  const pair = (a: number, b: number) => {
    if (x > (right + left) * 8) return;
    row(a);
    row(b);
    if (y > bottom) {
      x += 8;
      y = top;
    }
  };

  let p = offset + 10;
  while (p < end && p + 1 < data.length) {
    let count = data[p++]!;
    if (count & 0x80 || old) {
      count = old ? count - 1 : count & 0x7f;
      const a = data[p++]!;
      const b = data[p++]!;
      for (let i = 0; i <= count; i++) pair(a, b);
    } else {
      for (let i = 0; i <= count; i++) pair(data[p++]!, data[p++]!);
    }
  }
  return { bitmap: { width: ATARI_WIDTH, height: ATARI_HEIGHT, pixels }, colours };
}

/**
 * The Atari's 256 colours (16 hues × 16 luminances, odd ones repeating the even),
 * approximated from the NTSC signal: hue 0 is grey, hue 1 gold, round the colour
 * wheel to hue 15.
 */
export const ATARI_PALETTE: readonly (readonly [number, number, number])[] = Array.from({ length: 256 }, (_, c) => {
  const hue = c >> 4;
  const luma = 0.05 + (((c & 15) >> 1) / 7) * 0.9;
  const angle = (((hue - 1) * 24 - 15) * Math.PI) / 180;
  const i = hue ? 0.22 * Math.cos(angle) : 0;
  const q = hue ? 0.22 * Math.sin(angle) : 0;
  const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return [byte(luma + 0.956 * i + 0.621 * q), byte(luma - 0.272 * i - 0.647 * q), byte(luma - 1.106 * i + 1.703 * q)] as const;
});
