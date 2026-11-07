// SAGA pictures from the first Atari 8-bit releases: line drawings with
// pattern fills (Adventureland, Pirate Adventure, Strange Odyssey).
//
// Nothing documents this format; it was worked out from the pictures and
// from the game's own drawing code (the "Graphics Package for ATARI S.A.G.A.").
//
// The picture disk (side B) holds an index in sector 6: three bytes giving the
// adventure number, then one 2-byte entry per room (0 = no picture). An entry
// points at a sector and a 3-byte slot within it. A picture is a list of
// 3-byte instructions (opcode, x, y) on a 160×96 screen, ending at the first
// opcode whose top three bits are zero:
//
//   100xxxxx x y   move to (x, y)
//   101xxxxx x y   draw a line to (x, y) in the current line colour
//   011ccccc a b   line colour c; fill colours a and b
//   111ttttt x y   fill the area at (x, y), mixing a and b in style t
//   110ttttt x y   fill from (x, y) up to the line colour, style t
//   001ttttt x y   clear the screen (style t, from a and b)
//   010xxxxx x y   pause (the dark picture's blinking eyes)
//
// The Atari shows two screens on alternate frames, each with its own four
// colours, so each colour number is a pair of pixel values and what the eye
// sees is the two frames blended.

import type { Bitmap } from './bdp.js';
import { ATARI_PALETTE } from './atari.js';

export const LINES_WIDTH = 160;
export const LINES_HEIGHT = 96;

/** The pixel values (screen 1, screen 2) behind each of the 16 colour numbers. */
const COLOURS: readonly (readonly [number, number])[] = [
  [3, 3], [3, 2], [3, 1], [3, 0], [2, 2], [2, 1], [2, 0], [1, 1],
  [1, 0], [0, 0], [2, 3], [1, 3], [0, 3], [1, 2], [0, 2], [0, 1],
];

/** The Atari colours of pixel values 0–3 on each screen, the same in every game. */
const SCREEN_1 = [0x00, 0x42, 0xb4, 0xe4];
const SCREEN_2 = [0x00, 0x32, 0x84, 0xd4];

/**
 * The 16 colours a pixel can show: index = screen-1 value | screen-2 value << 2,
 * each the blend of the two frames.
 */
export const LINES_PALETTE: readonly (readonly [number, number, number])[] = Array.from({ length: 16 }, (_, i) => {
  const one = ATARI_PALETTE[SCREEN_1[i & 3]!]!;
  const two = ATARI_PALETTE[SCREEN_2[i >> 2]!]!;
  return [0, 1, 2].map((k) => Math.round((one[k]! + two[k]!) / 2)) as unknown as readonly [number, number, number];
});

export type Instruction = readonly [number, number, number];

/** The picture disk's adventure number, if this looks like one. */
export function linesAdventure(sectors: Uint8Array): number | undefined {
  const index = 5 * 128;
  if (sectors.length < 720 * 128) return undefined;
  const n = sectors[index]!;
  return n && sectors[index + 1] === n && sectors[index + 2] === n ? n : undefined;
}

/** Room `room`'s picture, or undefined if the index has none. */
export function linesPicture(sectors: Uint8Array, room: number): Instruction[] | undefined {
  const entry = 5 * 128 + 3 + 2 * room;
  if (entry + 1 >= 6 * 128) return undefined;
  const b0 = sectors[entry]!;
  const b1 = sectors[entry + 1]!;
  if (!(b0 | b1)) return undefined;
  let sector = b1 | ((b0 & 3) << 8);
  let offset = (b0 >> 2) * 3;
  const next = () => {
    if (offset === 128) {
      offset = 0;
      sector++;
      if (sector === 360) sector++; // the game's reader skips the disk's bookkeeping sector
    }
    const at = (sector - 1) * 128 + offset++;
    if (at >= sectors.length) throw new RangeError('picture runs off the disk');
    return sectors[at]!;
  };
  const instructions: Instruction[] = [];
  try {
    for (let n = 0; n < 8000; n++) {
      const op = next();
      if ((op & 0xe0) === 0) return instructions;
      instructions.push([op, next(), next()]);
    }
  } catch {
    // fall through: not a picture
  }
  return undefined;
}

type Pattern = readonly [readonly number[], readonly number[]]; // 4 pixels on screen 1, 4 on screen 2

/** Draw a picture as indexed pixels (screen-1 value | screen-2 value << 2), widened to 320 pixels. */
export function drawLines(instructions: readonly Instruction[]): Bitmap {
  const W = LINES_WIDTH;
  const H = LINES_HEIGHT;
  const one = new Uint8Array(W * H);
  const two = new Uint8Array(W * H);
  let line = 10;
  let a = 0;
  let b = 0;
  let x = 0;
  let y = 0;

  const value = (px: number, py: number) => one[py * W + px]! | (two[py * W + px]! << 2);
  const put = (px: number, py: number, p: Pattern) => {
    one[py * W + px] = p[0][px & 3]!;
    two[py * W + px] = p[1][px & 3]!;
  };
  const solid = (c: number): Pattern => {
    const [s2, s1] = COLOURS[c]!;
    return [[s1, s1, s1, s1], [s2, s2, s2, s2]];
  };
  /** The two patterns a fill alternates between, row by row, for style t. */
  const patterns = (style: number): [Pattern, Pattern] => {
    const [a2, a1] = COLOURS[a]!;
    const [b2, b1] = COLOURS[b]!;
    const plain = solid(a);
    const mixed: Pattern = [[b1, a1, b1, a1], [b2, a2, b2, a2]];
    switch (style) {
      case 1:
        return [[[a1, b1, a1, b1], [a2, b2, a2, b2]], mixed];
      case 2:
        return [plain, solid(b)];
      case 3:
        return [mixed, mixed];
      case 4:
        return [plain, mixed];
      default:
        return [plain, plain];
    }
  };
  // The game sorts the two patterns so the same one always lands on even rows.
  const byteOf = (px: readonly number[]) => (px[0]! << 6) | (px[1]! << 4) | (px[2]! << 2) | px[3]!;
  const order = (p: Pattern) => byteOf(p[0]) * 256 + byteOf(p[1]);

  const fill = (sx: number, sy: number, style: number, boundary?: number) => {
    if (sx < 0 || sx >= W || sy < 0 || sy >= H) return;
    const seed = value(sx, sy);
    const inside = boundary === undefined ? (v: number) => v === seed : (v: number) => v !== boundary;
    if (!inside(seed)) return;
    const [p1, p2] = patterns(style);
    const [even, odd] = order(p1) <= order(p2) ? [p1, p2] : [p2, p1];
    // Climb to the top of the area in the seed's column, then fill row by row downward.
    let row = sy;
    while (row > 0 && inside(value(sx, row - 1))) row--;
    let px = sx;
    for (let guard = 0; guard < H; guard++) {
      const p = row % 2 ? odd : even;
      while (px > 0 && inside(value(px - 1, row))) px--;
      const start = px;
      while (px < W && inside(value(px, row))) {
        put(px, row, p);
        px++;
      }
      const end = px;
      if (row === H - 1) return;
      row++;
      px = start;
      while (px < end && !inside(value(px, row))) px++;
      if (px >= end) return;
    }
  };

  const drawTo = (tx: number, ty: number) => {
    const [s2, s1] = COLOURS[line]!;
    let x0 = x;
    let y0 = y;
    const dx = Math.abs(tx - x0);
    const dy = -Math.abs(ty - y0);
    const sx = x0 < tx ? 1 : -1;
    const sy = y0 < ty ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      if (x0 >= 0 && x0 < W && y0 >= 0 && y0 < H) {
        one[y0 * W + x0] = s1;
        two[y0 * W + x0] = s2;
      }
      if (x0 === tx && y0 === ty) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  };

  for (const [op, p, q] of instructions) {
    const low = op & 0x1f;
    switch (op >> 5) {
      case 4:
        [x, y] = [p, q];
        break;
      case 5:
        drawTo(p, q);
        [x, y] = [p, q];
        break;
      case 3:
        line = low & 15;
        a = p & 15;
        b = q & 15;
        break;
      case 7:
        fill(p, q, low);
        break;
      case 6: {
        const [s2, s1] = COLOURS[line]!;
        fill(p, q, low, s1 | (s2 << 2));
        break;
      }
      case 1:
        if (low === 0) {
          const plain = patterns(0)[0];
          for (let py = 0; py < H; py++) for (let px2 = 0; px2 < W; px2++) put(px2, py, plain);
        }
        break;
      case 2:
        // A pause marks the end of the first frame of an animation; show that frame.
        return widen(one, two);
    }
  }
  return widen(one, two);
}

/** Atari pixels are twice as wide as they are tall: double each one. */
function widen(one: Uint8Array, two: Uint8Array): Bitmap {
  const W = LINES_WIDTH;
  const pixels = new Uint8Array(W * 2 * LINES_HEIGHT);
  for (let i = 0; i < W * LINES_HEIGHT; i++) {
    const v = one[i]! | (two[i]! << 2);
    pixels[2 * i] = v;
    pixels[2 * i + 1] = v;
  }
  return { width: W * 2, height: LINES_HEIGHT, pixels };
}
