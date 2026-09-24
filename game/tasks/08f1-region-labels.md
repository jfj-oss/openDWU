# Task 08f1 — Main View: galaxy region / nebula labels

thinking: off
scope: locked

Everything you need is here. Edit only `src/render/mainView.ts` (the `regionLabels` hook left by task 02) and a test. Start editing right away. Do not Read image files.

`galaxy.galaxyLocations` (task 01e) gives each location `{ name, type, xpos, ypos, width, height, showName, effect }` (read `src/sim/galaxyLocation.ts` for exact field names).

## Source (verbatim, MainView.2.cs 4675–4705; `double_15` = zoom factor = world units per screen pixel; `main_0.double_5` = max zoom-out factor)
```csharp
if (main_0.double_0 > 70.0 && main_0.double_0 <= main_0.double_5)
  foreach galaxyLocation (known to the empire — treat all as known for now):
    x = (galaxyLocation.Xpos + galaxyLocation.Width / 2.0 - viewLeft) / double_15;   // screen centre of the location
    y = (galaxyLocation.Ypos + galaxyLocation.Height / 2.0 - viewTop) / double_15;
    if (on screen ±100 px && galaxyLocation.ShowName) {
        font = (type == NebulaCloud)
             ? (double_15 > 4000 ? font_2 : (double_15 > 1000 ? font_0 : font_1))
             : (double_15 > 4000 ? font_3 : (double_15 > 1000 ? font_2 : font_0));
        // text centred on (x, y); for non-nebula locations shift by (-5, -20)
        DrawString(name, font, White)
    }
// fonts (MainView.cs 624–627): font_0 = 16.67 px regular, font_1 = 18.67 px bold, font_2 = 15.33 px regular, font_3 = 10.67 px regular
```
## Implement
- A Pixi text layer for location names, updated when the camera changes; zoom factor = `1 / camera.zoom` (px→world). Visible only while `70 < factor <= maxFactor` (the camera's full-galaxy factor). Font 'Forgotten Futurist' at the sizes above, colour white, alpha 0.85, centred, with the non-nebula offset.
- Cull off-screen labels; create Text objects once and reuse.
- Pure helper `regionLabelFont(type, factor): { size, bold } | null` (null when not visible) + unit tests covering each branch.

Verify: `npm run typecheck`, `npm test`; save (don't open) `shots/08f1-labels.png` at `/?zoom=1200` and `/?zoom=6000` (1600×900). Append `## Worker report`.

## Worker report

Files changed:
- `src/render/mainView.ts` — implemented the `regionLabels` hook left by task 02:
  - Exported pure helper `regionLabelFont(type, factor, maxFactor)` implementing the MainView.2.cs 4675–4705 font table (NebulaCloud: >4000 → 15.33px regular, >1000 → 16.67px regular, else 18.67px bold; other types: >4000 → 10.67px, >1000 → 15.33px, else 16.67px), returning `null` outside `70 < factor <= maxFactor`.
  - New `RegionLabel` class: one screen-space Pixi `Text` per `GalaxyLocation` (created once in `init()`, reused), white fill, alpha 0.85, 'Forgotten Futurist' font, centred on the location's screen centre with the non-nebula (-5, -20) px offset; culled off-screen ±100 px; style rebuilt only when the zoom-factor branch changes.
  - `MainView.update()` now updates all region labels each frame with `factor = 1/camera.zoom`, `maxFactor = 1/minZoom` (the full-galaxy factor); label layer moved from `world` to the screen-space `fx` container. All locations treated as known to the empire (per task note).
- `test/main-view-fades.test.ts` — new `region label fonts` describe block covering null outside the window, both window edges (70 exclusive, maxFactor inclusive), and every font branch for NebulaCloud and non-nebula types.

Done / verified:
- `npm run typecheck` passes; `npm test` passes (213 tests, 17 files).
- Headless screenshots saved (no console errors): `shots/08f1-labels-zoom1200.png` and `shots/08f1-labels-zoom6000.png` (1600×900).
- Live-state check via `window.__dwu`: at ?zoom=1200 two arm names visible ("Zunama Sicut Arm", "Sacreya Arm"); at ?zoom=6000 forty-four labels visible (arm/storm/tempest names); at ?zoom=80 and ?zoom=60 zero labels (below the `>70` threshold), matching the source condition.

Left undone:
- Empire knowledge filtering is not implemented (task says treat all locations as known for now).
- The original's exact grey text colour was not given in the source excerpt; used white at alpha 0.85 per the task spec.
- `double_5` (max zoom-out factor) is approximated as `1/minZoom` (whole-galaxy fit); the original constant may differ slightly.
