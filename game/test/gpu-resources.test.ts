// GPU resource bounds (macOS WebGL context-loss fix): generated fallback textures are shared, never one canvas per
// view; pixel textures need no canvas; the system-nebula cache stays inside its texture budget; repeated context
// losses step detail down instead of looping (render/textureCanvas.ts, assets.ts, systemNebula.ts, contextLoss.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { textureFromRgbaPixels } from '../src/render/textureCanvas';
import { mippedTextureBytes, NEBULA_TEXTURE_BUDGET_BYTES, SystemNebulaLayer, type NebulaSystem } from '../src/render/systemNebula';
import { installContextLossRecovery, LOSS_WINDOW_MS } from '../src/render/contextLoss';

/** Minimal DOM canvas: enough 2D context for the fallback painters. */
function fakeDocument(): { created: Array<{ width: number; height: number; attrs: unknown }> } {
    const created: Array<{ width: number; height: number; attrs: unknown }> = [];
    const gradient = { addColorStop: () => {} };
    const ctx = new Proxy({} as Record<string, unknown>, {
        get: (t, k) => (k in t ? t[k as string] : k === 'createRadialGradient' || k === 'createLinearGradient' ? () => gradient : () => {}),
        set: (t, k, v) => ((t[k as string] = v), true),
    });
    vi.stubGlobal('document', {
        createElement: (tag: string) => {
            if (tag !== 'canvas') throw new Error(tag);
            const c = {
                width: 300,
                height: 150,
                attrs: undefined as unknown,
                getContext(_type: string, attrs?: unknown) {
                    c.attrs = attrs;
                    return ctx;
                },
                addEventListener() {},
                removeEventListener() {},
            };
            created.push(c);
            return c;
        },
    });
    return { created };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('generated fallback textures', () => {
    it('are shared per kind and colour, on software canvases', async () => {
        const dom = fakeDocument();
        const { makePlanetTexture, makeGlowTexture, makeStarSpriteTexture, makeDotTexture, fallbackTextureCount } = await import('../src/render/assets');
        const before = fallbackTextureCount();
        // A late save makes one of these per planet / moon / star view: 13k+ calls must not mean 13k canvases.
        const planets = Array.from({ length: 500 }, (_, i) => makePlanetTexture(i % 2 === 0 ? '#336699' : '#996633'));
        expect(new Set(planets).size).toBe(2);
        expect(makeGlowTexture('#ffd27f', '#fff6e0')).toBe(makeGlowTexture('#ffd27f', '#fff6e0'));
        expect(makeGlowTexture('#ffd27f', '#fff6e0', 64)).not.toBe(makeGlowTexture('#ffd27f', '#fff6e0'));
        expect(makeStarSpriteTexture(0 as never)).toBe(makeStarSpriteTexture(0 as never));
        expect(makeDotTexture('#cccccc', 32)).toBe(makeDotTexture('#cccccc', 32));
        expect(fallbackTextureCount() - before).toBe(dom.created.length);
        expect(dom.created.length).toBeLessThanOrEqual(6);
        for (const c of dom.created) expect(c.attrs).toEqual({ willReadFrequently: true });
    });
});

describe('textureFromRgbaPixels', () => {
    it('copies the pixels into a buffer source, premultiplied on upload', () => {
        const px = new Uint8ClampedArray(2 * 2 * 4).fill(200);
        const t = textureFromRgbaPixels(px, 2, 2, true);
        px.fill(0); // the caller may reuse its buffer
        const src = t.source as unknown as { resource: Uint8Array; alphaMode: string; scaleMode: string };
        expect(src.resource[0]).toBe(200);
        expect(src.alphaMode).toBe('premultiply-alpha-on-upload');
        expect(src.scaleMode).toBe('nearest');
        expect(t.width).toBe(2);
        expect(() => textureFromRgbaPixels(new Uint8Array(4), 2, 2)).toThrow();
    });
});

describe('system nebula texture budget', () => {
    it('counts mip chains', () => {
        expect(mippedTextureBytes(1024, 8)).toBe(Math.ceil((1024 * 1024 * 8 * 4) / 3));
        // Ten 3-patch systems of 1024 px half floats would be ~335 MB; the budget keeps it to a fraction.
        expect(NEBULA_TEXTURE_BUDGET_BYTES).toBeLessThan(30 * mippedTextureBytes(1024, 8) / 4);
    });

    it('evicts systems off screen once over budget (CPU path), never the one on screen', async () => {
        const layer = new SystemNebulaLayer(1, 1, null);
        const budget = 300_000;
        (layer as unknown as { budgetBytes: number }).budgetBytes = budget;
        const systems: NebulaSystem[] = Array.from({ length: 6 }, (_, i) => ({ index: i, x: i * 1e6, y: 0, radius: 20000, enabled: true }));
        const z = 1 / 100; // system zoom (nebulae fully on)
        let maxOther = 0;
        for (const s of systems) {
            for (let f = 0; f < 4000; f++) {
                layer.update(z, s.x, s.y, 800, 600, systems, f * 16);
                if (layer.generationMs(s.index) !== undefined) break;
                await new Promise((r) => setTimeout(r, 0));
            }
            expect(layer.generationMs(s.index)).toBeDefined();
            const own = (layer as unknown as { entries: Map<number, { bytes: number }> }).entries.get(s.index)!.bytes;
            maxOther = Math.max(maxOther, layer.textureBytes() - own);
            // Everything beyond the on-screen system fits the budget.
            expect(layer.textureBytes() - own).toBeLessThanOrEqual(budget);
        }
        expect((layer as unknown as { entries: Map<number, unknown> }).entries.size).toBeLessThan(systems.length);
        expect(layer.usesGpu).toBe(false);
    });
});

describe('context loss recovery', () => {
    function setup() {
        const canvas = new EventTarget() as unknown as HTMLCanvasElement;
        const renderer = { resolution: 2 };
        const calls: string[] = [];
        const notes: string[] = [];
        let t = 0;
        const target = { onGpuContextRestored: () => calls.push('restored'), useLowGpuMode: (level: number) => calls.push(`low${level}`) };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const r = installContextLossRecovery(canvas, renderer, target, { notify: (m) => notes.push(m), now: () => t });
        const cycle = (at: number) => {
            t = at;
            canvas.dispatchEvent(new Event('webglcontextlost'));
            canvas.dispatchEvent(new Event('webglcontextrestored'));
        };
        return { canvas, renderer, calls, notes, r, cycle, warn };
    }

    it('recovers once at full detail, then steps down per recurring loss, notifying once', () => {
        const { renderer, calls, notes, r, cycle, warn } = setup();
        cycle(1000);
        expect(calls).toEqual(['restored']);
        expect(renderer.resolution).toBe(2);
        cycle(6000);
        expect(r.state.level).toBe(1);
        expect(renderer.resolution).toBe(1);
        expect(calls).toEqual(['restored', 'low1', 'restored']);
        cycle(11000);
        cycle(16000);
        expect(r.state).toEqual({ losses: 4, restores: 4, level: 2 });
        expect(calls.filter((c) => c === 'low2').length).toBe(1);
        expect(notes.length).toBe(1);
        warn.mockRestore();
    });

    it('does not degrade for losses far apart, and stops listening once disposed', () => {
        const { calls, r, cycle, warn } = setup();
        cycle(0);
        cycle(LOSS_WINDOW_MS + 1);
        expect(r.state.level).toBe(0);
        r.dispose();
        cycle(LOSS_WINDOW_MS + 2);
        expect(r.state.losses).toBe(2);
        expect(calls).toEqual(['restored', 'restored']);
        warn.mockRestore();
    });
});
