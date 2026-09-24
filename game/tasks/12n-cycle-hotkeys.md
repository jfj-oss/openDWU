# Task 12n — Wire the cycle hotkeys (C / P / M / Y / X / F / I) to the HUD cycle

thinking: off
scope: locked

Edit only `src/ui/keyboard.ts`, `src/ui/hud.ts` (buildSelectionPanel's cycle code ~line 630 only) and tests. Start editing right away.

The KEY_BINDINGS table has the actions `cycleColonies` / `cycleColoniesBackward` / `cycleColoniesMoveView`, and the same three variants for SpacePorts, MilitaryShips, ConstructionShips, ExplorationShips, Fleets and IdleShips. They fall through to the `default:` branch, so the keys do nothing today. The HUD's ‹ › buttons already cycle colonies (hud.ts `stepCycle`).

1. `keyboard.ts`: add a hook, the same pattern as `setGameMenuHandler` (~line 346):
```ts
export type CycleKind = 'colonies' | 'bases' | 'military' | 'construction' | 'other' | 'fleets' | 'idleShips';
export function setCycleHandler(h: ((kind: CycleKind, dir: 1 | -1, moveView: boolean) => void) | null): void;
export function cycleActionArgs(action: string): { kind: CycleKind; dir: 1 | -1; moveView: boolean } | null;  // pure, tested
```
   `cycleActionArgs`:
   - maps the prefixes Colonies→colonies, SpacePorts→bases, MilitaryShips→military, ConstructionShips→construction, ExplorationShips→other, Fleets→fleets, IdleShips→idleShips;
   - the suffix `Backward` gives dir -1; the suffix `MoveView` gives dir 1 with moveView true; no suffix gives dir 1 with moveView false;
   - returns null for anything else, including `cycleEngagementStance`.

   In `dispatchKey`, before the switch: `const cyc = cycleActionArgs(binding.action); if (cyc) { cycleHandler?.(cyc.kind, cyc.dir, cyc.moveView); return binding.action; }`. Match the function's existing return convention; read it first.
2. `hud.ts` buildSelectionPanel:
   - Change `stepCycle` to `(dir, kind = activeChip, moveView = true)`, using `kind` in place of `activeChip` inside.
   - Only call the two camera lines (`cam.centerOn` / `cam.zoomAt`) when `moveView` is true. The ‹ › buttons keep moving the view.
   - Register it: `setCycleHandler((kind, dir, moveView) => stepCycle(dir, kind, moveView))`.
   - Also set `activeChip = kind` and update the chip highlight the same way a chip click does, so the panel shows which list is cycling. Read the chip click handler just below.
3. Tests (no jsdom), for `cycleActionArgs`:
   - `cycleColonies` → {colonies, 1, false};
   - `cycleColoniesBackward` → dir -1;
   - `cycleFleetsMoveView` → {fleets, 1, true};
   - `cycleSpacePorts` → bases;
   - `cycleEngagementStance` → null;
   - `zoomIn` → null.

Run `npm run typecheck` && `npm test`, then append `## Worker report`.

## Worker report

Files changed:
- `src/ui/keyboard.ts` — added `CycleKind` type, `setCycleHandler` hook (same pattern as `setGameMenuHandler`), and pure `cycleActionArgs(action)` which decodes the seven `cycle<X>` prefixes (Colonies→colonies, SpacePorts→bases, MilitaryShips→military, ConstructionShips→construction, ExplorationShips→other, Fleets→fleets, IdleShips→idleShips) plus the `Backward` (dir -1) / `MoveView` (dir 1 + move view) suffixes; returns null for anything else (`cycleEngagementStance`, non-cycle actions). `dispatchKey` now checks `cycleActionArgs(binding.action)` before the switch and routes to the registered handler, returning the action id per the existing convention.
- `src/ui/hud.ts` — `buildSelectionPanel`: `stepCycle` is now `(dir, kind = activeChip, moveView = true)` using `kind` in place of `activeChip`; the two camera lines (`cam.centerOn` / `cam.zoomAt`) only run when `moveView` is true (the ‹ › buttons keep moving the view via their default `true`). Registered `setCycleHandler((kind, dir, moveView) => stepCycle(dir, kind, moveView))`, which also sets `activeChip = kind` and re-highlights the chip like a chip click so the panel shows which list is cycling.
- `test/keyboard.test.ts` — new `cycleActionArgs` describe block covering all six required cases plus the remaining prefix mappings and unknown-action nulls (no jsdom needed).

Done: C/P/M/Y/X/F/I (plain/Shift/Ctrl variants) now drive the HUD cycler; plain and Shift select without moving the view, Ctrl selects and moves it. `npm run typecheck` and `npm test` both pass (54 files, 622 tests).

Left undone: nothing in scope. Non-colony kinds still hit the existing `No <label> yet` TODO(cycle) path until ships (M3) are ported. No visual check performed (task scoped to keyboard/hud/tests only).
