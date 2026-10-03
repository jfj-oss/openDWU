// The game-start Introduction panel (gap 11, docs/parity/ui-render.md): Main.Part12.cs:2921-3115 method_81's texts.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { getText, loadText } from '../src/sim/textResolver';
import { VictoryConditions } from '../src/sim/victory';
import { introductionInputFor, introductionTexts, type IntroductionInput } from '../src/ui/screens/introductionPanel';
import type { Empire } from '../src/sim/empire';
import type { Galaxy } from '../src/sim/galaxy';
import { PiratePlayStyle } from '../src/sim/pirates';

beforeAll(() => {
    loadText(readFileSync(resolve(__dirname, '../public/assets/dwu/GameText.txt'), 'utf-8'));
});

function input(o: Partial<IntroductionInput> = {}): IntroductionInput {
    const c = new VictoryConditions();
    c.enableRaceSpecificVictoryConditions = false;
    return {
        empireName: 'Human Federation',
        raceName: 'Human',
        governmentName: 'Democracy',
        colonies: 3,
        systems: 2,
        pirateFaction: false,
        piratePlayStyle: 'None',
        description: '',
        playAsAPirate: false,
        ageOfShadows: false,
        conditions: c,
        starDate: (d) => `SD${d}`,
        text: getText,
        ...o,
    };
}

describe('introductionTexts (method_81)', () => {
    it('a standard Classic empire: title, ruler line (race made plural), playstyle texts, picture, button', () => {
        const t = introductionTexts(input());
        expect(t.title).toBe('Welcome to Your Empire');
        expect(t.empireName).toBe('Human Federation');
        expect(t.empireDetails).toBe('You are ruler of the Humans\nYour style of government is Democracy\nYour empire has 3 colonies in 2 systems');
        expect(t.playstyleIntro).toBe(getText('Game Type Intro Normal Classic'));
        expect(t.playstyleIntro.startsWith('You are a standard empire in the Classic Age.')).toBe(true);
        expect(t.whatToDoTitleVisible).toBe(true);
        expect(t.whatToDoTitle).toBe('What You Should Do:');
        expect(t.whatToDoPoints).toBe(getText('Game WhatToDo Normal Classic'));
        expect(t.background).toBe('playstyle_normalclassic.png');
        expect(t.startButton).toBe('Start Playing');
        expect(t.conclusion).toBe('Press F1 for help at any time\n\nExplore, Colonize and Defend!');
        // A race already ending in "s" is not pluralised again.
        expect(introductionTexts(input({ raceName: 'Ackdarians' })).empireDetails.startsWith('You are ruler of the Ackdarians\n')).toBe(true);
    });

    it('picks the playstyle by Game.PlayAsAPirate / Game.AgeOfShadows', () => {
        expect(introductionTexts(input({ ageOfShadows: true }))).toMatchObject({ playstyleIntro: getText('Game Type Intro Normal Shadows'), whatToDoPoints: getText('Game WhatToDo Normal Shadows'), background: 'playstyle_normalshadows.png' });
        expect(introductionTexts(input({ playAsAPirate: true }))).toMatchObject({ playstyleIntro: getText('Game Type Intro Pirate Classic'), whatToDoPoints: getText('Game WhatToDo Pirate Classic'), background: 'playstyle_pirateclassic.png' });
        expect(introductionTexts(input({ playAsAPirate: true, ageOfShadows: true }))).toMatchObject({ playstyleIntro: getText('Game Type Intro Pirate Shadows'), background: 'playstyle_pirateshadows.png' });
        // Empire.Description wins (no "What You Should Do"); the picture follows PirateEmpireBaseHabitat.
        const d = introductionTexts(input({ description: 'A scenario empire.', pirateFaction: true, ageOfShadows: true }));
        expect(d).toMatchObject({ playstyleIntro: 'A scenario empire.', whatToDoTitleVisible: false, whatToDoPoints: '', background: 'playstyle_pirateclassic.png' });
    });

    it('a pirate faction: the PIRATE ruler line with its play style', () => {
        const t = introductionTexts(input({ pirateFaction: true, playAsAPirate: true, piratePlayStyle: 'Raider' }));
        expect(t.empireDetails).toBe('You are ruler of the Humans\nYour pirate play style is Raider\n');
    });

    it('victory condition targets, in the C# order, with the threshold', () => {
        const c = new VictoryConditions();
        c.victoryThresholdPercentage = 0.76;
        c.enableRaceSpecificVictoryConditions = true;
        c.economy = true;
        c.economyPercent = 33.5;
        c.population = true;
        c.populationPercent = 40;
        c.territory = true;
        c.territoryPercent = 25;
        c.timeLimit = true;
        c.timeLimitDate = 123;
        c.startDate = 456;
        const t = introductionTexts(input({ conditions: c }));
        expect(t.victoryConditions).toBe(
            'Victory Condition Targets - Achieve 76% of the following:\n' +
                ' - Human Race-specific conditions\n' +
                ' - Your economy generates 34% of galaxy total\n' +
                " - Control 40% of the galaxy's population\n" +
                ' - Control 25% of colonies in the galaxy\n' +
                'Game finishes at SD123\n' +
                '    (Winner is the empire with the greatest strategic value at this time)\n' +
                'Victory Conditions do not apply until SD456\n',
        );
        // A pirate faction's race line is its play style's.
        expect(introductionTexts(input({ conditions: c, pirateFaction: true, piratePlayStyle: 'Smuggler' })).victoryConditions).toContain(' - Smuggler Pirate-specific conditions\n');
    });

    it('no condition enabled (or none at all) is SANDBOX MODE', () => {
        expect(introductionTexts(input()).victoryConditions).toBe('Victory Condition Targets - Achieve 100% of the following:\nSANDBOX MODE (Open Play - No victory conditions)');
        expect(introductionTexts(input({ conditions: null })).victoryConditions).toBe('Victory Condition Targets - Achieve 100% of the following:\nSANDBOX MODE (Open Play - No victory conditions)');
    });
});

describe('introductionInputFor', () => {
    it('reads the empire: colonies, DetermineEmpireSystems, pirate play style', () => {
        const starA = { name: 'A' };
        const starB = { name: 'B' };
        const col = (star: object) => ({ star });
        const galaxy = {
            determineHabitatSystemStar: (h: { star: object }) => h.star,
            globalVictoryConditions: null,
        } as unknown as Galaxy;
        const player = {
            name: 'Raiders of Doom',
            dominantRace: { name: 'Human' },
            governmentId: -1,
            colonies: [col(starA), col(starA), col(starB)],
            pirateEmpireBaseHabitat: {},
            piratePlayStyle: PiratePlayStyle.Mercenary,
        } as unknown as Empire;
        const i = introductionInputFor(galaxy, player, { playAsAPirate: true, ageOfShadows: false });
        expect(i).toMatchObject({ empireName: 'Raiders of Doom', raceName: 'Human', governmentName: '', colonies: 3, systems: 2, pirateFaction: true, piratePlayStyle: 'Mercenary', playAsAPirate: true, conditions: null });
    });
});
