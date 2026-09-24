# Task 05 — In-game HUD shell (layout + original chrome art)

thinking: off

Depends on 02 (Main View). Build the HUD that sits over the Main View, with the **original layout, art and font**. Most buttons are placeholders for now (log a `TODO(screen)` on click), but zoom buttons, play/pause, speed and the minimap must work.

**Work style:** read the listed line ranges with Read offset/limit, port, move on. Do not survey.

`$APP` = `/home/justinf/.local/share/Steam/steamapps/common/Distant Worlds Universe/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/DistantWorlds`

## Sources
- **Layout:** `$APP/Main.Part12.cs` `MainInit(width, height, windowedMode)` from line 1498 to ~2230 — exact pixel positions/sizes of every HUD control, relative to the main view size (e.g. `lstMessages` 1726, `btnPlayPause` (10,62) 1797, `pnlDetailInfo` 280×240 1962, zoom buttons ~2100–2130, `pnlSystemMap` bottom-right 2132, `lblStarDate` (10,10) 2203, `lblStateMoney` (W−95,10) 2207). Port positions as a pure function `computeHudLayout(width, height)` in `src/ui/hudLayout.ts` + unit test.
- **Button art:** `$APP/Main.Part12.cs` `LoadUiChromeButtons` line 431–520 maps each button to its PNG in `images/ui/chrome/` (e.g. `coloniesButton.png`, `diplomacyButton.png`, `galaxyMapButton.png`, `gameOptionsButton.png`, `galactopediaButton.png`, play/pause bitmaps …). Also look ~line 380–430 for `left.png/right.png/up.png/down.png` etc.
- **Font:** "Forgotten Futurist" — `$APP/Resources/Forgotte.ttf` (regular) and `Forgottb.ttf` (bold), loaded in `$APP/Main.Part4.cs` ~1740. Serve via `@font-face` from `/assets/dwu/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/DistantWorlds/Resources/Forgotte.ttf`. All HUD text uses it.

## What it looks like (from a 1080p in-game screenshot)
- **Top-left:** two square icon buttons (monitor = game menu, "?" = Galactopedia); below, a wide play/pause button (blue ▶❚❚ glyph) with two small `>` and `>>>` speed buttons under it; below that the star date in white, e.g. `9861.08.15 (4x)`.
- **Left edge:** a thin vertical strip of ~16 small dim icons (Empire Navigation Tool) on a dark translucent bar.
- **Top-center:** a dark rounded translucent panel with 5 lines of centered small white message text (scrolling message list), with a small envelope icon button and an hourglass button to its right. Under it a row of screen-launch icon buttons (colonies, expansion planner, empire graphs, policy, …), then two flag buttons (diplomacy), a big empire-flag button, a lightbulb with three small research % bars (red/purple/green), a "D" design button, then construction/troops/fleet icons.
- **Top-right:** small grey labels "Money / Cashflow / Bonus Income" with white values (`641,607`, `(+213,959)`, `(+677,133)`) next to a money-stack icon; under it the viewed system name in larger white bold text ("Zutos system"); under that a vertical list of advisor suggestion cards (dark translucent, icon + bold title "Advisors: Build New Ships" + one-line grey description).
- **Bottom-left:** the Selection Panel — dark bevelled panel ~280×240: a title in blue ("Sloowo [Terran Federation]") with the empire flag at right, then label/value rows ("System", "Populace", "Resource", "Value", "GDP", "Tax", "Facilities", "Troops", "Building", "Docked"), over a faded picture of the selected object. Above it: a wide `<` / `>` history bar and a red icon button. Both sides: a column of 8 small buttons each with an arrow and an icon (cycle colonies / ships / …). Below: a row of 8 small coloured action buttons.
- **Bottom-right:** the minimap (`pnlSystemMap`), black with a thin grey frame, showing the current system's orbits (or the galaxy with the view rectangle when zoomed out); above it a row of 9 filter icons; to its left a column of zoom buttons (magnifier icons: zoom to selection, zoom in, zoom out, 100%, system, sector, galaxy) and a round galaxy button at the bottom.
- Panels are dark (#1a1a1a–#2a2a2a) with subtle bevel/gradient borders, slightly translucent over the map.

## Implementation
- `src/ui/hud.ts` — DOM overlay (absolutely positioned elements over the Pixi canvas, `pointer-events` only on controls), positioned from `computeHudLayout`, re-laid-out on resize.
- Wire: zoom buttons → Main View camera (system / sector / galaxy levels, zoom in/out, 100%, to selection); play/pause + speed → a `GameClock` stub in `src/sim/clock.ts` (paused flag, speed multiplier 0.25×–8× like the original, star date starting at the galaxy's start date — see `StartGameOptions.cs` / `Galaxy.CurrentStarDate` formatting in `$APP/../DistantWorlds.Types/Galaxy*.cs`, grep `ResolveStarDateDescription`); spacebar toggles pause.
- Minimap: small Pixi render (or canvas 2D) of the whole galaxy (star dots coloured by type) with the current view rectangle; click/drag on it moves the camera. Port behavior from `$APP/Controls/GalaxyMap.cs` where relevant.
- Selection panel: show the hovered/selected habitat's name + type + system (details come later).

## Verify
`npm run typecheck`, `npm test`, then with `npm run dev` running take `node scripts/shot.mjs "http://localhost:5173/?zoom=<system level>" shots/05-hud-system.png` and a galaxy-level shot; ensure no console errors; list shots in the Worker report.
