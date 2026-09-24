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
