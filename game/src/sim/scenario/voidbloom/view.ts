// The Voidbloom War — pure read-outs for the UI (the diplomacy screen's Voidbloom block, the colony lines, the map
// marks) and the player's commands (playerOps: policy, automation, labour convoy, garrison levy, neural detox, bribing
// the Concord's officials). The reads never create state; the commands are journaled player ops (multiplayer).

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import { galaxyStarDate } from '../../tick/simTime';
import { YEAR_LENGTH } from '../../galaxyTime';
import { GAME_DAY_LENGTH } from '../hooks';
import { scenarioText } from '../messages';
import { rimTraderEmpire } from '../rimTrade/common';
import {
    addictionIndex,
    bloomWorldOf,
    concordAddiction,
    crackdownOn,
    fmt,
    isNormal,
    peekVbColony,
    peekVbState,
    policyOf,
    vbEmpire,
    vbOn,
    vbState,
    vbWarOf,
    voidbloomStock,
    type VbPolicy,
} from './common';
import { garrisonNeeded, garrisonOf, labourAtSea, levyGarrison, sendLabourConvoy, worldYield } from './supply';
import { setPolicy, voidbloomApproval } from './trade';
import { concordDeclineIndex } from './treaty';
import { startDetox } from './legal';
import { bribeCost, bribeOfficials } from './crackdown';

export { bribeOfficials };

export interface VbWorldRow {
    world: Habitat;
    name: string;
    workers: string;
    garrison: string;
    yieldText: string;
    stock: number;
    burned: boolean;
    short: boolean;
}

export interface VbPanel {
    title: string;
    policy: VbPolicy;
    policyText: string;
    lines: { label: string; value: string; bad?: boolean }[];
    worlds: VbWorldRow[];
    autoLabour: boolean;
    autoGarrison: boolean;
    canBribe: boolean;
    bribeCost: number;
    canDetox: boolean;
    detoxText: string;
    history: string[];
}

const POLICY_TEXT: Record<VbPolicy, string> = { smuggle: 'Trade it anywhere (smuggle)', legal: 'Trade it only where it is legal', ban: 'Ban it' };

/** The diplomacy screen's Voidbloom block for `viewer` (null when the add-on is off). Pure. */
export function voidbloomPanel(galaxy: Galaxy, viewer: Empire): VbPanel | null {
    if (!vbOn(galaxy)) return null;
    const st = peekVbState(galaxy);
    const r = rimTraderEmpire(galaxy);
    if (st === null || r === null || viewer === r) return null;
    const rec = st.empires[viewer.empireId];
    const now = galaxyStarDate(galaxy);
    const policy = policyOf(galaxy, viewer);
    const lines: VbPanel['lines'] = [];
    const drain = st.stats.stateDrain + st.stats.privateDrain;
    const lastYear = st.drainByYear.length > 0 ? st.drainByYear[st.drainByYear.length - 1].value : 0;
    lines.push({ label: scenarioText('Voidbloom Panel Drain'), value: `${fmt(drain)} (${fmt(lastYear)} last year; state ${fmt(st.stats.stateDrain)})` });
    lines.push({ label: scenarioText('Voidbloom Panel Concord'), value: `${Math.round(concordAddiction(galaxy) * 100)}% addicted, decline ${Math.round(concordDeclineIndex(galaxy) * 100)}%` });
    lines.push({ label: scenarioText('Voidbloom Panel Ours'), value: `${Math.round(addictionIndex(galaxy, viewer) * 100)}% addicted` });
    if (rec !== undefined) {
        lines.push({ label: scenarioText('Voidbloom Panel Trade'), value: `sold ${fmt(rec.sold)} (${fmt(rec.soldConcord)} into the Concord), bought ${fmt(rec.boughtPrivate + rec.boughtState)}` });
        if (rec.seizedUnits > 0) lines.push({ label: scenarioText('Voidbloom Panel Seized'), value: `${fmt(rec.seizedUnits)} units (${fmt(rec.seizedValue)})`, bad: true });
        const rights: string[] = [];
        if (rec.legalConcord) rights.push('legal Voidbloom');
        if (rec.tollExempt) rights.push('no tolls');
        if (rec.inspectExempt) rights.push('no inspections');
        if (rec.treatyPort !== null) rights.push(`treaty port ${rec.treatyPort.name}`);
        if (rec.tollCutPct > 0) rights.push(`${rec.tollCutPct}% of the Concord's customs`);
        if (rights.length > 0) lines.push({ label: scenarioText('Voidbloom Panel Rights'), value: rights.join(', ') });
    }
    const cd = crackdownOn(galaxy, viewer);
    if (st.crackdownStarted >= 0) lines.push({ label: scenarioText('Voidbloom Panel Commissioner'), value: st.commissioner !== null && st.commissioner.active ? `${st.commissioner.name} at ${st.commissionerColony?.name ?? '?'}` : 'none' });
    if (cd !== null) {
        const until = cd.until > now ? ` until ${Math.ceil((cd.until - now) / YEAR_LENGTH)} years from now` : '';
        lines.push({ label: scenarioText('Voidbloom Panel Crackdown'), value: `${cd.status}${until}; raids ${cd.raids}, burned ${cd.burns}, occupied ${cd.occupations}, workers freed ${fmt(cd.freed)}`, bad: true });
    }
    if (vbWarOf(galaxy, viewer) !== null) lines.push({ label: scenarioText('Voidbloom Panel War'), value: concordDeclineIndex(galaxy) >= 0.45 ? 'the Concord may sign away rights' : 'the Concord will not yield yet', bad: true });
    if (st.treaty !== null) lines.push({ label: scenarioText('Voidbloom Panel Treaty'), value: `${st.treaty.terms.length} terms${st.treaty.branch !== '' ? `; aftermath: ${st.treaty.branch}` : ''}` });
    const worlds: VbWorldRow[] = [];
    for (const w of st.worlds) {
        const h = w.habitat;
        if (h.empire !== viewer || h.hasBeenDestroyed) continue;
        const need = garrisonNeeded(galaxy, h);
        const have = garrisonOf(h);
        const sea = labourAtSea(galaxy, h);
        worlds.push({
            world: h,
            name: h.name,
            workers: `${fmt((h.population?.totalAmount ?? 0) / 1e6)}M${sea > 0 ? ` (+${fmt(sea / 1e6)}M at sea)` : ''}`,
            garrison: `${have}/${need}`,
            yieldText: `${worldYield(galaxy, w)} / 30 days`,
            stock: voidbloomStock(galaxy, h),
            burned: now < w.burnedUntil,
            short: have < need,
        });
    }
    const detox = rec?.detoxDone ? 'Neural detox: done' : rec !== undefined && rec.detoxUntil >= 0 ? `Neural detox: ${Math.ceil((rec.detoxUntil - now) / YEAR_LENGTH)} years left` : 'Fund neural detox research';
    return {
        title: scenarioText('Voidbloom Panel Title'),
        policy,
        policyText: POLICY_TEXT[policy],
        lines,
        worlds,
        autoLabour: rec?.autoLabour ?? true,
        autoGarrison: rec?.autoGarrison ?? true,
        canBribe: st.crackdownStarted >= 0 && (rec?.bribedUntil ?? -1) <= now,
        bribeCost: bribeCost(galaxy),
        canDetox: rec === undefined || (!rec.detoxDone && rec.detoxUntil < 0),
        detoxText: detox,
        history: st.history.slice(-8).reverse(),
    };
}

/** The colony screen's Voidbloom lines (empty when nothing to say). Pure. */
export function voidbloomColonyLines(galaxy: Galaxy, h: Habitat): string[] {
    if (!vbOn(galaxy)) return [];
    const out: string[] = [];
    const w = bloomWorldOf(galaxy, h);
    if (w !== null) {
        out.push(scenarioText('Voidbloom Colony World'));
        if (h.empire !== null) out.push(`Workers ${fmt((h.population?.totalAmount ?? 0) / 1e6)}M, garrison ${garrisonOf(h)}/${garrisonNeeded(galaxy, h)}, yield ${worldYield(galaxy, w)} / 30 days, stock ${fmt(voidbloomStock(galaxy, h))}${galaxyStarDate(galaxy) < w.burnedUntil ? ' (fields burned)' : ''}`);
    }
    const c = peekVbColony(galaxy, h);
    if (c !== null && (c.a > 0.005 || c.tasted >= 0)) {
        const since = c.sup < 0 ? Infinity : (galaxyStarDate(galaxy) - c.sup) / GAME_DAY_LENGTH;
        const state = since <= 45 ? 'supplied' : c.a > 0.05 ? 'in withdrawal' : 'not supplied';
        out.push(`Voidbloom addiction ${Math.round(c.a * 100)}% (${state})${c.den ? ', spore dens' : ''}`);
    } else if (c !== null && c.x > 0.05) out.push(`Voidbloom exposure ${Math.round(c.x * 100)}%`);
    return out;
}

/** The colonies list's approval breakdown lines (Voidbloom's term). Pure. */
export function voidbloomApprovalLines(galaxy: Galaxy, h: Habitat): { label: string; value: number }[] {
    const v = voidbloomApproval(galaxy, h);
    return v === null ? [] : [{ label: 'Voidbloom', value: v }];
}

/** Map marks: Voidbloom worlds in explored systems and colonies with addiction, for `viewer`. Pure. */
export interface VbMapMarks {
    worlds: { x: number; y: number; label: string; owned: boolean }[];
    addicted: { x: number; y: number; a: number; label: string }[];
}

export function voidbloomMapMarks(galaxy: Galaxy, viewer: Empire | null): VbMapMarks | null {
    if (!vbOn(galaxy) || viewer === null) return null;
    const st = peekVbState(galaxy);
    if (st === null) return null;
    const explored = (h: Habitat): boolean => h.empire === viewer || (viewer.visibility?.checkSystemExplored?.(h.systemIndex) ?? false);
    const worlds = st.worlds
        .filter((w) => !w.habitat.hasBeenDestroyed && explored(w.habitat))
        .map((w) => ({ x: w.habitat.xpos, y: w.habitat.ypos, label: `${w.habitat.name}: Voidbloom world${w.habitat.empire !== null ? ` (${w.habitat.empire.name})` : ''}`, owned: w.habitat.empire === viewer }));
    const addicted: VbMapMarks['addicted'] = [];
    for (const k of Object.keys(st.colonies)) {
        const c = st.colonies[Number(k)];
        if (c.a < 0.05) continue;
        const h = galaxy.habitats[Number(k)];
        if (h === undefined || h === null || h.hasBeenDestroyed || h.empire === null || !explored(h)) continue;
        addicted.push({ x: h.xpos, y: h.ypos, a: c.a, label: `${h.name}: Voidbloom addiction ${Math.round(c.a * 100)}%` });
    }
    return { worlds, addicted };
}

// ---------------------------------------------------------------------------------------------------------------
// Player commands (playerOps)
// ---------------------------------------------------------------------------------------------------------------

export function playerSetPolicy(galaxy: Galaxy, e: Empire, policy: string): boolean {
    return setPolicy(galaxy, e, policy as VbPolicy, true);
}

export function playerSetAutomation(galaxy: Galaxy, e: Empire, opts: { labour?: boolean; garrison?: boolean }): boolean {
    if (!vbOn(galaxy) || !isNormal(galaxy, e)) return false;
    const rec = vbEmpire(galaxy, e);
    if (typeof opts.labour === 'boolean') rec.autoLabour = opts.labour;
    if (typeof opts.garrison === 'boolean') rec.autoGarrison = opts.garrison;
    return true;
}

export function playerLabourConvoy(galaxy: Galaxy, e: Empire, world: Habitat): boolean {
    return sendLabourConvoy(galaxy, e, world);
}

export function playerLevyGarrison(galaxy: Galaxy, e: Empire, world: Habitat): boolean {
    return vbOn(galaxy) && world.empire === e && bloomWorldOf(galaxy, world) !== null && levyGarrison(galaxy, e, world);
}

export function playerStartDetox(galaxy: Galaxy, e: Empire): boolean {
    return startDetox(galaxy, e);
}

