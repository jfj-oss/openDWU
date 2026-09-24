# Task 13c — Cycle chips Bases / Military / Constr. / Other select real BuiltObjects

thinking: off
scope: locked

Edit only these files:
- `src/ui/hud.ts`
- `src/ui/keyboard.ts`: only the `zoomToSelection` handler, ~line 289.
- a new `test/hud-cycle-builtobjects.test.ts`

Do NOT edit anything under `src/sim/`, `src/render/`, or `src/ui/screens/`. This task is file-disjoint from 13a (render layer) and 13b (screens), and does not depend on either. Map click-picking of ships is out of scope. Start editing right away.

Today `stepCycle` in hud.ts (~line 663) prints "No Bases yet" etc. for every chip except Colonies. After this task, Bases/Military/Constr./Other cycle through the player's real ships and bases, and the selection panel shows the selected BuiltObject. Fleets and Idle stay as they are, because ShipGroup and missions are not ported (`Empire.shipGroups: unknown[]`, `BuiltObject.mission` is always null).

## Sim data (read-only; verified to exist)

- `Empire.builtObjects: BuiltObject[]` (state) and `Empire.privateBuiltObjects: BuiltObject[]` (src/sim/empire.ts).
- `BuiltObject` (src/sim/builtObject.ts) has `name`, `xpos`, `ypos`, `size`, `role: BuiltObjectRole`, `subRole: BuiltObjectSubRole`, `empire: Empire | null`, `parentHabitat: Habitat | null`, `design: Design` (with `.name`), and `troops: TroopList | null` (with `.count`). Type-import `BuiltObject` from `../sim/builtObject`.
- `BuiltObjectSubRole` comes from `../sim/builtObjectTypes`, a plain enum file with no imports: Undefined, Escort, Frigate, Destroyer, Cruiser, CapitalShip, TroopTransport, Carrier, ResupplyShip, ExplorationShip, SmallFreighter, MediumFreighter, LargeFreighter, ColonyShip, PassengerShip, ConstructionShip, GasMiningShip, MiningShip, GasMiningStation, MiningStation, SmallSpacePort, MediumSpacePort, LargeSpacePort, ResortBase, GenericBase, EnergyResearchStation, WeaponsResearchStation, HighTechResearchStation, MonitoringStation, DefensiveBase.
- `BuiltObjectRole { Undefined, Military, Exploration, Freight, Passenger, Colony, Build, Resource, Base }` comes from `../sim/data/designSpecifications`.
- `CycleKind = 'colonies' | 'bases' | 'military' | 'construction' | 'other' | 'fleets' | 'idleShips'` (keyboard.ts:368).

## C# source (verbatim, trimmed)

Main.Part9.cs:2927-3090. Each cycle builds the list from `PlayerEmpire.BuiltObjects` followed by `PlayerEmpire.PrivateBuiltObjects`, then filters it. Each kind remembers its own last-cycled object (`builtObject_0` bases, `_1` military, `_2` construction, `_3` other). The next index is `IndexOf(last) + 1`, wrapping to 0, and 0 when there is no last object.
```cs
// btnCycleConstruction_Click
list.Add(BuiltObjectRole.Build);
BuiltObjectList builtObjectsByRole = builtObjectList.GetBuiltObjectsByRole(list);
BuiltObjectList builtObjectsBySubRole = builtObjectList.GetBuiltObjectsBySubRole(BuiltObjectSubRole.ResupplyShip);
if (builtObjectsBySubRole.Count > 0) builtObjectsByRole.AddRange(builtObjectsBySubRole);
// btnCycleMilitary_Click
list.Add(BuiltObjectRole.Military);                       // GetBuiltObjectsByRole
// btnCycleBases_Click   (GetBuiltObjectsBySubRole)
SmallSpacePort, MediumSpacePort, LargeSpacePort, GenericBase, EnergyResearchStation,
WeaponsResearchStation, HighTechResearchStation, MonitoringStation, DefensiveBase
// btnCycleOther_Click
list.Add(BuiltObjectRole.Colony); list.Add(BuiltObjectRole.Exploration);   // GetBuiltObjectsByRole
// then: method_208(selected) selects it; with MoveView the view centres on it (method_157).
```
`GetBuiltObjectsByRole` / `BySubRole` keep list order and skip nulls (BuiltObjectList.cs:317-329).

## Steps (all in src/ui/hud.ts unless stated)

1. Add `export function builtObjectCycleList(empire: { builtObjects: BuiltObject[]; privateBuiltObjects: BuiltObject[] }, kind: CycleKind): BuiltObject[]`.
   - Start from `all = [...empire.builtObjects, ...empire.privateBuiltObjects]` and drop nulls.
   - Apply the C# filters above:
     - `construction`: the Build-role objects, then the ResupplyShip objects appended.
     - `military`: role Military.
     - `bases`: the 9 subroles.
     - `other`: role Colony or Exploration.
   - Any other kind returns `[]`.
2. Add `export function subRoleLabel(subRole: BuiltObjectSubRole): string`. It returns `''` for Undefined; otherwise `BuiltObjectSubRole[subRole].replace(/([a-z])([A-Z])/g, '$1 $2')`. For example, SmallSpacePort → 'Small Space Port'.
3. Add `export function nearestSystem(systems: readonly SystemInfo[], x: number, y: number): SystemInfo | null`. It returns the system whose `systemStar` is nearest by squared distance, or null for an empty list. Use the same loop as `nearestSystemName`, ~line 1203.
4. Add `export function builtObjectRows(bo: BuiltObject): { label: string; value: string; color?: number }[]`. The rows, in order, each skipped when empty:
   - `Owner`: `bo.empire.name` with `color: bo.empire.mainColor`, only when `bo.empire` is non-null.
   - `Design`: `bo.design?.name ?? ''`.
   - `Size`: `String(bo.size)`.
   - `Location`: `bo.parentHabitat?.name ?? ''`.
   - `Troops`: `String(bo.troops.count)`, only when the count is greater than 0.
5. Change the `Selection` interface (~line 169) to `{ habitat: Habitat; system: SystemInfo; builtObject?: BuiltObject }`. Optional, so main.ts and the tests keep compiling. For a BuiltObject selection, `habitat` is the nearest system's star.
6. `buildSelectionPanel` → `stepCycle`:
   - Keep the `'colonies'` branch as it is.
   - For `'fleets'` and `'idleShips'`, keep `pushHudMessage(`No ${label} yet`)`. Add `// TODO(cycle): ShipGroup / BuiltObject.mission not ported (Main.Part7.cs 1863 btnCycleIdleShips_Click)`.
   - For bases/military/construction/other:
     - `list = builtObjectCycleList(game.playerEmpire as Empire, kind)`. If it is empty, `pushHudMessage(`No ${label} yet`)` and return.
     - Keep `const lastCycled = new Map<CycleKind, BuiltObject>()` next to `activeChip`. `next = nextInCycle(list, lastCycled.get(kind) ?? null, dir)`, then `lastCycled.set(kind, next)`.
     - `system = nearestSystem(galaxy.systems, next.xpos, next.ypos)`. If it is null, return.
     - `wiring.onSelectionChange?.({ habitat: system.systemStar, system, builtObject: next })`.
     - If `moveView`: `cam.centerOn(next.xpos, next.ypos); cam.zoomAt(SYSTEM_LEVEL_ZOOM, cam.width / 2, cam.height / 2);`.
   - Use the label of `kind`, not of `activeChip`: `CYCLE_CHIPS.find((c) => c.key === kind)?.label ?? kind`.
7. `refresh()` in `buildSelectionPanel` (~line 729): when `sel.builtObject` is set, `nameEl.textContent = bo.name` and `subEl.textContent = `${subRoleLabel(bo.subRole)} · ${sel.system.systemStar.name} system``. Otherwise keep today's habitat header.
8. `buildSelectionRows` (~line 1112): right after the `addColorRow` helper is defined, and before the `ownerRows` loop, add `if (sel.builtObject) { for (const r of builtObjectRows(sel.builtObject)) addColorRow(r); return rows; }`.
9. `doViewAction` `'zoomSelection'` (~line 904): centre on `sel.builtObject ?? sel.habitat`.
10. `src/ui/keyboard.ts` `zoomToSelection` (~line 289): the same change. `const t = sel.builtObject ?? sel.habitat; camera.centerOn(t.xpos, t.ypos);`.

## Tests (`test/hud-cycle-builtobjects.test.ts`, no jsdom; fakes cast `as unknown as BuiltObject`)

- `builtObjectCycleList`: build state list `[portA (Base, SmallSpacePort), frigate (Military, Frigate), explorer (Exploration, ExplorationShip)]` and private list `[conShip (Build, ConstructionShip), resupply (Military, ResupplyShip), mine (Resource, MiningStation), research (Base, EnergyResearchStation)]`. Expect:
  - bases → `[portA, research]`;
  - military → `[frigate, resupply]`;
  - construction → `[conShip, resupply]` (Build first, then resupply appended);
  - other → `[explorer]`;
  - fleets → `[]`.
- `subRoleLabel`: SmallSpacePort → 'Small Space Port', ConstructionShip → 'Construction Ship', Undefined → ''.
- `nearestSystem`: with two fake systems at (0, 0) and (1000, 0), the point (900, 10) → the second; `[]` → null.
- `builtObjectRows`:
  - An object with an empire (mainColor 0xff0000), design 'Pathfinder', size 120, parentHabitat 'Terra', troops `{count: 0}` → labels `['Owner', 'Design', 'Size', 'Location']`, with the Owner row's color 0xff0000.
  - An abandoned one (`empire: null`, design 'Hulk', size 50, `parentHabitat: null`, troops `{count: 2}`) → `['Design', 'Size', 'Troops']`.
- `nextInCycle` wrap with a remembered last item. Reuse the existing export: list [a, b], last b, dir 1 → a.

Run `npm run typecheck && npm test` (hud.test.ts must still pass), then append `## Worker report`.
