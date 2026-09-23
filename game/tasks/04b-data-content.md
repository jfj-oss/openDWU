# Task 04b — Data loaders: resources, components, fighters, facilities, plagues, research

model: sonnet

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

## Worker report

**Files created:**
- `src/sim/data/resources.ts` — `parseResources(text)`, ported from `ResourceSystem.cs` `LoadFromFile` (line 260): ID, name, pictureRef, basePrice, type, superLuxuryBonusAmount, isFuel (Y/N), isImportantPreWarpResource (Y/N), colonyGrowthResourceLevel, colonyManufacturingLevel, plus variable-length distribution records (type, subType, prevalence, abundanceMin, abundanceMax).
- `src/sim/data/components.ts` — `parseComponents(text)`, ported from `ComponentDefinitionList.cs` `LoadFromFile` (line 73): ID, name, pictureRef, specialImageIndex, soundEffectFilename, type, value1-7, plus variable-length resource requirement pairs (resourceId, amount).
- `src/sim/data/fighters.ts` — `parseFighters(text)`, ported from `FighterSpecificationList.cs` `LoadFromFile` (line 44): ID, name, type, techLevel, energyCapacity, energyRechargeRate, topSpeed, topSpeedEnergyConsumptionRate, accelerationRate, turnRate, engineExhaustImageIndex, shieldsCapacity, shieldRechargeRate, damageRepairRate, countermeasureModifier, targetingModifier, weaponType, weaponImageIndex, weaponDamage, weaponRange, weaponEnergyRequired, weaponSpeed, weaponDamageLoss, weaponFireRate, weaponSoundEffectFilename.
- `src/sim/data/facilities.ts` — `parseFacilities(text)`, ported from `PlanetaryFacilityDefinitionList.cs` `LoadFromFile` (line 33): ID, name, type, wonderType, pictureRef, buildCost, maintenanceCost, value1-3, description.
- `src/sim/data/plagues.ts` — `parsePlagues(text)`, ported from `PlagueList.cs` `LoadFromFile` (line 53): ID, name, pictureRef, mortalityRate, infectionChance, duration, naturalOccurrenceLevel, canCompletelyEliminatePopulation (Y/N), exceptionRaceName, exceptionMortalityRate, exceptionInfectionChance, exceptionDuration, specialFunctionCode, description.
- `src/sim/data/research.ts` — `parseResearch(text)`, ported from `ResearchNodeDefinitionList.cs` `LoadFromFile` (line 44) + `Galaxy.3.cs` ~4640-4700. Multi-line format per PROJECT/COMPONENTS/COMPONENT IMPROVEMENTS/FIGHTERS/FACILITY/ABILITIES/PLAGUE CHANGE/ALLOWED RACES/PARENTS. Handles both required and optional fields; resolves parent/child references.
- `src/sim/data/gameData.ts` — `loadGameData(fetchText, customizationSet?, raceFileNames?)` aggregates all game data from 04a + 04b into a single `GameData` type. Browser-based fetching; accepts optional customization set and race file names for test discovery.
- `test/helpers/loadGameDataFs.ts` — Node.js filesystem version of `loadGameData` for tests; discovers race file names via `readdirSync` and passes them to the loader.
- `test/data-content.test.ts` — loads all game data once via `beforeAll` and verifies: all content types parse without errors; counts match expected ranges (41 resources, 129 components, 14 fighters, 33 facilities, 4 plagues, 300+ research nodes); numeric fields have no NaN; every research node parent reference resolves; every component resource requirement references an existing resource.

**Verification:** `npm run typecheck` passes (no type errors). `npm test` passes all 66 tests (4 files: 52 from 04a, 14 new from 04b; data loads and validates successfully).

**Deviations / notes:**
- Components parser skips 2 numeric fields (indices 13-14 after type and 7 values) before parsing resource requirement pairs. These appear to be padding or alignment fields not documented in the public spec header; resource pairs confirmed to start at index 15 based on actual data inspection.
- Fighters parser allows variable techLevel values (e.g. 100000, 200000) rather than the typical 0-7 range, matching the actual data structure where these appear to be progression/cost values.
- Research parser is complex (multi-line, variable schema) and captures all optional fields (components, component improvements, fighters, facilities, abilities, plague changes, allowed races, parents) into strongly-typed nullable/array fields.
- No `npm run import-assets` was needed; the `public/assets/dwu` symlink was already present and resolves to the installed DW:U folder with all required files.

**Test output (final run):**
```
✓ Resources: 41
✓ Components: 129
✓ Fighters: 14
✓ Facilities: 33
✓ Plagues: 4
✓ Research nodes: 372
Test Files  4 passed (4)
Tests  66 passed (66)
```
