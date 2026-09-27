# 19f — Hidden threats (ten Dark-Farms-like threats) — implementation briefs

Build **after 19b has merged**: every threat is data + a spread rule on the 19b threat framework
(`src/sim/scenario/threats/framework.ts`, `tasks/19b-dark-farms.md` §5.0/§5.A). Each threat is one module
`src/sim/scenario/threats/<name>.ts`, behind its own flag, independent of the others (any subset may be on together),
and can be built in parallel by separate agents. Read `CLAUDE.md`, `tasks/19-mod-layer-scenarios.md` §19f,
`tasks/MODLAYER-DESIGN.md` and the 19b brief first. `$C` = `$DWU/Customization/DistantWorldsExpanded-main/
DistantWorldsExpanded`; C# cites are `DistantWorlds.Types/` unless noted. Nothing here is a port; cite the C# analogue
of each composed step.

## 0. Shared threat framework

### 0.1 Anatomy — every threat has the same seven parts
| Part | Meaning | Framework support (19b) |
|---|---|---|
| Hidden state | sites / carriers nobody sees; lives in `galaxy.scenario.state.<threat>` | `threatState` (plain data + graph refs, §0.5) |
| Spread rule | how it grows each period / year | `registerScenarioPeriodic` / `registerScenarioYearly` handler |
| Trigger | when it declares itself | threat-specific predicate evaluated in the periodic handler |
| Faction | the new hostile power created at the trigger | `createThreatFaction` (→ `createEmpireMidGame`, locked wars, designs) |
| Dirty methods | how it fights beyond the stock AI | `invadeFromInside`, `flipToFaction`, `refitInPlace`, event handlers |
| Discovery | how players find it before (and after) the trigger | `revealTo` / `threatKnownSites` (levels 1 rumour, 2 suspected, 3 confirmed) |
| Arc | hints, rumours, NewsNet, climax, end | `arcMessage` / `arcNews` (once per stage per recipient), `threatGameEnd` |

### 0.2 Scenario folder and flags
One scenario `game/scenarios/hidden-threats/` holds all ten (data files below are per threat, merged into the shared
overlay files). Manifest flags: `threatGreyTide`, `threatCult`, `threatSilence`, `threatDoppelgangers`, `threatHive`,
`threatTimeBomb`, `threatGhostArmada`, `threatExchange`, `threatRobotMutiny`, `threatCorporateCoup` (all default false)
and `threatsGameEnd` (default true: a threat's defeat condition ends the game). Params are prefixed with the threat
name (e.g. `greyTideNestsPerYear`). Dark Farms stays its own scenario; to combine them, the manifest may declare
`"include": ["darkfarms"]` (**D3**, a small modlayer addition: included overlays are applied first, flags merged); if
D3 is not available, a threat that needs 19b data (only Robot Mutiny reuses the Harvester race) carries its own copy.

### 0.3 Hook additions (on the 19b `scenarioEmit` mechanism; one guarded line each, no Rnd off-path)
| Event / query | Site | C# analogue | Used by |
|---|---|---|---|
| `intelMissionCompleted {empire, mission, outcome}` | end of `completeIntelligenceMission` (espionage.ts 1596) | Empire.6.cs 117 | Cult, Exchange, Coup |
| `empireEliminated {empire, conqueror}` | top of `empireCompleteTeardown` (events.ts 1199) | Empire.cs 4874 | Ghost Armada |
| `researchCompleted {empire, node}` | end of `doResearchBreakthrough` (researchTick.ts 639) | Empire.3.cs 2500 | Time-bomb |
| `characterCreated {character}` | end of `generateNewCharacter` (characters.ts 6861) | Empire.6.cs 4402 | Cult, Coup |
| `abandonedShipClaimed {bo, empire}` | end of `investigateAbandonedBuiltObject` (ownership.ts 1246) | Empire.1.cs InvestigateAbandonedBuiltObject | Doppelgangers |
| query `hyperDenyExempt(bo, location) → boolean` | inside `detectHyperDeny`'s location loop (movement.ts 734) | BuiltObject.1.cs 1737 | Silence |
The 19b events (`colonyOwnerChanged`, `builtObjectOwnerChanged`, `builtObjectRemoved`, `habitatBombarded`) cover the rest.
A query hook returns the stock answer unless a flagged handler overrides it, and never draws Rnd.

### 0.4 Rnd policy (all threats)
Draws only inside the threat's own yearly/periodic handler and its flag-gated event handlers, iterating in fixed orders
(sites/carriers by id, `galaxy.empires` order, `empire.colonies` order, `galaxy.habitats` index order, characters in the
empire's character-list order). Stock functions called from a handler (createEmpireMidGame, generateDesignFromSpec,
mission assignment, `infectWithPlague`, `generateDebrisField` …) draw their own stock draws — fine, they are inside the
hook. Flag off ⇒ zero draws (handlers gated by `flag`). Query hooks never draw.

### 0.5 Save state
`galaxy.scenario.state.<threat>` — plain objects with graph references (Habitat, Empire, BuiltObject, Character, Design,
GalaxyLocation), no new classes. Each module exports its `…State` interface. Every threat has a save/load test at each
phase (hidden, triggered, ended): digest after load + N seconds equals the uninterrupted run.

### 0.6 UI (shared)
- Messages go through `arcMessage` / `arcNews` → stock EmpireMessages → `src/ui/messageRouting.ts` (popups for
  GeneralBadEvent, ticker/stub-list entries for hints via `messageStubs.ts`); every message carries a `subject`.
- The 19b "Threats" map overlay (`src/ui/mapOverlays.ts`) draws every threat's `threatKnownSites(galaxy, player)`
  (the framework selector aggregates all registered threats; each module registers a `knownSites` provider).
- Selection panel: one read-only "Threat" row for a selected object that is a known site/carrier.
- Wizard: the modlayer Scenario page shows the flags/params.

### 0.7 Test template (`test/scenarioThreat<Name>.test.ts`, harness `createScenarioGame`)
1 off-path (flag off → no state, no extra draws; `repin --check` clean) · 2 seeding · 3 spread arithmetic · 4 trigger →
faction/transfer · 5 dirty method · 6 discovery → knowledge + message · 7 counterplay ends it · 8 save/load at each
phase · 9 game end (handler called with the threat's code) · 10 the threat's AI statements. Force behaviour with params.

### 0.8 Acceptance (all threats)
Flag off: 0 pin moves, suite green, typecheck clean. Flag on: a seeded `// @slow` soak reaches the trigger and runs 20
years past it without exceptions, ≤ 5% slower than flag off. Every arc stage is reachable in a test.

Game-end codes: 1911 Grey Tide … 1920 Corporate Coup (defeat = code, victory/containment = code + 100).

---

## 1. Grey Tide — self-replicating mining swarm
**Concept.** A dormant swarm seeds in an unexplored gas giant, eats asteroid fields and mining stations, and multiplies.
**Data.** New race `Tide` (`BasedOn ;mechanoid.txt`, portrait reuse; 19b D1), `designTemplates/tide/` `miningship.txt` (armed "harvester drone": mining + 2 weapons + armor), `gasminingstation.txt` (the **nest**:
base with weapons + shields); GameText `GreyTide *`. Params: `greyTideSeedYear` (60), `greyTideDronesPerNestYear` (3),
`greyTideNestYears` (4), `greyTideEatPerYear` (resource units), `greyTideScanPct` (15).
**Hidden state / spread.** `nests[{habitat, bornDate, drones[], eaten}]`. Seed: at `seedYear`, one GasGiant/FrozenGasGiant
in a system no empire has explored (`SystemVisibilityStatus.Unexplored` for every empire, visibility.ts 32), chosen by
`rnd.next(0, candidates.length)`. Periodic: each nest builds drones (free); a drone at an asteroid depletes its
resources (`greyTideEatPerYear`), attacks mining stations (stock attack missions); when an asteroid is exhausted it is
removed (`doPlanetRemove`, events.ts 937; Habitat.cs 6379). A nest older than `nestYears` sends one drone to the nearest
unexplored-or-unowned gas giant → new nest (exponential, capped by param `greyTideMaxNests` 40).
**Trigger / faction.** The Tide is a **pirate-kind** faction from the start (`createThreatFaction({kind:'pirate'})` at
the seed habitat, no diplomacy), invisible until first contact; "declaration" = first mining station destroyed.
**Dirty.** None beyond eating the economy; drones never attack colonies, only stations/asteroids/miners.
**Discovery / counterplay.** Nests are ordinary bases once a system is explored; long-range scanners
(`empire.longRangeScanners`, civilianAI.ts 2593) within range reveal level 3; destroying a nest kills its undeployed
drones. Ends when no nest survives.
**Sim.** 1 `greyTideYearly` (seed); 2 `greyTidePeriodic` (build drones: `new BuiltObject` + `addBuiltObjectToGalaxy` at
the nest, as `createIndependentTrader`, independentTraders.ts; Galaxy.7.cs 4498; assign ExtractResources/Attack missions,
assign.ts 94); 3 `eatAsteroid` (resource amounts on the habitat; removal via doPlanetRemove); 4 `foundNest`
(`generateDesignFromSpec` nest + `addBuiltObjectToGalaxy`); 5 `onBuiltObjectRemoved` (nest death). Analogue for the whole:
the super-pirate spawn (`galaxyEventSuperPirates`, pirates.ts 1049; Galaxy.9.cs) and `findNearestHabitatUnoccupiedSystemWith…`
(pirates.ts 1025).
**AI.** Drones never target colonies; a nest never moves; nest count after N years = min(cap, formula) in a closed test.
**UI.** Nest sites in the overlay; hint "mining output collapsing at {system}". **Risks.** Asteroid removal re-indexes
habitats (FixResourceMaps) — batch removals once per period. **Size** 2 days.

## 2. The Cult — belief spreading between characters
**Concept.** A creed passes from character to character; converted governors turn colonies; converted colonies secede
into a theocracy; the cult uses assassins and martyrs.
**Data.** GameText `Cult *` (creed name from a list); faction government = "Way of Darkness" (governments.txt id 7; the
governments file is not overlaid in v1, so it is chosen by id). Params: `cultSeedYear` (40), `cultSpreadPct` (8),
`cultAmbassadorPct` (15), `cultSecedeColonies` (4), `cultMartyrPct` (30).
**Hidden state / spread.** `converted: Character[]`, `colonies: Habitat[]` (a colony is cult-held when its governor is
converted). Seed: one Spiritual-trait (CharacterTraitType.Spiritual) character, rnd pick. Periodic (60 days): each
converted character converts each non-converted character at the same location (`findCharactersAtLocationOrTransferring`,
characters.ts 4896) with `cultSpreadPct`, halved for Logical/Lawful/Patriot traits, doubled for Spiritual; an
**Ambassador** converts at `cultAmbassadorPct` the receiving empire's leader/governors present at the capital — the
cross-empire vector. `characterCreated` event: a new character at a cult-held colony starts converted with 25%.
**Trigger / faction.** When one empire has ≥ `cultSecedeColonies` cult-held colonies with approval below the stock
rebellion threshold (colonyTick.ts 340 `checkSatisfaction`; Habitat.cs 5992), the cult declares: `createThreatFaction`
adopting none, then each cult-held colony gets cult militia in `invadingTroops` (framework `invadeFromInside`, troops
of the colony race) — the stock `identifyLeavingEmpire` (events.ts 1539; Habitat.cs 5948 LeaveEmpire) sends a
rebelling colony to the empire whose troops invade it, so the colonies join the theocracy.
**Dirty.** Converted intelligence agents stay in their empire as double agents: `intelMissionCompleted` handler leaks
the mission to the cult; martyrs: when a converted character is killed, `cultMartyrPct` chance to convert every
character at the location.
**Discovery / counterplay.** Counter-intelligence agents in an empire reveal converted characters (level 3) at
`espionageFactored/1000` per period; the player can dismiss a character (existing) or assassinate (existing
AssassinateCharacter mission); high happiness blocks secession (approval check). Ends when no converted character remains
or the theocracy is eliminated.
**Sim.** 1 `cultSeed`; 2 `cultSpread`; 3 `cultTrigger` (+ faction; analogue `haveRevolution`, treasury.ts 513;
Empire.10.cs 4447); 4 `onCharacterCreated`; 5 `onIntelMissionCompleted`; 6 `onCharacterKilled` — needs one more emit,
`characterKilled {character}` at the top of `Character.kill` (characters.ts; Character.cs Kill), added to §0.3 by this threat.
**AI.** An AI empire that confirms ≥ 2 converted characters dismisses them within one period (testable).
**UI.** Character panels: "Cultist (confirmed)" row; overlay marks cult-held colonies known to the player.
**Risks.** Character lists are large — iterate by location buckets. **Size** 2.5 days.

## 3. The Silence — a ruin signal that kills hyperdrives
**Concept.** A precursor ruin starts transmitting; hyperdrives fail in a widening radius; pirates are immune; an
expedition must reach and shut the source.
**Data.** GameText `Silence *`. Params: `silenceStartYear` (50), `silenceGrowthPerYear` (4000 units radius),
`silenceMaxRadius` (120000), `silenceShutdownDays` (60).
**Hidden state / spread.** `{source: Habitat, zone: GalaxyLocation, radius, shutdownProgress}`. Start: a habitat with
a ruin (`galaxy.ruinsHabitats`) chosen by rnd; zone = `generateRestrictedZone(galaxy, name, message, 2×radius, x, y, 0)`
(story/storyStart.ts 304; Galaxy.3.cs GenerateRestrictedZone) — type RestrictedArea, effect **HyperjumpDisabled**
(galaxyLocation.ts 21), which the stock `detectHyperDeny` (movement.ts 734; BuiltObject.1.cs 1737) already honours. Grow:
each period `removeGalaxyLocationIndex`, resize (width/height, re-centre xpos/ypos), `addGalaxyLocationIndex`
(galaxy.ts 1686).
**Trigger / faction.** No faction: the "declaration" is the zone appearing (NewsNet). Pirates immune: the
`hyperDenyExempt` query returns true for `bo.empire.pirateEmpireBaseHabitat !== null` when the location is the Silence zone.
**Dirty.** None; the danger is stranded fleets and pirates raiding inside.
**Discovery / counterplay.** Level 3 to everyone at start (it is loud); shutting it down: a ship of any empire with a
TroopCompartment (or any Explore-mission ship) holding position within 1000 of the source for `silenceShutdownDays`
cumulative → zone removed, story reward (the ruin's research bonus). Progress resets if the ship leaves.
**Sim.** 1 `silenceStart`; 2 `silenceGrow`; 3 `silenceShutdownCheck` (ships near source via getBuiltObjectsAtLocation,
stationPlacement.ts 207); 4 `hyperDenyExempt` handler; 5 end.
**AI.** AI empires with colonies inside the zone send one exploration ship to the source within one year (assign Move
mission to the source, assign.ts 94) — testable.
**Risks.** Big zones cover whole regions: path-finding into sub-light travel is slow — the growth cap. The stock
`generateRestrictedZone` shows a name/label: good. **Size** 1.5 days.

## 4. Doppelgangers — captured ships come back as sleepers
**Concept.** Ships you lose to capture are returned (found derelict, or recaptured) looking like your own designs; some
are sleepers that turn on you. Recaptured ships are suspect.
**Data.** GameText `Doppel *`; no race (the faction takes the race of the empire with most sleepers). Params:
`doppelSleeperPct` (35), `doppelTurnCount` (8), `doppelPlantPerYear` (2).
**Hidden state / spread.** `sleepers[{bo, trueOwner(original), since}]`. Vectors: (a) `builtObjectOwnerChanged` where
`to` is the ship's original owner after an enemy/pirate held it (recapture) → `doppelSleeperPct` roll; (b) yearly, for
each empire that lost ships to capture, plant up to `doppelPlantPerYear` derelicts of that empire's own designs near its
territory with `generateUnownedShipAtLocation` (storyStart.ts 921; Galaxy.5.cs 3467) — the empire's explorers claim them
(`abandonedShipClaimed` event, ownership.ts 1246) → sleeper.
**Trigger / faction.** Galaxy-wide sleepers ≥ `doppelTurnCount` → `createThreatFaction('The Mirror', race = majority
original owner's race)`; every sleeper `flipToFaction` **in place** (inside fleets: `takeOwnershipOfBuiltObject(…,
removeFromFleet true)` so it leaves the fleet, then attacks its former fleet-mates).
**Dirty.** The turn is the ambush itself; sleepers carrying troops also launch boarding (stock assault pods).
**Discovery / counterplay.** Trace-scanner rule as 19b §5.F.23 against own ships; scrapping or retrofitting a suspect
(retrofit completion clears the flag: `builtObjectOwnerChanged` does not fire, so hook retrofit via a
`builtObjectRefitted` emit in constructionQueue.ts ~631) cleans it.
**Sim.** 1 `onOwnerChanged` (recapture roll); 2 `doppelPlantYearly`; 3 `onAbandonedShipClaimed`; 4 `doppelTrigger`;
5 detection periodic. Analogues: `processBoardingAssault` capture (boarding.ts 560/682; BuiltObject.1.cs 2954).
**AI.** An AI empire retires (`Retire` mission) every confirmed sleeper it owns within one period.
**UI.** Selection panel "Suspect (recaptured)" for own recaptured ships (always shown — the player's cue).
**Risks.** Captures are rare in AI-vs-AI play; the planting vector guarantees the threat develops. **Size** 1.5 days.

## 5. The Hive — the independents are one mind
**Concept.** Every independent colony is a node of one hidden mind. Each world absorbed by an empire (or protected by
pirates) stays a node; at a threshold the Hive declares and all nodes rise. The land-grab is the fuse.
**Data.** GameText `Hive *`; faction government "Hive Mind" (governments.txt id 11); race = the most common node race.
Params: `hiveThresholdPct` (40 % of the original independents absorbed), `hiveMilitiaFactor` (1.5).
**Hidden state / spread.** `nodes: Habitat[]` = `galaxy.independentColonies` at scenario start (game start);
`absorbed: Habitat[]`. `colonyOwnerChanged` with `from === independentEmpire` → absorbed (no Rnd). Pirate-protected
nodes (pirate colony control, pirates/pirateColonyControl.ts) count as absorbed.
**Trigger / faction.** absorbed / nodes ≥ `hiveThresholdPct` → `createThreatFaction('The Chorus', adoptOnly)`; every
still-independent node is transferred with `takeOwnershipOfColonyFull(…, faction, false, false)` (ownership.ts 441;
Empire.1.cs 54); every absorbed node gets node-race militia × `hiveMilitiaFactor` via `invadeFromInside` (strength as the
`checkSatisfaction` militia, colonyTick.ts 380-395).
**Dirty.** Nodes feed intelligence: at the trigger the faction gets one agent per 3 nodes (generateNewCharacter).
**Discovery / counterplay.** Hints scale with absorption (rumour at 20%, "synchronised dreams" at 30%); agents on
missions against independent colonies (none exist in stock) → instead: counter-intelligence inside an empire reveals the
node status of its absorbed colonies (level 3), letting a player garrison them before the fuse.
**Sim.** 1 `hiveInit` (first yearly); 2 `onColonyOwnerChanged`; 3 `hiveTrigger`; 4 hints. Analogue:
`reviewIndependentColonies` (independentTraders.ts 195; Galaxy.1.cs 827).
**AI.** None beyond the faction's stock AI; testable: at trigger every original node is owned by the faction or has
invading faction troops.
**Risks.** Few independents on small maps → threshold on count with a minimum of 5 nodes, else the threat never seeds.
**Size** 1.5 days.

## 6. Time-bomb tech — precursor tech the Cult turns into terror bombs
**Concept.** Ruins hold precursor research with huge bonuses and a planet-killing failure mode. The Cult (§2) is its
actor: cult cells on colonies that hold the tech set it off every year as terror attacks; after secession the theocracy
takes the tech with it and detonates enemy colonies on purpose. Tech leaders infiltrated by the cult are most exposed.
**Dependency.** `scenarios/timebomb/scenario.json` includes `cult`. The framework cannot force an included flag on, so
the module is **inert until the `cult` flag is on** (no state, no draws; the flag label says "needs The Cult").
**Data.** `research.txt` overlay: 3 nodes ("Precursor Lattice Drive", "Singularity Reactor", "Deep Resonance
Manufacturing"), special function 0, unlocked only by ruins; GameText `TimeBomb *` (+ `Security Kind cultBomb`,
`Reputation Cause timeBomb.cultDetonation`). Params: `timeBombRuins` (3), `timeBombChancePerMillePerColony` (2),
`timeBombMaxChancePct` (5), `timeBombCultWarChancePct` (10), `timeBombCounterIntelYears` (1),
`timeBombDetonationGrievance` (30), `timeBombStartYear` (30), `timeBombDefeatDestroyed` (5).
**Hidden state.** `{nodes, holders, destroyed, cells: CultCell[], cultHosts, cultNodes, counterIntelUntil, outcome}`.
Placement: `selectRuinsUnlockTech` on rnd-chosen ruin-less planets (ruins.ts 492; Start.2.cs 1274-1304). Holders: the
stock tech trade / theft spreads the nodes; `researchCompleted` records them. A **cell** is a colony of a non-cult
empire with ≥ 1 converted character present (cult.ts `convertsAt`; a converted governor is one); cell strength = the
converts present, the governor counting twice.
**Trigger.** Yearly, per cell colony (empire order, colony order; a roll only when the chance is > 0, one detonation per
empire per year): `perMille = min(chancePerMille × nodes × strength, maxChancePct × 10)` where `nodes` = the owner's held
nodes, max'd with the cult faction's once it exists; while the cult faction is at war with the owner and holds ≥ 1 node,
`perMille = max(perMille, cultWarChancePct × 10)` (a deliberate war detonation). `rnd.next(0, 1000) < perMille` →
`detonate` — the explosion set-up of `destroyHabitat` without the attacker credit block (combat/damage.ts 1627). No
colony without a cell can explode.
**Cult faction.** `cultHooks.triggered` (cult.ts `cultTrigger`) records each host; the faction inherits the nodes its
hosts hold (its tech-tree entries set researched + the stock recalculation). `abandonTech` never touches its nodes.
**Discovery / counterplay (19m, flag `internalSecurity`).** A cell on a holder colony registers hidden thing kind
`cultBomb` (target the colony, site = the cell) and opens the owner's lead at *suspected*; the first failed roll there
(or a 19m detection sweep) *confirms* it. A `purge` on the lead, or an investigation that confirms it, runs
`securitySlots.cultBombResolved` → `defuseCell`: every convert at the colony is de-converted (cult.ts `deconvert`) and
the cell dissolves. `abandonTech` still strips a normal empire's nodes (level 1 at the first detonation; level 3 for
empires whose scientists analysed two). Reputation (19o): a cult detonation records `timeBomb.cultDetonation` for the
victim against the live cult faction. Event log (19p): cell formation is logged unseen (`seenBy: []`) and reaches the
owner through the *suspected* message; detonations and defusals are logged through their messages / news.
**End.** Defeat (1916) when `destroyed ≥ timeBombDefeatDestroyed` **only while the cult is undefeated** (faction alive or
≥ 1 cell). Contained when the cult's own containment ends (cult.ts `cultEndCheck`: arc ends `contained`, the cult's
2012 game end stands, no second one), or (2016) when no empire and no cult faction holds a node after ≥ 1 detonation.
**AI.** A confirmed `cultBomb` lead → `purge` (security.ts `aiSecurityChoice`). After losing a colony to a cult
detonation an AI empire puts its idle agents (or, if none is on it, its first busy agent) on counter-intelligence for
`timeBombCounterIntelYears`. At knowledge level 3 with ≥ 1 loss it still abandons the nodes.
**Sim.** 1 `timeBombPlace`; 2 `onResearchCompleted`; 3 `timeBombYearly` (`syncCultNodes`, `syncCells`, rolls);
4 `detonate`; 5 `defuseCell`; 6 `abandonTech`. **Tests** `test/scenarioThreatTimeBomb.test.ts`.
**Risks.** Removing the capital → stock capital re-selection. **Size** 1.5 days (+1 for the cult rework).

## 7. Ghost Armada — wreckage reactivates under a dead empire
**Concept.** When an empire dies, the wrecks of its lost warships rise as a ghost fleet under its name and raid its
destroyer (LLM persona via 18c when available).
**Data.** GameText `Ghost *`. Params: `ghostDelayYears` (3), `ghostMaxShips` (30), `ghostRaidRange`.
**Hidden state / spread.** `wrecks[{design, x, y, empireId, date}]` recorded by `builtObjectRemoved` when the ship
`hasBeenDestroyed` in combat and is military (cap per empire); `pending[{deadEmpireName, race, conquerorId, date}]` from
`empireEliminated` (events.ts 1199; Empire.cs 4874). (Replace the record with 19e-7 wreckage when that lands.)
**Trigger / faction.** `ghostDelayYears` after an elimination: a debris field at the densest wreck cluster
(`generateDebrisField`, storyStart.ts 742; Galaxy.5.cs 3498) and `createThreatFaction({kind:'pirate', race: dead race,
name: 'Ghosts of <dead empire>', enemies: [conqueror]})`; up to `ghostMaxShips` recorded designs re-created at the field
(`new BuiltObject(design)` owned by the faction, damaged components as in generateDebrisField). Persona hook: if the 18c
persona layer is present, register the faction with the dead empire's persona; otherwise stock pirate AI with
aggressive posture.
**Dirty.** Raids only the conqueror's colonies/bases (scenario targeting: Attack missions on the conqueror's nearest
undefended bases within `ghostRaidRange`).
**Discovery.** Rumour when the field appears; the field is visible like any debris field. Ends when the faction's
ships are gone (`teardownIfDead`).
**Sim.** 1 `onBuiltObjectRemoved` (record); 2 `onEmpireEliminated`; 3 `ghostRise`; 4 `ghostTargeting` periodic.
**AI.** Ghost ships never attack an empire other than the conqueror unless attacked (testable).
**Risks.** Designs of a dead empire referenced after teardown — keep the Design objects (graph refs) in state.
**Size** 1.5 days (+0.5 with persona wiring).

## 8. The Exchange — a neutral merchant-spy faction funding the underdog
**Status: rewritten (merchant-spy faction).** Module `src/sim/scenario/threats/exchange.ts`, flag `threatExchange`
(off = byte-identical: tests `scenarioThreatExchange.test.ts`, soak `scenarioThreatExchangeSoak.test.ts` @slow).
**Concept.** A vast neutral trading station, open to all, run by its own faction: it funds the weaker side of every war,
spies on the strong, sells stolen intelligence, hires pirates in its own name and guards its system. Win: trace it,
have the council sanction it, blockade or destroy the station.
**Params** (scenarios/exchange/scenario.json): `exchangeGrudgeDecay` 20, `exchangeGrudgeThreshold` 100, `exchangeYear` 7, `exchangeTechLevelBonus` 1, `exchangeIncomeStep`
100000, `exchangeIncomeCap` 1000000, `exchangeTariffPct` 5, `exchangeReservePct` 20, `exchangeFundPct` 5,
`exchangeAgents` 6, `exchangeAgentsMax` 20, `exchangeMissionCost` 10000 (an agent hire = 5 missions),
`exchangeIntelPrice` 20000, `exchangeFleetCap` 20, `exchangeBlockadeDays` 120.
1. **Appearance** (yearly, `exchangeYear` after the start year): `createEmpireMidGame` adoptOnly (race: a playable
   race no empire uses, rnd), name from the Empire ctor's `GenerateEmpireName`, colours / flag shape from the ctor,
   leader portrait and starting characters from `generateStartingCharacters`; tech level = the game's start tech level
   (stored by a game-start handler from the new `HomePlacementHelpers.startTechLevel`) + `exchangeTechLevelBonus`
   (max 7). Station: a fresh stock large space port design + two labs of each industry, at an uncolonised habitat
   within 0.3 of the galaxy radius; that habitat is the stand-in capital (`faction.capital`, never owned). The stock AI
   is off: every `Control*` automation field Manual / false except `controlDesigns` and `controlResearch`,
   `initiateConstruction = false` (no construction, no crash research), policy offers off (it posts its own
   contracts). Colonise / unload-troops / bombard missions of its ships are refused (`assignMissionAllowed`); war
   declarations by or on it are blocked (`declareWarBlocked`). It meets every normal empire (a public station) and
   holds a free protection pact (fee 0) with every pirate faction, re-asserted each period.
2. **Purse** (`st.purse`): base income `step × (year − appearance + 1)` capped at `cap` (paid in the yearly tick, the
   appearance year included); docking tariff `exchangeTariffPct` % of every `contractInitiated` whose selling point
   or destination is the station; brokerage = the full price of intel sales. The faction's `stateMoney` is swept into
   the purse each 30-day period (stock ship upkeep and pirate contract payments come out of it). Reserve =
   `exchangeReservePct` % of the year's income so far; discretionary spending (funding, agents, missions, contracts,
   research stations, warships) only uses `purse − reserve − open contract prices`.
3. **Underdog funding** (yearly): for each war among normal empires (weaker = lower `MilitaryPotency`, ties treasury /
   id) the weaker side gets `exchangeFundPct` % of its treasury, stopping at the reserve; message (event log) per grant.
4. **Intelligence** (periodic): `exchangeAgents` stock agents (`generateNewCharacter`) with espionage, sabotage,
   assassination, psy-ops and concealment raised to 60; +1 a year up to `exchangeAgentsMax` while money above the
   reserve covers a hire. Idle agents (no mission / counter-intelligence) start the next mission (targets: war-weary
   empires at war, then the strongest third; types round-robin SabotageColony, StealTechData, SabotageConstruction,
   StealGalaxyMap, AssassinateCharacter, StealOperationsMap), built with the stock constructors and the stock timing
   (`calculateIntelligenceMissionSkill` + `cascadeTimeLength`), assigned to `character.mission` so the stock
   `performIntelligenceMissions` resolves them (stolen tech is the faction's). No yearly caps: money, agents,
   targets and mission length limit them. A successful unseen sabotage sends the victim the false-flag message naming
   its (weakest) war enemy. A catch = a stock Capture / FailDetect / SucceedDetect outcome or the agent killed on the
   mission (the target's counter-intelligence): the victim's knowledge rises (suspected; confirmed on the second catch),
   a 19m hidden thing `exchangeAgent` (target: the station) mirrors it as a lead, and a ledger cause
   `exchange.agentCaught` (−10) is recorded.
5. **Intel market** (yearly): the weaker side of each war receives the stronger side's galaxy and operations maps
   (`applyIntelligenceMissionEffect`, split out of `completeIntelligenceMission`), logged. AI empires that met the
   Exchange and are at war buy one item a year (galaxy map / operations map / a tech the rival has, rotating) on their
   rival when treasury > 4 × price (price = `exchangeIntelPrice × max(1, √colonies)`); the player gets the decision
   `exchange.buyIntel` "Buy intelligence on <rival> for N credits" (options: decline / galaxy map / operations map /
   tech; 60 days). Each sale is a trace (ledger cause `exchange.boughtIntel` −10, rival → buyer) that lands with an
   event-log line once the rival knows the Exchange (≥ suspected).
6. **Contracts** (periodic, stock pirate market): Defend contracts on the weaker side's colonies and space ports (any
   client: the new `pirateDefendBidAllowed` query in `pirateCheckAcceptDefendMission` lets a pirate faction bid on an
   Exchange-financed Defend contract without protecting the client — the stock range and strength tests still apply,
   and a normal empire's contract keeps the stock protection rule), Attack contracts on the
   stronger side's bases (when some pirate faction does not protect it), `EmpireActivity(target owner, Exchange, 1
   year)` added to the Exchange's and the galaxy's lists with the stock prices and offer messages. Stock bidding,
   expiry and completion apply; a Defend contract pays although the target is the client's through the new
   `pirateDefendClient` query in `reviewPirateDefendMissions`. Bounded only by money above the reserve (open contract
   prices count), live wars and their targets; no duplicate per target. A completed Attack contract (target destroyed)
   is a trace (`exchange.contract`) for its victim.
7. **Fleet** (periodic): two Defend-posture fleets gathered at the station (posture range = the system), up to
   `exchangeFleetCap` warships bought from the purse (the newest buildable cruiser / destroyer when its designs allow,
   else escort / frigate), the smaller fleet filled first. `assignMissionAllowed` refuses any mission of its ships whose
   point / target lies outside the station's system (MaxSolarSystemSize + 500); idle or stray ships are given a Patrol
   of the station (low priority, so in-system attack responses still take over).
8. **Research**: `researchAsPirateFaction` query → the stock pirate-faction branch of `annualResearchPotential`
   (√ built objects × 10000 + ½ the labs of its research stations); labs on the station feed the per-industry
   potentials; up to two research stations (weapons, energy) bought at habitats of its system. No crash research.
9. **Council** (19d8, `registerCouncilExtension`): the Exchange is never a member; once a member has it confirmed a
   sanction motion (weight 70) against it becomes a candidate; members that know it vote +40 (others +10).
10. **Discovery / end**: money traces (an intel mission against a funded empire: suspected, confirmed after two) and
   caught agents. A stock blockade of the station by an empire with it confirmed for `exchangeBlockadeDays` (30-day
   periods), or the station destroyed → collapse: purse lost, fleets disbanded, `empireCompleteTeardown` (as a defeated
   faction), NewsNet, +20 bias toward the exposer, game end 2018 (with `threatsGameEnd`).
11. **Grudges** (`st.grudges`, empire id → points): +25 per period an empire blockades the station, +30 per station /
   warship / research station it destroys (`builtObjectKilledBy`), +40 per caught agent, +60 to every member of a
   council that sanctions it (once per sanction), +25 per refused intel offer from the player's second refusal on, and
   yearly the empire with the worst 19o ledger standing toward the Exchange adds that standing (max 100). Yearly decay
   `exchangeGrudgeDecay` % (20). Above `exchangeGrudgeThreshold` (100) an empire is a covert target at war or not: first
   in the mission target list (its agents run SabotageColony / AssassinateCharacter / StealTechData /
   SabotageConstruction against it first), Attack contracts on its bases are posted first, and it is never funded,
   gifted maps, defended, sold intel or offered intel. No message goes to the target; the stock mission messages and
   the traces (event log on discovery) are all it sees.
   The Exchange also merges every empire's galaxy map at appearance and yearly (a trading hub hears everything): its
   agents need known colonies to choose sabotage targets.
**Measured (seed 1, age 3, soak, before the yearly map merge of 11)**: research potential 10000 at the moment it appears (the station alone: √1 × 10000), 204495 after its
first period (station + 2 research stations + 3 warships: √6 × 10000 + 180000 of station labs), 227958 five years
later (23 built objects: 20 warships, 2 research stations, the station; 73 techs known). No wars broke out on seed 1
in those 5 years, so no funding / contracts / sales there (the direct tests declare wars).
**Left out**: extra docking bays on the station; AI empires do not yet send blockade fleets on their own (the
player / a scripted blockade ends it).

## 9. Robot mutiny — robotic troops answer one hidden broadcast
**Concept.** All BattleBot troops galaxy-wide are wired to one hidden transmitter; robot garrisons quietly build more
robots in hiding. When it wakes, colonies rise where their robots can win, the machines become an empire on their first
capture, and the transmitter keeps pouring out warships a tech level ahead of the best empire until it is silenced.
**Data.** GameText `Mutiny *` (incl. `Mutiny Empire Name`, `Mutiny Empire`, `Mutiny Silenced`, `Mutiny Beacon`);
faction race = Harvester from 19b (via D3 include, else its own `BasedOn` copy). Params: `mutinyYear` (70),
`mutinyMinRobots` (30 galaxy-wide), `mutinyShipFlipPct` (100), `mutinySourceDetectPct` (8), `mutinyDefeatPopulationPct`
(40), `mutinySleeperMinRobots` (2), `mutinySleepersPerYear` (15), `mutinyBeaconShipsYear1/2/3` (100/200/300, tuned for
large galaxies), `mutinyBeaconScalePct` (100, multiplies the three targets), `mutinyTechBonus` (1).
**Hidden state / spread.** `{source: Habitat (a ruin world), sleepers: {colony, count}[], risingYear, becameEmpire,
beaconShips, beaconYear, beaconTech, beaconDesigns}`. The empires spread it by recruiting robots (RoboticTroopFoundry;
robot troops are identified as `troop.race === null && troop.pictureRef === galaxy.races.length`, the stock BattleBot
marker, troops.ts 387 / orderMenu.ts 2300). **Hidden growth** (yearly, `mutinyAccrueSleepers`, galaxy.habitats order):
every colony whose garrison holds ≥ `mutinySleeperMinRobots` robots of its owner accrues `mutinySleepersPerYear` sleepers
— a count in the threat state only (no Troop object: no upkeep, not in the garrison, not counted by the stock UI).
**Trigger / faction.** Year ≥ `mutinyYear` and robot troops galaxy-wide ≥ `mutinyMinRobots` →
`createThreatFaction('The Broadcast', race Harvester, adoptOnly, techLevel = beacon tech)`. **Rise only where it can
win:** a colony rises when its robots (owner's garrison robots + sleepers as full-readiness foundry BattleBots) beat the
other garrison troops + colony characters by the stock `calculateForceStrengths` (Habitat.cs 4435; plus the
population's defence share as resolveInvasionBattles adds it). Rising = the sleepers materialise as stock foundry troops
(`generateNewTroop('BattleBot Group', 60)`, maintenance ×0.25, robot marker) and rise with the garrison robots through
`invadeFromInside`; the stock invasion resolves it. Elsewhere the robots stay dormant (still in the owner's garrison,
sleepers still hidden) and the periodic `mutinyRisings` re-tests every 30 days: the colony rises when the balance flips
or a faction warship (a beacon fleet) is in its system. Ships whose carried troops are majority robots flip
(`flipToFaction`) with `mutinyShipFlipPct`.
**Empire on capture.** The first colony the faction holds (any path: the stock conquest's takeOwnershipOfColony already
sets the capital) turns it into a full empire (`mutinyBecomeEmpire`, the control hand-over of lively/pirateAmbition):
renamed `Mutiny Empire Name`, locked threat wars released to the stock diplomacy (war review, peace), the Harvester race
set Expanding (a saved race scalar) so the stock AI's expansion gates open. The Empire ctor's AI automation is already on:
it colonises, builds, researches, reviews wars and runs the stock invasion AI (PrepareFleetsForWar) with its own
transports and troops.
**Beacon fleets.** From the rising the transmitter spawns warships at the ruin world (Galaxy.8.cs 1474
GenerateMilitaryConvoy: its Next(0, 10) type roll with the transport slot → Cruiser, GenerateNewBuiltObject at a parking
point, TakeOwnershipOfBuiltObject, auto-controlled, no upkeep), replenished every year to that year's target (year 1
`mutinyBeaconShipsYear1`, year 2 `…Year2`, year 3 and after `…Year3`, each × `mutinyBeaconScalePct` %). Designs:
GenerateDesignFromSpec at tech level = the best regular empire's tech level (highest researched project level) +
`mutinyTechBonus`, clamped to the generator's top regular component level (7; the 100/101 super weapons excluded); the
faction's tech tree is raised to that level (SetTechTreeLevel's rule, upward only) so its construction size fits them.
The ships gather at the transmitter in fleets of 20 with FleetPosture.Attack; the stock fleet AI tasks them. Seed 1
(300 stars, age 3): year-1 beacon = 100 ships at tech 3 (best 2), ≈ 14× the largest empire's warship firepower —
lower `mutinyBeaconScalePct` for small galaxies.
**Dirty.** Mutinous robots never retreat; dormant robots keep waiting for their moment.
**Discovery / counterplay.** Hints: "anomalous carrier signal in BattleBot firmware" to empires with ≥ 10 robots, from
year `mutinyYear − 10`; agents with CounterIntelligence in a robot-owning empire find the source (level 3). Destroying
the transmitter before the trigger defuses it (game end: contained): a troop landing on the source habitat (an
UnloadTroops mission there; completion observed by the periodic check of troops present) or a planet destroyer. After
the trigger the same silences it (`Mutiny Silenced`): no more sleeper growth, risings or beacon warships; colonies
already captured stay the empire's. Containment (game end) = the source silenced and the faction with no colonies and
no ships (teardownIfDead); while the transmitter lives the faction is never torn down.
**Sim.** 1 `mutinySeed`; 2 `mutinyHints`; 3 `mutinyAccrueSleepers` yearly; 4 `mutinyTrigger` (risings + ship flips +
first beacon); 5 `mutinyRisings` periodic; 6 `mutinyBecomeEmpire` periodic; 7 `mutinyBeacon` yearly; 8
`sourceNeutralised` / `checkDefused`.
**AI.** AI empires with level 3 stop recruiting robots (policy `colonyAllowFacilityRoboticTroopFoundry = false` on
the empire's policy copy) — testable.
**Rnd.** Flag off: none (test: same draws and digest as without the handlers). Flag on: seed pick, faction creation,
ship-flip roll, beacon (design naming, type roll, parking points / headings / names), discovery roll.
**Risks.** Robot counts are low in stock AI play; `mutinyMinRobots` must be tuned with a soak. The Harvester race is
shared with 19b Dark Farms: with both threats on, the Dark Farms faction also becomes Expanding once the mutiny empire
forms. **Size** 1.5 days (+ rework 1 day).

## 10. Corporate coup — a chartered company takes its governors with it
**Concept.** A 19c chartered company buys the charter-holder's governors, then declares independence with its fleet
and the bought colonies. **Depends on 19c** (company sub-empire, charter relation, tariff counters).
**Data.** GameText `Coup *`; faction government "Corporate Nationalism" (id 12). Params: `coupBribePct` (10),
`coupGovernors` (3), `coupMinYears` (10).
**Hidden state / spread.** `bought: Character[]` (governors of the holder), per company. Yearly: for each company, each
ColonyGovernor of the holder at colonies within the company's reach rolls `coupBribePct` × (Corrupt ×2, Lawful ×0.25,
Patriot ×0).
**Trigger / faction.** No new faction: the company *is* the faction. When bought ≥ `coupGovernors` and charter age ≥
`coupMinYears` (or the holder is at war and weak): break the charter relation with the 19c break-away path (names in the
19c brief), declare locked war, and transfer each bought governor's colony with `invadeFromInside` (company troops =
the colony's garrison share the governor controls: 50% of `habitat.troops` switch sides) — the stock invasion decides.
**Dirty.** Before the coup the company uses the holder's own intel against it (company agents run StealTechData /
SabotageConstruction on the holder via stock missions).
**Discovery / counterplay.** Counter-intelligence inside the holder reveals bought governors (level 3); the player can
dismiss/replace them (existing) or nationalise the company early (19c absorb-dominion path).
**Sim.** 1 `coupBribeYearly`; 2 `coupTrigger`; 3 `onCharacterCreated` (new governor starts clean); 4 discovery.
**AI.** An AI holder with ≥ 2 confirmed bought governors replaces them within one period (testable).
**Risks.** Hard dependency on 19c's API; build last. **Size** 1.5 days.

---

## Sizes and order
Framework hook additions (§0.3) 0.5 day, then: Silence 1.5, Hive 1.5, Time-bomb 1.5, Doppelgangers 1.5, Ghost Armada 1.5
(+0.5 persona), Robot mutiny 1.5, Grey Tide 2, Exchange 2, Cult 2.5, Corporate coup 1.5 (after 19c). Total ≈ 18 agent-days;
parallel lanes of 2–3 threats each. Recommended first wave (fewest new hooks): Silence, Hive, Robot mutiny, Time-bomb.
