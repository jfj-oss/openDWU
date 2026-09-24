# 08b — Race NativePlanetType vs HabitatType: findings

**Status: already fixed on HEAD** by commit `64dea7a game: 08b-native-habitat-type (worker)`. REVIEW-cloud.md item 08b is out of date. No code change needed.

C# root: `$DWU/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/DistantWorlds.Types/`

## (1) How the original parses NativePlanetType
`Race.cs:1286-1288` (LoadFromFile):
```csharp
case "NativePlanetType":
    race.NativeHabitatType = Galaxy.ResolveColonyHabitatTypeByIndexDesertBeforeOcean(ParseIntValue(value));
    break;
```
The raw value is never stored. It is mapped straight to `HabitatType` (`Race._NativeHabitatType`, Race.cs:87/654). The mapping is in `Galaxy.4.cs:746-758`:
```csharp
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
```
All population and placement code compares against `race.NativeHabitatType`, e.g. Galaxy.6.cs:335, :969, :1234, :1333.

## (2) C# HabitatType ordinals (`HabitatType.cs`, `enum : byte`)
Undefined=0, MainSequence=1, RedGiant=2, SuperGiant=3, WhiteDwarf=4, Neutron=5, BlackHole=6, SuperNova=7, **Volcanic=8, Desert=9, MarshySwamp=10, Continental=11, Ocean=12, BarrenRock=13, Ice=14, GasGiant=15, FrozenGasGiant=16**, Hydrogen=17 ... Metal=25.

## (3) Our port vs C#
- `src/sim/types.ts:11-38`: `HabitatType` matches C# member for member, with the same ordinals.
- `src/sim/types.ts:50-70`: `resolveColonyHabitatTypeByIndexDesertBeforeOcean` is a verbatim port of Galaxy.4.cs:746. The inverse is also ported.
- `src/sim/data/races.ts:516-519`: keeps the raw `nativePlanetType` (index 0-5) and adds `nativeHabitatType: resolveColonyHabitatTypeByIndexDesertBeforeOcean(...)`. This matches Race.cs:1287.
- The original bug was comparing the raw index (0-5) to `habitat.type` (8-16). That comparison no longer happens.

## (4) Other comparisons of race planet type to HabitatType
All sim comparisons now use `nativeHabitatType`:
- `src/sim/galaxy.ts:2557` (CalculatePopulationAmount), `:2588` (Galaxy.6.cs:1234), `:2724`
- `src/sim/colony.ts:38`
- `src/sim/game.ts:407, 413, 416, 583, 643, 728`
- `src/sim/empire.ts:860`

`nativePlanetType` (the raw index) is used in only two places. Neither is a bug:
- `src/ui/screens/newGameWizard.ts:187`: the race stat list shows the raw index ("Native Planet Type: 2"). This is a cosmetic gap. Optionally change the key to `nativeHabitatType` and render `HabitatType[value]`.
- `test/data-races.test.ts:49`: a round-trip check.

A related raw-index field, `immuneNaturalDisastersAtColonyType`, is also resolved (`races.ts:587`, via `resolveColonyHabitatTypeByIndexIncludingUndefined`).

Tests: `vitest run test/data-races.test.ts test/galaxy.test.ts -t "native|resolveColony"` gives 9 passed. The 01f2 "native populations" block now asserts that populations are placed (`test/galaxy.test.ts:673-700`).

## Fix proposal
No sim fix is required. Remaining housekeeping:
1. `tasks/REVIEW-cloud.md` 08b: mark "Fixed in 64dea7a".
2. Optional cosmetic change in `src/ui/screens/newGameWizard.ts:187`: show the habitat type name instead of the raw index.

## Lane C (origin/claude/cloud-lane-c2 @ 8668775)
`git merge-base --is-ancestor 64dea7a origin/claude/cloud-lane-c2` is true, so lane C already contains the fix. `git diff HEAD...origin/claude/cloud-lane-c2` touches galaxy.ts, types.ts and gameData.ts, but none of the hunks touch `nativePlanetType`/`nativeHabitatType`, the resolver, or races.ts. The only related lines are in game.ts, where `findAiCapital(..., aiRace.nativeHabitatType, playAsPirate, ...)` changes an argument next to it. There is no conflict. The optional wizard tweak does not touch any lane C file either.
