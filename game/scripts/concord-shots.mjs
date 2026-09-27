// 19a Concord art captures (4K: 1920×1080 CSS px at device scale 2). Usage: node scripts/concord-shots.mjs <baseUrl> <outDir>
// Boots `?autostart=1&scenario=rimTrade&aiRace=Oranthi`, pauses the clock, and uses dev placement (as the 19a treasure
// test does: meet every empire, run the treasure-fleet handler, then a few hundred sim frames) instead of playing
// years. Close-ups: the layer's own textures (concordArt.ts) at the ship layer's size formula next to the original
// Ackdarian frame the race borrows; the fleet, port and diplomacy shots are the live game.
import { chromium } from 'playwright-core';
const [base = 'http://localhost:5173/', outDir = 'shots'] = process.argv.slice(2);
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${base}?autostart=1&scenario=rimTrade&aiRace=Oranthi`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 180000 });
await page.waitForTimeout(3000);

const setup = await page.evaluate(async () => {
    const { galaxy, time } = window.__dwu;
    time.paused = true;
    const common = await import('/src/sim/scenario/rimTrade/common.ts');
    const tf = await import('/src/sim/scenario/rimTrade/treasureFleet.ts');
    const dip = await import('/src/sim/diplomacy.ts');
    const sch = await import('/src/sim/tick/scheduler.ts');
    const r = common.rimTraderEmpire(galaxy);
    if (r === null) return { err: 'no Concord' };
    const others = galaxy.empires.filter((e) => e !== null && e !== r && e.active && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null);
    for (const e of others) {
        dip.obtainDiplomaticRelation(r, e).type = dip.DiplomaticRelationType.None;
        dip.obtainDiplomaticRelation(e, r).type = dip.DiplomaticRelationType.None;
    }
    const st = tf.treasureState(galaxy);
    st.contactDone = true;
    tf.treasureFleetTick(galaxy);
    const port = common.rimTraderPort(galaxy);
    for (let i = 0; i < 900; i++) sch.runSimFrame(galaxy, sch.nextFrameMs(sch.schedulerState(galaxy), 4));
    const lead = st.treasure[0] ?? st.ships[0] ?? null;
    return {
        concord: r.name,
        ships: st.ships.length,
        treasure: st.treasure.length,
        sailing: st.sailing,
        lead: lead ? [Math.round(lead.xpos), Math.round(lead.ypos)] : null,
        port: port ? [Math.round(port.xpos), Math.round(port.ypos), port.name] : null,
        concordObjects: galaxy.builtObjects.filter((b) => b !== null && b.empire === r).length,
    };
});
console.log('setup', JSON.stringify(setup));

async function view(fn, arg, wait = 2500) {
    await page.evaluate(fn, arg);
    await page.waitForTimeout(wait);
}

// Fleet at galaxy / sector / system zoom.
const fleetAt = async (zoomExpr, file) => {
    await view(async (z) => {
        const { galaxy, camera } = window.__dwu;
        const tf = await import('/src/sim/scenario/rimTrade/treasureFleet.ts');
        const hud = await import('/src/ui/hud.ts');
        const st = tf.treasureState(galaxy);
        const lead = st.treasure[0] ?? st.ships[0];
        const zoom = z === 'galaxy' ? camera.minZoom : z === 'sector' ? hud.SECTOR_LEVEL_ZOOM : hud.SYSTEM_LEVEL_ZOOM;
        camera.centerOn(lead.xpos, lead.ypos);
        camera.zoomAt(zoom, camera.width / 2, camera.height / 2);
        camera.centerOn(lead.xpos, lead.ypos);
    }, zoomExpr, 4000);
    await page.screenshot({ path: `${outDir}/${file}` });
    console.log(`saved ${outDir}/${file}`);
};
await fleetAt('galaxy', 'concord-fleet-galaxy.png');
await fleetAt('sector', 'concord-fleet-sector.png');
await fleetAt('system', 'concord-fleet-system.png');

// The Concord's space port.
await view(async () => {
    const { galaxy, camera } = window.__dwu;
    const common = await import('/src/sim/scenario/rimTrade/common.ts');
    const port = common.rimTraderPort(galaxy);
    camera.zoomAt(1 / 1.5, camera.width / 2, camera.height / 2);
    camera.centerOn(port.xpos, port.ypos);
}, null, 4000);
await page.screenshot({ path: `${outDir}/concord-port.png` });
console.log(`saved ${outDir}/concord-port.png`);

// Showcase rows: the layer's textures at the layer's size formula (f = 1 / zoom), labels as DOM overlays.
const showcase = async (rows, zoom, file) => {
    const info = await page.evaluate(
        async ({ rows, zoom }) => {
            const { galaxy, camera, view } = window.__dwu;
            const ca = await import('/src/render/concordArt.ts');
            const bol = await import('/src/render/builtObjectLayer.ts');
            const sa = await import('/src/render/shipArt.ts');
            const fxc = await import('/src/render/fxCommon.ts');
            window.__concordShow?.destroy?.();
            document.querySelectorAll('.concord-show-label').forEach((n) => n.remove());
            const holder = new ca.ConcordFxLayer();
            view.world.addChild(holder.root);
            const pool = new fxc.SpritePool(holder.root);
            const fx = new ca.ConcordFxLayer();
            view.world.addChild(fx.root);
            window.__concordShow = { destroy: () => (holder.root.destroy({ children: true }), fx.root.destroy({ children: true })) };
            const cx = galaxy.sizeX * 0.5;
            const cy = galaxy.sizeY * 0.03;
            const f = 1 / zoom;
            const dx = 300;
            const dy = 330;
            pool.begin();
            fx.begin();
            let frame = 1e7 + Math.floor(Math.random() * 1e6);
            const labels = [];
            for (let r = 0; r < rows.length; r++) {
                const row = rows[r];
                for (let c = 0; c < row.items.length; c++) {
                    const it = row.items[c];
                    const x = cx + (c - (row.items.length - 1) / 2) * dx;
                    const y = cy + (r - (rows.length - 1) / 2) * dy;
                    let tex;
                    let metrics;
                    let art = null;
                    if (it.ackdarian) {
                        const a = await sa.loadShipArt(`/assets/dwu/images/units/ships/family7/${it.ackdarian}.png`);
                        tex = a.texture;
                        metrics = a.metrics;
                    } else {
                        art = ca.concordShipArt({ kind: it.kind, bucket: ca.concordSizeBucket(it.size), look: it.look }, frame++);
                        tex = art.texture;
                        metrics = art.metrics;
                    }
                    const px = bol.builtObjectSizePx(it.size, metrics.areaRatio, f, 0, 1);
                    const s = pool.acquire(tex);
                    s.anchor.set(metrics.cropCenterX / tex.width, metrics.cropCenterY / tex.height);
                    s.position.set(x, y);
                    s.rotation = 0;
                    s.scale.set(px / metrics.cropSide / zoom);
                    if (art !== null) fx.draw(art, x, y, 0, px / metrics.cropSide / zoom, s.anchor.x, s.anchor.y, 7 + c, px, 1000 * 0.3);
                    labels.push({ x, y: y + dy * 0.42, text: it.label });
                }
                labels.push({ x: cx - ((row.items.length + 0.2) / 2) * dx, y: cy + (r - (rows.length - 1) / 2) * dy, text: row.label, left: true });
            }
            pool.end();
            fx.end();
            camera.zoomAt(zoom, camera.width / 2, camera.height / 2);
            camera.centerOn(cx, cy);
            for (const l of labels) {
                const p = camera.worldToScreen(l.x, l.y);
                const d = document.createElement('div');
                d.className = 'concord-show-label';
                d.textContent = l.text;
                d.style.cssText = `position:fixed;left:${p.x}px;top:${p.y}px;transform:translate(${l.left ? '-100%' : '-50%'},-50%);color:#e8d8b0;font:${zoom >= 1 ? 14 : 11}px sans-serif;background:rgba(0,0,0,0.55);padding:2px 6px;border-radius:3px;z-index:50;pointer-events:none;white-space:nowrap`;
                document.body.appendChild(d);
            }
            return { f, n: labels.length };
        },
        { rows, zoom },
    );
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${outDir}/${file}` });
    console.log(`saved ${outDir}/${file}`, JSON.stringify(info));
};
const row = (look, label) => ({
    label,
    items: [
        { kind: 'warship', size: 700, look, label: `warship (size 700)` },
        { kind: 'freighter', size: 900, look, label: `freighter (size 900)` },
        { kind: 'treasure', size: 1100, look, label: `treasure ship (size 1100)` },
        { ackdarian: look === 'hybrid' ? 'cruiser' : look === 'pagoda' ? 'largefreighter' : 'capitalship', size: look === 'hybrid' ? 700 : look === 'pagoda' ? 900 : 1100, label: `Ackdarian ${look === 'hybrid' ? 'cruiser 700' : look === 'pagoda' ? 'freighter 900' : 'capital 1100'}` },
    ],
});
const variantRows = [row('hybrid', 'A hybrid'), row('pagoda', 'B pagoda'), row('furled', 'C furled')];
await showcase(variantRows, 1, 'concord-variants-close.png');
await showcase(variantRows, 1 / 3, 'concord-variants-play.png');

// Live ships at 100 %: a Concord warship, freighter and treasure ship moved side by side (clock paused) with the
// Ackdarian cruiser frame beside them for comparison.
const live = await page.evaluate(async () => {
    const { galaxy, camera, view } = window.__dwu;
    window.__concordShow?.destroy?.();
    document.querySelectorAll('.concord-show-label').forEach((n) => n.remove());
    const common = await import('/src/sim/scenario/rimTrade/common.ts');
    const tf = await import('/src/sim/scenario/rimTrade/treasureFleet.ts');
    const ca = await import('/src/render/concordArt.ts');
    const bol = await import('/src/render/builtObjectLayer.ts');
    const sa = await import('/src/render/shipArt.ts');
    const fxc = await import('/src/render/fxCommon.ts');
    const T = await import('/src/sim/builtObjectTypes.ts');
    const S = T.BuiltObjectSubRole;
    const r = common.rimTraderEmpire(galaxy);
    const st = tf.treasureState(galaxy);
    const mine = galaxy.builtObjects.filter((b) => b !== null && !b.hasBeenDestroyed && b.empire === r && b.builtAt === null && !st.treasure.includes(b));
    const war = mine.filter((b) => b.subRole >= S.Escort && b.subRole <= S.CapitalShip).sort((a, b) => b.size - a.size)[0] ?? null;
    const frt = mine.filter((b) => b.subRole >= S.SmallFreighter && b.subRole <= S.LargeFreighter).sort((a, b) => b.size - a.size)[0] ?? null;
    const tre = st.treasure[0] ?? null;
    const cx = galaxy.sizeX * 0.5;
    const cy = galaxy.sizeY * 0.03 + 2000;
    const placed = [];
    [war, frt, tre].forEach((b, i) => {
        if (b === null) return;
        b.xpos = cx + (i - 1.5) * 300;
        b.ypos = cy;
        b.heading = -Math.PI / 2;
        placed.push(`${T.BuiltObjectSubRole[b.subRole]} ${b.size}`);
    });
    const a = await sa.loadShipArt('/assets/dwu/images/units/ships/family7/cruiser.png');
    const holder = new ca.ConcordFxLayer();
    view.world.addChild(holder.root);
    const pool = new fxc.SpritePool(holder.root);
    pool.begin();
    const s = pool.acquire(a.texture);
    const size = war?.size ?? 700;
    const px = bol.builtObjectSizePx(size, a.metrics.areaRatio, 1, 0, 1);
    s.anchor.set(a.metrics.cropCenterX / a.texture.width, a.metrics.cropCenterY / a.texture.height);
    s.position.set(cx + 1.5 * 300, cy);
    s.scale.set(px / a.metrics.cropSide);
    pool.end();
    camera.zoomAt(1, camera.width / 2, camera.height / 2);
    camera.centerOn(cx, cy);
    return { placed, ackdarianSize: size };
});
console.log('live', JSON.stringify(live));
await page.waitForTimeout(4000);
console.log('layer', JSON.stringify(await page.evaluate(() => {
    const { view } = window.__dwu;
    const layer = view.builtObjectLayer;
    let visible = 0;
    for (const s of layer.sprites.values()) if (s.visible) visible++;
    // Three overlays (detail at close zoom, sheen, glow) per visible Concord junk.
    return { visibleShipSprites: visible, concordFxSprites: layer.concordFx.root.children.filter((c) => c.visible).length };
})));
await page.screenshot({ path: `${outDir}/concord-ships-close.png` });
console.log(`saved ${outDir}/concord-ships-close.png`);

// Diplomacy screen with the Concord selected.
await page.evaluate(async () => {
    const { galaxy } = window.__dwu;
    const common = await import('/src/sim/scenario/rimTrade/common.ts');
    const dip = await import('/src/sim/diplomacy.ts');
    const ds = await import('/src/ui/screens/diplomacyScreen.ts');
    const r = common.rimTraderEmpire(galaxy);
    const p = galaxy.playerEmpire;
    if (dip.obtainDiplomaticRelation(p, r).type === dip.DiplomaticRelationType.NotMet) {
        dip.obtainDiplomaticRelation(p, r).type = dip.DiplomaticRelationType.None;
        dip.obtainDiplomaticRelation(r, p).type = dip.DiplomaticRelationType.None;
    }
    ds.toggleDiplomacyScreen({ player: p });
    const row = Array.from(document.querySelectorAll('.diplomacy-row')).find((n) => n.textContent.includes(r.name));
    row?.click();
});
await page.waitForTimeout(500);
console.log('diplomacy', JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('.diplomacy-portrait, .diplomacy-flag')).map((i) => ({ cls: i.className, w: i.naturalWidth, h: i.naturalHeight, generated: i.src.startsWith('data:image/png') })))));
await page.waitForTimeout(2500);
await page.screenshot({ path: `${outDir}/concord-diplomacy.png` });
console.log(`saved ${outDir}/concord-diplomacy.png`);

await browser.close();
for (const l of logs) if (!l.startsWith('[debug]') && !l.includes('[vite]')) console.log(l);
