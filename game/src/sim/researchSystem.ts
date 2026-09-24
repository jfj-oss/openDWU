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
import { HabitatType, IndustryType } from './types';
import { TroopType } from './cargo';
import { BuiltObjectSubRole } from './builtObjectTypes';
import type { Facility } from './data/facilities';
import type { Fighter } from './data/fighters';
import type { Plague } from './data/plagues';
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

/** Runtime ResearchNode (ResearchNode.cs). Properties delegating to the definition read `def`. */
// Port of Galaxy.4.cs ResolveColonyHabitatTypeByIndexIncludingUndefined (717).
export function resolveColonyHabitatTypeByIndexIncludingUndefined(index: number): HabitatType {
    switch (index) {
        case 1: return HabitatType.Continental;
        case 2: return HabitatType.MarshySwamp;
        case 3: return HabitatType.Ocean;
        case 4: return HabitatType.Desert;
        case 5: return HabitatType.Ice;
        case 6: return HabitatType.Volcanic;
        default: return HabitatType.Undefined;
    }
}

export interface TechNode {
    def: ResearchNodeDefinition;
    isResearched: boolean;
    isEnabled: boolean;
    /** ResearchNode.Progress (float). */
    progress: number;
    selfResearched: boolean;
    /** ResearchNode.Cost (float): ResearchNodeDefinition.Cost, scaled by UpdateProjectCostsForRace (M4k). */
    cost: number;
    /** ResearchNode.IsRushing (M4k). */
    isRushing: boolean;
    /** ResearchNode.ParentNodes / ParentIsRequired (UpdateParentNodes; M4k). */
    parentNodes: TechNode[];
    parentIsRequired: boolean[];
    /** ResearchNode.SortTag (float; IComparable key). */
    sortTag: number;
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
    /** Galaxy.PlanetaryFacilityDefinitionsStatic (facilities.txt; M4k). */
    facilities: Facility[];
    /** Galaxy.FighterSpecificationsStatic (fighters.txt; M4k). */
    fighters: Fighter[];
    /**
     * Galaxy.PlaguesStatic (plagues.txt; M4k). C# ResearchSystem.ReviewPlagues mutates these shared static
     * objects (LatestTechLevelUpdate, rates); here they are per-galaxy copies.
     */
    plagues: PlagueStatic[];
}

/** Plague.cs fields ReviewPlagues touches, on a copy of the plagues.txt row. */
export interface PlagueStatic extends Plague {
    latestTechLevelUpdate: number;
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
    facilities: Facility[] = [],
    fighters: Fighter[] = [],
    plagues: Plague[] = [],
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
        facilities,
        fighters,
        plagues: plagues.map((p) => ({ ...p, latestTechLevelUpdate: 0 })),
    };
}

// Port of Galaxy.4.cs LoadEmpirePolicy(race, isPirate): file policy or a default one (never null).
// C# reads the file into a fresh EmpirePolicy on every call, so callers may mutate the result:
// return a copy of the prefetched policy (researchDesignTechFocus slots copied too).
export function loadEmpirePolicy(stat: ResearchStatic | null, race: Race, isPirate: boolean): EmpirePolicy {
    const p = (isPirate ? stat?.piratePolicies : stat?.policies)?.get(race.name);
    if (p === undefined) return defaultEmpirePolicy();
    return { ...p, researchDesignTechFocus: p.researchDesignTechFocus.map((f) => ({ ...f })) };
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
    // ---- M4k: research progress state (ResearchSystem.cs 21-52) ----
    /** ResearchSystem.cs 21 BuildablePlanetaryFacilities (DetermineBuildablePlanetaryFacilities). */
    buildablePlanetaryFacilities: Facility[] = [];
    /** ResearchSystem.cs 22 EnabledPlagues (ReviewPlagues). */
    enabledPlagues: PlagueStatic[] = [];
    /** ResearchSystem.cs 24 ResearchedFighters (DetermineResearchedFighters; FighterSpecification rows). */
    researchedFighters: Fighter[] = [];
    /** ResearchSystem.cs 27-28 LatestProjects / NextProjects (RefreshLatestNextProjects); null until first refresh. */
    latestProjects: TechNode[] | null = null;
    nextProjects: TechNode[] | null = null;
    /** ResearchSystem.cs 34 RecentProjects. */
    recentProjects: TechNode[] = [];
    /** ResearchSystem.cs 50-52 ResearchQueueWeapons / Energy / HighTech. */
    researchQueueWeapons: TechNode[] = [];
    researchQueueEnergy: TechNode[] = [];
    researchQueueHighTech: TechNode[] = [];
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
    definitionFor(id: number): ComponentDefinition | undefined {
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

    // Port of ResearchNodeDefinitionList.ObtainTechTree(race) (890): one ResearchNode per definition
    // (ResearchNode ctor: Cost = definition Cost, from Galaxy.3.cs SetResearchCosts), then
    // UpdateProjectCostsForRace (842) and UpdateParentNodes (868).
    obtainTechTree(race: Race | null = null): void {
        const costs = this.componentStatic?.researchCostByProjectId;
        this.techTree = (this.stat?.definitions ?? []).map((def) => ({
            def,
            isResearched: false,
            isEnabled: true,
            progress: 0,
            selfResearched: false,
            cost: Math.fround(costs?.get(def.projectId) ?? 0),
            isRushing: false,
            parentNodes: [],
            parentIsRequired: [],
            sortTag: 0,
        }));
        this.updateProjectCostsForRace(race);
        this.updateParentNodes();
    }

    // Port of ResearchNodeDefinitionList.UpdateProjectCostsForRace (842). Race.ResearchColonizationCostFactor*
    // (Race.cs 186-196, default 1.0; LoadFromFile 1456-1472 clamps to [0.2, 5]).
    private updateProjectCostsForRace(race: Race | null): void {
        if (race === null) return;
        const factor = (key: string): number => {
            const raw = race.extra?.[key];
            if (raw === undefined || raw.trim() === '') return 1.0;
            return Math.min(5.0, Math.max(0.2, Number(raw.trim())));
        };
        const H = HabitatType;
        const p1 = this.getLowestProjectForColonization(this.techTree, H.Continental);
        const p2 = this.getLowestProjectForColonization(this.techTree, H.MarshySwamp);
        const p3 = this.getLowestProjectForColonization(this.techTree, H.Ocean);
        const p4 = this.getLowestProjectForColonization(this.techTree, H.Desert);
        const p5 = this.getLowestProjectForColonization(this.techTree, H.Ice);
        const p6 = this.getLowestProjectForColonization(this.techTree, H.Volcanic);
        if (p1 !== null) p1.cost = Math.fround(p1.cost * Math.fround(factor('ResearchColonizationCostFactorContinental')));
        if (p2 !== null) p2.cost = Math.fround(p2.cost * Math.fround(factor('ResearchColonizationCostFactorMarshySwamp')));
        if (p3 !== null) p3.cost = Math.fround(p3.cost * Math.fround(factor('ResearchColonizationCostFactorOcean')));
        if (p4 !== null) p4.cost = Math.fround(p4.cost * Math.fround(factor('ResearchColonizationCostFactorDesert')));
        if (p5 !== null) p5.cost = Math.fround(p5.cost * Math.fround(factor('ResearchColonizationCostFactorIce')));
        if (p6 !== null) p6.cost = Math.fround(p6.cost * Math.fround(factor('ResearchColonizationCostFactorVolcanic')));
    }

    // Port of ResearchNodeDefinitionList.UpdateParentNodes (868): the definition's ParentNodes (file PARENTS
    // lines; ResearchNodeDefinitionList.cs 823-836, ParentIsRequired defaults to false) resolved to runtime nodes
    // by id (FindNodeById). Definitions are in id order (CheckSequentialIds), so index == id.
    private updateParentNodes(): void {
        const byId = new Map<number, TechNode>();
        for (const n of this.techTree) if (!byId.has(n.def.projectId)) byId.set(n.def.projectId, n);
        for (const n of this.techTree) {
            if (n.def.parents.length <= 0) continue;
            n.parentNodes = [];
            n.parentIsRequired = [];
            for (const parent of n.def.parents) {
                const nodeById = byId.get(parent.parentProjectId);
                if (nodeById !== undefined) {
                    n.parentNodes.push(nodeById);
                    n.parentIsRequired.push(parent.isRequired);
                }
            }
        }
    }

    // Port of ResearchNodeList.GetLowestProjectForColonization(habitatType) (1028), over any node list.
    getLowestProjectForColonization(list: TechNode[], habitatType: HabitatType): TechNode | null {
        let num = Number.MAX_VALUE;
        let r: TechNode | null = null;
        for (const n of list) {
            for (const a of n.def.abilities) {
                if (abilityTypeFromFile(a.type) === ResearchAbilityType.ColonizeHabitatType && resolveColonyHabitatTypeByIndexIncludingUndefined(a.value) === habitatType && n.def.techLevel < num) {
                    r = n;
                    num = n.def.techLevel;
                }
            }
        }
        return r;
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

    componentTypeOf(id: number): ComponentType | undefined {
        return this.stat?.componentsById.get(id)?.type;
    }

    // ResearchNode.ResolveComponentTypesAll (93).
    componentTypesAll(n: TechNode): ComponentType[] {
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

    // Port of ResearchSystem.Update(race) (68). No Galaxy.Rnd.
    update(race: Race | null = null): void {
        this.determineResearchedComponents();
        this.determineComponentImprovements();
        // DetermineResearchAbilities (1099).
        const abilities: ResearchAbilityRuntime[] = [];
        for (const n of this.techTree) {
            if (!n.isResearched) continue;
            for (const a of n.def.abilities) abilities.push({ type: abilityTypeFromFile(a.type), level: a.level, value: a.value, relatedObjectIndex: a.relatedObjectIndex });
        }
        this.abilities = abilities;
        this.buildablePlanetaryFacilities = this.determineBuildablePlanetaryFacilities();
        this.researchedFighters = this.determineResearchedFighters();
        this.enabledPlagues = this.reviewPlagues();
        this.latestComponentsByType = this.determineLatestComponentsByType(this.researchedComponents);
        this.latestComponentsByCategory = this.determineLatestComponentsByCategory(this.researchedComponents);
        this.bestComponentsByType = this.determineBestComponentsByType(this.researchedComponents);
        this.bestComponentsByCategory = this.determineBestComponentsByCategory(this.researchedComponents);
        this.refreshLatestNextProjects(race);
        this.reviewOrderedComponents();
    }

    /** research.txt facility id → PlanetaryFacilityDefinition (Galaxy.PlanetaryFacilityDefinitionsStatic[id]). */
    planetaryFacilityOf(n: TechNode): Facility | null {
        const id = n.def.facilityId;
        if (id === null || id < 0) return null;
        return this.stat?.facilities[id] ?? null;
    }

    // Port of ResearchSystem.cs DetermineBuildablePlanetaryFacilities (1138).
    private determineBuildablePlanetaryFacilities(): Facility[] {
        const list: Facility[] = [];
        for (const n of this.techTree) {
            const f = this.planetaryFacilityOf(n);
            if (n.isResearched && f !== null && !list.some((x) => x.facilityId === f.facilityId)) list.push(f);
        }
        return list;
    }

    // Port of ResearchSystem.cs DetermineResearchedFighters (1085).
    private determineResearchedFighters(): Fighter[] {
        const list: Fighter[] = [];
        for (const n of this.techTree) {
            if (n.isResearched && n.def.fighters.length > 0) {
                for (const id of n.def.fighters) {
                    const f = this.stat?.fighters.find((x) => x.fighterId === id);
                    if (f !== undefined) list.push(f);
                }
            }
        }
        return list;
    }

    // Port of ResearchSystem.cs ReviewPlagues (1113): mutates the shared static plague rows.
    private reviewPlagues(): PlagueStatic[] {
        const list: PlagueStatic[] = [];
        for (const n of this.techTree) {
            const pc = n.def.plagueChange;
            if (n.isResearched && pc !== null) {
                const plague = this.stat?.plagues[pc.plagueId];
                if (plague === undefined) throw new Error(`ResearchSystem.ReviewPlagues: PlaguesStatic[${pc.plagueId}] out of range`);
                if (!list.some((x) => x.plagueId === pc.plagueId)) list.push(plague);
                if (plague.latestTechLevelUpdate < n.def.techLevel) {
                    plague.latestTechLevelUpdate = n.def.techLevel;
                    plague.mortalityRate = pc.mortalityRate;
                    plague.infectionChance = pc.infectionChance;
                    plague.duration = pc.duration;
                    plague.exceptionMortalityRate = pc.exceptionMortalityRate;
                    plague.exceptionInfectionChance = pc.exceptionInfectionChance;
                    plague.exceptionDuration = pc.exceptionDuration;
                }
            }
        }
        return list;
    }

    // Port of ResearchSystem.cs RefreshLatestNextProjects (171) → DetermineLatestResearchProjects (1010).
    refreshLatestNextProjects(race: Race | null): void {
        const researchProjects: TechNode[] = [];
        const nextProjects: TechNode[] = [];
        for (const n of this.techTree) {
            if (n.isResearched) continue;
            let flag1 = true;
            const allowed = this.stat?.allowedRaces.get(n.def.projectId);
            if (allowed !== undefined && allowed.size > 0) {
                flag1 = false;
                if (race !== null && allowed.has(race.name)) flag1 = true;
            }
            const disallowed = this.stat?.disallowedRaces.get(n.def.projectId);
            if (disallowed !== undefined && disallowed.size > 0 && race !== null && disallowed.has(race.name)) flag1 = false;
            let flag2 = true;
            if (flag1) {
                let flag3 = false;
                if (n.parentNodes.length > 0) {
                    for (let i = 0; i < n.parentNodes.length; i++) {
                        if (n.parentIsRequired[i] && !n.parentNodes[i].isResearched) flag2 = false;
                        else if (n.parentNodes[i].isResearched) {
                            flag3 = true;
                            if (!researchProjects.includes(n.parentNodes[i])) researchProjects.push(n.parentNodes[i]);
                        }
                    }
                } else {
                    flag2 = true;
                    flag3 = true;
                }
                if (flag2 && flag3 && n.isEnabled && !nextProjects.includes(n)) nextProjects.push(n);
            }
        }
        this.latestProjects = researchProjects;
        this.nextProjects = nextProjects;
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

    /** ResearchNode.AllowedRaces.Count (Galaxy.3.cs SetResearchRaceSpecialProjects). */
    allowedRacesCount(n: TechNode): number {
        return this.stat?.allowedRaces.get(n.def.projectId)?.size ?? 0;
    }
    /** ResearchNode.AllowedRaces.Contains(race). */
    allowedRacesContains(n: TechNode, race: Race): boolean {
        return this.stat?.allowedRaces.get(n.def.projectId)?.has(race.name) ?? false;
    }

    /** The research queue of `industry` (ResearchSystem.cs CanResearchNode 1507-1518 switch); null for Undefined. */
    researchQueueFor(industry: IndustryType): TechNode[] | null {
        switch (industry) {
            case IndustryType.Weapon: return this.researchQueueWeapons;
            case IndustryType.Energy: return this.researchQueueEnergy;
            case IndustryType.HighTech: return this.researchQueueHighTech;
            default: return null;
        }
    }

    // Port of ResearchSystem.cs CanResearchNode (1503).
    canResearchNode(node: TechNode): boolean {
        if (!node.isEnabled) return false;
        const researchNodeList = this.researchQueueFor(nodeIndustry(node));
        let flag = false;
        if (node.parentNodes.length <= 0) return true;
        for (let i = 0; i < node.parentNodes.length; i++) {
            const parent = node.parentNodes[i];
            if (node.parentIsRequired[i]) {
                if (!parent.isResearched && !researchNodeList!.includes(parent)) return false;
                if (researchNodeList!.includes(parent)) flag = true;
                else if (parent.isResearched) flag = true;
            } else if (parent.isResearched) flag = true;
            else if (researchNodeList!.includes(parent)) flag = true;
        }
        return flag;
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

// ---------------------------------------------------------------------------
// M4k: ResearchNode / ResearchNodeList helpers over runtime node lists (ResearchNode.cs, ResearchNodeList.cs).
// ResearchNodeList derives from List<ResearchNode>: Contains / Remove / IndexOf-by-reference semantics.
// ---------------------------------------------------------------------------

/** ResearchNode.Industry: research.txt industry 0/1/2 → IndustryType Weapon/Energy/HighTech (ResearchNodeDefinitionList.cs 164-177). */
export function nodeIndustry(n: TechNode): IndustryType {
    switch (n.def.industry) {
        case 0: return IndustryType.Weapon;
        case 1: return IndustryType.Energy;
        case 2: return IndustryType.HighTech;
        default: return IndustryType.Undefined;
    }
}

/** ResearchNode.Category (Galaxy.4.cs DetermineComponentCategoryByIndex). */
export function nodeCategory(n: TechNode): ComponentCategoryType {
    return componentCategoryByIndex(n.def.category);
}

/** ResearchNode.ResolveComponentType (ResearchNode.cs 122). */
export function resolveComponentType(rs: ResearchSystem, n: TechNode): ComponentType {
    if (n.def.components.length > 0) return rs.componentTypeOf(n.def.components[0]) ?? ComponentType.Undefined;
    if (n.def.componentImprovements.length > 0) return rs.componentTypeOf(n.def.componentImprovements[0].componentId) ?? ComponentType.Undefined;
    return ComponentType.Undefined;
}

/** ResearchNode.ResolveResearchAbilityType (ResearchNode.cs 129): the first ability's type. */
export function resolveResearchAbilityType(n: TechNode): ResearchAbilityType {
    return n.def.abilities.length > 0 ? abilityTypeFromFile(n.def.abilities[0].type) : ResearchAbilityType.Undefined;
}

/** ResearchAbility.RelatedObject as TroopType for a Troop ability (ResearchNodeDefinitionList.cs 581-598), else null. */
export function abilityRelatedTroopType(a: { type: number; relatedObjectIndex: number }): TroopType | null {
    if (abilityTypeFromFile(a.type) !== ResearchAbilityType.Troop) return null;
    switch (a.relatedObjectIndex) {
        case 0: return TroopType.Undefined;
        case 1: return TroopType.Infantry;
        case 2: return TroopType.Armored;
        case 3: return TroopType.Artillery;
        case 4: return TroopType.SpecialForces;
        default: return null;
    }
}

/** ResearchAbility.RelatedObject as BuiltObjectSubRole for an EnableShipSubRole ability (ResearchNodeDefinitionList.cs 569-579), else null. */
export function abilityRelatedSubRole(a: { type: number; relatedObjectIndex: number }): BuiltObjectSubRole | null {
    if (abilityTypeFromFile(a.type) !== ResearchAbilityType.EnableShipSubRole) return null;
    switch (a.relatedObjectIndex) {
        case 0: return BuiltObjectSubRole.Carrier;
        case 1: return BuiltObjectSubRole.ResupplyShip;
        default: return null;
    }
}

/** ResearchNodeList.ContainsById (260). */
export function containsById(list: readonly (TechNode | null)[], researchNodeId: number): boolean {
    for (let i = 0; i < list.length; i++) {
        const n = list[i];
        // C# dereferences this[index] without a null check (a null entry would throw).
        if (n!.def.projectId === researchNodeId) return true;
    }
    return false;
}

/** ResearchNodeList.FindNodeById (270). */
export function findNodeById(list: readonly TechNode[], researchNodeId: number): TechNode | null {
    for (let i = 0; i < list.length; i++) if (list[i].def.projectId === researchNodeId) return list[i];
    return null;
}

/** List<T>.Remove: first occurrence by reference. */
export function listRemove<T>(list: T[], item: T): boolean {
    const i = list.indexOf(item);
    if (i < 0) return false;
    list.splice(i, 1);
    return true;
}

/** ResearchNodeList.GetProjectsByIndustry (205). */
export function getProjectsByIndustry(list: readonly TechNode[], industry: IndustryType): TechNode[] {
    return list.filter((n) => nodeIndustry(n) === industry);
}

/** ResearchNodeList.GetProjectsByCategory (194). */
export function getProjectsByCategory(list: readonly TechNode[], category: ComponentCategoryType): TechNode[] {
    return list.filter((n) => nodeCategory(n) === category);
}

/** ResearchNodeList.GetProjectsByAbility (150). */
export function getProjectsByAbility(list: readonly TechNode[], abilityType: ResearchAbilityType): TechNode[] {
    return list.filter((n) => resolveResearchAbilityType(n) === abilityType);
}

/** ResearchNodeList.GetProjectsByType (161). */
export function getProjectsByType(rs: ResearchSystem, list: readonly TechNode[], type: ComponentType): TechNode[] {
    return list.filter((n) => resolveComponentType(rs, n) === type);
}

/** ResearchNodeList.GetProjectsByTypeAny (172). */
export function getProjectsByTypeAny(rs: ResearchSystem, list: readonly TechNode[], type: ComponentType): TechNode[] {
    return list.filter((n) => rs.componentTypesAll(n).includes(type));
}

/** ResearchNodeList.StripProjectsByType (136). */
export function stripProjectsByType(rs: ResearchSystem, list: TechNode[], type: ComponentType): void {
    const strip = getProjectsByTypeAny(rs, list, type);
    for (const n of strip) listRemove(list, n);
}

/** ResearchNodeList.StripProjectsByAbility (143). */
export function stripProjectsByAbility(list: TechNode[], abilityType: ResearchAbilityType): void {
    const strip = getProjectsByAbility(list, abilityType);
    for (const n of strip) listRemove(list, n);
}

/** ResearchNodeList.StripProjectsAboveTechLevel (129) via GetProjectsAboveTechLevel (572). */
export function stripProjectsAboveTechLevel(list: TechNode[], techLevel: number): void {
    const strip = list.filter((n) => n !== null && n.def.techLevel > techLevel);
    for (const n of strip) listRemove(list, n);
}

/** ResearchNodeList.FindNodesByIdsUnresearched (216). */
export function findNodesByIdsUnresearched(list: readonly TechNode[], researchNodeIds: readonly number[]): TechNode[] {
    const out: TechNode[] = [];
    for (const id of researchNodeIds) {
        const n = findNodeById(list, id);
        if (n !== null && !n.isResearched && n.isEnabled) out.push(n);
    }
    return out;
}

/** ResearchNodeList.CheckContainsAnyNodeId (1052). */
export function checkContainsAnyNodeId(list: readonly TechNode[], nodeIds: readonly number[]): boolean {
    for (const n of list) if (n !== null && nodeIds.includes(n.def.projectId)) return true;
    return false;
}

/** ResearchNodeList.IndexBySpecialFunctionCode (250). */
export function indexBySpecialFunctionCode(list: readonly TechNode[], specialFunctionCode: number): number {
    for (let i = 0; i < list.length; i++) if (list[i].def.specialFunctionCode === specialFunctionCode) return i;
    return -1;
}

/** ResearchNodeList.Merge (494). */
export function mergeNodes(a: readonly (TechNode | null)[], projects: readonly (TechNode | null)[]): (TechNode | null)[] {
    const out: (TechNode | null)[] = [...a];
    for (const p of projects) if (p !== null && !containsById(out, p.def.projectId)) out.push(p);
    return out;
}

/** ResearchNodeList.Intersect (507): the entries of `projects` whose id is in `a`, in `projects` order. */
export function intersectNodes(a: readonly (TechNode | null)[], projects: readonly (TechNode | null)[]): TechNode[] {
    const out: TechNode[] = [];
    for (const p of projects) if (p !== null && containsById(a, p.def.projectId)) out.push(p);
    return out;
}

/** ResearchNodeList.NotIntersect (519). */
export function notIntersectNodes(a: readonly (TechNode | null)[], projects: readonly (TechNode | null)[]): TechNode[] {
    const out: TechNode[] = [];
    for (const n of a) if (n !== null && !containsById(projects, n.def.projectId)) out.push(n);
    return out;
}

/** ResearchNodeList.GetLowestTechLevel (531). */
export function getLowestTechLevel(list: readonly TechNode[]): number {
    let lowest = 2147483647;
    for (const n of list) if (n !== null && n.def.techLevel < lowest) lowest = n.def.techLevel;
    return lowest;
}

/** ResearchNodeList.GetTechLevelRange (543). */
export function getTechLevelRange(list: readonly TechNode[]): { lowest: number; highest: number } {
    let lowest = 2147483647;
    let highest = 0;
    for (const n of list) {
        if (n !== null) {
            if (n.def.techLevel < lowest) lowest = n.def.techLevel;
            if (n.def.techLevel > highest) highest = n.def.techLevel;
        }
    }
    return { lowest, highest };
}

/** ResearchNodeList.GetProjectsAtTechLevel (560). */
export function getProjectsAtTechLevel(list: readonly TechNode[], techLevel: number): TechNode[] {
    return list.filter((n) => n !== null && n.def.techLevel === techLevel);
}

/** ResearchNodeList.RemoveProjectsWithTechLevelHigherThan (584): a new list of the entries at or below `techLevel`. */
export function removeProjectsWithTechLevelHigherThan(list: readonly TechNode[], techLevel: number): TechNode[] {
    return list.filter((n) => n !== null && n.def.techLevel <= techLevel);
}

/** ResearchNodeList.SelectRandomLowestProject(galaxy) (614). Rnd: Next(0, count) over the lowest-tech-level entries. */
export function selectRandomLowestProject(rnd: Random, list: readonly TechNode[]): TechNode | null {
    if (list.length > 0) {
        let num = Number.MAX_VALUE;
        const lowest: TechNode[] = [];
        for (const n of list) {
            if (n !== null) {
                if (n.def.techLevel < num) {
                    num = n.def.techLevel;
                    lowest.length = 0;
                    lowest.push(n);
                } else if (n.def.techLevel === num) lowest.push(n);
            }
        }
        if (lowest.length > 0) return lowest[rnd.next(0, lowest.length)];
    }
    return null;
}

/** ResearchNodeList.GetHighestResearchedProjectForIndustry (691). */
export function getHighestResearchedProjectForIndustry(list: readonly TechNode[], industry: IndustryType): TechNode | null {
    let num = 0.0;
    let r: TechNode | null = null;
    for (const n of list) {
        if (n.isResearched && nodeIndustry(n) === industry && n.def.techLevel > num) {
            r = n;
            num = n.def.techLevel;
        }
    }
    return r;
}

/** ResearchNodeList.GetHighestProjectForCategory (706). */
export function getHighestProjectForCategory(list: readonly TechNode[], category: ComponentCategoryType): TechNode | null {
    let num = 0.0;
    let r: TechNode | null = null;
    for (const n of list) {
        if (nodeCategory(n) === category && n.def.techLevel > num) {
            r = n;
            num = n.def.techLevel;
        }
    }
    return r;
}

/** ResearchNodeList.GetHighestProjectForTypeAny (738). */
export function getHighestProjectForTypeAny(rs: ResearchSystem, list: readonly TechNode[], type: ComponentType): TechNode | null {
    let num = 0.0;
    let r: TechNode | null = null;
    for (const n of list) {
        if (rs.componentTypesAll(n).includes(type) && n.def.techLevel > num) {
            r = n;
            num = n.def.techLevel;
        }
    }
    return r;
}

/** ResearchNodeList.GetLowestProjectForTypeAny (783). */
export function getLowestProjectForTypeAnyIn(rs: ResearchSystem, list: readonly TechNode[], type: ComponentType): TechNode | null {
    let num = Number.MAX_VALUE;
    let r: TechNode | null = null;
    for (const n of list) {
        if (rs.componentTypesAll(n).includes(type) && n.def.techLevel < num) {
            r = n;
            num = n.def.techLevel;
        }
    }
    return r;
}

/** ResearchNodeList.GetSecondLowestProjectForTypeAny (828) — verbatim, including its "previous lowest" semantics. */
export function getSecondLowestProjectForTypeAny(rs: ResearchSystem, list: readonly TechNode[], type: ComponentType): TechNode | null {
    let num = Number.MAX_VALUE;
    let researchNode: TechNode | null = null;
    let r: TechNode | null = null;
    for (const n of list) {
        if (rs.componentTypesAll(n).includes(type) && n.def.techLevel < num) {
            if (researchNode !== null) r = researchNode;
            researchNode = n;
            num = researchNode.def.techLevel;
        }
    }
    return r;
}

/** ResearchNodeList.GetLowestUnresearchedProjectForTypeAny(type, race) (798). */
export function getLowestUnresearchedProjectForTypeAny(rs: ResearchSystem, list: readonly TechNode[], type: ComponentType, race: Race | null): TechNode | null {
    let num = Number.MAX_VALUE;
    let r: TechNode | null = null;
    for (const n of list) {
        if (!n.isResearched && rs.componentTypesAll(n).includes(type) && n.def.techLevel < num && (race === null || rs.allowedRacesCount(n) <= 0 || rs.allowedRacesContains(n, race))) {
            r = n;
            num = n.def.techLevel;
        }
    }
    return r;
}

/** ResearchNodeList.GetLowestUnresearchedProjectForRaceForTypeAny(type, race) (768). */
export function getLowestUnresearchedProjectForRaceForTypeAny(rs: ResearchSystem, list: readonly TechNode[], type: ComponentType, race: Race): TechNode | null {
    let num = Number.MAX_VALUE;
    let r: TechNode | null = null;
    for (const n of list) {
        if (rs.componentTypesAll(n).includes(type) && rs.allowedRacesContains(n, race) && n.def.techLevel < num) {
            r = n;
            num = n.def.techLevel;
        }
    }
    return r;
}

/** ResearchNodeList.GetLowestUnresearchedProjectForRaceForCategory(category, race) (721). */
export function getLowestUnresearchedProjectForRaceForCategory(rs: ResearchSystem, list: readonly TechNode[], category: ComponentCategoryType, race: Race): TechNode | null {
    let num = Number.MAX_VALUE;
    let r: TechNode | null = null;
    for (const n of list) {
        if (nodeCategory(n) === category && rs.allowedRacesContains(n, race) && n.def.techLevel < num) {
            r = n;
            num = n.def.techLevel;
        }
    }
    return r;
}

/** ResearchNodeList.GetLowestProjectForTroopType (940) / GetLowestUnresearchedProjectForTroopType (962). */
export function getLowestProjectForTroopType(list: readonly TechNode[], troopType: TroopType, unresearchedOnly = false): TechNode | null {
    let num = Number.MAX_VALUE;
    let r: TechNode | null = null;
    for (const n of list) {
        if (unresearchedOnly && n.isResearched) continue;
        for (const a of n.def.abilities) {
            if (abilityRelatedTroopType(a) === troopType && n.def.techLevel < num) {
                r = n;
                num = n.def.techLevel;
            }
        }
    }
    return r;
}

/** ResearchNodeList.GetLowestProjectForDedicatedCarriers (984). */
export function getLowestProjectForDedicatedCarriers(list: readonly TechNode[]): TechNode | null {
    let num = Number.MAX_VALUE;
    let r: TechNode | null = null;
    for (const n of list) {
        for (const a of n.def.abilities) {
            if (abilityRelatedSubRole(a) === BuiltObjectSubRole.Carrier && n.def.techLevel < num) {
                r = n;
                num = n.def.techLevel;
            }
        }
    }
    return r;
}

/** PlanetaryFacilityDefinitionList.cs LoadFromFile 100-151: facilities.txt Type column → PlanetaryFacilityType. */
export enum PlanetaryFacilityType {
    Undefined,
    TroopTrainingCenter,
    RoboticTroopFoundry,
    CloningFacility,
    PlanetaryShield,
    IonCannon,
    RegionalCapital,
    FortifiedBunker,
    TerraformingFacility,
    Wonder,
    PirateBase,
    PirateFortress,
    ArmoredFactory,
    MilitaryAcademy,
    SpyAcademy,
    NavalAcademy,
    ScienceAcademy,
    PirateCriminalNetwork,
}
const FACILITY_TYPE_BY_FILE: PlanetaryFacilityType[] = [
    PlanetaryFacilityType.TroopTrainingCenter, PlanetaryFacilityType.RoboticTroopFoundry, PlanetaryFacilityType.CloningFacility,
    PlanetaryFacilityType.PlanetaryShield, PlanetaryFacilityType.IonCannon, PlanetaryFacilityType.RegionalCapital,
    PlanetaryFacilityType.FortifiedBunker, PlanetaryFacilityType.TerraformingFacility, PlanetaryFacilityType.Wonder,
    PlanetaryFacilityType.PirateBase, PlanetaryFacilityType.PirateFortress, PlanetaryFacilityType.ArmoredFactory,
    PlanetaryFacilityType.SpyAcademy, PlanetaryFacilityType.ScienceAcademy, PlanetaryFacilityType.NavalAcademy,
    PlanetaryFacilityType.MilitaryAcademy, PlanetaryFacilityType.PirateCriminalNetwork,
];
export function facilityType(f: Facility): PlanetaryFacilityType {
    return FACILITY_TYPE_BY_FILE[f.type] ?? PlanetaryFacilityType.Undefined;
}

/** WonderType.cs (facilities.txt WonderType column 0-12 maps 1:1). */
export enum WonderType {
    Undefined,
    EmpirePopulationGrowth,
    EmpireHappiness,
    EmpireResearchWeapons,
    EmpireResearchEnergy,
    EmpireResearchHighTech,
    EmpireIncome,
    ColonyPopulationGrowth,
    ColonyHappiness,
    ColonyDefense,
    ColonyConstructionSpeed,
    ColonyIncome,
    RaceAchievement,
}

/** ResearchNodeList.GetLowestProjectForPlanetaryFacilityType (879) / GetLowestUnresearchedProjectForPlanetaryFacilityType (894). */
export function getLowestProjectForPlanetaryFacilityType(rs: ResearchSystem, list: readonly TechNode[], type: PlanetaryFacilityType, unresearchedOnly = false): TechNode | null {
    let num = Number.MAX_VALUE;
    let r: TechNode | null = null;
    for (const n of list) {
        if (unresearchedOnly && n.isResearched) continue;
        const f = rs.planetaryFacilityOf(n);
        if (f !== null && facilityType(f) === type && n.def.techLevel < num) {
            r = n;
            num = n.def.techLevel;
        }
    }
    return r;
}

/** ResearchNodeList.GetLowestProjectForWonderType (910) / GetLowestUnresearchedProjectForWonderType (925). */
export function getLowestProjectForWonderType(rs: ResearchSystem, list: readonly TechNode[], wonderType: WonderType, unresearchedOnly = false): TechNode | null {
    let num = Number.MAX_VALUE;
    let r: TechNode | null = null;
    for (const n of list) {
        if (unresearchedOnly && n.isResearched) continue;
        const f = rs.planetaryFacilityOf(n);
        if (f !== null && facilityType(f) === PlanetaryFacilityType.Wonder && f.wonderType === wonderType && n.def.techLevel < num) {
            r = n;
            num = n.def.techLevel;
        }
    }
    return r;
}

/** ResearchNodeList.GetProjectByFacility (657): reference match on the static definition (by id here). */
export function getProjectByFacility(rs: ResearchSystem, list: readonly TechNode[], facility: Facility): TechNode | null {
    for (const n of list) {
        const f = rs.planetaryFacilityOf(n);
        if (n !== null && f !== null && f.facilityId === facility.facilityId) return n;
    }
    return null;
}

/** ResearchNodeList.GetHighestProjectForComponent (668). */
export function getHighestProjectForComponent(list: readonly TechNode[], componentId: number): TechNode | null {
    let num = 0.0;
    let r: TechNode | null = null;
    for (const n of list) {
        if (n.def.components.includes(componentId)) {
            if (n.def.techLevel > num) {
                r = n;
                num = n.def.techLevel;
            }
        } else if (n.def.componentImprovements.some((ci) => ci.componentId === componentId) && n.def.techLevel > num) {
            r = n;
            num = n.def.techLevel;
        }
    }
    return r;
}

/** ResearchNodeList.CheckProjectIsReachableWithAllNeededParentResearch (408). */
export function checkProjectIsReachableWithAllNeededParentResearch(project: TechNode): { reachable: boolean; requiredParentsNeedResearching: boolean; optionalParentsNeedResearching: boolean } {
    let requiredParentsNeedResearching = false;
    let optionalParentsNeedResearching = false;
    if (project.parentNodes.length <= 0) return { reachable: true, requiredParentsNeedResearching, optionalParentsNeedResearching };
    let num1 = 0;
    let num2 = 0;
    let num3 = 0;
    let num4 = 0;
    for (let i = 0; i < project.parentNodes.length; i++) {
        const parentNode = project.parentNodes[i];
        let flag = false;
        if (project.parentIsRequired.length > i) flag = project.parentIsRequired[i];
        if (parentNode !== null) {
            if (flag) {
                ++num1;
                if (!parentNode.isResearched) ++num2;
            } else {
                ++num3;
                if (parentNode.isResearched) ++num4;
            }
        }
    }
    if (num1 > 0) {
        if (num2 === 0) return { reachable: true, requiredParentsNeedResearching, optionalParentsNeedResearching };
        requiredParentsNeedResearching = true;
    } else {
        if (num3 <= 0 || num4 > 0) return { reachable: true, requiredParentsNeedResearching, optionalParentsNeedResearching };
        optionalParentsNeedResearching = true;
    }
    return { reachable: false, requiredParentsNeedResearching, optionalParentsNeedResearching };
}

/** ResearchNodeList.GetCurrentPath(startingNode, race) (380). */
export function getCurrentPath(rs: ResearchSystem, startingNode: TechNode, race: Race | null): (TechNode | null)[] {
    let currentPath1: (TechNode | null)[] = [];
    const r = checkProjectIsReachableWithAllNeededParentResearch(startingNode);
    if (!r.reachable) {
        for (let i = 0; i < startingNode.parentNodes.length; i++) {
            const parentNode = startingNode.parentNodes[i];
            let flag = false;
            if (startingNode.parentIsRequired.length > i) flag = startingNode.parentIsRequired[i];
            if (
                parentNode !== null &&
                ((r.requiredParentsNeedResearching && flag) || (r.optionalParentsNeedResearching && !flag)) &&
                !parentNode.isResearched &&
                (rs.allowedRacesCount(parentNode) === 0 || (race !== null && rs.allowedRacesContains(parentNode, race)))
            ) {
                currentPath1.push(parentNode);
                const currentPath2 = getCurrentPath(rs, parentNode, race);
                if (currentPath2.length > 0) currentPath1 = mergeNodes(currentPath1, currentPath2);
            }
        }
    }
    return currentPath1;
}
