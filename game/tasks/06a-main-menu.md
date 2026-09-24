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

**Files changed**
- `src/ui/screens/mainMenu.ts` (new) — `MENU_ITEMS` (pure data), `createMainMenu(callbacks)` builds and appends the DOM screen.
- `src/ui/screens/mainMenu.css` (new) — layout per spec (13%/58% top offsets, `rgba(20,22,28,0.8)` panel, 14px radius, 12px/28px padding, 8px gap between items).
- `src/main.ts` — split the old `main()` body into `bootGame(params)`; `main()` now shows the menu unless the URL has `seed`/`shape`/`stars`/`zoom`/`cx`/`cy`/`skipMenu`, in which case it boots straight into `bootGame(params)` as before. `onStartNewGame` builds a fresh `URLSearchParams` with `seed=Date.now()%2147483647`, `shape=spiral`, `stars=700` and calls `bootGame` with those (default seed for the direct-skip-menu path, e.g. `?skipMenu`, stays `1` as before, unchanged).
- `test/mainMenu.test.ts` (new) — asserts `MENU_ITEMS` order/labels and that every `imageBase` is one of the known chrome names (matches the pattern in `test/hud.test.ts`: no jsdom, pure-data tests only).

**Behaviour**
- Exit: `navigator.userAgent.includes('Electron')` picks `window.close()` (desktop) vs. a 3s "Close this tab to exit" toast (browser) — there is no existing Electron→renderer flag in `desktop/main.cjs`/preload, so this UA sniff is the only signal available; noted here in case a real IPC flag is added later.
- All other items (Tutorials, LoadGame, Options, ChangeTheme, Galactopedia, Credits, CheckForUpdates) log `console.info('TODO(menu): <id>')`.

**Verification**
- `npm run typecheck` — passes.
- `npm test` — 13 files / 120 tests pass (including the new `mainMenu.test.ts`, 2 tests); 3 pre-existing failures in `test/galaxy.test.ts` (`ENOENT ... public/assets/dwu/races`) are unrelated to this task — the DW:U install isn't present in this environment (expected; `game/CLAUDE.md`/task instructions call this out) and those tests were already failing before this change.
- Screenshot: could not run `scripts/shot.mjs` in this environment — no `/usr/bin/chromium` (or any Chromium) binary installed and no network access to fetch one via `npx playwright install`. Confirmed instead that `npm run dev` boots cleanly and Vite serves `/` and `/src/main.ts` without transform errors (`curl` sanity check). No `shots/06a-menu.png` was produced.

**Deviations / TODOs**
- None from the spec's behaviour/layout. `TODO(menu): <item>` console logging is exactly as specified for non-implemented items.
