# Task 10h — Selection panel: cycle through your colonies

thinking: off
scope: locked

Edit `src/ui/hud.ts` (the cycle chips / ‹ › handlers, ~lines 590–600 `TODO(cycle)`), `src/main.ts` only if the HUD needs the game passed through, tests. Do not edit `src/sim/`. Start editing right away.

- **Colonies** chip + ‹ ›: cycle through the player empire's owned planets/moons (`habitat.owner === game.playerEmpire`), ordered like the original's colony list (by descending population if available on the habitat, else by name). Each step selects the colony (same selection hook click-to-select uses, so the panel updates) and centres the camera on it at System zoom.
- Other chips (Bases, Military, Construction, Other, Fleets, Idle): need ships (M3) — keep a single `// TODO(cycle): needs ships (M3)` and make ‹ › a no-op with a short HUD message "No <chip> yet" via `pushHudMessage` instead of console logs.
- Pure helper `nextInCycle(list, current, dir)` with wrap-around + tests.
`npm run typecheck` && `npm test`. Append `## Worker report`.
