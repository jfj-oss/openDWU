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
- (resolved 2026-09-26, fix8ui) the "black band across the top" is empty space past the galaxy's top edge; the C# draws no backdrop there either (MainView.1.cs:4237) — faithful, not a bug.
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
- Intermittent (2026-09-26 05:50): test/pirates.test.ts "createGame with piratePrevalence > is deterministic across runs" failed once inside a `npm run repin` capture under load (two createGame fingerprints differed); passes alone, cold/warm/off cache, and in a later capture. If it recurs, hunt a load/order-dependent source of nondeterminism (shared gameData mutation across tests in one worker, wall-clock reads, iteration over object keys) — the replay/determinism owner should keep this in mind.
- Ship art marker pixels: the original replaces the pure-blue (engine) and pure-yellow (light) marker pixels with neighbouring colours when caching ship images (BuiltObjectImageCache.cs); builtObjectLayer.ts draws the raw art so the markers show on ships — port the replacement at texture load (ambientfx finding).
- Tractor-beam strike effect: no sim state for it yet (TODO in ambientLayer.ts).
- Save size/time: a 1400-star save is ~139 MB of text and takes 2.3–5.4 s synchronously (leftovers agent, autosave); the C# also pauses with "Saving the Galaxy...", but a compact/binary codec (or streaming serialization off the main thread) would cut both — package it after the core is complete.
- Story-clue texts show a raw "StoryClue3" key (sim text-encoding bug) — fix with the other GameText key leaks.
- todosweep package-later (2026-09-26): Habitat.DoTasks during planet generation (~150 lines + callees, Rnd audit); diplomacy counters (~70); ProcessScienceShips + scheduling (~150); Bacon scientific missions (~130, player UI); loans (~80, player UI); three game options not passed through createGame yet: BaseTechCost, MaximumEmpireAmount, ColonizationRange (wizard → sim). Inventory: tasks/TODO-PORT-INVENTORY-2026-09-26.md.
- todosweep2 leftovers: (closed by empirelifecycle: BaconInitialize SaveStats / ClearShipsAboutToBeDestroyed scheduling incl. Rnd.Next(10,12), baconSettings.ts) the wizard's colonization defaults (enforcement off, 4000) differ from the C# defaults (on, 2 sectors) — match the C# defaults (pins will move).
- (closed 2026-09-26) Soak A6 "slow research": faithful — hand-worked C# research points/costs match the sim to the day (tasks/RESEARCH-PACE-2026-09-26.md, scripts/research-pace.mjs).
- modlayer follow-up: `answerScenarioDecision` applies answers directly; route it through `issuePlayerCommand` (replay/command log) once wip/replay is on main — the determinism contract requires every player-side mutation to be logged.

## 19a follow-up (2026-09-26)
- Rim trader tuning: in a 10-year seed-1 soak no empire gained access to the Concord's rare goods (first contact only in
  years 2–8; the one seller was a pirate faction, which cannot earn access). Import lots, threshold 1500 and tax 3/3/2 are
  in. Needs a balance pass with the freight overlay (19e-9) to see where rim goods actually flow, then: earlier contact
  (Concord explorers / a broadcast), access for empires whose private freighters sell, and a soak that asserts ≥1 access.
  Do it after 19h/19j land (rim herders are the intended steady suppliers). Cheap (Sonnet) once the overlay is in.
  **Done on wip/s19a2 (19a addendum):** contact broadcast at year `rimTraderContactYear` (1), rim-good sales through a
  pirate / independent post credited to the freighter's empire, treasure fleet buying rim goods at foreign ports.
  5-year seed-1 soak (test/rimTraderTreasureSoak.test.ts, @slow): all 3 empires met in year 1, Sol Nation gains access in
  year 4; rim buys 23 (2396 u, 11982 cr) by year 5, fleet 2 voyages / 4 stops, 0 ships lost. Remaining imbalance: most
  rim goods still stay inside each empire (self-flows dominate the freight data); the first voyage takes ~2 years.
- 19d3 follow-up: a 5-year seed-1 soak showed no AI offensive espionage missions at all, so the crisis/stolen-tech
  acceptance counts (DWU_ESPIONAGE_SOAK_STRICT=1, 30 years) are unconfirmed. Check the base AI's mission assignment
  (Empire.*.cs intelligence AI: does it run offensive missions before a threshold of agents/relations?) before tuning 19d3.
- Component cargo (2026-09-26): the 30-year crash (ManufacturingQueue.clear on an in-progress component, reached via
  threatEvaluation → clearPreviousMissionRequirements once ProcureConstructionComponents was ported) is fixed on
  wip/compcargo (ManufacturingQueue.cs Clear 386, CargoList.cs Clone 767, BaconBuiltObjectMission.cs 290-311). Remaining
  component-cargo TODO(port) notes in logistics/freight.ts, contracts.ts, orders.ts are still open (freighters carrying
  components) — cheap follow-up. Re-run the 19d2 30-year soak (DWU_CRISES_SOAK=1) after this merges.

## 10-year headless run, seed 1 (2026-09-26; 700 stars, 10 empires, 6000 game-s, sim-run --stats-days 365 --combat)
Clean: 0 exceptions, 0 NaN, 0 console errors; 19.3 min wall (189 game-days/min, 5× the 36 budget). 4478 battle records,
533 ships/bases destroyed, battles per year rising 177 → 701, 1 war (years 4–6), 0 colonies captured, 51 colonies at
year 10 (1–8 per empire). Follow-ups:
- Perf spike: ms/frame 10.8 / 10.2 at years 8–9 (builtObjects pass), 3.3 at year 10; profile the year-8 chunk.
- Refuel loop: ~8 ships "lowfuel 365d" stuck in Refuel→gas mining station with fuel 0 (Sol Technocracy, Teekan) — a ship
  with 0 fuel cannot reach its refuel target; check Empire refuel-target selection vs range (BaconBuiltObject refuel range).
- Frozen missions ≥90 days: Transport 20, Patrol 17, ExtractResources 5 — audit against C# mission timeouts.
- Wars stay rare (1 in 10 years) and no invasions at all in 10 years; United Dhayut Union sat at 1 colony for 10 years
  (col 1, cashflow +62k): check its colonisation target selection (range/enforcement) — likely the wizard 2-sector limit.
- Attack-message creature name fixed (this branch).
- 10-year run oddity: GalacticNewsNet "S218 Kingdom - Empire Leader killed|Obidar Dokari" is dated day 0 (the S218
  leader died on the first game day; two pirate leaders died the same day 697). Check character death rolls at game start
  (Galaxy.2.cs character events; a day-0 death is unlikely in the C#).
- Audio follow-ups (2026-09-26, from the rim sound package): the ambient bed ignores the effects-volume setting; the
  diplomacy voice-static burst creates a new AudioContext per call and never closes it (leak). Cheap (Sonnet).

## fix10sim audit (2026-09-26): the four 10-year-run anomalies are faithful, no code change
- Refuel "stuck" ships: a 0-fuel ship still moves (CheckFuelHandicap BaconBuiltObject.cs 4651: impulse ×0.90, jump
  ×0.50); the probed ships reached refuel points, were attacked on arrival, fled (BuiltObject.1.cs 1551: no fuel → always
  flee) and retried every ~60 days. CheckForRefuelling 4940 / SetupRefuelling 4774 / range 4856 match.
- Day-0 "Empire Leader killed": ReviewDemoralizingCharacters (Empire.7.cs 319) dismisses a Demoralizing leader whose
  skill total is below Next(15,30); starting leaders have tiny totals; the review runs on frame 1 for ~half the empires
  (Start.2.cs 1344-1350 timers, Empire.1.cs 4219). Faithful (the news wording "killed" is the C#'s).
- Frozen missions: patrols circle stations (200–600 u), miners sit extracting, transports move at 12–17 u/s (the 20k/90d
  metric is too strict); no C# mission timeout exists. ONE real loop: UDU "Wild Aspiration" Build at a gas site 9.2k
  from its planet — MoveTo adds a hyperjump (>4000 both axes, BuiltObject.2.cs 3596), CheckNearTarget cancels it (within
  4000 of the parent, BaconBuiltObject.cs 2578), parent-relative DoMovement resets the wind-up. All three match the C#;
  suspect the parent-planet assignment (hyperjump exit / SetParent) — follow-up.
- United Dhayut Union at 1 colony: targets exist in range; DirectConstruction's money check fails every interval
  (Empire.6.cs 2630-2735: colony ship 15.1–15.8k vs 7–12k cash after maintenance; research and fleet building spend the
  rest, 2736-2839). Faithful. Lever = scenario/difficulty/policy, not range.
- Follow-ups: the "Wild Aspiration" parent-planet check; an audit of in-system speeds (10–30 u/s makes short trips take
  weeks); relax sim-run's frozen-mission metric.
- 19h-8 follow-up: pirate herd hunts pay a credits bounty because the herders' `creatureKilled` kill drop was not on that
  branch; once 19j is merged, the drop lands in the hunters' holds automatically — decide whether to keep the bounty too
  (probably drop it). Also: fuel-scarcity default (0.65) vs belt inner (0.7) means rim pirate bases sit on fuel-less
  worlds; consider a pirate exemption or a small fuel band at the rim.
- Save size at scale (2026-09-27): a 4000-star / ×1.7 galaxy serialises to ~420 MB of text (139 MB at 700 stars). Needs a
  compact save format (binary or compressed, id-indexed) before big galaxies are playable across sessions. Medium (Opus).
- 19n-1 follow-ups: a regent is killed at the hand-over (side effect of the stock ChangeLeader — port a "steps down"
  path); when both livingCalendar and courtDynasties are on, the calendar must skip its election/coronation rolls
  (`courtHandlesSuccession(galaxy)` is exported for it — wire on merge); house prestige never decays on its own.
- 19o migration (after batch F + G merge): switch the remaining attitude writes to the ledger per
  src/sim/scenario/reputation/MIGRATION.md (19l incidents, 19g-3 humiliation/breach, 19d8 council, 19j herders, 19k
  leagues, 19a display mirror, 19l-2 pirate ambition/calendar) and point the council motion search, the war review
  and peace-terms pricing at `grievances()`. Sonnet, mechanical, ~half a day.
- 19n-2 follow-ups: UI buttons for schemes/hooks/ties (currently player ops + decisions + the diplomacy menu only); a
  foreign sway should be able to redirect a 19d1 defection toward the schemer; a claimed colony's secession should hand
  it to the claimant (19d1 hook); a scheme's agent appears twice in the victim's leads (scheme + foreignAgent) — dedupe;
  19g-3 wiring of claimsFor/holdsCasusBelli into warGoalCandidates (documented in intrigue.ts header). Sonnet, ~half a day.
- 19r post-merge verification (after batch G): threat markers vs the real threatKnownSites output; lineage readers vs the
  real 19c/19d1/19d4/19f-7 state; wreck-field debris and league pennants vs the real 19e-7/19k-3 state (captures
  `wreck-field.png`, `league.png` still owed); re-key salt bloom onto the treasure fleet; treasure-fleet marker label;
  drop overlayLayer's plain ring/diamond threat drawing in favour of threatMarkers; pass the Concord's generated
  textures through the damage/livery overlays; the heavily-withered fade may be too strong (judge in play). Sonnet.

## 19g-5 frontier autonomy follow-ups (landed 2026-09-27, wip/s19g5 19d3a60)
- No UI yet: sector panel (members, governor, autonomy with drift causes), rule slider loose/tight, herd-tolerance switch, concede/honours buttons. Player ops `frontierOrder` / `frontierConcede` exist.
- Trade-compact standing is kept on the sector; migrate to the 19o reputation ledger once both are on main (add to the 19o migration list).
- Colonies passed through `initiateEmpireSplitAt`'s new `colonies` option join after the new empire's race/government are chosen; verify the split's random-call order against Empire.1.cs 2921 in a 10-year all-flags run.
- AI parity audit (19s-1): "autonomy grants 0" over 5 years; re-check after frontier autonomy is on since it now grants at the seat on concession.

## Empire elimination / teardown not ported (found 2026-09-27 by the checkRefuelRepairAttack null-guard fix, wip/fixxpos d72e169)
- `takeOwnershipOfColony` (src/sim/empire.ts ~1058–1085) sets `capital = null` when an empire loses its last colony but does not run
  Empire.1.cs 64–370 elimination: CompleteTeardown (Empire.cs 4874), war/relation removal from every other empire, mining-station and
  base teardown, troops, events, the "defeated" message. `empireAbsorb.ts` ports the conquest-ending/absorb path only.
- Effect: a colony-less empire stays active and at war forever; C# invariants like "every war enemy has a capital" break. The guard at
  ShipGroup.cs 1743 is a patch; other `capital!` reads may hit the same case (grep `capital!` in src/sim).
- Follow-up (Opus, sim): port the elimination path faithfully; pins WILL move. Run a 5-year all-flags soak after.

## 19s-3 strategic upgrade follow-ups (wip/s19s3 46dafc5)
- Scheme-target family is a stand-in (19m investigation into an open lead) because 19n-2 schemes were not on its base; re-point it at 19n-2 scheme targets now that batch G is on main.
- Council votes are rarely offered to the model (motions only stay open when the player sits on the council); peace offers to the player are never offered.
- Herder conquest is tested by enumeration/validation only.

## Save crash at scale (found 2026-09-27 by the 15-year soak smoke: 4000 stars / 60 empires / 44 flags, 1 year)
- `serializeGame` → native `JSON.stringify(save)` throws `RangeError: Maximum call stack size exceeded`; `galaxyToJSON` itself completes.
  So the encoded save tree has a genuinely deep (thousands of levels) nesting chain somewhere (not a big flat array).
  Sim ran the year cleanly (144 s wall, RSS 2.2 GB, 1933 battles, 413 destroyed, 116 herds, 4 wars).
- Workaround under test: `ulimit -s 65500` + `node --stack-size=65000`. Real fix: find the package/state that nests (candidates: court lineage/claim
  chains, ship-group nesting, relation cross-refs) and flatten it in the encoder; wip/savedepth agent assigned.
- Also: 117 pirate factions were generated for 60 empires at 4000 stars, and many rim/core pirate base placements fell back to the stock rule.

## 19s-2 voices follow-ups (wip/s19s2 2379cd3, built on a base without 19o/19n/19n-2)
- Wire the three inert hooks at their real emit sites once merged: `voiceGrievanceAdded` in the 19o ledger (event `reputation.grievanceAdded`),
  `voiceFactionUltimatum` in 19n court factions (`court.factionUltimatum`), `voiceSchemeLetter` in 19n-2 intrigue (`intrigue.schemeLetter`). Sonnet, mechanical.
- Treasure-fleet greeting and herder migration hooks are untested end to end; an open message popup does not refresh when a voice arrives.
- Add the §19s DONE notes for packages 2 and 3 in tasks/19-mod-layer-scenarios.md (package 4 already noted by its agent).
