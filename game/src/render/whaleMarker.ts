// Galaxy-zoom icon of the Void Whale threat (render only): at galaxy / sector zoom a small top-down Leviathan silhouette (its own outline) with
// its glowing beads marks the LAST place it fed, turned the way it jumped away, with a dashed arrow ahead of it; it fades over
// ~3 game years. Players know nothing else about it (scenarios/void-whale). Drawn in screen pixels (scale 1/z) so the
// tessellation stays small at galaxy zoom. Reads the saved Void Whale state, never creates it.

import { Container, Graphics } from 'pixi.js';
import type { Galaxy } from '../sim/galaxy';
import { peekVoidWhaleState } from '../sim/scenario/threats/voidWhale';
import { galaxyStarDate } from '../sim/tick/simTime';
import { YEAR_LENGTH } from '../sim/galaxyTime';
import { GALAXY_OVERLAY_MIN_FACTOR } from './galaxyMarkers';
import type { WhaleSighting } from '../sim/scenario/threats/voidWhale';
import { LEV_H, LEV_X0, LEV_X1, levBot, levTop, levX } from './leviathanArt';
import { LEV_GLOW_SPOTS, LEV_PART_OUTLINES } from './leviathanParts';

export const WHALE_ICON_PX = 46;
const FADE_YEARS = 3;

/** Opacity of the icon `ageMs` (star-date ms) after the sighting. Pure. */
export function whaleIconAlpha(ageMs: number): number {
    const y = ageMs / YEAR_LENGTH;
    return Math.max(0.3, Math.min(1, 1 - (y / FADE_YEARS) * 0.7));
}

/**
 * The icon's shapes in a local frame (head toward +x, length L), seen from above like the beast itself (the outline of
 * the Leviathan picture, leviathanParts.ts): the body, the notched flukes, both long pectoral fins and the glowing
 * spine beads / head dots. Pure.
 */
export function whaleIconShape(L = WHALE_ICON_PX): { body: number[]; fluke: number[]; fins: number[][]; beads: [number, number][]; beadR: number } {
    const k = L / (LEV_X1 - LEV_X0);
    const px = (x: number): number => (x - (LEV_X0 + LEV_X1) / 2) * k;
    const py = (y: number): number => (y - LEV_H / 2) * k;
    const body: number[] = [];
    for (let i = 0; i <= 32; i++) {
        const u = i / 32;
        body.push(px(levX(u)), py(levTop(u)));
    }
    for (let i = 32; i >= 0; i--) {
        const u = i / 32;
        body.push(px(levX(u)), py(levBot(u)));
    }
    const map = (pts: readonly number[]): number[] => pts.map((v, i) => (i % 2 === 0 ? px(v) : py(v)));
    const fins = [map(LEV_PART_OUTLINES.finL), map(LEV_PART_OUTLINES.finR)];
    const fluke = map(LEV_PART_OUTLINES.fluke);
    // A few of the glows: the spine beads, and the head dots thinned out.
    const beads = LEV_GLOW_SPOTS.filter((g, i) => g.kind === 'spine' || i % 6 === 0).map((g) => [px(g.x), py(g.y)] as [number, number]);
    return { body, fluke, fins, beads, beadR: Math.max(0.6, L * 0.009) };
}

export class WhaleMarkerLayer {
    readonly root = new Container();
    private g = new Graphics();
    private key = '';
    /** Dev capture (?faunaGallery=1&faunaView=leviathanGalaxy): a render-only stand-in sighting. */
    gallery: { markerSighting(): WhaleSighting | null } | null = null;

    constructor(private readonly galaxy: Galaxy, world: Container) {
        this.root.eventMode = 'none';
        this.root.addChild(this.g);
        this.root.visible = false;
        world.addChild(this.root);
    }

    update(z: number): void {
        const st = this.galaxy.scenario === null ? null : peekVoidWhaleState(this.galaxy);
        const fake = this.gallery?.markerSighting() ?? null;
        const seen = fake ?? st?.lastSeen ?? null;
        const f = 1 / z;
        if (seen === null || (fake === null && (st === null || st.phase !== 'active')) || f <= GALAXY_OVERLAY_MIN_FACTOR) {
            this.root.visible = false;
            return;
        }
        this.root.visible = true;
        this.root.position.set(seen.x, seen.y);
        this.root.scale.set(f);
        this.root.alpha = whaleIconAlpha(fake !== null ? 0 : galaxyStarDate(this.galaxy) - seen.date);
        const key = `${seen.seq}`;
        if (key === this.key) return;
        this.key = key;
        const g = this.g;
        g.clear();
        g.rotation = Math.atan2(seen.dy, seen.dx);
        const s = whaleIconShape();
        const HIDE = 0x161b24;
        const EDGE = 0x9cc4dc;
        for (const fin of s.fins) g.poly(fin).fill({ color: HIDE, alpha: 0.95 }).stroke({ color: EDGE, width: 1.1, alpha: 0.8 });
        g.poly(s.fluke).fill({ color: HIDE, alpha: 0.95 }).stroke({ color: EDGE, width: 1.2, alpha: 0.9 });
        g.poly(s.body).fill({ color: HIDE, alpha: 0.95 }).stroke({ color: EDGE, width: 1.4, alpha: 0.95 });
        // A red scar slash and the pale glowing beads.
        g.moveTo(-2, -4).lineTo(3, 4).stroke({ color: 0xd03040, width: 1.6, alpha: 0.95 });
        for (const [bx, by] of s.beads) g.circle(bx, by, s.beadR).fill({ color: 0xd8f0ff, alpha: 0.9 });
        // Dashed arrow ahead: the jump direction.
        const x0 = WHALE_ICON_PX * 0.62;
        for (let i = 0; i < 4; i++) g.moveTo(x0 + i * 9, 0).lineTo(x0 + i * 9 + 5, 0).stroke({ color: 0xe0a0a8, width: 1.6, alpha: 0.9 });
        g.poly([x0 + 4 * 9 + 6, 0, x0 + 4 * 9 - 2, -4, x0 + 4 * 9 - 2, 4]).fill({ color: 0xe0a0a8, alpha: 0.9 });
    }
}
