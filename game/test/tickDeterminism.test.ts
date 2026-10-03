// @slow — soak: the pinned 600 s determinism run (test:slow tier; see vite.config.ts testTier).
// M4a determinism + headless harness tests (tasks/M4-plan.md §5.1, §5.3 layers 3-5):
// - createGame(seed 1) run 120 game-s twice → identical digest; 60 + 60 → the same digest;
// - runGameSeconds for 600 game-s on that galaxy with every package stubbed does not throw; digest pinned;
// - basic invariants (no NaN positions / fuel / energy / money);
// - no real-clock or unseeded randomness under src/sim.
import { beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame, cachedTickGameRunIfBuilt } from './helpers/gameCache';
import { createTickGame } from './helpers/tickGame';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateCounts, stateDigest } from '../src/sim/tick/digest';
import type { Galaxy } from '../src/sim/galaxy';
import type { GameData } from '../src/sim/data/gameData';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function checkInvariants(g: Galaxy): void {
    for (const h of g.habitats) {
        expect(Number.isFinite(h.xpos) && Number.isFinite(h.ypos)).toBe(true);
    }
    for (const b of g.builtObjects) {
        if (b == null) continue; // teardown null holes (removed by the huge block's RemoveNullBuiltObjects)
        expect(Number.isFinite(b.xpos) && Number.isFinite(b.ypos)).toBe(true);
        expect(Number.isFinite(b.currentFuel) && b.currentFuel >= 0).toBe(true);
        expect(Number.isFinite(b.currentEnergy)).toBe(true);
    }
    for (const e of [...g.empires, ...g.pirateEmpires]) {
        expect(Number.isFinite(e.stateMoney) && Number.isFinite(e.privateMoney)).toBe(true);
    }
}

describe('determinism (single seeded galaxy.rnd, fixed-order scheduler)', () => {
    let digest120 = '';
    let long: Galaxy;

    it('120 game-s twice from createGame(seed 1) give the same digest', () => {
        // a is built here, b comes from the test game cache (test/helpers/gameCache.ts): this also checks that a cached
        // game is state-identical to a fresh createGame and ticks identically.
        const a = createTickGame(gameData).galaxy;
        const b = cachedTickGame(gameData).galaxy;
        expect(stateDigest(a)).toBe(stateDigest(b));
        const ra = runGameSeconds(a, 120);
        const rb = runGameSeconds(b, 120);
        expect(ra.frames).toBe(7200);
        expect(a.nowMs).toBe(120000);
        expect(ra.rndDraws).toBe(rb.rndDraws);
        digest120 = stateDigest(a);
        // Moved "7e883fd654919362" → "de44201fa725100c": 17d: human player starts with C# automation defaults (Start.2.cs:2122) (2026-09-25)
        // Moved "de44201fa725100c" → "54fda35daf42512d": fix4sim: BaconMain.cs 605-640/859-874 BaconInitialize applies the stock BaconSettings.txt (useStarGravityWells=false, HyperJumpThreshhold=4000, BaseHyperJumpAccuracy=666, sublightFuelBurnDivisor=20, noFuel* 0.9/0.9/0.5) after createGame; Galaxy.5.cs 1609-1616/1747-1752 populated planets/moons get Cargo/Troop lists (2026-09-25)
        // Moved "54fda35daf42512d" → "1cc3c565afacad34": dataload: the loaded BaconSettings.txt (BaconMain.cs 1101 ReadBaconSettings; 605-1062 BaconInitialize) replaces the movement-only stock copy: the remaining keys now apply at game start, e.g. tradeEverything=true (758), TroopGarrisonMinimumPerColony=20 (614), shipMarkupFactor=9 (770), shipMaintenanceCostPerSizeUnit=2 (766), allowInfrastructureImprovements=true (823), marketPriceUpdateChance=0.25 (851), privateBuildCostToStateMoney=0.3 (923), weaponRangeMultiplierForBases=2 (819); movement keys unchanged (digest parity with the stock copy verified) (2026-09-25)
        // Moved "1cc3c565afacad34" → "879ef519926e9d17": fix7: port capital.DoTasks at generation (Galaxy.7.cs 5290) and independent-colony DoTasks (Galaxy.8.cs 680): the intermediate block runs at t=0 and sets _LastIntermediateTouch, shifting CheckForShipsDiscoveringRuins timing (2026-09-26)
        // Moved "879ef519926e9d17" → "7c80fb468bf5713c": fix7: C# Systems[].Habitats excludes the star (Galaxy.6.cs 4611): FastFindNearestUnexploredHabitat[InSector] star-only branch, FindNearestUnexploredHabitatInSystem, Rnd.Next(0, Habitats.Count) at Empire.5.cs 1646/3871 and Empire.1.cs 4854, resort list Empire.5.cs 2815 — explorers get targets (2026-09-26)
        // Moved "7c80fb468bf5713c" → "6d114c3cf42fe29c": todosweep TODO(port) sweep: Galaxy.4.cs 2794 GenerateGasCloud places clouds in NebulaCloud locations (location/offset Rnd); Galaxy.6.cs 3714 FindNearestSystemGasCloudAsteroid sees Parent==null habitats (stars too), so SetupSun's spacing retries change the galaxy; Galaxy.8.cs 479-482 continental-planet lists; Start.2.cs 1484 Galaxy.DoTasks and 2035-2038 Capital.DoTasks at game start; Empire.9.cs 4772 GetOrders count in ProjectPrivateForceStructure; Galaxy.ResourceCurrentPrices in IdentifyResourceCentres; Habitat.cs 878 raid revenue, Empire.cs 1683 rebels, HabitatList.cs 553 MigrationFactor; Empire.1.cs 1021 / Empire.cs 1761 trade + space-port income in tribute; Empire.9.cs 5351 fuel costs; Galaxy.7.cs 4570-4594 trader refuel missions / retirement teardown; Galaxy.3.cs 1832 / 1851 docking under war / blockade; Galaxy.cs 3659/3681 mining rights, BaconGalaxy.cs 162 DetermineDefendingFirepower; Empire.9.cs 4035 CheckWhetherHabitatIsDangerous; Empire.9.cs 3071-3224 shared visibility; Race.cs 350-400 periodic levels; BuiltObject.cs 799 StrengthInNumbers; Empire.8.cs 16 CheckEmpireBuildingVictoryWonder; Empire.9.cs 4604 mission priority; Empire.cs 983 SpecialBonusDiplomacy; Empire.4.cs 4264 ruin colonization; Empire.7.cs 1429 purchase message; BaconGalaxy.cs 137 TargettingFactor; Galaxy.2.cs 5231 troop-general message; Start.cs 3954 AssignSystemName; Galaxy.6.cs 871 ClearColony (2026-09-26)
        // Moved "6d114c3cf42fe29c" → "3913ad38cb08e12e": sweep 2: Habitat.DoTasks on generated planets/moons (Galaxy.8.cs 215-551, Galaxy.5.cs 1587/1731; Habitat.cs 1399) with the Habitat ctor LastTouch = now - 30 s (Habitat.cs 6297-6303: orbits advance 30 s more); BaconMain.cs 700-715 queues ProcessEmpireScienceShips (Galaxy.Rnd.Next(26, 35) at BaconInitialize) and BaconGalaxy.cs 322-329 / BaconEmpire.cs 170-275 ProcessScienceShips; Start.2.cs 508-509 ColonizationRange(EnforceLimit) and Galaxy.BaseTechCost plumbed (defaults unchanged) (2026-09-26)
        // Moved "6d114c3cf42fe29c" → "3913ad38cb08e12e": merge: combattest2 + modlayer: Empire.LootingFactor is the pirate play-style factor (BaconEmpire.cs 83; Mercenary 1.33, Smuggler 0.75); scenario layer off = byte-identical (2026-09-26)
        // Moved "3913ad38cb08e12e" → "fc924a497a41e134": BaconMain.cs 686-697 BaconInitialize queues the SaveStats delayed action (1 day; BaconGalaxy.cs 319 re-queues it every statSaveIntervalInGameDays) and BaconMain.cs 1069/1075-1087 AddOtherDelayedEvents queues ClearShipsAboutToBeDestroyed with Galaxy.Rnd.Next(10, 12) after the 700-715 science-ship Next(26, 35) (2026-09-26)
        // Moved "fc924a497a41e134" → "4fb8e86d41e4c0d9": Habitat.cs 924-935/986-998 OrbitDistance/OrbitSpeed property setters recompute _AnglePerSecond on every reassignment; Galaxy.5.cs 1689/1730 sets a moon's real OrbitDistance well after construction (ctor gets a placeholder Rnd.Next(5,32)) relying on that recompute -- types.ts previously had these as plain fields, so moons kept the angular speed implied by the tiny placeholder radius applied to their real, much larger orbit (up to ~240x too fast); fixed by making orbitDistance/orbitSpeed real accessor properties (2026-09-28)
        // Moved "4fb8e86d41e4c0d9" → "dc89b652838d37f4": orbits spaced so planets/moons never overlap (user deviation) (2026-10-03)
        // Moved "dc89b652838d37f4" → "492736eb90d9ba45": parity A2: spaceport threat check, race periodic traits, wonders scenic, race wonders, garrisons, maintenance, retrofit design (2026-10-03)
        expect(digest120).toMatchPin('tickDeterminism.digest120');
        // Moved 5019 → 4959: 17d: human player starts with C# automation defaults (Start.2.cs:2122) (2026-09-25)
        // Moved 4959 → 6067: fix4sim: BaconMain.cs 605-640/859-874 BaconInitialize applies the stock BaconSettings.txt (useStarGravityWells=false, HyperJumpThreshhold=4000, BaseHyperJumpAccuracy=666, sublightFuelBurnDivisor=20, noFuel* 0.9/0.9/0.5) after createGame; Galaxy.5.cs 1609-1616/1747-1752 populated planets/moons get Cargo/Troop lists (2026-09-25)
        // Moved 6067 → 6130: dataload: the loaded BaconSettings.txt (BaconMain.cs 1101 ReadBaconSettings; 605-1062 BaconInitialize) replaces the movement-only stock copy: the remaining keys now apply at game start, e.g. tradeEverything=true (758), TroopGarrisonMinimumPerColony=20 (614), shipMarkupFactor=9 (770), shipMaintenanceCostPerSizeUnit=2 (766), allowInfrastructureImprovements=true (823), marketPriceUpdateChance=0.25 (851), privateBuildCostToStateMoney=0.3 (923), weaponRangeMultiplierForBases=2 (819); movement keys unchanged (digest parity with the stock copy verified) (2026-09-25)
        // Moved 6130 → 7646: fix7: C# Systems[].Habitats excludes the star (Galaxy.6.cs 4611): FastFindNearestUnexploredHabitat[InSector] star-only branch, FindNearestUnexploredHabitatInSystem, Rnd.Next(0, Habitats.Count) at Empire.5.cs 1646/3871 and Empire.1.cs 4854, resort list Empire.5.cs 2815 — explorers get targets (2026-09-26)
        // Moved 7646 → 11409: todosweep TODO(port) sweep: Galaxy.4.cs 2794 GenerateGasCloud places clouds in NebulaCloud locations (location/offset Rnd); Galaxy.6.cs 3714 FindNearestSystemGasCloudAsteroid sees Parent==null habitats (stars too), so SetupSun's spacing retries change the galaxy; Galaxy.8.cs 479-482 continental-planet lists; Start.2.cs 1484 Galaxy.DoTasks and 2035-2038 Capital.DoTasks at game start; Empire.9.cs 4772 GetOrders count in ProjectPrivateForceStructure; Galaxy.ResourceCurrentPrices in IdentifyResourceCentres; Habitat.cs 878 raid revenue, Empire.cs 1683 rebels, HabitatList.cs 553 MigrationFactor; Empire.1.cs 1021 / Empire.cs 1761 trade + space-port income in tribute; Empire.9.cs 5351 fuel costs; Galaxy.7.cs 4570-4594 trader refuel missions / retirement teardown; Galaxy.3.cs 1832 / 1851 docking under war / blockade; Galaxy.cs 3659/3681 mining rights, BaconGalaxy.cs 162 DetermineDefendingFirepower; Empire.9.cs 4035 CheckWhetherHabitatIsDangerous; Empire.9.cs 3071-3224 shared visibility; Race.cs 350-400 periodic levels; BuiltObject.cs 799 StrengthInNumbers; Empire.8.cs 16 CheckEmpireBuildingVictoryWonder; Empire.9.cs 4604 mission priority; Empire.cs 983 SpecialBonusDiplomacy; Empire.4.cs 4264 ruin colonization; Empire.7.cs 1429 purchase message; BaconGalaxy.cs 137 TargettingFactor; Galaxy.2.cs 5231 troop-general message; Start.cs 3954 AssignSystemName; Galaxy.6.cs 871 ClearColony (2026-09-26)
        // Moved 11409 → 11134: sweep 2: Habitat.DoTasks on generated planets/moons (Galaxy.8.cs 215-551, Galaxy.5.cs 1587/1731; Habitat.cs 1399) with the Habitat ctor LastTouch = now - 30 s (Habitat.cs 6297-6303: orbits advance 30 s more); BaconMain.cs 700-715 queues ProcessEmpireScienceShips (Galaxy.Rnd.Next(26, 35) at BaconInitialize) and BaconGalaxy.cs 322-329 / BaconEmpire.cs 170-275 ProcessScienceShips; Start.2.cs 508-509 ColonizationRange(EnforceLimit) and Galaxy.BaseTechCost plumbed (defaults unchanged) (2026-09-26)
        // Moved 11409 → 11134: merge: combattest2 + modlayer: Empire.LootingFactor is the pirate play-style factor (BaconEmpire.cs 83; Mercenary 1.33, Smuggler 0.75); scenario layer off = byte-identical (2026-09-26)
        // Moved 11134 → 11133: BaconMain.cs 686-697 BaconInitialize queues the SaveStats delayed action (1 day; BaconGalaxy.cs 319 re-queues it every statSaveIntervalInGameDays) and BaconMain.cs 1069/1075-1087 AddOtherDelayedEvents queues ClearShipsAboutToBeDestroyed with Galaxy.Rnd.Next(10, 12) after the 700-715 science-ship Next(26, 35) (2026-09-26)
        // Moved 11133 → 11524: Habitat.cs 924-935/986-998 OrbitDistance/OrbitSpeed property setters recompute _AnglePerSecond on every reassignment; Galaxy.5.cs 1689/1730 sets a moon's real OrbitDistance well after construction (ctor gets a placeholder Rnd.Next(5,32)) relying on that recompute -- types.ts previously had these as plain fields, so moons kept the angular speed implied by the tiny placeholder radius applied to their real, much larger orbit (up to ~240x too fast); fixed by making orbitDistance/orbitSpeed real accessor properties (2026-09-28)
        // Moved 11524 → 8503: orbits spaced so planets/moons never overlap (user deviation) (2026-10-03)
        // Moved 8503 → 7948: parity A2: spaceport threat check, race periodic traits, wonders scenic, race wonders, garrisons, maintenance, retrofit design (2026-10-03)
        expect(ra.rndDraws).toMatchPin('tickDeterminism.rndDraws120');
        expect(stateDigest(b)).toBe(digest120);
        long = a;
    }, 300000);

    it('60 + 60 game-s equals 120 game-s in one call', () => {
        const c = cachedTickGame(gameData).galaxy;
        runGameSeconds(c, 60);
        runGameSeconds(c, 60);
        expect(c.nowMs).toBe(120000);
        expect(stateDigest(c)).toBe(digest120);
    }, 300000);

    it('runGameSeconds runs 600 game-s on the createGame galaxy with every package stubbed (digest pinned)', () => {
        // Continue the 120 s run to 600 s (continuation is equivalent, see the test above).
        const r = runGameSeconds(long, 480);
        expect(long.nowMs).toBe(600000);
        expect(long.scheduler!.frames).toBe(36000);
        checkInvariants(long);
        const hits = r.todoHits;
        // Every tick family reached its stubs. (M4r: every diplomacy entry point reached is fully ported; M4s1 ported
        // reviewPirateMissionsAndAssign, so its marker is pirateCollectIncomeFromControlledColonies; M4e ported
        // autoRefuelRepairShip, which was the first marker; M4l ported performFleetTasks, so the BuiltObject periodic block
        // is detected by healTroops.)
        // (M4q ported ScanForNewOwner (Habitat periodic) and HealTroops (BuiltObject periodic), the last stubs of those
        // families: they are now detected by the periodic touches stamped during this continuation (Habitat.cs 1497,
        // BuiltObject.cs periodic block).)
        expect(long.empires[0].capital!.lastPeriodicTouch).toBeGreaterThan(120000);
        expect(long.builtObjects.some((b) => b != null && !b.hasBeenDestroyed && b.lastPeriodicTouch > 120000)).toBe(true);
        const factions = long.pirateEmpires.filter((p) => p.pirateEmpireBaseHabitat !== null);
        expect(factions.length).toBeGreaterThan(0);
        for (const p of factions) expect(p.lastIntermediateTouch, p.name).toBeGreaterThan(120000);
        const summary = { digest: stateDigest(long), counts: stateCounts(long), rndDraws: long.rnd.drawCount };
        console.log('[tick] seed 1, 600 game-s:', JSON.stringify(summary), 'stubs reached:', Object.keys(hits).length);
        // Seed pin: moves whenever createGame or a package changes Rnd use or ticked state (re-pin, say why).
        // Moved from 2e883aa30dfd001e when createGame adopted the real game-start ticks: the Start.2.cs 1344-1350
        // stagger now writes the empire touch times (the Rnd draw was already there), so empire blocks fire at
        // different frames; createGame's own pins did not move.
        // Moved from 78d35aa06c9a1e5b by M4t (ScanArea surveys habitats — one Rnd.Next(0, 800) per newly surveyed
        // non-independent habitat —, pre-warp visibility, exploration status, systems-only territory), M4d (colony
        // resupply orders, CheckMarketOrders contracts traders — FindFreighterForContract Rnd.Next(0, count) —,
        // Galaxy.Orders.Count digested), M4j (colony growth, development level, treasury, ProcessColonyTroops
        // recruits — Rnd per completed recruit —, CheckSatisfaction Rnd.Next(0, 3); game-start Empire.DoTasks too) and
        // M4b (ships run the real ExecuteCommands frame: parked ships follow their parent's orbit via
        // EvaluateRelativeToParent, the no-mission epilogue resets idle speeds; freighters contracted by M4d now get
        // real missions and command queues). M4k: the game-start and periodic Empire.DoTasks run PerformResearch (queue
        // project picks and research-event rolls draw Rnd; completed research changes components and troop types).
        // M4r: Empire.RelativeEmpireSize (hashed) is computed by CalculateRelativeEmpireSize and the diplomacy runtime
        // runs once empires meet.
        // M4g: colonies (and manufacturer bases) now own ManufacturingQueues whose
        // DoManufacturing draws Rnd.Next(0, manufacturers) per call; colonies and mining stations extract resources into
        // cargo (Habitat.ExtractResources, BuiltObject.IndustrialProcessing); PrioritizeEmpireResourceNeeds fills
        // EmpireResourceTargets; ReviewManufacturedResources may draw when a colony-manufactured resource can appear.
        // M4h: colonies (and populated independent habitats) now own a ConstructionQueue
        // whose DoConstruction draws Rnd.Next(0, yards.Count) in every periodic Habitat tick, and shipyards (space ports,
        // construction ships) get queues in ReDefine; DoRepairs / CheckForRepairs / CheckWhetherStillBeingBuilt run.
        // M4c: ships execute the movement cases (MoveTo / HyperTo / ConditionalHyperTo:
        // DoMovement, hyperjumps — HyperTo draws Rnd.Next(0, 2000) + SelectHyperJumpExitPoint per jump —, gravity-well
        // detours), energy collection / reactor recharge burn fuel every tick, EvaluateSystemLinks draws
        // Rnd.Next(0, count) for systems not linked to the capital through a space port.
        // M4n: BuiltObject.ThreatEvaluation / CheckForAttack / FleeFromHopelessBattle now
        // run (threat lists per ship and per SystemVisibility, Escape/Attack missions assigned to threatened ships, the
        // SystemVisibility.LatestThreatEvaluation timestamps, distress signals from NotifyOfAttack) and the Attack case
        // body runs (with the SensorJumpIntercept Rnd roll before a warp pursuit). No new Rnd sites are reached on this
        // seed otherwise (smuggler detection needs trace scanners; invasion landings need troops).
        // M4s1: the pirate mission marketplace runs — ReviewPirateRelations draws one
        // Rnd.NextDouble per Empire long block, IndependentColoniesMake{Smuggling,Defend}OffersToPirates draw per
        // independent colony (Next(0, 2) / Next(0, 30), plus DetermineColonyDeficientInResources' Next(0, orders)), the
        // smuggling offers create state orders, pirate factions accept smuggling missions, and
        // CountResourceSupplyLocations is ported (market price factors).
        // SelectCreatures population gating fix (Galaxy.5.cs 1648/1785): SelectCreatures(planet / moon) runs only when
        // the body has no population, which moves every galaxy-generation draw after the first populated body (creature
        // counts / positions, empire placement) and so everything downstream. (re-pinned after M4s1 (ReviewPirateRelations NextDouble per Empire long block; independent-colony pirate offers) and the SelectCreatures population gating fix (Galaxy.5.cs 1648/1785))
        // M4e: ships now execute the docking / cargo cases (Dock joins the wait queue and takes a bay, Load / Unload move
        // cargo and settle contracts, Refuel buys fuel at depots), habitats own DockingBays / wait queues from
        // generation, space ports order fuel (CheckForFuelOrdering) and low-fuel ships get Refuel missions
        // (CheckForRefuelling / SetupRefuelling / AutoRefuelRepairShip, InitiateRefuelData reservations). No new Rnd
        // site is reached on this seed (the smuggler-detection roll needs scanner-equipped bases).
        // M4i (facilities/wonders): Empire.RefreshColonyFacilityInfo now fills Empire.Capitals every long block, so the
        // leader's PopulationGrowth bonus at the capital (EvaluateColonyVariables, Empire.4.cs) applies; facility AI runs
        // (ReviewColonyFacilities may draw Rnd.Next(0, 2) for a space-port colony once a FortifiedBunker is buildable).
        // M4i (empire construction): DirectConstruction runs in every long block (RefactorForceStructureProjectionsToCosts
        // draws Rnd.Next(0, Count) per wanted sub-role; ships are queued and paid for once the cashflow allows), plus
        // ReviewLatestDesigns, RetireOldBuiltObjects, DetermineMonitoringStationLocation, BuildDefensiveBases.
        // Moved from 198918104ea2794b by M4u: DoCharacterEvent runtime (Galaxy.1.cs 3781: Next(0,5)/Next(0,20)/Next(0,80) per
        // character, trait cases, skill progress) now runs for the M4j/M4k/M4r/M4d events, Character.DoTasks completes
        // location transfers, ApplyLocationEffects draws for lightning / shield-reduction storms and slows ships in
        // nebulae, and ClearEmptyDebrisFields removes empty debris-field locations.
        // Moved from 9ba92363c1bf5e89 by M4u (character runtime + events): the game-start and periodic Empire.DoTasks run the
        // character reviews (ReviewCharacterTraits Next(0, n) / Next(0, 90), ApplyCharacterLocationBonusToOtherCharacters,
        // CheckForCharacterAppearance, leader changes), ReviewEmpireEvents (DoRaceEvent Next + NextDouble, race events,
        // resource appearance Next(0, 20)), ReviewRandomEvents / PirateReviewRandomEvents rolls and ProcessPlague; creatures
        // now target and pursue ships (Creature.cs 1206 CheckForTargets → NotifyOfAttack distress signals; DamageTarget is an
        // M4o stub), and the M4u pins moved createGame (empire placement) too.
        // M4o: weapons actually fire — FireWeaponsAtTarget draws the per-weapon fire-rate jitter NextDouble every call
        // (~157k calls in 600 s on this seed: pirate ships attacking), DetermineHitTarget (NextDouble, Next(0, 12)) and
        // Weapon.Fire (NextDouble, Next(0, 2)) per shot, InflictDamage's armor / component / explosion draws per hit,
        // CheckNearbyBuiltObjectsForShieldAreaRecharge's Next(0, Count); shields recharge (energy), ships take damage and
        // are torn down (CompleteTeardown nulls galaxy.BuiltObjects entries, cleans empire lists), Explosions accumulate.
        // Merge of M4o onto M4u (from 60414368e7e93744 / M4o's e01a949ad05e47a1): both sets of changes above, plus the
        // merge fixes: creatures' DamageTarget still a stub, M4u storm damage now goes through M4o's real InflictDamage,
        // Character SendDeathMessage + Kill run for characters on destroyed ships / bombarded colonies, CleanupInvalidShips
        // and IdentifyPirateSpaceport without the extra fallback loop, and Weapon.LastFired defaults to DateTime.MinValue
        // (MIN_TIME) so a never-fired weapon is available at once (Weapon.cs 18/183).
        // M4l: moved from 198918104ea2794b — the independent/pirate Empire constructor now sets the Empire.cs 4218-4235
        // automation flags (they were missing). Only ControlResearch moves this run: pirate factions now pick research
        // projects in PerformResearch (Rnd draws; with ControlResearch false the old digest comes back). The fleet code
        // itself draws nothing here: the createGame empires have no warships and pirate escorts are not fleet candidates.
        // Merge of M4l onto the M4u + M4o merge (from 00268e34a10c8f1f / M4l's da61bc3c07a9db45): both sets of changes, plus
        // the merge fixes (M4i's real AssignFleetRetrofit and M4l's QueueMission / SubsequentMissions replace the stubs on
        // either side, fleet speeds read the modelled admiral bonuses, ShipGroup battle stats are finalised with M4o's
        // ResolveNearestLocation + DoCharacterEvent(SpaceBattle)).
        // M4f: AssignMissionToBuiltObject runs at game start (Start.2.cs 1373) and every Empire short block
        // (AssignShipMissions) — freighters draw NextDouble + Next(0, colonies) [+ Next(0, mining stations)], military
        // ships Next(0, 2) / Next(0, 8) / Next(0, colonies), construction ships Next(0, 2) x2-4 (+ Next(0, ships)),
        // exploration ships the FindNextHabitatToExplore jitter draws — so ships now get missions (Move / Explore /
        // Patrol / Transport / Build / ExtractResources), the ReassignMission case reassigns explorers, and
        // DirectPrivateConstruction draws Next(0, space ports) per long block. Moved from 198918104ea2794b.
        // Merge of M4f onto the M4u/M4o/M4l merge (from af6355042f443986 / M4f's 7a546c084a01ddcf): both sets of changes,
        // plus the merge fixes (civilianAI uses M4i's real AssignScrapMission / ProcureConstructionComponents, M4e's
        // SetupRefuelling and the shared GetBuiltObjectsAtLocation / HabitatCompareTo / DesignCalculateMaintenanceCosts
        // instead of its own copies), re-pinned once.
        // Moved from 2689770786790d6a: tick harness now models the default age-1 start (every empire starts at Age 1,
        // "Starting": larger colonies, positive cashflow, DirectConstruction queues ships at once; see helpers/tickGame.ts).
        // Moved from 00ea05e8d2465a22: interim harness configuration after the M4x merge (age-0 empires, galaxy age 0, see test/helpers/tickGame.ts) until M4y flips it to the true age-1 default
        // M4p: carriers build fighters (BuildNewFighters / ManufactureRepairFighters, no Rnd) — the player's capital space
        // port fills its fighter bays — and launch them when threats appear (LaunchFighter: Next(0, 2) + RandomHeadingOffset
        // NextDouble); launched fighters patrol (PerformPatrol NextDouble / Next(0, 2) + RandomHeadingOffset), attack creatures
        // near the port (DetermineHitTarget NextDouble + Next(0, 12), FighterWeapon.Fire NextDouble + Next(0, 2), InflictDamage),
        // and ApplyLocationEffectsNEW draws in storms. Moved from 2689770786790d6a.
        // Moved from REPIN: M4p merged on top of the interim harness configuration (fighters launch, patrol and fight; see the M4p reason above)
        // Moved from 2689770786790d6a by M4s2: the pirate faction AI runs (PirateAssignShipMissions draws Rnd per idle ship —
        // exploration / patrol / raid target picks, IdentifyPirateNewHomeLocation —; PirateRecalculateEmpireCorruption one
        // NextDouble per periodic block; PirateGenerateSellInfoOffers / PirateTradeItems / GeneratePirateOffersForSingleEmpire
        // draws; PirateDoConstruction builds ships (names, headings, RefactorForceStructureProjectionsToCosts order));
        // ReviewPirateControl gives factions colony control (pirate income, corruption, facilities); teardown null holes are
        // digested as -1.
        // Moved from REPIN: M4s2 merged (pirate faction AI draws Rnd and builds ships; see the M4s2 reason above)
        // Moved from 2689770786790d6a by M4y: harness galaxy is now the true age-1 default (military starting ships), with
        // M4y's ReviewCharacterLocation FleetAdmiral / TroopGeneral / PirateLeader fleet branches (Empire.7.cs 698-918,
        // 1135-1206) ported so the fleets that form are reviewed instead of throwing.
        // Moved from 2d0371380457abff: M4y merged on top of M4s2 (harness at the true age-1 default start with the pirate faction AI; see both reasons above)
        // Moved from 2689770786790d6a by M4m: the military AI runs: IdentifyMilitaryObjectives draws Next(0, EmpireEvaluations.Count)
        // every Empire periodic block (and SendScoutShipsToEnemyLocations / strike-point rolls at war), CheckTemptingTargets
        // Next(0, Empires.Count) (+ per Conquer/Punish empire) and DetermineRandomAttacks Next(0, n) every long block,
        // TaskResupplyShips / ReviewSystemThreats / SendAvailableFleetsToGuard their SelectRelativePoint / parking draws; the
        // game-start DoTasks draws them too (createGame pins moved); the Escort / Blockade command cases run, and
        // WarnOfIncomingEnemyFleets / blockades feed the incoming-fleet and docking logic.
        // Moved from 7fa509b3737717ba: M4m merged on top of M4s2 + M4y (military AI draws in every Empire periodic / long block, fleet tasking, blockades; the pirate AI uses M4m's FindNearestAvailableFleet / CalculateDefendingStrength / EnsureBaseDefendedByFleet; see the M4m reason above)
        // Moved from 2689770786790d6a by M4q (its base digest fc77d2b53feed820): InvadeUnwillingColonizationTargets draws
        // Rnd.NextDouble in each Empire.DoTasks (game start included); ground invasion, boarding, assault pods, ownership transfer.
        // Moved from 3718bd4b31a849ad: M4q merged on top of M4s2 + M4y + M4m (InvadeUnwillingColonizationTargets NextDouble per Empire.DoTasks, invasions / boarding / ownership transfer; pirate colony control wired to M4s2's model; see the M4q reason above)
        // Moved from dea5e410d47ea503 by M4z6: EvaluateColonyVariables places the colony strategic / critical / luxury orders
        // (Empire.4.cs 2330 / 2357 / 3186, game start included), GiveTradeableItem / ProcessMessages book the PirateEconomy
        // ledger, Creature.DamageTarget (Creature.cs 1347) damages its targets, bombardment tests PlanetaryFacilityType by
        // value, and the StellarObject readers see Fighters' FirepowerRaw / TopSpeed.
        // Moved from 2fb83dc55600537f: research trading is live (Galaxy.4.cs 4310/4551 ResolveTradeableItemsResearchProjects offers projects; GiveTradeableItem / Empire.3.cs 4467 research purchase run DoResearchBreakthrough)
        // Moved "d4e45fea75fa52d8" → "a59640a37d6c8238": 17d: human player starts with C# automation defaults (Start.2.cs:2122) (2026-09-25)
        // Moved "a59640a37d6c8238" → "811d6c7248402a11": fix4sim: BaconMain.cs 605-640/859-874 BaconInitialize applies the stock BaconSettings.txt (useStarGravityWells=false, HyperJumpThreshhold=4000, BaseHyperJumpAccuracy=666, sublightFuelBurnDivisor=20, noFuel* 0.9/0.9/0.5) after createGame; Galaxy.5.cs 1609-1616/1747-1752 populated planets/moons get Cargo/Troop lists (2026-09-25)
        // Moved "811d6c7248402a11" → "7a64641af669b6b0": dataload: the loaded BaconSettings.txt (BaconMain.cs 1101 ReadBaconSettings; 605-1062 BaconInitialize) replaces the movement-only stock copy: the remaining keys now apply at game start, e.g. tradeEverything=true (758), TroopGarrisonMinimumPerColony=20 (614), shipMarkupFactor=9 (770), shipMaintenanceCostPerSizeUnit=2 (766), allowInfrastructureImprovements=true (823), marketPriceUpdateChance=0.25 (851), privateBuildCostToStateMoney=0.3 (923), weaponRangeMultiplierForBases=2 (819); movement keys unchanged (digest parity with the stock copy verified) (2026-09-25)
        // Moved "7a64641af669b6b0" → "072fc70665f97da0": fix7: port capital.DoTasks at generation (Galaxy.7.cs 5290) and independent-colony DoTasks (Galaxy.8.cs 680): the intermediate block runs at t=0 and sets _LastIntermediateTouch, shifting CheckForShipsDiscoveringRuins timing (2026-09-26)
        // Moved "072fc70665f97da0" → "ca858dbaaec075df": fix7: C# Systems[].Habitats excludes the star (Galaxy.6.cs 4611): FastFindNearestUnexploredHabitat[InSector] star-only branch, FindNearestUnexploredHabitatInSystem, Rnd.Next(0, Habitats.Count) at Empire.5.cs 1646/3871 and Empire.1.cs 4854, resort list Empire.5.cs 2815 — explorers get targets (2026-09-26)
        // Moved "ca858dbaaec075df" → "ffeb947e780b83ec": combat verification: GenerateBuiltObjectFromDesign now builds components Normal (Empire.cs 4346; was Unbuilt), and Empire.RaidStrengthFactor (BaconEmpire.cs 75) is read in the assault-pod strength / boarding defence maths (was always 1.0) (2026-09-26)
        // Moved "ca858dbaaec075df" → "247aef9d4d98670a": todosweep TODO(port) sweep: Galaxy.4.cs 2794 GenerateGasCloud places clouds in NebulaCloud locations (location/offset Rnd); Galaxy.6.cs 3714 FindNearestSystemGasCloudAsteroid sees Parent==null habitats (stars too), so SetupSun's spacing retries change the galaxy; Galaxy.8.cs 479-482 continental-planet lists; Start.2.cs 1484 Galaxy.DoTasks and 2035-2038 Capital.DoTasks at game start; Empire.9.cs 4772 GetOrders count in ProjectPrivateForceStructure; Galaxy.ResourceCurrentPrices in IdentifyResourceCentres; Habitat.cs 878 raid revenue, Empire.cs 1683 rebels, HabitatList.cs 553 MigrationFactor; Empire.1.cs 1021 / Empire.cs 1761 trade + space-port income in tribute; Empire.9.cs 5351 fuel costs; Galaxy.7.cs 4570-4594 trader refuel missions / retirement teardown; Galaxy.3.cs 1832 / 1851 docking under war / blockade; Galaxy.cs 3659/3681 mining rights, BaconGalaxy.cs 162 DetermineDefendingFirepower; Empire.9.cs 4035 CheckWhetherHabitatIsDangerous; Empire.9.cs 3071-3224 shared visibility; Race.cs 350-400 periodic levels; BuiltObject.cs 799 StrengthInNumbers; Empire.8.cs 16 CheckEmpireBuildingVictoryWonder; Empire.9.cs 4604 mission priority; Empire.cs 983 SpecialBonusDiplomacy; Empire.4.cs 4264 ruin colonization; Empire.7.cs 1429 purchase message; BaconGalaxy.cs 137 TargettingFactor; Galaxy.2.cs 5231 troop-general message; Start.cs 3954 AssignSystemName; Galaxy.6.cs 871 ClearColony (2026-09-26)
        // Moved "247aef9d4d98670a" → "3d1470d82df29893": merge: todosweep generation ports on top of combattest fixes (GenerateGasCloud in nebulae, SetupSun spacing retries, components Normal, raid strength) (2026-09-26)
        // Moved "247aef9d4d98670a" → "627c08defbc547e7": sweep 2: Habitat.DoTasks on generated planets/moons (Galaxy.8.cs 215-551, Galaxy.5.cs 1587/1731; Habitat.cs 1399) with the Habitat ctor LastTouch = now - 30 s (Habitat.cs 6297-6303: orbits advance 30 s more); BaconMain.cs 700-715 queues ProcessEmpireScienceShips (Galaxy.Rnd.Next(26, 35) at BaconInitialize) and BaconGalaxy.cs 322-329 / BaconEmpire.cs 170-275 ProcessScienceShips; Start.2.cs 508-509 ColonizationRange(EnforceLimit) and Galaxy.BaseTechCost plumbed (defaults unchanged) (2026-09-26)
        // Moved "247aef9d4d98670a" → "22f624f8012faa81": combattest2: Empire.LootingFactor is the pirate play-style factor (BaconEmpire.cs 83; Mercenary 1.33, Smuggler 0.75), not 1.0; DoRepairs records on the fleet BattleStats (2026-09-26)
        // Moved "22f624f8012faa81" → "627c08defbc547e7": merge: combattest2 + modlayer: Empire.LootingFactor is the pirate play-style factor (BaconEmpire.cs 83; Mercenary 1.33, Smuggler 0.75); scenario layer off = byte-identical (2026-09-26)
        // Moved "627c08defbc547e7" → "09dbdbc868a2ce9a": BaconMain.cs 686-697 BaconInitialize queues the SaveStats delayed action (1 day; BaconGalaxy.cs 319 re-queues it every statSaveIntervalInGameDays) and BaconMain.cs 1069/1075-1087 AddOtherDelayedEvents queues ClearShipsAboutToBeDestroyed with Galaxy.Rnd.Next(10, 12) after the 700-715 science-ship Next(26, 35) (2026-09-26)
        // Moved "09dbdbc868a2ce9a" → "debd45f48e221a8e": Habitat.cs 924-935/986-998 OrbitDistance/OrbitSpeed property setters recompute _AnglePerSecond on every reassignment; Galaxy.5.cs 1689/1730 sets a moon's real OrbitDistance well after construction (ctor gets a placeholder Rnd.Next(5,32)) relying on that recompute -- types.ts previously had these as plain fields, so moons kept the angular speed implied by the tiny placeholder radius applied to their real, much larger orbit (up to ~240x too fast); fixed by making orbitDistance/orbitSpeed real accessor properties (2026-09-28)
        // Moved "debd45f48e221a8e" → "7e33f79b0cd5b5a3": player explorers skip found-but-uninvestigated ruins (explorer stuck on planet) (2026-10-01)
        // Moved "7e33f79b0cd5b5a3" → "0a197d262536cac8": orbits spaced so planets/moons never overlap (user deviation) (2026-10-03)
        // Moved "0a197d262536cac8" → "89d3bfddd78f6edc": parity A2: spaceport threat check, race periodic traits, wonders scenic, race wonders, garrisons, maintenance, retrofit design (2026-10-03)
        expect(summary.digest).toMatchPin('tickDeterminism.digest600');
        // (counts and Galaxy.Rnd draws pinned with the digest, tasks/M4-plan.md §5.3.4.)
        // Moved #f1aebd5dcd → #d21f9fe281: 17d: human player starts with C# automation defaults (Start.2.cs:2122) (2026-09-25)
        // Moved #d21f9fe281 → #3f75d659d2: fix4sim: BaconMain.cs 605-640/859-874 BaconInitialize applies the stock BaconSettings.txt (useStarGravityWells=false, HyperJumpThreshhold=4000, BaseHyperJumpAccuracy=666, sublightFuelBurnDivisor=20, noFuel* 0.9/0.9/0.5) after createGame; Galaxy.5.cs 1609-1616/1747-1752 populated planets/moons get Cargo/Troop lists (2026-09-25)
        // Moved #3f75d659d2 → #0c48c52ad2: dataload: the loaded BaconSettings.txt (BaconMain.cs 1101 ReadBaconSettings; 605-1062 BaconInitialize) replaces the movement-only stock copy: the remaining keys now apply at game start, e.g. tradeEverything=true (758), TroopGarrisonMinimumPerColony=20 (614), shipMarkupFactor=9 (770), shipMaintenanceCostPerSizeUnit=2 (766), allowInfrastructureImprovements=true (823), marketPriceUpdateChance=0.25 (851), privateBuildCostToStateMoney=0.3 (923), weaponRangeMultiplierForBases=2 (819); movement keys unchanged (digest parity with the stock copy verified) (2026-09-25)
        // Moved #0c48c52ad2 → #48a3abb754: fix7: C# Systems[].Habitats excludes the star (Galaxy.6.cs 4611): FastFindNearestUnexploredHabitat[InSector] star-only branch, FindNearestUnexploredHabitatInSystem, Rnd.Next(0, Habitats.Count) at Empire.5.cs 1646/3871 and Empire.1.cs 4854, resort list Empire.5.cs 2815 — explorers get targets (2026-09-26)
        // Moved #48a3abb754 → #55634f7fc2: combat verification: GenerateBuiltObjectFromDesign now builds components Normal (Empire.cs 4346; was Unbuilt), and Empire.RaidStrengthFactor (BaconEmpire.cs 75) is read in the assault-pod strength / boarding defence maths (was always 1.0) (2026-09-26)
        // Moved #48a3abb754 → #4894cc7f13: todosweep TODO(port) sweep: Galaxy.4.cs 2794 GenerateGasCloud places clouds in NebulaCloud locations (location/offset Rnd); Galaxy.6.cs 3714 FindNearestSystemGasCloudAsteroid sees Parent==null habitats (stars too), so SetupSun's spacing retries change the galaxy; Galaxy.8.cs 479-482 continental-planet lists; Start.2.cs 1484 Galaxy.DoTasks and 2035-2038 Capital.DoTasks at game start; Empire.9.cs 4772 GetOrders count in ProjectPrivateForceStructure; Galaxy.ResourceCurrentPrices in IdentifyResourceCentres; Habitat.cs 878 raid revenue, Empire.cs 1683 rebels, HabitatList.cs 553 MigrationFactor; Empire.1.cs 1021 / Empire.cs 1761 trade + space-port income in tribute; Empire.9.cs 5351 fuel costs; Galaxy.7.cs 4570-4594 trader refuel missions / retirement teardown; Galaxy.3.cs 1832 / 1851 docking under war / blockade; Galaxy.cs 3659/3681 mining rights, BaconGalaxy.cs 162 DetermineDefendingFirepower; Empire.9.cs 4035 CheckWhetherHabitatIsDangerous; Empire.9.cs 3071-3224 shared visibility; Race.cs 350-400 periodic levels; BuiltObject.cs 799 StrengthInNumbers; Empire.8.cs 16 CheckEmpireBuildingVictoryWonder; Empire.9.cs 4604 mission priority; Empire.cs 983 SpecialBonusDiplomacy; Empire.4.cs 4264 ruin colonization; Empire.7.cs 1429 purchase message; BaconGalaxy.cs 137 TargettingFactor; Galaxy.2.cs 5231 troop-general message; Start.cs 3954 AssignSystemName; Galaxy.6.cs 871 ClearColony (2026-09-26)
        // Moved #4894cc7f13 → #331d4338ad: merge: todosweep generation ports on top of combattest fixes (GenerateGasCloud in nebulae, SetupSun spacing retries, components Normal, raid strength) (2026-09-26)
        // Moved #4894cc7f13 → #1d1b42402d: sweep 2: Habitat.DoTasks on generated planets/moons (Galaxy.8.cs 215-551, Galaxy.5.cs 1587/1731; Habitat.cs 1399) with the Habitat ctor LastTouch = now - 30 s (Habitat.cs 6297-6303: orbits advance 30 s more); BaconMain.cs 700-715 queues ProcessEmpireScienceShips (Galaxy.Rnd.Next(26, 35) at BaconInitialize) and BaconGalaxy.cs 322-329 / BaconEmpire.cs 170-275 ProcessScienceShips; Start.2.cs 508-509 ColonizationRange(EnforceLimit) and Galaxy.BaseTechCost plumbed (defaults unchanged) (2026-09-26)
        // Moved #4894cc7f13 → #331d4338ad: combattest2: Empire.LootingFactor is the pirate play-style factor (BaconEmpire.cs 83; Mercenary 1.33, Smuggler 0.75), not 1.0; DoRepairs records on the fleet BattleStats (2026-09-26)
        // Moved #331d4338ad → #1d1b42402d: merge: combattest2 + modlayer: Empire.LootingFactor is the pirate play-style factor (BaconEmpire.cs 83; Mercenary 1.33, Smuggler 0.75); scenario layer off = byte-identical (2026-09-26)
        // Moved #1d1b42402d → #f6b377a02f: BaconMain.cs 686-697 BaconInitialize queues the SaveStats delayed action (1 day; BaconGalaxy.cs 319 re-queues it every statSaveIntervalInGameDays) and BaconMain.cs 1069/1075-1087 AddOtherDelayedEvents queues ClearShipsAboutToBeDestroyed with Galaxy.Rnd.Next(10, 12) after the 700-715 science-ship Next(26, 35) (2026-09-26)
        // Moved #f6b377a02f → #fb42ef63a8: Habitat.cs 924-935/986-998 OrbitDistance/OrbitSpeed property setters recompute _AnglePerSecond on every reassignment; Galaxy.5.cs 1689/1730 sets a moon's real OrbitDistance well after construction (ctor gets a placeholder Rnd.Next(5,32)) relying on that recompute -- types.ts previously had these as plain fields, so moons kept the angular speed implied by the tiny placeholder radius applied to their real, much larger orbit (up to ~240x too fast); fixed by making orbitDistance/orbitSpeed real accessor properties (2026-09-28)
        // Moved #fb42ef63a8 → #30732dcefb: player explorers skip found-but-uninvestigated ruins (explorer stuck on planet) (2026-10-01)
        // Moved #30732dcefb → #873f307b0e: orbits spaced so planets/moons never overlap (user deviation) (2026-10-03)
        // Moved #873f307b0e → #f78b172cc4: parity A2: spaceport threat check, race periodic traits, wonders scenic, race wonders, garrisons, maintenance, retrofit design (2026-10-03)
        expect(summary.counts).toMatchPin('tickDeterminism.counts600');
        // Moved 389082 → 384537: 17d: human player starts with C# automation defaults (Start.2.cs:2122) (2026-09-25)
        // Moved 384537 → 571596: fix4sim: BaconMain.cs 605-640/859-874 BaconInitialize applies the stock BaconSettings.txt (useStarGravityWells=false, HyperJumpThreshhold=4000, BaseHyperJumpAccuracy=666, sublightFuelBurnDivisor=20, noFuel* 0.9/0.9/0.5) after createGame; Galaxy.5.cs 1609-1616/1747-1752 populated planets/moons get Cargo/Troop lists (2026-09-25)
        // Moved 571596 → 529241: dataload: the loaded BaconSettings.txt (BaconMain.cs 1101 ReadBaconSettings; 605-1062 BaconInitialize) replaces the movement-only stock copy: the remaining keys now apply at game start, e.g. tradeEverything=true (758), TroopGarrisonMinimumPerColony=20 (614), shipMarkupFactor=9 (770), shipMaintenanceCostPerSizeUnit=2 (766), allowInfrastructureImprovements=true (823), marketPriceUpdateChance=0.25 (851), privateBuildCostToStateMoney=0.3 (923), weaponRangeMultiplierForBases=2 (819); movement keys unchanged (digest parity with the stock copy verified) (2026-09-25)
        // Moved 529241 → 474839: fix7: C# Systems[].Habitats excludes the star (Galaxy.6.cs 4611): FastFindNearestUnexploredHabitat[InSector] star-only branch, FindNearestUnexploredHabitatInSystem, Rnd.Next(0, Habitats.Count) at Empire.5.cs 1646/3871 and Empire.1.cs 4854, resort list Empire.5.cs 2815 — explorers get targets (2026-09-26)
        // Moved 474839 → 476644: combat verification: GenerateBuiltObjectFromDesign now builds components Normal (Empire.cs 4346; was Unbuilt), and Empire.RaidStrengthFactor (BaconEmpire.cs 75) is read in the assault-pod strength / boarding defence maths (was always 1.0) (2026-09-26)
        // Moved 474839 → 586223: todosweep TODO(port) sweep: Galaxy.4.cs 2794 GenerateGasCloud places clouds in NebulaCloud locations (location/offset Rnd); Galaxy.6.cs 3714 FindNearestSystemGasCloudAsteroid sees Parent==null habitats (stars too), so SetupSun's spacing retries change the galaxy; Galaxy.8.cs 479-482 continental-planet lists; Start.2.cs 1484 Galaxy.DoTasks and 2035-2038 Capital.DoTasks at game start; Empire.9.cs 4772 GetOrders count in ProjectPrivateForceStructure; Galaxy.ResourceCurrentPrices in IdentifyResourceCentres; Habitat.cs 878 raid revenue, Empire.cs 1683 rebels, HabitatList.cs 553 MigrationFactor; Empire.1.cs 1021 / Empire.cs 1761 trade + space-port income in tribute; Empire.9.cs 5351 fuel costs; Galaxy.7.cs 4570-4594 trader refuel missions / retirement teardown; Galaxy.3.cs 1832 / 1851 docking under war / blockade; Galaxy.cs 3659/3681 mining rights, BaconGalaxy.cs 162 DetermineDefendingFirepower; Empire.9.cs 4035 CheckWhetherHabitatIsDangerous; Empire.9.cs 3071-3224 shared visibility; Race.cs 350-400 periodic levels; BuiltObject.cs 799 StrengthInNumbers; Empire.8.cs 16 CheckEmpireBuildingVictoryWonder; Empire.9.cs 4604 mission priority; Empire.cs 983 SpecialBonusDiplomacy; Empire.4.cs 4264 ruin colonization; Empire.7.cs 1429 purchase message; BaconGalaxy.cs 137 TargettingFactor; Galaxy.2.cs 5231 troop-general message; Start.cs 3954 AssignSystemName; Galaxy.6.cs 871 ClearColony (2026-09-26)
        // Moved 586223 → 669918: merge: todosweep generation ports on top of combattest fixes (GenerateGasCloud in nebulae, SetupSun spacing retries, components Normal, raid strength) (2026-09-26)
        // Moved 586223 → 502453: sweep 2: Habitat.DoTasks on generated planets/moons (Galaxy.8.cs 215-551, Galaxy.5.cs 1587/1731; Habitat.cs 1399) with the Habitat ctor LastTouch = now - 30 s (Habitat.cs 6297-6303: orbits advance 30 s more); BaconMain.cs 700-715 queues ProcessEmpireScienceShips (Galaxy.Rnd.Next(26, 35) at BaconInitialize) and BaconGalaxy.cs 322-329 / BaconEmpire.cs 170-275 ProcessScienceShips; Start.2.cs 508-509 ColonizationRange(EnforceLimit) and Galaxy.BaseTechCost plumbed (defaults unchanged) (2026-09-26)
        // Moved 586223 → 669918: combattest2: Empire.LootingFactor is the pirate play-style factor (BaconEmpire.cs 83; Mercenary 1.33, Smuggler 0.75), not 1.0; DoRepairs records on the fleet BattleStats (2026-09-26)
        // Moved 669918 → 502453: merge: combattest2 + modlayer: Empire.LootingFactor is the pirate play-style factor (BaconEmpire.cs 83; Mercenary 1.33, Smuggler 0.75); scenario layer off = byte-identical (2026-09-26)
        // Moved 502453 → 594013: BaconMain.cs 686-697 BaconInitialize queues the SaveStats delayed action (1 day; BaconGalaxy.cs 319 re-queues it every statSaveIntervalInGameDays) and BaconMain.cs 1069/1075-1087 AddOtherDelayedEvents queues ClearShipsAboutToBeDestroyed with Galaxy.Rnd.Next(10, 12) after the 700-715 science-ship Next(26, 35) (2026-09-26)
        // Moved 594013 → 658628: Habitat.cs 924-935/986-998 OrbitDistance/OrbitSpeed property setters recompute _AnglePerSecond on every reassignment; Galaxy.5.cs 1689/1730 sets a moon's real OrbitDistance well after construction (ctor gets a placeholder Rnd.Next(5,32)) relying on that recompute -- types.ts previously had these as plain fields, so moons kept the angular speed implied by the tiny placeholder radius applied to their real, much larger orbit (up to ~240x too fast); fixed by making orbitDistance/orbitSpeed real accessor properties (2026-09-28)
        // Moved 658628 → 635176: player explorers skip found-but-uninvestigated ruins (explorer stuck on planet) (2026-10-01)
        // Moved 635176 → 566691: orbits spaced so planets/moons never overlap (user deviation) (2026-10-03)
        // Moved 566691 → 579423: parity A2: spaceport threat check, race periodic traits, wonders scenic, race wonders, garrisons, maintenance, retrofit design (2026-10-03)
        expect(summary.rndDraws).toMatchPin('tickDeterminism.rndDraws600');
        // The test game cache's 600 s game (one createGame + runGameSeconds(600) call, saved and loaded; the harness
        // smokes of other files use it) is this state. Checked when another file has built it (not built here: that
        // would double this soak on a cold cache).
        const cached = cachedTickGameRunIfBuilt(gameData, { seconds: 600 })?.game.galaxy;
        if (cached !== undefined) {
            expect(stateDigest(cached)).toBe(summary.digest);
            expect(stateCounts(cached)).toEqual(summary.counts);
            expect(cached.rnd.drawCount).toBe(summary.rndDraws);
        }
    }, 1800000);
});

describe('pre-warp start (age 0) stays covered', () => {
    it('createGame with every empire at age 0 (the PreWarp start) runs 120 game-s without throwing', () => {
        const g = cachedTickGame(gameData, { age: 0 }).galaxy;
        runGameSeconds(g, 120);
        expect(g.nowMs).toBe(120000);
        checkInvariants(g);
    }, 300000);
});

describe('no real-clock or unseeded randomness under src/sim (plan §5.1)', () => {
    it('src/sim has no Math.random / Date.now / performance.now outside the wizard default seed', () => {
        const root = resolve(__dirname, '../src/sim');
        const offenders: string[] = [];
        const walk = (dir: string): void => {
            for (const name of readdirSync(dir)) {
                const p = join(dir, name);
                if (statSync(p).isDirectory()) walk(p);
                else if (p.endsWith('.ts')) {
                    const lines = readFileSync(p, 'utf8').split('\n');
                    lines.forEach((line, i) => {
                        const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
                        if (/\bMath\.random\s*\(|\bDate\.now\s*\(|\bperformance\.now\s*\(|new Date\s*\(/.test(code)) offenders.push(`${p}:${i + 1}`);
                    });
                }
            }
        };
        walk(root);
        // startGameOptions.ts: the new-game wizard's default seed (not simulation state).
        expect(offenders.filter((o) => !o.includes('startGameOptions.ts'))).toEqual([]);
    });
});
