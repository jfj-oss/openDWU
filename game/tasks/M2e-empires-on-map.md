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
