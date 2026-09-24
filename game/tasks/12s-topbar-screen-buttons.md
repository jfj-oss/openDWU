# Task 12s — Top-bar buttons open the screens that already exist

thinking: off
scope: locked

Edit only `src/ui/hud.ts` (`buildTopBarButton` ~line 465, its one caller in `createHud` ~line 251, the imports, and one new exported function), and create `test/hudTopBar.test.ts`. Do NOT edit keyboard.ts, hud.css, main.ts or anything under src/sim/. Start editing right away.

Three top-bar buttons have a working screen already, but a click only shows the "— not yet available" toast. The screens are reachable today by hotkey: F2 Colonies (task 12m), F6 Empire Summary (12j), and H Message History (12i). In the original, each button toggles its panel:

Main.Part9.cs:3093
```cs
private void tbtnColonies_Click(object sender, EventArgs e)
{ if (pnlColonyInfo.Visible) { method_186(); } else { method_166(null); } }
```
Main.Part8.cs:1320
```cs
private void btnEmpireSummary_Click(object sender, EventArgs e)
{ if (pnlEmpireSummary.Visible) { method_275(); } else { method_274(); } }
```
Main.Part4.cs:2016
```cs
private void btnHistoryMessages_Click(object sender, EventArgs e)
{ if (pnlMessageHistory.Visible) { method_529(); } else { method_528("either"); } }
```

1. `hud.ts`: add a pure, exported function, placed just above `buildTopBarButton`:
```ts
export type TopBarScreen = 'colonies' | 'empireSummary' | 'messageHistory';
/** Top-bar control → the existing screen it toggles (task 12s), or null. */
export function topBarScreen(name: string): TopBarScreen | null;
```
   It maps `tbtnColonies`→'colonies', `btnEmpireSummary`→'empireSummary' and `btnHistoryMessages`→'messageHistory'. Every other name returns null. `btnGalacticHistory` also returns null: it is a different screen, not the message history.
2. Change `buildTopBarButton(name: string)` to `buildTopBarButton(name: string, wiring: HudWiring)`, and pass `wiring` at the call site in `createHud`. In its click listener, keep `playUiClick()`. Then:
   - `'colonies'`:
     - `const src = getEmpireSummarySource(); if (!src) return;`
     - Call `toggleColoniesList({ empire: src.empire, onZoomTo: ... })`.
     - `onZoomTo` uses the same camera calls as the Empires button's `onZoomTo` in `buildEmpireFlagButton`: guard `wiring.camera`, then `cam.centerOn(h.xpos, h.ypos); cam.zoomAt(SYSTEM_LEVEL_ZOOM, cam.width / 2, cam.height / 2);`.
   - `'empireSummary'`: `toggleEmpireSummary()`.
   - `'messageHistory'`: `toggleMessageHistory()`.
   - null: the existing `console.log('TODO(screen): …')` + `showToast(… — not yet available)`, unchanged.
   - Imports: `toggleColoniesList` from `./screens/coloniesList`, and `toggleEmpireSummary` + `getEmpireSummarySource` from `./screens/empireSummary`. Merge them with the existing `setEmpireSummarySource` import. `toggleMessageHistory` is already imported.
3. Keep the `// TODO(screen)` comment. Reword it to say that only the unmapped controls still toast.
4. `test/hudTopBar.test.ts` (no jsdom), for `topBarScreen`:
   - the three mapped names;
   - `btnGalacticHistory`, `tbtnResearch` and `'nonsense'` → null;
   - every non-null result comes from a name in `TOP_BAR_BUTTONS` (import it from `../src/ui/hudLayout`).

Run `npm run typecheck` && `npm test`, then append `## Worker report`.

## Worker report

Files changed:
- `src/ui/hud.ts` — added exported `TopBarScreen` type + pure `topBarScreen(name)` mapping (placed just above `buildTopBarButton`); changed `buildTopBarButton(name)` → `buildTopBarButton(name, wiring)` with the click listener now toggling Colonies (`toggleColoniesList` via `getEmpireSummarySource()`, camera-guarded `onZoomTo` mirroring the Empires button), Empire Summary (`toggleEmpireSummary()`), or Message History (`toggleMessageHistory()`), falling back to the existing TODO log + "not yet available" toast for unmapped controls; updated the `// TODO(screen)` comment to note only unmapped controls still toast; merged imports of `toggleColoniesList` and `toggleEmpireSummary`/`getEmpireSummarySource`; passed `wiring` at the `createHud` call site.
- `test/hudTopBar.test.ts` (new) — no-jsdom tests for `topBarScreen`: the three mapped names, `btnGalacticHistory`/`tbtnResearch`/`'nonsense'` → null, and that every non-null result comes from a name in `TOP_BAR_BUTTONS`.

Done: all task items 1–4. `npm run typecheck` passes; `npm test` passes (56 files, 641 tests).

Left undone: nothing within scope. Screens not yet ported (e.g. Galactic History, Research, Designs) still show the "not yet available" toast by design.
