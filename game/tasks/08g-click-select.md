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
