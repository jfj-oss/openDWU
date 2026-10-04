// [dw2overlays] Colony Target Scores overlay (Improvements; data: colonyTargets.ts). System zoom (f < 70): a ring around
// each Expansion Planner colonization target, in its heat colour (green = the best targets, red = the weakest). Galaxy /
// sector zoom: a ring around each system holding a target, in its best target's colour. It extends the original's
// Potential Colonies: where both are on, the scored habitats take these rings instead of the plain yellow ones
// (overlayLayer.ts). Hover: the target's rank, quality and score.
//
// Cost: the list is re-read once a second (colonyTargetScoresFor: a signature, rebuilt only on change); the galaxy-zoom
// rings are placed again only when the camera or the list changed, the system-zoom ones every frame (the bodies orbit)
// for the targets in view.

import { Container } from 'pixi.js';
import type { Camera } from './camera';
import type { Galaxy } from '../sim/galaxy';
import type { Habitat } from '../sim/types';
import type { MotionInterpolator } from './renderInterp';
import { overlayActive, type MapOverlayState } from '../ui/mapOverlays';
import { SpritePool, drawnHabitatPx, ringTexture, sizeSprite } from './dw2OverlayArt';
import { colonyTargetScoresFor, colonyTargetTooltip, heatColor, type ColonyTargetScore, type ColonyTargetScores } from './colonyTargets';

interface DrawnRing {
    x: number;
    y: number;
    r: number;
    score: ColonyTargetScore;
}

export class ColonyScoreOverlay {
    readonly root = new Container();
    private rings = new SpritePool();
    private scores: ColonyTargetScores | null = null;
    private frame = 0;
    private drawn: DrawnRing[] = [];
    private built = { valid: false, z: 0, x: 0, y: 0, w: 0, h: 0, scores: null as ColonyTargetScores | null };
    motion: MotionInterpolator | null = null;

    constructor(
        private galaxy: Galaxy,
        parent: Container,
        private state: MapOverlayState,
    ) {
        this.root.addChild(this.rings.root);
        this.root.visible = false;
        parent.addChild(this.root);
    }

    /** The scored targets while the overlay draws (Potential Colonies leaves them to it), else null. */
    get active(): ColonyTargetScores | null {
        return this.root.visible ? this.scores : null;
    }

    update(z: number, cam: Camera): void {
        const player = this.galaxy.playerEmpire;
        if (!overlayActive(this.state, 'colonyScores') || player === null) {
            if (this.root.visible) {
                this.root.visible = false;
                this.drawn = [];
                this.built.valid = false;
            }
            return;
        }
        if (this.frame++ % 60 === 0 || this.scores === null) this.scores = colonyTargetScoresFor(this.galaxy, player);
        const scores = this.scores;
        const f = 1 / z;
        const systemZoom = f < 70;
        const k = this.built;
        if (!systemZoom && k.valid && k.z === z && k.x === cam.x && k.y === cam.y && k.w === cam.width && k.h === cam.height && k.scores === scores) {
            this.root.visible = true;
            return;
        }
        k.valid = !systemZoom;
        k.z = z;
        k.x = cam.x;
        k.y = cam.y;
        k.w = cam.width;
        k.h = cam.height;
        k.scores = scores;
        const tex = ringTexture();
        this.drawn = [];
        this.rings.begin();
        const halfW = cam.width / (2 * z) + 40 / z;
        const halfH = cam.height / (2 * z) + 40 / z;
        const inView = (x: number, y: number): boolean => !(x < cam.x - halfW || x > cam.x + halfW || y < cam.y - halfH || y > cam.y + halfH);
        if (systemZoom) {
            for (const s of scores.list) {
                const h = s.habitat;
                if (!inView(h.xpos, h.ypos)) continue;
                const p = this.motion !== null ? this.motion.habitatPos(h) : { x: h.xpos, y: h.ypos };
                const px = drawnHabitatPx(h, z) + 20;
                this.place(tex, p.x, p.y, px, z, s);
            }
        } else {
            for (const s of scores.bySystem.values()) {
                const star = this.galaxy.systems[s.habitat.systemIndex]?.systemStar;
                if (star === undefined || !inView(star.xpos, star.ypos)) continue;
                const px = Math.max(6, drawnHabitatPx(star, z)) + 12;
                this.place(tex, star.xpos, star.ypos, px, z, s);
            }
        }
        this.rings.end();
        this.root.visible = true;
    }

    private place(tex: ReturnType<typeof ringTexture>, x: number, y: number, px: number, z: number, s: ColonyTargetScore): void {
        if (tex !== null) {
            const sp = this.rings.take(tex);
            sp.position.set(x, y);
            sizeSprite(sp, px, z);
            sp.tint = heatColor(s.heat);
            sp.alpha = 0.95;
        }
        this.drawn.push({ x, y, r: px / 2 / z, score: s });
    }

    /** Tooltip lines for a hovered habitat: its own target entry, or (a system star) its system's best target. */
    habitatTooltipExtra(h: Habitat): string | null {
        const scores = this.active;
        if (scores === null) return null;
        const own = scores.byHabitat.get(h);
        const s = own ?? (h.parent === null ? scores.bySystem.get(h.systemIndex) : undefined);
        if (s === undefined) return null;
        return colonyTargetTooltip(s, scores.list.length, this.galaxy.systems[s.habitat.systemIndex]?.systemStar.name ?? null);
    }

    /** The hover text of the target ring under world (wx, wy), or null. */
    hitTest(wx: number, wy: number): string | null {
        if (!this.root.visible || this.scores === null) return null;
        for (const d of this.drawn) {
            const dx = wx - d.x;
            const dy = wy - d.y;
            if (dx * dx + dy * dy <= d.r * d.r) {
                const sys = this.galaxy.systems[d.score.habitat.systemIndex]?.systemStar.name ?? null;
                return colonyTargetTooltip(d.score, this.scores.list.length, sys);
            }
        }
        return null;
    }
}
