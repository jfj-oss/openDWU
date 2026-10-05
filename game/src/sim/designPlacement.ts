// Port of Empire.10.cs PlaceComponentsOnDesign (1658-2989) and its helpers:
// CheckDesignReactorCountDecreased (2991), IncludeOptionalComponent (3328),
// AdjustComponentAmount (3367), SelectPreferredSuperWeapon (1589).
//
// This is a statement-for-statement port of PlaceComponentsOnDesign's control flow,
// including the over-budget size-trim pass (Empire.10.cs ~2350-2915, the twelve
// per-family ComponentList collection + fixed removal-order cascade) and the final
// reactor/energy-collector/superweapon placement (2916-2989), each cited inline by
// C# line range. `design.Components.Remove(x)` (C# List<T>.Remove: removes the first
// element equal to x) is ported as `design.components` array splice at the first
// index whose element is `===` to x — since every component in `design.components`
// is a shared ComponentDefinition reference from `empire.componentDefinitions` (never
// cloned per-instance), reference equality here matches C#'s Component reference
// equality (Component.cs has no Equals override) exactly.
//
// Galaxy.Rnd is used only by SelectPreferredSuperWeapon's tie-break (Galaxy.Rnd.Next);
// callers pass it in via the required `rnd` field so the draw happens in the same
// relative order C# makes it.

import { BuiltObjectSubRole } from './builtObjectTypes';
import {
    Design,
    calculateStaticEnergyUsage,
    determineComponentEnergyOutput,
    determineComponentEnergyRequirementsExcludeHyperdrive,
    determineHabModulesRequired,
    determineLifeSupportRequired,
    resolveComponentCountsByType,
    getFirstByType,
} from './design';
import type { ComponentDefinition, ComponentImprovementEntry } from './componentStatic';
import { evaluateLatestByCategory, evaluateLatestByType, generateOrderedComponentImprovementList } from './componentStatic';
import { ComponentType } from './data/components';
import { ComponentCategoryType, type EmpirePolicy, resolveTechFocuses } from './data/policies';
import {
    BuiltObjectRole,
    DesignSpecificationComponentRuleType,
    type DesignSpecification,
    type DesignSpecificationComponentRule,
} from './data/designSpecifications';
import { ResearchSystem, ShipDesignFocus } from './researchSystem';

/** Race fields SelectPreferredSuperWeapon / IncludeOptionalComponent read (Race.cs AggressionLevel/IntelligenceLevel). */
export interface DesignPlacementRace {
    aggressionLevel: number;
    intelligenceLevel: number;
}

/**
 * The Empire members PlaceComponentsOnDesign and its helpers read.
 * Explicit surface (no Empire import, to avoid a cycle) — see task instructions.
 */
export interface DesignPlacementEmpire {
    research: ResearchSystem;
    policy: EmpirePolicy | null;
    dominantRace: DesignPlacementRace | null;
    /** All known component definitions (Galaxy.ComponentDefinitionsStatic), used to build the default torpedoWeapons list. */
    componentDefinitions: ComponentDefinition[];
    /** Empire.3.cs CheckEmpireHasHyperDriveTech. */
    hasHyperDriveTech: boolean;
    /** Empire.MaximumConstructionSize(subRole) — used by the 3-arg/4-arg short overloads. */
    maximumConstructionSize: (subRole: BuiltObjectSubRole) => number;
    /** Empire.MaximumConstructionSizeBase(subRole) — used by the 3-arg/4-arg short overloads. */
    maximumConstructionSizeBase: (subRole: BuiltObjectSubRole) => number;
    /** Empire.PirateEmpireBaseHabitat != null (Empire.10.cs 2189). */
    isPirate: boolean;
    /** Galaxy.Rnd — used by SelectPreferredSuperWeapon's tie-break, in the exact spot C# draws it. */
    rnd: { next(minInclusive: number, maxExclusive: number): number };
}

/** The trim pass's component families (Empire.10.cs 2388-2412, the twelve ComponentLists), in the stock removal order. */
export type DesignTrimFamily = 'gasExtractor' | 'mineExtractor' | 'luxuryExtractor' | 'troop' | 'passenger' | 'engine' | 'fighterBay' | 'beam' | 'torpedo' | 'armor' | 'shields' | 'energyCollector';
export const STOCK_TRIM_ORDER: readonly DesignTrimFamily[] = ['gasExtractor', 'mineExtractor', 'luxuryExtractor', 'troop', 'passenger', 'engine', 'fighterBay', 'beam', 'torpedo', 'armor', 'shields', 'energyCollector'];

/**
 * Not in the original: a scenario's changes to one placement of an AI design (Smarter AI). Null = the stock
 * placement. `spec` replaces the template, `scaleShare` replaces the size-up pass's share of MaximumConstructionSize
 * (stock: 1 for capital ships and carriers, 0 = no size-up for the rest), `trimOrder` replaces the trim pass's removal
 * order (null: the stock order; [] = no trimming).
 */
export interface DesignPlacementTweak {
    spec: DesignSpecification;
    scaleShare: number;
    trimOrder: readonly DesignTrimFamily[] | null;
}

/** One placement of `spec` (with `tweak`) on a fresh design of the sub-role being reviewed. */
export type DesignPlacer = (spec: DesignSpecification, tweak: DesignPlacementTweak | null) => Design | null;

/**
 * Not in the original: a scenario's own choice of an AI design (scenario query `aiDesignTweak`, Smarter AI).
 * createNewDesigns calls `choose` in place of its one stock placement. `place`'s first call draws Galaxy.Rnd as the stock
 * placement would; later calls replay those draws, so the random sequence is the stock one whatever `choose` tries.
 */
export interface AIDesignChooser {
    choose(place: DesignPlacer, maxShipSize: number): Design | null;
}

const MOBILE_SUBROLES = new Set<BuiltObjectSubRole>([
    BuiltObjectSubRole.Escort,
    BuiltObjectSubRole.Frigate,
    BuiltObjectSubRole.Destroyer,
    BuiltObjectSubRole.Cruiser,
    BuiltObjectSubRole.CapitalShip,
    BuiltObjectSubRole.TroopTransport,
    BuiltObjectSubRole.Carrier,
    BuiltObjectSubRole.ResupplyShip,
    BuiltObjectSubRole.ExplorationShip,
    BuiltObjectSubRole.SmallFreighter,
    BuiltObjectSubRole.MediumFreighter,
    BuiltObjectSubRole.LargeFreighter,
    BuiltObjectSubRole.ColonyShip,
    BuiltObjectSubRole.PassengerShip,
    BuiltObjectSubRole.ConstructionShip,
    BuiltObjectSubRole.GasMiningShip,
    BuiltObjectSubRole.MiningShip,
]);

// Empire.10.cs SelectPreferredSuperWeapon (1589-1657).
export function selectPreferredSuperWeapon(
    empire: DesignPlacementEmpire,
    techCategories: ComponentCategoryType[],
    techTypes: ComponentType[],
    mustBePlanetDestroyer: boolean,
): ComponentImprovementEntry | null {
    const research = empire.research;
    let result: ComponentImprovementEntry | null = null;
    const list: ComponentImprovementEntry[] = [];
    const beam = research.evaluateDesiredComponentImprovement(ComponentType.WeaponSuperBeam, ShipDesignFocus.Balanced);
    if (beam && (!mustBePlanetDestroyer || isPlanetDestroyerImprovement(beam))) list.push(beam);
    const area = research.evaluateDesiredComponentImprovement(ComponentType.WeaponSuperArea, ShipDesignFocus.Balanced);
    if (area && (!mustBePlanetDestroyer || isPlanetDestroyerImprovement(area))) list.push(area);
    const phaser = research.evaluateDesiredComponentImprovement(ComponentType.WeaponSuperPhaser, ShipDesignFocus.Balanced);
    if (phaser && (!mustBePlanetDestroyer || isPlanetDestroyerImprovement(phaser))) list.push(phaser);
    const railgun = research.evaluateDesiredComponentImprovement(ComponentType.WeaponSuperRailGun, ShipDesignFocus.Balanced);
    if (railgun && (!mustBePlanetDestroyer || isPlanetDestroyerImprovement(railgun))) list.push(railgun);
    const torpedo = research.evaluateDesiredComponentImprovement(ComponentType.WeaponSuperTorpedo, ShipDesignFocus.Balanced);
    if (torpedo && (!mustBePlanetDestroyer || isPlanetDestroyerImprovement(torpedo))) list.push(torpedo);
    const missile = research.evaluateDesiredComponentImprovement(ComponentType.WeaponSuperMissile, ShipDesignFocus.Balanced);
    if (missile && (!mustBePlanetDestroyer || isPlanetDestroyerImprovement(missile))) list.push(missile);
    if (list.length > 0) {
        if (phaser && (techTypes.includes(ComponentType.WeaponPhaser) || techTypes.includes(ComponentType.WeaponSuperPhaser)) && (!mustBePlanetDestroyer || isPlanetDestroyerImprovement(phaser))) {
            result = phaser;
        } else if (railgun && (techTypes.includes(ComponentType.WeaponRailGun) || techTypes.includes(ComponentType.WeaponSuperRailGun)) && (!mustBePlanetDestroyer || isPlanetDestroyerImprovement(railgun))) {
            result = railgun;
        } else if (missile && (techTypes.includes(ComponentType.WeaponMissile) || techTypes.includes(ComponentType.WeaponSuperMissile)) && (!mustBePlanetDestroyer || isPlanetDestroyerImprovement(missile))) {
            result = missile;
        } else if (torpedo && (techTypes.includes(ComponentType.WeaponTorpedo) || techTypes.includes(ComponentType.WeaponSuperTorpedo)) && (!mustBePlanetDestroyer || isPlanetDestroyerImprovement(torpedo))) {
            result = torpedo;
        } else if (beam && (techTypes.includes(ComponentType.WeaponBeam) || techTypes.includes(ComponentType.WeaponSuperBeam)) && (!mustBePlanetDestroyer || isPlanetDestroyerImprovement(beam))) {
            result = beam;
        } else if (area && (techTypes.includes(ComponentType.WeaponAreaDestruction) || techTypes.includes(ComponentType.WeaponSuperArea)) && (!mustBePlanetDestroyer || isPlanetDestroyerImprovement(area))) {
            result = area;
        }
        if (result === null) {
            const index = empire.rnd.next(0, list.length);
            result = list[index];
        }
    }
    return result;
}

function isPlanetDestroyerImprovement(ci: ComponentImprovementEntry): boolean {
    // ComponentImprovement.cs IsPlanetDestroyer (59): super-weapon types with Value1 >= 10000.
    const superTypes = new Set([
        ComponentType.WeaponSuperBeam,
        ComponentType.WeaponSuperArea,
        ComponentType.WeaponSuperPhaser,
        ComponentType.WeaponSuperRailGun,
        ComponentType.WeaponSuperTorpedo,
        ComponentType.WeaponSuperMissile,
    ]);
    return superTypes.has(ci.improvedComponent.type) && ci.value1 >= 10000;
}

// Empire.10.cs IncludeOptionalComponent (3328-3365).
export function includeOptionalComponent(
    rule: DesignSpecificationComponentRule,
    techFocusCategories: ComponentCategoryType[],
    techFocusTypes: ComponentType[],
    dominantRace: DesignPlacementRace | null,
): boolean {
    switch (rule.componentRuleType) {
        case DesignSpecificationComponentRuleType.MustHave:
            return true;
        case DesignSpecificationComponentRuleType.MustNotHave:
            return false;
        case DesignSpecificationComponentRuleType.ShouldHave: {
            if (techFocusCategories.includes(rule.componentCategory) || techFocusTypes.includes(rule.componentType)) return true;
            const aggressiveCategory =
                rule.componentCategory === ComponentCategoryType.WeaponArea ||
                rule.componentCategory === ComponentCategoryType.WeaponBeam ||
                rule.componentCategory === ComponentCategoryType.WeaponTorpedo;
            if (aggressiveCategory && (dominantRace?.aggressionLevel ?? 0) > 110) return true;
            if ((dominantRace?.intelligenceLevel ?? 0) > 105) return true;
            return false;
        }
        case DesignSpecificationComponentRuleType.ShouldNotHave: {
            if (techFocusCategories.includes(rule.componentCategory) || techFocusTypes.includes(rule.componentType)) return true;
            if ((dominantRace?.intelligenceLevel ?? 0) > 120) return true;
            return false;
        }
        default:
            return false;
    }
}

// Empire.10.cs AdjustComponentAmount (3367-3370): identity in this build.
export function adjustComponentAmount(_designSpec: DesignSpecification, rule: DesignSpecificationComponentRule): number {
    return rule.amount;
}

// Empire.10.cs CheckDesignReactorCountDecreased (2991-3011).
export function checkDesignReactorCountDecreased(
    removedComponent: ComponentDefinition,
    research: ResearchSystem,
    state: { staticEnergyUsed: number; energyConsumed: number; recommendedReactorComponentCount: number },
    reactorComponent: ComponentImprovementEntry | null,
    hyperdriveComponent: ComponentImprovementEntry | null,
): boolean {
    const num = removedComponent.energyUsed;
    const component = research.resolveImprovedComponentValues(removedComponent);
    const num2 = determineComponentEnergyRequirementsExcludeHyperdrive(component);
    state.staticEnergyUsed -= num;
    state.energyConsumed -= num2;
    let num3 = state.energyConsumed + state.staticEnergyUsed;
    if (hyperdriveComponent !== null) num3 = Math.max(num3, hyperdriveComponent.value2);
    const num4 = reactorComponent ? determineComponentEnergyOutput(reactorComponent) : 0;
    const num5 = Math.trunc(0.99 + num3 / num4);
    if (state.recommendedReactorComponentCount > num5) {
        state.recommendedReactorComponentCount = num5;
        return true;
    }
    return false;
}

/** Empire.10.cs PlaceComponentsOnDesign(design, designSpec, torpedoWeapons) (1658-1664). */
export function placeComponentsOnDesignDefault(
    empire: DesignPlacementEmpire,
    design: Design,
    designSpec: DesignSpecification,
    torpedoWeapons: ComponentImprovementEntry[] | null,
): Design | null {
    const maxShipSize = empire.maximumConstructionSize(design.subRole);
    const maxBaseSize = empire.maximumConstructionSizeBase(design.subRole);
    return placeComponentsOnDesign(empire, design, designSpec, torpedoWeapons, maxShipSize, maxBaseSize, null, 0.0);
}

/** Empire.10.cs PlaceComponentsOnDesign(design, designSpec, torpedoWeapons, techAdvanceAmount) (1665-1671). */
export function placeComponentsOnDesignWithTech(
    empire: DesignPlacementEmpire,
    design: Design,
    designSpec: DesignSpecification,
    torpedoWeapons: ComponentImprovementEntry[] | null,
    techAdvanceAmount: number,
): Design | null {
    const maxShipSize = empire.maximumConstructionSize(design.subRole);
    const maxBaseSize = empire.maximumConstructionSizeBase(design.subRole);
    return placeComponentsOnDesign(empire, design, designSpec, torpedoWeapons, maxShipSize, maxBaseSize, null, techAdvanceAmount);
}

/** Empire.10.cs PlaceComponentsOnDesign(design, designSpec, torpedoWeapons, maxShipSize, maxBaseSize, mostRecentDesign) (1672-1676). */
export function placeComponentsOnDesignSized(
    empire: DesignPlacementEmpire,
    design: Design,
    designSpec: DesignSpecification,
    torpedoWeapons: ComponentImprovementEntry[] | null,
    maxShipSize: number,
    maxBaseSize: number,
    mostRecentDesign: Design | null,
    tweak: DesignPlacementTweak | null = null,
): Design | null {
    return placeComponentsOnDesign(empire, design, designSpec, torpedoWeapons, maxShipSize, maxBaseSize, mostRecentDesign, 0.0, tweak);
}

/**
 * Empire.10.cs PlaceComponentsOnDesign(design, designSpec, torpedoWeapons, maxShipSize,
 * maxBaseSize, mostRecentDesign, techAdvanceAmount) (1677-2989). See file header for scope.
 */
export function placeComponentsOnDesign(
    empire: DesignPlacementEmpire,
    design: Design,
    designSpec: DesignSpecification,
    torpedoWeaponsIn: ComponentImprovementEntry[] | null,
    maxShipSize: number,
    maxBaseSize: number,
    mostRecentDesign: Design | null,
    techAdvanceAmount: number,
    tweak: DesignPlacementTweak | null = null,
): Design | null {
    const research = empire.research;
    const { categories: techFocusCategories, types: techFocusTypes } = resolveTechFocuses(empire.policy);
    const designFocus: ShipDesignFocus =
        empire.dominantRace !== null && empire.policy !== null ? empire.policy.researchDesignOverallFocus : ShipDesignFocus.Balanced;

    // 1687-1690: torpedoWeapons ??= Galaxy.GenerateOrderedComponentImprovementList(WeaponTorpedo, 1): every
    // torpedo-category component, highest Value1 (damage) first, with its static (unresearched) values.
    const torpedoWeapons =
        torpedoWeaponsIn ?? generateOrderedComponentImprovementList(empire.componentDefinitions, ComponentCategoryType.WeaponTorpedo, 1);

    let energyConsumed = 0.0;
    let energyOutput = 0.0;

    let reactorCi = research.evaluateDesiredComponentImprovement(ComponentType.Reactor, designFocus)
        ?? research.evaluateDesiredComponentImprovementByCategory(ComponentCategoryType.Reactor, designFocus);
    let fuelCi = research.evaluateDesiredComponentImprovement(ComponentType.StorageFuel, designFocus);
    let hyperdriveCi = research.evaluateDesiredComponentImprovementByCategory(ComponentCategoryType.HyperDrive, designFocus);
    let energyCollectorCi = research.evaluateDesiredComponentImprovement(ComponentType.EnergyCollector, designFocus);
    let habModuleCi = research.evaluateDesiredComponentImprovement(ComponentType.HabitationHabModule, designFocus);
    let lifeSupportCi = research.evaluateDesiredComponentImprovement(ComponentType.HabitationLifeSupport, designFocus);
    let missileCi = research.evaluateDesiredComponentImprovement(ComponentType.WeaponMissile, designFocus);
    let phaserCi = research.evaluateDesiredComponentImprovement(ComponentType.WeaponPhaser, designFocus);
    let railgunCi = research.evaluateDesiredComponentImprovement(ComponentType.WeaponRailGun, designFocus);
    let gravityBeamCi = research.evaluateDesiredComponentImprovement(ComponentType.WeaponGravityBeam, designFocus);
    let areaGravityCi = research.evaluateDesiredComponentImprovement(ComponentType.WeaponAreaGravity, designFocus);
    let areaDestructionCi = research.evaluateDesiredComponentImprovement(ComponentType.WeaponAreaDestruction, designFocus);
    let torpedoCategoryCi = research.evaluateDesiredComponentImprovementByCategory(ComponentCategoryType.WeaponTorpedo, designFocus);
    let beamCategoryCi = research.evaluateDesiredComponentImprovementByCategory(ComponentCategoryType.WeaponBeam, designFocus);

    // Lines 1707-1754: Component.EvaluateLatest overrides when techAdvanceAmount > 0.
    if (techAdvanceAmount > 0.0) {
        const latestReactor = evaluateLatestByCategory(empire.componentDefinitions, ComponentCategoryType.Reactor, techAdvanceAmount);
        if (latestReactor) reactorCi = research.resolveImprovedComponentValues(latestReactor);
        const latestFuel = evaluateLatestByType(empire.componentDefinitions, ComponentType.StorageFuel, techAdvanceAmount);
        if (latestFuel) fuelCi = research.resolveImprovedComponentValues(latestFuel);
        const latestHab = evaluateLatestByType(empire.componentDefinitions, ComponentType.HabitationHabModule, techAdvanceAmount);
        if (latestHab) habModuleCi = research.resolveImprovedComponentValues(latestHab);
        const latestLife = evaluateLatestByType(empire.componentDefinitions, ComponentType.HabitationLifeSupport, techAdvanceAmount);
        if (latestLife) lifeSupportCi = research.resolveImprovedComponentValues(latestLife);
        const latestMissile = evaluateLatestByType(empire.componentDefinitions, ComponentType.WeaponMissile, techAdvanceAmount);
        if (latestMissile) missileCi = research.resolveImprovedComponentValues(latestMissile);
        const latestPhaser = evaluateLatestByType(empire.componentDefinitions, ComponentType.WeaponPhaser, techAdvanceAmount);
        if (latestPhaser) phaserCi = research.resolveImprovedComponentValues(latestPhaser);
        const latestRailgun = evaluateLatestByType(empire.componentDefinitions, ComponentType.WeaponRailGun, techAdvanceAmount);
        if (latestRailgun) railgunCi = research.resolveImprovedComponentValues(latestRailgun);
        const latestGravity = evaluateLatestByType(empire.componentDefinitions, ComponentType.WeaponGravityBeam, techAdvanceAmount);
        if (latestGravity) gravityBeamCi = research.resolveImprovedComponentValues(latestGravity);
        const latestAreaGravity = evaluateLatestByType(empire.componentDefinitions, ComponentType.WeaponAreaGravity, techAdvanceAmount);
        if (latestAreaGravity) areaGravityCi = research.resolveImprovedComponentValues(latestAreaGravity);
    }

    let recommendedReactorComponentCount = 0;
    let recommendedEnergyCollectorCount = 0;
    let weaponCountAll = 0;
    let weaponCountBeamFamily = 0;
    let weaponCountTorpedoFamily = 0;
    let fighterBayCount = 0;
    let engineMainThrustCount = 0;
    let shieldsCount = 0;
    let passengerStorageCount = 0;
    let gasExtractorCount = 0;
    let mineExtractorCount = 0;
    let luxuryExtractorCount = 0;
    let sizeUsed = 0;

    const TL = 1; // C# `num14` local (always 1).

    // Lines 1768-2168: the per-rule loop.
    for (const rule of designSpec.componentRules) {
        let ci: ComponentImprovementEntry | null = null;
        if (!(techAdvanceAmount > 0.0)) {
            ci =
                rule.componentType === ComponentType.Undefined
                    ? research.evaluateDesiredComponentImprovementByCategory(rule.componentCategory, designFocus)
                    : research.evaluateDesiredComponentImprovement(rule.componentType, designFocus);
        } else if (rule.componentType !== ComponentType.Undefined) {
            const latest = evaluateLatestByType(empire.componentDefinitions, rule.componentType, techAdvanceAmount);
            if (latest) ci = research.resolveImprovedComponentValues(latest);
        } else {
            const latest = evaluateLatestByCategory(empire.componentDefinitions, rule.componentCategory, techAdvanceAmount);
            if (latest) ci = research.resolveImprovedComponentValues(latest);
        }

        // Lines 1792-1850: WeaponGravityBeam substitution cascade.
        if (rule.componentType === ComponentType.WeaponGravityBeam) {
            if (ci !== null && ci.improvedComponent !== null) {
                const effectiveType: ComponentType = ci.improvedComponent.type;
                if (effectiveType === ComponentType.WeaponGravityBeam) {
                    if (railgunCi && ci.techLevel < railgunCi.techLevel - TL) ci = railgunCi;
                    if (phaserCi && ci.techLevel < phaserCi.techLevel - TL) ci = phaserCi;
                    if (beamCategoryCi && ci.techLevel < beamCategoryCi.techLevel - TL) ci = beamCategoryCi;
                }
            }
            if (ci === null) {
                ci =
                    gravityBeamCi ??
                    beamCategoryCi ??
                    phaserCi ??
                    railgunCi ??
                    torpedoCategoryCi ??
                    missileCi ??
                    (weaponCountTorpedoFamily <= 0 ? areaDestructionCi : null) ??
                    (weaponCountTorpedoFamily <= 0 ? areaGravityCi : null);
            }
        }

        // Lines 1851-2023: category-specific substitution cascades.
        switch (rule.componentCategory) {
            case ComponentCategoryType.WeaponArea:
                if (areaGravityCi && techFocusTypes.includes(ComponentType.WeaponAreaGravity)) ci = areaGravityCi;
                if (ci === null && areaGravityCi) ci = areaGravityCi;
                break;
            case ComponentCategoryType.WeaponBeam: {
                if (beamCategoryCi && techFocusCategories.includes(ComponentCategoryType.WeaponBeam)) ci = beamCategoryCi;
                else if (phaserCi && techFocusTypes.includes(ComponentType.WeaponPhaser)) ci = phaserCi;
                else if (railgunCi && techFocusTypes.includes(ComponentType.WeaponRailGun)) ci = railgunCi;
                else if (gravityBeamCi && techFocusTypes.includes(ComponentType.WeaponGravityBeam)) ci = gravityBeamCi;
                if (ci !== null && ci.improvedComponent !== null) {
                    switch (ci.improvedComponent.type) {
                        case ComponentType.WeaponBeam:
                            if (railgunCi && ci.techLevel < railgunCi.techLevel - TL) ci = railgunCi;
                            if (phaserCi && ci.techLevel < phaserCi.techLevel - TL) ci = phaserCi;
                            if (gravityBeamCi && ci.techLevel < gravityBeamCi.techLevel - TL) ci = gravityBeamCi;
                            break;
                        case ComponentType.WeaponGravityBeam:
                            if (railgunCi && ci.techLevel < railgunCi.techLevel - TL) ci = railgunCi;
                            if (phaserCi && ci.techLevel < phaserCi.techLevel - TL) ci = phaserCi;
                            if (beamCategoryCi && ci.techLevel < beamCategoryCi.techLevel - TL) ci = beamCategoryCi;
                            break;
                        case ComponentType.WeaponPhaser:
                            if (railgunCi && ci.techLevel < railgunCi.techLevel - TL) ci = railgunCi;
                            if (gravityBeamCi && ci.techLevel < gravityBeamCi.techLevel - TL) ci = gravityBeamCi;
                            if (beamCategoryCi && ci.techLevel < beamCategoryCi.techLevel - TL) ci = beamCategoryCi;
                            break;
                        case ComponentType.WeaponRailGun:
                            if (phaserCi && ci.techLevel < phaserCi.techLevel - TL) ci = phaserCi;
                            if (gravityBeamCi && ci.techLevel < gravityBeamCi.techLevel - TL) ci = gravityBeamCi;
                            if (beamCategoryCi && ci.techLevel < beamCategoryCi.techLevel - TL) ci = beamCategoryCi;
                            break;
                    }
                }
                if (ci === null) {
                    ci =
                        beamCategoryCi ??
                        phaserCi ??
                        railgunCi ??
                        gravityBeamCi ??
                        torpedoCategoryCi ??
                        missileCi ??
                        (weaponCountTorpedoFamily <= 0 ? areaDestructionCi : null) ??
                        (weaponCountTorpedoFamily <= 0 ? areaGravityCi : null);
                }
                break;
            }
            case ComponentCategoryType.WeaponTorpedo: {
                if (ci !== null && rule.componentType !== ComponentType.WeaponBombard) {
                    let guard = 0;
                    let idx = 0;
                    while (ci.value7 > 0 && ci.improvedComponent.componentId !== 9 && guard < torpedoWeapons.length) {
                        if (torpedoWeapons.length > idx && research.checkComponentResearched(torpedoWeapons[idx].improvedComponent)) {
                            ci = torpedoWeapons[idx];
                        }
                        idx++;
                        guard++;
                    }
                }
                if (ci !== null && ci.improvedComponent !== null) {
                    switch (ci.improvedComponent.type) {
                        case ComponentType.WeaponTorpedo:
                            if (missileCi && ci.techLevel < missileCi.techLevel - TL) ci = missileCi;
                            break;
                        case ComponentType.WeaponMissile:
                            if (torpedoCategoryCi && ci.techLevel < torpedoCategoryCi.techLevel - TL) ci = torpedoCategoryCi;
                            break;
                    }
                }
                if (ci === null) {
                    if (torpedoCategoryCi && torpedoCategoryCi.value1 > 0) ci = torpedoCategoryCi;
                    else if (missileCi) ci = missileCi;
                }
                break;
            }
        }

        if (ci === null) continue;

        const isReactor = ci.improvedComponent !== null && ci.improvedComponent.type === ComponentType.Reactor;
        const isEnergyCollector = ci.improvedComponent !== null && ci.improvedComponent.type === ComponentType.EnergyCollector;

        let amount = rule.amount;
        if (rule.componentRuleType === DesignSpecificationComponentRuleType.MustHave) {
            amount = adjustComponentAmount(designSpec, rule);
            for (let k = 0; k < amount; k++) {
                if (isReactor) recommendedReactorComponentCount++;
                else if (isEnergyCollector) recommendedEnergyCollectorCount++;
                else design.components.push(ci.improvedComponent);
                sizeUsed += ci.improvedComponent.size;
                energyConsumed += determineComponentEnergyRequirementsExcludeHyperdrive(ci);
                energyOutput += determineComponentEnergyOutput(ci);
            }
        } else if (
            rule.componentRuleType === DesignSpecificationComponentRuleType.ShouldNotHave ||
            rule.componentRuleType === DesignSpecificationComponentRuleType.ShouldHave
        ) {
            if (includeOptionalComponent(rule, techFocusCategories, techFocusTypes, empire.dominantRace)) {
                amount = adjustComponentAmount(designSpec, rule);
                for (let j = 0; j < amount; j++) {
                    if (isReactor) recommendedReactorComponentCount++;
                    else if (isEnergyCollector) recommendedEnergyCollectorCount++;
                    else design.components.push(ci.improvedComponent);
                    sizeUsed += ci.improvedComponent.size;
                    energyConsumed += determineComponentEnergyRequirementsExcludeHyperdrive(ci);
                    energyOutput += determineComponentEnergyOutput(ci);
                }
            } else {
                amount = 0;
            }
        } else {
            amount = 0; // MustNotHave
        }

        // Lines 2097-2145: per-type running counts.
        switch (ci.improvedComponent.type) {
            case ComponentType.WeaponBeam:
            case ComponentType.WeaponGravityBeam:
            case ComponentType.WeaponPhaser:
            case ComponentType.WeaponRailGun:
                weaponCountBeamFamily += amount;
                weaponCountAll += amount;
                break;
            case ComponentType.WeaponTorpedo:
            case ComponentType.WeaponMissile:
                weaponCountTorpedoFamily += amount;
                weaponCountAll += amount;
                break;
            case ComponentType.WeaponBombard:
            case ComponentType.WeaponIonCannon:
            case ComponentType.WeaponIonPulse:
            case ComponentType.WeaponAreaGravity:
            case ComponentType.WeaponAreaDestruction:
            case ComponentType.WeaponSuperBeam:
            case ComponentType.WeaponSuperArea:
            case ComponentType.WeaponSuperTorpedo:
            case ComponentType.WeaponSuperMissile:
            case ComponentType.WeaponSuperPhaser:
            case ComponentType.WeaponSuperRailGun:
                weaponCountAll += amount;
                break;
            case ComponentType.FighterBay:
                fighterBayCount += amount;
                break;
            case ComponentType.EngineMainThrust:
                engineMainThrustCount += amount;
                break;
            case ComponentType.Shields:
                shieldsCount += amount;
                break;
            case ComponentType.StoragePassenger:
                passengerStorageCount += amount;
                break;
            case ComponentType.ExtractorGasExtractor:
                gasExtractorCount += amount;
                break;
            case ComponentType.ExtractorMine:
                mineExtractorCount += amount;
                break;
            case ComponentType.ExtractorLuxury:
                luxuryExtractorCount += amount;
                break;
        }

        // Lines 2146-2167.
        switch (ci.improvedComponent.type) {
            case ComponentType.EnergyCollector:
                if (design.role === BuiltObjectRole.Base && designSpecContainsType(designSpec, ComponentType.SensorLongRange)) {
                    recommendedEnergyCollectorCount += 2;
                    sizeUsed += ci.improvedComponent.size * 2;
                    energyOutput += determineComponentEnergyOutput(ci) * 2;
                }
                break;
            case ComponentType.EngineMainThrust:
            case ComponentType.EngineVectoring:
                if (empire.policy && empire.policy.researchDesignOverallFocus === ShipDesignFocus.SpeedAgility) {
                    design.components.push(ci.improvedComponent);
                    sizeUsed += ci.improvedComponent.size;
                    energyConsumed += determineComponentEnergyRequirementsExcludeHyperdrive(ci);
                }
                break;
        }
    }

    // Line 2169-2172.
    if (designSpec.role === BuiltObjectRole.Military && weaponCountAll <= 0 && fighterBayCount <= 0) {
        return null;
    }

    // Lines 2173-2188: pre-hyperdrive fuel tanks for construction ships.
    if (!empire.hasHyperDriveTech) {
        if (designSpec.subRole === BuiltObjectSubRole.ConstructionShip) {
            const fuel = research.evaluateDesiredComponentImprovement(ComponentType.StorageFuel, designFocus);
            if (fuel && fuel.improvedComponent) {
                for (let i = 0; i < 4; i++) design.components.push(fuel.improvedComponent);
                sizeUsed += fuel.improvedComponent.size * 4;
            }
        }
    }
    // Lines 2189-2198: PirateEmpireBaseHabitat gas-extractor bonus for pirate space ports.
    if (
        empire.isPirate &&
        (designSpec.subRole === BuiltObjectSubRole.SmallSpacePort ||
            designSpec.subRole === BuiltObjectSubRole.MediumSpacePort ||
            designSpec.subRole === BuiltObjectSubRole.LargeSpacePort) &&
        getFirstByType(design.components, ComponentType.ExtractorGasExtractor) === null
    ) {
        const gasExtractor = research.evaluateDesiredComponent(ComponentType.ExtractorGasExtractor, designFocus);
        if (gasExtractor) {
            design.components.push(gasExtractor);
            design.components.push(gasExtractor);
            sizeUsed += gasExtractor.size * 2;
        }
    }

    // Lines 2199-2231: reactor/fuel top-up to cover static+consumed energy.
    let staticEnergyUsed = calculateStaticEnergyUsage(design.components);
    let deficit = energyConsumed + staticEnergyUsed - energyOutput;
    if (deficit > 0.0 && reactorCi && fuelCi) {
        const extraReactors = Math.trunc(0.99 + deficit / reactorCi.value1);
        for (let l = 0; l < extraReactors; l++) {
            recommendedReactorComponentCount++;
            sizeUsed += reactorCi.improvedComponent.size;
            energyOutput += determineComponentEnergyOutput(reactorCi);
        }
        if (designSpec.role === BuiltObjectRole.Base) {
            let sizeConstrained = true;
            switch (designSpec.subRole) {
                case BuiltObjectSubRole.SmallSpacePort:
                case BuiltObjectSubRole.MediumSpacePort:
                case BuiltObjectSubRole.LargeSpacePort:
                case BuiltObjectSubRole.DefensiveBase:
                    sizeConstrained = false;
                    break;
            }
            if (!sizeConstrained || sizeUsed + extraReactors * fuelCi.improvedComponent.size <= maxBaseSize) {
                for (let m = 0; m < extraReactors; m++) {
                    design.components.push(fuelCi.improvedComponent);
                    sizeUsed += fuelCi.improvedComponent.size;
                }
            }
        }
    }

    // Lines 2232-2268: extra reactors so a mobile design can afford its hyperdrive.
    if (MOBILE_SUBROLES.has(designSpec.subRole)) {
        staticEnergyUsed = calculateStaticEnergyUsage(design.components);
        const spareEnergy = energyOutput - staticEnergyUsed;
        const hd = research.evaluateDesiredComponentImprovementByCategory(ComponentCategoryType.HyperDrive, designFocus);
        if (hd && hd.value2 > spareEnergy && reactorCi) {
            const reactorOutput = determineComponentEnergyOutput(reactorCi);
            const extra = reactorOutput > 0 ? Math.trunc(0.99 + (hd.value2 - spareEnergy) / reactorOutput) : 0;
            for (let n = 0; n < extra; n++) {
                recommendedReactorComponentCount++;
                sizeUsed += reactorCi.improvedComponent.size;
                energyOutput += determineComponentEnergyOutput(reactorCi);
            }
        }
    }

    // Galaxy.8.cs DetermineHabModulesRequired/DetermineLifeSupportRequired(ComponentImprovement,
    // int size, bool designIsBase) raw-size overload — both PlaceComponentsOnDesign call sites
    // that use it (2273-2274, 2381-2382) always pass designIsBase: false.
    function modulesRequiredForSize(ci: ComponentImprovementEntry | null, size: number): number {
        if (ci === null) return 0;
        let n = Math.trunc(size / ci.value1) + 1;
        const rem = size % ci.value1;
        if (rem === 0) n--;
        return n;
    }

    // Lines 2269-2346: capital ship / carrier size rebalance toward MaximumConstructionSize
    // (a fresh call, not the maxShipSize parameter — matches Empire.10.cs 2276 exactly).
    let num23 = 0;
    let num24 = 0;
    // [scenario] a tweak's scaleShare replaces the stock share (capital ships and carriers 1, the rest 0).
    const scaleShare = tweak !== null ? tweak.scaleShare : design.subRole === BuiltObjectSubRole.CapitalShip || design.subRole === BuiltObjectSubRole.Carrier ? 1 : 0;
    if (scaleShare > 0) {
        num23 = modulesRequiredForSize(habModuleCi, sizeUsed);
        num24 = modulesRequiredForSize(lifeSupportCi, sizeUsed);
        const num25 = sizeUsed + num23 * (habModuleCi?.improvedComponent.size ?? 0) + num24 * (lifeSupportCi?.improvedComponent.size ?? 0);
        const num26 = scaleShare === 1 ? empire.maximumConstructionSize(design.subRole) : Math.trunc(empire.maximumConstructionSize(design.subRole) * scaleShare);
        if (num25 < num26) {
            const num27 = num26 / num25;
            if (num27 > 1.05) {
                const counts = resolveComponentCountsByType(design.components, empire.componentDefinitions.length);
                for (let id = 0; id < counts.length; id++) {
                    const before = counts[id];
                    if (before <= 0) continue;
                    const def = empire.componentDefinitions.find((c) => c.componentId === id);
                    if (!def) continue;
                    switch (def.type) {
                        case ComponentType.Reactor: {
                            const num32 = Math.trunc(before * num27);
                            recommendedReactorComponentCount += num32 - before;
                            break;
                        }
                        case ComponentType.EnergyCollector: {
                            const num35 = Math.trunc(before * num27);
                            recommendedEnergyCollectorCount += num35 - before;
                            break;
                        }
                        case ComponentType.HyperDeny:
                        case ComponentType.HyperStop:
                        case ComponentType.HyperDrive:
                        case ComponentType.SensorProximityArray:
                        case ComponentType.SensorResourceProfileSensor:
                        case ComponentType.SensorLongRange:
                        case ComponentType.SensorTraceScanner:
                        case ComponentType.SensorScannerJammer:
                        case ComponentType.SensorStealth:
                        case ComponentType.ComputerTargetting:
                        case ComponentType.ComputerTargettingFleet:
                        case ComponentType.ComputerCountermeasures:
                        case ComponentType.ComputerCountermeasuresFleet:
                        case ComponentType.ComputerCommandCenter:
                        case ComponentType.ComputerCommerceCenter:
                        case ComponentType.HabitationLifeSupport:
                        case ComponentType.HabitationHabModule:
                        case ComponentType.DamageControl:
                        case ComponentType.HabitationMedicalCenter:
                        case ComponentType.HabitationRecreationCenter:
                        case ComponentType.HabitationColonization:
                        case ComponentType.EnergyToFuel:
                            // C# leaves these categories out of the size-up pass (no-op).
                            break;
                        default: {
                            const num29 = Math.trunc(before * num27);
                            const num30 = num29 - before;
                            for (let e = 0; e < num30; e++) design.components.push(def);
                            break;
                        }
                    }
                }
                // Note: C# does not recompute num13/sizeUsed after this loop even though it just
                // pushed components — sizeUsed is knowingly left stale here, matching 2269-2346.
            }
        }
    }

    // Lines 2350-2361: pick the size limit (num38) for the trim pass below.
    const num38 = trimSizeLimitFor(design.subRole, maxShipSize, maxBaseSize);

    // Lines 2362-2915: over-budget trim, only for these subroles (note ResupplyShip is NOT
    // included here even though it is in the earlier hyperdrive-affordability switch).
    if (TRIM_ELIGIBLE_SUBROLES.has(design.subRole)) {
        num23 = modulesRequiredForSize(habModuleCi, sizeUsed);
        num24 = modulesRequiredForSize(lifeSupportCi, sizeUsed);
        let num39 = sizeUsed + num23 * (habModuleCi?.improvedComponent.size ?? 0) + num24 * (lifeSupportCi?.improvedComponent.size ?? 0);
        if (num39 > num38) {
            // Lines 2388-2412: the twelve per-family candidate lists.
            const armorList: ComponentDefinition[] = [];
            const energyCollectorList: ComponentDefinition[] = [];
            const troopStorageList: ComponentDefinition[] = [];
            const fighterBayList: ComponentDefinition[] = [];
            const engineList: ComponentDefinition[] = [];
            const shieldsList: ComponentDefinition[] = [];
            const passengerList: ComponentDefinition[] = [];
            const beamGravityList: ComponentDefinition[] = [];
            const torpedoList: ComponentDefinition[] = [];
            const gasExtractorList: ComponentDefinition[] = [];
            const mineExtractorList: ComponentDefinition[] = [];
            const luxuryExtractorList: ComponentDefinition[] = [];
            let num40 = 0; // armor
            let num41 = 0; // energy collector
            let num42 = 0; // troop storage
            let num43 = 0; // fighter bay (carrier, single slot)
            let num44 = 0; // engine + fighter bay (non-carrier) — shared accumulator, matches C#
            let num45 = 0; // shields
            let num46 = 0; // passenger storage
            let num47 = 0; // beam/gravity weapons
            let num48 = 0; // torpedo weapons
            let num49 = 0; // gas extractor
            let num50 = 0; // mine extractor
            let num51 = 0; // luxury extractor

            // Lines 2413-2429: WarpSpeed comparison to decide the aggressive (flag4) thresholds.
            // `mostRecentDesign.WarpSpeed` is set by Design.ReDefine (design.ts).
            const colonyOrPassenger = new Set<BuiltObjectSubRole>([BuiltObjectSubRole.ColonyShip, BuiltObjectSubRole.PassengerShip]);
            let flag4 = false;
            if (mostRecentDesign !== null && hyperdriveCi !== null) {
                const num52 = mostRecentDesign.warpSpeed;
                const num53 = hyperdriveCi.value1;
                if (num52 <= 0 || num53 / num52 >= 2) flag4 = true;
            } else if (mostRecentDesign === null && hyperdriveCi !== null && colonyOrPassenger.has(designSpec.subRole)) {
                flag4 = true;
            }

            let num54 = 0.25;
            let num55 = 0.33;
            let num56 = 0.25;
            let num57 = 0.33;
            let num58 = 0.5;
            let num59 = 0.5;
            let num60 = 1;
            if (flag4) {
                num54 = 0.6;
                num55 = 0.5;
                num56 = 1.0;
                num57 = 0.7;
                num59 = 0.7;
                num60 = 2;
            }

            // Lines 2446-2560 (Military) / 2561-2671 (else): classify current components into the
            // twelve candidate lists, up to each family's cap.
            const isMilitary = design.role === BuiltObjectRole.Military;
            for (const c of design.components) {
                if (c.type === ComponentType.ExtractorGasExtractor) {
                    const cap = Math.max(1, Math.trunc(gasExtractorCount * num58));
                    if (gasExtractorList.length < cap) {
                        gasExtractorList.push(c);
                        num49 += c.size;
                    }
                } else if (c.type === ComponentType.ExtractorMine) {
                    const cap = Math.max(1, Math.trunc(mineExtractorCount * num58));
                    if (mineExtractorList.length < cap) {
                        mineExtractorList.push(c);
                        num50 += c.size;
                    }
                } else if (c.type === ComponentType.ExtractorLuxury) {
                    const cap = Math.max(1, Math.trunc(luxuryExtractorCount * num58));
                    if (luxuryExtractorList.length < cap) {
                        luxuryExtractorList.push(c);
                        num51 += c.size;
                    }
                } else if (isMilitary && c.type === ComponentType.EngineMainThrust) {
                    const cap = Math.max(1, Math.trunc(engineMainThrustCount * num54));
                    if (engineList.length < cap) {
                        engineList.push(c);
                        num44 += c.size;
                    }
                } else if (isMilitary && c.type === ComponentType.FighterBay) {
                    if (design.subRole === BuiltObjectSubRole.Carrier) {
                        if (fighterBayList.length <= 0) {
                            fighterBayList.push(c);
                            num43 += c.size;
                        }
                        continue;
                    }
                    const cap = Math.max(1, Math.trunc(fighterBayCount * num59));
                    if (fighterBayList.length < cap) {
                        fighterBayList.push(c);
                        num44 += c.size;
                    }
                } else if (isMilitary && c.type === ComponentType.StorageTroop) {
                    if (design.subRole !== BuiltObjectSubRole.TroopTransport || troopStorageList.length < num60) {
                        troopStorageList.push(c);
                        num42 += c.size;
                    }
                } else if (isMilitary && c.category === ComponentCategoryType.Armor) {
                    armorList.push(c);
                    num40 += c.size;
                } else if (c.type === ComponentType.Shields) {
                    const cap = Math.max(1, Math.trunc(shieldsCount * num56));
                    if (shieldsList.length < cap) {
                        shieldsList.push(c);
                        num45 += c.size;
                    }
                } else if (isMilitary && c.type === ComponentType.StoragePassenger) {
                    let cap = Math.max(1, Math.trunc(passengerStorageCount * num57));
                    cap = Math.min(cap, passengerStorageCount - 1);
                    if (passengerList.length < cap) {
                        passengerList.push(c);
                        num46 += c.size;
                    }
                } else if (c.category === ComponentCategoryType.EnergyCollector) {
                    energyCollectorList.push(c);
                    num41 += c.size;
                } else if (isMilitary && (c.category === ComponentCategoryType.WeaponBeam || c.category === ComponentCategoryType.WeaponGravity)) {
                    const cap = Math.max(1, Math.trunc(weaponCountBeamFamily * num55));
                    if (beamGravityList.length < cap) {
                        beamGravityList.push(c);
                        num47 += c.size;
                    }
                } else if (isMilitary && c.category === ComponentCategoryType.WeaponTorpedo) {
                    const cap = Math.max(1, Math.trunc(weaponCountTorpedoFamily * num55));
                    if (torpedoList.length < cap) {
                        torpedoList.push(c);
                        num48 += c.size;
                    }
                } else if (!isMilitary && c.category === ComponentCategoryType.Armor) {
                    armorList.push(c);
                    num40 += c.size;
                } else if (!isMilitary && c.type === ComponentType.StoragePassenger) {
                    const cap = Math.max(1, Math.trunc(passengerStorageCount * num57));
                    if (passengerList.length < cap) {
                        passengerList.push(c);
                        num46 += c.size;
                    }
                } else if (!isMilitary && c.type === ComponentType.EngineMainThrust) {
                    const cap = Math.max(1, Math.trunc(engineMainThrustCount * num54));
                    if (engineList.length < cap) {
                        engineList.push(c);
                        num44 += c.size;
                    }
                } else if (!isMilitary && (c.category === ComponentCategoryType.WeaponBeam || c.category === ComponentCategoryType.WeaponGravity)) {
                    const cap = Math.max(1, Math.trunc(weaponCountBeamFamily * num55));
                    if (beamGravityList.length < cap) {
                        beamGravityList.push(c);
                        num47 += c.size;
                    }
                } else if (!isMilitary && c.category === ComponentCategoryType.WeaponTorpedo) {
                    const cap = Math.max(1, Math.trunc(weaponCountTorpedoFamily * num55));
                    if (torpedoList.length < cap) {
                        torpedoList.push(c);
                        num48 += c.size;
                    }
                } else if (!isMilitary && c.type === ComponentType.FighterBay) {
                    if (design.subRole === BuiltObjectSubRole.Carrier) {
                        if (fighterBayList.length <= 0) {
                            fighterBayList.push(c);
                            num43 += c.size;
                        }
                        continue;
                    }
                    const cap = Math.max(1, Math.trunc(fighterBayCount * num59));
                    if (fighterBayList.length < cap) {
                        fighterBayList.push(c);
                        num44 += c.size;
                    }
                } else if (!isMilitary && c.type === ComponentType.StorageTroop && troopStorageList.length < num60) {
                    troopStorageList.push(c);
                    num42 += c.size;
                }
            }

            // Lines 2672-2676: drop the smallest armor candidate before the feasibility check.
            if (armorList.length > 1) {
                num40 -= armorList[0].size;
                armorList.splice(0, 1);
            }

            // Line 2677-2680: feasibility pre-check — if removing every candidate still wouldn't
            // fit, skip trimming entirely.
            const totalCandidateSize = num40 + num41 + num42 + num43 + num46 + num44 + num45 + num47 + num48 + num49 + num50 + num51;
            if (num39 - totalCandidateSize <= num38) {
                const energyState = { staticEnergyUsed, energyConsumed, recommendedReactorComponentCount };
                const removeOne = (comp: ComponentDefinition, checkReactor: boolean) => {
                    const idx = design.components.findIndex((x) => x === comp);
                    if (idx >= 0) design.components.splice(idx, 1);
                    sizeUsed -= comp.size;
                    if (checkReactor) {
                        if (checkDesignReactorCountDecreased(comp, research, energyState, reactorCi, hyperdriveCi)) {
                            sizeUsed -= reactorCi?.improvedComponent.size ?? 0;
                        }
                    }
                    num23 = modulesRequiredForSize(habModuleCi, sizeUsed);
                    num24 = modulesRequiredForSize(lifeSupportCi, sizeUsed);
                    num39 = sizeUsed + num23 * (habModuleCi?.improvedComponent.size ?? 0) + num24 * (lifeSupportCi?.improvedComponent.size ?? 0);
                };
                // Lines 2681-2911: the removal cascade, one family at a time in the stock order (gas, mine, luxury
                // extractors, troop and passenger storage, engines, fighter bays, beam/gravity and torpedo weapons,
                // armor, shields, energy collectors), each until the design fits; num39 recomputed after each family.
                // Armor (2861) and energy collectors (2897) skip CheckDesignReactorCountDecreased, as in C#. A
                // scenario tweak may reorder the families.
                const trimFamilies: Record<DesignTrimFamily, { list: ComponentDefinition[]; checkReactor: boolean; gate: boolean }> = {
                    gasExtractor: { list: gasExtractorList, checkReactor: true, gate: gasExtractorList.length > 0 },
                    mineExtractor: { list: mineExtractorList, checkReactor: true, gate: mineExtractorList.length > 0 },
                    // NOTE (C# 2721): the luxury gate re-checks gasExtractorList.length, not luxuryExtractorList.length —
                    // a copy-paste quirk in Empire.10.cs, preserved verbatim.
                    luxuryExtractor: { list: luxuryExtractorList, checkReactor: true, gate: gasExtractorList.length > 0 },
                    troop: { list: troopStorageList, checkReactor: true, gate: troopStorageList.length > 0 },
                    passenger: { list: passengerList, checkReactor: true, gate: passengerList.length > 0 },
                    engine: { list: engineList, checkReactor: true, gate: engineList.length > 0 },
                    fighterBay: { list: fighterBayList, checkReactor: true, gate: fighterBayList.length > 0 },
                    beam: { list: beamGravityList, checkReactor: true, gate: beamGravityList.length > 0 },
                    torpedo: { list: torpedoList, checkReactor: true, gate: torpedoList.length > 0 },
                    armor: { list: armorList, checkReactor: false, gate: armorList.length > 0 },
                    shields: { list: shieldsList, checkReactor: true, gate: shieldsList.length > 0 },
                    energyCollector: { list: energyCollectorList, checkReactor: false, gate: energyCollectorList.length > 0 },
                };
                const trimOrder = tweak?.trimOrder ?? STOCK_TRIM_ORDER;
                for (let f = 0; f < trimOrder.length; f++) {
                    const fam = trimFamilies[trimOrder[f]];
                    if (f > 0) num39 = sizeUsed + num23 * (habModuleCi?.improvedComponent.size ?? 0) + num24 * (lifeSupportCi?.improvedComponent.size ?? 0);
                    if (num39 > num38 && fam.gate) {
                        for (const comp of fam.list) {
                            removeOne(comp, fam.checkReactor);
                            if (num39 <= num38) break;
                        }
                    }
                }
                staticEnergyUsed = energyState.staticEnergyUsed;
                energyConsumed = energyState.energyConsumed;
                recommendedReactorComponentCount = energyState.recommendedReactorComponentCount;
            }
        }
    }

    // Lines 2916-2922: fully recompute static/consumed energy from the design as it now stands.
    staticEnergyUsed = calculateStaticEnergyUsage(design.components);
    energyConsumed = 0.0;
    for (const c of design.components) {
        energyConsumed += determineComponentEnergyRequirementsExcludeHyperdrive(research.resolveImprovedComponentValues(c));
    }

    // Lines 2923-2933: final reactor placement — a fresh calculation, not `recommendedReactorComponentCount`.
    let num93 = energyConsumed + staticEnergyUsed;
    if (hyperdriveCi !== null) num93 = Math.max(num93, hyperdriveCi.value2);
    const num94 = reactorCi ? determineComponentEnergyOutput(reactorCi) : 0;
    if (reactorCi && num94 > 0) {
        const num95 = Math.trunc(0.99 + num93 / num94);
        for (let i = 0; i < num95; i++) design.components.push(reactorCi.improvedComponent);
    }

    // Lines 2934-2945: final energy-collector placement, floored by `recommendedEnergyCollectorCount`.
    if (recommendedEnergyCollectorCount > 0 && energyCollectorCi !== null) {
        const num97 = 0.01;
        const num98 = 50.0;
        const num99 = energyCollectorCi.value1 * num97 * num98;
        let val2 = Math.trunc(0.99 + staticEnergyUsed / num99);
        val2 = Math.max(recommendedEnergyCollectorCount, val2);
        for (let i = 0; i < val2; i++) design.components.push(energyCollectorCi.improvedComponent);
    }

    // Lines 2946-2977: capital-ship super-weapon add-on for aggressive/intelligent races.
    if (
        design.subRole === BuiltObjectSubRole.CapitalShip &&
        (empire.dominantRace?.aggressionLevel ?? 0) >= 100 &&
        (empire.dominantRace?.intelligenceLevel ?? 0) >= 100
    ) {
        const superWeapon = selectPreferredSuperWeapon(empire, techFocusCategories, techFocusTypes, false);
        if (superWeapon !== null && !isPlanetDestroyerImprovement(superWeapon)) {
            const num101 = empire.maximumConstructionSize(design.subRole);
            let num102 = superWeapon.improvedComponent.energyUsed;
            if (
                superWeapon.improvedComponent.category === ComponentCategoryType.WeaponSuperArea ||
                superWeapon.improvedComponent.category === ComponentCategoryType.WeaponSuperBeam ||
                superWeapon.improvedComponent.category === ComponentCategoryType.WeaponSuperTorpedo
            ) {
                num102 += superWeapon.value3;
            }
            if (reactorCi !== null && fuelCi !== null) {
                const num103 = Math.trunc(num102 / reactorCi.value2) + 1;
                let size = superWeapon.improvedComponent.size;
                size += reactorCi.improvedComponent.size * num103;
                size += fuelCi.improvedComponent.size * num103;
                if (num101 >= sizeUsed + size) {
                    design.components.push(superWeapon.improvedComponent);
                    for (let i = 0; i < num103; i++) design.components.push(reactorCi.improvedComponent);
                    for (let i = 0; i < num103; i++) design.components.push(fuelCi.improvedComponent);
                }
            }
        }
    }

    // Lines 2978-2987: final hab modules / life support, from the design as actually built
    // (design-based overload: role/size read straight off `design`).
    num23 = habModuleCi ? determineHabModulesRequired(habModuleCi, design) : 0;
    num24 = lifeSupportCi ? determineLifeSupportRequired(lifeSupportCi, design) : 0;
    for (let i = 0; i < num23; i++) {
        if (habModuleCi) design.components.push(habModuleCi.improvedComponent);
    }
    for (let i = 0; i < num24; i++) {
        if (lifeSupportCi) design.components.push(lifeSupportCi.improvedComponent);
    }

    return design;
}

function designSpecContainsType(designSpec: DesignSpecification, type: ComponentType): boolean {
    return designSpec.componentRules.some((r) => r.componentType === type);
}

const TRIM_ELIGIBLE_SUBROLES = new Set<BuiltObjectSubRole>([
    BuiltObjectSubRole.Escort,
    BuiltObjectSubRole.Frigate,
    BuiltObjectSubRole.Destroyer,
    BuiltObjectSubRole.Cruiser,
    BuiltObjectSubRole.CapitalShip,
    BuiltObjectSubRole.TroopTransport,
    BuiltObjectSubRole.Carrier,
    BuiltObjectSubRole.ExplorationShip,
    BuiltObjectSubRole.SmallFreighter,
    BuiltObjectSubRole.MediumFreighter,
    BuiltObjectSubRole.LargeFreighter,
    BuiltObjectSubRole.ColonyShip,
    BuiltObjectSubRole.PassengerShip,
    BuiltObjectSubRole.ConstructionShip,
    BuiltObjectSubRole.GasMiningShip,
    BuiltObjectSubRole.MiningShip,
]);

// Empire.10.cs 2350-2361 (num38 selection).
function trimSizeLimitFor(subRole: BuiltObjectSubRole, maxShipSize: number, maxBaseSize: number): number {
    switch (subRole) {
        case BuiltObjectSubRole.ResupplyShip:
        case BuiltObjectSubRole.ColonyShip:
        case BuiltObjectSubRole.ConstructionShip:
            return maxBaseSize;
        default:
            return maxShipSize;
    }
}


export { getFirstByType };
