// Improvements "supplyChain": the texts the supply views show (pure: no DOM), from sim/logistics/supplyChain.ts results.
// Shared by the Construction Yards "Waiting For" tab, the selection panel's Waiting row, the Supply Shortages overlay
// tooltip and the resource supply panel.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { BuiltObject } from '../sim/builtObject';
import type { Habitat } from '../sim/types';
import { YEAR_LENGTH } from '../sim/galaxyTime';
import type { StellarObject } from '../sim/logistics/contracts';
import type {
    ColonyLuxuryStatus,
    Delivery,
    DeliveryRisk,
    ItemResourceNeed,
    QueueItemSupply,
    ShortageMarker,
    SiteResource,
    SiteSupply,
} from '../sim/logistics/supplyChain';

/** One game day (star date units = game ms): a year is 360 days (sim/scenario/hooks.ts GAME_DAY_LENGTH). */
export const DAY_MS = YEAR_LENGTH / 360;

export function resourceName(galaxy: Galaxy, resourceId: number): string {
    return galaxy.resourceSystem.byId.get(resourceId)?.name ?? `Resource ${resourceId}`;
}

/** Whole units with thousands separators. */
export function formatUnits(n: number): string {
    return Math.max(0, Math.round(n)).toLocaleString('en-US');
}

/** An ETA in game days ("< 1 day", "12 days", "1.5 years"); "—" when unknown. */
export function formatEtaDays(ms: number | null): string {
    if (ms === null || !Number.isFinite(ms)) return '—';
    if (ms < DAY_MS) return '< 1 day';
    if (ms >= YEAR_LENGTH) return `${(ms / YEAR_LENGTH).toFixed(1)} years`;
    const d = Math.round(ms / DAY_MS);
    return `${d} day${d === 1 ? '' : 's'}`;
}

/** The system an object is in ('(Deep Space)' for a free-flying one). */
export function systemNameOf(galaxy: Galaxy, o: StellarObject | null): string {
    if (o === null) return '';
    if (o instanceof BuiltObject) return o.nearestSystemStar?.name || '(Deep Space)';
    return galaxy.systems[(o as Habitat).systemIndex]?.systemStar?.name ?? '';
}

function ownerOf(o: StellarObject | null): Empire | null {
    if (o === null) return null;
    return o instanceof BuiltObject ? o.actualEmpire : (o as Habitat).empire;
}

/** "Name (System)", plus the owner when it is not `viewer`. */
export function placeText(galaxy: Galaxy, o: StellarObject | null, viewer: Empire | null = null): string {
    if (o === null) return '(unknown)';
    const sys = systemNameOf(galaxy, o);
    const owner = ownerOf(o);
    const parts: string[] = [];
    if (sys !== '' && sys !== o.name) parts.push(sys);
    if (owner !== null && viewer !== null && owner !== viewer) parts.push(owner.name);
    return parts.length > 0 ? `${o.name} (${parts.join(', ')})` : o.name;
}

export function riskText(r: DeliveryRisk): string {
    switch (r) {
        case 'freighterLost':
            return 'freighter lost';
        case 'freighterInCombat':
            return 'freighter under attack';
        case 'destinationBlockaded':
            return 'destination blockaded';
        case 'sourceBlockaded':
            return 'source blockaded';
    }
}

/** One delivery: "Freighter F from Post (System): 120 units, aboard, ETA 12 days — freighter under attack". */
export function deliveryText(galaxy: Galaxy, d: Delivery, viewer: Empire | null = null, amount: number = d.amount): string {
    const who = d.freighter !== null ? d.freighter.name : 'No freighter';
    let t = `${who} from ${placeText(galaxy, d.supplier, viewer)}: ${formatUnits(amount)} units, ${d.pickedUp ? 'aboard' : 'to pick up'}, ETA ${formatEtaDays(d.etaMs)}`;
    if (d.risks.length > 0) t += ` — ${d.risks.map(riskText).join(', ')}`;
    return t;
}

/** How a need is covered: by deliveries ('coming'), partly, by orders waiting for a freighter, or not at all. */
export type NeedStatus = 'coming' | 'partial' | 'ordered' | 'none';

export function needStatus(n: Pick<ItemResourceNeed, 'byDeliveries' | 'byOrders' | 'uncovered'>): NeedStatus {
    if (n.byDeliveries <= 0 && n.byOrders <= 0) return 'none';
    if (n.uncovered > 0) return 'partial';
    if (n.byOrders > 0) return 'ordered';
    return 'coming';
}

/** Short status of a need ("coming, 12 days" / "ordered, no freighter yet" / "nothing coming"). */
export function needStatusText(n: ItemResourceNeed): string {
    switch (needStatus(n)) {
        case 'coming':
            return `coming, ${formatEtaDays(n.etaMs)}`;
        case 'partial':
            return `only ${formatUnits(n.byDeliveries + n.byOrders)} coming`;
        case 'ordered':
            return n.byDeliveries > 0 ? `${formatUnits(n.byDeliveries)} coming, rest ordered` : 'ordered, no freighter yet';
        case 'none':
            return 'nothing coming';
    }
}

/** "Steel 120 (coming, 12 days), Polymer 40 (nothing coming)". */
export function itemNeedsText(galaxy: Galaxy, item: QueueItemSupply, max = 4): string {
    if (item.needs.length === 0) return item.componentsToMake > 0 || item.componentsInManufacture > 0 ? 'resources in stock' : 'components ready';
    const parts = item.needs.slice(0, max).map((n) => `${resourceName(galaxy, n.resourceId)} ${formatUnits(n.missing)} (${needStatusText(n)})`);
    if (item.needs.length > max) parts.push(`+${item.needs.length - max} more`);
    return parts.join(', ');
}

/** The item's state in a word: Stalled / Waiting / Building / Ready. */
export function itemStateText(item: QueueItemSupply): string {
    if (item.stalled) return 'Stalled';
    if (item.needs.length > 0) return item.yard !== null ? 'Will stall' : 'Short';
    return item.yard !== null ? 'Building' : 'Supplied';
}

/** One site resource line: "Steel: 120 missing — 2 deliveries, soonest 3 days" / "— nothing coming (4,000 held at X)". */
export function siteResourceText(galaxy: Galaxy, r: SiteResource, viewer: Empire | null = null): string {
    const name = resourceName(galaxy, r.resourceId);
    const del = r.orders?.deliveries ?? [];
    let t = `${name}: ${formatUnits(r.missing)} missing`;
    if (del.length > 0) {
        let units = 0;
        for (const d of del) units += d.amount;
        t += ` — ${formatUnits(units)} on ${del.length} freighter${del.length === 1 ? '' : 's'}, first in ${formatEtaDays(del[0].etaMs)}`;
        if (r.uncovered > 0) t += `, ${formatUnits(r.uncovered)} not covered`;
    } else if ((r.orders?.uncontracted ?? 0) > 0 && r.uncovered < r.missing) {
        t += ' — ordered, no freighter yet';
    } else {
        t += ' — NOTHING COMING';
    }
    if (r.uncovered > 0) {
        if (r.availableElsewhere > 0) t += ` (${formatUnits(r.availableElsewhere)} held in your empire${r.availableAt !== null ? `, most at ${placeText(galaxy, r.availableAt, viewer)}` : ''})`;
        else t += ' (none in your empire)';
    }
    return t;
}

/** The headline of a site with shortages. */
export function siteHeadline(s: SiteSupply): string {
    const stalled = s.items.filter((i) => i.stalled).length;
    const short = s.items.filter((i) => i.needs.length > 0).length;
    if (stalled > 0) return `${s.name}: ${stalled} ship${stalled === 1 ? '' : 's'} stalled for resources`;
    if (short > 0) return `${s.name}: ${short} queued ship${short === 1 ? '' : 's'} short of resources`;
    return `${s.name}: construction supplied`;
}

export function siteTooltipLines(galaxy: Galaxy, s: SiteSupply, viewer: Empire | null = null, max = 6): string[] {
    const lines = [siteHeadline(s)];
    for (const r of s.resources.slice(0, max)) lines.push(`  ${siteResourceText(galaxy, r, viewer)}`);
    if (s.resources.length > max) lines.push(`  +${s.resources.length - max} more resources`);
    return lines;
}

export function colonyHeadline(c: ColonyLuxuryStatus): string {
    const held = `${c.luxuryTypes} luxury type${c.luxuryTypes === 1 ? '' : 's'}`;
    if (c.developmentFalling) return `${c.colony.name}: development falling — ${held} held, ${c.typesForDevelopment} needed`;
    return `${c.colony.name}: short of luxuries — ${held} held, wants ${c.typesWanted}`;
}

export function colonyTooltipLines(galaxy: Galaxy, c: ColonyLuxuryStatus, viewer: Empire | null = null, max = 5): string[] {
    const lines = [colonyHeadline(c)];
    const notComing = c.demanded.filter((d) => d.notComing);
    for (const d of notComing.slice(0, max)) {
        lines.push(`  ${resourceName(galaxy, d.resourceId)}: not coming (${formatUnits(d.availableElsewhere)} held${d.availableAt !== null ? ` at ${placeText(galaxy, d.availableAt, viewer)}` : ''})`);
    }
    if (notComing.length > max) lines.push(`  +${notComing.length - max} more not coming`);
    const coming = c.demanded.filter((d) => d.orders.deliveries.length > 0);
    if (coming.length > 0) {
        lines.push(`  On the way: ${coming.slice(0, 4).map((d) => `${resourceName(galaxy, d.resourceId)} (${formatEtaDays(d.orders.deliveries[0].etaMs)})`).join(', ')}${coming.length > 4 ? ` +${coming.length - 4}` : ''}`);
    }
    const unavailable = c.demanded.filter((d) => d.unavailable);
    if (unavailable.length > 0) {
        lines.push(`  None in your empire: ${unavailable.slice(0, 4).map((d) => resourceName(galaxy, d.resourceId)).join(', ')}${unavailable.length > 4 ? ` +${unavailable.length - 4}` : ''}`);
    }
    return lines;
}

/** The overlay's hover text (several lines). */
export function shortageTooltip(galaxy: Galaxy, m: ShortageMarker, viewer: Empire | null = null): string {
    const lines: string[] = [];
    if (m.site !== null) lines.push(...siteTooltipLines(galaxy, m.site, viewer));
    if (m.colony !== null) lines.push(...colonyTooltipLines(galaxy, m.colony, viewer));
    return lines.join('\n');
}
