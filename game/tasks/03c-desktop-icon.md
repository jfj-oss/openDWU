# Task 03c — Desktop app icon from the install + rebuild packages

thinking: off
scope: locked

Edit `desktop/main.cjs`, `desktop/README.md`. Start editing right away. Do not Read image files.

Art can't be committed, so the icon is loaded at runtime from the user's DW:U folder (already resolved by main.cjs as the install dir):
- After the install dir is known, create the window icon with `nativeImage.createFromPath(<installDir>/images/ui/chrome/galaxy_Icon.png)` (resolve case-insensitively with the existing resolver); if empty, try `<installDir>/DesktopIcon.ico`. Set it via `new BrowserWindow({ icon })` (Linux/Windows) and on macOS `app.dock.setIcon(img)` when `!img.isEmpty()`.
- README: note that packaged builds show the default Electron icon in the file manager/Dock before first launch (no committed art), and the game icon once running.
Then run `npm run package:linux` and `npm run package:mac` and report both output sizes. `npm run typecheck` && `npm test`. Append `## Worker report`.

## Worker report

Files changed:
- `desktop/main.cjs` — added `nativeImage` import; new `makeAppIcon(installDir)` that resolves `images/ui/chrome/galaxy_Icon.png` then `DesktopIcon.ico` case-insensitively via the existing `resolveInsideRoot` and returns an empty `nativeImage` if neither exists; `createWindow` now passes `icon` (Linux/Windows) and calls `app.dock.setIcon(appIcon)` on macOS when non-empty; icon is computed right after `findInstallDir()` in the ready handler.
- `desktop/README.md` — "How it works" now documents the runtime icon loading and notes that packaged builds show the default Electron icon in the file manager/Dock before first launch, switching to the game icon once running with an install folder configured.

Verification:
- `npm run typecheck` — pass.
- `npm test` — 470/470 tests pass (40 files).
- `npm run package:linux` → `release/dwu-linux-x64`, 283.4 MB (packager) / 284M on disk.
- `npm run package:mac` → `release/dwu-darwin-arm64`, 501.4 MB (packager) / 309M on disk (expected cross-build warning about asar integrity digest since codesign is unavailable on Linux).

Nothing left undone. Note: the icon path itself couldn't be visually verified here (no DW:U install folder on this machine), but the fallback-to-default-Electron-icon behavior is what runs without one.
