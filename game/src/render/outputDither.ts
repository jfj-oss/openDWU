// Output dithering for the Pixi canvas (anti-banding).
//
// The WebGL canvas back buffer is 8 bits per channel (WebGL cannot ask for a deeper drawing buffer; Pixi's
// Application has no such option either — only an explicit float render target + a final resolve pass would carry
// more precision, at a full-screen 4K half-float pass per frame). Smooth, dark, low-alpha gradients — the system
// nebula haze, the deep-starfield colour patches, star coronas, territory / presence washes — therefore quantise to a
// few dozen steps and show as bands, however good the display is (a 10/12-bit panel can only show the steps it gets).
//
// Fix: dither at the point of quantisation. The fragment shaders that draw almost everything in the Main View (the
// default sprite/mesh batcher and the Graphics pipe) add triangular-PDF noise of ±1 8-bit step (zero mean) to the
// premultiplied colour just before it is blended and stored. The blended result then rounds up or down in
// proportion to its exact value, so a slow gradient becomes fine static noise around the true level instead of flat
// steps — the classic fix, invisible at 4K (±1/255). Brightness is unchanged (zero-mean; only a tiny positive bias
// where colour is clamped at 0). Fragments with no colour and no coverage (transparent sprite corners) get no noise,
// so quads never show as faint rectangles. The pattern is fixed in screen space (gl_FragCoord), so still frames
// don't shimmer.
//
// Cost: a handful of ALU ops per fragment in shaders that are texture-fetch / blend bound — not measurable
// (scripts/perf-render.mjs --gpu=egl --paused --uncapped --qs=dither=0|1 at 3840×2160: frame ms equal within run-to-run
// noise at galaxy and system zoom). WebGL only: under WebGPU the stock WGSL is used.
// Toggle: Settings → "Dither gradients" (UiSettings.ditherGradients, default on), applied live via setOutputDither.
//
// Render-only; no sim state.

import {
    colorBit,
    colorBitGl,
    compileHighShaderGlProgram,
    compileHighShaderGpuProgram,
    DefaultBatcher,
    extensions,
    ExtensionType,
    generateTextureBatchBit,
    generateTextureBatchBitGl,
    getBatchSamplersUniformGroup,
    localUniformBitGl,
    roundPixelsBit,
    roundPixelsBitGl,
    Shader,
    UniformGroup,
    Matrix,
    type BatcherOptions,
    type Renderer,
} from 'pixi.js';

/** GLSL: screen-space TPDF dither of the premultiplied output (`finalColor`), ±1 step of an 8-bit target. */
export const ditherBitGl = {
    name: 'dwu-output-dither-bit',
    fragment: {
        header: /* glsl */ `
            // Hoskins hash12 (no sin: stable at large gl_FragCoord on every GPU). In highp: Pixi's batch shaders
            // default to mediump, which Apple GPUs (ANGLE Metal) may run as 16-bit floats — exact only up to 2048, so
            // the pixel coordinate of a Retina-wide canvas and the hash itself would degrade to a visible pattern.
            #if defined(GL_FRAGMENT_PRECISION_HIGH) || __VERSION__ >= 300
            #define DWU_HP highp
            #else
            #define DWU_HP mediump
            #endif
            float dwuHash12(DWU_HP vec2 p) {
                DWU_HP vec3 p3 = fract(vec3(p.xyx) * 0.1031);
                p3 += dot(p3, p3.yzx + 33.33);
                return fract((p3.x + p3.y) * p3.z);
            }
        `,
        end: /* glsl */ `
            {
                DWU_HP vec2 dwuP = floor(gl_FragCoord.xy);
                // Triangular PDF in (-1, 1): sum of two independent uniforms minus 1.
                float dwuN = dwuHash12(dwuP) + dwuHash12(dwuP + vec2(37.0, 113.0)) - 1.0;
                // No noise where the fragment adds nothing (transparent texels): full strength from ~1 step up.
                float dwuCov = clamp(max(max(finalColor.r, finalColor.g), max(finalColor.b, finalColor.a)) * 255.0, 0.0, 1.0);
                finalColor.rgb += dwuN * dwuCov * (1.0 / 255.0);
            }
        `,
    },
};

let enabled = true;
let batchShader: Shader | null = null;
let plainBatchShader: Shader | null = null;
let installed = false;

function makeBatchShader(maxTextures: number): Shader {
    const glProgram = compileHighShaderGlProgram({
        name: 'batch-dither',
        bits: [colorBitGl, generateTextureBatchBitGl(maxTextures), roundPixelsBitGl, ditherBitGl],
    });
    // WebGPU keeps the stock program (no dither there; the game requests WebGL).
    const gpuProgram = compileHighShaderGpuProgram({
        name: 'batch',
        bits: [colorBit, generateTextureBatchBit(maxTextures), roundPixelsBit],
    });
    return new Shader({ glProgram, gpuProgram, resources: { batchSamplers: getBatchSamplersUniformGroup(maxTextures) } });
}

/**
 * The default batcher with the dithering shader. Registered under the same extension name ('default') so every
 * sprite / batched mesh / batched graphics uses it; `shader` is read per draw, so the toggle applies live.
 */
class DitherBatcher extends DefaultBatcher {
    static override extension = { type: [ExtensionType.Batcher], name: 'default' } as const;

    constructor(options: BatcherOptions) {
        super(options);
        const plain = this.shader;
        plainBatchShader ??= plain;
        batchShader ??= makeBatchShader(options.maxTextures ?? 16);
        const dither = batchShader;
        Object.defineProperty(this, 'shader', {
            configurable: true,
            get: () => (enabled ? dither : plain),
            set: () => {},
        });
    }
}

interface GraphicsAdaptorLike {
    shader: Shader;
}

/**
 * Install output dithering on a WebGL renderer. Call once, after `app.init` and before the first render (batchers are
 * created lazily on first use, so they pick up the dithering class). Safe to call more than once.
 */
export function installOutputDither(renderer: Renderer, on = true): void {
    enabled = on;
    if (!installed) {
        installed = true;
        extensions.remove(DefaultBatcher);
        extensions.add(DitherBatcher as unknown as typeof DefaultBatcher);
    }
    // The Graphics pipe draws large (unbatched) Graphics with its own shader (GlGraphicsAdaptor): give it a dithering
    // twin and swap on toggle.
    const pipes = (renderer as unknown as { renderPipes?: { graphics?: { _adaptor?: GraphicsAdaptorLike } } }).renderPipes;
    const adaptor = pipes?.graphics?._adaptor;
    if (adaptor && adaptor.shader && adaptor.shader.glProgram && !graphicsShaders.has(adaptor)) {
        const maxTextures = (renderer as unknown as { limits: { maxBatchableTextures: number } }).limits.maxBatchableTextures;
        const uniforms = adaptor.shader.resources.localUniforms as UniformGroup | undefined;
        const glProgram = compileHighShaderGlProgram({
            name: 'graphics-dither',
            bits: [colorBitGl, generateTextureBatchBitGl(maxTextures), localUniformBitGl, roundPixelsBitGl, ditherBitGl],
        });
        const dither = new Shader({
            glProgram,
            resources: {
                localUniforms:
                    uniforms ??
                    new UniformGroup({
                        uColor: { value: new Float32Array([1, 1, 1, 1]), type: 'vec4<f32>' },
                        uTransformMatrix: { value: new Matrix(), type: 'mat3x3<f32>' },
                        uRound: { value: 0, type: 'f32' },
                    }),
                batchSamplers: getBatchSamplersUniformGroup(maxTextures),
            },
        });
        graphicsShaders.set(adaptor, { plain: adaptor.shader, dither });
    }
    applyGraphics();
}

const graphicsShaders = new Map<GraphicsAdaptorLike, { plain: Shader; dither: Shader }>();

function applyGraphics(): void {
    for (const [adaptor, s] of graphicsShaders) adaptor.shader = enabled ? s.dither : s.plain;
}

/** Turn output dithering on / off (live). */
export function setOutputDither(on: boolean): void {
    enabled = on;
    applyGraphics();
}

export function outputDitherEnabled(): boolean {
    return enabled;
}
