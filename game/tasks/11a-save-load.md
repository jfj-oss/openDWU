# Task 11a — Save / load games

thinking: off
scope: locked

Create `src/sim/saveGame.ts`, `src/ui/screens/saveLoad.ts` (+css), tests; wire the Escape menu's Save/Load buttons (`src/ui/screens/gameMenu.ts`, currently TODO toasts) and the main menu's Load Game item. Don't change sim behaviour. Start editing right away.

- `serializeGame(game): string` / `deserializeGame(text, gameData): Game` — JSON with a `version: 1` header. Serialize the full sim state reachable from the `Game` object returned by `createGame` (`src/sim/game.ts`): galaxy (habitats, systems, locations, creatures), empires, GalaxyTime (elapsed, speed, paused), RNG state (the `Random` seed array + indices — add `getState/setState` to `src/sim/random.ts` if missing; that is the only sim-file edit allowed), and the StartGameOptions. Object references (habitat.parent, owner empire, system star…) are stored as ids and re-linked on load. Data from `gameData` (races, resources, components…) is NOT saved — referenced by id/name and re-attached from the loaded gameData.
- Round-trip test: create a game (seed 1), advance time 10 s, serialize → deserialize → serialize again gives an identical string; and the RNG continues identically (next 5 `rnd.next()` values equal).
- UI: Save opens a small panel with a name field and a list of saves; browser → `localStorage` (`dwu.saves.<name>`), plus a "Download .dwusave" button (Blob download). Load lists saves + "Open file…" (`<input type=file>`). Loading replaces the running game and boots the Main View/HUD with it (reuse whatever main.ts does after createGame).
`npm run typecheck` && `npm test`. Append `## Worker report`.
