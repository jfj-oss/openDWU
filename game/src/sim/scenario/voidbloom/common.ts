// The Voidbloom War (docs/VOIDBLOOM_WAR.md) — shared state, params and lookups. Not a port. Scenario id `voidbloom`,
// flag `voidbloom`, a member of The Rim expansion that requires Rim Trade. Nothing here draws galaxy.rnd.
//
// State: plain data and graph references under scenarioState(galaxy, 'voidbloom'), saved by the galaxy codec like
// every add-on's. Iteration orders are fixed (empire ids ascending, colony habitatIndex ascending, list order).

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import type { BuiltObject } from '../../builtObject';
import type { Character } from '../../characters';
import { scenarioFlag, scenarioParam, scenarioState } from '../state';
import { isRimTraderAI, rimTraderEmpire } from '../rimTrade/common';
import { isHumanEmpire } from '../../humanEmpires';
import { galaxyStarDate } from '../../tick/simTime';
import { YEAR_LENGTH } from '../../galaxyTime';
import { identifyMechanoidEmpire } from '../../fleets/militaryAI';

export const VOIDBLOOM_FLAG = 'voidbloom';
export const VOIDBLOOM_KEY = 'voidbloom';
export const VOIDBLOOM_GOOD = 'Voidbloom';
/** Our own icon (src/ui/resourceIcons.ts maps it to public/art/voidbloom/voidbloom.svg). */
export const VOIDBLOOM_PICTURE = 9100;

/** Manifest defaults (scenarios/voidbloom/scenario.json): the fallbacks of scenarioParam. */
export const VB_DEFAULTS = {
    voidbloomWorlds: 0,
    voidbloomRimInner: 0.7,
    voidbloomYield: 12,
    voidbloomYieldExponent: 0.6,
    voidbloomDeathPctYear: 35,
    voidbloomLabourTarget: 40,
    voidbloomConvoySize: 12,
    voidbloomConvoyCost: 15000,
    voidbloomConvoyDays: 90,
    voidbloomGarrisonPer10M: 1,
    voidbloomGarrisonBase: 2,
    voidbloomGarrisonCost: 8000,
    voidbloomRevoltPct: 12,
    voidbloomColonyValue: 4,
    voidbloomPremium: 1.5,
    voidbloomStateDrainPct: 15,
    voidbloomSmugglerCutPct: 20,
    voidbloomReachSectors: 14,
    voidbloomCanton: 3,
    voidbloomAddictRate: 0.03,
    voidbloomAddictDecay: 0.012,
    voidbloomBoostApproval: 8,
    voidbloomAddictApproval: 14,
    voidbloomWithdrawalApproval: 18,
    voidbloomIncomeLossPct: 25,
    voidbloomCorruption: 0.5,
    voidbloomCrackdownAddiction: 0.12,
    voidbloomCrackdownValue: 400000,
    voidbloomInspectPct: 30,
    voidbloomTaskForceShips: 8,
    voidbloomBurnDays: 540,
    voidbloomBurnYieldPct: 25,
    voidbloomPayIndemnity: 250000,
    voidbloomPayYears: 5,
    voidbloomGateDecline: 0.45,
    voidbloomHarshPoints: 600,
    voidbloomRevancheMinYears: 15,
    voidbloomRevancheMaxYears: 30,
    voidbloomSecondWarYears: 10,
    voidbloomFallbackYear: 10,
    voidbloomDetoxCost: 300000,
    voidbloomDetoxYears: 4,
} as const;

export type VbParam = keyof typeof VB_DEFAULTS;

export function vbParam(galaxy: Galaxy, name: VbParam): number {
    return scenarioParam(galaxy, name, VB_DEFAULTS[name]);
}

/** The add-on runs (flag on and Rim Trade's Concord placed). */
export function vbOn(galaxy: Galaxy | null): galaxy is Galaxy {
    return galaxy !== null && galaxy.scenario !== null && scenarioFlag(galaxy, VOIDBLOOM_FLAG);
}

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------

/** An empire's Voidbloom policy: trade it anywhere (smuggle into banned markets), only where it is legal, or ban it. */
export type VbPolicy = 'smuggle' | 'legal' | 'ban';

/** One colony's exposure and addiction (keyed by habitatIndex). */
export interface VbColony {
    /** Exposure 0..1: at 1 the colony has tasted Voidbloom and orders it. */
    x: number;
    /** Addiction 0..1. */
    a: number;
    /** Star date it last held Voidbloom (-1 never). */
    sup: number;
    /** Star date it first tasted it (-1 not yet). */
    tasted: number;
    /** Star date a withdrawal crisis was announced (-1 none). */
    wd: number;
    /** A spore den was reported (Concord colonies at high addiction). */
    den: boolean;
    /** A temperance movement asked for a ban (star date, -1 none). */
    temp: number;
    /** Star date of its last Voidbloom purchase. */
    buy?: number;
}

/** A Voidbloom world: only a colony there grows Voidbloom; deadly (population falls) and hungry for labour. */
export interface BloomWorld {
    habitat: Habitat;
    /** Star date until which its fields are burned (yield cut). */
    burnedUntil: number;
    /** Units grown, all time. */
    produced: number;
    revolts: number;
    /** Star date of the last labour convoy sent to it. */
    lastConvoy: number;
    /** Star date the owner last changed (or 0). */
    ownerSince: number;
}

/** An empire's ledger and policy (keyed by empireId). */
export interface VbEmpire {
    policy: VbPolicy;
    /** The AI picks the policy (false: the player set it). */
    auto: boolean;
    /** Value sold (seller side, all buyers) and into the Concord. */
    sold: number;
    soldConcord: number;
    /** Value bought (buyer side): private and state shares. */
    boughtPrivate: number;
    boughtState: number;
    unitsBought: number;
    /** Cargo seized from this empire's ships or colonies (units / value). */
    seizedUnits: number;
    seizedValue: number;
    /** Labour sent (people) and convoys. */
    labour: number;
    convoys: number;
    convoysLost: number;
    levies: number;
    /** Automatic labour convoys and garrison levies (the player can switch them off). */
    autoLabour: boolean;
    autoGarrison: boolean;
    /** Treaty rights with the Concord. */
    legalConcord: boolean;
    tollExempt: boolean;
    inspectExempt: boolean;
    treatyPort: Habitat | null;
    /** Share (%) of the Concord's trade-house income paid to it yearly (foreign-run customs). */
    tollCutPct: number;
    /** Neural detox research: done, or under way until this star date (-1 none). */
    detoxUntil: number;
    detoxDone: boolean;
    /** The Concord's officials bribed to look away until this star date (-1 none). */
    bribedUntil: number;
    /** Star date of its last Diet violation for smuggling (rate limit). */
    lastViolation?: number;
    /** Star date it snubbed a temperance movement. */
    snubbed?: number;
}

export type CrackdownStatus = 'crisis' | 'tolerated' | 'war' | 'paid' | 'backedDown' | 'ended';

/** The Concord's crackdown on one smuggler empire. */
export interface Crackdown {
    targetId: number;
    since: number;
    status: CrackdownStatus;
    /** paid: the crackdown pauses until this star date. */
    until: number;
    /** Warships taken out of AI control for the police action. */
    taskForce: BuiltObject[];
    /** The Voidbloom colony the task force works on, and since when it is there. */
    site: Habitat | null;
    siteSince: number;
    lastAction: number;
    raids: number;
    burns: number;
    occupations: number;
    freed: number;
    hunted: number;
    agentKills: number;
    /** How the crisis was answered ('' while open) and by whom. */
    answer: string;
    by: string;
}

/** A war over Voidbloom with the Concord. */
export interface VbWar {
    empireId: number;
    start: number;
    end: number;
    /** 'treaty' (an unequal treaty), 'concord' (the Concord held), 'white' (status quo) or '' while it lasts. */
    outcome: string;
    /** War damage (value) each side inflicted. */
    byEmpire: number;
    byConcord: number;
    second: boolean;
}

export type AftermathBranch = 'reform' | 'unrest' | 'client' | 'opening' | 'collapse';

export interface VbTreaty {
    victorId: number;
    date: number;
    harsh: number;
    terms: string[];
    branch: AftermathBranch | '';
    /** Branch timers (star dates; -1 unused). */
    revancheAt: number;
    secondWarAt: number;
    reformSteps: number;
    nextReformAt: number;
    /** The ceded "barren rock" that grows into a trade hub. */
    ceded: Habitat | null;
    /** The second war's pretext was used; the Concord capital's wonder was looted. */
    pretextUsed: boolean;
    looted: boolean;
}

/** A labour convoy at sea. */
export interface LabourConvoy {
    ship: BuiltObject;
    world: Habitat;
    empireId: number;
    raceName: string;
    amount: number;
    /** 'sea' while travelling; 'done' / 'lost' / 'freed' once settled (the sweep tears the ship down). */
    stage: 'sea' | 'done' | 'lost' | 'freed';
}

export interface VbStats {
    produced: number;
    sales: number;
    salesValue: number;
    blackSales: number;
    blackValue: number;
    stateDrain: number;
    privateDrain: number;
    smugglerCut: number;
    inspections: number;
    seizures: number;
    seizedUnits: number;
    burnings: number;
    neutralHits: number;
    convoys: number;
    convoysLost: number;
    freed: number;
    revolts: number;
    levies: number;
    raids: number;
    burns: number;
    occupations: number;
    hunted: number;
    agentKills: number;
    crises: number;
    tolerated: number;
    wars: number;
    paid: number;
    backedDown: number;
    treaties: number;
    dietMotions: number;
    dietPassed: number;
    temperance: number;
    withdrawalCrises: number;
    detox: number;
    addictLeaders: number;
    seizedAtHome: number;
    mfn: number;
}

export interface VoidbloomState {
    /** Star date of the game start (years in this add-on count from it). */
    startDate: number;
    worlds: BloomWorld[];
    colonies: Record<number, VbColony>;
    empires: Record<number, VbEmpire>;
    convoys: LabourConvoy[];
    /** First Voidbloom sale into the Concord (-1 none) and who carried it ('ai' | 'player' | 'cartel' | 'pirate'). */
    arcStarted: number;
    starter: string;
    /** The rim cartel's colony (fallback starter), if it settled one. */
    cartel: Habitat | null;
    commissioner: Character | null;
    commissionerColony: Habitat | null;
    crackdownStarted: number;
    crackdowns: Crackdown[];
    wars: VbWar[];
    treaty: VbTreaty | null;
    /** Voidbloom is legal in the Concord for everyone (opening, Diet), from this star date (-1 not). */
    legalAll: number;
    /** Some legalisation happened (treaty or opening): the legal era (item 15) runs from this star date. */
    legalSince: number;
    /** The Concord was opened (branch d): its closed-trade rules end. */
    opened: boolean;
    /** Research cap override for the Concord (branch a / d; 0 = the Rim Trade param). */
    researchCap: number;
    /** The built-in treaty's indemnity instalments (no War Goals). */
    indemnity: { payerId: number; payeeId: number; perYear: number; yearsLeft: number } | null;
    /** The revanche war was declared / the pretext's second war was declared. */
    revanche: boolean;
    secondWar: boolean;
    /** The gunboat moment (the Concord's frozen research two levels behind) was announced. */
    gunboat: boolean;
    /** The smugglers' cut at the last syndicate news. */
    syndicateNoted?: number;
    /** The Concord's decline index at the last yearly review (soak / panel read-out). */
    declineNow?: number;
    /** History lines for the Galactopedia / panel (newest last, trimmed to 60). */
    history: string[];
    /** Yearly samples for the panel's "silver drain" figure (last 30 years). */
    drainByYear: { year: number; value: number }[];
    stats: VbStats;
}

function emptyStats(): VbStats {
    return {
        produced: 0, sales: 0, salesValue: 0, blackSales: 0, blackValue: 0, stateDrain: 0, privateDrain: 0, smugglerCut: 0,
        inspections: 0, seizures: 0, seizedUnits: 0, burnings: 0, neutralHits: 0, convoys: 0, convoysLost: 0, freed: 0, revolts: 0,
        levies: 0, raids: 0, burns: 0, occupations: 0, hunted: 0, agentKills: 0, crises: 0, tolerated: 0, wars: 0, paid: 0,
        backedDown: 0, treaties: 0, dietMotions: 0, dietPassed: 0, temperance: 0, withdrawalCrises: 0, detox: 0, addictLeaders: 0,
        seizedAtHome: 0, mfn: 0,
    };
}

export function vbState(galaxy: Galaxy): VoidbloomState {
    return scenarioState<VoidbloomState>(galaxy, VOIDBLOOM_KEY, () => ({
        startDate: galaxyStarDate(galaxy),
        worlds: [],
        colonies: {},
        empires: {},
        convoys: [],
        arcStarted: -1,
        starter: '',
        cartel: null,
        commissioner: null,
        commissionerColony: null,
        crackdownStarted: -1,
        crackdowns: [],
        wars: [],
        treaty: null,
        legalAll: -1,
        legalSince: -1,
        opened: false,
        researchCap: 0,
        indemnity: null,
        revanche: false,
        secondWar: false,
        gunboat: false,
        history: [],
        drainByYear: [],
        stats: emptyStats(),
    }));
}

/** The state when it exists (UI / queries never create it). */
export function peekVbState(galaxy: Galaxy | null): VoidbloomState | null {
    if (galaxy === null || galaxy.scenario === null) return null;
    return (galaxy.scenario.state[VOIDBLOOM_KEY] as VoidbloomState | undefined) ?? null;
}

export function vbEmpire(galaxy: Galaxy, e: Empire): VbEmpire {
    const st = vbState(galaxy);
    let r = st.empires[e.empireId];
    if (r === undefined) {
        r = {
            policy: 'legal', auto: true, sold: 0, soldConcord: 0, boughtPrivate: 0, boughtState: 0, unitsBought: 0, seizedUnits: 0, seizedValue: 0,
            labour: 0, convoys: 0, convoysLost: 0, levies: 0, autoLabour: true, autoGarrison: true, legalConcord: false, tollExempt: false,
            inspectExempt: false, treatyPort: null, tollCutPct: 0, detoxUntil: -1, detoxDone: false, bribedUntil: -1,
        };
        st.empires[e.empireId] = r;
    }
    return r;
}

export function peekVbEmpire(galaxy: Galaxy, e: Empire | null): VbEmpire | null {
    if (e === null) return null;
    return peekVbState(galaxy)?.empires[e.empireId] ?? null;
}

export function vbColony(galaxy: Galaxy, h: Habitat): VbColony {
    const st = vbState(galaxy);
    let r = st.colonies[h.habitatIndex];
    if (r === undefined) {
        r = { x: 0, a: 0, sup: -1, tasted: -1, wd: -1, den: false, temp: -1 };
        st.colonies[h.habitatIndex] = r;
    }
    return r;
}

export function peekVbColony(galaxy: Galaxy, h: Habitat): VbColony | null {
    return peekVbState(galaxy)?.colonies[h.habitatIndex] ?? null;
}

export function addHistory(galaxy: Galaxy, line: string): void {
    const st = vbState(galaxy);
    st.history.push(line);
    if (st.history.length > 60) st.history.splice(0, st.history.length - 60);
}

// ---------------------------------------------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------------------------------------------

const idCache = new WeakMap<Galaxy, number>();

/** Voidbloom's resource id in this galaxy's data (-1 without the overlay). */
export function voidbloomId(galaxy: Galaxy): number {
    let id = idCache.get(galaxy);
    if (id === undefined) {
        id = galaxy.resourceSystem.resources.find((r) => r.name === VOIDBLOOM_GOOD)?.resourceId ?? -1;
        idCache.set(galaxy, id);
    }
    return id;
}

/** The Concord when the AI runs it (Rim Trade's rules apply), else null. */
export function concord(galaxy: Galaxy): Empire | null {
    const r = rimTraderEmpire(galaxy);
    return r !== null && isRimTraderAI(galaxy, r) ? r : null;
}

/** A normal empire (not the independents, a pirate faction or an inactive one). */
export function isNormal(galaxy: Galaxy, e: Empire | null): e is Empire {
    return e !== null && e.active && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null && e.dominantRace !== null && e !== identifyMechanoidEmpire(galaxy);
}

export function isPirate(e: Empire | null): boolean {
    return e !== null && e.pirateEmpireBaseHabitat !== null;
}

export function empireById(galaxy: Galaxy, id: number): Empire | null {
    if (galaxy.independentEmpire !== null && galaxy.independentEmpire.empireId === id) return galaxy.independentEmpire;
    for (const e of galaxy.empires) if (e !== null && e.empireId === id) return e;
    for (const e of galaxy.pirateEmpires) if (e !== null && e.empireId === id) return e;
    return null;
}

/** Normal empires by id (fixed order). */
export function normalEmpires(galaxy: Galaxy): Empire[] {
    return galaxy.empires.filter((e): e is Empire => isNormal(galaxy, e)).sort((a, b) => a.empireId - b.empireId);
}

export function isHuman(galaxy: Galaxy, e: Empire): boolean {
    return isHumanEmpire(galaxy, e);
}

/** The bloom-world record of `h` (null when `h` is no Voidbloom world). */
export function bloomWorldOf(galaxy: Galaxy, h: Habitat | null): BloomWorld | null {
    if (h === null) return null;
    const st = peekVbState(galaxy);
    if (st === null) return null;
    for (const w of st.worlds) if (w.habitat === h) return w;
    return null;
}

/** Voidbloom units in a cargo holder's stock (any owner). */
export function voidbloomStock(galaxy: Galaxy, holder: { cargo: { items: { commodity: { resourceId: number }; amount: number }[] } | null }): number {
    const id = voidbloomId(galaxy);
    if (id < 0 || holder.cargo === null) return 0;
    let n = 0;
    for (const c of holder.cargo.items) if (c.commodity.resourceId === id && c.amount > 0) n += c.amount;
    return n;
}

/** Removes every Voidbloom cargo item from a holder (returns units removed). Reserved amounts go too (seized). */
export function removeVoidbloom(galaxy: Galaxy, holder: { cargo: { items: { commodity: { resourceId: number }; amount: number; reserved?: number }[] } | null }): number {
    const id = voidbloomId(galaxy);
    if (id < 0 || holder.cargo === null) return 0;
    let n = 0;
    const items = holder.cargo.items;
    for (let i = items.length - 1; i >= 0; i--) {
        const c = items[i];
        if (c.commodity.resourceId !== id) continue;
        n += Math.max(0, c.amount);
        if ((c.reserved ?? 0) > 0) c.amount = 0;
        else items.splice(i, 1);
    }
    return n;
}

/** The empire's Voidbloom policy (a banning empire under a Diet ban or Galactic Prohibition counts as ban). */
export function policyOf(galaxy: Galaxy, e: Empire | null): VbPolicy {
    if (e === null) return 'legal';
    if (e === galaxy.independentEmpire || isPirate(e)) return 'smuggle';
    const r = peekVbEmpire(galaxy, e);
    const own = r?.policy ?? 'legal';
    if (own !== 'smuggle' && vbBanSlots.dietBan?.(galaxy, e) === true) return 'ban';
    return own;
}

/** True when the seller ignores bans: pirates, independents (the rim cartel) and empires whose policy is to smuggle. */
export function isSmuggler(galaxy: Galaxy, e: Empire | null): boolean {
    return e !== null && policyOf(galaxy, e) === 'smuggle';
}

/** Voidbloom is legal for `seller` to sell into `buyer`'s markets (the Concord bans it unless a treaty or opening lifted it). */
export function legalInto(galaxy: Galaxy, seller: Empire | null, buyer: Empire | null): boolean {
    if (buyer === null) return true;
    const st = peekVbState(galaxy);
    const r = rimTraderEmpire(galaxy);
    if (vbBanSlots.prohibition?.(galaxy) === true) return false;
    if (buyer === r) {
        if (st !== null && (st.legalAll >= 0 || st.opened)) return true;
        return seller !== null && peekVbEmpire(galaxy, seller)?.legalConcord === true;
    }
    return policyOf(galaxy, buyer) !== 'ban';
}

/** Late-bound slots other Voidbloom modules fill (the Diet ban lives in diet.ts). */
export const vbBanSlots: { dietBan: ((galaxy: Galaxy, e: Empire) => boolean) | null; prohibition: ((galaxy: Galaxy) => boolean) | null } = { dietBan: null, prohibition: null };

/** The Concord's addiction index: its colonies' addiction weighted by population (0..1). Pure. */
export function concordAddiction(galaxy: Galaxy): number {
    const r = rimTraderEmpire(galaxy);
    const st = peekVbState(galaxy);
    if (r === null || st === null) return 0;
    return addictionIndex(galaxy, r);
}

/** An empire's addiction index: its colonies' addiction weighted by population (0..1). Pure. */
export function addictionIndex(galaxy: Galaxy, e: Empire): number {
    const st = peekVbState(galaxy);
    if (st === null) return 0;
    let w = 0;
    let s = 0;
    for (const h of e.colonies) {
        if (h.hasBeenDestroyed) continue;
        const p = Math.max(1, h.population?.totalAmount ?? 0);
        w += p;
        s += p * (st.colonies[h.habitatIndex]?.a ?? 0);
    }
    return w > 0 ? s / w : 0;
}

/** Live crackdown (not ended / backed down) against `e`, or null. */
export function crackdownOn(galaxy: Galaxy, e: Empire | null): Crackdown | null {
    if (e === null) return null;
    const st = peekVbState(galaxy);
    if (st === null) return null;
    for (const c of st.crackdowns) if (c.targetId === e.empireId && c.status !== 'ended' && c.status !== 'backedDown') return c;
    return null;
}

/** A Voidbloom war with the Concord in progress for `e`. */
export function vbWarOf(galaxy: Galaxy, e: Empire | null): VbWar | null {
    if (e === null) return null;
    const st = peekVbState(galaxy);
    if (st === null) return null;
    for (let i = st.wars.length - 1; i >= 0; i--) if (st.wars[i].empireId === e.empireId && st.wars[i].outcome === '') return st.wars[i];
    return null;
}

/** Game years since the start (the add-on's own clock). Pure. */
export function vbYears(galaxy: Galaxy): number {
    const st = peekVbState(galaxy);
    return st === null ? 0 : (galaxyStarDate(galaxy) - st.startDate) / YEAR_LENGTH;
}

export function fmt(n: number): string {
    return Math.round(n).toLocaleString('en-US');
}
