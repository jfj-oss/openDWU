// Selection panel captures: boots ?autostart=1, then selects one object of each kind the panel draws and saves the
// bottom-left frame (and one full frame). Usage: node scripts/selpanel-shots.mjs <baseUrl> <outDir> [w] [h] [dpr]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const [base = 'http://localhost:5173/', outDir = 'shots/selpanel', w = '1920', h = '1080', dpr = '1'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
const logs = [];
page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
if (process.env.SMALL) await page.addInitScript(() => localStorage.setItem('dwu.selectionPanelSmall', '1'));
await page.goto(`${base}?autostart=1${process.env.QUERY ?? ""}`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
await page.waitForTimeout(4000);
// Let the sim run a little (missions, fleets), then pause.
await page.evaluate(() => {
    const { time } = window.__dwu;
    if (time) time.paused = false;
});
await page.waitForTimeout(+(process.env.RUN_MS ?? 8000));
await page.evaluate(() => {
    const { time } = window.__dwu;
    if (time) time.paused = true;
});

/** Select `kind` in the page; returns a label or null when there is nothing of that kind. */
async function select(kind) {
    return page.evaluate(async (kind) => {
        const { galaxy, camera } = window.__dwu;
        const hud = await import('/src/ui/hud.ts');
        const player = galaxy.playerEmpire;
        const own = player.builtObjects.filter((b) => !b.hasBeenDestroyed);
        const zoomSystem = (x, y) => {
            camera.centerOn(x, y);
            camera.zoomAt(hud.SYSTEM_LEVEL_ZOOM, camera.width / 2, camera.height / 2);
        };
        const pick = (bo) => {
            if (!bo) return null;
            zoomSystem(bo.xpos, bo.ypos);
            hud.selectStellarObject(bo, false);
            return bo.name;
        };
        switch (kind) {
            case 'ship': {
                const m = own.filter((b) => b.role === 1 && b.unbuiltComponentCount === 0);
                const carrier = m.find((b) => (b.fighterCapacity ?? 0) > 0);
                return pick(carrier ?? m[0] ?? own.find((b) => b.role !== 8));
            }
            case 'constructionShip':
                return pick(own.find((b) => b.role === 6) ?? player.constructionShips?.[0]);
            case 'spaceport': {
                const bases = own.filter((b) => b.role === 8 || b.constructionQueue);
                const port = bases.find((b) => b.constructionQueue && (b.constructionQueue.constructionYards?.length ?? 0) > 0);
                return pick(port ?? bases[0]);
            }
            case 'colony': {
                const cap = player.capital;
                zoomSystem(cap.xpos, cap.ypos);
                hud.selectHabitat(cap, false);
                return cap.name;
            }
            case 'independent': {
                const ind = galaxy.habitats.filter((x) => x.empire !== null && x.empire === galaxy.independentEmpire && x.population.totalAmount > 0);
                const vis = ind.find((x) => player.visibility.checkSystemVisibilityStatus(x.systemIndex) !== 0) ?? ind[0];
                if (!vis) return null;
                zoomSystem(vis.xpos, vis.ypos);
                hud.selectHabitat(vis, false);
                return vis.name;
            }
            case 'planet': {
                const sys = galaxy.systems[player.capital.systemIndex];
                const p = sys.habitats.find((x) => x.empire === null && (x.category === 1 || x.category === 2) && x.resources.length > 0) ?? sys.habitats.find((x) => x.empire === null && x.category !== 0);
                if (!p) return null;
                zoomSystem(p.xpos, p.ypos);
                hud.selectHabitat(p, false);
                return p.name;
            }
            case 'system': {
                const star = galaxy.systems[player.capital.systemIndex].systemStar;
                camera.centerOn(star.xpos, star.ypos);
                camera.zoomAt(1 / 3000, camera.width / 2, camera.height / 2);
                hud.selectHabitat(star, false);
                return star.name;
            }
            case 'star': {
                const star = galaxy.systems[player.capital.systemIndex].systemStar;
                zoomSystem(star.xpos, star.ypos);
                hud.selectHabitat(star, false);
                return star.name;
            }
            case 'fleet': {
                const sg = (player.shipGroups ?? []).find((g) => g && g.ships.length > 0);
                if (!sg) return null;
                zoomSystem(sg.leadShip.xpos, sg.leadShip.ypos);
                hud.selectShipGroup(sg, false);
                return sg.name;
            }
            case 'multi': {
                const ships = own.filter((b) => b.role !== 8).slice(0, 9);
                if (ships.length < 2) return null;
                zoomSystem(ships[0].xpos, ships[0].ypos);
                hud.selectBuiltObjectList(ships);
                return `${ships.length} ships`;
            }
            case 'otherShip': {
                const fog = (await import('/src/render/fog.ts')).fogOf(galaxy);
                const all = galaxy.empires.filter((e) => e !== player && e !== galaxy.independentEmpire).flatMap((e) => e.builtObjects);
                const bo = all.find((b) => !b.hasBeenDestroyed && b.role !== 8 && !fog.selectionUnseen({ habitat: b, system: null, builtObject: b }))
                    ?? galaxy.empires.flatMap((e) => (e === player ? [] : e.builtObjects)).find((b) => !b.hasBeenDestroyed && !fog.selectionUnseen({ habitat: b, system: null, builtObject: b }));
                return pick(bo);
            }
            case 'otherColony': {
                const other = galaxy.empires.find((e) => e !== player && e !== galaxy.independentEmpire && e.capital);
                if (!other) return null;
                zoomSystem(other.capital.xpos, other.capital.ypos);
                hud.selectHabitat(other.capital, false);
                return other.capital.name;
            }
            case 'creature': {
                const fog = (await import('/src/render/fog.ts')).fogOf(galaxy);
                const c = (galaxy.creatures ?? []).find((x) => !x.hasBeenDestroyed && !fog.selectionUnseen({ habitat: null, system: null, creature: x })) ?? (galaxy.creatures ?? []).find((x) => !x.hasBeenDestroyed);
                if (!c) return null;
                zoomSystem(c.xpos, c.ypos);
                hud.selectCreature(c, false);
                return c.name;
            }
            case 'miningStation': {
                const st = galaxy.empires.flatMap((e) => e.builtObjects).find((b) => /Mining/.test(b.name) && !b.hasBeenDestroyed);
                return pick(st);
            }
            case 'blackHole': {
                const sys = galaxy.systems.find((s) => s.systemStar.type === 6) ?? galaxy.systems.find((s) => s.systemStar.category === 4);
                if (!sys) return null;
                camera.centerOn(sys.systemStar.xpos, sys.systemStar.ypos);
                camera.zoomAt(1 / 3000, camera.width / 2, camera.height / 2);
                hud.selectHabitat(sys.systemStar, false);
                return sys.systemStar.name;
            }
            case 'none':
                hud.setSelection(null);
                return 'none';
        }
        return null;
    }, kind);
}

const kinds = (process.env.KINDS ?? 'ship,colony,independent,system,spaceport,fleet,multi,otherShip,otherColony,planet,star,creature,miningStation,constructionShip,blackHole').split(',');
const frameH = Math.round(560 * (+h / 1080));
const frameW = Math.round(720 * (+h / 1080));
for (const kind of kinds) {
    const name = await select(kind);
    if (name === null) {
        console.log(`${kind}: (nothing to select)`);
        continue;
    }
    await page.waitForTimeout(1500);
    const path = `${outDir}/selpanel-${kind}.png`;
    await page.screenshot({ path, clip: { x: 0, y: +h - frameH, width: frameW, height: frameH } });
    console.log(`${kind}: ${name} -> ${path}`);
    if (kind === 'ship') await page.screenshot({ path: `${outDir}/selpanel-full.png` });
    // The "More…" slot opens the overflow popup (dispatch orders beyond the empty action slots).
    const clickMore = () => page.evaluate(() => {
        const b = [...document.querySelectorAll('.order-action-extra')].find((x) => /More/.test(x.textContent ?? ''));
        b?.click();
        return b !== undefined;
    });
    if (process.env.MORE && (await clickMore())) {
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${outDir}/selpanel-${kind}-more.png`, clip: { x: 0, y: +h - frameH, width: frameW, height: frameH } });
        await clickMore();
    }
}
await browser.close();
for (const l of logs.slice(0, 40)) console.log(l);
