// M4s (s2) — pirate faction force projection and construction:
//   Empire.2.cs 205 PirateDetermineOwnedColonies, 766 PirateProjectForces, 219 PirateDoConstruction, 562 PirateBuildNewShips,
//   640 PirateBuildNewShipsAtColony, 709 CalculateCashReservesForNewMiningStation.
//
// Free functions, C# `this` first (plan §3.1). Every Galaxy.Rnd draw is on galaxy.rnd in C# order.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { AutomationLevel, BUILD_COLONY_SHIP_POPULATION_REQUIREMENT } from '../empire';
import { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import type { Design } from '../design';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { ForceStructureProjection, ForceStructureProjectionList } from '../forceStructureProjection';
import { calculateSupportCost, countBySubRole } from '../forceStructure';
import { determineNewSpacePortLocations } from '../stationPlacement';
import { EmpireMessage, EmpireMessageType, sendEmpireMessage } from '../messages';
import { AdvisorMessageType, checkTaskAuthorized, formatText, getText, type RefCount } from '../diplomacyTick';
import { REAL_SECONDS_IN_GALACTIC_YEAR, galaxyStarDate } from '../tick/simTime';
import { PiratePlayStyle } from '../pirates';
import {
    MAXIMUM_CONSTRUCTION_QUEUE_WAIT_TIME_YEARS,
    builtObjectsFindShortestConstructionWaitQueue,
    calculateAccurateAnnualCashflow,
    designCalculateMaintenanceCosts,
    formatMoney,
    generateAutomationMessageConstruction,
    habitatsFindShortestConstructionWaitQueue,
    newBuiltObjectShouldBeAutomated,
    placeGroupedOrders,
    procureConstructionComponentsAtBuiltObject,
    procureConstructionComponentsAtColony,
    queueOf,
    refactorForceStructureProjectionsToCosts,
    type PendingOrders,
} from '../construction/empireConstruction';
import { calculatePirateIncome } from '../treasury';
import { PirateExpenseType } from './pirateEconomy';
import { calculatePirateExpenses } from './pirateAI';
import { calculateCashReservesForNewPirateFacilities } from './pirateShipMissions';
import { designsFindNewestCanBuild } from './pirateEmpireAI';

const f = Math.fround;

/** Empire.2.cs 205 PirateDetermineOwnedColonies. No Rnd. */
export function pirateDetermineOwnedColonies(empire: Empire): Habitat[] {
    const habitatList: Habitat[] = [];
    for (let i = 0; i < empire.colonies.length; i++) {
        const habitat = empire.colonies[i];
        if (habitat != null && !habitat.hasBeenDestroyed && habitat.empire === empire) habitatList.push(habitat);
    }
    return habitatList;
}

/** Empire.2.cs 709 CalculateCashReservesForNewMiningStation. No Rnd. */
export function calculateCashReservesForNewMiningStation(galaxy: Galaxy, empire: Empire): number {
    let result = 0.0;
    if (empire.designs != null) {
        const design = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.MiningStation);
        if (design !== null) result = design.calculateCurrentPurchasePrice(galaxy);
    }
    return result;
}

/** Empire.2.cs 766 PirateProjectForces(starDate). No Rnd. */
export function pirateProjectForcesCore(galaxy: Galaxy, empire: Empire, starDate: number): void {
    let stateMoney = empire.stateMoney;
    stateMoney -= calculateCashReservesForNewPirateFacilities(galaxy, empire);
    stateMoney -= calculateCashReservesForNewMiningStation(galaxy, empire);
    const num = stateMoney * 0.6;
    const num2 = stateMoney - num;
    const num3 = calculatePirateIncome(galaxy, empire);
    const num4 = calculatePirateExpenses(empire, true);
    const num5 = 2.0;
    let num6 = 0.0;
    if (stateMoney > 0.0) num6 = stateMoney / num5;
    let num7 = num3 + num6 - num4;
    const num8 = 40000.0;
    const num10 = 0.8;
    if (num7 > num8) {
        // `_ = (num9 - num7) / num11;` — discarded.
        num7 = Math.max(num8, num7 * num10);
    }
    const habitatList = pirateDetermineOwnedColonies(empire);
    const bos = empire.builtObjects;
    const num12 = countBySubRole(bos, BuiltObjectSubRole.Escort);
    const num13 = countBySubRole(bos, BuiltObjectSubRole.Frigate);
    const num14 = countBySubRole(bos, BuiltObjectSubRole.Destroyer);
    const num15 = countBySubRole(bos, BuiltObjectSubRole.Cruiser);
    const num16 = countBySubRole(bos, BuiltObjectSubRole.CapitalShip);
    const num17 = countBySubRole(bos, BuiltObjectSubRole.Carrier);
    const num18 = countBySubRole(bos, BuiltObjectSubRole.TroopTransport);
    const num19 = countBySubRole(bos, BuiltObjectSubRole.ExplorationShip);
    const num20 = countBySubRole(bos, BuiltObjectSubRole.ConstructionShip);
    const num21 = num12 + num13 + num14 + num15 + num16 + num17 + num18;
    const design = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.Escort);
    const design2 = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.Frigate);
    const design3 = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.Destroyer);
    const design4 = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.Cruiser);
    const design5 = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.CapitalShip);
    const design6 = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.Carrier);
    let design7 = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.TroopTransport);
    const design8 = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.ExplorationShip);
    const design9 = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.ConstructionShip);
    if (habitatList.length <= 0) design7 = null;
    const policy = empire.policy!;
    let num22 = f(0);
    let num23 = 0.0;
    let num24 = 0.0;
    const militaryWeights: [Design | null, number][] = [
        [design, policy.constructionMilitaryEscort],
        [design2, policy.constructionMilitaryFrigate],
        [design3, policy.constructionMilitaryDestroyer],
        [design4, policy.constructionMilitaryCruiser],
        [design5, policy.constructionMilitaryCapitalShip],
        [design6, policy.constructionMilitaryCarrier],
        [design7, policy.constructionMilitaryTroopTransport],
    ];
    // 815-856: one block per sub-role, same shape.
    for (const [d, weight] of militaryWeights) {
        if (d !== null) {
            num22 = f(num22 + f(weight));
            num23 += f(weight) * d.calculateCurrentPurchasePrice(galaxy);
            num24 += f(weight) * designCalculateMaintenanceCosts(galaxy, d, empire);
        }
    }
    let forceStructureProjectionList = new ForceStructureProjectionList();
    if (num7 > 0.0) {
        const num25 = Math.min(10, 1 + Math.trunc(bos.length / 5));
        const num26 = Math.max(0, num25 - num19);
        if (num26 > 0 && design8 !== null) {
            const num27 = designCalculateMaintenanceCosts(galaxy, design8, empire);
            const num28 = design8.calculateCurrentPurchasePrice(galaxy);
            const val = csIntDiv(stateMoney, num28);
            const val2 = csIntDiv(num7, num27);
            const num29 = Math.min(num26, Math.min(val2, val));
            if (num29 > 0) {
                const num30 = num29 * num27;
                forceStructureProjectionList.add(new ForceStructureProjection(BuiltObjectSubRole.ExplorationShip, num29, starDate));
                num7 -= num30;
                stateMoney -= num28 * num29;
            }
        }
        if (habitatList.length > 0) {
            const num31 = Math.min(5, 1 + Math.trunc(bos.length / 20));
            const num32 = Math.max(0, num31 - num20);
            if (num32 > 0 && design9 !== null) {
                const num33 = designCalculateMaintenanceCosts(galaxy, design9, empire);
                const num34 = design9.calculateCurrentPurchasePrice(galaxy);
                const val3 = csIntDiv(stateMoney, num34);
                const val4 = csIntDiv(num7, num33);
                const num35 = Math.min(num32, Math.min(val4, val3));
                if (num35 > 0) {
                    const num36 = num35 * num33;
                    forceStructureProjectionList.add(new ForceStructureProjection(BuiltObjectSubRole.ConstructionShip, num35, starDate));
                    num7 -= num36;
                }
            }
        }
        if (num7 > 0.0) {
            num23 /= num22;
            num24 /= num22;
            const val5 = num / num23;
            const val6 = num7 / num24;
            const num37 = f(Math.min(val5, val6));
            const num38 = (num21 + csIntF(num37)) | 0;
            const counts = [num12, num13, num14, num15, num16, num17, num18];
            const subRoles = [BuiltObjectSubRole.Escort, BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.CapitalShip, BuiltObjectSubRole.Carrier, BuiltObjectSubRole.TroopTransport];
            // 891-953: one block per sub-role, same shape.
            for (let k = 0; k < militaryWeights.length; k++) {
                const [d, weight] = militaryWeights[k];
                if (d !== null) {
                    const num39 = f(f(weight) / num22);
                    const num40 = csIntF(f(f(0.5) + f(f(num38) * num39)));
                    if (counts[k] < num40) {
                        forceStructureProjectionList.add(new ForceStructureProjection(subRoles[k], csIntF(0.5 + f(num39 * num37)), starDate));
                    }
                }
            }
        }
    }
    empire.stateForceStructureProjections = forceStructureProjectionList;
    forceStructureProjectionList = new ForceStructureProjectionList();
    let num53 = 1 + csIntF(bos.length * 1.0 * policy.pirateSmugglerFreighterLevel);
    let num54 = csIntF(bos.length * 0.07 * policy.pirateSmugglerPassengerLevel);
    let num55 = 1 + csIntF(bos.length * 0.35 * policy.pirateSmugglerMiningLevel);
    if (habitatList.length <= 0 && empire.resortBases.length <= 0) num54 = 0;
    switch (empire.piratePlayStyle) {
        case PiratePlayStyle.Balanced:
            num53 = csIntF(num53 * 1.3);
            break;
        case PiratePlayStyle.Mercenary:
            num53 = csIntF(num53 * 0.5);
            num55 = csIntF(num55 * 0.5);
            break;
        case PiratePlayStyle.Smuggler:
            num53 = csIntF(num53 * 2.0);
            num55 = csIntF(num55 * 1.5);
            break;
    }
    const pbos = empire.privateBuiltObjects;
    const num56 = countBySubRole(pbos, BuiltObjectSubRole.SmallFreighter);
    const num57 = countBySubRole(pbos, BuiltObjectSubRole.MediumFreighter);
    const num58 = countBySubRole(pbos, BuiltObjectSubRole.LargeFreighter);
    const num59 = countBySubRole(pbos, BuiltObjectSubRole.PassengerShip);
    const num60 = countBySubRole(pbos, BuiltObjectSubRole.MiningShip);
    const num61 = countBySubRole(pbos, BuiltObjectSubRole.GasMiningShip);
    const design10 = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.SmallFreighter);
    const design11 = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.MediumFreighter);
    const design12 = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.LargeFreighter);
    const design13 = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.PassengerShip);
    const design14 = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.MiningShip);
    const design15 = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.GasMiningShip);
    const num62 = Math.max(0, num53 - (num56 + num57 + num58));
    const num63 = Math.max(0, num55 - (num60 + num61));
    const num64 = Math.max(0, num54 - num59);
    let num65 = csIntF(num62 * 0.25);
    let num66 = csIntF(num62 * 0.35);
    let num67 = num62 - (num66 + num65);
    let num68 = csIntF(num63 * 0.5);
    let num69 = num63 - num68;
    let num70 = num64;
    const num71 = Math.max(num67, Math.max(num66, Math.max(num65, Math.max(num69, Math.max(num68, num70)))));
    let num72 = 0;
    let num73 = 0;
    let num74 = 0;
    let num75 = 0;
    let num76 = 0;
    let num77 = 0;
    let num78 = 0.0;
    let num79 = 0.0;
    let num80 = 0.0;
    let num81 = 0.0;
    let num82 = 0.0;
    let num83 = 0.0;
    if (design10 !== null) num78 = design10.calculateCurrentPurchasePrice(galaxy);
    if (design11 !== null) num79 = design11.calculateCurrentPurchasePrice(galaxy);
    if (design12 !== null) num80 = design12.calculateCurrentPurchasePrice(galaxy);
    if (design14 !== null) num81 = design14.calculateCurrentPurchasePrice(galaxy);
    if (design15 !== null) num82 = design15.calculateCurrentPurchasePrice(galaxy);
    if (design13 !== null) num83 = design13.calculateCurrentPurchasePrice(galaxy);
    let num84 = 0.0;
    for (let i = 0; i < num71; i++) {
        if (num67 > 0 && num78 > 0.0) {
            if (num2 > num84 + num78) {
                num72++;
                num84 += num78;
            }
            num67--;
        }
        if (num66 > 0 && num79 > 0.0) {
            if (num2 > num84 + num79) {
                num73++;
                num84 += num79;
            }
            num66--;
        }
        if (num65 > 0 && num80 > 0.0) {
            if (num2 > num84 + num80) {
                num74++;
                num84 += num80;
            }
            num65--;
        }
        if (num69 > 0 && num81 > 0.0) {
            if (num2 > num84 + num81) {
                num75++;
                num84 += num81;
            }
            num69--;
        }
        if (num68 > 0 && num82 > 0.0) {
            if (num2 > num84 + num82) {
                num76++;
                num84 += num82;
            }
            num68--;
        }
        if (num70 > 0 && num83 > 0.0) {
            if (num2 > num84 + num83) {
                num77++;
                num84 += num83;
            }
            num70--;
        }
    }
    if (num72 > 0) forceStructureProjectionList.add(new ForceStructureProjection(BuiltObjectSubRole.SmallFreighter, num72, starDate));
    if (num73 > 0) forceStructureProjectionList.add(new ForceStructureProjection(BuiltObjectSubRole.MediumFreighter, num73, starDate));
    if (num74 > 0) forceStructureProjectionList.add(new ForceStructureProjection(BuiltObjectSubRole.LargeFreighter, num74, starDate));
    if (num75 > 0) forceStructureProjectionList.add(new ForceStructureProjection(BuiltObjectSubRole.MiningShip, num75, starDate));
    if (num76 > 0) forceStructureProjectionList.add(new ForceStructureProjection(BuiltObjectSubRole.GasMiningShip, num76, starDate));
    if (num77 > 0) forceStructureProjectionList.add(new ForceStructureProjection(BuiltObjectSubRole.PassengerShip, num77, starDate));
    empire.privateForceStructureProjections = forceStructureProjectionList;
}

/** C# `(int)(double)` (x64: out of range / NaN → int.MinValue). */
function csIntF(v: number): number {
    if (!Number.isFinite(v) || v >= 2147483648 || v <= -2147483649) return -2147483648;
    return Math.trunc(v) | 0;
}
/** C# `(int)(a / b)` for doubles. */
function csIntDiv(a: number, b: number): number {
    return csIntF(a / b);
}

/** The sub-roles PirateBuildNewShips / AtColony hand to the independent empire (private freighters, miners, passenger ships). */
function isPrivateCivilianSubRole(subRole: BuiltObjectSubRole): boolean {
    switch (subRole) {
        case BuiltObjectSubRole.SmallFreighter:
        case BuiltObjectSubRole.MediumFreighter:
        case BuiltObjectSubRole.LargeFreighter:
        case BuiltObjectSubRole.PassengerShip:
        case BuiltObjectSubRole.GasMiningShip:
        case BuiltObjectSubRole.MiningShip:
            return true;
        default:
            return false;
    }
}

/** Empire.2.cs 562 PirateBuildNewShips(design, amount, availableCash, ref purchaseCost, ...). Rnd: GenerateBuiltObjectName per ship (+ AddBuiltObjectToGalaxy's). */
function pirateBuildNewShips(galaxy: Galaxy, empire: Empire, design: Design, amount: number, availableCash: number, cost: { purchaseCost: number }, bases: PendingOrders<BuiltObject>): void {
    const num = design.calculateCurrentPurchasePrice(galaxy);
    for (let i = 0; i < amount; i++) {
        if (!(cost.purchaseCost + num < availableCash)) continue;
        design.buildCount++;
        const builtObject = new BuiltObject(design, galaxy.generateBuiltObjectName(design, null, true), galaxy);
        builtObject.purchasePrice = num;
        const r = builtObjectsFindShortestConstructionWaitQueue(empire.constructionYards as BuiltObject[], builtObject, true, 2);
        const builtObject2 = r.builtObject;
        const num2 = r.shortestWaitQueueTime / REAL_SECONDS_IN_GALACTIC_YEAR;
        if (builtObject2 !== null && num2 < MAXIMUM_CONSTRUCTION_QUEUE_WAIT_TIME_YEARS) {
            const q = queueOf(builtObject2);
            if (q !== null && q.addBuiltObjectToConstruct(builtObject)) {
                cost.purchaseCost += num;
                if (builtObject2.parentHabitat !== null) builtObject.name = galaxy.generateBuiltObjectName(design, builtObject2.parentHabitat, true);
                const flag = !isPrivateCivilianSubRole(design.subRole);
                empire.addBuiltObjectToGalaxy(builtObject, builtObject2, false, flag);
                builtObject.builtAt = builtObject2;
                builtObject.isAutoControlled = newBuiltObjectShouldBeAutomated(empire, builtObject.subRole);
                if (!flag || design.subRole === BuiltObjectSubRole.ResortBase) {
                    builtObject.empire = galaxy.independentEmpire;
                    const independent = galaxy.independentEmpire!;
                    if (!independent.privateBuiltObjects.includes(builtObject)) independent.privateBuiltObjects.push(builtObject);
                }
                bases.cargo.push(procureConstructionComponentsAtBuiltObject(galaxy, empire, builtObject, builtObject2, true));
                bases.locations.push(builtObject2);
            } else {
                design.buildCount--;
            }
        } else {
            design.buildCount--;
        }
    }
}

/** Empire.2.cs 640 PirateBuildNewShipsAtColony(design, amount, availableCash, ref purchaseCost, colonies, ...). Rnd: GenerateBuiltObjectName per ship (+ AddBuiltObjectToGalaxy's). */
function pirateBuildNewShipsAtColony(galaxy: Galaxy, empire: Empire, design: Design, amount: number, availableCash: number, cost: { purchaseCost: number }, colonies: Habitat[], colonyOrders: PendingOrders<Habitat>): void {
    const num = design.calculateCurrentPurchasePrice(galaxy);
    for (let i = 0; i < amount; i++) {
        if (!(cost.purchaseCost + num < availableCash)) continue;
        design.buildCount++;
        const builtObject = new BuiltObject(design, galaxy.generateBuiltObjectName(design, null, true), galaxy);
        builtObject.purchasePrice = num;
        const r = habitatsFindShortestConstructionWaitQueue(galaxy, colonies, builtObject);
        const habitat = r.habitat;
        const num2 = r.shortestWaitQueueTime / REAL_SECONDS_IN_GALACTIC_YEAR;
        if (habitat !== null && num2 < MAXIMUM_CONSTRUCTION_QUEUE_WAIT_TIME_YEARS) {
            const q = queueOf(habitat);
            if (q !== null && q.addBuiltObjectToConstruct(builtObject)) {
                cost.purchaseCost += num;
                // `if (habitat.ParentHabitat != null) Name = GenerateBuiltObjectName(design, habitat, true)`: StellarObject.ParentHabitat
                // is only ever set on ships and creatures, never on a Habitat, so the rename never happens.
                const flag = !isPrivateCivilianSubRole(design.subRole);
                empire.addBuiltObjectToGalaxy(builtObject, habitat, false, flag);
                builtObject.builtAt = habitat;
                builtObject.isAutoControlled = newBuiltObjectShouldBeAutomated(empire, builtObject.subRole);
                if (!flag) {
                    builtObject.empire = galaxy.independentEmpire;
                    const independent = galaxy.independentEmpire!;
                    if (!independent.privateBuiltObjects.includes(builtObject)) independent.privateBuiltObjects.push(builtObject);
                }
                colonyOrders.cargo.push(procureConstructionComponentsAtColony(galaxy, empire, builtObject, habitat));
                colonyOrders.locations.push(habitat);
            } else {
                design.buildCount--;
            }
        } else {
            design.buildCount--;
        }
    }
}

/**
 * Empire.2.cs 219 PirateDoConstruction. Rnd: DetermineNewSpacePortLocations', per queued space port
 * SelectRelativeHabitatSurfacePoint + SelectRandomHeading (+ AddBuiltObjectToGalaxy's); RefactorForceStructureProjectionsToCosts
 * Next(0, n) per projection; per built ship GenerateBuiltObjectName (+ AddBuiltObjectToGalaxy's).
 */
export function pirateDoConstructionCore(galaxy: Galaxy, empire: Empire): void {
    const refusalCount: RefCount = { value: 0 };
    const bases: PendingOrders<BuiltObject> = { locations: [], cargo: [] };
    const colonyOrders: PendingOrders<Habitat> = { locations: [], cargo: [] };
    const cost = { purchaseCost: 0.0 };
    let stateMoney = empire.stateMoney;
    stateMoney -= calculateCashReservesForNewPirateFacilities(galaxy, empire);
    stateMoney -= calculateCashReservesForNewMiningStation(galaxy, empire);
    const num = calculatePirateIncome(galaxy, empire);
    const num2 = calculatePirateExpenses(empire, true);
    const num3 = 2.0;
    let num4 = 0.0;
    if (stateMoney > 0.0) num4 = stateMoney / num3;
    const num5 = num + num4 - num2;
    // 238-243: `bool flag = false; if (DominantRace != null && !DominantRace.Expanding) flag = false;` — flag is never true.
    const flag = false;
    const habitatList: Habitat[] = [];
    const habitatList2: Habitat[] = [];
    for (let i = 0; i < empire.colonies.length; i++) {
        const habitat = empire.colonies[i];
        if (habitat != null && !habitat.hasBeenDestroyed && habitat.empire === empire) {
            habitatList.push(habitat);
            const q = queueOf(habitat);
            if (habitat.population != null && habitat.population.totalAmount > BUILD_COLONY_SHIP_POPULATION_REQUIREMENT && q !== null && q.constructionWaitQueue !== null && q.constructionWaitQueue.length <= 0) {
                habitatList2.push(habitat);
            }
        }
    }
    // 257-352: the colonization branch runs only when `flag && _ControlColonization != Manual`; flag is always false here
    // (see above), so the branch (DetermineHabitatsBeingColonized, colony ship assignment / construction) is dead code in C#.
    void flag;
    void habitatList2;
    let num8 = 0.0;
    // 353-423: new space ports.
    if (empire.controlStateConstruction !== AutomationLevel.Undefined && habitatList.length > 0) {
        let num9 = 0;
        for (let l = 0; l < empire.builtObjects.length; l++) {
            const builtObject3 = empire.builtObjects[l];
            if (builtObject3.subRole === BuiltObjectSubRole.SmallSpacePort || builtObject3.subRole === BuiltObjectSubRole.MediumSpacePort || builtObject3.subRole === BuiltObjectSubRole.LargeSpacePort) num9++;
        }
        const num10 = 1 + Math.trunc(empire.colonies.length / 3.0);
        const newSpacePortAmount = num10 - num9;
        const habitatList5 = determineNewSpacePortLocations(galaxy, empire, habitatList, newSpacePortAmount, true);
        const policy = empire.policy!;
        const num11 = policy.constructionSpaceportLargeColonyPopulationThreshold * 1000000;
        const num12 = policy.constructionSpaceportMediumColonyPopulationThreshold * 1000000;
        const num13 = policy.constructionSpaceportSmallColonyPopulationThreshold * 1000000;
        for (const item of habitatList5) {
            let design2: Design | null = null;
            if (item.population!.totalAmount > num11) design2 = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.LargeSpacePort);
            else if (item.population!.totalAmount > num12) design2 = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.MediumSpacePort);
            else if (item.population!.totalAmount > num13) design2 = designsFindNewestCanBuild(empire.designs, BuiltObjectSubRole.SmallSpacePort);
            if (design2 === null) continue;
            const num14 = design2.calculateCurrentPurchasePrice(galaxy);
            if (!((cost.purchaseCost + num14) / 8.0 <= num5) || !(cost.purchaseCost + num14 <= empire.stateMoney)) continue;
            design2.buildCount++;
            const builtObject4 = new BuiltObject(design2, item.name + ' ' + getText('Space Port'), galaxy);
            builtObject4.purchasePrice = num14;
            if (checkTaskAuthorized(galaxy, empire, empire.controlStateConstruction, refusalCount, generateAutomationMessageConstruction(galaxy, builtObject4, item, num14), item, AdvisorMessageType.BuildOneOff, null, design2, null)) {
                const q = queueOf(item);
                if (q !== null && q.addBuiltObjectToConstruct(builtObject4)) {
                    builtObject4.parentHabitat = item;
                    const p = galaxy.selectRelativeHabitatSurfacePoint(item);
                    builtObject4.parentOffsetX = p.x;
                    builtObject4.parentOffsetY = p.y;
                    builtObject4.heading = galaxy.selectRandomHeading();
                    builtObject4.targetHeading = builtObject4.heading;
                    builtObject4.nearestSystemStar = galaxy.determineHabitatSystemStar(item);
                    empire.addBuiltObjectToGalaxy(builtObject4, item, false, true);
                    builtObject4.builtAt = item;
                    cost.purchaseCost += num14;
                    num8 += calculateSupportCost(galaxy, empire, design2);
                    colonyOrders.cargo.push(procureConstructionComponentsAtColony(galaxy, empire, builtObject4, item));
                    colonyOrders.locations.push(item);
                } else {
                    design2.buildCount--;
                }
            } else {
                design2.buildCount--;
            }
        }
    }
    // 424-484: the force structure.
    let num15 = 0.0;
    const stateForceStructureProjections = empire.stateForceStructureProjections!;
    num15 += num8;
    void num15;
    const forceStructureProjectionList = new ForceStructureProjectionList();
    for (const p of stateForceStructureProjections.items) forceStructureProjectionList.add(p);
    if (empire.controlStateConstruction !== AutomationLevel.Undefined) {
        let projections = empire.privateForceStructureProjections!.clone();
        // RefactorForceStructureProjectionsToCosts(projections, includeCashflowCheck: false) (Empire.6.cs 2305).
        projections = refactorForceStructureProjectionsToCosts(galaxy, empire, projections, calculateAccurateAnnualCashflow(galaxy, empire), 0.0, 0.0, false).result;
        for (const p of projections.items) forceStructureProjectionList.add(p);
    }
    let num16 = 0.0;
    for (const item2 of forceStructureProjectionList.items) {
        const design3 = designsFindNewestCanBuild(empire.designs, item2.subRole);
        if (design3 !== null) {
            const num17 = design3.calculateCurrentPurchasePrice(galaxy);
            num16 += num17 * item2.amount;
        }
    }
    if (num16 > 0.0) {
        if (empire.controlStateConstruction === AutomationLevel.PartiallyAutomated) {
            const empireMessage = new EmpireMessage(empire, EmpireMessageType.AdvisorSuggestion, null);
            empireMessage.advisorMessageType = AdvisorMessageType.BuildOrder;
            empireMessage.description = formatText(getText('Build new ships for X credits'), formatMoney(num16));
            empireMessage.starDate = galaxyStarDate(galaxy);
            sendEmpireMessage(empireMessage, empire);
        } else if (empire.controlStateConstruction === AutomationLevel.FullyAutomated) {
            for (let m = 0; m < forceStructureProjectionList.count; m++) {
                const forceStructureProjection = forceStructureProjectionList.get(m);
                if (forceStructureProjection == null || forceStructureProjection.amount <= 0) continue;
                const design4 = designsFindNewestCanBuild(empire.designs, forceStructureProjection.subRole);
                if (design4 !== null) {
                    if (design4.subRole === BuiltObjectSubRole.ConstructionShip || design4.subRole === BuiltObjectSubRole.ColonyShip || design4.subRole === BuiltObjectSubRole.ResupplyShip) {
                        pirateBuildNewShipsAtColony(galaxy, empire, design4, forceStructureProjection.amount, stateMoney, cost, habitatList, colonyOrders);
                    } else {
                        pirateBuildNewShips(galaxy, empire, design4, forceStructureProjection.amount, stateMoney, cost, bases);
                    }
                }
            }
            empire.stateMoney -= cost.purchaseCost;
            empire.pirateEconomy.performExpense(cost.purchaseCost, PirateExpenseType.Construction, galaxyStarDate(galaxy));
        }
    }
    // 485-559: resource orders for every distinct yard / colony (ConstructionShortage).
    if (bases.cargo.length <= 0 && colonyOrders.cargo.length <= 0) return;
    placeGroupedOrders(galaxy, empire, bases);
    placeGroupedOrders(galaxy, empire, colonyOrders);
}
