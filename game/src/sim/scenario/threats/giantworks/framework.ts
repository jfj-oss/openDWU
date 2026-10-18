// Giantworks: the independents' Great Work (docs: the design plan, sections 10-13). The framework: founders, the site, the
// Founders' Compact, convoys, the scaffold's five stages, hints and per-empire knowledge, the actions (Protect / Sabotage / Destroy /
// Seize), the Diet's motions, the AI, the shared benefit helper and the wonder registry. Not a port. Registered from
// scenario/packages.ts; every handler is gated by the `threatGiantworks` flag, so with the add-on off nothing here runs, draws or
// is saved. A wonder module (beacon.ts, casino.ts, ...) imports registerGreatWork and the helpers from THIS file.
//
// Files: types.ts (the contract) · registry.ts (kinds, lore) · state.ts (saved state, params) · founders.ts (seeding) ·
// lifecycle.ts (Compact, scaffold, convoys, stages) · knowledge.ts (hints, shortlists, Intelligence rows) · actions.ts (events,
// anger, crimes) · diet.ts (motions) · ai.ts (Smarter AI) · benefits.ts (who is paid).
//
// What a wonder module needs to know:
//   registerGreatWork({ id, flag, weight, hintTags, onComplete, ... }) at module load; GameText `Giantworks Kind <id>` (its name),
//   `Giantworks Hint <tag>` (every hint tag) and, optionally, `Giantworks Complete <id>` (the news line);
//   the site record passed to every hook is a GreatWorkRecord (a GreatWorkSite plus the framework's fields; use the helpers below);
//   benefits: greatWorkPay / greatWorkShares / greatWorkBeneficiary (the territory owner of the site, less the Compact's cut);
//   greatWorkTick: `periodic` runs every 10 game days after completion (throttle inside);
//   a wonder that turns hostile calls markGreatWorkHostile(site) (destroying or seizing it is then no crime) and, for a faction,
//   registerHostileWonderCrisis (the crisis interactions: opportunists, helpers).

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { BuiltObject } from '../../../builtObject';
import { BuiltObjectMissionType } from '../../../missions/mission';
import { registerScenarioGameStart, registerScenarioPeriodic, registerScenarioQuery, registerScenarioYearly } from '../../hooks';
import { enableThreat, registerThreatExistence, registerThreatSpawn, threatExists, unregisterThreatSpawn } from '../framework';
import { addCrisisEntry, registerCrisisHelpers, type CrisisEntry } from '../crisis';
import { angerYearly, greatWorkProtectors, protectStep, registerActionEvents, resolveBaseLoss } from './actions';
import { aiStep } from './ai';
import './diet';
import { kindTaken, seedGreatWorks, seedNow } from './founders';
import { startBuilding, stepWork } from './lifecycle';
import { greatWorkKinds, registerGreatWork as registerKind, unregisterGreatWork as unregisterKind } from './registry';
import { GW_FLAG, GW_KEY, gwState, greatWorks, isCompact, peekGwState, PERIOD_DAYS } from './state';
import type { GreatWorkKind, GreatWorkStage } from './types';

export type { GreatWorkKind, GreatWorkSite, GreatWorkStage } from './types';
export { greatWorkKind, greatWorkKinds, kindMenace, kindValue } from './registry';
export { greatWorkBeneficiary, greatWorkHolder, greatWorkIsHostile, greatWorkPay, greatWorkShares, greatWorkTerritoryOwner, internationalised, markGreatWorkHostile, type GreatWorkShare } from './benefits';
export { compactFaction, greatWorks, gwState, isCompact, ordinaryEmpires, peekGwState, workOfBase, type GreatWorkRecord } from './state';
export { demolitionAuthorised, greatWorkProtectors, LAW_DEMOLISH, LAW_INTERNATIONALISE, LAW_PROTECT } from './actions';
export { grantTrueHint, hintText, kindName, learnTag, shortlist, workLevel } from './knowledge';
export { addProgress, completeWork, destroyWork } from './lifecycle';
export { greatWorkCount, seedGreatWorks, seedNow } from './founders';
export { aiChoice, aiReview, aiStep } from './ai';
export { giantworksCompactSites, giantworksKnownSites, GW_COMPACT_KEY } from './knowledge';
export { GW_FLAG, GW_KEY };

/**
 * A wonder module registers its kind once at load. Also adds its Game Editor entry ("Great Work: <id>": start that wonder now).
 */
export function registerGreatWork(kind: GreatWorkKind): void {
    registerKind(kind);
    registerThreatSpawn({
        key: `${GW_KEY}:${kind.id}`,
        label: `Great Work: ${kind.id}`,
        group: 'galactic',
        addons: [GW_KEY],
        note: (g) => spawnNote(g) ?? (kindTaken(g, kind.id) ? 'Already under way (one per galaxy)' : null),
        spawn: (g) => spawnGreatWork(g, kind.id),
    });
}

/** Test hook: removes a registered wonder and its Game Editor entry. */
export function unregisterGreatWork(id: string): void {
    unregisterKind(id);
    unregisterThreatSpawn(`${GW_KEY}:${id}`);
}

/** A hostile wonder's crisis faction joins the crisis interactions; the empires that protected the work are counted its helpers. */
export function registerHostileWonderCrisis(entry: CrisisEntry): void {
    addCrisisEntry(entry);
    registerCrisisHelpers(entry.key, (g) => greatWorkProtectors(g));
}

// ---------------------------------------------------------------------------------------------------------------
// Art / UI hooks
// ---------------------------------------------------------------------------------------------------------------

export interface GreatWorkScaffold {
    base: BuiltObject;
    /** 0 Foundations .. 3 Fitting while building; 4 once finished. */
    stage: GreatWorkStage;
    /** The wonder's id, only once it is finished (the scaffold never gives the answer away). */
    wonder: string | null;
    complete: boolean;
}

/** The scaffolds / finished wonders on the map, for the renderer (src/render/threatArt.ts picks a frame by stage). Read only. */
export function greatWorkScaffolds(galaxy: Galaxy): GreatWorkScaffold[] {
    const out: GreatWorkScaffold[] = [];
    for (const w of greatWorks(galaxy)) {
        if ((w.phase !== 'building' && w.phase !== 'complete') || w.base === null || w.base.hasBeenDestroyed) continue;
        out.push({ base: w.base, stage: w.stage, wonder: w.phase === 'complete' ? w.wonder : null, complete: w.phase === 'complete' });
    }
    return out;
}

/** The stage of a scaffold / wonder base (null: `bo` is not one). Read only. */
export function greatWorkStageOf(galaxy: Galaxy, bo: BuiltObject): GreatWorkStage | null {
    for (const w of greatWorks(galaxy)) if (w.base === bo && (w.phase === 'building' || w.phase === 'complete')) return w.stage;
    return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------------------------------------------

/** The periodic step (every PERIOD_DAYS): what happened to lost scaffolds, the works' steps, protection credit, the AI. */
export function giantworksPeriodic(galaxy: Galaxy): void {
    const st = peekGwState(galaxy);
    if (st === null) return;
    for (const w of st.sites) {
        resolveBaseLoss(galaxy, w);
        stepWork(galaxy, w);
        protectStep(galaxy, w);
    }
    aiStep(galaxy);
}

// --- Game Editor --------------------------------------------------------------------------------------------------

const MAX_WORKS = 3;

/** Game Editor: null when a Great Work can start now. Pure. */
export function spawnNote(galaxy: Galaxy): string | null {
    if (greatWorkKinds().length === 0) return 'No wonder installed';
    const live = greatWorks(galaxy).filter((w) => w.phase === 'seeded' || w.phase === 'building').length;
    return live >= MAX_WORKS ? 'Enough Great Works under way' : null;
}

/** Game Editor: a Great Work starts now (the rumour skipped, the first convoy soon), the wonder forced or rolled. */
export function spawnGreatWork(galaxy: Galaxy, forcedKind: string | null): boolean {
    const undo = enableThreat(galaxy, GW_KEY);
    const rec = seedNow(galaxy, forcedKind);
    if (rec === null) {
        undo();
        return false;
    }
    gwState(galaxy).seeded = true;
    if (!startBuilding(galaxy, rec)) {
        const st = gwState(galaxy);
        st.sites.splice(st.sites.indexOf(rec), 1);
        undo();
        return false;
    }
    return true;
}

// --- Compact queries ----------------------------------------------------------------------------------------------

/** The missions the Compact's ships refuse (built lazily: the mission enum may not be initialised when this module loads). */
function refusedMissions(): readonly number[] {
    const M = BuiltObjectMissionType;
    return [M.Colonize, M.UnloadTroops, M.Bombard, M.WaitAndBombard, M.Capture, M.Raid];
}

export function registerGiantworks(): void {
    registerThreatExistence(GW_KEY, GW_FLAG);
    registerThreatSpawn({ key: GW_KEY, label: 'A Great Work (random wonder)', group: 'galactic', addons: [GW_KEY], note: spawnNote, spawn: (g) => spawnGreatWork(g, null) });
    registerScenarioGameStart({
        id: 'giantworks.start',
        flag: GW_FLAG,
        run: (g) => {
            if (threatExists(g, GW_KEY)) seedGreatWorks(g);
        },
    });
    registerScenarioPeriodic({ id: 'giantworks.periodic', flag: GW_FLAG, periodDays: PERIOD_DAYS, order: 20, run: (g) => giantworksPeriodic(g) });
    registerScenarioYearly({ id: 'giantworks.yearly', flag: GW_FLAG, order: 20, run: (g) => angerYearly(g) });
    registerActionEvents();
    registerScenarioQuery({
        id: 'giantworks.noWar',
        flag: GW_FLAG,
        query: 'declareWarBlocked',
        run: (g, v, a) => v || isCompact(g, a.empire) || isCompact(g, a.target),
    });
    registerScenarioQuery({
        id: 'giantworks.missions',
        flag: GW_FLAG,
        query: 'assignMissionAllowed',
        run: (g, v, a) => v && !(isCompact(g, a.builtObject.actualEmpire) && refusedMissions().includes(a.missionType)),
    });
    registerScenarioQuery({ id: 'giantworks.noCapture', flag: GW_FLAG, query: 'combatCaptureAllowed', run: (g, v, a) => v && !isCompact(g, a.capturingEmpire) });
}

export const GIANTWORKS_HANDLER_IDS = ['giantworks.start', 'giantworks.periodic', 'giantworks.yearly', 'giantworks.attacked', 'giantworks.killed', 'giantworks.owner', 'giantworks.exposed', 'giantworks.intel'] as const;
export const GIANTWORKS_QUERY_IDS = ['giantworks.noWar', 'giantworks.missions', 'giantworks.noCapture'] as const;

registerGiantworks();
