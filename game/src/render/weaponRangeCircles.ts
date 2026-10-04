// Weapon-range circles and the star gravity-well ring for the selected ship (Bacon mod overlays). Render only.
//
// Sources (BaconDistantWorlds/BaconMain.cs):
//   442 DrawWeaponRanges     — gated by drawWeaponRangeCircles (BaconSettings showRangeCircles / the "!rangecircles"
//                              console toggle, BaconBuiltObject.cs 1341). For a selected BuiltObject (any empire's; not a
//                              fleet): one 1 px circle (200 segments) per weapon component TYPE (first weapon of each
//                              type, LINQ GroupBy order), radius Weapon.Range, coloured by type; Assault Pods are skipped.
//                              Then, beyond zoom factor 7.76, one circle per fighter specification (first fighter of each)
//                              at sqrt(round(BaconFighter.CalculateMaximumTargetRange, 2)): Silver interceptors, Gold
//                              bombers. The colour variable carries over between entries (a type without its own colour
//                              keeps the previous one; Beige to start), as in the C#.
//   404 DrawGravityWellRange — gated by useStarGravityWells: for the selected ship / fleet lead (not a base, the
//                              player's ActualEmpire) with a NearestSystemStar, a dashed Blue circle (200 segments, 1 px)
//                              of CalculateGravityWellSize around that star.
// Both are called from MainView.2.cs method_250 (5605 inside the system loop, 6035 in the selected-object block), which
// runs only while the zoom factor > BaconMain.minZoomLevelForWeaponsCircles (0.9 with the circles on, else 5.0;
// MainView.cs 1538).
//
// Opt-in like the mod: the weapon circles are behind a setting (getSettings().showWeaponRangeCircles, our stand-in for
// showRangeCircles / "!rangecircles"), off by default; the gravity-well ring follows the mod's own gate,
// useStarGravityWells (BaconSettings.txt; false in the stock install).

import type { Graphics } from 'pixi.js';
import type { BuiltObject } from '../sim/builtObject';
import type { Empire } from '../sim/empire';
import type { ShipGroup } from '../sim/fleets/shipGroup';
import { BuiltObjectRole } from '../sim/data/designSpecifications';
import { ComponentType } from '../sim/data/components';
import { FighterType, calculateMaximumTargetRange, type Fighter } from '../sim/combat/fighters';
import { baconMovementSettings, calculateGravityWellSize } from '../sim/movement';
import { circleAtScreenRes } from './screenCircle';

/** BaconMain.cs 48 minZoomLevelForWeaponsCircles with showRangeCircles on (method_250 runs above it). */
export const WEAPON_CIRCLES_MIN_FACTOR = 0.9;
/** BaconMain.cs 505: fighter range circles only beyond this zoom factor. */
export const FIGHTER_CIRCLES_MIN_FACTOR = 7.76;

// System.Drawing named colours used by DrawWeaponRanges / DrawGravityWellRange.
export const COLOR_BEIGE = 0xf5f5dc;
export const COLOR_BLUE = 0x0000ff;
export const COLOR_YELLOW = 0xffff00;
export const COLOR_RED = 0xff0000;
export const COLOR_GREEN = 0x008000;
export const COLOR_IVORY = 0xfffff0;
export const COLOR_ORANGE = 0xffa500;
export const COLOR_AQUA = 0x00ffff;
export const COLOR_AQUAMARINE = 0x7fffd4;
export const COLOR_SILVER = 0xc0c0c0;
export const COLOR_GOLD = 0xffd700;

export interface RangeCircle {
    /** World radius around the centre. */
    radius: number;
    color: number;
    dashed: boolean;
}

/** BaconMain.cs 466-494: the colour of a weapon type, or `prev` for a type without one (the C# keeps the variable). */
export function weaponRangeColor(type: ComponentType, prev: number): number {
    switch (type) {
        case ComponentType.WeaponBeam:
            return COLOR_BLUE;
        case ComponentType.WeaponMissile:
            return COLOR_YELLOW;
        case ComponentType.WeaponTorpedo:
            return COLOR_RED;
        case ComponentType.WeaponIonPulse:
            return COLOR_GREEN;
        case ComponentType.WeaponIonCannon:
            return COLOR_IVORY;
        case ComponentType.WeaponGravityBeam:
            return COLOR_ORANGE;
        case ComponentType.WeaponPhaser:
            return COLOR_AQUA;
        case ComponentType.WeaponRailGun:
            return COLOR_AQUAMARINE;
        default:
            return prev;
    }
}

type WeaponLike = { component: { type: ComponentType; def: { name: string } }; range: number };
type FighterLike = Pick<Fighter, 'specification' | 'parentBuiltObject' | 'topSpeed'>;

/**
 * Port of BaconMain.cs 442 DrawWeaponRanges (the circles, centred on the ship). `f` = zoom factor (the fighter circles
 * need f > 7.76). The fighter radius uses `maxTargetRangeSquared` (BaconFighter.CalculateMaximumTargetRange).
 */
export function weaponRangeCircles(
    bo: { weapons: readonly (WeaponLike | null)[]; fighters: readonly unknown[] | null },
    f: number,
    maxTargetRangeSquared: (fighter: FighterLike) => number = (x) => calculateMaximumTargetRange(x as Fighter),
): RangeCircle[] {
    const out: RangeCircle[] = [];
    let color = COLOR_BEIGE;
    if (bo.weapons.length > 0) {
        // `group x by x.Component.Type into g select g.First()`: the first weapon of each type, in first-seen order.
        const seen = new Set<ComponentType>();
        for (const item of bo.weapons) {
            if (item == null) continue;
            const type = item.component.type;
            if (seen.has(type)) continue;
            seen.add(type);
            if (item.component.def.name.includes('Assault Pod')) continue;
            color = weaponRangeColor(type, color);
            out.push({ radius: item.range, color, dashed: false });
        }
    }
    const fighters = bo.fighters as (FighterLike | null)[] | null;
    if (fighters === null || fighters.length <= 0 || !(f > FIGHTER_CIRCLES_MIN_FACTOR)) return out;
    // `group x by x.Specification into g select g.First()` (reference equality on the specification).
    const specs = new Set<unknown>();
    for (const item2 of fighters) {
        if (item2 == null) continue;
        if (specs.has(item2.specification)) continue;
        specs.add(item2.specification);
        if (item2.specification.type === FighterType.Interceptor) color = COLOR_SILVER;
        else if (item2.specification.type === FighterType.Bomber) color = COLOR_GOLD;
        const r = Math.sqrt(Math.round(maxTargetRangeSquared(item2) * 100) / 100);
        out.push({ radius: r, color, dashed: false });
    }
    return out;
}

export type RangeSelection = { builtObject?: BuiltObject; shipGroup?: ShipGroup } | null;

/**
 * BaconMain.cs 404 DrawGravityWellRange's subject and radius: the selected ship (or fleet lead) when it is not a base and
 * is the player's (ActualEmpire), has a NearestSystemStar and a positive well size. Null when useStarGravityWells is off.
 */
export function gravityWellRing(sel: RangeSelection, player: Empire | null): { star: { xpos: number; ypos: number }; radius: number } | null {
    if (!baconMovementSettings.useStarGravityWells || sel === null || player === null) return null;
    const bo = (sel.shipGroup !== undefined ? sel.shipGroup.leadShip : sel.builtObject) ?? null;
    if (bo === null || bo.role === BuiltObjectRole.Base || bo.actualEmpire !== player || bo.nearestSystemStar === null) return null;
    let r = 0;
    try {
        r = calculateGravityWellSize(bo);
    } catch {
        // GetGravityWellReductionForSmallShip with smallShipsJumpSooner is not ported (movement.ts TODO).
        return null;
    }
    if (!(r > 0)) return null;
    return { star: bo.nearestSystemStar, radius: r };
}

/**
 * XnaDrawingHelper.DrawCircle(..., lineThickness 1, segmentCount 200, dashed) in world space: 200 chords, every other
 * one skipped when dashed (DrawCircle 787-808). The stroke is left to the caller (1 px: width 1 / z).
 */
export function drawRangeCircle(g: Graphics, cx: number, cy: number, c: RangeCircle, z: number): void {
    if (!c.dashed) {
        circleAtScreenRes(g, cx, cy, c.radius, z);
        return;
    }
    const n = 200;
    const step = (Math.PI * 2) / n;
    for (let i = 0; i < n; i += 2) {
        const a0 = i * step;
        const a1 = a0 + step;
        g.moveTo(cx + c.radius * Math.cos(a0), cy + c.radius * Math.sin(a0)).lineTo(cx + c.radius * Math.cos(a1), cy + c.radius * Math.sin(a1));
    }
}
