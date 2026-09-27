// Scenario package 19h "rim frontier geography" (tasks/19-mod-layer-scenarios.md §19h): hook registrations, all behind
// the `rimFrontier` flag. Not a port; each hook sits beside the ported code it extends:
//   1 storm belt      after Galaxy.4.cs GenerateNebulae (GalaxyNebulaeGenerator.cs): LightningDamage NebulaCloud
//                     locations on a radius curve — the stock storm rules (CheckInStorm, ApplyLocationEffects, the
//                     survive-storms checks, SetupSun's star-type re-roll) then apply unchanged.
//   2 sparser rim     Galaxy.5.cs SetupSun position loop: candidates past the thinning radius are rejected (re-rolled).
//   3 gravity shoals  NebulaCloud locations with no stock effect; a hyperjump step that enters one ends at its edge
//                     (BuiltObject.2.cs HyperTo in-flight step, cmdMovement.ts) — the BaconBuiltObject.cs 2493
//                     IsOutsideStarGravityWell rule ("no hyperspace inside the well") applied to fixed deep-space points.
//   4 fuel scarcity   resourcePlacement rules for Caslon / Hydrogen (Galaxy.selectResources' scenario filter).
//   5 sensor fog      Empire.9.cs FindShipOutsideSystemWithScanRange: the ship-sensor range toward rim targets.
//   6 map scale       createGame's generation options: sector counts × extent (SectorSize stays 2,000,000), star count.
// Rnd: generation draws only from a package-owned Random seeded from the galaxy seed (never galaxy.rnd); a rejected star
// position makes the stock SetupSun loop draw its re-roll from galaxy.rnd, so flag-on games re-pin (flag off: no hook
// runs). The runtime hooks never draw.

import type { Galaxy } from '../../galaxy';
import { GalaxyLocation, GalaxyLocationEffectType, GalaxyLocationShape, GalaxyLocationType } from '../../galaxyLocation';
import { Random } from '../../random';
import { radiusFraction, registerScenarioGeneration, registerScenarioQuery } from '../hooks';
import type { GalaxyScenario } from '../state';
import {
    RIM_FRONTIER_DEFAULTS,
    RIM_FRONTIER_FLAG,
    RIM_FRONTIER_FUELS,
    SHOAL_DIAMETER_FRACTION,
    SHOAL_MAX_RADIUS,
    SHOAL_MIN_RADIUS,
    frontierParam,
    rimFogMultiplier,
    rimFrontierState,
    shoalStopOnPath,
    type RimFrontierParam,
} from './common';

/** The package's generation Random per galaxy (generation-only: not saved, never used after createGame). */
const generationRnd = new WeakMap<Galaxy, Random>();

function frontierRnd(galaxy: Galaxy): Random {
    let r = generationRnd.get(galaxy);
    if (r === undefined) {
        r = new Random(((galaxy.randomSeed ^ 0x19c0ffee) >>> 1) & 0x7fffffff);
        generationRnd.set(galaxy, r);
    }
    return r;
}

function setupParam(s: GalaxyScenario, name: RimFrontierParam): number {
    const v = s.params[name];
    return typeof v === 'number' ? v : RIM_FRONTIER_DEFAULTS[name];
}

/** 19h-6 map scale + 19h-4 fuel bias: before generation. */
function frontierSetup(s: GalaxyScenario, resources: readonly { name: string; resourceId: number }[], o: { starCount: number; sectorWidth: number; sectorHeight: number }): void {
    const extent = setupParam(s, 'rimFrontierExtent');
    if (extent !== 1.0) {
        o.sectorWidth = Math.round(o.sectorWidth * extent);
        o.sectorHeight = Math.round(o.sectorHeight * extent);
    }
    const stars = Math.trunc(setupParam(s, 'rimFrontierStarCount'));
    if (stars > 0) o.starCount = stars;
    const fuelMax = setupParam(s, 'rimFrontierFuelMaxRadius');
    if (fuelMax < 1.5) {
        for (const name of RIM_FRONTIER_FUELS) {
            const res = resources.find((r) => r.name === name);
            if (res === undefined || s.resourceRules.some((r) => r.resourceId === res.resourceId)) continue;
            s.resourceRules.push({ resourceId: res.resourceId, minRadius: 0, maxRadius: fuelMax });
        }
    }
}

const STORM_WORDS = ['Storm', 'Tempest', 'Typhoon', 'Squall', 'Turmoil', 'Maelstrom']; // GalaxyNebulaeGenerator GenerateCloudName

function cloudPictureRef(galaxy: Galaxy, rnd: Random): number {
    const clouds = galaxy.galaxyLocations.filter((l) => l.type === GalaxyLocationType.NebulaCloud);
    return clouds.length > 0 ? clouds[rnd.next(0, clouds.length)].pictureRef : 0;
}

/** A system-name prefix borrowed from a stock cloud ("<system name> <word>", GalaxyNebulaeGenerator GenerateCloudName). */
function systemName(galaxy: Galaxy, rnd: Random): string {
    const locs = galaxy.galaxyLocations;
    if (locs.length === 0) return 'Rim';
    const name = locs[rnd.next(0, locs.length)].name;
    const i = name.lastIndexOf(' ');
    return i > 0 ? name.substring(0, i) : name;
}

function addLocation(galaxy: Galaxy, loc: GalaxyLocation): void {
    galaxy.galaxyLocations.push(loc);
    galaxy.addGalaxyLocationIndex(loc);
}

/** A point at radius fraction f and a random angle (the randomPointInRing scale: sizeX / 2). */
function ringPoint(galaxy: Galaxy, rnd: Random, fMin: number, fMax: number): { x: number; y: number } {
    const cx = galaxy.sizeX / 2.0;
    const cy = galaxy.sizeY / 2.0;
    const f = fMin + rnd.nextDouble() * (fMax - fMin);
    const a = rnd.nextDouble() * Math.PI * 2.0;
    return { x: cx + Math.cos(a) * f * cx, y: cy + Math.sin(a) * f * cx };
}

function insideGalaxy(galaxy: Galaxy, x: number, y: number, w: number): boolean {
    return x >= 0 && y >= 0 && x + w <= galaxy.sizeX && y + w <= galaxy.sizeY;
}

/** 19h-1 storm belt + 19h-3 shoals: after the faithful nebulae, before star placement (stars avoid clouds 14 in 15). */
function frontierAfterNebulae(galaxy: Galaxy): void {
    const rnd = frontierRnd(galaxy);
    const st = rimFrontierState(galaxy);
    const inner = frontierParam(galaxy, 'rimFrontierBeltInner');
    const density = frontierParam(galaxy, 'rimFrontierStormDensity');
    if (density > 0) {
        // Stock plain clouds in the belt turn into ion storms with probability `density`.
        for (const loc of galaxy.galaxyLocations) {
            if (loc.type !== GalaxyLocationType.NebulaCloud || loc.effect !== GalaxyLocationEffectType.MovementSlowed) continue;
            const c = loc.resolveLocationCenter();
            if (radiusFraction(galaxy, c.x, c.y) < inner) continue;
            if (rnd.nextDouble() >= density) continue;
            loc.effect = GalaxyLocationEffectType.LightningDamage;
            const i = loc.name.lastIndexOf(' ');
            loc.name = (i > 0 ? loc.name.substring(0, i) : loc.name) + ' ' + STORM_WORDS[rnd.next(0, STORM_WORDS.length)];
        }
        // Plus new storm clouds in the belt (3 per sector column at density 1), sized like scattered clouds.
        const count = Math.round(density * 3 * galaxy.sectorWidth);
        const minSize = Math.trunc(galaxy.sizeX / 35);
        const maxSize = Math.trunc(galaxy.sizeX / 15);
        for (let i = 0, tries = 0; i < count && tries < count * 10; tries++) {
            const p = ringPoint(galaxy, rnd, inner, 0.98);
            const size = rnd.next(minSize, maxSize);
            const x = p.x - Math.trunc(size / 2);
            const y = p.y - Math.trunc(size / 2);
            if (!insideGalaxy(galaxy, x, y, size)) continue;
            const loc = new GalaxyLocation(systemName(galaxy, rnd) + ' ' + STORM_WORDS[rnd.next(0, STORM_WORDS.length)], GalaxyLocationType.NebulaCloud, x, y, size, size, cloudPictureRef(galaxy, rnd));
            loc.showName = true;
            loc.effect = GalaxyLocationEffectType.LightningDamage;
            addLocation(galaxy, loc);
            st.addedStorms.push(loc);
            i++;
        }
    }
    const shoals = Math.trunc(frontierParam(galaxy, 'rimFrontierShoalCount'));
    const diameter = Math.trunc(galaxy.sizeX * SHOAL_DIAMETER_FRACTION);
    for (let i = 0, tries = 0; i < shoals && tries < shoals * 20; tries++) {
        const p = ringPoint(galaxy, rnd, SHOAL_MIN_RADIUS, SHOAL_MAX_RADIUS);
        const x = p.x - diameter / 2;
        const y = p.y - diameter / 2;
        if (!insideGalaxy(galaxy, x, y, diameter)) continue;
        if (st.shoals.some((s) => Math.hypot(s.xpos - x, s.ypos - y) < diameter * 3)) continue;
        const loc = new GalaxyLocation(systemName(galaxy, rnd) + ' Shoal', GalaxyLocationType.NebulaCloud, x, y, diameter, diameter, cloudPictureRef(galaxy, rnd));
        loc.showName = true;
        loc.effect = GalaxyLocationEffectType.None;
        loc.shape = GalaxyLocationShape.Circular;
        addLocation(galaxy, loc);
        st.shoals.push(loc);
        i++;
    }
}

/** 19h-2 sparser rim: SetupSun candidates past the thinning radius survive with probability 1 − factor. */
function frontierAcceptStar(galaxy: Galaxy, x: number, y: number): boolean {
    const factor = frontierParam(galaxy, 'rimFrontierThinFactor');
    if (factor <= 0 || radiusFraction(galaxy, x, y) < frontierParam(galaxy, 'rimFrontierThinRadius')) return true;
    return frontierRnd(galaxy).nextDouble() >= factor;
}

registerScenarioGeneration({ id: 'rimFrontier.generation', flag: RIM_FRONTIER_FLAG, setup: frontierSetup, afterNebulae: frontierAfterNebulae, acceptStarPosition: frontierAcceptStar });

registerScenarioQuery({ id: 'rimFrontier.fog', flag: RIM_FRONTIER_FLAG, query: 'scanRangeModifier', run: (galaxy, value, a) => value * rimFogMultiplier(galaxy, a.x, a.y) });

registerScenarioQuery({
    id: 'rimFrontier.shoals',
    flag: RIM_FRONTIER_FLAG,
    query: 'hyperjumpStop',
    run: (galaxy, value, a) => {
        if (value !== null || galaxy.scenario === null || !('rimFrontier' in galaxy.scenario.state)) return value;
        const shoals = rimFrontierState(galaxy).shoals;
        return shoals.length === 0 ? null : shoalStopOnPath(shoals, a.fromX, a.fromY, a.toX, a.toY, a.exitX, a.exitY);
    },
});
