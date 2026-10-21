// The Reclaimer biofuel depots (threats/giantworks/beaconDepot.ts): counts by galaxy size, placement round the cores and on conquests, the stock split and
// the share that burns with a depot, the no-depot storage rule, rebuilding, the response fleets' view, the Knowledge page and the save round trip.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { CreateGameOptions, Game } from '../src/sim/game';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import type { Habitat } from '../src/sim/types';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { comboOverlayFs, createScenarioGame } from './helpers/scenarioGame';
import { GAME_DAY_LENGTH, registerScenarioEvent, scenarioEmit } from '../src/sim/scenario/hooks';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { takeOwnershipOfColonyFull } from '../src/sim/combat/ownership';
import type { GreatWorkSite } from '../src/sim/scenario/threats/giantworks/types';
import { beaconComplete, beaconRolled } from '../src/sim/scenario/threats/giantworks/beacon';
import { SYSTEM_RADIUS, peekBeaconState, type BeaconState } from '../src/sim/scenario/threats/giantworks/beaconState';
import { designFor, spawnShip, startWar } from '../src/sim/scenario/threats/giantworks/beaconFleet';
import { coresOf, designateCore, fuelOf } from '../src/sim/scenario/threats/giantworks/beaconHarvest';
import { D, depotCap, depotCountFor, depotPass, depotShare, depotSummary, depotThreats, depotsDestroyedBy, depotsKnownTo, liveDepots, perCore } from '../src/sim/scenario/threats/giantworks/beaconDepot';
import { foundryCountFor } from '../src/sim/scenario/threats/giantworks/beaconFoundry';
import { empireMessages } from '../src/sim/messages';
import { coalitionMembers, coalitionPass } from '../src/sim/scenario/threats/giantworks/beaconAi';
import { registerScenarioQuery } from '../src/sim/scenario/hooks';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { rebuildIndexes } from '../src/sim/indexRebuild';
import { knowledgeView } from '../src/ui/knowledgeView';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });
const ids = ['threat-framework', 'giantworks'];
const DAY = GAME_DAY_LENGTH;

interface World {
    g: Galaxy;
    st: BeaconState;
    game: Game;
    gameData: GameData;
    me: Empire;
    f: Empire;
    held: Habitat[];
}

function world(): World {
    const { game, gameData } = createScenarioGame(base, { scenario: comboOverlayFs(ids), flags: {}, options: age3 });
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
    beaconRolled(g, site);
    site.progress = 1;
    site.stage = 4;
    site.completeDate = galaxyStarDate(g);
    beaconComplete(g, site);
    const st = peekBeaconState(g)!;
    startWar(g, st);
    g.scenario!.params.beaconFundingModel = 1;
    const f = st.faction!;
    const ordinary = g.empires.filter((x): x is Empire => x !== null && x !== g.independentEmpire && x !== f && x.pirateEmpireBaseHabitat === null && x.active);
    const victim = ordinary.find((x) => x !== g.playerEmpire && x.colonies.length >= 5)!;
    const held = victim.colonies.filter((c) => c !== victim.capital && c.population.totalAmount > 0).slice(0, 4);
    for (const c of held) takeOwnershipOfColonyFull(g, victim, c, f, false, false);
    return { g, st, game, gameData, me: g.playerEmpire!, f, held };
}

/** Passes spaced `step` days apart for `n` passes. */
function run(g: Galaxy, n: number, step = 2): void {
    for (let i = 0; i < n; i++) {
        g.nowMs += step * DAY;
        depotPass(g);
    }
}

/** Core at held[0] and passes until its depots stand (conquest rolls off). */
function withDepots(w: World): number {
    w.g.scenario!.params.beaconDepotConquestOdds = 1e9;
    designateCore(w.g, w.st, w.held[0]);
    const want = perCore(w.g);
    run(w.g, want * 9 + 2, D.buildDays(w.g) / 7);
    return want;
}

describe('the Reclaimer biofuel depots', () => {
    it('the cap scales with the galaxy: 10 up to 250 stars, 20 at 1,000, 40 at 4,000 (linear, cap 40): twice the foundries', () => {
        expect([0, 100, 250].map(depotCountFor)).toEqual([10, 10, 10]);
        expect(depotCountFor(625)).toBe(16);
        expect(depotCountFor(1000)).toBe(20);
        expect(depotCountFor(2500)).toBe(30);
        expect(depotCountFor(4000)).toBe(40);
        expect(depotCountFor(9000)).toBe(40);
        let last = 0;
        for (let n = 0; n <= 5000; n += 50) {
            expect(depotCountFor(n)).toBe(Math.min(40, 2 * foundryCountFor(n)));
            expect(depotCountFor(n)).toBeGreaterThanOrEqual(last);
            last = depotCountFor(n);
        }
    });

    it('a core calls for its depots in its own system: visible bases with a light guard, one every build interval, never above the cap', () => {
        const w = world();
        const { g, st } = w;
        const want = withDepots(w);
        const live = liveDepots(st);
        expect(live.length).toBe(want);
        expect(live.length).toBeLessThanOrEqual(depotCap(g));
        for (const d of live) {
            expect(d.base!.cloaked).not.toBe(true);
            expect(d.host).toBe(w.held[0]);
            expect(Math.hypot(d.x - w.held[0].xpos, d.y - w.held[0].ypos)).toBeLessThan(SYSTEM_RADIUS * 0.4);
            expect(d.guard.length).toBe(D.guardShips(g));
        }
        expect(st.depots!.armed).toBe(true);
        // the passes after that build nothing more
        run(g, 40, 15);
        expect(liveDepots(st).length).toBe(want);
        // a cap of 3 holds even with more cores
        g.scenario!.params.beaconDepotCount = 3;
        designateCore(g, st, w.held[1]);
        run(g, 40, 15);
        expect(liveDepots(st).length).toBeLessThanOrEqual(Math.max(3, want));
        expect(coresOf(st).length).toBe(2);
    }, 600000);

    it('they come one per build interval, not all at once', () => {
        const w = world();
        w.g.scenario!.params.beaconDepotConquestOdds = 1e9;
        designateCore(w.g, w.st, w.held[0]);
        run(w.g, 1);
        expect(liveDepots(w.st).length).toBe(1);
        run(w.g, 2, 1);
        expect(liveDepots(w.st).length).toBe(1);
        run(w.g, 1, D.buildDays(w.g));
        expect(liveDepots(w.st).length).toBe(2);
    }, 600000);

    it('about one conquest in six (the odds param) that is not a core gets a depot at that world', () => {
        const w = world();
        const { g, st } = w;
        g.scenario!.params.beaconDepotConquestOdds = 1; // every one
        run(g, 40, D.buildDays(g));
        const hosts = liveDepots(st).map((d) => d.host);
        for (const h of w.held) expect(hosts).toContain(h);
        // odds that never come up: none
        const w2 = world();
        w2.g.scenario!.params.beaconDepotConquestOdds = 1e9;
        run(w2.g, 40, D.buildDays(w2.g));
        expect(liveDepots(w2.st).length).toBe(0);
    }, 600000);

    it('the fleet biofuel is split equally; a destroyed depot takes exactly its share of the current stock', () => {
        const w = world();
        const { g, st, me } = w;
        const want = withDepots(w);
        expect(want).toBeGreaterThanOrEqual(3);
        const fuel = fuelOf(st);
        fuel.fleet = 1200;
        const n = liveDepots(st).length;
        expect(depotShare(st)).toBeCloseTo(1200 / n, 9);
        const heard: { id: number; burned: number }[] = [];
        registerScenarioEvent({ id: 'test.depotDestroyed', flag: 'gwBeacon', event: 'depotDestroyed', run: (_g, e) => heard.push({ id: e.depot.id, burned: e.depot.burned }) });
        const d0 = liveDepots(st)[0];
        d0.base!.hasBeenDestroyed = true;
        scenarioEmit(g, 'builtObjectKilledBy', { builtObject: d0.base!, destroyer: me });
        expect(fuel.fleet).toBeCloseTo(1200 * (1 - 1 / n), 9);
        expect(d0.status).toBe('destroyed');
        expect(d0.burned).toBeCloseTo(1 / n, 9);
        expect(heard).toEqual([{ id: d0.id, burned: d0.burned }]);
        expect(depotsDestroyedBy(g, me)).toBe(1);
        // the next one takes its share of what is left
        const stock = fuel.fleet;
        const d1 = liveDepots(st)[0];
        d1.base!.hasBeenDestroyed = true;
        depotPass(g); // (a base that fell to no empire: no credit)
        expect(fuel.fleet).toBeCloseTo(stock * (1 - 1 / (n - 1)), 9);
        expect(depotsDestroyedBy(g, me)).toBe(1);
        expect(heard).toHaveLength(2);
        // the player was told (the destroyer)
        expect(empireMessages(me).some((m) => m.scenarioPopup === 'quiet')).toBe(true);
        expect(depotSummary(g, st).stats.destroyed).toBe(2);
    }, 600000);

    it('with no depot alive new biofuel cannot be stored: it waits for the fleet passes, then the rest is lost; before the first depot nothing is lost', () => {
        const w = world();
        const { g, st } = w;
        const fuel = fuelOf(st);
        // before the first depot: the stock is kept as it always was
        fuel.fleet = 800;
        run(g, 20, 5);
        expect(fuel.fleet).toBe(800);
        withDepots(w);
        fuel.fleet = 600;
        for (const d of liveDepots(st)) d.base!.hasBeenDestroyed = true;
        depotPass(g);
        expect(liveDepots(st).length).toBe(0);
        expect(fuel.fleet).toBe(0); // the last depot took all of it
        // a month's income arrives: kept for the passes of the next few days, then lost
        fuel.fleet += 500;
        fuel.income += 500;
        run(g, 1, 2);
        expect(fuel.fleet).toBe(500);
        // (spent at once in the pass: the fleet passes take some of it)
        fuel.fleet -= 200;
        run(g, 1, 2);
        expect(fuel.fleet).toBe(300);
        run(g, 1, D.settleDays(g));
        expect(fuel.fleet).toBe(0);
        expect(st.depots!.stats.unstoredLost).toBe(300);
        // no depot: still none, and nothing is stored later either (a raised one stores again)
        fuel.fleet += 100;
        fuel.income += 100;
        run(g, 4, D.settleDays(g));
        expect(fuel.fleet).toBe(0);
    }, 600000);

    it('destroyed depots are rebuilt slowly from biofuel, one per rebuild interval, never above the cap', () => {
        const w = world();
        const { g, st } = w;
        const want = withDepots(w);
        const fuel = fuelOf(st);
        fuel.fleet = 1e12;
        const dead = liveDepots(st)[0];
        dead.base!.hasBeenDestroyed = true;
        depotPass(g);
        expect(liveDepots(st).length).toBe(want - 1);
        const stock = fuel.fleet;
        run(g, 1, 2);
        expect(liveDepots(st).length).toBe(want - 1); // too soon
        run(g, 1, D.rebuildDays(g) + 1);
        expect(liveDepots(st).length).toBe(want);
        expect(fuel.fleet).toBeLessThan(stock);
        expect(st.depots!.stats.rebuilt).toBe(1);
        // no fuel to pay with: it waits; fuel that comes in pays for it by degrees
        const second = liveDepots(st)[0];
        second.base!.hasBeenDestroyed = true;
        depotPass(g);
        fuel.fleet = 0;
        run(g, 1, D.rebuildDays(g) + 1);
        expect(liveDepots(st).length).toBe(want - 1);
        fuel.fleet = 1;
        run(g, 1, 2);
        expect(liveDepots(st).length).toBe(want - 1);
        expect(st.depots!.rebuildFund).toBeGreaterThan(0);
        fuel.fleet = 1e12;
        run(g, 1, 2);
        expect(liveDepots(st).length).toBe(want);
        expect(st.depots!.rebuildFund).toBe(0);
        const third = liveDepots(st)[0];
        third.base!.hasBeenDestroyed = true;
        depotPass(g);
        // the cap holds: with the cap at the standing number a replacement is not made
        fuel.fleet = 1e12;
        g.scenario!.params.beaconDepotCount = want - 1;
        run(g, 3, D.rebuildDays(g) + 1);
        expect(liveDepots(st).length).toBe(want - 1);
    }, 600000);

    it('a depot in danger is its host world in danger for the response fleets; guards join the reserve when it falls', () => {
        const w = world();
        const { g, st, me } = w;
        withDepots(w);
        const d = liveDepots(st)[0];
        // (the world's old owner has warships about: whatever is there already is the baseline)
        const enemyAt = (): number => depotThreats(g, st).filter((t) => t.world === w.held[0]).reduce((s, t) => s + t.enemy, 0);
        const before = enemyAt();
        const ship = spawnShip(g, me, designFor(g, me, BuiltObjectSubRole.Destroyer)!, d.x + 3000, d.y);
        expect(enemyAt()).toBeGreaterThan(before);
        expect(depotThreats(g, st).every((t) => t.world.empire === st.faction)).toBe(true);
        ship.hasBeenDestroyed = true;
        const guards = [...d.guard];
        expect(guards.length).toBeGreaterThan(0);
        d.base!.hasBeenDestroyed = true;
        depotPass(g);
        for (const b of guards) expect(st.reserve).toContain(b);
    }, 600000);

    it('the viewer knows the depots it has seen: the Knowledge page lists them (click to centre), a destroyed one stays with what burned', () => {
        const w = world();
        const { g, st, me } = w;
        withDepots(w);
        const d = liveDepots(st)[0];
        // out of sight: not known
        d.seenBy = [];
        expect(depotsKnownTo(st, me)).toHaveLength(0);
        expect(knowledgeView(g, me).sections.some((s) => s.id === 'depots')).toBe(false);
        d.seenBy.push(me.empireId);
        expect(depotsKnownTo(st, me)).toEqual([d]);
        const sec = knowledgeView(g, me).sections.find((s) => s.id === 'depots')!;
        expect(sec.rows).toHaveLength(1);
        expect(sec.rows[0].goTo).toBe(d.base);
        const base = d.base!;
        base.hasBeenDestroyed = true;
        scenarioEmit(g, 'builtObjectKilledBy', { builtObject: base, destroyer: me });
        const after = knowledgeView(g, me).sections.find((s) => s.id === 'depots')!;
        expect(after.rows[0].goTo).toBeNull();
        expect(after.rows[0].point).toEqual({ x: d.x, y: d.y });
    }, 600000);

    it('the state survives a save round trip (depots, shares, queue, counters)', () => {
        const w = world();
        const { g, st, game, gameData, me } = w;
        withDepots(w);
        fuelOf(st).fleet = 900;
        const d0 = liveDepots(st)[0];
        d0.seenBy.push(me.empireId);
        d0.base!.hasBeenDestroyed = true;
        scenarioEmit(g, 'builtObjectKilledBy', { builtObject: d0.base!, destroyer: me });
        const time = new GalaxyTime();
        time.bindGalaxy(g);
        const { game: lgame } = deserializeGame(serializeGame(game, time, {} as StartGameOptions), gameData);
        const lg = lgame.galaxy;
        const ls = peekBeaconState(lg)!;
        const ds = st.depots!;
        const lds = ls.depots!;
        expect(lds.list.map((x) => [x.id, x.x, x.y, x.status, x.burned, x.seenBy, x.destroyedBy])).toEqual(ds.list.map((x) => [x.id, x.x, x.y, x.status, x.burned, x.seenBy, x.destroyedBy]));
        expect(lds.list[0].base).toBeNull();
        expect(lds.list[1].base!.hasBeenDestroyed).toBe(false);
        expect(lds.list[1].host).not.toBeNull();
        expect(lds.armed).toBe(true);
        expect(lds.toRebuild).toBe(ds.toRebuild);
        expect(lds.stats).toEqual(ds.stats);
        expect(lds.destroyedBy).toEqual(ds.destroyedBy);
        expect(liveDepots(ls).length).toBe(liveDepots(st).length);
        expect(fuelOf(ls).fleet).toBeCloseTo(fuelOf(st).fleet, 6);
        expect(depotsDestroyedBy(lg, lg.playerEmpire!)).toBe(1);
    }, 600000);

    it('the AI coalition strikes a depot it can see, and only with a force that beats it by the ratio', () => {
        const w = world();
        const { g, st } = w;
        withDepots(w);
        const d = liveDepots(st)[0];
        const base = d.base!;
        st.popEliminated = st.popBaseline * 0.2;
        g.scenario!.params.beaconAiSharePct = 100;
        g.scenario!.params.beaconAiRatioPct = 100000;
        g.scenario!.params.beaconAiCoreRatioPct = 100000;
        const ai = coalitionMembers(g, st)[0];
        const war = ai.builtObjects.filter((b) => !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && b.topSpeed > 0 && b.warpSpeed > 0);
        expect(war.length).toBeGreaterThan(0);
        for (const b of war) {
            b.xpos = base.xpos + 4000;
            b.ypos = base.ypos;
        }
        rebuildIndexes(g);
        registerScenarioQuery({ id: 'test.depotSee', flag: 'zzTestSeeDepot', query: 'objectVisibleToAll', run: (_g, v, x) => v || (x.object as unknown) === base });
        g.scenario!.flags.zzTestSeeDepot = true;
        // a hopeless ratio: nothing is sent
        g.scenario!.params.beaconAiDepotRatioPct = 1e9;
        coalitionPass(g);
        expect(st.stats.aiDepot ?? 0).toBe(0);
        // switched off: nothing even with a tiny ratio
        g.scenario!.params.beaconAiDepotRatioPct = 1;
        g.scenario!.params.beaconAiDepotOn = 0;
        coalitionPass(g);
        expect(st.stats.aiDepot ?? 0).toBe(0);
        g.scenario!.params.beaconAiDepotOn = 1;
        coalitionPass(g);
        g.scenario!.flags.zzTestSeeDepot = false;
        expect(st.stats.aiDepot).toBeGreaterThan(0);
        expect(st.stats.aiDepot).toBeLessThanOrEqual(2); // beaconAiDepotMax
        const atDepot = war.some((b) => {
            const m = ((b.shipGroup as { mission?: unknown } | null)?.mission ?? builtObjectMission(b.mission)) as { type: number; targetBuiltObject: unknown } | null;
            return m !== null && m.type === BuiltObjectMissionType.Attack && m.targetBuiltObject === base;
        });
        expect(atDepot).toBe(true);
    }, 600000);
});
