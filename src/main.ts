#!/usr/bin/env node
// sabal-acp: an ACP "agent" that is really a Scott Adams adventure player.
import { Readable, Writable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acp from '@agentclientprotocol/sdk';
import { Catalog } from './catalog.js';
import { SaveStore } from './saves.js';
import { createAgent } from './agent.js';
import { Settings } from './settings.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as { version: string };

const USAGE = `sabal-acp ${pkg.version}
Play Scott Adams adventure games from any ACP (Agent Client Protocol) client.
It speaks ACP on stdin/stdout; point your client at this command.

Options:
  --games-dir <dir>     Folder of .dat games (default: the bundled games; env SABAL_GAMES)
  --saves-dir <dir>     Where saves go (default: ~/.sabal-acp/saves; env SABAL_SAVES)
  --pictures-dir <dir>  Your own SAGA tape, snapshot or disk files, for pictures
                        (default: ~/.sabal-acp/pictures; env SABAL_PICTURES)
  --no-pictures         Never send pictures
  --settings <file>     Where preferences such as /scale are kept
                        (default: ~/.sabal-acp/settings.json; env SABAL_SETTINGS)
  --no-wait             Skip the games' 2-second pauses
  --version, --help
`;

function parseArgs(argv: string[]) {
  const opts = {
    games: process.env.SABAL_GAMES || join(here, '..', 'games'),
    saves: process.env.SABAL_SAVES || join(homedir(), '.sabal-acp', 'saves'),
    pictures: process.env.SABAL_PICTURES || join(homedir(), '.sabal-acp', 'pictures'),
    showPictures: true,
    settings: process.env.SABAL_SETTINGS || join(homedir(), '.sabal-acp', 'settings.json'),
    waits: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (!v) fail(`${a} needs a value`);
      return v!;
    };
    if (a === '--games-dir') opts.games = value();
    else if (a === '--saves-dir') opts.saves = value();
    else if (a === '--pictures-dir') opts.pictures = value();
    else if (a === '--no-pictures') opts.showPictures = false;
    else if (a === '--settings') opts.settings = value();
    else if (a === '--no-wait') opts.waits = false;
    else if (a === '--version') (process.stdout.write(`${pkg.version}\n`), process.exit(0));
    else if (a === '--help' || a === '-h') (process.stdout.write(USAGE), process.exit(0));
    else fail(`Unknown option: ${a}`);
  }
  return opts;
}

function fail(msg: string): never {
  process.stderr.write(`sabal-acp: ${msg}\n\n${USAGE}`);
  process.exit(2);
}

const opts = parseArgs(process.argv.slice(2));
let catalog: Catalog;
try {
  catalog = new Catalog(resolve(opts.games));
} catch (err) {
  fail((err as Error).message);
}
if (!catalog.games.length) fail(`No .dat games in ${opts.games}`);

// Pictures need SABAL's Node helpers. If an older SABAL is installed (a stale
// npx cache, say), play on without pictures rather than fail to start.
let Pictures: typeof import('./pictures.js').Pictures | undefined;
if (opts.showPictures) {
  try {
    ({ Pictures } = await import('./pictures.js'));
  } catch (err) {
    process.stderr.write(`sabal-acp: pictures are off (${(err as Error).message})\n`);
  }
}

const app = createAgent({
  catalog,
  saves: new SaveStore(resolve(opts.saves)),
  waits: opts.waits,
  version: pkg.version,
  settings: new Settings(resolve(opts.settings)),
  pictures: Pictures
    ? new Pictures(resolve(opts.pictures), (game) => {
        const entry = catalog.byId(game);
        return entry && catalog.database(entry);
      })
    : undefined,
});
const stream = acp.ndJsonStream(
  Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
  Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
);
const connection = app.connect(stream);
await connection.closed;
