// @slow — soak: scenario 19d1 internal politics (tasks/19d1-internal-politics.md §7, §S6.2-3): determinism, a save round
// trip mid-run, and a forced crisis on the older-start seed-1 game producing plot outcomes within 10 game years.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { CharacterRole } from '../src/sim/characters';
import { politicsState, type PoliticsEvent } from '../src/sim/scenario/emergent/politics';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const FLAGS = { internalPolitics: true, livingCharacters: false };
const CRISIS = { politicsIntensity: 3, coupApprovalThreshold: 50 };

function crisisGame(): Game {
    return createScenarioGame(base, { scenario: 'emergent', flags: FLAGS, params: CRISIS }).game;
}

function eventKey(events: PoliticsEvent[]): string[] {
    return events.map((e) => `${e.year}|${e.empire.empireId}|${e.kind}|${e.character.name}|${e.success}|${e.other?.empireId ?? -1}`);
}

function saveText(game: Game): string {
    const time = new GalaxyTime();
    time.togglePause();
    time.advance(game.galaxy.nowMs);
    return serializeGame(game, time, { ...defaultStartGameOptions(), seed: 1, scenario: { id: 'emergent', flags: FLAGS, params: CRISIS } });
}

describe('19d1 determinism and save round trip', () => {
    it('same seed and flags twice give the same digest and politics state; a mid-run save continues identically', () => {
        const a = crisisGame();
        runGameSeconds(a, 1200);
        const b = crisisGame();
        runGameSeconds(b, 1200);
        expect(stateDigest(b.galaxy)).toBe(stateDigest(a.galaxy));
        expect(eventKey(politicsState(b.galaxy).events)).toEqual(eventKey(politicsState(a.galaxy).events));

        const gameData = createScenarioGame(base, { scenario: 'emergent', flags: FLAGS, params: CRISIS }).gameData;
        const loaded = deserializeGame(saveText(a), gameData).game;
        expect(politicsState(loaded.galaxy).chars.size).toBe(politicsState(a.galaxy).chars.size);
        runGameSeconds(a, 600);
        runGameSeconds(loaded, 600);
        expect(stateDigest(loaded.galaxy)).toBe(stateDigest(a.galaxy));
        expect(eventKey(politicsState(loaded.galaxy).events)).toEqual(eventKey(politicsState(a.galaxy).events));
    }, 2400000);
});

describe('19d1 forced crisis', () => {
    it('plots turn into coups, secessions or defections within 10 game years', () => {
        const age = 3;
        const { game } = createScenarioGame(base, {
            scenario: 'emergent',
            flags: FLAGS,
            params: { ...CRISIS, secessionMinColonies: 3 },
            options: (o) => ({ ...o, galaxyAge: age, player: { ...o.player, age }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age })) }),
        });
        const g = game.galaxy;
        const outcomes = (): PoliticsEvent[] => politicsState(g).events.filter((e) => e.kind !== 'rumour');
        for (let year = 0; year < 10 && outcomes().length === 0; year++) {
            // The crisis: every official is disaffected and ambitious at the start of each year.
            for (const [c, e] of politicsState(g).chars) {
                if (c.role === CharacterRole.Leader) continue;
                e.loyalty = Math.min(e.loyalty, 15);
                e.ambition = Math.max(e.ambition, 75);
            }
            runGameSeconds(game, 600);
        }
        const counts: Record<string, number> = {};
        for (const e of politicsState(g).events) counts[`${e.kind}${e.success ? '' : ' (failed/hidden)'}`] = (counts[`${e.kind}${e.success ? '' : ' (failed/hidden)'}`] ?? 0) + 1;
        console.log('19d1 forced crisis outcome counts', counts);
        expect(outcomes().length).toBeGreaterThanOrEqual(1);
        for (const s of outcomes().filter((e) => e.kind === 'secession' && e.other !== null)) {
            expect(s.other!.leader).toBe(s.character);
        }
    }, 2400000);
});
