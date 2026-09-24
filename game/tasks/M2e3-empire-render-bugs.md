# Task M2e3 — Empire rendering still wrong (verified in the browser)

thinking: off
scope: locked

Edit `src/render/empireLayer.ts`, `src/main.ts` (startGameView), tests. Do not edit `src/sim/`. Start editing right away.

Measured in the browser with `?autostart=1` (seed default): `game.galaxy.empires.length === 4` and owned-habitat counts `{Independent: 5, " Confederacy": 1, "Duren Nation": 1, "United  Republic": 1, "Perul Domain": 1}` — but **only one territory disc is drawn**, and the camera ends at `zoom = 0.000081` (full-galaxy) instead of Sector level.
1. The layer must iterate `galaxy.empires` (plus the independent empire if it's separate — skip drawing territory for the Independent empire, but draw its grey rings on populated worlds) and draw territory + rings for every empire with owned habitats (`habitat.owner === empire`). Find why only one is drawn (e.g. built once before colonies existed, a `break`, keyed by colour, or only `playerEmpire`) and fix it; rebuild the layer after `startGameView`.
2. `startGameView` must set the camera to the Sector zoom level used by the HUD's "Sector" option **after** any code that resets the camera to the galaxy view (order bug), centred on `game.playerEmpire.capital`.
3. Test: a pure `collectEmpireSystems(galaxy)` returns 4 non-independent empires for a game created with `createGame` defaults (use the same options as autostart).
`npm run typecheck` && `npm test`; save (don't open) `shots/M2e3-sector.png` and `shots/M2e3-galaxy.png` (`?autostart=1`, then `&zoom=20000` variant). Append `## Worker report`.

## Worker report

**Files changed**
- `src/render/empireLayer.ts` — added pure exported `collectEmpireSystems(galaxy)` (scans `galaxy.habitats` for Planet/Moon with `habitat.owner` set, groups by owner restricted to `galaxy.empires`, excludes the independent empire; returns `{empire, systems[]}` per owning empire). `EmpireLayer` now builds its territory data from this collector instead of `empire.colonies`, so every empire in `galaxy.empires` with owned habitats gets a territory disc + marker rings regardless of colonies-list bookkeeping. Emires that own nothing still get an (empty) territory object so index-based colour lookups stay aligned, and are flagged with the existing console.warn. Colony rings (incl. grey `INDEPENDENT_RING_COLOR` for the independent empire's populated worlds via `colonyRingColor`) unchanged.
- `src/main.ts` (`startGameView`) — fixed the order bug: after `camera.zoom = camera.minZoom` it now centres on `game.playerEmpire.capital` (null-guard → `game.viewX/viewY`) and applies `SECTOR_LEVEL_ZOOM` via `camera.zoomAt(...)` (imported from `./ui/hud`). Added optional `zoomOverride` param: when `?zoom=` is present on the autostart path it overrides the Sector default (factor/reciprocal semantics matching the generateGalaxy boot path), so `&zoom=20000` yields the whole-galaxy view.
- `test/empire-layer.test.ts` — new `collectEmpireSystems (task M2e3)` describe block: `createGame` with the exact `?autostart=1` options (seed 1, Spiral, 700 stars, 4x4 sectors, Human player `(Random)` start age 1 tech 0, 3× `(Random)` AI `proximityDistance:'Random'`, `loadGameDataFs`, 60 s timeout) asserts 4 non-independent empires are returned, each with ≥1 owned system index in range, unique names, and none equal to `galaxy.independentEmpire`.

**Verified**
- `npm run typecheck` clean; `npm test` 414/414 pass (39 files).
- Headless browser probes (`window.__dwu`): `?autostart=1` → `zoom = 0.00025` (= `SECTOR_LEVEL_ZOOM`, was 0.000081/minZoom before), camera centred exactly on the player capital (Eliseyfe @ 3173753, 231553); `?autostart=1&zoom=20000` → `zoom = minZoom = 0.00010125` (whole-galaxy fit). All 4 empires have distinct non-zero `mainColor`s and 1 colony each; no "owns no habitats" warnings or PixiJS errors in console output.
- Screenshots saved (not opened): `shots/M2e3-sector.png` (`?autostart=1`), `shots/M2e3-galaxy.png` (`?autostart=1&zoom=20000`).

**Left undone / notes**
- The layer is constructed at the end of `MainView.init()` inside `startGameView`, i.e. after `createGame` has finished placing all starting colonies — so the "built once before colonies existed" hypothesis did not apply; the actual single-disc cause was the territory loop reading `empire.colonies` while ownership lives on `habitat.owner`. The collector makes the layer correct either way.
- Territory discs are drawn per owned *system* star position (one disc per owned system per empire); with one colony per empire at seed 1 that is one disc per empire. If later gameplay gives an empire multiple colonies in different systems, each gets its own disc (matching the original's per-colony `DrawCircle` behaviour).
