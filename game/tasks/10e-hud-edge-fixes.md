# Task 10e — HUD edge/clipping fixes

thinking: off
scope: locked

Edit `src/ui/hud.css`, `src/ui/hud.ts`, `src/ui/hudLayout.ts`, tests. Start editing right away. Do not Read image files.

From a 1600×900 screenshot:
1. The top-right money panel extends past the right screen edge — its values (e.g. `19,500`) are cut off at x=1600. Anchor it with `right: 10px` (not a computed `left`), width 230px, values right-aligned inside with 12px padding.
2. The bottom-right options list also touches/overflows the right edge — same fix (`right: 10px`).
3. The message list text (top-middle) is tiny and cramped: use 12px, line-height 18px, left padding 12px, and truncate long lines with ellipsis.
4. Test: `computeHudLayout(1600, 900)` / `(1920,1080)` — every rect satisfies `x >= 0 && x + w <= width` (right-anchored panels computed accordingly).
`npm run typecheck` && `npm test`; save (don't open) `shots/10e-hud.png` with `?autostart=1` at 1600×900. Append `## Worker report`.

## Worker report

**Files changed**
- `src/ui/hud.ts` — `createHud` and `layoutHud` now right-anchor `pnlMoney` and `pnlOptionsList` via `style.right = window.innerWidth - rect.x - rect.w` (clearing `left`) instead of a computed `left`, so the panels can never clip past the screen edge.
- `src/ui/hud.css` — `.hud-message-line`: 12px font, 18px line height, 12px left padding, ellipsis truncation; new `.hud-money { padding: 12px }` and `.hud-money-row .hud-value` right-aligned with ellipsis.
- `src/ui/hudLayout.ts` — comments updated to describe the right-anchored money/options panels (rect values unchanged: they already satisfy `x + w = width - 10`).
- `test/hudLayout.test.ts` — added 1600×900 to the size loop; asserts `pnlMoney` / `pnlOptionsList` right edges equal `width - 10`; new test asserting every rect satisfies `x >= 0 && x + w <= width` (and vertical bounds) at both 1600×900 and 1920×1080.

**Done**
1. Money panel right-anchored (`right: 10px`), width 230px, values right-aligned with 12px padding.
2. Options list right-anchored the same way.
3. Message list text: 12px / line-height 18px / 12px left padding / ellipsis.
4. Layout tests pass for 1600×900 and 1920×1080 (all rects inside the screen).
5. `npm run typecheck` passes; `npm test` — 462/462 pass (40 files).
6. Screenshot saved to `shots/10e-hud.png` (1600×900, `?autostart=1`); console output showed only Vite connect logs, no errors.

**Left undone** — nothing.
