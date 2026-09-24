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
