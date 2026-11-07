// Room pictures as PNGs, from the player's own files in the pictures folder.
// SABAL does the recognising and drawing; this adds the folder, the PNG and caching.
import type { Database, GamePictures, PictureLibrary, Snapshot } from 'sabal';
import { encodePng, loadPictures } from 'sabal/node';

export interface Picture {
  readonly png: Buffer;
  /** Stable id for this picture, to avoid sending the same one twice in a row. */
  readonly key: string;
}

export class Pictures {
  private library: PictureLibrary | undefined;
  private readonly games = new Map<string, GamePictures | undefined>();
  private readonly pngs = new Map<string, Buffer>();

  /**
   * @param dir The folder of tape, snapshot and disk files, read the first time it's needed.
   * @param database The database for a catalog game id, so SABAL can tell which game it is.
   */
  constructor(
    private readonly dir: string,
    private readonly database: (game: string) => Database | undefined,
  ) {}

  /** Games with pictures, and the file each comes from. */
  list(): { game: string; platform: string; file: string }[] {
    return this.load().list();
  }

  /** The picture for where the player is, or undefined. */
  forRoom(game: string, snapshot: Snapshot, scale = 1): Picture | undefined {
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
