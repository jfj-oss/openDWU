# Task 14b — Selection panel shows a ship/base's mission and status

thinking: off
scope: locked

Edit only these files:
- `src/ui/hud.ts`: one import block, a new exported `builtObjectStatusRows` (+ two small helpers) placed right after `builtObjectRows` (~line 1021), the `sel.builtObject` branch of `buildSelectionRows` (~line 1307), `buildSelectionRows`'s signature and its one call site in `buildSelectionPanel` (~line 807), and a live-refresh timer in `buildSelectionPanel` right after the `wiring.onSelectionChange = …` block (~line 816).
- a new `test/hud-builtobject-status.test.ts`

Do NOT edit anything under `src/sim/` (six other agents are editing it). Do NOT edit `src/main.ts` (task 14a) or `src/render/` (task 14c). `builtObjectRows` itself must not change: `test/hud-cycle-builtobjects.test.ts` checks its exact rows. Start editing right away.

After this task, a selected ship/base shows its 13c rows (Owner / Design / Size / Location / Troops) followed by Mission, Target, Components, Damage, Fuel, Speed and Cargo rows. The rows refresh twice a second while a ship/base is selected, so a moving ship's speed and fuel stay current.

## Existing code you use (read-only; verified at HEAD)

- `BuiltObject` (src/sim/builtObject.ts) plain fields: `role: BuiltObjectRole`, `currentSpeed` (float), `topSpeed`, `warpSpeed`, `hyperjumpDisabledLocation: boolean`, `currentFuel`, `fuelCapacity`, `attackRangeSquared`, `unbuiltComponentCount`, `damagedComponentCount`, `disabledComponentIndexes: number[] | null`, `retrofitDesign: Design | null` (`Design` has `name`), `components: BuiltObjectComponentList` (has `count`), `cargo: CargoList | null` (`items: { amount: number }[]`), `mission: unknown`, `subsequentMissions: unknown[]`. Getters: `cargoCapacity: number` and `actualEmpire: Empire | null`. There is **no** `movementSlowedLocation` field, so the C# "(slowed)" suffix is a TODO.
- `src/sim/missions/mission.ts`:
  - `export enum BuiltObjectMissionType { Undefined, Explore, Build, BuildRepair, Transport, Patrol, Escort, Rescue, Blockade, Attack, Escape, Retire, Retrofit, Colonize, Waypoint, Hold, WaitAndAttack, WaitAndBombard, MoveAndWait, Refuel, ExtractResources, LoadTroops, UnloadTroops, Deploy, Undeploy, Repair, Move, Bombard, Capture, Reinforce, Raid }`.
  - `export class BuiltObjectMission` with `type: BuiltObjectMissionType` and getters `targetSector: Sector | null` (`Sector` has `x`, `y`), `targetShipGroup: ShipGroup | null`, `targetBuiltObject: BuiltObject | null`, `targetHabitat: Habitat | null`, and `targetCreature: Creature | null` (`Creature` has `name`). `ShipGroup` has **no name** at HEAD.
  - `export function builtObjectMission(mission: unknown): BuiltObjectMission | null` gives the typed `bo.mission`.
- `Habitat` has `name`, `systemIndex`, and `category: HabitatCategoryType { Star, Planet, Moon, Asteroid, GasCloud }` (src/sim/types.ts; hud.ts already imports `HabitatCategoryType`).
- `Empire.visibility` (src/sim/visibility.ts `EmpireVisibility`) has `systemVisibility: SystemVisibility[]` and `checkSystemVisibilityStatus(systemIndex): SystemVisibilityStatus`, which has no bounds check. `SystemVisibilityStatus { Undefined, Unexplored, Explored, … }` is exported from `src/sim/visibility.ts`.
- hud.ts already has: `import type { Empire }`, `import type { BuiltObject }`, `import { BuiltObjectRole } from '../sim/data/designSpecifications'`, `builtObjectRows(bo)`, and the `addColorRow` closure inside `buildSelectionRows`. `HudWiring.galaxy?: Galaxy` has `playerEmpire: Empire | null`. The panel's `refresh()` closure and the module-level `currentSelection` sit in `buildSelectionPanel`.

## C# source (verbatim, trimmed)

BaconDistantWorlds/BaconInfoPanel.cs is the original selection panel for a BuiltObject. `_ActualEmpire` is the ship's actual empire. `flag1`/`flag2` (the ship is relevant to the player) and GodMode are not ported.

Mission row (:327-342):
```cs
string text1 = "(" + TextResolver.GetText("Unknown mission") + ")";
if (infoPanel._ActualEmpire == infoPanel._Game.PlayerEmpire || GodMode || flag1 | flag2) {
    string text2 = builtObject.Mission == null || builtObject.Mission.Type == 0 ? "(No mission)" : Galaxy.ResolveDescription(empire, builtObject.Mission);
    if (builtObject.Role == BuiltObjectRole.Military)
        text2 = AttackRangeSquared != 0.0 ? (AttackRangeSquared != 4000000.0 ? (AttackRangeSquared != 2304000000.0
                ? text2 + " (Engage detected targets)" : text2 + " (Engage system targets)") : text2 + " (Engage nearby targets)") : text2 + " (Engage when attacked)";
    if (builtObject.SubsequentMissions.Count > 0)
        text2 = text2 + " (" + builtObject.SubsequentMissions.Count.ToString() + " queued)";
```
DistantWorlds.Types/Galaxy.2.cs:2037 `ResolveDescription(BuiltObjectMissionType)`, with the GameText.txt values filled in: Undefined → "(No mission)", Explore → "Explore", Build/BuildRepair → "Build", Transport → "Transport", Patrol → "Patrol", Escort → "Escort", Rescue → "Rescue", Blockade → "Blockade", Attack → "Attack", Escape → "Escape", Retire → "Retire", Retrofit → "Retrofit", Colonize → "Colonize", Waypoint → "Assemble", Hold → "Wait", WaitAndAttack → "Prepare and Attack", WaitAndBombard → "Prepare and Bombard", MoveAndWait → "Move and Wait", Refuel → "Refuel", ExtractResources → "Mine", LoadTroops → "Load Troops", UnloadTroops → "Unload Troops", Deploy → "Deploy", Undeploy → "Undeploy", Repair → "Repair", Move → "Move", Bombard → "Bombard". The default (`SplitString(missionType.ToString())`) gives Capture → "Capture", Reinforce → "Reinforce", Raid → "Raid".

Galaxy.3.cs:20 `ResolveDescription(Empire empire, BuiltObjectMission mission)`, the target text (the part we port):
```cs
if (mission.TargetSector != null) text = string.Format("Sector {0}", ResolveSectorDescription(mission.TargetSector));   // Galaxy.7.cs:1508: ((char)(X + 65)).ToString() + (Y + 1)
else if (mission.TargetShipGroup != null) text = mission.TargetShipGroup.Name;
else if (mission.TargetBuiltObject != null) text = mission.TargetBuiltObject.Name;
else if (mission.TargetHabitat != null) {
    text2 = ResolveDescription(targetHabitat.Category);
    SystemVisibilityStatus s = empire.CheckSystemVisibilityStatus(targetHabitat.SystemIndex);
    text = (s != SystemVisibilityStatus.Unexplored) ? targetHabitat.Name : string.Format("Unknown {0}", text2); }
else if (mission.TargetCreature != null) text = mission.TargetCreature.Name;
```
Components row (:463-490):
```cs
string text4 = "(All components normal)";
if (_ActualEmpire == PlayerEmpire || _ActualEmpire == null || GodMode | flag1) {
    int damaged = builtObject.DamagedComponentCount; int unbuilt = builtObject.UnbuiltComponentCount;
    int num8 = builtObject.DisabledComponentIndexes != null ? builtObject.DisabledComponentIndexes.Count : 0;
    if (damaged > 0 || unbuilt > 0 || num8 > 0) {
        string str3 = "Components: ";
        if (damaged > 0) str3 += damaged + " damaged, ";
        if (num8 > 0)    str3 += num8 + " disabled, ";
        if (unbuilt > 0) str3 += unbuilt + " unbuilt, ";
        text4 = str3.Substring(0, str3.Length - 2); }
    else if (builtObject.RetrofitDesign != null) text4 = "(" + string.Format("RETROFITTING to {0}", RetrofitDesign.Name) + ")";
} else text5 = "(Unknown component status)";
```
Fuel row (:604-620), shown for the player's own objects, else "(Unknown)":
```cs
int currentValue = Math.Max(0, (int)builtObject.CurrentFuel);
if (builtObject.CurrentFuel <= 0.0 && builtObject.Role != BuiltObjectRole.Base && builtObject.UnbuiltComponentCount == 0) suffixData = " (speed reduced)";
DrawBarGraph("Fuel", …, builtObject.FuelCapacity, currentValue, …, suffixData);
```
Speed row (:637-651), not for bases, always shown:
```cs
if (builtObject.MovementSlowedLocation && CurrentSpeed < WarpSpeed) suffixData2 += " (slowed)";
if (builtObject.HyperjumpDisabledLocation) suffixData2 += " (Hyper block)";
if (builtObject.WarpSpeed <= 0) suffixData2 = " (No Hyperdrive)";
DrawBarGraph("Speed", …, (int)builtObject.TopSpeed, (int)builtObject.CurrentSpeed, …, suffixData2);
```
Damage fraction: DistantWorlds.Controls/Controls/InfoPanel.cs:1236 `double num = (double)builtObject.DamagedComponentCount / (double)builtObject.Components.Count;` (used for the damage overlay on the ship image). Cargo is not a row in the original panel; our Cargo row is a streamlined addition.

## Steps (all in src/ui/hud.ts)

1. Imports: add `import { BuiltObjectMissionType, builtObjectMission, type BuiltObjectMission } from '../sim/missions/mission';` and `import { SystemVisibilityStatus } from '../sim/visibility';`.
2. After `builtObjectRows` (~line 1021), add these, all exported:
   - `export function missionTypeLabel(type: BuiltObjectMissionType): string`: the Galaxy.2.cs:2037 table above, as a `switch`. Put the three default cases (Capture, Reinforce, Raid) in the `default:` branch as `BuiltObjectMissionType[type] ?? ''`. Comment it `// Port of Galaxy.2.cs ResolveDescription(BuiltObjectMissionType) (GameText.txt values)`.
   - `export function missionTargetText(mission: BuiltObjectMission, empire: Empire | null): string`: the Galaxy.3.cs:20 target block, in the same order:
     - For a sector: `` `Sector ${String.fromCharCode(mission.targetSector.x + 65)}${mission.targetSector.y + 1}` ``.
     - For a ship group: `''`, with `// TODO(port): ShipGroup.Name — not in sim`.
     - For a built object: its `name`.
     - For a habitat `h`: `cat = h.category === HabitatCategoryType.GasCloud ? 'Gas Cloud' : HabitatCategoryType[h.category]`.
       - The target is unknown when `empire !== null && h.systemIndex >= 0 && h.systemIndex < empire.visibility.systemVisibility.length && empire.visibility.checkSystemVisibilityStatus(h.systemIndex) === SystemVisibilityStatus.Unexplored`.
       - Return `` `Unknown ${cat}` `` when unknown, else `h.name`.
     - For a creature: its `name`.
     - Otherwise: `''`.
   - `export function builtObjectStatusRows(bo: BuiltObject, player: Empire | null): { label: string; value: string }[]`. Comment it `// Task 14b: port of BaconInfoPanel.cs BuiltObject rows (mission/components/fuel/speed); player null = no player empire (all known)`. Then:
     1. `const known = player === null || bo.actualEmpire === player;`
     2. **Mission**. `m = builtObjectMission(bo.mission)`.
        - If not `known`: push `{ label: 'Mission', value: '(Unknown mission)' }`.
        - Otherwise start with `text = m === null || m.type === BuiltObjectMissionType.Undefined ? '(No mission)' : missionTypeLabel(m.type)`.
        - If `bo.role === BuiltObjectRole.Military`, append the engage suffix. By `attackRangeSquared`: 0 → ' (Engage when attacked)', 4000000 → ' (Engage nearby targets)', 2304000000 → ' (Engage system targets)', anything else → ' (Engage detected targets)'.
        - If `bo.subsequentMissions.length > 0`, append `` ` (${bo.subsequentMissions.length} queued)` ``.
        - Push `{ label: 'Mission', value: text }`.
     3. **Target**: only when `known && m !== null && m.type !== BuiltObjectMissionType.Undefined`. Compute `t = missionTargetText(m, bo.actualEmpire)` and push `{ label: 'Target', value: t }` when `t !== ''`.
     4. **Components**:
        - If `known || bo.actualEmpire === null`, build the text exactly as the C# above, but without the `'Components: '` prefix, since the label is the row label. E.g. '2 damaged, 1 unbuilt', '(RETROFITTING to X)' or '(All components normal)'.
        - Otherwise use '(Unknown component status)'.
        - Push `{ label: 'Components', value }`.
     5. **Damage**: when `known && bo.damagedComponentCount > 0 && bo.components.count > 0`, push `{ label: 'Damage', value: `${Math.round((100 * bo.damagedComponentCount) / bo.components.count)}%` }` with the comment `// InfoPanel.cs:1236 damage fraction`.
     6. **Fuel**:
        - If `known`: `value = `${Math.max(0, Math.trunc(bo.currentFuel))} / ${Math.trunc(bo.fuelCapacity)}``. Append ' (speed reduced)' when `bo.currentFuel <= 0 && bo.role !== BuiltObjectRole.Base && bo.unbuiltComponentCount === 0`.
        - Otherwise use '(Unknown)'.
        - Push `{ label: 'Fuel', value }`.
     7. **Speed**: only when `bo.role !== BuiltObjectRole.Base`.
        - `suffix = ''`.
        - If `bo.hyperjumpDisabledLocation`, `suffix += ' (Hyper block)'`.
        - If `bo.warpSpeed <= 0`, `suffix = ' (No Hyperdrive)'`.
        - Push `{ label: 'Speed', value: `${Math.trunc(bo.currentSpeed)} / ${Math.trunc(bo.topSpeed)}${suffix}` }`.
        - Add `// TODO(port): " (slowed)" — BuiltObject.MovementSlowedLocation not in sim`.
     8. **Cargo**: only when `known && bo.cargoCapacity > 0`. `used = sum of Math.max(0, c.amount)` over `bo.cargo?.items ?? []`. Push `{ label: 'Cargo', value: `${used} / ${bo.cargoCapacity}` }` with the comment `// streamlined: not a row in the original panel`.
3. `buildSelectionRows`:
   - Change the signature to `buildSelectionRows(sel: Selection, gameData?: GameData, player: Empire | null = null)`.
   - In the `if (sel.builtObject)` branch, after the `builtObjectRows` loop and before `return rows;`, add `for (const r of builtObjectStatusRows(sel.builtObject, player)) addColorRow(r);`.
   - At the call site in `buildSelectionPanel`'s `refresh` (~line 807), pass `wiring.galaxy?.playerEmpire ?? null` as the third argument.
4. Live refresh: in `buildSelectionPanel`, right after the `wiring.onSelectionChange = (sel) => { … };` block (~line 816), add:
   ```ts
   // Task 14b: ship/base status (speed, fuel, mission) changes every tick — re-render
   // the rows twice a second while one is selected. Stops once the HUD is removed.
   const liveTimer = setInterval(() => {
       if (!panel.isConnected) {
           clearInterval(liveTimer);
           return;
       }
       if (currentSelection?.builtObject) refresh();
   }, 500);
   ```

## Tests (`test/hud-builtobject-status.test.ts`, no jsdom; fakes cast `as unknown as BuiltObject` / `Empire` / `BuiltObjectMission`)

Use a helper `fakeBo(extra)` that returns this, spread with `extra`:
```ts
{ role: BuiltObjectRole.Exploration, currentSpeed: 0, topSpeed: 20, warpSpeed: 3000,
  hyperjumpDisabledLocation: false, currentFuel: 50, fuelCapacity: 100, attackRangeSquared: 0,
  unbuiltComponentCount: 0, damagedComponentCount: 0, disabledComponentIndexes: null,
  retrofitDesign: null, components: { count: 10 }, cargo: null, cargoCapacity: 0,
  mission: null, subsequentMissions: [], actualEmpire: player }
```
Here `player = { visibility: { systemVisibility: [{}, {}], checkSystemVisibilityStatus: (i: number) => (i === 1 ? SystemVisibilityStatus.Unexplored : SystemVisibilityStatus.Explored) } }`.

- `missionTypeLabel`: Undefined → '(No mission)', ExtractResources → 'Mine', Waypoint → 'Assemble', Hold → 'Wait', BuildRepair → 'Build', Raid → 'Raid', Capture → 'Capture'.
- `missionTargetText(m, player)`, where `m` has all five targets null except the one set:
  - `targetSector: {x: 2, y: 4}` → 'Sector C5'.
  - `targetBuiltObject: {name: 'Port A'}` → 'Port A'.
  - `targetHabitat: {name: 'Terra', systemIndex: 0, category: Planet}` → 'Terra'.
  - The same habitat with `systemIndex: 1` → 'Unknown Planet'.
  - `systemIndex: 1`, category GasCloud → 'Unknown Gas Cloud'.
  - `systemIndex: 5` (out of range) → the name.
  - With `empire` null → the name.
  - `targetCreature: {name: 'Kaltor'}` → 'Kaltor'.
  - All null → ''.
- `builtObjectStatusRows`:
  - An idle own explorer (`fakeBo({})`) gives labels `['Mission', 'Components', 'Fuel', 'Speed']`, with values '(No mission)', '(All components normal)', '50 / 100', and '0 / 20'.
  - An own frigate: `role: Military`, `attackRangeSquared: 4000000`, `subsequentMissions: [{}, {}]`, and `mission: { type: Attack, targetSector: null, targetShipGroup: null, targetBuiltObject: { name: 'Raider' }, targetHabitat: null, targetCreature: null }`. Expect:
    - Mission 'Attack (Engage nearby targets) (2 queued)';
    - Target 'Raider'.
  - `attackRangeSquared` 0 / 2304000000 / 123 on a military ship with no mission → '(No mission) (Engage when attacked)' / '… (Engage system targets)' / '… (Engage detected targets)'.
  - `damagedComponentCount: 2, unbuiltComponentCount: 1, disabledComponentIndexes: [4]` → Components '2 damaged, 1 disabled, 1 unbuilt', and Damage '20%'.
  - `retrofitDesign: {name: 'Mk2'}`, nothing damaged → '(RETROFITTING to Mk2)'.
  - `currentFuel: -3` → Fuel '0 / 100 (speed reduced)'. The same with `unbuiltComponentCount: 1` → Fuel '0 / 100'.
  - For Speed:
    - `currentSpeed: 1500.7, warpSpeed: 3000` → '1500 / 20';
    - `warpSpeed: 0` → '0 / 20 (No Hyperdrive)';
    - `hyperjumpDisabledLocation: true` → '0 / 20 (Hyper block)'.
  - `role: Base` → no Speed row.
  - Cargo: `cargoCapacity: 500, cargo: { items: [{ amount: 120 }, { amount: 30 }] }` → Cargo '150 / 500'.
  - Someone else's ship (`actualEmpire: {}`, player as above) → Mission '(Unknown mission)', Components '(Unknown component status)', Fuel '(Unknown)'. There are no Target / Damage / Cargo rows, but a Speed row is still present.
  - With `actualEmpire: null` and a non-null player, Components is known ('(All components normal)') while Fuel is '(Unknown)'.
  - With `player` null, everything is known.

Run `npm run typecheck && npm test` (hud.test.ts and hud-cycle-builtobjects.test.ts must still pass). With `npm run dev` running, save `node scripts/shot.mjs 'http://localhost:5173/?autostart=1' shots/14b-selection.png`. Do not open it. Then append `## Worker report`: files changed, the shot.mjs console output, and anything left undone.
