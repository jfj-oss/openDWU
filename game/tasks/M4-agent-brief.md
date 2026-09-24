# M4 package agent brief — common rules (read fully before starting)

Used verbatim as the brief for every M4 package agent (waves 1-2). Per-package scope: the package row in
`tasks/M4-plan.md` §3.3 plus the notes in `tasks/HANDOFF-cloud-lane-c-2.md`.

You port one M4 work package of a faithful TypeScript port of the C# game Distant Worlds Universe (DWU).

## Where things are
- Your git worktree: a git worktree of your own (e.g. `../wt/m4<X>`) (the game is in `game/`, node_modules symlinked). Work ONLY there,
  on its local branch `wip/m4<X>`. Commit there as you go. Do NOT push, do NOT touch the main checkout
  or other worktrees. The orchestrator merges your branch.
- C# sources: the C# reference tree (dwu-assets repo: `Customization/DistantWorldsExpanded-main/DistantWorldsExpanded/`)
  (`DistantWorlds.Types/` game model, `BaconDistantWorlds/` Bacon mod overrides — Bacon* classes replace or
  extend base methods and are what actually runs, `DistantWorlds/` UI project).
- The plan: `game/tasks/M4-plan.md` — read §0 (determinism contract), §3.1 (ground rules), §3.2 (file layout),
  your package row in §3.3, and §5. Also skim `game/tasks/HANDOFF-cloud-lane-c-2.md`.
- The tick skeletons are in `game/src/sim/tick/` (M4a). Each C# call inside a DoTasks body is one named entry
  point, stubbed in the owning package's module with `todo('<pkg> <name>')` hit counting (`tick/todo.ts`).

## Porting rules (strict)
1. Port faithfully, statement for statement, same order, same constants. C# numeric semantics: integer
   division / (int) casts → `Math.trunc`, `float` arithmetic → `Math.fround` where the C# uses float fields,
   `List.Sort` → `netSort` (find it in src/sim), `Math.Round` → the banker's-rounding helper if one exists
   (grep) else port one.
2. Every `Galaxy.Rnd` draw becomes a draw on `galaxy.rnd` in exactly the C# call order and with the same
   arguments. Never add, skip or reorder draws. Clock-seeded C# `new Random()` → a Random seeded from the
   galaxy seed (see how existing code does it, e.g. designNames.ts). Never reseed galaxy.rnd.
3. Cite the C# `File.cs:line` above each ported function (and at notable statements).
4. Anything you cannot port (belongs to another package, UI-only, deferred) becomes a precise
   `// TODO(port) M4<pkg>: <what> — <value the C# sees / effect>` and calls that package's existing stub.
   Where the C# would draw Rnd inside an unported callee, add `// RND: <site> not drawn until M4<pkg>`.
   Do not invent behaviour, do not simplify, do not "approximate".
5. Free functions, C# `this` first. No new methods on Empire, Galaxy, BuiltObject, Habitat.
6. File ownership: edit only your package's files (§3.2) and your own field block
   (`// ---- M4<X> fields ... ----`) in empire.ts / galaxy.ts / builtObject.ts / types.ts. If you need a
   cross-package entry point that does not exist, add a stub to the owner's file (minimal, one function) and
   mention it in your report. Do not edit `tick/*.ts` skeletons except to fix a wrong call signature to your
   own entry points (report it). Shared helpers you need that are already ported: import them; if you must
   port a shared helper, put it in your package file and report it.
7. Remove the `todo(...)` hit counter from each entry point you fully port; keep it (or narrow it) for parts
   still stubbed.
8. Tests: add focused tests in `game/test/m4<X>*.test.ts` (unit tests of ported functions against hand-worked
   C# expectations, plus a harness smoke test via `runGameSeconds` from `tick/harness.ts` if relevant).
   Run `npm run typecheck` and `npm test` in `game/` before each commit (full suite ~90 s). All tests must pass.
   Seed pins that move (e.g. `test/tickDeterminism.test.ts` digest, createGame pins): re-pin and write in the
   test comment *why* they moved. List every re-pinned value in your final report.
9. Commit messages: `game: task M4<X> <summary>` ending with the attribution trailer lines the running
   session specifies.
   Never put model names/identifiers in code, comments or commits.
10. Performance: faithful first; but don't write gratuitously quadratic code where the C# isn't.

## Scope management
Your package is large. Prioritise the entry points the tick actually reaches at runtime (check hit counts:
`runGameSeconds(galaxy, 600).todoHits` on a createGame galaxy). Port completely what you port. If you run
out of room, stop at a clean boundary, commit, and list precisely what remains.

## Final report (your last message)
- commits (hashes) on `wip/m4<X>`
- entry points ported (C# file:line → TS function), entry points still stubbed
- cross-package stubs added, skeleton edits, shared helpers ported
- seed pins moved (old → new, why)
- test count before/after, `npm test` result
- open questions / C# oddities found

## Wave-2 notes
- Wave 1 is merged (M4b missions/dispatcher, M4d orders/contracts/freight, M4j colony/treasury, M4k research,
  M4t exploration/territory; M4r diplomacy still in flight in another worktree). Read the M4b report-level
  structure in `src/sim/missions/` first: `mission.ts` (BuiltObjectMission, Command, enums), `assign.ts`
  (assignMission with AssignMissionArgs), `executeCommands.ts` (CommandContext / CommandHandler dispatch
  contract), and the per-package case stub files `missions/cmd*.ts` you fill in.
- If several agents share a machine, run the suite as `npx vitest run --testTimeout=300000 --maxWorkers=2`;
  plain `npm test` can hit 5 s timeouts under load (not a real failure). Run single files while iterating.
- A new worktree needs `game/node_modules` (npm install or symlink) and the gitignored `game/public/assets/dwu`
  link to the dwu-assets checkout, as in the main checkout.
- Before finishing, re-run the full suite once; all must pass.
