// M4a determinism + headless harness tests (tasks/M4-plan.md §5.1, §5.3 layers 3-5):
// - createGame(seed 1) run 120 game-s twice → identical digest; 60 + 60 → the same digest;
// - runGameSeconds for 600 game-s on that galaxy with every package stubbed does not throw; digest pinned;
// - basic invariants (no NaN positions / fuel / energy / money);
// - no real-clock or unseeded randomness under src/sim.
import { beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadGameDataFs } from './helpers/loadGameDataFs';
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
        const a = createTickGame(gameData).galaxy;
        const b = createTickGame(gameData).galaxy;
        expect(stateDigest(a)).toBe(stateDigest(b));
        const ra = runGameSeconds(a, 120);
        const rb = runGameSeconds(b, 120);
        expect(ra.frames).toBe(7200);
        expect(a.nowMs).toBe(120000);
        expect(ra.rndDraws).toBe(rb.rndDraws);
        digest120 = stateDigest(a);
        expect(stateDigest(b)).toBe(digest120);
        long = a;
    }, 300000);

    it('60 + 60 game-s equals 120 game-s in one call', () => {
        const c = createTickGame(gameData).galaxy;
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
        // is detected by healTroops; M4q ported ScanForNewOwner / HealTroops, so the markers are M4s reviewPirateControl (Habitat
        // periodic) and pirateBaseDiscovery (BuiltObject periodic).)
        for (const key of ['M4s reviewPirateControl', 'M4s pirateAssignShipMissions', 'M4s pirateCollectIncomeFromControlledColonies', 'M4s pirateBaseDiscovery']) {
            expect(hits[key] ?? 0, key).toBeGreaterThan(0);
        }
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
        // (re-pinned M4q: InvadeUnwillingColonizationTargets draws Rnd.NextDouble in each game-start Empire.DoTasks)
        expect(summary.digest).toBe('fc77d2b53feed820');
    }, 600000);
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
