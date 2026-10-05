// Smarter AI add-on, part 1: an optimised research order per AI empire (scenarios/smarter-ai, flag smarterAIResearch).
// Not a port: the C# reads Race.WeaponsResearchProjectOrder / EnergyResearchProjectOrder / HighTechResearchProjectOrder
// first in Empire.3.cs SelectNextResearchProject (researchTick.ts selectNextResearchProject). The base race files leave
// those lists empty; this package answers the `researchProjectOrder` query with the empire's own lists instead (only the
// first id that is available, unresearched and not queued is taken; the stock selection runs when none is).
//
// Lists (project ids of research.txt, verified against the file): Energy is the user-approved fixed order (the race's
// special Energy projects right after Energy Collection); HighTech and Weapons are built from rules (see the builders).
// Every list ends with the rest of its industry, lowest tech level first (Weapons: superweapons last); projects the race
// cannot research (AllowedRaces / DisallowedRaces) are left out.
//
// Dynamic rules (yearly, deterministic, no Rnd): under threat (hostile military strength near its colonies above its
// own) the next shield step and damage control move up to 5 places forward in Energy, the next armour and point-defence
// steps in Weapons; with poor reach (colonies spread far apart, or few systems within a jump of the capital) Efficient
// HyperDrives and Jump Efficiency move forward. The moves are applied to the base order each year (never cumulative).

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { TechNode } from '../../researchSystem';
import { ResearchAbilityType, abilityTypeFromFile, resolveColonyHabitatTypeByIndexIncludingUndefined } from '../../researchSystem';
import { HabitatType, IndustryType } from '../../types';
import { ComponentType } from '../../data/components';
import { ComponentCategoryType } from '../../data/policies';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { calculateOverallStrengthFactorWithoutShields } from '../../combat/threats';
import { determineEmpiresAtWarWith, militaryPotency } from '../../treasury';
import { registerScenarioGameStart, registerScenarioQuery, registerScenarioYearly } from '../hooks';
import { SMARTER_AI_FLAG, SMARTER_AI_RESEARCH_FLAG, isSmarterAIEmpire, smarterAIOn, smarterAIState, type SmarterResearchOrders } from './common';

const SECTOR_SIZE = 2_000_000; // Galaxy.SectorSize

// research.txt industries (PROJECT line field 5).
const WEAPONS = 0;
const ENERGY = 1;
const HIGHTECH = 2;

/** The approved Energy order (#1-#58). The race's special Energy projects go after #10 (Energy Collection). */
export const ENERGY_ORDER: readonly number[] = [
    363, // Warp Field Precursors
    166, // HyperDrive Technology
    362, // Orbital Assembly
    105, // Space Construction
    95, // Shields
    359, // Space Reactors
    74, // Advanced Nuclear Fission
    106, // Enhanced Construction
    167, // Enhanced HyperDrives
    123, // Energy Collection
    163, // Efficient HyperDrives
    107, // Component PreFabrication
    360, // Starship Engines
    133, // Proton Ionization
    75, // Nuclear Supercharging
    120, // Fast Mining
    96, // Enhanced Shields
    108, // LargeScale Construction
    113, // Damage Control
    280, // Accelerated Construction
    97, // Shield Reinforcement
    103, // Massive Shield Projection
    92, // Intensified Shield Strength
    89, // Accelerated Shield Recharge
    71, // Fusion Physics
    80, // Quantum Exploitation
    160, // High Speed HyperDrives
    114, // Enhanced Damage Control
    109, // Rapid Assembly
    134, // Enhanced Engines
    104, // Robotic Defenses
    121, // Self-Optimizing Extractors
    72, // Advanced Fusion Physics
    81, // Quantum MicroUtilization
    93, // High Storage Capacitors
    90, // High Energy Capacitors
    161, // Hyper Slipstreaming
    172, // Hyperjump Inhibiting
    115, // Robotic Repairs
    124, // Enhanced Energy Collection
    361, // Starship Maneuvering
    145, // Enhanced Maneuvering
    139, // High Volume Thrust
    98, // Advanced Shields
    77, // Fusion Balance
    110, // MegaScale Construction
    111, // Automated Manufacturing
    112, // Colossal Construction
    169, // Advanced HyperDrives
    170, // Hyperspace PathSlicing
    171, // Unified HyperDrive Theory
    99, // Shield Multipliers
    100, // Exponential Shield Effects
    101, // Remote Shield Recharging
    102, // Intense Recharge Power
    122, // High Power Extractors
    78, // HyperFusion Intensification
    79, // Advanced Fusion Balance
];
const ENERGY_SPECIALS_AFTER = 123; // Energy Collection (#10)

// HighTech rule groups.
const HT_RESOURCE_EXPLORATION = [212]; // Enhanced Resource Exploration
const HT_HAPPINESS = [249, 253]; // Medical Systems, Entertainment Systems
const HT_TRADE = [227, 235, 269, 283]; // Transport Systems, Storage Systems, Enhanced Commerce, Open Trade Network
const HT_LABS = [345, 258, 259, 260]; // Structured Research, Enhanced Research, Advanced Research, Accelerated Research
const HT_COLONIZATION = 219; // Colonization
const HT_COMPUTERS = [182, 188, 183, 189, 184, 190]; // Countermeasures, Target Tracking, Enhanced ×2, Fleet ×2
const HT_SENSORS = [198, 199, 200]; // Long Range Scanners, Enhanced Scanners, Advanced Scanners

// Weapons rule groups.
const W_ARMOR_PLATING = 67; // Armor Plating
const W_GROUND_TROOPS = [330, 324, 344]; // Improved Defense Tactics, Improved Assault Tactics, Improved Logistics
const W_POINT_DEFENSE = [51, 52]; // Point Defense Weapons, Enhanced Point Defense
const W_HEAVY_ARMOR = [68, 69, 70]; // High Density Alloys, Ablative Metals, Indestructible Compounds
/** Main weapon line projects up to this tech level come first; the rest after the heavier armour. */
const W_EARLY_TECH_LEVEL = 3;

// Dynamic rule steps (the next unresearched one of each sequence is pulled forward).
const THREAT_ENERGY_STEPS: readonly (readonly number[])[] = [
    [96, 97, 92, 89], // Enhanced Shields, Shield Reinforcement, Intensified Shield Strength, Accelerated Shield Recharge
    [113, 114], // Damage Control, Enhanced Damage Control
];
const THREAT_WEAPONS_STEPS: readonly (readonly number[])[] = [
    [67, 68, 69, 70], // the armour line
    [51, 52, 53, 54, 55, 56], // the point-defence line
];
const REACH_ENERGY_STEPS: readonly (readonly number[])[] = [[163], [164]]; // Efficient HyperDrives, Jump Efficiency
export const PULL_PLACES = 5;

/** Reach thresholds: "normal jump range" from the capital, the colony spread and the low system density. */
export interface ReachRule {
    jumpRange: number;
    /** A colony farther than this from the capital: spread far apart. */
    spreadRange: number;
    /** Fewer systems than this (the home system excluded) within jumpRange of the capital: low density. */
    minSystems: number;
}
export const REACH_DEFAULTS: ReachRule = { jumpRange: 1.5 * SECTOR_SIZE, spreadRange: 3 * SECTOR_SIZE, minSystems: 8 };
/** Hostile military within this distance of a colony counts as near. */
export const THREAT_RANGE = SECTOR_SIZE;

// ---------------------------------------------------------------------------
// Base orders
// ---------------------------------------------------------------------------

function isSuperweapon(n: TechNode): boolean {
    // Special Function Code 3 = superweapon; categories 23/24/26 = WeaponSuperArea / SuperBeam / SuperTorpedo.
    return n.def.specialFunctionCode === 3 || n.def.category === 23 || n.def.category === 24 || n.def.category === 26 || n.def.techLevel >= 100;
}

/** `head` (filtered to the industry and the race) followed by the rest of the industry, lowest tech level first. */
function completeOrder(empire: Empire, industry: number, head: readonly number[]): number[] {
    const rs = empire.research;
    const race = empire.dominantRace!;
    const byId = new Map<number, TechNode>();
    for (const n of rs.techTree) if (!byId.has(n.def.projectId)) byId.set(n.def.projectId, n);
    const ok = (n: TechNode | undefined): n is TechNode => n !== undefined && n.def.industry === industry && rs.raceMayResearch(n, race);
    const out: number[] = [];
    const seen = new Set<number>();
    for (const id of head) {
        if (seen.has(id) || !ok(byId.get(id))) continue;
        seen.add(id);
        out.push(id);
    }
    const rest = [...byId.values()].filter((n) => ok(n) && !seen.has(n.def.projectId));
    // Stable: tree (file) order among equal keys.
    rest.sort((a, b) => (isSuperweapon(a) ? 1 : 0) - (isSuperweapon(b) ? 1 : 0) || a.def.techLevel - b.def.techLevel);
    for (const n of rest) out.push(n.def.projectId);
    return out;
}

export function buildEnergyOrder(empire: Empire): number[] {
    const rs = empire.research;
    const race = empire.dominantRace!;
    const specials = rs.techTree
        .filter((n) => n.def.industry === ENERGY && rs.raceSpecialFor(n, race))
        .sort((a, b) => a.def.techLevel - b.def.techLevel)
        .map((n) => n.def.projectId);
    const head = [...ENERGY_ORDER];
    head.splice(head.indexOf(ENERGY_SPECIALS_AFTER) + 1, 0, ...specials.filter((id) => !head.includes(id)));
    return completeOrder(empire, ENERGY, head);
}

/** Colonization projects per habitat type (ColonizeHabitatType abilities), lowest tech level first. */
function colonizationProjects(empire: Empire, type: HabitatType): number[] {
    return empire.research.techTree
        .filter((n) => n.def.industry === HIGHTECH && n.def.abilities.some((a) => abilityTypeFromFile(a.type) === ResearchAbilityType.ColonizeHabitatType && resolveColonyHabitatTypeByIndexIncludingUndefined(a.value) === type))
        .sort((a, b) => a.def.techLevel - b.def.techLevel)
        .map((n) => n.def.projectId);
}

export function buildHighTechOrder(empire: Empire): number[] {
    const policy = empire.policy;
    // The race's native type first, then the policy's ColonizePriority order (ties keep the C#'s type order); a type
    // the policy gives no priority is left to the rest of the list.
    const types: HabitatType[] = [];
    const native = empire.dominantRace!.nativeHabitatType;
    const byPriority: [number, HabitatType][] = [
        [policy?.colonizeContinentalPriority ?? 1, HabitatType.Continental],
        [policy?.colonizeMarshySwampPriority ?? 1, HabitatType.MarshySwamp],
        [policy?.colonizeOceanPriority ?? 1, HabitatType.Ocean],
        [policy?.colonizeDesertPriority ?? 1, HabitatType.Desert],
        [policy?.colonizeIcePriority ?? 1, HabitatType.Ice],
        [policy?.colonizeVolcanicPriority ?? 1, HabitatType.Volcanic],
    ];
    if (byPriority.some(([, t]) => t === native)) types.push(native);
    for (const [p, t] of [...byPriority].sort((a, b) => b[0] - a[0])) if (p > 0 && !types.includes(t)) types.push(t);
    const colonization = types.flatMap((t) => colonizationProjects(empire, t));
    return completeOrder(empire, HIGHTECH, [...HT_RESOURCE_EXPLORATION, ...HT_HAPPINESS, ...HT_TRADE, ...HT_LABS, HT_COLONIZATION, ...colonization, ...HT_COMPUTERS, ...HT_SENSORS]);
}

/** A weapon line: the component types it unlocks / improves (Fighter: the fighter projects). */
type WeaponLine = { types: ComponentType[]; fighters: boolean };

function weaponLineOfCategory(c: ComponentCategoryType): WeaponLine | null {
    const C = ComponentCategoryType;
    const T = ComponentType;
    switch (c) {
        case C.WeaponBeam: return { types: [T.WeaponBeam], fighters: false };
        case C.WeaponTorpedo: return { types: [T.WeaponTorpedo], fighters: false };
        case C.WeaponArea: return { types: [T.WeaponAreaDestruction], fighters: false };
        case C.WeaponIon: return { types: [T.WeaponIonCannon, T.WeaponIonPulse], fighters: false };
        case C.WeaponGravity: return { types: [T.WeaponGravityBeam, T.WeaponAreaGravity], fighters: false };
        case C.Fighter: return { types: [T.FighterBay], fighters: true };
        default: return null;
    }
}

function weaponLineOfType(t: ComponentType): WeaponLine | null {
    const T = ComponentType;
    switch (t) {
        case T.WeaponBeam: case T.WeaponTorpedo: case T.WeaponBombard: case T.WeaponMissile: case T.WeaponPhaser: case T.WeaponRailGun:
        case T.WeaponGravityBeam: case T.WeaponAreaGravity: case T.WeaponTractorBeam: case T.WeaponAreaDestruction:
            return { types: [t], fighters: false };
        case T.WeaponIonCannon: case T.WeaponIonPulse: return { types: [T.WeaponIonCannon, T.WeaponIonPulse], fighters: false };
        case T.FighterBay: return { types: [T.FighterBay], fighters: true };
        default: return null;
    }
}

const sameLine = (a: WeaponLine, b: WeaponLine): boolean => a.fighters === b.fighters && a.types.length === b.types.length && a.types.every((t) => b.types.includes(t));

/** The empire's weapon lines by preference: the policy's tech-focus slots, else its designs' main weapon type. */
export function preferredWeaponLines(empire: Empire): WeaponLine[] {
    const lines: WeaponLine[] = [];
    const add = (l: WeaponLine | null): void => {
        if (l !== null && !lines.some((x) => sameLine(x, l))) lines.push(l);
    };
    for (const f of empire.policy?.researchDesignTechFocus ?? []) add(f.type !== ComponentType.Undefined ? weaponLineOfType(f.type) : weaponLineOfCategory(f.category));
    if (lines.length === 0) {
        // The designs' main weapon: the most common first weapon (or fighter bay) of its warship designs.
        const counts = new Map<ComponentType, number>();
        for (const d of empire.designs) {
            if (d.role !== BuiltObjectRole.Military) continue;
            for (const c of d.components) {
                if (c === null) continue;
                if (weaponLineOfType(c.type) !== null) {
                    counts.set(c.type, (counts.get(c.type) ?? 0) + 1);
                    break;
                }
            }
        }
        let best: ComponentType | null = null;
        for (const [t, n] of counts) if (best === null || n > counts.get(best)!) best = t;
        add(best !== null ? weaponLineOfType(best) : { types: [ComponentType.WeaponBeam], fighters: false });
    }
    if (lines.length === 1) {
        // A second weapon type: torpedoes beside a direct-fire main line, beams beside a torpedo / missile one.
        const main = lines[0];
        const T = ComponentType;
        const missileLike = main.types.some((t) => t === T.WeaponTorpedo || t === T.WeaponMissile || t === T.WeaponBombard);
        add({ types: [missileLike ? T.WeaponBeam : T.WeaponTorpedo], fighters: false });
    }
    return lines;
}

function lineProjects(empire: Empire, line: WeaponLine): TechNode[] {
    const rs = empire.research;
    return rs.techTree
        .filter((n) => n.def.industry === WEAPONS && !isSuperweapon(n) && ((line.fighters && (n.def.category === 7 || n.def.fighters.length > 0)) || rs.componentTypesAll(n).some((t) => line.types.includes(t))))
        .sort((a, b) => a.def.techLevel - b.def.techLevel);
}

export function buildWeaponsOrder(empire: Empire): number[] {
    const [main, second] = preferredWeaponLines(empire);
    const mainNodes = lineProjects(empire, main);
    const early = (ns: TechNode[]): number[] => ns.filter((n) => n.def.techLevel <= W_EARLY_TECH_LEVEL).map((n) => n.def.projectId);
    const late = mainNodes.filter((n) => n.def.techLevel > W_EARLY_TECH_LEVEL).map((n) => n.def.projectId);
    const secondEarly = second !== undefined ? early(lineProjects(empire, second)) : [];
    return completeOrder(empire, WEAPONS, [...early(mainNodes), W_ARMOR_PLATING, ...W_GROUND_TROOPS, ...secondEarly, ...W_POINT_DEFENSE, ...W_HEAVY_ARMOR, ...late]);
}

export function buildBaseOrders(empire: Empire): SmarterResearchOrders['base'] {
    return { weapons: buildWeaponsOrder(empire), energy: buildEnergyOrder(empire), highTech: buildHighTechOrder(empire) };
}

// ---------------------------------------------------------------------------
// Dynamic rules
// ---------------------------------------------------------------------------

/** `base` without the researched projects, the next unresearched step of each sequence moved up to PULL_PLACES forward. */
export function pullForward(base: readonly number[], researched: (id: number) => boolean, steps: readonly (readonly number[])[]): number[] {
    const list = base.filter((id) => !researched(id));
    for (const seq of steps) {
        const id = seq.find((x) => !researched(x) && list.includes(x));
        if (id === undefined) continue;
        const i = list.indexOf(id);
        list.splice(i, 1);
        list.splice(Math.max(0, i - PULL_PLACES), 0, id);
    }
    return list;
}

/** The current orders for the given signals. */
export function dynamicOrders(empire: Empire, base: SmarterResearchOrders['base'], threat: boolean, reach: boolean): SmarterResearchOrders['current'] {
    const done = new Set<number>();
    for (const n of empire.research.techTree) if (n.isResearched) done.add(n.def.projectId);
    const researched = (id: number): boolean => done.has(id);
    const energySteps = [...(threat ? THREAT_ENERGY_STEPS : []), ...(reach ? REACH_ENERGY_STEPS : [])];
    return {
        weapons: pullForward(base.weapons, researched, threat ? THREAT_WEAPONS_STEPS : []),
        energy: pullForward(base.energy, researched, energySteps),
        highTech: pullForward(base.highTech, researched, []),
    };
}

/** Threat: the military strength of pirates and empires at war with it near its colonies exceeds its own. */
export function threatSignal(galaxy: Galaxy, empire: Empire): boolean {
    const colonies = empire.colonies.filter((h) => h !== null && h.empire === empire);
    if (colonies.length === 0) return false;
    const hostile = new Set<Empire>(determineEmpiresAtWarWith(galaxy, empire).empires);
    for (const p of galaxy.pirateEmpires) if (p !== empire && p.active) hostile.add(p);
    const r2 = THREAT_RANGE * THREAT_RANGE;
    let near = 0;
    for (const e of hostile) {
        for (const bo of e.builtObjects) {
            if (bo === null || bo.hasBeenDestroyed || bo.role !== BuiltObjectRole.Military) continue;
            if (colonies.some((h) => (h.xpos - bo.xpos) ** 2 + (h.ypos - bo.ypos) ** 2 <= r2)) near += calculateOverallStrengthFactorWithoutShields(galaxy, bo);
        }
    }
    return near > militaryPotency(galaxy, empire);
}

/** Fuel / reach: colonies spread far from the capital, or few systems within a normal jump of it. */
export function reachSignal(galaxy: Galaxy, empire: Empire, rule: ReachRule = REACH_DEFAULTS): boolean {
    const capital = empire.capital ?? empire.colonies[0] ?? null;
    if (capital === null) return false;
    const s2 = rule.spreadRange * rule.spreadRange;
    for (const h of empire.colonies) if (h !== null && h.empire === empire && (h.xpos - capital.xpos) ** 2 + (h.ypos - capital.ypos) ** 2 > s2) return true;
    const j2 = rule.jumpRange * rule.jumpRange;
    let systems = 0;
    for (const sys of galaxy.systems) {
        const star = sys.systemStar;
        if (star === null || star === undefined || star.systemIndex === capital.systemIndex) continue;
        if ((star.xpos - capital.xpos) ** 2 + (star.ypos - capital.ypos) ** 2 <= j2) systems++;
    }
    return systems < rule.minSystems;
}

// ---------------------------------------------------------------------------
// State and hooks
// ---------------------------------------------------------------------------

/** Evaluates the signals and rebuilds `current` from `base`. */
export function reweighResearchOrders(galaxy: Galaxy, empire: Empire, o: SmarterResearchOrders): void {
    o.threat = threatSignal(galaxy, empire);
    o.reach = reachSignal(galaxy, empire);
    o.current = dynamicOrders(empire, o.base, o.threat, o.reach);
}

/** The empire's orders, built on first use (game start, a new empire, or a save made without them). */
export function ensureResearchOrders(galaxy: Galaxy, empire: Empire): SmarterResearchOrders {
    const st = smarterAIState(galaxy);
    const key = String(empire.empireId);
    let o = st.orders[key];
    if (o === undefined) {
        const base = buildBaseOrders(empire);
        o = { base, current: { weapons: [...base.weapons], energy: [...base.energy], highTech: [...base.highTech] }, threat: false, reach: false };
        reweighResearchOrders(galaxy, empire, o);
        st.orders[key] = o;
    }
    return o;
}

registerScenarioGameStart({
    id: 'smarterAI.researchOrders',
    flag: SMARTER_AI_RESEARCH_FLAG,
    run: (galaxy) => {
        if (!smarterAIOn(galaxy, SMARTER_AI_RESEARCH_FLAG)) return;
        for (const e of galaxy.empires) if (isSmarterAIEmpire(galaxy, e)) ensureResearchOrders(galaxy, e);
    },
});

registerScenarioYearly({
    id: 'smarterAI.researchReweigh',
    flag: SMARTER_AI_RESEARCH_FLAG,
    run: (galaxy) => {
        if (!smarterAIOn(galaxy, SMARTER_AI_RESEARCH_FLAG)) return;
        for (const e of galaxy.empires) {
            if (!isSmarterAIEmpire(galaxy, e)) continue;
            const o = ensureResearchOrders(galaxy, e);
            reweighResearchOrders(galaxy, e, o);
        }
    },
});

registerScenarioQuery({
    id: 'smarterAI.researchOrder',
    query: 'researchProjectOrder',
    flag: SMARTER_AI_FLAG,
    run: (galaxy, value, { empire, industry }) => {
        if (!smarterAIOn(galaxy, SMARTER_AI_RESEARCH_FLAG) || !isSmarterAIEmpire(galaxy, empire)) return value;
        const o = ensureResearchOrders(galaxy, empire);
        switch (industry) {
            case IndustryType.Weapon: return o.current.weapons;
            case IndustryType.Energy: return o.current.energy;
            case IndustryType.HighTech: return o.current.highTech;
            default: return value;
        }
    },
});
