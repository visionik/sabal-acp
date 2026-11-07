import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { linesAdventure, linesPicture, drawLines, LINES_PALETTE } from '../dist/pictures/atari-lines.js';
import { Pictures } from '../dist/pictures/index.js';

/** A made-up line-drawing picture disk for adventure `n`, as raw sectors. */
function fakeSectors(n, pictures) {
  const sectors = new Uint8Array(720 * 128);
  sectors.set([n, n, n], 5 * 128);
  let sector = 12;
  pictures.forEach((ops, room) => {
    if (!ops) return;
    sectors.set([0, sector], 5 * 128 + 3 + 2 * room); // slot 0 of the sector
    sectors.set([...ops.flat(), 0], (sector - 1) * 128);
    sector += 2;
  });
  return sectors;
}

// Clear to colour 9 (black), draw a line in colour 7, fill a box in style 2 (rows of colour 4 and 7).
const BOX = [
  [0x69, 9, 0], [0x20, 0, 0],
  [0x67, 0, 0], [0x80, 10, 10], [0xa0, 20, 10], [0xa0, 20, 20], [0xa0, 10, 20], [0xa0, 10, 10],
  [0x67, 4, 7], [0xe2, 15, 15],
];

test('the index gives each room a picture, read up to its end marker', () => {
  const sectors = fakeSectors(2, [BOX, null, BOX]);
  assert.equal(linesAdventure(sectors), 2);
  assert.equal(linesAdventure(new Uint8Array(720 * 128)), undefined);
  assert.deepEqual(linesPicture(sectors, 0), BOX);
  assert.equal(linesPicture(sectors, 1), undefined, 'a zero entry: no picture');
  assert.deepEqual(linesPicture(sectors, 2), BOX);
});

test('lines, clears and pattern fills land where the instructions say', () => {
  const bmp = drawLines(BOX);
  assert.equal(bmp.width, 320, 'pixels are doubled across');
  assert.equal(bmp.height, 96);
  const at = (x, y) => bmp.pixels[y * 320 + 2 * x];
  const colour = (c) => [[3,3],[3,2],[3,1],[3,0],[2,2],[2,1],[2,0],[1,1],[1,0],[0,0],[2,3],[1,3],[0,3],[1,2],[0,2],[0,1]][c];
  const value = (c) => { const [s2, s1] = colour(c); return s1 | (s2 << 2); };
  assert.equal(at(0, 0), value(9), 'cleared to black');
  assert.equal(at(15, 10), value(7), 'the box outline');
  const rows = new Set([at(15, 14), at(15, 15)]);
  assert.deepEqual(rows, new Set([value(4), value(7)]), 'the fill alternates its two colours by row');
  assert.equal(at(25, 15), value(9), 'nothing outside the box is filled');
  assert.equal(LINES_PALETTE.length, 16);
});

test('a pause ends the picture at its first frame', () => {
  const bmp = drawLines([[0x69, 9, 0], [0x20, 0, 0], [0x67, 0, 0], [0x80, 0, 0], [0xa0, 5, 0], [0x42, 0, 0], [0x69, 9, 0], [0x20, 0, 0]]);
  assert.notEqual(bmp.pixels[2 * 2], bmp.pixels[2 * 50], 'the line drawn before the pause is still there');
});

test('a picture disk is recognised by its adventure number', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sabal-acp-lines-'));
  const atr = new Uint8Array(16 + 720 * 128);
  atr.set([0x96, 0x02, 0, 0, 128, 0]);
  atr.set(fakeSectors(6, [BOX, BOX]), 16);
  writeFileSync(join(dir, 'odyssey.atr'), atr);
  const pictures = new Pictures(dir);
  assert.deepEqual(pictures.list(), [{ game: 'adv06', platform: 'Atari 8-bit', file: 'odyssey.atr' }]);
  assert.equal(pictures.forRoom('adv06', { room: 1, dark: false, itemLocations: [] }).key, 'adv06:1');
  assert.equal(pictures.forRoom('adv06', { room: 5, dark: true, itemLocations: [] }).key, 'adv06:0');
  assert.equal(pictures.forRoom('adv06', { room: 2, dark: false, itemLocations: [] }), undefined);
});
