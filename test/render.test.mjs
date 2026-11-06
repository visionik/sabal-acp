import { test } from 'node:test';
import assert from 'node:assert/strict';
import { narration, roomBlock } from '../dist/render.js';

test('narration escapes Markdown and keeps line breaks', () => {
  assert.equal(narration('Find *TREASURES*\n# not a heading\n'), 'Find \\*TREASURES\\*\\\n\\# not a heading\n\n');
  assert.equal(narration('1. one\n- two'), '1\\. one\\\n\\- two\n\n');
  assert.equal(narration('a\n\n\nb'), 'a\n\nb\n\n');
  assert.equal(narration('\n\n'), '');
});

test('narration keeps leading spaces visible', () => {
  assert.equal(narration('  by Scott'), '  by Scott\n\n');
});

test('room text goes in a fence', () => {
  assert.equal(roomBlock("I'm in a forest\n"), "```text\nI'm in a forest\n```\n\n");
});
