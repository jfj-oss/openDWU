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
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Game } from '../src/sim/game';
import type { Habitat } from '../src/sim/types';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { stateDigest } from '../src/sim/tick/digest';
import { SimDriver, nextFrameMs, runSimFrame, schedulerState } from '../src/sim/tick/scheduler';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { commandLog, type CommandLogEntry, type PlayerLogEntry } from '../src/sim/player/commandLog';
import { flushPlayerCommands, issuePlayerCommand, noteSimSpeed, pendingPlayerCommands, replayCommandLog } from '../src/sim/player/playerCommands';
import { ShipActionType, createMissionShipActionAt, createShipAction } from '../src/sim/player/shipAction';
import { isOrderableShip } from '../src/sim/player/advisorBrief';
import { listProposals } from '../src/sim/player/diplomacyProposals';
import { BuiltObjectMissionType } from '../src/sim/missions/mission';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { findNewestCanBuild } from '../src/sim/designGeneration';
import { empireShipGroups, type ShipGroup } from '../src/sim/fleets/shipGroup';
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

/** The frames' game speed (a sim input, journaled as 'clock' entries): 2× between 100 s and 160 s. */
function speedAt(ms: number): number {
    return ms >= 100_000 && ms < 160_000 ? 2 : 1;
}

/** Everything a digest compares: the state digest and the whole save (incl. the command log). */
function fullDigest(game: Game): { digest: string; save: string } {
    const time = new GalaxyTime();
    time.bindGalaxy(game.galaxy);
    return { digest: stateDigest(game.galaxy), save: serializeGame(game, time, {} as StartGameOptions) };
}

function farHabitat(g: Galaxy, from: { xpos: number; ypos: number }, rank: number): Habitat {
    const list = g.habitats.filter((h) => h.parent !== null).slice();
    list.sort((a, b) => Math.hypot(a.xpos - from.xpos, a.ypos - from.ypos) - Math.hypot(b.xpos - from.xpos, b.ypos - from.ypos) || a.habitatIndex - b.habitatIndex);
    return list[Math.min(rank, list.length - 1)];
}

function moveOrder(g: Galaxy, target: Habitat) {
    return createMissionShipActionAt(BuiltObjectMissionType.Move, target, Math.trunc(target.xpos), Math.trunc(target.ypos));
}

interface Step {
    atMs: number;
    what: string;
    issue: (g: Galaxy, p: Empire) => void;
}

/** The scripted player: each step resolves its targets on the live game when it is issued. */
const STEPS: Step[] = [
    {
        atMs: 5_000,
        what: 'move a ship',
        issue: (g, p) => {
            const ship = p.builtObjects.find((b) => isOrderableShip(p, b) && b.role !== BuiltObjectRole.Military)!;
            issuePlayerCommand(g, p, 'rightClickOrder', [ship, moveOrder(g, farHabitat(g, ship, 20)), { ctrl: false, alt: false }, 1]);
        },
    },
    {
        atMs: 10_000,
        what: 'create a fleet',
        issue: (g, p) => {
            const ships = p.builtObjects.filter((b) => isOrderableShip(p, b) && b.role === BuiltObjectRole.Military && b.shipGroup === null);
            issuePlayerCommand(g, p, 'shipAction', [ships, createShipAction(ShipActionType.CreateNewFleet, null), false]);
        },
    },
    {
        atMs: 20_000,
        what: 'purchase ships',
        issue: (g, p) => {
            const design = findNewestCanBuild(p.designs, BuiltObjectSubRole.Escort, p) ?? findNewestCanBuild(p.designs, BuiltObjectSubRole.ConstructionShip, p);
            issuePlayerCommand(g, p, 'buildNewShips', [[design], [2]]);
        },
    },
    {
        atMs: 30_000,
        what: 'treaty proposal',
        issue: (g, p) => {
            for (const other of g.empires) {
                if (other === p) continue;
                const options = listProposals(g, p, other);
                const o = options.find((x) => x.enabled && x.menu === 'TREATY_PROPOSAL') ?? options.find((x) => x.enabled);
                if (o !== undefined) {
                    issuePlayerCommand(g, p, 'submitProposal', [other, o.id]);
                    return;
                }
            }
            issuePlayerCommand(g, p, 'submitProposal', [g.empires.find((x) => x !== p)!, 'TREATY_PROPOSAL']);
        },
    },
    {
        atMs: 40_000,
        what: 'tax change',
        issue: (g, p) => {
            issuePlayerCommand(g, p, 'automationOff', ['Colony Tax Rates']);
            issuePlayerCommand(g, p, 'shipAction', [p.capital!, createShipAction(ShipActionType.ColonyTaxUp5, null), false]);
        },
    },
    {
        atMs: 50_000,
        what: 'policy change',
        issue: (g, p) => {
            issuePlayerCommand(g, p, 'setPolicy', [{ ...p.policy!, researchPriority: 1.5, tradeWithOtherEmpires: !p.policy!.tradeWithOtherEmpires }]);
        },
    },
    {
        atMs: 330_000,
        what: 'fleet move after the save',
        issue: (g, p) => {
            const fleet = empireShipGroups(p).find((x) => x !== null) as ShipGroup;
            issuePlayerCommand(g, p, 'rightClickOrder', [fleet, moveOrder(g, farHabitat(g, p.capital!, 40)), { ctrl: false, alt: false }, 1]);
        },
    },
    {
        atMs: 400_000,
        what: 'research queue + automation after the save',
        issue: (g, p) => {
            const node = p.research.techTree.find((n) => !n.isResearched && p.research.canResearchNode(n) && !(p.research.researchQueueFor(0)?.includes(n) ?? false));
            if (node !== undefined) issuePlayerCommand(g, p, 'queueResearch', [node]);
            issuePlayerCommand(g, p, 'setEmpireControl', ['controlColonization', 0]);
        },
    },
];

/** Headless scripted run: before each frame, issue the steps due, then step one frame (which applies them first). */
function runScripted(game: Game, untilMs: number): void {
    const g = game.galaxy;
    const p = game.playerEmpire;
    const state = schedulerState(g);
    while (g.nowMs < untilMs) {
        for (const s of STEPS) if (s.atMs <= g.nowMs && !issued.has(key(g, s))) issueStep(g, p, s);
        const speed = speedAt(g.nowMs);
        noteSimSpeed(g, speed);
        runSimFrame(g, nextFrameMs(state, speed));
    }
    flushPlayerCommands(g);
}

// Steps issued per game (a loaded copy continues the original's script).
const issued = new Set<string>();
const runIds = new WeakMap<Galaxy, string>();
function key(g: Galaxy, s: Step): string {
    return `${runIds.get(g)}:${s.atMs}`;
}
function issueStep(g: Galaxy, p: Empire, s: Step): void {
    issued.add(key(g, s));
    s.issue(g, p);
}

describe('command log: seed + commands replay the game', () => {
    let live: { digest: string; save: string };
    let log: CommandLogEntry[];

    it('scripted commands at given sim times: every op applies at a frame boundary and is journaled', () => {
        const game = cachedTickGame(gameData);
        runIds.set(game.galaxy, 'live');
        const p = game.playerEmpire;
        const fleetsBefore = empireShipGroups(p).filter((x) => x !== null).length;
        runScripted(game, 60_000);
        // The orders took effect.
        expect(empireShipGroups(p).filter((x) => x !== null).length).toBe(fleetsBefore + 1);
        expect(p.policy!.researchPriority).toBe(1.5);
        expect(p.controlColonyTaxRates).toBe(false);
        runScripted(game, END_MS);
        expect(pendingPlayerCommands(game.galaxy)).toBe(0);
        log = commandLog(game.galaxy).map((e) => JSON.parse(JSON.stringify(e)) as CommandLogEntry);
        const player = log.filter((e): e is PlayerLogEntry => e.source === 'player');
        // (queueResearch only when a project was available to queue.)
        expect(player.map((e) => e.op).filter((op) => op !== 'queueResearch')).toEqual(['rightClickOrder', 'shipAction', 'buildNewShips', 'submitProposal', 'automationOff', 'shipAction', 'setPolicy', 'rightClickOrder', 'setEmpireControl']);
        expect(player.every((e) => e.error === undefined)).toBe(true);
        // Stamped with the sim time of the boundary they were applied at (the first frame start at or after the step).
        for (const e of player) {
            expect(Number.isInteger(e.nowMs)).toBe(true);
            expect(STEPS.some((s) => e.nowMs >= s.atMs && e.nowMs - s.atMs < 40)).toBe(true);
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
        runIds.set(game.galaxy, 'saved');
        runScripted(game, SAVE_MS);
        const time = new GalaxyTime();
        time.bindGalaxy(game.galaxy);
        const text = serializeGame(game, time, {} as StartGameOptions);
        const loaded = deserializeGame(text, gameData).game;
        runIds.set(loaded.galaxy, 'saved');
        runScripted(loaded, END_MS);
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
        runIds.set(game.galaxy, 'realtime');
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
            const due = STEPS.filter((s) => s.atMs <= g.nowMs && !issued.has(key(g, s)));
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
            driver.speed = speedAt(g.nowMs);
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
