import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startAgent } from './helpers.mjs';
import { source, row } from './fixture.mjs';

// WAIT prints message1, pauses (action 88), then prints message2.
function gamesDir() {
  const dir = mkdtempSync(join(tmpdir(), 'sabal-acp-games-'));
  writeFileSync(join(dir, 'tiny.dat'), source({ rows: [row(6, 0, [1, 88, 2])] }));
  return dir;
}

test('a pause streams the text before it, waits, then continues', async () => {
  const a = await startAgent(['--games-dir', gamesDir()], { wait: true });
  try {
    await a.waitFor(() => a.text().includes('1. tiny'));
    await a.prompt('1');
    const t0 = Date.now();
    const pending = a.prompt('wait');
    await a.waitFor(() => a.text().includes('message1'));
    assert.ok(!a.text().includes('message2'), 'second half arrives after the pause');
    const r = await pending;
    assert.ok(Date.now() - t0 >= 1900, 'waited about two seconds');
    assert.equal(r.stopReason, 'end_turn');
    assert.match(r.text, /message1[\s\S]*message2/);
  } finally {
    a.close();
  }
});

test('session/cancel cuts the pause short and reports cancelled', async () => {
  const a = await startAgent(['--games-dir', gamesDir()], { wait: true });
  try {
    await a.waitFor(() => a.text().includes('1. tiny'));
    await a.prompt('1');
    const t0 = Date.now();
    const pending = a.prompt('wait');
    await a.waitFor(() => a.text().includes('message1'));
    await a.cancel();
    const r = await pending;
    assert.ok(Date.now() - t0 < 1500, 'did not sit out the full pause');
    assert.equal(r.stopReason, 'cancelled');
    assert.match(r.text, /message2/, 'the game still finished its turn');
    const next = await a.prompt('look');
    assert.equal(next.stopReason, 'end_turn', 'the next turn is not cancelled');
  } finally {
    a.close();
  }
});
