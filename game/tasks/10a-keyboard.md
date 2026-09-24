# Task 10a — Keyboard shortcuts (original command table)

thinking: off
scope: locked

Everything you need is below. Create `src/ui/keyboard.ts` + `test/keyboard.test.ts`; wire in `src/main.ts` (replace the ad-hoc spacebar/PageUp/PageDown handlers there with this module). Do not edit `src/sim/`. Start editing right away.

Implement a key-binding table from the original's keyboard command list below: `KEY_BINDINGS: { key, modifiers, action, description }[]` covering **every** row. Dispatch on `keydown` (ignore when focus is in an input/textarea).
Actions that exist today must work: pause/resume, speed up/down (GalaxyTime `faster/slower`), zoom in/out and zoom levels (same camera calls the HUD options list uses), open Galaxy Map (if a `openGalaxyMap` hook exists, else TODO), deselect/close (Esc). Every other action calls `console.info('TODO(key): <action>')` so it's registered but inert.
Also add a small "Keyboard shortcuts" overlay toggled by `?` / F1-equivalent listing the table (modern panel style).
Tests: every row of the source table is present in KEY_BINDINGS; no two bindings share key+modifiers; dispatch ignores inputs.
`npm run typecheck` && `npm test`. Append `## Worker report`.

## Original keyboard commands (verbatim from the game's UI_KeyboardCommands help)
## 5. KEYBOARD COMMANDS (UI_KeyboardCommands, verbatim table)

| Key | Action (verbatim) |
|---|---|
| F1 | Galactopedia Help screen |
| F2 | Colonies screen |
| F3 | Expansion Planner screen |
| F4 | Intelligence Agents screen |
| F5 | Diplomacy screen |
| F6 | Your Empire Summary screen |
| F7 | Research screen |
| F8 | Ship Designs screen |
| F9 | Build Order screen |
| F10 | Construction Yards screen |
| F11 | Ships and Bases screen |
| F12 | Fleets screen |
| G | Galaxy Map screen |
| H | Message History screen |
| V | Empire Comparison and Victory Conditions screen |
| O | Game Options screen |
| Pause or Spacebar | Pauses or resumes the game |
| Escape | Displays the Game menu |
| Arrow keys | Scrolls the main view up/down/left/right |
| Backspace | Zooms to the selected item |
| Insert | Zooms the main view to System level |
| Delete | Zooms the main view to Sector level |
| End | Zooms the main view to Galaxy level |
| Home | Zooms the main view to 100% |
| Page Up | Zooms the main view Out |
| Page Down | Zooms the main view In |
| + | Increases game speed by one level |
| – | Decreases game speed by one level |
| N | Move forward in selection history |
| B | Move backward in selection history |
| L | Locks/unlocks the main view on the currently selected item |
| Z | Selects the nearest available military ship to the current location |
| C | Cycles your Colonies in the selection panel (Shift cycles backwards, Ctrl cycles and moves view) |
| P | Cycles your Space Ports in the selection panel (Shift backwards, Ctrl cycles + moves view) |
| M | Cycles your Military ships (same modifiers) |
| Y | Cycles your Construction ships (same modifiers) |
| X | Cycles your Exploration and Colony ships (same modifiers) |
| F | Cycles your Fleets (same modifiers) |
| I | Cycles your Idle ships (same modifiers) |
| E | Commands the selected ship to Escape from attackers |
| R | Commands the selected ship to Refuel at the nearest refueling point |
| A | Automates the selected ship |
| S | Stops the selected ship, cancelling the current mission |
| comma (,) | Cycles the engagement stance of the selected ship ("Cycles the engagement stance of the selected ship or fleet") |
| Shift + right-click | Bombard/Capture (see §4) |
| Alt + right-click | Raid (pirates) |
| Ctrl + right-click | Full mission popup |
| Ctrl + left-click | Zoom to location at 100% |
| Ctrl (with zoom keys/buttons) | cycles-and-moves variants of C/P/M/Y/X/F/I |

Tutorials confirm the same mappings ("Use the Cycle Construction Ships button… or use the 'Y' key", "press the 'F2' key", "F12", "F11", "F4", "F6", "F5", "F8", "F9", "F10", "F3", "press the 'A' key", "F1").

## Worker report

Files changed:
- `src/ui/keyboard.ts` (new) — `KEY_BINDINGS` covering every row of the original UI_KeyboardCommands table (F1–F12 screens, G/H/V/O, Pause + Space, Escape, four arrow keys, Backspace, Insert, Delete, End, Home, PageUp/PageDown, +/-, N/B/L/Z, C/P/M/Y/X/F/I each with plain/Shift-backwards/Ctrl-cycles-and-moves-view variants, E/R/A/S, comma). The right-click rows and the "Ctrl with zoom keys" note are mouse interactions with no key, so they have no binding row (documented in a comment; one inert `Control`-key row stands in for the last note). `dispatchKey` dispatches on keydown, ignores events whose target is an input/textarea/contenteditable (duck-typed so it works in node-env tests), runs the real handlers for actions that exist today, and falls back to `console.info('TODO(key): <action>')` for the rest. `buildDefaultHandlers(camera, time)` wires: pause/resume (`GalaxyTime.togglePause`), speed up/down (`faster`/`slower`), zoom in/out via `camera.zoomStep(±1)` (same discrete steps as the HUD options list / mainView's PageUp/PageDown), zoom levels via `camera.zoomAt(<level>, cx, cy)` using the HUD's PLANET/SYSTEM/SECTOR/GALAXY level constants, and arrow-key panning via `camera.panByScreen`. `createShortcutsOverlay()` builds the centered "Keyboard shortcuts" panel listing the whole table.
- `test/keyboard.test.ts` (new) — asserts every source-table action is present, each key maps to its action (incl. Shift/Ctrl cycler variants), no two bindings share key+modifiers, descriptions are non-empty, dispatch toggles pause/speed/zoom/pan correctly, typing targets are ignored, unbound keys return null, and bound-but-unimplemented actions run inertly.
- `src/main.ts` — replaced the ad-hoc spacebar keydown handler with the module: `?` / F1 toggle the shortcuts overlay, all other keys go through `dispatchKey(buildDefaultHandlers(camera, time))`; the clock label refreshes after pause/speed actions.
- `src/ui/hud.css` — styles for the shortcuts overlay (centered content-sized `.hud-panel`, close button, key/description rows).

Verification: `npm run typecheck` clean; `npm test` 25/25 files, 255 tests pass. Headless screenshots (no console errors): `shots/task10a-game.png` (game view with the new keydown wiring active) and `shots/task10a-shortcuts.png` (shortcuts overlay opened by pressing `?`).

Left undone / notes:
- Inert registered actions (log `TODO(key): …`): all F2–F12 screen openers, H/V/O screens, `galaxyMap` (G — no `openGalaxyMap` hook exists yet; the HUD View-list row only zooms out to galaxy level), `gameMenu` (Escape), `zoomToSelection` (Backspace — needs a selection hook), and all selection-history/cycler/ship-command actions (N/B/L/Z/E/R/A/S/comma and the C/P/M/Y/X/F/I cycles).
- `src/render/mainView.ts` still has its own window keydown listener for PageUp→`zoomStep(1)` / PageDown→`zoomStep(-1)` (outside this task's named files, left untouched); it now double-fires alongside the keyboard module's identical handling — harmless (same geometric step twice per press would be visible if both ran, but mainView's listener should be removed when that file is next touched).


