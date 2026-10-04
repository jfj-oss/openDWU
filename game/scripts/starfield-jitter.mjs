// Background-starfield motion probe: frame-by-frame screen offsets of the deep starfield's layers
// (src/render/deepStarfield.ts) during trackpad-like zooms (many small ctrl+wheel events through the Main View's real
// wheel handler) and slow pans, in device pixels.
//
// Usage: node scripts/starfield-jitter.mjs <baseUrl> [outDir] [--dpr=2] [--w=1440] [--h=900] [--F=50]
//        [--electron=<Electron binary>] [--main=<electron main.cjs loading $DWU_URL>] [--pw=<playwright-core index.mjs>]
//
// Per scenario and layer it prints, in device px per frame: mean |step|, max |step|, the share of frames where the
// layer moved while the map content at the view centre did not (zoom about the centre), sign reversals of the step,
// and the step's deviation from the ideal continuous parallax motion (pan / divisor; 0 for a zoom about the centre).
// Screenshots of a mid-zoom frame go to <outDir>/starjit-<scenario>.png.
import { mkdirSync } from 'node:fs';

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
const [base = 'http://localhost:5173/', outDir = 'shots'] = pos;
const W = +(opts.w ?? 1440);
const H = +(opts.h ?? 900);
const DPR = +(opts.dpr ?? 2);
const F = +(opts.F ?? 50);
mkdirSync(outDir, { recursive: true });
const pw = await import(opts.pw ?? 'playwright-core');
const url = `${base.replace(/\/$/, '')}/?autostart=1`;

let page;
let close;
if (opts.electron) {
    const app = await pw._electron.launch({ executablePath: opts.electron, args: [opts.main], env: { ...process.env, DWU_URL: url } });
    page = await app.firstWindow();
    close = () => app.close();
} else {
    const browser = await pw.chromium.launch({
        executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
    await page.goto(url);
    close = () => browser.close();
}
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
    if (m.type() === 'error') logs.push(`[error] ${m.text()}`);
});
await page.waitForFunction(() => !!window.__dwu?.game && window.__dwu.view?.deepStarfield?.ready === true, null, { timeout: 300000 });
await page.evaluate(() => {
    window.__dwu.time.paused = true;
});
await page.waitForTimeout(1500);
const env = await page.evaluate(() => ({ dpr: devicePixelRatio, res: window.__dwu.app.renderer.resolution, w: window.__dwu.camera.width, h: window.__dwu.camera.height }));
console.log('env', JSON.stringify(env));

// Scenarios: { name, frames, perFrame: [{ wheel: deltaY, ctrl } | { pan: [dx, dy] }] }.
const SCEN = [
    { name: 'pinch-in', frames: 90, ev: [{ wheel: -1.5, ctrl: true }, { wheel: -1.5, ctrl: true }] },
    { name: 'pinch-out', frames: 90, ev: [{ wheel: 1.5, ctrl: true }, { wheel: 1.5, ctrl: true }] },
    { name: 'pinch-jitter', frames: 90, ev: [{ wheel: -2, ctrl: true }, { wheel: 1.6, ctrl: true }] },
    { name: 'scroll-zoom', frames: 60, ev: [{ wheel: -4, ctrl: false }] },
    { name: 'pan-slow', frames: 90, ev: [{ pan: [1, 0.5] }] },
    { name: 'pan-fast', frames: 60, ev: [{ pan: [7, -3] }] },
];

for (const zoomF of [F, 2]) {
    for (const sc of SCEN) {
        const res = await page.evaluate(
            async ({ sc, zoomF }) => {
                const d = window.__dwu;
                const cam = d.camera;
                const g = d.game.galaxy;
                const cap = d.game.playerEmpire?.capital ?? null;
                const star = cap !== null ? g.systems[cap.systemIndex]?.systemStar ?? cap : g.habitats[0];
                cam.centerOn(star.xpos + 37, star.ypos - 23);
                cam.zoom = cam.clampZoom(1 / zoomF);
                const sf = d.view.deepStarfield;
                const canvas = d.app.canvas;
                const rect = canvas.getBoundingClientRect();
                // Cursor a bit off-centre (Mouse scroll-wheel behaviour 2 anchors zoom-ins on it).
                const cx = rect.left + rect.width * 0.62;
                const cy = rect.top + rect.height * 0.41;
                const afterRender = () => new Promise((r) => d.app.ticker.addOnce(() => r(), null, -100));
                for (let i = 0; i < 3; i++) await afterRender();
                const r = d.app.renderer.resolution;
                const read = () => ({
                    l: sf.layers.map((pc, i) => [pc.position.x * r, pc.position.y * r, sf.layerData[i].tile * r]),
                    // Device-px position of the world point at the view centre (map content).
                    c: [cam.x, cam.y, cam.zoom],
                });
                const rows = [read()];
                for (let f = 0; f < sc.frames; f++) {
                    for (const e of sc.ev) {
                        if (e.pan) cam.panByScreen(e.pan[0], e.pan[1]);
                        else canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: e.wheel, deltaMode: 0, ctrlKey: e.ctrl, clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
                    }
                    await afterRender();
                    rows.push(read());
                }
                return { rows, divisors: [38, 20, 11, 6], r };
            },
            { sc, zoomF },
        );
        if (sc.name === 'pinch-in') {
            // A mid-zoom frame.
            await page.screenshot({ path: `${outDir}/starjit-F${zoomF}-${sc.name}.png` });
        }
        const { rows, divisors, r } = res;
        const out = [];
        for (let li = 0; li < 4; li++) {
            let sum = 0;
            let max = 0;
            let rev = 0;
            let prevSign = 0;
            let dev = 0;
            let movedStill = 0;
            let stillFrames = 0;
            for (let f = 1; f < rows.length; f++) {
                const [x0, y0, tile] = rows[f - 1].l[li];
                const [x1, y1] = rows[f].l[li];
                let dx = x1 - x0;
                let dy = y1 - y0;
                if (Math.abs(dx) > tile / 2) dx -= Math.sign(dx) * tile;
                if (Math.abs(dy) > tile / 2) dy -= Math.sign(dy) * tile;
                const step = Math.hypot(dx, dy);
                sum += step;
                max = Math.max(max, step);
                const s = Math.sign(dx);
                if (s !== 0) {
                    if (prevSign !== 0 && s !== prevSign) rev++;
                    prevSign = s;
                }
                // Ideal: the map content at the view centre moved by -(cam delta)·zoom device px; the layer by that / divisor.
                const [ax, ay, az0] = rows[f - 1].c;
                const [bx, by, az1] = rows[f].c;
                const zm = (az0 + az1) / 2;
                const ix = (-(bx - ax) * zm * r) / divisors[li];
                const iy = (-(by - ay) * zm * r) / divisors[li];
                dev += Math.hypot(dx - ix, dy - iy);
                if (Math.abs(bx - ax) < 1e-9 && Math.abs(by - ay) < 1e-9) {
                    stillFrames++;
                    if (step > 0) movedStill++;
                }
            }
            const n = rows.length - 1;
            out.push({
                layer: li,
                meanStep: +(sum / n).toFixed(2),
                maxStep: +max.toFixed(1),
                reversals: rev,
                meanDevFromIdeal: +(dev / n).toFixed(2),
                movedWhileCentreStill: `${movedStill}/${stillFrames}`,
            });
        }
        const z0 = rows[0].c[2];
        const z1 = rows[rows.length - 1].c[2];
        console.log(`F=${zoomF} ${sc.name} zoom ${(1 / z0).toFixed(3)} -> ${(1 / z1).toFixed(3)}`);
        for (const o of out) console.log('   ', JSON.stringify(o));
    }
}
if (logs.length) console.log(logs.slice(0, 10).join('\n'));
await close();
