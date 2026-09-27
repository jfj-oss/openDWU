// Scenario package 19a "rim trader" (tasks/19a-rim-trader.md): hook registrations — game start (place / find the
// Oranthi Concord, seed its rare goods), the contract listener (standing ledger) and the yearly handler (decay,
// consumption, import orders, stock move, terms messages). Not a port: every stock call it makes is ported code.
// Rnd: only the game-start handler draws (createEmpireMidGame / scenarioFindHomeHabitat / the abundance rolls).

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import { BuiltObject } from '../../builtObject';
import { Cargo, ResourceRef, type CargoList } from '../../cargo';
import { registerScenarioEvent, registerScenarioGameStart, registerScenarioYearly, scenarioFindHomeHabitat, type HomePlacementHelpers } from '../hooks';
import { createEmpireMidGame } from '../empireMidGame';
import { galaxyRaceByName } from '../../story/storyEvents';
import { scenarioMessage, scenarioText } from '../messages';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../../diplomacy';
import { OrderType, cargoGetCargo, cargoRemove, empireCreateOrder } from '../../logistics/orders';
import { EmpireMessageType } from '../../messages';
import { applyConcordTech, treasureParam, treasureState } from './treasureFleet';
import { RIM_RACE, rareGoodIds, resourceName, isRimGood, rimGoodIds, rimParam, rimTradeState, rimTraderEmpire, rimTraderPort } from './common';

/** Import order lot size (units). */
export const IMPORT_LOT = 100;

/** The cargo list of the Concord's port (a space port's hold or the capital's). */
export function rimTraderPortCargo(galaxy: Galaxy): CargoList | null {
    const port = rimTraderPort(galaxy);
    return port === null ? null : port.cargo;
}

/** Units of `resourceId` the Concord holds at its port. */
export function rimTraderPortStock(galaxy: Galaxy, resourceId: number): number {
    const r = rimTraderEmpire(galaxy);
    const cargo = rimTraderPortCargo(galaxy);
    if (r === null || cargo === null) return 0;
    return cargoGetCargo(cargo, resourceId, r)?.amount ?? 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Game start (step 3)
// ---------------------------------------------------------------------------------------------------------------

/** Step 3c: the rare goods go on the Concord capital (≤ 5 resources: the lowest-abundance non-critical ones make room). */
function seedRareGoods(galaxy: Galaxy, r: Empire, capital: Habitat): void {
    const rare = rareGoodIds(galaxy);
    // Defensive: no rare good anywhere else.
    for (const h of galaxy.habitats) {
        if (h === capital || h.resources.length === 0) continue;
        if (h.resources.some((x) => rare.includes(x.resourceId))) h.resources = h.resources.filter((x) => !rare.includes(x.resourceId));
    }
    const critical = new Set((r.dominantRace?.criticalResources ?? []).filter((b) => b != null).map((b) => b.resourceId));
    for (const id of rare) {
        if (capital.resources.some((x) => x.resourceId === id)) continue;
        const abundance = galaxy.rnd.next(700, 1000);
        if (capital.resources.length >= 5) {
            let drop = -1;
            for (let i = 0; i < capital.resources.length; i++) {
                const x = capital.resources[i];
                if (critical.has(x.resourceId) || rare.includes(x.resourceId)) continue;
                if (drop < 0 || x.abundance < capital.resources[drop].abundance) drop = i;
            }
            if (drop < 0) continue;
            capital.resources.splice(drop, 1);
        }
        capital.resources.push({ resourceId: id, abundance });
    }
}

/** Step 3d: the starting stock of rare goods in the port's hold (Concord-owned). */
function seedPortStock(galaxy: Galaxy, r: Empire): void {
    const cargo = rimTraderPortCargo(galaxy);
    const amount = Math.trunc(rimParam(galaxy, 'rimTraderStartStock'));
    if (cargo === null || amount <= 0) return;
    for (const id of rareGoodIds(galaxy)) cargo.add(new Cargo(new ResourceRef(id), amount, r));
}

/** The game-start handler `rimTrade.start` (flag rimTrader). Exported for tests. */
export function rimTraderGameStart(galaxy: Galaxy, ctx: HomePlacementHelpers): void {
    const st = rimTradeState(galaxy);
    let r = galaxy.empires.find((e) => e !== null && e.active && e.dominantRace?.name === RIM_RACE && e.pirateEmpireBaseHabitat === null) ?? null;
    if (r === null) {
        const race = galaxyRaceByName(galaxy, RIM_RACE);
        const home = race !== null ? scenarioFindHomeHabitat(galaxy, race, race.nativeHabitatType, ctx, galaxy.sectorSize * 0.7) : null;
        if (home === null) {
            st.empireId = -1;
            return;
        }
        // 19a addendum: created at tech level rimTraderTechLevel (GenerateEmpire techLevel → SetTechTreeLevel).
        r = createEmpireMidGame(galaxy, { race: RIM_RACE, home, age: galaxy.startingAge, techLevel: treasureParam(galaxy, 'rimTraderTechLevel'), homeSystemFavourability: 'Excellent', setup: true });
        if (r === null) {
            st.empireId = -1;
            return;
        }
        applyConcordTech(galaxy, r, false);
    } else if (r !== galaxy.playerEmpire) {
        // An Oranthi AI the wizard already generated (at the game's tech level): lift it to the Concord's.
        applyConcordTech(galaxy, r, true);
    }
    treasureState(galaxy);
    st.empireId = r.empireId;
    st.capital = r.capital;
    // The AI Concord carries the scenario's name (a player who picks the Oranthi keeps the name they chose).
    if (r !== galaxy.playerEmpire) r.name = scenarioText('Scenario RimTrade Empire Name');
    if (r.capital === null) return;
    seedRareGoods(galaxy, r, r.capital);
    seedPortStock(galaxy, r);
}

// ---------------------------------------------------------------------------------------------------------------
// Contract listener (step 6): the standing ledger. No Rnd.
// ---------------------------------------------------------------------------------------------------------------

export function rimTraderOnContract(galaxy: Galaxy, ev: { seller: Empire; buyer: Empire; resourceId: number; amount: number; value: number; freighter?: BuiltObject | null }): void {
    const r = rimTraderEmpire(galaxy);
    if (r === null || ev.resourceId < 0) return;
    const st = rimTradeState(galaxy);
    if (ev.buyer === r && ev.seller !== r && isRimGood(galaxy, ev.resourceId)) {
        // 19a follow-up: a sale through a pirate / independent post is credited to the empire whose private freighter
        // carried it (the freighter's owner earned it), so pirate markets do not swallow the standing.
        let creditor = ev.seller;
        const carrier = ev.freighter?.actualEmpire ?? null;
        if ((creditor === galaxy.independentEmpire || creditor.pirateEmpireBaseHabitat !== null) && carrier !== null && carrier !== r && carrier !== galaxy.independentEmpire && carrier.pirateEmpireBaseHabitat === null) creditor = carrier;
        const row = (st.ledger[creditor.empireId] ??= { credit: 0, debit: 0 });
        row.credit += ev.value;
        st.stats.rimBuys++;
        st.stats.rimUnits += ev.amount;
        st.stats.rimValue += ev.value;
    } else if (ev.seller === r && ev.buyer !== r && rareGoodIds(galaxy).includes(ev.resourceId)) {
        const row = (st.ledger[ev.buyer.empireId] ??= { credit: 0, debit: 0 });
        row.debit += ev.value;
        st.stats.rareSales++;
        st.stats.rareUnits += ev.amount;
        st.stats.rareValue += ev.value;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Yearly handler (step 12). No Rnd.
// ---------------------------------------------------------------------------------------------------------------

export function rimTraderYear(galaxy: Galaxy): void {
    const r = rimTraderEmpire(galaxy);
    if (r === null) return;
    const st = rimTradeState(galaxy);
    // a. Decay.
    const decay = rimParam(galaxy, 'rimTraderLedgerDecay');
    for (const key of Object.keys(st.ledger)) {
        const row = st.ledger[Number(key)];
        row.credit *= decay;
        row.debit *= decay;
    }
    const port = rimTraderPort(galaxy);
    const cargo = port?.cargo ?? null;
    if (port !== null && cargo !== null) {
        // b. Consumption (R5).
        const consumption = Math.trunc(rimParam(galaxy, 'rimTraderConsumption'));
        for (const id of rimGoodIds(galaxy)) {
            const c = cargoGetCargo(cargo, id, r);
            if (c === null) continue;
            const used = Math.min(c.amount, consumption);
            if (c.amount - used <= 0) cargoRemove(cargo, c);
            else c.amount -= used;
        }
        // c. Import orders (R4): state orders at the port so that `quota` units are always on order. The Concord's own
        //    production does not count (as specified the rule was quota − stock, but the Concord's rim mining stations keep
        //    its port far above any quota, so it never bought: the soak showed 0 purchases in 10 years). Tribute, not need.
        const quota = Math.trunc(rimParam(galaxy, 'rimTraderImportQuota'));
        const orders = port instanceof BuiltObject ? galaxy.orders.getOrdersForBuiltObject(port) : galaxy.orders.getOrdersForHabitat(port);
        for (const id of rimGoodIds(galaxy)) {
            let outstanding = 0;
            for (const o of orders.items) if (o.commodityResource !== null && o.commodityResource.resourceId === id) outstanding += o.amountOutstandingToContract;
            // In lots of IMPORT_LOT units: the stock market check (CheckOrderIsAffordable) prices a whole order against
            // the state treasury, so one large order would stall whenever the treasury is low.
            for (let want = quota - outstanding; want > 0; want -= IMPORT_LOT) {
                empireCreateOrder(galaxy, r, port, new ResourceRef(id), Math.min(want, IMPORT_LOT), true, OrderType.Standard);
            }
        }
        // d. Rare-goods stock move: colony extraction lands in the capital's hold; foreign buyers reach only the port.
        const capital = r.capital;
        if (port instanceof BuiltObject && capital !== null && capital.cargo !== null) {
            const keep = Math.trunc(rimParam(galaxy, 'rimTraderStartStock'));
            for (const id of rareGoodIds(galaxy)) {
                const c = cargoGetCargo(capital.cargo, id, r);
                if (c === null || c.available <= keep) continue;
                const move = c.available - keep;
                c.amount -= move;
                cargo.add(new Cargo(new ResourceRef(id), move, r));
            }
        }
    }
    // e. Terms message, once per empire, after first contact.
    const rare = rareGoodIds(galaxy).map((id) => resourceName(galaxy, id)).join(', ');
    const rim = rimGoodIds(galaxy).map((id) => resourceName(galaxy, id)).join(', ');
    for (const e of galaxy.empires) {
        if (e === null || e === r || !e.active || e === galaxy.independentEmpire || e.pirateEmpireBaseHabitat !== null) continue;
        if (st.informed.includes(e.empireId)) continue;
        if (obtainDiplomaticRelation(r, e).type === DiplomaticRelationType.NotMet) continue;
        st.informed.push(e.empireId);
        scenarioMessage(galaxy, e, scenarioText('Scenario RimTrade Terms Title'), scenarioText('Scenario RimTrade Terms', r.name, rare, rim), { type: EmpireMessageType.GeneralNeutralEvent, sender: r, subject: r.capital });
    }
}

registerScenarioGameStart({ id: 'rimTrade.start', flag: 'rimTrader', run: rimTraderGameStart });
registerScenarioEvent({ id: 'rimTrade.ledger', flag: 'rimTrader', event: 'contractInitiated', run: rimTraderOnContract });
registerScenarioYearly({ id: 'rimTrade.year', flag: 'rimTrader', order: 10, run: (galaxy) => rimTraderYear(galaxy) });
