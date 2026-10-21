// Faction markers: ship/base role symbols, fleet icons, faction system rings, system-name decorations and
// station-presence discs. Ports of the original's symbol / galaxy-level passes:
//
// 1. Faction system rings — MainView.2.cs method_250 draws, for every system with a DominantEmpire the viewing empire
//    has explored or sees, at f > 150 (num16, line 5153), a circle around the star in the dominant empire's MainColor
//    (method_268, 6660-6672: pen width 3, dashed when SystemInfo.IsDisputed; drawn at line 5399) of radius
//    val3 = max(Galaxy.MaxSolarSystemSize, TotalStrategicValue^0.35 * 600) / f px (5239-5240, 5337-5343), pushed out
//    to (star icon px)/2 + 3 when it would hug the icon (5346-5374), at FULL alpha: method_250 (5071) sets int_15 = 255,
//    discarding the clamp((f - 70) * 1.2, 0, 255) its caller passes (MainView.cs 1540-1548).
//
// 2. System-name decorations — method_250 5550-5658: right of the ring (x = star + val3 + 1) come the capital icon
//    (ui/chrome/capital.png at 20 px, 14 px from f >= 4000; fleetLeader.png for a secondary capital,
//    Empire.CapitalSystemStars), then the refuel jerrycan (ui/chrome/refuel.png) when the VIEWING empire's
//    SystemVisibility.IsRefuellingPoint is set, then the system name in method_269's colour (the dominant empire's
//    MainColor for an explored/visible owned system, 6683-6703) and, when SystemInfo.HasRuins, the "∴" ruins glyph:
//    three num43 (3 px, 2 px from f >= 4000) squares in the name colour (5645-5657). Icons and name sit just above
//    the star's centre line (y = star - (LineSpacing + 1)).
//
// 3. Ship/base symbols — two passes, both tinted with ResolveShipSymbolColor (MainView.2.cs 2158-2178) brightened +48
//    (method_226, 3390-3396) and drawn by DrawShipSymbolXna (2440-2497) with the per-role art from
//    images/ui/shipsymbols (method_178 2342-2438: <role>.png outline art, <role>_galaxy.png filled art):
//    a) per-ship pass (MainView.1.cs 1079-1119), used here while f < 150: a symbol behind every ship of
//       max(8 (10 for bases), ship px) px times the role multiplier; outline art at f <= 10, filled art (x1.2) above;
//       alpha max(0.6, f/3) (+48 for non-base ships, 1110-1113); own private ships get none beyond f = 20.
//    b) galaxy pass (MainView.2.cs 5802-6019), used here from f = 150: a filled symbol of num68 px (5955-5980:
//       10, * sqrt(400/f) below f = 400, / (f/4000) beyond 4000, clamped [6, 12] / 15 for bases) x role multiplier
//       x 1.2 for every object the viewing empire can see (IsObjectVisibleToThisEmpireImprecise, 5915-5930), except
//       fleet lead ships (5932-5935, drawn as the fleet icon) and ships in a colonised system that are not enemy /
//       pirate or a space port (5999).
//    The filled symbols get a darker contour (a dark copy drawn 25 % larger beneath).
//
// 4. Fleet icons — method_258 / method_259 (6335-6457): at f > 150 every visible fleet (IsObjectVisibleToThisEmpire(
//    lead, true, false)) draws ui/shipsymbols/fleet.png tinted with its empire's MainColor at the lead ship, num82 px
//    tall (22, * sqrt(400/f) below 400, / (f/4000) beyond 4000, >= 12; 6112-6124) with the fleet's ship count on it
//    (f < 6000) in black or white by the tint's brightness (method_263).
//
// 5. Station-presence discs — EmpireTerritory.cs CalculateEmpireSystemTerritory (313-355), the main view's territory
//    shading while Empire Territory is OFF (MainView.2.cs 262-272): for every system the viewing empire has explored,
//    images/effects/systeminfluence/systeminfluence.png tinted with the owner's MainColor, 150000 * 1.1 world units
//    across (the 8-argument overload passes systemInfluenceSizeFactor 1.0, line 309), drawn at 0.25 alpha
//    (method_236(0.25), MainView.2.cs 241 / 365). Here one disc per empire with KNOWN bases or colonies in the
//    system, its radius growing with sqrt(count) from that size (addition: the original draws one fixed disc).
//    Additions (user calls) for galaxy-zoom visibility: 1.8x the size at 0.4 alpha, a minimum on-screen radius that
//    grows from 9 to 13 px (x up to 1.5 by count) as the view widens, and a cross-fade from the soft glow to a vivid
//    disc (0.55 fill, crisp full-alpha rim in the empire colour) between f = 300 and f = 2500 (presenceGalaxyBlend).
//
// 6. System link lines — method_250 5237-5336: the dotted lines in each empire's MainColor between its linked systems
//    (SystemVisibility.LinkSystemStars), at f > 150 under the rings: systemLinks.ts.
//
// Batching: the symbols (and fleet icons) are particles of one ParticleContainer over a runtime atlas of the
// original symbol art (procedural shapes when the art is missing), the discs a second one; rings one Graphics
// rebuilt only on zoom / data / view changes. Everything lives in world space and is sized by /z in screen px.

import type { BuiltObjectIndex } from './builtObjectIndex';
import { inOwnRenderGroup } from './renderGroups';
import { circleAtScreenRes } from './screenCircle';
import { SELECTION_CIRCLE_WIDTH_PX, applySelectionTint, buildSelectionCircles, symbolSelectionBox } from './selectionCircle';
import { Container, Graphics, Particle, ParticleContainer, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import { makeTextureCanvas, textureFromCanvas } from './textureCanvas';
import type { Camera } from './camera';
import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { BuiltObject } from '../sim/builtObject';
import type { ShipGroup } from '../sim/fleets/shipGroup';
import { BuiltObjectSubRole } from '../sim/builtObjectTypes';
import { BuiltObjectRole } from '../sim/data/designSpecifications';
import { HabitatCategoryType, HabitatType, type SystemInfo } from '../sim/types';
import { SystemVisibilityStatus } from '../sim/visibility';
import { peekProbeSwarmState } from '../sim/scenario/threats/probeSwarm';
import { fogOf } from './fog';
import { isObjectVisibleToThisEmpire, isObjectVisibleToThisEmpireImprecise } from '../sim/independentTraders';
import type { MapOverlayState } from '../ui/mapOverlays';
import { getSettings, type UiSettings } from '../ui/settings';
import { displayColorForEmpire } from '../sim/empireColors';
import { mothballGrey, mothballGreyColor } from '../sim/scenario/mothballing/types';
import { galaxyStarDate } from '../sim/tick/simTime';
import { useMinifyingFilter } from './assets';
import { DrawSig, boundsOnScreen } from './drawCache';
import { showsMapIndicators } from './mainViewDisplay';
import { drawCrossedSwords, habitatUnderFire, shipUnderFire, SWORD_PX_FAR, SWORD_PX_NEAR } from './battleIcons';
import { builtObjectHiddenFromPick, civilianFadeAlpha, warEmpires } from './builtObjectLayer';
import { SystemLinkLayer } from './systemLinks';
import { galaxyViewGates } from './cleanGalaxyView';
import { localViewerEmpire } from '../localViewer';
import { isCloakedContact } from './beaconCloakFx';

// --- constants ----------------------------------------------------------------------------------------------------

/** Zoom factor above which galaxy-level overlays start (MainView.cs 1540: alpha (f - 70) * 1.2). */
export const GALAXY_OVERLAY_MIN_FACTOR = 70;
/** MainView.2.cs:5153 num16 = 150: system rings, fleet icons and (here) the galaxy symbol pass only when f > 150. */
export const SYSTEM_RING_MIN_FACTOR = 150;
/** MainView.1.cs:1115: DrawShipSymbolXna(galaxyLevel: f > 10) — outline art up to f = 10, filled art beyond. */
export const OUTLINE_SYMBOL_MAX_FACTOR = 10;
/** Ring pen width in screen px (method_268: new Pen(color, 3f)). */
export const FACTION_RING_WIDTH_PX = 3;
/** method_236(0.25): the territory / system-influence layer's alpha (MainView.2.cs 241, 365). */
export const PRESENCE_ALPHA = 0.4; // more noticeable (user call; the original's territory alpha is 0.25)
/** CalculateEmpireSystemTerritory: num2 = 150000 * systemInfluenceSizeFactor (1.0), drawn (num2 + 0.5) * 1.1 across. */
export const SYSTEM_INFLUENCE_RADIUS = (150000 * 1.1) / 2;
/** Color.Gray: ResolveShipSymbolColor's colour for unowned / independent objects (MainView.2.cs:2160). */
export const UNOWNED_SYMBOL_COLOR = 0x808080;

// --- pure helpers -------------------------------------------------------------------------------------------------

export type MarkerShape = 'square' | 'hexagon' | 'triangle' | 'circle' | 'diamond';

/**
 * Role shape of a built object's sub-role (DrawShipSymbol's per-role shapes, MainView.2.cs 2219-2336): construction
 * ships squares, every base/station hexagons, warships (incl. troop ships, carriers, resupply) triangles, exploration
 * and colony ships diamonds, private civilian ships (freighters, passenger liners, mining ships) circles. Used for the
 * procedural stand-in art when the install's ui/shipsymbols images are missing.
 */
export function markerShapeForSubRole(subRole: BuiltObjectSubRole): MarkerShape | null {
    switch (subRole) {
        case BuiltObjectSubRole.ConstructionShip:
            return 'square';
        case BuiltObjectSubRole.GasMiningStation:
        case BuiltObjectSubRole.MiningStation:
        case BuiltObjectSubRole.SmallSpacePort:
        case BuiltObjectSubRole.MediumSpacePort:
        case BuiltObjectSubRole.LargeSpacePort:
        case BuiltObjectSubRole.ResortBase:
        case BuiltObjectSubRole.GenericBase:
        case BuiltObjectSubRole.EnergyResearchStation:
        case BuiltObjectSubRole.WeaponsResearchStation:
        case BuiltObjectSubRole.HighTechResearchStation:
        case BuiltObjectSubRole.MonitoringStation:
        case BuiltObjectSubRole.DefensiveBase:
            return 'hexagon';
        case BuiltObjectSubRole.Escort:
        case BuiltObjectSubRole.Frigate:
        case BuiltObjectSubRole.Destroyer:
        case BuiltObjectSubRole.Cruiser:
        case BuiltObjectSubRole.CapitalShip:
        case BuiltObjectSubRole.TroopTransport:
        case BuiltObjectSubRole.Carrier:
        case BuiltObjectSubRole.ResupplyShip:
            return 'triangle';
        case BuiltObjectSubRole.ExplorationShip:
        case BuiltObjectSubRole.ColonyShip:
            return 'diamond';
        case BuiltObjectSubRole.SmallFreighter:
        case BuiltObjectSubRole.MediumFreighter:
        case BuiltObjectSubRole.LargeFreighter:
        case BuiltObjectSubRole.PassengerShip:
        case BuiltObjectSubRole.GasMiningShip:
        case BuiltObjectSubRole.MiningShip:
            return 'circle';
        default:
            return null;
    }
}

/** The images/ui/shipsymbols art names (method_178 / Main.Part12.cs 320-336). */
export const SYMBOL_ART = ['base', 'miningstation', 'construction', 'exploration', 'freighter', 'military', 'miningship', 'passengership'] as const;
export type SymbolArt = (typeof SYMBOL_ART)[number];

/** Port of MainView.2.cs method_178 (2342-2438): the symbol art for a built object's role (bases by sub-role). */
export function symbolArtFor(role: BuiltObjectRole, subRole: BuiltObjectSubRole): SymbolArt | null {
    switch (role) {
        case BuiltObjectRole.Military:
            return 'military';
        case BuiltObjectRole.Freight:
            return 'freighter';
        case BuiltObjectRole.Passenger:
            return 'passengership';
        case BuiltObjectRole.Exploration:
        case BuiltObjectRole.Colony:
            return 'exploration';
        case BuiltObjectRole.Build:
            return 'construction';
        case BuiltObjectRole.Resource:
            return 'miningship';
        case BuiltObjectRole.Base:
            if (subRole === BuiltObjectSubRole.GasMiningStation || subRole === BuiltObjectSubRole.MiningStation) return 'miningstation';
            return markerShapeForSubRole(subRole) === 'hexagon' ? 'base' : null;
        default:
            return null;
    }
}

/** Procedural stand-in shape for each art name. */
const ART_SHAPE: Record<SymbolArt, MarkerShape> = {
    base: 'hexagon',
    miningstation: 'hexagon',
    construction: 'square',
    exploration: 'diamond',
    freighter: 'circle',
    military: 'triangle',
    miningship: 'circle',
    passengership: 'circle',
};

/** DrawShipSymbolXna's size multiplier (MainView.2.cs 2448-2477), x1.2 more for galaxy-level (filled) symbols. */
export function symbolSizeMultiplier(role: BuiltObjectRole, subRole: BuiltObjectSubRole, galaxyLevel: boolean): number {
    let num = 1.2;
    if (role === BuiltObjectRole.Military) {
        num = 1.4;
    } else if (role !== BuiltObjectRole.Exploration && role !== BuiltObjectRole.Colony) {
        if (subRole !== BuiltObjectSubRole.MiningShip && subRole !== BuiltObjectSubRole.GasMiningShip) {
            if (subRole === BuiltObjectSubRole.PassengerShip) num = 1.6;
            else if (subRole === BuiltObjectSubRole.MiningStation || subRole === BuiltObjectSubRole.GasMiningStation) num = 1.8;
        } else {
            num = 1.3;
        }
    } else {
        num = 1.5;
    }
    return galaxyLevel ? num * 1.2 : num;
}

/** Port of MainView.2.cs 5955-5980 num68: galaxy-level ship symbol base size in screen px at zoom factor f. */
export function shipSymbolPx(f: number, isBase: boolean): number {
    let num68 = 10;
    if (f < 400.0) num68 = Math.trunc(num68 * Math.sqrt(400.0 / f));
    if (f > 4000.0) num68 = Math.trunc(num68 / (f / 4000.0));
    if (num68 < 6) num68 = 6;
    return Math.min(num68, isBase ? 15 : 12);
}

/** Port of MainView.2.cs 6112-6124 num82: fleet icon height in screen px. */
export function fleetIconPx(f: number): number {
    let num82 = 22;
    if (f < 400.0) num82 = Math.trunc(num82 * Math.sqrt(400.0 / f));
    if (f > 4000.0) num82 = Math.trunc(num82 / (f / 4000.0));
    return Math.max(12, num82);
}

/** MainView.1.cs 1094-1103: the per-ship symbol base size — the drawn ship size, at least 8 px (10 for bases). */
export function perShipSymbolPx(shipPx: number, isBase: boolean): number {
    return Math.max(isBase ? 10 : 8, shipPx);
}

/** Which symbol pass draws at zoom factor f: per-ship outline (f <= 10), per-ship filled (10 < f <= 150), galaxy. */
export type SymbolBand = 'outline' | 'filled' | 'galaxy';
export function symbolBand(f: number): SymbolBand {
    if (f <= OUTLINE_SYMBOL_MAX_FACTOR) return 'outline';
    if (f <= SYSTEM_RING_MIN_FACTOR) return 'filled';
    return 'galaxy';
}

/** Render-only (not in the original): the f at which the per-ship filled symbols are fully in. Between
 *  OUTLINE_SYMBOL_MAX_FACTOR and this the outline frame cross-fades into the filled symbol (symbolFilledBlend). */
export const FILLED_SYMBOL_FULL_FACTOR = 13;

/**
 * 0 .. 1 share of the filled look of a per-ship symbol at zoom factor f: 0 up to f = 10 (outline only, as the original),
 * smoothstep to 1 at f = FILLED_SYMBOL_FULL_FACTOR. The original swaps a faint hollow frame for a solid symbol 1.2 x
 * bigger at f = 10, which pops a blue blob over every colony with ships or stations in orbit (twice the planet's own
 * size) just as the planet itself stops shrinking (planetZoomFactor): the planet seems to "get bigger".
 */
export function symbolFilledBlend(f: number): number {
    if (f <= OUTLINE_SYMBOL_MAX_FACTOR) return 0;
    if (f >= FILLED_SYMBOL_FULL_FACTOR) return 1;
    const u = (f - OUTLINE_SYMBOL_MAX_FACTOR) / (FILLED_SYMBOL_FULL_FACTOR - OUTLINE_SYMBOL_MAX_FACTOR);
    return u * u * (3 - 2 * u);
}

/** Render-only softening of the role markers (not in the original). */
const OUTLINE_MARKER_ALPHA = 0.45;
const FILLED_MARKER_ALPHA = 0.85;

/** ResolveShipSymbolColor's alpha (MainView.2.cs 2169-2175: max(0.6, f/3) <= 1) plus MainView.1.cs 1110-1113's +48
 * for non-base, non-independent ships; unowned / independent objects stay opaque grey; galaxy-level symbols are
 * opaque (DrawShipSymbolXna 2474-2477). */
export function symbolAlpha(f: number, owned: boolean, isBase: boolean): number {
    if (!owned || f > OUTLINE_SYMBOL_MAX_FACTOR) return 1;
    let a = Math.trunc(Math.min(1, Math.max(0.6, f / 3)) * 255);
    if (!isBase) a = Math.min(255, a + 48);
    return a / 255;
}

/** MainView.cs 1540-1548: int_15 = clamp((int)((f - 70) * 1.2), 0, 255), as 0..1 — method_250's overlay alpha. */
export function galaxyOverlayAlpha(f: number): number {
    return Math.max(0, Math.min(255, Math.trunc((f - GALAXY_OVERLAY_MIN_FACTOR) * 1.2))) / 255;
}

/**
 * Faction ring alpha: gated at f > 150 (MainView.2.cs:5153 / 5395), then FULL: method_250 (5069-5071) and its GDI
 * twin method_248 (3982-3984) overwrite the int_15 argument (the MainView.cs 1540 ramp) with 255 before method_268 /
 * method_269 build the pen and brush from it.
 */
export function factionRingBandAlpha(f: number): number {
    return f > SYSTEM_RING_MIN_FACTOR ? 1 : 0;
}

/** Dead Probe Swarm presence: a cold, dark slate (its derelict hulls' blue-grey). */
const SWARM_SLATE = 0x4f5f74;

/** Presence disc alpha: the territory layer's 0.25 once zoomed out past system level (the backdrop pass, f > 70). */
export function presenceBandAlpha(f: number): number {
    return f > GALAXY_OVERLAY_MIN_FACTOR ? PRESENCE_ALPHA : 0;
}

/** Station-presence discs show whenever their toggle is on. (They used to hide while Empire Territory was on, which made
 * the toggle look dead since territory starts on: they are now their own layer drawn above the territory.) */
export function stationPresenceVisible(state: Pick<MapOverlayState, 'stationPresence'>): boolean {
    return state.stationPresence;
}

/** Whether the back container (system rings, gas-cloud crosses, links) is shown: at galaxy zoom whatever the toggles.
 * The gas-cloud crosses never depend on an overlay toggle; only the rings and links do (updateRings / links.update). */
export function galaxyBackVisible(f: number): boolean {
    return f > GALAXY_OVERLAY_MIN_FACTOR;
}

/** Presence disc radius in world units for `count` known bases + colonies: the original's fixed system-influence
 * radius for one, growing with sqrt(count), capped at 2.5x (~0.2 M units — a fraction of the 0.5 .. 1.5 M influence
 * range of a colony). */
export function presenceDiscRadius(count: number): number {
    if (count <= 0) return 0;
    // 1.35x the original's system-influence size (user call: 1.8x, cut by 25 %).
    return PRESENCE_SIZE_SCALE * SYSTEM_INFLUENCE_RADIUS * Math.min(2.5, 0.6 + 0.4 * Math.sqrt(count));
}

/** Presence discs drawn larger than the original's system-influence radius (user call: 1.8x, then 25 % smaller). */
export const PRESENCE_SIZE_SCALE = 1.35;
/** Minimum on-screen presence disc radius (px), so stations stay visible fully zoomed out (user call; 0.75 x 9). */
export const PRESENCE_MIN_SCREEN_PX = 6.75;
/** The minimum radius (px, for one base / colony) once fully at galaxy zoom (user call; 0.75 x 13). */
export const PRESENCE_GALAXY_MIN_SCREEN_PX = 9.75;
/** Alpha of the vivid galaxy-zoom disc (its texture has a 0.55 fill and a full-alpha rim in the empire colour). */
export const PRESENCE_GALAXY_ALPHA = 0.8;
/** Zoom factors over which the discs blend from the soft system-level glow (t = 0) to the vivid galaxy look (t = 1). */
export const PRESENCE_VIVID_FROM_FACTOR = 300;
export const PRESENCE_VIVID_FULL_FACTOR = 2500;

/** 0 .. 1 share of the vivid galaxy-zoom look at zoom factor f: smoothstep over log f (user call, not in the original). */
export function presenceGalaxyBlend(f: number): number {
    if (f <= PRESENCE_VIVID_FROM_FACTOR) return 0;
    if (f >= PRESENCE_VIVID_FULL_FACTOR) return 1;
    const u = Math.log(f / PRESENCE_VIVID_FROM_FACTOR) / Math.log(PRESENCE_VIVID_FULL_FACTOR / PRESENCE_VIVID_FROM_FACTOR);
    return u * u * (3 - 2 * u);
}

/** Minimum on-screen disc radius (px) for `count` bases + colonies at galaxy blend t: grows from PRESENCE_MIN_SCREEN_PX
 * to PRESENCE_GALAXY_MIN_SCREEN_PX and, mildly, with the count (capped at 1.5x) so busier systems stay larger. */
export function presenceMinScreenPx(count: number, t: number): number {
    const base = PRESENCE_MIN_SCREEN_PX + (PRESENCE_GALAXY_MIN_SCREEN_PX - PRESENCE_MIN_SCREEN_PX) * t;
    return base * (1 + (Math.min(1.5, 0.6 + 0.4 * Math.sqrt(Math.max(1, count))) - 1) * t);
}

/**
 * Port of MainView.2.cs method_250's system circle radius in screen px (5239-5240, 5337-5374): val3 =
 * max(MaxSolarSystemSize, min(TotalStrategicValue, 1500000)^0.35 * 600) / f, doubled for black holes, and pushed out to
 * val4/2 + 3 when it would sit inside the star icon (val4 = clamp(diameter / (f / 70), 8, 25)).
 */
export function systemRingRadiusPx(f: number, totalStrategicValue: number, starDiameter: number, maxSolarSystemSize: number, blackHole = false): number {
    const tsv = Math.min(Math.max(0, totalStrategicValue), 1500000);
    let val3 = Math.max(maxSolarSystemSize, Math.pow(tsv, 0.35) * 600.0);
    val3 = Math.trunc(val3 / f);
    if (blackHole) val3 = Math.trunc(val3 * 2.0);
    const val4 = Math.min(Math.max(8, Math.trunc(starDiameter / (f / 70.0))), 25);
    if (blackHole) return Math.max(5, val3);
    if (val3 * 2 - 4 <= val4) val3 = Math.trunc(val4 / 2) + 3;
    return val3;
}

/** method_226(color, n): add n to each channel, clamped (MainView.2.cs:3390-3396). */
export function brighten(rgb: number, n: number): number {
    const r = Math.max(0, Math.min(255, ((rgb >> 16) & 0xff) + n));
    const g = Math.max(0, Math.min(255, ((rgb >> 8) & 0xff) + n));
    const b = Math.max(0, Math.min(255, (rgb & 0xff) + n));
    return (r << 16) | (g << 8) | b;
}

/** method_263 (MainView.2.cs): black text on a bright tint, white on a dark one. */
export function contrastTextColor(rgb: number): number {
    const avg = Math.trunc((((rgb >> 16) & 0xff) + ((rgb >> 8) & 0xff) + (rgb & 0xff)) / 3);
    return avg > 127 ? 0x000000 : 0xffffff;
}

/** An empire's marker colour: its display colour, with the pirates' (1,1,1) black swapped for (48,48,48)
 * (ResolveShipSymbolColor, MainView.2.cs:2172-2175). */
export function empireMarkerColor(empire: Empire): number {
    const c = displayColorForEmpire(empire) & 0xffffff;
    if (c === 0x010101 || c === 0) return 0x303030;
    return c;
}

/** A symbol or fleet icon drawn this frame (world position, half size in screen px) — the pick candidates. */
export interface DrawnSymbol {
    bo: BuiltObject;
    /** Set for a fleet icon: picking it selects the fleet. */
    group: ShipGroup | null;
    x: number;
    y: number;
    halfPx: number;
}

/**
 * The drawn symbol under world point (wx, wy) at zoom z (px per world unit): fleet icons first (they draw on top,
 * method_258 after the symbol pass), then the nearest symbol whose box (half size + 2 px slop) holds the point.
 * Among fleet icons the topmost (last drawn) whose box holds the point wins: fleets docked together (e.g. at the
 * capital) draw their icons over one another, and the click goes to the one seen on top. (method_145 takes the
 * nearest lead ship, Main.Part11.cs 1378-1395; with coincident icons that is whichever comes first, not the visible one.)
 */
export function pickDrawnSymbol(drawn: readonly DrawnSymbol[], wx: number, wy: number, z: number): DrawnSymbol | null {
    let best: DrawnSymbol | null = null;
    let bestD = Infinity;
    let bestFleet = false;
    for (const d of drawn) {
        const r = (d.halfPx + 2) / z;
        const dx = Math.abs(d.x - wx);
        const dy = Math.abs(d.y - wy);
        if (dx > r || dy > r) continue;
        const isFleet = d.group !== null;
        const dist = dx * dx + dy * dy;
        if (isFleet || (!bestFleet && dist < bestD)) {
            best = d;
            bestD = dist;
            bestFleet = isFleet;
        }
    }
    return best;
}

/**
 * A left click on stacked fleet icons (ours: the original has no way to reach a covered fleet): the topmost icon under
 * the point, or, when the selected fleet is one of the icons there, the next one down (wrapping), so repeated clicks
 * on the same spot cycle through the stack. Anything else: pickDrawnSymbol.
 */
export function pickDrawnSymbolCycling(drawn: readonly DrawnSymbol[], wx: number, wy: number, z: number, selected: ShipGroup | null): DrawnSymbol | null {
    const top = pickDrawnSymbol(drawn, wx, wy, z);
    if (top === null || top.group === null || selected === null) return top;
    // The fleet icons under the point, topmost first.
    let selAt = -1;
    const stack: DrawnSymbol[] = [];
    for (let i = drawn.length - 1; i >= 0; i--) {
        const d = drawn[i];
        if (d.group === null) continue;
        const r = (d.halfPx + 2) / z;
        if (Math.abs(d.x - wx) > r || Math.abs(d.y - wy) > r) continue;
        if (d.group === selected) selAt = stack.length;
        stack.push(d);
    }
    return selAt < 0 ? top : stack[(selAt + 1) % stack.length];
}

/** What a single left click on a pick selects: the fleet for a fleet icon, else the ship/base. */
export function clickSelection(hit: Pick<DrawnSymbol, 'bo' | 'group'>): BuiltObject | ShipGroup {
    return hit.group ?? hit.bo;
}

/** Port of Main.Part7.cs mainView_MouseDoubleClick 3494-3502: double-clicking one of the player's own ships that
 * belongs to a fleet selects the whole fleet; anything else selects nothing new (null). */
export function doubleClickFleet(bo: Pick<BuiltObject, 'empire' | 'shipGroup'>, player: Empire | null): ShipGroup | null {
    if (player === null || bo.empire !== player) return null;
    const g = bo.shipGroup as ShipGroup | null;
    return g ?? null;
}

/** Galaxy/sector zoom: only a fleet's LEAD ship is represented by the fleet icon; the other members keep their own
 * symbols, drawn under the icon (MainView.2.cs 5932-5935; user 2026-10-21: fleet ships keep their individual icons —
 * this reverts the earlier fleet-icon-only rule). At system zoom every ship draws. */
export function drawnAsFleet(bo: Pick<BuiltObject, 'shipGroup'>): boolean {
    const g = bo.shipGroup as ShipGroup | null;
    return g != null && g.leadShip != null && g.ships.length > 0 && g.leadShip === bo;
}

/** XnaDrawingHelper.DrawCircle(..., dashed) (XnaDrawingHelper.cs 777-810, 30 segments via the Rectangle overload
 * 813-821): the even segments of a `segmentCount`-gon are drawn, the odd ones skipped. Angles in radians. */
export function dashedCircleArcs(segmentCount = 30): Array<[number, number]> {
    const step = (Math.PI * 2) / segmentCount;
    const out: Array<[number, number]> = [];
    for (let i = 0; i < segmentCount; i += 2) out.push([i * step, (i + 1) * step]);
    return out;
}

/** method_268 (MainView.2.cs 6660-6687): the system ring / cross pen. An owned system the viewer knows: the owner's
 * colour, 3 px, dashed when disputed; otherwise 1.5 px grey (112,112,112) when explored / visible, (60,60,120) when not. */
export function systemRingPen(status: SystemVisibilityStatus, ownerColor: number | null, disputed: boolean): { color: number; widthPx: number; dashed: boolean } {
    const known = status === SystemVisibilityStatus.Explored || status === SystemVisibilityStatus.Visible;
    if (ownerColor !== null && known) return { color: ownerColor, widthPx: 3, dashed: disputed };
    return { color: known ? 0x707070 : 0x3c3c78, widthPx: 1.5, dashed: false };
}

/** Gas-cloud cross half-length in px (MainView.2.cs 5337-5347, 5364-5366, 5390-5394): val3 computed like the ring,
 * x0.7, at least 6, then x0.7 again for the arms. */
export function gasCloudCrossHalfPx(f: number, totalStrategicValue: number, maxSolarSystemSize: number): number {
    const tsv = Math.min(Math.max(0, totalStrategicValue), 1500000);
    let val3 = Math.trunc(Math.max(maxSolarSystemSize, Math.pow(tsv, 0.35) * 600.0) / f);
    val3 = Math.trunc(val3 * 0.7);
    val3 = Math.max(6, val3);
    return val3 * 0.7;
}

/** method_258 6406-6428: a fleet's name is drawn unless it sits in a system its own empire dominates. */
export function fleetNameShown(sg: Pick<ShipGroup, 'leadShip' | 'empire' | 'name'>, systems: readonly Pick<SystemInfo, 'dominantEmpire'>[]): boolean {
    if (sg.name === null || sg.name === '') return false;
    const star = sg.leadShip?.nearestSystemStar ?? null;
    if (star !== null) {
        const dom = systems[star.systemIndex]?.dominantEmpire ?? null;
        if (dom !== null && dom.empire === sg.empire) return false;
    }
    return true;
}

export type GalaxyViewDisplay = Pick<
    UiSettings,
    | 'galaxyViewDisplayFleets'
    | 'galaxyViewDisplayResupplyShips'
    | 'galaxyViewDisplayMilitaryShips'
    | 'galaxyViewDisplaySpacePorts'
    | 'galaxyViewDisplayOtherBases'
    | 'galaxyViewDisplayExplorationShips'
    | 'galaxyViewDisplayColonyShips'
    | 'galaxyViewDisplayConstructionShips'
    | 'galaxyViewDisplayCivilianShips'
    | 'galaxyViewDisplayAlwaysEnemyFleets'
    | 'galaxyViewDisplayAlwaysEnemyMilitaryShips'
    | 'galaxyViewDisplayAlwaysPirates'
>;

/** method_250 5114-5128: the GalaxyViewDisplay* options only apply beyond zoom factor 3500 (and never in god mode). */
export const GALAXY_VIEW_OPTIONS_MIN_FACTOR = 3500;

/**
 * Port of the galaxy symbol pass's type switch (MainView.2.cs 5853-5912): whether a sub-role shows at zoom factor f.
 * `enemy` = flag30 (a pirate empire's object or one at war with the viewer). flag31 (AlwaysPirates) is never set in
 * that loop in the original, so "Always show Pirates" has no effect here either.
 */
export function galaxyViewTypeShown(subRole: BuiltObjectSubRole, opts: GalaxyViewDisplay, enemy: boolean, f: number): boolean {
    if (f <= GALAXY_VIEW_OPTIONS_MIN_FACTOR) return true;
    switch (subRole) {
        case BuiltObjectSubRole.Escort:
        case BuiltObjectSubRole.Frigate:
        case BuiltObjectSubRole.Destroyer:
        case BuiltObjectSubRole.Cruiser:
        case BuiltObjectSubRole.CapitalShip:
        case BuiltObjectSubRole.TroopTransport:
        case BuiltObjectSubRole.Carrier:
            return opts.galaxyViewDisplayMilitaryShips || (enemy && opts.galaxyViewDisplayAlwaysEnemyMilitaryShips);
        case BuiltObjectSubRole.ResupplyShip:
            return opts.galaxyViewDisplayResupplyShips || (enemy && opts.galaxyViewDisplayAlwaysEnemyMilitaryShips);
        case BuiltObjectSubRole.ExplorationShip:
            return opts.galaxyViewDisplayExplorationShips;
        case BuiltObjectSubRole.ColonyShip:
            return opts.galaxyViewDisplayColonyShips;
        case BuiltObjectSubRole.ConstructionShip:
            return opts.galaxyViewDisplayConstructionShips;
        case BuiltObjectSubRole.SmallFreighter:
        case BuiltObjectSubRole.MediumFreighter:
        case BuiltObjectSubRole.LargeFreighter:
        case BuiltObjectSubRole.PassengerShip:
        case BuiltObjectSubRole.GasMiningShip:
        case BuiltObjectSubRole.MiningShip:
            return opts.galaxyViewDisplayCivilianShips;
        case BuiltObjectSubRole.SmallSpacePort:
        case BuiltObjectSubRole.MediumSpacePort:
        case BuiltObjectSubRole.LargeSpacePort:
            return opts.galaxyViewDisplaySpacePorts;
        default:
            return markerShapeForSubRole(subRole) === 'hexagon' ? opts.galaxyViewDisplayOtherBases : false;
    }
}

/** method_250 6128-6160: fleets show with the Fleets option; an enemy (war) empire's also with "Always show enemy
 * Fleets". Below f = 3500 every fleet shows. */
export function galaxyViewFleetShown(opts: GalaxyViewDisplay, atWar: boolean, f: number): boolean {
    if (f <= GALAXY_VIEW_OPTIONS_MIN_FACTOR) return true;
    return opts.galaxyViewDisplayFleets || (atWar && opts.galaxyViewDisplayAlwaysEnemyFleets);
}

/** One presence disc: an empire's known bases + colonies in one system. */
export interface StationPresence {
    systemIndex: number;
    empire: Empire;
    count: number;
}

/**
 * Pure collector for the presence discs: per system the viewer has explored (EmpireTerritory.cs:337
 * CheckSystemExplored), per non-independent empire, the number of its live bases the viewer knows (`knownBase`) —
 * at a habitat of the system or within MaxSolarSystemSize of the star — plus its owned planets/moons there. Sorted by
 * system then descending count, so a system's bigger disc draws first (under the smaller).
 */
export function collectStationPresence(
    galaxy: Pick<Galaxy, 'systems' | 'habitats' | 'builtObjects' | 'independentEmpire' | 'maxSolarSystemSize'>,
    explored: (systemIndex: number) => boolean = () => true,
    knownBase: (bo: BuiltObject) => boolean = () => true,
): StationPresence[] {
    const tally = new StationPresenceTally(galaxy, explored);
    for (const bo of galaxy.builtObjects) tally.addBase(bo, knownBase);
    for (const h of galaxy.habitats) tally.addHabitat(h);
    return tally.result();
}

/** collectStationPresence's counts, fed one object at a time (refresh spreads the scan over frames). The result is
 *  sorted on (system, count, empire id), so it does not depend on the order objects were added in. */
export class StationPresenceTally {
    private readonly counts = new Map<number, Map<Empire, number>>();

    constructor(
        private readonly galaxy: Pick<Galaxy, 'systems' | 'independentEmpire' | 'maxSolarSystemSize'>,
        private readonly explored: (systemIndex: number) => boolean,
    ) {}

    private add(sys: number, e: Empire): void {
        if (!this.explored(sys)) return;
        let m = this.counts.get(sys);
        if (m === undefined) {
            m = new Map();
            this.counts.set(sys, m);
        }
        m.set(e, (m.get(e) ?? 0) + 1);
    }

    /** A live base of a non-independent empire the viewer knows, at a habitat of a system or near its star. */
    addBase(bo: BuiltObject | null, knownBase: (bo: BuiltObject) => boolean): void {
        if (bo === null || bo.hasBeenDestroyed || bo.role !== BuiltObjectRole.Base) return;
        const galaxy = this.galaxy;
        const e = bo.empire;
        if (e === null || e === galaxy.independentEmpire) return;
        let sys = -1;
        if (bo.parentHabitat !== null) {
            sys = bo.parentHabitat.systemIndex;
        } else if (bo.nearestSystemStar !== null) {
            const s = bo.nearestSystemStar;
            const dx = bo.xpos - s.xpos;
            const dy = bo.ypos - s.ypos;
            if (dx * dx + dy * dy <= galaxy.maxSolarSystemSize * galaxy.maxSolarSystemSize) sys = s.systemIndex;
        }
        if (sys >= 0 && sys < galaxy.systems.length && knownBase(bo)) this.add(sys, e);
    }

    /** An owned planet / moon (owner, else empire; not independent). */
    addHabitat(h: Galaxy['habitats'][number]): void {
        if (h.category !== HabitatCategoryType.Planet && h.category !== HabitatCategoryType.Moon) return;
        const e = h.owner ?? h.empire;
        if (e === null || e === undefined || e === this.galaxy.independentEmpire) return;
        this.add(h.systemIndex, e);
    }

    result(): StationPresence[] {
        const out: StationPresence[] = [];
        for (const [systemIndex, m] of [...this.counts].sort((a, b) => a[0] - b[0])) {
            const list = [...m].map(([empire, count]) => ({ systemIndex, empire, count }));
            list.sort((a, b) => b.count - a.count || a.empire.empireId - b.empire.empireId);
            out.push(...list);
        }
        return out;
    }
}

/** The empire drawn as a system's owner: SystemInfo.DominantEmpire, else (before updateSystemInfo has run) the
 * owner of its first non-independent colony. */
function systemOwner(sys: SystemInfo, indep: Empire | null): { empire: Empire; tsv: number } | null {
    const dom = sys.dominantEmpire;
    if (dom != null && dom.empire != null) return { empire: dom.empire, tsv: dom.totalStrategicValue };
    for (const h of sys.habitats) {
        if (h.category !== HabitatCategoryType.Planet && h.category !== HabitatCategoryType.Moon) continue;
        const e = h.owner ?? h.empire;
        if (e != null && e !== indep) return { empire: e, tsv: 0 };
    }
    return null;
}

// --- textures -----------------------------------------------------------------------------------------------------

const SYMBOL_DIR = '/assets/dwu/images/ui/shipsymbols';
const CHROME_DIR = '/assets/dwu/images/ui/chrome';
const CELL = 128;
const PAD = 8;
const INNER = CELL - 2 * PAD;
const DISC_SIZE = 128;

/** Atlas cell order: filled galaxy art, outline art, then the fleet icon. */
const CELL_KEYS: readonly string[] = [...SYMBOL_ART.map((a) => `${a}_galaxy`), ...SYMBOL_ART, 'fleet'];

/** A software canvas (its 2D context made with willReadFrequently: no GPU surface; see textureCanvas.ts). */
function makeCanvas(w: number, h: number): HTMLCanvasElement {
    return makeTextureCanvas(w, h).canvas;
}

function traceShape(ctx: CanvasRenderingContext2D, shape: MarkerShape | 'fleet', x0: number, y0: number, s: number): void {
    const cx = x0 + s / 2;
    const cy = y0 + s / 2;
    ctx.beginPath();
    switch (shape) {
        case 'square': {
            const k = s * 0.84;
            ctx.rect(cx - k / 2, cy - k / 2, k, k);
            break;
        }
        case 'hexagon': {
            const r = s / 2;
            for (let i = 0; i < 6; i++) {
                const a = (Math.PI / 3) * i;
                if (i === 0) ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
                else ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
            }
            ctx.closePath();
            break;
        }
        case 'triangle':
            ctx.moveTo(cx, y0);
            ctx.lineTo(x0 + s, y0 + s);
            ctx.lineTo(x0, y0 + s);
            ctx.closePath();
            break;
        case 'fleet':
            ctx.moveTo(x0, y0);
            ctx.lineTo(x0 + s, y0);
            ctx.lineTo(cx, y0 + s);
            ctx.closePath();
            break;
        case 'circle':
            ctx.arc(cx, cy, s * 0.46, 0, Math.PI * 2);
            break;
        case 'diamond':
            ctx.moveTo(cx, y0);
            ctx.lineTo(x0 + s, cy);
            ctx.lineTo(cx, y0 + s);
            ctx.lineTo(x0, cy);
            ctx.closePath();
            break;
    }
}

async function loadImage(url: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

/** The symbol atlas: the install's shipsymbols art (a runtime composite, nothing copied into the repo) or procedural
 * stand-ins per missing image. Each art is fitted to its cell by height; `aspect` is its width / height. */
async function buildSymbolAtlas(): Promise<{ frames: Texture[]; aspect: number[] }> {
    const images = await Promise.all(CELL_KEYS.map((k) => loadImage(`${SYMBOL_DIR}/${k}.png`)));
    const canvas = makeCanvas(CELL * CELL_KEYS.length, CELL);
    const ctx = canvas.getContext('2d')!;
    const aspect: number[] = [];
    CELL_KEYS.forEach((key, i) => {
        const img = images[i];
        const x0 = i * CELL + PAD;
        if (img !== null && img.width > 0 && img.height > 0) {
            const a = img.width / img.height;
            const h = a > 1 ? INNER / a : INNER;
            const w = h * a;
            ctx.drawImage(img, x0 + (INNER - w) / 2, PAD + (INNER - h) / 2, w, h);
            aspect.push(a);
            return;
        }
        const filled = key.endsWith('_galaxy') || key === 'fleet';
        const art = key.replace('_galaxy', '') as SymbolArt;
        traceShape(ctx, key === 'fleet' ? 'fleet' : ART_SHAPE[art], x0, PAD, INNER);
        if (filled) {
            ctx.fillStyle = '#ffffff';
            ctx.fill();
        } else {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3;
            ctx.stroke();
        }
        aspect.push(1);
    });
    const atlas = textureFromCanvas(canvas);
    useMinifyingFilter(atlas);
    const frames = CELL_KEYS.map((_, i) => new Texture({ source: atlas.source, frame: new Rectangle(i * CELL, 0, CELL, CELL) }));
    return { frames, aspect };
}

function buildDiscFallback(): Texture {
    // Two frames side by side (one texture source: a ParticleContainer draws from a single source).
    const c = makeCanvas(2 * DISC_SIZE, DISC_SIZE);
    const ctx = c.getContext('2d')!;
    const h = DISC_SIZE / 2;
    const g = ctx.createRadialGradient(h, h, 0, h, h, h);
    // Gaussian-like falloff to nothing at the rim: reads as a glow, never as a filled circle.
    for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        g.addColorStop(t, `rgba(255,255,255,${(Math.exp(-3.2 * t * t) * (1 - t * t)).toFixed(4)})`);
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, DISC_SIZE, DISC_SIZE);
    // Frame 1 (x DISC_SIZE..2*DISC_SIZE): the vivid galaxy-zoom disc — a flat 0.55 fill easing to 0.4 towards the
    // edge, then a crisp full-alpha rim (~7 % of the radius) with an anti-aliased outer edge.
    const v = ctx.createRadialGradient(DISC_SIZE + h, h, 0, DISC_SIZE + h, h, h);
    v.addColorStop(0, 'rgba(255,255,255,0.55)');
    v.addColorStop(0.6, 'rgba(255,255,255,0.5)');
    v.addColorStop(0.84, 'rgba(255,255,255,0.4)');
    v.addColorStop(0.86, 'rgba(255,255,255,1)');
    v.addColorStop(0.93, 'rgba(255,255,255,1)');
    v.addColorStop(0.97, 'rgba(255,255,255,0)');
    v.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = v;
    ctx.fillRect(DISC_SIZE, 0, DISC_SIZE, DISC_SIZE);
    const tex = textureFromCanvas(c);
    useMinifyingFilter(tex);
    return tex;
}

async function loadTexture(url: string): Promise<Texture | null> {
    const img = await loadImage(url);
    if (img === null) return null;
    const tex = Texture.from(img);
    useMinifyingFilter(tex);
    return tex;
}

// --- layer --------------------------------------------------------------------------------------------------------

/** The Main View's per-system view as this layer needs it (mainView.ts SystemView). */
export interface SystemLabelView {
    system: SystemInfo;
    root: Container;
    nameLabel: Text;
}

/** How often the per-system data (owners, presence, visibility, war list) is recollected. */
const REFRESH_MS = 1000;
/** A refresh pass (refresh / stepRefresh) is spread over frames, REFRESH_UNITS_PER_FRAME units of work a frame: a built
 *  object costs REFRESH_UNITS_OBJECT (its visibility test), a system REFRESH_UNITS_SYSTEM, a habitat 1. A late game
 *  (~23k objects, ~104k habitats, ~4k systems) takes ~12 frames of ~1 ms instead of one 8-14 ms frame a second. */
const REFRESH_UNITS_PER_FRAME = 24000;
const REFRESH_UNITS_OBJECT = 6;
const REFRESH_UNITS_SYSTEM = 8;

interface RefreshPass {
    startedAt: number;
    stage: number;
    cursor: number;
    player: Empire | null;
    explored: (systemIndex: number) => boolean;
    nowMs: number;
    builtObjects: readonly (BuiltObject | null)[];
    habitats: Galaxy['habitats'];
    habitatCount: number;
    visible: Set<BuiltObject>;
    presence: StationPresenceTally;
    underFire: Map<number, number>;
    owners: Map<SystemInfo, { empire: Empire; tsv: number; color: number }>;
    ringList: Array<{ sys: SystemInfo; tsv: number; cross: boolean; pen: { color: number; widthPx: number; dashed: boolean } }>;
    ringsGated: boolean;
    visibleFleets: ShipGroup[];
}

type SelectionLike = { builtObject?: BuiltObject; shipGroup?: ShipGroup; builtObjects?: BuiltObject[] } | null;

export class GalaxyMarkerLayer {
    /** Background part (presence discs, faction rings): inserted under the empire layer. */
    readonly back = new Container();
    /** Symbols, fleet icons, name decorations: above the map layers, under the ship art. */
    readonly front = new Container();
    /** The presence discs: above the empire territory layer (and the rings), so the toggle works with territory on. */
    readonly top = new Container();

    /** Ship position for drawing / picking — swap in the interpolated render position when there is one. */
    positionOf: (bo: BuiltObject) => { x: number; y: number } = (bo) => ({ x: bo.xpos, y: bo.ypos });
    /** Upper bound (world units) on |positionOf(bo) - (xpos, ypos)| this frame (renderInterp.ts
     * builtObjectDrawnOffsetBound), so off-screen objects are culled on their committed position without a sample. */
    drawnOffsetBound: (bo: BuiltObject) => number = () => 0;
    /** Render-side index of the live built objects (set by MainView): the symbol pass visits only those near the view.
     * Null: galaxy.builtObjects. */
    index: BuiltObjectIndex | null = null;
    private nearScratch: BuiltObject[] = [];
    /** Drawn ship-art size in px (builtObjectLayer.drawnSizePx), for the per-ship symbol pass. */
    shipPxOf: (bo: BuiltObject) => number = () => 0;
    /** Current selection (the HUD's), for the method_212 selection boxes at galaxy zoom. */
    getSelection: () => SelectionLike = () => null;

    private readonly discs: ParticleContainer;
    private readonly symbols: ParticleContainer;
    private readonly rings = new Graphics();
    /** The dotted system link lines (systemLinks.ts, method_250 5237-5336), under the rings. */
    readonly links: SystemLinkLayer;
    private readonly overlayG = new Graphics();
    /** method_212 circles (selectionCircle.ts) of the galaxy pass: world space, tinted with method_213's pulse. */
    private readonly selG = new Graphics();
    /** Flat [x, y, box px] of this frame's selection circles (world x / y, screen-px box). */
    private selBoxes: number[] = [];
    /** The render-group wrappers of overlayG / selG: their vertices are group-local float32 and the group matrix goes to
     *  the GPU in float32, so the Graphics are drawn relative to (ox, oy) (the camera centre) and the wrappers sit there
     *  (float64 on the CPU) -- else world coords near 1.8e8 (a 90x90-sector galaxy) quantize to 16 units. */
    private readonly overlayGroup: Container;
    private readonly selGroup: Container;
    private ox = 0;
    private oy = 0;
    /** The selected BuiltObjectList as a set (rebuilt when the selection's array changes). */
    private selListFor: BuiltObject[] | null = null;
    private selListSet: Set<BuiltObject> | null = null;
    /** Shield / hull bars, drawn relative to `symbols.position` (see updateSymbols: the same camera-local origin). */
    private readonly iconLayer = new Container();
    private readonly countLayer = new Container();
    /** The soft system-level glow and the vivid galaxy-zoom disc: two frames of one source (buildDiscFallback). */
    private discTex: Texture;
    private discVividTex: Texture;
    private frames: Texture[] = [];
    private aspect: number[] = [];
    private icons: { capital: Texture | null; secondary: Texture | null; refuel: Texture | null } = { capital: null, secondary: null, refuel: null };
    private readonly symbolPool: Particle[] = [];
    private readonly discPool: Particle[] = [];
    private readonly iconPool: Sprite[] = [];
    private readonly countPool: Text[] = [];
    private readonly decorated = new Set<Text>();
    /** Symbols and fleet icons drawn this frame (pick candidates). */
    private drawn: DrawnSymbol[] = [];
    /** Reused DrawnSymbol records (pushDrawn): updateSymbols lists up to thousands a frame. pickAt's result is read at
     *  once by its callers, so a record being refilled the next frame is fine. */
    private readonly drawnPool: DrawnSymbol[] = [];

    private pushDrawn(bo: BuiltObject, group: ShipGroup | null, x: number, y: number, halfPx: number): void {
        const i = this.drawn.length;
        let d = this.drawnPool[i];
        if (d === undefined) {
            d = { bo, group, x, y, halfPx };
            this.drawnPool.push(d);
        } else {
            d.bo = bo;
            d.group = group;
            d.x = x;
            d.y = y;
            d.halfPx = halfPx;
        }
        this.drawn.push(d);
    }

    private presence: StationPresence[] = [];
    private owners = new Map<SystemInfo, { empire: Empire; tsv: number; color: number }>();
    /** Rings and gas-cloud crosses to draw (method_250 5378-5400). */
    private ringList: Array<{ sys: SystemInfo; tsv: number; cross: boolean; pen: { color: number; widthPx: number; dashed: boolean } }> = [];
    private readonly fleetNamePool: Text[] = [];
    private visibleObjects = new Set<BuiltObject>();
    private visibleFleets: ShipGroup[] = [];
    private knownBases = new Set<BuiltObject>();
    private war: Empire[] = [];
    /** systemIndex -> opacity of the crossed-swords marker (battleIcons.ts), refreshed with the rest. */
    private underFire = new Map<number, number>();
    private lastRefresh = -Infinity;
    /** The refresh pass in progress (spread over frames), if any. */
    private pass: RefreshPass | null = null;
    private dataVersion = 0;
    private ringKey = { z: NaN, v: -1, a: NaN, on: true, x0: 0, y0: 0, x1: 0, y1: 0, sig: '' };
    /** Whether the owned / independent system rings are listed (method_250 5395: !CleanGalaxyView). */
    private ringsGated = true;
    /** The Dead Probe Swarm's faction while it has a presence the viewer knows (dark-slate discs, drawn whatever the presence toggle). */
    private swarmFaction: Empire | null = null;
    private discKey = { z: NaN, v: -1, x: NaN, y: NaN, all: true };

    constructor(
        private readonly galaxy: Galaxy,
        world: Container,
        private readonly overlays: MapOverlayState,
        /** World child to insert `back` beneath (the empire layer root), or null to append. */
        below: Container | null,
    ) {
        const discSrc = buildDiscFallback().source;
        this.discTex = new Texture({ source: discSrc, frame: new Rectangle(0, 0, DISC_SIZE, DISC_SIZE) });
        this.discVividTex = new Texture({ source: discSrc, frame: new Rectangle(DISC_SIZE, 0, DISC_SIZE, DISC_SIZE) });
        const dyn = { position: true, vertex: true, rotation: false, uvs: true, color: true };
        this.discs = new ParticleContainer({ texture: this.discTex, dynamicProperties: dyn });
        this.symbols = new ParticleContainer({ texture: Texture.WHITE, dynamicProperties: dyn });
        this.links = new SystemLinkLayer(galaxy);
        this.back.addChild(this.links.root, this.rings);
        this.top.addChild(this.discs);
        // overlayG (redrawn when its ops change: flushOverlay) is in its own render group (renderGroups.ts). (The battle
        // bars over the ships are combatBars.ts BattleBarLayer, MainView.1.cs 1251-1295.)
        this.overlayGroup = inOwnRenderGroup(this.overlayG);
        this.selGroup = inOwnRenderGroup(this.selG);
        this.front.addChild(this.symbols, this.countLayer, this.overlayGroup, this.iconLayer, this.selGroup);
        const idx = below !== null ? world.children.indexOf(below) : -1;
        if (idx >= 0) world.addChildAt(this.back, idx);
        else world.addChild(this.back);
        world.addChild(this.top);
        world.addChild(this.front);
        this.back.visible = false;
        this.top.visible = false;
        this.front.visible = false;
        void this.loadArt();
    }

    private async loadArt(): Promise<void> {
        // systeminfluence.png is a hard-edged 29 px disc (alpha 255 core); the original's bilinear stretch softens it,
        // so the procedural discs (buildDiscFallback) are used instead of the art.
        const [atlas, capital, secondary, refuel] = await Promise.all([
            buildSymbolAtlas(),
            loadTexture(`${CHROME_DIR}/capital.png`),
            loadTexture(`${CHROME_DIR}/fleetLeader.png`),
            loadTexture(`${CHROME_DIR}/refuel.png`),
        ]);
        if (this.front.destroyed) return;
        this.frames = atlas.frames;
        this.aspect = atlas.aspect;
        this.symbols.texture = atlas.frames[0];
        this.icons = { capital, secondary, refuel };
    }

    /**
     * Recollect the per-system / visibility data at once (the first refresh, or after an option change or a long gap):
     * the same pass refreshes otherwise spread over frames (stepRefresh), run to the end.
     */
    private refresh(): void {
        const p = this.startRefresh(performance.now());
        while (!this.stepRefresh(p, Infinity));
        this.publishRefresh(p);
    }

    private startRefresh(now: number): RefreshPass {
        const g = this.galaxy;
        const player = localViewerEmpire(g);
        const vis = player?.visibility ?? null;
        const explored = (i: number): boolean => vis === null || vis.checkSystemVisibilityStatus(i) >= SystemVisibilityStatus.Explored;
        return {
            startedAt: now,
            stage: 0,
            cursor: 0,
            player,
            explored,
            nowMs: g.nowMs,
            // The built objects as they stand now: a later splice does not shift the scan (its chunks are frames apart).
            builtObjects: (g.builtObjects as readonly (BuiltObject | null)[]).slice(),
            habitats: g.habitats,
            habitatCount: g.habitats.length,
            visible: new Set<BuiltObject>(),
            presence: new StationPresenceTally(g, explored),
            underFire: new Map<number, number>(),
            owners: new Map(),
            ringList: [],
            ringsGated: this.ringsGated,
            visibleFleets: [],
        };
    }

    /**
     * Advance a refresh pass by up to `budget` units of work (REFRESH_UNITS_PER_FRAME per frame; Infinity: to the end).
     * Returns whether it is done. Same tests, same results as one synchronous scan of the state the pass visits: the
     * visible set, known bases, presence tally and fire map do not depend on visiting order.
     */
    private stepRefresh(p: RefreshPass, budget: number): boolean {
        const g = this.galaxy;
        const player = p.player;
        let units = 0;
        // Stage 0: built objects (MainView.2.cs 5915-5930 visibility, bases the player has seen, presence bases, own
        // ships in combat). An object costs REFRESH_UNITS_OBJECT.
        if (p.stage === 0) {
            const bos = p.builtObjects;
            const known = this.knownBases;
            // The swarm's presence follows the system fog (explored systems), not sightings of single stations.
            const swarm = peekProbeSwarmState(g)?.faction ?? null;
            const knownBase = (bo: BuiltObject): boolean => known.has(bo) || (swarm !== null && bo.empire === swarm);
            let i = p.cursor;
            for (; i < bos.length && units < budget; i++, units += REFRESH_UNITS_OBJECT) {
                const bo = bos[i];
                if (bo === null || bo === undefined || bo.hasBeenDestroyed) continue;
                if (player === null || bo.empire === player || isObjectVisibleToThisEmpireImprecise(g, player, bo)) {
                    p.visible.add(bo);
                    if (bo.role === BuiltObjectRole.Base) known.add(bo);
                }
                // (known: final for a live base once its own visibility is in; the cleanup below drops destroyed ones.)
                p.presence.addBase(bo, knownBase);
                if (player !== null) shipUnderFire(p.underFire, player, bo, p.nowMs);
            }
            p.cursor = i;
            if (i < bos.length) return false;
            for (const bo of known) if (bo.hasBeenDestroyed) known.delete(bo);
            p.stage = 1;
            p.cursor = 0;
        }
        // Stage 1: habitats (owned planets / moons for the presence discs, the player's colonies under attack).
        if (p.stage === 1) {
            if (p.habitats !== g.habitats || p.habitats.length !== p.habitatCount) {
                // The habitat list changed mid-pass (rare): start the pass over.
                Object.assign(p, this.startRefresh(p.startedAt));
                return false;
            }
            let i = p.cursor;
            const list = p.habitats;
            for (; i < list.length && units < budget; i++, units++) {
                const h = list[i];
                p.presence.addHabitat(h);
                if (player !== null) habitatUnderFire(p.underFire, player, h);
            }
            p.cursor = i;
            if (i < list.length) return false;
            p.stage = 2;
            p.cursor = 0;
        }
        // Stage 2: systems — owners and the rings / gas-cloud crosses (method_250 5378-5400, method_268's gate).
        if (p.stage === 2) {
            const vis = player?.visibility ?? null;
            const indep = g.independentEmpire;
            const systems = g.systems;
            let i = p.cursor;
            for (; i < systems.length && units < budget; i++, units += REFRESH_UNITS_SYSTEM) {
                const sys = systems[i];
                const idx = sys.systemStar.systemIndex;
                const status = vis !== null ? vis.checkSystemVisibilityStatus(idx) : SystemVisibilityStatus.Visible;
                const o = p.explored(idx) ? systemOwner(sys, indep) : null;
                const color = o !== null ? empireMarkerColor(o.empire) : null;
                const pen = systemRingPen(status, color, sys.isDisputed === true);
                if (sys.systemStar.category === HabitatCategoryType.GasCloud) {
                    // 5390-5394: every gas cloud gets the cross, in method_268's pen.
                    p.ringList.push({ sys, tsv: o?.tsv ?? 0, cross: true, pen });
                    continue;
                }
                if (o !== null) {
                    p.owners.set(sys, { empire: o.empire, tsv: o.tsv, color: color! });
                    if (p.ringsGated) p.ringList.push({ sys, tsv: o.tsv, cross: false, pen });
                } else if (p.ringsGated && p.explored(idx) && (sys.independentColonyCount ?? 0) > 0) {
                    // 5395-5398: known independent colonies get the grey ring.
                    p.ringList.push({ sys, tsv: 0, cross: false, pen });
                }
            }
            p.cursor = i;
            if (i < systems.length) return false;
            p.stage = 3;
        }
        // Stage 3: fleets the player can see (method_258 6340: IsObjectVisibleToThisEmpire(lead, true, false)).
        for (const e of g.empires) {
            if (e === null) continue;
            for (const sgU of e.shipGroups) {
                const sg = sgU as ShipGroup;
                const lead = sg.leadShip;
                if (lead === null || lead.hasBeenDestroyed || sg.ships.length === 0) continue;
                if (player !== null && sg.empire !== player && !isObjectVisibleToThisEmpire(g, player, lead, true, false)) continue;
                p.visibleFleets.push(sg);
            }
        }
        return true;
    }

    /** Make a finished pass's data the drawn data. */
    private publishRefresh(p: RefreshPass): void {
        this.visibleObjects = p.visible;
        this.presence = p.presence.result();
        const sw = peekProbeSwarmState(this.galaxy)?.faction ?? null;
        this.swarmFaction = sw !== null && this.presence.some((q) => q.empire === sw) ? sw : null;
        this.owners = p.owners;
        this.ringList = p.ringList;
        this.visibleFleets = p.visibleFleets;
        this.underFire = p.underFire;
        const player = p.player;
        this.war = player !== null ? warEmpires(player.diplomaticRelations) : [];
        this.dataVersion++;
    }

    /** Per frame, after the system views have updated (their labels get decorated here). */
    update(z: number, cam: Camera, systems: readonly SystemLabelView[] = []): void {
        const f = 1 / z;
        const factionOn = this.overlays.factionMarkers;
        const presenceOn = stationPresenceVisible(this.overlays);
        const swarmOn = this.swarmFaction !== null;
        // GameOptions.CleanGalaxyView (method_250's flag, cleanGalaxyView.ts): no system rings, links or name decorations.
        const gates = galaxyViewGates(getSettings().cleanGalaxyView);
        this.back.visible = galaxyBackVisible(f);
        this.top.visible = f > GALAXY_OVERLAY_MIN_FACTOR && (presenceOn || swarmOn);
        this.front.visible = factionOn;
        this.drawn.length = 0;
        this.overlayOps.length = 0;
        this.ox = cam.x;
        this.oy = cam.y;
        this.overlayGroup.position.set(cam.x, cam.y);
        // overlayG is drawn in screen px (scaled 1/z): Pixi tessellates round joins / caps and circles by their size in
        // local units, so drawing a few-px marker in world units at galaxy zoom (1 px ~ 60000 units) made ~400k vertices.
        this.overlayG.scale.set(1 / z);
        this.selGroup.position.set(cam.x, cam.y);
        this.selBoxes.length = 0;
        this.decorateLabels(systems, f, z, factionOn && gates.systemNames);
        this.flushOverlay();
        if (!this.back.visible && !this.front.visible && !this.top.visible) return;

        const now = performance.now();
        if (gates.systemRings !== this.ringsGated) {
            // The ring list is rebuilt by refresh(): toggling the option takes effect at once.
            this.ringsGated = gates.systemRings;
            this.lastRefresh = -Infinity;
            this.pass = null;
        }
        // Once a second, spread over the next frames (stepRefresh); at once when the data is older than two periods
        // (the first frame, an option change, the layer shown again after a while).
        if (this.pass !== null && now - this.pass.startedAt >= 2 * REFRESH_MS) this.pass = null;
        if (this.pass === null && now - this.lastRefresh >= REFRESH_MS) {
            const stale = now - this.lastRefresh >= 2 * REFRESH_MS;
            this.lastRefresh = now;
            if (stale) this.refresh();
            else this.pass = this.startRefresh(now);
        }
        if (this.pass !== null && this.stepRefresh(this.pass, REFRESH_UNITS_PER_FRAME)) {
            this.publishRefresh(this.pass);
            this.pass = null;
        }

        this.discs.visible = (presenceOn || swarmOn) && presenceBandAlpha(f) > 0;
        if (this.discs.visible) this.updateDiscs(f, z, cam, presenceOn);
        // The gas-cloud crosses are drawn whatever the faction toggle; only the system rings follow it.
        const ringA = factionRingBandAlpha(f);
        this.rings.visible = this.back.visible && ringA > 0;
        if (this.rings.visible) this.updateRings(f, z, cam, ringA, factionOn);
        // Same gate as the rings (method_250 5237: f > num16, in the rings' block), but MainColor at full alpha.
        this.links.update(f, z, cam, factionOn && gates.systemLinks);
        if (this.front.visible && this.frames.length > 0) this.updateSymbols(f, z, cam);
        this.drawSelectionCircles(z);
    }

    // Presence discs ------------------------------------------------------------------------------------------------

    private updateDiscs(f: number, z: number, cam: Camera, all: boolean): void {
        const k = this.discKey;
        const swarm = this.swarmFaction;
        if (k.v === this.dataVersion && k.z === z && k.x === cam.x && k.y === cam.y && k.all === all) return;
        k.all = all;
        k.v = this.dataVersion;
        k.z = z;
        k.x = cam.x;
        k.y = cam.y;
        // Soft glow (the system-level look) cross-fading into the vivid filled disc with a crisp rim in the empire colour
        // as the view widens to galaxy zoom (presenceGalaxyBlend); both are particles of the one container.
        const t = presenceGalaxyBlend(f);
        const softA = presenceBandAlpha(f) * (1 - t);
        const vividA = PRESENCE_GALAXY_ALPHA * t;
        const out = this.discs.particleChildren;
        const prev = out.length;
        let n = 0;
        const put = (x: number, y: number, r: number, tint: number, alpha: number, tex: Texture): void => {
            let part = this.discPool[n];
            if (part === undefined) {
                part = new Particle({ texture: tex, anchorX: 0.5, anchorY: 0.5 });
                this.discPool.push(part);
            }
            // Pooled particles change frame by texture (same source, so no container rebuild is needed).
            if (part.texture !== tex) part.texture = tex;
            part.x = x;
            part.y = y;
            part.scaleX = part.scaleY = (2 * r) / DISC_SIZE;
            part.tint = tint;
            part.alpha = alpha;
            out[n++] = part;
        };
        for (const p of this.presence) {
            const isSwarm = p.empire === swarm;
            if (!all && !isSwarm) continue;
            const star = this.galaxy.systems[p.systemIndex].systemStar;
            const cnt = isSwarm ? 1 : p.count; // the swarm marks the system, not the station count
            const r = Math.max(presenceDiscRadius(cnt), presenceMinScreenPx(cnt, t) / z);
            if (!boundsOnScreen(star.xpos, star.ypos, r, 0, cam.x, cam.y, cam.width, cam.height, z)) continue;
            const tint = isSwarm ? SWARM_SLATE : empireMarkerColor(p.empire);
            if (softA > 0.004) put(star.xpos, star.ypos, r, tint, softA, this.discTex);
            if (vividA > 0.004) put(star.xpos, star.ypos, r, tint, vividA, this.discVividTex);
        }
        // Pooled particles keep their slot, so the container only needs a structural update when the count changes.
        if (prev !== n) {
            out.length = n;
            this.discs.update();
        }
    }

    // Faction rings -------------------------------------------------------------------------------------------------

    private updateRings(f: number, z: number, cam: Camera, alpha: number, ringsOn: boolean): void {
        const k = this.ringKey;
        const hw = cam.width / (2 * z);
        const hh = cam.height / (2 * z);
        const inRect = cam.x - hw >= k.x0 && cam.x + hw <= k.x1 && cam.y - hh >= k.y0 && cam.y + hh <= k.y1;
        if (k.z === z && k.v === this.dataVersion && k.a === alpha && k.on === ringsOn && inRect) return;
        if (k.z === z && k.a === alpha && k.on === ringsOn && inRect) {
            // Only the data was refreshed (once a second): rebuilding this Graphics (thousands of rings at galaxy zoom)
            // costs tens of ms, so redraw only when something drawn in the cull rectangle changed.
            const sig = this.ringSignature(f, z, k.x0, k.y0, k.x1, k.y1);
            k.v = this.dataVersion;
            if (sig === k.sig) return;
        }
        k.z = z;
        k.v = this.dataVersion;
        k.a = alpha;
        k.on = ringsOn;
        // Cull to the view plus half a view on each side, so small pans reuse the geometry.
        k.x0 = cam.x - 2 * hw;
        k.x1 = cam.x + 2 * hw;
        k.y0 = cam.y - 2 * hh;
        k.y1 = cam.y + 2 * hh;
        k.sig = this.ringSignature(f, z, k.x0, k.y0, k.x1, k.y1);
        const g = this.rings;
        g.clear();
        const maxSys = this.galaxy.maxSolarSystemSize;
        const arcs = dashedCircleArcs();
        for (const r of this.ringList) {
            const star = r.sys.systemStar;
            if (!r.cross && !ringsOn) continue;
            const width = r.pen.widthPx / z;
            if (r.cross) {
                const h = gasCloudCrossHalfPx(f, r.tsv, maxSys) / z;
                if (star.xpos + h < k.x0 || star.xpos - h > k.x1 || star.ypos + h < k.y0 || star.ypos - h > k.y1) continue;
                g.moveTo(star.xpos, star.ypos - h).lineTo(star.xpos, star.ypos + h);
                g.moveTo(star.xpos - h, star.ypos).lineTo(star.xpos + h, star.ypos);
                g.stroke({ width, color: r.pen.color, alpha });
                continue;
            }
            const wr = systemRingRadiusPx(f, r.tsv, star.diameter, maxSys, star.type === HabitatType.BlackHole) / z;
            if (star.xpos + wr < k.x0 || star.xpos - wr > k.x1 || star.ypos + wr < k.y0 || star.ypos - wr > k.y1) continue;
            if (r.pen.dashed) {
                // method_268: disputed systems get a dashed pen (XnaDrawingHelper.DrawCircle dashed: 15 of 30 segments).
                for (const [a0, a1] of arcs) {
                    g.moveTo(star.xpos + wr * Math.cos(a0), star.ypos + wr * Math.sin(a0)).lineTo(star.xpos + wr * Math.cos(a1), star.ypos + wr * Math.sin(a1));
                }
                g.stroke({ width, color: r.pen.color, alpha });
            } else {
                circleAtScreenRes(g, star.xpos, star.ypos, wr, z).stroke({ width, color: r.pen.color, alpha });
            }
        }
    }

    /** What updateRings draws inside the cull rectangle (system, pen, integer ring radius / cross half-size), hashed. */
    private ringSignature(f: number, z: number, x0: number, y0: number, x1: number, y1: number): string {
        const maxSys = this.galaxy.maxSolarSystemSize;
        let h1 = 0x811c9dc5 | 0;
        let h2 = 0x01000193 | 0;
        let n = 0;
        const mix = (v: number): void => {
            h1 = Math.imul(h1 ^ v, 0x01000193);
            h2 = Math.imul(h2 + v, 0x5bd1e995) ^ (h2 >>> 15);
        };
        for (const r of this.ringList) {
            const star = r.sys.systemStar;
            const px = r.cross ? gasCloudCrossHalfPx(f, r.tsv, maxSys) : systemRingRadiusPx(f, r.tsv, star.diameter, maxSys, star.type === HabitatType.BlackHole);
            const wr = px / z;
            if (star.xpos + wr < x0 || star.xpos - wr > x1 || star.ypos + wr < y0 || star.ypos - wr > y1) continue;
            n++;
            mix(star.systemIndex);
            mix(r.cross ? 1 : 0);
            mix(Math.round(px * 1024));
            mix(r.pen.color);
            mix(Math.round(r.pen.widthPx * 1024));
            mix(r.pen.dashed ? 1 : 0);
        }
        return `${n}:${h1 >>> 0}:${h2 >>> 0}`;
    }

    // System-name decorations ---------------------------------------------------------------------------------------

    private decorateLabels(systems: readonly SystemLabelView[], f: number, z: number, on: boolean): void {
        let icons = 0;
        const player = localViewerEmpire(this.galaxy);
        for (const sv of systems) {
            const label = sv.nameLabel;
            const shown = on && sv.root.visible && label.visible && f > SYSTEM_RING_MIN_FACTOR;
            if (!shown) {
                if (this.decorated.size > 0 && this.decorated.has(label)) {
                    // Restore the Main View's own look (white, centred under the star; it re-positions every frame).
                    label.anchor.set(0.5, 0);
                    if (label.style.fill !== 0xffffff) label.style.fill = 0xffffff;
                    if (label.style.fontWeight !== 'normal') label.style.fontWeight = 'normal';
                    if (label.style.fontSize !== 11) label.style.fontSize = 11;
                    this.decorated.delete(label);
                }
                // The fight marker is an alert: it stays when the name label is only crowded out by a neighbour's.
                if (on && this.underFire.size > 0 && sv.root.visible && f > SYSTEM_RING_MIN_FACTOR && this.underFire.has(sv.system.systemStar.systemIndex)) {
                    const star = sv.system.systemStar;
                    const owner = this.owners.get(sv.system) ?? null;
                    this.drawFireMarker(star, systemRingRadiusPx(f, owner?.tsv ?? 0, star.diameter, this.galaxy.maxSolarSystemSize, star.type === HabitatType.BlackHole), f, z);
                }
                continue;
            }
            this.decorated.add(label);
            const sys = sv.system;
            const star = sys.systemStar;
            const owner = this.owners.get(sys) ?? null;
            const ringPx = systemRingRadiusPx(f, owner?.tsv ?? 0, star.diameter, this.galaxy.maxSolarSystemSize, star.type === HabitatType.BlackHole);
            const iconPx = f < 4000 ? 20 : 14;
            // method_250 5584-5602: capital (or secondary capital) icon, then the refuel icon, then the name.
            let capTex: Texture | null = null;
            const dom = owner?.empire ?? null;
            if (dom !== null && dom.capital !== null) {
                if (dom.capital.systemIndex === star.systemIndex) capTex = this.icons.capital;
                else if (dom.capitalSystemStars.includes(star)) capTex = this.icons.secondary;
            }
            const refuel = player !== null && (player.visibility.systemVisibility[star.systemIndex]?.isRefuellingPoint ?? false) ? this.icons.refuel : null;
            // Past the ring's outer edge (the 3 px pen is centred on the radius) plus 1 px, then icons, then the name.
            let x = ringPx + FACTION_RING_WIDTH_PX / 2 + 2;
            for (let t = 0; t < 2; t++) {
                const tex = t === 0 ? capTex : refuel;
                if (tex === null) continue;
                const s = this.iconSprite(icons++);
                s.texture = tex;
                s.position.set(star.xpos + x / z, star.ypos - (iconPx - 1) / z);
                s.scale.set(iconPx / (tex.height * z));
                x += iconPx;
            }
            const fill = owner !== null ? owner.color : 0xffffff;
            if (label.style.fill !== fill) label.style.fill = fill;
            // Owned systems use the bigger spriteFont_2 below f = 4000 (5578-5580), spriteFont_0 beyond.
            const weight = owner !== null ? 'bold' : 'normal';
            if (label.style.fontWeight !== weight) label.style.fontWeight = weight;
            const size = owner !== null && f < 4000 ? 13 : 11;
            if (label.style.fontSize !== size) label.style.fontSize = size;
            label.anchor.set(0, 1);
            label.position.set(x / z, 1 / z); // root sits at the star; baseline just above the centre line
            this.drawFireMarker(star, ringPx, f, z);
            // Ruins glyph "∴" (5645-5657): three small squares in the name colour right after the name.
            if (sys.hasRuins === true) {
                const q = f < 4000 ? 3 : 2;
                // label.width / height are world units (the label is scaled 1/z); num42 = 3 px below the text top.
                // overlayG is in screen px relative to (ox, oy).
                const nx = (star.xpos - this.ox) * z + x + label.width * z + 1;
                const ny = (star.ypos - this.oy) * z + 1 - label.height * z + 3;
                this.overlayOps.push(0, nx, ny, q, fill);
            }
        }
        for (let i = icons; i < this.iconPool.length; i++) this.iconPool[i].visible = false;
    }

    /** Crossed swords at the lower-right corner of the ring while the player is fighting in this system. */
    private drawFireMarker(star: { xpos: number; ypos: number; systemIndex: number }, ringPx: number, f: number, z: number): void {
        const fire = this.underFire.get(star.systemIndex);
        if (fire === undefined) return;
        const swordPx = f < 4000 ? SWORD_PX_NEAR : SWORD_PX_FAR;
        const pulse = 0.8 + 0.2 * Math.sin(performance.now() / 250);
        const off = (ringPx + swordPx / 2) * Math.SQRT1_2;
        // overlayG is in screen px relative to (ox, oy) (update): z = 1 for the swords' px -> local scale.
        this.overlayOps.push(1, (star.xpos - this.ox) * z + off, (star.ypos - this.oy) * z + off, swordPx, fire * pulse);
    }

    /** overlayG's ops this frame (decorateLabels: [0, x, y, size, colour] a ruins glyph, [1, x, y, px, alpha] crossed
     * swords), replayed only when they differ from last frame's: overlayG used to be cleared and rebuilt every frame,
     * even with nothing in it. (Pulsing swords still redraw each frame: their alpha changes.) */
    private readonly overlayOps: number[] = [];
    private readonly overlaySig = new DrawSig();
    private flushOverlay(): void {
        const ops = this.overlayOps;
        const sig = this.overlaySig;
        sig.begin();
        for (let i = 0; i < ops.length; i++) sig.push(ops[i]);
        if (!sig.changed()) return;
        const g = this.overlayG;
        g.clear();
        for (let i = 0; i < ops.length; i += 5) {
            const x = ops[i + 1];
            const y = ops[i + 2];
            const q = ops[i + 3];
            if (ops[i] === 0) {
                // Ruins glyph "∴": three small squares.
                g.rect(x, y + 5, q, q).fill({ color: ops[i + 4] });
                g.rect(x + 6, y + 5, q, q).fill({ color: ops[i + 4] });
                g.rect(x + 3, y, q, q).fill({ color: ops[i + 4] });
            } else {
                drawCrossedSwords(g, x, y, q, 1, ops[i + 4]);
            }
        }
    }

    private iconSprite(i: number): Sprite {
        let s = this.iconPool[i];
        if (s === undefined) {
            s = new Sprite();
            s.anchor.set(0, 0);
            this.iconPool.push(s);
            this.iconLayer.addChild(s);
        }
        s.visible = true;
        return s;
    }

    // Symbols + fleet icons -----------------------------------------------------------------------------------------

    private pushSymbol(n: number, cell: number, x: number, y: number, heightPx: number, z: number, tint: number, alpha: number): Particle {
        let part = this.symbolPool[n];
        if (part === undefined) {
            part = new Particle({ texture: this.frames[cell], anchorX: 0.5, anchorY: 0.5 });
            this.symbolPool.push(part);
        }
        part.texture = this.frames[cell];
        part.x = x;
        part.y = y;
        const a = this.aspect[cell] ?? 1;
        // The art is fitted to INNER px by its longer side: scale so its HEIGHT is heightPx (DrawShipSymbolXna).
        const artH = a > 1 ? INNER / a : INNER;
        part.scaleX = part.scaleY = heightPx / (artH * z);
        part.tint = tint;
        part.alpha = alpha;
        this.symbols.particleChildren[n] = part;
        return part;
    }

    /** Positions (in index.live) of the live objects in visibleObjects, in index order: the galaxy pass's candidates.
     *  Recomputed when the live list changes (index.liveVersion) or a refresh replaces the visible set. */
    private candAt = new Int32Array(0);
    private candCount = 0;
    private candLive = -1;
    private candVersion = -1;
    private candIndex: BuiltObjectIndex | null = null;

    private updateGalaxyCandidates(idx: BuiltObjectIndex): void {
        if (this.candIndex === idx && this.candLive === idx.liveVersion && this.candVersion === this.dataVersion) return;
        this.candIndex = idx;
        this.candLive = idx.liveVersion;
        this.candVersion = this.dataVersion;
        const live = idx.live;
        const vis = this.visibleObjects;
        if (this.candAt.length < live.length) this.candAt = new Int32Array(Math.max(live.length, Math.ceil(this.candAt.length * 1.5), 256));
        const at = this.candAt;
        let c = 0;
        if (vis.size > 0) for (let i = 0; i < live.length; i++) if (vis.has(live[i])) at[c++] = i;
        this.candCount = c;
    }

    private updateSymbols(f: number, z: number, cam: Camera): void {
        const g = this.galaxy;
        const player = localViewerEmpire(g);
        const indep = g.independentEmpire;
        const band = symbolBand(f);
        const out = this.symbols.particleChildren;
        const prev = out.length;
        let n = 0;
        const sel = this.getSelection();
        const selBo = sel?.shipGroup === undefined ? (sel?.builtObject ?? null) : null;
        const selGroup = sel?.shipGroup ?? null;
        const selList = sel?.builtObjects ?? null;
        if (selList !== this.selListFor) {
            this.selListFor = selList;
            this.selListSet = selList !== null ? new Set(selList) : null;
        }
        const selSet = this.selListSet;
        const galaxyPass = band === 'galaxy';
        // MainView.1.cs:1080 / 1253 (Main.int_34, mainViewDisplay.ts): display type 2 drops the per-ship symbols, 1 and 2
        // the battle bars. The galaxy pass (MainView.2.cs method_250) does not read it.
        const perShipSymbols = showsMapIndicators();
        // Particle / bar vertices are float32 in the container's local space, and galaxy coordinates run to millions
        // (spacing 0.06 - 0.5 world units), which shows as stepping when a ship glides a fraction of a px per frame.
        // So both containers sit at the camera centre and the markers are placed relative to it (small local numbers).
        const ox = cam.x;
        const oy = cam.y;
        this.symbols.position.set(ox, oy);
        const shipPx = shipSymbolPx(f, false);
        const basePx = shipSymbolPx(f, true);
        const opts: GalaxyViewDisplay = getSettings();
        const fog = fogOf(g);
        // Perf (late games: ~10k built objects, every frame): the tests that do not depend on the drawn position run
        // first, and objects whose committed position is off screen by more than their drawn-position bound are
        // dropped before the (costly) render-interpolated sample. Same symbols, in the same order.
        const pad = 40;
        // The galaxy pass draws only objects in visibleObjects: it visits just those (updateGalaxyCandidates), in the same
        // order and with the same near tests, instead of every live object (~1k of ~17k in a late game).
        const idx = this.index;
        let list: readonly (BuiltObject | null)[];
        if (idx === null) list = g.builtObjects;
        else if (galaxyPass) {
            this.updateGalaxyCandidates(idx);
            list = idx.nearAt(this.candAt, this.candCount, cam.x, cam.y, cam.width / (2 * z), cam.height / (2 * z), (pad + 1) / z, true, this.nearScratch);
        } else list = idx.near(cam.x, cam.y, cam.width / (2 * z), cam.height / (2 * z), (pad + 1) / z, true, this.nearScratch);
        for (const bo of list) {
            if (bo === null || bo.hasBeenDestroyed) continue;
            const art = symbolArtFor(bo.role, bo.subRole);
            if (art === null) continue;
            // Giantworks' Beacon: a detected, still cloaked Watcher is only its outline (beaconCloakFx.ts): no symbol, in either pass.
            if (isCloakedContact(bo, player)) continue;
            const isBase = bo.role === BuiltObjectRole.Base;
            const owned = bo.empire !== null && bo.empire !== indep;
            if (galaxyPass) {
                if (!this.visibleObjects.has(bo)) continue;
                // the fleet icon stands for the whole fleet (a fleet led by a cloaked Watcher has none: its escorts show as ships)
                if (drawnAsFleet(bo) && !isCloakedContact((bo.shipGroup as ShipGroup).leadShip!, player)) continue;
                const enemy = bo.empire !== null && (g.pirateEmpires.includes(bo.empire) || this.war.includes(bo.empire));
                if (!galaxyViewTypeShown(bo.subRole, opts, enemy, f)) continue;
                if (builtObjectHiddenFromPick(bo, g.systems, g.pirateEmpires, this.war)) continue;
            } else {
                if (!perShipSymbols) continue;
                // MainView.1.cs 1083-1088: beyond f = 20 the player's own private ships get no symbol.
                if (f > 20 && !isBase && bo.owner === null && player !== null && bo.empire === player) continue;
            }
            // (The bound only widens the test: computed only for an object whose committed position is off screen.)
            if (!boundsOnScreen(bo.xpos, bo.ypos, 0, pad, cam.x, cam.y, cam.width, cam.height, z) && !boundsOnScreen(bo.xpos, bo.ypos, this.drawnOffsetBound(bo), pad, cam.x, cam.y, cam.width, cam.height, z)) continue;
            // The marker belongs to the ship's draw block: an unseen ship (fog.ts, MainView.1.cs:884) gets none.
            if (!galaxyPass && !fog.builtObject(bo)) continue;
            const pos = this.positionOf(bo);
            if (!boundsOnScreen(pos.x, pos.y, 0, pad, cam.x, cam.y, cam.width, cam.height, z)) continue;
            // Per-ship pass in the cross-fade band (10 < f < 13): the outline frame at its own size fades out while the
            // filled symbol, growing from the outline's size to its x1.2, fades in (symbolFilledBlend).
            const blend = galaxyPass ? 1 : symbolFilledBlend(f);
            const mixed = !galaxyPass && blend > 0 && blend < 1;
            const filled = galaxyPass || blend > 0;
            const unitPx = galaxyPass ? (isBase ? basePx : shipPx) : perShipSymbolPx(this.shipPxOf(bo), isBase);
            const multOutline = symbolSizeMultiplier(bo.role, bo.subRole, false);
            const multFilled = symbolSizeMultiplier(bo.role, bo.subRole, true);
            const heightPx = unitPx * (galaxyPass ? multFilled : multOutline + (multFilled - multOutline) * blend);
            let base = owned ? empireMarkerColor(bo.empire!) : UNOWNED_SYMBOL_COLOR;
            if (bo.mothball !== undefined) base = mothballGreyColor(base, mothballGrey(bo, galaxyStarDate(this.galaxy))); // Mothballing add-on: a ship in reserve is greyer
            const tint = brighten(base, 48);
            // Restyle: the outline frame recedes (it must not out-shout the ship / base it frames); filled markers are a touch softer.
            const symAlpha = symbolAlpha(f, owned, isBase) * civilianFadeAlpha(this.overlays.fadeCivilianShips, bo);
            const artIdx = SYMBOL_ART.indexOf(art);
            if (!filled || mixed) {
                this.pushSymbol(n++, SYMBOL_ART.length + artIdx, pos.x - ox, pos.y - oy, unitPx * multOutline, z, tint, symAlpha * OUTLINE_MARKER_ALPHA * (1 - blend));
            }
            if (filled) {
                // Filled art over a darker, slightly larger copy: the contour.
                const alpha = symAlpha * FILLED_MARKER_ALPHA * blend;
                this.pushSymbol(n++, artIdx, pos.x - ox, pos.y - oy, heightPx + 2.5, z, brighten(base, -96), alpha * 0.9);
                this.pushSymbol(n++, artIdx, pos.x - ox, pos.y - oy, heightPx, z, tint, alpha);
            }
            if (galaxyPass) {
                this.pushDrawn(bo, null, pos.x, pos.y, heightPx / 2);
                // 5984-5996 / 6004-6016: method_212 around the selected ship's symbol, or one of the selected BuiltObjectList.
                if (bo === selBo || (selSet !== null && selSet.has(bo))) this.selBoxes.push(pos.x - this.ox, pos.y - this.oy, symbolSelectionBox(heightPx));
            }
        }
        let counts = 0;
        if (galaxyPass) {
            const iconH = fleetIconPx(f);
            const cell = CELL_KEYS.length - 1;
            let names = 0;
            for (const sg of this.visibleFleets) {
                const lead = sg.leadShip;
                if (lead === null || lead.hasBeenDestroyed) continue;
                if (isCloakedContact(lead, player)) continue; // Giantworks' Beacon: its icon, count and name would give the cloaked Watcher away
                const atWar = sg.empire !== null && this.war.includes(sg.empire);
                if (!galaxyViewFleetShown(opts, atWar, f)) continue;
                const pos = this.positionOf(lead);
                if (!boundsOnScreen(pos.x, pos.y, 0, 40, cam.x, cam.y, cam.width, cam.height, z)) continue;
                // method_259: MainColor tint, (1,1,1) pirates -> (8,8,8).
                const e = sg.empire;
                let color = e !== null ? displayColorForEmpire(e) & 0xffffff : UNOWNED_SYMBOL_COLOR;
                if (color === 0x010101) color = 0x080808;
                if (lead.mothball !== undefined) color = mothballGreyColor(color, mothballGrey(lead, galaxyStarDate(this.galaxy)));
                const fleetFade = civilianFadeAlpha(this.overlays.fadeCivilianShips, lead);
                this.pushSymbol(n++, cell, pos.x - ox, pos.y - oy, iconH, z, color, fleetFade);
                this.pushDrawn(lead, sg, pos.x, pos.y, iconH / 2);
                if (sg === selGroup) this.selBoxes.push(pos.x - this.ox, pos.y - this.oy, iconH); // 6395-6398 method_212 over the icon box
                if (f < 6000) {
                    const t = this.countText(counts++);
                    const s = String(sg.ships.length);
                    if (t.text !== s) t.text = s;
                    const tc = contrastTextColor(color);
                    if (t.style.fill !== tc) t.style.fill = tc;
                    t.position.set(pos.x, pos.y - (iconH / 2 - iconH * 0.1) / z);
                    t.scale.set(1 / z);
                    t.alpha = fleetFade;
                }
                // method_258 6406-6428: the fleet name above-left of the icon, in the empire colour (pirate black -> grey).
                if (fleetNameShown(sg, g.systems)) {
                    const t = this.fleetName(names++);
                    const name = sg.name ?? '';
                    if (t.text !== name) t.text = name;
                    const nc = color === 0x080808 ? 0x808080 : color;
                    if (t.style.fill !== nc) t.style.fill = nc;
                    const fs = f > 4000 ? 10 : 12;
                    if (t.style.fontSize !== fs) t.style.fontSize = fs;
                    t.position.set(pos.x - iconH / 2 / z, pos.y - iconH / 2 / z);
                    t.scale.set(1 / z);
                    t.alpha = fleetFade;
                }
            }
            for (let i = names; i < this.fleetNamePool.length; i++) this.fleetNamePool[i].visible = false;
        } else {
            for (const t of this.fleetNamePool) t.visible = false;
        }
        for (let i = counts; i < this.countPool.length; i++) this.countPool[i].visible = false;
        if (prev !== n) {
            out.length = n;
            this.symbols.update();
        }
    }

    private fleetName(i: number): Text {
        let t = this.fleetNamePool[i];
        if (t === undefined) {
            t = new Text({ text: '', style: { fontSize: 12, fill: 0xffffff, dropShadow: { color: 0x000000, distance: 1, blur: 0, alpha: 1, angle: Math.PI / 4 } } });
            t.anchor.set(0, 1); // (x - icon/2, y - (LineSpacing + icon/2)) is the text's top-left: its bottom sits on the icon top
            this.fleetNamePool.push(t);
            this.countLayer.addChild(t);
        }
        t.visible = true;
        return t;
    }

    private countText(i: number): Text {
        let t = this.countPool[i];
        if (t === undefined) {
            t = new Text({ text: '', style: { fontSize: 10, fontWeight: 'bold', fill: 0xffffff } });
            t.anchor.set(0.5, 0);
            this.countPool.push(t);
            this.countLayer.addChild(t);
        }
        t.visible = true;
        return t;
    }

    /** This frame's method_212 circles (MainView.2.cs 3132): world-space, 5 screen px wide, in method_213's colour. */
    private drawSelectionCircles(z: number): void {
        const g = this.selG;
        const b = this.selBoxes;
        if (b.length === 0) {
            if (g.visible) {
                g.clear();
                g.visible = false;
            }
            return;
        }
        // Box widths are screen px: the circle radius in world units is box / 2 / z.
        for (let i = 2; i < b.length; i += 3) b[i] = b[i] / z;
        buildSelectionCircles(g, b, SELECTION_CIRCLE_WIDTH_PX / z);
        applySelectionTint(g, new Date());
        g.visible = true;
    }

    /** The symbol or fleet icon drawn at world point (wx, wy) in the last frame (galaxy/sector zoom only). */
    pickAt(wx: number, wy: number, z: number): DrawnSymbol | null {
        if (!this.front.visible) return null;
        return pickDrawnSymbol(this.drawn, wx, wy, z);
    }

    /** A left click at world point (wx, wy): as pickAt, but repeated clicks on stacked fleet icons cycle through them
     *  (pickDrawnSymbolCycling, from the selected fleet). */
    pickClickAt(wx: number, wy: number, z: number): DrawnSymbol | null {
        if (!this.front.visible) return null;
        return pickDrawnSymbolCycling(this.drawn, wx, wy, z, this.getSelection()?.shipGroup ?? null);
    }

    destroy(): void {
        this.back.destroy({ children: true });
        this.top.destroy({ children: true });
        this.front.destroy({ children: true });
    }
}
