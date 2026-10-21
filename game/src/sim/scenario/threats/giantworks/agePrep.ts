// The Harvest Cycle, Age 2: the Diet's preparation votes (registerDietMotionKind like beaconDiet.ts; flag gwHarvestCycle, Age 2, the Diet on). Not a port.
//
//   Recognise the Harvest   a HUMAN member holding the Age 1 memory record (longNightState memoryRecordOf) may move it once the Diet sits in Age 2. When it passes the
//                           AI members take the preparation seriously (law prepRecognise, until repealed):
//                             - they value the Harvest Scar worlds higher as colonisation and conquest targets (colonizationTargetValue x prepScarValuePct; the stock
//                               invasion of unwilling colonization targets reads the same value);
//                             - they contribute to the Severance when the vote comes: an AI member votes for it (megaStation.ts voteScore, prepSeveranceBonus) and, if it
//                               votes yes and is not at war or under sanctions with the builder, hands over its parts whatever the part-trade attitude rule says
//                               (harvestPledges, read by megaStation.ts pledge).
//                           AI votes: the proposer's standing (the Diet's proposerBias) plus a caution term and a bonus for owning a Scar world.
//   Guard the Scars         once Recognise has passed, any member may move it: the members agree not to attack each other's Scar worlds (law prepGuard, until repealed).
//                           AI members' ships take no Attack / landing / bombard / raid mission against a Scar world held by another member (assignMissionAllowed) and their
//                           fleets do not invade it (invasionTargetOrbitOk). A member that takes one from another member breaks the law: the Diet's violation path
//                           (reputation with every member, grievances), once per colony a year.
// AI candidates: Recognise is the human's to move; Guard is moved by a cautious AI member or one that holds a Scar world.
// Rnd: none.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { Habitat } from '../../../types';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../../../diplomacy';
import { BuiltObjectMissionType } from '../../../missions/mission';
import { isHumanEmpire } from '../../../humanEmpires';
import { YEAR_LENGTH } from '../../../galaxyTime';
import { galaxyStarDate } from '../../../tick/simTime';
import { registerScenarioEvent, registerScenarioQuery } from '../../hooks';
import { scenarioNews, scenarioText as T } from '../../messages';
import { scenarioParam } from '../../state';
import { dietLawViolation, dietCouncil } from '../../charactersVictory/diet/diet';
import { dietMembership, inDiet, personality } from '../../charactersVictory/diet/dietAi';
import { dietOn, lawInForce, peekDietState, registerDietMotionKind, type DietKindCandidate } from '../../charactersVictory/diet/dietState';
import { scarHabitats } from './age2Milestones';
import { AGE_PREPARATION, HARVEST_CYCLE_FLAG, galaxyAgeOf, memoryRecordOf } from './longNightState';

export const MOTION_RECOGNISE = 'prepRecognise';
export const LAW_RECOGNISE = 'prepRecognise';
export const MOTION_GUARD = 'prepGuard';
export const LAW_GUARD = 'prepGuard';
const TAG = 'Prep';

const p = (g: Galaxy, name: string, fallback: number): number => scenarioParam(g, name, fallback);
export const PP = {
    /** Percent more an AI member values a Scar world as a colonisation / conquest target once the Harvest is recognised. */
    scarValuePct: (g: Galaxy) => p(g, 'prepScarValuePct', 50),
    /** Score points an AI member adds to its vote for the Severance once the Harvest is recognised. */
    severanceBonus: (g: Galaxy) => p(g, 'prepSeveranceBonus', 30),
};

function on(g: Galaxy): boolean {
    return g.scenario !== null && g.scenario.flags[HARVEST_CYCLE_FLAG] === true && galaxyAgeOf(g) >= AGE_PREPARATION && dietOn(g);
}

/** The Harvest is recognised: the Diet passed the motion and its law stands. Pure. */
export function harvestRecognised(g: Galaxy): boolean {
    return on(g) && lawInForce(peekDietState(g), LAW_RECOGNISE) !== null;
}

/** The members have agreed to guard the Scars. Pure. */
export function scarsGuarded(g: Galaxy): boolean {
    return on(g) && lawInForce(peekDietState(g), LAW_GUARD) !== null;
}

function members(g: Galaxy): Empire[] {
    const c = dietCouncil(g);
    return c === null ? [] : dietMembership(g, c);
}

function isMember(g: Galaxy, e: Empire | null): e is Empire {
    const c = dietCouncil(g);
    return c !== null && inDiet(g, c, e);
}

/** `e` holds the Age 1 memory record: a human empire in an Age 2 galaxy that has one. Pure. */
export function holdsMemory(g: Galaxy, e: Empire): boolean {
    return e.active && isHumanEmpire(g, e) && memoryRecordOf(g) !== null;
}

/** A Scar world (a harvest core of Age 1) held by a Diet member. Pure. */
function memberScar(g: Galaxy, h: Habitat): boolean {
    return h.empire !== null && !h.hasBeenDestroyed && scarHabitats(g).includes(h) && isMember(g, h.empire);
}

function ownsScar(g: Galaxy, e: Empire): boolean {
    return scarHabitats(g).some((h) => h.empire === e && !h.hasBeenDestroyed);
}

/** The Severance vote: an AI member's extra score once the Harvest is recognised (0 otherwise). Pure. */
export function severanceVoteBonus(g: Galaxy, voter: Empire): number {
    return harvestRecognised(g) && !isHumanEmpire(g, voter) ? PP.severanceBonus(g) : 0;
}

/** The Severance pledge: an AI member that voted yes hands its parts over to `builder` (not at war, no sanctions) whatever the part-trade attitude rule says. Pure. */
export function harvestPledges(g: Galaxy, voter: Empire, builder: Empire): boolean {
    if (!harvestRecognised(g) || isHumanEmpire(g, voter) || voter === builder) return false;
    const t = obtainDiplomaticRelation(voter, builder).type;
    return t !== DiplomaticRelationType.War && t !== DiplomaticRelationType.TradeSanctions;
}

function candidate(kind: string, proposer: Empire, weight: number): DietKindCandidate {
    return { kind, proposer, target: null, other: null, colony: null, resourceId: -1, weight };
}

registerDietMotionKind({
    kind: MOTION_RECOGNISE,
    label: 'Recognise the Harvest',
    needs: 'none',
    proposable: (g) => on(g) && lawInForce(peekDietState(g), LAW_RECOGNISE) === null && members(g).some((e) => holdsMemory(g, e)),
    proposableBy: (g, e) => holdsMemory(g, e),
    prepare: (_g, e) => ({ target: e, other: null, colony: null, resourceId: -1 }),
    text: () => T(`${TAG} Recognise`),
    effect: () => T(`${TAG} Recognise Effect`),
    apply: (g, _st, m, addLaw) => {
        addLaw(LAW_RECOGNISE, m.proposer, null, null, -1);
        scenarioNews(g, null, T(`${TAG} Recognise News`));
    },
    voteScore: (g, _st, voter, m) => {
        if (voter === m.proposer && m.id >= 0) return 100; // (a repeal vote weighs the law as a pseudo motion, id -1: no shortcut)
        const pr = personality(voter);
        return 3 + 24 * pr.caution + 6 * pr.friendliness + (ownsScar(g, voter) ? 8 : 0);
    },
});

registerDietMotionKind({
    kind: MOTION_GUARD,
    label: 'Guard the Scars',
    needs: 'none',
    proposable: (g) => on(g) && harvestRecognised(g) && lawInForce(peekDietState(g), LAW_GUARD) === null,
    text: () => T(`${TAG} Guard`),
    effect: () => T(`${TAG} Guard Effect`),
    apply: (g, _st, m, addLaw) => {
        addLaw(LAW_GUARD, m.proposer, null, null, -1);
        scenarioNews(g, null, T(`${TAG} Guard News`));
    },
    voteScore: (g, _st, voter, m) => {
        if (voter === m.proposer && m.id >= 0) return 100; // (a repeal vote weighs the law as a pseudo motion, id -1: no shortcut)
        const pr = personality(voter);
        // The holders of Scar worlds gain by it; the covetous (aggressive) do not.
        return 2 + 12 * pr.caution + 8 * pr.friendliness - 14 * pr.aggression + (ownsScar(g, voter) ? 26 : 0);
    },
    candidates: (g, _st, a) => {
        if (!on(g) || !harvestRecognised(g) || scarsGuarded(g) || isHumanEmpire(g, a)) return [];
        const pr = personality(a);
        const holder = ownsScar(g, a);
        if (!holder && pr.caution < 0.3) return [];
        return [candidate(MOTION_GUARD, a, 10 + 18 * Math.max(0, pr.caution) + (holder ? 14 : 0))];
    },
});

// --- The effects ---------------------------------------------------------------------------------------------------

/** Missions that attack, land on, bombard or raid a world. */
function hostileMission(t: number): boolean {
    const M = BuiltObjectMissionType;
    return t === M.Attack || t === M.UnloadTroops || t === M.Bombard || t === M.WaitAndBombard || t === M.Capture || t === M.Raid;
}

/** An AI member's ship may not take a hostile mission against a Scar world another member holds, while the Scars are guarded. Pure. */
export function guardAllows(g: Galaxy, owner: Empire | null, missionType: number, target: unknown): boolean {
    if (owner === null || !scarsGuarded(g) || isHumanEmpire(g, owner) || !hostileMission(missionType) || !isMember(g, owner)) return true;
    const h = target as Habitat | null;
    if (h === null || typeof h !== 'object' || !('population' in h) || !('baseQuality' in h)) return true;
    return !(memberScar(g, h) && h.empire !== owner);
}

/** A member took a Scar world from another member while the Scars are guarded: the Diet's violation path (once per colony a year). */
function onColonyTaken(g: Galaxy, h: Habitat, from: Empire | null, to: Empire | null): void {
    if (!scarsGuarded(g) || from === null || to === null || from === to || !scarHabitats(g).includes(h) || !isMember(g, from) || !isMember(g, to)) return;
    const law = lawInForce(peekDietState(g), LAW_GUARD);
    if (law === null) return;
    const last = guardBreaks.get(g)?.get(h.habitatIndex);
    const now = galaxyStarDate(g);
    if (last !== undefined && now - last < YEAR_LENGTH) return;
    let m = guardBreaks.get(g);
    if (m === undefined) guardBreaks.set(g, (m = new Map()));
    m.set(h.habitatIndex, now);
    dietLawViolation(g, to, law);
}

/** Not saved: a break counted again after a load is only a second reputation hit at worst. */
const guardBreaks = new WeakMap<Galaxy, Map<number, number>>();

export function registerAgePrep(): void {
    registerScenarioQuery({
        id: 'prep.scarValue',
        flag: HARVEST_CYCLE_FLAG,
        query: 'colonizationTargetValue',
        run: (g, v, a) => (v > 0 && harvestRecognised(g) && !isHumanEmpire(g, a.empire) && scarHabitats(g).includes(a.habitat) ? v * (1 + PP.scarValuePct(g) / 100) : v),
    });
    registerScenarioQuery({ id: 'prep.guardMissions', flag: HARVEST_CYCLE_FLAG, query: 'assignMissionAllowed', run: (g, v, a) => v && guardAllows(g, a.builtObject.actualEmpire, a.missionType, a.target) });
    registerScenarioQuery({
        id: 'prep.guardInvasion',
        flag: HARVEST_CYCLE_FLAG,
        query: 'invasionTargetOrbitOk',
        run: (g, v, a) => v && guardAllows(g, a.empire, BuiltObjectMissionType.UnloadTroops, a.target),
    });
    registerScenarioEvent({ id: 'prep.guardBroken', flag: HARVEST_CYCLE_FLAG, event: 'colonyOwnerChanged', run: (g, e) => onColonyTaken(g, e.colony, e.from, e.to) });
}
