// Background starfield vs DW:U 1.9.5: screenshots per zoom level, plus a background-only luminance measurement of our
// deep starfield (src/render/deepStarfield.ts) against an in-browser emulation of the original's pipeline.
//
// Usage: node scripts/starfield-shots.mjs <baseUrl> <outDir> [tag] [--dpr=1] [--w=1920] [--h=1080]
//
// Per zoom level (galaxy / sector / near-sector / system / planet, centred on the player's capital star like
// scripts/perf-render.mjs) it saves:
//   <outDir>/starfield-<tag>-<zoom>.png        full Main View (HUD on),
//   <outDir>/starfield-<tag>-<zoom>-bg2x.png   480x270 background-only crop (HUD, world and fx hidden: only the
//                                              screen-space starfield is drawn), magnified 2x nearest-neighbour,
//   <outDir>/starfield-orig-<zoom>-bg2x.png    the same crop of the original-pipeline emulation (below),
// and prints the luminance of the background-star pixels of the whole background-only frame: Rec.709 luma
// Y = 0.2126 R + 0.7152 G + 0.0722 B (0..255 sRGB values), mean over all pixels, mean over star pixels (Y >= 3, above
// the output dither's ±1 noise), max, and star-pixel coverage.
//
// Original-pipeline emulation (2D canvas, same viewport; render-side reference only, no art is written anywhere but
// the screenshot dir): Controls/MainView.cs method_14 (XNA path bool_9: n = StarFieldSize / 4, tiles
// min(2000, screenMax/2 + 50) / screenMax + 400) + MainView.1.cs method_101/105/107/108/110/102 + method_45:
//   - the 17 images/environment/mapstars/flares PNGs (decoded raw, colour profile ignored, like GDI+) prescaled to 16 px (bitmap_198) and 32 px (bitmap_197) with
//     high-quality resampling (Main.Part13.cs PrecacheScaledBitmap HighQualityBicubic),
//   - layers 3/2/1 (16n × 6 px grey 127, 4n × 7 px white, n × 11 px white): 16 px flares drawn nearest-neighbour
//     (method_175 InterpolationMode.NearestNeighbor) into a transparent tile with the RGB colour matrix (method_220),
//     the tile composited over black at alpha method_45 = min(1, F^-0.25) (BlendState.NonPremultiplied),
//   - layer 0 (n/4 × 20 px): 32 px flares drawn bilinear at 20 px with a 128..254 per-channel tint at alpha
//     method_45 (method_102),
//   - nothing at F >= BaconMain.backgroundStarsAtZoomLevel (300): the original shows only the galaxy backdrop there.
import { chromium } from 'playwright-core';
import { readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const opts = Object.fromEntries(
    process.argv
        .slice(2)
        .filter((a) => a.startsWith('--'))
        .map((a) => {
            const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
            return [m[1], m[2] ?? 'true'];
        }),
);
const [base = 'http://localhost:5173/', outDir = 'shots', tag = 'now'] = pos;
const W = +(opts.w ?? 1920);
const H = +(opts.h ?? 1080);
const DPR = +(opts.dpr ?? 1);
mkdirSync(outDir, { recursive: true });

const flareDir = join(here, '..', 'public/assets/dwu/images/environment/mapstars/flares');
let flareFiles = [];
try {
    flareFiles = readdirSync(flareDir).filter((f) => f.toLowerCase().endsWith('.png')).sort();
} catch {
    console.log(`no flare art at ${flareDir}: the original emulation is skipped`);
}
const flareUrls = flareFiles.map((f) => `/assets/dwu/images/environment/mapstars/flares/${f}`);

// Zoom levels: F = original zoom factor (world units per screen px) = 1 / camera.zoom.
const ZOOMS = [
    { name: 'galaxy', F: null },
    { name: 'sector', F: 3000 }, // scripts/perf-render.mjs "sector"
    { name: 'nearsector', F: 200 }, // inside the original's star range (F < 300) with the galaxy backdrop still drawn
    { name: 'system', F: 50 }, // perf-render "system"
    { name: 'planet', F: 1 }, // perf-render "planet" (100%)
];
const CROP = { x: 720, y: 405, w: 480, h: 270 };

const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
const logs = [];
page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${base.replace(/\/$/, '')}/?autostart=1`);
await page.waitForFunction(() => !!window.__dwu?.game && !!window.__dwu?.time && window.__dwu.view?.deepStarfield?.ready === true, null, {
    timeout: 180000,
});
await page.evaluate(() => {
    window.__dwu.time.paused = true;
});
await page.waitForTimeout(1500);

// Page helpers: luminance stats of a PNG, background-only toggling, the original emulation.
await page.evaluate(() => {
    const luma = (d) => {
        let sum = 0;
        let starSum = 0;
        let star = 0;
        let max = 0;
        const n = d.length / 4;
        for (let i = 0; i < d.length; i += 4) {
            const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
            sum += y;
            if (y >= 3) {
                starSum += y;
                star++;
            }
            if (y > max) max = y;
        }
        return { mean: sum / n, starMean: star > 0 ? starSum / star : 0, max, coverage: star / n };
    };
    window.__sfLuma = luma;
    window.__sfPngStats = async (b64, crop, scale) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = c.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        const stats = luma(ctx.getImageData(0, 0, bmp.width, bmp.height).data);
        return { stats, crop: await window.__sfCrop2x(c, crop, scale) };
    };
    window.__sfCrop2x = async (src, crop, scale) => {
        const out = new OffscreenCanvas(crop.w * 2, crop.h * 2);
        const o = out.getContext('2d');
        o.imageSmoothingEnabled = false;
        o.drawImage(src, crop.x * scale, crop.y * scale, crop.w * scale, crop.h * scale, 0, 0, crop.w * 2, crop.h * 2);
        const blob = await out.convertToBlob({ type: 'image/png' });
        const buf = new Uint8Array(await blob.arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return btoa(s);
    };
    // Hide everything but the screen-space starfield (HUD DOM, world, fx).
    window.__sfBgOnly = (on) => {
        const d = window.__dwu;
        const canvas = d.app.canvas ?? d.app.view;
        if (on) {
            window.__sfHidden = [];
            let el = canvas;
            while (el && el !== document.body) {
                const parent = el.parentElement;
                if (!parent) break;
                for (const sib of parent.children) {
                    if (sib !== el && sib.style.visibility !== 'hidden') {
                        window.__sfHidden.push([sib, sib.style.visibility]);
                        sib.style.visibility = 'hidden';
                    }
                }
                el = parent;
            }
            window.__sfStage = d.app.stage.children.map((c) => [c, c.visible]);
            for (const c of d.app.stage.children) if (c !== d.view.deepStarfield.root) c.visible = false;
        } else {
            for (const [sib, v] of window.__sfHidden ?? []) sib.style.visibility = v;
            for (const [c, v] of window.__sfStage ?? []) c.visible = v;
        }
    };
});

if (flareUrls.length > 0) {
    await page.evaluate(async (urls) => {
        // Raw samples, embedded colour profile ignored: the original's GDI+ `new Bitmap(path)` (no ICM).
        const imgs = await Promise.all(
            urls.map(async (u) => createImageBitmap(await (await fetch(u)).blob(), { colorSpaceConversion: 'none' })),
        );
        const prescale = (im, s) => {
            const c = new OffscreenCanvas(s, s);
            const x = c.getContext('2d');
            x.imageSmoothingEnabled = true;
            x.imageSmoothingQuality = 'high';
            x.drawImage(im, 0, 0, s, s);
            return c;
        };
        const f16 = imgs.map((im) => prescale(im, 16)); // Main.bitmap_198
        const f32 = imgs.map((im) => prescale(im, 32)); // Main.bitmap_197 -> MainView.texture2D_19
        // .NET-free deterministic stand-in for System.Random(DateTime.Now.Ticks) (positions are uniform either way).
        let seed = 12345;
        const rnd = () => {
            seed = (seed * 1103515245 + 12345) >>> 0;
            return seed / 4294967296;
        };
        const next = (lo, hi) => lo + Math.floor(rnd() * (hi - lo));
        window.__sfOriginal = (F, w, h, starFieldSize) => {
            const screen = new OffscreenCanvas(w, h);
            const sc = screen.getContext('2d');
            sc.fillStyle = '#000';
            sc.fillRect(0, 0, w, h);
            if (F >= 300) return screen; // BaconMain.backgroundStarsAtZoomLevel
            const a = Math.max(0, Math.min(1, 1 / Math.sqrt(Math.sqrt(F)))); // method_45
            const screenMax = Math.max(w, h);
            const n = Math.trunc(starFieldSize / 4); // method_14, bool_9: int_11 /= 4 (num2 = 1)
            const small = Math.min(2000, Math.trunc(screenMax / 2) + 50);
            const large = screenMax + 400;
            // Layers 3, 2, 1: prerendered tiles (method_107 / method_105), drawn by method_108 / method_110.
            for (const [count, size, grey] of [
                [n * 16, 6, 127],
                [n * 4, 7, 255],
                [n, 11, 255],
            ]) {
                const tile = new OffscreenCanvas(small, small);
                const t = tile.getContext('2d');
                t.imageSmoothingEnabled = false; // method_175: NearestNeighbor
                t.filter = grey < 255 ? `brightness(${grey / 255})` : 'none'; // method_220 colour matrix (RGB only)
                for (let i = 0; i < count; i++) {
                    const x = next(0, small);
                    const y = next(0, small);
                    t.drawImage(f16[i % f16.length], x, y, size, size);
                }
                sc.globalAlpha = a; // Color(1, 1, 1, method_45) under BlendState.NonPremultiplied
                for (let ty = 0; ty < h; ty += small) for (let tx = 0; tx < w; tx += small) sc.drawImage(tile, tx, ty);
            }
            // Layer 0 (method_102): 20 px flares, 128 + Rnd(0..126) per channel, alpha method_45.
            const star = new OffscreenCanvas(20, 20);
            const s = star.getContext('2d');
            for (let i = 0, count = Math.trunc(n / 4); i < count; i++) {
                const x = next(0, large);
                const y = next(0, large);
                const fr = f32[i % f32.length];
                s.globalCompositeOperation = 'copy';
                s.imageSmoothingEnabled = true;
                s.drawImage(fr, 0, 0, 20, 20);
                s.globalCompositeOperation = 'multiply';
                s.fillStyle = `rgb(${128 + next(0, 127)},${128 + next(0, 127)},${128 + next(0, 127)})`;
                s.fillRect(0, 0, 20, 20);
                s.globalCompositeOperation = 'destination-in';
                s.drawImage(fr, 0, 0, 20, 20);
                sc.globalAlpha = a;
                sc.drawImage(star, x, y);
            }
            sc.globalAlpha = 1;
            return screen;
        };
    }, flareUrls);
}

const rows = [];
for (const z of ZOOMS) {
    const where = await page.evaluate((F) => {
        const d = window.__dwu;
        const cam = d.camera;
        const g = d.game.galaxy;
        const cap = d.game.playerEmpire?.capital ?? null;
        const star = cap !== null ? g.systems[cap.systemIndex]?.systemStar ?? cap : null;
        if (F === null) {
            cam.centerOn(g.sizeX / 2, g.sizeY / 2);
            cam.zoom = cam.minZoom;
        } else {
            cam.centerOn(star.xpos, star.ypos);
            cam.zoom = cam.clampZoom(1 / F);
        }
        return { zoom: cam.zoom, F: 1 / cam.zoom, minZoom: cam.minZoom };
    }, z.F);
    await page.waitForTimeout(2000);
    const full = `${outDir}/starfield-${tag}-${z.name}.png`;
    await page.screenshot({ path: full });
    await page.evaluate(() => window.__sfBgOnly(true));
    await page.waitForTimeout(400);
    const alphas = await page.evaluate(() => {
        const sf = window.__dwu.view.deepStarfield;
        return { visible: sf.root.visible, far: sf.far.alpha, near: sf.near.alpha };
    });
    const bg = (await page.screenshot()).toString('base64');
    await page.evaluate(() => window.__sfBgOnly(false));
    const ours = await page.evaluate(({ b64, crop, scale }) => window.__sfPngStats(b64, crop, scale), { b64: bg, crop: CROP, scale: DPR });
    const oursCrop = `${outDir}/starfield-${tag}-${z.name}-bg2x.png`;
    await writeB64(oursCrop, ours.crop);
    let orig = null;
    if (flareUrls.length > 0) {
        const settings = await page.evaluate(() => {
            try {
                return JSON.parse(localStorage.getItem('dwu-ui-settings') ?? 'null')?.starFieldSize ?? 1000;
            } catch {
                return 1000;
            }
        });
        const r = await page.evaluate(
            async ({ F, w, h, size, crop }) => {
                const c = window.__sfOriginal(F, w, h, size);
                const stats = window.__sfLuma(c.getContext('2d').getImageData(0, 0, w, h).data);
                return { stats, crop: await window.__sfCrop2x(c, crop, 1) };
            },
            { F: where.F, w: W, h: H, size: settings, crop: CROP },
        );
        orig = r.stats;
        const origCrop = `${outDir}/starfield-orig-${z.name}-bg2x.png`;
        await writeB64(origCrop, r.crop);
    }
    rows.push({ zoom: z.name, F: where.F, ...alphas, ours: ours.stats, orig });
    console.log(`saved ${full}, ${oursCrop}${orig ? `, ${outDir}/starfield-orig-${z.name}-bg2x.png` : ''}`);
}

async function writeB64(path, b64) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path, Buffer.from(b64, 'base64'));
}

const f = (v, d = 2) => (v === null || v === undefined ? '-' : v.toFixed(d));
console.log(`\nviewport ${W}x${H} @${DPR}  (Y = Rec.709 luma 0..255; star px = Y >= 3)`);
console.log('zoom        F        ourAlpha(far/near)  | ours: mean  starMean  max   cover%  | orig: mean  starMean  max   cover%');
for (const r of rows) {
    const o = r.ours;
    const g = r.orig;
    console.log(
        `${r.zoom.padEnd(11)} ${f(r.F, 0).padStart(7)}  ${r.visible ? `${f(r.far, 3)}/${f(r.near, 3)}` : 'hidden     '}         | ` +
            `${f(o.mean, 3).padStart(10)} ${f(o.starMean).padStart(8)} ${f(o.max, 0).padStart(5)} ${f(o.coverage * 100).padStart(7)}  | ` +
            (g ? `${f(g.mean, 3).padStart(10)} ${f(g.starMean).padStart(8)} ${f(g.max, 0).padStart(5)} ${f(g.coverage * 100).padStart(7)}` : '-'),
    );
}
await browser.close();
for (const l of logs) console.log(l);
