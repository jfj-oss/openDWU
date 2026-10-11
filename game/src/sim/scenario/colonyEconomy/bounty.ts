// Colony Economy phase 2: the Bounty Office's bounty hunters (docs/ECONOMY.md §3, the user's approved design). Not a
// port. An empire with a working Bounty Office keeps its own small armed private ships — built and kept up from
// private money only, through the same steps as the stock DirectPrivateConstruction (civilianAI.ts; privateers.ts
// buildPrivateer): the shortest private yard queue, AddBuiltObjectToGalaxy as a private object, the yard's income
// record, component orders, PerformPrivateTransaction. The design is the Privateers add-on's (privateers.ts
// generatePrivateerDesign: the empire's escort / frigate / destroyer template, one tech tier down, at most 40 % of the
// largest buildable ship), renamed "Bounty Hunter".
//   - Count: 3 + one per 500 k of private money, at most 6; +1 (still at most 6) when a character of the empire has the
//     BountyHunter trait (real: CharacterTraitType.BountyHunter).
//   - Missions (every 30 days, and when the stock assignment asks: the privateShipMission event): attack the nearest
//     pirate ship within 2 sectors of an office (pirate factions only), else patrol the office's colony.
//   - Bounty: a pirate ship destroyed by the empire's ships pays its private sector 25 % of the ship's price
//     (builtObjectKilledBy).
//   - With the Privateers add-on on, each office adds 2 to the privateer count cap (privateers.ts privateerHooks).
//   - Extras retire (scrap mission) when the office closes or private money runs short.
// No Rnd: picks by distance with id tie-breaks; names are counters.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import { BuiltObject } from '../../builtObject';
import type { Design } from '../../design';
import { CharacterTraitType } from '../../characters';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { MAXIMUM_CONSTRUCTION_QUEUE_WAIT_TIME_YEARS, findShortestConstructionWaitQueue } from '../../civilianAI';
import { assignScrapMission, procureConstructionComponentsAtBuiltObject } from '../../construction/empireConstruction';
import type { ConstructionQueue } from '../../construction/constructionQueue';
import { performPrivateTransaction } from '../../treasury';
import { performFinancialTransaction } from '../../logistics/contracts';
import { OrderType, empireCreateOrder } from '../../logistics/orders';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../missions/mission';
import { assignMission } from '../../missions/assign';
import { REAL_SECONDS_IN_GALACTIC_YEAR, galaxyStarDate } from '../../tick/simTime';
import { registerScenarioEvent, registerScenarioPeriodic } from '../hooks';
import { generatePrivateerDesign, privateerHooks } from '../privateers/privateers';
import { DAY, ECON_FAC_FLAG, ECON_FLAG, activeFacilities, econOn, empireRecord, hasPrivateSector, peekEmpire } from './common';

export const BOUNTY_RULES = {
    minHunters: 3,
    maxHunters: 6,
    moneyPerHunter: 500_000,
    range: 4_000_000,
    bountyShare: 0.25,
    reviewDays: 30,
    designReviewDays: 360,
    privateerBoost: 2,
};

/** Working Bounty Offices of `e`. Pure. */
export function bountyOffices(galaxy: Galaxy, e: Empire): Habitat[] {
    const out: Habitat[] = [];
    for (const h of e.colonies) for (const f of activeFacilities(galaxy, h)) if (f.id === 'bountyOffice') out.push(h);
    return out;
}

/** The hunter count the empire's private sector keeps (0 without an office). Pure. */
export function hunterCap(galaxy: Galaxy, e: Empire): number {
    if (bountyOffices(galaxy, e).length === 0) return 0;
    let n = BOUNTY_RULES.minHunters + Math.floor(Math.max(0, e.privateMoney) / BOUNTY_RULES.moneyPerHunter);
    if ((e.characters as { active: boolean; traits: CharacterTraitType[] }[]).some((c) => c.active && c.traits.includes(CharacterTraitType.BountyHunter))) n++;
    return Math.min(BOUNTY_RULES.maxHunters, n);
}

/** The empire's live hunters (built or building). */
export function empireHunters(galaxy: Galaxy, e: Empire): BuiltObject[] {
    const r = peekEmpire(galaxy, e);
    if (r === null || (r.hunters ?? []).length === 0) return [];
    return r.hunters!.filter((b) => !b.hasBeenDestroyed && b.empire === e);
}

export function isHunter(galaxy: Galaxy, bo: BuiltObject): boolean {
    if (bo.empire === null || bo.owner !== null) return false;
    const r = peekEmpire(galaxy, bo.empire);
    return r !== null && (r.hunters ?? []).includes(bo);
}

function hunterDesign(galaxy: Galaxy, e: Empire): Design | null {
    const r = empireRecord(galaxy, e);
    const now = galaxyStarDate(galaxy);
    if (r.hunterDesign != null && now - (r.hunterDesignDate ?? 0) < BOUNTY_RULES.designReviewDays * DAY) return r.hunterDesign;
    const d = generatePrivateerDesign(galaxy, e);
    if (d !== null) {
        d.name = d.name.replace(/^Privateer/, 'Bounty Hunter');
        r.hunterDesign = d;
        r.hunterDesignDate = now;
    }
    return r.hunterDesign ?? null;
}

function buildHunter(galaxy: Galaxy, e: Empire, design: Design): boolean {
    const r = empireRecord(galaxy, e);
    const price = design.calculateCurrentPurchasePrice(galaxy);
    if (price > e.privateMoney * 0.5) return false;
    const serial = (r.hunterSerial ?? 0) + 1;
    const bo = new BuiltObject(design, `${design.name} ${serial}`, galaxy);
    bo.purchasePrice = price;
    const found = findShortestConstructionWaitQueue(galaxy, e.spacePorts, bo);
    const yard = found.yard;
    if (yard === null || found.shortestWaitQueueTime / REAL_SECONDS_IN_GALACTIC_YEAR >= MAXIMUM_CONSTRUCTION_QUEUE_WAIT_TIME_YEARS) return false;
    const queue = yard.constructionQueue as ConstructionQueue | null;
    if (queue === null || !queue.addBuiltObjectToConstruct(bo)) return false;
    r.hunterSerial = serial;
    design.buildCount++;
    bo.suppressAutoRetrofit = true;
    e.addBuiltObjectToGalaxy(bo, yard, false, false);
    performFinancialTransaction(yard, price, galaxyStarDate(galaxy), false);
    bo.builtAt = yard;
    const cargo = procureConstructionComponentsAtBuiltObject(galaxy, e, bo, yard, true);
    for (const item of cargo.items) empireCreateOrder(galaxy, e, yard, item.commodity, item.amount, false, OrderType.ConstructionShortage);
    performPrivateTransaction(e, -price);
    (r.hunters ??= []).push(bo);
    r.huntersBuilt = (r.huntersBuilt ?? 0) + 1;
    r.facilitySpend += price;
    return true;
}

function isPirateOwned(galaxy: Galaxy, bo: BuiltObject): boolean {
    const e = bo.empire;
    return e !== null && (e.pirateEmpireBaseHabitat !== null || galaxy.pirateEmpires.includes(e));
}
function isPirateShip(galaxy: Galaxy, bo: BuiltObject): boolean {
    return !bo.hasBeenDestroyed && isPirateOwned(galaxy, bo);
}

/** The hunter's task now: the nearest pirate ship within range of an office, else patrol the nearest office. */
function chooseOrder(galaxy: Galaxy, e: Empire, ship: BuiltObject, offices: readonly Habitat[]): { type: BuiltObjectMissionType; target: BuiltObject | Habitat } | null {
    if (offices.length === 0) return null;
    let best: BuiltObject | null = null;
    let bd = Infinity;
    const r2 = BOUNTY_RULES.range * BOUNTY_RULES.range;
    for (const p of galaxy.pirateEmpires) {
        if (p === null || !p.active) continue;
        for (const bo of p.builtObjects as BuiltObject[]) {
            if (bo === null || !isPirateShip(galaxy, bo) || bo.role === BuiltObjectRole.Base || bo.builtAt !== null) continue;
            let inRange = false;
            for (const o of offices) if ((bo.xpos - o.xpos) ** 2 + (bo.ypos - o.ypos) ** 2 <= r2) inRange = true;
            if (!inRange) continue;
            const d = (bo.xpos - ship.xpos) ** 2 + (bo.ypos - ship.ypos) ** 2;
            if (d < bd || (d === bd && best !== null && bo.builtObjectID < best.builtObjectID)) {
                bd = d;
                best = bo;
            }
        }
    }
    if (best !== null) return { type: BuiltObjectMissionType.Attack, target: best };
    let home = offices[0];
    let hd = Infinity;
    for (const o of offices) {
        const d = (o.xpos - ship.xpos) ** 2 + (o.ypos - ship.ypos) ** 2;
        if (d < hd) {
            hd = d;
            home = o;
        }
    }
    return { type: BuiltObjectMissionType.Patrol, target: home };
}

function applyOrder(galaxy: Galaxy, ship: BuiltObject, o: ReturnType<typeof chooseOrder>): void {
    if (o === null) return;
    const m = builtObjectMission(ship.mission);
    if (m !== null && m.type === o.type && m.target === o.target) return;
    assignMission(galaxy, ship, o.type, o.target, null, o.type === BuiltObjectMissionType.Attack ? BuiltObjectMissionPriority.High : BuiltObjectMissionPriority.Low);
}

function reviewEmpire(galaxy: Galaxy, e: Empire): void {
    const r = peekEmpire(galaxy, e);
    const hunters = empireHunters(galaxy, e);
    if (r !== null && r.hunters !== undefined) r.hunters = hunters;
    const offices = bountyOffices(galaxy, e);
    const cap = hunterCap(galaxy, e);
    // Retire extras (closed office, money short).
    const active = hunters.filter((b) => !b.retireForNextMission);
    if (active.length > cap || (active.length > 0 && e.privateMoney < 0)) {
        const o = active[active.length - 1];
        o.retireForNextMission = true;
        if (o.builtAt === null && assignScrapMission(galaxy, e, o)) o.retireForNextMission = false;
        return;
    }
    if (active.length < cap) {
        const d = hunterDesign(galaxy, e);
        if (d !== null) buildHunter(galaxy, e, d);
    }
    for (const ship of active) {
        if (ship.builtAt !== null || ship.topSpeed <= 0) continue;
        const m = builtObjectMission(ship.mission);
        if (m !== null && m.priority > BuiltObjectMissionPriority.Normal && m.type === BuiltObjectMissionType.Attack && m.target instanceof BuiltObject && !m.target.hasBeenDestroyed) continue;
        applyOrder(galaxy, ship, chooseOrder(galaxy, e, ship, offices));
    }
}

function review(galaxy: Galaxy): void {
    for (const e of galaxy.empires) {
        if (!hasPrivateSector(galaxy, e)) continue;
        const r = peekEmpire(galaxy, e);
        if (bountyOffices(galaxy, e).length === 0 && (r?.hunters ?? []).length === 0) continue;
        reviewEmpire(galaxy, e);
    }
}

registerScenarioPeriodic({ id: 'colonyEconomy.bounty', flag: ECON_FLAG, periodDays: BOUNTY_RULES.reviewDays, run: (g) => econOn(g, ECON_FAC_FLAG) && review(g) });

registerScenarioEvent({
    id: 'colonyEconomy.hunterMission',
    flag: ECON_FLAG,
    event: 'privateShipMission',
    run: (galaxy, p) => {
        if (!econOn(galaxy, ECON_FAC_FLAG) || !isHunter(galaxy, p.ship)) return;
        p.handled = true;
        applyOrder(galaxy, p.ship, chooseOrder(galaxy, p.empire, p.ship, bountyOffices(galaxy, p.empire)));
    },
});

registerScenarioEvent({
    id: 'colonyEconomy.bountyPaid',
    flag: ECON_FLAG,
    event: 'builtObjectKilledBy',
    run: (galaxy, p) => {
        const e = p.destroyer;
        if (e === null || !econOn(galaxy, ECON_FAC_FLAG) || !hasPrivateSector(galaxy, e) || !isPirateOwned(galaxy, p.builtObject)) return;
        if (bountyOffices(galaxy, e).length === 0) return;
        const bounty = Math.max(0, p.builtObject.purchasePrice) * BOUNTY_RULES.bountyShare;
        if (bounty <= 0) return;
        performPrivateTransaction(e, bounty);
        const r = empireRecord(galaxy, e);
        r.bountiesPaid = (r.bountiesPaid ?? 0) + bounty;
        r.bountyKills = (r.bountyKills ?? 0) + 1;
    },
});

// With the Privateers add-on on: each working office lets the private sector keep more privateers.
privateerHooks.extraCap = (galaxy: Galaxy, e: Empire): number => (econOn(galaxy, ECON_FAC_FLAG) ? BOUNTY_RULES.privateerBoost * bountyOffices(galaxy, e).length : 0);
