# Task 04a — Data loaders: races, race families, biases, governments

**Work style:** for each file: Read the C# loader (offset/limit on the given lines), `head -60` the data file, write the TS parser + a test, next. No broad surveys.

`$SRC` = `/home/justinf/.local/share/Steam/steamapps/common/Distant Worlds Universe/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/DistantWorlds.Types`
`$DWU` = `/home/justinf/.local/share/Steam/steamapps/common/Distant Worlds Universe` (also served at `public/assets/dwu/`)

Parsers are **pure functions taking file text** (no fs in `src/`), in `src/sim/data/`. Port field names/order from the C# class. Files may start with a UTF-8 BOM and use `'` comment lines and CRLF — handle both.

| data file | C# loader | TS module |
|---|---|---|
| `$DWU/races/*.txt` (22 files) | `$SRC/Race.cs` 752 `LoadFromFile` (+ Race fields at top of Race.cs) | `races.ts` `parseRace(text)` |
| `$DWU/raceFamilies.txt` | `$SRC/RaceFamilyList.cs` 57 | `raceFamilies.ts` |
| `$DWU/raceBiases.txt` | `$SRC/Galaxy.cs` 1965–2010 + `RaceBiasList.cs` 28 `LoadBiases` | `biases.ts` |
| `$DWU/raceFamilyBiases.txt` | `$SRC/Galaxy.3.cs` 2110–2140 | `biases.ts` |
| `$DWU/governments.txt` | `$SRC/GovernmentAttributesList.cs` 87 | `governments.ts` |
| `$DWU/governmentBiases.txt` | `$SRC/GovernmentBiasList.cs` 27 | `governments.ts` |

**Customization sets (themes):** the game reads `$DWU/Customization/<set>/<file>` first, falling back to `$DWU/<file>` (see how `Galaxy.cs` 1970–1975 builds the path). Add `src/sim/data/paths.ts` with `resolveDataUrl(file, customizationSet?)` returning candidate URLs under `/assets/dwu/` in that order; add a browser loader `src/sim/data/fetchData.ts` (`fetchText(candidates)` tries each).

Tests `test/data-races.test.ts` (read real files with `fs` from `public/assets/dwu/`): 22 races parse, each has a non-empty name and a family index in range; bias matrices are square with size = race count / family count; governments parse (count > 10) and every government bias row matches the government count.

Done when `npm run typecheck` && `npm test` pass. Append `## Worker report`.
