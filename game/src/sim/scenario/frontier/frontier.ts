// 19g-5 Frontier autonomy (tasks/19-mod-layer-scenarios.md §19g item 5). Not a port: a scenario package on the mod layer
// (tasks/MODLAYER-DESIGN.md) on top of 19n court & dynasties (houses), 19m internal security (the stability ledger, leads,
// purges, martial law) and 19d1 internal politics (loyalty, honours, grantAutonomy, the targeted empire split).
//   1. Drift — every non-capital colony of a normal empire has an autonomy value (0–100) moved yearly by named terms:
//      + the hyperjump travel time to the capital (distance / the empire's typical warp speed + its hyperjump
//      countdown: BuiltObject.2.cs 3027 HyperTo `HyperjumpInitiate * 1000` ms, then 3132 `num8 = CurrentSpeed *
//      timePassed` per second at WarpSpeed), + no warships in the system over the last year (sampled every 30 days),
//      + a race unlike the empire's dominant race, + low approval; − a governor of the ruling house (19n), − a nearby
//      fleet, − high approval; − a yearly decay (so the value settles at drift / decay). It enters the 19m stability
//      ledger as a term with cause "frontier".
//   2. Sectors — autonomous colonies (≥ frontierSectorThreshold) in one galaxy sector (Galaxy.SectorSize squares, as
//      ResolveSectorDescription labels them) form a frontier sector under a Sector Governor: the ColonyGovernor of the
//      most autonomous member (one is generated there when none governs). Powers: a local tax rate override (the
//      `colonyTaxRate` query in Habitat.cs 6083 RecalculateAnnualTaxRevenue), a militia bought from a sector budget
//      (a share of the sector's tax; the stock Empire.6.cs 1991 PurchaseNewBuiltObject path; the ships patrol the
//      sector seat), trade compacts with neighbours / independents (a local standing: no reputation ledger exists), and
//      the right to refuse an unpopular order (a roll from a package Random — never galaxy.rnd — and a message).
//   3. Rule — per sector: loose (smuggling / herd tolerance, lighter tax, +governor loyalty, −drift) or tight (clean,
//      heavier tax, +drift, an unrest term); rim sectors get the herd-tolerance switch (forgives part of the 19g-7
//      herd-loss unrest term).
//   4. Breakaway — a sector past frontierBreakawayThreshold whose governor's loyalty is below
//      frontierBreakawayLoyalty warns the capital for frontierWarningYears (messages + a 19m "sectorUnrest" lead), then
//      secedes under its governor through initiateEmpireSplitAt with every sector colony. A fleet near the seat or 19m
//      martial law holds it; honours (19d1), a purge (19m / 19d1) or a concession (loose rule + grantAutonomy) calm it.
//   5. AI — by the dominant race's caution vs aggression: cautious rulers garrison and loosen (and concede at the last
//      warning), aggressive ones tighten and purge; neither is safe.
//
// Gate: every handler is registered with flag `frontierAutonomy`; with it off nothing here runs and no state exists.
// Rnd: galaxy.rnd is drawn only in the yearly handler (the trade-compact roll, a generated governor, the ported
// purchase / split / mission code it calls); the periodic fleet sample, the terms and the queries never draw; the
// refusal roll uses a package Random seeded from the galaxy seed, the sector id and the order count.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import type { BuiltObject } from '../../builtObject';
import { type Character, CharacterRole, generateNewCharacter, stellarObjectCharacters } from '../../characters';
import { initiateEmpireSplitAt, resolveSectorDescription } from '../../empireEvents';
import { empireApprovalRating, recalculateEmpirePopulation } from '../../taxes';
import { recalculateAnnualTaxRevenue } from '../../forceStructure';
import { empireGovernmentAttributes } from '../../empire';
import { resolveStandardRaceBias } from '../../raceBias';
import { DiplomaticRelationType, obtainEmpireEvaluation } from '../../diplomacy';
import { leaveEmpire } from '../../events';
import { empireShipGroups, type ShipGroup } from '../../fleets/shipGroup';
import { shipGroupAssignMission } from '../../fleets/shipGroupTasks';
import { assignMission } from '../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType } from '../../missions/mission';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { dlFindNewestCanBuild, purchaseNewBuiltObject, queueOf } from '../../construction/empireConstruction';
import { EmpireMessageType } from '../../messages';
import { REAL_SECONDS_IN_GALACTIC_YEAR, YEAR_LENGTH } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { Random } from '../../random';
import { radiusFraction, registerScenarioPeriodic, registerScenarioQuery, registerScenarioYearly } from '../hooks';
import { scenarioFlag, scenarioParam, scenarioState } from '../state';
import { scenarioMessage, scenarioNews, scenarioText } from '../messages';
import { registerStabilityTerm } from '../stability';
import { POLITICS_FLAG, governedColony, initialLoyalty, isPoliticalEmpire, peekPoliticsState, politicsEntry } from '../emergent/politics';
import { grantAutonomy, runPoliticsAction } from '../emergent/politicsActions';
import { COURT_FLAG, houseOf, rulingHouse } from '../court/court';
import { registerHiddenThing, retireHiddenTarget, securityOn, setLeadLevel, findHiddenThing, colonyUnderMartialLaw, type Lead } from '../security/registry';
import { onLeadChanged, runSecurityAction } from '../security/security';
import { rimFaunaUnrest } from '../rimFauna/common';

export const FRONTIER_FLAG = 'frontierAutonomy';
const PACKAGE = '19g5.frontier';

// ---------------------------------------------------------------------------------------------------------------
// Params (scenarios/frontier-autonomy/scenario.json)
// ---------------------------------------------------------------------------------------------------------------

const p = (name: string, fallback: number) => (g: Galaxy): number => scenarioParam(g, name, fallback);
export const FRONTIER_PARAMS = {
    travelDaysRef: p('frontierTravelDaysRef', 20),
    travelDrift: p('frontierTravelDrift', 2),
    travelCap: p('frontierTravelCap', 3),
    warpSpeed: p('frontierWarpSpeed', 2000),
    noFleetDrift: p('frontierNoFleetDrift', 3),
    fleetDrift: p('frontierFleetDrift', 3),
    fleetRangePct: p('frontierFleetRangePct', 50),
    raceDrift: p('frontierRaceDrift', 3),
    approvalDrift: p('frontierApprovalDrift', 3),
    rulingGovernorDrift: p('frontierRulingGovernorDrift', 4),
    looseDrift: p('frontierLooseDrift', 2),
    tightDrift: p('frontierTightDrift', 2),
    dealDrift: p('frontierDealDrift', 1),
    decayPct: p('frontierDecayPct', 10),
    approvalPct: p('frontierApprovalPct', 10),
    sectorThreshold: p('frontierSectorThreshold', 40),
    sectorHysteresis: p('frontierSectorHysteresis', 10),
    sectorMinColonies: p('frontierSectorMinColonies', 2),
    governorTaxCutPct: p('frontierGovernorTaxCutPct', 50),
    looseTaxPct: p('frontierLooseTaxPct', 80),
    tightTaxPct: p('frontierTightTaxPct', 110),
    tightUnrest: p('frontierTightUnrest', 3),
    looseLoyalty: p('frontierLooseLoyalty', 3),
    autonomyLoyalty: p('frontierAutonomyLoyalty', 1),
    militiaPct: p('frontierMilitiaPct', 20),
    militiaMax: p('frontierMilitiaMax', 3),
    dealPct: p('frontierDealPct', 25),
    dealRange: p('frontierDealRange', 2),
    dealStanding: p('frontierDealStanding', 10),
    dealIncomePct: p('frontierDealIncomePct', 5),
    dealAttitude: p('frontierDealAttitude', 2),
    refusePct: p('frontierRefusePct', 50),
    rimRadius: p('frontierRimRadius', 0.7),
    herdTolerancePct: p('frontierHerdTolerancePct', 50),
    breakawayThreshold: p('frontierBreakawayThreshold', 65),
    breakawayLoyalty: p('frontierBreakawayLoyalty', 35),
    warningYears: p('frontierWarningYears', 2),
    concedeLoyalty: p('frontierConcedeLoyalty', 10),
};
const P = FRONTIER_PARAMS;

/** Fleet-presence samples kept per colony (one per 30 days: a year). */
const PRESENCE_SAMPLES = 12;
const PRESENCE_PERIOD_DAYS = 30;
/** Years between two answers of the same kind by the AI to one sector (a concession, a purge). */
const AI_RESPONSE_YEARS = 5;

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------

export type SectorRule = 'loose' | 'normal' | 'tight';
const RULE_RANK: Record<SectorRule, number> = { loose: 0, normal: 1, tight: 2 };

export interface DriftCause {
    cause: string;
    amount: number;
}

export interface FrontierColony {
    /** 0–100. */
    autonomy: number;
    /** 1 / 0 per 30-day sample: an own warship in the colony's system (last PRESENCE_SAMPLES). */
    presence: number[];
    /** The causes of the last yearly change (UI / tests). */
    causes: DriftCause[];
}

/** A trade compact partner: a foreign empire, or an independent colony. */
export interface FrontierDeal {
    partner: Empire | null;
    colony: Habitat | null;
    standing: number;
    year: number;
}

export interface FrontierSector {
    id: number;
    empire: Empire;
    /** Galaxy sector (Galaxy.SectorSize squares) and its label (ResolveSectorDescription, e.g. "C4"). */
    sx: number;
    sy: number;
    name: string;
    colonies: Habitat[];
    governor: Character | null;
    /** The governor's colony (the sector capital). */
    seat: Habitat | null;
    rule: SectorRule;
    /** Rim sectors only: part of the herd-loss unrest is forgiven. */
    herdTolerance: boolean;
    /** The governor's local tax rate (null: none). */
    taxOverride: number | null;
    /** The capital revoked the local rate (and the governor obeyed). */
    taxRevoked: boolean;
    budget: number;
    militia: BuiltObject[];
    deals: FrontierDeal[];
    /** Game year of the last compact (-1000: never). */
    lastDealYear: number;
    /** Years in a row past the breakaway line (warnings are years 1..frontierWarningYears). */
    unrestYears: number;
    /** Game year of the last concession (-1000: never); the cautious AI concedes once per AI_RESPONSE_YEARS. */
    lastConcedeYear: number;
    /** Game year of the last purge of its governor (-1000: never); the aggressive AI purges once per AI_RESPONSE_YEARS. */
    lastPurgeYear: number;
    formed: number;
    /** Orders received (seeds the refusal roll). */
    orders: number;
    refusals: number;
}

export type FrontierEventKind = 'formed' | 'dissolved' | 'governor' | 'refused' | 'deal' | 'militia' | 'warning' | 'deterred' | 'concede' | 'rule' | 'breakaway' | 'purge' | 'garrison';

export interface FrontierEvent {
    year: number;
    empire: Empire;
    sector: number;
    kind: FrontierEventKind;
    text: string;
    other: Empire | null;
}

export interface FrontierState {
    colonies: Map<Habitat, FrontierColony>;
    sectors: FrontierSector[];
    nextSectorId: number;
    /** Oldest first (last 200). */
    events: FrontierEvent[];
}

export function frontierState(galaxy: Galaxy): FrontierState {
    return scenarioState<FrontierState>(galaxy, 'frontier', () => ({ colonies: new Map(), sectors: [], nextSectorId: 1, events: [] }));
}

/** The state if it exists (pure readers / UI: never creates it). */
export function peekFrontierState(galaxy: Galaxy): FrontierState | null {
    const s = galaxy.scenario;
    if (s === null || !('frontier' in s.state)) return null;
    return s.state.frontier as FrontierState;
}

export function frontierOn(galaxy: Galaxy): boolean {
    return scenarioFlag(galaxy, FRONTIER_FLAG);
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const frontierYear = (galaxy: Galaxy): number => Math.floor(galaxyStarDate(galaxy) / YEAR_LENGTH);

function logEvent(galaxy: Galaxy, s: FrontierSector | null, empire: Empire, kind: FrontierEventKind, text: string, other: Empire | null = null): void {
    const st = frontierState(galaxy);
    st.events.push({ year: frontierYear(galaxy), empire, sector: s?.id ?? 0, kind, text, other });
    if (st.events.length > 200) st.events.splice(0, st.events.length - 200);
}

function tell(galaxy: Galaxy, empire: Empire, titleTag: string, text: string, type: EmpireMessageType, subject: unknown): void {
    if (empire !== galaxy.playerEmpire) return;
    scenarioMessage(galaxy, empire, scenarioText(titleTag), text, { type, subject });
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Drift (pure model)
// ---------------------------------------------------------------------------------------------------------------

/**
 * The empire's typical hyperdrive: the mean WarpSpeed and HyperjumpInitiate of its finished state ships with a
 * hyperdrive (frontierWarpSpeed / 10 s with none). Pure.
 */
export function empireTypicalWarp(galaxy: Galaxy, empire: Empire): { speed: number; initiate: number } {
    let n = 0;
    let speed = 0;
    let initiate = 0;
    for (const bo of empire.builtObjects) {
        if (bo === null || bo.hasBeenDestroyed || bo.builtAt !== null || bo.warpSpeed <= 0) continue;
        n++;
        speed += bo.warpSpeed;
        initiate += bo.hyperjumpInitiate;
    }
    return n === 0 ? { speed: P.warpSpeed(galaxy), initiate: 10 } : { speed: speed / n, initiate: initiate / n };
}

/**
 * Hyperjump travel time from `colony` to the empire's capital in game days: the jump countdown (BuiltObject.2.cs
 * 3027 HyperTo: HyperjumpInitiate × 1000 ms, mean of its ±1000 roll) plus distance / WarpSpeed seconds (3132: each
 * step moves CurrentSpeed × timePassed at WarpSpeed); a game day is RealSecondsInGalacticYear / 360 seconds. Pure.
 */
export function travelDaysToCapital(galaxy: Galaxy, empire: Empire, colony: Habitat): number {
    const capital = empire.capital;
    if (capital === null || capital === colony) return 0;
    const { speed, initiate } = empireTypicalWarp(galaxy, empire);
    const dist = galaxy.calculateDistance(colony.xpos, colony.ypos, capital.xpos, capital.ypos);
    const seconds = initiate + dist / Math.max(1, speed);
    return seconds / (REAL_SECONDS_IN_GALACTIC_YEAR / 360);
}

/** Share of the last year's samples with an own warship in the colony's system (0 with no sample). Pure. */
export function fleetPresence(entry: FrontierColony | undefined): number {
    if (entry === undefined || entry.presence.length === 0) return 0;
    let s = 0;
    for (const x of entry.presence) s += x;
    return s / entry.presence.length;
}

/** The empire's sector militia ships (they answer to their governors: no presence, no deterrence). Pure. */
function militiaOf(galaxy: Galaxy, empire: Empire): Set<BuiltObject> {
    const out = new Set<BuiltObject>();
    const st = peekFrontierState(galaxy);
    if (st !== null) for (const s of st.sectors) if (s.empire === empire) for (const b of s.militia) out.add(b);
    return out;
}

/** An own finished warship (in a fleet or not, not a sector militia) within frontierFleetRangePct of a galaxy sector of `h`. Pure. */
export function nearbyFleet(galaxy: Galaxy, empire: Empire, h: Habitat): BuiltObject | null {
    const range = (galaxy.sectorSize * P.fleetRangePct(galaxy)) / 100;
    if (range <= 0) return null;
    const militia = militiaOf(galaxy, empire);
    for (const bo of empire.builtObjects) {
        if (bo === null || bo.hasBeenDestroyed || bo.builtAt !== null || bo.role !== BuiltObjectRole.Military || militia.has(bo)) continue;
        if (galaxy.calculateDistance(bo.xpos, bo.ypos, h.xpos, h.ypos) <= range) return bo;
    }
    return null;
}

/** The ColonyGovernor at `h` (its own empire's), or null. */
export function colonyGovernorOf(h: Habitat): Character | null {
    const chars = stellarObjectCharacters(h);
    if (chars === null) return null;
    for (const c of chars) if (c.active && c.role === CharacterRole.ColonyGovernor && c.empire === h.empire) return c;
    return null;
}

/** The frontier sector `h` belongs to (null: none). Pure. */
export function sectorOfColony(galaxy: Galaxy, h: Habitat): FrontierSector | null {
    const st = peekFrontierState(galaxy);
    if (st === null) return null;
    for (const s of st.sectors) if (s.empire === h.empire && s.colonies.includes(h)) return s;
    return null;
}

/** The yearly autonomy change of `h` and its named causes (pure; the decay included). */
export function autonomyDrift(galaxy: Galaxy, h: Habitat, entry: FrontierColony | undefined): { delta: number; causes: DriftCause[] } {
    const causes: DriftCause[] = [];
    const add = (cause: string, amount: number): void => {
        if (amount !== 0) causes.push({ cause, amount });
    };
    const empire = h.empire;
    if (empire === null || empire.capital === h) return { delta: -(entry?.autonomy ?? 0), causes: [{ cause: 'Capital', amount: -(entry?.autonomy ?? 0) }] };
    const days = travelDaysToCapital(galaxy, empire, h);
    add('Travel time', P.travelDrift(galaxy) * Math.min(P.travelCap(galaxy), days / Math.max(1, P.travelDaysRef(galaxy))));
    add('No warships', P.noFleetDrift(galaxy) * (1 - fleetPresence(entry)));
    if (nearbyFleet(galaxy, empire, h) !== null) add('Fleet nearby', -P.fleetDrift(galaxy));
    const race = h.population !== null ? h.population.dominantRace : null;
    if (race !== null && empire.dominantRace !== null && race !== empire.dominantRace) {
        const r = P.raceDrift(galaxy);
        add('Race', clamp(r - resolveStandardRaceBias(race, empire.dominantRace) / 50, 0, 2 * r));
    }
    const a = P.approvalDrift(galaxy);
    add('Approval', -clamp(empireApprovalRating(galaxy, h) / 10, -a, a));
    const gov = colonyGovernorOf(h);
    if (gov !== null && scenarioFlag(galaxy, COURT_FLAG)) {
        const ruling = rulingHouse(galaxy, empire);
        if (ruling !== null && houseOf(galaxy, gov) === ruling) add('Ruling-house governor', -P.rulingGovernorDrift(galaxy));
    }
    const sector = sectorOfColony(galaxy, h);
    if (sector !== null) {
        if (sector.rule === 'loose') add('Loose rule', -P.looseDrift(galaxy));
        else if (sector.rule === 'tight') add('Tight rule', P.tightDrift(galaxy));
        if (frontierYear(galaxy) - sector.lastDealYear <= 1) add('Trade compacts', P.dealDrift(galaxy));
    }
    add('Decay', -((entry?.autonomy ?? 0) * P.decayPct(galaxy)) / 100);
    let delta = 0;
    for (const c of causes) delta += c.amount;
    return { delta, causes };
}

/** Ledger term "frontier": −autonomy × frontierApprovalPct%. Pure. */
export function frontierTerm(galaxy: Galaxy, h: Habitat): number | null {
    const a = peekFrontierState(galaxy)?.colonies.get(h)?.autonomy ?? 0;
    if (a <= 0 || h.empire === null || h.empire.capital === h) return null;
    return -(a * P.approvalPct(galaxy)) / 100;
}

/** Ledger term "frontierRule": −frontierTightUnrest under tight rule. Pure. */
export function ruleTerm(galaxy: Galaxy, h: Habitat): number | null {
    const s = sectorOfColony(galaxy, h);
    return s !== null && s.rule === 'tight' ? -P.tightUnrest(galaxy) : null;
}

/** Habitat.cs 474 TaxApproval as a function of the rate (no government override). */
function taxApprovalAt(rate: number): number {
    let num = (0.15 - rate) * 100.0;
    if (num > 0.0) num *= 0.5;
    return num;
}

/** The rate a sector colony pays (the stock rate when none of the sector rules apply). Pure. */
export function sectorTaxRate(galaxy: Galaxy, h: Habitat, stock: number): number {
    const s = sectorOfColony(galaxy, h);
    if (s === null) return stock;
    let rate = s.governor !== null && s.taxOverride !== null ? s.taxOverride : stock;
    if (s.rule === 'loose') rate = (rate * P.looseTaxPct(galaxy)) / 100;
    else if (s.rule === 'tight') rate = (rate * P.tightTaxPct(galaxy)) / 100;
    return rate;
}

/** Ledger term "sectorTax": the TaxApproval difference of the sector rate against the stock rate. Pure. */
export function sectorTaxTerm(galaxy: Galaxy, h: Habitat): number | null {
    if (h.empire === null) return null;
    const gov = empireGovernmentAttributes(h.empire);
    if (gov !== null && gov.specialFunctionCode === 1) return null;
    const stock = Math.fround(h.taxRate);
    const rate = sectorTaxRate(galaxy, h, stock);
    if (rate === stock) return null;
    return taxApprovalAt(rate) - taxApprovalAt(stock);
}

/** True for a sector whose seat (or first colony) lies at radius ≥ frontierRimRadius. Pure. */
export function isRimSector(galaxy: Galaxy, s: FrontierSector): boolean {
    const h = s.seat ?? s.colonies[0] ?? null;
    return h !== null && radiusFraction(galaxy, h.xpos, h.ypos) >= P.rimRadius(galaxy);
}

/** Ledger term "herdTolerance": + frontierHerdTolerancePct% of the 19g-7 herd-loss unrest in a tolerant rim sector. Pure. */
export function herdToleranceTerm(galaxy: Galaxy, h: Habitat): number | null {
    const s = sectorOfColony(galaxy, h);
    if (s === null || !s.herdTolerance || !isRimSector(galaxy, s)) return null;
    const u = rimFaunaUnrest(galaxy, h);
    return u > 0 ? (u * P.herdTolerancePct(galaxy)) / 100 : null;
}

/** Mean autonomy of the sector's colonies. Pure. */
export function sectorAutonomy(galaxy: Galaxy, s: FrontierSector): number {
    const st = peekFrontierState(galaxy);
    if (st === null || s.colonies.length === 0) return 0;
    let sum = 0;
    for (const h of s.colonies) sum += st.colonies.get(h)?.autonomy ?? 0;
    return sum / s.colonies.length;
}

/** A character's loyalty: 19d1's when internal politics runs, else its initial loyalty. Pure. */
export function governorLoyalty(galaxy: Galaxy, c: Character): number {
    return peekPoliticsState(galaxy)?.chars.get(c)?.loyalty ?? initialLoyalty(galaxy, c);
}

function addLoyalty(galaxy: Galaxy, c: Character, amount: number): void {
    if (!scenarioFlag(galaxy, POLITICS_FLAG) || amount === 0) return;
    const e = politicsEntry(galaxy, c);
    e.loyalty = clamp(e.loyalty + amount, 0, 100);
}

// ---------------------------------------------------------------------------------------------------------------
// Fleet presence sample (periodic, no Rnd)
// ---------------------------------------------------------------------------------------------------------------

export function entryOf(galaxy: Galaxy, h: Habitat): FrontierColony {
    const st = frontierState(galaxy);
    let e = st.colonies.get(h);
    if (e === undefined) {
        e = { autonomy: 0, presence: [], causes: [] };
        st.colonies.set(h, e);
    }
    return e;
}

/** Every 30 days: which colonies have an own finished warship in their system. */
export function sampleFleetPresence(galaxy: Galaxy): void {
    for (const empire of galaxy.empires) {
        if (!isPoliticalEmpire(galaxy, empire)) continue;
        const systems = new Set<Habitat>();
        const militia = militiaOf(galaxy, empire);
        for (const bo of empire.builtObjects) {
            if (bo === null || bo.hasBeenDestroyed || bo.builtAt !== null || bo.role !== BuiltObjectRole.Military || bo.nearestSystemStar === null || militia.has(bo)) continue;
            systems.add(bo.nearestSystemStar);
        }
        for (const h of empire.colonies) {
            if (h === null || h.empire !== empire || h === empire.capital) continue;
            const e = entryOf(galaxy, h);
            e.presence.push(systems.has(galaxy.determineHabitatSystemStar(h)) ? 1 : 0);
            if (e.presence.length > PRESENCE_SAMPLES) e.presence.splice(0, e.presence.length - PRESENCE_SAMPLES);
        }
    }
}

/** The yearly autonomy update of every colony of every normal empire (no Rnd). */
export function updateAutonomy(galaxy: Galaxy): void {
    const st = frontierState(galaxy);
    for (const h of [...st.colonies.keys()]) if (!isPoliticalEmpire(galaxy, h.empire) || h.empire!.capital === h) st.colonies.delete(h);
    for (const empire of galaxy.empires) {
        if (!isPoliticalEmpire(galaxy, empire)) continue;
        for (const h of empire.colonies) {
            if (h === null || h.empire !== empire || h === empire.capital) continue;
            const e = entryOf(galaxy, h);
            const { delta, causes } = autonomyDrift(galaxy, h, e);
            e.autonomy = clamp(e.autonomy + delta, 0, 100);
            e.causes = causes;
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Sectors
// ---------------------------------------------------------------------------------------------------------------

export function sectorCoords(galaxy: Galaxy, h: Habitat): { sx: number; sy: number } {
    const sx = clamp(Math.trunc(Math.trunc(h.xpos) / galaxy.sectorSize), 0, galaxy.sectorWidth - 1);
    const sy = clamp(Math.trunc(Math.trunc(h.ypos) / galaxy.sectorSize), 0, galaxy.sectorHeight - 1);
    return { sx, sy };
}

/** The AI's starting rule for a new sector by its race: cautious → loose, aggressive → tight. */
export function aiTemper(empire: Empire): 'cautious' | 'aggressive' | 'neutral' {
    const race = empire.dominantRace;
    const caution = race?.caution ?? 100;
    const aggression = race?.aggression ?? 100;
    return caution > aggression ? 'cautious' : aggression > caution ? 'aggressive' : 'neutral';
}

function formSector(galaxy: Galaxy, empire: Empire, sx: number, sy: number, colonies: Habitat[], year: number): FrontierSector {
    const st = frontierState(galaxy);
    const c0 = colonies[0];
    const s: FrontierSector = {
        id: st.nextSectorId++,
        empire,
        sx,
        sy,
        name: resolveSectorDescription(galaxy, c0.xpos, c0.ypos),
        colonies,
        governor: null,
        seat: null,
        rule: 'normal',
        herdTolerance: false,
        taxOverride: null,
        taxRevoked: false,
        budget: 0,
        militia: [],
        deals: [],
        lastDealYear: -1000,
        unrestYears: 0,
        lastConcedeYear: -1000,
        lastPurgeYear: -1000,
        formed: year,
        orders: 0,
        refusals: 0,
    };
    if (empire !== galaxy.playerEmpire) {
        const t = aiTemper(empire);
        s.rule = t === 'cautious' ? 'loose' : t === 'aggressive' ? 'tight' : 'normal';
    }
    st.sectors.push(s);
    return s;
}

function dissolveSector(galaxy: Galaxy, s: FrontierSector): void {
    const st = frontierState(galaxy);
    const i = st.sectors.indexOf(s);
    if (i >= 0) st.sectors.splice(i, 1);
    for (const bo of s.militia) if (!bo.hasBeenDestroyed && bo.empire === s.empire) bo.isAutoControlled = true;
    if (s.governor !== null) retireHiddenTarget(galaxy, 'sectorUnrest', s.governor, 'dissolved');
    for (const h of s.colonies) if (h.empire === s.empire) recalculateAnnualTaxRevenue(galaxy, h);
}

/** Groups autonomous colonies into sectors; forms / updates / dissolves (no Rnd). */
export function reviewSectors(galaxy: Galaxy, year: number): void {
    const st = frontierState(galaxy);
    // Sectors of fallen empires go.
    for (const s of [...st.sectors]) if (!isPoliticalEmpire(galaxy, s.empire)) dissolveSector(galaxy, s);
    const threshold = P.sectorThreshold(galaxy);
    const hysteresis = P.sectorHysteresis(galaxy);
    const min = Math.max(1, Math.round(P.sectorMinColonies(galaxy)));
    for (const empire of galaxy.empires) {
        if (!isPoliticalEmpire(galaxy, empire)) continue;
        const groups = new Map<string, Habitat[]>();
        for (const h of empire.colonies) {
            if (h === null || h.empire !== empire || h === empire.capital) continue;
            const a = st.colonies.get(h)?.autonomy ?? 0;
            const member = sectorOfColony(galaxy, h) !== null;
            if (a < (member ? threshold - hysteresis : threshold)) continue;
            const { sx, sy } = sectorCoords(galaxy, h);
            const key = `${sx},${sy}`;
            const list = groups.get(key);
            if (list === undefined) groups.set(key, [h]);
            else list.push(h);
        }
        for (const s of st.sectors.filter((x) => x.empire === empire)) {
            const list = groups.get(`${s.sx},${s.sy}`);
            groups.delete(`${s.sx},${s.sy}`);
            if (list === undefined || list.length < min) {
                logEvent(galaxy, s, empire, 'dissolved', scenarioText('Frontier Sector Dissolved', s.name));
                tell(galaxy, empire, 'Frontier Sector Formed Title', scenarioText('Frontier Sector Dissolved', s.name), EmpireMessageType.GeneralNeutralEvent, s.seat);
                dissolveSector(galaxy, s);
                continue;
            }
            const dropped = s.colonies.filter((h) => !list.includes(h));
            s.colonies = list;
            for (const h of dropped) if (h.empire === empire) recalculateAnnualTaxRevenue(galaxy, h);
        }
        const keys = [...groups.keys()].sort();
        for (const key of keys) {
            const list = groups.get(key)!;
            if (list.length < min) continue;
            const [sx, sy] = key.split(',').map(Number);
            formSector(galaxy, empire, sx, sy, list, year);
        }
    }
}

/** Keeps / picks the sector governor (a generated ColonyGovernor at the top colony when none governs; draws then). */
export function reviewGovernor(galaxy: Galaxy, s: FrontierSector, year: number): Character | null {
    const st = frontierState(galaxy);
    const empire = s.empire;
    const cur = s.governor;
    if (cur !== null && cur.active && cur.empire === empire && cur.role === CharacterRole.ColonyGovernor) {
        const at = governedColony(cur);
        if (at !== null && s.colonies.includes(at)) {
            s.seat = at;
            return cur;
        }
    }
    if (cur !== null) retireHiddenTarget(galaxy, 'sectorUnrest', cur, 'replaced');
    const byAutonomy = [...s.colonies].sort((a, b) => (st.colonies.get(b)?.autonomy ?? 0) - (st.colonies.get(a)?.autonomy ?? 0));
    let gov: Character | null = null;
    for (const h of byAutonomy) {
        gov = colonyGovernorOf(h);
        if (gov !== null) break;
    }
    if (gov === null && byAutonomy.length > 0) {
        // RND(19g5): the stock character generator (a new ColonyGovernor at the most autonomous colony).
        gov = generateNewCharacter(galaxy, empire, CharacterRole.ColonyGovernor, byAutonomy[0]).character;
    }
    const wasFormed = s.governor === null && s.formed === year;
    s.governor = gov;
    s.seat = gov !== null ? (governedColony(gov) ?? byAutonomy[0] ?? null) : null;
    s.unrestYears = 0;
    if (gov !== null) {
        addLoyalty(galaxy, gov, 5); // the promotion
        if (wasFormed) {
            const text = scenarioText('Frontier Sector Formed', s.name, s.colonies.length, gov.name);
            logEvent(galaxy, s, empire, 'formed', text);
            tell(galaxy, empire, 'Frontier Sector Formed Title', text, EmpireMessageType.GeneralWarning, s.seat);
        } else {
            const text = scenarioText('Frontier Governor', gov.name, s.name);
            logEvent(galaxy, s, empire, 'governor', text);
            tell(galaxy, empire, 'Frontier Governor Title', text, EmpireMessageType.GeneralNeutralEvent, s.seat);
        }
    }
    return gov;
}

/** Power 1: the governor's local tax rate = the members' mean stock rate × (1 − cut% × autonomy / 100). No Rnd. */
export function setSectorTax(galaxy: Galaxy, s: FrontierSector): void {
    if (s.governor === null || s.taxRevoked || s.colonies.length === 0) {
        s.taxOverride = null;
    } else {
        let sum = 0;
        for (const h of s.colonies) sum += Math.fround(h.taxRate);
        const mean = sum / s.colonies.length;
        const cut = (P.governorTaxCutPct(galaxy) / 100) * (sectorAutonomy(galaxy, s) / 100);
        s.taxOverride = Math.round(mean * (1 - cut) * 100) / 100;
    }
    for (const h of s.colonies) if (h.empire === s.empire) recalculateAnnualTaxRevenue(galaxy, h);
}

/** The sector's yearly tax (the members' positive AnnualTaxRevenue). Pure. */
export function sectorTax(s: FrontierSector): number {
    let t = 0;
    for (const h of s.colonies) if (h.empire === s.empire) t += Math.max(0, h.annualTaxRevenue);
    return t;
}

/** The militia design: the newest buildable escort (else frigate). */
export function militiaDesign(empire: Empire): ReturnType<typeof dlFindNewestCanBuild> {
    return dlFindNewestCanBuild(empire.designs, BuiltObjectSubRole.Escort) ?? dlFindNewestCanBuild(empire.designs, BuiltObjectSubRole.Frigate);
}

const SPACE_PORTS: readonly BuiltObjectSubRole[] = [BuiltObjectSubRole.SmallSpacePort, BuiltObjectSubRole.MediumSpacePort, BuiltObjectSubRole.LargeSpacePort];

/** A finished space port of the empire with a construction yard (the ship yards PurchaseNewBuiltObject builds warships at). */
function isShipYard(bo: BuiltObject | null, empire: Empire): bo is BuiltObject {
    if (bo === null || bo.hasBeenDestroyed || bo.builtAt !== null || bo.empire !== empire || !SPACE_PORTS.includes(bo.subRole)) return false;
    const q = queueOf(bo);
    return q !== null && q.constructionYards !== null && q.constructionYards.length > 0;
}

/**
 * Power 2: the militia. The budget grows by frontierMilitiaPct% of the sector's tax; while it covers a ship (and the
 * treasury can pay — the budget is the capital's tax money kept in the sector), one is bought through the stock
 * PurchaseNewBuiltObject (Empire.6.cs 2098, BuiltObject yard) at a space port of the sector, else the one nearest the
 * seat (colony yards refuse warships: ConstructionQueue.AddBuiltObjectToConstruct). Returns the ships bought.
 */
export function buyMilitia(galaxy: Galaxy, s: FrontierSector): BuiltObject[] {
    const bought: BuiltObject[] = [];
    const empire = s.empire;
    s.militia = s.militia.filter((b) => !b.hasBeenDestroyed && b.empire === empire);
    const seat = s.seat;
    if (s.governor === null || seat === null) return bought;
    const design = militiaDesign(empire);
    if (design === null) return bought;
    const max = Math.round(P.militiaMax(galaxy));
    const yards = empire.builtObjects.filter((bo) => isShipYard(bo, empire));
    const inSector = (bo: BuiltObject): boolean => bo.parentHabitat !== null && s.colonies.includes(bo.parentHabitat);
    const dist = (bo: BuiltObject): number => galaxy.calculateDistance(bo.xpos, bo.ypos, seat.xpos, seat.ypos);
    yards.sort((a, b) => (inSector(a) === inSector(b) ? dist(a) - dist(b) : inSector(a) ? -1 : 1));
    const yard = yards[0] ?? null;
    if (yard === null) return bought;
    while (s.militia.length < max) {
        const price = design.calculateCurrentPurchasePrice(galaxy);
        if (s.budget < price || empire.stateMoney < price) break;
        // RND(19g5): the stock purchase path's own draws (the ship's name).
        const bo = purchaseNewBuiltObject(galaxy, empire, design, yard, true, false);
        if (bo === null) break;
        s.budget -= price;
        s.militia.push(bo);
        bought.push(bo);
        const text = scenarioText('Frontier Militia', s.name, bo.name);
        logEvent(galaxy, s, empire, 'militia', text);
        tell(galaxy, empire, 'Frontier Militia Title', text, EmpireMessageType.GeneralNeutralEvent, bo);
    }
    return bought;
}

/** The finished militia ships patrol the seat (stance: defend the sector). May draw through the stock mission code. */
export function commandMilitia(galaxy: Galaxy, s: FrontierSector): void {
    const seat = s.seat;
    if (seat === null) return;
    for (const bo of s.militia) {
        if (bo.hasBeenDestroyed || bo.builtAt !== null || bo.empire !== s.empire) continue;
        bo.isAutoControlled = false;
        const m = bo.mission as { type?: BuiltObjectMissionType; target?: unknown } | null;
        if (m !== null && m !== undefined && m.type === BuiltObjectMissionType.Patrol) continue;
        assignMission(galaxy, bo, BuiltObjectMissionType.Patrol, seat, null, BuiltObjectMissionPriority.Normal);
    }
}

/** Candidate compact partners near the seat: foreign empires' and independent colonies within range, not at war. Pure. */
export function dealCandidates(galaxy: Galaxy, s: FrontierSector): Habitat[] {
    const seat = s.seat;
    if (seat === null) return [];
    const range = galaxy.sectorSize * P.dealRange(galaxy);
    const out: { h: Habitat; d: number }[] = [];
    const consider = (h: Habitat | null): void => {
        if (h === null || h.empire === null || h.empire === s.empire) return;
        const d = galaxy.calculateDistance(h.xpos, h.ypos, seat.xpos, seat.ypos);
        if (d > range) return;
        if (h.empire !== galaxy.independentEmpire) {
            const rel = s.empire.diplomaticRelations.byEmpire(h.empire);
            if (rel === null || rel.type === DiplomaticRelationType.NotMet || rel.type === DiplomaticRelationType.War) return;
        }
        out.push({ h, d });
    };
    for (const e of galaxy.empires) {
        if (e === s.empire || !isPoliticalEmpire(galaxy, e)) continue;
        for (const h of e.colonies) consider(h);
    }
    if (galaxy.independentEmpire !== null) for (const h of galaxy.independentEmpire.colonies) consider(h);
    out.sort((a, b) => a.d - b.d);
    return out.map((x) => x.h);
}

/** Power 3: a trade compact with the nearest candidate: standing, budget income, the partner's attitude. No Rnd. */
export function signDeal(galaxy: Galaxy, s: FrontierSector, partnerColony: Habitat, year: number): FrontierDeal {
    const partner = partnerColony.empire !== galaxy.independentEmpire ? partnerColony.empire : null;
    let deal = s.deals.find((d) => (partner !== null ? d.partner === partner : d.colony === partnerColony));
    if (deal === undefined) {
        deal = { partner, colony: partner === null ? partnerColony : null, standing: 0, year };
        s.deals.push(deal);
    }
    deal.standing = Math.min(100, deal.standing + P.dealStanding(galaxy));
    deal.year = year;
    s.lastDealYear = year;
    s.budget += (sectorTax(s) * P.dealIncomePct(galaxy)) / 100;
    if (partner !== null) {
        const ev = obtainEmpireEvaluation(galaxy, partner, s.empire);
        ev.incidentEvaluation = ev.incidentEvaluationRaw + P.dealAttitude(galaxy);
    }
    const name = partner !== null ? partner.name : partnerColony.name;
    const text = scenarioText('Frontier Deal', s.governor?.name ?? '?', s.name, name);
    logEvent(galaxy, s, s.empire, 'deal', text, partner);
    tell(galaxy, s.empire, 'Frontier Deal Title', text, EmpireMessageType.GeneralNeutralEvent, partnerColony);
    return deal;
}

// ---------------------------------------------------------------------------------------------------------------
// Orders (the capital's colony policy for a sector) and the right to refuse
// ---------------------------------------------------------------------------------------------------------------

export type FrontierOrder = { kind: 'rule'; rule: SectorRule } | { kind: 'herds'; on: boolean } | { kind: 'tax' };

export function findSector(galaxy: Galaxy, id: number): FrontierSector | null {
    return peekFrontierState(galaxy)?.sectors.find((s) => s.id === id) ?? null;
}

/** An unpopular order: a tighter rule, ending herd tolerance, revoking the local tax rate. Pure. */
export function orderUnpopular(s: FrontierSector, order: FrontierOrder): boolean {
    switch (order.kind) {
        case 'rule':
            return RULE_RANK[order.rule] > RULE_RANK[s.rule];
        case 'herds':
            return s.herdTolerance && !order.on;
        case 'tax':
            return !s.taxRevoked;
    }
}

/** Chance the governor ignores an unpopular order: refuse% × autonomy/100 × (100 − loyalty)/50, capped at 95%. Pure. */
export function refuseChance(galaxy: Galaxy, s: FrontierSector): number {
    if (s.governor === null) return 0;
    const loyaltyFactor = clamp((100 - governorLoyalty(galaxy, s.governor)) / 50, 0, 2);
    return clamp((P.refusePct(galaxy) / 100) * (sectorAutonomy(galaxy, s) / 100) * loyaltyFactor, 0, 0.95);
}

/** The refusal roll: a package Random (galaxy seed, sector id, order count) — never galaxy.rnd. */
function refusalRoll(galaxy: Galaxy, s: FrontierSector): number {
    const seed = ((galaxy.randomSeed ^ 0x19a5f00d) + s.id * 7919 + s.orders * 104729) & 0x7fffffff;
    return new Random(seed).nextDouble();
}

function orderText(order: FrontierOrder): string {
    switch (order.kind) {
        case 'rule':
            return scenarioText('Frontier Order rule', scenarioText(`Frontier Rule ${order.rule}`));
        case 'herds':
            return scenarioText('Frontier Order herds');
        case 'tax':
            return scenarioText('Frontier Order tax');
    }
}

/**
 * The capital orders a sector (player op `frontierOrder`, and the AI): an unpopular order may be refused (a message);
 * a popular one is obeyed. Herd tolerance needs a rim sector.
 */
export function orderSector(galaxy: Galaxy, empire: Empire, sectorId: number, order: FrontierOrder): { ok: boolean; refused?: boolean; reason?: string } {
    if (!frontierOn(galaxy)) return { ok: false, reason: 'Frontier autonomy is off' };
    const s = findSector(galaxy, sectorId);
    if (s === null || s.empire !== empire) return { ok: false, reason: 'No such sector' };
    if (order.kind === 'herds' && order.on && !isRimSector(galaxy, s)) return { ok: false, reason: 'Not a rim sector' };
    s.orders++;
    if (orderUnpopular(s, order) && s.governor !== null && refusalRoll(galaxy, s) < refuseChance(galaxy, s)) {
        s.refusals++;
        const text = scenarioText('Frontier Refused', s.governor.name, s.name, orderText(order));
        logEvent(galaxy, s, empire, 'refused', text);
        tell(galaxy, empire, 'Frontier Refused Title', text, EmpireMessageType.GeneralWarning, s.seat);
        return { ok: true, refused: true };
    }
    switch (order.kind) {
        case 'rule':
            if (s.rule !== order.rule) logEvent(galaxy, s, empire, 'rule', `rule ${s.rule} → ${order.rule}`);
            s.rule = order.rule;
            break;
        case 'herds':
            s.herdTolerance = order.on;
            break;
        case 'tax':
            s.taxRevoked = true;
            break;
    }
    setSectorTax(galaxy, s);
    return { ok: true, refused: false };
}

/**
 * A concession to a restless sector (player op `frontierConcede`, and the cautious AI): loose rule, the local tax
 * restored, 19d1 grantAutonomy at the seat (when internal politics runs), +frontierConcedeLoyalty for the governor;
 * the unrest count restarts. No Rnd.
 */
export function concedeSector(galaxy: Galaxy, empire: Empire, sectorId: number): { ok: boolean; reason?: string } {
    if (!frontierOn(galaxy)) return { ok: false, reason: 'Frontier autonomy is off' };
    const s = findSector(galaxy, sectorId);
    if (s === null || s.empire !== empire) return { ok: false, reason: 'No such sector' };
    s.rule = 'loose';
    s.taxRevoked = false;
    if (s.seat !== null && scenarioFlag(galaxy, POLITICS_FLAG)) grantAutonomy(galaxy, empire, s.seat);
    if (s.governor !== null) {
        addLoyalty(galaxy, s.governor, P.concedeLoyalty(galaxy));
        retireHiddenTarget(galaxy, 'sectorUnrest', s.governor, 'conceded');
    }
    s.unrestYears = 0;
    s.lastConcedeYear = frontierYear(galaxy);
    setSectorTax(galaxy, s);
    const text = scenarioText('Frontier Concede', s.name, s.governor?.name ?? '?');
    logEvent(galaxy, s, empire, 'concede', text);
    tell(galaxy, empire, 'Frontier Concede Title', text, EmpireMessageType.GeneralNeutralEvent, s.seat);
    return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Breakaway
// ---------------------------------------------------------------------------------------------------------------

/** Past the breakaway line: sector autonomy ≥ threshold and the governor's loyalty < frontierBreakawayLoyalty. Pure. */
export function breakawayPressure(galaxy: Galaxy, s: FrontierSector): boolean {
    return s.governor !== null && sectorAutonomy(galaxy, s) >= P.breakawayThreshold(galaxy) && governorLoyalty(galaxy, s.governor) < P.breakawayLoyalty(galaxy);
}

/** A fleet near the seat or 19m martial law there holds the sector this year. Pure. */
export function breakawayDeterred(galaxy: Galaxy, s: FrontierSector): boolean {
    const seat = s.seat;
    if (seat === null) return false;
    return nearbyFleet(galaxy, s.empire, seat) !== null || colonyUnderMartialLaw(galaxy, seat);
}

/** The 19m lead on a restless sector (suspected on the first warning, confirmed on the last). */
function raiseUnrestLead(galaxy: Galaxy, s: FrontierSector, final: boolean): Lead | null {
    if (!securityOn(galaxy) || s.governor === null) return null;
    const thing = registerHiddenThing(galaxy, { kind: 'sectorUnrest', concealment: 30, empire: s.empire, target: s.governor, package: PACKAGE });
    if (thing === null) return null;
    const lead = setLeadLevel(galaxy, thing, s.empire, final ? 'confirmed' : 'suspected', 'package');
    if (lead !== null) onLeadChanged(galaxy, lead, thing);
    return lead ?? (peekLead(galaxy, s) ?? null);
}

/** The open lead on the sector's governor (UI / AI). */
export function peekLead(galaxy: Galaxy, s: FrontierSector): Lead | null {
    if (s.governor === null) return null;
    const thing = findHiddenThing(galaxy, 'sectorUnrest', s.governor);
    if (thing === undefined) return null;
    const leads = (galaxy.scenario?.state.security as { leads?: Lead[] } | undefined)?.leads ?? [];
    return leads.find((l) => !l.closed && l.thingId === thing.id && l.empire === s.empire) ?? null;
}

/** The secession: a new empire under the governor with every sector colony (initiateEmpireSplitAt). */
export function breakAway(galaxy: Galaxy, s: FrontierSector, year: number): Empire | null {
    const empire = s.empire;
    const gov = s.governor;
    const colonies = s.colonies.filter((h) => h.empire === empire && h !== empire.capital);
    const seat = s.seat !== null && colonies.includes(s.seat) ? s.seat : (colonies[0] ?? null);
    if (gov === null || seat === null) return null;
    const st = frontierState(galaxy);
    retireHiddenTarget(galaxy, 'sectorUnrest', gov, 'seceded');
    if (galaxy.nextEmpireId >= galaxy.maximumEmpireCount) {
        // No room for another empire: the sector's colonies leave (become independent), as 19d1 §2.9.
        for (const h of colonies) leaveEmpire(galaxy, h);
        const text = scenarioText('Frontier Breakaway Leave', s.name, gov.name);
        logEvent(galaxy, s, empire, 'breakaway', text);
        scenarioMessage(galaxy, empire, scenarioText('Frontier Breakaway Title'), text, { type: EmpireMessageType.GeneralBadEvent, subject: seat });
        st.sectors.splice(st.sectors.indexOf(s), 1);
        return null;
    }
    const race = seat.population !== null ? seat.population.dominantRace : null;
    const declareWar = s.rule === 'tight' || (race !== null && race.aggression > 110);
    const others = colonies.filter((h) => h !== seat);
    const ships = s.militia.filter((b) => !b.hasBeenDestroyed && b.empire === empire);
    // RND(19g5): the ported split (Empire.1.cs 1102 InitiateEmpireSplit via splinterEmpireAt) draws its own.
    const newEmpire = initiateEmpireSplitAt(galaxy, empire, 1e-9, declareWar, seat, { colonies: others, ships });
    if (newEmpire === null) return null;
    recalculateEmpirePopulation(newEmpire);
    // The governor went with the seat (takeOwnershipOfColonyFull moves its characters); they rule the new empire.
    if (gov.empire !== newEmpire) gov.defectToEmpire(newEmpire, seat);
    if (newEmpire.leader !== null && newEmpire.leader !== gov) {
        newEmpire.leader.kill(galaxy);
        newEmpire.leader = null;
    }
    gov.role = CharacterRole.Leader;
    newEmpire.leader = gov;
    if (scenarioFlag(galaxy, POLITICS_FLAG)) {
        const e = politicsEntry(galaxy, gov);
        e.ambition = 0;
        e.loyalty = 90;
    }
    const idx = st.sectors.indexOf(s);
    if (idx >= 0) st.sectors.splice(idx, 1);
    const n = newEmpire.colonies.length;
    const text = scenarioText('Frontier Breakaway', s.name, gov.name, n, newEmpire.name);
    logEvent(galaxy, s, empire, 'breakaway', text, newEmpire);
    scenarioMessage(galaxy, empire, scenarioText('Frontier Breakaway Title'), text, { type: EmpireMessageType.GeneralBadEvent, subject: seat });
    scenarioNews(galaxy, empire, scenarioText('Frontier Breakaway News', s.name, gov.name, empire.name, newEmpire.name), (e) => e !== empire, seat);
    void year;
    return newEmpire;
}

// ---------------------------------------------------------------------------------------------------------------
// 5. AI
// ---------------------------------------------------------------------------------------------------------------

/** Cautious garrison: the nearest fleet (not already there) gathers at the seat. May draw (the stock Move mission). */
export function garrisonSector(galaxy: Galaxy, s: FrontierSector): ShipGroup | null {
    const seat = s.seat;
    if (seat === null || nearbyFleet(galaxy, s.empire, seat) !== null) return null;
    let best: ShipGroup | null = null;
    let bestD = Infinity;
    for (const g of empireShipGroups(s.empire)) {
        if (g === null || g.leadShip === null || g.ships.length === 0) continue;
        const d = galaxy.calculateDistance(g.leadShip.xpos, g.leadShip.ypos, seat.xpos, seat.ypos);
        if (d < bestD) {
            best = g;
            bestD = d;
        }
    }
    if (best === null) return null;
    best.gatherPoint = seat;
    shipGroupAssignMission(galaxy, best, BuiltObjectMissionType.Move, seat, null, BuiltObjectMissionPriority.High, true);
    logEvent(galaxy, s, s.empire, 'garrison', `fleet ${best.name ?? ''} to ${seat.name}`);
    return best;
}

/** Aggressive purge of the sector governor: the 19m action on a confirmed lead, else 19d1's purge. */
export function purgeSectorGovernor(galaxy: Galaxy, s: FrontierSector): boolean {
    const gov = s.governor;
    if (gov === null) return false;
    const lead = peekLead(galaxy, s);
    let ok = false;
    if (lead !== null && lead.level === 'confirmed') ok = runSecurityAction(galaxy, s.empire, 'purge', lead.id).ok;
    if (!ok && scenarioFlag(galaxy, POLITICS_FLAG)) ok = runPoliticsAction(galaxy, s.empire, 'purge', gov).ok;
    if (ok) {
        logEvent(galaxy, s, s.empire, 'purge', gov.name);
        s.lastPurgeYear = frontierYear(galaxy);
        s.governor = null;
        s.unrestYears = 0;
    }
    return ok;
}

/** An AI empire's answer to a warning (`final`: the last one). */
export function aiRespond(galaxy: Galaxy, s: FrontierSector, final: boolean): void {
    const t = aiTemper(s.empire);
    if (t === 'aggressive') {
        orderSector(galaxy, s.empire, s.id, { kind: 'rule', rule: 'tight' });
        // Once per AI_RESPONSE_YEARS: the next governor of a restless sector is not purged again at once.
        if (final && frontierYear(galaxy) - s.lastPurgeYear >= AI_RESPONSE_YEARS) purgeSectorGovernor(galaxy, s);
    } else {
        garrisonSector(galaxy, s);
        orderSector(galaxy, s.empire, s.id, { kind: 'rule', rule: 'loose' });
        // Once per AI_RESPONSE_YEARS: a sector that stays restless after a concession is lost unless a fleet holds it.
        if (final && t === 'cautious' && frontierYear(galaxy) - s.lastConcedeYear >= AI_RESPONSE_YEARS) concedeSector(galaxy, s.empire, s.id);
    }
}

/** One sector's breakaway step for `year`: warnings (and the AI's answer), deterrence, the secession. */
export function reviewBreakaway(galaxy: Galaxy, s: FrontierSector, year: number): Empire | null {
    if (!breakawayPressure(galaxy, s)) {
        if (s.unrestYears > 0 && s.governor !== null) retireHiddenTarget(galaxy, 'sectorUnrest', s.governor, 'calmed');
        s.unrestYears = 0;
        return null;
    }
    const gov = s.governor!;
    if (breakawayDeterred(galaxy, s)) {
        const text = scenarioText('Frontier Deterred', s.name, gov.name);
        logEvent(galaxy, s, s.empire, 'deterred', text);
        tell(galaxy, s.empire, 'Frontier Warning Title', text, EmpireMessageType.GeneralNeutralEvent, s.seat);
        return null;
    }
    s.unrestYears++;
    const warnings = Math.round(P.warningYears(galaxy));
    if (s.unrestYears <= warnings) {
        const final = s.unrestYears === warnings;
        const text = scenarioText(final ? 'Frontier Warning Final' : 'Frontier Warning', s.name, gov.name);
        logEvent(galaxy, s, s.empire, 'warning', text);
        scenarioMessage(galaxy, s.empire, scenarioText('Frontier Warning Title'), text, { type: EmpireMessageType.GeneralWarning, subject: s.seat });
        raiseUnrestLead(galaxy, s, final);
        if (s.empire !== galaxy.playerEmpire) aiRespond(galaxy, s, final);
        return null;
    }
    return breakAway(galaxy, s, year);
}

// ---------------------------------------------------------------------------------------------------------------
// The yearly handler
// ---------------------------------------------------------------------------------------------------------------

/** Governor loyalty: loose rule +, autonomy above 50 − (19d1 entries only). No Rnd. */
export function governorLoyaltyYear(galaxy: Galaxy, s: FrontierSector): void {
    const gov = s.governor;
    if (gov === null) return;
    let d = 0;
    if (s.rule === 'loose') d += P.looseLoyalty(galaxy);
    const a = sectorAutonomy(galaxy, s);
    if (a > 50) d -= (P.autonomyLoyalty(galaxy) * (a - 50)) / 10;
    addLoyalty(galaxy, gov, d);
}

export function frontierYearly(galaxy: Galaxy, year: number): void {
    updateAutonomy(galaxy);
    reviewSectors(galaxy, year);
    const st = frontierState(galaxy);
    for (const s of [...st.sectors]) {
        if (!st.sectors.includes(s)) continue;
        reviewGovernor(galaxy, s, year);
        if (s.governor === null) continue;
        setSectorTax(galaxy, s);
        s.budget += (sectorTax(s) * P.militiaPct(galaxy)) / 100;
        buyMilitia(galaxy, s);
        commandMilitia(galaxy, s);
        // RND(19g5): trade compact roll.
        if (galaxy.rnd.nextDouble() * 100 < P.dealPct(galaxy)) {
            const partner = dealCandidates(galaxy, s)[0];
            if (partner !== undefined) signDeal(galaxy, s, partner, year);
        }
        governorLoyaltyYear(galaxy, s);
        reviewBreakaway(galaxy, s, year);
    }
}

/** Frontier events of an empire (UI / chronicle). */
export function frontierEvents(galaxy: Galaxy, empire: Empire): FrontierEvent[] {
    return (peekFrontierState(galaxy)?.events ?? []).filter((e) => e.empire === empire);
}

/** The sectors of an empire (UI). */
export function empireSectors(galaxy: Galaxy, empire: Empire): FrontierSector[] {
    return (peekFrontierState(galaxy)?.sectors ?? []).filter((s) => s.empire === empire);
}

// Order 40: after the court (5), 19d1 politics (10) and before 19m security (50) rolls its leads.
registerScenarioYearly({ id: 'frontier.yearly', flag: FRONTIER_FLAG, order: 40, run: frontierYearly });
registerScenarioPeriodic({ id: 'frontier.presence', flag: FRONTIER_FLAG, periodDays: PRESENCE_PERIOD_DAYS, run: (g) => sampleFleetPresence(g) });
registerStabilityTerm({ id: 'frontier.drift', flag: FRONTIER_FLAG, order: 70, cause: 'frontier', label: 'Frontier autonomy', run: (g, h) => frontierTerm(g, h) });
registerStabilityTerm({ id: 'frontier.rule', flag: FRONTIER_FLAG, order: 71, cause: 'frontierRule', label: 'Sector rule', run: (g, h) => ruleTerm(g, h) });
registerStabilityTerm({ id: 'frontier.tax', flag: FRONTIER_FLAG, order: 72, cause: 'sectorTax', label: 'Sector tax', run: (g, h) => sectorTaxTerm(g, h) });
registerStabilityTerm({ id: 'frontier.herds', flag: FRONTIER_FLAG, order: 73, cause: 'herdTolerance', label: 'Herd tolerance', run: (g, h) => herdToleranceTerm(g, h) });
registerScenarioQuery({ id: 'frontier.tax', flag: FRONTIER_FLAG, query: 'colonyTaxRate', run: (g, value, { habitat }) => sectorTaxRate(g, habitat, value) });
