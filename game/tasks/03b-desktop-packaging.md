# Task 03b — Desktop packaging: small package that actually contains the game

thinking: off
scope: locked

Everything you need is here. Edit only the files named. Start editing right away.

## Problems (from review)
1. `package:linux` / `package:mac` in `package.json` run `electron-packager . dwu … --no-prune`, which copies the **whole repo incl. node_modules** into the app → 3.5 GB.
2. `desktop/main.cjs` (lines 17–21) loads the game from `path.join(process.resourcesPath, 'dwu-dist')` when packaged, but **nothing copies `dist/` there** → the packaged app has no game.

## Implement
Create `scripts/package-desktop.mjs` (Node ESM, uses `@electron/packager`'s JS API: `import { packager } from '@electron/packager'` — if that named export doesn't exist in the installed version, use the default export) that takes `--platform=linux|darwin --arch=x64|arm64`:
1. Run `npm run build` (child_process `execSync`, `stdio: 'inherit'`).
2. Recreate `release/stage/`: copy `desktop/` → `release/stage/desktop/`, and write `release/stage/package.json` = `{ "name": "dwu", "productName": "Distant Worlds Universe", "version": "0.1.0", "main": "desktop/main.cjs" }` (no dependencies — main.cjs only uses Node/Electron built-ins; check its `require(...)` calls with `grep require desktop/main.cjs` and copy any local files it requires).
3. Recreate `release/dwu-dist/` as a copy of `dist/`.
4. Call packager with `{ dir: 'release/stage', name: 'dwu', platform, arch, out: 'release', overwrite: true, appVersion: '0.1.0', electronVersion: '44.4.5', extraResource: ['release/dwu-dist'], asar: true }`.
5. Print the output folder and its total size.

`package.json` scripts: `"package:linux": "node scripts/package-desktop.mjs --platform=linux --arch=x64"`, `"package:mac": "node scripts/package-desktop.mjs --platform=darwin --arch=arm64"`. Update the packaging section of `desktop/README.md` to match. Keep `release/` gitignored.

## Verify
- `npm run typecheck`, `npm test`.
- `npm run package:linux` → `release/dwu-linux-x64/` must be **< 400 MB** and contain `resources/dwu-dist/index.html` and `resources/app.asar` (check with `node -e` + `fs.statSync`/`fs.existsSync`; report both sizes).
- `npm run package:mac` → `release/dwu-darwin-arm64/dwu.app/Contents/Resources/dwu-dist/index.html` exists (it will not run here; just build it).
Append `## Worker report` with the sizes.

## Worker report

**Files changed:**
- `scripts/package-desktop.mjs` (new) — builds `dist/`, stages `release/stage/` (`desktop/` + minimal `package.json`), copies `dist/` → `release/dwu-dist/`, then runs `@electron/packager` (named `packager` export, v20.3.0) with `extraResource: ['release/dwu-dist']`, `asar: true`, electron 44.4.5. Prints output folder + total size.
- `package.json` — `package:linux` / `package:mac` now run `node scripts/package-desktop.mjs --platform=… --arch=…`.
- `desktop/README.md` — packaging section updated to describe the stage-dir approach and why it's small.

**Done & verified:**
- `npm run typecheck` ✓, `npm test` ✓ (138 tests pass).
- `npm run package:linux` → `release/dwu-linux-x64/` = **283.1 MB** (< 400 MB ✓); contains `resources/dwu-dist/index.html` ✓ and `resources/app.asar` (0.01 MB) ✓.
- `npm run package:mac` → `release/dwu-darwin-arm64/` = 501.2 MB; `dwu.app/Contents/Resources/dwu-dist/index.html` exists ✓ (expected warning about asar integrity digest when cross-building macOS on Linux — harmless, noted by packager).
- `main.cjs` only requires Node/Electron built-ins (verified via grep), so no extra local files needed in the stage dir.
- `release/` remains gitignored.

**Left undone:** nothing within scope. The mac build is a cross-build (unsigned/quarantined binaries, per README instructions for re-signing on the Mac).
