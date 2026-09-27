// Creature layer: the space monsters (Kaltor, Space Slug, Sand Slug, Ardilus, SilverMist) in the Main View, drawn like
// the original's XNA renderer. Render-only: reads sim state, never writes it (the C# draw loop also sets
// Creature.PromptSystemCheck and runs DoTasks for creatures of restricted areas — those are sim writes and are left
// out, see the TODOs below).
//
// Sources (DistantWorlds/):
//   Controls/MainView.1.cs 1559-1730 — creatures are drawn only while the zoom factor f < 500. The list is the viewed
//     system's Creatures when the camera is within Galaxy.MaxSolarSystemSize + 5000 of that system's star (the star
//     is Galaxy.FastFindNearestSystem(camera), MainView.1.cs 155-166), else the RelatedCreatures of the RestrictedArea
//     locations at the camera. Each creature: culled 50 px outside the viewport (unscaled then prepared size), skipped
//     unless GodMode || PlayerEmpire.IsObjectVisibleToThisEmpire(creature), drawn centred on (Xpos, Ypos), turned to
//     CurrentHeading (the frames were turned 90° clockwise at load); moving creatures (CurrentSpeed > 0) animate at
//     10 fps (method_113, MainView.1.cs 3729: the attack set while CurrentTarget != null && DistanceToTarget <= 40),
//     stationary ones show frame 0 (DrawCreatureToMainXna, MainView.2.cs 1999). A selected creature gets the pulsing
//     selection circle (method_212, MainView.2.cs 3132) over a box 1.5 × the drawn size.
//   Main.Part13.cs 2013-2060 LoadCreaturesImpl / LoadCreatures — frame sets (pictureRef index: folder, prefix, count):
//     0 spaceslug Slug_ 12, 1 sandslug Sandworm_ 12, 2 kaltor Kaltor_ 12, 3 ardilus ArdillusMoving2_ 12,
//     4 silvermist SilverMist_ 12, 5 SlugAttack_ 0, 6 SandwormAttack_ 0, 7 KaltorAttack_ 8, 8 ArdillusMoving_ 12,
//     9 SilverMist_ 12; loaded at imageScale 0.5 × 0.6; frame 0's content pixel count (method_8) is the set's
//     reference size (sveqhmNacy).
//   Main.Part12.cs 4804 PrepareCreatureImage — frames scaled by sqrt(Size / (content / CreatureDrawResizeFactor 8)).
//   Main.Part11.cs 475 CalculateCreatureZoomFactor — divisor max(3, f / 2) above f = 3, width capped at 240 / f.
//   Main.Part11.cs 1341 method_145 (f <= 100 branch, 1501-1552) — creature pick: the smallest creature whose uncapped
//     drawn rect (padded by f × 1.3 world units) holds the point, in the list of the system nearest the point
//     (FindNearestSystemGasCloudAsteroid), GodMode or visible to the player. Creatures win over ships.
//   Main.Part12.cs 5016 method_108 — damage: SilverMist fades to 1 − 0.95 × Damage / DamageKillThreshhold alpha.
//   HoverPanel.cs 220 method_2 — hover text: Name, "Size: N, Strength: N, Health: N%".
//   DistantWorlds.Controls/Controls/InfoPanel.cs 3453 DrawCreature — selection panel: Name, "Size: N, Attack
//     Strength: N", Health bar (DamageKillThreshhold − Damage of DamageKillThreshhold), Speed bar (CurrentSpeed of
//     MovementSpeed); drawn only when GodMode or visible (InfoPanel.cs 1188); a destroyed creature clears the selection.
//   Empire.9.cs 3065 IsObjectVisibleToThisEmpireImprecise / 3198 IsObjectVisibleToThisEmpire — a creature has no
//     Empire and is neither Habitat, Fighter nor BuiltObject, so it is visible only through
//     FindShipOutsideSystemWithScanRange (Stealth 1) of the empire or of the empires it shares visibility with.
//
// No name label and no health bar are drawn on the map for creatures (only the damage overlay and the attack frames).
//
// TODO(port): damage blotches on hurt non-SilverMist creatures (method_108 → Main.Part11.cs 107 method_113 random
//   rect speckles in the per-type colour, masked by bitmap_11) — MainView.1.cs 1654.
// TODO(port): Creature.PromptSystemCheck = true for slow creatures outside the viewed system (MainView.1.cs 1605) and
//   DoTasks for restricted-area creatures (MainView.1.cs 1581) — sim writes from the C# renderer.

import { Container, Texture } from 'pixi.js';
import type { Camera } from './camera';
import { makeDotTexture, useMinifyingFilter } from './assets';
import { SpritePool } from './fxCommon';
import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { CreatureType, resolveCreatureDescription, type Creature } from '../sim/creature';
import { GalaxyLocationType } from '../sim/galaxyLocation';
import { findShipOutsideSystemWithScanRange } from '../sim/independentTraders';
import { empiresSharedVisibility } from '../sim/exploration';

export const CREATURE_DIR = '/assets/dwu/images/units/creatures';
/** Raw creature frame side (every creature PNG in the install is 360 × 360). */
export const CREATURE_FRAME_SIDE = 360;
/** Main.Part12.cs:1002 imageScale 0.5 × LoadCreatures double_8 = 0.6. */
export const CREATURE_IMAGE_SCALE = 0.3;
/** Side of a loaded creature frame (bitmap_10[i][0].Width). */
export const CREATURE_LOADED_SIDE = Math.trunc(CREATURE_FRAME_SIDE * CREATURE_IMAGE_SCALE);
/** Galaxy.3.cs 5075 CreatureDrawResizeFactor. */
export const CREATURE_DRAW_RESIZE_FACTOR = 8;
/** MainView.1.cs:1712 method_113(..., 10, ...): creature animation fps. */
export const CREATURE_FPS = 10;
/** MainView.1.cs:1559 `double_0 < 500`. */
export const CREATURE_MAX_FACTOR = 500;
/** Main.Part11.cs method_145: creatures are picked only in the f <= 100 branch. */
export const CREATURE_PICK_MAX_FACTOR = 100;
/** MainView.1.cs:1567 / Main.Part11.cs:1509: Galaxy.MaxSolarSystemSize (23000) + 5000. */
export const CREATURE_SYSTEM_RANGE = 23000 + 5000;
/** method_113: the attack frames play while the target is within this distance. */
export const CREATURE_ATTACK_FRAME_RANGE = 40;
/** MainView.1.cs:1598: cull margin in px. */
export const CREATURE_CULL_PX = 50;

/** One LoadCreaturesImpl frame set. */
export interface CreatureFrameSet {
    folder: string;
    prefix: string;
    count: number;
}

/** Main.Part13.cs 2049-2058 LoadCreatures, by bitmap_10 index. */
export const CREATURE_FRAME_SETS: readonly CreatureFrameSet[] = [
    { folder: 'spaceslug', prefix: 'Slug_', count: 12 },
    { folder: 'sandslug', prefix: 'Sandworm_', count: 12 },
    { folder: 'kaltor', prefix: 'Kaltor_', count: 12 },
    { folder: 'ardilus', prefix: 'ArdillusMoving2_', count: 12 },
    { folder: 'silvermist', prefix: 'SilverMist_', count: 12 },
    { folder: 'spaceslug', prefix: 'SlugAttack_', count: 0 },
    { folder: 'sandslug', prefix: 'SandwormAttack_', count: 0 },
    { folder: 'kaltor', prefix: 'KaltorAttack_', count: 8 },
    { folder: 'ardilus', prefix: 'ArdillusMoving_', count: 12 },
    { folder: 'silvermist', prefix: 'SilverMist_', count: 12 },
];

/** MainView.1.cs 1660-1686: the moving / attack frame sets (bitmap_10 indexes) of each creature type. */
export function creatureFrameSetIndexes(type: CreatureType): { moving: number; attack: number } | null {
    switch (type) {
        case CreatureType.Kaltor:
            return { moving: 2, attack: 7 };
        case CreatureType.RockSpaceSlug:
            return { moving: 0, attack: 5 };
        case CreatureType.DesertSpaceSlug:
            return { moving: 1, attack: 6 };
        case CreatureType.Ardilus:
            return { moving: 3, attack: 8 };
        case CreatureType.SilverMist:
            return { moving: 4, attack: 9 };
        default:
            return null;
    }
}

/** Frame URLs of a set: `<dir>/<folder>/<Prefix>NNNNN.png`. */
export function creatureFrameUrls(set: CreatureFrameSet): string[] {
    const out: string[] = [];
    for (let i = 0; i < set.count; i++) out.push(`${CREATURE_DIR}/${set.folder}/${set.prefix}${String(i).padStart(5, '0')}.png`);
    return out;
}

/** Port of Main.Part11.cs:475 CalculateCreatureZoomFactor. */
export function creatureZoomFactor(f: number): { factor: number; maxWidth: number } {
    let factor = f;
    let maxWidth = 240;
    if (f > 3) {
        factor = Math.max(3, f / 2);
        maxWidth /= f;
    }
    return { factor, maxWidth };
}

/** PrepareCreatureImage width: trunc(loaded side × sqrt(size / (content / CreatureDrawResizeFactor))). */
export function creaturePreparedPx(contentPixels: number, size: number): number {
    return Math.trunc(CREATURE_LOADED_SIDE * Math.sqrt(size / Math.max(1, contentPixels / CREATURE_DRAW_RESIZE_FACTOR)));
}

/**
 * Drawn width (px) of a creature frame: LoadCreatures scale → PrepareCreatureImage sqrt size scaling → the zoom
 * divisor and cap (MainView.1.cs:1590-1596 / 1640-1645). `capMul` widens the cap (the whale pilot's bigger creature);
 * below f = 1 (only reachable with the pilot's lifted close-up zoom) the cap is not applied.
 */
export function creatureDrawPx(contentPixels: number, size: number, f: number, capMul = 1): number {
    const prepared = creaturePreparedPx(contentPixels, size);
    const { factor, maxWidth } = creatureZoomFactor(f);
    const px = Math.trunc(prepared / factor);
    return f < 1 ? px : Math.min(px, Math.trunc(maxWidth * capMul));
}

/** MainView.1.cs:3729 method_113 frame pick: cycle = n / fps s, step = cycle / max(1, n - 1). */
export function creatureFrameIndex(ms: number, frameCount: number, fps: number): number {
    const cycle = Math.trunc((frameCount / fps) * 1000);
    const step = Math.max(1, Math.trunc(cycle / Math.max(1, frameCount - 1)));
    return Math.min(frameCount - 1, Math.trunc((Math.trunc(ms) % cycle) / step));
}

/** method_113: which frame set a moving creature plays — the attack set while its target is within 40 (if any). */
export function creatureUsesAttackFrames(c: Pick<Creature, 'currentTarget' | 'distanceToTarget'>, attackFrameCount: number): boolean {
    return c.currentTarget !== null && c.distanceToTarget <= CREATURE_ATTACK_FRAME_RANGE && attackFrameCount > 0;
}

/** Main.Part13.cs:624 method_8 on RGBA: pixels with alpha > 0 that are not opaque black. */
export function creatureContentPixels(rgba: ArrayLike<number>): number {
    let n = 0;
    for (let i = 0; i < rgba.length; i += 4) {
        if (rgba[i + 3] === 0) continue;
        if (rgba[i + 3] === 255 && rgba[i] === 0 && rgba[i + 1] === 0 && rgba[i + 2] === 0) continue;
        n++;
    }
    return n;
}

/** Main.Part12.cs 5041-5046 method_108 SilverMist branch: the alpha of a damaged SilverMist (1 when undamaged). */
export function creatureDamageAlpha(c: Pick<Creature, 'type' | 'damage' | 'damageKillThreshold'>): number {
    if (c.type !== CreatureType.SilverMist || !(c.damage > 0) || c.damageKillThreshold <= 0) return 1;
    const v = Math.fround(1 - 0.95 * (Math.fround(c.damage) / c.damageKillThreshold));
    return Math.min(1, Math.max(0, v));
}

/**
 * The creatures the Main View draws around (x, y) (MainView.1.cs 1559-1585) or picks at a point (Main.Part11.cs
 * 1503-1526): the system's Creatures when (x, y) is within MaxSolarSystemSize + 5000 of `star`, else the
 * RelatedCreatures of the RestrictedArea locations at (x, y).
 */
export function creaturesNear(galaxy: Galaxy, star: { xpos: number; ypos: number; systemIndex: number } | null, x: number, y: number): readonly Creature[] {
    if (star === null) return [];
    const d = galaxy.calculateDistance(star.xpos, star.ypos, x, y);
    if (d <= CREATURE_SYSTEM_RANGE) return galaxy.systems[star.systemIndex]?.creatures ?? [];
    const out: Creature[] = [];
    for (const loc of galaxy.determineGalaxyLocationsAtPoint(x, y, GalaxyLocationType.RestrictedArea)) {
        if (loc !== null && loc.relatedCreatures !== null) out.push(...loc.relatedCreatures);
    }
    return out;
}

/** Empire.9.cs 3198 IsObjectVisibleToThisEmpire for a Creature (Stealth 1, no Empire — see the header). */
export function creatureVisibleToEmpire(galaxy: Galaxy, empire: Empire, c: Creature): boolean {
    const x = Math.trunc(c.xpos);
    const y = Math.trunc(c.ypos);
    if (findShipOutsideSystemWithScanRange(galaxy, empire, x, y, 1, true, true) !== null) return true;
    for (const other of empiresSharedVisibility(galaxy, empire)) {
        if (findShipOutsideSystemWithScanRange(galaxy, other, x, y, 1, true, true) !== null) return true;
    }
    return false;
}

/** Main.Part11.cs 1535-1539: the creature's pick rect width in world units at zoom factor f (not capped). */
export function creaturePickWorldSize(contentPixels: number, size: number, f: number): number {
    const d = Math.sqrt(size / (contentPixels / CREATURE_DRAW_RESIZE_FACTOR));
    const num13 = f / creatureZoomFactor(f).factor;
    return Math.trunc(CREATURE_LOADED_SIDE * d * num13);
}

/**
 * Port of Main.Part11.cs 1527-1548 (method_145, f <= 100): the smallest creature whose pick rect (padded by
 * trunc(f × 1.3)) contains the world point and that `visible` allows. Ties keep the first one.
 */
export function pickCreature(
    list: readonly (Creature | null)[],
    wx: number,
    wy: number,
    f: number,
    contentPixels: (c: Creature) => number,
    visible: (c: Creature) => boolean,
): Creature | null {
    const x = Math.trunc(wx);
    const y = Math.trunc(wy);
    const pad = Math.trunc(f * 1.3);
    let best: Creature | null = null;
    let bestSize = 536870911;
    for (const c of list) {
        if (c === null) continue;
        const w = creaturePickWorldSize(contentPixels(c), c.size, f);
        const cx = Math.trunc(c.xpos);
        const cy = Math.trunc(c.ypos);
        const half = Math.trunc(w / 2);
        if (x >= cx - half - pad && x <= cx + half + pad && y >= cy - half - pad && y <= cy + half + pad && visible(c) && c.size < bestSize) {
            best = c;
            bestSize = c.size;
        }
    }
    return best;
}

/** HoverPanel.cs 238: ((DamageKillThreshhold − Damage) / DamageKillThreshhold × 100).ToString("#0"). */
export function creatureHealthPercent(c: Pick<Creature, 'damage' | 'damageKillThreshold'>): number {
    if (c.damageKillThreshold <= 0) return 0;
    const v = ((c.damageKillThreshold - c.damage) / c.damageKillThreshold) * 100;
    return v < 0 ? -Math.round(-v) : Math.round(v);
}

/** HoverPanel.cs 220 method_2: the hover text (name, then size / strength / health). */
export function creatureTooltipText(c: Creature): string {
    return `${c.name} — Size: ${c.size}, Strength: ${c.attackStrength}, Health: ${creatureHealthPercent(c)}%`;
}

/** Where a creature is: its parent habitat, else its nearest system, else deep space. */
export function creatureLocationText(c: Creature): string {
    if (c.parentHabitat !== null) return c.parentHabitat.name;
    if (c.nearestSystemStar !== null) return `${c.nearestSystemStar.name} system`;
    return 'Deep space';
}

/**
 * The selection panel rows of a creature (InfoPanel.cs 3453 DrawCreature: size, attack strength, health, speed), plus
 * its type (Galaxy.2.cs ResolveDescription(CreatureType)) and location. DOM-free.
 */
export function creatureSelectionRows(c: Creature): { label: string; value: string }[] {
    return [
        { label: 'Type', value: resolveCreatureDescription(c.type) },
        { label: 'Size', value: String(c.size) },
        { label: 'Attack Strength', value: String(c.attackStrength) },
        {
            label: 'Health',
            value: `${Math.trunc(c.damageKillThreshold - c.damage)} / ${c.damageKillThreshold} (${creatureHealthPercent(c)}%)`,
        },
        { label: 'Speed', value: `${Math.trunc(c.currentSpeed)} / ${c.movementSpeed}` },
        { label: 'Location', value: creatureLocationText(c) },
    ];
}

interface LoadedSet {
    frames: Texture[];
    /** method_8 content pixels of frame 0 at the loaded 108 px size. */
    content: number;
}

function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`creatureLayer: cannot load ${url}`));
        img.src = url;
    });
}

/** method_8 on frame 0 drawn at the loaded size (LoadCreaturesImpl loads at imageScale 0.3). */
function loadedContentPixels(img: CanvasImageSource): number {
    const side = CREATURE_LOADED_SIDE;
    const c = document.createElement('canvas');
    c.width = side;
    c.height = side;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (ctx === null) return (side * side) / 2;
    ctx.drawImage(img, 0, 0, side, side);
    return creatureContentPixels(ctx.getImageData(0, 0, side, side).data);
}

/**
 * Draws the creatures of the viewed system (or of the restricted areas at the camera) as animated sprites centred on
 * (xpos, ypos), turned to CurrentHeading. Frame sets load lazily on first sight; without a DW:U install a grey dot
 * stands in (content = half the frame).
 */
export class CreatureLayer {
    root = new Container();
    private pool: SpritePool;
    private sets = new Map<number, LoadedSet | null>();
    private loading = new Set<number>();
    /** Drawn size (px) per creature at the last update; 0 / missing = not drawn. */
    private drawnPx = new Map<Creature, number>();
    private fallback: LoadedSet | null = null;
    /** _Game.GodMode (every creature visible); off in a normal game. */
    godMode = false;

    constructor(
        private galaxy: Galaxy,
        world: Container,
        private dwuPresent: boolean,
    ) {
        this.root.eventMode = 'none';
        this.root.interactiveChildren = false;
        world.addChild(this.root);
        this.pool = new SpritePool(this.root);
    }

    /** A frame set if loaded (starts the load on first request); null until then / on failure. */
    private frameSet(index: number): LoadedSet | null {
        if (!this.dwuPresent) {
            if (this.fallback === null) {
                const t = makeDotTexture('#b0b0b0', 32);
                useMinifyingFilter(t);
                this.fallback = { frames: [t], content: (CREATURE_LOADED_SIDE * CREATURE_LOADED_SIDE) / 2 };
            }
            return this.fallback;
        }
        const got = this.sets.get(index);
        if (got !== undefined) return got;
        const set = CREATURE_FRAME_SETS[index];
        if (set === undefined || set.count === 0) {
            this.sets.set(index, null);
            return null;
        }
        if (!this.loading.has(index)) {
            this.loading.add(index);
            Promise.all(creatureFrameUrls(set).map(loadImage)).then(
                (imgs) => {
                    const frames = imgs.map((img) => {
                        const t = Texture.from(img);
                        useMinifyingFilter(t);
                        return t;
                    });
                    this.sets.set(index, { frames, content: loadedContentPixels(imgs[0]) });
                },
                (e) => {
                    console.warn('[creatures]', e);
                    this.sets.set(index, null);
                },
            );
        }
        return null;
    }

    /** sveqhmNacy[pictureRef] for size maths (null while the set is loading). */
    contentPixelsOf(c: Creature): number | null {
        return this.frameSet(c.pictureRef)?.content ?? null;
    }

    private visibleToPlayer(c: Creature): boolean {
        const player = this.galaxy.playerEmpire;
        return this.godMode || player === null || creatureVisibleToEmpire(this.galaxy, player, c);
    }

    update(z: number, cam: Camera): void {
        const f = 1 / z;
        this.drawnPx.clear();
        this.pool.begin();
        this.root.visible = f < CREATURE_MAX_FACTOR;
        if (!this.root.visible) {
            this.pool.end();
            return;
        }
        const star = this.galaxy.fastFindNearestSystem(cam.x, cam.y);
        const list = creaturesNear(this.galaxy, star, cam.x, cam.y);
        const { factor, maxWidth } = creatureZoomFactor(f);
        const halfW = cam.width / 2;
        const halfH = cam.height / 2;
        const nowMs = this.galaxy.nowMs;
        for (const c of list) {
            if (c === null || c.hasBeenDestroyed) continue;
            const idx = creatureFrameSetIndexes(c.type);
            if (idx === null) continue;
            const sizeSet = this.frameSet(c.pictureRef);
            const moving = this.frameSet(idx.moving);
            if (sizeSet === null || moving === null) continue;
            // MainView.1.cs 1590-1600: first cull on the unprepared frame size.
            const loadedPx = Math.min(Math.trunc(CREATURE_LOADED_SIDE / factor), Math.trunc(maxWidth));
            const sx = (c.xpos - cam.x) * z + halfW;
            const sy = (c.ypos - cam.y) * z + halfH;
            if (offScreen(sx, sy, loadedPx, cam)) continue;
            if (!this.visibleToPlayer(c)) continue;
            const px = creatureDrawPx(sizeSet.content, c.size, f);
            if (offScreen(sx, sy, px, cam) || px < 1) continue;
            let frames = moving.frames;
            if (c.currentSpeed > 0) {
                const attack = this.frameSet(idx.attack);
                if (attack !== null && creatureUsesAttackFrames(c, attack.frames.length)) frames = attack.frames;
            }
            const frame = c.currentSpeed > 0 ? frames[creatureFrameIndex(nowMs, frames.length, CREATURE_FPS)] : frames[0];
            const s = this.pool.acquire(frame);
            s.position.set(c.xpos, c.ypos);
            // Raw frames face up; the C# turns them 90° clockwise at load and draws at CurrentHeading.
            s.rotation = c.currentHeading + Math.PI / 2;
            s.scale.set(px / frame.width / z);
            s.alpha = creatureDamageAlpha(c);
            this.drawnPx.set(c, px);
        }
        this.pool.end();
    }

    /** Drawn size in px of a creature at the last update (0 when not drawn). */
    drawnSizePx(c: Creature): number {
        return this.drawnPx.get(c) ?? 0;
    }

    /** Main.Part11.cs method_145 (f <= 100): the creature under the world point, or null. */
    pick(wx: number, wy: number, f: number): Creature | null {
        if (f > CREATURE_PICK_MAX_FACTOR) return null;
        const star = this.galaxy.findNearestSystemGasCloudAsteroid(wx, wy);
        const list = creaturesNear(this.galaxy, star, wx, wy);
        if (list.length === 0) return null;
        return pickCreature(
            list,
            wx,
            wy,
            f,
            (c) => this.contentPixelsOf(c) ?? Number.NaN,
            (c) => !c.hasBeenDestroyed && this.contentPixelsOf(c) !== null && this.visibleToPlayer(c),
        );
    }
}

/** MainView.1.cs 1598 / 1646: the drawn box (top-left at centre − size / 2) lies 50 px or more outside the view. */
function offScreen(sx: number, sy: number, px: number, cam: Camera): boolean {
    const left = sx - px / 2;
    const top = sy - px / 2;
    return left + px < -CREATURE_CULL_PX || left - px > cam.width + CREATURE_CULL_PX || top + px < -CREATURE_CULL_PX || top - px > cam.height + CREATURE_CULL_PX;
}
