// Scenario package 19h "rim frontier geography" — params, saved state and the pure geometry the hooks use
// (tasks/19-mod-layer-scenarios.md §19h). Not a port. Nothing here draws galaxy.rnd.

import type { Galaxy } from '../../galaxy';
import type { GalaxyLocation } from '../../galaxyLocation';
import type { Habitat } from '../../types';
import type { BuiltObject } from '../../builtObject';
import { scenarioParam, scenarioState } from '../state';
import { radiusFraction } from '../hooks';

export const RIM_FRONTIER_FLAG = 'rimFrontier';
/** scenarioState key. */
export const RIM_FRONTIER_STATE = 'rimFrontier';

/** Manifest defaults (scenarios/rim-frontier/scenario.json) — the fallbacks of scenarioParam. */
export const RIM_FRONTIER_DEFAULTS = {
    rimFrontierBeltInner: 0.7,
    rimFrontierStormDensity: 0.5,
    rimFrontierThinRadius: 0.6,
    rimFrontierThinFactor: 0.5,
    rimFrontierShoalCount: 4,
    rimFrontierFuelMaxRadius: 0.65,
    rimFrontierFogFactor: 0.5,
    rimFrontierExtent: 1.0,
    rimFrontierStarCount: 0,
    /** 19h keepStartsOut: >0 keeps ordinary player/AI capitals inside the belt inner radius (the Concord's own
     *  homePlacement rule is untouched). 0 = stock placement. */
    rimFrontierKeepStartsOut: 1,
    /** 19h pirate share: fraction of new pirate factions (in their creation order) placed in the rim; the rest go in
     *  the core. 0 = stock placement. */
    rimFrontierPirateRimShare: 0.85,
    /** 19h base placement: extra buffer added past a rim herd's home range (RimHerd.homeRange, rimFauna/common.ts)
     *  that a new base (pirate or independent) may not land inside. */
    rimFrontierNestAvoidRadius: 5000,
    /** 19h pirate hunting: a pirate faction only considers herds within this distance of its base. */
    rimFrontierHuntRange: 300000,
    /** 19h pirate hunting: yearly chance a faction with a herd in range sends ships after it. 0 = off. */
    rimFrontierHuntChance: 0.3,
    /** 19h pirate hunting: credits paid per herd member when a hunt succeeds (not a port: DW:U has no such bounty). */
    rimFrontierHuntBounty: 500,
    /** 19h-11 fuel oases: guaranteed Caslon/Hydrogen sources per rim sector (sector centre radiusFraction ≥ belt inner),
     *  added after the faithful resource placement so fuel scarcity never leaves a rim sector with none — as long as
     *  the sector has a habitat resources.txt/habitat-type rules would let carry either fuel at all (a lone star with
     *  no planets, or gas giants that all rolled FrozenGasGiant rather than GasGiant, stay empty; not invented). 0 = off. */
    rimFrontierOasesPerSector: 1,
    /** 19h-11 fuel oases: range from a candidate pirate base within which an oasis is preferred (≈ one sector; Galaxy.3.cs
     *  SectorSize 2,000,000). */
    rimFrontierOasisRange: 2000000,
    /** Explicit ceiling on the game-start pirate-faction count (pirates.ts generateNewPirateEmpires, via hooks.ts's
     *  pirateFactionCount query): min(stock count, this) when > 0. 0 = stock rule (no cap). */
    rimPirateFactionCap: 0,
    /** Wild rim (all below): AI colonisation target value multiplier at the belt edge / deep in the rim (depth 0 -> 1). 1 = stock. */
    rimWildColonyValueEdge: 0.5,
    rimWildColonyValueDeep: 0.1,
    /** Wild rim: share of base habitat quality lost at the deepest point of the rim (scaled by depth; 0 = off). */
    rimWildQualityLoss: 0.5,
    /** Wild rim: factor on pirate control growth over a rim colony (stock 1). */
    rimWildPirateControlFactor: 2.0,
    /** Wild rim: extra warships a rim pirate base starts with, and per-year top-up up to the fleet cap (0 = off). */
    rimWildPirateStartShips: 3,
    rimWildPirateYearlyShips: 1,
    rimWildPirateFleetCap: 14,
    /** Wild rim: extra pirate factions per 100 stars founded in the rim at game start, beside the share-split ones (0 = off). */
    rimWildExtraPiratesPer100Stars: 0.8,
    /** Wild rim: defensive bases a rim pirate base keeps at its habitat (stock: none). */
    rimWildPirateDefenceBases: 2,
    /** Wild rim: derelict advanced warships per 100 stars placed in the rim at game start (0 = off). */
    rimWildDerelictsPer100Stars: 2.5,
    /** Wild rim: tech advance over the era of a derelict's design (generateDesignFromSpec techAdvanceAmount; the stock abandoned ships use 2-3). */
    rimWildDerelictTechAdvance: 6,
    /** Wild rim: share of derelicts parked near a rim pirate base (others sit deep in the rim; each may hold a Kaltor). */
    rimWildDerelictPirateShare: 0.6,
} as const;
export type RimFrontierParam = keyof typeof RIM_FRONTIER_DEFAULTS;

/** Fuel resources biased inward (resources.txt names; Hydrogen id 8, Caslon id 18). */
export const RIM_FRONTIER_FUELS = ['Caslon', 'Hydrogen'] as const;
/** Gravity shoals sit in this radius band (between the core and the rim, so core-to-rim jumps cross it). */
export const SHOAL_MIN_RADIUS = 0.4;
export const SHOAL_MAX_RADIUS = 0.85;
/** Shoal diameter as a fraction of sizeX (the nebula generator's smallest scattered cloud is sizeX / 35). */
export const SHOAL_DIAMETER_FRACTION = 1 / 25;

export function frontierParam(galaxy: Galaxy, name: RimFrontierParam): number {
    return scenarioParam(galaxy, name, RIM_FRONTIER_DEFAULTS[name]);
}

/** A pirate faction's in-progress herd hunt (19h pirate hunting): plain data, resolved on a later yearly check. */
export interface RimFrontierPirateHunt {
    factionId: number;
    herdId: number;
    /** Herd member count when the hunt was ordered (the bounty base if it succeeds). */
    size: number;
    /** Star date the hunt was ordered (a hunt still open 2 years later is abandoned, no bounty). */
    startedAt: number;
}

/** Saved state (`scenarioState(galaxy, 'rimFrontier')`): graph references and plain data only. */
export interface RimFrontierState {
    /** The gravity shoals (NebulaCloud GalaxyLocations with no stock effect, so the map draws them as clouds). */
    shoals: GalaxyLocation[];
    /** The storm clouds the belt added (the converted stock clouds are not listed). */
    addedStorms: GalaxyLocation[];
    /** One entry per pirate faction currently hunting a herd (by empireId). */
    pirateHunts: RimFrontierPirateHunt[];
    /** 19h-11: the habitats picked as guaranteed rim fuel sources (one game's worth; not the pre-existing faithful ones). */
    fuelOases: Habitat[];
    /** Wild rim: the derelict warships placed at game start (absent in older saves). */
    derelicts?: BuiltObject[];
    /** Wild rim: claims of those derelicts, in order (plain data). */
    derelictClaims?: { name: string; empireId: number; at: number }[];
    /** Wild rim: habitat-quality totals over the rim at generation, before and after the loss. */
    quality?: { n: number; before: number; after: number };
}

export function rimFrontierState(galaxy: Galaxy): RimFrontierState {
    return scenarioState<RimFrontierState>(galaxy, RIM_FRONTIER_STATE, () => ({ shoals: [], addedStorms: [], pirateHunts: [], fuelOases: [] }));
}

/** The state if the package has run in this game (never creates it: safe from pure query handlers / other packages). */
export function peekRimFrontierState(galaxy: Galaxy): RimFrontierState | null {
    const s = galaxy.scenario;
    if (s === null || !(RIM_FRONTIER_STATE in s.state)) return null;
    return s.state[RIM_FRONTIER_STATE] as RimFrontierState;
}

/**
 * 19h-11: the habitats holding a guaranteed rim fuel oasis (empty with the flag off, `rimFrontierOasesPerSector` 0, or
 * no rim sector needing one). For the independents package to weight station placement toward (not imported here —
 * kept a one-way read like rimFauna's peek accessors).
 */
export function rimFuelOases(galaxy: Galaxy): readonly Habitat[] {
    return peekRimFrontierState(galaxy)?.fuelOases ?? [];
}

/** 19h-5: the ship-sensor range multiplier toward (x, y): the fog factor inside the rim band, else 1. */
export function rimFogMultiplier(galaxy: Galaxy, x: number, y: number): number {
    return radiusFraction(galaxy, x, y) >= frontierParam(galaxy, 'rimFrontierBeltInner') ? frontierParam(galaxy, 'rimFrontierFogFactor') : 1.0;
}

/**
 * 19h-3: where a hyperjump step from (fromX, fromY) to (toX, toY) — clipped at the jump's exit — first enters a shoal,
 * nudged 1 unit inside so a jump restarted from there ignores that shoal (a jump that starts inside a shoal is not
 * stopped by it). Null when the step crosses no shoal (or only grazes one).
 */
export function shoalStopOnPath(shoals: readonly GalaxyLocation[], fromX: number, fromY: number, toX: number, toY: number, exitX: number, exitY: number): { x: number; y: number } | null {
    let dx = toX - fromX;
    let dy = toY - fromY;
    let len = Math.sqrt(dx * dx + dy * dy);
    if (!(len > 0)) return null;
    dx /= len;
    dy /= len;
    const toExit = Math.sqrt((exitX - fromX) * (exitX - fromX) + (exitY - fromY) * (exitY - fromY));
    if (toExit < len) len = toExit;
    let best = Number.MAX_VALUE;
    for (const s of shoals) {
        const r = s.width / 2.0;
        const mx = fromX - (s.xpos + r);
        const my = fromY - (s.ypos + s.height / 2.0);
        const c = mx * mx + my * my - r * r;
        if (c <= 0) continue; // starts inside (or on the edge)
        const b = mx * dx + my * dy;
        const disc = b * b - c;
        if (disc < 1.0) continue; // misses or grazes
        const t = -b - Math.sqrt(disc);
        if (t < 0 || t > len || t >= best) continue;
        best = t;
    }
    if (best === Number.MAX_VALUE) return null;
    return { x: fromX + dx * (best + 1.0), y: fromY + dy * (best + 1.0) };
}
