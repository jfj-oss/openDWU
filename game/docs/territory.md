# Empire territory: how the original works and how we port it

Source paths are relative to `$DWU/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/`.

## 1. Influence radius (sim)

`DistantWorlds.Types/Habitat.cs` `RecalculateColonyInfluenceRadius(empireHasWarptech)` (1066-1114):

- The radius is 0 for the independent empire, for a colony with no population, and for a colony without an empire (1067, 1094-1102).
- Non-expanding races (`!DominantRace.Expanding`): `200000 + clamp(sqrt(StrategicValue) * 700, 0, 150000)` (1074-1076).
- Everyone else: with `num = max(10, DevelopmentLevel) * (Population / 1e6)`, the radius is `500000 + clamp(sqrt(num) * 700, 0, 1e6)`, plus `sqrt(num - 700000) * 100` once `num > 700000` (1079-1091).
- It is multiplied by `Galaxy.EmpireTerritoryColonyInfluenceRangeFactor` (1103-1109). That factor is lazily set to `clamp(sqrt(SectorWidth * SectorHeight / StarCount * 7), 0.5, 2)`, so a sparse galaxy gets bigger bubbles and a dense one smaller. This is the "Colony Influence Range" scaling. The wizard has no slider for it; a value of 0 or less means "auto".
- It is also multiplied by `BaconHabitat.TerritoryMultipler` (x2 for "Romulan" empires, x0 below 1M population).
- Without hyperdrive tech the radius is capped at 100000 (1110-1113).
- It is recalculated per colony on the habitat's huge-processing span (Habitat.cs 1525-1535), on conquest (Empire.1.cs 271), and on every territory review or territory bitmap build. Note that `EmpireTerritoryColony`'s constructor and the `CalculateEmpireTerritory*` functions call `RecalculateColonyInfluenceRadiuses` too.

Only **colonies** project influence: `Empire.Colonies` with `colony.Owner == empire`. Space ports, bases, mining stations and other `BuiltObject`s never add territory. Bases only matter as things the territory rules forbid (`CheckEmpireTerritoryCanBuildAtLocation`).

Ported in `src/sim/territory.ts` (`recalculateColonyInfluenceRadius`, `strategicValue`, `territoryMultiplier`). It already matched the original.

## 2. Ownership rule and the sim territory grid

`DistantWorlds.Types/EmpireTerritory.cs`:

- `CalculateColonyInfluenceAtPoint` (520-533): `influence = r² / max(1, d²)` when `d <= r`, otherwise 0. A point belongs to the colony, and so the empire, with the **highest** influence. This is a weighted (Apollonius) partition: where two bubbles overlap, the border is the curve where `r1/d1 = r2/d2`, not the midpoint. Bigger colonies push the border towards smaller rivals. Colonies of the same empire simply merge.
- "Contested" space has no separate state. The overlap goes to whichever colony is stronger at that point. `CheckSystemOwnership` (47-58) reports `disputed` when `SystemInfo.OtherEmpires` is non-empty, but that flag only feeds AI and diplomacy, never drawing.
- `CalculateEmpireTerritoryGridIndex` (105-284) builds the gameplay index. It is a `byte[2000][2000]` grid over the galaxy (`TerritoryIndexSize = 2000`, line 19) storing `EmpireId + 1`. Each colony fills the cells in its bounding box that are still 0, with the argmax over itself and its `DetermineOverlappingColonies` (bounding-box overlap within ±2 sectors, 891-938).
- With `onlySystems` set (164-205), a **fresh** grid is built in which only the cell holding each system star is set, using the argmax over all colonies.
- `CheckLocationOwnership(x, y)` (82-93) reads that grid. Gameplay uses it via `Galaxy.CheckEmpireTerritoryCanBuildAtLocation` / `...AtHabitat` / `CheckEmpireTerritoryIdAtLocation` / `CheckMilitaryShipWelcomeAtTerritoryLocation` (Galaxy.cs 3660-3720), resource targeting, pirate and independent-trader logic, and `Galaxy.7.cs 3173`. `CheckSystemOwnership` prefers `SystemInfo.DominantEmpire` and falls back to the grid.
- Reviews: `Galaxy.ReviewEmpireTerritory(onlySystems)` (Galaxy.cs 3376-3423) runs on the ThreadPool. When the core is already busy, the request sets `_RegenerateEmpireTerritoryAgain` and is re-run once.
  - Huge span (240 s) runs a full review (3083).
  - Long span (60 s) runs a systems-only review when the huge span did not fire (3122). Because the systems-only review builds a fresh grid, for most of the time **only star cells are owned** in the gameplay index. That is the original's behaviour, and our port keeps it.
  - Other triggers: conquest (Habitat.cs 4233, full), colonising (BuiltObject.2.cs 1003, systems), map trades to the player (Galaxy.4.cs 3804/3853, systems), game start and load (Start.2.cs 984/1098/1101/1487, Main.Part12.cs 3355).

Our sim (`src/sim/territory.ts` `EmpireTerritory` / `calculateEmpireTerritoryGridIndex`, `src/sim/exploration.ts` `reviewEmpireTerritory`, `src/sim/tick/galaxyTick.ts` 127/193, plus `invasion.ts`, `cmdTroops.ts` and `game.ts`) is already a line-by-line port of all of this. It is not a simplification, so **no sim change was needed and no pins move**.

## 3. How it is drawn

The territory bitmap is separate from the gameplay index. It is rebuilt by the renderer, for the viewer, by `CalculateEmpireTerritoryGrid` (EmpireTerritory.cs 365-509):

- **Which colonies count:** active empires' colonies, `Owner == empire`, not destroyed, and only colonies in systems the viewer has explored (`godMode || viewingEmpire == null || CheckSystemExplored(colony.SystemIndex)`, 417). The same filter applies to the rival colonies a pixel is contested with (427), so an unexplored rival does not cut into the borders you can see.
- **Per pixel:** the argmax colony as above. The pixel is painted the owner's `Empire.MainColor`, fully opaque (476-505). Pixels outside every bubble stay transparent.
- **Smoothing:** `GraphicsHelper.SmoothImage` (GraphicsHelper.cs 197-204) scales the bitmap to 1.1x and back with bilinear filtering, which gives soft edges about one pixel wide.
- **Blend:** the bitmap is drawn through `method_236(0.25)` (MainView.2.cs 3665), a colour matrix that sets alpha to **25%**. The look is a flat MainColor wash at 25% with hard-but-smoothed borders. **There are no border lines**, no separate outline stroke, and no special colour for contested zones: the colour just switches at the Apollonius curve.
- **Galaxy zoom:** `Main.ResetGalaxyBackdrops` (Main.Part12.cs 3214-3245) → `MainView.method_148` (MainView.2.cs 342-363) bakes the territory into the galaxy backdrop bitmap at the backdrop's 2000x2000 resolution (`galaxy_backdrop.jpg`). This is skipped with Clean Galaxy View. It is regenerated when a territory review finishes (`OnRefreshView(onlyGalaxyBackdrops: true)`, Galaxy.cs 3416-3418).
- **Zoomed in (sector background):** MainView.2.cs 238-275 and MainView.1.cs 3988-4003 recompute the grid for the visible galaxy section at viewport resolution whenever the background is redrawn (zoom stable / stabilising), then smooth it and blend it at 25%.
- **The "Empire Territory" map overlay** (`GameOptions.MapOverlayEmpireTerritory`, toggled in Main.Part2.cs 1349) does not show or hide territory. It selects the algorithm:
  - On: the grid above.
  - Off: `CalculateEmpireSystemTerritory` (EmpireTerritory.cs 313-363). For every explored system whose `CheckSystemOwnership` resolves to an empire, the soft influence sprite (`bitmap_4` / `bitmap_187`) is stamped, tinted MainColor, at `(150000 * (1 + zoom/10000) / scale + 0.5) * 1.1` px. In our port this is the station-presence disc layer, `src/render/galaxyMarkers.ts`, shown while Empire Territory is off.
- **The Galaxy Map window** (GalaxyMap.cs 141-157) uses the same functions at the control's size, at 40% (`TransparentImage(0.4)`). `SystemView.cs` 230 does too.

## 4. Our port (render)

`src/render/territoryField.ts` + `src/render/empireLayer.ts`:

- `collectTerritorySources(galaxy, viewer)` applies the original's colony filter, including the explored-system rule for both sides of a contest. `viewer` is `fogOf(galaxy).player`; it is null with `?reveal=1` / god mode.
- `buildTerritoryMeshes` uses the same ownership rule. Instead of a pixel bitmap, it splats `r²/d²` onto a 1024-cell vertex grid. At each vertex it keeps the best influence, the empire that has it, and the best influence of any other empire. It then runs marching squares on `s_E = min(ln f_E, ln f_E − ln g_E)`:
  - `s_E > 0` means "inside one of E's bubbles and the strongest there".
  - Borders are interpolated within a small fraction of a cell. Neighbours share the same crossing points, so contested borders have no gaps or overlaps.
  - Fully owned cells merge into row runs.
  - The output is one triangle mesh per empire in world space.
- **Bounds:** the original's bitmap covers exactly the galaxy: `galaxySection = (0, 0, SizeX, SizeY)`, with each colony's pixel box clamped to `[0, size)` (EmpireTerritory.cs 389-393 / 470-475). The gameplay index does the same (120-123 / 237-240). So territory never extends past the galaxy edge. The mesh is clipped to `[0, sizeX] x [0, sizeY]` (Sutherland-Hodgman on the last cell column and row).
- **Drawing:** one Pixi `Mesh` per empire, tinted MainColor (`empireColour`), in a container at alpha `TERRITORY_ALPHA = 0.25`. The regions are disjoint, so one container alpha is the original's single 25% blend. There are no border strokes, as in the original.
- **Soft edges (`SmoothImage`):** `src/render/territoryRaster.ts` rasterises the same influence grid into a premultiplied Float32 RGBA bitmap, one texel per grid cell. Interior cells take the owner colour; border cells are split between the empires whose `s_E > 0` region crosses them, by 4x4 sub-samples of the bilinear `s_E` (the field the meshes contour), so the half-alpha line is the mesh edge. A separable 9-tap binomial blur (`[1 2 1]` four times, sigma about 1.4 cells) runs on premultiplied float colour with no intermediate rounding: rival borders blend with no gap, outer edges fade monotonically, and the blur clamps at the grid edge so the galaxy-edge clip stays hard. The result is stored as premultiplied half floats. `EmpireLayer` uploads them as an `rgba16float` `BufferImageSource` (`alphaMode: 'premultiplied-alpha'`, linear filtering) on WebGL2 and WebGPU, where RGBA16F is always filterable. On WebGL1 it falls back to `rgba8unorm`, premultiplied and quantised once with an 8x8 ordered dither. There is no 2D canvas round-trip and no un-premultiply step. The layer shows the bitmap as a sprite at galaxy zoom and crossfades to the crisp vector meshes once a bitmap pixel is larger than about 4-12 screen px (the original recomputes at viewport resolution there). The bitmap is built once per territory rebuild, time-sliced (about 60 ms more CPU than the old 8-bit blur on the 1500-colony benchmark, spread over frames); per-frame cost is only the alpha update. The Galaxy Map window's canvas gets a straight-alpha 8-bit image derived from the floats: exact owner colour, and alpha quantised once with the ordered dither.
- **When it is rebuilt:** the build is event-driven, never per frame. Every 30 frames the layer hashes its sources (`territorySignature`: owner, position quantised to a cell, radius to half a cell). It rebuilds only when that hash changes (ownership, newly explored system, influence growth, colony lost), at most every 1.5 s. The build is a generator, time-sliced at 4 ms per frame; the very first build runs to completion.
- **Cost:** a synthetic 30M-unit galaxy (15x15 sectors) with 1500 colonies from 20 empires builds in about 130-170 ms of total CPU, in slices of at most about 7-12 ms. It produces about 450k triangles, uploaded once.
- **Zoom:** galaxy and sector zoom only. The fill fades out from zoom factor 300 down to 70 and is hidden at system zoom (factor < 70), as before.

### Deviations

- The renderer reads `Habitat.colonyInfluenceRadius` as the sim keeps it, instead of recalculating radii from the draw call. The original's draw-time `RecalculateColonyInfluenceRadiuses` mutates sim state at render frequency.
- We use one resolution-independent mesh instead of a 2000 px backdrop copy plus a viewport-resolution recompute.
- The Galaxy Map window and the mini maps that use `drawMapTerritory` (galaxyMap.ts: `drawSystemsMiniMap`, the Expansion Planner map) draw the same cached bitmap at 40% (GalaxyMap.cs 141-157). The bitmap is published by the Main View layer and shared per galaxy (`getTerritoryRaster`), rebuilt only when the source signature changes.
