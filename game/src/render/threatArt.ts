// Threat looks (render only): the Generation Ships' centuries-old fleets, the Dead Probe Swarm's and the Purifier's art.
//
// The three draw bundled frames of our own (derived from stock pieces by offline scripts). Factions are found through
// the threats' scenario state (genShipsStates / peekProbeSwarmState / peekPurifierState: read only, never created),
// never by name.
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

import { Container, type Texture } from 'pixi.js';
import type { Galaxy } from '../sim/galaxy';
import type { BuiltObject } from '../sim/builtObject';
import type { Empire } from '../sim/empire';
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
}

const looks: ThreatLooks = { genFactions: [], worldShips: [], swarmFaction: null, mothercore: null, purifierFaction: null, purifierDock: null };

/** The threat factions / flagships this frame (a shared record, refreshed in place). */
export function threatLooks(galaxy: Galaxy): ThreatLooks {
    looks.genFactions.length = 0;
    looks.worldShips.length = 0;
    looks.swarmFaction = looks.mothercore = null;
    looks.purifierFaction = looks.purifierDock = null;
    if (galaxy.scenario === null) return looks;
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

/** Visual size multiplier of an object (1 for everything but the world ship, the Mothercore and the Purifier). */
export function threatDrawScale(l: ThreatLooks, bo: BuiltObject): number {
    if (l.worldShips.includes(bo)) return WORLD_SHIP_VISUAL_SCALE;
    if (bo === l.mothercore) return MOTHERCORE_VISUAL_SCALE;
    if (bo.isPlanetDestroyer && l.purifierFaction !== null && bo.actualEmpire === l.purifierFaction) return PURIFIER_VISUAL_SCALE;
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

/** The bundled threat art of an object (the generation ships', the Purifier's or the probe swarm's), or null for its stock frame. */
export function threatArtUrl(bo: BuiltObject, l: ThreatLooks = looks): string | null {
    if (l.purifierFaction === null && l.swarmFaction === null && l.genFactions.length === 0 && l.worldShips.length === 0) return null;
    return genShipsArtUrl(bo, l) ?? purifierArtUrl(bo, l) ?? swarmArtUrl(bo, l);
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
