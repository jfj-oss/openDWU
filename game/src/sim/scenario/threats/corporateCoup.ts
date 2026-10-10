// 19f #10 Corporate Coup (tasks/19f-hidden-threats.md §10, threat framework framework.ts). Not a port: new scenario
// behaviour composed of ported functions (each composed step cites its C# analogue). Registered from
// scenario/packages.ts; every handler is gated by the `threatCorporateCoup` flag, so with the flag off (or no
// scenario) nothing here runs and nothing draws.
//
// 19c dependency (TODO(port) 19c): the real threat is "a chartered company (19c) buys its holder's governors, then
// breaks the charter and declares independence" (tasks/19c-chartered-companies.md). 19c (the company sub-empire, the
// charter relation, tariffs, the break-away path) is NOT implemented on this branch (verified: no
// scenarios/rimTrade/, no charteredCompanies/charterFee symbol anywhere in src/ or scenarios/). This module is
// therefore built directly against the threat framework, with one clearly-named hook standing in for 19c's charter
// creation: `registerSubjectCompany(galaxy, company, holder, charterStarDate?)` — 19c's charter-creation code should
// call this the moment a charter is granted (in place of whatever internal bookkeeping this stub needs); until then,
// tests register a company by building one with createEmpireMidGame({ adoptOnly: true, ... }) and calling the hook
// directly (test/scenarioThreatCorporateCoup.test.ts). "Company reach" (§10 "governors ... within the company's
// reach") has no geography without 19c's charter, so this module reads it as "every ColonyGovernor of the holder"
// pending that wiring — TODO(port) 19c: narrow to the charter's territory once it exists.
//
// Rnd (§0.4): draws only in coupBribeYearly (the bribe roll) and coupDirtyPeriodic's intel-mission draws (through
// completeIntelligenceMission). coupTrigger, discovery and the AI rule are deterministic. Fixed iteration orders:
// state.companies in registration order, holder.colonies order for governors, a colony's characters in
// stellarObjectCharacters order.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import { Character, CharacterRole, CharacterTraitType, generateNewCharacter, getEmpireCharacters, stellarObjectCharacters } from '../../characters';
import { IntelligenceMissionType, completeIntelligenceMission, newIntelligenceMissionAgainstHabitat } from '../../espionage';
import { YEAR_LENGTH } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { registerScenarioPeriodic, registerScenarioYearly } from '../hooks';
import { scenarioParam } from '../state';
import { scenarioText } from '../messages';
import { registerHiddenThing, retireHiddenTarget } from '../security/registry';
import { GameEndOutcome } from '../../victory';
import {
    KNOWLEDGE_CONFIRMED,
    arcMessage,
    arcNews,
    invadeFromInside,
    knowledgeLevel,
    lockWar,
    pastThreatMinYear,
    peekThreatState,
    registerThreatExistence,
    revealTo,
    teardownIfDead,
    threatExists,
    threatGameEnd,
    threatState,
    type SentStages,
    type ThreatKnowledge,
} from './framework';
import { isHumanEmpire } from '../../humanEmpires';

export const CORPORATE_COUP_KEY = 'corporateCoup';
export const CORPORATE_COUP_FLAG = 'threatCorporateCoup';
const TAG = 'Coup';
const PERIOD_DAYS = 30;
const AGENT_PERIODS = 12; // ~yearly dirty-methods roll
/** Game-end codes (19f table). */
export const CORPORATE_COUP_CODE_DEFEAT = 1920;
export const CORPORATE_COUP_CODE_CONTAINED = 2020;

export interface CorporateCoupCompany {
    empire: Empire;
    holder: Empire;
    charterStarDate: number;
    bought: Character[];
    triggered: boolean;
    knowledge: ThreatKnowledge[];
    periods: number;
}

export interface CorporateCoupState {
    companies: CorporateCoupCompany[];
    sentStages: SentStages;
}

function newState(): CorporateCoupState {
    return { companies: [], sentStages: {} };
}

export function corporateCoupState(galaxy: Galaxy): CorporateCoupState {
    return threatState(galaxy, CORPORATE_COUP_KEY, newState);
}
export function peekCorporateCoupState(galaxy: Galaxy): CorporateCoupState | null {
    return peekThreatState<CorporateCoupState>(galaxy, CORPORATE_COUP_KEY);
}

/**
 * The clearly-named hook a subject company is registered through (see the file doc comment): 19c's charter-creation
 * code is meant to call this once a company charter exists; until 19c lands, tests call it directly after building
 * `company` with createEmpireMidGame. No-op if `company` is already registered. No Rnd.
 */
export function registerSubjectCompany(galaxy: Galaxy, company: Empire, holder: Empire, charterStarDate?: number): void {
    const st = corporateCoupState(galaxy);
    if (st.companies.some((c) => c.empire === company)) return;
    st.companies.push({ empire: company, holder, charterStarDate: charterStarDate ?? galaxyStarDate(galaxy), bought: [], triggered: false, knowledge: [], periods: 0 });
}

function p(galaxy: Galaxy, name: string, fallback: number): number {
    return scenarioParam(galaxy, name, fallback);
}
const P = {
    /** Per-mille yearly bribe chance per governor (the manifest's "coupBribePct" is read as per-mille, as darkFarms's spawn chance is). */
    bribePerMille: (g: Galaxy) => p(g, 'coupBribePct', 10),
    governors: (g: Galaxy) => Math.trunc(p(g, 'coupGovernors', 3)),
    minYears: (g: Galaxy) => p(g, 'coupMinYears', 10),
    defeatPopulationPct: (g: Galaxy) => p(g, 'coupDefeatPopulationPct', 40),
};

function threatsGameEndOn(galaxy: Galaxy): boolean {
    return galaxy.scenario !== null && galaxy.scenario.flags['threatsGameEnd'] !== false;
}

// ---------------------------------------------------------------------------------------------------------------
// Bribery (yearly)
// ---------------------------------------------------------------------------------------------------------------

/** ColonyGovernor characters at the holder's colonies (holder.colonies order), pending 19c's charter reach. */
function holderGovernors(holder: Empire): Character[] {
    const out: Character[] = [];
    for (const colony of holder.colonies) {
        for (const c of stellarObjectCharacters(colony) ?? []) if (c.role === CharacterRole.ColonyGovernor && c.active) out.push(c);
    }
    return out;
}

function bribeMultiplier(c: Character): number {
    if (c.traits.includes(CharacterTraitType.Patriot)) return 0;
    if (c.traits.includes(CharacterTraitType.Corrupt)) return 2;
    if (c.traits.includes(CharacterTraitType.Lawful)) return 0.25;
    return 1;
}

export function coupBribeYearly(galaxy: Galaxy): void {
    const st = corporateCoupState(galaxy);
    for (const company of st.companies) {
        if (company.triggered || !company.empire.active || !company.holder.active) continue;
        const pct = P.bribePerMille(galaxy);
        for (const gov of holderGovernors(company.holder)) {
            if (company.bought.includes(gov)) continue;
            const mult = bribeMultiplier(gov);
            if (mult <= 0) continue;
            if (galaxy.rnd.next(0, 1000) < pct * mult) {
                company.bought.push(gov);
                // 19m (flag-gated): the bought governor hides in the holder; the company record carries the knowledge.
                registerHiddenThing(galaxy, { kind: 'boughtGovernor', concealment: 55, empire: company.holder, target: gov, package: '19f.corporateCoup', site: company });
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------------------------------------------

export function coupTrigger(galaxy: Galaxy, company: CorporateCoupCompany): boolean {
    if (company.triggered) return false;
    if (company.bought.length < P.governors(galaxy)) return false;
    if (galaxyStarDate(galaxy) - company.charterStarDate < P.minYears(galaxy) * YEAR_LENGTH) return false;
    company.triggered = true;
    lockWar(galaxy, company.empire, company.holder);
    for (const gov of company.bought) {
        const colony = gov.location as Habitat | null;
        if (colony === null || colony.empire !== company.holder || colony.troops === null) continue;
        const half = colony.troops.items.slice(0, Math.ceil(colony.troops.count / 2));
        for (const t of half) colony.troops.remove(t);
        invadeFromInside(galaxy, colony, company.empire, half);
    }
    arcMessage(galaxy, sharedSentStages(galaxy), [company.holder], { prefix: TAG, stage: 'Trigger', onceKey: `Trigger:${company.empire.empireId}`, args: [company.empire.name], subject: null });
    arcNews(galaxy, sharedSentStages(galaxy), { prefix: TAG, stage: 'Trigger', onceKey: `Trigger News:${company.empire.empireId}`, textTag: `${TAG} Trigger News`, args: [company.empire.name] });
    return true;
}

/** Every company shares the module's SentStages bag (arc onceKeys are namespaced by company empireId). */
function sharedSentStages(galaxy: Galaxy): SentStages {
    return corporateCoupState(galaxy).sentStages;
}

// ---------------------------------------------------------------------------------------------------------------
// Dirty: intel missions against the holder before the coup (reuses the Exchange pattern: a synthetic
// IntelligenceMission through the same stock completeIntelligenceMission branches, espionage.ts 1596).
// ---------------------------------------------------------------------------------------------------------------

function coupDirty(galaxy: Galaxy, company: CorporateCoupCompany): void {
    if (company.triggered || company.holder.colonies.length === 0) return;
    const colony = company.holder.colonies[galaxy.rnd.next(0, company.holder.colonies.length)];
    // §10 "uses the holder's own intel against it (company agents run StealTechData / SabotageConstruction)": the
    // habitat-targeted branch (SabotageConstruction) is reused through the exact stock outcome, as Exchange does.
    const mission = newIntelligenceMissionAgainstHabitat(null, null, IntelligenceMissionType.SabotageConstruction, galaxyStarDate(galaxy), colony);
    completeIntelligenceMission(galaxy, company.empire, mission);
}

// ---------------------------------------------------------------------------------------------------------------
// Discovery / AI
// ---------------------------------------------------------------------------------------------------------------

function holderWatchesCounterIntelligence(holder: Empire): boolean {
    return getEmpireCharacters(holder).some((c) => c.role === CharacterRole.IntelligenceAgent && c.active);
}

function coupDiscovery(galaxy: Galaxy, company: CorporateCoupCompany): void {
    if (company.bought.length === 0) return;
    if (knowledgeLevel({ knowledge: company.knowledge }, company.holder) >= KNOWLEDGE_CONFIRMED) return;
    if (!holderWatchesCounterIntelligence(company.holder)) return;
    if (revealTo(galaxy, { knowledge: company.knowledge }, company.holder, KNOWLEDGE_CONFIRMED)) {
        arcMessage(galaxy, sharedSentStages(galaxy), [company.holder], { prefix: TAG, stage: 'Bought', onceKey: `Bought:${company.empire.empireId}`, args: [company.empire.name] });
    }
}

/** §10 AI: a holder with >= 2 confirmed bought governors replaces them within one period. */
function coupAiReplace(galaxy: Galaxy, company: CorporateCoupCompany): void {
    if (isHumanEmpire(galaxy, company.holder)) return;
    if (knowledgeLevel({ knowledge: company.knowledge }, company.holder) < KNOWLEDGE_CONFIRMED) return;
    if (company.bought.length < 2) return;
    for (const gov of [...company.bought]) {
        const colony = gov.location as Habitat | null;
        gov.active = false;
        if (colony !== null) generateNewCharacter(galaxy, company.holder, CharacterRole.ColonyGovernor, colony);
        company.bought.splice(company.bought.indexOf(gov), 1);
        retireHiddenTarget(galaxy, 'boughtGovernor', gov, 'replaced'); // 19m (flag-gated)
    }
}

// ---------------------------------------------------------------------------------------------------------------
// End
// ---------------------------------------------------------------------------------------------------------------

/** The company's population share of (company + holder) — the pairwise defeat condition (§10 has no galaxy-wide majority). */
function companySharePct(company: CorporateCoupCompany): number {
    let mine = 0;
    let theirs = 0;
    for (const c of company.empire.colonies) mine += c.population.totalAmount;
    for (const c of company.holder.colonies) theirs += c.population.totalAmount;
    const total = mine + theirs;
    return total > 0 ? (100 * mine) / total : 0;
}

function coupEndCheck(galaxy: Galaxy, st: CorporateCoupState, company: CorporateCoupCompany): void {
    if (!company.triggered) return;
    if (company.empire.active && companySharePct(company) >= P.defeatPopulationPct(galaxy)) {
        arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Defeat', onceKey: `Defeat:${company.empire.empireId}`, args: [Math.round(companySharePct(company))] });
        if (threatsGameEndOn(galaxy)) threatGameEnd(galaxy, company.empire, GameEndOutcome.Defeat, scenarioText(`${TAG} Defeat Title`), CORPORATE_COUP_CODE_DEFEAT);
        return;
    }
    if (teardownIfDead(galaxy, company.empire)) {
        arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Contained', onceKey: `Contained:${company.empire.empireId}` });
        if (threatsGameEndOn(galaxy)) threatGameEnd(galaxy, company.holder, GameEndOutcome.Victory, scenarioText(`${TAG} Victory Title`), CORPORATE_COUP_CODE_CONTAINED);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Yearly / periodic
// ---------------------------------------------------------------------------------------------------------------

export function corporateCoupYearly(galaxy: Galaxy): void {
    if (!threatExists(galaxy, CORPORATE_COUP_KEY)) return; // §0 rarity: not this game — no state, no draws.
    coupBribeYearly(galaxy);
}

export function corporateCoupPeriodic(galaxy: Galaxy): void {
    if (!threatExists(galaxy, CORPORATE_COUP_KEY)) return; // §0 rarity: not this game — no state, no draws.
    const st = peekCorporateCoupState(galaxy);
    if (st === null) return;
    for (const company of st.companies) {
        company.periods++;
        // §0 timing: the trigger (the declaration) waits for the floor; bribery bookkeeping (coupBribeYearly, above)
        // may run before it, as Hive's absorption counting does.
        if (!company.triggered && pastThreatMinYear(galaxy, CORPORATE_COUP_KEY)) coupTrigger(galaxy, company);
        if (!company.triggered && company.periods % AGENT_PERIODS === 0) coupDirty(galaxy, company);
        coupDiscovery(galaxy, company);
        coupAiReplace(galaxy, company);
        coupEndCheck(galaxy, st, company);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

export const CORPORATE_COUP_HANDLER_IDS = ['corporateCoup.yearly', 'corporateCoup.periodic'] as const;

export function registerCorporateCoup(): void {
    registerThreatExistence(CORPORATE_COUP_KEY, CORPORATE_COUP_FLAG);
    registerScenarioYearly({ id: 'corporateCoup.yearly', flag: CORPORATE_COUP_FLAG, order: 10, run: corporateCoupYearly });
    registerScenarioPeriodic({ id: 'corporateCoup.periodic', flag: CORPORATE_COUP_FLAG, periodDays: PERIOD_DAYS, order: 10, run: corporateCoupPeriodic });
}

registerCorporateCoup();
