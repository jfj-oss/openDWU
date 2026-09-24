# Task 08f3 — Map labels render in the fallback serif font

thinking: off
scope: locked

Edit `src/render/mainView.ts` (and `src/main.ts` only if needed). Start editing right away.

Pixi `Text` objects for region labels, system names and planet names are created before the 'Forgotten Futurist' web font (declared via CSS `@font-face` in the HUD css) has loaded, so they rasterize in a serif fallback and never update.
Fix: before building the Main View text layers, `await document.fonts.load('16px "Forgotten Futurist"')` and `document.fonts.load('bold 16px "Forgotten Futurist"')` (catch and continue on failure); also, if any label was created earlier, re-apply its style (`text.style.fontFamily = 'Forgotten Futurist'` forces a re-render) once `document.fonts.ready` resolves. Every map `Text` uses `fontFamily: 'Forgotten Futurist, sans-serif'` so the fallback is at least sans-serif.
Test: a pure helper `MAP_FONT_FAMILY` constant equals `'Forgotten Futurist, sans-serif'` and every Text style in mainView uses it (grep-style test on the module source is fine).

`npm run typecheck` && `npm test`; save (don't open) `shots/08f3-labels.png` at `/?skipMenu=1`. Append `## Worker report`.

## Worker report

**Files changed:**
- `src/render/mainView.ts` — added exported `MAP_FONT_FAMILY = 'Forgotten Futurist, sans-serif'` and async `loadMapFont()` (awaits `document.fonts.load('16px "Forgotten Futurist"')` + `'bold 16px "Forgotten Futurist"'`, catches failures). All three label sites (planet name, system name, region label) now use `fontFamily: MAP_FONT_FAMILY`. `MainView.init()` awaits `loadMapFont()` before any Text is built, and additionally re-applies `style.fontFamily = MAP_FONT_FAMILY` to every existing label once `document.fonts.ready` resolves (covers labels created earlier / font that finished loading late).
- `test/main-view-label-font.test.ts` (new) — asserts `MAP_FONT_FAMILY === 'Forgotten Futurist, sans-serif'` and greps the mainView source so every `new Text({...})` site sets `fontFamily: MAP_FONT_FAMILY` with no hard-coded family strings left.

**Done:** typecheck passes; all 244 tests pass (24 files); screenshot saved to `shots/08f3-labels.png` via `node scripts/shot.mjs 'http://localhost:5173/?skipMenu=1'` — no console errors printed.

**Left undone:** none. (`src/main.ts` did not need changes — the fix lives entirely in `mainView.init()`, which main.ts already awaits.)
