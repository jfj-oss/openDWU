# Task M2e2 — Empire view fixes (from screenshot review)

thinking: off
scope: locked

Edit `src/main.ts` (boot after createGame), `src/render/empireLayer.ts`, tests. Do not edit `src/sim/`. Start editing right away.

1. `?autostart=1` path doesn't set `window.__dwu.game` (the wizard path does) — set it in both paths through one shared `startGameView(game)` function used by the wizard Start, autostart and save-load.
2. After a game starts, the camera must be **centred on the player empire's capital** at Sector zoom (currently the galaxy sits off-centre in the lower right).
3. Only one empire's territory was visible for 4 empires (player + 3 AI). Ensure every empire with ≥1 owned habitat draws its territory and rings; if empires share or lack colours, assign distinct colours from a 12-colour palette by empire index **in the renderer only** (don't change sim data). Log a console.warn if an empire has no owned habitats.
4. Test: pure `empireColour(empire, index)` returns distinct values for indices 0–11; `startGameView` sets `window.__dwu.game` (jsdom-free: test the function that builds the debug object).
`npm run typecheck` && `npm test`; save (don't open) `shots/M2e2-sector.png` with `?autostart=1`. Append `## Worker report`.

## Worker report

**Files changed**
- `src/main.ts` — new shared `startGameView(game)` boot (Application + Camera + AssetStore + MainView + HUD + ticker); wizard Start (`bootGameFromWizard`) and the `?autostart=1` branch of `bootGameWithOptions` now both route through it, so `window.__dwu.game` is set on both paths. New exported pure `buildDwuDebugObject(...)` builds the `__dwu` object (testable without jsdom). Camera is centred on `game.viewX/viewY` (player capital from `createGame`) at `camera.minZoom` (Sector zoom). The bare-galaxy URL-param path (`?zoom=`/`?cx=`/`?select=`, no Game object) keeps its own inline boot and sets `__dwu` without `game`.
- `src/render/empireLayer.ts` — added `EMPIRE_FALLBACK_COLORS` (12 distinct colours) and pure `empireColour(empire, index)` (own `mainColor` when non-zero, else palette by index, wraps past 12). `EmpireLayer` computes one display colour per non-independent empire in its constructor; territory disc fills, owned-system marker strokes, and colony-ring colours all use it. `console.warn` for any empire with `colonies.length < 1`. Sim data untouched.
- `test/empire-layer.test.ts` — new `empireColour` suite: distinct values for indices 0–11, own-colour passthrough (number + string), wraparound past 12, palette distinct/non-zero.
- `test/start-game-view.test.ts` (new) — `buildDwuDebugObject` includes camera/galaxy/view/app, omits `game` when not passed, and stores the exact `Game` reference when passed.

**Done**
- All four requirements implemented; `npm run typecheck` passes clean; `npm test`: 39 files / 412 tests, all pass.
- Screenshot saved (not opened): `shots/M2e2-sector.png` via `node scripts/shot.mjs 'http://localhost:5173/?autostart=1' shots/M2e2-sector.png 6000`. Console output was clean: only Vite connect messages — no page errors, no "owns no habitats" warnings, no autostart fallback warning, i.e. the full-game path ran and `window.__dwu.game` was set.

**Left undone / notes**
- Save-load boot: no save loader exists yet, so there is nothing to route through `startGameView`; the function takes a `Game` and is ready to accept a loaded game when that lands.
- The bare-galaxy URL-param boot path intentionally does not set `__dwu.game` (it has no player empire/capital — different feature).
