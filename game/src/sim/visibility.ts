// System visibility / fog of war (task C1). Ports of
//   SystemVisibility.cs, SystemVisibilityStatus.cs, SystemVisibilityList.cs,
//   GalaxyResourceMap.cs (the per-empire "resources known" bit map),
//   the Empire-side checks (Empire.9.cs CheckSystemVisible /
//   CheckSystemVisibilityStatus / CheckSystemExplored / ResolveSystemVisibility /
//   SetSystemVisibility / IsObjectVisibleToThisEmpire(Creature),
//   SetEmpireSharedVisibility / ClearEmpireSharedVisibility),
//   and the Galaxy-side updates (Galaxy.4.cs MergeGalaxyMap, Galaxy.7.cs
//   SetEmpireExplorationAmount, Galaxy.9.cs AddSystemToEmpires /
//   SetSystemHabitatsExploration, Galaxy.6.cs FindNearestUnexploredHabitat,
//   BuiltObject.1.cs KnownGalaxyLocations discovery).
//
// None of these C# methods call Rnd, so this module never touches the
// galaxy's random stream.
//
// empire.ts / galaxy.ts are not edited here: an Empire owns one
// `EmpireVisibility` and supplies a `VisibilityOwner` (the hooks that need
// the empire's colonies and ships). See tasks/HANDOFF-cloud-lane-c-1.md.

import type { Creature } from './creature';
import type { BuiltObject } from './builtObject';
import { MIN_TIME } from './tick/simTime';
import type { Galaxy } from './galaxy';
import { GalaxyLocationType, type GalaxyLocation } from './galaxyLocation';
import { HabitatCategoryType, type Habitat, type SystemInfo } from './types';

// Port of Galaxy.3.cs InitializeStatics (4974, 4978).
export const MAX_SOLAR_SYSTEM_SIZE = 23000;
export const THREAT_RANGE = 40000;

// Port of SystemVisibilityStatus.cs (byte enum, member order exact).
export enum SystemVisibilityStatus {
    Undefined,
    Unexplored,
    Explored,
    Visible,
}

// Port of SystemVisibility.cs (serialized fields; the NonSerialized threat /
// link lists belong to the AI and are TODO(port) with it).
export class SystemVisibility {
    systemStar: Habitat;
    status: SystemVisibilityStatus;
    totallyExplored = false;
    isRefuellingPoint = false;
    empireStrength = 0;
    fuelSourcesFinalized = false;
    // SystemVisibility.cs 23-28 [NonSerialized] per-empire system threat cache (task M4t: read/written by
    // Habitat.PerformThreatEvaluation; BuiltObject.ThreatEvaluation, M4n, shares it). LatestThreatEvaluation is a
    // game-time ms value (DateTime.MinValue = MIN_TIME, tick/simTime.ts).
    threats: BuiltObject[] = [];
    threatLevels: number[] = [];
    latestThreatEvaluation = MIN_TIME;

    constructor(systemStar: Habitat, status: SystemVisibilityStatus = SystemVisibilityStatus.Undefined) {
        this.systemStar = systemStar;
        this.status = status;
    }
}

// Port of SystemVisibilityList.cs CountExploredSystems.
export function countExploredSystems(list: readonly SystemVisibility[]): number {
    let num = 0;
    for (const v of list) {
        if (v.status === SystemVisibilityStatus.Explored || v.status === SystemVisibilityStatus.Visible) {
            ++num;
        }
    }
    return num;
}

// Port of GalaxyResourceMap.cs: one bit per habitat index ("resources known",
// i.e. the habitat has been surveyed). C# `_Reindexing` guards are omitted
// (no background reindex in the TS port).
export class GalaxyResourceMap {
    resourcesKnown: Uint8Array = new Uint8Array(0);
    private galaxy: Galaxy | null = null;

    // Port of InitializeFlags(habitatCount, galaxy).
    initializeFlags(habitatCount: number, galaxy: Galaxy): void {
        this.resourcesKnown = new Uint8Array(Math.trunc(habitatCount / 8) + 1);
        this.galaxy = galaxy;
    }

    // Port of MergeMap(byte[]).
    mergeMap(map: Uint8Array): void {
        if (map.length !== this.resourcesKnown.length) {
            throw new Error('Cannot merge maps: they are different sizes');
        }
        for (let index = 0; index < map.length; ++index) {
            this.resourcesKnown[index] |= map[index];
        }
    }

    // Port of CheckResourcesKnownRaw(int) / CheckResourcesKnown(Habitat).
    checkResourcesKnownRaw(habitatIndex: number): boolean {
        const index = Math.trunc(habitatIndex / 8);
        const num = habitatIndex % 8;
        if (index < this.resourcesKnown.length) {
            return (this.resourcesKnown[index] & (1 << num)) !== 0;
        }
        return false;
    }

    checkResourcesKnown(habitat: Habitat): boolean {
        return this.checkResourcesKnownRaw(habitat.habitatIndex);
    }

    // Port of SetResourcesKnownRaw(int, bool) / SetResourcesKnown(Habitat, bool).
    setResourcesKnownRaw(habitatIndex: number, known: boolean): void {
        const index = Math.trunc(habitatIndex / 8);
        const num = habitatIndex % 8;
        const flag = this.checkResourcesKnownRaw(habitatIndex);
        if (index >= this.resourcesKnown.length || flag === known) {
            return;
        }
        this.resourcesKnown[index] ^= 1 << num;
    }

    setResourcesKnown(habitat: Habitat, known: boolean): void {
        this.setResourcesKnownRaw(habitat.habitatIndex, known);
    }

    // Port of SetSystemResourcesKnown(Habitat, bool).
    setSystemResourcesKnown(habitat: Habitat, known: boolean): void {
        const galaxy = this.galaxy;
        if (galaxy === null) return;
        const star = galaxy.determineHabitatSystemStar(habitat);
        if (star === null || star.systemIndex < 0 || star.systemIndex >= galaxy.systems.length) {
            return;
        }
        this.setResourcesKnown(star, known);
        for (const habitat1 of galaxy.systemHabitatsOf(star.systemIndex)) {
            this.setResourcesKnown(habitat1, known);
        }
    }
}

// Something that can make a system Visible: a ship/base (C# BuiltObject) or
// fighter. Only the fields visibility reads.
export interface VisibilityUnit {
    xpos: number;
    ypos: number;
    nearestSystemStar: Habitat | null;
}

// A unit that can discover GalaxyLocations (BuiltObject.1.cs 1968-1986).
export interface ScanningUnit extends VisibilityUnit {
    currentSpeed: number;
    topSpeed: number;
    sensorProximityArrayRange: number;
    sensorLongRange: number;
}

// Hooks the Empire supplies (empire.ts owns colonies and ships). Every
// method mirrors a C# read inside the ported visibility code.
export interface VisibilityOwner {
    // C#: this == Galaxy.IndependentEmpire (ResolveSystemVisibility skips it).
    readonly isIndependent: boolean;
    // C#: Empire.Active (MergeGalaxyMapsForSharedVisibilityEmpires).
    readonly active: boolean;
    // C#: habitat.Owner == this, or (pirate empire) habitat.GetPirateControl()
    // .GetByFaction(this) != null — CheckSystemVisible (Empire.9.cs 4729).
    controlsHabitat(habitat: Habitat): boolean;
    // C#: BuiltObjects then PrivateBuiltObjects — any unit whose
    // NearestSystemStar == systemStar and != exclude.
    hasUnitInSystem(systemStar: Habitat, exclude: VisibilityUnit | null): boolean;
    // C#: LongRangeScanners (x, y, SensorLongRange) — IsObjectVisibleToThisEmpire.
    longRangeScanners(): readonly { xpos: number; ypos: number; sensorLongRange: number }[];
    // C#: FindShipOutsideSystemWithScanRange(x, y, 1.0) != null.
    hasShipOutsideSystemWithScanRange(x: number, y: number): boolean;
}

// An owner with no colonies or ships (tests, observers, pre-M2 empires).
export const NULL_VISIBILITY_OWNER: VisibilityOwner = {
    isIndependent: false,
    active: true,
    controlsHabitat: () => false,
    hasUnitInSystem: () => false,
    longRangeScanners: () => [],
    hasShipOutsideSystemWithScanRange: () => false,
};

// Called by mergeGalaxyMap when a newly-Explored system has a dominant/other
// empire the receiver hasn't met (Galaxy.4.cs 3718-3760: diplomatic/pirate
// contact + "Empire Contact From Galaxy Map" message).
// TODO(port): diplomacy — the Empire layer implements this hook.
export type ContactFromGalaxyMapHook = (receiver: EmpireVisibility, system: SystemInfo) => void;

// Per-empire visibility state: the fields Empire.cs declares for it.
export class EmpireVisibility {
    readonly galaxy: Galaxy;
    owner: VisibilityOwner;
    // C#: Empire.SystemVisibility (SystemVisibilityList), indexed by SystemIndex.
    systemVisibility: SystemVisibility[] = [];
    // C#: Empire._ResourceMap.
    resourceMap = new GalaxyResourceMap();
    // C#: Empire._SystemsVisible (HabitatList).
    systemsVisible: Habitat[] = [];
    // C#: Empire._EmpiresSharedVisibility.
    empiresSharedVisibility: EmpireVisibility[] = [];
    // C#: Empire._KnownGalaxyLocations.
    knownGalaxyLocations: GalaxyLocation[] = [];

    // Port of the visibility part of the Empire ctor (Empire.cs 3760,
    // 3831-3840): ResourceMap.InitializeFlags(Habitats.Count) and one
    // Unexplored SystemVisibility per system.
    constructor(galaxy: Galaxy, owner: VisibilityOwner = NULL_VISIBILITY_OWNER) {
        this.galaxy = galaxy;
        this.owner = owner;
        this.resourceMap.initializeFlags(galaxy.habitats.length, galaxy);
        this.systemVisibility = [];
        for (let j = 0; j < galaxy.systems.length; j++) {
            this.systemVisibility.push(new SystemVisibility(galaxy.systems[j].systemStar, SystemVisibilityStatus.Unexplored));
        }
    }

    // Port of Galaxy.9.cs AddSystemToEmpires (per empire).
    addSystem(system: SystemInfo): void {
        this.systemVisibility.push(new SystemVisibility(system.systemStar, SystemVisibilityStatus.Unexplored));
    }

    // Port of Empire.9.cs CheckSystemVisible(int systemIndex) (line 2917).
    checkSystemVisible(systemIndex: number): boolean {
        if (this.systemVisibility.length > systemIndex) {
            if (this.systemVisibility[systemIndex].status === SystemVisibilityStatus.Visible) {
                return true;
            }
            for (const empire of this.empiresSharedVisibility) {
                if (empire.systemVisibility.length > systemIndex && empire.systemVisibility[systemIndex].status === SystemVisibilityStatus.Visible) {
                    return true;
                }
            }
        }
        return false;
    }

    checkSystemStarVisible(systemStar: Habitat | null): boolean {
        return systemStar !== null ? this.checkSystemVisible(systemStar.systemIndex) : false;
    }

    // Port of Empire.9.cs CheckSystemVisibilityStatus(int) (line 2950).
    checkSystemVisibilityStatus(systemIndex: number): SystemVisibilityStatus {
        let result = this.systemVisibility[systemIndex].status;
        if (result === SystemVisibilityStatus.Visible) {
            return result;
        }
        for (const empire of this.empiresSharedVisibility) {
            const status = empire.systemVisibility[systemIndex].status;
            if (status === SystemVisibilityStatus.Visible) {
                return status;
            }
            if (status === SystemVisibilityStatus.Explored) {
                result = SystemVisibilityStatus.Explored;
            }
        }
        return result;
    }

    // Port of Empire.9.cs CheckSystemExplored(int) (line 2998).
    checkSystemExplored(systemIndex: number): boolean {
        let status = this.systemVisibility[systemIndex].status;
        if (status === SystemVisibilityStatus.Visible || status === SystemVisibilityStatus.Explored) {
            return true;
        }
        for (const empire of this.empiresSharedVisibility) {
            status = empire.systemVisibility[systemIndex].status;
            if (status === SystemVisibilityStatus.Visible || status === SystemVisibilityStatus.Explored) {
                return true;
            }
        }
        return false;
    }

    // Port of Empire.9.cs SetSystemVisibility (line 4721).
    setSystemVisibility(systemStar: Habitat, status: SystemVisibilityStatus): void {
        if (systemStar.systemIndex >= 0 && systemStar.systemIndex < this.systemVisibility.length) {
            this.systemVisibility[systemStar.systemIndex].status = status;
        }
    }

    // Port of Empire.9.cs CheckSystemVisible(systemStar, ourEmpire, excludeBuiltObject,
    // excludeHabitat) (line 4729); ourEmpire is always `this` at every call site.
    checkSystemVisibleExcluding(systemStar: Habitat, excludeUnit: VisibilityUnit | null, excludeHabitat: Habitat | null): SystemVisibilityStatus {
        for (const habitat of this.galaxy.systemHabitatsOf(systemStar.systemIndex)) {
            if (this.owner.controlsHabitat(habitat) && habitat !== excludeHabitat) {
                return SystemVisibilityStatus.Visible;
            }
        }
        if (this.owner.hasUnitInSystem(systemStar, excludeUnit)) {
            return SystemVisibilityStatus.Visible;
        }
        const status = this.systemVisibility[systemStar.systemIndex].status;
        if (status === SystemVisibilityStatus.Visible || status === SystemVisibilityStatus.Explored) {
            return SystemVisibilityStatus.Explored;
        }
        return SystemVisibilityStatus.Unexplored;
    }

    // Shared tail of both ResolveSystemVisibility overloads.
    private applyResolved(systemStar: Habitat, previous: SystemVisibilityStatus, resolved: SystemVisibilityStatus): void {
        if ((previous === SystemVisibilityStatus.Explored || previous === SystemVisibilityStatus.Visible) && resolved === SystemVisibilityStatus.Unexplored) {
            resolved = SystemVisibilityStatus.Explored;
        }
        this.setSystemVisibility(systemStar, resolved);
        if (resolved === SystemVisibilityStatus.Visible) {
            if (!this.systemsVisible.includes(systemStar)) {
                this.systemsVisible.push(systemStar);
            }
            return;
        }
        const num = this.systemsVisible.indexOf(systemStar);
        if (num >= 0) {
            this.systemsVisible.splice(num, 1);
        }
    }

    // Port of Empire.9.cs ResolveSystemVisibility(BuiltObject, bool) (line 4651).
    resolveSystemVisibilityForUnit(unit: VisibilityUnit, excludeUnit: boolean): void {
        const star = unit.nearestSystemStar;
        if (star === null || this.owner.isIndependent) {
            return;
        }
        let previous = SystemVisibilityStatus.Unexplored;
        if (star.systemIndex >= 0 && star.systemIndex < this.systemVisibility.length) {
            previous = this.systemVisibility[star.systemIndex].status;
        }
        const resolved = this.checkSystemVisibleExcluding(star, excludeUnit ? unit : null, null);
        this.applyResolved(star, previous, resolved);
    }

    // Port of Empire.9.cs ResolveSystemVisibility(x, y, excludeBuiltObject,
    // excludeHabitat) (line 4686).
    resolveSystemVisibilityAt(x: number, y: number, excludeUnit: VisibilityUnit | null = null, excludeHabitat: Habitat | null = null): void {
        const star = this.galaxy.fastFindNearestSystem(x, y);
        if (star === null) {
            return;
        }
        const num = this.galaxy.calculateDistance(x, y, star.xpos, star.ypos);
        if (!(num <= MAX_SOLAR_SYSTEM_SIZE + 500)) {
            return;
        }
        const previous = this.systemVisibility[star.systemIndex].status;
        const resolved = this.checkSystemVisibleExcluding(star, excludeUnit, excludeHabitat);
        this.applyResolved(star, previous, resolved);
    }

    // Port of Empire.9.cs SetEmpireSharedVisibility (line 2975).
    setEmpireSharedVisibility(other: EmpireVisibility, onContact?: ContactFromGalaxyMapHook): void {
        if (!this.empiresSharedVisibility.includes(other)) {
            mergeGalaxyMap(this.galaxy, other, this, onContact);
            this.empiresSharedVisibility.push(other);
        }
    }

    // Port of Empire.9.cs ClearEmpireSharedVisibility (line 2984).
    clearEmpireSharedVisibility(other: EmpireVisibility, onContact?: ContactFromGalaxyMapHook): void {
        const i = this.empiresSharedVisibility.indexOf(other);
        if (i >= 0) {
            mergeGalaxyMap(this.galaxy, other, this, onContact);
            this.empiresSharedVisibility.splice(i, 1);
        }
    }

    // Port of Empire.1.cs MergeGalaxyMapsForSharedVisibilityEmpires (line 1060).
    mergeGalaxyMapsForSharedVisibilityEmpires(onContact?: ContactFromGalaxyMapHook): void {
        for (const empire of this.empiresSharedVisibility) {
            if (empire.owner.active) {
                mergeGalaxyMap(this.galaxy, empire, this, onContact);
            }
        }
    }

    // Port of Empire.9.cs IsObjectVisibleToThisEmpire(Creature) (line 3037).
    isCreatureVisible(creature: Creature): boolean {
        if (!creature.isVisible) {
            return false;
        }
        if (creature.nearestSystemStar !== null && this.checkSystemVisible(creature.nearestSystemStar.systemIndex)) {
            return true;
        }
        for (const scanner of this.owner.longRangeScanners()) {
            const num = scanner.sensorLongRange * scanner.sensorLongRange;
            const dx = scanner.xpos - creature.xpos;
            const dy = scanner.ypos - creature.ypos;
            if (dx * dx + dy * dy <= num) {
                return true;
            }
        }
        return this.owner.hasShipOutsideSystemWithScanRange(Math.trunc(creature.xpos), Math.trunc(creature.ypos));
    }

    // Port of the KnownGalaxyLocations discovery in BuiltObject.1.cs
    // (1968-1986), run per ship tick. Returns newly-known locations (the C#
    // then posts an empire message about each — TODO(port) with messages).
    discoverGalaxyLocations(unit: ScanningUnit): GalaxyLocation[] {
        const found: GalaxyLocation[] = [];
        const list = determineGalaxyLocationsInRangeAtPoint(this.galaxy, unit.xpos, unit.ypos, 500.0, GalaxyLocationType.Undefined);
        for (const galaxyLocation of list) {
            if (
                (unit.currentSpeed > unit.topSpeed &&
                    galaxyLocation.type !== GalaxyLocationType.NebulaCloud &&
                    galaxyLocation.type !== GalaxyLocationType.SuperNova &&
                    galaxyLocation.type !== GalaxyLocationType.RaceRegion) ||
                this.knownGalaxyLocations.includes(galaxyLocation)
            ) {
                continue;
            }
            let val = Math.max(unit.sensorProximityArrayRange, unit.sensorLongRange);
            val = Math.max(val, THREAT_RANGE);
            const num4 = galaxyLocation.xpos - val;
            const num5 = galaxyLocation.xpos + (galaxyLocation.width + val);
            const num6 = galaxyLocation.ypos - val;
            const num7 = galaxyLocation.ypos + (galaxyLocation.height + val);
            if (!(unit.xpos > num4) || !(unit.xpos < num5) || !(unit.ypos > num6) || !(unit.ypos < num7)) {
                continue;
            }
            this.knownGalaxyLocations.push(galaxyLocation);
            found.push(galaxyLocation);
        }
        return found;
    }
}

// Port of Galaxy.4.cs DetermineGalaxyLocationsInRangeAtPoint (line 2012).
// Reads Galaxy's private location index (galaxy.ts is not edited in C1).
export function determineGalaxyLocationsInRangeAtPoint(galaxy: Galaxy, x: number, y: number, range: number, type: GalaxyLocationType): GalaxyLocation[] {
    const g = galaxy as unknown as {
        galaxyLocationIndex: GalaxyLocation[][][];
        resolveGalaxyLocationIndexes(x: number, y: number): { x: number; y: number };
    };
    const result: GalaxyLocation[] = [];
    if (g.galaxyLocationIndex.length === 0) return result;
    const point = g.resolveGalaxyLocationIndexes(x, y);
    for (const location of g.galaxyLocationIndex[point.x][point.y]) {
        const num = location.width / 2.0;
        const num2 = (num + range) * (num + range);
        if (type === GalaxyLocationType.Undefined || location.type === type) {
            const dx = x - (location.xpos + num);
            const dy = y - (location.ypos + location.height / 2.0);
            if (dx * dx + dy * dy < num2) {
                result.push(location);
            }
        }
    }
    return result;
}

// Port of Galaxy.4.cs MergeGalaxyMap(giver, receiver) (line 3700).
export function mergeGalaxyMap(galaxy: Galaxy, giver: EmpireVisibility, receiver: EmpireVisibility, onContact?: ContactFromGalaxyMapHook): void {
    receiver.resourceMap.mergeMap(giver.resourceMap.resourcesKnown);
    for (let i = 0; i < giver.systemVisibility.length; i++) {
        const status = giver.systemVisibility[i].status;
        if (status !== SystemVisibilityStatus.Explored && status !== SystemVisibilityStatus.Visible) {
            continue;
        }
        const status2 = receiver.systemVisibility[i].status;
        if (status2 !== SystemVisibilityStatus.Unexplored && status2 !== SystemVisibilityStatus.Undefined) {
            continue;
        }
        receiver.systemVisibility[i].status = SystemVisibilityStatus.Explored;
        const systemInfo = galaxy.systems[receiver.systemVisibility[i].systemStar.systemIndex];
        if (systemInfo !== undefined && onContact !== undefined) {
            onContact(receiver, systemInfo);
        }
    }
}

// Port of Galaxy.6.cs FindNearestUnexploredHabitat(x, y, empire, includeAsteroids)
// (line 4501): nearest habitat (squared distance from (int)x, (int)y) whose
// resources the empire doesn't know. The C# sector ring search returns the
// global nearest, so a linear scan in Habitats order gives the same result.
export function findNearestUnexploredHabitat(galaxy: Galaxy, x: number, y: number, empire: EmpireVisibility, includeAsteroids: boolean): Habitat | null {
    const ix = Math.trunc(x);
    const iy = Math.trunc(y);
    let best: Habitat | null = null;
    let distance = Number.MAX_VALUE;
    for (const habitat of galaxy.habitats) {
        if (includeAsteroids || habitat.category !== HabitatCategoryType.Asteroid) {
            const dx = ix - habitat.xpos;
            const dy = iy - habitat.ypos;
            const num = dx * dx + dy * dy;
            if (num < distance && !empire.resourceMap.checkResourcesKnown(habitat)) {
                best = habitat;
                distance = num;
            }
        }
    }
    return best;
}

// Port of Galaxy.7.cs SetEmpireExplorationAmount(empire, systemAmount)
// (line 4922): at game start, the empire knows the `systemAmount` systems
// nearest its capital (GenerateEmpire passes (int)(expansion * 3.5), capped).
export function setEmpireExplorationAmount(galaxy: Galaxy, empire: EmpireVisibility, capital: Habitat, systemAmount: number): void {
    const habitats = galaxy.habitats;
    for (const h of habitats) {
        if (h.parent === null) {
            empire.resourceMap.setResourcesKnown(h, false);
        }
    }
    const val = Math.min(systemAmount, galaxy.starCount);
    for (let j = 0; j < val; j++) {
        const habitat = findNearestUnexploredHabitat(galaxy, capital.xpos, capital.ypos, empire, true);
        if (habitat === null) {
            continue;
        }
        const habitat2 = galaxy.determineHabitatSystemStar(habitat);
        const num = habitats.indexOf(habitat2);
        if (num < 0) {
            continue;
        }
        empire.resourceMap.setResourcesKnown(habitats[num], true);
        const status = empire.checkSystemVisibilityStatus(habitat2.systemIndex);
        if (habitat2.category === HabitatCategoryType.GasCloud || habitat2.category === HabitatCategoryType.Asteroid) {
            if (status === SystemVisibilityStatus.Unexplored) {
                empire.setSystemVisibility(habitat2, SystemVisibilityStatus.Explored);
            }
            j--;
            continue;
        }
        let num2 = num + 1;
        while (num2 < habitats.length && habitats[num2].parent !== null) {
            empire.resourceMap.setResourcesKnown(habitats[num2], true);
            num2++;
        }
        if (status === SystemVisibilityStatus.Unexplored) {
            empire.setSystemVisibility(habitat2, SystemVisibilityStatus.Explored);
        }
    }
    for (const h of habitats) {
        if (h.parent === null && h.category !== HabitatCategoryType.GasCloud) {
            empire.resourceMap.setResourcesKnown(h, true);
        }
    }
}

// Port of Galaxy.9.cs SetSystemHabitatsExploration(systemHabitats, systemStar)
// (line 3331): when habitats are added to a system, every empire (normal,
// then pirate, then independent — pass them in that order) that has the
// system Explored/Visible learns them.
export function setSystemHabitatsExploration(empires: readonly EmpireVisibility[], systemHabitats: readonly Habitat[], systemStar: Habitat): void {
    for (const empire of empires) {
        const status = empire.systemVisibility[systemStar.systemIndex]?.status;
        if (status !== SystemVisibilityStatus.Explored && status !== SystemVisibilityStatus.Visible) {
            continue;
        }
        for (const h of systemHabitats) {
            empire.resourceMap.setResourcesKnown(h, true);
        }
    }
}
