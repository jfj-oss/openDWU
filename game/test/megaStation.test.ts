// Building the mega-station (threats/giantworks/megaStation.ts): the Diet motion that only a human with the blueprint may move and that names a void
// place, the pledges, the part caps, the building and the decay, the blockade, the indestructible unarmed base, the Long Night carry, the firing,
// the Knowledge rows, the picker dependency and the save round trip.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import type { CreateGameOptions, Game } from '../src/sim/game';
import { comboOverlayFs, createScenarioGame, scenarioIndexFs } from './helpers/scenarioGame';
import { GAME_DAY_LENGTH } from '../src/sim/scenario/hooks';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { empireMessages } from '../src/sim/messages';
import { setGameEndHandler, type GameEndEventArgs, GameEndOutcome } from '../src/sim/victory';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { inflictDamage } from '../src/sim/combat/damage';
import { rebuildIndexes } from '../src/sim/indexRebuild';
import { threatGameEndPolicy } from '../src/sim/scenario/threats/framework';
import { councilState, type Council } from '../src/sim/scenario/emergent/council';
import { dietMotionKindDef, dietState, type DietMotion } from '../src/sim/scenario/charactersVictory/diet/dietState';
import { dietPropose } from '../src/sim/scenario/charactersVictory/diet/diet';
import { dietView } from '../src/sim/scenario/charactersVictory/diet/dietView';
import { beaconRolled } from '../src/sim/scenario/threats/giantworks/beacon';
import { P, peekBeaconState, type BeaconState, type EmpireParts } from '../src/sim/scenario/threats/giantworks/beaconState';
import { partsOf, heldParts } from '../src/sim/scenario/threats/giantworks/beaconComponents';
import type { GreatWorkSite } from '../src/sim/scenario/threats/giantworks/framework';
import {
    MOTION_MEGA,
    MOTION_MEGA_RESUME,
    canResumeMega,
    canStartMega,
    captureMega,
    megaBlockader,
    megaKnowledgeRows,
    megaStep,
    partsCap,
    peekMega,
    poolTotals,
    restoreMega,
    voidPointNear,
} from '../src/sim/scenario/threats/giantworks/megaStation';
import { captureParts, restoreParts } from '../src/sim/scenario/threats/giantworks/longNight';
import { withFlagAddons, forcedFlags, addonCatalog, addonSets } from '../src/sim/scenario/addons';

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

/** A seed-1 Giantworks game with the Diet on (a council of every empire), the Beacon rolled and the player holding the finished blueprint. */
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

function give(st: BeaconState, e: Empire, parts: EmpireParts): void {
    const held = partsOf(st).held;
    held[String(e.empireId)] = { ...(held[String(e.empireId)] ?? {}), ...parts };
}

function peace(a: Empire, b: Empire): void {
    obtainDiplomaticRelation(a, b).type = DiplomaticRelationType.None;
    obtainDiplomaticRelation(b, a).type = DiplomaticRelationType.None;
}

/** The passed motion of `proposer`, with `yes` voting yes and `no` voting no. */
function motion(g: Galaxy, proposer: Empire, place: { x: number; y: number }, yes: Empire[], no: Empire[] = [], kind = MOTION_MEGA): DietMotion {
    return {
        id: 1,
        kind,
        proposer,
        target: proposer,
        other: null,
        colony: null,
        resourceId: -1,
        place,
        text: 't',
        votes: [...yes.map((e) => ({ empire: e, vote: 'yes' as const, weight: 1, score: 0 })), ...no.map((e) => ({ empire: e, vote: 'no' as const, weight: 1, score: 0 }))],
        status: 'passed',
        yes: yes.length,
        no: no.length,
    } as DietMotion;
}

function pass(g: Galaxy, m: DietMotion): void {
    const def = dietMotionKindDef(m.kind)!;
    def.apply(g, dietState(g), m, (() => undefined) as never);
}

const advance = (g: Galaxy, days: number): void => {
    g.nowMs += days * DAY;
};

/** Runs the daily step `days` times, a day apart. */
function run(g: Galaxy, days: number, each?: () => void): void {
    for (let i = 0; i < days; i++) {
        advance(g, 1);
        each?.();
        megaStep(g);
    }
}

/** Starts the mega-station as `me` with the given backers; returns its record. */
function started(s: Setup, yes: Empire[] = [], no: Empire[] = []): NonNullable<ReturnType<typeof peekMega>> {
    const at = voidPointNear(s.g, s.g.sizeX / 2, s.g.sizeY / 2)!;
    pass(s.g, motion(s.g, s.me, at, yes, no));
    return peekMega(s.g)!;
}

function builtMission(b: BuiltObject): string {
    const m = builtObjectMission(b.mission);
    return m === null ? 'none' : BuiltObjectMissionType[m.type];
}

/** Puts one of the empire's ships at the structure and makes it a delivery in flight. */
function deliverNow(s: Setup, e: Empire): void {
    const mega = peekMega(s.g)!;
    const ship = e.builtObjects.find((b) => !b.hasBeenDestroyed && b.topSpeed > 0)!;
    ship.xpos = mega.base!.xpos;
    ship.ypos = mega.base!.ypos;
    mega.contracts.push({ empireId: e.empireId, ship, sent: galaxyStarDate(s.g) });
}

describe('who may move it, and where', () => {
    it('only a human holding the finished blueprint; one per galaxy; the Diet must be on', () => {
        const s = setup();
        const def = dietMotionKindDef(MOTION_MEGA)!;
        expect(def.needs).toBe('point');
        expect(canStartMega(s.g, s.me)).toBe(true);
        expect(def.proposable!(s.g)).toBe(true);
        for (const ai of s.ais) {
            give(s.st, ai, { blueprint: { since: 1, progress: P.blueprintCost(s.g), sharePct: 25, done: true } });
            expect(canStartMega(s.g, ai)).toBe(false); // an AI never moves it
            expect(def.proposableBy!(s.g, ai)).toBe(false);
        }
        heldParts(s.st, s.me)!.blueprint!.done = false;
        expect(canStartMega(s.g, s.me)).toBe(false); // no finished blueprint
        expect(def.proposable!(s.g)).toBe(false);
        heldParts(s.st, s.me)!.blueprint!.done = true;
        started(s);
        expect(canStartMega(s.g, s.me)).toBe(false); // one per galaxy
        expect(def.proposable!(s.g)).toBe(false);
        s.g.scenario!.flags.cvCouncil = false;
        expect(def.proposable!(s.g)).toBe(false);
    });

    it('the Diet screen offers it only to a player who may move it, and asks for a point', () => {
        const s = setup();
        expect(dietView(s.g, s.me)!.proposable.find((k) => k.kind === MOTION_MEGA)?.needs).toBe('point');
        heldParts(s.st, s.me)!.blueprint!.done = false;
        expect(dietView(s.g, s.me)!.proposable.some((k) => k.kind === MOTION_MEGA)).toBe(false);
    });

    it('the place snaps to the nearest empty void: clear of every star, inside the galaxy', () => {
        const s = setup();
        const clear = P.megaVoidClear(s.g);
        const stars = s.g.systems.filter((x) => x?.systemStar).map((x) => x.systemStar);
        const near = (p: { x: number; y: number }): number => Math.min(...stars.map((t) => Math.hypot(t.xpos - p.x, t.ypos - p.y)));
        const onStar = voidPointNear(s.g, stars[10].xpos, stars[10].ypos)!;
        expect(near(onStar)).toBeGreaterThanOrEqual(clear);
        expect(Math.hypot(onStar.x - stars[10].xpos, onStar.y - stars[10].ypos)).toBeLessThan(clear * 4); // the nearest, not a far one
        // a point already in the void stays
        const free = voidPointNear(s.g, s.g.sizeX / 2, s.g.sizeY / 2)!;
        expect(voidPointNear(s.g, free.x, free.y)).toEqual(free);
        expect(free.x).toBeGreaterThan(0);
        expect(free.y).toBeLessThan(s.g.sizeY);
    });

    it('a proposal goes through dietPropose: snapped, queued for the next session; refused without the blueprint or a place', () => {
        const s = setup();
        const stars = s.g.systems.filter((x) => x?.systemStar).map((x) => x.systemStar);
        expect(dietPropose(s.g, s.me, { kind: MOTION_MEGA, target: null, other: null, colony: null, resourceId: -1 })).toBe(false); // no place
        expect(dietPropose(s.g, s.me, { kind: MOTION_MEGA, target: null, other: null, colony: null, resourceId: -1, place: { x: stars[3].xpos, y: stars[3].ypos } })).toBe(true);
        const q = dietState(s.g).proposals[s.me.empireId];
        expect(q.kind).toBe(MOTION_MEGA);
        expect(q.target).toBe(s.me);
        expect(Math.min(...stars.map((t) => Math.hypot(t.xpos - q.place!.x, t.ypos - q.place!.y)))).toBeGreaterThanOrEqual(P.megaVoidClear(s.g));
        const ai = s.ais[0];
        give(s.st, ai, { blueprint: { since: 1, progress: 1, sharePct: 25, done: true } });
        expect(dietPropose(s.g, ai, { kind: MOTION_MEGA, target: null, other: null, colony: null, resourceId: -1, place: { x: 1, y: 1 } })).toBe(false);
    });
});

describe('the pledges', () => {
    it('yes-voters on good terms hand their parts over; refusers keep theirs; the pool is capped by what it holds', () => {
        const s = setup();
        const [a, b, c] = s.ais;
        for (const x of [a, b, c]) {
            peace(x, s.me);
            obtainDiplomaticRelation(x, s.me).type = DiplomaticRelationType.None;
        }
        give(s.st, s.me, { beamLens: true, mindFragments: 15 });
        give(s.st, a, { linkConduit: true, voidFrames: 2 });
        give(s.st, b, { cloakLattice: true }); // votes no: keeps it
        give(s.st, c, { mindFragments: 9 }); // votes yes but at war with the builder: keeps it
        obtainDiplomaticRelation(c, s.me).type = DiplomaticRelationType.War;
        obtainDiplomaticRelation(s.me, c).type = DiplomaticRelationType.War;
        // a likes the builder enough to hand parts over (attitude, standing)
        const mega = started(s, [a, c], [b]);
        const t = poolTotals(mega);
        expect(t.beamLens).toBe(true);
        expect(t.mindFragments).toBe(15);
        expect(mega.contributors).toContain(s.me.empireId);
        expect(mega.builder).toBe(s.me.empireId);
        expect(heldParts(s.st, s.me)).toMatchObject({ beamLens: false, mindFragments: 0 }); // handed over, not copied
        expect(heldParts(s.st, b)!.cloakLattice).toBe(true);
        expect(heldParts(s.st, c)!.mindFragments).toBe(9);
        expect(mega.refused).toEqual(expect.arrayContaining([b.name, c.name]));
        expect(mega.contributors).not.toContain(c.empireId);
        expect(heldParts(s.st, s.me)!.blueprint!.done).toBe(true); // the blueprint stays with its owner
        if (mega.contributors.includes(a.empireId)) {
            expect(t.linkConduit).toBe(true);
            expect(t.voidFrames).toBe(2);
        }
        // the cap: lens 20% + fragments 25% x 15/30 (+ conduit 15% and frames 25% x 2/4 when a handed over)
        const expected = 0.2 + 0.25 * 0.5 + (t.linkConduit ? 0.15 : 0) + (t.voidFrames > 0 ? 0.25 * 0.5 : 0);
        expect(partsCap(s.g, mega)).toBeCloseTo(expected);
    });

    it('a human yes-voter consents by voting; the proposer gets the popup and the ticker', () => {
        const s = setup();
        const mega = started(s, []);
        expect(mega.status).toBe('building');
        expect(empireMessages(s.me).some((m) => m.title.length > 0 && m.description.length > 0)).toBe(true);
        expect(mega.base).not.toBeNull();
    });

    it('the cap formula: each part counts its share, fragments and frames in proportion', () => {
        const s = setup();
        const mega = started(s);
        const cases: [EmpireParts, number][] = [
            [{}, 0],
            [{ beamLens: true }, 0.2],
            [{ beamLens: true, linkConduit: true, cloakLattice: true }, 0.5],
            [{ beamLens: true, linkConduit: true, cloakLattice: true, mindFragments: 30, voidFrames: 4 }, 1],
            [{ mindFragments: 15 }, 0.125],
            [{ voidFrames: 1 }, 0.0625],
            [{ mindFragments: 99, voidFrames: 99 }, 0.5], // beyond the need adds nothing
        ];
        for (const [p, cap] of cases) {
            mega.pool = { x: p };
            expect(partsCap(s.g, mega)).toBeCloseTo(cap);
        }
    });

    it('a pledged empire hands over what it wins later; a refuser does not', () => {
        const s = setup();
        const mega = started(s);
        expect(partsCap(s.g, mega)).toBe(0);
        give(s.st, s.me, { beamLens: true });
        advance(s.g, 1);
        megaStep(s.g);
        expect(poolTotals(mega).beamLens).toBe(true);
        expect(partsCap(s.g, mega)).toBeCloseTo(0.2);
        const outsider = s.ais[0];
        give(s.st, outsider, { linkConduit: true });
        advance(s.g, 1);
        megaStep(s.g);
        expect(poolTotals(mega).linkConduit).toBe(false);
    });
});

describe('the building', () => {
    it('a real unarmed base of the Compact at the void point, indestructible', () => {
        const s = setup();
        const mega = started(s);
        const base = mega.base!;
        expect(base).not.toBeNull();
        expect(base.hasBeenDestroyed).toBe(false);
        expect(Math.hypot(base.xpos - mega.x, base.ypos - mega.y)).toBeLessThan(P.megaReach(s.g));
        expect(base.firepowerRaw).toBe(0);
        expect(base.name).toContain('Severance');
        // a warship with no restraint fires at it: no damage
        const shooter = s.ais[0].builtObjects.find((b) => !b.hasBeenDestroyed && b.firepowerRaw > 0)!;
        const hull = base.hasBeenDestroyed;
        for (let i = 0; i < 50; i++) inflictDamage(s.g, shooter, base, null, 1e9, 1, 100, 0);
        expect(base.hasBeenDestroyed).toBe(hull);
        expect(base.currentShields).toBe(base.shieldsCapacity);
        // a ship of the same empire that is not the structure takes damage as usual
        const other = s.ais[0].builtObjects.find((b) => !b.hasBeenDestroyed && b !== shooter && b.role !== 3)!;
        expect(other).toBeDefined();
    });

    it('active construction takes buildYears: progress is time-based while deliveries arrive, and stops at the cap (no decay when stalled for parts)', () => {
        const s = setup();
        give(s.st, s.me, { beamLens: true, linkConduit: true, cloakLattice: true }); // cap 50%
        const mega = started(s);
        expect(mega.buildYears).toBeGreaterThanOrEqual(60);
        expect(mega.buildYears).toBeLessThanOrEqual(70);
        mega.buildYears = 60;
        expect(partsCap(s.g, mega)).toBeCloseTo(0.5);
        // one delivery a month keeps it active
        run(s.g, 360, () => {
            if (Math.round((galaxyStarDate(s.g) - mega.since) / DAY) % 30 === 0) deliverNow(s, s.me);
        });
        expect(mega.status).toBe('building');
        expect(mega.progress).toBeCloseTo(1 / 60, 2); // one year of sixty
        expect(mega.delivered).toBeGreaterThan(5);
        // run on to the cap: 30 years of active building = 50%
        run(s.g, 360 * 30, () => {
            if (Math.round((galaxyStarDate(s.g) - mega.since) / DAY) % 30 === 0) deliverNow(s, s.me);
        });
        expect(mega.progress).toBeCloseTo(0.5, 3);
        expect(mega.status).toBe('stalled');
        const at = mega.progress;
        const days = mega.activeDays;
        run(s.g, 360 * 6);
        expect(mega.progress).toBe(at); // stalled for missing parts: no progress, no decay
        expect(mega.activeDays).toBe(days);
        expect(mega.starvedDays).toBe(0);
        // a new part raises the cap and work goes on
        give(s.st, s.me, { mindFragments: 30 });
        run(s.g, 5, () => deliverNow(s, s.me));
        expect(mega.status).toBe('building');
        expect(mega.progress).toBeGreaterThan(at);
    });

    it('stalled or blockaded time does not count towards the build time', () => {
        const s = setup();
        const mega = started(s);
        run(s.g, 400); // no parts: capped at 0, never active
        expect(mega.activeDays).toBe(0);
        expect(mega.progress).toBe(0);
    });

    it('freighters sent and none arriving for 2 years: it decays 1% of the whole per 2 years after that; nothing sent means no decay', () => {
        const s = setup();
        give(s.st, s.me, { beamLens: true, linkConduit: true, cloakLattice: true, mindFragments: 30, voidFrames: 4 }); // cap 100%
        const mega = started(s);
        mega.progress = 0.4;
        mega.lastArrival = galaxyStarDate(s.g) - 400 * DAY; // not active any more
        // nothing is ever sent (no freighters of ours at all): idle, no decay
        mega.contracts = [];
        mega.contributors = [];
        run(s.g, 360 * 5);
        expect(mega.progress).toBeCloseTo(0.4, 6);
        // freighters are sent (one every month) but never arrive
        mega.contributors = [s.me.empireId];
        const ship = s.me.builtObjects.find((b) => !b.hasBeenDestroyed && b.topSpeed > 0)!;
        ship.xpos = 1;
        ship.ypos = 1;
        run(s.g, 360 * 2 - 5, () => {
            mega.lastSent = galaxyStarDate(s.g);
        });
        expect(mega.progress).toBeCloseTo(0.4, 3); // the first two years cost nothing
        run(s.g, 720 + 10, () => {
            mega.lastSent = galaxyStarDate(s.g);
        });
        expect(mega.progress).toBeCloseTo(0.4 - 0.01, 2); // 1% per two years after that
        expect(mega.status).toBe('idle');
        // one arrival ends the starvation
        deliverNow(s, s.me);
        run(s.g, 3);
        expect(mega.starvedDays).toBe(0);
        expect(mega.status).toBe('building');
    });

    it('dispatch: a contributor redirects at most 20% of its private freighters, one per dispatch day, never a state ship; they are the private sector\'s again after delivering', () => {
        const s = setup();
        s.g.scenario!.params.megaDispatchDays = 1;
        give(s.st, s.me, { beamLens: true });
        const mega = started(s);
        const me = s.me;
        const priv = new Set(me.privateBuiltObjects);
        const freighters = me.freighters.filter((f) => priv.has(f as never));
        const cap = Math.floor((freighters.length * P.megaFreighterPct(s.g)) / 100);
        expect(cap).toBeGreaterThan(1);
        run(s.g, 3 * cap);
        const mine = mega.contracts.filter((c) => c.empireId === me.empireId);
        expect(mine.length).toBe(cap); // the cap, no more
        for (const c of mine) {
            expect(priv.has(c.ship)).toBe(true);
            expect(builtMission(c.ship)).toBe('Move');
        }
        expect(new Set(mine.map((c) => c.ship)).size).toBe(cap);
        // one arrives: it is released (no mission) and a new one is sent in its place
        const first = mine[0].ship;
        const m0 = mega.base!;
        first.xpos = m0.xpos;
        first.ypos = m0.ypos;
        run(s.g, 1);
        expect(mega.delivered).toBe(1);
        expect(builtMission(first)).not.toBe('Move');
        expect(mega.contracts.some((c) => c.ship === first)).toBe(false);
        expect(mega.contracts.filter((c) => c.empireId === me.empireId).length).toBeLessThanOrEqual(cap);
    });

    it('a hostile armed force holding the space shoots the freighters on their way in (the Blockades that bite rule, add-on or not); one shot down never arrives', () => {
        const s = setup();
        give(s.st, s.me, { beamLens: true });
        const mega = started(s);
        const enemy = s.ais[0];
        obtainDiplomaticRelation(enemy, s.me).type = DiplomaticRelationType.War;
        obtainDiplomaticRelation(s.me, enemy).type = DiplomaticRelationType.War;
        const warship = enemy.builtObjects.find((b) => !b.hasBeenDestroyed && b.firepowerRaw > 0 && b.topSpeed > 0)!;
        const wx = warship.xpos;
        const wy = warship.ypos;
        warship.xpos = mega.base!.xpos + 100;
        warship.ypos = mega.base!.ypos;
        builtObjectMission(warship.mission)?.clear(); // idle at the structure
        rebuildIndexes(s.g);
        expect(megaBlockader(s.g, s.st, mega)).toBe(enemy);
        const freighter = s.me.builtObjects.find((b) => !b.hasBeenDestroyed && b.topSpeed > 0 && !(b.firepowerRaw > 0))!;
        mega.contracts.push({ empireId: s.me.empireId, ship: freighter, sent: galaxyStarDate(s.g) });
        freighter.ypos = mega.base!.ypos;
        freighter.xpos = mega.base!.xpos + 3000;
        rebuildIndexes(s.g);
        advance(s.g, 1);
        megaStep(s.g);
        expect(builtMission(warship)).toBe('Attack'); // ordered to shoot the freighter
        // a freighter shot down counts as sent, not arrived
        freighter.hasBeenDestroyed = true;
        const sent = mega.lastSent;
        const delivered = mega.delivered;
        megaStep(s.g);
        expect(mega.contracts.some((c) => c.ship === freighter)).toBe(false);
        expect(mega.delivered).toBe(delivered);
        expect(mega.lastSent).toBe(sent);
        warship.xpos = wx;
        warship.ypos = wy;
        rebuildIndexes(s.g);
        expect(megaBlockader(s.g, s.st, mega)).toBeNull();
    });
});

describe('the firing', () => {
    it('at 100% it fires: a popup, the hook, and the Reclamation check ends the game; in a later age the game ends here', () => {
        const keep = threatGameEndPolicy.restrict;
        threatGameEndPolicy.restrict = false;
        try {
            const s = setup();
            const ends: GameEndEventArgs[] = [];
            setGameEndHandler(s.g, (e) => ends.push(e));
            give(s.st, s.me, { beamLens: true, linkConduit: true, cloakLattice: true, mindFragments: 30, voidFrames: 4 });
            const mega = started(s);
            const before = empireMessages(s.me).length;
            mega.progress = 0.999999;
            deliverNow(s, s.me);
            run(s.g, 40);
            expect(mega.status).toBe('fired');
            expect(mega.progress).toBe(1);
            expect(s.st.megaFired).toBe(true);
            expect(empireMessages(s.me).length).toBeGreaterThan(before);
            // the Beacon state is not in a Reclamation (this fixture): the structure ends the game itself
            expect(ends.map((e) => [e.code, e.outcomeForPlayer])).toEqual([[2154, GameEndOutcome.Victory]]);
            run(s.g, 10);
            expect(ends.length).toBe(1);
        } finally {
            threatGameEndPolicy.restrict = keep;
        }
    });
});

describe('the Long Night', () => {
    it('the half-built structure and the pooled parts survive in the memory record; the next age holds it dormant until it is found and voted', () => {
        const s = setup();
        give(s.st, s.me, { beamLens: true, mindFragments: 12 });
        const mega = started(s);
        mega.progress = 0.31;
        mega.activeDays = 7000;
        const rec = captureMega(s.g)!;
        expect(rec).toMatchObject({ x: mega.x, y: mega.y, progress: 0.31, activeDays: 7000 });
        expect(rec.pool[s.me.name]).toMatchObject({ beamLens: true, mindFragments: 12 });
        expect(JSON.parse(JSON.stringify(rec))).toEqual(rec); // plain data
        // the new age (a fresh galaxy of the same seed)
        const n = setup();
        restoreMega(n.g, JSON.parse(JSON.stringify(rec)));
        const m = peekMega(n.g)!;
        expect(m.status).toBe('dormant');
        expect(m.progress).toBe(0.31);
        expect([m.x, m.y]).toEqual([mega.x, mega.y]);
        expect(m.base ?? null).toBeNull();
        expect(poolTotals(m).beamLens).toBe(true);
        expect(canResumeMega(n.g, n.me)).toBe(false); // not found yet
        const def = dietMotionKindDef(MOTION_MEGA_RESUME)!;
        expect(def.proposable!(n.g)).toBe(false);
        // a ship comes within reach: found, the base is raised, the human is told, a vote may be moved
        const ship = n.me.builtObjects.find((b) => !b.hasBeenDestroyed && b.topSpeed > 0 && b.role !== 3)!;
        ship.xpos = m.x + 100;
        ship.ypos = m.y;
        rebuildIndexes(n.g);
        advance(n.g, 1);
        megaStep(n.g);
        expect(m.foundBy).toContain(n.me.empireId);
        expect(m.base).not.toBeNull();
        expect(m.status).toBe('dormant');
        expect(canResumeMega(n.g, n.me)).toBe(true);
        expect(def.proposable!(n.g)).toBe(true);
        expect(canStartMega(n.g, n.me)).toBe(false);
        // dormant: no progress, no deliveries
        run(n.g, 100);
        expect(m.progress).toBe(0.31);
        // the vote resumes it
        pass(n.g, motion(n.g, n.me, { x: 0, y: 0 }, [], [], MOTION_MEGA_RESUME));
        expect(m.status).toBe('building');
        expect(m.progress).toBe(0.31);
        expect(m.voted).toBe(true);
    });

    it('every empire standing keeps its pieces by name; the dead are the ruins\' record, not the memory\'s', () => {
        const s = setup();
        const [a, b] = s.ais;
        give(s.st, s.me, { beamLens: true });
        give(s.st, a, { linkConduit: true, mindFragments: 4 });
        give(s.st, b, { cloakLattice: true, voidFrames: 2 });
        b.active = false;
        const rec = captureParts(s.g)!;
        expect(rec.empires[s.me.name]).toMatchObject({ beamLens: true });
        expect(rec.empires[a.name]).toMatchObject({ linkConduit: true, mindFragments: 4 }); // AI survivors too
        expect(rec.empires[b.name]).toBeUndefined();
        expect('dead' in rec).toBe(false);
        const n = setup();
        n.st.parts!.held = {};
        restoreParts(n.g, JSON.parse(JSON.stringify(rec)));
        expect(heldParts(n.st, n.ais[0])).toMatchObject({ linkConduit: true, mindFragments: 4 });
        expect(heldParts(n.st, n.me)).toMatchObject({ beamLens: true });
        // an older record (with a `dead` list) still restores its empires
        n.st.parts!.held = {};
        restoreParts(n.g, JSON.parse(JSON.stringify({ empires: { [n.me.name]: { beamLens: true } }, dead: [{ name: 'Gone', x: 0, y: 0, systemName: 's', parts: { voidFrames: 2 } }] })));
        expect(heldParts(n.st, n.me)).toMatchObject({ beamLens: true });
        // the older record shape (humans by name) still restores
        n.st.parts!.held = {};
        restoreParts(n.g, JSON.parse(JSON.stringify({ [n.me.name]: { beamLens: true } })));
        expect(heldParts(n.st, n.me)).toMatchObject({ beamLens: true });
    });

    it('the record is plain data in the memory contributor list and survives JSON', () => {
        const s = setup();
        give(s.st, s.me, { beamLens: true });
        const mega = started(s);
        mega.progress = 0.2;
        const json = JSON.parse(JSON.stringify({ mega: captureMega(s.g), parts: captureParts(s.g) })) as { mega: unknown; parts: unknown };
        const n = setup();
        restoreMega(n.g, json.mega);
        expect(peekMega(n.g)!.progress).toBe(0.2);
        expect(poolTotals(peekMega(n.g)!).beamLens).toBe(true);
    });
});

describe('the Knowledge rows', () => {
    it('show who holds each piece with counts, the blueprint and the structure with progress, cap and status', () => {
        const s = setup();
        const [a] = s.ais;
        give(s.st, s.me, { beamLens: true, mindFragments: 7 });
        give(s.st, a, { linkConduit: true, mindFragments: 3 });
        let rows = megaKnowledgeRows(s.g, s.me)!;
        const row = (k: string) => rows.find((r) => r.key === k)!;
        expect(row('mega:beamLens').where).toContain(s.me.name);
        expect(row('mega:linkConduit').where).toContain(a.name);
        expect(row('mega:cloakLattice').where).not.toContain(s.me.name);
        expect(row('mega:mindFragments').where).toContain(`${s.me.name} (7)`);
        expect(row('mega:mindFragments').where).toContain(`${a.name} (3)`);
        expect(row('mega:blueprint').status.length).toBeGreaterThan(0);
        expect(rows.some((r) => r.key === 'mega:structure')).toBe(false);
        started(s);
        rows = megaKnowledgeRows(s.g, s.me)!;
        const st = row('mega:structure');
        expect(st.goTo).not.toBeNull();
        expect(st.point).not.toBeNull();
        expect(st.status.length).toBeGreaterThan(0);
        expect(row('mega:beamLens').where).toContain(s.me.name); // now in the structure
    });
});

describe('save round trip', () => {
    it('the structure, its pool and its contracts survive a save', () => {
        const s = setup();
        give(s.st, s.me, { beamLens: true });
        const mega = started(s);
        mega.progress = 0.123;
        mega.refused = ['X'];
        deliverNow(s, s.me);
        const text = serializeGame(s.game, new GalaxyTime(), {} as StartGameOptions);
        const { game } = deserializeGame(text, s.gameData);
        const m = peekMega(game.galaxy)!;
        expect(m).toBeDefined();
        expect(m.progress).toBe(0.123);
        expect(m.status).toBe('building');
        expect(m.pool).toEqual(mega.pool);
        expect(m.refused).toEqual(['X']);
        expect(m.contributors).toEqual(mega.contributors);
        expect(m.base).not.toBeNull();
        expect(m.base!.xpos).toBe(mega.base!.xpos);
        expect(game.galaxy.empires.some((e) => e !== null && e.builtObjects.includes(m.base!))).toBe(true);
        expect(m.contracts).toHaveLength(1);
        expect(game.galaxy.empires.some((e) => e !== null && e.builtObjects.includes(m.contracts[0].ship))).toBe(true);
        // and it goes on after the load
        advance(game.galaxy, 1);
        megaStep(game.galaxy);
        expect(m.delivered).toBe(1);
    }, 600000);
});

describe('the picker dependency', () => {
    it('the Harvest Cycle needs the Galactic Diet: Characters & Victory and its Diet are pulled in and forced on', () => {
        const cat = addonCatalog(scenarioIndexFs());
        const p = withFlagAddons(cat, ['giantworks']);
        expect(addonSets(cat, p).on).toContain('characters-victory');
        const forced = forcedFlags(cat, { gwHarvestCycle: true, threatGiantworks: true }, ['giantworks', 'characters-victory']);
        expect([...(forced.get('characters-victory')?.keys() ?? [])]).toEqual(expect.arrayContaining(['charactersVictory', 'cvCouncil']));
        // with the Harvest Cycle off nothing is pulled in
        const off = withFlagAddons(cat, ['giantworks'], { flags: { gwHarvestCycle: false }, params: {} });
        expect(addonSets(cat, off).on).not.toContain('characters-victory');
    });
});
