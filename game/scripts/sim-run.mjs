#!/usr/bin/env node
// Headless sim run (tasks/M4-plan.md §5.2, §5.3.7): createGame + runGameSeconds, then print the state digest, entity
// counts, Galaxy.Rnd draws, TODO(port) stubs reached, wall ms, and (with --profile) ms per frame-driver pass plus ms
// per tick entry point / subsystem (V8 sampling profiler over the run only — no code in src/sim is touched).
//
//   node --expose-gc scripts/sim-run.mjs --seed 1 --stars 700 --empires 10 --seconds 600
//        [--age 1] [--tech 0.5] [--pirates 1] [--sectors N] [--chunk 60] [--profile] [--top 15] [--json out.json]
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
// --probe-days 1,30,60: extra chunk boundaries at these game days; at each one print every empire's capital
// construction speed and its explorers' missions. Colony ships are tracked every chunk (day completed / day removed).
const probeDays = String(arg('probe-days', '1,30,60')).split(',').map(Number).filter((d) => Number.isFinite(d) && d > 0);
// --stats-days 30: every N game days print a one-line-per-empire health snapshot (colonies, population, money, cashflow,
// ships by role, idle / low-fuel ships, research completed, characters, relations) plus galaxy totals (wars, treaties,
// messages by type, ships destroyed, pirate missions, NaN scan, console errors, ms/frame and ms per frame-driver pass).
// --stats-json out.json writes the timeline. Snapshots read state only (the cashflow read runs in averaged-income mode so it does not age per-base income).
const statsDays = Number(arg('stats-days', 0));
const statsJson = arg('stats-json', null);
// --watch-money "Empire Name:5000": log every single change of that empire's stateMoney whose size is >= the threshold,
// with the game day and the top sim stack frames; each snapshot also prints its cashflow terms.
const watchMoney = arg('watch-money', null);
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
    scheduler: '/src/sim/tick/scheduler.ts', digest: '/src/sim/tick/digest.ts', treasury: '/src/sim/treasury.ts',
    forceStructure: '/src/sim/forceStructure.ts' };
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
        if (statsDays > 0) for (let d = statsDays; ; d += statsDays) { const e = Math.round(d * 600 / 365 * 1000); if (e >= seconds * 1000) break; ends.add(e); }
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
    const timings = {}, todo = {}, chunks = [];
    // ---- --stats-days health snapshots ----
    const { calculateAnnualCashflow } = await load('treasury');
    const stats = [];
    const msgCounts = {};                 // message type → count since the last snapshot (all empires + pirates)
    const MSG = ['Undefined', 'DiplomaticRelationChange', 'ProposeDiplomaticRelation', 'AcceptDiplomaticRelation', 'RefuseDiplomaticRelation',
        'RemoveColoniesFromSystem', 'StopMissionsAgainstUs', 'StopAttacks', 'LeaveSystem', 'RequestJointWar', 'RequestJointTradeSanctions',
        'RequestStopWar', 'RequestLiftTradeSanctions', 'GiveGift', 'Informational', 'ShipBaseCompleted', 'ShipBasePurchased', 'NewColony',
        'NewColonyFailed', 'ResearchBreakthrough', 'BattleUnderAttack', 'BattleAttacking', 'IncomingEnemyFleet', 'CharacterAppearance',
        'CharacterDeath', 'CharacterMissionAccomplished', 'CharacterMissionFailure', 'EmpireDiscovered', 'ColonyGained', 'ColonyLost',
        'ColonyDefended', 'ColonyRebelling', 'EmpireDefeated', 'RequestHonorMutualDefense', 'BlockadeInitiated', 'BlockadeCancelled',
        'ExplorationRuins', 'ExplorationBuiltObject', 'ExplorationHabitat', 'ExplorationLocation', 'GalacticHistory', 'SellInfoUnmetEmpire',
        'SellInfoIndependentColony', 'SellInfoSystemMap', 'SellInfoRuins', 'SellInfoDebrisField', 'SellInfoRestrictedArea',
        'SellInfoPlanetDestroyer', 'PirateOfferProtection', 'CancelPirateProtection', 'Revolution', 'RestrictedResourceDiscovered',
        'RestrictedResourceTradingAllowed', 'RestrictedResourceTradingBlocked', 'OfferTrade', 'ShipMissionComplete', 'ShipNeedsRefuelling',
        'ShipNeedsRepair', 'RemoveForcesFromSystem', 'GeneralWarning', 'GeneralBadEvent', 'GeneralNeutralEvent', 'GeneralGoodEvent',
        'GeneralDecision', 'HistoryOfferLocationHint', 'HistoryOfferStoryClue', 'ColonyFacilityCompleted', 'ColonyFacilityCancelled',
        'ColonyWonderBegun', 'ColonyShipMissionCancelled', 'StoryMessage', 'AdvisorSuggestion', 'ColonyDestroyed', 'MilitaryRefuelingAllowed',
        'MilitaryRefuelingBlocked', 'MiningRightsAllowed', 'MiningRightsBlocked', 'CharacterSkillTraitChange', 'ResearchCriticalBreakthrough',
        'ResearchCriticalFailure', 'GalacticNewsNet', 'ShipBaseBoardedCaptured', 'ShipBaseBoardedLost', 'PirateAttackMissionAvailable',
        'PirateAttackMissionCompleted', 'PirateAttackMissionFailed', 'PirateDefendMissionFailed', 'PirateDefendMissionAvailable',
        'PirateDefendMissionCompleted', 'PirateSmugglingMissionAvailable', 'PirateSmugglingMissionCompleted', 'PirateSmugglerDetected',
        'PlanetaryFacilityDestroyed', 'ShipBaseScrapped', 'ConstructionResourceShortage', 'RaidBonuses', 'RaidVictim', 'PlanetaryFacilityDamaged'];
    const msgSamples = {};                // first few descriptions per type (whole run)
    const hookMessages = (e) => {
        if (e === null || e.messages === null || e.messages.__statsHooked) return;
        const list = e.messages, prev = list.push;
        list.push = function (...items) {
            for (const m of items) {
                const k = MSG[m.messageType] ?? String(m.messageType);
                msgCounts[k] = (msgCounts[k] ?? 0) + 1;
                const arr = (msgSamples[k] ??= []);
                if (arr.length < 4) arr.push(`d${day().toFixed(0)} ${e.name}: ${String(m.description).slice(0, 160)}`);
            }
            return prev.apply(this, items);
        };
        Object.defineProperty(list, '__statsHooked', { value: true });
    };
    const consoleErrors = [];
    if (statsDays > 0) {
        for (const e of [...g.empires, ...g.pirateEmpires]) hookMessages(e);
        for (const level of ['error', 'warn']) {
            const orig = console[level];
            console[level] = (...a) => { consoleErrors.push({ day: day(), level, text: a.map(String).join(' ').slice(0, 300) }); if (consoleErrors.length <= 20) orig(...a); };
        }
    }
    const { annualTaxRevenue } = await load('forceStructure');
    let watched = null;
    if (watchMoney !== null) {
        const [wName, wThr] = String(watchMoney).split(':');
        watched = g.empires.find((e) => e !== null && e.name === wName) ?? null;
        if (watched === null) console.log(`watch-money: no empire named ${wName}`);
        else {
            const thr = Number(wThr ?? 5000);
            let v = watched.stateMoney;
            Object.defineProperty(watched, 'stateMoney', { configurable: true, enumerable: true, get: () => v, set: (nv) => {
                if (Math.abs(nv - v) >= thr) {
                    const st = new Error().stack.split('\n').slice(2, 9).map((l) => l.trim().replace(/^at /, '').replace(/\(.*?\/(src\/sim\/[^)]*)\)/, '($1)')).join(' < ');
                    console.log(`  MONEY d${day().toFixed(2)} ${watched.name}: ${v.toFixed(0)} → ${nv.toFixed(0)} (${(nv - v).toFixed(0)}) ${st}`);
                }
                v = nv;
            } });
        }
    }
    const missionSince = new Map();
    const idleSince = new Map(), lowFuelSince = new Map(), aliveIds = new Map();
    let periodTimings = {}, periodFrames = 0, periodMs = 0, periodTodo = {}, lastStatMs = 0;
    const REL = ['NotMet', 'None', 'FTA', 'MDP', 'Subjugated', 'Protectorate', 'Sanctions', 'War', 'Truce'];
    const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
    const snapshot = () => {
        const d = day();
        const realEmpires = g.empires.filter((e) => e !== null);
        const rows = [];
        let nanHits = [];
        const relPairs = {};
        for (const e of realEmpires) {
            let pop = 0;
            for (const h of e.colonies) { const t = h?.population?.totalAmount ?? 0; if (!isNum(t)) nanHits.push(`pop ${h.name}`); pop += t; }
            if (!isNum(e.stateMoney)) nanHits.push(`money ${e.name}`);
            const byRole = {};
            let idle = 0, idle90 = 0, lowFuel = 0, lowFuel90 = 0, building = 0, mil = 0;
            for (const b of e.builtObjects) {
                if (b === null || b.hasBeenDestroyed) continue;
                if (!isNum(b.xpos) || !isNum(b.ypos) || !isNum(b.currentFuel)) nanHits.push(`bo ${b.name}`);
                if (b.builtAt !== null) { building++; continue; }
                const k = b.subRole;
                byRole[k] = (byRole[k] ?? 0) + 1;
                const mobile = k >= 1 && k <= 17;
                if (!mobile) continue;
                if (k <= 8) mil++;
                const mt = b.mission?.type ?? 0;
                if (mt === 0) { if (!idleSince.has(b)) idleSince.set(b, d); idle++; if (d - idleSince.get(b) >= 90) idle90++; }
                else idleSince.delete(b);
                if (b.fuelCapacity > 0 && b.currentFuel < 0.1 * b.fuelCapacity) { if (!lowFuelSince.has(b)) lowFuelSince.set(b, d); lowFuel++; if (d - lowFuelSince.get(b) >= 90) lowFuel90++; }
                else lowFuelSince.delete(b);
            }
            // Private sector (freighters, mining ships, passenger ships, mining stations, …: Empire.PrivateBuiltObjects).
            const priv = {};
            let pIdle = 0, pIdle90 = 0, pLowFuel = 0, pLowFuel90 = 0;
            for (const b of e.privateBuiltObjects) {
                if (b === null || b.hasBeenDestroyed) continue;
                if (!isNum(b.xpos) || !isNum(b.ypos) || !isNum(b.currentFuel)) nanHits.push(`pbo ${b.name}`);
                if (b.builtAt !== null) { building++; continue; }
                priv[b.subRole] = (priv[b.subRole] ?? 0) + 1;
                if (!(b.subRole >= 1 && b.subRole <= 17)) continue;
                const mt = b.mission?.type ?? 0;
                if (mt === 0) { if (!idleSince.has(b)) idleSince.set(b, d); pIdle++; if (d - idleSince.get(b) >= 90) pIdle90++; }
                else idleSince.delete(b);
                if (b.fuelCapacity > 0 && b.currentFuel < 0.1 * b.fuelCapacity) { if (!lowFuelSince.has(b)) lowFuelSince.set(b, d); pLowFuel++; if (d - lowFuelSince.get(b) >= 90) pLowFuel90++; }
                else lowFuelSince.delete(b);
            }
            const rel = {};
            for (const r of e.diplomaticRelations) {
                if (r.otherEmpire === null || !g.empires.includes(r.otherEmpire)) continue;
                const n = REL[r.type] ?? r.type;
                rel[n] = (rel[n] ?? 0) + 1;
                if (r.type >= 2) { const key = [e.empireId, r.otherEmpire.empireId].sort((a, b) => a - b).join('-') + ':' + n; relPairs[key] = (relPairs[key] ?? 0) + 1; }
            }
            let cash = null;
            // ThisYearsSpacePortIncome (Empire.cs 2282) resets/ages per-base income on read unless the empire is in averaged
            // mode, so read it in averaged mode to keep the observer side-effect free.
            const avg = e.useAveragedVariableIncome;
            e.useAveragedVariableIncome = true;
            try { cash = calculateAnnualCashflow(g, e); } catch (err) { cash = 'ERR ' + String(err).slice(0, 80); }
            e.useAveragedVariableIncome = avg;
            if (typeof cash === 'number' && !isNum(cash)) nanHits.push(`cashflow ${e.name}`);
            const researched = e.research?.techTree?.filter((n) => n.isResearched).length ?? 0;
            rows.push({ name: e.name, colonies: e.colonies.length, pop, money: e.stateMoney, cashflow: cash, ships: byRole, mil, building, idle, idle90, lowFuel, lowFuel90,
                researched, characters: e.characters.length, rel, priv, pIdle, pIdle90, pLowFuel, pLowFuel90 });
        }
        // pirates: count, money, ships, missions
        const pir = { factions: 0, alive: 0, money: 0, ships: 0, bases: 0, missions: {} };
        for (const p of g.pirateEmpires) {
            if (p === null) continue;
            pir.factions++;
            if (!isNum(p.stateMoney)) nanHits.push(`money ${p.name}`);
            pir.money += p.stateMoney;
            let any = false;
            for (const b of p.builtObjects) {
                if (b === null || b.hasBeenDestroyed || b.builtAt !== null) continue;
                any = true;
                if (b.subRole >= 18) { pir.bases++; continue; }
                pir.ships++;
                const mt = MISSION[b.mission?.type ?? 0];
                pir.missions[mt] = (pir.missions[mt] ?? 0) + 1;
            }
            if (any) pir.alive++;
        }
        // destroyed since the last snapshot, by owner kind
        const destroyed = { empire: 0, pirate: 0, other: 0 };
        const nowAlive = new Map();
        for (const b of g.builtObjects) if (b !== null && !b.hasBeenDestroyed) nowAlive.set(b, b.empire === null ? 'other' : g.pirateEmpires.includes(b.empire) ? 'pirate' : g.empires.includes(b.empire) ? 'empire' : 'other');
        for (const [b, kind] of aliveIds) if (!nowAlive.has(b)) destroyed[kind]++;
        aliveIds.clear(); for (const [b, k] of nowAlive) aliveIds.set(b, k);
        for (const h of g.habitats) if (h !== null && h.population != null && !isNum(h.population.totalAmount)) nanHits.push(`habpop ${h.name}`);
        const wars = Object.keys(relPairs).filter((k) => k.endsWith(':War')).length;
        const treaties = {}; for (const k of Object.keys(relPairs)) { const n = k.split(':')[1]; treaties[n] = (treaties[n] ?? 0) + 1; }
        const snap = { day: d, wars, treaties, rows, pirates: pir, destroyed, messages: { ...msgCounts }, nan: nanHits.slice(0, 20), nanCount: nanHits.length,
            consoleErrors: consoleErrors.length, exceptions: out.exceptions.length, msPerFrame: periodMs / Math.max(1, periodFrames), frames: periodFrames,
            timings: periodTimings, todo: periodTodo, builtObjects: g.builtObjects.filter((b) => b !== null).length, heap: process.memoryUsage().heapUsed };
        stats.push(snap);
        for (const k of Object.keys(msgCounts)) delete msgCounts[k];
        periodTimings = {}; periodFrames = 0; periodMs = 0; periodTodo = {};
        const f0 = (v) => (typeof v === 'number' ? v.toFixed(0) : String(v));
        console.log(`STATS day ${d.toFixed(0)}: ms/frame ${snap.msPerFrame.toFixed(3)} bo ${snap.builtObjects} heap ${mb(snap.heap)} wars ${wars} treaties ${JSON.stringify(treaties)} destroyed ${JSON.stringify(destroyed)} nan ${snap.nanCount} exc ${snap.exceptions} consoleErr ${snap.consoleErrors}`);
        console.log(`  pirates: ${pir.alive}/${pir.factions} with ships, money ${f0(pir.money)}, ships ${pir.ships} bases ${pir.bases}, missions ${JSON.stringify(pir.missions)}`);
        console.log(`  msgs ${JSON.stringify(snap.messages)}`);
        const tt = Object.entries(snap.timings).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${(v / Math.max(1, snap.frames)).toFixed(3)}`).join(', ');
        if (tt) console.log(`  ms/frame by pass: ${tt}`);
        if (Object.keys(snap.todo).length) console.log(`  todo ${JSON.stringify(snap.todo)}`);
        // Built colony ships: mission, target, distance to it, speed, fuel, first commands (to spot ones that never arrive).
        const CMD = ['Hold', 'ImpulseTo', 'MoveTo', 'SprintTo', 'HyperTo', 'ConditionalHyperTo', 'Escort', 'Dock', 'Undock', 'Load', 'Unload', 'Attack', 'Refuel',
            'Build', 'Scrap', 'Retrofit', 'Repair', 'SelfDestruct', 'RepeatSubsequentCommands', 'EvaluateThreats', 'SelectTargetToAttack', 'ReassignMission',
            'SetParent', 'ClearParent', 'ClearAttackers', 'Blockade', 'Colonize', 'ExtractResources', 'ScanArea', 'Deploy'];
        snap.colonyShips = [];
        for (const e of realEmpires) for (const b of e.builtObjects) {
            if (b === null || b.hasBeenDestroyed || b.subRole !== 13 || b.builtAt !== null) continue;
            const m = b.mission, t = m?.target ?? null;
            const dist = t === null ? -1 : Math.hypot(b.xpos - t.xpos, b.ypos - t.ypos);
            const cmds = (m?._commands ?? []).slice(0, 4).map((c) => CMD[c.action] ?? c.action).join('>');
            snap.colonyShips.push({ empire: e.name, name: b.name, mission: MISSION[m?.type ?? 0], target: t?.name ?? null, dist: Math.round(dist), speed: b.currentSpeed, fuel: Math.round(b.currentFuel), fuelCap: b.fuelCapacity, cmds, x: Math.round(b.xpos), y: Math.round(b.ypos) });
        }
        // Ships idle (no mission) or below 10% fuel for >= 90 days: name, sub role, mission, fuel, speed, position, nearest system.
        snap.stuck = [];
        for (const e of realEmpires) for (const list of [e.builtObjects, e.privateBuiltObjects]) for (const b of list) {
            if (b === null || b.hasBeenDestroyed || b.builtAt !== null) continue;
            const idleD = idleSince.has(b) ? d - idleSince.get(b) : 0, fuelD = lowFuelSince.has(b) ? d - lowFuelSince.get(b) : 0;
            if (idleD < 90 && fuelD < 90) continue;
            const m = b.mission;
            snap.stuck.push({ empire: e.name, name: b.name, subRole: b.subRole, private: list === e.privateBuiltObjects, idleDays: Math.round(idleD), lowFuelDays: Math.round(fuelD), mission: MISSION[m?.type ?? 0],
                target: m?.target?.name ?? null, cmds: (m?._commands ?? []).slice(0, 4).map((c) => c.action).join('>'), fuel: Math.round(b.currentFuel), fuelCap: b.fuelCapacity, speed: b.currentSpeed,
                x: Math.round(b.xpos), y: Math.round(b.ypos), parent: b.parentHabitat?.name ?? null, fleet: b.shipGroup?.name ?? null });
        }
        if (watched !== null) {
            const e = watched, avg = e.useAveragedVariableIncome;
            e.useAveragedVariableIncome = true;
            const t = { tax: annualTaxRevenue(g, e), tradeBonus: 0, spacePort: 0, resort: e.thisYearsResortIncomeValue, maint: 0, fuel: e.thisYearsStateFuelCosts };
            for (let i = 0; i < e.diplomaticRelations.count; i++) t.tradeBonus += e.diplomaticRelations.at(i).annualTradeBonus;
            const ports = [];
            for (const list of [e.spacePorts, e.miningStations]) for (const b of list ?? []) if (b !== null) { t.spacePort += b.currentYearsIncome; if (b.currentYearsIncome > 5000) ports.push(`${b.name} ${b.currentYearsIncome.toFixed(0)}`); }
            for (const b of e.builtObjects) if (b !== null && b.unbuiltComponentCount <= 0) t.maint += b.annualSupportCost;
            e.useAveragedVariableIncome = avg;
            console.log(`  WATCH ${e.name}: money ${e.stateMoney.toFixed(0)} ${Object.entries(t).map(([k, v]) => `${k} ${Number(v).toFixed(0)}`).join(' ')} ports>5k [${ports.join(', ')}] colonies ${e.colonies.map((h) => `${h.name}(${(h.population?.totalAmount / 1e6).toFixed(0)}M tax ${Number(h.annualTaxRevenue).toFixed(0)})`).join(' ')}`);
        }
        // Ships (state, private, pirate) whose mission (type + target) has not changed for >= 90 days while staying within
        // 20000 units of where that mission was first seen: a mission that makes no progress.
        snap.frozen = [];
        for (const e of [...realEmpires, ...g.pirateEmpires]) {
            if (e === null) continue;
            for (const list of [e.builtObjects, e.privateBuiltObjects ?? []]) for (const b of list) {
                if (b === null || b.hasBeenDestroyed || b.builtAt !== null || !(b.subRole >= 1 && b.subRole <= 17)) continue;
                const m = b.mission;
                if (m === null || (m.type ?? 0) === 0) { missionSince.delete(b); continue; }
                const sig = `${m.type}|${m.target?.name ?? ''}`;
                let r = missionSince.get(b);
                if (r === undefined || r.sig !== sig || Math.hypot(b.xpos - r.x, b.ypos - r.y) > 20000) { r = { sig, since: d, x: b.xpos, y: b.ypos }; missionSince.set(b, r); }
                if (d - r.since >= 90) snap.frozen.push({ empire: e.name, pirate: g.pirateEmpires.includes(e), name: b.name, subRole: b.subRole, days: Math.round(d - r.since), mission: MISSION[m.type],
                    target: m.target?.name ?? null, cmds: (m._commands ?? []).slice(0, 4).map((c) => c.action).join('>'), fuel: Math.round(b.currentFuel), fuelCap: b.fuelCapacity, speed: b.currentSpeed,
                    dist: m.target ? Math.round(Math.hypot(b.xpos - m.target.xpos, b.ypos - m.target.ypos)) : -1 });
            }
        }
        const frozenBy = {};
        for (const c of snap.frozen) { const k = `${c.pirate ? 'pirate' : 'empire'}:${c.mission}`; frozenBy[k] = (frozenBy[k] ?? 0) + 1; }
        if (snap.frozen.length) console.log(`  frozen missions (>=90d, <20k moved): ${JSON.stringify(frozenBy)}`);
        // Ships whose current command is HyperTo with the jump countdown already past (waiting on the gravity well /
        // fighter recall in CheckFightersOnboardAndRetrieve): count, and the ones waiting longest.
        snap.hyperWait = [];
        const sd = g.nowMs;
        for (const b of g.builtObjects) {
            if (b === null || b.hasBeenDestroyed) continue;
            const c0 = b.mission?._commands?.[0];
            if (c0 === undefined || c0.action !== 4 || b.hyperjumpCountdown <= 0 || sd < b.hyperjumpCountdown) continue;
            const fOut = (b.fighters ?? []).filter((fi) => !fi.onboardCarrier && !fi.hasBeenDestroyed).length;
            snap.hyperWait.push({ name: b.name, owner: b.empire?.name ?? '-', waitDays: Math.round((sd - b.hyperjumpCountdown) / 1000 / 600 * 365), fightersOut: fOut, fighters: (b.fighters ?? []).length,
                star: b.nearestSystemStar?.name ?? null, mission: MISSION[b.mission?.type ?? 0], speed: Math.round(b.currentSpeed), warp: b.warpSpeed });
        }
        snap.hyperWait.sort((a, b) => b.waitDays - a.waitDays);
        if (snap.hyperWait.length) console.log(`  hyperWait ${snap.hyperWait.length}: ${snap.hyperWait.slice(0, 6).map((h) => `${h.owner.slice(0, 14)}/${h.name} ${h.waitDays}d fighters ${h.fightersOut}/${h.fighters} star ${h.star} ${h.mission} v${h.speed}`).join('; ')}`);
        for (const c of snap.stuck) console.log(`  stuck ${c.empire.slice(0, 16)} ${c.private ? 'priv ' : ''}${c.name} sub ${c.subRole} idle ${c.idleDays}d lowfuel ${c.lowFuelDays}d ${c.mission}→${c.target} cmds ${c.cmds} fuel ${c.fuel}/${c.fuelCap} speed ${Number(c.speed).toFixed(0)} parent ${c.parent} fleet ${c.fleet} at ${c.x},${c.y}`);
        for (const c of snap.colonyShips) console.log(`  colship ${c.empire.slice(0, 16)} ${c.name}: ${c.mission}→${c.target} dist ${c.dist} speed ${c.speed.toFixed(0)} fuel ${c.fuel}/${c.fuelCap} cmds ${c.cmds} at ${c.x},${c.y}`);
        for (const r of rows) console.log(`  ${r.name.slice(0, 24).padEnd(24)} col ${r.colonies} pop ${(r.pop / 1e6).toFixed(0)}M $${f0(r.money)} cf ${f0(r.cashflow)} mil ${r.mil} bld ${r.building} idle ${r.idle}/${r.idle90} lowfuel ${r.lowFuel}/${r.lowFuel90} res ${r.researched} chr ${r.characters} rel ${JSON.stringify(r.rel)} ships ${JSON.stringify(r.ships)} priv ${JSON.stringify(r.priv)} pidle ${r.pIdle}/${r.pIdle90} plowfuel ${r.pLowFuel}/${r.pLowFuel90}`);
    };
    let frames = 0, draws = 0, cpuTotal = 0;
    // Expansion summary: game-day each empire first holds more than one colony.
    const firstSecond = new Map();
    const noteExpansion = () => { for (const e of g.empires) if (e !== null && e.colonies.length > 1 && !firstSecond.has(e)) firstSecond.set(e, g.nowMs / 1000 / 600 * 365); };
    t = performance.now();
    for (const secs of plan) {
        const cpu0 = process.cpuUsage(), c0 = performance.now(), f0 = schedulerState(g).frames, d0 = g.rnd.drawCount;
        try {
            const r = runGameSeconds(g, secs, profile || statsDays > 0 ? { profileClock: () => performance.now() } : {});
            for (const [k, v] of Object.entries(r.timings)) { timings[k] = (timings[k] ?? 0) + v; periodTimings[k] = (periodTimings[k] ?? 0) + v; }
            for (const [k, v] of Object.entries(r.todoHits)) { todo[k] = (todo[k] ?? 0) + v; periodTodo[k] = (periodTodo[k] ?? 0) + v; }
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
        periodFrames += f; periodMs += ms;
        if (statsDays > 0 && g.nowMs >= lastStatMs + Math.round(statsDays * 600 / 365 * 1000) - 50) { lastStatMs = g.nowMs; snapshot(); }
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
    if (statsDays > 0) {
        if (g.nowMs > lastStatMs + 1000) snapshot();
        console.log('message samples:');
        for (const [k, v] of Object.entries(msgSamples)) console.log(`  ${k}: ${v.join(' | ')}`);
        if (statsJson !== null) writeFileSync(String(statsJson), JSON.stringify({ seed, stars, empires, seconds, stats, msgSamples, consoleErrors, exceptions: out.exceptions, colonyShips: out.colonyShips, todo }, null, 1));
    }
} finally {
    await server?.close();
    if (bundleDir !== null && !process.env.KEEP) rmSync(bundleDir, { recursive: true, force: true });
}
