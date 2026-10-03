// Cache WebGL implementation limits that Pixi re-queries per texture.

/** The texture-anisotropy limit (EXT_texture_filter_anisotropic MAX_TEXTURE_MAX_ANISOTROPY_EXT). */
const MAX_TEXTURE_MAX_ANISOTROPY_EXT = 0x84ff;

interface GlLike {
    getParameter(pname: number): unknown;
}

const patched = new WeakSet<object>();

/**
 * Memoise `gl.getParameter(MAX_TEXTURE_MAX_ANISOTROPY_EXT)` on the renderer's context.
 *
 * Pixi 8 (gl/texture/utils/applyStyleParams) asks for that limit every time it sets up a texture with
 * maxAnisotropy > 1 — every mipmapped art texture (assets.ts useMinifyingFilter) and every system-nebula render
 * target, on its first draw. In Chrome getParameter is a synchronous round trip to the GPU process that waits for all
 * queued GL work, so each first-drawn texture stalled the frame until the GPU was idle: while zooming into a system for
 * the first time that was hundreds of ms (22 % of the cold zoom sweep, perf-render --sweep). The limit is a constant of
 * the context, so the first answer is reused; every other query is passed through.
 */
export function installGlParameterCache(renderer: unknown): void {
    const gl = (renderer as { gl?: GlLike } | null)?.gl;
    if (!gl || typeof gl.getParameter !== 'function' || patched.has(gl)) return;
    patched.add(gl);
    const original = gl.getParameter.bind(gl);
    let anisotropy: unknown;
    let known = false;
    gl.getParameter = (pname: number): unknown => {
        if (pname !== MAX_TEXTURE_MAX_ANISOTROPY_EXT) return original(pname);
        if (!known) {
            anisotropy = original(pname);
            // A lost context answers null: ask again next time instead of keeping it.
            known = anisotropy !== null && anisotropy !== undefined;
        }
        return anisotropy;
    };
}
