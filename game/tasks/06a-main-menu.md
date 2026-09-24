# Task 06a — Main menu screen

thinking: off
scope: locked

Everything you need is here. Create `src/ui/screens/mainMenu.ts` (+ css), edit `src/main.ts`, add a test. Start editing right away. Do not Read image files.

## Art (all exist; URLs under `/assets/dwu/images/ui/chrome/`)
`MainBackground.jpg` (full-screen art), `Title.png` (big "DISTANT WORLDS / UNIVERSE" logo), and per item `Menu_<Item>_Inactive.png` / `Menu_<Item>_Active.png` (hover) for Items: `Tutorials`, `StartNewGame`, `LoadGame`, `Options`, `ChangeTheme`, `Exit`, `Galactopedia`, `Credits`, `CheckForUpdates`.

## Layout (from real gameplay frames, 1080p)
- `MainBackground.jpg` covers the whole window (`object-fit: cover`), black behind.
- Centred horizontally near the top (top ≈ 13% of height): a dark rounded translucent panel (`rgba(20,22,28,0.8)`, radius 14 px, padding 12 px 28 px) with the vertical list, in order: Tutorials, Start New Game, Load Game, Options, Change Theme, Exit — each is its `Menu_*_Inactive.png` image, swapped to `_Active.png` on hover, ~8 px apart.
- `Title.png` centred horizontally, lower-middle (its top ≈ 58% of height), width ≈ 50% of window (keep aspect).
- Small corner items: Galactopedia (top-left, 10 px), CheckForUpdates (bottom-left, with the text `Version 1.9.5 (recreation)` under it), Credits (bottom-right). Top-centre small yellow text `Current Theme: Distant Worlds Original`.
- Font 'Forgotten Futurist' for text.

## Behaviour
- `main.ts` boot: show the main menu first; the galaxy/Main View/HUD are created only after **Start New Game** is clicked (generate with the current defaults: seed = `Date.now() % 2147483647`, spiral, 700 stars). If the URL has any of `seed`, `shape`, `stars`, `zoom`, `cx`, `cy` or `skipMenu`, skip the menu and boot straight into the game as today (keeps screenshot scripts working).
- Exit: in the desktop app call `window.close()`; in the browser show a small "Close this tab to exit" toast.
- Other items: `console.info('TODO(menu): <item>')`.
- Export a pure `MENU_ITEMS` array (id, label, imageBase) and test that its order is Tutorials, StartNewGame, LoadGame, Options, ChangeTheme, Exit and that every image name is from the list above.

Verify: `npm run typecheck`, `npm test`; with `npm run dev` running save (don't open) `shots/06a-menu.png` at `/` (no params) 1920×1080. Append `## Worker report`.

## Worker report

Files changed:
- `src/ui/screens/mainMenu.ts` (new) — `MENU_ITEMS` (id/label/imageBase, order Tutorials → StartNewGame → LoadGame → Options → ChangeTheme → Exit), `shouldSkipMenu(search)` (true for any of `seed`, `shape`, `stars`, `zoom`, `cx`, `cy`, `skipMenu`), `createMainMenu(onStartNewGame)` building the full-screen `MainBackground.jpg`, top-centre yellow theme label, centred rounded translucent panel (`rgba(20,22,28,0.8)`, radius 14px, padding 12px 28px, 8px gaps) with the six `Menu_*_Inactive.png` rows swapping to `_Active.png` on hover, `Title.png` at top 58% / width 50%, and corner items Galactopedia (top-left), CheckForUpdates (bottom-left, with `Version 1.9.5 (recreation)` under it), Credits (bottom-right). Exit calls `window.close()` (desktop) or shows a "Close this tab to exit" toast (browser); other items log `TODO(menu): <item>`.
- `src/ui/screens/mainMenu.css` (new) — layout above, 'Forgotten Futurist' font via the same @font-face as hud.css.
- `src/main.ts` — boot now shows the main menu first; galaxy/Main View/HUD are created only after Start New Game (seed = `Date.now() % 2147483647`, spiral, 700 stars via new `bootGame()`); URL params `seed/shape/stars/zoom/cx/cy/skipMenu` skip the menu and boot straight in as before.
- `test/mainMenu.test.ts` (new) — MENU_ITEMS order + image-base names from the allowed list + labels non-empty; `shouldSkipMenu` true for each boot param, false otherwise.

Done: typecheck passes, all 197 tests pass (16 files), screenshot saved to `shots/06a-menu.png` (1920×1080, no params) — console output clean (only Vite HMR debug lines, no errors).

Left undone: nothing in scope. (Note: `src/sim/startGameOptions.ts` is an untracked file from task 06b's lane, not part of this task.)
