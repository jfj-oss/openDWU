# Task 12i — Message History panel (H key / ticker click)

thinking: off
scope: locked

Create `src/ui/screens/messageHistory.ts` + `messageHistory.css`. Edit `src/ui/hud.ts` (message-ticker section ~line 866 only, plus one click listener), `src/ui/keyboard.ts` (the H binding only), and tests. Start editing right away.

1. `hud.ts`: next to the 5-line `hudMessages` ticker buffer, keep a full history: `let hudMessageHistory: { text: string; at: string }[]`, capped at 500 entries (drop the oldest).
   - `pushHudMessage` also appends to it. `at` is an optional second parameter `at?: string`; main.ts will pass the game date later. Default it to ''.
   - Export `getHudMessageHistory(): ReadonlyArray<{ text: string; at: string }>`.
   - `clearHudMessages` clears both buffers.
   - Clicking the top-middle message panel (the element whose `.hud-message-line` children are bound in setMessageLineElements) calls `toggleMessageHistory()`.
2. `messageHistory.ts`: `export function toggleMessageHistory(): void` and `export function closeMessageHistory(): void`.
   - Build a panel styled like `src/ui/screens/empiresList.ts`/`.css` (read them and copy the look), titled "Message History" with a × button.
   - List the entries newest first, with the `at` text dim before each message when it is non-empty.
   - Escape closes it (add the keydown listener on open, remove it on close, and `stopPropagation`), the same as empiresList.
   - Export a pure `historyRows(entries)` that returns them newest first, for tests.
3. `keyboard.ts`: in `buildDefaultHandlers`, add a handler for the `messageHistoryScreen` action that calls `toggleMessageHistory()`, plus the matching `case` in `dispatchKey`'s switch. Change the binding description to 'Message History'.
4. Tests (no jsdom):
   - `historyRows` puts the newest first;
   - pushHudMessage adds to getHudMessageHistory, and the history is capped at 500;
   - clearHudMessages empties it.

Run `npm run typecheck` && `npm test`, then append `## Worker report`.

## Worker report

**Files changed:**
- `src/ui/hud.ts` — added `hudMessageHistory` (capped at 500, oldest dropped), exported `HudMessageEntry` and `getHudMessageHistory()`; `pushHudMessage(text, at?)` now records `{ text, at }` (default `at: ''`); `clearHudMessages` clears both buffers; the `lstMessages` panel gets a click listener that calls `toggleMessageHistory()`.
- `src/ui/screens/messageHistory.ts` (new) — `toggleMessageHistory()` / `closeMessageHistory()` build a dark-panel window styled like empiresList ("Message History" title + ✕ button), rows newest first via pure `historyRows(entries)`, dim `at` date before each message when non-empty; Escape closes it (listener added on open, removed on close, with `stopPropagation`). Opening is guarded by `typeof document` so node-based tests stay DOM-free.
- `src/ui/screens/messageHistory.css` (new) — mirrors the empires-list tokens (wrap/window/titlebar/close/body/row).
- `src/ui/keyboard.ts` — `messageHistoryScreen` handler in `buildDefaultHandlers` calls `toggleMessageHistory()`; matching `case` in `dispatchKey`; H binding description changed to 'Message History'.
- `test/hud.test.ts` — new "message history (task 12i)" describe (push records entries with `at`, 500-cap drops oldest, clear empties) and "historyRows" describe (newest first, empty input).
- `test/keyboard.test.ts` — replaced the stale task-12g "unported H" test with one asserting H dispatches to the real handler.

**Done:** all four task items; `npm run typecheck` passes, `npm test` 604/604 pass; headless screenshot saved to `shots/12i-message-history.png` (no console errors printed).

**Left undone:** nothing in scope. main.ts still calls `pushHudMessage(text)` without a date — passing the game date as the second argument is explicitly deferred to a later task per the task file.
