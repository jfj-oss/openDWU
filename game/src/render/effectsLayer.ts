// Combat effects layer: weapon fire, hit flashes / shield strikes, explosions
// and hyperjump enter/exit flashes, drawn like the original's XNA Main View.
//
// Sources (DistantWorlds/Controls, the XNA path DrawMainViewXna):
//   MainView.2.cs 1509 method_171   — one weapon in flight (torpedoes/missiles, beams/rails, phasers, tractor and
//                                      gravity beams, area weapons, intercepted missiles)
//   MainView.2.cs 757-805 method_159/160/161 — beam-bolt sprite size / position
//   MainView.2.cs 2687/2777-2818 method_180/183/185 — explosions of habitats / ships
//   MainView.2.cs 2854 method_187   — the planet-destroyer explosion
//   MainView.1.cs 1215-1250         — shield strike (200 ms) and tractor strike (2 s) overlays on ships
//   MainView.1.cs 3062 method_97    — hyperjump enter / exit animations
//   AnimationSystem.cs              — the one-shot animation player (fxCommon.ts)
//   Main.Part12.cs 46 LoadEffectsWeapons / 125 LoadEffectsExplosion, Main.Part13.cs 1265-1330 (hyper
//   animations), 1395 (shield strike), 1490 (construction sparks), 1510 (tractor strike) — the art.
//
// Nothing here writes sim state. Where the C# renderer mutates the model (it sets BuiltObject.LastShieldStrike /
// LastTractorStrike for phasers and tractor beams, and clears HyperEnterStartAnimation / HyperExitStartAnimation once
// it has started the animation) the layer keeps its own per-object record instead. Where the C# renderer draws
// Galaxy.Rnd for purely visual variation (MainView.2.cs 1526-1527 intercepted-missile explosion, 1873 phaser hull-hit
// spark rotation) it uses a render-local generator: those draws happen on the UI thread once per drawn frame in the
// original, so they are not part of the reproducible sim sequence, and drawing them from the sim's Random would make
// the game depend on the frame rate.
//
//   MainView.2.cs 1010 method_165 + 651 method_156 — a fighter's weapons in flight (beam bolts, torpedoes / missiles)
//   MainView.2.cs 2783 method_184 → method_185 — a fighter's explosions; MainView.1.cs 1522-1541 — its shield strike
// Fighters themselves are drawn by fighterLayer.ts; their shots, explosions and shield strikes are drawn here, from the
// same Fighter records (Fighter.Weapons / Explosions / LastShieldStrike) the sim keeps.
// TODO(port): ion-strike lightning overlay (LastIonStrike, LightningGenerator) — MainView.1.cs 1162-1201

import { sampleShot, type MotionInterpolator } from './renderInterp';
import { Container, Graphics, Texture } from 'pixi.js';
import type { Camera } from './camera';
import type { AssetStore } from './assets';
import { AnimationPlayer, FrameSet, SpritePool, loopFrameIndex, placeSprite } from './fxCommon';
import { BUILT_OBJECT_MAX_FACTOR } from './builtObjectLayer';
import type { Galaxy } from '../sim/galaxy';
import { BuiltObject } from '../sim/builtObject';
import { Habitat, HabitatCategoryType } from '../sim/types';
import { habitatSystemIndex } from './habitatIndex';
import type { Weapon } from '../sim/weapon';
import { ComponentType } from '../sim/data/components';
import { EXPLOSION_HABITAT_IMAGE_COUNT, EXPLOSION_IMAGE_COUNT, type Explosion } from '../sim/combat/damage';
import { MIN_TIME, galaxyStarDate } from '../sim/tick/simTime';
import { fightersOf, type Fighter } from '../sim/combat/fighters';
import { ComponentCategoryType } from '../sim/data/policies';
import { fighterDrawnSizePx } from './fighterLayer';
import { fogOf } from './fog';

const IMG = '/assets/dwu/images';
/** The original rotates weapon / hyper art 90° clockwise at load (RotateFlip(Rotate90FlipNone)); drawing the raw
 * PNG therefore needs this extra rotation on top of the C# angle. */
const ROT90 = Math.PI / 2;
/** Weapon.Power set by an interceptor on the missile it shot down (float.MaxValue). */
const INTERCEPTED_POWER = Math.fround(3.4028234663852886e38);
/** MainView.1.cs 1003 / 1038: objects are culled 50 px outside the view. */
const CULL_MARGIN_PX = 50;

// ---------------------------------------------------------------------------------------------------------------
// Art (Main.Part12.cs LoadEffectsWeapons / LoadEffectsExplosion, Main.Part13.cs LoadEffects / hyper folders)
// ---------------------------------------------------------------------------------------------------------------

/** torpedo_*.png (texture2D_1, 8 files). */
export const TORPEDO_IMAGE_COUNT = 8;
/** beam_*.png (texture2D_2): Directory.GetFiles("beam_*.png") matches beam_0 .. beam_12. */
export const BEAM_IMAGE_COUNT = 13;
/** area_*.png (texture2D_3). */
export const AREA_IMAGE_COUNT = 4;
/** effects/explosions/<dir>: Directory.GetDirectories in NTFS (case-insensitive ordinal) order = ExplosionImageIndex. */
export const EXPLOSION_SET_DIRS = [
    'Expl01', 'Expl01b', 'Expl01c', 'Expl01d', 'Expl01e',
    'Expl02a', 'Expl02b', 'Expl02c', 'Expl02d',
    'Expl05a', 'Expl05b', 'Expl05c', 'Expl05d', 'Expl05e',
    'Expl07c', 'Expl07d', 'Expl07e', 'Expl07f', 'Expl07g', 'Expl07h',
] as const;
/** effects/hyperenter/<k>/frame_<n>.png and hyperexit/<k>/ file counts of the install's folders 0..3 (the C# loads
 * folders "0", "1", … until one is missing, Main.Part13.cs 1296-1330; Design.HyperDriveIndex picks one). */
export const HYPER_ENTER_FRAME_COUNTS = [50, 32, 40, 43] as const;
export const HYPER_EXIT_FRAME_COUNTS = [35, 31, 43, 42] as const;
/** effects/construction/Frame_001..090 (texture2D_33 — the phaser hull-hit spark). */
export const CONSTRUCTION_FRAME_COUNT = 90;
/** effects/tractorbeamstrike/01..12.PNG (texture2D_34). */
export const TRACTOR_STRIKE_FRAME_COUNT = 12;
/** environment/stars/blackhole/BlkHole-0001..0100 (texture2D_13, the area-gravity vortex). */
export const BLACKHOLE_FRAME_COUNT = 100;

export function explosionFrameUrl(set: number, frame: number): string {
    const dir = EXPLOSION_SET_DIRS[set] ?? EXPLOSION_SET_DIRS[0];
    return `${IMG}/effects/explosions/${dir}/${dir}${String(frame + 1).padStart(4, '0')}.png`;
}

// ---------------------------------------------------------------------------------------------------------------
// Pure maths
// ---------------------------------------------------------------------------------------------------------------

/** Main.Part11.cs 463 CalculateShipZoomFactor (maxWidth unused here). */
export function shipZoomFactor(f: number): number {
    return f > 3.0 ? Math.max(3.0, f / 3.0) : f;
}

/**
 * MainView.2.cs 1537-1573: the fraction of range after which a shot fades out (num5), by weapon family.
 */
export function weaponFadeStart(type: ComponentType): number {
    switch (type) {
        case ComponentType.WeaponPhaser:
        case ComponentType.WeaponSuperPhaser:
            return 0.97;
        case ComponentType.WeaponTorpedo:
        case ComponentType.WeaponSuperTorpedo:
            return 0.6;
        case ComponentType.WeaponBombard:
        case ComponentType.WeaponMissile:
        case ComponentType.WeaponPointDefense:
        case ComponentType.WeaponRailGun:
        case ComponentType.WeaponSuperMissile:
        case ComponentType.WeaponSuperRailGun:
            return 0.9;
        case ComponentType.WeaponTractorBeam:
        case ComponentType.WeaponGravityBeam:
            return 0.95;
        case ComponentType.WeaponAreaGravity:
            return 0.9;
        case ComponentType.AssaultPod:
            return 1.0;
        case ComponentType.WeaponBeam:
        case ComponentType.WeaponIonCannon:
        case ComponentType.WeaponIonPulse:
        case ComponentType.WeaponSuperBeam:
            return 0.75;
        case ComponentType.WeaponAreaDestruction:
        case ComponentType.WeaponSuperArea:
            return 0.8;
        default:
            return 0.6;
    }
}

/**
 * MainView.2.cs 1536-1578: the shot's opacity (0..1) — 1 until DistanceTravelled / Range passes the family's fade
 * start, then a linear fade to 0 at full range. The C# builds `Color.FromArgb((int)(num4 * 255.0), …)`.
 */
export function weaponFadeAlpha(type: ComponentType, distanceTravelled: number, range: number): number {
    const num3 = Math.min(1.0, distanceTravelled / range);
    const num5 = weaponFadeStart(type);
    let num4 = 1.0;
    if (num3 > num5) num4 = (1.0 - num3) / (1.0 - num5);
    return Math.max(0, Math.trunc(num4 * 255.0)) / 255;
}

/**
 * GraphicsHelper.cs 93 OscillateColor: ping-pong between `start` (at an even second's start) and `end` over two
 * seconds, per channel with the C#'s byte truncation. Colours are 0xAARRGGBB; `nowMs` is the galaxy clock.
 */
export function oscillateColor(start: number, end: number, nowMs: number): number {
    const t = Math.trunc(nowMs);
    const second = Math.trunc(t / 1000) % 60;
    let millisecond = ((t % 1000) + 1000) % 1000;
    if (second % 2 === 1) millisecond += 1000;
    const num = millisecond <= 1000 ? Math.abs(1000 - millisecond) / 1000.0 : (millisecond - 1000) / 1000.0;
    let out = 0;
    for (let shift = 24; shift >= 0; shift -= 8) {
        const s = (start >>> shift) & 0xff;
        const e = (end >>> shift) & 0xff;
        const c = (s - (Math.trunc((s - e) * num) & 0xff)) & 0xff;
        out = out * 256 + c;
    }
    return out >>> 0;
}

/** What one weapon in flight draws this frame (a reusable out-record; see weaponDrawCommand). */
export const enum WeaponDrawKind {
    None = 0,
    /** Torpedo / missile / bombard sprite centred on the shot. */
    Projectile,
    /** Beam / point-defence / ion-cannon / rail / assault-pod bolt sprite centred on the shot. */
    Bolt,
    /** Phaser / tractor / gravity beam stretched from the firer to the target. */
    Stretched,
    /** Ion pulse / area destruction ring of radius DistanceTravelled around the shot. */
    Area,
    /** Gravity-well (area gravity) vortex. */
    AreaGravity,
    /** A missile shot down by point defence (Power == float.MaxValue): an explosion animation. */
    Intercepted,
}

export const enum WeaponArt {
    Torpedo = 0,
    Beam,
    Area,
    AssaultPod,
}

export interface WeaponDraw {
    kind: WeaponDrawKind;
    art: WeaponArt;
    /** Index into the art family (torpedo_N / beam_N / area_N). */
    artIndex: number;
    /** Sprite centre (Projectile / Bolt / Area / AreaGravity), or the beam origin (Stretched); world units. */
    x: number;
    y: number;
    /** C# rotation of the load-rotated art (add ROT90 for the raw PNG). */
    rotation: number;
    /** Projectile: drawn size px (square). Bolt: px along the heading. Stretched: px firer → target. Area: diameter px. */
    alongPx: number;
    /** Bolt: px across the heading. Stretched: scale applied to the art's height (the C# `1 / zoom`). */
    across: number;
    /** 0..1 opacity and 0xRRGGBB tint of the sprite. */
    alpha: number;
    tint: number;
    /** Area / AreaGravity: the line from the firer to the shot (0xAARRGGBB, width px; 0 = none). */
    lineFromX: number;
    lineFromY: number;
    lineColor: number;
    lineWidth: number;
    /** AreaGravity: vortex disc / animation sizes px, the disc's rotation and tints (0xAARRGGBB). */
    discPx: number;
    discRotation: number;
    discColor: number;
    vortexPx: number;
    vortexAlpha: number;
}

export function newWeaponDraw(): WeaponDraw {
    return {
        kind: WeaponDrawKind.None, art: WeaponArt.Torpedo, artIndex: 0, x: 0, y: 0, rotation: 0, alongPx: 0, across: 0,
        alpha: 1, tint: 0xffffff, lineFromX: 0, lineFromY: 0, lineColor: 0, lineWidth: 0,
        discPx: 0, discRotation: 0, discColor: 0, vortexPx: 0, vortexAlpha: 0,
    };
}

/** The parts of a Weapon the drawer reads (a structural subset of sim/weapon.ts Weapon). */
export interface WeaponLike {
    distanceTravelled: number;
    power: number;
    heading: number;
    x: number;
    y: number;
    lastFired: number;
    target: unknown;
    readonly range: number;
    readonly rawDamage: number;
    readonly bombardDamage: number;
    readonly damageLoss: number;
    readonly component: { readonly type: ComponentType; readonly specialImageIndex: number };
}

interface Positioned {
    xpos: number;
    ypos: number;
}

/** Where a shot is drawn: the weapon's own (x, y, heading), or its render-interpolated sample (renderInterp.ts
 * sampleShot). */
export interface ShotPosition {
    readonly x: number;
    readonly y: number;
    readonly heading: number;
}

/**
 * World units / game s a ship's or habitat's shot flies along its heading at its firer's next touch (HandleWeaponsFiring,
 * BuiltObject.1.cs 3737 / Habitat giant ion cannon: Speed × dt; a missile ramps up to Speed over its first 120 units,
 * at least 3), for sampleShot's extrapolation between firer touches. 0 for the launch step (DistanceTravelled ≤ 1: a
 * fixed 2 / 10 unit step) and for shots that do not fly in a line: area rings (centred on the target), gravity / tractor
 * beams (placed on the target), assault pods (handleAssaultPodMovement), and a shot that has hit or run out of range
 * (ResetNext: it stays where it ended until the next touch clears it).
 */
export function shotFlightSpeed(type: ComponentType, speed: number, distanceTravelled: number, resetNext = false): number {
    if (!(distanceTravelled > 1) || !(speed > 0) || resetNext) return 0;
    switch (type) {
        case ComponentType.WeaponBeam:
        case ComponentType.WeaponPointDefense:
        case ComponentType.WeaponIonCannon:
        case ComponentType.WeaponSuperBeam:
        case ComponentType.WeaponPhaser:
        case ComponentType.WeaponRailGun:
        case ComponentType.WeaponSuperPhaser:
        case ComponentType.WeaponSuperRailGun:
        case ComponentType.WeaponTorpedo:
        case ComponentType.WeaponBombard:
        case ComponentType.WeaponSuperTorpedo:
            return speed;
        case ComponentType.WeaponMissile:
        case ComponentType.WeaponSuperMissile:
            return distanceTravelled < 120 ? Math.max(3, speed * (distanceTravelled / 120)) : speed;
        default:
            return 0;
    }
}

/** A fighter's shot: beams and torpedo-category shots fly at Speed × dt past the launch step (Fighter.cs HandleWeaponsFiring). */
export function fighterShotFlightSpeed(category: ComponentCategoryType, speed: number, distanceTravelled: number, resetNext = false): number {
    if (!(distanceTravelled > 1) || !(speed > 0) || resetNext) return 0;
    return category === ComponentCategoryType.WeaponBeam || category === ComponentCategoryType.WeaponTorpedo ? speed : 0;
}

function hasPosition(o: unknown): o is Positioned {
    return typeof o === 'object' && o !== null && typeof (o as Positioned).xpos === 'number' && typeof (o as Positioned).ypos === 'number';
}

function artIndex(special: number, count: number): number {
    return special >= 0 && special < count ? special : 0;
}

/** Galaxy.DetermineAngle: atan2(dy, dx). */
function determineAngle(x1: number, y1: number, x2: number, y2: number): number {
    return Math.atan2(y2 - y1, x2 - x1);
}

/** The area weapons' line width by zoom factor (MainView.2.cs 1612 / 1901: 5 / 3 / 1 px). */
export function areaLineWidth(f: number): number {
    return f < 2.0 ? 5 : f < 5.0 ? 3 : 1;
}

/**
 * Area weapons' ring alpha ramp (MainView.2.cs 1601-1611 / 1889-1899): fade in over the first 2 % of range, out over
 * the last 10 %; returns 0..255.
 */
export function areaRampAlpha(distanceTravelled: number, range: number): number {
    const num = Math.fround(distanceTravelled / range);
    let val = 255;
    if (num < 0.02) val = Math.trunc(num * 50 * 255);
    else if (num > 0.9) val = Math.trunc((0.1 - (num - 0.9)) * 10 * 255);
    return Math.max(0, Math.min(255, val));
}

/**
 * Port of MainView.2.cs 1509 method_171 (XNA): what one weapon draws this frame, written into `out`. `firer` is the
 * firing ship or habitat, `f` the zoom factor (1 / camera zoom), `nowMs` the galaxy clock, `bombardTargetIsHabitat`
 * whether Target is a Habitat. Returns out.kind (None when nothing is drawn).
 */
export function weaponDrawCommand(
    weapon: WeaponLike, firer: Positioned, f: number, nowMs: number, out: WeaponDraw, shot: ShotPosition = weapon, targetAt: Positioned | null = null,
): WeaponDrawKind {
    out.kind = WeaponDrawKind.None;
    out.lineWidth = 0;
    if (!(weapon.distanceTravelled >= 0)) return WeaponDrawKind.None;
    const type = weapon.component.type;
    const special = weapon.component.specialImageIndex;
    if (weapon.power === INTERCEPTED_POWER) {
        out.kind = WeaponDrawKind.Intercepted;
        out.x = shot.x;
        out.y = shot.y;
        return out.kind;
    }
    let alpha = weaponFadeAlpha(type, weapon.distanceTravelled, weapon.range);
    out.tint = 0xffffff;
    switch (type) {
        case ComponentType.WeaponTorpedo:
        case ComponentType.WeaponBombard:
        case ComponentType.WeaponMissile:
        case ComponentType.WeaponSuperTorpedo:
        case ComponentType.WeaponSuperMissile: {
            let num43 = -1;
            let num44 = 0.0;
            let num45 = weapon.power;
            let num46 = -1000.0;
            if (weapon.bombardDamage > 0 && weapon.target instanceof Habitat) {
                num45 = Math.min(weapon.bombardDamage * 2.5, 60.0);
                num43 = artIndex(special, TORPEDO_IMAGE_COUNT);
                switch (type) {
                    case ComponentType.WeaponTorpedo:
                    case ComponentType.WeaponSuperTorpedo:
                        num44 = 4.0840704496667311;
                        break;
                    default:
                        num46 = shot.heading;
                        alpha = 1; // color = Color.White
                        break;
                }
            }
            let num47: number;
            let val4 = 18;
            if (type === ComponentType.WeaponMissile) {
                num47 = num45 / 5.0 + 5;
            } else if (type === ComponentType.WeaponSuperMissile) {
                num47 = num45 / 10.0 + 5;
                val4 = 38;
            } else if (type === ComponentType.WeaponSuperTorpedo) {
                num47 = num45 / 10.0 + 5;
                val4 = 48;
            } else if (type === ComponentType.WeaponBombard) {
                num47 = num45 / 0.5 + 6;
                val4 = 26;
            } else {
                num47 = num45 / 3.0 + 7;
            }
            num47 = Math.min(num47, val4);
            let num14 = num47 / f;
            if (num14 < 1) num14 = 1;
            let num48 = 1.0;
            if (num43 < 0) {
                num43 = artIndex(special, TORPEDO_IMAGE_COUNT);
                switch (type) {
                    case ComponentType.WeaponTorpedo:
                    case ComponentType.WeaponSuperTorpedo:
                        num44 = Math.PI;
                        break;
                    case ComponentType.WeaponBombard:
                    case ComponentType.WeaponMissile:
                    case ComponentType.WeaponSuperMissile:
                        num44 = 0.0;
                        num46 = shot.heading;
                        num48 = 3.5;
                        break;
                }
            }
            const totalSeconds = (nowMs - weapon.lastFired) / 1000;
            let rotation = totalSeconds * num44;
            if (num46 > -1000.0) rotation = num46;
            out.kind = WeaponDrawKind.Projectile;
            out.art = WeaponArt.Torpedo;
            out.artIndex = num43;
            out.x = shot.x;
            out.y = shot.y;
            out.rotation = rotation;
            // scale = num48 * (num14 / texture.Width): the square art is drawn num48 * num14 px wide.
            out.alongPx = num48 * num14;
            out.across = out.alongPx;
            out.alpha = alpha;
            return out.kind;
        }
        case ComponentType.WeaponAreaGravity: {
            const val3 = areaRampAlpha(weapon.distanceTravelled, weapon.range);
            const lineAlpha = Math.trunc(val3 * 0.6);
            out.kind = WeaponDrawKind.AreaGravity;
            out.x = shot.x;
            out.y = shot.y;
            out.lineFromX = firer.xpos;
            out.lineFromY = firer.ypos;
            out.lineWidth = areaLineWidth(f);
            out.lineColor = oscillateColor(argb(lineAlpha, 0, 176, 164), argb(lineAlpha, 0, 64, 56), nowMs);
            out.discPx = Math.trunc((weapon.damageLoss * 2.0) / f);
            out.discColor = oscillateColor(argb(val3, 0, 0, 108), argb(val3, 54, 0, 108), nowMs);
            const secs = (Math.trunc(nowMs / 1000) % 60) + (((Math.trunc(nowMs) % 1000) + 1000) % 1000) / 1000.0;
            out.discRotation = (Math.PI / 10.0) * (secs % 20.0);
            out.vortexPx = Math.trunc((weapon.bombardDamage * 2.0) / f);
            out.vortexAlpha = val3 / 255;
            out.alpha = alpha;
            return out.kind;
        }
        case ComponentType.WeaponBeam:
        case ComponentType.WeaponPointDefense:
        case ComponentType.WeaponIonCannon:
        case ComponentType.WeaponTractorBeam:
        case ComponentType.WeaponGravityBeam:
        case ComponentType.AssaultPod:
        case ComponentType.WeaponSuperBeam:
        case ComponentType.WeaponPhaser:
        case ComponentType.WeaponRailGun:
        case ComponentType.WeaponSuperPhaser:
        case ComponentType.WeaponSuperRailGun: {
            const isPod = type === ComponentType.AssaultPod;
            out.art = isPod ? WeaponArt.AssaultPod : WeaponArt.Beam;
            out.artIndex = isPod ? 0 : artIndex(special, BEAM_IMAGE_COUNT);
            if (type === ComponentType.WeaponGravityBeam || type === ComponentType.WeaponTractorBeam || type === ComponentType.WeaponPhaser || type === ComponentType.WeaponSuperPhaser) {
                const target = targetAt ?? weapon.target;
                if (!hasPosition(target)) return WeaponDrawKind.None;
                const dist = Math.hypot(target.xpos - firer.xpos, target.ypos - firer.ypos);
                if (!(dist < weapon.range * 1.2)) return WeaponDrawKind.None;
                out.kind = WeaponDrawKind.Stretched;
                out.x = firer.xpos;
                out.y = firer.ypos;
                // The gravity beam aims at the shot's position, the others at the target (MainView.2.cs 1334 / 1360 / 1861).
                out.rotation = type === ComponentType.WeaponGravityBeam ? determineAngle(firer.xpos, firer.ypos, shot.x, shot.y) : determineAngle(firer.xpos, firer.ypos, target.xpos, target.ypos);
                out.alongPx = dist / f;
                out.across = 1.0 / f;
                const c = oscillateColor(argb(144, 255, 255, 255), argb(255, 255, 255, 255), nowMs);
                out.alpha = ((c >>> 24) & 0xff) / 255;
                return out.kind;
            }
            // method_159 / method_160 / method_161.
            let num = Math.min(300.0, 10.0 * Math.sqrt(weapon.rawDamage));
            if (type === ComponentType.WeaponRailGun || type === ComponentType.WeaponSuperRailGun) {
                num = Math.min(300.0, 7.0 * Math.sqrt(weapon.rawDamage));
            } else if (isPod) {
                num = 18.0;
            }
            // Scales of the (square, load-rotated) art relative to its height: num / H / zoom along, the same across
            // unless the shot is still closer to the firer than its own length (then squeezed across).
            let alongPx = num / f;
            let acrossPx = alongPx;
            if (!isPod) {
                const d = Math.hypot(firer.xpos - shot.x, firer.ypos - shot.y) / f;
                if (d < num) acrossPx /= num / d;
            }
            out.kind = WeaponDrawKind.Bolt;
            out.x = shot.x;
            out.y = shot.y;
            out.rotation = shot.heading;
            out.alongPx = alongPx;
            out.across = acrossPx;
            out.alpha = alpha;
            return out.kind;
        }
        case ComponentType.WeaponIonPulse:
        case ComponentType.WeaponAreaDestruction:
        case ComponentType.WeaponSuperArea: {
            const val = areaRampAlpha(weapon.distanceTravelled, weapon.range);
            out.kind = WeaponDrawKind.Area;
            out.art = WeaponArt.Area;
            out.artIndex = artIndex(special, AREA_IMAGE_COUNT);
            out.x = shot.x;
            out.y = shot.y;
            out.rotation = 0;
            out.alongPx = (weapon.distanceTravelled / f) * 2.0;
            out.across = out.alongPx;
            out.alpha = alpha;
            out.lineFromX = firer.xpos;
            out.lineFromY = firer.ypos;
            out.lineWidth = areaLineWidth(f);
            out.lineColor = oscillateColor(argb(val, 144, 0, 176), argb(val, 48, 0, 64), nowMs);
            return out.kind;
        }
        default:
            return WeaponDrawKind.None;
    }
}

/** The parts of a FighterWeapon the drawer reads (a structural subset of sim/combat/fighters.ts FighterWeapon). */
export interface FighterWeaponLike {
    distanceTravelled: number;
    power: number;
    heading: number;
    x: number;
    y: number;
    lastFired: number;
    readonly range: number;
    readonly rawDamage: number;
    readonly category: ComponentCategoryType;
    readonly type: ComponentType;
}

/**
 * MainView.2.cs 1010 method_165: the fade of a fighter's shot — full until num3 of its range (0.75 for beams, 0.6
 * otherwise), then linear to 0 at full range; the C# colour alpha is (int)(num2 * 255).
 */
export function fighterWeaponAlpha(category: ComponentCategoryType, distanceTravelled: number, range: number): number {
    const num = Math.min(1.0, distanceTravelled / range);
    const num3 = category === ComponentCategoryType.WeaponBeam ? 0.75 : 0.6;
    let num2 = 1.0;
    if (num > num3) num2 = (1.0 - num) / (1.0 - num3);
    return num2 < 1.0 ? Math.trunc(num2 * 255.0) / 255 : 1;
}

/**
 * Port of MainView.2.cs 1010 method_165 (XNA) for one fighter weapon: beam-category shots are bolts sized by
 * method_156 (min(300, 10·sqrt(RawDamage)) px, squeezed across while closer to the fighter than their length);
 * torpedo-category shots are the torpedo art, (Power / 0.6 + 5) px for missiles or (Power / 4 + 7) px otherwise,
 * capped at 18 and at least 1 px after the zoom, spinning at π rad/s (torpedoes) or turned to the heading (missiles).
 * The art index is the fighter specification's WeaponImageIndex (out of range → 0). Other categories draw nothing.
 */
export function fighterWeaponDrawCommand(
    weapon: FighterWeaponLike, firer: Positioned, weaponImageIndex: number, f: number, nowMs: number, out: WeaponDraw, shot: ShotPosition = weapon,
): WeaponDrawKind {
    out.kind = WeaponDrawKind.None;
    out.lineWidth = 0;
    if (!(weapon.distanceTravelled >= 0)) return WeaponDrawKind.None;
    out.alpha = fighterWeaponAlpha(weapon.category, weapon.distanceTravelled, weapon.range);
    out.tint = 0xffffff;
    out.x = shot.x;
    out.y = shot.y;
    switch (weapon.category) {
        case ComponentCategoryType.WeaponBeam: {
            // method_156.
            const num = Math.min(300.0, 10.0 * Math.sqrt(weapon.rawDamage));
            const along = num / f;
            let across = along;
            const d = Math.hypot(firer.xpos - shot.x, firer.ypos - shot.y) / f;
            if (d < num) across /= num / d;
            out.kind = WeaponDrawKind.Bolt;
            out.art = WeaponArt.Beam;
            out.artIndex = artIndex(weaponImageIndex, BEAM_IMAGE_COUNT);
            out.rotation = shot.heading;
            out.alongPx = along;
            out.across = across;
            return out.kind;
        }
        case ComponentCategoryType.WeaponTorpedo: {
            let num10 = weapon.type !== ComponentType.WeaponMissile ? Math.fround(weapon.power / 4.0) + 7 : Math.fround(weapon.power / 0.6) + 5;
            num10 = Math.min(num10, 18);
            let num11 = num10 / f;
            if (num11 < 1) num11 = 1;
            let spin = 0.0;
            let fixed = -1000.0;
            if (weapon.type === ComponentType.WeaponTorpedo) spin = Math.PI;
            else if (weapon.type === ComponentType.WeaponMissile) fixed = shot.heading;
            out.kind = WeaponDrawKind.Projectile;
            out.art = WeaponArt.Torpedo;
            // texture2D_1[num6]: num6 stays -1 for any other torpedo-category type (the C# would throw); use 0.
            out.artIndex = artIndex(weaponImageIndex, TORPEDO_IMAGE_COUNT);
            out.rotation = fixed > -1000.0 ? fixed : ((nowMs - weapon.lastFired) / 1000) * spin;
            // num12 = num11 / texture.Width: the square art is drawn num11 px wide.
            out.alongPx = num11;
            out.across = num11;
            return out.kind;
        }
        default:
            return WeaponDrawKind.None;
    }
}

function argb(a: number, r: number, g: number, b: number): number {
    return (((a & 0xff) << 24) | ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)) >>> 0;
}

/**
 * Damage.ts / BuiltObject.1.cs 14 DoExplosions: the explosion's current image `nowMs` after it started — progression
 * runs at 60 per second against a length of clamp(size / 2, 50, 100); the image is min(19, progression / length × 20).
 * The sim stores the same value in ExplosionCurrentImage each tick; the renderer recomputes it per frame so the
 * sprite sheet animates at the display rate. Returns -1 once the explosion has run its course.
 */
export function explosionImageAt(explosionStartMs: number, explosionSize: number, nowMs: number): number {
    const progression = Math.fround(Math.max(0.0, ((nowMs - explosionStartMs) / 1000) * 60.0));
    const num2 = Math.min(100.0, Math.max(50.0, Math.trunc(explosionSize / 2)));
    if (progression > num2) return -1;
    return Math.min(EXPLOSION_IMAGE_COUNT - 1, Math.trunc((progression / num2) * EXPLOSION_IMAGE_COUNT));
}

/**
 * MainView.2.cs 2789 method_185 / 2687 method_180: the explosion's rectangle in world units. The C# offsets the
 * top-left by ExplosionSize / 2 world units (int division) but sizes it ExplosionSize / zoomFactor screen px, where
 * zoomFactor is the ship (or planet / moon) zoom factor — so above 3× zoom-out the square grows right / down from the
 * object instead of staying centred. Returned as {left, top, size} in world units.
 */
export function explosionWorldRect(
    x: number, y: number, e: Pick<Explosion, 'explosionSize' | 'explosionOffsetX' | 'explosionOffsetY'>, f: number, zoomFactor: number,
    out: { left: number; top: number; size: number },
): { left: number; top: number; size: number } {
    const half = Math.trunc(e.explosionSize / 2);
    out.left = Math.trunc(x + e.explosionOffsetX) - half;
    out.top = Math.trunc(y + e.explosionOffsetY) - half;
    out.size = Math.trunc(e.explosionSize / zoomFactor) * f;
    return out;
}

/** MainView.1.cs 1215-1231: a shield strike shows for 200 ms after LastShieldStrike. */
export function shieldStrikeVisible(lastShieldStrike: number, nowMs: number): boolean {
    return lastShieldStrike > MIN_TIME && nowMs - lastShieldStrike < 200.0 && nowMs - lastShieldStrike >= 0;
}

/** MainView.1.cs 1233-1249: a tractor strike shows for 2 s after LastTractorStrike. */
export function tractorStrikeVisible(lastTractorStrike: number, nowMs: number): boolean {
    return lastTractorStrike > MIN_TIME && nowMs - lastTractorStrike < 2000.0 && nowMs - lastTractorStrike >= 0;
}

/**
 * MainView.1.cs 3062 method_97 placement: the hyper animation is sqrt(Size × 30) world units square, centred
 * (size × 0.7) / 2 behind the ship along TargetHeading (method_96), turned to TargetHeading.
 */
export function hyperAnimationPlacement(size: number, targetHeading: number, out: { dx: number; dy: number; size: number }): { dx: number; dy: number; size: number } {
    const num2 = Math.trunc(Math.sqrt(size * 30));
    const r = Math.trunc(num2 * 0.7) / 2.0;
    const a = targetHeading + Math.PI;
    out.dx = Math.cos(a) * r;
    out.dy = Math.sin(a) * r;
    out.size = num2;
    return out;
}

/** MainView.1.cs 3064: the hyper-enter animation starts once the countdown is under 800 ms (0 < left < 800). */
export function hyperEnterDue(hyperjumpCountdown: number, starDate: number, hyperEnterStartAnimation: boolean, canHyperJump: boolean): boolean {
    const num = hyperjumpCountdown - starDate;
    return num > 0 && hyperEnterStartAnimation && num < 800 && canHyperJump;
}

/** World-space view bounds (with the cull margin) for circle tests. */
export interface ViewBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export function viewBounds(cam: Pick<Camera, 'x' | 'y' | 'width' | 'height' | 'zoom'>, marginPx: number, out: ViewBounds): ViewBounds {
    const hw = (cam.width / 2 + marginPx) / cam.zoom;
    const hh = (cam.height / 2 + marginPx) / cam.zoom;
    out.left = cam.x - hw;
    out.right = cam.x + hw;
    out.top = cam.y - hh;
    out.bottom = cam.y + hh;
    return out;
}

/** Whether a circle (world units) touches the view bounds. */
export function circleInView(b: ViewBounds, x: number, y: number, r: number): boolean {
    return x + r >= b.left && x - r <= b.right && y + r >= b.top && y - r <= b.bottom;
}

/** Whether the segment's bounding box touches the view bounds. */
export function segmentInView(b: ViewBounds, x1: number, y1: number, x2: number, y2: number, pad: number): boolean {
    return Math.max(x1, x2) + pad >= b.left && Math.min(x1, x2) - pad <= b.right && Math.max(y1, y2) + pad >= b.top && Math.min(y1, y2) - pad <= b.bottom;
}

/** Tiny render-local LCG for visual-only variation (see the header: never the sim's Random). */
export class VisualRandom {
    private s: number;
    constructor(seed = 0x2545f491) {
        this.s = seed >>> 0;
    }
    /** [0, 1). */
    nextDouble(): number {
        this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0;
        return this.s / 4294967296;
    }
    /** [min, max). */
    next(min: number, max: number): number {
        return min + Math.floor(this.nextDouble() * (max - min));
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------------------------------------------

interface StrikeRecord {
    time: number;
    direction: number;
}

interface HyperState {
    /** HyperjumpCountdown an enter animation was started for. */
    enteredCountdown: number;
    /** Last seen HyperExitStartAnimation (rising edge = a new exit). */
    exitFlag: boolean;
    /** An exit animation has been started while HyperjumpJustExited stays set. */
    exitLatched: boolean;
}

export class EffectsLayer {
    readonly root = new Container();
    private lines = new Graphics();
    private sprites: SpritePool;
    private animations = new AnimationPlayer(512);
    private rng = new VisualRandom();

    private torpedo: (Texture | null)[] = [];
    private beam: (Texture | null)[] = [];
    private area: (Texture | null)[] = [];
    private assaultPod: Texture | null = null;
    private shieldStrike: Texture | null = null;
    /** Render interpolation between sim steps (renderInterp.ts; from BuiltObjectLayer.motion): strikes, damage
     * explosions and shot origins follow the drawn ship / fighter / planet, shots in flight are lerped between steps
     * (sampleShot) and stretched beams end on the drawn target. Null: the sim positions. */
    motion: MotionInterpolator | null = null;
    /** Scratch drawn positions (drawnAt: firer / explosion site; the beam target). */
    private drawnScratch = { xpos: 0, ypos: 0 };
    private targetScratch = { xpos: 0, ypos: 0 };
    private blackholeDisc: Texture | null = null;
    private blackholeDiscRequested = false;
    /** Zoom factor of the current frame (px → world units). */
    private f = 1;
    private explosionSets: FrameSet[];
    private planetDestroy: FrameSet;
    private hyperEnter: FrameSet[];
    private hyperExit: FrameSet[];
    private construction: FrameSet;
    private tractorStrike: FrameSet;
    private blackholeVortex: FrameSet;

    /** Renderer-side strike records (the C# renderer writes these onto the BuiltObject). */
    private phaserShieldStrikes = new WeakMap<BuiltObject, StrikeRecord>();
    private tractorStrikes = new WeakMap<BuiltObject, StrikeRecord>();
    /** Per-shot "already spawned" guards keyed on the weapon's LastFired. */
    private shotHandled = new WeakMap<Weapon, number>();
    private hyper = new WeakMap<BuiltObject, HyperState>();
    /** Ships whose hyper state still holds a flag that checkHyper must reset once their flags clear. */
    private hyperDirty = new Set<BuiltObject>();
    /** Ships with a renderer-side strike record that may still be visible (phaser / tractor; beamHit). */
    private strikeBos = new Set<BuiltObject>();
    // Perf (late games: 10k built objects): every input of the per-ship effects work below except the renderer's own
    // strike / hyper records is sim state, which changes only when a sim step lands. So the built objects that have
    // something to do are collected once per step (refreshCandidates) and each frame visits only those, in galaxy
    // order; the rest would have been no-ops.
    private systemScratch: number[] = [];
    private fxBuiltObjects: BuiltObject[] = [];
    private fxBuiltObjectSet = new Set<BuiltObject>();
    private fighterCarriers: BuiltObject[] = [];
    private candSerial = -1;
    private candSource: readonly unknown[] | null = null;
    private candLength = -1;
    private candFrames = 0;

    private cmd = newWeaponDraw();
    private bounds: ViewBounds = { left: 0, top: 0, right: 0, bottom: 0 };
    private rect = { left: 0, top: 0, size: 0 };
    private place = { dx: 0, dy: 0, size: 0 };
    private linesDirty = false;
    private readonly inViewFn = (x: number, y: number, r: number): boolean => circleInView(this.bounds, x, y, r);

    constructor(
        private galaxy: Galaxy,
        world: Container,
        private store: AssetStore,
        /** Drawn size in px of a ship at the last builtObjectLayer update (0 = not drawn). */
        private shipSizePx: (bo: BuiltObject) => number,
    ) {
        world.addChild(this.root);
        this.root.addChild(this.lines);
        const spriteRoot = new Container();
        this.root.addChild(spriteRoot);
        this.sprites = new SpritePool(spriteRoot);

        const W = `${IMG}/effects/weapons`;
        this.loadInto(this.torpedo, TORPEDO_IMAGE_COUNT, (i) => `${W}/torpedo_${i}.png`);
        this.loadInto(this.beam, BEAM_IMAGE_COUNT, (i) => `${W}/beam_${i}.png`);
        this.loadInto(this.area, AREA_IMAGE_COUNT, (i) => `${W}/area_${i}.png`);
        this.loadOne(`${W}/assaultpod_0.png`, (t) => (this.assaultPod = t));
        this.loadOne(`${IMG}/effects/other/shieldstrike.png`, (t) => (this.shieldStrike = t));

        this.explosionSets = EXPLOSION_SET_DIRS.map((_, s) => new FrameSet(store, Array.from({ length: EXPLOSION_IMAGE_COUNT }, (_u, i) => explosionFrameUrl(s, i))));
        this.planetDestroy = new FrameSet(
            store,
            Array.from({ length: EXPLOSION_HABITAT_IMAGE_COUNT }, (_u, i) => `${IMG}/effects/planetdestroy/ExplPlanet04${String(i + 1).padStart(4, '0')}.png`),
        );
        this.hyperEnter = HYPER_ENTER_FRAME_COUNTS.map((n, k) => new FrameSet(store, Array.from({ length: n }, (_u, i) => `${IMG}/effects/hyperenter/${k}/frame_${i}.png`)));
        this.hyperExit = HYPER_EXIT_FRAME_COUNTS.map((n, k) => new FrameSet(store, Array.from({ length: n }, (_u, i) => `${IMG}/effects/hyperexit/${k}/frame_${i}.png`)));
        this.construction = new FrameSet(store, Array.from({ length: CONSTRUCTION_FRAME_COUNT }, (_u, i) => `${IMG}/effects/construction/Frame_${String(i + 1).padStart(3, '0')}.png`));
        this.tractorStrike = new FrameSet(store, Array.from({ length: TRACTOR_STRIKE_FRAME_COUNT }, (_u, i) => `${IMG}/effects/tractorbeamstrike/${String(i + 1).padStart(2, '0')}.PNG`));
        this.blackholeVortex = new FrameSet(store, Array.from({ length: BLACKHOLE_FRAME_COUNT }, (_u, i) => `${IMG}/environment/stars/blackhole/BlkHole-${String(i + 1).padStart(4, '0')}.png`));
    }

    private loadInto(arr: (Texture | null)[], n: number, url: (i: number) => string): void {
        for (let i = 0; i < n; i++) {
            arr.push(null);
            this.loadOne(url(i), (t) => (arr[i] = t));
        }
    }

    /** Load one piece of art; a missing file leaves the slot null (the drawers skip it). */
    private loadOne(url: string, set: (t: Texture) => void): void {
        void this.store.loadFirst([url], () => Texture.EMPTY).then((t) => {
            if (t !== Texture.EMPTY) set(t);
        });
    }

    /** Per-frame update. */
    update(z: number, cam: Camera): void {
        const f = 1 / z;
        this.f = f;
        this.root.visible = f < BUILT_OBJECT_MAX_FACTOR;
        this.sprites.begin();
        if (this.linesDirty) {
            this.lines.clear();
            this.linesDirty = false;
        }
        if (!this.root.visible) {
            this.sprites.end();
            return;
        }
        const nowMs = this.galaxy.nowMs;
        const starDate = galaxyStarDate(this.galaxy);
        viewBounds(cam, CULL_MARGIN_PX, this.bounds);
        const sz = shipZoomFactor(f);

        // Fog of war (fog.ts): everything drawn inside the ship / fighter / habitat draw blocks of MainView.1.cs is skipped
        // for objects the player cannot see (the checks are made lazily, only for objects with something to draw).
        const fog = fogOf(this.galaxy);

        this.refreshCandidates(nowMs, starDate);

        // Habitats: giant ion cannons (method_169), bombardment explosions (method_180), planet destruction (method_187).
        // Perf: only the habitats of systems near the view (habitatIndex.ts; same order): everything a habitat draws here
        // is culled on screen within its explosion reach (4 diameters + 800) or its ion cannon's range of it.
        const hix = habitatSystemIndex(this.galaxy);
        if (hix.ordered) {
            const b = this.bounds;
            const margin = 800 + 1.5 * hix.giantIonCannonRange + 1000;
            const systems = hix.visible((b.left + b.right) / 2, (b.top + b.bottom) / 2, (b.right - b.left) / 2, (b.bottom - b.top) / 2, 4, margin, this.systemScratch);
            for (let si = 0; si < systems.length; si++) {
                const habs = hix.bySystem[systems[si]];
                for (let hi = 0; hi < habs.length; hi++) this.habitatEffects(habs[hi], f, nowMs, fog);
            }
        } else {
            for (const h of this.galaxy.habitats) this.habitatEffects(h, f, nowMs, fog);
        }

        // Built objects, in the C#'s per-ship order: hyper animations (method_97), explosions (method_183), weapons
        // (method_167); shield / tractor strike overlays are part of the ship draw (MainView.1.cs 1215-1250).
        for (const bo of this.fxBuiltObjects) {
            if (bo === null) continue;
            const explosions = bo.explosions as Explosion[];
            if (!bo.hasBeenDestroyed) {
                this.drawStrikes(bo, nowMs);
                this.checkHyper(bo, starDate, nowMs);
            }
            const weapons = bo.weapons;
            let firing = false;
            if (weapons !== null && !bo.hasBeenDestroyed) {
                for (let i = 0; i < weapons.length; i++) {
                    const w = weapons[i];
                    if (w != null && w.distanceTravelled >= 0) {
                        firing = true;
                        break;
                    }
                }
            }
            if ((explosions.length > 0 || firing) && !fog.builtObject(bo)) continue;
            if (explosions.length > 0) {
                // A live ship's explosions follow its drawn position; a destroyed one's stay where it died.
                const at = bo.hasBeenDestroyed ? bo : this.drawnAt(bo);
                const ex = at.xpos;
                const ey = at.ypos;
                if (circleInView(this.bounds, ex, ey, bo.size + 400)) {
                    for (let i = 0; i < explosions.length; i++) this.drawExplosion(ex, ey, explosions[i], f, sz, nowMs);
                }
            }
            if (firing && weapons !== null) {
                for (let i = 0; i < weapons.length; i++) {
                    const w = weapons[i];
                    if (w != null && w.distanceTravelled >= 0) this.drawWeapon(w, bo, f, nowMs);
                }
            }
        }

        // Renderer-side strikes on ships that are not candidates this step (marked by a beam since the last step): their
        // overlay, drawn after the candidates' effects.
        if (this.strikeBos.size > 0) {
            for (const bo of this.strikeBos) {
                if (!bo.hasBeenDestroyed && !this.fxBuiltObjectSet.has(bo)) this.drawStrikes(bo, nowMs);
            }
        }

        // Fighters (MainView.1.cs 1422-1556, after every ship): shield strike, explosions (method_184), weapons
        // (method_165) of each launched fighter near the view.
        for (const bo of this.fighterCarriers) {
            if (bo === null) continue;
            const fighters = fightersOf(bo);
            if (fighters === null) continue;
            for (let i = 0; i < fighters.length; i++) {
                const fighter = fighters[i];
                if (fighter == null || fighter.onboardCarrier) continue;
                this.drawFighterEffects(fighter, f, sz, nowMs);
            }
        }

        this.animations.draw(nowMs, this.sprites, this.inViewFn);
        this.sprites.end();
    }

    /** One habitat's effects (the habitat pass of update). */
    private habitatEffects(h: Habitat | null, f: number, nowMs: number, fog: ReturnType<typeof fogOf>): void {
        if (h === null) return;
        const hasFx = (h.giantIonCannonPresent && h.giantIonCannon !== null && h.giantIonCannon.distanceTravelled >= 0) || (h.explosions !== null && h.explosions.length > 0) || h.explosion !== null;
        if (!hasFx || !fog.habitatDrawn(h)) return;
        if (h.giantIonCannonPresent && h.giantIonCannon !== null && h.giantIonCannon.distanceTravelled >= 0) {
            this.drawWeapon(h.giantIonCannon, h, f, nowMs);
        }
        const hasExplosions = h.explosions !== null && h.explosions.length > 0;
        if (!hasExplosions && h.explosion === null) return;
        if (!circleInView(this.bounds, h.xpos, h.ypos, h.diameter * 4 + 800)) return;
        const hz = h.category === HabitatCategoryType.Planet ? planetZoomFactor(f) : h.category === HabitatCategoryType.Moon ? moonZoomFactor(f) : f;
        if (hasExplosions) {
            // Bombardment explosions sit on the drawn (render-interpolated orbit) planet.
            const at = this.drawnAt(h);
            const hx = at.xpos;
            const hy = at.ypos;
            for (const e of h.explosions as Explosion[]) this.drawExplosion(hx, hy, e, f, hz, nowMs);
        }
        if (h.explosion !== null) this.drawPlanetExplosion(h, h.explosion as Explosion, f, hz);
    }

    /**
     * Whether checkHyper would do anything for `bo` until its sim flags change: an enter animation due, a fresh exit, a
     * new / changed / latched exit flag, or a recorded flag to reset. Half the ships of a late game keep
     * HyperExitStartAnimation set long after their exit (it is cleared when a mission is assigned) with the exit
     * already recorded — checkHyper is a no-op for them, every frame.
     */
    private hyperPending(bo: BuiltObject, starDate: number): boolean {
        if (bo.hyperjumpJustExited || hyperEnterDue(bo.hyperjumpCountdown, starDate, bo.hyperEnterStartAnimation, bo.canHyperJump)) return true;
        if (bo.hyperExitStartAnimation) {
            const st = this.hyper.get(bo);
            return st === undefined || !st.exitFlag || st.exitLatched;
        }
        return this.hyperDirty.has(bo);
    }

    /** Re-collect the per-step candidate lists when a sim step landed, the arrays changed, or every 8 frames. */
    private refreshCandidates(nowMs: number, starDate: number): void {
        const g = this.galaxy;
        const serial = this.motion?.serial ?? -1;
        this.candFrames++;
        if (
            this.motion !== null &&
            serial === this.candSerial &&
            g.builtObjects === this.candSource &&
            g.builtObjects.length === this.candLength &&
            this.candFrames < 8
        ) {
            return;
        }
        this.candSerial = serial;
        this.candSource = g.builtObjects;
        this.candLength = g.builtObjects.length;
        this.candFrames = 0;
        // Strike records that can no longer show are dropped (shield strikes show 200 ms, tractor strikes 2 s).
        for (const bo of this.strikeBos) {
            const own = this.phaserShieldStrikes.get(bo);
            const tr = this.tractorStrikes.get(bo);
            if (bo.hasBeenDestroyed || ((own === undefined || !(nowMs - own.time < 200.0)) && (tr === undefined || !tractorStrikeVisible(tr.time, nowMs)))) this.strikeBos.delete(bo);
        }
        const bos = this.fxBuiltObjects;
        const set = this.fxBuiltObjectSet;
        const carriers = this.fighterCarriers;
        bos.length = 0;
        set.clear();
        carriers.length = 0;
        for (const bo of g.builtObjects) {
            if (bo === null) continue;
            let need = (bo.explosions as Explosion[]).length > 0;
            if (!need && !bo.hasBeenDestroyed) {
                need = shieldStrikeVisible(bo.lastShieldStrike, nowMs) || this.hyperPending(bo, starDate) || this.strikeBos.has(bo);
                const weapons = bo.weapons;
                if (!need && weapons !== null) {
                    for (let i = 0; i < weapons.length; i++) {
                        const w = weapons[i];
                        if (w != null && w.distanceTravelled >= 0) {
                            need = true;
                            break;
                        }
                    }
                }
            }
            if (need) {
                bos.push(bo);
                set.add(bo);
            }
            const fighters = fightersOf(bo);
            if (fighters !== null) {
                for (let i = 0; i < fighters.length; i++) {
                    const fighter = fighters[i];
                    if (fighter != null && !fighter.onboardCarrier) {
                        carriers.push(bo);
                        break;
                    }
                }
            }
        }
    }

    /** Where `o` is drawn this frame (MotionInterpolator.positionOf: its sample, a habitat's interpolated orbit, else
     * its sim position; written to `into`, a scratch read before the next call), or `o` itself without interpolation. */
    private drawnAt(o: Positioned, into: Positioned = this.drawnScratch): Positioned {
        if (this.motion === null) return o;
        const p = this.motion.positionOf(o);
        into.xpos = p.x;
        into.ypos = p.y;
        return into;
    }

    private drawWeapon(weapon: Weapon, firer: BuiltObject | Habitat, f: number, nowMs: number): void {
        const c = this.cmd;
        const m = this.motion;
        // The shot lerped between steps (snaps on spawn / impact); a stretched beam's far end on the drawn target.
        // Extrapolated past the firer's last touch (the shot only moves when its firer is ticked): habitats are touched once
        // per habitat round-robin, ships once per built-object round-robin.
        const shot =
            m !== null
                ? sampleShot(m, weapon, firer.lastTouch, shotFlightSpeed(weapon.component.type, weapon.speed, weapon.distanceTravelled, weapon.resetNext), firer instanceof Habitat ? m.habitatUntouchedMaxMs : m.untouchedMaxMs)
                : weapon;
        const t = weapon.target;
        const targetAt = m !== null && hasPosition(t) ? this.drawnAt(t, this.targetScratch) : null;
        const kind = weaponDrawCommand(weapon, this.drawnAt(firer), f, nowMs, c, shot, targetAt);
        if (kind === WeaponDrawKind.None) return;
        switch (kind) {
            case WeaponDrawKind.Intercepted: {
                // MainView.2.cs 1524-1531: explosion set Rnd(0, 20), 20 fps, Rnd(10, 16) square. Once per shot.
                if (this.shotHandled.get(weapon) === weapon.lastFired) return;
                this.shotHandled.set(weapon, weapon.lastFired);
                if (!circleInView(this.bounds, c.x, c.y, 16)) return;
                const set = this.rng.next(0, EXPLOSION_SET_DIRS.length);
                const s = this.rng.next(10, 16);
                this.animations.add(this.explosionSets[set], nowMs, 20, c.x, c.y, s, s, 0);
                return;
            }
            case WeaponDrawKind.Projectile:
            case WeaponDrawKind.Bolt:
                this.drawSpriteCommand(c);
                return;
            case WeaponDrawKind.Stretched: {
                const tex = this.beam[c.artIndex];
                if (tex == null) return;
                const len = c.alongPx * f;
                const ex = c.x + Math.cos(c.rotation) * len;
                const ey = c.y + Math.sin(c.rotation) * len;
                const thick = tex.width * c.across * f; // the art's (load-rotated) height at 1 / zoom, in world units
                if (!segmentInView(this.bounds, c.x, c.y, ex, ey, thick)) {
                    this.beamHit(weapon, nowMs);
                    return;
                }
                const s = this.sprites.acquire(tex);
                // Origin at the firer, the art's (rotated) left-edge middle = the raw PNG's bottom-middle.
                s.anchor.set(0.5, 1);
                s.position.set(c.x, c.y);
                s.scale.set(thick / (tex.width || 1), len / (tex.height || 1));
                s.rotation = c.rotation + ROT90;
                s.alpha = c.alpha;
                this.beamHit(weapon, nowMs);
                return;
            }
            case WeaponDrawKind.Area: {
                const tex = this.area[c.artIndex];
                const d = c.alongPx * f;
                if (!circleInView(this.bounds, c.x, c.y, d / 2)) return;
                this.drawLine(c);
                if (tex == null) return;
                const s = this.sprites.acquire(tex);
                placeSprite(s, c.x, c.y, d, d, 0);
                s.alpha = c.alpha;
                return;
            }
            case WeaponDrawKind.AreaGravity: {
                const r = Math.max(c.discPx, c.vortexPx) * f;
                if (!circleInView(this.bounds, c.x, c.y, r)) return;
                this.drawLine(c);
                if (!this.blackholeDiscRequested) {
                    this.blackholeDiscRequested = true;
                    this.loadOne(`${IMG}/environment/stars/star_blackhole_0.png`, (t) => (this.blackholeDisc = t));
                }
                const disc = this.blackholeDisc;
                if (disc !== null && c.discPx > 0) {
                    const s = this.sprites.acquire(disc);
                    placeSprite(s, c.x, c.y, c.discPx * f, c.discPx * f, c.discRotation);
                    s.tint = c.discColor & 0xffffff;
                    s.alpha = ((c.discColor >>> 24) & 0xff) / 255;
                }
                if (c.vortexPx > 0) {
                    const tex = this.blackholeVortex.frame(loopFrameIndex(nowMs, this.blackholeVortex.length, 25));
                    if (tex !== null) {
                        const s = this.sprites.acquire(tex);
                        placeSprite(s, c.x, c.y, c.vortexPx * f, c.vortexPx * f, 0);
                        s.alpha = c.vortexAlpha;
                    }
                }
                return;
            }
        }
    }

    private drawFighterEffects(fighter: Fighter, f: number, sz: number, nowMs: number): void {
        const explosions = fighter.explosions;
        const weapons = fighter.weapons;
        const hasShots = weapons.length > 0 && weapons.some((w) => w.distanceTravelled >= 0);
        if (explosions.length === 0 && !hasShots && !shieldStrikeVisible(fighter.lastShieldStrike, nowMs)) return;
        // The weapons' range reaches past the fighter; cull on the fighter plus its longest shot.
        let reach = 400;
        for (let i = 0; i < weapons.length; i++) reach = Math.max(reach, weapons[i].range * 1.2);
        const at = fighter.hasBeenDestroyed ? fighter : this.drawnAt(fighter);
        const fx = at.xpos;
        const fy = at.ypos;
        if (!circleInView(this.bounds, fx, fy, reach)) return;
        if (!fogOf(this.galaxy).fighter(fighter)) return; // MainView.1.cs 1337: an unseen fighter has no effects either
        if (!fighter.hasBeenDestroyed && shieldStrikeVisible(fighter.lastShieldStrike, nowMs) && this.shieldStrike !== null) {
            // MainView.1.cs 1522-1536: the shield-strike art at the fighter's drawn size, turned to direction - 90°.
            const px = fighterDrawnSizePx(fighter);
            if (px > 0) {
                const w = px * f;
                const s = this.sprites.acquire(this.shieldStrike);
                placeSprite(s, fx, fy, w, w, fighter.lastShieldStrikeDirection - Math.PI / 2);
            }
        }
        for (let i = 0; i < explosions.length; i++) this.drawExplosion(fx, fy, explosions[i], f, sz, nowMs);
        if (!hasShots) return;
        const imageIndex = fighter.specification.weaponImageIndex;
        for (let i = 0; i < weapons.length; i++) {
            const w = weapons[i];
            if (!(w.distanceTravelled >= 0)) continue;
            const shot = this.motion !== null ? sampleShot(this.motion, w, fighter.lastTouch, fighterShotFlightSpeed(w.category, w.speed, w.distanceTravelled, w.resetNext)) : w;
            if (fighterWeaponDrawCommand(w, at, imageIndex, f, nowMs, this.cmd, shot) !== WeaponDrawKind.None) this.drawSpriteCommand(this.cmd);
        }
    }

    /** Draw a Projectile or Bolt command (shared by ship, habitat and fighter weapons). */
    private drawSpriteCommand(c: WeaponDraw): void {
        const f = this.f;
        if (c.kind === WeaponDrawKind.Projectile) {
            const tex = this.torpedo[c.artIndex];
            const sizeW = c.alongPx * f;
            if (tex == null || !circleInView(this.bounds, c.x, c.y, sizeW)) return;
            const s = this.sprites.acquire(tex);
            placeSprite(s, c.x, c.y, sizeW, sizeW, c.rotation + ROT90);
            s.alpha = c.alpha;
        } else if (c.kind === WeaponDrawKind.Bolt) {
            const tex = c.art === WeaponArt.AssaultPod ? this.assaultPod : this.beam[c.artIndex];
            const along = c.alongPx * f;
            if (tex == null || c.across <= 0 || !circleInView(this.bounds, c.x, c.y, along)) return;
            const s = this.sprites.acquire(tex);
            // Raw art is vertical: its height runs along the heading once turned by heading + 90°.
            placeSprite(s, c.x, c.y, c.across * f, along, c.rotation + ROT90);
            s.alpha = c.alpha;
        }
    }

    /**
     * MainView.2.cs 1363-1372 / 1864-1882: a tractor beam or phaser that will hit a ship marks a strike on it; a phaser
     * hitting a ship whose shields are down (<= 5) adds the hull-hit spark instead. The C# checks DistanceTravelled <= 3
     * each frame (the shot's first sim ticks) and writes the ship; here it is done once per shot (keyed on LastFired),
     * so a frame that misses the first ticks at high game speed still shows it.
     */
    private beamHit(weapon: Weapon, nowMs: number): void {
        const type = weapon.component.type;
        if (type !== ComponentType.WeaponPhaser && type !== ComponentType.WeaponSuperPhaser && type !== ComponentType.WeaponTractorBeam) return;
        const target = weapon.target;
        if (!weapon.willHitTarget || !(target instanceof BuiltObject)) return;
        if (this.shotHandled.get(weapon) === weapon.lastFired) return;
        this.shotHandled.set(weapon, weapon.lastFired);
        if (type === ComponentType.WeaponTractorBeam) {
            setStrike(this.tractorStrikes, target, nowMs, weapon.heading);
            this.strikeBos.add(target);
            return;
        }
        if (target.currentShields <= 5) {
            const val2 = Math.min(35, Math.trunc(Math.sqrt(weapon.power) * 10.0));
            const rotation = this.rng.nextDouble() * Math.PI * 2.0;
            // Animation(texture2D_33 = construction frames, 100 fps, rotation); AnimationSystem draws it at -rotation
            // on the load-rotated frames.
            this.animations.add(this.construction, nowMs, 100, target.xpos, target.ypos, val2, val2, -rotation + ROT90);
        } else {
            setStrike(this.phaserShieldStrikes, target, nowMs, weapon.heading);
            this.strikeBos.add(target);
        }
    }

    private drawLine(c: WeaponDraw): void {
        if (c.lineWidth <= 0) return;
        const a = ((c.lineColor >>> 24) & 0xff) / 255;
        if (a <= 0 || (c.lineFromX === c.x && c.lineFromY === c.y)) return;
        this.lines.moveTo(c.lineFromX, c.lineFromY).lineTo(c.x, c.y).stroke({ width: c.lineWidth * this.f, color: c.lineColor & 0xffffff, alpha: a });
        this.linesDirty = true;
    }

    private drawExplosion(x: number, y: number, e: Explosion, f: number, zoomFactor: number, nowMs: number): void {
        if (e.explosionSize <= 0) return;
        const img = explosionImageAt(e.explosionStart, e.explosionSize, nowMs);
        if (img < 0) return;
        const r = explosionWorldRect(x, y, e, f, zoomFactor, this.rect);
        if (r.size <= 0 || !circleInView(this.bounds, r.left + r.size / 2, r.top + r.size / 2, r.size)) return;
        const set = this.explosionSets[e.explosionImageIndex] ?? this.explosionSets[0];
        const tex = set.frame(img);
        if (tex === null) return;
        const s = this.sprites.acquire(tex);
        s.anchor.set(0, 0);
        s.position.set(r.left, r.top);
        s.scale.set(r.size / (tex.width || 1), r.size / (tex.height || 1));
    }

    private drawPlanetExplosion(h: Habitat, e: Explosion, f: number, zoomFactor: number): void {
        if (e.explosionSize <= 0) return;
        const r = explosionWorldRect(h.xpos, h.ypos, e, f, zoomFactor, this.rect);
        if (r.size <= 0 || !circleInView(this.bounds, r.left + r.size / 2, r.top + r.size / 2, r.size)) return;
        // Diameter > 50: the planetdestroy sheet; otherwise explosion set 0 (method_187).
        const tex = h.diameter > 50 ? this.planetDestroy.frame(e.explosionCurrentImage) : this.explosionSets[0].frame(e.explosionCurrentImage);
        if (tex === null) return;
        const s = this.sprites.acquire(tex);
        s.anchor.set(0, 0);
        s.position.set(r.left, r.top);
        s.scale.set(r.size / (tex.width || 1), r.size / (tex.height || 1));
    }

    /** Shield-strike (200 ms) and tractor-strike (2 s, looping at 10 fps) overlays at the ship's drawn size. */
    private drawStrikes(bo: BuiltObject, nowMs: number): void {
        let when = bo.lastShieldStrike;
        let dir = bo.lastShieldStrikeDirection;
        const own = this.phaserShieldStrikes.get(bo);
        if (own !== undefined && own.time > when) {
            when = own.time;
            dir = own.direction;
        }
        const tractor = this.tractorStrikes.get(bo);
        const shield = shieldStrikeVisible(when, nowMs) && this.shieldStrike !== null;
        const pull = tractor !== undefined && tractorStrikeVisible(tractor.time, nowMs);
        if (!shield && !pull) return;
        const px = this.shipSizePx(bo);
        if (px <= 0) return;
        const w = px * this.f;
        const at = this.drawnAt(bo);
        const bx = at.xpos;
        const by = at.ypos;
        if (!circleInView(this.bounds, bx, by, w)) return;
        if (shield) {
            const s = this.sprites.acquire(this.shieldStrike!);
            placeSprite(s, bx, by, w, w, dir - Math.PI / 2);
        }
        if (pull) {
            const tex = this.tractorStrike.frame(loopFrameIndex(nowMs, TRACTOR_STRIKE_FRAME_COUNT, 10));
            if (tex !== null) {
                const s = this.sprites.acquire(tex);
                // Load-rotated frames drawn at (direction - 90°).
                placeSprite(s, bx, by, w, w, tractor!.direction - Math.PI / 2 + ROT90);
            }
        }
    }

    /** MainView.1.cs 3062 method_97: start the hyper enter / exit animations (30 fps) for ships on screen. */
    private checkHyper(bo: BuiltObject, starDate: number, nowMs: number): void {
        const enterDue = hyperEnterDue(bo.hyperjumpCountdown, starDate, bo.hyperEnterStartAnimation, bo.canHyperJump);
        const exitFlag = bo.hyperExitStartAnimation;
        let st = this.hyper.get(bo);
        if (!enterDue && !exitFlag && !bo.hyperjumpJustExited) {
            if (st !== undefined) {
                st.exitFlag = false;
                st.exitLatched = false;
                this.hyperDirty.delete(bo);
            }
            return;
        }
        // (An unseen ship has no drawn size; its jump flash is not drawn either — fog.ts.)
        const onScreen = this.shipSizePx(bo) > 0 || (circleInView(this.bounds, bo.xpos, bo.ypos, 0) && fogOf(this.galaxy).builtObject(bo));
        if (st === undefined) {
            // First sight: a stale exit flag from an earlier jump is not a new exit.
            st = { enteredCountdown: Number.NaN, exitFlag: exitFlag && !bo.hyperjumpJustExited, exitLatched: false };
            this.hyper.set(bo, st);
        }
        const idx = bo.design?.hyperDriveIndex ?? 0;
        if (enterDue && st.enteredCountdown !== bo.hyperjumpCountdown) {
            st.enteredCountdown = bo.hyperjumpCountdown;
            if (onScreen) this.addHyper(this.hyperEnter[idx] ?? this.hyperEnter[0], bo, nowMs);
        }
        const newExit = exitFlag && ((bo.hyperjumpJustExited && !st.exitLatched) || !st.exitFlag);
        if (newExit) {
            st.exitLatched = true;
            if (onScreen) this.addHyper(this.hyperExit[idx] ?? this.hyperExit[0], bo, nowMs);
        }
        if (!bo.hyperjumpJustExited) st.exitLatched = false;
        st.exitFlag = exitFlag;
        if (st.exitFlag || st.exitLatched) this.hyperDirty.add(bo);
        else this.hyperDirty.delete(bo);
    }

    private addHyper(frames: FrameSet, bo: BuiltObject, nowMs: number): void {
        const p = hyperAnimationPlacement(bo.size, bo.targetHeading, this.place);
        // Animation(rotationAngle = -TargetHeading) drawn at -rotationAngle on the load-rotated frames.
        this.animations.add(frames, nowMs, 30, bo.xpos + p.dx, bo.ypos + p.dy, p.size, p.size, bo.targetHeading + ROT90);
    }

    /** Drop running one-shot animations (e.g. on game teardown). */
    clear(): void {
        this.animations.clear();
    }
}

function setStrike(map: WeakMap<BuiltObject, StrikeRecord>, bo: BuiltObject, time: number, direction: number): void {
    const r = map.get(bo);
    if (r === undefined) map.set(bo, { time, direction });
    else {
        r.time = time;
        r.direction = direction;
    }
}

// Planet / moon zoom factors (Main.Part11.cs CalculatePlanetZoomFactor / CalculateMoonZoomFactor), as in mainView.ts;
// repeated here so this module does not import the Main View (which imports it).
function planetZoomFactor(f: number): number {
    return f > 10.0 ? Math.max(10.0, f / 1.25) : f;
}

function moonZoomFactor(f: number): number {
    return f > 10.0 ? Math.max(10.0, f / 1.1) : f;
}

/** One effects layer per Main View world container, created on first use (so the Main View needs a single hook). */
const layers = new WeakMap<Container, EffectsLayer>();

/** Draw this frame's combat effects for the Main View whose world container is `world`. */
export function updateCombatEffects(
    galaxy: Galaxy,
    world: Container,
    store: AssetStore,
    ships: { drawnSizePx(bo: BuiltObject): number; motion?: MotionInterpolator | null },
    z: number,
    cam: Camera,
): EffectsLayer {
    let layer = layers.get(world);
    if (layer === undefined) {
        layer = new EffectsLayer(galaxy, world, store, (bo) => ships.drawnSizePx(bo));
        layers.set(world, layer);
    }
    layer.motion = ships.motion ?? null;
    layer.update(z, cam);
    return layer;
}

/** The Main View's effects layer, if it has drawn a frame (debug / capture hook). */
export function combatEffectsLayerFor(world: Container): EffectsLayer | undefined {
    return layers.get(world);
}
