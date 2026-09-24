# Task 01e — Nebulae / GalaxyLocations

Depends on 01d. Port nebula and special-location generation so stars avoid/sit in nebulae exactly like the original.

`$SRC` = `/home/justinf/.local/share/Steam/steamapps/common/Distant Worlds Universe/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/DistantWorlds.Types`

- `$SRC/GalaxyNebulaeGenerator.cs` (621 lines) — note it has its **own** `_Rnd` (seeded from the galaxy RandomSeed): port it as a separate `Random` instance. Skip bitmap/image drawing (`generateImage=false` path) but keep every `_Rnd` call that happens on that path.
- `$SRC/Galaxy.4.cs` ~1900–1920 (the method that calls `GenerateGalaxyNebulae`) and its call from the constructor (~2190: `_GalaxyLocations = locations`, then `AddGalaxyLocationIndex`).
- `$SRC/GalaxyLocation.cs`, `GalaxyLocationType.cs`, `GalaxyLocationEffectType.cs`, `GalaxyLocationShape.cs` — types.
- `DetermineGalaxyLocationsAtPoint` (grep in Galaxy*.cs) and the SetupSun branch at `$SRC/Galaxy.5.cs` 1255–1290 that uses it (`Rnd.Next(0, 15) == 1` + LightningDamage check) — replace the galaxy.ts TODO at ~line 213.
- Expose `galaxy.galaxyLocations` (name, type, x, y, size, shape, effect) for the renderer (region labels like "Nispes Arm", nebula clouds).

Tests: locations generated for each shape, inside bounds, deterministic; stars inside nebula clouds follow the source rule.

Done when `npm run typecheck` && `npm test` pass. Append `## Worker report`.

## Worker report

Files changed:
- **new** `src/sim/galaxyLocation.ts` — `GalaxyLocation`, `GalaxyLocationType`, `GalaxyLocationEffectType`, `GalaxyLocationShape` (serialization members and BuiltObject/Race/CreatureList relations omitted, out of scope).
- **new** `src/sim/galaxyNebulaeGenerator.ts` — port of `GalaxyNebulaeGenerator.cs`, generateImage=false path only. Own `Random` instance seeded from the galaxy `RandomSeed` (independent of the main `Rnd` stream). Spiral arms (Elliptical/Spiral only), 20–40 cluster clouds of 3–10, 40–60 scattered clouds, all `_Rnd` calls preserved in source order.
- **modified** `src/sim/galaxy.ts` — `randomSeed` + `galaxyLocations` + private `galaxyLocationIndex` grid fields; `generateNebulae(cloudImageCount)` (port of `GenerateNebulae` + ctor wiring: index-grid re-init, `AddGalaxyLocationIndex` per location); `addGalaxyLocationIndex` / `removeGalaxyLocationIndex` / `resolveGalaxyLocationIndexes` / `correctIndexCoords` / `determineGalaxyLocationsAtPoint` / `calculateDistanceSquared`; `setupSun` now runs the full source retry loop (nearest gas-cloud/asteroid distance + `DetermineGalaxyLocationsAtPoint(x, y, NebulaCloud)` + `Rnd.Next(0, 15) == 1` + LightningDamage → `flag3`), re-rolls the star type until compatible (sticky `flag3`, do-while), and creates the black-hole "Pull" / "Event Horizon" and supernova `GalaxyLocation` objects (with `AddGalaxyLocationIndex`). `generateGalaxy` calls `generateNebulae` before star placement, with `cloudImageCount` option (default `DEFAULT_CLOUD_IMAGE_COUNT = 40`).
- **new** `test/galaxyLocations.test.ts` — per-shape (all 6 shapes): nebula clouds generated and within bounds; determinism for a fixed seed. Plus: spiral-arm clouds present only for Spiral/Elliptical; black-hole/supernova locations centered on their star (min-distance < 4.0, float32 tolerance); stars inside LightningDamage nebulae are never MainSequence/RedGiant/SuperGiant.

Verification: `npm run typecheck` passes; `npm test` passes (125/125).

Left undone / caveats:
- `cloudImageCount` defaults to 40; the renderer should pass the actual count of `/assets/dwu/images/environment/nebulae/*.png` (only affects `pictureRef` values, not the RNG stream — `Next(0, N)` consumes one sample regardless of N).
- generateImage=true bitmap path (FbmNoise, cloud tinting/rotation, cloud-image sampling) not ported — image-only, never touches `_Rnd`, so the stream is identical.
- `GenerateBlackHoleName` still TODO in `assignSystemName` (Galaxy.4.cs); black-hole location names use the star's existing codename.
- Gas-cloud nebula-anchoring remains a documented deviation (existing TODO); `findNearestSystemGasCloudAsteroid` is still a linear scan (existing TODO).
