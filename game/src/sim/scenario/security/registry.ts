// 19m internal security — the hidden-thing registry and the leads (tasks/19-mod-layer-scenarios.md §19m item 2). Not a
// port. Every package that hides something inside an empire (19d1 plots, 19f converts / sleepers / Hive nodes / farms /
// nests / bought governors, 19d3 foreign agents) joins it with one registerHiddenThing call at its creation point; the
// 19m package (security.ts) rolls ONE yearly detection per hidden thing and keeps the leads.
//
// This module is data only (no messages, no Rnd, no package imports) so the packages can import it without cycles.
// Every entry point is a no-op unless the scenario flag `internalSecurity` is on: with it off nothing is created.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import type { BuiltObject } from '../../builtObject';
import type { Character } from '../../characters';
import { galaxyStarDate } from '../../tick/simTime';
import { scenarioFlag, scenarioState } from '../state';

export const SECURITY_FLAG = 'internalSecurity';

export type HiddenKind = 'plot' | 'convert' | 'sleeper' | 'hiveNode' | 'farm' | 'nest' | 'boughtGovernor' | 'foreignAgent' | 'scheme' | 'secret';
export type HiddenTarget = Character | BuiltObject | Habitat;

/** What a package passes when something hidden appears. */
export interface HiddenThingSpec {
    /** Stable id (optional: the registry assigns `<kind>#<n>`). */
    id?: string;
    kind: HiddenKind;
    /** Concealment (the counter-intelligence skill scale: a Character's CounterEspionageFactored is 25–100). */
    concealment: number;
    /** The empire the thing hides in (null: in nobody's territory — the nearest colony's owner looks for it). */
    empire: Empire | null;
    target: HiddenTarget;
    /** Package key (e.g. "19f.cult"). */
    package: string;
    /** The package's knowledge-carrying record (threat framework ThreatSite), for mirroring its own discovery. */
    site?: { knowledge: unknown[]; state?: string } | null;
}

export interface HiddenThing {
    id: string;
    kind: HiddenKind;
    concealment: number;
    empire: Empire | null;
    target: HiddenTarget;
    package: string;
    site: { knowledge: unknown[]; state?: string } | null;
    /** Star date of registration. */
    since: number;
    retired: boolean;
}

export type LeadLevel = 'suspected' | 'confirmed' | 'cleared';
/** How the lead's level was last set. */
export type LeadSource = 'roll' | 'package' | 'investigation' | 'exposure';

export interface Lead {
    id: number;
    thingId: string;
    kind: HiddenKind;
    empire: Empire;
    target: HiddenTarget;
    level: LeadLevel;
    source: LeadSource;
    since: number;
    updated: number;
    /** The hidden thing is gone (dead target, acted on, dissolved): kept for the list, no further rolls / actions. */
    closed: boolean;
    /** Why it closed (action or cause), '' while open. */
    outcome: string;
}

/** An agent on the "Investigate lead" mission (the 19m intel mission kind; the agent stays on counter-intelligence). */
export interface Investigation {
    leadId: number;
    agent: Character;
    empire: Empire;
    start: number;
    due: number;
}

export interface SecurityState {
    things: HiddenThing[];
    leads: Lead[];
    investigations: Investigation[];
    nextThing: number;
    nextLead: number;
    /** Quarantined colonies → star date the quarantine ends. */
    quarantine: Map<Habitat, number>;
    /** Colonies under martial law → star date it ends. */
    martialLaw: Map<Habitat, number>;
    /** Purges by 19m actions: empire → star date of the last one. */
    purges: Map<Empire, number>;
    /** Chain-reaction / action log (last 200; tests, chronicle). */
    log: { date: number; empire: Empire | null; text: string }[];
}

export function securityState(galaxy: Galaxy): SecurityState {
    return scenarioState<SecurityState>(galaxy, 'security', () => ({
        things: [],
        leads: [],
        investigations: [],
        nextThing: 1,
        nextLead: 1,
        quarantine: new Map(),
        martialLaw: new Map(),
        purges: new Map(),
        log: [],
    }));
}

/** The state if it exists (UI / pure readers: never creates it). */
export function peekSecurityState(galaxy: Galaxy): SecurityState | null {
    const s = galaxy.scenario;
    if (s === null || !('security' in s.state)) return null;
    return s.state.security as SecurityState;
}

export function securityOn(galaxy: Galaxy): boolean {
    return scenarioFlag(galaxy, SECURITY_FLAG);
}

/**
 * A package's hidden thing appears (idempotent on (kind, target, package) while the thing is live). Returns it, or
 * null with the flag off. No Rnd.
 */
export function registerHiddenThing(galaxy: Galaxy, spec: HiddenThingSpec): HiddenThing | null {
    if (!securityOn(galaxy)) return null;
    const st = securityState(galaxy);
    const existing = st.things.find((t) => !t.retired && t.kind === spec.kind && t.target === spec.target && t.package === spec.package);
    if (existing !== undefined) {
        existing.empire = spec.empire;
        existing.concealment = spec.concealment;
        if (spec.site !== undefined) existing.site = spec.site;
        return existing;
    }
    const thing: HiddenThing = {
        id: spec.id ?? `${spec.kind}#${st.nextThing}`,
        kind: spec.kind,
        concealment: spec.concealment,
        empire: spec.empire,
        target: spec.target,
        package: spec.package,
        site: spec.site ?? null,
        since: galaxyStarDate(galaxy),
        retired: false,
    };
    st.nextThing++;
    st.things.push(thing);
    return thing;
}

/** The live hidden thing of (kind, target), or undefined. */
export function findHiddenThing(galaxy: Galaxy, kind: HiddenKind, target: HiddenTarget): HiddenThing | undefined {
    const st = peekSecurityState(galaxy);
    return st?.things.find((t) => !t.retired && t.kind === kind && t.target === target);
}

/** A package removes a hidden thing (it stopped being hidden or ceased to exist); its open leads close. */
export function retireHiddenThing(galaxy: Galaxy, thing: HiddenThing | undefined | null, outcome = 'gone'): void {
    if (!securityOn(galaxy) || thing === undefined || thing === null || thing.retired) return;
    thing.retired = true;
    const st = securityState(galaxy);
    const now = galaxyStarDate(galaxy);
    for (const l of st.leads) {
        if (l.thingId !== thing.id || l.closed) continue;
        l.closed = true;
        l.outcome = outcome;
        l.updated = now;
    }
    st.investigations = st.investigations.filter((i) => st.leads.find((l) => l.id === i.leadId)?.closed !== true);
}

/** retireHiddenThing by (kind, target). */
export function retireHiddenTarget(galaxy: Galaxy, kind: HiddenKind, target: HiddenTarget, outcome = 'gone'): void {
    if (!securityOn(galaxy)) return;
    retireHiddenThing(galaxy, findHiddenThing(galaxy, kind, target), outcome);
}

/** The open lead of `empire` on `thing` (undefined: none). */
export function openLead(st: SecurityState, thing: HiddenThing, empire: Empire): Lead | undefined {
    return st.leads.find((l) => !l.closed && l.thingId === thing.id && l.empire === empire);
}

const RANK: Record<LeadLevel, number> = { cleared: 0, suspected: 1, confirmed: 2 };

/**
 * Sets `empire`'s lead on `thing` to `level` (creating it). A roll / package mirror only raises the level; an
 * investigation may clear it. Returns the lead when its level changed (the caller sends messages), else null.
 */
export function setLeadLevel(galaxy: Galaxy, thing: HiddenThing, empire: Empire, level: LeadLevel, source: LeadSource): Lead | null {
    if (!securityOn(galaxy) || thing.retired) return null;
    const st = securityState(galaxy);
    const now = galaxyStarDate(galaxy);
    let lead = openLead(st, thing, empire);
    if (lead === undefined) {
        if (level === 'cleared') return null;
        lead = { id: st.nextLead++, thingId: thing.id, kind: thing.kind, empire, target: thing.target, level, source, since: now, updated: now, closed: false, outcome: '' };
        st.leads.push(lead);
        return lead;
    }
    if (lead.level === level) return null;
    if (source !== 'investigation' && RANK[level] < RANK[lead.level]) return null;
    lead.level = level;
    lead.source = source;
    lead.updated = now;
    return lead;
}

/**
 * A package's own discovery (19d1 exposure, the threat framework's revealTo) mirrored into the leads: every live thing
 * whose site carries `knowledge` (or whose target is `target`) gets `empire`'s lead raised. Framework level 2 =
 * suspected, 3 = confirmed; lower levels (rumours) make no lead. No Rnd.
 */
export function mirrorPackageDiscovery(galaxy: Galaxy, match: { knowledge?: unknown[]; target?: HiddenTarget; kind?: HiddenKind }, empire: Empire, frameworkLevel: number, source: LeadSource = 'package'): Lead[] {
    if (!securityOn(galaxy) || frameworkLevel < 2) return [];
    const st = securityState(galaxy);
    const level: LeadLevel = frameworkLevel >= 3 ? 'confirmed' : 'suspected';
    const out: Lead[] = [];
    for (const t of st.things) {
        if (t.retired) continue;
        const hit = (match.knowledge !== undefined && t.site !== null && t.site.knowledge === match.knowledge) || (match.target !== undefined && t.target === match.target && (match.kind === undefined || match.kind === t.kind));
        if (!hit) continue;
        const l = setLeadLevel(galaxy, t, empire, level, source);
        if (l !== null) out.push(l);
    }
    return out;
}

export function securityLog(galaxy: Galaxy, empire: Empire | null, text: string): void {
    const st = securityState(galaxy);
    st.log.push({ date: galaxyStarDate(galaxy), empire, text });
    if (st.log.length > 200) st.log.splice(0, st.log.length - 200);
}

// ---------------------------------------------------------------------------------------------------------------
// Hooks the ported / package code calls (each a no-op with the flag off; none draws)
// ---------------------------------------------------------------------------------------------------------------

/** True while `h` is under a 19m quarantine (blocks migration and refugee inflow). */
export function colonyQuarantined(galaxy: Galaxy, h: Habitat): boolean {
    if (!securityOn(galaxy)) return false;
    const until = peekSecurityState(galaxy)?.quarantine.get(h);
    return until !== undefined && galaxyStarDate(galaxy) < until;
}

/** True while `h` is under 19m martial law (no secession: the ported LeaveEmpire and 19d1 secession plots). */
export function colonyUnderMartialLaw(galaxy: Galaxy, h: Habitat): boolean {
    if (!securityOn(galaxy)) return false;
    const until = peekSecurityState(galaxy)?.martialLaw.get(h);
    return until !== undefined && galaxyStarDate(galaxy) < until;
}

/**
 * civilianAI.ts reviewMigrationTourism (Empire.5.cs 3128 ReviewMigrationTourism): quarantined colonies leave the
 * migration-destination list (the ported list is a PrioritizedTarget array; filtered in place).
 */
export function removeQuarantinedDestinations(galaxy: Galaxy, list: { target?: unknown }[] | null): void {
    if (list === null || !securityOn(galaxy)) return;
    for (let i = list.length - 1; i >= 0; i--) {
        const t = list[i]?.target;
        if (t !== undefined && t !== null && colonyQuarantined(galaxy, t as Habitat)) list.splice(i, 1);
    }
}

/** Slots security.ts fills at import (so data-side callers need not import the package module). */
export interface SecuritySlots {
    /** 19d4 settleRefugeeConvoyArrival: refugees from `origin` settled at `destination` (may carry the creed; Rnd only with 19m + the cult on). */
    refugeesArrived: ((galaxy: Galaxy, origin: Habitat, destination: Habitat) => void) | null;
    /** 19n court: extra counter-intelligence strength of an empire in the detection roll (the spymaster); 0 when off. Pure. */
    strengthBonus: ((galaxy: Galaxy, empire: Empire) => number) | null;
    /** 19n court intrigue: is a court hidden thing (kind 'scheme' / 'secret', package '19n.*') still alive? Pure. */
    courtThingAlive: ((galaxy: Galaxy, thing: HiddenThing) => boolean) | null;
    /** 19n court intrigue: a lead on a court hidden thing changed level (the victim learns the schemer; a secret → a hook). No Rnd. */
    courtLeadChanged: ((galaxy: Galaxy, lead: Lead, thing: HiddenThing) => void) | null;
}
export const securitySlots: SecuritySlots = { refugeesArrived: null, strengthBonus: null, courtThingAlive: null, courtLeadChanged: null };

/** True for a hidden thing the 19n court package registered (its liveness and lead reactions are the court's). */
export function isCourtThing(thing: HiddenThing): boolean {
    return thing.package.startsWith('19n.');
}
