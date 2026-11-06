# sabal-acp

An [Agent Client Protocol](https://agentclientprotocol.com) "agent" that plays Scott Adams adventure games, built on [SABAL](https://github.com/visionik/sabal) (Scott Adams Bot Adventure Library).

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
| `/help` | how to play |

Leaving, restarting or loading with unsaved progress asks you to repeat the command first.

**Saves** live in `<saves-dir>/<game-id>/<name>.sav` (SABAL's exact save text) with a `<name>.json` beside it (game, time, room, turn count). A bare `.sav` copied in by hand also loads.

## How it maps to ACP

- `initialize`: no auth, text prompts only, `loadSession: false`.
- `session/new`: sends `available_commands_update`, a `session_info_update` title, and the welcome screen.
- `session/prompt`: one turn of the menu/game state machine; output is one `agent_message_chunk` per turn, split only at the games' pauses. Room descriptions are fenced `text` blocks; game narration is Markdown-escaped with its line breaks kept. The session title follows the current game.
- `session/cancel`: cuts a pause short; the turn ends with `stopReason: "cancelled"`.

## Layout

```
src/main.ts        CLI + stdio transport
src/agent.ts       ACP handlers, one Controller per session
src/controller.ts  menu / playing / save-name state machine (no ACP)
src/render.ts      engine text → Markdown
src/catalog.ts     game discovery and titles
src/saves.ts       save store
games/             bundled game databases
test/              end-to-end tests over a real ACP stdio connection
```

`npm test` builds and runs the tests.

## Licence

The code is MIT licensed. The bundled game databases keep their owners' rights; they are included for private use.
