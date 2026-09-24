# Task 03c — Desktop app icon from the install + rebuild packages

thinking: off
scope: locked

Edit `desktop/main.cjs`, `desktop/README.md`. Start editing right away. Do not Read image files.

Art can't be committed, so the icon is loaded at runtime from the user's DW:U folder (already resolved by main.cjs as the install dir):
- After the install dir is known, create the window icon with `nativeImage.createFromPath(<installDir>/images/ui/chrome/galaxy_Icon.png)` (resolve case-insensitively with the existing resolver); if empty, try `<installDir>/DesktopIcon.ico`. Set it via `new BrowserWindow({ icon })` (Linux/Windows) and on macOS `app.dock.setIcon(img)` when `!img.isEmpty()`.
- README: note that packaged builds show the default Electron icon in the file manager/Dock before first launch (no committed art), and the game icon once running.
Then run `npm run package:linux` and `npm run package:mac` and report both output sizes. `npm run typecheck` && `npm test`. Append `## Worker report`.
