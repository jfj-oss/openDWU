# Task 01 — Seeded RNG + galaxy generation (headless)

Goal: a faithful TypeScript port of the original galaxy generator for **stars, planets, moons, asteroid fields and gas clouds**, so a seed + options gives a galaxy with the same structure as the original. No rendering in this task.

## 1. `src/sim/random.ts` — port of .NET Framework `System.Random`
The engine uses `Galaxy.Rnd` (a `System.Random`). Port the **legacy seeded algorithm** exactly (Knuth subtractive generator, `SeedArray[56]`, `inext`/`inextp`, `MBIG = int.MaxValue`, `MSEED = 161803398`), with:
- `constructor(seed: number)`
- `sample(): number`, `next(): number`, `next(maxValue)`, `next(minValue, maxValue)` (use the large-range sample path when `max - min > int.MaxValue`), `nextDouble()`.
- All arithmetic must be int32-exact (use `| 0` and careful subtraction wraparound). Reference values (add them as tests):
  - `new Random(42)`: `next()` ×3 → `1434747710, 302596119, 269548474`
  - `new Random(42)`: `next(0, 100)` ×5 → `66, 14, 12, 52, 16`
  - `new Random(0).next()` → `1559595546`

## 2. `src/sim/types.ts` — model types
Port only what galaxy generation needs from `DistantWorlds.Types`:
- `HabitatType` enum (Habitat types incl. star types MainSequence/RedGiant/SuperGiant/WhiteDwarf/Neutron/BlackHole/SuperNova, planet types, gas clouds, asteroids…) — copy member order from `HabitatType.cs`.
- `HabitatCategoryType` (Star, Planet, Moon, Asteroid, GasCloud…) from `HabitatCategoryType.cs`.
- `GalaxyShape` from `GalaxyShape.cs`.
- `Habitat` interface/class with the fields generation sets (name, category, type, xpos, ypos, parent, orbitAngle/orbitDistance/orbit direction, diameter, pictureRef, landscapePictureRef, baseQuality, systemIndex, habitatIndex, scenic factor, research bonus…) — see `Habitat.cs` constructor(s).
- `SystemInfo` (systemStar, habitats, sector) from `SystemInfo.cs`.

## 3. `src/sim/galaxy.ts` — generator
Port, in the original call order, from `$DWU/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/DistantWorlds.Types/`:
- `Galaxy.3.cs` `SetGalaxyPhysicalDimensions` (SizeX/SizeY from sector width/height; SectorSize = 2,000,000) and the IndexSize/IndexMaxX/Y setup used by the constructor.
- `Galaxy.4.cs` constructor `public Galaxy(...)` (line ~2088): only the parts that build the star field — cluster setup for ClustersEven/ClustersVaried (~line 2221), the `starCount` loop calling `SetupSolarSystem`, the gas-cloud loop (`Rnd.Next(starCount / 5, starCount / 2)` × `GenerateGasCloud`), the sort, re-indexing, and building `Systems`. Skip empire/race/creature/pirate/resource steps with `TODO(port)` notes, **but keep every `Rnd` call that lies between the steps you port** where skipping it would change the random sequence of the steps you do port; if a skipped step consumes random numbers before stars are generated, note it in the report.
- `Galaxy.5.cs` `SetupSolarSystem` (line ~1375–1700) and `SetupSun` (find it), including planet count tables by star type and StarCount, orbit distances, moons, asteroid fields, and `SetScenicFactor` / `SetResearchBonus`.
- `SelectPlanetType`, `SelectMoonType`, `CalculatePlanetTypePrevalenceByStarType` (`Galaxy.6.cs` ~2307), `SelectHabitatQuality`, `SelectHabitatPictures`, and the star-location selection for every `GalaxyShape` (find where `SetupSun` picks x/y per shape).
- `GenerateGasCloud()` (`Galaxy.4.cs` ~2794).
- Naming: `AssignSystemName`, `GenerateCodeName` and friends; system names come from `$DWU/systemNames.txt` — pass the name list in as a parameter (sim must not do file I/O; add a small loader in `src/sim/data.ts` that takes file text).
- Out of scope (leave `TODO(port)`): `SelectResources`, `SelectPopulation`, `SelectCreatures`, ruins, GalaxyLocations/nebulae, empires.

Public API:
```ts
export interface GalaxyOptions { seed: number; shape: GalaxyShape; starCount: number; sectorWidth: number; sectorHeight: number; colonyPrevalence: number; systemNames: string[] }
export function generateGalaxy(o: GalaxyOptions): Galaxy   // Galaxy has sizeX, sizeY, sectorSize, habitats, systems
```
Find the default `sectorWidth/sectorHeight` for each galaxy size the new-game screen offers (look in `DistantWorlds/Start*.cs` and `StartGameOptions.cs`) and export them as a table.

## 4. Tests — `test/random.test.ts`, `test/galaxy.test.ts`
- Random: known .NET value for seed 42 (above); determinism; `next(a,b)` stays in `[a,b)`.
- Galaxy (read `systemNames.txt` from `public/assets/dwu/systemNames.txt` with `fs`): for each shape with 700 stars → exactly 700 star systems + gas clouds; all coordinates inside [0,sizeX]×[0,sizeY]; every planet's parent is a star in the same system; moons orbit planets; same seed ⇒ identical output (deep-equal of a summary); a spiral galaxy's star density is higher near the center than at the rim.

## Done when
`npm run typecheck` and `npm test` pass. Append the Worker report to this file.
