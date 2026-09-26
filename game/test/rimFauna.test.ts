// Scenario 19g-7 "rim fauna" (tasks/19-mod-layer-scenarios.md §19g item 7): rim-weighted herd density, herd cohesion,
// the migration season, station feeding (drain, extraction block, AI escort priority, docile hook, herd kill), the local
// unrest term, flags-off = faithful game, save round trip mid-migration. Short runs only.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame, scenarioGameData } from './helpers/scenarioGame';
import { cachedTickGameRun } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { radiusFraction, scenarioQuery } from '../src/sim/scenario';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateCounts, stateDigest } from '../src/sim/tick/digest';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { Cargo, ResourceRef } from '../src/sim/cargo';
import { empireApprovalRating } from '../src/sim/taxes';
import { resolvePrioritizedPatrolMiningStations } from '../src/sim/civilianAI';
import { empireMessages } from '../src/sim/messages';
import { HERD_COHESION, herdDensityAt, herdMembers, rimFaunaState, rimFaunaStationUnderPressure, rimFaunaUnrest, rimHerdOfCreature, setRimHerdDocile } from '../src/sim/scenario/rimFauna/common';
import { rimFaunaHerdTick, rimFaunaMigrationSeason, spawnRimHerd, startRimHerdMigration } from '../src/sim/scenario/rimFauna/rimFauna';
import { galaxyStarDate } from '../src/sim/tick/simTime';

let base: GameData;
/** Shared flag-on game: dense rim, migration season pushed to the last day (tests trigger it by hand). */
let shared: Game;
const SHARED_PARAMS = { rimFaunaDensityRim: 1.5, rimFaunaDensityInner: 0.5, rimFaunaMaxHerds: 400, rimFaunaMigrationDay: 359 };

beforeAll(async () => {
    base = await loadGameDataFs();
    shared = createScenarioGame(base, { scenario: 'rim-fauna', params: SHARED_PARAMS }).game;
}, 600000);

function dist(g: Galaxy, a: { xpos: number; ypos: number }, x: number, y: number): number {
    return g.calculateDistance(a.xpos, a.ypos, x, y);
}

describe('19g-7 rim fauna — density', () => {
    it('herd density rises with the radius fraction; no herds inside the inner radius', () => {
        const g = shared.galaxy;
        expect(herdDensityAt(g, 0.2)).toBe(0);
        expect(herdDensityAt(g, 0.5)).toBe(0);
        expect(herdDensityAt(g, 0.75)).toBeCloseTo(0.75);
        expect(herdDensityAt(g, 1.2)).toBe(1.5);
        const st = rimFaunaState(g);
        expect(st.herds.length).toBeGreaterThan(10);
        const perSystem = new Map<number, number>();
        for (const h of st.herds) perSystem.set(h.birthSystemIndex, (perSystem.get(h.birthSystemIndex) ?? 0) + 1);
        const band = (lo: number, hi: number): number => {
            let systems = 0;
            let herds = 0;
            g.systems.forEach((s, i) => {
                const f = radiusFraction(g, s.systemStar.xpos, s.systemStar.ypos);
                if (f < lo || f >= hi) return;
                if (g.systemHabitatsOf(i).some((h) => h.empire !== null && h.empire !== g.independentEmpire)) return;
                systems++;
                herds += perSystem.get(i) ?? 0;
            });
            return systems === 0 ? 0 : herds / systems;
        };
        expect(band(0, 0.5)).toBe(0);
        expect(band(0.85, 5)).toBeGreaterThan(band(0.5, 0.7));
        expect(band(0.85, 5)).toBeGreaterThanOrEqual(1);
        for (const h of st.herds) {
            expect(radiusFraction(g, h.birthX, h.birthY)).toBeGreaterThan(0.5);
            expect(herdMembers(h).length).toBeGreaterThanOrEqual(4);
            expect(herdMembers(h).length).toBeLessThanOrEqual(7);
            for (const c of herdMembers(h)) expect(rimHerdOfCreature(g, c)).toBe(h);
        }
    });
});

describe('19g-7 rim fauna — herds', () => {
    it('followers stay with their leader, the leader in its home range', () => {
        const g = shared.galaxy;
        runGameSeconds(g, 150);
        const st = rimFaunaState(g);
        let followers = 0;
        let close = 0;
        for (const h of st.herds) {
            if (h.leader === null) continue;
            expect(h.migration).toBeNull();
            expect(dist(g, h.leader, h.homeX, h.homeY)).toBeLessThan(h.homeRange + 10000);
            for (const f of h.followers) {
                followers++;
                if (dist(g, f, h.leader.xpos, h.leader.ypos) <= HERD_COHESION * 3) close++;
            }
        }
        expect(followers).toBeGreaterThan(20);
        expect(close / followers).toBeGreaterThan(0.85);
    }, 600000);

    it('the migration season moves herds into rim-adjacent systems', () => {
        const g = shared.galaxy;
        const st = rimFaunaState(g);
        g.scenario!.params.rimFaunaMigrationChance = 1;
        const started = rimFaunaMigrationSeason(g);
        g.scenario!.params.rimFaunaMigrationChance = 0.5;
        expect(started).toBeGreaterThan(0);
        expect(g.empires.some((e) => e !== null && empireMessages(e).some((m) => m.description.includes('creature herds are on the move')))).toBe(true);
        const herd = st.herds.find((h) => h.migration !== null && !h.migration.homeward)!;
        expect(herd).toBeDefined();
        const m = herd.migration!;
        const from = { x: herd.leader!.xpos, y: herd.leader!.ypos };
        const travel = g.calculateDistance(from.x, from.y, m.x, m.y);
        expect(radiusFraction(g, m.x, m.y)).toBeLessThanOrEqual(radiusFraction(g, herd.birthX, herd.birthY) + 0.05);
        runGameSeconds(g, 300);
        expect(herd.migration).toBeNull();
        expect(herd.homeSystemIndex).toBe(m.toSystemIndex);
        expect(herd.homeSystemIndex).not.toBe(herd.birthSystemIndex);
        expect(dist(g, herd.leader!, m.x, m.y)).toBeLessThan(Math.max(10000, travel / 5));
        const withLeader = herd.followers.filter((f) => dist(g, f, herd.leader!.xpos, herd.leader!.ypos) < 20000).length;
        expect(withLeader).toBeGreaterThanOrEqual(Math.ceil(herd.followers.length / 2));
    }, 600000);
});

describe('19g-7 rim fauna — feeding, unrest, AI, kill', () => {
    it('a herd grazing a mining station drains its stock, blocks it, raises unrest and escort priority; killing it stops the loss', () => {
        const g = shared.galaxy;
        const st = rimFaunaState(g);
        const station = g.builtObjects.find(
            (b): b is BuiltObject =>
                b != null && !b.hasBeenDestroyed && (b.subRole === BuiltObjectSubRole.MiningStation || b.subRole === BuiltObjectSubRole.GasMiningStation) && b.parentHabitat !== null && b.empire !== null && b.empire !== g.independentEmpire && b.empire.colonies.length > 0 && b.cargo !== null,
        )!;
        expect(station).toBeDefined();
        const empire = station.empire!;
        const site = station.parentHabitat!;
        const colony = [...empire.colonies].sort((a, b) => dist(g, a, station.xpos, station.ypos) - dist(g, b, station.xpos, station.ypos))[0];
        const approvalBefore = empireApprovalRating(g, colony);
        const unrestBefore = rimFaunaUnrest(g, colony);
        const resId = g.resourceSystem.resources[0].resourceId;
        station.cargo!.add(new Cargo(new ResourceRef(resId), 1000, empire));
        const stock = (): number => station.cargo!.items.filter((c) => c.commodity.resourceId === resId && c.empire === empire).reduce((a, c) => a + c.amount, 0);
        const stock0 = stock();
        expect(scenarioQuery(g, 'extractionBlocked', false, { builtObject: station })).toBe(false);

        const herd = spawnRimHerd(g, site.systemIndex, 3, { x: site.xpos, y: site.ypos })!;
        herd.homeRange = 60000;
        herd.feedSite = site;
        const losses0 = st.stats.stationLosses;
        rimFaunaHerdTick(g);
        expect(herd.feedingStation).toBe(station);
        expect(st.stats.stationLosses).toBeGreaterThanOrEqual(losses0 + 1); // other herds graze real stations too
        expect(stock()).toBe(stock0 - Math.trunc(stock0 * 0.1));
        expect(scenarioQuery(g, 'extractionBlocked', false, { builtObject: station })).toBe(true);
        expect(rimFaunaStationUnderPressure(g, station, galaxyStarDate(g))).toBe(true);
        expect(empireMessages(empire).some((m) => m.description.includes('grazing at'))).toBe(true);

        // Unrest: the local approval term at the owner's nearest colony.
        const unrest = rimFaunaUnrest(g, colony);
        expect(unrest).toBeGreaterThanOrEqual(3);
        expect(approvalBefore - empireApprovalRating(g, colony)).toBeCloseTo(unrest - unrestBefore, 6);

        // AI: the grazed station is on the patrol list with at least the escort floor.
        station.currentEscortForceAssigned = 0;
        const patrol = resolvePrioritizedPatrolMiningStations(g, empire);
        expect(patrol).toContain(station);
        expect(station.sortTag).toBeGreaterThanOrEqual(30);

        // 19j hook: a herd docile to the owner leaves its ships / stations alone.
        setRimHerdDocile(g, herd, empire.empireId, true);
        expect(scenarioQuery(g, 'creatureIgnoresTarget', false, { creature: herd.leader!, target: station })).toBe(true);
        setRimHerdDocile(g, herd, empire.empireId, false);
        expect(scenarioQuery(g, 'creatureIgnoresTarget', false, { creature: herd.leader!, target: station })).toBe(false);

        // Kill the herd: the loss stops, the population shrinks.
        const herds0 = st.herds.length;
        const killed0 = st.stats.herdsKilled;
        for (const c of herdMembers(herd)) {
            c.damageCreature(1e9);
            c.completeTeardown();
        }
        const stock1 = stock();
        rimFaunaHerdTick(g);
        expect(st.herds.length).toBe(herds0 - 1);
        expect(st.stats.herdsKilled).toBe(killed0 + 1);
        expect(scenarioQuery(g, 'extractionBlocked', false, { builtObject: station })).toBe(false);
        rimFaunaHerdTick(g);
        expect(stock()).toBe(stock1);
        expect(empireMessages(empire).some((m) => m.description.includes('wiped out'))).toBe(true);
    }, 600000);
});

function saveText(game: Game, params: Record<string, number>): string {
    const time = new GalaxyTime();
    time.togglePause();
    time.advance(game.galaxy.nowMs);
    return serializeGame(game as never, time, { ...defaultStartGameOptions(), seed: 1, scenario: { id: 'rim-fauna', flags: { rimFauna: true }, params } });
}

describe('19g-7 rim fauna — faithful path, save', () => {
    it('flag off: the same seed-1 game and run as no scenario', () => {
        const ref = cachedTickGameRun(base, { seconds: 60 });
        const game = createScenarioGame(base, { scenario: 'rim-fauna', flags: { rimFauna: false } }).game;
        expect(game.galaxy.scenario).not.toBeNull();
        runGameSeconds(game.galaxy, 60);
        expect('rimFauna' in game.galaxy.scenario!.state).toBe(false);
        expect(stateDigest(game.galaxy)).toBe(stateDigest(ref.game.galaxy));
        expect(stateCounts(game.galaxy)).toEqual(stateCounts(ref.game.galaxy));
        expect(game.galaxy.rnd.drawCount).toBe(ref.game.galaxy.rnd.drawCount);
    }, 600000);

    it('a save taken mid-migration resumes identically', () => {
        const params = { rimFaunaMigrationDay: 359 };
        const a = createScenarioGame(base, { scenario: 'rim-fauna', params }).game;
        runGameSeconds(a.galaxy, 20);
        const st = rimFaunaState(a.galaxy);
        const herd = st.herds[0];
        let far = -1;
        let farD = Number.MAX_VALUE;
        a.galaxy.systems.forEach((s, i) => {
            const d = a.galaxy.calculateDistance(s.systemStar.xpos, s.systemStar.ypos, herd.homeX, herd.homeY);
            if (i !== herd.homeSystemIndex && d > 150000 && d < farD) {
                far = i;
                farD = d;
            }
        });
        expect(far).toBeGreaterThanOrEqual(0);
        startRimHerdMigration(a.galaxy, herd, far, false);
        runGameSeconds(a.galaxy, 15);
        expect(herd.migration).not.toBeNull();
        const text = saveText(a, params);
        const loaded = deserializeGame(text, scenarioGameData(base, 'rim-fauna')).game;
        const lherd = rimFaunaState(loaded.galaxy).herds[0];
        expect(lherd.migration).toEqual(herd.migration);
        expect(rimHerdOfCreature(loaded.galaxy, lherd.leader!)).toBe(lherd);
        expect(loaded.galaxy.creatures).toContain(lherd.leader);
        runGameSeconds(a.galaxy, 180);
        runGameSeconds(loaded.galaxy, 180);
        expect(stateDigest(loaded.galaxy)).toBe(stateDigest(a.galaxy));
        const summary = (g: Galaxy): string => JSON.stringify(rimFaunaState(g).herds.map((h) => [h.id, h.homeSystemIndex, h.migration, h.feedTicks, herdMembers(h).map((c) => c.creatureId)]));
        expect(summary(loaded.galaxy)).toBe(summary(a.galaxy));
        expect(herd.homeSystemIndex).toBe(far);
    }, 600000);
});
