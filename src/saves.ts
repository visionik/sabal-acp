// Save store: <root>/<game-id>/<name>.sav holds SABAL's exact save text,
// and <name>.json beside it holds what the menu shows.
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface SaveMeta {
  readonly game: string;
  readonly name: string;
  readonly savedAt: string;
  readonly room: string;
  readonly turns: number;
}

export interface SaveEntry extends SaveMeta {
  readonly path: string;
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,59}$/;

export function cleanSaveName(raw: string): string | undefined {
  const name = raw.trim().replace(/\s+/g, ' ');
  return NAME_RE.test(name) && !name.endsWith('.') ? name : undefined;
}

export function autoSaveName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `save-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

export class SaveStore {
  constructor(readonly root: string) {}

  put(meta: SaveMeta, text: string): { replaced: boolean } {
    const dir = join(this.root, meta.game);
    mkdirSync(dir, { recursive: true });
    const base = join(dir, meta.name);
    const replaced = existsSync(`${base}.sav`);
    writeFileSync(`${base}.sav`, text);
    writeFileSync(`${base}.json`, JSON.stringify(meta, null, 2) + '\n');
    return { replaced };
  }

  read(entry: SaveEntry): string {
    return readFileSync(entry.path, 'utf8');
  }

  /** All saves, newest first. */
  list(): SaveEntry[] {
    if (!existsSync(this.root)) return [];
    const out: SaveEntry[] = [];
    for (const game of readdirSync(this.root)) {
      const dir = join(this.root, game);
      if (!statSync(dir).isDirectory()) continue;
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.sav')) continue;
        const name = f.slice(0, -4);
        const path = join(dir, f);
        let meta: Partial<SaveMeta> = {};
        try {
          meta = JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
        } catch {
          // A bare .sav (copied in by hand) still loads; it just has less to show.
        }
        out.push({
          game,
          name,
          path,
          savedAt: meta.savedAt ?? statSync(path).mtime.toISOString(),
          room: meta.room ?? '',
          turns: meta.turns ?? 0,
        });
      }
    }
    return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
}
