# Handoff — cloud lane C, task C3: Galaxy Map screen (G key)

Branch `claude/cloud-lane-c3` (based on working branch `8bc6f08`; independent of C1). Typecheck clean; full suite passes.

## Files
- **New:** `src/ui/screens/galaxyMap.ts`, `src/ui/screens/galaxyMap.css`, `test/galaxyMap.test.ts` (11 tests).
- **Wiring only:** `src/ui/hud.ts` adds an optional `onGalaxyMap` to `HudWiring`. The "Galaxy map (G)" row calls it (and falls back to the old galaxy zoom). The "Galaxy" row keeps the zoom. `src/main.ts` creates the screen, passes `onGalaxyMap`, adds G toggle / Esc close, and exposes `__dwu.galaxyMap` for screenshots.

## Ported (C# refs)
- Map rendering = `Controls/GalaxyMap.cs` method_6: backdrop (`galaxy_backdrop.jpg`) stretched over the galaxy, nebula layer, sector grid in pen_1 rgb(32,32,88) with A.. column and 1.. row labels, systems coloured by method_4 (brushes from Main.Part13.cs 249-256), gas clouds violet, dot sizes num28/num29, dimmed rgb(80,80,80) and yellow selection while a filter is active, and the pen_2 rgb(96,96,255) crosshair on the selected system.
- Screen logic = Main.Part11.cs method_131/132 (open/close), gmapMain_MouseUp (click selects the nearest top-level habitat), gmapMain_MouseDoubleClick + btnGalaxyMapGoto_Click (jump the Main View and close).
- View modes = the 11 of Main.Part3.cs 1036 / Main.Part9.cs 3663, with the Potential-Colonies habitat-type combo and the Known-Resources resource combo (resources sorted by name).

## Streamlined (per HUD notes), not 1:1
One full-screen overlay: the map on the left, a hud-panel side panel on the right (View, secondary filter, Nebulae / Region-names toggles, selection info, match list, Go to, Key legend). Additions the user asked for: region names (same ShowName rule as the 08f1 Main View labels) and the current Main View rectangle drawn in pen_2. The system mini-map, habitat info panel and back/forward history are left out.

## Deviations / TODO
- Nebula layer: the C# shows the GalaxyNebulaeGenerator whole-galaxy image (generateImage path, `bitmap_182`), which isn't ported. The map uses the per-location NebulaCloudGenerator clouds (same seeds as the Main View, 08f2) at map resolution and 55% alpha.
- **No empires yet → "god mode" player:** everything counts as explored and surveyed, and Our Systems / Potential Colonies / Enemy Systems / Pirate Bases are empty. Pass a real `GalaxyMapPlayer` (from the player Empire + C1 `EmpireVisibility`) to `createGalaxyMap` once M2 lands. Ancient Ruins stays empty until Habitat.Ruin exists. Independent Populations needs the owner check (M2b).
- Known Resources lists nothing while `main.ts` generates the galaxy without `gameData` (no resources loaded).
- The C# AutoPauseWhenInPopupWindow pause isn't wired (hooks `onOpen` / `onClose` exist).
- No fleet postures or empire territory (need empires).

## Screenshots (real art; in `game/shots/`, not committed)
- `c3-galaxy-map.png`: default view.
- `c3-galaxy-map-scenic.png`: Scenic Locations filter, a selected system with crosshair, Key open.
Verified in headless Chromium: the HUD row and G open it, Esc closes it (also from inside the dropdown), Go-to jumps and closes, no page errors.
