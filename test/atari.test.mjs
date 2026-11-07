import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAtr, pictureData, pictureOffsets, drawAtari, ATARI_PALETTE } from '../dist/pictures/atari.js';
import { crc32 } from '../dist/pictures/png.js';

// A made-up 720-sector disk: two tiny pictures, the second after zero padding,
// and a bookkeeping sector (360) to cut out from between them.
function fakeDisk() {
  const sectors = new Uint8Array(720 * 128);
  // Picture: header (size, left+3, top, right, bottom, colours 1-3, background), then runs.
  // One repeat run (0x80 | 0): a pair of bytes painting columns 0-1 rows 0-1.
  const picture = [16, 0, 3, 0, 1, 1, 0x0e, 0x46, 0x84, 0x00, 0x80, 0b01101100, 0b00000011, 0, 0, 0];
  const start = 0x287;
  sectors.set(picture, start);
  sectors.fill(0xee, 359 * 128, 360 * 128); // sector 360: junk that must be removed
  sectors.set(picture, 360 * 128 + 40); // the second picture, just after it
  const atr = new Uint8Array(16 + sectors.length);
  atr.set([0x96, 0x02, 0, 0, 128, 0], 0);
  atr.set(sectors, 16);
  return { atr, start };
}

test('.atr images load as raw 128-byte sectors', () => {
  const { atr } = fakeDisk();
  assert.equal(loadAtr(atr).length, 720 * 128);
  assert.equal(loadAtr(atr.subarray(16)), undefined, 'needs the .atr header');
});

test('the right disk is recognised by its pictures, with the bookkeeping sector cut out', () => {
  const { atr, start } = fakeDisk();
  const sectors = loadAtr(atr);
  const cut = new Uint8Array([...sectors.subarray(0, 359 * 128), ...sectors.subarray(360 * 128)]);
  const crc = crc32(cut.subarray(start, start + 256));
  const disk = { start, count: 2, skipSector: 360, crc };
  const data = pictureData(sectors, disk);
  assert.ok(data);
  assert.equal(pictureData(sectors, { ...disk, crc: crc ^ 1 }), undefined);
  const offsets = pictureOffsets(data, disk);
  assert.equal(offsets.length, 2);
  assert.equal(offsets[0], start);
  assert.ok(!data.subarray(359 * 128, 360 * 128).includes(0xee), 'the junk sector is gone');
});

test('a picture paints double-width pixels down each column in its four colours', () => {
  const { atr, start } = fakeDisk();
  const { bitmap, colours } = drawAtari(loadAtr(atr), start);
  assert.deepEqual(colours, [0x00, 0x0e, 0x46, 0x84]);
  const at = (x, y) => bitmap.pixels[y * bitmap.width + x];
  // Row 0 is 0b01_10_11_00: colours 1, 2, 3, 0, each two pixels wide.
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((x) => at(x, 0)), [1, 1, 2, 2, 3, 3, 0, 0]);
  // Row 1 is 0b00_00_00_11.
  assert.equal(at(6, 1), 3);
  assert.equal(at(0, 1), 0);
  assert.equal(ATARI_PALETTE.length, 256);
  assert.deepEqual(ATARI_PALETTE[0], [13, 13, 13]);
});
