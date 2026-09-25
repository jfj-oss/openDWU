import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, type CreateGameOptions } from '../src/sim/game';
import { setGovernmentsStatic, type Empire } from '../src/sim/empire';
import type { Galaxy } from '../src/sim/galaxy';
import { GalaxyShape } from '../src/sim/types';
import { START_STAR_DATE } from '../src/sim/galaxyTime';
import { SystemVisibilityStatus } from '../src/sim/visibility';
import { PiratePlayStyle } from '../src/sim/pirates';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import {
    PirateRelation,
    PirateRelationEvaluationType,
    PirateRelationList,
    PirateRelationType,
    addPirateRelation,
    changePirateEvaluation,
    changePirateRelation,
    changePirateRelationThisSideOnly,
    checkHaveMetPirates,
    meetPiratesAtStart,
    obtainPirateRelation,
    setPirateRelationEmpires,
} from '../src/sim/pirateRelations';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
}, 60000);

function opts(playAsPirate = false): CreateGameOptions {
    const ai = (race: string) => ({ race, homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', age: 1, techLevel: 0.5 });
    return {
        seed: 1, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8,
        systemNames: Array.from({ length: 300 }, (_, i) => `S${i}`), gameData,
        player: playAsPirate
            ? { race: 'Human', homeSystemFavourability: 'Normal', startLocation: '(Random)', age: 1, techLevel: 0.5, playAsPirate: true, piratePlayStyle: PiratePlayStyle.Smuggler, name: 'Test Pirates' }
            : { race: 'Human', homeSystemFavourability: 'Normal', startLocation: '(Random)', age: 1, techLevel: 0.5 },
        aiEmpires: [ai('(Random)'), ai('(Random)'), ai('(Random)')],
        piratePrevalence: 1.0,
        // M4x: galaxyAge now defaults to 1; this test's pins / asserts are for Galaxy.Age 0 (START_STAR_DATE etc.).
        galaxyAge: 0,
    };
}

/** Counts galaxy.rnd.next calls made during fn. */
function countDraws(g: Galaxy, fn: () => void): number {
    const rnd = g.rnd as unknown as { next: (...a: number[]) => number };
    const orig = rnd.next;
    let n = 0;
    rnd.next = function (this: unknown, ...a: number[]) {
        n++;
        return orig.apply(this, a);
    };
    try {
        fn();
    } finally {
        rnd.next = orig;
    }
    return n;
}

let game: ReturnType<typeof createGame>;
const setup = () => (game ??= createGame(opts()));

describe('PirateRelation / PirateRelationList', () => {
    it('enum member order', () => {
        expect([PirateRelationType.NotMet, PirateRelationType.None, PirateRelationType.Protection]).toEqual([0, 1, 2]);
        expect(PirateRelationEvaluationType.RaidsAgainstOurColonies).toBe(9);
        expect(PirateRelationEvaluationType.CovetedColony).toBe(7);
    });

    it('CalculateOffenseOverCancellingProtection', () => {
        const r = new PirateRelation(1, 2, PirateRelationType.Protection);
        r.lastChangeDate = 1000;
        expect(r.calculateOffenseOverCancellingProtection(1000)).toBe(-20); // 5 + 15 → clamp 20
        expect(r.calculateOffenseOverCancellingProtection(1000 + 150000)).toBe(-12.5); // 5 + 5*0.5*3
        expect(r.calculateOffenseOverCancellingProtection(1000 + 300000)).toBe(-5);
    });

    it('Evaluation (float sum, DiplomacyFactor) and NeutralizeEvaluation', () => {
        const r = new PirateRelation(1, 2, PirateRelationType.None);
        r.evaluationGifts = 10;
        r.evaluationShipAttacks = -4;
        r.evaluationLongRelationship = Math.fround(0.1); // float field: callers store fround values
        r.diplomacyFactor = 2;
        expect(r.evaluation).toBe(Math.fround(Math.fround(Math.fround(10 + 0.1) - 4) * 2));
        r.evaluationShipAttacks = -40;
        expect(r.evaluation).toBe(Math.fround(Math.fround(Math.fround(10 + 0.1) - 40) / 2));
        r.neutralizeEvaluation(6); // 2 non-zero (long relationship not counted) → 3 each
        expect(r.evaluationGifts).toBe(7);
        expect(r.evaluationShipAttacks).toBe(-37);
        expect(r.evaluationLongRelationship).toBe(Math.fround(0.1));
        r.neutralizeEvaluation(100);
        expect(r.evaluationGifts).toBe(0);
        expect(r.evaluationShipAttacks).toBe(0);
    });

    it('list index: Add dedupes by OtherEmpire, Remove recalculates, out-of-range ids dropped', () => {
        const g = setup().galaxy;
        const [a, b, c] = g.empires;
        const list = new PirateRelationList();
        const r1 = list.add(new PirateRelation(a, b, PirateRelationType.None));
        const r2 = list.add(new PirateRelation(a, c, PirateRelationType.Protection));
        expect(list.add(new PirateRelation(a, b, PirateRelationType.Protection))).toBe(r1);
        expect(list.count).toBe(2);
        expect(list.getRelationByOtherEmpire(c)).toBe(r2);
        expect(list.getRelationByOtherEmpireId(b.empireId)).toBe(r1);
        list.remove(r1);
        expect(list.getRelationByOtherEmpire(b)).toBeNull();
        expect(list.getRelationByOtherEmpire(c)).toBe(r2);
        expect(list.getRelationsByType(PirateRelationType.Protection).toArray()).toEqual([r2]);
        expect(list.resolveEmpiresWithProtection()).toEqual([c]);
        list.addRaw(new PirateRelation(1, 255, PirateRelationType.None));
        expect(list.count).toBe(1);
    });

    it('FixupEmpires via SetPirateRelationEmpires resolves ids', () => {
        const g = setup().galaxy;
        const p = g.pirateEmpires[0];
        const e = g.empires[1];
        const saved = p.pirateRelations;
        try {
            p.pirateRelations = new PirateRelationList();
            p.pirateRelations.addRaw(new PirateRelation(p.empireId, e.empireId, PirateRelationType.None));
            p.pirateRelations.addRaw(new PirateRelation(p.empireId, 250, PirateRelationType.None));
            setPirateRelationEmpires(p, g);
            expect(p.pirateRelations.get(0).thisEmpire).toBe(p);
            expect(p.pirateRelations.get(0).otherEmpire).toBe(e);
            expect(p.pirateRelations.get(1).otherEmpire).toBeNull();
            expect(p.pirateRelations.get(1).otherEmpireId).toBe(-1);
            expect(p.pirateRelations.getRelationByOtherEmpire(e)).toBe(p.pirateRelations.get(0));
        } finally {
            p.pirateRelations = saved;
        }
    });
});

describe('Empire pirate-relation methods', () => {
    it('ObtainPirateRelation / ChangePirateRelation / CheckHaveMetPirates', () => {
        const g = createGame(opts()).galaxy;
        expect(g.age).toBe(0);
        expect(g.pirateEmpires.length).toBeGreaterThan(0);
        const p = g.pirateEmpires[0];
        const e = g.empires[0];
        for (const x of [...g.empires, ...g.pirateEmpires]) expect(x.pirateRelations.count).toBe(0);

        expect(obtainPirateRelation(e, null).type).toBe(PirateRelationType.None);
        const self = obtainPirateRelation(e, e);
        expect(self.type).toBe(PirateRelationType.Protection);
        expect(e.pirateRelations.count).toBe(0);

        const r = obtainPirateRelation(e, p);
        expect(r.type).toBe(PirateRelationType.NotMet);
        expect(r.lastChangeDate).toBe(START_STAR_DATE);
        expect(r.lastProtectionFeePaymentDate).toBe(START_STAR_DATE);
        expect(obtainPirateRelation(e, p)).toBe(r);
        expect(checkHaveMetPirates(e)).toBe(false);

        const draws = countDraws(g, () => changePirateRelation(e, p, PirateRelationType.None, 5000));
        expect(draws).toBe(0);
        const r2 = obtainPirateRelation(p, e);
        for (const x of [r, r2]) {
            expect(x.type).toBe(PirateRelationType.None);
            expect(x.lastChangeDate).toBe(5000);
            expect(x.lastOfferDate).toBe(0); // NotMet → None resets offer/info dates
            expect(x.lastInfoDate).toBe(0);
        }
        expect(checkHaveMetPirates(e)).toBe(true);
        expect(checkHaveMetPirates(p)).toBe(false); // e has no pirate base

        changePirateRelation(p, e, PirateRelationType.Protection, 6000, 123.5);
        expect(r2.type).toBe(PirateRelationType.Protection);
        expect(r.type).toBe(PirateRelationType.Protection);
        expect(r2.lastOfferDate).toBe(6000);
        expect(r2.monthlyProtectionFeeToThisEmpire).toBe(123.5);
        expect(r.monthlyProtectionFeeToThisEmpire).toBe(0);
        changePirateRelation(p, e, PirateRelationType.Protection, 7000); // same type → no-op
        expect(r2.lastChangeDate).toBe(6000);

        changePirateRelation(p, e, PirateRelationType.None, 8000);
        expect(r.type).toBe(PirateRelationType.None);
        expect(r2.lastOfferDate).toBe(8000); // Protection → None: no offer/info reset
        expect(r2.monthlyProtectionFeeToThisEmpire).toBe(0);

        changePirateRelationThisSideOnly(p, e, PirateRelationType.Protection, 9000);
        expect(r2.type).toBe(PirateRelationType.Protection);
        expect(r.type).toBe(PirateRelationType.None);
        expect(r2.lastOfferDate).toBe(9000);

        changePirateEvaluation(p, e, 0.1, PirateRelationEvaluationType.Gifts);
        changePirateEvaluation(p, e, 0.2, PirateRelationEvaluationType.Gifts);
        expect(r2.evaluationGifts).toBe(Math.fround(Math.fround(0.1) + Math.fround(0.2)));

        const e2 = g.empires[1];
        const r3 = addPirateRelation(p, e2, PirateRelationType.Protection, 42);
        expect(r3.type).toBe(PirateRelationType.Protection);
        expect(r3.lastChangeDate).toBe(42);
        expect(addPirateRelation(p, e2, 43)).toBe(r3);
    }, 60000);
});

function runMeet(g: Galaxy, empire2: Empire) {
    const draws = countDraws(g, () => meetPiratesAtStart(g, empire2));
    const met = g.empires.filter((e) => empire2.pirateRelations.getRelationByOtherEmpire(e)?.type === PirateRelationType.None);
    return { draws, met };
}

/** Independent recomputation of which empires the Start.2.cs block must meet without Rnd (sure hits). */
function sureMeet(g: Galaxy, p: Empire, e: Empire): boolean {
    const s = (st: SystemVisibilityStatus) => st === SystemVisibilityStatus.Explored || st === SystemVisibilityStatus.Visible;
    return g.systems.some((sys) => {
        const i = sys.systemStar.systemIndex;
        return s(p.visibility.systemVisibility[i].status) && e.visibility.systemVisibility[i].status === SystemVisibilityStatus.Visible;
    });
}

describe('meetPiratesAtStart (Start.2.cs 1428-1471)', () => {
    it('each generated pirate faction meets normal empires; deterministic', () => {
        const summary = () => {
            const g = createGame(opts()).galaxy;
            return g.pirateEmpires.map((p) => {
                const { draws, met } = runMeet(g, p);
                for (const e of g.empires) {
                    const r = p.pirateRelations.getRelationByOtherEmpire(e);
                    const isMet = met.includes(e);
                    if (sureMeet(g, p, e)) expect(isMet).toBe(true);
                    if (isMet) {
                        expect(obtainPirateRelation(e, p).type).toBe(PirateRelationType.None);
                        expect(e.knownPirateEmpires).toContain(p);
                        expect(r!.lastChangeDate).toBe(START_STAR_DATE);
                        expect(checkHaveMetPirates(e)).toBe(true);
                    } else {
                        expect(e.knownPirateEmpires).not.toContain(p);
                    }
                }
                expect(p.knownPirateEmpires.length).toBe(0); // normal empires have no pirate base
                return { name: p.name, draws, met: met.map((e) => e.name) };
            });
        };
        const a = summary();
        expect(summary()).toEqual(a);
        console.log('[pirateRelations] meet per pirate:', JSON.stringify(a));
    }, 120000);

    it('normal player: block is skipped (no PirateEmpireBaseHabitat), no draws', () => {
        const g = createGame(opts()).galaxy;
        expect(runMeet(g, g.playerEmpire!).draws).toBe(0);
    }, 60000);

    it('play-as-pirate player meets AIs; deterministic', () => {
        const run = () => {
            const g = createGame(opts(true)).galaxy;
            const p = g.playerEmpire!;
            expect(p.pirateEmpireBaseHabitat).not.toBeNull();
            const { draws, met } = runMeet(g, p);
            for (const e of g.empires) if (sureMeet(g, p, e)) expect(met).toContain(e);
            return { draws, met: met.map((e) => e.name), rndAfter: g.rnd.next(1000000) };
        };
        const a = run();
        expect(run()).toEqual(a);
        console.log('[pirateRelations] play-as-pirate meet:', JSON.stringify(a));
    }, 120000);
});
