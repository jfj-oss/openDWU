# UI screen agent brief (generic — replaces per-screen locked specs for Opus implementers)

You port ONE screen of Distant Worlds: Universe into this TypeScript + PixiJS recreation. Read `CLAUDE.md` first.

## Where things are
- Your git worktree: `~/wt/<name>` (game dir `~/wt/<name>/game`), branch `wip/<name>`; node_modules and
  `public/assets/dwu` are linked. Work only there; do not push; the orchestrator merges.
- C# UI project: `$DWU/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/DistantWorlds/`
  (`Main.Part*.cs`, `Controls/*.cs`, `*View.cs`). The screen's C# file(s) are named in your task paragraph.
- Sim model (read-only for you): `src/sim/**`. Never edit it; import only. If the screen needs a player-side
  action the sim has no function for, make the screen read-only there and leave
  `// TODO(port): <what> — <C# file:method>` naming the C# call.
- House style: `src/ui/screens/empiresList.ts`, `coloniesList.ts`, `diplomacyScreen.ts`, `researchScreen.ts`
  (+ their .css). Streamlined, not 1:1: compact panels, the original's data and rules, not its chrome.
- Hooks: one clearly delimited block per screen in `src/ui/keyboard.ts` (the binding's `case` + handler),
  `src/ui/hud.ts` (top-bar button if the original has one) and `src/main.ts` (close on teardown), each wrapped in
  `// [<name>] begin` … `// [<name>] end` markers with at least one unchanged line between neighbouring hooks.

## Rules
1. Faithful data and rules: every number/column/sort/threshold comes from the C# with a `File.cs:line` cite above the
   function that ports it. Don't invent mechanics; don't reformat sim data beyond what the original displays.
2. Pure logic (row building, sorting, formatting) lives in exported functions with unit tests (vitest has NO jsdom);
   DOM code only wires them.
3. Escape closes the panel (document keydown, `stopImmediatePropagation`); all timers/listeners are removed on close
   and on game teardown; refresh in place (do not rebuild DOM that holds focus/buttons every tick).
4. Verify in the real app: dev server on a free port (not 5173/5175), `?autostart=1`, unpause and let the sim run a
   little, open the screen, `node scripts/shot.mjs '<url>' shots/<name>.png 12000 1920 1080 2`, Read the capture,
   check the console for errors. Describe what the capture shows in your report.
5. Before finishing: `git merge` the main branch (`claude/deepseekharnessworkspace-distant-worlds-dekdzh` in
   `/home/justinf/projects/Dwureup`) into your branch and resolve conflicts yourself; then
   `npm run typecheck` (0 errors), `npx vitest run --testTimeout=300000 --maxWorkers=2` (exit 0; use `npm run test:fast`
   while iterating if it exists), `npm run smoke` if you touched main.ts.
6. Commit with `git -c user.name=dev -c user.email=dev@local commit`, message `game: <name> <summary>`, trailers
   `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and
   `Claude-Session: https://claude.ai/code/session_01JMNY5RcbJwx2upDy6tuKLr`. Never put model names in code.

## Report (last message, under 250 words)
commit hash; files; what the capture shows; C# → TS functions ported; anything left read-only with its TODO(port).
