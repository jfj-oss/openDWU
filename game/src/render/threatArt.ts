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
import { GW_CASINO_LOOKS, GW_CASINO_SPR, GW_LIGHTS, GW_LIGHT_KINDS, GW_SANCTUARY_GLASS_R, type GwCasinoLook } from './giantworksLights';
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
// struts. A finished Ultramind built round a planet also
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
 * structural subset, so the render needs no import of the add-on), plus two optional extras a wonder module may keep
 * on its site: `whales` (the Sanctuary's whale count, default 4) and `awakened` (the Ultramind turned on its
 * partners: its lights go red).
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
 * its wonder's (the Ultramind's uplink node when it wraps a planet; a casino that is a pirate den now, by `l`'s
 * casinoDens (the last threatLooks record by default), the den). A finished wonder without art of its own yet keeps
 * the finished scaffold. Pure but for that record.
 */
export function greatWorkFrame(site: Pick<GreatWorkArtSite, 'stage' | 'wonder' | 'habitat'>, l: ThreatLooks = looks): string {
    if (!(site.stage >= 4)) return `scaffold_${Math.max(0, Math.min(3, Math.trunc(site.stage) || 0))}`;
    switch (site.wonder) {
        case 'casino':
            return l.casinoDens !== undefined && l.casinoDens.has(site) ? 'casino-pirate' : 'casino';
        case 'ultramind':
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
export function greatWorkDrawnFrame(site: Pick<GreatWorkArtSite, 'stage' | 'wonder' | 'habitat'>, l: ThreatLooks = looks): string | null {
    const f = greatWorkFrame(site, l);
    return f === 'beacon' ? null : f;
}

/** World units the whole frame spans at zoom factor 1 (about a large planet). */
export const GREAT_WORK_WORLD_SIZE = 560;
/** Frames drawn smaller than the rest (the Ultramind's uplink node beside the planet it wraps). */
const GW_FRAME_SCALE: Readonly<Record<string, number>> = { 'ultramind-node': 0.5 };

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
            return ['ultramind-glow'];
        case 'ultramind-node':
            return ['ultramind-node-glow'];
        default:
            return [];
    }
}

/** The Ultramind's slow breathing glow (never off). Pure. */
export function gwUltramindPulse(sec: number): number {
    return 0.35 + 0.3 * (0.5 + 0.5 * Math.sin((2 * Math.PI * sec) / 4.2));
}

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
            // The smaller ones swim deeper: fainter and bluer through more water.
            const deep = 1 - w.len / SANCTUARY_WHALES[0].len; // 0 the largest .. ~0.8 the smallest
            rig.root.tint = deep > 0.3 ? 0x9cbcdc : 0xffffff;
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
    private views = new Map<BuiltObject, SanctuaryView>();

    constructor() {
        this.root.eventMode = 'none';
        this.root.addChild(this.whales, this.fronts, this.turns, this.glows, this.lamps);
    }

    begin(): void {
        this.frontPool.begin();
        this.turnPool.begin();
        this.glowPool.begin();
        this.lampPool.begin();
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
            const front = gwTexture('sanctuary-front');
            if (front !== null) {
                const s = this.frontPool.acquire(front);
                s.anchor.set(ax, ay);
                s.position.set(x, y);
                s.rotation = rotation;
                s.scale.set(scale);
            }
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
            s.alpha = gwUltramindPulse(sec);
            s.tint = site.awakened === true ? 0xff3a2a : 0xffffff;
        }
        if (!Object.hasOwn(GW_LIGHTS, frame.replace('-', '_'))) return;
        const pts = GW_LIGHTS[frame.replace('-', '_')];
        const k = drawnPx / Math.max(tw, th); // screen px per frame px
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
        for (const [bo, v] of this.views) {
            if (v.seen) continue;
            if (bo.hasBeenDestroyed || looks.greatWorks?.has(bo) !== true) {
                v.destroy();
                this.views.delete(bo);
            } else v.root.visible = false;
        }
    }
}

// --- the Ultramind's shell over its planet ---

/** The shell texture spans this many times the planet picture's width (scripts/giantworks-art.py SHELL_SCALE). */
export const ULTRAMIND_SHELL_SCALE = 1.4;

/** The machine shell (and its pulsing data glow) over one planet / moon picture, made on first use. */
export interface UltramindShellHolder {
    gwShell: { shell: Sprite; glow: Sprite } | null;
}

/**
 * The Ultramind's shell over a planet or moon picture `body` of habitat `h` (mainView.ts updateBodies, after the body
 * is placed): shown while `h` is a finished Ultramind's planet (the last threatLooks record) and the body is drawn,
 * the sprites inserted right above the body in `parent`.
 */
export function syncUltramindShell(parent: Container, holder: UltramindShellHolder, body: Sprite, h: Habitat, sec: number): void {
    const ums = looks.ultramindPlanets;
    const site = ums === undefined || ums.size === 0 ? undefined : ums.get(h);
    const shellTex = site !== undefined && body.visible ? gwTexture('ultramind-shell') : null;
    const glowTex = shellTex !== null ? gwTexture('ultramind-shell-glow') : null;
    if (site === undefined || shellTex === null || glowTex === null) {
        if (holder.gwShell !== null) holder.gwShell.shell.visible = holder.gwShell.glow.visible = false;
        return;
    }
    if (holder.gwShell === null) {
        const shell = new Sprite(shellTex);
        const glow = new Sprite(glowTex);
        shell.anchor.set(0.5);
        glow.anchor.set(0.5);
        glow.blendMode = 'add';
        shell.eventMode = glow.eventMode = 'none';
        const at = parent.getChildIndex(body) + 1;
        parent.addChildAt(shell, at);
        parent.addChildAt(glow, at + 1);
        holder.gwShell = { shell, glow };
    }
    const { shell, glow } = holder.gwShell;
    const side = body.scale.x * body.texture.width * ULTRAMIND_SHELL_SCALE;
    for (const s of [shell, glow]) {
        s.visible = true;
        s.position.copyFrom(body.position);
        s.scale.set(side / s.texture.width);
        s.alpha = body.alpha;
    }
    glow.alpha = body.alpha * gwUltramindPulse(sec);
    glow.tint = site.awakened === true ? 0xff3a2a : 0xffffff;
}
