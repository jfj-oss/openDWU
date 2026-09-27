// Scenario package 19e-7 "battle wreckage & salvage" (tasks/19-mod-layer-scenarios.md §19e item 7) — the wreck records,
// the debris fields they cluster into, their saved state, params and the pure queries other packages read. Not a port:
// the field's map presence reuses the original's debris-field object (GalaxyLocation type DebrisField, as Galaxy.5.cs
// 3515 GenerateDebrisField builds it for the Distant Worlds story), so it gets the stock name label, discovery,
// sell-info and AI guard handling; the wrecks themselves are records, not BuiltObjects. Nothing here draws galaxy.rnd.
//
// Consumers (19g-7b Scavenger creature, 19f-7 Ghost Armada): wrecksAt / wreckFields / takeWrecks / wreckRemaining.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { BuiltObject } from '../../builtObject';
import { GalaxyLocation, GalaxyLocationType } from '../../galaxyLocation';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { YEAR_LENGTH } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { scenarioParam } from '../state';
import { scenarioText } from '../messages';

/** Flag name (scenarios/wreckage-salvage/scenario.json). */
export const WRECKAGE_FLAG = 'wreckage';
/** scenarioState key. */
export const WRECKAGE_STATE = 'wreckage';

/** Manifest defaults (scenario.json) — the fallbacks of scenarioParam. */
export const WRECKAGE_PARAM_DEFAULTS = {
    /** A wreck's salvage value falls linearly to 0 over this many years; then it is gone. */
    wreckDecayYears: 10,
    /** A new wreck joins the nearest field whose centre is within this radius; otherwise it starts a field. */
    wreckFieldJoinRadius: 4000,
    /** Field extent (GalaxyLocation width / height; Galaxy.5.cs 3519-3520 rolls 1100-1500 for the story fields). */
    wreckFieldSize: 1300,
    /** Fraction of a wreck's build resources (components.txt resource costs) a salvage trip recovers. */
    wreckSalvageFraction: 0.3,
    /** Wrecks a salvage trip takes (most valuable first). */
    wreckSalvageWrecksPerTrip: 3,
    /** Game days a salvager spends on site before the recovery (checked every long block ≈ 36 days). */
    wreckSalvageDays: 30,
    /** Chance per salvage trip of recovering a foreign research project from the wrecks. */
    wreckTechChance: 0.2,
    /** AI: an idle construction ship salvages a known field within this distance. */
    wreckAiSalvageRange: 400000,
    /** AI: smallest remaining field value worth a trip. */
    wreckAiMinValue: 200,
    /** Wrecks that make a field "big" (pirates' base of operations). */
    wreckBigFieldShips: 5,
    /** Pirates: range around a big field where raid targets' raid countdown recovers faster. */
    wreckPirateRaidRange: 150000,
    /** Pirates: the raid-countdown recovery multiplier there. */
    wreckPirateRaidBoost: 2,
} as const;

export type WreckageParam = keyof typeof WRECKAGE_PARAM_DEFAULTS;

export function wreckParam(galaxy: Galaxy, name: WreckageParam): number {
    return scenarioParam(galaxy, name, WRECKAGE_PARAM_DEFAULTS[name]);
}

/** A destroyed ship / base (plain data; saved). */
export interface WreckRecord {
    id: number;
    /** BuiltObject.BuiltObjectID of the destroyed object. */
    builtObjectId: number;
    name: string;
    designName: string;
    /** BuiltObjectRole / BuiltObjectSubRole of the design. */
    role: number;
    subRole: number;
    /** Empire.EmpireId of the owner (-1: unowned); the name as it was. */
    ownerEmpireId: number;
    ownerName: string;
    x: number;
    y: number;
    size: number;
    /** Component ids of every built component (normal or damaged). */
    componentIds: number[];
    /** Full build resources of those components (components.txt resource pairs, ComponentDefinition.resourceRequirements). */
    resources: { resourceId: number; amount: number }[];
    /** Purchase price when destroyed (BuiltObject.PurchasePrice), else the resource total. */
    value: number;
    /** Star date of the destruction. */
    starDate: number;
}

/** A debris field: the wreck records near one point, with the original's debris-field location as its map presence. */
export interface WreckField {
    id: number;
    name: string;
    /** GalaxyLocation type DebrisField (in galaxy.galaxyLocations while the field exists). */
    location: GalaxyLocation;
    /** Centre. */
    x: number;
    y: number;
    /** System of the nearest star (its name names the field). */
    systemIndex: number;
    wrecks: WreckRecord[];
    createdStarDate: number;
}

export type SalvagePhase = 'travel' | 'return';

/** A salvage mission in progress (the ship flies a MoveAndWait; the periodic tick advances it). */
export interface SalvageJob {
    ship: BuiltObject;
    empireId: number;
    fieldId: number;
    phase: SalvagePhase;
    startStarDate: number;
    /** Star date the ship was first seen inside the field (-1: not yet). */
    arrivedStarDate: number;
    /** The return leg's port (null in the travel phase). */
    port: BuiltObject | null;
    /** What the trip loaded (unloaded at the port). */
    cargo: { resourceId: number; amount: number }[];
    manual: boolean;
}

export interface WreckageState {
    nextWreckId: number;
    nextFieldId: number;
    fields: WreckField[];
    jobs: SalvageJob[];
    stats: { wrecks: number; fieldsCreated: number; fieldsDecayed: number; salvageTrips: number; techsRecovered: number; resourcesRecovered: number };
}

/** The package state (null when the game has none yet — reading never creates it, so flag-off games stay untouched). */
export function peekWreckageState(galaxy: Galaxy): WreckageState | null {
    const s = galaxy.scenario;
    if (s === null || !(WRECKAGE_STATE in s.state)) return null;
    return s.state[WRECKAGE_STATE] as WreckageState;
}

/** The package state, created on first use (flag-on code paths only). */
export function wreckageState(galaxy: Galaxy): WreckageState {
    const s = galaxy.scenario;
    if (s === null) throw new Error('wreckageState: no scenario in this game');
    if (!(WRECKAGE_STATE in s.state)) {
        const init: WreckageState = {
            nextWreckId: 1,
            nextFieldId: 1,
            fields: [],
            jobs: [],
            stats: { wrecks: 0, fieldsCreated: 0, fieldsDecayed: 0, salvageTrips: 0, techsRecovered: 0, resourcesRecovered: 0 },
        };
        s.state[WRECKAGE_STATE] = init;
    }
    return s.state[WRECKAGE_STATE] as WreckageState;
}

/** Every debris field (empty without the package). */
export function wreckFields(galaxy: Galaxy): readonly WreckField[] {
    return peekWreckageState(galaxy)?.fields ?? [];
}

export function wreckFieldById(galaxy: Galaxy, id: number): WreckField | null {
    return wreckFields(galaxy).find((f) => f.id === id) ?? null;
}

/** 0-1: how much of a wreck is left at `starDate` (linear decay over wreckDecayYears). */
export function wreckRemaining(galaxy: Galaxy, w: WreckRecord, starDate = galaxyStarDate(galaxy)): number {
    const span = wreckParam(galaxy, 'wreckDecayYears') * YEAR_LENGTH;
    if (!(span > 0)) return 0;
    return Math.max(0, Math.min(1, 1 - (starDate - w.starDate) / span));
}

/** Remaining value of a field (decayed wreck values). */
export function wreckFieldValue(galaxy: Galaxy, f: WreckField, starDate = galaxyStarDate(galaxy)): number {
    let v = 0;
    for (const w of f.wrecks) v += w.value * wreckRemaining(galaxy, w, starDate);
    return Math.round(v);
}

/** A wreck plus its field (wrecksAt results). */
export interface WreckHit {
    wreck: WreckRecord;
    field: WreckField;
    distance: number;
}

/**
 * Query for other packages (19g-7b Scavenger, 19f-7 Ghost Armada): every wreck within `r` of (x, y), nearest first.
 * Pure; empty when the game has no wreckage state.
 */
export function wrecksAt(galaxy: Galaxy, x: number, y: number, r: number): WreckHit[] {
    const out: WreckHit[] = [];
    for (const field of wreckFields(galaxy)) {
        // A field's wrecks lie within its join radius of the centre: skip far fields cheaply.
        const fd = galaxy.calculateDistance(x, y, field.x, field.y);
        if (fd > r + wreckParam(galaxy, 'wreckFieldJoinRadius') + field.location.width) continue;
        for (const wreck of field.wrecks) {
            const d = galaxy.calculateDistance(x, y, wreck.x, wreck.y);
            if (d <= r) out.push({ wreck, field, distance: d });
        }
    }
    out.sort((a, b) => a.distance - b.distance || a.wreck.id - b.wreck.id);
    return out;
}

/** The field whose extent contains (x, y) (the location rectangle, widened to at least `slack` around the centre). */
export function wreckFieldAtPoint(galaxy: Galaxy, x: number, y: number, slack = 0): WreckField | null {
    let best: WreckField | null = null;
    let bestD = Number.MAX_VALUE;
    for (const f of wreckFields(galaxy)) {
        const half = Math.max(f.location.width / 2, slack);
        if (Math.abs(x - f.x) > half || Math.abs(y - f.y) > half) continue;
        const d = galaxy.calculateDistance(x, y, f.x, f.y);
        if (d < bestD) {
            best = f;
            bestD = d;
        }
    }
    return best;
}

/** True when `empire` knows the field: it is in its known locations (stock discovery / own losses) or its system is explored. */
export function wreckFieldKnownTo(empire: Empire, f: WreckField): boolean {
    if (empire.visibility.knownGalaxyLocations.includes(f.location)) return true;
    return f.systemIndex >= 0 && empire.visibility.checkSystemExplored(f.systemIndex);
}

/** Ships that may salvage: construction ships and (gas) mining ships (no cheap new sub-role exists in the design system). */
export function isSalvageShip(ship: BuiltObject): boolean {
    return ship.subRole === BuiltObjectSubRole.ConstructionShip || ship.subRole === BuiltObjectSubRole.MiningShip || ship.subRole === BuiltObjectSubRole.GasMiningShip;
}

/** The salvage job `ship` is on (null: none). */
export function salvageJobOf(galaxy: Galaxy, ship: BuiltObject): SalvageJob | null {
    return peekWreckageState(galaxy)?.jobs.find((j) => j.ship === ship) ?? null;
}

/**
 * Remove `wrecks` from their fields (a consumer took them: salvage, a scavenger eating them, a ghost fleet rising).
 * Fields left empty are removed with their map location. Returns the removed records.
 */
export function takeWrecks(galaxy: Galaxy, wrecks: readonly WreckRecord[]): WreckRecord[] {
    const st = peekWreckageState(galaxy);
    if (st === null) return [];
    const taken: WreckRecord[] = [];
    const ids = new Set(wrecks.map((w) => w.id));
    for (const f of [...st.fields]) {
        const keep: WreckRecord[] = [];
        for (const w of f.wrecks) (ids.has(w.id) ? taken : keep).push(w);
        if (keep.length !== f.wrecks.length) {
            f.wrecks = keep;
            if (keep.length === 0) removeWreckField(galaxy, f);
        }
    }
    return taken;
}

/** Hook set by wreckage.ts (removing a location needs events.ts; kept out of this pure module's import graph). */
export const wreckageHooks: { removeLocation: ((galaxy: Galaxy, location: GalaxyLocation) => void) | null } = { removeLocation: null };

/** Drops a field: its location leaves the map (and every empire's known list). */
export function removeWreckField(galaxy: Galaxy, f: WreckField): void {
    const st = peekWreckageState(galaxy);
    if (st === null) return;
    const i = st.fields.indexOf(f);
    if (i >= 0) st.fields.splice(i, 1);
    f.location.showName = false; // a region label the view built earlier stops drawing it
    wreckageHooks.removeLocation?.(galaxy, f.location);
    // Salvagers still on their way are released by the next periodic tick (wreckage.ts salvageJobsTick).
}

/** A new field centred on (x, y): the original's DebrisField location (Galaxy.5.cs 3515-3524: named, showName, indexed). */
export function createWreckField(galaxy: Galaxy, x: number, y: number): WreckField {
    const st = wreckageState(galaxy);
    const star = galaxy.fastFindNearestSystem(x, y);
    const base = scenarioText('Scenario Wreckage Field Name', star?.name ?? '');
    let name = base;
    for (let n = 2; st.fields.some((f) => f.name === name) || galaxy.galaxyLocations.some((l) => l.name === name); n++) name = `${base} ${n}`;
    const size = wreckParam(galaxy, 'wreckFieldSize');
    const location = new GalaxyLocation(name, GalaxyLocationType.DebrisField, x - size / 2, y - size / 2, size, size, -1);
    location.showName = true;
    galaxy.galaxyLocations.push(location);
    galaxy.addGalaxyLocationIndex(location);
    const c = location.resolveLocationCenter();
    const field: WreckField = { id: st.nextFieldId++, name, location, x: c.x, y: c.y, systemIndex: star?.systemIndex ?? -1, wrecks: [], createdStarDate: galaxyStarDate(galaxy) };
    st.fields.push(field);
    st.stats.fieldsCreated++;
    return field;
}

/** One-line summary for UI (name, wrecks, value). */
export function wreckFieldSummary(galaxy: Galaxy, f: WreckField): { name: string; ships: number; value: number } {
    return { name: f.name, ships: f.wrecks.length, value: wreckFieldValue(galaxy, f) };
}
