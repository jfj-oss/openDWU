// Starting ships (task M3c). Ports of
//   Galaxy.8.cs CreateStateShips (921-956), CreatePrivateShips (957-999),
//   FillShipsWithTroops (1001-1036), Galaxy.8.cs GenerateNewTroop(name, type, strength,
//   empire, race, applyBonusFactors) (20-100, via the 5-arg overload Galaxy.7.cs 5559),
//   Galaxy.4.cs CalculateTroopMaintenanceMultiplier (224).
// The pieces they call live on the classes they belong to:
//   Galaxy (galaxy.ts): GetNextBuiltObjectID, SelectRelativeParkingPoint,
//     GenerateBuiltObjectName / SelectUniqueBuiltObjectName (+ name lists),
//     FindNearestBuiltObject overloads, BuiltObjectIndex.
//   Empire (empire.ts): AddBuiltObjectToGalaxy, SelectRandomColony, ReviewTroopTypes,
//     GenerateTroopDescription.
//   BuiltObject (builtObject.ts): SetTroopLoadoutsFromPolicy, TroopCapacityRemaining.
//
// Rnd per ship created by CreateStateShips / CreatePrivateShips (exact order):
//   1. GenerateBuiltObjectName(design)            — unique-name sub-roles only (see below)
//   2. SelectRandomHeading                        — NextDouble
//   3. SelectRelativeParkingPoint                 — NextDouble, Next(0,2), NextDouble
//   4. SelectRandomColony                         — Next(0, Colonies.Count)
//   5. GenerateBuiltObjectName(design, habitat)   — unique-name sub-roles only
//   (AddBuiltObjectToGalaxy draws nothing here: offsetLocationFromParent is false.)
// GenerateBuiltObjectName draws only when it falls through to SelectUniqueBuiltObjectName:
//   standard ships (explorer, freighters, colony, passenger, construction, mining):
//     Next(0,127), Next(0,125), Next(0,7) [+ Next(0,3) if < 2, habitat != null and the
//     system-star name passes the checks — never for the first, habitat-less call];
//   Cruiser / CapitalShip after the first of a design (BuildCount > 1), every Carrier,
//   every ResupplyShip: Next(0,76), Next(0,162), Next(0,5) [+ Next(0,3) likewise];
//   Escort / Frigate / Destroyer / TroopTransport and the first Cruiser / CapitalShip of a
//   design use "<design name> 001" / "<design name>" — no Rnd.

import { BuiltObject } from './builtObject';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { Troop, TroopType } from './cargo';
import type { Race } from './data/races';
import { findNewestCanBuildFullEvaluate } from './designGeneration';
import type { Empire } from './empire';
import type { Galaxy } from './galaxy';

// Galaxy.4.cs CalculateTroopMaintenanceMultiplier(race) (224). Returns float.
export function calculateTroopMaintenanceMultiplier(race: Race | null): number {
    let result = 1;
    if (race !== null && race.troopMaintenanceSavings > 0) {
        result = Math.fround(1.0 - race.troopMaintenanceSavings / 100.0);
    }
    return result;
}

// C# (int)(float): truncation toward zero (values here stay well inside int range).
const fi = (v: number): number => Math.trunc(Math.fround(v));

// Galaxy.8.cs GenerateNewTroop(name, troopType, naturalStrength, empire, race,
// applyBonusFactors = true) (20). No Rnd.
export function generateNewTroop(name: string, troopType: TroopType, naturalStrength: number, empire: Empire | null, race: Race | null, applyBonusFactors = true): Troop {
    const f = Math.fround;
    let attackStrength = 100;
    let defendStrength = 100;
    let size = 100;
    let num = 1;
    switch (troopType) {
        case TroopType.Infantry:
            if (applyBonusFactors && empire !== null) {
                attackStrength = fi(f(naturalStrength) * empire.troopAttackStrengthBonusFactorInfantry);
                defendStrength = fi(f(naturalStrength) * empire.troopDefendStrengthBonusFactorInfantry);
            } else {
                attackStrength = naturalStrength;
                defendStrength = naturalStrength;
            }
            size = 100;
            num = 1;
            break;
        case TroopType.Armored:
            if (applyBonusFactors && empire !== null) {
                attackStrength = fi(f(f(naturalStrength) * empire.troopAttackStrengthBonusFactorArmored) * 3);
                defendStrength = fi(f(f(naturalStrength) * empire.troopDefendStrengthBonusFactorArmored) * 1.5);
            } else {
                attackStrength = fi(f(naturalStrength) * 3);
                defendStrength = fi(f(naturalStrength) * 1.5);
            }
            size = 200;
            num = 2;
            break;
        case TroopType.Artillery:
            if (applyBonusFactors && empire !== null) {
                attackStrength = fi(f(f(naturalStrength) * empire.troopAttackStrengthBonusFactorArtillery) * 0.5);
                // (int)((double)(float)naturalStrength * 1.0 * 0.75)
                defendStrength = Math.trunc(f(naturalStrength) * 1.0 * 0.75);
            } else {
                attackStrength = fi(f(naturalStrength) * 0.5);
                defendStrength = fi(f(naturalStrength) * 0.75);
            }
            size = 400;
            num = 4;
            break;
        case TroopType.SpecialForces:
            if (applyBonusFactors && empire !== null) {
                attackStrength = fi(f(f(naturalStrength) * empire.troopAttackStrengthBonusFactorSpecialForces) * 2);
                defendStrength = fi(f(naturalStrength) * empire.troopDefendStrengthBonusFactorSpecialForces);
            } else {
                attackStrength = fi(f(naturalStrength) * 2);
                defendStrength = naturalStrength;
            }
            size = 100;
            num = 2;
            break;
    }
    const troop = new Troop(name, troopType, attackStrength, defendStrength, size, 100, empire, race);
    const num2 = calculateTroopMaintenanceMultiplier(race);
    troop.maintenanceMultiplier = f(num2 * num);
    if (race !== null) {
        troop.pictureRef = race.pictureIndex; // Race.PictureRef ← races.txt PictureIndex
    }
    return troop;
}

// Galaxy.8.cs CreateStateShips(galaxy, empire) (921-956). Rnd: see the header.
export function createStateShips(galaxy: Galaxy, empire: Empire): void {
    const projections = empire.stateForceStructureProjections;
    if (projections === null) {
        // C# would throw (foreach over a null list); ProjectForceStructure always runs first.
        throw new Error('CreateStateShips: StateForceStructureProjections is null');
    }
    for (const stateForceStructureProjection of projections) {
        const design = findNewestCanBuildFullEvaluate(empire.designs, stateForceStructureProjection.subRole, null);
        if (design !== null && stateForceStructureProjection.amount > 0) {
            let num = stateForceStructureProjection.amount;
            if (galaxy.startingAge === 0 && empire.colonies.length === 1 && stateForceStructureProjection.subRole !== BuiltObjectSubRole.ConstructionShip) {
                num = Math.max(1, Math.trunc(num / 3));
                empire.stateMoney += 1000.0;
            }
            for (let i = 0; i < num; i++) {
                createStartingShip(galaxy, empire, design, true);
            }
        }
    }
    projections.clear();
}

// Galaxy.8.cs CreatePrivateShips(galaxy, empire) (957-999). Rnd: see the header.
export function createPrivateShips(galaxy: Galaxy, empire: Empire): void {
    const projections = empire.privateForceStructureProjections;
    if (projections === null) {
        throw new Error('CreatePrivateShips: PrivateForceStructureProjections is null');
    }
    for (const privateForceStructureProjection of projections) {
        const design = findNewestCanBuildFullEvaluate(empire.designs, privateForceStructureProjection.subRole, null);
        if (design === null) {
            continue;
        }
        switch (privateForceStructureProjection.subRole) {
            case BuiltObjectSubRole.SmallFreighter:
            case BuiltObjectSubRole.MediumFreighter:
            case BuiltObjectSubRole.LargeFreighter:
                privateForceStructureProjection.amount = Math.trunc(privateForceStructureProjection.amount * 0.6);
                break;
        }
        if (privateForceStructureProjection.amount > 0) {
            for (let i = 0; i < privateForceStructureProjection.amount; i++) {
                createStartingShip(galaxy, empire, design, false);
            }
        }
    }
    projections.clear();
}

// The loop body shared (verbatim) by CreateStateShips (939-953) and CreatePrivateShips
// (978-992); only isStateOwned differs.
function createStartingShip(galaxy: Galaxy, empire: Empire, design: import('./design').Design, isStateOwned: boolean): BuiltObject {
    const purchasePrice = design.calculateCurrentPurchasePrice(galaxy);
    design.buildCount++;
    const builtObject = new BuiltObject(design, galaxy.generateBuiltObjectName(design), galaxy, true);
    builtObject.purchasePrice = purchasePrice;
    builtObject.reDefine();
    builtObject.currentFuel = builtObject.fuelCapacity;
    builtObject.currentShields = builtObject.shieldsCapacity;
    builtObject.heading = galaxy.selectRandomHeading();
    builtObject.targetHeading = builtObject.heading;
    const p = galaxy.selectRelativeParkingPoint();
    const habitat = empire.selectRandomColony();
    builtObject.name = galaxy.generateBuiltObjectName(design, habitat);
    builtObject.nearestSystemStar = galaxy.determineHabitatSystemStar(habitat);
    empire.addBuiltObjectToGalaxy(builtObject, habitat, false, isStateOwned, Math.trunc(p.x), Math.trunc(p.y));
    return builtObject;
}

// Galaxy.7.cs ConditionCheckLimit(condition, maximumIterations, ref iterationCount) (569).
function conditionCheckLimit(condition: boolean, maximumIterations: number, iterationCount: { value: number }): boolean {
    if (iterationCount.value >= maximumIterations) return false;
    iterationCount.value++;
    return condition;
}

// Galaxy.8.cs FillShipsWithTroops(galaxy, empire) (1001-1036).
// Rnd per state BuiltObject (Empire.BuiltObjects order): a TroopTransport draws
// Next(1, 9); every other ship draws Next(0, 2) and, when that is 1, Next(1, 4).
// TODO(port): troop names use Empire._TroopCount, which in C# already counts the colony
// and capital garrisons generated earlier (Galaxy.8.cs 691, Galaxy.7.cs 5308); those are
// not generated in the TS port yet (colony.ts / empireGeneration.ts TODOs), so the
// ordinal in "<n>th <TroopName>" starts lower here. No Rnd impact.
export function fillShipsWithTroops(galaxy: Galaxy, empire: Empire): void {
    const dominantRace = empire.dominantRace as Race;
    const troopStrength = dominantRace.troopStrength;
    for (const builtObject of empire.builtObjects) {
        if (builtObject.subRole === BuiltObjectSubRole.TroopTransport) {
            const num = galaxy.rnd.next(1, 9) * 100;
            const iterationCount = { value: 0 };
            while (conditionCheckLimit(builtObject.troops !== null && builtObject.troopCapacityRemaining >= num, 50, iterationCount)) {
                const troop = generateNewTroop(empire.generateTroopDescription(), TroopType.Infantry, troopStrength, empire, dominantRace);
                troop.maintenanceMultiplier = calculateTroopMaintenanceMultiplier(dominantRace);
                troop.pictureRef = dominantRace.pictureIndex;
                troop.builtObject = builtObject;
                builtObject.troops!.add(troop);
                empire.troops.add(troop);
            }
        } else if (galaxy.rnd.next(0, 2) === 1) {
            const num2 = galaxy.rnd.next(1, 4) * 100;
            const iterationCount2 = { value: 0 };
            while (conditionCheckLimit(builtObject.troops !== null && builtObject.troopCapacityRemaining >= num2, 50, iterationCount2)) {
                const troop2 = generateNewTroop(empire.generateTroopDescription(), TroopType.Infantry, troopStrength, empire, dominantRace);
                troop2.maintenanceMultiplier = calculateTroopMaintenanceMultiplier(dominantRace);
                troop2.pictureRef = dominantRace.pictureIndex;
                troop2.builtObject = builtObject;
                builtObject.troops!.add(troop2);
                empire.troops.add(troop2);
            }
        }
    }
}

/**
 * Empire.5.cs AssignMissionsToBuiltObjectList(builtObjectList, atWar, patrolMiningStations)
 * (1361) → AssignMissionToBuiltObject (1370) per ship. Called by Start.2.cs 1373-1374 right
 * after FillShipsWithTroops for the state and the private list.
 *
 * TODO(port): missions (BuiltObjectMission, ShipGroup, orders/contracts) are not ported, so
 * this is a no-op. It DOES draw Rnd in C# for idle ships at game start (none has a mission,
 * all are auto-controlled with TopSpeed > 0 and BuiltAt == null):
 *   - freighters: NextDouble (> num6 decides whether to look for resource clearance), then
 *     Next(0, colonies-without-spaceport.Count) and possibly Next(0, MiningStations.Count);
 *   - military ships (Escort … Carrier): Next(0, 2) patrol choice, Next(0, habitats.Count),
 *     Next(0, 2) / Next(0, _DangerousHabitats.Count), Next(0, 2) load-troops check,
 *     Next(0, 8), Next(0, Colonies.Count) …;
 *   - explorers / construction / colony / mining ships go through their own
 *     Assign*Mission paths (exploration target search etc.).
 * So the Rnd stream after the first empire's AssignMissions diverges from C# until missions
 * are ported.
 */
export function assignMissionsToBuiltObjectList(empire: Empire, builtObjectList: BuiltObject[], atWar: boolean, patrolMiningStations: BuiltObject[] | null): void {
    void empire;
    void builtObjectList;
    void atWar;
    void patrolMiningStations;
}
