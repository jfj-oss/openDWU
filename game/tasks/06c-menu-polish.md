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
