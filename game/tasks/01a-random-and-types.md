# Task 01a — .NET Random port + core model types

**Work style: small and incremental.** Read only the files listed, using Read with offset/limit. Write each file as soon as you have read what it needs. Do not survey other source files.

`$SRC` = `/home/justinf/.local/share/Steam/steamapps/common/Distant Worlds Universe/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/DistantWorlds.Types`

## 1. `src/sim/random.ts` — .NET Framework `System.Random` (legacy seeded algorithm)
Class `Random` with `constructor(seed: number)`, `next()`, `next(max)`, `next(min, max)`, `nextDouble()`. Algorithm (from the .NET reference source):
```
MBIG = 2147483647, MSEED = 161803398; SeedArray = int[56]
ctor(seed): subtraction = (seed == int.MinValue) ? int.MaxValue : abs(seed)
  mj = MSEED - subtraction; SeedArray[55] = mj; mk = 1
  for i in 1..54: ii = (21*i) % 55; SeedArray[ii] = mk; mk = mj - mk; if (mk < 0) mk += MBIG; mj = SeedArray[ii]
  for k in 1..4: for i in 1..55: SeedArray[i] -= SeedArray[1 + (i+30) % 55]  (int32 wrap); if (SeedArray[i] < 0) SeedArray[i] += MBIG
  inext = 0; inextp = 21
InternalSample(): if (++inext >= 56) inext = 1; if (++inextp >= 56) inextp = 1
  ret = SeedArray[inext] - SeedArray[inextp]; if (ret == MBIG) ret--; if (ret < 0) ret += MBIG; SeedArray[inext] = ret; return ret
Sample() = InternalSample() * (1.0 / MBIG)
Next() = InternalSample()
Next(max) = (int)(Sample() * max)
Next(min, max): range = (long)max - min; if (range <= int.MaxValue) return (int)(Sample() * range) + min
                else return (int)((long)(GetSampleForLargeRange() * range) + min)
GetSampleForLargeRange(): result = InternalSample(); negative = InternalSample() % 2 == 0; if (negative) result = -result
  d = result; d += (int.MaxValue - 1); d /= 2 * (uint)int.MaxValue - 1; return d
NextDouble() = Sample()
```
Tests `test/random.test.ts` (must pass exactly):
- `new Random(42)`: `next()` ×3 → `1434747710, 302596119, 269548474`
- `new Random(42)`: `next(0, 100)` ×5 → `66, 14, 12, 52, 16`
- `new Random(0).next()` → `1559595546`

## 2. `src/sim/types.ts` — enums + Habitat
Read and port **member order exactly** (TS numeric enums):
- `$SRC/HabitatType.cs`, `$SRC/HabitatCategoryType.cs`, `$SRC/GalaxyShape.cs`, `$SRC/HabitatAtmosphereType.cs`.
- `Habitat` class: read `$SRC/Habitat.cs` lines 6165–6260 (the constructors) and port them: fields name, category, type, xpos, ypos, parent (Habitat | null), orbitAngle, orbitDirection, orbitDistance, orbitSpeed, plus plain fields set later by generation: diameter, pictureRef, landscapePictureRef, baseQuality, atmosphere, atmosphereDensity, systemIndex, habitatIndex, scenicFactor, researchBonus. If the constructor computes position from the parent + orbit (doInitialMove), port that math.
- `SystemInfo` { systemStar: Habitat; habitats: Habitat[]; sector: {x,y} }.

## Done when
`npm run typecheck` && `npm test` pass. Append a short `## Worker report` to this file.
