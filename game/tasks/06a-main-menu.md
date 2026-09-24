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
