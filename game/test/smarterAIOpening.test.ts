// Smarter AI pre-warp opening (scenarios/smarter-ai flag smarterAIOpening; src/sim/scenario/smarterAI/opening.ts):
// in a pre-warp start the AI empires queue exactly a small space port, a construction ship and 2 explorers (no
// warships), keep every colony at 0% tax, ask the known pirates for protection and keep it, while the private sector
// builds and moves as usual; at the capital population share taxes rise to the highest rate keeping approval at the
// minimum and the opening ends; in a normal start nothing runs.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { CreateGameOptions } from '../src/sim/game';
import { runGameSeconds } from '../src/sim/tick/harness';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { reviewTaxes, empireApprovalRating } from '../src/sim/taxes';
import { PirateRelationType, obtainPirateRelation } from '../src/sim/pirateRelations';
import { reviewPirateRelations } from '../src/sim/pirates/missionsMarket';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { registerScenarioEvent, scenarioQuery } from '../src/sim/scenario/hooks';
import { isSmarterAIEmpire, smarterAIOpeningHolds, smarterOpeningRecord, type SmarterOpeningState } from '../src/sim/scenario/smarterAI/common';
import { requestOpeningProtection } from '../src/sim/scenario/smarterAI/opening';
import type { BuiltObject } from '../src/sim/builtObject';

const SC = 'smarter-ai';
const preWarp = (o: CreateGameOptions): CreateGameOptions => ({ ...o, galaxyAge: 0, player: { ...o.player, age: 0, techLevel: 0 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 0, techLevel: 0 })) });

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const ais = (g: Galaxy): Empire[] => g.empires.filter((e) => isSmarterAIEmpire(g, e));
const opening = (g: Galaxy): SmarterOpeningState | undefined => g.scenario!.state.smarterAIOpening as SmarterOpeningState | undefined;
const stateSubRoles = (e: Empire): BuiltObjectSubRole[] => (e.builtObjects as BuiltObject[]).map((b) => b.subRole);

/** One pre-warp game run for 1500 s with snapshots of the private sector at 1200 s. */
let run: { game: Game; privAt1200: Map<BuiltObject, { x: number; y: number }>; yardBuilt: BuiltObject[] } | null = null;
function preWarpRun(): NonNullable<typeof run> {
    if (run !== null) return run;
    // Every ship / base a construction yard finishes (state and private).
    const yardBuilt: BuiltObject[] = [];
    const off = registerScenarioEvent({ id: 'test.opening.built', event: 'builtObjectBuilt', flag: 'smarterAI', run: (_g, { builtObject }) => void yardBuilt.push(builtObject) });
    const { game } = createScenarioGame(base, { scenario: SC, options: preWarp });
    runGameSeconds(game, 1200);
    const privAt1200 = new Map<BuiltObject, { x: number; y: number }>();
    for (const e of ais(game.galaxy)) for (const b of e.privateBuiltObjects as BuiltObject[]) if (b.builtAt === null) privAt1200.set(b, { x: b.xpos, y: b.ypos });
    runGameSeconds(game, 300);
    off();
    run = { game, privAt1200, yardBuilt };
    return run;
}

describe('pre-warp opening', () => {
    it('queues exactly the space port, then the construction ship, then 2 explorers, and no warships; taxes stay 0', () => {
        const { game, yardBuilt } = preWarpRun();
        const g = game.galaxy;
        const st = opening(g)!;
        expect(Object.keys(st.empires).length).toBe(ais(g).length);
        for (const e of ais(g)) {
            const r = smarterOpeningRecord(g, e)!;
            expect(r.ended).toBe(false);
            expect(r.queued).toEqual(['port', 'construction', 'explorer', 'explorer']);
            expect(smarterAIOpeningHolds(g, e)).toBe(true);
            const subs = stateSubRoles(e);
            // The state's yards built nothing but the order, and nothing else is under construction for the state.
            const state = new Set(e.builtObjects as BuiltObject[]);
            const stateYardBuilt = yardBuilt.filter((b) => state.has(b)).map((b) => b.subRole);
            expect(stateYardBuilt.sort()).toEqual([BuiltObjectSubRole.SmallSpacePort, BuiltObjectSubRole.ConstructionShip, BuiltObjectSubRole.ExplorationShip, BuiltObjectSubRole.ExplorationShip].sort());
            expect((e.builtObjects as BuiltObject[]).filter((b) => b.builtAt !== null).map((b) => b.subRole)).toEqual([]);
            expect(subs.filter((s) => s === BuiltObjectSubRole.SmallSpacePort).length).toBe(1);
            expect(subs.filter((s) => s === BuiltObjectSubRole.ConstructionShip).length).toBe(1);
            expect(subs.filter((s) => s === BuiltObjectSubRole.ExplorationShip).length).toBe(2);
            // No warship or colony ship from a state yard (an explorer may still find a refugee ship at ruins).
            expect(yardBuilt.some((b) => state.has(b) && (b.role === BuiltObjectRole.Military || b.role === BuiltObjectRole.Colony))).toBe(false);
            for (const h of e.colonies) expect(h.taxRate).toBe(0);
            // The stock review raises the rate; the opening puts it back to 0.
            reviewTaxes(g, e);
            for (const h of e.colonies) expect(h.taxRate).toBe(0);
            expect(scenarioQuery(g, 'stateAIDormant', false, { empire: e })).toBe(true);
            expect(scenarioQuery(g, 'declareWarBlocked', false, { empire: e, target: g.playerEmpire! })).toBe(true);
        }
    }, 1200000);

    it('the private sector builds and moves during the opening', () => {
        const { game, privAt1200 } = preWarpRun();
        const g = game.galaxy;
        let priv = 0;
        for (const e of ais(g)) {
            const own = (e.privateBuiltObjects as BuiltObject[]).filter((b) => b.role === BuiltObjectRole.Freight || b.subRole === BuiltObjectSubRole.MiningShip || b.subRole === BuiltObjectSubRole.GasMiningShip);
            expect(own.length).toBeGreaterThan(0);
            priv += own.length;
        }
        expect(priv).toBeGreaterThan(0);
        let moved = 0;
        for (const [b, p] of privAt1200) if (!b.hasBeenDestroyed && (b.xpos !== p.x || b.ypos !== p.y)) moved++;
        expect(moved).toBeGreaterThan(0);
    }, 1200000);

    it('asks known pirates for protection and keeps it (the cashflow cancel skipped), even in debt', () => {
        const g = preWarpRun().game.galaxy;
        const e = ais(g)[0];
        const pirate = g.pirateEmpires.find((p) => p !== null && p.active && !p.pirateEmpireSuperPirates)!;
        const rel = obtainPirateRelation(e, pirate);
        if (rel.type === PirateRelationType.NotMet) rel.type = PirateRelationType.None; // met
        if (rel.type === PirateRelationType.None) {
            e.stateMoney = Math.max(e.stateMoney, 1e6);
            expect(requestOpeningProtection(g, e)).toContain(pirate);
        }
        expect(obtainPirateRelation(e, pirate).type).toBe(PirateRelationType.Protection);
        expect(scenarioQuery(g, 'pirateProtectionDesired', false, { empire: e, pirate })).toBe(true);
        // Deep in debt with the relation old enough to cancel: the stock review would drop it; the opening keeps it.
        obtainPirateRelation(e, pirate).lastChangeDate = -1e12;
        e.stateMoney = -1e6;
        reviewPirateRelations(g, e, galaxyStarDate(g), 120);
        expect(obtainPirateRelation(e, pirate).type).toBe(PirateRelationType.Protection);
        expect(obtainPirateRelation(pirate, e).type).toBe(PirateRelationType.Protection);
    }, 1200000);
});

describe('the end of the opening', () => {
    it('at the population share taxes rise to the highest rate keeping approval >= 15 and the opening ends', () => {
        const { game } = createScenarioGame(base, { scenario: SC, options: preWarp, params: { smarterAIOpeningPopShare: 1 } });
        const g = game.galaxy;
        runGameSeconds(game, 60);
        for (const e of ais(g)) {
            const r = smarterOpeningRecord(g, e)!;
            expect(r.ended).toBe(true);
            expect(r.endedAtShare).toBe(true);
            expect(smarterAIOpeningHolds(g, e)).toBe(false);
            expect(scenarioQuery(g, 'stateAIDormant', false, { empire: e })).toBe(false);
        }
        // The hand-over rate on a fresh check: the highest whole-percent rate with approval >= 15.
        const { game: g2 } = createScenarioGame(base, { scenario: SC, options: preWarp, params: { smarterAIOpeningPopShare: 1 } });
        const gal = g2.galaxy;
        for (const e of ais(gal)) {
            reviewTaxes(gal, e);
            const h = e.capital!;
            const rate = h.taxRate;
            const approval = empireApprovalRating(gal, h);
            if (rate > 0) expect(approval).toBeGreaterThanOrEqual(15);
            if (rate < 0.5) {
                h.taxRate = Math.fround(Math.round(rate * 100 + 1) / 100);
                expect(empireApprovalRating(gal, h)).toBeLessThan(15);
                h.taxRate = rate;
            }
            expect(smarterOpeningRecord(gal, e)!.ended).toBe(true);
        }
    }, 1200000);
});

describe('other starts', () => {
    it('does nothing outside a pre-warp start', () => {
        const { game } = createScenarioGame(base, { scenario: SC });
        const g = game.galaxy;
        expect(opening(g)?.empires ?? {}).toEqual({});
        for (const e of ais(g)) {
            expect(smarterAIOpeningHolds(g, e)).toBe(false);
            expect(scenarioQuery(g, 'stateAIDormant', false, { empire: e })).toBe(false);
        }
    }, 600000);
});
