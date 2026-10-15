// Galaxy-zoom icon of the Void Whale threat (render only): at galaxy / sector zoom a small side-on Leviathan silhouette (its own profile) with a
// pale eye marks the LAST place it fed, turned the way it jumped away, with a dashed arrow ahead of it; it fades over
// ~3 game years. Players know nothing else about it (scenarios/void-whale). Drawn in screen pixels (scale 1/z) so the
// tessellation stays small at galaxy zoom. Reads the saved Void Whale state, never creates it.

import { Container, Graphics } from 'pixi.js';
import type { Galaxy } from '../sim/galaxy';
import { peekVoidWhaleState } from '../sim/scenario/threats/voidWhale';
import { galaxyStarDate } from '../sim/tick/simTime';
import { YEAR_LENGTH } from '../sim/galaxyTime';
import { GALAXY_OVERLAY_MIN_FACTOR } from './galaxyMarkers';
import type { WhaleSighting } from '../sim/scenario/threats/voidWhale';
import { LEV_EYE, LEV_FIN_ROOT, LEV_H, LEV_HINGE, LEV_X0, LEV_X1, levBot, levTop, levX } from './leviathanArt';

export const WHALE_ICON_PX = 46;
const FADE_YEARS = 3;

/** Opacity of the icon `ageMs` (star-date ms) after the sighting. Pure. */
export function whaleIconAlpha(ageMs: number): number {
    const y = ageMs / YEAR_LENGTH;
    return Math.max(0.3, Math.min(1, 1 - (y / FADE_YEARS) * 0.7));
}

/**
 * The icon's shapes in a local frame (head toward +x, belly toward +y, length L): the Leviathan's own profile
 * (leviathanArt.ts — box head, underslung jaw, tapering body), its flukes, a swept pectoral fin and the eye. Pure.
 */
export function whaleIconShape(L = WHALE_ICON_PX): { body: number[]; jaw: number[]; maw: number[]; fluke: number[]; fin: number[]; eye: [number, number, number] } {
    const k = L / (LEV_X1 - LEV_X0);
    const px = (x: number): number => (x - (LEV_X0 + LEV_X1) / 2) * k;
    const py = (y: number): number => (y - LEV_H / 2) * k;
    const body: number[] = [];
    for (let i = 0; i <= 24; i++) {
        const u = i / 24;
        body.push(px(levX(u)), py(levTop(u)));
    }
    for (let i = 24; i >= 0; i--) {
        const u = i / 24;
        body.push(px(levX(u)) - (i === 24 ? L * 0.02 : 0), py(levBot(u)));
    }
    const [hx, hy] = LEV_HINGE;
    // Slightly agape: the jaw drops a little, the maw shows between.
    const jaw = [px(hx - 40), py(hy), px(LEV_X1 - 50), py(hy + 60), px(LEV_X1 - 70), py(hy + 100), px(hx), py(hy + 74)];
    const maw = [px(hx - 20), py(hy), px(LEV_X1 - 20), py(hy - 4), px(LEV_X1 - 50), py(hy + 60)];
    const t0 = px(LEV_X0);
    const fluke = [t0 + 1, 0, t0 - L * 0.16, -L * 0.17, t0 - L * 0.11, -L * 0.02, t0 - L * 0.07, 0, t0 - L * 0.11, L * 0.02, t0 - L * 0.16, L * 0.17];
    const [fx, fy] = LEV_FIN_ROOT;
    const fin = [px(fx + 30), py(fy - 10), px(fx - 240), py(fy + 170), px(fx - 40), py(fy + 30)];
    return { body, jaw, maw, fluke, fin, eye: [px(LEV_EYE[0]), py(LEV_EYE[1]), Math.max(1, L * 0.02)] };
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
        // Belly down on screen whichever way it jumped (the profile is mirrored, the arrow is symmetric).
        g.scale.y = seen.dx < 0 ? -1 : 1;
        const s = whaleIconShape();
        const HIDE = 0x1b2333;
        const EDGE = 0xa8d8f0;
        g.poly(s.fin).fill({ color: HIDE, alpha: 0.95 }).stroke({ color: EDGE, width: 1.1, alpha: 0.8 });
        g.poly(s.fluke).fill({ color: HIDE, alpha: 0.95 }).stroke({ color: EDGE, width: 1.2, alpha: 0.9 });
        g.poly(s.maw).fill({ color: 0xb0202c, alpha: 0.95 });
        g.poly(s.jaw).fill({ color: 0x5a6474, alpha: 0.95 }).stroke({ color: EDGE, width: 1, alpha: 0.8 });
        g.poly(s.body).fill({ color: HIDE, alpha: 0.95 }).stroke({ color: EDGE, width: 1.4, alpha: 0.95 });
        // A red scar slash across the flank and the pale eye.
        g.moveTo(-4, -6).lineTo(2, 3).stroke({ color: 0xd03040, width: 1.6, alpha: 0.95 });
        g.circle(s.eye[0], s.eye[1], s.eye[2] + 0.4).fill({ color: 0xe8fff8 });
        // Dashed arrow ahead: the jump direction.
        const x0 = WHALE_ICON_PX * 0.62;
        for (let i = 0; i < 4; i++) g.moveTo(x0 + i * 9, 0).lineTo(x0 + i * 9 + 5, 0).stroke({ color: 0xe0a0a8, width: 1.6, alpha: 0.9 });
        g.poly([x0 + 4 * 9 + 6, 0, x0 + 4 * 9 - 2, -4, x0 + 4 * 9 - 2, 4]).fill({ color: 0xe0a0a8, alpha: 0.9 });
    }
}
