// Emergent Galaxy 19d1 (tasks/19d1-internal-politics.md §6): the pure view model the Characters screen, the Empire
// Summary and the Colonies list show when the `internalPolitics` flag is on. Not a port. No DOM here; the screens wire
// it inside their `// [emergent] begin/end` blocks. Read-only: never creates the politics state, never draws.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { Habitat } from '../sim/types';
import { type Character, CharacterRole, getEmpireCharacters } from '../sim/characters';
import { scenarioFlag } from '../sim/scenario/state';
import { scenarioText } from '../sim/scenario/messages';
import { POLITICS_FLAG, empireInstability, honourCost, peekPoliticsState, stabilityLabel } from '../sim/scenario/emergent/politics';
import { arrestBlocked, honourBlocked, purgeBlocked, type PoliticsActionName } from '../sim/scenario/emergent/politicsActions';

/** True when the politics columns / blocks show. */
export function politicsVisible(galaxy: Galaxy): boolean {
    return scenarioFlag(galaxy, POLITICS_FLAG);
}

/** The Loyalty / Ambition cells of a character row ('—' before the character is modelled). */
export function politicsRowCells(galaxy: Galaxy, c: Character): { loyalty: string; ambition: string; risk: boolean } {
    const e = peekPoliticsState(galaxy)?.chars.get(c);
    if (e === undefined || c.role === CharacterRole.Leader) return { loyalty: '—', ambition: '—', risk: false };
    return { loyalty: String(Math.round(e.loyalty)), ambition: String(Math.round(e.ambition)), risk: e.loyalty < 35 && e.ambition > 60 };
}

export interface PoliticsButton {
    action: PoliticsActionName;
    label: string;
    enabled: boolean;
    reason: string;
}

export interface PoliticsDetail {
    loyalty: string;
    trend: string;
    exposed: boolean;
    /** The causes of the last yearly change, largest first ("Approval +3.2"). */
    causes: string[];
    /** Grievances of the last 5 years ("2151 War weariness −4.0"). */
    grievances: string[];
    buttons: PoliticsButton[];
}

function signed(v: number): string {
    return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1);
}

/** Display name of a delta cause (GameText "Emergent Reason <cause>"). */
export function causeLabel(cause: string): string {
    return scenarioText(`Emergent Reason ${cause}`);
}

/** The "Politics" block of a character's summary (null: flag off, leader, or not modelled yet). */
export function politicsDetail(galaxy: Galaxy, player: Empire, c: Character): PoliticsDetail | null {
    if (!politicsVisible(galaxy) || c.role === CharacterRole.Leader) return null;
    const st = peekPoliticsState(galaxy);
    const e = st?.chars.get(c);
    if (st === null || e === undefined) return null;
    const causes = [...e.lastCauses].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).map((x) => `${causeLabel(x.cause)} ${signed(x.amount)}`);
    const grievances = e.grievances.map((g) => `${g.year} ${causeLabel(g.cause)} ${signed(g.amount)}`);
    const honour = honourBlocked(galaxy, player, c);
    const arrest = arrestBlocked(galaxy, player, c);
    const purge = purgeBlocked(galaxy, player, c);
    return {
        loyalty: `${Math.round(e.loyalty)} / 100`,
        trend: e.loyaltyTrend === 0 ? '—' : signed(e.loyaltyTrend),
        exposed: st.exposed.has(c),
        causes,
        grievances,
        buttons: [
            { action: 'honour', label: `Honour (${honourCost(c).toLocaleString('en-US')})`, enabled: honour === null, reason: honour ?? '' },
            { action: 'arrest', label: 'Arrest', enabled: arrest === null, reason: arrest ?? '' },
            { action: 'purge', label: 'Purge', enabled: purge === null, reason: purge ?? '' },
        ],
    };
}

/** Empire Summary "Stability" row (null with the flag off). */
export function stabilityRow(galaxy: Galaxy, empire: Empire): { label: string; value: string } | null {
    if (!politicsVisible(galaxy)) return null;
    const i = empireInstability(galaxy, empire);
    return { label: 'Stability', value: `${scenarioText(`Emergent Stability ${stabilityLabel(i)}`)} (${i.toFixed(2)})` };
}

/** Colonies list: the governor's loyalty for the governor tooltip (null: flag off / no governor). */
export function governorLoyaltyText(galaxy: Galaxy, colony: Habitat): string | null {
    if (!politicsVisible(galaxy) || colony.empire === null) return null;
    const st = peekPoliticsState(galaxy);
    if (st === null) return null;
    for (const c of getEmpireCharacters(colony.empire)) {
        if (c.role !== CharacterRole.ColonyGovernor || c.location !== colony) continue;
        const e = st.chars.get(c);
        if (e !== undefined) return `${c.name}: loyalty ${Math.round(e.loyalty)}, ambition ${Math.round(e.ambition)}`;
    }
    return null;
}
