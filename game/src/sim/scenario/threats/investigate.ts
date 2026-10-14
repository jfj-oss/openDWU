// Framework investigation of a suspected threat site (the Intelligence screen's "Threats & Leads" section). Not a
// port: the minimal "Investigate" path for threat-framework sites, so a player with a Galactic Threats add-on on but
// Internal Security off can act on a suspected site. With Internal Security on, a site that has a 19m lead is
// investigated through the lead (security.ts startInvestigation) instead; this path covers every other suspected site.
//
// Player-only: through the command queue (player/playerOps.ts 'threatInvestigate'); the AI never starts one. Gate: the
// command refuses unless a threat add-on flag is on; the state bag is created only by a started investigation, and the
// periodic handler returns at once without it — no state, no draws in any game where nobody investigates. Rnd: one
// galaxy.rnd draw per resolved investigation (the resolution roll), only inside the periodic handler.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import type { BuiltObject } from '../../builtObject';
import type { Character } from '../../characters';
import { IntelligenceMissionType, characterMission, newCounterIntelligenceMission } from '../../espionage';
import { EmpireMessageType } from '../../messages';
import { galaxyStarDate } from '../../tick/simTime';
import { GAME_DAY_LENGTH, registerScenarioPeriodic } from '../hooks';
import { scenarioMessage } from '../messages';
import { scenarioParam } from '../state';
import { availableInvestigators, investigationChance, investigatorSkill } from '../security/security';
import { KNOWLEDGE_CONFIRMED, KNOWLEDGE_SUSPECTED, peekThreatState, revealTo, threatAddonOn, threatKnownSites, threatState, type KnownThreatSite } from './framework';

export const THREAT_INVESTIGATIONS_KEY = 'threatInvestigations';
/** Concealment of a framework site in the resolution roll (the counter-intelligence scale, 25–100: a mid value). */
export const THREAT_SITE_CONCEALMENT = 60;

export interface ThreatInvestigation {
    threat: string;
    target: Habitat | BuiltObject;
    agent: Character;
    empire: Empire;
    start: number;
    due: number;
}

interface ThreatInvestigationState {
    list: ThreatInvestigation[];
}

function peekInvestigations(galaxy: Galaxy): ThreatInvestigation[] {
    return peekThreatState<ThreatInvestigationState>(galaxy, THREAT_INVESTIGATIONS_KEY)?.list ?? [];
}

/** The known site row of (threat, target) for `empire`, or null. Pure. */
export function knownThreatSite(galaxy: Galaxy, empire: Empire, threat: string, target: unknown): KnownThreatSite | null {
    return threatKnownSites(galaxy, empire).find((s) => s.threat === threat && s.target === target) ?? null;
}

/** The running investigation of (threat, target) by `empire`, or null. Pure. */
export function threatInvestigationOf(galaxy: Galaxy, empire: Empire, threat: string, target: unknown): ThreatInvestigation | null {
    return peekInvestigations(galaxy).find((i) => i.empire === empire && i.threat === threat && i.target === target) ?? null;
}

/** Agents of `empire` free for a site investigation (idle or on counter-intelligence, not on a lead or a site). Pure. */
export function threatInvestigators(galaxy: Galaxy, empire: Empire): Character[] {
    const busy = new Set(peekInvestigations(galaxy).map((i) => i.agent));
    return availableInvestigators(galaxy, empire).filter((c) => !busy.has(c));
}

/** Why `agent` cannot investigate the site (null: it can). Pure. */
export function threatInvestigateBlocked(galaxy: Galaxy, empire: Empire, threat: string, target: unknown, agent: Character | null): string | null {
    if (!threatAddonOn(galaxy)) return 'No galactic threats';
    const site = knownThreatSite(galaxy, empire, threat, target);
    if (site === null || site.site === undefined) return 'No such site';
    if (site.level >= KNOWLEDGE_CONFIRMED) return 'Already confirmed';
    if (site.level < KNOWLEDGE_SUSPECTED) return 'Not suspected';
    if (threatInvestigationOf(galaxy, empire, threat, target) !== null) return 'Already under investigation';
    if (agent === null) return 'No agent';
    if (!threatInvestigators(galaxy, empire).includes(agent)) return 'Agent unavailable';
    return null;
}

/** Assigns `agent` to the site: the agent is put on (or stays on) counter-intelligence while the investigation runs. */
export function startThreatInvestigation(galaxy: Galaxy, empire: Empire, threat: string, target: Habitat | BuiltObject, agent: Character): { ok: boolean; reason?: string } {
    const why = threatInvestigateBlocked(galaxy, empire, threat, target, agent);
    if (why !== null) return { ok: false, reason: why };
    const m = characterMission(agent);
    if (m === null || m.type !== IntelligenceMissionType.CounterIntelligence) agent.mission = newCounterIntelligenceMission(galaxy, empire, agent);
    const now = galaxyStarDate(galaxy);
    const days = scenarioParam(galaxy, 'threatInvestigateDays', 90);
    threatState<ThreatInvestigationState>(galaxy, THREAT_INVESTIGATIONS_KEY, () => ({ list: [] })).list.push({ threat, target, agent, empire, start: now, due: now + days * GAME_DAY_LENGTH });
    return { ok: true };
}

/** Periodic: resolves the due investigations (one roll each); drops those whose agent left the post or whose site is gone / confirmed. */
export function reviewThreatInvestigations(galaxy: Galaxy): void {
    const st = peekThreatState<ThreatInvestigationState>(galaxy, THREAT_INVESTIGATIONS_KEY);
    if (st === null || st.list.length === 0) return;
    const now = galaxyStarDate(galaxy);
    for (const inv of [...st.list]) {
        const site = knownThreatSite(galaxy, inv.empire, inv.threat, inv.target);
        const m = characterMission(inv.agent);
        const cancelled = site === null || site.site === undefined || site.level >= KNOWLEDGE_CONFIRMED || !inv.agent.active || inv.agent.empire !== inv.empire || m === null || m.type !== IntelligenceMissionType.CounterIntelligence;
        if (cancelled) {
            st.list.splice(st.list.indexOf(inv), 1);
            continue;
        }
        if (now < inv.due) continue;
        st.list.splice(st.list.indexOf(inv), 1);
        const chance = investigationChance(investigatorSkill(inv.agent, inv.empire), THREAT_SITE_CONCEALMENT);
        // RND(threat investigation): the resolution roll
        const confirmed = galaxy.rnd.nextDouble() < chance;
        const where = (inv.target as { name?: string }).name ?? '?';
        if (confirmed) revealTo(galaxy, site.site!, inv.empire, KNOWLEDGE_CONFIRMED);
        scenarioMessage(
            galaxy,
            inv.empire,
            confirmed ? 'Threat confirmed' : 'Investigation inconclusive',
            confirmed ? `${inv.agent.name} has confirmed the threat at ${where}: ${site.label}.` : `${inv.agent.name} found nothing conclusive at ${where}. The site remains suspected; another agent may try again.`,
            { type: confirmed ? EmpireMessageType.GeneralWarning : EmpireMessageType.GeneralNeutralEvent, subject: inv.target },
        );
    }
}

registerScenarioPeriodic({ id: 'threats.investigations', scenarioId: 'threat-framework', periodDays: 10, run: (g) => reviewThreatInvestigations(g) });
