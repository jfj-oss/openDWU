// Emergent Galaxy — 19d1 internal politics (tasks/19d1-internal-politics.md). Not a port: a scenario package on the mod
// layer (tasks/MODLAYER-DESIGN.md). Characters get an ambition (fixed) and a loyalty (moves yearly); in unstable
// empires the most dangerous character may plot a coup, a secession or a defection, or be caught plotting.
//
// Gate: every entry point runs only with the scenario flag `internalPolitics` (registerScenarioYearly flag, and the
// decision handler's flag). With no scenario or the flag off nothing here runs: zero draws, zero state.
// Rnd (tasks/19d1 §S5): galaxy.rnd is drawn only from the yearly handler (reviewPolitics) and what it calls — every
// draw of this file is marked `// RND(19d1)`; the ported functions it calls (changeLeader, haveRevolution,
// initiateEmpireSplitAt, selectSuitableGovernment, ...) draw their own C# draws. The model functions (ambition,
// loyalty, deltas, instability, plot scores, UI rows) are pure: no Rnd, no mutation.
//
// State: scenarioState(galaxy, 'politics') — Maps / Sets keyed by Character / Empire / Habitat graph objects (saved
// by the graph codec). A dead / inactive / pirate character's entry is dropped at the next yearly tick.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import { Character, CharacterEventType, CharacterRole, CharacterTraitType, getEmpireCharacters, isBuiltObjectLocation } from '../../characters';
import { changeLeader, characterSendDeathMessage, CharacterDeathType } from '../../characterRuntime';
import { colonyApprovalAverage, defectFleet, initiateEmpireSplitAt } from '../../empireEvents';
import { haveRevolution, selectSuitableGovernment } from '../../treasury';
import { empireApprovalRating, empireWarWeariness, setColonyTaxRate } from '../../taxes';
import { empireGovernmentAttributes, getGovernmentsStatic } from '../../empire';
import { resolveStandardRaceBias } from '../../raceBias';
import { DiplomaticRelationType } from '../../diplomacy';
import { applyReputation } from '../reputation/ledger';
import { cancelIntelligenceMission, characterMission, markEmpireAsRecentSpy, resolveMoreAdvancedProjectsIncludeSpecial } from '../../espionage';
import { doResearchBreakthrough } from '../../researchTick';
import { giveTerritoryMap } from '../../tradeItems';
import { leaveEmpire } from '../../events';
import { getCharacterValue } from '../../espionagePrisoners';
import { empireShipGroups, shipGroupTotalOverallStrengthFactor, type ShipGroup } from '../../fleets/shipGroup';
import { EmpireMessageType } from '../../messages';
import { YEAR_LENGTH } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { registerScenarioEvent, registerScenarioGameStart, registerScenarioYearly } from '../hooks';
import { registerScenarioDecision, raiseScenarioDecision, type ScenarioDecision } from '../decisions';
import { scenarioFlag, scenarioParam, scenarioState } from '../state';
import { scenarioMessage, scenarioNews, scenarioText } from '../messages';
import { noteVoiceCue, voicesOn } from '../llm/voiceCues';

export const POLITICS_FLAG = 'internalPolitics';
export const PLOT_DECISION = 'politics.plot';
/** Government ids (governments.txt). */
const GOV_MILITARY_DICTATORSHIP = 5;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface Grievance {
    year: number;
    cause: string;
    amount: number;
}

export interface CharacterPolitics {
    /** 0–100, fixed at first sight (characterAmbition). */
    ambition: number;
    /** 0–100. */
    loyalty: number;
    /** The last yearly delta. */
    loyaltyTrend: number;
    /** Game year of the last honour (-1000 = never). */
    honoredYear: number;
    /** Negative causes (< -2) of the last 5 years. */
    grievances: Grievance[];
    /** Game year of the last loyalty warning sent to the player (-1000 = never). */
    warnedYear: number;
    /** The causes of the last yearly delta (UI). */
    lastCauses: { cause: string; amount: number }[];
}

export type PlotKind = 'coup' | 'secession' | 'defection' | 'rumour';

/** One plot outcome (chronicle / tests / soak counts). */
export interface PoliticsEvent {
    year: number;
    empire: Empire;
    kind: PlotKind;
    character: Character;
    /** coup: succeeded; secession: a new empire formed (or the colony left); defection: happened; rumour: exposed. */
    success: boolean;
    /** The new empire of a secession / defection target (null otherwise). */
    other: Empire | null;
}

export interface PoliticsState {
    chars: Map<Character, CharacterPolitics>;
    lastPlotYear: Map<Empire, number>;
    exposed: Set<Character>;
    purgeYear: Map<Empire, number>;
    /** Colonies with granted autonomy → the game year it ends. */
    autonomy: Map<Habitat, number>;
    /** Plot outcomes, oldest first (last 200). */
    events: PoliticsEvent[];
}

export function politicsState(galaxy: Galaxy): PoliticsState {
    return scenarioState<PoliticsState>(galaxy, 'politics', () => ({
        chars: new Map(),
        lastPlotYear: new Map(),
        exposed: new Set(),
        purgeYear: new Map(),
        autonomy: new Map(),
        events: [],
    }));
}

/** The state if it exists (UI: never creates it). */
export function peekPoliticsState(galaxy: Galaxy): PoliticsState | null {
    const s = galaxy.scenario;
    if (s === null || !('politics' in s.state)) return null;
    return s.state.politics as PoliticsState;
}

/** The current game year (as the yearly handler sees it). */
export function politicsYear(galaxy: Galaxy): number {
    return Math.floor(galaxyStarDate(galaxy) / YEAR_LENGTH);
}

// ---------------------------------------------------------------------------
// Model (pure)
// ---------------------------------------------------------------------------

/** A normal, active empire (not a pirate faction, not the independents). */
export function isPoliticalEmpire(galaxy: Galaxy, e: Empire | null): e is Empire {
    return e !== null && e.active && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null;
}

/** Roles that can plot (built lazily: this module loads inside an import cycle with characters.ts). */
let plotRoles: readonly CharacterRole[] | null = null;
const PLOT_ROLES = (): readonly CharacterRole[] => (plotRoles ??= [
    CharacterRole.Ambassador,
    CharacterRole.ColonyGovernor,
    CharacterRole.FleetAdmiral,
    CharacterRole.TroopGeneral,
    CharacterRole.IntelligenceAgent,
    CharacterRole.Scientist,
]);

export function canPlot(c: Character): boolean {
    return PLOT_ROLES().includes(c.role);
}

let ambitionTraits: ReadonlyMap<CharacterTraitType, number> | null = null;
const AMBITION_TRAITS = (): ReadonlyMap<CharacterTraitType, number> => (ambitionTraits ??= new Map([
    [CharacterTraitType.Expansionist, 10],
    [CharacterTraitType.Famous, 10],
    [CharacterTraitType.EloquentSpeaker, 10],
    [CharacterTraitType.Corrupt, 15],
    [CharacterTraitType.NaturalSpaceLeader, 10],
    [CharacterTraitType.NaturalGroundLeader, 10],
    [CharacterTraitType.GoodStrategist, 5],
    [CharacterTraitType.Courageous, 5],
    [CharacterTraitType.Uninhibited, 5],
    [CharacterTraitType.RecklessAttacker, 5],
    [CharacterTraitType.Lawful, -15],
    [CharacterTraitType.Patriot, -25],
    [CharacterTraitType.Pacifist, -5],
    [CharacterTraitType.Lazy, -10],
    [CharacterTraitType.Measured, -5],
    [CharacterTraitType.Weak, -10],
]));

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** §2.1: 30 + skill total / 10 (cap +20) + trait table, 0–100; leaders 0 (they already rule). */
export function characterAmbition(c: Character): number {
    if (c.role === CharacterRole.Leader || c.role === CharacterRole.PirateLeader) return 0;
    let a = 30 + Math.min(20, c.getSkillLevelTotal() / 10);
    for (const t of c.traits) a += AMBITION_TRAITS().get(t) ?? 0;
    return clamp(a, 0, 100);
}

/** §2.2: 60 + (race loyalty − 100)/2 + traits + race fit with the empire's dominant race, 0–100. */
export function initialLoyalty(galaxy: Galaxy, c: Character): number {
    void galaxy;
    let l = 60;
    if (c.race !== null) l += (c.race.loyalty - 100) / 2;
    if (c.traits.includes(CharacterTraitType.Patriot)) l += 25;
    if (c.traits.includes(CharacterTraitType.Lawful)) l += 10;
    if (c.traits.includes(CharacterTraitType.Corrupt)) l -= 10;
    if (c.traits.includes(CharacterTraitType.DoubleAgent)) l -= 30;
    if (c.traits.includes(CharacterTraitType.ForeignSpy)) l -= 40;
    const empire = c.empire;
    if (empire !== null) {
        if (c.race === empire.dominantRace) l += 5;
        else l += resolveStandardRaceBias(c.race, empire.dominantRace) / 10;
    }
    return clamp(l, 0, 100);
}

/** Average colony approval (0 for an empire without colonies; colonyApprovalAverage divides by the count). */
export function empireApprovalAverage(galaxy: Galaxy, empire: Empire): number {
    return empire.colonies.length > 0 ? colonyApprovalAverage(galaxy, empire) : 0;
}

/** The colony a governor governs (their location, a colony of their empire), else null. */
export function governedColony(c: Character): Habitat | null {
    if (c.role !== CharacterRole.ColonyGovernor) return null;
    const loc = c.location;
    if (loc === null || isBuiltObjectLocation(loc)) return null;
    const h = loc as Habitat;
    return h.empire !== null && h.empire === c.empire ? h : null;
}

/** Events of `type` in the last game year. */
function recentEvents(galaxy: Galaxy, c: Character, type: CharacterEventType): number {
    const since = galaxyStarDate(galaxy) - YEAR_LENGTH;
    let n = 0;
    for (const e of c.eventHistory) if (e !== null && e.type === type && e.starDate >= since) n++;
    return n;
}

/** The honours afterglow in the drift target: 15 in the year of the honour, −5 per year after. */
function honourBonus(entry: CharacterPolitics, year: number): number {
    return Math.max(0, 15 - 5 * (year - entry.honoredYear));
}

/**
 * §2.3 the yearly loyalty change and its named causes (pure). Honours: honorCharacter adds +15 at once; the drift
 * target carries a decaying bonus (15, 10, 5, 0 over the following years) so the gift wears off instead of vanishing.
 * TODO(19d2/19d4): the refugee-tension and resource-crisis governor terms join here once those packages exist
 * (behind their own flags).
 */
export function yearlyLoyaltyDelta(galaxy: Galaxy, c: Character, entry: CharacterPolitics, year: number): { delta: number; causes: { cause: string; amount: number }[] } {
    const causes: { cause: string; amount: number }[] = [];
    const add = (cause: string, amount: number): void => {
        if (amount !== 0) causes.push({ cause, amount });
    };
    const empire = c.empire;
    if (empire === null) return { delta: 0, causes };
    const colony = governedColony(c);
    const approval = colony !== null ? empireApprovalRating(galaxy, colony) : empireApprovalAverage(galaxy, empire);
    add('Approval', clamp(approval / 5, -8, 8));
    add('War Weariness', -Math.min(6, Math.max(0, empireWarWeariness(empire)) / 10));
    add('Development Losses', -Math.min(4, recentEvents(galaxy, c, CharacterEventType.ColonyDevelopmentDecrease)));
    add('Bankruptcy', -Math.min(6, 3 * recentEvents(galaxy, c, CharacterEventType.CashNegative)));
    const leader = empire.leader;
    if (leader !== null && leader !== c) {
        if (leader.traits.includes(CharacterTraitType.InspiringPresence)) add('Leader Inspiring', 4);
        if (leader.traits.includes(CharacterTraitType.Demoralizing)) add('Leader Demoralizing', -4);
        if (leader.traits.includes(CharacterTraitType.Paranoid)) add('Leader Paranoid', -2);
    }
    const purge = peekPoliticsState(galaxy)?.purgeYear.get(empire);
    if (purge !== undefined && year - purge <= 2 && !c.traits.includes(CharacterTraitType.Patriot)) add('Purges', -5);
    const target = initialLoyalty(galaxy, c) + honourBonus(entry, year);
    add('Drift', (target - entry.loyalty) * 0.1);
    let delta = 0;
    for (const x of causes) delta += x.amount;
    return { delta, causes };
}

/** §2.5b instability I (0–2) of an empire. */
export function empireInstability(galaxy: Galaxy, empire: Empire): number {
    const threshold = scenarioParam(galaxy, 'coupApprovalThreshold', -5);
    const gov = empireGovernmentAttributes(empire);
    const stability = gov !== null ? gov.stability : 1;
    const i = (threshold - empireApprovalAverage(galaxy, empire)) / 20 + Math.max(0, empireWarWeariness(empire)) / 40 + (1 - stability) + Math.max(0, -empire.leaderChangeInfluence);
    return clamp(i, 0, 2);
}

/** Stability label of an instability value (empire summary). */
export function stabilityLabel(i: number): 'Stable' | 'Tense' | 'Unstable' | 'Crisis' {
    if (i <= 0) return 'Stable';
    if (i < 0.75) return 'Tense';
    if (i < 1.5) return 'Unstable';
    return 'Crisis';
}

/** §2.5c plot score P. */
export function plotScore(entry: CharacterPolitics, instability: number, intensity: number): number {
    return (entry.ambition / 100) * ((100 - entry.loyalty) / 100) * instability * intensity;
}

/** A capital-area check: at the capital, or aboard a ship within 2 sectors of it. */
function nearCapital(galaxy: Galaxy, c: Character, capital: Habitat): boolean {
    const loc = c.location;
    if (loc === null) return false;
    if (loc === capital) return true;
    if (!isBuiltObjectLocation(loc)) return false;
    return galaxy.calculateDistance(loc.xpos, loc.ypos, capital.xpos, capital.ypos) <= 2 * galaxy.sectorSize;
}

/** §2.8 the defection target (pure; null = none with a positive score). */
export function defectionTarget(galaxy: Galaxy, c: Character, empire: Empire): Empire | null {
    let best: Empire | null = null;
    let bestScore = 0;
    for (const t of galaxy.empires) {
        if (t === empire || !isPoliticalEmpire(galaxy, t) || t.capital === null || t.colonies.length === 0) continue;
        const rel = empire.diplomaticRelations.byEmpire(t);
        if (rel === null || rel.type === DiplomaticRelationType.NotMet) continue;
        const score = resolveStandardRaceBias(c.race, t.dominantRace) + (rel.type === DiplomaticRelationType.War ? 20 : 0) + empireApprovalAverage(galaxy, t) / 2;
        if (score > bestScore || (best !== null && score === bestScore && t.empireId < best.empireId)) {
            best = t;
            bestScore = score;
        }
    }
    return best;
}

/** §2.5c which plot a character would attempt (pure; first match). */
export function plotKindFor(galaxy: Galaxy, empire: Empire, c: Character, entry: CharacterPolitics): PlotKind {
    const approval = empireApprovalAverage(galaxy, empire);
    const capital = empire.capital;
    const coupRole = c.role === CharacterRole.FleetAdmiral || c.role === CharacterRole.TroopGeneral || (c.role === CharacterRole.IntelligenceAgent && c.assassination >= 20);
    if (coupRole && capital !== null && entry.loyalty < 30 && entry.ambition > 60 && approval < scenarioParam(galaxy, 'coupApprovalThreshold', -5) && nearCapital(galaxy, c, capital)) return 'coup';
    const colony = governedColony(c);
    if (colony !== null && entry.loyalty < 35 && empire.colonies.length > scenarioParam(galaxy, 'secessionMinColonies', 6) && colony !== capital && (empireApprovalRating(galaxy, colony) < 0 || colony.rebelling)) {
        return 'secession';
    }
    if (canPlot(c) && c.role !== CharacterRole.TroopGeneral && entry.loyalty < 25 && defectionTarget(galaxy, c, empire) !== null) return 'defection';
    return 'rumour';
}

/** Forces behind and against a coup (§2.6). */
export function coupForces(galaxy: Galaxy, empire: Empire, c: Character): { plotter: number; loyal: number } {
    const capital = empire.capital;
    if (capital === null) return { plotter: 0, loyal: 0 };
    const garrison = capital.troops !== null ? capital.troops.totalDefendStrength : 0;
    const plotterFleet = c.role === CharacterRole.FleetAdmiral ? c.determineFleet() : null;
    let plotter: number;
    let loyal: number;
    if (plotterFleet !== null) {
        plotter = shipGroupTotalOverallStrengthFactor(galaxy, plotterFleet);
        loyal = garrison;
    } else if (c.role === CharacterRole.FleetAdmiral) {
        plotter = 0;
        loyal = garrison;
    } else {
        const share = clamp(0.3 + c.getSkillLevelTotal() / 200, 0, 1);
        plotter = garrison * share;
        loyal = garrison - plotter;
    }
    const range = 2 * galaxy.sectorSize;
    for (const g of empireShipGroups(empire)) {
        if (g === null || g === plotterFleet || g.leadShip === null) continue;
        if (galaxy.calculateDistance(g.leadShip.xpos, g.leadShip.ypos, capital.xpos, capital.ypos) <= range) loyal += shipGroupTotalOverallStrengthFactor(galaxy, g);
    }
    return { plotter, loyal };
}

/** §2.6 coup success chance (0.1–0.9, halved when the plot is exposed). */
export function coupSuccessChance(plotter: number, loyal: number, leaderSkillTotal: number, exposed: boolean): number {
    const s = clamp(0.5 + ((plotter - loyal) / (plotter + loyal + 1)) * 0.5 - leaderSkillTotal / 400, 0.1, 0.9);
    return exposed ? s * 0.5 : s;
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

function newEntry(galaxy: Galaxy, c: Character): CharacterPolitics {
    return { ambition: characterAmbition(c), loyalty: initialLoyalty(galaxy, c), loyaltyTrend: 0, honoredYear: -1000, grievances: [], warnedYear: -1000, lastCauses: [] };
}

/** The character's entry, created on first sight (no Rnd). */
export function politicsEntry(galaxy: Galaxy, c: Character): CharacterPolitics {
    const st = politicsState(galaxy);
    let e = st.chars.get(c);
    if (e === undefined) {
        e = newEntry(galaxy, c);
        st.chars.set(c, e);
    }
    return e;
}

function roleName(c: Character): string {
    return CharacterRole[c.role].replace(/([a-z])([A-Z])/g, '$1 $2');
}

function logEvent(galaxy: Galaxy, ev: PoliticsEvent): void {
    const st = politicsState(galaxy);
    st.events.push(ev);
    if (st.events.length > 200) st.events.splice(0, st.events.length - 200);
}

function dropCharacter(galaxy: Galaxy, c: Character): void {
    const st = politicsState(galaxy);
    st.chars.delete(c);
    st.exposed.delete(c);
}

/** Kill a character as dismissed (death message to its empire first, as Character.SendDeathMessage + Kill). */
export function dismissCharacter(galaxy: Galaxy, c: Character): void {
    characterSendDeathMessage(galaxy, c, CharacterDeathType.Dismissed);
    c.kill(galaxy);
    dropCharacter(galaxy, c);
}

// ---------------------------------------------------------------------------
// Plots (draw)
// ---------------------------------------------------------------------------

/** §2.6 a coup attempt. One draw (+ the ported changeLeader / haveRevolution / selectSuitableGovernment draws). */
export function attemptCoup(galaxy: Galaxy, empire: Empire, c: Character, year: number): boolean {
    const st = politicsState(galaxy);
    const { plotter, loyal } = coupForces(galaxy, empire, c);
    const leader = empire.leader;
    const s = coupSuccessChance(plotter, loyal, leader !== null ? leader.getSkillLevelTotal() : 0, st.exposed.has(c));
    // RND(19d1): coup
    const success = galaxy.rnd.nextDouble() < s;
    const oldLeaderName = leader !== null ? leader.name : '';
    const role = roleName(c);
    if (success && politicsHooks.coupSucceeded !== null && politicsHooks.coupSucceeded(galaxy, empire, c, year)) {
        st.lastPlotYear.set(empire, year);
        logEvent(galaxy, { year, empire, kind: 'coup', character: c, success, other: null });
        return true;
    }
    if (success) {
        const origRole = c.role;
        st.exposed.delete(c);
        changeLeader(galaxy, empire, [c], -1);
        let govId = empire.governmentId;
        if (origRole === CharacterRole.FleetAdmiral || origRole === CharacterRole.TroopGeneral) {
            govId = empire.allowableGovernmentTypes.includes(GOV_MILITARY_DICTATORSHIP)
                ? GOV_MILITARY_DICTATORSHIP
                : empire.dominantRace !== null
                  ? selectSuitableGovernment(galaxy, empire.dominantRace, empire.governmentId, empire.allowableGovernmentTypes)
                  : -1;
            if (govId >= 0) haveRevolution(galaxy, empire, empire.dominantRace, govId, 0.5);
        }
        const entry = politicsEntry(galaxy, c);
        entry.ambition = 0;
        entry.loyalty = 100;
        for (const [other, e] of st.chars) if (other !== c && other.empire === empire && e.loyalty > 70) e.loyalty -= 20;
        const govName = getGovernmentsStatic()[empire.governmentId]?.name ?? '';
        scenarioMessage(galaxy, empire, scenarioText('Emergent Coup Success Title'), scenarioText('Emergent Coup Success', role, c.name, govName), {
            type: EmpireMessageType.GeneralBadEvent,
            subject: c,
        });
        scenarioNews(galaxy, empire, scenarioText('Emergent Coup Success News', role, c.name, empire.name), (e) => e !== empire, c);
    } else {
        dismissCharacter(galaxy, c);
        if (leader !== null) leader.addTrait(CharacterTraitType.Paranoid, false, galaxy);
        empire.leaderChangeInfluence = Math.min(empire.leaderChangeInfluence, -0.3);
        scenarioMessage(galaxy, empire, scenarioText('Emergent Coup Crushed Title'), scenarioText('Emergent Coup Crushed', role, c.name, leader !== null ? leader.name : oldLeaderName), {
            type: EmpireMessageType.GeneralGoodEvent,
            subject: leader ?? empire.capital,
        });
        scenarioNews(galaxy, empire, scenarioText('Emergent Coup Crushed Foreign', c.name, empire.name), (e) => e !== empire, empire.capital);
    }
    st.lastPlotYear.set(empire, year);
    logEvent(galaxy, { year, empire, kind: 'coup', character: c, success, other: null });
    return success;
}

/** §2.7 a secession led by a governor from their colony. Draws only inside the ported split (and one roll when exposed). */
export function attemptSecession(galaxy: Galaxy, empire: Empire, governor: Character, year: number): Empire | null {
    const st = politicsState(galaxy);
    const colony = governedColony(governor);
    if (colony === null) return null;
    const entry = politicsEntry(galaxy, governor);
    st.lastPlotYear.set(empire, year);
    if (politicsHooks.secessionBlocked !== null && politicsHooks.secessionBlocked(galaxy, colony)) {
        logEvent(galaxy, { year, empire, kind: 'secession', character: governor, success: false, other: null });
        return null;
    }
    if (st.exposed.has(governor)) {
        // RND(19d1): exposed secession — the government knows; half the attempts are stopped (the governor is arrested).
        if (galaxy.rnd.nextDouble() < 0.5) {
            dismissCharacter(galaxy, governor);
            logEvent(galaxy, { year, empire, kind: 'secession', character: governor, success: false, other: null });
            return null;
        }
    }
    const portion = Math.min(0.3, 0.1 + entry.ambition / 500);
    const race = colony.population !== null ? colony.population.dominantRace : null;
    const declareWar = entry.ambition > 70 || (race !== null && race.aggression > 110);
    if (galaxy.nextEmpireId >= galaxy.maximumEmpireCount) {
        // §2.9 no room for another empire: the colony leaves (becomes independent) with its governor.
        leaveEmpire(galaxy, colony);
        scenarioMessage(galaxy, empire, scenarioText('Emergent Secession Title'), scenarioText('Emergent Secession Leave', governor.name, colony.name), {
            type: EmpireMessageType.GeneralBadEvent,
            subject: colony,
        });
        logEvent(galaxy, { year, empire, kind: 'secession', character: governor, success: true, other: null });
        return null;
    }
    const newEmpire = initiateEmpireSplitAt(galaxy, empire, portion, declareWar, colony);
    if (newEmpire === null) return null;
    // The governor went with the colony (takeOwnershipOfColonyFull moves the characters there); make them its ruler.
    if (governor.empire !== newEmpire) governor.defectToEmpire(newEmpire, colony);
    if (newEmpire.leader !== null && newEmpire.leader !== governor) {
        newEmpire.leader.kill(galaxy);
        newEmpire.leader = null;
    }
    governor.role = CharacterRole.Leader;
    newEmpire.leader = governor;
    st.exposed.delete(governor);
    entry.ambition = 0;
    entry.loyalty = 90;
    const n = newEmpire.colonies.length;
    scenarioMessage(galaxy, empire, scenarioText('Emergent Secession Title'), scenarioText('Emergent Secession', governor.name, colony.name, n, newEmpire.name), {
        type: EmpireMessageType.GeneralBadEvent,
        subject: colony,
    });
    scenarioNews(galaxy, empire, scenarioText('Emergent Secession News', governor.name, colony.name, empire.name, newEmpire.name), (e) => e !== empire, colony);
    st.lastPlotYear.set(newEmpire, year);
    logEvent(galaxy, { year, empire, kind: 'secession', character: governor, success: true, other: newEmpire });
    return newEmpire;
}

/** §2.8 a defection to the best-scoring known empire. A Scientist's gift draws one pick. */
export function attemptDefection(galaxy: Galaxy, empire: Empire, c: Character, year: number): Empire | null {
    const target = defectionTarget(galaxy, c, empire);
    if (target === null) return null;
    const st = politicsState(galaxy);
    const role = roleName(c);
    const extra: string[] = [];
    const fleet = c.role === CharacterRole.FleetAdmiral ? c.determineFleet() : null;
    // Missions of our agents against the target (read before the move).
    const agentMissions = c.role === CharacterRole.IntelligenceAgent ? getEmpireCharacters(empire).filter((a) => a !== c && characterMission(a) !== null && characterMission(a)!.targetEmpire === target) : [];
    // Move first: characters aboard ships die when a ship changes owner (TakeOwnershipOfBuiltObject).
    c.mission = null;
    c.defectToEmpire(target, target.capital);
    switch (c.role) {
        case CharacterRole.Scientist: {
            const list = resolveMoreAdvancedProjectsIncludeSpecial(target, empire, false);
            if (list.length > 0) {
                // RND(19d1): pick the tech the scientist brings (as StealTechData's completion pick).
                const node = list[galaxy.rnd.next(0, list.length)];
                const tree = target.research.techTree;
                const equivalent = tree.length > node.def.projectId ? tree[node.def.projectId] : null;
                if (equivalent !== null && !equivalent.isResearched) {
                    doResearchBreakthrough(galaxy, target, equivalent, false);
                    extra.push(scenarioText('Emergent Defection Tech', equivalent.def.name));
                }
            }
            break;
        }
        case CharacterRole.IntelligenceAgent: {
            for (const a of agentMissions) {
                cancelIntelligenceMission(empire, characterMission(a)!);
                a.mission = null;
            }
            applyReputation(galaxy, target, empire, -10.0, { cause: 'politics.defectedAgent', source: '19d1' });
            markEmpireAsRecentSpy(galaxy, empire, target);
            if (agentMissions.length > 0) extra.push(scenarioText('Emergent Defection Agents', target.name));
            break;
        }
        case CharacterRole.Ambassador:
            giveTerritoryMap(galaxy, empire, target);
            extra.push(scenarioText('Emergent Defection Map'));
            break;
        case CharacterRole.FleetAdmiral:
            if (fleet !== null && fleet.empire === empire && fleet.ships.length > 0) {
                defectFleet(galaxy, empire, fleet, target);
                if (fleet.leadShip !== null) c.completeLocationTransfer(fleet.leadShip, galaxy);
                extra.push(scenarioText('Emergent Defection Fleet', fleet.name ?? ''));
            }
            break;
        default:
            break;
    }
    const entry = politicsEntry(galaxy, c);
    entry.loyalty = 70;
    st.exposed.delete(c);
    st.lastPlotYear.set(empire, year);
    const tail = extra.length > 0 ? '\n\n' + extra.join('\n') : '';
    scenarioMessage(galaxy, empire, scenarioText('Emergent Defection Title'), scenarioText('Emergent Defection From', role, c.name, target.name) + tail, { type: EmpireMessageType.GeneralBadEvent, subject: c });
    scenarioMessage(galaxy, target, scenarioText('Emergent Defection Title'), scenarioText('Emergent Defection To', c.name, role, empire.name) + tail, { type: EmpireMessageType.GeneralGoodEvent, subject: c });
    if (c.traits.includes(CharacterTraitType.Famous)) {
        scenarioNews(galaxy, target, scenarioText('Emergent Defection News', c.name, role, empire.name, target.name), (e) => e !== empire && e !== target, c);
    }
    logEvent(galaxy, { year, empire, kind: 'defection', character: c, success: true, other: target });
    return target;
}

/** The best counter-intelligence of an empire's agents (CounterEspionageFactored). */
function counterIntelligence(empire: Empire): number {
    let best = 0;
    for (const a of getEmpireCharacters(empire)) if (a.role === CharacterRole.IntelligenceAgent && a.active) best = Math.max(best, a.counterEspionageFactored);
    return best;
}

/** A plot that is only a rumour: the counter-intelligence may expose it (one draw). */
function plotRumour(galaxy: Galaxy, empire: Empire, c: Character, year: number): void {
    const st = politicsState(galaxy);
    st.lastPlotYear.set(empire, year);
    if (st.exposed.has(c)) return;
    // RND(19d1): exposure
    const exposed = galaxy.rnd.nextDouble() < counterIntelligence(empire) / 200;
    logEvent(galaxy, { year, empire, kind: 'rumour', character: c, success: exposed, other: null });
    politicsHooks.plotRumour?.(galaxy, empire, c, exposed);
    if (!exposed) return;
    st.exposed.add(c);
    raisePlotDecision(galaxy, empire, c);
}

// ---------------------------------------------------------------------------
// Decision politics.plot (§5) — the player answers; an AI empire answers at once (§4 rule 2)
// ---------------------------------------------------------------------------

/** Honour cost (BaconCharacter GetCharacterValue / 2). */
export function honourCost(c: Character): number {
    return c.empire !== null ? Math.trunc(getCharacterValue(c) / 2) : 0;
}

export function raisePlotDecision(galaxy: Galaxy, empire: Empire, c: Character): ScenarioDecision {
    const cost = honourCost(c);
    return raiseScenarioDecision(galaxy, empire, {
        kind: PLOT_DECISION,
        title: scenarioText('Emergent Plot Rumour Title'),
        text: scenarioText('Emergent Plot Rumour', roleName(c), c.name, cost),
        options: [
            { id: 'arrest', label: scenarioText('Emergent Option Arrest') },
            { id: 'honour', label: scenarioText('Emergent Option Honour', cost) },
            { id: 'ignore', label: scenarioText('Emergent Option Ignore') },
        ],
        defaultOption: 'ignore',
        expiresDays: 360,
        context: { character: c },
    });
}

/** §4 rule 2: arrest, unless the plotter is Famous and the approval average is below −10 (then honour). */
export function aiPlotChoice(galaxy: Galaxy, empire: Empire, c: Character): 'arrest' | 'honour' {
    return c.traits.includes(CharacterTraitType.Famous) && empireApprovalAverage(galaxy, empire) < -10 ? 'honour' : 'arrest';
}

// 19m internal security hook slots (scenario/security/security.ts fills them at import; each implementation returns
// its "off" value unless the `internalSecurity` flag is on, and none of them draws).
export interface PoliticsHookSlots {
    /** A coup roll succeeded: true when 19m handled it instead (a cultist plotter founds the theocracy). */
    coupSucceeded: ((galaxy: Galaxy, empire: Empire, c: Character, year: number) => boolean) | null;
    /** True when the colony may not secede now (martial law). */
    secessionBlocked: ((galaxy: Galaxy, colony: Habitat) => boolean) | null;
    /** A plot rumour was rolled (exposed = the ported exposure roll found it): the plot joins the 19m registry. */
    plotRumour: ((galaxy: Galaxy, empire: Empire, c: Character, exposed: boolean) => void) | null;
    /** 19n court: a factor on a candidate's plot score (house rivalry, a backing faction); 1 when the court is off. */
    plotScoreFactor: ((galaxy: Galaxy, empire: Empire, c: Character) => number) | null;
    /** 19n court: a factor on the plot roll's chance (the ruler's legitimacy); 1 when the court is off. */
    plotChanceFactor: ((galaxy: Galaxy, empire: Empire) => number) | null;
}
export const politicsHooks: PoliticsHookSlots = { coupSucceeded: null, secessionBlocked: null, plotRumour: null, plotScoreFactor: null, plotChanceFactor: null };

// The actions live in politicsActions.ts (imported lazily through this registry to keep the module graph acyclic).
export interface PoliticsActionImpl {
    honorCharacter(galaxy: Galaxy, empire: Empire, c: Character): { ok: boolean; reason?: string };
    arrestCharacter(galaxy: Galaxy, empire: Empire, c: Character): { ok: boolean; reason?: string };
}
let actions: PoliticsActionImpl | null = null;
export function setPoliticsActions(a: PoliticsActionImpl): void {
    actions = a;
}

registerScenarioDecision({
    id: PLOT_DECISION,
    kind: PLOT_DECISION,
    flag: POLITICS_FLAG,
    resolve: (galaxy, d, optionId) => {
        const c = d.context.character as Character | undefined;
        const empire = d.empire;
        if (c === undefined || actions === null || !c.active || c.empire !== empire) return;
        if (optionId === 'arrest') actions.arrestCharacter(galaxy, empire, c);
        else if (optionId === 'honour') actions.honorCharacter(galaxy, empire, c);
    },
    aiChoose: (galaxy, d) => {
        const c = d.context.character as Character;
        return aiPlotChoice(galaxy, d.empire, c);
    },
});

// ---------------------------------------------------------------------------
// AI rules (§4) — no Rnd
// ---------------------------------------------------------------------------

/** §4 rule 1: honour the lowest-loyalty ambitious character when affordable (once per character per 3 years). */
function aiHonour(galaxy: Galaxy, empire: Empire, year: number): void {
    if (actions === null) return;
    const st = politicsState(galaxy);
    let pick: Character | null = null;
    let pickLoyalty = Infinity;
    for (const c of getEmpireCharacters(empire)) {
        const e = st.chars.get(c);
        if (e === undefined || e.ambition <= 60 || e.loyalty >= 35 || year - e.honoredYear < 3) continue;
        if (e.loyalty < pickLoyalty) {
            pick = c;
            pickLoyalty = e.loyalty;
        }
    }
    if (pick !== null && empire.stateMoney >= 5 * honourCost(pick)) actions.honorCharacter(galaxy, empire, pick);
}

/** §4 rule 3: an admiral with loyalty < 30 must not be the only fleet at the capital — bring another fleet home. */
function aiGuardCapital(galaxy: Galaxy, empire: Empire): void {
    const capital = empire.capital;
    if (capital === null) return;
    const st = politicsState(galaxy);
    const range = 2 * galaxy.sectorSize;
    const groups = empireShipGroups(empire).filter((g): g is ShipGroup => g !== null && g.leadShip !== null && g.ships.length > 0);
    const dist = (g: ShipGroup): number => galaxy.calculateDistance(g.leadShip!.xpos, g.leadShip!.ypos, capital.xpos, capital.ypos);
    const atCapital = groups.filter((g) => dist(g) <= range || g.gatherPoint === capital);
    if (atCapital.length !== 1) return;
    const only = atCapital[0];
    const admiral = getEmpireCharacters(empire).find((c) => c.role === CharacterRole.FleetAdmiral && c.determineFleet() === only);
    if (admiral === undefined) return;
    const e = st.chars.get(admiral);
    if (e === undefined || e.loyalty >= 30) return;
    let best: ShipGroup | null = null;
    for (const g of groups) if (g !== only && (best === null || dist(g) < dist(best))) best = g;
    if (best !== null) best.gatherPoint = capital;
}

/** Autonomy upkeep: hold the low tax; restore the ported tax rule when it ends. */
function reviewAutonomy(galaxy: Galaxy, year: number): void {
    const st = politicsState(galaxy);
    for (const [colony, until] of [...st.autonomy]) {
        const empire = colony.empire;
        if (!isPoliticalEmpire(galaxy, empire)) {
            st.autonomy.delete(colony);
            continue;
        }
        if (year >= until) {
            st.autonomy.delete(colony);
            colony.taxRate = 0;
            setColonyTaxRate(galaxy, empire, colony, false);
        } else {
            colony.taxRate = 0.05;
        }
    }
}

// ---------------------------------------------------------------------------
// The yearly handler (§2.5)
// ---------------------------------------------------------------------------

/** Updates every modelled character's loyalty (and grievances) for `year`; no Rnd. */
export function updateLoyalties(galaxy: Galaxy, empire: Empire, year: number): void {
    const st = politicsState(galaxy);
    for (const c of getEmpireCharacters(empire)) {
        if (!c.active) continue;
        const known = st.chars.has(c);
        const e = politicsEntry(galaxy, c);
        if (!known) continue; // first sight: the entry starts at the initial loyalty
        const { delta, causes } = yearlyLoyaltyDelta(galaxy, c, e, year);
        e.loyalty = clamp(e.loyalty + delta, 0, 100);
        e.loyaltyTrend = delta;
        e.lastCauses = causes;
        for (const x of causes) if (x.amount < -2) e.grievances.push({ year, cause: x.cause, amount: x.amount });
        e.grievances = e.grievances.filter((g) => year - g.year < 5);
    }
}

/** Exported for tests. */
export function sendLoyaltyWarnings(galaxy: Galaxy, empire: Empire, year: number): void {
    const st = politicsState(galaxy);
    for (const c of getEmpireCharacters(empire)) {
        const e = st.chars.get(c);
        if (e === undefined || !canPlot(c) || e.loyalty >= 35 || e.ambition <= 60 || year - e.warnedYear < 3) continue;
        e.warnedYear = year;
        const m = scenarioMessage(galaxy, empire, scenarioText('Emergent Loyalty Warning Title'), scenarioText('Emergent Loyalty Warning', roleName(c), c.name), {
            type: EmpireMessageType.GeneralWarning,
            subject: c,
        });
        // 19s-2 voices (flag llmVoices; inert otherwise, no state): the restless character's ultimatum, in their voice,
        // for the discontented behind them (the 19n court factions use voiceFactionUltimatum once merged).
        if (empire === galaxy.playerEmpire && voicesOn(galaxy)) {
            const causes = [...new Set(e.grievances.slice().sort((a, b) => a.amount - b.amount).map((g) => g.cause))].slice(0, 3);
            noteVoiceCue(galaxy, {
                kind: 'ultimatum',
                empire,
                message: m,
                voice: empire,
                other: null,
                speaker: c,
                role: `${roleName(c)} ${c.name}`,
                facts: { leader: c.name, leaderRole: roleName(c), loyalty: Math.round(e.loyalty), ambition: Math.round(e.ambition), grievances: causes.join(', ') || 'none recorded', demand: 'honours and a greater share of power', threat: 'the loyalty of their followers' },
            });
        }
    }
}

/** One empire's plot step (§2.5b-c). Returns the plot kind attempted (null: none). */
export function reviewEmpirePlots(galaxy: Galaxy, empire: Empire, year: number): PlotKind | null {
    const st = politicsState(galaxy);
    const intensity = scenarioParam(galaxy, 'politicsIntensity', 1);
    if (intensity <= 0) return null;
    const last = st.lastPlotYear.get(empire);
    if (last !== undefined && year - last < 2) return null;
    const inst = empireInstability(galaxy, empire);
    if (inst <= 0) return null;
    let pick: Character | null = null;
    let pickP = 0;
    for (const c of getEmpireCharacters(empire)) {
        if (!c.active || !canPlot(c)) continue;
        const e = st.chars.get(c);
        if (e === undefined) continue;
        let p = plotScore(e, inst, intensity);
        if (politicsHooks.plotScoreFactor !== null) p *= politicsHooks.plotScoreFactor(galaxy, empire, c);
        if (p > pickP) {
            pick = c;
            pickP = p;
        }
    }
    if (pick === null) return null;
    let chance = pickP * 0.35;
    if (politicsHooks.plotChanceFactor !== null) chance *= politicsHooks.plotChanceFactor(galaxy, empire);
    // RND(19d1): plot roll
    if (!(galaxy.rnd.nextDouble() < chance)) return null;
    const kind = plotKindFor(galaxy, empire, pick, st.chars.get(pick)!);
    switch (kind) {
        case 'coup':
            attemptCoup(galaxy, empire, pick, year);
            break;
        case 'secession':
            attemptSecession(galaxy, empire, pick, year);
            break;
        case 'defection':
            attemptDefection(galaxy, empire, pick, year);
            break;
        default:
            plotRumour(galaxy, empire, pick, year);
            break;
    }
    return kind;
}

/** Drops entries of dead / inactive / pirate / independent characters. */
function pruneEntries(galaxy: Galaxy): void {
    const st = politicsState(galaxy);
    for (const c of [...st.chars.keys()]) {
        if (!c.active || !isPoliticalEmpire(galaxy, c.empire)) dropCharacter(galaxy, c);
    }
    for (const c of [...st.exposed]) if (!st.chars.has(c)) st.exposed.delete(c);
}

/** §2.5 the yearly handler. */
export function reviewPolitics(galaxy: Galaxy, year: number): void {
    if (!scenarioFlag(galaxy, POLITICS_FLAG)) return;
    pruneEntries(galaxy);
    reviewAutonomy(galaxy, year);
    // Snapshot: a secession appends a new empire to galaxy.empires (it is reviewed from next year).
    const empires = galaxy.empires.filter((e) => isPoliticalEmpire(galaxy, e));
    for (const empire of empires) {
        if (!isPoliticalEmpire(galaxy, empire)) continue;
        updateLoyalties(galaxy, empire, year);
        if (empire === galaxy.playerEmpire) sendLoyaltyWarnings(galaxy, empire, year);
        else {
            aiHonour(galaxy, empire, year);
            aiGuardCapital(galaxy, empire);
        }
        reviewEmpirePlots(galaxy, empire, year);
    }
}

/** First sight of every character: at game start and on creation (entries only; no Rnd). */
export function seedPoliticsEntries(galaxy: Galaxy): void {
    for (const e of galaxy.empires) {
        if (!isPoliticalEmpire(galaxy, e)) continue;
        for (const c of getEmpireCharacters(e)) if (c.active) politicsEntry(galaxy, c);
    }
}

registerScenarioYearly({ id: 'emergent.politics', flag: POLITICS_FLAG, order: 10, run: reviewPolitics });
registerScenarioGameStart({ id: 'emergent.politics', flag: POLITICS_FLAG, run: (galaxy) => seedPoliticsEntries(galaxy) });
registerScenarioEvent({
    id: 'emergent.politics',
    flag: POLITICS_FLAG,
    event: 'characterCreated',
    run: (galaxy, p) => {
        const c = p.character as Character;
        if (isPoliticalEmpire(galaxy, p.empire) && c.empire === p.empire) politicsEntry(galaxy, c);
    },
});
