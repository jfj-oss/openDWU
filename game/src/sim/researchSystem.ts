// Research runtime for game start (task C2c-3). Ports of
//   ResearchNodeDefinitionList.ObtainTechTree (890) — one node per definition
//   ResearchNodeDefinitionList.SetTechTreeLevel (1141) — integer/fractional levels
//   Galaxy.3.cs SetResearchRaceSpecialProjects (1929) — AllowedRaces
//   ResearchSystem.Update → DetermineResearchedComponents / DetermineResearchAbilities
//   Empire.3.cs ReviewColonizationTypes (2184), CheckEmpireHasHyperDriveTech (3593)
// TODO(port): SetTechTreeStartingDefaults (techLevel 0.5 / Empire ctor),
// project costs, parents, DisallowedRaces, wonder races, component
// improvements, facilities, fighters, plagues, latest/best component tables.

import type { ResearchNode as ResearchNodeDefinition } from './data/research';
import type { Component } from './data/components';
import { ComponentType } from './data/components';
import type { Race } from './data/races';
import type { Random } from './random';

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
}

// Port of Galaxy.3.cs SetResearchRaceSpecialProjects (specified races +
// races whose SpecialComponent a node grants or improves).
export function buildResearchStatic(definitions: ResearchNodeDefinition[], components: Component[], races: Race[]): ResearchStatic {
    const allowed = new Map<number, Set<string>>();
    const add = (id: number, name: string) => {
        let s = allowed.get(id);
        if (!s) allowed.set(id, (s = new Set()));
        s.add(name);
    };
    const raceNames = new Set(races.map((r) => r.name));
    for (const d of definitions) for (const n of d.allowedRaces) if (raceNames.has(n)) add(d.projectId, n);
    for (const r of races) {
        if (r.specialComponent < 0) continue;
        for (const d of definitions) {
            if (d.components.includes(r.specialComponent) || d.componentImprovements.some((ci) => ci.componentId === r.specialComponent)) add(d.projectId, r.name);
        }
    }
    return { definitions, componentsById: new Map(components.map((c) => [c.componentId, c])), allowedRaces: allowed };
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
            // TODO(port): SetTechTreeStartingDefaults / ...Pirates.
            throw new Error('SetTechTreeStartingDefaults (tech level 0.5) is not ported yet');
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
