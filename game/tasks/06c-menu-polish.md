# Task 06c — Main menu + wizard polish (from screenshot review)

thinking: off
scope: locked

Everything you need is here. Edit `src/ui/screens/mainMenu.ts`, `mainMenu.css`, `newGameWizard.ts`, `newGameWizard.css`. Start editing right away. Do not Read image files.

Real art sizes (px): `MainBackground.jpg` 1600×1056, `Title.png` 482×276, `Menu_Tutorials` 280×55, `Menu_StartNewGame` 280×111, `Menu_LoadGame`/`Menu_Options`/`Menu_ChangeTheme`/`Menu_Exit` 280×87, `Menu_Galactopedia` 115×93, `Menu_CheckForUpdates` 89×48, `Menu_Credits` 89×44. (The item images include their own glow/padding, which is why heights differ.)

Fix (screenshot at 1600×900 showed these):
1. **Title far too big** — it is stretched to half the window and cut off at the bottom. Render `Title.png` at its natural aspect with `width: min(482px * s, 40vw)` where `s = clamp(innerHeight/1080, 0.6, 1.4)`; place it centred with its **bottom** 6% above the window bottom (never overflowing).
2. **Menu items inconsistent / tiny** — render every `Menu_*` image at its **natural size × s** (same `s`), `display:block`, no forced height/width, no gaps added beyond 2 px (the art already has padding). The panel shrink-wraps them. Hover swaps to `_Active.png` (same size, no layout shift: preload the active images).
3. Corner items (Galactopedia, CheckForUpdates, Credits) at natural size × s.
4. **Wizard background** — show `MainBackground.jpg` (cover) behind the wizard window with a 55% black overlay, instead of plain black. Slider tick labels: 12 px, readable (`#c9d1d9`), spread evenly under the slider (flex `space-between`).

Verify: `npm run typecheck`, `npm test`; with `npm run dev` running save (don't open) `shots/06c-menu-1600.png` and `shots/06c-menu-1080.png` (1600×900 and 1920×1080, `/`) and `shots/06c-wizard.png` (`/?screen=wizard`). Append `## Worker report`.

## Worker report

Files changed:
- `src/ui/screens/mainMenu.css` — panel gap 8px→2px; removed forced `height:28px` on menu-item imgs and `height:36px` on corner imgs (natural size now, set inline); title repositioned to `bottom:6%` centred (was `top:58%; width:50%`).
- `src/ui/screens/mainMenu.ts` — added `menuScale()` (`s = clamp(innerHeight/1080, 0.6, 1.4)`); every `Menu_*` item img gets inline `width: 280*s px` (height follows from aspect ratio); title width set inline to `min(482*s px, 40vw)`; corner items sized at natural width × s (Galactopedia 115, CheckForUpdates 89, Credits 89); new `preloadImage()` helper preloads all `_Active.png` hover variants so the hover swap causes no layout shift/flicker.
- `src/ui/screens/newGameWizard.css` — `.wizard-overlay` background is now `MainBackground.jpg` cover over black, with a `::before` layer applying the 55% black overlay; `.wizard-window` made `position:relative` so it sits above the overlay; `.wizard-slider-ticks` now `display:flex; justify-content:space-between; font-size:12px; color:#c9d1d9`.
- `src/ui/screens/newGameWizard.ts` — slider tick labels rendered as one `<span>` per tick (instead of a single `·`-joined text node) so they spread evenly under the slider.

Done: all four fixes from the screenshot review (title sizing/placement, consistent natural-size menu items, corner items, wizard background + tick labels). `npm run typecheck` passes; `npm test` passes (17 files, 209 tests). Screenshots saved (no console errors printed):
- `shots/06c-menu-1600.png` (1600×900, `/`)
- `shots/06c-menu-1080.png` (1920×1080, `/`)
- `shots/06c-wizard.png` (1920×1080, `/?screen=wizard`)

Left undone: nothing in scope. Note: menu art is fixed-width (280×s) with height derived from each image's real aspect ratio, so the differing heights (Tutorials 55 vs StartNewGame 111 etc.) are preserved exactly as the task specifies.
