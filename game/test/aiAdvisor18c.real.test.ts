// 18c real-model check (opt-in: DWU_LLM_REAL=1, a model server at DWU_LLM_ENDPOINT, default Ollama :11434 / qwen3:4b).
// A 2-game-month headless session: two AI empires that have met the player (placed "Nearby") are driven by the model
// through the AiAdvisorDriver, paced at 1x game speed (the sim keeps running while a request is out, as in the app).
// Writes every turn (brief decisions offered, the model's rationale, results) to DWU_LLM_OUT (JSON).
import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { tickGameOptions } from './helpers/tickGame';
import { createGame } from '../src/sim/game';
import { runGameSeconds } from '../src/sim/tick/harness';
import { DiplomaticRelationType } from '../src/sim/diplomacy';
import { buildStrategicBrief } from '../src/sim/player/strategicBrief';
import { commandLog } from '../src/sim/player/commandLog';
import { AiAdvisorDriver, selectAdvisedEmpires } from '../src/ui/aiAdvisorDriver';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { resolveStarDateDescription } from '../src/sim/galaxyTime';

const REAL = process.env.DWU_LLM_REAL === '1';

describe.skipIf(!REAL)('18c with a real local model', () => {
    it('two met AI empires, 2 game months', async () => {
        const gameData = await loadGameDataFs();
        const o = tickGameOptions(gameData);
        const seed = Number(process.env.DWU_LLM_SEED ?? 1);
        const ai = (race: string) => ({ ...o.aiEmpires[0], race, proximityDistance: 'Nearby' });
        const game = createGame({ ...o, seed, starCount: 200, aiEmpires: [ai('(Random)'), ai('(Random)'), { ...o.aiEmpires[0] }] });
        const galaxy = game.galaxy;
        const player = galaxy.playerEmpire!;
        const met = selectAdvisedEmpires(galaxy, player, 'met', 2);
        const metRel = met.map((e) => DiplomaticRelationType[player.diplomaticRelations.byEmpire(e)!.type]);
        const days = Number(process.env.DWU_LLM_DAYS ?? 10);
        const log: unknown[] = [];
        const driver = new AiAdvisorDriver({
            galaxy,
            player,
            settings: () => ({
                aiAdvisor: true,
                aiAdvisorIntervalDays: days,
                aiAdvisorEmpires: 'met',
                aiAdvisorMaxEmpires: 2,
                advisorEndpoint: process.env.DWU_LLM_ENDPOINT ?? 'http://127.0.0.1:11434',
                advisorModel: process.env.DWU_LLM_MODEL ?? 'qwen3:4b',
                advisorApi: 'auto',
                advisorThink: false,
            }),
            onTurn: (t) => {
                const b = buildStrategicBrief(galaxy, t.empire);
                log.push({
                    empire: t.empireName,
                    race: t.empire.dominantRace?.name,
                    starDate: t.starDate,
                    latencyMs: t.latencyMs,
                    rationale: t.rationale,
                    results: t.results.map((r) => ({ id: r.id, status: r.status, text: r.text })),
                    rejected: t.rejected,
                    error: t.error,
                    raw: t.raw,
                    offeredNow: b.decisions.map((d) => d.id),
                    strategies: b.empires.map((e) => `${e.name}: ${e.relation}/${e.yourStrategy}`),
                });
                process.stdout.write(`[18c] ${t.starDate} ${t.empireName} (${t.latencyMs} ms): ${t.rationale} → ${JSON.stringify(t.results.map((r) => `${r.status} ${r.text}`))} ${t.rejected.length ? `rejected ${JSON.stringify(t.rejected)}` : ''} ${t.error ?? ''}\n`);
            },
        });
        const startDate = galaxyStarDate(galaxy);
        const wallStart = Date.now();
        // 1x: one game-second per real second; poll between chunks like the app's timer.
        for (let s = 0; s < 100; s++) {
            const t0 = Date.now();
            runGameSeconds(galaxy, 1);
            driver.poll();
            const wait = 1000 - (Date.now() - t0);
            if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        }
        if (driver.pending !== null) await driver.pending;
        driver.dispose();
        const out = {
            seed,
            met: met.map((e, i) => `${e.name} (${e.dominantRace?.name}, ${metRel[i]})`),
            from: resolveStarDateDescription(startDate),
            to: resolveStarDateDescription(galaxyStarDate(galaxy)),
            wallMs: Date.now() - wallStart,
            intervalDays: days,
            turns: log,
            commandLog: commandLog(galaxy),
        };
        writeFileSync(process.env.DWU_LLM_OUT ?? 'llm18c-real.json', JSON.stringify(out, null, 1));
        expect(met.length).toBeGreaterThan(0);
    }, 3600000);
});
