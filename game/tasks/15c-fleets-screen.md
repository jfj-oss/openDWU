# Task 15c — Fleets screen (F12 / top-bar fleets button) + fleet selection

thinking: off
scope: locked

Edit only these files:
- a new `src/ui/screens/fleetsList.ts` and a new `src/ui/screens/fleetsList.css`
- `src/ui/hud.ts`: only the `[15c]` blocks below:
  - one import block;
  - the `Selection` interface;
  - a selection hook next to `setCycleHandler(...)` in `buildSelectionPanel`;
  - the `fleets` branch of `stepCycle`;
  - the header branch of `refresh()`;
  - one branch in `buildSelectionRows`;
  - one block inside the final `else` of `buildTopBarButton`'s click listener.
- `src/ui/keyboard.ts`: only the three `[15c]` hook blocks below (one import line, one `dispatchKey` case, one `IMPLEMENTED_KEY_ACTIONS` line)
- `src/main.ts`: only the two `[15c]` lines below (one import, one close call)
- a new `test/fleetsList.test.ts`

Do NOT edit anything under `src/sim/`; only import from it. The fleet posture stays read-only: the sim has no posture setter (`ShipGroup.posture` is a plain field, and only the AI's `reviewFleetPostures` writes it). Three other agents (15a, 15b, 15d) are editing `keyboard.ts`, `hud.ts` and `main.ts` at the same time. Put each hook exactly at the anchor given, wrapped in `[15c]` / `[/15c]` marker comments. Do not reformat, reorder or "tidy" neighbouring lines, so the four branches merge cleanly. Start editing right away.

After this task:
- F12 and the top-bar fleets button (`tbtnShipGroups`, `fleetsButton.png`) open a streamlined Fleets list of the player's ShipGroups. The columns are Name, Ships, Power, Troops, Home base, Mission and System. Clicking a row closes the list, selects the fleet and zooms to its lead ship.
- A selected fleet shows its own header and rows in the bottom-left selection panel: Ships, Posture, Mission, Target, Power, Troops, Home base, Lead ship, Location. The map ring stays on the lead ship.
- The `F` / Shift+F / Ctrl+F cycle keys and the "Fleets" cycle chip now cycle the player's fleets instead of toasting "No Fleets yet".

House style: copy the structure of `src/ui/screens/shipsAndBasesList.ts` / `.css`:
- a module-level `open` state;
- `toggle…` / `close…` exports;
- a document `keydown` Escape handler with `stopImmediatePropagation`;
- pure row functions.

This is the streamlined version: no admiral portraits, detail tabs, or fleet orders.

## Existing code you use (read-only; verified at HEAD a399da7)

- `src/sim/fleets/shipGroup.ts`:
  - `class ShipGroup` fields:
    - `name: string | null`
    - `ships: BuiltObject[]`
    - `leadShip: BuiltObject | null`
    - `mission: BuiltObjectMission | null`
    - `posture: FleetPosture`
    - `postureRangeSquared: number`
    - `attackPoint` / `gatherPoint: StellarObject | null` (a `BuiltObject | Habitat | Creature`, all with `name`)
    - getters `empire: Empire | null` and `totalTroopAttackStrength: number`
  - `empireShipGroups(empire): (ShipGroup | null)[]` gives `Empire.shipGroups` typed.
  - Import only from this light module. Do **not** import `fleets/shipGroupTasks.ts` (its header warns about init order). Port the one-liner `TotalFirepower` instead.
- `src/sim/diplomacyTick.ts`: `enum FleetPosture { Attack, Defend }`.
- `BuiltObject` (src/sim/builtObject.ts): `name`, `xpos`, `ypos`, `firepowerRaw: number`, `nearestSystemStar: Habitat | null`.
- `src/sim/missions/mission.ts`: `BuiltObjectMissionType` (`Undefined` = 0), `BuiltObjectMission` with `type`.
- `src/ui/hud.ts` exports:
  - `missionTypeLabel(type)`: '(No mission)' for Undefined, e.g. 'Attack'.
  - `missionTargetText(mission, empire)`: '' when there is no target.
  - `nearestSystem(systems, x, y): SystemInfo | null`.
  - `nextInCycle(list, current, dir)`.
  - `SYSTEM_LEVEL_ZOOM`.
  - `getSelection()`.
  - `pushHudMessage(text)`.
  - `Selection { habitat; system; builtObject? }`.
  - Inside `buildSelectionPanel`:
    - `stepCycle(dir, kind, moveView)`. Its first lines are:
      ```ts
              if (kind === 'fleets' || kind === 'idleShips') {
                  // TODO(cycle): ShipGroup / BuiltObject.mission not ported (Main.Part7.cs 1863 btnCycleIdleShips_Click)
                  pushHudMessage(`No ${chipLabel()} yet`);
                  return;
              }
      ```
    - the `setCycleHandler((kind, dir, moveView) => { … });` block;
    - `refresh()`, whose header branch starts `if (sel.builtObject) {` (~line 797);
    - the 500 ms live timer `if (currentSelection?.builtObject) refresh();`. It already covers fleets, because a fleet selection carries `builtObject = leadShip`.
  - `buildSelectionRows(sel, gameData, player)` has the block that starts with the comment `// Task 13c: a selected ship/base shows only its own rows` (~line 1449).
  - `main.ts` `afterSelectionChange` already puts the map ring on `sel.builtObject`, so no main.ts selection change is needed.
- The top-bar control `tbtnShipGroups` falls into the final `else` of `buildTopBarButton`'s click listener (the "not yet available" toast):
  ```ts
          } else {
              console.log(`TODO(screen): ${label ?? name}`);
              showToast(`${label ?? name} — not yet available`);
          }
  ```
- `src/ui/screens/empireSummary.ts`: `getEmpireSummarySource(): { empire } | null` (already imported by hud.ts and keyboard.ts).

## C# source (verbatim, trimmed)

DistantWorlds.Controls/Controls/ShipGroupListView.cs:183-191, the Fleets list columns. The headers are "Power", "Troops", "Home colony", "Mission" and "Current system".
```cs
row.Cells[1].Value = (object)shipGroups[index1].Name;
row.Cells[2].Value = (object)shipGroups[index1].Ships.Count;
row.Cells[3].Value = (object)shipGroups[index1].TotalFirepower;
row.Cells[4].Value = (object)shipGroups[index1].TotalTroopAttackStrength;
row.Cells[5].Value = shipGroups[index1].GatherPoint == null ? (object)("(" + TextResolver.GetText("None") + ")") : (object)shipGroups[index1].GatherPoint.Name;
row.Cells[6].Value = (object)Galaxy.ResolveDescription(shipGroups[index1].Empire, shipGroups[index1].Mission);
row.Cells[7].Value = shipGroups[index1].LeadShip.NearestSystemStar == null ? (object)("(" + TextResolver.GetText("Deep Space") + ")") : (object)shipGroups[index1].LeadShip.NearestSystemStar.Name;
```
`ShipGroup.cs` TotalFirepower is the loop in shipGroupTasks.ts:2295, `total += ships[i].firepowerRaw`.

DistantWorlds.Types/Galaxy.2.cs:2100 `ResolveDescriptionFleetPosture(ShipGroup fleet)`:
```cs
string result = "(" + TextResolver.GetText("None") + ")";
if (fleet != null) switch (fleet.Posture) {
    case FleetPosture.Attack:
        result = fleet.AttackPoint == null ? GetText("Fleet Posture Attack Anywhere")
            : !(fleet.PostureRangeSquared <= 2250000.0) ? (!(fleet.PostureRangeSquared <= 2304000000.0) ? (!(fleet.PostureRangeSquared <= 250000000000.0)
                ? (!(fleet.PostureRangeSquared <= 1000000000000.0) ? Format(GetText("Fleet Posture Attack Unlimited"), AttackPoint.Name) : Format(GetText("Fleet Posture Attack Sector"), AttackPoint.Name))
                : Format(GetText("Fleet Posture Attack Area"), AttackPoint.Name)) : Format(GetText("Fleet Posture Attack System"), AttackPoint.Name))
            : Format(GetText("Fleet Posture Attack Target"), AttackPoint.Name);
        break;
    case FleetPosture.Defend:   // same ladder with GatherPoint and the "Fleet Posture Defend …" keys
}
```
GameText.txt:3454-3465:
- `Fleet Posture Attack Target` = "Attack {0} only"
- `…Attack System` = "Attack {0} and system"
- `…Attack Area` = "Attack {0} and nearby systems"
- `…Attack Sector` = "Attack {0} and sector"
- `…Attack Unlimited` = "Attack {0}, then any target"
- `…Attack Anywhere` = "Attack any targets"
- `Fleet Posture Defend Target` = "Defend {0} only"
- `…Defend System` = "Defend {0} and system"
- `…Defend Area` = "Defend {0} and nearby systems"
- `…Defend Sector` = "Defend {0} and sector"
- `…Defend Unlimited` = "Defend any target, based at {0}"
- `…Defend Anywhere` = "Defend any targets"

`None` → "None" and `Deep Space` → "Deep Space".

DistantWorlds/Main.Part8.cs:1243 `btnCycleShipGroups_Click`. The F key goes through Main.Part7.cs:2749 (CycleFleetForward), and Ctrl+F (…WithFocus) also calls `method_157` (move view):
```cs
int num = 0;
if (shipGroup_0 != null) { num = _Game.PlayerEmpire.ShipGroups.IndexOf(shipGroup_0); num++; if (num >= _Game.PlayerEmpire.ShipGroups.Count) num = 0; }
if (num >= 0 && _Game.PlayerEmpire.ShipGroups.Count > num) shipGroup_0 = _Game.PlayerEmpire.ShipGroups[num]; else shipGroup_0 = null;
if (shipGroup_0 != null) { method_208(shipGroup_0); /* select */ … }
```
DistantWorlds/Main.Part9.cs:3153 `tbtnShipGroups_Click` toggles `pnlShipGroupInfo`.

## Steps

1. `src/ui/screens/fleetsList.ts`
   - Header comment: task 15c, streamlined port of the Fleets panel. Cite Main.Part9.cs tbtnShipGroups_Click, ShipGroupListView.cs, Galaxy.2.cs ResolveDescriptionFleetPosture and Main.Part8.cs btnCycleShipGroups_Click. Add `// TODO(port): posture/orders editing, admiral portraits, fleet detail tabs — not in 15c (no sim setters)`.
   - Imports:
     - `import './fleetsList.css';`
     - `import type { ShipGroup } from '../../sim/fleets/shipGroup';` and `import { empireShipGroups } from '../../sim/fleets/shipGroup';`
     - `import { FleetPosture } from '../../sim/diplomacyTick';`
     - `import { BuiltObjectMissionType } from '../../sim/missions/mission';`
     - `import type { Empire } from '../../sim/empire';`
     - `import { missionTypeLabel, missionTargetText } from '../hud';`
   - `export function fleetPostureDescription(sg: ShipGroup | null): string`: Galaxy.2.cs:2100, with the GameText strings above. `{0}` is `point.name`.
   - `export function fleetTotalFirepower(sg: ShipGroup): number`: `ShipGroup.cs TotalFirepower`. Sum `firepowerRaw` over `sg.ships`, skipping null.
   - `export function fleetName(sg: ShipGroup): string`: `sg.name`, or `'(Unnamed fleet)'` when null or ''.
   - `export function fleetSystemName(sg: ShipGroup): string`: `sg.leadShip?.nearestSystemStar?.name` or `'(Deep Space)'`. The C# would crash on a null lead ship; add a comment saying so.
   - `export function fleetMissionText(sg: ShipGroup): string`: `sg.mission === null || sg.mission.type === BuiltObjectMissionType.Undefined ? '(No mission)' : missionTypeLabel(sg.mission.type)`. Add `// TODO(port): full Galaxy.3.cs:20 ResolveDescription(empire, mission)`.
   - `export function fleetCycleList(empire: Empire): ShipGroup[]`: `empireShipGroups(empire)`, with null entries removed and in list order.
   - `export interface FleetRow { shipGroup: ShipGroup; name: string; ships: number; power: number; troops: number; homeBase: string; mission: string; system: string }`.
   - `export function fleetRows(empire: Empire): FleetRow[]`:
     - `homeBase` is `sg.gatherPoint?.name ?? '(None)'`.
     - `troops` is `Math.round(sg.totalTroopAttackStrength)`.
   - `export function shipGroupSelectionRows(sg: ShipGroup, player: Empire | null): { label: string; value: string }[]`, in this order:
     - `Ships`: `String(ships.length)`.
     - `Posture`: `fleetPostureDescription(sg)`.
     - `Mission`: `fleetMissionText(sg)`.
     - `Target`: `missionTargetText(sg.mission, player)`. Only when `sg.mission !== null` and the text is non-empty.
     - `Power`: `String(fleetTotalFirepower(sg))`.
     - `Troops`: shown only when > 0.
     - `Home base`: `homeBase`.
     - `Lead ship`: `leadShip.name`, or '—'.
     - `Location`: `fleetSystemName(sg)`.
   - `export interface FleetsListOptions { empire: Empire; onSelect: (sg: ShipGroup) => void }`, `toggleFleetsList(opts)`, `closeFleetsList()`: exactly like shipsAndBasesList.
   - `createFleetsList`: the same DOM as `createShipsAndBasesList`, with these changes:
     - use the prefix `fleets-list-`;
     - heading `Fleets (${rows.length})`;
     - header cells Name | Ships | Power | Troops | Home base | Mission | System;
     - numbers right-aligned;
     - a row click runs `close(); opts.onSelect(row.shipGroup);`;
     - the empty state is `<div class="fleets-list-empty">No fleets</div>`.
2. `src/ui/screens/fleetsList.css`: copy `shipsAndBasesList.css` with every `ships-list-` renamed to `fleets-list-`.
   - `.fleets-list-window` width is `760px`.
   - Both grids use `minmax(0, 1fr) 3.5em 4.5em 4em 8em 7em 7em`.
   - Add `.fleets-list-number { text-align: right; }`.
3. `src/ui/hud.ts` hook blocks (all inside `[15c]` / `[/15c]` comments):
   - a. Import. Put it right after `import { BuiltObjectMissionType, builtObjectMission, type BuiltObjectMission } from '../sim/missions/mission';`:
     ```ts
     // [15c]
     import type { ShipGroup } from '../sim/fleets/shipGroup';
     import { fleetCycleList, fleetName, fleetSystemName, shipGroupSelectionRows, toggleFleetsList } from './screens/fleetsList';
     // [/15c]
     ```
   - b. `Selection`: add, after `builtObject?: BuiltObject;`:
     ```ts
         /** [15c] The selected fleet; `builtObject` is then its lead ship and `habitat` the nearest star. */
         shipGroup?: ShipGroup;
     ```
   - c. Module-level fleet-select hook. Put it right after the `setSelection` test hook function (~line 197):
     ```ts
     // [15c] Fleet selection hook: buildSelectionPanel registers it; the Fleets list,
     // F12 and the fleet cycler call selectShipGroup (Main.Part8.cs method_208 for a ShipGroup).
     let shipGroupSelectHandler: ((sg: ShipGroup, moveView: boolean) => void) | null = null;
     export function selectShipGroup(sg: ShipGroup, moveView = true): void {
         shipGroupSelectHandler?.(sg, moveView);
     }
     // [/15c]
     ```
   - d. In `buildSelectionPanel`, right **after** the `setCycleHandler((kind, dir, moveView) => { … });` block, register the handler:
     ```ts
         // [15c] Select a fleet: the lead ship's nearest system, builtObject = lead ship
         // (so the map ring and live refresh follow it), and optionally move the view.
         shipGroupSelectHandler = (sg, moveView) => {
             const lead = sg.leadShip;
             const galaxy = wiring.galaxy;
             if (!lead || !galaxy) return;
             const system = nearestSystem(galaxy.systems, lead.xpos, lead.ypos);
             if (!system) return;
             wiring.onSelectionChange?.({ habitat: system.systemStar, system, builtObject: lead, shipGroup: sg });
             const cam = wiring.camera;
             if (moveView && cam) {
                 cam.centerOn(lead.xpos, lead.ypos);
                 cam.zoomAt(SYSTEM_LEVEL_ZOOM, cam.width / 2, cam.height / 2);
             }
         };
         // [/15c]
     ```
   - e. In `stepCycle`, replace the combined `if (kind === 'fleets' || kind === 'idleShips') { … }` block with two blocks. The idle-ships block stays byte-for-byte as it was, apart from its condition:
     ```ts
             // [15c] Port of Main.Part8.cs:1243 btnCycleShipGroups_Click (F / Shift+F / Ctrl+F).
             if (kind === 'fleets') {
                 const game = wiring.game;
                 if (!game) return;
                 const list = fleetCycleList(game.playerEmpire as Empire);
                 if (list.length === 0) {
                     pushHudMessage('No Fleets yet');
                     return;
                 }
                 const next = nextInCycle(list, currentSelection?.shipGroup ?? null, dir);
                 if (next) shipGroupSelectHandler?.(next, moveView);
                 return;
             }
             // [/15c]
             if (kind === 'idleShips') {
                 // TODO(cycle): ShipGroup / BuiltObject.mission not ported (Main.Part7.cs 1863 btnCycleIdleShips_Click)
                 pushHudMessage(`No ${chipLabel()} yet`);
                 return;
             }
     ```
   - f. In `refresh()`, before `if (sel.builtObject) {`, insert a fleet header branch and turn the existing `if` into `} else if (sel.builtObject) {`:
     ```ts
             // [15c] fleet header: name + ship count and system.
             if (sel.shipGroup) {
                 nameEl.textContent = fleetName(sel.shipGroup);
                 nameEl.classList.remove('hud-muted');
                 subEl.textContent = `Fleet · ${sel.shipGroup.ships.length} ships · ${fleetSystemName(sel.shipGroup)}`;
             } else // [/15c]
             if (sel.builtObject) {
     ```
     This keeps the original `if (sel.builtObject) {` line untouched.
   - g. In `buildSelectionRows`, directly before the comment `// Task 13c: a selected ship/base shows only its own rows`:
     ```ts
         // [15c] A selected fleet shows its own rows instead of the lead ship's.
         if (sel.shipGroup) {
             for (const r of shipGroupSelectionRows(sel.shipGroup, player)) addColorRow(r);
             return rows;
         }
         // [/15c]
     ```
   - h. Top bar. Inside the **final `else {`** of `buildTopBarButton`'s click listener, insert as the first statements, before `console.log(\`TODO(screen): ${label ?? name}\`);`:
     ```ts
                 // [15c] tbtnShipGroups → Fleets list (Main.Part9.cs:3153 tbtnShipGroups_Click).
                 if (name === 'tbtnShipGroups') {
                     const src = getEmpireSummarySource();
                     if (src) toggleFleetsList({ empire: src.empire, onSelect: (sg) => selectShipGroup(sg, true) });
                     return;
                 }
                 // [/15c]
     ```
     Do not touch `TopBarScreen` / `topBarScreen`. 15b inserts its own block at the top of the same listener.
4. `src/ui/keyboard.ts`: three blocks, nothing else.
   - Import, right after `import { toggleColoniesList } from './screens/coloniesList';`:
     ```ts
     import { toggleFleetsList } from './screens/fleetsList'; import { selectShipGroup } from './hud'; // [15c]
     ```
     Keep it on one line so the anchor stays a single inserted line. keyboard.ts already imports from `./hud`; a second import statement from the same module is legal.
   - `dispatchKey` switch: insert immediately **before** `case 'gameMenu':`, i.e. after the `shipsAndBasesScreen` case's `break;`:
     ```ts
         // [15c] F12: Fleets list (task 15c); a row selects + zooms to the fleet.
         case 'fleetsScreen': {
             const src = getEmpireSummarySource();
             if (src) toggleFleetsList({ empire: src.empire, onSelect: (sg) => selectShipGroup(sg, true) });
             break;
         }
         // [/15c]
     ```
   - `IMPLEMENTED_KEY_ACTIONS`: add a new line right after `'galaxyMap', 'messageHistoryScreen', 'empireSummaryScreen', 'coloniesScreen', 'shipsAndBasesScreen',`:
     ```ts
         'fleetsScreen', // [15c]
     ```
     Do **not** add the `cycleFleets*` actions. keyboard.test.ts asserts that `cycleFleets` is unavailable, and the other working cyclers (13c) are not listed either.
5. `src/main.ts`: two lines.
   - After `import { closeMessageHistory } from './ui/screens/messageHistory';`, add `import { closeFleetsList } from './ui/screens/fleetsList'; // [15c]`.
   - In `activeGameViewCleanup`, right after `closeMessageHistory();`, add `closeFleetsList(); // [15c]`.

## Tests (`test/fleetsList.test.ts`, no jsdom)

Fakes are cast `as unknown as ShipGroup` / `Empire`.

```ts
const sol = { name: 'Sol' };
const lead = { name: 'Lead', firepowerRaw: 30, nearestSystemStar: sol, xpos: 0, ypos: 0 };
const sg = { name: 'First Fleet', ships: [lead, { name: 'B', firepowerRaw: 12, nearestSystemStar: sol }], leadShip: lead,
             mission: null, posture: FleetPosture.Attack, postureRangeSquared: Number.MAX_VALUE,
             attackPoint: null, gatherPoint: { name: 'Terra' }, totalTroopAttackStrength: 0 };
const empire = { shipGroups: [sg, null] };
```
- `fleetPostureDescription`:
  - `null` → '(None)'.
  - Attack with `attackPoint: null` → 'Attack any targets'.
  - Attack with `attackPoint: { name: 'Vega' }` at these ranges:
    - 2250000 → 'Attack Vega only';
    - 2304000000 → 'Attack Vega and system';
    - 250000000000 → 'Attack Vega and nearby systems';
    - 1e12 → 'Attack Vega and sector';
    - `Number.MAX_VALUE` → 'Attack Vega, then any target'.
  - Defend with `gatherPoint: { name: 'Terra' }` at 2250000 → 'Defend Terra only'.
  - Defend with `gatherPoint: null` → 'Defend any targets'.
  - Defend at MAX → 'Defend any target, based at Terra'.
- `fleetTotalFirepower(sg)` → 42.
- `fleetName`: 'First Fleet'; with `name: null` → '(Unnamed fleet)'.
- `fleetSystemName`: 'Sol'. With a lead ship whose `nearestSystemStar` is null → '(Deep Space)'. With `leadShip: null` → '(Deep Space)'.
- `fleetMissionText`: null → '(No mission)'. `{ type: BuiltObjectMissionType.Attack }` → 'Attack'.
- `fleetCycleList(empire)` → `[sg]`.
- `fleetRows(empire)`: one row `{ name: 'First Fleet', ships: 2, power: 42, troops: 0, homeBase: 'Terra', mission: '(No mission)', system: 'Sol' }`. With `gatherPoint: null` → homeBase '(None)'.
- `shipGroupSelectionRows(sg, null)`: labels `['Ships', 'Posture', 'Mission', 'Power', 'Home base', 'Lead ship', 'Location']`. With `totalTroopAttackStrength: 50`, a 'Troops' row with value '50' appears after 'Power'.
- `isKeyActionAvailable('fleetsScreen')` → true, and `isKeyActionAvailable('cycleFleets')` stays false.

Run `npm run typecheck && npm test`. hud.test.ts, hud-cycle-builtobjects.test.ts (`builtObjectCycleList(empire, 'fleets')` is still `[]`, which you do not change), hud-builtobject-status.test.ts, keyboard.test.ts and hudTopBar.test.ts must pass unchanged.

With `npm run dev` on a private port (other agents share 5173), save `node scripts/shot.mjs 'http://localhost:<port>/?autostart=1' shots/15c-fleets.png`. Do not open it. Then append `## Worker report`: files changed, the shot.mjs console output, and anything left undone.

## Worker report

Files changed: new `src/ui/screens/fleetsList.ts`, `src/ui/screens/fleetsList.css`, `test/fleetsList.test.ts`; `[15c]` hook blocks in `src/ui/hud.ts`, `src/ui/keyboard.ts`, `src/main.ts`.

Visual check (dev server on :5391, `?autostart=1`, unpaused at 4x, driver `shots/fleets.mjs`): no console errors or warnings. No empire (player or AI) had any ShipGroup after ~2 game months, so for the screenshots two fleets were injected in-page from the player's warships with the sim's own `ShipGroup` class (not committed). Shots: `shots/15c-fleets.png` (F12 list, 2 rows), `shots/15c-fleet-selected.png` (row click → First Fleet selected, zoomed to system), `shots/15c-fleet-cycle.png` (F key → Second Fleet, Fleets chip active).

Left undone: `npm run typecheck` reports two pre-existing errors in `src/sim/galaxy.ts` (duplicate `shakturiDefeated`, present at HEAD; sim is off-limits for this task). Posture/orders editing, admiral portraits and detail tabs are out of scope (TODO(port) in fleetsList.ts).
