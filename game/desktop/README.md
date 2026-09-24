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
  path must stay inside the install root.
- Install dir discovery: `<userData>/config.json` (`{"installDir": "..."}`)
  → platform default guesses (Steam library paths, `~/Games/...` on macOS)
  → an open-directory dialog titled "Locate your Distant Worlds: Universe
  folder". A valid folder must contain an `images/` subfolder; the choice is
  saved back to `config.json`. If you cancel, the game still launches with
  generated fallback textures instead of the original art.
- Window: 1600×900 (min 1280×720), title "Distant Worlds: Universe", black
  background, no menu bar on Linux, standard app menu on macOS. F11 or
  Ctrl/Cmd+F toggles fullscreen. Renderer runs sandboxed
  (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`).

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

Headless smoke test (needs xvfb-run):

```sh
timeout 20 xvfb-run -a release/dwu-linux-x64/dwu --no-sandbox
```

(`--no-sandbox` is only needed when running as root / without user namespaces.)

### macOS

Copy `release/dwu-darwin-arm64/` to the Mac and re-sign ad-hoc, because
packaging on another platform leaves the binaries unsigned/quarantined:

```sh
xattr -cr dwu-darwin-arm64
codesign --force --deep -s - dwu-darwin-arm64
open dwu-darwin-arm64
```

If Gatekeeper still complains (e.g. after transferring over the network):

```sh
xattr -dr com.apple.quarantine dwu-darwin-arm64
```