# openDWU — Distant Worlds: Universe recreation

A faithful recreation of *Distant Worlds: Universe* (v1.9.5) in TypeScript
and PixiJS, ported directly from the game's decompiled engine source
(formulas, constants, generation order and RNG sequence), with an opt-in
mod/scenario layer on top. The code lives under [`game/`](game/).

**You need your own copy of the original game's data files.** This
repository ships no original art, sounds, data or decompiled source; the
game reads them at runtime from a Distant Worlds: Universe install folder,
either your Steam install or a clone of the private `jfj-oss/dwu-assets`
repo (only if you have been given access).

**Jump to your platform:** [Windows](#windows) · [macOS](#macos) · [Linux](#linux) · [Troubleshooting](#troubleshooting) · [Tests](#tests) · [About the project](#about-the-project)

Each platform section is self-contained: install the prerequisites, get and
link the game data, clone, run, optionally build the desktop app, and update.
You need **Node.js 22.12 or newer** (Node 24 LTS is fine) and **git**.

---

## Windows

Run all commands in **PowerShell** (Start menu → "PowerShell").

**1. Install Node.js and git**

```powershell
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Git.Git -e
```

Close and reopen PowerShell so `node` and `git` are on your PATH, then check:

```powershell
node -v    # must print v22.12 or newer
git --version
```

**2. Clone openDWU and install dependencies**

```powershell
cd $HOME
git clone https://github.com/jfj-oss/openDWU.git
cd openDWU\game
npm ci
```

**3. Link the game data**

`npm run import-assets` is a bash script and does **not** work on Windows.
Create a directory junction instead (no administrator rights or Developer
Mode needed). Run this from `openDWU\game`, changing the path if your Steam
library is somewhere else (e.g. `D:\SteamLibrary\steamapps\common\Distant Worlds Universe`):

```powershell
$DwuDir = "C:\Program Files (x86)\Steam\steamapps\common\Distant Worlds Universe"
New-Item -ItemType Directory -Force public\assets | Out-Null
New-Item -ItemType Junction -Path public\assets\dwu -Target $DwuDir
```

The folder must contain an `images` subfolder. Nothing is copied; the
junction just points at your install. If you use the private assets repo
instead of Steam, clone it and point the junction at the clone:

```powershell
git clone https://github.com/jfj-oss/dwu-assets.git $HOME\dwu-assets
New-Item -ItemType Directory -Force public\assets | Out-Null
New-Item -ItemType Junction -Path public\assets\dwu -Target $HOME\dwu-assets
```

**4. Run the game**

```powershell
npm run dev
```

Open the URL it prints (normally <http://localhost:5173/>) in your browser.
Windows Firewall may ask about Node.js because the dev server also listens
on your local network; allowing "Private networks" is enough. Stop the
server with `Ctrl+C`.

**5. Desktop app**

Not available on Windows: desktop packaging only supports macOS arm64 and
Linux x86_64. Play in the browser (step 4).

**6. Update to the latest version**

From `openDWU\game`, with the dev server stopped:

```powershell
git pull
npm ci
npm run dev
```

The junction from step 3 is kept across updates. If you use the assets
repo, also run `git -C $HOME\dwu-assets pull`.

---

## macOS

Run all commands in **Terminal** (zsh, the default shell).

**1. Install Node.js and git**

Install [Homebrew](https://brew.sh) if you don't have it:

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

On Apple Silicon (M1 and later), Homebrew installs to `/opt/homebrew`; if
`brew` is "command not found" afterwards, run the two `echo`/`eval` lines
the installer prints under "Next steps", or:

```sh
eval "$(/opt/homebrew/bin/brew shellenv)"
```

Then:

```sh
brew install node git
node -v    # must print v22.12 or newer
```

**2. Get the game data**

There is no native macOS version of Distant Worlds: Universe, so use one of:

- **The private assets repo** (if you have access; git asks for your GitHub
  credentials):

  ```sh
  git clone https://github.com/jfj-oss/dwu-assets.git ~/dwu-assets
  ```

- **A copy of a Windows or Linux install:** copy the whole
  `Distant Worlds Universe` folder (the one containing `images/`) to
  `~/Games/Distant Worlds Universe`.

**3. Clone openDWU, install dependencies and link the data**

```sh
cd ~
git clone https://github.com/jfj-oss/openDWU.git
cd openDWU/game
npm ci
```

`import-assets` has no macOS default path, so always pass `DWU_DIR`.
Use the line that matches step 2:

```sh
DWU_DIR="$HOME/dwu-assets" npm run import-assets
```

```sh
DWU_DIR="$HOME/Games/Distant Worlds Universe" npm run import-assets
```

It prints `linked ... -> public/assets/dwu` (a symlink; nothing is copied).

**4. Run the game**

```sh
npm run dev
```

Open the URL it prints (normally <http://localhost:5173/>). Stop it with `Ctrl+C`.

**5. Optional: native desktop app (Apple Silicon only)**

```sh
npm run package:mac
open release/dwu-darwin-arm64/dwu.app
```

If macOS refuses to open it ("damaged" or "unidentified developer"),
re-sign it ad hoc and clear the quarantine flag:

```sh
xattr -cr release/dwu-darwin-arm64/dwu.app
codesign --force --deep -s - release/dwu-darwin-arm64/dwu.app
```

On first launch the app looks for the game data in
`~/Library/Application Support/Steam/steamapps/common/Distant Worlds Universe`
and `~/Games/Distant Worlds Universe`, otherwise it asks you to pick the
folder (pick `~/dwu-assets` if you use the assets repo). Intel Macs: use the
browser version; there is no Intel package script. See
[`game/desktop/README.md`](game/desktop/README.md) for details.

**6. Update to the latest version**

From `~/openDWU/game`, with the dev server stopped:

```sh
git pull
npm ci
npm run dev
```

If you use the assets repo, also run `git -C ~/dwu-assets pull`.

---

## Linux

Run all commands in a terminal (bash).

**1. Install Node.js and git**

Arch / CachyOS / Manjaro:

```bash
sudo pacman -S --needed nodejs npm git
```

Debian / Ubuntu (the distro's Node is usually too old; this uses NodeSource's Node 22):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

Fedora:

```bash
sudo dnf install nodejs npm git
```

Check the version:

```bash
node -v    # must print v22.12 or newer
```

**2. Get the game data**

If DW:U is installed through Steam at the default location,
`~/.local/share/Steam/steamapps/common/Distant Worlds Universe`, there is
nothing to do here. Otherwise note where your copy is (another Steam
library, Flatpak Steam at
`~/.var/app/com.valvesoftware.Steam/.local/share/Steam/steamapps/common/Distant Worlds Universe`),
or clone the private assets repo if you have access:

```bash
git clone https://github.com/jfj-oss/dwu-assets.git ~/dwu-assets
```

**3. Clone openDWU, install dependencies and link the data**

```bash
cd ~
git clone https://github.com/jfj-oss/openDWU.git
cd openDWU/game
npm ci
```

Default Steam location:

```bash
npm run import-assets
```

Anywhere else (e.g. the assets repo):

```bash
DWU_DIR="$HOME/dwu-assets" npm run import-assets
```

It prints `linked ... -> public/assets/dwu` (a symlink; nothing is copied).

**4. Run the game**

```bash
npm run dev
```

Open the URL it prints (normally <http://localhost:5173/>). Stop it with `Ctrl+C`.

**5. Optional: native desktop app (x86_64)**

```bash
npm run package:linux
release/dwu-linux-x64/dwu
```

The app finds the data via `$DWU_DIR`, then the Steam default paths
(`~/.local/share/Steam/...` and `~/Steam/...`), otherwise it asks you to
pick the folder. You can also build the macOS app from Linux with
`npm run package:mac`; see [`game/desktop/README.md`](game/desktop/README.md)
for transferring and re-signing it.

**6. Update to the latest version**

From `~/openDWU/game`, with the dev server stopped:

```bash
git pull
npm ci
npm run dev
```

If you use the assets repo, also run `git -C ~/dwu-assets pull`.

---

## Troubleshooting

- **Planets, ships and UI show plain generated placeholder art.** The game
  data isn't linked. Redo step 3 for your platform, then restart
  `npm run dev` (it regenerates `public/asset-manifest.json` from the linked
  folder on every start; the file list is not picked up while the server is
  running).
- **`DW:U install not found at ...`** (macOS/Linux). The path passed to
  `import-assets` has no `images/` folder. Check the path and its quoting.
  The script's default is the Linux Steam path, so macOS always needs `DWU_DIR`.
- **`New-Item : An item with the specified name ... already exists`** (Windows).
  Remove the old link first with `cmd /c rmdir public\assets\dwu` (this
  removes only the junction, not your game files), then rerun step 3.
- **`npm ci` reports `EBADENGINE`, or Vite/Vitest fail with syntax errors.**
  Your Node is too old; install Node 22.12 or newer and run `npm ci` again.
- **Port 5173 is already in use.** Vite picks the next free port
  (5174, ...) automatically; open the URL it prints.
- **`npm run import-assets` fails on Windows.** Expected; it is a bash
  script. Use the junction from the [Windows](#windows) step 3.
- **`npm run test:fast` / `test:slow` fail on Windows.** They set an
  environment variable with bash syntax; see [Tests](#tests).

## Tests

Run from `game/`:

```sh
npm run test:fast          # everything except the slow soak tests, for iterating
npm test                   # the full test suite
npm run repin -- --check   # verify the seed-pinned ("golden pin") values are still up to date
npm run typecheck
```

On Windows PowerShell, run the fast tier as
`$env:DWU_TEST_TIER = "fast"; npx vitest run` (and
`Remove-Item Env:DWU_TEST_TIER` afterwards); `npm test` works as is.

---

## About the project

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

### Scenarios and mods

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

### Optional: local LLM layer

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

### Project layout

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

For running the desktop shell in development (`npm run desktop:dev`) see
[`game/README.md`](game/README.md) and [`game/desktop/README.md`](game/desktop/README.md).

### Status

There is no fixed release; the project is under continuous development on
the default branch, `main`. See [`game/tasks/`](game/tasks/) for the
implementation plan, current status and design notes —
`game/tasks/19-mod-layer-scenarios.md` in particular tracks the
scenario/mod layer, and `game/tasks/M4-deferred-plan.md` tracks deferred
core-engine work.

### Licence / assets note

This repository contains no original *Distant Worlds: Universe* art, sound,
data files or decompiled source; none of it is redistributed here. The game
reads those files live from your own install folder at runtime. Art under
`game/public/art/` is original artwork created for this project (procedural
code and our own generated sprites), not from the original game.
