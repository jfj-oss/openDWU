// M4d — Contract / ContractList (Contract.cs, ContractList.cs), CancelContract (Galaxy.1.cs 1086, moved here from
// independentTraders.ts) and the money side of a contract: InitiateContract (Empire.4.cs 1113-1223), PayForFreight
// (1071), CalculateCurrentContractValue (1040-1069), BuiltObject.PerformFinancialTransaction (BuiltObject.cs 3415) and
// DiplomaticRelation.PerformTradeTransaction (DiplomaticRelation.cs 101). No Rnd drawn here (see the RND note on the
// TradeIncome character event).

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import { Cargo, ResourceRef, type CargoList } from '../cargo';
import { CharacterEventType, CharacterSkillType, getHighestSkillLevelExcludeLeaders, stellarObjectCharacters, type Character } from '../characters';
import type { Race } from '../data/races';
import { galaxyComponentCurrentPrices, galaxyResourceCurrentPrices } from '../design';
import { DiplomaticRelation, DiplomaticRelationType, type YearlyTradeValueList } from '../diplomacy';
import { doCharacterEventRuntime } from '../events';
import { REAL_SECONDS_IN_GALACTIC_YEAR } from '../galaxyTime';
import { pirateEconomyPerformExpense, pirateEconomyPerformIncome } from '../pirates/pirateAI';
import { galaxyStarDate } from '../tick/simTime';
import { countersProcessTradeBonus } from '../treasury';
import { applyCorruptionToIncome, cargoGetCargo, cargoRemove, performPrivateTransaction, type ComponentRef, type Order } from './orders';
import { scenarioEmit } from '../scenario/hooks';
import { contractListenersActive, emitContractInitiated } from './contractEvents';

/** A StellarObject (C# base of Habitat and BuiltObject). */
export type StellarObject = Habitat | BuiltObject;

// PirateIncomeType.Mining / PirateExpenseType.PurchaseResources (PirateIncomeType.cs, PirateExpenseType.cs).
const PIRATE_INCOME_TYPE_MINING = 2;
const PIRATE_EXPENSE_TYPE_PURCHASE_RESOURCES = 3;

// Contract.cs.
export class Contract {
    amountToFulfill: number; // int
    amountDelivered: number; // int
    amountPickedUp: number; // int
    freighter: BuiltObject | null = null;
    supplier: StellarObject | null;
    private _buyerEmpireId: number; // byte
    private _resourceId: number; // short
    private _componentId: number; // short

    // Contract.cs 30.
    constructor(supplier: StellarObject | null, amountToFulfill: number, resourceId: number, componentId: number, buyerEmpireId: number) {
        this.amountToFulfill = amountToFulfill;
        this.amountDelivered = 0;
        this.amountPickedUp = 0;
        this.supplier = supplier;
        this._resourceId = (resourceId << 16) >> 16;
        this._componentId = (componentId << 16) >> 16;
        this._buyerEmpireId = buyerEmpireId & 0xff;
    }

    get buyerEmpireId(): number {
        return this._buyerEmpireId;
    }
    get resourceId(): number {
        return this._resourceId;
    }
    get componentId(): number {
        return this._componentId;
    }
}

/**
 * ContractList.cs 13 GetContractForCargoWithRemainingPickup(cargo). TS cargo is resource-only
 * (TODO(port): the CommodityIsComponent branch).
 */
export function getContractForCargoWithRemainingPickup(contracts: (Contract | null)[], cargo: Cargo | null): Contract | null {
    if (cargo !== null) {
        const empireId = cargoOwnerId(cargo);
        for (let index = 0; index < contracts.length; ++index) {
            const c = contracts[index];
            if (c != null && c.buyerEmpireId === empireId && c.amountToFulfill - c.amountPickedUp > 0) {
                if (c.resourceId === cargo.commodity.resourceId) return c;
            }
        }
    }
    return null;
}

/** ContractList.cs 35 GetContractForCargoWithRemainingDelivery(cargo) (resource cargo only, as above). */
export function getContractForCargoWithRemainingDelivery(contracts: (Contract | null)[], cargo: Cargo | null): Contract | null {
    if (cargo !== null) {
        const empireId = cargoOwnerId(cargo);
        for (let index = 0; index < contracts.length; ++index) {
            const c = contracts[index];
            if (c != null && c.buyerEmpireId === empireId && c.amountToFulfill - c.amountDelivered > 0) {
                if (c.resourceId === cargo.commodity.resourceId) return c;
            }
        }
    }
    return null;
}

function cargoOwnerId(cargo: Cargo): number {
    const e = cargo.empire as Empire | null | undefined;
    return e == null ? -1 : e.empireId;
}

/** BuiltObject.ContractsToFulfill as the typed list (builtObject.ts declares it `unknown[]`). */
export function builtObjectContracts(builtObject: BuiltObject): Contract[] {
    return builtObject.contractsToFulfill as Contract[];
}

/** Galaxy.cs 2103 GetEmpireById(empireId). */
export function getEmpireById(galaxy: Galaxy, empireId: number): Empire | null {
    let empire: Empire | null = null;
    empire = galaxy.independentEmpire === null || empireId !== galaxy.independentEmpire.empireId ? (galaxy.empires.find((e) => e.empireId === empireId) ?? null) : galaxy.independentEmpire;
    if (empire === null) empire = galaxy.pirateEmpires.find((e) => e.empireId === empireId) ?? null;
    return empire;
}

/** Galaxy.1.cs 1086 CancelContract(contract). No Rnd. */
export function cancelContract(galaxy: Galaxy, contract: Contract | null): boolean {
    if (contract !== null) {
        if (contract.supplier !== null) {
            const num = contract.amountToFulfill - contract.amountPickedUp;
            if (num > 0) {
                const cargo = contract.supplier.cargo;
                const empireById = getEmpireById(galaxy, contract.buyerEmpireId);
                if (empireById !== null && cargo !== null) {
                    let cargo2: Cargo | null = null;
                    if (contract.resourceId >= 0) {
                        cargo2 = cargoGetCargo(cargo, contract.resourceId, empireById);
                    } else if (contract.componentId >= 0) {
                        // TODO(port): component cargo (cargo.GetCargo(new Component(id), empire)); TS cargo is resource-only.
                        cargo2 = null;
                    }
                    if (cargo2 !== null) {
                        cargo2.reserved -= num;
                        cargo2.reserved = Math.max(0, cargo2.reserved);
                        if (cargo2.amount <= 0 && cargo2.reserved <= 0) cargoRemove(cargo, cargo2);
                    }
                }
            }
        }
        contract.amountToFulfill = contract.amountDelivered;
        return true;
    }
    return false;
}

// ------------------------------------------------------------------------------------------

/** Race.FreeTradeIncomeFactor (Race.cs 220, default 1.0; parsed at Race.cs 1585, clamped to [0.2, 5]). */
export function raceFreeTradeIncomeFactor(race: Race): number {
    const raw = race.extra?.['FreeTradeIncomeFactor'];
    if (raw === undefined) return 1.0;
    return Math.min(5.0, Math.max(0.2, parseFloat(raw.trim())));
}

/** Empire.4.cs 1040 CalculateCurrentContractValue(Resource, amount). */
export function calculateCurrentContractValueResource(galaxy: Galaxy, resource: ResourceRef | null, amount: number): number {
    let num = 0.0;
    if (resource !== null) num = galaxyResourceCurrentPrices(galaxy)[resource.resourceId];
    return num * amount;
}

/** Empire.4.cs 1050 CalculateCurrentContractValue(Order, amount). */
export function calculateCurrentContractValueOrder(galaxy: Galaxy, order: Order, amount: number): number {
    let num = 0.0;
    if (order.commodityResource !== null) num = galaxyResourceCurrentPrices(galaxy)[order.commodityResource.resourceId];
    else if (order.commodityComponent !== null) num = galaxyComponentCurrentPrices(galaxy)[order.commodityComponent.componentId];
    return num * amount;
}

/** BuiltObject.cs 3415 PerformFinancialTransaction(amount, date, incomeFromTax). */
export function performFinancialTransaction(builtObject: BuiltObject, amount: number, date: number, incomeFromTax: boolean): void {
    const num = date % (REAL_SECONDS_IN_GALACTIC_YEAR * 1000);
    const num2 = date - num;
    if (builtObject.dateOfLastIncome < num2) {
        if (builtObject.currentYearsIncome < ((builtObject.annualSupportCost * 2) | 0)) builtObject.consecutiveUnprofitableYears++;
        builtObject.currentYearsIncome = 0.0;
    }
    let num3 = 0.0;
    if (incomeFromTax) {
        if (builtObject.empire !== null) {
            num3 = amount * Math.fround(builtObject.tradeBonuses);
            builtObject.empire.stateMoney += num3;
        }
    } else {
        num3 = amount;
    }
    builtObject.currentYearsIncome += num3;
    builtObject.dateOfLastIncome = date;
    if (builtObject.currentYearsIncome >= ((builtObject.annualSupportCost * 2) | 0)) builtObject.consecutiveUnprofitableYears = 0;
}

/**
 * DiplomaticRelation.cs 101 PerformTradeTransaction(value, starDate). diplomacy.ts keeps the method as a throwing
 * stub (its trade-value list is private); this is the port, reading the list through a cast.
 */
export function performTradeTransaction(galaxy: Galaxy, relation: DiplomaticRelation, value: number, starDate: number): void {
    const thisEmpire = relation.thisEmpire;
    if (thisEmpire !== null && thisEmpire.counters != null) {
        countersProcessTradeBonus(galaxy, thisEmpire, relation, value);
        if (thisEmpire.characters != null) {
            // Galaxy.DoCharacterEvent(TradeIncome, null, Characters.GetAmbassadorsForEmpire(_OtherEmpire), true, _ThisEmpire).
            const ambassadors = getAmbassadorsForEmpire(thisEmpire.characters as Character[], relation.otherEmpire);
            // Galaxy.1.cs 3781 DoCharacterEvent (characters.ts doCharacterEventForList; Rnd: its per-character draws,
            // Galaxy.1.cs 3858-3860).
            doCharacterEventRuntime(galaxy, CharacterEventType.TradeIncome, null, ambassadors, true, thisEmpire);
        }
    }
    starDate = galaxyStarDate(galaxy);
    relation.ageTradeValues(starDate);
    const tradeValues = (relation as unknown as { _tradeValues: YearlyTradeValueList })._tradeValues;
    const yearLength = Math.trunc(REAL_SECONDS_IN_GALACTIC_YEAR * 1000);
    const byYear = tradeValues.getByYear(starDate - (starDate % yearLength));
    if (byYear === null) return;
    byYear.value += value;
}

/** CharacterList.cs 289 GetAmbassadorsForEmpire(empire): characters at the empire's capital, not transferring. */
function getAmbassadorsForEmpire(characters: Character[], empire: Empire | null): Character[] {
    const result: Character[] = [];
    if (empire !== null && empire.capital !== null) {
        const capital = empire.capital;
        for (let i = 0; i < characters.length; i++) {
            const c = characters[i];
            // CharacterList.FindCharactersAtLocationNotTransferring(location).
            if (c !== null && c.location === capital && c.transferDestination === null) result.push(c);
        }
    }
    return result;
}

/** Empire.4.cs 1071 PayForFreight(sellingPoint, contract, requestorX, requestorY, requestorIsState, requestingEmpire). */
function payForFreight(galaxy: Galaxy, sellingPoint: StellarObject, contract: Contract, requestorX: number, requestorY: number, requestorIsState: boolean, requestingEmpire: Empire | null): void {
    galaxy.calculateDistance(sellingPoint.xpos, sellingPoint.ypos, requestorX, requestorY); // result unused
    const num = 0.0;
    const freighter = contract.freighter!;
    if (freighter.owner !== null) {
        if (requestingEmpire !== null) {
            if (requestorIsState) requestingEmpire.stateMoney -= num;
            else performPrivateTransaction(galaxy, requestingEmpire, 0.0 - num);
        }
        freighter.owner.stateMoney += num;
    } else {
        if (freighter.empire === null) return;
        if (requestingEmpire !== null) {
            if (requestorIsState) requestingEmpire.stateMoney -= num;
            else performPrivateTransaction(galaxy, requestingEmpire, 0.0 - num);
        }
        performPrivateTransaction(galaxy, freighter.empire, num);
    }
}

/**
 * Empire.4.cs 1113 InitiateContract(sellingPoint, order, contract, empire, starDate). `self` is the C# `this` (the
 * empire running CheckMarketOrders); `empire` is the seller.
 */
export function initiateContractForOrder(galaxy: Galaxy, self: Empire, sellingPoint: StellarObject, order: Order, contract: Contract, empire: Empire, starDate: number): void {
    let destination: StellarObject | null = null;
    let requestingEmpire: Empire | null = null;
    const isStateOrder = order.isStateOrder;
    const commodityResource = order.commodityResource;
    const commodityComponent = order.commodityComponent;
    if (order.requestingBuiltObject !== null) {
        destination = order.requestingBuiltObject;
        requestingEmpire = order.requestingBuiltObject.actualEmpire;
    } else if (order.requestingColony !== null) {
        destination = order.requestingColony;
        requestingEmpire = order.requestingColony.owner;
    }
    order.contracts.push(contract);
    const transactionAmount = calculateCurrentContractValueOrder(galaxy, order, contract.amountToFulfill);
    initiateContract(galaxy, self, sellingPoint, destination, requestingEmpire, isStateOrder, commodityResource, commodityComponent, transactionAmount, contract, empire, starDate);
}

/** Empire.4.cs 1135 InitiateContract(sellingPoint, destination, requestingEmpire, isState, resource, component, transactionAmount, contract, empire, starDate). */
export function initiateContract(
    galaxy: Galaxy,
    self: Empire,
    sellingPoint: StellarObject,
    destination: StellarObject | null,
    requestingEmpire: Empire | null,
    isState: boolean,
    resource: ResourceRef | null,
    component: ComponentRef | null,
    transactionAmount: number,
    contract: Contract,
    empire: Empire,
    starDate: number,
): void {
    if (requestingEmpire === null) return;
    let num = 0.0;
    if (sellingPoint instanceof BuiltObject) num = transactionAmount * Math.fround(sellingPoint.tradeBonuses);
    if (empire.dominantRace !== null) num *= raceFreeTradeIncomeFactor(empire.dominantRace);
    const sellingEmpire = sellingPoint.empire as Empire | null;
    if (sellingEmpire !== null && sellingEmpire.leader !== null) {
        const num2 = 1.0 + sellingEmpire.leader.tradeIncome / 100.0;
        num *= num2;
    }
    const sellingCharacters = stellarObjectCharacters(sellingPoint);
    if (sellingCharacters !== null && sellingCharacters.length > 0) {
        const highestSkillLevelExcludeLeaders = getHighestSkillLevelExcludeLeaders(sellingCharacters, CharacterSkillType.TradeIncome);
        const num3 = 1.0 + highestSkillLevelExcludeLeaders / 100.0;
        num *= num3;
    }
    empire.stateMoney += applyCorruptionToIncome(empire, num);
    const num4 = applyCorruptionToIncome(empire, transactionAmount);
    performPrivateTransaction(galaxy, empire, num4);
    pirateEconomyPerformIncome(galaxy, empire, num4, PIRATE_INCOME_TYPE_MINING, starDate);
    if (requestingEmpire !== null) {
        if (isState || requestingEmpire.pirateEmpireBaseHabitat !== null) {
            requestingEmpire.stateMoney -= transactionAmount;
            pirateEconomyPerformExpense(galaxy, requestingEmpire, transactionAmount, PIRATE_EXPENSE_TYPE_PURCHASE_RESOURCES, starDate);
        } else {
            performPrivateTransaction(galaxy, requestingEmpire, 0.0 - transactionAmount);
        }
    }
    if (sellingPoint instanceof BuiltObject) performFinancialTransaction(sellingPoint, transactionAmount, starDate, true);
    payForFreight(galaxy, sellingPoint, contract, destination!.xpos, destination!.ypos, isState, requestingEmpire);
    let cargo: Cargo | null = null;
    let cargo2: Cargo | null = null;
    const sellingCargo: CargoList | null = sellingPoint.cargo;
    if (sellingCargo !== null) {
        if (resource !== null) {
            cargo = cargoGetCargo(sellingCargo, resource.resourceId, sellingEmpire);
            cargo2 = new Cargo(resource, contract.amountToFulfill, requestingEmpire, contract.amountToFulfill);
        } else if (component !== null) {
            // TODO(port): component cargo — cargo = GetCargo(component, sellingPoint.Empire); cargo2 = new
            // Cargo(component, AmountToFulfill, requestingEmpire, AmountToFulfill). TS cargo is resource-only.
        }
        if (cargo !== null) {
            if (cargo.amount > contract.amountToFulfill) cargo.amount -= contract.amountToFulfill;
            else cargoRemove(sellingCargo, cargo);
        }
        if (cargo2 !== null) sellingCargo.add(cargo2);
    }
    if (requestingEmpire !== galaxy.independentEmpire && sellingEmpire !== galaxy.independentEmpire && requestingEmpire !== sellingEmpire && requestingEmpire.pirateEmpireBaseHabitat === null && sellingEmpire!.pirateEmpireBaseHabitat === null) {
        let diplomaticRelation = sellingEmpire!.diplomaticRelations.byEmpire(requestingEmpire);
        if (diplomaticRelation === null) {
            diplomaticRelation = new DiplomaticRelation(DiplomaticRelationType.NotMet, sellingEmpire, sellingEmpire, requestingEmpire, false);
            sellingEmpire!.diplomaticRelations.add(diplomaticRelation);
        }
        performTradeTransaction(galaxy, diplomaticRelation, transactionAmount, starDate);
        let diplomaticRelation2 = requestingEmpire.diplomaticRelations.byEmpire(sellingEmpire);
        if (diplomaticRelation2 === null) {
            diplomaticRelation2 = new DiplomaticRelation(DiplomaticRelationType.NotMet, sellingEmpire, requestingEmpire, sellingEmpire, false);
            // C# oddity kept: added to this (the empire running CheckMarketOrders), not to requestingEmpire.
            self.diplomaticRelations.add(diplomaticRelation2);
        }
        performTradeTransaction(galaxy, diplomaticRelation2, transactionAmount, starDate);
    }
    // Mod layer / 19e-9: observation hook (no Rnd, no state change unless a scenario flag is on).
    if (contractListenersActive()) emitContractInitiated(galaxy, { starDate: galaxyStarDate(galaxy), seller: empire, sellingPoint, buyer: requestingEmpire, destination: destination!, resourceId: resource?.resourceId ?? -1, componentId: component?.componentId ?? -1, amount: contract.amountToFulfill, value: transactionAmount, isState, freighter: contract.freighter });
    if (galaxy.scenario !== null) scenarioEmit(galaxy, 'contractInitiated', { seller: empire, buyer: requestingEmpire, sellingPoint, destination, resourceId: resource?.resourceId ?? -1, componentId: component?.componentId ?? -1, amount: contract.amountToFulfill, value: transactionAmount, isState, freighter: contract.freighter });
}
