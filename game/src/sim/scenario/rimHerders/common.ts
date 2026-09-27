// Scenario package 19j "rim herders" (tasks/19-mod-layer-scenarios.md §19j) — the herder model, its saved state, params
// and the pure lookups the query hooks call. Not a port: herder colonies are ported independent colonies whose
// population is the scenario's Ossuvan race (trait "symbiotic"); their herds are 19g-7 RimHerds (rimFauna/common.ts)
// made docile through setRimHerdDocile. Nothing in this file draws galaxy.rnd (the draws live in rimHerders.ts, in the
// package's gated handlers).
//
// 19h hand-off: rimGuideAboard(galaxy, ship) — true when a herder guide rides this ship; 19h (shoals / fog) consumes it
// to reveal safe lanes. 19k-3 hand-off: herderColonies(galaxy) / herderColonyOf(galaxy, habitat) list the herder
// colonies and their herds, so independent leagues can pool herds.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { BuiltObject } from '../../builtObject';
import type { Race } from '../../data/races';
import type { Habitat } from '../../types';
import type { Character } from '../../characters';
import { CreatureType } from '../../creature';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { scenarioFlag, scenarioParam, scenarioState } from '../state';
import { peekRimFaunaState, type RimHerd } from '../rimFauna/common';

/** Flag name (scenarios/rim-herders/scenario.json). */
export const RIM_HERDERS_FLAG = 'rimHerders';
/** scenarioState key. */
export const RIM_HERDERS_STATE = 'rimHerders';
/** The herder race (scenarios/rim-herders/races/ossuvan.txt). */
export const HERDER_RACE = 'Ossuvan';

/**
 * Scenario race traits (the race files carry no trait field; a trait is a scenario rule keyed by race name).
 * "symbiotic": herds are docile to this race's colonies / ships, herder colonies harvest herd goods.
 */
export const RACE_TRAITS: Readonly<Record<string, readonly string[]>> = { [HERDER_RACE]: ['symbiotic'] };

export function raceHasTrait(race: Race | null | undefined, trait: string): boolean {
    return race != null && (RACE_TRAITS[race.name]?.includes(trait) ?? false);
}

/**
 * The creature-specific resources a herd yields — the kill drop (creatureKilled handler) and the herders' harvest use
 * the same ids. Data: scenarios/rim-herders/resources.txt. Only Kaltor herds exist (19g-7).
 */
export function creatureHarvestNames(type: CreatureType): readonly string[] {
    // A function, not a module-level table: CreatureType is read at call time (module cycles through game.ts).
    return type === CreatureType.Kaltor ? ['Kaltor Shell', 'Kaltor Crystal'] : [];
}

/** Manifest defaults (scenario.json) — the fallbacks of scenarioParam. */
export const RIM_HERDERS_PARAM_DEFAULTS = {
    rimHerdersShare: 0.5,
    /** 19a's rim inner radius (rimTrade/common.ts RIM_MIN_RADIUS). */
    rimHerdersRimInner: 0.72,
    rimHerdersHerdsPerColony: 1,
    rimHerdersHarvestDays: 90,
    rimHerdersHarvestPerMember: 4,
    rimHerdersStockCap: 1500,
    rimHerdersKillDrop: 10,
    rimHerdersContactRange: 600000,
    rimHerdersStandingGain: 10,
    rimHerdersStandingKill: 8,
    rimHerdersCharacterStanding: 20,
    rimHerdersLeaveStanding: 0,
    rimHerdersProtectYears: 3,
    rimHerdersTribute: 0.5,
    rimHerdersFeralYears: 5,
    rimHerdersFeralRange: 4,
    rimHerdersDefendRange: 30000,
    rimHerdersWarnDays: 30,
    rimHerdersCorridor: 60000,
    rimHerdersWarnPenalty: 15,
    rimHerdersConquestChance: 0.35,
} as const;

export type RimHerdersParam = keyof typeof RIM_HERDERS_PARAM_DEFAULTS;

export function herderParam(galaxy: Galaxy, name: RimHerdersParam): number {
    return scenarioParam(galaxy, name, RIM_HERDERS_PARAM_DEFAULTS[name]);
}

/** Standing lost by an empire that attacks a herder colony (once per attack) / conquers one. */
export const STANDING_ATTACK = 20;
export const STANDING_CONQUEST = 60;
/** A herd stays in defence of its colony this long after the last attack (game days). */
export const DEFEND_DAYS = 30;

export type HerderColonyStatus = 'free' | 'protectorate' | 'conquered' | 'lost';

/** One herder colony (saved; plain data and graph references). */
export interface HerderColony {
    colony: Habitat;
    /** RimHerd ids of this colony's herds (spawned in its home range, plus fauna herds born there). */
    herdIds: number[];
    status: HerderColonyStatus;
    /** Protectorate: the protector and the herder empire the colony became (-1 = none). */
    protectorId: number;
    herderEmpireId: number;
    /** Conquest: the conqueror and the star date the herds calm down (0 = not feral). */
    conquerorId: number;
    feralUntil: number;
    /** Empires this colony offered a protectorate (once each). */
    offered: number[];
    /** Star date an empire first had a colony within the contact range (by empireId). */
    neighbourSince: Record<number, number>;
    /** Herd defence: the last attacker and the star date the defence ends. */
    lastAttacker: BuiltObject | null;
    defendUntil: number;
    /** Migration warnings: the year warned and the empires warned. */
    warnYear: number;
    warned: number[];
    /** Empires the herds are aggressive toward (ignored warnings), until a star date. */
    hostile: { empireId: number; until: number }[];
}

export interface HerderCharacter {
    character: Character;
    kind: 'drover' | 'guide';
    empireId: number;
}

export interface RimHerdersStats {
    herderColonies: number;
    harvests: number;
    harvested: number;
    kills: number;
    dropped: number;
    defences: number;
    protectorates: number;
    conquests: number;
    tributes: number;
    warnings: number;
    warningsIgnored: number;
    charactersJoined: number;
    charactersLeft: number;
    herdingStolen: number;
    domesticated: number;
    conquestOrders: number;
}

/** Saved state (`scenarioState(galaxy, 'rimHerders')`). */
export interface RimHerdersState {
    colonies: HerderColony[];
    /** Herd kills (pruned yearly to the protect window). */
    kills: { herdId: number; systemIndex: number; empireId: number; date: number }[];
    /** Goodwill of the herders toward each empire (by empireId). */
    standing: Record<number, number>;
    characters: HerderCharacter[];
    /** Empires offered a drover and a guide (once each). */
    charactersOffered: number[];
    /** Empires holding the herding craft (stolen), and the game year each last domesticated a herd. */
    herding: number[];
    domesticatedYear: Record<number, number>;
    /** Tamed private ships (independent herder freighters). */
    tamed: BuiltObject[];
    rev: number;
    lastHarvest: number;
    lastWarnYear: number;
    lastSeasonYear: number;
    stats: RimHerdersStats;
}

export function rimHerdersState(galaxy: Galaxy): RimHerdersState {
    return scenarioState<RimHerdersState>(galaxy, RIM_HERDERS_STATE, () => ({
        colonies: [],
        kills: [],
        standing: {},
        characters: [],
        charactersOffered: [],
        herding: [],
        domesticatedYear: {},
        tamed: [],
        rev: 0,
        lastHarvest: -1,
        lastWarnYear: -1,
        lastSeasonYear: -1,
        stats: {
            herderColonies: 0, harvests: 0, harvested: 0, kills: 0, dropped: 0, defences: 0, protectorates: 0, conquests: 0, tributes: 0,
            warnings: 0, warningsIgnored: 0, charactersJoined: 0, charactersLeft: 0, herdingStolen: 0, domesticated: 0, conquestOrders: 0,
        },
    }));
}

/** The state if the package has run (never creates it: safe from pure query handlers). */
export function peekRimHerdersState(galaxy: Galaxy): RimHerdersState | null {
    const s = galaxy.scenario;
    if (s === null || !(RIM_HERDERS_STATE in s.state)) return null;
    return s.state[RIM_HERDERS_STATE] as RimHerdersState;
}

/** 19k-3: the herder colonies of this game (empty without the package). */
export function herderColonies(galaxy: Galaxy): readonly HerderColony[] {
    return peekRimHerdersState(galaxy)?.colonies ?? [];
}

export function herderColonyOf(galaxy: Galaxy, habitat: Habitat): HerderColony | null {
    return herderColonies(galaxy).find((c) => c.colony === habitat) ?? null;
}

/** Live herds of a herder colony (id order of herdIds). */
export function herderColonyHerds(galaxy: Galaxy, hc: HerderColony): RimHerd[] {
    const fs = peekRimFaunaState(galaxy);
    if (fs === null) return [];
    const out: RimHerd[] = [];
    for (const id of hc.herdIds) {
        const h = fs.herds.find((x) => x.id === id);
        if (h !== undefined && h.leader !== null) out.push(h);
    }
    return out;
}

/** The herder colony a herd belongs to (null: a wild herd). */
export function herderColonyOfHerd(galaxy: Galaxy, herd: RimHerd): HerderColony | null {
    return herderColonies(galaxy).find((c) => c.herdIds.includes(herd.id)) ?? null;
}

/** An empire run by the symbiotic race (a herder protectorate); the independent empire never counts. */
export function isHerderEmpire(galaxy: Galaxy, e: Empire | null): boolean {
    return e !== null && e !== galaxy.independentEmpire && raceHasTrait(e.dominantRace, 'symbiotic');
}

/** Resource ids of a creature type's harvest goods present in this galaxy's data. */
export function harvestResourceIds(galaxy: Galaxy, type: CreatureType | null = null): number[] {
    const names = creatureHarvestNames(type ?? CreatureType.Kaltor);
    const out: number[] = [];
    for (const n of names) {
        const r = galaxy.resourceSystem.resources.find((x) => x != null && x.name === n);
        if (r !== undefined) out.push(r.resourceId);
    }
    return out;
}

/** 19a plug: herd goods count as rim goods for the Concord when both flags are on. */
export function herdRimGoods(galaxy: Galaxy): number[] {
    if (!scenarioFlag(galaxy, RIM_HERDERS_FLAG) || !scenarioFlag(galaxy, 'rimTrader')) return [];
    return harvestResourceIds(galaxy);
}

/** Current standing of the herders toward an empire. */
export function herderStanding(galaxy: Galaxy, empireId: number): number {
    return peekRimHerdersState(galaxy)?.standing[empireId] ?? 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Pure query-hook bodies (never draw, never write)
// ---------------------------------------------------------------------------------------------------------------

/** Private freighters and mining ships (a function: enums read at call time, module cycles through game.ts). */
function isPrivateTamedSubRole(r: BuiltObjectSubRole): boolean {
    return (
        r === BuiltObjectSubRole.SmallFreighter ||
        r === BuiltObjectSubRole.MediumFreighter ||
        r === BuiltObjectSubRole.LargeFreighter ||
        r === BuiltObjectSubRole.GasMiningShip ||
        r === BuiltObjectSubRole.MiningShip
    );
}

const tamedCache = new WeakMap<Galaxy, { rev: number; list: BuiltObject[]; set: Set<BuiltObject> }>();

/**
 * Living infrastructure: a tamed creature — an independent herder colony's freighter (tagged in state), or a private
 * freighter / mining ship of a herder empire. Storm-immune and self-fuelling.
 */
export function isTamedCreatureShip(galaxy: Galaxy, bo: BuiltObject): boolean {
    const st = peekRimHerdersState(galaxy);
    if (st === null) return false;
    let c = tamedCache.get(galaxy);
    if (c === undefined || c.rev !== st.rev || c.list !== st.tamed) {
        c = { rev: st.rev, list: st.tamed, set: new Set(st.tamed) };
        tamedCache.set(galaxy, c);
    }
    if (c.set.has(bo)) return true;
    return isPrivateTamedSubRole(bo.subRole) && isHerderEmpire(galaxy, bo.empire) && bo.empire!.privateBuiltObjects.includes(bo);
}

/** Empires a herd is aggressive toward right now: its colony's conqueror while feral, and ignored warnings. */
export function herdHostileEmpireIds(galaxy: Galaxy, hc: HerderColony, now: number): number[] {
    const out: number[] = [];
    if (hc.status === 'conquered' && hc.feralUntil > now && hc.conquerorId >= 0) out.push(hc.conquerorId);
    for (const h of hc.hostile) if (h.until > now && !out.includes(h.empireId)) out.push(h.empireId);
    return out;
}

/** A drover rides with this ship (on it, or on a ship of its fleet). */
export function droverWithShip(galaxy: Galaxy, bo: BuiltObject): boolean {
    const st = peekRimHerdersState(galaxy);
    if (st === null || st.characters.length === 0) return false;
    for (const hc of st.characters) {
        if (hc.kind !== 'drover' || !hc.character.active || hc.character.empire !== bo.empire) continue;
        const loc = hc.character.location as BuiltObject | null;
        if (loc === null) continue;
        if (loc === bo) return true;
        if (bo.shipGroup !== null && (loc as { shipGroup?: unknown }).shipGroup === bo.shipGroup) return true;
    }
    return false;
}

/** 19h hand-off: a herder guide rides this ship (19h reveals shoals / fog lanes around it). */
export function rimGuideAboard(galaxy: Galaxy, ship: BuiltObject): boolean {
    const st = peekRimHerdersState(galaxy);
    if (st === null) return false;
    return st.characters.some((c) => c.kind === 'guide' && c.character.active && c.character.location === ship && c.character.empire === ship.empire);
}
