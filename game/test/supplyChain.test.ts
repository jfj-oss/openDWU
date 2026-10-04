// Improvements "supplyChain" (sim/logistics/supplyChain.ts): what a construction yard waits for, which contracts bring
// it, the colonies short of luxuries, the overlay markers and the per-resource view — on the seed-1 harness game.
// The queries are read-only: the state digest and the Rnd draw count do not move.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { BuiltObject } from '../src/sim/builtObject';
import type { Habitat } from '../src/sim/types';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { Cargo, ResourceRef } from '../src/sim/cargo';
import { Contract } from '../src/sim/logistics/contracts';
import { OrderType, empireCreateOrder } from '../src/sim/logistics/orders';
import { estimateTravelMs } from '../src/sim/player/constructionBoard';
import { stateDigest } from '../src/sim/tick/digest';
import { builtObjectManufacturingQueue, habitatManufacturingQueue } from '../src/sim/manufacturingQueue';
import { ResourceGroup, resourceGroupOf } from '../src/sim/resourceSystem';
import {
    colonyLuxuryStatus,
    componentsStillToBuild,
    constructionSupply,
    deliveryEtaMs,
    empireResourceStock,
    LUXURY_WAIT_MS,
    empireConstructionTargets,
    empireSupplySnapshot,
    queueItems,
    resourceSupplyView,
    shortageMarkers,
    supplyQueueOf,
    type SupplyTarget,
} from '../src/sim/logistics/supplyChain';
import { DAY_MS, formatEtaDays, needStatus, shortageTooltip, siteTooltipLines } from '../src/ui/supplyChainText';
import { siteSupplyLabel, waitingRows } from '../src/ui/screens/constructionYards';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 600_000);

/** The first site (any empire) with a ship on a slipway that still has unbuilt components. */
function busySite(galaxy: Galaxy): { empire: Empire; target: SupplyTarget; ship: BuiltObject } {
    for (const e of galaxy.empires) {
        for (const t of empireConstructionTargets(e)) {
            const q = supplyQueueOf(t)!;
            for (const it of queueItems(q)) if (it.yard !== null && componentsStillToBuild(it.ship, it.yard).length > 0) return { empire: e, target: t, ship: it.ship };
        }
    }
    throw new Error('no busy construction site in the harness game');
}

/** The objects sharing the site's cargo (a colony and the bases at it). */
function poolOf(target: SupplyTarget): SupplyTarget[] {
    const colony = target instanceof BuiltObject ? target.parentHabitat : target;
    const out: SupplyTarget[] = [target];
    if (colony === null) return out;
    if (colony !== target && colony.cargo === target.cargo) out.push(colony);
    for (const b of colony.basesAtHabitat) if (b !== target && b.cargo === target.cargo) out.push(b);
    return out;
}

/** Starve the site: drop its pool's cargo of its empire, the components in manufacture and the pool's orders. */
function starve(galaxy: Galaxy, target: SupplyTarget): void {
    const cargo = target.cargo!;
    cargo.items = cargo.items.filter((c) => c.empire !== target.empire);
    const pool = poolOf(target);
    for (const o of pool) {
        const mq = o instanceof BuiltObject ? builtObjectManufacturingQueue(o) : habitatManufacturingQueue(o);
        for (const m of mq?.manufacturers ?? []) m.component = null;
    }
    const own = new Set<unknown>(pool);
    for (const o of [...galaxy.orders.items]) if (own.has(o.requestingBuiltObject ?? o.requestingColony)) galaxy.orders.remove(o);
}

/** Resources the queue's items need, in queue order, nothing being in stock: per item, resource id → units. */
function expectedNeeds(target: SupplyTarget): Map<number, number>[] {
    return queueItems(supplyQueueOf(target)!).map((it) => {
        const m = new Map<number, number>();
        for (const def of componentsStillToBuild(it.ship, it.yard)) for (const r of def.resourceRequirements) m.set(r.resourceId, (m.get(r.resourceId) ?? 0) + r.amount);
        return m;
    });
}

describe('construction: a stalled yard and what it waits for', () => {
    it('finds the stalled yard with the right missing resources, and nothing coming', () => {
        const { galaxy } = cachedTickGame(gameData, { seconds: 60 });
        const { target, ship } = busySite(galaxy);
        starve(galaxy, target);
        const [site] = constructionSupply(galaxy, [target]);
        expect(site.target).toBe(target);
        expect(site.stalled).toBe(true);
        expect(site.nothingComing).toBe(true);
        const want = expectedNeeds(target);
        expect(site.items.length).toBe(want.length);
        site.items.forEach((item, i) => {
            const got = new Map(item.needs.map((n) => [n.resourceId, n.missing]));
            expect(got, item.ship.name).toEqual(want[i]);
            expect(item.componentsReady).toBe(0);
            expect(item.componentsInManufacture).toBe(0);
            for (const n of item.needs) {
                expect(n.uncovered).toBe(n.missing);
                expect(n.deliveries).toEqual([]);
                expect(needStatus(n)).toBe('none');
            }
        });
        const first = site.items.find((i) => i.ship === ship)!;
        expect(first.yard).not.toBeNull();
        expect(first.stalled).toBe(true);
        // Per site: the totals over the queue.
        const totals = new Map<number, number>();
        for (const m of want) for (const [k, v] of m) totals.set(k, (totals.get(k) ?? 0) + v);
        expect(new Map(site.resources.map((r) => [r.resourceId, r.missing]))).toEqual(totals);
        // The yards screen's rows and labels.
        expect(siteSupplyLabel(site).cls).toBe('cy-stalled');
        const rows = waitingRows(galaxy, site);
        expect(rows.filter((r) => r.first).length).toBe(site.items.length);
        expect(rows.filter((r) => r.resourceId !== null).every((r) => r.status === 'none' && r.coming === 'nothing')).toBe(true);
        expect(siteTooltipLines(galaxy, site)[0]).toMatch(/stalled for resources/);
    });

    it('stock covers the earliest items first', () => {
        const { galaxy } = cachedTickGame(gameData, { seconds: 60 });
        const { target } = busySite(galaxy);
        starve(galaxy, target);
        const want = expectedNeeds(target);
        const [rid, units] = [...want[0]][0];
        // Exactly the first item's need of one resource in stock.
        target.cargo!.add(new Cargo(new ResourceRef(rid), units, target.empire));
        const [site] = constructionSupply(galaxy, [target]);
        expect(site.items[0].needs.find((n) => n.resourceId === rid)).toBeUndefined();
        if (site.items.length > 1 && want[1].has(rid)) expect(site.items[1].needs.find((n) => n.resourceId === rid)!.missing).toBe(want[1].get(rid));
    });

    it('matches incoming contracts: freighter, source, amount and ETA, in queue order', () => {
        const { galaxy } = cachedTickGame(gameData, { seconds: 60 });
        const { empire, target } = busySite(galaxy);
        starve(galaxy, target);
        const want = expectedNeeds(target);
        const [rid, need0] = [...want[0]][0];
        const freighter = [...empire.privateBuiltObjects, ...empire.builtObjects].find((b) => b.subRole === BuiltObjectSubRole.SmallFreighter || b.subRole === BuiltObjectSubRole.MediumFreighter || b.subRole === BuiltObjectSubRole.LargeFreighter);
        expect(freighter).toBeDefined();
        const supplier = galaxy.empires.find((e) => e !== empire)!.colonies[0];
        // One order: a contract on its way (not picked up) for part of it, the rest not yet contracted.
        const amount = need0 + 50;
        const order = empireCreateOrder(galaxy, empire, target, new ResourceRef(rid), amount + 70, false, OrderType.ConstructionShortage);
        const contract = new Contract(supplier, amount, rid, -1, empire.empireId);
        contract.freighter = freighter!;
        order.contracts.push(contract);
        const [site] = constructionSupply(galaxy, [target]);
        const n0 = site.items[0].needs.find((n) => n.resourceId === rid)!;
        expect(n0.missing).toBe(need0);
        expect(n0.byDeliveries).toBe(need0);
        expect(n0.uncovered).toBe(0);
        expect(n0.deliveries.length).toBe(1);
        const d = n0.deliveries[0].delivery;
        expect(d.contract).toBe(contract);
        expect(d.order).toBe(order);
        expect(d.freighter).toBe(freighter);
        expect(d.supplier).toBe(supplier);
        expect(d.destination).toBe(target);
        expect(d.amount).toBe(amount);
        expect(d.pickedUp).toBe(false);
        const eta = estimateTravelMs(galaxy, freighter!, freighter!.xpos, freighter!.ypos, supplier.xpos, supplier.ypos) + estimateTravelMs(galaxy, freighter!, supplier.xpos, supplier.ypos, target.xpos, target.ypos);
        expect(d.etaMs).toBeCloseTo(eta, 6);
        expect(n0.etaMs).toBeCloseTo(eta, 6);
        expect(needStatus(n0)).toBe('coming');
        // The 50 left on the contract and the 70 uncontracted go to the next item needing it.
        const later = site.items.slice(1).flatMap((it) => it.needs.filter((n) => n.resourceId === rid));
        if (later.length > 0) {
            expect(later[0].byDeliveries).toBe(Math.min(50, later[0].missing));
            expect(later[0].byOrders).toBe(Math.min(70, later[0].missing - later[0].byDeliveries));
        }
        const res = site.resources.find((r) => r.resourceId === rid)!;
        expect(res.orders!.deliveries.map((x) => x.contract)).toEqual([contract]);
        expect(res.orders!.uncontracted).toBe(70);
        // Picked up: straight to the destination.
        contract.amountPickedUp = amount;
        expect(deliveryEtaMs(galaxy, freighter!, supplier, target, true)).toBeCloseTo(estimateTravelMs(galaxy, freighter!, freighter!.xpos, freighter!.ypos, target.xpos, target.ypos), 6);
        // A destroyed freighter: no ETA, flagged.
        freighter!.hasBeenDestroyed = true;
        const [site2] = constructionSupply(galaxy, [target]);
        const d2 = site2.resources.find((r) => r.resourceId === rid)!.orders!.deliveries[0];
        expect(d2.etaMs).toBeNull();
        expect(d2.risks).toContain('freighterLost');
    });

    it('every live contract to an empire site is matched to it (harness game after 600 s)', () => {
        const { galaxy } = cachedTickGame(gameData, { seconds: 600 });
        let matched = 0;
        for (const e of galaxy.empires) {
            const snap = empireSupplySnapshot(galaxy, e);
            for (const site of snap.sites) {
                for (const r of site.resources) {
                    for (const d of r.orders?.deliveries ?? []) {
                        expect(d.order.contracts).toContain(d.contract);
                        expect(d.amount).toBe(d.contract.amountToFulfill - d.contract.amountDelivered);
                        expect(d.resourceId).toBe(r.resourceId);
                        matched++;
                    }
                    // Every contract still to deliver on the site's own orders for that resource is listed.
                    const own = galaxy.orders.items.filter((o) => (o.requestingBuiltObject ?? o.requestingColony) === site.target && o.commodityResource?.resourceId === r.resourceId);
                    const live = own.flatMap((o) => o.contracts.filter((c) => c !== null && c.amountToFulfill - c.amountDelivered > 0));
                    const listed = new Set((r.orders?.deliveries ?? []).map((d) => d.contract));
                    for (const c of live) expect(listed.has(c!)).toBe(true);
                }
            }
        }
        expect(matched).toBeGreaterThan(0);
    });
});

describe('colonies short of luxuries', () => {
    it('development falling below DevelopmentLevel / 5 luxury types; a luxury held elsewhere but not coming', () => {
        const { galaxy } = cachedTickGame(gameData, { seconds: 60 });
        const empire = galaxy.playerEmpire!;
        const colony = empire.colonies.find((h) => h.population.totalAmount > 0)!;
        const base = colonyLuxuryStatus(galaxy, colony)!;
        colony.developmentLevel = (base.luxuryTypes + 3) * 5;
        const st = colonyLuxuryStatus(galaxy, colony, null, 1)!;
        expect(st.typesForDevelopment).toBe(base.luxuryTypes + 3);
        expect(st.developmentFalling).toBe(true);
        expect(st.short).toBe(true);
        expect(colonyLuxuryStatus(galaxy, colony, null, 0)!.developmentFalling).toBe(false);
        // A luxury order for one the colony lacks, while another of the empire's objects holds some.
        const lux = galaxy.resourceSystem.resources.find((r) => resourceGroupOf(r) === ResourceGroup.Luxury && !(colony.cargo?.items ?? []).some((c) => c.commodity.resourceId === r.resourceId))!;
        const holder = [...empire.colonies, ...empire.builtObjects].find((o) => o !== colony && o.cargo !== null && o.cargo !== colony.cargo)!;
        holder.cargo!.add(new Cargo(new ResourceRef(lux.resourceId), 900, empire));
        for (const o of [...galaxy.orders.items]) if (o.requestingColony === colony && o.commodityResource?.resourceId === lux.resourceId) galaxy.orders.remove(o);
        const luxOrder = empireCreateOrder(galaxy, empire, colony, new ResourceRef(lux.resourceId), 300, false, OrderType.Standard, true);
        colony.developmentLevel = 0;
        // A fresh order is normal: not "not coming" yet.
        expect(colonyLuxuryStatus(galaxy, colony, null, 1, empireResourceStock(empire))!.demanded.find((d) => d.resourceId === lux.resourceId)!.notComing).toBe(false);
        luxOrder.expiryDate -= LUXURY_WAIT_MS + 1;
        const snap = empireSupplySnapshot(galaxy, empire);
        const cs = snap.byColony.get(colony)!;
        const need = cs.demanded.find((d) => d.resourceId === lux.resourceId)!;
        expect(need.notComing).toBe(true);
        expect(need.availableElsewhere).toBeGreaterThanOrEqual(900);
        expect(cs.short).toBe(true);
        expect(snap.shortColonies).toContain(cs);
        const marker = shortageMarkers(snap).find((m) => m.target === colony)!;
        expect(marker.colony).toBe(cs);
        expect(marker.severity).toBe('short');
        expect(shortageTooltip(galaxy, marker, empire)).toMatch(new RegExp(`${lux.name}: not coming`));
    });
});

describe('per-resource view and read-only queries', () => {
    it('lists producers, stock and needs; reads nothing it writes', () => {
        const { galaxy } = cachedTickGame(gameData, { seconds: 600 });
        const empire = galaxy.playerEmpire!;
        const before = stateDigest(galaxy);
        const draws = galaxy.rnd.drawCount;
        const snap = empireSupplySnapshot(galaxy, empire);
        // A resource the player's colonies mine.
        const h = empire.colonies.find((c) => c.population.totalAmount > 0 && c.resources.length > 0)!;
        const rid = h.resources[0].resourceId;
        const v = resourceSupplyView(galaxy, empire, rid, snap, null);
        expect(v.producers.some((p) => p.obj === h && p.kind === 'colony')).toBe(true);
        let total = 0;
        for (const s of v.stock) total += s.amount;
        expect(v.totalStock).toBe(total);
        expect(v.stock.every((s) => s.amount > 0)).toBe(true);
        for (const e of galaxy.empires) shortageMarkers(empireSupplySnapshot(galaxy, e));
        expect(galaxy.rnd.drawCount).toBe(draws);
        expect(stateDigest(galaxy)).toBe(before);
    });
});

describe('texts', () => {
    it('formats ETAs in game days', () => {
        expect(formatEtaDays(null)).toBe('—');
        expect(formatEtaDays(DAY_MS / 2)).toBe('< 1 day');
        expect(formatEtaDays(DAY_MS)).toBe('1 day');
        expect(formatEtaDays(DAY_MS * 12.4)).toBe('12 days');
        expect(formatEtaDays(DAY_MS * 540)).toBe('1.5 years');
    });
    it('classifies how a need is covered', () => {
        expect(needStatus({ byDeliveries: 10, byOrders: 0, uncovered: 0 })).toBe('coming');
        expect(needStatus({ byDeliveries: 5, byOrders: 5, uncovered: 0 })).toBe('ordered');
        expect(needStatus({ byDeliveries: 5, byOrders: 0, uncovered: 5 })).toBe('partial');
        expect(needStatus({ byDeliveries: 0, byOrders: 0, uncovered: 5 })).toBe('none');
    });
});
