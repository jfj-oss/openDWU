// Task 19e-9: pure text / row builders for the Freight Flows overlay tooltip and the Trade Flows panel (no DOM, unit
// tested). Values are "contracted" (the C# pays at InitiateContract, Empire.4.cs:1135, not at delivery).

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { BuiltObject } from '../sim/builtObject';
import type { StellarObject } from '../sim/logistics/contracts';
import type { EmpirePairRow, FlowRow, HubRow } from '../sim/logistics/tradeFlows';

/** The parts of a drawn route (render/freightOverlay.ts FlowRoute) the tooltip reads: one row per direction. */
export interface FreightRouteLike {
    ab: FlowRow | null;
    ba: FlowRow | null;
}

/** One direction's cargo and its share of that cargo's known trade (render/freightOverlay.ts flowShare). */
export interface FlowShareInfo {
    /** "gas", "restricted luxury", or the picked resource's name. */
    cargoLabel: string;
    /** cr/yr of that cargo on this direction. */
    cargoValue: number;
    /** cr/yr of that cargo on every route the viewer knows. */
    total: number;
    /** cr/yr of the other goods on this direction. */
    otherValue: number;
}

export type FreightHitLike =
    | { kind: 'flow'; route: FreightRouteLike; abShare?: FlowShareInfo | null; baShare?: FlowShareInfo | null }
    | { kind: 'hub'; hub: HubRow; volume?: number | null; allTrade?: number };

type NameSource = Pick<Galaxy, 'systems' | 'resourceSystem' | 'independentEmpire'>;

/** Credits, rounded, with thousands separators. */
export function formatCredits(v: number): string {
    return Math.round(v).toLocaleString('en-US');
}

function postName(o: StellarObject | null): string {
    if (o === null) return '?';
    return o.name !== '' ? o.name : o instanceof BuiltObject ? 'Base' : 'Deep space';
}

/** Name of one end of a flow: the system (star) at system level, else the trading post / destination. */
export function flowEndName(galaxy: NameSource, row: FlowRow, end: 'from' | 'to'): string {
    const sys = end === 'from' ? row.sellerSystem : row.destSystem;
    const post = end === 'from' ? row.sellingPoint : row.destination;
    if (row.level === 'post' || sys < 0) return postName(post);
    return galaxy.systems[sys]?.systemStar.name ?? postName(post);
}

export function resourceNames(galaxy: NameSource, ids: readonly number[], max = 3): string {
    const names = ids.slice(0, max).map((id) => (id < 0 ? 'Components' : (galaxy.resourceSystem.byId.get(id)?.name ?? `#${id}`)));
    if (ids.length > max) names.push(`+${ids.length - max}`);
    return names.join(', ');
}

export function empireNames(galaxy: NameSource, list: readonly Empire[], max = 3): string {
    const names = list.slice(0, max).map((e) => (e === galaxy.independentEmpire ? 'Independent' : e.name));
    if (list.length > max) names.push(`+${list.length - max}`);
    return names.join(', ');
}

/** A share as a whole percentage: "<1%" for a sliver, never over 100 %; null when there is no total. */
export function sharePercent(value: number, total: number): string | null {
    if (!(total > 0) || !(value > 0)) return null;
    const p = Math.min(100, Math.round((100 * value) / total));
    return p < 1 ? '<1%' : `${p}%`;
}

/** One direction of a route: "From → To: N cr/yr gas (18% of all gas trade)" (with the other goods it also carries),
 * or without shares "From → To: N cr/yr (cargo)". */
export function flowLineText(galaxy: NameSource, r: FlowRow, share: FlowShareInfo | null = null): string {
    const ends = `${flowEndName(galaxy, r, 'from')} → ${flowEndName(galaxy, r, 'to')}`;
    if (share === null) return `${ends}: ${formatCredits(r.valuePerYear)} cr/yr (${resourceNames(galaxy, r.resourceIds)})`;
    const pct = sharePercent(share.cargoValue, share.total);
    let text = `${ends}: ${formatCredits(share.cargoValue)} cr/yr ${share.cargoLabel}${pct !== null ? ` (${pct} of all ${share.cargoLabel} trade)` : ''}`;
    if (share.otherValue >= 1) text += `, + ${formatCredits(share.otherValue)} cr/yr other goods`;
    return text;
}

/** Tooltip for a hovered route / hub disc: a route's main direction, then its return leg when it has one; a hub's
 * income, then the freight it ships and receives and its share of all known trade. */
export function freightTooltipText(galaxy: NameSource, hit: FreightHitLike): string {
    if (hit.kind === 'hub') {
        const h = hit.hub;
        const owner = h.owner === null ? '' : ` (${h.owner === galaxy.independentEmpire ? 'Independent' : h.owner.name})`;
        const head = `${postName(h.port)}${owner} — ${formatCredits(h.income)} cr trade income this year`;
        if (hit.volume == null || hit.allTrade === undefined) return head;
        const pct = sharePercent(hit.volume, hit.allTrade);
        return `${head}\n${formatCredits(hit.volume)} cr/yr of freight shipped and received${pct !== null ? ` (${pct} of all known trade)` : ''}`;
    }
    const lines: string[] = [];
    if (hit.route.ab !== null) lines.push(flowLineText(galaxy, hit.route.ab, hit.abShare ?? null));
    if (hit.route.ba !== null) lines.push(flowLineText(galaxy, hit.route.ba, hit.baShare ?? null));
    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Panel rows
// ---------------------------------------------------------------------------

export interface FlowTableRow {
    route: string;
    goods: string;
    categoryKey: string;
    value: string;
    perYear: string;
    contracts: number;
    sellers: string;
    /** Centre of the route (Go To). */
    x: number;
    y: number;
}

export function flowTableRows(galaxy: NameSource, rows: readonly FlowRow[], limit = 15): FlowTableRow[] {
    return rows.slice(0, limit).map((r) => ({
        route: `${flowEndName(galaxy, r, 'from')} → ${flowEndName(galaxy, r, 'to')}`,
        goods: resourceNames(galaxy, r.resourceIds, 2),
        categoryKey: r.category.key,
        value: formatCredits(r.value),
        perYear: formatCredits(r.valuePerYear),
        contracts: r.count,
        sellers: empireNames(galaxy, r.sellers, 2),
        x: (r.fromX + r.toX) / 2,
        y: (r.fromY + r.toY) / 2,
    }));
}

export interface HubTableRow {
    name: string;
    owner: string;
    income: string;
    x: number;
    y: number;
}

export function hubTableRows(galaxy: NameSource, hubs: readonly HubRow[], limit = 10): HubTableRow[] {
    return hubs.slice(0, limit).map((h) => ({
        name: postName(h.port),
        owner: h.owner === null ? '' : h.owner === galaxy.independentEmpire ? 'Independent' : h.owner.name,
        income: formatCredits(h.income),
        x: h.x,
        y: h.y,
    }));
}

export interface PairTableRow {
    a: string;
    b: string;
    value: string;
    mine: boolean;
}

/** Empire-pair yearly totals, the player's pairs first (then by value, as given). */
export function pairTableRows(pairs: readonly EmpirePairRow[], player: Empire | null, limit = 10): PairTableRow[] {
    const mine = pairs.filter((p) => player !== null && (p.a === player || p.b === player));
    const rest = pairs.filter((p) => !(player !== null && (p.a === player || p.b === player)));
    return [...mine, ...rest].slice(0, limit).map((p) => ({ a: p.a.name, b: p.b.name, value: formatCredits(p.value), mine: mine.includes(p) }));
}
