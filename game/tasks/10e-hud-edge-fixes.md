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
