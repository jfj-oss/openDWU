# Task 11a2 — Save/load part 2: whole game

thinking: off
scope: locked

Depends on 11a1 (`src/sim/save/galaxySave.ts`). Create `src/sim/save/gameSave.ts` + `test/gameSave.test.ts`; you may edit `galaxySave.ts` to fill `ownerIndex`. Start editing right away.

- `serializeGame(game, time, startOptions): string` (JSON, `{ version: 1, galaxy, empires, time, startOptions, playerEmpireIndex }`) and `deserializeGame(text, gameData): { game, time, startOptions }`.
- Empires: plain fields; refs (capital habitat, dominant race → race name, policy → name, colonies/owned habitats → habitat indices, government → id). Habitat `owner` ↔ empire index (fill `ownerIndex` in galaxySave). Independent empire included.
- GalaxyTime: elapsedMs, speed, paused, startStarDate.
- Test: `createGame` with autostart defaults → advance time 10 s → serialize → deserialize → serialize: identical strings; player empire name and colony count equal.
`npm run typecheck` && `npm test`. Append `## Worker report`.
