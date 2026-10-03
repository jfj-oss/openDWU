// Port of DistantWorlds/Controls/SystemView.cs — the small system / region map control. The original has two:
//   - picSystemMap on the Galaxy Map window (Main.Part11.cs method_131: 250 × 250 at (670, 8); Ignite with
//     relativeToView: false, scaleFactor = Galaxy.MaxSolarSystemSize * 2 / width, showIndicatorLines: true and the
//     system's name): the selected system with its orbits, the selected habitat's crosshair and the view filter's
//     habitats in yellow;
//   - picSystem in the HUD's bottom-right pnlSystemMap (Main.Part12.cs 2099-2134: 280 × 280 at (45, 5) of a 330 × 290
//     panel; Ignite with relativeToView: true, int_35 = MaxSolarSystemSize / width, drawViewIndicator: true,
//     ShowBuiltObjects / ShowFleetPostures true): below zoom factor 100 the system nearest the view (method_5),
//     above it the region of the galaxy around the view (method_9).
// Both draw into a CanvasRenderingContext2D here (OnPaint → drawSystemView / drawRegionView). Render/UI only: they read
// the galaxy (or the sim-worker replica) and never write it — the original's Habitat.DoTasks calls before a redraw
// (gmapMain_MouseUp, method_152) advance orbits in the sim and are not made; the replica's positions are current.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { BuiltObject } from '../sim/builtObject';
import type { Creature } from '../sim/creature';
import { type ShipGroup, empireShipGroups } from '../sim/fleets/shipGroup';
import { BuiltObjectRole } from '../sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../sim/builtObjectTypes';
import { GalaxyLocationType } from '../sim/galaxyLocation';
import { HabitatCategoryType, HabitatType, type Habitat, type SystemInfo } from '../sim/types';
import { SystemVisibilityStatus } from '../sim/visibility';
import { displayColorForEmpire } from '../sim/empireColors';
import { fogOf } from '../render/fog';

// ---------------------------------------------------------------------------------------------------------------
// Constants (Main.Part13.cs 197-256, Main.Part12.cs 2294-2296, SystemView.cs ctor)
// ---------------------------------------------------------------------------------------------------------------

/** pen_1 (color_5): orbits and the region view's sector grid. */
export const SV_PEN_1 = 'rgb(32, 32, 88)';
/** pen_2 (color_7): the indicator crosshair and the view rectangle. */
export const SV_PEN_2 = 'rgb(96, 96, 255)';
/** color_7 as an ARGB tint: the view rectangle fill (alpha 48 in method_5, 24 in method_9). */
export const SV_VIEW_RGB = '96, 96, 255';
/** SystemView ctor: double_0 / double_1 / double_2 (the region view's scale limits). */
export const REGION_ZOOM_THRESHOLD = 2500.0;
export const REGION_SCALE_MIN = 25000.0;
export const REGION_SCALE_MAX = 75000.0;

/** Main.Part13.cs brushes 7-24 by habitat type (method_5's switch). */
const C = {
    yellow: 'rgb(255, 255, 0)',
    red: 'rgb(255, 0, 0)',
    white: 'rgb(255, 255, 255)',
    aqua: 'rgb(0, 255, 255)',
    blackHole: 'rgb(0, 0, 176)',
    purple: 'rgb(128, 0, 128)',
    orangeRed: 'rgb(255, 69, 0)',
    sandyBrown: 'rgb(244, 164, 96)',
    green: 'rgb(0, 128, 0)',
    blue: 'rgb(0, 0, 255)',
    rock: 'rgb(64, 64, 64)',
    deepPink: 'rgb(255, 20, 147)',
    violet96: 'rgba(238, 130, 238, 0.376)',
} as const;

/** SystemView.cs method_5's FillEllipse brush for a habitat (null: not drawn — Undefined). */
export function systemViewHabitatColor(h: Habitat): string | null {
    switch (h.type) {
        case HabitatType.MainSequence: return C.yellow; // solidBrush_17
        case HabitatType.RedGiant: return C.red; // solidBrush_18
        case HabitatType.SuperGiant: return C.red; // solidBrush_19
        case HabitatType.WhiteDwarf: return C.white; // solidBrush_20
        case HabitatType.Neutron: return C.aqua; // solidBrush_21
        case HabitatType.BlackHole: return C.blackHole; // solidBrush_23
        case HabitatType.SuperNova: return C.purple; // solidBrush_22
        case HabitatType.Volcanic: return C.orangeRed; // solidBrush_8
        case HabitatType.Desert: return C.sandyBrown; // solidBrush_9
        case HabitatType.MarshySwamp: return C.yellow; // solidBrush_10
        case HabitatType.Continental: return C.green; // solidBrush_11
        case HabitatType.Ocean: return C.blue; // solidBrush_12
        case HabitatType.Ice: return h.category === HabitatCategoryType.Asteroid ? C.rock : C.aqua; // solidBrush_7 / _13
        case HabitatType.GasGiant: return C.red; // solidBrush_14
        case HabitatType.FrozenGasGiant: return C.deepPink; // solidBrush_15
        case HabitatType.Hydrogen:
        case HabitatType.Helium:
        case HabitatType.Argon:
        case HabitatType.Ammonia:
        case HabitatType.CarbonDioxide:
        case HabitatType.Oxygen:
        case HabitatType.NitrogenOxygen:
        case HabitatType.Chlorine:
            return C.violet96; // (96, solidBrush_24 Violet)
        case HabitatType.BarrenRock:
        case HabitatType.Metal:
            return C.rock; // solidBrush_7
    }
    return null;
}

/** SystemView.cs method_5 num7: a habitat's dot size in pixels at `num` world units per pixel. */
export function systemViewHabitatSize(h: Habitat, num: number): number {
    if (h.category === HabitatCategoryType.GasCloud || h.type === HabitatType.BlackHole) return Math.trunc(h.diameter / num);
    const d = h.diameter;
    if (d > 1250) return 11;
    if (d > 1000) return 9;
    if (d > 750) return 7;
    if (d > 300) return 6;
    if (d >= 180) return 5;
    if (d >= 80) return 4;
    if (d < 30) return 2;
    return 3;
}

/** SystemView.cs method_5 num for relativeToView (the HUD map) at zoom factor `zoomFactor` (Main.double_0) with the
 * control's scale factor int_4 (Main.int_35 = MaxSolarSystemSize / width): int_4 below 10, then rising with the zoom. */
export function hudSystemScale(zoomFactor: number, scaleFactor: number): number {
    if (zoomFactor < 10.0) return scaleFactor;
    const num2 = 100 - scaleFactor;
    return zoomFactor * 10.0 - num2;
}

/** SystemView.cs method_0 / method_9 num: the region view's world units per pixel at zoom factor `zoomFactor`. */
export function regionScale(zoomFactor: number): number {
    if (zoomFactor < REGION_ZOOM_THRESHOLD) return REGION_SCALE_MIN;
    return Math.min(REGION_SCALE_MAX, Math.max(REGION_SCALE_MIN, zoomFactor * 10.0));
}

/** Main.Part11.cs picSystem_MouseUp: the world offset per minimap pixel when the HUD map is clicked. Below zoom
 * factor 100 it is method_5's scale (truncated, as the C# `(int)num`); above it 35000 below factor 3500 else
 * factor × 10 — the original's click scale, which differs from method_9's drawn scale (kept as the original has it). */
export function hudMapClickScale(zoomFactor: number, scaleFactor: number): number {
    if (zoomFactor < 100.0) return Math.trunc(hudSystemScale(zoomFactor, scaleFactor));
    return zoomFactor < 3500.0 ? 35000.0 : zoomFactor * 10.0;
}

/** Galaxy.ResolveSector + CorrectSectorCoords: the sector holding a world point, clamped to the galaxy's sectors. */
export function resolveSectorClamped(galaxy: Galaxy, x: number, y: number): { x: number; y: number } {
    const sx = Math.trunc(Math.trunc(x) / galaxy.sectorSize);
    const sy = Math.trunc(Math.trunc(y) / galaxy.sectorSize);
    return {
        x: Math.max(0, Math.min(galaxy.sectorWidth - 1, sx)),
        y: Math.max(0, Math.min(galaxy.sectorHeight - 1, sy)),
    };
}

/** C# `int / int` (truncating division) for the method_5 pixel maths. */
function idiv(a: number, b: number): number {
    const bi = Math.trunc(b);
    if (bi === 0) return 0;
    return Math.trunc(Math.trunc(a) / bi);
}

/** The system a habitat index range belongs to (Galaxy.Habitats[int_3 .. int_1]: the star, then its children).
 * A top-level habitat with no system of its own (a lone asteroid field) is drawn alone. */
export function systemViewHabitats(galaxy: Galaxy, star: Habitat): readonly Habitat[] {
    const sys = galaxy.systems[star.systemIndex];
    if (sys !== undefined && sys.systemStar === star) return sys.habitats;
    return [star];
}

/** The status the player has of a system (GodMode / no player: Visible). */
function statusOf(player: Empire | null, systemIndex: number): SystemVisibilityStatus {
    if (player === null) return SystemVisibilityStatus.Visible;
    if (systemIndex < 0 || systemIndex >= player.visibility.systemVisibility.length) return SystemVisibilityStatus.Unexplored;
    return player.visibility.checkSystemVisibilityStatus(systemIndex);
}

function cssColor(rgb: number, alpha = 1): string {
    return `rgba(${(rgb >> 16) & 0xff}, ${(rgb >> 8) & 0xff}, ${rgb & 0xff}, ${alpha})`;
}

function textShadowed(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, fill: string): void {
    ctx.fillStyle = '#000';
    ctx.fillText(s, x + 1, y + 1);
    ctx.fillStyle = fill;
    ctx.fillText(s, x, y);
}

// ---------------------------------------------------------------------------------------------------------------
// method_5: the system view
// ---------------------------------------------------------------------------------------------------------------

export interface SystemViewParams {
    galaxy: Galaxy;
    /** The viewer (Main._Game.PlayerEmpire); null = GodMode (everything visible). */
    player: Empire | null;
    width: number;
    height: number;
    /** Galaxy.Habitats[int_3]: the system's star (or gas cloud / lone asteroid field). */
    star: Habitat;
    /** num: world units per pixel. */
    scale: number;
    /** (num3, num4): the world point at the control's centre (the star itself, or the Main View's centre). */
    centerX: number;
    centerY: number;
    /** bool_11 with Main.habitat_8: the crosshair on the selected habitat (relative to Main.habitat_7). */
    indicator?: { selected: Habitat; system: Habitat } | null;
    /** bool_9: the Main View rectangle, mainView.Width × Height pixels at `zoomFactor` (Main.double_0). */
    viewIndicator?: { viewWidth: number; viewHeight: number; zoomFactor: number } | null;
    /** habitatList_0 (SetSelectedHabitat(s)): when set, these are yellow 4 × 4 dots and every other habitat grey. */
    selectedHabitats?: ReadonlySet<Habitat> | readonly Habitat[] | null;
    /** bool_7 ShowBuiltObjects: ships and creatures around (viewX, viewY) (Main.int_13 / int_14). */
    builtObjects?: { viewX: number; viewY: number } | null;
    /** string_1: drawn at (8, 8) in font_2 when the system is not Unexplored. */
    systemName?: string;
}

/** Port of SystemView.cs method_5 (relativeToView or not; the caller sets the centre and scale). */
export function drawSystemView(ctx: CanvasRenderingContext2D, p: SystemViewParams): void {
    const { galaxy, player, width: W, height: H, star } = p;
    const num = p.scale;
    // DrawPanelBackground: BackColor / BackColor2 / BackColor3 are all black for both controls.
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const status = statusOf(player, star.systemIndex);
    const num3 = Math.trunc(p.centerX);
    const num4 = Math.trunc(p.centerY);
    ctx.lineWidth = 1;
    if (p.indicator) {
        const n5 = idiv(Math.trunc(p.indicator.selected.xpos) - Math.trunc(p.indicator.system.xpos), num) + Math.trunc(W / 2) + 1;
        const n6 = idiv(Math.trunc(p.indicator.selected.ypos) - Math.trunc(p.indicator.system.ypos), num) + Math.trunc(H / 2) + 1;
        ctx.strokeStyle = SV_PEN_2;
        ctx.beginPath();
        ctx.moveTo(n5 + 0.5, 0);
        ctx.lineTo(n5 + 0.5, H);
        ctx.moveTo(0, n6 + 0.5);
        ctx.lineTo(W, n6 + 0.5);
        ctx.stroke();
    }
    const selected = p.selectedHabitats == null ? null : p.selectedHabitats instanceof Set ? (p.selectedHabitats as ReadonlySet<Habitat>) : new Set(p.selectedHabitats as readonly Habitat[]);
    const habitats = systemViewHabitats(galaxy, star);
    for (let i = 0; i < habitats.length; i++) {
        const h = habitats[i];
        if (i > 0 && status === SystemVisibilityStatus.Unexplored) continue;
        const num7 = systemViewHabitatSize(h, num);
        const num8 = idiv(h.xpos - num3, num) + Math.trunc(W / 2);
        const num9 = idiv(h.ypos - num4, num) + Math.trunc(H / 2);
        if (i === 0) {
            if (status !== SystemVisibilityStatus.Unexplored) {
                ctx.strokeStyle = SV_PEN_1;
                for (let j = 1; j < habitats.length; j++) {
                    const h2 = habitats[j];
                    if (h2.category !== HabitatCategoryType.Planet) continue;
                    const r = idiv(h2.orbitDistance, num);
                    ctx.beginPath();
                    ctx.ellipse(num8, num9, Math.max(0, r), Math.max(0, r), 0, 0, Math.PI * 2);
                    ctx.stroke();
                }
            }
            if (p.viewIndicator) {
                const cx = Math.trunc(W / 2);
                const cy = Math.trunc(H / 2);
                const vw = Math.trunc(p.viewIndicator.viewWidth / (num / p.viewIndicator.zoomFactor));
                const vh = Math.trunc(p.viewIndicator.viewHeight / (num / p.viewIndicator.zoomFactor));
                const rx = cx - Math.trunc(vw / 2);
                const ry = cy - Math.trunc(vh / 2);
                ctx.fillStyle = `rgba(${SV_VIEW_RGB}, ${48 / 255})`;
                ctx.fillRect(rx, ry, vw, vh);
                ctx.strokeStyle = SV_PEN_2;
                ctx.strokeRect(rx + 0.5, ry + 0.5, vw, vh);
            }
        }
        let rx = num8 - Math.trunc(num7 / 2);
        let ry = num9 - Math.trunc(num7 / 2);
        let rw = num7;
        if (selected !== null) {
            let fill = 'rgb(80, 80, 80)';
            if (selected.has(h)) {
                rx = num8 - 2;
                ry = num9 - 2;
                rw = 4;
                fill = 'rgb(255, 255, 0)';
            }
            ctx.fillStyle = fill;
            ctx.beginPath();
            ctx.ellipse(rx + rw / 2, ry + rw / 2, rw / 2, rw / 2, 0, 0, Math.PI * 2);
            ctx.fill();
            continue;
        }
        if (h.empire !== null && h.empire !== galaxy.independentEmpire) {
            ctx.strokeStyle = cssColor(displayColorForEmpire(h.empire));
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.ellipse(rx + rw / 2, ry + rw / 2, (rw + 4) / 2, (rw + 4) / 2, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.lineWidth = 1;
        }
        const fill = systemViewHabitatColor(h);
        if (fill !== null && rw > 0) {
            ctx.fillStyle = fill;
            ctx.beginPath();
            ctx.ellipse(rx + rw / 2, ry + rw / 2, rw / 2, rw / 2, 0, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.font = 'bold 12px Verdana, sans-serif'; // font_2 (18.67 px bold) at the control's 250-280 px
    ctx.textBaseline = 'top';
    if (status === SystemVisibilityStatus.Unexplored && star.category !== HabitatCategoryType.GasCloud) {
        const s = '(Not Explored)';
        const tw = ctx.measureText(s).width;
        const x = Math.trunc(W / 2 - tw / 2);
        const y = Math.trunc(Math.trunc(H / 3) * 2 - 6);
        ctx.fillStyle = '#000';
        ctx.fillText(s, x + 1, y + 1);
        ctx.fillStyle = 'rgba(128, 128, 128, 0.5)';
        ctx.fillText(s, x, y);
    }
    if (p.builtObjects) {
        drawSystemViewBuiltObjects(ctx, galaxy, player, W, H, num, p.builtObjects.viewX, p.builtObjects.viewY);
        let creatures: readonly Creature[] | null = null;
        const sys = galaxy.systems[star.systemIndex];
        if (sys !== undefined && sys.creatures !== undefined) creatures = sys.creatures;
        if (creatures === null) {
            const locs = galaxy.determineGalaxyLocationsAtPoint(p.builtObjects.viewX, p.builtObjects.viewY, GalaxyLocationType.RestrictedArea);
            if (locs.length === 1 && locs[0].relatedCreatures.length > 0) creatures = locs[0].relatedCreatures;
        }
        if (creatures !== null) drawSystemViewCreatures(ctx, galaxy, player, W, H, num, p.builtObjects.viewX, p.builtObjects.viewY, creatures);
    }
    if (p.systemName && status !== SystemVisibilityStatus.Unexplored) textShadowed(ctx, p.systemName, 8, 8, '#fff');
}

/** SystemView.cs method_7: the ships and bases in the control's area around the view centre, as ship symbols
 * (MainView.DrawShipSymbol, 5 px at these scales: max(5, min(50 / num, maxWidth))). */
function drawSystemViewBuiltObjects(ctx: CanvasRenderingContext2D, galaxy: Galaxy, player: Empire | null, W: number, H: number, num: number, viewX: number, viewY: number): void {
    const n3 = Math.trunc(W * num);
    const n4 = Math.trunc(H * num);
    const x0 = Math.trunc(viewX) - Math.trunc(n3 / 2);
    const x1 = Math.trunc(viewX) + Math.trunc(n3 / 2);
    const y0 = Math.trunc(viewY) - Math.trunc(n4 / 2);
    const y1 = Math.trunc(viewY) + Math.trunc(n4 / 2);
    const fog = fogOf(galaxy);
    const size = Math.max(5, Math.min(Math.trunc(50.0 / num), 10));
    const list = galaxy.builtObjects;
    for (let i = 0; i < list.length; i++) {
        const bo = list[i];
        if (bo == null || bo.hasBeenDestroyed) continue;
        if (bo.xpos < x0 || bo.xpos > x1 || bo.ypos < y0 || bo.ypos > y1) continue;
        if (player !== null && !fog.builtObject(bo)) continue;
        const x = (bo.xpos - x0) / num;
        const y = (bo.ypos - y0) / num;
        const c = resolveShipSymbolColor(galaxy, bo, num);
        drawShipSymbol(ctx, bo, galaxy, { r: c.r, g: c.g, b: c.b, a: Math.min(255, c.a + 48) }, x, y, size, size, true, num);
    }
}

/** SystemView.cs method_6: the creatures as X crosses (192, 160, 64, 32), 7 px minimum. */
function drawSystemViewCreatures(ctx: CanvasRenderingContext2D, galaxy: Galaxy, player: Empire | null, W: number, H: number, num: number, viewX: number, viewY: number, creatures: readonly Creature[]): void {
    const n2 = Math.trunc(W * num);
    const n3 = Math.trunc(H * num);
    const x0 = Math.trunc(viewX) - Math.trunc(n2 / 2);
    const x1 = Math.trunc(viewX) + Math.trunc(n2 / 2);
    const y0 = Math.trunc(viewY) - Math.trunc(n3 / 2);
    const y1 = Math.trunc(viewY) + Math.trunc(n3 / 2);
    const fog = fogOf(galaxy);
    const half = Math.max(7, Math.min(Math.trunc(50.0 / num), 24)) / 2;
    ctx.strokeStyle = 'rgba(160, 64, 32, 0.753)';
    ctx.lineWidth = 2;
    for (const c of creatures) {
        if (c == null || c.hasBeenDestroyed) continue;
        if (c.xpos < x0 || c.xpos > x1 || c.ypos < y0 || c.ypos > y1) continue;
        if (player !== null && !fog.creature(c)) continue;
        const x = (c.xpos - x0) / num;
        const y = (c.ypos - y0) / num;
        ctx.beginPath();
        ctx.moveTo(x - half, y - half);
        ctx.lineTo(x + half, y + half);
        ctx.moveTo(x + half, y - half);
        ctx.lineTo(x - half, y + half);
        ctx.stroke();
    }
    ctx.lineWidth = 1;
}

/** MainView.2.cs 2159 ResolveShipSymbolColor at the control's scale (`zoomFactor` = the C#'s main_0.double_0, the
 * Main View zoom; the controls pass their own scale, as the alpha only saturates at 1 above factor 3). */
export function resolveShipSymbolColor(galaxy: Galaxy, bo: BuiltObject, zoomFactor: number): { r: number; g: number; b: number; a: number } {
    const player = galaxy.playerEmpire;
    let flag = true;
    if (bo.empire === null || (bo.empire === galaxy.independentEmpire && (bo.pirateEmpireId <= 0 || player === null || bo.pirateEmpireId !== player.empireId))) flag = false;
    if (!flag || bo.empire === null) return { r: 128, g: 128, b: 128, a: 255 }; // Color.Gray
    let rgb = displayColorForEmpire(bo.empire);
    const val = Math.min(1.0, Math.max(0.6, zoomFactor / 3.0));
    if (bo.empire.pirateEmpireBaseHabitat !== null && (bo.empire.mainColor & 0xffffff) === 0x010101) rgb = 0x303030;
    return { r: (rgb >> 16) & 0xff, g: (rgb >> 8) & 0xff, b: rgb & 0xff, a: Math.trunc(val * 255.0) };
}

/** Port of MainView.2.cs 2181 DrawShipSymbol: the role shape at (x, y) (its top-left, as the callers pass it),
 * enlarged by 1.2 (1.5 for military / exploration / colony), filled, outlined 2 px in the colour +64 (method_226). */
export function drawShipSymbol(
    ctx: CanvasRenderingContext2D,
    bo: BuiltObject,
    galaxy: Galaxy,
    color: { r: number; g: number; b: number; a: number },
    x: number,
    y: number,
    width: number,
    height: number,
    fillInterior: boolean,
    zoomFactor: number,
): void {
    const a = color.a / 255;
    const fill = `rgba(${color.r}, ${color.g}, ${color.b}, ${a})`;
    const lc = (v: number): number => Math.max(0, Math.min(255, v + 64));
    const stroke = fillInterior ? `rgba(${lc(color.r)}, ${lc(color.g)}, ${lc(color.b)}, ${a})` : fill;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = stroke;
    ctx.fillStyle = fill;
    if (zoomFactor <= 50.0 && bo.owner === null && bo.empire !== galaxy.independentEmpire && bo.empire !== null) ctx.setLineDash([2, 2]);
    let k = 1.2;
    if (bo.role === BuiltObjectRole.Military || bo.role === BuiltObjectRole.Exploration || bo.role === BuiltObjectRole.Colony) k = 1.5;
    const w2 = width * k;
    const h2 = height * k;
    x -= (w2 - width) / 2;
    y -= (h2 - height) / 2;
    width = w2;
    height = h2;
    if (width > height) {
        y -= (width - height) / 2;
        height = width;
    }
    const poly = (pts: [number, number][]): void => {
        if (width < 2) {
            if (fillInterior) ctx.fillRect(Math.trunc(pts[0][0]), Math.trunc(pts[0][1]), 2, 2);
            ctx.strokeRect(Math.trunc(pts[0][0]), Math.trunc(pts[0][1]), 2, 2);
            return;
        }
        ctx.beginPath();
        pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
        ctx.closePath();
        if (fillInterior) ctx.fill();
        ctx.stroke();
    };
    const ellipse = (): void => {
        if (width < 2 || height < 2) {
            if (fillInterior) ctx.fillRect(x, y, width, height);
            ctx.strokeRect(x, y, width, height);
            return;
        }
        ctx.beginPath();
        ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
        if (fillInterior) ctx.fill();
        ctx.stroke();
    };
    const line = (ax: number, ay: number, bx: number, by: number): void => {
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
    };
    switch (bo.role) {
        case BuiltObjectRole.Military: {
            const n = width / 1.15470052;
            poly([[x + width / 2, y], [x + width, y + n], [x, y + n]]);
            break;
        }
        case BuiltObjectRole.Freight:
            ellipse();
            break;
        case BuiltObjectRole.Passenger: {
            ellipse();
            const t = width / 5;
            const cx = x + width / 2;
            const cy = y + height / 2;
            line(cx, y - t, cx, y);
            line(x + width, cy, x + width + t, cy);
            line(cx, y + height + t, cx, y + height);
            line(x - t, cy, x, cy);
            break;
        }
        case BuiltObjectRole.Exploration:
        case BuiltObjectRole.Colony:
            poly([[x + width / 2, y], [x + width, y + height / 2], [x + width / 2, y + height], [x, y + height / 2]]);
            break;
        case BuiltObjectRole.Build:
            if (fillInterior) ctx.fillRect(x, y, width, height);
            ctx.strokeRect(x, y, width, height);
            break;
        case BuiltObjectRole.Resource: {
            ellipse();
            const n20 = width / 2 - (width / 2) * 0.707106769;
            line(x + n20, y + n20, x, y);
            line(x + width - n20, y + n20, x + width, y);
            line(x + width - n20, y + height - n20, x + width, y + height);
            line(x + n20, y + height - n20, x, y + height);
            break;
        }
        case BuiltObjectRole.Base: {
            const n6 = height * 1.15470052;
            x -= (height * 0.154700533) / 2;
            const n7 = n6 / 2;
            const n8 = (n6 - n7) / 2;
            poly([[x + n8, y], [x + n8 + n7, y], [x + n8 + n7 + n8, y + height / 2], [x + n8 + n7, y + height], [x + n8, y + height], [x, y + height / 2]]);
            if (bo.subRole === BuiltObjectSubRole.MiningStation || bo.subRole === BuiltObjectSubRole.GasMiningStation) {
                const n14 = n8 / 2;
                const n15 = height / 4;
                const n16 = 0;
                const n17 = n15 - n14 / 2;
                const n18 = height / 6;
                line(x + n14, y + n15, x + n16, y + n17);
                line(x + n6 - n14, y + n15, x + n6 - n16, y + n17);
                line(x + n6 - n14, y + height - n15, x + n6 - n16, y + height - n17);
                line(x + n14, y + height - n15, x + n16, y + height - n17);
                line(x + n6 / 2, y, x + n6 / 2, y - n18);
                line(x + n6 / 2, y + height, x + n6 / 2, y + height + n18);
            }
            break;
        }
    }
    ctx.restore();
}

// ---------------------------------------------------------------------------------------------------------------
// method_9: the region view (the HUD map above zoom factor 100)
// ---------------------------------------------------------------------------------------------------------------

export interface RegionViewParams {
    galaxy: Galaxy;
    player: Empire | null;
    width: number;
    height: number;
    /** (int_3, int_4): Main.int_13 / int_14, the Main View's centre. */
    viewX: number;
    viewY: number;
    /** Main.double_0: the Main View's zoom factor (world units per screen pixel). */
    zoomFactor: number;
    /** mainView.ClientRectangle size in screen pixels (the view rectangle). */
    viewWidth: number;
    viewHeight: number;
    /** bool_5: draw the backdrop / nebula / territory pictures (drawLayers does it; null skips them). */
    drawLayers?: ((ctx: CanvasRenderingContext2D, scale: number, originX: number, originY: number) => void) | null;
    /** bool_6 ShowFleetPostures. */
    fleetPostures?: boolean;
}

/** method_11: the world rectangle (int_5..int_6 × int_7..int_8) of a w × h world area centred on (x, y). */
function regionBounds(x: number, y: number, w: number, h: number): { x0: number; x1: number; y0: number; y1: number } {
    return { x0: Math.trunc(x - w / 2.0), x1: Math.trunc(x + w / 2.0), y0: Math.trunc(y - h / 2.0), y1: Math.trunc(y + h / 2.0) };
}

/** method_9's clamped centre: the area may not run more than eight sectors past the galaxy's edges. */
export function regionViewOrigin(galaxy: Galaxy, viewX: number, viewY: number, width: number, height: number, zoomFactor: number): { scale: number; x0: number; x1: number; y0: number; y1: number; cx: number; cy: number } {
    const num = regionScale(zoomFactor);
    const num2 = width * num;
    const num3 = height * num;
    let cx = Math.trunc(viewX);
    let cy = Math.trunc(viewY);
    let b = regionBounds(cx, cy, num2, num3);
    const num6 = galaxy.sectorSize * 8;
    if (b.x0 < -num6) {
        cx = Math.trunc(Math.trunc(num2) / 2) - num6;
        b = regionBounds(cx, cy, num2, num3);
    }
    if (b.x1 > galaxy.sizeX + num6) {
        cx = galaxy.sizeX + num6 - Math.trunc(Math.trunc(num2) / 2);
        b = regionBounds(cx, cy, num2, num3);
    }
    if (b.y0 < -num6) {
        cy = Math.trunc(Math.trunc(num3) / 2) - num6;
        b = regionBounds(cx, cy, num2, num3);
    }
    if (b.y1 > galaxy.sizeY + num6) {
        cy = galaxy.sizeY + num6 - Math.trunc(Math.trunc(num3) / 2);
        b = regionBounds(cx, cy, num2, num3);
    }
    return { scale: num, ...b, cx, cy };
}

/** Port of SystemView.cs method_9: the region of the galaxy around the view — pictures, sector grid, the view
 * rectangle, the player's fleet postures, and the systems with their dominant empire's ring and supply links. */
export function drawRegionView(ctx: CanvasRenderingContext2D, p: RegionViewParams): void {
    const { galaxy, player, width: W, height: H } = p;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    // The pictures are placed by the unclamped bounds (method_11 before the clamp), as the C# does.
    const num = regionScale(p.zoomFactor);
    const raw = regionBounds(Math.trunc(p.viewX), Math.trunc(p.viewY), W * num, H * num);
    if (p.drawLayers) p.drawLayers(ctx, num, raw.x0, raw.y0);
    const o = regionViewOrigin(galaxy, p.viewX, p.viewY, W, H, p.zoomFactor);
    const { x0: i7, x1: i8, y0: i9, y1: i10 } = o;
    const s7 = resolveSectorClamped(galaxy, i7, o.cy).x;
    const s8 = resolveSectorClamped(galaxy, i8, o.cy).x;
    const s9 = resolveSectorClamped(galaxy, o.cx, i9).y;
    const s10 = resolveSectorClamped(galaxy, o.cx, i10).y;
    const SS = galaxy.sectorSize;
    let gy0 = 0;
    let gy1 = H;
    let flag = false;
    let flag2 = false;
    if (s9 <= 1) gy0 = Math.trunc((s9 * SS - i9) / num);
    if (s10 >= galaxy.sectorHeight - 1) {
        gy1 = Math.trunc(((s10 + 1) * SS - i9) / num);
        flag2 = true;
    }
    let gx0 = 0;
    let gx1 = W;
    // The C# tests the column bound against SectorMaxY too (num8 >= Galaxy.SectorMaxY - 1); kept.
    if (s7 <= 1) gx0 = Math.trunc((s7 * SS - i7) / num);
    if (s8 >= galaxy.sectorHeight - 1) {
        gx1 = Math.trunc(((s8 + 1) * SS - i7) / num);
        flag = true;
    }
    ctx.strokeStyle = SV_PEN_1;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = s7; i <= s8; i++) {
        const x = Math.trunc((i * SS - i7) / num) + 0.5;
        ctx.moveTo(x, gy0);
        ctx.lineTo(x, gy1);
    }
    if (flag) {
        const x = Math.trunc(((s8 + 1) * SS - i7) / num) + 0.5;
        ctx.moveTo(x, gy0);
        ctx.lineTo(x, gy1);
    }
    for (let j = s9; j <= s10; j++) {
        const y = Math.trunc((j * SS - i9) / num) + 0.5;
        ctx.moveTo(gx0, y);
        ctx.lineTo(gx1, y);
    }
    if (flag2) {
        const y = Math.trunc(((s10 + 1) * SS - i9) / num) + 0.5;
        ctx.moveTo(gx0, y);
        ctx.lineTo(gx1, y);
    }
    ctx.stroke();
    // The view rectangle (24, color_7) + pen_2, centred.
    const vw = Math.trunc(p.viewWidth / (num / p.zoomFactor));
    const vh = Math.trunc(p.viewHeight / (num / p.zoomFactor));
    const rx = Math.trunc(W / 2) - Math.trunc(vw / 2);
    const ry = Math.trunc(H / 2) - Math.trunc(vh / 2);
    ctx.fillStyle = `rgba(${SV_VIEW_RGB}, ${24 / 255})`;
    ctx.fillRect(rx, ry, vw, vh);
    ctx.strokeStyle = SV_PEN_2;
    ctx.strokeRect(rx + 0.5, ry + 0.5, vw, vh);
    const playerEmpire = galaxy.playerEmpire;
    if (playerEmpire === null) return;
    if (p.fleetPostures) drawFleetPostures(ctx, playerEmpire, num, W, H, i7, i9);
    const seen = (idx: number): boolean => {
        const st = statusOf(player, idx);
        return st === SystemVisibilityStatus.Visible || st === SystemVisibilityStatus.Explored;
    };
    const dot = 2.0; // num11
    const inView = (sys: SystemInfo | undefined): boolean => sys !== undefined && sys.sector.x >= s7 && sys.sector.x <= s8 && sys.sector.y >= s9 && sys.sector.y <= s10;
    const links = (empire: Empire, sysIdx: number, fx: number, fy: number, exclude: readonly Habitat[] | null, onlyOutside: boolean): void => {
        const sv = empire.systemVisibility[sysIdx];
        if (sv === undefined) return;
        const list = onlyOutside ? sv.reciprocalLinkSystemStars : sv.linkSystemStars;
        if (list == null || list.length === 0) return;
        ctx.strokeStyle = cssColor(displayColorForEmpire(empire));
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 1.5]);
        for (const hb of list) {
            if (hb == null) continue;
            if (onlyOutside) {
                if (exclude !== null && exclude.includes(hb)) continue;
                if (inView(galaxy.systems[hb.systemIndex])) continue;
            }
            if (!seen(hb.systemIndex)) continue;
            ctx.beginPath();
            ctx.moveTo(fx, fy);
            ctx.lineTo((hb.xpos - i7) / num, (hb.ypos - i9) / num);
            ctx.stroke();
        }
        ctx.setLineDash([]);
    };
    for (let k = 0; k < galaxy.systems.length; k++) {
        const sys = galaxy.systems[k];
        if (sys == null || sys.sector == null || sys.systemStar == null) continue;
        if (sys.sector.x < s7 || sys.sector.x > s8 || sys.sector.y < s9 || sys.sector.y > s10) continue;
        const star = sys.systemStar;
        const x = (star.xpos - i7) / num;
        const y = (star.ypos - i9) / num;
        if (!(x >= 0 && x <= W && y >= 0 && y <= H)) continue;
        const dom = sys.dominantEmpire?.empire ?? null;
        if (dom !== null && seen(star.systemIndex)) {
            const own = dom.systemVisibility[star.systemIndex]?.linkSystemStars ?? null;
            links(dom, star.systemIndex, x, y, null, false);
            links(dom, star.systemIndex, x, y, own, true);
            for (const other of sys.otherEmpires ?? []) {
                if (other == null || other.empire == null) continue;
                const ol = other.empire.systemVisibility[star.systemIndex]?.linkSystemStars ?? null;
                links(other.empire, star.systemIndex, x, y, null, false);
                links(other.empire, star.systemIndex, x, y, ol, true);
            }
            ctx.strokeStyle = cssColor(displayColorForEmpire(dom));
            ctx.lineWidth = 2;
            if ((sys.otherEmpires?.length ?? 0) > 0) ctx.setLineDash([6, 2]);
            ctx.beginPath();
            ctx.ellipse(x, y, (dot + 4) / 2, (dot + 4) / 2, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.lineWidth = 1;
        }
        const c = regionStarColor(star);
        if (c !== null) {
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.ellipse(x, y, dot / 2, dot / 2, 0, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

/** SystemView.cs method_10 (= GalaxyMap.cs method_4): a system's star brush. */
export function regionStarColor(star: Habitat): string | null {
    if (star.category === HabitatCategoryType.Star) {
        switch (star.type) {
            case HabitatType.MainSequence: return C.yellow;
            case HabitatType.RedGiant:
            case HabitatType.SuperGiant: return C.red;
            case HabitatType.WhiteDwarf: return C.white;
            case HabitatType.Neutron: return C.aqua;
            case HabitatType.BlackHole: return C.blackHole;
            case HabitatType.SuperNova: return C.purple;
        }
        return null;
    }
    if (star.category === HabitatCategoryType.GasCloud) return 'rgb(238, 130, 238)';
    return null;
}

/** SystemView.cs method_8 (= GalaxyMap.cs method_5 at 48 alpha): the player's fleets' attack (red) and defend (blue)
 * posture ranges, with a dotted arrow from an attacking fleet's gather point. */
export function drawFleetPostures(ctx: CanvasRenderingContext2D, empire: Empire, num: number, W: number, H: number, ox: number, oy: number): void {
    const red = 'rgba(255, 0, 0, 0.188)';
    const blue = 'rgba(0, 0, 255, 0.188)';
    const groups = empireShipGroups(empire);
    const circle = (cx: number, cy: number, r: number, color: string): void => {
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    };
    const rangeOf = (g: ShipGroup): number => (g.postureRangeSquared > 2250000.0 && g.postureRangeSquared < 3.4028234663852886e38 ? Math.sqrt(g.postureRangeSquared) / num : 0);
    for (const g of groups) {
        if (g == null || g.leadShip == null) continue;
        if ((g.posture as number) === 0) {
            if (g.attackPoint == null) continue;
            const r = rangeOf(g);
            const x = (g.attackPoint.xpos - ox) / num;
            const y = (g.attackPoint.ypos - oy) / num;
            if (r > 0 && x + r > 0 && x - r < W && y + r > 0 && y - r < H) circle(x, y, r, red);
            if (g.gatherPoint != null) {
                const gx = (g.gatherPoint.xpos - ox) / num;
                const gy = (g.gatherPoint.ypos - oy) / num;
                ctx.strokeStyle = red;
                ctx.lineWidth = 1;
                ctx.setLineDash([1, 1]);
                ctx.beginPath();
                ctx.moveTo(gx, gy);
                ctx.lineTo(x, y);
                ctx.stroke();
                ctx.setLineDash([]);
                // LineCap.ArrowAnchor at the attack point.
                const ang = Math.atan2(y - gy, x - gx);
                ctx.fillStyle = red;
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.lineTo(x - 4 * Math.cos(ang - 0.5), y - 4 * Math.sin(ang - 0.5));
                ctx.lineTo(x - 4 * Math.cos(ang + 0.5), y - 4 * Math.sin(ang + 0.5));
                ctx.closePath();
                ctx.fill();
            }
        } else if (g.gatherPoint != null) {
            const r = rangeOf(g);
            const x = (g.gatherPoint.xpos - ox) / num;
            const y = (g.gatherPoint.ypos - oy) / num;
            if (r > 0 && x + r > 0 && x - r < W && y + r > 0 && y - r < H) circle(x, y, r, blue);
        }
    }
}

/** The world point under a pixel of a method_5 view (picSystemMap_MouseUp: (e - size / 2) × num + the star). */
export function systemViewWorldAt(star: Habitat, width: number, height: number, scale: number, px: number, py: number): { x: number; y: number } {
    const n = Math.trunc(scale);
    return { x: (Math.trunc(px) - Math.trunc(width / 2)) * n + Math.trunc(star.xpos), y: (Math.trunc(py) - Math.trunc(height / 2)) * n + Math.trunc(star.ypos) };
}

/** Galaxy.FindNearestHabitat for a system view click: the nearest habitat of the system nearest the point (the
 * original searches the galaxy index; within a 46 000-unit system view that is the same habitat). */
export function findNearestHabitatNear(galaxy: Galaxy, x: number, y: number): Habitat | null {
    const star = galaxy.fastFindNearestSystem(x, y);
    if (star === null) return null;
    let best: Habitat | null = null;
    let bestD = Number.MAX_VALUE;
    for (const h of systemViewHabitats(galaxy, star)) {
        const dx = h.xpos - x;
        const dy = h.ypos - y;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
            bestD = d;
            best = h;
        }
    }
    return best;
}
