// 19r item 7 — the livery / withered-look overlays over the original ship sprites (flag `liveries`). Render-only.
// The pure maths is liveries.ts; this file caches the per-texture analysis and the per (texture, style, wither bucket,
// scars) overlay textures, tracks the render-observed ship history the sim does not keep (the end of a long repair,
// lightning hits), and places the overlay + hull number over each ship.
//
// Sim fields read (never written): BuiltObject.dateBuilt / dateRetrofit (sim/builtObject.ts 186-187; dateRetrofit is
// stamped when a retrofit is assigned — construction/empireConstruction.ts 952, 1424-1445), damagedComponentCount /
// components (builtObject.ts 277 / 298), locationEffects + lastLocationEffectTouch (events.ts applyLocationEffects:
// the LightningDamage branch stamps lastLocationEffectTouch on every strike), Empire.mainColor / secondaryColor /
// flagShape. The "long repair" and storm-scar history is observed by the renderer (not saved: a reloaded game starts
// its ships' scars / repair dates from the sim fields alone).

import { Container, Sprite, Texture } from 'pixi.js';
import type { Galaxy } from '../sim/galaxy';
import type { BuiltObject } from '../sim/builtObject';
import type { Empire } from '../sim/empire';
import { GalaxyLocationEffectType } from '../sim/galaxyLocation';
import { YEAR_LENGTH } from '../sim/galaxyTime';
import { galaxyStarDate } from '../sim/tick/simTime';
import type { ShipArt } from './shipArt';
import { BuiltObjectSubRole } from '../sim/builtObjectTypes';
import { rimTraderEmpire } from '../sim/scenario/rimTrade/common';
import { textureFromPixels } from './shipOverlays';
import {
    EMBLEM_GLYPHS,
    WITHER_STEPS,
    analyseHull,
    cropRotatedImage,
    hullNumber,
    hullNumberRgba,
    paintLivery,
    witherBucket,
    witherLevel,
    type CropImage,
    type HullAnalysis,
    type LiveryStyle,
    type ScorchSource,
} from './liveries';

/** Analysis / overlay resolution relative to the art's crop (2 = twice the native pixels, crisper decals). */
export const LIVERY_SCALE = 2;
/** Damage share above which a repair back to 0 counts as a "long repair" (resets the withering). */
export const LONG_REPAIR_SHARE = 0.25;
/** Hull numbers show from this drawn size (px). */
export const HULL_NUMBER_MIN_PX = 40;

// ---------------------------------------------------------------------------------------------------------------
// Per-empire style hooks (the Concord's salt bloom, 19a)
// ---------------------------------------------------------------------------------------------------------------

export type LiveryStyleHook = (galaxy: Galaxy, empire: Empire, bo: BuiltObject) => Partial<LiveryStyle> | null;
const styleHooks: LiveryStyleHook[] = [];

/** Registers a per-empire / per-ship style tweak (return null to leave a ship alone). Returns an unregister function. */
export function registerLiveryStyleHook(hook: LiveryStyleHook): () => void {
    styleHooks.push(hook);
    return () => {
        const i = styleHooks.indexOf(hook);
        if (i >= 0) styleHooks.splice(i, 1);
    };
}

export function isPirateEmpire(galaxy: Galaxy, e: Empire | null): boolean {
    return e !== null && (e.pirateEmpireBaseHabitat !== null || galaxy.pirateEmpires.includes(e));
}

/** The livery style a ship wears (null: no paint — unowned / independent). */
export function liveryStyleOf(galaxy: Galaxy, bo: BuiltObject): LiveryStyle | null {
    const e = bo.empire;
    if (e === null || e === galaxy.independentEmpire) return null;
    let style: LiveryStyle = {
        main: e.mainColor,
        secondary: e.secondaryColor,
        emblem: ((e.flagShape >= 0 ? e.flagShape : e.empireId) % EMBLEM_GLYPHS + EMBLEM_GLYPHS) % EMBLEM_GLYPHS,
        saltBloom: 0,
        // The empire paint band, emblem decal and hull number are off (user call): ships keep only the wear /
        // damage / weathering overlay. Flip to true to bring the livery back.
        paint: false,
    };
    for (const h of styleHooks) {
        const o = h(galaxy, e, bo);
        if (o !== null) style = { ...style, ...o };
    }
    return style;
}

function styleKey(s: LiveryStyle | null): string {
    return s === null ? '-' : `${s.main}.${s.secondary}.${s.emblem}.${Math.round(s.saltBloom * 4)}.${s.paint ? 1 : 0}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Observed history
// ---------------------------------------------------------------------------------------------------------------

export interface ShipHistory {
    heavy: boolean;
    repairedAt: number;
    scars: number;
    lastStrike: number;
    lastRetrofit: number;
}

/** Updates the render-observed history of a ship (call every frame it is seen, before culling). Pure over `h`. */
export function observeShip(
    h: ShipHistory,
    bo: Pick<BuiltObject, 'damagedComponentCount' | 'dateRetrofit' | 'lastLocationEffectTouch' | 'locationEffects'> & { components: { items: readonly unknown[] } | null },
    starDate: number,
): void {
    const total = bo.components?.items.length ?? 0;
    const share = total > 0 ? bo.damagedComponentCount / total : 0;
    if (share >= LONG_REPAIR_SHARE) h.heavy = true;
    else if (bo.damagedComponentCount === 0 && h.heavy) {
        h.heavy = false;
        h.repairedAt = starDate;
    }
    if (bo.locationEffects.includes(GalaxyLocationEffectType.LightningDamage) && bo.lastLocationEffectTouch !== h.lastStrike) {
        if (h.lastStrike !== -Infinity) h.scars = Math.min(4, h.scars + 1);
        h.lastStrike = bo.lastLocationEffectTouch;
    }
    if (bo.dateRetrofit !== h.lastRetrofit) {
        if (h.lastRetrofit !== -Infinity) h.scars = 0;
        h.lastRetrofit = bo.dateRetrofit;
    }
}

export function newShipHistory(bo: Pick<BuiltObject, 'lastLocationEffectTouch' | 'dateRetrofit'>): ShipHistory {
    return { heavy: false, repairedAt: 0, scars: 0, lastStrike: bo.lastLocationEffectTouch, lastRetrofit: bo.dateRetrofit };
}

// ---------------------------------------------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------------------------------------------

interface Analysed {
    img: CropImage;
    an: HullAnalysis;
    thrusters: ScorchSource[];
}

function stringHash(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
}

export class LiveryOverlays {
    readonly root = new Container();
    private analyses = new Map<string, Analysed | null>();
    private textures = new Map<string, { tex: Texture; used: number }>();
    private numbers = new Map<string, Texture>();
    private history = new WeakMap<BuiltObject, ShipHistory>();
    private sprites: Sprite[] = [];
    private used = 0;
    private frame = 0;
    private builds = 0;
    private starDate = 0;
    /** Overrides for captures (ship → forced wither level / scars). */
    forced = new WeakMap<BuiltObject, { level?: number; scars?: number }>();

    constructor(
        parent: Container,
        private galaxy: Galaxy,
    ) {
        this.root.eventMode = 'none';
        parent.addChild(this.root);
    }

    begin(): void {
        this.used = 0;
        this.frame++;
        this.builds = 0;
        this.starDate = galaxyStarDate(this.galaxy);
    }

    /** Record the history of a ship seen this frame (before culling, so offscreen strikes count). */
    observe(bo: BuiltObject): void {
        let h = this.history.get(bo);
        if (h === undefined) {
            h = newShipHistory(bo);
            this.history.set(bo, h);
        }
        observeShip(h, bo, this.starDate);
    }

    private analysis(art: ShipArt): Analysed | null | undefined {
        const got = this.analyses.get(art.url);
        if (got !== undefined) return got;
        if (this.builds >= 2) return undefined;
        this.builds++;
        const img = cropRotatedImage(art.rgba, art.w, art.h, art.metrics, LIVERY_SCALE);
        const an = analyseHull(img);
        const thrusters = art.markers.thrusters.map((t) => ({ left: t.left * LIVERY_SCALE, top: t.top * LIVERY_SCALE, height: t.height * LIVERY_SCALE }));
        const a = an === null ? null : { img, an, thrusters };
        this.analyses.set(art.url, a);
        return a;
    }

    private sprite(tex: Texture): Sprite {
        let s = this.sprites[this.used];
        if (s === undefined) {
            s = new Sprite(tex);
            s.anchor.set(0.5);
            this.sprites.push(s);
            this.root.addChild(s);
        } else if (s.texture !== tex) s.texture = tex;
        this.used++;
        s.visible = true;
        return s;
    }

    /** The wither level a ship shows now (0-1, unbucketed). */
    levelOf(bo: BuiltObject): number {
        const f = this.forced.get(bo);
        if (f?.level !== undefined) return f.level;
        const h = this.history.get(bo);
        return witherLevel({
            nowStarDate: this.starDate,
            dateBuilt: bo.dateBuilt,
            dateRetrofit: bo.dateRetrofit,
            repairedAt: h?.repairedAt ?? 0,
            yearLength: YEAR_LENGTH,
            pirate: isPirateEmpire(this.galaxy, bo.empire),
        });
    }

    /** Draw the livery of `bo` (its sprite already placed): centre, heading, drawn px, zoom, sprite alpha. `x`, `y`,
     * `heading`: where the sprite was drawn (render-interpolated; default the sim position). */
    draw(bo: BuiltObject, art: ShipArt, px: number, z: number, alpha: number, x = bo.xpos, y = bo.ypos, heading = bo.heading): void {
        const a = this.analysis(art);
        if (a === undefined || a === null) return;
        const style = liveryStyleOf(this.galaxy, bo);
        const bucket = witherBucket(this.levelOf(bo));
        const scars = this.forced.get(bo)?.scars ?? this.history.get(bo)?.scars ?? 0;
        if ((style === null || (!style.paint && style.saltBloom === 0)) && bucket === 0 && scars === 0) return;
        const key = `${art.url}|${styleKey(style)}|${bucket}|${scars}`;
        let t = this.textures.get(key);
        if (t === undefined) {
            if (this.builds >= 3) return;
            this.builds++;
            const rgba = paintLivery(a.an, a.img, style, { level: bucket / WITHER_STEPS, scars }, stringHash(art.url), a.thrusters);
            t = { tex: textureFromPixels(rgba, a.an.side, a.an.side, false), used: this.frame };
            this.textures.set(key, t);
        }
        t.used = this.frame;
        const k = px / a.an.side / z;
        const s = this.sprite(t.tex);
        s.position.set(x, y);
        s.rotation = heading;
        s.scale.set(k);
        s.alpha = alpha;
        // Hull number near the stern (not on pirates' scrap, not while tiny).
        if (style !== null && style.paint && px >= HULL_NUMBER_MIN_PX && !isPirateEmpire(this.galaxy, bo.empire)) {
            const text = hullNumber(bo.builtObjectID);
            const fg = bucket >= 3 ? 0xc8c0b0 : 0xf2efe6;
            const nkey = `${text}|${fg}`;
            let nt = this.numbers.get(nkey);
            if (nt === undefined) {
                const n = hullNumberRgba(text, fg, 2);
                nt = textureFromPixels(n.rgba, n.w, n.h, true);
                this.numbers.set(nkey, nt);
            }
            const slot = a.an.number;
            const dx = (slot.x - a.an.side / 2) * k;
            const dy = (slot.y - a.an.side / 2) * k;
            const c = Math.cos(heading);
            const sn = Math.sin(heading);
            const ns = this.sprite(nt);
            ns.position.set(x + dx * c - dy * sn, y + dx * sn + dy * c);
            ns.rotation = heading;
            // Glyph cells (5 rows + outline = 7 rows) over slot.h × 7/5 crop px.
            ns.scale.set(((slot.h * 7) / 5 / nt.height) * k);
            ns.alpha = alpha;
        }
    }

    end(): void {
        for (let i = this.used; i < this.sprites.length; i++) this.sprites[i].visible = false;
        if (this.frame % 120 === 0) {
            for (const [k, t] of this.textures) {
                if (this.frame - t.used < 600) continue;
                for (const s of this.sprites) if (s.texture === t.tex) s.texture = Texture.EMPTY;
                t.tex.destroy(true);
                this.textures.delete(k);
            }
        }
    }

    /** The per-texture analysis (captures / tests). */
    analysisOf(art: ShipArt): HullAnalysis | null {
        return this.analysis(art)?.an ?? null;
    }
}

// 19a hook: the Concord's treasure ships wear salt bloom / barnacle growth on their hull edges. The treasure fleet
// itself (19a addendum) is on another branch: until it merges, the Concord's freighters stand in for it.
// TODO(19a merge): key this on the treasure-fleet ships instead of the freighter sub-roles.
registerLiveryStyleHook((galaxy, empire, bo) => {
    if (galaxy.scenario === null || rimTraderEmpire(galaxy) !== empire) return null;
    const sr = bo.subRole;
    const freighter = sr === BuiltObjectSubRole.SmallFreighter || sr === BuiltObjectSubRole.MediumFreighter || sr === BuiltObjectSubRole.LargeFreighter;
    return freighter ? { saltBloom: 0.75 } : { saltBloom: 0.2 };
});
