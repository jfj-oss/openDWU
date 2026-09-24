# Task 11a1 — Save/load part 1: galaxy serialization

thinking: off
scope: locked

Create `src/sim/save/galaxySave.ts` and `test/galaxySave.test.ts`. Do not edit other files. Start editing right away; write the serializer first, then the test.

- `galaxyToJSON(galaxy): object` and `galaxyFromJSON(obj, gameData): Galaxy`.
- Habitats: plain fields copied; object refs replaced by indices: `parent` → parent's index in `galaxy.habitats` (or -1), `owner` → skip for now (write `ownerIndex: -1` + TODO; part 2 fills it). Systems: `systemStar` and `habitats` by habitat index. GalaxyLocations and creatures: plain fields, habitat refs → index.
- RNG: `galaxy.rnd.getState()` / `setState()` (already in `src/sim/random.ts`); also any other `Random` fields on the galaxy (e.g. crypto rnd).
- `galaxyFromJSON` rebuilds `Habitat` instances without re-running generation (use `Object.create(Habitat.prototype)` + assign if the constructor has side effects), then re-links refs.
- Tests: generate seed-1 galaxy → toJSON → JSON.stringify → parse → fromJSON → toJSON; the two JSON strings are identical; `rnd.next()` ×5 identical on original and restored.
`npm run typecheck` && `npm test`. Append `## Worker report`.

## Worker report

Files changed:
- `src/sim/save/galaxySave.ts` (new) — `galaxyToJSON(galaxy)` / `galaxyFromJSON(obj, gameData)`.
- `test/galaxySave.test.ts` (new) — seed-1 round-trip tests.

Done:
- Habitats serialized with plain fields; object refs → indices (`parentIndex`, system's `systemStarIndex` + `habitats` indices). `ownerIndex`/`empireIndex` written as -1 with TODO(port) for part 2.
- GalaxyLocations and creatures: plain fields, habitat refs → index; creature `anchorPoint` inlined, `turnDirection` as number.
- RNG: `rnd` and `cryptoRnd` via `getState()`/`setState()`.
- Deserialization rebuilds `Habitat`/`Creature`/`Galaxy` instances via `Object.create(ctor.prototype)` + field assignment (no generation re-run); `_anglePerSecond` recomputed from orbit params; parents/system membership/location grids re-linked.
- Tests: seed-1 galaxy → toJSON → stringify → parse → fromJSON → toJSON produces byte-identical JSON; `rnd.next()` ×5 identical on original vs restored; counts and parent links preserved.
- `npm run typecheck` and `npm test` both pass (458 tests).

Left undone (task 11a2):
- Owner/empire references, empires lists, cargo/troops/facilities, empireTerritory, dominantEmpire/otherEmpires are stubbed (null/-1) pending the empire serialization part.
- Minor divergence noted: load fills `habitatIndexGrid` using each habitat's own cell, while generation fills every group member into the group's first-habitat cell; no effect on the round-trip test.
