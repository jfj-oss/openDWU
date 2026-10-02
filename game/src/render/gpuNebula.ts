// GPU rasteriser for the system-nebula patches (render-only). Same maths as NebulaPatchRaster.step in
// systemNebula.ts (domain-warped fBm over a 64x64 periodic value-noise lattice, same envelope / density curve /
// palette mix), done in one WebGL2 fragment pass into a RenderTexture instead of idle CPU slices. The lattice comes
// from the same mulberry32 stream as the CPU path (uploaded as a 16-bit-in-RG8 texture), so the look matches.
// Falls back (returns null from createGpuNebula) when the renderer is not WebGL or anything throws.

import { BufferImageSource, Geometry, GlProgram, Mesh, RenderTexture, Shader, Texture, UniformGroup, type Renderer } from 'pixi.js';

export interface GpuPatchInput {
    /** 64x64 lattice values in [0,1). */
    lattice: Float32Array;
    warp: number;
    freq: number;
    threshold: number;
    opacity: number;
    c1: [number, number, number];
    c2: [number, number, number];
    extent: number;
    envOuter: number;
}

const VERT = `#version 300 es
in vec2 aPosition;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform float uSize;
out vec2 vPix;
void main() {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vPix = aPosition;
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp int;
in vec2 vPix;
out vec4 outColor;
uniform sampler2D uLat;
uniform float uSize;
uniform float uExtent;
uniform float uEnvOuter;
uniform float uWarp;
uniform float uFreq;
uniform float uThr;
uniform float uOpacity;
uniform vec3 uC1;
uniform vec3 uC2;

float lat(int x, int y) {
    vec4 t = texelFetch(uLat, ivec2(x & 63, y & 63), 0) * 255.0;
    return (t.r * 256.0 + t.g) / 65535.0;
}
float vnoise(float x, float y) {
    float xf = floor(x);
    float yf = floor(y);
    float tx = x - xf;
    float ty = y - yf;
    tx = tx * tx * (3.0 - 2.0 * tx);
    ty = ty * ty * (3.0 - 2.0 * ty);
    int x0 = int(xf);
    int y0 = int(yf);
    float a = lat(x0, y0);
    float b = lat(x0 + 1, y0);
    float c = lat(x0, y0 + 1);
    float d = lat(x0 + 1, y0 + 1);
    float top = a + (b - a) * tx;
    return top + (c + (d - c) * tx - top) * ty;
}
float fbm(float x, float y, int oct) {
    float sum = 0.0;
    float amp = 0.5;
    float norm = 0.0;
    float f = 1.0;
    for (int o = 0; o < 5; o++) {
        if (o >= oct) break;
        float fo = float(o);
        sum += amp * vnoise(x * f + fo * 17.3, y * f - fo * 11.1);
        norm += amp;
        amp *= 0.5;
        f *= 2.03;
    }
    return sum / norm;
}
float ramp(float v, float a, float b) {
    float t = clamp((v - a) / (b - a), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}
float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
void main() {
    vec2 pxy = floor(vPix);
    float inv = 2.0 * uExtent / uSize;
    float x = -uExtent + (pxy.x + 0.5) * inv;
    float y = -uExtent + (pxy.y + 0.5) * inv;
    float wx = fbm(x * 1.5 + 5.2, y * 1.5 + 1.3, 2) - 0.5;
    float wy = fbm(x * 1.5 + 9.7, y * 1.5 + 23.1, 2) - 0.5;
    float xw = x + uWarp * wx;
    float yw = y + uWarp * wy;
    float r = sqrt(xw * xw + yw * yw);
    float env = 1.0 - ramp(r, 0.45, uEnvOuter);
    float n = fbm(xw * uFreq + 31.7, yw * uFreq + 3.9, 5);
    float v = n + (env - 1.0) * 0.45;
    float d = ramp(v, uThr, uThr + 0.55);
    d = d * (0.55 + 0.45 * d);
    d = max(d, 0.1 * env * env);
    d *= ramp(env, 0.0, 0.35);
    if (r >= uEnvOuter || d <= 0.002) {
        outColor = vec4(0.0);
        return;
    }
    float t = ramp(fbm(x * 0.9 + 47.3, y * 0.9 + 12.8, 2), 0.38, 0.62);
    float lum = 0.75 + 0.35 * d;
    vec3 rgb = mix(uC1, uC2, t) * lum / 255.0;
    float a = uOpacity * d;
    // Premultiplied output, no texel dither (magnified texels turned the noise into blotches / holes at close zoom;
    // the screen-space output dither in outputDither.ts handles banding). Colour kept <= alpha.
    float aq = clamp(floor(a * 255.0 + 0.5), 0.0, 255.0) / 255.0;
    outColor = vec4(min(clamp(rgb * a, 0.0, 1.0), vec3(aq)), aq);
}`;

export class GpuNebula {
    private readonly program: GlProgram;
    private readonly geom = new Geometry({
        attributes: { aPosition: new Float32Array(8) },
        indexBuffer: [0, 1, 2, 0, 2, 3],
    });

    constructor(private readonly renderer: Renderer) {
        this.program = GlProgram.from({ vertex: VERT, fragment: FRAG, name: 'system-nebula-patch' });
    }

    /** Renders one patch to a premultiplied-alpha RenderTexture (square, `size` px, mipmapped). */
    render(p: GpuPatchInput, size: number): Texture {
        const bytes = new Uint8Array(64 * 64 * 4);
        for (let i = 0; i < 4096; i++) {
            const v = Math.min(65535, Math.round(p.lattice[i] * 65535));
            bytes[i * 4] = v >> 8;
            bytes[i * 4 + 1] = v & 255;
        }
        const latSrc = new BufferImageSource({ resource: bytes, width: 64, height: 64, format: 'rgba8unorm', scaleMode: 'nearest', alphaMode: 'no-premultiply-alpha' });
        const uniforms = new UniformGroup({
            uSize: { value: size, type: 'f32' },
            uExtent: { value: p.extent, type: 'f32' },
            uEnvOuter: { value: p.envOuter, type: 'f32' },
            uWarp: { value: p.warp, type: 'f32' },
            uFreq: { value: p.freq, type: 'f32' },
            uThr: { value: p.threshold, type: 'f32' },
            uOpacity: { value: p.opacity, type: 'f32' },
            uC1: { value: new Float32Array(p.c1), type: 'vec3<f32>' },
            uC2: { value: new Float32Array(p.c2), type: 'vec3<f32>' },
        });
        const shader = new Shader({ glProgram: this.program, resources: { uLat: latSrc, uniforms } });
        const pos = this.geom.getBuffer('aPosition');
        pos.data = new Float32Array([0, 0, size, 0, size, size, 0, size]);
        const mesh = new Mesh({ geometry: this.geom, shader });
        mesh.state.blendMode = 'none';
        const rt = RenderTexture.create({ width: size, height: size, resolution: 1, scaleMode: 'linear', autoGenerateMipmaps: true });
        rt.source.maxAnisotropy = 16;
        this.renderer.render({ container: mesh, target: rt, clear: true, clearColor: [0, 0, 0, 0] });
        mesh.destroy();
        shader.destroy();
        latSrc.destroy();
        return rt;
    }
}

/** A GPU nebula rasteriser for a WebGL renderer, or null (WebGPU / headless / failure) so callers use the CPU path. */
export function createGpuNebula(renderer: Renderer | null | undefined): GpuNebula | null {
    try {
        if (!renderer || (renderer as { type?: number }).type !== 1 /* RendererType.WEBGL */) return null;
        return new GpuNebula(renderer);
    } catch {
        return null;
    }
}
