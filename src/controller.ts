// One chat session's state machine: menu → playing → (save name) → menu.
// It knows nothing about ACP; the agent hands it text and an Io to write to.
import { createSession, SaveError, SabalError, type Session, type StepResult } from 'sabal';
import type { Catalog, Game } from './catalog.js';
import { SaveStore, cleanSaveName, autoSaveName, type SaveEntry } from './saves.js';
import { roomBlock, narration, note } from './render.js';

export interface Io {
  /** Append Markdown to the agent's reply. */
  emit(markdown: string): void | Promise<void>;
  /** Pause for the game; resolves early if the turn is cancelled. */
  wait(ms: number): Promise<void>;
  /** Show a session title, if the client supports it. */
  title(text: string): void | Promise<void>;
}

export interface ControllerOptions {
  /** Honour the engine's 2-second pauses (default true). */
  waits?: boolean;
}

type State = 'menu' | 'playing' | 'save-name';

export const SLASH_COMMANDS = [
  { name: 'menu', description: 'Leave the game and go back to the game list' },
  { name: 'save', description: 'Save the current game', input: { hint: 'name (optional)' } },
  { name: 'load', description: 'Restore a saved game', input: { hint: 'save name or number' } },
  { name: 'saves', description: 'List saved games' },
  { name: 'restart', description: 'Start the current game over' },
  { name: 'help', description: 'How to play, and these commands' },
] as const;

export const WELCOME_HEADING =
  'Welcome to SABAL (Scott Adams Brass-lamp Adventure Library) ACP (Agent-Client Protocol "Agent")';

const ASCII_RE = /^[\x20-\x7e\t\r\n]*$/;

export class Controller {
  private state: State = 'menu';
  private game: Game | undefined;
  private session: Session | undefined;
  private turns = 0;
  private dirty = false;
  private room = '';
  private welcomed = false;
  private pendingSave: { text: string; name?: string } | undefined;
  private confirm: string | undefined;
  private lastSaveList: SaveEntry[] = [];
  private readonly waits: boolean;

  constructor(
    private readonly catalog: Catalog,
    private readonly saves: SaveStore,
    options: ControllerOptions = {},
  ) {
    this.waits = options.waits ?? true;
  }

  get currentState(): State {
    return this.state;
  }

  /** The opening screen. Marks the session as welcomed. */
  welcome(): string {
    this.welcomed = true;
    return (
      note(`# ${WELCOME_HEADING}`) +
      note(
        "> **I'm not actually an LLM or an AI agent. I just act like one.** " +
          'Your ACP client talks to me the way it talks to an agent, but behind this chat ' +
          "is a small, deterministic engine running Scott Adams's classic text adventures " +
          "(1978–1985). I don't understand free-form chat. Inside a game I understand " +
          'two-word commands like `GET LAMP`, `GO NORTH` or `INVENTORY`.',
      ) +
      note(
        '_The games are © Scott Adams, 1978–1985, and shared by him as shareware: free to play, ' +
          'with payment voluntary. Support him at [msadams.com](https://www.msadams.com/)._',
      ) +
      this.menuText()
    );
  }

  async handle(input: string, io: Io): Promise<void> {
    const text = input.replace(/\r\n?/g, '\n').trim();
    const confirming = this.confirm;
    this.confirm = undefined;

    if (this.state === 'save-name') return this.handleSaveName(text, io);

    if (text.startsWith('/')) return this.slash(text.slice(1), io, confirming);
    if (this.state === 'playing') return this.play(text, io);
    return this.menuInput(text, io, confirming);
  }

  // ---- menu -------------------------------------------------------------

  private menuText(): string {
    const list = this.catalog.games.map((g, i) => `${i + 1}. ${g.title}`).join('\n');
    const saves = this.saves.list().length;
    return (
      note('## Games') +
      note(list) +
      note(
        'Type a **number** or **name** to start a game · ' +
          `\`saves\` to list saved games${saves ? ` (${saves})` : ''} · ` +
          '`load <name>` to restore one · `help`',
      )
    );
  }

  private async menuInput(text: string, io: Io, confirming: string | undefined): Promise<void> {
    const [word = '', ...rest] = text.split(/\s+/);
    const arg = rest.join(' ');
    switch (word.toLowerCase()) {
      case '':
      case 'menu':
      case 'games':
      case 'list':
        return void (await io.emit(this.welcomed ? this.menuText() : this.welcome()));
      case 'help':
      case '?':
        return void (await io.emit(this.helpText()));
      case 'saves':
        return void (await io.emit(this.savesText()));
      case 'load':
      case 'restore':
        return this.load(arg, io, confirming);
      case 'quit':
      case 'exit':
        return void (await io.emit(note("There's nothing to quit here. Close this session whenever you like, or pick a game.")));
    }
    const hit = this.catalog.find(text);
    if (hit && !Array.isArray(hit)) return this.start(hit, io);
    if (Array.isArray(hit)) {
      return void (await io.emit(
        note(`"${escape(text)}" matches more than one game:`) +
          note(hit.map((g) => `${this.catalog.games.indexOf(g) + 1}. ${g.title}`).join('\n')),
      ));
    }
    if (!this.welcomed) return void (await io.emit(this.welcome()));
    await io.emit(note(`I don't know a game called "${escape(text)}". Pick a number from the list:`) + this.menuText());
  }

  private helpText(): string {
    return (
      note('## How to play') +
      note(
        '- Pick a game from the menu by number or name.\n' +
          '- In a game, type short commands: a verb and a noun, like `GET LAMP`, `OPEN DOOR`, `GO NORTH`. ' +
          'Directions can be shortened to `N`, `S`, `E`, `W`, `U`, `D`. Try `LOOK`, `INVENTORY` and `SCORE`. ' +
          'Many games also answer `HELP`.\n' +
          '- You can send several commands at once, one per line.\n' +
          '- Saves are stored on this machine and can be loaded from the menu or during play.',
      ) +
      note('## Commands') +
      note(SLASH_COMMANDS.map((c) => `- \`/${c.name}${'input' in c ? ` <${c.input.hint}>` : ''}\` — ${c.description}`).join('\n')) +
      note('In the menu the slash is optional: `saves`, `load mygame`, `help`.')
    );
  }

  // ---- slash commands ---------------------------------------------------

  private async slash(cmdline: string, io: Io, confirming: string | undefined): Promise<void> {
    const [raw = '', ...rest] = cmdline.trim().split(/\s+/);
    const cmd = raw.toLowerCase();
    const arg = rest.join(' ');
    const key = `/${cmd} ${arg}`.trim();
    switch (cmd) {
      case 'menu':
      case 'games':
        if (this.state === 'playing' && this.dirty && confirming !== key) {
          return this.askConfirm(key, 'leave this game', io);
        }
        this.leaveGame();
        await io.title('SABAL');
        return void (await io.emit(this.menuText()));
      case 'help':
        return void (await io.emit(this.helpText()));
      case 'saves':
        return void (await io.emit(this.savesText()));
      case 'load':
      case 'restore':
        return this.load(arg, io, confirming);
      case 'save':
        return this.saveCommand(arg, io);
      case 'restart':
        if (!this.game) return void (await io.emit(note("You're not in a game. Pick one from the menu first.")));
        if (this.dirty && confirming !== key) return this.askConfirm(key, 'start over', io);
        return this.start(this.game, io);
      case 'cancel':
        return void (await io.emit(note('Nothing to cancel.')));
      default:
        await io.emit(
          note(`I don't know \`/${escape(cmd)}\`. Commands: ${SLASH_COMMANDS.map((c) => `\`/${c.name}\``).join(', ')}.`),
        );
    }
  }

  private async askConfirm(key: string, what: string, io: Io): Promise<void> {
    this.confirm = key;
    await io.emit(
      note(`You have unsaved progress. Type \`${key}\` again to ${what} anyway, or \`/save\` first.`),
    );
  }

  // ---- playing ----------------------------------------------------------

  private async start(game: Game, io: Io, restoreText?: string, from?: SaveEntry): Promise<void> {
    let session: Session;
    try {
      session = createSession(this.catalog.database(game), restoreText === undefined ? {} : { restoreText });
    } catch (err) {
      if (err instanceof SaveError) {
        return void (await io.emit(note(`Unable to restore game. (${escape(err.message)})`)));
      }
      return void (await io.emit(note(`Couldn't start ${game.title}: ${escape(String((err as Error).message ?? err))}`)));
    }
    this.leaveGame();
    this.game = game;
    this.session = session;
    this.state = 'playing';
    this.turns = from?.turns ?? 0;
    this.dirty = false;
    await io.title(`SABAL · ${game.title}`);
    await io.emit(
      note(
        from
          ? `**Restored "${escape(from.name)}" — ${game.title}.**`
          : `**${game.title}** · type commands like \`GET LAMP\` · \`/help\` for agent commands`,
      ),
    );
    await this.settle(session.initialResult, io);
  }

  private leaveGame(): void {
    if (this.session?.status === 'need-save-identifier') {
      // Abandoning a save prompt: let the engine finish its turn quietly.
      try {
        this.session.provideSaveIdentifier('abandoned', false);
      } catch {
        /* the session is being dropped anyway */
      }
    }
    this.state = 'menu';
    this.game = undefined;
    this.session = undefined;
    this.pendingSave = undefined;
    this.dirty = false;
  }

  private async play(text: string, io: Io): Promise<void> {
    const session = this.session!;
    if (!ASCII_RE.test(text)) {
      return void (await io.emit(note('I only understand plain ASCII commands (letters, numbers and spaces).')));
    }
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return void (await io.emit(note('_Tell me what to do._')));
    for (const [i, line] of lines.entries()) {
      if (session.status !== 'need-command' || this.session !== session) break;
      if (lines.length > 1) await io.emit(note(`**> ${escape(line.toUpperCase())}**`));
      let result: StepResult;
      try {
        result = session.submitCommand(line);
      } catch (err) {
        await this.engineFailure(err, io);
        return;
      }
      this.turns++;
      this.dirty = true;
      await this.settle(result, io);
      if (this.state !== 'playing' && i < lines.length - 1) {
        await io.emit(note(`_(Skipped the remaining ${lines.length - 1 - i} command(s).)_`));
        break;
      }
    }
  }

  /** Render a step's events and drive the engine until it wants a command. */
  private async settle(first: StepResult, io: Io): Promise<void> {
    const session = this.session!;
    let result = first;
    for (;;) {
      let buffer = '';
      const flush = async () => {
        const md = narration(buffer);
        buffer = '';
        if (md) await io.emit(md);
      };
      for (const event of result.events) {
        switch (event.kind) {
          case 'room':
            await flush();
            this.room = event.text.split('\n')[0]?.trim() ?? '';
            await io.emit(roomBlock(event.text));
            break;
          case 'response':
            buffer += event.text;
            break;
          case 'clear-response':
            await flush();
            break;
          case 'diagnostic':
            await flush();
            await io.emit(note(`_[engine] ${escape(event.text.trim())}_`));
            break;
          default:
            break; // prompts, wait and terminated are handled by status below
        }
      }
      await flush();

      try {
        if (result.status === 'need-wait') {
          if (this.waits) await io.wait(2000);
          result = session.notifyWaitComplete();
          continue;
        }
        if (result.status === 'need-save-identifier') {
          const pending = { text: session.serializeSave(), name: this.pendingSave?.name };
          this.pendingSave = pending;
          if (pending.name) {
            result = this.finishSave(pending.name, (md) => (buffer += md));
            await io.emit(buffer);
            continue;
          }
          this.state = 'save-name';
          await io.emit(note('**Name this save** (letters, numbers, spaces, `-` `_` `.`), or press enter for an automatic name. `/cancel` to skip.'));
          return;
        }
      } catch (err) {
        await this.engineFailure(err, io);
        return;
      }
      if (result.status === 'terminated') {
        const title = this.game?.title ?? 'the game';
        this.leaveGame();
        await io.title('SABAL');
        await io.emit(note(`**— ${title} is over. —**`) + this.menuText());
      }
      return;
    }
  }

  private async engineFailure(err: unknown, io: Io): Promise<void> {
    const msg = err instanceof SabalError ? err.message : String((err as Error)?.message ?? err);
    this.leaveGame();
    await io.title('SABAL');
    await io.emit(note(`The game engine stopped with an error: ${escape(msg)}`) + this.menuText());
  }

  // ---- saving -----------------------------------------------------------

  private async saveCommand(arg: string, io: Io): Promise<void> {
    const session = this.session;
    if (this.state !== 'playing' || !session) {
      return void (await io.emit(note("You're not in a game, so there's nothing to save.")));
    }
    let name: string | undefined;
    if (arg) {
      name = cleanSaveName(arg);
      if (!name) return void (await io.emit(note(badNameText())));
    }
    if (session.status !== 'need-command') return;
    // The engine has no "save now" call; the games' own SAVE GAME does it.
    this.pendingSave = name ? { text: '', name } : undefined;
    let result: StepResult;
    try {
      result = session.submitCommand('SAVE GAME');
    } catch (err) {
      return this.engineFailure(err, io);
    }
    if (result.status !== 'need-save-identifier') {
      this.pendingSave = undefined;
      await io.emit(note("This game didn't offer to save just now."));
    }
    await this.settle(result, io);
  }

  private async handleSaveName(text: string, io: Io): Promise<void> {
    let name: string;
    if (text === '/cancel' || text === '/menu') {
      const result = this.session!.provideSaveIdentifier('cancelled', false);
      this.state = 'playing';
      this.pendingSave = undefined;
      await io.emit(note('_Save cancelled._'));
      await this.settle(result, io);
      if (text === '/menu') return this.handle('/menu', io);
      return;
    }
    if (!text) {
      name = autoSaveName();
    } else {
      const clean = cleanSaveName(text);
      if (!clean) return void (await io.emit(note(badNameText())));
      name = clean;
    }
    let out = '';
    let result: StepResult;
    try {
      result = this.finishSave(name, (md) => (out += md));
    } catch (err) {
      return this.engineFailure(err, io);
    }
    this.state = 'playing';
    if (out) await io.emit(out);
    await this.settle(result, io);
  }

  /** Store the pending save and resume the engine. */
  private finishSave(name: string, say: (md: string) => void): StepResult {
    const session = this.session!;
    const game = this.game!;
    const text = this.pendingSave?.text ?? session.serializeSave();
    this.pendingSave = undefined;
    let ok = true;
    try {
      const { replaced } = this.saves.put(
        { game: game.id, name, savedAt: new Date().toISOString(), room: this.room, turns: this.turns },
        text,
      );
      say(note(`_Saved as **${escape(name)}**${replaced ? ' (replaced the old save with that name)' : ''}. Load it later with \`load ${escape(name)}\`._`));
      this.dirty = false;
    } catch (err) {
      ok = false;
      say(note(`_Couldn't write the save: ${escape(String((err as Error).message ?? err))}_`));
    }
    this.state = 'playing';
    return session.provideSaveIdentifier(name, ok);
  }

  // ---- loading ----------------------------------------------------------

  private savesText(): string {
    const list = this.saves.list();
    this.lastSaveList = list;
    if (!list.length) return note('No saved games yet. In a game, type `SAVE GAME` or `/save <name>`.');
    const rows = list.map((s, i) => {
      const title = this.catalog.byId(s.game)?.title ?? s.game;
      const when = s.savedAt.replace('T', ' ').slice(0, 16);
      const where = s.room ? ` — ${escape(s.room)}` : '';
      return `${i + 1}. **${escape(s.name)}** · ${title} · ${when}${where}`;
    });
    return note('## Saved games') + note(rows.join('\n')) + note('Type `load <number>` or `load <name>`.');
  }

  private async load(arg: string, io: Io, confirming: string | undefined): Promise<void> {
    if (!arg) return void (await io.emit(this.savesText()));
    const list = this.saves.list();
    let matches: SaveEntry[];
    if (/^\d+$/.test(arg)) {
      const shown = this.lastSaveList.length ? this.lastSaveList : list;
      const hit = shown[Number(arg) - 1];
      matches = hit ? [hit] : [];
    } else if (arg.includes('/')) {
      const [g, ...n] = arg.split('/');
      matches = list.filter((s) => s.game === g && s.name.toLowerCase() === n.join('/').toLowerCase());
    } else {
      matches = list.filter((s) => s.name.toLowerCase() === arg.toLowerCase());
      if (matches.length > 1 && this.game) {
        const here = matches.filter((s) => s.game === this.game!.id);
        if (here.length === 1) matches = here;
      }
    }
    if (!matches.length) {
      return void (await io.emit(note(`No save called "${escape(arg)}".`) + this.savesText()));
    }
    if (matches.length > 1) {
      return void (await io.emit(
        note(`More than one game has a save called "${escape(arg)}". Use \`load <game>/<name>\`:`) +
          note(matches.map((s) => `- \`load ${s.game}/${escape(s.name)}\` (${this.catalog.byId(s.game)?.title ?? s.game})`).join('\n')),
      ));
    }
    const entry = matches[0]!;
    const game = this.catalog.byId(entry.game);
    if (!game) return void (await io.emit(note(`That save is for a game I don't have (${escape(entry.game)}).`)));
    const key = `/load ${arg}`;
    if (this.state === 'playing' && this.dirty && confirming !== key && confirming !== `load ${arg}`) {
      return this.askConfirm(key, 'load it', io);
    }
    let text: string;
    try {
      text = this.saves.read(entry);
    } catch {
      return void (await io.emit(note('Unable to restore game.')));
    }
    await this.start(game, io, text, entry);
  }
}

function escape(s: string): string {
  return s.replace(/[\\`*_[\]<>#|~]/g, (c) => `\\${c}`);
}

function badNameText(): string {
  return note('Save names can use letters, numbers, spaces, `-`, `_` and `.` (up to 60 characters). Try another name.');
}
