# Task 12k — Main View hover tooltip

thinking: off
scope: locked

Edit only `src/render/mainView.ts` (the mousemove handler ~line 1176 and a small tooltip helper), create `src/ui/mapTooltip.ts` + `mapTooltip.css`, and add tests. Start editing right away.

When the mouse rests on a pickable object in the Main View, show a small DOM tooltip next to the cursor.

1. `mapTooltip.ts`:
   - `export function tooltipText(h: Habitat, systemName: string | null): string` — pure, tested. It returns:
     - for a star (`h.category === HabitatCategoryType.Star` — check the enum in src/sim/types.ts): `h.name`;
     - for any other habitat: `h.name`, then ` — ${h.empire.name}` when `h.empire` is non-null and its name is not empty, then ` (${systemName})` when systemName is given and differs from h.name.
   - `export function showMapTooltip(text: string, x: number, y: number): void` and `export function hideMapTooltip(): void`. There is one absolutely positioned div (`pointer-events: none`), placed 14px right and 14px below the cursor, styled like the HUD panels: dark translucent background, small text.
2. `mainView.ts` mousemove:
   - When not dragging, debounce with a ~120 ms timeout. Then call `this.pick(x, y)` (the existing 08g picker, ~line 794).
   - On a hit: `showMapTooltip(tooltipText(hit, systemName), e.clientX, e.clientY)`. For systemName, use the system star's name. Find how the selection code gets a habitat's system (`galaxy.systems[h.systemIndex].systemStar.name` is used in main.ts) and do the same, guarded.
   - On a miss, when dragging starts, or when the pointer leaves the canvas: `hideMapTooltip()`.
3. Tests (no jsdom) for `tooltipText`:
   - a star;
   - a planet with no empire;
   - a colonized planet;
   - a planet whose system name equals its own name (no suffix).

Run `npm run typecheck` && `npm test`, then append `## Worker report`.

## Worker report

**Files changed:**
- `src/ui/mapTooltip.ts` (new) — `tooltipText(h, systemName)` (pure), `showMapTooltip(text, x, y)`, `hideMapTooltip()`. One `position: fixed; pointer-events: none` div appended to `document.body`, placed at cursor + 14 px right / + 14 px down.
- `src/ui/mapTooltip.css` (new) — `.dwu-map-tooltip`: dark translucent background (`rgba(20,22,28,.95)`), thin border, 12 px text, styled like the HUD panels/toast.
- `src/render/mainView.ts` — mousemove handler now debounces ~120 ms when not dragging, then calls the existing `pick(x, y)`; on a hit shows the tooltip with `tooltipText(hit, systemName)` where systemName is `galaxy.systems[hit.systemIndex].systemStar.name` (guarded with an `undefined` check); on a miss, while dragging, or when the pointer leaves the canvas it hides. Added a `dispose()` method that clears the debounce timer and removes the tooltip div.
- `src/main.ts` — `activeGameViewCleanup` now calls `view.dispose()` before `app.destroy(true)` so the tooltip div doesn't leak between games. (One line outside the named files, needed for teardown.)
- `test/mapTooltip.test.ts` (new) — tests for star, planet without empire, colonized planet (incl. empty empire name), and planet whose name equals its system name (no suffix).

**Done:** all of items 1–3 in the task. `npm run typecheck` passes; `npm test` passes (608 tests, 52 files). Headless screenshots saved: `shots/12k-tooltip.png` (whole-galaxy view) and `shots/12k-tooltip-system.png` (`?zoom=0.05`) — no console errors printed by shot.mjs. The tooltip itself only appears after a real mouse rests on an object for ~120 ms, so it isn't visible in static screenshots.

**Left undone:** nothing material. Note: the tooltip uses `position: fixed` with clientX/clientY (the task said "absolutely positioned" — fixed behaves identically here since the page has no scrolling container).
