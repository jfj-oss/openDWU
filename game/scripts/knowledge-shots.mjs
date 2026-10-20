// The Intelligence screen's Knowledge page (Great Works / Beacon). Usage: node scripts/knowledge-shots.mjs <baseUrl> <outDir>
// Boots `?autostart=1&scenario=threat-framework,giantworks&simWorker=0&reveal=1`, finishes the Beacon and starts the war in the page (as the unit tests do),
// lets the player learn one harvest core from a cattle ship, opens the screen (F4 button) and shows the Knowledge page.
// Headless Chromium on the GPU (ANGLE / Vulkan), never SwiftShader.
import { chromium } from 'playwright-core';
const [base = 'http://localhost:5173/', outDir = 'shots'] = process.argv.slice(2);
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/usr/bin/chromium',
    args: ['--use-gl=angle', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`${base}?autostart=1&scenario=threat-framework,giantworks&simWorker=0&reveal=1&stars=300&seed=3`);
await page.waitForFunction(() => window.__dwu?.game?.playerEmpire !== undefined, null, { timeout: 240000 });
await page.waitForTimeout(3000);
console.log('gpu', await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
}));
const setup = await page.evaluate(async () => {
    const { galaxy, game } = window.__dwu;
    window.__dwu.time.paused = true;
    const roq = await import('/src/sim/readOnlyQuery.ts');
    const b = await import('/src/sim/scenario/threats/giantworks/beacon.ts');
    const bs = await import('/src/sim/scenario/threats/giantworks/beaconState.ts');
    const bf = await import('/src/sim/scenario/threats/giantworks/beaconFleet.ts');
    const bh = await import('/src/sim/scenario/threats/giantworks/beaconHarvest.ts');
    const own = await import('/src/sim/combat/ownership.ts');
    const hk = await import('/src/sim/scenario/hooks.ts');
    const st8 = await import('/src/sim/tick/simTime.ts');
    return roq.withSimWrites(() => {
        galaxy.scenario.flags.gwBeacon = true;
        let best = null;
        let bd = Infinity;
        for (const sys of galaxy.systems) {
            const s = sys?.systemStar;
            if (!s || sys.habitats.some((h) => h.empire !== null) || galaxy.checkEmpireTerritoryIdAtLocation(s.xpos, s.ypos) >= 0) continue;
            const d = galaxy.calculateDistance(s.xpos, s.ypos, galaxy.sizeX / 2, galaxy.sizeY / 2);
            if (d < bd) { bd = d; best = sys; }
        }
        const site = { id: 0, system: best, habitat: null, base: null, progress: 0, stage: 0, wonder: 'beacon', founders: [], startDate: st8.galaxyStarDate(galaxy), completeDate: null, destroyedBy: null };
        b.beaconRolled(galaxy, site);
        site.progress = 1; site.stage = 4; site.completeDate = st8.galaxyStarDate(galaxy);
        b.beaconComplete(galaxy, site);
        const st = bs.peekBeaconState(galaxy);
        bf.startWar(galaxy, st);
        galaxy.scenario.params.beaconFundingModel = 1;
        galaxy.scenario.params.beaconCoreWorldsPer = 1;
        galaxy.scenario.params.beaconCoresSmall = 4;
        const f = st.faction;
        const victims = galaxy.empires.filter((e) => e && e !== galaxy.independentEmpire && e !== f && e.pirateEmpireBaseHabitat === null && e.active && e !== game.playerEmpire);
        const held = [];
        for (const v of victims) for (const c of v.colonies.filter((x) => x.population.totalAmount > 0)) if (held.length < 5) held.push(c);
        for (const c of held) own.takeOwnershipOfColonyFull(galaxy, c.empire, c, f, false, false);
        for (let i = 0; i < 4; i++) { galaxy.nowMs += 20 * hk.GAME_DAY_LENGTH; bh.harvestPeriodic(galaxy, st); }
        if (bh.liveCores(st).length === 0) return { err: 'no core', held: held.length, victims: victims.length, phase: st.phase, war: bs.warOn(st) };
        const core = bh.liveCores(st)[0];
        const ship = bf.spawnShip(galaxy, f, bh.cattleDesign(galaxy, f), core.colony.xpos + 1000, core.colony.ypos);
        bh.cattleOf(st).push({ ship, from: core.colony, core: core.colony, load: [], total: 0, launched: st8.galaxyStarDate(galaxy), phase: 'idle' });
        bh.noteCattleCore(galaxy, st, ship, game.playerEmpire);
        return { cores: bh.liveCores(st).length, known: bh.knownCores(st, game.playerEmpire).length };
    });
});
console.log('setup', JSON.stringify(setup));
const W = '[data-ow="characters"]';
await page.click('[data-hud="tbtnIntelligenceAgents"]');
await page.waitForSelector(`${W} .ow-grid-row`);
console.log('buttons', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[data-ow="characters"] .ow-glass')].map((b) => b.textContent))), await page.evaluate(() => ({ flags: window.__dwu.galaxy.scenario.flags })));
await page.getByRole('button', { name: 'Knowledge' }).click().catch(async () => { await page.locator(`${W} >> text=Knowledge`).first().click(); });
await page.waitForTimeout(1500);
console.log(await page.evaluate(() => document.querySelector('.ch-knowledge-body')?.innerText));
await page.screenshot({ path: `${outDir}/knowledge-page.png` });
console.log(`saved ${outDir}/knowledge-page.png`);
await browser.close();
for (const l of logs.slice(0, 30)) console.log(l);
