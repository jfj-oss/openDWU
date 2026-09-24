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
    };
}

// Port of Galaxy.4.cs LoadEmpirePolicy(race, isPirate): file policy or a default one (never null).
export function loadEmpirePolicy(stat: ResearchStatic | null, race: Race, isPirate: boolean): EmpirePolicy {
    return (isPirate ? stat?.piratePolicies : stat?.policies)?.get(race.name) ?? defaultEmpirePolicy();
}

export class ResearchSystem {
    techTree: TechNode[] = [];
    abilities: { type: ResearchAbilityType; value: number }[] = [];
    researchedComponents: Component[] = [];

    constructor(private stat: ResearchStatic | null) {}

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

    // Port of ResearchSystem.Update (researched components + abilities).
    update(): void {
        const comps: Component[] = [];
        const abilities: { type: ResearchAbilityType; value: number }[] = [];
        for (const n of this.techTree) {
            if (!n.isResearched) continue;
            for (const id of n.def.components) {
                const c = this.stat?.componentsById.get(id);
                if (c && !comps.includes(c)) comps.push(c);
            }
            for (const a of n.def.abilities) abilities.push({ type: abilityTypeFromFile(a.type), value: a.value });
        }
        this.researchedComponents = comps;
        this.abilities = abilities;
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
