// Backdrop animation visibility: per Deep kind and zoom, frames N s apart (backdrop layer only), luminance diff.
// Usage: node scripts/backdropanim-measure.mjs <baseUrl> <outDir> [tag] [--gap=10]
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const gap = +(process.argv.find((a) => a.startsWith('--gap='))?.slice(6) ?? 10);
const [base = 'http://localhost:5173/', outDir = 'shots', tag = 'now'] = pos;
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const diff = (a, b) => {
    let sum = 0, ch = 0, la = 0;
    const n = a.length / 4;
    for (let i = 0; i < a.length; i += 4) {
        const ya = 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2];
        const yb = 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2];
        const d = Math.abs(ya - yb);
        sum += d; la += ya;
        if (d > 3) ch++;
    }
    return { mean: +(sum / n).toFixed(3), pct: +((100 * ch) / n).toFixed(2), luma: +(la / n).toFixed(2) };
};
const grab = async () => {
    const png = await page.screenshot();
    const raw = await page.evaluate(async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const x = c.getContext('2d');
        x.drawImage(bmp, 0, 0);
        return Array.from(x.getImageData(0, 0, bmp.width, bmp.height).data);
    }, png.toString('base64'));
    return { png, data: Uint8ClampedArray.from(raw) };
};
for (const kind of ['deep', 'deepAzure', 'deepEmber', 'deepViolet', 'dimmedOriginal']) {
    await page.goto(`${base.replace(/\/$/, '')}/?autostart=1&backdrop=${kind}`);
    await page.waitForFunction(() => !!window.__dwu?.game && !!window.__dwu?.time && !!window.__dwu.view?.deepAnim, null, { timeout: 180000 });
    await page.evaluate(() => {
        const d = window.__dwu;
        const bg = d.view.backdropGroup;
        for (const c of bg.parent.children) if (c !== bg) c.visible = false;
        const cv = d.app.canvas;
        let el = cv;
        while (el && el !== document.body) {
            for (const s of el.parentElement?.children ?? []) if (s !== el) s.style.visibility = 'hidden';
            el = el.parentElement;
        }
    });
    for (const z of ['galaxy', 'system']) {
        await page.evaluate(({ z }) => {
            const d = window.__dwu, cam = d.camera, g = d.game.galaxy;
            d.time.paused = false;
            if (z === 'galaxy') { cam.centerOn(g.sizeX / 2, g.sizeY / 2); cam.zoom = cam.minZoom; }
            else { const cap = d.game.playerEmpire?.capital; const s = g.systems[cap.systemIndex]?.systemStar ?? cap; cam.centerOn(s.xpos, s.ypos); cam.zoom = cam.clampZoom(1 / 50); }
        }, { z });
        await page.waitForTimeout(1500);
        const t0 = await page.evaluate(() => ({ t: window.__dwu.view.deepAnim.uniforms.uniforms.uT[0], vis: window.__dwu.view.deepAnim.root.visible, a: window.__dwu.view.deepAnim.uniforms.uniforms.uT[1], paused: window.__dwu.time.paused }));
        const f0 = await grab();
        await page.waitForTimeout(gap * 1000);
        const f1 = await grab();
        const t1 = await page.evaluate(() => window.__dwu.view.deepAnim.uniforms.uniforms.uT[0]);
        const r = diff(f0.data, f1.data);
        writeFileSync(`${outDir}/${tag}-${kind}-${z}-a.png`, f0.png);
        writeFileSync(`${outDir}/${tag}-${kind}-${z}-b.png`, f1.png);
        console.log(`${tag} ${kind} ${z} gap=${gap}s meanAbs=${r.mean} changed>3=${r.pct}% luma=${r.luma} uT.x ${t0.t.toFixed(2)}->${t1.toFixed(2)} vis=${t0.vis} alpha=${t0.a} pausedBefore=${t0.paused}`);
    }
}
await browser.close();
