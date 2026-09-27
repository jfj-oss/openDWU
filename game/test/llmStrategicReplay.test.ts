// @slow — soak: two 680 s runs of the seed-1 harness game with every ai-parity flag on (test:slow tier).
// 19s-3 STRATEGIC UPGRADE replay determinism: the model's choices reach the sim only as commands, so seed + command log
// replays the game WITHOUT the model. A live run asks a fake endpoint for each nearest AI empire's move after the first
// game year, the commands are applied at a frame boundary and journaled, the run continues; then a fresh game from the
// same seed and options, with no endpoint at all, replays the command log → the identical state digest, save text and
// decision log.
//
// Which legal moves exist after a year depends on the whole world (on the merged tree the council had not formed by
// 650 s: its founders had not all met at the year boundary), so the soak does not rely on one appearing by itself: at
// 650 s both runs get the same hand-built council session (the three nearest AI empires, a motion being voted), which
// makes a council vote a certain, applicable move for the first of them. The hand-built state is applied identically,
// at the same frame boundary, in the live run and in the replay; everything after it comes from the command log.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame, scenarioGameData } from './helpers/scenarioGame';
import { tickGameOptions } from './helpers/tickGame';
import { fullDigest } from './helpers/commandScript';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import { createGame, type CreateGameOptions } from '../src/sim/game';
import { runGameSeconds } from '../src/sim/tick/harness';
import { YEAR_LENGTH } from '../src/sim/galaxyTime';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { commandLog, type CommandLogEntry } from '../src/sim/player/commandLog';
import { flushPlayerCommands, runScheduledUntil, scheduleCommandLog } from '../src/sim/player/playerCommands';
import { nearestAiEmpires, strategicLog } from '../src/sim/scenario/llm/strategic';
import { councilState } from '../src/sim/scenario/emergent/council';
import { StrategicJob } from '../src/llm/strategicJob';
import { DEFAULT_LLM_POLICY, LlmQueue, galaxyLlmClock, type LlmTransport } from '../src/llm/queue';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const SETUP_SECONDS = 650;

/**
 * A council session among the three nearest AI empires (met each other), with the second one's sanction motion on the
 * third being voted and the first one's vote "yes": the first can change its vote (a legal, applicable council move).
 * Deterministic (reads only the galaxy). Returns the empire id the move belongs to.
 */
function councilSession(g: Galaxy): number {
    const [a, b, c] = nearestAiEmpires(g, g.playerEmpire, 3);
    for (const [x, y] of [[a, b], [a, c], [b, c]] as const) {
        for (const [p, q] of [[x, y], [y, x]] as const) {
            const r = obtainDiplomaticRelation(p, q);
            if (r.type === DiplomaticRelationType.NotMet) r.type = DiplomaticRelationType.None;
        }
    }
    const st = councilState(g);
    const year = Math.floor(galaxyStarDate(g) / YEAR_LENGTH);
    const id = st.nextId++;
    st.councils.push({
        id, name: 'Replay Council', foundedYear: year, members: [a, b, c], chair: a, results: [], blocs: [], coLosses: {}, losses: {},
        sanctions: [], threats: [], recognised: [], condemned: {}, splitFrom: 0,
        motion: { id: st.nextId++, kind: 'sanction', proposer: b, target: c, other: null, resourceId: -1, text: 'Sanction the offender', year, proposedStarDate: galaxyStarDate(g), status: 'voting', votes: [{ empire: a, vote: 'yes', score: 9, coordinated: false }], decisionId: 0 },
    });
    return a.empireId;
}

describe('strategic commands replay without the model', () => {
    it('record from a fake endpoint, replay from seed + command log: identical digest, save and decision log', async () => {
        const gameData = scenarioGameData(base, 'ai-parity');
        const ON = Object.fromEntries(gameData.scenario!.manifest.flags.map((f) => [f.name, f.name !== 'darkFarmsGameEnd']));
        const { game } = createScenarioGame(base, { scenario: 'ai-parity', flags: ON });
        const g = game.galaxy;
        runGameSeconds(game, SETUP_SECONDS);
        const setupMs = g.nowMs;
        const chosen = councilSession(g);
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
        const applied = rows.find((r) => r.empireId === chosen)!;
        expect(applied).toMatchObject({ family: 'council', status: 'applied' });
        expect(applied.choice).toMatch(/^council\.vote:/);
        runGameSeconds(game, 30);
        const endMs = g.nowMs;
        const live = fullDigest(game);
        const liveLog = JSON.stringify(strategicLog(g));
        const log = commandLog(g).map((e) => JSON.parse(JSON.stringify(e)) as CommandLogEntry);
        expect(log.filter((e) => e.source === 'player' && e.op === 'llmStrategic').length).toBe(asked);
        expect(log.every((e) => e.nowMs >= setupMs)).toBe(true);

        // Replay: no endpoint, no job — the seed, the options, the same hand-built session at the same boundary, the log.
        const opts: CreateGameOptions = { ...tickGameOptions(gameData), scenarioFlags: ON };
        const replay = createGame(opts);
        runGameSeconds(replay, SETUP_SECONDS);
        expect(replay.galaxy.nowMs).toBe(setupMs);
        expect(councilSession(replay.galaxy)).toBe(chosen);
        scheduleCommandLog(replay.galaxy, log);
        runScheduledUntil(replay.galaxy, endMs);
        expect(replay.galaxy.nowMs).toBe(endMs);
        const r = fullDigest(replay);
        expect(r.digest).toBe(live.digest);
        expect(JSON.stringify(strategicLog(replay.galaxy))).toBe(liveLog);
        expect(r.save === live.save).toBe(true);
    }, 2400000);
});
