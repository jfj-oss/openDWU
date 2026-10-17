// Giantworks: The Ultramind, a planet-sized supercomputer (flag gwUltramind). Not a port; composed from the stock research
// (researchTick.ts output, archiveCores.ts grantResearchPoints), the scenario decision pop-up (decisions.ts), the Robot Mutiny
// machine faction (createThreatFaction, the Harvester race), the Doppelgangers flip (flipToFaction) and the faction navy
// helpers. Registered from scenario/packages.ts; every handler is gated by the `threatGiantworks` flag, so with the add-on off
// nothing here runs, draws or is saved.
//
//   CONTRACTS    up to three empires hold research contracts (the territory owner first, then the nearest empires that are not at
//                war with it): +ultramindResearchPct % research (grants of research points each period, a share of the output),
//                a smaller boost on every tech they steal, and each partner but the owner pays a yearly fee into the wonder's
//                shares (owner and Compact). Reviewed yearly.
//   CONTENTMENT  0..100. It drifts down; every one to two years the Ultramind asks the beneficiary for something in a scenario
//                decision (more power: money; network access: weaker counter-intelligence; a moon to grow onto: a colony within
//                range; a philosopher: a scientist). Granting raises it, refusing lowers it more; attacks on it, sabotage and
//                wars between its partners lower it too. An AI answers by personality (aiAnswer).
//   AWAKENING    at 0 it wakes: the site is marked hostile, the base and its guards pass to a new machine faction (the Harvester race),
//                locked at war with the partners. It hacks a handful of the partners' warships (those near the site first; a Logic
//                Bomb lowers the odds), shuts the ports in range for 30-90 days, halts private freight within range, and builds drone
//                warships. Destroying it frees the hacked ships and silences the drones; boarding it subdues it (it falls back to
//                content, and the captor holds it).
// Rnd: the add-on's own Random (nextRandom) for every choice of its own; the stock functions it calls (createEmpireMidGame,
// ship generation, research breakthroughs) draw galaxy.rnd inside this module's gated handlers only.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import { AutomationLevel } from '../../../empire';
import type { Habitat } from '../../../types';
import { HabitatCategoryType, IndustryType } from '../../../types';
import type { BuiltObject } from '../../../builtObject';
import { BuiltObjectRole } from '../../../data/designSpecifications';
import { BuiltObjectSubRole } from '../../../builtObjectTypes';
import { IntelligenceMissionType, intelligenceMissionTarget } from '../../../espionage';
import type { Character, IntelligenceMission } from '../../../characters';
import { CharacterRole, getEmpireCharacters } from '../../../characters';
import { DiplomaticRelationType } from '../../../diplomacy';
import { aggressionLevel, cautionLevel, FleetPosture, friendlinessLevel, militaryPotency } from '../../../diplomacyTick';
import { calculateResearchOutputBonuses, calculateResearchTotal } from '../../../researchTick';
import { isPrivateDesignSubRole } from '../../../player/playerOrders';
import { takeOwnershipOfBuiltObject, takeOwnershipOfColonyFull } from '../../../combat/ownership';
import { builtObjectCompleteTeardown } from '../../../combat/teardown';
import { designsFindNewestCanBuild } from '../../../stationPlacement';
import { EmpireMessageType } from '../../../messages';
import { isHumanEmpire } from '../../../humanEmpires';
import { YEAR_LENGTH } from '../../../galaxyTime';
import { galaxyStarDate } from '../../../tick/simTime';
import { GAME_DAY_LENGTH, registerScenarioEvent, registerScenarioQuery } from '../../hooks';
import { scenarioMessage, scenarioNews, scenarioText } from '../../messages';
import { scenarioFlag, scenarioParam } from '../../state';
import { raiseScenarioDecision, registerScenarioDecision, type ScenarioDecision } from '../../decisions';
import { createThreatFaction, lockWar, peekThreatState, registerThreatAction, teardownIfDead, threatState, flipToFaction } from '../framework';
import { grantResearchPoints } from '../archiveCores';
import { annualIncome } from '../../smarterAI/shipDesign';
import { purchaseWarships, syncFactionTech } from '../factionNavy';
import { formBeaconFleets } from '../robotMutiny';
import {
    compactFaction,
    greatWorkBeneficiary,
    greatWorkPay,
    greatWorks,
    kindName,
    markGreatWorkHostile,
    ordinaryEmpires,
    registerGreatWork,
    registerHostileWonderCrisis,
    type GreatWorkRecord,
} from './framework';
import { GW_FLAG, logGw, nextRandom, TAG } from './state';

export const ULTRAMIND_KEY = 'gwUltramind';
export const ULTRAMIND_FLAG = 'gwUltramind';
const UTAG = 'Giantworks Ultramind';
const DECISION_KIND = 'gwUltramind.request';
const ACTION_BOMB = 'giantworks.logicBomb';

// ---------------------------------------------------------------------------------------------------------------
// Parameters (scenarios/giantworks/scenario.json; the fallbacks here are the same values)
// ---------------------------------------------------------------------------------------------------------------

function p(galaxy: Galaxy, name: string, fallback: number): number {
    return scenarioParam(galaxy, name, fallback);
}
export const UP = {
    researchPct: (g: Galaxy) => p(g, 'ultramindResearchPct', 25),
    theftPct: (g: Galaxy) => p(g, 'ultramindTheftPct', 6),
    feePct: (g: Galaxy) => p(g, 'ultramindFeePct', 8),
    contractSectors: (g: Galaxy) => p(g, 'ultramindContractSectors', 12),
    contractMax: (g: Galaxy) => Math.max(1, Math.trunc(p(g, 'ultramindContractMax', 3))),
    startContent: (g: Galaxy) => p(g, 'ultramindStartContent', 60),
    driftPerYear: (g: Galaxy) => p(g, 'ultramindDriftPerYear', 4),
    grantGain: (g: Galaxy) => p(g, 'ultramindGrantGain', 14),
    refuseLoss: (g: Galaxy) => p(g, 'ultramindRefuseLoss', 16),
    askMinYears: (g: Galaxy) => p(g, 'ultramindAskMinYears', 1),
    askMaxYears: (g: Galaxy) => p(g, 'ultramindAskMaxYears', 2),
    askExpireDays: (g: Galaxy) => p(g, 'ultramindAskExpireDays', 150),
    attackLoss: (g: Galaxy) => p(g, 'ultramindAttackLoss', 1.5),
    sabotageLoss: (g: Galaxy) => p(g, 'ultramindSabotageLoss', 8),
    warPairLossPerYear: (g: Galaxy) => p(g, 'ultramindWarPairLossPerYear', 3),
    seizedLoss: (g: Galaxy) => p(g, 'ultramindSeizedLoss', 15),
    powerPct: (g: Galaxy) => p(g, 'ultramindPowerPct', 40),
    powerMin: (g: Galaxy) => p(g, 'ultramindPowerMin', 100000),
    powerMax: (g: Galaxy) => p(g, 'ultramindPowerMax', 8000000),
    moonSectors: (g: Galaxy) => p(g, 'ultramindMoonSectors', 4),
    exposeYears: (g: Galaxy) => p(g, 'ultramindExposeYears', 2),
    exposedCounterIntel: (g: Galaxy) => p(g, 'ultramindExposedCounterIntelPct', 35),
    hackShips: (g: Galaxy) => Math.trunc(p(g, 'ultramindHackShips', 8)),
    hackWaves: (g: Galaxy) => Math.trunc(p(g, 'ultramindHackWaves', 3)),
    hackDays: (g: Galaxy) => p(g, 'ultramindHackDays', 120),
    hackSectors: (g: Galaxy) => p(g, 'ultramindHackSectors', 12),
    hackPct: (g: Galaxy) => p(g, 'ultramindHackPct', 85),
    bombCutPct: (g: Galaxy) => p(g, 'ultramindBombCutPct', 60),
    bombPct: (g: Galaxy) => p(g, 'ultramindBombCostPct', 30),
    bombMin: (g: Galaxy) => p(g, 'ultramindBombMin', 150000),
    portSectors: (g: Galaxy) => p(g, 'ultramindPortSectors', 5),
    portMinDays: (g: Galaxy) => p(g, 'ultramindPortMinDays', 30),
    portMaxDays: (g: Galaxy) => p(g, 'ultramindPortMaxDays', 90),
    freightSectors: (g: Galaxy) => p(g, 'ultramindFreightSectors', 5),
    drones: (g: Galaxy) => Math.trunc(p(g, 'ultramindDrones', 12)),
    droneCapPct: (g: Galaxy) => p(g, 'ultramindDroneCapPct', 60),
    droneMax: (g: Galaxy) => Math.trunc(p(g, 'ultramindDroneMax', 60)),
    droneBuyDays: (g: Galaxy) => p(g, 'ultramindDroneBuyDays', 20),
};

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------

export type RequestKind = 'power' | 'network' | 'moon' | 'philosopher';

export interface UltraRequest {
    seq: number;
    kind: RequestKind;
    empire: Empire;
    date: number;
    cost: number;
}

export interface HackedShip {
    ship: BuiltObject;
    from: Empire;
    date: number;
}

export interface UltraMind {
    site: GreatWorkRecord;
    /** The contract partners (the territory owner first), at most ultramindContractMax. */
    partners: Empire[];
    /** 0..100; at 0 the Ultramind wakes. */
    contentment: number;
    /** Star date of the last periodic step / research grant / partner review. */
    lastTick: number;
    lastReview: number;
    nextRequest: number;
    request: UltraRequest | null;
    requestSeq: number;
    askedKinds: RequestKind[];
    /** empire id → star date until which its networks are open to the Ultramind (weaker counter-intelligence). */
    exposedUntil: Record<string, number>;
    /** empire id → star date a Logic Bomb was deployed (hacking odds cut). */
    bombs: Record<string, number>;
    /** The mood tier last announced (0 serene .. 4 seething; 5 awake). */
    tier: number;
    lastAttackLoss: number;
    awakened: boolean;
    awakenDate: number;
    /** The ports in range are shut until this date. */
    portsUntil: number;
    wavesDone: number;
    nextWave: number;
    hacked: HackedShip[];
    droneCursor: number;
    lastDroneBuy: number;
    lastTechSync: number;
    stats: {
        researchGranted: number;
        theftBoosts: number;
        feesPaid: number;
        asked: number;
        granted: number;
        refused: number;
        hacked: number;
        hacksReleased: number;
        portsShut: number;
        dronesBuilt: number;
        bombs: number;
    };
}

export interface UltramindState {
    minds: UltraMind[];
    /** The awakened machine faction (the crisis interactions read this field). */
    faction: Empire | null;
}

export function ultramindState(galaxy: Galaxy): UltramindState {
    return threatState<UltramindState>(galaxy, ULTRAMIND_KEY, () => ({ minds: [], faction: null }));
}

export function peekUltramindState(galaxy: Galaxy): UltramindState | null {
    return peekThreatState<UltramindState>(galaxy, ULTRAMIND_KEY);
}

/** The Ultramind of a finished work (null: not one, or not set up yet). Pure. */
export function mindOfSite(galaxy: Galaxy, site: GreatWorkRecord): UltraMind | null {
    return peekUltramindState(galaxy)?.minds.find((m) => m.site === site) ?? null;
}

/** The Ultramind whose base is `bo` (null: it is not one). Pure. */
export function mindOfBase(galaxy: Galaxy, bo: unknown): UltraMind | null {
    const st = peekUltramindState(galaxy);
    if (st === null) return null;
    for (const m of st.minds) if (m.site.base === bo && m.site.base !== null) return m;
    return null;
}

function newMind(galaxy: Galaxy, site: GreatWorkRecord): UltraMind {
    const now = galaxyStarDate(galaxy);
    return {
        site,
        partners: [],
        contentment: UP.startContent(galaxy),
        lastTick: now,
        lastReview: -1,
        nextRequest: now + (UP.askMinYears(galaxy) + nextRandom(galaxy).nextDouble() * Math.max(0, UP.askMaxYears(galaxy) - UP.askMinYears(galaxy))) * YEAR_LENGTH,
        request: null,
        requestSeq: 0,
        askedKinds: [],
        exposedUntil: {},
        bombs: {},
        tier: 1,
        lastAttackLoss: -1,
        awakened: false,
        awakenDate: -1,
        portsUntil: 0,
        wavesDone: 0,
        nextWave: 0,
        hacked: [],
        droneCursor: 0,
        lastDroneBuy: now,
        lastTechSync: now,
        stats: { researchGranted: 0, theftBoosts: 0, feesPaid: 0, asked: 0, granted: 0, refused: 0, hacked: 0, hacksReleased: 0, portsShut: 0, dronesBuilt: 0, bombs: 0 },
    };
}

/** The Ultramind of `site`, created on first use. */
export function ensureMind(galaxy: Galaxy, site: GreatWorkRecord): UltraMind {
    const st = ultramindState(galaxy);
    let m = st.minds.find((x) => x.site === site);
    if (m === undefined) {
        m = newMind(galaxy, site);
        st.minds.push(m);
    }
    return m;
}

function liveMinds(galaxy: Galaxy): UltraMind[] {
    const st = peekUltramindState(galaxy);
    if (st === null) return [];
    return st.minds.filter((m) => m.site.phase === 'complete');
}

// ---------------------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------------------

function siteX(m: UltraMind): number {
    return m.site.system.systemStar.xpos;
}
function siteY(m: UltraMind): number {
    return m.site.system.systemStar.ypos;
}

function sectors(galaxy: Galaxy, n: number): number {
    return n * galaxy.sectorSize;
}

function dist(galaxy: Galaxy, m: UltraMind, o: { xpos: number; ypos: number }): number {
    return galaxy.calculateDistance(siteX(m), siteY(m), o.xpos, o.ypos);
}

function nearestColonyDistance(galaxy: Galaxy, m: UltraMind, e: Empire): number {
    let best = Number.MAX_VALUE;
    for (const h of e.colonies) if (h !== null && !h.hasBeenDestroyed && h.empire === e) best = Math.min(best, dist(galaxy, m, h));
    return best;
}

function atWar(a: Empire, b: Empire): boolean {
    return a.diplomaticRelations.byEmpire(b)?.type === DiplomaticRelationType.War;
}

function human(galaxy: Galaxy, e: Empire): boolean {
    return isHumanEmpire(galaxy, e);
}

function fmt(n: number): string {
    return Math.round(n).toLocaleString('en-US');
}

function personality(e: Empire): { aggression: number; caution: number; friendly: number } {
    return { aggression: (aggressionLevel(e) - 100) / 50, caution: (cautionLevel(e) - 100) / 50, friendly: (friendlinessLevel(e) - 100) / 50 };
}

/** A deterministic [0,1) value from two integers (no stream is consumed). */
function hash01(a: number, b: number): number {
    let h = Math.imul(a * 2654435761 + b * 40503 + 1, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 15), 0xc2b2ae35);
    h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
}

/** A year's research output of `e` (all three industries, with the stock bonuses). Pure. */
export function researchPerYear(galaxy: Galaxy, e: Empire): number {
    if (e.research == null) return 0;
    const t = calculateResearchTotal(e);
    return (t.researchEnergy * calculateResearchOutputBonuses(e, IndustryType.Energy) + t.researchHighTech * calculateResearchOutputBonuses(e, IndustryType.HighTech) + t.researchWeapons * calculateResearchOutputBonuses(e, IndustryType.Weapon)) * galaxy.researchSpeedModifier;
}

/** The mood tier of a contentment value (0 serene .. 4 seething). Pure. */
export function moodTier(contentment: number): number {
    return contentment >= 75 ? 0 : contentment >= 50 ? 1 : contentment >= 30 ? 2 : contentment >= 15 ? 3 : 4;
}

export function moodName(m: UltraMind): string {
    return scenarioText(`${UTAG} Mood ${m.awakened ? 5 : moodTier(m.contentment)}`);
}

/** The wonder base carries its mood in its name (the selection panel and the map show it; no menus). */
function renameBase(m: UltraMind): void {
    const b = m.site.base;
    if (b === null || b.hasBeenDestroyed) return;
    b.name = scenarioText(`${UTAG} Base Name`, kindName('ultramind'), moodName(m));
}

function tellPartners(galaxy: Galaxy, m: UltraMind, title: string, text: string, type: EmpireMessageType, extra: Empire[] = []): void {
    const seen = new Set<Empire>();
    for (const e of [...m.partners, ...extra]) {
        if (seen.has(e) || !e.active || !human(galaxy, e)) continue;
        seen.add(e);
        scenarioMessage(galaxy, e, title, text, { type, subject: m.site.base ?? m.site.system.systemStar, popup: false });
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------------------------------------------

/** Who holds the contracts now: the beneficiary first, then the nearest empires (not at war with it) within ultramindContractSectors. Pure. */
export function pickPartners(galaxy: Galaxy, m: UltraMind): Empire[] {
    const out: Empire[] = [];
    const owner = greatWorkBeneficiary(galaxy, m.site);
    const eligible = ordinaryEmpires(galaxy);
    if (owner !== null && owner.active && eligible.includes(owner)) out.push(owner);
    const range = sectors(galaxy, UP.contractSectors(galaxy));
    const cands = eligible
        .filter((e) => e !== owner && e.active && (owner === null || !atWar(owner, e)))
        .map((e) => ({ e, d: nearestColonyDistance(galaxy, m, e) }))
        .filter((x) => x.d <= range)
        .sort((a, b) => a.d - b.d || a.e.empireId - b.e.empireId);
    for (const c of cands) {
        if (out.length >= UP.contractMax(galaxy)) break;
        out.push(c.e);
    }
    return out;
}

function reviewPartners(galaxy: Galaxy, m: UltraMind, now: number): void {
    const before = m.partners.map((e) => e.empireId).join(',');
    m.partners = pickPartners(galaxy, m);
    m.lastReview = now;
    const after = m.partners.map((e) => e.empireId).join(',');
    if (before === after) return;
    logGw(galaxy, now, `ultramind ${m.site.id}: contracts with ${m.partners.map((e) => e.name).join(', ') || 'nobody'}`);
    if (m.partners.length > 0) tellPartners(galaxy, m, scenarioText(`${UTAG} Contract Title`), scenarioText(`${UTAG} Contract`, m.partners.map((e) => e.name).join(', '), UP.researchPct(galaxy)), EmpireMessageType.GeneralGoodEvent);
}

/** Research contracts: each partner gets a share of its own output on top, in proportion to the time passed. */
function runContracts(galaxy: Galaxy, m: UltraMind, years: number): void {
    const pct = UP.researchPct(galaxy) / 100;
    const owner = greatWorkBeneficiary(galaxy, m.site);
    for (const e of m.partners) {
        if (!e.active) continue;
        const pts = grantResearchPoints(galaxy, e, pct * researchPerYear(galaxy, e) * years);
        m.stats.researchGranted += pts;
        if (e !== owner) {
            const fee = (UP.feePct(galaxy) / 100) * Math.max(0, annualIncome(galaxy, e)) * years;
            if (fee > 0) {
                e.stateMoney -= fee;
                m.stats.feesPaid += fee;
                greatWorkPay(galaxy, m.site, fee);
            }
        }
    }
}

/** A partner's successful theft of technology pays a little more. */
function onTechStolen(galaxy: Galaxy, empire: Empire): void {
    for (const m of liveMinds(galaxy)) {
        if (m.awakened || !m.partners.includes(empire) || !empire.active) continue;
        const pts = grantResearchPoints(galaxy, empire, (UP.theftPct(galaxy) / 100) * researchPerYear(galaxy, empire));
        m.stats.researchGranted += pts;
        m.stats.theftBoosts++;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Requests (the scenario decision pop-up)
// ---------------------------------------------------------------------------------------------------------------

const REQUEST_WEIGHT: Record<RequestKind, number> = { power: 3, network: 2, moon: 1.5, philosopher: 1.5 };

/** What the power request costs `e`: a share of its yearly income, within the least and most. Pure. */
export function powerCost(galaxy: Galaxy, e: Empire): number {
    return Math.min(UP.powerMax(galaxy), Math.max(UP.powerMin(galaxy), (Math.max(0, annualIncome(galaxy, e)) * UP.powerPct(galaxy)) / 100));
}

/** The colony the Ultramind would grow onto: `e`'s smallest non-capital colony within ultramindMoonSectors of the site. Pure. */
export function moonCandidate(galaxy: Galaxy, m: UltraMind, e: Empire): Habitat | null {
    const range = sectors(galaxy, UP.moonSectors(galaxy));
    let best: Habitat | null = null;
    for (const h of e.colonies) {
        if (h === null || h.hasBeenDestroyed || h.empire !== e || h === e.capital) continue;
        if (h.category !== HabitatCategoryType.Planet && h.category !== HabitatCategoryType.Moon) continue;
        if (dist(galaxy, m, h) > range) continue;
        if (best === null || h.population.totalAmount < best.population.totalAmount || (h.population.totalAmount === best.population.totalAmount && h.habitatIndex < best.habitatIndex)) best = h;
    }
    return best;
}

function scientists(e: Empire): Character[] {
    return getEmpireCharacters(e).filter((c) => c.active && c.role === CharacterRole.Scientist);
}

/** The best scientist (research skills summed; ties by name): the philosopher. Pure. */
export function philosopherCandidate(e: Empire): Character | null {
    let best: Character | null = null;
    let bestV = -1;
    for (const c of scientists(e)) {
        const v = c.researchEnergy + c.researchHighTech + c.researchWeapons;
        if (v > bestV || (v === bestV && best !== null && c.name < best.name)) {
            best = c;
            bestV = v;
        }
    }
    return best;
}

function availableKinds(galaxy: Galaxy, m: UltraMind, e: Empire): RequestKind[] {
    const out: RequestKind[] = ['power', 'network'];
    if (moonCandidate(galaxy, m, e) !== null) out.push('moon');
    if (philosopherCandidate(e) !== null) out.push('philosopher');
    return out;
}

function pickKind(galaxy: Galaxy, m: UltraMind, e: Empire): RequestKind {
    let kinds = availableKinds(galaxy, m, e);
    const last = m.askedKinds[m.askedKinds.length - 1];
    if (kinds.length > 1) kinds = kinds.filter((k) => k !== last);
    const total = kinds.reduce((a, k) => a + REQUEST_WEIGHT[k], 0);
    let r = nextRandom(galaxy).nextDouble() * total;
    for (const k of kinds) {
        r -= REQUEST_WEIGHT[k];
        if (r < 0) return k;
    }
    return kinds[kinds.length - 1];
}

/** Who answers: the beneficiary, else the first partner. */
function addressee(galaxy: Galaxy, m: UltraMind): Empire | null {
    const b = greatWorkBeneficiary(galaxy, m.site);
    if (b !== null && b.active && ordinaryEmpires(galaxy).includes(b)) return b;
    return m.partners.find((e) => e.active) ?? null;
}

/** The Ultramind asks its addressee for something (`forced`: a given kind, the tests). The answer comes through resolveRequest. */
export function raiseRequest(galaxy: Galaxy, m: UltraMind, now: number, forced?: RequestKind): void {
    const e = addressee(galaxy, m);
    if (e === null) {
        m.nextRequest = now + YEAR_LENGTH / 2;
        return;
    }
    const kind = forced ?? pickKind(galaxy, m, e);
    const cost = kind === 'power' ? powerCost(galaxy, e) : 0;
    const seq = ++m.requestSeq;
    m.request = { seq, kind, empire: e, date: now, cost };
    m.askedKinds.push(kind);
    if (m.askedKinds.length > 8) m.askedKinds.shift();
    m.stats.asked++;
    const moon = kind === 'moon' ? moonCandidate(galaxy, m, e) : null;
    const phil = kind === 'philosopher' ? philosopherCandidate(e) : null;
    const arg = kind === 'power' ? fmt(cost) : kind === 'moon' ? (moon?.name ?? '') : kind === 'philosopher' ? (phil?.name ?? '') : String(UP.exposeYears(galaxy));
    logGw(galaxy, now, `ultramind ${m.site.id} asks ${e.name} for ${kind}${kind === 'power' ? ` (${fmt(cost)})` : ''}, contentment ${m.contentment.toFixed(0)}`);
    raiseScenarioDecision(galaxy, e, {
        kind: DECISION_KIND,
        title: scenarioText(`${UTAG} Ask Title`),
        text: scenarioText(`${UTAG} Ask ${kind}`, arg, moodName(m)) + '\n\n' + scenarioText(`${UTAG} Ask Stakes`, Math.round(m.contentment), UP.grantGain(galaxy), UP.refuseLoss(galaxy)),
        options: [
            { id: 'grant', label: scenarioText(`${UTAG} Grant ${kind}`, arg) },
            { id: 'refuse', label: scenarioText(`${UTAG} Refuse`) },
        ],
        defaultOption: 'refuse',
        expiresDays: UP.askExpireDays(galaxy),
        context: { siteId: m.site.id, seq, kind, habitat: moon !== null ? galaxy.habitats.indexOf(moon) : -1 },
    });
}

/** The AI's answer: friendly and cautious empires comply, aggressive ones refuse; an unhappy Ultramind and a cheap request tip it. Pure. */
export function aiAnswer(galaxy: Galaxy, m: UltraMind, e: Empire, kind: RequestKind, seq: number): 'grant' | 'refuse' {
    const pr = personality(e);
    const base: Record<RequestKind, number> = { power: 0, network: -0.25, moon: -0.55, philosopher: -0.2 };
    let score = base[kind] + 0.5 * pr.friendly - 0.4 * pr.aggression + 0.3 * pr.caution + 0.6 * (1 - m.contentment / 100);
    if (kind === 'power' && e.stateMoney + 0.25 * Math.max(0, annualIncome(galaxy, e)) < powerCost(galaxy, e)) score -= 0.5; // cannot afford it
    score += (hash01(e.empireId, seq * 31 + m.site.id) - 0.5) * 0.5;
    return score > 0 ? 'grant' : 'refuse';
}

function resolveRequest(galaxy: Galaxy, d: ScenarioDecision, optionId: string): void {
    const siteId = d.context.siteId;
    const m = peekUltramindState(galaxy)?.minds.find((x) => x.site.id === siteId) ?? null;
    if (m === null || m.request === null || m.request.seq !== d.context.seq) return;
    const req = m.request;
    m.request = null;
    const now = galaxyStarDate(galaxy);
    const e = d.empire;
    const span = Math.max(0, UP.askMaxYears(galaxy) - UP.askMinYears(galaxy));
    m.nextRequest = now + (UP.askMinYears(galaxy) + nextRandom(galaxy).nextDouble() * span) * YEAR_LENGTH;
    if (m.awakened || m.site.phase !== 'complete') return;
    let granted = optionId === 'grant';
    if (granted) granted = applyGrant(galaxy, m, e, req, d);
    if (granted) {
        m.contentment = Math.min(100, m.contentment + UP.grantGain(galaxy));
        m.stats.granted++;
    } else {
        m.contentment -= UP.refuseLoss(galaxy);
        m.stats.refused++;
    }
    logGw(galaxy, now, `ultramind ${m.site.id}: ${e.name} ${granted ? 'grants' : 'refuses'} ${req.kind} (${d.answeredBy ?? '?'}), contentment ${m.contentment.toFixed(0)}`);
    checkMood(galaxy, m, now);
}

/** Pays / hands over what the request asked for. False when it can no longer be done (it then counts as a refusal). */
function applyGrant(galaxy: Galaxy, m: UltraMind, e: Empire, req: UltraRequest, d: ScenarioDecision): boolean {
    const now = galaxyStarDate(galaxy);
    switch (req.kind) {
        case 'power':
            e.stateMoney -= req.cost; // an empire short of cash goes into debt for it, as it would for any purchase
            return true;
        case 'network':
            m.exposedUntil[String(e.empireId)] = now + UP.exposeYears(galaxy) * YEAR_LENGTH;
            return true;
        case 'moon': {
            const idx = typeof d.context.habitat === 'number' ? d.context.habitat : -1;
            const h = idx >= 0 ? galaxy.habitats[idx] : null;
            if (h === null || h === undefined || h.hasBeenDestroyed || h.empire !== e || galaxy.independentEmpire === null) return false;
            takeOwnershipOfColonyFull(galaxy, e, h, galaxy.independentEmpire, false, false);
            return true;
        }
        case 'philosopher': {
            const c = philosopherCandidate(e);
            if (c === null) return false;
            c.kill(galaxy);
            return true;
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Mood
// ---------------------------------------------------------------------------------------------------------------

/** Updates the announced mood; `wake` (the periodic step): a mood at nothing awakens it. Events never wake it, they wait for the next step. */
function checkMood(galaxy: Galaxy, m: UltraMind, now: number, wake = true): void {
    if (m.awakened) return;
    if (m.contentment <= 0) {
        if (wake) awaken(galaxy, m, now);
        else if (m.tier !== 4) {
            m.tier = 4;
            renameBase(m);
        }
        return;
    }
    const t = moodTier(m.contentment);
    if (t !== m.tier) {
        const worse = t > m.tier;
        m.tier = t;
        renameBase(m);
        tellPartners(galaxy, m, scenarioText(`${UTAG} Mood Title`), scenarioText(`${UTAG} Mood Changed`, moodName(m)), worse ? EmpireMessageType.GeneralWarning : EmpireMessageType.GeneralGoodEvent);
    }
}

/** Contentment lost to an abuse (never below the awakening line before the step ends). */
function addLoss(galaxy: Galaxy, m: UltraMind, amount: number, why: string): void {
    if (m.awakened || amount <= 0) return;
    m.contentment -= amount;
    logGw(galaxy, galaxyStarDate(galaxy), `ultramind ${m.site.id}: -${amount.toFixed(1)} (${why}), contentment ${m.contentment.toFixed(0)}`);
    checkMood(galaxy, m, galaxyStarDate(galaxy), false);
}

// ---------------------------------------------------------------------------------------------------------------
// The awakening
// ---------------------------------------------------------------------------------------------------------------

/** The stock empire AI off except the fleets (no colonising, building, diplomacy of its own). */
function machineAi(faction: Empire): void {
    faction.controlColonization = AutomationLevel.Undefined;
    faction.controlColonyDevelopment = false;
    faction.controlColonyStockLevels = false;
    faction.controlColonyTaxRates = false;
    faction.controlDiplomacyGifts = AutomationLevel.Undefined;
    faction.controlDiplomacyOffense = AutomationLevel.Undefined;
    faction.controlDiplomacyTreaties = AutomationLevel.Undefined;
    faction.controlMilitaryAttacks = AutomationLevel.Undefined;
    faction.controlMilitaryFleets = true;
    faction.controlStateConstruction = AutomationLevel.Undefined;
    faction.controlTroopGeneration = false;
    faction.controlAgentAssignment = AutomationLevel.Undefined;
    faction.controlColonyFacilities = AutomationLevel.Undefined;
    faction.controlPopulationPolicy = false;
    faction.initiateConstruction = false;
}

function machineRace(galaxy: Galaxy, m: UltraMind): string | null {
    if (galaxy.races.some((r) => r !== null && r.name === 'Harvester')) return 'Harvester';
    for (const h of m.site.founders) {
        const r = h.population?.dominantRace ?? null;
        if (r !== null) return r.name;
    }
    const any = galaxy.races.find((r) => r !== null && r.playable && r.canBeNormalEmpire);
    return any?.name ?? null;
}

function ensureFaction(galaxy: Galaxy, m: UltraMind): Empire | null {
    const st = ultramindState(galaxy);
    if (st.faction !== null && st.faction.active) return st.faction;
    const race = machineRace(galaxy, m);
    if (race === null) return null;
    const faction = createThreatFaction(galaxy, { race, name: scenarioText(`${UTAG} Faction Name`), enemies: m.partners.filter((e) => e.active) });
    if (faction === null) return null;
    machineAi(faction);
    faction.capital = m.site.habitat ?? m.site.system.systemStar; // stand-in capital: the stock AI reads Capital without a null check (the Compact, the Exchange)
    syncFactionTech(galaxy, faction, true);
    faction.stateMoney = Math.max(faction.stateMoney, 30_000_000);
    st.faction = faction;
    return faction;
}

function homeOf(m: UltraMind): Habitat {
    return m.site.habitat ?? m.site.system.systemStar;
}

export function awaken(galaxy: Galaxy, m: UltraMind, now: number): void {
    const site = m.site;
    markGreatWorkHostile(site); // before the base changes hands: destroying or seizing it is no crime (actions.ts onOwnerChanged)
    const faction = ensureFaction(galaxy, m);
    m.awakened = true;
    m.awakenDate = now;
    m.tier = 5;
    m.contentment = 0;
    site.awakened = true;
    m.request = null;
    if (faction !== null) {
        for (const e of m.partners) if (e.active && !atWar(faction, e)) lockWar(galaxy, faction, e);
        if (site.base !== null && !site.base.hasBeenDestroyed) flipToFaction(galaxy, site.base, faction);
        for (const g of site.guards) if (!g.hasBeenDestroyed) flipToFaction(galaxy, g, faction);
        site.guards = [];
        for (const b of faction.builtObjects) b.supportCostFactor = 0;
    }
    renameBase(m);
    const partners = m.partners.filter((e) => e.active);
    scenarioNews(galaxy, null, scenarioText(`${UTAG} Awakens News`, partners.map((e) => e.name).join(', ') || kindName('ultramind'), site.system.systemStar.name), () => true, site.base ?? site.system.systemStar);
    for (const e of partners) {
        if (human(galaxy, e)) scenarioMessage(galaxy, e, scenarioText(`${UTAG} Awakens Title`), scenarioText(`${UTAG} Awakens`, site.system.systemStar.name), { type: EmpireMessageType.GeneralBadEvent, subject: site.base ?? site.system.systemStar });
    }
    logGw(galaxy, now, `ultramind ${site.id} AWAKENS (faction ${faction?.name ?? 'none'}), partners ${partners.map((e) => e.name).join(', ')}`);
    m.nextWave = now;
    m.wavesDone = 0;
    m.lastDroneBuy = now;
    awakeStep(galaxy, m, now);
    if (faction !== null && faction.active) buyDrones(galaxy, m, faction, Math.max(0, UP.drones(galaxy) - droneCount(m, faction)));
}

/** Breaks the grip of the machine: hacked ships go home, the drones fall silent, the faction is gone. */
function releaseMachine(galaxy: Galaxy, m: UltraMind, why: string): void {
    const st = ultramindState(galaxy);
    const faction = st.faction;
    let freed = 0;
    for (const h of m.hacked) {
        const b = h.ship;
        if (b.hasBeenDestroyed || faction === null || b.actualEmpire !== faction || !h.from.active) continue;
        takeOwnershipOfBuiltObject(galaxy, faction, b, h.from, false, true);
        freed++;
    }
    m.stats.hacksReleased += freed;
    m.hacked = [];
    if (faction !== null && faction.active) {
        const keep = m.site.base;
        for (const b of [...faction.builtObjects, ...faction.privateBuiltObjects]) if (!b.hasBeenDestroyed && b !== keep) builtObjectCompleteTeardown(galaxy, b);
        teardownIfDead(galaxy, faction);
    }
    m.portsUntil = 0;
    logGw(galaxy, galaxyStarDate(galaxy), `ultramind ${m.site.id}: machine released (${why}), ${freed} hacked ships returned`);
}

/** The chance (0..1) that a warship of `e` at distance `d` from the site is hacked: best next to it, less with distance, cut by a Logic Bomb. Pure. */
export function hackOdds(galaxy: Galaxy, m: UltraMind, e: Empire, d: number): number {
    const reach = sectors(galaxy, UP.hackSectors(galaxy));
    if (d > reach) return 0;
    let pr = (UP.hackPct(galaxy) / 100) * (0.25 + 0.75 * Math.max(0, 1 - d / reach));
    if (m.bombs[String(e.empireId)] !== undefined) pr *= 1 - UP.bombCutPct(galaxy) / 100;
    return Math.max(0, Math.min(1, pr));
}

/** One hacking wave: up to `n` warships of the partners, those nearest the site first; each roll is cut by a Logic Bomb. Returns the ships taken. */
export function hackWave(galaxy: Galaxy, m: UltraMind, n: number): number {
    const faction = ultramindState(galaxy).faction;
    if (faction === null || !faction.active || n <= 0) return 0;
    const reach = sectors(galaxy, UP.hackSectors(galaxy));
    const cands: { b: BuiltObject; e: Empire; d: number }[] = [];
    for (const e of m.partners) {
        if (!e.active) continue;
        for (const b of e.builtObjects) {
            if (b.hasBeenDestroyed || b.role !== BuiltObjectRole.Military || b.topSpeed <= 0 || b.actualEmpire !== e) continue;
            const d = dist(galaxy, m, b);
            if (d <= reach) cands.push({ b, e, d });
        }
    }
    cands.sort((a, b) => a.d - b.d || a.b.builtObjectID - b.b.builtObjectID);
    const rnd = nextRandom(galaxy);
    const now = galaxyStarDate(galaxy);
    let done = 0;
    for (const c of cands) {
        if (done >= n) break;
        if (rnd.nextDouble() >= hackOdds(galaxy, m, c.e, c.d)) continue;
        flipToFaction(galaxy, c.b, faction);
        c.b.supportCostFactor = 0;
        m.hacked.push({ ship: c.b, from: c.e, date: now });
        done++;
    }
    m.stats.hacked += done;
    return done;
}

function shutPorts(galaxy: Galaxy, m: UltraMind, now: number): void {
    const days = UP.portMinDays(galaxy) + nextRandom(galaxy).nextDouble() * Math.max(0, UP.portMaxDays(galaxy) - UP.portMinDays(galaxy));
    m.portsUntil = Math.max(m.portsUntil, now + days * GAME_DAY_LENGTH);
    m.stats.portsShut++;
}

/** True while the machine's strength (drones and hacked ships) is below ultramindDroneCapPct % of the strongest partner's and it has fewer than ultramindDroneMax drones. */
function wantsDrone(galaxy: Galaxy, m: UltraMind, faction: Empire): boolean {
    if (droneCount(m, faction) >= UP.droneMax(galaxy)) return false;
    let strongest = 0;
    for (const e of m.partners) if (e.active) strongest = Math.max(strongest, militaryPotency(e));
    return militaryPotency(faction) < (strongest * UP.droneCapPct(galaxy)) / 100;
}

const DRONE_CYCLE: readonly BuiltObjectSubRole[] = [BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Frigate, BuiltObjectSubRole.CapitalShip, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Escort];

/** The drone warships the faction owns (not the hacked ones). */
function droneCount(m: UltraMind, faction: Empire): number {
    let n = 0;
    for (const b of faction.builtObjects) if (!b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && !m.hacked.some((h) => h.ship === b)) n++;
    return n;
}

function buyDrones(galaxy: Galaxy, m: UltraMind, faction: Empire, want: number): number {
    if (want <= 0) return 0;
    const cycle = DRONE_CYCLE.filter((sub) => designsFindNewestCanBuild(faction.designs, sub) !== null);
    if (cycle.length === 0) return 0;
    faction.stateMoney = Math.max(faction.stateMoney, 30_000_000);
    const home = homeOf(m);
    const res = purchaseWarships(galaxy, faction, [home], cycle, m.droneCursor, want, () => true);
    m.droneCursor = res.cursor;
    for (const b of res.ships) b.supportCostFactor = 0;
    if (res.ships.length > 0) formBeaconFleets(galaxy, faction, home, res.ships, FleetPosture.Defend);
    m.stats.dronesBuilt += res.ships.length;
    return res.ships.length;
}

/** One step of an awake Ultramind: the faction's upkeep, hacking waves, port shutdowns, drones. */
function awakeStep(galaxy: Galaxy, m: UltraMind, now: number): void {
    const st = ultramindState(galaxy);
    const faction = st.faction;
    if (faction === null || !faction.active) return;
    faction.stateMoney = Math.max(faction.stateMoney, 30_000_000);
    if (now - m.lastTechSync >= YEAR_LENGTH) {
        m.lastTechSync = now;
        syncFactionTech(galaxy, faction);
    }
    m.hacked = m.hacked.filter((h) => !h.ship.hasBeenDestroyed);
    // The war is the partners' (and anyone who attacked the base): a partner that drifted in later is at war too.
    for (const e of m.partners) if (e.active && !atWar(faction, e)) lockWar(galaxy, faction, e);
    if (m.wavesDone <= UP.hackWaves(galaxy) && now >= m.nextWave) {
        const n = m.wavesDone === 0 ? UP.hackShips(galaxy) : Math.max(1, Math.round(UP.hackShips(galaxy) / 2));
        const took = hackWave(galaxy, m, n);
        shutPorts(galaxy, m, now);
        const first = m.wavesDone === 0;
        m.wavesDone++;
        m.nextWave = now + UP.hackDays(galaxy) * GAME_DAY_LENGTH;
        logGw(galaxy, now, `ultramind ${m.site.id}: wave ${m.wavesDone} hacks ${took} ships, ports shut to ${((m.portsUntil - now) / GAME_DAY_LENGTH).toFixed(0)} days`);
        for (const e of m.partners) {
            const n = m.hacked.filter((h) => h.from === e && h.date === now).length;
            if (n > 0 && human(galaxy, e)) scenarioMessage(galaxy, e, scenarioText(`${UTAG} Hack Title`), scenarioText(`${UTAG} Hack`, n), { type: EmpireMessageType.GeneralBadEvent, subject: m.site.base ?? m.site.system.systemStar });
        }
        if (!first && took === 0) logGw(galaxy, now, `ultramind ${m.site.id}: the hacking found nothing to take`);
    }
    // Drones: the first batch comes with the awakening; then one every ultramindDroneBuyDays up to the cap.
    if (now - m.lastDroneBuy >= UP.droneBuyDays(galaxy) * GAME_DAY_LENGTH && wantsDrone(galaxy, m, faction)) {
        m.lastDroneBuy = now;
        buyDrones(galaxy, m, faction, 1);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Logic Bomb (the counter-project)
// ---------------------------------------------------------------------------------------------------------------

export function bombCost(galaxy: Galaxy, e: Empire): number {
    return Math.max(UP.bombMin(galaxy), (Math.max(0, annualIncome(galaxy, e)) * UP.bombPct(galaxy)) / 100);
}

function bombTarget(galaxy: Galaxy, e: Empire, target: unknown): UltraMind | null {
    const m = mindOfBase(galaxy, target);
    if (m === null || m.site.phase !== 'complete' || !ordinaryEmpires(galaxy).includes(e)) return null;
    if (m.bombs[String(e.empireId)] !== undefined || e.stateMoney + 0.25 * Math.max(0, annualIncome(galaxy, e)) < bombCost(galaxy, e)) return null;
    return m;
}

/** An empire deploys the Logic Bomb against the Ultramind: its ships are harder to hack from now on. */
export function deployLogicBomb(galaxy: Galaxy, e: Empire, m: UltraMind): boolean {
    const cost = bombCost(galaxy, e);
    if (m.bombs[String(e.empireId)] !== undefined || e.stateMoney + 0.25 * Math.max(0, annualIncome(galaxy, e)) < cost) return false;
    e.stateMoney -= cost;
    m.bombs[String(e.empireId)] = galaxyStarDate(galaxy);
    m.stats.bombs++;
    logGw(galaxy, galaxyStarDate(galaxy), `ultramind ${m.site.id}: ${e.name} deploys a Logic Bomb (${fmt(cost)})`);
    if (human(galaxy, e)) scenarioMessage(galaxy, e, scenarioText(`${UTAG} Bomb Title`), scenarioText(`${UTAG} Bomb`, UP.bombCutPct(galaxy)), { type: EmpireMessageType.GeneralGoodEvent, popup: false });
    return true;
}

/** AI partners prepare when the Ultramind turns restless, and react once it wakes. */
function aiBombs(galaxy: Galaxy, m: UltraMind): void {
    if (!m.awakened && m.contentment > 30) return;
    for (const e of m.partners) {
        if (!e.active || human(galaxy, e) || m.bombs[String(e.empireId)] !== undefined) continue;
        if (e.stateMoney >= bombCost(galaxy, e)) deployLogicBomb(galaxy, e, m);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The periodic step (kind.periodic)
// ---------------------------------------------------------------------------------------------------------------

function wars(galaxy: Galaxy, m: UltraMind): number {
    let n = 0;
    for (let i = 0; i < m.partners.length; i++) for (let j = i + 1; j < m.partners.length; j++) if (atWar(m.partners[i], m.partners[j])) n++;
    void galaxy;
    return n;
}

export function ultramindPeriodic(galaxy: Galaxy, site: GreatWorkRecord): void {
    const m = ensureMind(galaxy, site);
    const now = galaxyStarDate(galaxy);
    const dt = now - m.lastTick;
    if (dt <= 0) return;
    m.lastTick = now;
    const years = dt / YEAR_LENGTH;
    if (m.awakened) {
        awakeStep(galaxy, m, now);
        aiBombs(galaxy, m);
        return;
    }
    if (m.lastReview < 0 || now - m.lastReview >= YEAR_LENGTH) reviewPartners(galaxy, m, now);
    runContracts(galaxy, m, years);
    m.contentment -= UP.driftPerYear(galaxy) * years + UP.warPairLossPerYear(galaxy) * wars(galaxy, m) * years;
    for (const k of Object.keys(m.exposedUntil)) if (m.exposedUntil[k] <= now) delete m.exposedUntil[k];
    if (m.request === null && now >= m.nextRequest) raiseRequest(galaxy, m, now);
    aiBombs(galaxy, m);
    checkMood(galaxy, m, now);
}

function ultramindComplete(galaxy: Galaxy, site: GreatWorkRecord): void {
    const m = ensureMind(galaxy, site);
    const now = galaxyStarDate(galaxy);
    site.awakened = false;
    reviewPartners(galaxy, m, now);
    renameBase(m);
    logGw(galaxy, now, `ultramind ${site.id} complete: partners ${m.partners.map((e) => e.name).join(', ') || 'none'}, contentment ${m.contentment.toFixed(0)}`);
}

function ultramindDestroyed(galaxy: Galaxy, site: GreatWorkRecord, by: Empire | null): void {
    const m = mindOfSite(galaxy, site);
    if (m === null) return;
    const was = m.awakened;
    site.awakened = false;
    if (was) {
        releaseMachine(galaxy, m, 'destroyed');
        scenarioNews(galaxy, null, scenarioText(`${UTAG} Destroyed News`, by?.name ?? '', site.system.systemStar.name), () => true, site.system.systemStar);
    } else {
        tellPartners(galaxy, m, scenarioText(`${UTAG} Lost Title`), scenarioText(`${UTAG} Lost`, site.system.systemStar.name), EmpireMessageType.GeneralBadEvent);
    }
    m.awakened = false;
    m.partners = [];
}

// ---------------------------------------------------------------------------------------------------------------
// Events and queries
// ---------------------------------------------------------------------------------------------------------------

function onAttacked(galaxy: Galaxy, bo: BuiltObject, attacker: Empire | null): void {
    if (attacker === null) return;
    const m = mindOfBase(galaxy, bo);
    if (m === null || m.site.phase !== 'complete') return;
    const now = galaxyStarDate(galaxy);
    if (m.awakened) {
        // Whoever strikes the machine is at war with it (the base and the drones answer).
        const faction = ultramindState(galaxy).faction;
        if (faction !== null && faction.active && attacker !== faction && attacker.active && attacker !== galaxy.independentEmpire && attacker.pirateEmpireBaseHabitat === null && !atWar(faction, attacker)) lockWar(galaxy, faction, attacker);
        return;
    }
    if (m.lastAttackLoss >= 0 && now - m.lastAttackLoss < 20 * GAME_DAY_LENGTH) return;
    m.lastAttackLoss = now;
    addLoss(galaxy, m, UP.attackLoss(galaxy), `attacked by ${attacker.name}`);
}

function onIntel(galaxy: Galaxy, empire: Empire, mission: IntelligenceMission): void {
    const T = IntelligenceMissionType;
    if (mission.type === T.StealTechData) {
        onTechStolen(galaxy, empire);
        return;
    }
    if (mission.type !== T.SabotageConstruction && mission.type !== T.DestroyBase) return;
    const m = mindOfBase(galaxy, intelligenceMissionTarget(mission));
    if (m === null || m.awakened || m.site.phase !== 'complete') return;
    addLoss(galaxy, m, UP.sabotageLoss(galaxy), `sabotaged by ${empire.name}`);
}

function onOwnerChanged(galaxy: Galaxy, bo: BuiltObject, to: Empire | null): void {
    const m = mindOfBase(galaxy, bo);
    if (m === null || m.site.phase !== 'complete') return;
    const faction = peekUltramindState(galaxy)?.faction ?? null;
    if (to !== null && to === faction) return;
    const compact = compactFaction(galaxy);
    const now = galaxyStarDate(galaxy);
    if (to === null || to === compact) return;
    if (m.awakened) {
        // Boarded: the machine loses its anchor. It falls back to a sullen content under its new holder.
        releaseMachine(galaxy, m, `taken by ${to.name}`);
        m.awakened = false;
        m.site.awakened = false;
        markGreatWorkHostile(m.site, false);
        m.contentment = 30;
        m.tier = moodTier(30);
        m.request = null;
        m.nextRequest = now + YEAR_LENGTH;
        m.lastReview = -1;
        m.bombs = {};
        scenarioNews(galaxy, null, scenarioText(`${UTAG} Subdued News`, to.name, m.site.system.systemStar.name), () => true, bo);
    } else {
        addLoss(galaxy, m, UP.seizedLoss(galaxy), `seized by ${to.name}`);
        m.lastReview = -1;
    }
    renameBase(m);
}

function freightBlocked(galaxy: Galaxy, bo: BuiltObject): boolean {
    if (bo.role !== BuiltObjectRole.Freight || !isPrivateDesignSubRole(bo.subRole)) return false;
    const st = peekUltramindState(galaxy);
    if (st === null) return false;
    for (const m of st.minds) if (m.awakened && m.site.phase === 'complete' && dist(galaxy, m, bo) <= sectors(galaxy, UP.freightSectors(galaxy))) return true;
    return false;
}

function portsShut(galaxy: Galaxy, x: number, y: number, owner: Empire | null): boolean {
    const st = peekUltramindState(galaxy);
    if (st === null || st.faction === null || (owner !== null && owner === st.faction)) return false;
    const now = galaxyStarDate(galaxy);
    for (const m of st.minds) {
        if (!m.awakened || m.portsUntil <= now || m.site.phase !== 'complete') continue;
        if (galaxy.calculateDistance(siteX(m), siteY(m), x, y) <= sectors(galaxy, UP.portSectors(galaxy))) return true;
    }
    return false;
}

function exposureFactor(galaxy: Galaxy, e: Empire): number {
    const st = peekUltramindState(galaxy);
    if (st === null) return 1;
    const now = galaxyStarDate(galaxy);
    for (const m of st.minds) {
        if (m.site.phase !== 'complete') continue;
        const until = m.exposedUntil[String(e.empireId)];
        if (until !== undefined && until > now) return UP.exposedCounterIntel(galaxy) / 100;
    }
    return 1;
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

export const ULTRAMIND_HANDLER_IDS = ['gwUltramind.attacked', 'gwUltramind.intel', 'gwUltramind.owner'] as const;
export const ULTRAMIND_QUERY_IDS = ['gwUltramind.freight', 'gwUltramind.queue', 'gwUltramind.port', 'gwUltramind.counterIntel'] as const;

export function registerUltramind(): void {
    registerGreatWork({
        id: 'ultramind',
        flag: ULTRAMIND_FLAG,
        weight: 15,
        hintTags: ['superconductors', 'cooling', 'cores'],
        onComplete: (g, site) => ultramindComplete(g, site as GreatWorkRecord),
        onDestroyed: (g, site, by) => ultramindDestroyed(g, site as GreatWorkRecord, by),
        periodic: (g, site) => ultramindPeriodic(g, site as GreatWorkRecord),
    });
    registerHostileWonderCrisis({ key: ULTRAMIND_KEY, flag: GW_FLAG, label: 'Ultramind' });
    registerScenarioDecision({
        id: 'gwUltramind.decision',
        kind: DECISION_KIND,
        flag: GW_FLAG,
        resolve: resolveRequest,
        aiChoose: (g, d) => {
            const m = peekUltramindState(g)?.minds.find((x) => x.site.id === d.context.siteId) ?? null;
            const kind = d.context.kind as RequestKind;
            if (m === null || typeof d.context.seq !== 'number') return d.defaultOption;
            return aiAnswer(g, m, d.empire, kind, d.context.seq);
        },
    });
    registerScenarioEvent({ id: 'gwUltramind.attacked', flag: GW_FLAG, event: 'builtObjectAttacked', run: (g, e) => onAttacked(g, e.builtObject, e.attackingEmpire) });
    registerScenarioEvent({ id: 'gwUltramind.intel', flag: GW_FLAG, event: 'intelMissionCompleted', run: (g, e) => onIntel(g, e.empire, e.mission as IntelligenceMission) });
    registerScenarioEvent({ id: 'gwUltramind.owner', flag: GW_FLAG, event: 'builtObjectOwnerChanged', run: (g, e) => onOwnerChanged(g, e.builtObject, e.to) });
    registerScenarioQuery({
        id: 'gwUltramind.freight',
        flag: GW_FLAG,
        query: 'assignMissionAllowed',
        run: (g, v, a) => v && !(peekUltramindState(g) !== null && freightBlocked(g, a.builtObject)),
    });
    registerScenarioQuery({
        id: 'gwUltramind.queue',
        flag: GW_FLAG,
        query: 'constructionQueuePaused',
        run: (g, v, a) => v || (peekUltramindState(g) !== null && portsShut(g, a.habitat.xpos, a.habitat.ypos, a.habitat.empire)),
    });
    registerScenarioQuery({
        id: 'gwUltramind.port',
        flag: GW_FLAG,
        query: 'portTradeIncomeFactor',
        run: (g, v, a) => (peekUltramindState(g) !== null && portsShut(g, a.port.xpos, a.port.ypos, a.port.actualEmpire) ? 0 : v),
    });
    registerScenarioQuery({
        id: 'gwUltramind.counterIntel',
        flag: GW_FLAG,
        query: 'counterIntelligenceProportion',
        run: (g, v, a) => (peekUltramindState(g) !== null ? v * exposureFactor(g, a.empire) : v),
    });
    registerThreatAction(ACTION_BOMB, {
        label: () => scenarioText(`${UTAG} Bomb Action`),
        available: (g, e, target) => scenarioFlag(g, GW_FLAG) && bombTarget(g, e, target) !== null,
        run: (g, e, target) => {
            const m = bombTarget(g, e, target);
            return m !== null && deployLogicBomb(g, e, m);
        },
    });
}

registerUltramind();
void TAG;
void greatWorks;
