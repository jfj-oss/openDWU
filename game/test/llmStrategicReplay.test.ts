// @slow — soak: two 680 s runs of the seed-1 harness game with every ai-parity flag on (test:slow tier).
// 19s-3 STRATEGIC UPGRADE replay determinism: the model's choices reach the sim only as commands, so seed + command log
// replays the game WITHOUT the model. A live run asks a fake endpoint for each nearest AI empire's move after the first
// game year (the council has formed: motions to table / votes to cast), the commands are applied at a frame boundary
// and journaled, the run continues; then replayCommandLog builds a fresh game from the same seed and options with no
// endpoint at all → the identical state digest, save text and decision log.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame, scenarioGameData } from './helpers/scenarioGame';
import { tickGameOptions } from './helpers/tickGame';
import { fullDigest } from './helpers/commandScript';
import type { GameData } from '../src/sim/data/gameData';
import { runGameSeconds } from '../src/sim/tick/harness';
import { YEAR_LENGTH } from '../src/sim/galaxyTime';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { commandLog, type CommandLogEntry } from '../src/sim/player/commandLog';
import { flushPlayerCommands, replayCommandLog } from '../src/sim/player/playerCommands';
import { nearestAiEmpires, strategicLog } from '../src/sim/scenario/llm/strategic';
import { StrategicJob } from '../src/llm/strategicJob';
import { DEFAULT_LLM_POLICY, LlmQueue, galaxyLlmClock, type LlmTransport } from '../src/llm/queue';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

describe('strategic commands replay without the model', () => {
    it('record from a fake endpoint, replay from seed + command log: identical digest, save and decision log', async () => {
        const gameData = scenarioGameData(base, 'ai-parity');
        const ON = Object.fromEntries(gameData.scenario!.manifest.flags.map((f) => [f.name, f.name !== 'darkFarmsGameEnd']));
        const { game } = createScenarioGame(base, { scenario: 'ai-parity', flags: ON });
        const g = game.galaxy;
        runGameSeconds(game, 650);
        // The fake model always takes the first legal move it is offered.
        let asked = 0;
        const transport: LlmTransport = {
            model: () => 'fake',
            probe: async () => true,
            complete: async (r) => {
                asked++;
                const ids = (r.schema as { properties: { choice: { enum: string[] } } }).properties.choice.enum;
                return { text: JSON.stringify({ reason: 'The first thing that came to mind.', choice: ids[0] }) };
            },
        };
        const queue = new LlmQueue({ transport, clock: galaxyLlmClock(g), policy: () => ({ ...DEFAULT_LLM_POLICY, cacheTtlDays: 0 }) });
        const job = new StrategicJob({ galaxy: g, player: g.playerEmpire, queue });
        const year = Math.floor(galaxyStarDate(g) / YEAR_LENGTH);
        for (const e of nearestAiEmpires(g, g.playerEmpire, 5)) await job.ask(e, year);
        expect(asked).toBeGreaterThan(0);
        flushPlayerCommands(g);
        const rows = strategicLog(g);
        expect(rows.length).toBe(asked);
        expect(rows.some((r) => r.status === 'applied')).toBe(true);
        runGameSeconds(game, 30);
        const endMs = g.nowMs;
        const live = fullDigest(game);
        const liveLog = JSON.stringify(strategicLog(g));
        const log = commandLog(g).map((e) => JSON.parse(JSON.stringify(e)) as CommandLogEntry);
        expect(log.filter((e) => e.source === 'player' && e.op === 'llmStrategic').length).toBe(asked);

        // Replay: no endpoint, no job — only the seed, the options and the log.
        const { seed, ...options } = { ...tickGameOptions(gameData), scenarioFlags: ON };
        const replay = replayCommandLog(seed, options, log, endMs);
        expect(replay.galaxy.nowMs).toBe(endMs);
        const r = fullDigest(replay);
        expect(r.digest).toBe(live.digest);
        expect(JSON.stringify(strategicLog(replay.galaxy))).toBe(liveLog);
        expect(r.save === live.save).toBe(true);
    }, 2400000);
});
