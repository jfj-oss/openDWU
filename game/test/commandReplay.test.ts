// @slow — soak: four 600 s runs of the seed-1 harness game (test:slow tier; see vite.config.ts testTier).
// Command-log determinism (tasks/M4-agent-brief.md "Command log"): player commands are queued, applied at the next
// frame boundary, journaled with the sim time, and seed + log replays the game.
// - a scripted command sequence (move, create fleet, purchase, treaty proposal, tax change, policy change, speed
//   change, more orders after the half-way save) issued at given sim times → digest + full save text at 600 s;
// - replayCommandLog from a fresh createGame with the same seed gives the identical digest and save text;
// - saving at 300 s, loading and continuing gives the identical result;
// - the same commands issued from a real-time driver (irregular render frames, pauses, wall clocks skewed) at the same
//   sim times give the identical result.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import { tickGameOptions } from './helpers/tickGame';
import { commandScript, createdFleets, dueSteps, fullDigest, issueStep, runScripted, setRunId } from './helpers/commandScript';
import type { GameData } from '../src/sim/data/gameData';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { SimDriver } from '../src/sim/tick/scheduler';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { commandLog, type CommandLogEntry, type PlayerLogEntry } from '../src/sim/player/commandLog';
import { flushPlayerCommands, noteSimSpeed, pendingPlayerCommands, replayCommandLog } from '../src/sim/player/playerCommands';
import { empireShipGroups } from '../src/sim/fleets/shipGroup';
import type { StartGameOptions } from '../src/sim/startGameOptions';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);
afterEach(() => {
    vi.restoreAllMocks();
});

const END_MS = 600_000;
const SAVE_MS = 300_000;
const SCRIPT = commandScript(1);

describe('command log: seed + commands replay the game', () => {
    let live: { digest: string; save: string };
    let log: CommandLogEntry[];

    it('scripted commands at given sim times: every op applies at a frame boundary and is journaled', () => {
        const game = cachedTickGame(gameData);
        setRunId(game.galaxy, 'live');
        const p = game.playerEmpire;
        runScripted(SCRIPT, game, 60_000);
        // The orders took effect (the created fleet is the player's; the empire's own fleet formation may add others).
        const fleet = createdFleets.get(game.galaxy)!;
        expect(fleet).toBeDefined();
        expect(empireShipGroups(p)).toContain(fleet);
        expect(p.policy!.researchPriority).toBe(1.5);
        expect(p.controlColonyTaxRates).toBe(false);
        runScripted(SCRIPT, game, END_MS);
        expect(pendingPlayerCommands(game.galaxy)).toBe(0);
        log = commandLog(game.galaxy).map((e) => JSON.parse(JSON.stringify(e)) as CommandLogEntry);
        // Only external commands are journaled (player orders and the frame-speed changes); sim-scheduled work is state.
        expect(new Set(log.map((e) => e.source))).toEqual(new Set(['player', 'clock']));
        const player = log.filter((e): e is PlayerLogEntry => e.source === 'player');
        // (queueResearch only when a project was available to queue.)
        expect(player.map((e) => e.op).filter((op) => op !== 'queueResearch')).toEqual(['rightClickOrder', 'shipAction', 'buildNewShips', 'submitProposal', 'automationOff', 'shipAction', 'setPolicy', 'rightClickOrder', 'setEmpireControl']);
        expect(player.every((e) => e.error === undefined)).toBe(true);
        // Stamped with the sim time of the boundary they were applied at (the first frame start at or after the step).
        for (const e of player) {
            expect(Number.isInteger(e.nowMs)).toBe(true);
            expect(SCRIPT.steps.some((s) => e.nowMs >= s.atMs && e.nowMs - s.atMs < 40)).toBe(true);
        }
        expect(log.filter((e) => e.source === 'clock').map((e) => (e as { speed: number }).speed)).toEqual([2, 1]);
        live = fullDigest(game);
    }, 1200000);

    it('replayCommandLog from a fresh createGame with the same seed gives the identical game', () => {
        const { seed, ...options } = tickGameOptions(gameData);
        const game = replayCommandLog(seed, options, log, END_MS);
        const r = fullDigest(game);
        expect(r.digest).toBe(live.digest);
        expect(r.save === live.save).toBe(true);
    }, 1200000);

    it('saving mid-way, loading and continuing gives the identical game', () => {
        const game = cachedTickGame(gameData);
        setRunId(game.galaxy, 'saved');
        runScripted(SCRIPT, game, SAVE_MS);
        const time = new GalaxyTime();
        time.bindGalaxy(game.galaxy);
        const text = serializeGame(game, time, {} as StartGameOptions);
        const loaded = deserializeGame(text, gameData).game;
        setRunId(loaded.galaxy, 'saved');
        runScripted(SCRIPT, loaded, END_MS);
        const r = fullDigest(loaded);
        expect(r.digest).toBe(live.digest);
        expect(r.save === live.save).toBe(true);
    }, 1200000);

    it('the same commands from a real-time driver (irregular frames, pauses, skewed wall clocks) give the identical game', () => {
        // Wall clocks nobody under src/sim may read: skew them wildly.
        let wall = 1e12;
        vi.spyOn(Date, 'now').mockImplementation(() => (wall += 7919));
        vi.spyOn(performance, 'now').mockImplementation(() => (wall += 104729) / 1000);
        const game = cachedTickGame(gameData);
        setRunId(game.galaxy, 'realtime');
        const g = game.galaxy;
        const p = game.playerEmpire;
        const driver = new SimDriver(g, 1, false, 1);
        let rng = 12345;
        const nextDt = (): number => {
            rng = (rng * 1103515245 + 12345) % 2147483648;
            return (rng % 4000) / 100; // 0 … 40 real ms per render frame
        };
        let pausedFrames = 0;
        while (g.nowMs < END_MS) {
            const due = dueSteps(SCRIPT, g);
            if (due.length > 0 && pausedFrames === 0) {
                // The player pauses, looks around for a few (real) frames, then gives the order while paused.
                driver.paused = true;
                pausedFrames = 3 + (due[0].atMs % 5);
            }
            if (pausedFrames > 0) {
                pausedFrames--;
                if (pausedFrames === 0) {
                    for (const s of due) issueStep(g, p, s);
                    driver.advance(nextDt()); // paused: applies them at this boundary
                    driver.paused = false;
                    continue;
                }
                driver.advance(nextDt());
                continue;
            }
            driver.speed = SCRIPT.speedAt(g.nowMs);
            noteSimSpeed(g, driver.speed);
            driver.advance(nextDt());
        }
        flushPlayerCommands(g);
        vi.restoreAllMocks();
        const r = fullDigest(game);
        expect(r.digest).toBe(live.digest);
        expect(r.save === live.save).toBe(true);
    }, 1200000);
});
