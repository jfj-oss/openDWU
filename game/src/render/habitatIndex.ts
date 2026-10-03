// Render-side grouping of the habitats by system, for layers that only draw habitats near the view (render-only).
//
// A late 2500-star galaxy has ~84,000 habitats (13,000 planets and moons), and layers such as the combat effects and
// the planetary-shield glow used to walk all of them every frame. Every habitat orbits within its system: its
// committed and drawn positions are the system star plus at most one orbit radius per level of its parent chain, so a
// system whose star is farther from the view than that extent (plus what the layer draws around a habitat) cannot put
// anything on screen. galaxy.habitats is stored system by system in system order, so visiting the visible systems in
// index order visits the visible habitats in exactly galaxy.habitats order (when it is not — never in a generated or
// loaded galaxy — `ordered` is false and callers walk the whole list).

import type { Galaxy } from '../sim/galaxy';
import type { Habitat } from '../sim/types';
import { PlanetaryFacilityType } from '../sim/researchSystem';

export class HabitatSystemIndex {
    /** galaxy.habitats grouped by systemIndex (each group in galaxy.habitats order). */
    bySystem: Habitat[][] = [];
    /** Whether galaxy.habitats is the concatenation of bySystem in system order (else callers use the full list). */
    ordered = false;
    starX = new Float64Array(0);
    starY = new Float64Array(0);
    /** Farthest any habitat of the system can be from its star (sum of the orbit radii up its parent chain, plus the
     * distance of a non-orbiting root from the star), plus that habitat's diameter. */
    extent = new Float64Array(0);
    /** Largest habitat diameter in the system. */
    maxDiameter = new Float64Array(0);
    /** Longest giant ion cannon range (facilities.txt IonCannon components' Value2): how far its shot can fly. */
    giantIonCannonRange = 0;
    private source: readonly Habitat[] | null = null;
    private length = -1;

    /** Rebuild when galaxy.habitats changed (identity or length). */
    ensure(galaxy: Galaxy): void {
        const hs = galaxy.habitats as readonly Habitat[];
        if (hs === this.source && hs.length === this.length) return;
        this.source = hs;
        this.length = hs.length;
        const n = galaxy.systems.length;
        this.bySystem = Array.from({ length: n }, () => []);
        this.starX = new Float64Array(n);
        this.starY = new Float64Array(n);
        this.extent = new Float64Array(n);
        this.maxDiameter = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            const star = galaxy.systems[i].systemStar;
            this.starX[i] = star.xpos;
            this.starY[i] = star.ypos;
        }
        let ordered = true;
        let last = -1;
        for (const h of hs) {
            if (h === null || h === undefined) continue;
            const s = h.systemIndex;
            if (!(s >= 0 && s < n)) {
                ordered = false;
                continue;
            }
            if (s < last) ordered = false;
            last = s;
            this.bySystem[s].push(h);
            let r = 0;
            let root: Habitat = h;
            for (let p: Habitat | null = h; p !== null; p = p.parent) {
                root = p;
                if (p.parent !== null) r += Math.abs(p.orbitDistance);
            }
            r += Math.hypot(root.xpos - this.starX[s], root.ypos - this.starY[s]);
            const d = Math.max(0, h.diameter);
            if (r + d > this.extent[s]) this.extent[s] = r + d;
            if (d > this.maxDiameter[s]) this.maxDiameter[s] = d;
        }
        this.ordered = ordered;
        let gic = 0;
        const facilities = galaxy.researchStatic?.facilities ?? [];
        const byId = galaxy.researchStatic?.componentStatic?.byId;
        for (const f of facilities) {
            if (f.type !== PlanetaryFacilityType.IonCannon) continue;
            const def = byId?.get(f.value1);
            if (def !== undefined && def.value2 > gic) gic = def.value2;
        }
        this.giantIonCannonRange = gic;
    }

    /**
     * Indices (ascending) of the systems whose star lies within extent + diamFactor × maxDiameter + marginWorld of the
     * view rectangle centred at (cx, cy) with half-extents (halfW, halfH). Written to `out` (cleared) and returned.
     */
    visible(cx: number, cy: number, halfW: number, halfH: number, diamFactor: number, marginWorld: number, out: number[]): number[] {
        out.length = 0;
        const n = this.extent.length;
        for (let i = 0; i < n; i++) {
            const r = this.extent[i] + diamFactor * this.maxDiameter[i] + marginWorld;
            const dx = this.starX[i] - cx;
            const dy = this.starY[i] - cy;
            if (dx >= -halfW - r && dx <= halfW + r && dy >= -halfH - r && dy <= halfH + r) out.push(i);
        }
        return out;
    }
}

/** One index per galaxy (shared by the layers of its Main View). */
const indexes = new WeakMap<Galaxy, HabitatSystemIndex>();
export function habitatSystemIndex(galaxy: Galaxy): HabitatSystemIndex {
    let ix = indexes.get(galaxy);
    if (ix === undefined) {
        ix = new HabitatSystemIndex();
        indexes.set(galaxy, ix);
    }
    ix.ensure(galaxy);
    return ix;
}
