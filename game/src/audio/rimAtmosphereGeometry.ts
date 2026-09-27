// 19i "Rim atmosphere" data/wiring — the one place the audio package reads the render layer's rim curve
// (rimParams/rimGeometry/rimFraction/rimWeight, src/render/rimAtmosphereLayer.ts — consumed only; a sibling package
// is reworking that file's dust lanes, so it is not edited here). Kept separate from rimAtmosphereMix.ts (the pure
// mood/gain functions) so musicPlayer.ts can use those without pulling pixi.js into a file that also runs before any
// galaxy exists (the main-menu theme).
//
// rimWeightAt mirrors RimAtmosphereLayer's own constructor (galaxy.systems → star positions → rimGeometry once per
// galaxy) rather than needing a live render-layer/mainView instance; the result is cached per Galaxy.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { rimFraction, rimGeometry, rimParams, rimWeight, type RimGeometry, type RimParams } from '../render/rimAtmosphereLayer';

const geometryCache = new WeakMap<Galaxy, { params: RimParams; geo: RimGeometry } | null>();

function geometryFor(galaxy: Galaxy): { params: RimParams; geo: RimGeometry } | null {
    if (geometryCache.has(galaxy)) return geometryCache.get(galaxy) ?? null;
    const params = rimParams(galaxy);
    if (params === null) {
        geometryCache.set(galaxy, null);
        return null;
    }
    const stars: { xpos: number; ypos: number }[] = [];
    for (const s of galaxy.systems) if (s.systemStar) stars.push(s.systemStar);
    const entry = { params, geo: rimGeometry(galaxy.sizeX, galaxy.sizeY, stars) };
    geometryCache.set(galaxy, entry);
    return entry;
}

/** Rim weight (0..1) at a world point; 0 with the flag off or no scenario. The music selector reads this at the
 *  camera centre (item 8); the ambient bed and the voice-static hook (item 9/10) read it at the camera and/or a
 *  capital. */
export function rimWeightAt(galaxy: Galaxy, x: number, y: number): number {
    const e = geometryFor(galaxy);
    return e === null ? 0 : rimWeight(rimFraction(e.geo, x, y), e.params.rimInner);
}

/** rimWeightAt at `empire`'s capital, or 0 with no capital (e.g. eliminated / not yet founded). */
export function rimWeightAtCapital(galaxy: Galaxy, empire: Empire | null): number {
    const capital = empire?.capital ?? null;
    return capital === null ? 0 : rimWeightAt(galaxy, capital.xpos, capital.ypos);
}

/** Test hook: drop a galaxy's cached geometry (tests that reuse a mock Galaxy object across scenarios). */
export function resetRimAudioGeometryCache(galaxy: Galaxy): void {
    geometryCache.delete(galaxy);
}
