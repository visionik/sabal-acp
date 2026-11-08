// Preferences that last between sessions, in a small JSON file.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;

/** Which pictures to show: the originals, or the next-gen paintings. */
export type Style = 'og' | 'ng';

interface Data {
  /** How much to enlarge pictures: 1 is the usual size. */
  scale?: number;
  style?: Style;
}

export class Settings {
  private data: Data;

  /** @param path The settings file; without one, settings last only while the agent runs. */
  constructor(private readonly path?: string) {
    this.data = {};
    if (!path) return;
    try {
      const read = JSON.parse(readFileSync(path, 'utf8')) as Data;
      if (read && typeof read === 'object') this.data = read;
    } catch {
      // No settings yet, or a file we can't read: start from the defaults.
    }
  }

  get scale(): number {
    const s = this.data.scale;
    return typeof s === 'number' && s >= MIN_SCALE && s <= MAX_SCALE ? s : 1;
  }

  set scale(value: number) {
    this.data.scale = value;
    this.save();
  }

  get style(): Style {
    return this.data.style === 'ng' ? 'ng' : 'og';
  }

  set style(value: Style) {
    this.data.style = value;
    this.save();
  }

  private save(): void {
    if (!this.path) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(this.data, null, 2) + '\n');
    } catch {
      // Not being able to remember a preference shouldn't stop the game.
    }
  }
}
