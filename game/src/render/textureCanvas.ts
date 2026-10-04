// Canvases and textures for pixels the render layer generates or post-processes (render-only, no sim state).
//
// Every such texture goes through these helpers instead of a default 2D canvas + Texture.from:
// - Chrome backs each GPU-accelerated 2D canvas (any canvas made without willReadFrequently) with a GPU surface — an
//   IOSurface on macOS — for as long as the canvas element lives, i.e. until it is garbage collected, even after its
//   Pixi texture was destroyed. A late save built ~18.8k of them (a placeholder canvas per planet / moon / star view);
//   at ~16k IOSurfaces the GPU process could not allocate another ("Failed to allocate IOSurface" ->
//   "SharedImageStub: Unable to create shared image"), which loses the page's whole GPU channel and every WebGL
//   context on it — restored and lost again every ~5 s (Apple M2, ANGLE Metal). Canvases that only feed a texture
//   upload gain nothing from acceleration, so they are software canvases here, and pixel buffers skip the canvas.
// - Texture.from(canvas) registers the canvas in Pixi's global Cache until the texture is destroyed, so layers that
//   are rebuilt (a game load, a resolution change) left theirs behind.

import { BufferImageSource, CanvasSource, Texture } from 'pixi.js';

/** A software-backed 2D canvas (no GPU surface of its own) for drawing texture pixels. Needs a DOM. */
export function makeTextureCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx === null) throw new Error('textureCanvas: no 2d context');
    return { canvas, ctx };
}

/** A texture over `canvas` (uploaded on first use, re-uploaded after a context restore), outside Pixi's global Cache:
 *  destroying the texture (destroy(true)) is all it takes to release it. */
export function textureFromCanvas(canvas: HTMLCanvasElement | OffscreenCanvas, label?: string): Texture {
    return new Texture({ source: new CanvasSource({ resource: canvas as HTMLCanvasElement }), label });
}

/**
 * A texture from straight-alpha RGBA pixels (`w` x `h`), copied, without a canvas: alpha is premultiplied on upload,
 * as a canvas upload would. `nearest` keeps hard pixel clusters crisp when scaled.
 */
export function textureFromRgbaPixels(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, nearest = false, label?: string): Texture {
    if (rgba.length < w * h * 4) throw new Error(`textureCanvas: ${rgba.length} bytes for ${w}x${h}`);
    const source = new BufferImageSource({
        resource: new Uint8Array(rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + w * h * 4)),
        width: w,
        height: h,
        format: 'rgba8unorm',
        alphaMode: 'premultiply-alpha-on-upload',
        scaleMode: nearest ? 'nearest' : 'linear',
    });
    return new Texture({ source, label });
}
