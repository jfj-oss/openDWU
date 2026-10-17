// Giantworks: saved state, parameters and small shared helpers. Not a port.
//
// The state bag is galaxy.scenario.state.giantworks (plain objects + graph references; no classes). Rnd policy: nothing in
// this add-on draws galaxy.rnd except through the stock functions it calls from its own gated handlers (createEmpireMidGame,
// createNewDesigns, generateBuiltObjectName ...); every choice of its own (which wonder, founders' tie-breaks, hint decoys,
// convoy sizes, timing) draws from a Random seeded from the galaxy seed (ownRandom), never galaxy.rnd.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { Habitat } from '../../../types';
import type { BuiltObject } from '../../../builtObject';
import { Random } from '../../../random';
import { scenarioFlag, scenarioParam, scenarioState } from '../../state';
import { identifyShakturiEmpire } from '../../../diplomacyTick';
import { identifyMechanoidEmpire } from '../../../fleets/militaryAI';
import { rimTraderEmpire } from '../../rimTrade/common';
import { isCrisisFaction } from '../crisis';
import { normalEmpires, peekThreatState, type SentStages, type ThreatSite } from '../framework';
import type { GreatWorkSite } from './types';

export const GW_KEY = 'giantworks';
export const GW_FLAG = 'threatGiantworks';
/** Free text key prefix of the add-on's GameText. */
export const TAG = 'Giantworks';

export type GreatWorkPhase = 'seeded' | 'building' | 'complete' | 'destroyed' | 'abandoned';

/** One convoy of freighters (and escorts) on its way to the site. */
export interface GreatWorkConvoy {
    id: number;
    origin: Habitat;
    ships: BuiltObject[];
    escorts: BuiltObject[];
    /** The cargo hint this convoy carries (a hint tag). */
    tag: string;
    departed: number;
    /** Freighters that left, delivered, and were lost. */
    size: number;
    delivered: number;
    lost: number;
    /** Empire ids that have seen it (its manifest was read). */
    seen: number[];
}

/** What the sabotage events of this tick found (resolved by the periodic handler). */
export interface GreatWorkSabotage {
    by: Empire;
    date: number;
    caught: boolean;
    /** The DestroyBase mission killed the scaffold section (the base is rebuilt); false: construction sabotage. */
    kill: boolean;
}

/** The record of one Great Work. It is a GreatWorkSite (the wonders' contract) plus the framework's own fields. */
export interface GreatWorkRecord extends GreatWorkSite, ThreatSite {
    phase: GreatWorkPhase;
    /** The founding circles (founders is the flat list), and the pilgrim colonies made for wedges without independents. */
    circles: Habitat[][];
    pilgrims: Habitat[];
    /** The rumour went out. */
    rumoured: boolean;
    /** Empire ids that have seen the scaffold. */
    seenBy: number[];
    /** Armed escorts that arrived and stayed to guard the site. */
    guards: BuiltObject[];
    /** Star dates: the rumour and the Gathering (planned at game start). */
    rumourDate: number;
    gatherDate: number;
    /** Started from the Game Editor (no rumour; the first convoy leaves at once). */
    forced: boolean;
    /** Worlds that send convoys (the founders at the Gathering), progress per delivered freighter, and the schedule. */
    suppliers: Habitat[];
    perShip: number;
    nextDeparture: Record<string, number>;
    convoys: GreatWorkConvoy[];
    convoySeq: number;
    delivered: number;
    deliveredBy: Record<string, number>;
    lost: number;
    lastDelivery: number;
    /** empire id → the cargo hint tags that empire has learned. */
    tags: Record<string, string[]>;
    /** Candidates the Diet's inspections removed from every shortlist. */
    narrowed: number;
    /** empire id → Compact anger. */
    anger: Record<string, number>;
    /** empire id → days of warships on station; ids already thanked. */
    protectDays: Record<string, number>;
    protectors: number[];
    /** The empire that holds the finished wonder after seizing it (null: the Compact). */
    holder: Empire | null;
    /** The finished wonder turned hostile (its module says so): destroying or seizing it is no crime. */
    hostile: boolean;
    /** Resolved by the periodic handler. */
    sabotage: GreatWorkSabotage | null;
    attackedBy: { empire: Empire | null; date: number } | null;
    /** ship id → star date of the attack already counted on it; empire id → star date of the last Diet-law violation. */
    hits: Record<string, number>;
    violations: Record<string, number>;
    exposed: { empireId: number; date: number } | null;
    /** AI: empire id → next review date; chosen plan. */
    aiNext: Record<string, number>;
    aiPlan: Record<string, { action: string; since: number }>;
    scaffoldName: string;
    /** Set by the wonder modules, read by the renderer: the Sanctuary's whale count and whether it is breached, whether the Ultramind awoke. */
    whales?: number;
    breached?: boolean;
    awakened?: boolean;
}

/** galaxy.scenario.state.giantworks: `sites` is also what the station art reads (src/render/threatArt.ts GIANTWORKS_STATE_KEY). */
export interface GreatWorksState {
    sites: GreatWorkRecord[];
    nextId: number;
    /** The neutral faction that owns the scaffolds, convoys and finished wonders (created at the first Gathering). */
    compact: Empire | null;
    /** Counter for ownRandom draws that happen over time. */
    rolls: number;
    sent: SentStages;
    /** The game start has seeded the works (a Game Editor spawn does not need it). */
    seeded: boolean;
    stats: { convoys: number; freighters: number; delivered: number; lost: number; sabotaged: number; destroyed: number; completed: number; inspections: number };
    log: { date: number; text: string }[];
}

export function gwState(galaxy: Galaxy): GreatWorksState {
    return scenarioState<GreatWorksState>(galaxy, GW_KEY, () => ({
        sites: [],
        nextId: 1,
        compact: null,
        rolls: 0,
        sent: {},
        seeded: false,
        stats: { convoys: 0, freighters: 0, delivered: 0, lost: 0, sabotaged: 0, destroyed: 0, completed: 0, inspections: 0 },
        log: [],
    }));
}

/** The state if it exists (never creates it). */
export function peekGwState(galaxy: Galaxy): GreatWorksState | null {
    return peekThreatState<GreatWorksState>(galaxy, GW_KEY);
}

export function gwOn(galaxy: Galaxy): boolean {
    return scenarioFlag(galaxy, GW_FLAG);
}

/** The Compact (null until the first Gathering, or if no empire id was left). */
export function compactFaction(galaxy: Galaxy): Empire | null {
    const c = peekGwState(galaxy)?.compact ?? null;
    return c !== null && c.active ? c : null;
}

export function isCompact(galaxy: Galaxy, e: Empire | null): boolean {
    return e !== null && e === peekGwState(galaxy)?.compact;
}

/**
 * The ordinary empires: not the independents, pirates, the Compact, another threat's faction, the story factions or the
 * Concord (galaxy.empires order). Pure.
 */
export function ordinaryEmpires(galaxy: Galaxy): Empire[] {
    const mech = identifyMechanoidEmpire(galaxy);
    const shak = identifyShakturiEmpire(galaxy);
    const concord = rimTraderEmpire(galaxy);
    return normalEmpires(galaxy).filter((e) => e !== mech && e !== shak && e !== concord && !isCrisisFaction(galaxy, e) && !isCompact(galaxy, e));
}

/** Every record, in id order. Pure. */
export function greatWorks(galaxy: Galaxy): readonly GreatWorkRecord[] {
    return peekGwState(galaxy)?.sites ?? [];
}

/** The records still being built. Pure. */
export function buildingWorks(galaxy: Galaxy): GreatWorkRecord[] {
    return greatWorks(galaxy).filter((w) => w.phase === 'building');
}

/** The record whose scaffold / wonder base is `bo`, or null. Pure. */
export function workOfBase(galaxy: Galaxy, bo: BuiltObject | null): GreatWorkRecord | null {
    if (bo === null) return null;
    for (const w of greatWorks(galaxy)) if (w.base === bo) return w;
    return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Parameters (scenarios/giantworks/scenario.json; the defaults here are the same values)
// ---------------------------------------------------------------------------------------------------------------

const DEFAULTS = {
    giantworksCount: 0,
    giantworksBigGalaxyStars: 1400,
    giantworksExistChancePct: 100,
    giantworksFounderRangeSectors: 2,
    giantworksCapitalSectors: 4,
    giantworksRumourMinYear: 5,
    giantworksRumourMaxYear: 10,
    giantworksGatherMinYear: 15,
    giantworksGatherMaxYear: 30,
    giantworksGatherTech: 4,
    giantworksGatherFloorYear: 8,
    giantworksBuildYears: 5,
    giantworksConvoyDays: 180,
    giantworksConvoyMin: 3,
    giantworksConvoyMax: 6,
    giantworksEscorts: 1,
    giantworksMaxInFlight: 14,
    giantworksStallYears: 8,
    giantworksSiteMinCapitalSectors: 2,
    giantworksCompactCutPct: 20,
    giantworksIntlOwnerPct: 30,
    giantworksSabotageSetbackPct: 20,
    giantworksSabotageSmallPct: 6,
    giantworksSabotageCaughtRep: 4,
    giantworksProtectDays: 360,
    giantworksProtectRangeSectors: 1,
    giantworksProtectRep: 6,
    giantworksAngerAttack: 4,
    giantworksAngerDestroy: 80,
    giantworksAngerDecayPct: 20,
    giantworksDecoyPct: 15,
    giantworksHintsToSuspect: 2,
    giantworksShortlistMax: 3,
    giantworksInspectNarrows: 1,
    giantworksBeaconMinEmpires: 6,
    giantworksBeaconLatePct: 50,
    giantworksAiDecideDays: 90,
    giantworksAiDestroyMenacePct: 55,
    giantworksAiSabotageMenacePct: 35,
    giantworksAiReachSectors: 3,
    giantworksAiStrikeMarginPct: 150,
    giantworksAiProtectValuePct: 45,
} as const;

export type GwParamName = keyof typeof DEFAULTS;

export function gwParam(galaxy: Galaxy, name: GwParamName): number {
    return scenarioParam(galaxy, name, DEFAULTS[name]);
}

/** Convoy and AI cadence, in days (the periodic handler's period). */
export const PERIOD_DAYS = 10;

// ---------------------------------------------------------------------------------------------------------------
// The add-on's own random streams
// ---------------------------------------------------------------------------------------------------------------

/** A Random seeded from the galaxy seed and a salt (never galaxy.rnd, so the faithful draw stream is untouched). */
export function ownRandom(galaxy: Galaxy, salt: number): Random {
    return new Random(((galaxy.randomSeed ^ 0x67574b53 ^ Math.imul(salt, 0x9e3779b1)) >>> 1) & 0x7fffffff);
}

/** The next time-dependent stream of the game (a counter in the state, so a reload continues the same sequence). */
export function nextRandom(galaxy: Galaxy): Random {
    const st = gwState(galaxy);
    return ownRandom(galaxy, 1000 + st.rolls++);
}

export function logGw(galaxy: Galaxy, date: number, text: string): void {
    const st = gwState(galaxy);
    st.log.push({ date, text });
    if (st.log.length > 200) st.log.splice(0, st.log.length - 200);
}
