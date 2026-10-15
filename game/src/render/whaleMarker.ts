// Galaxy-zoom icon of the Void Whale threat (render only): at galaxy / sector zoom a small dark whale silhouette with a
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

export const WHALE_ICON_PX = 30;
const FADE_YEARS = 3;

/** Opacity of the icon `ageMs` (star-date ms) after the sighting. Pure. */
export function whaleIconAlpha(ageMs: number): number {
    const y = ageMs / YEAR_LENGTH;
    return Math.max(0.3, Math.min(1, 1 - (y / FADE_YEARS) * 0.7));
}

/** The icon's shapes in a local frame (head toward +x, length WHALE_ICON_PX): body outline, fluke, eye. Pure. */
export function whaleIconShape(L = WHALE_ICON_PX): { body: number[]; fluke: number[]; eye: [number, number, number] } {
    const h = L / 2;
    const body: number[] = [];
    for (let i = 0; i <= 16; i++) {
        const u = i / 16; // 0 tail .. 1 head
        const hw = (u < 0.55 ? 0.12 + 0.88 * Math.pow(u / 0.55, 1.1) : 1 - Math.pow((u - 0.55) / 0.45, 3) * 0.55) * (L * 0.2);
        body.push(-h + u * L, -hw);
    }
    for (let i = 16; i >= 0; i--) {
        const u = i / 16;
        const hw = (u < 0.55 ? 0.12 + 0.88 * Math.pow(u / 0.55, 1.1) : 1 - Math.pow((u - 0.55) / 0.45, 3) * 0.55) * (L * 0.2);
        body.push(-h + u * L, hw);
    }
    const fluke = [-h + 1, 0, -h - L * 0.2, -L * 0.22, -h - L * 0.12, 0, -h - L * 0.2, L * 0.22];
    return { body, fluke, eye: [h - L * 0.2, -L * 0.07, L * 0.045] };
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
        g.poly(s.fluke).fill({ color: 0x1a0a10, alpha: 0.95 }).stroke({ color: 0xb02a40, width: 1.2, alpha: 0.9 });
        g.poly(s.body).fill({ color: 0x1a0a10, alpha: 0.95 }).stroke({ color: 0xb02a40, width: 1.4, alpha: 0.95 });
        g.circle(s.eye[0], s.eye[1], s.eye[2] + 1.2).fill({ color: 0xf2f4e4 });
        g.circle(s.eye[0], -s.eye[1], s.eye[2] + 1.2).fill({ color: 0xf2f4e4 });
        // Dashed arrow ahead: the jump direction.
        const x0 = WHALE_ICON_PX * 0.7;
        for (let i = 0; i < 4; i++) g.moveTo(x0 + i * 9, 0).lineTo(x0 + i * 9 + 5, 0).stroke({ color: 0xe0a0a8, width: 1.6, alpha: 0.9 });
        g.poly([x0 + 4 * 9 + 6, 0, x0 + 4 * 9 - 2, -4, x0 + 4 * 9 - 2, 4]).fill({ color: 0xe0a0a8, alpha: 0.9 });
    }
}
