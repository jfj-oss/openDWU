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

## Worker report

**Files created:**
- `src/sim/data/paths.ts` — `resolveDataUrl(file, customizationSet?)`, ported from the Customization-first/base-fallback ordering seen in `Galaxy.cs` ~1967-1978 (`LoadRaceBiases`) and ~2114-2126 (`InitializeRaceFamilyBiases`).
- `src/sim/data/fetchData.ts` — `fetchText(candidates: string[])`, browser `fetch` only, tries each URL in order.
- `src/sim/data/raceFamilies.ts` — `parseRaceFamilies(text)`, ported from `RaceFamilyList.cs` `LoadFromFile` (line 57): `id, name, specialFunctionCode` CSV rows.
- `src/sim/data/races.ts` — `parseRace(text)`, ported from `Race.cs` `LoadFromFile` (line 752) plus the field docs at the top of `races/human.txt` (which mirrors the `Race` class fields). Parses the full `Key;Value` field set (all fields through `ImmuneToPlagues`); unmodeled fields are preserved in a `race.extra` record rather than dropped.
- `src/sim/data/biases.ts` — `parseRaceBiases(text)` and `parseRaceFamilyBiases(text)`, both built on a shared row parser (`id, name, v0..vN` → square matrix), ported from `Galaxy.cs` `LoadRaceBiases` (~1967-2030, values clamped to [-50, 50]) and `Galaxy.3.cs` `InitializeRaceFamilyBiases` (~2114-2126) / `RaceFamilyBiasList`.
- `src/sim/data/governments.ts` — `parseGovernments(text)` and `parseGovernmentBiases(text)`, ported from `GovernmentAttributesList.cs` `LoadFromFile` (line 87) and `GovernmentBiasList.cs` `LoadFromFile` (line 27, bias values clamped to [-30, 30]).
- `test/data-races.test.ts` — reads real files from `public/assets/dwu/` via Node `fs`. Covers: all 22 race files parse with non-empty name + in-range `raceFamily`; `raceBiases.txt`/`raceFamilyBiases.txt` are square matrices sized to race count / family count; `governments.txt` parses with >10 entries; every `governmentBiases.txt` row length matches the government count.

**Verification:** `public/assets/dwu` symlink exists and resolves to `$DWU`. `npm run typecheck` and `npm test` both pass (52/52 tests, 3 files).

**Deviations / notes:**
- `governments.ts` faithfully reproduces a quirk in the original `GovernmentAttributesList.cs` noun-parsing loop (lines ~520-537): it only appends a noun when a *following* comma exists, so the last noun on each line (the one after the final comma, e.g. "Hegemony" in the Despotism row) is silently dropped by the original engine. This is preserved rather than "fixed," per CLAUDE.md's instruction to port logic faithfully — noted in a code comment in `governments.ts`.
- `raceFamilyBiases.txt`'s header comment states values range -50..50 (same as `raceBiases.txt`), even though `GovernmentBiasList.cs`/`governmentBiases.txt` use -30..30; each parser clamps per its own file's documented range.
- `races.ts` models all fields present in the sample `human.txt`/`mechanoid.txt` files as typed properties; any additional/unexpected `Key;Value` pairs are captured in `race.extra` so nothing is silently lost, without requiring every one of the ~90 fields to have its own named property.
- Did not implement `Component`/`DisallowedComponents` resolution (which in `Race.cs` looks up `Galaxy.ComponentDefinitionsStatic`) — out of scope for this data-loader task; `DisallowedComponentIds` values aren't currently parsed onto the `Race` type (TODO if a later task needs them).
- No `npm run import-assets` was needed; the `public/assets/dwu` symlink was already present and working.
