# Task 12q — Keyboard-shortcuts overlay: mark which keys work

thinking: off
scope: locked

Edit only `src/ui/keyboard.ts` (`createShortcutsOverlay` ~line 413, plus one new exported set and one new function), `src/ui/hud.css` (the "Keyboard shortcuts" block ~line 315), and `test/keyboard.test.ts`. Do NOT edit hud.ts, main.ts or anything under src/sim/. Start editing right away.

The `?` overlay lists every row of `KEY_BINDINGS`, but most of those actions are inert. When pressed, they fall to the `default:` branch of `dispatchKey` and show a "— not yet available" toast. The overlay should show the player which keys work.

1. `keyboard.ts`: just above `createShortcutsOverlay`, add:
```ts
/** Actions with a real handler today: the `case`s of dispatchKey plus the
 * colony cycler (task 12n; the other cyclers only toast "No <x> yet"). */
export const IMPLEMENTED_KEY_ACTIONS: ReadonlySet<string> = new Set([
    'togglePause', 'speedUp', 'speedDown',
    'zoomIn', 'zoomOut', 'zoomToSelection',
    'zoomSystemLevel', 'zoomSectorLevel', 'zoomGalaxyLevel', 'zoomPlanetLevel',
    'scrollUp', 'scrollDown', 'scrollLeft', 'scrollRight',
    'galaxyMap', 'messageHistoryScreen', 'empireSummaryScreen', 'coloniesScreen',
    'gameMenu', 'galactopediaHelp',
    'cycleColonies', 'cycleColoniesBackward', 'cycleColoniesMoveView',
]);

/** True when pressing the binding's key does something today. Pure. */
export function isKeyActionAvailable(action: string): boolean {
    return IMPLEMENTED_KEY_ACTIONS.has(action);
}
```
   First read the `switch` in `dispatchKey`. Make sure every non-default `case` label appears in the set. If a `case` exists that is not listed above, add it to the set.
2. `createShortcutsOverlay` row loop:
   - When `!isKeyActionAvailable(b.action)`, add the class `hud-keyboard-row-unavailable` to the row.
   - For those rows, append a third span after the description: `className = 'hud-keyboard-tag'`, `textContent = 'not yet available'`.
   - Available rows are unchanged.
   - Keep the row order (it is the original's table order).
3. `hud.css`, after `.hud-keyboard-key`:
```css
.hud-keyboard-row-unavailable { opacity: 0.45; }
.hud-keyboard-tag {
    flex: 0 0 auto;
    font-size: 10px;
    color: #9aa3ad;
    white-space: nowrap;
}
```
4. Tests in `test/keyboard.test.ts` (no jsdom; add `IMPLEMENTED_KEY_ACTIONS` and `isKeyActionAvailable` to the existing import):
   - `isKeyActionAvailable('togglePause')`, `('coloniesScreen')` and `('cycleColoniesMoveView')` are true;
   - `isKeyActionAvailable('researchScreen')`, `('cycleFleets')`, `('commandRefuel')` and `('nonsense')` are false;
   - every action in `IMPLEMENTED_KEY_ACTIONS` appears as some `KEY_BINDINGS[i].action` (this catches typos);
   - `dispatchKey` with `{ key: 'F7', ctrlKey: false, altKey: false, shiftKey: false, target: null }` and `{}` handlers returns `'researchScreen'`, and that action is not available. This confirms that unavailable actions really fall through to the default branch.

Run `npm run typecheck` && `npm test`, then append `## Worker report`.
