# Task 12j — Empire Summary panel (F6)

thinking: off
scope: locked

Create `src/ui/screens/empireSummary.ts` + `empireSummary.css`. Edit `src/ui/keyboard.ts` (the F6 action only), `src/ui/hud.ts` (one registration line in createHud), and tests. Do not edit src/sim or main.ts. Start editing right away.

Streamlined HUD, not 1:1. Build a compact panel like `src/ui/screens/empiresList.ts`/`.css`: read them and copy the look, the × close, the Escape-closes behaviour (with stopPropagation), and the toggle API.

1. `empireSummary.ts`:
```ts
export interface EmpireSummarySource { empire: Empire; governmentName: string | null }
export function setEmpireSummarySource(get: (() => EmpireSummarySource | null) | null): void;
export function toggleEmpireSummary(): void;   // no-op when no source is set
export function closeEmpireSummary(): void;
export function empireSummaryRows(src: EmpireSummarySource): { label: string; value: string }[];  // pure, tested
```
   `empireSummaryRows` returns rows in this order:
   - Empire: `empire.name`
   - Race: `empire.dominantRace?.name ?? '—'`
   - Government: `governmentName ?? '—'`
   - Capital: `empire.capital?.name ?? '—'`
   - Colonies: `String(empire.colonies.length)`
   - Population: the sum of `colony.population.totalAmount` over `empire.colonies` (treat a missing population as 0), formatted with `formatPopulation` from `../hud`
   - Treasury: `formatMoney(empire.stateMoney)` from `../hud`

   The panel title is "Empire Summary". Render the rows as a two-column grid, with the label dim and the value right-aligned.
2. `hud.ts` createHud: when `wiring.game` is set, call `setEmpireSummarySource(() => ({ empire: wiring.game.playerEmpire as Empire, governmentName: wiring.gameData?.governments[(wiring.game.playerEmpire as Empire).governmentId]?.name ?? null }))`.
   - Check the real field names and types in HudWiring. Guard with a cast where HudWiring's game type is narrower.
   - If `gameData` is not on HudWiring, pass `governmentName: null`.
3. `keyboard.ts`: add a handler for `empireSummaryScreen` that calls `toggleEmpireSummary()`, plus the matching `case` in dispatchKey. Change the description to 'Empire Summary'.
4. Tests (no jsdom), for `empireSummaryRows` with a hand-built fake empire object (cast `as unknown as Empire`):
   - the row order and labels;
   - the population sum;
   - '—' for a missing race, government and capital.

Run `npm run typecheck` && `npm test`, then append `## Worker report`.

## Worker report

Files changed:
- `src/ui/screens/empireSummary.ts` (new) — panel module: `EmpireSummarySource`, pure `empireSummaryRows` (rows in order Empire/Race/Government/Capital/Colonies/Population/Treasury, '—' for missing race/government/capital, population = sum of `colony.population.totalAmount` over colonies with missing treated as 0, formatted via `formatPopulation`/`formatMoney` from `../hud`), plus `setEmpireSummarySource` / `toggleEmpireSummary` (no-op when no source is set or returns null; guarded for node) / `closeEmpireSummary`. DOM follows empiresList/messageHistory: fixed wrap, dark window, "Empire Summary" title, ✕ close button, Escape closes with stopPropagation.
- `src/ui/screens/empireSummary.css` (new) — two-column grid rows (dim label left, right-aligned value right), same tokens as empiresList.css.
- `src/ui/hud.ts` — one registration block in `createHud`: when `wiring.game` is set, calls `setEmpireSummarySource(() => ({ empire: wiring.game.playerEmpire as Empire, governmentName: wiring.gameData?.governments[(...playerEmpire as Empire).governmentId]?.name ?? null }))`. HudWiring does have `gameData?: GameData` (with `governments: Government[]`), so the real name lookup is used; cast where the narrow `game` type requires it.
- `src/ui/keyboard.ts` — F6 description changed to 'Empire Summary'; added `case 'empireSummaryScreen'` in dispatchKey calling `toggleEmpireSummary()` directly (module-level, like galactopediaHelp); added an `empireSummaryScreen?` slot to KeyHandlers for completeness.
- `test/empireSummary.test.ts` (new) — node-based tests for `empireSummaryRows` with hand-built fakes (`as unknown as Empire`): row order/labels/values, population sum (incl. a colony with missing population counting as 0 → '400M'), and '—' for missing race/government/capital.

Done: everything in the task. `npm run typecheck` passes; `npm test` — 52 files, 607 tests, all pass.

Left undone: nothing within scope. The panel is static at open time (it reads the source once on toggle, not live-refreshed like the money panel); the original's full statistics screen (cashflow, bonuses, per-colony breakdowns) remains out of scope by design.
