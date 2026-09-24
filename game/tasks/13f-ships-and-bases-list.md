# Task 13f — "Ships and Bases" list panel (F11 / top-bar button)

thinking: off
scope: locked

Edit only these files:
- a new `src/ui/screens/shipsAndBasesList.ts` and a new `src/ui/screens/shipsAndBasesList.css`
- `src/ui/hud.ts`: only `TopBarScreen` / `topBarScreen` (~line 451) and the click handler in `buildTopBarButton` (~line 493), plus one import.
- `src/ui/keyboard.ts`: only the `KeyHandlers` interface, the `dispatchKey` switch, `buildDefaultHandlers`, and `IMPLEMENTED_KEY_ACTIONS`, plus one import.
- `src/main.ts`: one import and one line in `activeGameViewCleanup` (~line 448).
- a new `test/shipsAndBasesList.test.ts`

Do NOT edit anything under `src/sim/` (another lane owns it), and do not edit `src/render/`.

**Dependency:** 13d also edits `src/main.ts`, in a different place (`startGameView` near `view.onSelectionChange`). Run this task after 13d, and keep your main.ts edit to the two lines below. Start editing right away.

House style: copy the structure of `src/ui/screens/coloniesList.ts` / `coloniesList.css` (task 12m/13b): a module-level `open` state, `toggle…` / `close…` exports, a document `keydown` Escape handler with `stopImmediatePropagation`, a pure row function, and click-a-row → close + zoom. This is a streamlined panel, not the original's 1024×756 window: there is no filter combo, detail tabs or mini galaxy map.

## Existing code you use (read-only; verified to exist)

- `Empire.builtObjects: BuiltObject[]` (state-owned) and `Empire.privateBuiltObjects: BuiltObject[]` (src/sim/empire.ts).
- `BuiltObject` (src/sim/builtObject.ts) has `name`, `xpos`, `ypos`, `role: BuiltObjectRole`, `subRole: BuiltObjectSubRole`, `nearestSystemStar: Habitat | null`, and `parentHabitat: Habitat | null`. Habitats have `name`. Type-import `BuiltObject` from `../../sim/builtObject`.
- `BuiltObjectRole { Undefined, Military, Exploration, Freight, Passenger, Colony, Build, Resource, Base }` comes from `../../sim/data/designSpecifications`.
- From src/ui/hud.ts (13c):
  - `subRoleLabel(subRole)`: '' for Undefined, else the split name, e.g. 'Small Space Port'.
  - `getSelection(): Selection | null`, where `Selection` has `habitat` and `builtObject?`.
  - `SYSTEM_LEVEL_ZOOM`.
- From src/ui/screens/empireSummary.ts: `getEmpireSummarySource(): { empire: Empire } | null`. hud.ts and keyboard.ts already import it and use it for the Colonies list.
- The top-bar control for this screen is named `'tbtnBuiltObjects'` (hudLayout.ts TOP_BAR_BUTTONS; chrome art `shipsAndBasesButton.png`). Today it falls into the "not yet available" toast branch.
- keyboard.ts already binds `{ key: 'F11', action: 'shipsAndBasesScreen' }`. `dispatchKey` has no case for it yet, so it falls to `default`.

## C# source (verbatim, trimmed)

Main.Part9.cs:3105 `tbtnBuiltObjects_Click` toggles `pnlBuiltObjectInfo` (method_177 / method_185). The list comes from BaconMain.cs:1738 `method_423`. The default filter "(Show all ships and bases)" is:
```cs
main.pnlBuiltObjectInfo.HeaderTitle = TextResolver.GetText("Ships and Bases");
default:
    builtObjectList.AddRange(playerEmpire.BuiltObjects);
    builtObjectList.AddRange(playerEmpire.PrivateBuiltObjects);
...
return OrderByDistance(main, stellarObjectList);
// OrderByDistance (BaconMain.cs:2044): if _Game.SelectedObject is a StellarObject, the list is
// source.OrderBy(x => CalculateDistanceSquaredStatic(selected.Xpos, selected.Ypos, x.Xpos, x.Ypos)) (stable); else unchanged.
```
The row columns come from BuiltObjectListView.cs:545-561:
```cs
string value2 = Galaxy.ResolveDescription(builtObject.Role) + ", " + Galaxy.ResolveDescription(builtObject.SubRole);   // "Role"
string value4 = string.Empty;
if (builtObject.NearestSystemStar != null) value4 = builtObject.NearestSystemStar.Name;
if (string.IsNullOrEmpty(value4)) value4 = "(" + TextResolver.GetText("Deep Space") + ")";                      // "System"
```
Galaxy.2.cs:2083 `ResolveDescription(BuiltObjectRole)` uses GameText.txt: "Ship Role Base" → `Base`, Build → `Build`, Colony → `Colony`, Exploration → `Exploration`, Freight → `Freight`, Military → `Military`, Passenger → `Passenger`, Resource → `Resource`, Undefined → "None" → `None`. "Deep Space" → `Deep Space`.

## Steps

1. `src/ui/screens/shipsAndBasesList.ts`:
   - Header comment: task 13f, the streamlined port of the original's Ships and Bases panel (Main.Part9.cs tbtnBuiltObjects_Click, BaconMain.cs method_423, BuiltObjectListView.cs).
   - `import './shipsAndBasesList.css';`
   - `export function builtObjectRoleLabel(role: BuiltObjectRole): string`: `'None'` for Undefined, otherwise `BuiltObjectRole[role]`.
   - `export interface ShipsAndBasesRow { builtObject: BuiltObject; name: string; role: string; system: string; location: string }`.
   - `export function shipsAndBasesRows(empire: { builtObjects: BuiltObject[]; privateBuiltObjects: BuiltObject[] }, selected: { xpos: number; ypos: number } | null): ShipsAndBasesRow[]`:
     - `list = [...empire.builtObjects, ...empire.privateBuiltObjects].filter((b) => b !== null)`.
     - If `selected` is non-null, stable-sort by squared distance to it. `Array.prototype.sort` is stable.
     - Map each object:
       - `name`: `bo.name`.
       - `role`: `sub = subRoleLabel(bo.subRole)`, then `sub ? `${builtObjectRoleLabel(bo.role)}, ${sub}` : builtObjectRoleLabel(bo.role)`.
       - `system`: `bo.nearestSystemStar?.name || '(Deep Space)'`.
       - `location`: `bo.parentHabitat?.name ?? ''`.
   - `export interface ShipsAndBasesListOptions { empire: { builtObjects: BuiltObject[]; privateBuiltObjects: BuiltObject[] }; selected: { xpos: number; ypos: number } | null; onZoomTo: (bo: BuiltObject) => void }`.
   - `toggleShipsAndBasesList(opts)` and `closeShipsAndBasesList()`, exactly like `toggleColoniesList` / `closeColoniesList`.
   - `createShipsAndBasesList(opts)`: the same DOM as `createColoniesList`, with these differences:
     - All classes use the prefix `ships-list-` instead of `colonies-list-`.
     - The heading is `Ships and Bases (${rows.length})`.
     - The header cells are Name | Role | System | Location.
     - Each row has four spans: name (`ships-list-name`) and three `ships-list-cell` spans. Set `title` on the role cell to its text, since it may be ellipsized.
     - A row click runs `close(); opts.onZoomTo(row.builtObject);`.
     - When there are no rows, the body holds one `<div class="ships-list-empty">No ships or bases</div>`.
     - Escape and the close button behave the same as in coloniesList.
2. `src/ui/screens/shipsAndBasesList.css`: copy `coloniesList.css`, renaming every `colonies-list-` to `ships-list-`. Then:
   - `.ships-list-window` width is `620px`.
   - Both `grid-template-columns` (header and row) are `minmax(0, 1fr) 14em 7em 7em`.
   - Drop the approval / population / number / capital-tag rules.
   - Add `.ships-list-cell { font-size: 12px; color: #bbb; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }` and `.ships-list-empty { padding: 8px; font-size: 12px; color: #777; }`.
3. `src/ui/hud.ts`:
   - `import { toggleShipsAndBasesList } from './screens/shipsAndBasesList';`
   - `export type TopBarScreen = 'colonies' | 'empireSummary' | 'messageHistory' | 'shipsAndBases';`. In `topBarScreen`, add `case 'tbtnBuiltObjects': return 'shipsAndBases';`.
   - In `buildTopBarButton`'s click handler, add a branch before the final `else`:
     ```ts
     } else if (screen === 'shipsAndBases') {
         // Main.Part9.cs tbtnBuiltObjects_Click: toggle the Ships and Bases list.
         const src = getEmpireSummarySource();
         if (!src) return;
         const sel = getSelection();
         toggleShipsAndBasesList({
             empire: src.empire,
             selected: sel ? (sel.builtObject ?? sel.habitat) : null,
             onZoomTo: (bo) => {
                 const cam = wiring.camera;
                 if (!cam) return;
                 cam.centerOn(bo.xpos, bo.ypos);
                 cam.zoomAt(SYSTEM_LEVEL_ZOOM, cam.width / 2, cam.height / 2);
             },
         });
     ```
4. `src/ui/keyboard.ts`:
   - `import { toggleShipsAndBasesList } from './screens/shipsAndBasesList';`
   - `KeyHandlers`: add `shipsAndBasesScreen?: () => void;` after `coloniesScreen`.
   - `dispatchKey` switch: add `case 'shipsAndBasesScreen': handlers.shipsAndBasesScreen?.(); break;` after the `coloniesScreen` case.
   - `buildDefaultHandlers`: after `coloniesScreen`, add `shipsAndBasesScreen`, which is the same as the coloniesScreen handler but calls `toggleShipsAndBasesList({ empire: src.empire, selected: <as in step 3>, onZoomTo: (bo) => { camera.centerOn(bo.xpos, bo.ypos); camera.zoomAt(SYSTEM_LEVEL_ZOOM, cx(), cy()); } })`. keyboard.ts already imports `getSelection`.
   - `IMPLEMENTED_KEY_ACTIONS`: add `'shipsAndBasesScreen'` after `'coloniesScreen'`.
5. `src/main.ts`:
   - Add `import { closeShipsAndBasesList } from './ui/screens/shipsAndBasesList';` after the `closeColoniesList` import (line 25).
   - In `activeGameViewCleanup`, add `closeShipsAndBasesList();` right after `closeColoniesList();`.
   - Nothing else changes.

## Tests (`test/shipsAndBasesList.test.ts`, no jsdom; fakes cast `as unknown as BuiltObject`)

Importing the module pulls in its `.css`, as coloniesList.test.ts already does. vitest handles that.

- `builtObjectRoleLabel`: Undefined → 'None', Base → 'Base', Military → 'Military', Resource → 'Resource'.
- `shipsAndBasesRows`. State list:
  - `port = {name: 'Port A', role: Base, subRole: SmallSpacePort, nearestSystemStar: {name: 'Sol'}, parentHabitat: {name: 'Terra'}, xpos: 0, ypos: 0}`
  - `frigate = {name: 'F1', role: Military, subRole: Frigate, nearestSystemStar: null, parentHabitat: null, xpos: 500, ypos: 0}`

  Private list:
  - `miner = {name: 'M1', role: Resource, subRole: MiningStation, nearestSystemStar: {name: 'Vega'}, parentHabitat: {name: 'Vega II'}, xpos: 100, ypos: 0}`

  Expect:
  - With `selected = null`: the order is `[port, frigate, miner]`.
    - port: role 'Base, Small Space Port', system 'Sol', location 'Terra'.
    - frigate: role 'Military, Frigate', system '(Deep Space)', location ''.
    - miner: role 'Resource, Mining Station'.
  - With `{xpos: 480, ypos: 0}`: `[frigate, miner, port]`.
  - With `{xpos: 50, ypos: 0}`: port and miner are both 50 away, so the order is `[port, miner, frigate]` (stable).
  - An object with role Undefined and subRole Undefined → role 'None'.
  - An empty empire → `[]`.
- `topBarScreen('tbtnBuiltObjects')` → `'shipsAndBases'`.
- `isKeyActionAvailable('shipsAndBasesScreen')` → true.

Run `npm run typecheck && npm test` (keyboard.test.ts, hudTopBar.test.ts and hud.test.ts must still pass). With `npm run dev` running, save `node scripts/shot.mjs 'http://localhost:5173/?autostart=1' shots/13f-ships.png`. Do not open it. Then append `## Worker report`: files changed, the shot.mjs console output, and anything left undone.

## Worker report

**Files changed:**
- NEW `src/ui/screens/shipsAndBasesList.ts` — panel module: `builtObjectRoleLabel` (port of Galaxy.2.cs `ResolveDescription(BuiltObjectRole)`, Undefined → "None"), pure `shipsAndBasesRows(empire, selected)` (list = `empire.builtObjects` + `empire.privateBuiltObjects`, stable sort by squared distance to the selection per BaconMain.cs `method_423`; columns Name | Role (`role, subRole`) | System (`nearestSystemStar.name` or "(Deep Space)") | Location (`parentHabitat.name`)), and `toggleShipsAndBasesList` / `closeShipsAndBasesList` / `createShipsAndBasesList` DOM panel (structure mirrors coloniesList: fixed wrap z-index 1500, titlebar with close button, Escape handler with `stopImmediatePropagation`, row click → close + `onZoomTo`).
- NEW `src/ui/screens/shipsAndBasesList.css` — dark-panel styling copied from coloniesList.css, renamed `colonies-list-*` → `ships-list-*`, window width 620px, grid `minmax(0,1fr) 14em 7em 7em`.
- `src/ui/hud.ts` — one import; `TopBarScreen` gains `'shipsAndBases'` and `topBarScreen` maps `tbtnBuiltObjects` → it; `buildTopBarButton` click handler opens the list via `getEmpireSummarySource()` + `getSelection()`, zooming to the clicked ship/base at `SYSTEM_LEVEL_ZOOM`.
- `src/ui/keyboard.ts` — one import; `KeyHandlers.shipsAndBasesScreen?`, `dispatchKey` case, `buildDefaultHandlers` entry (F11), and `IMPLEMENTED_KEY_ACTIONS` entry.
- `src/main.ts` — exactly two lines: the `closeShipsAndBasesList` import and its call in `activeGameViewCleanup`.
- NEW `test/shipsAndBasesList.test.ts` — pure-logic tests as specified (role labels, row composition/order incl. stable tie-break, ghost → "None", empty empire, `topBarScreen('tbtnBuiltObjects')`, `isKeyActionAvailable('shipsAndBasesScreen')`).

**Verification:**
- `npm run typecheck` — passes (no output).
- `npm test` — 88 files / 880 tests passed, including keyboard.test.ts, hudTopBar.test.ts and hud.test.ts.
- `node scripts/shot.mjs 'http://localhost:5173/?autostart=1' shots/13f-ships.png` — saved `shots/13f-ships.png`; console output was only `[debug] [vite] connecting...` / `[debug] [vite] connected.` / `saved shots/13f-ships.png` (no errors). Screenshot not opened (text-only worker); path listed for orchestrator review.

**Left undone:** nothing within scope. The panel is streamlined per the task (no filter combo, detail tabs, or mini galaxy map) — those remain out of scope for 13f.
