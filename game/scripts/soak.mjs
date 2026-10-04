#!/usr/bin/env node
// Long-game soak: headless games over a matrix of wizard setups (seeds, galaxy sizes up to 2500 stars, standard /
// pirate-player / pre-warp / story / jump-start / Introductory starts, difficulty / aggression / life / creature
// extremes, and every mod-layer scenario with its flags on), each run for many game years with invariant scans.
//
//   nice -n 15 node scripts/soak.mjs                         # every config, 3 child processes at nice 15
//   nice -n 15 node scripts/soak.mjs --only std-s1,rim-herders --jobs 2 [--years N] [--out DIR]
//   nice -n 15 node scripts/soak.mjs --set long             # the many-decade runs
//   node scripts/soak.mjs --list                             # the config names
//   nice -n 15 node --expose-gc scripts/soak.mjs --run NAME [--years N] [--out DIR] [--hook dbg.mjs]   # one config, in process
//
// Per config (a child process per config in the default driver mode):
// - the game is built the way the app builds it (StartGameOptions → toCreateGameOptions → createGame, the scenario
//   overlay applied over the fs game data), then run in `--chunk`-second runGameSeconds calls;
// - an exception inside a chunk is recorded (stack, game day) and the run goes on with the next chunk (soak mode);
//   the same exception at the same game time twice in a row stops the run (no progress);
// - every `--scan-days` game days: a scan of the live object graph from the Galaxy (non-finite numbers by
//   Class.field, negative Cargo / Population amounts, references from live objects to destroyed / detached ships,
//   habitats, creatures, removed empires and disbanded fleets by Class.field) plus hard invariants (list membership
//   and owner back-pointers, NaN positions / money / population);
// - heap after a forced GC each scan (memory growth), wall ms per game year and the slowest frames (tick blowups;
//   a frame's time is measured from the end of the previous frame of the same chunk, so the scans, save checks and
//   hooks between chunks are not counted as a frame — before 2026-10-04 the first frame after a scan carried the scan
//   and its forced GC, the soak's "4 s frames");
// - `--hook scripts/soak-timing-hook.mjs`: per-year frame-time percentiles, CPU and per-pass ms, and the passes /
//   CPU-profile functions behind each slow frame (report.timing);
// - at `--save-at` (fraction of the run, default 0.5): serializeGame → deserializeGame, re-serialize the loaded game
//   (round-trip identity), then run the original and the loaded copy `--save-run` game seconds each and compare
//   stateDigest and the full save text (divergence), with the first differing field path when they differ.
// Results: <out>/<config>.json and a summary table (<out>/summary.json) in driver mode.
import { build } from 'rolldown';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    if (i < 0) return fallback;
    const v = process.argv[i + 1];
    return v === undefined || v.startsWith('--') ? true : v;
}

// ---------------------------------------------------------------------------------------------------------------
// Config matrix. `wizard` overrides fields of defaultStartGameOptions(); `stars` overrides the wizard's star count
// (beyond its 1400 maximum); `scenario` is a folder under scenarios/ with `flags: 'all'` (every flag of the resolved
// manifest on, except `flagsOff`) and `params` overrides (threats made to appear early enough for the run).
// ---------------------------------------------------------------------------------------------------------------
const early = (prefix) => ({ [`${prefix}ExistChancePct`]: 100, [`${prefix}MinYear`]: 0 });
const SCN = (id, extra = {}) => ({ name: id, seed: 101 + id.length * 7, years: 4, wizard: { starCountIndex: 2, dimensionIndex: 2, otherEmpires: { empireCount: 7 } }, scenario: id, flags: 'all', ...extra });
const CONFIGS = [
    // Standard starts across seeds and galaxy sizes.
    { name: 'std-s1', seed: 1, years: 12, wizard: {} },
    { name: 'std-s7-small', seed: 7, years: 16, wizard: { starCountIndex: 1, dimensionIndex: 1, otherEmpires: { empireCount: 5 } } },
    { name: 'std-s23-tiny', seed: 23, years: 20, wizard: { starCountIndex: 0, dimensionIndex: 0, otherEmpires: { empireCount: 3 } } },
    { name: 'std-s42-1400-mature', seed: 42, years: 5, wizard: { starCountIndex: 5, dimensionIndex: 4, otherEmpires: { empireCount: 19 }, galaxyExpansionIndex: 4, empireExpansionIndex: 4 } },
    { name: 'huge-s3-2500', seed: 3, years: 3, stars: 2500, wizard: { starCountIndex: 5, dimensionIndex: 4, otherEmpires: { empireCount: 29 }, galaxyExpansionIndex: 2, empireExpansionIndex: 2 } },
    // Player kinds and eras.
    { name: 'pirate-player', seed: 11, years: 10, wizard: { empireType: 'CustomPirate', piratePlayStyleIndex: 1 } },
    { name: 'prewarp-shadows', seed: 19, years: 12, wizard: { galaxyExpansionIndex: 0, empireExpansionIndex: 0, empireTechLevelIndex: 0, victory: { enableStoryEventsShadows: true, enableDisasterEvents: true } } },
    { name: 'story-shakturi-dw', seed: 5, years: 12, wizard: { victory: { enableStoryEvents: true, enableStoryDistantWorlds: true, enableDisasterEvents: true, enableRaceSpecificEvents: true, enableRaceSpecificConditions: true } } },
    { name: 'jump-shakturi', seed: 9, years: 8, wizard: { empireType: 'ReturnOfTheShakturi' } },
    { name: 'jump-legends', seed: 29, years: 8, wizard: { empireType: 'Legends' } },
    { name: 'jump-shadows-pirate', seed: 31, years: 8, wizard: { empireType: 'ShadowsPirate' } },
    { name: 'introductory', seed: 13, years: 8, wizard: { empireType: 'Introductory' } },
    // Setting extremes.
    { name: 'hard-aggressive', seed: 17, years: 10, wizard: { difficultyIndex: 4, difficultyScaling: true, aggressionIndex: 4, alienLifeIndex: 4, spaceCreaturesIndex: 3, piratesIndex: 5, pirateProximityIndex: 2, pirateStrengthIndex: 3, colonyPrevalenceIndex: 4 } },
    { name: 'easy-quiet', seed: 37, years: 10, wizard: { difficultyIndex: 0, aggressionIndex: 0, alienLifeIndex: 0, spaceCreaturesIndex: 0, piratesIndex: 0, colonyPrevalenceIndex: 0, spawnNewEmpires: false } },
    { name: 'old-galaxy-victory', seed: 53, years: 8, wizard: { galaxyExpansionIndex: 5, empireExpansionIndex: 3, victory: { territory: true, territoryPercent: 30, economy: true, economyPercent: 30, population: true, populationPercent: 30, timeLimit: true, timeLimitYears: 6 } } },
    // Mod-layer scenarios, every flag on.
    SCN('rim-herders', { years: 6 }),
    SCN('rim-fauna', { years: 6 }),
    SCN('new-fauna', { years: 5 }),
    SCN('rim-frontier', { years: 5 }),
    SCN('frontier-autonomy', { years: 5 }),
    SCN('court-dynasties', { years: 5 }),
    SCN('independents-active', { years: 6 }),
    SCN('emergent', { years: 6 }),
    SCN('internal-security', { years: 6, params: { ...early('threat'), ...early('cult'), cultSeedYear: 1, ...early('doppelgangers'), ...early('hive'), ...early('greyTide'), greyTideSeedYear: 1, ...early('corporateCoup'), coupMinYears: 1 } }),
    SCN('reputation', { years: 5 }),
    SCN('lively-galaxy', { years: 6 }),
    SCN('galactic-council', { years: 5 }),
    SCN('chartered-companies', { years: 5, params: { aiCharterChancePct: 100 } }),
    SCN('rimTrade', { years: 5 }),
    SCN('wreckage-salvage', { years: 5 }),
    SCN('llm-layer', { years: 4 }),
    SCN('exchange', { years: 5, params: { ...early('exchange'), exchangeYear: 1 } }),
    SCN('darkfarms', { years: 5, params: { ...early('darkFarms'), graceYears: 1, spawnChancePerMille: 300, minDevelopment: 0, minPopulationMillions: 0 } }),
    SCN('robotmutiny', { years: 5, params: { ...early('robotMutiny'), mutinyYear: 2, mutinyMinRobots: 1, ...early('darkFarms') } }),
    SCN('timebomb', { years: 5, params: { ...early('timeBomb'), timeBombStartYear: 1, timeBombChancePerMillePerColony: 200, ...early('cult') } }),
    SCN('silence', { years: 5, params: { ...early('silence'), silenceStartYear: 1 } }),
    SCN('ghostarmada', { years: 5, params: { ...early('ghostArmada'), ghostDelayYears: 0 } }),
    SCN('greytide', { years: 5, params: { ...early('greyTide'), greyTideSeedYear: 1 } }),
    SCN('hive', { years: 5, params: { ...early('hive'), hiveThresholdPct: 5, hiveMinNodes: 1 } }),
    SCN('cult', { years: 5, params: { ...early('cult'), cultSeedYear: 1, cultSpreadPct: 50 } }),
    SCN('doppelgangers', { years: 5, params: { ...early('doppelgangers'), doppelPlantPerYear: 10 } }),
    SCN('corporatecoup', { years: 5, params: { ...early('corporateCoup'), coupMinYears: 1 } }),
    SCN('refugees-demographics', { years: 5 }),
    SCN('resource-crises', { years: 5 }),
    SCN('espionage-consequences', { years: 5 }),
    SCN('event-log', { years: 4 }),
    SCN('ai-parity', { name: 'ai-parity-all', seed: 61, years: 6, wizard: { starCountIndex: 3, dimensionIndex: 3, otherEmpires: { empireCount: 9 } }, flagsOff: ['darkFarmsGameEnd'] }),
    // A scenario at the large end, and a scenario under a pirate player.
    SCN('rim-herders', { name: 'rim-herders-pirate', seed: 71, years: 5, wizard: { empireType: 'CustomPirate', starCountIndex: 3, dimensionIndex: 3 } }),
    SCN('independents-active', { name: 'independents-1400', seed: 73, years: 3, wizard: { starCountIndex: 5, dimensionIndex: 4, otherEmpires: { empireCount: 15 }, galaxyExpansionIndex: 3, empireExpansionIndex: 3 } }),
    // `--set long`: the many-decade runs (not in the default set).
    { name: 'long-s1-30y', set: 'long', seed: 1, years: 30, wizard: {} },
    { name: 'long-s7-small-50y', set: 'long', seed: 7, years: 50, wizard: { starCountIndex: 1, dimensionIndex: 1, otherEmpires: { empireCount: 5 } } },
    { name: 'long-s2-hard-20y', set: 'long', seed: 2, years: 20, wizard: { difficultyIndex: 3, aggressionIndex: 3, piratesIndex: 4, galaxyExpansionIndex: 2, empireExpansionIndex: 2 } },
    { name: 'long-pirate-20y', set: 'long', seed: 47, years: 20, wizard: { empireType: 'CustomPirate', starCountIndex: 2, dimensionIndex: 2, otherEmpires: { empireCount: 7 } } },
    { name: 'long-story-20y', set: 'long', seed: 59, years: 20, wizard: { starCountIndex: 2, dimensionIndex: 2, otherEmpires: { empireCount: 7 }, victory: { enableStoryEvents: true, enableStoryDistantWorlds: true, enableDisasterEvents: true, enableRaceSpecificEvents: true } } },
    SCN('ai-parity', { name: 'long-ai-parity-15y', set: 'long', seed: 67, years: 15, flagsOff: ['darkFarmsGameEnd'] }),
    SCN('internal-security', { name: 'long-internal-security-15y', set: 'long', seed: 79, years: 15 }),
    SCN('independents-active', { name: 'long-independents-15y', set: 'long', seed: 83, years: 15 }),
];

/** Negative amounts the C# has too. */
const FAITHFUL_NEGATIVE = new Set([
    // BuiltObject.2.cs 350 FinalizeContractsNotPresentAtLoad: `cargo.Reserved -= num` with no floor (Cargo.cs 21 a plain int).
    'Cargo.reserved',
    // BuiltObject.2.cs 3803-3826 (Unload): a Freight ship's cargo2.Amount = 0 once the commodity is delivered, then
    // cargo2.Amount -= num13; the next Unload resets a negative amount to 0 (3757).
    'Cargo.amount at BuiltObject role 3',
    // Galaxy.5.cs 5140-5150 DoRaidBonuses: the stolen amount is Rnd.Next(5, Available × num × lootFactor), unclamped to
    // Amount; Available (Amount - Reserved) exceeds Amount once Reserved is negative (above) and the loot factor carries
    // the raider's RaidBonusFactor, so a raided colony / base can go below 0 (later CargoList.Add merges into it).
    'Cargo.amount at Habitat', 'Cargo.amount at BuiltObject role 8',
    // Empire.2.cs 905-913 (pirate force structure): num37 = Min(money / cost, budget / upkeep) is negative for a faction in
    // debt, and the projection amount (int)(0.5 + num39 × num37) with it.
    'ForceStructureProjection._amount',
    // Mod layer, signed by design (a cause's contribution to a character's mood / a colony's drift; grievances are the
    // negative ones, politics.ts 742).
    'GalaxyScenario.state.politics.chars{}.lastCauses[].amount', 'GalaxyScenario.state.politics.chars{}.grievances[].amount',
    'GalaxyScenario.state.frontier.colonies{}.causes[].amount',
]);

/** Non-finite fields the C# has too. */
const FAITHFUL_NONFINITE = new Set([
    // BuiltObject.cs 3083-3094: num50 = (reactor - static energy) / TopSpeedFuelBurn in double, and a Base (no engines,
    // burn 0) keeps the unclamped ±Infinity / NaN.
    'BuiltObject.accelerationRate',
    // BuiltObject.2.cs / Fighter.cs InflictDamage(..., strikeAngle: double.MinValue) → (float)strikeAngle = -Infinity.
    'BuiltObject.lastShieldStrikeDirection',
    'Fighter.lastShieldStrikeDirection',
]);

/** Destroyed objects seen in lists at the previous scan (a destroyed ship is torn down a few frames later). */
let prevDestroyed = new WeakSet();

if (arg('list', false) === true) {
    for (const c of CONFIGS) console.log(`${c.name.padEnd(26)} seed ${String(c.seed).padStart(3)} ${String(c.years).padStart(2)}y ${c.scenario ?? ''}`);
    process.exit(0);
}

const MODULES = { game: '/src/sim/game.ts', sgo: '/src/sim/startGameOptions.ts', load: '/test/helpers/loadGameDataFs.ts',
    harness: '/src/sim/tick/harness.ts', save: '/src/sim/save/gameSave.ts', digest: '/src/sim/tick/digest.ts',
    scenario: '/test/helpers/scenarioGame.ts', time: '/src/sim/galaxyTime.ts' };

async function bundle() {
    const dir = mkdtempSync(resolve(tmpdir(), 'dwu-soak-'));
    await build({ cwd: root, input: Object.fromEntries(Object.entries(MODULES).map(([k, v]) => [k, '.' + v])), platform: 'node',
        transform: { define: { __dirname: JSON.stringify(resolve(root, 'test/helpers')) } },
        output: { dir, format: 'esm', preserveModules: true, preserveModulesRoot: root }, write: true, logLevel: 'warn' });
    return dir;
}

const outDir = resolve(String(arg('out', resolve(root, 'test/.cache/soak'))));
mkdirSync(outDir, { recursive: true });

const runName = arg('run', null);
if (runName === null) await driver();
else await runOne(String(runName));

// ---------------------------------------------------------------------------------------------------------------
// Driver: one child process per config, `--jobs` at a time, every child at nice 15.
// ---------------------------------------------------------------------------------------------------------------
async function driver() {
    const only = arg('only', null);
    const set = arg('set', null);
    const list = only === null ? CONFIGS.filter((c) => (c.set ?? null) === set) : String(only).split(',').map((n) => { const c = CONFIGS.find((x) => x.name === n); if (!c) throw new Error(`no config ${n}`); return c; });
    const jobs = Number(arg('jobs', 3));
    const bundleDir = await bundle();
    const passthrough = ['years', 'chunk', 'scan-days', 'save-at', 'save-run', 'max-heap'].flatMap((k) => (arg(k, null) === null ? [] : [`--${k}`, String(arg(k))]));
    // Longest first (stars × empires × years, roughly), so the big runs do not tail the queue.
    const cost = (c) => (c.stars ?? [100, 250, 400, 700, 1000, 1400][c.wizard?.starCountIndex ?? 3]) * (c.years) * (1 + (c.wizard?.otherEmpires?.empireCount ?? 10) / 10);
    const queue = [...list].sort((a, b) => cost(b) - cost(a));
    const results = [];
    const t0 = performance.now();
    const worker = async () => {
        while (queue.length > 0) {
            const c = queue.shift();
            const started = performance.now();
            const code = await new Promise((res) => {
                const p = spawn('nice', ['-n', '15', process.execPath, '--expose-gc', `--max-old-space-size=${arg('max-heap', 6144)}`, fileURLToPath(import.meta.url),
                    '--run', c.name, '--bundle', bundleDir, '--out', outDir, ...passthrough], { stdio: ['ignore', 'pipe', 'pipe'] });
                const log = [];
                const onData = (d) => { log.push(d); for (const line of String(d).split('\n')) if (line.startsWith('!') || line.startsWith('=')) console.log(`[${c.name}] ${line}`); };
                p.stdout.on('data', onData);
                p.stderr.on('data', onData);
                p.on('close', (code) => { writeFileSync(resolve(outDir, `${c.name}.log`), Buffer.concat(log.map((x) => Buffer.from(x)))); res(code); });
            });
            const file = resolve(outDir, `${c.name}.json`);
            const r = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { name: c.name, crashed: true };
            r.exitCode = code;
            r.wallMinutes = (performance.now() - started) / 60000;
            results.push(r);
            console.log(`= ${c.name} exit ${code} ${r.wallMinutes.toFixed(1)} min — ${oneLine(r)}`);
        }
    };
    await Promise.all(Array.from({ length: Math.min(jobs, list.length) }, worker));
    rmSync(bundleDir, { recursive: true, force: true });
    writeFileSync(resolve(outDir, 'summary.json'), JSON.stringify(results, null, 1));
    console.log(`\n${results.length} configs, ${((performance.now() - t0) / 60000).toFixed(0)} min wall, ${results.reduce((s, r) => s + (r.yearsRun ?? 0), 0).toFixed(1)} game-years`);
    for (const r of results) console.log(`${r.name.padEnd(26)} ${oneLine(r)}`);
}

function oneLine(r) {
    if (r.crashed && r.yearsRun === undefined) return 'CRASHED (no report)';
    const p = [`${(r.yearsRun ?? 0).toFixed(1)}y`, `exc ${r.exceptions?.length ?? 0}`, `hard ${Object.keys(r.hard ?? {}).filter((k) => !k.endsWith('(faithful)')).length}`,
        `nonfinite ${Object.keys(r.lastScan?.nonFinite ?? {}).filter((k) => !k.endsWith('(faithful)')).length}`, `neg ${Object.keys(r.lastScan?.negative ?? {}).filter((k) => !k.endsWith('(faithful)')).length}`,
        `save ${r.saveCheck ? (r.saveCheck.digestEqual && r.saveCheck.textEqual && r.saveCheck.roundTripEqual ? 'ok' : 'DIVERGED') : '-'}`,
        `heap ${r.heapMB?.[0]?.toFixed(0)}→${r.heapMB?.at(-1)?.toFixed(0)}MB`, `maxFrame ${r.maxFrameMs?.toFixed(0)}ms`];
    if (r.crashed) p.push('CRASHED');
    if (r.stuck) p.push('STUCK');
    return p.join(' | ');
}

// ---------------------------------------------------------------------------------------------------------------
// One config in this process.
// ---------------------------------------------------------------------------------------------------------------
async function runOne(name) {
    const cfg = CONFIGS.find((c) => c.name === name);
    if (!cfg) throw new Error(`no config ${name}`);
    const ownBundle = arg('bundle', null) === null;
    const bundleDir = ownBundle ? await bundle() : String(arg('bundle'));
    const load = (key) => import(resolve(bundleDir, key + '.js'));
    const years = Number(arg('years', cfg.years));
    const chunk = Number(arg('chunk', 60));
    const scanDays = Number(arg('scan-days', 120));
    // --save-at 0.3,0.8: fractions of the run at which to do the save → load → continue check (0 = none).
    const saveAts = String(arg('save-at', '0.5')).split(',').map(Number).filter((x) => x > 0);
    const saveRun = Number(arg('save-run', 120));
    const YEAR_S = 600;
    const report = { name, seed: cfg.seed, years, scenario: cfg.scenario ?? null, exceptions: [], hard: {}, scans: [], heapMB: [], yearMs: [], slowFrames: [], consoleErrors: {}, crashed: true };
    const outFile = resolve(outDir, `${name}.json`);
    const flush = () => writeFileSync(outFile, JSON.stringify(report, null, 1));

    // console.error / warn from the sim (counted by message head).
    for (const k of ['error', 'warn']) {
        const orig = console[k].bind(console);
        console[k] = (...a) => { const key = `${k}: ${String(a[0]).slice(0, 160)}`; report.consoleErrors[key] = (report.consoleErrors[key] ?? 0) + 1; if (report.consoleErrors[key] <= 2) orig(...a); };
    }
    process.on('uncaughtException', (e) => { report.fatal = String(e?.stack ?? e); flush(); console.log(`! FATAL ${report.fatal.split('\n')[0]}`); process.exit(3); });

    try {
        const { createGame } = await load('game');
        const { defaultStartGameOptions, toCreateGameOptions, applyEmpireDefaults, defaultRaceName } = await load('sgo');
        const { loadGameDataFs } = await load('load');
        const { runGameSeconds } = await load('harness');
        const { serializeGame, deserializeGame } = await load('save');
        const { stateDigest, stateCounts } = await load('digest');
        const { scenarioGameData } = await load('scenario');
        const { GalaxyTime } = await load('time');

        let gameData = await loadGameDataFs();
        const so = defaultStartGameOptions();
        so.seed = cfg.seed;
        for (const [k, v] of Object.entries(cfg.wizard ?? {})) so[k] = v !== null && typeof v === 'object' && !Array.isArray(v) ? { ...so[k], ...v } : v;
        // The race the wizard defaults to, varied by seed among the playable races (the player's race page).
        const playable = gameData.races.filter((r) => r.playable).sort((a, b) => a.name.localeCompare(b.name));
        so.raceName = playable.length > 0 ? playable[cfg.seed % playable.length].name : defaultRaceName(gameData.races);
        applyEmpireDefaults(so, gameData.races.findIndex((r) => r.name === so.raceName));
        if (cfg.scenario) {
            gameData = scenarioGameData(gameData, cfg.scenario);
            const manifest = gameData.scenario.manifest;
            const flags = {};
            for (const f of manifest.flags) flags[f.name] = cfg.flags === 'all' ? !(cfg.flagsOff ?? []).includes(f.name) : (cfg.flags?.[f.name] ?? f.default);
            const params = {};
            for (const p of manifest.params) params[p.name] = cfg.params?.[p.name] ?? p.default;
            for (const k of Object.keys(cfg.params ?? {})) if (!(k in params)) params[k] = cfg.params[k];
            so.scenario = { id: manifest.id, flags, params };
            report.flags = flags;
            report.params = Object.fromEntries(Object.entries(cfg.params ?? {}));
        }
        const starCount = cfg.stars ?? 0;
        const opts = toCreateGameOptions(so, gameData, Array.from({ length: Math.max(3000, starCount) }, (_, i) => `S${i}`));
        if (cfg.stars) opts.starCount = cfg.stars;
        let t = performance.now();
        const game = createGame(opts);
        report.createMs = performance.now() - t;
        const g = game.galaxy;
        report.start = { stars: g.starCount, empires: g.empires.length, pirates: g.pirateEmpires.length, counts: stateCounts(g), player: g.playerEmpire?.name, race: so.raceName };
        // --hook file.mjs: a debug module; its start(ctx) runs after createGame, chunk(ctx) after every chunk (return
        // 'stop' from either to end the run), frame(ctx, wallMs, galaxy) after every sim frame (synchronous, e.g.
        // scripts/soak-timing-hook.mjs). ctx.chunkSeconds is the --chunk length.
        const hook = arg('hook', null) === null ? null : await import(resolve(String(arg('hook'))));
        const hookCtx = { game, g, gameData, so, load, report, chunkSeconds: chunk };
        const hookFrame = typeof hook?.frame === 'function' ? hook.frame : null;
        console.log(`config ${name}: seed ${cfg.seed}, ${g.starCount} stars, ${g.empires.length} empires, ${g.pirateEmpires.length} pirates, create ${report.createMs.toFixed(0)} ms, digest ${stateDigest(g)}`);

        const total = years * YEAR_S;
        const saveAtS = new Set(saveAts.map((f) => Math.max(chunk, Math.round((total * f) / chunk) * chunk)));
        let lastFrameT = performance.now();
        let maxFrame = 0, maxFrameDay = 0;
        const onFrame = (gal) => {
            const now = performance.now();
            const dt = now - lastFrameT;
            lastFrameT = now;
            if (dt > maxFrame) { maxFrame = dt; maxFrameDay = gal.nowMs / (YEAR_S * 1000 / 360); }
            if (dt > 1000 && report.slowFrames.length < 50) report.slowFrames.push({ day: +(gal.nowMs / (YEAR_S * 1000 / 360)).toFixed(1), ms: Math.round(dt) });
            hookFrame?.(hookCtx, dt, gal);
        };
        const day = () => g.nowMs / ((YEAR_S * 1000) / 360);
        const startMs = g.nowMs;
        let lastScanDay = -Infinity;
        let lastExcKey = null;
        let yearT = performance.now();
        let yearCpu = process.cpuUsage();
        // Wall / CPU ms spent between chunks on the soak's own checks (periodic scans, save checks, hook chunk calls):
        // left out of the per-year figures (yearMs / yearCpuMs), which are the sim's; reported per year as yearOverheadMs.
        report.overhead = { wallMs: 0, cpuMs: 0 };
        let yearOverhead = { wallMs: 0, cpuMs: 0 };
        const overhead = async (fn) => {
            const w0 = performance.now();
            const c0 = process.cpuUsage();
            try {
                return await fn();
            } finally {
                const c = process.cpuUsage(c0);
                report.overhead.wallMs += performance.now() - w0;
                report.overhead.cpuMs += (c.user + c.system) / 1000;
            }
        };
        let yearIdx = 0;
        const doScan = (label) => {
            globalThis.gc?.();
            const heap = process.memoryUsage().heapUsed / 1048576;
            report.heapMB.push(heap);
            const ts = performance.now();
            const s = scanGalaxy(g);
            s.day = +day().toFixed(1);
            s.label = label;
            s.scanMs = Math.round(performance.now() - ts);
            s.heapMB = Math.round(heap);
            s.counts = stateCounts(g);
            const newHard = Object.keys(s.hard).filter((k) => !(k in report.hard));
            for (const [k, v] of Object.entries(s.hard)) {
                const h = (report.hard[k] ??= { count: 0, firstDay: s.day, examples: [] });
                h.count += v.count;
                for (const ex of v.examples) if (h.examples.length < 6) h.examples.push(`d${s.day}: ${ex}`);
            }
            report.scans.push({ day: s.day, heapMB: s.heapMB, scanMs: s.scanMs, objects: s.objects, counts: s.counts, hard: Object.fromEntries(Object.entries(s.hard).map(([k, v]) => [k, v.count])), nonFinite: s.nonFinite, negative: s.negative, deadRefs: s.deadRefs, population: s.population });
            report.lastScan = { nonFinite: s.nonFinite, negative: s.negative, deadRefs: s.deadRefs };
            const hardKeys = Object.keys(s.hard);
            console.log(`  d${s.day.toFixed(0)} heap ${heap.toFixed(0)}MB objs ${s.objects} scan ${s.scanMs}ms ${JSON.stringify(s.counts)}${hardKeys.length ? ' HARD ' + hardKeys.join(',') : ''}${Object.keys(s.nonFinite).length ? ' NONFINITE ' + Object.keys(s.nonFinite).slice(0, 5).join(',') : ''}`);
            for (const k of newHard.filter((x) => !x.endsWith('(faithful)'))) console.log(`! hard ${k} x${s.hard[k].count} d${s.day}: ${s.hard[k].examples[0] ?? ''}`);
            flush();
        };
        if ((await hook?.start?.(hookCtx)) === 'stop') return;
        doScan('start');
        for (let s = 0; s < total; s += chunk) {
            // Frame times exclude the scans / save checks / hooks between chunks.
            lastFrameT = performance.now();
            try {
                runGameSeconds(g, Math.min(chunk, total - s), { onFrame });
            } catch (e) {
                const stack = String(e?.stack ?? e).split('\n').slice(0, 12).join('\n');
                const key = stack.split('\n').slice(0, 3).join('|');
                const rec = report.exceptions.find((x) => x.key === key);
                if (rec) { rec.count++; rec.lastDay = +day().toFixed(1); } else { report.exceptions.push({ key, count: 1, firstDay: +day().toFixed(1), stack }); console.log(`! EXCEPTION d${day().toFixed(1)} ${stack.split('\n').slice(0, 4).join(' / ')}`); }
                const atKey = `${key}@${g.nowMs}`;
                if (atKey === lastExcKey) { report.stuck = true; console.log(`! STUCK at d${day().toFixed(1)}`); break; }
                lastExcKey = atKey;
            }
            if ((await overhead(() => hook?.chunk?.(hookCtx))) === 'stop') break;
            const elapsedS = (g.nowMs - startMs) / 1000;
            report.yearsRun = elapsedS / YEAR_S;
            if (Math.floor(elapsedS / YEAR_S) > yearIdx) {
                yearIdx = Math.floor(elapsedS / YEAR_S);
                const ovWall = report.overhead.wallMs - yearOverhead.wallMs;
                const ovCpu = report.overhead.cpuMs - yearOverhead.cpuMs;
                yearOverhead = { ...report.overhead };
                const ms = performance.now() - yearT - ovWall;
                report.yearMs.push(Math.round(ms));
                const cpu = process.cpuUsage();
                (report.yearCpuMs ??= []).push(Math.round((cpu.user + cpu.system - (yearCpu.user + yearCpu.system)) / 1000 - ovCpu));
                (report.yearOverheadMs ??= []).push(Math.round(ovWall));
                yearCpu = cpu;
                yearT = performance.now();
                console.log(`= year ${yearIdx} ${(ms / 1000).toFixed(0)} s wall (+${(ovWall / 1000).toFixed(0)} s scans / save checks), maxFrame ${maxFrame.toFixed(0)} ms (d${maxFrameDay.toFixed(0)}), exc ${report.exceptions.reduce((a, x) => a + x.count, 0)}`);
            }
            if (day() - lastScanDay >= scanDays) { lastScanDay = day(); await overhead(() => doScan('periodic')); }
            if (saveAtS.has(s + chunk)) await overhead(() => {
                try {
                    report.saveCheck = saveCheck(game, so, gameData, saveRun, { serializeGame, deserializeGame, stateDigest, runGameSeconds, GalaxyTime });
                    const sc = report.saveCheck;
                    (report.saveChecks ??= []).push(sc);
                    console.log(`${sc.digestEqual && sc.textEqual && sc.roundTripEqual ? '=' : '!'} save check d${sc.day}: ${sc.saveMB.toFixed(1)}MB, roundTrip ${sc.roundTripEqual}, digest ${sc.digestEqual} text ${sc.textEqual}${sc.firstDiff ? ' first diff ' + sc.firstDiff : ''}${sc.error ? ' ERROR ' + sc.error.split('\n')[0] : ''}`);
                } catch (e) {
                    report.saveCheck = { error: String(e?.stack ?? e) };
                    (report.saveChecks ??= []).push(report.saveCheck);
                    console.log(`! save check threw ${String(e).split('\n')[0]}`);
                }
                lastFrameT = performance.now();
                flush();
            });
        }
        doScan('end');
        report.maxFrameMs = maxFrame;
        // The summary's save verdict: the first failing check, else the last.
        report.saveCheck = (report.saveChecks ?? []).find((c) => !(c.digestEqual && c.textEqual && c.roundTripEqual)) ?? report.saveCheck;
        report.maxFrameDay = maxFrameDay;
        report.end = { counts: stateCounts(g), digest: stateDigest(g), empires: g.empires.filter((e) => e.active !== false).length };
        report.crashed = false;
    } catch (e) {
        report.fatal = String(e?.stack ?? e);
        console.log(`! FATAL ${report.fatal.split('\n').slice(0, 4).join(' / ')}`);
    } finally {
        flush();
        if (ownBundle) rmSync(bundleDir, { recursive: true, force: true });
    }
    console.log(`= done ${name}: ${oneLine(report)}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Save → load → continue.
// ---------------------------------------------------------------------------------------------------------------
function saveCheck(game, so, gameData, seconds, m) {
    const g = game.galaxy;
    const r = { day: +(g.nowMs / (600000 / 360)).toFixed(1), seconds };
    const time = new m.GalaxyTime();
    const text = m.serializeGame(game, time, so);
    r.saveMB = text.length / 1048576;
    let loaded;
    try {
        loaded = m.deserializeGame(text, gameData);
    } catch (e) {
        r.error = String(e?.stack ?? e);
        return r;
    }
    const text2 = m.serializeGame(loaded.game, time, so);
    r.roundTripEqual = text2 === text;
    if (!r.roundTripEqual) r.roundTripDiff = firstJsonDiff(text, text2);
    const dA0 = m.stateDigest(g), dB0 = m.stateDigest(loaded.game.galaxy);
    r.digestEqualAtLoad = dA0 === dB0;
    let excA = null, excB = null;
    try { m.runGameSeconds(g, seconds); } catch (e) { excA = String(e?.stack ?? e).split('\n').slice(0, 6).join('\n'); }
    try { m.runGameSeconds(loaded.game.galaxy, seconds); } catch (e) { excB = String(e?.stack ?? e).split('\n').slice(0, 6).join('\n'); }
    if (excA || excB) r.runExceptions = { original: excA, loaded: excB };
    r.digestA = m.stateDigest(g);
    r.digestB = m.stateDigest(loaded.game.galaxy);
    r.digestEqual = r.digestA === r.digestB;
    const tA = m.serializeGame(game, time, so), tB = m.serializeGame(loaded.game, time, so);
    r.textEqual = tA === tB;
    if (!r.textEqual) { const d = firstJsonDiff(tA, tB); r.firstDiff = d.path; r.diffs = d.all; }
    return r;
}

/** The first differing paths of two encoded saves (decoded shape names: `Class.field`). */
function firstJsonDiff(a, b) {
    const A = JSON.parse(a), B = JSON.parse(b);
    const shapesA = A.galaxy?.shapes ?? [], shapesB = B.galaxy?.shapes ?? [];
    const all = [];
    const walk = (x, y, path) => {
        if (all.length >= 30) return;
        if (x === y) return;
        if (typeof x !== typeof y || x === null || y === null || typeof x !== 'object') {
            all.push(`${path}: ${JSON.stringify(x)?.slice(0, 80)} vs ${JSON.stringify(y)?.slice(0, 80)}`);
            return;
        }
        if (Array.isArray(x) !== Array.isArray(y)) { all.push(`${path}: array/object`); return; }
        if (typeof x.$s === 'number' && Array.isArray(x.$v) && typeof y.$s === 'number' && Array.isArray(y.$v)) {
            const sa = shapesA[x.$s], sb = shapesB[y.$s];
            if (JSON.stringify(sa) !== JSON.stringify(sb)) { all.push(`${path}: shape ${sa?.[0]} vs ${sb?.[0]}`); return; }
            x.$v.forEach((e, i) => walk(e, y.$v[i], `${path}>${sa[0]}.${sa[i + 1]}`));
            return;
        }
        if (Array.isArray(x)) {
            if (x.length !== y.length) all.push(`${path}: length ${x.length} vs ${y.length}`);
            for (let i = 0; i < Math.min(x.length, y.length); i++) walk(x[i], y[i], `${path}[${i}]`);
            return;
        }
        const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
        for (const k of keys) walk(x[k], y[k], `${path}.${k}`);
    };
    walk(A, B, '');
    // The galaxy graph path is long and index-heavy; keep the class.field chain tail.
    const short = (p) => p.replace(/\[\d+\]/g, '[]').split('>').slice(-4).join('>');
    return { path: all.length ? short(all[0].split(':')[0]) : null, all: all.map((p) => { const [k, ...rest] = p.split(': '); return `${short(k)}: ${rest.join(': ')}`; }) };
}

// ---------------------------------------------------------------------------------------------------------------
// Object-graph scan.
// ---------------------------------------------------------------------------------------------------------------
function scanGalaxy(g) {
    const nowDestroyed = new WeakSet();
    const hard = {};
    const fail = (key, ex) => { const h = (hard[key] ??= { count: 0, examples: [] }); h.count++; if (h.examples.length < 4) h.examples.push(ex); };
    const liveBo = new Set();
    for (const bo of g.builtObjects) if (bo != null) liveBo.add(bo);
    const liveHab = new Set(g.habitats);
    const liveCre = new Set(g.creatures);
    const liveEmp = new Set([...g.empires, ...g.pirateEmpires, ...(g.independentEmpire ? [g.independentEmpire] : [])]);
    const liveGroups = new Set();
    for (const e of liveEmp) for (const sg of e.shipGroups ?? []) liveGroups.add(sg);
    const nm = (o) => (o == null ? String(o) : `${o.constructor?.name}#${o.builtObjectID ?? o.habitatIndex ?? o.creatureId ?? o.empireId ?? ''}${o.name ? ' ' + o.name : ''}`);
    const bad = (x) => typeof x !== 'number' || !Number.isFinite(x);

    // --- Hard invariants.
    for (const bo of liveBo) {
        // A ship destroyed this frame is torn down later (explosion, CompleteTeardown); one still listed a scan later is stuck.
        if (bo.hasBeenDestroyed) {
            if (prevDestroyed.has(bo)) fail('galaxy.builtObjects holds a destroyed object across two scans', `${nm(bo)} role ${bo.role} subRole ${bo.subRole}`);
            nowDestroyed.add(bo);
        }
        if (bad(bo.xpos) || bad(bo.ypos)) fail('BuiltObject position not finite', `${nm(bo)} ${bo.xpos},${bo.ypos}`);
        if (bad(bo.currentFuel)) fail('BuiltObject fuel not finite', `${nm(bo)} ${bo.currentFuel}`);
        if (bo.empire != null && !liveEmp.has(bo.empire)) fail('live BuiltObject owned by a removed empire', `${nm(bo)} empire ${nm(bo.empire)}`);
        const sg = bo.shipGroup;
        if (sg != null) {
            if (!liveGroups.has(sg)) fail('BuiltObject.shipGroup is a disbanded fleet', `${nm(bo)} group ${sg.name}`);
            else if (!sg.ships.includes(bo)) fail('BuiltObject.shipGroup does not list the ship', `${nm(bo)} group ${sg.name}`);
        }
    }
    for (const c of g.creatures) {
        if (bad(c.xpos) || bad(c.ypos)) fail('Creature position not finite', `${nm(c)} ${c.xpos},${c.ypos}`);
        if (c.hasBeenDestroyed) fail('galaxy.creatures holds a destroyed creature', nm(c));
    }
    for (const h of g.habitats) {
        if (bad(h.xpos) || bad(h.ypos)) fail('Habitat position not finite', `${nm(h)} ${h.xpos},${h.ypos}`);
        const tot = h.population?.totalAmount ?? 0;
        if (bad(tot)) fail('Habitat population not finite', `${nm(h)} ${tot}`);
        if (tot < 0) fail('Habitat population negative', `${nm(h)} ${tot}`);
        let sum = 0;
        for (const p of h.population?.items ?? []) { sum += p.amount; if (p.amount < 0 || bad(p.amount)) fail('Population amount negative / not finite', `${nm(h)} ${p.race?.name} ${p.amount}`); }
        if (h.population && Math.abs(sum - tot) > 1) fail('PopulationList.totalAmount != sum of items', `${nm(h)} total ${tot} sum ${sum}`);
        if (h.empire != null && !liveEmp.has(h.empire)) fail('Habitat owned by a removed empire', `${nm(h)} empire ${nm(h.empire)}`);
        // Galaxy.6.cs 882-891: independent colonies are owned by the independent empire without joining its Colonies
        // (Galaxy.IndependentColonies tracks them).
        if (h.empire != null && liveEmp.has(h.empire) && h.empire !== g.independentEmpire && !h.empire.colonies.includes(h)) fail('owned Habitat missing from its empire.colonies', `${nm(h)} empire ${nm(h.empire)}`);
    }
    for (const e of liveEmp) {
        if (bad(e.stateMoney)) fail('Empire.stateMoney not finite', `${nm(e)} ${e.stateMoney}`);
        if (bad(e.privateMoney)) fail('Empire.privateMoney not finite', `${nm(e)} ${e.privateMoney}`);
        if (bad(e.totalPopulation)) fail('Empire.totalPopulation not finite', `${nm(e)} ${e.totalPopulation}`);
        // A pirate faction's Colonies are the colonies it controls (PirateColonyControl, Galaxy.8.cs 3233-3262), owned by others.
        for (const h of e.colonies) {
            if (h.empire !== e && !g.pirateEmpires.includes(e)) fail('empire.colonies holds a habitat it does not own', `${nm(e)} ${nm(h)} owner ${nm(h.empire)}`);
            if (!liveHab.has(h) || h.hasBeenDestroyed) fail('empire.colonies holds a destroyed habitat', `${nm(e)} ${nm(h)}`);
        }
        for (const [listName, list] of [['builtObjects', e.builtObjects], ['privateBuiltObjects', e.privateBuiltObjects]]) {
            for (const bo of list ?? []) {
                if (bo == null) { fail(`empire.${listName} holds null`, nm(e)); continue; }
                // Empire.2.cs 597-604 / Empire.1.cs 752-764 put a pirate-owned private ship in the independent empire's list
                // too, and every later owner change / teardown removes it from Empire / ActualEmpire only (Empire.1.cs
                // 527-608 — a capture then sets PirateEmpireId = 0 at 746 / 782 —, BuiltObject.2.cs 5524-5543), so the C#
                // leaves it in IndependentEmpire.PrivateBuiltObjects: counted, not a failure.
                if (e === g.independentEmpire && listName === 'privateBuiltObjects' && (bo.empire !== e || bo.hasBeenDestroyed)) {
                    fail('independent privateBuiltObjects keeps a captured / destroyed pirate ship (faithful)', `${nm(bo)} empire ${nm(bo.empire)}${bo.hasBeenDestroyed ? ' destroyed' : ''}`);
                    continue;
                }
                if (bo.hasBeenDestroyed) { if (prevDestroyed.has(bo)) fail(`empire.${listName} holds a destroyed object across two scans`, `${nm(e)} ${nm(bo)}`); nowDestroyed.add(bo); }
                else if (!liveBo.has(bo)) fail(`empire.${listName} holds an object not in galaxy.builtObjects`, `${nm(e)} ${nm(bo)}`);
                // Empire.2.cs 597-604 PirateBuildNewShips: a pirate's private civilian ship (and a resort base, in its state
                // list) is in its builder's list and the independent empire's, owned by the independent empire.
                if (bo.empire !== e && !(bo.empire === g.independentEmpire && (listName === 'privateBuiltObjects' || g.pirateEmpires.includes(e)))) fail(`empire.${listName} holds an object of another empire`, `${nm(e)} ${nm(bo)} empire ${nm(bo.empire)}`);
            }
        }
        for (const sg of e.shipGroups ?? []) {
            for (const s of sg.ships) {
                if (s.hasBeenDestroyed || !liveBo.has(s)) { if (prevDestroyed.has(s)) fail('ShipGroup.ships holds a destroyed / removed ship across two scans', `${nm(e)} ${sg.name} ${nm(s)}`); nowDestroyed.add(s); }
                else if (s.shipGroup !== sg) fail('ShipGroup.ships holds a ship of another fleet', `${nm(e)} ${sg.name} ${nm(s)} → ${s.shipGroup?.name}`);
            }
            if (sg.leadShip != null && (sg.leadShip.hasBeenDestroyed || !liveBo.has(sg.leadShip))) { if (prevDestroyed.has(sg.leadShip)) fail('ShipGroup.leadShip destroyed across two scans', `${nm(e)} ${sg.name} ${nm(sg.leadShip)}`); nowDestroyed.add(sg.leadShip); }
        }
    }

    // --- Stocks: cargo amounts by holder kind (the walk below skips the Cargo class, counted here).
    const negStock = {};
    const cargoScan = (holder, kind) => {
        for (const c of holder.cargo?.items ?? []) {
            if (bad(c.amount)) fail('Cargo amount not finite', `${nm(holder)} ${c.amount}`);
            const tag = (k) => (FAITHFUL_NEGATIVE.has(k) ? `${k} (faithful)` : k);
            if (c.amount < 0) { const k = tag(`Cargo.amount at ${kind}`); negStock[k] = (negStock[k] ?? 0) + 1; }
            if (c.reserved < 0) { const k = tag('Cargo.reserved'); negStock[k] = (negStock[k] ?? 0) + 1; }
        }
    };
    for (const h of g.habitats) cargoScan(h, 'Habitat');
    for (const bo of liveBo) cargoScan(bo, `BuiltObject role ${bo.role}`);

    // --- Generic walk: every object reachable from the Galaxy.
    const nonFinite = {}, negative = negStock, deadRefs = {}, reached = {};
    const inc = (m, k) => { if ((m === nonFinite && FAITHFUL_NONFINITE.has(k)) || (m === negative && FAITHFUL_NEGATIVE.has(k))) k = `${k} (faithful)`; m[k] = (m[k] ?? 0) + 1; };
    const deadKind = (v) => {
        const c = v.constructor?.name;
        if (c === 'BuiltObject') return v.hasBeenDestroyed ? 'destroyed BuiltObject' : liveBo.has(v) ? null : 'detached BuiltObject';
        if (c === 'Habitat') return v.hasBeenDestroyed ? 'destroyed Habitat' : liveHab.has(v) ? null : 'detached Habitat';
        if (c === 'Creature') return v.hasBeenDestroyed ? 'destroyed Creature' : liveCre.has(v) ? null : 'removed Creature';
        if (c === 'Empire') return liveEmp.has(v) ? null : 'removed Empire';
        if (c === 'ShipGroup') return liveGroups.has(v) ? null : 'disbanded ShipGroup';
        return null;
    };
    const SKIP = new Set(['Random', 'Race', 'Resource', 'ResearchStatic', 'GameData', 'ResearchNode', 'ComponentDefinition', 'DesignSpecification', 'Government']);
    const seen = new Set([g]);
    const stack = [[g, 'Galaxy']];
    let objects = 0;
    const edge = (v, path) => {
        if (typeof v === 'number') {
            if (!Number.isFinite(v)) inc(nonFinite, path);
            return;
        }
        if (v === null || typeof v !== 'object') return;
        if (ArrayBuffer.isView(v)) return;
        const dk = deadKind(v);
        if (dk !== null) { inc(deadRefs, `${path} → ${dk}`); return; }
        if (seen.has(v)) return;
        seen.add(v);
        const c = v.constructor?.name;
        if (SKIP.has(c)) return;
        if (c !== 'Object' && c !== 'Array' && c !== undefined) { const k = `${c} ← ${path}`; reached[k] = (reached[k] ?? 0) + 1; }
        stack.push([v, Array.isArray(v) || v instanceof Map || v instanceof Set ? path : c === 'Object' || c === undefined ? path : c]);
    };
    while (stack.length > 0) {
        const [o, label] = stack.pop();
        objects++;
        if (Array.isArray(o)) { for (const v of o) edge(v, label + '[]'); continue; }
        if (o instanceof Map) { for (const [k, v] of o) { edge(k, label + '{k}'); edge(v, label + '{}'); } continue; }
        if (o instanceof Set) { for (const v of o) edge(v, label + '{}'); continue; }
        const c = o.constructor?.name;
        if (c === 'Population' && o.amount < 0) inc(negative, 'Population.amount');
        for (const k of Object.keys(o)) {
            const v = o[k];
            const path = `${label}.${k}`;
            if (typeof v === 'number' && v < 0 && c !== 'Cargo' && /amount|stock|quantity|population|reserve/i.test(k) && !/delta|change|growth|rate|factor|modifier|bonus/i.test(k)) inc(negative, path);
            edge(v, path);
        }
    }
    prevDestroyed = nowDestroyed;
    // Instances by class and the field that first reached them, the largest (memory growth by holder).
    const population = Object.fromEntries(Object.entries(reached).sort((a, b) => b[1] - a[1]).slice(0, 60));
    return { hard, nonFinite, negative, deadRefs, objects, population };
}
