// M4q — ground invasion, troops, boarding, capture: unit tests against hand-worked C# expectations (Habitat.cs 4978
// InflictTroopLosses, 3365 ResolveInvasionBattles, 2914 IndependentColoniesRecruitAndTrainTroops; BuiltObject.cs 4047
// HealTroops; BuiltObject.1.cs 2954 ProcessBoardingAssault; BaconBuiltObject.cs 777 ResetAssaultPods; Empire.1.cs 524
// TakeOwnershipOfBuiltObject) on a createGame galaxy (seed 1), plus a harness smoke run.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame, cachedTickGameRun } from './helpers/gameCache';
import type { Galaxy } from '../src/sim/galaxy';
import type { Habitat } from '../src/sim/types';
import type { Empire } from '../src/sim/empire';
import type { GameData } from '../src/sim/data/gameData';
import { Troop, TroopList, TroopType } from '../src/sim/cargo';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { ComponentType } from '../src/sim/data/components';
import { runGameSeconds } from '../src/sim/tick/harness';
import { galaxyNow } from '../src/sim/tick/simTime';
import { InvasionStats, type Modifiers, calculateForceStrengths, determineTroopModifiers, inflictTroopLosses, resolveInvasionBattles } from '../src/sim/combat/invasion';
import { cachedScenarioGameRun } from './helpers/gameCache';
import { ensureShips } from './helpers/ensureShips';
import type { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { ShipGroup } from '../src/sim/fleets/shipGroup';
import { BuiltObjectMissionPriority, BuiltObjectMissionType } from '../src/sim/missions/mission';
import { getText } from '../src/sim/diplomacyTick';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { GAME_DAY_LENGTH, scenarioQuery } from '../src/sim/scenario/hooks';
import { scenarioParam } from '../src/sim/scenario/state';
import { classifyOrbit, empireFirepowerNear, landingOrbitState, landingOrbitStrengths, orbitalAttrition, orbitalLandingBlocked, orbitalState, orbitalTrackInvasion, orbitalTrackNoInvasion } from '../src/sim/scenario/orbital/orbitalSuperiority';
import { canHoldOrbit, orbitalAiReview } from '../src/sim/scenario/orbital/orbitalAI';
import { healTroops, independentColoniesRecruitAndTrainTroops } from '../src/sim/combat/troopsRuntime';
import { processBoardingAssault, resetAssaultPods } from '../src/sim/combat/boarding';
import { takeOwnershipOfBuiltObject } from '../src/sim/combat/ownership';

let gameData: GameData;
let galaxy: Galaxy;

function countDraws(f: () => void): number {
    let n = 0;
    galaxy.rnd.setTrace(() => n++);
    try {
        f();
    } finally {
        galaxy.rnd.setTrace(null);
    }
    return n;
}

function troop(empire: Empire | null, type: TroopType, attack: number, defend: number, readiness = 100): Troop {
    return new Troop('t', type, attack, defend, 100, readiness, empire, empire?.dominantRace ?? null);
}

/** A fresh independent colony (population, independent empire) with its troop lists emptied. */
function independentColony(skip: Habitat[] = []): Habitat {
    const h = galaxy.independentColonies.find((c) => !skip.includes(c) && c.empire === galaxy.independentEmpire && c.population.totalAmount > 0)!;
    h.troops = new TroopList();
    h.troopsToRecruit = new TroopList();
    h.invadingTroops = new TroopList();
    h.invasionStats = null;
    return h;
}

beforeAll(async () => {
    gameData = await loadGameDataFs();
    galaxy = cachedTickGame(gameData).galaxy;
}, 180000);

describe('Habitat.cs 4978 InflictTroopLosses', () => {
    it('takes losses off one random troop, then recurses on the remainder once it is destroyed', () => {
        const h = independentColony();
        const e = galaxy.empires[0];
        const a = troop(e, TroopType.Infantry, 100, 100, 100);
        const b = troop(e, TroopType.Infantry, 100, 100, 100);
        const list = new TroopList();
        list.add(a);
        list.add(b);
        e.troops.add(a);
        e.troops.add(b);
        h.invasionStats = new InvasionStats(h, e, galaxy.independentEmpire);
        // 60 < 100 readiness: one draw, one troop at 40.
        expect(countDraws(() => inflictTroopLosses(galaxy, h, galaxy.independentEmpire, galaxy.independentEmpire, 60, list, null))).toBe(1);
        const hit = a.readiness === 40 ? a : b;
        expect(hit.readiness).toBe(40);
        expect((h.invasionStats as InvasionStats).troopsDamageToInvaders).toBe(60);
        // 150: the first pick (either) is destroyed and the rest (150 − its readiness) recurses: two draws when a
        // survivor remains, and both troops leave the list and the empire when the damage covers both.
        const draws = countDraws(() => inflictTroopLosses(galaxy, h, galaxy.independentEmpire, galaxy.empires[1], 150, list, null));
        expect(draws).toBe(2);
        expect(list.count).toBe(0);
        expect(e.troops.contains(a) || e.troops.contains(b)).toBe(false);
        expect((h.invasionStats as InvasionStats).destroyedDefendingTroops).toBe(2);
    });

    it('special forces take a third of the losses', () => {
        const h = independentColony();
        const sf = troop(galaxy.empires[0], TroopType.SpecialForces, 100, 100, 100);
        const list = new TroopList();
        list.add(sf);
        inflictTroopLosses(galaxy, h, null, null, 90, list, null);
        expect(sf.readiness).toBe(70);
    });
});

describe('BaconHabitat.cs 1188 CalculateForceStrengths', () => {
    it('sums readiness-weighted strengths with the defence-grid / planet-type modifiers', () => {
        const h = independentColony();
        const e = galaxy.empires[0];
        const def = new TroopList();
        def.add(troop(galaxy.independentEmpire, TroopType.Infantry, 50, 200, 100));
        const att = new TroopList();
        att.add(troop(e, TroopType.Infantry, 300, 100, 50));
        h.invasionSpaceControlStrengthDefenders = -1;
        h.invasionSpaceControlStrengthAttackers = -1;
        const { defendingStrength, attackingStrength } = calculateForceStrengths(galaxy, h, galaxy.independentEmpire, e, def, null, att, null);
        // Raw totals: defend 200 × 100 = 20000, attack 300 × 50 = 15000, then (1 + modifiers).
        expect(defendingStrength).toBeGreaterThan(0);
        expect(attackingStrength).toBeGreaterThan(0);
        expect(Math.abs(defendingStrength - 20000)).toBeLessThanOrEqual(20000 * 0.5);
        expect(Math.abs(attackingStrength - 15000)).toBeLessThanOrEqual(15000 * 0.5);
    });
});

describe('Habitat.cs 3365 ResolveInvasionBattles', () => {
    it('an overwhelming invasion takes an independent colony', () => {
        const h = independentColony();
        const invader = galaxy.empires[1];
        for (let i = 0; i < 6; i++) {
            const t = troop(invader, TroopType.Infantry, 5000, 5000, 100);
            t.colony = h;
            h.invadingTroops!.add(t);
            invader.troops.add(t);
        }
        const before = galaxy.invasionSuccesses;
        resolveInvasionBattles(galaxy, h, 10);
        expect(galaxy.invasionSuccesses).toBe(before + 1);
        expect(h.empire).toBe(invader);
        expect(h.owner).toBe(invader);
        expect(invader.colonies).toContain(h);
        expect(galaxy.independentColonies.length).toBeGreaterThan(0);
        expect(h.invadingTroops!.count).toBe(0);
        expect(h.troops!.count).toBe(6);
        expect(h.invasionStats).toBeNull();
        // Conquered: ConqueredFactor ≤ 0 and development level reduced by Next(11, 24).
        expect(h.conqueredFactor).toBeLessThanOrEqual(0);
    });

    it('a hopeless invasion is repelled and the defenders gain experience', () => {
        const h = independentColony();
        const invader = galaxy.empires[2];
        const d = troop(galaxy.independentEmpire, TroopType.Infantry, 100, 5000, 100);
        d.colony = h;
        h.troops!.add(d);
        const a = troop(invader, TroopType.Infantry, 1, 1, 1);
        a.colony = h;
        h.invadingTroops!.add(a);
        invader.troops.add(a);
        h.developmentLevel = 30;
        const before = galaxy.invasionFailures;
        resolveInvasionBattles(galaxy, h, 10);
        expect(galaxy.invasionFailures).toBe(before + 1);
        expect(h.empire).toBe(galaxy.independentEmpire);
        expect(h.invadingTroops!.count).toBe(0);
        // 15 experience: +7 attack, +15 defence.
        expect(d.attackStrength).toBe(107);
        expect(d.defendStrength).toBe(5015);
        expect(h.developmentLevel).toBeLessThanOrEqual(30 - 6);
        expect(h.developmentLevel).toBeGreaterThanOrEqual(30 - 14);
    });

    it('does nothing (and draws nothing) without invaders', () => {
        const h = independentColony();
        expect(countDraws(() => resolveInvasionBattles(galaxy, h, 10))).toBe(0);
    });

    it('guard (new; the C# NREs): an invasion with no defender at all is skipped, not thrown', () => {
        const h = independentColony();
        const invader = galaxy.empires[0];
        const a = troop(invader, TroopType.Infantry, 1, 1, 1);
        a.colony = h;
        h.invadingTroops!.add(a);
        const owner = h.empire;
        h.empire = null as never;
        try {
            expect(() => resolveInvasionBattles(galaxy, h, 10)).not.toThrow();
        } finally {
            h.empire = owner;
        }
    });
});

describe('Habitat.cs 2914 IndependentColoniesRecruitAndTrainTroops', () => {
    it('queues a militia below the required level and trains it at 150 per galactic year', () => {
        const h = independentColony();
        independentColoniesRecruitAndTrainTroops(galaxy, h, 60);
        expect(h.troopsToRecruit!.count + h.troops!.count).toBeGreaterThan(0);
        const t = h.troopsToRecruit!.count > 0 ? h.troopsToRecruit!.items[0] : h.troops!.items[0];
        expect(t.type).toBe(TroopType.Infantry);
        expect(t.empire).toBe(galaxy.independentEmpire);
        // 150 × 60 / 600 = 15 readiness.
        if (h.troopsToRecruit!.count > 0) expect(t.readiness).toBe(15);
        independentColoniesRecruitAndTrainTroops(galaxy, h, 600);
        expect(h.troops!.count).toBeGreaterThan(0);
        expect(h.troops!.items[0].readiness).toBe(100);
    });
});

describe('BuiltObject.cs 4047 HealTroops', () => {
    it('adds MedicalCapacity / 500 × timePassed readiness, capped at 100', () => {
        const ship = galaxy.empires[0].builtObjects[0];
        ship.troops = new TroopList();
        const t = troop(galaxy.empires[0], TroopType.Infantry, 100, 100, 40);
        ship.troops.add(t);
        const saved = ship.medicalCapacity;
        ship.medicalCapacity = 500;
        healTroops(galaxy, ship, 10);
        // × government TroopRecruitment × leader / character bonuses.
        expect(t.readiness).toBeGreaterThan(40);
        healTroops(galaxy, ship, 1000);
        expect(t.readiness).toBe(100);
        ship.medicalCapacity = saved;
        ship.troops = null;
    });
});

describe('BaconBuiltObject.cs 777 ResetAssaultPods', () => {
    it('resets assault pods not fired for more than 120 s', () => {
        const ship = galaxy.pirateEmpires.flatMap((p) => p.builtObjects).find((b) => b.weapons.some((w) => w.component.type === ComponentType.AssaultPod));
        if (ship === undefined) return; // no assault-pod design in this galaxy
        const pod = ship.weapons.find((w) => w.component.type === ComponentType.AssaultPod)!;
        pod.distanceTravelled = 5;
        ship.lastTouch = 1_000_000;
        pod.lastFired = 1_000_000 - 100_000;
        resetAssaultPods(galaxy, ship);
        expect(pod.distanceTravelled).toBe(5);
        pod.lastFired = 1_000_000 - 121_000;
        resetAssaultPods(galaxy, ship);
        expect(pod.distanceTravelled).toBe(-1);
    });
});

describe('BuiltObject.1.cs 2954 ProcessBoardingAssault / Empire.1.cs 524 TakeOwnershipOfBuiltObject', () => {
    it('a won boarding hands the ship to the boarders (or scraps it by policy)', () => {
        // A pirate warship (any faction: which factions start with one depends on the galaxy).
        const ship = galaxy.pirateEmpires.flatMap((e) => e.builtObjects).find((b) => b !== null && b.role === BuiltObjectRole.Military && !b.hasBeenDestroyed)!;
        expect(ship).toBeDefined();
        const captor = galaxy.empires[0];
        const oldOwner = ship.actualEmpire!;
        ship.assaultAttackValue = 3000;
        ship.assaultDefenseValue = 1;
        ship.assaultAttackEmpireId = captor.empireId;
        ship.assaultIsRaid = false;
        const before = captor.counters.captureShipCount;
        processBoardingAssault(galaxy, ship, galaxyNow(galaxy), 3);
        const captured = ship.empire === captor || ship.hasBeenDestroyed;
        expect(captured).toBe(true);
        expect(captor.counters.captureShipCount).toBe(before + 1);
        expect(oldOwner.builtObjects).not.toContain(ship);
        if (!ship.hasBeenDestroyed) {
            expect(captor.builtObjects).toContain(ship);
            expect(ship.design.empire).toBe(captor);
            expect(ship.assaultAttackValue).toBe(0);
            expect(ship.assaultOwnershipChangeCounter).toBe(3000);
        }
    });

    it('an abandoned ship taken over joins the new owner with a copied design', () => {
        const ship = galaxy.abandonedBuiltObjects.find((b) => !b.hasBeenDestroyed);
        if (ship === undefined) return;
        const e = galaxy.empires[1];
        takeOwnershipOfBuiltObject(galaxy, e, ship, e, true);
        expect(galaxy.abandonedBuiltObjects).not.toContain(ship);
        expect(ship.empire).toBe(e);
        expect(ship.design.empire).toBe(e);
        expect(e.designs).toContain(ship.design);
        expect(ship.isAutoControlled).toBe(true);
    });
});

describe('M4q on the headless harness', () => {
    it('runs 300 game-s with no M4q TODO hits', () => {
        const { game, run: r } = cachedTickGameRun(gameData, { seconds: 300 }); // createTickGame + runGameSeconds(g, 300), built once and cached (test/helpers/gameCache.ts)
        const g = game.galaxy;
        expect(Object.keys(r.todoHits).filter((k) => k.startsWith('M4q '))).toEqual([]);
        for (const h of g.habitats) {
            if (h.troops !== null) for (const t of h.troops.items) expect(Number.isFinite(t.readiness)).toBe(true);
        }
    }, 300000);
});

// Orbital superiority (scenarios/orbital-superiority, flag orbitalSuperiority; scenario/orbital/*.ts): the orbit states
// replacing the stock Space Control modifier, the contest ramp, supply attrition, refused landings and the AI.
describe('Orbital superiority add-on', () => {
    let og: Galaxy;
    beforeAll(() => {
        og = cachedScenarioGameRun(gameData, { scenario: 'orbital-superiority' }).game.galaxy;
    }, 300000);

    const aiEmpires = (): Empire[] => og.empires.filter((e) => e !== og.playerEmpire && e.pirateEmpireBaseHabitat === null && e.capital !== null && e.colonies.length > 0);
    function indColony(): Habitat {
        const h = og.independentColonies.find((c) => c.empire === og.independentEmpire && c.population.totalAmount > 0 && (c.invadingTroops === null || c.invadingTroops.count === 0))!;
        h.troops = new TroopList();
        h.troopsToRecruit = new TroopList();
        h.invadingTroops = new TroopList();
        h.invasionStats = null;
        return h;
    }
    function invade(h: Habitat, invader: Empire, defender: Empire | null, attack: number, defend: number, count = 2): void {
        for (let i = 0; i < count; i++) {
            const d = troop(defender, TroopType.Infantry, defend, defend, 100);
            d.colony = h;
            h.troops!.add(d);
            const a = troop(invader, TroopType.Infantry, attack, attack, 100);
            a.colony = h;
            h.invadingTroops!.add(a);
            invader.troops.add(a);
        }
    }
    function mods(h: Habitat): { defend: Modifiers; attack: Modifiers } {
        return determineTroopModifiers(og, h, h.troops!, h.invadingTroops!, null, null);
    }
    /** Puts `bo` into orbit of `h` (position and the built-object index cell). */
    function moveTo(bo: BuiltObject, h: Habitat, dx = 300): void {
        bo.xpos = h.xpos + dx;
        bo.ypos = h.ypos;
        const idx = og.resolveIndex(bo.xpos, bo.ypos);
        og.builtObjectIndexGrid[idx.x][idx.y].push(bo);
    }
    function fleetOf(e: Empire, ships: BuiltObject[]): ShipGroup {
        const g = new ShipGroup(og);
        g.empire = e;
        for (const s of ships) {
            g.ships.push(s);
            s.shipGroup = g;
        }
        g.leadShip = ships[0];
        (e.shipGroups as ShipGroup[]).push(g);
        return g;
    }

    it('classifies the orbit: none / attacker / contested / defender (ratio 1.5)', () => {
        expect(classifyOrbit(-1, -1, 1.5)).toBe('none');
        expect(classifyOrbit(0, 0, 1.5)).toBe('none');
        expect(classifyOrbit(0, 10, 1.5)).toBe('attacker');
        expect(classifyOrbit(100, 151, 1.5)).toBe('attacker');
        expect(classifyOrbit(100, 150, 1.5)).toBe('contested');
        expect(classifyOrbit(100, 70, 1.5)).toBe('contested');
        expect(classifyOrbit(100, 66, 1.5)).toBe('defender');
        expect(classifyOrbit(10, 0, 1.5)).toBe('defender');
    });

    it('replaces the Space Control modifier by state, with the -35 → -50 contest ramp; flag off = stock', () => {
        const h = indColony();
        const inv = aiEmpires()[0];
        invade(h, inv, og.independentEmpire, 100, 100);
        const sc = (d: number, a: number): void => {
            h.invasionSpaceControlStrengthDefenders = d;
            h.invasionSpaceControlStrengthAttackers = a;
        };
        // Attackers hold the orbit: +0.5 instead of +0.25.
        sc(0, 100);
        let m = mods(h);
        expect(m.attack.reasons).toContain('Orbital superiority');
        expect(m.attack.amounts[m.attack.reasons.indexOf('Orbital superiority')]).toBe(0.5);
        expect(m.attack.reasons).not.toContain(getText('Space Control'));
        // Contested: -35% at first, then linear to -50% over 30 days.
        sc(100, 100);
        orbitalTrackInvasion(og, h);
        const rec = orbitalState(og).invasions.find((x) => x.h === h.habitatIndex)!;
        expect(rec.state).toBe('contested');
        const now = galaxyStarDate(og);
        const pen = (days: number): { reason: string; amount: number } => {
            rec.since = now - days * GAME_DAY_LENGTH;
            const r = mods(h).attack;
            const i = r.reasons.findIndex((x) => x.startsWith('Supply lines disrupted'));
            return { reason: r.reasons[i], amount: r.amounts[i] };
        };
        expect(pen(0)).toEqual({ reason: 'Supply lines disrupted (-35%)', amount: -0.35 });
        expect(pen(12).reason).toBe('Supply lines disrupted (-41%)');
        expect(pen(12).amount).toBeCloseTo(-0.41, 10);
        expect(pen(30).amount).toBeCloseTo(-0.5, 10);
        expect(pen(90).amount).toBeCloseTo(-0.5, 10);
        // A state change restarts the ramp.
        sc(100, 0);
        orbitalTrackInvasion(og, h);
        expect(rec.state).toBe('defender');
        expect(rec.since).toBe(now);
        // Defenders hold the orbit: invaders -50% (Supply lines cut), defenders keep +0.25.
        m = mods(h);
        expect(m.attack.reasons).toContain('Supply lines cut');
        expect(m.attack.amounts[m.attack.reasons.indexOf('Supply lines cut')]).toBe(-0.5);
        expect(m.defend.amounts[m.defend.reasons.indexOf(getText('Space Control'))]).toBe(0.25);
        // Flag off: the stock +0.25 to the stronger side.
        og.scenario!.flags.orbitalSuperiority = false;
        try {
            m = mods(h);
            expect(m.attack.reasons.some((x) => x.startsWith('Supply') || x === 'Orbital superiority')).toBe(false);
            expect(m.defend.amounts[m.defend.reasons.indexOf(getText('Space Control'))]).toBe(0.25);
        } finally {
            og.scenario!.flags.orbitalSuperiority = true;
        }
        // The stock game (no scenario) on the same kind of colony.
        const hs = independentColony();
        invade(hs, galaxy.empires[1], galaxy.independentEmpire, 100, 100);
        hs.invasionSpaceControlStrengthDefenders = 100;
        hs.invasionSpaceControlStrengthAttackers = 0;
        const ms = determineTroopModifiers(galaxy, hs, hs.troops!, hs.invadingTroops!, null, null);
        expect(ms.attack.reasons.some((x) => x.startsWith('Supply'))).toBe(false);
        expect(ms.defend.amounts[ms.defend.reasons.indexOf(getText('Space Control'))]).toBe(0.25);
        hs.invadingTroops = new TroopList();
        h.invadingTroops = new TroopList();
        orbitalTrackNoInvasion(og, h);
    });

    it('supply attrition under a defender-held orbit wears the invaders down and ends the invasion as a defender win', () => {
        const h = indColony();
        const inv = aiEmpires()[1];
        invade(h, inv, og.independentEmpire, 100, 100);
        h.invasionSpaceControlStrengthDefenders = 200;
        h.invasionSpaceControlStrengthAttackers = 0;
        orbitalTrackInvasion(og, h);
        // 10 s = 6 game days at 3% a day: readiness 100 → 82 (no draws).
        let draws = 0;
        og.rnd.setTrace(() => draws++);
        orbitalAttrition(og, h, og.independentEmpire, 10, null);
        og.rnd.setTrace(null);
        expect(draws).toBe(0);
        for (const t of h.invadingTroops!.items) expect(t.readiness).toBeCloseTo(82, 3);
        // 60 s = 36 days: worn out; the stock repelled path ends it.
        const failures = og.invasionFailures;
        const st = orbitalState(og);
        const before = { ...st.stats };
        resolveInvasionBattles(og, h, 60);
        expect(h.invadingTroops!.count).toBe(0);
        expect(og.invasionFailures).toBe(failures + 1);
        expect(h.empire).toBe(og.independentEmpire);
        orbitalTrackNoInvasion(og, h);
        expect(st.stats.failed).toBe(before.failed + 1);
        expect(st.stats.failedByAttrition).toBe(before.failedByAttrition + 1);
        expect(st.invasions.some((x) => x.h === h.habitatIndex)).toBe(false);
    });

    it('refuses landings under a defender-held orbit (everyone) and AI landings under a contested one; AI troops wait, then withdraw', () => {
        const [att, def] = aiEmpires();
        const h = def.capital!;
        const d = landingOrbitStrengths(og, h, def, att).d;
        expect(d).toBeGreaterThan(0); // the capital's armed space port
        const aiShip = ensureShips(og, att, BuiltObjectSubRole.Destroyer, 2);
        const player = og.playerEmpire!;
        const humanShip = ensureShips(og, player, BuiltObjectSubRole.Destroyer, 1)[0];
        const st = orbitalState(og);
        // Defender-held: nobody lands (AI and human), raids neither.
        expect(landingOrbitState(og, h, att)).toBe('defender');
        expect(orbitalLandingBlocked(og, aiShip[0], h, false)).toBe(true);
        expect(orbitalLandingBlocked(og, aiShip[0], h, true)).toBe(true);
        expect(orbitalLandingBlocked(og, humanShip, h, false)).toBe(true);
        expect(st.holds.filter((x) => x.h === h.habitatIndex && x.e === att.empireId)).toHaveLength(1);
        // Contested: the AI keeps its troops aboard; a human may land.
        const fp0 = aiShip[0].firepowerRaw;
        aiShip[0].firepowerRaw = d;
        moveTo(aiShip[0], h);
        expect(landingOrbitState(og, h, att)).toBe('contested');
        expect(orbitalLandingBlocked(og, aiShip[0], h, false)).toBe(true);
        const hfp = humanShip.firepowerRaw;
        humanShip.firepowerRaw = d;
        moveTo(humanShip, h, -300);
        expect(landingOrbitState(og, h, player)).toBe('contested');
        expect(orbitalLandingBlocked(og, humanShip, h, false)).toBe(false);
        // Attacker-held: the AI lands; the hold is closed as a delayed landing.
        aiShip[0].firepowerRaw = d * 2;
        const after = st.stats.landingsAfterHold;
        expect(orbitalLandingBlocked(og, aiShip[0], h, false)).toBe(false);
        expect(st.stats.landingsAfterHold).toBe(after + 1);
        expect(st.holds.some((x) => x.h === h.habitatIndex && x.e === att.empireId)).toBe(false);
        // Back to a contested orbit for longer than orbitalAiHoldDays: the invasion fleet withdraws, troops aboard.
        aiShip[0].firepowerRaw = d;
        expect(orbitalLandingBlocked(og, aiShip[0], h, false)).toBe(true);
        const hold = st.holds.find((x) => x.h === h.habitatIndex && x.e === att.empireId)!;
        hold.since = galaxyStarDate(og) - 21 * GAME_DAY_LENGTH;
        const fleet = fleetOf(att, [aiShip[1]]);
        fleet.attackPoint = h;
        const t = troop(att, TroopType.Infantry, 100, 100, 100);
        aiShip[1].troops = new TroopList();
        aiShip[1].troops.add(t);
        const aborted = st.stats.landingsAborted;
        orbitalAiReview(og);
        expect(fleet.attackPoint).toBeNull();
        expect(fleet.mission?.type).toBe(BuiltObjectMissionType.Move);
        expect(fleet.mission?.priority).toBe(BuiltObjectMissionPriority.High);
        expect(st.stats.landingsAborted).toBe(aborted + 1);
        expect(aiShip[1].troops!.count).toBe(1);
        expect(st.holds.some((x) => x.h === h.habitatIndex && x.e === att.empireId)).toBe(false);
        // ... and the AI does not pick that colony again for a while.
        expect(scenarioQuery(og, 'invasionTargetOrbitOk', true, { empire: att, fleet, target: h })).toBe(false);
        aiShip[0].firepowerRaw = fp0;
        humanShip.firepowerRaw = hfp;
    });

    it('the AI only takes invasion targets whose orbit its fleet can hold', () => {
        const [, def, att] = aiEmpires();
        const h = def.capital!;
        const ships = ensureShips(og, att, BuiltObjectSubRole.Escort, 1);
        const fleet = fleetOf(att, [ships[0]]);
        const range = scenarioParam(og, 'orbitalAiThreatRange', 23000);
        const dNear = empireFirepowerNear(og, h.xpos, h.ypos, range, def);
        expect(dNear).toBeGreaterThan(0);
        const fp = ships[0].firepowerRaw;
        ships[0].firepowerRaw = Math.floor(dNear); // not > 1.5 x
        expect(canHoldOrbit(og, att, fleet, h)).toBe(false);
        expect(scenarioQuery(og, 'invasionTargetOrbitOk', true, { empire: att, fleet, target: h })).toBe(false);
        ships[0].firepowerRaw = Math.ceil(dNear * 2);
        expect(scenarioQuery(og, 'invasionTargetOrbitOk', true, { empire: att, fleet, target: h })).toBe(true);
        ships[0].firepowerRaw = fp;
    });

    it('an invaded AI colony gets a relief fleet (High Patrol); the invader keeps its escort over the planet', () => {
        const [inv, def] = aiEmpires().slice(-2);
        const h = def.colonies[def.colonies.length - 1];
        invade(h, inv, def, 100, 100);
        // Escort: an armed fleet of the invader in orbit.
        const esc = ensureShips(og, inv, BuiltObjectSubRole.Escort, 1)[0];
        moveTo(esc, h);
        const escort = fleetOf(inv, [esc]);
        const relief = fleetOf(def, ensureShips(og, def, BuiltObjectSubRole.Destroyer, 2).slice(0, 2));
        const fp = relief.ships.reduce((s, b) => s + b.firepowerRaw, 0);
        expect(fp).toBeGreaterThan(0);
        h.invasionSpaceControlStrengthDefenders = 0;
        h.invasionSpaceControlStrengthAttackers = Math.max(1, Math.floor(fp / 2));
        orbitalTrackInvasion(og, h);
        const st = orbitalState(og);
        const rec = st.invasions.find((x) => x.h === h.habitatIndex)!;
        expect(rec.state).toBe('attacker');
        const sent = st.stats.reliefsSent;
        orbitalAiReview(og);
        expect(st.stats.reliefsSent).toBe(sent + 1);
        expect(rec.relief).not.toBeNull();
        expect(rec.relief!.mission?.type).toBe(BuiltObjectMissionType.Patrol);
        expect(rec.relief!.mission?.targetHabitat).toBe(h);
        expect(rec.relief!.mission?.priority).toBe(BuiltObjectMissionPriority.High);
        expect(escort.mission?.type).toBe(BuiltObjectMissionType.Attack);
        expect(escort.mission?.targetHabitat).toBe(h);
        // The invasion ends (repelled): the relief fleet is released, and the save counts it as saved by relief.
        const saved = st.stats.savedByRelief;
        const r = rec.relief!;
        h.invadingTroops = new TroopList();
        orbitalTrackNoInvasion(og, h);
        expect(st.stats.savedByRelief).toBe(saved + 1);
        orbitalAiReview(og);
        expect(r.mission === null || r.mission.type !== BuiltObjectMissionType.Patrol || r.mission.targetHabitat !== h).toBe(true);
    });
});

// Longer ground battles (scenarios/longer-ground-combat, flag longerGroundCombat): the fight runs on half the clock.
describe('Longer ground battles add-on', () => {
    function stepsToEnd(g: Galaxy, idx: number): number {
        const h = g.habitats[idx];
        h.troops = new TroopList();
        h.troopsToRecruit = new TroopList();
        h.invadingTroops = new TroopList();
        h.invasionStats = null;
        const invader = g.empires[1];
        const d = new Troop('d', TroopType.Infantry, 100, 100, 100, 100, g.independentEmpire, null);
        d.colony = h;
        h.troops.add(d);
        const a = new Troop('a', TroopType.Infantry, 100, 100, 100, 100, invader, invader.dominantRace);
        a.colony = h;
        h.invadingTroops.add(a);
        invader.troops.add(a);
        let n = 0;
        while (h.invadingTroops !== null && h.invadingTroops.count > 0 && h.troops!.count > 0 && h.empire === g.independentEmpire && n < 1000) {
            resolveInvasionBattles(g, h, 10);
            n++;
        }
        return n;
    }

    it('a seed-1 invasion takes about twice as many updates with it on (factor 2), and the stock clock with it off', () => {
        const on = cachedScenarioGameRun(gameData, { scenario: 'longer-ground-combat' }).game.galaxy;
        const off = cachedTickGame(gameData).galaxy;
        const idx = off.independentColonies.find((c) => c.empire === off.independentEmpire && c.population.totalAmount > 0)!.habitatIndex;
        const nOff = stepsToEnd(off, idx);
        const nOn = stepsToEnd(on, idx);
        expect(nOff).toBeGreaterThan(3);
        expect(nOn / nOff).toBeGreaterThan(1.6);
        expect(nOn / nOff).toBeLessThan(2.5);
        // Flag off in the same scenario game: the stock pace.
        const on2 = cachedScenarioGameRun(gameData, { scenario: 'longer-ground-combat' }).game.galaxy;
        on2.scenario!.flags.longerGroundCombat = false;
        expect(stepsToEnd(on2, idx)).toBe(nOff);
    });
});
