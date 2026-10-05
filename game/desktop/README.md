# Desktop shell (Electron)

Wraps the built game (`dist/`) as a native app for **macOS arm64**, **Linux
x86_64** and **Windows x64**. The renderer is platform-neutral: it fetches all
DW:U data/art by URL under `/assets/dwu/…`, which `main.cjs` maps to your
Distant Worlds: Universe install folder via the privileged `dwu://` scheme.
Nothing from the original game ships with the app.

## How it works

- `desktop/main.cjs` registers a privileged custom scheme `dwu://` before
  app ready. `dwu://app/…` serves `dist/`; `dwu://app/assets/dwu/<path>`
  resolves `<path>` inside your DW:U install dir (case-insensitively, since
  the original is a Windows game; `desktop/resolvePath.cjs`) and streams the
  file with `net.fetch(pathToFileURL(...))`. Path traversal is blocked: every
  URL segment must name an existing entry (so no `..`, `\`, `:` or drive
  letters), and the resolved path must stay inside the install root (compared
  case-insensitively on Windows). PNG/JPEG art is read whole and served
  without its embedded colour profile (iCCP/sRGB/gAMA/cHRM chunks, JPEG ICC
  segments; `desktop/colorProfile.cjs`, shared with the Vite dev server), so
  the renderer decodes raw values like the original's GDI+ load.
- Install listings, built at runtime: the browser cannot list folders, so the
  game reads `asset-manifest.json` (image/data folder listings,
  `desktop/assetManifest.cjs`) and `theme-manifest/index.json` +
  `theme-manifest/<set>.json` (the `Customization/` themes and each one's file
  index, `desktop/themeIndex.cjs`). The shell builds both from YOUR install
  when it starts and whenever the folder changes (a few hundred ms at most)
  and serves them from memory; `dist/` has no copy. Under `npm run dev` the
  same modules produce them (`scripts/gen-asset-manifest.mjs`, the
  theme-manifest middleware in `vite.config.ts`), so dev and desktop answer
  identically.
- Install dir discovery (`desktop/installDir.cjs`): `$DWU_DIR` (not saved;
  used by `scripts/desktop-check.mjs`) → `<userData>/config.json`
  (`"installDir"`) → the usual places, saved when found:
  - Windows: every Steam library (the Steam root from the registry,
    `HKCU\Software\Valve\Steam` `SteamPath`, then
    `HKLM\SOFTWARE\WOW6432Node\Valve\Steam` `InstallPath`, and
    `C:\Program Files (x86)\Steam`, plus each library listed in
    `steamapps\libraryfolders.vdf`, i.e. other drives), then
    `Matrix Games` / GOG / `C:\Games` folders;
  - macOS: Steam's libraries, the Steam libraries inside every Whisky and
    CrossOver bottle, `~/Games/Distant Worlds Universe`;
  - Linux: every Steam root (`$XDG_DATA_HOME/Steam`, `~/.local/share/Steam`,
    `~/.steam/steam`, `~/Steam`, Flatpak, Snap) and its
    `libraryfolders.vdf` libraries, the default Wine prefix,
    `~/Games/Distant Worlds Universe`.

  A valid folder has an `images/` folder and `races.txt` (any letter case).
- Setup window (`desktop/setup.html` + `setupPreload.cjs`, sandboxed, IPC
  only to the main process): shown when no install is found (or the saved one
  is gone). It explains what is needed and where to find it per OS (on macOS:
  Steam inside Whisky/CrossOver, or a copy from a PC), validates a typed or
  chosen folder live, accepts a pick one or more levels too high (the Steam
  library, `steamapps` or `common` folder: the game folder inside is used),
  saves the choice, and offers "Continue Without" (generated placeholder art)
  or Quit. Reopen it later with **Game Folder…**: on macOS in the app menu,
  on Windows/Linux (no menu bar) in the menu that **Ctrl+Shift+O** pops up
  (the game never sees that key). Changing the folder reloads the game.
- Update check (`desktop/updateCheck.cjs`): packaged apps ask the GitHub
  Releases API (`/repos/<repo>/releases/latest`; `<repo>` from the packaged
  `package.json`, i.e. the repository the release was built in) at most once
  a day, 8 s after the game window shows. If that release is newer than the
  running version (semver), a dialog offers **Download** (opens this
  platform's installer from the release in the browser: the `.dmg`, the
  AppImage when running from one, else the `.tar.gz`, the setup `.exe` when
  installed by it, else the `.zip`), **Later** or **Skip This Version**.
  Pre-releases are never offered (GitHub's "latest" excludes them). **Check
  for Updates…** in the same menu checks now. There is no silent
  self-update: the apps are unsigned, and Squirrel.Mac (Electron's macOS
  updater) refuses unsigned updates, so every platform gets the same prompt.
  `config.json` keeps `lastUpdateCheck` and `skippedVersion`;
  `"checkForUpdates": false` turns the daily check off, as does
  `DWU_UPDATE_CHECK=0`; `DWU_UPDATE_URL` points the check at another API URL
  (tests). Unpackaged runs never check on their own.
- Window: 1600×900 (min 1280×720), title "Distant Worlds: Universe", black
  background, no menu bar on Windows/Linux, the standard app menu (plus
  **Game Folder…** / **Check for Updates…**) on macOS. F11 toggles
  fullscreen. One instance per profile: a second launch focuses the running
  window. Renderer runs sandboxed (`contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: true`); the game window's preload
  (`gamePreload.cjs`) exposes only the update check and the sim process.
- Sim process (`desktop/simProcess.cjs`, `simPreload.cjs`, `sim.html`; docs/sim-worker.md §4.7): the game's
  simulation worker runs in a hidden window of its own, i.e. its own renderer process and its own V8 heap cage
  (with pointer compression all isolates of one process share ~4 GB). The game page asks for it, the shell opens
  the window on `dwu://app/sim.html` (same session, so the same `dwu://` handler and Blob registry) and hands a
  `MessageChannelMain` port to each page. Its end (crash, kill, out of memory) is reported to the game page,
  which offers its Restart prompt, and logged to `crash-log.txt` with its memory; it is killed when the game page
  reloads, crashes or closes. `?simProcess=0` runs the worker inside the game page's process instead.
- Icon: the window/dock icon comes from your DW:U install at runtime
  (`images/ui/chrome/galaxy_Icon.png`, then `DesktopIcon.ico`), else the
  app's own icon. That own icon (a ringed planet, drawn procedurally by
  `scripts/make-icon.mjs` at packaging time; nothing binary is committed) is
  also the app bundle / exe / AppImage icon, so Finder, Explorer and launchers
  show it before the first launch.
- Profile folder (config.json, saves): `%APPDATA%\Distant Worlds Universe`,
  `~/Library/Application Support/Distant Worlds Universe`,
  `~/.config/Distant Worlds Universe` (named after the packaged
  `productName`, kept stable so updates keep settings and saves).

## Prerequisites

- Node.js + npm. Run `npm install` first.
- Your Distant Worlds: Universe install (the Steam folder containing
  `images/`, `*.txt` data files, etc.), only to run the app: building and
  packaging never read it.

## Run in development

```sh
npm run desktop:dev   # builds dist/, then launches electron desktop/main.cjs
```

(Plain `npm run dev` still works in the browser: Vite serves the
`public/assets/dwu` symlink created by `npm run import-assets`.)

## Package

```sh
npm run package:linux   # -> release/dwu-linux-x64/
npm run package:mac     # -> release/dwu-darwin-arm64/ (cross-buildable from Linux)
npm run package:win     # -> release/dwu-win32-x64/   (cross-buildable from Linux, no Wine needed)
npm run dist:linux      # also release/upload/openDWU-<v>-linux-x64.AppImage + .tar.gz
npm run dist:win        # also release/upload/openDWU-<v>-windows-x64-setup.exe + .zip
npm run dist:mac        # also release/upload/openDWU-<v>-macos-arm64.dmg (Mac only)
```

All run `scripts/package-desktop.mjs`, which builds `dist/` and then runs
`@electron/packager` on a minimal stage dir (`release/stage/`: just
`desktop/*.cjs` + `setup.html` and a small `package.json` with the version
of `game/package.json` — no node_modules, so the output is a few hundred MB
instead of ~3.5 GB). The built game is attached as an extra resource at
`resources/dwu-dist/`, where the packaged `main.cjs` loads it from, next to
`resources/icon.png`; the app has no runtime deps beyond pixi.js, which is
bundled into `dist/`.

Original-file guards: `dist/` may only hold the game code, the repo's
`scenarios/` and our own `public/art/` (each byte-identical to the repo's);
no packaged file may be an install listing; and when an install is reachable
on the machine (`public/assets/dwu` or `$DWU_DIR`), every packaged file is
compared byte for byte against it. Any hit fails the packaging.

`--installers` (`dist:*`, `scripts/desktop-installers.mjs`) wraps the
packaged folder: the tar.gz / zip with tar / 7-Zip (Windows' own bsdtar on
Windows), the macOS `.dmg` with `hdiutil` (dwu.app, an Applications link,
"Read Me First.txt"), and the AppImage and NSIS installer with
electron-builder in its `--prepackaged` mode, so the installers contain
exactly the app that `desktop-check.mjs` tests. electron-builder is pinned
with its own lockfile in `scripts/installer-tools/` (installed there on first
use) so playing/developing (`npm ci`) does not download it. Each installer
gets a `.sha256` next to it. The NSIS installer installs per user (no
administrator rights) to `%LOCALAPPDATA%\Programs\dwu` with Start menu and
desktop shortcuts named openDWU and an uninstaller; installing a newer one
replaces the old version in place.

Release builds run on GitHub Actions when a release is published
(`.github/workflows/desktop.yml`); see [`../../RELEASING.md`](../../RELEASING.md).

### Linux

Run the packaged binary directly:

```sh
release/dwu-linux-x64/dwu
```

Headless check of the packaged app (needs `kwin_wayland`; Electron's
`--ozone-platform=headless` segfaults here):

```sh
npm run package:linux
node scripts/desktop-check.mjs               # add --compare-dev to diff against the Vite dev server
node scripts/desktop-check.mjs --app=release/upload/openDWU-0.1.0-linux-x64.AppImage   # the AppImage (after dist:linux)
```

It starts `kwin_wayland --virtual` on a private socket, runs the package with
`--ozone-platform=wayland --remote-debugging-port=9333` and `DWU_DIR` set,
drives it over CDP (main menu → `?autostart=1&simWorker=0` game → unpause →
bottom-right system map → F5 / F8 / V / Construction Yards / G screens → stripped
colour-profile art byte-compared against `colorProfile.cjs` → the runtime
`asset-manifest.json` / `theme-manifest/` compared with the shared builders →
`?simWorker=1`, which must load the module sim worker `assets/worker-*.js` over
`dwu://` and advance the replica clock) and saves 1920×1080 captures to
`shots/pkg-*.png`. Then two short launches each: the first-run setup window
with an empty `$HOME` (refuses a wrong folder, accepts the install's parent
folder, saves it, opens the game; the next launch remembers it), and the
update check against a local fake GitHub API (offers this platform's download,
records the check, does not ask again within a day). It fails on page/console
errors and on any `/assets/dwu/` request that does not go through `dwu://` or
fails; 404s for optional files the install lacks (e.g.
`designTemplates/<race>/pirate/planetdestroyer.txt`) are listed but tolerated.
`--skip-game`, `--skip-setup`, `--skip-update` leave a phase out.

### Windows

`npm run package:win` / `dist:win` work on Linux too (packager edits the exe
with resedit; electron-builder's NSIS runs natively; the zip needs `7z`). The
Windows code paths (registry and `libraryfolders.vdf` discovery,
backslash/drive-letter paths in the `dwu://` handler) are unit-tested with
`path.win32` in `test/desktopShell.test.ts`. For a smoke test on Linux, the
Windows build also runs under Wine (11.x):
`wine dwu.exe --no-sandbox --disable-gpu --remote-debugging-port=9444` on a
Wayland compositor (e.g. `kwin_wayland --virtual`), with `DWU_DIR` as a
`Z:\...` path; the setup installer runs with `/S` (add
`WINEDLLOVERRIDES=powershell.exe=d`: Wine's PowerShell stub makes the
installer think the app is running).

### macOS

`npm run package:mac` on a Mac signs the app ad hoc (`codesign --force --deep
-s -`; no Apple Developer ID). Built on Linux it is unsigned: transfer
`release/dwu-darwin-arm64/` as an archive (Electron Framework relies on
symlinks, which `scp -r` / plain copies flatten), then re-sign the `.app` ad
hoc on the Mac, because arm64 macOS refuses to run unsigned code:

```sh
tar czf dwu-darwin-arm64.tgz -C release dwu-darwin-arm64    # on Linux
tar xzf dwu-darwin-arm64.tgz                                 # on the Mac
xattr -cr dwu-darwin-arm64/dwu.app
codesign --force --deep -s - dwu-darwin-arm64/dwu.app
open dwu-darwin-arm64/dwu.app
```

If Gatekeeper still complains (e.g. after transferring over the network, or
for a downloaded release):

```sh
xattr -dr com.apple.quarantine dwu-darwin-arm64/dwu.app
```
