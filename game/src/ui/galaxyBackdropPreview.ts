// Galaxy Backdrop picker thumbnails (new-game wizard, Game Options). UI-only.
//
// Original shows the install's galaxy_backdrop.jpg. The generated variants are drawn by the same fragment shader as
// the Main View (galaxyBackdropShaders.ts, pass 2: static and animated parts in one pass) in a small shared WebGL2
// canvas, then copied into the thumbnail's 2D canvas. In the wizard the galaxy does not exist yet, so the structure
// comes from a synthetic star layout for the chosen shape and seed (galaxyBackdropStructure.ts syntheticStarLayout);
// in a running game it is the real galaxy's. The GL context is released a few seconds after the last thumbnail.

import { BACKDROP_URLS } from '../render/assets';
import { BACKDROP_FRAG, BACKDROP_KIND_CODE, BACKDROP_VERT_RAW } from '../render/galaxyBackdropShaders';
import { analyzeGalaxyStructure, DENSITY_SIZE, makeBackdropNoise, NOISE_SIZE, syntheticStarLayout, type BackdropStructure } from '../render/galaxyBackdropStructure';
import type { GalaxyBackdropKind } from '../render/galaxyBackdropChoice';
import type { GalaxyShape } from '../sim/types';
import { toHalf } from '../render/galaxyBackdropStructure';
import { makeParticleGalaxy, particleStyleOf } from '../render/galaxyBackdrop';
import { splatParticles } from '../render/galaxyParticles';

interface PreviewGl {
    canvas: HTMLCanvasElement;
    gl: WebGL2RenderingContext;
    program: WebGLProgram;
    density: WebGLTexture;
    noise: WebGLTexture;
    /** Particle light, two haze layers, and a 1 px white stand-in (art / unused inputs). */
    light: [WebGLTexture, WebGLTexture, WebGLTexture, WebGLTexture];
    noiseSeed: number | null;
}

let shared: PreviewGl | null = null;
let failed = false;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;
const cache = new Map<string, HTMLCanvasElement>();
/** A running game's structure (one per galaxy: galaxyBackdrop.ts galaxyBackdropStructure) in the cache key, so another
 *  game with the same seed (and so the same caller key) does not get this galaxy's cached thumbnail. */
const structureIds = new WeakMap<BackdropStructure, number>();
let nextStructureId = 1;
function structureId(s: BackdropStructure): number {
    let id = structureIds.get(s);
    if (id === undefined) structureIds.set(s, (id = nextStructureId++));
    return id;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`backdrop preview shader: ${gl.getShaderInfoLog(sh) ?? ''}`);
    return sh;
}

function texture(gl: WebGL2RenderingContext, wrap: number): WebGLTexture {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return t;
}

function context(): PreviewGl | null {
    if (shared !== null && !shared.gl.isContextLost()) return shared;
    shared = null;
    if (failed || typeof document === 'undefined') return null;
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
        if (gl === null) throw new Error('no WebGL2');
        const program = gl.createProgram()!;
        gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, BACKDROP_VERT_RAW));
        gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, BACKDROP_FRAG));
        gl.bindAttribLocation(program, 0, 'aPosition');
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`backdrop preview link: ${gl.getProgramInfoLog(program) ?? ''}`);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        const white = texture(gl, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
        shared = {
            canvas,
            gl,
            program,
            density: texture(gl, gl.CLAMP_TO_EDGE),
            noise: texture(gl, gl.REPEAT),
            noiseSeed: null,
            light: [texture(gl, gl.CLAMP_TO_EDGE), texture(gl, gl.CLAMP_TO_EDGE), texture(gl, gl.CLAMP_TO_EDGE), white],
        };
        return shared;
    } catch (err) {
        console.warn('galaxy backdrop thumbnails unavailable', err);
        failed = true;
        return null;
    }
}

function scheduleRelease(): void {
    if (releaseTimer !== undefined) clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => {
        releaseTimer = undefined;
        shared?.gl.getExtension('WEBGL_lose_context')?.loseContext();
        shared = null;
    }, 4000);
}

/** A float RGB image as RGBA half floats. */
function halfRgba(img: Float32Array): Uint16Array {
    const n = img.length / 3;
    const out = new Uint16Array(n * 4);
    for (let i = 0; i < n; i++) {
        out[i * 4] = toHalf(Math.min(60000, img[i * 3]));
        out[i * 4 + 1] = toHalf(Math.min(60000, img[i * 3 + 1]));
        out[i * 4 + 2] = toHalf(Math.min(60000, img[i * 3 + 2]));
        out[i * 4 + 3] = 0x3c00;
    }
    return out;
}

/** The thumbnail of a generated variant over `structure` (seeded by `seed`), `px` square, or null without WebGL2.
 *  `systems`: the star positions in uv, for the particle-built variants. */
function renderGenerated(kind: keyof typeof BACKDROP_KIND_CODE, structure: BackdropStructure, seed: number, px: number, systems: { us: ArrayLike<number>; vs: ArrayLike<number> }): HTMLCanvasElement | null {
    const ctx = context();
    if (ctx === null) return null;
    const { gl, program, canvas } = ctx;
    canvas.width = px;
    canvas.height = px;
    gl.viewport(0, 0, px, px);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ctx.density);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, DENSITY_SIZE, DENSITY_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, structure.density);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, ctx.noise);
    if (ctx.noiseSeed !== seed) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, NOISE_SIZE, NOISE_SIZE, 0, gl.RGBA, gl.HALF_FLOAT, makeBackdropNoise(seed));
        ctx.noiseSeed = seed;
    }
    const u = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name);
    gl.uniform1i(u('uDensity'), 0);
    gl.uniform1i(u('uNoise'), 1);
    gl.uniform2fv(u('uCentre'), structure.centre);
    gl.uniform2fv(u('uAspect'), structure.aspect);
    gl.uniform4fv(u('uArm'), structure.arm);
    gl.uniform4fv(u('uEll'), structure.ell);
    gl.uniform4fv(u('uMisc'), structure.misc);
    gl.uniform4fv(u('uParams'), [BACKDROP_KIND_CODE[kind], 2, 0, structure.shape]);
    gl.uniform4fv(u('uBand'), [0, 0, 1, 1]);
    // Particle galaxies: the particles splatted on the CPU (light, and the two haze layers).
    const style = particleStyleOf(kind);
    let info = [1, 0, 4, 0];
    if (style !== null) {
        const pg = makeParticleGalaxy(systems.us, systems.vs, structure, style, seed);
        const layers: [number, number][] = [[px, 0.7], [Math.max(8, Math.round(px / 4)), 3.5], [Math.max(4, Math.round(px / 16)), 2.5]];
        layers.forEach(([size, minR], i) => {
            const img = splatParticles(pg.particles, size, 1, minR);
            gl.activeTexture(gl.TEXTURE2 + i);
            gl.bindTexture(gl.TEXTURE_2D, ctx.light[i]);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, size, size, 0, gl.RGBA, gl.HALF_FLOAT, halfRgba(img));
        });
        info = [1, style === 'goldenSpiral' ? 1 : 0, pg.wind, pg.phase];
    } else {
        for (let i = 0; i < 3; i++) {
            gl.activeTexture(gl.TEXTURE2 + i);
            gl.bindTexture(gl.TEXTURE_2D, ctx.light[3]);
        }
    }
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, ctx.light[3]);
    gl.uniform1i(u('uPart'), 2);
    gl.uniform1i(u('uHaze1'), 3);
    gl.uniform1i(u('uHaze2'), 4);
    gl.uniform1i(u('uArt'), 5);
    gl.uniform4fv(u('uPartInfo'), info);
    gl.uniform4fv(u('uPartInfo2'), [0, 0, 0, 0]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const out = document.createElement('canvas');
    out.width = px;
    out.height = px;
    out.getContext('2d')?.drawImage(canvas, 0, 0);
    scheduleRelease();
    return out;
}

/** What a thumbnail draws: the kind, and the galaxy (a running game's) or the shape + seed (the wizard's). */
export type BackdropPreviewSource =
    | { kind: GalaxyBackdropKind; shape: GalaxyShape; seed: number }
    | { kind: GalaxyBackdropKind; structure: BackdropStructure; systems: { us: ArrayLike<number>; vs: ArrayLike<number> }; seed: number; key: string };

/** A picker thumbnail (`size` css px square): call update() with the current choice. */
export function createBackdropThumbnail(size: number, className = ''): { el: HTMLDivElement; update: (src: BackdropPreviewSource) => void } {
    const el = document.createElement('div');
    el.className = `galaxy-backdrop-thumb ${className}`.trim();
    Object.assign(el.style, { width: `${size}px`, height: `${size}px`, background: '#000', border: '1px solid rgba(120,140,170,0.6)', overflow: 'hidden', boxSizing: 'border-box' });
    const img = document.createElement('img');
    img.alt = 'Original';
    Object.assign(img.style, { width: '100%', height: '100%', objectFit: 'cover', display: 'none' });
    img.addEventListener('error', () => (img.style.visibility = 'hidden'));
    const canvas = document.createElement('canvas');
    Object.assign(canvas.style, { width: '100%', height: '100%', display: 'none' });
    el.append(img, canvas);
    const px = Math.round(size * Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1)));
    let lastKey = '';
    const update = (src: BackdropPreviewSource): void => {
        const kind = src.kind;
        if (kind === 'original') {
            if (img.getAttribute('src') === null) img.src = BACKDROP_URLS[0];
            img.style.display = 'block';
            canvas.style.display = 'none';
            lastKey = 'original';
            return;
        }
        img.style.display = 'none';
        canvas.style.display = 'block';
        const key = 'structure' in src ? `${kind}|${src.key}#${structureId(src.structure)}|${px}` : `${kind}|${src.shape}|${src.seed}|${px}`;
        if (key === lastKey) return;
        lastKey = key;
        let pic = cache.get(key) ?? null;
        if (pic === null) {
            let structure: BackdropStructure;
            let systems: { us: ArrayLike<number>; vs: ArrayLike<number> };
            if ('structure' in src) {
                structure = src.structure;
                systems = src.systems;
            } else {
                const pts = syntheticStarLayout(src.shape, src.seed);
                structure = analyzeGalaxyStructure(pts.xs, pts.ys, 1, 1, src.shape, src.seed);
                systems = { us: pts.xs, vs: pts.ys };
            }
            pic = renderGenerated(kind, structure, src.seed, px, systems);
            if (pic !== null) {
                if (cache.size > 24) cache.delete(cache.keys().next().value as string);
                cache.set(key, pic);
            }
        }
        canvas.width = px;
        canvas.height = px;
        const g = canvas.getContext('2d');
        if (g === null) return;
        g.fillStyle = '#000';
        g.fillRect(0, 0, px, px);
        if (pic !== null) g.drawImage(pic, 0, 0);
    };
    return { el, update };
}
