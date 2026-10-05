// A station under construction (a base a construction ship is building on site: BuiltAt = the ship, the base sits in
// the ship's ConstructionQueue yard) is a normal target, as in the C#:
//   - it is in the galaxy from the first step (BuiltObject.2.cs 1574 Empire.AddBuiltObjectToGalaxy), so threat lists,
//     ShouldAttack (BuiltObject.1.cs 951) and the Attack command treat it like any other base — no BuiltAt /
//     UnbuiltComponentCount guard anywhere on the targeting or damage side;
//   - InflictDamage (BuiltObject.2.cs 6363-6720): shields, then Normal armour plates, then random components — the pick
//     (6650-6660) only skips Damaged ones, so a hit can land on an Unbuilt component and mark it Damaged;
//   - destroyed when the hull damage reaches UndamagedComponentSize (6550; BuiltObject.cs 2828 counts Normal components
//     only), so a base with nothing built yet dies to its first penetrating hit;
//   - the yard repairs before it builds: ConstructionQueue.cs 1142 IdentifyComponentToBuild returns the first Damaged
//     component, or the first Unbuilt one whose component the ship carries, whichever comes first in component order,
//     and a Damaged one is restored without resources (ConstructionQueue.cs 785-790).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { BuiltObject } from '../src/sim/builtObject';
import { HabitatCategoryType } from '../src/sim/types';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, CommandAction, builtObjectMission, COORD_UNSET_DOUBLE } from '../src/sim/missions/mission';
import { assignMission, clearPreviousMissionRequirements } from '../src/sim/missions/assign';
import { executeCommands } from '../src/sim/missions/executeCommands';
import { runPlayerCommand } from '../src/sim/player/playerCommands';
import { boardShipEligible, constructionBoardOf } from '../src/sim/player/constructionBoard';
import { galaxyNow, galaxyStarDate } from '../src/sim/tick/simTime';
import { runGameSeconds } from '../src/sim/tick/harness';
import { ComponentStatus } from '../src/sim/builtObjectComponent';
import { updateIndexesForMovement, updatePosition } from '../src/sim/movement';
import { BuiltObjectFleeWhen } from '../src/sim/data/designSpecifications';
import { builtObjectConstructionQueue } from '../src/sim/construction/constructionQueue';
import { inflictDamage } from '../src/sim/combat/damage';
import { pirateEscort } from './helpers/combatCast';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

const count = (b: BuiltObject, s: ComponentStatus) => b.components.items.filter((c) => c.status === s).length;

/** Moves a ship (re-indexing it) and stops it dead: no parent, no speed, no hyperjump in progress. */
function place(g: Galaxy, b: BuiltObject, x: number, y: number): void {
    const ix = Math.trunc(Math.trunc(b.xpos) / 400000);
    const iy = Math.trunc(Math.trunc(b.ypos) / 400000);
    b.parentBuiltObject = null;
    b.parentHabitat = null;
    b.dockedAt = null;
    b.parentOffsetX = -2000000001.0;
    b.parentOffsetY = -2000000001.0;
    b.xpos = x;
    b.ypos = y;
    b.currentSpeed = 0;
    b.targetSpeed = 0;
    b.preferredSpeed = 0;
    b.hyperjumpPrepare = false;
    updateIndexesForMovement(g, b, ix, iy, true);
    updatePosition(g, b);
}

/**
 * The player's construction ship starts a mining station at the nearest free resource habitat with no armed ship and no
 * colony within 100 000 (so nobody else joins the fight), skipping the travel (as privateStationPayment.test.ts): the
 * Build command runs on site (BuiltObject.2.cs 1444) and the new base sits in the ship's yard with BuiltAt = the ship.
 * The ship is held there (FleeWhen Never, so it keeps building under fire instead of escaping and dropping the base).
 */
function stage() {
    const game = cachedTickGame(gameData);
    const g = game.galaxy;
    const p = game.playerEmpire;
    const eligible = (p.constructionShips as BuiltObject[]).filter((s) => boardShipEligible(p, s));
    for (const s of eligible) {
        clearPreviousMissionRequirements(g, s, true);
        s.subsequentMissions.length = 0;
        s.revertMission = null;
    }
    const ship0 = eligible[0];
    const quiet = (x: number, y: number) =>
        g.builtObjects.every((b) => b === null || b.firepowerRaw <= 0 || Math.hypot(b.xpos - x, b.ypos - y) > 100000) &&
        g.habitats.every((c) => c.empire === null || Math.hypot(c.xpos - x, c.ypos - y) > 100000);
    const site = g.habitats
        .filter((h) => h.category !== HabitatCategoryType.Star && h.resources.length > 0 && h.empire === null && quiet(h.xpos, h.ypos))
        .sort((a, b) => Math.hypot(a.xpos - ship0.xpos, a.ypos - ship0.ypos) - Math.hypot(b.xpos - ship0.xpos, b.ypos - ship0.ypos))[0];
    expect(site).toBeDefined();
    const sub = site.category === HabitatCategoryType.GasCloud ? BuiltObjectSubRole.GasMiningStation : BuiltObjectSubRole.MiningStation;
    const design = p.designs.find((d) => d.subRole === sub && !d.isObsolete)!;
    const id = runPlayerCommand(g, p, 'constructionJobAdd', [design, site, COORD_UNSET_DOUBLE, COORD_UNSET_DOUBLE]);
    const ship = constructionBoardOf(p).jobs.find((j) => j.id === id)!.ship!;
    const m = builtObjectMission(ship.mission)!;
    while (m.fastPeekCurrentCommand() !== null && m.fastPeekCurrentCommand()!.action !== CommandAction.Build) m.completeCommand();
    ship.parentHabitat = site;
    ship.parentBuiltObject = null;
    ship.dockedAt = null;
    ship.parentOffsetX = 0;
    ship.parentOffsetY = 0;
    ship.xpos = site.xpos;
    ship.ypos = site.ypos;
    ship.firstExecutionOfCommand = true;
    executeCommands(g, ship, 0.05, galaxyNow(g), galaxyStarDate(g));
    const base = m.secondaryTargetBuiltObject!;
    expect(base).not.toBeNull();
    expect(base.builtAt).toBe(ship);
    expect(g.builtObjects).toContain(base);
    ship.fleeWhen = BuiltObjectFleeWhen.Never;
    ship.design.fleeWhen = BuiltObjectFleeWhen.Never;
    return { g, p, ship, base };
}

/** A pirate escort next to the base, held to the player's orders (not auto-controlled, never flees). */
function attacker(g: Galaxy, base: BuiltObject): BuiltObject {
    const pir = pirateEscort(g, 0);
    builtObjectMission(pir.mission)?.clear();
    pir.isAutoControlled = false;
    pir.fleeWhen = BuiltObjectFleeWhen.Never;
    pir.design.fleeWhen = BuiltObjectFleeWhen.Never;
    place(g, pir, base.xpos + 300, base.ypos);
    pir.currentEnergy = pir.reactorStorageCapacity;
    return pir;
}

const inYard = (ship: BuiltObject, base: BuiltObject) => (builtObjectConstructionQueue(ship)?.constructionYards ?? []).some((y) => y.shipUnderConstruction === base);

describe('a station under construction takes damage (BuiltObject.2.cs 6363 InflictDamage, ConstructionQueue.cs 1142)', () => {
    it('with nothing built yet (UndamagedComponentSize 0) the first penetrating hit destroys it; it leaves the galaxy and the yard', () => {
        const { g, ship, base } = stage();
        expect(count(base, ComponentStatus.Normal)).toBe(0);
        expect(base.undamagedComponentSize).toBe(0);
        expect(base.currentShields).toBe(0);
        const pir = attacker(g, base);
        expect(inflictDamage(g, pir, base, null, 20, galaxyNow(g), 0, 0)).toBe(true);
        expect(base.hasBeenDestroyed).toBe(true);
        runGameSeconds(g, 10, {}); // CompleteTeardown when the destroying explosion ends (BuiltObject.cs DoExplosions)
        expect(g.builtObjects).not.toContain(base);
        expect(inYard(ship, base)).toBe(false);
        expect(ship.hasBeenDestroyed).toBe(false);
    }, 300000);

    it('an Attack order on it: the attacker fires, built and unbuilt components turn Damaged while the ship keeps building it; hits keep landing until nothing is left and it is destroyed', () => {
        const { g, ship, base } = stage();
        runGameSeconds(g, 20, {}); // the yard builds the first components
        expect(count(base, ComponentStatus.Normal)).toBeGreaterThan(0);
        const pir = attacker(g, base);
        assignMission(g, pir, BuiltObjectMissionType.Attack, base, null, BuiltObjectMissionPriority.High);
        expect(builtObjectMission(pir.mission)!.type).toBe(BuiltObjectMissionType.Attack);
        const unbuilt0 = count(base, ComponentStatus.Unbuilt);
        const unbuiltIds = new Set(base.components.items.filter((c) => c.status === ComponentStatus.Unbuilt));
        let damagedUnderConstruction = false;
        let unbuiltHit = false;
        runGameSeconds(g, 30, {
            onFrame: () => {
                if (base.hasBeenDestroyed) return;
                if (base.builtAt === ship && count(base, ComponentStatus.Damaged) > 0 && count(base, ComponentStatus.Unbuilt) > 0) damagedUnderConstruction = true;
                if (base.components.items.some((c) => unbuiltIds.has(c) && c.status === ComponentStatus.Damaged)) unbuiltHit = true;
            },
        });
        expect(pir.currentTarget === base || base.hasBeenDestroyed).toBe(true);
        expect(damagedUnderConstruction).toBe(true);
        expect(unbuiltHit).toBe(true); // 6650-6665: the random pick only skips Damaged components
        expect(unbuilt0).toBeGreaterThan(0);
        // The rest of the hull, struck directly (same InflictDamage path the weapons use): it dies once the hull damage
        // reaches the Normal components' size (6550), and it is not repaired back to life in between.
        let guard = 0;
        while (!base.hasBeenDestroyed && guard++ < 500) inflictDamage(g, pir, base, null, 25, galaxyNow(g), 0, 0);
        expect(base.hasBeenDestroyed).toBe(true);
        runGameSeconds(g, 10, {}); // CompleteTeardown when the destroying explosion ends (BuiltObject.cs DoExplosions)
        expect(g.builtObjects).not.toContain(base);
        expect(inYard(ship, base)).toBe(false);
    }, 300000);

    it('once the attacker is gone the construction ship restores the Damaged components (in component order, ahead of any later Unbuilt one) and keeps building', () => {
        const { g, ship, base } = stage();
        runGameSeconds(g, 20, {});
        const pir = attacker(g, base);
        assignMission(g, pir, BuiltObjectMissionType.Attack, base, null, BuiltObjectMissionPriority.High);
        let guard = 0;
        while (count(base, ComponentStatus.Damaged) < 3 && !base.hasBeenDestroyed && guard++ < 120) runGameSeconds(g, 0.5, {});
        expect(base.hasBeenDestroyed).toBe(false);
        expect(count(base, ComponentStatus.Damaged)).toBeGreaterThanOrEqual(3);
        // Call the attacker off and move it out of the system.
        builtObjectMission(pir.mission)?.clear();
        pir.currentTarget = null;
        place(g, pir, base.xpos + 2000000, base.ypos + 2000000);
        expect(base.builtAt).toBe(ship);
        const unbuiltAtStop = count(base, ComponentStatus.Unbuilt);
        expect(unbuiltAtStop).toBeGreaterThan(0);
        let prev = base.components.items.map((c) => c.status);
        let outOfOrder = 0;
        let repairedAt = -1;
        let resumedAt = -1;
        let frame = 0;
        runGameSeconds(g, 90, {
            onFrame: () => {
                frame++;
                const now = base.components.items.map((c) => c.status);
                // IdentifyComponentToBuild walks the components in order and returns the first Damaged one, or the first
                // Unbuilt one the ship's cargo holds, whichever comes first: an Unbuilt component built this frame never
                // has a Damaged one before it still waiting (no new hits arrive now).
                for (let i = 0; i < now.length; i++) {
                    if (prev[i] === ComponentStatus.Unbuilt && now[i] === ComponentStatus.Normal && now.slice(0, i).includes(ComponentStatus.Damaged)) outOfOrder++;
                }
                const u = now.filter((x) => x === ComponentStatus.Unbuilt).length;
                const d = now.filter((x) => x === ComponentStatus.Damaged).length;
                if (repairedAt < 0 && d === 0) repairedAt = frame;
                if (resumedAt < 0 && u < unbuiltAtStop) resumedAt = frame;
                prev = now;
            },
        });
        expect(base.hasBeenDestroyed).toBe(false);
        expect(outOfOrder).toBe(0);
        expect(repairedAt).toBeGreaterThan(0); // every Damaged component restored
        expect(resumedAt).toBeGreaterThan(0); // and the Unbuilt ones are being built again
        expect(count(base, ComponentStatus.Unbuilt)).toBeLessThan(unbuiltAtStop);
    }, 300000);
});
