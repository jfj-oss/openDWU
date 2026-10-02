# DWU — Distant Worlds: Universe recreation

A faithful recreation of *Distant Worlds: Universe* (v1.9.5) in TypeScript
and PixiJS, ported directly from the game's decompiled engine source
(formulas, constants, generation order and RNG sequence), with an opt-in
mod/scenario layer on top. The implementation lives under [`game/`](game/).

- **Faithful port.** Game logic in `game/src/sim/` is ported line-for-line
  where practical from the original C# engine — same formulas, same order of
  operations, same seeded `System.Random` sequence — and cross-checked
  against the original data files (`races.txt`, `resources.txt`, `Policy/`,
  `designTemplates/`, …).
- **Deterministic simulation.** The sim is a headless model (no DOM/Pixi
  imports) that is fully determined by a seed plus the sequence of player
  commands: a saved seed and command log reproduce an identical game byte
  for byte, including under a real-time driver with irregular frames, pauses
  and skewed wall clocks (`game/test/commandReplay.test.ts`).
- **Golden pins.** Thousands of seed-dependent values (galaxy generation,
  empire stats, combat outcomes, …) are pinned against recorded output in
  `game/test/pins/seed1.json` and checked on every run; `npm run repin --
  --check` fails if anything would change, so a regression in the port shows
  up immediately.
- **Replay.** Because a game is just a seed plus a command log, any game can
  be replayed deterministically from scratch — the same mechanism the pin
  suite and the determinism tests use.
- **Opt-in mod/scenario layer.** With every scenario off, the game is the
  byte-identical faithful port. A scenario/data overlay adds new factions,
  storylines, systems and behaviour on top, each behind its own feature
  flags — see [Scenarios and mods](#scenarios-and-mods) below.

## Requirements

- **A legal copy of *Distant Worlds: Universe*.** This repository ships no
  original game art, sounds, data files or decompiled source — nothing
  copyrighted from the original game is in this repo. At runtime the game
  reads art and data live from your own install folder. See
  [Point at your Distant Worlds: Universe install](#point-at-your-distant-worlds-universe-install)
  below for where that folder lives, or for the private-repo alternative if
  you don't have the game installed locally.
- **Node.js 22+** and npm.
- **git.**

## Install

### Linux

**Arch / CachyOS:**

```sh
sudo pacman -S nodejs npm git
```

**Debian / Ubuntu** (the distro package is usually too old; use the
NodeSource setup script for Node 22):

```sh
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

### macOS

```sh
brew install node git
```

### Quick start: exact commands

You need a copy of Distant Worlds: Universe for the original art and data. Everything is on the default
branch, `main`.

**Linux (x86_64), game installed through Steam:**

```sh
sudo pacman -S nodejs npm git        # Arch / CachyOS (Debian/Ubuntu: see Node 22 note above)
git clone https://github.com/jfj-oss/Dwureup.git
cd Dwureup/game
npm ci
npm run import-assets                # links ~/.local/share/Steam/steamapps/common/Distant Worlds Universe
npm run dev                          # then open http://localhost:5173/
```

**macOS (Apple Silicon), no Steam copy of the game** (uses the private assets mirror):

```sh
brew install node git
git clone https://github.com/jfj-oss/dwu-assets.git
git clone https://github.com/jfj-oss/Dwureup.git
cd Dwureup/game
npm ci
DWU_DIR="$HOME/dwu-assets" npm run import-assets
npm run dev                          # then open http://localhost:5173/
```

If the game is installed through Steam on the Mac, skip the `dwu-assets` clone and run
`DWU_DIR="$HOME/Library/Application Support/Steam/steamapps/common/Distant Worlds Universe" npm run import-assets`.

**Native desktop app instead of the browser** (from `Dwureup/game`, after the steps above):

```sh
npm run package:linux                # Linux x86_64 -> release/dwu-linux-x64/
npm run package:mac                  # macOS arm64  -> release/dwu-darwin-arm64/
```

**Update to the latest version later** (from `Dwureup/game`):

```sh
git pull
npm ci                               # only needed when dependencies changed; safe to run every time
npm run dev
```

On the Mac, also run `git -C ~/dwu-assets pull` if you use the assets mirror.

#### Point at your Distant Worlds: Universe install

`import-assets` links your DW:U install folder into `public/assets/dwu`
(nothing is copied). The default Steam install paths are:

- Linux: `~/.local/share/Steam/steamapps/common/Distant Worlds Universe`
- macOS: `~/Library/Application Support/Steam/steamapps/common/Distant Worlds Universe`

If your install is at the default path:

```sh
npm run import-assets
```

Otherwise, point `DWU_DIR` at it explicitly:

```sh
DWU_DIR="/path/to/Distant Worlds Universe" npm run import-assets
```

If you don't have the game installed locally (e.g. a cloud/CI machine), and
you have access to the private assets mirror, clone it next to this repo
instead and point `DWU_DIR` at the clone:

```sh
git clone https://github.com/jfj-oss/dwu-assets.git ../../dwu-assets
DWU_DIR="$(realpath ../../dwu-assets)" npm run import-assets
```

#### Play in the browser

```
cd Dwureup/game
git pull
npm ci
npm run dev
```

```sh
npm run dev
```

Open the URL it prints (typically `http://localhost:5173/`).

#### Package the desktop app (Electron)

```sh
npm run package:linux   # -> release/dwu-linux-x64/
npm run package:mac     # -> release/dwu-darwin-arm64/ (cross-buildable from Linux)
```

Run `npm run import-assets` (or set `DWU_DIR`) before packaging — the
packaged app bakes in the install's file list. See
[`game/desktop/README.md`](game/desktop/README.md) for how the app finds
your install folder at runtime, and [`game/README.md`](game/README.md) for
running the desktop shell in development (`npm run desktop:dev`) and the
macOS re-signing steps needed after a cross-platform build.

## Tests

Run from `game/`:

```sh
npm run test:fast       # everything except the slow soak tests, for iterating
npm test                # the full test suite
npm run repin -- --check   # verify the seed-pinned ("golden pin") values are still up to date
```

## Scenarios and mods

With no scenario selected the game is the unmodified, byte-identical
faithful port. Scenarios are chosen on the **Scenario** page of the new-game
wizard (between Victory Conditions and Start): pick "None" for the original
game, or a scenario from the list to see its description and a checkbox per
feature flag plus a number box per tunable parameter. Each scenario is a
data overlay (races/resources/policy/template additions and extra text)
plus code paths gated behind its flags; turning every flag off reproduces
the faithful game exactly, so scenario development never risks the base
port's pins.

Some of the shipped scenarios (see `game/scenarios/*/scenario.json` for the
full list, flags and parameters):

| Scenario | What it adds |
|---|---|
| Rim Frontier | An ion-storm belt, thinning stars, gravity shoals, scarce fuel and sensor fog make the outer rim hard to reach and hold; ordinary empires start inside it. |
| Rim Fauna | Creature herds roam the outer rim far more densely than the core, grazing gas clouds and mining stations and migrating yearly toward settled space. |
| Rim Herders | A rim independent people whose herds are docile to them and defend them; their tamed freighters shrug off storms and their ports are the only steady source of herd goods. |
| The Rim Trade (Concord treasure fleet) | An isolationist rim empire, the Oranthi Concord, holds the galaxy's rarest luxuries and trades them only for rim goods, sailing a visible, raidable treasure fleet on a fixed circuit. |
| Hidden threats (Dark Farms, Grey Tide, The Cult, The Silence, Doppelgangers, The Hive, Time-Bomb Tech, Ghost Armada, The Exchange, Robot Mutiny, Corporate Coup) | End-game story threats that stay dormant until triggered, each with its own hidden facility/flag, spread rule and reveal. |
| Internal Security | One stability ledger per colony/empire (approval, tension, shortages, loyalty) feeding the colony-revolt system, plus lead detection and investigation of hidden threats. |
| Court & Dynasties | Noble houses, a five-seat council, character factions with demands, succession laws and legitimacy. |
| Reputation & Grievances | Every attitude change any scenario package makes becomes a ledger entry with a cause and a decay, feeding diplomacy, war review and peace pricing. |
| Event Log | One typed log of everything that happens in the galaxy, feeding Galactic History, the news ticker and the chronicle. |
| Galactic Council | Once enough empires have met, a yearly vote on sanctions, embargoes and war condemnations; blocs form among the outvoted. |
| War goals & peace terms | Wars fought for stated goals (cede colonies, reparations, demilitarised zones) with terms priced accordingly (part of Lively Galaxy). |
| Frontier Autonomy | Distant colonies drift toward local rule under sector governors as travel time, garrison strength and approval dictate. |
| Big Galaxies | Extended colour palette and UI support for 40–60 empire games on galaxies of up to 4,000 stars. |
| Local LLM Layer | Foundations for the optional local-model layer: request queue, grounding digests and a yearly in-character chronicle. |

## Optional: local LLM layer

Two features can use a small local language model over an OpenAI/Ollama-
compatible HTTP endpoint, and everything else in the scenario layer above
(council speeches, faction voices, a yearly chronicle) can build on the same
foundation:

- **Advisor chat**: talk to your fleet admiral, who can issue orders on your
  behalf.
- **AI diplomat voice**: AI empires' diplomatic replies are rewritten in
  character by the model.

The game looks for a model server at `http://127.0.0.1:11434` (Ollama's
default port) with the default model `qwen3:4b`. **Everything here is off
by default** and inert unless that endpoint answers — nothing requires it to
play. The model never runs inside the simulation tick: it only proposes
commands, which the ported game rules validate and execute like any other
player command, so replay never needs the model and a missing/slow endpoint
never blocks the sim. See `game/tasks/18-local-llm-diplomacy.md` and
`game/tasks/19-mod-layer-scenarios.md` §19s for the design.

## Project layout

```
game/
  src/
    sim/      headless, deterministic game model — no DOM or Pixi imports
    render/   PixiJS rendering
    ui/       HUD, panels, screens
    llm/      optional local-model request queue/client
    audio/    synthesized runtime audio (no audio files are ever committed)
  scenarios/  mod/scenario data overlays + scenario.json manifests
  desktop/    Electron shell (packaging, install-folder discovery)
  scripts/    dev/build/packaging/test-maintenance scripts
  test/       vitest tests, including the seed-pinned ("golden pin") suite
  tasks/      design docs and the implementation plan/status
```

## Status

There is no fixed release; the project is under continuous development.
See [`game/tasks/`](game/tasks/) for the implementation plan, current status
and design notes — `game/tasks/19-mod-layer-scenarios.md` in particular
tracks the scenario/mod layer, and `game/tasks/M4-deferred-plan.md` tracks
deferred core-engine work.

## Licence / assets note

This repository contains no original *Distant Worlds: Universe* art, sound,
data files or decompiled source — none of it is copyrighted-original
content and none of it is redistributed here. The game reads those files
live from your own install folder at runtime. Art under `game/public/art/`
is original artwork created for this project (procedural code and our own
generated sprites), not from the original game.
