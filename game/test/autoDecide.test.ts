// Policy: automatic answering of add-on decisions, and the recommended option (scenario/decisions.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import { autoDecideOn, decisionKindAutomatable, pendingScenarioDecisions, raiseScenarioDecision, recommendedOption, registerScenarioDecision } from '../src/sim/scenario/decisions';
import { issuePlayerCommand, runPlayerCommand } from '../src/sim/player/playerCommands';
import { runSimFrame } from '../src/sim/tick/scheduler';
import { commandLog, type PlayerLogEntry } from '../src/sim/player/commandLog';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { GalaxyTime } from '../src/sim/galaxyTime';
import '../src/sim/scenario/packages';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

const OPTIONS = [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }];

describe('auto-decide threat and add-on decisions', () => {
    it('the recommendation is pure (draws no Rnd), is one of the options, and falls back to the default', () => {
        const { game } = createScenarioGame(gameData, { scenario: 'example', flags: { exampleFlag: true } });
        const g = game.galaxy;
        const p = game.playerEmpire;
        let drew = 0;
        const offs = [
            registerScenarioDecision({ id: 't.rec', flag: 'exampleFlag', kind: 't.rec', resolve: () => undefined, recommend: () => 'no' }),
            registerScenarioDecision({ id: 't.ai', flag: 'exampleFlag', kind: 't.ai', resolve: () => undefined, aiPure: true, aiChoose: () => 'no' }),
            registerScenarioDecision({ id: 't.impure', flag: 'exampleFlag', kind: 't.impure', resolve: () => undefined, aiChoose: () => (drew++, 'no') }),
            registerScenarioDecision({ id: 't.bad', flag: 'exampleFlag', kind: 't.bad', resolve: () => undefined, recommend: () => 'bogus' }),
        ];
        try {
            const mkP = (kind: string) => raiseScenarioDecision(g, p, { kind, title: 'Q', text: 'T', options: OPTIONS, defaultOption: 'yes' });
            const before = JSON.stringify(g.rnd);
            expect(recommendedOption(g, mkP('t.rec'))).toBe('no');
            expect(recommendedOption(g, mkP('t.ai'))).toBe('no');
            drew = 0;
            expect(recommendedOption(g, mkP('t.impure'))).toBe('yes'); // aiChoose not marked pure: not called
            expect(drew).toBe(0);
            expect(recommendedOption(g, mkP('t.bad'))).toBe('yes');
            expect(JSON.stringify(g.rnd)).toBe(before);
        } finally {
            offs.forEach((o) => o());
        }
    }, 300000);

    it('on: the player decision is answered at once through the same path, with a message; off or excluded: it pops up', () => {
        const { game } = createScenarioGame(gameData, { scenario: 'example', flags: { exampleFlag: true } });
        const g = game.galaxy;
        const p = game.playerEmpire;
        const resolved: string[] = [];
        const offs = [
            registerScenarioDecision({ id: 't.auto', flag: 'exampleFlag', kind: 't.auto', resolve: (_g, d, o) => resolved.push(`${d.id}:${o}:${d.answeredBy}`), recommend: () => 'no' }),
            registerScenarioDecision({ id: 't.moral', flag: 'exampleFlag', kind: 't.moral', alwaysAsk: true, resolve: () => undefined, recommend: () => 'no' }),
        ];
        try {
            expect(decisionKindAutomatable('t.auto')).toBe(true);
            expect(decisionKindAutomatable('t.moral')).toBe(false);
            expect(autoDecideOn(g, p)).toBe(false);
            // Off (the default): it waits for the player.
            const off = raiseScenarioDecision(g, p, { kind: 't.auto', title: 'Q', text: 'T', options: OPTIONS });
            expect(pendingScenarioDecisions(g, p)).toContain(off);
            // The journaled command switches it on.
            issuePlayerCommand(g, p, 'setAutoDecide', [true]);
            runSimFrame(g, 17);
            expect(autoDecideOn(g, p)).toBe(true);
            const e = commandLog(g).at(-1) as PlayerLogEntry;
            expect(e).toMatchObject({ source: 'player', op: 'setAutoDecide', args: [true] });
            const before = p.messages.length;
            const rndBefore = JSON.stringify(g.rnd);
            const d = raiseScenarioDecision(g, p, { kind: 't.auto', title: 'Q', text: 'T', options: OPTIONS });
            expect(d.answer).toBe('no');
            expect(d.answeredBy).toBe('auto');
            expect(resolved.at(-1)).toBe(`${d.id}:no:auto`);
            expect(pendingScenarioDecisions(g, p)).not.toContain(d);
            expect(JSON.stringify(g.rnd)).toBe(rndBefore);
            // The player is told, without a popup.
            expect(p.messages.length).toBeGreaterThan(before);
            const note = p.messages[p.messages.length - 1] as { title: string; supressPopup: boolean };
            expect(note.title).toContain('Decided automatically');
            expect(note.supressPopup).toBe(true);
            // An excluded kind still pops up.
            const m = raiseScenarioDecision(g, p, { kind: 't.moral', title: 'Q', text: 'T', options: OPTIONS });
            expect(m.answer).toBeNull();
            expect(pendingScenarioDecisions(g, p)).toContain(m);
            // Off again.
            expect(runPlayerCommand(g, p, 'setAutoDecide', [false])).toBe(true);
            expect(autoDecideOn(g, p)).toBe(false);
        } finally {
            offs.forEach((o) => o());
        }
    }, 300000);

    it('the switch survives a save; a save without it reads as Ask me', () => {
        const { game, gameData: sd } = createScenarioGame(gameData, { scenario: 'example', flags: { exampleFlag: true } });
        const p = game.playerEmpire;
        expect(autoDecideOn(game.galaxy, p)).toBe(false);
        runPlayerCommand(game.galaxy, p, 'setAutoDecide', [true]);
        const snap = serializeGame(game, new GalaxyTime(), { ...defaultStartGameOptions(), seed: 1, scenario: { id: 'example', flags: { exampleFlag: true }, params: {} } });
        const back = deserializeGame(snap, sd).game;
        expect(autoDecideOn(back.galaxy, back.playerEmpire)).toBe(true);
    }, 300000);

    it('the exclusion list: moral and dramatic kinds are never automatable, routine ones are', () => {
        for (const k of ['espionage.escalate', 'refugees.asylum']) expect(decisionKindAutomatable(k), k).toBe(false);
        for (const k of ['espionage.demand', 'espionage.response', 'crises.fuel']) expect(decisionKindAutomatable(k), k).toBe(true);
        expect(decisionKindAutomatable('no.such.kind')).toBe(false);
    });
});
