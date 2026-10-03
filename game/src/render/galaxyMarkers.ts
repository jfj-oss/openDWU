// Faction markers: ship/base role symbols, fleet icons, faction system rings, system-name decorations and
// station-presence discs. Ports of the original's symbol / galaxy-level passes:
//
// 1. Faction system rings — MainView.2.cs method_250 draws, for every system with a DominantEmpire the viewing empire
//    has explored or sees, at f > 150 (num16, line 5153), a circle around the star in the dominant empire's MainColor
//    (method_268, 6660-6672: pen width 3, dashed when SystemInfo.IsDisputed; drawn at line 5399) of radius
//    val3 = max(Galaxy.MaxSolarSystemSize, TotalStrategicValue^0.35 * 600) / f px (5239-5240, 5337-5343), pushed out
//    to (star icon px)/2 + 3 when it would hug the icon (5346-5374), at alpha int_15 = clamp((f - 70) * 1.2, 0, 255)
//    (MainView.cs 1540-1548, the method_250 caller).
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
//
// Batching: the symbols (and fleet icons) are particles of one ParticleContainer over a runtime atlas of the
// original symbol art (procedural shapes when the art is missing), the discs a second one; rings one Graphics
// rebuilt only on zoom / data / view changes. Everything lives in world space and is sized by /z in screen px.

import type { BuiltObjectIndex } from './builtObjectIndex';
import { inOwnRenderGroup } from './renderGroups';
import { circleAtScreenRes } from './screenCircle';
import { Container, Graphics, Particle, ParticleContainer, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import type { Camera } from './camera';
import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { BuiltObject } from '../sim/builtObject';
import type { ShipGroup } from '../sim/fleets/shipGroup';
import { BuiltObjectSubRole } from '../sim/builtObjectTypes';
import { BuiltObjectRole } from '../sim/data/designSpecifications';
import { HabitatCategoryType, HabitatType, type SystemInfo } from '../sim/types';
import { SystemVisibilityStatus } from '../sim/visibility';
import { fogOf } from './fog';
import { isObjectVisibleToThisEmpire, isObjectVisibleToThisEmpireImprecise } from '../sim/independentTraders';
import type { MapOverlayState } from '../ui/mapOverlays';
import { getSettings, type UiSettings } from '../ui/settings';
import { displayColorForEmpire } from '../sim/empireColors';
import { useMinifyingFilter } from './assets';
import { boundsOnScreen } from './drawCache';
import { combatBarAlpha, drawCombatBars } from './combatBars';
import { drawCrossedSwords, systemsUnderFire } from './battleIcons';
import { builtObjectHiddenFromPick, warEmpires } from './builtObjectLayer';

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
/** The selection box yellow (MainView.cs color_2, Color.FromArgb(255, 255, 255, 0)), used by method_212. */
const SELECT_COLOR = 0xffff00;

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

/** Faction ring alpha: gated at f > 150 (MainView.2.cs:5153 / 5395) with method_250's int_15 ramp. */
export function factionRingBandAlpha(f: number): number {
    return f > SYSTEM_RING_MIN_FACTOR ? galaxyOverlayAlpha(f) : 0;
}

/** Presence disc alpha: the territory layer's 0.25 once zoomed out past system level (the backdrop pass, f > 70). */
export function presenceBandAlpha(f: number): number {
    return f > GALAXY_OVERLAY_MIN_FACTOR ? PRESENCE_ALPHA : 0;
}

/** Station-presence discs show only with their toggle on AND Empire Territory off (MainView.2.cs 264-272: the
 * system-influence discs are the territory layer drawn while MapOverlayEmpireTerritory is off). */
export function stationPresenceVisible(state: Pick<MapOverlayState, 'stationPresence' | 'empireTerritory'>): boolean {
    return state.stationPresence && !state.empireTerritory;
}

/** Presence disc radius in world units for `count` known bases + colonies: the original's fixed system-influence
 * radius for one, growing with sqrt(count), capped at 2.5x (~0.2 M units — a fraction of the 0.5 .. 1.5 M influence
 * range of a colony). */
export function presenceDiscRadius(count: number): number {
    if (count <= 0) return 0;
    // 1.8x the original's system-influence size (user call: more noticeable).
    return PRESENCE_SIZE_SCALE * SYSTEM_INFLUENCE_RADIUS * Math.min(2.5, 0.6 + 0.4 * Math.sqrt(count));
}

/** Presence discs drawn larger than the original's system-influence radius (user call). */
export const PRESENCE_SIZE_SCALE = 1.8;
/** Minimum on-screen presence disc radius (px), so stations stay visible fully zoomed out (user call). */
export const PRESENCE_MIN_SCREEN_PX = 9;

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
        if ((isFleet && !bestFleet) || (isFleet === bestFleet && dist < bestD)) {
            best = d;
            bestD = dist;
            bestFleet = isFleet;
        }
    }
    return best;
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

/** Galaxy/sector zoom: a ship in a fleet is represented by the fleet icon alone (user rule; the original skips only
 * the lead ship, MainView.2.cs 5932-5935, and draws the members under the icon). At system zoom every ship draws. */
export function drawnAsFleet(bo: Pick<BuiltObject, 'shipGroup'>): boolean {
    const g = bo.shipGroup as ShipGroup | null;
    return g != null && g.leadShip != null && g.ships.length > 0;
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
    const counts = new Map<number, Map<Empire, number>>();
    const add = (sys: number, e: Empire): void => {
        if (!explored(sys)) return;
        let m = counts.get(sys);
        if (m === undefined) {
            m = new Map();
            counts.set(sys, m);
        }
        m.set(e, (m.get(e) ?? 0) + 1);
    };
    const indep = galaxy.independentEmpire;
    for (const bo of galaxy.builtObjects) {
        if (bo === null || bo.hasBeenDestroyed || bo.role !== BuiltObjectRole.Base) continue;
        const e = bo.empire;
        if (e === null || e === indep) continue;
        let sys = -1;
        if (bo.parentHabitat !== null) {
            sys = bo.parentHabitat.systemIndex;
        } else if (bo.nearestSystemStar !== null) {
            const s = bo.nearestSystemStar;
            const dx = bo.xpos - s.xpos;
            const dy = bo.ypos - s.ypos;
            if (dx * dx + dy * dy <= galaxy.maxSolarSystemSize * galaxy.maxSolarSystemSize) sys = s.systemIndex;
        }
        if (sys >= 0 && sys < galaxy.systems.length && knownBase(bo)) add(sys, e);
    }
    for (const h of galaxy.habitats) {
        if (h.category !== HabitatCategoryType.Planet && h.category !== HabitatCategoryType.Moon) continue;
        const e = h.owner ?? h.empire;
        if (e === null || e === undefined || e === indep) continue;
        add(h.systemIndex, e);
    }
    const out: StationPresence[] = [];
    for (const [systemIndex, m] of [...counts].sort((a, b) => a[0] - b[0])) {
        const list = [...m].map(([empire, count]) => ({ systemIndex, empire, count }));
        list.sort((a, b) => b.count - a.count || a.empire.empireId - b.empire.empireId);
        out.push(...list);
    }
    return out;
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

function makeCanvas(w: number, h: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
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
    const atlas = Texture.from(canvas);
    useMinifyingFilter(atlas);
    const frames = CELL_KEYS.map((_, i) => new Texture({ source: atlas.source, frame: new Rectangle(i * CELL, 0, CELL, CELL) }));
    return { frames, aspect };
}

function buildDiscFallback(): Texture {
    const c = makeCanvas(DISC_SIZE, DISC_SIZE);
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
    const tex = Texture.from(c);
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

type SelectionLike = { builtObject?: BuiltObject; shipGroup?: ShipGroup } | null;

export class GalaxyMarkerLayer {
    /** Background part (presence discs, faction rings): inserted under the empire layer. */
    readonly back = new Container();
    /** Symbols, fleet icons, name decorations: above the map layers, under the ship art. */
    readonly front = new Container();

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
    private readonly overlayG = new Graphics();
    /** Shield / hull bars, drawn relative to `symbols.position` (see updateSymbols: the same camera-local origin). */
    private readonly barsG = new Graphics();
    private readonly iconLayer = new Container();
    private readonly countLayer = new Container();
    private discTex: Texture;
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
    private dataVersion = 0;
    private ringKey = { z: NaN, v: -1, a: NaN, x0: 0, y0: 0, x1: 0, y1: 0, sig: '' };
    private discKey = { z: NaN, v: -1, x: NaN, y: NaN };

    constructor(
        private readonly galaxy: Galaxy,
        world: Container,
        private readonly overlays: MapOverlayState,
        /** World child to insert `back` beneath (the empire layer root), or null to append. */
        below: Container | null,
    ) {
        this.discTex = buildDiscFallback();
        const dyn = { position: true, vertex: true, rotation: false, uvs: true, color: true };
        this.discs = new ParticleContainer({ texture: this.discTex, dynamicProperties: dyn });
        this.symbols = new ParticleContainer({ texture: Texture.WHITE, dynamicProperties: dyn });
        this.back.addChild(this.discs, this.rings);
        // barsG / overlayG are cleared and redrawn every frame: each in its own render group (renderGroups.ts).
        this.front.addChild(this.symbols, inOwnRenderGroup(this.barsG), this.countLayer, inOwnRenderGroup(this.overlayG), this.iconLayer);
        const idx = below !== null ? world.children.indexOf(below) : -1;
        if (idx >= 0) world.addChildAt(this.back, idx);
        else world.addChild(this.back);
        world.addChild(this.front);
        this.back.visible = false;
        this.front.visible = false;
        void this.loadArt();
    }

    private async loadArt(): Promise<void> {
        const [atlas, disc, capital, secondary, refuel] = await Promise.all([
            buildSymbolAtlas(),
            // systeminfluence.png is a hard-edged 29 px disc (alpha 255 core); the original's bilinear stretch softens it,
            // so the procedural soft falloff (buildDiscFallback) is used instead of the art.
            Promise.resolve(null as Texture | null),
            loadTexture(`${CHROME_DIR}/capital.png`),
            loadTexture(`${CHROME_DIR}/fleetLeader.png`),
            loadTexture(`${CHROME_DIR}/refuel.png`),
        ]);
        if (this.front.destroyed) return;
        this.frames = atlas.frames;
        this.aspect = atlas.aspect;
        this.symbols.texture = atlas.frames[0];
        if (disc !== null) {
            this.discTex = disc;
            this.discs.texture = disc;
            for (const p of this.discPool) p.texture = disc;
            this.discKey.v = -1;
        }
        this.icons = { capital, secondary, refuel };
    }

    private refresh(): void {
        const g = this.galaxy;
        const indep = g.independentEmpire;
        const player = g.playerEmpire;
        const vis = player?.visibility ?? null;
        const explored = (i: number): boolean => vis === null || vis.checkSystemVisibilityStatus(i) >= SystemVisibilityStatus.Explored;
        // Visible objects (galaxy symbol pass, MainView.2.cs 5915-5930) and bases the player has ever seen.
        this.visibleObjects.clear();
        for (const bo of g.builtObjects) {
            if (bo === null || bo.hasBeenDestroyed) continue;
            if (player === null || bo.empire === player || isObjectVisibleToThisEmpireImprecise(g, player, bo)) {
                this.visibleObjects.add(bo);
                if (bo.role === BuiltObjectRole.Base) this.knownBases.add(bo);
            }
        }
        for (const bo of this.knownBases) if (bo.hasBeenDestroyed) this.knownBases.delete(bo);
        this.presence = collectStationPresence(g, explored, (bo) => this.knownBases.has(bo));
        // Owned systems the player has explored / sees (method_268's gate).
        this.owners.clear();
        this.ringList = [];
        for (const sys of g.systems) {
            const idx = sys.systemStar.systemIndex;
            const status = vis !== null ? vis.checkSystemVisibilityStatus(idx) : SystemVisibilityStatus.Visible;
            const o = explored(idx) ? systemOwner(sys, indep) : null;
            const color = o !== null ? empireMarkerColor(o.empire) : null;
            const pen = systemRingPen(status, color, sys.isDisputed === true);
            if (sys.systemStar.category === HabitatCategoryType.GasCloud) {
                // 5390-5394: every gas cloud gets the cross, in method_268's pen.
                this.ringList.push({ sys, tsv: o?.tsv ?? 0, cross: true, pen });
                continue;
            }
            if (o !== null) {
                this.owners.set(sys, { empire: o.empire, tsv: o.tsv, color: color! });
                this.ringList.push({ sys, tsv: o.tsv, cross: false, pen });
            } else if (explored(idx) && (sys.independentColonyCount ?? 0) > 0) {
                // 5395-5398: known independent colonies get the grey ring.
                this.ringList.push({ sys, tsv: 0, cross: false, pen });
            }
        }
        // Fleets the player can see (method_258 6340: IsObjectVisibleToThisEmpire(lead, true, false)).
        this.visibleFleets = [];
        for (const e of g.empires) {
            if (e === null) continue;
            for (const sgU of e.shipGroups) {
                const sg = sgU as ShipGroup;
                const lead = sg.leadShip;
                if (lead === null || lead.hasBeenDestroyed || sg.ships.length === 0) continue;
                if (player !== null && sg.empire !== player && !isObjectVisibleToThisEmpire(g, player, lead, true, false)) continue;
                this.visibleFleets.push(sg);
            }
        }
        this.underFire = systemsUnderFire(player, g.builtObjects, g.habitats, g.nowMs);
        this.war = player !== null ? warEmpires(player.diplomaticRelations) : [];
        this.dataVersion++;
    }

    /** Per frame, after the system views have updated (their labels get decorated here). */
    update(z: number, cam: Camera, systems: readonly SystemLabelView[] = []): void {
        const f = 1 / z;
        const factionOn = this.overlays.factionMarkers;
        const presenceOn = stationPresenceVisible(this.overlays);
        this.back.visible = f > GALAXY_OVERLAY_MIN_FACTOR && (factionOn || presenceOn);
        this.front.visible = factionOn;
        this.drawn = [];
        this.overlayG.clear();
        this.barsG.clear();
        this.decorateLabels(systems, f, z, factionOn);
        if (!this.back.visible && !this.front.visible) return;

        const now = performance.now();
        if (now - this.lastRefresh >= REFRESH_MS) {
            this.lastRefresh = now;
            this.refresh();
        }

        this.discs.visible = presenceOn && presenceBandAlpha(f) > 0;
        if (this.discs.visible) this.updateDiscs(f, z, cam);
        const ringA = factionOn ? factionRingBandAlpha(f) : 0;
        this.rings.visible = ringA > 0;
        if (this.rings.visible) this.updateRings(f, z, cam, ringA);
        if (this.front.visible && this.frames.length > 0) this.updateSymbols(f, z, cam);
    }

    // Presence discs ------------------------------------------------------------------------------------------------

    private updateDiscs(f: number, z: number, cam: Camera): void {
        const k = this.discKey;
        if (k.v === this.dataVersion && k.z === z && k.x === cam.x && k.y === cam.y) return;
        k.v = this.dataVersion;
        k.z = z;
        k.x = cam.x;
        k.y = cam.y;
        const alpha = presenceBandAlpha(f);
        const out = this.discs.particleChildren;
        const prev = out.length;
        let n = 0;
        for (const p of this.presence) {
            const star = this.galaxy.systems[p.systemIndex].systemStar;
            const r = Math.max(presenceDiscRadius(p.count), PRESENCE_MIN_SCREEN_PX / z);
            if (!boundsOnScreen(star.xpos, star.ypos, r, 0, cam.x, cam.y, cam.width, cam.height, z)) continue;
            let part = this.discPool[n];
            if (part === undefined) {
                part = new Particle({ texture: this.discTex, anchorX: 0.5, anchorY: 0.5 });
                this.discPool.push(part);
            }
            part.x = star.xpos;
            part.y = star.ypos;
            part.scaleX = part.scaleY = (2 * r) / this.discTex.width;
            part.tint = empireMarkerColor(p.empire);
            part.alpha = alpha;
            out[n++] = part;
        }
        // Pooled particles keep their slot, so the container only needs a structural update when the count changes.
        if (prev !== n) {
            out.length = n;
            this.discs.update();
        }
    }

    // Faction rings -------------------------------------------------------------------------------------------------

    private updateRings(f: number, z: number, cam: Camera, alpha: number): void {
        const k = this.ringKey;
        const hw = cam.width / (2 * z);
        const hh = cam.height / (2 * z);
        const inRect = cam.x - hw >= k.x0 && cam.x + hw <= k.x1 && cam.y - hh >= k.y0 && cam.y + hh <= k.y1;
        if (k.z === z && k.v === this.dataVersion && k.a === alpha && inRect) return;
        if (k.z === z && k.a === alpha && inRect) {
            // Only the data was refreshed (once a second): rebuilding this Graphics (thousands of rings at galaxy zoom)
            // costs tens of ms, so redraw only when something drawn in the cull rectangle changed.
            const sig = this.ringSignature(f, z, k.x0, k.y0, k.x1, k.y1);
            k.v = this.dataVersion;
            if (sig === k.sig) return;
        }
        k.z = z;
        k.v = this.dataVersion;
        k.a = alpha;
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
        const player = this.galaxy.playerEmpire;
        for (const sv of systems) {
            const label = sv.nameLabel;
            const shown = on && sv.root.visible && label.visible && f > SYSTEM_RING_MIN_FACTOR;
            if (!shown) {
                if (this.decorated.has(label)) {
                    // Restore the Main View's own look (white, centred under the star; it re-positions every frame).
                    label.anchor.set(0.5, 0);
                    if (label.style.fill !== 0xffffff) label.style.fill = 0xffffff;
                    if (label.style.fontWeight !== 'normal') label.style.fontWeight = 'normal';
                    if (label.style.fontSize !== 11) label.style.fontSize = 11;
                    this.decorated.delete(label);
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
            for (const tex of [capTex, refuel]) {
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
            // Crossed swords: lower-right corner of the ring while the player is fighting in this system.
            const fire = this.underFire.get(star.systemIndex);
            if (fire !== undefined) {
                const swordPx = f < 4000 ? 18 : 14;
                const pulse = 0.8 + 0.2 * Math.sin(performance.now() / 250);
                const off = (ringPx + swordPx / 2) * Math.SQRT1_2;
                drawCrossedSwords(this.overlayG, star.xpos + off / z, star.ypos + off / z, swordPx, z, fire * pulse);
            }
            // Ruins glyph "∴" (5645-5657): three small squares in the name colour right after the name.
            if (sys.hasRuins === true) {
                const q = f < 4000 ? 3 : 2;
                // label.width / height are world units (the label is scaled 1/z); num42 = 3 px below the text top.
                const nx = star.xpos + x / z + label.width + 1 / z;
                const ny = star.ypos + 1 / z - label.height + 3 / z;
                const g = this.overlayG;
                for (const [dx, dy] of [
                    [0, 5],
                    [6, 5],
                    [3, 0],
                ]) {
                    g.rect(nx + dx / z, ny + dy / z, q / z, q / z).fill({ color: fill });
                }
            }
        }
        for (let i = icons; i < this.iconPool.length; i++) this.iconPool[i].visible = false;
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

    private updateSymbols(f: number, z: number, cam: Camera): void {
        const g = this.galaxy;
        const player = g.playerEmpire;
        const indep = g.independentEmpire;
        const band = symbolBand(f);
        const out = this.symbols.particleChildren;
        const prev = out.length;
        let n = 0;
        const sel = this.getSelection();
        const selBo = sel?.shipGroup === undefined ? (sel?.builtObject ?? null) : null;
        const selGroup = sel?.shipGroup ?? null;
        const galaxyPass = band === 'galaxy';
        // Particle / bar vertices are float32 in the container's local space, and galaxy coordinates run to millions
        // (spacing 0.06 - 0.5 world units), which shows as stepping when a ship glides a fraction of a px per frame.
        // So both containers sit at the camera centre and the markers are placed relative to it (small local numbers).
        const ox = cam.x;
        const oy = cam.y;
        this.symbols.position.set(ox, oy);
        this.barsG.position.set(ox, oy);
        const shipPx = shipSymbolPx(f, false);
        const basePx = shipSymbolPx(f, true);
        const opts: GalaxyViewDisplay = getSettings();
        const fog = fogOf(g);
        // Perf (late games: ~10k built objects, every frame): the tests that do not depend on the drawn position run
        // first, and objects whose committed position is off screen by more than their drawn-position bound are
        // dropped before the (costly) render-interpolated sample. Same symbols, in the same order.
        const pad = 40;
        const list: readonly (BuiltObject | null)[] =
            this.index !== null ? this.index.near(cam.x, cam.y, cam.width / (2 * z), cam.height / (2 * z), (pad + 1) / z, true, this.nearScratch) : g.builtObjects;
        for (const bo of list) {
            if (bo === null || bo.hasBeenDestroyed) continue;
            const art = symbolArtFor(bo.role, bo.subRole);
            if (art === null) continue;
            const isBase = bo.role === BuiltObjectRole.Base;
            const owned = bo.empire !== null && bo.empire !== indep;
            if (galaxyPass) {
                if (!this.visibleObjects.has(bo)) continue;
                if (drawnAsFleet(bo)) continue; // the fleet icon stands for the whole fleet
                const enemy = bo.empire !== null && (g.pirateEmpires.includes(bo.empire) || this.war.includes(bo.empire));
                if (!galaxyViewTypeShown(bo.subRole, opts, enemy, f)) continue;
                if (builtObjectHiddenFromPick(bo, g.systems, g.pirateEmpires, this.war)) continue;
            } else {
                // MainView.1.cs 1083-1088: beyond f = 20 the player's own private ships get no symbol.
                if (f > 20 && !isBase && bo.owner === null && player !== null && bo.empire === player) continue;
            }
            if (!boundsOnScreen(bo.xpos, bo.ypos, this.drawnOffsetBound(bo), pad, cam.x, cam.y, cam.width, cam.height, z)) continue;
            // The marker belongs to the ship's draw block: an unseen ship (fog.ts, MainView.1.cs:884) gets none.
            if (!galaxyPass && !fog.builtObject(bo)) continue;
            const pos = this.positionOf(bo);
            if (!boundsOnScreen(pos.x, pos.y, 0, pad, cam.x, cam.y, cam.width, cam.height, z)) continue;
            const heightPx = galaxyPass
                ? (isBase ? basePx : shipPx) * symbolSizeMultiplier(bo.role, bo.subRole, true)
                : perShipSymbolPx(this.shipPxOf(bo), isBase) * symbolSizeMultiplier(bo.role, bo.subRole, band === 'filled');
            const base = owned ? empireMarkerColor(bo.empire!) : UNOWNED_SYMBOL_COLOR;
            const tint = brighten(base, 48);
            // Restyle: the outline frame recedes (it must not out-shout the ship / base it frames); filled markers are a touch softer.
            const alpha = symbolAlpha(f, owned, isBase) * (band === 'outline' ? OUTLINE_MARKER_ALPHA : FILLED_MARKER_ALPHA);
            const artIdx = SYMBOL_ART.indexOf(art);
            if (band === 'outline') {
                this.pushSymbol(n++, SYMBOL_ART.length + artIdx, pos.x - ox, pos.y - oy, heightPx, z, tint, alpha);
            } else {
                // Filled art over a darker, slightly larger copy: the contour.
                this.pushSymbol(n++, artIdx, pos.x - ox, pos.y - oy, heightPx + 2.5, z, brighten(base, -96), alpha * 0.9);
                this.pushSymbol(n++, artIdx, pos.x - ox, pos.y - oy, heightPx, z, tint, alpha);
            }
            if (!galaxyPass && !isBase) {
                // Shield / hull bars under the marker while the ship fights (render/combatBars.ts).
                const barAlpha = combatBarAlpha(bo, g.nowMs);
                if (barAlpha > 0) drawCombatBars(this.barsG, bo, pos.x - ox, pos.y - oy, heightPx, z, barAlpha);
            }
            if (galaxyPass) {
                this.drawn.push({ bo, group: null, x: pos.x, y: pos.y, halfPx: heightPx / 2 });
                if (bo === selBo) this.selectBox(pos.x, pos.y, heightPx * 1.6, z); // 5998-6006
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
                const atWar = sg.empire !== null && this.war.includes(sg.empire);
                if (!galaxyViewFleetShown(opts, atWar, f)) continue;
                const pos = this.positionOf(lead);
                if (!boundsOnScreen(pos.x, pos.y, 0, 40, cam.x, cam.y, cam.width, cam.height, z)) continue;
                // method_259: MainColor tint, (1,1,1) pirates -> (8,8,8).
                const e = sg.empire;
                let color = e !== null ? displayColorForEmpire(e) & 0xffffff : UNOWNED_SYMBOL_COLOR;
                if (color === 0x010101) color = 0x080808;
                this.pushSymbol(n++, cell, pos.x - ox, pos.y - oy, iconH, z, color, 1);
                this.drawn.push({ bo: lead, group: sg, x: pos.x, y: pos.y, halfPx: iconH / 2 });
                if (sg === selGroup) this.selectBox(pos.x, pos.y, iconH, z); // 6384-6387
                if (f < 6000) {
                    const t = this.countText(counts++);
                    const s = String(sg.ships.length);
                    if (t.text !== s) t.text = s;
                    const tc = contrastTextColor(color);
                    if (t.style.fill !== tc) t.style.fill = tc;
                    t.position.set(pos.x, pos.y - (iconH / 2 - iconH * 0.1) / z);
                    t.scale.set(1 / z);
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

    /** method_212: the yellow selection box around a selected symbol / fleet icon. */
    private selectBox(x: number, y: number, sizePx: number, z: number): void {
        const h = sizePx / 2 / z;
        this.overlayG.rect(x - h, y - h, 2 * h, 2 * h).stroke({ width: 1.5 / z, color: SELECT_COLOR, alpha: 1 });
    }

    /** The symbol or fleet icon drawn at world point (wx, wy) in the last frame (galaxy/sector zoom only). */
    pickAt(wx: number, wy: number, z: number): DrawnSymbol | null {
        if (!this.front.visible) return null;
        return pickDrawnSymbol(this.drawn, wx, wy, z);
    }

    destroy(): void {
        this.back.destroy({ children: true });
        this.front.destroy({ children: true });
    }
}
