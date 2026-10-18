// Giantworks: The Ultramind, a planet-sized supercomputer (flag gwUltramind). Not a port; composed from the stock research
// (researchTick.ts output, archiveCores.ts grantResearchPoints), the scenario decision pop-up (decisions.ts), the Robot Mutiny
// machine faction (createThreatFaction, the Harvester race), the Doppelgangers flip (flipToFaction), the faction navy helpers and
// the Interstellar Diet (registerDietMotionKind). Registered from scenario/packages.ts; every handler is gated by the
// `threatGiantworks` flag, so with the add-on off nothing here runs, draws or is saved.
//
//   CONTRACTS    up to three empires hold research contracts (the territory owner first, then the nearest empires that are not at
//                war with it): +ultramindHolderResearchPct % research for the empire whose territory holds it (the beneficiary),
//                +ultramindPartnerResearchPct % for the others (grants of research points each period, a share of the output),
//                a smaller boost on every tech they steal, and each partner but the owner pays a yearly fee into the wonder's
//                shares (owner and Compact). Reviewed yearly. An empire that withdrew (or was sanctioned out) is not drawn again.
//   STANDING     the Ultramind keeps a standing 0..100 PER PARTNER (a grudge book). Everything it holds against an empire hits only
//                that empire: a war between partners costs the AGGRESSOR (the stock warDeclared event names who declared; a
//                declaration against a recorded aggressor is retaliation and costs nothing), attacks on it, sabotage, boarding
//                and refused requests cost whoever did them. Everyone drifts down slowly, the holder faster (the price of its bigger
//                bonus) and faster still while it ignores the Ultramind's requests. Every partner is asked now and then (the
//                holder twice as often) in a scenario decision (more power: money; network access: weaker counter-intelligence; a
//                moon to grow onto: a colony within range; a philosopher: a scientist); granting raises that empire's standing,
//                refusing lowers it more. An AI answers by personality (aiAnswer). The overall mood (its name and texts) is the
//                lowest standing among its partners.
//   AWAKENING    when any partner's standing reaches 0 it wakes: the site is marked hostile, the base and its guards pass to a
//                new machine faction (the Harvester race), locked at war ONLY with the partners whose standing collapsed (below
//                ultramindOffenderBelow) and with whoever attacks its base later. The partners in good standing stay neutral and are
//                offered a deal in a scenario decision: keep the contract at a reduced rate if they help contain the offenders
//                (trade sanctions on them), or decline (the contract ends). The machine hacks a handful of the offenders' warships
//                (those near the site first; a Logic Bomb lowers the odds), shuts the ports in range of the empires it is at war with
//                for 30-90 days, halts their private freight within range, and builds drone warships. Destroying it frees the hacked
//                ships and silences the drones; boarding it subdues it (it falls back to content, and the captor holds it).
//   PROTECTION   (a) withdraw from the contract at any time (a threat action: the bonus goes, the empire leaves the list and is not at
//                war with it on awakening unless it attacks), (b) grant its requests, (c) the Logic Bomb, (d) a Diet motion to sanction
//                the empire upsetting the Ultramind (trade sanctions by the members, and its contract ends). AI partners withdraw
//                or deploy a Logic Bomb when their own standing is dangerously low; AI Diet members move the sanction.
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
import { applyIntelligenceMissionEffect, characterMission, IntelligenceMissionType, intelligenceMissionTarget, newIntelligenceMissionAgainstEmpire } from '../../../espionage';
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
import type { CaptainBonuses } from '../../../characters';
import { peekHiveState } from '../hive';
import { peekCultState } from '../cult';
import { peekBeaconState } from './beaconState';
import { peekCasinoState, reveal as revealCasinoFront } from './casino';
import { scenarioMessage, scenarioNews, scenarioText } from '../../messages';
import { scenarioFlag, scenarioParam } from '../../state';
import { raiseScenarioDecision, registerScenarioDecision, type ScenarioDecision } from '../../decisions';
import { KNOWLEDGE_CONFIRMED, revealTo, createThreatFaction, lockWar, peekThreatState, registerThreatAction, teardownIfDead, threatState, flipToFaction } from '../framework';
import { finishCurrentProject, grantResearchPoints } from '../archiveCores';
import { applyMotion, imposeSanctions, type Motion } from '../../emergent/council';
import { dietCouncil } from '../../charactersVictory/diet/diet';
import { dietOn, registerDietMotionKind, type DietKindCandidate } from '../../charactersVictory/diet/dietState';
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
const DEAL_KIND = 'gwUltramind.deal';
const ACTION_BOMB = 'giantworks.logicBomb';
const ACTION_WITHDRAW = 'giantworks.ultramindWithdraw';
export const MOTION_SANCTION = 'gwUltramindSanction';

// ---------------------------------------------------------------------------------------------------------------
// Parameters (scenarios/giantworks/scenario.json; the fallbacks here are the same values)
// ---------------------------------------------------------------------------------------------------------------

function p(galaxy: Galaxy, name: string, fallback: number): number {
    return scenarioParam(galaxy, name, fallback);
}
export const UP = {
    holderResearchPct: (g: Galaxy) => p(g, 'ultramindHolderResearchPct', 100),
    partnerResearchPct: (g: Galaxy) => p(g, 'ultramindPartnerResearchPct', 50),
    theftPct: (g: Galaxy) => p(g, 'ultramindTheftPct', 6),
    feePct: (g: Galaxy) => p(g, 'ultramindFeePct', 8),
    contractSectors: (g: Galaxy) => p(g, 'ultramindContractSectors', 12),
    contractMax: (g: Galaxy) => Math.max(1, Math.trunc(p(g, 'ultramindContractMax', 3))),
    startContent: (g: Galaxy) => p(g, 'ultramindStartContent', 60),
    driftPerYear: (g: Galaxy) => p(g, 'ultramindDriftPerYear', 4),
    holderDriftMult: (g: Galaxy) => p(g, 'ultramindHolderDriftMult', 1.5),
    ignoredDriftPerYear: (g: Galaxy) => p(g, 'ultramindIgnoredDriftPerYear', 2),
    ignoredMax: (g: Galaxy) => Math.max(0, Math.trunc(p(g, 'ultramindIgnoredMax', 3))),
    partnerAskMult: (g: Galaxy) => p(g, 'ultramindPartnerAskMult', 2),
    grantGain: (g: Galaxy) => p(g, 'ultramindGrantGain', 14),
    refuseLoss: (g: Galaxy) => p(g, 'ultramindRefuseLoss', 16),
    askMinYears: (g: Galaxy) => p(g, 'ultramindAskMinYears', 1),
    askMaxYears: (g: Galaxy) => p(g, 'ultramindAskMaxYears', 2),
    askExpireDays: (g: Galaxy) => p(g, 'ultramindAskExpireDays', 150),
    attackLoss: (g: Galaxy) => p(g, 'ultramindAttackLoss', 1.5),
    sabotageLoss: (g: Galaxy) => p(g, 'ultramindSabotageLoss', 8),
    warDeclareLoss: (g: Galaxy) => p(g, 'ultramindWarDeclareLoss', 10),
    warLossPerYear: (g: Galaxy) => p(g, 'ultramindWarLossPerYear', 3),
    seizedLoss: (g: Galaxy) => p(g, 'ultramindSeizedLoss', 15),
    offenderBelow: (g: Galaxy) => p(g, 'ultramindOffenderBelow', 20),
    dealPct: (g: Galaxy) => p(g, 'ultramindDealPct', 50),
    dealExpireDays: (g: Galaxy) => p(g, 'ultramindDealExpireDays', 60),
    sanctionBelow: (g: Galaxy) => p(g, 'ultramindSanctionBelow', 35),
    aiWatchBelow: (g: Galaxy) => p(g, 'ultramindAiWatchBelow', 30),
    aiWithdrawBelow: (g: Galaxy) => p(g, 'ultramindAiWithdrawBelow', 15),
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
    // directives
    otherResearchPct: (g: Galaxy) => p(g, 'ultramindOtherResearchPct', 33),
    switchDays: (g: Galaxy) => p(g, 'ultramindSwitchDays', 60),
    directivePartnerPct: (g: Galaxy) => p(g, 'ultramindDirectivePartnerPct', 50),
    breakthroughDays: (g: Galaxy) => p(g, 'ultramindBreakthroughDays', 480),
    warBattleSectors: (g: Galaxy) => p(g, 'ultramindWarBattleSectors', 12),
    warTargetingPts: (g: Galaxy) => p(g, 'ultramindWarTargetingPts', 25),
    warCountermeasuresPts: (g: Galaxy) => p(g, 'ultramindWarCountermeasuresPts', 25),
    warWarningSectors: (g: Galaxy) => p(g, 'ultramindWarWarningSectors', 15),
    econTaxPct: (g: Galaxy) => p(g, 'ultramindEconTaxPct', 8),
    econBuildPct: (g: Galaxy) => p(g, 'ultramindEconBuildPct', 15),
    econPricePct: (g: Galaxy) => p(g, 'ultramindEconPricePct', 8),
    econUpkeepPct: (g: Galaxy) => p(g, 'ultramindEconUpkeepPct', 8),
    econTradePct: (g: Galaxy) => p(g, 'ultramindEconTradePct', 10),
    intelDays: (g: Galaxy) => p(g, 'ultramindIntelDays', 45),
    intelDetectSectors: (g: Galaxy) => p(g, 'ultramindIntelDetectSectors', 14),
    intelCounterPct: (g: Galaxy) => p(g, 'ultramindIntelCounterPct', 60),
    intelCatchPct: (g: Galaxy) => p(g, 'ultramindIntelCatchPct', 50),
    intelStealPct: (g: Galaxy) => p(g, 'ultramindIntelStealPct', 10),
    fleetShips: (g: Galaxy) => Math.max(1, Math.trunc(p(g, 'ultramindFleetShips', 3))),
    aiDirectiveDays: (g: Galaxy) => p(g, 'ultramindAiDirectiveDays', 180),
};

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------

export type RequestKind = 'power' | 'network' | 'moon' | 'philosopher' | 'fleet';

/** What the holder sets the Ultramind to work on (one at a time). */
export type Directive = 'research' | 'war' | 'economy' | 'intelligence';
export const DIRECTIVES: readonly Directive[] = ['research', 'war', 'economy', 'intelligence'];

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

/** A war between two partners, as the stock warDeclared event named it: `aggressor` declared it on `victim`. */
export interface UltraWar {
    aggressor: Empire;
    victim: Empire;
    since: number;
}

export type WithdrawWhy = 'withdrew' | 'declined' | 'sanctioned';

export interface UltraMind {
    site: GreatWorkRecord;
    /** The contract partners (the territory owner first), at most ultramindContractMax. After the awakening: the neutral ones (their deal pending or kept). */
    partners: Empire[];
    /** The partner whose territory holds it (the beneficiary, as of the last review); null when it withdrew or nobody's does. It sets the directive. */
    holder: Empire | null;
    /** The directive in force, the one being switched to (null: none) and the star date the switch is done; until then no directive works. */
    directive: Directive;
    switchTo: Directive | null;
    switchUntil: number;
    /** Star date of the AI holder's next look at its directive, and of the last switch. */
    nextDirectiveReview: number;
    lastSwitch: number;
    /** empire id → star date of its next breakthrough (Research) / next intelligence round (Intelligence). */
    nextBreak: Record<string, number>;
    nextIntel: Record<string, number>;
    /** Standing of each partner (empire id → 0..100); at 0 the Ultramind wakes. */
    standing: Record<string, number>;
    /** Derived (refreshMood): the lowest standing among the partners; 0 once awake. The mood in its name and texts. */
    contentment: number;
    /** Star date of the last periodic step / research grant / partner review. */
    lastTick: number;
    lastReview: number;
    /** empire id → star date of its next request. */
    nextRequest: Record<string, number>;
    /** empire id → the request waiting for its answer. */
    requests: Record<string, UltraRequest>;
    /** empire id → requests in a row it refused or let lapse (the holder drifts faster the longer the streak). */
    ignored: Record<string, number>;
    requestSeq: number;
    askedKinds: RequestKind[];
    /** empire id → star date until which its networks are open to the Ultramind (weaker counter-intelligence). */
    exposedUntil: Record<string, number>;
    /** empire id → star date a Logic Bomb was deployed (hacking odds cut). */
    bombs: Record<string, number>;
    /** The overall mood tier last announced (0 serene .. 4 seething; 5 awake). */
    tier: number;
    /** empire id → the tier of its own standing last announced. */
    tiers: Record<string, number>;
    /** empire id → star date it last cost the Ultramind standing by attacking it. */
    lastAttackLoss: Record<string, number>;
    /** Wars between partners it holds against the aggressor. */
    wars: UltraWar[];
    /** Empires that left its contracts (and are not drawn again until it is subdued). */
    withdrawn: Record<string, { date: number; why: WithdrawWhy }>;
    /** Standing a newcomer to the contracts starts with (30 after it was subdued, else ultramindStartContent). */
    joinStanding: number;
    /** empire id → standing it will lose when it joins (a boarder that was not a partner yet). */
    pendingLoss: Record<string, number>;
    /** The empires the machine is at war with because their standing collapsed (later attackers join the war without being listed here). */
    offenders: Empire[];
    /** After the awakening: empire id → its deal ('pending' until it answers, 'accepted'). */
    deals: Record<string, 'pending' | 'accepted'>;
    /** empire id → cause → standing lost / gained (diagnostics: who caused the drops). */
    lost: Record<string, Record<string, number>>;
    /** empire id → research points the contract granted (the flat bonus) and the breakthroughs completed (diagnostics for the soak). */
    granted: Record<string, { flat: number; breakthrough: number }>;
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
        withdrawals: number;
        sanctions: number;
        dealsAccepted: number;
        dealsDeclined: number;
        switches: number;
        breakthroughs: number;
        breakthroughPoints: number;
        threatsRevealed: number;
        spiesCaught: number;
        freeIntel: number;
        fleetsStudied: number;
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
    const st = peekThreatState<UltramindState>(galaxy, ULTRAMIND_KEY);
    if (st !== null) for (const m of st.minds) migrate(m); // a save from before the per-partner standings
    return st;
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
        holder: null,
        directive: 'research',
        switchTo: null,
        switchUntil: 0,
        nextDirectiveReview: now + UP.aiDirectiveDays(galaxy) * GAME_DAY_LENGTH,
        lastSwitch: -1,
        nextBreak: {},
        nextIntel: {},
        standing: {},
        contentment: UP.startContent(galaxy),
        lastTick: now,
        lastReview: -1,
        nextRequest: {},
        requests: {},
        ignored: {},
        requestSeq: 0,
        askedKinds: [],
        exposedUntil: {},
        bombs: {},
        tier: 1,
        tiers: {},
        lastAttackLoss: {},
        wars: [],
        withdrawn: {},
        joinStanding: UP.startContent(galaxy),
        pendingLoss: {},
        offenders: [],
        deals: {},
        lost: {},
        granted: {},
        awakened: false,
        awakenDate: -1,
        portsUntil: 0,
        wavesDone: 0,
        nextWave: 0,
        hacked: [],
        droneCursor: 0,
        lastDroneBuy: now,
        lastTechSync: now,
        stats: { researchGranted: 0, theftBoosts: 0, feesPaid: 0, asked: 0, granted: 0, refused: 0, hacked: 0, hacksReleased: 0, portsShut: 0, dronesBuilt: 0, bombs: 0, withdrawals: 0, sanctions: 0, dealsAccepted: 0, dealsDeclined: 0, switches: 0, breakthroughs: 0, breakthroughPoints: 0, threatsRevealed: 0, spiesCaught: 0, freeIntel: 0, fleetsStudied: 0 },
    };
}

/** An Ultramind saved before the per-partner standings: its one mood becomes every partner's standing. */
function migrate(m: UltraMind): UltraMind {
    const old = m as unknown as { standing?: Record<string, number>; request?: unknown; nextRequest?: unknown };
    if (old.standing !== undefined) {
        if ((m as { directive?: Directive }).directive === undefined) {
            m.directive = 'research';
            m.holder = m.partners[0] ?? null;
            m.switchTo = null;
            m.switchUntil = 0;
            m.nextDirectiveReview = 0;
            m.lastSwitch = -1;
            m.nextBreak = {};
            m.nextIntel = {};
            m.granted = {};
            m.stats = { ...m.stats, switches: 0, breakthroughs: 0, breakthroughPoints: 0, threatsRevealed: 0, spiesCaught: 0, freeIntel: 0, fleetsStudied: 0 };
        }
        return m;
    }
    const mood = typeof m.contentment === 'number' ? m.contentment : 60;
    m.standing = {};
    for (const e of m.partners) m.standing[String(e.empireId)] = mood;
    m.nextRequest = {};
    m.requests = {};
    m.ignored = {};
    m.tiers = {};
    m.lastAttackLoss = {};
    m.wars = [];
    m.withdrawn = {};
    m.joinStanding = 60;
    m.pendingLoss = {};
    m.offenders = [];
    m.deals = {};
    m.lost = {};
    m.stats = { ...m.stats, withdrawals: 0, sanctions: 0, dealsAccepted: 0, dealsDeclined: 0 };
    m.directive = 'research';
    m.holder = m.partners[0] ?? null;
    m.switchTo = null;
    m.switchUntil = 0;
    m.nextDirectiveReview = 0;
    m.lastSwitch = -1;
    m.nextBreak = {};
    m.nextIntel = {};
    m.granted = {};
    m.stats = { ...m.stats, switches: 0, breakthroughs: 0, breakthroughPoints: 0, threatsRevealed: 0, spiesCaught: 0, freeIntel: 0, fleetsStudied: 0 };
    return m;
}

/** The Ultramind of `site`, created on first use. */
export function ensureMind(galaxy: Galaxy, site: GreatWorkRecord): UltraMind {
    const st = ultramindState(galaxy);
    let m = st.minds.find((x) => x.site === site);
    if (m === undefined) {
        m = newMind(galaxy, site);
        st.minds.push(m);
    }
    return migrate(m);
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

/** The mood tier of a standing (0 serene .. 4 seething). Pure. */
export function moodTier(contentment: number): number {
    return contentment >= 75 ? 0 : contentment >= 50 ? 1 : contentment >= 30 ? 2 : contentment >= 15 ? 3 : 4;
}

export function moodName(m: UltraMind): string {
    return scenarioText(`${UTAG} Mood ${m.awakened ? 5 : moodTier(m.contentment)}`);
}

export function directiveName(d: Directive): string {
    return scenarioText(`${UTAG} Directive ${d}`);
}

function tierName(t: number): string {
    return scenarioText(`${UTAG} Mood ${t}`);
}

function sid(e: Empire): string {
    return String(e.empireId);
}

/** The Ultramind's standing of `e` (what it would start with when `e` is not a partner). Pure. */
export function standingOf(galaxy: Galaxy, m: UltraMind, e: Empire): number {
    return m.standing[sid(e)] ?? m.joinStanding;
}

/** The partner it holds the lowest standing of (ties by empire id), or null. Pure. */
export function lowestPartner(galaxy: Galaxy, m: UltraMind): Empire | null {
    let best: Empire | null = null;
    for (const e of m.partners) {
        if (!e.active) continue;
        if (best === null || standingOf(galaxy, m, e) < standingOf(galaxy, m, best) || (standingOf(galaxy, m, e) === standingOf(galaxy, m, best) && e.empireId < best.empireId)) best = e;
    }
    return best;
}

/** The overall mood: the lowest standing among its partners (nobody: the start value; awake: nothing). */
function refreshMood(galaxy: Galaxy, m: UltraMind): void {
    if (m.awakened) {
        m.contentment = 0;
        return;
    }
    const low = lowestPartner(galaxy, m);
    m.contentment = low === null ? UP.startContent(galaxy) : standingOf(galaxy, m, low);
}

/** The wonder base carries its mood in its name (the selection panel and the map show it; no menus). */
function renameBase(m: UltraMind): void {
    const b = m.site.base;
    if (b === null || b.hasBeenDestroyed) return;
    const d = m.switchTo !== null ? scenarioText(`${UTAG} Directive Switching`, directiveName(m.switchTo)) : directiveName(m.directive);
    b.name = m.awakened ? scenarioText(`${UTAG} Base Name`, kindName('ultramind'), moodName(m)) : scenarioText(`${UTAG} Base Name Directive`, kindName('ultramind'), moodName(m), d);
}

function tellPartners(galaxy: Galaxy, m: UltraMind, title: string, text: string, type: EmpireMessageType, extra: Empire[] = []): void {
    const seen = new Set<Empire>();
    for (const e of [...m.partners, ...extra]) {
        if (seen.has(e) || !e.active || !human(galaxy, e)) continue;
        seen.add(e);
        scenarioMessage(galaxy, e, title, text, { type, subject: m.site.base ?? m.site.system.systemStar, popup: false });
    }
}

/** The empires the machine is at war with now: the offenders and whoever attacked its base. Pure. */
export function enemiesOf(galaxy: Galaxy, m: UltraMind): Empire[] {
    void m;
    const faction = peekUltramindState(galaxy)?.faction ?? null;
    if (faction === null || !faction.active) return [];
    return ordinaryEmpires(galaxy).filter((e) => e.active && atWar(faction, e));
}

// ---------------------------------------------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------------------------------------------

/** Who holds the contracts now: the beneficiary first, then the nearest empires (not at war with it) within ultramindContractSectors; those who withdrew are not drawn again. Pure. */
export function pickPartners(galaxy: Galaxy, m: UltraMind): Empire[] {
    const out: Empire[] = [];
    const owner = greatWorkBeneficiary(galaxy, m.site);
    const eligible = ordinaryEmpires(galaxy);
    const free = (e: Empire): boolean => m.withdrawn[sid(e)] === undefined;
    if (owner !== null && owner.active && eligible.includes(owner) && free(owner)) out.push(owner);
    const range = sectors(galaxy, UP.contractSectors(galaxy));
    const cands = eligible
        .filter((e) => e !== owner && e.active && free(e) && (owner === null || !atWar(owner, e)))
        .map((e) => ({ e, d: nearestColonyDistance(galaxy, m, e) }))
        .filter((x) => x.d <= range)
        .sort((a, b) => a.d - b.d || a.e.empireId - b.e.empireId);
    for (const c of cands) {
        if (out.length >= UP.contractMax(galaxy)) break;
        out.push(c.e);
    }
    return out;
}

/** The research bonus (%) of `e` before the awakening: the holder's, or a partner's. Pure. */
export function researchPctOf(galaxy: Galaxy, m: UltraMind, e: Empire): number {
    return m.holder === e ? UP.holderResearchPct(galaxy) : UP.partnerResearchPct(galaxy);
}

/** The share of the research bonus in force: all of it under the Research directive, ultramindOtherResearchPct % under another one or while switching. Pure. */
export function researchDirectiveShare(galaxy: Galaxy, m: UltraMind, now: number): number {
    if (m.awakened) return 1;
    return dirNow(m, now) === 'research' ? 1 : UP.otherResearchPct(galaxy) / 100;
}

/** The share of its contract `e` has now: all of it before the awakening, the deal's share after it for a dealer, nothing for anyone else. Pure. */
function contractShare(galaxy: Galaxy, m: UltraMind, e: Empire): number {
    if (!m.awakened) return 1;
    return m.deals[sid(e)] === 'accepted' ? UP.dealPct(galaxy) / 100 : 0;
}

function reviewPartners(galaxy: Galaxy, m: UltraMind, now: number): void {
    const before = m.partners.map((e) => e.empireId).join(',');
    const picked = pickPartners(galaxy, m);
    for (const e of m.partners) {
        if (picked.includes(e)) continue;
        const k = sid(e);
        delete m.standing[k];
        delete m.nextRequest[k];
        delete m.requests[k];
        delete m.ignored[k];
        delete m.tiers[k];
        m.wars = m.wars.filter((w) => w.aggressor !== e && w.victim !== e);
    }
    let joined = false;
    for (const e of picked) {
        const k = sid(e);
        if (m.standing[k] !== undefined) continue;
        m.standing[k] = Math.max(1, Math.min(100, m.joinStanding - (m.pendingLoss[k] ?? 0)));
        delete m.pendingLoss[k];
        m.tiers[k] = moodTier(m.standing[k]);
        joined = true;
    }
    if (joined && picked.length > 0) m.joinStanding = UP.startContent(galaxy);
    m.partners = picked;
    const ben = greatWorkBeneficiary(galaxy, m.site);
    m.holder = ben !== null && picked.includes(ben) ? ben : null;
    m.lastReview = now;
    refreshMood(galaxy, m);
    const after = m.partners.map((e) => e.empireId).join(',');
    if (before === after) return;
    logGw(galaxy, now, `ultramind ${m.site.id}: contracts with ${m.partners.map((e) => e.name).join(', ') || 'nobody'}`);
    if (m.partners.length > 0) {
        const holder = m.holder;
        tellPartners(galaxy, m, scenarioText(`${UTAG} Contract Title`), scenarioText(`${UTAG} Contract`, m.partners.map((e) => e.name).join(', '), UP.holderResearchPct(galaxy), UP.partnerResearchPct(galaxy), holder?.name ?? ''), EmpireMessageType.GeneralGoodEvent);
    }
}

/** Research contracts: each partner gets a share of its own output on top, in proportion to the time passed (the holder's rate, or a partner's; a dealer's share after the awakening). */
function runContracts(galaxy: Galaxy, m: UltraMind, years: number, now: number): void {
    const owner = m.holder;
    for (const e of m.partners) {
        if (!e.active) continue;
        const share = contractShare(galaxy, m, e);
        if (share <= 0) continue;
        const pct = (researchPctOf(galaxy, m, e) / 100) * share * researchDirectiveShare(galaxy, m, now);
        const pts = grantResearchPoints(galaxy, e, pct * researchPerYear(galaxy, e) * years);
        m.stats.researchGranted += pts;
        (m.granted[sid(e)] ??= { flat: 0, breakthrough: 0 }).flat += pts;
        if (e !== owner) {
            const fee = (UP.feePct(galaxy) / 100) * share * Math.max(0, annualIncome(galaxy, e)) * years;
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

/** An empire leaves its contract (`withdrew`: its own choice, `declined`: it turned the deal down, `sanctioned`: the Diet ended it). It is not drawn again, and not at war with the machine unless it attacks. */
export function withdrawFromContract(galaxy: Galaxy, m: UltraMind, e: Empire, why: WithdrawWhy): boolean {
    if (!m.partners.includes(e)) return false;
    const now = galaxyStarDate(galaxy);
    const k = sid(e);
    m.partners = m.partners.filter((x) => x !== e);
    delete m.standing[k];
    delete m.nextRequest[k];
    delete m.requests[k];
    delete m.ignored[k];
    delete m.tiers[k];
    delete m.deals[k];
    m.wars = m.wars.filter((w) => w.aggressor !== e && w.victim !== e);
    m.withdrawn[k] = { date: now, why };
    if (why === 'sanctioned') m.stats.sanctions++;
    else if (why === 'withdrew') m.stats.withdrawals++;
    logGw(galaxy, now, `ultramind ${m.site.id}: ${e.name} ${why === 'withdrew' ? 'withdraws from' : why === 'declined' ? 'declines the deal and leaves' : 'is put out of'} the contracts`);
    if (human(galaxy, e)) scenarioMessage(galaxy, e, scenarioText(`${UTAG} Withdrawn Title`), scenarioText(`${UTAG} Withdrawn ${why}`), { type: EmpireMessageType.GeneralNeutralEvent, subject: m.site.base ?? m.site.system.systemStar, popup: false });
    if (!m.awakened) checkMood(galaxy, m, now, false);
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Requests (the scenario decision pop-up)
// ---------------------------------------------------------------------------------------------------------------

const REQUEST_WEIGHT: Record<RequestKind, number> = { power: 3, network: 2, moon: 1.5, philosopher: 1.5, fleet: 0 };
/** What each directive asks for (the request matching it is four times as likely; War also asks for a fleet to study). */
const DIRECTIVE_ASK: Record<Directive, RequestKind> = { research: 'philosopher', war: 'fleet', economy: 'power', intelligence: 'network' };

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

/** The warships the fleet request would take from `e`: the smallest ultramindFleetShips of them (ties by id), none unless it has more than that. Pure. */
export function fleetCandidates(galaxy: Galaxy, e: Empire): BuiltObject[] {
    const ships = e.builtObjects.filter((b) => !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military && b.topSpeed > 0 && b.actualEmpire === e);
    const n = UP.fleetShips(galaxy);
    if (ships.length <= n) return [];
    return ships.sort((a, b) => a.size - b.size || a.builtObjectID - b.builtObjectID).slice(0, n);
}

function availableKinds(galaxy: Galaxy, m: UltraMind, e: Empire): RequestKind[] {
    const out: RequestKind[] = ['power', 'network'];
    if (moonCandidate(galaxy, m, e) !== null) out.push('moon');
    if (philosopherCandidate(e) !== null) out.push('philosopher');
    if (m.directive === 'war' && fleetCandidates(galaxy, e).length > 0) out.push('fleet');
    return out;
}

function kindWeight(m: UltraMind, k: RequestKind): number {
    if (k === 'fleet') return 6;
    return REQUEST_WEIGHT[k] * (DIRECTIVE_ASK[m.directive] === k ? 4 : 1);
}

function pickKind(galaxy: Galaxy, m: UltraMind, e: Empire): RequestKind {
    let kinds = availableKinds(galaxy, m, e);
    const last = m.askedKinds[m.askedKinds.length - 1];
    if (kinds.length > 1) kinds = kinds.filter((k) => k !== last);
    const total = kinds.reduce((a, k) => a + kindWeight(m, k), 0);
    let r = nextRandom(galaxy).nextDouble() * total;
    for (const k of kinds) {
        r -= kindWeight(m, k);
        if (r < 0) return k;
    }
    return kinds[kinds.length - 1];
}

/** Who answers a request nobody named: the beneficiary, else the first partner. */
function addressee(galaxy: Galaxy, m: UltraMind): Empire | null {
    const b = m.holder;
    if (b !== null && b.active && m.partners.includes(b)) return b;
    return m.partners.find((e) => e.active) ?? null;
}

/** When `e` is asked next: ultramindAskMin..Max years from `now` (the holder's pace; the other partners wait ultramindPartnerAskMult times as long). */
function nextAskDate(galaxy: Galaxy, m: UltraMind, e: Empire, now: number): number {
    const span = Math.max(0, UP.askMaxYears(galaxy) - UP.askMinYears(galaxy));
    const mult = m.holder === e ? 1 : Math.max(0.1, UP.partnerAskMult(galaxy));
    return now + (UP.askMinYears(galaxy) + nextRandom(galaxy).nextDouble() * span) * YEAR_LENGTH * mult;
}

/** The Ultramind asks `who` (default its addressee) for something (`forced`: a given kind, the tests). The answer comes through resolveRequest. */
export function raiseRequest(galaxy: Galaxy, m: UltraMind, now: number, forced?: RequestKind, who?: Empire): void {
    const e = who ?? addressee(galaxy, m);
    if (e === null || !m.partners.includes(e)) return;
    const k = sid(e);
    if (m.requests[k] !== undefined) return;
    const kind = forced ?? pickKind(galaxy, m, e);
    const cost = kind === 'power' ? powerCost(galaxy, e) : 0;
    const seq = ++m.requestSeq;
    m.requests[k] = { seq, kind, empire: e, date: now, cost };
    m.askedKinds.push(kind);
    if (m.askedKinds.length > 8) m.askedKinds.shift();
    m.stats.asked++;
    const moon = kind === 'moon' ? moonCandidate(galaxy, m, e) : null;
    const phil = kind === 'philosopher' ? philosopherCandidate(e) : null;
    const arg = kind === 'power' ? fmt(cost) : kind === 'moon' ? (moon?.name ?? '') : kind === 'philosopher' ? (phil?.name ?? '') : kind === 'fleet' ? String(UP.fleetShips(galaxy)) : String(UP.exposeYears(galaxy));
    const st = standingOf(galaxy, m, e);
    logGw(galaxy, now, `ultramind ${m.site.id} asks ${e.name} for ${kind}${kind === 'power' ? ` (${fmt(cost)})` : ''}, standing ${st.toFixed(0)}`);
    raiseScenarioDecision(galaxy, e, {
        kind: DECISION_KIND,
        title: scenarioText(`${UTAG} Ask Title`),
        text: scenarioText(`${UTAG} Ask ${kind}`, arg, tierName(moodTier(st))) + '\n\n' + scenarioText(`${UTAG} Ask Stakes`, Math.round(st), UP.grantGain(galaxy), UP.refuseLoss(galaxy)),
        options: [
            { id: 'grant', label: scenarioText(`${UTAG} Grant ${kind}`, arg) },
            { id: 'refuse', label: scenarioText(`${UTAG} Refuse`) },
        ],
        defaultOption: 'refuse',
        expiresDays: UP.askExpireDays(galaxy),
        context: { siteId: m.site.id, seq, kind, empireId: e.empireId, habitat: moon !== null ? galaxy.habitats.indexOf(moon) : -1 },
    });
}

/** The AI's answer: friendly and cautious empires comply, aggressive ones refuse; an unhappy Ultramind and a cheap request tip it. Pure. */
export function aiAnswer(galaxy: Galaxy, m: UltraMind, e: Empire, kind: RequestKind, seq: number): 'grant' | 'refuse' {
    const pr = personality(e);
    const base: Record<RequestKind, number> = { power: 0, network: -0.25, moon: -0.55, philosopher: -0.2, fleet: -0.45 };
    let score = base[kind] + 0.5 * pr.friendly - 0.4 * pr.aggression + 0.3 * pr.caution + 0.6 * (1 - standingOf(galaxy, m, e) / 100);
    if (kind === 'power' && e.stateMoney + 0.25 * Math.max(0, annualIncome(galaxy, e)) < powerCost(galaxy, e)) score -= 0.5; // cannot afford it
    if (standingOf(galaxy, m, e) <= UP.refuseLoss(galaxy)) score += 0.8; // another refusal would wake it: self-preservation
    score += (hash01(e.empireId, seq * 31 + m.site.id) - 0.5) * 0.5;
    return score > 0 ? 'grant' : 'refuse';
}

function resolveRequest(galaxy: Galaxy, d: ScenarioDecision, optionId: string): void {
    const siteId = d.context.siteId;
    const m = peekUltramindState(galaxy)?.minds.find((x) => x.site.id === siteId) ?? null;
    if (m === null) return;
    const e = d.empire;
    const k = sid(e);
    const req = m.requests[k];
    if (req === undefined || req.seq !== d.context.seq) return;
    delete m.requests[k];
    const now = galaxyStarDate(galaxy);
    if (m.awakened || m.site.phase !== 'complete' || !m.partners.includes(e)) return;
    m.nextRequest[k] = nextAskDate(galaxy, m, e, now);
    let granted = optionId === 'grant';
    if (granted) granted = applyGrant(galaxy, m, e, req, d);
    if (granted) {
        gainStanding(galaxy, m, e, UP.grantGain(galaxy), 'granted');
        m.ignored[k] = 0;
        m.stats.granted++;
    } else {
        lose(galaxy, m, e, UP.refuseLoss(galaxy), 'refused');
        m.ignored[k] = Math.min(UP.ignoredMax(galaxy), (m.ignored[k] ?? 0) + 1);
        m.stats.refused++;
    }
    logGw(galaxy, now, `ultramind ${m.site.id}: ${e.name} ${granted ? 'grants' : 'refuses'} ${req.kind} (${d.answeredBy ?? '?'}), standing ${standingOf(galaxy, m, e).toFixed(0)}`);
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
        case 'fleet': {
            const ships = fleetCandidates(galaxy, e);
            if (ships.length === 0) return false;
            for (const b of ships) builtObjectCompleteTeardown(galaxy, b); // studied, and dismantled in the study
            m.stats.fleetsStudied += ships.length;
            return true;
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Standing (the grudge book)
// ---------------------------------------------------------------------------------------------------------------

function note(m: UltraMind, e: Empire, cause: string, amount: number): void {
    const rec = (m.lost[sid(e)] ??= {});
    rec[cause] = (rec[cause] ?? 0) + amount;
}

/** Standing lost by one partner, never below nothing. Quiet (no log, no mood check). */
function lose(galaxy: Galaxy, m: UltraMind, e: Empire, amount: number, cause: string): void {
    const k = sid(e);
    if (amount <= 0 || m.standing[k] === undefined) return;
    const was = m.standing[k];
    m.standing[k] = Math.max(0, was - amount);
    note(m, e, cause, was - m.standing[k]);
    refreshMood(galaxy, m);
}

function gainStanding(galaxy: Galaxy, m: UltraMind, e: Empire, amount: number, cause: string): void {
    const k = sid(e);
    if (amount <= 0 || m.standing[k] === undefined) return;
    const was = m.standing[k];
    m.standing[k] = Math.min(100, was + amount);
    note(m, e, cause, -(m.standing[k] - was));
    refreshMood(galaxy, m);
}

/** An abuse by one partner: its standing falls (a partner only: nobody else holds it against anyone else). Events never wake it, they wait for the next step. */
function addLoss(galaxy: Galaxy, m: UltraMind, e: Empire, amount: number, why: string, cause: string): void {
    if (m.awakened || amount <= 0 || m.standing[sid(e)] === undefined) return;
    lose(galaxy, m, e, amount, cause);
    logGw(galaxy, galaxyStarDate(galaxy), `ultramind ${m.site.id}: ${e.name} -${amount.toFixed(1)} (${why}), standing ${standingOf(galaxy, m, e).toFixed(0)}`);
    checkMood(galaxy, m, galaxyStarDate(galaxy), false);
}

/** Updates the announced moods; `wake` (the periodic step): a partner at nothing awakens it. */
function checkMood(galaxy: Galaxy, m: UltraMind, now: number, wake = true): void {
    if (m.awakened) return;
    refreshMood(galaxy, m);
    const dead = m.partners.some((e) => e.active && standingOf(galaxy, m, e) <= 0);
    if (dead && wake) {
        awaken(galaxy, m, now);
        return;
    }
    for (const e of m.partners) {
        const k = sid(e);
        const st = standingOf(galaxy, m, e);
        const t = st <= 0 ? 4 : moodTier(st);
        const prev = m.tiers[k];
        m.tiers[k] = t;
        if (prev === undefined || prev === t) continue;
        tellPartners(galaxy, m, scenarioText(`${UTAG} Mood Title`), scenarioText(`${UTAG} Mood Changed`, e.name, tierName(t), Math.round(st)), t > prev ? EmpireMessageType.GeneralWarning : EmpireMessageType.GeneralGoodEvent);
    }
    const overall = dead ? 4 : moodTier(m.contentment);
    if (overall !== m.tier) {
        m.tier = overall;
        renameBase(m);
    }
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

function ensureFaction(galaxy: Galaxy, m: UltraMind, enemies: Empire[]): Empire | null {
    const st = ultramindState(galaxy);
    if (st.faction !== null && st.faction.active) return st.faction;
    const race = machineRace(galaxy, m);
    if (race === null) return null;
    const faction = createThreatFaction(galaxy, { race, name: scenarioText(`${UTAG} Faction Name`), enemies: enemies.filter((e) => e.active) });
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

/**
 * The partners whose standing has collapsed (below ultramindOffenderBelow): the empires it turns on. Pure.
 */
export function offendersOf(galaxy: Galaxy, m: UltraMind): Empire[] {
    return m.partners.filter((e) => e.active && standingOf(galaxy, m, e) < UP.offenderBelow(galaxy));
}

/** `offenders` (default: offendersOf) are at war with the machine for good; the other partners stay neutral and are offered a deal. */
export function awaken(galaxy: Galaxy, m: UltraMind, now: number, offenders: Empire[] = offendersOf(galaxy, m)): void {
    const site = m.site;
    const neutrals = m.partners.filter((e) => e.active && !offenders.includes(e));
    markGreatWorkHostile(site); // before the base changes hands: destroying or seizing it is no crime (actions.ts onOwnerChanged)
    const faction = ensureFaction(galaxy, m, offenders);
    m.awakened = true;
    m.awakenDate = now;
    m.tier = 5;
    m.offenders = offenders.filter((e) => e.active);
    m.partners = neutrals;
    m.requests = {};
    m.deals = {};
    refreshMood(galaxy, m);
    site.awakened = true;
    if (faction !== null) {
        for (const e of m.offenders) if (!atWar(faction, e)) lockWar(galaxy, faction, e);
        if (site.base !== null && !site.base.hasBeenDestroyed) flipToFaction(galaxy, site.base, faction);
        for (const g of site.guards) if (!g.hasBeenDestroyed) flipToFaction(galaxy, g, faction);
        site.guards = [];
        for (const b of faction.builtObjects) b.supportCostFactor = 0;
    }
    renameBase(m);
    scenarioNews(galaxy, null, scenarioText(`${UTAG} Awakens News`, m.offenders.map((e) => e.name).join(', ') || kindName('ultramind'), site.system.systemStar.name), () => true, site.base ?? site.system.systemStar);
    for (const e of m.offenders) {
        if (human(galaxy, e)) scenarioMessage(galaxy, e, scenarioText(`${UTAG} Awakens Title`), scenarioText(`${UTAG} Awakens`, site.system.systemStar.name), { type: EmpireMessageType.GeneralBadEvent, subject: site.base ?? site.system.systemStar });
    }
    logGw(galaxy, now, `ultramind ${site.id} AWAKENS (faction ${faction?.name ?? 'none'}), at war with ${m.offenders.map((e) => `${e.name} (${standingOf(galaxy, m, e).toFixed(0)})`).join(', ') || 'nobody'}, neutral ${neutrals.map((e) => e.name).join(', ') || 'nobody'}`);
    for (const e of neutrals) offerDeal(galaxy, m, e);
    m.nextWave = now;
    m.wavesDone = 0;
    m.lastDroneBuy = now;
    awakeStep(galaxy, m, now);
    if (faction !== null && faction.active) buyDrones(galaxy, m, faction, Math.max(0, UP.drones(galaxy) - droneCount(m, faction)));
}

// --- the deal offered to the partners it spared ---

/** The AI's answer to the deal: peaceful and cautious empires take it, those allied with an offender do not; the holder wants its bonus. Pure. */
export function aiDealAnswer(galaxy: Galaxy, m: UltraMind, e: Empire): 'contain' | 'decline' {
    const pr = personality(e);
    let s = 0.25 + 0.3 * pr.caution + 0.2 * pr.friendly;
    for (const o of m.offenders) {
        const rel = e.diplomaticRelations.byEmpire(o)?.type;
        if (rel === DiplomaticRelationType.War) s += 0.5;
        else if (rel === DiplomaticRelationType.MutualDefensePact || rel === DiplomaticRelationType.Protectorate) s -= 0.9;
        else if (rel === DiplomaticRelationType.FreeTradeAgreement) s -= 0.3;
    }
    if (m.holder === e) s += 0.3;
    s += (hash01(e.empireId, m.site.id * 7 + 3) - 0.5) * 0.4;
    return s > 0 ? 'contain' : 'decline';
}

function offerDeal(galaxy: Galaxy, m: UltraMind, e: Empire): void {
    m.deals[sid(e)] = 'pending';
    const names = m.offenders.map((o) => o.name).join(', ');
    raiseScenarioDecision(galaxy, e, {
        kind: DEAL_KIND,
        title: scenarioText(`${UTAG} Deal Title`),
        text: scenarioText(`${UTAG} Deal`, m.site.system.systemStar.name, names, UP.dealPct(galaxy)),
        options: [
            { id: 'contain', label: scenarioText(`${UTAG} Deal Contain`, names) },
            { id: 'decline', label: scenarioText(`${UTAG} Deal Decline`) },
        ],
        defaultOption: 'decline',
        expiresDays: UP.dealExpireDays(galaxy),
        context: { siteId: m.site.id, empireId: e.empireId },
    });
}

function resolveDeal(galaxy: Galaxy, d: ScenarioDecision, optionId: string): void {
    const siteId = d.context.siteId;
    const m = peekUltramindState(galaxy)?.minds.find((x) => x.site.id === siteId) ?? null;
    if (m === null) return;
    const e = d.empire;
    const k = sid(e);
    if (m.deals[k] !== 'pending' || !m.awakened || !m.partners.includes(e)) return;
    const now = galaxyStarDate(galaxy);
    if (optionId === 'contain') {
        m.deals[k] = 'accepted';
        m.stats.dealsAccepted++;
        let sanctioned = 0;
        for (const o of m.offenders) {
            if (!o.active) continue;
            imposeSanctions(galaxy, e, o);
            sanctioned++;
        }
        logGw(galaxy, now, `ultramind ${m.site.id}: ${e.name} accepts the deal (${d.answeredBy ?? '?'}), sanctions on ${sanctioned} offenders`);
        if (human(galaxy, e)) scenarioMessage(galaxy, e, scenarioText(`${UTAG} Deal Kept Title`), scenarioText(`${UTAG} Deal Kept`, UP.dealPct(galaxy)), { type: EmpireMessageType.GeneralGoodEvent, popup: false });
    } else {
        m.stats.dealsDeclined++;
        withdrawFromContract(galaxy, m, e, 'declined');
    }
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

/** One hacking wave: up to `n` warships of the empires it is at war with, those nearest the site first; each roll is cut by a Logic Bomb. Returns the ships taken. */
export function hackWave(galaxy: Galaxy, m: UltraMind, n: number): number {
    const faction = ultramindState(galaxy).faction;
    if (faction === null || !faction.active || n <= 0) return 0;
    const reach = sectors(galaxy, UP.hackSectors(galaxy));
    const cands: { b: BuiltObject; e: Empire; d: number }[] = [];
    for (const e of enemiesOf(galaxy, m)) {
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

/** True while the machine's strength (drones and hacked ships) is below ultramindDroneCapPct % of the strongest enemy's and it has fewer than ultramindDroneMax drones. */
function wantsDrone(galaxy: Galaxy, m: UltraMind, faction: Empire): boolean {
    if (droneCount(m, faction) >= UP.droneMax(galaxy)) return false;
    let strongest = 0;
    for (const e of enemiesOf(galaxy, m)) strongest = Math.max(strongest, militaryPotency(e));
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
    // The war is the offenders' (and anyone who attacked the base): the partners in good standing are left alone.
    for (const e of m.offenders) if (e.active && !atWar(faction, e)) lockWar(galaxy, faction, e);
    if (m.wavesDone <= UP.hackWaves(galaxy) && now >= m.nextWave) {
        const n = m.wavesDone === 0 ? UP.hackShips(galaxy) : Math.max(1, Math.round(UP.hackShips(galaxy) / 2));
        const took = hackWave(galaxy, m, n);
        shutPorts(galaxy, m, now);
        const first = m.wavesDone === 0;
        m.wavesDone++;
        m.nextWave = now + UP.hackDays(galaxy) * GAME_DAY_LENGTH;
        logGw(galaxy, now, `ultramind ${m.site.id}: wave ${m.wavesDone} hacks ${took} ships, ports shut to ${((m.portsUntil - now) / GAME_DAY_LENGTH).toFixed(0)} days`);
        for (const e of enemiesOf(galaxy, m)) {
            const c = m.hacked.filter((h) => h.from === e && h.date === now).length;
            if (c > 0 && human(galaxy, e)) scenarioMessage(galaxy, e, scenarioText(`${UTAG} Hack Title`), scenarioText(`${UTAG} Hack`, c), { type: EmpireMessageType.GeneralBadEvent, subject: m.site.base ?? m.site.system.systemStar });
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
// Logic Bomb (the counter-project) and the withdrawal
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

function withdrawTarget(galaxy: Galaxy, e: Empire, target: unknown): UltraMind | null {
    const m = mindOfBase(galaxy, target);
    if (m === null || m.site.phase !== 'complete' || !e.active || !m.partners.includes(e)) return null;
    return m;
}

/** Whether an AI partner in danger leaves its contract: cautious, peaceful empires do; aggressive ones stay and bomb; the holder is loath to give up the bigger bonus. Pure. */
export function aiWouldWithdraw(galaxy: Galaxy, m: UltraMind, e: Empire): boolean {
    const pr = personality(e);
    let s = 0.3 - 0.6 * pr.aggression + 0.5 * pr.caution;
    if (m.holder === e) s -= 0.6;
    s += (hash01(e.empireId, m.site.id * 13 + 5) - 0.5) * 0.3;
    return s > 0;
}

/** AI partners prepare when their own standing turns dangerous (a Logic Bomb; withdrawing from the contract when it is nearly gone), and an empire at war with the machine bombs at once. */
function aiPartners(galaxy: Galaxy, m: UltraMind): void {
    if (m.awakened) {
        for (const e of enemiesOf(galaxy, m)) {
            if (human(galaxy, e) || m.bombs[sid(e)] !== undefined) continue;
            deployLogicBomb(galaxy, e, m);
        }
        return;
    }
    for (const e of [...m.partners]) {
        if (!e.active || human(galaxy, e)) continue;
        const s = standingOf(galaxy, m, e);
        if (s > UP.aiWatchBelow(galaxy)) continue;
        if (m.bombs[sid(e)] === undefined) deployLogicBomb(galaxy, e, m); // (it refuses when the empire cannot find the money)
        if (s <= UP.aiWithdrawBelow(galaxy) && aiWouldWithdraw(galaxy, m, e)) withdrawFromContract(galaxy, m, e, 'withdrew');
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The periodic step (kind.periodic)
// ---------------------------------------------------------------------------------------------------------------

/** The yearly drift of one partner's standing: boredom, faster for the holder (the price of its bigger bonus), faster still while it ignores the requests. Pure. */
export function driftPerYear(galaxy: Galaxy, m: UltraMind, e: Empire): number {
    const base = UP.driftPerYear(galaxy);
    if (m.holder !== e) return base;
    return base * UP.holderDriftMult(galaxy) + UP.ignoredDriftPerYear(galaxy) * (m.ignored[sid(e)] ?? 0);
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
        runContracts(galaxy, m, years, now);
        aiPartners(galaxy, m);
        return;
    }
    if (m.lastReview < 0 || now - m.lastReview >= YEAR_LENGTH) reviewPartners(galaxy, m, now);
    runContracts(galaxy, m, years, now);
    runDirectives(galaxy, m, now);
    aiDirective(galaxy, m, now);
    for (const e of m.partners) lose(galaxy, m, e, driftPerYear(galaxy, m, e) * years, 'drift');
    // A war between partners costs only the one that began it, for as long as it lasts.
    m.wars = m.wars.filter((w) => w.aggressor.active && w.victim.active && m.partners.includes(w.aggressor) && m.partners.includes(w.victim) && atWar(w.aggressor, w.victim));
    for (const w of m.wars) lose(galaxy, m, w.aggressor, UP.warLossPerYear(galaxy) * years, 'war');
    for (const k of Object.keys(m.exposedUntil)) if (m.exposedUntil[k] <= now) delete m.exposedUntil[k];
    for (const e of m.partners) {
        if (!e.active) continue;
        const k = sid(e);
        if (m.nextRequest[k] === undefined) m.nextRequest[k] = nextAskDate(galaxy, m, e, now);
        if (m.requests[k] === undefined && now >= m.nextRequest[k]) raiseRequest(galaxy, m, now, undefined, e);
    }
    aiPartners(galaxy, m);
    checkMood(galaxy, m, now);
}

function ultramindComplete(galaxy: Galaxy, site: GreatWorkRecord): void {
    const m = ensureMind(galaxy, site);
    const now = galaxyStarDate(galaxy);
    site.awakened = false;
    reviewPartners(galaxy, m, now);
    renameBase(m);
    logGw(galaxy, now, `ultramind ${site.id} complete: partners ${m.partners.map((e) => e.name).join(', ') || 'none'}, standing ${m.contentment.toFixed(0)}`);
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
    m.offenders = [];
    m.deals = {};
    m.requests = {};
    m.wars = [];
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
        // Whoever strikes the machine is at war with it (the base and the drones answer), a spared partner too: its deal is off.
        const faction = ultramindState(galaxy).faction;
        if (faction !== null && faction.active && attacker !== faction && attacker.active && attacker !== galaxy.independentEmpire && attacker.pirateEmpireBaseHabitat === null && !atWar(faction, attacker)) {
            lockWar(galaxy, faction, attacker);
            if (m.partners.includes(attacker)) {
                const k = sid(attacker);
                m.partners = m.partners.filter((x) => x !== attacker);
                delete m.deals[k];
                m.offenders.push(attacker);
                logGw(galaxy, now, `ultramind ${m.site.id}: ${attacker.name} attacked it and breaks its deal`);
            }
        }
        return;
    }
    const k = sid(attacker);
    const last = m.lastAttackLoss[k];
    if (last !== undefined && now - last < 20 * GAME_DAY_LENGTH) return;
    m.lastAttackLoss[k] = now;
    addLoss(galaxy, m, attacker, UP.attackLoss(galaxy), `attacked by ${attacker.name}`, 'attack');
}

/** A war declared: between two partners the aggressor (the stock event's `empire`) loses standing, the victim nothing. A declaration against an aggressor already on record is the answer to it (an ally joining) and costs nothing. */
function onWarDeclared(galaxy: Galaxy, aggressor: Empire, victim: Empire | null): void {
    if (victim === null) return;
    const st = peekUltramindState(galaxy);
    if (st === null) return;
    const now = galaxyStarDate(galaxy);
    for (const m of st.minds) {
        if (m.awakened || m.site.phase !== 'complete' || !m.partners.includes(aggressor) || !m.partners.includes(victim)) continue;
        if (m.wars.some((w) => w.aggressor === victim)) continue;
        if (!m.wars.some((w) => w.aggressor === aggressor && w.victim === victim)) m.wars.push({ aggressor, victim, since: now });
        addLoss(galaxy, m, aggressor, UP.warDeclareLoss(galaxy), `declared war on ${victim.name}`, 'war');
    }
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
    addLoss(galaxy, m, empire, UP.sabotageLoss(galaxy), `sabotaged by ${empire.name}`, 'sabotage');
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
        // Boarded: the machine loses its anchor. It falls back to a sullen content under its new holder; everyone starts afresh.
        releaseMachine(galaxy, m, `taken by ${to.name}`);
        m.awakened = false;
        m.site.awakened = false;
        markGreatWorkHostile(m.site, false);
        m.partners = [];
        m.standing = {};
        m.tiers = {};
        m.requests = {};
        m.nextRequest = {};
        m.ignored = {};
        m.offenders = [];
        m.deals = {};
        m.wars = [];
        m.withdrawn = {};
        m.pendingLoss = {};
        m.joinStanding = 30;
        m.tier = moodTier(30);
        m.contentment = 30;
        m.lastReview = -1;
        m.bombs = {};
        scenarioNews(galaxy, null, scenarioText(`${UTAG} Subdued News`, to.name, m.site.system.systemStar.name), () => true, bo);
    } else {
        // Seized: it is the seizer that pays, now if it is a partner, else the moment it joins the contracts.
        const k = sid(to);
        if (m.standing[k] !== undefined) addLoss(galaxy, m, to, UP.seizedLoss(galaxy), `seized by ${to.name}`, 'seized');
        else m.pendingLoss[k] = (m.pendingLoss[k] ?? 0) + UP.seizedLoss(galaxy);
        m.lastReview = -1;
    }
    renameBase(m);
}

function atWarWithMachine(galaxy: Galaxy, e: Empire | null): boolean {
    const faction = peekUltramindState(galaxy)?.faction ?? null;
    return faction !== null && faction.active && e !== null && e !== faction && atWar(faction, e);
}

function freightBlocked(galaxy: Galaxy, bo: BuiltObject): boolean {
    if (bo.role !== BuiltObjectRole.Freight || !isPrivateDesignSubRole(bo.subRole)) return false;
    const st = peekUltramindState(galaxy);
    if (st === null || !atWarWithMachine(galaxy, bo.actualEmpire ?? null)) return false;
    for (const m of st.minds) if (m.awakened && m.site.phase === 'complete' && dist(galaxy, m, bo) <= sectors(galaxy, UP.freightSectors(galaxy))) return true;
    return false;
}

/** The ports (and construction queues) within range stay dark for the empires the machine is at war with only. */
function portsShut(galaxy: Galaxy, x: number, y: number, owner: Empire | null): boolean {
    const st = peekUltramindState(galaxy);
    if (st === null || st.faction === null || owner === null || owner === st.faction || !atWarWithMachine(galaxy, owner)) return false;
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
// Directives: what the holder has the Ultramind work on (one at a time)
// ---------------------------------------------------------------------------------------------------------------
//   Research      the research bonus in full (+holder / +partner %) and, now and then, a breakthrough: the current project of one
//                 industry is completed outright. Under any other directive (and while switching) the bonus is ultramindOtherResearchPct %.
//   War           battle computing (the empire's warships within ultramindWarBattleSectors of the Ultramind get targeting and
//                 countermeasures bonuses: captainBonuses) and early warning (hostile warships in the holder's territory or near the
//                 Ultramind are seen: objectVisibleToAll).
//   Economy       forecasting (tax and trade income), faster construction, cheaper ships and design optimisation (lower upkeep).
//   Intelligence  threat detection (hidden threats near it, and the holder's own, are confirmed to the holder: revealTo), code-cracking
//                 (counter-intelligence is stronger, now and then an enemy spy is caught, a rival's maps are read for free).
// The partners get ultramindDirectivePartnerPct % of every effect (and of its range and rate). Switching takes ultramindSwitchDays with
// no directive working. Only the holder sets it (a threat action on the base, also the selection panel's row); an AI holder reviews
// it every ultramindAiDirectiveDays by personality and situation.

/** The directive working at `now` (null: it is being switched). Pure. */
export function dirNow(m: UltraMind, now: number): Directive | null {
    const to = m.switchTo ?? null;
    if (to !== null) return now >= m.switchUntil ? to : null;
    return m.directive ?? 'research';
}

export interface DirectiveEffect {
    m: UltraMind;
    dir: Directive;
    /** 1 for the holder, ultramindDirectivePartnerPct / 100 for a partner. */
    k: number;
}

/** The directive effect `e` enjoys now (null: none). Cheap enough for the per-ship / per-colony queries. Pure. */
export function directiveEffect(galaxy: Galaxy, e: Empire | null): DirectiveEffect | null {
    if (e === null) return null;
    const st = peekThreatState<UltramindState>(galaxy, ULTRAMIND_KEY);
    if (st === null || st.minds.length === 0) return null;
    const now = galaxyStarDate(galaxy);
    for (const m of st.minds) {
        if (m.awakened || m.site.phase !== 'complete' || m.partners.length === 0) continue;
        const dir = dirNow(m, now);
        if (dir === null) continue;
        if (m.holder === e) return { m, dir, k: 1 };
        if (m.partners.includes(e)) return { m, dir, k: UP.directivePartnerPct(galaxy) / 100 };
    }
    return null;
}

/** The holder sets (or changes) the directive: it takes ultramindSwitchDays, with no directive working in between. */
export function setDirective(galaxy: Galaxy, m: UltraMind, e: Empire, d: Directive): boolean {
    if (m.holder !== e || m.awakened || m.site.phase !== 'complete' || !DIRECTIVES.includes(d)) return false;
    if (m.switchTo === d || (m.switchTo === null && m.directive === d)) return false;
    const now = galaxyStarDate(galaxy);
    m.switchTo = d;
    m.switchUntil = now + UP.switchDays(galaxy) * GAME_DAY_LENGTH;
    m.stats.switches++;
    logGw(galaxy, now, `ultramind ${m.site.id}: ${e.name} switches it from ${m.directive} to ${d} (${UP.switchDays(galaxy)} days)`);
    if (human(galaxy, e)) scenarioMessage(galaxy, e, scenarioText(`${UTAG} Directive Title`), scenarioText(`${UTAG} Directive Switching Text`, directiveName(d), UP.switchDays(galaxy)), { type: EmpireMessageType.GeneralNeutralEvent, subject: m.site.base ?? m.site.system.systemStar, popup: false });
    renameBase(m);
    return true;
}

function finishSwitch(galaxy: Galaxy, m: UltraMind, now: number): void {
    if (m.switchTo === null || now < m.switchUntil) return;
    m.directive = m.switchTo;
    m.switchTo = null;
    m.lastSwitch = now;
    m.nextBreak = {};
    m.nextIntel = {};
    logGw(galaxy, now, `ultramind ${m.site.id}: now working on ${m.directive}`);
    tellPartners(galaxy, m, scenarioText(`${UTAG} Directive Title`), scenarioText(`${UTAG} Directive Set`, directiveName(m.directive)), EmpireMessageType.GeneralGoodEvent);
    renameBase(m);
}

/** What the selection panel shows of the directive of the Ultramind whose base is `bo` (null: not an Ultramind). `canChange`: `viewer` is its holder. Pure. */
export interface DirectiveView {
    current: Directive;
    switchingTo: Directive | null;
    daysLeft: number;
    canChange: boolean;
    awakened: boolean;
    /** `action`: the threat action kind that sets it (null: it cannot be set now). */
    options: { id: Directive; name: string; tip: string; state: 'current' | 'switching' | 'choice'; action: string | null }[];
}

export function directiveView(galaxy: Galaxy, bo: unknown, viewer: Empire | null): DirectiveView | null {
    const m = mindOfBase(galaxy, bo);
    if (m === null || m.site.phase !== 'complete') return null;
    const now = galaxyStarDate(galaxy);
    const pending = m.switchTo ?? null;
    return {
        current: m.directive,
        switchingTo: pending,
        daysLeft: pending === null ? 0 : Math.max(0, Math.ceil((m.switchUntil - now) / GAME_DAY_LENGTH)),
        canChange: !m.awakened && viewer !== null && m.holder === viewer,
        awakened: m.awakened,
        options: DIRECTIVES.map((d, i) => ({
            id: d,
            action: m.awakened || pending === d || (pending === null && m.directive === d) ? null : `giantworks.umDirective.${i}.${d}.set`,
            name: directiveName(d),
            tip: scenarioText(`${UTAG} Directive Tip ${d}`, UP.switchDays(galaxy), UP.directivePartnerPct(galaxy)),
            state: pending === d ? 'switching' : pending === null && m.directive === d ? 'current' : 'choice',
        })),
    };
}

// --- Research: breakthroughs ---

function runBreakthrough(galaxy: Galaxy, m: UltraMind, e: Empire, k: number, now: number): void {
    const key = sid(e);
    const gap = (UP.breakthroughDays(galaxy) * GAME_DAY_LENGTH) / Math.max(0.05, k);
    if (m.nextBreak[key] === undefined) {
        m.nextBreak[key] = now + gap * (0.5 + nextRandom(galaxy).nextDouble());
        return;
    }
    if (now < m.nextBreak[key]) return;
    m.nextBreak[key] = now + gap * (0.75 + 0.5 * nextRandom(galaxy).nextDouble());
    const first = Math.trunc(nextRandom(galaxy).nextDouble() * 3) % 3;
    let used = 0;
    for (let i = 0; i < 3 && used <= 0; i++) used = finishCurrentProject(galaxy, e, (first + i) % 3);
    if (used <= 0) return;
    m.stats.breakthroughs++;
    m.stats.breakthroughPoints += used;
    (m.granted[key] ??= { flat: 0, breakthrough: 0 }).breakthrough += used;
    logGw(galaxy, now, `ultramind ${m.site.id}: breakthrough for ${e.name} (${fmt(used)} points)`);
    if (human(galaxy, e)) scenarioMessage(galaxy, e, scenarioText(`${UTAG} Breakthrough Title`), scenarioText(`${UTAG} Breakthrough`, fmt(used)), { type: EmpireMessageType.GeneralGoodEvent, subject: m.site.base ?? m.site.system.systemStar, popup: false });
}

// --- Intelligence: threat detection, spies, free intel ---

/** The hidden things within `range` of the Ultramind (or the empire's own) that `e` is told of now; returns how many were new to it. */
export function detectThreats(galaxy: Galaxy, m: UltraMind, e: Empire, range: number): number {
    let n = 0;
    const near = (x: number, y: number): boolean => galaxy.calculateDistance(siteX(m), siteY(m), x, y) <= range;
    const hive = peekHiveState(galaxy);
    if (hive !== null) for (const node of hive.nodes) if (!node.habitat.hasBeenDestroyed && (near(node.habitat.xpos, node.habitat.ypos) || node.habitat.empire === e) && revealTo(galaxy, node, e, KNOWLEDGE_CONFIRMED)) n++;
    const cult = peekCultState(galaxy);
    if (cult !== null) for (const r of cult.converted) if (r.character.active && r.character.empire === e && revealTo(galaxy, r, e, KNOWLEDGE_CONFIRMED)) n++;
    const beacon = peekBeaconState(galaxy);
    if (beacon !== null) {
        for (const w of beacon.watchers) {
            if (w.dead || w.ship === null || w.ship.hasBeenDestroyed || !near(w.ship.xpos, w.ship.ypos)) continue;
            if (revealTo(galaxy, { knowledge: w.knowledge }, e, KNOWLEDGE_CONFIRMED)) n++;
        }
        if (beacon.season !== null && beacon.season.phase === 'prep') for (const sp of beacon.season.staging) if (near(sp.x, sp.y) && revealTo(galaxy, sp, e, KNOWLEDGE_CONFIRMED)) n++;
    }
    const casino = peekCasinoState(galaxy);
    if (casino !== null) {
        for (const rec of casino.sites) {
            if (rec.phase !== 'open' || !rec.front || !near(rec.star.xpos, rec.star.ypos)) continue;
            const w = greatWorks(galaxy).find((x) => x.id === rec.workId);
            if (w !== undefined && revealCasinoFront(galaxy, w, rec, e)) n++;
        }
    }
    return n;
}

/** An enemy agent on a mission against `e` is caught. Returns it (null: none). */
export function catchSpy(galaxy: Galaxy, m: UltraMind, e: Empire): Empire | null {
    const cands: { owner: Empire; agent: Character }[] = [];
    for (const x of ordinaryEmpires(galaxy)) {
        if (x === e || !x.active) continue;
        for (const c of getEmpireCharacters(x)) {
            if (!c.active || c.role !== CharacterRole.IntelligenceAgent) continue;
            const mis = characterMission(c);
            if (mis === null || mis.type === IntelligenceMissionType.Undefined || mis.type === IntelligenceMissionType.CounterIntelligence || mis.targetEmpire !== e) continue;
            cands.push({ owner: x, agent: c });
        }
    }
    if (cands.length === 0) return null;
    const pick = cands[Math.trunc(nextRandom(galaxy).nextDouble() * cands.length) % cands.length];
    pick.agent.kill(galaxy);
    m.stats.spiesCaught++;
    const now = galaxyStarDate(galaxy);
    logGw(galaxy, now, `ultramind ${m.site.id}: cracks the code of ${pick.owner.name}'s agent ${pick.agent.name} and catches it (against ${e.name})`);
    if (human(galaxy, e)) scenarioMessage(galaxy, e, scenarioText(`${UTAG} Spy Title`), scenarioText(`${UTAG} Spy Caught`, pick.agent.name, pick.owner.name), { type: EmpireMessageType.GeneralGoodEvent, subject: m.site.base ?? m.site.system.systemStar, popup: false });
    if (human(galaxy, pick.owner)) scenarioMessage(galaxy, pick.owner, scenarioText(`${UTAG} Spy Title`), scenarioText(`${UTAG} Spy Lost`, pick.agent.name, e.name), { type: EmpireMessageType.GeneralBadEvent, popup: false });
    return pick.owner;
}

/** (built on use: the espionage enum may not be loaded yet when this module is, through an import cycle) */
const freeIntelTypes = (): readonly IntelligenceMissionType[] => [IntelligenceMissionType.StealTerritoryMap, IntelligenceMissionType.StealGalaxyMap, IntelligenceMissionType.StealOperationsMap];

/** A rival's maps are read for free (one of a territory, galaxy or operations map, by the stock mission effect). Returns the rival (null: none). */
export function freeIntelOn(galaxy: Galaxy, m: UltraMind, e: Empire): Empire | null {
    const rivals = ordinaryEmpires(galaxy).filter((x) => x !== e && x.active).sort((a, b) => a.empireId - b.empireId);
    if (rivals.length === 0) return null;
    const warring = rivals.filter((x) => atWar(e, x));
    const pool = warring.length > 0 ? warring : rivals;
    const rival = pool[Math.trunc(nextRandom(galaxy).nextDouble() * pool.length) % pool.length];
    const types = freeIntelTypes();
    const type = types[Math.trunc(nextRandom(galaxy).nextDouble() * types.length) % types.length];
    const now = galaxyStarDate(galaxy);
    applyIntelligenceMissionEffect(galaxy, e, newIntelligenceMissionAgainstEmpire(e, null, type, now, rival));
    m.stats.freeIntel++;
    logGw(galaxy, now, `ultramind ${m.site.id}: free intelligence for ${e.name} on ${rival.name}`);
    if (human(galaxy, e)) scenarioMessage(galaxy, e, scenarioText(`${UTAG} Intel Title`), scenarioText(`${UTAG} Intel`, rival.name), { type: EmpireMessageType.GeneralGoodEvent, subject: m.site.base ?? m.site.system.systemStar, popup: false });
    return rival;
}

function runIntel(galaxy: Galaxy, m: UltraMind, e: Empire, k: number, now: number): void {
    const key = sid(e);
    const gap = (UP.intelDays(galaxy) * GAME_DAY_LENGTH) / Math.max(0.05, k);
    if (m.nextIntel[key] === undefined) {
        m.nextIntel[key] = now + gap * nextRandom(galaxy).nextDouble();
        return;
    }
    if (now < m.nextIntel[key]) return;
    m.nextIntel[key] = now + gap;
    const rnd = nextRandom(galaxy);
    const found = detectThreats(galaxy, m, e, sectors(galaxy, UP.intelDetectSectors(galaxy)) * k);
    if (found > 0) {
        m.stats.threatsRevealed += found;
        logGw(galaxy, now, `ultramind ${m.site.id}: threat detection tells ${e.name} of ${found} hidden threats`);
        if (human(galaxy, e)) scenarioMessage(galaxy, e, scenarioText(`${UTAG} Detect Title`), scenarioText(`${UTAG} Detect`, found), { type: EmpireMessageType.GeneralWarning, subject: m.site.base ?? m.site.system.systemStar, popup: false });
    }
    if (rnd.nextDouble() * 100 < UP.intelCatchPct(galaxy)) catchSpy(galaxy, m, e);
    if (rnd.nextDouble() * 100 < UP.intelStealPct(galaxy)) freeIntelOn(galaxy, m, e);
}

function runDirectives(galaxy: Galaxy, m: UltraMind, now: number): void {
    finishSwitch(galaxy, m, now);
    const d = dirNow(m, now);
    if (d !== 'research' && d !== 'intelligence') return;
    const pShare = UP.directivePartnerPct(galaxy) / 100;
    for (const e of [...m.partners]) {
        if (!e.active) continue;
        const k = e === m.holder ? 1 : pShare;
        if (d === 'research') runBreakthrough(galaxy, m, e, k, now);
        else runIntel(galaxy, m, e, k, now);
    }
}

// --- the AI holder's choice ---

/** The scores an AI holder gives the four directives (personality and situation). Pure. */
export function aiDirectiveScores(galaxy: Galaxy, m: UltraMind, e: Empire): Record<Directive, number> {
    const pr = personality(e);
    const warring = Math.min(2, ordinaryEmpires(galaxy).filter((x) => x !== e && x.active && atWar(e, x)).length);
    const poor = e.stateMoney < 0 || annualIncome(galaxy, e) < 0 ? 0.8 : 0;
    const s: Record<Directive, number> = {
        research: 1.0 + 0.3 * pr.friendly - 0.3 * warring,
        war: 0.3 + 0.5 * pr.aggression + 0.9 * warring,
        economy: 0.8 + poor - 0.1 * warring,
        intelligence: 0.4 + 0.5 * pr.caution + 0.1 * warring,
    };
    s[m.directive] += 0.4; // a switch costs two months of nothing: it must be worth it
    return s;
}

function aiDirective(galaxy: Galaxy, m: UltraMind, now: number): void {
    const e = m.holder;
    if (e === null || !e.active || human(galaxy, e) || m.switchTo !== null || now < m.nextDirectiveReview) return;
    m.nextDirectiveReview = now + UP.aiDirectiveDays(galaxy) * GAME_DAY_LENGTH;
    const s = aiDirectiveScores(galaxy, m, e);
    let best = m.directive;
    for (const d of DIRECTIVES) if (s[d] > s[best] + 1e-9) best = d;
    if (best !== m.directive) setDirective(galaxy, m, e, best);
}

// --- the effects (queries) ---

function warBonuses(galaxy: Galaxy, v: CaptainBonuses, bo: BuiltObject, empire: Empire): CaptainBonuses {
    const eff = directiveEffect(galaxy, empire);
    if (eff === null || eff.dir !== 'war' || bo.role !== BuiltObjectRole.Military) return v;
    if (dist(galaxy, eff.m, bo) > sectors(galaxy, UP.warBattleSectors(galaxy))) return v;
    return { ...v, targeting: Math.min(200, v.targeting + UP.warTargetingPts(galaxy) * eff.k), countermeasures: Math.min(200, v.countermeasures + UP.warCountermeasuresPts(galaxy) * eff.k) };
}

/** Early warning: a hostile warship (at war with `empire`, or a pirate's) in the holder's territory or near the Ultramind is seen. */
function warningSees(galaxy: Galaxy, empire: Empire, object: BuiltObject | Habitat): boolean {
    const eff = directiveEffect(galaxy, empire);
    if (eff === null || eff.dir !== 'war') return false;
    const bo = object as BuiltObject;
    if (bo.role !== BuiltObjectRole.Military || bo.hasBeenDestroyed) return false;
    const owner = bo.actualEmpire ?? bo.empire;
    if (owner === null || owner === empire || !owner.active || !(atWar(empire, owner) || owner.pirateEmpireBaseHabitat !== null)) return false;
    if (dist(galaxy, eff.m, bo) <= sectors(galaxy, UP.warWarningSectors(galaxy)) * eff.k) return true;
    return eff.k >= 1 && galaxy.checkEmpireTerritoryIdAtLocation(bo.xpos, bo.ypos) === empire.empireId;
}

/** The economy directive's factor on income (+) or cost (−), pct % scaled by the empire's share. */
function econFactor(galaxy: Galaxy, empire: Empire | null, pct: number, sign: 1 | -1): number {
    const eff = directiveEffect(galaxy, empire);
    return eff === null || eff.dir !== 'economy' ? 1 : 1 + (sign * pct * eff.k) / 100;
}

function intelCounterFactor(galaxy: Galaxy, empire: Empire): number {
    const eff = directiveEffect(galaxy, empire);
    return eff === null || eff.dir !== 'intelligence' ? 1 : 1 + (UP.intelCounterPct(galaxy) * eff.k) / 100;
}

// ---------------------------------------------------------------------------------------------------------------
// The Diet: a motion to sanction the empire upsetting the Ultramind
// ---------------------------------------------------------------------------------------------------------------

function dietUp(galaxy: Galaxy): boolean {
    return scenarioFlag(galaxy, GW_FLAG) && dietOn(galaxy);
}

/** The partner of a calm Ultramind with the lowest standing, if it is low enough (ultramindSanctionBelow) to be a danger to the rest. Pure. */
export function sanctionTarget(galaxy: Galaxy): { mind: UltraMind; empire: Empire; standing: number } | null {
    let best: { mind: UltraMind; empire: Empire; standing: number } | null = null;
    for (const m of liveMinds(galaxy)) {
        if (m.awakened) continue;
        const e = lowestPartner(galaxy, m);
        if (e === null) continue;
        const st = standingOf(galaxy, m, e);
        if (st > UP.sanctionBelow(galaxy)) continue;
        if (best === null || st < best.standing || (st === best.standing && e.empireId < best.empire.empireId)) best = { mind: m, empire: e, standing: st };
    }
    return best;
}

function sanctionScore(galaxy: Galaxy, voter: Empire, target: Empire): number {
    if (voter === target) return -100;
    const m = liveMinds(galaxy).find((x) => !x.awakened && x.partners.includes(target));
    if (m === undefined) return -60;
    const pr = personality(voter);
    let s = 6 + (UP.sanctionBelow(galaxy) - standingOf(galaxy, m, target)) / 2 + 4 * pr.caution + 3 * pr.friendly - 3 * pr.aggression;
    if (m.partners.includes(voter)) s += 15 + (m.holder === voter ? 8 : 0); // its own contract is at stake
    const rel = voter.diplomaticRelations.byEmpire(target)?.type;
    if (rel === DiplomaticRelationType.War) s += 12;
    else if (rel === DiplomaticRelationType.MutualDefensePact || rel === DiplomaticRelationType.Protectorate) s -= 25;
    else if (rel === DiplomaticRelationType.FreeTradeAgreement) s -= 8;
    return s;
}

registerDietMotionKind({
    kind: MOTION_SANCTION,
    label: 'Sanction the empire upsetting the Ultramind',
    needs: 'empire',
    proposable: (g) => dietUp(g) && sanctionTarget(g) !== null,
    text: (_g, _st, m) => scenarioText(`${UTAG} Diet Sanction`, m.target?.name ?? ''),
    effect: () => 'The members put trade sanctions on the empire, and its research contract with the Ultramind ends, for good. The Ultramind no longer holds it against the others.',
    apply: (g, _st, m) => {
        const t = m.target;
        if (t === null) return;
        const c = dietCouncil(g);
        if (c !== null) applyMotion(g, c, { kind: 'sanction', target: t, other: null, resourceId: -1 } as unknown as Motion, Math.floor(galaxyStarDate(g) / YEAR_LENGTH));
        for (const mind of liveMinds(g)) withdrawFromContract(g, mind, t, 'sanctioned');
        scenarioNews(g, null, scenarioText(`${UTAG} Diet Sanction News`, t.name));
    },
    voteScore: (g, _st, voter, m) => (m.target === null ? -100 : voter === m.proposer ? 100 : sanctionScore(g, voter, m.target)),
    candidates: (g, _st, a): DietKindCandidate[] => {
        if (!dietUp(g)) return [];
        const t = sanctionTarget(g);
        if (t === null || t.empire === a || !t.mind.partners.includes(a) || standingOf(g, t.mind, a) < t.standing + 10) return [];
        return [{ kind: MOTION_SANCTION, proposer: a, target: t.empire, other: null, colony: null, resourceId: -1, weight: 24 + (UP.sanctionBelow(g) - t.standing) / 2 }];
    },
});

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

export const ULTRAMIND_HANDLER_IDS = ['gwUltramind.attacked', 'gwUltramind.intel', 'gwUltramind.owner', 'gwUltramind.war'] as const;
export const ULTRAMIND_QUERY_IDS = ['gwUltramind.freight', 'gwUltramind.queue', 'gwUltramind.port', 'gwUltramind.counterIntel', 'gwUltramind.war', 'gwUltramind.warning', 'gwUltramind.tax', 'gwUltramind.build', 'gwUltramind.price', 'gwUltramind.upkeep', 'gwUltramind.trade'] as const;

export function registerUltramind(): void {
    registerGreatWork({
        id: 'ultramind',
        flag: ULTRAMIND_FLAG,
        weight: 15,
        hintTags: ['superconductors', 'cooling', 'cores'],
        onComplete: (g, site) => ultramindComplete(g, site as GreatWorkRecord),
        onDestroyed: (g, site, by) => ultramindDestroyed(g, site as GreatWorkRecord, by),
        periodic: (g, site) => ultramindPeriodic(g, site as GreatWorkRecord),
        aiAbstains: (g, site, e) => mindOfSite(g, site as GreatWorkRecord)?.deals[sid(e)] === 'accepted',
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
    registerScenarioDecision({
        id: 'gwUltramind.dealDecision',
        kind: DEAL_KIND,
        flag: GW_FLAG,
        resolve: resolveDeal,
        aiChoose: (g, d) => {
            const m = peekUltramindState(g)?.minds.find((x) => x.site.id === d.context.siteId) ?? null;
            return m === null ? d.defaultOption : aiDealAnswer(g, m, d.empire);
        },
    });
    registerScenarioEvent({ id: 'gwUltramind.attacked', flag: GW_FLAG, event: 'builtObjectAttacked', run: (g, e) => onAttacked(g, e.builtObject, e.attackingEmpire) });
    registerScenarioEvent({ id: 'gwUltramind.intel', flag: GW_FLAG, event: 'intelMissionCompleted', run: (g, e) => onIntel(g, e.empire, e.mission as IntelligenceMission) });
    registerScenarioEvent({ id: 'gwUltramind.owner', flag: GW_FLAG, event: 'builtObjectOwnerChanged', run: (g, e) => onOwnerChanged(g, e.builtObject, e.to) });
    registerScenarioEvent({ id: 'gwUltramind.war', flag: GW_FLAG, event: 'warDeclared', run: (g, e) => onWarDeclared(g, e.empire, e.target) });
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
        run: (g, v, a) => (peekUltramindState(g) !== null ? Math.min(v * exposureFactor(g, a.empire) * intelCounterFactor(g, a.empire), Math.max(v, 1)) : v),
    });
    registerScenarioQuery({ id: 'gwUltramind.war', flag: GW_FLAG, query: 'captainBonuses', run: (g, v, a) => warBonuses(g, v, a.builtObject, a.empire) });
    registerScenarioQuery({ id: 'gwUltramind.warning', flag: GW_FLAG, query: 'objectVisibleToAll', run: (g, v, a) => v || warningSees(g, a.empire, a.object) });
    registerScenarioQuery({ id: 'gwUltramind.tax', flag: GW_FLAG, query: 'colonyTaxRevenue', run: (g, v, a) => v * econFactor(g, a.empire, UP.econTaxPct(g), 1) });
    registerScenarioQuery({ id: 'gwUltramind.build', flag: GW_FLAG, query: 'colonyConstructionFactor', run: (g, v, a) => v * econFactor(g, a.habitat.empire, UP.econBuildPct(g), 1) });
    registerScenarioQuery({ id: 'gwUltramind.price', flag: GW_FLAG, query: 'designPriceFactor', run: (g, v, a) => v * econFactor(g, a.empire, UP.econPricePct(g), -1) });
    registerScenarioQuery({ id: 'gwUltramind.upkeep', flag: GW_FLAG, query: 'shipMaintenanceFactor', run: (g, v, a) => v * econFactor(g, a.builtObject.empire, UP.econUpkeepPct(g), -1) });
    registerScenarioQuery({ id: 'gwUltramind.trade', flag: GW_FLAG, query: 'portTradeIncomeFactor', run: (g, v, a) => v * econFactor(g, a.port.actualEmpire, UP.econTradePct(g), 1) });
    DIRECTIVES.forEach((d, i) => {
        for (const state of ['set', 'current', 'switching'] as const) {
            registerThreatAction(`giantworks.umDirective.${i}.${d}.${state}`, {
                label: () => scenarioText(`${UTAG} Directive Action ${state}`, directiveName(d)),
                available: (g, e, target) => {
                    if (!scenarioFlag(g, GW_FLAG)) return false;
                    const m = mindOfBase(g, target);
                    if (m === null || m.site.phase !== 'complete' || m.awakened || m.holder !== e) return false;
                    const now: 'switching' | 'current' | 'set' = m.switchTo === d ? 'switching' : m.switchTo === null && m.directive === d ? 'current' : 'set';
                    return now === state;
                },
                run: (g, e, target) => {
                    const m = mindOfBase(g, target);
                    return state === 'set' && m !== null && setDirective(g, m, e, d);
                },
            });
        }
    });
    registerThreatAction(ACTION_BOMB, {
        label: () => scenarioText(`${UTAG} Bomb Action`),
        available: (g, e, target) => scenarioFlag(g, GW_FLAG) && bombTarget(g, e, target) !== null,
        run: (g, e, target) => {
            const m = bombTarget(g, e, target);
            return m !== null && deployLogicBomb(g, e, m);
        },
    });
    registerThreatAction(ACTION_WITHDRAW, {
        label: () => scenarioText(`${UTAG} Withdraw Action`),
        available: (g, e, target) => scenarioFlag(g, GW_FLAG) && withdrawTarget(g, e, target) !== null,
        run: (g, e, target) => {
            const m = withdrawTarget(g, e, target);
            return m !== null && withdrawFromContract(g, m, e, 'withdrew');
        },
    });
}

registerUltramind();
void TAG;
void greatWorks;
