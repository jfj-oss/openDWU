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
