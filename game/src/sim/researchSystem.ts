// Research runtime for game start (task C2c-3). Ports of
//   ResearchNodeDefinitionList.ObtainTechTree (890) — one node per definition
//   ResearchNodeDefinitionList.SetTechTreeLevel (1141) — integer/fractional levels
//   Galaxy.3.cs SetResearchRaceSpecialProjects (1929) — AllowedRaces
//   ResearchSystem.Update → DetermineResearchedComponents / DetermineResearchAbilities
//   Empire.3.cs ReviewColonizationTypes (2184), CheckEmpireHasHyperDriveTech (3593)
//   SetTechTreeStartingDefaults (1023) / ...Pirates (901), ResearchNodeList
//   FindAndResearchLowestProject / GetLowestProjectFor* helpers
// TODO(port): project costs, parents, wonder (victory-condition) races, component
// improvements, facilities, fighters, plagues, latest/best component tables.

import type { ResearchNode as ResearchNodeDefinition } from './data/research';
import type { Component } from './data/components';
import { ComponentType } from './data/components';
import type { Race } from './data/races';
import type { Random } from './random';
import { ComponentCategoryType, componentCategoryByIndex, defaultEmpirePolicy, resolveTechDisallow, resolveTechFocuses, type EmpirePolicy } from './data/policies';
import {
    checkComponentDefinitionMatchesCategoryStrict,
    resolveComponentCategory,
    resolveIndustry,
    componentImprovementFromComponent,
    type ComponentDefinition,
    type ComponentImprovementEntry,
    type ComponentStatic,
} from './componentStatic';

// Port of ShipDesignFocus.cs (enum member order exact).
export enum ShipDesignFocus {
    Balanced,
    SpeedAgility,
    Power,
    Efficiency,
}

// Enumerates the numeric values of a numeric TS enum (Object.values on a
// numeric enum also yields the reverse-mapping names, so we filter to numbers).
function numericEnumValues(e: Record<string, unknown>): number[] {
    return Object.values(e).filter((v): v is number => typeof v === 'number');
}

// ResearchAbilityType.cs, mapped from the research.txt ability code
// (ResearchNodeDefinitionList.cs 504-522: 0 Boarding, 1 ColonizeHabitatType,
// 2 ConstructionSize, 3 EnableShipSubRole, 4 PopulationGrowthRate, 5 Troop).
export enum ResearchAbilityType {
    Undefined,
    ConstructionSize,
    PopulationGrowthRate,
    ColonizeHabitatType,
    EnableShipSubRole,
    Troop,
    Boarding,
}
const ABILITY_FROM_FILE = [
    ResearchAbilityType.Boarding,
    ResearchAbilityType.ColonizeHabitatType,
    ResearchAbilityType.ConstructionSize,
    ResearchAbilityType.EnableShipSubRole,
    ResearchAbilityType.PopulationGrowthRate,
    ResearchAbilityType.Troop,
];
export function abilityTypeFromFile(code: number): ResearchAbilityType {
    return ABILITY_FROM_FILE[code] ?? ResearchAbilityType.Undefined;
}

export interface TechNode {
    def: ResearchNodeDefinition;
    isResearched: boolean;
    isEnabled: boolean;
    progress: number;
    selfResearched: boolean;
}

// Shared static data (C# Galaxy.ResearchNodeDefinitionsStatic / ComponentDefinitionsStatic).
export interface ResearchStatic {
    definitions: ResearchNodeDefinition[];
    componentsById: Map<number, Component>;
    /** Port of SetResearchRaceSpecialProjects: allowed race names per node (empty = any). */
    allowedRaces: Map<number, Set<string>>;
    /** Port of SetResearchRaceSpecialProjects: DisallowedRaces per node. */
    disallowedRaces: Map<number, Set<string>>;
    policies: Map<string, EmpirePolicy>;
    piratePolicies: Map<string, EmpirePolicy>;
    /** Galaxy.ComponentDefinitionsStatic / ordered-component lists, from componentStatic.ts. */
    componentStatic: ComponentStatic | null;
}

// Port of Galaxy.3.cs SetResearchRaceSpecialProjects (1932): specified races,
// races whose SpecialComponent a node grants or improves, and the race
// DisallowedResearchArea1..3 / DisallowedComponentIds (read from Race.extra).
export function buildResearchStatic(
    definitions: ResearchNodeDefinition[],
    components: Component[],
    races: Race[],
    policies: Map<string, EmpirePolicy> = new Map(),
    piratePolicies: Map<string, EmpirePolicy> = new Map(),
    componentStatic: ComponentStatic | null = null,
): ResearchStatic {
    const allowed = new Map<number, Set<string>>();
    const disallowed = new Map<number, Set<string>>();
    const add = (m: Map<number, Set<string>>, id: number, name: string) => {
        let s = m.get(id);
        if (!s) m.set(id, (s = new Set()));
        s.add(name);
    };
    const disallow = (id: number, name: string) => {
        add(disallowed, id, name);
        allowed.get(id)?.delete(name);
    };
    const raceNames = new Set(races.map((r) => r.name));
    for (const d of definitions) for (const n of d.allowedRaces) if (raceNames.has(n)) add(allowed, d.projectId, n);
    for (const r of races) {
        if (r.specialComponent >= 0) {
            for (const d of definitions) {
                if (d.components.includes(r.specialComponent) || d.componentImprovements.some((ci) => ci.componentId === r.specialComponent)) add(allowed, d.projectId, r.name);
            }
        }
        // TODO(port): RaceVictoryCondition BuildWonder (RaceAchievement) allowed races.
        const extra = r.extra ?? {};
        const areas = ['DisallowedResearchArea1', 'DisallowedResearchArea2', 'DisallowedResearchArea3']
            .filter((k) => extra[k] !== undefined)
            .map((k) => resolveTechDisallow(Number.parseInt(extra[k], 10) || 0));
        if (areas.length > 0) {
            for (const d of definitions) if (areas.includes(componentCategoryByIndex(d.category))) disallow(d.projectId, r.name);
        }
        const comps = (extra['DisallowedComponentIds'] ?? '')
            .split(',')
            .map((x) => Number.parseInt(x.trim(), 10))
            .filter((n) => Number.isInteger(n) && n >= 0 && n < components.length);
        if (comps.length > 0) {
            for (const d of definitions) {
                if (d.components.some((c) => comps.includes(c)) || d.componentImprovements.some((ci) => comps.includes(ci.componentId))) disallow(d.projectId, r.name);
            }
        }
    }
    return {
        definitions,
        componentsById: new Map(components.map((c) => [c.componentId, c])),
        allowedRaces: allowed,
        disallowedRaces: disallowed,
        policies,
        piratePolicies,
        componentStatic,
    };
}

// Port of Galaxy.4.cs LoadEmpirePolicy(race, isPirate): file policy or a default one (never null).
export function loadEmpirePolicy(stat: ResearchStatic | null, race: Race, isPirate: boolean): EmpirePolicy {
    return (isPirate ? stat?.piratePolicies : stat?.policies)?.get(race.name) ?? defaultEmpirePolicy();
}

/** ResearchAbility (type, level, value; RelatedObject kept as the research.txt index). */
export interface ResearchAbilityRuntime {
    type: ResearchAbilityType;
    level: number;
    value: number;
    relatedObjectIndex: number;
}

export class ResearchSystem {
    techTree: TechNode[] = [];
    abilities: ResearchAbilityRuntime[] = [];
    researchedComponents: ComponentDefinition[] = [];
    // Port of ResearchSystem.cs _ResearchedComponentState.
    private researchedComponentIds = new Set<number>();
    // Port of ResearchSystem.cs ComponentImprovements (indexed by ComponentID; here a Map).
    componentImprovements = new Map<number, ComponentImprovementEntry>();
    // Port of _LatestComponentsByType / _LatestComponentsByCategory / _BestComponentsByType / _BestComponentsByCategory.
    private latestComponentsByType: (ComponentDefinition | null)[] = [];
    private latestComponentsByCategory: (ComponentDefinition | null)[] = [];
    private bestComponentsByType: (ComponentDefinition | null)[] = [];
    private bestComponentsByCategory: (ComponentDefinition | null)[] = [];
    // Port of the ComponentsXxxOrderedByYyy ComponentImprovementList fields (ReviewOrderedComponents, 173).
    componentsWeaponBeamOrderedByRange: ComponentImprovementEntry[] = [];
    componentsWeaponTorpedoOrderedByRange: ComponentImprovementEntry[] = [];
    componentsWeaponAreaOrderedByRange: ComponentImprovementEntry[] = [];
    componentsWeaponBeamOrderedByPower: ComponentImprovementEntry[] = [];
    componentsWeaponTorpedoOrderedByPower: ComponentImprovementEntry[] = [];
    componentsWeaponAreaOrderedByPower: ComponentImprovementEntry[] = [];
    componentsReactorOrderedByEfficiency: ComponentImprovementEntry[] = [];
    componentsReactorOrderedByPower: ComponentImprovementEntry[] = [];
    componentsEngineMainThrustOrderedByPower: ComponentImprovementEntry[] = [];
    componentsEngineVectoringOrderedByPower: ComponentImprovementEntry[] = [];
    componentsEngineMainThrustOrderedByEfficiency: ComponentImprovementEntry[] = [];
    componentsEngineVectoringOrderedByEfficiency: ComponentImprovementEntry[] = [];
    componentsHyperdriveOrderedByPower: ComponentImprovementEntry[] = [];
    componentsHyperdriveOrderedByEfficiency: ComponentImprovementEntry[] = [];
    componentsHyperdriveOrderedByJumpInitiation: ComponentImprovementEntry[] = [];

    private readonly componentStatic: ComponentStatic | null;
    // Fallback ComponentDefinition cache, used only when no ComponentStatic is
    // available (keeps identity stable across calls so Set/array membership works).
    private fallbackDefs = new Map<number, ComponentDefinition>();

    constructor(private stat: ResearchStatic | null) {
        this.componentStatic = stat?.componentStatic ?? null;
    }

    // Resolves a research-node Components/ComponentImprovements componentId to a
    // ComponentDefinition, from ComponentStatic when available, else a definition
    // synthesized on the fly (ComponentDefinition.cs ResolveComponentCategory/ResolveIndustry).
    private definitionFor(id: number): ComponentDefinition | undefined {
        if (this.componentStatic) return this.componentStatic.byId.get(id);
        let d = this.fallbackDefs.get(id);
        if (!d) {
            const c = this.stat?.componentsById.get(id);
            if (!c) return undefined;
            const category = resolveComponentCategory(c.type);
            d = { ...c, category, industry: resolveIndustry(category), techLevel: 0 };
            this.fallbackDefs.set(id, d);
        }
        return d;
    }

    // Port of ObtainTechTree(race).
    obtainTechTree(): void {
        this.techTree = (this.stat?.definitions ?? []).map((def) => ({ def, isResearched: false, isEnabled: true, progress: 0, selfResearched: false }));
    }

    private restrictedFor(node: TechNode, race: Race, isPirate: boolean): boolean {
        const a = this.stat?.allowedRaces.get(node.def.projectId);
        return a !== undefined && (isPirate || !a.has(race.name));
    }

    // Port of SetTechTreeLevel(galaxy, techTree, race, techLevel, isPirate).
    // Draws Galaxy.Rnd only for fractional levels (the short-circuit order
    // below matches the C# condition).
    setTechTreeLevel(rnd: Random, race: Race | null, techLevel: number, isPirate: boolean): void {
        if (techLevel === 0.5) {
            if (race === null) throw new Error('SetTechTreeLevel(0.5) needs a race (C# LoadEmpirePolicy(race))');
            const policy = loadEmpirePolicy(this.stat, race, isPirate);
            if (!isPirate) this.setTechTreeStartingDefaults(race, policy);
            else this.setTechTreeStartingDefaultsPirates(race, policy);
            return;
        }
        const lvl = Math.trunc(techLevel);
        for (const n of this.techTree) {
            const cat = n.def.category;
            if (n.def.techLevel <= lvl) n.isResearched = true;
            else if (isSuperWeaponCategory(cat) && n.isResearched) n.isResearched = true;
            else {
                n.isResearched = false;
                n.progress = 0;
            }
            if (techLevel > lvl && n.def.techLevel > lvl && n.def.techLevel - 1 < techLevel && techLevel - lvl > rnd.nextDouble()) n.isResearched = true;
            if (race !== null && this.restrictedFor(n, race, isPirate)) {
                n.isResearched = false;
                n.progress = 0;
            }
        }
        if (techLevel === 0.0) {
            for (const n of this.techTree) {
                if (n.def.specialFunctionCode === 1) n.isResearched = true;
                if (n.def.specialFunctionCode === 2) {
                    n.isResearched = false;
                    n.isEnabled = false;
                    n.progress = 0;
                }
            }
        }
        for (const n of this.techTree) n.selfResearched = n.isResearched;
    }

    // ---- ResearchNode / ResearchNodeList helpers (ResearchNode.cs, ResearchNodeList.cs) ----

    private componentTypeOf(id: number): ComponentType | undefined {
        return this.stat?.componentsById.get(id)?.type;
    }

    // ResearchNode.ResolveComponentTypesAll (93).
    private componentTypesAll(n: TechNode): ComponentType[] {
        const out: ComponentType[] = [];
        for (const id of n.def.components) {
            const t = this.componentTypeOf(id);
            if (t !== undefined && !out.includes(t)) out.push(t);
        }
        for (const ci of n.def.componentImprovements) {
            const t = this.componentTypeOf(ci.componentId);
            if (t !== undefined && !out.includes(t)) out.push(t);
        }
        return out;
    }

    // ResearchNode.CheckAnyComponentTypeMatches (73).
    private anyComponentTypeMatches(n: TechNode, type: ComponentType): boolean {
        return this.componentTypesAll(n).includes(type);
    }

    // AllowedRaces == null || Count == 0 || Contains(race).
    private allowedFor(n: TechNode, race: Race | null): boolean {
        const a = this.stat?.allowedRaces.get(n.def.projectId);
        return a === undefined || a.size === 0 || (race !== null && a.has(race.name));
    }

    private category(n: TechNode): ComponentCategoryType {
        return componentCategoryByIndex(n.def.category);
    }

    // ResearchNodeList.FindAndResearchLowestProject(type|category, race, minimumTechLevel = -1) (294 / 323).
    findAndResearchLowestProject(match: { type: ComponentType } | { category: ComponentCategoryType }, race: Race | null, minimumTechLevel = -1): void {
        let num = Number.MAX_VALUE;
        let node: TechNode | null = null;
        const list: TechNode[] = [];
        for (const n of this.techTree) {
            const ok = 'type' in match ? this.componentTypesAll(n).includes(match.type) : this.category(n) === match.category;
            if (ok && this.allowedFor(n, race)) {
                if (n.def.techLevel < num) {
                    node = n;
                    num = n.def.techLevel;
                }
                if (n.def.techLevel <= minimumTechLevel) list.push(n);
            }
        }
        for (const n of list) {
            n.isResearched = true;
            n.isEnabled = true;
        }
        if (node === null) return;
        node.isResearched = true;
        node.isEnabled = true;
    }

    // ResearchNodeList.GetLowestProjectForTypeAny (783).
    getLowestProjectForTypeAny(type: ComponentType): TechNode | null {
        let num = Number.MAX_VALUE;
        let r: TechNode | null = null;
        for (const n of this.techTree) {
            if (this.anyComponentTypeMatches(n, type) && n.def.techLevel < num) {
                r = n;
                num = n.def.techLevel;
            }
        }
        return r;
    }

    // Lowest node with an ability of (file) type whose related-object index matches:
    // GetLowestProjectForTroopType (940) / GetLowestProjectForResupplyShips (1006).
    private lowestProjectForAbility(type: ResearchAbilityType, relatedObjectIndex: number): TechNode | null {
        let num = Number.MAX_VALUE;
        let r: TechNode | null = null;
        for (const n of this.techTree) {
            for (const a of n.def.abilities) {
                if (abilityTypeFromFile(a.type) === type && a.relatedObjectIndex === relatedObjectIndex && n.def.techLevel < num) {
                    r = n;
                    num = n.def.techLevel;
                }
            }
        }
        return r;
    }
    /** research.txt Troop related object 1 = TroopType.Infantry (ResearchNodeDefinitionList.cs 581). */
    getLowestProjectForInfantry(): TechNode | null {
        return this.lowestProjectForAbility(ResearchAbilityType.Troop, 1);
    }
    /** research.txt EnableShipSubRole related object 1 = BuiltObjectSubRole.ResupplyShip (ResearchNodeDefinitionList.cs 575). */
    getLowestProjectForResupplyShips(): TechNode | null {
        return this.lowestProjectForAbility(ResearchAbilityType.EnableShipSubRole, 1);
    }

    // Shared opening of SetTechTreeStartingDefaults / ...Pirates.
    private resetForStartingDefaults(): void {
        for (const n of this.techTree) {
            n.isResearched = false;
            n.progress = 0;
        }
        for (const n of this.techTree) {
            switch (n.def.specialFunctionCode) {
                case 1:
                case 2:
                    n.isResearched = true;
                    n.isEnabled = true;
                    break;
                case 5:
                    n.isEnabled = false;
                    break;
            }
        }
    }

    // Shared policy tech-focus block (identical up to the Sensor line in both methods).
    private researchPolicyFocuses(race: Race | null, cats: ComponentCategoryType[], types: ComponentType[]): void {
        const C = ComponentCategoryType;
        const T = ComponentType;
        const f = (type: ComponentType, min = -1) => this.findAndResearchLowestProject({ type }, race, min);
        if (cats.includes(C.WeaponBeam)) f(T.WeaponBeam, 1);
        if (cats.includes(C.WeaponArea)) f(T.WeaponAreaDestruction, 1);
        if (types.includes(T.WeaponGravityBeam)) f(T.WeaponGravityBeam, 1);
        if (types.includes(T.WeaponTractorBeam)) {
            f(T.WeaponGravityBeam, 1);
            f(T.WeaponTractorBeam);
        }
        if (cats.includes(C.WeaponIon)) {
            f(T.WeaponBeam, 1);
            f(T.WeaponIonCannon);
        }
        if (cats.includes(C.WeaponTorpedo)) f(T.WeaponTorpedo, 1);
        if (types.includes(T.WeaponMissile)) f(T.WeaponMissile, 1);
        if (types.includes(T.WeaponRailGun)) f(T.WeaponRailGun, 1);
        if (types.includes(T.ComputerCountermeasures)) f(T.ComputerCountermeasures);
        if (types.includes(T.ComputerTargetting)) f(T.ComputerTargetting);
        if (types.includes(T.DamageControl)) f(T.DamageControl);
        if (types.includes(T.AssaultPod)) f(T.AssaultPod);
        if (cats.includes(C.Fighter)) f(T.FighterBay);
        if (cats.includes(C.Sensor)) f(T.SensorProximityArray);
    }

    // Shared tail: DisallowedRaces reset, then SelfResearched = IsResearched.
    private finishStartingDefaults(race: Race | null): void {
        if (race !== null) {
            for (const n of this.techTree) {
                const d = this.stat?.disallowedRaces.get(n.def.projectId);
                if (d !== undefined && d.size > 0 && d.has(race.name)) n.isResearched = false;
            }
        }
        for (const n of this.techTree) n.selfResearched = n.isResearched;
    }

    // Port of ResearchNodeDefinitionList.SetTechTreeStartingDefaults (1023). No Rnd.
    setTechTreeStartingDefaults(race: Race | null, policy: EmpirePolicy | null): void {
        const C = ComponentCategoryType;
        const T = ComponentType;
        const f = (type: ComponentType, min = -1) => this.findAndResearchLowestProject({ type }, race, min);
        const fc = (category: ComponentCategoryType, min: number) => this.findAndResearchLowestProject({ category }, race, min);
        this.resetForStartingDefaults();
        if (policy !== null) {
            const { categories, types } = resolveTechFocuses(policy);
            this.researchPolicyFocuses(race, categories, types);
            const beam = this.getLowestProjectForTypeAny(T.WeaponBeam);
            if (beam !== null && !beam.isResearched && !types.includes(T.WeaponGravityBeam) && !types.includes(T.WeaponRailGun)) f(T.WeaponBeam, 1);
        } else f(T.WeaponBeam, 1);
        f(T.Armor);
        f(T.Reactor, 1);
        f(T.Shields);
        fc(C.Construction, 1);
        f(T.ExtractorMine);
        f(T.EnergyCollector);
        f(T.EngineMainThrust, 1);
        f(T.EngineVectoring, 1);
        f(T.HyperDrive, 1);
        f(T.SensorResourceProfileSensor, 1);
        f(T.HabitationColonization);
        fc(C.Storage, 1);
        f(T.StorageDockingBay);
        f(T.HabitationLifeSupport, 1);
        f(T.HabitationHabModule, 1);
        f(T.HabitationMedicalCenter);
        f(T.HabitationRecreationCenter);
        f(T.LabsWeaponsLab);
        f(T.LabsEnergyLab);
        f(T.LabsHighTechLab);
        f(T.ComputerCommandCenter);
        f(T.ComputerCommerceCenter);
        const infantry = this.getLowestProjectForInfantry();
        if (infantry !== null) infantry.isResearched = true;
        if (race !== null && race.specialComponent >= 0) {
            // C#: lowest-tech node with components whose AllowedRaces contains the race.
            let r: TechNode | null = null;
            for (const n of this.techTree) {
                const a = this.stat?.allowedRaces.get(n.def.projectId);
                if (n.def.components.length > 0 && a !== undefined && a.has(race.name) && (r === null || n.def.techLevel < r.def.techLevel)) r = n;
            }
            if (r !== null) r.isResearched = true;
        }
        this.finishStartingDefaults(race);
    }

    // Port of ResearchNodeDefinitionList.SetTechTreeStartingDefaultsPirates (901). No Rnd.
    setTechTreeStartingDefaultsPirates(race: Race | null, policy: EmpirePolicy | null): void {
        const C = ComponentCategoryType;
        const T = ComponentType;
        const f = (type: ComponentType, min = -1) => this.findAndResearchLowestProject({ type }, race, min);
        const fc = (category: ComponentCategoryType, min: number) => this.findAndResearchLowestProject({ category }, race, min);
        this.resetForStartingDefaults();
        if (policy !== null) {
            const { categories, types } = resolveTechFocuses(policy);
            this.researchPolicyFocuses(race, categories, types);
            const beam = this.getLowestProjectForTypeAny(T.WeaponBeam);
            if (beam !== null && !beam.isResearched && !types.includes(T.WeaponGravityBeam) && !types.includes(T.WeaponRailGun)) f(T.WeaponBeam, 1);
            const torpedo = this.getLowestProjectForTypeAny(T.WeaponTorpedo);
            const missile = this.getLowestProjectForTypeAny(T.WeaponMissile);
            // C# checks the beam node's IsResearched here (not the torpedo's); kept verbatim.
            if (torpedo !== null && !beam!.isResearched && missile !== null && !missile.isResearched) {
                if (types.includes(T.WeaponMissile)) f(T.WeaponMissile, 1);
                else f(T.WeaponTorpedo, 1);
            }
        }
        f(T.Armor);
        f(T.Reactor, 1);
        f(T.Shields);
        fc(C.Construction, 2);
        f(T.ExtractorMine);
        f(T.EnergyCollector);
        f(T.EngineMainThrust, 1);
        f(T.EngineVectoring, 1);
        f(T.HyperDrive, 1);
        f(T.SensorResourceProfileSensor, 1);
        fc(C.Storage, 1);
        f(T.StorageDockingBay);
        f(T.HabitationLifeSupport, 1);
        f(T.HabitationHabModule, 1);
        f(T.HabitationMedicalCenter);
        f(T.HabitationRecreationCenter);
        f(T.LabsWeaponsLab);
        f(T.LabsEnergyLab);
        f(T.LabsHighTechLab);
        f(T.ComputerCommandCenter);
        f(T.ComputerCommerceCenter);
        const infantry = this.getLowestProjectForInfantry();
        if (infantry !== null) infantry.isResearched = true;
        f(T.AssaultPod);
        f(T.WeaponTractorBeam);
        const resupply = this.getLowestProjectForResupplyShips();
        if (resupply !== null) {
            resupply.isResearched = true;
            resupply.isEnabled = true;
        }
        fc(C.Construction, 2);
        this.finishStartingDefaults(race);
    }

    // Port of ResearchSystem.Update (researched components + abilities; component
    // improvements, latest/best-by-type/category and ordered-component review; TODO(port):
    // facilities, fighters, plagues, RefreshLatestNextProjects).
    update(): void {
        const abilities: ResearchAbilityRuntime[] = [];
        for (const n of this.techTree) {
            if (!n.isResearched) continue;
            for (const a of n.def.abilities) abilities.push({ type: abilityTypeFromFile(a.type), level: a.level, value: a.value, relatedObjectIndex: a.relatedObjectIndex });
        }
        this.abilities = abilities;

        this.determineResearchedComponents();
        this.determineComponentImprovements();
        this.latestComponentsByType = this.determineLatestComponentsByType(this.researchedComponents);
        this.latestComponentsByCategory = this.determineLatestComponentsByCategory(this.researchedComponents);
        this.bestComponentsByType = this.determineBestComponentsByType(this.researchedComponents);
        this.bestComponentsByCategory = this.determineBestComponentsByCategory(this.researchedComponents);
        // TODO(port): DetermineBuildablePlanetaryFacilities, DetermineResearchedFighters,
        // ReviewPlagues, RefreshLatestNextProjects.
        this.reviewOrderedComponents();
    }

    // Port of ResearchSystem.cs DetermineResearchedComponents (1149).
    private determineResearchedComponents(): void {
        const comps: ComponentDefinition[] = [];
        const state = new Set<number>();
        for (const n of this.techTree) {
            if (!n.isResearched || n.def.components.length === 0) continue;
            for (const id of n.def.components) {
                if (state.has(id)) continue;
                const def = this.definitionFor(id);
                if (!def) continue;
                comps.push(def);
                state.add(id);
            }
        }
        this.researchedComponents = comps;
        this.researchedComponentIds = state;
    }

    // Port of ResearchSystem.cs CheckComponentResearched (86).
    checkComponentResearched(component: Component | ComponentDefinition | null | undefined): boolean {
        if (!component) return false;
        return this.researchedComponentIds.has(component.componentId);
    }

    // Port of ResearchSystem.cs DetermineComponentImprovements (1170). Requires
    // ComponentStatic (per-project improvements); without it, no improvements are known
    // and ResolveImprovedComponentValues falls back to the component's own values.
    private determineComponentImprovements(): void {
        const map = new Map<number, ComponentImprovementEntry>();
        if (this.componentStatic) {
            const byProjectId = new Map(this.componentStatic.researchProjects.map((p) => [p.projectId, p]));
            for (const n of this.techTree) {
                if (!n.isResearched) continue;
                const project = byProjectId.get(n.def.projectId);
                if (!project || project.improvements.length === 0) continue;
                for (const ci of project.improvements) {
                    const id = ci.improvedComponent.componentId;
                    const existing = map.get(id);
                    if (!existing || ci.techLevel > existing.techLevel) map.set(id, ci);
                }
            }
        }
        this.componentImprovements = map;
    }

    // Port of ResearchSystem.cs ResolveImprovedComponentValues (1645).
    resolveImprovedComponentValues(component: ComponentDefinition): ComponentImprovementEntry {
        return this.componentImprovements.get(component.componentId) ?? componentImprovementFromComponent(component);
    }

    private static valueOf(ci: ComponentImprovementEntry, n: 1 | 2 | 3 | 4 | 5 | 6 | 7): number {
        switch (n) {
            case 1: return ci.value1;
            case 2: return ci.value2;
            case 3: return ci.value3;
            case 4: return ci.value4;
            case 5: return ci.value5;
            case 6: return ci.value6;
            case 7: return ci.value7;
        }
    }

    // Port of ResearchSystem.cs IdentifyComponentHighestValue1..7 (2451-2585): shared
    // by index n, tie-broken by smaller Size.
    private identifyHighestValue(components: ComponentDefinition[], n: 1 | 2 | 3 | 4 | 5 | 6 | 7): ComponentDefinition | null {
        let best: ComponentImprovementEntry | null = null;
        for (const c of components) {
            const ci = this.resolveImprovedComponentValues(c);
            if (!best) {
                best = ci;
                continue;
            }
            const v = ResearchSystem.valueOf(ci, n);
            const bv = ResearchSystem.valueOf(best, n);
            if (v > bv || (v === bv && ci.improvedComponent.size < best.improvedComponent.size)) best = ci;
        }
        return best?.improvedComponent ?? null;
    }

    // Port of ResearchSystem.cs IdentifyComponentLowestValue2WithMinimumThreshold (2521).
    private identifyLowestValue2WithMinimumThreshold(components: ComponentDefinition[], minimumThreshold: number): ComponentDefinition | null {
        let best: ComponentImprovementEntry | null = null;
        for (const c of components) {
            const ci = this.resolveImprovedComponentValues(c);
            if (!best && ci.value2 >= minimumThreshold) best = ci;
            else if (
                best &&
                ((ci.value2 < best.value2 && ci.value2 >= minimumThreshold) ||
                    (ci.value2 === best.value2 && ci.value2 >= minimumThreshold && ci.improvedComponent.size < best.improvedComponent.size))
            )
                best = ci;
        }
        return best?.improvedComponent ?? null;
    }

    // Port of ComponentList.GetByType (156).
    private getByType(components: ComponentDefinition[], type: ComponentType): ComponentDefinition[] {
        return components.filter((c) => c.type === type);
    }

    // Port of ResearchSystem.cs DetermineBestComponent (2304).
    determineBestComponent(type: ComponentType, researchedComponents: ComponentDefinition[]): ComponentDefinition | null {
        const T = ComponentType;
        const byType = this.getByType(researchedComponents, type);
        switch (type) {
            case T.WeaponBombard:
                return this.identifyHighestValue(byType, 7);
            case T.HyperDeny:
            case T.HyperStop:
            case T.Armor:
            case T.SensorProximityArray:
            case T.SensorTraceScanner:
                return this.identifyHighestValue(byType, 2);
            case T.DamageControl:
                return this.identifyLowestValue2WithMinimumThreshold(byType, 1) ?? this.identifyHighestValue(byType, 1);
            case T.Undefined:
                return null;
            default:
                return this.identifyHighestValue(byType, 1);
        }
    }

    // Port of ResearchSystem.cs DetermineBestComponentBySelectedCategories (2438).
    determineBestComponentBySelectedCategories(category: ComponentCategoryType, researchedComponents: ComponentDefinition[]): ComponentDefinition | null {
        const C = ComponentCategoryType;
        const T = ComponentType;
        let type: ComponentType = T.Undefined;
        switch (category) {
            case C.WeaponBeam: type = T.WeaponBeam; break;
            case C.WeaponTorpedo: type = T.WeaponTorpedo; break;
            case C.WeaponPointDefense: type = T.WeaponPointDefense; break;
            case C.AssaultPod: type = T.AssaultPod; break;
            case C.Shields: type = T.Shields; break;
            case C.ShieldRecharge: type = T.ShieldRecharge; break;
            case C.HyperDrive: type = T.HyperDrive; break;
            case C.Reactor: type = T.Reactor; break;
            case C.WeaponSuperBeam: type = T.WeaponSuperBeam; break;
            case C.WeaponSuperTorpedo: type = T.WeaponSuperTorpedo; break;
        }
        return this.determineBestComponent(type, researchedComponents);
    }

    // Port of ResearchSystem.cs DetermineBestComponentsByType (1404).
    private determineBestComponentsByType(researchedComponents: ComponentDefinition[]): (ComponentDefinition | null)[] {
        const values = numericEnumValues(ComponentType);
        const max = Math.max(0, ...values);
        const out: (ComponentDefinition | null)[] = new Array(max + 1).fill(null);
        for (const t of values) out[t] = this.determineBestComponent(t, researchedComponents);
        return out;
    }

    // Port of ResearchSystem.cs DetermineBestComponentsByCategory (1413).
    private determineBestComponentsByCategory(researchedComponents: ComponentDefinition[]): (ComponentDefinition | null)[] {
        const values = numericEnumValues(ComponentCategoryType);
        const max = Math.max(0, ...values);
        const out: (ComponentDefinition | null)[] = new Array(max + 1).fill(null);
        for (const c of values) out[c] = this.determineBestComponentBySelectedCategories(c, researchedComponents);
        return out;
    }

    // Port of ResearchSystem.cs DetermineLatestComponentsByType (1422).
    private determineLatestComponentsByType(researchedComponents: ComponentDefinition[]): (ComponentDefinition | null)[] {
        const values = numericEnumValues(ComponentType);
        const max = Math.max(0, ...values);
        const out: (ComponentDefinition | null)[] = new Array(max + 1).fill(null);
        for (const rc of researchedComponents) {
            const t = rc.type;
            const cur = out[t];
            if (!cur) {
                out[t] = rc;
                continue;
            }
            const ci1 = this.resolveImprovedComponentValues(cur);
            const ci2 = this.resolveImprovedComponentValues(rc);
            if (ci2.techLevel > ci1.techLevel) out[t] = rc;
            else if (ci2.techLevel === ci1.techLevel) out[t] = this.determineBestComponent(t, [ci2.improvedComponent, ci1.improvedComponent]);
        }
        return out;
    }

    // Port of ResearchSystem.cs DetermineLatestComponentsByCategory (1455).
    private determineLatestComponentsByCategory(researchedComponents: ComponentDefinition[]): (ComponentDefinition | null)[] {
        const values = numericEnumValues(ComponentCategoryType);
        const max = Math.max(0, ...values);
        const out: (ComponentDefinition | null)[] = new Array(max + 1).fill(null);
        for (const rc of researchedComponents) {
            const cat = rc.category;
            const cur = out[cat];
            if (!cur) {
                if (rc.type !== ComponentType.WeaponBombard) out[cat] = rc;
                continue;
            }
            const flag1 = checkComponentDefinitionMatchesCategoryStrict(cur, cur.category);
            const flag2 = checkComponentDefinitionMatchesCategoryStrict(rc, rc.category);
            const ci1 = this.resolveImprovedComponentValues(rc);
            const ci2 = this.resolveImprovedComponentValues(cur);
            let num = ci1.techLevel;
            let techLevel = ci2.techLevel;
            if (rc.category === ComponentCategoryType.Shields && num === techLevel) {
                num = ci1.value1;
                techLevel = ci2.value1;
            }
            if (rc.type === ComponentType.WeaponBombard) num = 0;
            if (num > techLevel || (!flag1 && flag2)) {
                if (!flag1 || flag2) out[cat] = rc;
            } else if (num === techLevel) {
                out[cat] = this.determineBestComponentBySelectedCategories(cat, [ci1.improvedComponent, ci2.improvedComponent]);
            }
        }
        return out;
    }

    // Port of ResearchSystem.cs GetLatestComponent(ComponentType)/(ComponentCategoryType) (1729/1735).
    getLatestComponent(match: ComponentType | ComponentCategoryType, byCategory = false): ComponentDefinition | null {
        const arr = byCategory ? this.latestComponentsByCategory : this.latestComponentsByType;
        return arr[match as number] ?? null;
    }

    // Port of ResearchSystem.cs ReviewOrderedComponents (173) / FilterUnresearchedComponents (192).
    private filterUnresearchedComponents(components: ComponentDefinition[]): ComponentImprovementEntry[] {
        return components.filter((c) => this.researchedComponentIds.has(c.componentId)).map((c) => this.resolveImprovedComponentValues(c));
    }

    private reviewOrderedComponents(): void {
        const cs = this.componentStatic;
        if (!cs) {
            this.componentsWeaponBeamOrderedByRange = [];
            this.componentsWeaponTorpedoOrderedByRange = [];
            this.componentsWeaponAreaOrderedByRange = [];
            this.componentsWeaponBeamOrderedByPower = [];
            this.componentsWeaponTorpedoOrderedByPower = [];
            this.componentsWeaponAreaOrderedByPower = [];
            this.componentsReactorOrderedByEfficiency = [];
            this.componentsReactorOrderedByPower = [];
            this.componentsEngineMainThrustOrderedByPower = [];
            this.componentsEngineVectoringOrderedByPower = [];
            this.componentsEngineMainThrustOrderedByEfficiency = [];
            this.componentsEngineVectoringOrderedByEfficiency = [];
            this.componentsHyperdriveOrderedByPower = [];
            this.componentsHyperdriveOrderedByEfficiency = [];
            this.componentsHyperdriveOrderedByJumpInitiation = [];
            return;
        }
        this.componentsWeaponBeamOrderedByRange = this.filterUnresearchedComponents(cs.componentsWeaponBeamOrderedByRange);
        this.componentsWeaponTorpedoOrderedByRange = this.filterUnresearchedComponents(cs.componentsWeaponTorpedoOrderedByRange);
        this.componentsWeaponAreaOrderedByRange = this.filterUnresearchedComponents(cs.componentsWeaponAreaOrderedByRange);
        this.componentsWeaponBeamOrderedByPower = this.filterUnresearchedComponents(cs.componentsWeaponBeamOrderedByPower);
        this.componentsWeaponTorpedoOrderedByPower = this.filterUnresearchedComponents(cs.componentsWeaponTorpedoOrderedByPower);
        this.componentsWeaponAreaOrderedByPower = this.filterUnresearchedComponents(cs.componentsWeaponAreaOrderedByPower);
        this.componentsReactorOrderedByEfficiency = this.filterUnresearchedComponents(cs.componentsReactorOrderedByEfficiency);
        this.componentsReactorOrderedByPower = this.filterUnresearchedComponents(cs.componentsReactorOrderedByPower);
        this.componentsEngineMainThrustOrderedByPower = this.filterUnresearchedComponents(cs.componentsEngineMainThrustOrderedByPower);
        this.componentsEngineVectoringOrderedByPower = this.filterUnresearchedComponents(cs.componentsEngineVectoringOrderedByPower);
        this.componentsEngineMainThrustOrderedByEfficiency = this.filterUnresearchedComponents(cs.componentsEngineMainThrustOrderedByEfficiency);
        this.componentsEngineVectoringOrderedByEfficiency = this.filterUnresearchedComponents(cs.componentsEngineVectoringOrderedByEfficiency);
        this.componentsHyperdriveOrderedByPower = this.filterUnresearchedComponents(cs.componentsHyperdriveOrderedByPower);
        this.componentsHyperdriveOrderedByEfficiency = this.filterUnresearchedComponents(cs.componentsHyperdriveOrderedByEfficiency);
        this.componentsHyperdriveOrderedByJumpInitiation = this.filterUnresearchedComponents(cs.componentsHyperdriveOrderedByJumpInitiation);
    }

    // Port of ResearchSystem.cs IdentifyBestComponent (2675).
    private identifyBestComponent(ordered: ComponentImprovementEntry[]): ComponentDefinition | null {
        return ordered.length > 0 ? ordered[0].improvedComponent : null;
    }

    // Port of ResearchSystem.cs IdentifyBestComponentPreferSmallSize (2677).
    private identifyBestComponentPreferSmallSize(ordered: ComponentImprovementEntry[]): ComponentDefinition | null {
        if (ordered.length === 0) return null;
        return ordered.length > 1 && ordered[1].improvedComponent.size < ordered[0].improvedComponent.size
            ? ordered[1].improvedComponent
            : ordered[0].improvedComponent;
    }

    // Port of ResearchSystem.cs IdentifyBestComponentPreferLowEnergyUse (2686).
    private identifyBestComponentPreferLowEnergyUse(ordered: ComponentImprovementEntry[]): ComponentDefinition | null {
        if (ordered.length === 0) return null;
        return ordered.length > 1 && ordered[1].improvedComponent.energyUsed < ordered[0].improvedComponent.energyUsed
            ? ordered[1].improvedComponent
            : ordered[0].improvedComponent;
    }

    // Port of ResearchSystem.cs EvaluateDesiredComponent(ComponentType, ShipDesignFocus, bool) (2600).
    evaluateDesiredComponent(componentType: ComponentType, designFocus: ShipDesignFocus, preferLatest = false): ComponentDefinition | null {
        const T = ComponentType;
        const F = ShipDesignFocus;
        const fallback = () => (preferLatest ? this.latestComponentsByType[componentType] : this.bestComponentsByType[componentType]) ?? null;
        switch (designFocus) {
            case F.Balanced:
                return fallback();
            case F.SpeedAgility:
                switch (componentType) {
                    case T.WeaponBeam: return this.identifyBestComponent(this.componentsWeaponBeamOrderedByRange);
                    case T.WeaponTorpedo: return this.identifyBestComponent(this.componentsWeaponTorpedoOrderedByRange);
                    case T.WeaponAreaDestruction: return this.identifyBestComponentPreferSmallSize(this.componentsWeaponAreaOrderedByRange);
                    case T.EngineMainThrust: return this.identifyBestComponentPreferSmallSize(this.componentsEngineMainThrustOrderedByPower);
                    case T.EngineVectoring: return this.identifyBestComponent(this.componentsEngineVectoringOrderedByPower);
                    case T.HyperDrive: return this.identifyBestComponent(this.componentsHyperdriveOrderedByJumpInitiation);
                    case T.Reactor: return this.identifyBestComponent(this.componentsReactorOrderedByPower);
                    default: return fallback();
                }
            case F.Power:
                switch (componentType) {
                    case T.WeaponBeam: return this.identifyBestComponent(this.componentsWeaponBeamOrderedByPower);
                    case T.WeaponTorpedo: return this.identifyBestComponent(this.componentsWeaponTorpedoOrderedByPower);
                    case T.WeaponAreaDestruction: return this.identifyBestComponent(this.componentsWeaponAreaOrderedByPower);
                    case T.EngineMainThrust: return this.identifyBestComponent(this.componentsEngineMainThrustOrderedByPower);
                    case T.EngineVectoring: return this.identifyBestComponent(this.componentsEngineVectoringOrderedByPower);
                    case T.HyperDrive: return this.identifyBestComponent(this.componentsHyperdriveOrderedByPower);
                    case T.Reactor: return this.identifyBestComponent(this.componentsReactorOrderedByPower);
                    default: return fallback();
                }
            case F.Efficiency:
                switch (componentType) {
                    case T.WeaponBeam: return this.identifyBestComponentPreferLowEnergyUse(this.componentsWeaponBeamOrderedByPower);
                    case T.WeaponTorpedo: return this.identifyBestComponentPreferLowEnergyUse(this.componentsWeaponTorpedoOrderedByPower);
                    case T.WeaponAreaDestruction: return this.identifyBestComponentPreferLowEnergyUse(this.componentsWeaponAreaOrderedByPower);
                    case T.EngineMainThrust: return this.identifyBestComponentPreferLowEnergyUse(this.componentsEngineMainThrustOrderedByEfficiency);
                    case T.EngineVectoring: return this.identifyBestComponentPreferLowEnergyUse(this.componentsEngineVectoringOrderedByEfficiency);
                    case T.HyperDrive: return this.identifyBestComponentPreferLowEnergyUse(this.componentsHyperdriveOrderedByEfficiency);
                    case T.Reactor: return this.identifyBestComponent(this.componentsReactorOrderedByEfficiency);
                    default: return fallback();
                }
            default:
                return fallback();
        }
    }

    // Port of ResearchSystem.cs EvaluateDesiredComponentImprovement(ComponentType, ShipDesignFocus) (2293).
    evaluateDesiredComponentImprovement(componentType: ComponentType, designFocus: ShipDesignFocus): ComponentImprovementEntry | null {
        const desired = this.evaluateDesiredComponent(componentType, designFocus);
        return desired ? this.resolveImprovedComponentValues(desired) : null;
    }

    // Port of ResearchSystem.cs EvaluateDesiredComponent(ComponentCategoryType, ShipDesignFocus, bool) (2713).
    evaluateDesiredComponentByCategory(componentCategory: ComponentCategoryType, designFocus: ShipDesignFocus, preferLatest = false): ComponentDefinition | null {
        const C = ComponentCategoryType;
        const F = ShipDesignFocus;
        const fallback = () => (preferLatest ? this.latestComponentsByCategory[componentCategory] : this.bestComponentsByCategory[componentCategory]) ?? null;
        switch (designFocus) {
            case F.Balanced:
                return fallback();
            case F.SpeedAgility:
                switch (componentCategory) {
                    case C.WeaponBeam: return this.identifyBestComponent(this.componentsWeaponBeamOrderedByRange);
                    case C.WeaponTorpedo: return this.identifyBestComponent(this.componentsWeaponTorpedoOrderedByRange);
                    case C.WeaponArea: return this.identifyBestComponentPreferSmallSize(this.componentsWeaponAreaOrderedByRange);
                    case C.HyperDrive: return this.identifyBestComponent(this.componentsHyperdriveOrderedByJumpInitiation);
                    case C.Reactor: return this.identifyBestComponent(this.componentsReactorOrderedByPower);
                    default: return fallback();
                }
            case F.Power:
                switch (componentCategory) {
                    case C.WeaponBeam: return this.identifyBestComponent(this.componentsWeaponBeamOrderedByPower);
                    case C.WeaponTorpedo: return this.identifyBestComponent(this.componentsWeaponTorpedoOrderedByPower);
                    case C.WeaponArea: return this.identifyBestComponent(this.componentsWeaponAreaOrderedByPower);
                    case C.HyperDrive: return this.identifyBestComponent(this.componentsHyperdriveOrderedByPower);
                    case C.Reactor: return this.identifyBestComponent(this.componentsReactorOrderedByPower);
                    default: return fallback();
                }
            case F.Efficiency:
                switch (componentCategory) {
                    case C.WeaponBeam: return this.identifyBestComponentPreferLowEnergyUse(this.componentsWeaponBeamOrderedByPower);
                    case C.WeaponTorpedo: return this.identifyBestComponentPreferLowEnergyUse(this.componentsWeaponTorpedoOrderedByPower);
                    case C.WeaponArea: return this.identifyBestComponentPreferLowEnergyUse(this.componentsWeaponAreaOrderedByPower);
                    case C.HyperDrive: return this.identifyBestComponentPreferLowEnergyUse(this.componentsHyperdriveOrderedByEfficiency);
                    case C.Reactor: return this.identifyBestComponent(this.componentsReactorOrderedByEfficiency);
                    default: return fallback();
                }
            default:
                return fallback();
        }
    }

    // Port of ResearchSystem.cs EvaluateDesiredComponentImprovement(ComponentCategoryType, ShipDesignFocus) (2695):
    // falls back to the latest-by-category component when no desired one was found.
    evaluateDesiredComponentImprovementByCategory(componentCategory: ComponentCategoryType, designFocus: ShipDesignFocus): ComponentImprovementEntry | null {
        const component = this.evaluateDesiredComponentByCategory(componentCategory, designFocus) ?? this.latestComponentsByCategory[componentCategory] ?? null;
        return component ? this.resolveImprovedComponentValues(component) : null;
    }

    // Port of CheckEmpireHasHyperDriveTech: GetLatestComponent(HyperDrive) != null.
    hasHyperDrive(): boolean {
        return this.researchedComponents.some((c) => c.type === ComponentType.HyperDrive);
    }
}

// research.txt category index → ComponentCategoryType via Galaxy.4.cs
// DetermineComponentCategoryByIndex: 23 WeaponSuperArea, 24 WeaponSuperBeam,
// 26 WeaponSuperTorpedo.
function isSuperWeaponCategory(categoryIndex: number): boolean {
    return categoryIndex === 23 || categoryIndex === 24 || categoryIndex === 26;
}
