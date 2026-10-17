// Window display mode and GPU switches of the game window (desktop/main.cjs), the pure parts (desktop shell tests).
//
// Fullscreen: F11, Alt+Enter and Ctrl/Cmd+F toggle it (Game Options → Fullscreen and the shell menu too); the choice
// is remembered in config.json (`fullscreen`) and restored at the next launch. Laptops often send F11 only with the Fn
// key (it is a brightness / media key by default), which is why the Options checkbox exists.
//
// GPU: Chromium's GPU blocklist turns off WebGL on many older Intel / AMD laptop drivers; Pixi then falls back to its
// Canvas renderer, which has none of the game's shaders (full-bright, unfiltered planets and ships). On Windows the
// blocklist is ignored (D3D11 through ANGLE works on those drivers in practice) unless DWU_GPU_BLOCKLIST=1;
// DWU_USE_ANGLE=<d3d11|d3d9|gl|vulkan|warp> picks another ANGLE backend. On Windows and macOS the high-performance GPU
// is preferred (force_high_performance_gpu: a hybrid PC otherwise may draw on its Intel iGPU) unless DWU_LOW_POWER_GPU=1.
'use strict';

/** Windows: the title bar's Maximize button (or a double-click / snap to the top) puts the game in fullscreen instead of
 *  a maximized window (the user's request); macOS's green button is fullscreen already, Linux keeps its window manager's
 *  maximize. Leaving fullscreen goes back to a normal window, so Maximize works again. */
function maximizeMeansFullscreen(platform) {
    return platform === 'win32';
}

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
    // Hybrid laptops / desktops with an iGPU: run on the discrete (high-performance) GPU, not the Intel one.
    if ((platform === 'win32' || platform === 'darwin') && env.DWU_LOW_POWER_GPU !== '1') out.push(['force_high_performance_gpu']);
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

/** The GPU line from app.getGPUInfo('complete'): the active adapter's vendor / device / driver and the GL renderer. */
function gpuInfoLine(info) {
    if (!info || typeof info !== 'object') return '[gpu] info unavailable';
    const devs = Array.isArray(info.gpuDevice) ? info.gpuDevice : [];
    const hex = (n) => (typeof n === 'number' ? `0x${n.toString(16).padStart(4, '0')}` : '?');
    const list = devs.map((d) => `${d.active ? '*' : ''}${hex(d.vendorId)}:${hex(d.deviceId)}${d.driverVersion ? ` driver ${d.driverVersion}` : ''}`).join(', ');
    const aux = info.auxAttributes ?? {};
    return `[gpu] adapters ${list || '?'}; GL ${aux.glRenderer ?? info.glRenderer ?? '?'} (${aux.glImplementationParts ?? aux.glImplementation ?? '?'})`;
}

module.exports = { isFullscreenToggle, maximizeMeansFullscreen, gpuSwitches, gpuLogLine, gpuInfoLine };
