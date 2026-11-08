// Room pictures as PNGs: the originals, from the player's own files in the
// pictures folder (and SABAL's own for games that never had any), or the
// next-gen paintings that ship with SABAL. SABAL does the recognising,
// drawing and composing; this adds the folder, the choice and caching.
import type { Database, GamePictures, NgGamePictures, PictureLibrary, Snapshot } from 'sabal';
import { composeNg, encodePng, loadNg, loadPictures, type NgOptions, type NgSource } from 'sabal/node';
import type { Style } from './settings.js';

export interface Picture {
  readonly png: Buffer;
  /** Stable id for this picture, to avoid sending the same one twice in a row. */
  readonly key: string;
}

export class Pictures {
  private library: PictureLibrary | undefined;
  private ng: NgSource | null | undefined;
  private readonly games = new Map<string, GamePictures | undefined>();
  private readonly ngGames = new Map<string, NgGamePictures | undefined>();
  private readonly pngs = new Map<string, Buffer>();

  /**
   * @param dir The folder of tape, snapshot and disk files, read the first time it's needed.
   * @param database The database for a catalog game id, so SABAL can tell which game it is.
   */
  private readonly downloads = new Map<string, Promise<void>>();

  /**
   * @param dir The folder of tape, snapshot and disk files, read the first time it's needed.
   * @param database The database for a catalog game id, so SABAL can tell which game it is.
   * @param ng Where next-gen pictures are kept once downloaded (`cache`), and where the manifest is.
   */
  constructor(
    private readonly dir: string,
    private readonly database: (game: string) => Database | undefined,
    private readonly ng_: NgOptions = {},
  ) {}

  /** Games with pictures, and the file each comes from. */
  list(): { game: string; platform: string; file: string }[] {
    return this.load().list();
  }

  /** Whether this game has next-gen pictures. */
  hasNg(game: string): boolean {
    return this.ngGame(game) !== undefined;
  }

  /** How many bytes of a game's next-gen pictures still need downloading (0 when they're all here). */
  ngToDownload(game: string): number {
    const source = this.loadNg();
    if (!source || !this.hasNg(game) || source.ready(game)) return 0;
    return Math.max(1, source.missing(game).bytes);
  }

  /** Download a game's next-gen pictures, once even if asked again meanwhile. */
  downloadNg(game: string): Promise<void> {
    let pending = this.downloads.get(game);
    if (!pending) {
      const source = this.loadNg();
      pending = source ? source.download(game).then(() => undefined) : Promise.resolve();
      pending = pending.finally(() => this.downloads.delete(game));
      this.downloads.set(game, pending);
    }
    return pending;
  }

  /**
   * The picture for where the player is, or undefined. With style 'ng', the
   * next-gen picture when there is one, else the original.
   */
  forRoom(game: string, snapshot: Snapshot, scale = 1, style: Style = 'og'): Picture | undefined {
    if (style === 'ng' && this.loadNg()?.ready(game)) {
      const ng = this.ngGame(game)?.forState(snapshot);
      if (ng) {
        const cacheKey = `${ng.key}@${scale}`;
        let png = this.pngs.get(cacheKey);
        if (!png) {
          png = composeNg(ng, (file) => this.loadNg()!.read(file), scale);
          this.pngs.set(cacheKey, png);
        }
        return { png, key: ng.key };
      }
    }
    const picture = this.game(game)?.forState(snapshot);
    return picture && this.png(picture.key, picture.image, scale);
  }

  /** A close-up for a message the game just printed, if there is one. */
  forMessage(game: string, text: string, scale = 1): Picture | undefined {
    const picture = this.game(game)?.forMessage(text);
    return picture && this.png(picture.key, picture.image, scale);
  }

  private game(game: string): GamePictures | undefined {
    if (!this.games.has(game)) {
      const database = this.database(game);
      this.games.set(game, database && this.load().forGame(database));
    }
    return this.games.get(game);
  }

  private ngGame(game: string): NgGamePictures | undefined {
    if (!this.ngGames.has(game)) {
      const database = this.database(game);
      this.ngGames.set(game, database && this.loadNg()?.library.forGame(database));
    }
    return this.ngGames.get(game);
  }

  private loadNg(): NgSource | undefined {
    if (this.ng === undefined) this.ng = loadNg(this.ng_) ?? null;
    return this.ng ?? undefined;
  }

  private load(): PictureLibrary {
    this.library ??= loadPictures(this.dir);
    return this.library;
  }

  private png(key: string, image: Parameters<typeof encodePng>[0], scale: number): Picture {
    let png = this.pngs.get(`${key}@${scale}`);
    if (!png) {
      png = encodePng(image, scale);
      this.pngs.set(`${key}@${scale}`, png);
    }
    return { png, key };
  }
}
