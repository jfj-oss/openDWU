// Our addition (not in DW:U): the new-game wizard's resource sliders (Colonization page "Resources" panel).
//
// Five 0..4 sliders, index 2 = Normal = the original game:
//   density     — scales every deposit's prevalence roll in Galaxy.4.cs SelectResources (the CryptoRnd.NextDouble() <
//                 ResourcePrevalence.Prevalence test), i.e. how many planets / moons / asteroids / gas clouds get resources;
//   amount      — scales the rolled abundance (0..1000; mining rate, industry.ts extraction volume);
//   luxury      — an extra prevalence + abundance factor on the (non-restricted) luxury resources (ResourceGroup.Luxury);
//   fuel        — an extra prevalence + abundance factor on the IsFuel resources (Hydrogen, Caslon);
//   superLuxury — the count of restricted deposits (Loros Fruit, Korabbian Spice, Zentabia Fluid) placed by Galaxy.4.cs
//                 SetRestrictedResources (gameStartTail.ts setRestrictedResources).
//
// Normal on every slider stores nothing (Galaxy.resourceGeneration stays undefined), and every hook takes the stock code
// path with the stock Rnd calls, so a Normal galaxy is byte-identical to the original. When a slider lowers fuel
// (density, amount or fuel below Normal), startHabitats.ts ensureHomeSystemFuel makes sure every empire's home system
// still holds a usable fuel deposit (the C# only guarantees that for pre-warp starts: Start.2.cs 1174-1273
// ensureImportantPreWarpResources, which keeps running unchanged).

import type { Resource } from './data/resources';
import { ResourceGroup, resourceGroupOf } from './resourceSystem';

export const RESOURCE_SLIDER_NORMAL = 2;
export const RESOURCE_DENSITY_TICKS = ['Very Sparse', 'Sparse', 'Normal', 'Rich', 'Very Rich'] as const;
export const RESOURCE_AMOUNT_TICKS = ['Very Poor', 'Poor', 'Normal', 'Rich', 'Very Rich'] as const;
export const LUXURY_RESOURCE_TICKS = ['Very Rare', 'Rare', 'Normal', 'Common', 'Very Common'] as const;
export const FUEL_RESOURCE_TICKS = ['Very Scarce', 'Scarce', 'Normal', 'Plentiful', 'Abundant'] as const;
export const SUPER_LUXURY_TICKS = ['Almost none', 'Rare', 'Normal', 'Common', 'Several per region'] as const;

/** The five slider positions (0..4 each; 2 = Normal). */
export interface ResourceGenerationSettings {
    density: number;
    amount: number;
    luxury: number;
    fuel: number;
    superLuxury: number;
}

// Factors per slider position. Prevalence results are capped at 1 (a certain roll); abundance at 1..1000.
const DENSITY_PREVALENCE = [0.35, 0.65, 1, 1.4, 1.8];
const AMOUNT_ABUNDANCE = [0.5, 0.75, 1, 1.3, 1.6];
const LUXURY_PREVALENCE = [0.3, 0.6, 1, 1.6, 2.2];
const LUXURY_ABUNDANCE = [0.6, 0.8, 1, 1.2, 1.4];
const FUEL_PREVALENCE = [0.4, 0.7, 1, 1.4, 1.8];
const FUEL_ABUNDANCE = [0.6, 0.8, 1, 1.2, 1.4];

function clampIndex(v: number | undefined): number {
    if (v === undefined || !Number.isFinite(v)) return RESOURCE_SLIDER_NORMAL;
    return Math.max(0, Math.min(4, Math.round(v)));
}

/** Clamped settings, or null when every slider is Normal (= the original game; nothing is stored). */
export function normalizeResourceGeneration(s: Partial<ResourceGenerationSettings> | null | undefined): ResourceGenerationSettings | null {
    if (s == null) return null;
    const r: ResourceGenerationSettings = {
        density: clampIndex(s.density),
        amount: clampIndex(s.amount),
        luxury: clampIndex(s.luxury),
        fuel: clampIndex(s.fuel),
        superLuxury: clampIndex(s.superLuxury),
    };
    return resourceGenerationIsNormal(r) ? null : r;
}

export function resourceGenerationIsNormal(s: ResourceGenerationSettings): boolean {
    return s.density === 2 && s.amount === 2 && s.luxury === 2 && s.fuel === 2 && s.superLuxury === 2;
}

function isLuxury(def: Resource): boolean {
    return resourceGroupOf(def) === ResourceGroup.Luxury && def.superLuxuryBonusAmount <= 0;
}

/** Prevalence factor for `def` (density × its group's factor). */
export function prevalenceFactor(s: ResourceGenerationSettings, def: Resource): number {
    let f = DENSITY_PREVALENCE[s.density];
    if (def.isFuel) f *= FUEL_PREVALENCE[s.fuel];
    else if (isLuxury(def)) f *= LUXURY_PREVALENCE[s.luxury];
    return f;
}

/** Abundance factor for `def` (amount × its group's factor). */
export function abundanceFactor(s: ResourceGenerationSettings, def: Resource): number {
    let f = AMOUNT_ABUNDANCE[s.amount];
    if (def.isFuel) f *= FUEL_ABUNDANCE[s.fuel];
    else if (isLuxury(def)) f *= LUXURY_ABUNDANCE[s.luxury];
    return f;
}

/** The SelectResources prevalence threshold (float, as the C# compares) for `def`; `prevalence` unchanged at factor 1. */
export function scaledPrevalence(s: ResourceGenerationSettings, def: Resource, prevalence: number): number {
    const f = prevalenceFactor(s, def);
    return f === 1 ? prevalence : Math.min(1, Math.fround(prevalence * f));
}

/** A rolled abundance scaled for `def` (1..1000 short range); unchanged at factor 1. */
export function scaledAbundance(s: ResourceGenerationSettings, def: Resource, abundance: number): number {
    const f = abundanceFactor(s, def);
    return f === 1 ? abundance : Math.max(1, Math.min(1000, Math.round(abundance * f)));
}

/** True when a slider lowers fuel below the original (the home-system fuel guarantee then applies). */
export function resourceGenerationReducesFuel(s: ResourceGenerationSettings): boolean {
    return DENSITY_PREVALENCE[s.density] * FUEL_PREVALENCE[s.fuel] < 1 || AMOUNT_ABUNDANCE[s.amount] * FUEL_ABUNDANCE[s.fuel] < 1;
}

/** The minimum abundance a home-system fuel deposit must have under the guarantee (and the roll range used to add one,
 *  Start.2.cs 1262 `Rnd.Next(400, 1000)` for a pre-warp fuel resource). */
export const HOME_FUEL_MIN_ABUNDANCE = 400;
export const HOME_FUEL_MAX_ABUNDANCE = 1000;
