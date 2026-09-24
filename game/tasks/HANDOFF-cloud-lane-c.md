# Handoff from cloud lane C (2026-09-24)

Branch `claude/cloud-lane-c`. It already merges the working branch up to `31f487b` (08f3 task file), so merging it should fast-forward. Typecheck clean; 238/238 tests pass with the real assets (no skips).

## Landed
| Task | Commit | Notes |
|---|---|---|
| (a) native populations | none | Already fixed by lane task 08b (`64dea7a`). I checked it against Race.cs:1286 and Galaxy.4.cs:746, and 01f2 tests now go through the match branch. |
| (b) 01e nebulae | none | Already verified by 01h (`c4e2e25`). I re-checked every Rnd call. The only C# Rnd calls missing from the TS are `SelectCloudColor` (image path only) and `GenerateCodeName` (never called). |
| 08c dominant-race critical resources | "task 08c …" | `Race.criticalResources` parsed; `selectResources` branch ported. **Source quirk:** the C# 4-arg `SelectResources` passes `null` for the race (Galaxy.4.cs:3282), so the branch never runs from GenerateEmpire. Pass `null` from 4-arg-style call sites. |
| 08e1 home-system colony helpers | "task 08e1 …" | `setupHomeSystem`, `setColonizableHabitatsInSystem`, `setResourceLevelsInSystem`, `addHabitat`, `generateContinentalPlanet`, `Galaxy.resolveHomeSystem`, `Galaxy.determineEmpireExpansion`. Not called from generation yet. |
| 08h creature ctor + movement | "task 08h …" | The ctor was placeholder data with no Rnd calls, so the galaxy stream was already out of sync with C# after the first creature. It now matches C#. Movement/AI runs from `Galaxy.step`. Combat is TODO(port) until BuiltObjects exist. |

## For the M2 slices
- **M2c (GenerateEmpire):** call `galaxy.setupHomeSystem(capital, race, homeSystemDescription, minimumResourceCount, minimumCriticalResourceCount)` for the tail (Galaxy.7.cs 5348–5375) instead of re-porting it, and `Galaxy.determineEmpireExpansion(galaxy.rnd, age)` for the expansion roll. My 08e1 task file calls this wiring "08e2", which is the same work as M2c, so skip 08e2.
- **M2b (MakeHabitatIntoColony):** `setColonizableHabitatsInSystem` treats every `Owner` as null. When Habitat gets `owner`, add the `(Owner == null || Owner == IndependentEmpire)` checks from Galaxy.8.cs:102/106.
- 08h TODOs that need empires/ships: Reproduce's `num = 4` when the system has a DominantEmpire; Ardilus wander's hyperdrive-tech reject; CheckForTargets/AttackTarget.
- Statistical seed test: spiral density re-seeded 555 → 7 (the creature ctor shifts the Rnd stream).
