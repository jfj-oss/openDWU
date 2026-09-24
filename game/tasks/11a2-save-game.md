# Task 11a2 — Save/load part 2: whole game

thinking: off
scope: locked

Depends on 11a1 (`src/sim/save/galaxySave.ts`). Create `src/sim/save/gameSave.ts` + `test/gameSave.test.ts`; you may edit `galaxySave.ts` to fill `ownerIndex`. Start editing right away.

- `serializeGame(game, time, startOptions): string` (JSON, `{ version: 1, galaxy, empires, time, startOptions, playerEmpireIndex }`) and `deserializeGame(text, gameData): { game, time, startOptions }`.
- Empires: plain fields; refs (capital habitat, dominant race → race name, policy → name, colonies/owned habitats → habitat indices, government → id). Habitat `owner` ↔ empire index (fill `ownerIndex` in galaxySave). Independent empire included.
- GalaxyTime: elapsedMs, speed, paused, startStarDate.
- Test: `createGame` with autostart defaults → advance time 10 s → serialize → deserialize → serialize: identical strings; player empire name and colony count equal.
`npm run typecheck` && `npm test`. Append `## Worker report`.

## Worker report

Files changed:
- `src/sim/save/galaxySave.ts` — added empire serialization: `EmpireJSON` shape, `flatEmpireList()` (empires + pirateEmpires + independentEmpire), `empireToJSON` / `empireFromJSON`; `galaxyToJSON` now fills habitat `ownerIndex`/`empireIndex`, system `dominantEmpire`/`otherEmpires` as `{empireIndex, colonyCount, totalStrategicValue}`, and top-level `empires`/`pirateEmpires`/`independentEmpire`/`playerEmpire` (flat-list index); `galaxyFromJSON` rebuilds empires after habitats/systems (so `EmpireVisibility` sees a populated galaxy) and re-links habitat owner/empire and system empires from the flat list.
- `src/sim/save/gameSave.ts` (new) — `serializeGame(game, time, startOptions)` → JSON string `{ version: 1, galaxy, empires, time, startOptions, playerEmpireIndex }`; `deserializeGame(text, gameData)` rebuilds galaxy via `galaxyFromJSON`, GalaxyTime without its constructor, and returns `{ game, time, startOptions }`.
- `test/gameSave.test.ts` (new) — `createGame` with autostart defaults (pinned seed 42) → advance 10 s → serialize/deserialize/serialize is byte-identical; restored player empire name and colony count equal the originals.

Done:
- Empire plain fields serialized; refs encoded as indices/names (capital & homeWorld → habitat index, dominant race → race name, colonies → habitat indices, government → id, policy → name). Independent empire included; habitat `owner`/`empire` ↔ flat empire index; system dominant/other empires ↔ flat empire index.
- GalaxyTime round-trips elapsedMs, speed, paused, startStarDate.
- `npm run typecheck` and `npm test` both pass (42 files, 460 tests).

Left undone / stubbed on load (noted in code):
- Policy restored as an empty object stand-in (only `policyName` is carried); full `EmpirePolicy` port is out of scope here.
- Research state not restored — rebuilt fresh via `new ResearchSystem(galaxy.researchStatic)`.
- `counters`/`pirateEconomy` are plain-object stand-ins (the classes aren't exported); ~25 unknown[] lists restore as `[]`; `troops` is a fresh `TroopList()`.
- `viewX`/`viewY` reset to 0 on load (not part of the save shape per the task spec).
