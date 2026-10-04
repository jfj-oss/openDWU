#!/usr/bin/env node
// Screenshots for the fighters / selection-visuals batch (it does not judge them; it prints the page's console errors):
//   1. a selected fighter: its selection-panel buttons (Launch / Return this Fighter, Retire), the Bonuses line;
//      then the Launch button clicked (the panel shows Return this Fighter);
//   2. right-click with a ship selected and a launched fighter under the cursor (the action menu, "Move to …");
//   3. the original's pulsing selection circle (method_212) on a selected ship, a selected fleet's ships, a creature,
//      a planet, and at galaxy zoom on a ship symbol and a fleet icon;
//   4. list hover: an Enemy Targets / Pirate Missions / Fleets row hovered (yellow ping, red travel vectors);
//   5. Fleet Postures discs over close-zoom ships;
//   6. a creature as the selected destination: the red special-highlight vectors of the ships attacking it.
//
//   node scripts/fighters-shots.mjs <base url> [--load=/dev-saves/late2500.dwusave] [--out=shots/fighters] [--worker]
//
// In-thread mode stages what the save lacks (a launched fighter, an attack order on a creature) on the in-thread game —
// test staging only. Orders the script gives go through the UI (button clicks, the action menu) or window.__dwu.commands
// (issuePlayerCommand), so --worker (?simWorker=1) drives the same paths on the replica; staging is skipped there.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const opt = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const worker = process.argv.includes('--worker');
const load = opt('load', '/dev-saves/late2500.dwusave');
const out = opt('out', 'shots/fighters');
mkdirSync(out, { recursive: true });
const overlays = 'fleetPostures,travelVectorsState,travelVectorsPrivate';
const url = `${base}?load=${encodeURIComponent(load)}&simWorker=${worker ? 1 : 0}&overlays=${overlays}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.stack ?? e.message}`));
const shots = [];
const shot = async (name, wait = 2000) => {
    await page.waitForTimeout(wait);
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
/** The action-bar buttons' hints (the selection panel). */
const buttonHints = () => page.evaluate(() => [...document.querySelectorAll('.order-action-btn')].map((b) => `${b.title || '-'}${b.disabled ? ' (off)' : ''}`));

try {
    await page.goto(url);
    await page.waitForFunction(() => !!window.__dwu?.game && !!window.__dwu?.time && !!window.__dwu?.view, null, { timeout: 900000 });
    await page.evaluate(() => {
        window.__dwu.time.paused = true;
    });
    await page.waitForTimeout(3000);

    // 1. A player fighter: launched if one flies, else (in-thread) one staged next to its carrier.
    const fighter = await page.evaluate((worker) => {
        const g = window.__dwu.game.galaxy;
        const p = g.playerEmpire;
        let fi = null;
        let carrier = null;
        for (const bo of p.builtObjects) {
            if (!bo || !bo.fighters || bo.hasBeenDestroyed) continue;
            const f = bo.fighters.find((x) => x && !x.onboardCarrier && !x.hasBeenDestroyed) ?? null;
            if (f) {
                fi = f;
                carrier = bo;
                break;
            }
        }
        let staged = false;
        if (fi === null) {
            carrier = p.builtObjects.find((b) => b && !b.hasBeenDestroyed && b.fighters && b.fighters.some((f) => f && !f.underConstruction)) ?? null;
            if (carrier === null) return null;
            fi = carrier.fighters.find((f) => f && !f.underConstruction);
            if (!worker) {
                fi.onboardCarrier = false;
                fi.xpos = carrier.xpos + 160;
                fi.ypos = carrier.ypos - 40;
                staged = true;
            }
        }
        window.__dwu.view.selectedFighter = fi;
        window.__dwu.view.onFighterSelect?.(fi);
        return { x: fi.xpos, y: fi.ypos, cx: carrier.xpos, cy: carrier.ypos, name: fi.name, carrier: carrier.name, onboard: fi.onboardCarrier, inFleet: carrier.shipGroup !== null, staged };
    }, worker);
    console.log(`fighter: ${JSON.stringify(fighter)}`);
    if (fighter !== null) {
        await view(fighter.x, fighter.y, 0.6);
        await shot('fighter-selected-buttons');
        console.log(`  buttons: ${JSON.stringify(await buttonHints())}`);
        console.log(`  panel: ${JSON.stringify(await page.evaluate(() => document.querySelector('.sel-panel, [data-hud="pnlSelection"]')?.textContent?.replace(/\s+/g, ' ').slice(0, 400) ?? ''))}`);
        // Click the first action button (Return this Fighter / Launch this Fighter): a journaled shipAction command.
        await page.evaluate(() => document.querySelector('.order-action-btn')?.click());
        await page.evaluate(() => {
            window.__dwu.time.paused = false;
        });
        await page.waitForTimeout(1500);
        await page.evaluate(() => {
            window.__dwu.time.paused = true;
        });
        await shot('fighter-after-first-button');
        console.log(`  buttons after: ${JSON.stringify(await buttonHints())}`);
        // An onboard fighter (picked from the carrier's Fighters row in the original): Launch this Fighter, clicked.
        const onboard = await page.evaluate(() => {
            const p = window.__dwu.game.galaxy.playerEmpire;
            for (const bo of p.builtObjects) {
                const f = bo?.fighters?.find((x) => x && x.onboardCarrier && !x.underConstruction && !x.hasBeenDestroyed);
                if (f) {
                    window.__dwu.view.selectedFighter = f;
                    window.__dwu.view.onFighterSelect?.(f);
                    return { x: bo.xpos, y: bo.ypos, carrier: bo.name };
                }
            }
            return null;
        });
        console.log(`onboard fighter: ${JSON.stringify(onboard)}`);
        if (onboard !== null) {
            await view(onboard.x, onboard.y, 0.8);
            await shot('fighter-onboard-launch-button');
            console.log(`  buttons: ${JSON.stringify(await buttonHints())}`);
            await page.evaluate(() => document.querySelector('.order-action-btn')?.click());
            await page.evaluate(() => {
                window.__dwu.time.paused = false;
            });
            await page.waitForTimeout(1200);
            await page.evaluate(() => {
                window.__dwu.time.paused = true;
            });
            const launched = await page.evaluate(() => {
                const f = window.__dwu.view.selectedFighter;
                return f ? { onboard: f.onboardCarrier, x: f.xpos, y: f.ypos } : null;
            });
            console.log(`  after Launch: ${JSON.stringify(launched)} buttons ${JSON.stringify(await buttonHints())}`);
            if (launched !== null) await view(launched.x, launched.y, 0.8);
            await shot('fighter-launched-after-click');
        }

        // 2. Right-click a launched fighter with a player warship selected (the action menu, f < 50).
        const right = await page.evaluate((worker) => {
            const g = window.__dwu.game.galaxy;
            const p = g.playerEmpire;
            let fi = null;
            for (const bo of p.builtObjects) {
                if (!bo || !bo.fighters) continue;
                fi = bo.fighters.find((x) => x && !x.onboardCarrier && !x.hasBeenDestroyed) ?? null;
                if (fi) break;
            }
            if (fi === null) return null;
            const ship = p.builtObjects.filter((b) => b && !b.hasBeenDestroyed && b.role !== 8 && b.topSpeed > 0 && b.firepowerRaw > 0).sort((a, b) => Math.hypot(a.xpos - fi.xpos, a.ypos - fi.ypos) - Math.hypot(b.xpos - fi.xpos, b.ypos - fi.ypos))[0];
            if (!ship) return null;
            if (!worker && Math.hypot(ship.xpos - fi.xpos, ship.ypos - fi.ypos) > 600) {
                // Staging: bring the fighter next to the ship so both show at f = 1.
                fi.xpos = ship.xpos + 140;
                fi.ypos = ship.ypos;
            }
            window.__dwu.view.onBuiltObjectSelect?.(ship);
            return { x: fi.xpos, y: fi.ypos, ship: ship.name, fighter: fi.name };
        }, worker);
        console.log(`right-click: ${JSON.stringify(right)}`);
        if (right !== null) {
            await view(right.x, right.y, 1);
            await page.waitForTimeout(1500);
            const at = await page.evaluate(() => {
                const v = window.__dwu.view;
                const fi = v.fighterLayer.drawnFighters[0];
                // The drawn (render-interpolated) fighter nearest the centre.
                const cam = window.__dwu.camera;
                let best = null;
                for (const d of v.fighterLayer.drawnFighters) {
                    const s = cam.worldToScreen(d.x, d.y);
                    const dist = Math.hypot(s.x - cam.width / 2, s.y - cam.height / 2);
                    if (best === null || dist < best.dist) best = { x: s.x, y: s.y, dist };
                }
                void fi;
                const r = document.querySelector('canvas').getBoundingClientRect();
                return best === null ? null : { x: r.left + best.x * (r.width / cam.width), y: r.top + best.y * (r.height / cam.height) };
            });
            console.log(`  fighter on screen: ${JSON.stringify(at)}`);
            if (at !== null) {
                await page.mouse.move(at.x, at.y);
                await page.mouse.click(at.x, at.y, { button: 'right' });
                await page.waitForTimeout(800);
                console.log(`  menu: ${JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.order-menu-item')].map((r) => r.textContent)))}`);
                await shot('fighter-right-click-menu', 300);
                await page.keyboard.press('Escape');
            }
        }
    }

    // 3. Selection circles: a ship, a fleet's ships, a creature, a planet; galaxy zoom: a ship symbol, a fleet icon.
    const sel = await page.evaluate(() => {
        const g = window.__dwu.game.galaxy;
        const p = g.playerEmpire;
        const ship = p.builtObjects.find((b) => b && !b.hasBeenDestroyed && b.role !== 8 && b.topSpeed > 0 && !b.shipGroup);
        const fleet = p.shipGroups.filter((sg) => sg && sg.leadShip && sg.ships.length >= 3).sort((a, b) => b.ships.length - a.ships.length)[0] ?? null;
        const cap = p.capital;
        const creature = g.creatures.filter((c) => c && !c.hasBeenDestroyed).sort((a, b) => Math.hypot(a.xpos - cap.xpos, a.ypos - cap.ypos) - Math.hypot(b.xpos - cap.xpos, b.ypos - cap.ypos))[0] ?? null;
        window.__shotCreature = creature;
        return {
            ship: ship ? { x: ship.xpos, y: ship.ypos, name: ship.name } : null,
            fleet: fleet ? { x: fleet.leadShip.xpos, y: fleet.leadShip.ypos, name: fleet.name, n: fleet.ships.length } : null,
            creature: creature ? { x: creature.xpos, y: creature.ypos, name: creature.name } : null,
            planet: p.capital ? { x: p.capital.xpos, y: p.capital.ypos, name: p.capital.name } : null,
        };
    });
    // A creature the player can see (an unseen one's selection is dropped, Main.Part10.cs method_209): try the nearest.
    for (let i = 0; i < 40; i++) {
        const ok = await page.evaluate((i) => {
            const g = window.__dwu.game.galaxy;
            const cap = g.playerEmpire.capital;
            const list = g.creatures.filter((c) => c && !c.hasBeenDestroyed).sort((a, b) => Math.hypot(a.xpos - cap.xpos, a.ypos - cap.ypos) - Math.hypot(b.xpos - cap.xpos, b.ypos - cap.ypos));
            const c = list[i];
            if (!c) return null;
            window.__dwu.view.onCreatureSelect?.(c);
            window.__shotCreature = c;
            return true;
        }, i);
        if (ok === null) break;
        await page.waitForTimeout(700);
        const kept = await page.evaluate(() => window.__dwu.view.getHudSelection()?.creature === window.__shotCreature);
        if (kept) {
            sel.creature = await page.evaluate(() => ({ x: window.__shotCreature.xpos, y: window.__shotCreature.ypos, name: window.__shotCreature.name }));
            break;
        }
        sel.creature = null;
    }
    console.log(`selection targets: ${JSON.stringify(sel)}`);
    if (sel.ship) {
        await page.evaluate(() => {
            const p = window.__dwu.game.galaxy.playerEmpire;
            const ship = p.builtObjects.find((b) => b && !b.hasBeenDestroyed && b.role !== 8 && b.topSpeed > 0 && !b.shipGroup);
            window.__dwu.view.onBuiltObjectSelect?.(ship);
        });
        await view(sel.ship.x, sel.ship.y, 1.5);
        await shot('select-ship-circle');
        await view(sel.ship.x, sel.ship.y, 400);
        await shot('select-ship-galaxy-symbol');
    }
    if (sel.fleet) {
        await page.evaluate(() => {
            const p = window.__dwu.game.galaxy.playerEmpire;
            const fleet = p.shipGroups.filter((sg) => sg && sg.leadShip && sg.ships.length >= 3).sort((a, b) => b.ships.length - a.ships.length)[0];
            window.__dwu.view.onShipGroupSelect?.(fleet);
        });
        await view(sel.fleet.x, sel.fleet.y, 3);
        await shot('select-fleet-ships-circles');
        await view(sel.fleet.x, sel.fleet.y, 1500);
        await shot('select-fleet-galaxy-icon');
    }
    if (sel.creature) {
        await page.evaluate(() => {
            const c = window.__shotCreature;
            window.__dwu.view.selectedCreature = c;
            window.__dwu.view.onCreatureSelect?.(c);
        });
        await view(sel.creature.x, sel.creature.y, 2);
        await shot('select-creature-circle');
    }
    if (sel.planet) {
        await page.evaluate(() => {
            const h = window.__dwu.game.galaxy.playerEmpire.capital;
            window.__dwu.view.onSelectionChange?.(h);
        });
        await view(sel.planet.x, sel.planet.y, 6);
        await shot('select-planet-circle');
    }

    // 4. List hover: open a sidebar panel and hover its first row (the ping at the row's object, red vectors).
    for (const id of ['enemyTargets', 'pirateMissions', 'fleets', 'colonies', 'characters']) {
        const opened = await page.evaluate((id) => {
            const b = document.querySelector(`.ls-button[data-panel="${id}"]`);
            if (!b) return false;
            if (!document.querySelector('.ls-panel') || document.querySelector('.ls-panel').hidden || !document.querySelector(`.ls-button[data-panel="${id}"]`)) b.click();
            else b.click();
            return true;
        }, id);
        if (!opened) {
            console.log(`list ${id}: no button`);
            continue;
        }
        await page.waitForTimeout(2500);
        const row = await page.evaluate(() => {
            const r = document.querySelector('.ls-row');
            if (!r) return null;
            const b = r.getBoundingClientRect();
            return { x: b.left + b.width / 2, y: b.top + b.height / 2, text: r.textContent.slice(0, 80) };
        });
        console.log(`list ${id}: ${JSON.stringify(row)}`);
        if (row === null) continue;
        await page.mouse.move(row.x, row.y);
        await page.waitForTimeout(300);
        const ping = await page.evaluate(() => {
            const v = window.__dwu.view;
            const pings = v.overlayLayer.highlights.eventLocations;
            const hi = v.overlayLayer.highlights.specialHighlight;
            const p = pings[0];
            const o = p?.obj;
            const at = o ? (typeof o.xpos === 'number' ? { x: o.xpos, y: o.ypos } : { x: o.x, y: o.y }) : null;
            return { pings: pings.length, red: hi.size, at };
        });
        console.log(`  hover: ${JSON.stringify(ping)}`);
        if (ping.at !== null) {
            await page.evaluate(([x, y]) => {
                const cam = window.__dwu.camera;
                // Keep the pointer on the row: move the view, not the mouse.
                cam.centerOn(x, y);
                cam.zoom = cam.clampZoom(1 / 60);
            }, [ping.at.x, ping.at.y]);
            await page.mouse.move(row.x, row.y + 1);
            await shot(`list-hover-${id}`, 900);
        }
        await page.mouse.move(800, 450);
        await page.evaluate((id) => document.querySelector(`.ls-button[data-panel="${id}"]`)?.click(), id);
    }

    // 5. Fleet Postures discs over close-zoom ships: a player fleet's disc centre with ships nearby.
    const posture = await page.evaluate(() => {
        const g = window.__dwu.game.galaxy;
        const p = g.playerEmpire;
        for (const sg of p.shipGroups) {
            if (!sg || !sg.leadShip) continue;
            const c = sg.posture === 0 ? sg.attackPoint : sg.gatherPoint;
            if (!c) continue;
            const near = p.builtObjects.filter((b) => b && !b.hasBeenDestroyed && Math.hypot(b.xpos - c.xpos, b.ypos - c.ypos) < 3000).length;
            if (near > 0) return { x: c.xpos, y: c.ypos, name: sg.name, near };
        }
        return null;
    });
    console.log(`posture over ships: ${JSON.stringify(posture)}`);
    if (posture !== null) {
        await page.evaluate(() => window.__dwu.view.onSelectionChange?.(null));
        await view(posture.x, posture.y, 3);
        await shot('fleet-posture-over-ships');
    }

    // 6. A creature as the selected destination: ships attacking it get the red special-highlight vectors.
    const creatureDest = await page.evaluate((worker) => {
        const g = window.__dwu.game.galaxy;
        const p = g.playerEmpire;
        let target = null;
        const attackers = [];
        for (const bo of p.builtObjects) {
            const t = bo?.mission?.target;
            if (t && typeof t.damageKillThreshold === 'number' && !t.hasBeenDestroyed) {
                target = t;
                attackers.push(bo);
            }
        }
        return target === null ? { found: false, worker } : { found: true, x: target.xpos, y: target.ypos, name: target.name, attackers: attackers.length };
    }, worker);
    console.log(`creature destination: ${JSON.stringify(creatureDest)}`);
    if (!creatureDest.found && !worker) {
        // Order (through the command queue) the nearest warships to attack a creature, then let them move a little.
        const ordered = await page.evaluate(() => {
            const g = window.__dwu.game.galaxy;
            const p = g.playerEmpire;
            const c = window.__shotCreature;
            if (!c) return null;
            const ships = p.builtObjects
                .filter((b) => b && !b.hasBeenDestroyed && b.role !== 8 && b.topSpeed > 0 && b.firepowerRaw > 0 && !b.shipGroup)
                .sort((a, b) => Math.hypot(a.xpos - c.xpos, a.ypos - c.ypos) - Math.hypot(b.xpos - c.xpos, b.ypos - c.ypos))
                .slice(0, 3);
            const ShipAction = window.__dwu.commands.moveOrder(p.capital).constructor;
            for (const s of ships) {
                const a = ShipAction.forMission(9, c); // BuiltObjectMissionType.Attack
                window.__dwu.commands.issue(g, p, 'shipAction', [s, a, true, undefined]);
            }
            return { x: c.xpos, y: c.ypos, name: c.name, ships: ships.map((s) => s.name) };
        });
        console.log(`  staged attack: ${JSON.stringify(ordered)}`);
        if (ordered !== null) {
            await page.evaluate(() => {
                window.__dwu.time.paused = false;
            });
            await page.waitForTimeout(2500);
            await page.evaluate(() => {
                window.__dwu.time.paused = true;
            });
            // Select the creature once the orders are in (Main.Part10.cs 1328: the set is taken at selection time), and
            // frame the attackers with it (the per-ship vector pass draws ships inside the view).
            const box = await page.evaluate(() => {
                const g = window.__dwu.game.galaxy;
                const c = window.__shotCreature;
                window.__dwu.view.onSelectionChange?.(null);
                window.__dwu.view.selectedCreature = c;
                window.__dwu.view.onCreatureSelect?.(c);
                const att = g.playerEmpire.builtObjects.filter((b) => b && b.mission && b.mission.target === c);
                let x0 = c.xpos, x1 = c.xpos, y0 = c.ypos, y1 = c.ypos;
                for (const b of att) {
                    x0 = Math.min(x0, b.xpos);
                    x1 = Math.max(x1, b.xpos);
                    y0 = Math.min(y0, b.ypos);
                    y1 = Math.max(y1, b.ypos);
                }
                return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, f: Math.max(200, ((x1 - x0) / 1400) * 1.2, ((y1 - y0) / 800) * 1.2), attackers: att.length };
            });
            await page.waitForTimeout(500);
            const red = await page.evaluate(() => `${window.__dwu.view.overlayLayer.highlights.specialHighlight.size} (selection kept: ${!!window.__dwu.view.getHudSelection()?.creature})`);
            console.log(`  frame: ${JSON.stringify(box)}, red set: ${red}`);
            await view(box.x, box.y, box.f);
            await shot('creature-destination-red-vectors');
        }
    } else if (creatureDest.found) {
        await page.evaluate(() => {
            const g = window.__dwu.game.galaxy;
            for (const bo of g.playerEmpire.builtObjects) {
                const t = bo?.mission?.target;
                if (t && typeof t.damageKillThreshold === 'number' && !t.hasBeenDestroyed) {
                    window.__dwu.view.selectedCreature = t;
                    window.__dwu.view.onCreatureSelect?.(t);
                    return;
                }
            }
        });
        await view(creatureDest.x, creatureDest.y, 600);
        await shot('creature-destination-red-vectors');
    }
} catch (e) {
    console.log(`error: ${e.stack ?? e}`);
} finally {
    console.log(`console errors/warnings (${logs.length}):`);
    for (const l of logs.slice(0, 40)) console.log(`  ${l}`);
    console.log(`screenshots:\n${shots.map((s) => `  ${s}`).join('\n')}`);
    await browser.close();
}
