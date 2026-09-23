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
