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

## Worker report

**Loaders re-ported field-by-field from C# `LoadFromFile`** (alignment work landed in commit `4ad9197`, description-parsing fix pass in the follow-up `04c-fix-loader-alignment.fix1.md`):

- `src/sim/data/components.ts` — the known shift bug: `value1..value7` were each read two columns early. Now `LoadFromFile` order is followed exactly: `id, name, pictureRef, specialImageIndex, soundEffectFilename, typeCode → resolveComponentTypeFromCode(typeCode) (port of ComponentDefinition.cs line 130), size, energyUsed, value1..value7`, then `(resourceId, amount)` pairs from column 15 on. `ComponentType` enum ported from `ComponentType.cs` with exact member order; `Undefined` returned for unknown codes (line skipped, matching C# "Invalid Type" throw).
- `src/sim/data/fighters.ts` — re-verified column alignment against `FighterSpecificationList.cs` LoadFromFile (line 44); all 25 columns map in order (`type` is column 2, `techLevel` column 3, …, `weaponSoundEffectFilename` last). No field reordering was needed beyond what 04b had; exact-value tests confirm.
- `src/sim/data/resources.ts`, `research.ts` — re-verified against `ResourceSystem.cs` (line 260) and `ResearchNodeDefinitionList.cs` (line 44); exact-value tests for the first two records of each file pass.
- `src/sim/data/facilities.ts`, `plagues.ts` — verified against `PlanetaryFacilityDefinitionList.cs` (line 33) and `PlagueList.cs` (line 53). One fix in the fix pass: Description is now read as the raw remainder of the line after the last fixed field's comma (single trim), as in C# — the earlier `split(',')`-and-rejoin dropped the space after commas inside description text.

**Tests:** `test/data-content.test.ts` extended with exact-value tests asserting every field of the first two records of components, fighters, resources, facilities, plagues, and research against the raw lines in `$DWU/*.txt` (raw lines cited in comments above each test). No existing assertions were weakened.

**Gate:** `npm run typecheck` and `npm test` pass (4 test files, 78/78 tests).

**Left undone:** nothing.
