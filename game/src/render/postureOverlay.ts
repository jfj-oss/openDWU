// Fleet Postures and Long Range Scanners map overlays (the HUD's Overlays list, btnMapOverlay1 / btnMapOverlay7).
// Render only: reads the sim, never writes it.
//
// Fleet Postures — MainView.2.cs 3921 method_247 (XNA path; GDI twin method_246 3868), called from method_250 5219
//   whenever GameOptions.MapOverlayFleetPostures is set (method_250 itself runs at every zoom factor above
//   BaconMain.minZoomLevelForWeaponsCircles, MainView.cs 1538). For every fleet of the viewing empire with a lead ship:
//   - Attack posture with an AttackPoint: when PostureRangeSquared lies in (1500², float.MaxValue), the
//     longrangescanners/lrs.png disc (texture2D_17 = bitmap_188, MainView.1.cs 2141) tinted Color.FromArgb(96, 255, 0,
//     64), radius sqrt(PostureRangeSquared), at the attack point, with a 1 px circle (100 segments) in the same colour;
//     and, when the fleet has a GatherPoint, a dashed 3 px line in that colour from the gather point to the attack point
//     with the arrowhead (texture2D_35) at the attack point (drawn even without the disc).
//   - Defend posture with a GatherPoint: the disc and circle in Color.FromArgb(96, 64, 0, 255) around the gather point.
//   Only discs that touch the view are drawn (the C# screen-rect test).
//
// Long Range Scanners — baked into the galaxy / sector background bitmaps (MainView.1.cs 4006-4058 method_119 for the
//   galaxy backdrop, MainView.2.cs 277-322 method_147 for the sector backdrop) while MapOverlayLongRangeScanners: every
//   PlayerEmpire.LongRangeScanners entry that is a base or stands still (CurrentSpeed == 0) draws lrs.png with its RGB
//   replaced by white (method_221: the colour matrix keeps only the alpha) over a square of side 2 x SensorLongRange
//   inflated by 10 % of that side on every side (radius 1.2 x SensorLongRange), all into one transparent layer, which is
//   then composited at 13 % (method_236(0.13)). The backgrounds are drawn at zoom factor > 70 (MainView.cs 1520
//   method_132) and the sector one fades in below f = 210 (FadeSectorBackground: (f - 70) / 210; scannerLayerFade).
//   Here: sprites in one container whose ColorMatrixFilter (the group composite) sets RGB to white and alpha x 0.13,
//   above the territory layer.

import type { Empire } from '../sim/empire';
import type { ShipGroup } from '../sim/fleets/shipGroup';
import type { BuiltObject } from '../sim/builtObject';
import { BuiltObjectRole } from '../sim/data/designSpecifications';
import { FleetPosture } from '../sim/diplomacyTick';

/** The disc art (images/effects/longrangescanners/lrs.png; Main.Part13.cs 1424). */
export const LRS_DISC_URL = '/assets/dwu/images/effects/longrangescanners/lrs.png';

/** method_247: Color.FromArgb(96, 255, 0, 64) (attack) and Color.FromArgb(96, 64, 0, 255) (defend). */
export const POSTURE_ATTACK_COLOR = 0xff0040;
export const POSTURE_DEFEND_COLOR = 0x4000ff;
export const POSTURE_ALPHA = 96 / 255;
/** method_247: the posture range only draws between 1500² and float.MaxValue (the "unlimited" default). */
export const POSTURE_RANGE_MIN_SQUARED = 2250000.0;
export const POSTURE_RANGE_MAX_SQUARED = 3.4028234663852886e38;
/** method_247: the gather → attack line is 3 px wide. */
export const POSTURE_LINE_WIDTH_PX = 3;

/** method_236(0.13): the scanner layer's alpha. */
export const LRS_LAYER_ALPHA = 0.13;
/** Inflate(Width * 0.1): the drawn disc is 1.2 x the sensor range. */
export const LRS_DISC_RADIUS_FACTOR = 1.2;
/** MainView.cs 1520: the backgrounds (and so the scanner discs) are drawn at zoom factor > 70. */
export const LRS_MIN_FACTOR = 70;

export interface PostureMark {
    posture: 'attack' | 'defend';
    /** The disc centre (attack point / gather point), world. */
    x: number;
    y: number;
    /** World radius (0 = no disc: the range is outside (1500², float.MaxValue)). */
    radius: number;
    color: number;
    /** Attack posture with a gather point: the line's start (it ends at x, y). */
    from: { x: number; y: number } | null;
}

/** method_247's num / num4: sqrt(PostureRangeSquared) when it lies in the drawn band, else 0. */
export function postureRadius(postureRangeSquared: number): number {
    return postureRangeSquared > POSTURE_RANGE_MIN_SQUARED && postureRangeSquared < POSTURE_RANGE_MAX_SQUARED ? Math.sqrt(postureRangeSquared) : 0;
}

/** Port of MainView.2.cs 3921 method_247: the marks of `empire`'s fleets (view culling is the caller's). */
export function fleetPostureMarks(empire: Pick<Empire, 'shipGroups'>): PostureMark[] {
    const out: PostureMark[] = [];
    for (const sgU of empire.shipGroups) {
        const sg = sgU as ShipGroup | null;
        if (sg === null || sg.leadShip === null) continue;
        const posture = sg.posture as number as FleetPosture;
        if (posture === FleetPosture.Attack) {
            const ap = sg.attackPoint;
            if (ap === null) continue;
            const gp = sg.gatherPoint;
            out.push({ posture: 'attack', x: ap.xpos, y: ap.ypos, radius: postureRadius(sg.postureRangeSquared), color: POSTURE_ATTACK_COLOR, from: gp !== null ? { x: gp.xpos, y: gp.ypos } : null });
        } else if (posture === FleetPosture.Defend && sg.gatherPoint !== null) {
            const gp = sg.gatherPoint;
            out.push({ posture: 'defend', x: gp.xpos, y: gp.ypos, radius: postureRadius(sg.postureRangeSquared), color: POSTURE_DEFEND_COLOR, from: null });
        }
    }
    return out;
}

export interface ScannerDisc {
    x: number;
    y: number;
    radius: number;
}

/** MainView.2.cs 285-296: the player's long range scanners that draw (bases, or ships standing still). */
export function longRangeScannerDiscs(empire: Pick<Empire, 'longRangeScanners'>): ScannerDisc[] {
    const out: ScannerDisc[] = [];
    for (const u of empire.longRangeScanners) {
        const bo = u as BuiltObject | null;
        if (bo === null || bo === undefined) continue;
        if (bo.role !== BuiltObjectRole.Base && bo.currentSpeed !== 0) continue;
        const r = bo.sensorLongRange;
        // Int truncation of the position (int)Xpos - range ... as in the C# rect.
        out.push({ x: Math.trunc(bo.xpos), y: Math.trunc(bo.ypos), radius: r * LRS_DISC_RADIUS_FACTOR });
    }
    return out;
}

/**
 * The backdrop's alpha at zoom factor f (method_16 scales the bitmap's alpha): the sector backdrop (drawn up to f = 2500,
 * method_132) fades in as (f - 70) / 210 while f < 210 (FadeSectorBackground) and is opaque from there; the galaxy
 * backdrop beyond f = 2500 is opaque (FadeGalaxyBackground fades only below 350). Nothing at or below f = 70.
 */
export function scannerLayerFade(f: number): number {
    if (!(f > LRS_MIN_FACTOR)) return 0;
    if (f < 210.0) return Math.min(1, Math.max(0, (f - 70.0) / 210.0));
    return 1;
}
