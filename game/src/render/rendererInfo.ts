// Which renderer the Main View got (Pixi WebGL / WebGPU / Canvas) and the WebGL renderer string: for the desktop
// shell's gpu-log.txt (desktop/displayMode.cjs) and Game Options' "running without WebGL" notice. Pixi falls back to
// its Canvas renderer when WebGL is unavailable (a blocklisted or missing GPU driver); that path has none of the
// game's shaders (dither, nebula, deep backdrop) and no filters.
import type { Application } from 'pixi.js';

export interface RendererInfo {
    /** Pixi's renderer name: 'webgl', 'webgpu' or 'canvas'. */
    renderer: string;
    /** 'webgl2' / 'webgl1' / 'none'. */
    webgl: string;
    /** The unmasked GPU renderer string, when the WebGL context exposes it. */
    gpu: string;
}

let current: RendererInfo | null = null;

/** The running game's renderer (null before the Main View started). */
export function currentRendererInfo(): RendererInfo | null {
    return current;
}

/** Record the app's renderer (and tell the desktop shell, for its log). */
export function recordRenderer(app: Application): RendererInfo {
    const r = app.renderer as unknown as { name?: string; gl?: WebGLRenderingContext | WebGL2RenderingContext; context?: { webGLVersion?: number } };
    let gpu = '';
    let webgl = 'none';
    const gl = r.gl;
    if (gl !== undefined) {
        webgl = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext ? 'webgl2' : 'webgl1';
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (ext !== null) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    }
    current = { renderer: String(r.name ?? 'unknown'), webgl, gpu };
    if (current.renderer !== 'webgl') console.warn(`renderer: ${current.renderer} (no WebGL${gpu ? `, ${gpu}` : ''}): simplified graphics`);
    (window as unknown as { dwuDesktop?: { reportRenderer?: (i: RendererInfo) => void } }).dwuDesktop?.reportRenderer?.(current);
    return current;
}

/** Game Options' one-line notice, or null when the game runs on WebGL. */
export function noWebglNotice(info: RendererInfo | null = current): string | null {
    if (info === null || info.renderer === 'webgl') return null;
    return info.renderer === 'webgpu' ? 'Running on WebGPU (no WebGL): some effects are off.' : 'Running without WebGL (GPU unavailable): simplified graphics.';
}
