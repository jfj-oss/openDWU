// Colony Economy phases 3-4: the refinement chain (Option A, the user's choice; docs/ECONOMY.md §5). Not a port.
//
// Six refined goods — Alloys, Electronics, Polymer Composites, Reactor Fuel Cells, Exotics and (phase 4) the third-step
// Precision Components — are new resource types. They exist only in a game started with the refinement flag on
// (scenario/hooks.ts registerScenarioDataExtension: the game data gets them at createGame / deserializeGame / the
// sim-worker replica), so a game with the flag off keeps the stock resource tables and stays byte-identical. They have
// no distributions (never on a planet) and stay out of generation's resource shuffle (scenario/scenarioGoods.ts).
//
//   Production: a refinery (a private facility: Smelter, Chemical Plant and Fuel Refinery at Mining Hubs, Electronics
//     Fab, Exotic Materials Lab and Precision Works at Core Worlds) works every 30 days at the colony's space port (else
//     the colony): it takes up to REFINE_INPUT units of each of its inputs held there by the owner and makes half as
//     many units of its good, into the same cargo. Short of inputs, it orders them (empireCreateOrder: the stock order /
//     freight / contract path brings them and pays the seller's private sector).
//   Need (phase 4, the user's decision): a component's tech level is the techLevel of the research node that unlocks it
//     (real: Galaxy.3.cs SetResearchCosts → ComponentDefinition.techLevel). Tech 0-2 need nothing; tech 3 and 4 need one
//     unit of the category's good (soft: missing goods slow the build to ×0.7 / ×0.6, in proportion); tech 5-6 need two,
//     plus one Electronics for weapons / shields / sensors (hard: the build waits at the yard); tech 7+ need three (four
//     for reactors, hyperdrives and weapons, which also need one Exotics) and one Precision Components (hard). A design
//     sums its components; bases need half. Pirates and independents are exempt (isEconEmpire).
//   Early bonus: while none of an empire's researched components needs a good, its yards build up to 15 % faster with
//     the four common goods in stock and its ships cost 5 % less (designPriceFactor); the stock carries over.
//   Hauling: every 30 days each own shipyard (and colony queue) with work queued orders the goods it is short of: the
//     queued builds' needs, at least YARD_TARGET of each common good while the early bonus lasts.
//   Use: a ship or base completed at a yard consumes its need from the yard's cargo.
// No Rnd.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import type { BuiltObject } from '../../builtObject';
import type { GameData } from '../../data/gameData';
import type { Resource } from '../../data/resources';
import { ComponentCategoryType } from '../../data/policies';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { Cargo, ResourceRef } from '../../cargo';
import { OrderType, empireCreateOrder, cargoIndexOf, cargoAvailable } from '../../logistics/orders';
import type { ConstructionQueue } from '../../construction/constructionQueue';
import { BuiltObjectRole } from '../../data/designSpecifications';
import type { Design } from '../../design';
import { registerScenarioDataExtension, registerScenarioEvent, registerScenarioPeriodic, registerScenarioQuery } from '../hooks';
import { registerScenarioGoods } from '../scenarioGoods';
import { findGalaxyBuiltObjectById } from '../../builtObjectById';
import { galaxyStarDate } from '../../tick/simTime';
import { isHumanEmpire } from '../../humanEmpires';
import { DAY, ECON_FAC_FLAG, ECON_FLAG, ECON_REFINE_FLAG, activeFacilities, econOn, empireRecord, isEconEmpire, peekEmpire, type FacilityId } from './common';

export interface GoodDef {
    key: 'alloys' | 'electronics' | 'polymers' | 'fuelCells' | 'exotics' | 'precision';
    name: string;
    facility: FacilityId;
    inputs: readonly string[];
    basePrice: number;
    /** Our own icon (public/art/economy/good-<key>.svg; resource PictureRef 9000 + index). */
    pictureRef: number;
    categories: readonly ComponentCategoryType[];
}

const C = ComponentCategoryType;
export const GOODS: readonly GoodDef[] = [
    { key: 'alloys', name: 'Alloys', facility: 'smelter', inputs: ['Steel', 'Iridium', 'Lead', 'Carbon Fibre'], basePrice: 30, pictureRef: 9000, categories: [C.Armor, C.Engine, C.Construction, C.AssaultPod, C.Extractor, C.Manufacturer] },
    {
        key: 'electronics',
        name: 'Electronics',
        facility: 'electronicsFab',
        inputs: ['Silicon', 'Chromium', 'Aculon', 'Gold'],
        basePrice: 40,
        pictureRef: 9001,
        categories: [C.WeaponBeam, C.WeaponTorpedo, C.WeaponArea, C.WeaponPointDefense, C.WeaponIon, C.WeaponGravity, C.Shields, C.ShieldRecharge, C.Sensor, C.Computer, C.Labs, C.HyperDisrupt],
    },
    { key: 'polymers', name: 'Polymer Composites', facility: 'chemicalPlant', inputs: ['Polymer', 'Helium', 'Argon', 'Krypton'], basePrice: 25, pictureRef: 9002, categories: [C.Habitation, C.Storage, C.Fighter] },
    { key: 'fuelCells', name: 'Reactor Fuel Cells', facility: 'fuelRefinery', inputs: ['Caslon', 'Hydrogen', 'Tyderios'], basePrice: 35, pictureRef: 9003, categories: [C.Reactor, C.HyperDrive, C.EnergyCollector] },
    { key: 'exotics', name: 'Exotics', facility: 'exoticsLab', inputs: ['Emeros Crystal', 'Nekros Stone', 'Osalia', 'Dilithium Crystal'], basePrice: 80, pictureRef: 9004, categories: [C.WeaponSuperBeam, C.WeaponSuperArea, C.WeaponSuperTorpedo] },
    // Phase 4: the third step, from two refined goods; needed by every tech-7+ component (no category of its own).
    { key: 'precision', name: 'Precision Components', facility: 'precisionWorks', inputs: ['Electronics', 'Exotics'], basePrice: 150, pictureRef: 9005, categories: [] },
];
export const G_ALLOYS = 0;
export const G_ELECTRONICS = 1;
export const G_EXOTICS = 4;
export const G_PRECISION = 5;
export const GOOD_NAMES = GOODS.map((g) => g.name);
registerScenarioGoods(GOOD_NAMES);

export const REFINE_RULES = {
    periodDays: 30,
    /** Units of each input a refinery takes a period at most (×strength × governor skill). */
    refineInput: 100,
    /** An input-short refinery orders this much of an input. */
    inputOrder: 200,
    yardTarget: 60,
    exoticTarget: 10,
    /** A yard orders at most this much of a good for its queued builds. */
    demandCap: 400,
    /** Soft tiers: a build missing all its tech-3 / tech-4 goods runs at ×0.7 / ×0.6. */
    tier3Penalty: 0.3,
    tier4Penalty: 0.4,
    /** Early bonus: up to +15 % build speed with the four common goods at yardTarget, ships 5 % cheaper. */
    earlySpeedBonus: 0.15,
    earlyPriceFactor: 0.95,
    /** A yard holding at least this share of the common goods counts as supplied (the early price bonus). */
    earlySuppliedShare: 0.25,
    /** AI safeguard: an AI build waiting this long for hard goods goes on at aiReliefFactor (no deadlock). */
    aiReliefDays: 120,
    aiReliefFactor: 0.5,
};
const R = REFINE_RULES;

// --- The data extension -------------------------------------------------------------------------------------------

/** The game data with the goods appended (ids follow the last resource; only the missing ones, so a phase-3 game keeps its ids). */
export function withRefinedGoods(gd: GameData): GameData {
    const missing = GOODS.filter((g) => !gd.resources.some((r) => r.name === g.name));
    if (missing.length === 0) return gd;
    const base = gd.resources.length;
    const added: Resource[] = missing.map((g, i) => ({
        resourceId: base + i,
        name: g.name,
        pictureRef: g.pictureRef,
        basePrice: g.basePrice,
        type: 0,
        superLuxuryBonusAmount: 0,
        isFuel: false,
        isImportantPreWarpResource: false,
        colonyGrowthResourceLevel: 0,
        colonyManufacturingLevel: 0,
        distributions: [],
    }));
    return { ...gd, resources: [...gd.resources, ...added] };
}

registerScenarioDataExtension({ id: 'colonyEconomy.goods', flags: [ECON_FLAG, ECON_FAC_FLAG, ECON_REFINE_FLAG], extend: withRefinedGoods });

// --- Lookups -------------------------------------------------------------------------------------------------------

const idCache = new WeakMap<object, number[] | null>();

/** The goods' resource ids in GOODS order (null: this game has no goods — refinement off, or added to a save). Pure. */
export function goodIds(galaxy: Galaxy): number[] | null {
    const res = galaxy.resources;
    if (idCache.has(res)) return idCache.get(res) ?? null;
    const ids: number[] = [];
    for (const name of GOOD_NAMES) {
        const r = res.find((x) => x.name === name);
        if (r === undefined) {
            idCache.set(res, null);
            return null;
        }
        ids.push(r.resourceId);
    }
    idCache.set(res, ids);
    return ids;
}

export function refinementActive(galaxy: Galaxy): boolean {
    return econOn(galaxy, ECON_FAC_FLAG) && econOn(galaxy, ECON_REFINE_FLAG) && goodIds(galaxy) !== null;
}

function inputIds(galaxy: Galaxy, g: GoodDef): number[] {
    const out: number[] = [];
    for (const n of g.inputs) {
        const r = galaxy.resources.find((x) => x.name === n);
        if (r !== undefined) out.push(r.resourceId);
    }
    return out;
}

/** Where a colony trades: its space port base (the stock trading post) or the colony itself. */
export function tradingPostOf(h: Habitat): Habitat | BuiltObject {
    for (const b of h.basesAtHabitat) {
        if (b !== null && !b.hasBeenDestroyed && b.isSpacePort && (b.subRole === BuiltObjectSubRole.SmallSpacePort || b.subRole === BuiltObjectSubRole.MediumSpacePort || b.subRole === BuiltObjectSubRole.LargeSpacePort)) return b;
    }
    return h;
}

function cargoOf(o: Habitat | BuiltObject): import('../../cargo').CargoList | null {
    return o.cargo;
}

export function heldAt(o: Habitat | BuiltObject, resourceId: number, e: Empire): number {
    const c = cargoOf(o);
    if (c === null) return 0;
    const i = cargoIndexOf(c, resourceId, e);
    return i >= 0 ? Math.max(0, cargoAvailable(c.items[i])) : 0;
}

function take(o: Habitat | BuiltObject, resourceId: number, e: Empire, amount: number): number {
    const c = cargoOf(o);
    if (c === null || amount <= 0) return 0;
    const i = cargoIndexOf(c, resourceId, e);
    if (i < 0) return 0;
    const n = Math.min(amount, Math.max(0, cargoAvailable(c.items[i])));
    c.items[i].amount -= n;
    return n;
}

function add(o: Habitat | BuiltObject, resourceId: number, e: Empire, amount: number): void {
    const c = cargoOf(o);
    if (c === null || amount <= 0) return;
    c.add(new Cargo(new ResourceRef(resourceId), amount, e));
}

/** Units already ordered by `requester` for `resourceId` (open orders). */
function pendingOrder(galaxy: Galaxy, e: Empire, requester: Habitat | BuiltObject, resourceId: number): number {
    let n = 0;
    for (const o of galaxy.orders.getOrdersForEmpire(e).items) {
        if ((o.requestingColony === requester || o.requestingBuiltObject === requester) && o.commodityResource !== null && o.commodityResource.resourceId === resourceId) n += Math.max(0, o.amountRequested - o.amountDelivered);
    }
    return n;
}

// --- Production ------------------------------------------------------------------------------------------------------

function produce(galaxy: Galaxy, e: Empire, ids: readonly number[]): void {
    const r = empireRecord(galaxy, e);
    const made = (r.goodsMade ??= {});
    for (const h of e.colonies) {
        for (const f of activeFacilities(galaxy, h)) {
            const gi = GOODS.findIndex((g) => g.facility === f.id);
            if (gi < 0) continue;
            const g = GOODS[gi];
            const post = tradingPostOf(h);
            const per = R.refineInput;
            let taken = 0;
            const short: number[] = [];
            for (const id of inputIds(galaxy, g)) {
                if (heldAt(post, id, e) < per) short.push(id);
                taken += take(post, id, e, per);
            }
            const out = Math.floor(taken / 2);
            if (out > 0) {
                add(post, ids[gi], e, out);
                made[g.key] = (made[g.key] ?? 0) + out;
            }
            // Short of inputs: order each one not already on order (the stock freight path brings them). Before
            // 2026-10-11 only the scarcest input was ordered a period, which starved the refineries.
            for (const id of short) if (pendingOrder(galaxy, e, post, id) <= 0) empireCreateOrder(galaxy, e, post, new ResourceRef(id), R.inputOrder, false, OrderType.Standard);
        }
    }
}

// --- Need by tech level (phase 4) ---------------------------------------------------------------------------------

const ELECTRONICS_EXTRA = new Set<ComponentCategoryType>([C.WeaponBeam, C.WeaponTorpedo, C.WeaponArea, C.WeaponPointDefense, C.WeaponIon, C.WeaponGravity, C.WeaponSuperBeam, C.WeaponSuperArea, C.WeaponSuperTorpedo, C.Shields, C.ShieldRecharge, C.Sensor]);
const TOP_CATEGORIES = new Set<ComponentCategoryType>([C.Reactor, C.HyperDrive, C.WeaponBeam, C.WeaponTorpedo, C.WeaponArea, C.WeaponPointDefense, C.WeaponIon, C.WeaponGravity, C.WeaponSuperBeam, C.WeaponSuperArea, C.WeaponSuperTorpedo]);
const GOOD_OF_CATEGORY = new Map<ComponentCategoryType, number>();
GOODS.forEach((g, gi) => g.categories.forEach((c) => GOOD_OF_CATEGORY.set(c, gi)));

/** A component's tech level (research.txt node techLevel; the super weapons' 100+ count as 7). */
export function componentTechLevel(def: { techLevel: number }): number {
    return def.techLevel >= 100 ? 7 : Math.max(0, def.techLevel);
}

/** What one component needs: hard units (the build waits), soft units and their penalty weight, by GOODS index. Pure. */
export interface GoodsNeed {
    hard: number[];
    soft: number[];
    /** Σ over soft units of the tier penalty (0.3 / 0.4 a unit). */
    softWeight: number[];
    any: boolean;
    anyHard: boolean;
}
function emptyNeed(): GoodsNeed {
    return { hard: GOODS.map(() => 0), soft: GOODS.map(() => 0), softWeight: GOODS.map(() => 0), any: false, anyHard: false };
}

function addComponentNeed(n: GoodsNeed, def: { techLevel: number; category: ComponentCategoryType }): void {
    const gi = GOOD_OF_CATEGORY.get(def.category);
    if (gi === undefined) return;
    const tl = componentTechLevel(def);
    if (tl <= 2) return;
    if (tl <= 4) {
        n.soft[gi] += 1;
        n.softWeight[gi] += tl === 3 ? R.tier3Penalty : R.tier4Penalty;
        n.any = true;
        return;
    }
    const top = TOP_CATEGORIES.has(def.category);
    n.hard[gi] += tl <= 6 ? 2 : top ? 4 : 3;
    if (ELECTRONICS_EXTRA.has(def.category)) n.hard[G_ELECTRONICS] += 1;
    if (tl >= 7) {
        if (top) n.hard[G_EXOTICS] += 1;
        n.hard[G_PRECISION] += 1;
    }
    n.any = true;
    n.anyHard = true;
}

const needCache = new WeakMap<Design, GoodsNeed>();
/** A design's need: the sum over its components; bases need half (rounded up). Static per design. Pure. */
export function designNeed(design: Design): GoodsNeed {
    let n = needCache.get(design);
    if (n !== undefined) return n;
    n = emptyNeed();
    for (const c of design.components as unknown as { techLevel: number; category: ComponentCategoryType }[]) addComponentNeed(n, c);
    if (design.role === BuiltObjectRole.Base) {
        for (let gi = 0; gi < GOODS.length; gi++) {
            n.hard[gi] = Math.ceil(n.hard[gi] / 2);
            n.softWeight[gi] = n.soft[gi] > 0 ? (n.softWeight[gi] * Math.ceil(n.soft[gi] / 2)) / n.soft[gi] : 0;
            n.soft[gi] = Math.ceil(n.soft[gi] / 2);
        }
    }
    needCache.set(design, n);
    return n;
}

/** Goods needed to complete `bo` (hard + soft, by GOODS index). Pure. */
export function goodsNeeded(bo: BuiltObject): number[] {
    const n = designNeed(bo.design);
    return n.hard.map((h, i) => h + n.soft[i]);
}

/** The yard / colony that builds `bo` holds its goods in this cargo owner. */
type Post = Habitat | BuiltObject;

/** Share (0..1) of the four common goods `post` holds at the yard target. Pure. */
export function commonShare(post: Post, e: Empire, ids: readonly number[]): number {
    let share = 0;
    for (let gi = 0; gi < 4; gi++) share += Math.min(1, heldAt(post, ids[gi], e) / R.yardTarget);
    return share / 4;
}

/**
 * The build-speed factor of `ship` at `post` (phase 4): 0 = waits for its hard goods; the soft tiers' proportional
 * penalty (×0.6-1); the early bonus. Pure.
 */
export function buildGoodsFactor(galaxy: Galaxy, e: Empire, post: Post, design: Design): number {
    const ids = goodIds(galaxy)!;
    const n = designNeed(design);
    if (!n.any) {
        const r = peekEmpire(galaxy, e);
        if (r === null || r.early !== true) return 1;
        return 1 + R.earlySpeedBonus * commonShare(post, e, ids);
    }
    let pen = 0;
    let units = 0;
    for (let gi = 0; gi < GOODS.length; gi++) {
        const hard = n.hard[gi];
        const soft = n.soft[gi];
        if (hard === 0 && soft === 0) continue;
        const held = heldAt(post, ids[gi], e);
        if (held < hard) return 0;
        if (soft > 0) {
            const missing = Math.max(0, 1 - (held - hard) / soft);
            pen += n.softWeight[gi] * missing;
            units += soft;
        }
    }
    return units > 0 ? 1 - pen / units : 1;
}

/** Where a build's goods are held: a shipyard base, or the colony of a colony queue (null: exempt, e.g. a constructor). */
function postOf(yard: BuiltObject | null, habitat: Habitat | null): Post | null {
    if (yard !== null) return yard.isShipYard ? yard : null;
    return habitat;
}

/** The query (constructionQueue.ts processSingleConstructionYard, per build): the goods factor, and waits counted. */
function slotFactor(galaxy: Galaxy, ship: BuiltObject, yard: BuiltObject | null, habitat: Habitat | null): number {
    if (!refinementActive(galaxy)) return 1;
    const post = postOf(yard, habitat);
    const e = post === null ? null : post.empire;
    if (post === null || e === null || !isEconEmpire(galaxy, e) || ship.design === null) return 1;
    const f = buildGoodsFactor(galaxy, e, post, ship.design);
    if (f === 0) {
        const r = empireRecord(galaxy, e);
        const w = (r.waitStart ??= {});
        const now = galaxyStarDate(galaxy);
        const since = w[ship.builtObjectID];
        if (since === undefined) w[ship.builtObjectID] = now;
        // AI safeguard (no deadlock): an AI build that has waited AI_RELIEF_DAYS goes on at the relief speed with what
        // the yard holds (the player's builds keep waiting; the treasury window shows them).
        else if (now - since > R.aiReliefDays * DAY && !isHumanEmpire(galaxy, e)) {
            r.reliefBuilds = (r.reliefBuilds ?? 0) + (r.reliefIds?.includes(ship.builtObjectID) ? 0 : 1);
            if (!(r.reliefIds ??= []).includes(ship.builtObjectID)) r.reliefIds.push(ship.builtObjectID);
            return R.aiReliefFactor;
        }
    }
    return f;
}

// --- Yard demand and use ------------------------------------------------------------------------------------------------

function queueBuilds(q: ConstructionQueue | null): BuiltObject[] {
    if (q === null) return [];
    const out: BuiltObject[] = [];
    for (const y of q.constructionYards ?? []) if (y.shipUnderConstruction !== null && !y.shipUnderConstruction.scrap && y.shipUnderConstruction.retrofitDesign === null) out.push(y.shipUnderConstruction);
    for (const b of q.constructionWaitQueue ?? []) if (b !== null && !b.scrap && b.retrofitDesign === null) out.push(b);
    return out;
}

function yardBusy(yard: BuiltObject): boolean {
    const q = yard.constructionQueue as ConstructionQueue | null;
    if (q === null) return false;
    if ((q.constructionWaitQueue?.length ?? 0) > 0) return true;
    return (q.constructionYards ?? []).some((y) => y.shipUnderConstruction !== null);
}

/** What the queued builds at `q` need in all (by GOODS index). Pure. */
export function queueDemand(q: ConstructionQueue | null): number[] {
    const d = GOODS.map(() => 0);
    for (const b of queueBuilds(q)) {
        if (b.design === null) continue;
        const need = goodsNeeded(b);
        for (let gi = 0; gi < GOODS.length; gi++) d[gi] += need[gi];
    }
    return d;
}

function orderAt(galaxy: Galaxy, e: Empire, post: Post, ids: readonly number[], demand: readonly number[], base: boolean): void {
    for (let gi = 0; gi < GOODS.length; gi++) {
        const baseTarget = base ? (gi === G_EXOTICS ? R.exoticTarget : gi === G_PRECISION ? 0 : R.yardTarget) : 0;
        const target = Math.min(R.demandCap, Math.max(baseTarget, demand[gi]));
        if (target <= 0) continue;
        const want = target - heldAt(post, ids[gi], e) - pendingOrder(galaxy, e, post, ids[gi]);
        // A state order: the state pays for what its yards use, the refinery's private sector earns.
        if (want >= Math.max(1, target / 2) || (demand[gi] > 0 && want > 0 && heldAt(post, ids[gi], e) < demand[gi] && pendingOrder(galaxy, e, post, ids[gi]) <= 0)) {
            empireCreateOrder(galaxy, e, post, new ResourceRef(ids[gi]), Math.ceil(want), true, OrderType.Standard);
        }
    }
}

function orderForYards(galaxy: Galaxy, e: Empire, ids: readonly number[]): void {
    const r = peekEmpire(galaxy, e);
    // The base targets (stock for the early bonus and the soft tiers) once anything needs goods, or while the early bonus lasts.
    const base = r !== null && (r.early === true || (r.goodsNow ?? []).some((t) => t >= 3));
    for (const yard of e.spacePorts as BuiltObject[]) {
        if (yard === null || yard.hasBeenDestroyed || !yard.isShipYard || !yardBusy(yard)) continue;
        orderAt(galaxy, e, yard, ids, queueDemand(yard.constructionQueue as ConstructionQueue | null), base);
    }
    // Colony queues (the bases a colony builds): their builds' needs only.
    for (const h of e.colonies) {
        const q = h.constructionQueue as ConstructionQueue | null;
        if (q === null) continue;
        const d = queueDemand(q);
        if (d.some((x) => x > 0)) orderAt(galaxy, e, h, ids, d, false);
    }
}

/** Phase 3's queue-level factor is replaced by the per-build one (buildGoodsFactor); kept for the UI. Pure. */
export function yardGoodsFactor(galaxy: Galaxy, yard: BuiltObject | null): number {
    void galaxy;
    void yard;
    return 1;
}

function consume(galaxy: Galaxy, ship: BuiltObject, yard: BuiltObject | null, habitat: Habitat | null): void {
    const e = ship.empire;
    const post = postOf(yard, habitat);
    if (post === null || e === null || !isEconEmpire(galaxy, e) || ship.design === null) return;
    const ids = goodIds(galaxy)!;
    const need = goodsNeeded(ship);
    const r = empireRecord(galaxy, e);
    const used = (r.goodsUsed ??= {});
    let missing = 0;
    for (let gi = 0; gi < GOODS.length; gi++) {
        if (need[gi] <= 0) continue;
        const got = take(post, ids[gi], e, need[gi]);
        used[GOODS[gi].key] = (used[GOODS[gi].key] ?? 0) + got;
        missing += need[gi] - got;
    }
    r.buildsShort = (r.buildsShort ?? 0) + (missing > 0 ? 1 : 0);
    r.buildsTotal = (r.buildsTotal ?? 0) + 1;
    const w = r.waitStart;
    if (w !== undefined && w[ship.builtObjectID] !== undefined) {
        delete w[ship.builtObjectID];
        r.buildsWaited = (r.buildsWaited ?? 0) + 1;
    }
    if (r.reliefIds !== undefined) r.reliefIds = r.reliefIds.filter((x) => x !== ship.builtObjectID);
}

// --- The empire's goods era (phase 4; every 30 days, saved) ----------------------------------------------------------

/** Per good, the highest tech level among `defs` that need it (0: none). Pure. */
export function goodsTiers(defs: readonly { techLevel: number; category: ComponentCategoryType }[]): number[] {
    const t = GOODS.map(() => 0);
    for (const d of defs) {
        const gi = GOOD_OF_CATEGORY.get(d.category);
        if (gi === undefined) continue;
        const tl = componentTechLevel(d);
        if (tl < 3) continue;
        t[gi] = Math.max(t[gi], tl);
        if (tl >= 5 && ELECTRONICS_EXTRA.has(d.category)) t[G_ELECTRONICS] = Math.max(t[G_ELECTRONICS], tl);
        if (tl >= 7) {
            if (TOP_CATEGORIES.has(d.category)) t[G_EXOTICS] = Math.max(t[G_EXOTICS], tl);
            t[G_PRECISION] = Math.max(t[G_PRECISION], tl);
        }
    }
    return t;
}

function reviewEra(galaxy: Galaxy, e: Empire, ids: readonly number[]): void {
    const r = empireRecord(galaxy, e);
    const rs = e.research;
    if (rs === null) return;
    r.goodsNow = goodsTiers(rs.researchedComponents);
    const next: { techLevel: number; category: ComponentCategoryType }[] = [];
    for (const n of rs.nextProjects ?? []) {
        for (const id of n.def.components) {
            const d = rs.definitionFor(id);
            if (d !== undefined) next.push(d);
        }
    }
    const tn = goodsTiers(next);
    r.goodsNext = tn.map((x, i) => Math.max(x, r.goodsNow![i]));
    r.early = r.goodsNow.every((x) => x < 3);
    let supplied = false;
    if (r.early) for (const y of e.spacePorts as BuiltObject[]) if (y !== null && !y.hasBeenDestroyed && y.isShipYard && commonShare(y, e, ids) >= R.earlySuppliedShare) supplied = true;
    r.earlySupplied = supplied;
    // Drop the waits of builds that no longer exist.
    const live = (id: number): boolean => {
        const b = findGalaxyBuiltObjectById(galaxy, id);
        return b !== null && !b.hasBeenDestroyed && b.builtAt !== null;
    };
    if (r.waitStart !== undefined) for (const k of Object.keys(r.waitStart)) if (!live(Number(k))) delete r.waitStart[k as unknown as number];
    if (r.reliefIds !== undefined && r.reliefIds.length > 0) r.reliefIds = r.reliefIds.filter(live);
}

/** The early bonus's price factor of `e` (designPriceFactor). Pure. */
export function earlyPriceFactor(galaxy: Galaxy, e: Empire | null): number {
    if (e === null) return 1;
    const r = peekEmpire(galaxy, e);
    return r !== null && r.early === true && r.earlySupplied === true && refinementActive(galaxy) ? R.earlyPriceFactor : 1;
}

/** No researched component of `e` needs good `gi` yet (a refinery of it earns +5 % income meanwhile). Pure. */
export function goodNotYetNeeded(galaxy: Galaxy, e: Empire, gi: number): boolean {
    const t = peekEmpire(galaxy, e)?.goodsNow;
    if (t === undefined) return true;
    return gi === G_PRECISION ? t[gi] < 7 : t[gi] < 3;
}

export function refinementTick(galaxy: Galaxy): void {
    if (!refinementActive(galaxy)) return;
    const ids = goodIds(galaxy)!;
    for (const e of galaxy.empires) {
        if (!isEconEmpire(galaxy, e)) continue;
        reviewEra(galaxy, e, ids);
        produce(galaxy, e, ids);
        orderForYards(galaxy, e, ids);
    }
}

registerScenarioPeriodic({ id: 'colonyEconomy.refinement', flag: ECON_FLAG, periodDays: R.periodDays, run: (g) => refinementTick(g) });
registerScenarioEvent({
    id: 'colonyEconomy.goodsUsed',
    flag: ECON_FLAG,
    event: 'builtObjectBuilt',
    run: (galaxy, p) => {
        if (refinementActive(galaxy)) consume(galaxy, p.builtObject, p.yard ?? null, p.habitat ?? null);
    },
});
registerScenarioQuery({ id: 'colonyEconomy.buildGoods', flag: ECON_FLAG, query: 'buildGoodsFactor', run: (g, v, a) => (refinementActive(g) ? v * slotFactor(g, a.ship, a.yard, a.habitat) : v) });

/** The colony screen's goods line: what this colony's port and yards hold. Pure. */
export function colonyGoodsView(galaxy: Galaxy, h: Habitat): { name: string; held: number }[] | null {
    if (!refinementActive(galaxy) || h.empire === null) return null;
    const ids = goodIds(galaxy)!;
    const posts: (Habitat | BuiltObject)[] = [h, ...h.basesAtHabitat.filter((b) => b !== null && !b.hasBeenDestroyed && (b.isSpacePort || b.isShipYard))];
    return GOODS.map((g, gi) => ({ name: g.name, held: posts.reduce((s, o) => s + heldAt(o, ids[gi], h.empire!), 0) }));
}

/** The Economy screen's yard supply: per own shipyard, the goods its queued builds lack and how many builds wait. Pure. */
export interface YardSupplyView {
    yard: string;
    colony: string;
    builds: number;
    waiting: number;
    lacking: { name: string; need: number; held: number }[];
}
export function yardSupplyView(galaxy: Galaxy, e: Empire): YardSupplyView[] {
    if (!refinementActive(galaxy)) return [];
    const ids = goodIds(galaxy)!;
    const out: YardSupplyView[] = [];
    for (const y of e.spacePorts as BuiltObject[]) {
        if (y === null || y.hasBeenDestroyed || !y.isShipYard) continue;
        const q = y.constructionQueue as ConstructionQueue | null;
        const builds = queueBuilds(q);
        const d = queueDemand(q);
        let waiting = 0;
        for (const yy of q?.constructionYards ?? []) if (yy.shipUnderConstruction !== null && yy.shipUnderConstruction.design !== null && buildGoodsFactor(galaxy, e, y, yy.shipUnderConstruction.design) === 0) waiting++;
        const lacking = GOODS.map((g, gi) => ({ name: g.name, need: d[gi], held: Math.round(heldAt(y, ids[gi], e)) })).filter((x) => x.need > x.held);
        out.push({ yard: y.name, colony: y.parentHabitat?.name ?? '', builds: builds.length, waiting, lacking });
    }
    return out;
}

/** Every good with its tier status for `e` (the Economy screen, alerts). Pure. */
export function empireGoodsStatus(galaxy: Galaxy, e: Empire): { key: string; name: string; now: number; next: number; refineries: number }[] {
    if (!refinementActive(galaxy)) return [];
    const r = peekEmpire(galaxy, e);
    return GOODS.map((g, gi) => {
        let n = 0;
        for (const h of e.colonies) for (const f of activeFacilities(galaxy, h)) if (f.id === g.facility) n++;
        return { key: g.key, name: g.name, now: r?.goodsNow?.[gi] ?? 0, next: r?.goodsNext?.[gi] ?? 0, refineries: n };
    });
}

