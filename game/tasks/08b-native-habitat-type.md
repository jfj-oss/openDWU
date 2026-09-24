# Task 08b — Fix race native habitat type (native populations never placed)

thinking: off
scope: locked

Everything you need is here. Edit `src/sim/data/races.ts`, `src/sim/galaxy.ts`, `src/sim/types.ts` (if the helper goes there) and tests. Start editing right away.

## Bug
`races.ts` stores `NativePlanetType` as the raw file number (1–5) in `nativePlanetType`, and `galaxy.ts` compares it to `habitat.type` (lines ~1834 and ~1865) — HabitatType values are 8–16, so it never matches and no native populations are ever placed.

## Source (verbatim C#)
```csharp
// Race.cs LoadFromFile, line 1286
case "NativePlanetType":
    race.NativeHabitatType = Galaxy.ResolveColonyHabitatTypeByIndexDesertBeforeOcean(ParseIntValue(value));

// Galaxy.4.cs 746
public static HabitatType ResolveColonyHabitatTypeByIndexDesertBeforeOcean(int index)
{
    return index switch
    {
        0 => HabitatType.Continental,
        1 => HabitatType.MarshySwamp,
        2 => HabitatType.Desert,
        3 => HabitatType.Ocean,
        4 => HabitatType.Ice,
        5 => HabitatType.Volcanic,
        _ => HabitatType.Continental,
    };
}
public static int ResolveColonyIndexByHabitatTypeDesertBeforeOcean(HabitatType type)
{
    return type switch { Continental => 0, MarshySwamp => 1, Desert => 2, Ocean => 3, Ice => 4, Volcanic => 5, _ => -1 };
}
// every C# comparison uses race.NativeHabitatType (a HabitatType), e.g. Galaxy.6.cs 1234:
//   if (race != null && race.NativeHabitatType == habitat.Type && !CheckIndependentColonyLimitForRace(race))
// and Galaxy.6.cs 1333: if (habitat.Type == race.NativeHabitatType)
```

## Implement
1. Port both helpers (e.g. in `src/sim/types.ts` next to `HabitatType`, exported).
2. `races.ts`: keep the raw `nativePlanetType` and add `nativeHabitatType: HabitatType = resolveColonyHabitatTypeByIndexDesertBeforeOcean(nativePlanetType)`.
3. `galaxy.ts`: every comparison against the race's native type uses `race.nativeHabitatType` (grep `nativePlanetType` in `src/sim/` and replace comparisons).
4. Tests: helper table (0..5 and out-of-range → Continental; inverse → -1 for non-colony types); every parsed race's `nativeHabitatType` is one of the six colony types; a 700-star galaxy (seed 1, default options) now has **> 0 habitats with native populations**, deterministic; the existing native-population tests now exercise the match path (update any test that asserted zero populations).

`npm run typecheck` && `npm test`. Append `## Worker report`.
