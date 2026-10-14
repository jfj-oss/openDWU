// Window display mode and GPU switches of the game window (desktop/main.cjs), the pure parts (desktop shell tests).
//
// Fullscreen: F11, Alt+Enter and Ctrl/Cmd+F toggle it (Game Options → Fullscreen and the shell menu too); the choice
// is remembered in config.json (`fullscreen`) and restored at the next launch. Laptops often send F11 only with the Fn
// key (it is a brightness / media key by default), which is why the Options checkbox exists.
//
// GPU: Chromium's GPU blocklist turns off WebGL on many older Intel / AMD laptop drivers; Pixi then falls back to its
// Canvas renderer, which has none of the game's shaders (full-bright, unfiltered planets and ships). On Windows the
// blocklist is ignored (D3D11 through ANGLE works on those drivers in practice) unless DWU_GPU_BLOCKLIST=1;
// DWU_USE_ANGLE=<d3d11|d3d9|gl|vulkan|warp> picks another ANGLE backend.
'use strict';

/** True when the before-input-event `input` is a fullscreen toggle (keyDown of F11, Alt+Enter, Ctrl/Cmd+F). */
function isFullscreenToggle(input, platform) {
    if (!input || input.type !== 'keyDown' || input.isAutoRepeat) return false;
    const key = String(input.key ?? '');
    if (key === 'F11' && !input.control && !input.alt && !input.meta && !input.shift) return true;
    if (key === 'Enter' && input.alt && !input.control && !input.meta) return true;
    const mod = platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta;
    return key.toLowerCase() === 'f' && mod && !input.alt && !input.shift;
}

/** The Chromium switches for the GPU path: [name, value?][] for app.commandLine.appendSwitch. */
function gpuSwitches(platform, env = {}) {
    const out = [];
    if (platform !== 'win32') return out;
    if (env.DWU_GPU_BLOCKLIST !== '1') out.push(['ignore-gpu-blocklist']);
    const angle = String(env.DWU_USE_ANGLE ?? 'd3d11').toLowerCase();
    if (/^(d3d11|d3d9|gl|vulkan|warp|swiftshader)$/.test(angle)) out.push(['use-angle', angle]);
    return out;
}

/** One log line from app.getGPUFeatureStatus() and the page's renderer report. */
function gpuLogLine(featureStatus, page) {
    const fs = featureStatus ?? {};
    const keys = ['webgl', 'webgl2', 'gpu_compositing', 'rasterization', 'webgpu'];
    const status = keys.map((k) => `${k}=${fs[k] ?? '?'}`).join(' ');
    const p = page ?? {};
    return `[gpu] ${status}; page renderer=${p.renderer ?? '?'} webgl=${p.webgl ?? '?'}${p.gpu ? ` (${p.gpu})` : ''}`;
}

module.exports = { isFullscreenToggle, gpuSwitches, gpuLogLine };
