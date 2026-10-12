// Rim Frontier "wild rim" (not a port): the rim is a dangerous, poor frontier.
//   1 colony value    colonizationTargetValue (civilianAI.ts identifyColonizationTargetsFull): AI target value in the rim
//                     band is scaled down with depth. Voidbloom worlds (bloomWorldOf) and the rim-living races (Oranthi,
//                     Ossuvan) are exempt; the player's own colonising is not touched.
//   2 poor planets    afterGeneration: rim habitats lose base quality, scaled by depth into the rim.
//   3 pirate control  pirateControlGrowthFactor: pirates take rim colonies faster.
//   4 strong bases    game start + yearly: rim pirate bases get extra warships (up to a cap) and defensive bases
//                     (pirates.ts addPirateStartingShip, the stock starting-ship path).
//   5 derelicts       game start: advanced abandoned warships (stock generateAbandonedBuiltObject, claimed the stock way
//                     by a ship reaching them, combat/ownership.ts investigateAbandonedBuiltObject) placed deep in the
//                     rim, mostly beside rim pirate bases; the claims are recorded (abandonedShipClaimed).
// Quality and colony value are pure; the placements draw galaxy.rnd (flag-on games only).
import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import type { Design } from '../../design';
import { radiusFraction, registerScenarioEvent, registerScenarioGameStart, registerScenarioGeneration, registerScenarioQuery, registerScenarioYearly } from '../hooks';
import { RIM_RACE } from '../rimTrade/common';
import { bloomWorldOf } from '../voidbloom/common';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { addPirateStartingShip, determineOrbitalBaseLocation, generatePirateEmpireRandom, latestDesignsFindNewestCanBuild } from '../../pirates';
import { BuiltObject } from '../../builtObject';
import { cloneDesign, galaxyDesignSpecificationBySubRole, generateAbandonedBuiltObject } from '../../gameStartTail';
import { generateDesignFromSpec } from '../../designGeneration';
import { galaxyCurrentStarDate } from '../../pirateRelations';
import { galaxyStarDate } from '../../tick/simTime';
import { RIM_FRONTIER_FLAG, frontierParam, rimFrontierState, rimFuelOases } from './common';

const RIM_LIVING = new Set<string>([RIM_RACE, 'Ossuvan']);

/** 0 at the belt inner radius, 1 at the galaxy edge; null outside the rim. */
function rimDepth(galaxy: Galaxy, x: number, y: number): number | null {
    const inner = frontierParam(galaxy, 'rimFrontierBeltInner');
    const f = radiusFraction(galaxy, x, y);
    if (f < inner) return null;
    return Math.min(1, (f - inner) / Math.max(0.05, 1 - inner));
}

registerScenarioQuery({
    id: 'rimFrontier.wildColonyValue',
    flag: RIM_FRONTIER_FLAG,
    query: 'colonizationTargetValue',
    run: (galaxy, v, a) => {
        if (!(v > 0)) return v;
        const depth = rimDepth(galaxy, a.habitat.xpos, a.habitat.ypos);
        if (depth === null || bloomWorldOf(galaxy, a.habitat) !== null) return v;
        const race = a.empire.dominantRace?.name;
        if (race !== undefined && RIM_LIVING.has(race)) return v;
        const edge = frontierParam(galaxy, 'rimWildColonyValueEdge');
        const deep = frontierParam(galaxy, 'rimWildColonyValueDeep');
        return v * (edge + (deep - edge) * depth);
    },
});

registerScenarioQuery({
    id: 'rimFrontier.wildPirateControl',
    flag: RIM_FRONTIER_FLAG,
    query: 'pirateControlGrowthFactor',
    run: (galaxy, v, a) => (rimDepth(galaxy, a.habitat.xpos, a.habitat.ypos) === null ? v : v * frontierParam(galaxy, 'rimWildPirateControlFactor')),
});

function wildQuality(galaxy: Galaxy): void {
    const loss = frontierParam(galaxy, 'rimWildQualityLoss');
    const q = { n: 0, before: 0, after: 0 };
    for (const h of galaxy.habitats) {
        const depth = rimDepth(galaxy, h.xpos, h.ypos);
        if (depth === null || !(h.baseQuality > 0)) continue;
        q.n++;
        q.before += h.baseQuality;
        if (loss > 0) h.baseQuality = Math.fround(h.baseQuality * (1 - loss * depth));
        q.after += h.baseQuality;
    }
    rimFrontierState(galaxy).quality = q;
}
registerScenarioGeneration({ id: 'rimFrontier.wildQuality', flag: RIM_FRONTIER_FLAG, afterGeneration: wildQuality });

// ---- pirates ----
const WARSHIPS = [BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Escort];

/** Pirate factions whose base sits in the rim. */
export function rimPirateFactions(galaxy: Galaxy): Empire[] {
    return galaxy.pirateEmpires.filter((e) => e.pirateEmpireBaseHabitat !== null && rimDepth(galaxy, e.pirateEmpireBaseHabitat.xpos, e.pirateEmpireBaseHabitat.ypos) !== null);
}

function fleetSize(e: Empire): number {
    return e.builtObjects.filter((b) => b.role === BuiltObjectRole.Military && b.topSpeed > 0).length;
}

function reinforce(galaxy: Galaxy, e: Empire, ships: number, cap: number): void {
    const hab = e.pirateEmpireBaseHabitat as Habitat;
    let design: Design | null = null;
    for (const sr of WARSHIPS) {
        design = latestDesignsFindNewestCanBuild(e, sr);
        if (design !== null) break;
    }
    for (let i = 0; design !== null && i < ships && fleetSize(e) < cap; i++) {
        design.buildCount++;
        addPirateStartingShip(galaxy, e, design, galaxy.selectRandomUniqueMilitaryShipName(null, e, design.subRole), hab, true);
    }
    const want = Math.trunc(frontierParam(galaxy, 'rimWildPirateDefenceBases'));
    let dd = want > 0 ? latestDesignsFindNewestCanBuild(e, BuiltObjectSubRole.DefensiveBase) : null;
    if (want > 0 && dd === null) dd = generateDesignFromSpec(galaxy, e, galaxyDesignSpecificationBySubRole(BuiltObjectSubRole.DefensiveBase), 1.0, galaxyCurrentStarDate(galaxy));
    if (dd === null) return;
    let have = hab.basesAtHabitat.filter((b) => b.empire === e && b.subRole === BuiltObjectSubRole.DefensiveBase).length;
    for (; have < want; have++) {
        dd.buildCount++;
        const bo = new BuiltObject(dd, galaxy.selectUniqueBuiltObjectName(dd, hab), galaxy, true);
        bo.empire = e;
        bo.heading = galaxy.selectRandomHeading();
        bo.targetHeading = bo.heading;
        bo.supportCostFactor = 0;
        bo.reDefine();
        bo.currentFuel = bo.fuelCapacity;
        bo.currentShields = bo.shieldsCapacity;
        const off = determineOrbitalBaseLocation(galaxy, hab);
        e.addBuiltObjectToGalaxy(bo, hab, false, true, off.x, off.y, false);
    }
}

/**
 * Stock base placement needs the nearest fuel habitat to a random point, and fuel scarcity keeps fuel inside the belt, so
 * few new factions end up in the rim. This tops the rim up with `rimWildExtraPiratesPer100Stars` factions based on rim
 * fuel habitats (the guaranteed oases first), at least 1,000,000 from any other pirate base and clear of colonies.
 */
function wildExtraFactions(galaxy: Galaxy): void {
    const want = Math.round((frontierParam(galaxy, 'rimWildExtraPiratesPer100Stars') * galaxy.starCount) / 100);
    if (want <= 0) return;
    const fuelIds = galaxy.resourceSystem.fuelResources.map((r) => r.resourceId);
    const oases = rimFuelOases(galaxy);
    const rest = galaxy.habitats.filter((h) => !oases.includes(h) && rimDepth(galaxy, h.xpos, h.ypos) !== null && h.resources.some((r) => fuelIds.includes(r.resourceId)));
    const pool = [...oases, ...rest].filter((h) => !h.hasBeenDestroyed);
    const ctx = { independentColonies: galaxy.independentColonies, startingAge: galaxy.startingAge, difficultyLevel: galaxy.difficultyLevel };
    const cap = Math.trunc(frontierParam(galaxy, 'rimPirateFactionCap'));
    let made = 0;
    for (let tries = 0; made < want && (cap <= 0 || galaxy.pirateEmpires.length < cap) && tries < want * 20 && pool.length > 0 && galaxy.nextEmpireId < galaxy.maximumEmpireCount; tries++) {
        const h = pool[galaxy.rnd.next(0, pool.length)];
        if (h.empire !== null && h.empire !== galaxy.independentEmpire) continue;
        if (galaxy.pirateEmpires.some((e) => e.pirateEmpireBaseHabitat !== null && galaxy.calculateDistance(h.xpos, h.ypos, e.pirateEmpireBaseHabitat.xpos, e.pirateEmpireBaseHabitat.ypos) < 1000000)) continue;
        const c = galaxy.findNearestColony(h.xpos, h.ypos, null, false);
        if (c !== null && galaxy.calculateDistance(h.xpos, h.ypos, c.xpos, c.ypos) <= galaxy.sizeScale / 50) continue;
        if (galaxy.independentColonies.some((x) => x.systemIndex === h.systemIndex)) continue;
        const pt = galaxy.selectRelativeHabitatSurfacePoint(h);
        generatePirateEmpireRandom(galaxy, ctx, h, Math.trunc(pt.x), Math.trunc(pt.y), true);
        made++;
    }
}

function wildPiratesStart(galaxy: Galaxy): void {
    wildExtraFactions(galaxy);
    const n = Math.trunc(frontierParam(galaxy, 'rimWildPirateStartShips'));
    for (const e of rimPirateFactions(galaxy)) reinforce(galaxy, e, n, 1e9);
}
function wildPiratesYear(galaxy: Galaxy): void {
    const n = Math.trunc(frontierParam(galaxy, 'rimWildPirateYearlyShips'));
    const cap = Math.trunc(frontierParam(galaxy, 'rimWildPirateFleetCap'));
    for (const e of rimPirateFactions(galaxy)) reinforce(galaxy, e, n, cap);
}
registerScenarioYearly({ id: 'rimFrontier.wildPirates', flag: RIM_FRONTIER_FLAG, run: wildPiratesYear });

// ---- derelicts ----
const DERELICTS = [BuiltObjectSubRole.CapitalShip, BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.Carrier, BuiltObjectSubRole.Destroyer];

function wildDerelicts(galaxy: Galaxy): void {
    const n = Math.round((frontierParam(galaxy, 'rimWildDerelictsPer100Stars') * galaxy.starCount) / 100);
    const maker = galaxy.pirateEmpires.find((e) => e.designs != null) ?? galaxy.empires.find((e) => e.designs != null) ?? null;
    if (n <= 0 || maker === null) return;
    const rim = galaxy.habitats.filter((h) => !h.hasBeenDestroyed && rimDepth(galaxy, h.xpos, h.ypos) !== null);
    if (rim.length === 0) return;
    const bases = rimPirateFactions(galaxy).map((e) => e.pirateEmpireBaseHabitat as Habitat);
    const share = frontierParam(galaxy, 'rimWildDerelictPirateShare');
    const advance = frontierParam(galaxy, 'rimWildDerelictTechAdvance');
    const near = (galaxy.sectorSize ?? 2000000) * 0.5;
    const st = rimFrontierState(galaxy);
    st.derelicts ??= [];
    for (let i = 0; i < n; i++) {
        // Candidates: sample 12 rim habitats; deeper wins, and a pirate-guarded one when this derelict is meant to be.
        const guarded = bases.length > 0 && galaxy.rnd.nextDouble() < share;
        let best: Habitat | null = null;
        let bestScore = -1;
        for (let k = 0; k < 12; k++) {
            const h = rim[galaxy.rnd.next(0, rim.length)];
            if (h.empire !== null && h.empire !== galaxy.independentEmpire) continue;
            const depth = rimDepth(galaxy, h.xpos, h.ypos) ?? 0;
            let score = depth;
            if (guarded) {
                const d = Math.min(...bases.map((b) => galaxy.calculateDistance(b.xpos, b.ypos, h.xpos, h.ypos)));
                score = d <= near ? 1 + depth : 1 - d / (galaxy.sizeX || 1);
            }
            if (score > bestScore) {
                bestScore = score;
                best = h;
            }
        }
        if (best === null) continue;
        const sub = DERELICTS[galaxy.rnd.next(0, DERELICTS.length)];
        let design = generateDesignFromSpec(galaxy, maker, galaxyDesignSpecificationBySubRole(sub), advance, galaxyCurrentStarDate(galaxy));
        if (design === null || design.warpSpeed <= 0) continue;
        design = cloneDesign(design);
        st.derelicts.push(generateAbandonedBuiltObject(galaxy, best, design));
    }
}
registerScenarioGameStart({
    id: 'rimFrontier.wildStart',
    flag: RIM_FRONTIER_FLAG,
    order: 50,
    run: (galaxy) => {
        wildPiratesStart(galaxy);
        wildDerelicts(galaxy);
    },
});

registerScenarioEvent({
    id: 'rimFrontier.derelictClaimed',
    flag: RIM_FRONTIER_FLAG,
    event: 'abandonedShipClaimed',
    run: (galaxy, e) => {
        const st = rimFrontierState(galaxy);
        if (st.derelicts?.includes(e.builtObject)) (st.derelictClaims ??= []).push({ name: e.builtObject.name, empireId: e.empire.empireId, at: galaxyStarDate(galaxy) });
    },
});
