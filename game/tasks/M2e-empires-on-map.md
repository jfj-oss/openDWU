# Task M2e — Draw empires on the Main View

thinking: off
scope: locked

Edit `src/render/mainView.ts` (+ a new `src/render/empireLayer.ts`), tests. Do not edit `src/sim/`. Start editing right away.

After `createGame` (C2) habitats have an owner empire and empires have colours (read `src/sim/empire.ts` / `src/sim/game.ts` for field names). Render:
- **Colony rings**: at system/planet zoom a 2 px circle in the owner's primary colour around each owned planet/moon (radius = drawn sprite radius + 6 px), like the original's owner ring (MainView draws `DrawCircle(area, 60, owner.MainColor, 2)` around owned habitats; independent populated worlds use a neutral grey).
- **Owned-system markers**: at galaxy/sector zoom, star dots of systems containing an owned colony get a small ring in the owner colour (as in the gameplay frames: coloured rings around owned systems).
- **Territory**: at galaxy/sector zoom, soft translucent discs (alpha ~0.18) in the owner colour centred on each owned system, radius ~1.2 sectors × 0.25, merged visually by drawing all of one empire into one Graphics with additive-free normal blending; hidden at system zoom.
Pure helper tests: ring radius function; colour → Pixi number conversion.
`npm run typecheck` && `npm test`; save (don't open) `shots/M2e-galaxy.png` and `shots/M2e-sector.png` after starting a game (use `?autostart=1` URL param that runs createGame with defaults — add it in main.ts boot, one small branch). Append `## Worker report`.

## Worker report

**Files changed**
- `src/render/empireLayer.ts` (new): pure helpers `colonyRingRadius(drawnPx)` (= drawn sprite radius + 6 px), `territoryRadius(sectorSize)` (= sectorSize × 1.2 × 0.25), `toPixiColor(number | '#rrggbb' | 'rgb(r,g,b)')`, `colonyRingColor(habitat, galaxy)` (owner's primary colour, neutral grey `0x606060` for independent/unowned); plus the `EmpireLayer` class (world-space, added to `MainView.world` last so it draws on top of stars):
  - colony rings — 2 px stroke (`width: 2/z`) in owner colour around each owned planet/moon at system/planet zoom (`factor < 70`, same threshold as `pick()`); off-screen bodies culled.
  - owned-system markers — small 2 px ring just outside the star icon (icon side is `clamp(d*z*30, 2.5, 26)` px, matching `SystemView.update`) in the owning empire's colour, at galaxy/sector zoom only.
  - territory — one `Graphics` per non-independent empire (normal blending, alpha 0.18 discs centred on each owned system, radius = `territoryRadius(galaxy.sectorSize)`), hidden at system zoom.
- `src/render/mainView.ts`: imports `EmpireLayer`; instantiates it in `init()` (after nebulae, so its root sits above all system roots in `world`); calls `empireLayer.update(z, cam)` in `update()` after the nebula pass. No sim changes.
- `src/main.ts`: `autostart` added to `SKIP_MENU_PARAMS`; new `buildAutostartGame()` + `paramsHasAutostart()` — `?autostart=1` boots via `createGame` with defaults (player Human / Normal / (Random) / age 1 / techLevel 0, three `(Random)` AI empires) instead of bare `generateGalaxy`, and centres the camera on the player capital (`game.viewX/viewY`). Falls back to `generateGalaxy` (with a console warning) when DW:U game data is unavailable or `createGame` throws.
- `test/empire-layer.test.ts` (new): pure-helper tests for `colonyRingRadius`, `territoryRadius`, `toPixiColor` (numbers incl. masking, hex strings, rgb() strings, fallback, independent grey).

**Done**
- All three overlays render per spec; zoom gating matches the original's factor-70 system-zoom threshold used by `pick()`.
- `npm run typecheck` clean; `npm test` → 38 files / 385 tests passed.
- Screenshots saved (not opened) via `node scripts/shot.mjs "http://localhost:5173/?autostart=1[&zoom=1200]" ... 8000 1920 1080` against the running dev server; shot.mjs printed only vite connect lines, no console errors/pageerrors:
  - `shots/M2e-galaxy.png` — whole-galaxy view (minZoom), territory discs + owned-system marker rings visible.
  - `shots/M2e-sector.png` — `?zoom=1200` (original zoom *factor* 1200, sector level), same overlays at closer range.

**Left undone / notes**
- Territory disc radius uses the task's flat "~1.2 sectors × 0.25" constant rather than the original's per-colony influence-range factor (`galaxy.empireTerritoryColonyInfluenceRangeFactor` / `reviewEmpireTerritory`) — that model exists in `src/sim/territory.ts` but the task specified the simple disc approximation.
- Owned-system marker picks the first non-independent owning empire in the system (a proxy for the original's dominant-empire logic, which lives in `galaxy.updateSystemInfo()`'s `dominantEmpire`); multi-empire systems show one marker colour.
- Colony rings are not yet crossfaded out/in over a zoom window (they simply switch at factor 70, like the original's hard threshold there).
