// 19m internal security (tasks/19-mod-layer-scenarios.md §19m). Not a port: a scenario package on the mod layer
// (tasks/MODLAYER-DESIGN.md) that ties 19d1 politics, 19d2 crises, 19d3 espionage, 19d4 demographics, the rim-fauna
// herd losses and the 19f hidden threats into one system:
//   1. the stability ledger — every approval contributor is a stability term WITH A CAUSE (scenario/stability.ts);
//      the ledger lists them per colony / empire and the ported revolt (Habitat.cs 5992 CheckSatisfaction) reads it;
//   2. leads — one yearly detection roll per hidden thing (registry.ts): counter-intelligence vs concealment;
//   3. investigations (the "Investigate lead" mission) and the actions a confirmed lead unlocks (player: command queue
//      ops `securityInvestigate` / `securityAction`; AI: by race caution / aggression);
//   4. chain reactions between the packages.
//
// Gate: every handler is registered with flag `internalSecurity`; the hook slots other packages call return their
// "off" value unless the flag is on. Rnd: galaxy.rnd is drawn only in the yearly handler (detection rolls), the
// investigation handler (the resolution roll), the refugee-creed roll (19d4 arrival, flag + cult on) and the stock
// functions the actions / the cultist coup call (cultTrigger's faction creation, a fleet's Move mission) — all behind
// the flag. Pure parts (ledger, strength, chances, UI rows) never draw and never create state.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import { BuiltObject } from '../../builtObject';
import { Character, CharacterRole, getEmpireCharacters, stellarObjectCharacters } from '../../characters';
import { characterSendDeathMessage, CharacterDeathType } from '../../characterRuntime';
import {
    IntelligenceMissionType,
    calculateIntelligenceMissionBonusFromLeaderAndAmbassador,
    cancelIntelligenceMission,
    characterMission,
    newCounterIntelligenceMission,
} from '../../espionage';
import { empireApprovalRatingStock } from '../../taxes';
import { EmpireMessageType } from '../../messages';
import { YEAR_LENGTH } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { builtObjectCompleteTeardown } from '../../combat/teardown';
import { assignMission } from '../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, isHabitat } from '../../missions/mission';
import { shipGroupAssignMission } from '../../fleets/shipGroupTasks';
import type { ShipGroup } from '../../fleets/shipGroup';
import { GAME_DAY_LENGTH, registerScenarioPeriodic, registerScenarioQuery, registerScenarioYearly, scenarioQuery } from '../hooks';
import { scenarioFlag, scenarioParam } from '../state';
import { scenarioMessage, scenarioText } from '../messages';
import { registerStabilityTerm, stabilityTermValues } from '../stability';
import { KNOWLEDGE_CONFIRMED, revealTo, type ThreatSite } from '../threats/framework';
import { convert, cultHeldColonies, cultTrigger, peekCultState } from '../threats/cult';
import { POLITICS_FLAG, defectionTarget, governedColony, isPoliticalEmpire, peekPoliticsState, politicsEntry, politicsHooks, politicsState } from '../emergent/politics';
import { runPoliticsAction } from '../emergent/politicsActions';
import {
    SECURITY_FLAG,
    colonyQuarantined,
    colonyUnderMartialLaw,
    openLead,
    peekSecurityState,
    registerHiddenThing,
    retireHiddenThing,
    securityLog,
    securityOn,
    securitySlots,
    securityState,
    setLeadLevel,
    mirrorPackageDiscovery,
    type HiddenThing,
    type Lead,
    type SecurityState,
} from './registry';

export { SECURITY_FLAG };
const CULT_FLAG = 'cult';

// ---------------------------------------------------------------------------------------------------------------
// Params (scenarios/internal-security/scenario.json)
// ---------------------------------------------------------------------------------------------------------------

const P = {
    detectPct: (g: Galaxy) => scenarioParam(g, 'securityDetectPct', 60),
    investigateDays: (g: Galaxy) => scenarioParam(g, 'securityInvestigateDays', 90),
    purgeApproval: (g: Galaxy) => scenarioParam(g, 'securityPurgeApproval', 5),
    purgeYears: (g: Galaxy) => scenarioParam(g, 'securityPurgeYears', 2),
    martialLawApproval: (g: Galaxy) => scenarioParam(g, 'securityMartialLawApproval', 8),
    martialLawYears: (g: Galaxy) => scenarioParam(g, 'securityMartialLawYears', 5),
    quarantineYears: (g: Galaxy) => scenarioParam(g, 'securityQuarantineYears', 3),
    cultWeight: (g: Galaxy) => scenarioParam(g, 'securityCultWeight', 10),
    cultLoyalty: (g: Galaxy) => scenarioParam(g, 'securityCultLoyalty', 5),
    refugeeCreedPct: (g: Galaxy) => scenarioParam(g, 'securityRefugeeCreedPct', 50),
    amnestyLoyalty: (g: Galaxy) => scenarioParam(g, 'securityAmnestyLoyalty', 20),
    emboldenAmbition: (g: Galaxy) => scenarioParam(g, 'securityEmboldenAmbition', 10),
};

/** Governor loyalty below which the governor's disloyalty is an approval term (19d1's "at risk" threshold). */
const LOYALTY_THRESHOLD = 35;

function isNormal(galaxy: Galaxy, e: Empire | null): e is Empire {
    return isPoliticalEmpire(galaxy, e);
}

function colonyGovernor(h: Habitat): Character | null {
    const chars = stellarObjectCharacters(h);
    if (chars === null) return null;
    for (const c of chars) if (c.active && c.role === CharacterRole.ColonyGovernor && c.empire === h.empire) return c;
    return null;
}

function isConvert(galaxy: Galaxy, c: Character): boolean {
    if (!scenarioFlag(galaxy, CULT_FLAG)) return false;
    const cst = peekCultState(galaxy);
    return cst !== null && cst.converted.some((r) => r.character === c);
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Stability ledger
// ---------------------------------------------------------------------------------------------------------------

/** 19f cult influence: −weight × the converted share of the characters at the colony. */
export function cultInfluenceTerm(galaxy: Galaxy, h: Habitat): number | null {
    if (h.empire === null || !scenarioFlag(galaxy, CULT_FLAG)) return null;
    const cst = peekCultState(galaxy);
    if (cst === null || cst.converted.length === 0) return null;
    const chars = (stellarObjectCharacters(h) ?? []).filter((c) => c.active);
    if (chars.length === 0) return null;
    const n = chars.filter((c) => cst.converted.some((r) => r.character === c)).length;
    return n === 0 ? null : (-P.cultWeight(galaxy) * n) / chars.length;
}

/** 19d1 governor loyalty: (loyalty − 35) / 5 while the colony's governor is below 35. */
export function loyaltyTerm(galaxy: Galaxy, h: Habitat): number | null {
    if (h.empire === null || !scenarioFlag(galaxy, POLITICS_FLAG)) return null;
    const pst = peekPoliticsState(galaxy);
    const gov = colonyGovernor(h);
    if (pst === null || gov === null) return null;
    const e = pst.chars.get(gov);
    if (e === undefined || e.loyalty >= LOYALTY_THRESHOLD) return null;
    return (e.loyalty - LOYALTY_THRESHOLD) / 5;
}

/** Star date of the empire's last purge (19d1 purge or a 19m action), or null. */
function lastPurge(galaxy: Galaxy, empire: Empire): number | null {
    let best: number | null = null;
    const pst = peekPoliticsState(galaxy);
    const py = pst?.purgeYear.get(empire);
    if (py !== undefined) best = py * YEAR_LENGTH;
    const sd = peekSecurityState(galaxy)?.purges.get(empire);
    if (sd !== undefined && (best === null || sd > best)) best = sd;
    return best;
}

/** Purges (19d1 purgeCharacter or the 19m purge): −securityPurgeApproval on every colony for securityPurgeYears. */
export function purgeTerm(galaxy: Galaxy, h: Habitat): number | null {
    const e = h.empire;
    if (e === null) return null;
    const when = lastPurge(galaxy, e);
    if (when === null || galaxyStarDate(galaxy) - when > P.purgeYears(galaxy) * YEAR_LENGTH) return null;
    return -P.purgeApproval(galaxy);
}

export function martialLawTerm(galaxy: Galaxy, h: Habitat): number | null {
    return colonyUnderMartialLaw(galaxy, h) ? -P.martialLawApproval(galaxy) : null;
}

registerStabilityTerm({ id: 'security.cult', flag: SECURITY_FLAG, cause: 'cult', label: 'Cult influence', run: (g, h) => cultInfluenceTerm(g, h) });
registerStabilityTerm({ id: 'security.loyalty', flag: SECURITY_FLAG, cause: 'loyalty', label: 'Governor loyalty', run: (g, h) => loyaltyTerm(g, h) });
registerStabilityTerm({ id: 'security.martialLaw', flag: SECURITY_FLAG, cause: 'martialLaw', label: 'Martial law', run: (g, h) => martialLawTerm(g, h) });
registerStabilityTerm({ id: 'security.purge', flag: SECURITY_FLAG, cause: 'purges', label: 'Purges', run: (g, h) => purgeTerm(g, h) });

export interface LedgerEntry {
    cause: string;
    label: string;
    value: number;
}

export interface ColonyLedger {
    colony: Habitat;
    empire: Empire | null;
    entries: LedgerEntry[];
    total: number;
}

export interface EmpireLedger {
    empire: Empire;
    entries: LedgerEntry[];
    /** Average colony total (as Empire colonyApprovalAverage). */
    total: number;
    colonies: number;
}

/**
 * A colony's ledger: the stock EmpireApprovalRating (Habitat.cs 534) as "base", then every gated stability term (in
 * the fold order empireApprovalRating uses), then any other empireApprovalRating query as "other". The total is
 * exactly empireApprovalRating(galaxy, h). Pure.
 */
export function colonyLedger(galaxy: Galaxy, h: Habitat): ColonyLedger {
    const base = empireApprovalRatingStock(galaxy, h);
    const entries: LedgerEntry[] = [{ cause: 'base', label: 'Base approval', value: base }];
    let total = base;
    for (const t of stabilityTermValues(galaxy, h)) {
        entries.push({ cause: t.cause, label: t.label, value: t.value });
        total = total + t.value;
    }
    if (galaxy.scenario !== null) {
        const q = scenarioQuery(galaxy, 'empireApprovalRating', total, { habitat: h, empire: h.empire });
        if (q !== total) entries.push({ cause: 'other', label: 'Other', value: q - total });
        total = q;
    }
    return { colony: h, empire: h.empire, entries, total };
}

/** An empire's ledger: each cause averaged over its colonies. Pure. */
export function empireLedger(galaxy: Galaxy, empire: Empire): EmpireLedger {
    const n = empire.colonies.length;
    const sums = new Map<string, LedgerEntry>();
    let total = 0;
    for (const h of empire.colonies) {
        const l = colonyLedger(galaxy, h);
        total += l.total;
        for (const e of l.entries) {
            const s = sums.get(e.cause);
            if (s === undefined) sums.set(e.cause, { ...e });
            else s.value += e.value;
        }
    }
    const entries = [...sums.values()].map((e) => ({ ...e, value: n > 0 ? e.value / n : 0 }));
    return { empire, entries, total: n > 0 ? total / n : 0, colonies: n };
}

/** §19m item 1: the whole galaxy's ledger (normal empires). Pure. */
export function stabilityLedger(galaxy: Galaxy): { colonies: ColonyLedger[]; empires: EmpireLedger[] } {
    const colonies: ColonyLedger[] = [];
    const empires: EmpireLedger[] = [];
    for (const e of galaxy.empires) {
        if (!isNormal(galaxy, e)) continue;
        for (const h of e.colonies) colonies.push(colonyLedger(galaxy, h));
        empires.push(empireLedger(galaxy, e));
    }
    return { colonies, empires };
}

// The ported revolt reads the ledger (colonyTick.ts checkSatisfaction; Habitat.cs 5992 CheckSatisfaction): the same
// value empireApprovalRating gives, and under martial law never below the LeaveEmpire threshold (no secession).
registerScenarioQuery({
    id: 'security.revolt',
    flag: SECURITY_FLAG,
    query: 'colonyRevoltApproval',
    run: (galaxy, _value, { habitat, leaveThreshold }) => {
        const total = colonyLedger(galaxy, habitat).total;
        return colonyUnderMartialLaw(galaxy, habitat) && total < leaveThreshold ? leaveThreshold : total;
    },
});

// ---------------------------------------------------------------------------------------------------------------
// 2. Leads: counter-intelligence strength vs concealment, one yearly roll per hidden thing
// ---------------------------------------------------------------------------------------------------------------

function onCounterIntelligence(c: Character): boolean {
    if (!c.active || c.role !== CharacterRole.IntelligenceAgent) return false;
    const m = characterMission(c);
    return m !== null && m.type === IntelligenceMissionType.CounterIntelligence;
}

/**
 * An empire's counter-intelligence strength: its agents on CounterIntelligence (Empire.5.cs 5597
 * PerformIntelligenceMissions: CounterEspionageFactored × CalculateIntelligenceMissionBonusFromLeaderAndAmbassador ×
 * (1 + EspionageBonus)) — the best agent as the spymaster plus a quarter of the others. 0 = nobody watching. Pure.
 */
export function securityStrength(empire: Empire): number {
    const skills = getEmpireCharacters(empire)
        .filter(onCounterIntelligence)
        .map((a) => a.counterEspionageFactored)
        .sort((a, b) => b - a);
    if (skills.length === 0) return 0;
    let s = skills[0];
    for (let i = 1; i < skills.length; i++) s += skills[i] / 4;
    const bonus = calculateIntelligenceMissionBonusFromLeaderAndAmbassador(empire, IntelligenceMissionType.CounterIntelligence, null);
    return s * bonus * (1 + empire.espionageBonus);
}

/** securityStrength plus the scenario bonus slot (19n spymaster); what the detection roll uses. Pure. */
export function empireSecurityStrength(galaxy: Galaxy, empire: Empire): number {
    const s = securityStrength(empire);
    return securitySlots.strengthBonus !== null ? s + securitySlots.strengthBonus(galaxy, empire) : s;
}

/** Yearly detection chance: securityDetectPct × S / (S + concealment), capped at 95%. Pure. */
export function detectionChance(galaxy: Galaxy, strength: number, concealment: number): number {
    if (strength <= 0) return 0;
    return Math.min(0.95, (P.detectPct(galaxy) / 100) * (strength / (strength + Math.max(1, concealment))));
}

/** The empire that looks for `t` (its own empire; for a thing in nobody's territory the nearest colony's owner). */
export function detectingEmpire(galaxy: Galaxy, t: HiddenThing): Empire | null {
    if (t.empire !== null) return isNormal(galaxy, t.empire) ? t.empire : null;
    if (!isHabitat(t.target)) return null;
    const near = galaxy.findNearestColony(t.target.xpos, t.target.ypos, null, false);
    return near !== null && isNormal(galaxy, near.empire) ? near.empire : null;
}

/** Is `t` still hidden and alive (kind rules)? Colony / ship kinds follow their owner. */
function thingAlive(galaxy: Galaxy, t: HiddenThing): boolean {
    const site = t.site;
    if (site !== null && (site.state === 'dead' || site.state === 'turned')) return false;
    const target = t.target;
    if (target instanceof Character) {
        if (!target.active) return false;
        switch (t.kind) {
            case 'plot': {
                if (target.empire !== t.empire) return false;
                const e = peekPoliticsState(galaxy)?.chars.get(target);
                return e !== undefined && e.loyalty < 50;
            }
            case 'foreignAgent': {
                const m = characterMission(target);
                return m !== null && m.targetEmpire === t.empire && m.type !== IntelligenceMissionType.Undefined && m.type !== IntelligenceMissionType.CounterIntelligence;
            }
            case 'convert':
                t.empire = target.empire;
                return isConvert(galaxy, target);
            default:
                return target.empire === t.empire;
        }
    }
    if (target instanceof BuiltObject) return !target.hasBeenDestroyed && target.actualEmpire === t.empire;
    const h = target as Habitat;
    if (h.hasBeenDestroyed) return false;
    if (t.kind !== 'nest') {
        if (!isNormal(galaxy, h.empire)) return false;
        t.empire = h.empire;
    }
    return true;
}

function pruneThings(galaxy: Galaxy, st: SecurityState): void {
    for (const t of st.things) if (!t.retired && !thingAlive(galaxy, t)) retireHiddenThing(galaxy, t, 'gone');
    // Keep the registry bounded: drop retired things none of whose leads is still listed.
    st.things = st.things.filter((t) => !t.retired || st.leads.some((l) => l.thingId === t.id && galaxyStarDate(galaxy) - l.updated <= 5 * YEAR_LENGTH));
    st.leads = st.leads.filter((l) => !l.closed || galaxyStarDate(galaxy) - l.updated <= 5 * YEAR_LENGTH);
}

/**
 * Foreign agents on missions against an empire (the ported IntelligenceMission.TargetEmpire; any non-counter mission)
 * join the registry here: the ported mission assignment has no scenario hook, so the yearly sweep registers them.
 */
function syncForeignAgents(galaxy: Galaxy): void {
    const all = [...galaxy.empires, ...galaxy.pirateEmpires];
    for (const victim of galaxy.empires) {
        if (!isNormal(galaxy, victim)) continue;
        for (const e of all) {
            if (e === null || e === victim) continue;
            for (const a of getEmpireCharacters(e)) {
                if (!a.active || a.role !== CharacterRole.IntelligenceAgent) continue;
                const m = characterMission(a);
                if (m === null || m.targetEmpire !== victim || m.type === IntelligenceMissionType.Undefined || m.type === IntelligenceMissionType.CounterIntelligence) continue;
                registerHiddenThing(galaxy, { kind: 'foreignAgent', concealment: a.espionageFactored, empire: victim, target: a, package: 'base.espionage' });
            }
        }
    }
}

/** The display name of a lead's target. */
export function leadTargetName(lead: Lead): string {
    const t = lead.target as { name?: string };
    return t.name ?? '?';
}

function kindText(kind: string): string {
    return scenarioText(`Security Kind ${kind}`);
}

/** A lead changed level: messages, and a confirmed lead is handed back to the package (its knowledge, 19d1 exposure). */
function onLeadChanged(galaxy: Galaxy, lead: Lead, thing: HiddenThing): void {
    if (lead.level === 'confirmed') {
        if (thing.site !== null) revealTo(galaxy, thing.site as unknown as ThreatSite, lead.empire, KNOWLEDGE_CONFIRMED);
        if (thing.kind === 'plot' && thing.target instanceof Character && scenarioFlag(galaxy, POLITICS_FLAG)) politicsState(galaxy).exposed.add(thing.target);
    }
    if (lead.empire !== galaxy.playerEmpire) return;
    const tag = lead.level === 'confirmed' ? 'Security Lead Confirmed' : lead.level === 'suspected' ? 'Security Lead Suspected' : 'Security Lead Cleared';
    scenarioMessage(galaxy, lead.empire, scenarioText(`${tag} Title`), scenarioText(tag, kindText(lead.kind), leadTargetName(lead)), {
        type: lead.level === 'cleared' ? EmpireMessageType.GeneralNeutralEvent : EmpireMessageType.GeneralWarning,
        subject: lead.target,
    });
}

/** ONE detection roll per live hidden thing whose empire has counter-intelligence (array order). */
export function detectionRolls(galaxy: Galaxy): void {
    const st = securityState(galaxy);
    for (const t of [...st.things]) {
        if (t.retired) continue;
        const e = detectingEmpire(galaxy, t);
        if (e === null) continue;
        const lead = openLead(st, t, e);
        if (lead !== undefined && lead.level === 'confirmed') continue;
        let p = detectionChance(galaxy, empireSecurityStrength(galaxy, e), t.concealment);
        if (p <= 0) continue;
        if (lead !== undefined && lead.level === 'suspected') p *= 0.5;
        // RND(19m): detection roll
        if (!(galaxy.rnd.nextDouble() < p)) continue;
        const level = lead !== undefined && lead.level === 'suspected' ? 'confirmed' : 'suspected';
        const changed = setLeadLevel(galaxy, t, e, level, 'roll');
        if (changed !== null) onLeadChanged(galaxy, changed, t);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Investigations ("Investigate lead" intel mission) and actions
// ---------------------------------------------------------------------------------------------------------------

export function findLead(galaxy: Galaxy, id: number): Lead | null {
    return peekSecurityState(galaxy)?.leads.find((l) => l.id === id) ?? null;
}

function thingOf(galaxy: Galaxy, lead: Lead): HiddenThing | null {
    return peekSecurityState(galaxy)?.things.find((t) => t.id === lead.thingId) ?? null;
}

export function investigatingAgent(galaxy: Galaxy, lead: Lead): Character | null {
    return peekSecurityState(galaxy)?.investigations.find((i) => i.leadId === lead.id)?.agent ?? null;
}

/** Agents of `empire` free to investigate: active, on counter-intelligence or idle, not already investigating. Pure. */
export function availableInvestigators(galaxy: Galaxy, empire: Empire): Character[] {
    const busy = new Set(peekSecurityState(galaxy)?.investigations.map((i) => i.agent) ?? []);
    return getEmpireCharacters(empire).filter((c) => {
        if (!c.active || c.role !== CharacterRole.IntelligenceAgent || busy.has(c) || c.empire !== empire) return false;
        const m = characterMission(c);
        return m === null || m.type === IntelligenceMissionType.Undefined || m.type === IntelligenceMissionType.CounterIntelligence;
    });
}

/** Why `agent` cannot investigate `lead` (null: it can). Pure. */
export function investigateBlocked(galaxy: Galaxy, empire: Empire, lead: Lead | null, agent: Character | null): string | null {
    if (!securityOn(galaxy)) return 'Internal security is off';
    if (lead === null || lead.closed || lead.empire !== empire) return 'No such lead';
    if (lead.level === 'confirmed') return 'Already confirmed';
    if (investigatingAgent(galaxy, lead) !== null) return 'Already under investigation';
    if (agent === null) return 'No agent';
    if (!availableInvestigators(galaxy, empire).includes(agent)) return 'Agent unavailable';
    return null;
}

/** The investigator's skill: CounterEspionageFactored × the leader / ambassador counter-intelligence bonus. */
export function investigatorSkill(agent: Character, empire: Empire): number {
    return agent.counterEspionageFactored * calculateIntelligenceMissionBonusFromLeaderAndAmbassador(empire, IntelligenceMissionType.CounterIntelligence, null);
}

/** Chance an investigation confirms: 1.5 × skill / (skill + concealment), 5–95%. Pure. */
export function investigationChance(skill: number, concealment: number): number {
    return Math.max(0.05, Math.min(0.95, (1.5 * skill) / (skill + Math.max(1, concealment))));
}

/** Assigns `agent` to `lead`: the agent stays on (or is put on) counter-intelligence while the investigation runs. */
export function startInvestigation(galaxy: Galaxy, empire: Empire, leadId: number, agent: Character): { ok: boolean; reason?: string } {
    const lead = findLead(galaxy, leadId);
    const why = investigateBlocked(galaxy, empire, lead, agent);
    if (why !== null) return { ok: false, reason: why };
    const m = characterMission(agent);
    if (m === null || m.type !== IntelligenceMissionType.CounterIntelligence) agent.mission = newCounterIntelligenceMission(galaxy, empire, agent);
    const now = galaxyStarDate(galaxy);
    securityState(galaxy).investigations.push({ leadId, agent, empire, start: now, due: now + P.investigateDays(galaxy) * GAME_DAY_LENGTH });
    return { ok: true };
}

/** Periodic: resolves the investigations that are due (one roll each); cancels those whose agent left the post. */
export function reviewInvestigations(galaxy: Galaxy): void {
    const st = securityState(galaxy);
    const now = galaxyStarDate(galaxy);
    for (const inv of [...st.investigations]) {
        const lead = st.leads.find((l) => l.id === inv.leadId);
        const m = characterMission(inv.agent);
        const cancelled = lead === undefined || lead.closed || lead.level === 'confirmed' || !inv.agent.active || inv.agent.empire !== inv.empire || m === null || m.type !== IntelligenceMissionType.CounterIntelligence;
        if (cancelled) {
            st.investigations.splice(st.investigations.indexOf(inv), 1);
            continue;
        }
        if (now < inv.due) continue;
        st.investigations.splice(st.investigations.indexOf(inv), 1);
        const thing = thingOf(galaxy, lead);
        if (thing === null || thing.retired) continue;
        const chance = investigationChance(investigatorSkill(inv.agent, inv.empire), thing.concealment);
        // RND(19m): investigation
        const confirmed = galaxy.rnd.nextDouble() < chance;
        const changed = setLeadLevel(galaxy, thing, inv.empire, confirmed ? 'confirmed' : 'cleared', 'investigation');
        if (changed !== null) onLeadChanged(galaxy, changed, thing);
        if (!confirmed) emboldened(galaxy, thing);
    }
}

/** §4: a failed investigation emboldens the plotter (+ambition). */
function emboldened(galaxy: Galaxy, thing: HiddenThing): void {
    const c = thing.target;
    if (!(c instanceof Character) || !scenarioFlag(galaxy, POLITICS_FLAG) || !isNormal(galaxy, c.empire)) return;
    const e = politicsEntry(galaxy, c);
    e.ambition = Math.min(100, e.ambition + P.emboldenAmbition(galaxy));
    securityLog(galaxy, c.empire, `emboldened ${c.name} (+${P.emboldenAmbition(galaxy)} ambition)`);
}

export type SecurityActionName = 'arrest' | 'exile' | 'purge' | 'amnesty' | 'quarantine' | 'martialLaw' | 'recallFleet' | 'scrapShip';
export const SECURITY_ACTIONS: readonly SecurityActionName[] = ['arrest', 'exile', 'purge', 'amnesty', 'quarantine', 'martialLaw', 'recallFleet', 'scrapShip'];

function leadCharacter(lead: Lead): Character | null {
    return lead.target instanceof Character ? lead.target : null;
}

/** The colony a lead points at: its target colony, or the character's location colony. */
export function leadColony(lead: Lead): Habitat | null {
    const t = lead.target;
    if (t instanceof Character) {
        const loc = t.location;
        return loc !== null && isHabitat(loc) ? loc : null;
    }
    return t instanceof BuiltObject ? null : (t as Habitat);
}

function leadFleet(lead: Lead): ShipGroup | null {
    const t = lead.target;
    if (t instanceof BuiltObject) return (t.shipGroup as ShipGroup | null) ?? null;
    if (t instanceof Character && t.role === CharacterRole.FleetAdmiral) return t.determineFleet();
    return null;
}

/** Why `action` is unavailable on `lead` (null: available). Pure (UI + the AI + the executor). */
export function securityActionBlocked(galaxy: Galaxy, empire: Empire, action: SecurityActionName, lead: Lead | null): string | null {
    if (!securityOn(galaxy)) return 'Internal security is off';
    if (lead === null || lead.empire !== empire || lead.closed) return 'No such lead';
    if (lead.level !== 'confirmed') return 'Not confirmed';
    const c = leadCharacter(lead);
    const own = c !== null && c.empire === empire;
    const leader = c !== null && (c.role === CharacterRole.Leader || c.role === CharacterRole.PirateLeader);
    switch (action) {
        case 'arrest':
        case 'exile':
            return c === null ? 'Not a character' : leader ? 'Not the leader' : !c.active ? 'Gone' : null;
        case 'purge':
            return !own ? 'Not one of our characters' : leader ? 'Not the leader' : null;
        case 'amnesty':
            return lead.kind !== 'plot' || !own ? 'Only a plot' : null;
        case 'quarantine': {
            const h = leadColony(lead);
            if (h === null || h.empire !== empire) return 'No colony of ours';
            return colonyQuarantined(galaxy, h) ? 'Already quarantined' : null;
        }
        case 'martialLaw': {
            const h = leadColony(lead);
            if (h === null || h.empire !== empire) return 'No colony of ours';
            return colonyUnderMartialLaw(galaxy, h) ? 'Already under martial law' : null;
        }
        case 'recallFleet': {
            const g = leadFleet(lead);
            return g === null || g.empire !== empire || empire.capital === null ? 'No fleet of ours' : null;
        }
        case 'scrapShip': {
            const t = lead.target;
            return !(t instanceof BuiltObject) || t.actualEmpire !== empire || t.hasBeenDestroyed ? 'No ship of ours' : null;
        }
    }
}

function closeLead(galaxy: Galaxy, lead: Lead, outcome: string): void {
    const thing = thingOf(galaxy, lead);
    if (thing !== null) retireHiddenThing(galaxy, thing, outcome);
    lead.closed = true;
    lead.outcome = outcome;
}

function removeCharacter(galaxy: Galaxy, c: Character): void {
    characterSendDeathMessage(galaxy, c, CharacterDeathType.Dismissed);
    c.kill(galaxy);
}

/**
 * The player op `securityAction` (and the AI): runs `action` on a confirmed lead. 19d1's politicsAction does the
 * arrest / purge of one of our characters when internal politics is on. May draw only through the stock functions
 * (a fleet's Move mission).
 */
export function runSecurityAction(galaxy: Galaxy, empire: Empire, action: SecurityActionName, leadId: number): { ok: boolean; reason?: string } {
    const lead = findLead(galaxy, leadId);
    const why = securityActionBlocked(galaxy, empire, action, lead);
    if (why !== null || lead === null) return { ok: false, reason: why ?? 'No such lead' };
    const st = securityState(galaxy);
    const now = galaxyStarDate(galaxy);
    const c = leadCharacter(lead);
    const politics = scenarioFlag(galaxy, POLITICS_FLAG);
    switch (action) {
        case 'arrest': {
            if (c!.empire === empire && politics) {
                politicsState(galaxy).exposed.add(c!);
                const r = runPoliticsAction(galaxy, empire, 'arrest', c!);
                if (!r.ok) return r;
            } else {
                const m = characterMission(c!);
                if (m !== null && c!.empire !== null && c!.empire !== empire) cancelIntelligenceMission(c!.empire, m);
                removeCharacter(galaxy, c!);
            }
            closeLead(galaxy, lead, 'arrested');
            break;
        }
        case 'exile': {
            if (c!.empire === empire) {
                const target = defectionTarget(galaxy, c!, empire) ?? galaxy.empires.find((e) => e !== empire && isNormal(galaxy, e) && e.capital !== null) ?? null;
                if (target === null) removeCharacter(galaxy, c!);
                else {
                    c!.mission = null;
                    c!.defectToEmpire(target, target.capital);
                }
            } else {
                // A foreign agent is expelled: the mission ends and the agent goes home.
                const m = characterMission(c!);
                if (m !== null && c!.empire !== null) cancelIntelligenceMission(c!.empire, m);
                c!.mission = null;
                const home = c!.empire?.capital ?? null;
                if (home !== null) c!.transferToNewLocation(home, galaxy);
            }
            closeLead(galaxy, lead, 'exiled');
            break;
        }
        case 'purge': {
            if (politics) {
                const r = runPoliticsAction(galaxy, empire, 'purge', c!);
                if (!r.ok) return r;
            } else {
                removeCharacter(galaxy, c!);
                empire.leaderChangeInfluence = Math.min(empire.leaderChangeInfluence, -0.15);
            }
            st.purges.set(empire, now);
            closeLead(galaxy, lead, 'purged');
            break;
        }
        case 'amnesty': {
            if (politics) {
                const e = politicsEntry(galaxy, c!);
                e.loyalty = Math.min(100, e.loyalty + P.amnestyLoyalty(galaxy));
                politicsState(galaxy).exposed.delete(c!);
            }
            closeLead(galaxy, lead, 'amnesty');
            break;
        }
        case 'quarantine':
            st.quarantine.set(leadColony(lead)!, now + P.quarantineYears(galaxy) * YEAR_LENGTH);
            break;
        case 'martialLaw':
            st.martialLaw.set(leadColony(lead)!, now + P.martialLawYears(galaxy) * YEAR_LENGTH);
            break;
        case 'recallFleet': {
            const g = leadFleet(lead)!;
            const capital = empire.capital!;
            g.gatherPoint = capital;
            if (g.ships.length > 0) shipGroupAssignMission(galaxy, g, BuiltObjectMissionType.Move, capital, null, BuiltObjectMissionPriority.High, true);
            else if (lead.target instanceof BuiltObject) assignMission(galaxy, lead.target, BuiltObjectMissionType.Move, capital, null, BuiltObjectMissionPriority.High);
            break;
        }
        case 'scrapShip': {
            const bo = lead.target as BuiltObject;
            closeLead(galaxy, lead, 'scrapped');
            builtObjectCompleteTeardown(galaxy, bo);
            break;
        }
    }
    securityLog(galaxy, empire, `${action} on ${lead.kind} ${leadTargetName(lead)}`);
    return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------
// AI: the same loop by race caution / aggression (no Rnd)
// ---------------------------------------------------------------------------------------------------------------

/** The action an AI takes on a confirmed lead (null: none). Pure. */
export function aiSecurityChoice(galaxy: Galaxy, empire: Empire, lead: Lead): SecurityActionName | null {
    const race = empire.dominantRace;
    const caution = race?.caution ?? 100;
    const aggression = race?.aggression ?? 100;
    const pick = (list: SecurityActionName[]): SecurityActionName | null => list.find((a) => securityActionBlocked(galaxy, empire, a, lead) === null) ?? null;
    switch (lead.kind) {
        case 'plot': {
            const c = leadCharacter(lead);
            const ambition = c !== null ? (peekPoliticsState(galaxy)?.chars.get(c)?.ambition ?? 50) : 50;
            return aggression >= 115 ? pick(['purge', 'arrest']) : ambition >= 60 ? pick(['arrest']) : pick(['amnesty', 'arrest']);
        }
        case 'convert':
        case 'boughtGovernor':
            return aggression >= 115 ? pick(['purge', 'arrest']) : pick(['arrest']);
        case 'foreignAgent':
            return aggression >= 100 ? pick(['arrest', 'exile']) : pick(['exile', 'arrest']);
        case 'sleeper':
            return caution >= 100 ? pick(['scrapShip', 'recallFleet']) : pick(['recallFleet', 'scrapShip']);
        case 'hiveNode':
        case 'farm':
            return caution >= 100 ? pick(['martialLaw', 'quarantine']) : pick(['quarantine', 'martialLaw']);
        default:
            return null;
    }
}

/** One AI empire's yearly security step: investigate suspected leads (up to 1–3 by caution), act on confirmed ones. */
export function aiSecurity(galaxy: Galaxy, empire: Empire): void {
    const st = securityState(galaxy);
    const caution = empire.dominantRace?.caution ?? 100;
    const maxInvestigations = caution >= 110 ? 3 : caution >= 90 ? 2 : 1;
    const mine = st.leads.filter((l) => l.empire === empire && !l.closed).sort((a, b) => a.id - b.id);
    for (const lead of mine) {
        if (lead.level !== 'suspected') continue;
        if (st.investigations.filter((i) => i.empire === empire).length >= maxInvestigations) break;
        const agent = availableInvestigators(galaxy, empire).find((a) => onCounterIntelligence(a)) ?? null;
        if (agent === null) break;
        startInvestigation(galaxy, empire, lead.id, agent);
    }
    for (const lead of mine) {
        if (lead.closed || lead.level !== 'confirmed') continue;
        const action = aiSecurityChoice(galaxy, empire, lead);
        if (action !== null) runSecurityAction(galaxy, empire, action, lead.id);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Chain reactions
// ---------------------------------------------------------------------------------------------------------------

/** A converted governor loses loyalty every year (19d1 cause "Cult"; the ledger's loyalty term follows). */
export function cultLoyaltyChain(galaxy: Galaxy): void {
    if (!scenarioFlag(galaxy, POLITICS_FLAG) || !scenarioFlag(galaxy, CULT_FLAG)) return;
    const cst = peekCultState(galaxy);
    if (cst === null) return;
    const amount = P.cultLoyalty(galaxy);
    for (const r of cst.converted) {
        const c = r.character;
        if (!c.active || governedColony(c) === null || !isNormal(galaxy, c.empire)) continue;
        const e = politicsEntry(galaxy, c);
        e.loyalty = Math.max(0, e.loyalty - amount);
        e.lastCauses.push({ cause: 'Cult', amount: -amount });
    }
}

/** 19d1 attemptCoup success hook: a converted plotter founds the theocracy through the Cult's rise path (cultTrigger). */
export function cultistCoup(galaxy: Galaxy, empire: Empire, c: Character): boolean {
    if (!securityOn(galaxy) || !isConvert(galaxy, c)) return false;
    const cst = peekCultState(galaxy)!;
    const capital = empire.capital;
    if (capital === null) return false;
    const held = cultHeldColonies(galaxy, cst).filter((h) => h.empire === empire && h !== capital);
    if (!cultTrigger(galaxy, cst, empire, [capital, ...held])) return false;
    const faction = cst.faction;
    if (faction !== null) {
        c.mission = null;
        c.defectToEmpire(faction, capital);
    }
    securityLog(galaxy, empire, `cultist coup by ${c.name}: the theocracy rises at ${capital.name}`);
    scenarioMessage(galaxy, empire, scenarioText('Security Cult Coup Title'), scenarioText('Security Cult Coup', c.name, capital.name), { type: EmpireMessageType.GeneralBadEvent, subject: capital });
    return true;
}

/** 19d4 refugee arrival: refugees from a cult-held colony carry the creed to the destination's governor (one roll). */
export function refugeesCarryCreed(galaxy: Galaxy, origin: Habitat, destination: Habitat): void {
    if (!securityOn(galaxy) || !scenarioFlag(galaxy, CULT_FLAG)) return;
    const cst = peekCultState(galaxy);
    if (cst === null || cst.converted.length === 0) return;
    const originHeld = cst.converted.some((r) => r.character.active && r.character.location === origin);
    if (!originHeld) return;
    const gov = colonyGovernor(destination);
    if (gov === null || isConvert(galaxy, gov)) return;
    // RND(19m): refugee creed
    if (!(galaxy.rnd.nextDouble() * 100 < P.refugeeCreedPct(galaxy))) return;
    convert(galaxy, cst, gov);
    securityLog(galaxy, destination.empire, `refugees from ${origin.name} carried the creed to ${gov.name} at ${destination.name}`);
}

/** 19d1 plot rumour hook: the plot joins the registry; the ported exposure roll's success is mirrored as confirmed. */
export function plotRumourJoined(galaxy: Galaxy, empire: Empire, c: Character, exposed: boolean): void {
    if (!securityOn(galaxy)) return;
    const e = peekPoliticsState(galaxy)?.chars.get(c);
    const thing = registerHiddenThing(galaxy, { kind: 'plot', concealment: 30 + (e?.ambition ?? 50) / 5, empire, target: c, package: '19d1.politics' });
    if (thing !== null && exposed) mirrorPackageDiscovery(galaxy, { target: c, kind: 'plot' }, empire, 3);
}

politicsHooks.coupSucceeded = (galaxy, empire, c) => cultistCoup(galaxy, empire, c);
politicsHooks.secessionBlocked = (galaxy, colony) => colonyUnderMartialLaw(galaxy, colony);
politicsHooks.plotRumour = (galaxy, empire, c, exposed) => plotRumourJoined(galaxy, empire, c, exposed);
securitySlots.refugeesArrived = (galaxy, origin, destination) => refugeesCarryCreed(galaxy, origin, destination);

// ---------------------------------------------------------------------------------------------------------------
// Yearly / periodic handlers
// ---------------------------------------------------------------------------------------------------------------

function expireMeasures(galaxy: Galaxy, st: SecurityState): void {
    const now = galaxyStarDate(galaxy);
    for (const [h, until] of [...st.quarantine]) if (now >= until || !isNormal(galaxy, h.empire)) st.quarantine.delete(h);
    for (const [h, until] of [...st.martialLaw]) if (now >= until || !isNormal(galaxy, h.empire)) st.martialLaw.delete(h);
}

/** The yearly handler (order 50: after 19d1 politics and 19d2 crises). */
export function securityYearly(galaxy: Galaxy, year: number): void {
    void year;
    const st = securityState(galaxy);
    pruneThings(galaxy, st);
    syncForeignAgents(galaxy);
    expireMeasures(galaxy, st);
    cultLoyaltyChain(galaxy);
    detectionRolls(galaxy);
    for (const e of galaxy.empires.filter((x) => isNormal(galaxy, x))) {
        if (e !== galaxy.playerEmpire) aiSecurity(galaxy, e);
    }
}

export const SECURITY_HANDLER_IDS = ['security.yearly', 'security.investigations'] as const;

registerScenarioYearly({ id: 'security.yearly', flag: SECURITY_FLAG, order: 50, run: securityYearly });
registerScenarioPeriodic({ id: 'security.investigations', flag: SECURITY_FLAG, periodDays: 10, run: (g) => reviewInvestigations(g) });
