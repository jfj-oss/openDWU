// Diplomacy model: port of DiplomaticRelationType.cs, DiplomaticStrategy.cs,
// DiplomaticRelation.cs, DiplomaticRelationList.cs, YearlyTradeValue(.List).cs,
// the Empire methods Empire.4.cs ObtainDiplomaticRelation (137) and
// Empire.9.cs ResolveEmpiresToDefendAgainst (1696), and the Start.2.cs
// 1376-1427 block in which the starting empires meet each other
// (meetEmpiresAtStart).
//
// The canonical DiplomaticRelationType / DiplomaticStrategy enums live here;
// forceStructure.ts re-exports them.
//
// C# numeric semantics: dates are `long` (safe integers here), war damage `int`.
// Empire methods are free functions taking the C# `this` as first argument.
// The SyncList lock is irrelevant single-threaded.

import type { Empire } from './empire';
import type { Galaxy } from './galaxy';
import type { Habitat } from './types';
import type { BuiltObject } from './builtObject';
import { REAL_SECONDS_IN_GALACTIC_YEAR } from './galaxyTime';
import { SystemVisibilityStatus } from './visibility';
import { PirateRelationType } from './pirateRelations';

// DiplomaticRelationType.cs (byte enum; member order exact).
export enum DiplomaticRelationType {
    NotMet,
    None,
    FreeTradeAgreement,
    MutualDefensePact,
    SubjugatedDominion,
    Protectorate,
    TradeSanctions,
    War,
    Truce,
}

// DiplomaticStrategy.cs (byte enum; member order exact).
export enum DiplomaticStrategy {
    Undefined,
    Conquer,
    Befriend,
    Placate,
    Defend,
    Ally,
    Undermine,
    DefendPlacate,
    DefendUndermine,
    Punish,
}

/** Galaxy.MaximumEmpireCount (Galaxy.3.cs 5034). */
const MAXIMUM_EMPIRE_COUNT = 255;

// YearlyTradeValue.cs
export class YearlyTradeValue {
    year: number; // long
    value: number; // double
    constructor(year: number, value = -1.0) {
        this.year = year;
        this.value = value;
    }
}

// YearlyTradeValueList.cs (only GetByYear is used by DiplomaticRelation).
export class YearlyTradeValueList {
    readonly items: YearlyTradeValue[] = [];
    get count(): number {
        return this.items.length;
    }
    getByYear(year: number): YearlyTradeValue | null {
        for (let index = 0; index < this.items.length; ++index) {
            const byYear = this.items[index];
            if (byYear != null && byYear.year === year) return byYear;
        }
        return null;
    }
}

/**
 * TODO(port): WarObjective (WarObjective.cs) — null on every relation created at game start
 * (only the war-planning code in Empire.9.cs assigns it).
 */
type WarObjective = unknown;

// DiplomaticRelation.cs
export class DiplomaticRelation {
    type: DiplomaticRelationType;
    thisEmpire: Empire | null;
    otherEmpire: Empire | null;
    initiator: Empire | null;
    lastDiplomacyTradeOfferDate = 0; // long
    lastGiftDate = 0; // long
    startDateOfLastChange = 0; // long
    lastTradeDealOfferDate = 0; // long
    warDamageBuiltObject = 0; // int
    warDamageColony = 0; // int
    locked = false;
    allianceName = '';
    private _tradeValues = new YearlyTradeValueList();
    private readonly _yearLength = Math.trunc(REAL_SECONDS_IN_GALACTIC_YEAR * 1000); // (long)
    private readonly _yearsStored = 3;
    tradeBonus: number; // double
    supplyRestrictedResources: boolean;
    militaryRefuelingToOther = false;
    miningRightsToOther = false;
    strategy: DiplomaticStrategy = DiplomaticStrategy.Undefined;
    warObjective: WarObjective = null;
    warObjectiveColonies: Habitat[] = [];
    warObjectiveBases: BuiltObject[] = [];
    /** [NonSerialized] double SortTag. */
    sortTag = 0.0;

    /**
     * DiplomaticRelation(type, initiator, thisEmpire, otherEmpire, tradeRestrictedResources) (DiplomaticRelation.cs 237)
     * and the overload with `long proposalStarDate` before the flag (224; sets LastDiplomacyTradeOfferDate).
     */
    constructor(type: DiplomaticRelationType, initiator: Empire | null, thisEmpire: Empire | null, otherEmpire: Empire | null, tradeRestrictedResources: boolean);
    constructor(type: DiplomaticRelationType, initiator: Empire | null, thisEmpire: Empire | null, otherEmpire: Empire | null, proposalStarDate: number, tradeRestrictedResources: boolean);
    constructor(type: DiplomaticRelationType, initiator: Empire | null, thisEmpire: Empire | null, otherEmpire: Empire | null, a: boolean | number, b?: boolean) {
        this.type = type;
        this.initiator = initiator;
        this.thisEmpire = thisEmpire;
        this.otherEmpire = otherEmpire;
        if (typeof a === 'number') {
            this.lastDiplomacyTradeOfferDate = a;
            this.tradeBonus = 0.0;
            this.supplyRestrictedResources = b!;
        } else {
            this.tradeBonus = 0.0;
            this.supplyRestrictedResources = a;
        }
    }

    /** DiplomaticRelation.cs 251 CloneLightWeight. */
    cloneLightWeight(newRelationType: DiplomaticRelationType): DiplomaticRelation {
        return new DiplomaticRelation(newRelationType, this.initiator, this.thisEmpire, this.otherEmpire, this.supplyRestrictedResources);
    }

    get yearsStored(): number {
        return this._yearsStored;
    }

    get warDamageTotal(): number {
        return (this.warDamageBuiltObject + this.warDamageColony) | 0;
    }

    // DiplomaticRelation.cs 117 CalculateStartOfYear.
    private calculateStartOfYear(date: number): number {
        const num = date % this._yearLength;
        return date - num;
    }

    // DiplomaticRelation.cs 123 AgeTradeValues.
    ageTradeValues(currentStarDate: number): void {
        const startOfYear = this.calculateStartOfYear(currentStarDate);
        const num = startOfYear - this._yearLength * this._yearsStored;
        const yearlyTradeValueList: YearlyTradeValue[] = [];
        for (let index = 0; index < this._tradeValues.count; ++index) {
            const tradeValue = this._tradeValues.items[index];
            if (tradeValue != null && tradeValue.year < num) yearlyTradeValueList.push(tradeValue);
        }
        for (let index = 0; index < yearlyTradeValueList.length; ++index) {
            const i = this._tradeValues.items.indexOf(yearlyTradeValueList[index]);
            if (i >= 0) this._tradeValues.items.splice(i, 1);
        }
        if (this._tradeValues.getByYear(startOfYear) !== null) return;
        this._tradeValues.items.push(new YearlyTradeValue(startOfYear));
    }

    /**
     * DiplomaticRelation.cs 103 PerformTradeTransaction.
     * TODO(port): EmpireCounters.ProcessTradeBonus + Galaxy.DoCharacterEvent(TradeIncome, ambassadors)
     * (EmpireCounters not ported). Never called during game creation (no trade has happened).
     */
    performTradeTransaction(_value: number, _starDate: number): void {
        throw new Error('TODO(port): DiplomaticRelation.cs PerformTradeTransaction (EmpireCounters.ProcessTradeBonus)');
    }

    // DiplomaticRelation.cs 179 NormalizedAnnualTradeValue.
    get normalizedAnnualTradeValue(): number {
        return this.totalTradeValue / Math.max(1, this.yearsTradeVolumeStored);
    }

    private get yearsTradeVolumeStored(): number {
        let tradeVolumeStored = 0;
        if (this._tradeValues != null) {
            for (let index = 0; index < this._tradeValues.count; ++index) {
                const tradeValue = this._tradeValues.items[index];
                if (tradeValue != null && tradeValue.value >= 0.0) ++tradeVolumeStored;
            }
        }
        return tradeVolumeStored;
    }

    get totalTradeValue(): number {
        let totalTradeValue = 0.0;
        if (this._tradeValues != null) {
            for (let index = 0; index < this._tradeValues.count; ++index) {
                const tradeValue = this._tradeValues.items[index];
                if (tradeValue != null && tradeValue.value >= 0.0) totalTradeValue += tradeValue.value;
            }
        }
        return totalTradeValue;
    }

    /**
     * DiplomaticRelation.cs 160 AnnualTradeBonus.
     * TODO(port): Galaxy.TradeBonusMaximumFreeTrade(Amount) / TradeBonusMaximumMutualDefense(Amount)
     * statics are not in the TS Galaxy; TradeBonus is 0.0 on every game-start relation, so the
     * result is 0 whenever those statics are finite. Throws for the treaty types until ported.
     */
    get annualTradeBonus(): number {
        switch (this.type) {
            case DiplomaticRelationType.FreeTradeAgreement:
            case DiplomaticRelationType.MutualDefensePact:
            case DiplomaticRelationType.Protectorate:
                throw new Error('TODO(port): DiplomaticRelation.cs AnnualTradeBonus (Galaxy.TradeBonusMaximum* statics)');
        }
        const val1 = 0.0;
        return this.tradeBonus * Math.min(val1, this.normalizedAnnualTradeValue);
    }
}

// DiplomaticRelationList.cs (SyncList<DiplomaticRelation> + EmpireId-1 → index table).
export class DiplomaticRelationList implements Iterable<DiplomaticRelation> {
    private readonly items: DiplomaticRelation[] = [];
    private readonly _otherEmpireIndexer: number[];
    invertEmpireIndexing = false;

    constructor() {
        this._otherEmpireIndexer = new Array<number>(MAXIMUM_EMPIRE_COUNT + 1);
        for (let index = 0; index < MAXIMUM_EMPIRE_COUNT + 1; ++index) this._otherEmpireIndexer[index] = -1;
    }

    get count(): number {
        return this.items.length;
    }
    /** Alias of Count for code written against the previous `unknown[]` stub. */
    get length(): number {
        return this.items.length;
    }
    /** this[int index] */
    at(index: number): DiplomaticRelation {
        if (index < 0 || index >= this.items.length) throw new RangeError('Index was out of range.');
        return this.items[index];
    }
    [Symbol.iterator](): Iterator<DiplomaticRelation> {
        return this.items[Symbol.iterator]();
    }
    toArray(): DiplomaticRelation[] {
        return this.items.slice();
    }

    /** this[Empire otherEmpire] (DiplomaticRelationList.cs 31). */
    byEmpire(otherEmpire: Empire | null): DiplomaticRelation | null {
        if (otherEmpire == null) return null;
        const index = otherEmpire.empireId - 1;
        return index >= 0 && index < MAXIMUM_EMPIRE_COUNT && this._otherEmpireIndexer[index] >= 0 ? this.at(this._otherEmpireIndexer[index]) : null;
    }

    private decrementIndexes(aboveIndex: number): void {
        if (aboveIndex < 0) return;
        for (let index = 0; index < this._otherEmpireIndexer.length; ++index) {
            if (this._otherEmpireIndexer[index] > aboveIndex) --this._otherEmpireIndexer[index];
        }
    }

    // DiplomaticRelationList.cs 54 GetHighestAllianceName.
    getHighestAllianceName(): string {
        let diplomaticRelation1: DiplomaticRelation | null = null;
        for (let index = 0; index < this.count; ++index) {
            const diplomaticRelation2 = this.items[index];
            if (diplomaticRelation2 != null && diplomaticRelation2.allianceName) {
                if (diplomaticRelation1 === null) {
                    diplomaticRelation1 = diplomaticRelation2;
                } else {
                    switch (diplomaticRelation1.type) {
                        case DiplomaticRelationType.FreeTradeAgreement:
                            if (diplomaticRelation2.type === DiplomaticRelationType.Protectorate || diplomaticRelation2.type === DiplomaticRelationType.MutualDefensePact) diplomaticRelation1 = diplomaticRelation2;
                            continue;
                        case DiplomaticRelationType.Protectorate:
                            if (diplomaticRelation2.type === DiplomaticRelationType.MutualDefensePact) diplomaticRelation1 = diplomaticRelation2;
                            continue;
                        default:
                            continue;
                    }
                }
            }
        }
        return diplomaticRelation1 !== null ? diplomaticRelation1.allianceName : '';
    }

    // DiplomaticRelationList.cs 92 FindOldestRelationByType.
    findOldestRelationByType(type: DiplomaticRelationType): DiplomaticRelation | null {
        let oldestRelationByType: DiplomaticRelation | null = null;
        for (let index = 0; index < this.count; ++index) {
            if (this.items[index].type === type && (oldestRelationByType === null || this.items[index].startDateOfLastChange < oldestRelationByType.startDateOfLastChange)) {
                oldestRelationByType = this.items[index];
            }
        }
        return oldestRelationByType;
    }

    countSubjugatedDominions(): number {
        let num = 0;
        for (let index = 0; index < this.count; ++index) {
            const r = this.items[index];
            if (r != null && r.type === DiplomaticRelationType.SubjugatedDominion && r.initiator === r.thisEmpire) ++num;
        }
        return num;
    }

    countRelationsByType(type: DiplomaticRelationType): number {
        let num = 0;
        for (let index = 0; index < this.count; ++index) {
            if (this.items[index] != null && this.items[index].type === type) ++num;
        }
        return num;
    }

    /** DiplomaticRelationList.cs 133: C# `a && b || c || d` precedence kept (null item would throw in C#). */
    countTreaties(): number {
        let num = 0;
        for (let index = 0; index < this.count; ++index) {
            if (
                (this.items[index] != null && this.items[index].type === DiplomaticRelationType.FreeTradeAgreement) ||
                this.items[index].type === DiplomaticRelationType.MutualDefensePact ||
                this.items[index].type === DiplomaticRelationType.Protectorate
            ) {
                ++num;
            }
        }
        return num;
    }

    countMet(): number {
        let num = 0;
        for (let index = 0; index < this.count; ++index) {
            if (this.items[index] != null && this.items[index].type !== DiplomaticRelationType.NotMet) ++num;
        }
        return num;
    }

    // DiplomaticRelationList.cs 155 RemoveAt.
    removeAt(index: number): void {
        const diplomaticRelation = this.at(index);
        if (this.invertEmpireIndexing) this._otherEmpireIndexer[diplomaticRelation.thisEmpire!.empireId - 1] = -1;
        else this._otherEmpireIndexer[diplomaticRelation.otherEmpire!.empireId - 1] = -1;
        this.items.splice(index, 1);
        this.decrementIndexes(index);
    }

    // DiplomaticRelationList.cs 168 Remove.
    remove(diplomaticRelation: DiplomaticRelation): void {
        let aboveIndex = -1;
        const len = this._otherEmpireIndexer.length;
        if (this.invertEmpireIndexing) {
            const e = diplomaticRelation.thisEmpire;
            if (e !== null && e.empireId > 0 && e.empireId < len) aboveIndex = this._otherEmpireIndexer[e.empireId - 1];
        } else {
            const e = diplomaticRelation.otherEmpire;
            if (e !== null && e.empireId > 0 && e.empireId < len) aboveIndex = this._otherEmpireIndexer[e.empireId - 1];
        }
        if (this.invertEmpireIndexing) {
            const e = diplomaticRelation.thisEmpire;
            if (e !== null && e.empireId > 0 && e.empireId < len) this._otherEmpireIndexer[e.empireId - 1] = -1;
        } else {
            const e = diplomaticRelation.otherEmpire;
            if (e !== null && e.empireId > 0 && e.empireId < len) this._otherEmpireIndexer[e.empireId - 1] = -1;
        }
        const i = this.items.indexOf(diplomaticRelation); // List<T>.Remove: first occurrence
        if (i >= 0) this.items.splice(i, 1);
        this.decrementIndexes(aboveIndex);
    }

    // DiplomaticRelationList.cs 189 Add (no duplicate check).
    add(diplomaticRelation: DiplomaticRelation): void {
        if (this.invertEmpireIndexing) {
            const num = diplomaticRelation.thisEmpire!.empireId - 1;
            if (num >= 0 && num < MAXIMUM_EMPIRE_COUNT) this._otherEmpireIndexer[diplomaticRelation.thisEmpire!.empireId - 1] = this.count;
        } else {
            const num = diplomaticRelation.otherEmpire!.empireId - 1;
            if (num >= 0 && num < MAXIMUM_EMPIRE_COUNT) this._otherEmpireIndexer[diplomaticRelation.otherEmpire!.empireId - 1] = this.count;
        }
        this.items.push(diplomaticRelation);
    }
}

// ---------------------------------------------------------------------------
// Empire methods (C# `this` = `empire`).
// ---------------------------------------------------------------------------

/** Empire.4.cs 137 ObtainDiplomaticRelation(empire). Adds a NotMet relation for an unknown active empire. */
export function obtainDiplomaticRelation(self: Empire, empire: Empire | null): DiplomaticRelation {
    if (empire == null) return new DiplomaticRelation(DiplomaticRelationType.None, self, self, empire, true);
    if (empire === self.galaxy.independentEmpire) return new DiplomaticRelation(DiplomaticRelationType.None, self, self, empire, true);
    if (empire.pirateEmpireBaseHabitat !== null || self.pirateEmpireBaseHabitat !== null) return new DiplomaticRelation(DiplomaticRelationType.None, self, self, empire, true);
    if (empire === self) return new DiplomaticRelation(DiplomaticRelationType.None, self, self, empire, true);
    if (self.diplomaticRelations != null) {
        let diplomaticRelation = self.diplomaticRelations.byEmpire(empire);
        if (diplomaticRelation === null) {
            diplomaticRelation = new DiplomaticRelation(DiplomaticRelationType.NotMet, self, self, empire, false);
            if (empire.active) self.diplomaticRelations.add(diplomaticRelation);
        }
        return diplomaticRelation;
    }
    return new DiplomaticRelation(DiplomaticRelationType.None, self, self, empire, true);
}

/** Empire.9.cs 1696 ResolveEmpiresToDefendAgainst (EmpireList.Add = List.Add, no dedupe). */
export function resolveEmpiresToDefendAgainst(self: Empire): Empire[] {
    const empireList: Empire[] = [];
    if (self.pirateEmpireBaseHabitat !== null) {
        for (let i = 0; i < self.pirateRelations.count; i++) {
            const pirateRelation = self.pirateRelations.get(i);
            if (pirateRelation != null && pirateRelation.otherEmpire !== null && pirateRelation.type === PirateRelationType.None) empireList.push(pirateRelation.otherEmpire);
        }
    } else {
        for (let j = 0; j < self.diplomaticRelations.count; j++) {
            const diplomaticRelation = self.diplomaticRelations.at(j);
            if (diplomaticRelation == null) continue;
            if (diplomaticRelation.type === DiplomaticRelationType.War) {
                empireList.push(diplomaticRelation.otherEmpire!);
                continue;
            }
            switch (diplomaticRelation.strategy) {
                case DiplomaticStrategy.Conquer:
                case DiplomaticStrategy.Defend:
                case DiplomaticStrategy.DefendPlacate:
                case DiplomaticStrategy.DefendUndermine:
                case DiplomaticStrategy.Punish:
                    if (!diplomaticRelation.otherEmpire!.reclusive) empireList.push(diplomaticRelation.otherEmpire!);
                    break;
            }
        }
    }
    return empireList;
}

const seen = (st: SystemVisibilityStatus): boolean => st === SystemVisibilityStatus.Explored || st === SystemVisibilityStatus.Visible;

/**
 * Start.2.cs 1376-1427 (after the starting ships, before the pirate-player meeting block
 * 1428): every ordered pair (item8, item9) of distinct starting empires in `empireList`
 * order scans galaxy.Systems in order; the pair has met in a system when item8 has it
 * Explored/Visible and item9 has it Visible (flag2), or when both have it Explored/Visible
 * and `Galaxy.Rnd.Next(0, 3) == 1` (the draw is short-circuited unless both have it
 * Explored/Visible — it is taken even if the first test already set flag2). At the first
 * met system: create `None` relations on both sides if item8 has none with item9
 * (item8's: initiator item8, this item8, other item9; item9's: initiator item8, this item9,
 * other item8; tradeRestrictedResources false), or upgrade NotMet → None on both sides;
 * then `break` to the next pair. No other state (dates, strategy) is set.
 *
 * Rnd: one Next(0,3) per system both empires have Explored/Visible, per ordered pair,
 * until that pair's first met system.
 */
export function meetEmpiresAtStart(galaxy: Galaxy, empireList: readonly Empire[]): void {
    for (const item8 of empireList) {
        for (const item9 of empireList) {
            if (item9 === item8) continue;
            for (let num36 = 0; num36 < galaxy.systems.length; num36++) {
                const idx = galaxy.systems[num36].systemStar.systemIndex;
                const status = item9.systemVisibility[idx].status;
                const status2 = item8.systemVisibility[idx].status;
                let flag2 = false;
                if (seen(status2) && status === SystemVisibilityStatus.Visible) flag2 = true;
                if (seen(status) && seen(status2) && galaxy.rnd.next(0, 3) === 1) flag2 = true;
                if (!flag2) continue;
                let diplomaticRelation = item8.diplomaticRelations.byEmpire(item9);
                if (diplomaticRelation === null) {
                    diplomaticRelation = new DiplomaticRelation(DiplomaticRelationType.None, item8, item8, item9, false);
                    item8.diplomaticRelations.add(diplomaticRelation);
                    diplomaticRelation = new DiplomaticRelation(DiplomaticRelationType.None, item8, item9, item8, false);
                    item9.diplomaticRelations.add(diplomaticRelation);
                } else if (diplomaticRelation.type === DiplomaticRelationType.NotMet) {
                    diplomaticRelation.type = DiplomaticRelationType.None;
                    let diplomaticRelation2 = item9.diplomaticRelations.byEmpire(item8);
                    if (diplomaticRelation2 === null) {
                        diplomaticRelation2 = new DiplomaticRelation(DiplomaticRelationType.None, item8, item9, item8, false);
                        item9.diplomaticRelations.add(diplomaticRelation2);
                    } else if (diplomaticRelation2.type === DiplomaticRelationType.NotMet) {
                        diplomaticRelation2.type = DiplomaticRelationType.None;
                    }
                }
                break;
            }
        }
    }
}
