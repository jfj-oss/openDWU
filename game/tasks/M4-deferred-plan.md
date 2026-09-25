# M4 follow-up plan — after wave 4 (2026-09-25)

All 21 M4 packages (a–u, s1/s2) are merged. What the M4 plan deferred (§0.3, §3.3 "Deferred") plus the
throws the package agents left behind. Same rules as tasks/M4-agent-brief.md; Opus agents, one worktree each,
`wip/m4z<n>`. Sizes are C# lines.

| id | package | C# scope | size | notes |
|---|---|---|---|---|
| **M4z1** | Teardown & empire lifecycle | Empire.CompleteTeardown (M4u throw; pirate factions eliminated/terminated crash), system-star teardown, InitiateEmpireSplit (M4u/M4q), ColonyGovernor population-growth branch of ReviewCharacterLocation (Empire.7.cs 667-718, MaximumPopulation / DetermineColonizationValue), RemoveDefeatedEmpireRelations end-to-end | ~1,200 | highest priority: a real game reaches all of these |
| **M4z2** | Espionage | Empire.5.cs 4183-6110, Empire.6.cs 21-343 (AssignSpecialMissions, PerformIntelligenceMissions, 12 mission types, counter-intel, prisoner lists), EmpireCounters espionage counters | ~2,300 | currently counted no-ops |
| **M4z3** | Story & scripted events | ShakturiSendConvoy, CheckOfferStoryHint, CheckSendShipConvoysViaGateway (real), ProcessDelayedEventActions → ExecuteEventAction (Galaxy.9.cs 1503-2860), the five storylines' triggers | ~2,000 | throw-only-when-enabled stubs today |
| **M4z4** | Victory, achievements, stats | CheckVictoryConditions (all 60 race conditions + galaxy defend/target habitat), ReviewAchievements/UpdateAchievements (no Steam), SpaceBattleStats reporting, stats XML | ~1,500 | M4m reads victory habitats as null |
| **M4z5** | Super pirates & planet destroyers runtime | DoSuperPirateTasks, planet-destroyer firing/targeting runtime beyond generation, DoPlanetDestroy* | ~1,000 | generation exists |
| **M4z6** | Pirate-control readers & C# leftovers | Habitat.cs 3654/3817/4158/4709/6549 pirate-control readers not wired; damage.ts bombardment facility-type comparison by name (pirate-facility branch never runs); Weapon.lastFired MinValue (check landed); stellarFirepowerRaw returns 0 for fighters | ~300 | small, do first alongside z1 |

Then, before M5+ (UI completeness etc.):
- **Soak/perf pass** (plan §5.3.7): `SIM_SOAK=1` 1,400 stars / 20 empires / 30 game-min, ms per subsystem, TODO
  hits; fix O(n²) hot spots without changing behaviour (index grids, threat cache).
- **Code review** of the merged M4 tree by an Opus reviewer: cross-package duplicates left after the merges,
  registered save classes vs model classes, RND notes vs actual draws.
- **Invariant tests** (plan §5.3.5) run after every harness test.
