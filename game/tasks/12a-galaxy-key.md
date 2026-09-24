# Task 12a — G key: zoom out to the whole galaxy

thinking: off
scope: locked

Edit only `src/ui/keyboard.ts` and `test/keyboard.test.ts`. Start editing right away.

The Main View is one seamless map, so there is no separate Galaxy Map screen. The `G` key (`galaxyMap` action) should zoom the Main View out to show the whole galaxy.

In `buildDefaultHandlers` (keyboard.ts, around line 270), replace
```ts
        // TODO(key): open the Galaxy Map screen (no openGalaxyMap hook today;
        // the View-list row only zooms out to galaxy level).
        galaxyMap: () => console.info('TODO(key): galaxyMap'),
```
with a handler that sets `camera.zoom = camera.minZoom` and centres the camera on the middle of the galaxy. `camera.minZoom` is the galaxy-fit zoom, set by `Camera.setGalaxyBounds` (src/render/camera.ts).
- The galaxy middle is `(galaxyWidth / 2, galaxyHeight / 2)`, stored in world units.
- `buildDefaultHandlers(camera, time)` does not know the galaxy size. Add an optional third parameter `galaxySize?: { width: number; height: number }`.
- When `galaxySize` is given, call `camera.centerOn(width / 2, height / 2)`. When it is missing, zoom only.
- Do NOT change main.ts. The orchestrator will pass the size in.

Change the binding description `'Galaxy Map screen'` to `'Zoom out to the whole galaxy'`.

Test (in test/keyboard.test.ts, following the existing Backspace test's style):
- the `galaxyMap` handler sets zoom to minZoom;
- with galaxySize, it centres on the middle of the galaxy.

Run `npm run typecheck` && `npm test`, then append `## Worker report`.

## Worker report

Files changed:
- `src/ui/keyboard.ts` — replaced the `galaxyMap` TODO handler in `buildDefaultHandlers` with one that sets `camera.zoom = camera.minZoom` (the galaxy-fit zoom from `Camera.setGalaxyBounds`) and, when an optional third parameter `galaxySize?: { width; height }` is given, calls `camera.centerOn(width / 2, height / 2)`. Added the optional `galaxySize` parameter to `buildDefaultHandlers`. Changed the G binding description from `'Galaxy Map screen'` to `'Zoom out to the whole galaxy'`.
- `test/keyboard.test.ts` — added two tests following the Backspace test's style: G sets zoom to minZoom and centres on the galaxy middle when `galaxySize` is passed; without it, G only zooms (position unchanged).

Done: all of the above. `npm run typecheck` passes; `npm test` passes (50 files, 581 tests).

Left undone: nothing in scope. main.ts was not touched (per instructions, the orchestrator will pass the galaxy size into `buildDefaultHandlers`).
