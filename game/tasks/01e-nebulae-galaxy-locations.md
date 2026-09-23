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
