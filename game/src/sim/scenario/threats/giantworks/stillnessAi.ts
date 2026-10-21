// The Stillness Engine, the AI's side (flag gwHarvestCycle, Age 2). Not a port; made of the Great Work AI's stock calls (ai.ts: strike fleets, patrols).
//
//   SIDES      once a month each AI empire (never the owner, never a holdout) takes a side from its people and its dealings with the owner: a lean from the leader's traits
//              (Expansionist / Isolationist), the race (race.expanding) and its aggression, shifted by how it rates the owner (attitude, the reputation ledger). A lean over
//              +stillnessSideAt is DESTROY, under -stillnessSideAt PROTECT, else it stays out. The sides show on the Knowledge page.
//   PROTECT    a protector keeps one patrol fleet at the Engine's base (stock Patrol; never its last fleets) while the Engine builds or runs.
//   DESTROY    an attacker with a colony within reach goes after it: not at war with the owner it declares war first, naming the Engine as the reason
//              (the news line), if the available warships can win (the base and the defenders near it, x stillnessAiStrikeMarginPct); with the Diet's "Demolish the
//              Stillness Engine" in force a member needs no war (stock Attack mission on the base). It sends a strike fleet strong enough, every review while
//              the Engine builds or runs; a switched off Engine is left alone.
//   BUILDERS   only an isolationist AI (lean under -stillnessBuildLean before the owner shift) that is at peace with everyone and has stillnessAiMoneyX times the cost in the
//              treasury, and only after stillnessAiMinYears of the age, rolls stillnessAiChancePct at each review (the module's own stream) to start one at its capital.
// Rnd: none on galaxy.rnd; the roll is age2Random(seed, counter).

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { BuiltObject } from '../../../builtObject';
import { CharacterTraitType } from '../../../data/races';
import { BuiltObjectRole } from '../../../data/designSpecifications';
import { DiplomaticRelationType, obtainDiplomaticRelation, obtainEmpireEvaluation } from '../../../diplomacy';
import { FleetPosture, declareWar, endWarRequest, militaryPotency } from '../../../diplomacyTick';
import { calculateOverallStrengthFactor } from '../../../combat/threats';
import { findNearestAvailableFleet, obtainAvailableMilitaryShips } from '../../../fleets/militaryAI';
import { empireShipGroups } from '../../../fleets/shipGroup';
import { determineDestroyOrCaptureTargetForFleet, shipGroupAssignMission, shipGroupCheckFleetTargetWithinFuelRangeAndRefuel } from '../../../fleets/shipGroupTasks';
import { BuiltObjectMissionPriority, BuiltObjectMissionType } from '../../../missions/mission';
import { isAiControlled } from '../../../missions/playerOrder';
import { galaxyStarDate } from '../../../tick/simTime';
import { YEAR_LENGTH } from '../../../galaxyTime';
import { isHumanEmpire } from '../../../humanEmpires';
import { getEmpireById } from '../../../logistics/contracts';
import { determineEmpiresAtWarWith } from '../../../treasury';
import { GAME_DAY_LENGTH, registerScenarioFramePeriodic } from '../../hooks';
import { scenarioNews, scenarioText as T } from '../../messages';
import { scenarioParam } from '../../state';
import { reputationOn, reputationSum } from '../../reputation/ledger';
import { personality } from '../../charactersVictory/diet/dietAi';
import { formStrikeFleet } from '../../smarterAI/pirates';
import { resolveSectorDescription } from '../../../empireEvents';
import { age2Random } from './age2World';
import { shipsWithin } from './actions';
import { HARVEST_CYCLE_FLAG } from './longNightState';
import { SP, STILL_TAG, beaconFinished, demolishLegal, engineOf, enginePosition, startEngine, stillState, stillnessActive, stillnessPlayers, type EngineRec, type EngineWar, type EngineSide } from './stillness';

const p = (g: Galaxy, name: string, fallback: number): number => scenarioParam(g, name, fallback);
export const AP = {
    /** The lean (either way) at which an empire takes a side. */
    sideAt: (g: Galaxy) => p(g, 'stillnessSideAt', 20),
    /** An AI builder's lean before the shift for the owner must be under minus this. */
    buildLean: (g: Galaxy) => p(g, 'stillnessBuildLean', 15),
    /** Treasury as a multiple of the cost an AI needs to start one. */
    moneyX: (g: Galaxy) => p(g, 'stillnessAiMoneyX', 3),
    /** Percent chance per review that an eligible AI starts one. */
    chancePct: (g: Galaxy) => p(g, 'stillnessAiChancePct', 1),
    /** Game years into the age before an AI may start one. */
    minYears: (g: Galaxy) => p(g, 'stillnessAiMinYears', 8),
    /** Attackers and patrols come from colonies within this many sectors. */
    reachSectors: (g: Galaxy) => p(g, 'stillnessAiReachSectors', 8),
    /** A strike must be this strong against the base and its defenders (%). */
    marginPct: (g: Galaxy) => p(g, 'stillnessAiStrikeMarginPct', 150),
    /** The defenders counted are armed ships of the owner and the protectors within this many sectors of the base. */
    defenceSectors: (g: Galaxy) => p(g, 'stillnessAiDefenceSectors', 1),
};

// ---------------------------------------------------------------------------------------------------------------
// Sides
// ---------------------------------------------------------------------------------------------------------------

/** How expansionist `e` is, before it knows who owns the Engine: + destroys, - protects (range about -60..+60). Pure. */
export function baseLean(e: Empire): number {
    const r = e.dominantRace;
    if (r === null) return 0;
    const pr = personality(e);
    let s = r.expanding ? 8 : -30;
    s += 30 * pr.aggression - 10 * pr.caution;
    if (pr.traits.has(CharacterTraitType.Expansionist)) s += 20;
    if (pr.traits.has(CharacterTraitType.Isolationist)) s -= 25;
    return s;
}

/** `e`'s lean toward the Engine `owner` built: the base lean, shifted by its attitude toward the owner and the reputation ledger (liked owners are protected). Pure. */
export function engineLean(galaxy: Galaxy, e: Empire, owner: Empire): number {
    const att = obtainEmpireEvaluation(galaxy, e, owner).overallAttitude;
    const rep = reputationOn(galaxy) ? Math.max(-50, Math.min(50, reputationSum(galaxy, e, owner))) : 0;
    return baseLean(e) - 0.3 * att - 0.3 * rep;
}

/** The side `e` takes against the Engine of `owner` (null: stays out). Pure. */
export function sideOf(galaxy: Galaxy, e: Empire, owner: Empire): EngineSide | null {
    const lean = engineLean(galaxy, e, owner);
    const at = AP.sideAt(galaxy);
    return lean >= at ? 'destroy' : lean <= -at ? 'protect' : null;
}

/** An isolationist AI: it may consider building. Pure. */
export function isolationist(galaxy: Galaxy, e: Empire): boolean {
    return baseLean(e) <= -AP.buildLean(galaxy);
}

// ---------------------------------------------------------------------------------------------------------------
// Strength, patrols and strikes
// ---------------------------------------------------------------------------------------------------------------

function armed(b: BuiltObject): boolean {
    return !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && b.topSpeed > 0;
}

/** The base and the armed ships of the owner and the protectors near it. Pure. */
export function defenders(galaxy: Galaxy, eng: EngineRec): BuiltObject[] {
    const base = eng.base;
    if (base === null || base.hasBeenDestroyed) return [];
    const guards = new Set<number>([eng.ownerId]);
    for (const k of Object.keys(eng.sides)) if (eng.sides[k] === 'protect') guards.add(Number(k));
    const range = Math.max(0.2, AP.defenceSectors(galaxy)) * galaxy.sectorSize;
    return shipsWithin(galaxy, base.xpos, base.ypos, range).filter((b) => armed(b) && b.actualEmpire !== null && guards.has(b.actualEmpire.empireId));
}

/** The strength a strike must bring: the base and its defenders, times the margin. Pure. */
export function strikeNeed(galaxy: Galaxy, eng: EngineRec): number {
    const base = eng.base;
    if (base === null) return 0;
    let s = Math.max(0, calculateOverallStrengthFactor(base));
    for (const b of defenders(galaxy, eng)) s += Math.max(0, calculateOverallStrengthFactor(b));
    return Math.trunc((s * AP.marginPct(galaxy)) / 100);
}

/** The strength of the warships `e` has free to send. Pure. */
export function freeStrength(galaxy: Galaxy, e: Empire): number {
    let s = 0;
    for (const b of obtainAvailableMilitaryShips(galaxy, e, 1, false, false, false)) if (b.topSpeed > 0) s += Math.max(0, calculateOverallStrengthFactor(b));
    return s;
}

function nearestColonyDistance(galaxy: Galaxy, e: Empire, x: number, y: number): number {
    let best = Number.MAX_VALUE;
    for (const h of e.colonies) if (h !== null && h.empire === e) best = Math.min(best, galaxy.calculateDistance(h.xpos, h.ypos, x, y));
    return best;
}

/** `e` has a colony near enough to send ships. Pure. */
export function inReach(galaxy: Galaxy, e: Empire, eng: EngineRec): boolean {
    const at = enginePosition(eng);
    return nearestColonyDistance(galaxy, e, at.x, at.y) / galaxy.sectorSize <= AP.reachSectors(galaxy);
}

function hasMissionOn(e: Empire, base: BuiltObject, type: BuiltObjectMissionType | null): boolean {
    for (const grp of empireShipGroups(e)) {
        const m = grp === null ? null : grp.mission;
        if (m !== null && m.targetBuiltObject === base && (type === null ? m.type !== BuiltObjectMissionType.Undefined : m.type === type)) return true;
    }
    return false;
}

/** One patrol fleet of `e` at the base (never its last fleets). True when one is on station or was sent. */
export function sendPatrol(galaxy: Galaxy, e: Empire, base: BuiltObject): boolean {
    const groups = empireShipGroups(e).filter((x) => x !== null);
    if (groups.length < 3) return false;
    if (hasMissionOn(e, base, BuiltObjectMissionType.Patrol)) return true;
    const fleet = findNearestAvailableFleet(galaxy, e, base.xpos, base.ypos, BuiltObjectMissionPriority.Low, 0, FleetPosture.Defend, true, 0.1, false, true, false, false);
    if (fleet === null || fleet.leadShip === null || !isAiControlled(fleet.leadShip)) return false;
    if (!shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, fleet, base.xpos, base.ypos, 0.1)) return false;
    return shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Patrol, base, null, BuiltObjectMissionPriority.Normal, true);
}

/** A strike fleet of `e` to destroy the base (the Great Work AI's call: stock Attack mission). True when one is on its way or was sent. */
export function sendStrike(galaxy: Galaxy, e: Empire, base: BuiltObject, need: number): boolean {
    if (hasMissionOn(e, base, null)) return true;
    let fleet = findNearestAvailableFleet(galaxy, e, base.xpos, base.ypos, BuiltObjectMissionPriority.Low, need, FleetPosture.Attack, true, 0.1, false, false, false, true);
    if (fleet === null) fleet = formStrikeFleet(galaxy, e, base.xpos, base.ypos, need);
    if (fleet === null || fleet.leadShip === null || !isAiControlled(fleet.leadShip)) return false;
    if (!shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, fleet, base.xpos, base.ypos, 0.1)) return false;
    return shipGroupAssignMission(galaxy, fleet, determineDestroyOrCaptureTargetForFleet(galaxy, e, fleet, base), base, null, BuiltObjectMissionPriority.High, true);
}

/** `a` declares war on `b` because of the Engine: listed first (the Diet's emergency case for a war on a member reads it: dietWarExcuse), unlisted again when the declaration is refused. */
export function declareOverEngine(galaxy: Galaxy, a: Empire, b: Empire, kind: EngineWar['kind']): boolean {
    const st = stillState(galaxy);
    const list = (st.wars ??= []);
    const rec: EngineWar = { a: a.empireId, b: b.empireId, kind, tries: 0 };
    list.push(rec);
    declareWar(galaxy, a, b);
    if (obtainDiplomaticRelation(a, b).type === DiplomaticRelationType.War) {
        st.stats.wars++;
        return true;
    }
    list.splice(list.indexOf(rec), 1);
    return false;
}

/** The attacker `e` goes after the Engine: war first when the Diet has not made it legal, then a strike. Returns whether a strike is on its way. */
export function attackEngine(galaxy: Galaxy, e: Empire, owner: Empire, eng: EngineRec): boolean {
    const base = eng.base;
    if (base === null || base.hasBeenDestroyed) return false;
    const need = strikeNeed(galaxy, eng);
    const atWar = obtainDiplomaticRelation(e, owner).type === DiplomaticRelationType.War;
    if (!atWar && !demolishLegal(galaxy, e)) {
        if (freeStrength(galaxy, e) < need) return false;
        if (!declareOverEngine(galaxy, e, owner, 'attack')) return false; // blocked (a truce, a rule): it goes no further
        if (!eng.warOver.includes(e.empireId)) eng.warOver.push(e.empireId);
        scenarioNews(galaxy, null, T(`${STILL_TAG} War News`, e.name, owner.name, resolveSectorDescription(galaxy, base.xpos, base.ypos)), () => true, base);
    }
    return sendStrike(galaxy, e, base, need);
}

// ---------------------------------------------------------------------------------------------------------------
// The review and the builders
// ---------------------------------------------------------------------------------------------------------------

/** AI empires that take part (never a human). Pure. */
function aiPlayers(galaxy: Galaxy): Empire[] {
    return stillnessPlayers(galaxy).filter((e) => !isHumanEmpire(galaxy, e));
}

/** The roll of the module's own stream: 0..1, one per call. */
function roll(galaxy: Galaxy): number {
    const st = stillState(galaxy);
    st.rolls++;
    return age2Random(galaxy.randomSeed ^ 0x53544c4c, st.rolls)();
}

/** The AI builder: the isolationist AIs at peace, with the money, after the age's first years, each rolls a low chance. At most one starts per review. */
export function aiMaybeBuild(galaxy: Galaxy): boolean {
    const st = stillState(galaxy);
    if (st.banned || st.engine !== null) return false;
    const now = galaxyStarDate(galaxy);
    if (now - st.start < AP.minYears(galaxy) * YEAR_LENGTH) return false;
    for (const e of aiPlayers(galaxy)) {
        if (!isolationist(galaxy, e) || e.stateMoney < AP.moneyX(galaxy) * SP.cost(galaxy)) continue;
        if (determineEmpiresAtWarWith(galaxy, e).empires.length > 0) continue;
        const home = e.capital !== null && e.capital.empire === e ? e.capital : e.colonies.find((h) => h !== null && h.empire === e && (h.population?.totalAmount ?? 0) > 0) ?? null;
        if (home === null) continue;
        if (roll(galaxy) * 100 >= AP.chancePct(galaxy)) continue;
        if (startEngine(galaxy, e, home)) return true;
    }
    return false;
}

/** The Engine no longer matters: it is gone (destroyed, taken, scrapped), or an AI owner's was silenced by the Diet (an AI never switches it back on). Pure. */
export function engineEnded(galaxy: Galaxy): boolean {
    const eng = engineOf(galaxy);
    if (eng === null) return true;
    const owner = getEmpireById(galaxy, eng.ownerId);
    return eng.status === 'off' && owner !== null && !isHumanEmpire(galaxy, owner);
}

/**
 * The wars the Engine started end with it: each month, while a war it started is still on, the declarer proposes an end (the stock EndWarRequest: an AI answers by its own
 * ConsiderEndWar, a human gets the proposal to accept or not). A war is dropped from the list when it ends, or after twelve proposals (three to a human).
 */
export function peaceStep(galaxy: Galaxy): void {
    const st = stillState(galaxy);
    if (st.wars === undefined || st.wars.length === 0 || !engineEnded(galaxy)) return;
    for (const rec of [...st.wars]) {
        const a = getEmpireById(galaxy, rec.a);
        const b = getEmpireById(galaxy, rec.b);
        const drop = (): void => void st.wars!.splice(st.wars!.indexOf(rec), 1);
        if (a === null || b === null || !a.active || !b.active || obtainDiplomaticRelation(a, b).type !== DiplomaticRelationType.War) {
            drop();
            continue;
        }
        if (rec.tries >= (isHumanEmpire(galaxy, a) || isHumanEmpire(galaxy, b) ? 3 : 12)) {
            drop();
            continue;
        }
        rec.tries++;
        endWarRequest(galaxy, a, b);
    }
}

/**
 * Daily: an empire that actually shot at the base is answered by the protectors with a fleet guarding it (a patrol on the base, or ships near it): each declares war on it,
 * once, with the reason in the news. Never on a mere declaration; never a protector already in two wars or weaker than the attacker by the strike margin.
 */
export function protectorsReact(galaxy: Galaxy): void {
    const eng = engineOf(galaxy);
    if (eng === null || eng.base === null || eng.base.hasBeenDestroyed || eng.struck === undefined) return;
    const base = eng.base;
    for (const id of eng.struck) {
        const answered = (eng.answered ??= []);
        if (answered.includes(id)) continue;
        answered.push(id);
        const attacker = getEmpireById(galaxy, id);
        if (attacker === null || !attacker.active) continue;
        const guards = defenders(galaxy, eng);
        for (const e of aiPlayers(galaxy)) {
            if (eng.sides[String(e.empireId)] !== 'protect' || e === attacker || e.empireId === eng.ownerId) continue;
            if (!hasMissionOn(e, base, BuiltObjectMissionType.Patrol) && !guards.some((b) => b.actualEmpire === e)) continue;
            if (obtainDiplomaticRelation(e, attacker).type === DiplomaticRelationType.War) continue;
            if (determineEmpiresAtWarWith(galaxy, e).empires.length >= 2) continue;
            if (militaryPotency(e) * AP.marginPct(galaxy) < militaryPotency(attacker) * 100) continue; // weaker than the attacker by the strike margin
            if (!declareOverEngine(galaxy, e, attacker, 'protect')) continue;
            scenarioNews(galaxy, null, T(`${STILL_TAG} Protect War News`, e.name, attacker.name, resolveSectorDescription(galaxy, base.xpos, base.ypos)), () => true, base);
        }
    }
}

/** The monthly review: the peace of finished wars, then sides, patrols, strikes (or, with no Engine, the builders). */
export function stillnessReview(galaxy: Galaxy): void {
    if (!stillnessActive(galaxy)) return;
    const st = stillState(galaxy);
    peaceStep(galaxy);
    const eng = engineOf(galaxy);
    if (eng === null) {
        aiMaybeBuild(galaxy);
        return;
    }
    const owner = getEmpireById(galaxy, eng.ownerId);
    if (owner === null || !owner.active || eng.base === null || eng.base.hasBeenDestroyed) return;
    const now = galaxyStarDate(galaxy);
    const sides: Record<string, EngineSide> = {};
    for (const e of aiPlayers(galaxy)) {
        if (e === owner) continue;
        const side = sideOf(galaxy, e, owner);
        if (side !== null) sides[String(e.empireId)] = side;
    }
    eng.sides = sides;
    if (eng.status === 'off') return;
    for (const e of aiPlayers(galaxy)) {
        const side = sides[String(e.empireId)];
        if (side === undefined || !inReach(galaxy, e, eng)) continue;
        if (side === 'protect') sendPatrol(galaxy, e, eng.base);
        else if (attackEngine(galaxy, e, owner, eng)) eng.strikes[String(e.empireId)] = now;
    }
    void st;
}

export function registerStillnessAi(): void {
    registerScenarioFramePeriodic({ id: 'stillness.react', flag: HARVEST_CYCLE_FLAG, order: 31, periodDays: 1, run: (g) => protectorsReact(g) });
    registerScenarioFramePeriodic({ id: 'stillness.review', flag: HARVEST_CYCLE_FLAG, order: 30, periodDays: 30, run: (g) => stillnessReview(g) });
}

void GAME_DAY_LENGTH;
