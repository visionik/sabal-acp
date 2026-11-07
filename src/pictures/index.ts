// SAGA pictures: find the player's own copies of the illustrated releases and
// draw the picture for the room they're in.
//
// The pictures are © Scott Adams / Adventure International and are not
// bundled. Players put their own tape, snapshot or disk files in the pictures folder.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Snapshot } from 'sabal';
import { loadSpectrum } from './tape.js';
import { draw, plausible, type BdpLayout, type Bitmap } from './bdp.js';
import { ATARI_PALETTE, drawAtari, loadAtr, pictureData, pictureOffsets, type AtariDisk } from './atari.js';
import { readD64 } from './d64.js';
import { encodePng } from './png.js';

type Release = SpectrumRelease | AtariRelease | C64Release;

interface SpectrumRelease extends Common {
  readonly platform: 'ZX Spectrum';
  /** Room text that must appear in the file, so one game's tape is never taken for another's. */
  readonly text: string;
  readonly layout: BdpLayout;
}

interface AtariRelease extends Common {
  readonly platform: 'Atari 8-bit';
  /** The picture disk (side B). */
  readonly disk: AtariDisk;
}

interface C64Release extends Common {
  readonly platform: 'Commodore 64';
  /** Room text that must appear in one of the disk's files. */
  readonly text: string;
  /**
   * The start of each room picture's file name, before the 3-digit room
   * number: room 7's picture is `R007` or `R13007`, and `…000` is the dark.
   * The files hold Atari-format pictures, so `rooms` and `dark` come from the disk.
   */
  readonly prefix: string;
}

interface Common {
  /** The game, as a catalog id (the .dat file name). */
  readonly game: string;
  /** Picture number for each room; rooms not listed have no picture. */
  readonly rooms?: Readonly<Record<number, number>>;
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
 * or message by eye. When a player has more than one release of a game, the
 * first one listed here wins.
 */
const RELEASES: readonly Release[] = [
  { game: 'adv13', platform: 'Commodore 64', text: "*I'm on a Drawbridge", prefix: 'R13' },
  { game: 'adv14b', platform: 'Commodore 64', text: 'Yoyodyne', prefix: 'R' },
  { game: 'quest2', platform: 'Commodore 64', text: 'chem lab', prefix: 'R' },
  {
    // The pictures run in room order, from "It's too dark!" for room 0.
    game: 'adv13',
    platform: 'Atari 8-bit',
    disk: { start: 0x287, count: 91, skipSector: 360, crc: 0x8b877c5f },
    rooms: range(1, 32, 59),
    dark: 58,
  },
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

const EXTENSIONS = /\.(tap|tzx|sna|atr|d64)$/i;
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
  readonly file: string;
  /** Picture number for each room, and for the dark. */
  readonly rooms: Readonly<Record<number, number>>;
  readonly dark?: number;
  /** Draw pictures one over another, as a PNG. */
  readonly render: (layers: number[]) => Buffer;
}

interface Hit {
  readonly release: Release;
  readonly render: (layers: number[]) => Buffer;
  readonly rooms?: Record<number, number>;
  readonly dark?: number;
}

export class Pictures {
  private found: Map<string, Found> | undefined;
  private readonly cache = new Map<string, Buffer>();

  /**
   * @param roomTexts Each room's description for a game, so a room without a
   *   picture of its own can share one with a room described the same way
   *   (only for releases whose pictures are named by room).
   */
  constructor(
    private readonly dir: string,
    private readonly roomTexts?: (game: string) => readonly string[] | undefined,
  ) {}

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
    if (snapshot.dark) return found?.dark === undefined ? undefined : this.picture(found, [found.dark]);
    const n = found?.rooms[snapshot.room];
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
      png = found.render(layers);
      this.cache.set(key, png);
    }
    return { png, key, platform: found.release.platform };
  }

  /** Give rooms without a picture the picture of a room with the same description. */
  private shareByText(game: string, rooms: Record<number, number>): Record<number, number> {
    const texts = this.roomTexts?.(game);
    if (!texts) return rooms;
    const shared = { ...rooms };
    texts.forEach((text, room) => {
      if (shared[room] !== undefined || !text) return;
      const twin = texts.findIndex((t, r) => t === text && rooms[r] !== undefined);
      if (twin >= 0) shared[room] = rooms[twin]!;
    });
    return shared;
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
        const data = readFileSync(path);
        for (const hit of recognise(name, data)) {
          const { release } = hit;
          const current = found.get(release.game);
          if (current && RELEASES.indexOf(release) >= RELEASES.indexOf(current.release)) continue;
          let rooms = hit.rooms ?? release.rooms ?? {};
          if (hit.rooms) rooms = this.shareByText(release.game, rooms);
          found.set(release.game, { release, file: name, render: hit.render, rooms, dark: hit.dark ?? release.dark });
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

/** The releases this file holds pictures for, each with a way to draw them. */
function recognise(name: string, data: Uint8Array): Hit[] {
  const hits: Hit[] = [];
  const mem = loadSpectrum(name, data);
  if (mem) {
    const text = Buffer.from(mem).toString('latin1');
    for (const release of RELEASES) {
      if (release.platform !== 'ZX Spectrum' || !text.includes(release.text) || !plausible(mem, release.layout)) continue;
      hits.push({
        release,
        render: (layers) => {
          let bitmap: Bitmap | undefined;
          for (const n of layers) bitmap = draw(mem, release.layout, n, bitmap);
          return encodePng(bitmap!);
        },
      });
    }
  }
  const sectors = /\.atr$/i.test(name) ? loadAtr(data) : undefined;
  if (sectors) {
    for (const release of RELEASES) {
      if (release.platform !== 'Atari 8-bit') continue;
      const pictures = pictureData(sectors, release.disk);
      const offsets = pictures && pictureOffsets(pictures, release.disk);
      if (!pictures || offsets!.length < release.disk.count) continue;
      hits.push({
        release,
        render: ([n]) => {
          // Atari pictures are drawn alone: overlays aren't supported for them yet.
          const { bitmap, colours } = drawAtari(pictures, offsets![n!]!, release.disk.old);
          return encodePng(bitmap, colours.map((c) => ATARI_PALETTE[c]!), 3);
        },
      });
    }
  }
  const files = /\.d64$/i.test(name) ? readD64(data) : undefined;
  if (files) {
    const text = [...files.values()].map((f) => Buffer.from(f).toString('latin1')).join('\0');
    for (const release of RELEASES) {
      if (release.platform !== 'Commodore 64' || !text.includes(release.text)) continue;
      const pictures = new Map<number, Uint8Array>();
      for (const [file, body] of files) {
        const match = file.startsWith(release.prefix) && /^\d{3}$/.exec(file.slice(release.prefix.length));
        if (match) pictures.set(Number(match[0]), body);
      }
      if (!pictures.size) continue;
      const rooms = Object.fromEntries([...pictures.keys()].filter((n) => n > 0).map((n) => [n, n]));
      hits.push({
        release,
        rooms,
        dark: pictures.has(0) ? 0 : undefined,
        render: ([n]) => {
          // The C64 releases use the Atari's picture format and colour numbers.
          const { bitmap, colours } = drawAtari(pictures.get(n!)!, 0);
          return encodePng(bitmap, colours.map((c) => ATARI_PALETTE[c]!), 3);
        },
      });
    }
  }
  return hits;
}
