# 19b — Dark Farms (end-game hidden threat) — implementation brief

Scenario package on the mod layer (`tasks/MODLAYER-DESIGN.md`). Off by default; with the flag off (or no scenario)
the faithful game is byte-identical: 0 pin changes, same Rnd stream. Read `CLAUDE.md`, `tasks/19-mod-layer-scenarios.md`
§19b and MODLAYER-DESIGN.md before starting. This package also builds the **threat framework** the ten 19f threats
reuse (`tasks/19f-hidden-threats.md`), so write the generic parts generically from day one.

`$C` = `$DWU/Customization/DistantWorldsExpanded-main/DistantWorldsExpanded` (C# reference). All C# cites below are
`DistantWorlds.Types/` unless noted. Nothing here is a port: Dark Farms is new behaviour composed of ported functions.
Cite the C# analogue of each composed step in a comment (e.g. `// As Habitat.cs 5992 CheckSatisfaction's militia`).

## 1. The arc in one paragraph

A colony that is overdeveloped (high development level, huge population) has a small yearly chance to grow a hidden
self-replicating factory, a **Dark Farm**. Nobody owns it and nobody sees it. It produces, for free, two things:
**robot troops** that hide on the planet, and **sleeper freighters**: ordinary-looking freighters of the host empire's
private sector that trade like any other while carrying a hidden weapons/troop fit. When enough sleepers exist (or
enough years pass, or someone exposes the farm) it **turns**: a new hostile faction (the *Harvesters*) is created
mid-game, like the Shakturi; the hidden robots invade the host colony *from inside* through the ordinary invasion
resolution; every sleeper flips to the faction, is refitted to its armed design and loads robot troops; the faction's
normal war AI plus a thin scenario layer then carries the factory's continuous troop output to weakly garrisoned
colonies. They fight dirty: a blight bombardment that reuses the Xaraktor-virus plague path, boarding/capture with
assault pods, and sabotage through the faction's own intelligence agents. Before the turn, trace scanners and spies
can find sleepers and farms; the arc sends hints, rumours and Galactic NewsNet reports; it ends with containment or with
the Harvesters holding a large share of the galaxy (defeat).

## 2. Scope, files, ownership

Worktree/branch as assigned (`wip/19b-darkfarms`). New files:
- `game/scenarios/darkfarms/**` (data overlay, §3).
- `src/sim/scenario/threats/framework.ts` — generic threat machinery (§5.A), reused by 19f.
- `src/sim/scenario/threats/darkFarms.ts` — Dark Farms rules (§5.B–G); registered from `src/sim/scenario/packages.ts`.
- `src/sim/scenario/hooks.ts` / `index.ts` — two small additions to the mod-layer API (§5.0), coordinated with the
  modlayer owner (if modlayer has not merged yet, rebase onto `wip/modlayer`).
- UI: `src/ui/screens/…` only the few read-only additions of §9.
- Tests: `test/scenarioDarkFarms.test.ts`, `test/scenarioThreatFramework.test.ts`.

Base-sim edits are limited to the **one-line guarded emit calls** listed in §5.0 (`if (galaxy.scenario !== null) …`).
No new fields on Empire / Galaxy / BuiltObject / Habitat: all state lives in `galaxy.scenario.state` (§7).

## 3. Data overlay — `game/scenarios/darkfarms/`

| File | Content |
|---|---|
| `scenario.json` | manifest: flags + params below |
| `races/harvester.txt` | new non-playable race **Harvester** (see note D1): `BasedOn ;mechanoid.txt` then key lines `Name ;Harvester`, `Playable ;N`, `PictureIndex ;21` (Mechanoid portrait), `DesignsPictureFamilyIndex ;10`, `TroopName ;Harvester Drone Group`, aggression 90 / caution 70 / friendliness 10 / loyalty 100 / intelligence 110 |
| `raceBiases.txt` | row `Harvester` (−40 to every race; every race −40 to Harvester) |
| `Policy/Harvester.txt` | key-line policy: `WarAttacksAllowColonyBombardment ;2`, `CaptureTargetConditionShip ;2`, `CaptureEnlistCivilianShip ;2`, `CaptureEnlistMilitaryShip ;2`, `InvasionOverkillFactor ;1.3`, no treaties, no colonisation, all facility builds off (verify the key names in `src/sim/data/policies.ts` parsePolicyLine) |
| `designTemplates/harvester/smallfreighter.txt` | the **armed sleeper** fit: stock small-freighter hull + `TroopCompartment ;2`, `AssaultPod ;1`, 2 beam weapons, `Armor ;2`; `mediumfreighter.txt` likewise (troops 4, weapons 3); `trooptransport.txt`, `escort.txt`, `frigate.txt` for the faction's own builds (other sub-roles fall back to DEFAULT) |
| `plagues.txt` | one record, **Harvester Blight** (mortality 0.35, infection 20, duration 240, natural occurrence 0, can eliminate N, no exception race, special function 0) — appended by name |
| `GameText.txt` | every message tag of §8 (`DarkFarms …`), faction name `DarkFarms Faction Name ;Harvester Collective`, troop / ship descriptions |

Decision — **no `facilities.txt` record**. A farm is scenario state, never a `PlanetaryFacility` in
`habitat.facilities`: a real facility would be charged maintenance (`facilitiesCalculateAnnualMaintenance`), appear in
build menus and the AI's `reviewColonyFacilities` definition scans, be torn down/transferred by ownership code and be
visible in the colony panel. The UI shows an *exposed* farm from scenario state instead (§9).

Manifest (`scenario.json`):
```json
{ "id": "darkfarms", "name": "Dark Farms", "description": "…",
  "flags": [
    { "name": "darkFarms", "label": "Dark Farms", "default": false },
    { "name": "darkFarmsRobotArmy", "label": "Farms build a hidden robot army", "default": true },
    { "name": "darkFarmsDirtyMethods", "label": "Blight bombardment, boarding, sabotage", "default": true },
    { "name": "darkFarmsGameEnd", "label": "Harvester victory ends the game", "default": true } ],
  "params": [
    { "name": "graceYears", "default": 25, "min": 0, "max": 200 },
    { "name": "spawnChancePerMille", "default": 4, "min": 0, "max": 1000 },
    { "name": "minDevelopment", "default": 70, "min": 0, "max": 200 },
    { "name": "minPopulationMillions", "default": 3000, "min": 0, "max": 50000 },
    { "name": "maxFarms", "default": 2, "min": 1, "max": 10 },
    { "name": "troopsPerYear", "default": 6, "min": 0, "max": 100 },
    { "name": "sleepersPerYear", "default": 2, "min": 0, "max": 20 },
    { "name": "sleeperTurnCount", "default": 10, "min": 1, "max": 100 },
    { "name": "turnFleetRatioPct", "default": 20, "min": 0, "max": 200 },
    { "name": "maxTurnYears", "default": 12, "min": 1, "max": 100 },
    { "name": "exposedTurnDays", "default": 60, "min": 0, "max": 720 },
    { "name": "retakeDestroysFarm", "default": 1, "min": 0, "max": 1 },
    { "name": "troopStrength", "default": 60, "min": 10, "max": 500 },
    { "name": "traceDetectPct", "default": 10, "min": 0, "max": 100 },
    { "name": "agentDetectPct", "default": 15, "min": 0, "max": 100 },
    { "name": "blightChancePct", "default": 25, "min": 0, "max": 100 },
    { "name": "defeatPopulationPct", "default": 40, "min": 5, "max": 100 } ] }
```

Dependencies on the mod layer (small; add them in this package if modlayer has not):
- **D1 `BasedOn` race files**: a new-race overlay file whose first key line is `BasedOn ;<base file>` is a key-line
  patch over that base race's text, appended as a new race (the overlay rule forbids copying stock files into the repo).
  `overlay.ts` applyScenarioOverlay, races branch; test in `test/modlayer.test.ts`.
- **D2 `createEmpireMidGame(…, { adoptOnly: true })`**: construct the Empire (policy, designs, AI on, touch times) with
  **no capital taken** — `generateEmpire` rewrites the capital's diameter, quality and population
  (`empireGeneration.ts` 42, Galaxy.7.cs 5092-5260) and must not run on the host colony. Set `empire.capital = null`
  after the ctor; the capital is assigned when the faction takes its first colony
  (`takeOwnershipOfColonyFull` → `selectBestCandidateForCapital`, ownership.ts 441/110). A colony-less empire is only
  eliminated when it *loses* a colony (ownership.ts 505), so the faction survives until the scenario tears it down.

## 4. Rules (numbers are the param defaults)

**Eligibility** (checked yearly, in `galaxy.empires` order then `empire.colonies` order): owner is a normal empire
(not `galaxy.independentEmpire`, not a pirate faction, not the Harvesters, not the Shakturi); `habitatDevelopmentLevel(h)
≥ minDevelopment` (developmentLevel.ts 54, Habitat.cs 447); `population.totalAmount ≥ minPopulationMillions × 1e6`; not
the empire's capital; no farm there already; year ≥ start year + `graceYears`; live farms < `maxFarms`.

**Spawn roll**: `galaxy.rnd.next(0, 1000) < spawnChancePerMille × (1 + (dev − minDevelopment) / 25)` per eligible
colony; at most one spawn per year galaxy-wide (stop at the first success).

**Production** (every 30 game days, while the farm is `hidden` or `turned` and its habitat still exists):
- troops: `troopProgress += troopsPerYear × 30/365`; whole units become hidden robot groups (`hiddenTroops++`), cap
  `4 × troopsPerYear` pre-turn (a full farm idles — a hint, §8). Only if `darkFarmsRobotArmy`.
- ships: `shipProgress += sleepersPerYear × 30/365`; each whole unit spawns one sleeper (§5.C). Pre-turn cap:
  `turnThreshold + 4`.
- Free: no money, no resources, no construction yard, no maintenance (sleepers are host private ships, so the host's
  private sector pays their upkeep — that drain is a deliberate hint).

**Turn threshold** `turnThreshold = max(sleeperTurnCount, ceil(host military ship count × turnFleetRatioPct/100))`
(answers the open design point "awakening size vs host fleet"). The farm turns at the first of: live sleepers ≥
threshold; farm age ≥ `maxTurnYears`; `exposedTurnDays` after the **host** learns of the farm (knowledge level ≥ 2;
discovery by a third empire does not start the clock); the host orders a purge (§9), which forces the turn *now*, while
the farm is weaker.

**After the turn**: production continues; new troops garrison the farm colony (`habitat.troops`) up to
`2 × troopsPerYear`, the rest wait for pickup (`troop.awaitingPickup`, troopsRuntime.ts 361/565); new ships spawn
openly as faction troop transports (free). If the farm colony is retaken by anyone and `retakeDestroysFarm = 1`, the
farm dies; with 0 it keeps producing for the Harvesters as a hidden farm again (re-seeding: `hidden`, new host).

**End**: containment when no farm is alive and the faction has no colonies and no ships (scenario tears it down with
`empireCompleteTeardown`, events.ts 1199). Defeat when the Harvesters hold ≥ `defeatPopulationPct` of the galaxy's
empire-owned population, or the player's last colony (normal elimination already ends that game).

## 5. Sim changes (numbered; file → C# analogue)

### 5.0 Mod-layer additions (hooks.ts / index.ts; coordinate with modlayer)
1. `registerScenarioPeriodic({ id, flag?, scenarioId?, periodDays, order?, run(galaxy, now) })` +
   `scenarioPeriodicTick(galaxy)` called next to `scenarioYearlyTick` in `tick/galaxyTick.ts` (same long block, same
   `galaxy.scenario !== null` guard). Bookkeeping `GalaxyScenario.periodicLast: Record<id, starDate>` (saved). Analogue:
   the long-block cadence of Galaxy.DoTasks (`$C/…/Galaxy.1.cs` DoTasks; `tick/galaxyTick.ts`).
2. `registerScenarioEvent({ id, flag?, event, run })` + `scenarioEmit(galaxy, event, payload)`. Emit sites for 19b (each a
   single guarded line at the end of the function, no Rnd off-path):
   - `colonyOwnerChanged {colony, from, to}` — end of `takeOwnershipOfColonyFull` (combat/ownership.ts 441; Empire.1.cs 54).
   - `builtObjectOwnerChanged {bo, from, to}` — end of `takeOwnershipOfBuiltObject` (ownership.ts 632; Empire.1.cs 514).
   - `builtObjectRemoved {bo}` — top of `builtObjectCompleteTeardown` (combat/teardown.ts 180; BuiltObject.2.cs 5171 CompleteTeardown).
   - `habitatBombarded {ship, habitat, bombardPower}` — end of `inflictBombardDamage` (combat/damage.ts 1465; BuiltObject.2.cs 5816).
   19f adds further events on the same mechanism (listed there). Handlers run in (order, id) order; a handler may draw
   `galaxy.rnd` only when its flag is on.
3. D1 / D2 above.

### 5.A Threat framework (`scenario/threats/framework.ts`, generic, 19f reuses)
4. `threatState<T>(galaxy, key, init)` — thin typed wrapper over `scenarioState`.
5. `createThreatFaction(galaxy, spec)` → `createEmpireMidGame({ …spec, adoptOnly, relationBias: −100 })`, then
   `declareWar(galaxy, faction, e, null, /*lockedWar*/ true)` against every normal empire in `spec.enemies` (diplomacyTick.ts
   2710; Empire.7.cs DeclareWar; verify `locked` ends up set on both relations, else set it — no peace ever), then
   `createNewDesigns(galaxy, faction, now, now, true)` (designGeneration.ts 611; BaconEmpire.CreateNewDesigns) so the war
   AI has designs from the overlay templates. Analogue: `generateShakturi` (storyEvents.ts 440; Galaxy.8.cs 1348).
6. `invadeFromInside(galaxy, habitat, faction, troops: Troop[])` — adds the troops to `habitat.invadingTroops` (created
   if null), `troop.colony = habitat`. Resolution is the stock `resolveInvasionBattles` in the habitat tick
   (combat/invasion.ts 1243 via tick/habitatTick.ts 130; Habitat.cs 3365) — success runs the stock conquest
   (processColonyConquest + takeOwnershipOfColony). Analogue: the rebel militia of `checkSatisfaction`
   (colonyTick.ts 340; Habitat.cs 5992).
7. `makeRobotTroop(galaxy, faction, strength)` — `generateNewTroop(scenarioText('DarkFarms Troop Name'), Infantry,
   strength, faction, null, false)`, `maintenanceMultiplier = 0`, `pictureRef = galaxy.races.length`, readiness 1.
   Analogue: the RoboticTroopFoundry branch of `habitatGenerateNewTroop` (troops.ts 387; Habitat.cs 7047-7084).
8. `flipToFaction(galaxy, bo, faction)` — `takeOwnershipOfBuiltObject(galaxy, bo.actualEmpire, bo, faction, false, true)`
   (ownership.ts 632). Private ships leave the host's `privateBuiltObjects`; check the result is a state ship of the
   faction (the Empire.1.cs 514 path decides by role; set it explicitly if not).
9. `refitInPlace(galaxy, bo, design)` — instant retrofit: `bo.design = design`, `bo.retrofitDesign = null`,
   `bo.reDefine()`, repair to full, refuel. Analogue: retrofit completion in `constructionQueue.ts` ~631 (ConstructionQueue
   retrofit completion) without yard/time/cost.
10. `revealTo(galaxy, threatKey, site, empire, level)` — records knowledge `{empireId, level, date}` on a site
    (levels: 1 rumour, 2 suspected, 3 confirmed); returns true if new. All discovery goes through it (single place for
    messages and UI selectors).
11. `threatKnownSites(galaxy, empire)` — pure selector for the UI (§9).
12. `arcMessage(galaxy, stage, recipients, args, subject)` / `arcNews(…)` — `scenarioMessage` / `scenarioNews` with tag
    `<Threat> <Stage>` via `scenarioText`; records `sentStages` so each stage fires once per recipient.
13. `threatGameEnd(galaxy, victor, outcome, tag, code)` → `onGameEnd(galaxy, new GameEndEventArgs(…))` (victory.ts 235;
    Galaxy.cs 1274 OnGameEnd) — codes 1900+ (19b = 1902 defeat, 1901 containment when a game end is configured).
14. `teardownIfDead(galaxy, faction)` — no colonies and no ships ⇒ `empireCompleteTeardown(galaxy, faction, null)`.

### 5.B Spawn (`darkFarms.ts`)
15. `darkFarmsYearly(galaxy, year)` (registerScenarioYearly, flag `darkFarms`, order 10) — eligibility + roll (§4);
    creates `DarkFarm { id, habitat, host, bornDate, state:'hidden', hiddenTroops:0, troopProgress:0, shipProgress:0,
    knowledge:[], exposedDate:-1 }`. Analogue: yearly random-event chances (`reviewRandomEvents`, empireEvents.ts; Empire.1.cs
    1758) and `chanceRaceEvent` (events.ts 1908; Galaxy.2.cs 4980).

### 5.C Production
16. `darkFarmsPeriodic(galaxy, now)` (registerScenarioPeriodic, 30 days, flag `darkFarms`, order 10): for each farm by id:
    production (§4) → `spawnSleeper` per whole ship; then `checkDiscovery` (§5.F), `checkTurn` (§5.D), after-turn
    `directFaction` (§5.E), then arc hints (§8), then victory/containment (§5.G).
17. `spawnSleeper(galaxy, farm)` — design: `rnd.next(0, 3) === 1` ? newest buildable MediumFreighter : SmallFreighter
    of the **host** (`findNewestCanBuild(host.designs, subRole, host)`, designGeneration.ts 467); `design.buildCount++`;
    `new BuiltObject(design, galaxy.selectRandomUniqueStandardShipName(colony), galaxy, true)`; heading; `reDefine`; full
    fuel; `host.addBuiltObjectToGalaxy(bo, colony, false, /*isStateOwned*/ false)` (empire.ts 1658) so it is a private
    ship and the private sector gives it freight missions (civilianAI.ts `assignShipMissions` 435) — it really trades;
    parking point from `selectRelativeParkingPoint`. Record `Sleeper { bo, farmId, subRole, knowledge:[] }`.
    Analogue: `createIndependentTrader` (independentTraders.ts ~470; Galaxy.7.cs 4498-4516) and the private build in
    `directPrivateConstruction` (civilianAI.ts 2490; Empire.6.cs 741) minus price/yard/queue.
18. `onBuiltObjectRemoved` (event) — drop the sleeper record (destroyed, scrapped, retired). `onBuiltObjectOwnerChanged`
    — a sleeper captured by anyone else stops being a sleeper (its hidden fit is found: reveal level 3 to the captor).

### 5.D The turn
19. `checkTurn(galaxy, farm)` — §4 conditions.
20. `darkFarmsTurn(galaxy, farm)` in this order (Rnd order fixed):
    a. `faction = state.faction ?? createThreatFaction(galaxy, { race: 'Harvester', name: scenarioText('DarkFarms Faction
       Name'), home: farm.habitat, techLevel: host tech level, enemies: all normal empires, configurePolicy })` — one
       faction for all farms (later farms join it).
    b. Give it 2 intelligence agents (`generateNewCharacter(galaxy, faction, CharacterRole.IntelligenceAgent, null)`,
       characters.ts 6861; Empire.6.cs 4413) if `darkFarmsDirtyMethods` — its stock AI then runs sabotage/assassination
       (`assignSpecialMissions` / `performIntelligenceMissions`, espionage.ts 1148/1267; Empire.5.cs 5597).
    c. Armed designs: for Small/MediumFreighter, `generateDesignFromSpec(galaxy, faction, <harvester template>, 0, now)`
       (designGeneration.ts 777) with `subRole = TroopTransport` so the stock troop-transport logic uses them; cached in
       state.
    d. Sleepers of this farm, by id: `flipToFaction`, `refitInPlace(armed)`, load robot troops up to `troopCapacity`
       from `hiddenTroops` (makeRobotTroop). They join one ShipGroup (fleet) per farm.
    e. `invadeFromInside(farm.habitat, faction, remaining hiddenTroops as robot troops)` (strength `troopStrength`,
       scaled ×1.25 per 10 dev levels above minimum — overdeveloped worlds grow stronger farms).
    f. `farm.state = 'turned'`; messages (§8): host popup, NewsNet to all.
21. `onColonyOwnerChanged` — faction gains a colony with `capital === null` → capital = it; a farm habitat lost by the
    faction → `retakeDestroysFarm` rule; a farm habitat destroyed (planet destroyer) → farm dies.

### 5.E Spread (after the turn) — the faction's stock AI does the war; the scenario layer only adds:
22. `directFaction(galaxy)` every period:
    a. Troop output at the farm (garrison first, then `awaitingPickup`).
    b. New free transports at the farm colony: `spawnSleeper`-style but owned by the faction, armed design, state ship.
    c. Idle loaded transports (no mission or Hold, troops ≥ 50% capacity): target = the colony of an empire at war with
       the faction minimising `(garrisonDefend + 1) × distance`, within 3 × the farm's system distance to the nearest
       enemy colony, and only where carried attack ≥ `policy.invasionOverkillFactor × garrisonDefend` → group them and
       `assignFleetUnloadTroops(galaxy, faction, fleet, colony, false)` (invasion.ts 863; Empire.9.cs 525). Empty
       transports return to the farm for pickup (`assignLoadTroopsMission`, troopsRuntime.ts 659).
    d. If `darkFarmsDirtyMethods` and the best target's garrison is > carried attack: send the gunship escorts to
       `Bombard` it first (`assignMission(… BuiltObjectMissionType.Bombard, colony …)`, missions/assign.ts 94).

### 5.F Discovery (pre-turn, all inside the periodic handler; no base-code rolls)
23. **Trace scanners**: for each sleeper (by id), `getBuiltObjectsAtLocation(galaxy, x, y, 2000)` (stationPlacement.ts
    207); every ship/base of a normal empire with `sensorTraceScannerPower > 0` and in `sensorTraceScannerRange`, in list
    order, rolls `rnd.nextDouble() < traceDetectPct/100 × min(1, power / 20)` (20 = the sleepers' notional jamming) →
    `revealTo(sleeper, empire, 3)`; the farm gets level 2 for that empire ("manifests trace back to X"). Analogue: the
    pirate-smuggler detection in `identifySystemThreatsToUs` (combat/threats.ts 1045; BaconBuiltObject.cs 4863) and the
    docking check in cmdDocking.ts ~205 (BuiltObject.2.cs 2811).
24. **Agents**: yearly-equivalent (every 12th period) per farm: every active IntelligenceAgent whose mission targets the
    host empire or its colonies, or who runs CounterIntelligence *inside* the host, rolls
    `rnd.nextDouble() < agentDetectPct/100 × espionageFactored/100` (characters.ts `espionageFactored`) → farm level 3.
    Analogue: mission success rolls in `performIntelligenceMissions` (espionage.ts 1267; Empire.5.cs 5597).
25. **Host exposure** starts the `exposedTurnDays` clock (§4). An AI host that knows (level ≥ 2) its farm: sets the
    colony's troop target to 1.5 × the farm's hidden strength (troop recruitment at that colony via the existing
    `habitat.troopsToRecruit` path) and, when its garrison there reaches 1.2 × hidden strength, orders the purge
    (forces the turn). An AI host scraps every sleeper it knows (`assignMission(… Retire …)`).

### 5.G Dirty methods and end
26. `onHabitatBombarded` (event, flag `darkFarmsDirtyMethods`): ship owned by the faction, habitat populated and
    `plagueId < 0` → `rnd.nextDouble() < blightChancePct/100` → `infectWithPlague(galaxy, habitat, blight, null)` (events.ts
    635; Habitat.cs 1838). Analogue: the player's Xaraktor `DeployVirus` (player/executeShipAction.ts 1004; Main.Part7.cs
    1020-1043) — no Kaltor creatures, no cooldown on the player's `lastXaraktorVirusDeploy`.
27. Boarding/capture: nothing new — the armed templates carry assault pods and the Harvester policy prefers capture, so
    the stock path (`checkLaunchAssaultPodsAtTarget`, `processBoardingAssault` boarding.ts 126/560; BuiltObject.1.cs 2954)
    captures ships; captured freighters are refitted to the armed design on the next period (`refitInPlace`).
28. `darkFarmsEndCheck(galaxy)` — containment (§4) → `teardownIfDead`, arc message, `threatGameEnd(Victory, 1901)` only
    if `darkFarmsGameEnd` and the player destroyed ≥ 50% of the faction's lost strength; defeat share → `threatGameEnd(
    Defeat, 1902)` if `darkFarmsGameEnd`, else a NewsNet message only.

## 6. Rnd policy
Draws happen only in: the yearly spawn handler (one `next(0,1000)` per eligible colony until a success); the periodic
handler (spawnSleeper's `next(0,3)` + name + parking point; discovery `nextDouble` per scanner/agent in fixed order;
createEmpireMidGame / generateDesignFromSpec / generateNewCharacter / mission assignment draws at the turn); the
flag-gated `habitatBombarded` handler. Iteration orders: farms by id, sleepers by id, empires in `galaxy.empires` order,
colonies in `empire.colonies` order, scan hits in `getBuiltObjectsAtLocation` order. No `Math.random`, no clock.
With the flag off, no handler runs (gated by `flag`) ⇒ zero draws; the emit sites draw nothing themselves.

## 7. Save state
`galaxy.scenario.state.darkFarms: DarkFarmsState` — plain objects with graph references (Habitat, Empire,
BuiltObject, Design) which the graph codec already memoises; no new classes (so nothing to add to the save CLASSES):
`{ nextId, faction: Empire|null, farms: DarkFarm[], sleepers: Sleeper[], armedDesigns: Record<subRole, Design>,
sentStages: Record<string, number[]>, killsByEmpire: Record<number, number>, ended: boolean }`. Troops exist as Troop
objects only after the turn (they live in the stock troop lists). `GalaxyScenario.periodicLast` (5.0) is saved with the
scenario. Test: save mid-growth and post-turn, load, continue — digest equal to the uninterrupted run.

## 8. Story arc — messages and hints (GameText tags `DarkFarms <Stage>`)
Recipients "host" = the host empire (player sees it if host), "all" = NewsNet to every empire.
| Stage | When | To | Type |
|---|---|---|---|
| Hint Energy | farm age 2 y | host | GeneralNeutralEvent: "Unexplained power draw on {colony}" |
| Hint Freight | sleepers ≥ 3 | host | GeneralNeutralEvent: "Private freighter registrations at {colony} up {n}% with no new yards" |
| Rumour | farm age 4 y | all | NewsNet: "Dock workers on {system} report freighters that never unload" |
| Hint Missing | hidden troops at cap | host | GeneralWarning: "Missing-persons reports and sealed districts on {colony}" |
| Sleeper Found | trace-scanner reveal | discoverer (+host if different) | GeneralWarning, subject = ship |
| Farm Suspected / Confirmed | reveal level 2 / 3 | discoverer | GeneralWarning, subject = colony; confirmed adds "Purge" hint |
| Turn | turn | host popup (GeneralBadEvent) + all NewsNet | "The machines on {colony} rise: the Harvester Collective" |
| Fall | faction takes a colony | owner + all | GeneralBadEvent / NewsNet |
| Blight | first blight per colony | owner | GeneralBadEvent |
| Contained / Collapse / Defeat | §5.G | all | NewsNet (+game end) |

## 9. UI
- Wizard: nothing new (the modlayer Scenario page lists flags/params from the manifest).
- Messages: all arc messages are ordinary EmpireMessages → existing routing (`src/ui/messageRouting.ts`): Turn / Fall /
  Blight / Found are popups, hints are ticker + stub-list entries (`messageStubs.ts`); `subject` makes "go to" work.
- Map overlay: one row "Threats" in `src/ui/mapOverlays.ts` OVERLAY_ROWS; the renderer draws a ring on each colony and
  a mark on each ship in `threatKnownSites(galaxy, player)` (known level ≥ 2). Pure selector unit-tested; no sim import
  beyond it.
- Selection panel: an exposed sleeper shows "Sleeper (Harvester)" under its owner line; an exposed farm colony shows a
  "Dark Farm (suspected|confirmed)" row. Read-only, from the selector.
- Order menu (player-side action, `player/orderMenu.ts` + `executeShipAction.ts`, one new ShipActionType
  `ScenarioPurgeDarkFarm` behind the flag): on the player's own colony with a known farm → "Purge Dark Farm" (forces
  the turn now). Stretch **S1** (optional, +0.5 day): "Deep scan" on any freighter in trace-scanner range of a selected
  own ship — one detection roll at 3× chance (draw only on click, like the player DeployVirus action).

## 10. AI rules (testable statements)
1. No base-game function reads `state.darkFarms`; pre-exposure the host AI behaves exactly as without a farm except for
   the sleeper ships themselves (grep test: only `scenario/threats/*` and the UI selector import darkFarms).
2. A sleeper is a host **private** ship with the host's stock design until the turn (role/subRole/design identity).
3. At the turn every live sleeper of that farm is owned by the faction, has the armed design, and carries ≥ 1 robot
   troop when `darkFarmsRobotArmy`.
4. The faction is at locked war with every normal empire and never signs a treaty (relations stay War for 5 years of sim).
5. An idle loaded Harvester transport gets an UnloadTroops mission within one period if a target satisfying §5.E.c exists.
6. With `darkFarmsDirtyMethods` off: no blight infections, no Harvester agents, no Bombard missions from 5.E.d.
7. An AI host with a confirmed farm orders the purge or reaches 1.2× garrison within `exposedTurnDays`.

## 11. Tests (`test/scenarioDarkFarms.test.ts`, scenario harness `test/helpers/scenarioGame.ts`)
All via `createScenarioGame(base, { id: 'darkfarms', flags, params })`; force behaviour through params
(`graceYears 0`, `spawnChancePerMille 1000`, `minDevelopment 0`, `minPopulationMillions 0`).
1. Off: flag false → run 1 year → no `state.darkFarms`, Rnd draw count equal to the same game with handlers unregistered.
   Faithful game: `npm run repin -- --check` clean.
2. Spawn: one farm after the first year boundary, on an eligible non-capital colony; seeded habitat pinned (`toMatchPin`).
3. Production: after N periods `hiddenTroops` and sleeper counts match the formula; sleepers are in `host.privateBuiltObjects`.
4. Turn: `sleeperTurnCount 2` → faction exists (race Harvester), sleepers flipped + armed + loaded, farm habitat has
   invading troops; run 120 s → colony owner is the faction or the invasion failed with the stock "fended off" message.
5. Spread: 2 years after the turn at least one faction UnloadTroops mission and one faction-won invasion (seeded).
6. Dirty: unit — `inflictBombardDamage` by a faction ship with `blightChancePct 100` infects with Harvester Blight.
7. Discovery: park a trace-scanner ship next to a sleeper with `traceDetectPct 100` → level 3 knowledge + message.
8. Retake: take the farm colony by `takeOwnershipOfColonyFull` → farm dies (knob 1) / stays hidden (knob 0).
9. Save/load determinism mid-growth and post-turn (§7).
10. End: containment tear-down; defeat share → game-end handler called with code 1902 (`setGameEndHandler`).
11. Framework unit tests (`scenarioThreatFramework.test.ts`): invadeFromInside, flipToFaction, refitInPlace, revealTo,
    arcMessage once-only, createThreatFaction locked wars.

## 12. Acceptance criteria
- Flag off or no scenario: 0 pin changes, full suite green, `npm run typecheck` clean.
- In a 300-year seeded soak (`// @slow`) with default params a farm spawns, turns and invades ≥ 1 colony; the game keeps
  ticking without exceptions for 20 years after the turn; performance within 5% of the same run without the flag.
- All §10 statements have a test; all arc stages reachable by test.
- Save/load round-trip identical at every phase.

## 13. Risks
- Faction without a capital: stock code that dereferences `empire.capital` (diplomacy, character transfers in
  `declareWar`, ownership.ts) — create the faction and flip ships in the same period as the invasion, and audit the
  null paths hit in test 4; fallback: give the faction a pirate-style base habitat reference.
- Private ships with troops: private freighters normally never carry troops; troops are only added after the flip.
- `createNewDesigns` for a race with few templates → DEFAULT fallback; verify every sub-role the war AI needs exists.
- Balance: an early turn next to a weak host can snowball; knobs `graceYears`, `troopsPerYear`, `turnFleetRatioPct`.
- Race art: Harvester reuses Mechanoid portrait/ship family (no new art), acceptable per the no-art rule.
- `createEmpireMidGame` returns null when no empire id is left (`galaxy.maximumEmpireCount`, the GenerateShakturi
  guard): then the farm does not turn — it keeps growing and retries each period; test with a full galaxy.
- Characters file for the new race: none → `generateNewCharacter` must fall back to generic names (verify).

## 14. Size
~6 agent-days: mod-layer additions 0.5; framework 1; spawn/production/sleepers 1; turn 1; spread + dirty 1; discovery +
arc + UI 1; tests/soak 0.5. S1 +0.5.
