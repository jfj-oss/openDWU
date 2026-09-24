# DWU game — worker commit review + TODO(port) backlog

Reviewed against each commit's task file in `game/tasks/`. All paths below are relative to `/home/user/Dwureup/game` unless given absolute. C# source under `/home/justinf/...` does not exist in this environment; verification against original C# was possible only where the task file pasted verbatim excerpts (01d, 01f1, 01f2, 01f3, 01g). 01e (`GalaxyNebulaeGenerator`) and the HUD/clock commits had no pasted C# to check line-by-line, so those are reviewed only for internal consistency and task-spec compliance.

## 1. Review of recent worker commits

### 07a-galaxy-time-orbits (`a266e5b`)
Looks correct. `resolveStarDateDescription` in `src/sim/galaxyTime.ts:15-25` is a faithful, term-by-term port of the pasted `Galaxy.cs ResolveStarDateDescription` (including the C# int/long truncation via `Math.trunc`), and the task's own test vectors (`2100.01.01`, `+600_000 → 2101.01.01`, etc.) pass. `Galaxy.step` (`src/sim/galaxy.ts:176-213`) advances parents before children via a cached depth sort — no bugs found.

### 07b-wire-clock (`d48f25e`)
Looks correct. `clock.ts` is cleanly reduced to a re-export of `GalaxyTime` (`src/sim/clock.ts`), no leftover references to `GAME_SPEEDS`/`stepSpeed`/`createGameClock` remain anywhere in `src/` or `test/` (verified with a repo-wide grep — clean). `main.ts:187-192` wires `time.advance()` → `galaxy.step()` in ticker order correctly. One very minor gap: `src/ui/hud.ts`'s own `refreshPauseGlyph()` (called on the pause button's `click` handler, `hud.ts:229-233`) does not also refresh the date label, but `main.ts` polls `refreshClockLabel` every 250 ms independently, so the visible label lags at most 250 ms behind a pause/resume click — not worth a fix.

### 05d-hud-touchups (`f43b190`)
Looks correct. `resolveCaseInsensitive` (`vite.config.ts:20-49`) and the dev-server middleware are careful (reject `.`/`..`, cache directory listings, exact-path fast-path via `next()`). Panel opacity/blur, chip-label pills, and the options-list auto-height/scroll changes match the task's four numbered items.

### 05c-hud-streamlined (`a32043d`)
One documented deviation, since resolved by a later commit — not a live bug: the worker started the clock **running** instead of **paused** (task item 2 said "start paused"); the worker's own report flags this. Task 07b later replaced `GameClock` with `GalaxyTime`, which does start paused, so the deviation no longer exists in the current tree. No action needed.

### 01f1-alien-race-regions (`43dc11c`)
Mechanically faithful port of `SetupAlienRacePopulations`/`DetermineAggressiveRaces`/`DetermineRaceRegion`/`CheckDistanceFromLocation`/`CheckLocationOverlap` against the pasted C#. One doc-only nit: `src/sim/raceRegions.ts:69-70` comments that the AABB overlap check (`checkLocationOverlap`, lines ~79-92) is "inclusive on both sides," but the implemented test (`rectX < ox+ow && rectX+rectW > ox && ...`) is a strict open-interval test, matching .NET `Rectangle.IntersectsWith`'s actual (non-inclusive, touching edges don't count) semantics. The **code** is correct; only the comment is wrong and could mislead a future porter checking boundary behavior — fix the comment wording (drop "or touch"/"inclusive").

### 01f2-native-populations (`f7af454`)
**Bug found.** `calculatePopulationAmount` (`src/sim/galaxy.ts:1749-1761`, line **1756**) omits the C# `(long)num` truncation before multiplying by the `Rnd.Next(...)` roll:
```ts
num2 = num3 < 0 || num3 > 6 ? this.rnd.next(100000, 300000) * num : this.rnd.next(300000, 600000) * num;
```
The source is `Rnd.Next(100000, 300000) * (long)num` — `num` (a float, `habitat.baseQuality * 1000`, possibly `* 1.5`) must be truncated to an integer *before* the multiply. As written, the TS keeps the fractional part of `num`, so `num2` (and hence every native population's `amount`) differs from the original by a small multiplicative fudge whenever `baseQuality*1000` isn't a whole number (i.e. almost always). Fix: `num2 = num3 < 0 || num3 > 6 ? this.rnd.next(100000, 300000) * Math.trunc(num) : this.rnd.next(300000, 600000) * Math.trunc(num);`.

Test-quality note (already flagged by the worker, repeating here since it affects what the tests actually prove): the "native populations" describe block's population-creation tests can't exercise the real match path — the parsed race `nativePlanetType` values (1-5) and generated `HabitatType` enum values (8-16) never compare equal with the current data files, so `selectPopulation` always takes the "no match" branch in every test run. The tests therefore only prove "no populations when types can't match," not that population placement works. This is a pre-existing data/schema mismatch outside 01f2's scope, but the backlog should track it (see 08b below) since it silently defeats every population-placement test until fixed.

### 01f3-creatures (`93c9220`)
Looks correct against the pasted `SelectCreatures`/`GenerateCreatureAtHabitat`/`CreatureType`. `determineHabitatSystemStar` correctly walks to the top-level parent; `selectCreatures` branch order/probabilities/constants match; `generateCreatureAtHabitat`'s per-`CreatureType` switch matches the source including the `RockSpaceSlug` big-slug roll (`Rnd.Next(0,30)===1` → size/attack/threshold). Documented deviation (worker's own report, reasonable): `Creature` ctor `pictureRef` per-species defaults are invented placeholders because the pasted `Creature.cs` excerpt was truncated before that block — flagged in code, not a silent bug.

### 01e-nebulae-galaxy-locations (`9ff3f17`)
Could not be checked line-by-line (task file references `GalaxyNebulaeGenerator.cs` by path/line range only, no verbatim C# pasted, and the source doesn't exist in this environment). The port is internally consistent (own seeded `Random`, spiral-arm/cluster/scattered-cloud loops all in one RNG stream, `checkOverlapExistingLocation`/`checkWithinGalaxyBounds` gating matches the described control flow) and its own tests pass. Recommend the orchestrator (who has the C# source) diff `galaxyNebulaeGenerator.ts` against `GalaxyNebulaeGenerator.cs` directly — this is the single largest ported file with no independent verification in this review.

### 01d-supernova-resources-treasure (`da45215`)
Mechanically sound where checkable (supernova fields, `GenerateTreasureAsteroid`, `generateGoldAsteroidName`/`generateCrystalAsteroidName`, the `SelectResources` core loop) all match the described C# structure and constants (abundance ranges, picture-ref offsets, treasure diameter 35-49 etc.). The `SelectHabitatPictures` GasGiant/FrozenGasGiant resource-dependent branches (`src/sim/galaxy.ts` ~1082-1165) were not pasted verbatim in the task file (only referenced by line range/constants in a comment), so their exact `Rnd.Next` argument counts (e.g. `67 + Rnd.Next(0, 10+10+11+13+10)`) could not be independently verified here — worth a source diff by the orchestrator. The `CryptoRnd` substitution (deterministic seeded `Random` instead of the true `CryptoRandom`) is a documented, orchestrator-approved deviation.

## 2. TODO(port) backlog

Grouped into small worker-task candidates, in the existing `NNx` naming style. Dependencies noted.

### 08a — Black-hole/moon names, scenic features, research-bonus industry — ✅ DONE by cloud session (task 01g, bd05f50); only `TODO(port): GenerateRandomNameAlt` remains
This is exactly **task `01g-galaxy-leftovers.md`**, already written and locked, just not yet run by a worker. No new task needed — just dispatch it. Covers:
- `src/sim/galaxy.ts:688` — `TODO(port): GenerateBlackHoleName`
- `src/sim/galaxy.ts:2400` — `TODO(port): GenerateMoonName`
- `src/sim/galaxy.ts:731` — `TODO(port): ResearchBonusIndustry` (SetResearchBonus)
- `src/sim/galaxy.ts:756`, `:788` — `TODO(port): ScenicFeature strings, HasRings` / remaining `SetScenicFactor` cases
Depends on: nothing new (galaxy.ts only). No dependency on 08b/08c below.

### 08b — Race/habitat-type data schema mismatch — ✅ FIXED in 64dea7a (race.nativeHabitatType via ResolveColonyHabitatTypeByIndexDesertBeforeOcean; see 08b-native-planet-type-FINDINGS.md)
Not a `TODO(port)` comment in code, but surfaced by 01f2's worker report and confirmed here (see bug above): parsed race `nativePlanetType` (1-5) never equals generated `HabitatType` enum values (8-16), so `selectPopulation` (`src/sim/galaxy.ts` ~1780) never actually places a native population with current data, and `01f2`'s tests can't exercise the match branch. Needs the orchestrator to check `races.txt`/`races.ts` against `Galaxy.6.cs SelectRandomRacePreferHospitableHabitats`'s `HabitatType` cases and either fix the data parser's enum mapping or add a translation table. No file:line TODO(port) marker exists for this — recommend adding one at `src/sim/galaxy.ts:1780` once triaged.
**Fixed in 50a6942:** the in `calculatePopulationAmount` (`src/sim/galaxy.ts:1756`, missing `Math.trunc(num)` before the two `Rnd.Next(...) * num` branches) — a one-line fix, doesn't need a full task, but should ride along with whatever touches this function next.
Depends on: 01f1/01f2 (already landed).

### 08c — SelectResources dominant-race critical resources
`src/sim/galaxy.ts:1295` — `TODO(port): critical resources from dominantRace's colonyGrowthResourceLevels (Rnd.Next(200,800) abundances) — Galaxy.4.cs SelectResources`. Currently unreachable (`dominantRace` is always `null` at every call site), so no live desync yet — but any future task that starts passing empire/colony data into `selectResources` must implement this branch first. Depends on: an empire/colony model existing (none yet) — low priority until that lands.

### 08d — Habitat per-tick DoTasks / Move bookkeeping
- `src/sim/types.ts:202` — `TODO(port): per-tick Move(galaxy) driven by Galaxy time — Habitat.cs:Move` (the `_LastTouch` real bookkeeping; `Galaxy.step` from 07a already drives orbit motion directly, so this is lower priority, but `_LastHugeTouch`/`_LastLongTouch`/`_LastPeriodicTouch` bookkeeping — `src/sim/types.ts:121` — is needed for periodic per-habitat game logic (resource regen, colony growth ticks, etc.) once those exist).
- `src/sim/galaxy.ts:2133`, `:2226` — `TODO(port): DoTasks(CurrentDateTime)` at the planet/moon setup sites.
Depends on: a galaxy-time-driven "tick" concept beyond orbit motion (07a/07b already gave us the clock; this task would be "wire DoTasks into Galaxy.step").

### 08e — Colony placement
`src/sim/galaxy.ts:2464` — `TODO(port): colony placement — later task` (`colonyPrevalence` is accepted but unused; no colonies generated yet). This is a large task (empires, starting colonies, `EmpireStart` full model — `raceRegions.ts` currently takes already-resolved `EmpireStart`s as a stub). Depends on: 01f1 (landed) for race regions; needs its own empire/colony data model task before this can be scoped tightly.

### 08f — Main View region labels / nebula rendering
- `src/render/mainView.ts:12-14` — `TODO(port): GalaxyLocation region names (e.g. "Nispes Arm")` at galaxy zoom; hook already left as `regionLabels`.
- `src/render/mainView.ts:15-16` — `TODO(port): nebula-anchored gas-cloud placement / radiation fields — Galaxy.4.cs GenerateGasCloud`.
Depends on: 01e (`galaxy.galaxyLocations`, already landed) for the labels; the nebula-anchoring half additionally needs `findNearestSystemGasCloudAsteroid`'s current O(n) linear scan (`src/sim/galaxy.ts:268`, currently just a perf TODO, not correctness) to stay as-is or be optimized. This is a **render-layer** task (`src/render/`, `src/ui/` territory), separate from the sim-side backlog above — coordinate with whichever lane owns `src/render/mainView.ts`.

### 08g — Click-to-select in Main View
`src/main.ts:164` — `TODO(port): click-to-select in MainView's input handlers, Controls/MainView.cs mouse handling`. Currently the HUD's selection is a "nearest to camera centre" demo stand-in (`pickSelection`). Needs Main View picking support first (render-layer), then wiring into `hud.onSelectionChange`. Depends on: whatever lane owns `src/render/mainView.ts` / `src/main.ts` exposing a pick API.

### 08h — Creature movement/AI tick
`src/sim/creature.ts:27` — `TODO(port): creature movement/AI tick — Creature.cs Move/DoTasks`. Low priority; creatures currently spawn correctly at generation (01f3) but never move. Depends on: 08d's galaxy-tick plumbing being in place first (same `DoTasks`-style per-tick mechanism).

## Verification run

- `npm run typecheck` — **clean**, no errors.
- `npm test` — **118 passed, 46 skipped, 3 suites failed** (all three failures are `ENOENT: .../public/assets/dwu/races` — the `$DWU` art/data symlink doesn't exist in this environment, exactly as the task setup warned). The 46 skipped tests are in `test/data-content.test.ts` (26) and `test/galaxy.test.ts` (20): these are gated behind loading real race/resource data from `public/assets/dwu/*` via `loadGameDataFs`, which throws `ENOENT` before any `it()` can run when that directory is missing, causing vitest to report them skipped rather than failed (three suites reported as failed suites for the same root cause — the ENOENT surfaces once per file at collection time — while the individual gated `it()`s inside `galaxy.test.ts` show as skipped, not failed, since they're behind a shared `beforeAll`-style guard). Nothing here indicates a real regression; it's purely the missing `$DWU` symlink in this sandboxed review environment.
