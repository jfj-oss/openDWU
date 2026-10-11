// Cached harness games for the tests. createGame(seed 1) and a few-hundred-second runGameSeconds on it are the bulk
// of the suite's time, and dozens of files build exactly the same game. cachedTickGame builds each (options, seconds)
// game once, saves it through the game save codec (src/sim/save/gameSave.ts, which the save tests hold to a
// byte-identical, lockstep-identical round trip) to test/.cache/, and hands every caller a fresh deserialized copy —
// so tests can mutate their game freely, exactly as with their own createGame.
//
// The disk cache is keyed by a hash of src/sim (every .ts file), the helpers that build the game, the GameData file
// contents (loadGameDataFs' fingerprint) and the key, so any sim change rebuilds it. Files are written atomically
// (tmp + rename); parallel workers that miss at the same time both build the same bytes. Set DWU_TEST_CACHE=off to
// build every game directly (createGame + runGameSeconds in the calling test), e.g. to verify the cache.
//
// The run keys of one age are prefixes of one run (runGameSeconds(g, a) then (g, b) is runGameSeconds(g, a + b) on whole
// seconds: harness.ts), so a build continues from the longest shorter key already saved and saves the CHECKPOINTS it
// passes on the way: a cold cache runs each age's game once to its longest key instead of once per key.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { threadId } from 'node:worker_threads';
import type { GameData } from '../../src/sim/data/gameData';
import { installGameStatics, registerGameHooks, type Game } from '../../src/sim/game';
import { GalaxyTime } from '../../src/sim/galaxyTime';
import { defaultStartGameOptions } from '../../src/sim/startGameOptions';
import { deserializeGame, serializeGame } from '../../src/sim/save/gameSave';
import { runGameSeconds, type RunGameSecondsResult } from '../../src/sim/tick/harness';
import { registeredTodos } from '../../src/sim/tick/todo';
import { gameDataFingerprint } from './loadGameDataFs';
import { createScenarioGame, scenarioGameData, SCENARIOS_ROOT } from './scenarioGame';
import { createTickGame, createTickGameAtAge } from './tickGame';

/** Which harness game (test/helpers/tickGame.ts). */
export interface TickGameKey {
    /** createTickGameAtAge(gameData, age): the galaxy and every empire at `age`. Omitted: createTickGame (age 1). */
    age?: number;
    /** Game seconds run on it with runGameSeconds(game, seconds) (default options). Omitted / 0: straight from createGame. */
    seconds?: number;
}

export interface CachedTickGameRun {
    game: Game;
    /** The runGameSeconds result of building it (all zero when seconds is 0). */
    run: RunGameSecondsResult;
}

interface CacheEntry {
    text: string;
    viewX: number;
    viewY: number;
    run: RunGameSecondsResult;
}

const root = resolve(__dirname, '../..');
const CACHE_DIR = join(root, 'test', '.cache');
const disabled = /^(0|off|false|no)$/i.test(process.env.DWU_TEST_CACHE ?? '');

const memo = new Map<string, CacheEntry>();
let sourceHash: string | null = null;

function walkTs(dir: string, out: string[]): string[] {
    for (const name of readdirSync(dir).sort()) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walkTs(p, out);
        else if (p.endsWith('.ts')) out.push(p);
    }
    return out;
}

/** Hash of everything that decides the cached bytes besides GameData: src/sim and the helpers that build the game. */
function codeHash(): string {
    if (sourceHash !== null) return sourceHash;
    const hash = createHash('sha1');
    const files = [...walkTs(join(root, 'src', 'sim'), []), join(__dirname, 'tickGame.ts'), join(__dirname, 'scenarioGame.ts'), join(__dirname, 'gameCache.ts')];
    for (const f of files) hash.update(`${f.slice(root.length)}\0${readFileSync(f, 'utf8')}\0`);
    sourceHash = hash.digest('hex');
    return sourceHash;
}

/**
 * The `seconds` of the run keys the suite uses: a longer build of the same age saves each one it passes. Any key works;
 * these only decide where a build stops to save (and so which shorter runs a later build can continue from).
 */
const CHECKPOINTS = [30, 60, 120, 300, 480, 600, 900, 1200];

function keyName(key: TickGameKey): string {
    return `tick-age${key.age ?? 'std'}-${key.seconds ?? 0}s`;
}

function build(gameData: GameData, key: TickGameKey): CachedTickGameRun {
    const game = key.age === undefined ? createTickGame(gameData) : createTickGameAtAge(gameData, key.age);
    const run: RunGameSecondsResult = (key.seconds ?? 0) > 0
        ? runGameSeconds(game, key.seconds!)
        : { frames: 0, rndDraws: 0, nowMs: game.galaxy.nowMs, timings: {}, todoHits: {} };
    return { game, run };
}

/** The result of runGameSeconds(g, a + b) from those of (g, a) then (g, b) (default options: no timings). */
function joinRuns(a: RunGameSecondsResult, b: RunGameSecondsResult): RunGameSecondsResult {
    const todoHits: Record<string, number> = {};
    for (const name of registeredTodos()) {
        const n = (a.todoHits[name] ?? 0) + (b.todoHits[name] ?? 0);
        if (n > 0) todoHits[name] = n;
    }
    return { frames: a.frames + b.frames, rndDraws: a.rndDraws + b.rndDraws, nowMs: b.nowMs, timings: {}, todoHits };
}

/**
 * build(gameData, key) for the cache: from the longest shorter run of the same age already saved (a fresh copy of it),
 * else from createGame, saving each checkpoint run it passes. Same state and run result as build (whole-second runs
 * add up; tickDeterminism.test.ts checks the 600 s game against one runGameSeconds(600) call).
 */
function buildChained(gameData: GameData, key: TickGameKey, fingerprint: string, lock: string): CachedTickGameRun {
    const target = key.seconds ?? 0;
    const shorter = CHECKPOINTS.filter((s) => s < target);
    let at = 0;
    let start: CachedTickGameRun | null = null;
    for (let i = shorter.length - 1; i >= 0 && start === null; i--) {
        const entry = load(gameData, { ...key, seconds: shorter[i] }, fingerprint, false);
        if (entry !== null) {
            start = restore(gameData, entry);
            at = shorter[i];
        }
    }
    // Tell the checkpoints' waiters where this build starts (longerBuildPassing).
    writeFileSync(lock, `${process.pid}:${threadId}\n${at}`);
    let { game, run } = start ?? build(gameData, { ...key, seconds: 0 });
    for (const s of shorter) {
        if (s <= at) continue;
        run = joinRuns(run, runGameSeconds(game, s - at));
        at = s;
        const cp = cacheFile({ ...key, seconds: s }, fingerprint);
        if (!memo.has(cp.memoKey) && readEntry(cp.file) === null) memo.set(cp.memoKey, writeEntry(game, run, cp.name, cp.memoKey, cp.file));
    }
    if (target > at) run = joinRuns(run, runGameSeconds(game, target - at));
    return { game, run };
}

function serialize(game: Game): string {
    const time = new GalaxyTime();
    time.togglePause();
    time.advance(game.galaxy.nowMs);
    return serializeGame(game, time, { ...defaultStartGameOptions(), seed: 1 });
}

function cacheFile(key: TickGameKey, fingerprint: string): { name: string; memoKey: string; file: string } {
    // The key normalized ({} = { seconds: 0 }, field order), so one game has one file.
    const norm = JSON.stringify({ age: key.age ?? null, seconds: key.seconds ?? 0 });
    const hash = createHash('sha1').update(`${codeHash()}\0${fingerprint}\0${norm}`).digest('hex').slice(0, 16);
    const name = keyName(key);
    const memoKey = `${name}-${hash}`;
    return { name, memoKey, file: join(CACHE_DIR, `${memoKey}.json`) };
}

function load(gameData: GameData, key: TickGameKey, fingerprint: string, build = true): CacheEntry | null {
    const { name, memoKey, file } = cacheFile(key, fingerprint);
    const hit = memo.get(memoKey);
    if (hit !== undefined) return hit;
    mkdirSync(CACHE_DIR, { recursive: true });
    let entry = readEntry(file);
    if (entry === null && !build) return null;
    if (entry === null) {
        // One builder per key: the others wait for its file instead of repeating a minutes-long build. A checkpoint key
        // also waits while a live build of a longer run of its age is on its way past it (it saves it there).
        const lock = `${file}.lock`;
        while (entry === null && (longerBuildPassing(key, fingerprint) || !tryLock(lock))) {
            sleepMs(500);
            entry = readEntry(file);
        }
        if (entry === null) {
            try {
                entry = readEntry(file) ?? buildEntry(gameData, key, fingerprint, name, memoKey, file, lock); // (built just before we locked?)
            } finally {
                rmSync(lock, { force: true });
            }
        }
    }
    memo.set(memoKey, entry);
    return entry;
}

/** The lock owner's process and worker thread (the lock file's first line). */
function lockOwner(lock: string): string | null {
    try {
        return readFileSync(lock, 'utf8').split('\n')[0];
    } catch {
        return null;
    }
}

function processAlive(owner: string): boolean {
    const pid = Number(owner.split(':')[0]);
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/**
 * Whether another process or thread is building a longer run of `key`'s age (this source and data) from a start before
 * `key.seconds`, which saves `key` as a checkpoint on its way (buildChained writes its start as the lock's second line).
 */
function longerBuildPassing(key: TickGameKey, fingerprint: string): boolean {
    const seconds = key.seconds ?? 0;
    if (!CHECKPOINTS.includes(seconds)) return false;
    const prefix = `tick-age${key.age ?? 'std'}-`;
    const me = `${process.pid}:${threadId}`;
    for (const f of readdirSync(CACHE_DIR)) {
        const m = /^tick-age[^-]+-(\d+)s-[0-9a-f]+\.json\.lock$/.exec(f);
        if (m === null || !f.startsWith(prefix) || Number(m[1]) <= seconds) continue;
        if (`${f.slice(0, -'.lock'.length)}` !== cacheFile({ age: key.age, seconds: Number(m[1]) }, fingerprint).memoKey + '.json') continue;
        let text: string;
        try {
            text = readFileSync(join(CACHE_DIR, f), 'utf8');
        } catch {
            continue;
        }
        const [owner, from] = text.split('\n');
        if (owner !== me && from !== undefined && Number(from) < seconds && processAlive(owner)) return true;
    }
    return false;
}

/** File layout: one JSON line { viewX, viewY, run }, then the serializeGame text (not re-escaped as a JSON string). */
function readEntry(file: string): CacheEntry | null {
    try {
        const raw = readFileSync(file, 'utf8');
        const nl = raw.indexOf('\n');
        return { ...(JSON.parse(raw.slice(0, nl)) as Omit<CacheEntry, 'text'>), text: raw.slice(nl + 1) };
    } catch {
        return null;
    }
}

/** Take the build lock (a file naming our process and worker thread); a lock whose process is gone is broken. */
function tryLock(lock: string): boolean {
    const me = `${process.pid}:${threadId}`;
    try {
        writeFileSync(lock, me, { flag: 'wx' });
        return true;
    } catch {
        const owner = lockOwner(lock);
        if (owner === null) return false; // released meanwhile: retry
        if (owner !== me && processAlive(owner)) return false; // the builder is alive
        // dead builder (worker killed by a timeout): break its lock
        rmSync(lock, { force: true });
        return false;
    }
}

const sleeper = new Int32Array(new SharedArrayBuffer(4));
function sleepMs(ms: number): void {
    Atomics.wait(sleeper, 0, 0, ms);
}

function buildEntry(gameData: GameData, key: TickGameKey, fingerprint: string, name: string, memoKey: string, file: string, lock: string): CacheEntry {
    const { game, run } = buildChained(gameData, key, fingerprint, lock);
    return writeEntry(game, run, name, memoKey, file);
}

function writeEntry(game: Game, run: RunGameSecondsResult, name: string, memoKey: string, file: string): CacheEntry {
    const entry: CacheEntry = { text: serialize(game), viewX: game.viewX, viewY: game.viewY, run: structuredClone(run) };
    // Stale entries of the same key (older sim source) are dropped.
    for (const old of readdirSync(CACHE_DIR)) {
        if (old.startsWith(`${name}-`) && old.endsWith('.json') && old !== `${memoKey}.json`) {
            try {
                unlinkSync(join(CACHE_DIR, old));
            } catch {
                // another worker removed it
            }
        }
    }
    const tmp = `${file}.${process.pid}.${threadId}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ viewX: entry.viewX, viewY: entry.viewY, run: entry.run })}\n${entry.text}`);
    renameSync(tmp, file);
    return entry;
}

/**
 * The harness game for `key` with its build run: a fresh copy per call, state-identical to building it with
 * createTickGame / createTickGameAtAge (+ runGameSeconds(game, seconds)) in the calling test.
 */
export function cachedTickGameRun(gameData: GameData, key: TickGameKey = {}): CachedTickGameRun {
    const fingerprint = gameDataFingerprint(gameData);
    if (disabled || fingerprint === null) return build(gameData, key);
    return restore(gameData, load(gameData, key, fingerprint)!);
}

/** The cached game for `key` if it is already built (in this run or on disk), else null — never builds it. */
export function cachedTickGameRunIfBuilt(gameData: GameData, key: TickGameKey = {}): CachedTickGameRun | null {
    const fingerprint = gameDataFingerprint(gameData);
    if (disabled || fingerprint === null) return null;
    const entry = load(gameData, key, fingerprint, false);
    return entry === null ? null : restore(gameData, entry);
}

function restore(gameData: GameData, entry: CacheEntry): CachedTickGameRun {
    // The module statics / hooks createGame installs are process state, not galaxy state: install them as createGame
    // would (a worker that only loads games never ran createGame).
    installGameStatics(gameData);
    registerGameHooks();
    const { game } = deserializeGame(entry.text, gameData);
    game.viewX = entry.viewX;
    game.viewY = entry.viewY;
    return { game, run: structuredClone(entry.run) };
}

/** cachedTickGameRun(gameData, key).game. */
export function cachedTickGame(gameData: GameData, key: TickGameKey = {}): Game {
    return cachedTickGameRun(gameData, key).game;
}

// ---------------------------------------------------------------- scenario / add-on games

/** A scenario / add-on game: createScenarioGame (test/helpers/scenarioGame.ts) on the standard seed-1 tick game. */
export interface ScenarioGameKey {
    /** A scenarios/<id>/ folder (its includes resolved, as createScenarioGame loads it). */
    scenario: string;
    flags?: Record<string, boolean>;
    params?: Record<string, number>;
    /** The galaxy and every empire at `age` (as createTickGameAtAge). Omitted: the standard start. */
    age?: number;
    /** Game seconds run on it with runGameSeconds(game, seconds) (default options). Omitted / 0: straight from createGame. */
    seconds?: number;
}

export interface CachedScenarioGameRun extends CachedTickGameRun {
    /** The scenario's GameData (scenarioGameData(base, key.scenario)), as createScenarioGame returns it. */
    gameData: GameData;
}

let scenariosHash: string | null = null;

/** Hash of every file under scenarios/ (overlays and their includes). */
function scenarioFilesHash(): string {
    if (scenariosHash !== null) return scenariosHash;
    const hash = createHash('sha1');
    const walk = (dir: string): void => {
        for (const name of readdirSync(dir).sort()) {
            const p = join(dir, name);
            if (statSync(p).isDirectory()) walk(p);
            else hash.update(`${p.slice(SCENARIOS_ROOT.length)}\0${readFileSync(p, 'utf8')}\0`);
        }
    };
    walk(SCENARIOS_ROOT);
    scenariosHash = hash.digest('hex');
    return scenariosHash;
}

function buildScenario(base: GameData, key: ScenarioGameKey): CachedScenarioGameRun {
    const age = key.age;
    const { game, gameData } = createScenarioGame(base, {
        scenario: key.scenario,
        flags: key.flags,
        params: key.params,
        options: age === undefined ? undefined : (o) => ({ ...o, galaxyAge: age, player: { ...o.player, age }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age })) }),
    });
    const run: RunGameSecondsResult = (key.seconds ?? 0) > 0
        ? runGameSeconds(game, key.seconds!)
        : { frames: 0, rndDraws: 0, nowMs: game.galaxy.nowMs, timings: {}, todoHits: {} };
    return { game, gameData, run };
}

const sortedObject = <T>(o: Record<string, T> | undefined): Record<string, T> => Object.fromEntries(Object.entries(o ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/**
 * The scenario game for `key` with its build run, cached like cachedTickGameRun (built once per key, saved under
 * test/.cache/, a fresh deserialized copy per call): state-identical to createScenarioGame(base, { scenario, flags,
 * params }) + runGameSeconds(game, seconds) in the calling test. Keyed by the scenario files, flags, params, seed, age
 * and seconds besides the sim source and data hash. DWU_TEST_CACHE=off builds it in place.
 */
export function cachedScenarioGameRun(base: GameData, key: ScenarioGameKey): CachedScenarioGameRun {
    const fingerprint = gameDataFingerprint(base);
    if (disabled || fingerprint === null) return buildScenario(base, key);
    const norm = JSON.stringify({ scenario: key.scenario, flags: sortedObject(key.flags), params: sortedObject(key.params), seed: 1, age: key.age ?? null, seconds: key.seconds ?? 0 });
    const keyHash = createHash('sha1').update(norm).digest('hex').slice(0, 10);
    const name = `scen-${key.scenario.replace(/[^A-Za-z0-9_-]/g, '_')}-${keyHash}`;
    const hash = createHash('sha1').update(`${codeHash()}\0${fingerprint}\0${scenarioFilesHash()}\0${norm}`).digest('hex').slice(0, 16);
    const memoKey = `${name}-${hash}`;
    const file = join(CACHE_DIR, `${memoKey}.json`);
    let entry = memo.get(memoKey) ?? null;
    if (entry === null) {
        mkdirSync(CACHE_DIR, { recursive: true });
        entry = readEntry(file);
        const lock = `${file}.lock`;
        while (entry === null && !tryLock(lock)) {
            sleepMs(500);
            entry = readEntry(file);
        }
        if (entry === null) {
            try {
                entry = readEntry(file);
                if (entry === null) {
                    const { game, run } = buildScenario(base, key);
                    entry = writeEntry(game, run, name, memoKey, file);
                }
            } finally {
                rmSync(lock, { force: true });
            }
        }
        memo.set(memoKey, entry);
    }
    const gameData = scenarioGameData(base, key.scenario);
    return { ...restore(gameData, entry), gameData };
}

