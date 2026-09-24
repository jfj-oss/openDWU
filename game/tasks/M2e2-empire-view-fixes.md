# Task M2e2 — Empire view fixes (from screenshot review)

thinking: off
scope: locked

Edit `src/main.ts` (boot after createGame), `src/render/empireLayer.ts`, tests. Do not edit `src/sim/`. Start editing right away.

1. `?autostart=1` path doesn't set `window.__dwu.game` (the wizard path does) — set it in both paths through one shared `startGameView(game)` function used by the wizard Start, autostart and save-load.
2. After a game starts, the camera must be **centred on the player empire's capital** at Sector zoom (currently the galaxy sits off-centre in the lower right).
3. Only one empire's territory was visible for 4 empires (player + 3 AI). Ensure every empire with ≥1 owned habitat draws its territory and rings; if empires share or lack colours, assign distinct colours from a 12-colour palette by empire index **in the renderer only** (don't change sim data). Log a console.warn if an empire has no owned habitats.
4. Test: pure `empireColour(empire, index)` returns distinct values for indices 0–11; `startGameView` sets `window.__dwu.game` (jsdom-free: test the function that builds the debug object).
`npm run typecheck` && `npm test`; save (don't open) `shots/M2e2-sector.png` with `?autostart=1`. Append `## Worker report`.
