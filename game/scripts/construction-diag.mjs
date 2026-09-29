// Diagnose the construction mask: ship at ~90px, with/without mask, unbuilt 45% and 0. Prints pixel counts.
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
const [base = 'http://localhost:5183/', outDir = 'shots'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('console', (m) => console.log(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(`${base}?autostart=1`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 120000 });
await page.waitForTimeout(3000);
const info = await page.evaluate(async () => {
  const { galaxy, camera, view } = window.__dwu;
  const player = galaxy.playerEmpire;
  const ship = player.builtObjects.filter((b) => b && b.components && b.components.count > 4 && b.role !== 4).sort((a, b) => b.size - a.size)[0];
  window.__ship = ship;
  window.__total = ship.components.count;
  ship.speed = 0; if ('currentSpeed' in ship) ship.currentSpeed = 0;
  return { name: ship.name, total: ship.components.count, size: ship.size, x: ship.xpos, y: ship.ypos };
});
console.log('ship', JSON.stringify(info));
async function frame(unbuilt, noMask) {
  return page.evaluate(async ({ unbuilt, noMask }) => {
    const { camera, view } = window.__dwu; const s = window.__ship;
    s.unbuiltComponentCount = unbuilt; window.__dwuNoConstructionMask = noMask;
    if (window.__z) { camera.zoomAt(window.__z, camera.width / 2, camera.height / 2); }
    else {
    for (let i = 0; i < 6; i++) {
      camera.centerOn(s.xpos, s.ypos);
      const px = view.builtObjectLayer.drawnSizePx(s) || 20;
      if (Math.abs(px - 90) < 10) break;
      camera.zoomAt(camera.zoom * (90 / px), camera.width / 2, camera.height / 2);
      await new Promise((r) => setTimeout(r, 300));
    }
    window.__z = camera.zoom; }
    camera.centerOn(s.xpos, s.ypos);
    await new Promise((r) => setTimeout(r, 700));
    const sp = view.builtObjectLayer.sprites.get(s);
    return { px: view.builtObjectLayer.drawnSizePx(s), zoom: camera.zoom, visible: sp?.visible, mask: !!sp?.mask, maskTex: sp?.mask ? [sp.mask.texture.width, sp.mask.texture.height, sp.mask.position.x, sp.mask.position.y, sp.mask.scale.x, sp.mask.rotation, sp.mask.renderable] : null, spr: sp ? [sp.position.x, sp.position.y, sp.scale.x, sp.rotation] : null, moved: [s.xpos, s.ypos] };
  }, { unbuilt, noMask });
}
const results = {};
for (const [name, unbuilt, noMask] of [['built0', 0, false], ['nomask45', 0.45, true], ['mask45', 0.45, false]]) {
  const total = info.total;
  const r = await frame(name === 'built0' ? 0 : Math.round(total * unbuilt), noMask);
  const file = `${outDir}/diag-${name}.png`;
  await page.screenshot({ path: file });
  console.log(name, JSON.stringify(r), 'file', file);
}
await browser.close();
