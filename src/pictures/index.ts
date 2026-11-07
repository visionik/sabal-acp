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
  /** Room text that must appear in the file, so one game's tape is never taken for another's. */
  readonly text: string;
  readonly layout: BdpLayout;
  /** Picture number for each room; rooms not listed have no picture. */
  readonly rooms: Readonly<Record<number, number>>;
  /** Small pictures drawn over a room's picture while one of the items is in that room. */
  readonly overlays?: readonly Overlay[];
  /** Full-screen pictures shown when the game prints a matching message. */
  readonly closeUps?: readonly CloseUp[];
  /** The picture for a dark room, if the release has one. */
  readonly dark?: number;
}

interface Overlay {
  readonly room: number;
  /** Any of these item numbers. */
  readonly items: readonly number[];
  readonly picture: number;
}

interface CloseUp {
  readonly message: RegExp;
  readonly picture: number;
}

const range = (from: number, to: number, first: number) =>
  Object.fromEntries(Array.from({ length: to - from + 1 }, (_, i) => [from + i, first + i]));
const same = (rooms: number[], picture: number) => Object.fromEntries(rooms.map((r) => [r, picture]));

/**
 * Releases we can read. Room, item and message numbers are the TRS-80
 * database's (our .dat files). The Spectrum releases keep their own rules for
 * which picture to show, so each picture here was matched to its room, item
 * or message by eye.
 */
const RELEASES: readonly Release[] = [
  {
    game: 'adv01',
    platform: 'ZX Spectrum',
    text: 'dismal swamp',
    layout: { charset: 0xa303, count: 41, version: 1 },
    rooms: {
      ...range(1, 11, 0),
      ...same([12, 13, 14, 15, 16, 17], 11), // the maze of pits
      ...range(18, 33, 12),
    },
    overlays: [
      { room: 5, items: [17], picture: 29 }, // the door, open
      { room: 17, items: [29], picture: 30 }, // the Persian rug
      { room: 20, items: [35], picture: 28 }, // the bricked-up window, with a hole
      { room: 21, items: [25, 39, 43], picture: 31 }, // the bear
      { room: 23, items: [27], picture: 32 }, // the sleeping dragon
    ],
    closeUps: [
      { message: /Genie appears/, picture: 34 },
      { message: /Dragon smells something|bees attack the dragon/, picture: 33 },
      { message: /Gas bladder blew up/, picture: 36 },
    ],
  },
  {
    game: 'adv03',
    platform: 'ZX Spectrum',
    text: 'twisting yellow hallway',
    layout: { charset: 0xa242, count: 44, version: 1 },
    rooms: range(2, 23, 0),
    dark: 22,
    closeUps: [
      { message: /Good morning Mr\. Phelps/, picture: 23 }, // the tape player
      { message: /FEEL THE BOMB explode|triggering\s+the bomb/, picture: 25 }, // BOOM
    ],
  },
  {
    // Only the rooms whose picture is unmistakable; the rest show none.
    game: 'adv13',
    platform: 'ZX Spectrum',
    text: "*I'm on a Drawbridge",
    layout: { charset: 0x9fec, count: 38, version: 2 },
    rooms: {
      1: 0, // the field, before the castle
      3: 2, // courtyard
      5: 4, // stream of lava
      7: 5, // ball room
      8: 6, // on the chandelier
      12: 10, // dungeon cell
      15: 12, // loft above the ballroom
      16: 13, // in the moat
      17: 14, // underwater
      18: 15, // under the stairs
      19: 16, // hollow tree: LEAVE STARS HERE
      21: 18, // kitchen
      23: 19, // box
      28: 23, // entryway
      29: 24, // dragon's lair
    },
  },
  {
    // Only the rooms whose picture is unmistakable; the rest show none.
    game: 'quest2',
    platform: 'ZX Spectrum',
    text: "*I'm on side of a skyscraper",
    layout: { charset: 0xa27b, count: 41, version: 2 },
    rooms: {
      ...same([2, 16, 35], 0), // hall with threadbare carpeting
      ...same([6, 9, 11, 14], 1), // elevator shaft
      ...same([5, 10, 12], 2), // waiting room
      3: 8, // computer lab
      4: 6, // small office
      ...same([1, 21, 23, 36, 37, 38, 39], 5), // small deserted office
      ...same([7, 8, 25, 26, 27, 28, 29, 30, 31, 32, 33], 13), // air ducts
      13: 4, // chemical laboratory
      17: 7, // side of the skyscraper
      22: 10, // paper room
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
    const found = this.scan().get(game);
    if (snapshot.dark) return found?.release.dark === undefined ? undefined : this.picture(found, [found.release.dark]);
    const n = found?.release.rooms[snapshot.room];
    if (!found || n === undefined) return undefined;
    const overlays = (found.release.overlays ?? [])
      .filter((o) => o.room === snapshot.room && o.items.some((i) => snapshot.itemLocations[i] === snapshot.room))
      .map((o) => o.picture);
    return this.picture(found, [n, ...overlays]);
  }

  /** A close-up for a message the game just printed, if the release has one. */
  forMessage(game: string, text: string): Picture | undefined {
    const found = this.scan().get(game);
    const hit = found?.release.closeUps?.find((c) => c.message.test(text));
    return found && hit ? this.picture(found, [hit.picture]) : undefined;
  }

  /** Pictures drawn one over another, as a PNG. */
  private picture(found: Found, layers: number[]): Picture {
    const key = `${found.release.game}:${layers.join('+')}`;
    let png = this.cache.get(key);
    if (!png) {
      let bitmap;
      for (const n of layers) bitmap = draw(found.mem, found.release.layout, n, bitmap);
      png = encodePng(bitmap!);
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
        const text = Buffer.from(mem).toString('latin1');
        for (const release of RELEASES) {
          if (found.has(release.game) || !text.includes(release.text) || !plausible(mem, release.layout)) continue;
          found.set(release.game, { release, mem, file: name });
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
