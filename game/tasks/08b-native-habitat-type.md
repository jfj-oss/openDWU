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

## Worker report

Files changed:
- `src/sim/types.ts` — added exported `resolveColonyHabitatTypeByIndexDesertBeforeOcean(index)` (0..5 → Continental/MarshySwamp/Desert/Ocean/Ice/Volcanic, out-of-range → Continental) and its inverse `resolveColonyIndexByHabitatTypeDesertBeforeOcean(type)` (non-colony types → -1), next to `HabitatType`, with source comments citing Galaxy.4.cs:746.
- `src/sim/data/races.ts` — `Race` keeps raw `nativePlanetType` and gains `nativeHabitatType: HabitatType`; `parseRace` resolves it via the helper (port of Race.cs LoadFromFile line 1286).
- `src/sim/galaxy.ts` — both comparisons now use `race.nativeHabitatType`: `calculatePopulationAmount` (line ~1834, the ×1.5 native bonus) and `selectPopulation` (line ~1865, the placement match). These were the only two uses of `nativePlanetType` in `src/sim/`.
- `test/data-races.test.ts` — new describe block for both helpers (full 0..5 table, out-of-range → Continental, inverse → -1 for non-colony types); every parsed race's `nativeHabitatType` is one of the six colony types and round-trips to its raw index.
- `test/galaxy.test.ts` — updated the task 01f2 native-population block to exercise the match path: a 700-star galaxy (seed 1, default options) now asserts > 0 populated planets / independentCount, with each population's race matching the planet's habitat type; the per-race colony-limit test asserts at least one race has populations; home-system renaming asserts ≥ 1 renamed system. The no-empire-starts and determinism tests still hold unchanged.

Done: all four implementation items plus tests. `npm run typecheck` passes; `npm test` passes (207/207 across 17 files). Nothing left undone.
