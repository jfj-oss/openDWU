// Blockades strangle the Great Work and blockades shoot (threats/giantworks/blockade.ts, blockadeDaily.ts; blockades/blockadesBite.ts).
// The wonder is a throw-away kind; the founders' blockades are set through the daily tracker or a declared blockade plus ships in orbit.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Habitat } from '../src/sim/types';
import type { BuiltObject } from '../src/sim/builtObject';
import type { CreateGameOptions } from '../src/sim/game';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, CommandAction, builtObjectMission } from '../src/sim/missions/mission';
import { assignMission } from '../src/sim/missions/assign';
import { updateIndexesForMovement, updatePosition } from '../src/sim/movement';
import { setupBlockadeColony, cancelBlockadeColony } from '../src/sim/fleets/blockades';
import { comboOverlayFs, createScenarioGame } from './helpers/scenarioGame';
import { registerGreatWork, unregisterGreatWork, greatWorks, giantworksPeriodic, ordinaryEmpires, type GreatWorkRecord } from '../src/sim/scenario/threats/giantworks/framework';
import { stepWork } from '../src/sim/scenario/threats/giantworks/lifecycle';
import { blockaderOf, blockadeSpeedFactor, controlledFounders } from '../src/sim/scenario/threats/giantworks/blockade';
import { blockadableIndependent, blockadeDaily } from '../src/sim/scenario/threats/giantworks/blockadeDaily';
import { blockadeShoot, blockadesBiteShoot, biteState } from '../src/sim/scenario/blockades/blockadesBite';
import { scenarioQuery } from '../src/sim/scenario/hooks';
import { galaxyStarDate } from '../src/sim/tick/simTime';

let base: GameData;
let extra: Habitat[] = [];
beforeAll(async () => {
    base = await loadGameDataFs();
    registerGreatWork({ id: 'gwbtest', flag: 'gwBTest', weight: 10, hintTags: ['glass-ice'], onComplete: () => undefined, extraSuppliers: () => extra });
}, 120000);
afterAll(() => unregisterGreatWork('gwbtest'));

const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, galaxyAge: 3, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });
const ids = ['threat-framework', 'giantworks', 'blockades-bite'];

function building(flags: Record<string, boolean> = {}): { g: Galaxy; w: GreatWorkRecord } {
    const { game } = createScenarioGame(base, {
        scenario: comboOverlayFs(ids),
        flags: { threatGiantworks: true, blockadesBite: true, gwCasino: false, gwUltramind: false, gwSanctuary: false, gwBeacon: false, gwArk: false, ...flags },
        options: age3,
    });
    const g = game.galaxy;
    extra = [];
    const w = greatWorks(g)[0];
    w.wonder = 'gwbtest';
    w.gatherDate = 0;
    giantworksPeriodic(g);
    expect(w.phase).toBe('building');
    // exactly three founders, so 20% / 40% / 60% are the whole range
    w.suppliers = w.suppliers.slice(0, 3);
    for (const h of g.independentColonies) {
        if (w.suppliers.length >= 3) break;
        if (h.population.totalAmount > 0 && !h.hasBeenDestroyed && !w.suppliers.includes(h)) w.suppliers.push(h);
    }
    w.founders = w.suppliers.slice();
    expect(w.suppliers.length).toBe(3);
    return { g, w };
}

const key = (h: Habitat): string => String(h.habitatIndex);
function setBlockaded(g: Galaxy, h: Habitat, by: Empire): void {
    const st = (g.scenario!.state.giantworks as { blockaded?: Record<string, { by: number; since: number }> });
    (st.blockaded ??= {})[key(h)] = { by: by.empireId, since: galaxyStarDate(g) };
}
function place(g: Galaxy, b: BuiltObject, x: number, y: number): void {
    const ix = Math.trunc(Math.trunc(b.xpos) / 400000);
    const iy = Math.trunc(Math.trunc(b.ypos) / 400000);
    b.parentBuiltObject = null;
    b.parentHabitat = null;
    b.parentOffsetX = -2000000001.0;
    b.parentOffsetY = -2000000001.0;
    b.xpos = x;
    b.ypos = y;
    updateIndexesForMovement(g, b, ix, iy, true);
    updatePosition(g, b);
}
const warship = (e: Empire): BuiltObject => e.builtObjects.find((b) => !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && b.topSpeed > 0 && b.firepowerRaw > 0)!;
/** Moves a pending convoy ship of `w` to the scaffold (it delivers at the next step). Returns the progress one delivered freighter adds. */
function deliverOne(g: Galaxy, w: GreatWorkRecord, origin: Habitat): number {
    for (const k of Object.keys(w.nextDeparture)) w.nextDeparture[k] = 1e18;
    w.nextDeparture[key(origin)] = 0;
    w.convoys = [];
    stepWork(g, w); // spawns the origin's convoy
    const c = w.convoys.find((x) => x.origin === origin)!;
    expect(c).toBeDefined();
    for (const k of Object.keys(w.nextDeparture)) w.nextDeparture[k] = 1e18;
    place(g, c.ships[0], w.base!.xpos, w.base!.ypos);
    const p0 = w.progress;
    stepWork(g, w);
    return w.progress - p0;
}
const ind = (g: Galaxy): Habitat[] => g.independentColonies.filter((h) => h.population.totalAmount > 0 && !h.hasBeenDestroyed);

describe('Giantworks and blockades', () => {
    it('founding worlds the empires control cut the build speed 20% each, at most 60%', () => {
        const { g, w } = building();
        const by = ordinaryEmpires(g)[0];
        expect(blockadeSpeedFactor(g, w)).toBe(1);
        setBlockaded(g, w.suppliers[0], by);
        expect(blockadeSpeedFactor(g, w)).toBeCloseTo(0.8, 6);
        setBlockaded(g, w.suppliers[1], by);
        expect(blockadeSpeedFactor(g, w)).toBeCloseTo(0.6, 6);
        setBlockaded(g, w.suppliers[2], by);
        expect(blockadeSpeedFactor(g, w)).toBeCloseTo(0.4, 6);
        expect(controlledFounders(g, w)).toHaveLength(3);
        // a founder owned by an empire counts the same
        const { g: g2, w: w2 } = building();
        w2.suppliers[0].empire = ordinaryEmpires(g2)[0];
        expect(blockadeSpeedFactor(g2, w2)).toBeCloseTo(0.8, 6);
    }, 600000);

    it('the speed, not the convoy count, is cut: all founders blockaded and one other supplier sending, it builds at 40%', () => {
        const { g, w } = building();
        const by = ordinaryEmpires(g)[0];
        const spare = ind(g).filter((h) => !w.suppliers.includes(h)).slice(0, 1);
        expect(spare).toHaveLength(1);
        const free = deliverOne(g, w, w.suppliers[0]);
        expect(free).toBeCloseTo(w.perShip, 8); // undisturbed: each freighter is worth perShip
        w.progress = 0;
        extra = spare;
        for (const h of w.suppliers) setBlockaded(g, h, by);
        const cut = deliverOne(g, w, spare[0]);
        // 1 of the 3 nominal suppliers sends: each freighter is worth 0.4 x 3/1 as much, so the whole work gains 0.4 x 1/3 x 3 = 40% of the undisturbed rate
        expect(cut / w.perShip).toBeCloseTo(0.4 * 3, 6);
        expect((1 / 3) * (cut / w.perShip)).toBeCloseTo(0.4, 6);
    }, 600000);

    it('a blockaded supplier (founder or extra) sends no convoys; lifted, it sends again', () => {
        const { g, w } = building();
        const by = ordinaryEmpires(g)[0];
        const spare = ind(g).find((h) => !w.suppliers.includes(h))!;
        extra = [spare];
        setBlockaded(g, w.suppliers[0], by);
        setBlockaded(g, spare, by);
        for (const k of Object.keys(w.nextDeparture)) w.nextDeparture[k] = 0;
        w.nextDeparture[key(spare)] = 0;
        stepWork(g, w);
        const origins = new Set(w.convoys.map((c) => c.origin));
        expect(origins.has(w.suppliers[0])).toBe(false);
        expect(origins.has(spare)).toBe(false);
        expect(origins.has(w.suppliers[1])).toBe(true);
        const st = g.scenario!.state.giantworks as { blockaded: Record<string, unknown> };
        delete st.blockaded[key(w.suppliers[0])];
        delete st.blockaded[key(spare)];
        w.convoys = [];
        for (const k of Object.keys(w.nextDeparture)) w.nextDeparture[k] = 0;
        w.nextDeparture[key(spare)] = 0;
        stepWork(g, w);
        const again = new Set(w.convoys.map((c) => c.origin));
        expect(again.has(w.suppliers[0])).toBe(true);
        expect(again.has(spare)).toBe(true);
    }, 600000);

    it('a declared blockade of an independent founder holds while its initiator holds the orbit (two checks), and ends when it does not', () => {
        const { g, w } = building();
        const by = ordinaryEmpires(g)[0];
        const h = w.suppliers[0];
        expect(blockadableIndependent(g, h)).toBe(true);
        expect(scenarioQuery(g, 'blockadeIndependentTarget', false, { habitat: h })).toBe(true);
        expect(setupBlockadeColony(g, by, h)).toBe(true);
        blockadeDaily(g);
        blockadeDaily(g);
        expect(blockaderOf(g, h)).toBeNull(); // nobody holds the orbit yet
        const ship = warship(by);
        place(g, ship, h.xpos + 300, h.ypos);
        blockadeDaily(g);
        expect(blockaderOf(g, h)).toBeNull(); // one check is not enough
        blockadeDaily(g);
        expect(blockaderOf(g, h)).toBe(by);
        expect(blockadeSpeedFactor(g, w)).toBeCloseTo(0.8, 6);
        place(g, ship, h.xpos + 900000, h.ypos);
        blockadeDaily(g);
        expect(blockaderOf(g, h)).toBe(by);
        blockadeDaily(g);
        expect(blockaderOf(g, h)).toBeNull();
        expect(blockadeSpeedFactor(g, w)).toBe(1);
        cancelBlockadeColony(g, by, h);
    }, 600000);

    it('blockaders shoot the Compact\'s convoy freighters (also the free-spawned ones) at a blockaded founder', () => {
        const { g, w } = building();
        const by = ordinaryEmpires(g)[0];
        const h = w.suppliers[0];
        setupBlockadeColony(g, by, h);
        const ship = warship(by);
        place(g, ship, h.xpos + 300, h.ypos);
        blockadeDaily(g);
        blockadeDaily(g);
        expect(blockaderOf(g, h)).toBe(by);
        for (const k of Object.keys(w.nextDeparture)) w.nextDeparture[k] = 1e18;
        w.nextDeparture[key(h)] = 0;
        stepWork(g, w); // blockaded: nothing leaves
        expect(w.convoys.find((c) => c.origin === h)).toBeUndefined();
        // a convoy that was already on its way (the Compact's freighters appear from nothing next to the world)
        const st = g.scenario!.state.giantworks as { blockaded: Record<string, unknown> };
        delete st.blockaded[key(h)];
        stepWork(g, w);
        const c = w.convoys.find((x) => x.origin === h)!;
        expect(c).toBeDefined();
        setBlockaded(g, h, by);
        for (const f of c.ships) place(g, f, h.xpos + 700, h.ypos + 100);
        place(g, ship, h.xpos + 300, h.ypos);
        blockadesBiteShoot(g);
        const m = builtObjectMission(ship.mission)!;
        expect(m.type).toBe(BuiltObjectMissionType.Attack);
        expect([...c.ships, ...c.escorts]).toContain(m.targetBuiltObject);
        expect(biteState(g).stats.shots).toBeGreaterThan(0);
    }, 600000);

    it('blockaders attack ships of the owner arriving at or leaving a blockaded colony (unarmed ones at peace), and keep a Blockade mission', () => {
        const { g } = building();
        const [a, b] = ordinaryEmpires(g);
        const h = b.colonies.find((c) => c !== b.capital)!;
        const victim = b.builtObjects.find((o) => !o.hasBeenDestroyed && o.role !== BuiltObjectRole.Base && o.topSpeed > 0 && !(o.firepowerRaw > 0))!;
        expect(victim).toBeDefined();
        place(g, victim, h.xpos + 1500, h.ypos);
        const s1 = warship(a);
        place(g, s1, h.xpos + 200, h.ypos);
        expect(blockadeShoot(g, a, h, [victim], 2)).toBe(1);
        expect(builtObjectMission(s1.mission)!.type).toBe(BuiltObjectMissionType.Attack);
        // a ship on a Blockade mission of the colony gets an Attack command on top, its mission stays
        const s2 = a.builtObjects.find((o) => o !== s1 && !o.hasBeenDestroyed && o.role === BuiltObjectRole.Military && o.topSpeed > 0 && o.firepowerRaw > 0)!;
        place(g, s2, h.xpos + 250, h.ypos);
        assignMission(g, s2, BuiltObjectMissionType.Blockade, h, null, BuiltObjectMissionPriority.High);
        expect(blockadeShoot(g, a, h, [victim], 2)).toBe(1); // s1 already engages it, s2 is the second shooter
        const m2 = builtObjectMission(s2.mission)!;
        expect(m2.type).toBe(BuiltObjectMissionType.Blockade);
        expect(m2.fastPeekCurrentCommand()!.action).toBe(CommandAction.Attack);
        expect(m2.fastPeekCurrentCommand()!.targetBuiltObject).toBe(victim);
        expect(blockadeShoot(g, a, h, [victim], 2)).toBe(0); // no new orders for a target that has its two shooters
    }, 600000);

    it('gating: with Blockades that bite off nothing here applies', () => {
        const { g, w } = building({ blockadesBite: false });
        const by = ordinaryEmpires(g)[0];
        setBlockaded(g, w.suppliers[0], by);
        expect(blockaderOf(g, w.suppliers[0])).toBeNull();
        expect(blockadeSpeedFactor(g, w)).toBe(1);
        expect(blockadableIndependent(g, w.suppliers[0])).toBe(false);
        expect(scenarioQuery(g, 'blockadeIndependentTarget', false, { habitat: w.suppliers[0] })).toBe(false);
        blockadeDaily(g);
    }, 600000);
});
