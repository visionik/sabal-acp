// The ACP side: one Controller per session, text in, message chunks out.
import { randomUUID } from 'node:crypto';
import * as acp from '@agentclientprotocol/sdk';
import { Controller, SLASH_COMMANDS, type Io } from './controller.js';
import type { Catalog } from './catalog.js';
import type { SaveStore } from './saves.js';
import type { Pictures } from './pictures/index.js';

export interface AgentOptions {
  catalog: Catalog;
  saves: SaveStore;
  waits: boolean;
  version: string;
  /** Room pictures; shown only to clients that say they can draw PNG images. */
  pictures?: Pictures;
}

interface Live {
  controller: Controller;
  /** Aborts the prompt that is running, if any. */
  turn?: AbortController;
  /** Serializes prompts so two never drive one game at once. */
  queue: Promise<unknown>;
}

export function createAgent(options: AgentOptions): acp.AgentApp {
  const sessions = new Map<string, Live>();
  const app = acp.agent({ name: 'sabal-acp' });
  // ACP has no standard way for a client to say it draws images in agent
  // messages, so pictures go only to clients that say so in Deft Console's
  // `clientCapabilities._meta["deft.co"].display.image`.
  let drawsImages = false;

  const send = (ctx: acp.AgentContext, sessionId: string, update: acp.SessionUpdate) =>
    ctx.notify(acp.methods.client.session.update, { sessionId, update });

  const say = (ctx: acp.AgentContext, sessionId: string, text: string) =>
    text ? send(ctx, sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } }) : undefined;

  app.onRequest(acp.methods.agent.initialize, ({ params }) => {
    drawsImages = clientDrawsPng(params.clientCapabilities?._meta);
    return {
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: {
      loadSession: false,
      promptCapabilities: { image: false, audio: false, embeddedContext: false },
    },
    agentInfo: { name: 'sabal-acp', title: 'SABAL', version: options.version },
    authMethods: [],
    };
  });

  app.onRequest(acp.methods.agent.authenticate, () => ({}));

  app.onRequest(acp.methods.agent.session.new, ({ client }) => {
    const sessionId = randomUUID();
    const controller = new Controller(options.catalog, options.saves, {
      waits: options.waits,
      pictures: drawsImages ? options.pictures : undefined,
    });
    sessions.set(sessionId, { controller, queue: Promise.resolve() });
    // Updates for a session must follow the response that creates it, so the
    // welcome screen goes out on the next tick, after the reply is written.
    setTimeout(() => {
      void (async () => {
        try {
          await send(client, sessionId, {
            sessionUpdate: 'available_commands_update',
            availableCommands: SLASH_COMMANDS.map((c) => ({ ...c })),
          });
          await send(client, sessionId, { sessionUpdate: 'session_info_update', title: 'SABAL' });
          await say(client, sessionId, controller.welcome());
        } catch {
          // The client went away or ignores early updates; the first prompt shows the welcome.
        }
      })();
    }, 0);
    return { sessionId };
  });

  app.onRequest(acp.methods.agent.session.prompt, async ({ params, client, signal }) => {
    const live = sessions.get(params.sessionId);
    if (!live) throw acp.RequestError.invalidParams({ sessionId: params.sessionId }, 'Unknown session');

    const text = params.prompt
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n');

    const run = async (): Promise<acp.PromptResponse> => {
      const turn = new AbortController();
      live.turn = turn;
      const cancelled = () => turn.signal.aborted || signal.aborted;
      // Everything a turn prints is ready at once, so it goes out as one chunk,
      // split only where the game pauses. (Clients also render a single chunk
      // more reliably than a burst of tiny ones.)
      let pending = '';
      const flush = async () => {
        const out = pending;
        pending = '';
        await say(client, params.sessionId, out);
      };
      const io: Io = {
        emit: (md) => void (pending += md),
        title: async (title) => {
          await flush();
          await send(client, params.sessionId, { sessionUpdate: 'session_info_update', title });
        },
        image: async (png, alt) => {
          await flush();
          await send(client, params.sessionId, {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'image', mimeType: 'image/png', data: png.toString('base64'), _meta: { alt } },
          });
        },
        wait: async (ms) => {
          await flush();
          if (!cancelled()) await sleep(ms, turn.signal, signal);
        },
      };
      try {
        await live.controller.handle(text, io);
        await flush();
      } finally {
        if (live.turn === turn) live.turn = undefined;
      }
      return { stopReason: cancelled() ? 'cancelled' : 'end_turn' };
    };

    const result = live.queue.then(run, run);
    live.queue = result.catch(() => undefined);
    return result;
  });

  app.onNotification(acp.methods.agent.session.cancel, ({ params }) => {
    sessions.get(params.sessionId)?.turn?.abort();
  });

  app.onRequest(acp.methods.agent.session.close, ({ params }) => {
    sessions.get(params.sessionId)?.turn?.abort();
    sessions.delete(params.sessionId);
    return {};
  });

  return app;
}

function sleep(ms: number, ...signals: AbortSignal[]): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      for (const s of signals) s.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    for (const s of signals) s.addEventListener('abort', done, { once: true });
  });
}

function clientDrawsPng(meta: unknown): boolean {
  const image = (meta as { 'deft.co'?: { display?: { image?: { mimeTypes?: unknown } } } } | null | undefined)?.['deft.co']
    ?.display?.image;
  return Array.isArray(image?.mimeTypes) && image.mimeTypes.includes('image/png');
}
