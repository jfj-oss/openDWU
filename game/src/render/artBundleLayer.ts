// 19r map-level art (render-only): threat site markers by reveal level (item 4), league presence (item 2), wreck-field
// debris (item 5) and herder camp props over herder stations (item 3). Each reads scenario state that may live on
// another branch (19f threats, 19k-3 leagues, 19e-7 wreckage) behind a presence check: a module found by
// import.meta.glob (empty when the file does not exist on this branch) or a state key in galaxy.scenario.state read
// through a local structural shape — so this compiles and runs here and lights up once those packages merge.

import { drawnPositionOf, type MotionInterpolator, type Point } from './renderInterp';
import { Container, Graphics, Text } from 'pixi.js';
import type { Camera } from './camera';
import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { BuiltObject } from '../sim/builtObject';
import { HabitatCategoryType, type Habitat } from '../sim/types';
import { moonDotPx, planetSpritePx, starSpritePx } from './mainView';
import { drawThreatMarker, threatMarkerStyle, type ThreatMarkerStyle } from './threatMarkers';
import { Texture } from 'pixi.js';
import { SpritePool } from './fxCommon';
import { circleAtScreenRes } from './screenCircle';
import { textureFromPixels } from './shipOverlays';
import { herderCampRgba } from './emblemArt';
import { BuiltObjectRole } from '../sim/data/designSpecifications';
import { herderColonies, isHerderEmpire } from '../sim/scenario/rimHerders/common';
import { scenarioParam } from '../sim/scenario/state';
import { YEAR_LENGTH } from '../sim/galaxyTime';
import { galaxyStarDate } from '../sim/tick/simTime';
import { DesignImageScalingMode } from '../sim/data/designSpecifications';
import { BUILT_OBJECT_MAX_FACTOR, builtObjectImageUrl, builtObjectSizePx } from './builtObjectLayer';
import { loadShipArt, shipArtIfLoaded } from './shipArt';
import { cropHullMask } from './damageOverlay';
import { cropRotatedImage } from './liveries';
import {
    WRECK_DECAY_YEARS_DEFAULT,
    cutFragment,
    fragmentCount,
    planFragments,
    podOn,
    podsLit,
    wreckPictureRef,
    wreckRemainingAt,
    type FragmentPlan,
    type WreckageStateShape,
    type WreckShape,
} from './wreckDebris';
import { activeLeaguesOf, leagueBoundaryDots, leagueFlag, pennantFromFlag, type LeagueShape } from './leagueArt';
import { flagShapeUrl } from '../sim/startGameOptions';
import { loadRgba } from '../ui/empireEmblem';

// ---------------------------------------------------------------------------------------------------------------
// Threat sites (19f framework.ts threatKnownSites / KnownThreatSite)
// ---------------------------------------------------------------------------------------------------------------

/** The fields of framework.ts KnownThreatSite this layer reads. */
export interface KnownThreatSiteShape {
    threat: string;
    kind: 'colony' | 'ship';
    target: { xpos: number; ypos: number; diameter?: number; category?: HabitatCategoryType };
    level: number;
    label: string;
}
type ThreatSitesFn = (galaxy: Galaxy, empire: Empire | null, minLevel?: number) => KnownThreatSiteShape[];

const threatFramework = import.meta.glob('../sim/scenario/threats/framework.ts', { eager: true }) as Record<string, { threatKnownSites?: ThreatSitesFn }>;

/** The 19f selector when the threat framework is on this branch (null otherwise). Overridable for captures. */
let threatSitesSource: ThreatSitesFn | null = Object.values(threatFramework)[0]?.threatKnownSites ?? null;

export function setThreatSitesSource(fn: ThreatSitesFn | null): void {
    threatSitesSource = fn;
}
export function threatFrameworkPresent(): boolean {
    return Object.values(threatFramework)[0]?.threatKnownSites !== undefined;
}

function habitatPx(h: { diameter?: number; category?: HabitatCategoryType }, z: number): number {
    const d = h.diameter ?? 0;
    if (h.category === HabitatCategoryType.Star) return starSpritePx(d, z);
    if (h.category === HabitatCategoryType.Moon) return moonDotPx(d, z);
    return planetSpritePx(d, z);
}

/** World radius of a site's marker at zoom z: a colony's drawn disc + 12 px (≥ 18 px), a ship 14 px. */
export function threatMarkerRadius(site: KnownThreatSiteShape, z: number): number {
    if (site.kind === 'ship') return 14 / z;
    return Math.max(habitatPx(site.target, z) / 2 + 12, 18) / z;
}

/** Side of the herder camp prop texture. */
export const HERDER_CAMP_SIZE = 256;
/** Camps show from this drawn station size (px). */
export const HERDER_CAMP_MIN_PX = 18;

/** Item 3: the bases that get herder camp props — stations of herder colonies and of herder (Ossuvan) empires. */
export function herderStations(galaxy: Galaxy): BuiltObject[] {
    if (galaxy.scenario === null) return [];
    const colonies = new Set<Habitat>(herderColonies(galaxy).filter((c) => c.status !== 'lost').map((c) => c.colony));
    const out: BuiltObject[] = [];
    for (const bo of galaxy.builtObjects) {
        if (bo === null || bo.hasBeenDestroyed || bo.role !== BuiltObjectRole.Base) continue;
        if ((bo.parentHabitat !== null && colonies.has(bo.parentHabitat)) || isHerderEmpire(galaxy, bo.empire)) out.push(bo);
    }
    return out;
}

/** The 19e-7 wreckage state when present (scenario.state['wreckage'], wreckage/common.ts WreckageState). */
export function wreckageStateOf(galaxy: Galaxy): WreckageStateShape | null {
    const s = galaxy.scenario;
    if (s === null || !('wreckage' in s.state)) return null;
    const st = s.state['wreckage'] as Partial<WreckageStateShape> | null;
    return st !== null && Array.isArray(st.fields) ? (st as WreckageStateShape) : null;
}

interface WreckView {
    side: number;
    heading: number;
    areaRatio: number;
    frags: { plan: FragmentPlan; tex: Texture; ox: number; oy: number; w: number; h: number }[];
    pods: number;
    seen: number;
}

function podTexture(): Texture {
    const n = 32;
    const d = new Uint8ClampedArray(n * n * 4);
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const r = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2);
            const a = Math.max(0, 1 - r) ** 2;
            d.set([255, 214 + 41 * (1 - r), 150 + 80 * (1 - r), Math.round(255 * a)], (y * n + x) * 4);
        }
    }
    return textureFromPixels(d, n, n, false);
}

/** Pennants and seat rings show while the zoom factor is below this; the dotted boundary and name above LEAGUE_SECTOR_F. */
export const LEAGUE_NEAR_F = 300;
export const LEAGUE_SECTOR_F = 30;
/** Boundary margin round the members (world units) and dot spacing (screen px). */
export const LEAGUE_MARGIN = 25000;
export const LEAGUE_DOT_PX = 12;

/** A league's member colonies where they are drawn (render-interpolated orbits; committed positions without an
 * interpolator): the points its sector-zoom boundary is hulled around. */
export function leagueMemberPoints(members: readonly { xpos: number; ypos: number }[], motion: MotionInterpolator | null): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (const m of members) out.push(drawnPositionOf(motion, m, { x: 0, y: 0 }));
    return out;
}

/** The 19k-3 active leagues when present (scenario.state['independents']). */
export function leaguesOf(galaxy: Galaxy): LeagueShape[] {
    const s = galaxy.scenario;
    if (s === null || !('independents' in s.state)) return [];
    return activeLeaguesOf(s.state['independents']);
}

interface LeagueArt {
    pennants: Texture[] | null;
    label: Text | null;
}

export class ArtBundleLayer {
    readonly root = new Container();
    private threats = new Graphics();
    private campRoot = new Container();
    private campPool: SpritePool;
    private campTex: Texture | null = null;
    private camps: BuiltObject[] = [];
    private wreckRoot = new Container();
    private wreckPool: SpritePool;
    private podPool: SpritePool;
    private podTex: Texture | null = null;
    private wrecks = new Map<number, WreckView | null>();
    private leagueG = new Graphics();
    private pennantRoot = new Container();
    private pennantPool: SpritePool;
    private labelRoot = new Container();
    private leagues: LeagueShape[] = [];
    private leagueArt = new Map<number, LeagueArt>();
    /** Fields / fragments / lit pods drawn this frame (captures). */
    wreckStats = { fields: 0, fragments: 0, pods: 0 };
    private sites: { site: KnownThreatSiteShape; style: ThreatMarkerStyle; seed: number }[] = [];
    private frame = 0;
    /** Render interpolation between sim steps (renderInterp.ts; set by MainView): camps sit on the drawn station,
     * league pennants / seat rings / boundaries on the drawn (orbit-interpolated) colonies. */
    motion: MotionInterpolator | null = null;
    private posScratch: Point = { x: 0, y: 0 };

    constructor(
        private galaxy: Galaxy,
        world: Container,
        /** Drawn size (px) of a ship / base from the ship layer's last update (0 = not drawn). */
        private shipPx: (bo: BuiltObject) => number,
    ) {
        this.root.eventMode = 'none';
        this.root.interactiveChildren = false;
        this.root.addChild(this.wreckRoot, this.campRoot, this.leagueG, this.pennantRoot, this.labelRoot, this.threats);
        this.pennantPool = new SpritePool(this.pennantRoot);
        this.campPool = new SpritePool(this.campRoot);
        const podRoot = new Container();
        this.wreckPool = new SpritePool(this.wreckRoot);
        this.wreckRoot.addChild(podRoot);
        this.podPool = new SpritePool(podRoot);
        world.addChild(this.root);
    }

    update(z: number, cam: Camera): void {
        this.frame++;
        this.updateWrecks(z, cam);
        this.updateCamps(z, cam);
        this.updateLeagues(z, cam);
        this.updateThreats(z, cam);
    }

    private artOfLeague(l: LeagueShape): LeagueArt {
        let a = this.leagueArt.get(l.id);
        if (a === undefined) {
            a = { pennants: null, label: null };
            this.leagueArt.set(l.id, a);
            const art = a;
            void (l.flagShape >= 0 ? loadRgba(flagShapeUrl(l.flagShape)) : Promise.resolve(null)).then((shape) => {
                const flag = leagueFlag(shape, l.colour);
                art.pennants = [0, 1, 2, 3].map((k) => {
                    const p = pennantFromFlag(flag, 52, 30, (k * Math.PI) / 2);
                    return textureFromPixels(p.data, p.w, p.h, false);
                });
            });
        }
        return a;
    }

    /** Item 2: pennants beside member colonies, the ringed council seat, the dotted member boundary at sector zoom. */
    private updateLeagues(z: number, cam: Camera): void {
        const g = this.leagueG;
        this.pennantPool.begin();
        if (this.frame % 30 === 1) this.leagues = leaguesOf(this.galaxy);
        for (const l of this.labelRoot.children) l.visible = false;
        if (this.leagues.length === 0) {
            if (g.visible) {
                g.clear();
                g.visible = false;
            }
            this.pennantPool.end();
            return;
        }
        g.clear();
        g.visible = true;
        const f = 1 / z;
        const t = performance.now() / 1000;
        const halfW = cam.width / 2 / z;
        const halfH = cam.height / 2 / z;
        const onScreen = (x: number, y: number, m: number): boolean => Math.abs(x - cam.x) < halfW + m && Math.abs(y - cam.y) < halfH + m;
        for (const l of this.leagues) {
            const art = this.artOfLeague(l);
            const col = l.colour;
            if (f < LEAGUE_NEAR_F) {
                for (const m of l.members) {
                    // Pennants fly from the drawn (render-interpolated orbit) colony.
                    const mp = drawnPositionOf(this.motion, m, this.posScratch);
                    if (!onScreen(mp.x, mp.y, 200 / z)) continue;
                    const r = Math.max(planetSpritePx((m as { diameter?: number }).diameter ?? 0, z) / 2, 8) / z;
                    const bx = mp.x + r * 0.9;
                    const by = mp.y - r * 0.9;
                    // Pole, then the pennant flying from its top.
                    g.moveTo(bx, by).lineTo(bx, by - 30 / z).stroke({ width: 1.5 / z, color: 0xd8d0c0, alpha: 0.9 });
                    if (art.pennants !== null) {
                        const tex = art.pennants[Math.floor(t * 4 + l.id) % art.pennants.length];
                        const s = this.pennantPool.acquire(tex);
                        s.anchor.set(0, 0);
                        s.position.set(bx, by - 30 / z);
                        s.scale.set(26 / tex.width / z);
                    }
                }
                const seat = l.founder;
                const sp = seat !== null ? drawnPositionOf(this.motion, seat, this.posScratch) : null;
                if (seat !== null && sp !== null && onScreen(sp.x, sp.y, 200 / z)) {
                    const sx = sp.x;
                    const sy = sp.y;
                    const r = Math.max(planetSpritePx((seat as { diameter?: number }).diameter ?? 0, z) / 2 + 14, 22) / z;
                    g.circle(sx, sy, r).stroke({ width: 2.5 / z, color: col, alpha: 0.95 });
                    g.circle(sx, sy, r + 6 / z).stroke({ width: 1.2 / z, color: col, alpha: 0.7 });
                    for (let k = 0; k < 8; k++) {
                        const a = (k / 8) * Math.PI * 2 + t * 0.1;
                        g.moveTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r).lineTo(sx + Math.cos(a) * (r + 6 / z), sy + Math.sin(a) * (r + 6 / z));
                    }
                    g.stroke({ width: 1.5 / z, color: col, alpha: 0.9 });
                }
            }
            if (f >= LEAGUE_SECTOR_F) {
                const pts = leagueMemberPoints(l.members, this.motion);
                const dots = leagueBoundaryDots(pts, Math.max(LEAGUE_MARGIN, 30 / z), LEAGUE_DOT_PX / z);
                // At screen resolution: a world-unit circle of 1.8 px is tessellated by its world radius (~1000 vertices at galaxy zoom).
                for (const d of dots) if (onScreen(d.x, d.y, 10 / z)) circleAtScreenRes(g, d.x, d.y, 1.8 / z, z);
                g.fill({ color: col, alpha: 0.85 });
                const seat = l.founder ?? l.members[0] ?? null;
                const lp = seat !== null ? drawnPositionOf(this.motion, seat, this.posScratch) : null;
                if (seat !== null && lp !== null && onScreen(lp.x, lp.y, 300 / z)) {
                    if (art.label === null) {
                        art.label = new Text({ text: l.name, style: { fontFamily: 'sans-serif', fontSize: 14, fill: col, stroke: { color: 0x000000, width: 3 } } });
                        art.label.anchor.set(0.5, 0);
                        this.labelRoot.addChild(art.label);
                    }
                    art.label.visible = true;
                    art.label.position.set(lp.x, lp.y + 16 / z);
                    art.label.scale.set(1 / z);
                }
            }
        }
        this.pennantPool.end();
    }

    /** The fragments of one wreck (null = its art is missing; undefined while loading). */
    private wreckView(w: WreckShape): WreckView | null | undefined {
        const got = this.wrecks.get(w.id);
        if (got !== undefined) return got;
        const owner = this.galaxy.empires.find((e) => e !== null && e.empireId === w.ownerEmpireId) ?? this.galaxy.pirateEmpires.find((e) => e.empireId === w.ownerEmpireId) ?? null;
        const url = builtObjectImageUrl(wreckPictureRef(w, owner));
        if (url === null) {
            this.wrecks.set(w.id, null);
            return null;
        }
        const art = shipArtIfLoaded(url);
        if (art === undefined) {
            void loadShipArt(url);
            return undefined;
        }
        if (art === null) {
            this.wrecks.set(w.id, null);
            return null;
        }
        const img = cropRotatedImage(art.rgba, art.w, art.h, art.metrics, 1);
        const hull = cropHullMask(art.rgba, art.w, art.h, art.metrics, img.side);
        const plans = planFragments(hull, img.side, w.id, fragmentCount(w.size));
        const frags = plans.map((plan) => {
            const f = cutFragment(img, plan, w.id);
            return { plan, tex: textureFromPixels(f.rgba, f.w, f.h, false), ox: f.ox, oy: f.oy, w: f.w, h: f.h };
        });
        let pods = 0;
        for (const f of frags) pods += f.plan.pods.length;
        const v: WreckView = { side: img.side, heading: ((w.id * 2654435761) >>> 0) / 4294967296 * Math.PI * 2, areaRatio: art.metrics.areaRatio, frags, pods, seen: this.frame };
        this.wrecks.set(w.id, v);
        return v;
    }

    /** Item 5: hull fragments of every wreck in view, pods blinking out with decay. */
    private updateWrecks(z: number, cam: Camera): void {
        this.wreckPool.begin();
        this.podPool.begin();
        this.wreckStats = { fields: 0, fragments: 0, pods: 0 };
        const st = wreckageStateOf(this.galaxy);
        const f = 1 / z;
        if (st !== null && f < BUILT_OBJECT_MAX_FACTOR) {
            this.podTex ??= podTexture();
            const t = performance.now() / 1000;
            const now = galaxyStarDate(this.galaxy);
            const decay = scenarioParam(this.galaxy, 'wreckDecayYears', WRECK_DECAY_YEARS_DEFAULT);
            const halfW = cam.width / 2 / z;
            const halfH = cam.height / 2 / z;
            for (const field of st.fields) {
                if (field.wrecks.length === 0) continue;
                let drawn = false;
                for (const w of field.wrecks) {
                    if (Math.abs(w.x - cam.x) > halfW + 400 || Math.abs(w.y - cam.y) > halfH + 400) continue;
                    const v = this.wreckView(w);
                    if (v == null) continue;
                    v.seen = this.frame;
                    const px = builtObjectSizePx(w.size, v.areaRatio, f, DesignImageScalingMode.None, 1);
                    if (px < 2) continue;
                    drawn = true;
                    const remaining = wreckRemainingAt(now, w.starDate, decay, YEAR_LENGTH);
                    const k = px / v.side / z;
                    const c = Math.cos(v.heading);
                    const sn = Math.sin(v.heading);
                    const lit = podsLit(v.pods, remaining);
                    let podIndex = 0;
                    for (const fr of v.frags) {
                        const ang = fr.plan.rot + fr.plan.spin * t;
                        // Fragment centroid from the crop centre, then its drift (in drawn ship sizes).
                        const lx = (fr.plan.cx - v.side / 2) * k + fr.plan.dx * px / z;
                        const ly = (fr.plan.cy - v.side / 2) * k + fr.plan.dy * px / z;
                        const wx = w.x + lx * c - ly * sn;
                        const wy = w.y + lx * sn + ly * c;
                        const s = this.wreckPool.acquire(fr.tex);
                        s.anchor.set(fr.ox / fr.w, fr.oy / fr.h);
                        s.position.set(wx, wy);
                        s.rotation = v.heading + ang;
                        s.scale.set(k);
                        s.alpha = 0.55 + 0.45 * remaining;
                        this.wreckStats.fragments++;
                        const ca = Math.cos(v.heading + ang);
                        const sa = Math.sin(v.heading + ang);
                        for (const pod of fr.plan.pods) {
                            const on = podIndex < lit && podOn(t, pod.phase, pod.period, remaining);
                            podIndex++;
                            if (!on) continue;
                            const p = this.podPool.acquire(this.podTex);
                            p.position.set(wx + (pod.x * ca - pod.y * sa) * k, wy + (pod.x * sa + pod.y * ca) * k);
                            p.scale.set(Math.max(3, px * 0.06) / 32 / z * 2);
                            p.blendMode = 'add';
                            this.wreckStats.pods++;
                        }
                    }
                }
                if (drawn) this.wreckStats.fields++;
            }
            // Wrecks salvaged away or unseen for a while give their textures back.
            if (this.frame % 120 === 0) {
                for (const [id, v] of this.wrecks) {
                    if (v !== null && this.frame - v.seen < 600) continue;
                    if (v !== null) {
                        for (const fr of v.frags) {
                            this.wreckPool.release(fr.tex);
                            fr.tex.destroy(true);
                        }
                    }
                    this.wrecks.delete(id);
                }
            }
        }
        this.wreckPool.end();
        this.podPool.end();
    }

    /** Item 3: tents and pens over herder stations (sized and turned with the station sprite). */
    private updateCamps(z: number, cam: Camera): void {
        this.campPool.begin();
        if (this.frame % 60 === 1) this.camps = herderStations(this.galaxy);
        if (this.camps.length > 0) {
            if (this.campTex === null) {
                const img = herderCampRgba(HERDER_CAMP_SIZE, 19);
                this.campTex = textureFromPixels(img.data, img.w, img.h, false);
            }
            const halfW = cam.width / 2 / z;
            const halfH = cam.height / 2 / z;
            for (const bo of this.camps) {
                const px = this.shipPx(bo);
                if (px < HERDER_CAMP_MIN_PX) continue;
                if (Math.abs(bo.xpos - cam.x) > halfW + px / z || Math.abs(bo.ypos - cam.y) > halfH + px / z) continue;
                const s = this.campPool.acquire(this.campTex);
                const d = this.motion !== null ? this.motion.drawn(bo) : null;
                s.position.set(d !== null ? d.x : bo.xpos, d !== null ? d.y : bo.ypos);
                s.rotation = d !== null ? d.heading : bo.heading;
                s.scale.set((px * 0.95) / HERDER_CAMP_SIZE / z);
                s.alpha = 0.95;
            }
        }
        this.campPool.end();
    }

    private updateThreats(z: number, cam: Camera): void {
        const g = this.threats;
        if (this.frame % 30 === 1) {
            const player = this.galaxy.playerEmpire;
            const list = threatSitesSource === null ? [] : threatSitesSource(this.galaxy, player);
            this.sites = [];
            let k = 0;
            for (const site of list) {
                const style = threatMarkerStyle(site.threat, site.level, site.kind);
                if (style !== null) this.sites.push({ site, style, seed: k++ * 7 + site.threat.length });
            }
        }
        if (this.sites.length === 0) {
            if (g.visible) {
                g.clear();
                g.visible = false;
            }
            return;
        }
        g.clear();
        g.visible = true;
        const t = performance.now() / 1000;
        const halfW = cam.width / 2 / z;
        const halfH = cam.height / 2 / z;
        for (const s of this.sites) {
            const r = threatMarkerRadius(s.site, z);
            const x = s.site.target.xpos;
            const y = s.site.target.ypos;
            if (Math.abs(x - cam.x) > halfW + r * 3 || Math.abs(y - cam.y) > halfH + r * 3) continue;
            drawThreatMarker(g, s.style, x, y, r, z, t, s.seed);
        }
    }
}

