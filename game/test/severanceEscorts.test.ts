// The Severance's escorts (threats/giantworks/megaEscort.ts): one escort group per contributing AI empire for its route, sized to the route's danger and
// the blockade at the structure, taken from its spare warships; released when it stops contributing (or the structure is done); a player's escort on a
// contract freighter stays with it through the contract code; an arrival under an escort is an escorted delivery and adds war credit; save round trip.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { assignMission } from '../src/sim/missions/assign';
import { executeCommands } from '../src/sim/missions/executeCommands';
import type { CreateGameOptions, Game } from '../src/sim/game';
import { comboOverlayFs, createScenarioGame } from './helpers/scenarioGame';
import { GAME_DAY_LENGTH } from '../src/sim/scenario/hooks';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { GalaxyTime } from '../src/sim/galaxyTime';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { rebuildIndexes } from '../src/sim/indexRebuild';
import { isAiControlled, markPlayerOrder } from '../src/sim/missions/playerOrder';
import { maintainShipGroups } from '../src/sim/fleets/shipGroup';
import { autoRefuelRepairShip, checkForRefuelling } from '../src/sim/logistics/refuel';
import { setGameEndHandler, type GameEndEventArgs } from '../src/sim/victory';
import { threatGameEndPolicy } from '../src/sim/scenario/threats/framework';
import { councilState, type Council } from '../src/sim/scenario/emergent/council';
import { dietState } from '../src/sim/scenario/charactersVictory/diet/dietState';
import { beaconRolled } from '../src/sim/scenario/threats/giantworks/beacon';
import { P, peekBeaconState, type BeaconState } from '../src/sim/scenario/threats/giantworks/beaconState';
import { partsOf } from '../src/sim/scenario/threats/giantworks/beaconComponents';
import type { GreatWorkSite } from '../src/sim/scenario/threats/giantworks/framework';
import { MOTION_MEGA, fire, megaStep, peekMega, voidPointNear } from '../src/sim/scenario/threats/giantworks/megaStation';
import { escortAtArrival, escortGroupCount, escortGroupOf, escortHeld, escortsFreight, releaseEscorts, supplyEscorts } from '../src/sim/scenario/threats/giantworks/megaEscort';
import { WC, warCreditActive, warCreditLabel, warCreditOf } from '../src/sim/scenario/threats/giantworks/beaconWarCredit';
import { dietMotionKindDef, type DietMotion } from '../src/sim/scenario/charactersVictory/diet/dietState';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });
const ids = ['threat-framework', 'giantworks', 'characters-victory'];
const DAY = GAME_DAY_LENGTH;

interface Setup {
    game: Game;
    gameData: GameData;
    g: Galaxy;
    st: BeaconState;
    me: Empire;
    ais: Empire[];
}

/** A seed-1 Giantworks game with the Diet on, the Beacon rolled and the player holding the finished blueprint (as megaStation.test.ts). */
function setup(): Setup {
    const { game, gameData } = createScenarioGame(base, { scenario: comboOverlayFs(ids), flags: { charactersVictory: true, cvCouncil: true, galacticCouncil: true }, options: age3 });
    const g = game.galaxy;
    g.scenario!.flags.gwBeacon = true;
    const site = { id: 0, system: g.systems.find((s) => s !== null)!, habitat: null, base: null, progress: 0, stage: 0, wonder: 'beacon', founders: [], startDate: galaxyStarDate(g), completeDate: null, destroyedBy: null } as GreatWorkSite;
    beaconRolled(g, site);
    const st = peekBeaconState(g)!;
    const members = g.empires.filter((e): e is Empire => e !== null && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.active && e !== st.faction);
    const cs = councilState(g);
    const c: Council = { id: cs.nextId++, name: 'Interstellar Diet', foundedYear: 0, members: [...members], chair: null, motion: null, results: [], blocs: [], coLosses: {}, losses: {}, sanctions: [], threats: [], recognised: [], condemned: {}, splitFrom: 0 };
    cs.councils.push(c);
    dietState(g);
    const me = g.playerEmpire!;
    partsOf(st).held[String(me.empireId)] = { blueprint: { since: 1, progress: P.blueprintCost(g), sharePct: 25, done: true } };
    return { game, gameData, g, st, me, ais: members.filter((e) => e !== me) };
}

function motion(g: Galaxy, proposer: Empire, place: { x: number; y: number }): DietMotion {
    return {
        id: 1,
        kind: MOTION_MEGA,
        proposer,
        target: proposer,
        other: null,
        colony: null,
        resourceId: -1,
        place,
        text: 't',
        votes: [],
        status: 'passed',
        yes: 0,
        no: 0,
    } as DietMotion;
}

/** Starts the mega-station as the player (the player is the builder and a contributor). */
function started(s: Setup): NonNullable<ReturnType<typeof peekMega>> {
    const at = voidPointNear(s.g, s.g.sizeX / 2, s.g.sizeY / 2)!;
    const def = dietMotionKindDef(MOTION_MEGA)!;
    def.apply(s.g, dietState(s.g), motion(s.g, s.me, at), (() => undefined) as never);
    return peekMega(s.g)!;
}

const DAYS = (g: Galaxy, days: number, each?: () => void): void => {
    for (let i = 0; i < days; i++) {
        g.nowMs += DAY;
        each?.();
        megaStep(g);
    }
};

function builtMission(b: BuiltObject): string {
    const m = builtObjectMission(b.mission);
    return m === null ? 'none' : BuiltObjectMissionType[m.type];
}

function warOf(a: Empire, b: Empire): void {
    obtainDiplomaticRelation(a, b).type = DiplomaticRelationType.War;
    obtainDiplomaticRelation(b, a).type = DiplomaticRelationType.War;
}

function contributor(s: Setup, e: Empire): void {
    const mega = peekMega(s.g)!;
    if (!mega.contributors.includes(e.empireId)) mega.contributors.push(e.empireId);
}

function warships(e: Empire): BuiltObject[] {
    return e.builtObjects.filter((b) => !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && b.topSpeed > 0 && b.firepowerRaw > 0);
}

/** The colony of `e` nearest the structure (where its freight starts). */
function colonyOf(s: Setup, e: Empire): { x: number; y: number } {
    const b = peekMega(s.g)!.base!;
    let best = e.capital!;
    let bd = Infinity;
    for (const h of e.colonies) {
        if (h === null || h.empire !== e) continue;
        const d = s.g.calculateDistance(h.xpos, h.ypos, b.xpos, b.ypos);
        if (d < bd) {
            bd = d;
            best = h;
        }
    }
    return { x: best.xpos, y: best.ypos };
}

/** The midpoint of `e`'s route to the structure (the route's danger sits there). */
function midOf(s: Setup, e: Empire): { x: number; y: number } {
    const c = colonyOf(s, e);
    const b = peekMega(s.g)!.base!;
    return { x: (c.x + b.xpos) / 2, y: (c.y + b.ypos) / 2 };
}

/** Puts `k` idle private freighters of `e` on their way to the structure, halfway along its route: contracts, as dispatch makes them. */
function fly(s: Setup, e: Empire, k: number): BuiltObject[] {
    const mega = peekMega(s.g)!;
    const at = midOf(s, e);
    const priv = new Set<BuiltObject>(e.privateBuiltObjects);
    const ships = (e.freighters as BuiltObject[]).filter((f) => !f.hasBeenDestroyed && priv.has(f) && f.topSpeed > 0 && f.builtAt == null).slice(0, k);
    const now = galaxyStarDate(s.g);
    ships.forEach((f, i) => {
        f.xpos = Math.round(at.x) + i * 40;
        f.ypos = Math.round(at.y);
        f.currentFuel = f.fuelCapacity;
        assignMission(s.g, f, BuiltObjectMissionType.Move, mega.base!, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
        mega.contracts.push({ empireId: e.empireId, ship: f, sent: now });
    });
    (mega.lastSentBy ??= {})[String(e.empireId)] = now;
    rebuildIndexes(s.g);
    return ships;
}

/** Puts a warship at (x, y), idle. */
function place(b: BuiltObject, x: number, y: number): void {
    b.xpos = Math.round(x);
    b.ypos = Math.round(y);
    builtObjectMission(b.mission)?.clear();
}

/** The galaxy corner farthest from the given points (a warship parked there is clear of the route). */
function farCorner(s: Setup, pts: { x: number; y: number }[]): { x: number; y: number } {
    const g = s.g;
    const corners = [
        { x: 0, y: 0 },
        { x: g.sizeX, y: 0 },
        { x: 0, y: g.sizeY },
        { x: g.sizeX, y: g.sizeY },
    ];
    const clear = (c: { x: number; y: number }): number => Math.min(...pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y)));
    return corners.reduce((best, c) => (clear(c) > clear(best) ? c : best));
}

describe('one escort group per contributing AI empire', () => {
    it('an AI contributor forms one group for its route, not one per freighter; its ships escort the freighter nearest the structure', () => {
        const s = setup();
        const mega = started(s);
        const [ai, raider] = s.ais;
        contributor(s, ai);
        warOf(raider, ai);
        const flying = fly(s, ai, 4);
        expect(flying.length).toBe(4);
        const threat = warships(raider)[0];
        place(threat, midOf(s, ai).x, midOf(s, ai).y);
        rebuildIndexes(s.g);
        DAYS(s.g, 1);
        expect(escortGroupCount(mega)).toBe(1);
        expect(Object.keys(mega.escorts ?? {})).toEqual([String(ai.empireId)]);
        const grp = escortGroupOf(mega, ai)!;
        expect(grp.ships.length).toBeGreaterThan(0);
        expect(grp.ships.length).toBeLessThanOrEqual(P.megaEscortMax(s.g));
        // the freight is far on its route: the group guards the structure, one group for all of them
        const base = mega.base!;
        for (const w of grp.ships) {
            expect(builtMission(w)).toBe('Patrol');
            expect(builtObjectMission(w.mission)!.targetBuiltObject).toBe(base);
        }
        // a freighter comes in: the group takes the one nearest the structure (one at a time), and only that one
        const near = flying[0];
        near.xpos = base.xpos + 20000; // (inside five megaEscortNear, outside the delivery range)
        near.ypos = base.ypos;
        rebuildIndexes(s.g);
        DAYS(s.g, 1);
        expect(escortGroupCount(mega)).toBe(1);
        const targets = new Set(escortGroupOf(mega, ai)!.ships.map((w) => builtObjectMission(w.mission)?.targetBuiltObject));
        expect(targets.size).toBe(1);
        expect([...targets][0]).toBe(near);
        for (const w of escortGroupOf(mega, ai)!.ships) expect(builtMission(w)).toBe('Escort');
    });

    it('a group ship is not folded into a stock fleet: a fleet\'s waypoint and refuel missions would override its escort', () => {
        const s = setup();
        const mega = started(s);
        const [ai, raider] = s.ais;
        contributor(s, ai);
        warOf(raider, ai);
        fly(s, ai, 4);
        place(warships(raider)[0], midOf(s, ai).x, midOf(s, ai).y);
        rebuildIndexes(s.g);
        DAYS(s.g, 1);
        const grp = escortGroupOf(mega, ai)!;
        expect(grp.ships.length).toBeGreaterThan(0);
        // the stock fleet maintenance (run every day by the empire tick) folds idle warships into fleets: the group's ships are left out of it
        maintainShipGroups(s.g, ai);
        for (const w of grp.ships) expect(w.shipGroup).toBeNull();
        DAYS(s.g, 1);
        for (const w of grp.ships) expect(builtMission(w)).toBe('Patrol');
    });

    it('no group when the route is safe, and none when the empire has no spare warship (a raider on the route does not make one)', () => {
        const s = setup();
        const mega = started(s);
        const [ai, raider] = s.ais;
        contributor(s, ai);
        fly(s, ai, 2);
        DAYS(s.g, 1);
        expect(escortGroupCount(mega)).toBe(0); // safe: nobody hostile on the route, no blockade
        warOf(raider, ai);
        place(warships(raider)[0], midOf(s, ai).x, midOf(s, ai).y);
        for (const w of warships(ai)) assignMission(s.g, w, BuiltObjectMissionType.Patrol, ai.capital!, null, BuiltObjectMissionPriority.Normal);
        rebuildIndexes(s.g);
        DAYS(s.g, 1);
        expect(escortGroupCount(mega)).toBe(0); // danger, but every warship is busy at home
    });

    it('the group grows when a blockade appears at the structure, and goes home only after its linger once the danger is gone', () => {
        const s = setup();
        s.g.scenario!.params.megaEscortMax = 10;
        const mega = started(s);
        const [ai, raider] = s.ais;
        contributor(s, ai);
        fly(s, ai, 2);
        warOf(raider, ai);
        const raiders = warships(raider);
        place(raiders[0], midOf(s, ai).x, midOf(s, ai).y);
        rebuildIndexes(s.g);
        DAYS(s.g, 1);
        const before = escortGroupOf(mega, ai)?.ships.length ?? 0;
        expect(before).toBeGreaterThan(0);
        // a blockade: a second raider idle at the structure, at war with the builder too
        warOf(raider, s.me);
        place(raiders[1], mega.base!.xpos, mega.base!.ypos);
        rebuildIndexes(s.g);
        DAYS(s.g, 1);
        const during = escortGroupOf(mega, ai)?.ships.length ?? 0;
        expect(during).toBeGreaterThan(before);
        // the raiders leave; the group stays out its linger, then goes home
        const far = farCorner(s, [midOf(s, ai), { x: mega.base!.xpos, y: mega.base!.ypos }]);
        place(raiders[0], far.x, far.y);
        place(raiders[1], far.x, far.y);
        rebuildIndexes(s.g);
        DAYS(s.g, 10);
        expect(escortGroupOf(mega, ai)?.ships.length).toBe(during);
        DAYS(s.g, P.megaEscortLingerDays(s.g) + 2);
        expect(escortGroupOf(mega, ai)).toBeUndefined();
        expect(escortGroupCount(mega)).toBe(0);
    });

    it('released when the empire stops contributing: its ships go back to stock control at once', () => {
        const s = setup();
        const mega = started(s);
        const [ai, raider] = s.ais;
        contributor(s, ai);
        warOf(raider, ai);
        fly(s, ai, 2);
        place(warships(raider)[0], midOf(s, ai).x, midOf(s, ai).y);
        rebuildIndexes(s.g);
        DAYS(s.g, 1);
        const ships = [...escortGroupOf(mega, ai)!.ships];
        expect(ships.length).toBeGreaterThan(0);
        // it sends nothing more and nothing is on the way: no longer contributing
        mega.contracts = mega.contracts.filter((c) => c.empireId !== ai.empireId);
        mega.lastSentBy = { [String(ai.empireId)]: galaxyStarDate(s.g) - 400 * DAY };
        DAYS(s.g, 1);
        expect(escortGroupOf(mega, ai)).toBeUndefined();
        for (const w of ships) expect(builtMission(w)).not.toBe('Escort');
    });

    it('released when the empire is no longer a contributor, and when the structure fires', () => {
        const keep = threatGameEndPolicy.restrict;
        threatGameEndPolicy.restrict = false;
        try {
            const s = setup();
            setGameEndHandler(s.g, (_e: GameEndEventArgs) => undefined);
            const mega = started(s);
            const [ai, raider] = s.ais;
            contributor(s, ai);
            warOf(raider, ai);
            fly(s, ai, 2);
            place(warships(raider)[0], midOf(s, ai).x, midOf(s, ai).y);
            rebuildIndexes(s.g);
            DAYS(s.g, 1);
            expect(escortGroupCount(mega)).toBe(1);
            mega.contributors = mega.contributors.filter((id) => id !== ai.empireId);
            DAYS(s.g, 1);
            expect(escortGroupCount(mega)).toBe(0);
            // a new group, then the structure is whole
            contributor(s, ai);
            DAYS(s.g, 1);
            expect(escortGroupCount(mega)).toBe(1);
            const ships = [...escortGroupOf(mega, ai)!.ships];
            mega.progress = 1;
            fire(s.g, s.st, mega);
            expect(escortGroupCount(mega)).toBe(0);
            for (const w of ships) expect(builtMission(w)).not.toBe('Escort');
        } finally {
            threatGameEndPolicy.restrict = keep;
        }
    });
});

describe('only freight is held, supplied and credited', () => {
    it('an Escort on a warship parked by the structure (not freight) is not held, supplied or credited', () => {
        const s = setup();
        const mega = started(s);
        const me = s.me;
        const base = mega.base!;
        const [f] = fly(s, me, 1);
        const [w, parked] = warships(me);
        place(parked, base.xpos + 300, base.ypos);
        place(w, base.xpos + 500, base.ypos);
        assignMission(s.g, w, BuiltObjectMissionType.Escort, parked, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
        markPlayerOrder(w);
        rebuildIndexes(s.g);
        expect(escortHeld(s.g, w, parked)).toBe(false);
        expect(escortsFreight(s.g, w)).toBe(false);
        w.currentFuel = 0.01 * w.fuelCapacity;
        supplyEscorts(s.g, mega);
        expect(w.currentFuel).toBeLessThan(w.fuelCapacity);
        // a freighter arriving with it beside it: the parked ship is not an escort of that freighter
        f.xpos = base.xpos;
        f.ypos = base.ypos;
        rebuildIndexes(s.g);
        expect(escortAtArrival(s.g, mega, f)).toBeNull();
    });

    it('an escort of an enemy (at war with the freighter\'s owner) or a pirate gets no credit; a neutral escort on the freighter does', () => {
        const s = setup();
        const mega = started(s);
        const me = s.me;
        const base = mega.base!;
        const [f] = fly(s, me, 1);
        const [neutral, raider] = s.ais;
        const enemyShip = warships(raider)[0];
        const friendly = warships(neutral)[0];
        warOf(raider, me);
        place(enemyShip, base.xpos + 400, base.ypos);
        assignMission(s.g, enemyShip, BuiltObjectMissionType.Escort, f, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
        f.xpos = base.xpos;
        f.ypos = base.ypos;
        rebuildIndexes(s.g);
        expect(escortAtArrival(s.g, mega, f)).toBeNull();
        // the same arrival with a neutral empire's escort on the freighter: credited to that empire
        place(friendly, base.xpos + 600, base.ypos);
        assignMission(s.g, friendly, BuiltObjectMissionType.Escort, f, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
        rebuildIndexes(s.g);
        expect(escortAtArrival(s.g, mega, f)).toBe(neutral);
    });

    it('two real escorts on one delivery give one escorted delivery, not two', () => {
        const s = setup();
        const mega = started(s);
        const me = s.me;
        const base = mega.base!;
        const [f] = fly(s, me, 1);
        const [a, b] = warships(me);
        f.xpos = base.xpos;
        f.ypos = base.ypos;
        for (const w of [a, b]) {
            place(w, base.xpos + 400, base.ypos + 100);
            assignMission(s.g, w, BuiltObjectMissionType.Escort, f, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
        }
        rebuildIndexes(s.g);
        DAYS(s.g, 1);
        expect(mega.contracts.some((c) => c.ship === f)).toBe(false);
        expect(mega.escorted).toBe(1);
    });
});

describe('the exemption follows the groups at once', () => {
    it('a released group\'s ships are not exempt from the stock refuel or fleets at once (the group set is not stale)', () => {
        const s = setup();
        const mega = started(s);
        const [ai, raider] = s.ais;
        contributor(s, ai);
        warOf(raider, ai);
        fly(s, ai, 4);
        place(warships(raider)[0], midOf(s, ai).x, midOf(s, ai).y);
        rebuildIndexes(s.g);
        DAYS(s.g, 1);
        const grp = escortGroupOf(mega, ai)!;
        expect(grp.ships.length).toBeGreaterThan(0);
        for (const w of grp.ships) expect(escortsFreight(s.g, w)).toBe(true);
        releaseEscorts(s.g, mega);
        for (const w of grp.ships) expect(escortsFreight(s.g, w)).toBe(false);
    });
});

describe('the recruits are spare warships at home', () => {
    it('a warship in a stock fleet is not recruited, and a fleet is not broken up for the group', () => {
        const s = setup();
        const mega = started(s);
        const [ai, raider] = s.ais;
        s.g.scenario!.params.megaEscortBase = 50;
        s.g.scenario!.params.megaEscortMax = 60;
        s.g.scenario!.params.megaEscortHomePct = 0;
        contributor(s, ai);
        warOf(raider, ai);
        fly(s, ai, 4);
        place(warships(raider)[0], midOf(s, ai).x, midOf(s, ai).y);
        // the stock fleet maintenance folds the idle warships into fleets
        maintainShipGroups(s.g, ai);
        const fleeted = warships(ai).filter((w) => w.shipGroup !== null);
        expect(fleeted.length).toBeGreaterThan(0);
        // the fleets' ships are the nearest to the route's start: were they spares, they would be recruited first
        const c = colonyOf(s, ai);
        fleeted.forEach((w, i) => {
            w.xpos = Math.round(c.x) + i * 10;
            w.ypos = Math.round(c.y);
        });
        rebuildIndexes(s.g);
        DAYS(s.g, 1);
        const grp = escortGroupOf(mega, ai);
        expect(grp?.ships.length ?? 0).toBeGreaterThan(0);
        for (const w of grp?.ships ?? []) expect(fleeted.includes(w)).toBe(false);
        for (const w of fleeted) expect(w.shipGroup).not.toBeNull();
    });

    it('while at war, a spare warship near a war front stays home', () => {
        const s = setup();
        const mega = started(s);
        const [ai, raider] = s.ais;
        s.g.scenario!.params.megaEscortBase = 50;
        s.g.scenario!.params.megaEscortMax = 60;
        s.g.scenario!.params.megaEscortHomePct = 0; // (every idle spare would be taken, but not one on a front)
        contributor(s, ai);
        warOf(raider, ai);
        fly(s, ai, 4);
        const mid = midOf(s, ai);
        place(warships(raider)[0], mid.x, mid.y);
        // an idle warship of the empire sits on the raider: a war front
        const front = warships(ai)[0];
        place(front, mid.x + 500, mid.y);
        rebuildIndexes(s.g);
        DAYS(s.g, 1);
        const grp = escortGroupOf(mega, ai);
        expect(grp?.ships.length ?? 0).toBeGreaterThan(0);
        expect(grp?.ships.includes(front) ?? false).toBe(false);
    });

    it('the home floor is counted over the idle ships at home, not over all the warships', () => {
        const s = setup();
        const mega = started(s);
        const [ai, raider] = s.ais;
        s.g.scenario!.params.megaEscortBase = 4;
        contributor(s, ai);
        warOf(raider, ai);
        fly(s, ai, 4);
        place(warships(raider)[0], midOf(s, ai).x, midOf(s, ai).y);
        // four warships stay idle at home; the rest are away on missions
        const all = warships(ai);
        for (const w of all.slice(0, 4)) place(w, w.xpos, w.ypos);
        for (const w of all.slice(4)) assignMission(s.g, w, BuiltObjectMissionType.Move, mega.base!, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
        rebuildIndexes(s.g);
        DAYS(s.g, 1);
        // half of the four at home stay home: two recruits at most, though four are wanted
        const n = escortGroupOf(mega, ai)?.ships.length ?? 0;
        expect(n).toBeGreaterThan(0);
        expect(n).toBeLessThanOrEqual(2);
    });
});

describe('a player\'s escort is exempt only as a live guard of the structure', () => {
    /** A player's escort delivers its freighter: it stays on guard at the structure, recorded. */
    function guardedBy(s: Setup): { w: BuiltObject; f: BuiltObject; base: BuiltObject } {
        const mega = peekMega(s.g)!;
        const base = mega.base!;
        const [f] = fly(s, s.me, 1);
        const w = warships(s.me)[0];
        place(w, f.xpos, f.ypos);
        assignMission(s.g, w, BuiltObjectMissionType.Escort, f, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
        markPlayerOrder(w);
        f.xpos = base.xpos;
        f.ypos = base.ypos;
        w.xpos = base.xpos + 500;
        w.ypos = base.ypos;
        rebuildIndexes(s.g);
        DAYS(s.g, 1);
        return { w, f, base };
    }

    it('a player Patrol of the structure that never guarded a delivery gets no exemption, nor a record', () => {
        const s = setup();
        const mega = started(s);
        const base = mega.base!;
        const w = warships(s.me)[0];
        place(w, base.xpos + 500, base.ypos);
        assignMission(s.g, w, BuiltObjectMissionType.Patrol, base, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
        markPlayerOrder(w);
        rebuildIndexes(s.g);
        expect(escortsFreight(s.g, w)).toBe(false);
        expect(mega.guards).toBeUndefined();
    });

    it('a delivery records the escort as a guard; leaving the base area, or a changed order, ends the exemption at once and the record at the next step', () => {
        const s = setup();
        const mega = started(s);
        const { w, base } = guardedBy(s);
        expect(builtMission(w)).toBe('Patrol');
        expect(mega.guards?.length).toBe(1);
        expect(escortsFreight(s.g, w)).toBe(true);
        // far from the structure: the stock's, not the guard's
        w.xpos = base.xpos + 3000000;
        rebuildIndexes(s.g);
        expect(escortsFreight(s.g, w)).toBe(false);
        w.xpos = base.xpos + 500;
        rebuildIndexes(s.g);
        expect(escortsFreight(s.g, w)).toBe(true);
        // the player orders it elsewhere: no longer a guard, and the record goes at the next step
        assignMission(s.g, w, BuiltObjectMissionType.Move, base, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
        markPlayerOrder(w);
        expect(escortsFreight(s.g, w)).toBe(false);
        DAYS(s.g, 1);
        expect(mega.guards).toBeUndefined();
    });

    it('the guard record runs out after megaGuardDays with no new delivery', () => {
        const s = setup();
        const mega = started(s);
        const { w } = guardedBy(s);
        expect(escortsFreight(s.g, w)).toBe(true);
        DAYS(s.g, P.megaGuardDays(s.g) + 1);
        expect(builtMission(w)).toBe('Patrol');
        expect(escortsFreight(s.g, w)).toBe(false);
        expect(mega.guards).toBeUndefined();
    });
});

describe('switching the escorts off', () => {
    it('megaEscortOn switched off mid-game releases every group at the next step: its ships go back to stock control', () => {
        const s = setup();
        const mega = started(s);
        const [ai, raider] = s.ais;
        contributor(s, ai);
        warOf(raider, ai);
        fly(s, ai, 4);
        place(warships(raider)[0], midOf(s, ai).x, midOf(s, ai).y);
        rebuildIndexes(s.g);
        DAYS(s.g, 1);
        expect(escortGroupCount(mega)).toBe(1);
        const grp = escortGroupOf(mega, ai)!;
        expect(grp.ships.length).toBeGreaterThan(0);
        s.g.scenario!.params.megaEscortOn = 0;
        DAYS(s.g, 1);
        expect(escortGroupCount(mega)).toBe(0);
        for (const w of grp.ships) expect(builtMission(w)).toBe('Undefined');
    });
});

describe('the player escorts a contract freighter', () => {
    it('a player escort on a contract freighter stays with it through the contract code; an arrival under it is an escorted delivery', () => {
        const s = setup();
        const mega = started(s);
        const me = s.me;
        const [f] = fly(s, me, 1);
        const w = warships(me)[0];
        place(w, f.xpos, f.ypos);
        assignMission(s.g, w, BuiltObjectMissionType.Escort, f, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
        markPlayerOrder(w); // (as the player's command marks it: executeShipAction)
        rebuildIndexes(s.g);
        DAYS(s.g, 3);
        expect(mega.contracts.some((c) => c.ship === f)).toBe(true);
        expect(builtMission(f)).toBe('Move');
        expect(builtMission(w)).toBe('Escort');
        expect(builtObjectMission(w.mission)!.targetBuiltObject).toBe(f);
        // its fuel runs low on the way: the freight is supplied, so the escort's is kept full (the stock refuel does not pull it off)
        w.currentFuel = 0;
        supplyEscorts(s.g, mega);
        expect(w.currentFuel).toBe(w.fuelCapacity);
        expect(builtMission(w)).toBe('Escort');
        // and the stock refuel leaves it on its freight (the refuelling point is far: its rule would pull the escort off)
        s.me.autoRefuelStateShips = true;
        w.currentFuel = 0.01 * w.fuelCapacity;
        expect(autoRefuelRepairShip(s.g, w, true)).toBe(false);
        w.currentFuel = 0.01 * w.fuelCapacity;
        checkForRefuelling(s.g, w, true); // (an automated escort is sent to refuel by this check, not by autoRefuelRepairShip)
        expect(builtMission(w)).toBe('Escort');
        expect(w.refuelForNextMission).toBeFalsy();
        // it arrives with the escort beside it
        const base = mega.base!;
        f.xpos = base.xpos;
        f.ypos = base.ypos;
        w.xpos = base.xpos + 500;
        w.ypos = base.ypos;
        rebuildIndexes(s.g);
        DAYS(s.g, 1);
        expect(mega.contracts.some((c) => c.ship === f)).toBe(false);
        expect(mega.escorted).toBe(1);
        // its freighter has delivered: the escort stays on guard at the structure, still the player's order (the stock Escort command would end here, and
        // automation would take the ship)
        expect(builtMission(w)).toBe('Patrol');
        expect(builtObjectMission(w.mission)!.targetBuiltObject).toBe(base);
        expect(isAiControlled(w)).toBe(false);
        DAYS(s.g, 2);
        expect(builtMission(w)).toBe('Patrol');
        expect(isAiControlled(w)).toBe(false);
        // on guard it is kept supplied and is not sent to refuel (the refuelling point is far from the structure)
        w.currentFuel = 0.01 * w.fuelCapacity;
        supplyEscorts(s.g, mega);
        expect(w.currentFuel).toBe(w.fuelCapacity);
        w.currentFuel = 0.01 * w.fuelCapacity;
        expect(autoRefuelRepairShip(s.g, w, true)).toBe(false);
        checkForRefuelling(s.g, w, true);
        expect(builtMission(w)).toBe('Patrol');
        expect(w.refuelForNextMission).toBeFalsy();
    });
});

describe('the escort of a freighter that has arrived', () => {
    it('keeps its Escort command when its freighter\'s mission has ended on arrival, before the delivery is counted: the escort is then put on guard', () => {
        const s = setup();
        const mega = started(s);
        const me = s.me;
        const [f] = fly(s, me, 1);
        const w = warships(me)[0];
        place(w, f.xpos, f.ypos);
        assignMission(s.g, w, BuiltObjectMissionType.Escort, f, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
        markPlayerOrder(w);
        rebuildIndexes(s.g);
        // the freighter arrives: its Move ends (the stock arrival), a moment before the daily megaStep counts the delivery
        const base = mega.base!;
        f.xpos = base.xpos;
        f.ypos = base.ypos;
        builtObjectMission(f.mission)?.clear();
        w.xpos = base.xpos + 500;
        w.ypos = base.ypos;
        rebuildIndexes(s.g);
        for (let i = 0; i < 6; i++) executeCommands(s.g, w, 1, 0, galaxyStarDate(s.g)); // (the escort's own ticks)
        expect(builtMission(w)).toBe('Escort');
        expect(builtObjectMission(w.mission)!.targetBuiltObject).toBe(f);
        // the delivery is counted with the escort still beside it, and the escort goes on guard
        DAYS(s.g, 1);
        expect(mega.escorted).toBe(1);
        expect(builtMission(w)).toBe('Patrol');
        expect(isAiControlled(w)).toBe(false);
    });
});

describe('the escorted delivery in the war credit', () => {
    it('an escorted arrival adds war credit to the escort\'s owner; an unescorted one adds none', () => {
        const s = setup();
        const mega = started(s);
        s.st.phase = 'reclamation';
        s.st.warStarted = true;
        expect(warCreditActive(s.g, s.st)).toBe(true);
        const [ai] = s.ais;
        const [f1, f2] = fly(s, s.me, 2);
        const escort = warships(ai)[0];
        assignMission(s.g, escort, BuiltObjectMissionType.Escort, f1, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
        const base = mega.base!;
        f1.xpos = base.xpos;
        f1.ypos = base.ypos;
        escort.xpos = base.xpos + 300;
        escort.ypos = base.ypos;
        rebuildIndexes(s.g);
        DAYS(s.g, 1);
        expect(mega.escorted).toBe(1);
        expect(warCreditOf(s.st).points[String(ai.empireId)]?.escorts).toBe(WC.escort(s.g));
        expect(warCreditOf(s.st).points[String(s.me.empireId)]?.escorts ?? 0).toBe(0);
        // the escort turns to other work; the next freighter arrives unescorted
        builtObjectMission(escort.mission)?.clear();
        escort.xpos = base.xpos + 500000;
        escort.ypos = base.ypos + 500000;
        f2.xpos = base.xpos;
        f2.ypos = base.ypos;
        rebuildIndexes(s.g);
        const delivered = mega.delivered;
        DAYS(s.g, 1);
        expect(mega.delivered).toBe(delivered + 1);
        expect(mega.escorted).toBe(1);
        expect(warCreditOf(s.st).points[String(ai.empireId)]?.escorts).toBe(WC.escort(s.g));
        expect(warCreditLabel('escorts')).toBe('Severance freighters escorted safely');
    });
});

describe('save round trip', () => {
    it('an escort group and its ships survive a save, and it goes on after the load', () => {
        const s = setup();
        const mega = started(s);
        const [ai, raider] = s.ais;
        contributor(s, ai);
        warOf(raider, ai);
        fly(s, ai, 2);
        place(warships(raider)[0], midOf(s, ai).x, midOf(s, ai).y);
        rebuildIndexes(s.g);
        DAYS(s.g, 1);
        const n = escortGroupOf(mega, ai)!.ships.length;
        expect(n).toBeGreaterThan(0);
        const text = serializeGame(s.game, new GalaxyTime(), {} as StartGameOptions);
        const { game } = deserializeGame(text, s.gameData);
        const m = peekMega(game.galaxy)!;
        const grp = escortGroupOf(m, game.galaxy.empires.find((e) => e?.empireId === ai.empireId)!)!;
        expect(grp.ships.length).toBe(n);
        for (const w of grp.ships) expect(game.galaxy.empires.some((e) => e !== null && e.builtObjects.includes(w))).toBe(true);
        expect(escortGroupCount(m)).toBe(1);
        DAYS(game.galaxy, 1);
        expect(escortGroupCount(m)).toBe(1);
    }, 600000);
});
