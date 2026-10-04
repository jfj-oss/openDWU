// Fighter layer: the fighters and bombers carriers and bases have launched, with their engine exhaust, drawn like
// the original's XNA Main View. Render-only: reads sim state, never writes it (the C# renderer clears
// Fighter.TargetSpeedChanged / OverlayChanged / HeadingChanged and resets a bad PictureRef on the model; here those
// are render-side decisions only).
//
// Sources (DistantWorlds/):
//   Controls/MainView.1.cs 88 / 857-861   — fighters of the built objects around the view (Galaxy.5.cs 2957
//                                            GetFightersForBuiltObjects), drawn inside the ship block (zoom factor < 500)
//   Controls/MainView.1.cs 1314-1556      — per fighter: skip those aboard their carrier / off screen (±50 px), engine
//                                            exhaust while TargetSpeed > 0, then the fighter turned to Heading
//                                            (DrawFighterToMainXna, MainView.2.cs 2009); shield strike, explosions
//                                            and weapons follow (effectsLayer.ts)
//   Controls/MainView.1.cs 1956 kgxRubsAau3 + Main.Part12.cs 4628 DetermineBuiltObjectSize — the drawn size
//   Main.Part12.cs 4644 PrepareEngineExhaust(Fighter, Bitmap) — exhaust rects from the art's thruster marks
//   Main.Part13.cs 1831 LoadFighterBomboer / 1934 LoadFighters — art: images/units/ships/family<N>/fighter.png and
//                                            bomber.png, index family * 2 (+ 1 for the bomber), cropped (padding 4),
//                                            rotated 90° clockwise, thruster marks scanned and painted out.
//
// Fog of war (MainView.1.cs 1337 `GodMode || IsObjectVisibleToThisEmpire(fighter)`): fog.ts — unseen fighters are skipped.
// 19r: the damage overlay on a hurt fighter (MainView.cs 3204 method_70 → Main.Part12.cs 5002 method_107 with the
// bitmap_7 mask) — shipOverlays.ts DamageOverlays, drawn above the bodies.
// The fighter shield line at zoom factor <= 3 in battle (method_194, MainView.1.cs 1542-1547) is drawn by combatBars.ts
// from `drawnFighters`; the selection circle (method_212, MainView.1.cs 1518-1521) by mainView.ts. Picking: pick() below
// (Main.Part11.cs 1579-1600).

import { Container, Texture } from 'pixi.js';
import type { Camera } from './camera';
import type { AssetStore } from './assets';
import { SpritePool } from './fxCommon';
import { BUILT_OBJECT_DRAW_RESIZE_FACTOR, BUILT_OBJECT_MAX_FACTOR, STANDARD_FAMILY_COUNT } from './builtObjectLayer';
import { exhaustRect, type ExhaustRect } from './ambientLayer';
import { loadShipArt, shipArtIfLoaded } from './shipArt';
import { DamageOverlays, fighterDamageSubject } from './shipOverlays';
import { artBundleFlag } from './artBundleFlags';
import { fogOf } from './fog';
import type { Galaxy } from '../sim/galaxy';
import { fightersOf, type Fighter } from '../sim/combat/fighters';
import { sampleFighter, type MotionInterpolator } from './renderInterp';

const IMG = '/assets/dwu/images';
/** LoadFighters loads a fighter and a bomber per family folder (ShipImageHelper.ShipSetFighterImageCount = 2). */
export const FIGHTER_IMAGES_PER_FAMILY = 2;
export const FIGHTER_IMAGE_COUNT = STANDARD_FAMILY_COUNT * FIGHTER_IMAGES_PER_FAMILY;
/** effects/enginethrusters/<i>.png that exist in the install (bitmap_209). */
export const ENGINE_THRUSTER_IMAGE_COUNT = 6;
/** MainView.1.cs 1337: fighters are culled 50 px outside the view. */
const CULL_MARGIN_PX = 50;
/** Main.Part11.cs 1579: fighters are picked only while the zoom factor < 50. */
export const FIGHTER_PICK_MAX_FACTOR = 50.0;

// ---------------------------------------------------------------------------------------------------------------
// Pure parts (unit-tested)
// ---------------------------------------------------------------------------------------------------------------

/** URL of fighter art `pictureRef` (LoadFighters order: family<N>/fighter, family<N>/bomber), or null out of range. */
export function fighterImageUrl(pictureRef: number): string | null {
    if (!Number.isInteger(pictureRef) || pictureRef < 0 || pictureRef >= FIGHTER_IMAGE_COUNT) return null;
    const family = Math.floor(pictureRef / FIGHTER_IMAGES_PER_FAMILY);
    return `${IMG}/units/ships/family${family}/${pictureRef % FIGHTER_IMAGES_PER_FAMILY === 0 ? 'fighter' : 'bomber'}.png`;
}

/**
 * MainView.1.cs 1321-1328: a PictureRef outside the loaded art falls back to the empire's standard fighter
 * (ShipImageHelper.ResolveNewFighterImageIndex(DominantRace) = DesignsPictureFamilyIndex × 2), else 0.
 */
export function resolveFighterPictureRef(pictureRef: number, familyIndex: number | null): number {
    if (pictureRef >= 0 && pictureRef < FIGHTER_IMAGE_COUNT) return pictureRef;
    const p = familyIndex !== null ? familyIndex * FIGHTER_IMAGES_PER_FAMILY : 0;
    return p >= 0 && p < FIGHTER_IMAGE_COUNT ? p : 0;
}

/**
 * Drawn size (px, square) of a fighter at zoom factor f: kgxRubsAau3 (MainView.1.cs 1956) →
 * DetermineBuiltObjectSize(image, int_5 / 8, trunc(Size / f²)) = max(1, trunc(sqrt(W·H · target / (int_5 / 8)))).
 * W·H / int_5 is the art's crop area over its content-pixel count (`areaRatio`, as for ships). The target size is
 * an int, so a fighter drops to the 1 px minimum once f² exceeds its Size — the zoom at which fighters vanish.
 */
export function fighterSizePx(size: number, areaRatio: number, f: number): number {
    const targetSize = Math.trunc(size / (f * f));
    const d = areaRatio * BUILT_OBJECT_DRAW_RESIZE_FACTOR * targetSize;
    return Math.trunc(Math.max(1.0, Math.sqrt(d)));
}

/** Whether fighters are drawn at zoom factor f (inside the ship block, MainView.1.cs 856). */
export function fightersVisibleAt(f: number): boolean {
    return f < BUILT_OBJECT_MAX_FACTOR;
}

/**
 * PrepareEngineExhaust(Fighter) num5 (Main.Part12.cs 4652-4674): exhaust length in prepared px — num3 = 0.25 × the
 * image width, times 1 up to a quarter of top speed, 1.7 up to half, 2.5 up to top speed (0 above / when stopped);
 * truncated and rounded up to even.
 */
export function fighterExhaustLengthPx(preparedPx: number, targetSpeed: number, topSpeed: number): number {
    const num3 = Math.fround(preparedPx * Math.fround(0.25));
    let num4 = 0;
    if (targetSpeed > 0) {
        if (targetSpeed <= Math.fround(topSpeed * 0.25)) num4 = 1;
        else if (targetSpeed <= Math.fround(topSpeed * 0.5)) num4 = 1.7;
        else if (targetSpeed <= topSpeed) num4 = 2.5;
    }
    let num5 = Math.trunc(Math.fround(num4 * num3));
    if (num5 % 2 === 1) num5 += 1;
    return num5;
}

/** Engine-thruster art index of a fighter (PrepareEngineExhaust: out of range → 0). */
export function fighterExhaustIndex(engineExhaustImageIndex: number): number {
    return engineExhaustImageIndex >= 0 && engineExhaustImageIndex < ENGINE_THRUSTER_IMAGE_COUNT ? engineExhaustImageIndex : 0;
}

/** A fighter drawn this frame: its drawn (render-interpolated) centre and drawn size in px. */
export interface DrawnFighter {
    fighter: Fighter;
    x: number;
    y: number;
    px: number;
}

/**
 * Port of Main.Part11.cs 1579-1600 (method_145, zoom factor < 50): the first launched fighter (in carrier order) whose
 * drawn rect — its drawn size in world units, padded by (int)(f x 1.3) — contains the world point. The C# returns it
 * before any ship (inside the ship loop, ahead of the carrier's own hit test); unseen fighters are not drawn, so not
 * pickable (`GodMode || IsObjectVisibleToThisEmpire(fighter)`).
 */
export function pickDrawnFighter(drawn: readonly DrawnFighter[], wx: number, wy: number, f: number): Fighter | null {
    if (!(f < FIGHTER_PICK_MAX_FACTOR)) return null;
    const x = Math.trunc(wx);
    const y = Math.trunc(wy);
    const pad = Math.trunc(f * 1.3);
    for (const d of drawn) {
        if (d.fighter.onboardCarrier || d.fighter.hasBeenDestroyed) continue;
        const w = Math.trunc(d.px * f);
        const half = Math.trunc(w / 2);
        const cx = Math.trunc(d.x);
        const cy = Math.trunc(d.y);
        if (x >= cx - half - pad && x <= cx + half + pad && y >= cy - half - pad && y <= cy + half + pad) return d.fighter;
    }
    return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Drawn sizes shared with the effects layer (shield strikes are drawn at the fighter's size)
// ---------------------------------------------------------------------------------------------------------------

const drawnPx = new WeakMap<Fighter, number>();

/** Drawn size in px of a fighter at the last fighter-layer update (0 = not drawn). */
export function fighterDrawnSizePx(fighter: Fighter): number {
    return drawnPx.get(fighter) ?? 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------------------------------------------

const scratchRect: ExhaustRect = { cx: 0, cy: 0, width: 0, height: 0 };

export class FighterLayer {
    readonly root = new Container();
    private exhaust: SpritePool;
    private bodies: SpritePool;
    private damage: DamageOverlays<Fighter>;
    private damageFx = false;
    private engineTextures: (Texture | null)[] = new Array<Texture | null>(ENGINE_THRUSTER_IMAGE_COUNT).fill(null);
    private engineRequested = false;
    /** Fighters given a drawn size last frame (their entry is cleared when they stop being drawn). */
    private drawnLast = new Set<Fighter>();
    private drawnNow = new Set<Fighter>();
    /** Render interpolation between sim steps (renderInterp.ts; set by MainView). Null: draw the sim positions. */
    motion: MotionInterpolator | null = null;
    /** The fighters drawn this frame, in draw order (pooled records; battle bars, picking, the selection circle). */
    readonly drawnFighters: DrawnFighter[] = [];
    private drawnPool: DrawnFighter[] = [];

    constructor(
        private galaxy: Galaxy,
        world: Container,
        private store: AssetStore,
    ) {
        world.addChild(this.root);
        const under = new Container();
        const over = new Container();
        this.root.addChild(under, over);
        this.exhaust = new SpritePool(under);
        this.bodies = new SpritePool(over);
        this.damage = new DamageOverlays<Fighter>(this.root);
    }

    private engineTexture(i: number): Texture | null {
        if (!this.engineRequested) {
            this.engineRequested = true;
            for (let k = 0; k < ENGINE_THRUSTER_IMAGE_COUNT; k++) {
                void this.store.loadFirst([`${IMG}/effects/enginethrusters/${k}.png`], () => Texture.EMPTY).then((t) => {
                    this.engineTextures[k] = t === Texture.EMPTY ? null : t;
                });
            }
        }
        return this.engineTextures[i];
    }

    update(z: number, cam: Camera): void {
        const f = 1 / z;
        const visible = fightersVisibleAt(f) && this.store.dwuPresent;
        this.root.visible = visible;
        this.exhaust.begin();
        this.bodies.begin();
        this.damage.begin();
        this.damageFx = artBundleFlag(this.galaxy, 'damageFx');
        const now = this.drawnNow;
        now.clear();
        this.drawnFighters.length = 0;
        if (visible) {
            const halfW = cam.width / 2;
            const halfH = cam.height / 2;
            const fog = fogOf(this.galaxy);
            for (const bo of this.galaxy.builtObjects) {
                if (bo === null) continue;
                const fighters = fightersOf(bo);
                if (fighters === null || fighters.length === 0) continue;
                for (let i = 0; i < fighters.length; i++) {
                    const fighter = fighters[i];
                    if (fighter == null || fighter.onboardCarrier || fighter.hasBeenDestroyed) continue;
                    const sx = (fighter.xpos - cam.x) * z + halfW;
                    const sy = (fighter.ypos - cam.y) * z + halfH;
                    // Coarse cull before the art lookup (fighters are at most a few dozen px).
                    if (sx < -CULL_MARGIN_PX - 64 || sx > cam.width + CULL_MARGIN_PX + 64 || sy < -CULL_MARGIN_PX - 64 || sy > cam.height + CULL_MARGIN_PX + 64) continue;
                    if (!fog.fighter(fighter)) continue;
                    // Drawn position / heading: lerp between the last two sim steps, extrapolated past the carrier's last touch
                    // (renderInterp.ts sampleFighter), or the sim state.
                    let x = fighter.xpos;
                    let y = fighter.ypos;
                    let heading = fighter.heading;
                    if (this.motion !== null) {
                        const st = sampleFighter(this.motion, fighter);
                        x = st.x;
                        y = st.y;
                        heading = st.heading;
                    }
                    this.drawFighter(fighter, f, z, (x - cam.x) * z + halfW, (y - cam.y) * z + halfH, cam, x, y, heading);
                }
            }
        }
        // Forget the drawn size of fighters not drawn this frame.
        for (const fighter of this.drawnLast) if (!now.has(fighter)) drawnPx.delete(fighter);
        this.drawnNow = this.drawnLast;
        this.drawnLast = now;
        this.exhaust.end();
        this.bodies.end();
        this.damage.end();
    }

    /** Main.Part11.cs 1579-1600: the fighter drawn under world point (wx, wy) at zoom factor f, or null. */
    pick(wx: number, wy: number, f: number): Fighter | null {
        return pickDrawnFighter(this.drawnFighters, wx, wy, f);
    }

    private drawFighter(fighter: Fighter, f: number, z: number, sx: number, sy: number, cam: Camera, x: number, y: number, heading: number): void {
        const pictureRef = resolveFighterPictureRef(fighter.pictureRef, fighter.empire?.dominantRace?.designsPictureFamilyIndex ?? null);
        const url = fighterImageUrl(pictureRef);
        if (url === null) return;
        const art = shipArtIfLoaded(url);
        if (art === undefined) {
            void loadShipArt(url, false);
            return;
        }
        if (art === null) return;
        const px = fighterSizePx(fighter.size, art.metrics.areaRatio, f);
        const half = px / 2;
        if (sx + half < -CULL_MARGIN_PX || sx - half > cam.width + CULL_MARGIN_PX || sy + half < -CULL_MARGIN_PX || sy - half > cam.height + CULL_MARGIN_PX) return;
        drawnPx.set(fighter, px);
        this.drawnNow.add(fighter);
        const n = this.drawnFighters.length;
        let rec = this.drawnPool[n];
        if (rec === undefined) {
            rec = { fighter, x, y, px };
            this.drawnPool.push(rec);
        } else {
            rec.fighter = fighter;
            rec.x = x;
            rec.y = y;
            rec.px = px;
        }
        this.drawnFighters.push(rec);
        const cos = Math.cos(heading);
        const sin = Math.sin(heading);
        const k = 1 / z; // world units per drawn px
        const mk = art.markers;

        // Engine exhaust under the fighter while TargetSpeed > 0 (MainView.1.cs 1508-1517).
        if (fighter.targetSpeed > 0 && mk.thrusters.length > 0) {
            const tex = this.engineTexture(fighterExhaustIndex(fighter.specification.engineExhaustImageIndex));
            const num5 = fighterExhaustLengthPx(px, fighter.targetSpeed, fighter.topSpeed);
            if (tex !== null && num5 > 0) {
                for (const t of mk.thrusters) {
                    const r = exhaustRect(t, mk.minThrusterLeft, mk.side, px, num5, scratchRect);
                    const s = this.exhaust.acquire(tex);
                    s.position.set(x + (r.cx * cos - r.cy * sin) * k, y + (r.cx * sin + r.cy * cos) * k);
                    // Raw thruster art: the C# pre-rotates it 90° clockwise, so the raw width spans the rect height.
                    s.rotation = heading + Math.PI / 2;
                    s.scale.set((r.height * k) / (tex.width || 1), (r.width * k) / (tex.height || 1));
                }
            }
        }

        // The fighter (DrawFighterToMainXna: the load-rotated art turned to Heading → raw art at Heading + 90°).
        const tex = art.texture;
        const s = this.bodies.acquire(tex);
        s.anchor.set(art.metrics.cropCenterX / (tex.width || 1), art.metrics.cropCenterY / (tex.height || 1));
        s.position.set(x, y);
        s.rotation = heading + Math.PI / 2;
        s.scale.set(px / art.metrics.cropSide / z);
        // 19r: Main.Part12.cs 5002 method_107 while Health < 1.
        const subject = fighterDamageSubject(fighter);
        if (subject !== null) this.damage.draw(fighter, subject, art, x, y, heading, px, z, this.damageFx);
    }
}
