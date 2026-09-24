# Task 10b — Selection panel: real habitat details

thinking: off
scope: locked

Everything you need is here. Edit `src/ui/hud.ts` (+ `hud.css`) and tests. Do not edit `src/sim/`. Start editing right away. Do not Read image files.

When a habitat is selected (08g click-to-select), fill the bottom-left selection panel:
- Header: name (bold) + subtitle `"<Type> · <System name> system"` (type label from `HabitatType` enum name split into words, e.g. `MarshySwamp` → "Marshy Swamp"; category Planet/Moon/Star/Asteroid/Gas cloud).
- Rows (hide empty): **Quality** `baseQuality × 100` as `%` (planets/moons only), **Diameter**, **Resources**: one small icon per `habitat.resources` entry with its abundance % as a tooltip/label — icon `/assets/dwu/images/ui/resources/Resource_<pictureRef>.bmp` where `pictureRef` comes from the resource definition (`gameData.resources` by `resourceId`; browsers can display BMP), **Natives**: for each `habitat.population` entry, race name + amount formatted `1.2B`/`350M`, **Scenic** (`scenicFeature` if set), **Research bonus** (if > 0, with its industry).
- For stars: star type, planet count in its system, scenic/research lines.
- Pure helpers + tests: `formatPopulation(n)` (`1_200_000_000 → '1.2B'`, `350_000_000 → '350M'`, `4_200 → '4.2K'`), `habitatTypeLabel(type)`, `resourceIconUrl(pictureRef)`.
Pass `gameData` into the HUD if it isn't available there yet (small change in `createHud` options; `main.ts` already has it — add only the argument).
`npm run typecheck` && `npm test`; save (don't open) `shots/10b-selection.png` after selecting a planet (add a `?select=<habitat name>` URL param that selects that habitat on boot, for screenshots). Append `## Worker report`.

## Worker report

Files changed:
- `src/ui/hud.ts` — selection panel now shows real habitat details: header (bold name + subtitle `"<Type> · <System name> system"`), rows Quality (`baseQuality × 100` as %, planets/moons only), Diameter, Resources (one icon per entry via `resourceIconUrl(def.pictureRef)` with abundance % label/tooltip, looked up in `gameData.resources` by resourceId), Natives (race name + `formatPopulation` amount), Scenic (if set), Research bonus (with industry if > 0); stars get a "Planets" count row. New pure helpers: `formatPopulation`, `habitatTypeLabel(type, category?)`, `resourceIconUrl(pictureRef)`, plus `buildSelectionRows(sel, gameData?)`. `HudWiring` gained an optional `gameData` field.
- `src/ui/hud.css` — styles for the resources row (`.hud-resource-row`, `.hud-resource-icons`, `.hud-resource-pct`).
- `src/main.ts` — added `?select=` to `SKIP_MENU_PARAMS` and `BootOptions`/`parseBootOptions`; on boot, `?select=<name>` centres the camera on that habitat and pushes it to the HUD selection panel. Also added the browser-side `fetchTextBrowser` + `loadGameDataOrNone` plumbing so `generateGalaxy` and `createHud` both receive the parsed `gameData` (the task assumed main.ts already had it; it didn't — without this, no resources would be generated or shown).
- `test/hud.test.ts` — tests for `formatPopulation` (1.2B / 350M / 4.2K / plain), `habitatTypeLabel` (word-splitting + category word, incl. no-category case), `resourceIconUrl`.

Verification: `npm run typecheck` clean; `npm test` → 29 files / 308 tests passed. Screenshot saved (not opened) at `shots/10b-selection.png` via `node scripts/shot.mjs "http://localhost:5173/?seed=1&select=Girax%201&zoom=0.001" shots/10b-selection.png` — console output showed only vite connect lines, no errors/warnings. The selected habitat is **Girax 1** (a planet with quality ~12.8%, diameter 285, two resources), discovered by generating the galaxy headlessly through vitest (raw node can't run the TS sim due to extensionless imports + enums).

Left undone / notes:
- Natives row is hidden for this seed's planets (no native populations are generated on seed 1 spiral 700-star galaxies — `population` is empty everywhere), so the screenshot shows Quality/Diameter/Resources but not Natives; the code path is in place and unit-tested via the helper.
- Scratch discovery script removed; nothing else left over.
