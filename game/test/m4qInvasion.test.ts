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
import { InvasionStats, calculateForceStrengths, inflictTroopLosses, resolveInvasionBattles } from '../src/sim/combat/invasion';
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
        const ship = galaxy.pirateEmpires[0].builtObjects.find((b) => b.role === BuiltObjectRole.Military && !b.hasBeenDestroyed)!;
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
