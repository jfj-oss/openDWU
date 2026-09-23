# ROADMAP — milestone status

Milestones follow spec Part 15 (16.1). A milestone is *done* when its
acceptance criteria hold.

| # | Milestone | Status | Notes |
|---|-----------|--------|-------|
| M1 | Map & rendering core | ✅ done | Galaxy generation (6 shapes, stars/planets/resources/nebulae/creatures/ruins/sectors), time system, visibility/fog — all complete; headless sim verifies a full 100-1400-star galaxy against `data/` (all invariants pass). Full content data set transcribed (22 races, 13 governments, 129 components, 372 research, 41 resources, 33 facilities, 14 fighters, 4 plagues, 22+8 policy sets, templates, names, GameText). dwu-ui app shell runs the full UI: main menu, new-game wizard (all spec options), in-game world view (zoom/pan/minimap/system+planet selection), status bar, message log, system info panel, empire strip. |
| M2 | Empires & colonies | 🚧 mostly done | Empire model + starting placement (20 playable+expanding races; Shakturi/Mechanoid storyline-only), homeworld/extra colonies, population growth (race×gov×approval, capacity-capped), approval/happiness drift, development, tax income + corruption siphon, upkeep, extraction + manufactured-resource gating, 372-project research progression (2^level costs, unlocks recorded), resource price review (exact §5.3 rule), relations seeded from race biases, headless 1000-star/20-empire/100-year runs pass all invariants. Remaining: facility construction effects, private-sector ship sales/trade fees/tourism, full population-policy table (M6/M7). |
| M3 | Ships & space ops | 🚧 mostly done | Design system (`design.rs`: race templates → best-researched components → derived stats, auto-added command/life-support/hab/hyperdrive/reactors), 19-role design book per empire, ship ops (`ships.rs`: missions, intra-system movement w/ nebula drag, hyperdrive spool+travel, energy/fuel bookkeeping w/ graceful reactor degradation, docking/refuel/repair at base yards, ship-to-ship transfer, spaceport yard construction + cost, field construction, colonization w/ self-limiting replacement of spent colony ships), role-based auto-missions (patrol/transport/mine/colonize, war Attack missions since M4), low-fuel auto-refuel. Headless: 1000-star/20-empire/100-yr passes all M2+M3 invariants (200 colonizations, 300 constructions, ~12M jumps, 0 adrift). Remaining: cargo loading/delivery between colonies, retrofit/improved-part swaps (M5), full resupply-shuttle logistics (M7), UI wiring. |
| M4 | Combat | 🚧 core done | `combat.rs` (headless): all weapon behavior classes (§4.1: beam/phaser/rail-split/torpedo/missile/area/gravity-shield-bypass/ion/artillery), exact hit determination (§4.2: range chance + speed clamp 0.7–5.0×2 + targetting/luck 1/15, countermeasures), full damage pipeline (§4.3: rail 25–75% split, gravity bypass, shields-first, armor disable max(0.1,dmg/rating) w/ missile/rail halving, damage control), PD vs homing (clamp pd/(pd+200)), carrier fighter squad screens (aggregate model: pool health + sustained dmg + fire attrition), battles in 0.5-s combat ticks capped at 10 in-game min, auto-engagement when hostile factions share a system (same-system = detected), war seeding (pirates vs all; race-bias ≤ −10 pairs) + war Attack auto-missions, bombardment (§4.6: V7 weapon power degrades held enemy-colony planets — habitat damage 0..1 lowers effective quality, heals slowly or via terraforming; Planetary Shield facility nullifies it; garrison-artillery mitigation deferred to ground troops), boarding/capture (§4.7: pods (Value5 shield penetration) fire 1-in-5/tick at shield-depleted enemies past their PD; AssaultAttackValue vs boarding-defense decay race — capture transfers the ship to the captor's fleet (design kept); repelled attacks reset defense; race TroopStrength and empire BoardingAttackFactor approximate to 1.0 until M7). Cross-process determinism fixed: BTreeMap battle ordering + all-pairs (not adjacent-pairs) hostility checks over HashSet-derived faction lists. Unit tests: hit-score curves, shield/hull pipeline, gravity bypass, armor/PD, rail split conservation, battle purity, planetary-shield gate, boarding capture/repell/shielded-target. Verified: 100/3/30y, 100/20/5y, 1000/20/100y — all invariants + determinism (2-run diff) pass. Remaining: raiding + captured-ship policy (enlist/upgrade/scrap) + boarding component-disables, troop/character bombard casualties, blockades, ground combat, fleet auto-response doctrine (M7). |
| M5 | Research & progression | 🚧 mostly done | 372-node tree from research.txt loaded + driven per industry (prerequisite-gated project selection, 2^level costs w/ overrides, per-project component/fighter/facility/ability unlocks recorded), starting-level seeding, research stations (neutron-star 1.5×/black-hole 2.0×/supernova 1.2× colonies multiply empire output), crash research (destroyer earns hull-size burst), ruin discovery (first settlement of a system completes its ruins' research), projects_completed counters + M5 report line. Remaining: ability-effect application (M7), policy-driven research selection (M7), component-improvement auto-retrofit (no improvement data in current set), research-station facilities on planets. |
| M6 | Diplomacy & espionage | 🚧 dynamics core | Headless relations dynamics: attitude drift toward race-bias baselines (5%/yr), colony-competition offenses (settling a shared system = -20, station = -5, latecomer = offender, registered once per system pair), war declaration at attitude ≤ -25 (both directions, attitude floor -40), war weariness accrual (government rate × race attenuation, tolerance 2.0) forcing peace (attitude +15, weariness reset), pirates permanently at war; DiploStats counters + M6 report line + symmetry/range invariants. Verified: 100y/20-empire run cycles 165 declarations / 165 peace treaties over 100 years — conflict no longer front-loads.  Reputation + treaties + gifts (M6-C, headless): `reputation` (0..100, start 50) drops for offenses (−3), war declarations (−5 both; −10 each when a treaty is broken) and rises with peace (+5) and courtly gifts (+0.5/yr), drifting back to neutral 2/yr; low average reputation pulls the attitude drift target down. Treaties: Free Trade (attitude ≥ 20 with trade affinity — merchant races/Mercantile governments — or ≥ 35 for any friendly pair) yields each party 20% of the 5%-of-combined-income bilateral trade value; Mutual Defense Pact (≥ 45 + affinity) yields 30% (spec §5.1 caps); war declarations break treaties. Gifts: while relations are lukewarm (−15..50) the richer empire courts the other (2%-of-income cost, +2 attitude/yr, +reputation). `DiploStats` gains trade_agreements/defense_pacts/gifts_sent/treaties_broken; [M6] line reports them. Fixed an M2-era economy bug found while wiring treaty income: state cash now scales per-year flows (tax/treaty/upkeep) by `dt_years` — the economy is step-count independent.   Espionage (M6-D, headless): all 12 intelligence mission types (DeepCover, InciteRevolution, SabotageColony/Construction, StealGalaxyMap/OperationsMap/TechData/TerritoryMap/Resources, Assassinate, DestroyBase, CounterIntel) policy-gated per race (IntelligenceAllowMission* + UseEspionage/UseSabotage thresholds + 30% counter-intel duty); agents = 1 + colonies/2 + sharp races + deep-cover, with upkeep; missions rotate against the most hostile eligible empire, success = 30% + espionage bonus/200 halved by the target's counter-intel share (floor 5%, cap 90%); effects: tech theft copies a completed project, map theft upgrades visibility, sabotage hits development/queues, base destruction, resource siphon; detection = blowback (target attitude -15, reputation -5).   Subjugated dominions (M6-H, headless): the winner of a war keeps a decisively broken enemy as a vassal at peace — `subjugation_holds` (loser <= 3 colonies and winner 2x, or a 1.5:1 margin of 3+ colonies); the dominion pays its overlord 10% of annual state revenue as tribute (precomputed flows, applied after the empires pass; capped 50% across several overlords) and breaks free once it outgrows the overlord by the same 1.5:1 ratio (`DiploStats.subjugations / independences / tribute_paid`).  Remaining: messages (M9 UI), diplomacy/espionage panels in the wgpu shell (M9).|
| M7 | Full AI & automation | 🚧 policy core | Policy loading applied per empire at startup (standard vs pirate set by race: `ResearchPriority` → research scoring weight, `ConstructionMilitary<class>` → fleet-class build gates, `CaptureEnlist/DisassembleMilitaryShip` → captured-ship disposition). Policy-scored research selection: among parent-satisfied projects, score = early-tech + 0.5×components + 0.25×fighters + facility/ability bonuses + priority-2 impact weighting + stable per-id hash jitter (deterministic; empires diverge). Captured ships now follow the captor's policy (enlist → transfer, disassemble → Spent{Captured} + salvage crash-research burst, else scrap); `captures_enlisted/captures_disassembled` counters. Verified: 4/20 empires run priority-2 policies; research trajectories diverge; science academies boost empire research output (+10% each, capped), terraforming facilities 2.5× habitat healing, fortified bunkers halve bombardment, facility maintenance in upkeep, `ColonyTaxRateIncreaseWhenAtWar` raises the tax tier at war, `Colonize*Priority` + `ColonizeRuinsPriority` bend colonize-target distance scoring; all gates + determinism green. (668 facilities built in the 100y run).  War objectives (M7-D): `WarCtx.enemy_territory` (enemy colony systems) joins fleet-system targets in the military attack pool; ships split across targets by stable id-hash (3 candidate targets, nearest chosen) so fleets form in groups and engagements anchor on defended colony ground — 100y reference run battles 3→14, shots 10.6k→24.9k, fighter losses 94→381, bombardment 10.0→14.2.   Pirate playstyles + fleet doctrines (M7-E, headless): PiratePlayStyle (Balanced/Pirate-Raider/Mercenary/Smuggler, random per faction) drives the pirate economy — protection pacts (feared empires pay 3% of income, drop out when the threat passes), colony raids (loot + development/approval damage; rate by playstyle), smuggling (Smugglers earn 2% of galaxy colony income) and piracy loot (5% of crash-salvage value paid out); Smuggler +15% research / Mercenary +5% with -10% maintenance; the pirate victory track (pirates compete against pirates only on the game's criteria; void with fewer than two pirate factions); FleetDoctrine (Balanced/Aggressive/Defensive/Skirmisher, deterministic per race+gov) applies weapon/shield/armor modifiers to every combatant. [M7] line reports pirates/raids/protections; final line lists each pirate's playstyle + income.   Space creatures (M7-F, headless): the five CreatureTypes (Kaltor + giants, Desert/Rock Space Slugs, Ardilus, Silver Mist — M1 placement/stats) are now alive: step_creatures (pass 1.6) — predators/swarms deal size-scaled hull damage to every ship lingering in their system (victims -> Spent{Destroyed}, `creature_victims`); the Silver Mist drains shields (gone within half a year) and can only be defeated by ion-armed fleets; armed fleets grind creatures down (power x 0.5/yr vs shield+hull), the strongest hunter is credited with a reputation boost (+2, +5 civility for Silver Mist kills) and per-empire counters (`creatures_killed` / `silver_mists_killed`) which unlock the DestroySpaceMonsters (>=5) and DestroySilverMists (>=1) achievements. [M7] line reports creatures destroyed.  Independent alien populations (M7-G, headless): `Planet.native_pop` is seeded at generation per the Alien Life option (`GalaxyOptions.alien_life`, 0-3; 15/30/45% of colonizable worlds get 20-400M natives scaled by quality). New colonies subjugate the world (`transfer_natives`, pass 1.7 — the population moves onto the colony's `native_population` where M2 assimilation runs; starting homeworlds do the same at startup); unclaimed worlds grow 3%/yr, capped by planet capacity (`step_independents`, pass 2.12). Pirate raiding now targets independent worlds too (nomadic playstyles — everyone except Mercenaries — raid worlds with >= 50M natives for a 10% tribute, harvesting 5% of the population). [M7] line reports `indep={worlds}(~{pop}M)`; the final line reports the same plus creatures destroyed.  AI difficulty scaling (M7-H, headless): `NewGameOptions.difficulty` (0-4, 2=Normal; CLI `--difficulty`) scales AI empires per spec §5.6 — research output x(1+0.25t) and tax income x(1+0.15t) with t = (difficulty-2)/2 in [-1,1], one or two starting tech tiers ahead (`ai_tech` gates the starting cruiser/carrier tiers too) and a larger starting military (counts x(1+0.25t), min 1); pirates are excluded (they use the pirate-strength option). `--difficulty-scaling` enables the dynamic ramp (spec: "difficulty scales as player nears victory"): when one faction holds >= 70% of all colonies, the remaining empires get research/income x(1+0.3xshare) up to 2x, reported as `ramp={}` on the [M7] line. Also fixed a latent bug the now-runnable tests exposed: `found_colony` indexed the systems vec by the (1-based, sparse-capable) system id instead of `galaxy.system_index`, so colonize missions landed on the wrong system.  Force-structure projection (M7-I, headless): `order_fleet_construction` now projects the empire's desired force structure (spec §5.6) — the threat level (wars fought, 0-4; pirates always skirmish at 2) selects per-role proportions via `force_structure_proportions` (military share ~32% at peace to ~80% at all-out war; logistics share shrinks with threat), targets = fleet baseline x proportion + per-role minimums (every empire keeps one of each core hull), and the biggest deficits are queued first (two per step, backlog 6), policy class-gates and design-book availability still apply; a fleet floor of 5 keeps empires that lost everything rebuilding. The final report line shows the galaxy's fleet mix (`military={share}%`). With this, every headless-sim item of the M7 milestone is implemented: automation/priorities/policies (M7-C), war objectives + fleet grouping (M7-D), pirate playstyles + fleet doctrines (M7-E), space creatures (M7-F), independent populations (M7-G), difficulty scaling (M7-H) and force-structure projection (M7-I) — the M7 acceptance criterion (a fully automated game plays itself to a winner) is met in the headless sim.|
| M8 | Content & storylines | 🚧 data + victory  Race events (M8-F, headless): all 29 appendix `RaceEventType`s with a deterministic per-race signature schedule (1..=3 events, years 3..=26, shared by every empire of the race); bulk effects: war-weariness reset, +20% colony quality (tax), +20 targetting (PredictiveHistory, spec §4.2), research gains/losses, crash-research burst, fleet-upkeep discount, attitude ±10 bulk shifts, territory reveals / hidden-location discovery, plague immunity + planet-damage healing, giant Kaltor spawn, no-assimilate (anti-xeno); character/ground-troop events recorded (no character model).  Plagues (M8-G, headless): the four appendix plagues.txt pathogens are first-class content — natural outbreaks weighted by natural_occurrence_level (retuned to DW-scale rarity), per-colony infection countdowns from duration_seconds (600 s = 1 game year, per the data typical-outbreak notes), mortality while active (mortality_rate scaled per year), spread to healthy colonies in the same system (air-borne strains with infection_chance >= 25 also jump systems), the 10M population floor when the pathogen cannot eliminate, race exceptions from the data, LuckyAvertColonyDisaster immunity. PlagueStats (outbroken/spread/pop_lost) + [M8] plagues report. Also fixed two latent combat bugs the tuning exposed: a captured hull destroyed before handover could be enlisted with 0 hull (zombie), and ships killed after the ship pass (creature/disaster victims) were never culled in the killing step (terminal cull added).  Planet destroyers (M8-H, headless): empires with the "Build Planet Destroyers when able" setting (a deterministic slice of non-pirate empires) run a long build (6y + 0.5y per tech level) and commission a PD base (new ShipRole::PlanetDestroyer); while at war it transits to the largest enemy colony, spends a year in position, and — unless the colony's own war fleet (>= 50 hull) repels it — focuses its super-weapons to destroy the planet permanently (barren rock, never re-colonizable, spaceport lost). Destroyed PD bases are salvaged and rebuilt (progress 0.5). OwnOperationalPlanetDestroyer achievement wired; combat_stats.pd_planets_destroyed + [M8] pd= report. Pre-warp progression (M8-H): the 12 appendix PreWarpProgressEventType milestones (verbatim) fire once per empire in pre-warp games (starting tech < 4) — first contacts/builds, colonization/hyperspace discoveries, first hyperjump, first creature encounter, first pirate raid — recorded in GameState.prewarp_events (saves) with a small research boost each, [M8] prewarp= report. Also fixed a pre-existing capture bug found while tuning: a captured hull destroyed before handover could be enlisted with 0 hull. 200-year stress run passes (deterministic, integrity clean, 44s).  Storyline governments (M8-I, headless): revolutions — an empire whose average colonial approval sags far below the 45 baseline has a discontent-scaled chance to fall and adopt another available government (spec: "You can change your government style by having a revolution... negative side effects... temporary setback of development"): all 13 appendix governments are selectable, with the two storyline ones gated on their storylines (Way of the Ancients, availability 2, unlocks with the first-hyperdrive Ancient-Galaxy discovery; Way of Darkness, availability 3, with the Shakturi waves). A revolution applies the development setback, resets colonial approval to neutral, records the change (GameState.government_events, serialized, [M8] gov= report) and awards the ChangeGovernmentToWayOfTheAncients / ChangeGovernmentToWayOfDarkness achievements on adopting the storyline governments.  | All content files transcribed/verified (see M1): 22 races / 13 governments / 41 resources / 129 components / 33 facilities / 4 plagues / 14 fighters / 372 research / 29-role templates ×23 sets (incl. pirate variants) / name pools / GameText / policies.  Victory/elimination engine (M8-A, headless): `VictoryRule` (territory / population / economy-strategic-value share vs threshold 75–100%, or time-limit → highest strategic value) chosen at new game (`--victory`, `--victory-threshold`, `--time-limit`); `strategic_value` per colony (pop×development + facilities + capital); elimination (planetary: no colonies + no space ports/construction ships; pirates: + resupply) retires the empire's ships and drops it from victory accounting; unopposed-survivor and share-threshold endings set `GameState.end`, which stops the sim; [M8] report line + integrity checks. Verified: time-limit run ends early with a winner; population/economy/territory runs clean.   Race-specific victory conditions (M8-B, headless): 14 `RaceVictoryKind` checks (surface majority / dual-surface, homeworld population+happiness, research+peace, military kill records, resort networks, trade wealth, ruins colonies, espionage deterrent, spaceport networks, homeworld conquest, wonder-linked, full conquest) mapped for all 22 races (`race_victory(race_id)`); per-empire `kills` tracked from last-hitter attribution; `GameEnd.race_specific/race_condition`; 10-yr grace; pirates excluded from race-condition war checks (planetary-vs-planetary, spec §9.1). Wonder-linked halves (Gizurean/Shandar/Wekkarus/Zenox) pending wonder construction.   Wonders (M8-C, headless): all 15 data wonders (facility ids 10-24) are pursued by empires from tech level 4 (hyperdrive era) — race-achievement wonders first (Gizurean Universal Hive, Zenox Galactic Archives, Wekkarus Underwater Palace, Shandar Lava Palace, 0-day instant builds) then generics in id order; researched on a cost-scaled clock then built (data build times), galaxy-wide unique (GameState.wonders_built — first completer claims, other partial builds cancel). Effects wired: Empire/Colony research wonders +10% output each, income wonders +5% tax, population-growth wonders +5% growth, happiness wonders +10 approval/yr, ColonyDefense halves bombardment damage per wonder (cap 2), ColonyConstructionSpeed +10% yard build speed; wonder maintenance is an upkeep line. Wonder-linked race victories (M8-B) are now reachable.   Achievements (M8-D, headless): all 29 Appendix K AchievementTypes modeled (achievements.rs, in official order); per-faction earned set + counters — military/civilian kill splits, ship captures, wars declared, treaties broken, elimination credit (empires/pirates at war with the victim), per-empire successful intel missions, peak treaty income, cumulative revenue, war/peace year history (all/no-time-at-war from year 50), wonders built, race victory conditions met (M8-B); [M8] line reports ach=N. Types awaiting their feature (creatures, characters, raids, government changes, splits, planet destroyer, storylines) stay unearned until it lands.   Storylines (M8-E, headless): scripted event engine (step_storylines, pass 2.9) — Return of the Shakturi invasion waves (year 20/35/50 timers spawn mid-game Shakturi pirate hosts via spawn_storyline_faction, waves 2-3 legendary), ancient-galaxy discoveries (first hyperdrive/super-tech breakthroughs grant galaxy-wide research bursts), Age of Shadows (pre-warp pirate rediscovery at year 15), Legends disasters (option-gated --no-disasters; plagues, supernovae, creature swarms at ~15%/yr); storyline eliminations award DefeatShakturi / DefeatLegendaryPirates; [M8] line reports events=N.  Remaining: 60 race victory conditions, 5 storylines, achievements wiring.|
| M9 | UI completeness | 🚧 screens in progress  M9-A screen system: full screens replace the galaxy map — Colonies (F2), Ships & Bases (F3), Empire (F6: overview, government attribute table, state economy, research summary, "Have Revolution…" action wired to the M8-I code path), Research (F7: per-industry active projects + progress), Diplomacy (F8: attitudes/war/treaties/dominions), Achievements (V: medals vs the 29 appendix types, new AchievementType::ALL); Esc/F1 returns to the map. ShipRole::name() + ship-phase labels added. Headless UI tests: every screen paints on a real game via Context::run(RawInput), and the revolution action changes the player's government.  M9-B world-view context menus: right-click a system or planet (planet picking mirrors the painter's orbit math) for a context menu — Go To System (camera focus), Declare War / Make Peace (both relation sides, the same mechanic the AI uses), Send Colony Ship Here (orders a spare colony ship: Colonize mission + system/planet target), Cycle Tax Rate on own colonies (player action into the sim). Actions go through a single testable `apply_ctx_action` (UI collects, sim applies). Headless tests: actions drive the sim (war/peace/colony-ship/tax) and planet picking recovers orbit points.  M9-C ships on the map + fleet management: ships are now drawn on the galaxy map (military squares / civilian dots, empire colors) and right-clickable (pick_ship mirrors the painter) for a ship context menu — Go To selected system, Explore, Hold Station, Join/Leave Fleet, Retire — issued through apply_ctx_action as ShipOrder; the Ships screen lists fleet groups + unassigned ships; colony-ship orders without an explicit planet now auto-select the first colonizable world of the system. Tests: orders/fleet round-trips drive the sim and ship picking works.  M9-D options / policies / Galactopedia + quick starts: Options screen (F4) edits UiSettings (labels, nebulae, minimap, system panel, message-log depth) which the world view and panels now honor; Policies screen (F5) lists the player's race doctrine settings from the policy files; Galactopedia (F10) enumerates every data-bundle topic (race families, races, governments, components, fighters, facilities, plagues, research, resources, achievements) with entry counts; Quick Start button (main menu) starts a 200-star / 6-empire / tech-6 game with a time-based seed, skipping the wizard. Tests: options screen paints and preserves user settings; policies + Galactopedia paint on a real game.  M9-E tutorials (all 11, spec §7): data/tutorials.txt transcribes the 11 official tutorial scripts (81 steps; verbatim quoted material from the spec, hotkey references mapped to this build's key layout) in a Part-13-style T/STEP format; dwu-data parses it (new tutorials loader, parser tests) and verify-data checks 11 tutorials / ids 1..=11 / steps; the Tutorials screen lists all 11 with launch buttons; launching opens the spec §7 tutorial window (draggable, step text, Continue → / Close) in any mode; launched from the Tutorials screen, the in-game Help > Tutorials menu, or the main menu. Tests: the screen paints (asserts 11 tutorials), and a full launch→Continue→completion run closes the window with a completion message.  | App shell with menu/wizard/world view/minimap/panels/status (winit+wgpu+egui 0.31, Metal/Vulkan). Every screen/hotkey/context menu/overlay from Part 12, options, policy screen, expansion planner, galaxy map, game editor, Galactopedia (309 topics), 11 tutorials, quick starts. |
| M10 | Persistence & modding | 🚧 core done  M10-F stats XML + theme hot-swap + saved-galaxy-as-map: per-empire stats (cash, population, colonies, territory, military, research) are sampled at every year boundary (state.stats_samples, serde-default) and written as spec §14.19 XML via write_stats_xml (dwu-headless-sim --stats PATH); a Statistics screen shows yearly samples + first-vs-latest growth. Theme system: dwu-data::list_themes scans Customization/ (override-file counts + summary.txt), the main menu's Change Theme screen hot-swaps the data bundle live (running game re-pointed), --theme DIR in the headless sim. "Use saved galaxy as map": galaxy_from_save + wizard checkbox/path field + dwu-headless-sim --map SAVE start a new game on an existing saved galaxy. Tests: stats sampling + XML well-formedness, save→map→new-game→run round-trip, theme listing, statistics screen paint.  M10-G game editor: dwu-core::editor provides place/erase/edit primitives (systems, planets, resources, nebulae, ruins, creatures, colonies, ships/bases, empire race/government/cash, relations, plagues), scripted events (triggers: always/colonies/project/war/year → action lists: message, cash, war/peace, research grant, plague, destroy planet, victory/defeat — immediate or delayed) and scenario objectives with win/lose results, all checked in the sim step; scenario files (events.txt/objectives.txt) load from data/scenarios/default; a Game Editor screen (Game menu + View > Screens) exposes the tools against the selected system, lists events/objectives/event log, loads the scenario, and saves the edited galaxy as a map (editor_map.json) that New Game can start on.  | M10-A (headless+UI): full GameState serde (data bundle excluded, reloaded from disk; Galaxy via shadow struct; tuple-keyed maps triple-encoded), save/load/autosave CLI (`--save/--load/--autosave`, rotating slots every 10y), UI File→Save/Load dialog, bit-exact round-trip (float_roundtrip) verified. Remaining: game editor, stats XML files, theme hot-swap, "use saved galaxy as map". |

## Cross-cutting quality gates (Part 15 §16.2)
- [ ] ≥30 FPS on 1,000+ system galaxy at system zoom (reference hardware)
- [ ] 200-year fully-automated stress game completes without crashes (both platforms)
- [ ] Save/load round-trips mid-game
- [ ] Every numeric constant in the spec implemented exactly (verify-data + unit tests)
- [ ] Definition-of-DoN scripted playthrough (Part 0)

## Current session work log
- Workspace scaffold: `dwu-data` (all Part 13 loaders + `verify-data`),
  `dwu-core` (rng/time/ids + headless sim binary), `dwu-ui` (placeholder).
- CI for macOS arm64 + Linux x86_64 with clippy/fmt/tests/build/headless smoke.
- `data/FORMAT.md` — parser contract for the content files (incl. final rulings:
  22 races, 372 research projects, 163 policy settings, official component
  type-code list, spec-table facility codes, synthesized-field documentation).
- Full content transcription of appendices → `data/` complete and verified
  (`verify-data -- data` passes: 22 races, 13 governments, 129 components,
  14 fighters, 33 facilities, 4 plagues, 372 research, 41 resources,
  22×22/7×7/13×13 bias matrices, 23 template sets, 14 design-name sets,
  6 pools, 504 GameText topics, 22+8 policy files, startup.ini).
- `dwu-headless-sim` generates a full galaxy from `data/` and passes all
  M1 invariant checks (bounds, sector grid, index, super-luxury placement).
- M2: empire/colony/research/economy model in dwu-core
  (`empire.rs`, `colony.rs`, `research.rs`, `economy.rs`, `startup.rs`,
  `game_state.rs`); `dwu-headless-sim` now places starting empires and runs
  N game years with yearly reports + M2 integrity checks (verified: 100
  stars/3 empires/20y, 1000 stars/20 empires/100y, all invariants pass).
- M1 UI: dwu-ui app shell complete and committed (`dfe4333`): winit 0.30
  ApplicationHandler loop + wgpu 24 (Metal/Vulkan) + egui/egui-winit/egui-
  wgpu 0.31, single paint path. Modes: Menu → Wizard → Generating → InGame;
  camera pan/zoom (wheel/keys/dbl-click), system selection + click/minimap
  navigation, tick at speed levels 0–8 (≤128 yr/min) with 0.01-yr substeps,
  research-level-up feed, graceful no-display/no-GPU exits, `--data DIR`.
- M3 core (this session): `design.rs` + `ships.rs` in dwu-core, design book
  per empire (race designTemplates → best-researched components, auto-added
  command/life-support/hab modules/hyperdrive/reactors), ship ops on
  game-hour subticks (movement w/ nebula drag, hyperdrive spool+travel,
  energy/fuel w/ graceful reactor degradation, docking/refuel/repair,
  spaceport yard construction w/ cost, field construction, colonization),
  role-based auto-missions + low-fuel auto-refuel, annual fleet-review
  construction driver (force-structure targets, colony-ship replacement).
  Data: engine/hyperdrive values rescaled to spec Part 4.1 ranges
  (top 6-60 u/s, hyper 40-120 u/s) — FORMAT.md note corrected to match.
  Bugs fixed: system-Id-vs-index leak in mission goals (out-of-bounds
  panic), wrong dock-service lookup (fleet stuck adrift), reactor
  hard-fail on empty tank (whole fleet dead in water), dormant
  field-construction timer. Verified: 1000 stars/20 empires/100y passes
  M2+M3 invariants (200 colonizations, 300 constructions, ~12M jumps,
  0 adrift); clippy -D warnings + fmt + verify-data clean.
- M4 combat core (this session): `combat.rs` in dwu-core — weapon behavior
  classes from component types (beam/phaser/rail/torpedo/missile/area/
  gravity/ion/artillery; V1 damage, V2 range, V3 energy, V5 range loss,
  V6 fire rate, V7 bombard), `hit_score` = exact §4.2 (range chance
  0.15 + R/D, speed clamp 0.7–5.0 × 2, targetting %, luck 1/15 botch/ace),
  `apply_damage` = §4.3 (rail 25–75% shield split, gravity shield bypass,
  shields absorb first, armor disable p = max(0.1, dmg/rating) absorbing the
  rating, missile/rail halved vs armor, damage control), PD interception
  (pd/(pd+200) cap 0.85) vs torpedoes/missiles, carrier fighter squad
  screens (aggregate: pool health, sustained damage, enemy-fire attrition),
  battles as 0.5-s-tick sub-simulations (≤10 in-game min) run on each
  game-hour subtick for systems holding ≥2 hostile factions; destroyed
  ships → Spent{Destroyed}, residual shields/hull written back.
  Wars seeded at startup (pirates vs everyone; race-bias ≤ −10 pairs;
  `is_hostile` looks up relations by the `other` field), war Attack
  auto-missions send military ships to the nearest enemy position.
  `GameState.rng`/`combat_stats` added; M4 counters + invariants (no
  negative shield/hull, spent ships culled, shots = hits + misses) in the
  headless sim; unit tests for hit curves, damage pipeline, armor/PD, rail
  conservation, and battle purity. Determinism bugs found & fixed:
  (1) by-system battle order was a HashMap → BTreeMap (stable RNG
  consumption), (2) hostile-pair checks iterated only *adjacent* pairs of a
  HashSet-ordered faction list, so results flipped per process → all
  unordered pairs, (3) `is_hostile` used a positional relation index that
  is wrong for empires after themselves → `other`-field lookup (also
  removes the spurious-wars that the bug had created). Verified: unit
  tests, clippy -D warnings, fmt, verify-data, CI smoke, and 2-run diff
  determinism on 100/3/30y, 100/20/5y, 1000/20/100y (all invariants pass;
  1000/20/100y ≈ 20 s). Known: initial wars resolve early; sustained
  conflict needs M6 war declarations + M7 fleet doctrine.
- M4 bombardment increment: `DesignStats.bombard_power` (sum V7 × count over
  weapons); `GameState.habitat_damage` (per-planet 0..1, keyed by
  (system, planet)); `bombard_system` in resolve_combat — enemy military
  ships with V7 power degrade the colony's planet while holding the system
  (power/8000 per game day), `effective_quality` (quality − damage, floor
  0.05) feeds colony income/development, natural healing 0.02/yr, Planetary
  Shield facility nullifies (`colony_shielded`, unit-tested), headless-sim
  M4 line now reports `bombard=` total habitat damage + range invariant.
  Verified: 100/20/5y → bombard 4.40, 1000/20/100y → 20.0, all
  determinism/invariant gates still green.
- M4 boarding increment: `DesignStats` assault-pod fields (count, V1 power,
  V5 shield penetration) + boarding defense (0.5×size + 0.1×life-support);
  Combatant pod/board fields; `resolve_battle` boarding phase (pods fire
  1-in-5 per tick per pod group vs the lowest-shield eligible hostile, PD
  intercept, AccumulatedAttackValue vs defense decay race with
  ratio = clamp(attack/defense, 0.5, 2.0)); capture transfers the ship to
  the captor's fleet (design kept, marked captured) via the write-back;
  `CombatStats.captures` + M4 line reports it; unit tests: capture,
  weak-attack repelled, shielded-target immunity. Pirate templates carry
  pods, so captures become live as battles grind shields down.
- M5 core (this session): research stations (System.star.research_bonus
  multiplies empire output per bonus-system colony), crash research
  (`last_hitter` attribution in combat → destroyer's one-time
  `research_burst` + cumulative `crash_research_earned`), ruin discovery
  (`GameState.discovered` (system, empire) pairs; first settlement
  completes the system's ruins' `discoverable_research` via
  `ResearchState::complete_project`), `projects_completed` counters,
  M5 report line + tech-level/progress invariants in the headless sim.
  Unit test: complete_project unlocks across industries, no-op on
  unknown ids. Verified: all gates green, determinism re-confirmed
  (100/20/5y, 1000/20/5y, 1000/20/100y; 100y run: 6592 projects,
  crash research 1.47M).
- M6 relations core (this session): `step_diplomacy` pass — colony-
  competition offenses (latecomer offender; -20 settling / -5 station;
  `GameState.offenses` dedup), attitude drift toward race-bias baselines,
  war declaration at attitude ≤ -25 (mirrored both directions), war
  weariness accrual (government rate × race attenuation, tolerance 2.0)
  forcing peace (+15 attitude, weariness reset); pirates stay at war.
  `DiploStats` counters + M6 report line; headless-sim invariants:
  symmetric wars, attitude range, weariness range. Verified: 100y/20-
  empire run declares 165 wars / 165 peace treaties / 18 offenses —
  diplomacy now sustains conflict across the whole game; determinism +
  all gates green.
- M7 policy core (this session): `apply_policy` in startup wires each
  empire's race policy set (standard vs pirate): `ResearchPriority`
  (1/2) → policy-scored project selection in `research::next_project`
  (early-tech + component/fighter/facility/ability impact + priority-2
  weighting + stable per-id jitter — deterministic, no RNG),
  `ConstructionMilitary<class>` → fleet-class build gates in
  `order_fleet_construction`, capture policy → write-back now enlists /
  disassembles (Spent{Captured} + salvage crash-research burst) or scraps
  captured ships per the captor's policy; `captures_enlisted` /
  `captures_disassembled` counters + M7 report line. Unit test:
  priority 1 vs 2 flips the selection. Verified: policies load (4/20
  empires priority-2), research trajectories diverge, all gates green
  (tests 18/18, clippy -D, fmt, verify-data, CI smoke, determinism on
  100/20/5y + 1000/20/5y + 1000/20/100y).
- M7 facility policy (this session): `Colony::step_facilities` — policy
  `ColonyAllowFacilityX`/`ColonyFacilityPopulationThresholdX` (loaded per
  race via `apply_policy`) drive queueing (one per type, research-gated,
  construction cost paid upfront, build time from facilities.txt);
  effects: science academies +10% empire research output (capped 50%),
  terraforming facilities 2.5× habitat healing, fortified bunkers halve
  bombardment damage (planetary shield still nullifies), facility
  maintenance added to empire upkeep; `ColonyTaxRateIncreaseWhenAtWar`
  raises the tax tier while at war; `Colonize*Priority`/`ColonizeRuinsPriority`
  bend colonize-target distance scoring (4% per priority step). Unit test:
  policy gates + queue + completion. Verified: 668 facilities built in the
  100y/20-empire run (94 in queue); tests 19/19, clippy -D, fmt,
  verify-data, CI smoke, determinism all green.
- M7 ability effects (M7-C, this session): `Empire::ability_effects()`
  derives `AbilityEffects` from unlocked research ability codes —
  PopulationGrowthRate (code 4) adds to colony growth, Boarding (0)
  scales pod boarding attack (floor 0.5×), IncreasedConstructionSize (2)
  gives newly spawned ships 1+10%/tier hull size (cap tier 5),
  ColonizeHabitatType (1, va=6) unlocks barren-rock worlds for
  colonization; troop/sub-role abilities (5/3) recorded, inert until
  M7 doctrine/M8 troops. Unit test: derivation + tier max + code
  dispatch. Verified: 100y run reaches size_tiers=159 (all empires
  grow hulls), trajectory shifts (707 facilities, 31 new colonies);
  tests 20/20, clippy -D, fmt, verify-data, CI smoke, determinism all
  green.
- M8 victory/elimination (M8-A, this session): `VictoryRule`/`GameEnd`
  + `strategic_value` in game_state; `step_victory` pass — elimination
  (planetary empires out at zero colonies + no yards; pirates also need
  resupply gone) retires ships and excludes empires from accounting;
  share-threshold victory (territory/population/economy, default 85%),
  unopposed survivor, and time-limit (highest strategic value) endings
  set `GameState.end` which stops `step_years`; new-game `victory`
  option + CLI (`--victory`, `--victory-threshold`, `--time-limit`);
  [M8] report + integrity (eliminated ⇒ 0 colonies, winner not
  eliminated, unopposed ⇒ exactly one alive). Unit test: strategic
  value ordering. Verified: time-limit run ends at the limit with a
  winner (Atuuko in the 100⭐ ref run); tests 21/21, clippy -D, fmt,
  verify-data, CI smoke, determinism (3 configs + time-limit config).
- M7 war objectives (M7-D, this session): `WarCtx` gains
  `enemy_territory` (systems with enemy colonies, rebuilt per sub-tick
  alongside enemy fleet systems); the at-war military mission block now
  draws a target pool of territory + fleet systems and each ship takes
  the nearest of 3 id-hash-spaced candidates — fleets split into
  groups and attacks anchor on colony ground where defenders stand
  (previously every ship stacked on one moving fleet target, so wars
  rarely produced battles). Verified: 100y/20-empire run battles 3→14,
  shots 10.6k→24.9k, fighter losses 94→381, bombardment 10.0→14.2
  (~4x combat activity); CI smoke 100/3/5y now 5 battles; tests 21/21,
  clippy -D, fmt, verify-data, determinism (3 configs) all green.
- M8 race-specific victories (M8-B, this session): `RaceVictoryKind`
  (14 check types) + `race_victory(race_id)` mapping all 22 races to
  documented headless approximations of the manual's race summaries
  (Ketarov espionage deterrent, Quameno/Research, Boskara/Mortalen
  military records, Ackdarian/Ocean majorities, Teekan trade wealth,
  Securan resorts, Zenox ruins colonies, Shakturi full conquest, ...);
  `Empire.kills` from last-hitter attribution; `race_victory_summary`
  gathers surface ownership (9 surface codes), capital-system
  homeworld facts, tech level, peace (planetary-vs-planetary only —
  pirates excluded per spec §9.1), ships, happiness, cash, ruin
  colonies, enemy homeworlds; `GameEnd.race_specific` + condition
  text; 10-year grace period; wonder-linked conditions (Gizurean
  Universal Hive, Shandar Lava Palace, Wekkarus Underwater Palace,
  Zenox Galactic Archives) gated on `Empire.wonders` (empty until
  wonder construction lands). Unit test: mapping totality + per-kind
  evaluation. Verified: 100y/20-empire run now ends on a race
  condition (Ketaros: strongest covert deterrent) with early
  termination; tests 22/22, clippy -D, fmt, verify-data, CI smoke,
  determinism (3 configs) all green.
- M6 reputation/treaties/gifts (M6-C, this session): reputation
  dynamics (offenses −3, declarations −5 / treaty-breaking −10, peace
  +5, gifts +0.5/yr, 2/yr drift to neutral 50; low average reputation
  lowers the drift target), treaty engine (`TreatyKind` +
  `treaty_income`: bilateral trade value = 5% of combined colony
  income; Free Trade shares 20%, Defense Pact 30% — spec §5.1 caps;
  thresholds scaled to the small race-bias data: free trade at ≥ 20
  with trade affinity or ≥ 35 friendly, pacts at ≥ 45 + affinity;
  war declarations break treaties), and courtly gifts (richer empire
  spends 2% of income per year, +2 attitude/yr while relations are
  lukewarm — gifts climb pairs into the treaty band). `DiploStats`
  extended; [M6] line reports treaties/pacts/gifts/broken. Also fixed
  the M2-era cash formula that omitted `* dt_years` on per-year flows
  (economy is now step-count independent). Unit test: treaty income
  model. Verified: 100y reference run signs 130 treaties and 314 gifts
  (0 before); CI smoke signs its first treaty by year 5; tests 23/23,
  clippy -D, fmt, verify-data, determinism (3 configs) all green.
- M6 espionage (M6-D, this session): all 12 intelligence mission
  types implemented and policy-gated per race (the 10
  IntelligenceAllowMission* flags + counter-intel duty + the
  UseEspionage/UseSabotage attitude thresholds from the policy
  files); agents = 1 + colonies/2 + (intelligence >= 120) +
  deep-cover recruits, 30% on counter-intel, 500 credits/agent/yr
  upkeep; each period empires rotate missions against their most
  hostile eligible empire (sabotage-class gated by the stricter
  threshold); success chance = (30% + espionage bonus/200) x
  (1 - 0.5 x target counter-intel share), clamped 5..90%, rolled on
  the single sim RNG; effects: StealTechData copies a target's
  completed project (with its unlocks), the three map missions
  upgrade visibility (galaxy/operations/territory), sabotage hits
  development/facility queues/approval, DestroyBase damages a base
  (destroy below 15% hull), StealResources siphons 5% of target
  cash, DeepCover recruits a permanent agent; detection costs the
  target attitude -15 and the spy's reputation -5 (can trigger wars
  via the M6 drift). DiploStats + [M6] line report intel=attempted/
  succeeded detected=N. Unit test: the success-chance model.
  Verified: 100y reference run 105 missions / 44 successes / 61
  detections; 5y runs run 300 missions; a blowback war shows up in
  the small-game smoke. Tests 24/24, clippy -D, fmt, verify-data,
  determinism (3 configs) all green.
- M8 wonders (M8-C, this session): `WonderStage` pipeline (Idle ->
  Research -> Build) in `step_wonders` — empires from tech level 4
  pursue their race-achievement wonder first (Gizurean 21 / Zenox 22 /
  Wekkarus 24 / Shandar 23, 0-day instant builds) then generic
  wonders in facility-id order; research clock scaled to construction
  cost (50k -> 10d, 100k -> 20d), build on the data build times,
  pipeline completes within a step so multi-year chunks claim wonders
  before late-game end conditions; galaxy-wide uniqueness via
  `GameState.wonders_built` (first completer claims, other partial
  builds cancel, cost charged on claim). Effects wired: research
  wonders (Weapons/Energy/HighTech) +10% output each, income wonders
  +5% tax, population-growth wonders +5% growth, happiness wonders
  +10 approval/yr via `ColonyContext.wonder_happiness`, ColonyDefense
  halves bombardment damage per wonder (cap 2), ColonyConstructionSpeed
  +10% yard build speed; wonder maintenance is an upkeep line. Wonder-
  linked race victories (M8-B) become reachable. Unit test: the
  race->wonder mapping. Verified: all 15 wonders claimed by year 10
  in every config (wonders=15 in the 100y reference run, ahead of
  Ketarov's year-10 race victory); tests 25/25, clippy -D, fmt,
  verify-data, determinism (3 configs) all green.
- M8 achievements (M8-D, this session): `achievements.rs` mirrors
  the 29 Appendix K AchievementTypes in official order (codes are
  final); `step_achievements` (pass 2.9) evaluates per faction —
  military kills >= 10, civilian kills >= 5 (new last-hitter
  split in the combat write-back), captures >= 5 (new counter),
  wars declared, treaties broken (per-empire mirrors of the global
  DiploStats), elimination credit given to every faction at war
  with an eliminated empire/pirate, successful intel missions >= 5
  (new per-empire counter), peak treaty income >= 50k, cumulative
  tax revenue >= 50M (mining proxy), war/peace year history
  (SpendAll/NoTimeAtWar from year 50), wonders built (M8-C), and
  the M8-B race victory condition being met (AchieveAllRaceVictory
  Conditions, pre-computed in an immutable pass). Unit test: the
  Appendix K code order. Verified: 46 achievements earned in the
  100y reference run (year-10 end), 33/35 in the 5y configs;
  tests 26/26, clippy -D, fmt, verify-data, determinism (3
  configs) all green.
- M7 force-structure projection (M7-I, this session):
  `order_fleet_construction` (pass 1.4) replaced its flat
  "one of each + growth" heuristic with a projection: threat
  level = wars fought (0-4; pirates fixed at 2) selects the
  per-role proportions (`force_structure_proportions`: military
  weight ~32% at peace -> ~80% at all-out war; freighter/
  resupply/colony weights shrink with threat), fleet targets =
  active-fleet baseline (floor 5 so total losses trigger a
  rebuild) x proportion + per-role minimums (one of each core
  hull always), and the build queue fills the biggest deficits
  first (2 per step, backlog 6) with the existing policy
  class-gates and design-book availability. Final report line:
  `military={share}%` of the galaxy's hull size. Unit tests:
  monotone military share + weight table + clamped threat, and
  a war twin queueing more military hulls than its peaceful
  twin via a direct projection call.
- M7 AI difficulty scaling (M7-H, this session):
  `NewGameOptions.difficulty` (0-4, 2=Normal; CLI `--difficulty`,
  also fed to the galaxy's creature-giantism) scales the AI
  empires: research output x(1+0.25t) and tax income
  x(1+0.15t), t = (difficulty-2)/2; AI empires start one or two
  tech tiers ahead (the scaled `ai_tech` gates the starting
  cruiser/carrier) and field a larger starting military (counts
  x(1+0.25t), min 1). `--difficulty-scaling` enables the dynamic
  ramp: once one faction holds >= 70% of all colonies, the
  remaining empires get research/income x(1+0.3x(share-0.7)/0.3),
  capped at 2x, reported as `diff={} ramp={}` on the [M7] line.
  Verified by sweep: d0/d2/d4 20y runs end with different
  winners (Ketaros / Dhayu race-condition / Ketaros). Unit
  test: ai_diff_t table + d4 out-researches and out-fields d0
  over 20 years (by military size).
  Test-suite fix: the purity tests' data bundle loads now resolve
  `data/`, `../data`, `../../data` — before this, every
  data-dependent test silently returned (the test binary's cwd is
  the crate dir), so the suite was green while those tests never
  ran; they now execute (0.0s -> 2.6s) and exposed two real
  bugs, both fixed: `found_colony` indexed `galaxy.systems` by
  the 1-based system id instead of `system_index` (colonies
  landed on the wrong system), and the pirate-track test had
  broken the id==index invariant via `retain`.
- M7 independent alien populations (M7-G, this session):
  `Planet.native_pop` (millions) is seeded at generation per the
  Alien Life option (`GalaxyOptions.alien_life`, 0=off/1=15%/2=30%/
  3=45% of colonizable non-moon worlds; 20-400M scaled by planet
  quality). `transfer_natives` (new pass 1.7, after the ship
  sub-ticks) subjugates worlds as colonies settle them — the
  population moves onto the colony's `native_population` (M2
  assimilation takes over) and the planet's own counter is zeroed;
  starting homeworlds/extra colonies do the same at startup (the
  old fixed 100M/50M placeholders are gone). `step_independents`
  (new pass 2.12): unclaimed worlds grow 3%/yr, capped by planet
  capacity (quality x size x 500M). Pirate raiding (M7-E) now
  also targets independent worlds — every playstyle except
  Mercenaries includes worlds with >= 50M natives in the
  candidate pool, raiding them for a 10% population tribute and
  harvesting 5% of the population. [M7] line reports
  `indep={worlds}(~{pop}M)`; the final line adds
  `creatures={}` + `indep={w}w(~{pop}M)`. Unit tests: level-3
  seeding vs level-0 (none), the subjugation transfer, and
  sub-raid-threshold worlds growing over 10 years.
- M6 subjugated dominions (M6-H, this session): the
  subjugation/dominion relation from spec §5.2 is now live in
  the headless diplomacy: when a war ends by weariness, the
  victor keeps the enemy as a dominion when the territory edge
  is decisive (`subjugation_holds`: loser <= 3 colonies and
  winner 2x, or a 1.5:1 margin of 3+ colonies); the dominion
  pays 10% of its annual state revenue to the overlord
  (tribute flows precomputed before the empires pass so the
  loop never re-borrows the vec, applied after it; capped at
  50% of revenue across several overlords) and breaks free once
  it outgrows the overlord by the same 1.5:1 ratio. `DiploStats`
  gains subjugations/independences/tribute_paid; the [M6] line
  reports them. Probe runs (wars end at ~4v4 colonies in this
  sim) rarely meet the decisive-margin bar, matching DW where
  subjugation is mostly a player-driven outcome; the tribute
  path is covered by a unit test (vassal flag + overlord richer
  than the free twin by exactly the tribute).
- M7 space creatures (M7-F, this session): `step_creatures`
  (pass 1.6, after the ship sub-ticks) activates the M1 creature
  placement — Kaltor (incl. giants), Desert/Rock Space Slugs,
  Ardilus and Silver Mist with their data-driven shield/hull/dps
  stats. Predators deal `base_damage_per_second x 3600` hull
  damage per year, pro-rated over every ship (any role) lingering
  in the system; victims go to Spent{Destroyed} and count in
  `CombatStats.creature_victims`. The Silver Mist drains shields
  (fully within half a year) and is killable only by fleets whose
  ships carry ion weapons (WeaponIonCannon/Pulse in the design
  book). Armed (non-base military) fleet strength x 0.5/yr grinds
  the creature's shield+hull; the strongest hunter — ion-armed
  strength for mists — is credited with a reputation boost (+2,
  +5 civility for Silver Mist per spec §3.1.5) and per-empire
  `creatures_killed` / `silver_mists_killed` counters, unlocking
  the DestroySpaceMonsters (>= 5) and DestroySilverMists (>= 1)
  achievements. [M7] line reports `creatures={destroyed}`. Unit
  test: a 5-ship hunting fleet at a creature's system destroys it
  in a year and gains the reputation boost.
- M7 pirate playstyles + fleet doctrines (M7-E, this session):
  `PiratePlayStyle` (Balanced/Pirate-Raider/Mercenary/Smuggler,
  random per pirate faction at startup) drives the headless pirate
  economy (spec §3.1.8/§5.6): protection pacts — feared empires
  (attitude <= -50) sign with 15%/yr probability and pay 3% of
  their colony income (siphoned in pass 2.11, `PirateStats
  .protections`), dropping out once the threat passes; colony raids
  (playstyle-weighted rate; loot 10% of colony income, development
  x0.95, approval -5, never against payers); smuggling (Smugglers
  earn 2% of the galaxy's colony income); piracy loot (5% of crash-
  salvage value paid as cash in the combat write-back). Playstyle
  modifiers: Smuggler +15% research, Mercenary +5%, both -10%
  ship maintenance. The pirate victory track (new in
  `step_victory`): pirates compete against pirates only on the
  game's criteria (threshold/time-limit/unopposed); void when the
  game has fewer than two pirate factions (a lone pirate cannot be
  unopposed against itself — caught by the reference run: a
  one-pirate game used to end instantly on "unopposed pirate
  victory"). `FleetDoctrine` (Balanced/Aggressive/Defensive/
  Skirmisher, deterministic per race+government) applies
  weapon/shield/armor multipliers in `build_combatant`. Startup
  pirate race selection falls back to a shared race when all
  pirate-capable races are taken (20-empire games left only the
  non-pirate Shakturi/Mechanoid). [M7] line: pirates/raids/
  protections; final line: per-pirate playstyle + income lines.
  Unit tests: the modifier tables and a pirates-only galaxy ending
  on the pirate time-limit track.
- M8 storylines (M8-E, this session): scripted event engine
  (step_storylines, pass 2.9): Return of the Shakturi — three
  invasion waves on year timers (20/35/50) that spawn mid-game
  Shakturi pirate hosts (spawn_storyline_faction: tech level 7,
  no fog-of-war, scattered fleet, at war with every faction,
  waves 2-3 flagged legendary); ancient-galaxy discoveries (the
  first hyperdrive / super-tech breakthrough grants galaxy-wide
  research bursts — the history of the galaxy unlocked); Age of
  Shadows (pre-warp games: pirate survivors rediscover technology
  at year 15); Legends disasters (game option, --no-disasters):
  plagues (population/approval), supernovae and creature swarms
  (fleet damage) at ~15%/year on the single RNG stream.
  Storyline eliminations award the DefeatShakturi and
  DefeatLegendaryPirates achievements. New: Empire.legendary,
  GameState.storyline_events / disasters / pre_warp,
  NewGameOptions.disasters. Unit test: mid-game faction spawn
  (fleet, relations, design-book lockstep). Verified: 60y
  time-limit run fires the waves (events=3 by year 20); the 100y
  reference run fires 4 events before its year-10 end; tests
  27/27, clippy -D, fmt, verify-data, determinism (3 configs)
  all green.

- M10 save/load (M10-A, this session): full-persistence
  save/load per spec §2.4. Every GameState type is now
  serde-serializable (the galaxy's DataBundle is deliberately
  excluded — saves are smaller and the bundle is reloaded from
  the data directory at load time; Galaxy gets a manual
  Serialize/Deserialize via a shadow struct, and the
  tuple-keyed habitat-damage map gets a (system, planet,
  value) triple encoding for JSON). `GameState::save_game /
  load_game` (serde_json, `float_roundtrip` enabled so f64s
  round-trip bit-exactly — verified: a save is byte-identical
  to its reload, and continuing a loaded game stays bit-
  identical to the original). Headless CLI: `--save PATH`,
  `--load PATH` (continues a saved game; a load-continue run
  reproduces a fresh run's reports exactly), `--autosave DIR`
  (rotating auto-01..05 slots every 10 game years). UI:
  File → Save Game…/Load Game… path dialog (message-bus
  feedback, reload resets camera/selection). The game editor,
  stats XML files, and theme hot-swap remain open M10 items.
- M8 race events (M8-F, this session): the 29 appendix
  `RaceEventType`s are live. Every race carries a
  deterministic signature schedule (1..=3 events, years 3..=26,
  shared by all empires of the race — `schedule_for_race`);
  `step_race_events` (pass 2.105) fires due events once per
  empire and applies the bulk effect the type name describes:
  war-weariness reset, +20% colony quality on tax, +20
  targetting (PredictiveHistory, spec §4.2 targeting rule),
  research progress gains/halving, weapon-project completion
  (Shakturi artifact), crash-research burst, fleet-upkeep
  discount (StrengthInNumbers), ±10 attitude shifts toward
  everyone (GrandPerformance / anti-xeno riots), territory
  reveals and hidden-location discovery, plague immunity +
  planet-damage healing (LuckyAvert), a giant Kaltor in a
  random system (UnderwaterLeviathan), and no-assimilate for
  the xeno-riot races. Character/ground-troop events are
  recorded (the headless sim has no character model).
  `GameState.race_events` records every firing (saves + [M8]
  line). Verified: forced-event battery test (flags, immunity,
  attitude delta vs free twin), 38/38 tests, clippy -D, fmt,
  verify-data, determinism (3 configs); the 100y reference
  run fires 10 events and still ends on Ketarov year-10.
- M8 plagues (M8-G, this session): the four appendix plagues.txt
  pathogens (Hrekatos Fever, Dekara Virus, Genetic Scrambling,
  Merturov Plague) are now first-class content: natural
  outbreaks weighted by natural_occurrence_level (retuned to
  DW-scale rarity), per-colony infection countdowns
  (duration_seconds, 600 s = 1 game year per the data typical-
  outbreak notes), mortality from mortality_rate while the
  infection is active, spread to healthy colonies in the same
  system (air-borne strains with infection_chance >= 25 also
  jump systems), the spec 10M population floor when the
  pathogen cannot eliminate, race exceptions from the data, and
  LuckyAvertColonyDisaster immunity. PlagueStats (outbroken /
  spread / pop_lost_m) is serialized and reported on the [M8]
  line. The tuning shift exposed two latent combat bugs, now
  fixed: (1) a captured hull destroyed before handover could be
  enlisted into the captor fleet with 0 hull (zombie ships);
  (2) ships killed after the ship pass — creature and disaster
  victims — were never culled in the step that killed them
  (terminal cull added). Verified: 39/39 tests (new plague
  battery: 10M floor, mortality, infection expiry, natural
  outbreaks, spread), clippy -D, fmt, verify-data, determinism
  (3 configs), all integrity checks pass, reference run still
  ends on Ketarov year-10.
- M8 planet destroyers + pre-warp progression (M8-H, this
  session): "Build Planet Destroyers when able" empires run a
  long build (6y + 0.5y per tech level) and commission a PD base
  (new `ShipRole::PlanetDestroyer`, size 1000, super-weapon
  focus-fire per spec §6.1). While at war the PD transits to the
  largest enemy colony (one year per move), holds position for a
  year, and — unless the colony's own war fleet (>= 50 military
  hull, so the PD no longer blocks itself) repels it — destroys
  the planet permanently: barren rock, zero population, cleared
  resources, `pd_destroyed` flag (uncolonizable), the colony and
  its spaceport cease to exist. A destroyed PD base is salvaged
  and rebuilt from 50% progress. The
  OwnOperationalPlanetDestroyer achievement is wired, and
  `combat_stats.pd_planets_destroyed` feeds the new `[M8] pd=`
  field. Pre-warp progression: the 12 appendix
  `PreWarpProgressEventType` milestones (verbatim, ids 1..=12)
  fire once per empire in pre-warp games (starting tech < 4) —
  first contacts (pirate/independent, normal), first ship /
  spaceport / mining / research station builds, colonization and
  hyperspace discoveries, first hyperjump (2 systems), first
  creature encounter, first military ship, first pirate raid
  (flag set by the pirate raid pass) — recorded in
  `GameState.prewarp_events` (serialized) with a 5% research
  boost each, reported as `[M8] prewarp=`. Tests: PD
  strike + repel battery (commission, transit, one-year focus
  fire, permanent planet loss, fleet repel) and pre-warp
  milestone firing (once-per-empire, warp-era games record
  nothing). Verified: 41/41 tests, clippy -D, fmt, verify-data,
  determinism (3 configs), reference run unchanged (Ketaros
  year-10), and a 200-year 1000-star stress run (deterministic,
  integrity clean, ~44s). Note: in the reference runs AI empires
  rarely declare war (1 battle in 100y), so PD strikes stay at
  0 there — the mechanism is exercised by the tests.
- M9-E tutorials (this session): all 11 official tutorial scripts
  from spec §7 are now in the game. `data/tutorials.txt`
  transcribes them (81 steps; the spec's quoted tutorial text is
  preserved verbatim, hotkey references mapped to this build's
  key layout: F1 galaxy, F2 colonies, F3 ships, F4 options, F5
  policies, F6 empire, F7 research, F8 diplomacy, V achievements,
  F10 Galactopedia) in a Part-13-style `T <id> <Title>` /
  `STEP <text>` format. New `dwu-data` tutorials loader with
  parser tests (T/STEP grammar, malformed-input rejection);
  `verify-data` now checks 11 tutorials, ids 1..=11, each with
  steps. UI: a Tutorials screen (View > Screens) lists all 11
  with launch buttons; launching opens the spec §7 tutorial
  window — draggable, step text, "Continue →" advancing the
  steps and "Close" dismissing it — in any mode (menu or
  in-game); the in-game Help > Tutorials menu and the main
  menu both launch tutorials. Tests: the screen paints (and
  asserts the spec's 11 tutorials are present), and a full
  launch → Continue×N run steps a tutorial to completion,
  closes the window, and posts the completion message.
  Verified: 43/43 dwu-core + 2/2 dwu-data + 10/10 dwu-ui
  tests, clippy -D, fmt, verify-data, CI headless smoke clean.
- M9-D options / policies / Galactopedia + quick starts (this
  session): the remaining "system" screens of the UI milestone.
  Options (F4) edits the new `UiSettings` — system/planet labels,
  nebulae, minimap, system info panel, message-log depth — and
  the world view and panels now honor all of them (the painter
  skips labels/nebulae when disabled; the log keeps
  `log_depth` lines). Policies (F5) lists the player's race
  doctrine settings (165 per policy file, standard or pirate)
  straight from the data files. Galactopedia (F10) is an
  in-game encyclopedia of every data-bundle topic group (race
  families, races, governments, components, fighters,
  facilities, plagues, research projects, resources) plus the
  29 achievements, with entry counts and a total. A Quick Start
  button on the main menu starts a 200-star / 6-empire / tech-6
  game with a time-based seed, skipping the wizard. Verified:
  43/43 dwu-core + 8/8 dwu-ui tests, clippy -D, fmt,
  verify-data, CI headless smoke clean.
- M9-C ships on the map + fleets (this session): ships are now
  drawn on the galaxy map — military hulls as small squares,
  civilian/dockyard ships as dots, empire-colored, cull-checked
  with everything else — and are right-clickable (new
  `WorldView::pick_ship`; ship picking is active from medium
  zoom, planets only when zoomed in). The ship context menu
  shows role/design/owner/phase/system/fleet and issues real
  orders through `apply_ctx_action`: Go To the selected system
  (Move mission + system target), Explore, Hold Station, Join
  Fleet #n / Leave Fleet (fleet_id), and Retire — all orders the
  existing ship pass executes. The Ships screen gained a fleet
  grouping (fleet number, members with role/phase/system, plus
  the unassigned count). A colonize order issued at system level
  now auto-selects the first colonizable uncolonized world of
  that system (the Colonize mission requires a planet target).
  Tests: orders and fleet round-trips drive the sim, and
  `pick_ship` recovers drawn ship marks. Verified: 43/43
  dwu-core + 6/6 dwu-ui tests, clippy -D, fmt, verify-data, CI
  headless smoke clean.
- M9-B context menus (this session): right-clicking a system or
  planet in the world view opens a context menu. Planets are
  picked with the same orbit math the painter uses (new
  `WorldView::pick_planet`; planets only when zoomed in,
  otherwise the system). The menu offers: Go To System (camera
  focus), Declare War / Make Peace against the holding empire
  (both relation sides flip, exactly the mechanic the AI
  diplomacy pass uses), Send Colony Ship Here (orders a spare
  colony ship — Colonize mission + system/planet target — which
  the ship pass then flies and seeds), and Cycle Tax Rate on
  your own colonies. The UI runs a two-phase pass (collect
  clicked actions under an immutable borrow, apply them through
  the single testable `apply_ctx_action`) so the sim is never
  mutated mid-layout. Headless tests: war/peace/colony-ship/tax
  actions drive the simulation and `pick_planet` recovers the
  painted orbit points. Verified: 43/43 dwu-core + 4/4 dwu-ui
  tests, clippy -D, fmt, verify-data, CI headless smoke clean.
- M9-A screen system (this session): the first UI milestone. A
  full-screen system replaces the galaxy map (DW-style): Colonies
  (F2), Ships & Bases (F3), Empire (F6), Research (F7), Diplomacy
  (F8), Achievements (V); Esc/F1 returns to the map, and the View
  > Screens menu does the same. The Empire screen shows the spec
  F6 overview (colony status, government attribute table, state
  cash/income/upkeep, research summary) and its "Have Revolution…"
  button runs the M8-I revolution code path (same as the AI
  empires). Added `ShipRole::name()` and ship-phase labels;
  `AchievementType::ALL` (29 types) backs the medals screen. New
  headless UI tests: every screen paints on a real 120-star game
  through `Context::run(RawInput)` (a bare egui Context is enough
  to drive layout), and the revolution action changes the player's
  government with the proper record. Verified: 43/43 dwu-core +
  2/2 dwu-ui tests, clippy -D, fmt, verify-data, CI headless
  smoke clean.
- M8 storyline governments (M8-I, this session): the last M8
  content piece. Revolutions — an empire whose average colonial
  approval sags far below the 45 baseline has a discontent-scaled
  chance (45-avg x 0.004/yr, capped 25%) to fall and adopt
  another available government (spec §EmpireAndColonies: "You can
  change your government style by having a revolution. But there
  are negative side effects... a temporary setback of development
  at your colonies"). All 13 appendix governments are selectable;
  the two storyline governments respect their availability codes —
  Way of the Ancients (2) unlocks with the Ancient-Galaxy
  first-hyperdrive discovery, Way of Darkness (3) with the
  Shakturi invasion waves. A revolution cuts every colony's
  development 15%, resets colonial approval to neutral, is
  recorded in `GameState.government_events` (serialized,
  `[M8] gov=` report), and awards the
  ChangeGovernmentToWayOfTheAncients /
  ChangeGovernmentToWayOfDarkness achievements when the storyline
  governments are adopted. `empire_revolution` is a public API
  (the M9 "Have Revolution" UI action calls the same path).
  Tests: revolution battery (discontent -> change + setback +
  approval reset) and storyline-government achievement battery
  (including no-op guards). Verified: 43/43 tests, clippy -D,
  fmt, verify-data, determinism (3 configs), reference unchanged
  (Ketaros year-10), 200y probes show revolutions in the wild
  (2 in 300 stars/8 empires).
- M8 content is now complete (victory, wonders, achievements,
  storylines, race events, plagues, planet destroyers, pre-warp
  progression, storyline governments). Next: remaining verification is the render-side FPS check on a
  GPU machine (logic-side 1000-star gate is CI-enforced and
  passing; the scripted 2-empire playthrough gate is
  CI-enforced and passing). (M1-M10 milestone content is
  complete: save/load/autosave, stats XML, theme hot-swap,
  saved-galaxy-as-map, game editor with scripted events/
  scenarios.)- M10-F stats XML + theme hot-swap + saved-galaxy-as-map (this
  session): the last three M10 items. (1) Stats XML (spec
  §14.19): the sim samples per-empire statistics (cash,
  population, colonies, territory, military, research) at every
  year boundary into `GameState.stats_samples` (serde-default so
  older saves still load) and writes them as XML
  (`write_stats_xml`; `dwu-headless-sim --stats PATH`); a new
  Statistics screen (View > Screens) shows the yearly samples
  and a first-vs-latest growth comparison. (2) Theme hot-swap:
  `dwu_data::list_themes` lists the built-in data set plus every
  `Customization/<name>/` folder with override-file counts and
  an optional `summary.txt`; the main menu's Change Theme screen
  activates a theme live (bundle reloaded with the theme
  overrides, a running game re-pointed at the new bundle);
  `dwu-headless-sim --theme DIR` selects a theme. (3) "Use saved
  galaxy as map": `galaxy_from_save` extracts the galaxy from a
  save; the wizard's new checkbox + path field (and
  `dwu-headless-sim --map SAVE`) start a new game — empires,
  colonies, fleets — seeded onto that existing galaxy. Tests:
  yearly sampling + XML well-formedness, the save → map → new
  game → run round-trip (system counts preserved), theme
  listing (recursive override counts, summary.txt), and the
  statistics screen painting on a sampled game. Verified: 45/45
  dwu-core + 3/3 dwu-data + 12/12 dwu-ui tests, clippy -D,
  fmt, verify-data, CI headless smoke clean; the 1000⭐/20/5y
  reference line is byte-identical to the pre-change baseline
  (sampling is RNG-free).- M10-G game editor (this session): the last M10 item. A new
  `dwu-core::editor` module: (1) place/erase/edit primitives —
  `edit_add_system`, `edit_add_planet`, `edit_set_planet`,
  `edit_add_resource`, `edit_add_nebula`/`edit_remove_nebula`,
  `edit_add_ruin`, `edit_add_creature`, `edit_place_colony`,
  `edit_erase_colony`, `edit_place_ship` (ships and base roles
  from the design book), `edit_set_empire` (race/government/cash),
  `edit_set_relation`, `edit_place_plague`; (2) scripted events
  (spec §14.17) — triggers (always / empire colonies ≥ n /
  project completed / war declared / year reached) fire action
  lists (message, set cash, declare war, make peace, grant
  research, deploy plague, destroy a planet, victory, defeat)
  immediately or after a delay; (3) scenario objectives (colonies
  / project / survive-until) with victory/defeat/continue results
  that can end the game. `step_editor` runs in the sim step.
  Scenario files (`events.txt`, `objectives.txt`) parse from
  `data/scenarios/default/` (included). UI: a Game Editor screen
  (Game menu → Game Editor, View → Screens → Editor) with the
  placement tools acting on the selected system, empire tools,
  the event/objective/event-log listings, "Load scenario" and
  "Save map" (editor_map.json — startable via New Game's "use
  saved galaxy as map"). Tests: editor placement round-trips,
  scripted event firing (immediate + delayed) and victory
  objective ending the game, scenario file parsing, editor screen
  paint + tool application. Verified: 48/48 dwu-core + 3/3
  dwu-data + 14/14 dwu-ui tests, clippy -D, fmt, verify-data,
  CI smoke clean; the 1000⭐/20/5y reference line is
  byte-identical to the pre-change baseline (editor logic is
  RNG-free).- Cross-cutting gates (this session): the final two spec gates.
  (1) 1000-star performance: `dwu-headless-sim --bench` measures
  simulation throughput and enforces the logic-side budget — the
  sim must exceed 1.0 game-years/s (4x the 16x real-time
  requirement of 0.267 years/s) to leave the wgpu renderer
  headroom for >=30 FPS at 1000+ stars. Measured 3.15
  game-years/s (release, 1000 stars, 10 years) — gate wired
  into both CI jobs (Linux x86_64 + macOS aarch64) and PASSING.
  The render-side half needs a GPU: on a GPU machine run the
  release `distant-worlds` binary with a 1000-star galaxy and
  confirm 30+ FPS on the Galaxy screen (headless CI cannot
  exercise wgpu). (2) Scripted 2-empire playthrough: new
  `dwu-playthrough` binary runs a full narrated simulation (two
  empires, war, research, wonders, game end) and asserts
  invariants over the whole run — wired into both CI jobs;
  reference run: war in year 4, Ketaros territory victory in
  year 11.




- M11-GUI: solar-system view + upgraded original artwork.
  - New `system_view.rs`: double-click a system on the galaxy map to
    enter its dedicated solar-system view (spec line 683): the star
    drawn per spectrum/stage (layered glow + flare spikes; black hole
    = dark disc + accretion ring; neutron star = core + pulsar beams;
    white dwarf; supernova), orbital rings for every planet, planets
    as shaded spheres (lit side + shadow, size from the size field,
    elliptical rings on ringed/gas giants), resource icons, colony
    markers in the empire color, moons on micro-orbits, asteroid
    fields (dotted ring + golden-angle rocks), gas clouds, galactic
    nebulae overlapping the system, ruins, and creatures per type.
    Ships/bases are drawn from their role (warship arrowheads,
    civilian capsules, hexagon bases with empire flags, planet
    destroyers as diamonds) each with a shield bar above (blue =
    remaining, red = lost) per spec line 685. Click picks a planet/
    ship/star (picker and painter share one layout function so they
    can never disagree); right-click opens the same context menu as
    the galaxy map (system/planet/ship actions); a read-only info
    panel shows the selection (star details, planet surface/quality/
    colony/resources, ship role/shield/hull); Esc, the "Back to
    Galaxy" button, or a double-click returns to the galaxy map.
  - Upgraded galaxy-map art in `world_view.rs`: the same star/ship
    painters (spectrum stars with glow; role-shaped ships + shield
    bars) are now shared with the system view; ship drawing moved to
    a `ShipMark` record (id/pos/color/role/shield fraction/size).
  - All rendering is original procedural artwork in the spec's
    2D-top-down sci-fi style (spec line 59 forbids copying the
    original game's assets). Orbital animation is a pure function of
    the game clock (no RNG, no wall clock) so it stays deterministic.
  - Tests: headless system-view paint + pick (star at center, planet
    on its ring) on a fresh generated game, plus a barren system
    with no planets/ships; determinism of the layout. Verified:
    48/48 dwu-core + 3/3 dwu-data + 16/16 dwu-ui tests, clippy -D,
    fmt, verify-data ALL CHECKS PASSED, smoke + bench + playthrough
    gates (sim side unchanged, reference line identical).

- M11B-GUI: original DW:U artwork (assets/game/) wired into the
  renderer. The curated subset of the game's PNG art — star discs
  per spectrum/stage (main sequence, red giant, white dwarf, neutron,
  black hole, supernova), galaxy-map planet tiles, close-up planet
  surface sprites, ship/base sprites for the 11 ship families the
  22 races use, and creature sprites — lives in `assets/game/` and
  is packed at startup by `sprite_atlas.rs` into a single 2048px egui
  texture atlas (sprites capped at 96px, shelf-packed, linear
  filtering). Both views draw the original sprites first and fall
  back to the procedural M11 art when the folder is absent, so a
  fresh clone still runs on any machine; override the location with
  $DWU_ASSETS. Ship sprites resolve per race via races.txt
  DesignsPictureFamilyIndex. Repo is PRIVATE: it contains original
  game assets for personal use and must never be made public.
  Verified: 48/48 dwu-core + 3/3 dwu-data + 18/18 dwu-ui tests
  (incl. headless atlas load/paint + absent-folder fallback),
  clippy -D, fmt, verify-data, smoke/bench/playthrough gates.
