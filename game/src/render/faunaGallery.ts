// 19g-7b capture gallery (render-only, dev flag `?faunaGallery=1`, view `&faunaView=gallery|tamed|shoal`): render-only
// stand-ins for the eight new-fauna variants placed next to the player's capital and drawn by the creature layer with
// the real creature rules (size maths, zoom, cull, rig, harness). Nothing here touches the sim (no Creature objects in
// the galaxy, no galaxy.rnd); the stand-ins are never picked.

import { Container, Text } from 'pixi.js';
import type { Camera } from './camera';
import type { Galaxy } from '../sim/galaxy';
import type { Creature } from '../sim/creature';
import { CreatureType } from '../sim/creature';
import { FaunaVariant, faunaVariantDef } from '../sim/scenario/newFauna/common';
import type { CreatureGallerySource, FaunaLook } from './creatureLayer';

export type FaunaGalleryView = 'gallery' | 'tamed' | 'tamedMid' | 'shoal';

export function faunaGalleryEnabled(search: string): boolean {
    return new URLSearchParams(search).get('faunaGallery') === '1';
}

/** Creature ctor pictureRef per base type (creature.ts). */
function pictureRefOf(t: CreatureType): number {
    return t === CreatureType.RockSpaceSlug ? 0 : t === CreatureType.DesertSpaceSlug ? 1 : t === CreatureType.Kaltor ? 2 : t === CreatureType.Ardilus ? 3 : 4;
}

interface Actor {
    c: Creature;
    look: FaunaLook;
    tamed: boolean;
    ax: number;
    ay: number;
    radius: number;
    omega: number;
    angle0: number;
}

let nextId = 900000;

function standIn(type: CreatureType, size: number, name: string, speed: number): Creature {
    return {
        creatureId: nextId++,
        name,
        type,
        pictureRef: pictureRefOf(type),
        size,
        xpos: 0,
        ypos: 0,
        currentHeading: 0,
        currentSpeed: speed,
        movementSpeed: speed,
        currentTarget: null,
        distanceToTarget: Number.MAX_VALUE,
        damage: 0,
        damageKillThreshold: size * 2,
        attackStrength: 0,
        hasBeenDestroyed: false,
        isVisible: true,
    } as unknown as Creature;
}

export class FaunaGallery implements CreatureGallerySource {
    private actors: Actor[] = [];
    private labels = new Container();
    private viewApplied = false;
    private t0 = -1;
    readonly view: FaunaGalleryView;
    ready = false;

    constructor(private galaxy: Galaxy, world: Container, private camera: Camera, search: string) {
        const v = new URLSearchParams(search).get('faunaView');
        this.view = v === 'tamed' || v === 'tamedMid' || v === 'shoal' ? v : 'gallery';
        this.labels.eventMode = 'none';
        world.addChild(this.labels);
    }

    private build(): boolean {
        const home = this.galaxy.playerEmpire?.capital ?? null;
        if (home === null) return false;
        const ox = home.xpos + home.diameter / 2 + 1200;
        const oy = home.ypos;
        const add = (v: FaunaVariant, dx: number, dy: number, opts: { size?: number; tamed?: boolean; look?: string; label?: boolean; radius?: number } = {}): Actor => {
            const def = faunaVariantDef(v);
            const size = opts.size ?? Math.round((def.sizeMin + def.sizeMax) / 2);
            const c = standIn(def.baseType, size, `${def.name} (gallery)`, def.leaderSpeed);
            const a: Actor = { c, look: { look: opts.look ?? def.look }, tamed: opts.tamed ?? false, ax: ox + dx, ay: oy + dy, radius: opts.radius ?? 25, omega: 0.06 * (this.actors.length % 2 === 0 ? 1 : -1), angle0: this.actors.length * 1.3 };
            this.actors.push(a);
            if (opts.label !== false) {
                const t = new Text({ text: opts.tamed ? `${def.name} (tamed)` : def.name, style: { fill: 0xc8d2dc, fontSize: 14, fontFamily: 'sans-serif' } });
                t.anchor.set(0.5, 0);
                t.position.set(a.ax, a.ay + 150);
                t.alpha = 0.8;
                this.labels.addChild(t);
            }
            return a;
        };
        if (this.view === 'gallery') {
            // All eight variants in one system, a 4 × 2 grid at 100 % zoom.
            const sx = 430;
            const sy = 380;
            const col = (i: number): number => (i - 1.5) * sx;
            add(FaunaVariant.VoidWhale, col(0), -sy / 2);
            add(FaunaVariant.HunterPack, col(1), -sy / 2);
            for (let k = 1; k < 5; k++) add(FaunaVariant.HunterPack, col(1) + Math.cos(k * 1.6) * 60, -sy / 2 + Math.sin(k * 1.6) * 50, { label: false, radius: 18 });
            add(FaunaVariant.HullGrazer, col(2), -sy / 2);
            add(FaunaVariant.StormDrifter, col(3), -sy / 2);
            add(FaunaVariant.LanternShoal, col(0), sy / 2);
            add(FaunaVariant.NestMother, col(1), sy / 2, { radius: 4 });
            for (let k = 0; k < 3; k++) add(FaunaVariant.NestMother, col(1) + Math.cos(k * 2.1) * 140, sy / 2 + Math.sin(k * 2.1) * 110, { label: false, size: 40, look: 'hunter', radius: 30 });
            add(FaunaVariant.Scavenger, col(2), sy / 2);
            add(FaunaVariant.BroodCarrier, col(3), sy / 2);
        } else if (this.view === 'tamed' || this.view === 'tamedMid') {
            add(FaunaVariant.VoidWhale, -40, -60, { tamed: true, size: 1300, radius: 12 });
            add(FaunaVariant.HunterPack, 170, 90, { tamed: true, size: 70, radius: 10 });
            add(FaunaVariant.HunterPack, 110, 130, { tamed: true, size: 60, label: false, radius: 10 });
        } else {
            add(FaunaVariant.LanternShoal, -80, 0, { size: 260, radius: 10 });
            add(FaunaVariant.LanternShoal, 150, 70, { size: 200, radius: 14, label: false });
        }
        return true;
    }

    private applyView(): void {
        if (this.viewApplied || this.actors.length === 0) return;
        this.viewApplied = true;
        const cam = this.camera;
        const cx = this.actors.reduce((a, x) => a + x.ax, 0) / this.actors.length;
        const cy = this.actors.reduce((a, x) => a + x.ay, 0) / this.actors.length;
        if (this.view === 'gallery') {
            cam.centerOn(cx, cy);
            cam.zoom = cam.clampZoom(1);
        } else if (this.view === 'tamedMid') {
            // Play distance: zoom factor 3.
            cam.centerOn(cx, cy);
            cam.zoom = cam.clampZoom(1 / 3);
        } else {
            // Past the game's 100 % limit for the close-ups only (as the whale pilot's close views).
            cam.maxZoom = 3;
            cam.centerOn(cx, cy);
            cam.zoom = cam.clampZoom(this.view === 'tamed' ? 2.6 : 2.2);
        }
        console.log(`[faunaGallery] view ${this.view} camera ${Math.round(cam.x)},${Math.round(cam.y)} zoom ${cam.zoom.toFixed(3)} actors ${this.actors.length}`);
    }

    step(): void {
        if (this.actors.length === 0 && !this.build()) return;
        this.applyView();
        const now = performance.now();
        if (this.t0 < 0) this.t0 = now;
        const t = (now - this.t0) / 1000;
        for (const a of this.actors) {
            const ang = a.angle0 + a.omega * t;
            a.c.xpos = a.ax + Math.cos(ang) * a.radius;
            a.c.ypos = a.ay + Math.sin(ang) * a.radius;
            a.c.currentHeading = ang + (a.omega >= 0 ? Math.PI / 2 : -Math.PI / 2);
        }
        this.ready = true;
    }

    creatures(): readonly Creature[] {
        return this.actors.map((a) => a.c);
    }

    lookOf(c: Creature): FaunaLook | null {
        return this.actors.find((a) => a.c === c)?.look ?? null;
    }

    tamed(c: Creature): boolean {
        return this.actors.find((a) => a.c === c)?.tamed ?? false;
    }

    /** The number of stand-ins (capture readiness). */
    count(): number {
        return this.actors.length;
    }
}
