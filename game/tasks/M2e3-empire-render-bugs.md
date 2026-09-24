# Task M2e3 — Empire rendering still wrong (verified in the browser)

thinking: off
scope: locked

Edit `src/render/empireLayer.ts`, `src/main.ts` (startGameView), tests. Do not edit `src/sim/`. Start editing right away.

Measured in the browser with `?autostart=1` (seed default): `game.galaxy.empires.length === 4` and owned-habitat counts `{Independent: 5, " Confederacy": 1, "Duren Nation": 1, "United  Republic": 1, "Perul Domain": 1}` — but **only one territory disc is drawn**, and the camera ends at `zoom = 0.000081` (full-galaxy) instead of Sector level.
1. The layer must iterate `galaxy.empires` (plus the independent empire if it's separate — skip drawing territory for the Independent empire, but draw its grey rings on populated worlds) and draw territory + rings for every empire with owned habitats (`habitat.owner === empire`). Find why only one is drawn (e.g. built once before colonies existed, a `break`, keyed by colour, or only `playerEmpire`) and fix it; rebuild the layer after `startGameView`.
2. `startGameView` must set the camera to the Sector zoom level used by the HUD's "Sector" option **after** any code that resets the camera to the galaxy view (order bug), centred on `game.playerEmpire.capital`.
3. Test: a pure `collectEmpireSystems(galaxy)` returns 4 non-independent empires for a game created with `createGame` defaults (use the same options as autostart).
`npm run typecheck` && `npm test`; save (don't open) `shots/M2e3-sector.png` and `shots/M2e3-galaxy.png` (`?autostart=1`, then `&zoom=20000` variant). Append `## Worker report`.
