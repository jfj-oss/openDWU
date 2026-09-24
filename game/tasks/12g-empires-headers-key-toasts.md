# Task 12g — Empires panel column headers; toast for unported hotkeys

thinking: off
scope: locked

Edit only `src/ui/screens/empiresList.ts`, `src/ui/screens/empiresList.css`, `src/ui/keyboard.ts` and tests. Start editing right away.

1. `empiresList.ts`: add a header row above the empire rows, using the same grid as the rows: (blank swatch column) | "Empire" | "Colonies" | "Capital". Style it in empiresList.css as small, dim uppercase text, like a table header. Right-align the Colonies column in both the header and the rows.
2. `keyboard.ts` `dispatchKey`, in the `default:` branch (~line 236 `console.info(\`TODO(key): ${binding.action}\`)`): also call `showToast(\`${binding.description} — not yet available\`)` from `./toast`. Check toast.ts for the exact signature. Keep the console.info.
   - Some tests call dispatchKey without a DOM, so guard it: `if (typeof document !== 'undefined') showToast(...)`.
3. Tests: keep the existing keyboard tests green (they run without jsdom). No new DOM tests are needed. Add one test showing that dispatchKey for an unported binding (e.g. key 'H' → messageHistoryScreen) returns that action and does not throw without a document.

Run `npm run typecheck` && `npm test`, then append `## Worker report`.
