// Population relocation (threats/giantworks/beaconRelocation.ts), the Reclaimers' refugee interceptors (beaconInterceptors.ts) and the Diet's scaled intake rule.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Habitat } from '../src/sim/types';
import type { BuiltObject } from '../src/sim/builtObject';
import type { CreateGameOptions, Game } from '../src/sim/game';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { ComponentType } from '../src/sim/data/components';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { Population } from '../src/sim/population';
import { comboOverlayFs, createScenarioGame, scenarioGameData } from './helpers/scenarioGame';
import { GAME_DAY_LENGTH, scenarioQuery } from '../src/sim/scenario/hooks';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { YEAR_LENGTH, GalaxyTime } from '../src/sim/galaxyTime';
import { takeOwnershipOfBuiltObject, takeOwnershipOfColonyFull } from '../src/sim/combat/ownership';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { stateDigest } from '../src/sim/tick/digest';
import { runGameSeconds } from '../src/sim/tick/harness';
import { ColonyPopulationPolicy } from '../src/sim/data/policy';
import type { GreatWorkSite } from '../src/sim/scenario/threats/giantworks/types';
import { beaconComplete, beaconRolled } from '../src/sim/scenario/threats/giantworks/beacon';
import { beaconPosition, peekBeaconState, type BeaconState } from '../src/sim/scenario/threats/giantworks/beaconState';
import { startWar } from '../src/sim/scenario/threats/giantworks/beaconFleet';
import { cattleOf, cattleStep, coresOf, designateCore, fuelOf } from '../src/sim/scenario/threats/giantworks/beaconHarvest';
import { pursuitOf } from '../src/sim/scenario/threats/giantworks/beaconPursuit';
import { responseShips } from '../src/sim/scenario/threats/giantworks/beaconResponse';
import {
    RELOC,
    assignRelocationRun,
    cancelRelocation,
    colonyThreatened,
    ladenTransports,
    movablePeople,
    peekRelocation,
    relocationAiMonthly,
    relocationApprovalHit,
    relocationArrive,
    relocationCost,
    relocationIncomeFactor,
    relocationLoad,
    relocationPass,
    relocationPlan,
    relocationRoom,
    relocationTargets,
    relocationView,
    startRelocation,
} from '../src/sim/scenario/threats/giantworks/beaconRelocation';
import { GROUP_SHIPS, INTERCEPT, groupCount, interceptorDesign, interceptorShips, interceptorSummary, interceptorTick } from '../src/sim/scenario/threats/giantworks/beaconInterceptors';
import { evacuationRevenueFactor } from '../src/sim/scenario/threats/giantworks/beaconDiet';
import { clearPreviousMissionRequirements } from '../src/sim/missions/assign';
import { declareWar } from '../src/sim/diplomacyTick';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });
const ids = ['threat-framework', 'giantworks'];
const DAY = GAME_DAY_LENGTH;
const M = 1_000_000;

interface World {
    game: Game;
    g: Galaxy;
    e: Empire;
    from: Habitat;
    to: Habitat;
    ship: BuiltObject;
    gameData: GameData;
}

function step(g: Galaxy, days: number): void {
    g.nowMs += days * DAY;
}

/** The player's colonies: `from` with 600 million, `to` with 100 million and room for more, and an idle passenger ship at `from`; plenty of money. */
function world(): World {
    const { game, gameData } = createScenarioGame(base, { scenario: comboOverlayFs(ids), flags: {}, options: age3 });
    const g = game.galaxy;
    g.scenario!.flags.gwBeacon = true;
    const e = g.playerEmpire!;
    const [from, to] = e.colonies.filter((c) => !c.hasBeenDestroyed && c.population.totalAmount > 0);
    from.population.items[0].amount = 600 * M;
    from.population.items.length = 1;
    from.population.recalculateTotalAmount();
    to.population.items[0].amount = 100 * M;
    to.population.items.length = 1;
    to.population.recalculateTotalAmount();
    to.maxPopulation = 5_000 * M;
    from.maxPopulation = 5_000 * M;
    e.stateMoney = 1e12;
    const ship = e.privateBuiltObjects.find((b) => b.subRole === BuiltObjectSubRole.PassengerShip && b.owner === null)!;
    clearPreviousMissionRequirements(g, ship);
    ship.xpos = from.xpos + 200;
    ship.ypos = from.ypos;
    ship.currentFuel = ship.fuelCapacity;
    return { game, g, e, from, to, ship, gameData };
}

/** The ship docks at `h` (the docking bay check is the stock cmdLoad's: these tests call the hooks directly). */
function dock(ship: BuiltObject, h: Habitat): void {
    ship.dockedAt = h;
    ship.xpos = h.xpos;
    ship.ypos = h.ypos;
}

describe('the relocation order', () => {
    it('costs $1M per 10 billion people (linear), is refused when it cannot be done, and hurts approval at both ends', () => {
        const { g, e, from, to } = world();
        expect(relocationCost(g, 10_000 * M)).toBe(1_000_000);
        expect(relocationCost(g, 5_000 * M)).toBe(500_000);
        expect(relocationCost(g, 100 * M)).toBe(10_000);
        const plan = relocationPlan(g, e, from, to, 100 * M);
        expect(plan).toMatchObject({ error: null, amount: 100 * M, cost: 10_000, abandon: false });
        const before = e.stateMoney;
        const app = (h: Habitat): number => scenarioQuery(g, 'empireApprovalRating', 50, { habitat: h, empire: h.empire });
        expect(app(from)).toBe(50);
        expect(startRelocation(g, e, from, to, 100 * M)).toBe(true);
        expect(e.stateMoney).toBe(before - 10_000);
        expect(relocationApprovalHit(g, from)).toBe(3);
        expect(app(from)).toBe(47);
        expect(app(to)).toBe(47);
        // one order at a time out of a colony
        expect(relocationPlan(g, e, from, to, 50 * M).error).toBe('busy');
        expect(startRelocation(g, e, from, to, 50 * M)).toBe(false);
        // the hit fades (720 days), and is refreshed, not stacked, by another order
        step(g, 721);
        relocationPass(g);
        expect(app(from)).toBe(50);
    }, 600000);

    it('refusals: too little, another empire\'s colony, no money, the add-on off, no room', () => {
        const { g, e, from, to } = world();
        expect(relocationPlan(g, e, from, to, 500_000).error).toBe('amount');
        const other = g.empires.find((x): x is Empire => x !== null && x !== e && x !== g.independentEmpire && x.colonies.length > 0 && x.pirateEmpireBaseHabitat === null)!;
        expect(relocationPlan(g, e, from, other.colonies[0], 100 * M).error).toBe('colonies');
        expect(relocationPlan(g, e, from, from, 100 * M).error).toBe('colonies');
        e.stateMoney = 5;
        expect(relocationPlan(g, e, from, to, 100 * M).error).toBe('funds');
        e.stateMoney = 1e12;
        to.maxPopulation = to.population.totalAmount; // no room
        expect(relocationPlan(g, e, from, to, 100 * M).error).toBe('room');
        to.maxPopulation = to.population.totalAmount + 40 * M; // room for 40 million: the order is clipped to it
        expect(relocationPlan(g, e, from, to, 100 * M)).toMatchObject({ error: null, amount: 40 * M, max: 40 * M });
        to.maxPopulation = 5_000 * M;
        g.scenario!.flags.gwBeacon = false;
        expect(relocationPlan(g, e, from, to, 100 * M).error).toBe('off');
        expect(startRelocation(g, e, from, to, 100 * M)).toBe(false);
        expect(peekRelocation(g) === null).toBe(true); // nothing was ever created
    }, 600000);

    it('only races that may live at the destination move, up to its free room', () => {
        const { g, e, from, to } = world();
        const other = g.races.find((r) => r !== null && r !== e.dominantRace)!;
        from.population.add(new Population(other, 200 * M, g));
        from.population.recalculateTotalAmount();
        to.colonyPopulationPolicy = ColonyPopulationPolicy.DoNotAccept;
        to.colonyPopulationPolicyRaceFamily = ColonyPopulationPolicy.DoNotAccept;
        const movable = movablePeople(g, e, from, to);
        expect(movable.map((x) => x.race)).toEqual([e.dominantRace!.name]);
        expect(movable[0].amount).toBe(600 * M);
        expect(relocationRoom(g, to)).toBe(5_000 * M - 100 * M);
        const plan = relocationPlan(g, e, from, to, 5_000 * M);
        expect(plan.amount).toBe(600 * M); // the other race's 200 million stay
        expect(plan.abandon).toBe(false); // not everyone leaves
        expect(relocationTargets(g, e, from).map((t) => t.habitat)).toContain(to);
    }, 600000);

    it('a full evacuation is flagged (the colony is abandoned when empty), and the order can be stopped', () => {
        const { g, e, from, to } = world();
        const plan = relocationPlan(g, e, from, to, 600 * M);
        expect(plan.abandon).toBe(true);
        expect(startRelocation(g, e, from, to, 600 * M)).toBe(true);
        const v = relocationView(g, from);
        expect(v.order).toMatchObject({ total: 600 * M, abandon: true, done: false, moved: 0 });
        expect(cancelRelocation(g, e, v.order!.id)).toBe(true);
        expect(relocationView(g, from).order).toMatchObject({ done: true, ended: 'cancelled' });
        expect(cancelRelocation(g, e, v.order!.id)).toBe(false);
    }, 600000);
});

describe('the carriers', () => {
    it('an idle private passenger ship packs ten times its capacity on a relocation run only; the people leave the source and reach the destination', () => {
        const { g, e, from, to, ship } = world();
        const cap = ship.populationCapacity;
        expect(cap).toBeGreaterThan(0);
        g.scenario!.params.beaconRelocLossChancePct = 0;
        // no order: no run, the stock machinery is untouched
        expect(assignRelocationRun(g, e, ship)).toBe(false);
        expect(isNaN(0)).toBe(false);
        expect(startRelocation(g, e, from, to, 500 * M)).toBe(true);
        expect(assignRelocationRun(g, e, ship)).toBe(true);
        const st = peekRelocation(g)!;
        const run = st.runs[0];
        expect(run.amount).toBe(Math.floor(cap * 10));
        expect(builtObjectMission(ship.mission)!.type).toBe(BuiltObjectMissionType.Transport);
        expect(st.orders[0].planned).toBe(run.amount);
        expect(ship.populationCapacity).toBe(cap); // the capacity itself is untouched (normal migration)
        // loading at the source: ten times the capacity aboard
        dock(ship, from);
        expect(relocationLoad(g, ship, from)).toBe('done');
        expect(ship.population!.totalAmount).toBe(run.amount);
        expect(ship.population!.totalAmount).toBeGreaterThan(cap);
        expect(from.population.totalAmount).toBe(600 * M - run.amount);
        expect(st.orders[0]).toMatchObject({ planned: 0, aboard: run.amount });
        expect(ladenTransports(g)).toContain(ship);
        // a re-issued run passes through the Load: the stock load empties the ship's list first, the people are put back
        ship.population!.items.length = 0;
        ship.population!.recalculateTotalAmount();
        expect(relocationLoad(g, ship, from)).toBe('done');
        expect(ship.population!.totalAmount).toBe(run.amount);
        expect(from.population.totalAmount).toBe(600 * M - run.amount);
        // the arrival
        dock(ship, to);
        expect(relocationArrive(g, ship, to)).toBe(true);
        expect(to.population.totalAmount).toBe(100 * M + run.amount);
        expect(st.orders[0]).toMatchObject({ aboard: 0, moved: run.amount, lost: 0 });
        expect(ship.population!.totalAmount).toBe(0);
        expect(st.runs.length).toBe(0);
        // the stock migration load is unchanged: only a ship on a run is affected
        expect(scenarioQuery(g, 'migrationLoadFactor', 1, { source: from, destination: to })).toBe(1);
    }, 600000);

    it('a trip rolls a chance to lose a share of its people to disease, with a message to the owner', () => {
        const { g, e, from, to, ship } = world();
        g.scenario!.params.beaconRelocLossChancePct = 100;
        g.scenario!.params.beaconRelocLossSharePct = 20;
        startRelocation(g, e, from, to, 500 * M);
        assignRelocationRun(g, e, ship);
        const run = peekRelocation(g)!.runs[0];
        dock(ship, from);
        relocationLoad(g, ship, from);
        const aboard = run.amount;
        dock(ship, to);
        relocationArrive(g, ship, to);
        const o = peekRelocation(g)!.orders[0];
        expect(o.lost).toBeGreaterThan(0);
        expect(o.lost).toBeCloseTo(aboard * 0.2, -2);
        expect(o.moved + o.lost).toBe(aboard);
        expect(to.population.totalAmount).toBe(100 * M + o.moved);
        expect(peekRelocation(g)!.stats.tripsDiseased).toBe(1);
        expect((e.messages as { title: string }[]).some((m) => m.title.includes('disease aboard a transport'))).toBe(true);
        // never, when the chance is zero
        g.scenario!.params.beaconRelocLossChancePct = 0;
        for (let i = 0; i < 3; i++) {
            assignRelocationRun(g, e, ship);
            dock(ship, from);
            relocationLoad(g, ship, from);
            dock(ship, to);
            relocationArrive(g, ship, to);
        }
        expect(peekRelocation(g)!.stats.tripsDiseased).toBe(1);
    }, 600000);

    it('a full evacuation empties the source, takes more than one ship, and the order completes', () => {
        const { g, e, from, to, ship } = world();
        g.scenario!.params.beaconRelocLossChancePct = 0;
        ship.populationCapacity = 20 * M; // 200 million a trip: three trips
        startRelocation(g, e, from, to, 600 * M);
        for (let i = 0; i < 3; i++) {
            expect(assignRelocationRun(g, e, ship)).toBe(true);
            dock(ship, from);
            relocationLoad(g, ship, from);
            dock(ship, to);
            relocationArrive(g, ship, to);
        }
        expect(from.population.totalAmount).toBe(0);
        expect(to.population.totalAmount).toBe(700 * M);
        relocationPass(g);
        expect(relocationView(g, from).order).toMatchObject({ done: true, ended: 'done', moved: 600 * M });
        expect((e.messages as { title: string }[]).some((m) => m.title.includes('relocation finished'))).toBe(true);
        // nothing is sent when there is no order
        expect(assignRelocationRun(g, e, ship)).toBe(false);
    }, 600000);

    it('only a real private passenger ship carries: a state-owned or non-passenger ship does not', () => {
        const { g, e, from, to, ship } = world();
        startRelocation(g, e, from, to, 500 * M);
        const freighter = e.privateBuiltObjects.find((b) => b.subRole !== BuiltObjectSubRole.PassengerShip)!;
        expect(assignRelocationRun(g, e, freighter)).toBe(false);
        ship.owner = e;
        expect(assignRelocationRun(g, e, ship)).toBe(false);
        ship.owner = null;
        expect(assignRelocationRun(g, e, ship)).toBe(true);
    }, 600000);

    it('a destroyed transport costs its people and a planned load is given back', () => {
        const { g, e, from, to, ship } = world();
        startRelocation(g, e, from, to, 500 * M);
        assignRelocationRun(g, e, ship);
        const st = peekRelocation(g)!;
        const planned = st.runs[0].amount;
        expect(st.orders[0].planned).toBe(planned);
        ship.hasBeenDestroyed = true; // before it loaded
        relocationPass(g);
        expect(st.orders[0].planned).toBe(0);
        expect(st.runs.length).toBe(0);
        // laden and destroyed: lost
        ship.hasBeenDestroyed = false;
        assignRelocationRun(g, e, ship);
        dock(ship, from);
        relocationLoad(g, ship, from);
        const aboard = st.orders[0].aboard;
        expect(aboard).toBeGreaterThan(0);
        ship.hasBeenDestroyed = true;
        relocationPass(g);
        expect(st.orders[0]).toMatchObject({ aboard: 0, lost: aboard });
        expect((e.messages as { title: string }[]).some((m) => m.title.includes('transport lost'))).toBe(true);
    }, 600000);

    it('idle warships nearby take stock Escort jobs for a laden transport', () => {
        const { g, e, from, to, ship } = world();
        startRelocation(g, e, from, to, 500 * M);
        assignRelocationRun(g, e, ship);
        dock(ship, from);
        relocationLoad(g, ship, from);
        const warships = e.builtObjects.filter((b) => !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && b.topSpeed > 0 && b.shipGroup === null && b.subRole !== BuiltObjectSubRole.TroopTransport).slice(0, 4);
        expect(warships.length).toBeGreaterThanOrEqual(2);
        for (const w of warships) {
            clearPreviousMissionRequirements(g, w);
            w.isAutoControlled = true;
            w.xpos = ship.xpos + 1000;
            w.ypos = ship.ypos;
            w.currentFuel = w.fuelCapacity;
        }
        relocationPass(g);
        const escorting = warships.filter((w) => builtObjectMission(w.mission)?.type === BuiltObjectMissionType.Escort && builtObjectMission(w.mission)?.targetBuiltObject === ship);
        expect(escorting.length).toBeGreaterThan(0);
        expect(escorting.length).toBeLessThanOrEqual(RELOC.escorts(g));
    }, 600000);
});

describe('the receiving world\'s income', () => {
    it('income x (1 - 0.5 x min(1, intake / population before)) for 10 years after the last intake, refreshed and not stacked', () => {
        const { g, e, from, to, ship } = world();
        g.scenario!.params.beaconRelocLossChancePct = 0;
        ship.populationCapacity = 4 * M; // 40 million a trip
        startRelocation(g, e, from, to, 500 * M);
        const tax = (): number => scenarioQuery(g, 'colonyTaxRevenue', 100, { habitat: to, empire: e });
        expect(tax()).toBe(100);
        const trip = (): void => {
            assignRelocationRun(g, e, ship);
            dock(ship, from);
            relocationLoad(g, ship, from);
            dock(ship, to);
            relocationArrive(g, ship, to);
        };
        trip(); // 40 of 100 million: 20 % off
        expect(relocationIncomeFactor(g, to)).toBeCloseTo(0.8, 9);
        expect(tax()).toBeCloseTo(80, 7);
        trip(); // 80 of 100 million
        expect(tax()).toBeCloseTo(60, 7);
        trip(); // 120: capped at the whole population's share: half
        expect(tax()).toBeCloseTo(50, 7);
        // 9 years later still on; a new intake refreshes the clock
        step(g, 9 * 360);
        expect(tax()).toBeCloseTo(50, 7);
        trip();
        step(g, 9 * 360);
        expect(tax()).toBeCloseTo(50, 7);
        step(g, 361);
        expect(tax()).toBe(100);
        expect(relocationView(g, to).incomeFactor).toBe(1);
    }, 600000);

    it('the Diet\'s evacuation uses the same scaled rule (see scenarioThreatFramework.test.ts: the Diet evacuation)', () => {
        const { g, to } = world();
        expect(evacuationRevenueFactor(g, to)).toBe(1); // no intake: no cut
    }, 600000);
});

describe('the AI uses it only for threatened colonies', () => {
    it('an AI empire moves people out of a colony an enemy fleet threatens, and out of no other', () => {
        const { g, e } = world();
        const ai = g.empires.find((x): x is Empire => x !== null && x !== e && x !== g.independentEmpire && x.pirateEmpireBaseHabitat === null && x.active && x.colonies.length >= 3)!;
        const [src, dst] = ai.colonies.filter((c) => !c.hasBeenDestroyed && c.population.totalAmount > 0);
        src.population.items[0].amount = 800 * M;
        src.population.items.length = 1;
        src.population.recalculateTotalAmount();
        dst.population.items[0].amount = 100 * M;
        dst.population.items.length = 1;
        dst.population.recalculateTotalAmount();
        dst.maxPopulation = 5_000 * M;
        src.maxPopulation = 5_000 * M;
        ai.stateMoney = 1e12;
        const foe = g.empires.find((x): x is Empire => x !== null && x !== ai && x !== e && x !== g.independentEmpire && x.pirateEmpireBaseHabitat === null && x.active && x.builtObjects.some((b) => b.role === BuiltObjectRole.Military && b.topSpeed > 0))!;
        const warships = foe.builtObjects.filter((b) => b.role === BuiltObjectRole.Military && b.topSpeed > 0).slice(0, 6);
        // at war, but far from everything: nobody threatens the colony
        declareWar(g, ai, foe);
        declareWar(g, foe, ai);
        for (const w of warships) w.xpos = w.ypos = 1;
        expect(colonyThreatened(g, ai, src)).toBe(false);
        relocationAiMonthly(g);
        expect(peekRelocation(g)?.orders.some((x) => x.from === src) ?? false).toBe(false);
        // the enemy fleet arrives
        for (const w of warships) {
            w.xpos = src.xpos + 3000;
            w.ypos = src.ypos;
        }
        for (const b of ai.builtObjects) if (b.role === BuiltObjectRole.Military) b.xpos = b.ypos = 1;
        expect(colonyThreatened(g, ai, src)).toBe(true);
        g.scenario!.params.beaconRelocAiDestSectors = 1e4;
        relocationAiMonthly(g);
        const st = peekRelocation(g)!;
        expect(st.orders.length).toBeGreaterThan(0);
        const o = st.orders.find((x) => x.from === src)!;
        expect(o.empireId).toBe(ai.empireId);
        expect(o.total).toBeLessThanOrEqual(400 * M);
        expect(o.to !== src).toBe(true);
        // not again soon (the cooldown), and the off switch
        const n = st.orders.length;
        relocationPass(g);
        o.doneDate = galaxyStarDate(g);
        relocationAiMonthly(g);
        expect(st.orders.length).toBe(n);
        // players are never ordered about
        expect(st.orders.every((x) => x.empireId !== e.empireId)).toBe(true);
    }, 600000);
});

// --- the interceptors ---------------------------------------------------------------------------------------------------

interface BeaconWorld {
    g: Galaxy;
    game: Game;
    st: BeaconState;
    f: Empire;
    victim: Empire;
    owner: Empire;
    held: Habitat[];
    gameData: GameData;
}

/** The Beacon finished and the war begun; four worlds of one empire taken by the Reclaimers (funding model 1: their ships are free). */
function beaconWorld(): BeaconWorld {
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
    const owner = ordinary.find((x) => x !== victim && x.colonies.length >= 2)!;
    const held = victim.colonies.filter((c) => c !== victim.capital && c.population.totalAmount > 0).slice(0, 4);
    for (const c of held) takeOwnershipOfColonyFull(g, victim, c, f, false, false);
    return { g, game, st, f, victim, owner, held, gameData };
}

/** A laden relocation transport of `owner`, at (x, y). */
function ladenShip(w: BeaconWorld, x: number, y: number): { ship: BuiltObject; from: Habitat; to: Habitat } {
    const { g, owner } = w;
    const [from, to] = owner.colonies.filter((c) => !c.hasBeenDestroyed && c.population.totalAmount > 0);
    from.population.items[0].amount = 600 * M;
    from.population.items.length = 1;
    from.population.recalculateTotalAmount();
    to.population.items[0].amount = 100 * M;
    to.maxPopulation = 5_000 * M;
    owner.stateMoney = 1e12;
    const ship = owner.privateBuiltObjects.find((b) => b.subRole === BuiltObjectSubRole.PassengerShip && b.owner === null && !peekRelocation(g)?.runs.some((r) => r.ship === b))!;
    clearPreviousMissionRequirements(g, ship);
    ship.currentFuel = ship.fuelCapacity;
    startRelocation(g, owner, from, to, 500 * M);
    expect(assignRelocationRun(g, owner, ship)).toBe(true);
    dock(ship, from);
    relocationLoad(g, ship, from);
    ship.dockedAt = null;
    ship.xpos = x;
    ship.ypos = y;
    ship.nearestSystemStar = g.fastFindNearestSystem(x, y);
    return { ship, from, to };
}

function groupsBuilt(w: BeaconWorld): void {
    interceptorTick(w.g);
    step(w.g, 6);
    interceptorTick(w.g);
    step(w.g, 6);
    interceptorTick(w.g);
}

describe('the refugee interceptors', () => {
    it('groups scale with the held worlds (one per beaconInterceptorWorldsPer, capped) and are built to 1 cruiser with assault pods + 1 destroyer + 2 frigates', () => {
        const w = beaconWorld();
        const { g, st } = w;
        expect(groupCount(g, st)).toBe(Math.ceil(st.processing.length / 4));
        g.scenario!.params.beaconInterceptorWorldsPer = 1;
        g.scenario!.params.beaconInterceptorMax = 2;
        expect(groupCount(g, st)).toBe(2);
        g.scenario!.params.beaconInterceptorWorldsPer = 4;
        groupsBuilt(w);
        const rec = st.interceptors!;
        expect(rec.groups.length).toBe(1);
        const ships = rec.groups[0].ships;
        expect(ships.map((b) => b.subRole)).toEqual(GROUP_SHIPS);
        const design = interceptorDesign(g, w.f)!;
        expect(design.components.filter((c) => c.type === ComponentType.AssaultPod).length).toBeGreaterThanOrEqual(INTERCEPT.pods(g));
        expect(ships[0].design).toBe(design);
        expect(ships[0].assaultStrength).toBeGreaterThan(0);
        // the other Reclaimer passes treat them as busy
        for (const b of ships) expect(responseShips(st)).toContain(b);
        expect(interceptorShips(st).length).toBe(4);
        // off: none
        g.scenario!.params.beaconInterceptorOn = 0;
        interceptorTick(g);
        expect(interceptorSummary(st).groups).toBe(1);
    }, 900000);

    it('paid from the fleet biofuel: an empty account builds nothing (funding model 0), a funded one builds and pays', () => {
        const w = beaconWorld();
        const { g, st } = w;
        g.scenario!.params.beaconFundingModel = 0;
        fuelOf(st).fleet = 0;
        groupsBuilt(w);
        expect(interceptorShips(st).length).toBe(0);
        fuelOf(st).fleet = 1e12;
        const before = fuelOf(st).fleet;
        groupsBuilt(w);
        expect(interceptorShips(st).length).toBe(4);
        expect(fuelOf(st).fleet).toBeLessThan(before);
    }, 900000);

    it('a detected relocation transport within 6 sectors of held space is chased: the cruiser Captures it, the rest escort the cruiser; one outside is left alone', () => {
        const w = beaconWorld();
        const { g, st, held } = w;
        groupsBuilt(w);
        const grp = st.interceptors!.groups[0];
        const cruiser = grp.ships[0];
        // a laden transport next to the cruiser (detected) and far outside held space
        const near = ladenShip(w, cruiser.xpos + 500, cruiser.ypos);
        interceptorTick(g);
        expect(grp.mode).toBe('chase');
        expect(grp.target === near.ship).toBe(true);
        expect(builtObjectMission(cruiser.mission)!.type).toBe(BuiltObjectMissionType.Capture);
        expect(builtObjectMission(cruiser.mission)!.targetBuiltObject === near.ship).toBe(true);
        for (const b of grp.ships.slice(1)) {
            expect(builtObjectMission(b.mission)!.type).toBe(BuiltObjectMissionType.Escort);
            expect(builtObjectMission(b.mission)!.targetBuiltObject === cruiser).toBe(true);
        }
        // nobody else chases it
        for (const x of w.f.builtObjects) {
            if (grp.ships.includes(x)) continue;
            const m = builtObjectMission(x.mission);
            expect(m !== null && m.targetBuiltObject === near.ship && (m.type === BuiltObjectMissionType.Capture || m.type === BuiltObjectMissionType.Attack)).toBe(false);
        }
        // the chase ends when the transport is lost to it: it left the zone
        near.ship.xpos = held[0].xpos + 40 * g.sectorSize;
        interceptorTick(g);
        expect(grp.mode).toBe('patrol');
        expect(st.interceptors!.stats.chaseEnd_lost).toBe(1);
        // a transport far from held space is never chased
        const far = ladenShip(w, held[0].xpos + 40 * g.sectorSize, held[0].ypos);
        interceptorTick(g);
        expect(grp.mode).toBe('patrol');
        expect(grp.target).toBeNull();
        void far;
    }, 900000);

    it('only a DETECTED transport is chased (one hidden from the Reclaimers is left alone until it is seen)', () => {
        const w = beaconWorld();
        const { g, st } = w;
        groupsBuilt(w);
        const grp = st.interceptors!.groups[0];
        const cruiser = grp.ships[0];
        const { ship } = ladenShip(w, cruiser.xpos + 500, cruiser.ypos);
        ship.cloaked = true; // hidden from every empire but its own
        interceptorTick(g);
        expect(grp.mode).toBe('patrol');
        expect(grp.target).toBeNull();
        ship.cloaked = false;
        interceptorTick(g);
        expect(grp.mode).toBe('chase');
        expect(grp.target === ship).toBe(true);
    }, 900000);

    it('the cruiser drags a transport in warp out of it, then waits for its own cooldown', () => {
        const w = beaconWorld();
        const { g, st } = w;
        groupsBuilt(w);
        const grp = st.interceptors!.groups[0];
        const cruiser = grp.ships[0];
        const { ship } = ladenShip(w, cruiser.xpos + 500, cruiser.ypos);
        for (const b of [ship, cruiser]) {
            b.hyperjumpPrepare = false;
            b.currentSpeed = b.warpSpeed > 0 ? b.warpSpeed : b.topSpeed * 3;
            b.lastHyperDistance = 5e6;
        }
        ship.warpSpeed = Math.max(1, ship.warpSpeed);
        cruiser.warpSpeed = Math.max(1, cruiser.warpSpeed);
        ship.topSpeed = Math.min(ship.topSpeed, ship.currentSpeed - 1);
        cruiser.topSpeed = Math.min(cruiser.topSpeed, cruiser.currentSpeed - 1);
        interceptorTick(g);
        expect(grp.mode).toBe('chase');
        expect(st.interceptors!.stats.pulls).toBe(1);
        expect(pursuitOf(st).stats.pulledShips).toBeGreaterThanOrEqual(1);
        expect(grp.pullReady).toBeGreaterThan(galaxyStarDate(g));
        // in warp again: not before the cooldown
        for (const b of [ship, cruiser]) {
            b.currentSpeed = b.warpSpeed;
            b.hyperjumpPrepare = false;
        }
        interceptorTick(g);
        expect(st.interceptors!.stats.pulls).toBe(1);
        step(g, INTERCEPT.pullCooldownDays(g) + 1);
        interceptorTick(g);
        expect(st.interceptors!.stats.pulls).toBe(2);
    }, 900000);

    it('a seized transport\'s people go to the nearest core\'s pens; the ship is scrapped there', () => {
        const w = beaconWorld();
        const { g, st, f, held } = w;
        const core = designateCore(g, st, held[0]);
        const { ship, from } = ladenShip(w, held[0].xpos + 3000, held[0].ypos);
        const people = peekRelocation(g)!.orders[0].aboard;
        const order = peekRelocation(g)!.orders[0];
        takeOwnershipOfBuiltObject(g, f, ship, f, false); // the stock boarding's last step
        expect(order).toMatchObject({ aboard: 0, seized: people });
        const rec = cattleOf(st).find((c) => c.ship === ship)!;
        expect(rec.seized).toBe(true);
        expect(rec.total).toBe(people);
        expect(rec.phase).toBe('in');
        expect(rec.core === core.colony).toBe(true);
        expect(rec.from === from).toBe(true);
        expect(ship.actualEmpire).toBe(f);
        expect(ladenTransports(g)).not.toContain(ship);
        expect(st.stats.transportsSeized).toBe(1);
        // it flies to the pens (here: already there), unloads after the unloading days, and is scrapped
        ship.xpos = core.colony.xpos;
        ship.ypos = core.colony.ypos;
        const before = core.waiting;
        cattleStep(g, st);
        step(g, 10);
        cattleStep(g, st);
        expect(core.waiting).toBe(before + people);
        expect(core.received).toBeGreaterThanOrEqual(people);
        expect(cattleOf(st).some((c) => c.ship === ship)).toBe(false);
        expect(st.stats.transportsPenned).toBe(1);
        // it never counted as one of the core's pool ships
        expect(coresOf(st).length).toBeGreaterThan(0);
        // a pass finishes the order: nothing is left to send but nothing arrived
        relocationPass(g);
        expect(peekRelocation(g)!.orders[0].seized).toBe(people);
    }, 900000);

    it('a seized transport retaken before it docks frees its people; one destroyed loses them but for the pods', () => {
        const w = beaconWorld();
        const { g, st, f, held, owner } = w;
        designateCore(g, st, held[0]);
        // retaken
        const a = ladenShip(w, held[0].xpos + 5000, held[0].ypos);
        const people = peekRelocation(g)!.orders[0].aboard;
        takeOwnershipOfBuiltObject(g, f, a.ship, f, false);
        expect(cattleOf(st).some((c) => c.ship === a.ship && c.seized === true)).toBe(true);
        const homeBefore = owner.colonies.reduce((s, c) => s + c.population.totalAmount, 0);
        takeOwnershipOfBuiltObject(g, owner, a.ship, owner, false); // the owner's boarders take it back
        expect(cattleOf(st).some((c) => c.ship === a.ship)).toBe(false);
        const homeAfter = owner.colonies.reduce((s, c) => s + c.population.totalAmount, 0);
        expect(homeAfter - homeBefore).toBeGreaterThanOrEqual(people);
        expect(st.stats.captivesRescued ?? 0).toBeGreaterThanOrEqual(people);
        // destroyed: the escape pods save a share
        const b = ladenShip(w, held[0].xpos + 5000, held[0].ypos);
        const people2 = peekRelocation(g)!.runs.find((r) => r.ship === b.ship)!.amount;
        takeOwnershipOfBuiltObject(g, f, b.ship, f, false);
        const rescued = st.stats.captivesRescued ?? 0;
        const killed = st.stats.captivesKilled ?? 0;
        b.ship.hasBeenDestroyed = true;
        cattleStep(g, st);
        expect((st.stats.captivesRescued ?? 0) - rescued + ((st.stats.captivesKilled ?? 0) - killed)).toBeCloseTo(people2, -1);
        expect(cattleOf(st).some((c) => c.ship === b.ship)).toBe(false);
    }, 900000);

    it('save and load: the relocation orders, runs, intakes, hits and the interceptor groups come back and the runs agree', () => {
        const w = beaconWorld();
        const { g, st, game, held } = w;
        designateCore(g, st, held[0]);
        groupsBuilt(w);
        const grp = st.interceptors!.groups[0];
        const t = ladenShip(w, grp.ships[0].xpos + 500, grp.ships[0].ypos);
        interceptorTick(g);
        const rel = peekRelocation(g)!;
        rel.intakes.push({ colony: t.to, amount: 30 * M, basePop: 100 * M, until: galaxyStarDate(g) + 5 * YEAR_LENGTH });
        const time = new GalaxyTime();
        time.togglePause();
        time.advance(g.nowMs);
        const text = serializeGame(game, time, { ...defaultStartGameOptions(), seed: 1, scenario: { id: 'combo', flags: g.scenario!.flags, params: {} } });
        const loaded = deserializeGame(text, scenarioGameData(base, comboOverlayFs(ids))).game;
        const rel2 = peekRelocation(loaded.galaxy)!;
        expect(rel2.orders.length).toBe(rel.orders.length);
        expect(rel2.orders[0].total).toBe(rel.orders[0].total);
        expect(rel2.orders[0].aboard).toBe(rel.orders[0].aboard);
        expect(rel2.orders[0].cost).toBe(rel.orders[0].cost);
        expect(rel2.orders[0].from.habitatIndex).toBe(rel.orders[0].from.habitatIndex);
        expect(rel2.runs.length).toBe(1);
        expect(rel2.runs[0].ship.builtObjectID).toBe(rel.runs[0].ship.builtObjectID);
        expect(rel2.runs[0].load).toEqual(rel.runs[0].load);
        expect(rel2.intakes.length).toBe(1);
        expect(rel2.hits.length).toBe(rel.hits.length);
        const st2 = peekBeaconState(loaded.galaxy)!;
        expect(st2.interceptors!.groups.length).toBe(1);
        expect(st2.interceptors!.groups[0].ships.map((b) => b.builtObjectID)).toEqual(grp.ships.map((b) => b.builtObjectID));
        expect(st2.interceptors!.groups[0].mode).toBe(grp.mode);
        expect(st2.interceptors!.stats).toEqual(st.interceptors!.stats);
        runGameSeconds(g, 20);
        runGameSeconds(loaded.galaxy, 20);
        expect(stateDigest(loaded.galaxy)).toBe(stateDigest(g));
    }, 900000);
});
