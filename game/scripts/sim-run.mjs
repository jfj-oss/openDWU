#!/usr/bin/env node
// Headless sim run (tasks/M4-plan.md §5.2, §5.3.7): createGame + runGameSeconds, then print the state digest, entity
// counts, Galaxy.Rnd draws, TODO(port) stubs reached, wall ms, and (with --profile) ms per frame-driver pass plus ms
// per tick entry point / subsystem (V8 sampling profiler over the run only — no code in src/sim is touched).
//
//   node --expose-gc scripts/sim-run.mjs --seed 1 --stars 700 --empires 10 --seconds 600
//        [--age 1] [--tech 0.5] [--pirates 1] [--sectors N] [--chunk 60] [--profile] [--top 15] [--json out.json] [--combat]
// --combat: a battle report (tasks/COMBAT-VERIFICATION-2026-09-26.md) — every ship / base destroyed (by empire and sub
// role) and every closed SpaceBattleStats record (a ship's BattleStats replaced at AssignMission, BuiltObject.2.cs 7643,
// or nulled at mission completion, 4517-4532) with any weapon activity, plus the records still open at the end.
// (--sectors defaults to round(sqrt(stars / 4.7)) clamped to 4..15; the New Game wizard default is 700 stars in 8x8)
//
// Defaults match test/helpers/tickGame.ts (age 1, tech 0.5, pirates 1) so `--stars 300 --empires 4 --seconds 600`
// reproduces the tickDeterminism pin. The run is driven in `--chunk`-second runGameSeconds calls (chunking is
// digest-neutral, see test/tickDeterminism.test.ts); an exception inside a chunk is recorded with its stack and the
// driver continues with the next chunk (soak mode — the sim itself is not wrapped). With `--split a,b` the run is two
// runGameSeconds calls of a and b seconds (determinism check: 300,300 vs 600).
//
// The TS sources are bundled with rolldown (Vite's bundler) into a temp dir and imported as plain ESM, so cross-module
// calls are direct like in the app build. `--loader vite` uses Vite's SSR module loader instead (as vitest does): every
// imported binding is then read through a getter on the module namespace, which inflates per-call cost ~1.5x and skews
// the profile toward call-heavy functions.
import { createServer } from 'vite';
import { build } from 'rolldown';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    if (i < 0) return fallback;
    const v = process.argv[i + 1];
    return v === undefined || v.startsWith('--') ? true : v;
}

const seed = Number(arg('seed', 1));
const stars = Number(arg('stars', 700));
const empires = Number(arg('empires', 10));
const seconds = Number(arg('seconds', 600));
const tech = Number(arg('tech', 0.5));
const age = Number(arg('age', 1));
const pirates = Number(arg('pirates', 1));
const chunk = Number(arg('chunk', 60));
const split = arg('split', null);
const profile = arg('profile', false) === true;
const top = Number(arg('top', 15));
const jsonOut = arg('json', null);
const loader = String(arg('loader', 'bundle'));
const combat = arg('combat', false) === true;
// --probe-days 1,30,60: extra chunk boundaries at these game days; at each one print every empire's capital
// construction speed and its explorers' missions. Colony ships are tracked every chunk (day completed / day removed).
const probeDays = String(arg('probe-days', '1,30,60')).split(',').map(Number).filter((d) => Number.isFinite(d) && d > 0);
const sectors = Number(arg('sectors', Math.max(4, Math.min(15, Math.round(Math.sqrt(stars / 4.7))))));

const heap = { peak: 0, sample() { const h = process.memoryUsage().heapUsed; if (h > this.peak) this.peak = h; return h; } };
const mb = (b) => (b / 1048576).toFixed(0) + ' MB';

// --- V8 CPU profile → ms per function (inclusive, recursion counted once) and per tick entry point.
const TICK_ROOTS = new Set(['empireDoTasks', 'empirePirateDoTasks', 'galaxyDoTasks', 'galaxyDoTasksTimeSensitive', 'builtObjectDoTasks',
    'habitatDoTasks', 'shipGroupDoTasks', 'creatureDoTasks', 'backgroundPass', 'drainQueue', 'runSimFrame']);
function analyseProfile(p) {
    const byId = new Map(p.nodes.map((n) => [n.id, n]));
    const parent = new Map();
    for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const dt = new Map();
    for (let i = 0; i < p.samples.length; i++) dt.set(p.samples[i], (dt.get(p.samples[i]) ?? 0) + (p.timeDeltas[i] ?? 0) / 1000);
    const label = (n) => { const f = n.callFrame; const file = f.url.replace(/^.*?\/(src|test)\//, '$1/').replace(/\.js$/, '.ts').replace(/^file:\/\//, ''); return `${f.functionName || '(anon)'} ${file}:${f.lineNumber + 1}`; };
    const self = new Map(), incl = new Map(), entry = new Map();
    for (const [id, ms] of dt) {
        let n = byId.get(id);
        self.set(label(n), (self.get(label(n)) ?? 0) + ms);
        const seen = new Set();
        let tickEntry = null;
        for (let cur = n; cur; cur = byId.get(parent.get(cur.id))) {
            const l = label(cur);
            if (!seen.has(l)) { seen.add(l); incl.set(l, (incl.get(l) ?? 0) + ms); }
            const par = byId.get(parent.get(cur.id));
            // Nearest call below a tick root = the subsystem entry point (e.g. "empireDoTasks > assignShipMissions").
            if (tickEntry === null && par && TICK_ROOTS.has(par.callFrame.functionName) && !TICK_ROOTS.has(cur.callFrame.functionName)) {
                tickEntry = `${par.callFrame.functionName} > ${cur.callFrame.functionName || '(anon)'}`;
            }
        }
        if (tickEntry !== null) entry.set(tickEntry, (entry.get(tickEntry) ?? 0) + ms);
    }
    const sorted = (m, filter = () => true) => [...m].filter(([k]) => filter(k)).sort((a, b) => b[1] - a[1]);
    return { entry: sorted(entry), self: sorted(self, (k) => !k.startsWith('(') && !k.includes(' node:')), incl: sorted(incl, (k) => !k.startsWith('(') && !k.includes(' node:') && !k.includes('sim-run.mjs')) };
}

const MODULES = { game: '/src/sim/game.ts', types: '/src/sim/types.ts', load: '/test/helpers/loadGameDataFs.ts', harness: '/src/sim/tick/harness.ts',
    scheduler: '/src/sim/tick/scheduler.ts', digest: '/src/sim/tick/digest.ts' };
// test/helpers/loadGameDataFs.ts (the Node game-data loader the tests use) reads __dirname, which neither loader provides.
const dirnameDefine = { __dirname: JSON.stringify(resolve(root, 'test/helpers')) };
let server = null, bundleDir = null;
let load;
if (loader === 'vite') {
    server = await createServer({ root, logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', optimizeDeps: { noDiscovery: true }, define: dirnameDefine });
    load = (key) => server.ssrLoadModule(MODULES[key]);
} else {
    bundleDir = mkdtempSync(resolve(tmpdir(), 'dwu-sim-run-'));
    await build({ cwd: root, input: Object.fromEntries(Object.entries(MODULES).map(([k, v]) => [k, '.' + v])), platform: 'node', transform: { define: dirnameDefine },
        output: { dir: bundleDir, format: 'esm', preserveModules: true, preserveModulesRoot: root }, write: true, logLevel: 'warn' });
    load = (key) => import(resolve(bundleDir, key + '.js'));
}
const out = { loader, seed, stars, empires, seconds, age, pirates, exceptions: [] };
try {
    const { createGame } = await load('game');
    const { GalaxyShape } = await load('types');
    const { loadGameDataFs } = await load('load');
    const { runGameSeconds } = await load('harness');
    const { schedulerState } = await load('scheduler');
    const { stateDigest, stateCounts } = await load('digest');

    const gameData = await loadGameDataFs();
    const s = (race) => ({ race, homeSystemFavourability: 'Normal', proximityDistance: 'Random', startLocation: '(Random)', age, techLevel: tech });
    let t = performance.now();
    const game = createGame({
        seed, shape: GalaxyShape.Spiral, starCount: stars, sectorWidth: sectors, sectorHeight: sectors,
        systemNames: Array.from({ length: stars }, (_, i) => `S${i}`), gameData, galaxyAge: age,
        player: s('Human'), aiEmpires: Array.from({ length: Math.max(0, empires - 1) }, () => s('(Random)')),
        piratePrevalence: pirates,
    });
    const createMs = performance.now() - t;
    const g = game.galaxy;
    console.log(`[${loader}] createGame: seed ${seed}, ${stars} stars (${sectors}x${sectors}), ${empires} empires, age ${age}, pirates ${pirates} — ${createMs.toFixed(0)} ms`);
    console.log('start digest', stateDigest(g), JSON.stringify(stateCounts(g)));
    globalThis.gc?.();
    const heapStart = heap.sample();

    let session = null;
    if (profile) {
        session = new Session();
        session.connect();
        await session.post('Profiler.enable');
        await session.post('Profiler.setSamplingInterval', { interval: 500 });
        await session.post('Profiler.start');
    }
    const plan = split !== null && split !== true ? String(split).split(',').map(Number) : [];
    if (plan.length === 0) {
        // Chunk ends at every multiple of --chunk plus every probe day (ms-integral; chunking is digest-neutral).
        const ends = new Set();
        for (let e = chunk; e < seconds; e += chunk) ends.add(Math.round(e * 1000));
        for (const d of probeDays) { const e = Math.round(d * 600 / 365 * 1000); if (e > 0 && e < seconds * 1000) ends.add(e); }
        ends.add(Math.round(seconds * 1000));
        let prev = 0;
        for (const e of [...ends].sort((a, b) => a - b)) { plan.push((e - prev) / 1000); prev = e; }
    }
    const MISSION = ['Undefined', 'Explore', 'Build', 'BuildRepair', 'Transport', 'Patrol', 'Escort', 'Rescue', 'Blockade', 'Attack', 'Escape', 'Retire',
        'Retrofit', 'Colonize', 'Waypoint', 'Hold', 'WaitAndAttack', 'WaitAndBombard', 'MoveAndWait', 'Refuel', 'ExtractResources', 'LoadTroops',
        'UnloadTroops', 'Deploy', 'Undeploy', 'Repair', 'Move', 'Bombard', 'Capture', 'Reinforce', 'Raid'];
    const day = () => g.nowMs / 1000 / 600 * 365;
    const probe = (label) => {
        console.log(`probe ${label} (day ${day().toFixed(1)}):`);
        for (const e of g.empires) {
            if (e === null) continue;
            const speed = e.capital?.constructionQueue?.constructionSpeed ?? '-';
            const ex = e.builtObjects.filter((b) => b !== null && b.subRole === 9 && !b.hasBeenDestroyed)
                .map((b) => `${b.name}:${b.builtAt !== null ? '[building] ' : ''}${MISSION[b.mission?.type ?? 0]}${b.mission?.target ? '→' + (b.mission.target.name ?? '?') : ''}`);
            console.log(`  ${e.name.padEnd(28)} capital speed ${speed}; explorers ${ex.length}: ${ex.join(', ')}`);
        }
    };
    probe('start');
    // NewColony (17) / NewColonyFailed (18) messages as they are sent (Empire.ProcessMessages clears the list each tick).
    const colonyMessages = [];
    for (const e of g.empires) {
        if (e === null || e.messages === null) continue;
        const list = e.messages;
        list.push = function (...items) {
            for (const m of items) if (m.messageType === 17 || m.messageType === 18) colonyMessages.push({ day: day(), empire: e.name, type: m.messageType === 17 ? 'NewColony' : 'NewColonyFailed', description: m.description });
            return Array.prototype.push.apply(this, items);
        };
    }
    const probed = new Set();
    // Colony ships (sub role 13): day first fully built, day removed (with its last mission / target / target owner).
    const colonyShips = new Map();
    const trackColonyShips = () => {
        const alive = new Set();
        for (const e of g.empires) {
            if (e === null) continue;
            for (const b of e.builtObjects) {
                if (b === null || b.subRole !== 13 || b.hasBeenDestroyed) continue;
                alive.add(b);
                let r = colonyShips.get(b);
                if (r === undefined) { r = { empire: e.name, name: b.name, at: b.builtAt?.name ?? '-', built: null, removed: null, last: null }; colonyShips.set(b, r); }
                if (r.built === null && b.components.items.every((c) => c.status !== 0)) r.built = day();
                const t = b.mission?.target ?? null;
                r.last = `${b.components.items.filter((c) => c.status !== 0).length}/${b.components.count} ${MISSION[b.mission?.type ?? 0]}${t ? '→' + t.name + ' (' + (t.empire?.name ?? t.owner?.name ?? 'unowned') + ')' : ''}`;
            }
        }
        for (const [b, r] of colonyShips) if (r.removed === null && !alive.has(b)) r.removed = day();
    };
    // --combat: per-frame watch of every BuiltObject's BattleStats and HasBeenDestroyed (read-only).
    const SUB = ['Undefined', 'Escort', 'Frigate', 'Destroyer', 'Cruiser', 'CapitalShip', 'TroopTransport', 'Carrier', 'ResupplyShip', 'ExplorationShip',
        'SmallFreighter', 'MediumFreighter', 'LargeFreighter', 'ColonyShip', 'PassengerShip', 'ConstructionShip', 'GasMiningShip', 'MiningShip',
        'GasMiningStation', 'MiningStation', 'SmallSpacePort', 'MediumSpacePort', 'LargeSpacePort', 'ResortBase', 'GenericBase', 'EnergyResearchStation',
        'WeaponsResearchStation', 'HighTechResearchStation', 'MonitoringStation', 'DefensiveBase'];
    const battle = { seenStats: new Map(), battles: [], destroyed: [], destroyedSeen: new Set() };
    const active = (st) => st !== null && typeof st === 'object' && (st.weaponsHits > 0 || st.weaponsMisses > 0 || st.damageToUs > 0 || st.shieldsDamageAbsorbed > 0);
    const summary = (bo, st, open) => ({ day: day(), open, ship: bo.name, empire: bo.empire?.name ?? '-', subRole: SUB[bo.subRole] ?? bo.subRole,
        location: st.location?.name ?? null, hits: st.weaponsHits, misses: st.weaponsMisses, damageToEnemy: +st.weaponsDamageToEnemy.toFixed(1),
        shieldsAbsorbed: +st.shieldsDamageAbsorbed.toFixed(1), hullDamageToUs: st.damageToUs,
        enemyShipsDestroyed: st.destroyedEnemyShipsEscort + st.destroyedEnemyShipsFrigate + st.destroyedEnemyShipsDestroyer + st.destroyedEnemyShipsCruiser +
            st.destroyedEnemyShipsCapitalShip + st.destroyedEnemyShipsCarrier + st.destroyedEnemyShipsTroopTransport + st.destroyedEnemyShipsResupplyShip +
            st.destroyedEnemyShipsOtherShips, enemyBasesDestroyed: st.destroyedEnemyShipsSpaceport + st.destroyedEnemyShipsDefensiveBase + st.destroyedEnemyShipsOtherBase,
        enemyFightersDestroyed: st.destroyedEnemyFighters, lost: bo.hasBeenDestroyed });
    const watchCombat = () => {
        for (const bo of g.builtObjects) {
            if (bo === null) continue;
            const prev = battle.seenStats.get(bo);
            if (prev !== undefined && prev !== bo.battleStats && active(prev)) battle.battles.push(summary(bo, prev, false));
            if (bo.battleStats !== prev) battle.seenStats.set(bo, bo.battleStats);
            if (bo.hasBeenDestroyed && !battle.destroyedSeen.has(bo)) {
                battle.destroyedSeen.add(bo);
                battle.destroyed.push({ day: day(), ship: bo.name, empire: bo.empire?.name ?? '-', subRole: SUB[bo.subRole] ?? bo.subRole });
                const st = bo.battleStats;
                if (active(st)) { battle.battles.push(summary(bo, st, false)); battle.seenStats.set(bo, null); }
            }
        }
    };
    const timings = {}, todo = {}, chunks = [];
    let frames = 0, draws = 0, cpuTotal = 0;
    // Expansion summary: game-day each empire first holds more than one colony.
    const firstSecond = new Map();
    const noteExpansion = () => { for (const e of g.empires) if (e !== null && e.colonies.length > 1 && !firstSecond.has(e)) firstSecond.set(e, g.nowMs / 1000 / 600 * 365); };
    t = performance.now();
    for (const secs of plan) {
        const cpu0 = process.cpuUsage(), c0 = performance.now(), f0 = schedulerState(g).frames, d0 = g.rnd.drawCount;
        try {
            const r = runGameSeconds(g, secs, { ...(profile ? { profileClock: () => performance.now() } : {}), ...(combat ? { onFrame: watchCombat } : {}) });
            for (const [k, v] of Object.entries(r.timings)) timings[k] = (timings[k] ?? 0) + v;
            for (const [k, v] of Object.entries(r.todoHits)) todo[k] = (todo[k] ?? 0) + v;
        } catch (e) {
            // Soak driver only: record, drop the half-drained worker queue, continue with the next chunk.
            out.exceptions.push({ atMs: g.nowMs, stack: String(e?.stack ?? e) });
            console.log(`EXCEPTION at game ms ${g.nowMs}:\n${e?.stack ?? e}`);
            schedulerState(g).queue.length = 0;
        }
        const f = schedulerState(g).frames - f0;
        frames += f; draws += g.rnd.drawCount - d0;
        const ms = performance.now() - c0;
        const cu = process.cpuUsage(cpu0), cpuMs = (cu.user + cu.system) / 1000;
        cpuTotal += cpuMs;
        noteExpansion();
        trackColonyShips();
        // runGameSeconds ends on a frame boundary, so a probe fires at the first chunk end at or past its day.
        for (const d of probeDays) if (!probed.has(d) && g.nowMs >= Math.round(d * 600 / 365 * 1000)) { probed.add(d); probe(`day ${d}`); }
        chunks.push({ endS: g.nowMs / 1000, frames: f, ms, msPerFrame: ms / Math.max(1, f), cpuMsPerFrame: cpuMs / Math.max(1, f), heap: heap.sample(), bo: g.builtObjects.length });
    }
    const runMs = performance.now() - t;
    let prof = null;
    if (session !== null) {
        const { profile: p } = await session.post('Profiler.stop');
        session.disconnect();
        prof = analyseProfile(p);
    }
    globalThis.gc?.();
    const heapEnd = heap.sample();

    const digest = stateDigest(g), counts = stateCounts(g);
    console.log(`ran ${seconds} game-s: ${frames} frames in ${runMs.toFixed(0)} ms wall (${(runMs / frames).toFixed(3)} ms/frame), ${cpuTotal.toFixed(0)} ms cpu (${(cpuTotal / frames).toFixed(3)} ms/frame; cpu includes GC threads), Rnd draws ${draws}`);
    console.log('digest', digest, JSON.stringify(counts));
    const first = chunks[0], last = chunks[chunks.length - 1];
    console.log(`ms/frame wall|cpu: first chunk ${first.msPerFrame.toFixed(3)}|${first.cpuMsPerFrame.toFixed(3)} (to ${first.endS}s), last chunk ${last.msPerFrame.toFixed(3)}|${last.cpuMsPerFrame.toFixed(3)} (to ${last.endS}s); builtObjects ${first.bo} → ${last.bo}`);
    console.log(`heap: start ${mb(heapStart)}, peak sampled ${mb(heap.peak)}, end after gc ${mb(heapEnd)}${globalThis.gc ? '' : ' (run with --expose-gc for gc-settled numbers)'}`);
    console.log(`exceptions: ${out.exceptions.length}`);
    // First contact / exploration summary: met = diplomatic relations whose Type != NotMet (0) with a real empire;
    // an explorer (sub role ExplorationShip = 9) is "away" when it is > 23000 (MaxSolarSystemSize) from its capital's star.
    const contact = g.empires.filter((e) => e !== null).map((e) => {
        let met = 0;
        for (const r of e.diplomaticRelations) if (r.type !== 0 && r.otherEmpire !== null && r.otherEmpire !== g.independentEmpire && g.empires.includes(r.otherEmpire)) met++;
        const cap = e.capital, star = cap === null ? null : g.systems[cap.systemIndex]?.systemStar ?? null;
        let explorers = 0, away = 0;
        for (const b of e.builtObjects) {
            if (b === null || b.subRole !== 9 || b.hasBeenDestroyed) continue;
            explorers++;
            if (star !== null && Math.hypot(b.xpos - star.xpos, b.ypos - star.ypos) > 23000) away++;
        }
        return { name: e.name, player: e === g.playerEmpire, met, explorers, away, explored: e.systemVisibility.filter((v) => v.status >= 2).length };
    });
    out.contact = contact;
    console.log(`contact after ${(g.nowMs / 1000 / 600 * 365).toFixed(0)} game-days: ${contact.filter((c) => c.met > 0).length}/${contact.length} empires met someone`);
    for (const c of contact) console.log(`  ${c.player ? '*' : ' '} ${c.name.padEnd(28)} met ${c.met}, explorers away ${c.away}/${c.explorers}, systems explored/visible ${c.explored}`);
    // Expansion: colonies per empire, the day of the first second colony, and every colony ship (sub role 13):
    // where it was built (Habitat colony yard or a base), components built / total, and its mission.
    out.expansion = g.empires.filter((e) => e !== null).map((e) => {
        const ships = e.builtObjects.filter((b) => b !== null && b.subRole === 13 && !b.hasBeenDestroyed).map((b) => {
            const at = b.builtAt;
            const built = b.components.items.filter((c) => c.status !== 0).length;
            return { name: b.name, at: at === null ? '-' : `${at.constructor.name} ${at.name}`, built, total: b.components.count, mission: b.mission?.type ?? null };
        });
        return { name: e.name, player: e === g.playerEmpire, colonies: e.colonies.length, firstSecondDay: firstSecond.get(e) ?? null, ships };
    });
    console.log(`expansion: ${out.expansion.filter((x) => x.colonies > 1).length}/${out.expansion.length} empires have > 1 colony; total colonies ${out.expansion.reduce((a, x) => a + x.colonies, 0)}`);
    for (const x of out.expansion) {
        console.log(`  ${x.player ? '*' : ' '} ${x.name.padEnd(28)} colonies ${x.colonies}, first 2nd colony day ${x.firstSecondDay === null ? '-' : x.firstSecondDay.toFixed(0)}`);
        for (const sh of x.ships) console.log(`      colony ship ${sh.name} at ${sh.at}: ${sh.built}/${sh.total} built, mission ${sh.mission}`);
    }
    out.colonyShips = [...colonyShips.values()];
    console.log(`colony ships: ${out.colonyShips.length}`);
    for (const r of out.colonyShips) console.log(`  ${r.empire.padEnd(28)} ${r.name.padEnd(20)} at ${r.at}: built day ${r.built === null ? '-' : r.built.toFixed(0)}, removed day ${r.removed === null ? '-' : r.removed.toFixed(0)}, last ${r.last}`);
    for (const m of colonyMessages) console.log(`  day ${m.day.toFixed(0)} ${m.empire}: ${m.type} ${m.description}`);
    if (combat) {
        for (const bo of g.builtObjects) if (bo !== null && active(bo.battleStats)) battle.battles.push(summary(bo, bo.battleStats, true));
        out.combat = { battles: battle.battles, destroyed: battle.destroyed };
        const closed = battle.battles.filter((b) => !b.open);
        console.log(`combat: ${battle.battles.length} SpaceBattleStats records with weapon activity (${closed.length} closed, ${battle.battles.length - closed.length} still open); ${battle.destroyed.length} ships/bases destroyed`);
        const by = new Map();
        for (const d of battle.destroyed) by.set(`${d.empire} ${d.subRole}`, (by.get(`${d.empire} ${d.subRole}`) ?? 0) + 1);
        for (const [k, v] of [...by].sort((a, b) => b[1] - a[1])) console.log(`  destroyed ${String(v).padStart(4)}  ${k}`);
        for (const b of battle.battles) console.log(`  battle day ${b.day.toFixed(1)}${b.open ? ' (open)' : ''} ${b.empire} ${b.subRole} ${b.ship}${b.location ? ' near ' + b.location : ''}: hits ${b.hits}, misses ${b.misses}, dmg ${b.damageToEnemy}, shields absorbed ${b.shieldsAbsorbed}, hull dmg taken ${b.hullDamageToUs}, kills ${b.enemyShipsDestroyed}+${b.enemyBasesDestroyed} bases+${b.enemyFightersDestroyed} fighters${b.lost ? ', LOST' : ''}`);
    }
    const hits = Object.entries(todo).sort((a, b) => b[1] - a[1]);
    console.log(`TODO(port) stubs reached: ${hits.length}`);
    for (const [k, v] of hits.slice(0, 25)) console.log(`  ${String(v).padStart(10)}  ${k}`);
    if (profile) {
        console.log('wall ms per frame-driver pass (timer):');
        for (const [k, v] of Object.entries(timings).sort((a, b) => b[1] - a[1])) console.log(`  ${v.toFixed(1).padStart(10)}  ${k}`);
        console.log(`top ${top} tick entry points (sampled ms, inclusive):`);
        for (const [k, v] of prof.entry.slice(0, top)) console.log(`  ${v.toFixed(0).padStart(10)}  ${k}`);
        console.log(`top ${top} src/sim functions (sampled ms, inclusive):`);
        for (const [k, v] of prof.incl.slice(0, top)) console.log(`  ${v.toFixed(0).padStart(10)}  ${k}`);
        console.log(`top ${top} functions (sampled ms, self):`);
        for (const [k, v] of prof.self.slice(0, top)) console.log(`  ${v.toFixed(0).padStart(10)}  ${k}`);
    }
    Object.assign(out, { createMs, digest, counts, frames, rndDraws: draws, runMs, cpuMs: cpuTotal, heapStart, heapPeak: heap.peak, heapEnd, todo, timings, chunks,
        profile: prof && { entry: prof.entry.slice(0, 60), incl: prof.incl.slice(0, 60), self: prof.self.slice(0, 60) } });
    if (jsonOut !== null) writeFileSync(String(jsonOut), JSON.stringify(out, null, 1));
} finally {
    await server?.close();
    if (bundleDir !== null && !process.env.KEEP) rmSync(bundleDir, { recursive: true, force: true });
}
