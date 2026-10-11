// Colony Economy phase 3: the refinement chain (Option A, the user's choice; docs/ECONOMY.md §5). Not a port.
//
// Five refined goods — Alloys, Electronics, Polymer Composites, Reactor Fuel Cells, Exotics — are new resource types.
// They exist only in a game started with the refinement flag on (scenario/hooks.ts registerScenarioDataExtension: the
// game data gets them at createGame / deserializeGame / the sim-worker replica), so a game with the flag off keeps the
// stock resource tables and stays byte-identical. They have no distributions (never on a planet) and stay out of
// generation's resource shuffle (scenario/scenarioGoods.ts).
//
//   Production: a refinery (a private facility of its designation: Smelter, Chemical Plant and Fuel Refinery at
//     Mining Hubs, Electronics Fab and Exotic Materials Lab at Core Worlds) works every 30 days at
//     the colony's space port (else the colony): it takes up to REFINE_INPUT units of each of its raw inputs held there
//     by the owner and makes half as many units of its good, into the same cargo. Short of inputs, it orders them
//     (empireCreateOrder: the stock order / freight / contract path brings them and pays the seller's private sector).
//   Hauling: every 30 days each own shipyard with work queued orders the goods it is short of (up to YARD_TARGET each,
//     Exotics EXOTIC_TARGET); the stock freight path fulfils the orders from the trading posts holding them (a
//     refinery's port or colony), so private freighters carry them and the private sectors are paid.
//   Use: a ship or base completed at a yard consumes goods by its components (ComponentCategoryType → good; one unit
//     per component, from the yard's cargo, what it holds). The yard's construction speed (colonyConstructionFactor,
//     kind 'yard') is SPEED_MIN + SPEED_RANGE × the share of the four common goods it holds at YARD_TARGET (+ EXOTIC_BONUS
//     with any Exotics): missing goods mean SLOWER builds, never a blocked one.
//   AI: refineries are valued highly while the empire has yards and no refinery of that good (effects.ts
//     facilityValue).
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
import { registerScenarioDataExtension, registerScenarioEvent, registerScenarioPeriodic } from '../hooks';
import { registerScenarioGoods } from '../scenarioGoods';
import { ECON_FAC_FLAG, ECON_FLAG, ECON_REFINE_FLAG, activeFacilities, econOn, empireRecord, isEconEmpire, type FacilityId } from './common';

export interface GoodDef {
    key: 'alloys' | 'electronics' | 'polymers' | 'fuelCells' | 'exotics';
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
];
export const GOOD_NAMES = GOODS.map((g) => g.name);
registerScenarioGoods(GOOD_NAMES);

export const REFINE_RULES = {
    periodDays: 30,
    /** Units of each input a refinery takes a period at most (×strength × governor skill). */
    refineInput: 60,
    /** An input-short refinery orders this much of an input. */
    inputOrder: 200,
    yardTarget: 60,
    exoticTarget: 10,
    speedMin: 0.95,
    speedRange: 0.25,
    exoticBonus: 0.05,
};
const R = REFINE_RULES;

// --- The data extension -------------------------------------------------------------------------------------------

/** The game data with the five goods appended (ids follow the last resource; unchanged when they are already there). */
export function withRefinedGoods(gd: GameData): GameData {
    if (gd.resources.some((r) => GOOD_NAMES.includes(r.name))) return gd;
    const base = gd.resources.length;
    const added: Resource[] = GOODS.map((g, i) => ({
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
            let short = -1;
            let shortHeld = Infinity;
            for (const id of inputIds(galaxy, g)) {
                const have = heldAt(post, id, e);
                if (have < shortHeld) {
                    shortHeld = have;
                    short = id;
                }
                taken += take(post, id, e, per);
            }
            const out = Math.floor(taken / 2);
            if (out > 0) {
                add(post, ids[gi], e, out);
                made[g.key] = (made[g.key] ?? 0) + out;
            }
            // Short of an input: order it (the stock freight path brings it).
            if (short >= 0 && shortHeld < per && pendingOrder(galaxy, e, post, short) <= 0) {
                empireCreateOrder(galaxy, e, post, new ResourceRef(short), R.inputOrder, false, OrderType.Standard);
            }
        }
    }
}

// --- Yard demand and use ------------------------------------------------------------------------------------------------

function yardBusy(yard: BuiltObject): boolean {
    const q = yard.constructionQueue as ConstructionQueue | null;
    if (q === null) return false;
    if ((q.constructionWaitQueue?.length ?? 0) > 0) return true;
    return (q.constructionYards ?? []).some((y) => y.shipUnderConstruction !== null);
}

function orderForYards(galaxy: Galaxy, e: Empire, ids: readonly number[]): void {
    for (const yard of e.spacePorts as BuiltObject[]) {
        if (yard === null || yard.hasBeenDestroyed || !yard.isShipYard || !yardBusy(yard)) continue;
        for (let gi = 0; gi < GOODS.length; gi++) {
            const target = gi === 4 ? R.exoticTarget : R.yardTarget;
            const want = target - heldAt(yard, ids[gi], e) - pendingOrder(galaxy, e, yard, ids[gi]);
            // A state order: the state pays for what its yards use, the refinery's private sector earns.
            if (want >= target / 2) empireCreateOrder(galaxy, e, yard, new ResourceRef(ids[gi]), Math.ceil(want), true, OrderType.Standard);
        }
    }
}

/** The yard's construction speed factor from the goods it holds (1 when refinement is off). Pure. */
export function yardGoodsFactor(galaxy: Galaxy, yard: BuiltObject | null): number {
    if (yard === null || yard.empire === null || !refinementActive(galaxy) || !isEconEmpire(galaxy, yard.empire)) return 1;
    const ids = goodIds(galaxy)!;
    let share = 0;
    for (let gi = 0; gi < 4; gi++) share += Math.min(1, heldAt(yard, ids[gi], yard.empire) / R.yardTarget);
    let f = R.speedMin + R.speedRange * (share / 4);
    if (heldAt(yard, ids[4], yard.empire) > 0) f += R.exoticBonus;
    return f;
}

/** Goods a completed ship / base needs (by GOODS index): one unit per component of the good's categories. Pure. */
export function goodsNeeded(bo: BuiltObject): number[] {
    const need = GOODS.map(() => 0);
    for (const c of bo.components.items) {
        for (let gi = 0; gi < GOODS.length; gi++) if (GOODS[gi].categories.includes(c.category)) need[gi]++;
    }
    return need;
}

function consume(galaxy: Galaxy, ship: BuiltObject, yard: BuiltObject | null): void {
    const e = ship.empire;
    if (yard === null || e === null || !isEconEmpire(galaxy, e)) return;
    const ids = goodIds(galaxy)!;
    const need = goodsNeeded(ship);
    const r = empireRecord(galaxy, e);
    const used = (r.goodsUsed ??= {});
    let missing = 0;
    for (let gi = 0; gi < GOODS.length; gi++) {
        const got = take(yard, ids[gi], e, need[gi]);
        used[GOODS[gi].key] = (used[GOODS[gi].key] ?? 0) + got;
        missing += need[gi] - got;
    }
    r.buildsShort = (r.buildsShort ?? 0) + (missing > 0 ? 1 : 0);
    r.buildsTotal = (r.buildsTotal ?? 0) + 1;
}

export function refinementTick(galaxy: Galaxy): void {
    if (!refinementActive(galaxy)) return;
    const ids = goodIds(galaxy)!;
    for (const e of galaxy.empires) {
        if (!isEconEmpire(galaxy, e)) continue;
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
        if (refinementActive(galaxy)) consume(galaxy, p.builtObject, p.yard ?? null);
    },
});

/** The colony screen's goods line: what this colony's port and yards hold. Pure. */
export function colonyGoodsView(galaxy: Galaxy, h: Habitat): { name: string; held: number }[] | null {
    if (!refinementActive(galaxy) || h.empire === null) return null;
    const ids = goodIds(galaxy)!;
    const posts: (Habitat | BuiltObject)[] = [h, ...h.basesAtHabitat.filter((b) => b !== null && !b.hasBeenDestroyed && (b.isSpacePort || b.isShipYard))];
    return GOODS.map((g, gi) => ({ name: g.name, held: posts.reduce((s, o) => s + heldAt(o, ids[gi], h.empire!), 0) }));
}
