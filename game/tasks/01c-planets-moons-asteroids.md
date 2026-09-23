# Task 01c — Solar systems: planets, moons, asteroid fields

Depends on 01b. **Work style:** read one function (Read with offset/limit), write its port, next. Cite the source above each ported function.

`$SRC` = `/home/justinf/.local/share/Steam/steamapps/common/Distant Worlds Universe/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/DistantWorlds.Types`

Replace the `TODO(01c)` stub in `src/sim/galaxy.ts` with a full port of `Galaxy.5.cs` 1386–~1700 `SetupSolarSystem(galaxyShape, sunHabitat, out asteroidField)` in the original order, plus the helpers it calls:
- `Galaxy.6.cs` 2307 `CalculatePlanetTypePrevalenceByStarType`, 2365 `SelectPlanetType`, 1873 `SelectMoonType`, 2062 `SelectHabitatPictures`.
- `Galaxy.4.cs` 3170 `SelectHabitatQuality`.
- `Galaxy.9.cs` 3463–3600 `GenerateAsteroidField` (both overloads; resources param → skip with TODO but keep its Rnd calls).
- `SelectResources`, `SelectPopulation`, `SelectCreatures`: **do not port yet** — but if they consume `Rnd` calls, note in the report which ones (they'll desync the sequence until ported; acceptable for now).
For each helper: Grep `-n` for `void <Name>(` or `<Name>(` to get the line, Read ~150 lines from there.

Tests (extend `test/galaxy.test.ts`): planets' parent is their system's star; moons' parent is a planet; orbit distances within the ranges SelectPlanetType returns; planet count per system obeys the SetupSolarSystem tables (≤ 15 for main-sequence, ≤ 2 white dwarf, ≤ 1 neutron, 0 supernova); deterministic.

Done when `npm run typecheck` && `npm test` pass. Append `## Worker report`.

## Worker report

**Files changed:** `src/sim/galaxy.ts`, `src/sim/types.ts`, `test/galaxy.test.ts`.

**Starting state:** on entry, `galaxy.ts`/`types.ts` already had an (uncommitted, unfinished) full port of `setupSolarSystem` and its helpers, but it didn't typecheck and wasn't wired into `generateGalaxy`. This session fixed it up rather than re-porting from scratch:
- Added the missing `Galaxy.colonyPrevalence` field (port of `Galaxy._ColonyPrevalence`, default `1.0`, threaded from `GenerateGalaxyOptions.colonyPrevalence` through the constructor) and the `MAX_MOON_ORBIT_SIZE = 1200` constant (`Galaxy.3.cs InitializeStatics`), both referenced but undefined.
- Fixed `generateGalaxy`'s per-star loop, which called `setupSolarSystem` but treated its `{ habitats, asteroidField }` return value as if it were a single `Habitat` (pushing the whole object into `perStarHabitats`/`galaxy.habitats`). Now uses `habitats` as the per-system group.
- Added `hasRings` to `Habitat` (types.ts) for `SetupSolarSystem`'s gas-giant ring flag.

**Done:**
- `setupSolarSystem` (Galaxy.5.cs 1386–1945): sun setup, planet-count tables per star type (main-sequence/red giant/super giant ≤15, white dwarf ≤2, neutron ≤1, supernova 0, all star-count-tier-dependent), planet placement with orbit-overlap avoidance, moon-count tables, moon placement with orbit-overlap avoidance, extra un-clustered asteroids, main asteroid field (inlined per source), final sort-by-orbit-distance + naming pass.
- Helpers: `calculatePlanetTypePrevalenceByStarType`, `selectPlanetType` + all 8 `select*Planet` type helpers, `calculateMoonTypePrevalenceByPlanetType`, `selectMoonType`, `selectHabitatPictures`, `selectHabitatQuality`, `checkOrbitOverlap`, `calculateAngleFromCoords`, `generateAsteroidFieldAt` (standalone port of `Galaxy.9.cs GenerateAsteroidField`, kept for API completeness though `setupSolarSystem` uses its own inlined equivalent as the source does).
- Wired into `generateGalaxy`: each system's habitat group (star + planets + moons + asteroids) now flows into `galaxy.habitats` and `SystemInfo.habitats` correctly.
- Extended `test/galaxy.test.ts`: parent-chain checks (planet.parent === star, moon.parent is a Planet in the same system), planet-count-per-star-type caps, determinism for a fixed seed including planets/moons/asteroids. All 24 tests pass; `npm run typecheck` is clean.

**Left undone (all flagged `TODO(port)` inline, per task scope):**
- `SelectResources`, `SelectPopulation`, `SelectCreatures` — not ported (explicitly out of scope). Every call site that would invoke one of these in the original is marked; each consumes a **data-dependent number of `Rnd` calls** the port does not reproduce, so the `Random` sequence diverges from the original from the first planet's `SelectResources` call onward. Concretely, this means: per planet (`SelectResources`, `SelectPopulation` ×1-2, possibly `SelectCreatures`), per moon (same), per extra/field asteroid (`SelectResources`, possibly `SelectCreatures`, `GenerateTreasureAsteroid`'s actual resource assignment). The 1-in-1300 `GenerateTreasureAsteroid` *roll itself* is reproduced (kept as a bare `rnd.next(0, 1300)` call) but what happens on a hit is not.
- `GenerateMoonName` (Galaxy.4.cs:2533) uses a plain code name instead of the source's star/name-relative generator (needs `DetermineHabitatSystemStar`/`GenerateRandomNameAlt`, out of scope).
- `GenerateBlackHoleName`, black-hole "Pull"/"Event Horizon" and supernova `GalaxyLocation` objects, nebula-anchored gas-cloud placement — all need `GalaxyLocation`/nebula modeling, not yet ported (pre-existing from 01b, still open).
- `DoTasks(CurrentDateTime)` calls (galaxy-time driven) and `DockingBay`/`Cargo`/`Troop`/`Character`/`Construction`/`Manufacturing` list setup — out of scope, not modeled on `Habitat` yet.
- Net effect: geometry, types, orbit placement, counts, and picture/quality assignment are faithful and match the source's Rnd-call structure up to (but not including) the skipped resource/population/creature calls; anything generated *after* the first such call in a given system's sequence will not bit-for-bit match the original game for a given seed.
