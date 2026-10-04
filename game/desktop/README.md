# Desktop shell (Electron)

Wraps the built game (`dist/`) as a native app for **macOS arm64** and
**Linux x86_64**. The renderer is platform-neutral: it fetches all DW:U
data/art by URL under `/assets/dwu/…`, which `main.cjs` maps to your Distant
Worlds: Universe install folder via the privileged `dwu://` scheme.

## How it works

- `desktop/main.cjs` registers a privileged custom scheme `dwu://` before
  app ready. `dwu://app/…` serves `dist/`; `dwu://app/assets/dwu/<path>`
  resolves `<path>` inside your DW:U install dir (case-insensitively, since
  the original is a Windows game) and streams the file with
  `net.fetch(pathToFileURL(...))`. Path traversal is blocked: the resolved
  path must stay inside the install root. PNG/JPEG art is read whole and
  served without its embedded colour profile (iCCP/sRGB/gAMA/cHRM chunks,
  JPEG ICC segments; `desktop/colorProfile.cjs`, shared with the Vite dev
  server), so the renderer decodes raw values like the original's GDI+ load.
- Install dir discovery: `$DWU_DIR` (not saved; used by
  `scripts/desktop-check.mjs`) → `<userData>/config.json`
  (`{"installDir": "..."}`) → platform default guesses (Steam library paths, `~/Games/...` on macOS)
  → an open-directory dialog titled "Locate your Distant Worlds: Universe
  folder". A valid folder must contain an `images/` subfolder; the choice is
  saved back to `config.json`. If you cancel, the game still launches with
  generated fallback textures instead of the original art.
- Window: 1600×900 (min 1280×720), title "Distant Worlds: Universe", black
  background, no menu bar on Linux, standard app menu on macOS. F11 or
  Ctrl/Cmd+F toggles fullscreen. Renderer runs sandboxed
  (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`).
- Icon: original art can't be committed to the repo, so the window/dock icon
  is loaded at runtime from your DW:U install folder —
  `images/ui/chrome/galaxy_Icon.png` first, then `DesktopIcon.ico` (resolved
  case-insensitively). If neither exists (or you skipped locating the install
  folder), Electron's default icon is used instead. Packaged builds therefore
  show the default Electron icon in the file manager / Dock before first
  launch, and switch to the game icon once running with an install folder
  configured.

## Prerequisites

- Node.js + npm. Run `npm install` first.
- Your Distant Worlds: Universe install (the Steam folder containing
  `images/`, `*.txt` data files, etc.). On Linux that is usually
  `~/.local/share/Steam/steamapps/common/Distant Worlds Universe`.

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
```

Both run `scripts/package-desktop.mjs`, which builds `dist/` and then runs
`@electron/packager` on a minimal stage dir (`release/stage/`: just
`desktop/` plus a small `package.json` — no node_modules, so the output is a
few hundred MB instead of ~3.5 GB). The built game is attached as an extra
resource at `resources/dwu-dist/`, where the packaged `main.cjs` loads it
from; the app has no runtime deps beyond pixi.js, which is bundled into
`dist/`.

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
```

It starts `kwin_wayland --virtual` on a private socket, runs the package with
`--ozone-platform=wayland --remote-debugging-port=9333` and `DWU_DIR` set,
drives it over CDP (main menu → `?autostart=1&simWorker=0` game → unpause →
bottom-right system map → F5 / F8 / V / Construction Yards / G screens → stripped
colour-profile art byte-compared against `colorProfile.cjs` → `?simWorker=1`, which
must load the module sim worker `assets/worker-*.js` over `dwu://` and advance the
replica clock) and saves 1920×1080 captures to `shots/pkg-*.png`. It fails on page/console
errors and on any `/assets/dwu/` request that does not go through `dwu://` or
fails; 404s for optional files the install lacks (e.g.
`designTemplates/<race>/pirate/planetdestroyer.txt`) are listed but tolerated.

### macOS

Transfer `release/dwu-darwin-arm64/` as an archive (Electron Framework
relies on symlinks, which `scp -r` / plain copies flatten), then re-sign the
`.app` ad-hoc on the Mac, because packaging on another platform leaves the
binaries unsigned (arm64 macOS refuses to run unsigned code):

```sh
tar czf dwu-darwin-arm64.tgz -C release dwu-darwin-arm64    # on Linux
tar xzf dwu-darwin-arm64.tgz                                 # on the Mac
xattr -cr dwu-darwin-arm64/dwu.app
codesign --force --deep -s - dwu-darwin-arm64/dwu.app
open dwu-darwin-arm64/dwu.app
```

If Gatekeeper still complains (e.g. after transferring over the network):

```sh
xattr -dr com.apple.quarantine dwu-darwin-arm64/dwu.app
```