// SAGA pictures: find the player's own copies of the illustrated releases and
// draw the picture for the room they're in.
//
// The pictures are © Scott Adams / Adventure International and are not
// bundled. Players put their own tape or snapshot files in the pictures folder.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Snapshot } from 'sabal';
import { loadSpectrum, type Memory } from './tape.js';
import { draw, plausible, type BdpLayout } from './bdp.js';
import { encodePng } from './png.js';

interface Release {
  /** The game, as a catalog id (the .dat file name). */
  readonly game: string;
  readonly platform: string;
  readonly layout: BdpLayout;
  /** Picture number for each room; rooms not listed have no picture. */
  readonly rooms: Readonly<Record<number, number>>;
}

const range = (from: number, to: number, first: number) =>
  Object.fromEntries(Array.from({ length: to - from + 1 }, (_, i) => [from + i, first + i]));
const same = (rooms: number[], picture: number) => Object.fromEntries(rooms.map((r) => [r, picture]));

/**
 * Releases we can read. Room numbers are the TRS-80 database's (our .dat
 * files); each picture was matched to its room by eye.
 */
const RELEASES: readonly Release[] = [
  {
    game: 'adv01',
    platform: 'ZX Spectrum',
    layout: { charset: 0xa303, count: 41, version: 1 },
    rooms: {
      ...range(1, 11, 0),
      ...same([12, 13, 14, 15, 16, 17], 11), // the maze of pits
      ...range(18, 33, 12),
    },
  },
];

const EXTENSIONS = /\.(tap|tzx|sna)$/i;
const MAX_FILE = 1 << 20;

export interface Picture {
  readonly png: Buffer;
  /** Stable id for this picture, to avoid sending the same one twice in a row. */
  readonly key: string;
  /** Where the picture comes from, e.g. "ZX Spectrum". */
  readonly platform: string;
}

interface Found {
  readonly release: Release;
  readonly mem: Memory;
  readonly file: string;
}

export class Pictures {
  private found: Map<string, Found> | undefined;
  private readonly cache = new Map<string, Buffer>();

  constructor(private readonly dir: string) {}

  /** Games with pictures, and the file each comes from. */
  list(): { game: string; platform: string; file: string }[] {
    return [...this.scan().values()].map((f) => ({ game: f.release.game, platform: f.release.platform, file: f.file }));
  }

  has(game: string): boolean {
    return this.scan().has(game);
  }

  /** The picture for where the player is, or undefined (dark, no picture, or no file). */
  forRoom(game: string, snapshot: Snapshot): Picture | undefined {
    if (snapshot.dark) return undefined;
    const found = this.scan().get(game);
    const n = found?.release.rooms[snapshot.room];
    if (!found || n === undefined) return undefined;
    const key = `${game}:${n}`;
    let png = this.cache.get(key);
    if (!png) {
      png = encodePng(draw(found.mem, found.release.layout, n));
      this.cache.set(key, png);
    }
    return { png, key, platform: found.release.platform };
  }

  private scan(): Map<string, Found> {
    if (this.found) return this.found;
    const found = new Map<string, Found>();
    let names: string[] = [];
    try {
      names = readdirSync(this.dir).filter((n) => EXTENSIONS.test(n)).sort();
    } catch {
      // No pictures folder: no pictures.
    }
    for (const name of names) {
      const path = join(this.dir, name);
      try {
        if (statSync(path).size > MAX_FILE) continue;
        const mem = loadSpectrum(name, readFileSync(path));
        if (!mem) continue;
        for (const release of RELEASES) {
          if (!found.has(release.game) && plausible(mem, release.layout)) found.set(release.game, { release, mem, file: name });
        }
      } catch {
        // An unreadable or odd file is skipped.
      }
    }
    this.found = found;
    return found;
  }
}

/** Games we can show pictures for, by title-independent id, for help text. */
export const SUPPORTED = RELEASES.map((r) => ({ game: r.game, platform: r.platform }));
