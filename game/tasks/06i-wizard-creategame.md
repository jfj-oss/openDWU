# Task 06i — Wizard Start → createGame

thinking: off
scope: locked

Edit `src/ui/screens/newGameWizard.ts`, `src/sim/startGameOptions.ts`, `src/main.ts` (boot path only), tests. Do not edit other `src/sim/` files. Start editing right away.

`src/sim/game.ts` exports `createGame(options)` (read its options type first). Map `StartGameOptions` (all wizard pages) onto those options — galaxy shape/stars/dimensions/seed, player race/empire name/government/colours, number of AI empires from "Other Empires", aggression/difficulty/pirates/creatures/colony/alien-life converters (06f), victory settings — and call `createGame` from **Start Game**; fields `createGame` doesn't accept yet stay on the options object with a `// TODO(createGame)` note. Then boot the Main View + HUD with the returned galaxy/empires. Known limitation from C2: tech level must not be 0.5 ("Normal") yet — clamp the default to a supported value and note it. Store the created game in `window.__dwu.game`.
Tests: the mapping function `toCreateGameOptions(startOptions)` for defaults; seed passes through.
`npm run typecheck` && `npm test`. Append `## Worker report`.

## Worker report

**Files changed**
- `src/sim/startGameOptions.ts` — added `toCreateGameOptions(startOptions, gameData, systemNames): CreateGameOptions` (plus a `STARTING_TECH_LEVEL = 0` constant) and the `GameData` / `CreateGameOptions` / `EmpireStartOptions` type imports. Maps shape/stars (`starCountFor`) / dimensions (`sectorsFor`) / seed, the player empire (race name or `(Random)`, empire name, `governmentId` → government *name* via `gameData.governments[id].name`, fixed supported tech level), AI empires sized by `clampOtherEmpires(otherEmpires).empireCount` (auto-generated random-race/random-proximity), `colonyPrevalence`, `allowEmpiresInSameSystem`, and `empireTerritoryColonyInfluenceRangeFactor` (only when range limits are enforced). Fields `createGame` doesn't accept yet (alien life, space creatures, pirates, aggression, difficulty + scaling, victory conditions, colonization-range radius, flag colours/shape) are left on `StartGameOptions` with `// TODO(createGame)` notes.
- `src/main.ts` (boot path only) — the wizard's `onStartGame` now calls a new `bootGameFromWizard(options)`: it loads DW:U data/system names, builds options via `toCreateGameOptions`, calls `createGame`, boots the Main View + HUD/clock/keyboard with the returned galaxy, centres the camera on the player capital (`game.viewX/viewY`), and stores `{ camera, galaxy, view, app, game }` in `window.__dwu` (so `window.__dwu.game` is set). The URL-param boot path (`bootGameWithOptions` → `generateGalaxy`) is untouched. Removed the now-unused `starCountFor`/`sectorsFor` imports from `main.ts`.
- `test/startGameOptions.test.ts` — new `toCreateGameOptions` suite: galaxy-option mapping through the converters, seed pass-through, player race/name/government mapping (and the `(Random)` fallbacks), AI-empire count sizing + clamping, and the colonization same-system / influence-factor mapping. Uses `loadGameDataFs()` for the `GameData` argument.
- `src/ui/screens/newGameWizard.ts` — **no changes needed**: its `onStartGame` callback already hands the full `StartGameOptions` to the caller, so the createGame wiring lives entirely in `main.ts`.

**Done**
- Wizard Start Game now runs `createGame` (galaxy + player/AI empires + starting colonies) instead of `generateGalaxy` alone, and boots the Main View + HUD with the created game stored at `window.__dwu.game`.
- Tech-level limitation handled: the wizard has no tech page, so every starting empire uses a fixed supported level (`STARTING_TECH_LEVEL = 0`, PreWarp) — never the unported 0.5 "Normal" path — noted in the function doc comment.
- `npm run typecheck` clean; `npm test` → 392 passed (36 files). Headless screenshot of `?screen=wizard` saved to `shots/06i-wizard.png` with no console errors.

**Left undone / notes**
- `createGame` still ignores several wizard fields (victory, piracy, creatures, aggression, difficulty/scaling, alien-life count, colonization-range radius, flag colours/shape); these remain on `StartGameOptions` behind `// TODO(createGame)` markers until `createGame` accepts them.
- Non-autogenerate ("manual") Other-Empires lists aren't represented on `OtherEmpiresOptions` yet, so a manual choice falls back to the auto-generated set sized by `empireCount` (noted inline).
- `bootGameFromWizard` requires loaded DW:U game data (races/governments); without an install it logs an error rather than booting, since `createGame` has no no-data fallback like `generateGalaxy` does.
