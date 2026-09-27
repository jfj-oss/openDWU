// 19m internal security (tasks/19-mod-layer-scenarios.md §19m): the pure view model of the Intelligence screen's
// "Internal Security" tab, the Empire Summary Stability row and the colony approval tooltip. Not a port. No DOM;
// read-only: never creates scenario state, never draws.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { Habitat } from '../sim/types';
import type { Character } from '../sim/characters';
import { scenarioText } from '../sim/scenario/messages';
import { peekSecurityState, securityOn, type Lead } from '../sim/scenario/security/registry';
import {
    SECURITY_ACTIONS,
    availableInvestigators,
    colonyLedger,
    empireLedger,
    investigateBlocked,
    investigatingAgent,
    leadTargetName,
    securityActionBlocked,
    type LedgerEntry,
    type SecurityActionName,
} from '../sim/scenario/security/security';
import { resolveStarDateDescription } from '../sim/galaxyTime';

export function securityVisible(galaxy: Galaxy): boolean {
    return securityOn(galaxy);
}

const ACTION_LABELS: Record<SecurityActionName, string> = {
    arrest: 'Arrest',
    exile: 'Exile',
    purge: 'Purge',
    amnesty: 'Amnesty',
    quarantine: 'Quarantine',
    martialLaw: 'Martial law',
    recallFleet: 'Recall fleet',
    scrapShip: 'Scrap ship',
};

export interface LeadRow {
    lead: Lead;
    kind: string;
    target: string;
    level: string;
    since: string;
    status: string;
    investigator: string | null;
    canInvestigate: boolean;
    actions: { action: SecurityActionName; label: string }[];
}

/** The player's leads, open first (newest first), then closed ones. */
export function leadRows(galaxy: Galaxy, empire: Empire): LeadRow[] {
    const st = peekSecurityState(galaxy);
    if (st === null) return [];
    const leads = st.leads.filter((l) => l.empire === empire).sort((a, b) => Number(a.closed) - Number(b.closed) || b.id - a.id);
    const anyAgent = availableInvestigators(galaxy, empire)[0] ?? null;
    return leads.map((lead) => {
        const agent = investigatingAgent(galaxy, lead);
        return {
            lead,
            kind: scenarioText(`Security Kind ${lead.kind}`),
            target: leadTargetName(lead),
            level: lead.level,
            since: resolveStarDateDescription(lead.since),
            status: lead.closed ? lead.outcome : agent !== null ? `Investigating (${agent.name})` : lead.source,
            investigator: agent?.name ?? null,
            canInvestigate: investigateBlocked(galaxy, empire, lead, anyAgent) === null,
            actions: SECURITY_ACTIONS.filter((a) => securityActionBlocked(galaxy, empire, a, lead) === null).map((a) => ({ action: a, label: ACTION_LABELS[a] })),
        };
    });
}

/** Agents the player may put on a lead. */
export function investigatorOptions(galaxy: Galaxy, empire: Empire): Character[] {
    return availableInvestigators(galaxy, empire);
}

function line(e: LedgerEntry): string {
    return `${e.label} ${e.value >= 0 ? '+' : '−'}${Math.abs(e.value).toFixed(1)}`;
}

/** Empire Summary "Stability" row from the ledger (null with the flag off). `title` lists the causes. */
export function ledgerStabilityRow(galaxy: Galaxy, empire: Empire): { label: string; value: string; title: string } | null {
    if (!securityOn(galaxy)) return null;
    const l = empireLedger(galaxy, empire);
    return { label: 'Stability', value: `${l.total.toFixed(1)} (approval, ${l.colonies} colonies)`, title: l.entries.map(line).join('\n') };
}

/** Colony approval tooltip lines from the ledger (null with the flag off). */
export function colonyLedgerLines(galaxy: Galaxy, h: Habitat): { label: string; value: number }[] | null {
    if (!securityOn(galaxy) || h.empire === null) return null;
    return colonyLedger(galaxy, h).entries.map((e) => ({ label: e.label, value: e.value }));
}
