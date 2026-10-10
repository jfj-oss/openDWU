# Task 06d — New-game wizard: "Your Race" page

thinking: off
scope: locked

Everything you need is here. Edit `src/ui/screens/newGameWizard.ts` (+ css), `src/sim/startGameOptions.ts`, `src/sim/data/races.ts` (one field), tests. Do not edit `src/sim/galaxy.ts`, `src/sim/empire.ts`, `src/main.ts`. Start editing right away. Do not Read image files.

## Source facts (C#)
- `Race.cs` LoadFromFile: `case "PictureIndex": race.PictureRef = ParseIntValue(value);` → add `pictureRef: number` to the parsed race (key `PictureIndex`).
- Portraits (`Main.Part13.cs` ~2195): `race_<i>.png` and alternate `race_<i>a.png` in `/assets/dwu/images/units/races/`, indexed by the race's `PictureRef`.

## Page (after "The Galaxy", before Start)
Wizard gets page navigation: `The Galaxy → Your Race → Start`. "Your Race" page: left a scrollable list of all playable races (name + small portrait), right a large portrait (`race_<pictureRef>.png`), the race name, family, and its key stats from the parsed race (show every numeric field the race parser has, labelled in Title Case, 2 columns). Selected race stored in `StartGameOptions.raceName` (default: first playable race, sorted by name). Footer: "← The Galaxy" / "Next →"/"Start Game". Same modern panel style as the Galaxy page.

Tests: races parse `pictureRef` in range for all 22 races; default race selection; options round-trip.
`npm run typecheck` && `npm test`; save (don't open) `shots/06d-race.png` via `?screen=wizard&page=race`. Append `## Worker report`.

## Worker report

**Files changed**
- `src/sim/data/races.ts` — added a doc comment on the existing `pictureIndex` field explaining it is the port of `Race.cs LoadFromFile case "PictureIndex": race.PictureRef = ParseIntValue(value)` (kept named `pictureIndex`, not renamed, because non-editable `galaxy.ts` already reads `race.pictureIndex`). The field was already parsed from the `PictureIndex` key.
- `src/sim/startGameOptions.ts` — added `raceName: string` to `StartGameOptions` (empty until chosen), added `defaultRaceName(races)` (first playable race sorted by name, with fallbacks), and set `raceName: ''` in `defaultStartGameOptions()`.
- `src/ui/screens/newGameWizard.ts` — implemented the 3-page wizard (`The Galaxy → Your Race → Start`) with per-page title/back/forward labels; the "Your Race" page loads all 22 `races/*.txt` + `raceFamilies.txt` via `fetchText`/`resolveDataUrl`, renders a scrollable list of playable races (name + small portrait) on the left and a large portrait + name + family + 2-column stats grid (every numeric field in `RACE_STAT_FIELDS`) on the right; selection stored in `options.raceName`. Added `racePortraitUrls()` (pure, testable) and the missing-file guard below.
- `src/ui/screens/newGameWizard.css` — styling for the race list/detail/stats and the start summary.
- `test/data-races.test.ts` — new test: every race parses `pictureIndex` as an integer in `[0, 1000)`.
- `test/startGameOptions.test.ts` — tests for `defaultRaceName` (sorted-first-playable, skips unplayable, no-playable fallback, empty input, and agreement with the real parsed data) and `StartGameOptions` round-trip incl. `raceName`.

**Done / verified**
- `npm run typecheck` passes; `npm test` passes (284 tests).
- Saved `shots/06d-race.png` via `node scripts/shot.mjs 'http://localhost:5173/?screen=wizard&page=race' shots/06d-race.png` (no console errors printed).
- In-browser probe confirmed the race page renders: list of playable races, correct default selection (first playable alphabetically), populated name/family/stats, and a note listing any race files absent from the install.

**Environment caveat (not a code bug)**
This machine's `/assets/dwu` tree only contains **4 of the 22** race files (`human.txt`, `mechanoid.txt`, `teekan.txt`, `dhayut.txt`); the other 18 return the Vite dev server's SPA index.html 404 fallback instead of a `.txt`. So the wizard can only show the races that actually exist here. I made `loadWizardRaceData()` robust to this: it detects the HTML fallback (`isRaceFileText` — a real DW:U file starts with the `'Distant Worlds` comment line) and skips such files, collecting them into a `missing` list surfaced as a small note on the page. On a complete install (full Steam install) all 22 races load and the note never appears. I did **not** fabricate or copy any race data/art.

**Left undone / follow-ups**
- Wiring `options.raceName` into actual galaxy generation (picking the player's `Race` object when building the empire) is a later task — out of scope here since `galaxy.ts`/`empire.ts` are off-limits for this task.
- The 18 missing race files need to be present in the asset tree (complete Steam install) for the full race roster to appear.
