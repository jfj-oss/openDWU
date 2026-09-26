# DWU — Distant Worlds: Universe recreation

A faithful recreation of *Distant Worlds: Universe* (v1.9.5) in TypeScript,
PixiJS 8 and Electron. The Main View is one seamless map: you scroll
continuously from the whole galaxy down to a single planet, with no hard
screen switch between the galaxy map and the system map.

This is a code-only project. It ships **no** game art, sounds, data files or
decompiled source — nothing copyrighted is in this repository. To run it you
need your own legitimate install of *Distant Worlds: Universe* on Steam; the
game reads its art and data live from that install folder at
`/assets/dwu/…`.

## Requirements

- **Node.js 20+** and npm (no version is pinned in `package.json`; this repo
  is developed and tested with Node 22).
- **Distant Worlds: Universe**, owned and installed via Steam. Default
  install paths:
  - Linux: `~/.local/share/Steam/steamapps/common/Distant Worlds Universe`
  - macOS: `~/Library/Application Support/Steam/steamapps/common/Distant Worlds Universe`
- For the desktop build: **Electron** (installed automatically as a dev
  dependency by `npm install`; no separate download needed).

## Run in the browser (development)

```sh
npm install
npm run import-assets          # links your DW:U install into public/assets/dwu
npm run dev                    # starts the Vite dev server
```

If your install isn't at the default path, point at it explicitly:

```sh
DWU_DIR=/path/to/Distant\ Worlds\ Universe npm run import-assets
```

Open the URL `npm run dev` prints (typically `http://localhost:5173/`). Add
`?autostart=1` to the URL to skip the new-game wizard and jump straight into
a quick game, e.g. `http://localhost:5173/?autostart=1`.

## Desktop app (Electron)

Development:

```sh
npm run desktop:dev            # builds dist/, then launches electron desktop/main.cjs
```

The desktop shell finds your DW:U install the same way as the browser build
(`$DWU_DIR`, then a saved config, then platform default guesses, then an
open-directory dialog). Packaging bakes in the install's file list, so set
`DWU_DIR` (or run `npm run import-assets` once) before `npm run package:*`.

### Packaging

```sh
npm run package:linux          # -> release/dwu-linux-x64/
npm run package:mac            # -> release/dwu-darwin-arm64/ (cross-buildable from Linux)
```

Both run `scripts/package-desktop.mjs`, which builds the game and packages a
minimal stage directory (no `node_modules`, so the output is a few hundred
MB rather than ~3.5 GB). On Linux, run the packaged binary directly:

```sh
release/dwu-linux-x64/dwu
```

**macOS:** the packaged app is unsigned (packaging cross-platform from Linux
leaves the binaries unsigned, and arm64 macOS refuses to run unsigned code
untouched). Transfer it as a tarball (plain copies/`scp -r` flatten the
Electron Framework's symlinks), then re-sign it ad hoc on the Mac:

```sh
tar czf dwu-darwin-arm64.tgz -C release dwu-darwin-arm64    # on Linux
tar xzf dwu-darwin-arm64.tgz                                 # on the Mac
xattr -cr dwu-darwin-arm64/dwu.app
codesign --force --deep -s - dwu-darwin-arm64/dwu.app
open dwu-darwin-arm64/dwu.app
```

If Gatekeeper still complains (e.g. after transferring over the network),
also run `xattr -dr com.apple.quarantine dwu-darwin-arm64/dwu.app`.

See `desktop/README.md` for how the `dwu://` asset scheme and install-folder
discovery work.

## Controls cheat sheet

Press **`?`** in-game any time for the full, live keyboard-shortcuts overlay
(it also flags anything not yet wired up). Highlights:

**Screens**
- `F1` Galactopedia / Help — `F2` Colonies — `F3` Expansion Planner —
  `F4` Intelligence Agents — `F5` Diplomacy — `F6` Empire Summary —
  `F7` Research — `F8` Ship Designs — `F9` Build Order —
  `F10` Construction Yards — `F11` Ships and Bases — `F12` Fleets
- `G` Galaxy Map — `H` Message History — `V` Empire Comparison / Victory
  Conditions — `O` Game Options

**View / camera**
- Arrow keys scroll — `PageUp`/`PageDown` zoom out/in — `Home`/`Insert`/
  `Delete`/`End` jump to Planet/System/Sector/Galaxy zoom — `Backspace`
  zooms to the current selection — `L` locks the view on the selection

**Selection cyclers** (`C` colonies, `P` space ports, `M` military ships,
`Y` construction ships, `X` exploration/colony ships, `F` fleets, `I` idle
ships) — plain cycles forward, `Shift` cycles backward, `Ctrl` cycles and
moves the view. `N`/`B` step forward/back through selection history; `Z`
selects the nearest military ship.

**Ship orders** (act on the current selection): `E` Escape, `R` Refuel,
`A` Automate, `S` Stop, `,` cycle engagement stance.

**Game**
- `Space` or `Pause` pauses/resumes — `+`/`-` change game speed —
  `Escape` opens the Game menu — `T` talk to your fleet admiral (advisor
  chat; needs a local model server, see below) — `?` toggles this shortcuts
  overlay.

## Optional: local AI features (off by default)

Two features can use a small local language model over an OpenAI/Ollama-
compatible HTTP endpoint. Both are inert unless that endpoint answers, and
neither is required to play:

- **Advisor chat** (`T`): talk to your fleet admiral, who can issue move /
  attack / refuel orders on your behalf.
- **AI diplomat voice**: AI empires' diplomatic replies are rewritten in
  character by the model (the sim's own logic still decides the outcome).

To enable them, install [Ollama](https://ollama.com) and pull the default
model:

```sh
ollama serve
ollama pull qwen3:4b
```

The game looks for the model server at `http://127.0.0.1:11434` (Ollama's
default port) using model name `qwen3:4b` — see `advisorEndpoint` /
`advisorModel` in `src/ui/settings.ts` if you need to point at a different
endpoint or model. With Ollama running, opening the advisor chat (`T`) or
starting a diplomatic conversation will automatically pick it up.

See `game/tasks/18-local-llm-diplomacy.md` for the design behind these
features (the model never runs inside the simulation tick; it only proposes
commands that the ported game rules validate and execute).

## Tests

- `npm run test:fast` — the fast test suite (everything except the slow
  soak tests), for iterating.
- `npm test` — the full test suite.
- `npm run smoke` — an end-to-end smoke test that drives the app through
  the main menu, a new game and basic play in a real browser.
- `npm run repin -- --check` — verifies the seed-pinned test values are
  still up to date (fails if any would change).

## Reporting bugs

If you find a bug while playing, write it up as a dated playtest report
under `game/tasks/` following the existing `PLAYTEST-YYYY-MM-DD.md` format
(see `game/tasks/PLAYTEST-2026-09-25.md` and
`game/tasks/PLAYTEST-2026-09-25-b.md` for examples): what you did to
reproduce it, a severity (crash / wrong data / visual / polish), and
screenshots/evidence where possible.
