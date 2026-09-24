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
        // reviewPirateMissionsAndAssign, so its marker is pirateCollectIncomeFromControlledColonies.)
        for (const key of ['M4e autoRefuelRepairShip', 'M4q scanForNewOwnerHabitat', 'M4s pirateAssignShipMissions', 'M4s pirateCollectIncomeFromControlledColonies', 'M4l performFleetTasks']) {
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
        expect(summary.digest).toBe('198918104ea2794b');
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
