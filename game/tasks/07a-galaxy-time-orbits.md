# Task 07a — Galaxy time + orbital motion (pure sim)

thinking: off
scope: locked

Everything you need is here. Create `src/sim/galaxyTime.ts`, add a `step` method to the Galaxy in `src/sim/galaxy.ts`, and tests. **Do not edit `src/main.ts` or anything in `src/ui/` or `src/render/`** (another lane owns them). Start editing right away.

## Source (verbatim C#)
```csharp
// Galaxy.3.cs InitializeStatics
RealSecondsInGalacticYear = 600;
YearLength = RealSecondsInGalacticYear * 1000;   // ms per game year
StartStarDate = 1260000000L;                     // ms  (= year 2100)
// Start.2.cs: startStarDate = Galaxy.StartStarDate + int_5 * 30000000;   (int_5 = "age" option; 30000000 ms = 50 years)

// Galaxy.cs
public long CurrentStarDate => (CurrentDateTime.Ticks - _StartDateTime.Ticks) / 10000 + _StartStarDate;   // ms of game time elapsed + start
public static string ResolveStarDateDescription(long starDate, string datePartSeparator /* "." */)
{
    int num = (int)(starDate / (1000 * RealSecondsInGalacticYear));
    long num2 = (long)num * (long)(1000 * RealSecondsInGalacticYear);
    double num3 = 1000.0 * (double)RealSecondsInGalacticYear / 12.0;
    int num4 = (int)((double)(starDate - num2) / num3);
    long num5 = (long)((double)num4 * num3);
    double num6 = num3 / 30.0;
    int num7 = (int)((double)(starDate - (num2 + num5)) / num6);
    num4++;
    num7++;
    return num.ToString("0000") + datePartSeparator + num4.ToString("00") + datePartSeparator + num7.ToString("00");
}
// Main.Part4.cs speed buttons: speed *= 2 (max 4.0) / speed /= 2 (min 0.25); game time runs at TimeSpeed × real time; Pause/Resume stop/start the clock.

// Habitat.cs Move (called every tick from Habitat.DoTasks with _tempNow = galaxy CurrentDateTime)
double totalSeconds = (_tempNow - _LastTouch).TotalSeconds;
if (OrbitDirection) { _OrbitAngle += _AnglePerSecond * totalSeconds; while (_OrbitAngle >= 2π) _OrbitAngle = ReduceAngle(_OrbitAngle); }
else                { _OrbitAngle -= _AnglePerSecond * totalSeconds; while (_OrbitAngle <= -2π) _OrbitAngle = IncreaseAngle(_OrbitAngle); }
Ypos = Parent.Ypos + Math.Sin(_OrbitAngle) * OrbitDistance;
Xpos = Parent.Xpos + Math.Cos(_OrbitAngle) * OrbitDistance;
```
The `Habitat` class in `src/sim/types.ts` already has this as `private move(totalSeconds)` (ported in task 01a) — reuse it: make it callable (e.g. `advanceOrbit(totalSeconds)` public wrapper) rather than re-implementing.

## Implement
1. `src/sim/galaxyTime.ts`:
   - constants `REAL_SECONDS_IN_GALACTIC_YEAR = 600`, `YEAR_LENGTH = 600_000`, `START_STAR_DATE = 1_260_000_000`, `SPEED_MIN = 0.25`, `SPEED_MAX = 4`.
   - `resolveStarDateDescription(starDate: number, sep = '.'): string` — exact port above (use `Math.trunc` for the C# int/long casts).
   - `class GalaxyTime { startStarDate; elapsedMs = 0; paused = true; speed = 1; advance(realDtMs): number /* returns game ms advanced (0 when paused) */; get currentStarDate(); faster(); slower(); togglePause(); }` — `faster/slower` ×2 / ÷2 clamped to [0.25, 4].
   - `startStarDateForAge(age: number) = START_STAR_DATE + age * 30_000_000`.
2. `Galaxy.step(gameMs: number)`: advance every habitat that has a parent by `gameMs / 1000` seconds via the Habitat orbit method, **parents before children** (stars have no parent; planets before their moons — sort once by depth and cache the order).
3. Tests `test/galaxyTime.test.ts`: `resolveStarDateDescription(1_260_000_000) === '2100.01.01'`; `+ 600_000` → `'2101.01.01'`; `+ 50_000` (one month) → `'2100.02.01'`; `+ 50_000/30 * 5` → `'2100.01.06'`; speed clamps (4 → faster stays 4; 0.25 → slower stays 0.25); paused `advance` returns 0; after `galaxy.step(10_000)` a planet has moved along its orbit (distance to its star unchanged within 1e-6) and each moon stays at its orbit distance from its planet.

`npm run typecheck` && `npm test`. Append `## Worker report`.
