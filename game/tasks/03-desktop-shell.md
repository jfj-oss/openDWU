# Task 03 — Native desktop shell (Electron) for macOS arm64 + Linux x86_64

thinking: off

Goal: `desktop/` wraps the built game (`dist/`) as a native app on **macOS arm64** and **Linux x86_64**.

## Requirements
- `desktop/main.cjs` (Electron main process, CommonJS):
  - Registers a privileged custom scheme `dwu://` (standard, secure, supportFetchAPI, corsEnabled, stream) **before** app ready; serves `dist/` from `dwu://app/…` and maps `dwu://app/assets/dwu/<path>` to `<DW:U install dir>/<path>` via `protocol.handle` + `net.fetch(pathToFileURL(...))`. Prevent path traversal (resolved path must stay inside the root).
  - **Case-insensitive path resolution** for the install dir: the original is a Windows game, so references like `images/Environment/...` must resolve on case-sensitive Linux/macOS filesystems. Resolve each path segment against the real directory listing (cache listings).
  - Install dir: read from `<userData>/config.json`; if missing or invalid (no `images/` subfolder), show `dialog.showOpenDialog({properties:['openDirectory']})` titled "Locate your Distant Worlds: Universe folder", validate, save. Default guesses to try first: `~/.local/share/Steam/steamapps/common/Distant Worlds Universe` (Linux), `~/Library/Application Support/Steam/steamapps/common/Distant Worlds Universe` and `~/Games/Distant Worlds Universe` (macOS).
  - Window 1600×900, min 1280×720, title "Distant Worlds: Universe", dark background `#000`, no menu bar on Linux; keep the standard app menu on macOS (Quit ⌘Q). F11 / ⌃⌘F toggles fullscreen.
  - `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- `vite.config.ts`: `base: './'` so `dist/index.html` works under `dwu://app/`. Keep `npm run dev` working in the browser (Vite serves `public/assets/dwu`). **Exclude `public/assets` from the build output** (it is a 4 GB symlink) — e.g. `build.copyPublicDir: false`, or move the symlink handling so it is dev-only.
- Scripts in `package.json`:
  - `desktop:dev` — build then `electron desktop/main.cjs`
  - `package:linux` — `@electron/packager` → `release/dwu-linux-x64/`
  - `package:mac` — `@electron/packager --platform=darwin --arch=arm64` → `release/dwu-darwin-arm64/` (buildable from Linux; the Mac side re-signs ad-hoc with `codesign --force --deep -s -`).
  - Dev deps: `electron`, `@electron/packager`. Add `release/` to `.gitignore`.
- `desktop/README.md`: how to run/package on each platform, and the ad-hoc signing step on macOS (`xattr -cr` + `codesign --force --deep -s -`).

## Verify
`npm run typecheck`, `npm test`, `npm run build` (check `dist/` is small, no assets inside), `npm run package:linux`. Launch the packaged Linux app headlessly to check it starts: `timeout 20 xvfb-run -a release/dwu-linux-x64/dwu --no-sandbox` if xvfb-run exists (else note it). Report results in the Worker report.

## Worker report

### Files changed
- `desktop/main.cjs` (new) — Electron main process: privileged `dwu://` scheme registered before app ready (`standard`, `secure`, `supportFetchAPI`, `corsEnabled`, `stream`); `protocol.handle` (registered after ready, since it touches the default session) serves `dist/` from `dwu://app/…` and maps `dwu://app/assets/dwu/<path>` → `<install dir>/<path>` via `net.fetch(pathToFileURL(...))`. Case-insensitive per-segment resolution with cached directory listings; traversal guard (resolved path must stay inside the root, `..` rejected). Install-dir discovery: `<userData>/config.json` → platform Steam/`~/Games` guesses → `showOpenDialog({properties:['openDirectory']})` titled "Locate your Distant Worlds: Universe folder", validated on `images/` subfolder, saved back to config.json. Window 1600×900, min 1280×720, title "Distant Worlds: Universe", `#000` background, menu removed on Linux (macOS keeps standard menu), F11 / Ctrl/Cmd+F fullscreen toggle, `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- `vite.config.ts` — added `base: './'` (relative asset URLs so `dist/index.html` works under `dwu://app/`) and `build.copyPublicDir: false` (keeps the ~4 GB `public/assets/dwu` symlink out of `dist/`); new `copyAssetManifest` plugin copies `public/asset-manifest.json` into `dist/` after build so the packaged app still gets real-art file lists. Dev probe middleware + `server.fs.allow` unchanged.
- `index.html` — title now "Distant Worlds: Universe" (matches the window title).
- `package.json` — added `"version": "0.1.0"` and `"main": "desktop/main.cjs"` (both required by @electron/packager's metadata inference); scripts `desktop:dev`, `package:linux`, `package:mac`; dev deps `electron` (44.4.5) + `@electron/packager` (20.3.0). Packager flags pin `--app-version`/`--electron-version` explicitly because the packager CLI cannot infer an electron version that only lives in devDependencies.
- `.gitignore` — added `release/` (also already had `public/assets/`, `public/asset-manifest.json`).
- `desktop/README.md` (new) — how to run/package on each platform, macOS ad-hoc re-sign step (`xattr -cr` + `codesign --force --deep -s -`), headless smoke-test command.

### Done
- Desktop shell complete per spec; renderer code untouched (stays platform-neutral, all fetches are absolute `/assets/dwu/...` URLs that resolve correctly against the `dwu://app` origin).
- `npm run typecheck` — passes.
- `npm test` — 110/110 pass.
- `npm run build` — `dist/` is 704 KB total (no DW:U assets inside; `asset-manifest.json` present; `index.html` uses relative `./assets/...` refs).
- `npm run package:linux` — produces `release/dwu-linux-x64/` (3.5 GB, mostly the unpruned node_modules + Electron runtime).
- Launched the packaged binary (`timeout 20 release/dwu-linux-x64/dwu --no-sandbox`): it started cleanly and ran until the timeout killed it (exit 124) — a real Wayland display was available on this machine, so the window actually opened; only benign warnings (missing `appmenu-gtk-module`, wayland protocol version notes). This surfaced and fixed one real bug: `protocol.handle` at module top level crashed with "Session can only be received when app is ready" — moved the registration inside `app.whenReady()`.

### Left undone / notes
- `xvfb-run` is not installed on this machine, so the specified headless launch command could not be used as written; the direct launch above (real display) covers the same check.
- `package:mac` cross-build from Linux was not exercised here (Linux-only environment); the script is in place and the README documents the Mac-side ad-hoc re-sign step.
- No app icon is set (packager uses the default Electron icon); add a `desktop/icon.png` (512×512) and an `--icon` flag when art for it exists.
- `--no-prune` keeps node_modules in the package (harmless — pixi.js is bundled into dist/ — but makes the bundle 3.5 GB instead of ~100 MB); switch to pruning if size matters.
