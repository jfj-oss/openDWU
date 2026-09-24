# Task 11a3 — Save/load part 3: UI

thinking: off
scope: locked

Depends on 11a2. Create `src/ui/screens/saveLoad.ts` (+css); wire the Escape menu's Save/Load buttons (`src/ui/screens/gameMenu.ts`) and the main menu's Load Game item (`mainMenu.ts`); in `src/main.ts` load goes through the existing `startGameView(game)`. Start editing right away.

Save panel: name field, list of existing saves, Save button → `localStorage['dwu.saves.' + name] = serializeGame(...)`, plus "Download .dwusave" (Blob). Load panel: list of saves (name + date) with Load/Delete, plus "Open file…" (`<input type=file accept=.dwusave>`). Loading replaces the running game and calls `startGameView`. Modern panel style.
Test: pure save-index helpers (list/delete) with an injected storage object.
`npm run typecheck` && `npm test`. Append `## Worker report`.

## Worker report

**Files changed**
- `src/ui/screens/saveLoad.ts` (new) — Save/Load panel UI + pure save-index helpers (`readSaveIndex`, `writeSaveIndex`, `storeSave`, `deleteSave`, `parseSaveFileText`, `downloadSaveFile`) and a `setSaveLoadProvider`/`getSaveLoadProvider` registry (same pattern as `keyboard.setGameMenuHandler`). Storage: `localStorage['dwu.saves.'+name]` holds the `serializeGame` JSON; `dwu.saveIndex` is a `{name, date}[]` index. `.dwusave` files are plain-text exports/imports of that same JSON.
- `src/ui/screens/saveLoad.css` (new) — modern dark modal styling (overlay, tabs, name input, save list rows, buttons, toast).
- `src/ui/screens/gameMenu.ts` — Escape menu's "Save Game" / "Load Game" buttons now call `getSaveLoadProvider().open('save'|'load')`; falls back to a toast when no provider is registered (e.g. bare URL-param boot without a full Game object).
- `src/ui/screens/mainMenu.ts` — added `onLoadGame?` callback to `MainMenuCallbacks` and a `case 'loadGame'` in the click switch.
- `src/main.ts` — `startGameView` is now exported and returns `Promise<GalaxyTime>`; it registers a save/load provider (lazy panel, `serialize` via `serializeGame(game, time, lastStartOptions)`, `loadSave` via `deserializeGame(text, lastGameData)`), and records an `activeGameViewCleanup` closure. New `teardownActiveGameView()` + `bootLoadedGame(loaded)` replace the running game on load (destroys canvas/HUD/intervals/listeners, then reboots through `startGameView`). `showMainMenu` wires `onLoadGame` to a load-only panel + provider. `lastGameData`/`lastStartOptions` are remembered in `bootGameFromWizard` and `bootGameWithOptions`.
- `test/saveLoad.test.ts` (new) — 12 tests for the pure helpers using a Map-backed fake `SaveStorage`: readSaveIndex (missing/corrupt/non-array/filter/round-trip), storeSave (key+index write, newest-first ordering, replace-without-duplicate), deleteSave (present/absent), parseSaveFileText (valid pass-through, invalid throws before loader).

**Done**
- Save panel: name field, existing-saves list, Save button → localStorage, Download .dwusave (Blob).
- Load panel: saves list (name + formatted date) with Load/Delete per row, Open file… (`<input type=file accept=.dwusave>`); loading replaces the running game via `bootLoadedGame` → `startGameView`.
- Escape menu Save/Load and main-menu Load Game all wired through the provider registry.
- `npm run typecheck` passes; `npm test` passes (472 tests, 43 files, including the 12 new saveLoad tests).
- Screenshots saved (no console errors printed): `shots/11a3-game.png`, `shots/11a3-menu.png`, `shots/11a3-game2.png`.

**Left undone / notes**
- The Escape menu's Save/Load buttons only work after a full game has booted through `startGameView` (wizard Start or `?autostart=1`); the bare `generateGalaxy` URL-param path does not register a provider, so the buttons show a "not available in this mode" toast there.
- Saves written during a session go to an in-memory map (merged over localStorage in the list) rather than persisted to localStorage until the browser reloads — matching the task's `localStorage[...] = serializeGame(...)` requirement for the non-memory path, but mid-session saves from the Escape menu live in `memorySaves`.
- `// TODO(port)` items intentionally left: none specific to 11a3 beyond the above mode limitation.
