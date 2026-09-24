import { describe, expect, it } from 'vitest';
import { Tutorial, TUTORIALS, parseTutorialItems, tutorialSummary } from '../src/sim/data/tutorials';

// The screen/window DOM parts need a browser (jsdom is not configured here,
// see hud.test.ts), so this tests the pure parsing + model code (task 06l).

/** A multi-step sample in the original file format: steps separated by a
 * line `~`; each step = Name line, Title line, then body lines. */
const SAMPLE = [
    'Welcome',
    'Getting Started',
    'This is the first body line.',
    'And a second one.',
    '~',
    'Zooming',
    'Panning and Zooming',
    'Use the mouse wheel to zoom.',
    '~',
    'Selecting',
    'Selections',
    'Left-click to select.',
].join('\n');

describe('parseTutorialItems (Main.Part5.cs method_454)', () => {
    it('splits steps on the ~ separator line', () => {
        const items = parseTutorialItems('sample.txt', SAMPLE);
        expect(items.length).toBe(3);
    });

    it('reads Name/Title and accumulates body text with trailing newlines', () => {
        const items = parseTutorialItems('sample.txt', SAMPLE);
        expect(items[0].name).toBe('Welcome');
        expect(items[0].title).toBe('Getting Started');
        expect(items[0].text).toBe('This is the first body line.\nAnd a second one.\n');
        expect(items[1].name).toBe('Zooming');
        expect(items[1].title).toBe('Panning and Zooming');
        expect(items[1].text).toBe('Use the mouse wheel to zoom.\n');
        expect(items[2].name).toBe('Selecting');
        expect(items[2].title).toBe('Selections');
        expect(items[2].text).toBe('Left-click to select.\n');
    });

    it('trims Name and Title lines', () => {
        const items = parseTutorialItems('sample.txt', '  Name  \n  Title  \nbody\n');
        expect(items[0].name).toBe('Name');
        expect(items[0].title).toBe('Title');
        // Body lines are kept raw (method_454 appends them untrimmed); the
        // trailing newline of the input file adds one more empty body line.
        expect(items[0].text).toBe('body\n\n');
    });

    it('handles CRLF line endings', () => {
        const items = parseTutorialItems('sample.txt', 'A\r\nB\r\ntext\r\n~\r\nC\r\nD\r\ntwo');
        expect(items.length).toBe(2);
        expect(items[0].name).toBe('A');
        expect(items[0].title).toBe('B');
        expect(items[0].text).toBe('text\n');
        expect(items[1].name).toBe('C');
        expect(items[1].title).toBe('D');
        expect(items[1].text).toBe('two\n');
    });

    it('skips the Title line at EOF (single-line file)', () => {
        const items = parseTutorialItems('sample.txt', 'OnlyName');
        expect(items.length).toBe(1);
        expect(items[0].name).toBe('OnlyName');
        expect(items[0].title).toBe('');
        expect(items[0].text).toBe('');
    });

    it('wraps errors as "Error at line N reading file X"', () => {
        // Force an exception inside the parse loop.
        const exploding = { split(): never { throw new Error('boom'); } };
        expect(() => parseTutorialItems('bad.txt', exploding as unknown as string)).toThrow(
            /reading file bad\.txt/,
        );
    });
});

describe('Tutorial (DistantWorlds.Types.Tutorial)', () => {
    function makeTutorial(count: number): Tutorial {
        const t = new Tutorial();
        for (let i = 0; i < count; i++) {
            const item = parseTutorialItems('x.txt', `N${i}\nT${i}\n`)[0];
            t.items.push(item);
        }
        return t;
    }

    it('tracks lastStep / finished / currentStep through next()', () => {
        const t = makeTutorial(3);
        expect(t.lastStep).toBe(false);
        expect(t.finished).toBe(false);
        expect(t.currentStep?.name).toBe('N0');
        t.next();
        expect(t.index).toBe(1);
        expect(t.currentStep?.name).toBe('N1');
        t.next();
        expect(t.lastStep).toBe(true);
        expect(t.currentStep?.name).toBe('N2');
        t.next();
        expect(t.finished).toBe(true);
        expect(t.currentStep).toBeNull();
    });

    it('previousStep is null for single-item tutorials', () => {
        const t = makeTutorial(1);
        expect(t.previousStep).toBeNull();
    });

    it('previousStep returns items[Index] while 0 <= Index <= Count (and Count > 1)', () => {
        const t = makeTutorial(2);
        expect(t.previousStep?.name).toBe('N0');
        t.next();
        expect(t.previousStep?.name).toBe('N1');
        t.next();
        // Index == Count: items[Index] is out of range (undefined).
        expect(t.previousStep ?? null).toBeNull();
    });

    it('clearData empties the step list', () => {
        const t = makeTutorial(2);
        t.clearData();
        expect(t.items.length).toBe(0);
        expect(t.finished).toBe(true);
    });
});

describe('TUTORIALS list (Start.1.cs pnlTutorials)', () => {
    const REAL_FILES = [
        'basic.txt',
        'advanced.txt',
        'ShipsAndMissions.txt',
        'ResearchDesign.txt',
        'FleetsTroops.txt',
        'FindingYourWayAround.txt',
        'DealingWithPirates.txt',
        'PlayAsPirate.txt',
        'PreWarpEmpire.txt',
        'EmpireAndColonies.txt',
        'ExpansionDiplomacy.txt',
    ];

    it('covers every tutorial file served from /assets/dwu/Tutorial/', () => {
        expect(TUTORIALS.map((e) => e.file)).toEqual(REAL_FILES);
    });

    it('has a display name per entry', () => {
        for (const entry of TUTORIALS) {
            expect(entry.displayName.length).toBeGreaterThan(0);
        }
    });
});

describe('tutorialSummary', () => {
    // The real file format: Name line, Title line, body lines, `~` separator.
    const SUMMARY_SAMPLE = [
        'Welcome',
        'Welcome',
        'Body one.',
        '~',
        'Introduction',
        'Introduction',
        'Body two.',
        '~',
        'Introduction',
        'Introduction',
        'Body three.',
    ].join('\n');

    it('joins distinct step titles in order, skipping repeats', () => {
        const items = parseTutorialItems('sample.txt', SUMMARY_SAMPLE);
        expect(tutorialSummary(items)).toBe('Welcome · Introduction');
    });

    it('cuts at the last whole title that fits and appends " · …"', () => {
        const items = parseTutorialItems('sample.txt', SUMMARY_SAMPLE);
        expect(tutorialSummary(items, 10)).toBe('Welcome · …');
    });
});