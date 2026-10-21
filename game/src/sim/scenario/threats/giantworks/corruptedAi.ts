// The Harvest Cycle, Age 2: the corrupted empire's own play (corrupted.ts holds the state and the rules). Not a port. Made of the Great Work AI's
// stock calls (strike fleets, patrols, declareWar). Registered here: the daily pass, the Diet's tally observer, the two endings that come from
// the game's events (an assassination of its leader, the loss of its capital) and the preparation motions it votes against.
//   WARS      monthly (corruptReviewDays): it declares war, once a review, on the holders of a Harvest Scar world and on the builders of the
//             Severance (the contributors), stating the reason in the news. Each declaration is a pattern act.
//   RAIDS     daily: a freighter delivering to the Severance whose owner is at war with it draws a strike fleet (stock Attack/Destroy mission);
//             one raid a day. Each raid is a pattern act.
//   PARKS     every corruptParkDays: a patrol fleet goes to the nearest world of a dormant Reclaimer foundry (the Age 1 record's survivors not
//             yet destroyed), one per review. Not a pattern act: a patrol is nothing anyone would question.
//   LEADS     every corruptRollDays: each human with Internal Security on rolls its counter-intelligence against the leader's hidden thing (the
//             stock detection chance, its own stream): a suspected lead, then a confirmed one. Nobody else rolls for it, and no AI ever does.
//   ENDINGS   an agent's assassination of its leader; the loss of its capital (the events). Exposure is the Diet's (corruptedDiet.ts).
// Rnd: none on galaxy.rnd; every draw is the corruption's own stream (corruptRoll).

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { Habitat } from '../../../types';
import type { Character } from '../../../characters';
import { CharacterRole } from '../../../characters';
import { HabitatType } from '../../../types';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../../../diplomacy';
import { FleetPosture, declareWar } from '../../../diplomacyTick';
import { findNearestAvailableFleet } from '../../../fleets/militaryAI';
import { empireShipGroups } from '../../../fleets/shipGroup';
import { determineDestroyOrCaptureTargetForFleet, shipGroupAssignMission, shipGroupCheckFleetTargetWithinFuelRangeAndRefuel } from '../../../fleets/shipGroupTasks';
import { BuiltObjectMissionPriority, BuiltObjectMissionType } from '../../../missions/mission';
import { isAiControlled } from '../../../missions/playerOrder';
import { getEmpireById } from '../../../logistics/contracts';
import { galaxyStarDate } from '../../../tick/simTime';
import { humanEmpires } from '../../../humanEmpires';
import { GAME_DAY_LENGTH, registerScenarioEvent, registerScenarioFramePeriodic } from '../../hooks';
import { scenarioNews, scenarioText as T } from '../../messages';
import { detectionChance, empireSecurityStrength, onLeadChanged } from '../../security/security';
import { openLead, peekSecurityState, retireHiddenThing, securityOn, setLeadLevel, type HiddenThing } from '../../security/registry';
import { formStrikeFleet } from '../../smarterAI/pirates';
import { registerDietTallyObserver } from '../../charactersVictory/diet/dietState';
import { MOTION_MEGA, MOTION_MEGA_RESUME, peekMega } from './megaStation';
import { scarHabitats } from './age2Milestones';
import { HARVEST_CYCLE_FLAG, memoryRecordOf, type PlaceRec } from './longNightState';
import {
    CORRUPT_P,
    activeCorrupted,
    chooseCorrupted,
    corruptRoll,
    corruptedState,
    corruptedTallyObserver,
    corruptionOn,
    corruptionThing,
    endCorruption,
    recordAct,
    registerPreparationMotion,
    threatEmpireIds,
    upkeepCorruptionThing,
    type CorruptedState,
} from './corrupted';

const DAY = GAME_DAY_LENGTH;
const LOG_LIMIT = 20;

function systemNameOf(galaxy: Galaxy, h: Habitat): string {
    return galaxy.systems[h.systemIndex]?.systemStar?.name ?? h.name;
}

/** A fleet of `e` already has `target` as its mission target. Pure. */
function targeted(e: Empire, target: unknown): boolean {
    for (const grp of empireShipGroups(e)) {
        const m = grp === null ? null : grp.mission;
        if (m !== null && (m as { targetBuiltObject?: unknown }).targetBuiltObject === target) return true;
    }
    return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Wars
// ---------------------------------------------------------------------------------------------------------------

/** Declares war on `target` with `reason` in the news. True when the war stands (a treaty or a rule may refuse it). */
export function declareCorruptWar(galaxy: Galaxy, st: CorruptedState, e: Empire, target: Empire, reason: string): boolean {
    declareWar(galaxy, e, target);
    if (obtainDiplomaticRelation(e, target).type !== DiplomaticRelationType.War) return false;
    st.wars.push({ target: target.empireId, date: galaxyStarDate(galaxy), reason });
    if (st.wars.length > LOG_LIMIT) st.wars.splice(0, st.wars.length - LOG_LIMIT);
    scenarioNews(galaxy, e, T('Corrupt War News', e.name, target.name, reason));
    recordAct(galaxy, st, e, T('Corrupt Pattern War', e.name, target.name));
    return true;
}

/** The monthly review: one new war, on the first eligible target in order (the Scar holders, then the Severance's builders). */
export function reviewWars(galaxy: Galaxy, st: CorruptedState, e: Empire): boolean {
    const threats = threatEmpireIds(galaxy);
    const targets: { empire: Empire; reason: string }[] = [];
    for (const h of scarHabitats(galaxy)) {
        const o = h.empire;
        if (o === null || o === e || !o.active || o === galaxy.independentEmpire || o.pirateEmpireBaseHabitat !== null || threats.has(o.empireId)) continue;
        targets.push({ empire: o, reason: T('Corrupt War Reason Scar', systemNameOf(galaxy, h)) });
    }
    const mega = peekMega(galaxy);
    if (mega !== null) {
        for (const id of mega.contributors) {
            const o = getEmpireById(galaxy, id);
            if (o === null || o === e || !o.active || o.pirateEmpireBaseHabitat !== null || threats.has(o.empireId)) continue;
            targets.push({ empire: o, reason: T('Corrupt War Reason Severance', mega.builderName) });
        }
    }
    for (const t of targets) {
        if (obtainDiplomaticRelation(e, t.empire).type === DiplomaticRelationType.War) continue;
        if (declareCorruptWar(galaxy, st, e, t.empire, t.reason)) return true;
    }
    return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Raids on the Severance's freighters
// ---------------------------------------------------------------------------------------------------------------

/** One raid a day: the nearest contract freighter whose owner it is at war with gets a strike fleet. True when one was sent. */
export function raidContracts(galaxy: Galaxy, st: CorruptedState, e: Empire): boolean {
    const mega = peekMega(galaxy);
    if (mega === null) return false;
    for (const c of mega.contracts) {
        const b = c.ship;
        const owner = b.actualEmpire;
        if (b.hasBeenDestroyed || owner === null || owner === e || obtainDiplomaticRelation(e, owner).type !== DiplomaticRelationType.War) continue;
        if (targeted(e, b)) continue;
        const fleet = findNearestAvailableFleet(galaxy, e, b.xpos, b.ypos, BuiltObjectMissionPriority.Low, 1, FleetPosture.Attack, true, 0.1, false, false, false, true) ?? formStrikeFleet(galaxy, e, b.xpos, b.ypos, 1);
        if (fleet === null || fleet.leadShip === null || !isAiControlled(fleet.leadShip)) continue;
        if (!shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, fleet, b.xpos, b.ypos, 0.1)) continue;
        if (!shipGroupAssignMission(galaxy, fleet, determineDestroyOrCaptureTargetForFleet(galaxy, e, fleet, b), b, null, BuiltObjectMissionPriority.High, true)) continue;
        st.raids++;
        recordAct(galaxy, st, e, T('Corrupt Pattern Raid', e.name, owner.name));
        return true;
    }
    return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Parks at the dormant foundries
// ---------------------------------------------------------------------------------------------------------------

/** The Reclaimer foundries of the Age 1 record that still stand (dormant: not yet built again). Pure. */
export function dormantFoundries(galaxy: Galaxy): PlaceRec[] {
    const mem = memoryRecordOf(galaxy);
    if (mem === null) return [];
    const standing = mem.foundries.alive ?? mem.foundries.located;
    return standing.filter((f) => !mem.foundries.destroyed.some((d) => d.x === f.x && d.y === f.y));
}

/** One patrol per review to the nearest world of a dormant foundry that no fleet of `e` already watches. True when one was sent. */
export function parkAtFoundries(galaxy: Galaxy, st: CorruptedState, e: Empire): boolean {
    for (const place of dormantFoundries(galaxy)) {
        const h = galaxy.findNearestHabitatOfType(place.x, place.y, HabitatType.Undefined);
        if (h === null || targeted(e, h)) continue;
        const fleet = findNearestAvailableFleet(galaxy, e, h.xpos, h.ypos, BuiltObjectMissionPriority.Low, 0, FleetPosture.Defend, true, 0.1, false, true, false, false);
        if (fleet === null || fleet.leadShip === null || !isAiControlled(fleet.leadShip)) continue;
        if (!shipGroupCheckFleetTargetWithinFuelRangeAndRefuel(galaxy, fleet, h.xpos, h.ypos, 0.1)) continue;
        if (shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Patrol, h, null, BuiltObjectMissionPriority.Normal, true)) {
            st.parks++;
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Internal Security leads on the leader
// ---------------------------------------------------------------------------------------------------------------

/** Each human's counter-intelligence rolls once against the leader's hidden thing: a suspected lead, then a confirmed one. Returns the leads changed. */
export function leadRolls(galaxy: Galaxy, st: CorruptedState, e: Empire): number {
    if (!securityOn(galaxy)) return 0;
    const t: HiddenThing | undefined = corruptionThing(galaxy, e);
    const sec = peekSecurityState(galaxy);
    if (t === undefined || sec === null) return 0;
    let changed = 0;
    for (const h of humanEmpires(galaxy)) {
        const lead = openLead(sec, t, h);
        if (lead !== undefined && lead.level === 'confirmed') continue;
        const p = detectionChance(galaxy, empireSecurityStrength(galaxy, h), t.concealment);
        if (p <= 0) continue;
        if (corruptRoll(galaxy, st) >= p) continue;
        const level = lead !== undefined && lead.level === 'suspected' ? 'confirmed' : 'suspected';
        const l = setLeadLevel(galaxy, t, h, level, 'roll');
        if (l !== null) {
            onLeadChanged(galaxy, l, t);
            changed++;
        }
    }
    return changed;
}

// ---------------------------------------------------------------------------------------------------------------
// The pass and the events
// ---------------------------------------------------------------------------------------------------------------

/** The daily step of the Preparation: choose once, then keep the leader's thing, review wars, raid, park and roll the leads. No Rnd on galaxy.rnd. */
export function corruptedPass(galaxy: Galaxy): void {
    if (!corruptionOn(galaxy)) return;
    const now = galaxyStarDate(galaxy);
    const st = corruptedState(galaxy);
    if (!st.chosen) {
        chooseCorrupted(galaxy);
        return;
    }
    const e = activeCorrupted(galaxy);
    if (e === null) {
        // Its empire was eliminated (not by the Watchers' endings): the corruption is over, quietly.
        if (st.ended === '') {
            st.ended = 'gone';
            st.endDate = now;
        }
        return;
    }
    upkeepCorruptionThing(galaxy, e);
    if (now >= st.nextReview) {
        st.nextReview = now + CORRUPT_P.reviewDays(galaxy) * DAY;
        reviewWars(galaxy, st, e);
    }
    raidContracts(galaxy, st, e);
    if (now >= st.nextPark) {
        st.nextPark = now + CORRUPT_P.parkDays(galaxy) * DAY;
        parkAtFoundries(galaxy, st, e);
    }
    if (now >= st.nextRoll) {
        st.nextRoll = now + CORRUPT_P.rollDays(galaxy) * DAY;
        leadRolls(galaxy, st, e);
    }
}

/** An agent's mission killed the corrupted empire's leader: the corruption ends. */
export function onAssassinated(galaxy: Galaxy, c: Character, empire: Empire): void {
    if (activeCorrupted(galaxy) !== empire || c.empire !== empire || c.role !== CharacterRole.Leader) return;
    endCorruption(galaxy, 'assassinated');
}

/** The corrupted empire lost its capital: the corruption ends. */
export function onCorruptCapitalLost(galaxy: Galaxy, empire: Empire): void {
    if (activeCorrupted(galaxy) === empire) endCorruption(galaxy, 'captured');
}

// The Severance's motions are the preparation motions the corrupted empire votes against (megaStation.ts registers both kinds).
registerPreparationMotion(MOTION_MEGA);
registerPreparationMotion(MOTION_MEGA_RESUME);
registerDietTallyObserver((g, m) => corruptedTallyObserver(g, m));
registerScenarioFramePeriodic({ id: 'corrupted.pass', flag: HARVEST_CYCLE_FLAG, order: 29, periodDays: 1, run: (g) => corruptedPass(g) });
registerScenarioEvent({ id: 'corrupted.assassin', flag: HARVEST_CYCLE_FLAG, event: 'characterAssassinated', run: (g, e) => onAssassinated(g, e.character, e.empire) });
registerScenarioEvent({ id: 'corrupted.capital', flag: HARVEST_CYCLE_FLAG, event: 'capitalLost', run: (g, e) => onCorruptCapitalLost(g, e.empire) });
