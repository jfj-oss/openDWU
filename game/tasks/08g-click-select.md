# Task 08g — Click-to-select in the Main View

thinking: off
scope: locked

Everything you need is here. Edit `src/render/mainView.ts` (add a pick API), `src/main.ts` (wire to the HUD), tests. Start editing right away.

- `mainView.pick(screenX, screenY): Habitat | null` — returns the habitat drawn under the cursor: at system/planet zoom prefer planets/moons whose **drawn** sprite rect contains the point (use the same size function the renderer uses, incl. the min-pixel sizes), then the star; at galaxy/sector zoom pick the nearest star within 12 px of the cursor. Ties → the smaller object.
- Left click (no drag: < 4 px pointer movement between down/up) selects: call the HUD's selection setter (`hud.onSelectionChange` / whatever `src/ui/hud.ts` exposes — read it) with the picked habitat; clicking empty space clears the selection. Remove the "nearest to camera centre" demo stand-in (`pickSelection` in main.ts) once clicking works.
- Draw a thin selection ring (1.5 px, `#4fc3f7`) around the selected object in the Main View, scaled with its drawn size.
- Double-click a star at galaxy/sector zoom → zoom to System level centred on it.
- Tests: pure hit-test helper `hitTestHabitats(list, x, y, sizeFn)` — picks the containing smaller object, returns null on empty space.

Verify: `npm run typecheck`, `npm test`. Append `## Worker report`.

## Worker report

Files changed:
- `src/render/mainView.ts` — added exported pure helper `hitTestHabitats(list, x, y, sizeFn, zoom)` (square rect per object using the renderer's drawn-size functions; smaller object wins ties; null on empty space); added `MainView.pick(screenX, screenY)` (system/planet zoom: planets/moons whose drawn sprite rect contains the point via `planetSpritePx`/`moonDotPx`, then the star via `starSpritePx`; galaxy/sector zoom: nearest star within 12 px of the cursor); left-click (< 4 px down→up movement) selects and pushes to the HUD via a new `onSelectionChange` callback, empty space clears; double-click on a star fires a new `onDoubleClickStar` callback; thin 1.5 px `#4fc3f7` selection ring (`selectionRing` Graphics in the screen-space fx layer) redrawn each frame around the selected object at its drawn size + 4 px.
- `src/main.ts` — wired `view.onSelectionChange` to the HUD's selection setter (resolves the picked habitat's `SystemInfo` from `galaxy.systems`), wired `view.onDoubleClickStar` to centre on the star and zoom to `SYSTEM_LEVEL_ZOOM`; removed the "nearest to camera centre" demo stand-in (`pickSelection` call in `refreshHud`).
- `src/ui/hud.ts` — removed the now-unused `pickSelection` export.
- `test/main-view-pick.test.ts` (new) — hit-test tests: containing-rect pick, smaller-object tie-break (planet over overlapping star; moon > planet > star ordering), null on empty space, non-positive size ignored.

Done: all task bullets implemented; `npm run typecheck` passes; `npm test` passes (18 files, 218 tests). Screenshots saved for visual review (no console errors printed): `shots/08g-system.png` (?zoom=0.05), `shots/08g-sector.png` (?zoom=0.00025), `shots/08g-galaxy.png` (whole galaxy).

Left undone / notes:
- Asteroid fields and gas clouds are not pickable (the task names only planets/moons/stars); `drawnSize` returns 0 for them so they never match.
- The original's exact mouse-hit formulas live in Controls/MainView.cs (not accessible here); the port follows the task spec: drawn-sprite-rect containment with the existing min-pixel sizes, 12 px star proximity at galaxy/sector zoom, smaller-object tie-break.
- Double-click also fires after the two single clicks have already selected the star (harmless: same selection, then the zoom).
