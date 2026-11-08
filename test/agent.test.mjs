import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { startAgent } from './helpers.mjs';

async function withAgent(fn) {
  const a = await startAgent();
  try {
    await a.waitFor(() => a.text().includes('## Games'));
    await fn(a);
  } finally {
    a.close();
  }
}

test('initialize advertises an agent with text prompts and no auth', () =>
  withAgent(async (a) => {
    assert.equal(a.init.agentInfo.name, 'sabal-acp');
    assert.deepEqual(a.init.authMethods, []);
    assert.equal(a.init.agentCapabilities.loadSession, false);
  }));

test('a new session gets the welcome screen, menu, commands and title', () =>
  withAgent(async (a) => {
    const t = a.text();
    assert.match(t, /Welcome to SABAL \(Scott Adams Brass-lamp Adventure Library\) ACP \(Agent-Client Protocol "Agent"\)/);
    assert.match(t, /The games are © Scott Adams, 1978–1985, and shared by him as shareware/);
    assert.match(t, /not actually an LLM/);
    assert.match(t, /1\. Adventureland/);
    assert.match(t, /18\. Mini-Adventure Sampler/);
    const cmds = a.updates.find((u) => u.sessionUpdate === 'available_commands_update');
    assert.deepEqual(cmds.availableCommands.map((c) => c.name), ['menu', 'save', 'load', 'saves', 'restart', 'scale', 'style', 'help']);
    assert.ok(a.updates.some((u) => u.sessionUpdate === 'session_info_update' && u.title === 'SABAL'));
  }));

test('games start by number or by name, and set the title', () =>
  withAgent(async (a) => {
    let r = await a.prompt('pirate');
    assert.equal(r.stopReason, 'end_turn');
    assert.match(r.text, /Flat in london/);
    assert.ok(a.updates.some((u) => u.title === 'SABAL · Pirate Adventure'));
    await a.prompt('/menu');
    r = await a.prompt('1');
    assert.match(r.text, /ADVENTURELAND/);
  }));

test('unknown menu input and ambiguous names are explained', () =>
  withAgent(async (a) => {
    let r = await a.prompt('zork');
    assert.match(r.text, /don't know a game called "zork"/);
    r = await a.prompt('savage');
    assert.match(r.text, /matches more than one game/);
    assert.match(r.text, /10\. Savage Island, Part 1/);
  }));

test("the game's own SAVE GAME asks for a name and stores the save", () =>
  withAgent(async (a) => {
    await a.prompt('2');
    await a.prompt('get rum');
    let r = await a.prompt('save game');
    assert.match(r.text, /Name this save/);
    r = await a.prompt('bad/name');
    assert.match(r.text, /Save names can use/);
    r = await a.prompt('rum run');
    assert.match(r.text, /Saved as \*\*rum run\*\*/);
    assert.match(r.text, /Saved\./);
    const sav = join(a.savesDir, 'adv02', 'rum run.sav');
    assert.ok(existsSync(sav));
    const meta = JSON.parse(readFileSync(join(a.savesDir, 'adv02', 'rum run.json'), 'utf8'));
    assert.equal(meta.game, 'adv02');
    assert.equal(meta.turns, 2);
  }));

test('an empty save name picks an automatic one; /cancel skips the save', () =>
  withAgent(async (a) => {
    await a.prompt('1');
    await a.prompt('save game');
    let r = await a.prompt('');
    assert.match(r.text, /Saved as \*\*save-\d{8}-\d{6}\*\*/);
    await a.prompt('save game');
    r = await a.prompt('/cancel');
    assert.match(r.text, /Save cancelled/);
    assert.match(r.text, /Unable to create save file/);
    assert.equal(readdirSync(join(a.savesDir, 'adv01')).filter((f) => f.endsWith('.sav')).length, 1);
  }));

test('saves load by name or number and keep the game state', () =>
  withAgent(async (a) => {
    await a.prompt('2');
    await a.prompt('get rum');
    await a.prompt('/save keep');
    await a.prompt('/menu');
    let r = await a.prompt('saves');
    assert.match(r.text, /1\. \*\*keep\*\* · Pirate Adventure/);
    r = await a.prompt('load 1');
    assert.match(r.text, /Restored "keep" — Pirate Adventure/);
    r = await a.prompt('inventory');
    assert.match(r.text, /Bottle of rum/);
    r = await a.prompt('/load nope');
    assert.match(r.text, /No save called "nope"/);
  }));

test('a name shared by two games needs game/name', () =>
  withAgent(async (a) => {
    await a.prompt('1');
    await a.prompt('/save same');
    await a.prompt('/menu');
    await a.prompt('2');
    await a.prompt('/save same');
    await a.prompt('/menu');
    let r = await a.prompt('load same');
    assert.match(r.text, /More than one game/);
    r = await a.prompt('load adv01/same');
    assert.match(r.text, /Restored "same" — Adventureland/);
  }));

test('leaving, restarting or loading with unsaved progress asks first', () =>
  withAgent(async (a) => {
    await a.prompt('2');
    let r = await a.prompt('/menu');
    assert.match(r.text, /## Games/, 'nothing typed yet, so no confirm');
    await a.prompt('2');
    await a.prompt('get rum');
    r = await a.prompt('/restart');
    assert.match(r.text, /unsaved progress/);
    r = await a.prompt('inventory');
    assert.match(r.text, /Bottle of rum/, 'something else in between cancels the confirm');
    r = await a.prompt('/menu');
    assert.match(r.text, /unsaved progress/);
    r = await a.prompt('/menu');
    assert.match(r.text, /## Games/);
  }));

test('several commands can be sent at once, one per line', () =>
  withAgent(async (a) => {
    await a.prompt('2');
    const r = await a.prompt('get rum\ninventory');
    assert.match(r.text, /\*\*> GET RUM\*\*/);
    assert.match(r.text, /Bottle of rum/);
  }));

test('non-ASCII input is refused politely', () =>
  withAgent(async (a) => {
    await a.prompt('2');
    const r = await a.prompt('get “rum”');
    assert.match(r.text, /only understand plain ASCII/);
  }));

test('when the game ends, the menu comes back', () =>
  withAgent(async (a) => {
    await a.prompt('2');
    const r = await a.prompt('quit');
    assert.match(r.text, /Pirate Adventure is over/);
    assert.match(r.text, /## Games/);
    assert.ok(a.updates.filter((u) => u.title === 'SABAL').length >= 2);
  }));

test('slash commands work in the menu too, and unknown ones are listed', () =>
  withAgent(async (a) => {
    let r = await a.prompt('/help');
    assert.match(r.text, /## How to play/);
    r = await a.prompt('/frob');
    assert.match(r.text, /I don't know `\/frob`/);
    r = await a.prompt('/save');
    assert.match(r.text, /not in a game/);
  }));

test('a move shows the new room once, though the engine draws it twice', () =>
  withAgent(async (a) => {
    await a.prompt('1');
    const r = await a.prompt('CLIMB TREE');
    assert.equal(r.text.match(/I'm in a top of an oak/g).length, 1);
  }));
