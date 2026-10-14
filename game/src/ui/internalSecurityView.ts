// 19m internal security (tasks/19-mod-layer-scenarios.md §19m) + the threat framework: the pure view model of the
// Intelligence screen's "Threats & Leads" section (every known threat site and every 19m lead, with Investigate /
// Go to / the 19m actions), the Empire Summary Stability row and the colony approval tooltip. Not a port. No DOM;
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
import { BuiltObject } from '../sim/builtObject';
import { Habitat as HabitatClass } from '../sim/types';
import { Character as CharacterClass } from '../sim/characters';
import { KNOWLEDGE_CONFIRMED, threatAddonOn, threatKnownSites } from '../sim/scenario/threats/framework';
import { threatInvestigateBlocked, threatInvestigationOf, threatInvestigators } from '../sim/scenario/threats/investigate';

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

// ---------------------------------------------------------------------------------------------------------------
// Intelligence screen "Threats & Leads" section: threat-framework sites + 19m leads in one list
// ---------------------------------------------------------------------------------------------------------------

/** The section shows whenever a threat add-on or Internal Security is on. */
export function threatsSectionVisible(galaxy: Galaxy): boolean {
    return threatAddonOn(galaxy) || securityOn(galaxy);
}

export type ThreatInvestigateRef = { kind: 'lead'; leadId: number } | { kind: 'site'; threat: string; target: Habitat | BuiltObject };

export interface ThreatLeadRow {
    /** Stable grid key (the lead, or the site's target). */
    key: unknown;
    what: string;
    where: string;
    certainty: 'suspected' | 'confirmed' | 'cleared';
    found: string;
    foundDate: number;
    status: string;
    closed: boolean;
    /** Where Go to centres the map (null: unknown / in transit). */
    goTo: Habitat | BuiltObject | null;
    /** How Investigate is issued (null: not offered for this row). */
    investigate: ThreatInvestigateRef | null;
    /** 19m actions the (confirmed) lead unlocks; [] without Internal Security. */
    actions: { action: SecurityActionName; label: string }[];
}

function locationOf(t: unknown): Habitat | BuiltObject | null {
    if (t instanceof HabitatClass || t instanceof BuiltObject) return t;
    if (t instanceof CharacterClass) {
        const loc = t.location;
        if (loc instanceof HabitatClass || loc instanceof BuiltObject) return loc;
    }
    return null;
}

/**
 * Every threat site / lead `empire` knows: the 19m leads (open first, newest first, then closed), then the known
 * threat-framework sites (suspected or confirmed) no open lead already covers, newest first. Pure.
 */
export function threatLeadRows(galaxy: Galaxy, empire: Empire): ThreatLeadRow[] {
    if (!threatsSectionVisible(galaxy)) return [];
    const out: ThreatLeadRow[] = [];
    const covered = new Set<unknown>();
    for (const r of leadRows(galaxy, empire)) {
        if (!r.lead.closed) covered.add(r.lead.target);
        out.push({
            key: r.lead,
            what: r.kind,
            where: r.target,
            certainty: r.lead.level,
            found: r.since,
            foundDate: r.lead.since,
            status: r.status,
            closed: r.lead.closed,
            goTo: locationOf(r.lead.target),
            investigate: r.canInvestigate ? { kind: 'lead', leadId: r.lead.id } : null,
            actions: r.actions,
        });
    }
    const anyAgent = threatInvestigators(galaxy, empire)[0] ?? null;
    const sites: ThreatLeadRow[] = [];
    for (const s of threatKnownSites(galaxy, empire)) {
        if (covered.has(s.target)) continue;
        const k = s.site?.knowledge.find((x) => x.empireId === empire.empireId);
        const inv = threatInvestigationOf(galaxy, empire, s.threat, s.target);
        const confirmed = s.level >= KNOWLEDGE_CONFIRMED;
        const date = k?.date ?? 0;
        sites.push({
            key: s.target,
            what: s.label,
            where: (s.target as { name?: string }).name ?? '?',
            certainty: confirmed ? 'confirmed' : 'suspected',
            found: k !== undefined ? resolveStarDateDescription(date) : '',
            foundDate: date,
            status: inv !== null ? `Investigating (${inv.agent.name})` : confirmed ? 'Confirmed' : 'Suspected — investigate to confirm',
            closed: false,
            goTo: locationOf(s.target),
            investigate: threatInvestigateBlocked(galaxy, empire, s.threat, s.target, anyAgent) === null ? { kind: 'site', threat: s.threat, target: s.target } : null,
            actions: [],
        });
    }
    sites.sort((a, b) => b.foundDate - a.foundDate);
    return out.concat(sites);
}

/** Agents the player may put on a site or a lead (free of both kinds of investigation). */
export function threatInvestigatorOptions(galaxy: Galaxy, empire: Empire): Character[] {
    return threatInvestigators(galaxy, empire);
}
