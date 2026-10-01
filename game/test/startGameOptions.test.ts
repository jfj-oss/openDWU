import { beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    aggressionFor,
    alienLifeFor,
    applyEmpireDefaults,
    clampColonization,
    clampOtherEmpires,
    clampVictory,
    colonyPrevalenceFor,
    COLONIZATION_RANGE_KLY_MAX,
    COLONIZATION_RANGE_KLY_MIN,
    COLONY_INFLUENCE_RANGE_PCT_MAX,
    COLONY_INFLUENCE_RANGE_PCT_MIN,
    defaultColonizationOptions,
    defaultEmpireName,
    defaultFlagColors,
    defaultOtherEmpiresOptions,
    defaultRaceName,
    defaultStartGameOptions,
    defaultVictoryConditions,
    difficultyFor,
    flagShapeUrl,
    FLAG_COLOR_PALETTE,
    OTHER_EMPIRES_COUNT_MAX,
    OTHER_EMPIRES_COUNT_MIN,
    piratesFor,
    pirateProximityFor,
    pirateShipMaintenanceFactorFor,
    sectorsFor,
    spaceCreaturesFor,
    starCountFor,
    toCreateGameOptions,
    VICTORY_PERCENT_MIN,
    VICTORY_TIME_LIMIT_YEARS_MAX,
    VICTORY_TIME_LIMIT_YEARS_MIN,
    VICTORY_TIME_START_YEARS_MAX,
    VICTORY_TIME_START_YEARS_MIN,
    type StartGameOptions,
} from '../src/sim/startGameOptions';
import { GalaxyShape } from '../src/sim/types';
import { parseRace, type Race } from '../src/sim/data/races';
import type { GameData } from '../src/sim/data/gameData';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import {
    WIZARD_BACK_LABELS,
    WIZARD_FORWARD_LABELS,
    WIZARD_PAGE_TITLES,
    WIZARD_PAGES,
} from '../src/ui/screens/newGameWizard';

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
        // Pirates page: Start.cs 3302-3303 standard preset / Main.Part9.cs 2665-2667 (Pirates 3, proximity
        // Average, strength 2) — was the guessed middle tick 2 before the pirate settings were mapped.
        expect(opts.piratesIndex).toBe(3);
        expect(opts.pirateProximityIndex).toBe(1);
        expect(opts.pirateStrengthIndex).toBe(2);
        expect(opts.aggressionIndex).toBe(2);
        expect(opts.difficultyIndex).toBe(2);
        expect(opts.difficultyScaling).toBe(false);
        // Task 06g: victory conditions default to the C# defaults (all types
        // unchecked = sandbox mode; percents 33; time limit 10y; time start
        // 3y; all event toggles on; threshold 1.0).
        expect(opts.victory).toEqual(defaultVictoryConditions());
        // Task 06h (fixed wizdefaults): colonization options default to the C#
        // StartGameOptions defaults (Main.Part9.cs 2674-2675: enforcement on,
        // range 2000 Kly = 2 sectors; influence 100 %, same-system option off).
        expect(opts.colonization).toEqual(defaultColonizationOptions());
        // Task 06h: other empires default to auto-generate with 10 empires.
        expect(opts.otherEmpires).toEqual(defaultOtherEmpiresOptions());
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
            victory: {
                ...defaultVictoryConditions(),
                territory: true,
                territoryPercent: 50,
                timeLimit: true,
                timeLimitYears: 25,
            },
            colonization: {
                ...defaultColonizationOptions(),
                enforceRangeLimits: true,
                colonizationRangeKly: 1500,
                allowSameSystemAsOtherEmpires: true,
            },
            otherEmpires: {
                ...defaultOtherEmpiresOptions(),
                autogenerate: false,
                empireCount: 4,
            },
        };
        const copy = { ...options };
        expect(copy).toEqual(options);
        // Mutating the copy must not affect the original (plain value types).
        copy.raceName = 'Evuck';
        copy.seed = 7;
        expect(options.raceName).toBe('Human');
        expect(options.seed).toBe(42);
    });

    it('round-trips custom nested colonization / otherEmpires objects through a deep copy', () => {
        const options: StartGameOptions = defaultStartGameOptions();
        options.colonization = {
            ...defaultColonizationOptions(),
            enforceRangeLimits: true,
            colonizationRangeKly: 900,
            colonyInfluenceRangePercent: 150,
            allowSameSystemAsOtherEmpires: true,
        };
        options.otherEmpires = { autogenerate: false, empireCount: 3, manual: [] };
        const copy = {
            ...options,
            colonization: { ...options.colonization },
            otherEmpires: { ...options.otherEmpires },
        };
        expect(copy.colonization).toEqual(options.colonization);
        expect(copy.otherEmpires).toEqual(options.otherEmpires);
        // Mutating the copies' nested objects must not affect the originals.
        copy.colonization.colonizationRangeKly = 5000;
        copy.otherEmpires.empireCount = 99;
        expect(options.colonization.colonizationRangeKly).toBe(900);
        expect(options.otherEmpires.empireCount).toBe(3);
    });

    it('round-trips a custom nested victory object through a deep copy', () => {
        const options: StartGameOptions = defaultStartGameOptions();
        options.victory = {
            ...defaultVictoryConditions(),
            economy: true,
            economyPercent: 60,
            startDateYears: 12,
            enableDisasterEvents: false,
        };
        const copy = { ...options, victory: { ...options.victory } };
        expect(copy.victory).toEqual(options.victory);
        // Mutating the copy's nested object must not affect the original.
        copy.victory.economyPercent = 99;
        expect(options.victory.economyPercent).toBe(60);
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
            victory: defaultVictoryConditions(),
            colonization: defaultColonizationOptions(),
            otherEmpires: defaultOtherEmpiresOptions(),
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

describe('pirate proximity / strength (Start.1.cs method_190, 3722-3736)', () => {
    it('maps the proximity combo and the strength slider', () => {
        expect([0, 1, 2, 3, -1].map(pirateProximityFor)).toEqual([0, 1, 2, 0, 0]);
        expect([0, 1, 2, 3, 4].map(pirateShipMaintenanceFactorFor)).toEqual([1.0, 0.7, 0.4, 0.25, 0.4]);
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

describe('defaultVictoryConditions (task 06g, VictoryConditions.cs + Start.InitializeComponent.cs)', () => {
    it('matches the C# defaults: all types unchecked, percents 33, time limit 10y, time start 3y, events on, threshold 1.0', () => {
        expect(defaultVictoryConditions()).toEqual({
            territory: false,
            territoryPercent: 33,
            population: false,
            populationPercent: 33,
            economy: false,
            economyPercent: 33,
            timeLimit: false,
            timeLimitYears: 10,
            startDateYears: 3,
            enableDisasterEvents: true,
            enableRaceSpecificConditions: true,
            enableRaceSpecificEvents: true,
            victoryThresholdPercentage: 1.0,
        });
    });

    it('exposes the wizard control bounds from Start.InitializeComponent.cs', () => {
        expect(VICTORY_PERCENT_MIN).toBe(1);
        expect(VICTORY_TIME_LIMIT_YEARS_MIN).toBe(1);
        expect(VICTORY_TIME_LIMIT_YEARS_MAX).toBe(1000);
        expect(VICTORY_TIME_START_YEARS_MIN).toBe(1);
        expect(VICTORY_TIME_START_YEARS_MAX).toBe(99);
    });
});

describe('clampVictory (task 06g)', () => {
    it('clamps percentages up to the minimum of 1', () => {
        const v = { ...defaultVictoryConditions(), territoryPercent: 0, populationPercent: -5 };
        const c = clampVictory(v);
        expect(c.territoryPercent).toBe(1);
        expect(c.populationPercent).toBe(1);
        // Economy percent is untouched when already in range.
        expect(c.economyPercent).toBe(33);
    });

    it('clamps the time limit into 1..1000 years', () => {
        expect(clampVictory({ ...defaultVictoryConditions(), timeLimitYears: 0 }).timeLimitYears).toBe(1);
        expect(clampVictory({ ...defaultVictoryConditions(), timeLimitYears: 2000 }).timeLimitYears).toBe(1000);
        expect(clampVictory({ ...defaultVictoryConditions(), timeLimitYears: 10 }).timeLimitYears).toBe(10);
    });

    it('clamps the time start into 1..99 years', () => {
        expect(clampVictory({ ...defaultVictoryConditions(), startDateYears: 0 }).startDateYears).toBe(1);
        expect(clampVictory({ ...defaultVictoryConditions(), startDateYears: 150 }).startDateYears).toBe(99);
        expect(clampVictory({ ...defaultVictoryConditions(), startDateYears: 3 }).startDateYears).toBe(3);
    });

    it('returns a copy and leaves booleans unchanged', () => {
        const v = { ...defaultVictoryConditions(), territory: true, enableDisasterEvents: false };
        const c = clampVictory(v);
        expect(c).not.toBe(v);
        expect(c.territory).toBe(true);
        expect(c.enableDisasterEvents).toBe(false);
        expect(c.victoryThresholdPercentage).toBe(1.0);
    });
});

describe('defaultColonizationOptions (task 06h, fixed wizdefaults: Main.Part9.cs 2674-2675)', () => {
    it('matches the C# default StartGameOptions: enforcement on, range 2000 Kly (2 sectors), influence 100 %, same-system off', () => {
        expect(defaultColonizationOptions()).toEqual({
            enforceRangeLimits: true,
            colonizationRangeKly: 2000,
            colonyInfluenceRangePercent: 100,
            allowSameSystemAsOtherEmpires: false,
        });
    });

    it('exposes the wizard slider bounds from Start.InitializeComponent.cs', () => {
        expect(COLONIZATION_RANGE_KLY_MIN).toBe(500);
        expect(COLONIZATION_RANGE_KLY_MAX).toBe(5000);
        expect(COLONY_INFLUENCE_RANGE_PCT_MIN).toBe(10);
        expect(COLONY_INFLUENCE_RANGE_PCT_MAX).toBe(200);
    });
});

describe('clampColonization (task 06h)', () => {
    it('clamps the colonization range into 500..5000 Kly', () => {
        expect(clampColonization({ ...defaultColonizationOptions(), colonizationRangeKly: 100 }).colonizationRangeKly).toBe(500);
        expect(clampColonization({ ...defaultColonizationOptions(), colonizationRangeKly: 9000 }).colonizationRangeKly).toBe(5000);
        expect(clampColonization({ ...defaultColonizationOptions(), colonizationRangeKly: 4000 }).colonizationRangeKly).toBe(4000);
    });

    it('clamps the colony influence range into 10..200 %', () => {
        expect(clampColonization({ ...defaultColonizationOptions(), colonyInfluenceRangePercent: 1 }).colonyInfluenceRangePercent).toBe(10);
        expect(clampColonization({ ...defaultColonizationOptions(), colonyInfluenceRangePercent: 500 }).colonyInfluenceRangePercent).toBe(200);
        expect(clampColonization({ ...defaultColonizationOptions(), colonyInfluenceRangePercent: 100 }).colonyInfluenceRangePercent).toBe(100);
    });

    it('returns a copy and leaves booleans unchanged', () => {
        const c = { ...defaultColonizationOptions(), enforceRangeLimits: true, allowSameSystemAsOtherEmpires: true };
        const clamped = clampColonization(c);
        expect(clamped).not.toBe(c);
        expect(clamped.enforceRangeLimits).toBe(true);
        expect(clamped.allowSameSystemAsOtherEmpires).toBe(true);
    });
});

describe('defaultOtherEmpiresOptions (task 06h)', () => {
    it('defaults to auto-generate on with 10 starting empires and an empty manual list', () => {
        expect(defaultOtherEmpiresOptions()).toEqual({
            autogenerate: true,
            empireCount: 10,
            manual: [],
        });
    });

    it('exposes the empire-count control bounds', () => {
        expect(OTHER_EMPIRES_COUNT_MIN).toBe(0);
        expect(OTHER_EMPIRES_COUNT_MAX).toBe(100);
    });
});

describe('clampOtherEmpires (task 06h)', () => {
    it('clamps the empire count into 0..100', () => {
        expect(clampOtherEmpires({ ...defaultOtherEmpiresOptions(), empireCount: -3 }).empireCount).toBe(0);
        expect(clampOtherEmpires({ ...defaultOtherEmpiresOptions(), empireCount: 250 }).empireCount).toBe(100);
        expect(clampOtherEmpires({ ...defaultOtherEmpiresOptions(), empireCount: 10 }).empireCount).toBe(10);
    });

    it('returns a copy and leaves the autogenerate flag unchanged', () => {
        const o = { ...defaultOtherEmpiresOptions(), autogenerate: false };
        const clamped = clampOtherEmpires(o);
        expect(clamped).not.toBe(o);
        expect(clamped.autogenerate).toBe(false);
    });

    it('deep-copies the manual list (task 06j)', () => {
        const row = { race: 'Human', governmentId: 3, name: 'Human Empire' };
        const o = { ...defaultOtherEmpiresOptions(), manual: [row] };
        const clamped = clampOtherEmpires(o);
        expect(clamped.manual).toEqual([row]);
        expect(clamped.manual[0]).not.toBe(row);
        // Mutating the copy's row must not affect the original.
        clamped.manual[0].name = 'Mutated';
        expect(o.manual[0].name).toBe('Human Empire');
    });
});

describe('manual empire list round-trip (task 06j)', () => {
    it('add/remove rows through StartGameOptions.otherEmpires.manual', () => {
        const options: StartGameOptions = defaultStartGameOptions();
        expect(options.otherEmpires.manual).toHaveLength(0);
        // Add two rows (wizard "Add empire" button behaviour).
        options.otherEmpires.manual.push({ race: 'Evuck', governmentId: -1, name: 'Evuck Empire' });
        options.otherEmpires.manual.push({ race: 'Ackdarian', governmentId: 5, name: '' });
        expect(options.otherEmpires.manual).toHaveLength(2);
        // Remove the first one (wizard ✕ button behaviour).
        options.otherEmpires.manual.splice(0, 1);
        expect(options.otherEmpires.manual).toHaveLength(1);
        expect(options.otherEmpires.manual[0].race).toBe('Ackdarian');
    });

    it('round-trips manual rows through a deep copy without aliasing', () => {
        const options: StartGameOptions = defaultStartGameOptions();
        options.otherEmpires.manual = [{ race: 'Human', governmentId: 2, name: 'Human Empire' }];
        const copy = {
            ...options,
            otherEmpires: { ...options.otherEmpires, manual: options.otherEmpires.manual.map((m) => ({ ...m })) },
        };
        expect(copy.otherEmpires.manual).toEqual(options.otherEmpires.manual);
        copy.otherEmpires.manual[0].name = 'Mutated';
        expect(options.otherEmpires.manual[0].name).toBe('Human Empire');
    });
});

describe('wizard page order (task 06h, Start.InitializeComponent.cs navigation)', () => {
    it('follows the original order: The Galaxy → Colonization and Territory → Your Race → Your Empire → Other Empires → Victory Conditions → (mod layer: Scenario) → Start', () => {
        expect(WIZARD_PAGES).toEqual(['galaxy', 'colonization', 'race', 'empire', 'empires', 'victory', 'scenario', 'start']);
    });

    it('titles each page after its original panel name', () => {
        expect(WIZARD_PAGE_TITLES).toEqual({
            galaxy: 'The Galaxy',
            colonization: 'Colonization and Territory',
            race: 'Your Race',
            empire: 'Your Empire',
            empires: 'Other Empires',
            victory: 'Victory Conditions',
            scenario: 'Scenario',
            start: 'Start',
        });
    });

    it('back labels point at the previous page in that order', () => {
        expect(WIZARD_BACK_LABELS).toEqual({
            galaxy: '← Main Menu',
            colonization: '← The Galaxy',
            race: '← Colonization and Territory',
            empire: '← Your Race',
            empires: '← Your Empire',
            victory: '← Other Empires',
            scenario: '← Victory Conditions',
            start: '← Scenario',
        });
    });

    it('forward labels name the next page in that order, except the final page, which starts the game', () => {
        expect(WIZARD_FORWARD_LABELS).toEqual({
            galaxy: 'Colonization and Territory →',
            colonization: 'Your Race →',
            race: 'Your Empire →',
            empire: 'Other Empires →',
            empires: 'Victory Conditions →',
            victory: 'Scenario →',
            scenario: 'Start →',
            start: 'Start Game',
        });
    });
});

describe('toCreateGameOptions (task 06i)', () => {
    let gameData: GameData;
    beforeAll(async () => {
        gameData = await loadGameDataFs();
    }, 60000);

    const NAMES = ['Alpha', 'Beta', 'Gamma'];

    it('maps the galaxy options through the slider converters', () => {
        const o = defaultStartGameOptions();
        o.seed = 12345;
        // Defaults: star index 3 -> 700, dimension index 2 -> 8x8.
        const c = toCreateGameOptions(o, gameData, NAMES);
        expect(c.shape).toBe(GalaxyShape.Spiral);
        expect(c.starCount).toBe(starCountFor(3));
        expect(c.sectorWidth).toBe(sectorsFor(2));
        expect(c.sectorHeight).toBe(sectorsFor(2));
        expect(c.systemNames).toBe(NAMES);
        expect(c.gameData).toBe(gameData);
        expect(c.colonyPrevalence).toBe(colonyPrevalenceFor(2));
    });

    it('maps the Pirates page onto piratePrevalence / pirateProximity / pirateShipMaintenanceFactor', () => {
        // Start.1.cs 3691 method_66, 3692 method_190, 3722-3736 strength switch; Start.2.cs 107 / 108 / 498.
        const d = toCreateGameOptions(defaultStartGameOptions(), gameData, NAMES);
        expect(d.piratePrevalence).toBe(0.4);
        expect(d.pirateProximity).toBe(1);
        expect(d.pirateShipMaintenanceFactor).toBe(0.4);
        const o = { ...defaultStartGameOptions(), piratesIndex: 5, pirateProximityIndex: 0, pirateStrengthIndex: 0 };
        const c = toCreateGameOptions(o, gameData, NAMES);
        expect(c.piratePrevalence).toBe(1.0);
        expect(c.pirateProximity).toBe(0);
        expect(c.pirateShipMaintenanceFactor).toBe(1.0);
        const none = toCreateGameOptions({ ...o, piratesIndex: 0 }, gameData, NAMES);
        expect(none.piratePrevalence).toBe(0.0);
        // Unset (older saves): Average proximity, strength 2.
        const legacy = { ...defaultStartGameOptions() } as StartGameOptions;
        delete legacy.pirateProximityIndex;
        delete legacy.pirateStrengthIndex;
        const l = toCreateGameOptions(legacy, gameData, NAMES);
        expect(l.pirateProximity).toBe(1);
        expect(l.pirateShipMaintenanceFactor).toBe(0.4);
    });

    it('passes the seed straight through', () => {
        const o = defaultStartGameOptions();
        o.seed = 987654321;
        expect(toCreateGameOptions(o, gameData, NAMES).seed).toBe(987654321);
    });

    it('builds the player empire from race / name / government', () => {
        const o = defaultStartGameOptions();
        o.raceName = 'Human';
        o.empireName = 'Human Empire';
        // Pick a real government by its parsed id so the name resolves.
        const govId = gameData.governments.findIndex((g) => g.name.length > 0);
        o.governmentId = govId;
        const c = toCreateGameOptions(o, gameData, NAMES);
        expect(c.player.race).toBe('Human');
        expect(c.player.name).toBe('Human Empire');
        expect(c.player.governmentStyle).toBe(gameData.governments[govId].name);
        expect(c.player.homeSystemFavourability).toBe('Normal');
        expect(c.player.startLocation).toBe('(Random)');
        // Tech level is fixed and supported (never the unported 0.5 "Normal").
        expect(c.player.techLevel).toBe(0.5);
        expect(c.player.age).toBe(1);
    });

    it('falls back to (Random) when no race or government is chosen', () => {
        const o = defaultStartGameOptions();
        o.raceName = '';
        o.governmentId = -1;
        const c = toCreateGameOptions(o, gameData, NAMES);
        expect(c.player.race).toBe('(Random)');
        expect(c.player.governmentStyle).toBe('(Random)');
    });

    it('sizes aiEmpires from the Other Empires count', () => {
        const o = defaultStartGameOptions();
        o.otherEmpires = { ...defaultOtherEmpiresOptions(), empireCount: 4 };
        const c = toCreateGameOptions(o, gameData, NAMES);
        expect(c.aiEmpires).toHaveLength(4);
        for (const ai of c.aiEmpires) {
            expect(ai.race).toBe('(Random)');
            expect(ai.proximityDistance).toBe('Random');
            expect(ai.homeSystemFavourability).toBe('Normal');
            expect(ai.techLevel).toBe(0.5);
        }
    });

    it('clamps an out-of-range AI empire count', () => {
        const o = defaultStartGameOptions();
        o.otherEmpires = { ...defaultOtherEmpiresOptions(), empireCount: 250 };
        expect(toCreateGameOptions(o, gameData, NAMES).aiEmpires).toHaveLength(OTHER_EMPIRES_COUNT_MAX);
    });

    it('maps a non-empty manual list to explicit aiEmpires (task 06j)', () => {
        // Pick two real start-available government ids so the names resolve.
        const govIds = gameData.governments
            .filter((g) => g.availability === 0 && g.specialFunctionCode === 0)
            .slice(0, 2)
            .map((g) => g.governmentId);
        const o = defaultStartGameOptions();
        o.otherEmpires = {
            ...defaultOtherEmpiresOptions(),
            autogenerate: false,
            empireCount: 4, // must be ignored — the manual list overrides
            manual: [
                { race: 'Human', governmentId: govIds[0] ?? -1, name: 'Human Empire' },
                { race: '', governmentId: -1, name: '' },
            ],
        };
        const c = toCreateGameOptions(o, gameData, NAMES);
        expect(c.aiEmpires).toHaveLength(2);
        expect(c.aiEmpires[0].name).toBe('Human Empire');
        expect(c.aiEmpires[0].race).toBe('Human');
        if (govIds[0] !== undefined) {
            expect(c.aiEmpires[0].governmentStyle).toBe(gameData.governments[govIds[0]].name);
        } else {
            expect(c.aiEmpires[0].governmentStyle).toBe('(Random)');
        }
        // Empty race / government / name fall back to (Random) / undefined.
        expect(c.aiEmpires[1].race).toBe('(Random)');
        expect(c.aiEmpires[1].governmentStyle).toBe('(Random)');
        expect(c.aiEmpires[1].name).toBeUndefined();
        for (const ai of c.aiEmpires) {
            expect(ai.homeSystemFavourability).toBe('Normal');
            expect(ai.proximityDistance).toBe('Random');
            expect(ai.techLevel).toBe(0.5);
        }
    });

    it('keeps auto-generation sizing when the manual list is empty (task 06j)', () => {
        const o = defaultStartGameOptions();
        o.otherEmpires = { ...defaultOtherEmpiresOptions(), autogenerate: false, empireCount: 3, manual: [] };
        const c = toCreateGameOptions(o, gameData, NAMES);
        expect(c.aiEmpires).toHaveLength(3);
        for (const ai of c.aiEmpires) {
            expect(ai.race).toBe('(Random)');
            expect(ai.name).toBeUndefined();
        }
    });

    it('maps the colonization same-system flag and influence factor', () => {
        const o = defaultStartGameOptions();
        o.colonization = {
            ...defaultColonizationOptions(),
            enforceRangeLimits: true,
            colonyInfluenceRangePercent: 150,
            allowSameSystemAsOtherEmpires: true,
        };
        const c = toCreateGameOptions(o, gameData, NAMES);
        expect(c.allowEmpiresInSameSystem).toBe(true);
        // Start.1.cs 3745: the slider percent / 100 (a factor, 1.5 here — not 150).
        expect(c.empireTerritoryColonyInfluenceRangeFactor).toBe(1.5);

        // Start.1.cs 3745 sets it regardless of the colonization-range enforcement checkbox.
        const o2 = defaultStartGameOptions();
        o2.colonization = { ...defaultColonizationOptions(), enforceRangeLimits: false };
        const c2 = toCreateGameOptions(o2, gameData, NAMES);
        expect(c2.allowEmpiresInSameSystem).toBe(false);
        expect(c2.empireTerritoryColonyInfluenceRangeFactor).toBe(1);
    });
});
