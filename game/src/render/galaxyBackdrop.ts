// Generated galaxy backdrops in the Main View (Galactic Core, Eerie, Nebula; Original stays the install's image).
// Render-only: reads the galaxy's star positions, shape and seed once, never writes sim state.
//
// Built from our own shaders (galaxyBackdropShaders.ts) over the galaxy structure (galaxyBackdropStructure.ts):
// - the static part is rendered once into a galaxy-space texture sized to the screen (Galactic Core: at least the
//   screen's pixels at whole-galaxy zoom, 4096 at 4K, mipmapped; the soft variants about 1:1, at most 2048 px), in
//   ~1024-row bands one per frame, redrawn only when the variant, the screen size class or the GL context changes;
// - the animated part is rendered into a smaller galaxy-space texture (the screen's short side / 2–2.5, at most
//   1024 px: it is all soft gas, fog and glow) at most 15 times a second, and only while the game runs, the
//   "Animate backdrop" option is on and the backdrop is visible; paused, it holds its last frame;
// - both are sprites stretched over the galaxy rectangle in world space, inside the Main View's backdrop group, so
//   they cross-fade with zoom exactly as the original image does (mainView.ts backdropAlpha on the group).
// The animation clock runs on real time while the game is unpaused, from 0 at the view's start, so a given galaxy
// starts the same way each time; every pattern is seeded from the galaxy seed.
// WebGL only (the game asks for WebGL); on WebGPU or any shader failure the Original image is shown instead.

import { Container, Geometry, GlProgram, Mesh, RenderTexture, Shader, Sprite, Texture, BufferImageSource, UniformGroup, type Renderer } from 'pixi.js';
import { BACKDROP_FRAG, BACKDROP_KIND_CODE, BACKDROP_VERT_PIXI, type GeneratedBackdropKind } from './galaxyBackdropShaders';
import { analyzeGalaxyStructure, DENSITY_SIZE, makeBackdropNoise, NOISE_SIZE, type BackdropStructure } from './galaxyBackdropStructure';
import type { GalaxyBackdropKind } from './galaxyBackdropChoice';
import { GalaxyShape, HabitatCategoryType } from '../sim/types';

/** The galaxy facts the backdrop needs (a Galaxy satisfies it). */
export interface BackdropGalaxy {
    sizeX: number;
    sizeY: number;
    randomSeed: number;
    galaxyShape: GalaxyShape;
    systems: readonly { systemStar: { xpos: number; ypos: number; category: HabitatCategoryType } }[];
}

/** The most animated-texture redraws per second (the motion is slow: well under a texel per redraw at 15 Hz). */
const ANIM_HZ = 15;

function isGenerated(kind: GalaxyBackdropKind): kind is GeneratedBackdropKind {
    return kind in BACKDROP_KIND_CODE;
}

const structures = new WeakMap<BackdropGalaxy, BackdropStructure>();

/** Star positions and structure of a galaxy (computed once per galaxy: the stars never move). */
export function galaxyBackdropStructure(galaxy: BackdropGalaxy): BackdropStructure {
    const known = structures.get(galaxy);
    if (known !== undefined) return known;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const s of galaxy.systems) {
        const star = s.systemStar;
        if (star.category === HabitatCategoryType.GasCloud) continue;
        xs.push(star.xpos);
        ys.push(star.ypos);
    }
    const s = analyzeGalaxyStructure(xs, ys, galaxy.sizeX, galaxy.sizeY, galaxy.galaxyShape, galaxy.randomSeed);
    structures.set(galaxy, s);
    return s;
}

export interface GalaxyBackdropStats {
    /** Static-texture renders so far, and the last one's CPU submit ms. */
    staticRenders: number;
    staticMs: number;
    /** Animated-texture renders so far, and the last one's CPU submit ms. */
    animRenders: number;
    animMs: number;
    staticSize: number;
    animSize: number;
}

export class GalaxyBackdropLayer {
    /** Static + animated sprites over the galaxy rectangle (world space). */
    readonly root = new Container();
    private readonly staticSprite = new Sprite(Texture.EMPTY);
    private readonly animSprite = new Sprite(Texture.EMPTY);
    private kind: GeneratedBackdropKind | null = null;
    private structure: BackdropStructure | null = null;
    private densitySrc: BufferImageSource | null = null;
    private noiseSrc: BufferImageSource | null = null;
    private program: GlProgram | null = null;
    private uniforms: UniformGroup | null = null;
    private shader: Shader | null = null;
    private mesh: Mesh<Geometry, Shader> | null = null;
    private staticRT: RenderTexture | null = null;
    private animRT: RenderTexture | null = null;
    private staticDirty = true;
    private animDirty = true;
    private animTime = 0;
    private sinceAnim = Infinity;
    /** Context-loss detail level (contextLoss.ts): 1 = half-size textures and no animation; 2 = Original only. */
    private lowGpu = 0;
    private failed = false;
    private linkChecked = false;
    /** The next static band to draw (staticBandCount bands; done when equal). */
    private staticBand = 0;
    readonly stats: GalaxyBackdropStats = { staticRenders: 0, staticMs: 0, animRenders: 0, animMs: 0, staticSize: 0, animSize: 0 };

    constructor(
        private readonly renderer: Renderer,
        private readonly galaxy: BackdropGalaxy,
    ) {
        this.root.eventMode = 'none';
        this.root.addChild(this.staticSprite, this.animSprite);
        this.root.visible = false;
    }

    /** Whether the generated backdrop is drawing (else the caller shows the Original image). */
    get active(): boolean {
        return this.kind !== null && !this.failed && this.lowGpu < 2;
    }

    /** Switch variant. Returns whether a generated backdrop is now shown (false: Original / unsupported). */
    setKind(kind: GalaxyBackdropKind): boolean {
        const next = isGenerated(kind) ? kind : null;
        if (next !== this.kind) {
            this.kind = next;
            this.staticDirty = true;
            this.animDirty = true;
            if (next === null) this.releaseTargets();
        }
        if (this.kind !== null && !this.failed) this.ensureResources();
        this.root.visible = this.active;
        return this.active;
    }

    /**
     * Per frame (from MainView.update). `visible`: the backdrop group is on screen (backdropAlpha > 0.01). `dt`: real
     * seconds since the last frame; `running`: the game clock is not paused; `animate`: the "Animate backdrop"
     * option; `screenPx`: the canvas's short and long sides in device px.
     */
    update(visible: boolean, dt: number, running: boolean, animate: boolean, screenShortPx: number, screenLongPx: number): void {
        if (!this.active || this.kind === null) {
            this.root.visible = false;
            return;
        }
        this.root.visible = true;
        if (!visible) return;
        if (this.contextLost()) {
            this.staticDirty = true;
            this.animDirty = true;
            return;
        }
        const half = this.lowGpu >= 1 ? 2 : 1;
        // Static: at least the screen's device pixels across the galaxy at whole-galaxy zoom (where the whole galaxy
        // fits the screen's short side) for the Galactic Core's fine detail (4096 at 4K; mipmapped); the soft
        // variants about 1:1, at most 2048.
        const short = Math.min(screenLongPx, screenShortPx);
        const staticSize =
            this.kind === 'galacticCore'
                ? Math.min(this.maxTextureSize(), 4096, Math.max(512, pow2AtLeast(short))) / half
                : Math.min(2048, Math.max(512, pow2AtLeast(short * 0.9))) / half;
        const animSize = Math.round(Math.min(1024, Math.max(256, screenShortPx / (this.kind === 'nebula' ? 2 : 2.5))) / half);
        if (this.staticRT === null || this.stats.staticSize !== staticSize) {
            this.staticRT?.destroy(true);
            this.staticRT = this.makeTarget(staticSize, this.kind === 'galacticCore');
            this.stats.staticSize = staticSize;
            this.staticDirty = true;
        }
        if (this.animRT === null || Math.abs(this.stats.animSize - animSize) > animSize * 0.2) {
            this.animRT?.destroy(true);
            this.animRT = this.makeTarget(animSize, false);
            this.stats.animSize = animSize;
            this.animDirty = true;
        }
        const moving = running && animate && this.lowGpu === 0;
        if (moving) {
            this.animTime += Math.min(dt, 0.25);
            this.sinceAnim += dt;
        }
        try {
            if (this.staticDirty) {
                this.staticDirty = false;
                this.staticBand = 0;
            }
            // The static texture is drawn one band per frame (a 4096 px pass in one go could stall a weak GPU).
            const bands = staticBandCount(this.staticRT.width);
            if (this.staticBand < bands) {
                this.renderPass(this.staticRT, 0, this.staticBand, bands);
                this.staticBand++;
                this.staticSprite.texture = this.staticRT;
                // Pixi builds a render texture's mips only when it is allocated (empty) and never after a render to
                // it: rebuild them now that the picture is complete, or the minified galaxy view samples black mips.
                if (this.staticBand === bands && this.staticRT.source.autoGenerateMipmaps) this.staticRT.source.updateMipmaps();
            }
            if (this.animDirty || (moving && this.sinceAnim >= 1 / ANIM_HZ - 0.002)) {
                this.renderPass(this.animRT, 1);
                this.animDirty = false;
                this.sinceAnim = 0;
                this.animSprite.texture = this.animRT;
            }
        } catch (err) {
            console.warn('galaxy backdrop: shader failed, showing the original backdrop', err);
            this.fail();
            return;
        }
        this.staticSprite.scale.set(this.galaxy.sizeX / this.staticRT.width, this.galaxy.sizeY / this.staticRT.height);
        this.animSprite.scale.set(this.galaxy.sizeX / this.animRT.width, this.galaxy.sizeY / this.animRT.height);
    }

    /** The GL context came back: render-texture content is gone, so redraw both. */
    onContextRestored(): void {
        this.linkChecked = false;
        this.staticDirty = true;
        this.animDirty = true;
    }

    /** Repeated context losses: level 1 = half-size textures, no animation; level 2 = the Original image. */
    useLowGpuMode(level: number): void {
        this.lowGpu = Math.max(this.lowGpu, level);
        this.releaseTargets();
        this.staticDirty = true;
        this.animDirty = true;
        if (this.lowGpu >= 2) this.root.visible = false;
    }

    /**
     * Dev measurement: GPU ms of one animated pass (and one static pass) at the current sizes, from `n` passes each
     * followed by a 1-pixel read (a GPU sync), less the cost of the read alone.
     */
    benchmark(n = 30): { animMs: number; staticMs: number; animSize: number; staticSize: number } | null {
        const gl = (this.renderer as unknown as { gl?: WebGL2RenderingContext }).gl;
        if (!gl || this.staticRT === null || this.animRT === null) return null;
        // A 1-pixel read waits for the GPU (Chrome's finish() does not).
        const px = new Uint8Array(4);
        const sync = (): void => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const full = (rt: RenderTexture, pass: 0 | 1): void => {
            const bands = pass === 0 ? staticBandCount(rt.width) : 1;
            for (let b = 0; b < bands; b++) this.renderPass(rt, pass, b, bands);
        };
        const time = (rt: RenderTexture, pass: 0 | 1, k: number): number => {
            full(rt, pass);
            sync();
            const t0 = performance.now();
            for (let i = 0; i < k; i++) {
                full(rt, pass);
                sync();
            }
            const t1 = performance.now();
            for (let i = 0; i < k; i++) sync();
            // Minus the cost of the sync itself.
            return Math.max(0, (t1 - t0 - (performance.now() - t1)) / k);
        };
        const animMs = time(this.animRT, 1, n);
        const staticMs = time(this.staticRT, 0, Math.max(3, Math.round(n / 5)));
        return { animMs, staticMs, animSize: this.animRT.width, staticSize: this.staticRT.width };
    }

    destroy(): void {
        try {
            this.releaseTargets();
        } catch {
            /* the renderer may already be gone */
        }
        this.mesh?.destroy();
        this.mesh = null;
        this.shader?.destroy();
        this.shader = null;
        this.densitySrc?.destroy();
        this.noiseSrc?.destroy();
        this.densitySrc = null;
        this.noiseSrc = null;
        this.root.destroy({ children: true });
    }

    // ------------------------------------------------------------------------------------------------------------

    private contextLost(): boolean {
        const gl = (this.renderer as unknown as { gl?: WebGL2RenderingContext }).gl;
        return gl !== undefined && gl.isContextLost();
    }

    private fail(): void {
        this.failed = true;
        this.releaseTargets();
        this.root.visible = false;
    }

    private releaseTargets(): void {
        this.staticSprite.texture = Texture.EMPTY;
        this.animSprite.texture = Texture.EMPTY;
        this.staticRT?.destroy(true);
        this.animRT?.destroy(true);
        this.staticRT = null;
        this.animRT = null;
        this.stats.staticSize = 0;
        this.stats.animSize = 0;
    }

    private makeTarget(size: number, mipmaps: boolean): RenderTexture {
        const rt = RenderTexture.create({ width: size, height: size, resolution: 1, scaleMode: 'linear', format: 'rgba8unorm', autoGenerateMipmaps: mipmaps });
        if (mipmaps) rt.source.maxAnisotropy = 8;
        return rt;
    }

    private maxTextureSize(): number {
        const gl = (this.renderer as unknown as { gl?: WebGL2RenderingContext }).gl;
        const max = gl?.getParameter(gl.MAX_TEXTURE_SIZE) as number | undefined;
        return typeof max === 'number' && max > 0 ? max : 2048;
    }

    private ensureResources(): void {
        if (this.mesh !== null) return;
        if ((this.renderer as { type?: number }).type !== 1 /* RendererType.WEBGL */) {
            this.failed = true;
            return;
        }
        try {
            const s = (this.structure ??= galaxyBackdropStructure(this.galaxy));
            this.densitySrc = new BufferImageSource({
                resource: s.density,
                width: DENSITY_SIZE,
                height: DENSITY_SIZE,
                format: 'rgba8unorm',
                scaleMode: 'linear',
                addressMode: 'clamp-to-edge',
                alphaMode: 'no-premultiply-alpha',
            });
            this.noiseSrc = new BufferImageSource({
                resource: makeBackdropNoise(this.galaxy.randomSeed),
                width: NOISE_SIZE,
                height: NOISE_SIZE,
                format: 'rgba16float',
                scaleMode: 'linear',
                addressMode: 'repeat',
                alphaMode: 'no-premultiply-alpha',
            });
            this.program = GlProgram.from({ vertex: BACKDROP_VERT_PIXI, fragment: BACKDROP_FRAG, name: 'galaxy-backdrop', preferredVertexPrecision: 'highp', preferredFragmentPrecision: 'highp' });
            this.uniforms = new UniformGroup({
                uCentre: { value: new Float32Array(s.centre), type: 'vec2<f32>' },
                uAspect: { value: new Float32Array(s.aspect), type: 'vec2<f32>' },
                uArm: { value: new Float32Array(s.arm), type: 'vec4<f32>' },
                uEll: { value: new Float32Array(s.ell), type: 'vec4<f32>' },
                uMisc: { value: new Float32Array(s.misc), type: 'vec4<f32>' },
                uParams: { value: new Float32Array([0, 0, 0, s.shape]), type: 'vec4<f32>' },
                uBand: { value: new Float32Array([0, 0, 1, 1]), type: 'vec4<f32>' },
            });
            this.shader = new Shader({ glProgram: this.program, resources: { uDensity: this.densitySrc, uNoise: this.noiseSrc, uniforms: this.uniforms } });
            const geometry = new Geometry({
                attributes: { aPosition: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), aUV: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]) },
                indexBuffer: [0, 1, 2, 0, 2, 3],
            });
            this.mesh = new Mesh({ geometry, shader: this.shader });
            this.mesh.state.blendMode = 'none';
        } catch (err) {
            console.warn('galaxy backdrop: setup failed, showing the original backdrop', err);
            this.failed = true;
        }
    }

    /** Draw `pass` into `target`: the whole of it, or horizontal band `band` of `bands`. */
    private renderPass(target: RenderTexture, pass: 0 | 1, band = 0, bands = 1): void {
        if (this.mesh === null || this.uniforms === null || this.kind === null) return;
        const t0 = performance.now();
        const params = this.uniforms.uniforms.uParams as Float32Array;
        params[0] = BACKDROP_KIND_CODE[this.kind];
        params[1] = pass;
        params[2] = this.animTime;
        const rect = this.uniforms.uniforms.uBand as Float32Array;
        rect[0] = 0;
        rect[1] = band / bands;
        rect[2] = 1;
        rect[3] = 1 / bands;
        this.uniforms.update();
        const h = target.height / bands;
        this.mesh.position.set(0, band * h);
        this.mesh.scale.set(target.width, h);
        this.renderer.render({ container: this.mesh, target, clear: band === 0, clearColor: [0, 0, 0, 0] });
        const ms = performance.now() - t0;
        if (pass === 0) {
            this.stats.staticRenders++;
            this.stats.staticMs = ms;
        } else {
            this.stats.animRenders++;
            this.stats.animMs = ms;
        }
        this.assertLinked();
    }

    /** A failed compile / link only logs in Pixi and then draws nothing: throw so the Original image comes back. */
    private assertLinked(): void {
        if (this.program === null || this.linkChecked) return;
        const gl = (this.renderer as unknown as { gl?: WebGL2RenderingContext }).gl;
        const shaderSys = (this.renderer as unknown as { shader?: { _getProgramData?: (p: GlProgram) => { program: WebGLProgram } | undefined } }).shader;
        if (!gl || gl.isContextLost() || typeof shaderSys?._getProgramData !== 'function') return;
        const data = shaderSys._getProgramData(this.program);
        if (data === undefined) return;
        this.linkChecked = true;
        if (gl.getProgramParameter(data.program, gl.LINK_STATUS) === true || gl.isContextLost()) return;
        throw new Error(`galaxy-backdrop: link failed: ${gl.getProgramInfoLog(data.program) ?? ''}`);
    }
}

/** Bands the static texture is drawn in, one per frame: about 1024 rows each. */
function staticBandCount(size: number): number {
    return Math.max(1, Math.round(size / 1024));
}

function pow2AtLeast(v: number): number {
    let p = 1;
    while (p < v) p *= 2;
    return p;
}
