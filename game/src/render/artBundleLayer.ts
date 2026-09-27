// 19r map-level art (render-only): threat site markers by reveal level (item 4), league presence (item 2), wreck-field
// debris (item 5) and herder camp props over herder stations (item 3). Each reads scenario state that may live on
// another branch (19f threats, 19k-3 leagues, 19e-7 wreckage) behind a presence check: a module found by
// import.meta.glob (empty when the file does not exist on this branch) or a state key in galaxy.scenario.state read
// through a local structural shape — so this compiles and runs here and lights up once those packages merge.

import { Container, Graphics } from 'pixi.js';
import type { Camera } from './camera';
import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { BuiltObject } from '../sim/builtObject';
import { HabitatCategoryType, type Habitat } from '../sim/types';
import { moonDotPx, planetSpritePx, starSpritePx } from './mainView';
import { drawThreatMarker, threatMarkerStyle, type ThreatMarkerStyle } from './threatMarkers';

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

export class ArtBundleLayer {
    readonly root = new Container();
    private threats = new Graphics();
    private sites: { site: KnownThreatSiteShape; style: ThreatMarkerStyle; seed: number }[] = [];
    private frame = 0;

    constructor(
        private galaxy: Galaxy,
        world: Container,
        /** Drawn size (px) of a ship / base from the ship layer's last update (0 = not drawn). */
        private shipPx: (bo: BuiltObject) => number,
    ) {
        this.root.eventMode = 'none';
        this.root.interactiveChildren = false;
        this.root.addChild(this.threats);
        world.addChild(this.root);
    }

    update(z: number, cam: Camera): void {
        this.frame++;
        this.updateThreats(z, cam);
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

export type { Habitat };
