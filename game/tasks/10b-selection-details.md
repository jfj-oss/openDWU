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
