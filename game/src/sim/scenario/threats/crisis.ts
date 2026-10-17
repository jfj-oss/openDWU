// Crisis interactions (user-approved 2026-10-15): what the rest of the galaxy does when a crisis faction (Purifier, Cult,
// Hive, Generation Ships and the other hostile threat factions) is loose. Not a port; composed from the framework's
// events and the existing reputation ledger.
//
//   10. Reputation: an empire that fights the crisis (kills its ships, loses ships to it, keeps shooting at it) earns a
//       SMALL, one-off regard from the empires that met it; an empire that sits the crisis out while it sits in its own
//       region (or profits from it, see 11) loses a little. Once per crisis per empire, never large, and it fades with
//       the ledger's own yearly decay. Needs the reputation add-on (flag reputationLedger); without it nothing is written.
//   11. Opportunists: an empire hit by a crisis (a colony risen to the faction, invaded or destroyed) that is attacked by
//       a rival, whose war was declared within a short window, gets a clear message naming the rival; the rival gets one
//       too, and the galaxy a news line (and so an event-log entry). Stock AI behaviour only: it only reports.
//
// Every handler is gated by the crisis's own flag, so a game without that threat runs none of it. Rnd: none.
// Rival-war attribution uses `warDeclared` after the hit, so wars that were already running are not "opportunism".

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import { DiplomaticRelationType } from '../../diplomacy';
import { EmpireMessageType } from '../../messages';
import { YEAR_LENGTH } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { isHumanEmpire } from '../../humanEmpires';
import { addMissingText, tryGetText } from '../../textResolver';
import { GAME_DAY_LENGTH, registerScenarioEvent, registerScenarioYearly } from '../hooks';
import { scenarioMessage, scenarioNews, scenarioText } from '../messages';
import { scenarioParam } from '../state';
import { applyReputation, reputationOn } from '../reputation/ledger';
import { normalEmpires, peekThreatState, threatState } from './framework';

// ---------------------------------------------------------------------------------------------------------------
// The registry: which scenario flag / state key holds which crisis faction
// ---------------------------------------------------------------------------------------------------------------

export interface CrisisEntry {
    /** Threat state key (also the id used in the ledger causes). */
    key: string;
    flag: string;
    /** The crisis's name in messages ("the Cult"). */
    label: string;
}

/** The hostile threat factions that hold an empire in their state's `faction` field. */
export const CRISIS_ENTRIES: CrisisEntry[] = [
    { key: 'purifier', flag: 'threatPurifier', label: 'Purifier' },
    { key: 'cult', flag: 'cult', label: 'Cult' },
    { key: 'hive', flag: 'hive', label: 'Hive' },
    { key: 'generationShips', flag: 'threatGenerationShips', label: 'Generation Ships' },
    { key: 'greyTide', flag: 'greyTide', label: 'Grey Tide' },
    { key: 'ghostArmada', flag: 'threatGhostArmada', label: 'Ghost Armada' },
    { key: 'darkFarms', flag: 'darkFarms', label: 'Dark Farms' },
    { key: 'robotMutiny', flag: 'threatRobotMutiny', label: 'Robot Mutiny' },
    { key: 'hollowFleet', flag: 'threatHollowFleet', label: 'Hollow Fleet' },
    { key: 'probeSwarm', flag: 'threatProbeSwarm', label: 'Probe Swarm' },
];

// A crisis may name more helpers than the treaty rule finds (Giantworks: the empires that protected the Great Work that turned hostile).
const helperProviders = new Map<string, (galaxy: Galaxy, faction: Empire) => Empire[]>();

/** A threat names extra helpers of its crisis faction (crisisHelpers adds them to the treaty partners). */
export function registerCrisisHelpers(key: string, provider: (galaxy: Galaxy, faction: Empire) => Empire[]): void {
    helperProviders.set(key, provider);
}

/** The crisis's faction while it exists (active); null before it wakes / after it falls. Pure. */
export function crisisFaction(galaxy: Galaxy, entry: CrisisEntry): Empire | null {
    const st = peekThreatState<{ faction?: Empire | null }>(galaxy, entry.key);
    const f = st?.faction ?? null;
    return f !== null && f.active ? f : null;
}

/**
 * True once the threat is over (the Purifier destroyed, the Cult / Hive contained, a Generation Ships arc ended): its faction empire
 * can outlive that, but it is no longer loose, so the council does not table it and nobody is marked down for sitting it out. The
 * events of the final blow are still booked (the killer's credit is read at the next yearly check). Pure.
 */
export function crisisOver(galaxy: Galaxy, entry: CrisisEntry): boolean {
    const st = peekThreatState<{ ended?: boolean; phase?: string }>(galaxy, entry.key);
    return st?.ended === true || st?.phase === 'ended';
}

/** Every crisis whose faction is loose right now (registry order). Pure. */
export function activeCrises(galaxy: Galaxy): { entry: CrisisEntry; faction: Empire }[] {
    const s = galaxy.scenario;
    const out: { entry: CrisisEntry; faction: Empire }[] = [];
    if (s === null) return out;
    for (const entry of CRISIS_ENTRIES) {
        if (s.flags[entry.flag] !== true) continue;
        const faction = crisisFaction(galaxy, entry);
        if (faction !== null && !crisisOver(galaxy, entry)) out.push({ entry, faction });
    }
    return out;
}

/**
 * Empires seen helping the crisis: the Purifier's waker once exposed; for every crisis an empire that holds a treaty
 * with the faction (free trade, defence pact, protectorate). Sorted by empire id. Pure.
 */
export function crisisHelpers(galaxy: Galaxy, entry: CrisisEntry, faction: Empire): Empire[] {
    const out: Empire[] = [];
    for (const e of helperProviders.get(entry.key)?.(galaxy, faction) ?? []) if (e.active && e !== faction && !out.includes(e)) out.push(e);
    if (entry.key === 'purifier') {
        const st = peekThreatState<{ exposed?: boolean; waker?: Empire | null }>(galaxy, 'purifier');
        const w = st?.waker ?? null;
        if (st?.exposed === true && w !== null && w.active && w !== faction) out.push(w);
    }
    for (const e of crisisNormals(galaxy, faction)) {
        if (out.includes(e)) continue;
        const t = e.diplomaticRelations.byEmpire(faction)?.type;
        if (t === DiplomaticRelationType.FreeTradeAgreement || t === DiplomaticRelationType.MutualDefensePact || t === DiplomaticRelationType.Protectorate) out.push(e);
    }
    return out.sort((a, b) => a.empireId - b.empireId);
}

// ---------------------------------------------------------------------------------------------------------------
// Texts (inline so a threat spawned from the Game Editor into a game without its add-on still reads right)
// ---------------------------------------------------------------------------------------------------------------

const TEXTS = [
    "'Crisis interactions: message texts (scenarioText tags). {n} items are filled by the scenario code.",
    'Crisis Opportunist Title;Taking advantage',
    'Crisis Opportunist Aggressor;We have moved against {0} after the {1} {2}. The galaxy will call it taking advantage.',
    'Crisis Opportunist Victim;{0} takes advantage of the {1} {2} and moves against us.',
    'Crisis Opportunist News;{0} takes advantage of the {1} {2} and declares war on {3}.',
    'Crisis What Rising;rising in {0}',
    'Crisis What Invaded;invasion of {0}',
    'Crisis What Destroyed;destruction of {0}',
    'Crisis Rep Title;Standing among the empires',
    'Crisis Rep Helped;We are known to have fought the {0}: the empires that met us think a little better of us.',
    'Crisis Rep Sat;We stood aside while the {0} was loose in our own region: the empires that met us think a little less of us.',
    'Reputation Cause crisis.help;Fought the galactic crisis',
    'Reputation Cause crisis.sit;Stood aside from the galactic crisis',
    'Reputation Cause crisis.opportunist;Took advantage of a crisis',
].join('\n');

/** Loads the texts once (addMissingText never overrides anything). */
export function ensureCrisisTexts(): void {
    if (tryGetText('Crisis Opportunist Title') === null) addMissingText(TEXTS);
}

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------

type HitKind = 'rising' | 'invaded' | 'destroyed';

interface CrisisHit {
    key: string;
    victim: number;
    kind: HitKind;
    place: string;
    habitat: Habitat | null;
    date: number;
    /** Empires already at war with the victim when it was hit (their war is not opportunism). */
    atWar: number[];
    /** Empires already reported as opportunists for this hit. */
    reported: number[];
}

interface FightRecord {
    kills: number;
    lost: number;
    attacks: number;
}

export interface CrisisState {
    hits: CrisisHit[];
    /** `${key}:${empireId}` → what that empire did against the crisis. */
    fight: Record<string, FightRecord>;
    /** `${key}:${empireId}` → consecutive yearly checks with the faction in the empire's region. */
    near: Record<string, number>;
    /** `${cause}:${empireId}` → true once the ledger entry was written (once per crisis per empire). */
    done: Record<string, boolean>;
    /** `${key}` → star date the crisis was first seen loose. */
    seen: Record<string, number>;
    /** `${key}` → true once the faction has hurt someone (a ship destroyed, a colony risen / invaded / destroyed): only then does sitting it out count. */
    harmed: Record<string, boolean>;
    /** Colonies taking refugees: temporary crowding (see purifierRefugees). */
    crowding: { habitat: Habitat; amount: number; until: number }[];
}

export function crisisState(galaxy: Galaxy): CrisisState {
    return threatState(galaxy, 'crisis', (): CrisisState => ({ hits: [], fight: {}, near: {}, done: {}, seen: {}, harmed: {}, crowding: [] }));
}

export const P = {
    windowDays: (g: Galaxy) => scenarioParam(g, 'crisisOpportunistDays', 180),
    repHelp: (g: Galaxy) => scenarioParam(g, 'crisisRepHelp', 3),
    repSit: (g: Galaxy) => scenarioParam(g, 'crisisRepSit', 2),
    repOpportunist: (g: Galaxy) => scenarioParam(g, 'crisisRepOpportunist', 3),
    sitYears: (g: Galaxy) => scenarioParam(g, 'crisisSitYears', 2),
    fightPoints: (g: Galaxy) => scenarioParam(g, 'crisisFightPoints', 4),
    regionSectors: (g: Galaxy) => scenarioParam(g, 'crisisRegionSectors', 3),
};

/** True when `e` is the faction of any registered crisis (loose or fallen), so it never counts as an ordinary empire here. */
export function isCrisisFaction(galaxy: Galaxy, e: Empire | null): boolean {
    if (e === null) return false;
    for (const entry of CRISIS_ENTRIES) if (peekThreatState<{ faction?: Empire | null }>(galaxy, entry.key)?.faction === e) return true;
    return false;
}

/** The ledger entries fade by 1 a year (the default 3 would erase a +5 in under two years). */
const REP_DECAY = 1;

function isNormal(galaxy: Galaxy, e: Empire | null): e is Empire {
    return e !== null && e.active && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null && !isCrisisFaction(galaxy, e);
}

/** The ordinary empires (no independents, pirates or crisis factions). */
export function crisisNormals(galaxy: Galaxy, except: Empire | null = null): Empire[] {
    return normalEmpires(galaxy, except).filter((e) => !isCrisisFaction(galaxy, e));
}

// ---------------------------------------------------------------------------------------------------------------
// 11. Opportunists
// ---------------------------------------------------------------------------------------------------------------

function recordHit(galaxy: Galaxy, entry: CrisisEntry, victim: Empire, kind: HitKind, habitat: Habitat): void {
    const st = crisisState(galaxy);
    const now = galaxyStarDate(galaxy);
    const window = P.windowDays(galaxy) * GAME_DAY_LENGTH;
    st.hits = st.hits.filter((h) => now - h.date <= window);
    st.harmed[entry.key] = true;
    if (st.hits.some((h) => h.key === entry.key && h.victim === victim.empireId)) return; // the first blow opens the window
    const atWar: number[] = [];
    for (const e of crisisNormals(galaxy, victim)) if (victim.diplomaticRelations.byEmpire(e)?.type === DiplomaticRelationType.War) atWar.push(e.empireId);
    st.hits.push({ key: entry.key, victim: victim.empireId, kind, place: habitat.name, habitat, date: now, atWar, reported: [] });
    if (st.hits.length > 60) st.hits.splice(0, st.hits.length - 60);
}

function whatText(hit: CrisisHit): string {
    return scenarioText(hit.kind === 'rising' ? 'Crisis What Rising' : hit.kind === 'invaded' ? 'Crisis What Invaded' : 'Crisis What Destroyed', hit.place);
}

/** `rival` moved against the victim of `hit` inside the window: both sides hear it, the galaxy gets a news line. */
function opportunist(galaxy: Galaxy, entry: CrisisEntry, hit: CrisisHit, rival: Empire, victim: Empire): void {
    if (hit.reported.includes(rival.empireId)) return;
    hit.reported.push(rival.empireId);
    ensureCrisisTexts();
    const what = whatText(hit);
    const title = scenarioText('Crisis Opportunist Title');
    const log = { category: 'war' as const, importance: 2 as const };
    scenarioMessage(galaxy, rival, title, scenarioText('Crisis Opportunist Aggressor', victim.name, entry.label, what), { type: EmpireMessageType.GeneralWarning, subject: hit.habitat ?? victim, log, popup: isHumanEmpire(galaxy, rival) });
    scenarioMessage(galaxy, victim, title, scenarioText('Crisis Opportunist Victim', rival.name, entry.label, what), { type: EmpireMessageType.GeneralBadEvent, subject: rival, log });
    scenarioNews(galaxy, null, scenarioText('Crisis Opportunist News', rival.name, entry.label, what, victim.name), (e) => e !== rival && e !== victim, hit.habitat ?? victim, log);
    // Profiting from it costs the rival a little regard with the empire it struck (reputation add-on only).
    if (reputationOn(galaxy)) {
        const st = crisisState(galaxy);
        const k = `crisis.opportunist.${entry.key}:${rival.empireId}`;
        if (!st.done[k]) {
            st.done[k] = true;
            applyReputation(galaxy, victim, rival, -P.repOpportunist(galaxy), { cause: `crisis.opportunist.${entry.key}`, labelKey: 'Reputation Cause crisis.opportunist', source: 'crisis', decayPerYear: REP_DECAY });
        }
    }
}

function onWarDeclared(galaxy: Galaxy, entry: CrisisEntry, rival: Empire, victim: Empire): void {
    const faction = crisisFaction(galaxy, entry);
    if (faction === null || rival === faction || victim === faction || !isNormal(galaxy, rival) || !isNormal(galaxy, victim)) return;
    const now = galaxyStarDate(galaxy);
    const window = P.windowDays(galaxy) * GAME_DAY_LENGTH;
    for (const hit of crisisState(galaxy).hits) {
        if (hit.key !== entry.key || hit.victim !== victim.empireId || now - hit.date > window || hit.atWar.includes(rival.empireId)) continue;
        opportunist(galaxy, entry, hit, rival, victim);
    }
}

/** The colony being handed over by agreement right now (Generation Ships' cession), if any: synchronous bookkeeping, never saved. */
let agreedColony: Habitat | null = null;

/**
 * Runs `transfer` (a colony changing hands by agreement, as an empire cedes a world to the Generation Ships): the ownership change
 * is not a rising, so it opens no hit and marks no harm (nobody takes advantage of a gift, and the crisis has hurt no one).
 */
export function agreedHandover<T>(colony: Habitat, transfer: () => T): T {
    const prev = agreedColony;
    agreedColony = colony;
    try {
        return transfer();
    } finally {
        agreedColony = prev;
    }
}

function onColonyOwnerChanged(galaxy: Galaxy, entry: CrisisEntry, colony: Habitat, from: Empire | null, to: Empire | null): void {
    const faction = crisisFaction(galaxy, entry);
    if (faction === null || to !== faction || !isNormal(galaxy, from) || colony === agreedColony) return;
    recordHit(galaxy, entry, from, 'rising', colony);
}

function onWarDamage(galaxy: Galaxy, entry: CrisisEntry, inflictor: Empire, victim: Empire, habitat: Habitat | null): void {
    const faction = crisisFaction(galaxy, entry);
    if (faction === null || habitat === null || inflictor !== faction || !isNormal(galaxy, victim)) return;
    recordHit(galaxy, entry, victim, habitat.hasBeenDestroyed ? 'destroyed' : 'invaded', habitat);
}

function onHabitatDestroyed(galaxy: Galaxy, entry: CrisisEntry, habitat: Habitat, destroyer: Empire | null): void {
    const faction = crisisFaction(galaxy, entry);
    if (faction === null || destroyer !== faction || habitat.population === null || habitat.population.totalAmount <= 0) return;
    const v = habitat.empire;
    if (isNormal(galaxy, v)) recordHit(galaxy, entry, v, 'destroyed', habitat);
}

// ---------------------------------------------------------------------------------------------------------------
// 10. Reputation for helping or ignoring
// ---------------------------------------------------------------------------------------------------------------

function fightRecord(galaxy: Galaxy, entry: CrisisEntry, e: Empire): FightRecord {
    const st = crisisState(galaxy);
    return (st.fight[`${entry.key}:${e.empireId}`] ??= { kills: 0, lost: 0, attacks: 0 });
}

function fightPoints(r: FightRecord): number {
    return r.kills * 2 + r.lost + Math.floor(r.attacks / 10);
}

function ownerOf(bo: { actualEmpire?: Empire | null; empire?: Empire | null }): Empire | null {
    return bo.actualEmpire ?? bo.empire ?? null;
}

function onKilledBy(galaxy: Galaxy, entry: CrisisEntry, bo: { actualEmpire?: Empire | null; empire?: Empire | null }, destroyer: Empire | null): void {
    if (!reputationOn(galaxy) || destroyer === null) return;
    const faction = crisisFaction(galaxy, entry);
    if (faction === null) return;
    const owner = ownerOf(bo);
    // Only a blow to an ordinary empire counts as harm: a faction that has only shot pirates (or independents) has hurt nobody, so the
    // council does not table it and nobody is marked down for sitting it out.
    if (destroyer === faction && owner !== faction && isNormal(galaxy, owner)) crisisState(galaxy).harmed[entry.key] = true;
    if (owner === faction && destroyer !== faction && isNormal(galaxy, destroyer)) fightRecord(galaxy, entry, destroyer).kills++;
    else if (destroyer === faction && owner !== faction && isNormal(galaxy, owner)) fightRecord(galaxy, entry, owner).lost++;
}

function onAttackedFaction(galaxy: Galaxy, entry: CrisisEntry, target: Empire | null, attacker: Empire | null): void {
    if (!reputationOn(galaxy) || attacker === null || target === null) return;
    const faction = crisisFaction(galaxy, entry);
    if (faction === null || target !== faction || attacker === faction || !isNormal(galaxy, attacker)) return;
    fightRecord(galaxy, entry, attacker).attacks++;
}

/** True when `a` and `b` have met (a relation other than NotMet). */
function met(a: Empire, b: Empire): boolean {
    const t = a.diplomaticRelations.byEmpire(b)?.type;
    return t !== undefined && t !== DiplomaticRelationType.NotMet;
}

/** Whether any asset of the faction lies within `radius` of one of `e`'s colonies. */
function factionNear(galaxy: Galaxy, faction: Empire, e: Empire, radius: number): boolean {
    const r2 = radius * radius;
    const spots: { xpos: number; ypos: number }[] = [...faction.colonies];
    let ships = 0;
    for (const b of faction.builtObjects) {
        if (b.hasBeenDestroyed) continue;
        spots.push(b);
        if (++ships >= 40) break;
    }
    for (const c of e.colonies) for (const s of spots) if (galaxy.calculateDistanceSquared(c.xpos, c.ypos, s.xpos, s.ypos) <= r2) return true;
    return false;
}

/** The regard of `others` (those that met `e`, not at war with it) for `e` changes by `value`. */
function regardFor(galaxy: Galaxy, e: Empire, faction: Empire, value: number, cause: string, labelKey: string): void {
    for (const x of crisisNormals(galaxy, e)) {
        if (x === faction || !met(x, e) || x.diplomaticRelations.byEmpire(e)?.type === DiplomaticRelationType.War) continue;
        applyReputation(galaxy, x, e, value, { cause, labelKey, source: 'crisis', decayPerYear: REP_DECAY });
    }
}

export function crisisYearly(galaxy: Galaxy, entry: CrisisEntry): void {
    const faction = crisisFaction(galaxy, entry);
    if (faction === null) {
        // The refugees' crowding fades on its own even when the crisis is over.
        const old = peekThreatState<CrisisState>(galaxy, 'crisis');
        if (old !== null && old.crowding.length > 0) old.crowding = old.crowding.filter((c) => c.until > galaxyStarDate(galaxy));
        return;
    }
    const st = crisisState(galaxy);
    const now = galaxyStarDate(galaxy);
    st.seen[entry.key] ??= now;
    st.crowding = st.crowding.filter((c) => c.until > now);
    if (!reputationOn(galaxy)) return;
    ensureCrisisTexts();
    const over = crisisOver(galaxy, entry);
    const radius = P.regionSectors(galaxy) * galaxy.sectorSize;
    const seenYears = (now - st.seen[entry.key]) / YEAR_LENGTH;
    for (const e of crisisNormals(galaxy, faction)) {
        const k = `${entry.key}:${e.empireId}`;
        const points = fightPoints(st.fight[k] ?? { kills: 0, lost: 0, attacks: 0 });
        const inRegion = factionNear(galaxy, faction, e, radius);
        st.near[k] = inRegion && st.harmed[entry.key] === true ? (st.near[k] ?? 0) + 1 : 0;
        if (points >= P.fightPoints(galaxy)) {
            const dk = `crisis.help.${entry.key}:${e.empireId}`;
            if (st.done[dk]) continue;
            st.done[dk] = true;
            regardFor(galaxy, e, faction, P.repHelp(galaxy), `crisis.help.${entry.key}`, 'Reputation Cause crisis.help');
            if (isHumanEmpire(galaxy, e)) scenarioMessage(galaxy, e, scenarioText('Crisis Rep Title'), scenarioText('Crisis Rep Helped', entry.label), { type: EmpireMessageType.GeneralGoodEvent, popup: false });
        } else if (points === 0 && !over && seenYears >= P.sitYears(galaxy) && (st.near[k] ?? 0) >= P.sitYears(galaxy)) {
            const dk = `crisis.sit.${entry.key}:${e.empireId}`;
            if (st.done[dk]) continue;
            st.done[dk] = true;
            regardFor(galaxy, e, faction, -P.repSit(galaxy), `crisis.sit.${entry.key}`, 'Reputation Cause crisis.sit');
            if (isHumanEmpire(galaxy, e)) scenarioMessage(galaxy, e, scenarioText('Crisis Rep Title'), scenarioText('Crisis Rep Sat', entry.label), { type: EmpireMessageType.GeneralWarning, popup: false });
        }
    }
    // The hit list only keeps what can still matter.
    const window = P.windowDays(galaxy) * GAME_DAY_LENGTH;
    st.hits = st.hits.filter((h) => now - h.date <= window);
}

// ---------------------------------------------------------------------------------------------------------------
// Registration: one handler set per crisis flag (each only looks at its own faction)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Adds a crisis after load (a hostile Giantworks wonder: the Beacon's Reclaimers, an awakened Ultramind): its handler set is
 * registered at once. Idempotent by key.
 */
export function addCrisisEntry(entry: CrisisEntry): void {
    if (CRISIS_ENTRIES.some((x) => x.key === entry.key)) return;
    CRISIS_ENTRIES.push(entry);
    registerCrisisEntry(entry);
}

function registerCrisisEntry(entry: CrisisEntry): void {
    const id = `crisis.${entry.key}`;
    registerScenarioEvent({ id: `${id}.warDeclared`, flag: entry.flag, order: 30, event: 'warDeclared', run: (g, e) => onWarDeclared(g, entry, e.empire, e.target) });
    registerScenarioEvent({ id: `${id}.owner`, flag: entry.flag, order: 30, event: 'colonyOwnerChanged', run: (g, e) => onColonyOwnerChanged(g, entry, e.colony, e.from, e.to) });
    registerScenarioEvent({ id: `${id}.damage`, flag: entry.flag, order: 30, event: 'warDamageInflicted', run: (g, e) => onWarDamage(g, entry, e.inflictor, e.victim, e.habitat) });
    registerScenarioEvent({ id: `${id}.destroyed`, flag: entry.flag, order: 30, event: 'habitatDestroyed', run: (g, e) => onHabitatDestroyed(g, entry, e.habitat, e.destroyer) });
    registerScenarioEvent({ id: `${id}.killed`, flag: entry.flag, order: 30, event: 'builtObjectKilledBy', run: (g, e) => onKilledBy(g, entry, e.builtObject, e.destroyer) });
    registerScenarioEvent({ id: `${id}.attacked`, flag: entry.flag, order: 30, event: 'builtObjectAttacked', run: (g, e) => onAttackedFaction(g, entry, ownerOf(e.builtObject), e.attackingEmpire) });
    registerScenarioEvent({ id: `${id}.habitatAttacked`, flag: entry.flag, order: 30, event: 'habitatAttacked', run: (g, e) => onAttackedFaction(g, entry, e.habitat.empire, e.attackingEmpire) });
    registerScenarioYearly({ id: `${id}.yearly`, flag: entry.flag, order: 30, run: (g) => crisisYearly(g, entry) });
}

export function registerCrisisInteractions(): void {
    for (const entry of CRISIS_ENTRIES) registerCrisisEntry(entry);
}

registerCrisisInteractions();
