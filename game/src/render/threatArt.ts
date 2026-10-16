// Threat looks (render only): the Generation Ships' centuries-old fleets and the Dead Probe Swarm's own art.
//
// The generation ships are runtime looks over the stock frames from the player's install; the swarm and the Purifier
// draw bundled frames of our own (derived from stock pieces by offline scripts). Factions are found through the threats' scenario state (peekGenShipsState /
// peekProbeSwarmState: read only, never created), never by name.
//
// - Generation ships: every object of the faction (and the world ship, whoever holds it) wears the 19r wear layer
//   (liveryLayer.ts) forced to its oldest bucket with a few old scars, under a faded, yellowed sprite tint; the world
//   ship is drawn WORLD_SHIP_VISUAL_SCALE × its stock size (the drawn size feeds picking, the selection ring and the
//   ambient exhaust, so all stay consistent).
// - Probe swarm: every swarm hull draws our bundled dark-slate derelict frames (public/art/probe-swarm/,
//   scripts/probe-swarm-ships.py: new silhouettes kitbashed from stock pieces, one per role) instead of its race's art;
//   picked by role (swarmArtUrl), render only. The Mothercore is drawn larger, with a slow, subdued core glow
//   (SwarmFxLayer, one pooled additive sprite).
// - The Purifier: its escorts, guards and repair station draw our bundled aged-bronze Shakturi frames
//   (public/art/purifier/, scripts/purifier-ships.py) instead of their race's art; the planet destroyer keeps the stock
//   other/planetdestroyer.png. Picked by subRole (purifierArtUrl), render only: the sim's pictureRef is untouched.

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
import { SpritePool } from './fxCommon';

// ---------------------------------------------------------------------------------------------------------------
// Who is who (once per frame)
// ---------------------------------------------------------------------------------------------------------------

export interface ThreatLooks {
    genFactions: Empire[];
    worldShips: BuiltObject[];
    swarmFaction: Empire | null;
    mothercore: BuiltObject | null;
    /** The Purifier's faction (its escorts / guards / station wear the bronze art) and its repair station. */
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
 * The art URL of a Purifier escort / guard / station (null for everything else, and for the planet destroyer, which keeps
 * the stock planetdestroyer.png). `l` defaults to the record of the last threatLooks call (the ship layer refreshes it
 * every frame), so UI pictures without the galaxy at hand agree with the map.
 */
export function purifierArtUrl(bo: BuiltObject, l: ThreatLooks = looks): string | null {
    if (l.purifierFaction === null || bo.isPlanetDestroyer || bo.actualEmpire !== l.purifierFaction) return null;
    const f = purifierFile(bo, l.purifierDock);
    return f === null ? null : `${PURIFIER_ART_DIR}${f}.png`;
}

export const WORLD_SHIP_VISUAL_SCALE = 2.5;
export const MOTHERCORE_VISUAL_SCALE = 1.6;

/** Visual size multiplier of an object (1 for everything but the world ship / the Mothercore). */
export function threatDrawScale(l: ThreatLooks, bo: BuiltObject): number {
    if (l.worldShips.includes(bo)) return WORLD_SHIP_VISUAL_SCALE;
    if (bo === l.mothercore) return MOTHERCORE_VISUAL_SCALE;
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

/** The bundled threat art of an object (the Purifier's or the probe swarm's), or null for its stock frame. */
export function threatArtUrl(bo: BuiltObject, l: ThreatLooks = looks): string | null {
    if (l.purifierFaction === null && l.swarmFaction === null) return null;
    return purifierArtUrl(bo, l) ?? swarmArtUrl(bo, l);
}

/** The Mothercore's core: a slow 7 s swell, never off, never bright. Pure. */
export function swarmCoreAlpha(sec: number): number {
    return 0.22 + 0.16 * (0.5 + 0.5 * Math.sin((2 * Math.PI * sec) / 7));
}

/** Core glow radius as a fraction of the Mothercore frame's side (the wheel's hub, frame centre). */
export const MOTHERCORE_CORE_FRAC = 0.16;
const CORE: readonly [number, number, number] = [1.0, 0.46, 0.2];
const CORE_GLOW_SIDE = 64;
let coreGlow: Texture | null = null;
/** A broad, soft ember wash (no disc: the light itself is baked into the hub's recesses), built once. */
function coreGlowTexture(): Texture {
    if (coreGlow !== null) return coreGlow;
    const S = CORE_GLOW_SIDE;
    const d = new Uint8ClampedArray(S * S * 4);
    for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
            const r = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2) / (S / 2);
            const a = r >= 1 ? 0 : Math.exp(-r * r * 2.5) * (1 - r) * (1 - r);
            const i = (y * S + x) * 4;
            d[i] = CORE[0] * 255;
            d[i + 1] = CORE[1] * 255;
            d[i + 2] = CORE[2] * 255;
            d[i + 3] = a * 255;
        }
    }
    const t = textureFromRgbaPixels(d, S, S);
    useMinifyingFilter(t);
    coreGlow = t;
    return t;
}

/** The core glow is skipped below this drawn size (px). */
export const SWARM_FX_MIN_PX = 24;

/** The Mothercore's subdued core glow (one pooled additive sprite; nothing allocated per frame). */
export class SwarmFxLayer {
    readonly root = new Container();
    private pool = new SpritePool(this.root);

    constructor() {
        this.root.eventMode = 'none';
    }

    begin(): void {
        this.pool.begin();
    }

    /** The glow over a Mothercore sprite (its transform; `tw` × `th` its texture size). `sec`: the shared wall clock. */
    draw(x: number, y: number, rotation: number, scale: number, ax: number, ay: number, tw: number, th: number, drawnPx: number, sec: number): void {
        if (drawnPx < SWARM_FX_MIN_PX) return;
        const lx = (tw / 2 - ax * tw) * scale;
        const ly = (th / 2 - ay * th) * scale;
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        const s = this.pool.acquire(coreGlowTexture());
        s.blendMode = 'add';
        s.anchor.set(0.5);
        s.position.set(x + lx * cos - ly * sin, y + lx * sin + ly * cos);
        s.rotation = 0;
        s.scale.set((Math.max(tw, th) * MOTHERCORE_CORE_FRAC * 2 * scale) / CORE_GLOW_SIDE);
        s.alpha = swarmCoreAlpha(sec);
    }

    end(): void {
        this.pool.end();
    }
}
