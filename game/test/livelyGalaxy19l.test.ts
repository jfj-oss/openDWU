// Task 19l "Livelier mid game" — scenario lively-galaxy: ambitionPressure, borderFriction, smallerInvasions.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGameRun } from './helpers/gameCache';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Habitat } from '../src/sim/types';
import type { BuiltObject } from '../src/sim/builtObject';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateCounts, stateDigest } from '../src/sim/tick/digest';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { DiplomaticRelationType, DiplomaticStrategy, WarObjective, obtainDiplomaticRelation, obtainEmpireEvaluation } from '../src/sim/diplomacy';
import { FleetPosture, determineRelativeStrength, militaryPotency, reviewDiplomaticSituations, reviewDiplomaticStrategies } from '../src/sim/diplomacyTick';
import { takeOwnershipOfColonyFull } from '../src/sim/combat/ownership';
import { ShipGroup, empireShipGroups } from '../src/sim/fleets/shipGroup';
import { shipGroupAddShipToFleet } from '../src/sim/fleets/shipGroupTasks';
import { prepareFleetsForWarCaptureObjectives } from '../src/sim/fleets/militaryAI';
import { SystemVisibilityStatus } from '../src/sim/visibility';
import { Troop, TroopList } from '../src/sim/cargo';
import { EmpireMessageType, empireMessages } from '../src/sim/messages';
import { scenarioEmit, scenarioQuery } from '../src/sim/scenario';
import {
    ambitionState,
    ambitionYearly,
    applyBorderIncident,
    bindBorderIncident,
    borderFrictionYearly,
    borderOverlaps,
    incidentCount,
    unescortedStationsIn,
    type BorderIncidentKind,
} from '../src/sim/scenario/lively/livelyGalaxy';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);


function lively(flags: Record<string, boolean>, params: Record<string, number> = {}): Galaxy {
    return createScenarioGame(base, { scenario: 'lively-galaxy', flags, params }).game.galaxy;
}

function aiEmpires(g: Galaxy): Empire[] {
    return g.empires.filter((e) => e !== null && e.active && e !== g.playerEmpire && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null);
}

function mobileWarships(e: Empire): BuiltObject[] {
    return e.builtObjects.filter((b) => b.role === BuiltObjectRole.Military && !b.hasBeenDestroyed && b.topSpeed > 0);
}

/** The independent colony nearest `e`'s capital. */
function nearestIndependent(g: Galaxy, e: Empire): Habitat {
    const cap = e.capital!;
    const list = g.habitats.filter((h) => h.empire === g.independentEmpire && h.empire !== null);
    list.sort((a, b) => Math.hypot(a.xpos - cap.xpos, a.ypos - cap.ypos) - Math.hypot(b.xpos - cap.xpos, b.ypos - cap.ypos));
    expect(list.length).toBeGreaterThan(0);
    return list[0];
}

/**
 * Forced border: the strongest AI (A) and another AI (B) meet; the independent colony nearest A's capital becomes B's
 * (explored by A). Returns A, B and that colony.
 */
function forcedBorder(g: Galaxy): { a: Empire; b: Empire; colony: Habitat } {
    const ais = aiEmpires(g).sort((x, y) => militaryPotency(y) - militaryPotency(x));
    const a = ais[0];
    const b = ais.find((x) => x !== a && determineRelativeStrength(g, militaryPotency(a), x) >= 0)!;
    expect(b !== undefined).toBe(true);
    const colony = nearestIndependent(g, a);
    takeOwnershipOfColonyFull(g, b, colony, b, false, false);
    expect(colony.empire === b).toBe(true);
    a.visibility.setSystemVisibility(g.systems[colony.systemIndex].systemStar!, SystemVisibilityStatus.Explored);
    obtainDiplomaticRelation(a, b).type = DiplomaticRelationType.None;
    obtainDiplomaticRelation(b, a).type = DiplomaticRelationType.None;
    return { a, b, colony };
}

/** A 4-ship attack fleet of `e` carrying `troopAttack` troop strength (one troop on the lead ship). */
function fourShipTroopFleet(g: Galaxy, e: Empire, troopAttack: number): ShipGroup {
    const ships = mobileWarships(e).slice(0, 4);
    expect(ships.length).toBe(4);
    const sg = new ShipGroup(g);
    sg.empire = e;
    for (const s of ships) {
        s.isAutoControlled = true;
        shipGroupAddShipToFleet(g, sg, s);
    }
    sg.name = 'Test Fleet';
    empireShipGroups(e).push(sg);
    const lead = sg.leadShip!;
    if (lead.troops === null) lead.troops = new TroopList();
    // Troop strengths are shorts (TroopList.TotalAttackStrength = Σ AttackStrength × Readiness 100).
    for (let left = troopAttack; left > 0; left -= 3000000) lead.troops.add(new Troop('Test Troop', 0 as never, 30000, 10, 100, 100, e, e.dominantRace));
    expect(sg.ships.length).toBe(4);
    return sg;
}

/** `n` one-ship Defend fleets of `e` at its capital (from warships not yet in a fleet). */
function singleShipDefendFleets(g: Galaxy, e: Empire, n: number): void {
    const free = mobileWarships(e).filter((s) => s.shipGroup === null);
    expect(free.length).toBeGreaterThanOrEqual(n);
    for (let i = 0; i < n; i++) {
        const sg = new ShipGroup(g);
        sg.empire = e;
        free[i].isAutoControlled = true;
        shipGroupAddShipToFleet(g, sg, free[i]);
        sg.posture = FleetPosture.Defend;
        sg.gatherPoint = e.capital;
        empireShipGroups(e).push(sg);
    }
}

/** A's goodwill toward B in the war test: attitude +5, num6 -6.7 above the stock num9 -13.2 (aggression 76). */
const GOODWILL = 30;

describe('19l ambitionPressure', () => {
    it('ambition rises with idle warships and peace, the empire grows restless, and falls with war and loss', () => {
        const g = lively({ ambitionPressure: true }, { ambitionRise: 2, ambitionShipsRef: 1, ambitionThreshold: 5 });
        const e = aiEmpires(g).find((x) => mobileWarships(x).length > 0)!;
        ambitionYearly(g);
        const a1 = ambitionState(g)[String(e.empireId)].ambition;
        expect(a1).toBeGreaterThan(0);
        ambitionYearly(g);
        const a2 = ambitionState(g)[String(e.empireId)].ambition;
        expect(a2).toBeGreaterThan(a1); // grows faster the longer the peace lasts
        expect(ambitionState(g)[String(e.empireId)].restless).toBe(true);
        expect(empireMessages(e).some((m) => m.messageType === EmpireMessageType.GeneralWarning && m.description.includes('restless'))).toBe(true);
        const other = aiEmpires(g).find((x) => x !== e)!;
        expect(empireMessages(other).some((m) => m.messageType === EmpireMessageType.GalacticNewsNet && m.description.includes(e.name))).toBe(true);
        // The relaxation reaches the war review's query.
        expect(scenarioQuery(g, 'warReviewAttitudeRelax', 0, { empire: e, other })).toBeCloseTo(a2 * 0.6);
        // A war spends ambition (once per war, however many times the change is reported).
        scenarioEmit(g, 'diplomaticRelationChanged', { empire: e, other, from: DiplomaticRelationType.None, to: DiplomaticRelationType.War });
        scenarioEmit(g, 'diplomaticRelationChanged', { empire: other, other: e, from: DiplomaticRelationType.None, to: DiplomaticRelationType.War });
        const a3 = ambitionState(g)[String(e.empireId)].ambition;
        expect(a3).toBeCloseTo(Math.max(0, a2 - 6));
        expect(ambitionState(g)[String(e.empireId)].yearsSinceWar).toBe(0);
        // A colony lost spends ambition too.
        ambitionState(g)[String(e.empireId)].ambition = 10;
        scenarioEmit(g, 'colonyOwnerChanged', { colony: e.capital!, from: e, to: other });
        expect(ambitionState(g)[String(e.empireId)].ambition).toBeCloseTo(8);
    }, 120000);

    it('the relaxed war-review gate (Empire.8.cs 100/139) turns a peaceful strong AI to Conquer, and the war follows', () => {
        const run = (ambition: number) => {
            const g = lively({ ambitionPressure: true, smallerInvasions: true }, { ambitionWarFactor: 1, ambitionThreshold: 5, invasionMinShips: 4, invasionWeakTroops: 1e9, invasionTroopRatio: 0.35 });
            const { a, b, colony } = forcedBorder(g);
            // Only B is met, so the one-Conquer-at-a-time rule (Empire.8.cs 283) cannot pick another target.
            for (let i = 0; i < a.diplomaticRelations.count; i++) {
                const r = a.diplomaticRelations.at(i);
                if (r.otherEmpire !== b) r.type = DiplomaticRelationType.NotMet;
            }
            const sg = fourShipTroopFleet(g, a, 1e7);
            // The stock defence quota (SetDefendFleets, Empire.9.cs: ~75% of the < 10-ship fleets defend) is already met,
            // as in a mid-game empire, so the attack fleet keeps its Attack posture.
            singleShipDefendFleets(g, a, 3);
            // A peaceful stance toward B: goodwill that keeps the stock review off Conquer (num6 above num9).
            obtainEmpireEvaluation(g, a, b).incidentEvaluation = GOODWILL;
            ambitionState(g)[String(a.empireId)] = { ambition, yearsSinceWar: 5, restless: ambition >= 5, lastWarDrop: -1 };
            reviewDiplomaticStrategies(g, a);
            return { g, a, b, colony, sg, rel: obtainDiplomaticRelation(a, b) };
        };
        const calm = run(0);
        expect(calm.rel.strategy).toBe(DiplomaticStrategy.Undefined); // stock gate: no fight
        expect(calm.sg.attackPoint === null).toBe(true);

        const restless = run(20);
        expect(restless.rel.strategy).toBe(DiplomaticStrategy.Conquer);
        expect(restless.rel.warObjective).toBe(WarObjective.CaptureObjectives);
        expect(restless.rel.warObjectiveColonies.includes(restless.colony)).toBe(true);
        expect(restless.sg.attackPoint === restless.colony).toBe(true); // 4-ship troop fleet prepared (smallerInvasions)
        // The fleet reaches its gather point refuelled; the next situation review declares war (Empire.8.cs 1451 → 1515).
        const { g, a, b, sg } = restless;
        sg.mission = null;
        for (const s of sg.ships) {
            s.mission = null;
            s.xpos = sg.gatherPoint!.xpos;
            s.ypos = sg.gatherPoint!.ypos;
        }
        reviewDiplomaticSituations(g, a);
        expect(obtainDiplomaticRelation(a, b).type).toBe(DiplomaticRelationType.War);
        // The new war spent A's ambition.
        expect(ambitionState(g)[String(a.empireId)].ambition).toBeCloseTo(14);
    }, 120000);
});

describe('19l borderFriction', () => {
    it('a forced overlap rolls incidents that lower relations, count toward the war review, and can seize an unescorted station', () => {
        const g = lively({ borderFriction: true }, { frictionChance: 1, frictionMaxChance: 1, frictionOverlapRef: 1, incidentRelationDrop: 4, incidentWarFactor: 1.5 });
        const { a, b, colony } = forcedBorder(g);
        const pair = borderOverlaps(g).find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
        expect(pair !== undefined).toBe(true);
        expect(pair!.cells.size).toBeGreaterThan(0);

        const bound: { a: Empire; b: Empire; kind: BorderIncidentKind; severity: number }[] = [];
        const prev = bindBorderIncident((_g, x, y, kind, severity) => bound.push({ a: x, b: y, kind, severity }));
        try {
            // Put one of B's mining stations, unescorted, inside the overlap.
            const station = b.miningStations.find((s) => !s.hasBeenDestroyed)!;
            expect(station !== undefined).toBe(true);
            station.xpos = colony.xpos + 1000;
            station.ypos = colony.ypos + 1000;
            for (const w of b.builtObjects) {
                if (w.role === BuiltObjectRole.Military && Math.hypot(w.xpos - station.xpos, w.ypos - station.ypos) < g.maxSolarSystemSize * 2) {
                    w.xpos = b.capital!.xpos;
                    w.ypos = b.capital!.ypos;
                }
            }
            const cells = borderOverlaps(g).find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a))!.cells;
            expect(unescortedStationsIn(g, b, cells).includes(station)).toBe(true);

            // One yearly pass: chance 1 → an incident for the pair; relations drop, the victim is told, the hook is called.
            const evBA = obtainEmpireEvaluation(g, b, a).incidentEvaluation;
            const evAB = obtainEmpireEvaluation(g, a, b).incidentEvaluation;
            borderFrictionYearly(g);
            const mine = bound.filter((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
            expect(mine.length).toBe(1);
            const victim = mine[0].b;
            const aggressor = mine[0].a;
            const dropV = (victim === b ? evBA : evAB) - obtainEmpireEvaluation(g, victim, aggressor).incidentEvaluation;
            expect(dropV).toBeCloseTo(4 * mine[0].severity);
            expect(empireMessages(victim).some((m) => m.title === 'Border Incident')).toBe(true);
            expect(incidentCount(g, victim, aggressor)).toBe(1);
            // The victim's war review counts it (same query as ambition).
            expect(scenarioQuery(g, 'warReviewAttitudeRelax', 0, { empire: victim, other: aggressor })).toBeCloseTo(1.5);

            // A seizure hands the station to A through TakeOwnershipOfBuiltObject.
            const seized = applyBorderIncident(g, a, b, 'seizure', station);
            expect(seized === station).toBe(true);
            expect(station.empire === a).toBe(true);
            expect(a.miningStations.includes(station)).toBe(true);
            expect(b.miningStations.includes(station)).toBe(false);
            expect(empireMessages(b).some((m) => m.description.includes(station.name) && m.messageType === EmpireMessageType.GeneralBadEvent)).toBe(true);
            const last = bound[bound.length - 1];
            expect(last.a === a && last.b === b && last.kind === 'seizure' && last.severity === 2).toBe(true);
        } finally {
            bindBorderIncident(prev);
        }
    }, 120000);
});

describe('19l smallerInvasions', () => {
    it('a 4-ship troop fleet is prepared against a weak colony only with the smaller-invasion rule', () => {
        const run = (flags: Record<string, boolean>, params: Record<string, number>) => {
            const g = lively(flags, params);
            const { a, b, colony } = forcedBorder(g);
            const sg = fourShipTroopFleet(g, a, 1e7);
            const rel = obtainDiplomaticRelation(a, b);
            rel.warObjective = WarObjective.CaptureObjectives;
            rel.warObjectiveColonies = [colony];
            rel.warObjectiveBases = [];
            const n = prepareFleetsForWarCaptureObjectives(g, a, b);
            return { n, sg, colony };
        };
        // Stock rule (flag off, or param 0): ≥ 10 ships (Empire.8.cs 1049).
        expect(run({ smallerInvasions: false }, { invasionMinShips: 4, invasionWeakTroops: 1e9 }).n).toBe(0);
        expect(run({ smallerInvasions: true }, { invasionMinShips: 0, invasionWeakTroops: 1e9 }).n).toBe(0);
        // Target too strong for the smaller rule.
        expect(run({ smallerInvasions: true }, { invasionMinShips: 4, invasionWeakTroops: 0 }).n).toBe(0);
        // Weak target: the 4-ship fleet is prepared (gather point, attack point, refuel mission).
        const ok = run({ smallerInvasions: true }, { invasionMinShips: 4, invasionWeakTroops: 1e9 });
        expect(ok.n).toBe(1);
        expect(ok.sg.attackPoint === ok.colony).toBe(true);
        expect(ok.sg.gatherPoint !== null).toBe(true);
    }, 120000);
});

describe('19l flags off', () => {
    it('lively-galaxy with every flag off gives the same seed-1 game and 600 s run as no scenario', () => {
        const ref = cachedTickGameRun(base, { seconds: 600 });
        const { game } = createScenarioGame(base, {
            scenario: 'lively-galaxy',
            flags: { ambitionPressure: false, borderFriction: false, smallerInvasions: false, pirateAmbition: false, livingCalendar: false },
        });
        expect(game.galaxy.scenario?.id).toBe('lively-galaxy');
        const run = runGameSeconds(game, 600);
        expect(stateDigest(game.galaxy)).toBe(stateDigest(ref.game.galaxy));
        expect(stateCounts(game.galaxy)).toEqual(stateCounts(ref.game.galaxy));
        expect(run.rndDraws).toBe(ref.run.rndDraws);
        expect(game.galaxy.scenario!.state).toEqual({});
    }, 2400000);

    it('the manifest defaults: ambition and friction on, smaller invasions off (param 0 = stock)', () => {
        const g = lively({});
        expect(g.scenario!.flags).toEqual({ ambitionPressure: true, borderFriction: true, smallerInvasions: false, pirateAmbition: true, livingCalendar: true });
        expect(g.scenario!.params.invasionMinShips).toBe(0);
    }, 120000);
});
