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
import { gameDataFingerprint } from './loadGameDataFs';
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
    const files = [...walkTs(join(root, 'src', 'sim'), []), join(__dirname, 'tickGame.ts'), join(__dirname, 'gameCache.ts')];
    for (const f of files) hash.update(`${f.slice(root.length)}\0${readFileSync(f, 'utf8')}\0`);
    sourceHash = hash.digest('hex');
    return sourceHash;
}

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

function serialize(game: Game): string {
    const time = new GalaxyTime();
    time.togglePause();
    time.advance(game.galaxy.nowMs);
    return serializeGame(game, time, { ...defaultStartGameOptions(), seed: 1 });
}

function cacheFile(key: TickGameKey, fingerprint: string): { name: string; memoKey: string; file: string } {
    const hash = createHash('sha1').update(`${codeHash()}\0${fingerprint}\0${JSON.stringify(key)}`).digest('hex').slice(0, 16);
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
        // One builder per key: the others wait for its file instead of repeating a minutes-long build.
        const lock = `${file}.lock`;
        while (entry === null && !tryLock(lock)) {
            sleepMs(500);
            entry = readEntry(file);
        }
        if (entry === null) {
            try {
                entry = readEntry(file) ?? buildEntry(gameData, key, name, memoKey, file); // (built just before we locked?)
            } finally {
                rmSync(lock, { force: true });
            }
        }
    }
    memo.set(memoKey, entry);
    return entry;
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
        let owner: string;
        try {
            owner = readFileSync(lock, 'utf8');
        } catch {
            return false; // released meanwhile: retry
        }
        const pid = Number(owner.split(':')[0]);
        if (owner !== me && Number.isInteger(pid) && pid > 0) {
            try {
                process.kill(pid, 0);
                return false; // the builder is alive
            } catch {
                // dead builder (worker killed by a timeout): break its lock
            }
        }
        rmSync(lock, { force: true });
        return false;
    }
}

const sleeper = new Int32Array(new SharedArrayBuffer(4));
function sleepMs(ms: number): void {
    Atomics.wait(sleeper, 0, 0, ms);
}

function buildEntry(gameData: GameData, key: TickGameKey, name: string, memoKey: string, file: string): CacheEntry {
    const { game, run } = build(gameData, key);
    const entry: CacheEntry = { text: serialize(game), viewX: game.viewX, viewY: game.viewY, run };
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
