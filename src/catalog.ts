// Game catalog: finds the bundled (or user-supplied) .dat files and names them.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { loadDatabase, type Database } from 'sabal';

export interface Game {
  /** Stable id, the file name without `.dat` (e.g. `adv01`). Used in save paths. */
  readonly id: string;
  readonly title: string;
  readonly path: string;
}

// The .dat files carry no title, and adventure numbers collide (the Questprobe
// files both say 2), so titles are keyed by file name.
const TITLES: Record<string, string> = {
  adv01: 'Adventureland',
  adv02: 'Pirate Adventure',
  adv03: 'Mission Impossible',
  adv04: 'Voodoo Castle',
  adv05: 'The Count',
  adv06: 'Strange Odyssey',
  adv07: 'Mystery Fun House',
  adv08: 'Pyramid of Doom',
  adv09: 'Ghost Town',
  adv10: 'Savage Island, Part 1',
  adv11: 'Savage Island, Part 2',
  adv12: 'The Golden Voyage',
  adv13: 'Sorcerer of Claymorgue Castle',
  adv14a: "Return to Pirate's Isle",
  adv14b: 'Buckaroo Banzai',
  quest1: 'Questprobe 1: The Incredible Hulk',
  quest2: 'Questprobe 2: Spider-Man',
  sampler1: 'Mini-Adventure Sampler',
};

export class Catalog {
  readonly games: readonly Game[];
  private readonly cache = new Map<string, Database>();

  constructor(dir: string) {
    if (!existsSync(dir)) throw new Error(`Games directory not found: ${dir}`);
    this.games = readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.dat'))
      .sort()
      .map((f) => {
        const id = basename(f, f.slice(-4));
        return { id, title: TITLES[id] ?? id, path: join(dir, f) };
      });
  }

  byId(id: string): Game | undefined {
    return this.games.find((g) => g.id === id);
  }

  /** Resolve a menu choice: a number, a game id, or a unique piece of a title. */
  find(query: string): Game | Game[] | undefined {
    const q = query.trim().toLowerCase();
    if (!q) return undefined;
    if (/^\d+$/.test(q)) return this.games[Number(q) - 1];
    const exact = this.games.find((g) => g.id === q || g.title.toLowerCase() === q);
    if (exact) return exact;
    const hits = this.games.filter((g) => g.title.toLowerCase().includes(q));
    if (hits.length === 1) return hits[0];
    // "pirate" means Pirate Adventure rather than Return to Pirate's Isle.
    const leading = hits.filter((g) => g.title.toLowerCase().startsWith(q));
    if (leading.length === 1) return leading[0];
    return hits.length ? hits : undefined;
  }

  database(game: Game): Database {
    let db = this.cache.get(game.id);
    if (!db) {
      // The files are 7-bit ASCII; latin1 keeps any stray byte one-to-one.
      db = loadDatabase(readFileSync(game.path, 'latin1'));
      this.cache.set(game.id, db);
    }
    return db;
  }
}
