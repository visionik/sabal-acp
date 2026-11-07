import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readD64 } from '../dist/pictures/d64.js';
import { Pictures } from '../dist/pictures/index.js';

const sectorsIn = (t) => (t <= 17 ? 21 : t <= 24 ? 19 : t <= 30 ? 18 : 17);
const offset = (t, s) => { let n = 0; for (let i = 1; i < t; i++) n += sectorsIn(i); return (n + s) * 256; };

/** A made-up .d64: one-sector PRG files (load address 0x5000) listed in track 18's directory. */
function fakeD64(files) {
  const disk = new Uint8Array(174848);
  files.forEach(([name, body], i) => {
    const at = offset(1, i);
    disk[at] = 0; // last sector of the file
    disk[at + 1] = 1 + 2 + body.length; // index of its last byte
    disk.set([0x00, 0x50, ...body], at + 2);
    const entry = offset(18, 1) + i * 32;
    disk[entry + 2] = 0x82; // PRG, closed
    disk[entry + 3] = 1;
    disk[entry + 4] = i;
    disk.set([...name.padEnd(16, '\xa0')].map((c) => c.charCodeAt(0)), entry + 5);
  });
  return disk;
}

// An Atari-format picture: 2 columns wide, 2 rows high, one repeat run.
const PICTURE = [16, 0, 3, 0, 1, 1, 0x0e, 0x46, 0x84, 0x00, 0x80, 0b01101100, 0b00000011, 0, 0, 0];

test('.d64 files are read by name, without their load address', () => {
  const files = readD64(fakeD64([['R001', PICTURE], ['DATA', [...Buffer.from('chem lab')]]]));
  assert.deepEqual([...files.keys()], ['R001', 'DATA']);
  assert.deepEqual([...files.get('R001')], PICTURE);
  assert.equal(readD64(new Uint8Array(1000)), undefined);
});

test('C64 pictures are named by room, and rooms described alike share one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sabal-acp-c64-'));
  writeFileSync(join(dir, 'spider.d64'), fakeD64([['R002', PICTURE], ['R006', PICTURE], ['DATA', [...Buffer.from('chem lab')]]]));
  const texts = ['', 'office', 'hall', 'lab', 'office', 'waiting room', 'shaft', 'duct', 'maze', 'shaft'];
  const pictures = new Pictures(dir, (game) => (game === 'quest2' ? texts : undefined));
  assert.deepEqual(pictures.list(), [{ game: 'quest2', platform: 'Commodore 64', file: 'spider.d64' }]);
  const room = (r) => pictures.forRoom('quest2', { room: r, dark: false, itemLocations: [] })?.key;
  assert.equal(room(2), 'quest2:2');
  assert.equal(room(9), 'quest2:6', 'room 9 is another shaft');
  assert.equal(room(3), undefined);
  assert.equal(pictures.forRoom('quest2', { room: 2, dark: true, itemLocations: [] }), undefined, 'no R000, no dark picture');
});
