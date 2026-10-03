// Diplomacy model: port of DiplomaticRelationType.cs, DiplomaticStrategy.cs,
// DiplomaticRelation.cs, DiplomaticRelationList.cs, YearlyTradeValue(.List).cs,
// WarObjective.cs, WarEndReason.cs, EmpireEvaluation(.List).cs (M4r),
// Empire.4.cs ObtainEmpireEvaluation (106), GovernmentBiasList.GetBias / GovernmentAttributes.NaturalAffinity,
// the diplomatic counters of EmpireCounters.cs (M4r),
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

import { isReadOnlyGalaxy, requestUiRecord } from './readOnlyQuery';
import type { Empire } from './empire';
import type { Galaxy } from './galaxy';
import type { Habitat } from './types';
import type { BuiltObject } from './builtObject';
import { REAL_SECONDS_IN_GALACTIC_YEAR } from './galaxyTime';
import { SystemVisibilityStatus } from './visibility';
import { PirateRelationType } from './pirateRelations';
import { resolveStandardRaceBias } from './raceBias';
import { reputationChannel } from './scenario/reputation/channel';

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

// WarObjective.cs (member order exact).
export enum WarObjective {
    Undefined,
    TotalConquest,
    CaptureObjectives,
    EndWar,
}

// WarEndReason.cs (byte enum; member order exact).
export enum WarEndReason {
    Undefined,
    ObjectivesMet,
    WarWearinessExceeded,
    WantEnd,
    AtWarWithOtherEmpires,
    HeavyLosses,
    NoAttackFleets,
}

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
    warObjective: WarObjective = WarObjective.Undefined;
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

    // DiplomaticRelation.cs 103 PerformTradeTransaction: logistics/contracts.ts performTradeTransaction(galaxy, relation, …).

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

    /** DiplomaticRelation.cs 140 AnnualTradeBonus (Galaxy.3.cs 5064-5067 TradeBonusMaximum* statics). */
    get annualTradeBonus(): number {
        let val1 = 0.0;
        switch (this.type) {
            case DiplomaticRelationType.FreeTradeAgreement: {
                const maximumFreeTrade = TRADE_BONUS_MAXIMUM_FREE_TRADE;
                val1 = TRADE_BONUS_MAXIMUM_FREE_TRADE_AMOUNT / maximumFreeTrade;
                break;
            }
            case DiplomaticRelationType.MutualDefensePact:
            case DiplomaticRelationType.Protectorate: {
                const maximumMutualDefense = TRADE_BONUS_MAXIMUM_MUTUAL_DEFENSE;
                val1 = TRADE_BONUS_MAXIMUM_MUTUAL_DEFENSE_AMOUNT / maximumMutualDefense;
                break;
            }
        }
        return this.tradeBonus * Math.min(val1, this.normalizedAnnualTradeValue);
    }
}

/** Galaxy.3.cs 5064-5067. */
export const TRADE_BONUS_MAXIMUM_FREE_TRADE = 0.2;
export const TRADE_BONUS_MAXIMUM_FREE_TRADE_AMOUNT = 20000.0;
export const TRADE_BONUS_MAXIMUM_MUTUAL_DEFENSE = 0.3;
export const TRADE_BONUS_MAXIMUM_MUTUAL_DEFENSE_AMOUNT = 30000.0;

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
            // A read-only galaxy (a UI read, readOnlyQuery.ts) gets the same NotMet relation, detached; the add the C# UI
            // makes becomes a journaled command (requestUiRecord).
            if (empire.active) {
                if (!isReadOnlyGalaxy(self.galaxy)) self.diplomaticRelations.add(diplomaticRelation);
                else requestUiRecord(self.galaxy, 'diplomaticRelation', self, empire);
            }
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

// ---------------------------------------------------------------------------
// M4r: EmpireEvaluation.cs (the attitude model), EmpireEvaluationList.cs, ObtainEmpireEvaluation.
// ---------------------------------------------------------------------------

/** EmpireEvaluation.cs 42-51 statics. */
export const SYSTEM_COMPETITION_CAP = 20.0;
export const SYSTEM_COMPETITION_CAP_EXTENDED = 30.0;
export const RELATIONSHIP_WITH_FRIENDS_CAP = 10.0;
export const COVETOUSNESS_CAP = 25.0;
export const GOVERNMENT_STYLE_AFFINITY_CAP = 12.0;
export const INCIDENT_EVALUATION_CAP = 80.0;
export const INCIDENT_EVALUATION_CAP_NEGATIVE = -150.0;
export const RESTRICTED_RESOURCE_TRADING_CAP = 10.0;
export const FIRST_CONTACT_PENALTY_START_AMOUNT = -15.0;
export const FIRST_CONTACT_PENALTY_ANNUAL_REDUCTION_AMOUNT = 6.0;

/** Galaxy.AggressionLevel (Galaxy.cs 1034; galaxy.ts M4r field). */
function galaxyAggressionLevel(galaxy: Galaxy): number {
    return galaxy.aggressionLevel;
}

/**
 * EmpireEvaluation.cs — how the owning empire regards `empire`. C# properties that transform on read
 * (IncidentEvaluation, Bias: ÷ or × DiplomacyFactor) are TS accessors over the raw fields; the raw fields
 * keep their C# names with a leading underscore.
 */
export class EmpireEvaluation {
    private _empire: Empire | null;
    _incidentEvaluation: number; // double
    systemCompetition: number; // int
    tradeVolume: number; // int
    relationshipWithFriendsPositive: number; // int
    relationshipWithFriendsNegative: number; // int
    covetousness = 0; // int
    blockades = 0; // int
    governmentStyleAffinity = 0; // int
    militaryForcesInSystems = 0; // int
    envy = 0; // int
    _bias: number; // double
    restrictedResourceTrading: number; // double
    militaryRefueling = 0; // int
    miningRights = 0; // int
    racialOffense = 0.0; // double
    private _slaveryOffense = 0.0; // double
    diplomacyFactor = 1.0; // double
    lastSystemWarningDate = 0; // long
    lastSystemWarningIndex = -1; // int
    civilityRatingWeight = 0.5; // double
    firstContactPenalty = FIRST_CONTACT_PENALTY_START_AMOUNT; // double
    systemCompetitionCumulative = 0.0;
    relationshipWithFriendsPositiveCumulative = 0.0;
    relationshipWithFriendsNegativeCumulative = 0.0;
    covetousnessCumulative = 0.0;
    governmentStyleAffinityCumulative = 0.0;

    /** EmpireEvaluation(Empire empire, Galaxy galaxy) (EmpireEvaluation.cs 72). */
    constructor(empire: Empire | null, galaxy: Galaxy) {
        this._empire = empire;
        this._incidentEvaluation = 0.0;
        this.systemCompetition = 0;
        this.tradeVolume = 0;
        this.relationshipWithFriendsPositive = 0;
        this.relationshipWithFriendsNegative = 0;
        this._bias = 0.0;
        this.restrictedResourceTrading = 0.0;
        this.firstContactPenalty = FIRST_CONTACT_PENALTY_START_AMOUNT * galaxyAggressionLevel(galaxy);
    }

    setSlaveryOffense(slaveryOffense: number): void {
        this._slaveryOffense = slaveryOffense;
    }
    get slaveryOffense(): number {
        return this._slaveryOffense;
    }
    clear(): void {
        this._empire = null;
    }
    get empire(): Empire | null {
        return this._empire;
    }

    /**
     * 19o reputation channel (scenario/reputation/ledger.ts): `_IncidentEvaluation` as the attitude reads it — the stock
     * accumulator plus the reputation ledger's incident entries for this pair, clamped to the setter's caps
     * [IncidentEvaluationCapNegative, IncidentEvaluationCap] (EmpireEvaluation.cs 202-215). This is the one place the C#
     * sums incidents into the attitude: OverallAttitude (EmpireEvaluation.cs 96 `double incidentEvaluation =
     * this._IncidentEvaluation`), OverallAttitudeWithoutSystemCompetition (157) and the IncidentEvaluation getter (199)
     * all read it through here. Ledger off / no entries: exactly `_incidentEvaluation`.
     */
    private incidentTotal(): number {
        const hook = reputationChannel.incident;
        if (hook === null) return this._incidentEvaluation;
        const x = hook(this);
        if (x === null) return this._incidentEvaluation;
        return Math.max(INCIDENT_EVALUATION_CAP_NEGATIVE, Math.min(INCIDENT_EVALUATION_CAP, this._incidentEvaluation + x));
    }

    /** 19o: `_Bias` plus the ledger's bias entries (EmpireEvaluation.cs 147 / 157 / 302 read it). Off: `_bias`. */
    private biasTotal(): number {
        const hook = reputationChannel.bias;
        if (hook === null) return this._bias;
        const x = hook(this);
        return x === null ? this._bias : this._bias + x;
    }

    // C# `value <= 0.0 ? value * AggressionLevel / DiplomacyFactor : value / AggressionLevel * DiplomacyFactor`.
    private weigh(value: number, aggressionLevel: number): number {
        return value <= 0.0 ? (value * aggressionLevel) / this.diplomacyFactor : (value / aggressionLevel) * this.diplomacyFactor;
    }

    /** EmpireEvaluation.cs 98 OverallAttitude (reads this._Empire.Galaxy.AggressionLevel). */
    get overallAttitude(): number {
        const a = galaxyAggressionLevel(this._empire!.galaxy);
        const num1 = 0.0;
        const num3 = num1 + this.weigh(this.incidentTotal(), a);
        const num5 = num3 + this.weigh(this.systemCompetitionCumulative, a);
        const num7 = num5 + this.weigh(this.tradeVolume, a);
        const num9 = num7 + this.weigh(this.relationshipWithFriendsPositiveCumulative, a);
        const num11 = num9 + this.weigh(this.relationshipWithFriendsNegativeCumulative, a);
        const num13 = num11 + this.weigh(this.covetousnessCumulative, a);
        const num15 = num13 + this.weigh(this.blockades, a);
        const num17 = num15 + this.weigh(this.governmentStyleAffinityCumulative, a);
        const num19 = num17 + this.weigh(this.militaryForcesInSystems, a);
        const num21 = num19 + this.weigh(this.restrictedResourceTrading, a);
        const num23 = num21 + this.weigh(this.envy, a);
        const num25 = num23 + this.weigh(this.militaryRefueling, a);
        const num27 = num25 + this.weigh(this.miningRights, a);
        const num29 = num27 + this.weigh(this.racialOffense, a);
        const num31 = num29 + this.weigh(this._slaveryOffense, a);
        const num33 = num31 + this.weigh(this.firstContactPenalty, a);
        const num35 = num33 + this.weigh(this.reputationWeighted, a);
        const num36 = this.weigh(this.biasTotal(), a);
        return Math.trunc(num35 + num36);
    }

    /** EmpireEvaluation.cs 143 OverallAttitudeWithoutSystemCompetition. */
    get overallAttitudeWithoutSystemCompetition(): number {
        const a = galaxyAggressionLevel(this._empire!.galaxy);
        const num1 =
            this.incidentTotal() +
            this.tradeVolume +
            this.relationshipWithFriendsPositiveCumulative +
            this.relationshipWithFriendsNegativeCumulative +
            this.covetousnessCumulative +
            this.blockades +
            this.governmentStyleAffinityCumulative +
            this.militaryForcesInSystems +
            this.restrictedResourceTrading +
            this.envy +
            this.militaryRefueling +
            this.miningRights +
            this.racialOffense +
            this.firstContactPenalty +
            this.reputationWeighted +
            this.biasTotal();
        const num2 = num1 <= 0.0 ? num1 * a : num1 / a;
        return num2 <= 0.0 ? Math.trunc(num2 / this.diplomacyFactor) : Math.trunc(num2 * this.diplomacyFactor);
    }

    /** EmpireEvaluation.cs 153 ReputationWeighted. */
    get reputationWeighted(): number {
        const num = Math.sqrt(Math.min(4.0, this._empire!.relativeEmpireSize));
        let reputationWeighted = this._empire!.civilityRating * this.civilityRatingWeight;
        if (reputationWeighted < 0.0) reputationWeighted *= num;
        return reputationWeighted;
    }

    get incidentEvaluationRaw(): number {
        return this._incidentEvaluation;
    }

    /**
     * The stock IncidentEvaluation getter without the 19o ledger (÷/× DiplomacyFactor of the raw field). Read-modify-write
     * sites (`x.incidentEvaluation = f(x.incidentEvaluation)`) read this so the ledger never bakes into the stock field.
     * Equal to `incidentEvaluation` whenever the ledger is off or empty for the pair.
     */
    get incidentEvaluationStock(): number {
        const incidentEvaluation = this._incidentEvaluation;
        return incidentEvaluation <= 0.0 ? incidentEvaluation / this.diplomacyFactor : incidentEvaluation * this.diplomacyFactor;
    }

    /** EmpireEvaluation.cs 185 IncidentEvaluation: get ÷/× DiplomacyFactor (19o: of incidentTotal); set clamps to [-150, 80]. */
    get incidentEvaluation(): number {
        const incidentEvaluation = this.incidentTotal();
        return incidentEvaluation <= 0.0 ? incidentEvaluation / this.diplomacyFactor : incidentEvaluation * this.diplomacyFactor;
    }
    set incidentEvaluation(value: number) {
        this._incidentEvaluation = value;
        if (this._incidentEvaluation > INCIDENT_EVALUATION_CAP) {
            this._incidentEvaluation = INCIDENT_EVALUATION_CAP;
        } else {
            if (this._incidentEvaluation >= INCIDENT_EVALUATION_CAP_NEGATIVE) return;
            this._incidentEvaluation = INCIDENT_EVALUATION_CAP_NEGATIVE;
        }
    }

    get biasRaw(): number {
        return this._bias;
    }

    /** The stock Bias getter without the 19o ledger (read-modify-write sites). Equal to `bias` with the ledger off. */
    get biasStock(): number {
        const bias = this._bias;
        return bias <= 0.0 ? bias / this.diplomacyFactor : bias * this.diplomacyFactor;
    }

    /** EmpireEvaluation.cs 280 Bias: get ÷/× DiplomacyFactor (19o: of biasTotal); set raw. */
    get bias(): number {
        const bias = this.biasTotal();
        return bias <= 0.0 ? bias / this.diplomacyFactor : bias * this.diplomacyFactor;
    }
    set bias(value: number) {
        this._bias = value;
    }
}

/** Empire.EmpireEvaluations (EmpireEvaluationList) — empire.ts declares the field `unknown[]`. */
export function empireEvaluationsOf(empire: Empire): EmpireEvaluation[] {
    return empire.empireEvaluations as EmpireEvaluation[];
}

/** EmpireEvaluationList.cs 14 this[Empire empire] (first match, or null). */
export function empireEvaluationByEmpire(list: readonly EmpireEvaluation[], empire: Empire | null): EmpireEvaluation | null {
    for (let index = 0; index < list.length; ++index) {
        const empireEvaluation = list[index];
        if (empireEvaluation.empire === empire) return empireEvaluation;
    }
    return null;
}

/** EmpireEvaluationList.cs 29 GetLowestEvaluation(excludeEmpires). */
export function getLowestEvaluation(list: readonly EmpireEvaluation[], excludeEmpires: readonly Empire[] = []): EmpireEvaluation | null {
    let lowestEvaluation: EmpireEvaluation | null = null;
    for (let index = 0; index < list.length; ++index) {
        const empireEvaluation = list[index];
        if (empireEvaluation != null && !excludeEmpires.includes(empireEvaluation.empire!) && (lowestEvaluation === null || lowestEvaluation.overallAttitude > empireEvaluation.overallAttitude)) {
            lowestEvaluation = empireEvaluation;
        }
    }
    return lowestEvaluation;
}

/** Empire.4.cs 106 ObtainEmpireEvaluation(empire): adds a new evaluation (race bias) for an active empire. */
export function obtainEmpireEvaluation(galaxy: Galaxy, self: Empire, empire: Empire | null): EmpireEvaluation {
    if (empire == null) return new EmpireEvaluation(empire, galaxy);
    if (empire === galaxy.independentEmpire) return new EmpireEvaluation(empire, galaxy);
    if (empire.pirateEmpireBaseHabitat !== null || self.pirateEmpireBaseHabitat !== null) return new EmpireEvaluation(empire, galaxy);
    if (self.empireEvaluations != null && empire != null) {
        const evaluations = empireEvaluationsOf(self);
        let empireEvaluation = empireEvaluationByEmpire(evaluations, empire);
        if (empireEvaluation === null) {
            empireEvaluation = new EmpireEvaluation(empire, galaxy);
            empireEvaluation.bias = resolveStandardRaceBias(self.dominantRace, empire.dominantRace);
            // A read-only galaxy (a UI read, readOnlyQuery.ts) gets the same new evaluation, detached; the add becomes a
            // journaled command (requestUiRecord).
            if (empire.active) {
                if (!isReadOnlyGalaxy(galaxy)) evaluations.push(empireEvaluation);
                else requestUiRecord(galaxy, 'empireEvaluation', self, empire);
            }
        }
        return empireEvaluation;
    }
    return new EmpireEvaluation(empire, galaxy);
}

// ---------------------------------------------------------------------------
// M4r: GovernmentAttributes.Biases (GovernmentBiasList.cs) — NaturalAffinity.
// ---------------------------------------------------------------------------

/** Per-government bias rows (governmentBiases.txt), registered by createGame like setGovernmentsStatic. */
let governmentBiasesStatic: { governmentId: number; biases: number[] }[] = [];
export function setGovernmentBiasesStatic(rows: { governmentId: number; biases: number[] }[]): void {
    governmentBiasesStatic = rows;
}

/**
 * GovernmentAttributes.cs 105 NaturalAffinity(governmentId) = Biases.GetBias(governmentId) (GovernmentBiasList.cs 99):
 * the row of `ownGovernmentId` (GovernmentBiasList.LoadFromFile sets governments[row id].Biases = (index, value)
 * pairs; a government without a row has an empty list → 0). The loader keeps the LAST row for an id.
 */
export function governmentNaturalAffinity(ownGovernmentId: number, governmentId: number): number {
    let row: { governmentId: number; biases: number[] } | null = null;
    for (let i = 0; i < governmentBiasesStatic.length; i++) {
        if (governmentBiasesStatic[i].governmentId === ownGovernmentId) row = governmentBiasesStatic[i];
    }
    if (row === null) return 0;
    return governmentId >= 0 && governmentId < row.biases.length ? row.biases[governmentId] : 0;
}

// ---------------------------------------------------------------------------
// M4r: the diplomatic counters of EmpireCounters.cs (BrokenTreatyCount, SubjugationsMade, WarsWeStartedCount,
// WarsDeclaredOnUsCount, _AtWarStartDate, _TimeSpentAtWarExcludingCurrent), kept in Empire.diplomacyCounters beside
// empire.ts's EmpireCounters. Callers: Empire.8.cs 2631-2632 ChangeDiplomaticRelation (diplomacyTick.ts), Empire.3.cs 3480
// (diplomacyTick.ts), Empire.cs 4948 (events.ts); FixupAtWarCounter: Empire.1.cs 3963 (diplomacyTick.ts); readers: victory.ts,
// achievements.ts.
// ---------------------------------------------------------------------------

/** long.MaxValue stand-in for EmpireCounters._AtWarStartDate "not at war". */
export const LONG_MAX_VALUE = Number.MAX_SAFE_INTEGER;

export class DiplomacyCounters {
    brokenTreatyCount = 0;
    subjugationsMade = 0;
    warsWeStartedCount = 0;
    warsDeclaredOnUsCount = 0;
    atWarStartDate = LONG_MAX_VALUE;
    timeSpentAtWarExcludingCurrent = 0;

    /** EmpireCounters.cs 113 FixupAtWarCounter(starDate). */
    fixupAtWarCounter(starDate: number): void {
        this.timeSpentAtWarExcludingCurrent += starDate - this.atWarStartDate;
        this.atWarStartDate = LONG_MAX_VALUE;
    }
}

/** EmpireCounters.cs 148/157 ProcessRelationChange(relation, initiator, newRelationType, starDate[, previousRelationType]). */
export function processRelationChange(counters: DiplomacyCounters, countersEmpire: Empire, relation: DiplomaticRelation | null, initiator: Empire | null, newRelationType: DiplomaticRelationType, starDate: number, previousRelationTypeArg: DiplomaticRelationType | null = null): void {
    // `if (!previousRelationType.HasValue) previousRelationType = relation.Type` — read before the null check, as in C#.
    const previousRelationType = previousRelationTypeArg ?? relation!.type;
    if (relation == null || initiator == null) return;
    switch (newRelationType) {
        case DiplomaticRelationType.None:
        case DiplomaticRelationType.SubjugatedDominion:
        case DiplomaticRelationType.TradeSanctions:
        case DiplomaticRelationType.War:
            switch (previousRelationType) {
                case DiplomaticRelationType.FreeTradeAgreement:
                case DiplomaticRelationType.MutualDefensePact:
                case DiplomaticRelationType.Protectorate:
                    if (initiator === countersEmpire) ++counters.brokenTreatyCount;
                    break;
            }
            break;
    }
    if (newRelationType === DiplomaticRelationType.SubjugatedDominion && initiator === countersEmpire) ++counters.subjugationsMade;
    if (newRelationType === DiplomaticRelationType.War) {
        if (initiator === countersEmpire) ++counters.warsWeStartedCount;
        else ++counters.warsDeclaredOnUsCount;
    }
    if (newRelationType === DiplomaticRelationType.War) {
        if (counters.atWarStartDate !== LONG_MAX_VALUE) return;
        counters.atWarStartDate = starDate;
    } else {
        if (previousRelationType !== DiplomaticRelationType.War || checkAtWarExcluding(relation.thisEmpire!, relation.otherEmpire) || counters.atWarStartDate === LONG_MAX_VALUE) return;
        counters.timeSpentAtWarExcludingCurrent += starDate - counters.atWarStartDate;
        counters.atWarStartDate = LONG_MAX_VALUE;
    }
}

/** Empire.9.cs 1362 CheckAtWar(Empire excludeEmpire) (null = any war). */
export function checkAtWarExcluding(self: Empire, excludeEmpire: Empire | null): boolean {
    for (let i = 0; i < self.diplomaticRelations.count; i++) {
        const diplomaticRelation = self.diplomaticRelations.at(i);
        if (diplomaticRelation.type === DiplomaticRelationType.War && diplomaticRelation.otherEmpire !== excludeEmpire) return true;
    }
    return false;
}
