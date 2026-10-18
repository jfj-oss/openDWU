// The six combat changes after BVR combat (scenarios/decoys-chaff, ambush-strike, critical-hits, damage-control, armour-facing,
// surrender-wrecks): shared flags, params and saved state. Not a port. Every flag is its own opt-in Gameplay change; with all of
// them off nothing here runs, draws galaxy.rnd or creates state, and every hook in the combat code is one comparison.
//
// Module cycles: this module imports only types and scenario/state.ts, so the combat modules (damage.ts, weapons.ts, ...) and the
// feature modules can all import it. Registrations in the feature modules use literal flag names (see bvrAI.ts).

import type { Galaxy } from '../../galaxy';
import type { BuiltObject } from '../../builtObject';
import { scenarioFlag, scenarioParam, scenarioState } from '../state';

export const DECOYS_FLAG = 'decoys';
export const DECOYS_AI_FLAG = 'decoysAI';
export const AMBUSH_FLAG = 'ambush';
export const AMBUSH_AI_FLAG = 'ambushAI';
export const CRITICALS_FLAG = 'criticalHits';
export const DAMAGE_CONTROL_FLAG = 'damageControl';
export const FACING_FLAG = 'armourFacing';
export const FACING_AI_FLAG = 'facingAI';
export const SURRENDER_FLAG = 'surrender';
export const WRECKS_FLAG = 'surrenderWrecks';

/** Add-on ids (scenarios/<id>). */
export const DECOYS_ADDON_ID = 'decoys-chaff';
export const AMBUSH_ADDON_ID = 'ambush-strike';
export const CRITICALS_ADDON_ID = 'critical-hits';
export const DAMAGE_CONTROL_ADDON_ID = 'damage-control';
export const FACING_ADDON_ID = 'armour-facing';
export const SURRENDER_ADDON_ID = 'surrender-wrecks';

/** Defaults of the scenario.json params (the fallbacks of c2Param). */
export const C2_DEFAULTS = {
    // decoys
    decoyCharges: 3,
    decoyChancePct: 50,
    decoyTorpedoPct: 50,
    decoyCooldownSeconds: 5,
    decoyRange: 1600,
    decoyRestockSeconds: 4,
    decoyCostPct: 6,
    decoyAiExtraEcm: 1,
    // ambush
    ambushSeconds: 10,
    ambushQuietSeconds: 20,
    ambushAccuracyPct: 35,
    ambushDamagePct: 50,
    ambushAiOddsPct: 25,
    // critical hits
    critChancePct: 30,
    critEngineSlowPct: 30,
    critReactorSlowPct: 35,
    critCommandMissPct: 20,
    critMaxStack: 3,
    critAiCautionPct: 12,
    // damage control
    dcSecondsPerRepair: 60,
    dcCrewBonusPct: 20,
    dcVeteranBonusPct: 25,
    dcMaxDamagedPct: 70,
    // armour facing
    facingBowPct: 75,
    facingFlankPct: 110,
    facingRearPct: 140,
    facingArcDegrees: 60,
    facingFlankSpeedPct: 130,
    facingFlankSeconds: 25,
    // surrender
    surrenderHealthPct: 45,
    surrenderOddsPct: 150,
    surrenderChancePct: 30,
    surrenderCaptureSeconds: 20,
    surrenderCaptureRange: 900,
    surrenderTimeoutDays: 120,
    // wrecks (the wreckage package's own params keep their defaults there; wreckSystemCap is new)
    wreckSystemCap: 12,
} as const;
export type C2Param = keyof typeof C2_DEFAULTS;

export function c2Param(galaxy: Galaxy, name: C2Param): number {
    return scenarioParam(galaxy, name, C2_DEFAULTS[name]);
}

export const decoysOn = (g: Galaxy): boolean => g.scenario !== null && scenarioFlag(g, DECOYS_FLAG);
export const decoysAiOn = (g: Galaxy): boolean => g.scenario !== null && scenarioFlag(g, DECOYS_FLAG) && scenarioFlag(g, DECOYS_AI_FLAG);
export const ambushOn = (g: Galaxy): boolean => g.scenario !== null && scenarioFlag(g, AMBUSH_FLAG);
export const ambushAiOn = (g: Galaxy): boolean => g.scenario !== null && scenarioFlag(g, AMBUSH_FLAG) && scenarioFlag(g, AMBUSH_AI_FLAG);
export const criticalsOn = (g: Galaxy): boolean => g.scenario !== null && scenarioFlag(g, CRITICALS_FLAG);
export const damageControlOn = (g: Galaxy): boolean => g.scenario !== null && scenarioFlag(g, DAMAGE_CONTROL_FLAG);
export const facingOn = (g: Galaxy): boolean => g.scenario !== null && scenarioFlag(g, FACING_FLAG);
export const facingAiOn = (g: Galaxy): boolean => g.scenario !== null && scenarioFlag(g, FACING_FLAG) && scenarioFlag(g, FACING_AI_FLAG);
export const surrenderOn = (g: Galaxy): boolean => g.scenario !== null && scenarioFlag(g, SURRENDER_FLAG);
/** Wrecks and salvage of the surrender change (its own sub-switch, under the master). */
export const wrecksOn = (g: Galaxy): boolean => g.scenario !== null && scenarioFlag(g, SURRENDER_FLAG) && scenarioFlag(g, WRECKS_FLAG);
/** True when any of the six is on (the cheap guard of the shared hooks). */
export const anyCombat2On = (g: Galaxy): boolean => {
    const s = g.scenario;
    if (s === null) return false;
    const f = s.flags;
    return f[DECOYS_FLAG] === true || f[AMBUSH_FLAG] === true || f[CRITICALS_FLAG] === true || f[DAMAGE_CONTROL_FLAG] === true || f[FACING_FLAG] === true || f[SURRENDER_FLAG] === true;
};

// ---------------------------------------------------------------------------------------------------------------
// State (scenario.state.combat2, created on first use; Maps keyed by ship hold only ships with something to record)
// ---------------------------------------------------------------------------------------------------------------

/** A ship's decoys spent since it last restocked (absent = full), the next launch time and the restock progress. */
export interface DecoyPool {
    spent: number;
    /** galaxy.nowMs before which the ship cannot launch another decoy. */
    nextMs: number;
    /** Game seconds loaded towards the next decoy. */
    progress: number;
}

/** An ambush window: the last time the ship fired and the time its ambush lasts until. */
export interface AmbushRec {
    lastFire: number;
    until: number;
}

/** Stacked critical effects on a ship (each 0..critMaxStack). */
export interface CritRec {
    engine: number;
    reactor: number;
    command: number;
}

/** A ship that has struck its colours. */
export interface StruckRec {
    sinceMs: number;
    /** The empire most of the fire came from (-1 none). */
    toEmpireId: number;
    /** The armed enemy standing by to take it, and since when (0 = none). */
    captor: BuiltObject | null;
    captureStartMs: number;
}

/** A fast ship circling a slower target for a flank attack. */
export interface FlankRec {
    until: number;
    /** +1 / -1: the side it circles to. */
    sign: number;
}

export interface Combat2Stats {
    decoysLaunched: number;
    decoysDiverted: number;
    decoysRestocked: number;
    decoysRestockCost: number;
    ambushOpened: number;
    ambushTurnedHits: number;
    ambushDamage: number;
    critEngine: number;
    critReactor: number;
    critCommand: number;
    critMisses: number;
    dcRepairs: number;
    facingBow: number;
    facingFlank: number;
    facingRear: number;
    facingTurns: number;
    flankStarted: number;
    struck: number;
    captured: number;
    recovered: number;
    wrecksCulled: number;
    wreckPeak: number;
}

export interface Combat2State {
    decoys: Map<BuiltObject, DecoyPool>;
    ambush: Map<BuiltObject, AmbushRec>;
    crits: Map<BuiltObject, CritRec>;
    /** Game seconds of crew repair progress, by ship. */
    dc: Map<BuiltObject, number>;
    struck: Map<BuiltObject, StruckRec>;
    /** galaxy.nowMs before which a ship that took its crew back will not surrender again. */
    calm: Map<BuiltObject, number>;
    flank: Map<BuiltObject, FlankRec>;
    /** galaxy.nowMs of the last decoy restock tick. */
    decoyTickMs?: number;
    stats: Combat2Stats;
}

function newStats(): Combat2Stats {
    return {
        decoysLaunched: 0, decoysDiverted: 0, decoysRestocked: 0, decoysRestockCost: 0,
        ambushOpened: 0, ambushTurnedHits: 0, ambushDamage: 0,
        critEngine: 0, critReactor: 0, critCommand: 0, critMisses: 0,
        dcRepairs: 0, facingBow: 0, facingFlank: 0, facingRear: 0, facingTurns: 0, flankStarted: 0,
        struck: 0, captured: 0, recovered: 0, wrecksCulled: 0, wreckPeak: 0,
    };
}

export function c2State(galaxy: Galaxy): Combat2State {
    return scenarioState<Combat2State>(galaxy, 'combat2', () => ({
        decoys: new Map(),
        ambush: new Map(),
        crits: new Map(),
        dc: new Map(),
        struck: new Map(),
        calm: new Map(),
        flank: new Map(),
        stats: newStats(),
    }));
}

/** The state if it exists (never creates it). */
export function peekC2State(galaxy: Galaxy): Combat2State | undefined {
    return galaxy.scenario === null ? undefined : (galaxy.scenario.state.combat2 as Combat2State | undefined);
}

/** Drops the entries of destroyed ships from every map (frame-periodic; keeps the state from growing over a long war). */
export function c2Prune(galaxy: Galaxy): void {
    const st = peekC2State(galaxy);
    if (st === undefined) return;
    for (const m of [st.decoys, st.ambush, st.crits, st.dc, st.struck, st.calm, st.flank] as Map<BuiltObject, unknown>[]) {
        for (const bo of m.keys()) if (bo.hasBeenDestroyed) m.delete(bo);
    }
    // An ambush record of a ship that has been quiet for twice the opening quiet time (and whose window is over) is dropped: a new shot would
    // open a fresh ambush anyway, so only ships that fired lately stay in the map (it would otherwise hold every ship that ever fought).
    const quiet = c2Param(galaxy, 'ambushQuietSeconds') * 2000;
    for (const [bo, rec] of st.ambush) if (galaxy.nowMs > rec.until + 3000 && galaxy.nowMs - rec.lastFire > quiet) st.ambush.delete(bo);
    // A ship that was captured or scrapped is no longer one that struck (its owner changed): drop a struck mark whose ship left the war.
    for (const [bo, rec] of st.struck) if (rec.captor !== null && rec.captor.hasBeenDestroyed) rec.captor = null;
}
