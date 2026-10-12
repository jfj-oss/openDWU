// The Voidbloom War — the contraband trade (docs/VOIDBLOOM_WAR.md, user decisions 6 and 14): Voidbloom's own
// contraband category on the stock order path (the extraLuxuryOrders slot), legal or black-market sellers
// (contractAvailable), the black-market premium and the silver drain on every purchase (contractInitiated), epidemic-
// style exposure and addiction, their colony effects (approval / income / corruption), home seizures under a ban, and
// the AI's yearly policy. Not a port.
//
// Rnd: none in this module except the home-seizure roll (in the gated 30-day handler, fixed colony order).

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import type { BuiltObject } from '../../builtObject';
import { performPrivateTransaction } from '../../treasury';
import { ColonyResourceEffect } from '../../developmentLevel';
import { empireApprovalRatingStock } from '../../taxes';
import { empireGovernmentAttributes } from '../../empire';
import { aggressionLevel, cautionLevel, friendlinessLevel } from '../../diplomacyTick';
import { EmpireMessageType } from '../../messages';
import { galaxyStarDate } from '../../tick/simTime';
import { GAME_DAY_LENGTH, gameYear, registerScenarioEvent, registerScenarioPeriodic, registerScenarioQuery, registerScenarioYearly } from '../hooks';
import { registerStabilityTerm } from '../stability';
import { scenarioFlag } from '../state';
import { scenarioMessage, scenarioNews, scenarioText } from '../messages';
import { rimTraderEmpire, rimTraderStanding } from '../rimTrade/common';
import { peekColony } from '../colonyEconomy/common';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission, isBuiltObject } from '../../missions/mission';
import { assignMission } from '../../missions/assign';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { Cargo, CargoList, ResourceRef } from '../../cargo';
import { cargoEmpireId } from '../../logistics/orders';
import { determineAvailableFreighters } from '../../logistics/freight';
import { isStellarObjectDockable } from '../../independentTraders';
import { YEAR_LENGTH } from '../../galaxyTime';
import {
    VOIDBLOOM_FLAG,
    addHistory,
    addictionIndex,
    bloomWorldOf,
    concord,
    crackdownOn,
    fmt,
    isHuman,
    isNormal,
    isPirate,
    isSmuggler,
    legalInto,
    normalEmpires,
    concordAddiction,
    peekVbColony,
    peekVbState,
    policyOf,
    vbColony,
    vbEmpire,
    vbOn,
    vbParam,
    vbState,
    voidbloomId,
    voidbloomStock,
    removeVoidbloom,
    type SmugglerRun,
    type VbPolicy,
} from './common';

const PERIOD_DAYS = 30;

// ---------------------------------------------------------------------------------------------------------------
// Demand: the stock order path
// ---------------------------------------------------------------------------------------------------------------

/** extraLuxuryOrders: a colony that has tasted Voidbloom orders it (banned or not: a ban leaves only the black market). */
function extraOrders(galaxy: Galaxy, v: readonly number[], a: { empire: Empire; habitat: Habitat }): readonly number[] {
    if (!vbOn(galaxy)) return v;
    const id = voidbloomId(galaxy);
    if (id < 0 || v.includes(id)) return v;
    const h = a.habitat;
    if (bloomWorldOf(galaxy, h) !== null) return v;
    const c = peekVbColony(galaxy, h);
    if (c === null || c.tasted < 0) return v;
    // A banning empire's colonies still want it once addicted (the black market); before, the ban keeps demand away.
    if (policyOf(galaxy, a.empire) === 'ban' && a.empire !== rimTraderEmpire(galaxy) && c.a < 0.05) return v;
    // A grower keeps it off its own markets: its colonies order it only once hooked some other way.
    if (c.a < 0.1 && growsVoidbloom(galaxy, a.empire)) return v;
    return v.length === 0 ? [id] : [...v, id];
}

/** contractAvailable: only smugglers sell into a banned market; a banning empire sells none. */
export function voidbloomContractAvailable(galaxy: Galaxy, v: number, a: { seller: Empire | null; buyer: Empire | null; resourceId: number }): number {
    if (v <= 0 || !vbOn(galaxy) || a.resourceId !== voidbloomId(galaxy)) return v;
    const seller = a.seller;
    if (seller !== null && seller === rimTraderEmpire(galaxy) && seller !== a.buyer) return 0; // the Concord sells none (it burns what it seizes)
    if (seller !== null && seller !== a.buyer && policyOf(galaxy, seller) === 'ban') return 0;
    if (seller === a.buyer) return v;
    if (legalInto(galaxy, seller, a.buyer)) return v;
    return isSmuggler(galaxy, seller) ? v : 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Payment: premium, the silver drain, the smugglers' cut
// ---------------------------------------------------------------------------------------------------------------

function destinationColony(dest: unknown): Habitat | null {
    if (dest === null || dest === undefined) return null;
    if (isBuiltObject(dest)) return (dest as BuiltObject).parentHabitat;
    return dest as Habitat;
}

/** The pirate syndicate that takes the smugglers' cut: the active pirate faction with the most money (ties by id). */
function syndicate(galaxy: Galaxy): Empire | null {
    let best: Empire | null = null;
    for (const p of galaxy.pirateEmpires) {
        if (p === null || !p.active) continue;
        if (best === null || p.stateMoney > best.stateMoney || (p.stateMoney === best.stateMoney && p.empireId < best.empireId)) best = p;
    }
    return best;
}

/**
 * contractInitiated for Voidbloom: the stock contract has moved `value` from the buyer's private sector to the seller.
 * Black market: the buyer pays `value × voidbloomPremium` more, the smugglers keep their cut, the seller the rest. Every
 * purchase: the buyer's state treasury carries voidbloomStateDrainPct of the total (refunded to its private sector) —
 * the silver drain. No Rnd.
 */
export function onContract(galaxy: Galaxy, p: { seller: Empire; buyer: Empire | null; destination: unknown; resourceId: number; amount: number; value: number; freighter: BuiltObject | null }): void {
    if (!vbOn(galaxy) || p.resourceId !== voidbloomId(galaxy) || p.buyer === null || p.value <= 0) return;
    const st = vbState(galaxy);
    const seller = p.seller;
    const buyer = p.buyer;
    if (seller === buyer) return;
    const black = !legalInto(galaxy, seller, buyer);
    // Demand and price rise with addiction: the black market's premium (and a legal markup) grows with the buyer's habit.
    const hDest = destinationColony(p.destination);
    const habit = hDest !== null ? (peekVbColony(galaxy, hDest)?.a ?? 0) : 0;
    const premium = p.value * (black ? vbParam(galaxy, 'voidbloomPremium') * (0.5 + habit) : 0.5 * habit);
    const total = p.value + premium;
    // The Concord's state carries a far bigger share (its trade houses buy for the court; officials skim the rest).
    const statePct = buyer === rimTraderEmpire(galaxy) ? vbParam(galaxy, 'voidbloomConcordStateDrainPct') : vbParam(galaxy, 'voidbloomStateDrainPct');
    const statePart = (total * statePct) / 100;
    const privateExtra = total - statePart - p.value; // may be negative: the state share refunds the private sector
    if (privateExtra !== 0) performPrivateTransaction(buyer, -privateExtra);
    buyer.stateMoney -= statePart;
    let cut = 0;
    if (premium > 0 && !black) performPrivateTransaction(seller, premium);
    if (black) {
        cut = (premium * vbParam(galaxy, 'voidbloomSmugglerCutPct')) / 100;
        const carrier = p.freighter?.actualEmpire ?? null;
        const taker = carrier !== null && carrier !== seller && carrier !== buyer && carrier !== galaxy.independentEmpire ? carrier : syndicate(galaxy);
        if (taker !== null) {
            if (isPirate(taker)) taker.stateMoney += cut;
            else performPrivateTransaction(taker, cut);
        }
        if (seller !== galaxy.independentEmpire) performPrivateTransaction(seller, premium - cut);
        st.stats.blackSales += p.amount;
        st.stats.blackValue += total;
    }
    // The export duty: the seller's state takes voidbloomExportDutyPct of the sale's total from its private sector
    // (trade money is never taxed by the stock tax, which comes from colony income only). Legal and black sales alike;
    // independents, the rim cartel and pirates have no state to pay it to.
    let duty = 0;
    if (isNormal(galaxy, seller) && seller !== galaxy.independentEmpire) {
        duty = (total * vbParam(galaxy, 'voidbloomExportDutyPct')) / 100;
        if (duty > 0) {
            performPrivateTransaction(seller, -duty);
            seller.stateMoney += duty;
            st.stats.duty = (st.stats.duty ?? 0) + duty;
        }
    }
    st.stats.sales += p.amount;
    st.stats.salesValue += total;
    st.stats.smugglerCut += cut;
    const sr = isNormal(galaxy, seller) ? vbEmpire(galaxy, seller) : null;
    const br = isNormal(galaxy, buyer) ? vbEmpire(galaxy, buyer) : null;
    if (sr !== null) {
        sr.sold += total;
        sr.duty = (sr.duty ?? 0) + duty;
    }
    if (br !== null) {
        br.boughtPrivate += total - statePart;
        br.boughtState += statePart;
        br.unitsBought += p.amount;
    }
    const r = rimTraderEmpire(galaxy);
    if (buyer === r) {
        st.stats.stateDrain += statePart;
        st.stats.privateDrain += total - statePart;
        if (sr !== null) sr.soldConcord += total;
        if (st.arcStarted < 0) {
            st.arcStarted = galaxyStarDate(galaxy);
            const who = seller === galaxy.independentEmpire ? (st.cartel !== null ? 'cartel' : 'independent') : isPirate(seller) ? 'pirate' : isHuman(galaxy, seller) ? 'player' : 'ai';
            st.starter = who;
            addHistory(galaxy, scenarioText('Voidbloom History First', seller.name, r.name, gameYear(galaxyStarDate(galaxy))));
        }
    }
    // The colony that receives it has tasted it.
    const h = destinationColony(p.destination);
    if (h !== null) {
        const c = vbColony(galaxy, h);
        c.x = 1;
        if (c.tasted < 0) c.tasted = galaxyStarDate(galaxy);
        c.buy = galaxyStarDate(galaxy);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Spread: exposure and addiction (the epidemic)
// ---------------------------------------------------------------------------------------------------------------

/** Race susceptibility from the race name (a fixed hash): a few races immune, some resistant. Pure. */
export function raceSusceptibility(name: string): number {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 1000003;
    const k = h % 10;
    if (k === 0) return 0; // immune
    if (k <= 2) return 0.4; // resistant
    if (k >= 8) return 1.3; // susceptible
    return 1;
}

function colonySusceptibility(h: Habitat): number {
    const race = h.population?.dominantRace ?? null;
    return race === null ? 0 : raceSusceptibility(race.name);
}

/** The colony's damping factor from its owner: a ban (more with a Customs Bureau or Internal Security), government. Pure. */
function damping(galaxy: Galaxy, h: Habitat, e: Empire): number {
    let f = 1;
    if (policyOf(galaxy, e) === 'ban' && e !== rimTraderEmpire(galaxy)) {
        f *= 0.5;
        if (hasCustoms(galaxy, h)) f *= 0.5;
        if (scenarioFlag(galaxy, 'internalSecurity')) f *= 0.8;
    }
    const gov = empireGovernmentAttributes(e);
    if (gov !== null) f *= Math.min(1.4, Math.max(0.6, 2 - (gov.stability ?? 1)));
    return f;
}

function hasCustoms(galaxy: Galaxy, h: Habitat): boolean {
    return peekColony(galaxy, h)?.facilities.some((f) => f.id === 'customsBureau' && f.progress >= 1) ?? false;
}

interface Source {
    x: number;
    y: number;
    w: number;
}

function spreadSources(galaxy: Galaxy): Source[] {
    const st = vbState(galaxy);
    const out: Source[] = [];
    for (const w of st.worlds) {
        const h = w.habitat;
        if (h.hasBeenDestroyed || h.empire === null) continue;
        if (voidbloomStock(galaxy, h) <= 0 && w.produced <= 0) continue;
        // Smugglers' reach: a growing world exposes its region, more when its owner smuggles.
        out.push({ x: h.xpos, y: h.ypos, w: isSmuggler(galaxy, h.empire) ? 0.18 : 0.1 });
    }
    for (const k of Object.keys(st.colonies)) {
        const c = st.colonies[Number(k)];
        if (c.a < 0.2) continue;
        const h = galaxy.habitats[Number(k)];
        if (h === undefined || h === null || h.hasBeenDestroyed || h.empire === null) continue;
        out.push({ x: h.xpos, y: h.ypos, w: 0.1 * c.a });
    }
    return out;
}

/** The colonies the spread covers: every normal empire's (the Concord's included), fixed order. */
function spreadColonies(galaxy: Galaxy): Habitat[] {
    const out: Habitat[] = [];
    for (const e of normalEmpires(galaxy)) for (const h of e.colonies) if (!h.hasBeenDestroyed && bloomWorldOf(galaxy, h) === null) out.push(h);
    out.sort((a, b) => a.habitatIndex - b.habitatIndex);
    return out;
}

/**
 * The 30-day spread step. Exposure grows from nearby growing worlds and addicted colonies (reach voidbloomReachSectors),
 * × the Canton factor for the Concord's colonies (whose black market draws smugglers from anywhere once anyone grows),
 * × race susceptibility × the owner's damping × unhappiness. Supplied colonies (Voidbloom in stock) grow addicted;
 * unsupplied ones slowly recover (faster after neural detox) and suffer withdrawal meanwhile. No Rnd.
 */
export function spreadTick(galaxy: Galaxy): void {
    const st = vbState(galaxy);
    const now = galaxyStarDate(galaxy);
    const sources = spreadSources(galaxy);
    const reach = vbParam(galaxy, 'voidbloomReachSectors') * galaxy.sectorSize;
    const r = rimTraderEmpire(galaxy);
    const growing = st.worlds.some((w) => w.habitat.empire !== null && w.produced > 0);
    const rate = vbParam(galaxy, 'voidbloomAddictRate');
    const decay = vbParam(galaxy, 'voidbloomAddictDecay');
    for (const h of spreadColonies(galaxy)) {
        const e = h.empire!;
        const sus = colonySusceptibility(h);
        const existing = peekVbColony(galaxy, h);
        if (sus <= 0 && existing === null) continue;
        let dx = 0;
        for (const s of sources) {
            const d = galaxy.calculateDistance(s.x, s.y, h.xpos, h.ypos);
            if (d < reach && d > 1) dx += s.w * (1 - d / reach);
        }
        const isConcord = e === r;
        if (growsVoidbloom(galaxy, e)) dx *= 0.2;
        if (isConcord) dx = (dx + (growing ? 0.04 : 0)) * vbParam(galaxy, 'voidbloomCanton');
        if (dx <= 0 && existing === null) continue;
        const approval = empireApprovalRatingStock(galaxy, h);
        const unhappy = 1 + Math.max(0, (30 - approval) / 60);
        dx *= sus * damping(galaxy, h, e) * unhappy;
        const c = existing ?? vbColony(galaxy, h);
        if (c.tasted < 0) {
            c.x = Math.min(1, c.x + dx);
            if (c.x >= 1) c.tasted = now;
        }
        // Supplied: Voidbloom in stock, or a purchase on its way within the last 60 days (stock consumption eats it fast).
        // A grower's own posts hold its export stock: there only a purchase supplies (it keeps it off its own markets).
        const supplied = (voidbloomStock(galaxy, h) > 0 && !growsVoidbloom(galaxy, e)) || (c.buy !== undefined && now - c.buy <= 60 * GAME_DAY_LENGTH);
        if (supplied) {
            c.sup = now;
            c.a = Math.min(1, c.a + rate * Math.max(0.3, sus) * (isConcord ? vbParam(galaxy, 'voidbloomConcordAddict') : 1));
            // The habit eats the stock far faster than any stock luxury: voidbloomUse units per billion a month at full addiction
            // (the Canton market's dens more).
            const use = Math.ceil(vbParam(galaxy, 'voidbloomUse') * (isConcord ? vbParam(galaxy, 'voidbloomConcordDemand') : 1) * Math.max(0.05, c.a) * Math.max(0.2, (h.population?.totalAmount ?? 0) / 1e9));
            consumeVoidbloom(galaxy, h, use);
        } else if (c.a > 0) {
            const detox = vbEmpire(galaxy, e).detoxDone ? 4 : 1;
            c.a = Math.max(0, c.a - decay * detox);
        }
    }
}

/** Takes up to `n` units of Voidbloom from the colony's own stock (unreserved first). Returns units taken. */
function consumeVoidbloom(galaxy: Galaxy, h: Habitat, n: number): number {
    const id = voidbloomId(galaxy);
    if (h.cargo === null || n <= 0) return 0;
    let left = n;
    const items = h.cargo.items;
    for (let i = items.length - 1; i >= 0 && left > 0; i--) {
        const c = items[i];
        if (c.commodity.resourceId !== id) continue;
        const free = Math.max(0, c.amount - (c.reserved ?? 0));
        const take = Math.min(free, left);
        if (take <= 0) continue;
        c.amount -= take;
        left -= take;
        if (c.amount <= 0 && (c.reserved ?? 0) <= 0) items.splice(i, 1);
    }
    return n - left;
}

// ---------------------------------------------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------------------------------------------

/** Days since the colony last held Voidbloom (Infinity never). Pure. */
function daysSinceSupply(galaxy: Galaxy, sup: number): number {
    return sup < 0 ? Infinity : (galaxyStarDate(galaxy) - sup) / GAME_DAY_LENGTH;
}

/** The approval term at `h` (null: none): the short high of a fresh supply, addiction, withdrawal. Pure. */
export function voidbloomApproval(galaxy: Galaxy, h: Habitat): number | null {
    if (!vbOn(galaxy)) return null;
    const c = peekVbColony(galaxy, h);
    if (c === null || (c.a <= 0 && c.tasted < 0)) return null;
    const since = daysSinceSupply(galaxy, c.sup);
    let v = -c.a * vbParam(galaxy, 'voidbloomAddictApproval');
    if (since <= 45) v += vbParam(galaxy, 'voidbloomBoostApproval') * (1 - 0.5 * c.a);
    else if (c.a > 0.05) v -= c.a * vbParam(galaxy, 'voidbloomWithdrawalApproval') * Math.min(1, (since - 45) / 120);
    const rounded = Math.round(v * 10) / 10;
    return rounded === 0 ? null : rounded;
}

/** colonyResourceBonuses: income lost to addiction (and the dens' idleness); a supplied colony's short development boost. */
function resourceBonuses(galaxy: Galaxy, value: Habitat['resourceBonuses'], h: Habitat): Habitat['resourceBonuses'] {
    if (!vbOn(galaxy)) return value;
    const c = peekVbColony(galaxy, h);
    if (c === null || (c.a <= 0.01 && c.sup < 0)) return value;
    const id = voidbloomId(galaxy);
    const out = [...value];
    const loss = Math.round(Math.min(90, c.a * vbParam(galaxy, 'voidbloomIncomeLossPct') * concordHarm(galaxy, h)));
    if (loss > 0) out.push({ resourceId: id, effect: ColonyResourceEffect.IncomeBoost, value: -loss, appliesOnlyToSources: false });
    if (daysSinceSupply(galaxy, c.sup) <= 45 && c.a < 0.5) out.push({ resourceId: id, effect: ColonyResourceEffect.Development, value: Math.round(20 * (1 - 2 * c.a)), appliesOnlyToSources: false });
    return out;
}

function corruption(galaxy: Galaxy, v: number, h: Habitat): number {
    if (!vbOn(galaxy)) return v;
    const c = peekVbColony(galaxy, h);
    if (c === null || c.a <= 0) return v;
    return v * (1 + c.a * vbParam(galaxy, 'voidbloomCorruption') * concordHarm(galaxy, h));
}

/** The Concord's colonies suffer the habit harder (idle dens, a court that taxes nothing): voidbloomConcordHarm, else 1. Pure. */
function concordHarm(galaxy: Galaxy, h: Habitat): number {
    return h.empire !== null && h.empire === rimTraderEmpire(galaxy) ? vbParam(galaxy, 'voidbloomConcordHarm') : 1;
}

/**
 * Every 30 days: the court's own habit. The Concord's treasury pays out voidbloomConcordDrainPctYear % a year of what
 * it holds × its addiction index (officials' purchases, tribute to the smuggling houses), so the drain grows with the
 * treasury instead of a fixed sum. The silver goes to the empires that sold into the Concord (by their sales, ids
 * ascending), the pirate syndicate when none did. No Rnd.
 */
export function treasuryDrain(galaxy: Galaxy): number {
    const r = rimTraderEmpire(galaxy);
    if (r === null || r.stateMoney <= 0) return 0;
    const add = concordAddiction(galaxy);
    if (add <= 0.005) return 0;
    const st = vbState(galaxy);
    const out = r.stateMoney * (vbParam(galaxy, 'voidbloomConcordDrainPctYear') / 100) * add * (PERIOD_DAYS / 360);
    if (!(out > 0)) return 0;
    const sellers: { e: Empire; w: number }[] = [];
    let sum = 0;
    for (const e of normalEmpires(galaxy)) {
        if (e === r) continue;
        const w = st.empires[e.empireId]?.soldConcord ?? 0;
        if (w <= 0) continue;
        sellers.push({ e, w });
        sum += w;
    }
    r.stateMoney -= out;
    if (sum > 0) for (const s of sellers) performPrivateTransaction(s.e, (out * s.w) / sum);
    else {
        const syn = syndicate(galaxy);
        if (syn !== null) syn.stateMoney += out;
    }
    st.stats.stateDrain += out;
    st.stats.courtDrain = (st.stats.courtDrain ?? 0) + out;
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Smuggler runs: the black market's own deliveries
// ---------------------------------------------------------------------------------------------------------------
//
// The stock market only matches an empire's orders against posts in systems it has explored, and the Concord barely
// explores: its black market would never be reached. So every 30 days the smugglers come to it: for colonies whose
// market is banned (the Concord's, a banning empire's hooked colonies), a smuggler with Voidbloom within reach sends one
// of its idle freighters — a real ship with the cargo aboard (inspected, hunted, seized like any other) on a Transport
// mission from its post to the colony. It is paid at dispatch, as a stock contract is (initiateContract), and the
// purchase runs through onContract (premium, the silver drain, the first taste). No Rnd.

const RUNS_PER_TICK = 6;

function runOf(galaxy: Galaxy, bo: BuiltObject): SmugglerRun | null {
    for (const r of peekVbState(galaxy)?.runs ?? []) if (r.ship === bo) return r;
    return null;
}

/** cmdLoad hook: a smuggler run sails pre-loaded. */
export function smugglerRunSkipLoad(galaxy: Galaxy, bo: BuiltObject): boolean {
    return vbOn(galaxy) && runOf(galaxy, bo) !== null;
}

function freeVoidbloom(galaxy: Galaxy, holder: { cargo: { items: { commodity: { resourceId: number }; amount: number; reserved: number }[] } | null }, owner: Empire): number {
    const id = voidbloomId(galaxy);
    let n = 0;
    for (const c of holder.cargo?.items ?? []) if (c.commodity.resourceId === id && cargoEmpireId(c as never) === owner.empireId) n += Math.max(0, c.amount - c.reserved);
    return n;
}

function takeVoidbloom(galaxy: Galaxy, holder: { cargo: { items: { commodity: { resourceId: number }; amount: number; reserved: number }[] } | null }, owner: Empire, n: number): number {
    const id = voidbloomId(galaxy);
    const items = holder.cargo?.items ?? [];
    let left = n;
    for (let i = items.length - 1; i >= 0 && left > 0; i--) {
        const c = items[i];
        if (c.commodity.resourceId !== id || cargoEmpireId(c as never) !== owner.empireId) continue;
        const take = Math.min(left, Math.max(0, c.amount - c.reserved));
        c.amount -= take;
        left -= take;
        if (c.amount <= 0 && c.reserved <= 0) items.splice(i, 1);
    }
    return n - left;
}

/** Smugglers' posts holding Voidbloom: their Voidbloom worlds and space ports. */
function smugglerPosts(galaxy: Galaxy): { post: Habitat | BuiltObject; owner: Empire; free: number }[] {
    const out: { post: Habitat | BuiltObject; owner: Empire; free: number }[] = [];
    const st = vbState(galaxy);
    for (const w of st.worlds) {
        const h = w.habitat;
        const o = h.empire;
        if (h.hasBeenDestroyed || o === null || !isSmuggler(galaxy, o)) continue;
        const free = freeVoidbloom(galaxy, h, o);
        if (free >= 20) out.push({ post: h, owner: o, free });
    }
    for (const e of normalEmpires(galaxy)) {
        if (!isSmuggler(galaxy, e)) continue;
        for (const p of e.spacePorts) {
            if (p === null || p.hasBeenDestroyed) continue;
            const free = freeVoidbloom(galaxy, p, e);
            if (free >= 20) out.push({ post: p, owner: e, free });
        }
    }
    return out;
}

/** The colonies only smugglers can serve: hooked colonies in a banned market (the Concord's always). Fixed order. */
function blackMarkets(galaxy: Galaxy): Habitat[] {
    const st = vbState(galaxy);
    const r = rimTraderEmpire(galaxy);
    const out: Habitat[] = [];
    for (const k of Object.keys(st.colonies)) {
        const c = st.colonies[Number(k)];
        if (c.tasted < 0) continue;
        const h = galaxy.habitats[Number(k)];
        if (h === undefined || h === null || h.hasBeenDestroyed || !isNormal(galaxy, h.empire) || bloomWorldOf(galaxy, h) !== null) continue;
        const e = h.empire;
        if (e !== r && (policyOf(galaxy, e) !== 'ban' || c.a < 0.05)) continue;
        out.push(h);
    }
    // The Canton market first.
    out.sort((a, b) => (a.empire === r ? 0 : 1) - (b.empire === r ? 0 : 1) || a.habitatIndex - b.habitatIndex);
    return out;
}

export function smugglerRuns(galaxy: Galaxy): number {
    const st = vbState(galaxy);
    const now = galaxyStarDate(galaxy);
    st.runs = st.runs.filter((x) => !x.ship.hasBeenDestroyed && builtObjectMission(x.ship.mission)?.type === BuiltObjectMissionType.Transport && now - x.since < YEAR_LENGTH);
    let posts = smugglerPosts(galaxy);
    if (posts.length === 0) return 0;
    const reach = 45 * galaxy.sectorSize;
    const id = voidbloomId(galaxy);
    const use = vbParam(galaxy, 'voidbloomUse');
    let sent = 0;
    const freighters = new Map<Empire, BuiltObject[]>();
    for (const h of blackMarkets(galaxy)) {
        if (sent >= RUNS_PER_TICK) break;
        const buyer = h.empire!;
        const c = st.colonies[h.habitatIndex];
        const want = Math.max(40, Math.ceil(3 * use * (buyer === rimTraderEmpire(galaxy) ? vbParam(galaxy, 'voidbloomConcordDemand') : 1) * Math.max(0.1, c.a) * Math.max(0.2, (h.population?.totalAmount ?? 0) / 1e9)));
        const coming = st.runs.filter((x) => x.dest === h).reduce((n, x) => n + x.amount, 0);
        const need = want - voidbloomStock(galaxy, h) - coming;
        if (need < 20) continue;
        // The nearest smuggler post within reach that may dock there.
        let best: { post: Habitat | BuiltObject; owner: Empire; free: number } | null = null;
        let bd = Infinity;
        for (const p of posts) {
            if (p.owner === buyer || p.free < 20) continue;
            const d = galaxy.calculateDistance(p.post.xpos, p.post.ypos, h.xpos, h.ypos);
            if (d > reach || d >= bd) continue;
            const carrier = p.owner === galaxy.independentEmpire ? galaxy.independentEmpire : p.owner;
            if (!isStellarObjectDockable(galaxy, h, carrier)) continue;
            best = p;
            bd = d;
        }
        if (best === null) continue;
        const owner = best.owner;
        let pool = freighters.get(owner);
        if (pool === undefined) {
            pool = determineAvailableFreighters(owner).available.filter((b) => b.role === BuiltObjectRole.Freight && b.cargoCapacity > 0 && b.cargo !== null && !b.hasBeenDestroyed);
            freighters.set(owner, pool);
        }
        if (pool.length === 0) continue;
        let ship = pool[0];
        let sd = Infinity;
        for (const b of pool) {
            const d = galaxy.calculateDistance(b.xpos, b.ypos, best.post.xpos, best.post.ypos);
            if (d < sd) {
                sd = d;
                ship = b;
            }
        }
        const amount = Math.min(best.free, need, Math.max(20, ship.cargoCapacity));
        const taken = takeVoidbloom(galaxy, best.post, owner, amount);
        if (taken <= 0) continue;
        best.free -= taken;
        pool.splice(pool.indexOf(ship), 1);
        ship.cargo!.add(new Cargo(new ResourceRef(id), taken, buyer));
        const manifest = new CargoList();
        manifest.add(new Cargo(new ResourceRef(id), taken, buyer));
        assignMission(galaxy, ship, BuiltObjectMissionType.Transport, best.post, h, BuiltObjectMissionPriority.Normal, { cargo: manifest });
        // The black market's own price (the galaxy price falls with the glut of legal supply).
        const value = taken * vbParam(galaxy, 'voidbloomPrice');
        // As a stock contract pays at initiation (contracts.ts initiateContract): the buyer's private sector pays the seller.
        performPrivateTransaction(buyer, -value);
        if (owner !== galaxy.independentEmpire) performPrivateTransaction(owner, value);
        onContract(galaxy, { seller: owner, buyer, destination: h, resourceId: id, amount: taken, value, freighter: ship });
        st.runs.push({ ship, dest: h, buyerId: buyer.empireId, sellerId: owner.empireId, amount: taken, since: now });
        st.stats.runs = (st.stats.runs ?? 0) + 1;
        sent++;
        posts = posts.filter((p) => p.free >= 20);
        if (posts.length === 0) break;
    }
    return sent;
}

// ---------------------------------------------------------------------------------------------------------------
// Bans at home: colonies seize it
// ---------------------------------------------------------------------------------------------------------------

/** 30 days: a banning empire's colonies seize Voidbloom (50 %, +25 % Customs Bureau, +15 % Internal Security). */
export function homeSeizures(galaxy: Galaxy): void {
    const st = vbState(galaxy);
    const r = rimTraderEmpire(galaxy);
    for (const e of normalEmpires(galaxy)) {
        if (e === r || policyOf(galaxy, e) !== 'ban') continue;
        for (const h of e.colonies) {
            if (h.hasBeenDestroyed || bloomWorldOf(galaxy, h) !== null || voidbloomStock(galaxy, h) <= 0) continue;
            let p = 0.5;
            if (hasCustoms(galaxy, h)) p += 0.25;
            if (scenarioFlag(galaxy, 'internalSecurity')) p += 0.15;
            if (!(galaxy.rnd.nextDouble() < p)) continue;
            const n = removeVoidbloom(galaxy, h);
            st.stats.seizedAtHome += n;
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Warnings (spread, withdrawal crises, spore dens)
// ---------------------------------------------------------------------------------------------------------------

function warnings(galaxy: Galaxy): void {
    const st = vbState(galaxy);
    const now = galaxyStarDate(galaxy);
    const r = rimTraderEmpire(galaxy);
    for (const k of Object.keys(st.colonies)) {
        const c = st.colonies[Number(k)];
        const h = galaxy.habitats[Number(k)];
        if (h === undefined || h === null || h.hasBeenDestroyed || !isNormal(galaxy, h.empire)) continue;
        const e = h.empire;
        // First taste in a human's colony: a quiet warning (ticker only).
        if (c.tasted >= 0 && now - c.tasted < PERIOD_DAYS * GAME_DAY_LENGTH && isHuman(galaxy, e)) {
            scenarioMessage(galaxy, e, scenarioText('Voidbloom Spread Title'), scenarioText('Voidbloom Spread', h.name), { type: EmpireMessageType.GeneralWarning, subject: h, popup: false });
        }
        // A withdrawal crisis: an addicted colony cut off for 120 days.
        const since = daysSinceSupply(galaxy, c.sup);
        if (c.a >= 0.35 && since >= 120 && c.wd < 0) {
            c.wd = now;
            st.stats.withdrawalCrises++;
            if (isHuman(galaxy, e)) scenarioMessage(galaxy, e, scenarioText('Voidbloom Withdrawal Title'), scenarioText('Voidbloom Withdrawal', h.name), { type: EmpireMessageType.GeneralBadEvent, subject: h, popup: false });
        } else if (c.wd >= 0 && since < 45) c.wd = -1;
        // Spore dens in the Concord.
        if (e === r && c.a >= 0.5 && !c.den) {
            c.den = true;
            scenarioNews(galaxy, null, scenarioText('Voidbloom Dens News', h.name, r.name), () => true, h);
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The AI's policy (yearly)
// ---------------------------------------------------------------------------------------------------------------

/** `e` holds a Voidbloom world. Pure. */
export function growsVoidbloom(galaxy: Galaxy, e: Empire): boolean {
    for (const w of peekVbState(galaxy)?.worlds ?? []) if (w.habitat.empire === e && !w.habitat.hasBeenDestroyed) return true;
    return false;
}

/** Voidbloom held or grown by `e` (units in stock at its worlds and colonies). Pure. */
export function voidbloomHeld(galaxy: Galaxy, e: Empire): number {
    let n = 0;
    for (const w of peekVbState(galaxy)?.worlds ?? []) if (w.habitat.empire === e) n += voidbloomStock(galaxy, w.habitat) + 1;
    return n;
}

/**
 * The AI's policy: a grower smuggles unless it is friendly and lawful with addicted colonies of its own; a non-grower
 * bans it once its own colonies are hooked (or it is cautious and Voidbloom has reached it), else leaves it legal. A
 * crackdown it backed down from keeps it legal. Pure.
 */
export function aiPolicy(galaxy: Galaxy, e: Empire): VbPolicy {
    const own = addictionIndex(galaxy, e);
    const cd = peekVbState(galaxy)?.crackdowns.find((c) => c.targetId === e.empireId && c.status === 'backedDown' && galaxyStarDate(galaxy) < c.until) ?? null;
    if (voidbloomHeld(galaxy, e) > 0) {
        if (cd !== null) return 'legal';
        const aggr = (aggressionLevel(e) - 100) / 50;
        const friendly = (friendlinessLevel(e) - 100) / 50;
        const standing = rimTraderEmpire(galaxy) !== null ? rimTraderStanding(galaxy, e.empireId) : 0;
        const score = 1 + aggr - 0.5 * friendly + (standing < 0 ? 0.5 : 0) - own;
        return score > 0 ? 'smuggle' : 'legal';
    }
    // A non-grower bans it once its own colonies are hooked (cautious governments sooner).
    const caution = (cautionLevel(e) - 100) / 50;
    if (own >= 0.15 - 0.05 * Math.max(-1, Math.min(1, caution))) return 'ban';
    return 'legal';
}

export function setPolicy(galaxy: Galaxy, e: Empire, policy: VbPolicy, byPlayer: boolean): boolean {
    if (!vbOn(galaxy) || !isNormal(galaxy, e) || e === rimTraderEmpire(galaxy)) return false;
    if (policy !== 'smuggle' && policy !== 'legal' && policy !== 'ban') return false;
    const r = vbEmpire(galaxy, e);
    if (byPlayer) r.auto = false;
    if (r.policy === policy) return true;
    r.policy = policy;
    return true;
}

function policyYear(galaxy: Galaxy): void {
    const r = rimTraderEmpire(galaxy);
    for (const e of normalEmpires(galaxy)) {
        if (e === r) continue;
        const rec = vbEmpire(galaxy, e);
        if (isHuman(galaxy, e) && !rec.auto) continue;
        if (isHuman(galaxy, e)) continue; // a human's policy is the human's (default legal)
        const p = aiPolicy(galaxy, e);
        if (p !== rec.policy) {
            rec.policy = p;
            if (p === 'ban') scenarioNews(galaxy, e, scenarioText('Voidbloom Ban News', e.name), (x) => x !== e, null);
        }
    }
    // The silver drain figure: the Concord's yearly outflow.
    const st = vbState(galaxy);
    const y = gameYear(galaxyStarDate(galaxy));
    const total = st.stats.stateDrain + st.stats.privateDrain;
    const prev = st.drainByYear.length > 0 ? st.drainByYear.reduce((s, d) => s + d.value, 0) : 0;
    st.drainByYear.push({ year: y, value: Math.max(0, total - prev) });
    if (st.drainByYear.length > 30) st.drainByYear.splice(0, st.drainByYear.length - 30);
    void crackdownOn;
    void fmt;
    void concord;
}

// ---------------------------------------------------------------------------------------------------------------
// Registrations
// ---------------------------------------------------------------------------------------------------------------

registerScenarioQuery({ id: 'voidbloom.orders', flag: VOIDBLOOM_FLAG, query: 'extraLuxuryOrders', run: extraOrders });
registerScenarioQuery({ id: 'voidbloom.available', flag: VOIDBLOOM_FLAG, query: 'contractAvailable', run: voidbloomContractAvailable });
registerScenarioQuery({ id: 'voidbloom.bonuses', flag: VOIDBLOOM_FLAG, query: 'colonyResourceBonuses', run: (g, v, a) => resourceBonuses(g, v, a.habitat) });
registerScenarioQuery({ id: 'voidbloom.corruption', flag: VOIDBLOOM_FLAG, query: 'colonyCorruptionFactor', run: (g, v, a) => corruption(g, v, a.habitat) });
registerStabilityTerm({ id: 'voidbloom.addiction', flag: VOIDBLOOM_FLAG, cause: 'voidbloom', label: 'Voidbloom', run: (g, h, e) => (e === null ? null : voidbloomApproval(g, h)) });
registerScenarioEvent({ id: 'voidbloom.contract', flag: VOIDBLOOM_FLAG, event: 'contractInitiated', run: (g, p) => onContract(g, p) });
registerScenarioPeriodic({
    id: 'voidbloom.spread',
    flag: VOIDBLOOM_FLAG,
    periodDays: PERIOD_DAYS,
    run: (g) => {
        spreadTick(g);
        treasuryDrain(g);
        homeSeizures(g);
        smugglerRuns(g);
        warnings(g);
    },
});
registerScenarioYearly({ id: 'voidbloom.policy', flag: VOIDBLOOM_FLAG, order: 41, run: (g) => policyYear(g) });
