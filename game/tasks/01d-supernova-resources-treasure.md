# Task 01d — Galaxy fidelity: supernova fields, habitat resources, treasure asteroids

Depends on 04c (correct resource data). Goal: remove `TODO(port)` gaps in `src/sim/galaxy.ts` that desync the random sequence. **Every `Rnd` call in the ported C# must be reproduced in order.** Work function by function (Read with offset/limit, port, next).

`$SRC` = `/home/justinf/.local/share/Steam/steamapps/common/Distant Worlds Universe/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/DistantWorlds.Types`

1. **Supernova** — `$SRC/Galaxy.5.cs` 1350–1360 (inside SetupSun): `NovaProgression = 30000 + Rnd.NextDouble()*60000`, `NovaImageIndexMajor = Rnd.Next(0, 20)`, `NovaImageIndexMinor = Rnd.Next(0, 56)` (`GalaxyImages.cs` 96–97). Add the Habitat fields; replace the TODO at galaxy.ts ~line 355.
2. **Resources** — `$SRC/Galaxy.4.cs` 3270+ `SelectResources` (all overloads) and every helper it calls; add `resources: {resourceId, abundance}[]` to `Habitat` (see `$SRC/HabitatResource.cs`, `HabitatResourceList.cs`). The Galaxy now needs the parsed resource definitions from `src/sim/data/` (GameData) — pass them via `generateGalaxy` options (`gameData`), and port `ResourceSystem`'s prevalence lookups it uses (`$SRC/ResourceSystem.cs`, `ResourcePrevalence.cs`). Wire the calls at the `TODO(port): SelectResources` sites (galaxy.ts ~1025, ~1224) and in `GenerateAsteroidField`.
3. **Treasure asteroids** — `$SRC/Galaxy.9.cs` 3419 `GenerateTreasureAsteroid` and its call sites (`Galaxy.9.cs` 3536, `Galaxy.5.cs` 1903); replace the TODO at galaxy.ts ~1034.
4. **SelectHabitatPictures** resource-dependent branch (galaxy.ts ~830 TODO) now that resources exist.

Tests: resources present on planets/asteroids with ids that exist in GameData; gas giants get gas resources per the prevalence tables; deterministic; supernova habitats have nova fields in range.

Done when `npm run typecheck` && `npm test` pass. Append `## Worker report`.

## Note (orchestrator): CryptoRnd
`SelectResources` (`Galaxy.4.cs` 3285–3370) draws from **both** `Rnd` and `CryptoRnd`. `CryptoRnd` is `CryptoRandom` (`CryptoRandom.cs`) — a true cryptographic RNG (`RandomNumberGenerator.Create()`), so the original's resource placement is not reproducible from a seed. Port every `Rnd` call exactly (it drives the shared sequence), but route `CryptoRnd.Next/NextDouble` to a **separate** `Random` seeded from the galaxy seed (e.g. `new Random(seed ^ 0x5eed)`, exposed as `galaxy.cryptoRnd`) so our galaxies stay deterministic. Add a comment saying so.

## Worker report

**Files changed:** `src/sim/types.ts`, `src/sim/galaxy.ts`, `test/galaxy.test.ts`.

**Done:**
1. Supernova fields in `setupSun` (name prefix, `novaProgression`, `novaImageIndexMajor/Minor`, derived diameter) — `Habitat` gained the three nova fields.
2. `SelectResources` + all helpers (`resolveHabitatTypeByIndexIncludeGasClouds`, `checkPrevalenceValidForHabitat`, `generateRandomOrderedResources`, `getResourceByName/Name`) ported from `Galaxy.4.cs`/`ResourceSystem.cs`; `Habitat.resources: {resourceId, abundance}[]` added; parsed `gameData.resources` wired in via `generateGalaxy` options; calls placed at the planet, moon, extra-asteroid, both asteroid-field paths (inlined `Galaxy.5.cs` sets `type` before `SelectResources`, public `generateAsteroidFieldAt` selects while still `BarrenRock` then sets type — both reproduced) and `generateGasCloud`.
3. `GenerateTreasureAsteroid` + gold/crystal name generators ported (`Galaxy.9.cs:3419`); wired at both call sites (`Galaxy.9.cs:3536`, `Galaxy.5.cs:1903` — the latter with `doInitialMove: true`).
4. `SelectHabitatPictures` gas-giant/frozen-gas-giant resource-dependent branches ported.
5. Tests (5 new in `test/galaxy.test.ts`): supernova fields in source ranges; resource ids/abundances/≤5/no-dupes + prevalence validity per `resources.txt`; gas giants only get gas resources matching their own type; treasure asteroid invariants (diameter 35–49, abundance 800–999, star parent, gold 649–656 / crystal 657–664 picture + matching resource id); determinism with `gameData`. `npm run typecheck` and `npm test` both pass (83 tests).

**Deviations (documented in code):**
- `CryptoRnd` (unseeded `CryptoRandom` in C#) is substituted with a separate seeded `Random` (`new Random(Math.imul(seed, 0x5bd1e995) | 0)`, exposed as `galaxy.cryptoRnd`) per the orchestrator note — deterministic, but resource placement is not bit-identical to the original's.
- `TextResolver` not ported: literals `"Asteroid"` and `"Super Nova "` used.
- C# adds `null` to the asteroid list if `GenerateTreasureAsteroid` returns null (no Gold/Dilithium in data); the TS port keeps the original asteroid instead.
- Non-gas-giant cases of `SelectHabitatPictures` keep the pre-existing fake image offsets (pre-01d deviation, noted in the function comment).

**Left undone (pre-existing `TODO(port)`, out of scope for 01d):** `SelectPopulation`, `SelectCreatures`, `DoTasks`, `GalaxyLocation`-based nebula placement (gas clouds still placed on uniform coordinates), `SelectResources` dominant-race critical-resource block (needs empire/race data), `Habitat` population/base lists and `RecalculateCriticalResourceSupplyBonuses`.
