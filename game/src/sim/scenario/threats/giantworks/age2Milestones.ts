// The Age 2 knowledge milestones 2-8 (milestones 0 "The Unification" and 1 "The Thing in the Crater" live in longNight.ts). Not a port.
//
// Each milestone is reached once per empire (longNightState.ts markMilestone), by AI empires too; only a human empire gets the forced popup.
// A human empire that carries the Age 1 memory record gets the closing line "You know what this is." on milestones 3, 4 and 6.
//   2 'warp'    the empire's first ship hyperjump                                 (event hyperjumpStarted)
//   3 'contact' first contact with another species (diplomatic relation NotMet -> None); each species tells the myth its own way (a variant
//               keyed by the other's race); after 3 different species the Truth 'age2-shared-myth' is unlocked ('sharedMyth')
//   4 'ruin'    first old-capital ruin surveyed (age2World.ts ruins)               (event ruinsInvestigated)
//   5 'ark'     first survivor-ark scout: `milestoneArk(galaxy, empire)` is the hook for the survivor-ark build (not built yet)
//   6 'scar'    first Harvest Scar of the memory record seen (its system explored or in sensor range): the pens, the racks' meaning
//   7 'rumour'  first Founders' Compact rumour in Age 2; "it is happening again" only for a human that holds the Age 1 memory record
//   8 'diet'    the Galactic Diet founded in the new galaxy: the preparation begins (event councilFounded)
// Rnd: none. State: scenario state `age2Milestones` (plain data): the species each empire has met and the Truths it holds.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import { HabitatType, type Habitat } from '../../../types';
import { EmpireMessageType } from '../../../messages';
import { isHumanEmpire } from '../../../humanEmpires';
import { SystemVisibilityStatus } from '../../../visibility';
import { registerScenarioEvent, registerScenarioFramePeriodic } from '../../hooks';
import { scenarioMessage, scenarioText as T } from '../../messages';
import { dietOn } from '../../charactersVictory/diet/dietState';
import { age2WorldOf } from './age2World';
import { AGE_PREPARATION, HARVEST_CYCLE_FLAG, LN_TAG, markMilestone, memoryRecordOf, milestoneReached, peekLongNight } from './longNightState';

/** The Truth unlocked by comparing the myth across species. */
export const SHARED_MYTH_TRUTH = 'age2-shared-myth';
/** Different species an empire must meet for the shared-myth Truth. */
export const SHARED_MYTH_SPECIES = 3;
/** How many versions of the myth the species tell (GameText "LongNight Contact Variant 0..n-1"). */
export const MYTH_VARIANTS = 4;
export const AGE2_MILESTONES_KEY = 'age2Milestones';

/** The milestones this module owns plus 0 and 1 (for the Knowledge page), in plan order. `tag`: the GameText tag stem of its popup title / Knowledge row. */
export const MILESTONES: readonly { key: string; stem: string }[] = [
    { key: 'unification', stem: 'Unification' },
    { key: 'crash', stem: 'Crater' },
    { key: 'warp', stem: 'Warp' },
    { key: 'contact', stem: 'Contact' },
    { key: 'ruin', stem: 'Ruin Milestone' },
    { key: 'ark', stem: 'Ark' },
    { key: 'scar', stem: 'Scar' },
    { key: 'rumour', stem: 'Rumour' },
    { key: 'diet', stem: 'Diet' },
];

interface MilestoneData {
    /** Empire id -> the races (names) of the other species it has met. */
    contacts: Record<string, string[]>;
    /** Empire id -> Truth ids it holds. */
    truths: Record<string, string[]>;
}

function dataOf(galaxy: Galaxy): MilestoneData | null {
    const s = galaxy.scenario;
    if (s === null) return null;
    let d = s.state[AGE2_MILESTONES_KEY] as MilestoneData | undefined;
    if (d === undefined) {
        d = { contacts: {}, truths: {} };
        s.state[AGE2_MILESTONES_KEY] = d;
    }
    return d;
}

/** Age 2 of a Harvest Cycle game, and `e` an ordinary empire (not the independents, a pirate faction or a dead empire). Pure. */
function eligible(galaxy: Galaxy, e: Empire | null): e is Empire {
    const ln = peekLongNight(galaxy);
    return ln !== null && ln.age >= AGE_PREPARATION && e !== null && e.active && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null;
}

/** A human empire that remembers Age 1 (the memory record is the player's). Pure. */
export function remembersAge1(galaxy: Galaxy, e: Empire): boolean {
    return isHumanEmpire(galaxy, e) && memoryRecordOf(galaxy) !== null;
}

/**
 * `empire` reaches milestone `key`: true the first time. A human empire gets the forced popup (title tag `LongNight <stem> Title`, body
 * `LongNight <stem> Body` with `args`; titles take no arguments); when `know` and it remembers Age 1, the body ends with "You know what this is.".
 */
function reach(galaxy: Galaxy, empire: Empire, key: string, stem: string, args: unknown[], opts: { know?: boolean; subject?: Habitat | null; bodyTag?: string; titleTag?: string; quiet?: boolean } = {}): boolean {
    if (!markMilestone(galaxy, key, empire.empireId)) return false;
    if (!isHumanEmpire(galaxy, empire)) return true;
    let body = T(opts.bodyTag ?? `${LN_TAG} ${stem} Body`, ...args);
    if (opts.know === true && remembersAge1(galaxy, empire)) body += `\n\n${T(`${LN_TAG} Know This`)}`;
    scenarioMessage(galaxy, empire, T(opts.titleTag ?? `${LN_TAG} ${stem} Title`), body, { type: EmpireMessageType.GeneralGoodEvent, subject: opts.subject ?? null, popupMode: opts.quiet === true ? 'quiet' : 'force' });
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// 2: the first warp jump
// ---------------------------------------------------------------------------------------------------------------

export function onHyperjump(galaxy: Galaxy, empire: Empire): void {
    if (!eligible(galaxy, empire)) return;
    reach(galaxy, empire, 'warp', 'Warp', []);
}

// ---------------------------------------------------------------------------------------------------------------
// 3: first contact, and the myth compared
// ---------------------------------------------------------------------------------------------------------------

/** Which version of the myth a species tells: keyed by its race (the same race always tells the same one). Pure. */
export function mythVariant(raceName: string): number {
    let h = 0;
    for (let i = 0; i < raceName.length; i++) h = (h * 31 + raceName.charCodeAt(i)) % 9973;
    return h % MYTH_VARIANTS;
}

/** The Truths `empire` holds (this module's list; a human with the memory record keeps them in `memory.truths` too). Pure. */
export function truthsOf(galaxy: Galaxy, empire: Empire): string[] {
    return dataOf(galaxy)?.truths[String(empire.empireId)] ?? [];
}

function grantTruth(galaxy: Galaxy, empire: Empire, id: string): void {
    const d = dataOf(galaxy);
    if (d === null) return;
    const list = (d.truths[String(empire.empireId)] ??= []);
    if (!list.includes(id)) list.push(id);
    const mem = memoryRecordOf(galaxy);
    if (mem !== null && isHumanEmpire(galaxy, empire) && !mem.truths.includes(id)) mem.truths.push(id);
}

export function onEncounter(galaxy: Galaxy, empire: Empire, other: Empire): void {
    const race = other.dominantRace?.name ?? null;
    if (!eligible(galaxy, empire) || !eligible(galaxy, other) || race === null || other.dominantRace === empire.dominantRace) return;
    const d = dataOf(galaxy);
    if (d === null) return;
    const met = (d.contacts[String(empire.empireId)] ??= []);
    if (!met.includes(race)) met.push(race);
    const variant = T(`${LN_TAG} Contact Variant ${mythVariant(race)}`, race, other.name);
    reach(galaxy, empire, 'contact', 'Contact', [other.name, race, variant], { know: true });
    if (met.length >= SHARED_MYTH_SPECIES && markMilestone(galaxy, 'sharedMyth', empire.empireId)) {
        grantTruth(galaxy, empire, SHARED_MYTH_TRUTH);
        if (isHumanEmpire(galaxy, empire)) scenarioMessage(galaxy, empire, T(`${LN_TAG} Myth Truth Title`), T(`${LN_TAG} Myth Truth Body`, met.length), { type: EmpireMessageType.GeneralGoodEvent, popupMode: 'force' });
    }
}

// ---------------------------------------------------------------------------------------------------------------
// 4: an old capital's ruin
// ---------------------------------------------------------------------------------------------------------------

export function onRuinFound(galaxy: Galaxy, empire: Empire, habitat: Habitat): void {
    const w = age2WorldOf(galaxy);
    if (!eligible(galaxy, empire) || w === null) return;
    const site = w.ruins.find((s) => s.habitat === habitat);
    if (site === undefined) return;
    // (quiet: the ruin's own survey popup, age2World.ts, already tells it; this only logs it and marks the milestone)
    reach(galaxy, empire, 'ruin', 'Ruin Milestone', [site.empire, habitat.name], { know: true, subject: habitat, quiet: true });
}

// ---------------------------------------------------------------------------------------------------------------
// 5: the survivor ark (hook)
// ---------------------------------------------------------------------------------------------------------------

/** The survivor-ark build calls this when `empire` first scouts a survivor ark (not built yet). True the first time. */
export function milestoneArk(galaxy: Galaxy, empire: Empire): boolean {
    if (!eligible(galaxy, empire)) return false;
    return reach(galaxy, empire, 'ark', 'Ark', []);
}

// ---------------------------------------------------------------------------------------------------------------
// 6: the first Harvest Scar
// ---------------------------------------------------------------------------------------------------------------

/** The scar worlds of the memory record in this galaxy (by position), kept per galaxy object (a loaded game recomputes them). */
const scarWorlds = new WeakMap<Galaxy, Habitat[]>();

export function scarHabitats(galaxy: Galaxy): Habitat[] {
    let list = scarWorlds.get(galaxy);
    if (list === undefined) {
        list = [];
        for (const sc of memoryRecordOf(galaxy)?.scars ?? []) {
            const h = galaxy.findNearestHabitatOfType(sc.x, sc.y, HabitatType.Undefined);
            if (h !== null && !list.includes(h)) list.push(h);
        }
        scarWorlds.set(galaxy, list);
    }
    return list;
}

/** An empire knows a scar world when its system is explored or in sensor range. Pure. */
function scarSeen(empire: Empire, h: Habitat): boolean {
    const v = empire.systemVisibility[h.systemIndex];
    return v !== undefined && v !== null && (v.status === SystemVisibilityStatus.Explored || v.status === SystemVisibilityStatus.Visible);
}

export function scarCheck(galaxy: Galaxy): void {
    const ln = peekLongNight(galaxy);
    if (ln === null || ln.age < AGE_PREPARATION || memoryRecordOf(galaxy) === null) return;
    const scars = scarHabitats(galaxy);
    if (scars.length === 0) return;
    for (const e of galaxy.empires) {
        if (!eligible(galaxy, e) || milestoneReached(galaxy, 'scar', e.empireId)) continue;
        const h = scars.find((s) => scarSeen(e, s));
        if (h !== undefined) reach(galaxy, e, 'scar', 'Scar', [h.name, galaxy.systems[h.systemIndex]?.systemStar?.name ?? h.name], { know: true, subject: h });
    }
}

// ---------------------------------------------------------------------------------------------------------------
// 7: the Founders' Compact rumour
// ---------------------------------------------------------------------------------------------------------------

export function onFoundersRumour(galaxy: Galaxy, empire: Empire): void {
    if (!eligible(galaxy, empire)) return;
    reach(galaxy, empire, 'rumour', 'Rumour', [], { bodyTag: remembersAge1(galaxy, empire) ? `${LN_TAG} Rumour Body` : `${LN_TAG} Rumour Neutral Body`, titleTag: remembersAge1(galaxy, empire) ? `${LN_TAG} Rumour Title` : `${LN_TAG} Rumour Neutral Title` });
}

// ---------------------------------------------------------------------------------------------------------------
// 8: the Diet re-forms
// ---------------------------------------------------------------------------------------------------------------

export function onCouncilFounded(galaxy: Galaxy, members: readonly Empire[]): void {
    if (!dietOn(galaxy)) return;
    for (const m of members) if (eligible(galaxy, m)) reach(galaxy, m, 'diet', 'Diet', []);
}

// ---------------------------------------------------------------------------------------------------------------
// The Knowledge page: "The New Age"
// ---------------------------------------------------------------------------------------------------------------

export interface MilestoneRow {
    key: string;
    /** The milestone's title (resolved). */
    title: string;
    /** The Knowledge line (resolved; "LongNight Know Row <stem>" with the rumour's line depending on the memory). */
    text: string;
}

/** The milestones `empire` has reached, in plan order, plus the Truths it holds. Empty before Age 2. Pure. */
export function milestoneRowsOf(galaxy: Galaxy, empire: Empire): MilestoneRow[] {
    const ln = peekLongNight(galaxy);
    if (ln === null || ln.age < AGE_PREPARATION) return [];
    const rows: MilestoneRow[] = [];
    for (const m of MILESTONES) {
        if (!milestoneReached(galaxy, m.key, empire.empireId)) continue;
        const neutral = m.key === 'rumour' && !remembersAge1(galaxy, empire);
        rows.push({
            key: m.key,
            title: T(`${LN_TAG} ${m.stem}${neutral ? ' Neutral' : ''} Title`),
            text: T(`${LN_TAG} Know Row ${m.stem}${neutral ? ' Neutral' : ''}`),
        });
    }
    for (const id of truthsOf(galaxy, empire)) rows.push({ key: `truth:${id}`, title: T(`${LN_TAG} Truth ${id} Title`), text: T(`${LN_TAG} Truth ${id} Text`) });
    return rows;
}

export function registerAge2Milestones(): void {
    registerScenarioEvent({ id: 'age2Milestones.warp', flag: HARVEST_CYCLE_FLAG, event: 'hyperjumpStarted', run: (g, e) => onHyperjump(g, e.empire) });
    registerScenarioEvent({ id: 'age2Milestones.contact', flag: HARVEST_CYCLE_FLAG, event: 'empireEncountered', run: (g, e) => onEncounter(g, e.empire, e.other) });
    registerScenarioEvent({ id: 'age2Milestones.ruin', flag: HARVEST_CYCLE_FLAG, event: 'ruinsInvestigated', run: (g, e) => onRuinFound(g, e.empire, e.habitat) });
    registerScenarioEvent({ id: 'age2Milestones.rumour', flag: HARVEST_CYCLE_FLAG, event: 'foundersRumour', run: (g, e) => onFoundersRumour(g, e.empire) });
    registerScenarioEvent({ id: 'age2Milestones.diet', flag: HARVEST_CYCLE_FLAG, event: 'councilFounded', run: (g, e) => onCouncilFounded(g, e.members) });
    registerScenarioFramePeriodic({ id: 'age2Milestones.scar', flag: HARVEST_CYCLE_FLAG, order: 27, periodDays: 10, run: (g) => scarCheck(g) });
}
