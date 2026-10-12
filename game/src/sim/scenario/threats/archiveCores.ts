// Archive Cores (docs/NEW_THREATS.md §2). Not a port: new scenario behaviour composed of ported functions. Registered
// from scenario/packages.ts; every handler is gated by the `threatArchiveCores` flag, so with the flag off (or no
// scenario) nothing here runs and nothing draws.
//
// An Archive Core is lost technology: recovered from a generation ship (captured, or looted from its wreck), from the
// Probe Swarm's mothercore, or rarely from ruins (the ruinsInvestigated event, exploration.ts investigateRuins). On
// finding one the empire chooses (a scenario decision: the player in the message popup, a journaled command; the AI at
// once, by a fixed rule):
//   (a) study it: archiveStudySteps yearly boosts of archiveStudyPct % of a year of the empire's research each;
//   (b) seal it: after archiveSealYears one boost of archiveSealPct % (more than the sum of (a), later).
// A boost is research points poured into the empire's current projects (the stock progress / breakthrough path of
// performResearchProjects, researchTick.ts 1438, without its research events).
//
// Rnd: grants draw nothing of their own. The ruin roll uses its own seeded Random (never galaxy.rnd), keyed on the
// galaxy seed, the habitat and the empire, so it is deterministic and leaves the faithful draw stream untouched.
// Breakthroughs may draw inside the stock functions (doResearchBreakthrough, selectNextResearchProject).

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import type { TechNode } from '../../researchSystem';
import { IndustryType } from '../../types';
import { EmpireMessageType } from '../../messages';
import { Random } from '../../random';
import { YEAR_LENGTH } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { annualResearchPotential, doResearchBreakthrough, selectNextResearchProject } from '../../researchTick';
import { DiplomaticRelationType } from '../../diplomacy';
import { registerScenarioEvent, registerScenarioPeriodic } from '../hooks';
import { registerScenarioDecision, raiseScenarioDecision, type ScenarioDecision } from '../decisions';
import { scenarioMessage, scenarioText } from '../messages';
import { scenarioFlag, scenarioParam } from '../state';
import { isHumanEmpire } from '../../humanEmpires';
import { peekThreatState, threatState } from './framework';

export const ARCHIVE_CORES_KEY = 'archiveCores';
export const ARCHIVE_CORES_FLAG = 'threatArchiveCores';
const TAG = 'ArchiveCore';
const DECISION_KIND = 'archiveCore.choice';
const PERIOD_DAYS = 30;

export type ArchiveCoreSource = 'worldShip' | 'mothercore' | 'ruins';

export interface ArchiveCore {
    id: number;
    empire: Empire;
    source: ArchiveCoreSource;
    /** Where it was found (display only). */
    where: string;
    foundDate: number;
    choice: 'study' | 'seal' | null;
    /** Star date of the next boost. */
    nextDate: number;
    /** Boosts granted so far. */
    steps: number;
    /** Research points granted so far. */
    granted: number;
    done: boolean;
}

export interface ArchiveCoresState {
    nextId: number;
    cores: ArchiveCore[];
    /** Ruins habitats already rolled (habitat index): one roll per ruin. */
    ruinsRolled: number[];
}

function newState(): ArchiveCoresState {
    return { nextId: 1, cores: [], ruinsRolled: [] };
}

export function archiveCoresState(galaxy: Galaxy): ArchiveCoresState {
    return threatState(galaxy, ARCHIVE_CORES_KEY, newState);
}

export function peekArchiveCoresState(galaxy: Galaxy): ArchiveCoresState | null {
    return peekThreatState<ArchiveCoresState>(galaxy, ARCHIVE_CORES_KEY);
}

export function archiveCoresOn(galaxy: Galaxy): boolean {
    return galaxy.scenario !== null && scenarioFlag(galaxy, ARCHIVE_CORES_FLAG);
}

const P = {
    studySteps: (g: Galaxy) => Math.max(1, Math.trunc(scenarioParam(g, 'archiveStudySteps', 4))),
    studyPct: (g: Galaxy) => scenarioParam(g, 'archiveStudyPct', 16),
    sealYears: (g: Galaxy) => scenarioParam(g, 'archiveSealYears', 5),
    sealPct: (g: Galaxy) => scenarioParam(g, 'archiveSealPct', 90),
    minPoints: (g: Galaxy) => scenarioParam(g, 'archiveMinPoints', 15000),
    ruinsPerMille: (g: Galaxy) => scenarioParam(g, 'archiveRuinsChancePerMille', 40),
};

// ---------------------------------------------------------------------------------------------------------------
// Research grant
// ---------------------------------------------------------------------------------------------------------------

function queueOf(empire: Empire, industry: IndustryType): TechNode[] | null {
    const r = empire.research;
    return industry === IndustryType.Energy ? r.researchQueueEnergy : industry === IndustryType.HighTech ? r.researchQueueHighTech : r.researchQueueWeapons;
}

/**
 * Pours `points` of research into `empire`'s current projects, a third per industry (Energy, High Tech, Weapons), as
 * performResearchProjects does with a year's output (researchTick.ts 1438: progress, breakthrough, next project),
 * without research events. Returns the points actually used (0 when every queue is empty).
 */
export function grantResearchPoints(galaxy: Galaxy, empire: Empire, points: number): number {
    if (points <= 0 || empire.research == null) return 0;
    let used = 0;
    for (const industry of [IndustryType.Energy, IndustryType.HighTech, IndustryType.Weapon]) {
        const projects = queueOf(empire, industry);
        if (projects === null) continue;
        let left = points / 3;
        for (let guard = 0; guard < 20 && left > 0; guard++) {
            if (projects.length <= 0) selectNextResearchProject(galaxy, empire, industry, projects);
            if (projects.length <= 0) break;
            const node = projects[0];
            const need = node.cost - node.progress;
            const add = Math.min(left, Math.max(0, need));
            node.progress = Math.fround(node.progress + add);
            left -= add;
            used += add;
            if (node.progress >= node.cost) doResearchBreakthrough(galaxy, empire, node, true, true);
            else break;
        }
    }
    empire.research.update(empire.dominantRace);
    return used;
}

/** One boost of `pct` % of a year of the empire's research (at least archiveMinPoints). Pure. */
export function boostPoints(galaxy: Galaxy, empire: Empire, pct: number): number {
    return Math.max(P.minPoints(galaxy), Math.round((annualResearchPotential(empire) * pct) / 100));
}

// ---------------------------------------------------------------------------------------------------------------
// Finding a core
// ---------------------------------------------------------------------------------------------------------------

/**
 * `empire` recovers an Archive Core (from a world ship, the mothercore or ruins). Raises the study / seal choice:
 * the player answers it in the message popup (journaled answerScenarioDecision command), an AI at once. Returns the
 * core, or null when the add-on is off or the empire cannot hold one (independents, pirates, inactive).
 */
export function grantArchiveCore(galaxy: Galaxy, empire: Empire | null, source: ArchiveCoreSource, where: string): ArchiveCore | null {
    if (!archiveCoresOn(galaxy) || empire === null || !empire.active || empire === galaxy.independentEmpire || empire.pirateEmpireBaseHabitat !== null) return null;
    const st = archiveCoresState(galaxy);
    const core: ArchiveCore = { id: st.nextId++, empire, source, where, foundDate: galaxyStarDate(galaxy), choice: null, nextDate: 0, steps: 0, granted: 0, done: false };
    st.cores.push(core);
    const steps = P.studySteps(galaxy);
    const studyEach = boostPoints(galaxy, empire, P.studyPct(galaxy));
    const seal = boostPoints(galaxy, empire, P.sealPct(galaxy));
    raiseScenarioDecision(galaxy, empire, {
        kind: DECISION_KIND,
        title: scenarioText(`${TAG} Found Title`),
        text: scenarioText(`${TAG} Found ${source}`, where) + '\n\n' + scenarioText(`${TAG} Found Choice`, steps, fmt(studyEach), Math.round(P.sealYears(galaxy)), fmt(seal)),
        options: [
            { id: 'study', label: scenarioText(`${TAG} Option Study`, steps) },
            { id: 'seal', label: scenarioText(`${TAG} Option Seal`, Math.round(P.sealYears(galaxy))) },
        ],
        defaultOption: 'study',
        expiresDays: 120,
        context: { coreId: core.id },
    });
    return core;
}

function fmt(n: number): string {
    return Math.round(n).toLocaleString('en-US');
}

/** The AI's choice: an empire at war wants the help now (study); at peace it can wait for the bigger payoff (seal). Pure. */
export function aiArchiveChoice(empire: Empire): 'study' | 'seal' {
    for (let i = 0; i < empire.diplomaticRelations.count; i++) if (empire.diplomaticRelations.at(i).type === DiplomaticRelationType.War) return 'study';
    return 'seal';
}

function resolveChoice(galaxy: Galaxy, d: ScenarioDecision, optionId: string): void {
    const st = archiveCoresState(galaxy);
    const core = st.cores.find((c) => c.id === d.context.coreId);
    if (core === undefined || core.choice !== null) return;
    core.choice = optionId === 'seal' ? 'seal' : 'study';
    const now = galaxyStarDate(galaxy);
    core.nextDate = now + (core.choice === 'seal' ? P.sealYears(galaxy) : 1) * YEAR_LENGTH;
}

// ---------------------------------------------------------------------------------------------------------------
// Boosts (periodic)
// ---------------------------------------------------------------------------------------------------------------

export function archiveCoresPeriodic(galaxy: Galaxy): void {
    const st = peekArchiveCoresState(galaxy);
    if (st === null) return;
    const now = galaxyStarDate(galaxy);
    for (const core of st.cores) {
        if (core.done || core.choice === null || now < core.nextDate) continue;
        const e = core.empire;
        if (!e.active) {
            core.done = true;
            continue;
        }
        if (core.choice === 'study') {
            const pts = grantResearchPoints(galaxy, e, boostPoints(galaxy, e, P.studyPct(galaxy)));
            core.granted += pts;
            core.steps++;
            core.nextDate += YEAR_LENGTH;
            if (core.steps >= P.studySteps(galaxy)) core.done = true;
            if (isHumanEmpire(galaxy, e)) scenarioMessage(galaxy, e, scenarioText(`${TAG} Title`), scenarioText(`${TAG} Study Step`, core.steps, P.studySteps(galaxy), fmt(pts)), { type: EmpireMessageType.GeneralGoodEvent, popup: false });
        } else {
            const pts = grantResearchPoints(galaxy, e, boostPoints(galaxy, e, P.sealPct(galaxy)));
            core.granted += pts;
            core.steps = 1;
            core.done = true;
            if (isHumanEmpire(galaxy, e)) scenarioMessage(galaxy, e, scenarioText(`${TAG} Title`), scenarioText(`${TAG} Seal Opened`, fmt(pts)), { type: EmpireMessageType.GeneralGoodEvent, popup: false });
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Ruins: a rare find (own seeded roll, once per ruin)
// ---------------------------------------------------------------------------------------------------------------

function onRuinsInvestigated(galaxy: Galaxy, empire: Empire, habitat: Habitat): void {
    if (empire === galaxy.independentEmpire || empire.pirateEmpireBaseHabitat !== null) return;
    const idx = galaxy.habitats.indexOf(habitat);
    if (idx < 0) return;
    const st = archiveCoresState(galaxy);
    if (st.ruinsRolled.includes(idx)) return;
    st.ruinsRolled.push(idx);
    const rnd = new Random(((galaxy.randomSeed ^ 0x41524331 ^ (idx * 7919)) >>> 1) & 0x7fffffff);
    if (rnd.nextDouble() * 1000 < P.ruinsPerMille(galaxy)) grantArchiveCore(galaxy, empire, 'ruins', habitat.name);
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

export const ARCHIVE_CORES_HANDLER_IDS = ['archiveCores.periodic', 'archiveCores.ruins'] as const;

export function registerArchiveCores(): void {
    registerScenarioPeriodic({ id: 'archiveCores.periodic', flag: ARCHIVE_CORES_FLAG, periodDays: PERIOD_DAYS, order: 30, run: (g) => archiveCoresPeriodic(g) });
    registerScenarioEvent({ id: 'archiveCores.ruins', flag: ARCHIVE_CORES_FLAG, event: 'ruinsInvestigated', run: (g, e) => onRuinsInvestigated(g, e.empire, e.habitat) });
    registerScenarioDecision({
        id: 'archiveCores.decision',
        kind: DECISION_KIND,
        flag: ARCHIVE_CORES_FLAG,
        resolve: resolveChoice,
        aiChoose: (_g, d) => aiArchiveChoice(d.empire),
    });
}

registerArchiveCores();
