# Task 04b — Data loaders: resources, components, fighters, facilities, plagues, research

Same work style and conventions as `tasks/04a-data-races-governments.md` (read it first; reuse its paths/fetch helpers).

| data file | C# loader | TS module |
|---|---|---|
| `$DWU/resources.txt` | `$SRC/ResourceSystem.cs` 260 `LoadFromFile` (+ `ResourceDefinition.cs`) | `resources.ts` |
| `$DWU/components.txt` | `$SRC/ComponentDefinitionList.cs` 73 (+ `ComponentDefinition.cs`, `ComponentType.cs`, `ComponentCategoryType.cs`) | `components.ts` |
| `$DWU/fighters.txt` | `$SRC/FighterSpecificationList.cs` 44 | `fighters.ts` |
| `$DWU/facilities.txt` | `$SRC/PlanetaryFacilityDefinitionList.cs` 33 | `facilities.ts` |
| `$DWU/plagues.txt` | `$SRC/PlagueList.cs` 53 | `plagues.ts` |
| `$DWU/research.txt` | `$SRC/ResearchNodeDefinitionList.cs` 44 `LoadFromFile(filePath, races)` + `$SRC/Galaxy.3.cs` ~4640–4700 | `research.ts` |

Loader entry points for the game: `$SRC/Galaxy.3.cs` 2146–2265 (`InitializePlagues`, `InitializeGovernments`, `InitializePlanetaryFacilityDefinitions`, `InitializeResourceDefinitions`, `InitializeComponentDefinitions`) — port their post-load steps too.

Also add `src/sim/data/gameData.ts`: `loadGameData(fetchText, customizationSet?)` that loads everything from 04a + 04b into one typed `GameData` object (browser), and `test/helpers/loadGameDataFs.ts` doing the same from disk for tests.

Tests `test/data-content.test.ts`: counts parse without errors (log the counts; expect roughly 41 resources, ~129 components, 14 fighters, ~33 facilities, 4 plagues, ~300+ research nodes — assert > 0 and no NaN in numeric fields); every research node's parent/child references resolve; every component's resource requirements reference existing resources.

Done when `npm run typecheck` && `npm test` pass. Append `## Worker report`.
