# Task 12m — Colonies list panel (F2)

thinking: off
scope: locked

Create `src/ui/screens/coloniesList.ts` + `coloniesList.css`. Edit `src/ui/keyboard.ts` (the F2 action only) and `src/ui/screens/empireSummary.ts` (add one exported getter). Add tests. Do NOT edit hud.ts. Start editing right away.

1. `empireSummary.ts`: add `export function getEmpireSummarySource(): EmpireSummarySource | null` that returns `source?.() ?? null`. The HUD already registers the player empire there.
2. `coloniesList.ts`: copy the look and behaviour of `src/ui/screens/empiresList.ts`/`.css`: panel, × close, Escape closes with stopPropagation, toggle API, and a header row. Read them first.
```ts
export interface ColoniesListOptions { empire: Empire; onZoomTo: (h: Habitat) => void }
export function toggleColoniesList(opts: ColoniesListOptions): void;
export function closeColoniesList(): void;
export function colonyRows(empire: Empire): { habitat: Habitat; name: string; population: string; isCapital: boolean }[];  // pure, tested
```
   - `colonyRows`: `empire.colonies`, sorted by population descending (a missing population counts as 0), ties broken by name.
   - `population` is `formatPopulation(totalAmount)` from `../hud`.
   - `isCapital` is `empire.capital === habitat`.
   - Panel: the title is "Colonies"; the columns are Name (with a small "capital" tag when isCapital) | Population (right-aligned). Clicking a row calls onZoomTo and closes the panel.
3. `keyboard.ts` `buildDefaultHandlers`: add a handler for `coloniesScreen`:
```ts
const src = getEmpireSummarySource();
if (src) toggleColoniesList({ empire: src.empire, onZoomTo: (h) => { camera.centerOn(h.xpos, h.ypos); camera.zoomAt(SYSTEM_LEVEL_ZOOM, cx(), cy()); } });
```
   This uses the same camera calls as the existing zoomToSelection handler. Add the matching `case` in dispatchKey, and change the description to 'Colonies'.
4. Tests (no jsdom), for `colonyRows` with a fake empire:
   - the sort order, including a tie;
   - the capital flag;
   - a missing population counts as 0.

Run `npm run typecheck` && `npm test`, then append `## Worker report`.

## Worker report

Files changed:
- `src/ui/screens/empireSummary.ts` — added `getEmpireSummarySource()` (returns `source?.() ?? null`).
- `src/ui/screens/coloniesList.ts` (new) — panel + `toggleColoniesList` / `closeColoniesList` / pure `colonyRows`; look and behaviour copied from `empiresList.ts` (wrap/window/titlebar, ✕ close, Escape closes with stopPropagation, header row). Title "Colonies"; columns Name (with a small "capital" tag when isCapital) | Population (right-aligned); clicking a row closes the panel and calls `onZoomTo(habitat)`.
- `src/ui/screens/coloniesList.css` (new) — same dark-panel tokens as empiresList.css; grid `minmax(0, 1fr) 7em`.
- `src/ui/keyboard.ts` — F2 `coloniesScreen`: new handler in `buildDefaultHandlers` (reads `getEmpireSummarySource()`, no-op without a source; zoom = `camera.centerOn(h.xpos, h.ypos)` + `camera.zoomAt(SYSTEM_LEVEL_ZOOM, cx(), cy())`, same calls as `zoomToSelection`), matching `case 'coloniesScreen'` in `dispatchKey`, description changed to 'Colonies'.
- `test/coloniesList.test.ts` (new) — `colonyRows`: sort order incl. a tie (broken by name), capital flag, missing population counts as 0.

Done: all of items 1–4. `npm run typecheck` passes; `npm test` passes (54 files, 615 tests).

Left undone: nothing in scope. Not verified visually (no screenshot taken — DOM panel; console output was clean during tests). hud.ts untouched per instructions.
