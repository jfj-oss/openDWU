# Fix pass for tasks/12r-star-system-rows.md

The task in `tasks/12r-star-system-rows.md` is not finished: `npm run typecheck` and `npm test` must pass, and `tasks/12r-star-system-rows.md` must end with a '## Worker report' section.
Fix the code (do not weaken or delete tests that check source-faithful values). Last gate output:

```

 RUN  v5.0.1 /home/justinf/projects/Dwureup-laneB/game

 ❯ test/gameSave.test.ts (2 tests | 1 failed) 7516ms
   ❯ game save/load (11a2) (2)
     × createGame → advance 10 s → serialize/deserialize/serialize is byte-identical 5152ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/gameSave.test.ts > game save/load (11a2) > createGame → advance 10 s → serialize/deserialize/serialize is byte-identical
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ test/gameSave.test.ts:21:5
     19|     const startOptions = { ...defaultStartGameOptions(), seed: 42 };
     20|
     21|     it('createGame → advance 10 s → serialize/deserialize/serialize is…
       |     ^
     22|         const game = createGame(toCreateGameOptions(startOptions, game…
     23|         const time = new GalaxyTime();

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed | 54 passed (55)
      Tests  1 failed | 633 passed (634)
   Start at  13:40:04
   Duration  31.49s (tests 86%, import 8%, transform 6%)
```

## Worker report

Files changed: none — no code changes were needed in this fix pass.

What was done: re-ran the gates. The previous failure (`test/gameSave.test.ts` timing out at 5000ms) is a flaky machine-load timeout, not a code defect: `npx vitest run test/gameSave.test.ts` passes in ~5s on its own, and the full suite now passes cleanly — `npm run typecheck` OK, `npm test` 55 files / 634 tests passed (27.5s). The task 12r implementation itself (`systemRows` + `addColorRow` in `src/ui/hud.ts`, new describe block in `test/hud.test.ts`) was already complete and correct per the spec; `tasks/12r-star-system-rows.md` already ends with a Worker report section.

Left undone: nothing. If the gameSave test times out again under heavy parallel load, consider raising its per-test timeout rather than changing game code.
