// M4s1 — pirate mission marketplace (tasks/M4-plan.md §3.3 M4s, s1 part): EmpireActivity lists, PirateEconomy,
// offers / bids / assignment / completion, ReviewPirateRelations, plus a harness smoke test.
// Expected values are worked by hand from the C# (Empire.2.cs 1138-2146, Galaxy.9.cs 527, Empire.4.cs 1543,
// PirateEconomy.cs).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Habitat } from '../src/sim/types';
import type { BuiltObject } from '../src/sim/builtObject';
import { runGameSeconds } from '../src/sim/tick/harness';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { START_STAR_DATE, YEAR_LENGTH } from '../src/sim/galaxyTime';
import { Random } from '../src/sim/random';
import { galaxyResourceCurrentPrices } from '../src/sim/design';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectMissionType } from '../src/sim/missions/mission';
import { EmpireMessageType, empireMessages } from '../src/sim/messages';
import { ShipGroup } from '../src/sim/fleets/shipGroup';
import { isObjectVisibleToThisEmpire } from '../src/sim/independentTraders';
import { estimatedDefensiveForceRequired } from '../src/sim/troops';
import {
    MISSION_TYPE_ATTACK,
    MISSION_TYPE_BOMBARD,
    MISSION_TYPE_CAPTURE,
    MISSION_TYPE_MOVE_AND_WAIT,
    MISSION_TYPE_RAID,
    MISSION_TYPE_WAIT_AND_ATTACK,
    MISSION_TYPE_WAIT_AND_BOMBARD,
    PirateRelationType,
    cancelPirateDefendMissions,
    obtainPirateRelation,
} from '../src/sim/pirateRelations';
import { PirateEconomy, PirateExpenseType, PirateIncomeType, calculateStartOfYear } from '../src/sim/pirates/pirateEconomy';
import { EmpireActivity, EmpireActivityList, EmpireActivityType } from '../src/sim/pirates/empireActivity';
import { pirateEconomyPerformExpense, pirateEconomyPerformIncome } from '../src/sim/pirates/pirateAI';
import { reviewPirateEmpireActivities } from '../src/sim/pirates/pirateGalaxyTick';
import { Order } from '../src/sim/logistics/orders';
import { ResourceRef } from '../src/sim/cargo';
import {
    calculatePirateAttackPrice,
    calculatePirateDefendPrice,
    calculatePirateMissionPriceWillingToBidFor,
    calculatePirateSmugglePricePerUnit,
    completePirateMission,
    countIdleFreighters,
    independentColoniesMakeDefendOffersToPirates,
    isObjectAreaKnownToThisEmpire,
    pirateCheckMissionsOnOffer,
    resolvePirateMissionsByType,
    reviewPirateDefendMissions,
    reviewPirateMissionsAndAssign,
    reviewPirateRelations,
    totalMobileMilitaryFirepowerNotAttackingDefending,
} from '../src/sim/pirates/missionsMarket';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

/** A seed-1 tick galaxy with every mission list emptied (game start may already have posted offers). */
function freshGalaxy(): Galaxy {
    const g = createTickGame(gameData).galaxy;
    g.pirateMissions.items.length = 0;
    for (const e of [...g.empires, ...g.pirateEmpires, g.independentEmpire!]) e.pirateMissions.items.length = 0;
    return g;
}

function liveIndependentColonies(g: Galaxy): Habitat[] {
    return g.independentColonies.filter((h) => h != null && !h.hasBeenDestroyed && h.empire === g.independentEmpire);
}

describe('PirateEconomy (PirateEconomy.cs, PirateEconomyYear.cs)', () => {
    it('books income / expenses by type and switches years (CheckSwitchYears)', () => {
        const d0 = START_STAR_DATE + 12345;
        const pe = new PirateEconomy(d0);
        expect(pe.thisYear.yearStartDate).toBe(calculateStartOfYear(d0));
        expect(calculateStartOfYear(d0)).toBe(d0 - (d0 % YEAR_LENGTH));
        pe.performIncome(100, PirateIncomeType.Missions, d0);
        pe.performIncome(40, PirateIncomeType.ProtectionAgreement, d0);
        pe.performIncome(1, PirateIncomeType.Undefined, d0);
        pe.performExpense(30, PirateExpenseType.ShipMaintenance, d0);
        pe.performExpense(5, PirateExpenseType.Undefined, d0);
        expect(pe.thisYear.missionIncome).toBe(100);
        expect(pe.thisYear.otherIncome).toBe(1);
        expect(pe.thisYear.totalIncome).toBe(141);
        expect(pe.thisYear.stableIncome).toBe(40);
        expect(pe.thisYear.bonusIncome).toBe(101);
        expect(pe.thisYear.totalExpenses).toBe(35);
        expect(pe.thisYear.stableCashflow).toBe(10);
        expect(pe.lastYear).toBeNull();
        // Next year: the old year becomes LastYear.
        const first = pe.thisYear;
        pe.performIncome(7, PirateIncomeType.Smuggling, d0 + YEAR_LENGTH);
        expect(pe.lastYear).toBe(first);
        expect(pe.thisYear.smugglingIncome).toBe(7);
        expect(pe.thisYear.totalIncome).toBe(7);
        // A gap of more than a year drops LastYear (num > YearLength).
        pe.performExpense(2, PirateExpenseType.Fuel, d0 + 3 * YEAR_LENGTH);
        expect(pe.lastYear).toBeNull();
        expect(pe.thisYear.fuelExpenses).toBe(2);
    });

    it('the PerformIncome / PerformExpense entry points (called by M4d / M4j / M4k) book into Empire.PirateEconomy', () => {
        const g = freshGalaxy();
        const p = g.pirateEmpires[0];
        const sd = galaxyStarDate(g);
        const before = p.pirateEconomy.thisYear.miningIncome;
        pirateEconomyPerformIncome(g, p, 250, PirateIncomeType.Mining, sd);
        pirateEconomyPerformExpense(g, p, 20, PirateExpenseType.PurchaseResources, sd);
        expect(p.pirateEconomy.thisYear.miningIncome).toBe(before + 250);
        expect(p.pirateEconomy.thisYear.purchaseResourcesExpenses).toBeGreaterThanOrEqual(20);
    });
});

describe('EmpireActivityList (EmpireActivityList.cs)', () => {
    it('equivalence, removal, costs and assigned / unassigned views', () => {
        const g = freshGalaxy();
        const e = g.empires[0];
        const h1 = e.capital!;
        const h2 = liveIndependentColonies(g)[0];
        const list = new EmpireActivityList();
        const a = new EmpireActivity(e, e, 10, EmpireActivityType.Defend, h1, 5000);
        const b = new EmpireActivity(e, e, 10, EmpireActivityType.Defend, h1, 7000); // equivalent target/type
        const c = new EmpireActivity(g.independentEmpire, e, 10, EmpireActivityType.Attack, h2, 900);
        const s = new EmpireActivity(e, e, 10, EmpireActivityType.Smuggle, h1, 1);
        list.add(a);
        list.add(b);
        list.add(c);
        list.add(s);
        expect(list.containsEquivalentTarget(h1, EmpireActivityType.Defend)).toBe(true);
        expect(list.containsEquivalentTarget(h2, EmpireActivityType.Defend)).toBe(false);
        expect(list.calculateTotalDefendCosts(e)).toBe(12000);
        c.assignedEmpire = e; // assigned to the requester: excluded from the attack costs
        expect(list.calculateTotalAttackCosts(e)).toBe(0);
        expect(list.resolveAttackTargettedEmpires()).toEqual([g.independentEmpire]);
        a.assignedEmpire = g.pirateEmpires[0];
        a.bidTimeRemaining = 0;
        // a: assigned + bidding over; c: assigned but BidTimeRemaining -1; s: Smuggle (always).
        expect(list.resolveAssigned().items).toEqual([a, s]);
        expect(list.resolveUnassigned().items).toContain(b);
        expect(list.resolveUnassigned().items).toContain(s); // Smuggle is in both views
        list.removeEquivalent(a); // removes every Defend on h1
        expect(list.items).toEqual([c, s]);
        expect(list.countByType(EmpireActivityType.Smuggle)).toBe(1);
    });
});

describe('ReviewPirateMissionsAndAssign / CompletePirateMission', () => {
    it('counts the bid timer down, moves the mission to the winning faction, and drops expired unbid offers', () => {
        const g = freshGalaxy();
        const indep = g.independentEmpire!;
        const p = g.pirateEmpires[0];
        const h = liveIndependentColonies(g)[0];
        const sd = galaxyStarDate(g);
        const a = new EmpireActivity(indep, indep, sd + 1000, EmpireActivityType.Defend, h, 5000);
        a.assignedEmpire = p;
        a.bidTimeRemaining = 60000;
        g.pirateMissions.add(a);
        indep.pirateMissions.add(a);
        const b = new EmpireActivity(indep, indep, sd - 1, EmpireActivityType.Defend, liveIndependentColonies(g)[1], 5000);
        g.pirateMissions.add(b);
        indep.pirateMissions.add(b);
        const draws = g.rnd.drawCount;
        reviewPirateMissionsAndAssign(g, sd, 30.0004); // (long)(30000.4) = 30000
        expect(a.bidTimeRemaining).toBe(30000);
        expect(g.pirateMissions.contains(a)).toBe(true);
        expect(g.pirateMissions.contains(b)).toBe(false); // expired, unassigned: removed everywhere
        expect(indep.pirateMissions.contains(b)).toBe(false);
        reviewPirateMissionsAndAssign(g, sd + 5, 31);
        expect(a.bidTimeRemaining).toBe(0);
        expect(a.expiryDate).toBe(sd + 5 + 1200000); // starDate + 2 years
        expect(p.pirateMissions.contains(a)).toBe(true);
        expect(g.pirateMissions.contains(a)).toBe(false);
        expect(indep.pirateMissions.contains(a)).toBe(true);
        expect(g.rnd.drawCount).toBe(draws);
    });

    it('CompletePirateMission pays the faction, +10 PirateMissionsSucceed, books Missions income and counters', () => {
        const g = freshGalaxy();
        const e = g.empires[0];
        const p = g.pirateEmpires[0];
        e.stateMoney = 10000;
        p.stateMoney = 0;
        const m = new EmpireActivity(e, e, 0, EmpireActivityType.Defend, e.capital!, 3000);
        m.assignedEmpire = p;
        m.bidTimeRemaining = 0;
        e.pirateMissions.add(m);
        p.pirateMissions.add(m);
        const inc = p.pirateEconomy.thisYear.missionIncome;
        const ev = obtainPirateRelation(e, p).evaluationPirateMissionsSucceed;
        completePirateMission(g, p, m);
        expect(e.stateMoney).toBe(7000);
        expect(p.stateMoney).toBe(3000);
        expect(p.pirateEconomy.thisYear.missionIncome).toBe(inc + 3000);
        expect(p.counters.completedPirateMissionDefendCount).toBe(1);
        expect(obtainPirateRelation(e, p).evaluationPirateMissionsSucceed).toBe(ev + 10);
        expect(e.pirateMissions.contains(m)).toBe(false);
        expect(p.pirateMissions.contains(m)).toBe(false);
        expect(empireMessages(p).some((x) => x.messageType === EmpireMessageType.PirateDefendMissionCompleted)).toBe(true);
        expect(empireMessages(e).some((x) => x.messageType === EmpireMessageType.PirateDefendMissionCompleted)).toBe(true);
    });
});

describe('prices (Empire.2.cs 2224-2293)', () => {
    it('defend / attack / smuggle prices and the target-seeded bid price', () => {
        const g = freshGalaxy();
        const e = g.empires[0];
        const bo = e.builtObjects.find((b) => b != null && !b.hasBeenDestroyed) as BuiltObject;
        const saved = { size: bo.size, fp: bo.firepowerRaw, esc: bo.currentEscortForceAssigned };
        bo.size = 500;
        bo.firepowerRaw = 0;
        // num = 500/10 = 50; max(5, 50 - 0) * 200 = 10000 → clamped to 8000.
        expect(calculatePirateDefendPrice(g, e, bo)).toBe(8000);
        bo.size = 30; // num = 3 → max(5, 3) = 5 → 1000
        expect(calculatePirateDefendPrice(g, e, bo)).toBe(1000);
        bo.size = 500;
        bo.firepowerRaw = 10;
        bo.currentEscortForceAssigned = 5;
        // visible: 100 * max(10 + 5, 500 * 0.1); not visible: 100 * max(10, 50) — 5000 either way here.
        expect(calculatePirateAttackPrice(g, e, bo)).toBe(5000);
        bo.firepowerRaw = 70;
        expect(calculatePirateAttackPrice(g, e, bo)).toBe(isObjectVisibleToThisEmpire(g, e, bo) ? 7500 : 7000);
        expect(calculatePirateAttackPrice(g, e, e.capital!)).toBe(Number.MAX_VALUE);
        // Habitat defend price: 200 * EstimatedDefensiveForceRequired, clamped to [5000, 30000] (0 when the force is 0).
        const cap = e.capital!;
        const force = estimatedDefensiveForceRequired(g, cap, false, g.difficultyLevel);
        expect(calculatePirateDefendPrice(g, e, cap)).toBe(force > 0 ? Math.max(5000, Math.min(30000, 200 * force)) : 0);
        const price = galaxyResourceCurrentPrices(g)[3];
        expect(calculatePirateSmugglePricePerUnit(g, e, cap, 3)).toBe(Math.min(5.0, Math.max(0.1, price * 0.5)));
        // Bid price: num * 0.4 + new Random((int)Target.Xpos + EmpireId).NextDouble() * num * 0.35, num = the defend price.
        const m = new EmpireActivity(e, e, 0, EmpireActivityType.Defend, bo, 8000);
        const r = new Random((Math.trunc(bo.xpos) + g.pirateEmpires[0].empireId) | 0).nextDouble();
        const num = calculatePirateDefendPrice(g, g.pirateEmpires[0], bo);
        const draws = g.rnd.drawCount;
        expect(calculatePirateMissionPriceWillingToBidFor(g, g.pirateEmpires[0], m)).toBe(num * 0.4 + r * num * 0.35);
        expect(g.rnd.drawCount).toBe(draws); // not Galaxy.Rnd
        bo.size = saved.size;
        bo.firepowerRaw = saved.fp;
        bo.currentEscortForceAssigned = saved.esc;
    });
});

describe('offers and bids', () => {
    it('IndependentColoniesMakeDefendOffersToPirates draws Rnd.Next(0, 30) once per live independent colony', () => {
        const g = freshGalaxy();
        const n = liveIndependentColonies(g).length;
        expect(n).toBeGreaterThan(0);
        const draws = g.rnd.drawCount;
        independentColoniesMakeDefendOffersToPirates(g, galaxyStarDate(g));
        expect(g.rnd.drawCount - draws).toBe(n);
        // Every posted offer is a Defend of an independent colony, in both the galaxy and the independent lists.
        for (const a of g.pirateMissions.items) {
            expect(a!.type).toBe(EmpireActivityType.Defend);
            expect(a!.requestingEmpire).toBe(g.independentEmpire);
            expect(g.independentEmpire!.pirateMissions.contains(a)).toBe(true);
            expect(a!.expiryDate).toBe(galaxyStarDate(g) + 600000);
        }
    });

    it('a faction with an idle freighter accepts a known "any resource" smuggling offer (no Rnd)', () => {
        const g = freshGalaxy();
        let pair: { p: Empire; h: Habitat } | null = null;
        for (const p of g.pirateEmpires) {
            if (countIdleFreighters(p) <= 0) continue;
            const h = liveIndependentColonies(g).find((x) => isObjectAreaKnownToThisEmpire(g, p, x));
            if (h !== undefined) {
                pair = { p, h };
                break;
            }
        }
        expect(pair).not.toBeNull();
        const { p, h } = pair!;
        const indep = g.independentEmpire!;
        const a = new EmpireActivity(indep, indep, galaxyStarDate(g) + 100000, EmpireActivityType.Smuggle, h, 2.5);
        g.pirateMissions.add(a);
        indep.pirateMissions.add(a);
        const draws = g.rnd.drawCount;
        pirateCheckMissionsOnOffer(g, p, galaxyStarDate(g));
        expect(p.pirateMissions.contains(a)).toBe(true);
        expect(resolvePirateMissionsByType(g, p, EmpireActivityType.Smuggle)).toEqual([a]);
        expect(g.pirateMissions.contains(a)).toBe(true); // smuggling offers stay open for other factions
        expect(g.rnd.drawCount).toBe(draws);
    });

    it('Defend lifecycle: bid (fleet + strength), assignment after the bid timer, completion at expiry pays the faction', () => {
        const g = freshGalaxy();
        const indep = g.independentEmpire!;
        const p = g.pirateEmpires.find((x) => x.pirateEmpireBaseHabitat !== null)!;
        const base = p.pirateEmpireBaseHabitat!;
        // The nearest live independent colony to the pirate base.
        const colonies = liveIndependentColonies(g).sort((x, y) => g.calculateDistance(x.xpos, x.ypos, base.xpos, base.ypos) - g.calculateDistance(y.xpos, y.ypos, base.xpos, base.ypos));
        const h = colonies[0];
        const range = Math.max(g.sectorSize * 2.0, g.sizeX * 0.2);
        expect(g.calculateDistance(base.xpos, base.ypos, h.xpos, h.ypos)).toBeLessThan(range);
        // A fleet and enough mobile firepower (PirateCheckAcceptDefendMission).
        p.shipGroups.push(new ShipGroup(g));
        const warship = p.builtObjects.find((b) => b != null && !b.hasBeenDestroyed) as BuiltObject;
        warship.role = BuiltObjectRole.Military;
        warship.topSpeed = 100;
        warship.unbuiltComponentCount = 0;
        warship.firepowerRaw = 1000000;
        warship.mission = null;
        expect(totalMobileMilitaryFirepowerNotAttackingDefending(p.builtObjects).firepower).toBeGreaterThanOrEqual(1000000);
        const sd = galaxyStarDate(g);
        const price = calculatePirateDefendPrice(g, indep, h);
        const a = new EmpireActivity(indep, indep, sd + 600000, EmpireActivityType.Defend, h, price);
        g.pirateMissions.add(a);
        indep.pirateMissions.add(a);
        pirateCheckMissionsOnOffer(g, p, sd);
        // Willing price <= 0.75 * price < 0.9 * price, so the bid is always placed; first bid: 60 s timer, price unchanged.
        expect(a.assignedEmpire).toBe(p);
        expect(a.bidTimeRemaining).toBe(60000);
        expect(a.price).toBe(price);
        reviewPirateMissionsAndAssign(g, sd, 60);
        expect(p.pirateMissions.contains(a)).toBe(true);
        expect(a.expiryDate).toBe(sd + 1200000);
        // At expiry the requesting (independent) empire's review completes it: the colony is still theirs.
        indep.stateMoney = 1e6;
        const pirateMoney = p.stateMoney;
        reviewPirateDefendMissions(g, indep, a.expiryDate);
        expect(p.stateMoney).toBe(pirateMoney + price);
        expect(indep.stateMoney).toBe(1e6 - price);
        expect(p.pirateMissions.contains(a)).toBe(false);
        expect(indep.pirateMissions.contains(a)).toBe(false);
    });

    it('CancelPirateDefendMissions releases an open bid (+10 s, unassigned); mission-type constants match the enum', () => {
        expect([MISSION_TYPE_ATTACK, MISSION_TYPE_WAIT_AND_ATTACK, MISSION_TYPE_WAIT_AND_BOMBARD, MISSION_TYPE_MOVE_AND_WAIT, MISSION_TYPE_BOMBARD, MISSION_TYPE_CAPTURE, MISSION_TYPE_RAID]).toEqual([
            BuiltObjectMissionType.Attack,
            BuiltObjectMissionType.WaitAndAttack,
            BuiltObjectMissionType.WaitAndBombard,
            BuiltObjectMissionType.MoveAndWait,
            BuiltObjectMissionType.Bombard,
            BuiltObjectMissionType.Capture,
            BuiltObjectMissionType.Raid,
        ]);
        const g = freshGalaxy();
        const e = g.empires[0];
        const p = g.pirateEmpires[0];
        const a = new EmpireActivity(e, e, galaxyStarDate(g) + 1, EmpireActivityType.Defend, e.capital!, 5000);
        a.assignedEmpire = p;
        a.bidTimeRemaining = 5000;
        g.pirateMissions.add(a);
        e.pirateMissions.add(a);
        cancelPirateDefendMissions(p, e, true);
        expect(a.assignedEmpire).toBeNull();
        expect(a.bidTimeRemaining).toBe(15000);
    });
});

describe('ReviewPirateEmpireActivities (Galaxy.8.cs 3398)', () => {
    it('expires accepted Smuggle (order expired, removed everywhere) and failed Attack missions (-15 PirateMissionsFail)', () => {
        const g = freshGalaxy();
        const e = g.empires[0];
        const p = g.pirateEmpires[0];
        const sd = galaxyStarDate(g);
        const order = new Order(g, e.capital!, new ResourceRef(3), 1000, sd + 1e9, 0);
        const smug = new EmpireActivity(e, e, sd - 1, EmpireActivityType.Smuggle, e.capital!, 1.5);
        smug.resourceId = 3;
        smug.relatedOrder = order;
        const target = g.empires[1].builtObjects.find((b) => b != null && !b.hasBeenDestroyed)!;
        const atk = new EmpireActivity(g.empires[1], e, sd - 1, EmpireActivityType.Attack, target, 4000);
        atk.assignedEmpire = p;
        const live = new EmpireActivity(e, e, sd + 1000, EmpireActivityType.Smuggle, g.empires[0].capital!, 1.5);
        for (const a of [smug, atk]) {
            p.pirateMissions.add(a);
            e.pirateMissions.add(a);
            g.pirateMissions.add(a);
        }
        p.pirateMissions.add(live);
        const fail = obtainPirateRelation(e, p).evaluationPirateMissionsFail;
        const draws = g.rnd.drawCount;
        reviewPirateEmpireActivities(g);
        expect(order.expiryDate).toBe(sd);
        expect(obtainPirateRelation(e, p).evaluationPirateMissionsFail).toBe(fail - 15);
        expect(p.pirateMissions.items).toEqual([live]);
        expect(e.pirateMissions.count).toBe(0); // the requester's copies (RemoveEquivalent)
        expect(g.pirateMissions.count).toBe(0);
        expect(empireMessages(e).some((m) => m.messageType === EmpireMessageType.PirateSmugglingMissionCompleted)).toBe(true);
        expect(empireMessages(e).some((m) => m.messageType === EmpireMessageType.PirateAttackMissionFailed)).toBe(true);
        expect(g.rnd.drawCount).toBe(draws);
    });
});

describe('ReviewPirateRelations (Empire.2.cs 2401)', () => {
    it('draws one Rnd.NextDouble and removes relations with inactive factions', () => {
        const g = freshGalaxy();
        const e = g.empires[0];
        const p = g.pirateEmpires[0];
        const r = obtainPirateRelation(e, p);
        r.type = PirateRelationType.None;
        p.active = false;
        const draws = g.rnd.drawCount;
        reviewPirateRelations(g, e, galaxyStarDate(g), 120);
        expect(g.rnd.drawCount - draws).toBe(1);
        expect(e.pirateRelations.getRelationByOtherEmpire(p)).toBeNull();
    });
});

describe('harness smoke (seed 1, 480 game-s)', () => {
    it('independents post Defend / Smuggle offers, and a faction accepts one', () => {
        const g = createTickGame(gameData).galaxy;
        runGameSeconds(g, 480);
        const offers = g.pirateMissions.items;
        expect(offers.some((a) => a!.type === EmpireActivityType.Defend && a!.requestingEmpire === g.independentEmpire)).toBe(true);
        expect(offers.some((a) => a!.type === EmpireActivityType.Smuggle && a!.requestingEmpire === g.independentEmpire)).toBe(true);
        // Independent smuggling offers carry a related state order at the colony.
        for (const a of offers) if (a!.type === EmpireActivityType.Smuggle) expect(g.orders.contains(a!.relatedOrder!)).toBe(true);
        expect(g.pirateEmpires.some((p) => p.pirateMissions.count > 0)).toBe(true);
    }, 300000);
});
