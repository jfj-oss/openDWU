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

## Follow-ups noted 2026-09-25 (afternoon)
- Loader requests 50 files the install lacks (designTemplates/<race>/pirate/planetdestroyer.txt ×45, characters/Mechanoid.txt + Shakturi.txt in two cases): skip them like the C# does (check the C# load path) so the packaged app logs no 404s.
- "Black band across the top 270 px" seen at 1920×1080 in both dev and package (linuxpkg captures shots/pkg-*.png) — verify whether it is the HUD top bar or a layout bug (UI scale?).
- Mac arm64: no .icns icon, no signing/notarization, CFBundleName "dwu", no CrossOver/Whisky/Flatpak install guesses; untested on a Mac.
- 17f design editor: "Only Show Latest Components" filter, picture combo, weapons grid, repair-priority template, multi-select delete.
- purchase: per-row design drop-down (Main.Part2.cs method_630), Advisor Suggest column.
- galaxy.ts private calculateAngleFromCoords negates one branch the C# (Galaxy.6.cs:2737) does not; generation uses it, so fixing it moves createGame pins — do it as its own package with `npm run repin` after 17d/fix4 land (purchasebo agent finding).
- cmdTroops.ts:222 tick-path caller of PurchaseNewBuiltObject (BuiltObject.2.cs:1110) still a TODO — wire it (pins will move; re-pin with reason).
- BaconSettings.txt: the installed file sets `tradeEverything=true` (and other Bacon options); the port keeps the default `false`. The C# reads BaconSettings.txt at start-up (BaconSettings.cs) — load it from /assets/dwu/BaconSettings.txt like the other data files and route every option the sim reads through it (grep the Bacon* readers). Pins may move.
- fix4sim 60-day run: the Quameno Empire's explorers sat idle with no mission (8×8 sectors, seed 1) — investigate the exploration-assignment path for that empire (AI bug?).
- main.ts: the ticker's `view.update()` runs outside the sim try/catch (a render exception still freezes the loop).
- fix7 (2026-09-26): the C# system habitat list excludes the star (Galaxy.6.cs 4611) while the TS list includes it; the exploration searches were fixed but ~50 other direct reads of that list are not audited yet (TODO in galaxy.ts) — audit each reader against the C# (pins may move).
- HUD direction (user, 2026-09-26): popups (messages, advisor suggestions, conversations) must first appear under the top-right empire panel as a compact list of stubs that scrolls through, only a couple visible at a time; the full card/dialog opens on click (package popupstubs).
