// Scenario package 19a — what the Concord's rare goods do at a colony that holds them, and their ordering priority
// (flag rimTrader). Not a port: add-on effects on the stock channels.
//
//   Held = in the colony's cargo, owned by the colony's empire, Available > 0 (the stock test of
//   RecalculateCriticalResourceSupplyBonuses / RestrictedResourceCount: the restricted-resource supply delivered it).
//
//   Development: a rare good's SuperLuxuryBonusAmount is 50 (scenarios/rimTrade/resources.txt; the stock super-luxuries
//     keep 30). The stock development bonus of a restricted resource is the literal +30 of Habitat.cs 447 (the
//     _RestrictedResourcesPresent flag; SuperLuxuryBonusAmount itself only marks a resource restricted), so a colony
//     holding a rare good gets the difference — the highest held rare good's bonus − 30 = +20 — as a Development
//     resource bonus (query colonyResourceBonuses at taxes.ts recalculateCriticalResourceSupplyBonuses; read by
//     developmentLevel.ts habitatDevelopmentLevel). Once per colony, like the stock +30.
//   One effect per good (params, scenario.json):
//     Oranthi Porcelain: approval +rimRarePorcelainApproval (default 8) — a stability term (stability.ts), so it raises
//       the colony's approval, slows unrest and the revolt / breakaway tests that read approval, and shows in the
//       colony's approval breakdown and the internal-security ledger ("Oranthi Porcelain").
//     Moonsilk: colony income +rimRareMoonsilkIncomePct % (default 15) — an IncomeBoost resource bonus (the stock
//       Habitat.cs AnnualRevenue factor that multiplies the colony's tax / trade revenue, forceStructure.ts 428).
//     Starleaf Tea: population growth +rimRareTeaGrowthPct % (default 25) — a PopulationGrowthRate resource bonus (the
//       stock growth factor, colonyTick.ts 853).
//   The resource bonuses show in the colony's attitude summary (HabitatAttitudeSummary.cs DetermineHabitatResourceBonuses).
//
//   Ordering priority: while the Concord trades with an empire (supplyRestrictedResources) and its port holds a rare
//     good, that good takes one of the 3 restricted slots first (query availableRestrictedResources at Galaxy.3.cs 367
//     ShowAvailableRestrictedResourcesForEmpire: rare goods, then the stock list, at most 3). A colony then orders the
//     most-lacking rare good while any still needs ordering, else the stock super-luxuries in the slots left (query
//     restrictedOrderCandidates at Empire.4.cs 3271; the stock picks the self-supplied list over the available one,
//     which kept any empire with its own Loros Fruit from ever ordering a rare good).
//   Reach: a colony orders the rare goods from development rimRareOrderDevelopment (60; stock 80 for every restricted
//     resource, query restrictedOrderMinDevelopment) — the stock super-luxuries still from 80.
//   Standing: the Concord contracts its rare goods only as far as the buyer's standing covers (query contractAvailable
//     at the stock trading-post fulfilment), so a big order no longer drives a buyer hundreds of thousands below zero.
// No Rnd. Pure reads except the returned lists.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import { ColonyResourceEffect } from '../../developmentLevel';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../../diplomacy';
import { registerScenarioQuery } from '../hooks';
import { registerStabilityTerm } from '../stability';
import { scenarioParam } from '../state';
import { cargoGetCargo } from '../../logistics/orders';
import { concordHooks, rareGoodIds, resourceName, rimParam, rimTraderEmpire, rimTraderPort, rimTraderStanding } from './common';
import { habitatDevelopmentLevel } from '../../developmentLevel';
import { galaxyResourceCurrentPrices } from '../../design';

/** Habitat.cs 447: the stock development bonus of a restricted resource (_RestrictedResourcesPresent). */
export const STOCK_RESTRICTED_DEVELOPMENT = 30;

export const RARE_EFFECT_DEFAULTS = {
    rimRarePorcelainApproval: 8,
    rimRareMoonsilkIncomePct: 15,
    rimRareTeaGrowthPct: 25,
    rimRareOrderDevelopment: 60,
} as const;

/** Empire.4.cs 3271: the stock development level from which a colony orders restricted resources. */
export const STOCK_RESTRICTED_ORDER_DEVELOPMENT = 80;

export function rareEffectParam(galaxy: Galaxy, name: keyof typeof RARE_EFFECT_DEFAULTS): number {
    return scenarioParam(galaxy, name, RARE_EFFECT_DEFAULTS[name]);
}

/** The rare-good ids by role (-1: not in the data). */
function rareRoles(galaxy: Galaxy): { porcelain: number; moonsilk: number; tea: number } {
    const ids = rareGoodIds(galaxy);
    const by = (n: string): number => ids.find((id) => resourceName(galaxy, id) === n) ?? -1;
    return { porcelain: by('Oranthi Porcelain'), moonsilk: by('Moonsilk'), tea: by('Starleaf Tea') };
}

/** `h` holds `resourceId` (its empire's cargo, Available > 0). Pure. */
export function colonyHolds(h: Habitat, resourceId: number): boolean {
    if (resourceId < 0 || h.cargo === null || h.empire === null) return false;
    const c = cargoGetCargo(h.cargo, resourceId, h.empire);
    return c !== null && c.amount - c.reserved > 0;
}

/** The rare goods `h` holds. Pure. */
export function rareGoodsHeld(galaxy: Galaxy, h: Habitat): number[] {
    if (h.cargo === null || h.empire === null || rimTraderEmpire(galaxy) === null) return [];
    return rareGoodIds(galaxy).filter((id) => colonyHolds(h, id));
}

/** One effect line of a rare good at a colony. */
export interface RareGoodEffect {
    resourceId: number;
    kind: 'development' | 'approval' | 'income' | 'growth';
    value: number;
}

/** The effects the rare goods held at `h` give it. Pure. */
export function rareGoodEffects(galaxy: Galaxy, h: Habitat): RareGoodEffect[] {
    const held = rareGoodsHeld(galaxy, h);
    if (held.length === 0) return [];
    const out: RareGoodEffect[] = [];
    let best = -1;
    let bonus = 0;
    for (const id of held) {
        const b = galaxy.resourceSystem.byId.get(id)?.superLuxuryBonusAmount ?? 0;
        if (b > bonus) {
            bonus = b;
            best = id;
        }
    }
    if (best >= 0 && bonus > STOCK_RESTRICTED_DEVELOPMENT) out.push({ resourceId: best, kind: 'development', value: bonus - STOCK_RESTRICTED_DEVELOPMENT });
    const roles = rareRoles(galaxy);
    if (held.includes(roles.porcelain)) out.push({ resourceId: roles.porcelain, kind: 'approval', value: rareEffectParam(galaxy, 'rimRarePorcelainApproval') });
    if (held.includes(roles.moonsilk)) out.push({ resourceId: roles.moonsilk, kind: 'income', value: rareEffectParam(galaxy, 'rimRareMoonsilkIncomePct') });
    if (held.includes(roles.tea)) out.push({ resourceId: roles.tea, kind: 'growth', value: rareEffectParam(galaxy, 'rimRareTeaGrowthPct') });
    return out.filter((e) => e.value !== 0);
}

/** colonyResourceBonuses query: development, income and growth as resource bonuses (a new list). Pure. */
export function rareGoodResourceBonuses(galaxy: Galaxy, value: Habitat['resourceBonuses'], h: Habitat): Habitat['resourceBonuses'] {
    if (h.population === null || !(h.population.totalAmount > 0)) return value;
    const fx = rareGoodEffects(galaxy, h).filter((e) => e.kind !== 'approval');
    if (fx.length === 0) return value;
    const effect = { development: ColonyResourceEffect.Development, income: ColonyResourceEffect.IncomeBoost, growth: ColonyResourceEffect.PopulationGrowthRate } as const;
    return [...value, ...fx.map((e) => ({ resourceId: e.resourceId, effect: effect[e.kind as keyof typeof effect], value: e.value, appliesOnlyToSources: false }))];
}

/** Oranthi Porcelain's approval term at `h` (null: none). Pure. */
export function porcelainApproval(galaxy: Galaxy, h: Habitat): number | null {
    const id = rareRoles(galaxy).porcelain;
    if (!colonyHolds(h, id)) return null;
    const v = rareEffectParam(galaxy, 'rimRarePorcelainApproval');
    return v !== 0 ? v : null;
}

/** The colony approval breakdown lines (UI): Oranthi Porcelain's term. Pure. */
export function rareGoodApprovalLines(galaxy: Galaxy, h: Habitat): { label: string; value: number }[] {
    if (rimTraderEmpire(galaxy) === null) return [];
    const v = porcelainApproval(galaxy, h);
    return v === null ? [] : [{ label: resourceName(galaxy, rareRoles(galaxy).porcelain), value: v }];
}

/** A rare good's colony effect as text (resource tooltip), '' for any other resource. Pure. */
export function rareGoodEffectText(galaxy: Galaxy, resourceId: number): string {
    if (rimTraderEmpire(galaxy) === null || !rareGoodIds(galaxy).includes(resourceId)) return '';
    const dev = galaxy.resourceSystem.byId.get(resourceId)?.superLuxuryBonusAmount ?? 0;
    const roles = rareRoles(galaxy);
    const one =
        resourceId === roles.porcelain
            ? `approval +${rareEffectParam(galaxy, 'rimRarePorcelainApproval')}`
            : resourceId === roles.moonsilk
              ? `colony income +${rareEffectParam(galaxy, 'rimRareMoonsilkIncomePct')}%`
              : resourceId === roles.tea
                ? `population growth +${rareEffectParam(galaxy, 'rimRareTeaGrowthPct')}%`
                : '';
    return `Concord rare good: development +${dev}${one !== '' ? `, ${one}` : ''} at a colony that holds it`;
}

/** The rare goods `empire` can get now: the Concord's own, or the Concord trades with it and its port holds them. Pure. */
export function rareGoodsAvailableTo(galaxy: Galaxy, empire: Empire): number[] {
    const r = rimTraderEmpire(galaxy);
    if (r === null) return [];
    const ids = rareGoodIds(galaxy);
    if (empire === r) return ids;
    const rel = obtainDiplomaticRelation(r, empire);
    if (rel.type === DiplomaticRelationType.NotMet || !rel.supplyRestrictedResources) return [];
    const port = rimTraderPort(galaxy);
    const cargo = port?.cargo ?? null;
    if (cargo === null) return [];
    return ids.filter((id) => (cargoGetCargo(cargo, id, r)?.amount ?? 0) > 0);
}

/** availableRestrictedResources query: the available rare goods first, then the stock list, at most 3. */
export function rareGoodsFirst(galaxy: Galaxy, value: number[], empire: Empire): number[] {
    const rare = rareGoodsAvailableTo(galaxy, empire);
    if (rare.length === 0) return value;
    const all = rareGoodIds(galaxy);
    return [...rare, ...value.filter((id) => !all.includes(id))].slice(0, 3);
}

/**
 * restrictedOrderCandidates query: the available rare goods that still need ordering, else the stock candidates in the
 * slots the rare goods leave (3 − available rare goods) — those only at the stock development level (a colony below it
 * orders here only because of the rare goods' lower one, restrictedOrderMinDevelopment).
 */
export function rareOrderCandidates(galaxy: Galaxy, value: number[], args: { available: number[]; amountToOrder: (id: number) => number; habitat?: Habitat }): number[] {
    const all = rareGoodIds(galaxy);
    const rare = args.available.filter((id) => all.includes(id));
    if (rare.length === 0) return value;
    const needing = rare.filter((id) => args.amountToOrder(id) > 0);
    if (needing.length > 0) return needing;
    if (args.habitat !== undefined && habitatDevelopmentLevel(args.habitat) < STOCK_RESTRICTED_ORDER_DEVELOPMENT) return [];
    return value.filter((id) => !all.includes(id)).slice(0, Math.max(0, 3 - rare.length));
}

/** restrictedOrderMinDevelopment query: rimRareOrderDevelopment (60) while a rare good is among the empire's slots. Pure. */
export function rareOrderMinDevelopment(galaxy: Galaxy, value: number, available: number[]): number {
    const all = rareGoodIds(galaxy);
    if (!available.some((id) => all.includes(id))) return value;
    return Math.min(value, rareEffectParam(galaxy, 'rimRareOrderDevelopment'));
}

/**
 * contractAvailable query: the units of a rare good the Concord contracts to `buyer` — at most what its standing covers
 * (standing ÷ the price it pays, rimTraderRarePriceMult × the galaxy price), so a big buyer no longer runs its standing
 * hundreds of thousands below zero (and shut out, angered) in one order. The Concord's own colonies are not limited. Pure.
 */
export function rareContractAvailable(galaxy: Galaxy, value: number, args: { seller: Empire | null; buyer: Empire | null; resourceId: number }): number {
    const r = rimTraderEmpire(galaxy);
    if (r === null || args.seller !== r || args.buyer === null || args.buyer === r || !rareGoodIds(galaxy).includes(args.resourceId)) return value;
    if (concordHooks().tollExempt?.(galaxy, args.buyer) === true) return value;
    const price = (galaxyResourceCurrentPrices(galaxy)[args.resourceId] ?? 0) * rimParam(galaxy, 'rimTraderRarePriceMult');
    if (!(price > 0)) return value;
    const standing = rimTraderStanding(galaxy, args.buyer.empireId);
    return Math.max(0, Math.min(value, Math.floor(Math.max(0, standing) / price)));
}

registerScenarioQuery({ id: 'rimTrade.rare.bonuses', flag: 'rimTrader', query: 'colonyResourceBonuses', run: (g, v, a) => rareGoodResourceBonuses(g, v, a.habitat) });
registerScenarioQuery({ id: 'rimTrade.rare.first', flag: 'rimTrader', query: 'availableRestrictedResources', run: (g, v, a) => rareGoodsFirst(g, v, a.empire) });
registerScenarioQuery({ id: 'rimTrade.rare.order', flag: 'rimTrader', query: 'restrictedOrderCandidates', run: (g, v, a) => rareOrderCandidates(g, v, a) });
registerScenarioQuery({ id: 'rimTrade.rare.orderDevelopment', flag: 'rimTrader', query: 'restrictedOrderMinDevelopment', run: (g, v, a) => rareOrderMinDevelopment(g, v, a.available) });
registerScenarioQuery({ id: 'rimTrade.rare.standingCap', flag: 'rimTrader', query: 'contractAvailable', run: (g, v, a) => rareContractAvailable(g, v, a) });
registerStabilityTerm({ id: 'rimTrade.porcelain', flag: 'rimTrader', cause: 'oranthiPorcelain', label: 'Oranthi Porcelain', run: (g, h, empire) => (empire === null ? null : porcelainApproval(g, h)) });
