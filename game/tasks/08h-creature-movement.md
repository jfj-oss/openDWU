# Task 08h — Creature constructor fix + movement/AI tick

thinking: off
scope: locked

Edit `src/sim/creature.ts`, `src/sim/galaxy.ts` (small additions only) and tests.

## Bugs / gaps
1. `Creature` ctor per-species stats are placeholders (review §01f3), and the ctor skips every C# `Rnd` call (`SelectRandomHeading`, the surface-point roll when offsets are the -2000000001 sentinel, `Rnd.Next(1,30)` touch offset, `Size` roll, DesertSpaceSlug re-roll), so the galaxy Rnd stream after the first creature spawn doesn't match the original.
2. Creatures never move (`TODO(port): creature movement/AI tick`).

## Source (read these; C# `DistantWorlds.Types/`)
- `Creature.cs 297-491` ctor (3-, 5- and 7-arg), `493 SelectName` (English text: "Giant Kaltor", "Space Slug", "Sand Slug", "Ardilus", "SilverMist"; format "{0} of {1}"; RockSpaceSlug on an asteroid appends " Asteroid Field").
- `Creature.cs 520-1190` Heal, DoTasks (3 s / 10 s / 30 s touch buckets), CheckFixNotInSystem, ChooseAction, heading/turn, AccelerateToTargetSpeed, Hide/Show, InitiateWander, Split, Reproduce, DamageCreature, CompleteTeardown, Move, CheckWhetherArrived, parent offsets.
- `Creature.cs 1609-1690` ApplyLocationEffects / DoLocationEffects.
- Galaxy helpers: `Galaxy.cs 2795 SelectRandomHeading` (float), `Galaxy.6.cs 3750 SelectHyperJumpExitPoint`, `3762 SelectRelativePoint`, `3770 SelectRelativeHabitatSurfacePoint`, `3011 GenerateDistanceOrderedSystemList`, `3648 FastFindNearestSystem` (sector search that returns the nearest system; a linear scan gives the same result), `Galaxy.7.cs 569 ConditionCheckLimit`, `4308 DetermineAngle`, `Galaxy.cs 1333 GetNextCreatureID`, `Galaxy.3.cs 4971-4972 HyperJumpThreshhold = 12000, BaseHyperJumpAccuracy = 3000`.

## Scope limits
No BuiltObjects/empires exist yet, so `CurrentTarget` stays null and `Attackers` stays empty: CheckForAttackers, CheckForTargets/ScanForTarget, AttackTarget/DamageTarget and FleeFromAttacker become `TODO(port)` no-ops. Neither branch consumes Rnd when there is no target. DateTime is modeled as game seconds (`Galaxy.currentTimeSeconds`, advanced by `step`). `BirthDate` → TODO (no star date on Galaxy). The C# UI drives `DoTasks` for creatures in the viewed system (Main.Part11.cs 597). Here `Galaxy.step` calls `DoTasks` for every creature, in `galaxy.creatures` order, after orbits.

## Tests
Ctor stats per species (ranges from the C# switch); names; creatures move after stepping 60 s of game time; creatures stay within galaxy bounds for 10 min; a SilverMist split and a Kaltor reproduce through direct calls; deterministic across two runs; existing 01f3 tests still pass (pins may shift because the ctor now consumes Rnd, so update them).

## Worker report (cloud)
- `creature.ts` rewritten: faithful ctor (Rnd order: GetNextCreatureID, SelectRandomHeading, surface point if the offsets are the sentinel, Rnd.Next(1,30), per-species Size, DesertSpaceSlug re-roll), real per-species stats and names, and DoTasks with Move / heading / acceleration / arrival / hyperjump countdown and exit / ChooseAction / InitiateWander (Kaltor, SilverMist, Ardilus, anchor point) / Heal / Split / Reproduce / CheckFixNotInSystem / location effects / DamageCreature / CompleteTeardown. Combat branches are TODO(port) (no BuiltObjects).
- `galaxy.ts`: currentTimeSeconds, nextCreatureId, silverMistCreatureCount, getNextCreatureID, selectRandomHeading, selectRelativePoint, selectRelativeHabitatSurfacePoint, selectHyperJumpExitPoint, fastFindNearestSystem, generateDistanceOrderedSystemList, systemHabitatsOf; `step` runs creature DoTasks after orbits.
- The galaxy Rnd stream now shifts after the first creature (it now matches C#). Only the spiral-density statistical test needed a new seed (555 → 7).
- `test/creatureMovement.test.ts`: 7 tests. Typecheck clean; 225/225 pass. `shots/08h.png` boots with no console errors (clock starts paused).
