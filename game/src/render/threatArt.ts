// Threat looks (render only): the Generation Ships' centuries-old fleets, the Dead Probe Swarm's and the Purifier's art,
// and Giantworks' Great Work (its scaffold stages and finished wonders: see the Giantworks section at the end).
//
// They draw bundled frames of our own (derived from stock pieces by offline scripts). Factions and sites are found
// through the threats' scenario state (genShipsStates / peekProbeSwarmState / peekPurifierState / greatWorkSites: read
// only, never created), never by name.
//
// - Generation ships ("the old colony fleet"): the world ship (whoever holds it) and the factions' warships, troop
//   transports, scouts, colony, construction and civilian ships — including the big slow ships a settled faction
//   keeps building — draw our
//   bundled gunmetal-and-rust frames (public/art/generation-ships/, scripts/generation-ships-ships.py: stock Human and
//   industrial pieces kitbashed with strapped tanks, bunker-slit bows and round engine bells), picked by subRole
//   (genShipsArtUrl). Small red positional lights blink at their hull extremities (GenShipsFxLayer; frame px in
//   genShipsLights.ts, written by the same script), each ship on its own phase. The factions' bases keep their stock frames and wear the 19r wear layer (liveryLayer.ts) forced to its oldest bucket
//   with a few old scars, under a faded, yellowed sprite tint. The world ship is drawn WORLD_SHIP_VISUAL_SCALE × its
//   stock size (the drawn size feeds picking, the selection ring and the ambient exhaust, so all stay consistent).
// - Probe swarm: every swarm hull draws our bundled dark-slate derelict frames (public/art/probe-swarm/,
//   scripts/probe-swarm-ships.py: new silhouettes kitbashed from stock pieces, one per role) instead of its race's art;
//   picked by role (swarmArtUrl), render only. The Mothercore (a spiked machine cube) is drawn larger, with the dim red
//   light of its seams slowly swelling and orange positional lights blinking at its corners (SwarmFxLayer, pooled
//   additive sprites).
// - The Purifier: its escorts, guards and repair station draw our bundled battle-worn war-forged frames in
//   the planet destroyer's own metal (stock hulls meshed into new ships, antennas whose tip lights are stock
//   nav-light markers), the dock (base_1) a half-ruined shipyard (public/art/purifier/, scripts/purifier-ships.py)
//   instead of their race's art; the Purifier itself (its planet destroyer) a crescent: the stock sphere solid on the
//   left, its right side a hollow, half-built skeleton opening to space (planetdestroyer.png). Picked by subRole
//   (purifierArtUrl), render only: the sim's pictureRef is untouched.
// - The Beacon (Giantworks add-on): the Reclaimers' warships, the two Watchers and the finished Beacon draw our bundled
//   black-glass frames (public/art/beacon/, scripts/beacon-ships.py: grown three-way-symmetric hulls, ribbed and
//   speckled, with stained-glass windows onto beating organs and veins), picked by subRole (beaconArtUrl); the
//   Watchers and the Beacon are drawn at least a set size (minimumSizeScale). Their hearts beat, the
//   organs' light swells through the panes and pulses run out along the veins, and a sighted Watcher's plates swing open
//   (beaconFx.ts BeaconFxLayer). Who is who comes from the Beacon sim's state bag (BeaconArtState, read only).

import { Container, Graphics, Matrix, Rectangle, Sprite, Texture } from 'pixi.js';
import type { Galaxy } from '../sim/galaxy';
import type { BuiltObject } from '../sim/builtObject';
import type { Empire } from '../sim/empire';
import type { Habitat } from '../sim/types';
import { peekThreatState } from '../sim/scenario/threats/framework';
import { genShipsStates } from '../sim/scenario/threats/generationShips';
import { peekProbeSwarmState } from '../sim/scenario/threats/probeSwarm';
import { peekPurifierState } from '../sim/scenario/threats/purifier';
import { identifyPirateBase } from '../sim/characters';
import { BuiltObjectRole } from '../sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../sim/builtObjectTypes';
import { textureFromRgbaPixels } from './textureCanvas';
import { useMinifyingFilter } from './assets';
import { loadShipArt } from './shipArt';
import { SpritePool } from './fxCommon';
import { GEN_SHIPS_LIGHTS } from './genShipsLights';
import { GW_CASINO_LOOKS, GW_CASINO_SPR, GW_LIGHTS, GW_LIGHT_KINDS, GW_SANCTUARY_GLASS_R, GW_UM_RACKS, GW_UM_TRACES, type GwCasinoLook } from './giantworksLights';
import { LeviathanRig, leviathanTextures, type LeviathanTextures } from './leviathanRig';
import { loadLeviathanImages } from './faunaArt';

// ---------------------------------------------------------------------------------------------------------------
// Who is who (once per frame)
// ---------------------------------------------------------------------------------------------------------------

export interface ThreatLooks {
    genFactions: Empire[];
    worldShips: BuiltObject[];
    swarmFaction: Empire | null;
    mothercore: BuiltObject | null;
    /** The Purifier's faction (its escorts / guards / station wear the bundled art) and its repair station. */
    purifierFaction: Empire | null;
    purifierDock: BuiltObject | null;
    /** The Beacon (Giantworks): the Reclaimers' faction, the two Watchers, the Watchers seen uncloaked now (null: the sim
     * does not say, a Watcher opens while it sits still) and the finished Beacon. Optional: absent = none. */
    reclaimers?: Empire | null;
    watchers?: BuiltObject[];
    watchersSighted?: BuiltObject[] | null;
    beacon?: BuiltObject | null;
    /** Giantworks: the Great Work sites by their base (scaffold or finished wonder art), and the finished Ultraminds by
     * the planet they wrap (mainView.ts draws the machine shell over it). Optional: absent = none. */
    greatWorks?: Map<BuiltObject, GreatWorkArtSite>;
    ultramindPlanets?: Map<Habitat, GreatWorkArtSite>;
    /** Giantworks: the casinos that are a pirate den now (their sites; casinoDenOf). Optional: absent = none. */
    casinoDens?: Set<object>;
}

const looks: ThreatLooks = {
    genFactions: [],
    worldShips: [],
    swarmFaction: null,
    mothercore: null,
    purifierFaction: null,
    purifierDock: null,
    reclaimers: null,
    watchers: [],
    watchersSighted: null,
    beacon: null,
    greatWorks: new Map(),
    ultramindPlanets: new Map(),
    casinoDens: new Set(),
};

/**
 * The render contract with the Beacon's sim (Giantworks add-on, the 'beacon' wonder; sim/scenario/threats/giantworks,
 * beaconState.ts BEACON_KEY): these fields of its scenario state bag under BEACON_STATE_KEY (read here through
 * peekThreatState, never created). All optional, so the art works with whatever part of the sim exists:
 * - faction: the machine faction (the Watchers, then the Reclaimers). Every ship it owns draws its Reclaimer frame by
 *   subRole (beaconFileForSubRole; a planet destroyer the capital ship's); its bases keep their stock frames.
 * - watchers: the two Watchers (whoever owns them), as ships or as the sim's records ({ ship, mode }): the seed pod, drawn
 *   at least WATCHER_VISUAL_SCALE × a WATCHER_REF_SIZE hull. A record's Watcher unfolds while its mode is 'sighting'
 *   (seen uncloaked, parked over a colony) or 'fight' (it was attacked), and folds again in any other mode.
 * - sighted: (ships given without records) the Watchers seen uncloaked right now, which unfold. With neither records'
 *   modes nor this list, a Watcher unfolds while it sits still (currentSpeed under 1) and folds when it moves.
 * - beacon: the finished Beacon (the Great Work's station once complete): the relay tower, drawn at least
 *   BEACON_VISUAL_SCALE × a BEACON_REF_SIZE station (the framework's scaffold stages may want the same floor).
 */
export const BEACON_STATE_KEY = 'beacon';
export interface BeaconWatcherRecord {
    ship: BuiltObject | null;
    mode?: string;
}
export interface BeaconArtState {
    faction?: Empire | null;
    watchers?: readonly (BuiltObject | BeaconWatcherRecord | null)[];
    sighted?: readonly BuiltObject[];
    beacon?: BuiltObject | null;
}
/** A Watcher record's modes in which it shows itself open. */
const WATCHER_OPEN_MODES: ReadonlySet<string> = new Set(['sighting', 'fight']);
const sightedScratch: BuiltObject[] = [];

/** The threat factions / flagships this frame (a shared record, refreshed in place). */
export function threatLooks(galaxy: Galaxy): ThreatLooks {
    looks.genFactions.length = 0;
    looks.worldShips.length = 0;
    looks.swarmFaction = looks.mothercore = null;
    looks.purifierFaction = looks.purifierDock = null;
    looks.reclaimers = null;
    looks.watchers!.length = 0;
    looks.watchersSighted = null;
    looks.beacon = null;
    const gws = looks.greatWorks!;
    const ums = looks.ultramindPlanets!;
    const dens = looks.casinoDens!;
    if (gws.size > 0) gws.clear();
    if (ums.size > 0) ums.clear();
    if (dens.size > 0) dens.clear();
    if (galaxy.scenario === null) return looks;
    for (const site of greatWorkSites(galaxy)) {
        if (site.base === null || site.base.hasBeenDestroyed) continue;
        gws.set(site.base, site);
        if (site.stage >= 4 && site.wonder === 'ultramind' && site.habitat !== null) ums.set(site.habitat, site);
    }
    if (gws.size > 0) {
        const cs = peekThreatState<CasinoArtState | null | undefined>(galaxy, CASINO_STATE_KEY);
        if (cs !== null && cs !== undefined && typeof cs === 'object' && Array.isArray(cs.sites)) {
            for (const rec of cs.sites) {
                if (rec === null || rec === undefined || rec.phase !== CASINO_DEN_PHASE || typeof rec.workId !== 'number') continue;
                for (const site of gws.values()) if (site.wonder === 'casino' && site.id === rec.workId) dens.add(site);
            }
        }
    }
    const b = peekThreatState<BeaconArtState>(galaxy, BEACON_STATE_KEY);
    if (b !== null) {
        looks.reclaimers = b.faction ?? null;
        sightedScratch.length = 0;
        let modes = false;
        for (const w of b.watchers ?? []) {
            if (w === null) continue;
            const rec = 'ship' in w ? w : null;
            const ship = rec !== null ? rec.ship : (w as BuiltObject);
            if (ship === null || ship.hasBeenDestroyed) continue;
            looks.watchers!.push(ship);
            if (rec !== null && rec.mode !== undefined) {
                modes = true;
                if (WATCHER_OPEN_MODES.has(rec.mode)) sightedScratch.push(ship);
            }
        }
        if (b.sighted !== undefined) for (const w of b.sighted) if (!sightedScratch.includes(w)) sightedScratch.push(w);
        looks.watchersSighted = modes || b.sighted !== undefined ? sightedScratch : null;
        looks.beacon = b.beacon !== undefined && b.beacon !== null && !b.beacon.hasBeenDestroyed ? b.beacon : null;
    }
    // Giantworks: a finished Great Work whose wonder is the Beacon is the Beacon (its art, size floor and life), unless
    // the Beacon's sim names one itself.
    if (looks.beacon === null) {
        for (const site of gws.values()) if (site.stage >= 4 && site.wonder === 'beacon') looks.beacon = site.base;
    }
    for (const g of genShipsStates(galaxy)) {
        if (g.faction !== null) looks.genFactions.push(g.faction);
        if (g.pirate !== null) looks.genFactions.push(g.pirate);
        if (g.worldShip !== null && !g.worldShip.hasBeenDestroyed) looks.worldShips.push(g.worldShip);
    }
    const s = peekProbeSwarmState(galaxy);
    if (s !== null) {
        looks.swarmFaction = s.faction;
        looks.mothercore = s.mothercore;
    }
    const pu = peekPurifierState(galaxy);
    if (pu !== null && pu.faction !== null) {
        looks.purifierFaction = pu.faction;
        looks.purifierDock = identifyPirateBase(pu.faction);
    }
    return looks;
}

/** The bundled Purifier frames (public/art/purifier/<file>.png, scripts/purifier-ships.py) by subRole. */
const PURIFIER_ART_DIR = '/art/purifier/';
function purifierFile(bo: BuiltObject, dock: BuiltObject | null): string | null {
    if (bo.isPlanetDestroyer) return 'planetdestroyer';
    if (bo === dock) return 'base_1';
    if (bo.role === BuiltObjectRole.Base) return 'base_0';
    switch (bo.subRole) {
        case BuiltObjectSubRole.Escort:
        case BuiltObjectSubRole.Frigate:
            return 'frigate';
        case BuiltObjectSubRole.Destroyer:
            return 'destroyer';
        case BuiltObjectSubRole.Cruiser:
            return 'cruiser';
        case BuiltObjectSubRole.CapitalShip:
            return 'capitalship';
        case BuiltObjectSubRole.Carrier:
            return 'carrier';
        case BuiltObjectSubRole.TroopTransport:
            return 'trooptransport';
        default:
            return null;
    }
}

/**
 * The art URL of a Purifier escort / guard / station, or of the Purifier itself (its planet destroyer: the half-built
 * crescent); null for everything else (other planet destroyers keep the stock planetdestroyer.png). `l` defaults to the
 * record of the last threatLooks call (the ship layer refreshes it every frame), so UI pictures without the galaxy at
 * hand agree with the map.
 */
export function purifierArtUrl(bo: BuiltObject, l: ThreatLooks = looks): string | null {
    if (l.purifierFaction === null || bo.actualEmpire !== l.purifierFaction) return null;
    const f = purifierFile(bo, l.purifierDock);
    return f === null ? null : `${PURIFIER_ART_DIR}${f}.png`;
}

export const WORLD_SHIP_VISUAL_SCALE = 2.5;
export const MOTHERCORE_VISUAL_SCALE = 1.9;
/** The Purifier (its planet destroyer) drawn larger than its size alone gives, so it stays the most imposing ship of
 * its fleet next to its long escorts (render only). */
export const PURIFIER_VISUAL_SCALE = 1.5;

/**
 * The Watchers are drawn at least as large as a WATCHER_REF_SIZE hull drawn WATCHER_VISUAL_SCALE × (whatever size the
 * sim gives them: the closed pod is about two capital ships across, and open its plates reach about 2.1 × further); the
 * finished Beacon at least as large as a BEACON_REF_SIZE station drawn BEACON_VISUAL_SCALE ×. A larger hull keeps its
 * own size.
 */
export const WATCHER_VISUAL_SCALE = 2.6;
export const WATCHER_REF_SIZE = 900;
export const BEACON_VISUAL_SCALE = 1.3;
export const BEACON_REF_SIZE = 2500;

/** The draw scale that shows a hull of `size` at least as large as a `refSize` one drawn `k` × (never below 1). Pure. */
export function minimumSizeScale(size: number, refSize: number, k: number): number {
    return Math.max(1, k * Math.sqrt(refSize / Math.max(1, size)));
}

/** Visual size multiplier of an object (1 for everything but the world ship, the Mothercore, the Purifier, the Watchers and the Beacon). */
export function threatDrawScale(l: ThreatLooks, bo: BuiltObject): number {
    if (l.worldShips.includes(bo)) return WORLD_SHIP_VISUAL_SCALE;
    if (bo === l.mothercore) return MOTHERCORE_VISUAL_SCALE;
    if (bo.isPlanetDestroyer && l.purifierFaction !== null && bo.actualEmpire === l.purifierFaction) return PURIFIER_VISUAL_SCALE;
    if (l.watchers !== undefined && l.watchers.length > 0 && l.watchers.includes(bo)) return minimumSizeScale(bo.size, WATCHER_REF_SIZE, WATCHER_VISUAL_SCALE);
    if (l.beacon !== undefined && l.beacon !== null && bo === l.beacon) return minimumSizeScale(bo.size, BEACON_REF_SIZE, BEACON_VISUAL_SCALE);
    return 1;
}

/** A generation-ship hull (the faction's, or the world ship under any owner). */
export function isAncientHull(l: ThreatLooks, bo: BuiltObject): boolean {
    return (bo.actualEmpire !== null && l.genFactions.includes(bo.actualEmpire)) || l.worldShips.includes(bo);
}

export function isSwarmHull(l: ThreatLooks, bo: BuiltObject): boolean {
    return l.swarmFaction !== null && bo.actualEmpire === l.swarmFaction;
}

/** The generation ships' faded, yellowed hull tint, and their forced wear look (liveryLayer `forced`). */
export const ANCIENT_TINT = 0xd6cab4;
export const ANCIENT_WEAR = { level: 1, scars: 2 } as const;

// ---------------------------------------------------------------------------------------------------------------
// Probe swarm art
// ---------------------------------------------------------------------------------------------------------------

/** The bundled probe-swarm frames (public/art/probe-swarm/<file>.png, scripts/probe-swarm-ships.py) by role. */
const SWARM_ART_DIR = '/art/probe-swarm/';
function swarmFile(bo: BuiltObject, mothercore: BuiltObject | null): string {
    if (bo === mothercore) return 'mothercore';
    switch (bo.subRole) {
        case BuiltObjectSubRole.Escort:
            return 'escort';
        case BuiltObjectSubRole.Frigate:
            return 'frigate';
        case BuiltObjectSubRole.Destroyer:
            return 'destroyer';
        case BuiltObjectSubRole.Cruiser:
        case BuiltObjectSubRole.CapitalShip:
        case BuiltObjectSubRole.Carrier:
        case BuiltObjectSubRole.TroopTransport:
            return 'cruiser';
        case BuiltObjectSubRole.ConstructionShip:
            return 'constructor';
        case BuiltObjectSubRole.MiningShip:
        case BuiltObjectSubRole.GasMiningShip:
            return 'miningprobe';
        case BuiltObjectSubRole.MiningStation:
            return 'miningstation';
        case BuiltObjectSubRole.GasMiningStation:
            return 'gasminingstation';
        default:
            return bo.role === BuiltObjectRole.Base ? 'miningstation' : 'explorer';
    }
}

/**
 * The art URL of a probe-swarm hull (null for everything else): the Mothercore, warships, probes and stations each draw
 * their own frame. `l` defaults to the record of the last threatLooks call, as purifierArtUrl.
 */
export function swarmArtUrl(bo: BuiltObject, l: ThreatLooks = looks): string | null {
    if (!isSwarmHull(l, bo)) return null;
    return `${SWARM_ART_DIR}${swarmFile(bo, l.mothercore)}.png`;
}

// ---------------------------------------------------------------------------------------------------------------
// Generation ships art
// ---------------------------------------------------------------------------------------------------------------

/** The bundled generation-ship frames (public/art/generation-ships/<file>.png, scripts/generation-ships-ships.py). */
export const GEN_SHIPS_ART_DIR = '/art/generation-ships/';

/** The frame of a generation-ship subRole (the world ship's is 'worldship' whatever its subRole), or null: stock art. Pure. */
export function genShipsFileForSubRole(subRole: BuiltObjectSubRole): string | null {
    switch (subRole) {
        case BuiltObjectSubRole.Escort:
            return 'escort';
        case BuiltObjectSubRole.Frigate:
            return 'frigate';
        case BuiltObjectSubRole.Destroyer:
            return 'destroyer';
        case BuiltObjectSubRole.Cruiser:
            return 'cruiser';
        case BuiltObjectSubRole.CapitalShip:
            return 'capitalship';
        case BuiltObjectSubRole.Carrier:
            return 'carrier';
        case BuiltObjectSubRole.TroopTransport:
            return 'trooptransport';
        case BuiltObjectSubRole.ExplorationShip:
            return 'explorer';
        case BuiltObjectSubRole.ColonyShip:
            return 'worldship';
        case BuiltObjectSubRole.ConstructionShip:
            return 'construction';
        case BuiltObjectSubRole.SmallFreighter:
        case BuiltObjectSubRole.MediumFreighter:
        case BuiltObjectSubRole.LargeFreighter:
        case BuiltObjectSubRole.PassengerShip:
        case BuiltObjectSubRole.ResupplyShip:
        case BuiltObjectSubRole.MiningShip:
        case BuiltObjectSubRole.GasMiningShip:
            return 'hauler';
        default:
            return null;
    }
}

/** The bundled frame name of a generation-ship hull (null for everything else and for the factions' bases / civilians). */
export function genShipsArtFile(bo: BuiltObject, l: ThreatLooks = looks): string | null {
    if (l.worldShips.includes(bo)) return 'worldship';
    if (bo.actualEmpire === null || !l.genFactions.includes(bo.actualEmpire) || bo.role === BuiltObjectRole.Base) return null;
    return genShipsFileForSubRole(bo.subRole);
}

/** The art URL of a generation-ship hull (null: stock frame). `l` defaults to the last threatLooks record, as purifierArtUrl. */
export function genShipsArtUrl(bo: BuiltObject, l: ThreatLooks = looks): string | null {
    const f = genShipsArtFile(bo, l);
    return f === null ? null : `${GEN_SHIPS_ART_DIR}${f}.png`;
}

// ---------------------------------------------------------------------------------------------------------------
// The Beacon's art (Giantworks)
// ---------------------------------------------------------------------------------------------------------------

/** The bundled Beacon frames (public/art/beacon/<file>.png, scripts/beacon-ships.py). */
export const BEACON_ART_DIR = '/art/beacon/';

/** The Reclaimer frame of a subRole (null: stock art). Pure. */
export function beaconFileForSubRole(subRole: BuiltObjectSubRole): string | null {
    switch (subRole) {
        case BuiltObjectSubRole.Escort:
        case BuiltObjectSubRole.ExplorationShip:
            return 'escort';
        case BuiltObjectSubRole.Frigate:
            return 'frigate';
        case BuiltObjectSubRole.Destroyer:
            return 'destroyer';
        case BuiltObjectSubRole.Cruiser:
            return 'cruiser';
        case BuiltObjectSubRole.CapitalShip:
            return 'capitalship';
        case BuiltObjectSubRole.Carrier:
            return 'carrier';
        case BuiltObjectSubRole.TroopTransport:
        case BuiltObjectSubRole.PassengerShip:
            return 'trooptransport';
        case BuiltObjectSubRole.ConstructionShip:
        case BuiltObjectSubRole.SmallFreighter:
        case BuiltObjectSubRole.MediumFreighter:
        case BuiltObjectSubRole.LargeFreighter:
        case BuiltObjectSubRole.ResupplyShip:
        case BuiltObjectSubRole.MiningShip:
        case BuiltObjectSubRole.GasMiningShip:
        case BuiltObjectSubRole.ColonyShip:
            return 'construction';
        default:
            return null;
    }
}

/** A Reclaimer hull: a ship of the Reclaimers' faction (its bases excepted). */
export function isReclaimerHull(bo: BuiltObject, l: ThreatLooks = looks): boolean {
    return l.reclaimers !== undefined && l.reclaimers !== null && bo.actualEmpire === l.reclaimers && bo.role !== BuiltObjectRole.Base;
}

/** One of the two Watchers. */
export function isWatcher(bo: BuiltObject, l: ThreatLooks = looks): boolean {
    return l.watchers !== undefined && l.watchers.length > 0 && l.watchers.includes(bo);
}

/** The Beacon frame of an object ('watcher', 'beacon' or a Reclaimer frame), or null (not the Beacon's / stock art). */
export function beaconArtFile(bo: BuiltObject, l: ThreatLooks = looks): string | null {
    if (l.beacon !== undefined && l.beacon !== null && bo === l.beacon) return 'beacon';
    if (isWatcher(bo, l)) return 'watcher';
    if (!isReclaimerHull(bo, l)) return null;
    if (bo.isPlanetDestroyer) return 'capitalship';
    return beaconFileForSubRole(bo.subRole);
}

/** The art URL of a Reclaimer hull, a Watcher (its closed pod) or the Beacon (null: stock art). `l` defaults to the
 * record of the last threatLooks call, as purifierArtUrl. */
export function beaconArtUrl(bo: BuiltObject, l: ThreatLooks = looks): string | null {
    const f = beaconArtFile(bo, l);
    return f === null ? null : `${BEACON_ART_DIR}${f}.png`;
}

/** Whether a Watcher should be open: sighted uncloaked now (the sim's list), or, without a list, sitting still. */
export function watcherOpenTarget(bo: BuiltObject, l: ThreatLooks = looks): boolean {
    if (l.watchersSighted !== undefined && l.watchersSighted !== null) return l.watchersSighted.includes(bo);
    return bo.currentSpeed < 1;
}

/** Any Beacon art in play (the per-object lookups are skipped without). */
export function beaconLooksActive(l: ThreatLooks): boolean {
    return (l.reclaimers !== undefined && l.reclaimers !== null) || (l.watchers !== undefined && l.watchers.length > 0) || (l.beacon !== undefined && l.beacon !== null);
}

/** The bundled threat art of an object (a Great Work's, the Beacon's, the generation ships', the Purifier's or the probe
 * swarm's), or null for its stock frame. */
export function threatArtUrl(bo: BuiltObject, l: ThreatLooks = looks): string | null {
    const beacon = beaconLooksActive(l);
    const gw = l.greatWorks !== undefined && l.greatWorks.size > 0;
    if (l.purifierFaction === null && l.swarmFaction === null && l.genFactions.length === 0 && l.worldShips.length === 0 && !beacon && !gw) return null;
    return (gw ? greatWorkArtUrl(bo, l) : null) ?? (beacon ? beaconArtUrl(bo, l) : null) ?? genShipsArtUrl(bo, l) ?? purifierArtUrl(bo, l) ?? swarmArtUrl(bo, l);
}

/** Blink period (s) of the generation ships' red positional lights, and the flash length. */
export const GEN_LIGHT_PERIOD = 2.0;
export const GEN_LIGHT_FLASH = 0.42;

/** A ship's own blink phase (s, 0..period) from its id, so a fleet does not flash in step. Pure. */
export function genShipsLightPhase(builtObjectID: number): number {
    return (((builtObjectID * 0.6180339887) % 1) + 1) % 1 * GEN_LIGHT_PERIOD;
}

/**
 * Red positional light `k` of a generation ship: a 0.42 s flash every 2 s (quick rise, slower fade), each light of the
 * ship 0.13 s after the previous one (a short ripple from bow to stern), the ship on its own phase. Pure.
 */
export function genShipsLightAlpha(sec: number, k: number, phase: number): number {
    const P = GEN_LIGHT_PERIOD;
    const ph = ((((sec + phase - k * 0.13) % P) + P) % P);
    if (ph >= GEN_LIGHT_FLASH) return 0;
    return ph < 0.06 ? ph / 0.06 : 1 - (ph - 0.06) / (GEN_LIGHT_FLASH - 0.06);
}

/** The Mothercore's seam glow: a slow 5.5 s swell of the dim red light in its seams, never off, never bright. Pure. */
export function swarmSeamAlpha(sec: number): number {
    return 0.45 + 0.3 * (0.5 + 0.5 * Math.sin((2 * Math.PI * sec) / 5.5));
}

/**
 * The Mothercore's positional lights (frame px of mothercore.png; scripts/probe-swarm-ships.py MC_LIGHTS must match):
 * the six corners of the block's silhouette, where the frame bakes their unlit lamp housings.
 */
export const MOTHERCORE_LIGHTS: readonly (readonly [number, number])[] = [[110, 106], [352, 106], [380, 152], [380, 393], [136, 393], [110, 350]];

/** Positional light `k`: two alternating groups (even / odd corners), a 0.32 s flash every 2.2 s, quick rise and
 * fade. Pure. */
export function swarmLightAlpha(sec: number, k: number): number {
    const P = 2.2;
    const ph = ((((sec + (k % 2) * (P / 2)) % P) + P) % P);
    if (ph >= 0.32) return 0;
    return ph < 0.05 ? ph / 0.05 : 1 - (ph - 0.05) / 0.27;
}

const LAMP_ORANGE: readonly [number, number, number] = [1.0, 0.55, 0.12];
/** The generation ships' red navigation lamp. */
const RED_LAMP: readonly [number, number, number] = [1.0, 0.12, 0.08];
const LAMP_SIDE = 32;
const LAMP_CORE_PX = 3;
const lampTexs = new Map<readonly [number, number, number], Texture>();
/** A small lamp of colour `LAMP`: a hot core of LAMP_CORE_PX radius in a short halo, built once per colour. */
function lampTexture(LAMP: readonly [number, number, number] = LAMP_ORANGE): Texture {
    const got = lampTexs.get(LAMP);
    if (got !== undefined) return got;
    const S = LAMP_SIDE;
    const d = new Uint8ClampedArray(S * S * 4);
    for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
            const r = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2) / LAMP_CORE_PX;
            const core = Math.max(0, Math.min(1, 1.2 - r));
            const a = Math.min(1, core + Math.exp(-r * r * 0.18) * 0.6 * Math.max(0, 1 - r / (S / 2 / LAMP_CORE_PX)));
            const i = (y * S + x) * 4;
            d[i] = LAMP[0] * 255;
            d[i + 1] = (LAMP[1] + (0.85 - LAMP[1]) * core * 0.6) * 255;
            d[i + 2] = (LAMP[2] + (0.5 - LAMP[2]) * core * 0.6) * 255;
            d[i + 3] = a * 255;
        }
    }
    const t = textureFromRgbaPixels(d, S, S);
    useMinifyingFilter(t);
    lampTexs.set(LAMP, t);
    return t;
}

/** The bundled seam-glow layer of the Mothercore (loaded once, on first use; null until then or if it failed). */
const SEAM_GLOW_URL = `${SWARM_ART_DIR}mothercore-glow.png`;
let seamGlow: Texture | null = null;
let seamGlowLoading = false;
function seamGlowTexture(): Texture | null {
    if (seamGlow === null && !seamGlowLoading) {
        seamGlowLoading = true;
        void loadShipArt(SEAM_GLOW_URL, false).then(
            (a) => (seamGlow = a?.texture ?? null),
            () => undefined,
        );
    }
    return seamGlow;
}

/** The overlays are skipped below this drawn size (px). */
export const SWARM_FX_MIN_PX = 24;

/** The Mothercore's overlays: its pulsing red seam glow and its blinking orange positional lights (pooled additive
 * sprites; nothing allocated per frame). */
export class SwarmFxLayer {
    readonly root = new Container();
    private pool = new SpritePool(this.root);

    constructor() {
        this.root.eventMode = 'none';
    }

    begin(): void {
        this.pool.begin();
    }

    /** The overlays of a Mothercore sprite (its transform; `tw` × `th` its texture size). `sec`: the shared wall clock. */
    draw(x: number, y: number, rotation: number, scale: number, ax: number, ay: number, tw: number, th: number, drawnPx: number, sec: number): void {
        if (drawnPx < SWARM_FX_MIN_PX) return;
        const glow = seamGlowTexture();
        if (glow !== null) {
            const g = this.pool.acquire(glow);
            g.blendMode = 'add';
            g.anchor.set(ax, ay);
            g.position.set(x, y);
            g.rotation = rotation;
            g.scale.set(scale);
            g.alpha = swarmSeamAlpha(sec);
        }
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        // Screen px per frame px (the frame is about its crop square), for a lamp core of at least 1.6 screen px radius.
        const k = drawnPx / Math.max(tw, th);
        const rScreen = Math.max(1.6, 4.5 * k);
        const lampScale = ((rScreen * scale) / k) / LAMP_CORE_PX;
        const lamp = lampTexture();
        for (let i = 0; i < MOTHERCORE_LIGHTS.length; i++) {
            const a = swarmLightAlpha(sec, i);
            if (a <= 0.01) continue;
            const lx = (MOTHERCORE_LIGHTS[i][0] - ax * tw) * scale;
            const ly = (MOTHERCORE_LIGHTS[i][1] - ay * th) * scale;
            const s = this.pool.acquire(lamp);
            s.blendMode = 'add';
            s.position.set(x + lx * cos - ly * sin, y + lx * sin + ly * cos);
            s.scale.set(lampScale);
            s.alpha = a;
        }
    }

    end(): void {
        this.pool.end();
    }
}

/** The generation ships' lights are skipped below this drawn size (px). */
export const GEN_FX_MIN_PX = 14;

/** The generation ships' blinking red positional lights (pooled additive sprites; nothing allocated per frame). */
export class GenShipsFxLayer {
    readonly root = new Container();
    private pool = new SpritePool(this.root);

    constructor() {
        this.root.eventMode = 'none';
    }

    begin(): void {
        this.pool.begin();
    }

    /** The lights of a generation-ship sprite drawing frame `file` (its transform; `tw` × `th` its texture size). */
    draw(file: string, id: number, x: number, y: number, rotation: number, scale: number, ax: number, ay: number, tw: number, th: number, drawnPx: number, sec: number): void {
        if (drawnPx < GEN_FX_MIN_PX) return;
        if (!Object.hasOwn(GEN_SHIPS_LIGHTS, file)) return;
        const pts = GEN_SHIPS_LIGHTS[file];
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        // Screen px per frame px; a small lamp (core 1.2-2.4 screen px radius).
        const k = drawnPx / Math.max(tw, th);
        const rScreen = Math.min(2.5, Math.max(1.4, 2.8 * k));
        const lampScale = ((rScreen * scale) / k) / LAMP_CORE_PX;
        const lamp = lampTexture(RED_LAMP);
        const phase = genShipsLightPhase(id);
        for (let i = 0; i < pts.length; i++) {
            const a = genShipsLightAlpha(sec, i, phase);
            if (a <= 0.01) continue;
            const lx = (pts[i][0] + 0.5 - ax * tw) * scale;
            const ly = (pts[i][1] + 0.5 - ay * th) * scale;
            const s = this.pool.acquire(lamp);
            s.blendMode = 'add';
            s.position.set(x + lx * cos - ly * sin, y + lx * sin + ly * cos);
            s.scale.set(lampScale);
            s.alpha = a;
        }
    }

    end(): void {
        this.pool.end();
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Giantworks: the Great Work (render only)
// ---------------------------------------------------------------------------------------------------------------
//
// A Great Work site's base draws our bundled frames (public/art/giantworks/, scripts/giantworks-art.py): while it is
// built, one of four shared scaffold stages (scaffold_0 Foundations .. scaffold_3 Fitting: the same frames whatever
// the wonder will be, so the silhouette gives nothing away); once complete, its wonder's frame (the Gilded Orbit
// casino planet, the Ultramind, the Leviathan Sanctuary). Every frame is drawn at one fixed world size (the crop
// square is the whole texture), so the structure grows in place stage by stage. GreatWorkFxLayer lights them: blinking
// nav lights and strobes, flickering work lamps and welding sparks, the casino's neon (each piece of its atlas with its
// own buzz, dying tube, fill-in sequence or blink), its chasing marquee bulbs, its turning roulette rotors (with the
// ball) and observation wheel and its streams of ships, the Ultramind's data lights and slow cyan pulse, and the
// Sanctuary's void whales swimming inside its glass (the Leviathan rig, small, clipped to the sphere) under the front
// struts (while breached: broken panes venting water, emergency lamps, a red alarm glow). A finished Ultramind built round a planet also
// wraps that planet in its machine shell (syncUltramindShell, from mainView.ts's planet / moon pass), its base then a
// smaller uplink node.

/**
 * The Giantworks add-on's scenario-state key: its framework keeps its sites in galaxy.scenario.state.giantworks as
 * `{ sites: GreatWorkSite[] }` (sim/scenario/threats/giantworks). The render only reads it (peekThreatState, never
 * created).
 */
export const GIANTWORKS_STATE_KEY = 'giantworks';

/**
 * What the art reads of a Great Work site: giantworks/types.ts GreatWorkSite's base / stage / wonder / habitat (a
 * structural subset, so the render needs no import of the add-on), plus optional extras a wonder module may keep on
 * its site: `whales` (the Sanctuary's whale count, default 4), `breached` (the Sanctuary's sphere broken: cracked
 * panes venting water, the emergency lamps and red alarm glow; only an exact `true` counts) and `awakened` (the
 * Ultramind turned on its partners: its lights go red).
 */
export interface GreatWorkArtSite {
    /** The site's id (a casino's record names its Great Work by it). */
    id?: number;
    base: BuiltObject | null;
    stage: number;
    /** 0..1 (the map glyph's stage arcs fill with it). */
    progress?: number;
    wonder: string;
    habitat: Habitat | null;
    whales?: number;
    breached?: boolean;
    awakened?: boolean;
}

const NO_SITES: readonly GreatWorkArtSite[] = [];

/**
 * The render contract with the casino's sim (the 'casino' wonder; sim/scenario/threats/giantworks casino.ts
 * CASINO_KEY): its scenario state bag under CASINO_STATE_KEY, read through peekThreatState, never created. Each record
 * names its Great Work by `workId` (the site's id); while a record's phase is CASINO_DEN_PHASE ('revealed': the
 * smugglers' front is out and the pirates hold the system) that casino draws as the pirate den ('casino-pirate'), in
 * every other phase as the Gilded Orbit. All fields optional.
 */
export const CASINO_STATE_KEY = 'giantworksCasino';
export const CASINO_DEN_PHASE = 'revealed';
export interface CasinoArtRecord {
    workId?: number;
    phase?: string;
}
export interface CasinoArtState {
    sites?: readonly (CasinoArtRecord | null | undefined)[];
}

/** The Great Work sites (the add-on's state), or none. Read only. */
export function greatWorkSites(galaxy: Galaxy): readonly GreatWorkArtSite[] {
    const st = peekThreatState<{ sites?: GreatWorkArtSite[] }>(galaxy, GIANTWORKS_STATE_KEY);
    return st !== null && Array.isArray(st.sites) ? st.sites : NO_SITES;
}

/** The bundled Giantworks frames (public/art/giantworks/<frame>.png, scripts/giantworks-art.py). */
export const GW_ART_DIR = '/art/giantworks/';

/**
 * The frame a site's base draws: the scaffold of its stage (0..3, shared by every wonder), or once complete (stage 4)
 * its wonder's (the Ultramind's uplink node when it wraps a planet, its `-awake` frames once it has turned on its
 * partners; a casino that is a pirate den now, by `l`'s casinoDens (the last threatLooks record by default), the
 * den). A finished wonder without art of its own yet keeps the finished scaffold. Pure but for that record.
 */
export function greatWorkFrame(site: Pick<GreatWorkArtSite, 'stage' | 'wonder' | 'habitat'> & Partial<Pick<GreatWorkArtSite, 'awakened'>>, l: ThreatLooks = looks): string {
    if (!(site.stage >= 4)) return `scaffold_${Math.max(0, Math.min(3, Math.trunc(site.stage) || 0))}`;
    switch (site.wonder) {
        case 'casino':
            return l.casinoDens !== undefined && l.casinoDens.has(site) ? 'casino-pirate' : 'casino';
        case 'ultramind':
            // `awakened` is set by the Ultramind's own module (render only: read defensively)
            if (site.awakened === true) return site.habitat !== null ? 'ultramind-node-awake' : 'ultramind-awake';
            return site.habitat !== null ? 'ultramind-node' : 'ultramind';
        case 'sanctuary':
            return 'sanctuary';
        case 'beacon':
            return 'beacon'; // the Beacon's own art (public/art/beacon/beacon.png), drawn by the Beacon's paths
        default:
            return 'scaffold_3';
    }
}

/** The frame the Great Work path draws itself (fixed world size and orientation, GreatWorkFxLayer), or null when another
 * look takes over (a finished Beacon: beaconArtUrl, its BEACON_VISUAL_SCALE / BEACON_REF_SIZE floor, BeaconFxLayer). */
export function greatWorkDrawnFrame(site: Pick<GreatWorkArtSite, 'stage' | 'wonder' | 'habitat'> & Partial<Pick<GreatWorkArtSite, 'awakened'>>, l: ThreatLooks = looks): string | null {
    const f = greatWorkFrame(site, l);
    return f === 'beacon' ? null : f;
}

/** World units the whole frame spans at zoom factor 1 (about a large planet). */
export const GREAT_WORK_WORLD_SIZE = 560;
/** Frames drawn smaller than the rest (the Ultramind's uplink node beside the planet it wraps). */
const GW_FRAME_SCALE: Readonly<Record<string, number>> = { 'ultramind-node': 0.5, 'ultramind-node-awake': 0.5 };

/** The drawn side (px) of a Great Work frame at zoom factor f: a fixed world size, whatever its base's size. Pure. */
export function greatWorkDrawPx(frame: string, f: number): number {
    const k = Object.hasOwn(GW_FRAME_SCALE, frame) ? GW_FRAME_SCALE[frame] : 1;
    return Math.trunc((GREAT_WORK_WORLD_SIZE * k) / f);
}

/** The Great Work site whose base `bo` is (null for anything else). */
export function greatWorkSiteOf(bo: BuiltObject, l: ThreatLooks = looks): GreatWorkArtSite | null {
    return l.greatWorks === undefined || l.greatWorks.size === 0 ? null : (l.greatWorks.get(bo) ?? null);
}

/** The Great Work whose base or planet `target` is (a threat-site row's target; the last threatLooks record), or null. */
export function greatWorkAt(target: object, l: ThreatLooks = looks): GreatWorkArtSite | null {
    if (l.greatWorks === undefined || l.greatWorks.size === 0) return null;
    for (const [base, site] of l.greatWorks) if (base === target || site.habitat === target) return site;
    return null;
}

/** The art URL of a Great Work's base (null for everything else). */
export function greatWorkArtUrl(bo: BuiltObject, l: ThreatLooks = looks): string | null {
    const site = greatWorkSiteOf(bo, l);
    if (site === null) return null;
    const f = greatWorkFrame(site, l);
    return f === 'beacon' ? `${BEACON_ART_DIR}beacon.png` : `${GW_ART_DIR}${f}.png`;
}

// --- lights ---

/** The light kinds of giantworksLights.ts, by index. */
const GW_NAV = GW_LIGHT_KINDS.indexOf('nav');
const GW_WHITE = GW_LIGHT_KINDS.indexOf('white');
const GW_WORK = GW_LIGHT_KINDS.indexOf('work');
const GW_WELD = GW_LIGHT_KINDS.indexOf('weld');
const GW_RUN = GW_LIGHT_KINDS.indexOf('run');
const GW_NEON_A = GW_LIGHT_KINDS.indexOf('neonA');
const GW_NEON_B = GW_LIGHT_KINDS.indexOf('neonB');
const GW_DATA = GW_LIGHT_KINDS.indexOf('data');
const GW_GOLD = GW_LIGHT_KINDS.indexOf('gold');
const GW_BULB = GW_LIGHT_KINDS.indexOf('bulb');

/** A 0..1 hash of two integers (sparkles, data blinks). Pure. */
function hash01(a: number, b: number): number {
    let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h ^= h >>> 12;
    return (h >>> 0) / 4294967296;
}

/** A flash of length `on` s every `period` s (quick rise, slower fade), at phase `ph` s. Pure. */
function flash(sec: number, period: number, on: number, ph: number): number {
    const t = ((((sec + ph) % period) + period) % period);
    if (t >= on) return 0;
    const rise = Math.min(0.05, on / 4);
    return t < rise ? t / rise : 1 - (t - rise) / (on - rise);
}

// --- the Gilded Orbit (the casino planet): its neon, its turning wheels, its ball, its ship lanes ---

/** The casino's neon behaviours (a GwCasinoLook neon row's behaviour column). */
export const CASINO_BUZZ = 0;
export const CASINO_DEAD = 1;
export const CASINO_SEQ = 2;
export const CASINO_BLINK = 3;
export const CASINO_BAD = 4;
const NEON_OFF = 0.04;

/**
 * Brightness 0..1 of casino neon piece `k` at `sec` (behaviour `beh`, its parameters p1..p3). Every piece shimmers a
 * little. BUZZ: steady, and now and then (every 5.5 to 10.5 s) it stutters for a fraction of a second (a burst of on /
 * off); DEAD: a failing tube that sputters, now and then catching for a second or so; SEQ (index p1 of a run of p2,
 * one step every p3 s): the run's pieces light one by one, hold all lit, then all go dark; BLINK (phase p1, period p2
 * s): two sets take turns; BAD (the pirate den's: a failing transformer): long dark spells, otherwise sputtering, never
 * full. Pure.
 */
export function casinoNeonAlpha(beh: number, p1: number, p2: number, p3: number, sec: number, k: number): number {
    const shim = 0.93 + 0.07 * Math.sin(sec * 31.4 + k * 2.1) * Math.sin(sec * 17.9 + k);
    switch (beh) {
        case CASINO_BUZZ: {
            const P = 5.5 + 5.0 * hash01(k, 1);
            const tt = sec + p1 + k * 0.7;
            const c = Math.floor(tt / P);
            const ph = tt - c * P;
            const start = hash01(c, k) * (P - 1.2);
            const dur = 0.22 + 0.5 * hash01(c, k + 77);
            if (ph >= start && ph < start + dur) return hash01(Math.floor(sec * 22), k + 5) > 0.45 ? shim : NEON_OFF;
            return shim;
        }
        case CASINO_DEAD: {
            const tt = sec + p1;
            const c = Math.floor(tt / 4.3);
            if (tt - c * 4.3 < 0.7 + 1.1 * hash01(c, k)) return shim * 0.9;
            return hash01(Math.floor(sec * 12), k + 3) > 0.74 ? 0.85 : NEON_OFF;
        }
        case CASINO_SEQ: {
            const n = Math.max(1, Math.trunc(p2));
            const st = ((Math.floor(sec / Math.max(0.02, p3)) % (n + 3)) + (n + 3)) % (n + 3);
            return st >= Math.trunc(p1) + 1 && st <= n + 1 ? shim : NEON_OFF;
        }
        case CASINO_BLINK: {
            const on = (((Math.floor(sec / Math.max(0.02, p2)) + Math.trunc(p1)) % 2) + 2) % 2 === 0;
            return on ? shim : NEON_OFF * 2;
        }
        case CASINO_BAD: {
            if (hash01(Math.floor((sec + p1) / 1.7), k + 13) < 0.3) return NEON_OFF;
            return hash01(Math.floor(sec * 9), k + 21) > 0.35 ? shim * 0.75 : NEON_OFF;
        }
        default:
            return shim;
    }
}

/**
 * The turn (rad, in its plane) of rotor `r` (a GwCasinoLook rotors row) at `sec`: smooth at its spin, or with a jerk
 * period (the den's, worn out) in fits: a grinding lurch in the first 30 % of each period, then stuck. Pure.
 */
export function casinoRotorAngle(r: readonly number[], sec: number): number {
    const spin = r[7];
    const P = r[10] ?? 0;
    if (!(P > 0)) return spin * sec;
    const c = Math.floor(sec / P);
    const u = (sec - c * P) / P;
    const m = Math.min(1, u / 0.3);
    return spin * P * (c + m * m * (3 - 2 * m)) + (u < 0.3 ? 0.012 * Math.sin(sec * 47) : 0);
}

/** The roulette ball's cycle (s): flying round the bowl, dropping, riding a pocket. */
export const CASINO_BALL_PERIOD = 16;

/**
 * The roulette ball of rotor `r` (a GwCasinoLook rotors row; `idx` its index) at `sec`, in the rotor's plane (frame px
 * from its centre), into `out`: it flies round the bowl against the rotor's turn, slows, drops into the pocket ring
 * (a few bounces) and rides it with the rotor, fades as the croupier lifts it, then flies again. Pure but for `out`.
 */
export function casinoBallPos(r: readonly number[], idx: number, sec: number, out: { x: number; y: number; a: number }): void {
    const spin = r[7];
    const ph0 = hash01(idx + 7, 9) * CASINO_BALL_PERIOD;
    const tt = sec + ph0;
    const cyc = Math.floor(tt / CASINO_BALL_PERIOD);
    const t = tt - cyc * CASINO_BALL_PERIOD;
    const launch = hash01(cyc, 3) * 2 * Math.PI;
    const w0 = spin >= 0 ? -3.4 : 3.4;
    const track = (r[8] + r[9]) / 2 + 0.4;
    const pocket = r[8] * 0.58;
    const t1 = 9;
    const t2 = 10.4;
    let rad: number;
    let ang: number;
    out.a = 1;
    if (t < t1) {
        rad = track;
        ang = launch + w0 * (t - (t * t) / 24);
    } else {
        const a1 = launch + w0 * (t1 - (t1 * t1) / 24);
        const w1 = w0 * (1 - t1 / 12);
        if (t < t2) {
            const u = (t - t1) / (t2 - t1);
            rad = track + (pocket - track) * u + 1.4 * Math.sin(u * Math.PI * 3) * (1 - u);
            ang = a1 + (w1 * (1 - u) + spin * u) * (t - t1);
        } else {
            rad = pocket;
            ang = a1 + ((w1 + spin) / 2) * (t2 - t1) + spin * (t - t2);
            out.a = Math.min(1, (CASINO_BALL_PERIOD - t) / 0.4);
        }
    }
    out.x = rad * Math.cos(ang);
    out.y = rad * Math.sin(ang);
}

/** A ship lane's brightness at `rho` frame px from the casino's centre (`look`'s laneFade): full near the planet,
 * nothing far out. Pure. */
export function casinoLaneFade(look: GwCasinoLook, rho: number): number {
    const [near, far] = look.laneFade;
    const f = Math.max(0, Math.min(1, (far - rho) / (far - near)));
    return f ** 1.3;
}

/** Each look's lanes' lengths (frame px), once. */
const CASINO_LANE_LEN = new Map<GwCasinoLook, readonly number[]>(
    Object.values(GW_CASINO_LOOKS).map((look) => [
        look,
        look.lanes.map((l) => {
            let L = 0;
            for (let i = 3; i + 1 < l.length; i += 2) L += Math.hypot(l[i] - l[i - 2], l[i + 1] - l[i - 1]);
            return L;
        }),
    ]),
);

/** How many ships lane `li` of `look` carries (one every look.lane[0] frame px). Pure. */
export function casinoLaneShips(look: GwCasinoLook, li: number): number {
    return Math.floor((CASINO_LANE_LEN.get(look)?.[li] ?? 0) / look.lane[0]);
}

/**
 * Ship `k` of lane `li` of `look` at `sec` into `out` (frame px; `a` its brightness, 0 for none): the ships stream along
 * the lane (in toward a gate, or out of it) at look.lane's spacing and speed, fading into / out of the mouth and with
 * the distance from the casino's centre (`cx`, `cy`). Pure but for `out`.
 */
export function casinoLaneShip(look: GwCasinoLook, li: number, k: number, sec: number, cx: number, cy: number, out: { x: number; y: number; a: number }): void {
    const l = look.lanes[li];
    const L = CASINO_LANE_LEN.get(look)?.[li] ?? 0;
    out.a = 0;
    if (l === undefined || !(L > 0)) return;
    const s = (((k * look.lane[0] + sec * look.lane[1] + hash01(k, 11) * 3) % L) + L) % L;
    let acc = 0;
    for (let i = 3; i + 1 < l.length; i += 2) {
        const sl = Math.hypot(l[i] - l[i - 2], l[i + 1] - l[i - 1]);
        if (s <= acc + sl || i + 3 >= l.length) {
            const u = sl > 0 ? Math.min(1, (s - acc) / sl) : 0;
            out.x = l[i - 2] + (l[i] - l[i - 2]) * u;
            out.y = l[i - 1] + (l[i + 1] - l[i - 1]) * u;
            break;
        }
        acc += sl;
    }
    const mouth = l[0] === 0 ? Math.min(1, (L - s) / (0.05 * L)) : Math.min(1, s / (0.05 * L));
    out.a = mouth * look.lane[2] * casinoLaneFade(look, Math.hypot(out.x - cx, out.y - cy));
}

/**
 * Alpha of light `k` (of `n` in its frame) of kind `kind` (GW_LIGHT_KINDS index) at `sec`: nav lights flash red every
 * 2.4 s each on its own phase; strobes a short white blink; work lamps a steady flicker; welding sparks crackle at
 * random; running lights chase round the rings; the casino's arena bulbs and its marquee bulbs chase in threes (the
 * marquee faster); data lights blink at random. Pure.
 */
export function gwLightAlpha(kind: number, sec: number, k: number, n: number): number {
    switch (kind) {
        case GW_NAV:
            return flash(sec, 2.4, 0.5, k * 0.61);
        case GW_WHITE:
            return flash(sec, 1.7, 0.14, k * 0.43);
        case GW_WORK:
            return 0.72 + 0.18 * Math.sin(sec * 7.3 + k * 1.9) * Math.sin(sec * 3.1 + k);
        case GW_WELD: {
            const b = Math.floor(sec * 14);
            return hash01(b, k * 7 + 3) > 0.62 ? 0.55 + 0.45 * hash01(b, k) : 0;
        }
        case GW_RUN: {
            const t = (((k / Math.max(1, n)) - sec / 3.2) % 1 + 1) % 1;
            return 0.2 + 0.8 * Math.max(0, 1 - t * 6);
        }
        case GW_NEON_A:
        case GW_NEON_B:
            return (Math.floor(sec / 0.55) + (kind === GW_NEON_B ? 1 : 0)) % 2 === 0 ? 1 : 0.35;
        case GW_GOLD:
            return (k + Math.floor(sec * 5)) % 3 === 0 ? 1 : 0.18;
        case GW_BULB:
            return (k + Math.floor(sec * 7)) % 3 === 0 ? 1 : 0.22;
        case GW_DATA: {
            const b = Math.floor(sec * 3 + k * 0.37);
            return hash01(b, k) > 0.5 ? 0.7 : 0.08;
        }
        default:
            return 0;
    }
}

const GW_LAMP_COLOURS: readonly (readonly [number, number, number])[] = [
    [1.0, 0.12, 0.08], // nav
    [1.0, 1.0, 1.0], // white
    [1.0, 0.74, 0.4], // work
    [0.78, 0.9, 1.0], // weld
    [0.45, 0.75, 1.0], // run
    [1.0, 0.22, 0.82], // neonA
    [0.22, 0.95, 1.0], // neonB
    [0.3, 0.92, 1.0], // data
    [1.0, 0.8, 0.32], // gold
    [1.0, 0.9, 0.62], // bulb
];
/** The lamp core radius (frame px) per kind, before the on-screen minimum. */
const GW_LAMP_FRAME_R = [3.2, 2.4, 5.0, 1.8, 2.2, 2.2, 2.2, 1.5, 2.2, 1.1];
const GW_RED_DATA: readonly [number, number, number] = [1.0, 0.16, 0.12];

/** The additive glow layer of a frame (its lit windows / neon / data seams, pulsed), or null. */
function gwGlowFiles(frame: string): readonly string[] {
    switch (frame) {
        case 'ultramind':
            return UM_GLOW;
        case 'ultramind-awake':
            return UM_AWAKE_GLOW;
        case 'ultramind-node':
            return UM_NODE_GLOW;
        case 'ultramind-node-awake':
            return UM_NODE_AWAKE_GLOW;
        default:
            return [];
    }
}
const UM_GLOW = ['ultramind-glow'];
const UM_AWAKE_GLOW = ['ultramind-awake-glow'];
const UM_NODE_GLOW = ['ultramind-node-glow'];
const UM_NODE_AWAKE_GLOW = ['ultramind-node-awake-glow'];

const gwKeys = new Map<string, string>();
/** A frame's key in the generated tables (giantworksLights.ts: every '-' an '_'), cached (no per-frame strings). */
function gwKey(frame: string): string {
    let k = gwKeys.get(frame);
    if (k === undefined) {
        k = frame.split('-').join('_');
        gwKeys.set(frame, k);
    }
    return k;
}

/** The Ultramind's slow breathing glow (never off); awakened, a faster, harder throb. Pure. */
export function gwUltramindPulse(sec: number, awake = false): number {
    if (awake) return 0.4 + 0.45 * Math.pow(0.5 + 0.5 * Math.sin((2 * Math.PI * sec) / 1.3), 2);
    return 0.35 + 0.3 * (0.5 + 0.5 * Math.sin((2 * Math.PI * sec) / 4.2));
}

/**
 * Alpha (0..1) of a server-rack status light of the Ultramind (row `row`, column `col` in its server unit): each unit
 * runs one of four patterns (by a hash of its row): a light chasing along the row, disk-activity flicker, a
 * heartbeat, a binary count. Awakened, the same patterns run three times as fast, most lights stay lit and the whole
 * cube stutters in angry bursts. Pure.
 */
export function gwRackAlpha(sec: number, row: number, col: number, awake: boolean): number {
    const t = awake ? sec * 3.2 : sec;
    let a: number;
    switch (Math.floor(hash01(row, 17) * 4)) {
        case 0: {
            const n = 3 + Math.floor(hash01(row, 5) * 4);
            a = Math.floor(t * 4 + hash01(row, 9) * 16) % n === col % n ? 1 : 0.06;
            break;
        }
        case 1:
            a = hash01(Math.floor(t * 9 + hash01(row, 2) * 50), row * 31 + col) > 0.55 ? 0.95 : 0.05;
            break;
        case 2:
            a = 0.2 + 0.8 * flash(t, 1.6 + hash01(row, 3), 0.4, col * 0.08 + hash01(row, 4) * 3);
            break;
        default:
            a = (Math.floor(t * 2 + hash01(row, 7) * 64) >> col % 6) & 1 ? 0.9 : 0.05;
    }
    if (awake) {
        const burst = flash(sec, 1.15, 0.3, 0) > 0 && Math.floor(sec * 22) % 2 === 0;
        a = burst ? 1 : Math.max(a, 0.5 * hash01(Math.floor(sec * 14), row * 7 + col));
    }
    return a;
}

/**
 * Where the data pulse on trace `i` (`len` frame px long) is at `sec`: its distance along the trace, or -1 between
 * pulses. Calm: one pulse at 60 px/s, then a pause of 1.5-4.5 s; awakened: 190 px/s, almost back to back. Pure.
 */
export function gwTracePulse(sec: number, i: number, len: number, awake: boolean): number {
    const speed = awake ? 190 : 60;
    const period = len / speed + (awake ? 0.12 : 1.5 + 3 * hash01(i, 11));
    const t = (((sec + hash01(i, 13) * period) % period) + period) % period;
    const d = t * speed;
    return d <= len ? d : -1;
}

/** The trace polylines of a frame with their cumulative lengths (built once per frame). */
interface TraceTable {
    pts: readonly (readonly number[])[];
    cum: Float64Array[];
}
const traceTables = new Map<string, TraceTable | null>();
function traceTable(key: string): TraceTable | null {
    let t = traceTables.get(key);
    if (t !== undefined) return t;
    t = null;
    if (Object.hasOwn(GW_UM_TRACES, key)) {
        const pts = GW_UM_TRACES[key];
        const cum = pts.map((pl) => {
            const c = new Float64Array(pl.length >> 1);
            for (let j = 1; j < c.length; j++) c[j] = c[j - 1] + Math.hypot(pl[2 * j] - pl[2 * j - 2], pl[2 * j + 1] - pl[2 * j - 1]);
            return c;
        });
        t = { pts, cum };
    }
    traceTables.set(key, t);
    return t;
}
/** Scratch point (no per-frame allocation). */
const tracePt = { x: 0, y: 0 };
/** The point `d` frame px along polyline `pl` (cumulative lengths `cum`) into tracePt. */
function traceAt(pl: readonly number[], cum: Float64Array, d: number): void {
    let j = 1;
    while (j < cum.length - 1 && cum[j] < d) j++;
    const seg = cum[j] - cum[j - 1];
    const f = seg > 1e-6 ? Math.max(0, Math.min(1, (d - cum[j - 1]) / seg)) : 0;
    tracePt.x = pl[2 * j - 2] + (pl[2 * j] - pl[2 * j - 2]) * f;
    tracePt.y = pl[2 * j - 1] + (pl[2 * j + 1] - pl[2 * j - 1]) * f;
}

const UM_PULSE: readonly [number, number, number] = [0.55, 0.95, 1.0];
const UM_PULSE_RED: readonly [number, number, number] = [1.0, 0.25, 0.12];
const UM_PULSE_TRAIL = [0.85, 0.5, 0.28, 0.12];

const gwTex = new Map<string, Texture | null>();
const gwLoading = new Set<string>();
/** A bundled Giantworks overlay texture (loaded once, on first use; null until then or if it failed). */
function gwTexture(name: string): Texture | null {
    const got = gwTex.get(name);
    if (got !== undefined) return got;
    if (!gwLoading.has(name)) {
        gwLoading.add(name);
        void loadShipArt(`${GW_ART_DIR}${name}.png`, false).then(
            (a) => gwTex.set(name, a?.texture ?? null),
            () => gwTex.set(name, null),
        );
    }
    return null;
}

// --- the Sanctuary's whales ---

/** One whale's swim inside the glass (units of the glass radius): an ellipse round (cx, cy), a lap every `period` s. */
interface WhaleSwim {
    len: number;
    cx: number;
    cy: number;
    rx: number;
    ry: number;
    period: number;
    dir: 1 | -1;
    phase: number;
}

/** The whales, largest first; a site shows the first `whales` of them (default 4, at most all). */
export const SANCTUARY_WHALES: readonly WhaleSwim[] = [
    { len: 0.62, cx: 0.0, cy: 0.05, rx: 0.45, ry: 0.35, period: 80, dir: 1, phase: 0.3 },
    { len: 0.46, cx: -0.05, cy: -0.05, rx: 0.55, ry: 0.45, period: 64, dir: -1, phase: 2.6 },
    { len: 0.36, cx: 0.08, cy: 0.0, rx: 0.4, ry: 0.62, period: 52, dir: 1, phase: 4.4 },
    { len: 0.28, cx: -0.1, cy: 0.1, rx: 0.6, ry: 0.35, period: 44, dir: -1, phase: 1.2 },
    { len: 0.22, cx: 0.15, cy: -0.15, rx: 0.4, ry: 0.45, period: 37, dir: 1, phase: 5.6 },
    { len: 0.18, cx: -0.2, cy: 0.2, rx: 0.35, ry: 0.3, period: 31, dir: -1, phase: 3.3 },
    { len: 0.15, cx: 0.2, cy: 0.2, rx: 0.3, ry: 0.35, period: 27, dir: 1, phase: 0.9 },
];

/** Where whale `w` is at `sec` (units of the glass radius) and its heading (rad). Pure. */
export function sanctuaryWhalePose(w: WhaleSwim, sec: number): { x: number; y: number; heading: number } {
    const th = w.phase + (w.dir * 2 * Math.PI * sec) / w.period;
    const x = w.cx + w.rx * Math.cos(th);
    const y = w.cy + w.ry * Math.sin(th);
    const vx = -w.dir * w.rx * Math.sin(th);
    const vy = w.dir * w.ry * Math.cos(th);
    return { x, y, heading: Math.atan2(vy, vx) };
}

/** How many whales a site shows (its `whales`, default 4, 1..all). Pure. */
export function sanctuaryWhaleCount(site: Pick<GreatWorkArtSite, 'whales'>): number {
    const n = site.whales ?? 4;
    return Math.max(1, Math.min(SANCTUARY_WHALES.length, Math.trunc(Number.isFinite(n) ? n : 4)));
}

/** Whether a Sanctuary site is breached (its `breached`, read defensively: only an exact `true`). Pure. */
export function sanctuaryBreached(site: Pick<GreatWorkArtSite, 'breached'>): boolean {
    return site.breached === true;
}

/**
 * The venting plumes' lengths (frame px), one per break of the light table's `sanctuary_breaks` row, in its order
 * (scripts/giantworks-art.py SANC_BREAKS, the biggest hole first).
 */
export const SANCTUARY_SPILL_LEN: readonly number[] = [300, 215, 150];
/** Puffs of water out of each break at once, and the seconds one takes to drift out and fade (the biggest break's). */
export const SANCTUARY_SPILL_PUFFS = 4;
const SPILL_PERIOD = 2.6;

/** One puff of a breach's venting plume at `sec`: how far out it has drifted (0..1), its length / width (frame px)
 * and its alpha, and a slow wobble of its heading (rad). `k` the break, `j` the puff. Pure. */
export function sanctuarySpillPuff(sec: number, k: number, j: number): { t: number; len: number; wid: number; alpha: number; wobble: number } {
    const L = SANCTUARY_SPILL_LEN[Math.max(0, Math.min(SANCTUARY_SPILL_LEN.length - 1, k))];
    const period = SPILL_PERIOD * (0.7 + 0.3 * (L / SANCTUARY_SPILL_LEN[0]));
    const t = (((sec / period + j / SANCTUARY_SPILL_PUFFS + k * 0.37) % 1) + 1) % 1;
    const fadeIn = Math.min(1, t / 0.12);
    return {
        t,
        len: L * (0.3 + 0.8 * t),
        wid: Math.sqrt(L / SANCTUARY_SPILL_LEN[0]) * (0.7 + 1.1 * t),
        alpha: fadeIn * Math.pow(1 - t, 1.1),
        wobble: 0.1 * Math.sin(sec * 1.7 + k * 2.1 + j * 1.3),
    };
}

/** The breached Sanctuary's red alarm glow, fading in and out (0.1..1, a 2.2 s cycle). Pure. */
export function sanctuaryAlarmPulse(sec: number): number {
    const w = 0.5 + 0.5 * Math.sin((2 * Math.PI * sec) / 2.2);
    return 0.1 + 0.9 * w * w;
}

/** Emergency lamp `k`'s alpha at `sec`: the odd and the even ones flash in turn, a fast warning beat. Pure. */
export function sanctuaryEmergencyAlpha(sec: number, k: number): number {
    const c = 0.5 + 0.5 * Math.cos(2 * Math.PI * (sec / 0.9 + (k % 2) * 0.5));
    return 0.12 + 0.88 * c * c * c * c;
}

const SPILL_W = 200; // sanctuary-spill.png, frame px (scripts/giantworks-art.py SPILL_W)

let whaleTex: LeviathanTextures | null = null;
let whaleTexLoading = false;
/** The Leviathan's part textures without its harpoons (these whales were raised here, never hunted). */
function sanctuaryWhaleTextures(): LeviathanTextures | null {
    if (whaleTex === null && !whaleTexLoading) {
        whaleTexLoading = true;
        void loadLeviathanImages().then((imgs) => {
            const t = leviathanTextures(imgs);
            for (const h of t.harpoons) {
                h.shaft.destroy(true);
                h.line?.destroy(true);
            }
            whaleTex = { ...t, harpoons: [] };
        });
    }
    return whaleTex;
}

/** One Sanctuary's whales: a container in frame px (centred on the frame), masked to the glass. */
class SanctuaryView {
    readonly root = new Container();
    private readonly mask = new Graphics();
    private readonly rigs: LeviathanRig[] = [];
    seen = false;

    constructor(tex: LeviathanTextures, count: number) {
        this.root.eventMode = 'none';
        this.mask.circle(0, 0, GW_SANCTUARY_GLASS_R - 1).fill(0xffffff);
        this.root.addChild(this.mask);
        this.root.mask = this.mask;
        // Deepest (smallest) first, so the big ones swim over them.
        for (let i = count - 1; i >= 0; i--) {
            const rig = new LeviathanRig(tex, i * 1.37);
            const w = SANCTUARY_WHALES[i];
            // Seen from above through the water (the glass's tint and the struts go over them in sanctuary-front): every
            // one a little blue, the smaller ones swimming deeper, fainter and bluer through more water.
            const deep = 1 - w.len / SANCTUARY_WHALES[0].len; // 0 the largest .. ~0.8 the smallest
            rig.root.tint = deep > 0.3 ? 0xa4c4dc : 0xdce8f0;
            rig.root.alpha = 1 - 0.5 * deep;
            this.rigs[i] = rig;
            this.root.addChild(rig.root);
        }
    }

    get count(): number {
        return this.rigs.length;
    }

    pose(sec: number): void {
        const R = GW_SANCTUARY_GLASS_R;
        for (let i = 0; i < this.rigs.length; i++) {
            const w = SANCTUARY_WHALES[i];
            const p = sanctuaryWhalePose(w, sec);
            const rig = this.rigs[i];
            rig.root.position.set(p.x * R, p.y * R);
            rig.root.rotation = p.heading;
            rig.root.scale.set((w.len * R) / rig.length);
            rig.pose(sec + i * 3.1, 0.55);
        }
    }

    destroy(): void {
        this.root.destroy({ children: true });
    }
}

/** The Great Work's overlays are skipped below this drawn size (px); the whales below SANCTUARY_WHALES_MIN_PX. */
export const GW_FX_MIN_PX = 28;
export const SANCTUARY_WHALES_MIN_PX = 60;
/** The casino's turning wheels, its roulette balls and its ships are skipped below this drawn size (px; its neon and
 * bulbs keep GW_FX_MIN_PX). */
export const CASINO_MOVING_MIN_PX = 60;

const BALL_LAMP: readonly [number, number, number] = [1.0, 1.0, 0.96];
const SHIP_IN_LAMP: readonly [number, number, number] = [1.0, 0.93, 0.78];
const SHIP_OUT_LAMP: readonly [number, number, number] = [1.0, 0.2, 0.12];

const casinoNeonTex = new Map<GwCasinoLook, readonly Texture[]>();
/** A casino look's neon pieces: frames of its atlas (look.neonFile, look.neon), made once it has loaded. */
function casinoNeonTextures(look: GwCasinoLook): readonly Texture[] | null {
    const got = casinoNeonTex.get(look);
    if (got !== undefined) return got;
    const atlas = gwTexture(look.neonFile);
    if (atlas === null) return null;
    const t = look.neon.map((r) => new Texture({ source: atlas.source, frame: new Rectangle(r[0], r[1], r[2], r[3]) }));
    casinoNeonTex.set(look, t);
    return t;
}

/** The Ultramind's rack lights are drawn from this drawn frame size (px; below it a light is under a pixel), its trace
 * pulses from UM_PULSES_MIN_PX. */
export const UM_RACKS_MIN_PX = 300;
export const UM_PULSES_MIN_PX = 110;

/**
 * The Great Work's overlays (pooled; nothing allocated per frame but a Sanctuary's view, once): the Sanctuary's
 * whales and its front struts / glass over them, the casino's turning sprites, the additive glow layers and neon
 * pieces, then the lamps.
 */
export class GreatWorkFxLayer {
    readonly root = new Container();
    private readonly whales = new Container();
    private readonly fronts = new Container();
    private readonly turns = new Container();
    private readonly glows = new Container();
    private readonly lamps = new Container();
    private frontPool = new SpritePool(this.fronts);
    /** The casino's turning sprites (each placed whole by setFromMatrix, skew included: nothing else uses this pool). */
    private turnPool = new SpritePool(this.turns);
    private readonly mat = new Matrix();
    private readonly pt = { x: 0, y: 0, a: 0 };
    private glowPool = new SpritePool(this.glows);
    private lampPool = new SpritePool(this.lamps);
    private readonly racks = new Container();
    /** The Ultramind's rack lights (skewed into their face's plane: nothing else uses this pool). */
    private rackPool = new SpritePool(this.racks);
    private views = new Map<BuiltObject, SanctuaryView>();

    constructor() {
        this.root.eventMode = 'none';
        this.root.addChild(this.whales, this.fronts, this.turns, this.glows, this.racks, this.lamps);
    }

    begin(): void {
        this.frontPool.begin();
        this.turnPool.begin();
        this.glowPool.begin();
        this.lampPool.begin();
        this.rackPool.begin();
        for (const v of this.views.values()) v.seen = false;
    }

    /** The overlays of a Great Work base sprite drawing `frame` (its transform; `tw` × `th` its texture size). */
    draw(site: GreatWorkArtSite, frame: string, bo: BuiltObject, x: number, y: number, rotation: number, scale: number, ax: number, ay: number, tw: number, th: number, drawnPx: number, sec: number): void {
        if (drawnPx < GW_FX_MIN_PX) return;
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        // The frame centre (the whales' origin) in world space.
        const ox = (0.5 - ax) * tw * scale;
        const oy = (0.5 - ay) * th * scale;
        const cx = x + ox * cos - oy * sin;
        const cy = y + ox * sin + oy * cos;
        if (frame === 'sanctuary') {
            const tex = drawnPx >= SANCTUARY_WHALES_MIN_PX ? sanctuaryWhaleTextures() : null;
            if (tex !== null) {
                const n = sanctuaryWhaleCount(site);
                let v = this.views.get(bo);
                if (v !== undefined && v.count !== n) {
                    v.destroy();
                    this.views.delete(bo);
                    v = undefined;
                }
                if (v === undefined) {
                    v = new SanctuaryView(tex, n);
                    this.views.set(bo, v);
                    this.whales.addChild(v.root);
                }
                v.seen = true;
                v.root.visible = true;
                v.root.position.set(cx, cy);
                v.root.rotation = rotation;
                v.root.scale.set(scale);
                v.pose(sec);
            }
            const breached = sanctuaryBreached(site);
            const alarm = breached ? gwTexture('sanctuary-alarm') : null;
            const pulse = sanctuaryAlarmPulse(sec);
            if (alarm !== null) this.frameSprite(alarm, 'normal', pulse, x, y, rotation, scale, ax, ay); // in the water, under the struts
            const front = gwTexture('sanctuary-front');
            if (front !== null) this.frameSprite(front, 'normal', 1, x, y, rotation, scale, ax, ay);
            if (breached) this.drawSanctuaryBreach(alarm, pulse, x, y, rotation, cos, sin, scale, ax * tw, ay * th, tw, th, drawnPx, sec);
        }
        const look = Object.hasOwn(GW_CASINO_LOOKS, frame) ? GW_CASINO_LOOKS[frame] : null;
        if (look !== null) this.drawCasino(look, x, y, rotation, cos, sin, scale, ax * tw, ay * th, tw, th, drawnPx, sec);
        const glows = gwGlowFiles(frame);
        for (let i = 0; i < glows.length; i++) {
            const t = gwTexture(glows[i]);
            if (t === null) continue;
            const s = this.glowPool.acquire(t);
            s.blendMode = 'add';
            s.anchor.set(ax, ay);
            s.position.set(x, y);
            s.rotation = rotation;
            s.scale.set(scale);
            s.alpha = gwUltramindPulse(sec, frame.endsWith('-awake'));
        }
        const key = gwKey(frame);
        const k = drawnPx / Math.max(tw, th); // screen px per frame px
        if (Object.hasOwn(GW_UM_RACKS, key)) drawUltramindFx(this.rackPool, this.lampPool, key, frame.endsWith('-awake'), x, y, rotation, scale, ax, ay, tw, th, k, drawnPx, sec);
        if (!Object.hasOwn(GW_LIGHTS, key)) return;
        const pts = GW_LIGHTS[key];
        const red = site.awakened === true;
        // the casino's dense marquee and arena bulbs merge into blobs when small: they fade out as the casino shrinks
        const bulbFade = Math.max(0, Math.min(1, (k - 0.22) / 0.3));
        for (let i = 0; i < pts.length; i++) {
            const kind = pts[i][2];
            const bulb = kind === GW_BULB || kind === GW_GOLD;
            const a = gwLightAlpha(kind, sec, i, pts.length) * (bulb ? bulbFade : 1);
            if (a <= 0.02) continue;
            const rScreen = Math.max(kind === GW_DATA ? 0.9 : bulb ? 0.7 : 1.3, Math.min(4.5, GW_LAMP_FRAME_R[kind] * k));
            const lampScale = ((rScreen * scale) / k) / LAMP_CORE_PX;
            const lx = (pts[i][0] + 0.5 - ax * tw) * scale;
            const ly = (pts[i][1] + 0.5 - ay * th) * scale;
            const s = this.lampPool.acquire(lampTexture(red && kind === GW_DATA ? GW_RED_DATA : GW_LAMP_COLOURS[kind]));
            s.blendMode = 'add';
            s.position.set(x + lx * cos - ly * sin, y + lx * sin + ly * cos);
            s.scale.set(lampScale);
            s.alpha = a;
        }
    }

    /** A whole-frame Sanctuary layer (sanctuary-front and the breach's), placed like the base sprite. */
    private frameSprite(t: Texture, blend: 'normal' | 'add', alpha: number, x: number, y: number, rotation: number, scale: number, ax: number, ay: number): void {
        const s = this.frontPool.acquire(t);
        s.blendMode = blend;
        s.anchor.set(ax, ay);
        s.position.set(x, y);
        s.rotation = rotation;
        s.scale.set(scale);
        s.alpha = alpha;
    }

    /**
     * A breached Sanctuary over its front (frame px (fx, fy) at world (x, y) + R(rotation) * scale * (fx - ox, fy - oy)):
     * the broken panes, the red alarm glow lighting the struts too (its additive echo), the water venting from each
     * break (SANCTUARY_SPILL_PUFFS puffs of sanctuary-spill drifting out along the radius and fading, sanctuarySpillPuff),
     * and the emergency lamps flashing (the light table's sanctuary_emergency row).
     */
    private drawSanctuaryBreach(alarm: Texture | null, pulse: number, x: number, y: number, rotation: number, cos: number, sin: number, scale: number, ox: number, oy: number, tw: number, th: number, drawnPx: number, sec: number): void {
        const ax = ox / tw;
        const ay = oy / th;
        const cracks = gwTexture('sanctuary-breach');
        if (cracks !== null) this.frameSprite(cracks, 'normal', 1, x, y, rotation, scale, ax, ay);
        if (alarm !== null) this.frameSprite(alarm, 'add', 0.3 * pulse, x, y, rotation, scale, ax, ay);
        const spill = gwTexture('sanctuary-spill');
        const breaks = Object.hasOwn(GW_LIGHTS, 'sanctuary_breaks') ? GW_LIGHTS.sanctuary_breaks : [];
        if (spill !== null) {
            for (let k = 0; k < breaks.length; k++) {
                const bx = breaks[k][0] + 0.5;
                const by = breaks[k][1] + 0.5;
                const out = Math.atan2(by - th / 2, bx - tw / 2);
                const lx = (bx - ox) * scale;
                const ly = (by - oy) * scale;
                const L = SANCTUARY_SPILL_LEN[Math.min(k, SANCTUARY_SPILL_LEN.length - 1)];
                // the jet at the mouth (never off, flickering), then the puffs drifting out
                for (let j = -1; j < SANCTUARY_SPILL_PUFFS; j++) {
                    const p = j < 0 ? null : sanctuarySpillPuff(sec, k, j);
                    if (p !== null && p.alpha <= 0.02) continue;
                    const s = this.frontPool.acquire(spill);
                    s.blendMode = 'normal';
                    s.anchor.set(0, 0.5);
                    s.position.set(x + lx * cos - ly * sin, y + lx * sin + ly * cos);
                    s.rotation = rotation + out + (p?.wobble ?? 0.04 * Math.sin(sec * 5.3 + k));
                    if (p === null) s.scale.set((scale * L * 0.42) / SPILL_W, scale * 0.5 * Math.sqrt(L / SANCTUARY_SPILL_LEN[0]));
                    else s.scale.set((scale * p.len) / SPILL_W, scale * p.wid);
                    s.alpha = p?.alpha ?? 0.75 + 0.2 * Math.sin(sec * 9.1 + k * 1.7);
                }
            }
        }
        const pts = Object.hasOwn(GW_LIGHTS, 'sanctuary_emergency') ? GW_LIGHTS.sanctuary_emergency : [];
        const k = drawnPx / Math.max(tw, th); // screen px per frame px
        const rScreen = Math.max(1.6, Math.min(5.5, 5 * k));
        const lampScale = ((rScreen * scale) / k) / LAMP_CORE_PX;
        const tex = lampTexture(GW_LAMP_COLOURS[GW_NAV]);
        for (let i = 0; i < pts.length; i++) {
            const a = sanctuaryEmergencyAlpha(sec, i);
            if (a <= 0.02) continue;
            const lx = (pts[i][0] + 0.5 - ox) * scale;
            const ly = (pts[i][1] + 0.5 - oy) * scale;
            const s = this.lampPool.acquire(tex);
            s.blendMode = 'add';
            s.position.set(x + lx * cos - ly * sin, y + lx * sin + ly * cos);
            s.scale.set(lampScale);
            s.alpha = a;
        }
    }

    /**
     * A casino look's runtime layers over its frame (the Gilded Orbit, or the pirate den; frame px (fx, fy) are at world
     * (x, y) + R(rotation) * scale * (fx - ox, fy - oy)): each neon piece of the look's atlas lit by its own behaviour
     * (casinoNeonAlpha), and from CASINO_MOVING_MIN_PX the roulette rotors turning in their planes on the sphere
     * (sprite -> frame M2 * R(casinoRotorAngle)), the observation wheel turning, the roulette balls, and the ships
     * along the lanes (fading with the distance from the centre). The marquee bulbs are GW_LIGHTS lamps (draw's lamp
     * loop).
     */
    private drawCasino(look: GwCasinoLook, x: number, y: number, rotation: number, cos: number, sin: number, scale: number, ox: number, oy: number, tw: number, th: number, drawnPx: number, sec: number): void {
        const neon = casinoNeonTextures(look);
        if (neon !== null) {
            for (let i = 0; i < neon.length; i++) {
                const r = look.neon[i];
                const a = casinoNeonAlpha(r[6], r[7], r[8], r[9], sec, i);
                if (a <= 0.02) continue;
                const s = this.glowPool.acquire(neon[i]);
                s.blendMode = 'add';
                s.anchor.set(0, 0);
                const lx = (r[4] - ox) * scale;
                const ly = (r[5] - oy) * scale;
                s.position.set(x + lx * cos - ly * sin, y + lx * sin + ly * cos);
                s.rotation = rotation;
                s.scale.set(scale);
                s.alpha = a;
            }
        }
        if (drawnPx < CASINO_MOVING_MIN_PX) return;
        const k = scale / GW_CASINO_SPR;
        for (let i = 0; i < look.rotors.length; i++) {
            const r = look.rotors[i];
            const t = gwTexture(look.rotorFiles[r[0]] ?? '');
            if (t === null) continue;
            const turn = casinoRotorAngle(r, sec);
            const c = Math.cos(turn);
            const sn = Math.sin(turn);
            // M2 * R(spin t): the rotor turning in its own plane, then seen on the sphere
            const n00 = r[3] * c + r[4] * sn;
            const n01 = -r[3] * sn + r[4] * c;
            const n10 = r[5] * c + r[6] * sn;
            const n11 = -r[5] * sn + r[6] * c;
            const lx = (r[1] - ox) * scale;
            const ly = (r[2] - oy) * scale;
            this.mat.set(k * (cos * n00 - sin * n10), k * (sin * n00 + cos * n10), k * (cos * n01 - sin * n11), k * (sin * n01 + cos * n11), x + lx * cos - ly * sin, y + lx * sin + ly * cos);
            this.turnPool.acquire(t).setFromMatrix(this.mat);
        }
        const wheel = look.wheel;
        const wt = look.wheelFile !== null && wheel !== null ? gwTexture(look.wheelFile) : null;
        if (wt !== null && wheel !== null) {
            const c = Math.cos(rotation + wheel[2] * sec);
            const sn = Math.sin(rotation + wheel[2] * sec);
            const lx = (wheel[0] - ox) * scale;
            const ly = (wheel[1] - oy) * scale;
            this.mat.set(k * c, k * sn, -k * sn, k * c, x + lx * cos - ly * sin, y + lx * sin + ly * cos);
            this.turnPool.acquire(wt).setFromMatrix(this.mat);
        }
        const kp = drawnPx / Math.max(tw, th); // screen px per frame px
        const pt = this.pt;
        for (let i = 0; look.ball && i < look.rotors.length; i++) {
            const r = look.rotors[i];
            casinoBallPos(r, i, sec, pt);
            if (pt.a <= 0.02) continue;
            this.lamp(BALL_LAMP, r[1] + r[3] * pt.x + r[4] * pt.y, r[2] + r[5] * pt.x + r[6] * pt.y, 0.8, 1.6, 1.0, pt.a, x, y, cos, sin, scale, ox, oy, kp);
        }
        for (let li = 0; li < look.lanes.length; li++) {
            const tint = look.lanes[li][0] === 0 ? SHIP_IN_LAMP : SHIP_OUT_LAMP;
            const n = casinoLaneShips(look, li);
            for (let s = 0; s < n; s++) {
                casinoLaneShip(look, li, s, sec, tw / 2, th / 2, pt);
                if (pt.a <= 0.02) continue;
                this.lamp(tint, pt.x, pt.y, 0.8, 2.0, 1.4, pt.a, x, y, cos, sin, scale, ox, oy, kp);
            }
        }
    }

    /** One additive lamp at frame px (fx, fy): core radius frameR frame px, held between minR and maxR screen px. */
    private lamp(tint: readonly [number, number, number], fx: number, fy: number, minR: number, maxR: number, frameR: number, alpha: number, x: number, y: number, cos: number, sin: number, scale: number, ox: number, oy: number, kp: number): void {
        const rScreen = Math.max(minR, Math.min(maxR, frameR * kp));
        const s = this.lampPool.acquire(lampTexture(tint));
        s.blendMode = 'add';
        const lx = (fx - ox) * scale;
        const ly = (fy - oy) * scale;
        s.position.set(x + lx * cos - ly * sin, y + lx * sin + ly * cos);
        s.scale.set(((rScreen * scale) / kp) / LAMP_CORE_PX);
        s.alpha = alpha;
    }

    end(): void {
        this.frontPool.end();
        this.turnPool.end();
        this.glowPool.end();
        this.lampPool.end();
        this.rackPool.end();
        for (const [bo, v] of this.views) {
            if (v.seen) continue;
            if (bo.hasBeenDestroyed || looks.greatWorks?.has(bo) !== true) {
                v.destroy();
                this.views.delete(bo);
            } else v.root.visible = false;
        }
    }
}

/**
 * The Ultramind's rack lights blinking in their patterns (from UM_RACKS_MIN_PX) and the data pulses running along its
 * circuit traces (from UM_PULSES_MIN_PX), over a frame `key` (GW_UM_RACKS / GW_UM_TRACES) drawn at (x, y) with its
 * anchor (ax, ay), `rotation` and `scale`; `k` screen px per frame px. Pooled: the cube's (GreatWorkFxLayer) and the
 * planet cage's (syncUltramindShell) sprites.
 */
export function drawUltramindFx(rackPool: SpritePool, lampPool: SpritePool, key: string, awake: boolean, x: number, y: number, rotation: number, scale: number, ax: number, ay: number, tw: number, th: number, k: number, drawnPx: number, sec: number): void {
    if (!Object.hasOwn(GW_UM_RACKS, key)) return;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    if (drawnPx >= UM_RACKS_MIN_PX) {
        const r = GW_UM_RACKS[key];
        const white = Texture.WHITE;
        const sx = scale / white.width;
        const sy = scale / white.height;
        for (let i = 0; i + 7 < r.length; i += 8) {
            const a = gwRackAlpha(sec, r[i + 5], r[i + 6], awake);
            if (a <= 0.08) continue;
            const s = rackPool.acquire(white);
            s.blendMode = 'add';
            const lx = (r[i] - ax * tw) * scale;
            const ly = (r[i + 1] - ay * th) * scale;
            s.position.set(x + lx * cos - ly * sin, y + lx * sin + ly * cos);
            s.rotation = rotation;
            s.skew.set(0, (r[i + 4] * Math.PI) / 6);
            s.scale.set(r[i + 2] * sx, r[i + 3] * sy);
            s.tint = awake ? (r[i + 7] === 1 ? 0xff9a6a : 0xff2a14) : r[i + 7] === 1 ? 0xd8f8ff : 0x4ce4ff;
            s.alpha = a * 0.75;
        }
    }
    if (drawnPx < UM_PULSES_MIN_PX) return;
    const tt = traceTable(key);
    if (tt === null) return;
    const lamp = lampTexture(awake ? UM_PULSE_RED : UM_PULSE);
    const rScreen = Math.max(0.7, Math.min(1.5, 1.2 * k));
    const lampScale = ((rScreen * scale) / k) / LAMP_CORE_PX;
    const spacing = (awake ? 3.6 : 2.4) / Math.max(0.35, k);
    for (let i = 0; i < tt.pts.length; i++) {
        const pl = tt.pts[i];
        const cum = tt.cum[i];
        const len = cum[cum.length - 1];
        const d = gwTracePulse(sec, i, len, awake);
        if (d < 0) continue;
        for (let j = 0; j < UM_PULSE_TRAIL.length; j++) {
            const dd = d - j * spacing;
            if (dd < 0) break;
            traceAt(pl, cum, dd);
            const lx = (tracePt.x - ax * tw) * scale;
            const ly = (tracePt.y - ay * th) * scale;
            const s = lampPool.acquire(lamp);
            s.blendMode = 'add';
            s.position.set(x + lx * cos - ly * sin, y + lx * sin + ly * cos);
            s.scale.set(lampScale * (1 - j * 0.15));
            s.alpha = UM_PULSE_TRAIL[j];
        }
    }
}

// --- the Ultramind's shell over its planet ---

/** The shell textures span this many times the planet picture's width (scripts/giantworks-art.py SHELL_FRAME /
 * (2 * SHELL_R)): the cube cage round the planet, its antennas out past the cube's corners. */
export const ULTRAMIND_SHELL_SCALE = 480 / 320;

/** The Ultramind's cube cage round one planet / moon picture (its back half under the body, the front half and its
 * pulsing data glow over it), made on first use. */
export interface UltramindShellHolder {
    gwShell: { back: Sprite; shell: Sprite; glow: Sprite; fx: Container; racks: SpritePool; lamps: SpritePool } | null;
}

/** Show `s` centred on `body`, `side` px wide, at its alpha. */
function placeOver(s: Sprite, body: Sprite, side: number): void {
    s.visible = true;
    s.position.copyFrom(body.position);
    s.scale.set(side / s.texture.width);
    s.alpha = body.alpha;
}

/** The shell's textures (calm / awakened), by name. */
const UM_SHELL = { back: 'ultramind-shell-back', front: 'ultramind-shell', glow: 'ultramind-shell-glow', key: 'ultramind_shell' } as const;
const UM_SHELL_AWAKE = { back: 'ultramind-shell-back-awake', front: 'ultramind-shell-awake', glow: 'ultramind-shell-awake-glow', key: 'ultramind_shell_awake' } as const;

/**
 * The Ultramind's cage over a planet or moon picture `body` of habitat `h` (mainView.ts updateBodies, after the body
 * is placed): shown while `h` is a finished Ultramind's planet (the last threatLooks record) and the body is drawn;
 * the back half inserted right under the body in `parent`, the front half and the glow right above it. Its awakened
 * textures once the site is `awakened` (read defensively).
 */
export function syncUltramindShell(parent: Container, holder: UltramindShellHolder, body: Sprite, h: Habitat, sec: number): void {
    const ums = looks.ultramindPlanets;
    const site = ums === undefined || ums.size === 0 ? undefined : ums.get(h);
    const names = site?.awakened === true ? UM_SHELL_AWAKE : UM_SHELL;
    const shellTex = site !== undefined && body.visible ? gwTexture(names.front) : null;
    const backTex = shellTex !== null ? gwTexture(names.back) : null;
    const glowTex = backTex !== null ? gwTexture(names.glow) : null;
    if (site === undefined || shellTex === null || backTex === null || glowTex === null) {
        if (holder.gwShell !== null) holder.gwShell.back.visible = holder.gwShell.shell.visible = holder.gwShell.glow.visible = holder.gwShell.fx.visible = false;
        return;
    }
    if (holder.gwShell === null) {
        const back = new Sprite(backTex);
        const shell = new Sprite(shellTex);
        const glow = new Sprite(glowTex);
        for (const s of [back, shell, glow]) {
            s.anchor.set(0.5);
            s.eventMode = 'none';
        }
        glow.blendMode = 'add';
        const fx = new Container();
        fx.eventMode = 'none';
        const rackLayer = new Container();
        const lampLayer = new Container();
        fx.addChild(rackLayer, lampLayer);
        const at = parent.getChildIndex(body);
        parent.addChildAt(back, at);
        parent.addChildAt(shell, at + 2);
        parent.addChildAt(glow, at + 3);
        parent.addChildAt(fx, at + 4);
        holder.gwShell = { back, shell, glow, fx, racks: new SpritePool(rackLayer), lamps: new SpritePool(lampLayer) };
    }
    const { back, shell, glow, fx, racks, lamps } = holder.gwShell;
    back.texture = backTex;
    shell.texture = shellTex;
    glow.texture = glowTex;
    const side = body.scale.x * body.texture.width * ULTRAMIND_SHELL_SCALE;
    placeOver(back, body, side);
    placeOver(shell, body, side);
    placeOver(glow, body, side);
    glow.alpha = body.alpha * gwUltramindPulse(sec, site.awakened === true);
    // its rack lights and data pulses (the front half's, frame px of the shell texture)
    fx.visible = true;
    fx.alpha = body.alpha;
    racks.begin();
    lamps.begin();
    // `side` is in the bodies container's units (world): its screen size for the gates and the lamp sizes
    const z = Math.abs(parent.worldTransform.a) || 1;
    const scale = side / shellTex.width;
    drawUltramindFx(racks, lamps, names.key, site.awakened === true, body.position.x, body.position.y, 0, scale, 0.5, 0.5, shellTex.width, shellTex.height, scale * z, side * z, sec);
    racks.end();
    lamps.end();
}
