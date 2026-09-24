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
