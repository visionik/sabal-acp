import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { loadSpectrum } from '../dist/pictures/tape.js';
import { draw, plausible } from '../dist/pictures/bdp.js';
import { encodePng } from '../dist/pictures/png.js';
import { Pictures } from '../dist/pictures/index.js';
import { fakeMemory, tap, CHARSET, COUNT } from './pictures.mjs';
import { startAgent } from './helpers.mjs';

const layout = { charset: CHARSET, count: COUNT, version: 1 };
const mem = () => loadSpectrum('fake.tap', tap(CHARSET, fakeMemory()));

function picturesDir() {
  const dir = mkdtempSync(join(tmpdir(), 'sabal-acp-pictures-'));
  writeFileSync(join(dir, 'fake.tap'), tap(CHARSET, fakeMemory()));
  writeFileSync(join(dir, 'notes.txt'), 'not a tape');
  return dir;
}

test('a .tap CODE block loads at its address; other files are ignored', () => {
  const m = mem();
  assert.equal(m[CHARSET + 8], 0xff);
  assert.equal(loadSpectrum('fake.txt', new Uint8Array(10)), undefined);
  assert.equal(loadSpectrum('fake.sna', new Uint8Array(10)), undefined);
});

test('a 48K .sna snapshot maps RAM from 0x4000', () => {
  const sna = new Uint8Array(27 + 0xc000);
  sna[27 + (CHARSET - 0x4000)] = 0x42;
  assert.equal(loadSpectrum('x.sna', sna)[CHARSET], 0x42);
});

test('BDP cells draw characters in their pen and paper colours, mirrored on request', () => {
  const m = mem();
  assert.ok(plausible(m, layout));
  assert.ok(!plausible(new Uint8Array(0x10000), layout));
  const bmp = draw(m, layout, 0);
  assert.equal(bmp.width, 256);
  assert.equal(bmp.height, 96);
  const at = (x, y) => bmp.pixels[y * 256 + x];
  // Cell 0: solid, bright red pen (version 1 pictures are always bright).
  assert.equal(at(0, 0), 10);
  assert.equal(at(7, 7), 10);
  // Cell 1: character 2 mirrored, so its one pixel moves from left to right; the rest is black paper.
  assert.equal(at(8, 0), 8);
  assert.equal(at(15, 0), 14);
  // Outside the picture: untouched.
  assert.equal(at(16, 0), 0);
});

test('PNGs are indexed colour, scaled by whole pixels', () => {
  const png = encodePng(draw(mem(), layout, 0), undefined, 2);
  assert.deepEqual([...png.subarray(1, 4)].map((c) => String.fromCharCode(c)).join(''), 'PNG');
  assert.equal(png.readUInt32BE(16), 512);
  assert.equal(png.readUInt32BE(20), 192);
  assert.equal(png[25], 3);
  const idat = png.indexOf('IDAT');
  const raw = inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4)));
  assert.deepEqual([...raw.subarray(0, 3)], [0, 10, 10]);
});

test('Pictures finds the game, maps rooms to pictures, and shows nothing in the dark', () => {
  const pictures = new Pictures(picturesDir());
  assert.deepEqual(pictures.list(), [{ game: 'adv01', platform: 'ZX Spectrum', file: 'fake.tap' }]);
  assert.equal(pictures.forRoom('adv01', { room: 11, dark: false, itemLocations: [] }).key, 'adv01:10');
  assert.equal(pictures.forRoom('adv01', { room: 14, dark: false, itemLocations: [] }).key, 'adv01:11');
  assert.equal(pictures.forRoom('adv01', { room: 33, dark: false, itemLocations: [] }).key, 'adv01:27');
  assert.equal(pictures.forRoom('adv01', { room: 11, dark: true, itemLocations: [] }), undefined);
  assert.equal(pictures.forRoom('adv02', { room: 1, dark: false, itemLocations: [] }), undefined);
  assert.equal(new Pictures('/nonexistent').list().length, 0);
});

const DEFT_IMAGES = { _meta: { 'deft.co': { display: { image: { mimeTypes: ['image/png', 'image/gif'] } } } } };

test('clients that draw PNGs get a room picture before the room text, once per picture', async () => {
  const a = await startAgent(['--pictures-dir', picturesDir()], { clientCapabilities: DEFT_IMAGES });
  try {
    await a.waitFor(() => a.text().includes('## Games'));
    await a.prompt('1');
    assert.equal(a.images().length, 1);
    assert.equal(a.images()[0].mimeType, 'image/png');
    assert.match(a.images()[0]._meta.alt, /forest/);
    const chunks = a.updates.filter((u) => u.sessionUpdate === 'agent_message_chunk');
    const imageAt = chunks.findIndex((u) => u.content.type === 'image');
    assert.match(chunks[imageAt + 1].content.text, /^```text\nI'm in a forest/);
    await a.prompt('LOOK');
    assert.equal(a.images().length, 1, 'the same picture is not sent again');
    await a.prompt('CLIMB TREE');
    assert.equal(a.images().length, 2);
  } finally {
    a.close();
  }
});

test('clients that do not say they draw images get no pictures', async () => {
  const a = await startAgent(['--pictures-dir', picturesDir()]);
  try {
    await a.waitFor(() => a.text().includes('## Games'));
    await a.prompt('1');
    assert.equal(a.images().length, 0);
  } finally {
    a.close();
  }
});

test('--no-pictures turns them off', async () => {
  const a = await startAgent(['--pictures-dir', picturesDir(), '--no-pictures'], { clientCapabilities: DEFT_IMAGES });
  try {
    await a.waitFor(() => a.text().includes('## Games'));
    await a.prompt('1');
    assert.equal(a.images().length, 0);
  } finally {
    a.close();
  }
});
