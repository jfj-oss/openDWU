// Galaxy.5.cs ResolveWonderDescription / ResolvePirateFacilityDescription / ResolvePlanetaryFacilityLines
// (sim/construction/facilityText.ts) against facilities.txt + GameText.txt, and the Habitat.cs 2127-2130
// "Wonder Build" title / message format.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Facility } from '../src/sim/data/facilities';
import { resolvePirateFacilityDescription, resolvePlanetaryFacilityLines, resolveWonderDescription } from '../src/sim/construction/facilityText';
import { formatGameTextNow, getText, isTextLoaded } from '../src/sim/textResolver';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

const byName = (name: string): Facility => {
    const f = gameData.facilities.find((x) => x.name === name);
    if (!f) throw new Error(`no facility ${name}`);
    return f;
};

describe('ResolveWonderDescription', () => {
    it('GameText is loaded', () => {
        expect(isTextLoaded()).toBe(true);
    });

    it('lists description, development bonus, the wonder bonus and maintenance (ColonyIncome)', () => {
        const f = byName('Traders Bazaar'); // 8 = Wonder, WonderType 11 ColonyIncome, 10000 maintenance, 20 / 30
        expect(resolveWonderDescription(f)).toBe(
            [
                f.description,
                `${getText('Colony Development Bonus')}: +20%`,
                `${getText('Colony Income')}: +30%`,
                `${getText('Facility Maintenance Cost')}: 10,000 ${getText('credits')}`,
            ].join('\n'),
        );
    });

    it('formats ColonyDefense as Value2 * 10 and construction speed through "X% faster"', () => {
        expect(resolveWonderDescription(byName('Merkidor Planetary Fortress'))).toContain(`${getText('Colony Defense')}: +200%`);
        expect(resolveWonderDescription(byName('Bakuras Highspeed Shipyards'))).toContain(
            `${getText('Construction Speed')}: ${formatGameTextNow('X% faster', ['+200'])}`,
        );
    });

    it('RaceAchievement wonders have no bonus line; maintenance is line 3', () => {
        const f = byName('Galactic Archives');
        expect(resolveWonderDescription(f).split('\n')).toEqual([
            f.description,
            `${getText('Colony Development Bonus')}: +50%`,
            `${getText('Facility Maintenance Cost')}: 20,000 ${getText('credits')}`,
        ]);
    });

    it('omits the build-once / location notes (includeExtraWonderNotes: false) but the full lines carry them', () => {
        const f = byName('Lava Palace Resort'); // Value3 = 6: a location requirement
        expect(resolveWonderDescription(f)).not.toContain(getText('Note that each wonder may only be built once in the galaxy'));
        const full = resolvePlanetaryFacilityLines(f, true).descriptions[1]!;
        expect(full).toContain(getText('Note that each wonder may only be built once in the galaxy'));
        expect(full).toContain('. ');
    });

    it('is empty for a non-wonder facility or null', () => {
        expect(resolveWonderDescription(byName('Hidden Pirate Base'))).toBe('');
        expect(resolveWonderDescription(null)).toBe('');
    });

    it('builds the Habitat.cs 2127-2129 title and message', () => {
        const f = byName('Traders Bazaar');
        const title = formatGameTextNow('Wonder Build Title', [f.name]) + '!';
        expect(title).toBe(`${f.name} built!`);
        const message = formatGameTextNow('Wonder Build Description', [f.name, 'Kalimar', resolveWonderDescription(f)]);
        expect(message.startsWith(`We have completed construction of the ${f.name} at our colony Kalimar!`)).toBe(true);
        expect(message.endsWith(`10,000 ${getText('credits')}`)).toBe(true);
    });
});

describe('ResolvePirateFacilityDescription', () => {
    it('description, a blank block, then the lines (which repeat the description, as the C# does)', () => {
        const f = byName('Hidden Pirate Base');
        expect(resolvePirateFacilityDescription(f)).toBe(
            [
                f.description + '\n\n\n\n' + f.description,
                `${getText('Empire Research Bonus')}: +${f.value1}%`,
                `${getText('Colony Income Bonus')}: +${f.value2}%`,
                `${getText('Colony Corruption')}: +${f.value3}%`,
            ].join('\n'),
        );
    });

    it('is empty for a wonder', () => {
        expect(resolvePirateFacilityDescription(byName('Traders Bazaar'))).toBe('');
    });
});
