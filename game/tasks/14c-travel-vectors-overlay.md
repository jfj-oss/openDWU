# Task 14c — Travel Vectors (State / Private) overlay

thinking: off
scope: locked

Edit only these files:
- `src/render/overlayLayer.ts`: new imports, new exported pure helpers, one new `Graphics` field, a few lines in the constructor and `update()`, and the header comment.
- a new `test/travel-vectors.test.ts`. The existing `test/overlay-layer.test.ts` must keep passing unchanged.

Do NOT edit anything under `src/sim/` (six other agents are editing it). Do NOT edit `src/render/mainView.ts`: it already calls `this.overlayLayer.update(z, cam)` every frame (~line 1250), and `OverlayLayer` already holds `galaxy` and the `MapOverlayState`, so no hook-up is needed. Do NOT edit `src/ui/` (tasks 14a/14b own hud.ts). The toggle rows "Travel Vectors (State)" / "Travel Vectors (Private)" already exist and flip `state.travelVectorsState` / `state.travelVectorsPrivate`. Start editing right away.

After this task, with either toggle on, each of the player's ships that is travelling at hyperspeed gets a dashed grey line from the ship to the target of its current command. Ships move every frame (the sim updates `xpos`/`ypos`), and the lines are redrawn every frame.

## Existing code you use (read-only; verified at HEAD)

- `galaxy.builtObjects: BuiltObject[]` and `galaxy.playerEmpire: Empire | null` (src/sim/galaxy.ts).
- `BuiltObject` (src/sim/builtObject.ts) has these plain fields: `xpos`, `ypos`, `hasBeenDestroyed`, `role: BuiltObjectRole`, `topSpeed`, `warpSpeed`, `currentSpeed` (float), `hyperjumpPrepare: boolean`, `owner: Empire | null` (null = private ship), `mission: unknown`, `shipGroup: unknown`, `parentBuiltObject: BuiltObject | null`, and `parentHabitat: Habitat | null` (a Habitat has `xpos`/`ypos`). It also has the getter `actualEmpire: Empire | null`.
- `src/sim/missions/mission.ts`:
  - `export function builtObjectMission(mission: unknown): BuiltObjectMission | null`.
  - `BuiltObjectMission` has `type` (`BuiltObjectMissionType.Undefined` is 0) and `resolveTargetCoordinatesCurrentCommand(): { x: number; y: number }`, a port of BuiltObjectMission.cs:913. It returns the target of the current command, truncated to ints and clamped into the galaxy, or `{0, 0}` (C# `Point.Empty`) when there is no command.
- `src/sim/fleets/shipGroup.ts`: `class ShipGroup` with `empire: Empire | null` and `leadShip: BuiltObject | null`. Import it as a type only.
- `BuiltObjectRole` from `src/sim/data/designSpecifications` (has `Base`).
- In overlayLayer.ts: `OverlayLayer` has `root: Container` (a world-space layer, so draw in world units with stroke width `1 / z`), `private galaxy`, and `private state: MapOverlayState`. `update(z, cam)` gets the zoom `z` (screen px per world unit; the C# zoom factor is `f = 1 / z`). `Camera` exposes `x`, `y` (the view centre in world units), `width` and `height` (screen px). The existing `updateGroup` shows the culling pattern.
- Pixi 8 `Graphics`: `g.clear()`, `g.moveTo(x, y).lineTo(x2, y2)`, `g.stroke({ width, color, alpha })`.

## C# source (verbatim, trimmed)

The draw pass is Controls/MainView.2.cs:5069 `method_250`, which draws the Main View above zoom factor 0.9 (MainView.cs:1539; that means always here). `empire` is `_Game.PlayerEmpire`. `flag16`/`flag17` are `gameOptions_0.MapOverlayTravelVectorsState` / `…Private` (MainView.2.cs:5122). Per built object in view (MainView.2.cs:5925-5956):
```cs
if (builtObject.ShipGroup != null && builtObject.ShipGroup.LeadShip == builtObject) flag32 = false;   // fleet lead ships: skipped here, drawn by the fleet pass
if (!flag32) continue;
int num66 = (int)((builtObject.Xpos - (double)int_16) / double_15);   // screen x; skipped when off screen
...
if (flag16 || flag17) {
    bool flag33 = ((builtObject.Owner == null) ? flag17 : flag16);
    if (flag33 && builtObject.ActualEmpire == empire) {
        if (SpecialHighlightBuiltObjects.Count > 0 && SpecialHighlightBuiltObjects.Contains(builtObject))
            method_253(spriteBatch_2, builtObject, num66, num67, int_16, int_18, double_15, bool_13: false, System.Drawing.Color.FromArgb(255, 0, 0), 2);
        else
            method_251(spriteBatch_2, builtObject, num66, num67, int_16, int_18, double_15, bool_13: false);   // → Color.FromArgb(170, 170, 170), width 1
    }
}
```
MainView.2.cs:6171 `method_251` → `method_252(…, Color.FromArgb(170, 170, 170))` → `method_253(…, color, 1)` → BaconDistantWorlds/BaconMainView.cs:19 `method_253`:
```cs
if (builtObject_1 == null || builtObject_1.HasBeenDestroyed || builtObject_1.Role == BuiltObjectRole.Base || builtObject_1.TopSpeed <= 0
    || builtObject_1.WarpSpeed <= 0 || (double)builtObject_1.CurrentSpeed <= (double)builtObject_1.TopSpeed && !builtObject_1.HyperjumpPrepare
    || builtObject_1.Mission == null || builtObject_1.Mission.Type == BuiltObjectMissionType.Undefined
    || !bool_13 && builtObject_1.ShipGroup != null && builtObject_1.ShipGroup.LeadShip != builtObject_1)
    return;
Point point = builtObject_1.Mission.ResolveTargetCoordinatesCurrentCommand();
if (point.IsEmpty) {
    if (builtObject_1.ParentBuiltObject != null) point = new Point((int)ParentBuiltObject.Xpos, (int)ParentBuiltObject.Ypos);
    else if (builtObject_1.ParentHabitat != null) point = new Point((int)ParentHabitat.Xpos, (int)ParentHabitat.Ypos);
}
int num1 = (int)((double)(point.X - int_13) / double_15);
int num2 = (int)((double)(point.Y - int_14) / double_15);
if ((Math.Abs((double)point.X - builtObject_1.Xpos) + Math.Abs((double)point.Y - builtObject_1.Ypos)) * (1500.0 / double_15) > 40000.0)
    XnaDrawingHelper.DrawLine(spriteBatch_2, int_11, int_12, num1, num2, color_18, int_15, true /* dashed */, mainview.texture2D_35 /* arrow head */);
```
Fleet lead ships are drawn by MainView.2.cs:6335 `method_258`, which runs for every visible fleet. With `MapOverlayTravelVectorsState` on, it calls `method_252(…, Color.Yellow)` when the fleet is `_Game.SelectedObject`, else `method_251(…)` (grey). We port only the player's own fleets (no fleet selection yet, so always grey). Other empires' fleets need `IsObjectVisibleToThisEmpire`, so they are a TODO.

## Steps (all in src/render/overlayLayer.ts)

1. Imports: `import type { BuiltObject } from '../sim/builtObject';`, `import type { Empire } from '../sim/empire';`, `import type { ShipGroup } from '../sim/fleets/shipGroup';`, `import { builtObjectMission } from '../sim/missions/mission';`, and `import { BuiltObjectRole } from '../sim/data/designSpecifications';`.
2. Header comment: in the first paragraph, remove "Travel Vectors State/Private" from the not-yet-rendered list. Add a short paragraph: "Travel Vectors (task 14c): port of MainView.2.cs method_250 per-ship pass + BaconMainView.cs method_253; see travelVectorsFor."
3. Pure helpers (all exported):
   - `export const TRAVEL_VECTOR_COLOR = 0xaaaaaa;` with the comment `// MainView.2.cs method_251: Color.FromArgb(170, 170, 170)`.
   - `export type TravelVectorKind = 'state' | 'private';`
   - `export interface TravelVector { builtObject: BuiltObject; x1: number; y1: number; x2: number; y2: number }`.
   - `export function travelVectorFor(bo: BuiltObject): TravelVector | null`: the BaconMainView.cs method_253 guard and target, without the ShipGroup clause (step 3's caller handles fleets).
     - Return null when any of these hold:
       - `bo.hasBeenDestroyed`;
       - `bo.role === BuiltObjectRole.Base`;
       - `bo.topSpeed <= 0`;
       - `bo.warpSpeed <= 0`;
       - `bo.currentSpeed <= bo.topSpeed && !bo.hyperjumpPrepare`;
       - `m === null`, where `m = builtObjectMission(bo.mission)`;
       - `m.type === 0`, with the comment `// BuiltObjectMissionType.Undefined`.
     - `let p = m.resolveTargetCoordinatesCurrentCommand();`
     - If `p.x === 0 && p.y === 0` (Point.IsEmpty): `p` becomes `{ x: Math.trunc(bo.parentBuiltObject.xpos), y: Math.trunc(bo.parentBuiltObject.ypos) }` when `bo.parentBuiltObject !== null`, else the same from `bo.parentHabitat` when it is non-null. Otherwise `p` stays `{0, 0}`, as in the C#.
     - Return `{ builtObject: bo, x1: bo.xpos, y1: bo.ypos, x2: p.x, y2: p.y }`.
   - `export function travelVectorsFor(galaxy: { builtObjects: readonly BuiltObject[] }, player: Empire | null, kind: TravelVectorKind): TravelVector[]`. Comment it `// Port of MainView.2.cs method_250 (5925-5956) travel-vector filter + method_258 (player fleets, State only)`:
     - If `player === null`, return `[]`.
     - For each `bo` of `galaxy.builtObjects` (skip null):
       - `const group = bo.shipGroup as ShipGroup | null;`
       - If `group !== null && group !== undefined`:
         - Include `bo` only when `kind === 'state' && group.leadShip === bo && group.empire === player` (method_258; fleet lead ships ignore Owner).
         - All other fleet members are skipped (method_253's ShipGroup clause).
       - Otherwise include `bo` when `bo.actualEmpire === player && (kind === 'private' ? bo.owner === null : bo.owner !== null)`.
       - For an included `bo`, push `travelVectorFor(bo)` when it is not null.
     - Add above it `// TODO(port): other empires' fleets (method_258 + IsObjectVisibleToThisEmpire), selected-fleet yellow, SpecialHighlightBuiltObjects red, arrow head (texture2D_35)`.
   - `export function travelVectorLongEnough(v: TravelVector, f: number): boolean`: `(Math.abs(v.x2 - v.x1) + Math.abs(v.y2 - v.y1)) * (1500 / f) > 40000`. Here `f = 1 / z`.
   - `export function dashSegments(x1: number, y1: number, x2: number, y2: number, dash: number, gap: number, maxDashes = 200): Array<[number, number, number, number]>`:
     - `len = Math.hypot(x2 - x1, y2 - y1)`. If `len === 0`, return `[]`.
     - `let d = dash; let g = gap;` If `len / (d + g) > maxDashes`, scale both by `k = len / (maxDashes * (d + g))`.
     - Walk from `t = 0` while `t < len`: push the segment from `t` to `Math.min(t + d, len)` along the line, then `t += d + g`.
4. `OverlayLayer` class:
   - Add the field `private travelVectors = new Graphics();`.
   - In the constructor, right after `world.addChild(this.root);`, add `this.root.addChild(this.travelVectors);`.
   - Add a private method `updateTravelVectors(z: number, cam: Camera): void`:
     ```ts
     const g = this.travelVectors;
     g.clear();
     const kinds: TravelVectorKind[] = [];
     if (this.state.travelVectorsState) kinds.push('state');
     if (this.state.travelVectorsPrivate) kinds.push('private');
     const player = this.galaxy.playerEmpire;
     if (kinds.length === 0 || player === null) {
         g.visible = false;
         return;
     }
     const f = 1 / z;
     const halfW = cam.width / (2 * z);
     const halfH = cam.height / (2 * z);
     for (const kind of kinds) {
         for (const v of travelVectorsFor(this.galaxy, player, kind)) {
             // MainView.2.cs: only ships inside the view get a vector.
             if (v.x1 < cam.x - halfW || v.x1 > cam.x + halfW || v.y1 < cam.y - halfH || v.y1 > cam.y + halfH) continue;
             if (!travelVectorLongEnough(v, f)) continue;
             for (const [ax, ay, bx, by] of dashSegments(v.x1, v.y1, v.x2, v.y2, 6 * f, 4 * f)) {
                 g.moveTo(ax, ay).lineTo(bx, by);
             }
         }
     }
     g.stroke({ width: f, color: TRAVEL_VECTOR_COLOR, alpha: 1 });
     g.visible = true;
     ```
   - Call `this.updateTravelVectors(z, cam);` at the end of `update(z, cam)`.
   - In `destroy()`, leave the existing `this.unsubscribe();` as it is. The Graphics lives under `root` and is destroyed with the view.

## Tests (`test/travel-vectors.test.ts`, no jsdom; fakes cast `as unknown as BuiltObject` / `Empire`)

Use a helper `ship(extra)` that returns this, spread with `extra`:
```ts
{ xpos: 0, ypos: 0, hasBeenDestroyed: false, role: BuiltObjectRole.Military, topSpeed: 20, warpSpeed: 3000,
  currentSpeed: 3000, hyperjumpPrepare: false, owner: player, actualEmpire: player, shipGroup: null,
  parentBuiltObject: null, parentHabitat: null,
  mission: { type: 1, resolveTargetCoordinatesCurrentCommand: () => ({ x: 50000, y: 0 }) } }
```
Here `player = {}` and `other = {}`, each cast to Empire.

- `travelVectorFor`:
  - The default ship → `{x1: 0, y1: 0, x2: 50000, y2: 0}`.
  - null for each of these:
    - `hasBeenDestroyed: true`;
    - `role: Base`;
    - `topSpeed: 0`;
    - `warpSpeed: 0`;
    - `currentSpeed: 20` (not above top speed);
    - `mission: null`;
    - mission `type: 0`.
  - `currentSpeed: 10, hyperjumpPrepare: true` → a vector.
  - The mission returns `{0, 0}`:
    - with `parentBuiltObject: {xpos: 10.9, ypos: 20.2}` → `(10, 20)`;
    - with only `parentHabitat: {xpos: 7.5, ypos: 8.5}` → `(7, 8)`;
    - with neither → `(0, 0)`.
- `travelVectorsFor`, with `a` = state ship (`owner: player`), `b` = private ship (`owner: null`), `c` = `other`'s ship (`actualEmpire: other`, `owner: other`), and `d` = idle own ship (`currentSpeed: 5`):
  - 'state' → `[a]` (the builtObjects of the vectors);
  - 'private' → `[b]`;
  - `player` null → `[]`.
- Fleets: `grp = { leadShip: lead, empire: player }`, `lead = ship({ shipGroup: grp })`, `member = ship({ shipGroup: grp })`. Set `grp.leadShip = lead` after creating it.
  - 'state' → `[lead]`;
  - 'private' → `[]`;
  - with `grp.empire = other` → `[]`.
- `travelVectorLongEnough`: vector (0,0)→(40000,0):
  - at f = 1500 → false (40000 is not > 40000);
  - at f = 1000 → true;
  - (0,0)→(100,0) at f = 1 → true (150000);
  - (0,0)→(20,0) at f = 1 → false.
- `dashSegments`:
  - `(0,0,10,0, 3,2)` → exactly `[[0,0,3,0],[5,0,8,0]]` (t = 10 is not < 10, so the loop stops).
  - `(0,0,9,0, 3,2)` → `[[0,0,3,0],[5,0,8,0]]`; `(0,0,7,0, 3,2)` → `[[0,0,3,0],[5,0,7,0]]` (clamped end).
  - A zero-length line → `[]`.
  - `(0,0,100000,0, 1,1, 200)` → at most 200 segments, first starting at 0.
- `OverlayLayer` still constructs with the existing overlay-layer.test.ts setup (that file is unchanged and must pass).

Run `npm run typecheck && npm test`. With `npm run dev` running, save `node scripts/shot.mjs 'http://localhost:5173/?autostart=1&overlays=travelVectorsState,travelVectorsPrivate' shots/14c-travel-vectors.png` (main.ts `applyOverlaysUrlParam` accepts these keys). Do not open the screenshot. Then append `## Worker report`: files changed, the shot.mjs console output, and anything left undone.
