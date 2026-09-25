// Pirate relations: port of PirateRelationType.cs, PirateRelationEvaluationType.cs,
// PirateRelation.cs, PirateRelationList.cs, the Empire pirate-relation methods
// (Empire.8.cs ObtainPirateRelation / AddPirateRelation / CancelPirateDefendMissions /
// ChangePirateRelation / ChangePirateRelationThisSideOnly / ChangePirateEvaluation,
// Empire.cs SetPirateRelationEmpires, Empire.3.cs CheckHaveMetPirates) and the
// Start.2.cs 1428-1471 block in which a pirate player meets the normal empires.
//
// C# numeric semantics: every Evaluation* field and DiplomacyFactor is `float`, so
// each store goes through Math.fround; dates are `long` (safe integers here).
// The Empire methods are free functions taking the C# `this` as first argument.

import type { Empire } from './empire';
import type { Galaxy } from './galaxy';
import { REAL_SECONDS_IN_GALACTIC_YEAR, startStarDateForAge } from './galaxyTime';
import { SystemVisibilityStatus } from './visibility';
import type { BuiltObject } from './builtObject';
import type { Habitat } from './types';
import type { BuiltObjectMissionType } from './missions/mission';
import { empireShipGroups, shipGroupCompleteMission, type ShipGroup } from './fleets/shipGroup';
import { EmpireActivityType } from './pirates/empireActivity';

// BuiltObjectMissionType values used by CancelPirateDefendMissions. pirateRelations.ts is loaded early by empire.ts, so
// it must not pull missions/mission.ts (and with it builtObject.ts / types.ts) in at runtime; the values are the
// enum's declaration indexes (checked in test/m4s1Market.test.ts).
export const MISSION_TYPE_ATTACK = 9 as BuiltObjectMissionType;
export const MISSION_TYPE_WAIT_AND_ATTACK = 16 as BuiltObjectMissionType;
export const MISSION_TYPE_WAIT_AND_BOMBARD = 17 as BuiltObjectMissionType;
export const MISSION_TYPE_MOVE_AND_WAIT = 18 as BuiltObjectMissionType;
export const MISSION_TYPE_BOMBARD = 27 as BuiltObjectMissionType;
export const MISSION_TYPE_CAPTURE = 28 as BuiltObjectMissionType;
export const MISSION_TYPE_RAID = 30 as BuiltObjectMissionType;

const f = Math.fround;

// PirateRelationType.cs (byte enum; member order exact).
export enum PirateRelationType {
    NotMet,
    None,
    Protection,
}

// PirateRelationEvaluationType.cs (byte enum; member order exact).
export enum PirateRelationEvaluationType {
    Gifts,
    OffenseOverRequests,
    DetectedIntelligenceMissions,
    PirateMissionsSucceed,
    PirateMissionsFail,
    ShipAttacks,
    ProtectionCancelled,
    CovetedColony,
    LongRelationship,
    RaidsAgainstOurColonies,
}

/**
 * Galaxy.CurrentStarDate (Galaxy.cs 1098) = elapsed game ms + _StartStarDate, with
 * _StartStarDate = StartStarDate + Age * 30000000 (Start.2.cs 450-451) and the elapsed game ms
 * kept by the M4a sim clock (galaxy.nowMs, 0 until the first sim frame; tick/simTime.ts galaxyStarDate).
 */
export function galaxyCurrentStarDate(galaxy: Galaxy): number {
    return startStarDateForAge(galaxy.age) + galaxy.nowMs;
}

// PirateRelation.cs
export class PirateRelation {
    type: PirateRelationType;
    private _thisEmpire: Empire | null = null;
    private _thisEmpireId = -1;
    private _otherEmpire: Empire | null = null;
    private _otherEmpireId = -1;
    evaluationGifts = 0; // float
    evaluationOffenseOverRequests = 0; // float
    evaluationDetectedIntelligenceMissions = 0; // float
    evaluationPirateMissionsSucceed = 0; // float
    evaluationPirateMissionsFail = 0; // float
    evaluationShipAttacks = 0; // float
    evaluationProtectionCancelled = 0; // float
    evaluationCovetedColonies = 0; // float
    evaluationLongRelationship = 0; // float
    evaluationRaidsAgainstOurColonies = 0; // float
    diplomacyFactor = 1.0; // float 1f
    lastChangeDate = 0; // long
    lastOfferDate = 0; // long
    lastInfoDate = 0; // long
    monthlyProtectionFeeToThisEmpire = 0.0; // double
    lastProtectionFeePaymentDate = 0; // long

    /** PirateRelation(Empire, Empire, PirateRelationType) (PirateRelation.cs 43). */
    constructor(thisEmpire: Empire | null, otherEmpire: Empire | null, relationType: PirateRelationType);
    /** internal PirateRelation(int thisEmpireId, int otherEmpireId, PirateRelationType) (PirateRelation.cs 36; deserialization). */
    constructor(thisEmpireId: number, otherEmpireId: number, relationType: PirateRelationType);
    constructor(a: Empire | null | number, b: Empire | null | number, relationType: PirateRelationType) {
        if (typeof a === 'number' && typeof b === 'number') {
            this._thisEmpireId = a;
            this._otherEmpireId = b;
        } else {
            this.thisEmpire = a as Empire | null;
            this.otherEmpire = b as Empire | null;
        }
        this.type = relationType;
    }

    relationshipLength(starDate: number): number {
        return starDate - this.lastChangeDate;
    }

    // PirateRelation.cs 52 CalculateOffenseOverCancellingProtection.
    calculateOffenseOverCancellingProtection(starDate: number): number {
        let num1 = f(5);
        const num2 = this.relationshipLength(starDate);
        const num3 = Math.trunc(REAL_SECONDS_IN_GALACTIC_YEAR * 1000.0 * 0.5); // (long)
        if (num2 < num3) {
            const num4 = 1.0 - num2 / num3;
            num1 = Math.max(f(5), Math.min(f(20), f(num1 + f(num1 * num4 * 3.0))));
        }
        return f(num1 * -1);
    }

    private factored(v: number): number {
        return v >= 0.0 ? f(v * this.diplomacyFactor) : f(v / this.diplomacyFactor);
    }
    get evaluationCovetedColoniesFactored(): number { return this.factored(this.evaluationCovetedColonies); }
    get evaluationDetectedIntelligenceMissionsFactored(): number { return this.factored(this.evaluationDetectedIntelligenceMissions); }
    get evaluationGiftsFactored(): number { return this.factored(this.evaluationGifts); }
    get evaluationOffenseOverRequestsFactored(): number { return this.factored(this.evaluationOffenseOverRequests); }
    get evaluationPirateMissionsFailFactored(): number { return this.factored(this.evaluationPirateMissionsFail); }
    get evaluationPirateMissionsSucceedFactored(): number { return this.factored(this.evaluationPirateMissionsSucceed); }
    get evaluationProtectionCancelledFactored(): number { return this.factored(this.evaluationProtectionCancelled); }
    get evaluationShipAttacksFactored(): number { return this.factored(this.evaluationShipAttacks); }
    get evaluationLongRelationshipFactored(): number { return this.factored(this.evaluationLongRelationship); }
    get evaluationRaidsAgainstOurColoniesFactored(): number { return this.factored(this.evaluationRaidsAgainstOurColonies); }

    // PirateRelation.cs 154 NeutralizeEvaluation (EvaluationLongRelationship is not touched).
    neutralizeEvaluation(neutralizationAmount: number): void {
        let num1 = 0;
        if (this.evaluationDetectedIntelligenceMissions !== 0.0) ++num1;
        if (this.evaluationGifts !== 0.0) ++num1;
        if (this.evaluationOffenseOverRequests !== 0.0) ++num1;
        if (this.evaluationPirateMissionsSucceed !== 0.0) ++num1;
        if (this.evaluationPirateMissionsFail !== 0.0) ++num1;
        if (this.evaluationProtectionCancelled !== 0.0) ++num1;
        if (this.evaluationShipAttacks !== 0.0) ++num1;
        if (this.evaluationCovetedColonies !== 0.0) ++num1;
        if (this.evaluationRaidsAgainstOurColonies !== 0.0) ++num1;
        // float / (float)int: num1 == 0 gives ±Infinity/NaN as in C#.
        const num2 = f(f(neutralizationAmount) / num1);
        const step = (v: number): number => {
            if (v > 0.0) return Math.max(0.0, f(v - num2));
            if (v < 0.0) return Math.min(0.0, f(v + num2));
            return v;
        };
        this.evaluationDetectedIntelligenceMissions = step(this.evaluationDetectedIntelligenceMissions);
        this.evaluationGifts = step(this.evaluationGifts);
        this.evaluationOffenseOverRequests = step(this.evaluationOffenseOverRequests);
        this.evaluationPirateMissionsSucceed = step(this.evaluationPirateMissionsSucceed);
        this.evaluationPirateMissionsFail = step(this.evaluationPirateMissionsFail);
        this.evaluationProtectionCancelled = step(this.evaluationProtectionCancelled);
        this.evaluationShipAttacks = step(this.evaluationShipAttacks);
        this.evaluationCovetedColonies = step(this.evaluationCovetedColonies);
        this.evaluationRaidsAgainstOurColonies = step(this.evaluationRaidsAgainstOurColonies);
    }

    // PirateRelation.cs 273 Evaluation (float sum in C# source order).
    get evaluation(): number {
        let num = this.evaluationGifts;
        num = f(num + this.evaluationOffenseOverRequests);
        num = f(num + this.evaluationDetectedIntelligenceMissions);
        num = f(num + this.evaluationLongRelationship);
        num = f(num + this.evaluationPirateMissionsSucceed);
        num = f(num + this.evaluationPirateMissionsFail);
        num = f(num + this.evaluationProtectionCancelled);
        num = f(num + this.evaluationShipAttacks);
        num = f(num + this.evaluationCovetedColonies);
        num = f(num + this.evaluationRaidsAgainstOurColonies);
        return this.factored(num);
    }

    get thisEmpire(): Empire | null {
        return this._thisEmpire;
    }
    set thisEmpire(value: Empire | null) {
        this._thisEmpire = value;
        this._thisEmpireId = this._thisEmpire !== null ? this._thisEmpire.empireId : -1;
    }
    get thisEmpireId(): number {
        return this._thisEmpireId;
    }

    get otherEmpire(): Empire | null {
        return this._otherEmpire;
    }
    set otherEmpire(value: Empire | null) {
        this._otherEmpire = value;
        this._otherEmpireId = this._otherEmpire !== null ? this._otherEmpire.empireId : -1;
    }
    get otherEmpireId(): number {
        return this._otherEmpireId;
    }

    // PirateRelation.cs 311 FixupEmpires.
    fixupEmpires(galaxy: Galaxy | null): void {
        if (galaxy !== null && galaxy.empires != null && galaxy.pirateEmpires != null) {
            if (galaxy.independentEmpire !== null) {
                if (galaxy.independentEmpire.empireId === this._thisEmpireId) this._thisEmpire = galaxy.independentEmpire;
                if (galaxy.independentEmpire.empireId === this._otherEmpireId) this._otherEmpire = galaxy.independentEmpire;
            }
            for (let index = 0; index < galaxy.empires.length; ++index) {
                const empire = galaxy.empires[index];
                if (empire != null && empire.active) {
                    if (empire.empireId === this._thisEmpireId) this._thisEmpire = empire;
                    if (empire.empireId === this._otherEmpireId) this._otherEmpire = empire;
                }
            }
            for (let index = 0; index < galaxy.pirateEmpires.length; ++index) {
                const pirateEmpire = galaxy.pirateEmpires[index];
                if (pirateEmpire != null && pirateEmpire.active) {
                    if (pirateEmpire.empireId === this._thisEmpireId) this._thisEmpire = pirateEmpire;
                    if (pirateEmpire.empireId === this._otherEmpireId) this._otherEmpire = pirateEmpire;
                }
            }
        }
        if (this._thisEmpire === null) this._thisEmpireId = -1;
        if (this._otherEmpire !== null) return;
        this._otherEmpireId = -1;
    }
}

const INDEX_LENGTH = 255; // new short[(int) byte.MaxValue]

// PirateRelationList.cs (List<PirateRelation> + OtherEmpireId → index table).
// The lock is irrelevant single-threaded; serialization (GetObjectData / ctor) is TODO(port).
export class PirateRelationList implements Iterable<PirateRelation> {
    private readonly items: PirateRelation[] = [];
    private _otherEmpireIndexes: number[] = new Array<number>(INDEX_LENGTH).fill(-1);

    constructor() {
        this.resetIndexes();
    }

    get count(): number {
        return this.items.length;
    }
    /** this[index] */
    get(index: number): PirateRelation {
        return this.items[index];
    }
    [Symbol.iterator](): Iterator<PirateRelation> {
        return this.items[Symbol.iterator]();
    }
    toArray(): PirateRelation[] {
        return this.items.slice();
    }

    // PirateRelationList.cs 115 FixupEmpires.
    fixupEmpires(galaxy: Galaxy | null): void {
        for (let index = 0; index < this.count; ++index) {
            if (this.items[index] != null) {
                this.items[index].fixupEmpires(galaxy);
                if (this.items[index].otherEmpireId >= 0 && this._otherEmpireIndexes.length > this.items[index].otherEmpireId) {
                    this._otherEmpireIndexes[this.items[index].otherEmpireId & 0xff] = index;
                }
            }
        }
    }

    private recalculateIndexes(): void {
        this.resetIndexes();
        for (let index = 0; index < this.count; ++index) {
            const pirateRelation = this.items[index];
            if (pirateRelation != null && pirateRelation.otherEmpireId >= 0 && this._otherEmpireIndexes.length > pirateRelation.otherEmpireId) {
                this._otherEmpireIndexes[pirateRelation.otherEmpireId & 0xff] = index;
            }
        }
    }

    /** Returns the existing relation with the same OtherEmpire, else adds (AddRaw may silently drop it) and returns the argument. */
    add(pirateRelation: PirateRelation): PirateRelation {
        for (let index = 0; index < this.count; ++index) {
            const pirateRelation1 = this.items[index];
            if (pirateRelation1 != null && pirateRelation1.otherEmpire === pirateRelation.otherEmpire) return pirateRelation1;
        }
        this.addRaw(pirateRelation);
        return pirateRelation;
    }

    addRaw(pirateRelation: PirateRelation): void {
        if (pirateRelation.otherEmpireId < 0 || this._otherEmpireIndexes.length <= pirateRelation.otherEmpireId) return;
        this._otherEmpireIndexes[pirateRelation.otherEmpireId & 0xff] = this.count;
        this.items.push(pirateRelation);
    }

    /** List<T>.Clear (PirateRelationList does not override it: the _OtherEmpireIndexes stay, lookups check Count). Added by M4z1. */
    clear(): void {
        this.items.length = 0;
    }

    remove(pirateRelation: PirateRelation): void {
        if (pirateRelation.otherEmpireId >= 0 && this._otherEmpireIndexes.length > pirateRelation.otherEmpireId) {
            this._otherEmpireIndexes[pirateRelation.otherEmpireId & 0xff] = -1;
        }
        const i = this.items.indexOf(pirateRelation); // List<T>.Remove: first occurrence
        if (i >= 0) this.items.splice(i, 1);
        this.recalculateIndexes();
    }

    getRelationByOtherEmpire(otherEmpire: Empire | null): PirateRelation | null {
        if (otherEmpire !== null && otherEmpire.empireId >= 0 && otherEmpire.empireId < this._otherEmpireIndexes.length) {
            const otherEmpireIndex = this._otherEmpireIndexes[otherEmpire.empireId & 0xff];
            if (otherEmpireIndex >= 0 && this.count > otherEmpireIndex) return this.items[otherEmpireIndex];
        }
        return null;
    }

    getRelationByOtherEmpireId(otherEmpireId: number): PirateRelation | null {
        if (otherEmpireId >= 0) {
            const otherEmpireIndex = this._otherEmpireIndexes[otherEmpireId & 0xff];
            // (byte)255 indexes past the 255-long array in C# → IndexOutOfRange; undefined here.
            if (otherEmpireIndex >= 0 && this.count > otherEmpireIndex) return this.items[otherEmpireIndex];
        }
        return null;
    }

    getRelationWithLowestEvaluation(): PirateRelation | null {
        let lowestEvaluation: PirateRelation | null = null;
        for (let index = 0; index < this.count; ++index) {
            const pirateRelation = this.items[index];
            if (pirateRelation != null && pirateRelation.type !== PirateRelationType.NotMet && (lowestEvaluation === null || pirateRelation.evaluation < lowestEvaluation.evaluation)) {
                lowestEvaluation = pirateRelation;
            }
        }
        return lowestEvaluation;
    }

    getRelationsAboveThreshold(evaluationThreshold: number): PirateRelationList {
        const result = new PirateRelationList();
        for (const r of this.items) {
            if (r != null && r.type !== PirateRelationType.NotMet && r.evaluation >= f(evaluationThreshold)) result.add(r);
        }
        return result;
    }

    getRelationsAboveThresholdAndByType(evaluationThreshold: number, relationType: PirateRelationType): PirateRelationList {
        const result = new PirateRelationList();
        for (const r of this.items) {
            if (r != null && r.type === relationType && r.evaluation >= f(evaluationThreshold)) result.add(r);
        }
        return result;
    }

    getRelationsBelowThreshold(evaluationThreshold: number): PirateRelationList {
        const result = new PirateRelationList();
        for (const r of this.items) {
            if (r != null && r.type !== PirateRelationType.NotMet && r.evaluation <= f(evaluationThreshold)) result.add(r);
        }
        return result;
    }

    countKnownPirateFactions(): number {
        let num = 0;
        for (const r of this.items) {
            if (r != null && r.type !== PirateRelationType.NotMet && r.otherEmpire !== null && r.otherEmpire.pirateEmpireBaseHabitat !== null) ++num;
        }
        return num;
    }

    getRelationsByType(relationType: PirateRelationType): PirateRelationList {
        const result = new PirateRelationList();
        for (const r of this.items) if (r != null && r.type === relationType) result.add(r);
        return result;
    }

    /** EmpireList.Add (dedupes). */
    resolveEmpiresWithProtection(): Empire[] {
        const empireList: Empire[] = [];
        for (const r of this.items) {
            if (r != null && r.type === PirateRelationType.Protection && r.otherEmpire !== null && !empireList.includes(r.otherEmpire)) empireList.push(r.otherEmpire);
        }
        return empireList;
    }

    private resetIndexes(): void {
        this._otherEmpireIndexes = new Array<number>(INDEX_LENGTH).fill(-1);
    }
}

// ---------------------------------------------------------------------------
// Empire methods (C# `this` = `empire`).
// ---------------------------------------------------------------------------

/** Empire.8.cs 2351 ObtainPirateRelation(otherEmpire). */
export function obtainPirateRelation(empire: Empire, otherEmpire: Empire | null): PirateRelation {
    if (otherEmpire === null) return new PirateRelation(empire, otherEmpire, PirateRelationType.None);
    if (otherEmpire === empire) return new PirateRelation(empire, otherEmpire, PirateRelationType.Protection);
    let pirateRelation = empire.pirateRelations.getRelationByOtherEmpire(otherEmpire);
    if (pirateRelation === null) pirateRelation = addPirateRelation(empire, otherEmpire, galaxyCurrentStarDate(empire.galaxy));
    return pirateRelation;
}

/** Empire.8.cs 2368/2373 AddPirateRelation(otherEmpire, [relationType = NotMet,] starDate). */
export function addPirateRelation(empire: Empire, otherEmpire: Empire, starDate: number): PirateRelation;
export function addPirateRelation(empire: Empire, otherEmpire: Empire, relationType: PirateRelationType, starDate: number): PirateRelation;
export function addPirateRelation(empire: Empire, otherEmpire: Empire, a: number, b?: number): PirateRelation {
    const relationType: PirateRelationType = b === undefined ? PirateRelationType.NotMet : a;
    const starDate = b === undefined ? a : b;
    const pirateRelation = new PirateRelation(empire, otherEmpire, relationType);
    pirateRelation.lastChangeDate = starDate;
    pirateRelation.lastProtectionFeePaymentDate = starDate;
    return empire.pirateRelations.add(pirateRelation);
}

/**
 * Empire.8.cs 2382 CancelPirateDefendMissions(otherEmpire, evaluationPenaltyIfPirate) (ported by M4s s1): drop the
 * accepted Defend missions otherEmpire gave this faction (bidding over), -20 EvaluationPirateMissionsFail when a
 * penalised pirate, complete the fleets guarding / attacking those targets, and release open bids (+10 s). No Rnd here
 * (ShipGroup.CompleteMission is an M4l stub).
 */
export function cancelPirateDefendMissions(empire: Empire, otherEmpire: Empire, evaluationPenaltyIfPirate: boolean): void {
    const galaxy = empire.galaxy;
    const shipGroupList: ShipGroup[] = [];
    const pirateRelation = obtainPirateRelation(otherEmpire, empire);
    const empireActivityList = empire.pirateMissions.resolveByTypeAndRequester(EmpireActivityType.Defend, otherEmpire);
    const shipGroups = empireShipGroups(empire);
    for (let i = 0; i < empireActivityList.count; i++) {
        const empireActivity = empireActivityList.at(i);
        if (empireActivity === null || empireActivity.assignedEmpire !== empire || empireActivity.bidTimeRemaining > 0) continue;
        empireActivity.requestingEmpire!.pirateMissions.removeEquivalent(empireActivity);
        empire.pirateMissions.removeEquivalent(empireActivity);
        if (empireActivity.assignedEmpire !== null && empireActivity.assignedEmpire.pirateMissions != null) empireActivity.assignedEmpire.pirateMissions.removeEquivalent(empireActivity);
        if (galaxy.pirateMissions.containsEquivalent(empireActivity)) galaxy.pirateMissions.removeEquivalent(empireActivity);
        if (evaluationPenaltyIfPirate && empire.pirateEmpireBaseHabitat !== null) {
            pirateRelation.evaluationPirateMissionsFail = f(pirateRelation.evaluationPirateMissionsFail - 20);
        }
        // ShipGroupList.cs 242 ResolveFleetsWithWaitTarget / 102 ResolveFleetsWithAttackTarget(StellarObject).
        for (const shipGroup of resolveFleetsWithTarget(shipGroups, empireActivity.target, false)) {
            if (!shipGroupList.includes(shipGroup)) shipGroupList.push(shipGroup);
        }
        for (const shipGroup2 of resolveFleetsWithTarget(shipGroups, empireActivity.target, true)) {
            if (!shipGroupList.includes(shipGroup2)) shipGroupList.push(shipGroup2);
        }
    }
    for (let l = 0; l < galaxy.pirateMissions.count; l++) {
        const empireActivity2 = galaxy.pirateMissions.at(l);
        if (empireActivity2 !== null && empireActivity2.type === EmpireActivityType.Defend && empireActivity2.requestingEmpire === otherEmpire && empireActivity2.bidTimeRemaining > 0 && empireActivity2.assignedEmpire === empire) {
            empireActivity2.assignedEmpire = null;
            empireActivity2.bidTimeRemaining += 10000;
        }
    }
    for (let m = 0; m < shipGroupList.length; m++) shipGroupCompleteMission(galaxy, shipGroupList[m]);
}

/**
 * ShipGroupList.cs 242 ResolveFleetsWithWaitTarget(target) (attack = false: MoveAndWait missions) and 102
 * ResolveFleetsWithAttackTarget(StellarObject) (attack = true) for a Habitat / BuiltObject target.
 */
function resolveFleetsWithTarget(shipGroups: (ShipGroup | null)[], target: Habitat | BuiltObject | null, attack: boolean): ShipGroup[] {
    const result: ShipGroup[] = [];
    for (let index = 0; index < shipGroups.length; ++index) {
        const shipGroup = shipGroups[index];
        if (shipGroup == null || shipGroup.leadShip === null || shipGroup.mission === null) continue;
        const t = shipGroup.mission.type;
        const matchesType = attack
            ? t === MISSION_TYPE_ATTACK || t === MISSION_TYPE_WAIT_AND_ATTACK || t === MISSION_TYPE_BOMBARD || t === MISSION_TYPE_WAIT_AND_BOMBARD || t === MISSION_TYPE_CAPTURE || t === MISSION_TYPE_RAID
            : t === MISSION_TYPE_MOVE_AND_WAIT;
        if (!matchesType || target === null) continue;
        // `case BuiltObject: Mission.TargetBuiltObject == target` / `case Habitat: Mission.TargetHabitat == target`: the
        // other accessor is null for a target of the other kind, so comparing both is the same test.
        if (shipGroup.mission.targetBuiltObject === target || shipGroup.mission.targetHabitat === target) result.push(shipGroup);
    }
    return result;
}

/** Empire.8.cs 2445/2450 ChangePirateRelation(otherEmpire, relationType, starDate[, monthlyFeeToThisEmpire = 0.0]). */
export function changePirateRelation(empire: Empire, otherEmpire: Empire | null, relationType: PirateRelationType, starDate: number, monthlyFeeToThisEmpire = 0.0): void {
    if (otherEmpire === null) return;
    const pirateRelation = obtainPirateRelation(empire, otherEmpire);
    const pirateRelation2 = obtainPirateRelation(otherEmpire, empire);
    if (pirateRelation.type === relationType) return;
    let flag = false;
    if ((pirateRelation.type === PirateRelationType.NotMet || pirateRelation.type === PirateRelationType.None) && relationType === PirateRelationType.None) flag = true;
    if (pirateRelation.type === PirateRelationType.Protection && relationType !== PirateRelationType.Protection) {
        let evaluationPenaltyIfPirate = false;
        if (empire.pirateEmpireBaseHabitat !== null) evaluationPenaltyIfPirate = true;
        cancelPirateDefendMissions(empire, otherEmpire, evaluationPenaltyIfPirate);
        cancelPirateDefendMissions(otherEmpire, empire, false);
    }
    pirateRelation.type = relationType;
    pirateRelation.lastChangeDate = starDate;
    pirateRelation.lastOfferDate = starDate;
    pirateRelation.lastProtectionFeePaymentDate = starDate;
    pirateRelation.evaluationLongRelationship = 0.0;
    pirateRelation2.type = relationType;
    pirateRelation2.lastChangeDate = starDate;
    pirateRelation2.lastOfferDate = starDate;
    pirateRelation2.lastProtectionFeePaymentDate = starDate;
    pirateRelation2.evaluationLongRelationship = 0.0;
    if (flag) {
        pirateRelation.lastOfferDate = 0;
        pirateRelation.lastInfoDate = 0;
        pirateRelation2.lastOfferDate = 0;
        pirateRelation2.lastInfoDate = 0;
    }
    pirateRelation.monthlyProtectionFeeToThisEmpire = monthlyFeeToThisEmpire;
}

/** Empire.8.cs 2497 ChangePirateRelationThisSideOnly. */
export function changePirateRelationThisSideOnly(empire: Empire, otherEmpire: Empire | null, relationType: PirateRelationType, starDate: number): void {
    if (otherEmpire !== null) {
        const pirateRelation = obtainPirateRelation(empire, otherEmpire);
        if (pirateRelation.type !== relationType) {
            pirateRelation.type = relationType;
            pirateRelation.lastChangeDate = starDate;
            pirateRelation.lastOfferDate = starDate;
            pirateRelation.lastProtectionFeePaymentDate = starDate;
        }
    }
}

/** Empire.8.cs 2512 ChangePirateEvaluation (float +=). */
export function changePirateEvaluation(empire: Empire, otherEmpire: Empire | null, evaluationChangeAmount: number, evaluationType: PirateRelationEvaluationType): void {
    if (otherEmpire === null) return;
    const r = obtainPirateRelation(empire, otherEmpire);
    const amt = f(evaluationChangeAmount);
    switch (evaluationType) {
        case PirateRelationEvaluationType.DetectedIntelligenceMissions:
            r.evaluationDetectedIntelligenceMissions = f(r.evaluationDetectedIntelligenceMissions + amt);
            break;
        case PirateRelationEvaluationType.Gifts:
            r.evaluationGifts = f(r.evaluationGifts + amt);
            break;
        case PirateRelationEvaluationType.OffenseOverRequests:
            r.evaluationOffenseOverRequests = f(r.evaluationOffenseOverRequests + amt);
            break;
        case PirateRelationEvaluationType.PirateMissionsFail:
            r.evaluationPirateMissionsFail = f(r.evaluationPirateMissionsFail + amt);
            break;
        case PirateRelationEvaluationType.PirateMissionsSucceed:
            r.evaluationPirateMissionsSucceed = f(r.evaluationPirateMissionsSucceed + amt);
            break;
        case PirateRelationEvaluationType.ProtectionCancelled:
            r.evaluationProtectionCancelled = f(r.evaluationProtectionCancelled + amt);
            break;
        case PirateRelationEvaluationType.ShipAttacks:
            r.evaluationShipAttacks = f(r.evaluationShipAttacks + amt);
            break;
        case PirateRelationEvaluationType.CovetedColony:
            r.evaluationCovetedColonies = f(r.evaluationCovetedColonies + amt);
            break;
        case PirateRelationEvaluationType.LongRelationship:
            r.evaluationLongRelationship = f(r.evaluationLongRelationship + amt);
            break;
        case PirateRelationEvaluationType.RaidsAgainstOurColonies:
            r.evaluationRaidsAgainstOurColonies = f(r.evaluationRaidsAgainstOurColonies + amt);
            break;
    }
}

/** Empire.cs 3612 SetPirateRelationEmpires (Start.cs 1853 / 1864, after load). */
export function setPirateRelationEmpires(empire: Empire, galaxy: Galaxy): void {
    if (empire.pirateRelations != null) empire.pirateRelations.fixupEmpires(galaxy);
}

/** Empire.3.cs 3528 CheckHaveMetPirates(empire) — instance method that ignores `this`. */
export function checkHaveMetPirates(empire: Empire | null): boolean {
    if (empire !== null && empire.pirateRelations != null) {
        for (let i = 0; i < empire.pirateRelations.count; i++) {
            const pirateRelation = empire.pirateRelations.get(i);
            if (pirateRelation != null && pirateRelation.type !== PirateRelationType.NotMet && pirateRelation.otherEmpire !== null && pirateRelation.otherEmpire.pirateEmpireBaseHabitat !== null) {
                return true;
            }
        }
    }
    return false;
}

const seen = (st: SystemVisibilityStatus): boolean => st === SystemVisibilityStatus.Explored || st === SystemVisibilityStatus.Visible;

/**
 * Start.2.cs 1428-1471: `if (empire2.PirateEmpireBaseHabitat != null)` — the player's
 * empire (`empire2`; only a pirate when playing as pirates) meets every active normal
 * empire (`galaxy.Empires`, which excludes pirate factions) with which it shares a
 * system: per system in galaxy.Systems order, met if the pirate has it Explored/Visible
 * and the other empire has it Visible, or (Rnd.Next(0,3) == 1 when both have it
 * Explored/Visible — the draw is short-circuited otherwise); stop at the first met system.
 * Types are set directly (not via ChangePirateRelation), so only ObtainPirateRelation's
 * AddPirateRelation dates (CurrentStarDate) are stored.
 *
 * NOT included: the next statement, Start.2.cs 1472
 * `empire2.ColonizationTargets = empire2.PirateReviewColoniesToControl();`
 * (pirates.ts pirateReviewColoniesToControl), which the caller must run afterwards
 * inside the same `if`.
 */
export function meetPiratesAtStart(galaxy: Galaxy, empire2: Empire, empires: readonly Empire[] = galaxy.empires): void {
    if (empire2.pirateEmpireBaseHabitat === null) return;
    for (let num37 = 0; num37 < empires.length; num37++) {
        const empire5 = empires[num37];
        if (empire5 == null || !empire5.active || empire5 === empire2) continue;
        for (let num38 = 0; num38 < galaxy.systems.length; num38++) {
            const systemInfo = galaxy.systems[num38];
            const idx = systemInfo.systemStar.systemIndex;
            const status3 = empire5.visibility.systemVisibility[idx].status;
            const status4 = empire2.visibility.systemVisibility[idx].status;
            let flag3 = false;
            if (seen(status4) && status3 === SystemVisibilityStatus.Visible) flag3 = true;
            if (seen(status3) && seen(status4) && galaxy.rnd.next(0, 3) === 1) flag3 = true;
            if (!flag3) continue;
            const pirateRelation = obtainPirateRelation(empire2, empire5);
            if (pirateRelation.type === PirateRelationType.NotMet) {
                pirateRelation.type = PirateRelationType.None;
                const pirateRelation2 = obtainPirateRelation(empire5, empire2);
                if (pirateRelation2.type === PirateRelationType.NotMet) pirateRelation2.type = PirateRelationType.None;
                if (empire2.pirateEmpireBaseHabitat !== null && empire5.knownPirateEmpires != null && !empire5.knownPirateEmpires.includes(empire2)) {
                    empire5.knownPirateEmpires.push(empire2);
                }
                if (empire5.pirateEmpireBaseHabitat !== null && empire2.knownPirateEmpires != null && !empire2.knownPirateEmpires.includes(empire5)) {
                    empire2.knownPirateEmpires.push(empire5);
                }
            }
            break;
        }
    }
}
