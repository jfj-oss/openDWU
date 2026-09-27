// 19s-1 AI PARITY AUDIT counters (src/sim/scenario/llm/parity.ts; the soak is scripts/ai-parity.mjs): the ai-parity
// scenario resolves every package on this build with every flag on (the game-ending one off), the Lively Galaxy
// handlers run inside it (a scenario that includes a package gated on its scenario id), a short run is sampled between
// chunks (pure: no state, no Rnd), re-sampling never double-counts, the counters attribute AI / player / other from
// synthetic states, and the report has the table, the near-zero list and the absent systems.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame, scenarioGameData } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Empire } from '../src/sim/empire';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { warGoalsOn } from '../src/sim/scenario/lively/warGoals';
import { scenarioGateOpenFor } from '../src/sim/scenario/hooks';
import { ParityAudit, PARITY_DEFAULT_OFF, parityFlags, parityMarkdown, playerOnlyDecisionRows } from '../src/sim/scenario/llm/parity';

const SC = 'ai-parity';
let base: GameData;
let FLAGS: Record<string, boolean>;
beforeAll(async () => {
    base = await loadGameDataFs();
    FLAGS = parityFlags(scenarioGameData(base, SC).scenario!.manifest.flags);
}, 120000);

describe('the ai-parity scenario', () => {
    it('merges every package on this build and turns every flag on except the game end', () => {
        for (const f of ['llmFoundations', 'eventLog', 'internalSecurity', 'galacticCouncil', 'warGoals', 'wreckage', 'rimHerders', 'independentActors', 'rimTrader', 'charteredCompanies', 'newFauna', 'cult', 'hive', 'threatExchange', 'threatTimeBomb', 'silence', 'threatRobotMutiny', 'darkFarms']) {
            expect(FLAGS[f], f).toBe(true);
        }
        expect(FLAGS.darkFarmsGameEnd).toBe(false);
        expect(PARITY_DEFAULT_OFF).toEqual(['darkFarmsGameEnd']);
        expect(parityFlags([{ name: 'a' }, { name: 'b' }], ['b'])).toEqual({ a: true, b: false });
    });

    it('a package gated on its scenario id runs inside a scenario that includes it (and nowhere else)', () => {
        const g = createScenarioGame(base, { scenario: SC, flags: FLAGS }).game.galaxy;
        expect(warGoalsOn(g)).toBe(true);
        expect(scenarioGateOpenFor(g.scenario, { id: 't', scenarioId: 'lively-galaxy', flag: 'warGoals' })).toBe(true);
        expect(scenarioGateOpenFor(g.scenario, { id: 't', scenarioId: 'lively-galaxy', flag: 'noSuchFlag' })).toBe(false);
        const other = createScenarioGame(base, { scenario: 'galactic-council' }).game.galaxy;
        expect(scenarioGateOpenFor(other.scenario, { id: 't', scenarioId: 'lively-galaxy' })).toBe(false);
    }, 120000);
});

describe('ParityAudit on a short run', () => {
    it('samples between chunks without touching the game; re-sampling does not double-count; the report renders', () => {
        const { game } = createScenarioGame(base, { scenario: SC, flags: FLAGS });
        const g = game.galaxy;
        const audit = new ParityAudit();
        audit.sample(g);
        for (let i = 0; i < 4; i++) {
            runGameSeconds(game, 60);
            const d = stateDigest(g);
            const draws = g.rnd.drawCount;
            audit.sample(g);
            expect(stateDigest(g)).toBe(d);
            expect(g.rnd.drawCount).toBe(draws);
        }
        const rows = JSON.stringify(audit.rows());
        audit.sample(g);
        expect(JSON.stringify(audit.rows())).toBe(rows);
        expect(audit.samples).toBe(6);
        const present = new Set(audit.rows().filter((r) => r.present).map((r) => r.system));
        for (const s of ['Internal security (19m)', 'War goals (19g-3)', 'Crises (19d2)', 'Rim herders (19j)', 'Independents (19k)']) expect(present.has(s), s).toBe(true);
        // The event log is read too.
        expect([...audit.eventSources.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
        // Every answered decision in the history is counted once, in its column.
        const hist = ((g.scenario!.state.decisions as { history?: { answeredBy: string }[] } | undefined)?.history ?? []);
        const answers = audit.rows().filter((r) => r.counter.startsWith('decision ') && r.counter.endsWith('(answers)'));
        expect(answers.reduce((s, r) => s + r.ai + r.player + r.other, 0)).toBe(hist.length);
        expect(answers.reduce((s, r) => s + r.ai, 0)).toBe(hist.filter((d) => d.answeredBy === 'ai').length);
        const md = parityMarkdown(audit.data(), { date: '2026-09-27', seed: 1, years: 0.4, stars: 300, empires: 4, scenario: SC, flags: Object.keys(FLAGS), flagsOff: ['darkFarmsGameEnd'], wallSeconds: 1, exceptions: 0, samples: audit.samples });
        expect(md).toContain('| System | Counter | AI | Player | Other | Source |');
        expect(md).toContain('## Near-zero AI usage');
        expect(md).toContain('## Not present in this run');
        expect(md).toContain('## Event log entries by source');
        expect(md).toContain('except `darkFarmsGameEnd`');
    }, 600000);

    it('attributes synthetic facts to AI / player / other and de-duplicates by key', () => {
        const { game } = createScenarioGame(base, { scenario: SC, flags: FLAGS });
        const g = game.galaxy;
        const p = g.playerEmpire!;
        const [a, b] = g.empires.filter((e): e is Empire => e !== null && e !== p && e.active && e.pirateEmpireBaseHabitat === null);
        const s = g.scenario!.state;
        s.council = {
            councils: [
                {
                    id: 1,
                    members: [p, a, b],
                    results: [
                        { motionId: 1, passed: true, proposer: a },
                        { motionId: 2, passed: false, proposer: p },
                    ],
                    motion: { id: 3, proposer: b, votes: [{ empire: a, vote: 'yes' }, { empire: b, vote: 'abstain' }, { empire: p, vote: 'no' }] },
                    blocs: [{ id: 1, founder: a }],
                },
            ],
        };
        s.decisions = { nextId: 4, pending: [], history: [{ id: 1, kind: 'refugees.asylum', answeredBy: 'ai', answer: 'open' }, { id: 2, kind: 'refugees.asylum', answeredBy: 'expired', answer: 'closed' }, { id: 3, kind: 'lively.peace', answeredBy: 'player', answer: 'accept' }] };
        s.courtIntrigue = { schemes: [{ id: 1, kind: 'sway', empire: a }, { id: 2, kind: 'blackmail', empire: p }] };
        s.court = { events: [{ year: 2101, empire: a, kind: 'concede', text: 'x' }, { year: 2101, empire: b, kind: 'refuse', text: 'y' }] };
        const audit = new ParityAudit();
        audit.sample(g);
        audit.sample(g);
        const row = (system: string, counter: string) => audit.rows().find((r) => r.system === system && r.counter === counter)!;
        expect(row('Council (19d8)', 'motions tabled')).toMatchObject({ ai: 2, player: 1 });
        expect(row('Council (19d8)', 'motions passed')).toMatchObject({ ai: 1, player: 0 });
        expect(row('Council (19d8)', 'votes cast yes/no')).toMatchObject({ ai: 1, player: 1 });
        expect(row('Council (19d8)', 'abstentions')).toMatchObject({ ai: 1 });
        expect(row('Council (19d8)', 'blocs formed')).toMatchObject({ ai: 1 });
        expect(row('Refugees (19d5)', 'decision refugees.asylum (answers)')).toMatchObject({ ai: 1, player: 0, other: 1 });
        expect(row('Refugees (19d5)', 'decision refugees.asylum → open')).toMatchObject({ ai: 1 });
        expect(row('War goals (19g-3)', 'decision lively.peace (answers)')).toMatchObject({ player: 1 });
        expect(row('Court (19n)', 'schemes started')).toMatchObject({ ai: 1, player: 1, present: true });
        expect(row('Court (19n)', 'faction concessions')).toMatchObject({ ai: 1 });
        expect(row('Court (19n)', 'faction refusals')).toMatchObject({ ai: 1 });
        // Near-zero: present rows with no AI activity (threshold 0 for a one-year run).
        const nz = audit.nearZero(1).map((r) => `${r.system}: ${r.counter}`);
        expect(audit.nearZero(1).every((r) => r.ai === 0 && !r.counter.includes('→'))).toBe(true);
        // A decision only the player got is not near-zero AI usage; it is listed apart.
        expect(nz).not.toContain('War goals (19g-3): decision lively.peace (answers)');
        expect(playerOnlyDecisionRows(audit.rows()).map((r) => r.counter)).toEqual(['decision lively.peace (answers)']);
        expect(nz).not.toContain('Council (19d8): motions tabled');
        expect(audit.absent()).toContain('Reputation (19o)');
    }, 120000);
});
