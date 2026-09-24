// M4s (s1) — PirateEconomy.cs, PirateEconomyYear.cs, PirateIncomeType.cs, PirateExpenseType.cs: a pirate faction's
// yearly income / expense statistics (bookkeeping only, no Rnd). Runtime-dependency-free apart from the time constant
// so empire.ts can construct it in its field initializers.

import { YEAR_LENGTH } from '../galaxyTime';

// PirateIncomeType.cs (byte enum, declaration order = values).
export enum PirateIncomeType {
    Undefined,
    ProtectionAgreement,
    Mining,
    Looting,
    Missions,
    SellInfo,
    ControlColony,
    Smuggling,
    ScrapCapturedShips,
    Resort,
}

// PirateExpenseType.cs (byte enum, declaration order = values).
export enum PirateExpenseType {
    Undefined,
    ShipMaintenance,
    Construction,
    PurchaseResources,
    CrashResearch,
    FacilityConstruction,
    Fuel,
}

/** Galaxy.cs 1362 CalculateStartOfYear(date) (long %). */
export function calculateStartOfYear(date: number): number {
    const num = date % YEAR_LENGTH;
    return date - num;
}

// PirateEconomyYear.cs.
export class PirateEconomyYear {
    readonly yearStartDate: number;
    protectionAgreementIncome = 0.0;
    miningIncome = 0.0;
    lootingIncome = 0.0;
    missionIncome = 0.0;
    sellInfoIncome = 0.0;
    controlColonyIncome = 0.0;
    smugglingIncome = 0.0;
    scrapCapturedShipIncome = 0.0;
    resortIncome = 0.0;
    otherIncome = 0.0;
    shipMaintenanceExpenses = 0.0;
    constructionExpenses = 0.0;
    purchaseResourcesExpenses = 0.0;
    crashResearchExpenses = 0.0;
    facilityConstructionExpenses = 0.0;
    fuelExpenses = 0.0;
    otherExpenses = 0.0;

    // PirateEconomyYear.cs 32.
    constructor(starDate: number) {
        this.yearStartDate = calculateStartOfYear(starDate);
    }

    // PirateEconomyYear.cs 36-50 (double sums in C# source order).
    get totalIncome(): number {
        return this.protectionAgreementIncome + this.miningIncome + this.lootingIncome + this.missionIncome + this.sellInfoIncome + this.controlColonyIncome + this.smugglingIncome + this.scrapCapturedShipIncome + this.resortIncome + this.otherIncome;
    }
    get totalExpenses(): number {
        return this.shipMaintenanceExpenses + this.constructionExpenses + this.purchaseResourcesExpenses + this.crashResearchExpenses + this.facilityConstructionExpenses + this.fuelExpenses + this.otherExpenses;
    }
    get stableIncome(): number {
        return this.protectionAgreementIncome + this.controlColonyIncome;
    }
    get stableExpenses(): number {
        return this.shipMaintenanceExpenses;
    }
    get bonusIncome(): number {
        return this.miningIncome + this.lootingIncome + this.missionIncome + this.sellInfoIncome + this.smugglingIncome + this.scrapCapturedShipIncome + this.resortIncome + this.otherIncome;
    }
    get stableCashflow(): number {
        return this.stableIncome - this.stableExpenses;
    }
    get totalCashflow(): number {
        return this.totalIncome - this.totalExpenses;
    }

    /** PirateEconomyYear.cs 52 PerformIncome(amount, type). */
    performIncome(amount: number, type: PirateIncomeType): void {
        switch (type) {
            case PirateIncomeType.Undefined:
                this.otherIncome += amount;
                break;
            case PirateIncomeType.ProtectionAgreement:
                this.protectionAgreementIncome += amount;
                break;
            case PirateIncomeType.Mining:
                this.miningIncome += amount;
                break;
            case PirateIncomeType.Looting:
                this.lootingIncome += amount;
                break;
            case PirateIncomeType.Missions:
                this.missionIncome += amount;
                break;
            case PirateIncomeType.SellInfo:
                this.sellInfoIncome += amount;
                break;
            case PirateIncomeType.ControlColony:
                this.controlColonyIncome += amount;
                break;
            case PirateIncomeType.Smuggling:
                this.smugglingIncome += amount;
                break;
            case PirateIncomeType.ScrapCapturedShips:
                this.scrapCapturedShipIncome += amount;
                break;
            case PirateIncomeType.Resort:
                this.resortIncome += amount;
                break;
        }
    }

    /** PirateEconomyYear.cs 88 PerformExpense(amount, type). */
    performExpense(amount: number, type: PirateExpenseType): void {
        switch (type) {
            case PirateExpenseType.Undefined:
                this.otherExpenses += amount;
                break;
            case PirateExpenseType.ShipMaintenance:
                this.shipMaintenanceExpenses += amount;
                break;
            case PirateExpenseType.Construction:
                this.constructionExpenses += amount;
                break;
            case PirateExpenseType.PurchaseResources:
                this.purchaseResourcesExpenses += amount;
                break;
            case PirateExpenseType.CrashResearch:
                this.crashResearchExpenses += amount;
                break;
            case PirateExpenseType.FacilityConstruction:
                this.facilityConstructionExpenses += amount;
                break;
            case PirateExpenseType.Fuel:
                this.fuelExpenses += amount;
                break;
        }
    }
}

// PirateEconomy.cs.
export class PirateEconomy {
    private _thisYear: PirateEconomyYear;
    private _lastYear: PirateEconomyYear | null;

    // PirateEconomy.cs 18.
    constructor(starDate: number) {
        this._thisYear = new PirateEconomyYear(starDate);
        this._lastYear = null;
    }

    get thisYear(): PirateEconomyYear {
        return this._thisYear;
    }
    get lastYear(): PirateEconomyYear | null {
        return this._lastYear;
    }

    /** PirateEconomy.cs 28 PerformExpense(amount, type, starDate). */
    performExpense(amount: number, type: PirateExpenseType, starDate: number): void {
        this.checkSwitchYears(starDate);
        this._thisYear.performExpense(amount, type);
    }

    /** PirateEconomy.cs 37 PerformIncome(amount, type, starDate). */
    performIncome(amount: number, type: PirateIncomeType, starDate: number): void {
        this.checkSwitchYears(starDate);
        this._thisYear.performIncome(amount, type);
    }

    /** PirateEconomy.cs 46 CheckSwitchYears(starDate). */
    private checkSwitchYears(starDate: number): boolean {
        const num = calculateStartOfYear(starDate) - this.thisYear.yearStartDate;
        if (num <= 0) return false;
        if (num > YEAR_LENGTH) {
            this._lastYear = null;
            this._thisYear = new PirateEconomyYear(starDate);
        } else {
            this._lastYear = this.thisYear;
            this._thisYear = new PirateEconomyYear(starDate);
        }
        return true;
    }
}
