# Fix pass for tasks/04c-fix-loader-alignment.md

The task in `tasks/04c-fix-loader-alignment.md` is not finished: `npm run typecheck` and `npm test` must pass, and `tasks/04c-fix-loader-alignment.md` must end with a '## Worker report' section.
Fix the code (do not weaken or delete tests that check source-faithful values). Last gate output:

```
Received: "Allows the training of elite troops at a colony,giving them 50% greater strength than normal"

 ❯ test/data-content.test.ts:346:39
    344|                 expect(f.value2).toBe(0);
    345|                 expect(f.value3).toBe(0);
    346|                 expect(f.description).toBe(
       |                                       ^
    347|                     'Allows the training of elite troops at a colony, …
    348|                 );

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/4]⎯

 FAIL  test/data-content.test.ts > data-content.test.ts > exact values — first two records > facilities.txt > second facility (Robotic Troop Foundry) matches raw line
AssertionError: expected 'Manufactures robotic troops at a colo…' to be 'Manufactures robotic troops at a colo…' // Object.is equality

Expected: "Manufactures robotic troops at a colony. Robotic troops are not especially strong, but can be manufactured quickly, and have one quarter the normal maintenance costs"
Received: "Manufactures robotic troops at a colony. Robotic troops are not especially strong,but can be manufactured quickly,and have one quarter the normal maintenance costs"

 ❯ test/data-content.test.ts:364:39
    362|                 expect(f.value2).toBe(0);
    363|                 expect(f.value3).toBe(0);
    364|                 expect(f.description).toBe(
       |                                       ^
    365|                     'Manufactures robotic troops at a colony. Robotic …
    366|                 );

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/4]⎯

 FAIL  test/data-content.test.ts > data-content.test.ts > exact values — first two records > plagues.txt > first plague (Hekretos Fever) matches raw line
AssertionError: expected 'Hekretos Fever is a deadly infection …' to be 'Hekretos Fever is a deadly infection …' // Object.is equality

Expected: "Hekretos Fever is a deadly infection that attacks the internal organs, causing rapid degeneration and death. An outbreak of Hekretos Fever typically lasts about 3 months."
Received: "Hekretos Fever is a deadly infection that attacks the internal organs,causing rapid degeneration and death. An outbreak of Hekretos Fever typically lasts about 3 months."

 ❯ test/data-content.test.ts:387:39
    385|                 expect(p.exceptionDuration).toBe(0);
    386|                 expect(p.specialFunctionCode).toBe(0);
    387|                 expect(p.description).toBe(
       |                                       ^
    388|                     'Hekretos Fever is a deadly infection that attacks…
    389|                 );

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/4]⎯

 FAIL  test/data-content.test.ts > data-content.test.ts > exact values — first two records > plagues.txt > second plague (Dekara Virus) matches raw line
AssertionError: expected 'Dekara Virus is a very painful diseas…' to be 'Dekara Virus is a very painful diseas…' // Object.is equality

Expected: "Dekara Virus is a very painful disease that slowly cripples the central nervous system of any creature it infects, ultimately leading to death. An outbreak of Dekara Virus typically lasts about 6 months."
Received: "Dekara Virus is a very painful disease that slowly cripples the central nervous system of any creature it infects,ultimately leading to death. An outbreak of Dekara Virus typically lasts about 6 months."

 ❯ test/data-content.test.ts:408:39


⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/4]⎯


 Test Files  1 failed | 3 passed (4)
      Tests  4 failed | 74 passed (78)
   Start at  17:19:53
   Duration  2.57s (tests 88%, transform 10%, import 1%)
```

## Worker report

**Root cause:** the C# loaders (`PlanetaryFacilityDefinitionList.cs` LoadFromFile line 33, `PlagueList.cs` LoadFromFile line 53) read the Description field as the *raw remainder of the line* after the last fixed field's comma, with a single `Trim()` — so the space following a comma inside the description text is preserved. The TS loaders instead did `line.split(',')` + per-part `trim()` and re-joined the remainder with `','`, which dropped the space after commas inside descriptions (`"colony,giving"` instead of `"colony, giving"`).

**Files changed:**
- `src/sim/data/facilities.ts` — `parseFacilities`: description is now `line.slice(descriptionComma + 1).trim()` where `descriptionComma` is the position of the 10th comma (after Value3), matching the C# `str1.Substring(startIndex11, len - startIndex11).Trim()`. Lines lacking that comma are skipped (C# throws; the TS loader's established style is to skip bad lines).
- `src/sim/data/plagues.ts` — `parsePlagues`: same fix, description taken after the 13th comma (after SpecialFunctionCode).

**Done:** `npm run typecheck` passes; `npm test` passes (4 files, 78/78 tests, including the four previously failing exact-value description assertions). No tests were weakened or deleted.

**Left undone:** nothing for this fix pass.
