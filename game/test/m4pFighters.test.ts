// M4p fighters and carriers (tasks/M4-plan.md §3.3 row M4p):
// - unit tests of the ported Fighter / BaconFighter / carrier functions against hand-worked C# values;
// - a harness smoke test: a carrier's fighters launch, attack a space slug in range and wear it down;
// - save round trip of a galaxy with fighters.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame, createTickGameAtAge } from './helpers/tickGame';
import { runGameSeconds } from '../src/sim/tick/harness';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { BuiltObject } from '../src/sim/builtObject';
import { Random } from '../src/sim/random';
import { ComponentType } from '../src/sim/data/components';
import { ComponentCategoryType } from '../src/sim/data/policies';
import { ComponentStatus } from '../src/sim/builtObjectComponent';
import { determineThreatLevel } from '../src/sim/combat/threats';
import { galaxyFromJSON, galaxyToJSON } from '../src/sim/save/galaxySave';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { updateIndexesForMovement, updatePosition } from '../src/sim/movement';
import {
    Fighter,
    FighterMissionType,
    FighterType,
    buildNewFighters,
    fighterCompleteTeardown,
    fighterDoMovement,
    fighterDoTasks,
    fireAtNearbyFighters,
    fightersOf,
    identifyLatestBomberSpecification,
    identifyLatestFighterSpecification,
    launchAllFighters,
    manufactureRepairFighters,
    returnToCarrier,
} from '../src/sim/combat/fighters';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

/** The player's capital space port (a fighter carrier at game start on the tick-test seed). */
function playerCarrier(g: Galaxy): BuiltObject {
    const port = g.builtObjects.find((b) => b !== null && b.empire === g.playerEmpire && b.fighterCapacity > 0);
    if (port === undefined) throw new Error('no player carrier');
    return port;
}

/** Builds the carrier's fighters and finishes them (health 1, not under construction). */
function readyFighters(g: Galaxy, carrier: BuiltObject): Fighter[] {
    buildNewFighters(g, carrier);
    const fighters = fightersOf(carrier)!;
    for (const f of fighters) {
        f.health = 1;
        f.underConstruction = false;
    }
    return fighters;
}

describe('M4p unit: specifications and carriers', () => {
    it('fighters.txt rows map to C# FighterSpecifications (type 0 → Interceptor, weapon 0 → WeaponBeam)', () => {
        const g = createTickGame(gameData).galaxy;
        const spec = identifyLatestFighterSpecification(g.playerEmpire!)!;
        expect(spec).not.toBeNull();
        expect(spec.name).toBe('Standard Fighter');
        expect(spec.type).toBe(FighterType.Interceptor);
        expect(spec.size).toBe(10);
        expect(spec.topSpeed).toBe(105);
        expect(spec.turnRate).toBe(Math.fround(0.8));
        expect(spec.weaponType).toBe(ComponentType.WeaponBeam);
        expect(spec.weaponRange).toBe(160);
        expect(spec.weaponFireRate).toBe(700);
        const bomber = identifyLatestBomberSpecification(g.playerEmpire!);
        if (bomber !== null) {
            expect(bomber.type).toBe(FighterType.Bomber);
            expect(bomber.weaponType === ComponentType.WeaponTorpedo || bomber.weaponType === ComponentType.WeaponMissile).toBe(true);
        }
    });

    it('BuildNewFighters: the player fills its fighter bays with interceptors; an AI carrier splits them half/half', () => {
        const g = createTickGame(gameData).galaxy;
        const port = playerCarrier(g);
        const capacity = port.fighterCapacity;
        const rnd = g.rnd.getState();
        buildNewFighters(g, port);
        expect(g.rnd.getState()).toEqual(rnd); // no Galaxy.Rnd draws
        const fighters = fightersOf(port)!;
        // Standard Fighter Bay has "fighter" in its name: num5 = capacity, num7 = capacity / 10 interceptors, no bombers.
        expect(fighters.length).toBe(Math.trunc(capacity / 10));
        for (const f of fighters) {
            expect(f).toBeInstanceOf(Fighter);
            expect(f.specification.type).toBe(FighterType.Interceptor);
            expect(f.underConstruction).toBe(true);
            expect(f.onboardCarrier).toBe(true);
            expect(f.health).toBe(0);
            expect(f.parentBuiltObject).toBe(port);
            expect(f.empire).toBe(port.empire);
            expect(f.weapons.length).toBe(1);
            expect(f.firepowerRaw).toBe(3);
        }
        // Distinct increasing ids (Galaxy.GetNextFighterID).
        expect(new Set(fighters.map((f) => f.fighterID)).size).toBe(fighters.length);
        // A second call adds nothing (the bays are full).
        buildNewFighters(g, port);
        expect(fightersOf(port)!.length).toBe(fighters.length);

        // Not the player's carrier (3204): num5 /= 2, num6 = num5.
        const g2 = createTickGame(gameData).galaxy;
        const port2 = playerCarrier(g2);
        g2.playerEmpire = null;
        buildNewFighters(g2, port2);
        const f2 = fightersOf(port2)!;
        const half = Math.trunc(Math.trunc(port2.fighterCapacity / 2) / 10);
        const hasBomber = identifyLatestBomberSpecification(port2.empire!) !== null;
        expect(f2.filter((f) => f.specification.type === FighterType.Interceptor).length).toBe(half);
        expect(f2.filter((f) => f.specification.type === FighterType.Bomber).length).toBe(hasBomber ? half : 0);
    });

    it('ManufactureRepairFighters builds fighters one at a time (hand-worked C# float steps)', () => {
        const g = createTickGame(gameData).galaxy;
        const port = playerCarrier(g);
        buildNewFighters(g, port);
        const fighters = fightersOf(port)!;
        const rr = port.fighterRepairRate;
        expect(rr).toBeGreaterThan(0);
        // num1 = (float)(10 * rr * 0.01); num2 = num1 / 2f * 10f / 10.
        const num1 = Math.fround(10 * rr * 0.01);
        const num2 = Math.fround(Math.fround(Math.fround(num1 / 2) * 10) / 10);
        manufactureRepairFighters(g, port, 10);
        if (num2 < 1) {
            expect(fighters[0].health).toBe(num2);
            expect(fighters[0].underConstruction).toBe(true);
            expect(fighters[1].health).toBe(0);
        }
        // Run until everything is built; money is unchanged (fighterBuildCost = 0).
        const money = port.empire!.stateMoney;
        for (let i = 0; i < 200; i++) manufactureRepairFighters(g, port, 10);
        expect(fighters.every((f) => !f.underConstruction && f.health === 1)).toBe(true);
        expect(port.empire!.stateMoney).toBe(money);
    });

    it('LaunchAllFighters: Next(0, 2) + RandomHeadingOffset per fighter, heading carrier ± (π/2 + offset), speed 0.3 × top', () => {
        const g = createTickGame(gameData).galaxy;
        const port = playerCarrier(g);
        const fighters = readyFighters(g, port);
        port.threats = [];
        port.currentTarget = null;
        const shadow = new Random(0);
        shadow.setState(g.rnd.getState());
        let draws = 0;
        g.rnd.setTrace(() => draws++);
        launchAllFighters(g, port);
        g.rnd.setTrace(null);
        expect(draws).toBe(2 * fighters.length);
        const halfPi = Math.fround(Math.fround(Math.PI) / 2);
        for (const f of fighters) {
            const side = shadow.next(0, 2);
            const offset = Math.fround(Math.fround(-Math.fround(0.3)) + shadow.nextDouble() * Math.fround(0.3) * 2.0);
            const expected = side !== 1 ? Math.fround(port.heading - Math.fround(halfPi + offset)) : Math.fround(port.heading + Math.fround(halfPi + offset));
            expect(f.heading).toBe(expected);
            expect(f.onboardCarrier).toBe(false);
            expect(f.missionType).toBe(FighterMissionType.Patrol);
            expect(f.currentSpeed).toBe(Math.fround(Math.fround(105) * Math.fround(0.3)));
            expect(f.xpos).toBe(port.xpos);
        }
    });

    it('ReturnToCarrier + DoMovement: a returning fighter out of view boards once a step covers 60% of the distance', () => {
        const g = createTickGame(gameData).galaxy;
        const port = playerCarrier(g);
        const [f] = readyFighters(g, port);
        port.threats = [];
        launchAllFighters(g, port);
        f.xpos = port.xpos + 50;
        f.ypos = port.ypos;
        returnToCarrier(f);
        expect(f.missionType).toBe(FighterMissionType.ReturnToCarrier);
        expect(f.targetSpeed).toBe(f.topSpeed);
        f.currentSpeed = 100;
        fighterDoMovement(g, f, 1.0); // 100 × 1 > 50 × 0.6
        expect(f.onboardCarrier).toBe(true);
        expect(f.missionType).toBe(FighterMissionType.Undefined);
        expect(f.currentSpeed).toBe(0);
        expect(f.xpos).toBe(port.xpos);
    });

    it('CompleteTeardown detaches the fighter; ReDefine tears down all fighters when the bays are gone', () => {
        const g = createTickGame(gameData).galaxy;
        const port = playerCarrier(g);
        const fighters = readyFighters(g, port);
        const n = fighters.length;
        const first = fighters[0];
        fighterCompleteTeardown(g, first);
        expect(first.hasBeenDestroyed).toBe(true);
        expect(first.parentBuiltObject).toBeNull();
        expect(fightersOf(port)!.length).toBe(n - 1);
        for (const c of port.components.items) if (c.category === ComponentCategoryType.Fighter) c.status = ComponentStatus.Damaged;
        const remaining = [...fightersOf(port)!];
        port.reDefine();
        expect(port.fighterCapacity).toBe(0);
        expect(remaining.every((f) => f.hasBeenDestroyed && f.parentBuiltObject === null)).toBe(true);
        expect(fightersOf(port)!.length).toBe(0);
    });

    it('DetermineThreatLevel(Fighter): an unowned fighter in scan range scores 1 (num5 0 → Max(1, 0)); out of range 0', () => {
        const g = createTickGame(gameData).galaxy;
        const port = playerCarrier(g);
        const other = g.builtObjects.find((b) => b !== null && b !== port && b.empire !== null && b.empire !== port.empire && b.fighterCapacity >= 0)!;
        if (other.fighters === null) other.fighters = [];
        const spec = identifyLatestFighterSpecification(g.playerEmpire!)!;
        const f = new Fighter(g, spec, other);
        f.empire = null;
        f.xpos = port.xpos + 1000;
        f.ypos = port.ypos;
        expect(determineThreatLevel(g, f, port)).toBe(1);
        f.xpos = port.xpos + 10_000_000;
        expect(determineThreatLevel(g, f, port)).toBe(0);
    });
});

describe('M4p combat against a ship', () => {
    it('fighters pursue and damage an enemy pirate ship; the ship fires back at nearby fighters', () => {
        const g = createTickGame(gameData).galaxy;
        const port = playerCarrier(g);
        const fighters = readyFighters(g, port);
        const pirate = g.builtObjects.find((b) => b !== null && !b.hasBeenDestroyed && b.empire !== null && b.empire.pirateEmpireBaseHabitat !== null && b.role === BuiltObjectRole.Military)!;
        expect(pirate).toBeDefined();
        const ix = Math.trunc(Math.trunc(pirate.xpos) / 400000);
        const iy = Math.trunc(Math.trunc(pirate.ypos) / 400000);
        pirate.xpos = port.xpos + 700;
        pirate.ypos = port.ypos + 200;
        updateIndexesForMovement(g, pirate, ix, iy, true);
        updatePosition(g, pirate);
        port.threats = [pirate];
        port.threatLevels = [1000];
        port.currentTarget = null;
        launchAllFighters(g, port);
        expect(fighters.every((f) => f.missionType === FighterMissionType.Attack && f.currentTarget === pirate)).toBe(true);
        expect((pirate.pursuers ?? []).filter((p) => fighters.includes(p as Fighter)).length).toBe(fighters.length);
        const shields0 = pirate.currentShields;
        const damaged0 = pirate.damagedComponentCount;
        let time = g.nowMs;
        let fired = 0;
        for (let step = 0; step < 600 && !pirate.hasBeenDestroyed; step++) {
            time += 50;
            g.nowMs = time;
            for (const f of [...fightersOf(port)!]) {
                fighterDoTasks(g, f, time, false);
                if (f.weapons[0].distanceTravelled > 0) fired++;
            }
            port.threats = [pirate];
            port.threatLevels = [1000];
            pirate.threats = [port];
            pirate.threatLevels = [1000];
            fireAtNearbyFighters(g, pirate, time, false);
        }
        expect(fired).toBeGreaterThan(0);
        expect(pirate.hasBeenDestroyed || pirate.currentShields < shields0 || pirate.damagedComponentCount > damaged0).toBe(true);
        // Fighters that fired sit in the pirate's Attackers list (FighterWeapon.Fire adds the firer).
        expect((pirate.attackers ?? []).some((a) => a instanceof Fighter) || pirate.hasBeenDestroyed).toBe(true);
    });
});

describe('M4p harness', () => {
    it('fighters launch and attack a space slug within range of their carrier', () => {
        // Age-0 (PreWarp) galaxy fixture: the seed-1 age-0 layout has space slugs in Sol that the capital port sees as
        // threats within 5 s; the default age-1 galaxy (M4y) places its creatures elsewhere (none within reach of Sol).
        const g = createTickGameAtAge(gameData, 0).galaxy;
        const port = playerCarrier(g);
        const fighters = readyFighters(g, port);
        // A creature the port already sees as a threat (Sol's space slugs), moved next to it: fighters engage within
        // CalculateMaximumTargetRange of their carrier.
        runGameSeconds(g, 5);
        const creature = (port.threats ?? []).find((t) => t !== null && g.creatures.includes(t as never)) as (typeof g.creatures)[number] | undefined;
        expect(creature).toBeDefined();
        creature!.xpos = port.xpos + 900;
        creature!.ypos = port.ypos - 400;
        // Keep the move when the parent habitat re-applies its offset (Creature parentX / parentY).
        if (creature!.parentHabitat !== null) {
            creature!.parentX = creature!.xpos - creature!.parentHabitat.xpos;
            creature!.parentY = creature!.ypos - creature!.parentHabitat.ypos;
        }
        const r = runGameSeconds(g, 40);
        expect(Object.keys(r.todoHits).filter((k) => k.startsWith('M4p '))).toEqual([]);
        expect(fighters.some((f) => !f.onboardCarrier)).toBe(true);
        expect(fighters.some((f) => f.missionType === FighterMissionType.Attack) || !g.creatures.includes(creature!)).toBe(true);
        expect(creature!.damage > 0 || !g.creatures.includes(creature!)).toBe(true);
    }, 300000);

    it('a galaxy with fighters survives a save round trip', () => {
        const g = createTickGame(gameData).galaxy;
        const port = playerCarrier(g);
        const fighters = readyFighters(g, port);
        port.threats = [];
        launchAllFighters(g, port);
        const json = JSON.stringify(galaxyToJSON(g));
        const restored = galaxyFromJSON(JSON.parse(json), gameData);
        const port2 = restored.builtObjects.find((b) => b !== null && b.name === port.name)!;
        const f2 = fightersOf(port2)!;
        expect(f2.length).toBe(fighters.length);
        expect(f2[0]).toBeInstanceOf(Fighter);
        expect(f2[0].parentBuiltObject).toBe(port2);
        expect(f2[0].heading).toBe(fighters[0].heading);
        expect(f2[0].specification.name).toBe('Standard Fighter');
        expect(restored.nextFighterID).toBe(g.nextFighterID);
        expect(JSON.stringify(galaxyToJSON(restored))).toBe(json);
    }, 300000);
});
