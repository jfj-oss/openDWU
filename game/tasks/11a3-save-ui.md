# Task 11a3 — Save/load part 3: UI

thinking: off
scope: locked

Depends on 11a2. Create `src/ui/screens/saveLoad.ts` (+css); wire the Escape menu's Save/Load buttons (`src/ui/screens/gameMenu.ts`) and the main menu's Load Game item (`mainMenu.ts`); in `src/main.ts` load goes through the existing `startGameView(game)`. Start editing right away.

Save panel: name field, list of existing saves, Save button → `localStorage['dwu.saves.' + name] = serializeGame(...)`, plus "Download .dwusave" (Blob). Load panel: list of saves (name + date) with Load/Delete, plus "Open file…" (`<input type=file accept=.dwusave>`). Loading replaces the running game and calls `startGameView`. Modern panel style.
Test: pure save-index helpers (list/delete) with an injected storage object.
`npm run typecheck` && `npm test`. Append `## Worker report`.
