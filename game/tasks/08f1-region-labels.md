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
