// SAGA "block drawn pictures" (BDP), as used by the ZX Spectrum and C64
// releases from Adventure International (UK).
//
// A picture is a grid of 8x8 character cells. Each cell is a character from a
// 256-entry set, optionally rotated, mirrored and combined (OR/AND/XOR) with
// others; a second stream gives each cell a pen and paper colour.
//
// This follows the BDP format notes on the Adventure International Memorial
// site (http://aimemorial.if-legends.org/gfxbdp.html) and David Lodge's
// sagadraw.c (https://github.com/tautology0/textadventuregraphics, MIT; see
// NOTICE), which credits Paul David Doherty for help with the format.

import type { Memory } from './tape.js';

export interface BdpLayout {
  /** Memory address of the 256 x 8-byte character set; the offset table follows 0x800 later. */
  readonly charset: number;
  /** How many pictures the offset table holds. */
  readonly count: number;
  /**
   * Format version: 1 uses only the bright colours; 2 adds the normal ones;
   * 3 stores table entries relative to the table and columns without an offset.
   */
  readonly version: 1 | 2 | 3;
}

/** An indexed-colour picture: 16 Spectrum colours, 0–7 normal and 8–15 bright. */
export interface Bitmap {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

export const WIDTH = 256;
export const HEIGHT = 96;
const COLS = WIDTH / 8;
const ROWS = HEIGHT / 8;

export interface PictureHeader {
  readonly address: number;
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
}

export function header(mem: Memory, layout: BdpLayout, n: number): PictureHeader {
  const table = layout.charset + 0x800;
  const entry = mem[table + 2 * n]! | (mem[table + 2 * n + 1]! << 8);
  const address = layout.version >= 3 ? (entry + table + 0x100) & 0xffff : entry;
  return {
    address,
    width: mem[address]!,
    height: mem[address + 1]!,
    // Before version 3, columns are stored 4 cells to the right of where they're drawn.
    x: mem[address + 2]! - (layout.version >= 3 ? 0 : 4),
    y: mem[address + 3]!,
  };
}

/** True if every picture header looks like a picture that fits on screen. */
export function plausible(mem: Memory, layout: BdpLayout): boolean {
  for (let n = 0; n < layout.count; n++) {
    const h = header(mem, layout, n);
    if (h.address < layout.charset + 0x800 + 2 * layout.count || h.address > 0xfffc) return false;
    if (h.width < 1 || h.height < 1 || h.x < 0 || h.x + h.width > COLS || h.y + h.height > ROWS) return false;
  }
  return true;
}

/**
 * Draw picture `n` onto `base` (or a fresh black screen). Cells outside the
 * picture keep what was there, so a small picture can overlay a room picture.
 */
export function draw(mem: Memory, layout: BdpLayout, n: number, base?: Bitmap): Bitmap {
  const h = header(mem, layout, n);
  const pixels = base ? new Uint8Array(base.pixels) : new Uint8Array(WIDTH * HEIGHT);
  let p = h.address + 4;
  const read = () => mem[p++ & 0xffff]!;
  const cells = h.width * h.height;
  const shapes = Array.from({ length: cells }, () => new Uint8Array(8));

  const put = (char: number, mode: number, cell: number) => {
    if (cell >= cells) return;
    const glyph = transform(mem, layout.charset, char & 0xff, mode);
    const target = shapes[cell]!;
    const op = mode & 0x0c;
    for (let r = 0; r < 8; r++) {
      if (op === 0x0c) target[r]! ^= glyph[r]!;
      else if (op === 0x08) target[r]! &= glyph[r]!;
      else if (op === 0x04) target[r]! |= glyph[r]!;
      else target[r] = glyph[r]!;
    }
  };

  let cell = 0;
  while (cell < cells) {
    const data = read();
    if (data < 0x80) {
      put(data, 0, cell++);
      continue;
    }
    const count = data & 0x02 ? read() + 1 : 1;
    let char = read() + (data & 0x01 ? 128 : 0);
    for (let k = 0; k < count; k++) put(char, data & 0x0c ? data & 0xf3 : data, cell + k);
    if (data & 0x0c) {
      // An overlay stream: more characters combined into the same cells.
      let mask = data & 0x0c;
      let previous = data;
      let next = read();
      for (;;) {
        if (next < 0x80) {
          const c = next + (previous & 0x01 ? 128 : 0);
          for (let k = 0; k < count; k++) put(c, previous & 0x0c, cell + k);
          break;
        }
        char = read() + (next & 0x01 ? 128 : 0);
        for (let k = 0; k < count; k++) put(char, (next & 0xf3) | mask, cell + k);
        if (!(next & 0x0c)) break;
        mask = next & 0x0c;
        previous = next;
        next = read();
      }
    }
    cell += count;
  }

  // Colours: one attribute per cell, run-length encoded.
  const pen = new Uint8Array(cells);
  const paper = new Uint8Array(cells);
  for (let c = 0; c < cells; ) {
    const data = read();
    const [count, colour] = data & 0x80 ? [(data & 0x7f) + 1, read()] : [1, data];
    for (let k = 0; k < count && c < cells; k++, c++) {
      const bright = colour & 0x08 || layout.version === 1 ? 8 : 0;
      paper[c] = (colour & 0x07) + bright;
      pen[c] = ((colour & 0x70) >> 4) + bright;
    }
  }

  for (let c = 0; c < cells; c++) {
    const cx = h.x + (c % h.width);
    const cy = h.y + Math.floor(c / h.width);
    const shape = shapes[c]!;
    for (let r = 0; r < 8; r++) {
      const row = (cy * 8 + r) * WIDTH + cx * 8;
      for (let b = 0; b < 8; b++) pixels[row + b] = shape[r]! & (1 << b) ? pen[c]! : paper[c]!;
    }
  }
  return { width: WIDTH, height: HEIGHT, pixels };
}

/** A character, rotated and mirrored as `mode` says; bit 0 of each row is its leftmost pixel. */
function transform(mem: Memory, charset: number, char: number, mode: number): Uint8Array {
  let g: Uint8Array = Uint8Array.from(mem.subarray(charset + char * 8, charset + char * 8 + 8));
  const turn = mode & 0x30;
  if (turn === 0x10) g = rotate(g, (i, j) => [7 - i, j], (i, j) => [j, i]);
  else if (turn === 0x20) g = rotate(g, (i, j) => [7 - i, 7 - j], (i, j) => [i, j]);
  else if (turn === 0x30) g = rotate(g, (i, j) => [i, 7 - j], (i, j) => [j, i]);
  if (mode & 0x40) g = mirror(g);
  return mirror(g); // stored with bit 7 leftmost; we draw bit 0 leftmost
}

// Move set bits: source bit (row s, bit b) lands at target (row t, bit u).
function rotate(
  g: Uint8Array,
  to: (i: number, j: number) => [number, number],
  from: (i: number, j: number) => [number, number],
): Uint8Array {
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const [row, bit] = from(i, j);
      if (g[row]! & (1 << bit)) {
        const [tr, tb] = to(i, j);
        out[tr]! |= 1 << tb;
      }
    }
  }
  return out;
}

function mirror(g: Uint8Array): Uint8Array {
  return g.map((row) => {
    let out = 0;
    for (let b = 0; b < 8; b++) if (row & (1 << b)) out |= 1 << (7 - b);
    return out;
  });
}
