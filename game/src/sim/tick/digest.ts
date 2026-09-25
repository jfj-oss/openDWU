// M4a: stable state digest for determinism tests and seed pins (tasks/M4-plan.md §5.2).
//
// Hashes (FNV-1a over float64 bit patterns, two 32-bit lanes) the galaxy clock and touch times, the Galaxy.Rnd
// internal state (SeedArray, inext, inextp, draw count), the frame-driver cursors, and per-empire / per-habitat /
// per-ship / per-creature key fields, iterated in C# list order.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { builtObjectMission } from '../missions/mission';

class Fnv {
    private a = 0x811c9dc5;
    private b = 0x01000193 ^ 0x5bd1e995;
    private readonly view = new DataView(new ArrayBuffer(8));

    num(x: number): void {
        this.view.setFloat64(0, x);
        for (let i = 0; i < 8; i++) {
            const byte = this.view.getUint8(i);
            this.a = Math.imul(this.a ^ byte, 0x01000193);
            this.b = Math.imul(this.b ^ byte, 0x01000193) ^ (this.b >>> 15);
        }
    }

    bool(x: boolean): void {
        this.num(x ? 1 : 0);
    }

    str(s: string): void {
        this.num(s.length);
        for (let i = 0; i < s.length; i++) this.num(s.charCodeAt(i));
    }

    hex(): string {
        return (this.a >>> 0).toString(16).padStart(8, '0') + (this.b >>> 0).toString(16).padStart(8, '0');
    }
}

function hashEmpire(h: Fnv, e: Empire): void {
    h.num(e.empireId);
    h.bool(e.active);
    h.num(e.stateMoney);
    h.num(e.privateMoney);
    h.num(e.totalPopulation);
    h.num(e.colonies.length);
    h.num(e.builtObjects.length);
    h.num(e.privateBuiltObjects.length);
    h.num(e.lastShortTouch);
    h.num(e.lastRegularTouch);
    h.num(e.lastPeriodicTouch);
    h.num(e.lastIntermediateTouch);
    h.num(e.lastLongTouch);
    h.num(e.lastHugeTouch);
    h.num(e.messages.length);
    h.num(e.relativeEmpireSize);
    h.num(e.colonizationTargets.length);
    h.num(e.resourceTargets.length);
    h.num(e.designs.length);
    h.num(e.corruption);
}

/** Digest of the simulation state (hex string). */
export function stateDigest(galaxy: Galaxy): string {
    const h = new Fnv();
    h.num(galaxy.nowMs);
    h.num(galaxy.lastGalaxyProcessTimeSensitive);
    h.num(galaxy.lastGalaxyProcessTime);
    h.num(galaxy.lastGalaxyHugeProcessTime);
    const rnd = galaxy.rnd.snapshotState();
    for (const v of rnd.seedArray) h.num(v);
    h.num(rnd.inext);
    h.num(rnd.inextp);
    h.num(galaxy.rnd.drawCount);
    const s = galaxy.scheduler;
    if (s !== null) {
        for (const v of [s.habitatCursor, s.inBattleCursor, s.builtObjectCursor, s.creatureCursor, s.empireCursor, s.empireFrameCounter, s.galaxyFrameCounter, s.fleetEmpireCursor, s.fleetFrameCounter, s.pirateCursor, s.pirateFrameCounter, s.frameCarry, s.frames]) h.num(v);
    }
    h.num(galaxy.empires.length);
    for (const e of galaxy.empires) hashEmpire(h, e);
    h.num(galaxy.pirateEmpires.length);
    for (const e of galaxy.pirateEmpires) hashEmpire(h, e);
    if (galaxy.independentEmpire !== null) hashEmpire(h, galaxy.independentEmpire);
    h.num(galaxy.habitats.length);
    for (const hab of galaxy.habitats) {
        h.num(hab.xpos);
        h.num(hab.ypos);
        h.num(hab.orbitAngle);
        h.num(hab.lastTouch);
        h.num(hab.lastIntermediateTouch);
        h.num(hab.lastPeriodicTouch);
        h.num(hab.lastLongTouch);
        h.num(hab.lastHugeTouch);
        h.num(hab.population.totalAmount);
        h.num(hab.developmentLevel);
        h.num(hab.annualTaxRevenue);
        h.num(hab.developmentLevelBaseline);
        h.num(hab.colonyInfluenceRadius);
        h.bool(hab.isShipYard);
        h.bool(hab.hasSpacePort);
        h.num(hab.troops !== null ? hab.troops.count : -1);
    }
    h.num(galaxy.builtObjects.length);
    for (const bo of galaxy.builtObjects) {
        // CompleteTeardown nulls the Galaxy.BuiltObjects slot (BuiltObject.2.cs 5171; combat/teardown.ts).
        if (bo == null) {
            h.num(-1);
            continue;
        }
        h.num(bo.builtObjectID);
        h.num(bo.xpos);
        h.num(bo.ypos);
        h.num(bo.currentFuel);
        h.num(bo.currentEnergy);
        h.num(bo.currentSpeed);
        h.bool(bo.inBattle);
        h.bool(bo.canHyperJump);
        h.num(builtObjectMission(bo.mission)?.type ?? -1);
        h.num(bo.lastTouch);
        h.num(bo.lastIntermediateTouch);
        h.num(bo.lastPeriodicTouch);
        h.num(bo.lastLongTouch);
        h.num(bo.annualSupportCostBase);
        h.num(bo.targetSpeed);
        h.num(bo.preferredSpeed);
    }
    h.num(galaxy.creatures.length);
    for (const c of galaxy.creatures) {
        h.num(c.creatureId);
        h.num(c.xpos);
        h.num(c.ypos);
        h.num(c.damage);
        h.bool(c.hasBeenDestroyed);
    }
    h.str(galaxy.orders.length.toString());
    return h.hex();
}

/** Entity counts reported next to the digest. */
export function stateCounts(galaxy: Galaxy): Record<string, number> {
    return {
        empires: galaxy.empires.length,
        pirateEmpires: galaxy.pirateEmpires.length,
        habitats: galaxy.habitats.length,
        builtObjects: galaxy.builtObjects.length,
        creatures: galaxy.creatures.length,
        colonies: galaxy.empires.reduce((n, e) => n + e.colonies.length, 0),
    };
}
