# Task 10h — Selection panel: cycle through your colonies

thinking: off
scope: locked

Edit `src/ui/hud.ts` (the cycle chips / ‹ › handlers, ~lines 590–600 `TODO(cycle)`), `src/main.ts` only if the HUD needs the game passed through, tests. Do not edit `src/sim/`. Start editing right away.

- **Colonies** chip + ‹ ›: cycle through the player empire's owned planets/moons (`habitat.owner === game.playerEmpire`), ordered like the original's colony list (by descending population if available on the habitat, else by name). Each step selects the colony (same selection hook click-to-select uses, so the panel updates) and centres the camera on it at System zoom.
- Other chips (Bases, Military, Construction, Other, Fleets, Idle): need ships (M3) — keep a single `// TODO(cycle): needs ships (M3)` and make ‹ › a no-op with a short HUD message "No <chip> yet" via `pushHudMessage` instead of console logs.
- Pure helper `nextInCycle(list, current, dir)` with wrap-around + tests.
`npm run typecheck` && `npm test`. Append `## Worker report`.

## Worker report

Files changed:
- `src/ui/hud.ts` — replaced the `TODO(cycle)` ‹ › handlers in `buildSelectionPanel`:
  - Colonies chip steps through `playerColonyList(galaxy, game.playerEmpire)` (owned planets/moons, descending population where every colony has one, else name order), selects via the same `wiring.onSelectionChange` hook click-to-select uses (panel updates) and centres the camera on it at System zoom (`centerOn` + `zoomAt(SYSTEM_LEVEL_ZOOM, w/2, h/2)`, same idiom as "Zoom to selection"). Empty list → `pushHudMessage('No Colonies yet')`.
  - Other chips (Bases/Military/Constr./Other/Fleets/Idle): single `// TODO(cycle): needs ships (M3)`; ‹ › is a no-op pushing `No <Label> yet` via `pushHudMessage` instead of console logs.
  - New exported pure helpers: `nextInCycle(list, current, dir)` (wrap-around; empty → null; unknown current → first for forward / last for back) and `playerColonyList(galaxy, playerEmpire)`.
- `test/hud.test.ts` — new suites for `nextInCycle` (wrap, empty, unknown-current, single item) and `playerColonyList` (ownership filter incl. stars excluded, population ordering, name fallback, tie-break).
- `src/main.ts` — resolved two leftover merge-conflict blocks from the lane-b merge (import union keeping `setGameMenuHandler`; HEAD-style named `keydownHandler` so teardown can remove it by reference) and fixed its indentation. No wiring change needed: both boot paths already pass `game` into `createHud`.
- `src/ui/screens/mainMenu.ts` — resolved one more leftover conflict block (kept both `loadGame` and `options` cases); it blocked `npm run typecheck`.

Verification: `npm run typecheck` clean; `npm test` 561/561 passed (48 files). Headless screenshot saved to `shots/10h-cycle-colonies.png` (dev server booted with no console errors; orchestrator reviews visually).

Left undone:
- Bases/Military/Constr./Other/Fleets/Idle cycling needs ship state (M3) — ‹ › shows "No <chip> yet" until then.
- The keyboard cycle bindings (C/P/M/Y/X/F/I, task 10a) are still inert `TODO(key)` stubs; only the panel's ‹ › buttons drive the cycler.
- The generateGalaxy-only boot path (`bootGameWithOptions`) passes no `game`, so Colonies there shows "No Colonies yet".
