import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    applyEmpireDefaults,
    defaultEmpireName,
    defaultFlagColors,
    defaultRaceName,
    defaultStartGameOptions,
    flagShapeUrl,
    FLAG_COLOR_PALETTE,
    sectorsFor,
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
