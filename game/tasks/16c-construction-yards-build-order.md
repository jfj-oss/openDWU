# Task 16c — Construction Yards (F10) and Build Order (F9)

thinking: off
scope: locked

Edit only these files:
- a new `src/ui/screens/constructionYards.ts` and a new `src/ui/screens/constructionYards.css`
- a new `src/ui/screens/buildOrder.ts` and a new `src/ui/screens/buildOrder.css`
- `src/ui/hud.ts`: only the four `[16c]` blocks below (one import line, one module-level hook, one registration in `buildSelectionPanel`, one block in `buildTopBarButton`'s click listener)
- `src/ui/keyboard.ts`: only the three `[16c]` hook blocks below (one import line, one `dispatchKey` block, one `IMPLEMENTED_KEY_ACTIONS` line)
- `src/main.ts`: only the two `[16c]` lines below (one import line, one close line)
- new `test/constructionYards.test.ts` and `test/buildOrder.test.ts`

Do NOT edit anything under `src/sim/`. Only import from it (read-only). The only write in this task is the wait-queue reorder that the original UI makes itself (a plain list reorder, step 1). Three other agents (16a, 16b, 16d) edit `keyboard.ts`, `hud.ts` and `main.ts` at the same time. Put each hook exactly at the anchor given, wrapped in its `[16c]` / `[/16c]` marker comments. Do not reformat, reorder or "tidy" any neighbouring line, or the four branches will not merge. Start editing right away.

After this task:
- **F10** and the top-bar `tbtnConstructionYards` button (`constructionYardsButton.png`) open a streamlined **Construction Yards** panel. It lists the player's ship yards (space ports and other yard bases) and colonies with their yard, build and wait counts. The selected site shows:
  - its yards: the ship under construction, its progress and the yard speed;
  - its wait queue ("Ships waiting to be constructed") with **Move to Top / Move Up / Move Down / Move to Bottom**;
  - a **Go to** button that closes the panel, selects the site and zooms to it.
- **F9** and the top-bar `btnBuildOrder` button (`buildButton.png`) open a read-only **Build Order** panel. It has one row per buildable ship type (the original's 16 rows): current amount, the newest buildable design, unit purchase cost and unit maintenance. The **Purchase** button is shown disabled, because the sim has no player build API (see below).

Why Build Order is read-only: the original's Purchase calls `Empire.BuildNewShips(designs, amounts)` (Empire.6.cs:3017). The TS sim does not port it. The AI's own enqueue path (`ConstructionQueue.addBuiltObjectToConstruct`, used by `construction/empireConstruction.ts` directConstruction) is only one step of that method. BuildNewShips also names the ship (`Galaxy.GenerateBuiltObjectName`, which draws Galaxy.Rnd), picks the yard (`FindShortestConstructionWaitQueue`), calls `AddBuiltObjectToGalaxy` (Rnd), procures components, creates resource orders, and charges `StateMoney` plus the pirate-economy expense. That is sim logic and must live in `src/sim/`. So this task leaves a TODO (step 2) and does not call `addBuiltObjectToConstruct`.

House style: copy the structure of `src/ui/screens/shipsAndBasesList.ts` / `coloniesList.ts`:
- module-level `open` state;
- `toggle…` / `close…` exports;
- a document `keydown` Escape handler that calls `stopImmediatePropagation`;
- pure helpers, so tests need no DOM (vitest has no jsdom).

## Existing code you use (read-only; verified at HEAD fe566ad)

- `src/sim/construction/constructionYard.ts` (import-light, safe to import):
  - `class ConstructionYard` with fields:
    - `shipUnderConstruction: BuiltObject | null`
    - `constructionSpeed: number`, `readonly componentId: number`
    - `retrofitComponentsToBeBuilt` / `retrofitComponentsToBeScrapped: ComponentDefinition[] | null`
  - `yardsCountUnderConstruction(yards): number`.
  - `componentListDiff(self, components): ComponentDefinition[]`. It is ComponentList.Diff: `componentListDiff(a, b)` is the C# `a.Diff(b)`, i.e. the entries of `b` left after removing, per entry of `a`, one entry with the same `componentId`.
- `src/sim/construction/constructionQueue.ts`: `class ConstructionQueue` with getters `constructionYards: ConstructionYard[] | null`, `constructionWaitQueue: BuiltObject[] | null` (the live array) and `constructionSpeed: number`.
  - **Do not value-import this module** (constructionYard.ts's header explains the init-order cycle). Use `import type { ConstructionQueue } …` only, and read a site's queue through `site.constructionQueue as ConstructionQueue | null` (the field is `unknown` on both `BuiltObject` and `Habitat`).
- `BuiltObject` (src/sim/builtObject.ts): `name`, `subRole`, `isShipYard`, `constructionQueue: unknown`, `design: Design`, `retrofitDesign: Design | null`, `components` (a `BuiltObjectComponentList` with `count`), getter `unbuiltOrDamagedComponentCount`, `purchasePrice`, `xpos`, `ypos`.
- `Habitat` (src/sim/types.ts): `name`, `constructionQueue: unknown`, `xpos`, `ypos`, `systemIndex`.
- `Empire` (src/sim/empire.ts): `builtObjects`, `privateBuiltObjects`, `colonies`, `designs`, `constructionYards: unknown[]` (the empire's yard list, filled by BuiltObject.ReDefine), `stateMoney`, `galaxy`.
- `src/sim/designGeneration.ts`:
  - `canBuildDesign(empire, design, includeSizeCheck = true, colony = null)`;
  - `findNewestCanBuild(designs, subRole, empire, colony = null, includePlanetDestroyers = false)` (DesignList.cs 160);
  - `resolveSubRoleDescription(subRole)` (GameText sub-role names);
  - `componentDefinitionsStatic(galaxy): ComponentDefinition[]` (each with `componentId`, `name`).
- `src/sim/construction/empireConstruction.ts`: `designCalculateMaintenanceCosts(galaxy, design, empire)` (BaconDesign.cs 163 CalculateMaintenanceCosts).
- `Design.calculateCurrentPurchasePrice(galaxy)` (src/sim/design.ts).
- `src/ui/hud.ts`:
  - `formatMoney(n)`, `nearestSystem(systems, x, y)`, `SYSTEM_LEVEL_ZOOM`;
  - `Habitat` is value-imported there (`import { Habitat, … } from '../sim/types'`), so `instanceof Habitat` works;
  - inside `buildSelectionPanel`: `wiring.galaxy`, `wiring.camera`, `wiring.onSelectionChange?.(sel)`. The Bases cycler selects a base with `wiring.onSelectionChange?.({ habitat: system.systemStar, system, builtObject: next })`.
- `src/ui/screens/empireSummary.ts`: `getEmpireSummarySource(): { empire } | null` (already imported by hud.ts and keyboard.ts).

## C# source (verbatim, trimmed)

DistantWorlds/Main.Part6.cs:3243 `tbtnConstructionYards_Click` opens the Ships & Bases panel with filter index 3 ("Construction Yards"). BaconDistantWorlds/BaconMain.cs `method_423` builds that list:
```cs
else if (text == TextResolver.GetText("Construction Yards")) {
    main.pnlBuiltObjectInfo.HeaderTitle = TextResolver.GetText("Construction Yards");
    for (int i = 0; i < playerEmpire.BuiltObjects.Count(); i++) {
        BuiltObject builtObject = playerEmpire.BuiltObjects[i];
        if (builtObject.IsShipYard && builtObject.ConstructionQueue != null && builtObject.ConstructionQueue.ConstructionYards.Count > 0) builtObjectList.Add(builtObject);
    }
    for (int j = 0; j < playerEmpire.PrivateBuiltObjects.Count; j++) { /* same test */ }
    stellarObjectList.AddRange(builtObjectList);
    for (int k = 0; k < playerEmpire.Colonies.Count; k++) stellarObjectList.Add(playerEmpire.Colonies[k]);
}
```
DistantWorlds.Controls/Controls/ConstructionYardListView.cs:128 `BindData`. The headers are (icon), (flag), (image), "Ship", "Progress" (Format `"p"`) and "Speed":
```cs
if (constructionYards[index].ComponentId >= 0) {
    row.Cells[0].ToolTipText = Galaxy.ComponentDefinitionsStatic[constructionYards[index].ComponentId].Name;
    if (constructionYards[index].ShipUnderConstruction != null) {
        row.Cells[3].Value = ShipUnderConstruction.Name;
        if (ShipUnderConstruction.RetrofitDesign != null) {
            Design design = underConstruction.Design; Design retrofitDesign = underConstruction.RetrofitDesign;
            int num1 = design.Components.Diff(retrofitDesign.Components).Count + retrofitDesign.Components.Diff(design.Components).Count / 4;
            int num2 = RetrofitComponentsToBeBuilt != null ? RetrofitComponentsToBeBuilt.Count : 0;
            int num3 = RetrofitComponentsToBeScrapped != null ? RetrofitComponentsToBeScrapped.Count : 0;
            double num4 = 1.0 - (double)(num2 + num3 / 4) / (double)num1;
            row.Cells[4].Value = num4;
        } else {
            double num = 1.0 - (double)ShipUnderConstruction.UnbuiltOrDamagedComponentCount / (double)ShipUnderConstruction.Components.Count;
            row.Cells[4].Value = num;
        }
    } else { row.Cells[3].Value = string.Empty; row.Cells[4].Value = 0.0; }
    row.Cells[5].Value = constructionYards[index].ConstructionSpeed;
}
```
All the integer divisions (`/ 4`) truncate.

DistantWorlds/Main.Part5.cs:2147-2213, the wait-queue buttons ("Move to Top", "Move Up", "Move Down", "Move to Bottom"; the list label is "Ships waiting to be constructed", Main.Part3.cs:699):
```cs
int num = ConstructionQueue.ConstructionWaitQueue.IndexOf(selectedBuiltObject);
// Top:    if (num >= 0) { RemoveAt(num); Insert(0, selectedBuiltObject); }
// Up:     if (num > 0)  { RemoveAt(num); Insert(num - 1, selectedBuiltObject); }
// Down:   if (num >= 0 && num < ConstructionWaitQueue.Count - 1) { RemoveAt(num); Insert(num + 1, selectedBuiltObject); }
// Bottom: if (num >= 0) { RemoveAt(num); Insert(ConstructionWaitQueue.Count, selectedBuiltObject); }
```
Main.Part2.cs:404 `method_628` (Build Order) builds one row per sub-role, in this order: Escort, Frigate, Destroyer, Cruiser, CapitalShip, TroopTransport, Carrier, ResupplyShip, ExplorationShip, ConstructionShip, SmallFreighter, MediumFreighter, LargeFreighter, MiningShip, GasMiningShip, PassengerShip. The headers are "Current Amount", "Advisor Suggest", "Order Amount", "Design", "Purchase Costs" and "Maint. Costs". Main.Part2.cs:799 `method_629` / :873 `method_630`, one row:
```cs
int num = BaconMain.GetNumberOfShipsOfSubRole(this, subRole);      // PrivateBuiltObjects + BuiltObjects of that sub-role
DesignList buildable = PlayerEmpire.Designs.GetBuildableDesignsBySubRoles({ subRole }, PlayerEmpire);   // !IsObsolete && empire.CanBuildDesign(design)
Design design_ = PlayerEmpire.Designs.FindNewestCanBuild(subRole);   // = FindNewestCanBuild(subRole, designs[0].Empire, null, false)
// method_630:
if (buildable != null && buildable.Count > 0) {
    if ((PlayerEmpire.ConstructionYards == null || PlayerEmpire.ConstructionYards.Count <= 0) && buildable[0].SubRole != ColonyShip && != ConstructionShip && != ResupplyShip)
        label "(" + GetText("No construction yards for this ship type") + ")";   // no design → cost/maint 0
    else DesignDropDown with SetSelectedDesign(design_);
} else label "(" + GetText("No buildable designs") + ")";
```
Main.Part2.cs:1113 `method_641`: the unit cost is `selectedDesign?.CalculateCurrentPurchasePrice(galaxy) ?? 0.0`. Main.Part2.cs:971 `method_633`: the maintenance is `design.CalculateMaintenanceCosts(galaxy, PlayerEmpire)` × amount, and **0 for the six private sub-roles** (SmallFreighter, MediumFreighter, LargeFreighter, PassengerShip, GasMiningShip, MiningShip). Main.Part2.cs:1135 `btnBuildOrderPurchase_Click` ends with `_Game.PlayerEmpire.BuildNewShips(designList_, list_);`.

## Steps

1. `src/ui/screens/constructionYards.ts`
   - Header comment: task 16c, streamlined Construction Yards panel (F10). Cite BaconMain.cs method_423 ("Construction Yards"), ConstructionYardListView.cs BindData and Main.Part5.cs:2147-2213 (wait-queue moves). Add `// TODO(port): remove from queue / scrap ship / construction summary / manufacturing wait queue (Main.Part3.cs:681-700 buttons) — not in 16c`.
   - Imports: `import './constructionYards.css';`, `import type` for `Empire`, `Galaxy`, `BuiltObject`, `Habitat`, `ConstructionQueue`, `ConstructionYard`; `componentListDiff`, `yardsCountUnderConstruction` from `../../sim/construction/constructionYard`; `resolveSubRoleDescription`, `componentDefinitionsStatic` from `../../sim/designGeneration`; `formatMoney` from `../hud`.
   - `export type ConstructionSite = { kind: 'builtObject'; builtObject: BuiltObject } | { kind: 'colony'; habitat: Habitat };`
   - `export function siteQueue(site: ConstructionSite): ConstructionQueue | null`: `(site.kind === 'colony' ? site.habitat : site.builtObject).constructionQueue as ConstructionQueue | null`.
   - `export function constructionSites(empire: Empire): ConstructionSite[]`: the method_423 branch verbatim. That is `builtObjects`, then `privateBuiltObjects`, each filtered on `isShipYard && queue !== null && (queue.constructionYards?.length ?? 0) > 0`; then **every** colony (the C# adds all colonies).
   - `export function yardProgress(yard: ConstructionYard): number`: the BindData progress.
     - 0 without a ship.
     - Retrofit branch: `num1 = componentListDiff(design.components, retro.components).length + Math.trunc(componentListDiff(retro.components, design.components).length / 4)`.
     - Guard both divisors: return 0 when `components.count === 0`, and 1 when `num1 === 0`. Add a comment: the C# would divide by zero.
   - `export function formatProgressP(v: number): string`: .NET `"p"`, i.e. `${(v * 100).toFixed(2)}%`.
   - `export interface ConstructionSiteRow { site: ConstructionSite; name: string; type: string; yards: number; building: number; waiting: number; speed: number }`
     - `type` is `'Colony'` for a colony, else `resolveSubRoleDescription(bo.subRole)`.
     - `yards` = yard count, `building` = `yardsCountUnderConstruction(yards)`, `waiting` = wait-queue length, `speed` = `queue.constructionSpeed`. A null queue gives zeros.
   - `export function constructionSiteRows(empire: Empire): ConstructionSiteRow[]`, in `constructionSites` order.
   - `export interface YardRow { yard: string; ship: string; progress: number; progressText: string; speed: number }`
   - `export function yardRows(site: ConstructionSite, componentName: (componentId: number) => string): YardRow[]`: one row per yard with `componentId >= 0` (the C# skips the others). `ship` is the ship's name or ''. `progressText` is `formatProgressP(progress)`.
   - `export interface WaitRow { builtObject: BuiltObject; name: string; type: string; price: string }`: `type = resolveSubRoleDescription(bo.subRole)`, `price = formatMoney(bo.purchasePrice)`.
   - `export function waitRows(site: ConstructionSite): WaitRow[]`: the wait queue in order, skipping null entries.
   - `export type WaitQueueMove = 'top' | 'up' | 'down' | 'bottom';`
   - `export function moveWaitQueueItem(queue: BuiltObject[], item: BuiltObject, move: WaitQueueMove): boolean`: the four Main.Part5.cs moves, in place on the live array (splice). Return whether the order changed; Top of the first item, or Bottom of the last, returns false.
   - DOM, like shipsAndBasesList:
     - `export interface ConstructionYardsOptions { empire: Empire; onSelect: (target: BuiltObject | Habitat) => void }`, `toggleConstructionYards(opts)`, `closeConstructionYards()`.
     - The window is titled `Construction Yards (N)`, with a two-pane body.
     - Left pane: the site table, with header cells Name | Type | Yards | Building | Waiting | Speed (numbers right-aligned). A row click selects the site (highlight). Default selection: the first row.
     - Right pane (the selected site):
       - the site name;
       - a **Go to** button: `close(); opts.onSelect(site.kind === 'colony' ? site.habitat : site.builtObject);`;
       - a yards table: Yard | Ship | Progress | Speed. `componentName` looks the id up in `componentDefinitionsStatic(galaxy)` by `componentId` (`''` if missing);
       - `Ships waiting to be constructed`: the wait rows. A click selects one row (highlight). Then four buttons (`Move to Top`, `Move Up`, `Move Down`, `Move to Bottom`) call `moveWaitQueueItem` on `siteQueue(site)!.constructionWaitQueue!` with the selected ship. Keep that ship selected, then re-render. The buttons are disabled with no wait-row selection.
       - Empty states: `No construction yards` (site without yards) and `No ships waiting`.
     - While open, re-render every 1000 ms (progress moves), keeping both selections (by object identity). Clear the interval in `close()`.
     - `galaxy` is `opts.empire.galaxy`.
     - With no sites, the body is `<div class="construction-yards-empty">No construction yards</div>`.
2. `src/ui/screens/buildOrder.ts`
   - Header comment: task 16c, read-only Build Order panel (F9). Cite Main.Part2.cs method_628 / method_629 / method_630 / method_633 / btnBuildOrderPurchase_Click. Add:
     - `// TODO(port): Purchase — Empire.6.cs:3017 BuildNewShips(designs, amounts) is not ported to src/sim/ (it draws Galaxy.Rnd via GenerateBuiltObjectName + AddBuiltObjectToGalaxy, picks yards with FindShortestConstructionWaitQueue, procures components and charges StateMoney). Port it into src/sim/construction/empireConstruction.ts, then add Order Amount inputs and enable the button (Main.Part2.cs:1135)`
     - `// TODO(port): Advisor Suggest column — RefactorForceStructureProjectionsToCosts(randomizedOrder: false) over the state + private force-structure projections (Main.Part2.cs:509-560)`
   - Imports: `import './buildOrder.css';`, `import type` for `Empire`, `Galaxy`, `Design`; `BuiltObjectSubRole`; `canBuildDesign`, `findNewestCanBuild`, `resolveSubRoleDescription` from `../../sim/designGeneration`; `designCalculateMaintenanceCosts` from `../../sim/construction/empireConstruction`; `formatMoney` from `../hud`.
   - `export const BUILD_ORDER_SUBROLES: readonly BuiltObjectSubRole[]`: the 16 sub-roles, in method_628 order.
   - `export function isPrivateBuildSubRole(subRole): boolean`: the six private sub-roles.
   - `export function shipsOfSubRoleCount(empire: Empire, subRole): number`: BaconMain.GetNumberOfShipsOfSubRole, i.e. `privateBuiltObjects` + `builtObjects` entries with that `subRole`.
   - `export function buildableDesignsBySubRole(empire: Empire, subRole): Design[]`: GetBuildableDesignsBySubRoles, i.e. `empire.designs` with that `subRole`, `!isObsolete` and `canBuildDesign(empire, d)`, in list order.
   - `export interface BuildOrderRow { subRole: BuiltObjectSubRole; type: string; current: number; design: Design | null; designText: string; unitCost: number; unitMaintenance: number }`
   - `export function buildOrderRow(empire: Empire, galaxy: Galaxy, subRole): BuildOrderRow`: method_629 + method_630.
     - With no buildable designs: `designText = '(No buildable designs)'` and `design = null`.
     - Else, when `empire.constructionYards.length === 0` and the sub-role is not ColonyShip / ConstructionShip / ResupplyShip: `designText = '(No construction yards for this ship type)'` and `design = null`.
     - Else `design = findNewestCanBuild(empire.designs, subRole, empire)` and `designText = design?.name ?? ''`.
     - `unitCost = design ? design.calculateCurrentPurchasePrice(galaxy) : 0`.
     - `unitMaintenance = design && !isPrivateBuildSubRole(subRole) ? designCalculateMaintenanceCosts(galaxy, design, empire) : 0`.
     - `type = resolveSubRoleDescription(subRole)`.
   - `export function buildOrderRows(empire: Empire, galaxy: Galaxy): BuildOrderRow[]`: one row per `BUILD_ORDER_SUBROLES` entry.
   - DOM:
     - `export interface BuildOrderOptions { empire: Empire }`, `toggleBuildOrder(opts)`, `closeBuildOrder()`.
     - The window is titled `Build Order`.
     - A line: `Available money: ${formatMoney(empire.stateMoney)}`.
     - A table with header cells Type | Current Amount | Design | Purchase Costs | Maint. Costs. A blank separator row goes before `SmallFreighter`: the original groups the private ships under their own spacer (Main.Part2.cs:741 `num5 += num2`).
     - A disabled `Purchase` button with `title="not yet available"`.
     - Re-render every 2000 ms while open (money and counts change); clear the interval in `close()`. `galaxy` is `opts.empire.galaxy`.
3. CSS:
   - `src/ui/screens/constructionYards.css`: copy `shipsAndBasesList.css`, with the prefix `construction-yards-` in place of `ships-list-`.
     - `.construction-yards-window` is `width: 900px`.
     - The body grid is `grid-template-columns: minmax(0, 1fr) 380px`, each pane with `overflow-y: auto; max-height: 70vh`.
     - Add `-row-selected`, `-number { text-align: right; }`, and a button style (1px border `rgba(255,255,255,0.2)`, 4px radius, padding `3px 10px`; `:disabled` at opacity 0.4).
   - `src/ui/screens/buildOrder.css`: the same base with the prefix `build-order-` and `width: 720px`.
4. `src/ui/hud.ts`: four blocks, all inside `[16c]` / `[/16c]` comments.
   - a. Import, right after `import { toggleMessageHistory } from './screens/messageHistory';`:
     ```ts
     import { toggleBuildOrder } from './screens/buildOrder'; import { toggleConstructionYards } from './screens/constructionYards'; // [16c]
     ```
   - b. Module-level hook, right **before** the comment line `/** Test hook: set the current selection directly (bypasses the panel's own`:
     ```ts
     // [16c] Ship/base/colony selection hook: buildSelectionPanel registers it; the
     // Construction Yards panel's Go to calls selectStellarObject (method_208 + method_157).
     let stellarObjectSelectHandler: ((target: BuiltObject | Habitat, moveView: boolean) => void) | null = null;
     export function selectStellarObject(target: BuiltObject | Habitat, moveView = true): void {
         stellarObjectSelectHandler?.(target, moveView);
     }
     // [/16c]

     ```
   - c. In `buildSelectionPanel`, right after the line `    panel.appendChild(footer);`:
     ```ts
         // [16c] Select a construction site: a colony selects itself; a ship/base selects its
         // nearest system with builtObject set (as the Bases cycler does). Optionally move the view.
         stellarObjectSelectHandler = (target, moveView) => {
             const galaxy = wiring.galaxy;
             if (!galaxy) return;
             if (target instanceof Habitat) {
                 const h = target;
                 const system = galaxy.systems.find((s) => s.habitats.includes(h)) ?? galaxy.systems[h.systemIndex];
                 if (!system) return;
                 wiring.onSelectionChange?.({ habitat: h, system });
             } else {
                 const system = nearestSystem(galaxy.systems, target.xpos, target.ypos);
                 if (!system) return;
                 wiring.onSelectionChange?.({ habitat: system.systemStar, system, builtObject: target });
             }
             const cam = wiring.camera;
             if (moveView && cam) {
                 cam.centerOn(target.xpos, target.ypos);
                 cam.zoomAt(SYSTEM_LEVEL_ZOOM, cam.width / 2, cam.height / 2);
             }
         };
         // [/16c]
     ```
   - d. Top bar. In `buildTopBarButton`'s click listener, right after the **final** `        } else {` line and before `            // [15c] tbtnShipGroups → Fleets list …`:
     ```ts
                 // [16c] btnBuildOrder → Build Order (Main.Part2.cs:1196 btnBuildOrder_Click);
                 // tbtnConstructionYards → Construction Yards (Main.Part6.cs:3243 tbtnConstructionYards_Click).
                 if (name === 'btnBuildOrder') {
                     const src = getEmpireSummarySource();
                     if (src) toggleBuildOrder({ empire: src.empire });
                     return;
                 }
                 if (name === 'tbtnConstructionYards') {
                     const src = getEmpireSummarySource();
                     if (src) toggleConstructionYards({ empire: src.empire, onSelect: (t) => selectStellarObject(t, true) });
                     return;
                 }
                 // [/16c]
     ```
     16b inserts its own block lower down in the same `else {` (after `// [/15c]`). Do not touch that area or `TopBarScreen` / `topBarScreen`.
5. `src/ui/keyboard.ts`: three blocks, nothing else.
   - Import, right after `import { toggleColoniesList } from './screens/coloniesList';`:
     ```ts
     import { toggleBuildOrder } from './screens/buildOrder'; import { toggleConstructionYards } from './screens/constructionYards'; import { selectStellarObject } from './hud'; // [16c]
     ```
     Keep it on one line.
   - `dispatchKey` switch: insert immediately **before** the switch's `default:`, i.e. right after the `        // [/15d]` line:
     ```ts
         // [16c] F9: Build Order, F10: Construction Yards (task 16c).
         case 'buildOrderScreen': {
             const src = getEmpireSummarySource();
             if (src) toggleBuildOrder({ empire: src.empire });
             break;
         }
         case 'constructionYardsScreen': {
             const src = getEmpireSummarySource();
             if (src) toggleConstructionYards({ empire: src.empire, onSelect: (t) => selectStellarObject(t, true) });
             break;
         }
         // [/16c]
     ```
   - `IMPLEMENTED_KEY_ACTIONS`: a new line right after `'fleetsScreen', // [15c]`:
     ```ts
         'buildOrderScreen', 'constructionYardsScreen', // [16c]
     ```
6. `src/main.ts`: two lines.
   - After `import { closeFleetsList } from './ui/screens/fleetsList'; // [15c]`, add `import { closeBuildOrder } from './ui/screens/buildOrder'; import { closeConstructionYards } from './ui/screens/constructionYards'; // [16c]`.
   - In `activeGameViewCleanup`, right after `closeFleetsList(); // [15c]`, add `closeBuildOrder(); closeConstructionYards(); // [16c]`.

## Tests (no jsdom)

Fakes are plain objects cast `as unknown as …`. Components are `{ componentId, name }`.

`test/constructionYards.test.ts`:
```ts
const escort = { name: 'Escort A', subRole: BuiltObjectSubRole.Escort, unbuiltOrDamagedComponentCount: 3, components: { count: 12 }, retrofitDesign: null, purchasePrice: 1200 };
const yard = { componentId: 5, shipUnderConstruction: escort, constructionSpeed: 40, retrofitComponentsToBeBuilt: null, retrofitComponentsToBeScrapped: null };
const idle = { componentId: 5, shipUnderConstruction: null, constructionSpeed: 40, retrofitComponentsToBeBuilt: null, retrofitComponentsToBeScrapped: null };
const w1 = { name: 'W1', subRole: BuiltObjectSubRole.Frigate, purchasePrice: 2500 }, w2 = { name: 'W2', … }, w3 = { name: 'W3', … };
const queue = { constructionYards: [yard, idle], constructionWaitQueue: [w1, w2, w3], constructionSpeed: 80 };
const port = { name: 'Sol Port', subRole: BuiltObjectSubRole.SmallSpacePort, isShipYard: true, constructionQueue: queue };
const freighter = { name: 'F', subRole: BuiltObjectSubRole.SmallFreighter, isShipYard: false, constructionQueue: null };
const colony = { name: 'Terra', constructionQueue: null };
const empire = { builtObjects: [freighter, port], privateBuiltObjects: [], colonies: [colony] };
```
- `constructionSites(empire)`: kinds `['builtObject', 'colony']`, with the port first. A yard base whose queue has 0 yards is dropped.
- `constructionSiteRows(empire)`:
  - the port row is `{ name: 'Sol Port', type: 'Small Space Port', yards: 2, building: 1, waiting: 3, speed: 80 }`;
  - the colony row is `{ type: 'Colony', yards: 0, building: 0, waiting: 0, speed: 0 }`.
- `yardProgress`:
  - `yard` → 0.75 and `formatProgressP` → '75.00%'; `idle` → 0.
  - Retrofit: design components `[1, 2, 3, 4]`, retrofit design `[1, 2, 5, 6, 7]`, to-be-built `[5]`, to-be-scrapped `[3, 4]`. Then `num1 = 3 + trunc(2 / 4) = 3` and the progress is `1 - (1 + 0) / 3` → '66.67%'.
  - `components.count = 0` → 0.
- `yardRows(site, (id) => id === 5 ? 'Construction Yard' : '')` → two rows. The first is `{ yard: 'Construction Yard', ship: 'Escort A', progressText: '75.00%', speed: 40 }`, the second has `ship: ''`.
- `waitRows` → names `['W1', 'W2', 'W3']`, the first `price` is '2,500'.
- `moveWaitQueueItem` on a copy `[w1, w2, w3]`:
  - `(w3, 'top')` → true, giving `[w3, w1, w2]`;
  - `(w3, 'top')` again → false;
  - `(w1, 'down')` on `[w1, w2, w3]` → `[w2, w1, w3]`;
  - `(w3, 'down')` → false;
  - `(w1, 'bottom')` → `[w2, w3, w1]`;
  - `(w2, 'up')` on `[w1, w2, w3]` → `[w2, w1, w3]`;
  - an item not in the list → false.
- `isKeyActionAvailable('constructionYardsScreen')` and `('buildOrderScreen')` → true.

`test/buildOrder.test.ts`. The fake empire is the same shape as 16b's (`research.checkComponentResearched: () => true`, `maximumConstructionSize: () => 1e9`, `maximumConstructionSizeBase: () => 1e9`, `canBuildCarriers: true`, `canBuildResupplyShips: true`, `galaxy: null`, `leader: null`, `governmentId: -1`, `pirateEmpireBaseHabitat: null`), plus `latestDesigns: []`, `constructionYards: [{}]`, `stateMoney: 5000`, `builtObjects`, `privateBuiltObjects`, `designs`. Designs are plain objects with `role`, `subRole`, `dateCreated >= 1`, `isObsolete: false`, `isPlanetDestroyer: false`, `optimizedDesign: 0`, `components: []`, `size: 100`, `maintenanceSavings: 0`, `empire`, `calculateCurrentPurchasePrice: () => 1000`.
- `BUILD_ORDER_SUBROLES` has 16 entries: the first is Escort, the last PassengerShip, and SmallFreighter is at index 10.
- `shipsOfSubRoleCount`: two state Escorts plus one private Escort → 3.
- `buildableDesignsBySubRole`: an obsolete Escort design is excluded.
- `buildOrderRow(empire, galaxy, Escort)` with one Escort design → `designText` is the design name, `unitCost` 1000, `unitMaintenance` 301.
  - With `constructionYards: []` → `designText` '(No construction yards for this ship type)', `unitCost` 0.
  - The same for ConstructionShip with a ConstructionShip design still gives the design (a colony-built type).
- A SmallFreighter design → `unitMaintenance` 0 (private).
- No design for a sub-role → '(No buildable designs)'.

Run `npm run typecheck && npm test`. keyboard.test.ts, hud.test.ts and hudTopBar.test.ts must pass unchanged. With `npm run dev` on a private port (other agents share 5173), save `node scripts/shot.mjs 'http://localhost:<port>/?autostart=1' shots/16c-construction-yards.png` (after F10) and `shots/16c-build-order.png` (after F9). Do not open the images. Then append `## Worker report` with: the files changed, the shot.mjs console output, and anything left undone.
