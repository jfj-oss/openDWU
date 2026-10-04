#!/usr/bin/env node
// Parity batch C3 screenshots (render side): Fleet Postures, Long Range Scanners, fleet travel vectors (other empires',
// the selected fleet in yellow, special-highlight red, arrowheads), battle bars at f <= 3, ion-strike lightning,
// fighter selection, weapon-range circles. Saves PNGs and prints the page's console errors — it does not judge them.
//
//   node scripts/parityC3-shots.mjs <base url> [--load=/dev-saves/late2500.dwusave] [--out=shots/parityC3] [--worker]
//
// In-thread mode (default) loads the save paused and, where the save has nothing to show (no fight in view, no ion
// strike, no boarding), the SCRIPT stages it on the in-thread game (inBattle / lastIonStrike / assault values) — test
// staging only; the renderer itself never writes the game. --worker boots ?simWorker=1 and only screenshots the
// overlays (the replica is read-only).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const opt = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const worker = process.argv.includes('--worker');
const load = opt('load', '/dev-saves/late2500.dwusave');
const out = opt('out', 'shots/parityC3');
mkdirSync(out, { recursive: true });
const overlays = 'fleetPostures,longRangeScanners,travelVectorsState,travelVectorsPrivate';
const url = `${base}?load=${encodeURIComponent(load)}&simWorker=${worker ? 1 : 0}&overlays=${overlays}&rangeCircles=1`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.stack ?? e.message}`));
const shots = [];
const shot = async (name) => {
    await page.waitForTimeout(2500);
    const path = `${out}/${worker ? 'worker-' : ''}${name}.png`;
    await page.screenshot({ path });
    shots.push(path);
    console.log(`shot ${path}`);
};
/** Centre the camera on (x, y) at zoom factor f (world units per px). */
const view = (x, y, f) =>
    page.evaluate(
        ([x, y, f]) => {
            const cam = window.__dwu.camera;
            cam.centerOn(x, y);
            cam.zoom = cam.clampZoom(1 / f);
        },
        [x, y, f],
    );
try {
    await page.goto(url);
    await page.waitForFunction(() => !!window.__dwu?.game && !!window.__dwu?.time && !!window.__dwu?.view, null, { timeout: 900000 });
    await page.evaluate(() => {
        window.__dwu.time.paused = true;
    });
    await page.waitForTimeout(3000);

    // 1. Fleet Postures: a player fleet with an attack point / gather point and a drawn range.
    const posture = await page.evaluate(() => {
        const g = window.__dwu.game.galaxy;
        const p = g.playerEmpire;
        let best = null;
        for (const sg of p.shipGroups) {
            if (sg === null || sg.leadShip === null) continue;
            const c = sg.posture === 0 ? sg.attackPoint : sg.gatherPoint;
            if (c === null) continue;
            const r = sg.postureRangeSquared > 2250000 && sg.postureRangeSquared < 3.4e38 ? Math.sqrt(sg.postureRangeSquared) : 0;
            if (best === null || r > best.r) best = { x: c.xpos, y: c.ypos, r, n: sg.name };
        }
        return { best, fleets: p.shipGroups.length };
    });
    console.log(`postures: ${JSON.stringify(posture)}`);
    if (posture.best !== null) {
        await view(posture.best.x, posture.best.y, Math.max(200, (posture.best.r * 2.5) / 900));
        await shot('fleet-postures');
    }

    // 2. Long Range Scanners: around the player's first scanner, sector zoom.
    const lrs = await page.evaluate(() => {
        const p = window.__dwu.game.galaxy.playerEmpire;
        let s = p.longRangeScanners.find((b) => b !== null && (b.role === 8 || b.currentSpeed === 0)) ?? null;
        let staged = false;
        if (s === null && !window.__dwu.simWorker) {
            // Staging (in-thread only): the save's player has no scanner; give two of its bases one.
            const bases = p.builtObjects.filter((b) => b && b.role === 8 && !b.hasBeenDestroyed).slice(0, 2);
            for (const b of bases) {
                b.sensorLongRange = 400000;
                p.longRangeScanners.push(b);
            }
            s = bases[0] ?? null;
            staged = s !== null;
        }
        return s === null ? null : { x: s.xpos, y: s.ypos, r: s.sensorLongRange, n: p.longRangeScanners.length, staged };
    });
    console.log(`scanners: ${JSON.stringify(lrs)}`);
    if (lrs !== null) {
        await view(lrs.x, lrs.y, Math.max(300, (lrs.r * 4) / 900));
        await shot('long-range-scanners');
    }

    // 3. Travel vectors: select a moving player fleet (yellow) and look at f = 1500 (the fleet pass), other fleets grey.
    const fleet = await page.evaluate(() => {
        const g = window.__dwu.game.galaxy;
        const p = g.playerEmpire;
        const moving = p.shipGroups.find((sg) => sg?.leadShip && sg.leadShip.currentSpeed > sg.leadShip.topSpeed && sg.leadShip.mission) ?? p.shipGroups.find((sg) => sg?.leadShip) ?? null;
        if (moving === null) return null;
        window.__dwu.view.onShipGroupSelect?.(moving);
        return { x: moving.leadShip.xpos, y: moving.leadShip.ypos, name: moving.name, speed: moving.leadShip.currentSpeed };
    });
    console.log(`fleet: ${JSON.stringify(fleet)}`);
    if (fleet !== null) {
        await view(fleet.x, fleet.y, 1500);
        await shot('fleet-travel-vectors');
    }
    // Special highlight: select a habitat that moving player ships (not in fleets) are heading to.
    const dest = await page.evaluate(() => {
        const g = window.__dwu.game.galaxy;
        const p = g.playerEmpire;
        const counts = new Map();
        for (const bo of [...p.builtObjects, ...p.privateBuiltObjects]) {
            if (!bo || bo.hasBeenDestroyed || bo.shipGroup || !bo.mission || !(bo.currentSpeed > bo.topSpeed)) continue;
            const t = bo.mission.target;
            if (t && typeof t.orbitAngle === 'number') counts.set(t, (counts.get(t) ?? 0) + 1);
        }
        let best = null;
        for (const [h, n] of counts) if (best === null || n > best.n) best = { h, n };
        if (best === null) return null;
        window.__dwu.view.onSelectionChange?.(best.h);
        return { x: best.h.xpos, y: best.h.ypos, n: best.n, name: best.h.name };
    });
    console.log(`highlight destination: ${JSON.stringify(dest && { ...dest })}`);
    if (dest !== null) {
        await view(dest.x, dest.y, 400);
        await shot('special-highlight-vectors');
    }

    if (!worker) {
        // 4. Battle bars at f = 1 on a player warship (staged: in battle, half shields, boarding; ion strike now).
        const bars = await page.evaluate(() => {
            const g = window.__dwu.game.galaxy;
            const p = g.playerEmpire;
            const ships = p.builtObjects.filter((b) => b && !b.hasBeenDestroyed && b.role === 1 && b.shieldsCapacity > 0);
            const bo = ships.find((b) => b.inBattle) ?? ships.find((b) => b.shipGroup && b.shipGroup.leadShip === b) ?? ships[0] ?? null;
            if (bo === null) return null;
            const near = ships.filter((b) => b !== bo && Math.hypot(b.xpos - bo.xpos, b.ypos - bo.ypos) < 600).slice(0, 4);
            for (const b of [bo, ...near]) {
                b.inBattle = true;
                b.currentShields = Math.floor(b.shieldsCapacity * 0.6);
            }
            bo.assaultAttackValue = 30;
            bo.assaultDefenseValue = 40;
            bo.assaultDefenseValueFixed = 15;
            bo.assaultDefenseValueDefault = 40;
            bo.lastIonStrike = g.nowMs;
            window.__dwu.view.onBuiltObjectSelect?.(bo);
            return { x: bo.xpos, y: bo.ypos, name: bo.name, lead: !!(bo.shipGroup && bo.shipGroup.leadShip === bo), weapons: bo.weapons.length };
        });
        console.log(`battle bars: ${JSON.stringify(bars)}`);
        if (bars !== null) {
            await view(bars.x, bars.y, 1);
            await shot('battle-bars-ion-strike');
            // 7. Weapon-range circles (?rangeCircles=1) for the selected ship.
            await view(bars.x, bars.y, 4);
            await shot('weapon-range-circles');
        }
        // 6. A launched fighter, selected (method_212 circle) — stage a launch position next to a carrier if none flies.
        const fighter = await page.evaluate(() => {
            const g = window.__dwu.game.galaxy;
            let fi = null;
            for (const bo of g.builtObjects) {
                if (!bo || !bo.fighters) continue;
                fi = bo.fighters.find((f) => f && !f.onboardCarrier && !f.hasBeenDestroyed) ?? null;
                if (fi) break;
            }
            if (fi === null) {
                const carrier = g.playerEmpire.builtObjects.find((b) => b && b.fighters && b.fighters.some((f) => f && !f.underConstruction));
                if (!carrier) return null;
                fi = carrier.fighters.find((f) => f && !f.underConstruction);
                fi.onboardCarrier = false;
                fi.xpos = carrier.xpos + 120;
                fi.ypos = carrier.ypos;
                fi.inBattle = true;
                fi.currentShields = Math.floor(fi.specification.shieldsCapacity / 2);
            }
            window.__dwu.view.onFighterSelect?.(fi);
            return { x: fi.xpos, y: fi.ypos, name: fi.name };
        });
        console.log(`fighter: ${JSON.stringify(fighter)}`);
        if (fighter !== null) {
            await view(fighter.x, fighter.y, 0.5);
            await shot('fighter-selection');
            await view(fighter.x, fighter.y, 1);
            await shot('fighter-shield-line');
        }
    }
} catch (e) {
    console.log(`error: ${e.stack ?? e}`);
} finally {
    console.log(`console errors/warnings (${logs.length}):`);
    for (const l of logs.slice(0, 40)) console.log(`  ${l}`);
    console.log(`screenshots:\n${shots.map((s) => `  ${s}`).join('\n')}`);
    await browser.close();
}
