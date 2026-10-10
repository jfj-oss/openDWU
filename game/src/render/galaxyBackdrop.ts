// Generated galaxy backdrops in the Main View (Galactic Core, Golden Spiral, Eerie, Nebula; Original stays the
// install's image). Galactic Core and Golden Spiral are particle-built (galaxyParticles.ts): light particles around every
// star system drawn additively (instanced) into band light targets and two haze layers, then composited with dust;
// an optional colour / dust art texture can be fed in (setArtTexture). Eerie and Nebula are procedural shaders.
// Render-only: reads the galaxy's star positions, shape and seed once, never writes sim state.
//
// Built from our own shaders (galaxyBackdropShaders.ts) over the galaxy structure (galaxyBackdropStructure.ts):
// - the static part is rendered once into a galaxy-space texture sized to the screen (Galactic Core: at least the
//   screen's pixels at whole-galaxy zoom, 4096 at 4K, mipmapped; the soft variants about 1:1, at most 2048 px), in
//   ~1024-row bands one per frame, redrawn only when the variant, the screen size class or the GL context changes;
// - the animated part is rendered into a smaller galaxy-space texture (the screen's short side / 2–2.5, at most
//   1024 px: it is all soft gas, fog and glow) at most 15 times a second, and only while the game runs, the
//   "Animate backdrop" option is on and the backdrop is visible (30 times a second while a storm flash is lit,
//   galaxyBackdropFlashes.ts; "Storm flashes" option); paused, it holds its last frame;
// - both are sprites stretched over the galaxy rectangle in world space, inside the Main View's backdrop group, so
//   they cross-fade with zoom exactly as the original image does (mainView.ts backdropAlpha on the group).
// The animation clock runs on real time while the game is unpaused, from 0 at the view's start, so a given galaxy
// starts the same way each time; every pattern is seeded from the galaxy seed.
// WebGL only (the game asks for WebGL); on WebGPU or any shader failure the Original image is shown instead.

import { Container, Geometry, GlProgram, Mesh, RenderTexture, Shader, Sprite, Texture, BufferImageSource, UniformGroup, type Renderer } from 'pixi.js';
import { BACKDROP_FRAG, BACKDROP_KIND_CODE, BACKDROP_VERT_PIXI, PARTICLE_FRAG, PARTICLE_VERT, type GeneratedBackdropKind } from './galaxyBackdropShaders';
import { buildGalaxyParticles, fitArmPhase, particleWind, type GalaxyParticles, type ParticleStyle } from './galaxyParticles';
import type { TextureSource } from 'pixi.js';
import { analyzeGalaxyStructure, DENSITY_SIZE, makeBackdropNoise, NOISE_SIZE, type BackdropStructure } from './galaxyBackdropStructure';
import type { GalaxyBackdropKind } from './galaxyBackdropChoice';
import { GalaxyShape, HabitatCategoryType } from '../sim/types';
import { computeStormFlashes, MAX_FLASHES } from './galaxyBackdropFlashes';

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
/** While a storm flash is lit: fast enough for its 0.1 s rise and flickers. */
const FLASH_HZ = 30;

function isGenerated(kind: GalaxyBackdropKind): kind is GeneratedBackdropKind {
    return kind in BACKDROP_KIND_CODE;
}

const structures = new WeakMap<BackdropGalaxy, BackdropStructure>();

/** The particle style of a kind (the particle-built galaxies), or null. */
export function particleStyleOf(kind: GalaxyBackdropKind | null): ParticleStyle | null {
    return kind === 'galacticCore' || kind === 'goldenSpiral' ? kind : null;
}

/** The systems' star positions in galaxy uv (gas clouds left out). */
export function systemUvs(galaxy: BackdropGalaxy): { us: Float64Array; vs: Float64Array } {
    const list = galaxy.systems.filter((s) => s.systemStar.category !== HabitatCategoryType.GasCloud);
    const us = new Float64Array(list.length);
    const vs = new Float64Array(list.length);
    list.forEach((s, i) => {
        us[i] = s.systemStar.xpos / Math.max(1, galaxy.sizeX);
        vs[i] = s.systemStar.ypos / Math.max(1, galaxy.sizeY);
    });
    return { us, vs };
}

/** The particle galaxy of a style over these systems (with its winding and fitted arm phase). */
export function makeParticleGalaxy(us: ArrayLike<number>, vs: ArrayLike<number>, s: BackdropStructure, style: ParticleStyle, seed: number): { particles: GalaxyParticles; wind: number; phase: number } {
    const wind = particleWind(style, s);
    const phase = fitArmPhase(s, s.arm[0], wind);
    return { particles: buildGalaxyParticles(us, vs, s, style, seed, phase), wind, phase };
}

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
    /** Storm flashes lit in the last animated frame. */
    private flashCount = 0;
    // Particle galaxies: the particles (per style), their instanced meshes, light targets (one band at a time, and
    // two haze layers) and the decode scale of the light (8-bit targets store it scaled down).
    private particleCache = new Map<ParticleStyle, { particles: GalaxyParticles; wind: number; phase: number }>();
    private particleStyle: ParticleStyle | null = null;
    private particleProgram: GlProgram | null = null;
    private pUniforms: UniformGroup | null = null;
    private pOut: UniformGroup | null = null;
    private particleMesh: Mesh<Geometry, Shader> | null = null;
    private twinkleMesh: Mesh<Geometry, Shader> | null = null;
    private bandRT: RenderTexture | null = null;
    private haze1: RenderTexture | null = null;
    private haze2: RenderTexture | null = null;
    private hazeDone = false;
    private lightFormat: 'rgba16float' | 'rgba8unorm' = 'rgba8unorm';
    private dummySrc: BufferImageSource | null = null;
    /** Optional colour / dust art for the particle galaxies (rgb colour, a dust) and its mix (0 = none). */
    private artSrc: TextureSource | null = null;
    private artMix = 0;
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
            this.releaseTargets();
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
    update(visible: boolean, dt: number, running: boolean, animate: boolean, screenShortPx: number, screenLongPx: number, flashes = true): void {
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
        const style = particleStyleOf(this.kind);
        const staticSize =
            style !== null
                ? Math.min(this.maxTextureSize(), 4096, Math.max(512, pow2AtLeast(short))) / half
                : Math.min(2048, Math.max(512, pow2AtLeast(short * 0.9))) / half;
        const animSize = Math.round(Math.min(1024, Math.max(256, screenShortPx / (this.kind === 'nebula' ? 2 : 2.5))) / half);
        if (this.staticRT === null || this.stats.staticSize !== staticSize) {
            this.staticRT?.destroy(true);
            this.staticRT = this.makeTarget(staticSize, style !== null);
            this.stats.staticSize = staticSize;
            this.hazeDone = false;
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
                if (style !== null) this.renderParticleBand(style, this.staticRT, this.staticBand, bands);
                this.renderPass(this.staticRT, 0, this.staticBand, bands);
                this.staticBand++;
                this.staticSprite.texture = this.staticRT;
                // Pixi builds a render texture's mips only when it is allocated (empty) and never after a render to
                // it: rebuild them now that the picture is complete, or the minified galaxy view samples black mips.
                if (this.staticBand === bands && this.staticRT.source.autoGenerateMipmaps) this.staticRT.source.updateMipmaps();
                if (this.staticBand === bands) {
                    // The band light target is only needed while drawing.
                    this.unbindLight('part');
                    this.bandRT?.destroy(true);
                    this.bandRT = null;
                }
            }
            const hz = this.flashCount > 0 ? FLASH_HZ : ANIM_HZ;
            if (this.animDirty || (moving && this.sinceAnim >= 1 / hz - 0.002)) {
                const fl = this.uniforms?.uniforms.uFlash as Float32Array | undefined;
                if (fl !== undefined) {
                    // (Paused, the frame holds whatever was lit at the frozen clock.)
                    if (animate && flashes && this.lowGpu === 0) this.flashCount = computeStormFlashes(this.galaxy.randomSeed, this.animTime, fl);
                    else if (this.flashCount > 0 || !flashes) {
                        fl.fill(0);
                        this.flashCount = 0;
                    }
                }
                this.renderPass(this.animRT, 1);
                if (style !== null && moving) this.renderTwinkle(this.animRT);
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

    /**
     * Optional colour / dust art for the particle galaxies (e.g. a generated texture image: rgb colour, alpha dust,
     * over the galaxy rectangle), mixed in by `mix` (0..1); null = none.
     */
    setArtTexture(src: TextureSource | null, mix = 1): void {
        this.artSrc = src;
        this.artMix = src === null ? 0 : Math.min(1, Math.max(0, mix));
        if (this.shader !== null && this.dummySrc !== null) this.shader.resources.uArt = src ?? this.dummySrc;
        this.staticDirty = true;
    }

    /** Set the animation clock (s): the dev hook ?backdropTime=. */
    setAnimTime(t: number): void {
        this.animTime = t;
        this.animDirty = true;
    }

    /** The GL context came back: render-texture content is gone, so redraw both. */
    onContextRestored(): void {
        this.linkChecked = false;
        this.hazeDone = false;
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
        this.particleMesh?.destroy();
        this.twinkleMesh?.destroy();
        this.particleMesh = null;
        this.twinkleMesh = null;
        this.dummySrc?.destroy();
        this.dummySrc = null;
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

    /** Point the composite shader's light inputs at the dummy (before their textures are destroyed). */
    private unbindLight(which: 'part' | 'all'): void {
        if (this.shader === null || this.dummySrc === null) return;
        this.shader.resources.uPart = this.dummySrc;
        if (which === 'all') {
            this.shader.resources.uHaze1 = this.dummySrc;
            this.shader.resources.uHaze2 = this.dummySrc;
        }
    }

    private releaseTargets(): void {
        this.unbindLight('all');
        this.bandRT?.destroy(true);
        this.haze1?.destroy(true);
        this.haze2?.destroy(true);
        this.bandRT = null;
        this.haze1 = null;
        this.haze2 = null;
        this.hazeDone = false;
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
                uFlash: { value: new Float32Array(MAX_FLASHES * 4), type: 'vec4<f32>', size: MAX_FLASHES },
                uPartInfo: { value: new Float32Array([1, 0, 4, 0]), type: 'vec4<f32>' },
                uPartInfo2: { value: new Float32Array([0, 0, 0, 0]), type: 'vec4<f32>' },
            });
            this.dummySrc = new BufferImageSource({ resource: new Uint8Array([255, 255, 255, 255]), width: 1, height: 1, format: 'rgba8unorm', alphaMode: 'no-premultiply-alpha' });
            this.shader = new Shader({
                glProgram: this.program,
                resources: {
                    uDensity: this.densitySrc,
                    uNoise: this.noiseSrc,
                    uPart: this.dummySrc,
                    uHaze1: this.dummySrc,
                    uHaze2: this.dummySrc,
                    uArt: this.artSrc ?? this.dummySrc,
                    uniforms: this.uniforms,
                },
            });
            const gl = (this.renderer as unknown as { gl?: WebGL2RenderingContext }).gl;
            this.lightFormat = gl?.getExtension('EXT_color_buffer_float') ? 'rgba16float' : 'rgba8unorm';
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
        const info = this.uniforms.uniforms.uPartInfo as Float32Array;
        const pg = this.particleStyle !== null ? this.particleCache.get(this.particleStyle) : undefined;
        info[0] = this.lightFormat === 'rgba16float' ? 1 : 4;
        info[1] = this.particleStyle === 'goldenSpiral' ? 1 : 0;
        info[2] = pg?.wind ?? 4;
        info[3] = pg?.phase ?? 0;
        (this.uniforms.uniforms.uPartInfo2 as Float32Array)[0] = this.artMix;
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

    /** The particle meshes for `style` (built on first use: particles from the real systems). */
    private ensureParticles(style: ParticleStyle): void {
        if (this.particleStyle === style && this.particleMesh !== null) return;
        const s = (this.structure ??= galaxyBackdropStructure(this.galaxy));
        let pg = this.particleCache.get(style);
        if (pg === undefined) {
            const { us, vs } = systemUvs(this.galaxy);
            pg = makeParticleGalaxy(us, vs, s, style, this.galaxy.randomSeed);
            this.particleCache.set(style, pg);
        }
        this.particleMesh?.destroy();
        this.twinkleMesh?.destroy();
        this.particleProgram ??= GlProgram.from({ vertex: PARTICLE_VERT, fragment: PARTICLE_FRAG, name: 'galaxy-particles', preferredVertexPrecision: 'highp', preferredFragmentPrecision: 'highp' });
        this.pUniforms ??= new UniformGroup({
            uPBand: { value: new Float32Array([0, 0, 1, 1]), type: 'vec4<f32>' },
            uPTarget: { value: new Float32Array([1, 1, 1, 0.7]), type: 'vec4<f32>' },
            uPTime: { value: new Float32Array([0, 0, 0, 0]), type: 'vec4<f32>' },
        });
        this.pOut ??= new UniformGroup({ uPOut: { value: new Float32Array([1, 0, 0, 0]), type: 'vec4<f32>' } });
        const make = (idx: Uint32Array | null): Mesh<Geometry, Shader> => {
            const p = pg.particles;
            const n = idx === null ? p.count : idx.length;
            const center = new Float32Array(n * 2);
            const size = new Float32Array(n);
            const color = new Float32Array(n * 3);
            const phase = new Float32Array(n);
            for (let k = 0; k < n; k++) {
                const i = idx === null ? k : idx[k];
                center[k * 2] = p.center[i * 2];
                center[k * 2 + 1] = p.center[i * 2 + 1];
                size[k] = p.size[i];
                color[k * 3] = p.color[i * 3];
                color[k * 3 + 1] = p.color[i * 3 + 1];
                color[k * 3 + 2] = p.color[i * 3 + 2];
                phase[k] = p.phase[i];
            }
            const geometry = new Geometry({
                attributes: {
                    aPosition: { buffer: new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), format: 'float32x2' },
                    aCenter: { buffer: center, format: 'float32x2', instance: true },
                    aSize: { buffer: size, format: 'float32', instance: true },
                    aColor: { buffer: color, format: 'float32x3', instance: true },
                    aPhase: { buffer: phase, format: 'float32', instance: true },
                },
                indexBuffer: [0, 1, 2, 0, 2, 3],
                instanceCount: n,
            });
            const shader = new Shader({ glProgram: this.particleProgram!, resources: { pv: this.pUniforms!, pf: this.pOut! } });
            const mesh = new Mesh({ geometry, shader });
            mesh.state.blendMode = 'add';
            return mesh;
        };
        this.particleMesh = make(null);
        this.twinkleMesh = make(pg.particles.twinkle);
        this.particleStyle = style;
    }

    /** Draw `mesh`'s particles into `target`, covering galaxy uv rows [v0, v0 + dv), at `scale` target px per
     *  2048-texture px, at least `minRadius` px, optionally as twinkles. */
    private drawParticles(mesh: Mesh<Geometry, Shader>, target: RenderTexture, v0: number, dv: number, scale: number, minRadius: number, clear: boolean, twinkle: boolean): void {
        const band = this.pUniforms!.uniforms.uPBand as Float32Array;
        band[0] = 0;
        band[1] = v0;
        band[2] = 1;
        band[3] = dv;
        const tg = this.pUniforms!.uniforms.uPTarget as Float32Array;
        tg[0] = target.width;
        tg[1] = target.height;
        tg[2] = scale;
        tg[3] = minRadius;
        const tm = this.pUniforms!.uniforms.uPTime as Float32Array;
        tm[0] = this.animTime;
        tm[1] = twinkle ? 1 : 0;
        this.pUniforms!.update();
        (this.pOut!.uniforms.uPOut as Float32Array)[0] = this.lightFormat === 'rgba16float' || twinkle ? 1 : 0.25;
        this.pOut!.update();
        this.renderer.render({ container: mesh, target, clear, clearColor: [0, 0, 0, 0] });
    }

    /** The particle light of static band `band` (and, first, the two haze layers), bound for the composite pass. */
    private renderParticleBand(style: ParticleStyle, staticRT: RenderTexture, band: number, bands: number): void {
        this.ensureParticles(style);
        if (this.particleMesh === null || this.shader === null) return;
        const size = staticRT.width;
        if (!this.hazeDone || this.haze1 === null || this.haze2 === null) {
            const h1 = Math.max(128, Math.min(1024, size / 4));
            this.unbindLight('all');
            this.haze1?.destroy(true);
            this.haze2?.destroy(true);
            this.haze1 = RenderTexture.create({ width: h1, height: h1, resolution: 1, scaleMode: 'linear', format: this.lightFormat });
            this.haze2 = RenderTexture.create({ width: h1 / 4, height: h1 / 4, resolution: 1, scaleMode: 'linear', format: this.lightFormat });
            // The unresolved light: the same particles, soft, at two scales.
            this.drawParticles(this.particleMesh, this.haze1, 0, 1, h1 / 2048, 3.5, true, false);
            this.drawParticles(this.particleMesh, this.haze2, 0, 1, h1 / 4 / 2048, 2.5, true, false);
            this.shader.resources.uHaze1 = this.haze1.source;
            this.shader.resources.uHaze2 = this.haze2.source;
            this.hazeDone = true;
        }
        const bh = Math.round(size / bands);
        if (this.bandRT === null || this.bandRT.width !== size || this.bandRT.height !== bh) {
            this.unbindLight('part');
            this.bandRT?.destroy(true);
            this.bandRT = RenderTexture.create({ width: size, height: bh, resolution: 1, scaleMode: 'linear', format: this.lightFormat });
        }
        this.drawParticles(this.particleMesh, this.bandRT, band / bands, 1 / bands, size / 2048, 0.7, true, false);
        this.shader.resources.uPart = this.bandRT.source;
    }

    /** Twinkling particles over the animated texture (additive). */
    private renderTwinkle(animRT: RenderTexture): void {
        if (this.twinkleMesh === null) return;
        this.drawParticles(this.twinkleMesh, animRT, 0, 1, animRT.width / 2048, 0.8, false, true);
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
