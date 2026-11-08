# sabal-acp

An [Agent Client Protocol](https://agentclientprotocol.com) "agent" that plays Scott Adams adventure games, built on [SABAL](https://github.com/visionik/sabal) (Scott Adams Brass-lamp Adventure Library).

It isn't an LLM or an AI agent; it only acts like one. Any ACP client (Deft Console, Zed, …) can start it and chat with it: a new session opens on a welcome screen and a menu of games, and from there you play by typing commands like `GET LAMP` or `GO NORTH`.

## Run

```sh
npm install
npm run build
node dist/main.js --help
```

Point your ACP client at `node /path/to/sabal-acp/dist/main.js` (or the `sabal-acp` bin once installed). It speaks ACP over stdin/stdout.

| Option | Default | |
| --- | --- | --- |
| `--games-dir <dir>` | bundled `games/` (env `SABAL_GAMES`) | folder of uncompressed `.dat` games |
| `--saves-dir <dir>` | `~/.sabal-acp/saves` (env `SABAL_SAVES`) | where saves are written |
| `--pictures-dir <dir>` | `~/.sabal-acp/pictures` (env `SABAL_PICTURES`) | your own SAGA tape or snapshot files, for room pictures |
| `--no-pictures` | off | never send pictures |
| `--settings <file>` | `~/.sabal-acp/settings.json` (env `SABAL_SETTINGS`) | where preferences such as `/scale` are kept |
| `--no-wait` | off | skip the games' 2-second pauses |

## Playing

**Menu** (plain words; a leading `/` also works): a number or game name starts a game · `saves` lists saved games · `load <name|number>` restores one · `help`.

**In a game** every line goes to the game; send several lines to run several commands. Agent commands start with `/`, so they never collide with game words. They are announced to the client as slash commands:

| Command | |
| --- | --- |
| `/menu` | leave the game, back to the list |
| `/save [name]` | save (same as the game's own `SAVE GAME`) |
| `/load <name\|number\|game/name>` | restore a save |
| `/saves` | list saves |
| `/restart` | start the current game over |
| `/scale [size]` | draw pictures bigger or smaller (`/scale 1.5`, `/scale 75%`); remembered between sessions |
| `/help` | how to play |

Leaving, restarting or loading with unsaved progress asks you to repeat the command first.

**Saves** live in `<saves-dir>/<game-id>/<name>.sav` (SABAL's exact save text) with a `<name>.json` beside it (game, time, room, turn count). A bare `.sav` copied in by hand also loads.

## Pictures

Scott Adams's games were later sold with pictures, as Scott Adams Graphic Adventures (SAGA). sabal-acp can show a room's picture above its description, drawn from your own copy of an illustrated release. The pictures are © Scott Adams and Adventure International and are not included here.

To try it, put your copy of a supported release in `~/.sabal-acp/pictures`: a ZX Spectrum tape or snapshot, an Atari or Apple II picture disk, a Commodore 64 disk, or a TI-99/4A cartridge (`.rpk`). SABAL recognises the game from the file's contents, so any file name works. [SABAL's README](https://github.com/visionik/sabal#show-the-pictures-from-the-illustrated-releases) lists the releases it can read and how many rooms each covers: Adventureland, Pirate Adventure, Secret Mission, Voodoo Castle, The Count, Strange Odyssey, Savage Island I and II, The Sorcerer of Claymorgue Castle, Return to Pirate's Isle, The Incredible Hulk, Spider-Man and Buckaroo Banzai. The games that never had pictures (Mystery Fun House, Pyramid of Doom, Ghost Town, The Golden Voyage and the Mini-Adventure Sampler) have SABAL's own, with no files needed.

Pictures go only to clients that say they can draw PNG images in agent messages. ACP has no standard way to say that yet, so for now that means Deft Console, which says so in `clientCapabilities._meta["deft.co"].display.image`. Other clients get the text, as before. A picture is sent when you enter a room whose picture differs from the last one shown.

## How it maps to ACP

- `initialize`: no auth, text prompts only, `loadSession: false`.
- `session/new`: sends `available_commands_update`, a `session_info_update` title, and the welcome screen.
- `session/prompt`: one turn of the menu/game state machine; output is one `agent_message_chunk` per turn, split only at the games' pauses and before a room picture (an `image` block). Room descriptions are fenced `text` blocks; game narration is Markdown-escaped with its line breaks kept. The session title follows the current game.
- `session/cancel`: cuts a pause short; the turn ends with `stopReason: "cancelled"`.

## Layout

```
src/main.ts        CLI + stdio transport
src/agent.ts       ACP handlers, one Controller per session
src/controller.ts  menu / playing / save-name state machine (no ACP)
src/render.ts      engine text → Markdown
src/catalog.ts     game discovery and titles
src/saves.ts       save store
src/pictures.ts    room pictures as PNGs, via SABAL's picture library (sabal/node)
games/             bundled game databases
test/              end-to-end tests over a real ACP stdio connection
```

`npm test` builds and runs the tests.

## Licence

The code is MIT licensed. The bundled games in `games/` are not: they are © Scott Adams, 1978–1985, and he distributes them as shareware that may be freely downloaded and enjoyed, with payment voluntary. They come unchanged from The Scott Adams Collection 2.2 on the Interactive Fiction Archive, converted by Paul David Doherty. See [`games/README.md`](games/README.md) for the full notice and credits, and [msadams.com](https://www.msadams.com/) to support Scott Adams.

The pictures are read and drawn by SABAL; see its README and NOTICE for credits.
