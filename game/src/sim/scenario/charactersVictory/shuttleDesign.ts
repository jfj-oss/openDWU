// Characters & Victory: the VIP Shuttle design role (docs/CHARACTERS_AND_VICTORY.md §4.2). Not a port: the design is
// the stock PassengerShip template run through the ported Empire.GenerateDesignFromSpec (designGeneration.ts), with
// only the allowed component families kept and padded with shields / armour to the fixed hull size. It is held in the
// add-on state (never in empire.designs), so no stock build / retrofit / force-structure path sees it.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Design } from '../../design';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { ComponentType } from '../../data/components';
import { ComponentCategoryType } from '../../data/policies';
import { loadDesignSpecification, type DesignSpecification } from '../../data/designSpecifications';
import { componentDefinitionsStatic, generateDesignFromSpec } from '../../designGeneration';
import { cloneDesign } from '../../gameStartTail';
import { galaxyStarDate } from '../../tick/simTime';
import { scenarioText } from '../messages';
import { cvEmpire, cvParam } from './common';

/** The component types a VIP Shuttle may carry (shields, armour, engines, hyperdrive, reactor, fuel, quarters, bridge). */
export const VIP_ALLOWED_COMPONENTS: ReadonlySet<ComponentType> = new Set([
    ComponentType.Shields,
    ComponentType.ShieldRecharge,
    ComponentType.Armor,
    ComponentType.EngineMainThrust,
    ComponentType.EngineVectoring,
    ComponentType.HyperDrive,
    ComponentType.Reactor,
    ComponentType.EnergyCollector,
    ComponentType.StorageFuel,
    ComponentType.EnergyToFuel,
    ComponentType.HabitationLifeSupport,
    ComponentType.HabitationHabModule,
    ComponentType.HabitationMedicalCenter,
    ComponentType.HabitationRecreationCenter,
    ComponentType.ComputerCommandCenter,
]);

export function vipComponentAllowed(type: ComponentType): boolean {
    return VIP_ALLOWED_COMPONENTS.has(type);
}

/** Template amounts the add-on asks for (the template's own for the rest; disallowed types are zeroed). */
const RULE_AMOUNTS: Partial<Record<ComponentType, number>> = {
    [ComponentType.StoragePassenger]: 0,
    [ComponentType.Shields]: 4,
    [ComponentType.Armor]: 4,
    [ComponentType.EngineMainThrust]: 6,
    [ComponentType.StorageFuel]: 3,
};

/** Category-only rules kept (and their amounts where the add-on sets one). */
const VIP_ALLOWED_CATEGORIES: ReadonlySet<ComponentCategoryType> = new Set([
    ComponentCategoryType.Armor,
    ComponentCategoryType.Shields,
    ComponentCategoryType.ShieldRecharge,
    ComponentCategoryType.Engine,
    ComponentCategoryType.HyperDrive,
    ComponentCategoryType.Reactor,
    ComponentCategoryType.EnergyCollector,
    ComponentCategoryType.Habitation,
]);
const CATEGORY_AMOUNTS: Partial<Record<ComponentCategoryType, number>> = {
    [ComponentCategoryType.Shields]: 4,
    [ComponentCategoryType.HyperDrive]: 1,
};

/** The best (newest generated) component of `type` in `d`, or null. */
function componentOf(d: Design, type: ComponentType): Design['components'][number] | null {
    let best: Design['components'][number] | null = null;
    for (const c of d.components) if (c.type === type && (best === null || c.size >= best.size)) best = c;
    return best;
}

/** Signature of the allowed component definitions the empire can build now (the auto-design is rebuilt when it changes). */
export function vipTechSignature(galaxy: Galaxy, empire: Empire, d: Design | null): string {
    void galaxy;
    void empire;
    if (d === null) return '';
    const ids = d.components.map((c) => c.componentId).sort((a, b) => a - b);
    return ids.join(',');
}

/**
 * Builds the empire's VIP Shuttle: GenerateDesignFromSpec on the PassengerShip template (passenger bays, weapons,
 * cargo, troops, sensors and the rest zeroed / stripped), padded with shields and armour to `cvShuttleSize`. Draws
 * Rnd (design naming). Null when the empire cannot design one.
 */
export function generateVipShuttleDesign(galaxy: Galaxy, empire: Empire): Design | null {
    const base = loadDesignSpecification(galaxy.designSpecificationTexts, 'PassengerShip', BuiltObjectSubRole.PassengerShip, true, empire.dominantRace?.name ?? null, false, false);
    if (base === null) return null;
    const spec: DesignSpecification = { ...base, componentRules: base.componentRules.map((c) => ({ ...c })) };
    for (const r of spec.componentRules) {
        // A rule names a component type, or only a category (componentType Undefined: e.g. Shields, HyperDrive).
        if (r.componentType === ComponentType.Undefined) {
            const want = CATEGORY_AMOUNTS[r.componentCategory];
            if (want !== undefined) r.amount = want;
            else if (!VIP_ALLOWED_CATEGORIES.has(r.componentCategory)) r.amount = 0;
            continue;
        }
        const want = RULE_AMOUNTS[r.componentType];
        if (want !== undefined) r.amount = want;
        else if (!vipComponentAllowed(r.componentType)) r.amount = 0;
    }
    let design: Design | null;
    try {
        design = generateDesignFromSpec(galaxy, empire, spec, 0.0, galaxyStarDate(galaxy));
    } catch {
        return null;
    }
    if (design === null) return null;
    design.components = design.components.filter((c) => vipComponentAllowed(c.type));
    design.reDefine();
    const target = Math.min(cvParam(galaxy, 'cvShuttleSize'), empire.maximumConstructionSize(BuiltObjectSubRole.PassengerShip));
    const shield = componentOf(design, ComponentType.Shields);
    const armour = componentOf(design, ComponentType.Armor);
    // Pad shields and armour alternately up to the fixed size (no more than 40 components either way).
    for (let i = 0; i < 40 && (shield !== null || armour !== null); i++) {
        const c = i % 2 === 0 ? (shield ?? armour) : (armour ?? shield);
        if (c === null || design.size + c.size > target) break;
        design.components.push(c);
        design.reDefine();
    }
    design.name = scenarioText('CV Shuttle Design', empire.name);
    return design;
}

/** The empire's VIP design, generated (or regenerated when research improved it) on demand. Draws on (re)generation. */
export function ensureVipDesign(galaxy: Galaxy, empire: Empire): Design | null {
    const ce = cvEmpire(galaxy, empire);
    if (ce.design !== null && ce.designLocked) return ce.design;
    if (ce.design === null) {
        ce.design = generateVipShuttleDesign(galaxy, empire);
        ce.designSig = vipTechSignature(galaxy, empire, ce.design);
    }
    return ce.design;
}

/** researchCompleted: rebuild the auto-design when an allowed component improved (not a player-locked one). Draws. */
export function reviewVipDesign(galaxy: Galaxy, empire: Empire): void {
    const ce = cvEmpire(galaxy, empire);
    if (ce.designLocked || ce.design === null) return;
    const d = generateVipShuttleDesign(galaxy, empire);
    if (d === null) return;
    const sig = vipTechSignature(galaxy, empire, d);
    if (sig !== ce.designSig) {
        ce.design = d;
        ce.designSig = sig;
    }
}

/** The player's edited VIP design replaces the auto-design (only allowed components are kept). */
export function setPlayerVipDesign(galaxy: Galaxy, empire: Empire, design: Design): boolean {
    design.components = design.components.filter((c) => vipComponentAllowed(c.type));
    design.subRole = BuiltObjectSubRole.PassengerShip;
    design.reDefine();
    if (design.components.length === 0) return false;
    const ce = cvEmpire(galaxy, empire);
    ce.design = design;
    ce.designLocked = true;
    ce.designSig = vipTechSignature(galaxy, empire, design);
    return true;
}

/**
 * Player command cvSaveVipDesign: the edited VIP Shuttle (a name and its component ids, from the designer). Only
 * allowed components are kept; the result replaces the auto-design for good (designLocked). No Rnd.
 */
export function savePlayerVipDesign(galaxy: Galaxy, empire: Empire, name: string, componentIds: number[]): boolean {
    const ce = cvEmpire(galaxy, empire);
    const base = ce.design;
    if (base === null) return false;
    const defs = new Map(componentDefinitionsStatic(galaxy).map((c) => [c.componentId, c] as const));
    const comps = componentIds.map((id) => defs.get(id)).filter((c): c is NonNullable<typeof c> => c !== undefined && vipComponentAllowed(c.type));
    if (!comps.some((c) => c.type === ComponentType.HyperDrive) || !comps.some((c) => c.type === ComponentType.EngineMainThrust)) return false;
    const d = cloneDesign(base);
    d.components = comps;
    d.name = name.trim() !== '' ? name.trim() : base.name;
    d.isManuallyCreated = true;
    return setPlayerVipDesign(galaxy, empire, d);
}
