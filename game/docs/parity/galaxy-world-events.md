# Galaxy / world-level systems parity (DW:U 1.9.5 → TS)

Read-only audit: every method in Galaxy*.cs, Habitat.cs, Creature.cs, HabitatList.cs, PlagueList.cs, GalaxyNebulaeGenerator.cs, GalaxyLocation.cs, GameEvent.cs, VictoryConditionProgress.cs, EmpireTerritory.cs, BaconHabitat.cs, BaconGalaxy.cs and the Start*.cs setup flow, compared with `game/src/sim`.

**Overall:** the core simulation is in very good shape. The galaxy tick and the habitat tick follow the C# statement for statement, and every callee is a real port; no `todo()` stubs are left. All unmentioned Galaxy/Habitat/Creature methods turned out to be dead or empty in the C#. The gaps are concentrated in game options, the story ending, and creature combat bookkeeping.

## A. Ranked gaps

| # | Feature | C# source | Status | Our location | Impact | Notes |
|---|---|---|---|---|---|---|
| 1 | Wizard Difficulty / Aggression / Alien Life / Space Creatures | Galaxy.4.cs 2088 ctor (2137-2152); Start.1.cs 3685-3694; Start.2.cs 494 | PARTIAL (sliders do nothing) | startGameOptions.ts 885-890; game.ts ~918; galaxy.ts 200/250/4718 | High | Sliders shown (newGameWizard.ts 578-591) but dropped: every game runs at difficulty 1.0, aggression 1.0, life 1000, creatures 1.0 |
| 2 | Storyline toggles (Return of the Shakturi, Shadows, Distant Worlds) | Start.2.cs 501-506, 3709; Start.1.cs 3800/3805 | PARTIAL (no UI/plumbing) | startGameOptions.ts 164-168; newGameWizard.ts 1665-1672; game.ts 956-959 | High | All story code is ported but unreachable from the UI |
| 3 | Freedom Alliance climax and story victory | Galaxy.8.cs 2058 GenerateFreedomAlliance; Main.Part4.cs method_572 + story buttons; Galaxy.1.cs 794 DecimateEmpire, 688 GuardiansDepart, 425-478 | MISSING (GuardiansDepart ported, uncalled) | victory.ts 1046-1052 (throws), 1110; empireAbsorb.ts 78; conversationReplies.ts 316-335; storyEvents.ts 671 | High | TargetHabitat never set, so the story victory can't happen |
| 4 | Ship weapons register the firer in `Creature.Attackers` | Weapon.cs 300-304 | PARTIAL (bug) | combat/weapons.ts 219-221 | High | Creatures never react or flee from ship/base fire; only fighters register (fighters.ts 367) |
| 5 | DamageCreature(damager, damage, weapon) + creature-death counters | Creature.cs 926; EmpireCounters.cs 481 | PARTIAL | creature.ts 699-720; victory.ts 725 (never called) | Med-High | Silver Mist takes 1/10 ion damage instead of full; creature-kill victory conditions and achievements never advance |
| 6 | Independent colony discovery report + story clue | BuiltObject.1.cs 2090-2098; Galaxy.1.cs 1314; Galaxy.5.cs 3692 | MISSING (clue generator uncalled) | exploration.ts 701-702 ("UI only"); storyEvents.ts 1156-1176 | Med | Not UI-only: draws Rnd and marks a clue used. Story games lose clues and the random sequence drifts; the discovery message is missing |
| 7 | DestroyedPiratesDoNotRespawn option | Galaxy.9.cs 23-30; Start.2.cs 497; Start.1.cs 3741 | MISSING | pirates.ts 903-907; galaxyTick.ts 159-161 | Med | Pirates always respawn |
| 8 | MaxMoonOrbitSize | Galaxy.3.cs 4979 = 1600 | PARTIAL (1200) | galaxy.ts 80-84 | Med | Deferred; changes every seed's layout |
| 9 | SpawnNewEmpires option | Start.2.cs 116 → Habitat.cs 1502 | PARTIAL (always true) | galaxy.ts 4643; habitatTick.ts 158 | Med-Low | Behaviour ported, option missing |
| 10 | AllowGiantKaltorGeneration / AllowTechTrading options | Start.1.cs 3738; Galaxy.cs 686; Empire.7.cs 2599/2695 | PARTIAL (defaults only) | galaxy.ts 202; tradeItems.ts 175 | Low-Med | |
| 11 | GrowPopulation(TimeSpan.Zero) at colony/capital creation | Galaxy.8.cs 639; Galaxy.7.cs GenerateEmpire; Habitat.cs 5172 | MISSING | colony.ts 61; empireGeneration.ts 139 | Low-Med | Starting population can exceed max until the first tick; no Rnd |
| 12 | Race periodic aggression/caution | Race.cs 350-400 | PARTIAL | researchTick.ts 1020, 1530 | Low | See empire-ai-economy.md gap 4 |
| 13 | New game on an existing galaxy map | Start.2.cs 446-486 | MISSING | gameStartTail.ts 39, ruins.ts 563 | Low-Med | |
| 14 | Bacon delayed event actions | BaconGalaxy.cs 334/339/343 | MISSING (throws) | story/eventActions.ts 1713-1717 | Low | Nothing queues them yet |
| 15 | DesignPirateBase(techLevel 0) | Galaxy.8.cs 2626 | MISSING (throws) | story/storyStart.ts 657 | Low | No caller uses tech 0 |
| 16 | Text-only helpers (GenerateRaceReport, sector text, story victory message) | Galaxy.2.cs; Galaxy.5.cs 4815 | PARTIAL | ownership.ts 1094/1416; victory.ts 242 | Low | |
| 17 | Creature.BirthDate | Creature.cs 326 | PARTIAL (0) | creature.ts 118-119 | Low | Saved only |
| 18 | ReseedRandom on huge ticks | Galaxy.cs 3075-3078, 3088 | Intentional difference | galaxyTick.ts 75-78 | n/a | Determinism contract |
| 19 | Stale TODO notes | — | — | taxes.ts 24; startHabitats.ts 292; ruins.ts 627; galaxy.ts 3660; events.ts 917; assign.ts 218; creature.ts 118; freight.ts 78 | Low | Clean-up |

## B. Fully ported (checked)
- **Ticks:** galaxy tick (Galaxy.cs 3039-3313) and habitat tick (Habitat.cs 1399-1556).
- **Generation:** stars, shapes, clusters, nebulae, black holes, supernovas, gas clouds, planets, moons, asteroids, resources, treasure asteroids (except gap 8); native populations, creatures and alien race regions.
- **Empires and setup:** empires, independent colonies and pirate setup (except gaps 1, 2, 7, 9-11).
- **Locations and stories:** ruins; special zones; debris fields; planet destroyers; story start set-up; Return of the Shakturi runtime (except gap 3); Distant Worlds clues (except gap 6); scripted GameEvents / EventActions.
- **Events:** random, empire and race events; disasters; plagues; resource changes; empire splits.
- **Creatures:** AI and spawning (except gaps 4-5).
- **Colonies:** growth, migration, approval, rebellion, independence, terraforming, development, facilities and wonders; Colony Influence Range and territory; new empires from independents (option missing, gap 9).
- **Victory and difficulty:** super-pirate events; victory/defeat (except the story branch); difficulty factors; achievements (creature counters stuck at 0).

## C. C# methods we never mention (all dead or empty in C#)
GenerateDMZ, GenerateRavagerFleet, WipeoutEmpireMakeColoniesIndependent, RelocatePirateBase, GenerateUnownedShipAtHabitat, SelectPopulationOLD and its helpers, SelectHabitatTypeRaces, SelectAtmosphere, CalculateLifePrevalenceMultiplierFor*, FilterRacesByColonyLimits, SelectRandomRacePreferHospitableHabitats, ResolveRaceWonder, SetupPirateAlliance / CancelPirateAlliance (empty), AssignPirateShipMissions() (no caller), FixResearchParents, SetAllEncounterPenaltiesToZero, CalculateAverage* (covered inline), plus UI and file-I/O helpers. RemoveAsteroidField and GenerateDefaultTroops are editor/UI only.
