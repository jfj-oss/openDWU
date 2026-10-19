// The Reclaimers' response fleets and patrols (threats/giantworks/beaconResponse.ts) and the Game Editor's finished Beacon.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Habitat } from '../src/sim/types';
import type { CreateGameOptions, Game } from '../src/sim/game';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { comboOverlayFs, createScenarioGame } from './helpers/scenarioGame';
import { GAME_DAY_LENGTH } from '../src/sim/scenario/hooks';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { takeOwnershipOfColonyFull } from '../src/sim/combat/ownership';
import { spawnableThreats, spawnThreatNow } from '../src/sim/scenario/threats/framework';
import type { GreatWorkSite } from '../src/sim/scenario/threats/giantworks/types';
import { BEACON_FINISHED_SPAWN, beaconComplete, beaconRolled } from '../src/sim/scenario/threats/giantworks/beacon';
import { beaconPosition, isBeamCountdown, peekBeaconState, type BeaconState } from '../src/sim/scenario/threats/giantworks/beaconState';
import { beginSeason, seasonBudget, startWar } from '../src/sim/scenario/threats/giantworks/beaconFleet';
import { driveResponse, fleetCounts, patrolRoute, responseOf, responseShips, responseSummary } from '../src/sim/scenario/threats/giantworks/beaconResponse';
import { greatWorks } from '../src/sim/scenario/threats/giantworks/framework';
import { liveCores } from '../src/sim/scenario/threats/giantworks/beaconHarvest';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });
const ids = ['threat-framework', 'giantworks'];
const DAY = GAME_DAY_LENGTH;

function beaconGame(): { g: Galaxy; site: GreatWorkSite; game: Game } {
    const { game } = createScenarioGame(base, { scenario: comboOverlayFs(ids), flags: {}, options: age3 });
    const g = game.galaxy;
    g.scenario!.flags.gwBeacon = true;
    let best = null as (typeof g.systems)[number] | null;
    let bd = Infinity;
    for (const sys of g.systems) {
        const s = sys?.systemStar;
        if (!s || sys.habitats.some((h) => h.empire !== null) || g.checkEmpireTerritoryIdAtLocation(s.xpos, s.ypos) >= 0) continue;
        const d = g.calculateDistance(s.xpos, s.ypos, g.sizeX / 2, g.sizeY / 2);
        if (d < bd) {
            bd = d;
            best = sys;
        }
    }
    const site: GreatWorkSite = { id: 0, system: best!, habitat: null, base: null, progress: 0, stage: 0, wonder: 'beacon', founders: [], startDate: galaxyStarDate(g), completeDate: null, destroyedBy: null };
    return { g, site, game };
}

/** The Beacon finished and the war begun, no season yet; the Reclaimers' funding free (model 1) and the banks of the response full. */
function completed(): { g: Galaxy; st: BeaconState; f: Empire; victim: Empire; held: Habitat[] } {
    const { g, site } = beaconGame();
    beaconRolled(g, site);
    site.progress = 1;
    site.stage = 4;
    site.completeDate = galaxyStarDate(g);
    beaconComplete(g, site);
    const st = peekBeaconState(g)!;
    startWar(g, st);
    st.season = null;
    st.seasons = [];
    st.stats.seasons = 1;
    g.scenario!.params.beaconFundingModel = 1;
    const f = st.faction!;
    const victim = g.empires.find((e): e is Empire => e !== null && e !== g.independentEmpire && e !== f && e.pirateEmpireBaseHabitat === null && e.active && e !== g.playerEmpire)!;
    const held = victim.colonies.filter((c) => c !== victim.capital && c.population.totalAmount > 0).slice(0, 4);
    for (const c of held) takeOwnershipOfColonyFull(g, victim, c, f, false, false);
    return { g, st, f, victim, held };
}

const enemyShips = (g: Galaxy, e: Empire): import('../src/sim/builtObject').BuiltObject[] => e.builtObjects.filter((o) => !o.hasBeenDestroyed && o.role === BuiltObjectRole.Military && o.topSpeed > 0);
/** Every ordinary empire's warships far from everything (the victims' own ships sit at the worlds that were taken from them). */
const clearEnemies = (g: Galaxy, f: Empire): void => {
    for (const e of g.empires) if (e !== null && e !== f && e !== g.independentEmpire) for (const b of enemyShips(g, e)) b.xpos = b.ypos = 1;
};
const settle = (g: Galaxy, st: BeaconState, ships: readonly import('../src/sim/builtObject').BuiltObject[], at: Habitat): void => {
    for (const b of ships) {
        b.xpos = at.xpos + 500;
        b.ypos = at.ypos;
    }
    void st;
};

describe('the Reclaimers\' response fleets and patrols', () => {
    it('funding: a share of each season\'s budget goes to the response banks, the strike groups get the rest', () => {
        const { g, st } = completed();
        const full = seasonBudget(g, st, 1);
        expect(beginSeason(g, st, 1)).toBe(true);
        const rs = responseOf(st);
        const r = rs.reserveAllow;
        const pa = rs.patrolAllow;
        expect(r).toBeCloseTo((full * 12) / 100, 3);
        expect(pa).toBeCloseTo((full * 6) / 100, 3);
        expect(st.season!.budget).toBeCloseTo(full - r - pa, 3);
        // switched off, the strike groups keep it all
        const b = completed();
        b.g.scenario!.params.beaconResponseOn = 0;
        expect(beginSeason(b.g, b.st, 1)).toBe(true);
        expect(b.st.season!.budget).toBeCloseTo(seasonBudget(b.g, b.st, 1), 3);
        expect(responseOf(b.st).reserveAllow).toBe(0);
    }, 600000);

    it('fleet counts scale with the held worlds (a reserve per beaconResponseWorldsPer, at least one; patrols from three worlds)', () => {
        const { g, st, held } = completed();
        expect(held.length).toBeGreaterThanOrEqual(3);
        expect(fleetCounts(g, st).reserves).toBe(1);
        expect(fleetCounts(g, st).patrols).toBeGreaterThanOrEqual(1);
        g.scenario!.params.beaconResponseWorldsPer = 2;
        expect(fleetCounts(g, st).reserves).toBe(Math.ceil(st.processing.length / 2));
    }, 600000);

    it('a reserve is built from its bank, paid, and waits at its post (Patrol)', () => {
        const { g, st, f } = completed();
        const rs = responseOf(st);
        rs.reserveAllow = 1e9;
        rs.patrolAllow = 1e9;
        clearEnemies(g, f);
        driveResponse(g, st, galaxyStarDate(g));
        const reserve = rs.fleets.find((x) => x.kind === 'reserve')!;
        expect(reserve.ships.length).toBeGreaterThan(0);
        expect(reserve.post).not.toBeNull();
        for (const b of reserve.ships) {
            expect(b.actualEmpire).toBe(f);
            const m = builtObjectMission(b.mission);
            expect(m?.type).toBe(BuiltObjectMissionType.Patrol);
            expect(m?.targetHabitat).toBe(reserve.post);
        }
        expect(responseShips(st).length).toBe(rs.fleets.reduce((s, x) => s + x.ships.length, 0));
        expect(rs.reserveAllow).toBeLessThan(1e9);
        expect(responseSummary(st).stats.built).toBeGreaterThan(0);
    }, 600000);

    it('a threatened held world draws the nearest strong-enough reserve, which returns to its post when it is calm; a hopeless fight is refused', () => {
        const { g, st, victim, held } = completed();
        const rs = responseOf(st);
        rs.reserveAllow = 1e9;
        rs.patrolAllow = 0;
        g.scenario!.params.beaconPatrolMax = 0;
        let now = galaxyStarDate(g);
        clearEnemies(g, st.faction!);
        driveResponse(g, st, now);
        const reserve = rs.fleets.find((x) => x.kind === 'reserve')!;
        const world = held[0];
        // far from every enemy warship: nothing happens
        for (const b of enemyShips(g, victim)) b.xpos = b.ypos = 1;
        driveResponse(g, st, now);
        expect(reserve.mode).toBe('post');
        // one enemy warship at the world (the reserve outweighs it): the reserve goes
        const enemy = enemyShips(g, victim)[0];
        settle(g, st, [enemy], world);
        now += 5 * DAY;
        g.nowMs += 5 * DAY;
        driveResponse(g, st, galaxyStarDate(g));
        expect(reserve.mode).toBe('respond');
        expect(reserve.target).toBe(world);
        for (const b of reserve.ships) expect(builtObjectMission(b.mission)?.targetHabitat).toBe(world);
        expect(responseSummary(st).stats.respDispatches).toBe(1);
        // still there after the calm days: it stays while the threat stays
        g.nowMs += 20 * DAY;
        driveResponse(g, st, galaxyStarDate(g));
        expect(reserve.mode).toBe('respond');
        // the enemy leaves: after the calm days it returns to its post
        enemy.xpos = enemy.ypos = 1;
        g.nowMs += 1 * DAY;
        driveResponse(g, st, galaxyStarDate(g));
        expect(reserve.mode).toBe('respond');
        g.nowMs += 11 * DAY;
        driveResponse(g, st, galaxyStarDate(g));
        expect(reserve.mode).toBe('return');
        expect(responseSummary(st).stats.respCleared).toBe(1);
        for (const b of reserve.ships) expect(builtObjectMission(b.mission)?.targetHabitat).toBe(reserve.post);
        const post = reserve.post!;
        for (const b of reserve.ships) {
            b.xpos = post.xpos;
            b.ypos = post.ypos;
        }
        g.nowMs += 5 * DAY;
        driveResponse(g, st, galaxyStarDate(g));
        expect(reserve.mode).toBe('post');
        expect(responseSummary(st).stats.returns).toBe(1);
        // a hopeless fight: the reserve is refused, nobody leaves
        g.scenario!.params.beaconResponseRatioPct = 1e7;
        settle(g, st, [enemy], world);
        g.nowMs += 5 * DAY;
        driveResponse(g, st, galaxyStarDate(g));
        expect(reserve.mode).toBe('post');
        expect(responseSummary(st).stats.respRefused).toBe(1);
        expect(responseSummary(st).stats.respDispatches).toBe(1);
    }, 600000);

    it('enemy troops landed on a held world are a threat too', () => {
        const { g, st, victim, held } = completed();
        const rs = responseOf(st);
        rs.reserveAllow = 1e9;
        g.scenario!.params.beaconPatrolMax = 0;
        clearEnemies(g, st.faction!);
        driveResponse(g, st, galaxyStarDate(g));
        const world = held[1];
        world.invadingTroops ??= new (world.troops!.constructor as new () => NonNullable<Habitat['invadingTroops']>)();
        const t = world.troops!.items[0];
        const landed = Object.assign(Object.create(Object.getPrototypeOf(t)), t, { empire: victim, colony: null });
        world.invadingTroops!.add(landed);
        g.nowMs += 5 * DAY;
        driveResponse(g, st, galaxyStarDate(g));
        const reserve = rs.fleets.find((x) => x.kind === 'reserve')!;
        expect(reserve.mode).toBe('respond');
        expect(reserve.target).toBe(world);
    }, 600000);

    it('patrols fly a route of nearby held worlds, a dwell at each; meeting a superior force is reported and answered by a reserve', () => {
        const { g, st, victim, held } = completed();
        g.scenario!.params.beaconPatrolHopSectors = 100000;
        g.scenario!.params.beaconPatrolRouteLen = 3;
        g.scenario!.params.beaconPatrolFleetPct = 1;
        g.scenario!.params.beaconPatrolReportPct = 1; // (a stock warship is a small fraction of a max-tech Reclaimer one)
        const rs = responseOf(st);
        rs.reserveAllow = 1e9;
        rs.patrolAllow = 1e9;
        clearEnemies(g, st.faction!);
        driveResponse(g, st, galaxyStarDate(g));
        const patrol = rs.fleets.find((x) => x.kind === 'patrol')!;
        expect(patrol.ships.length).toBeGreaterThan(0);
        expect(patrol.route.length).toBe(3);
        expect(new Set(patrol.route).size).toBe(3);
        for (const h of patrol.route) expect(held).toContain(h);
        expect(builtObjectMission(patrol.ships[0].mission)?.targetHabitat).toBe(patrol.route[0]);
        // it flies on after its dwell
        const wp0 = patrol.route[0];
        for (const b of patrol.ships) {
            b.xpos = wp0.xpos;
            b.ypos = wp0.ypos;
        }
        g.nowMs += 5 * DAY;
        driveResponse(g, st, galaxyStarDate(g));
        expect(patrol.arrivedAt).toBeGreaterThan(0);
        expect(patrol.leg).toBe(0);
        g.nowMs += 16 * DAY;
        driveResponse(g, st, galaxyStarDate(g));
        expect(patrol.leg).toBe(1);
        expect(builtObjectMission(patrol.ships[0].mission)?.targetHabitat).toBe(patrol.route[1]);
        expect(responseSummary(st).stats.patrolLegs).toBe(1);
        // contact with a force far beyond it: counted once, reported; the reserve answers the nearest held world
        const lead = patrol.ships[0];
        const foes = enemyShips(g, victim).slice(0, 12);
        for (const b of foes) {
            b.xpos = lead.xpos + 3000;
            b.ypos = lead.ypos;
        }
        g.nowMs += 5 * DAY;
        driveResponse(g, st, galaxyStarDate(g));
        const stats = responseSummary(st).stats;
        expect(stats.patrolEncounters).toBe(1);
        expect(stats.patrolReports).toBe(1);
        expect(rs.alerts.length).toBe(1);
        // the reserve (built from its bank) answers the world the patrol reported
        const reserve = rs.fleets.find((x) => x.kind === 'reserve')!;
        expect(reserve.mode).toBe('post');
        // (the patrol alone would outweigh what it met: it is drawn off first, so the reserve is needed)
        for (const b of patrol.ships) b.xpos = b.ypos = 1;
        driveResponse(g, st, galaxyStarDate(g));
        expect(responseSummary(st).stats.patrolEncounters).toBe(1); // the same contact is not counted again
        expect(reserve.mode).toBe('respond');
        expect(reserve.target).toBe(rs.alerts[0].world);
    }, 600000);

    it('patrolRoute: nearest unvisited held world within the hop, no repeats', () => {
        const g = { calculateDistance: (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by) } as unknown as Galaxy;
        const w = (x: number, y: number): Habitat => ({ xpos: x, ypos: y }) as Habitat;
        const [a, b, c, d] = [w(0, 0), w(10, 0), w(25, 0), w(500, 0)];
        expect(patrolRoute(g, [a, b, c, d], a, 4, 30)).toEqual([a, b, c]);
        expect(patrolRoute(g, [a, b, c, d], a, 2, 30)).toEqual([a, b]);
        expect(patrolRoute(g, [a, d], a, 4, 30)).toEqual([a]);
    });
});

describe('Game Editor: Great Work: beacon (finished)', () => {
    it('is listed, and spawns the Beacon complete: the Reclamation begun, the Watchers cloaked and mustering, the first beam ten days off', () => {
        const { g } = beaconGame();
        const entry = spawnableThreats(g).find((t) => t.key === BEACON_FINISHED_SPAWN);
        expect(entry?.label).toBe('Great Work: beacon (finished)');
        expect(entry?.note).toBeNull();
        expect(spawnThreatNow(g, g.playerEmpire, BEACON_FINISHED_SPAWN)).toBe(true);
        const st = peekBeaconState(g)!;
        expect(greatWorks(g).find((w) => w.wonder === 'beacon')?.phase).toBe('complete');
        expect(st.phase).toBe('reclamation');
        expect(st.warStarted).toBe(false);
        expect(isBeamCountdown(st.season!)).toBe(true);
        const left = (st.season!.launchAt ?? st.season!.end) - galaxyStarDate(g);
        expect(left / DAY).toBeCloseTo(10, 0);
        const pos = beaconPosition(st)!;
        expect(st.watchers.length).toBeGreaterThan(0);
        for (const w of st.watchers) {
            expect(w.mode).toBe('muster');
            expect(w.ship!.cloaked).toBe(true);
            expect(g.calculateDistance(w.ship!.xpos, w.ship!.ypos, pos.x, pos.y)).toBeLessThan(100000);
        }
        // one per galaxy: a second spawn is refused
        expect(spawnableThreats(g).find((t) => t.key === BEACON_FINISHED_SPAWN)?.note).not.toBeNull();
        expect(spawnThreatNow(g, g.playerEmpire, BEACON_FINISHED_SPAWN)).toBe(false);
    }, 600000);
});
void liveCores;
