# Task 05d — HUD touch-ups + case-insensitive art serving in dev

thinking: off
scope: locked

Everything you need is here. Edit `vite.config.ts`, `src/ui/hud.css`, `src/ui/hud.ts`, `src/ui/hudLayout.ts`, tests. Start editing right away. Do not Read image files.

## 1. Case-insensitive `/assets/dwu/` in the Vite dev server (root cause of a broken HUD icon)
The original is a Windows game, so its code references files with the wrong letter case (e.g. `shipsAndBasesButton.png`, but the file is `images/ui/chrome/ShipsAndBasesButton.png`). The Electron shell already resolves paths case-insensitively (`desktop/main.cjs`); the dev server does not. In `vite.config.ts`, extend the existing plugin (or add one) with a middleware on `/assets/dwu/` that runs **before** Vite's static serving: if the exact path exists under `public/assets/dwu`, call `next()`; otherwise resolve each path segment case-insensitively against `fs.readdirSync` of the parent (cache directory listings in a `Map`), and if a match is found, stream that file with the right `Content-Type` (png/jpg/txt/ttf/wav/mp3 — a small map) and status 200; if not found, `next()`. Reject `..` segments. Unit-test the pure segment resolver (`resolveCaseInsensitive(root, relPath, readdir)` with an injected readdir).

## 2. Panels are too see-through
Map star labels show through the panels. In `hud.css` set all HUD panels to `background: rgba(14,16,20,0.94)` and add `backdrop-filter: blur(6px)`.

## 3. Cycle chips show arrows baked into their icons
The selection-panel chips use `cycle<X>.png`, whose art includes a "›" arrow. Instead render each chip as a short text label (`Colonies`, `Bases`, `Military`, `Constr.`, `Other`, `Fleets`, `Idle`) in a compact pill (11 px, 4 px 8 px padding), active chip highlighted (`background: rgba(255,255,255,0.12)`). Keep the single ‹ › pair.

## 4. Options list runs off the bottom at 1080p
`pnlOptionsList` (220×400) overflows its content. Make its height fit the content (`height: auto`), anchor it with `bottom: 10px; right: 10px`, and tighten rows to 20 px line-height with 8 px section spacing so it fits within 1080 px height with room to spare; if the window is shorter than the list, the list scrolls (`max-height: calc(100vh - 140px); overflow-y: auto`).

## Verify
`npm run typecheck`, `npm test`; with `npm run dev` running, confirm `curl -s -o /dev/null -w '%{http_code}' http://localhost:5173/assets/dwu/images/ui/chrome/shipsAndBasesButton.png` prints 200; save (don't open) `shots/05d-hud.png` at `?zoom=1200` 1920×1080. Append `## Worker report`.

## Worker report

**Files changed**
- `vite.config.ts` — new `dwuCaseInsensitive()` dev-server plugin: middleware on `/assets/dwu/` that runs before Vite's static serving; exact path → `next()`, otherwise resolves each segment case-insensitively against cached `fs.readdirSync` listings and streams the match with a Content-Type from a small extension map (png/jpg/txt/ttf/wav/mp3); `..`/`.` segments rejected; no match → `next()`. Also exports the pure `resolveCaseInsensitive(root, relPath, readdir, isDirectory?)` for testing.
- `test/caseInsensitive.test.ts` (new) — 8 unit tests for the resolver with an injected fake directory tree: exact case, wrong-case file name (`shipsAndBasesButton.png` → `ShipsAndBasesButton.png`), wrong-case intermediate segments, missing file/dir, `..`/`.` rejection, empty path, directory-as-target.
- `src/ui/hud.css` — `.hud-panel` now `background: rgba(14,16,20,0.94)` + `backdrop-filter: blur(6px)` (labels no longer show through); cycle chips restyled as compact text pills (11 px font, 4 px 8 px padding, full pill radius, active = `rgba(255,255,255,0.12)`); options list gets `height: auto !important; max-height: calc(100vh - 140px); overflow-y: auto`, rows tightened to 20 px line-height with 8 px section spacing.
- `src/ui/hudLayout.ts` — chip labels shortened to `Colonies, Bases, Military, Constr., Other, Fleets, Idle`; `pnlOptionsList` rect is now `{ x: width-230, y: height-10, w: 220, h: 0 }` (content-sized, bottom-anchored).
- `src/ui/hud.ts` — chips render as text pills only (no more `cycle<X>.png` icons); `CHROME_BUTTONS` drops the seven `btnCycle*` entries; `CHIP_CONTROL` map removed; options list positioned via `bottom` (top cleared) in both `createHud` and `layoutHud` so it stays anchored to the window corner when content-sized.
- `test/hudLayout.test.ts`, `test/hud.test.ts` — updated expectations: `pnlOptionsList` `{x: width-230, y: height-10, w: 220, h: 0}`; `chromeButtonFile('btnCycleShipGroups')` now null.

**Done & verified**
- `npm run typecheck` passes; `npm test` passes (14 files, 176 tests).
- With `npm run dev` running: `GET /assets/dwu/images/ui/chrome/shipsAndBasesButton.png` → **200 image/png** (wrong-case root cause fixed); `cyclefleets.png` → 200; nonexistent file falls through to Vite's normal response.
- Screenshot saved (not opened): `shots/05d-hud.png` at `?zoom=1200`, 1920×1080 — console output was clean (only vite HMR debug lines).

**Left undone**
- Nothing from the task spec. Note: the desktop shell's case-insensitive resolution was already present (`desktop/main.cjs`); only the dev server needed the fix. The `__dwu_probe` endpoint is untouched and still works.
