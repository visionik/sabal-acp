import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDatabase } from 'sabal';
import { Pictures } from '../dist/pictures.js';
import { fakeMemory, tap, CHARSET } from './pictures.mjs';
import { startAgent } from './helpers.mjs';


function picturesDir() {
  const dir = mkdtempSync(join(tmpdir(), 'sabal-acp-pictures-'));
  writeFileSync(join(dir, 'fake.tap'), tap(CHARSET, fakeMemory()));
  writeFileSync(join(dir, 'notes.txt'), 'not a tape');
  return dir;
}

test('the Pictures wrapper turns SABAL pictures into PNGs, cached per scale', () => {
  const pictures = new Pictures(picturesDir(), (game) =>
    game === 'adv01' ? loadDatabase(readFileSync(new URL('../games/adv01.dat', import.meta.url), 'utf8')) : undefined,
  );
  assert.deepEqual(pictures.list().filter((g) => g.platform !== "SABAL"), [{ game: 'adv01', platform: 'ZX Spectrum', file: 'fake.tap' }]);
  const forest = pictures.forRoom('adv01', { room: 11, dark: false, itemLocations: [] });
  assert.equal(forest.key, 'adv01:10');
  assert.equal(forest.png.readUInt32BE(16), 1024, 'Spectrum pictures at 4x');
  assert.equal(pictures.forRoom('adv01', { room: 11, dark: false, itemLocations: [] }).png, forest.png, 'cached');
  assert.equal(pictures.forRoom('adv01', { room: 11, dark: false, itemLocations: [] }, 0.5).png.readUInt32BE(16), 512);
  assert.equal(pictures.forMessage('adv01', 'A glowing Genie appears').key, 'adv01:34');
  assert.equal(pictures.forRoom('adv02', { room: 1, dark: false, itemLocations: [] }), undefined);
  const builtIn = new Pictures('/nonexistent', () => undefined).list();
  assert.ok(builtIn.length > 0 && builtIn.every((g) => g.platform === 'SABAL'), 'only the built-in pictures');
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

const pngWidth = (image) => Buffer.from(image.data, 'base64').readUInt32BE(16);

test('/scale redraws the room bigger or smaller, and is remembered', async () => {
  const dir = picturesDir();
  const a = await startAgent(['--pictures-dir', dir], { clientCapabilities: DEFT_IMAGES });
  let settings;
  try {
    await a.waitFor(() => a.text().includes('## Games'));
    await a.prompt('1');
    assert.equal(pngWidth(a.images()[0]), 1024, 'Spectrum pictures are 256 pixels wide, drawn at 4x');
    assert.equal(a.images()[0]._meta.alt, "I'm in a forest", 'the caption is just the room');
    let r = await a.prompt('/scale 1.5');
    assert.match(r.text, /now drawn at 1\.5×/);
    assert.equal(a.images().length, 2, 'the room is shown again at the new size');
    assert.equal(pngWidth(a.images()[1]), 1536);
    r = await a.prompt('/scale');
    assert.match(r.text, /drawn at 1\.5×/);
    r = await a.prompt('/scale 50%');
    assert.equal(pngWidth(a.images().at(-1)), 512);
    r = await a.prompt('/scale 9');
    assert.match(r.text, /from 0\.25 to 4/);
    r = await a.prompt('/scale big');
    assert.match(r.text, /from 0\.25 to 4/);
    settings = join(a.savesDir, 'settings.json');
  } finally {
    a.close();
  }
  const b = await startAgent(['--pictures-dir', dir, '--settings', settings], { clientCapabilities: DEFT_IMAGES });
  try {
    await b.waitFor(() => b.text().includes('## Games'));
    await b.prompt('1');
    assert.equal(pngWidth(b.images()[0]), 512, 'the last scale is kept');
  } finally {
    b.close();
  }
});

test('style ng shows the next-gen painting when the game has one, and the original otherwise', () => {
  const db = (game) => loadDatabase(readFileSync(new URL(`../games/${game}.dat`, import.meta.url), 'utf8'));
  const pictures = new Pictures(picturesDir(), db);
  const desert = { room: 1, dark: false, itemLocations: [] };
  assert.ok(pictures.hasNg('adv08'), 'Pyramid of Doom has next-gen pictures');
  const ng = pictures.forRoom('adv08', desert, 1, 'ng');
  assert.match(ng.key, /^ng:adv08:1$/);
  assert.equal(ng.png.readUInt32BE(16), 1024, 'next-gen rooms are 1024 wide');
  assert.equal(pictures.forRoom('adv08', desert, 0.5, 'ng').png.readUInt32BE(16), 512);
  assert.match(pictures.forRoom('adv08', desert, 1, 'og').key, /^adv08:/, 'og is the original');
  // A game without next-gen pictures falls back to its original.
  assert.equal(pictures.forRoom('adv01', { room: 11, dark: false, itemLocations: [] }, 1, 'ng').key, 'adv01:10');
});

test('/style switches between the originals and the next-gen paintings, and is remembered', async () => {
  const dir = picturesDir();
  const a = await startAgent(['--pictures-dir', dir], { clientCapabilities: DEFT_IMAGES });
  let settings;
  try {
    await a.waitFor(() => a.text().includes('## Games'));
    await a.prompt('1');
    let r = await a.prompt('/style');
    assert.match(r.text, /Showing the original pictures/);
    r = await a.prompt('/style ng');
    assert.match(r.text, /Now showing the next-gen paintings/);
    assert.match(r.text, /doesn't have next-gen pictures yet/, 'Adventureland has none yet');
    assert.equal(pngWidth(a.images().at(-1)), 1024, 'the original is shown again');
    r = await a.prompt('/style sepia');
    assert.match(r.text, /Choose `\/style og`/);
    settings = join(a.savesDir, 'settings.json');
  } finally {
    a.close();
  }
  assert.equal(JSON.parse(readFileSync(settings, 'utf8')).style, 'ng');
});
