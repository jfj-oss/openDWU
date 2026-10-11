// Colony Economy (docs/ECONOMY.md §6): a small badge beside each of the viewer's designated colonies — a dark disc, a
// ring in the designation's colour and a glyph (gear, coin arrows, star, pick, crown, shield) — behind the "Colony
// Designations" overlay toggle; the designation and its facilities on hover. Our own procedural art (no original
// image); drawn in screen pixels through the context transform, so it keeps its size at every zoom. Read-only.

import { Graphics, type Container } from 'pixi.js';
import type { Galaxy } from '../sim/galaxy';
import type { Habitat } from '../sim/types';
import type { MapOverlayState } from '../ui/mapOverlays';
import { localViewerEmpire } from '../localViewer';
import { DESIGNATION_NAMES, Designation, designationOf, peekColony, facilityDef } from '../sim/scenario/colonyEconomy/common';
import { econVisible } from '../ui/scenario/colonyEconomyUi';

export const DESIGNATION_COLORS: Readonly<Record<Designation, number>> = {
    [Designation.None]: 0x808080,
    [Designation.Industrial]: 0xe0892c,
    [Designation.TradeHub]: 0xf2c94c,
    [Designation.Resort]: 0x56d1c8,
    [Designation.MiningHub]: 0xb9906a,
    [Designation.CoreWorld]: 0x6aa8ff,
    [Designation.Frontier]: 0xd9534f,
};

/** Screen-pixel offset of the badge from the colony centre, and its radius. */
const OFF_X = 14;
const OFF_Y = -12;
const R = 7;

/** Draws one badge at the origin (screen px) into `g` (the caller sets the transform). Exported for the art test. */
export function drawDesignationBadge(g: Graphics, d: Designation): void {
    const c = DESIGNATION_COLORS[d];
    g.circle(0, 0, R).fill({ color: 0x0c1218, alpha: 0.88 });
    g.circle(0, 0, R).stroke({ width: 1.6, color: c, alpha: 1 });
    const s = { width: 1.4, color: c, alpha: 1, cap: 'round' as const, join: 'round' as const };
    switch (d) {
        case Designation.Industrial: {
            // Gear: a ring and six teeth.
            g.circle(0, 0, 2.4).stroke(s);
            for (let i = 0; i < 6; i++) {
                const a = (i * Math.PI) / 3;
                g.moveTo(Math.cos(a) * 2.6, Math.sin(a) * 2.6).lineTo(Math.cos(a) * 4.6, Math.sin(a) * 4.6);
            }
            g.stroke(s);
            break;
        }
        case Designation.TradeHub:
            // Two opposed arrows.
            g.moveTo(-4, -1.5).lineTo(4, -1.5).moveTo(2, -3.5).lineTo(4, -1.5).lineTo(2, 0.5);
            g.moveTo(4, 1.8).lineTo(-4, 1.8).moveTo(-2, -0.2).lineTo(-4, 1.8).lineTo(-2, 3.8);
            g.stroke(s);
            break;
        case Designation.Resort: {
            // A four-pointed star.
            const pts: number[] = [];
            for (let i = 0; i < 8; i++) {
                const a = (i * Math.PI) / 4 - Math.PI / 2;
                const r = i % 2 === 0 ? 4.8 : 1.6;
                pts.push(Math.cos(a) * r, Math.sin(a) * r);
            }
            g.poly(pts).fill({ color: c, alpha: 1 });
            break;
        }
        case Designation.MiningHub:
            // A pick: the handle and the head's arc.
            g.moveTo(-3.5, 3.5).lineTo(2, -2);
            g.moveTo(-1.5, -4).quadraticCurveTo(3, -3.5, 4, 1.5);
            g.stroke(s);
            break;
        case Designation.CoreWorld:
            // A crown.
            g.poly([-4, 3, -4, -2, -2, 0.5, 0, -3.5, 2, 0.5, 4, -2, 4, 3]).fill({ color: c, alpha: 1 });
            break;
        case Designation.Frontier:
            // A shield.
            g.moveTo(0, -4.2).lineTo(3.8, -2.6).lineTo(3.2, 1.2).quadraticCurveTo(1.8, 3.6, 0, 4.6).quadraticCurveTo(-1.8, 3.6, -3.2, 1.2).lineTo(-3.8, -2.6).closePath();
            g.stroke(s);
            break;
    }
}

interface Mark {
    h: Habitat;
    d: Designation;
}

export class EconomyMarkerLayer {
    private readonly g = new Graphics();
    private list: Mark[] = [];
    private frame = 0;
    private lastZ = -1;
    private sig = '';

    constructor(
        private readonly galaxy: Galaxy,
        root: Container,
        private readonly state: MapOverlayState,
    ) {
        root.addChild(this.g);
    }

    private refresh(): void {
        const viewer = localViewerEmpire(this.galaxy);
        const out: Mark[] = [];
        if (viewer !== null) for (const h of viewer.colonies) {
            const d = designationOf(this.galaxy, h);
            if (d !== Designation.None) out.push({ h, d });
        }
        this.list = out;
    }

    update(z: number): void {
        const g = this.g;
        if (this.galaxy.scenario === null || !this.state.colonyDesignations || !econVisible(this.galaxy)) {
            if (g.visible) {
                g.clear();
                g.visible = false;
                this.sig = '';
            }
            return;
        }
        if (this.frame++ % 30 === 0) this.refresh();
        if (this.list.length === 0) {
            g.clear();
            g.visible = false;
            this.sig = '';
            return;
        }
        // Redraw when the zoom, the list or a colony's position changes.
        let sig = `${z}`;
        for (const m of this.list) sig += `|${m.h.habitatIndex}:${m.d}:${Math.round(m.h.xpos / 2000)}:${Math.round(m.h.ypos / 2000)}`;
        if (sig !== this.sig || this.lastZ !== z) {
            this.sig = sig;
            this.lastZ = z;
            g.clear();
            for (const m of this.list) {
                g.context.save();
                g.context.transform(1 / z, 0, 0, 1 / z, m.h.xpos + OFF_X / z, m.h.ypos + OFF_Y / z);
                drawDesignationBadge(g, m.d);
                g.context.restore();
            }
        }
        g.visible = true;
    }

    /** The badge under a world point (hover): designation and facilities, or null. */
    hitTest(x: number, y: number, z: number): string | null {
        if (!this.g.visible) return null;
        const r = (R + 2) / z;
        for (const m of this.list) {
            const cx = m.h.xpos + OFF_X / z;
            const cy = m.h.ypos + OFF_Y / z;
            if ((cx - x) ** 2 + (cy - y) ** 2 <= r * r) {
                const facs = (peekColony(this.galaxy, m.h)?.facilities ?? []).map((f) => `${facilityDef(f.id).name}${f.progress < 1 ? ` (${Math.round(f.progress * 100)}%)` : ''}`);
                return `${m.h.name}: ${DESIGNATION_NAMES[m.d]}${facs.length > 0 ? `\n${facs.join(', ')}` : ''}`;
            }
        }
        return null;
    }
}
