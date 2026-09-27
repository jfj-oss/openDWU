// 19g-7b new fauna art: loads the ORIGINAL palette frames (creature frame 0s and the freighter) from the install at runtime,
// measures them (creatureRig.ts paletteSourceFromRgba) and builds each variant's body textures on first use, plus the
// harness container / work-light textures and the lantern mote. Nothing from the original is written anywhere; without
// an install a neutral palette stands in.

import type { Texture } from 'pixi.js';
import {
    CONTAINER_PALETTE_FRAME,
    FAUNA_BODIES,
    PALETTE_FRAMES,
    bodyTextures,
    containerRgba,
    dotRgba,
    fallbackPaletteSource,
    paletteSourceFromRgba,
    plainRamp,
    rasterBody,
    textureFromRgba,
    type BodyTextures,
    type PaletteFrame,
    type PaletteSource,
} from './creatureRig';

const IMAGES = '/assets/dwu/images/units';

function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`faunaArt: cannot load ${url}`));
        img.src = url;
    });
}

function pixelsOf(img: HTMLImageElement): { data: Uint8ClampedArray; w: number; h: number } {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (ctx === null) throw new Error('faunaArt: no 2d context');
    ctx.drawImage(img, 0, 0);
    return { data: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
}

export class FaunaArt {
    ready = false;
    private sources = new Map<PaletteFrame, PaletteSource>();
    private containerSource: PaletteSource | null = null;
    private bodies = new Map<string, BodyTextures>();
    containers: Texture[] = [];
    light: Texture | null = null;
    mote: Texture | null = null;

    constructor(dwuPresent: boolean) {
        const done = (): void => {
            const ramp = plainRamp(this.containerSource ?? fallbackPaletteSource());
            this.containers = [0, 1, 2].map((k) => textureFromRgba(containerRgba(ramp, 48, 28, k)));
            this.light = textureFromRgba(dotRgba(32, [255, 236, 200], [255, 150, 60]));
            this.mote = textureFromRgba(dotRgba(32, [255, 255, 240], [255, 190, 90]));
            this.ready = true;
        };
        if (!dwuPresent) {
            done();
            return;
        }
        const frames = Object.entries(PALETTE_FRAMES) as [PaletteFrame, string][];
        Promise.all([
            ...frames.map(([k, rel]) =>
                loadImage(`${IMAGES}/creatures/${rel}`).then((img) => {
                    const p = pixelsOf(img);
                    this.sources.set(k, paletteSourceFromRgba(p.data, p.w, p.h));
                }),
            ),
            loadImage(`${IMAGES}/${CONTAINER_PALETTE_FRAME}`).then((img) => {
                const p = pixelsOf(img);
                this.containerSource = paletteSourceFromRgba(p.data, p.w, p.h);
            }),
        ])
            .catch((e) => console.warn('[newFauna] palette frames', e))
            .finally(done);
    }

    /** A variant body's textures (built on first request once the palettes are in), or null. */
    body(look: string): BodyTextures | null {
        if (!this.ready) return null;
        const got = this.bodies.get(look);
        if (got !== undefined) return got;
        const def = FAUNA_BODIES[look];
        if (def === undefined) return null;
        const t = bodyTextures(rasterBody(def, this.sources.get(def.palette.frame) ?? fallbackPaletteSource()));
        this.bodies.set(look, t);
        return t;
    }
}
