// Independent traders + the small self-contained steps of the game-start Galaxy.DoTasks tick.
//
// Ported (C# DistantWorlds.Types):
//   Galaxy.7.cs  GenerateIndependentTraders (4354-4546), AssignIndependentTraderMissions (4548),
//                SelectPopularDesignCandidates (4698) + FindPopularDesigns (4663) +
//                AppendNonNullDesigns (4793)
//   Design.cs    Clone (1986)
//   Galaxy.1.cs  ReviewIndependentColonies (827), RemoveCompletedOrders (1047),
//                CancelExpiredOrders (1126), CancelContract (1086)
//   Galaxy.cs    IdentifyDisputedBases (3741), CheckEmpireTerritoryCanBuildAtLocation (3671),
//                CleanupInvalidShipsInIndexes (3782), GetEmpireById (2103)
//   Galaxy.3.cs  IsStellarObjectDockable (1799)
//   Empire.6.cs  UpdateEmpireRefuellingLocations (3845)
//   Empire.9.cs  IsObjectVisibleToThisEmpire(StellarObject[, bool, bool]) (3193/3198),
//                IsObjectVisibleToThisEmpireImprecise (3065), IsBuiltObjectVisibleToThisEmpire (3124),
//                FindShipOutsideSystemWithScanRange (3444/3449)
//
// Game-start tick (Start.2.cs 1108-1109): galaxy.ResetLastTouchTimes() sets
// _LastGalaxyHugeProcessTime = _LastGalaxyProcessTime = DateTime.MinValue (Galaxy.cs 3136-3137), so
// the first galaxy.DoTasks(false, playerEmpire, …) (Galaxy.cs 3055) runs, in order:
//   (Galaxy.cs 3075) if (ResetRandom) ReseedRandom();  — ResetRandom is false (set false at 3036).
//   (3079) ProcessPirateFleets(currentDateTime)         — Galaxy.PirateEmpires is empty at this
//          point (pirate factions are generated later on this very tick, in the long block) → no-op.
//   Huge block (3081-3089), tick/galaxyTick.ts galaxyDoTasks:
//     ReviewEmpireTerritory(onlySystems: false)  — queued on the ThreadPool in C# (3376).
//     SelectPopularDesignCandidates()            — ported here; feeds GenerateIndependentTraders.
//     DoGalaxyEvents()                           — pirates.ts doGalaxyEventsSuperPirates
//                                                  (Rnd.Next(0, 15) when disaster events are
//                                                  enabled and PiratePrevalence > 0).
//     CleanupInvalidShipsInIndexes()             — ported here (no Rnd; nothing destroyed yet).
//     ReseedRandom()                             — Galaxy.Rnd = new Random((int)DateTime.Now.Ticks)
//                                                  (Galaxy.cs 3033): every Rnd draw after this
//                                                  point on the tick is clock-seeded in C#. The TS
//                                                  port keeps the seeded galaxy.rnd stream (no reseed).
//   Long block (3091-…), tick/galaxyTick.ts galaxyDoTasks.
//
// Rnd: GenerateIndependentTraders is the only Rnd consumer here (see its comment).

import { scenarioQuery } from './scenario/hooks';
import { BuiltObject } from './builtObject';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { ResourceRef, type CargoList } from './cargo';
import { BuiltObjectRole, type DesignSpecification } from './data/designSpecifications';
import type { Race } from './data/races';
import { BuiltObjectStance, Design, getDesignsBySubRoles } from './design';
import { generateDesignFromSpec, resolveLegacySubRole } from './designGeneration';
import type { Empire } from './empire';
import type { Galaxy } from './galaxy';
import { REAL_SECONDS_IN_GALACTIC_YEAR } from './galaxyTime';
import { galaxyStarDate } from './tick/simTime';
import { DiplomaticRelationType, obtainDiplomaticRelation } from './diplomacy';
import { builtObjectMission, BuiltObjectMissionPriority, BuiltObjectMissionType } from './missions/mission';
import { assignMission } from './missions/assign';
import { determineFuelRequired } from './logistics/refuel';
import { fastFindNearestRefuellingPoint } from './movement';
import { builtObjectCompleteTeardown } from './combat/teardown';
import { empiresSharedVisibility } from './exploration';
import { obtainPirateRelation, PirateRelationType } from './pirateRelations';
import { Habitat, HabitatCategoryType } from './types';
import { SystemVisibilityStatus, THREAT_RANGE } from './visibility';

// ShipImageHelper.cs 43 / 25.
const STANDARD_SHIP_IMAGE_START_INDEX = 72;
const SHIP_SET_IMAGE_COUNT = 24;
// Galaxy.3.cs 5031: RetirementYears = 20.
const RETIREMENT_YEARS = 20;

// Galaxy.CurrentStarDate (Galaxy.cs): the galaxy clock (tick/simTime.ts).
function currentStarDate(galaxy: Galaxy): number {
    return galaxyStarDate(galaxy);
}

function isBuiltObject(o: Habitat | BuiltObject): o is BuiltObject {
    return o instanceof BuiltObject;
}

// ------------------------------------------------------------------------------------------
// Design.cs Clone (1986-2009). Copies the listed fields only (not Size / OptimizedDesign),
// ComponentList.Clone (new Component per id: the TS components are shared static definitions,
// so a shallow copy of the array is equivalent), then ReDefine. No Rnd.
// TODO(port): RepaitPriorityTemplateName (repair-priority templates) is not modeled on the TS Design.
export function cloneDesign(source: Design): Design {
    const design = new Design(source.name);
    design.imageScalingType = source.imageScalingType;
    design.imageScalingFactor = source.imageScalingFactor;
    design.dateCreated = source.dateCreated;
    design.empire = source.empire;
    design.role = source.role;
    design.subRole = source.subRole;
    design.stance = source.stance;
    design.fleeWhen = source.fleeWhen;
    design.tacticsStrongerShips = source.tacticsStrongerShips;
    design.tacticsWeakerShips = source.tacticsWeakerShips;
    design.tacticsInvasion = source.tacticsInvasion;
    design.pictureRef = source.pictureRef;
    design.buildCount = source.buildCount;
    design.components = source.components.slice();
    design.isObsolete = source.isObsolete;
    design.isManuallyCreated = source.isManuallyCreated;
    design.allowAutoRetrofit = source.allowAutoRetrofit;
    design.reDefine();
    return design;
}

// DesignSpecificationList.GetBySubRole (DesignSpecificationList.cs 98).
function getDesignSpecificationBySubRole(list: (DesignSpecification | null)[], subRole: BuiltObjectSubRole): DesignSpecification | null {
    for (const spec of list) {
        if (spec !== null && spec.subRole === subRole) return spec;
    }
    return null;
}

// RaceList.ResolvePlayableRaces (RaceList.cs 49).
function resolvePlayableRaces(races: Race[]): Race[] {
    const raceList: Race[] = [];
    for (let index = 0; index < races.length; index++) {
        if (races[index].playable) raceList.push(races[index]);
    }
    return raceList;
}

// ------------------------------------------------------------------------------------------
// Galaxy.7.cs FindPopularDesigns (4663). `state` carries the two C# ref ints. No Rnd.
function findPopularDesigns(galaxy: Galaxy, designs: Design[], empire: Empire, subRole: BuiltObjectSubRole, state: { lowestDesignIndex: number; lowestDesignAmount: number }): Design[] {
    // C#: DominantRace == ShakturiActualRace (set by the story's GenerateShakturi, Galaxy.8.cs 1361; null otherwise).
    const shakturiActualRace: Race | null = galaxy.shakturiActualRace;
    if (empire.dominantRace !== null && (empire.dominantRace.name.toLowerCase() === 'mechanoid' || empire.dominantRace === shakturiActualRace)) {
        return designs;
    }
    void galaxy;
    for (let i = 0; i < empire.designs.length; i++) {
        const design = empire.designs[i];
        if (design.isObsolete || design.subRole !== subRole || (design.buildCount <= state.lowestDesignAmount && (designs.length >= 3 || design.buildCount < state.lowestDesignAmount || design.optimizedDesign !== 0))) {
            continue;
        }
        if (designs.length < 3) {
            designs.push(design);
            state.lowestDesignAmount = 0;
        } else {
            designs[state.lowestDesignIndex] = design;
            state.lowestDesignAmount = 536870911;
        }
        for (let j = 0; j < designs.length; j++) {
            if (designs[j].buildCount < state.lowestDesignAmount) {
                state.lowestDesignAmount = designs[j].buildCount;
                state.lowestDesignIndex = j;
            }
        }
    }
    return designs;
}

// Galaxy.7.cs AppendNonNullDesigns (4793). No Rnd.
function appendNonNullDesigns(galaxy: Galaxy, masterDesigns: Design[], childDesigns: Design[]): Design[] {
    for (const childDesign of childDesigns) {
        if (childDesign != null) {
            const design = cloneDesign(childDesign);
            design.empire = galaxy.independentEmpire;
            if (design.role === BuiltObjectRole.Military) {
                design.stance = BuiltObjectStance.AttackUnallied;
            }
            design.buildCount = 0;
            design.dateCreated = currentStarDate(galaxy);
            design.reDefine();
            masterDesigns.push(design);
        }
    }
    return masterDesigns;
}

// Galaxy.7.cs SelectPopularDesignCandidates (4698): up to 3 most-built designs per sub-role
// across Galaxy.Empires, cloned for the independent empire into Galaxy.PopularDesigns. No Rnd.
// At game start every BuildCount is 0 (no ships exist before the first DoTasks), so each list is
// the first 3 non-obsolete, non-optimized designs of that sub-role in Empires/Designs order.
export function selectPopularDesignCandidates(galaxy: Galaxy): void {
    const subRoles = [BuiltObjectSubRole.SmallFreighter, BuiltObjectSubRole.MediumFreighter, BuiltObjectSubRole.Escort, BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Cruiser];
    const lists: Design[][] = [];
    for (const subRole of subRoles) {
        const state = { lowestDesignIndex: 0, lowestDesignAmount: 0 };
        let designList: Design[] = [];
        for (let i = 0; i < galaxy.empires.length; i++) {
            const empire = galaxy.empires[i];
            designList = findPopularDesigns(galaxy, designList, empire, subRole, state);
        }
        lists.push(designList);
    }
    galaxy.popularDesigns = [];
    for (const list of lists) {
        galaxy.popularDesigns = appendNonNullDesigns(galaxy, galaxy.popularDesigns, list);
    }
}

// ------------------------------------------------------------------------------------------
// Galaxy.1.cs ReviewIndependentColonies (827): Habitats with Population.Count > 0 owned by the
// independent empire, in Habitats order. No Rnd.
export function reviewIndependentColonies(galaxy: Galaxy): Habitat[] {
    const habitatList: Habitat[] = [];
    for (let i = 0; i < galaxy.habitats.length; i++) {
        if (galaxy.habitats[i].population.items.length > 0 && galaxy.habitats[i].empire === galaxy.independentEmpire) {
            habitatList.push(galaxy.habitats[i]);
        }
    }
    galaxy.independentColonies = habitatList;
    return habitatList;
}

// ------------------------------------------------------------------------------------------
// Visibility (Empire.9.cs). No Rnd.

// Empire.9.cs FindShipOutsideSystemWithScanRange(x, y, rangeModifier, includeLongRangeScanners,
// includeShipsOutsideSystems) (3449).
export function findShipOutsideSystemWithScanRange(galaxy: Galaxy, empire: Empire, x: number, y: number, rangeModifier: number, includeLongRangeScanners = true, includeShipsOutsideSystems = true): BuiltObject | null {
    if (includeLongRangeScanners && empire.longRangeScanners != null) {
        for (let i = 0; i < empire.longRangeScanners.length; i++) {
            const builtObject = empire.longRangeScanners[i] as BuiltObject;
            if (builtObject != null && builtObject.sensorLongRange > 0 && builtObject.currentSpeed === 0) {
                let num = builtObject.sensorLongRange * rangeModifier;
                num *= num;
                const num2 = galaxy.calculateDistanceSquared(x, y, builtObject.xpos, builtObject.ypos);
                if (num2 <= num) return builtObject;
            }
        }
    }
    if (includeShipsOutsideSystems) {
        // Mod layer (19h sensor fog, not a port): a scenario may shorten ordinary ship sensors toward (x, y); the
        // stationary long-range scanners above (listening posts) are not affected.
        if (galaxy.scenario !== null) rangeModifier = scenarioQuery(galaxy, 'scanRangeModifier', rangeModifier, { x, y });
        const galaxyIndex = galaxy.resolveIndex(x, y);
        const array = galaxy.builtObjectIndexGrid[galaxyIndex.x][galaxyIndex.y].slice();
        for (const builtObject2 of array) {
            if (
                builtObject2 == null ||
                builtObject2.nearestSystemStar !== null ||
                ((builtObject2.warpSpeed <= 0 || !(builtObject2.currentSpeed < builtObject2.warpSpeed)) && !(builtObject2.currentSpeed <= builtObject2.topSpeed)) ||
                builtObject2.empire !== empire
            ) {
                continue;
            }
            const num3 = Math.trunc(Math.max(THREAT_RANGE, Math.max(builtObject2.sensorLongRange, builtObject2.sensorProximityArrayRange)) * rangeModifier);
            // Galaxy.7.cs CheckWithinDistancePotentialUnmodified (757).
            if (Math.abs(x - builtObject2.xpos) < num3 || Math.abs(y - builtObject2.ypos) < num3) {
                const num4 = galaxy.calculateDistance(x, y, builtObject2.xpos, builtObject2.ypos);
                if (Math.trunc(num4) <= num3) return builtObject2;
            }
        }
    }
    return null;
}

// Empire.9.cs IsBuiltObjectVisibleToThisEmpire(builtObject, out visibleKnownPirateBase) (3124).
function isBuiltObjectVisibleToThisEmpire(galaxy: Galaxy, empire: Empire, builtObject: BuiltObject | null): boolean {
    if (builtObject !== null) {
        if (empire.pirateEmpireBaseHabitat !== null && builtObject.pirateEmpireId > 0 && builtObject.pirateEmpireId === empire.empireId) {
            return true;
        }
        if (builtObject.nearestSystemStar !== null) {
            if (empire.visibility.checkSystemVisible(builtObject.nearestSystemStar.systemIndex)) return true;
        }
        for (let i = 0; i < empire.longRangeScanners.length; i++) {
            const builtObject2 = empire.longRangeScanners[i] as BuiltObject;
            if (builtObject2 != null) {
                const num = Math.fround(builtObject2.sensorLongRange) * builtObject.stealth;
                const num2 = num * num;
                const num3 = galaxy.calculateDistanceSquared(builtObject2.xpos, builtObject2.ypos, builtObject.xpos, builtObject.ypos);
                if (num3 <= num2) return true;
            }
        }
        // Empire.9.cs 3159-3180: the long-range scanners of the empires we share visibility with.
        const sharedVisibility = empiresSharedVisibility(galaxy, empire);
        if (sharedVisibility.length > 0) {
            for (let j = 0; j < sharedVisibility.length; j++) {
                const empire2 = sharedVisibility[j];
                if (empire2 == null) continue;
                for (let k = 0; k < empire2.longRangeScanners.length; k++) {
                    const builtObject3 = empire2.longRangeScanners[k] as BuiltObject;
                    if (builtObject3 != null) {
                        const num4 = Math.fround(builtObject3.sensorLongRange) * builtObject.stealth;
                        const num5 = num4 * num4;
                        const num6 = galaxy.calculateDistanceSquared(builtObject3.xpos, builtObject3.ypos, builtObject.xpos, builtObject.ypos);
                        if (num6 <= num5) return true;
                    }
                }
            }
        }
        if (empire.knownPirateBases != null && empire.knownPirateBases.includes(builtObject)) {
            return true;
        }
    }
    return false;
}

// Empire.9.cs IsObjectVisibleToThisEmpireImprecise(StellarObject) (3065) for Habitat / BuiltObject.
// TODO(port): the Fighter branch (fighters not ported).
export function isObjectVisibleToThisEmpireImprecise(galaxy: Galaxy, empire: Empire, objectToTest: Habitat | BuiltObject): boolean {
    if (objectToTest.empire === empire) return true;
    // Empire.9.cs 3071: _EmpiresViewable (intelligence missions) / _EmpiresSharedVisibility (treaties).
    const objectEmpire = objectToTest.empire as Empire | null;
    if (empire.empiresViewable.includes(objectEmpire as Empire) || empiresSharedVisibility(galaxy, empire).includes(objectEmpire as Empire)) return true;
    if (!isBuiltObject(objectToTest)) {
        const habitat = objectToTest;
        if (empire.visibility.checkSystemVisible(habitat.systemIndex)) return true;
        for (let i = 0; i < empire.longRangeScanners.length; i++) {
            const builtObject = empire.longRangeScanners[i] as BuiltObject;
            const num = builtObject.sensorLongRange * builtObject.sensorLongRange;
            const num2 = galaxy.calculateDistanceSquared(builtObject.xpos, builtObject.ypos, objectToTest.xpos, objectToTest.ypos);
            if (num2 <= num) return true;
        }
        return false;
    }
    return isBuiltObjectVisibleToThisEmpire(galaxy, empire, objectToTest);
}

// Empire.9.cs IsObjectVisibleToThisEmpire(objectToTest, includeLongRangeScanners,
// includeShipsOutsideSystems) (3198; the 1-arg overload 3193 passes true, true).
export function isObjectVisibleToThisEmpire(galaxy: Galaxy, empire: Empire, objectToTest: Habitat | BuiltObject, includeLongRangeScanners = true, includeShipsOutsideSystems = true): boolean {
    if (galaxy.scenario !== null && scenarioQuery(galaxy, 'objectVisibleToAll', false, { empire, object: objectToTest })) return true; // mod layer (19a beacon)
    const flag = isObjectVisibleToThisEmpireImprecise(galaxy, empire, objectToTest);
    if (flag) return flag;
    // StellarObject.Stealth (StellarObject.cs 32, float, default 1f; Habitats keep the default).
    const stealth = isBuiltObject(objectToTest) ? objectToTest.stealth : 1;
    const builtObject = findShipOutsideSystemWithScanRange(galaxy, empire, Math.trunc(objectToTest.xpos), Math.trunc(objectToTest.ypos), stealth, includeLongRangeScanners, includeShipsOutsideSystems);
    if (builtObject !== null) return true;
    // Empire.9.cs 3213-3224: a ship of an empire we share visibility with sees it.
    const sharedVisibility = empiresSharedVisibility(galaxy, empire);
    if (sharedVisibility.length > 0) {
        for (let i = 0; i < sharedVisibility.length; i++) {
            const empire2 = sharedVisibility[i];
            const builtObject2 = findShipOutsideSystemWithScanRange(galaxy, empire2, Math.trunc(objectToTest.xpos), Math.trunc(objectToTest.ypos), stealth, includeLongRangeScanners, includeShipsOutsideSystems);
            if (builtObject2 !== null) return true;
        }
    }
    return false;
}

// ------------------------------------------------------------------------------------------
// Galaxy.7.cs GenerateIndependentTraders (4354-4546).
//
// Count: num = Σ Population.TotalAmount over IndependentColonies; val = min(num / 20000000,
// IndependentColonies.Count * 15); num2 = val - IndependentEmpire.PrivateBuiltObjects.CountNonPirates().
// Designs: PopularDesigns with WarpSpeed > 5000 split into small / medium freighters; an empty
// list falls back to the independent empire's own designs of that sub-role, else one
// GenerateDesignFromSpec(spec, 0.0) per playable race other than the player's (a design is kept
// only when that race's picture family differs from the player's).
//
// Rnd, in order:
//   design fallback (only when a list is empty): GenerateDesignFromSpec per race (its Rnd:
//   GenerateDesignName, designNames.ts).
//   per trader m < num2:
//     Next(0, 3); ==1 → Next(0, medium.Count) (if medium non-empty); else Next(0, small.Count)
//       (if small non-empty). No design → next m (no further draws).
//     Next(0, IndependentColonies.Count) = start index; then, for the first colony (from start,
//     wrapping to 0) NOT visible to the player empire:
//       SelectRandomUniqueStandardShipName: Next(0,127), Next(0,125), Next(0,7) [, Next(0,3)]
//       SelectRandomHeading: NextDouble
//       (AddBuiltObjectToGalaxy with offsetLocationFromParent false: no Rnd)
//       SelectRelativeParkingPoint: NextDouble, Next(0,2), NextDouble
//     (every colony visible → no trader, no further draws).
export function generateIndependentTraders(galaxy: Galaxy): BuiltObject[] {
    const created: BuiltObject[] = [];
    const independentEmpire = galaxy.independentEmpire!;
    const independentColonies = galaxy.independentColonies;
    let num = 0;
    for (let i = 0; i < independentColonies.length; i++) {
        const habitat = independentColonies[i];
        if (habitat.population.items.length > 0) {
            num += habitat.population.totalAmount;
        }
    }
    // C# long division.
    let val = Math.trunc(num / 20000000);
    val = Math.min(val, independentColonies.length * 15);
    // BuiltObjectList.CountNonPirates (BuiltObjectList.cs 626).
    let countNonPirates = 0;
    for (const bo of independentEmpire.privateBuiltObjects) {
        if (bo != null && bo.pirateEmpireId <= 0) countNonPirates++;
    }
    const num2 = val - countNonPirates;
    if (num2 < 0) {
        return created;
    }
    const designList: Design[] = [];
    const designList2: Design[] = [];
    for (let j = 0; j < galaxy.popularDesigns.length; j++) {
        const design = galaxy.popularDesigns[j];
        if (design.warpSpeed > 5000) {
            if (design.subRole === BuiltObjectSubRole.SmallFreighter) {
                designList.push(design);
            } else if (design.subRole === BuiltObjectSubRole.MediumFreighter) {
                designList2.push(design);
            }
        }
    }
    if (designList.length <= 0) {
        fillFallbackFreighterDesigns(galaxy, independentEmpire, BuiltObjectSubRole.SmallFreighter, designList);
    }
    if (designList2.length <= 0) {
        fillFallbackFreighterDesigns(galaxy, independentEmpire, BuiltObjectSubRole.MediumFreighter, designList2);
    }
    const playerEmpire = galaxy.playerEmpire!;
    for (let m = 0; m < num2; m++) {
        let design4: Design | null = null;
        if (galaxy.rnd.next(0, 3) === 1) {
            if (designList2.length > 0) {
                const index = galaxy.rnd.next(0, designList2.length);
                design4 = designList2[index];
            }
        } else if (designList.length > 0) {
            const index2 = galaxy.rnd.next(0, designList.length);
            design4 = designList[index2];
        }
        if (design4 === null) {
            continue;
        }
        let flag = false;
        const num5 = galaxy.rnd.next(0, independentColonies.length);
        for (let n = num5; n < independentColonies.length; n++) {
            if (!isObjectVisibleToThisEmpire(galaxy, playerEmpire, independentColonies[n])) {
                created.push(createIndependentTrader(galaxy, independentEmpire, design4, independentColonies[n]));
                flag = true;
                break;
            }
        }
        if (flag) {
            continue;
        }
        for (let num6 = 0; num6 < num5; num6++) {
            if (!isObjectVisibleToThisEmpire(galaxy, playerEmpire, independentColonies[num6])) {
                created.push(createIndependentTrader(galaxy, independentEmpire, design4, independentColonies[num6]));
                flag = true;
                break;
            }
        }
    }
    return created;
}

// Galaxy.7.cs 4390-4433 (small freighters) / 4434-4477 (medium freighters): identical blocks.
function fillFallbackFreighterDesigns(galaxy: Galaxy, independentEmpire: Empire, subRole: BuiltObjectSubRole, target: Design[]): void {
    let designList3: Design[] = [];
    if (independentEmpire.designs != null) {
        designList3 = getDesignsBySubRoles(independentEmpire.designs, [subRole]);
    }
    if (designList3.length > 0) {
        target.push(...designList3);
    } else {
        const bySubRole = getDesignSpecificationBySubRole(independentEmpire.designSpecifications, subRole);
        if (bySubRole !== null) {
            const playerEmpire = galaxy.playerEmpire;
            const raceList: Race[] = [];
            raceList.push(...resolvePlayableRaces(galaxy.races));
            // C# derefs PlayerEmpire here (raceList.Remove(PlayerEmpire.DominantRace)).
            const removeIndex = raceList.indexOf(playerEmpire!.dominantRace as Race);
            if (removeIndex >= 0) raceList.splice(removeIndex, 1);
            for (let k = 0; k < raceList.length; k++) {
                const design2 = generateDesignFromSpec(galaxy, independentEmpire, bySubRole, 0.0, currentStarDate(galaxy));
                if (design2 === null) {
                    continue;
                }
                let num3 = 0;
                const race = raceList[k];
                if (playerEmpire === null || playerEmpire.dominantRace === null || race == null || race.designsPictureFamilyIndex !== playerEmpire.dominantRace.designsPictureFamilyIndex) {
                    if (race != null) {
                        num3 = race.designsPictureFamilyIndex;
                    }
                    design2.pictureRef = STANDARD_SHIP_IMAGE_START_INDEX + num3 * SHIP_SET_IMAGE_COUNT + (resolveLegacySubRole(design2.subRole) - 1);
                    independentEmpire.designs.push(design2);
                    target.push(design2);
                }
            }
        }
    }
}

// The trader-creation body shared (verbatim) by both colony loops (Galaxy.7.cs 4498-4516 / 4525-4543).
function createIndependentTrader(galaxy: Galaxy, independentEmpire: Empire, design4: Design, colony: Habitat): BuiltObject {
    design4.buildCount++;
    let text = design4.name + ' ' + String(design4.buildCount).padStart(3, '0');
    text = galaxy.selectRandomUniqueStandardShipName(colony);
    const builtObject = new BuiltObject(design4, text, galaxy, true);
    builtObject.empire = independentEmpire;
    builtObject.heading = galaxy.selectRandomHeading();
    builtObject.targetHeading = builtObject.heading;
    builtObject.reDefine();
    builtObject.currentFuel = builtObject.fuelCapacity;
    independentEmpire.addBuiltObjectToGalaxy(builtObject, colony, false, false);
    const p = galaxy.selectRelativeParkingPoint();
    builtObject.parentOffsetX = p.x;
    builtObject.parentOffsetY = p.y;
    builtObject.xpos = colony.xpos + p.x;
    builtObject.ypos = colony.ypos + p.y;
    return builtObject;
}

// ------------------------------------------------------------------------------------------
// Galaxy.7.cs AssignIndependentTraderMissions (4548). No Rnd in the ported part.
// At game start it is a no-op: every trader was just built (DateBuilt = CurrentStarDate > the
// retirement cutoff), RetireForNextMission / RefuelForNextMission are false, Mission is null.
export function assignIndependentTraderMissions(galaxy: Galaxy): void {
    const independentEmpire = galaxy.independentEmpire!;
    const num = currentStarDate(galaxy) - RETIREMENT_YEARS * REAL_SECONDS_IN_GALACTIC_YEAR * 1000;
    const builtObjectList: BuiltObject[] = [];
    for (let i = 0; i < independentEmpire.privateBuiltObjects.length; i++) {
        const builtObject = independentEmpire.privateBuiltObjects[i];
        const mission = builtObjectMission(builtObject.mission);
        if (builtObject.pirateEmpireId > 0 || builtObject.role !== BuiltObjectRole.Freight || (mission !== null && mission.type !== BuiltObjectMissionType.Undefined)) {
            continue;
        }
        if (builtObject.retireForNextMission || builtObject.dateBuilt <= num) {
            if (!isObjectVisibleToThisEmpire(galaxy, galaxy.playerEmpire!, builtObject)) {
                builtObjectList.push(builtObject);
            }
        } else {
            if (!builtObject.refuelForNextMission) {
                continue;
            }
            // Galaxy.7.cs 4570-4588: send it to the nearest refuelling point (a BuiltObject or a Habitat target).
            const fuelTypes = determineFuelRequired(builtObject);
            const stellarObject = fastFindNearestRefuellingPoint(galaxy, builtObject.xpos, builtObject.ypos, fuelTypes, builtObject.actualEmpire, builtObject);
            if (stellarObject !== null) {
                if (stellarObject instanceof BuiltObject) {
                    const target = stellarObject;
                    assignMission(galaxy, builtObject, BuiltObjectMissionType.Refuel, target, null, BuiltObjectMissionPriority.Normal);
                    builtObject.refuelForNextMission = false;
                } else if (stellarObject instanceof Habitat) {
                    const target2 = stellarObject;
                    assignMission(galaxy, builtObject, BuiltObjectMissionType.Refuel, target2, null, BuiltObjectMissionPriority.Normal);
                    builtObject.refuelForNextMission = false;
                }
            }
        }
    }
    // Galaxy.7.cs 4591-4594: item.CompleteTeardown(this).
    for (const item of builtObjectList) {
        builtObjectCompleteTeardown(galaxy, item);
    }
}

// ------------------------------------------------------------------------------------------
// Orders (Galaxy.1.cs): the Order / Contract model and RemoveCompletedOrders / CancelExpiredOrders / CancelContract
// moved to logistics/ (M4d); re-exported here for existing callers.
export { cancelExpiredOrders, removeCompletedOrders } from './logistics/orders';
export { cancelContract } from './logistics/contracts';
export type { Order as GalaxyOrder } from './logistics/orders';
export type { Contract as GalaxyContract } from './logistics/contracts';

// ------------------------------------------------------------------------------------------
// Galaxy.cs CheckEmpireTerritoryCanBuildAtLocation (3671). No Rnd.
export function checkEmpireTerritoryCanBuildAtLocation(galaxy: Galaxy, empire: Empire, x: number, y: number): boolean {
    const num = galaxy.empireTerritory.checkLocationOwnership(galaxy, x, y);
    if (num >= 0 && num !== empire.empireId) {
        const byEmpireId = galaxy.empires.find((e) => e.empireId === num) ?? null;
        if (byEmpireId !== null) {
            if (empire.pirateEmpireBaseHabitat !== null || byEmpireId.pirateEmpireBaseHabitat !== null) {
                return true;
            }
            // Galaxy.cs 3681-3685 (ObtainDiplomaticRelation creates a NotMet relation on first contact).
            const diplomaticRelation = obtainDiplomaticRelation(byEmpireId, empire);
            if (diplomaticRelation != null && diplomaticRelation.miningRightsToOther) return true;
        }
        return false;
    }
    return true;
}

// Galaxy.cs IdentifyDisputedBases (3741). No Rnd. At game start no bases exist yet (state ships /
// bases are created after the first DoTasks), so every DisputedBases list ends empty.
export function identifyDisputedBases(galaxy: Galaxy, checkAtHabitat: (galaxy: Galaxy, empire: Empire, habitat: Habitat) => boolean): void {
    for (let i = 0; i < galaxy.empires.length; i++) {
        const empire = galaxy.empires[i];
        if (empire == null || !empire.active) {
            continue;
        }
        if (empire.disputedBases === null) {
            empire.disputedBases = [];
        }
        empire.disputedBases.length = 0;
        for (const list of [empire.builtObjects, empire.privateBuiltObjects]) {
            for (let j = 0; j < list.length; j++) {
                const builtObject = list[j];
                if (builtObject.role === BuiltObjectRole.Base && !builtObject.hasBeenDestroyed) {
                    const ok = builtObject.parentHabitat === null ? checkEmpireTerritoryCanBuildAtLocation(galaxy, empire, builtObject.xpos, builtObject.ypos) : checkAtHabitat(galaxy, empire, builtObject.parentHabitat);
                    if (!ok) {
                        empire.disputedBases.push(builtObject);
                    }
                }
            }
        }
    }
}

// ------------------------------------------------------------------------------------------
// Galaxy.3.cs IsStellarObjectDockable (1799). No Rnd (ObtainPirateRelation may add a relation).
export function isStellarObjectDockable(galaxy: Galaxy, stellarObject: Habitat | BuiltObject, dockingEmpire: Empire | null): boolean {
    if (!isBuiltObject(stellarObject)) {
        const habitat = stellarObject;
        if (habitat.population == null || habitat.population.items.length === 0) {
            return false;
        }
    }
    const empire = stellarObject.empire as Empire | null;
    if (empire !== null && dockingEmpire !== null) {
        if (empire.pirateEmpireBaseHabitat !== null && dockingEmpire !== empire && dockingEmpire !== galaxy.independentEmpire) {
            return false;
        }
        if (empire === galaxy.independentEmpire && dockingEmpire.pirateEmpireBaseHabitat !== null) {
            return true;
        }
        if (dockingEmpire === galaxy.independentEmpire && empire.pirateEmpireBaseHabitat !== null) {
            return true;
        }
        if (dockingEmpire.pirateEmpireBaseHabitat !== null || empire.pirateEmpireBaseHabitat !== null) {
            const pirateRelation = obtainPirateRelation(dockingEmpire, empire);
            if (pirateRelation.type !== PirateRelationType.Protection) {
                return false;
            }
        } else {
            // Galaxy.3.cs 1832-1838: no docking with an empire we have trade sanctions against or are at war with.
            const diplomaticRelation = dockingEmpire.diplomaticRelations.byEmpire(empire);
            if (diplomaticRelation != null && (diplomaticRelation.type === DiplomaticRelationType.TradeSanctions || diplomaticRelation.type === DiplomaticRelationType.War)) {
                return false;
            }
        }
    } else if (empire === null) {
        return false;
    }
    if (isBuiltObject(stellarObject)) {
        if (stellarObject.isBlockaded) return false;
    } else {
        // Galaxy.3.cs 1851-1857.
        if (stellarObject.isBlockaded) return false;
    }
    return true;
}

// Empire.6.cs UpdateEmpireRefuellingLocations (3845). No Rnd.
export function updateEmpireRefuellingLocations(galaxy: Galaxy, empire: Empire): void {
    const stellarObjectList: (Habitat | BuiltObject)[] = [];
    const stellarObjectList2: (Habitat | BuiltObject)[] = [];
    for (let i = 0; i < empire.resupplyShips.length; i++) {
        const builtObject = empire.resupplyShips[i] as BuiltObject;
        if (builtObject != null && builtObject.isFunctional && builtObject.isDeployed && !builtObject.hasBeenDestroyed) {
            stellarObjectList.push(builtObject);
        }
    }
    for (let j = 0; j < empire.refuellingDepots.length; j++) {
        const builtObject2 = empire.refuellingDepots[j] as BuiltObject;
        if (builtObject2 != null && !builtObject2.hasBeenDestroyed && (builtObject2.subRole !== BuiltObjectSubRole.ResupplyShip || builtObject2.isDeployed) && builtObject2.parentHabitat === null && builtObject2.isFunctional) {
            stellarObjectList.push(builtObject2);
        }
    }
    for (let k = 0; k < galaxy.systems.length; k++) {
        const systemInfo = galaxy.systems[k];
        if (systemInfo == null || systemInfo.systemStar == null) {
            continue;
        }
        let systemVisibilityStatus = SystemVisibilityStatus.Visible;
        if (empire !== galaxy.independentEmpire) {
            systemVisibilityStatus = empire.visibility.checkSystemVisibilityStatus(systemInfo.systemStar.systemIndex);
        }
        if (systemVisibilityStatus !== SystemVisibilityStatus.Explored && systemVisibilityStatus !== SystemVisibilityStatus.Visible) {
            continue;
        }
        // C#: Category == HabitatCategoryType.GasCloud.
        if (systemInfo.systemStar.category === HabitatCategoryType.GasCloud) {
            if (systemInfo.systemStar.basesAtHabitat.length <= 0) {
                continue;
            }
            for (let l = 0; l < systemInfo.systemStar.basesAtHabitat.length; l++) {
                const builtObject3 = systemInfo.systemStar.basesAtHabitat[l];
                if (builtObject3 != null && !builtObject3.hasBeenDestroyed && builtObject3.isRefuellingDepot && builtObject3.empire !== null) {
                    let flag = true;
                    if (empire.pirateEmpireBaseHabitat === null && empire !== galaxy.independentEmpire) {
                        flag = isObjectVisibleToThisEmpire(galaxy, empire, builtObject3, true, false);
                    }
                    if (flag && isStellarObjectDockable(galaxy, builtObject3, empire)) {
                        stellarObjectList2.push(builtObject3);
                    }
                }
            }
            continue;
        }
        // Empire.6.cs 3905 systemInfo.Habitats: no star. Perf: walked in place, skipping the star (planetsOf's filtered
        // copy: same habitats, same order).
        const sysHabitats = systemInfo.habitats;
        const sysStar = systemInfo.systemStar;
        for (let m = 0; m < sysHabitats.length; m++) {
            const habitat = sysHabitats[m];
            if (habitat === sysStar || habitat == null) {
                continue;
            }
            if (habitat.basesAtHabitat.length > 0) {
                for (let n = 0; n < habitat.basesAtHabitat.length; n++) {
                    const builtObject4 = habitat.basesAtHabitat[n];
                    if (builtObject4 != null && !builtObject4.hasBeenDestroyed && builtObject4.isRefuellingDepot && builtObject4.empire !== null && isStellarObjectDockable(galaxy, builtObject4, empire)) {
                        let flag2 = true;
                        if (
                            empire !== galaxy.independentEmpire &&
                            builtObject4.subRole !== BuiltObjectSubRole.SmallSpacePort &&
                            builtObject4.subRole !== BuiltObjectSubRole.MediumSpacePort &&
                            builtObject4.subRole !== BuiltObjectSubRole.LargeSpacePort
                        ) {
                            flag2 = isObjectVisibleToThisEmpire(galaxy, empire, builtObject4, true, false);
                        }
                        if (flag2) {
                            stellarObjectList2.push(builtObject4);
                        }
                    }
                }
            }
            if (habitat.isRefuellingDepot && habitat.population.items.length > 0 && habitat.empire !== null && isStellarObjectDockable(galaxy, habitat, empire)) {
                stellarObjectList2.push(habitat);
            }
        }
    }
    empire.refuellingLocations = stellarObjectList2;
    empire.refuellingLocationsMilitaryOnly = stellarObjectList;
}

// ------------------------------------------------------------------------------------------
// Galaxy.cs CleanupInvalidShipsInIndexes (3782). No Rnd.
export function cleanupInvalidShipsInIndexes(galaxy: Galaxy): void {
    for (let i = 0; i < galaxy.indexMaxX; i++) {
        for (let j = 0; j < galaxy.indexMaxY; j++) {
            const cell = galaxy.builtObjectIndexGrid[i][j];
            const builtObjectList: BuiltObject[] = [];
            for (let k = 0; k < cell.length; k++) {
                const builtObject = cell[k];
                if (builtObject != null && builtObject.hasBeenDestroyed) {
                    builtObjectList.push(builtObject);
                }
            }
            for (let l = 0; l < builtObjectList.length; l++) {
                let idx = cell.indexOf(builtObjectList[l]);
                while (idx >= 0) {
                    cell.splice(idx, 1);
                    idx = cell.indexOf(builtObjectList[l]);
                }
            }
        }
    }
}
