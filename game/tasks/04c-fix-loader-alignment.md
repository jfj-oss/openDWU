# Task 04c — Fix data-loader field alignment (components, fighters) + exact-value tests

The 04b loaders were written from the data files instead of the C# loaders, and some are misaligned. **Port each loader's field order exactly from its C# `LoadFromFile`** (Read the method in full; follow each `str.IndexOf(",")`/`TryParse` in order and note which variable each column lands in and where it is used).

`$SRC` = `/home/justinf/.local/share/Steam/steamapps/common/Distant Worlds Universe/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/DistantWorlds.Types`

## Known bug — components (`src/sim/data/components.ts`)
`$SRC/ComponentDefinitionList.cs` `LoadFromFile` (line 73–~340) reads, per line:
`ID, name, pictureRef(result2), specialImageIndex(result3), soundEffectFilename, typeCode(byte result13), result4, result5, Value1..Value7, then resource pairs (resourceId, amount)…`
- `componentType = ComponentDefinition.ResolveComponentTypeFromCode(result13)` (line ~188) — port `ResolveComponentTypeFromCode` from `$SRC/ComponentDefinition.cs` and store the resolved `ComponentType` (port the enum from `$SRC/ComponentType.cs`, member order exact).
- The constructor call (line ~324) is `new ComponentDefinition(result1, name, componentType, result2, result3, soundEffectFilename, result4, result5)` — read the matching constructor in `$SRC/ComponentDefinition.cs` to name result4/result5 correctly.
- The current TS reads `value1` from the result4 column — every Value is shifted by two. Fix it.

## Also re-verify against C#
- `src/sim/data/fighters.ts` vs `$SRC/FighterSpecificationList.cs` `LoadFromFile` (line 44) — the worker reported "techLevel 100000", which suggests a shifted column.
- `resources.ts` (`$SRC/ResourceSystem.cs` 260), `facilities.ts` (`$SRC/PlanetaryFacilityDefinitionList.cs` 33), `plagues.ts` (`$SRC/PlagueList.cs` 53), `research.ts` (`$SRC/ResearchNodeDefinitionList.cs` 44). Fix any misalignment.

## Exact-value tests (`test/data-content.test.ts`)
For each file, assert every field of the **first two records** against the raw line (read them with `grep -v "^'" $DWU/<file> | head`) — e.g. components line `0, Maxos Blaster, 0, 0, laser.wav, 48, 5, 0, 5, 190, 12, 360, 1, 1240, 0, 1, 2, 4, 4, 14, 3,` ⇒ Value1=5, Value2=190, Value3=12, Value4=360, Value5=1, Value6=1240, Value7=0, resources [(1,2),(4,4),(14,3)], type = ResolveComponentTypeFromCode(48).

Done when `npm run typecheck` && `npm test` pass. Append `## Worker report` (list every field you changed per file).
