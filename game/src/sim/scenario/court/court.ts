// 19n court & dynasties, package 1 (tasks/19-mod-layer-scenarios.md §19n items 1 houses, 2 council, 3 character
// factions, 4 succession, 9 legitimacy). Not a port: a scenario package on the mod layer (tasks/MODLAYER-DESIGN.md)
// on top of 19d1 internal politics (loyalty / ambition / plots) and 19m internal security (the stability ledger, the
// counter-intelligence roll).
//   1. Houses — every character belongs to a house of its empire (picked by a hash of its name, no Rnd); the leader at
//      game start founds the ruling house. Prestige rises with wars won, wonders and long reigns, falls with lost
//      colonies. Ruling-house members are favoured for seats and rarely plot; rival houses feud (a yearly roll → loyalty
//      loss and a "feud" term in the stability ledger).
//   2. Council — five seats (spymaster, chancellor, marshal, steward, magistrate) wired to stock numbers: the 19m
//      counter-intelligence strength, the other empires' IncidentEvaluation of us, the ships' captain repair / damage
//      control bytes, the colony tax revenue and a stability term. Player: command `courtAppoint`; AI: by skill.
//      Powerful characters left without a seat gain ambition yearly.
//   3. Character factions — discontented characters (low loyalty, no seat, not of the ruling house) form a faction
//      with a demand; an ultimatum decision: concede (the demand is applied through the existing functions) or refuse
//      (the faction backs a 19d1 plot: its members' plot scores and the empire's plot chance rise).
//   4. Succession — a law per government (courtData.ts successionLawFor; param courtSuccessionLaw overrides): the
//      stock PerformChangeLeader asks this package for the successor (scenario/hooks.ts scenarioLeaderSuccession).
//      Heirs are designated yearly; a young heir gets a regent; a strong rival claimant from another house makes a
//      succession crisis (one roll; the loser's house feuds with the winner's).
//   9. Legitimacy — per leader, 0–100: set at succession (lawful / regency / crisis / usurpation), moved yearly by
//      the ruling house's prestige, reign length, regencies and purges; multiplies every 19d1 plot chance and the
//      faction formation chance.
//
// Gate: every handler is registered with flag `courtDynasties`; the 19d1 / 19m hook slots this module fills return
// their "off" value (1 / 0) unless the flag is on. Rnd: galaxy.rnd is drawn only in the yearly handler (feud rolls,
// the faction roll, a regency hand-over through the stock ChangeLeader) and in the succession hook (a crisis roll; the
// stock ChangeLeader's own draws follow) — all behind the flag. Terms, queries and the UI rows are pure and never
// create state.
//
// The 19l-5 living calendar (flag `livingCalendar`, not built yet) must skip its own election / coronation rolls when
// courtHandlesSuccession(galaxy) is true.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import { type Character, CharacterRole, CharacterTraitType, getEmpireCharacters, stellarObjectCharacters } from '../../characters';
import { changeLeader } from '../../characterRuntime';
import { empireGovernmentAttributes } from '../../empire';
import { DiplomaticRelationType, obtainEmpireEvaluation } from '../../diplomacy';
import { declareWar } from '../../diplomacyTick';
import { reviewTaxes } from '../../taxes';
import { EmpireMessageType } from '../../messages';
import { YEAR_LENGTH } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { registerScenarioEvent, registerScenarioGameStart, registerScenarioQuery, registerScenarioSuccession, registerScenarioYearly } from '../hooks';
import { registerScenarioDecision, raiseScenarioDecision, type ScenarioDecision } from '../decisions';
import { scenarioFlag, scenarioParam, scenarioState } from '../state';
import { scenarioMessage, scenarioText } from '../messages';
import { registerStabilityTerm } from '../stability';
import { POLITICS_FLAG, canPlot, governedColony, isPoliticalEmpire, peekPoliticsState, politicsEntry, politicsHooks, politicsYear } from '../emergent/politics';
import { grantAutonomy } from '../emergent/politicsActions';
import { peekSecurityState, securitySlots } from '../security/registry';
import { DEFAULT_HOUSE_NAMES, HOUSE_NAMES, SUCCESSION_LAWS, successionLawFor, type SuccessionLaw } from './courtData';

export const COURT_FLAG = 'courtDynasties';
export const FACTION_DECISION = 'court.faction';
export type { SuccessionLaw };

// ---------------------------------------------------------------------------------------------------------------
// Params (scenarios/court-dynasties/scenario.json)
// ---------------------------------------------------------------------------------------------------------------

export const COURT_PARAMS = {
    housesPerEmpire: (g: Galaxy) => Math.max(2, Math.round(scenarioParam(g, 'courtHousesPerEmpire', 4))),
    feudPct: (g: Galaxy) => scenarioParam(g, 'courtFeudPct', 20),
    feudLoyalty: (g: Galaxy) => scenarioParam(g, 'courtFeudLoyalty', 5),
    feudApproval: (g: Galaxy) => scenarioParam(g, 'courtFeudApproval', 3),
    houseFavour: (g: Galaxy) => scenarioParam(g, 'courtHouseFavour', 10),
    rulingPlotPct: (g: Galaxy) => scenarioParam(g, 'courtRulingPlotPct', 50),
    rivalPlotPct: (g: Galaxy) => scenarioParam(g, 'courtRivalPlotPct', 150),
    warPrestige: (g: Galaxy) => scenarioParam(g, 'courtWarPrestige', 10),
    wonderPrestige: (g: Galaxy) => scenarioParam(g, 'courtWonderPrestige', 5),
    reignYears: (g: Galaxy) => scenarioParam(g, 'courtLongReignYears', 5),
    reignPrestige: (g: Galaxy) => scenarioParam(g, 'courtReignPrestige', 2),
    colonyLossPrestige: (g: Galaxy) => scenarioParam(g, 'courtColonyLossPrestige', 5),
    spymasterPct: (g: Galaxy) => scenarioParam(g, 'courtSpymasterPct', 50),
    chancellorAttitude: (g: Galaxy) => scenarioParam(g, 'courtChancellorAttitude', 2),
    marshalBonus: (g: Galaxy) => scenarioParam(g, 'courtMarshalBonus', 10),
    stewardPct: (g: Galaxy) => scenarioParam(g, 'courtStewardPct', 5),
    magistrateApproval: (g: Galaxy) => scenarioParam(g, 'courtMagistrateApproval', 2),
    seatlessAmbition: (g: Galaxy) => scenarioParam(g, 'courtSeatlessAmbition', 5),
    factionLoyalty: (g: Galaxy) => scenarioParam(g, 'courtFactionLoyalty', 40),
    factionMin: (g: Galaxy) => Math.max(1, Math.round(scenarioParam(g, 'courtFactionMin', 2))),
    factionPct: (g: Galaxy) => scenarioParam(g, 'courtFactionPct', 25),
    factionYears: (g: Galaxy) => scenarioParam(g, 'courtFactionYears', 3),
    factionPlotPct: (g: Galaxy) => scenarioParam(g, 'courtFactionPlotPct', 150),
    concedeLoyalty: (g: Galaxy) => scenarioParam(g, 'courtConcedeLoyalty', 15),
    concedeLegitimacy: (g: Galaxy) => scenarioParam(g, 'courtConcedeLegitimacy', 3),
    successionLaw: (g: Galaxy) => Math.round(scenarioParam(g, 'courtSuccessionLaw', 0)),
    regencyYears: (g: Galaxy) => scenarioParam(g, 'courtRegencyYears', 2),
    regencyPenalty: (g: Galaxy) => scenarioParam(g, 'courtRegencyPenalty', 20),
    crisisPct: (g: Galaxy) => scenarioParam(g, 'courtCrisisPct', 80),
    crisisPenalty: (g: Galaxy) => scenarioParam(g, 'courtCrisisPenalty', 15),
    lawfulLegitimacy: (g: Galaxy) => scenarioParam(g, 'courtLawfulLegitimacy', 10),
    coupLegitimacy: (g: Galaxy) => scenarioParam(g, 'courtCoupLegitimacy', 25),
    purgeLegitimacy: (g: Galaxy) => scenarioParam(g, 'courtPurgeLegitimacy', 10),
    startLegitimacy: (g: Galaxy) => scenarioParam(g, 'courtStartLegitimacy', 60),
};
const P = COURT_PARAMS;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------

export type SeatName = 'spymaster' | 'chancellor' | 'marshal' | 'steward' | 'magistrate';
export const SEATS: readonly SeatName[] = ['spymaster', 'chancellor', 'marshal', 'steward', 'magistrate'];
export type CouncilSeats = Record<SeatName, Character | null>;

export interface House {
    id: number;
    name: string;
    empire: Empire;
    /** 0–100. */
    prestige: number;
    /** Game year founded. */
    founded: number;
    founder: Character | null;
    /** Ids of houses this one feuds with (symmetric). */
    rivals: number[];
}

export type FactionDemand =
    | { kind: 'taxes' }
    | { kind: 'war'; target: Empire }
    | { kind: 'autonomy'; colony: Habitat }
    | { kind: 'seat'; seat: SeatName };

export interface Faction {
    id: number;
    empire: Empire;
    members: Character[];
    leader: Character;
    demand: FactionDemand;
    formed: number;
    /** 'pending': ultimatum raised; 'backing': refused — the faction backs a plot until `until` (game year). */
    state: 'pending' | 'backing';
    until: number;
}

export interface Regency {
    regent: Character;
    heir: Character;
    /** Game year the heir takes the throne. */
    until: number;
}

export interface FeudIncident {
    year: number;
    empire: Empire;
    a: number;
    b: number;
}

/** Colonies taken between two empires during their current war (net for `a`). */
export interface WarTally {
    a: Empire;
    b: Empire;
    net: number;
}

export type CourtEventKind = 'founded' | 'succession' | 'regency' | 'regencyEnd' | 'crisis' | 'usurpation' | 'feud' | 'faction' | 'concede' | 'refuse' | 'appoint' | 'prestige';

export interface CourtEvent {
    year: number;
    empire: Empire;
    kind: CourtEventKind;
    text: string;
}

export interface CourtState {
    seeded: boolean;
    /** Star date of the seeding (game start). */
    seededAt: number;
    nextHouseId: number;
    houses: House[];
    members: Map<Character, number>;
    ruling: Map<Empire, number>;
    seats: Map<Empire, CouncilSeats>;
    heirs: Map<Empire, Character>;
    legitimacy: Map<Character, number>;
    reignStart: Map<Empire, number>;
    lastLeader: Map<Empire, Character>;
    regencies: Map<Empire, Regency>;
    /** Characters that appeared after the game start → the game year (a "young" heir needs a regent). */
    born: Map<Character, number>;
    nextFactionId: number;
    factions: Faction[];
    feuds: FeudIncident[];
    wars: WarTally[];
    /** Star date of the last purge already charged against legitimacy. */
    purgeSeen: Map<Empire, number>;
    /** Wonders already counted for prestige (colony + facility id + build date keys). */
    wondersSeen: Map<Empire, string[]>;
    events: CourtEvent[];
}

export function courtState(galaxy: Galaxy): CourtState {
    return scenarioState<CourtState>(galaxy, 'court', () => ({
        seeded: false,
        seededAt: 0,
        nextHouseId: 1,
        houses: [],
        members: new Map(),
        ruling: new Map(),
        seats: new Map(),
        heirs: new Map(),
        legitimacy: new Map(),
        reignStart: new Map(),
        lastLeader: new Map(),
        regencies: new Map(),
        born: new Map(),
        nextFactionId: 1,
        factions: [],
        feuds: [],
        wars: [],
        purgeSeen: new Map(),
        wondersSeen: new Map(),
        events: [],
    }));
}

/** The state if it exists (pure readers / UI: never creates it). */
export function peekCourtState(galaxy: Galaxy): CourtState | null {
    const s = galaxy.scenario;
    if (s === null || !('court' in s.state)) return null;
    return s.state.court as CourtState;
}

export function courtOn(galaxy: Galaxy): boolean {
    return scenarioFlag(galaxy, COURT_FLAG);
}

/** True when the court runs successions (the living calendar skips its election / coronation rolls then). */
export function courtHandlesSuccession(galaxy: Galaxy): boolean {
    return courtOn(galaxy);
}

const courtYear = (galaxy: Galaxy): number => politicsYear(galaxy);

function logCourt(galaxy: Galaxy, empire: Empire, kind: CourtEventKind, text: string): void {
    const st = courtState(galaxy);
    st.events.push({ year: courtYear(galaxy), empire, kind, text });
    if (st.events.length > 200) st.events.splice(0, st.events.length - 200);
}

function tellPlayer(galaxy: Galaxy, empire: Empire, tag: string, args: unknown[], type: EmpireMessageType, subject: unknown = null): void {
    if (empire !== galaxy.playerEmpire) return;
    scenarioMessage(galaxy, empire, scenarioText(`${tag} Title`), scenarioText(tag, ...args), { type, subject: (subject ?? empire.capital) as never });
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Houses
// ---------------------------------------------------------------------------------------------------------------

/** FNV-1a 32-bit hash (deterministic house picks; no Rnd). */
export function courtHash(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

export function houseById(galaxy: Galaxy, id: number | undefined): House | null {
    if (id === undefined) return null;
    return peekCourtState(galaxy)?.houses.find((h) => h.id === id) ?? null;
}

export function empireHouses(galaxy: Galaxy, empire: Empire): House[] {
    return (peekCourtState(galaxy)?.houses ?? []).filter((h) => h.empire === empire).sort((a, b) => a.id - b.id);
}

/** The house of a character (pure; null before it is assigned). */
export function houseOf(galaxy: Galaxy, c: Character): House | null {
    return houseById(galaxy, peekCourtState(galaxy)?.members.get(c));
}

export function rulingHouse(galaxy: Galaxy, empire: Empire): House | null {
    return houseById(galaxy, peekCourtState(galaxy)?.ruling.get(empire));
}

function surname(name: string): string {
    const parts = name.trim().split(/\s+/);
    return parts[parts.length - 1] ?? name;
}

function raceHouseNames(empire: Empire): readonly string[] {
    const race = empire.dominantRace;
    return (race !== null ? HOUSE_NAMES[race.name] : undefined) ?? DEFAULT_HOUSE_NAMES;
}

/** Creates an empire's houses on first sight: the ruling house founded by the leader, plus houses from the race table. */
export function ensureEmpireHouses(galaxy: Galaxy, empire: Empire): House[] {
    const st = courtState(galaxy);
    const have = st.houses.filter((h) => h.empire === empire);
    if (have.length > 0) return have;
    const year = courtYear(galaxy);
    const names = raceHouseNames(empire);
    const leader = empire.leader;
    const used = new Set<string>();
    const make = (name: string, founder: Character | null, prestige: number): House => {
        let n = name;
        for (let k = 2; used.has(n); k++) n = `${name} ${k}`;
        used.add(n);
        const h: House = { id: st.nextHouseId++, name: n, empire, prestige, founded: year, founder, rivals: [] };
        st.houses.push(h);
        return h;
    };
    const ruling = make(leader !== null ? surname(leader.name) : names[courtHash(empire.name) % names.length], leader, 50);
    st.ruling.set(empire, ruling.id);
    const start = courtHash(`${empire.empireId}|${empire.name}`) % names.length;
    for (let i = 0; st.houses.filter((h) => h.empire === empire).length < P.housesPerEmpire(galaxy) && i < names.length * 2; i++) {
        const n = names[(start + i) % names.length];
        if (!used.has(n)) make(n, null, 25);
    }
    if (leader !== null) st.members.set(leader, ruling.id);
    logCourt(galaxy, empire, 'founded', scenarioText('Court Founded', ruling.name, empire.name));
    return st.houses.filter((h) => h.empire === empire);
}

/** The house index a character hashes to among `count` houses (pure). */
export function houseIndexFor(c: Character, empire: Empire, count: number): number {
    return courtHash(`${c.name}|${empire.empireId}`) % count;
}

/** Assigns a house to `c` (deterministic by name and empire); a character that changed empire gets a house there. */
export function ensureHouse(galaxy: Galaxy, c: Character): House | null {
    const empire = c.empire;
    if (!isPoliticalEmpire(galaxy, empire)) return null;
    const st = courtState(galaxy);
    const cur = houseById(galaxy, st.members.get(c));
    if (cur !== null && cur.empire === empire) return cur;
    const houses = ensureEmpireHouses(galaxy, empire).slice().sort((a, b) => a.id - b.id);
    const h = houses[houseIndexFor(c, empire, houses.length)];
    st.members.set(c, h.id);
    return h;
}

export function houseMembers(galaxy: Galaxy, house: House): Character[] {
    const st = peekCourtState(galaxy);
    if (st === null) return [];
    return getEmpireCharacters(house.empire).filter((c) => c.active && st.members.get(c) === house.id);
}

export function addPrestige(house: House, amount: number): void {
    house.prestige = clamp(house.prestige + amount, 0, 100);
}

export function areRivals(a: House, b: House): boolean {
    return a.rivals.includes(b.id);
}

export function makeRivals(a: House, b: House): void {
    if (a === b) return;
    if (!a.rivals.includes(b.id)) a.rivals.push(b.id);
    if (!b.rivals.includes(a.id)) b.rivals.push(a.id);
}

function isLeader(c: Character): boolean {
    return c.role === CharacterRole.Leader || c.role === CharacterRole.PirateLeader;
}

/** Court members of an empire: active, not the leader (the candidates for seats, heirs, factions). */
function courtiers(empire: Empire): Character[] {
    return getEmpireCharacters(empire).filter((c) => c.active && c.empire === empire && !isLeader(c));
}

// ---------------------------------------------------------------------------------------------------------------
// 9. Legitimacy
// ---------------------------------------------------------------------------------------------------------------

/** The leader's legitimacy (0–100; 50 when unknown). Pure. */
export function leaderLegitimacy(galaxy: Galaxy, empire: Empire): number {
    const leader = empire.leader;
    const st = peekCourtState(galaxy);
    if (leader === null || st === null) return 50;
    return st.legitimacy.get(leader) ?? 50;
}

/** The plot / faction multiplier of a legitimacy: 1.5 at 0, 1 at 50, 0.5 at 100. */
export function legitimacyFactorOf(legitimacy: number): number {
    return clamp(1.5 - legitimacy / 100, 0.5, 1.5);
}

export function legitimacyFactor(galaxy: Galaxy, empire: Empire): number {
    return legitimacyFactorOf(leaderLegitimacy(galaxy, empire));
}

/** A lawful successor's starting legitimacy: 50 + ruling-house prestige / 5 + courtLawfulLegitimacy. */
export function lawfulLegitimacy(galaxy: Galaxy, house: House | null): number {
    return clamp(50 + (house !== null ? house.prestige / 5 : 0) + P.lawfulLegitimacy(galaxy), 0, 100);
}

function setLegitimacy(galaxy: Galaxy, c: Character, v: number): void {
    courtState(galaxy).legitimacy.set(c, clamp(v, 0, 100));
}

/** Star date of the empire's last purge (19d1 purge year or the 19m purge action), or null. */
function lastPurgeDate(galaxy: Galaxy, empire: Empire): number | null {
    let best: number | null = null;
    const py = peekPoliticsState(galaxy)?.purgeYear.get(empire);
    if (py !== undefined) best = py * YEAR_LENGTH;
    const sd = peekSecurityState(galaxy)?.purges.get(empire);
    if (sd !== undefined && (best === null || sd > best)) best = sd;
    return best;
}

/** The yearly legitimacy change of the current leader and its causes. Pure (apart from reading state). */
export function yearlyLegitimacyDelta(galaxy: Galaxy, empire: Empire, year: number): { delta: number; causes: { cause: string; amount: number }[] } {
    const st = peekCourtState(galaxy);
    const causes: { cause: string; amount: number }[] = [];
    const add = (cause: string, amount: number): void => {
        if (amount !== 0) causes.push({ cause, amount });
    };
    const ruling = rulingHouse(galaxy, empire);
    if (ruling !== null) add('prestige', clamp((ruling.prestige - 50) / 25, -2, 2));
    const start = st?.reignStart.get(empire);
    if (start !== undefined && year - start >= P.reignYears(galaxy)) add('longReign', 1);
    if (st?.regencies.has(empire) === true) add('regency', -1);
    const purge = lastPurgeDate(galaxy, empire);
    const seen = st?.purgeSeen.get(empire) ?? st?.seededAt ?? 0;
    if (purge !== null && purge > seen) add('purge', -P.purgeLegitimacy(galaxy));
    let delta = 0;
    for (const x of causes) delta += x.amount;
    return { delta, causes };
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Council
// ---------------------------------------------------------------------------------------------------------------

function emptySeats(): CouncilSeats {
    return { spymaster: null, chancellor: null, marshal: null, steward: null, magistrate: null };
}

/** The holder of a seat (pure; null when vacant, the flag is off or the holder is gone). */
export function seatHolder(galaxy: Galaxy, empire: Empire, seat: SeatName): Character | null {
    if (!courtOn(galaxy)) return null;
    const c = peekCourtState(galaxy)?.seats.get(empire)?.[seat] ?? null;
    return c !== null && c.active && c.empire === empire ? c : null;
}

/** The seat a character holds (pure). */
export function seatOf(galaxy: Galaxy, c: Character): SeatName | null {
    const empire = c.empire;
    if (empire === null) return null;
    const seats = peekCourtState(galaxy)?.seats.get(empire);
    if (seats === undefined) return null;
    for (const s of SEATS) if (seats[s] === c) return s;
    return null;
}

/** Who may sit where: the spymaster is an agent, the marshal an admiral or general; any courtier otherwise. */
export function seatEligible(c: Character, seat: SeatName): boolean {
    if (isLeader(c)) return false;
    switch (seat) {
        case 'spymaster':
            return c.role === CharacterRole.IntelligenceAgent;
        case 'marshal':
            return c.role === CharacterRole.FleetAdmiral || c.role === CharacterRole.TroopGeneral;
        default:
            return true;
    }
}

/** The skill a seat uses (pure). */
export function seatSkill(c: Character, seat: SeatName): number {
    switch (seat) {
        case 'spymaster':
            return c.counterEspionage;
        case 'chancellor':
            return c.diplomacy;
        case 'marshal':
            return c.targeting + c.countermeasures + c.damageControl + c.repairBonus + c.troopGroundAttack;
        case 'steward':
            return c.colonyIncome + c.tradeIncome;
        case 'magistrate':
            return c.colonyHappiness + (c.traits.includes(CharacterTraitType.Lawful) ? 10 : 0);
    }
}

/** Why `c` cannot take `seat` (null: it can). `c` null = vacate. Pure. */
export function appointBlocked(galaxy: Galaxy, empire: Empire, seat: SeatName, c: Character | null): string | null {
    if (!courtOn(galaxy)) return 'The court is off';
    if (!SEATS.includes(seat)) return 'No such seat';
    if (c === null) return null;
    if (!c.active || c.empire !== empire) return 'Not one of our characters';
    if (isLeader(c)) return 'Not the leader';
    if (!seatEligible(c, seat)) return seat === 'spymaster' ? 'Needs an intelligence agent' : 'Needs an admiral or a general';
    return null;
}

/** Appoints `c` to `seat` (null: vacates it); a character holds one seat (its old one is vacated). The player op. */
export function appointToSeat(galaxy: Galaxy, empire: Empire, seat: SeatName, c: Character | null): { ok: boolean; reason?: string } {
    const why = appointBlocked(galaxy, empire, seat, c);
    if (why !== null) return { ok: false, reason: why };
    const st = courtState(galaxy);
    let seats = st.seats.get(empire);
    if (seats === undefined) st.seats.set(empire, (seats = emptySeats()));
    if (c !== null) for (const s of SEATS) if (seats[s] === c) seats[s] = null;
    seats[seat] = c;
    if (c !== null) {
        ensureHouse(galaxy, c);
        logCourt(galaxy, empire, 'appoint', scenarioText('Court Appointed', c.name, seatLabel(seat)));
    }
    return { ok: true };
}

export function seatLabel(seat: SeatName): string {
    return scenarioText(`Court Seat ${seat}`);
}

/** AI rule: each seat in order goes to the best eligible courtier by seat skill (+ courtHouseFavour for the ruling house). */
export function aiAppointCouncil(galaxy: Galaxy, empire: Empire): void {
    const st = courtState(galaxy);
    const ruling = st.ruling.get(empire);
    const seats = emptySeats();
    const taken = new Set<Character>();
    const pool = courtiers(empire);
    for (const seat of SEATS) {
        let best: Character | null = null;
        let bestScore = -Infinity;
        for (const c of pool) {
            if (taken.has(c) || !seatEligible(c, seat)) continue;
            const score = seatSkill(c, seat) + (ruling !== undefined && st.members.get(c) === ruling ? P.houseFavour(galaxy) : 0);
            if (score > bestScore) {
                best = c;
                bestScore = score;
            }
        }
        if (best !== null) {
            seats[seat] = best;
            taken.add(best);
        }
    }
    st.seats.set(empire, seats);
}

/** Spymaster: extra counter-intelligence strength in the 19m detection roll = CounterEspionageFactored × courtSpymasterPct%. */
export function spymasterStrengthBonus(galaxy: Galaxy, empire: Empire): number {
    const c = seatHolder(galaxy, empire, 'spymaster');
    return c === null ? 0 : (c.counterEspionageFactored * P.spymasterPct(galaxy)) / 100;
}

/** Chancellor: the yearly IncidentEvaluation gain other empires give us = courtChancellorAttitude × (1 + Diplomacy⁺ / 20). */
export function chancellorAttitudeBonus(galaxy: Galaxy, empire: Empire): number {
    const c = seatHolder(galaxy, empire, 'chancellor');
    return c === null ? 0 : P.chancellorAttitude(galaxy) * (1 + Math.max(0, c.diplomacy) / 20);
}

/** Marshal: captain repair / damage-control points for the empire's fleet ships = round(courtMarshalBonus × (1 + skill⁺ / 100)). */
export function marshalBonusPoints(galaxy: Galaxy, empire: Empire): number {
    const c = seatHolder(galaxy, empire, 'marshal');
    return c === null ? 0 : Math.round(P.marshalBonus(galaxy) * (1 + clamp(seatSkill(c, 'marshal'), 0, 100) / 100));
}

/** Steward: tax revenue factor = 1 + courtStewardPct% × (1 + (ColonyIncome + TradeIncome)⁺ / 20). */
export function stewardTaxFactor(galaxy: Galaxy, empire: Empire): number {
    const c = seatHolder(galaxy, empire, 'steward');
    return c === null ? 1 : 1 + (P.stewardPct(galaxy) / 100) * (1 + Math.max(0, seatSkill(c, 'steward')) / 20);
}

/** Magistrate: a stability term on every colony = courtMagistrateApproval × (1 + skill⁺ / 20). */
export function magistrateTerm(galaxy: Galaxy, h: Habitat): number | null {
    const empire = h.empire;
    if (empire === null) return null;
    const c = seatHolder(galaxy, empire, 'magistrate');
    return c === null ? null : P.magistrateApproval(galaxy) * (1 + Math.max(0, seatSkill(c, 'magistrate')) / 20);
}

/** Applies the chancellor's yearly attitude gain to every empire we have met (their IncidentEvaluation of us). */
export function applyChancellor(galaxy: Galaxy, empire: Empire): void {
    const bonus = chancellorAttitudeBonus(galaxy, empire);
    if (bonus <= 0) return;
    for (const other of galaxy.empires) {
        if (other === empire || !isPoliticalEmpire(galaxy, other)) continue;
        const rel = empire.diplomaticRelations.byEmpire(other);
        if (rel === null || rel.type === DiplomaticRelationType.NotMet) continue;
        const ev = obtainEmpireEvaluation(galaxy, other, empire);
        ev.incidentEvaluation = ev.incidentEvaluationRaw + bonus;
    }
}

/** Powerful courtiers (ambition ≥ 50 or skill total ≥ 40) without a seat gain courtSeatlessAmbition (19d1 ambition). */
export function seatlessAmbition(galaxy: Galaxy, empire: Empire): void {
    if (!scenarioFlag(galaxy, POLITICS_FLAG)) return;
    const amount = P.seatlessAmbition(galaxy);
    for (const c of courtiers(empire)) {
        if (!canPlot(c) || seatOf(galaxy, c) !== null) continue;
        const e = politicsEntry(galaxy, c);
        if (e.ambition >= 50 || c.getSkillLevelTotal() >= 40) e.ambition = Math.min(100, e.ambition + amount);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Succession
// ---------------------------------------------------------------------------------------------------------------

/** The empire's succession law (param courtSuccessionLaw 1–3 overrides the government table). Pure. */
export function successionLaw(galaxy: Galaxy, empire: Empire): SuccessionLaw {
    const o = P.successionLaw(galaxy);
    if (o >= 1 && o <= 3) return SUCCESSION_LAWS[o - 1];
    const gov = empireGovernmentAttributes(empire);
    return gov === null ? 'primogeniture' : successionLawFor(gov.leaderReplacementTypicalManner, gov.leaderReplacementCharacterPool);
}

/** Rank inside a house: skill total + 10 for a seat + 2 per year at court (max 20). Pure. */
export function courtRank(galaxy: Galaxy, c: Character): number {
    const years = Math.max(0, (galaxyStarDate(galaxy) - c.startDate) / YEAR_LENGTH);
    return c.getSkillLevelTotal() + (seatOf(galaxy, c) !== null ? 10 : 0) + Math.min(20, 2 * years);
}

/** A claim: rank + half the house's prestige. Pure. */
export function claimScore(galaxy: Galaxy, c: Character): number {
    return courtRank(galaxy, c) + (houseOf(galaxy, c)?.prestige ?? 0) / 2;
}

function bestBy(list: Character[], score: (c: Character) => number): Character | null {
    let best: Character | null = null;
    let bestScore = -Infinity;
    for (const c of list) {
        const s = score(c);
        if (s > bestScore) {
            best = c;
            bestScore = s;
        }
    }
    return best;
}

function isMilitary(c: Character): boolean {
    return c.role === CharacterRole.FleetAdmiral || c.role === CharacterRole.TroopGeneral;
}

/** The candidates a law considers (courtiers; acclamation: the military; falls back to every courtier). */
function lawCandidates(galaxy: Galaxy, empire: Empire, law: SuccessionLaw): Character[] {
    const all = courtiers(empire).filter((c) => canPlot(c));
    if (law === 'primogeniture') {
        const ruling = courtState(galaxy).ruling.get(empire);
        return all.filter((c) => courtState(galaxy).members.get(c) === ruling);
    }
    if (law === 'acclamation') {
        const mil = all.filter(isMilitary);
        return mil.length > 0 ? mil : all;
    }
    return all;
}

/** The heir the law names now (primogeniture: the ruling house by rank; election: the front-runner; acclamation: the best soldier). */
export function lawHeir(galaxy: Galaxy, empire: Empire): Character | null {
    const law = successionLaw(galaxy, empire);
    const cands = lawCandidates(galaxy, empire, law);
    return law === 'election' ? bestBy(cands, (c) => claimScore(galaxy, c)) : bestBy(cands, (c) => courtRank(galaxy, c));
}

function validHeir(galaxy: Galaxy, empire: Empire, c: Character | undefined): c is Character {
    return c !== undefined && c.active && c.empire === empire && !isLeader(c);
}

/** Designates (and stores) the heir; primogeniture keeps a designated heir while they stay in the ruling house. */
export function designateHeir(galaxy: Galaxy, empire: Empire, c: Character | null = null): Character | null {
    const st = courtState(galaxy);
    const law = successionLaw(galaxy, empire);
    const cur = st.heirs.get(empire);
    let heir = c;
    if (heir === null) {
        if (law === 'primogeniture' && validHeir(galaxy, empire, cur) && st.members.get(cur) === st.ruling.get(empire)) heir = cur;
        else heir = lawHeir(galaxy, empire);
    }
    if (heir === null) st.heirs.delete(empire);
    else st.heirs.set(empire, heir);
    return heir;
}

/** A heir that appeared less than courtRegencyYears ago (characters present at the game start are adults). */
export function heirIsYoung(galaxy: Galaxy, c: Character): boolean {
    const born = peekCourtState(galaxy)?.born.get(c);
    return born !== undefined && courtYear(galaxy) - born < P.regencyYears(galaxy);
}

function pickRegent(galaxy: Galaxy, empire: Empire, heir: Character): Character | null {
    const chancellor = seatHolder(galaxy, empire, 'chancellor');
    if (chancellor !== null && chancellor !== heir && canPlot(chancellor)) return chancellor;
    const st = courtState(galaxy);
    const ruling = st.ruling.get(empire);
    const others = courtiers(empire).filter((c) => c !== heir && canPlot(c));
    return bestBy(others.filter((c) => st.members.get(c) === ruling), (c) => courtRank(galaxy, c)) ?? bestBy(others, (c) => courtRank(galaxy, c));
}

/** Records who now rules: legitimacy, ruling house, reign start, and the log. */
function crown(galaxy: Galaxy, empire: Empire, c: Character, legitimacy: number, house: House | null, kind: CourtEventKind, text: string): void {
    const st = courtState(galaxy);
    setLegitimacy(galaxy, c, legitimacy);
    if (house !== null) st.ruling.set(empire, house.id);
    st.reignStart.set(empire, courtYear(galaxy));
    st.lastLeader.set(empire, c);
    st.heirs.delete(empire);
    for (const s of SEATS) {
        const seats = st.seats.get(empire);
        if (seats !== undefined && seats[s] === c) seats[s] = null;
    }
    logCourt(galaxy, empire, kind, text);
}

/** The losing claimant of a crisis: 19d1 loyalty −20 / ambition +20; the houses feud. */
function crisisLoser(galaxy: Galaxy, loser: Character, winnerHouse: House | null): void {
    if (scenarioFlag(galaxy, POLITICS_FLAG) && isPoliticalEmpire(galaxy, loser.empire)) {
        const e = politicsEntry(galaxy, loser);
        e.loyalty = Math.max(0, e.loyalty - 20);
        e.ambition = Math.min(100, e.ambition + 20);
    }
    const lh = houseOf(galaxy, loser);
    if (lh !== null && winnerHouse !== null && lh !== winnerHouse) {
        makeRivals(lh, winnerHouse);
        courtState(galaxy).feuds.push({ year: courtYear(galaxy), empire: lh.empire, a: lh.id, b: winnerHouse.id });
    }
}

/**
 * The succession hook (performChangeLeader, Empire.6.cs 4873): picks the successor by the empire's law. A crisis
 * (a rival claimant of another house with a claim ≥ courtCrisisPct% of the heir's) is one roll, weighted by the claims.
 * A young heir gets a regent (the chancellor, else the best of the ruling house) until they come of age.
 */
export function courtSuccession(galaxy: Galaxy, empire: Empire, changeType: number): { pool: Character[]; changeType: number } | null {
    if (!courtOn(galaxy) || !isPoliticalEmpire(galaxy, empire)) return null;
    const st = courtState(galaxy);
    if (!st.seeded) return null;
    for (const c of courtiers(empire)) ensureHouse(galaxy, c);
    const law = successionLaw(galaxy, empire);
    let heir: Character | null = null;
    if (law === 'primogeniture') {
        const cur = st.heirs.get(empire);
        heir = validHeir(galaxy, empire, cur) && st.members.get(cur) === st.ruling.get(empire) ? cur : lawHeir(galaxy, empire);
    } else heir = lawHeir(galaxy, empire);
    let usedLaw = law;
    if (heir === null) {
        usedLaw = 'election';
        heir = bestBy(courtiers(empire).filter((c) => canPlot(c)), (c) => claimScore(galaxy, c));
    }
    if (heir === null) return null;
    const heirHouse = houseOf(galaxy, heir);
    let winner = heir;
    let legit = lawfulLegitimacy(galaxy, usedLaw === 'primogeniture' ? rulingHouse(galaxy, empire) : heirHouse);
    let kind: CourtEventKind = 'succession';
    let text = scenarioText(`Court Succession ${usedLaw}`, heir.name, empire.name);
    if (usedLaw !== 'acclamation') {
        const rivals = courtiers(empire).filter((c) => canPlot(c) && c !== heir && houseOf(galaxy, c) !== heirHouse);
        const rival = bestBy(rivals, (c) => claimScore(galaxy, c));
        const ch = Math.max(1, claimScore(galaxy, heir));
        if (rival !== null) {
            const cr = Math.max(1, claimScore(galaxy, rival));
            if (cr >= (ch * P.crisisPct(galaxy)) / 100) {
                // RND(19n): succession crisis — the two houses' claimants, weighted by their claims.
                const heirWins = galaxy.rnd.nextDouble() < ch / (ch + cr);
                winner = heirWins ? heir : rival;
                const loser = heirWins ? rival : heir;
                const wh = houseOf(galaxy, winner);
                crisisLoser(galaxy, loser, wh);
                legit = lawfulLegitimacy(galaxy, wh) - P.crisisPenalty(galaxy);
                kind = 'crisis';
                text = scenarioText('Court Crisis', heir.name, heirHouse?.name ?? '?', rival.name, houseOf(galaxy, rival)?.name ?? '?', winner.name);
                tellPlayer(galaxy, empire, 'Court Crisis', [heir.name, heirHouse?.name ?? '?', rival.name, houseOf(galaxy, rival)?.name ?? '?', winner.name], EmpireMessageType.GeneralWarning, winner);
            }
        }
    }
    const winnerHouse = houseOf(galaxy, winner);
    if (usedLaw === 'primogeniture' && winner === heir && heirIsYoung(galaxy, heir)) {
        const regent = pickRegent(galaxy, empire, heir);
        if (regent !== null) {
            const born = st.born.get(heir) ?? courtYear(galaxy);
            st.regencies.set(empire, { regent, heir, until: born + P.regencyYears(galaxy) });
            crown(galaxy, empire, regent, legit - P.regencyPenalty(galaxy), winnerHouse, 'regency', scenarioText('Court Regency', regent.name, heir.name));
            st.heirs.set(empire, heir);
            tellPlayer(galaxy, empire, 'Court Regency', [regent.name, heir.name], EmpireMessageType.GeneralNeutralEvent, regent);
            return { pool: [regent], changeType: changeType === 2 ? 2 : 0 };
        }
    }
    st.regencies.delete(empire);
    crown(galaxy, empire, winner, legit, winnerHouse, kind, text);
    const ct = usedLaw === 'election' ? 1 : changeType === 2 ? 2 : 0;
    return { pool: [winner], changeType: ct };
}

/** A regency ends when the heir comes of age: the heir takes the throne through the stock ChangeLeader. */
export function reviewRegency(galaxy: Galaxy, empire: Empire, year: number): void {
    const st = courtState(galaxy);
    const r = st.regencies.get(empire);
    if (r === undefined) return;
    if (empire.leader !== r.regent) {
        st.regencies.delete(empire);
        return;
    }
    if (year < r.until) return;
    st.regencies.delete(empire);
    if (!validHeir(galaxy, empire, r.heir)) return;
    const heirHouse = houseOf(galaxy, r.heir);
    crown(galaxy, empire, r.heir, lawfulLegitimacy(galaxy, heirHouse), heirHouse, 'regencyEnd', scenarioText('Court Regency End', r.heir.name, r.regent.name));
    tellPlayer(galaxy, empire, 'Court Regency End', [r.heir.name, r.regent.name], EmpireMessageType.GeneralGoodEvent, r.heir);
    // Stock ChangeLeader (Empire.6.cs 4927): the regent steps down (killed as a replaced leader), the heir is crowned.
    changeLeader(galaxy, empire, [r.heir], 0);
    empire.lastLeaderChangeDate = galaxyStarDate(galaxy);
}

/** Notices a leader that did not come through the court (a coup, a stock disruption, a 19d1 coup): a usurper. */
export function syncLeader(galaxy: Galaxy, empire: Empire, year: number): void {
    const st = courtState(galaxy);
    const leader = empire.leader;
    if (leader === null || st.lastLeader.get(empire) === leader) return;
    const h = ensureHouse(galaxy, leader);
    if (!st.legitimacy.has(leader)) {
        setLegitimacy(galaxy, leader, P.coupLegitimacy(galaxy));
        logCourt(galaxy, empire, 'usurpation', scenarioText('Court Usurpation', leader.name, h?.name ?? '?'));
    }
    if (h !== null) st.ruling.set(empire, h.id);
    st.reignStart.set(empire, year);
    st.lastLeader.set(empire, leader);
    st.regencies.delete(empire);
}

// ---------------------------------------------------------------------------------------------------------------
// Prestige (wars, wonders, reigns, lost colonies) and feuds
// ---------------------------------------------------------------------------------------------------------------

function onColonyOwnerChanged(galaxy: Galaxy, colony: Habitat, from: Empire | null, to: Empire | null): void {
    const st = courtState(galaxy);
    if (!st.seeded || from === null || from === to || !isPoliticalEmpire(galaxy, from)) return;
    const rh = rulingHouse(galaxy, from);
    if (rh !== null) {
        addPrestige(rh, -P.colonyLossPrestige(galaxy));
        logCourt(galaxy, from, 'prestige', scenarioText('Court Colony Lost', rh.name, colony.name));
    }
    if (to === null || !isPoliticalEmpire(galaxy, to)) return;
    const rel = from.diplomaticRelations.byEmpire(to);
    if (rel === null || rel.type !== DiplomaticRelationType.War) return;
    let t = st.wars.find((w) => (w.a === to && w.b === from) || (w.a === from && w.b === to));
    if (t === undefined) st.wars.push((t = { a: to, b: from, net: 0 }));
    t.net += t.a === to ? 1 : -1;
}

function onRelationChanged(galaxy: Galaxy, empire: Empire, other: Empire, from: number, to: number): void {
    const st = courtState(galaxy);
    if (!st.seeded || from !== DiplomaticRelationType.War || to === DiplomaticRelationType.War) return;
    const i = st.wars.findIndex((w) => (w.a === empire && w.b === other) || (w.a === other && w.b === empire));
    if (i < 0) return;
    const t = st.wars[i];
    st.wars.splice(i, 1);
    if (t.net === 0) return;
    const winner = t.net > 0 ? t.a : t.b;
    const loser = t.net > 0 ? t.b : t.a;
    const wh = rulingHouse(galaxy, winner);
    const lh = rulingHouse(galaxy, loser);
    if (wh !== null) {
        addPrestige(wh, P.warPrestige(galaxy));
        logCourt(galaxy, winner, 'prestige', scenarioText('Court War Won', wh.name, loser.name));
    }
    if (lh !== null) addPrestige(lh, -P.warPrestige(galaxy) / 2);
}

/** Yearly prestige: wonders completed since the last count, a long reign; seats lend their houses a little. */
export function yearlyPrestige(galaxy: Galaxy, empire: Empire, year: number): void {
    const st = courtState(galaxy);
    const ruling = rulingHouse(galaxy, empire);
    if (ruling === null) return;
    const seen = st.wondersSeen.get(empire) ?? [];
    const now: string[] = [];
    let fresh = 0;
    for (const w of empire.trackedWonders ?? []) {
        if (w.colony.empire !== empire) continue;
        const key = `${w.colony.name}|${w.facilityId}|${w.buildDate}`;
        now.push(key);
        if (!seen.includes(key) && w.buildDate > st.seededAt) fresh++;
    }
    st.wondersSeen.set(empire, now);
    if (fresh > 0) addPrestige(ruling, fresh * P.wonderPrestige(galaxy));
    const start = st.reignStart.get(empire);
    if (start !== undefined && year - start >= P.reignYears(galaxy)) addPrestige(ruling, P.reignPrestige(galaxy));
    for (const s of SEATS) {
        const c = seatHolder(galaxy, empire, s);
        const h = c !== null ? houseOf(galaxy, c) : null;
        if (h !== null && h !== ruling) addPrestige(h, 0.5);
    }
}

/** The feuding house pairs of an empire (a < b by id). */
export function rivalPairs(galaxy: Galaxy, empire: Empire): [House, House][] {
    const houses = empireHouses(galaxy, empire);
    const out: [House, House][] = [];
    for (const a of houses) for (const b of houses) if (a.id < b.id && areRivals(a, b)) out.push([a, b]);
    return out;
}

/** One feud roll per rival pair with members on both sides: an incident costs both houses loyalty (19d1). */
export function reviewFeuds(galaxy: Galaxy, empire: Empire, year: number): number {
    const st = courtState(galaxy);
    let incidents = 0;
    for (const [a, b] of rivalPairs(galaxy, empire)) {
        const ma = houseMembers(galaxy, a).filter((c) => !isLeader(c));
        const mb = houseMembers(galaxy, b).filter((c) => !isLeader(c));
        if (ma.length + mb.length === 0) continue;
        // RND(19n): feud incident
        if (!(galaxy.rnd.nextDouble() * 100 < P.feudPct(galaxy))) continue;
        feudIncident(galaxy, empire, a, b, year);
        incidents++;
    }
    return incidents;
}

/** A feud incident between `a` and `b` (no Rnd): members lose loyalty; the ledger's "feud" term follows for a year. */
export function feudIncident(galaxy: Galaxy, empire: Empire, a: House, b: House, year: number): void {
    const st = courtState(galaxy);
    st.feuds.push({ year, empire, a: a.id, b: b.id });
    if (st.feuds.length > 100) st.feuds.splice(0, st.feuds.length - 100);
    if (scenarioFlag(galaxy, POLITICS_FLAG)) {
        const amount = P.feudLoyalty(galaxy);
        for (const c of [...houseMembers(galaxy, a), ...houseMembers(galaxy, b)]) {
            if (isLeader(c) || !canPlot(c)) continue;
            const e = politicsEntry(galaxy, c);
            e.loyalty = Math.max(0, e.loyalty - amount);
            e.lastCauses.push({ cause: 'Feud', amount: -amount });
        }
    }
    logCourt(galaxy, empire, 'feud', scenarioText('Court Feud', a.name, b.name));
    tellPlayer(galaxy, empire, 'Court Feud', [a.name, b.name], EmpireMessageType.GeneralWarning);
}

function colonyGovernor(h: Habitat): Character | null {
    const chars = stellarObjectCharacters(h);
    if (chars === null) return null;
    for (const c of chars) if (c.active && c.role === CharacterRole.ColonyGovernor && c.empire === h.empire) return c;
    return null;
}

/** Ledger term "feud": −courtFeudApproval at a colony whose governor's house had a feud incident this or last year. Pure. */
export function feudTerm(galaxy: Galaxy, h: Habitat): number | null {
    const empire = h.empire;
    const st = peekCourtState(galaxy);
    if (empire === null || st === null || st.feuds.length === 0) return null;
    const gov = colonyGovernor(h);
    if (gov === null) return null;
    const hid = st.members.get(gov);
    if (hid === undefined) return null;
    const year = courtYear(galaxy);
    const hit = st.feuds.some((f) => f.empire === empire && year - f.year <= 1 && (f.a === hid || f.b === hid));
    return hit ? -P.feudApproval(galaxy) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Character factions
// ---------------------------------------------------------------------------------------------------------------

export function empireFaction(galaxy: Galaxy, empire: Empire): Faction | null {
    return peekCourtState(galaxy)?.factions.find((f) => f.empire === empire) ?? null;
}

/** Discontented courtiers: 19d1 loyalty < courtFactionLoyalty, no seat, not of the ruling house. Pure. */
export function discontented(galaxy: Galaxy, empire: Empire): Character[] {
    const pst = peekPoliticsState(galaxy);
    const st = peekCourtState(galaxy);
    if (pst === null || st === null) return [];
    const ruling = st.ruling.get(empire);
    return courtiers(empire).filter((c) => {
        if (!canPlot(c) || seatOf(galaxy, c) !== null) return false;
        const e = pst.chars.get(c);
        if (e === undefined || e.loyalty >= P.factionLoyalty(galaxy)) return false;
        const h = st.members.get(c);
        return h === undefined || h !== ruling;
    });
}

/** The demand a faction led by `leader` makes (first match): autonomy for its colony, a war, lower taxes, a seat. Pure. */
export function chooseDemand(galaxy: Galaxy, empire: Empire, leader: Character): FactionDemand {
    const colony = governedColony(leader);
    const pst = peekPoliticsState(galaxy);
    if (colony !== null && colony !== empire.capital && !(pst?.autonomy.has(colony) ?? false)) return { kind: 'autonomy', colony };
    if (isMilitary(leader)) {
        let target: Empire | null = null;
        let worst = 0;
        for (const other of galaxy.empires) {
            if (other === empire || !isPoliticalEmpire(galaxy, other)) continue;
            const rel = empire.diplomaticRelations.byEmpire(other);
            if (rel === null || rel.type === DiplomaticRelationType.NotMet || rel.type === DiplomaticRelationType.War) continue;
            const v = obtainEmpireEvaluationPeek(empire, other);
            if (v < worst) {
                worst = v;
                target = other;
            }
        }
        if (target !== null) return { kind: 'war', target };
    }
    const cols = empire.colonies.filter((h) => h.empire === empire);
    const avgTax = cols.length > 0 ? cols.reduce((s, h) => s + h.taxRate, 0) / cols.length : 0;
    if (avgTax > 0.2) return { kind: 'taxes' };
    let seat: SeatName = 'magistrate';
    let best = -Infinity;
    for (const s of SEATS) {
        if (!seatEligible(leader, s)) continue;
        const v = seatSkill(leader, s);
        if (v > best) {
            best = v;
            seat = s;
        }
    }
    return { kind: 'seat', seat };
}

/** Our IncidentEvaluation of `other` without creating an evaluation (0 when none). Pure. */
function obtainEmpireEvaluationPeek(empire: Empire, other: Empire): number {
    const list = empire.empireEvaluations as { empire: Empire | null; incidentEvaluationRaw: number }[] | null;
    const ev = list?.find((x) => x.empire === other);
    return ev?.incidentEvaluationRaw ?? 0;
}

function demandText(galaxy: Galaxy, d: FactionDemand): string {
    switch (d.kind) {
        case 'taxes':
            return scenarioText('Court Demand taxes');
        case 'war':
            return scenarioText('Court Demand war', d.target.name);
        case 'autonomy':
            return scenarioText('Court Demand autonomy', d.colony.name);
        case 'seat':
            return scenarioText('Court Demand seat', seatLabel(d.seat));
    }
}

/** Forms a faction of `members` (no Rnd) and raises the ultimatum (an AI answers at once). */
export function formFaction(galaxy: Galaxy, empire: Empire, members: Character[]): Faction {
    const st = courtState(galaxy);
    const pst = peekPoliticsState(galaxy);
    const leader = bestBy(members, (c) => pst?.chars.get(c)?.ambition ?? 0) ?? members[0];
    const f: Faction = { id: st.nextFactionId++, empire, members: [...members], leader, demand: chooseDemand(galaxy, empire, leader), formed: courtYear(galaxy), state: 'pending', until: 0 };
    st.factions.push(f);
    const house = houseOf(galaxy, leader)?.name ?? '?';
    logCourt(galaxy, empire, 'faction', scenarioText('Court Faction', leader.name, house, members.length, demandText(galaxy, f.demand)));
    raiseScenarioDecision(galaxy, empire, {
        kind: FACTION_DECISION,
        title: scenarioText('Court Ultimatum Title'),
        text: scenarioText('Court Ultimatum', leader.name, house, members.length, demandText(galaxy, f.demand)),
        options: [
            { id: 'concede', label: scenarioText('Court Option Concede') },
            { id: 'refuse', label: scenarioText('Court Option Refuse') },
        ],
        defaultOption: 'refuse',
        expiresDays: 180,
        context: { factionId: f.id },
    });
    return f;
}

/** Why a demand cannot be applied now (null: it can). Pure. */
export function demandBlocked(galaxy: Galaxy, f: Faction): string | null {
    const empire = f.empire;
    switch (f.demand.kind) {
        case 'taxes':
            return empire.policy === null ? 'No policy' : null;
        case 'war': {
            const t = f.demand.target;
            const rel = empire.diplomaticRelations.byEmpire(t);
            return !isPoliticalEmpire(galaxy, t) || rel === null || rel.type === DiplomaticRelationType.War ? 'No such target' : null;
        }
        case 'autonomy':
            return f.demand.colony.empire !== empire || !scenarioFlag(galaxy, POLITICS_FLAG) ? 'Not our colony' : null;
        case 'seat':
            return appointBlocked(galaxy, empire, f.demand.seat, f.leader);
    }
}

/** Applies a conceded demand through the existing functions (policy + ReviewTaxes, DeclareWar, 19d1 autonomy, the seat). */
export function applyDemand(galaxy: Galaxy, f: Faction): boolean {
    if (demandBlocked(galaxy, f) !== null) return false;
    const empire = f.empire;
    switch (f.demand.kind) {
        case 'taxes': {
            const p = empire.policy!;
            p.colonyTaxRateSmallColony = Math.max(1, p.colonyTaxRateSmallColony - 1);
            p.colonyTaxRateMediumColony = Math.max(1, p.colonyTaxRateMediumColony - 1);
            p.colonyTaxRateLargeColony = Math.max(1, p.colonyTaxRateLargeColony - 1);
            for (const h of empire.colonies) if (h.empire === empire) h.taxRate = Math.max(0, h.taxRate - 0.05);
            reviewTaxes(galaxy, empire);
            return true;
        }
        case 'war':
            declareWar(galaxy, empire, f.demand.target);
            return true;
        case 'autonomy':
            return grantAutonomy(galaxy, empire, f.demand.colony).ok;
        case 'seat':
            return appointToSeat(galaxy, empire, f.demand.seat, f.leader).ok;
    }
}

function dissolveFaction(galaxy: Galaxy, f: Faction): void {
    const st = courtState(galaxy);
    const i = st.factions.indexOf(f);
    if (i >= 0) st.factions.splice(i, 1);
}

/** The ultimatum's answer: concede applies the demand (+loyalty, −legitimacy); refuse → the faction backs a plot. */
export function resolveFaction(galaxy: Galaxy, f: Faction, concede: boolean): void {
    const empire = f.empire;
    const politics = scenarioFlag(galaxy, POLITICS_FLAG);
    if (concede) {
        applyDemand(galaxy, f);
        if (politics) for (const c of f.members) if (c.active && c.empire === empire) {
            const e = politicsEntry(galaxy, c);
            e.loyalty = Math.min(100, e.loyalty + P.concedeLoyalty(galaxy));
        }
        const leader = empire.leader;
        if (leader !== null) setLegitimacy(galaxy, leader, leaderLegitimacy(galaxy, empire) - P.concedeLegitimacy(galaxy));
        dissolveFaction(galaxy, f);
        logCourt(galaxy, empire, 'concede', scenarioText('Court Conceded', f.leader.name, demandText(galaxy, f.demand)));
        return;
    }
    f.state = 'backing';
    f.until = courtYear(galaxy) + P.factionYears(galaxy);
    if (politics) for (const c of f.members) if (c.active && c.empire === empire) {
        const e = politicsEntry(galaxy, c);
        e.loyalty = Math.max(0, e.loyalty - 5);
        e.lastCauses.push({ cause: 'Faction', amount: -5 });
    }
    logCourt(galaxy, empire, 'refuse', scenarioText('Court Refused', f.leader.name));
    tellPlayer(galaxy, empire, 'Court Refused', [f.leader.name], EmpireMessageType.GeneralWarning, f.leader);
}

/** AI rule: the leader's traits decide (pacifist / measured / weak / lazy rulers and a weak legitimacy concede). Pure. */
export function aiFactionChoice(galaxy: Galaxy, empire: Empire, f: Faction): 'concede' | 'refuse' {
    const leader = empire.leader;
    const t = leader?.traits ?? [];
    let score = 0;
    for (const x of [CharacterTraitType.Pacifist, CharacterTraitType.Measured, CharacterTraitType.Weak, CharacterTraitType.Lazy]) if (t.includes(x)) score++;
    for (const x of [CharacterTraitType.Paranoid, CharacterTraitType.Courageous, CharacterTraitType.RecklessAttacker, CharacterTraitType.Uninhibited]) if (t.includes(x)) score--;
    if (f.demand.kind === 'war') {
        if (t.includes(CharacterTraitType.Pacifist)) score -= 2;
        if (t.includes(CharacterTraitType.Expansionist) || t.includes(CharacterTraitType.RecklessAttacker)) score += 2;
    }
    if (leaderLegitimacy(galaxy, empire) < 40) score++;
    return score > 0 && demandBlocked(galaxy, f) === null ? 'concede' : 'refuse';
}

registerScenarioDecision({
    id: FACTION_DECISION,
    kind: FACTION_DECISION,
    flag: COURT_FLAG,
    resolve: (galaxy, d: ScenarioDecision, optionId) => {
        const f = peekCourtState(galaxy)?.factions.find((x) => x.id === d.context.factionId);
        if (f === undefined || f.state !== 'pending') return;
        resolveFaction(galaxy, f, optionId === 'concede');
    },
    aiChoose: (galaxy, d) => {
        const f = peekCourtState(galaxy)?.factions.find((x) => x.id === d.context.factionId);
        return f === undefined ? 'refuse' : aiFactionChoice(galaxy, d.empire, f);
    },
});

/** Yearly: prune factions; with none, discontented courtiers may form one (one roll × the legitimacy factor). */
export function reviewFactions(galaxy: Galaxy, empire: Empire, year: number): Faction | null {
    const st = courtState(galaxy);
    for (const f of st.factions.filter((x) => x.empire === empire)) {
        f.members = f.members.filter((c) => c.active && c.empire === empire);
        if (f.members.length < P.factionMin(galaxy) || !f.members.includes(f.leader) || (f.state === 'backing' && year >= f.until)) dissolveFaction(galaxy, f);
    }
    if (empireFaction(galaxy, empire) !== null || !scenarioFlag(galaxy, POLITICS_FLAG)) return null;
    const cands = discontented(galaxy, empire);
    if (cands.length < P.factionMin(galaxy)) return null;
    const chance = Math.min(1, (P.factionPct(galaxy) / 100) * legitimacyFactor(galaxy, empire));
    // RND(19n): faction formation
    if (!(galaxy.rnd.nextDouble() < chance)) return null;
    return formFaction(galaxy, empire, cands);
}

// ---------------------------------------------------------------------------------------------------------------
// 19d1 / 19m hook implementations (pure; 1 / 0 with the flag off)
// ---------------------------------------------------------------------------------------------------------------

/** A plot candidate's weight: ruling house × courtRulingPlotPct%, a house feuding with the ruling one × courtRivalPlotPct%, a backing faction's members × (1 + members / 4). */
export function plotScoreFactor(galaxy: Galaxy, empire: Empire, c: Character): number {
    if (!courtOn(galaxy)) return 1;
    const st = peekCourtState(galaxy);
    if (st === null) return 1;
    let f = 1;
    const ruling = rulingHouse(galaxy, empire);
    const h = houseOf(galaxy, c);
    if (h !== null && ruling !== null) {
        if (h === ruling) f *= P.rulingPlotPct(galaxy) / 100;
        else if (areRivals(h, ruling)) f *= P.rivalPlotPct(galaxy) / 100;
    }
    const fac = st.factions.find((x) => x.empire === empire && x.state === 'backing' && x.members.includes(c));
    if (fac !== undefined) f *= 1 + fac.members.length / 4;
    return f;
}

/** The plot roll's factor: the legitimacy factor × courtFactionPlotPct% while a refused faction backs a plot. */
export function plotChanceFactor(galaxy: Galaxy, empire: Empire): number {
    if (!courtOn(galaxy)) return 1;
    let f = legitimacyFactor(galaxy, empire);
    if (peekCourtState(galaxy)?.factions.some((x) => x.empire === empire && x.state === 'backing') === true) f *= P.factionPlotPct(galaxy) / 100;
    return f;
}

politicsHooks.plotScoreFactor = (galaxy, empire, c) => plotScoreFactor(galaxy, empire, c);
politicsHooks.plotChanceFactor = (galaxy, empire) => plotChanceFactor(galaxy, empire);
securitySlots.strengthBonus = (galaxy, empire) => (courtOn(galaxy) ? spymasterStrengthBonus(galaxy, empire) : 0);

// ---------------------------------------------------------------------------------------------------------------
// Seeding and the yearly handler
// ---------------------------------------------------------------------------------------------------------------

/** Game start: houses for every normal empire, members, the founding leader's legitimacy, a first rivalry. No Rnd. */
export function seedCourt(galaxy: Galaxy): void {
    const st = courtState(galaxy);
    if (st.seeded) return;
    st.seeded = true;
    st.seededAt = galaxyStarDate(galaxy);
    st.born.clear();
    const year = courtYear(galaxy);
    for (const empire of galaxy.empires) {
        if (!isPoliticalEmpire(galaxy, empire)) continue;
        ensureEmpireHouses(galaxy, empire);
        for (const c of getEmpireCharacters(empire)) if (c.active) ensureHouse(galaxy, c);
        const leader = empire.leader;
        if (leader !== null) {
            setLegitimacy(galaxy, leader, P.startLegitimacy(galaxy));
            st.lastLeader.set(empire, leader);
        }
        st.reignStart.set(empire, year);
        seedRivalry(galaxy, empire);
    }
}

/** The ruling house's first rival: the other house with the most members (lowest id on a tie). */
function seedRivalry(galaxy: Galaxy, empire: Empire): void {
    const ruling = rulingHouse(galaxy, empire);
    if (ruling === null) return;
    let best: House | null = null;
    let bestN = -1;
    for (const h of empireHouses(galaxy, empire)) {
        if (h === ruling) continue;
        const n = houseMembers(galaxy, h).length;
        if (n > bestN) {
            best = h;
            bestN = n;
        }
    }
    if (best !== null) makeRivals(ruling, best);
}

function prune(galaxy: Galaxy): void {
    const st = courtState(galaxy);
    for (const c of [...st.members.keys()]) if (!c.active) st.members.delete(c);
    for (const c of [...st.born.keys()]) if (!c.active) st.born.delete(c);
    for (const c of [...st.legitimacy.keys()]) if (!c.active && c.empire?.leader !== c) st.legitimacy.delete(c);
    for (const [e, c] of [...st.heirs]) if (!validHeir(galaxy, e, c)) st.heirs.delete(e);
    for (const [e, seats] of st.seats) for (const s of SEATS) {
        const c = seats[s];
        if (c !== null && (!c.active || c.empire !== e || isLeader(c))) seats[s] = null;
    }
    for (const [e] of [...st.lastLeader]) if (!isPoliticalEmpire(galaxy, e)) {
        st.lastLeader.delete(e);
        st.seats.delete(e);
        st.heirs.delete(e);
        st.regencies.delete(e);
    }
    st.wars = st.wars.filter((w) => w.a.active && w.b.active);
}

/** The yearly handler (order 5: before 19d1 politics rolls its plots with these weights). */
export function courtYearly(galaxy: Galaxy, year: number): void {
    const st = courtState(galaxy);
    if (!st.seeded) seedCourt(galaxy);
    prune(galaxy);
    const empires = galaxy.empires.filter((e) => isPoliticalEmpire(galaxy, e));
    for (const empire of empires) {
        if (!isPoliticalEmpire(galaxy, empire)) continue;
        ensureEmpireHouses(galaxy, empire);
        for (const c of getEmpireCharacters(empire)) if (c.active) ensureHouse(galaxy, c);
        syncLeader(galaxy, empire, year);
        reviewRegency(galaxy, empire, year);
        yearlyPrestige(galaxy, empire, year);
        const leader = empire.leader;
        if (leader !== null) {
            const { delta } = yearlyLegitimacyDelta(galaxy, empire, year);
            setLegitimacy(galaxy, leader, leaderLegitimacy(galaxy, empire) + delta);
        }
        const purge = lastPurgeDate(galaxy, empire);
        if (purge !== null) st.purgeSeen.set(empire, Math.max(purge, st.purgeSeen.get(empire) ?? 0));
        if (empire !== galaxy.playerEmpire) aiAppointCouncil(galaxy, empire);
        applyChancellor(galaxy, empire);
        seatlessAmbition(galaxy, empire);
        designateHeir(galaxy, empire);
        reviewFeuds(galaxy, empire, year);
        reviewFactions(galaxy, empire, year);
    }
}

registerScenarioYearly({ id: 'court.yearly', flag: COURT_FLAG, order: 5, run: courtYearly });
registerScenarioGameStart({ id: 'court.start', flag: COURT_FLAG, run: (galaxy) => seedCourt(galaxy) });
registerScenarioEvent({
    id: 'court.characters',
    flag: COURT_FLAG,
    event: 'characterCreated',
    run: (galaxy, p) => {
        const st = courtState(galaxy);
        if (!st.seeded) return;
        const c = p.character as Character;
        if (!isPoliticalEmpire(galaxy, p.empire) || c.empire !== p.empire) return;
        st.born.set(c, courtYear(galaxy));
        ensureHouse(galaxy, c);
    },
});
registerScenarioEvent({ id: 'court.colonies', flag: COURT_FLAG, event: 'colonyOwnerChanged', run: (galaxy, p) => onColonyOwnerChanged(galaxy, p.colony, p.from, p.to) });
registerScenarioEvent({ id: 'court.wars', flag: COURT_FLAG, event: 'diplomaticRelationChanged', run: (galaxy, p) => onRelationChanged(galaxy, p.empire, p.other, p.from, p.to) });
registerScenarioSuccession({ id: 'court.succession', flag: COURT_FLAG, run: (galaxy, empire, _pool, changeType) => courtSuccession(galaxy, empire, changeType) });
registerStabilityTerm({ id: 'court.feud', flag: COURT_FLAG, order: 60, cause: 'feud', label: 'House feud', run: (g, h) => feudTerm(g, h) });
registerStabilityTerm({ id: 'court.magistrate', flag: COURT_FLAG, order: 61, cause: 'magistrate', label: 'Magistrate', run: (g, h) => magistrateTerm(g, h) });
registerScenarioQuery({
    id: 'court.steward',
    flag: COURT_FLAG,
    query: 'colonyTaxRevenue',
    run: (galaxy, value, { empire }) => {
        const f = stewardTaxFactor(galaxy, empire);
        return f === 1 ? value : value * f;
    },
});
registerScenarioQuery({
    id: 'court.marshal',
    flag: COURT_FLAG,
    query: 'captainBonuses',
    run: (galaxy, value, { builtObject, empire }) => {
        if (builtObject.shipGroup === null || builtObject.shipGroup === undefined) return value;
        const pts = marshalBonusPoints(galaxy, empire);
        if (pts <= 0) return value;
        return { ...value, repair: Math.min(200, value.repair + pts), damageControl: Math.min(200, value.damageControl + pts) };
    },
});

/** The court chronicle of an empire (UI). */
export function courtEvents(galaxy: Galaxy, empire: Empire): CourtEvent[] {
    return (peekCourtState(galaxy)?.events ?? []).filter((e) => e.empire === empire);
}

