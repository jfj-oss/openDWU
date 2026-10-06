// The Designs window's design tools, as game logic (no DOM): the design editor's "Only Show Latest Components"
// toolbox, "Auto Upgrade Selected Designs", and the Load / Save design files. Ported from:
// - DistantWorlds/Main.Part9.cs:4802-4990 method_285 / method_286 / method_287 / method_288 / method_289 / Kdxguwronl
//   (the latest-components toolbox) with ResearchSystem.cs GetLatestComponents (1647 / 1688);
// - DistantWorlds.Types/Empire.3.cs:2931-3003 ResolveLatestMissileWeapon / ResolveLatestStandardTorpedoWeapon /
//   ResolveLatestBombardWeapon with ResearchSystem.cs CalculateCurrentTechPoints (1357);
// - BaconDistantWorlds/BaconMain.cs:2471 btnDesignsUpgrade_Click (Main.Part6.cs:3745 delegates to it);
// - DistantWorlds/Main.Part4.cs:1598 btnDesignsSave_Click / :1664 method_525, :1682 mgohAuJwBE (Load Designs...) and
//   DistantWorlds.Types/Galaxy.4.cs:1087 LoadDesigns.
//
// Read-only helpers (the toolbox, the latest-weapon lookups, the file writer) never change the sim. The two changes
// (autoUpgradeDesigns, loadDesignFile) are player commands (player/playerOps.ts). Nothing here draws galaxy.rnd.
//
// Design files: the original writes a .NET BinaryFormatter DesignList (*.dwd), which only .NET can read. This port
// writes the same data — the designs' serialized fields, with Empire = null and components by ComponentID — as JSON
// (DESIGN_FILE_FORMAT). TODO(port): reading original BinaryFormatter *.dwd files (Galaxy.4.cs:1087 LoadDesigns'
// binaryFormatter.Deserialize) — needs an NRBF reader for DesignList / Design / ComponentList.

import { Design, FighterMix, designFighterMix } from '../design';
import type { Empire } from '../empire';
import type { Galaxy } from '../galaxy';
import type { ComponentDefinition, ComponentImprovementEntry } from '../componentStatic';
import { ComponentType } from '../data/components';
import { ComponentCategoryType } from '../data/policies';
import { ShipDesignFocus, nodeCategory } from '../researchSystem';
import { componentDefinitionsStatic } from '../designGeneration';
import { cloneDesign } from '../gameStartTail';
import { galaxyCurrentStarDate } from '../pirateRelations';
import { determineHabModulesRequired, determineLifeSupportRequired } from '../design';
import { reviewLatestDesigns } from '../construction/empireConstruction';
import { gameText } from '../colonyTick';
import { nextMarkName } from './designEditor';
import './designLineUpgrade'; // Design.upgradedFrom

const T = ComponentType;
const C = ComponentCategoryType;

/** ComponentList.Contains: by ComponentID. */
function containsComponent(list: readonly ComponentDefinition[], c: ComponentDefinition): boolean {
    return list.some((x) => x.componentId === c.componentId);
}

// ---------------------------------------------------------------------------
// Latest components
// ---------------------------------------------------------------------------

// Port of Empire.3.cs:2931 ResolveLatestMissileWeapon.
export function resolveLatestMissileWeapon(empire: Empire): ComponentDefinition | null {
    return empire.research.getLatestComponent(T.WeaponMissile);
}

/** The loop shared by Empire.3.cs ResolveLatestStandardTorpedoWeapon / ResolveLatestBombardWeapon. */
function resolveLatestTorpedoBy(galaxy: Galaxy, empire: Empire, accept: (c: ComponentDefinition) => boolean): ComponentDefinition | null {
    let component: ComponentDefinition | null = null;
    for (const component2 of componentDefinitionsStatic(galaxy)) {
        if (!accept(component2)) continue;
        if (!empire.research.checkComponentResearched(component2)) continue;
        if (component === null) {
            component = component2;
            continue;
        }
        const num = empire.research.calculateCurrentTechPoints(component, galaxy.baseTechCost);
        const num2 = empire.research.calculateCurrentTechPoints(component2, galaxy.baseTechCost);
        if (num < num2) component = component2;
    }
    return component;
}

// Port of Empire.3.cs:2936 ResolveLatestStandardTorpedoWeapon: the researched WeaponTorpedo-category component with
// Value1 > 0, no bombard (Value7 <= 0), not a missile, with the most current tech points (the first on a tie).
export function resolveLatestStandardTorpedoWeapon(galaxy: Galaxy, empire: Empire): ComponentDefinition | null {
    return resolveLatestTorpedoBy(galaxy, empire, (c) => !(c.category !== C.WeaponTorpedo || c.value1 <= 0 || c.value7 > 0 || c.type === T.WeaponMissile));
}

// Port of Empire.3.cs:2976 ResolveLatestBombardWeapon: the researched WeaponTorpedo-category component with Value7 > 0
// and the most current tech points.
export function resolveLatestBombardWeapon(galaxy: Galaxy, empire: Empire): ComponentDefinition | null {
    return resolveLatestTorpedoBy(galaxy, empire, (c) => !(c.category !== C.WeaponTorpedo || c.value7 <= 0));
}

/** Port of Main.Part9.cs:4802 method_285 / :4838 method_286: the researched race-specific projects' components. */
function raceSpecificResearchedComponents(empire: Empire, filter: { category: ComponentCategoryType } | { type: ComponentType }): ComponentDefinition[] {
    const research = empire.research;
    const componentList: ComponentDefinition[] = [];
    // method_285 filters the node by its category; method_286 each component by its type.
    const matches = (c: ComponentDefinition): boolean => !('type' in filter) || c.type === filter.type;
    for (const researchNode of research.techTree) {
        if (!researchNode.isResearched) continue;
        if ('category' in filter && nodeCategory(researchNode) !== filter.category) continue;
        if (research.allowedRacesCount(researchNode) <= 0) continue;
        for (const id of researchNode.def.components) {
            const c = research.definitionFor(id);
            if (c !== undefined && matches(c) && !containsComponent(componentList, c)) componentList.push(c);
        }
        for (const ci of researchNode.def.componentImprovements) {
            const c = research.definitionFor(ci.componentId);
            if (c !== undefined && matches(c) && !containsComponent(componentList, c)) componentList.push(c);
        }
    }
    return componentList;
}

/** Main.Part9.cs:4873 method_287: append the components not yet listed. */
function addMissing(list: ComponentDefinition[], more: readonly ComponentDefinition[]): void {
    for (const c of more) if (!containsComponent(list, c)) list.push(c);
}

/**
 * Port of Main.Part9.cs:4900 Kdxguwronl: the design editor's toolbox with "Only Show Latest Components" checked — per
 * main category the latest components (plus the researched race-specific ones), then the latest energy collector,
 * energy-to-fuel converter, bombard, standard torpedo, missile, ion, tractor / gravity, point-defense, fighter bay and
 * assault pod, then the latest components of every other component type.
 */
export function latestToolboxComponents(galaxy: Galaxy, empire: Empire): ComponentDefinition[] {
    const research = empire.research;
    const componentList: ComponentDefinition[] = [];
    const categories = [C.Armor, C.HyperDrive, C.HyperDisrupt, C.Reactor, C.Shields, C.ShieldRecharge, C.WeaponBeam, C.WeaponTorpedo];
    for (const item of categories) {
        // ComponentList.AddRange: no duplicate check here.
        componentList.push(...research.getLatestComponents(item, true));
        addMissing(componentList, raceSpecificResearchedComponents(empire, { category: item }));
    }
    const addOne = (c: ComponentDefinition | null): void => {
        if (c !== null && !containsComponent(componentList, c)) componentList.push(c);
    };
    addOne(research.getLatestComponent(T.EnergyCollector));
    addOne(research.getLatestComponent(T.EnergyToFuel));
    addOne(resolveLatestBombardWeapon(galaxy, empire));
    addOne(resolveLatestStandardTorpedoWeapon(galaxy, empire));
    addOne(resolveLatestMissileWeapon(empire));
    for (const t of [T.WeaponIonCannon, T.WeaponIonPulse, T.WeaponIonDefense, T.WeaponTractorBeam, T.WeaponGravityBeam, T.WeaponAreaGravity, T.WeaponPointDefense, T.FighterBay, T.AssaultPod]) {
        addOne(research.getLatestComponent(t));
    }
    for (const value of Object.values(T)) {
        if (typeof value !== 'number') continue;
        const componentType = value as ComponentType;
        switch (componentType) {
            case T.WeaponBeam:
            case T.WeaponTorpedo:
            case T.Armor:
            case T.Shields:
            case T.HyperDrive:
            case T.Reactor:
                continue;
        }
        if (componentType === T.Undefined) continue;
        addMissing(componentList, research.getLatestComponents(componentType));
        addMissing(componentList, raceSpecificResearchedComponents(empire, { type: componentType }));
    }
    return componentList;
}

// ---------------------------------------------------------------------------
// Auto upgrade
// ---------------------------------------------------------------------------

export interface AutoUpgradeResult {
    /** The new designs added to Empire.Designs, in selection order. */
    added: Design[];
    /** BaconMain.cs:2628-2633: the design to select afterwards (only when one design was selected). */
    select: Design | null;
}

/** BaconMain.cs:2489-2540: the replacement for one component (null keeps it). */
function upgradedComponent(galaxy: Galaxy, empire: Empire, component: ComponentDefinition): ComponentDefinition | null {
    const research = empire.research;
    switch (component.category) {
        case C.WeaponBeam:
        case C.Shields:
        case C.HyperDrive:
        case C.Reactor:
        case C.WeaponSuperBeam:
        case C.WeaponSuperArea: {
            // Decompiled as `type != WeaponGravityBeam && type - 60 > WeaponBeam && type - 65 > WeaponBeam` (a byte
            // enum, unsigned): gravity beams, phasers / rail guns and their super versions keep their own type.
            const t = component.type;
            const byType = t === T.WeaponGravityBeam || t === T.WeaponPhaser || t === T.WeaponRailGun || t === T.WeaponSuperPhaser || t === T.WeaponSuperRailGun;
            return byType
                ? research.evaluateDesiredComponent(t, ShipDesignFocus.Balanced, true)
                : research.evaluateDesiredComponentByCategory(component.category, ShipDesignFocus.Balanced, true);
        }
        case C.WeaponTorpedo:
        case C.WeaponSuperTorpedo:
            switch (component.type) {
                case T.WeaponBombard: return resolveLatestBombardWeapon(galaxy, empire);
                case T.WeaponMissile: return resolveLatestMissileWeapon(empire);
                case T.WeaponSuperTorpedo: return research.getLatestComponent(T.WeaponSuperTorpedo);
                case T.WeaponSuperMissile: return research.getLatestComponent(T.WeaponSuperMissile);
                default: return resolveLatestStandardTorpedoWeapon(galaxy, empire);
            }
        case C.Engine:
            if (component.type === T.EngineMainThrust) return research.evaluateDesiredComponent(T.EngineMainThrust, ShipDesignFocus.Balanced, true);
            if (component.type === T.EngineVectoring) return research.evaluateDesiredComponent(T.EngineVectoring, ShipDesignFocus.Balanced, true);
            return null;
        default:
            return research.evaluateDesiredComponent(component.type, ShipDesignFocus.Balanced, true);
    }
}

/**
 * BaconMain.cs:2550-2575 (btnDesignsUpgrade_Click): top the design up with the latest (improved) hab modules / life
 * support its components now need (Galaxy.8.cs DetermineHabModulesRequired / DetermineLifeSupportRequired). No Rnd.
 * Shared with the [improvements] same-line design upgrade (player/designLineUpgrade.ts).
 */
export function addRequiredHabitation(empire: Empire, design: Design): void {
    const research = empire.research;
    const latestComponent = research.getLatestComponent(T.HabitationHabModule);
    const latestComponent2 = research.getLatestComponent(T.HabitationLifeSupport);
    // C# `new ComponentImprovement(null)` throws when nothing is researched; here no module is then added.
    const componentImprovement: ComponentImprovementEntry | null = latestComponent !== null ? research.resolveImprovedComponentValues(latestComponent) : null;
    const componentImprovement2: ComponentImprovementEntry | null = latestComponent2 !== null ? research.resolveImprovedComponentValues(latestComponent2) : null;
    const num = determineHabModulesRequired(componentImprovement, design);
    const num2 = determineLifeSupportRequired(componentImprovement2, design);
    let num3 = 0;
    let num4 = 0;
    for (const component3 of design.components) {
        if (component3.type === T.HabitationHabModule) num3++;
        else if (component3.type === T.HabitationLifeSupport) num4++;
    }
    const num5 = num - num3;
    const num6 = num2 - num4;
    for (let k = 0; k < num5; k++) design.components.push(componentImprovement!.improvedComponent);
    for (let l = 0; l < num6; l++) design.components.push(componentImprovement2!.improvedComponent);
}

/**
 * Port of BaconMain.cs:2471 btnDesignsUpgrade_Click (after the ControlDesigns question, which the screen asks): each
 * selected design is cloned with every component replaced by the empire's latest equivalent, topped up with the latest
 * hab modules / life support its new size needs; a clone that differs from its design is renamed "<name> Mk(N+1)"
 * (" Mk2"), dated now, owned by the empire, with BuildCount 0, not obsolete, manually created, ReDefined and added to
 * Empire.Designs, and the old design is marked obsolete. No Rnd.
 * TODO(port): the C# keeps the name of the empire's current WeaponsResearchStation / HighTechResearchStation /
 * EnergyResearchStation / MonitoringStationCurrentDesign / DefenseBaseDesign (BaconMain.cs:2613) — those Empire design
 * fields (Empire.10.cs:980 / :1075 / :1206) are not modelled.
 */
export function autoUpgradeDesigns(galaxy: Galaxy, empire: Empire, selectedDesigns: readonly Design[]): AutoUpgradeResult {
    const added: Design[] = [];
    if (selectedDesigns.length <= 0) return { added, select: null };
    let design: Design | null = null;
    for (const design2 of selectedDesigns) {
        design = cloneDesign(design2);
        for (let j = 0; j < design.components.length; j++) {
            const component = design.components[j];
            const component2 = upgradedComponent(galaxy, empire, component);
            if (component2 !== null && component2.componentId !== component.componentId) design.components[j] = component2;
        }
        addRequiredHabitation(empire, design);
        if (design.isEquivalent(design2)) continue;
        design.name = nextMarkName(design2.name);
        design.dateCreated = galaxyCurrentStarDate(galaxy);
        design.empire = empire;
        design.buildCount = 0;
        design.isObsolete = false;
        design.isManuallyCreated = true;
        design.reDefine();
        design2.isObsolete = true;
        design.upgradedFrom = design2; // [improvements] designLineUpgrade lineage (not in the C#; read only by Retrofit when on)
        empire.designs.push(design);
        added.push(design);
    }
    // BaconMain.cs:2628: design3 = the last clone when exactly one design was selected (unchanged → not in the list).
    const select = selectedDesigns.length === 1 && design !== null && added.includes(design) ? design : null;
    return { added, select };
}

// ---------------------------------------------------------------------------
// Design files
// ---------------------------------------------------------------------------

/** The JSON form of a design file (this port's stand-in for the original BinaryFormatter *.dwd). */
export const DESIGN_FILE_FORMAT = 'dwu-designs';
export const DESIGN_FILE_VERSION = 1;
/** SaveFileDialog.DefaultExt "dwd" (Main.Part4.cs:1618); the JSON form adds ".json". */
export const DESIGN_FILE_EXTENSION = '.dwd.json';

/** One design as written to a file: Design's serialized fields (Empire = null), components by ComponentID. */
export interface DesignFileEntry {
    name: string;
    role: number;
    subRole: number;
    components: number[];
    dateCreated: number;
    imageScalingType: number;
    imageScalingFactor: number;
    stance: number;
    fleeWhen: number;
    tacticsStrongerShips: number;
    tacticsWeakerShips: number;
    tacticsInvasion: number;
    pictureRef: number;
    buildCount: number;
    isObsolete: boolean;
    isManuallyCreated: boolean;
    optimizedDesign: number;
    allowAutoRetrofit: boolean;
    /** Not in the C#: the FighterMix; written only when set (absent = By bay name). */
    fighterMix?: number;
}

export interface DesignFile {
    format: typeof DESIGN_FILE_FORMAT;
    version: number;
    designs: DesignFileEntry[];
}

/**
 * Port of Main.Part4.cs:1664 method_525: the selected designs, each cloned with Empire = null, as a design file
 * (JSON text). Read-only.
 */
export function writeDesignFile(designs: readonly Design[]): string {
    const file: DesignFile = {
        format: DESIGN_FILE_FORMAT,
        version: DESIGN_FILE_VERSION,
        designs: designs.map((d) => ({
            name: d.name,
            role: d.role,
            subRole: d.subRole,
            components: d.components.map((c) => c.componentId),
            dateCreated: d.dateCreated,
            imageScalingType: d.imageScalingType,
            imageScalingFactor: d.imageScalingFactor,
            stance: d.stance,
            fleeWhen: d.fleeWhen,
            tacticsStrongerShips: d.tacticsStrongerShips,
            tacticsWeakerShips: d.tacticsWeakerShips,
            tacticsInvasion: d.tacticsInvasion,
            pictureRef: d.pictureRef,
            buildCount: d.buildCount,
            isObsolete: d.isObsolete,
            isManuallyCreated: d.isManuallyCreated,
            optimizedDesign: d.optimizedDesign,
            allowAutoRetrofit: d.allowAutoRetrofit,
            ...(d.fighterMix !== undefined ? { fighterMix: designFighterMix(d) } : {}),
        })),
    };
    return JSON.stringify(file, null, 1);
}

export interface ParsedDesignFile {
    /** The designs read (owner unset), or null when the text is not a design file. */
    designs: Design[] | null;
    /** Entries skipped because a component is not in components.txt. */
    skipped: number;
}

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const bool = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback);

/** Read a design file's text back into Designs (no owner, not ReDefined). Read-only. */
export function parseDesignFile(galaxy: Galaxy, text: string): ParsedDesignFile {
    let file: unknown;
    try {
        file = JSON.parse(text);
    } catch {
        return { designs: null, skipped: 0 };
    }
    if (typeof file !== 'object' || file === null) return { designs: null, skipped: 0 };
    const f = file as Partial<DesignFile>;
    if (f.format !== DESIGN_FILE_FORMAT || !Array.isArray(f.designs)) return { designs: null, skipped: 0 };
    const byId = galaxy.researchStatic?.componentStatic?.byId;
    const designs: Design[] = [];
    let skipped = 0;
    for (const raw of f.designs as unknown[]) {
        if (typeof raw !== 'object' || raw === null) {
            skipped++;
            continue;
        }
        const e = raw as Partial<DesignFileEntry>;
        const components: ComponentDefinition[] = [];
        let ok = Array.isArray(e.components) && typeof e.name === 'string';
        for (const id of ok ? (e.components as unknown[]) : []) {
            const c = typeof id === 'number' ? byId?.get(id) : undefined;
            if (c === undefined) {
                ok = false;
                break;
            }
            components.push(c);
        }
        if (!ok) {
            skipped++;
            continue;
        }
        const d = new Design(e.name as string);
        d.role = num(e.role) as Design['role'];
        d.subRole = num(e.subRole) as Design['subRole'];
        d.components = components;
        d.dateCreated = num(e.dateCreated);
        d.imageScalingType = num(e.imageScalingType) as Design['imageScalingType'];
        d.imageScalingFactor = Math.fround(num(e.imageScalingFactor));
        d.stance = num(e.stance) as Design['stance'];
        d.fleeWhen = num(e.fleeWhen) as Design['fleeWhen'];
        d.tacticsStrongerShips = num(e.tacticsStrongerShips) as Design['tacticsStrongerShips'];
        d.tacticsWeakerShips = num(e.tacticsWeakerShips) as Design['tacticsWeakerShips'];
        d.tacticsInvasion = num(e.tacticsInvasion) as Design['tacticsInvasion'];
        d.pictureRef = num(e.pictureRef);
        d.buildCount = num(e.buildCount);
        d.isObsolete = bool(e.isObsolete);
        d.isManuallyCreated = bool(e.isManuallyCreated);
        d.optimizedDesign = num(e.optimizedDesign);
        d.allowAutoRetrofit = bool(e.allowAutoRetrofit, true);
        if (typeof e.fighterMix === 'number') d.fighterMix = designFighterMix({ fighterMix: e.fighterMix as FighterMix } as Design);
        designs.push(d);
    }
    return { designs, skipped };
}

export interface LoadDesignFileResult {
    ok: boolean;
    /** The designs added to Empire.Designs (Galaxy.LoadDesigns' return list). */
    loaded: Design[];
    /** A GameText-encoded message for the screen, when the file could not be read. */
    message?: string;
    title?: string;
}

/**
 * Port of Main.Part4.cs:1682 mgohAuJwBE after the file was picked (Galaxy.4.cs:1087 LoadDesigns(stream, PlayerEmpire,
 * markLoadedDesignsAsOptimized: false, CurrentStarDate), then Empire.ReviewLatestDesigns): every design of the file is
 * owned by the empire; one that is not equivalent to (or not named like) a design the empire already has gets
 * BuildCount 0, DateCreated = now and joins Empire.Designs. The C# keeps the deserialized derived values; this port
 * ReDefines the design (the file holds only the serialized inputs). No Rnd.
 */
export function loadDesignFile(galaxy: Galaxy, empire: Empire, text: string): LoadDesignFileResult {
    const parsed = parseDesignFile(galaxy, text);
    if (parsed.designs === null) {
        // The C# lets an unreadable file throw (no message); this port says so instead.
        return { ok: false, loaded: [], message: gameText('This file is not a Distant Worlds ship designs file'), title: gameText('Load Distant Worlds designs') };
    }
    const starDate = galaxyCurrentStarDate(galaxy);
    const designList2 = parsed.designs;
    for (const item of designList2) item.empire = empire;
    const loaded: Design[] = [];
    for (const item2 of designList2) {
        let flag = true;
        for (const design of empire.designs) {
            if (item2.isEquivalent(design) && item2.name === design.name) {
                flag = false;
                break;
            }
        }
        if (flag) {
            item2.buildCount = 0;
            item2.dateCreated = starDate;
            item2.reDefine();
            empire.designs.push(item2);
            loaded.push(item2);
        }
    }
    reviewLatestDesigns(galaxy, empire);
    return { ok: true, loaded };
}
