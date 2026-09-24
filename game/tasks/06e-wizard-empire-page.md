# Task 06e — New-game wizard: "Your Empire" page

thinking: off
scope: locked

Everything you need is here. Edit `src/ui/screens/newGameWizard.ts` (+ css), `src/sim/startGameOptions.ts`, tests. Do not edit `src/sim/galaxy.ts`, `src/sim/empire.ts`, `src/main.ts`. Start editing right away. Do not Read image files.

Add page "Your Empire" after "Your Race" (nav: The Galaxy → Your Race → Your Empire → Start):
- **Empire name** text input (default `"<Race name> Empire"`, updates if the race changes and the user hasn't edited it).
- **Government**: dropdown of governments from `parseGovernments` (`src/sim/data/governments.ts`, loaded via the existing game data) — show only governments available at start (if the Government type has an availability/special-function field, exclude the storyline ones with non-zero special function; otherwise list all and add a TODO). Show the selected government's key numeric modifiers in a small 2-column table.
- **Flag**: a grid of the 83 flag shapes `/assets/dwu/images/ui/flagshapes/flag00.png … flag82.png` (2-digit index) rendered as small tiles; selected tile highlighted. Two colour pickers: primary and secondary colour (defaults: a deterministic pick from a 12-colour palette by race index). Preview: the selected flag shape drawn with the primary colour background and the shape tinted with the secondary colour (CSS `mask-image` with the flag png, or a small canvas).
- Store in `StartGameOptions`: `empireName, governmentId, flagShapeIndex, primaryColor, secondaryColor`.
Tests: defaults, name auto-update rule, options round-trip, flag URL builder (`flagShapeUrl(7) === '/assets/dwu/images/ui/flagshapes/flag07.png'`).
`npm run typecheck` && `npm test`; save (don't open) `shots/06e-empire.png` via `?screen=wizard&page=empire`. Append `## Worker report`.

## Worker report

**Files changed**
- `src/sim/startGameOptions.ts` — added `empireName, governmentId, flagShapeIndex, primaryColor, secondaryColor` to `StartGameOptions` (defaults uncustomised: `''`, `-1`, `-1`, `''`, `''`); new pure helpers `defaultEmpireName(raceName)`, `FLAG_COLOR_PALETTE` (12 colours), `defaultFlagColors(raceIndex)` (deterministic primary at index%12, secondary offset +5), `flagShapeUrl(index)` (`/assets/dwu/images/ui/flagshapes/flagNN.png`, two-digit), and `applyEmpireDefaults(options, raceIndex, prevRaceName?)` implementing the name auto-update rule (re-derives `<race> Empire` only while the name still equals the previous race's default or is empty; user edits survive).
- `src/ui/screens/newGameWizard.ts` — new "Your Empire" page between "Your Race" and "Start" (nav now The Galaxy → Your Race → Your Empire → Start; titles/back/forward labels updated): empire-name text input, government dropdown loaded from `governments.txt` via `parseGovernments` (filtered by `availability === 0 && specialFunctionCode === 0` via `filterStartGovernments`) with a 2-column modifier table (`GOVERNMENT_MODIFIER_FIELDS`: corruption … stability), and a flag section: grid of all 83 `flagNN.png` tiles (selected highlighted), primary/secondary colour pickers, and a CSS `mask-image` preview (primary background, shape tinted secondary). Default government preselects the race's `preferredStartingGovernment` when available. A `WizardRaceChangedHandler` hook re-applies `applyEmpireDefaults` on race change (name + deterministic flag colours by playable-race index, tracked in `PLAYABLE_RACE_INDEX`). Start-page summary now lists Empire Name / Government / Flag.
- `src/ui/screens/newGameWizard.css` — styles for the empire page (name row, government select + modifier table, 17-column flag tile grid, colour pickers, mask-based flag preview).
- `test/startGameOptions.test.ts` — extended defaults/round-trip tests for the new fields; new suites: `flagShapeUrl` (incl. `flagShapeUrl(7) === '.../flag07.png'`), name auto-update rule (auto-update on race change, user edit preserved), deterministic flag-colour defaults (not clobbered on later calls), palette size/offset checks.

**Done**: typecheck passes, all 296 tests pass (28 files). Screenshots saved (not opened): `shots/06e-empire.png` (`?screen=wizard&page=empire`) and `shots/06e-start.png` (summary page showing the new rows) — no console errors printed by the shot script.

**Left undone / notes**
- Government availability filter uses both `availability === 0` and `specialFunctionCode === 0` (the parsed Government type has an availability field, so per the task's branch I excluded storyline governments rather than listing all).
- `main.ts` was not edited (out of scope): it maps wizard options to `generateGalaxy` but doesn't yet consume `empireName/governmentId/flag*` — wiring those into galaxy generation belongs to a later task.
- Government dropdown loads asynchronously; if `governments.txt` is missing from an install the page shows a note instead of a dropdown.
