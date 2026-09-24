# Task 08e1 — Home-system colony helpers (colony placement, part 1)

thinking: off
scope: locked

Edit `src/sim/galaxy.ts` and tests only. Start editing right away.

## Why split
Colony placement at game start is `Galaxy.7.cs GenerateEmpire` (5089-5377). It interleaves `Rnd` calls with Empire, policy, tech, troops and money setup (e.g. `Rnd.Next(0, 8)` for capital quality, `DetermineEmpireExpansion(Rnd, age)`, `Rnd.NextDouble()` for population), so porting only part of that sequence would desync the stream. This task ports the **habitat-side helpers** GenerateEmpire calls at its end, as standalone Galaxy methods with their exact Rnd sequences. **08e2** (blocked on an Empire model) wires them into GenerateEmpire / MakeHabitatIntoColony (Galaxy.8.cs 639) / SetColonyResources (699).

## Source (verbatim references; read these files)
- `Galaxy.8.cs 95 SetColonizableHabitatsInSystem(galaxy, systemStar, race, colonyCount)`
- `Galaxy.8.cs 367 CheckPlanetaryOrbitalOverlap` (±150) and `390 GeneratePlanetaryOrbitDistance` (≤20 retries)
- `Galaxy.8.cs 458 GenerateContinentalPlanet` — only the habitat fields: Select…Planet, orbit distance, `new Habitat(…, GenerateRandomName(), sun, Rnd.NextDouble()*2π, true, dist, Rnd.Next(2,5))`, diameter/pictures, `SelectHabitatQuality`, `SelectResources`, `Rnd.Next(0,5)==2 → OrbitDirection=false`. Cargo/Troops/queues/docking bays → `TODO(port)` (no model yet).
- `Galaxy.9.cs 3225 AddHabitat(habitat, nearestSystemStar)`: insert after the system's last habitat (or star) in `Habitats`, set SystemIndex, append to the system list.
- `Galaxy.8.cs 575 SetResourceLevelsInSystem(galaxy, star, min, max)`
- `Galaxy.8.cs 595 ResolveHomeSystem(desc)`: Harsh→Desert/0.4, Trying→MarshySwamp/0.7, Normal→MarshySwamp/1.0, Agreeable→Continental/1.4, Excellent→Continental/2.0, else Undefined/0.0
- `Galaxy.8.cs 626 DetermineEmpireExpansion(rnd, age)`: `num=1; for (i < age-1) num *= 2.3 + rnd.NextDouble()*(2.7-2.3)` (constants Galaxy.3.cs 5053-5054)
- `Galaxy.7.cs 5348-5375` tail of GenerateEmpire → port as `setupHomeSystem(capital, race, homeSystemDescription, minimumResourceCount, minimumCriticalResourceCount)`: the Harsh/Trying/Normal/Agreeable/Excellent chain of (colonyCount, resource min/max) = (0,0,1) (0,0,2) (0,1,4) (1,1,5) (2,2,5), then `capital.Resources.Clear(); SelectResources(capital, minRes, race, minCrit)`. **That is the 4-arg overload, which drops the race (see 08c)**, so pass `null`.

Notes: TS `SystemInfo.habitats` includes the star at index 0, while C# `Systems[star].Habitats` doesn't, so skip the star. Nothing has an Owner yet, so treat `Owner == null` as true.

## Tests
ResolveHomeSystem table; DetermineEmpireExpansion(age 1) = 1 and age 3 lies in [2.3², 2.7²]; SetColonizableHabitatsInSystem with colonyCount 2 leaves ≥2 native-type habitats (converting or adding planets, and the system/habitats lists stay consistent); with colonyCount 0, every unpopulated native-type non-asteroid becomes BarrenRock; SetResourceLevelsInSystem bounds; deterministic; existing tests unchanged.

`npm run typecheck` && `npm test`. Append `## Worker report`.

## Worker report (cloud)
- `galaxy.ts`: resolveHomeSystem, determineEmpireExpansion (static), checkPlanetaryOrbitalOverlap, generatePlanetaryOrbitDistance, generateContinentalPlanet, addHabitat, setColonizableHabitatsInSystem, setResourceLevelsInSystem, setupHomeSystem. Nothing calls them from generateGalaxy yet (that's 08e2), so existing galaxies and pins are unchanged.
- `test/homeSystem.test.ts`: 6 tests. Typecheck clean; 219/219 pass.
