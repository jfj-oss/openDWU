// Page-side helper of scripts/colorprofile-verify.mjs (dev server only: imported in the page by URL, so Vite resolves
// pixi.js to the same pre-bundled module as the game). Decodes an original image through the game's Pixi paths and
// returns the texels Pixi uploaded, read back from the GPU (premultiplied RGBA, row 0 = top):
//   'assets' — AssetStore.loadFirst, i.e. Pixi Assets.load (worker createImageBitmap, premultiply on upload): ships,
//              bases, planets, stars, asteroids, effects, fighters, the canvas chrome;
//   'img'    — an HTMLImageElement wrapped with Texture.from (the layers that decode with new Image(): creatures,
//              fauna, galaxy markers, overlays, ambient layer);
//   'raw'    — AssetStore.loadRawImage (createImageBitmap with colorSpaceConversion 'none'): the starfield flares.
import { Application, Texture } from 'pixi.js';
import { AssetStore } from '../src/render/assets';

let appPromise: Promise<Application> | null = null;
const store = new AssetStore(true);

function getApp(): Promise<Application> {
    appPromise ??= (async () => {
        const app = new Application();
        await app.init({ width: 8, height: 8, preference: 'webgl', backgroundAlpha: 0, antialias: false });
        return app;
    })();
    return appPromise;
}

function toBase64(px: Uint8ClampedArray | Uint8Array): string {
    let s = '';
    for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode(...px.subarray(i, i + 0x8000));
    return btoa(s);
}

function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error(`image load failed: ${url}`));
        el.src = url;
    });
}

export async function pixiPixels(url: string, mode: 'assets' | 'img' | 'raw'): Promise<{ w: number; h: number; b64: string } | { error: string }> {
    try {
        const app = await getApp();
        let tex: Texture;
        if (mode === 'assets') {
            tex = await store.loadFirst([url], () => Texture.EMPTY);
            if (tex === Texture.EMPTY) return { error: 'Assets.load failed' };
        } else if (mode === 'img') {
            tex = Texture.from(await loadImage(url));
        } else {
            const bmp = await store.loadRawImage(url);
            if (bmp === null) return { error: 'loadRawImage failed' };
            tex = Texture.from(bmp);
        }
        const { pixels, width, height } = app.renderer.extract.pixels(tex);
        return { w: width, h: height, b64: toBase64(pixels) };
    } catch (e) {
        return { error: String(e instanceof Error ? e.message : e) };
    }
}
