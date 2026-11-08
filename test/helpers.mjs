// Spawn sabal-acp and talk to it as a real ACP client over stdio.
import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as acp from '@agentclientprotocol/sdk';

const MAIN = new URL('../dist/main.js', import.meta.url).pathname;

export async function startAgent(extraArgs = [], { wait = false, clientCapabilities = {} } = {}) {
  const savesDir = mkdtempSync(join(tmpdir(), 'sabal-acp-test-'));
  const settings = join(savesDir, 'settings.json');
  const child = spawn(process.execPath, [MAIN, ...(wait ? [] : ['--no-wait']), '--saves-dir', savesDir, '--settings', settings, '--ng-cache', join(savesDir, 'ng'), ...extraArgs], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const updates = [];
  let waiters = [];
  const client = acp.client({ name: 'test' });
  client.onNotification(acp.methods.client.session.update, ({ params }) => {
    updates.push(params.update);
    for (const w of waiters) w();
    waiters = [];
  });
  const conn = client.connect(
    acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
  );
  const ctx = conn.agent;
  const init = await ctx.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities });
  const { sessionId } = await ctx.request(acp.methods.agent.session.new, { cwd: process.cwd(), mcpServers: [] });

  const text = () => updates.filter((u) => u.sessionUpdate === 'agent_message_chunk' && u.content.type === 'text').map((u) => u.content.text).join('');
  const images = () => updates.filter((u) => u.sessionUpdate === 'agent_message_chunk' && u.content.type === 'image').map((u) => u.content);
  const waitFor = async (pred, ms = 3000) => {
    const end = Date.now() + ms;
    while (!pred()) {
      if (Date.now() > end) throw new Error('timeout waiting; got:\n' + text());
      await new Promise((r) => { waiters.push(r); setTimeout(r, 50); });
    }
  };
  /** Send a prompt; return only the text this turn produced. */
  const prompt = async (p) => {
    const before = text().length;
    const res = await ctx.request(acp.methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: p }] });
    return { ...res, text: text().slice(before) };
  };
  const cancel = () => ctx.notify(acp.methods.agent.session.cancel, { sessionId });
  const close = () => { conn.close(); child.kill(); };
  return { init, sessionId, updates, text, images, waitFor, prompt, cancel, close, savesDir, ctx };
}
