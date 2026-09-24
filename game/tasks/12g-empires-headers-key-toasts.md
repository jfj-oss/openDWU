# Task 12g — Empires panel column headers; toast for unported hotkeys

thinking: off
scope: locked

Edit only `src/ui/screens/empiresList.ts`, `src/ui/screens/empiresList.css`, `src/ui/keyboard.ts` and tests. Start editing right away.

1. `empiresList.ts`: add a header row above the empire rows, using the same grid as the rows: (blank swatch column) | "Empire" | "Colonies" | "Capital". Style it in empiresList.css as small, dim uppercase text, like a table header. Right-align the Colonies column in both the header and the rows.
2. `keyboard.ts` `dispatchKey`, in the `default:` branch (~line 236 `console.info(\`TODO(key): ${binding.action}\`)`): also call `showToast(\`${binding.description} — not yet available\`)` from `./toast`. Check toast.ts for the exact signature. Keep the console.info.
   - Some tests call dispatchKey without a DOM, so guard it: `if (typeof document !== 'undefined') showToast(...)`.
3. Tests: keep the existing keyboard tests green (they run without jsdom). No new DOM tests are needed. Add one test showing that dispatchKey for an unported binding (e.g. key 'H' → messageHistoryScreen) returns that action and does not throw without a document.

Run `npm run typecheck` && `npm test`, then append `## Worker report`.

## Worker report

Files changed:
- `src/ui/keyboard.ts` — imported `showToast` from `./toast`; in `dispatchKey`'s `default:` branch, after the existing `console.info`, now calls `showToast(\`${binding.description} — not yet available\`)` guarded by `typeof document !== 'undefined'` (node-based tests have no DOM).
- `src/ui/screens/empiresList.ts` — added a header row above the empire rows using the same grid as the rows: blank swatch column | "Empire" | "Colonies" | "Capital" (classes `empires-list-header*`).
- `src/ui/screens/empiresList.css` — styled `.empires-list-header` with the row grid (`12px minmax(0,1fr) 2.5em minmax(0,1fr)`); header cells are small (10px), dim (#777), uppercase; Colonies right-aligned in both header and rows.
- `test/keyboard.test.ts` — added a test that `dispatchKey` for key 'H' (unported `messageHistoryScreen`) returns the action id without throwing in a DOM-less environment.

Done: all three task items. `npm run typecheck` and `npm test` both pass (597 tests).

Left undone: nothing. No visual screenshot taken (task is DOM/CSS-only; per CLAUDE.md the orchestrator reviews visuals).
