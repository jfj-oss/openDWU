# Task 12b — Empires list panel (HUD Empires button)

thinking: off
scope: locked

Create `src/ui/screens/empiresList.ts` + `src/ui/screens/empiresList.css`, edit `src/ui/hud.ts` (the Empires button click only), add `test/empiresList.test.ts`. Start editing right away. Do not touch other files.

The HUD is streamlined, not a 1:1 copy of the original. Build a compact DOM panel that lists the known empires. Copy the look of `src/ui/screens/tutorials.ts` / `tutorials.css` (dark translucent panel, same fonts and borders) and read those two files first for the pattern.

API:
```ts
export interface EmpiresListOptions {
    empires: Empire[];              // galaxy.empires (src/sim/galaxy.ts: `empires: Empire[]`)
    playerEmpire: Empire;
    onZoomTo: (habitat: Habitat) => void;   // zoom the Main View to a capital
}
export function toggleEmpiresList(opts: EmpiresListOptions): void; // open, or close if open
export function closeEmpiresList(): void;
```
Behaviour:
- One row per empire, excluding empires whose `name` is empty or which have no `capital`. Order: player first, then the rest by `name` (localeCompare).
- Columns:
  - a colour swatch (a 12px square in `rgb(mainColor)`; check `Empire.mainColor`'s type in src/sim/empire.ts and format it the same way hud.ts `colorHueRotate` reads it);
  - the name, with "(you)" after the player's;
  - the colony count `colonies.length`;
  - the capital name `capital.name`.
- Clicking a row calls `onZoomTo(empire.capital)` and closes the panel.
- The panel has a close "×" button in its header, titled "Empires". Pressing Escape while the panel is open closes it: add a keydown listener on open and remove it on close. Call `stopPropagation` so the game menu does not also open.

hud.ts (~line 501): replace the `TODO(screen): Empires` console.log in the Empires button click with `toggleEmpiresList({...})`.
- Use `wiring.game` (it has `galaxy` and `playerEmpire`), guarded when missing.
- For `onZoomTo`, use the same camera calls as the HUD's existing "Zoom to selection" (`doViewAction('zoomSelection')` in hud.ts): centre on `habitat.xpos/ypos` at `SYSTEM_LEVEL_ZOOM`. Read how doViewAction reaches the camera and reuse it.

Tests: jsdom is NOT configured (see test/hud.test.ts), so put the row logic in a pure exported function `empireRows(empires: Empire[], player: Empire): { empire: Empire; label: string; colonies: number; capitalName: string }[]` (the DOM code calls it) and test only that:
- the player comes first, then the others by name;
- empires with an empty name or no capital are excluded;
- the player's label ends with " (you)".

Run `npm run typecheck` && `npm test`, then append `## Worker report`.

## Worker report

Files changed:
- `src/ui/screens/empiresList.ts` (new) — `EmpiresListOptions`, pure `empireRows(empires, player)` (excludes empty-name / capital-less empires; player first, rest by `name.localeCompare`; label gets " (you)" for the player), plus `toggleEmpiresList(opts)` / `closeEmpiresList()` building a DOM panel (titlebar "Empires" + ✕ close, rows with 12px swatch in `rgb(mainColor)` decoded like hud.ts `colorHueRotate`, name, colony count, capital name). Row click calls `onZoomTo(empire.capital)` and closes. Escape keydown listener added on open, removed on close, with `stopPropagation` so the game menu does not also open.
- `src/ui/screens/empiresList.css` (new) — copies the tutorial-window dark-panel tokens (background, blur, borders, gold heading, font); grid row layout with the 12px swatch column.
- `src/ui/hud.ts` — Empires button click now calls `toggleEmpiresList({ empires: wiring.galaxy.empires, playerEmpire: wiring.game.playerEmpire as Empire, onZoomTo })`, guarded when `galaxy`/`game` are missing; `onZoomTo` reuses the `doViewAction('zoomSelection')` camera calls (`cam.centerOn(xpos, ypos)` + `cam.zoomAt(SYSTEM_LEVEL_ZOOM, width/2, height/2)`). Replaced the `TODO(screen): Empires` console.log.
- `test/empiresList.test.ts` (new) — tests only `empireRows`: player first then others by name; empty-name/no-capital exclusion; player label ends with " (you)"; colony counts and capital names.

Done: all of the above; `npm run typecheck` and `npm test` both pass (583 tests).

Left undone: nothing in scope. The original's full Empires/diplomacy window (relations, leaders, etc.) is out of scope per the streamlined-HUD approach; the panel shows the four specified columns only.
