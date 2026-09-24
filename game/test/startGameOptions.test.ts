import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    aggressionFor,
    alienLifeFor,
    applyEmpireDefaults,
    colonyPrevalenceFor,
    defaultEmpireName,
    defaultFlagColors,
    defaultRaceName,
    defaultStartGameOptions,
    difficultyFor,
    flagShapeUrl,
    FLAG_COLOR_PALETTE,
    piratesFor,
    sectorsFor,
    spaceCreaturesFor,
    starCountFor,
    type StartGameOptions,
} from '../src/sim/startGameOptions';
import { GalaxyShape } from '../src/sim/types';
import { parseRace, type Race } from '../src/sim/data/races';

describe('starCountFor (task 06b, Start.cs BaconStart.method_60)', () => {
    it('maps the six star-amount slider ticks', () => {
        expect(starCountFor(0)).toBe(100);
        expect(starCountFor(1)).toBe(250);
        expect(starCountFor(2)).toBe(400);
        expect(starCountFor(3)).toBe(700);
        expect(starCountFor(4)).toBe(1000);
        expect(starCountFor(5)).toBe(1400);
    });

    it('defaults out-of-range indices to 400 (Small)', () => {
        expect(starCountFor(-1)).toBe(400);
        expect(starCountFor(6)).toBe(400);
    });
});

describe('sectorsFor (task 06b, Start.cs Start.method_69)', () => {
    it('maps the five physical-size slider ticks', () => {
        expect(sectorsFor(0)).toBe(4);
        expect(sectorsFor(1)).toBe(6);
        expect(sectorsFor(2)).toBe(8);
        expect(sectorsFor(3)).toBe(10);
        expect(sectorsFor(4)).toBe(15);
    });

    it('defaults out-of-range indices to 10 (Large)', () => {
        expect(sectorsFor(-1)).toBe(10);
        expect(sectorsFor(5)).toBe(10);
    });
});

describe('defaultStartGameOptions (task 06b)', () => {
    it('defaults to Spiral, star index 3, dimension index 2', () => {
        const opts = defaultStartGameOptions();
        expect(opts.shape).toBe(GalaxyShape.Spiral);
        expect(opts.starCountIndex).toBe(3);
        expect(opts.dimensionIndex).toBe(2);
        expect(typeof opts.seed).toBe('number');
        // Task 06d: no race chosen until the wizard's "Your Race" page runs.
        expect(opts.raceName).toBe('');
        // Task 06e: the "Your Empire" fields start uncustomised so
        // applyEmpireDefaults can fill them in.
        expect(opts.empireName).toBe('');
        expect(opts.governmentId).toBe(-1);
        expect(opts.flagShapeIndex).toBe(-1);
        expect(opts.primaryColor).toBe('');
        expect(opts.secondaryColor).toBe('');
        // Task 06f: galaxy-option sliders default to their middle ticks (the
        // original's default positions are not visible in the task context);
        // difficulty scaling is off.
        expect(opts.colonyPrevalenceIndex).toBe(2);
        expect(opts.alienLifeIndex).toBe(2);
        expect(opts.spaceCreaturesIndex).toBe(1);
        expect(opts.piratesIndex).toBe(2);
        expect(opts.aggressionIndex).toBe(2);
        expect(opts.difficultyIndex).toBe(2);
        expect(opts.difficultyScaling).toBe(false);
    });
});

describe('defaultRaceName (task 06d)', () => {
    function race(name: string, playable: boolean): Race {
        return { name, playable } as unknown as Race;
    }

    it('picks the first playable race sorted by name', () => {
        const races = [race('Zeta', true), race('Alpha', true), race('Beta', false)];
        expect(defaultRaceName(races)).toBe('Alpha');
    });

    it('skips unplayable races when a playable one exists', () => {
        const races = [race('Alpha', false), race('Beta', true)];
        expect(defaultRaceName(races)).toBe('Beta');
    });

    it('falls back to the first race overall when none are playable', () => {
        const races = [race('Zeta', false), race('Alpha', false)];
        expect(defaultRaceName(races)).toBe('Alpha');
    });

    it('returns an empty string with no races', () => {
        expect(defaultRaceName([])).toBe('');
    });

    it('matches the real parsed race data (first playable, sorted by name)', () => {
        const dwuRoot = resolve(__dirname, '../public/assets/dwu');
        const raceFiles = readdirSync(resolve(dwuRoot, 'races')).filter((f) => f.endsWith('.txt'));
        const races = raceFiles.map((f) => parseRace(readFileSync(resolve(dwuRoot, 'races', f), 'utf-8')));
        const expected = [...races]
            .sort((a, b) => a.name.localeCompare(b.name))
            .find((r) => r.playable)?.name ?? '';
        expect(expected).not.toBe('');
        expect(defaultRaceName(races)).toBe(expected);
    });
});

describe('StartGameOptions round-trip (task 06d)', () => {
    it('spreads into an equal copy including raceName', () => {
        const options: StartGameOptions = {
            shape: GalaxyShape.Ring,
            starCountIndex: 1,
            dimensionIndex: 4,
            seed: 42,
            raceName: 'Human',
            empireName: 'Human Empire',
            governmentId: 5,
            flagShapeIndex: 7,
            primaryColor: '#c8373a',
            secondaryColor: '#e8d24a',
            colonyPrevalenceIndex: 0,
            alienLifeIndex: 1,
            spaceCreaturesIndex: 2,
            piratesIndex: 3,
            aggressionIndex: 4,
            difficultyIndex: 0,
            difficultyScaling: true,
        };
        const copy = { ...options };
        expect(copy).toEqual(options);
        // Mutating the copy must not affect the original (plain value types).
        copy.raceName = 'Evuck';
        copy.seed = 7;
        expect(options.raceName).toBe('Human');
        expect(options.seed).toBe(42);
    });

    it('maps through the option helpers unchanged', () => {
        const options: StartGameOptions = {
            shape: GalaxyShape.Spiral,
            starCountIndex: 3,
            dimensionIndex: 2,
            seed: 1,
            raceName: 'Ackdarian',
            empireName: 'Ackdarian Empire',
            governmentId: -1,
            flagShapeIndex: -1,
            primaryColor: '',
            secondaryColor: '',
            colonyPrevalenceIndex: 2,
            alienLifeIndex: 2,
            spaceCreaturesIndex: 1,
            piratesIndex: 2,
            aggressionIndex: 2,
            difficultyIndex: 2,
            difficultyScaling: false,
        };
        expect(starCountFor(options.starCountIndex)).toBe(700);
        expect(sectorsFor(options.dimensionIndex)).toBe(8);
        expect(options.raceName).toBe('Ackdarian');
    });
});

describe('flagShapeUrl (task 06e)', () => {
    it('builds two-digit flagNN.png URLs under /assets/dwu/images/ui/flagshapes/', () => {
        expect(flagShapeUrl(0)).toBe('/assets/dwu/images/ui/flagshapes/flag00.png');
        expect(flagShapeUrl(7)).toBe('/assets/dwu/images/ui/flagshapes/flag07.png');
        expect(flagShapeUrl(82)).toBe('/assets/dwu/images/ui/flagshapes/flag82.png');
    });
});

describe('defaultEmpireName / applyEmpireDefaults (task 06e)', () => {
    function baseOptions(): StartGameOptions {
        return defaultStartGameOptions();
    }

    it('defaults the empire name to "<Race name> Empire"', () => {
        expect(defaultEmpireName('Human')).toBe('Human Empire');
        const opts = baseOptions();
        opts.raceName = 'Human';
        applyEmpireDefaults(opts, 0);
        expect(opts.empireName).toBe('Human Empire');
    });

    it('auto-updates the name when the race changes and the user has not edited it', () => {
        const opts = baseOptions();
        opts.raceName = 'Human';
        applyEmpireDefaults(opts, 0);
        expect(opts.empireName).toBe('Human Empire');
        // Race changes on the wizard's "Your Race" page (prev = 'Human').
        opts.raceName = 'Evuck';
        applyEmpireDefaults(opts, 1, 'Human');
        expect(opts.empireName).toBe('Evuck Empire');
    });

    it('keeps a user-edited name across race changes', () => {
        const opts = baseOptions();
        opts.raceName = 'Human';
        applyEmpireDefaults(opts, 0);
        opts.empireName = 'My Custom Empire'; // user edit
        opts.raceName = 'Evuck';
        applyEmpireDefaults(opts, 1, 'Human');
        expect(opts.empireName).toBe('My Custom Empire');
    });

    it('fills deterministic flag defaults by race index only while uncustomised', () => {
        const opts = baseOptions();
        opts.raceName = 'Human';
        applyEmpireDefaults(opts, 3);
        expect(opts.flagShapeIndex).toBe(3 % 83);
        expect(opts.primaryColor).toBe(defaultFlagColors(3).primary);
        expect(opts.secondaryColor).toBe(defaultFlagColors(3).secondary);

        // A second call with a different race index must not clobber them.
        applyEmpireDefaults(opts, 7);
        expect(opts.flagShapeIndex).toBe(3 % 83);
        expect(opts.primaryColor).toBe(defaultFlagColors(3).primary);
        expect(opts.secondaryColor).toBe(defaultFlagColors(3).secondary);
    });

    it('defaultFlagColors picks deterministically from the 12-colour palette', () => {
        expect(FLAG_COLOR_PALETTE).toHaveLength(12);
        for (let i = 0; i < 24; i++) {
            const { primary, secondary } = defaultFlagColors(i);
            expect(FLAG_COLOR_PALETTE).toContain(primary);
            expect(FLAG_COLOR_PALETTE).toContain(secondary);
            expect(primary).toBe(FLAG_COLOR_PALETTE[((i % 12) + 12) % 12]);
            expect(secondary).toBe(FLAG_COLOR_PALETTE[(((i % 12) + 12) % 12 + 5) % 12]);
        }
    });
});

describe('colonyPrevalenceFor (task 06f, Start.cs Start.method_64)', () => {
    it('maps the five colony-prevalence slider ticks', () => {
        expect(colonyPrevalenceFor(0)).toBe(0.35);
        expect(colonyPrevalenceFor(1)).toBe(0.5);
        expect(colonyPrevalenceFor(2)).toBe(0.65);
        expect(colonyPrevalenceFor(3)).toBe(0.82);
        expect(colonyPrevalenceFor(4)).toBe(1.0);
    });

    it('defaults out-of-range indices to 0.75 (C# pre-switch default)', () => {
        expect(colonyPrevalenceFor(-1)).toBe(0.75);
        expect(colonyPrevalenceFor(5)).toBe(0.75);
    });
});

describe('alienLifeFor (task 06f, Start.cs Start.method_67 → BaconStart.OverrideLowIndependentLifeValue)', () => {
    it('maps the five alien-life slider ticks (vanilla table; the 150 case is a Bacon override in the mod)', () => {
        expect(alienLifeFor(0)).toBe(150);
        expect(alienLifeFor(1)).toBe(250);
        expect(alienLifeFor(2)).toBe(400);
        expect(alienLifeFor(3)).toBe(700);
        expect(alienLifeFor(4)).toBe(1000);
    });

    it('defaults out-of-range indices to 400 (C# pre-switch default)', () => {
        expect(alienLifeFor(-1)).toBe(400);
        expect(alienLifeFor(5)).toBe(400);
    });
});

describe('spaceCreaturesFor (task 06f, Start.cs Start.method_62)', () => {
    it('maps the four space-creatures slider ticks', () => {
        expect(spaceCreaturesFor(0)).toBe(0.0);
        expect(spaceCreaturesFor(1)).toBe(0.3);
        expect(spaceCreaturesFor(2)).toBe(0.6);
        expect(spaceCreaturesFor(3)).toBe(1.0);
    });

    it('defaults out-of-range indices to 0', () => {
        expect(spaceCreaturesFor(-1)).toBe(0.0);
        expect(spaceCreaturesFor(4)).toBe(0.0);
    });
});

describe('piratesFor (task 06f, Start.cs Start.method_66)', () => {
    it('maps the six pirates slider ticks', () => {
        expect(piratesFor(0)).toBe(0.0);
        expect(piratesFor(1)).toBe(0.07);
        expect(piratesFor(2)).toBe(0.2);
        expect(piratesFor(3)).toBe(0.4);
        expect(piratesFor(4)).toBe(0.7);
        expect(piratesFor(5)).toBe(1.0);
    });

    it('defaults out-of-range indices to 0', () => {
        expect(piratesFor(-1)).toBe(0.0);
        expect(piratesFor(6)).toBe(0.0);
    });
});

describe('aggressionFor (task 06f, Start.cs Start.method_71)', () => {
    it('maps the five aggression slider ticks', () => {
        expect(aggressionFor(0)).toBe(0.9);
        expect(aggressionFor(1)).toBe(1.1);
        expect(aggressionFor(2)).toBe(1.3);
        expect(aggressionFor(3)).toBe(1.5);
        expect(aggressionFor(4)).toBe(1.7);
    });

    it('defaults out-of-range indices to 0', () => {
        expect(aggressionFor(-1)).toBe(0.0);
        expect(aggressionFor(5)).toBe(0.0);
    });
});

describe('difficultyFor (task 06f, Start.1.cs Start.method_201)', () => {
    it('maps the five difficulty slider ticks', () => {
        expect(difficultyFor(0)).toBe(0.7);
        expect(difficultyFor(1)).toBe(1.0);
        expect(difficultyFor(2)).toBe(1.25);
        expect(difficultyFor(3)).toBe(1.6);
        expect(difficultyFor(4)).toBe(2.0);
    });

    it('defaults out-of-range indices to 1.0 (C# pre-switch default)', () => {
        expect(difficultyFor(-1)).toBe(1.0);
        expect(difficultyFor(5)).toBe(1.0);
    });
});
