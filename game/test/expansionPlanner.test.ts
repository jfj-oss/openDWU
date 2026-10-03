// Task 16a: Expansion Planner pure helpers (no jsdom).
import { describe, expect, it } from 'vitest';
import type { Ruin } from '../src/sim/ruins';
import { HabitatCategoryType, HabitatType } from '../src/sim/types';
import {
    calculateResourceDemand,
    countResourceSupplyForEmpire,
    deficientResourceRows,
    expansionModeLabel,
    filterTargetsByPercent,
    filterTargetsByResource,
    formatAmountK,
    formatHash,
    formatPrice,
    plannerActionState,
    plannerAvailableShips,
    plannerBuildState,
    plannerModeTexts,
    plannerSelectionColor,
    resolveResourceSupplyLocations,
    formatMillionsM,
    habitatCategoryDescription,
    habitatTypeDescription,
    plannerStatus,
    qualityPercent,
    resourceRarity,
    resourcesDescription,
    ruinHasSpecialBonus,
    ruinText,
    type PlannerStatusInput,
} from '../src/ui/screens/expansionPlanner';
import { isKeyActionAvailable } from '../src/ui/keyboard';
import { pngFromBlob, resxDataBase64 } from '../src/ui/resxImage';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';

function ruin(fields: Partial<Record<string, unknown>>): Ruin {
    return {
        name: 'Ancient Temple',
        developmentBonus: 0,
        playerEmpireEncountered: false,
        bonusDefensive: 0,
        bonusDiplomacy: 0,
        bonusHappiness: 0,
        bonusResearchEnergy: 0,
        bonusResearchHighTech: 0,
        bonusResearchWeapons: 0,
        bonusWealth: 0,
        ...fields,
    } as unknown as Ruin;
}

describe('expansion planner labels', () => {
    it('mode labels', () => {
        expect(expansionModeLabel('colonies')).toBe('Potential Colonies');
        expect(expansionModeLabel('resourcessupply')).toBe('Your Empire Resource Locations');
    });

    it('habitat type descriptions', () => {
        expect(habitatTypeDescription(HabitatType.Continental, HabitatCategoryType.Planet)).toBe('Continental Planet');
        expect(habitatTypeDescription(HabitatType.MarshySwamp, HabitatCategoryType.Moon)).toBe('Marshy Swamp Moon');
        expect(habitatTypeDescription(HabitatType.BarrenRock, HabitatCategoryType.Asteroid)).toBe('Asteroid');
        expect(habitatTypeDescription(HabitatType.Ice, HabitatCategoryType.Asteroid)).toBe('Ice Asteroid');
        expect(habitatCategoryDescription(HabitatCategoryType.GasCloud)).toBe('Gas Cloud');
    });

    it('resources description', () => {
        const names = (id: number) => (id === 1 ? 'Iron' : id === 2 ? 'Gold' : '');
        expect(resourcesDescription([{ resourceId: 1, abundance: 125 }], false, names)).toBe('(Unknown resources)');
        expect(resourcesDescription([], true, names)).toBe('(No resources)');
        expect(
            resourcesDescription(
                [
                    { resourceId: 1, abundance: 125 },
                    { resourceId: 2, abundance: 30 },
                ],
                true,
                names,
            ),
        ).toBe('Iron (13%), Gold (3%)');
    });

    it('resource rarity', () => {
        const sup = (id: number) => id === 9;
        const lux = (id: number) => id === 5 || id === 9;
        expect(resourceRarity([], sup, lux)).toBe('C');
        expect(resourceRarity([{ resourceId: 1 }, { resourceId: 5 }], sup, lux)).toBe('R');
        expect(resourceRarity([{ resourceId: 5 }, { resourceId: 9 }], sup, lux)).toBe('VR');
    });

    it('ruin text', () => {
        expect(ruinText(null)).toBe('');
        expect(ruinText(ruin({ developmentBonus: 0.12 }))).toBe('Ancient Temple (+12%)');
        expect(ruinText(ruin({ developmentBonus: -0.034 }))).toBe('Ancient Temple (-3%)');
        expect(ruinText(ruin({ developmentBonus: 0 }))).toBe('Ancient Temple (0%)');
    });

    it('number formats', () => {
        expect(formatMillionsM(2_600_000_000)).toBe('2600M');
        expect(formatMillionsM(0)).toBe('0M');
        expect(qualityPercent(0.5)).toBe('50%');
    });

    it('special ruins', () => {
        expect(ruinHasSpecialBonus(null)).toBe(false);
        expect(ruinHasSpecialBonus(ruin({ bonusWealth: 1 }))).toBe(false);
        expect(ruinHasSpecialBonus(ruin({ bonusWealth: 1, playerEmpireEncountered: true }))).toBe(true);
    });
});

describe('plannerStatus ladder', () => {
    const base: PlannerStatusInput = {
        forColonization: true,
        inRange: true,
        specialRuins: false,
        superLuxuryKnown: false,
        inOurSystem: false,
        quality: 0.6,
        nearPirateBase: false,
        territoryOk: true,
        canColonizeBecauseAtWar: false,
        colonizationLikeliness: 0,
        techSurvivesStorms: true,
        shipsSurviveStorms: true,
        inStorm: false,
        dangerous: false,
        category: HabitatCategoryType.Planet,
    };
    const st = (o: Partial<PlannerStatusInput>) => plannerStatus({ ...base, ...o });

    it('no match', () => {
        expect(st({})).toEqual({ color: null, reason: '' });
    });
    it('range first', () => {
        expect(st({ inRange: false })).toEqual({ color: 0xc03030, reason: 'Too far from existing colonies' });
        expect(st({ inRange: false, specialRuins: true })).toEqual({ color: 0xc03030, reason: 'Too far from existing colonies' });
    });
    it('special ruins / luxury', () => {
        expect(st({ specialRuins: true })).toEqual({ color: 0x6060ff, reason: 'Special ruins at this planet!' });
        expect(st({ superLuxuryKnown: true }).reason).toBe('Special luxury resources at this planet!');
    });
    it('our system', () => {
        expect(st({ inOurSystem: true })).toEqual({ color: 0x00c000, reason: 'Planet is in one of our systems' });
        expect(st({ inOurSystem: true, quality: 0.4 })).toEqual({ color: 0xe08000, reason: 'Low quality makes colonization undesirable' });
        expect(st({ forColonization: false, inOurSystem: true }).reason).toBe('Planet is in one of our systems');
    });
    it('pirates / territory / likeliness', () => {
        expect(st({ nearPirateBase: true })).toEqual({ color: 0xc0c000, reason: 'Pirate base in this system' });
        expect(st({ forColonization: false, territoryOk: false }).reason).toBe("Mining location in another empire's system");
        expect(st({ colonizationLikeliness: -5 }).reason).toBe('Colonization unlikely due to hostile population');
        expect(st({ colonizationLikeliness: -4 })).toEqual({ color: null, reason: '' });
    });
    it('storms / danger', () => {
        expect(st({ inStorm: true, techSurvivesStorms: false }).reason).toBe('Galactic storm makes colonization hazardous');
        expect(st({ inStorm: true, techSurvivesStorms: true })).toEqual({ color: null, reason: '' });
        expect(st({ forColonization: false, inStorm: true, shipsSurviveStorms: false }).reason).toBe(
            'Galactic storm makes construction hazardous',
        );
        expect(st({ dangerous: true }).reason).toBe('Our last scan of this location showed nearby pirates or space monsters');
    });
});

describe('keyboard', () => {
    it('F3 is implemented', () => {
        expect(isKeyActionAvailable('expansionPlannerScreen')).toBe(true);
    });
});

describe('expansion planner filters (Main.Part4.cs method_534 / method_535 / FilterOutHabitatPrioritizationList)', () => {
    const t = (name: string, resources: { resourceId: number; abundance: number }[]) => ({ name, habitat: { resources } });
    const list = [t('a', []), t('b', [{ resourceId: 1, abundance: 300 }]), t('c', [{ resourceId: 2, abundance: 50 }, { resourceId: 1, abundance: 40 }]), t('d', [{ resourceId: 3, abundance: 900 }])];
    const known = (h: { resources: readonly unknown[] }) => h !== list[3].habitat;

    it('resource filter', () => {
        expect(filterTargetsByResource(list, 'all', known, new Set()).map((x) => x.name)).toEqual(['a', 'b', 'c', 'd']);
        expect(filterTargetsByResource(list, 1, known, new Set()).map((x) => x.name)).toEqual(['b', 'c']);
        expect(filterTargetsByResource(list, 3, known, new Set()).map((x) => x.name)).toEqual([]); // resources unknown
        expect(filterTargetsByResource(list, 'critical', known, new Set([2])).map((x) => x.name)).toEqual(['c']);
    });

    it('percent filter', () => {
        expect(filterTargetsByPercent(list, { enabled: false, percentage: 1000, resourceId: null })).toHaveLength(4);
        expect(filterTargetsByPercent(list, { enabled: true, percentage: 200, resourceId: null }).map((x) => x.name)).toEqual(['a', 'b', 'd']);
        expect(filterTargetsByPercent(list, { enabled: true, percentage: 100, resourceId: 1 }).map((x) => x.name)).toEqual(['a', 'b', 'd']);
    });

    it('selection colours', () => {
        expect(plannerSelectionColor(0xc03030)).toBe(0xff1818);
        expect(plannerSelectionColor(0x00c000)).toBe(0x00ff00);
        expect(plannerSelectionColor(null)).toBeNull();
    });
});

describe('expansion planner buttons (RyphEufuaW / method_161)', () => {
    const base = { target: { name: 'Eden', assigned: false }, shipName: 'Seeder', shipCount: 1, canBuildHere: true, inRange: true };
    it('action button', () => {
        expect(plannerActionState('colonies', base)).toEqual({ text: 'Send Seeder to colonize Eden', enabled: true });
        expect(plannerActionState('colonies', { ...base, inRange: false })).toEqual({ text: 'Cannot Colonize', enabled: false });
        expect(plannerActionState('colonies', { ...base, shipName: null })).toEqual({ text: '(No Colony ship selected)', enabled: false });
        expect(plannerActionState('colonies', { ...base, shipName: null, shipCount: 0 })).toEqual({ text: '(No Colony ships available)', enabled: false });
        expect(plannerActionState('colonies', { ...base, target: null })).toEqual({ text: '(No colony target selected)', enabled: false });
        expect(plannerActionState('colonies', { ...base, target: { name: 'Eden', assigned: true } }).text).toBe('(Colony Ship already assigned)');
        expect(plannerActionState('resourcesyou', base)).toEqual({ text: 'Send Seeder to build a mining station at Eden', enabled: true });
        expect(plannerActionState('resourcesgalaxy', { ...base, canBuildHere: false })).toEqual({ text: '(Cannot build here)', enabled: false });
        expect(plannerActionState('resourcesyou', { ...base, target: null }).text).toBe('(Cannot build here)');
        expect(plannerActionState('resourcesyou', { ...base, shipName: null }).text).toBe('(No Construction ship selected)');
        expect(plannerActionState('resourcessupply', base)).toEqual({ text: '', enabled: false });
    });
    it('build button', () => {
        const b = { hasTarget: true, assigned: false, money: 20000, price: 13998.4, canColonize: true };
        expect(plannerBuildState('colonies', b)).toEqual({ text: 'Build and Send Colony Ship (13998 credits)', enabled: true });
        expect(plannerBuildState('colonies', { ...b, hasTarget: false }).enabled).toBe(false);
        expect(plannerBuildState('colonies', { ...b, money: 100 })).toEqual({ text: 'Build and Send Colony Ship (not enough money)', enabled: false });
        expect(plannerBuildState('colonies', { ...b, canColonize: false }).text).toBe('Cannot Build Colony Ship for this target');
        expect(plannerBuildState('colonies', { ...b, assigned: true }).text).toBe('(Colony Ship already assigned)');
        expect(plannerBuildState('resourcesyou', b)).toEqual({ text: 'Queue nearest Construction Ship to build Mining Station here', enabled: true });
        expect(plannerBuildState('resourcesgalaxy', { ...b, assigned: true }).text).toBe('(Construction Ship already assigned)');
        expect(plannerBuildState('resourcessupply', b)).toEqual({ text: '', enabled: false });
    });
    it('mode texts and formats', () => {
        expect(plannerModeTexts('colonies', true).map).toBe('Location of Potential Colony and Colony Ship');
        expect(plannerModeTexts('resourcesyou', false)).toEqual({
            available: 'Available Construction ships',
            map: 'Location of Resource Target',
            select: 'Select Resource Target',
            goto: 'Go to Resource Target',
        });
        expect(plannerModeTexts('resourcessupply', false).available).toBe('');
        expect(formatHash(0)).toBe('');
        expect(formatHash(12.6)).toBe('13');
        expect(formatPrice(3.25)).toBe('3.3');
        expect(formatAmountK(12345)).toBe('12.3K');
    });
});

describe('resx image extraction', () => {
    it('finds the data value and cuts the PNG out of the blob', () => {
        const resx = '<root><data name="x.Image" type="t"><value>\n  QUJD\n  REVG\n</value></data></root>';
        expect(resxDataBase64(resx, 'x.Image')).toBe('QUJDREVG');
        expect(resxDataBase64(resx, 'y.Image')).toBeNull();
        // header junk + PNG signature + IHDR(0 length for the test) + IEND + trailing junk
        const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        const chunk = (type: string) => [0, 0, 0, 0, ...[...type].map((c) => c.charCodeAt(0)), 1, 2, 3, 4];
        const png = [...sig, ...chunk('IHDR'), ...chunk('IEND')];
        const blob = new Uint8Array([7, 7, 7, ...png, 11]);
        expect([...(pngFromBlob(blob) ?? [])]).toEqual(png);
        expect(pngFromBlob(new Uint8Array([1, 2, 3]))).toBeNull();
    });
});

describe('expansion planner sim queries (harness game)', () => {
    it('supply locations, deficient resources, demand and available ships', async () => {
        const gameData = await loadGameDataFs();
        const galaxy = cachedTickGame(gameData).galaxy;
        const player = galaxy.playerEmpire!;
        const locs = resolveResourceSupplyLocations(galaxy, player);
        expect(locs.length).toBeGreaterThan(0);
        for (let i = 1; i < locs.length; i++) expect(locs[i - 1].priority).toBeGreaterThanOrEqual(locs[i].priority);
        expect(new Set(locs.map((l) => l.habitat)).size).toBe(locs.length);
        for (const r of deficientResourceRows(galaxy, player)) {
            expect(r.name).not.toBe('');
            expect(r.stockYou).toBeGreaterThanOrEqual(0);
            expect(r.stockGalaxy).toBeGreaterThanOrEqual(r.stockYou);
            const you = calculateResourceDemand(galaxy, r.resourceId, player);
            const all = calculateResourceDemand(galaxy, r.resourceId, null);
            expect(all.demand).toBeGreaterThanOrEqual(you.demand);
            expect(countResourceSupplyForEmpire(player, r.resourceId)).toBe(r.stockYou);
        }
        for (const s of plannerAvailableShips(galaxy, player, 'resourcesyou', null)) expect(s.builtAt == null).toBe(true);
        expect(plannerAvailableShips(galaxy, player, 'colonies', null)).toEqual([]);
    });
});
