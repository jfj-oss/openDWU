// The Harvest Cycle: the Long Night (Giantworks option gwHarvestCycle, default on). Not a port.
//
// When the Beacon's 80% defeat would end the game (beaconFleet.ts lossCheck), the Reclaimers' harvest instead leaves the galaxy to start
// over: beginLongNight records what the player remembers (the MemoryRecord) and asks the driver to replace the galaxy
// (sim/galaxyReset.ts). The driver builds the next cycle's galaxy from the SAME seed through the stock new-game path with a pre-warp start
// (sim/longNightReset.ts buildAge2Game) and swaps it in as a loaded save replaces a game. Age 2 starts there: the memory record in the new
// galaxy's state, the "Unification" popup, a crashed Reclaimer hull on a rocky world of each empire's home system (the stock pre-warp start's
// research ruin; surveying it unlocks the primitive hyperdrive research through the stock path and opens "The Thing in the Crater").
//
// Rnd: none drawn here. Everything of the new galaxy comes from createGame with the old seed; the records and messages draw nothing.
// Without a driver that can swap the galaxy (the in-thread loop, multiplayer lockstep), or in a game made before this option, or past
// Age 1, beginLongNight returns false and the Beacon's defeat ends the game as before.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { Habitat } from '../../../types';
import { EmpireMessageType } from '../../../messages';
import { humanEmpires, isHumanEmpire } from '../../../humanEmpires';
import { galaxyStarDate } from '../../../tick/simTime';
import { RuinType } from '../../../ruins';
import { galaxyResetSupported, requestGalaxyReset } from '../../../galaxyReset';
import { registerScenarioEvent, registerScenarioFramePeriodic, registerScenarioQuery, radiusFraction } from '../../hooks';
import { scenarioFlag } from '../../state';
import { scenarioMessage, scenarioNews, scenarioText as T } from '../../messages';
import { captureSurvivors } from '../../../age2Placement';
import { beaconState, isNormalEmpire, peekBeaconState, type BeaconState, type CoreRec, type EmpireParts } from './beaconState';
import { registerAge2World } from './age2World';
<<<<<<< HEAD
import { registerAge2Milestones } from './age2Milestones';
=======
import { registerAge2Holdouts } from './age2Holdouts';
>>>>>>> 6690e50f (Age 2: Precursor holdouts (shielded cores, rigged colonies, evacuation warning, tech on conquest, Knowledge rows))
import { captureMega, restoreMega } from './megaStation';
import {
    AGE_PREPARATION,
    HARVEST_CYCLE_FLAG,
    LN_TAG,
    longNightState,
    markMilestone,
    memoryContributors,
    registerMemoryContributor,
    peekLongNight,
    type CrashSite,
    type MegaStationMemory,
    type MemoryRecord,
    type PlaceRec,
    type PlayerIdentityRec,
    type ScarRec,
} from './longNightState';

/** The research node special function code of the primitive hyperdrive the pre-warp start keeps locked (research.txt; stock Start.2.cs 1274 FindNodeBySpecialFunctionCode(2)). */
export const HYPERDRIVE_UNLOCK_CODE = 2;

// ---------------------------------------------------------------------------------------------------------------
// The trigger
// ---------------------------------------------------------------------------------------------------------------

/** The option is on, this game was made with it (it kept its new-game options), it is still Age 1 and its driver can swap the galaxy. Pure. */
export function longNightAvailable(galaxy: Galaxy): boolean {
    const ln = peekLongNight(galaxy);
    return scenarioFlag(galaxy, HARVEST_CYCLE_FLAG) && ln !== null && ln.age === 1 && ln.createOptions !== undefined && ln.pending == null && galaxyResetSupported(galaxy);
}

/**
 * The Beacon's defeat (beaconFleet.ts lossCheck): begin the Long Night instead of ending the game. True when it began (the caller must
 * not end the game); false: the defeat stands. The new galaxy replaces this one at the driver's next boundary.
 */
export function beginLongNight(galaxy: Galaxy, st: BeaconState): boolean {
    if (!longNightAvailable(galaxy)) return false;
    const ln = longNightState(galaxy);
    const record = captureMemory(galaxy, st);
    if (!requestGalaxyReset(galaxy)) return false;
    ln.pending = record;
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// The memory record
// ---------------------------------------------------------------------------------------------------------------

function systemNameOf(galaxy: Galaxy, h: Habitat): string {
    return galaxy.systems[h.systemIndex]?.systemStar?.name ?? h.name;
}

function placeOf(galaxy: Galaxy, h: Habitat): PlaceRec {
    return { name: h.name, systemName: systemNameOf(galaxy, h), x: h.xpos, y: h.ypos };
}

/** The Harvest Scars: every harvest core of Age 1, live or ended (the Beacon state keeps the last 40), and whether the player's empires knew it. Pure. */
export function scarsOf(galaxy: Galaxy, st: BeaconState): ScarRec[] {
    const humans = humanEmpires(galaxy);
    return (st.cores ?? []).map((c: CoreRec) => ({
        ...placeOf(galaxy, c.colony),
        fate: c.ended ?? 'live',
        knownToPlayer: humans.some((e) => (c.knownBy ?? []).includes(e.empireId)),
    }));
}

/**
 * The mega-station's progress as Age 1 left it, read defensively from whatever the mega-station path keeps in the scenario state (keys
 * megaStation / megaPath, with `components` as a record of counts or a list of names, and `blueprintPoints` / `blueprintProgress` / `blueprint`).
 * Anything missing stays empty; the mega-station path may also fill the record itself (registerMemoryContributor). Pure.
 */
export function readMegaStation(galaxy: Galaxy): MegaStationMemory {
    const out: MegaStationMemory = { components: {}, blueprintPoints: 0 };
    const state = galaxy.scenario?.state ?? {};
    for (const key of ['megaStation', 'megaPath']) {
        const s = state[key] as Record<string, unknown> | undefined;
        if (s === undefined || s === null || typeof s !== 'object') continue;
        const comps = s['components'];
        if (Array.isArray(comps)) {
            for (const c of comps) if (typeof c === 'string') out.components[c] = (out.components[c] ?? 0) + 1;
        } else if (comps !== undefined && comps !== null && typeof comps === 'object') {
            for (const [k, v] of Object.entries(comps as Record<string, unknown>)) {
                if (typeof v === 'number' && Number.isFinite(v)) out.components[k] = v;
                else if (v === true) out.components[k] = 1;
            }
        }
        for (const k of ['blueprintPoints', 'blueprintProgress', 'blueprint']) {
            const v = s[k];
            if (typeof v === 'number' && Number.isFinite(v)) out.blueprintPoints = Math.max(out.blueprintPoints, v);
        }
    }
    return out;
}

export function playerIdentityOf(galaxy: Galaxy): PlayerIdentityRec | null {
    const p = galaxy.playerEmpire;
    if (p === null || p.dominantRace === null) return null;
    return { name: p.name, race: p.dominantRace.name, primaryColor: p.mainColor, secondaryColor: p.secondaryColor, flagShape: p.flagShape };
}

/** The Reclaimers' foundries (beaconFoundry.ts, kept in the Beacon state): the destroyed ones, and the living ones a human player had found. */
function foundriesOf(galaxy: Galaxy, st: BeaconState): MemoryRecord['foundries'] {
    const out: MemoryRecord['foundries'] = { located: [], destroyed: [] };
    const humans = new Set(humanEmpires(galaxy).map((e) => e.empireId));
    for (const f of st.foundries?.list ?? []) {
        const place = { name: T('Beacon Foundry Name', f.id), systemName: '', x: f.x, y: f.y };
        if (f.status === 'destroyed') out.destroyed.push(place);
        else if (f.knowledge.some((k) => humans.has(k.empireId) && k.level >= 2)) out.located.push(place);
    }
    return out;
}

/** What the player remembers when the Long Night begins. Pure (the contributors' captures are theirs to keep pure). */
export function captureMemory(galaxy: Galaxy, st: BeaconState): MemoryRecord {
    const extra: Record<string, unknown> = {};
    for (const c of memoryContributors()) {
        const v = c.capture(galaxy);
        if (v !== undefined) extra[c.id] = JSON.parse(JSON.stringify(v)) as unknown;
    }
    return {
        age: AGE_PREPARATION,
        seed: galaxy.randomSeed,
        fromDate: galaxyStarDate(galaxy),
        eliminatedPct: st.popBaseline > 0 ? (100 * st.popEliminated) / st.popBaseline : 0,
        scars: scarsOf(galaxy, st),
        foundries: foundriesOf(galaxy, st),
        megaStation: readMegaStation(galaxy),
        survivors: captureSurvivors(galaxy, (e) => isNormalEmpire(galaxy, e, st)),
        beaconSite: st.site?.habitat != null ? placeOf(galaxy, st.site.habitat) : null,
        // Placeholder: the Truths of the cycle (Knowledge page ids) are not built yet; one stands for "the Harvest was seen".
        truths: st.reclamationDate > 0 ? ['age1-harvest'] : [],
        player: playerIdentityOf(galaxy),
        extra,
    };
}

// ---------------------------------------------------------------------------------------------------------------
// Age 2: the start
// ---------------------------------------------------------------------------------------------------------------

/** The research node of the primitive hyperdrive (stock FindNodeBySpecialFunctionCode(2): the first such node in list order), or null. */
export function hyperdriveUnlockNodeId(galaxy: Galaxy): number | null {
    const defs = galaxy.researchStatic?.definitions ?? [];
    for (const d of defs) if (d.specialFunctionCode === HYPERDRIVE_UNLOCK_CODE) return d.projectId;
    return null;
}

/**
 * Milestone 1: the stock pre-warp start put an UnlockResearchProject ruin (the hyperdrive node) on the furthest rocky planet or moon of each
 * pre-warp empire's home system (ruins.ts placeRuinsUnlockTech: gas giants are never chosen). Those are the crashed Reclaimer hulls: renamed
 * and recorded. Returns the sites. Draws no Rnd.
 */
export function markCrashSites(galaxy: Galaxy): CrashSite[] {
    const st = longNightState(galaxy);
    const node = hyperdriveUnlockNodeId(galaxy);
    st.crashSites = [];
    if (node === null) return st.crashSites;
    for (const e of galaxy.empires) {
        if (e === null || !e.active || e === galaxy.independentEmpire || e.pirateEmpireBaseHabitat !== null || e.capital === null) continue;
        for (const h of galaxy.systemHabitatsOf(e.capital.systemIndex)) {
            const r = h?.ruin ?? null;
            if (h === null || r === null || r.type !== RuinType.UnlockResearchProject || r.researchProjectId !== node) continue;
            r.name = T(`${LN_TAG} Crash Name`);
            r.description = T(`${LN_TAG} Crash Description`);
            st.crashSites.push({ habitat: h, empireId: e.empireId });
            break;
        }
    }
    return st.crashSites;
}

/** The new galaxy's first messages to the human empires: the transition (placeholder text), a news line, and popup #0 "The Unification". */
export function sendAge2Start(galaxy: Galaxy): void {
    const humans = humanEmpires(galaxy);
    for (const e of humans) {
        scenarioMessage(galaxy, e, T(`${LN_TAG} Begin Title`), T(`${LN_TAG} Begin Body`), { type: EmpireMessageType.GeneralNeutralEvent, popupMode: 'force' });
    }
    scenarioNews(galaxy, null, T(`${LN_TAG} News`), (e) => isHumanEmpire(galaxy, e), null, undefined, 'quiet');
    for (const e of humans) {
        markMilestone(galaxy, 'unification', e.empireId);
        scenarioMessage(galaxy, e, T(`${LN_TAG} Unification Title`), T(`${LN_TAG} Unification Body`), { type: EmpireMessageType.GeneralNeutralEvent, popupMode: 'force' });
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Milestone 1: surveying the crashed hull
// ---------------------------------------------------------------------------------------------------------------

/**
 * exploration.ts investigateRuins (top, before the stock outcome): an empire surveys a crashed hull. The stock outcome then unlocks the
 * primitive hyperdrive research (researchNode.isEnabled = true, "Ancient Knowledge Cache Discovered"); this adds the popup "The Thing in the
 * Crater" for a human empire the first time, and the milestone for any empire (AI too). A survey after the node is already unlocked is
 * the stock "ruins are silent" and nothing here.
 */
export function onCrashSurveyed(galaxy: Galaxy, empire: Empire, habitat: Habitat): void {
    const ln = peekLongNight(galaxy);
    if (ln === null || ln.age < AGE_PREPARATION || !ln.crashSites.some((s) => s.habitat === habitat)) return;
    const ruin = habitat.ruin;
    if (ruin === null || ruin.type !== RuinType.UnlockResearchProject) return;
    const node = empire.research?.techTree?.[ruin.researchProjectId] ?? null;
    if (node === null || node.isEnabled) return;
    if (!markMilestone(galaxy, 'crash', empire.empireId)) return;
    if (isHumanEmpire(galaxy, empire)) {
        scenarioMessage(galaxy, empire, T(`${LN_TAG} Crater Title`), T(`${LN_TAG} Crater Body`, habitat.name), { type: EmpireMessageType.GeneralGoodEvent, subject: habitat, popupMode: 'force' });
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Age 1: the advisors' warning at half the galaxy's people
// ---------------------------------------------------------------------------------------------------------------

/** The share of the galaxy's people the Beacon must have processed for the advisors' popup (and the AI empires' lean to the rim). */
export const RIM_WARNING_PCT = 50;
/** How much more an AI empire values a colony target at the very rim than one at the galaxy's centre, once the warning has gone out. */
const RIM_NUDGE_FACTOR = 0.6;

/**
 * Age 1, every few days: when the Beacon has processed half the galaxy's people (popEliminated / popBaseline), each human player gets the
 * popup "A World Beyond Their Reach" once, and the AI empires start to lean to rim worlds (rimNudgeFactor). Pure of Rnd.
 */
export function advisorCheck(galaxy: Galaxy): void {
    const ln = peekLongNight(galaxy);
    const st = peekBeaconState(galaxy);
    if (ln === null || ln.age !== 1 || st === null || st.popBaseline <= 0) return;
    if ((100 * st.popEliminated) / st.popBaseline < RIM_WARNING_PCT) return;
    ln.rimNudge = true;
    const sent = (ln.advisorSent ??= []);
    for (const e of humanEmpires(galaxy)) {
        if (sent.includes(e.empireId)) continue;
        sent.push(e.empireId);
        scenarioMessage(galaxy, e, T(`${LN_TAG} Rim Title`), T(`${LN_TAG} Rim Body`), { type: EmpireMessageType.GeneralNeutralEvent, popupMode: 'force' });
    }
}

/** The AI colonisation value of a target after the warning: up to RIM_NUDGE_FACTOR more at the very rim (squared with the distance from the centre). Pure. */
export function rimNudgedValue(galaxy: Galaxy, empire: Empire, habitat: Habitat, value: number): number {
    const ln = peekLongNight(galaxy);
    if (ln === null || ln.rimNudge !== true || ln.age !== 1 || value <= 0 || isHumanEmpire(galaxy, empire)) return value;
    const f = Math.min(1, radiusFraction(galaxy, habitat.xpos, habitat.ypos));
    return value * (1 + RIM_NUDGE_FACTOR * f * f);
}

export const LONG_NIGHT_HANDLER_IDS = ['longNight.crash', 'longNight.advisor', 'longNight.rimNudge'] as const;

/** What the memory record holds of the empires' mega-station parts (contributor 'beacon.parts'): the pieces of every empire standing, by name. (The pieces of a dead empire lie in Age 2's ruins, age2World.ts; an older record's `dead` list is ignored.) */
export interface PartsMemory {
    /** Empires standing at the Long Night, by name (the new age's empires of the same names hold them again). */
    empires: Record<string, EmpireParts>;
}

function copyParts(rec: EmpireParts): EmpireParts {
    return JSON.parse(JSON.stringify(rec)) as EmpireParts;
}

function hasPieces(rec: EmpireParts): boolean {
    return rec.beamLens === true || rec.linkConduit === true || rec.cloakLattice === true || (rec.mindFragments ?? 0) > 0 || (rec.voidFrames ?? 0) > 0 || rec.blueprint !== undefined;
}

/**
 * Every empire's mega-station parts and blueprint progress (beaconComponents.ts, kept in the Beacon state), by empire name: the new age's empires
 * keep their names, so survivors carry their pieces (AIs too). An empire that died is not carried (its pieces are the ruins' record).
 */
export function captureParts(galaxy: Galaxy): PartsMemory | undefined {
    const st = peekBeaconState(galaxy);
    if (st === null || st.parts === undefined) return undefined;
    const out: PartsMemory = { empires: {} };
    for (const [id, rec] of Object.entries(st.parts.held)) {
        const e = galaxy.empires.find((x) => x !== null && String(x.empireId) === id) ?? null;
        if (e === null || e === galaxy.independentEmpire || e.pirateEmpireBaseHabitat !== null || e === st.faction || !hasPieces(rec)) continue;
        if (e.active) out.empires[e.name] = copyParts(rec);
    }
    return Object.keys(out.empires).length > 0 ? out : undefined;
}

/** The new age: each empire with a carried record (matched by name) holds its parts and blueprint progress again. Reads the older shape (humans only, a bare record by name) too. */
export function restoreParts(galaxy: Galaxy, data: unknown): void {
    if (data === null || typeof data !== 'object') return;
    const d = data as Partial<PartsMemory> & Record<string, unknown>;
    const byName = (d.empires !== undefined ? d.empires : (d as unknown as Record<string, EmpireParts>)) as Record<string, EmpireParts>;
    for (const e of galaxy.empires) {
        if (e === null || e === galaxy.independentEmpire || e.pirateEmpireBaseHabitat !== null) continue;
        const rec = byName[e.name];
        if (rec === undefined || rec === null || typeof rec !== 'object') continue;
        const st = beaconState(galaxy);
        st.parts ??= { held: {}, peakAssets: 0, lastAssets: 0, shipUnit: 0, firstBeam: 0, revealDate: 0, visited: [] };
        st.parts.held[String(e.empireId)] = copyParts(rec);
    }
}

export function registerLongNight(): void {
    registerAge2World();
<<<<<<< HEAD
    registerAge2Milestones();
=======
    registerAge2Holdouts();
>>>>>>> 6690e50f (Age 2: Precursor holdouts (shielded cores, rigged colonies, evacuation warning, tech on conquest, Knowledge rows))
    registerMemoryContributor({ id: 'beacon.parts', capture: captureParts, restore: restoreParts });
    registerScenarioFramePeriodic({ id: 'longNight.advisor', flag: HARVEST_CYCLE_FLAG, order: 26, periodDays: 5, run: (g) => advisorCheck(g) });
    registerScenarioQuery({ id: 'longNight.rimNudge', flag: HARVEST_CYCLE_FLAG, query: 'colonizationTargetValue', run: (g, v, a) => rimNudgedValue(g, a.empire, a.habitat, v) });
    registerMemoryContributor({ id: 'beacon.mega', capture: captureMega, restore: restoreMega });
    registerScenarioEvent({ id: 'longNight.crash', flag: HARVEST_CYCLE_FLAG, event: 'ruinsInvestigated', run: (g, e) => onCrashSurveyed(g, e.empire, e.habitat) });
}

registerLongNight();
