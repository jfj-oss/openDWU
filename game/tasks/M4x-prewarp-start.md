# Task M4x — Pre-warp start wiring and galaxy starting age (small, post-wave-3)

Agent brief: same porting rules as tasks/M4-agent-brief.md (C# file:line cites, no invented behaviour). Own git worktree,
branch `wip/m4x`. Commit trailer: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Run the suite as
`npx vitest run --testTimeout=300000 --maxWorkers=2`.

Findings from a read-only investigation (2026-09-24) against the C#:

1. **"Pre-warp" in the C# is tech level 0 (no space port, no ships), not galaxy age 0.**
   Start.2.cs 1146 / 1308 / 1314 / 1367 gate the starting space port and ships on `TechLevel > 0`. The galaxy
   Expansion slider at "pre-warp" only sets `Galaxy.StartingAge` = 0 (Start.1.cs 3710-3714; Galaxy.cs 982 `_Age`).
   TS: `src/sim/startGameOptions.ts` fixes `STARTING_TECH_LEVEL = 0.5` (lines ~582 / ~673) for every start, and
   `src/sim/game.ts` ~703/707 sets `galaxy.startingAge` from `opts.player.age` instead of the galaxy age.
   - Add a proper tech-level input to `StartGameOptions` / the wizard's data (the wizard's galaxy page has the
     Expansion / era control per Start.1.cs — read Start.1.cs 3690-3720 and the wizard code in
     src/ui/screens/newGameWizard.ts to map the original's era choices to `{ galaxyAge, techLevel }` exactly as
     `method_57` (Start.cs ~4302) does). Pre-warp era ⇒ techLevel 0 (and whatever age the C# sets); "Starting" ⇒ age 1,
     tech 0.5 (the default, Main.Part9.cs 2680 `YourEmpireExpansion = 1`).
   - `galaxy.startingAge` must come from the galaxy age (`CreateGameOptions.galaxyAge`), not the player's age.
   - Keep `createGame` at tech 0 working end to end (it already supports it — test/createGameFull.test.ts covers 0.5;
     add a tech-0 case: no space port, no ships, then `runGameSeconds(600)` runs without a TODO throw).
2. **Verify the pre-warp ledger after M4f**: with the age-0 / tech-0.5 mix the state cashflow was negative only
   because `DirectPrivateConstruction` (Empire.6.cs 741, state receives the private purchase price ×
   `privateBuildCostToStateMoney`) was a stub; M4f ported it. Add a harness assertion (age 0, tech 0.5, seed 1, 600 s)
   that state money rises over the run, with the C# cite; if it does not, find out why (report, don't paper over).
3. Do NOT apply BaconSettings.txt overrides (markup 9, cost/size 2, private share 0.3): the port intentionally
   uses the C# class defaults (design.ts ~41-47, forceStructure.ts ~52, retrofit.ts ~19). Leave a one-line note
   there pointing at BaconSettings.txt lines 90/93/156 if it is missing.

Seed pins that move (tech/age handling should not move seed-1 tech-0.5 pins; if they do, say why). Tests + typecheck
green before the final report (commits, files, pins moved, open questions).
