// Empire Summary screen model (src/ui/screens/empireSummaryModel.ts): the pure parts of the EmpireSummaryColony /
// EmpireSummaryBuiltObject / EmpireSummaryBonuses ports, plus a smoke run over the seed-1 harness game.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearText, loadText } from '../src/sim/textResolver';
import {
    SHIP_COLUMNS,
    SUMMARY_COLORS,
    abilityBonusLines,
    bonusLines,
    colonyStatRows,
    formatFirepower,
    governmentRows,
    leaderBonusDescription,
    modifierColor,
    orderedNumberDescription,
    percentOrNormal,
    pirateModifierLines,
    rankText,
    revolutionButtonState,
    shipRoleStats,
    shipRowLabel,
    warWearinessColor,
    warWearinessDescription,
} from '../src/ui/screens/empireSummaryModel';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { PiratePlayStyle } from '../src/sim/pirates';
import type { Government } from '../src/sim/data/governments';
import type { BuiltObject } from '../src/sim/builtObject';
import type { Empire } from '../src/sim/empire';
import type { Character } from '../src/sim/characters';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';

beforeAll(() => {
    loadText(readFileSync(resolve(__dirname, '../public/assets/dwu/GameText.txt'), 'utf-8'));
});
afterAll(() => clearText());

describe('formats', () => {
    it('OrderedNumberDescription', () => {
        expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(orderedNumberDescription)).toEqual([
            '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th', '112th',
        ]);
        expect(rankText(0, 5)).toBe('(1st of 5)');
    });
    it('"+#0%;-#0%;Normal" shows Normal when it rounds to zero', () => {
        expect(percentOrNormal(0)).toBe('Normal');
        expect(percentOrNormal(0.004)).toBe('Normal');
        expect(percentOrNormal(0.25)).toBe('+25%');
        expect(percentOrNormal(-0.3)).toBe('-30%');
    });
    it('war weariness description and colour bands', () => {
        expect(warWearinessDescription(0)).toBe('None');
        expect(warWearinessDescription(5)).toBe('Mild');
        expect(warWearinessDescription(40)).toBe('Rampant');
        expect(warWearinessColor(0)).toBe(SUMMARY_COLORS.text);
        expect(warWearinessColor(3)).toBe('rgb(255, 255, 0)');
        expect(warWearinessColor(50)).toBe('rgb(255, 0, 0)');
    });
    it('modifier colours (method_5)', () => {
        expect(modifierColor(0, true)).toBe(SUMMARY_COLORS.text);
        expect(modifierColor(0.1, true)).toBe(SUMMARY_COLORS.green);
        expect(modifierColor(-0.1, true)).toBe(SUMMARY_COLORS.red);
        expect(modifierColor(0.1, false)).toBe(SUMMARY_COLORS.red);
        expect(modifierColor(-0.1, false)).toBe(SUMMARY_COLORS.green);
    });
    it('firepower switches to K at 100,000', () => {
        expect(formatFirepower(99999)).toBe('99999');
        expect(formatFirepower(150000)).toBe('150K');
    });
});

describe('government rows', () => {
    const gov = {
        name: 'Feudalism', warWeariness: 0.8, maintenanceCosts: 0.9, approvalRating: 0.9, populationGrowth: 1,
        researchSpeed: 0.75, troopRecruitment: 1.4, corruption: 1, tradeBonus: 1,
    } as Government;
    it('lists the eight attributes in the original order with their colours', () => {
        const rows = governmentRows(gov);
        expect(rows.map((r) => r.label)).toEqual([
            'War weariness', 'Maintenance costs', 'Approval', 'Growth rate', 'Research speed', 'Troop recruitment', 'Corruption', 'Colony Income',
        ]);
        expect(rows[0]).toEqual({ label: 'War weariness', value: '-20%', color: SUMMARY_COLORS.green });
        expect(rows[2].color).toBe(SUMMARY_COLORS.red);
        expect(rows[3].value).toBe('Normal');
        expect(rows[5]).toMatchObject({ value: '+40%', color: SUMMARY_COLORS.green });
    });
    it('revolution button text and state', () => {
        const e = { governmentId: 1, dominantRace: { name: 'Human', canChangeGovernment: true } } as unknown as Empire;
        expect(revolutionButtonState(e, -1, null)).toEqual({ text: 'Have Revolution and switch government', enabled: false });
        expect(revolutionButtonState(e, 1, 'Monarchy').enabled).toBe(false);
        expect(revolutionButtonState(e, 3, 'Feudalism')).toEqual({ text: 'Have Revolution and switch to Feudalism', enabled: true });
        const locked = { governmentId: 1, dominantRace: { name: 'Shakturi', canChangeGovernment: false } } as unknown as Empire;
        expect(revolutionButtonState(locked, 3, 'Feudalism')).toEqual({ text: '(Shakturi race cannot change government)', enabled: false });
    });
});

describe('ships & bases', () => {
    const ship = (subRole: BuiltObjectSubRole, firepowerRaw: number, annualSupportCost: number, unbuilt = 0) =>
        ({ subRole, firepowerRaw, annualSupportCost, unbuiltComponentCount: unbuilt }) as unknown as BuiltObject;
    it('counts all, sums firepower / maintenance of completed ones, less the maintenance savings', () => {
        const list = [ship(BuiltObjectSubRole.Escort, 20, 1000), ship(BuiltObjectSubRole.Escort, 30, 1000, 2), ship(BuiltObjectSubRole.Frigate, 50, 2000)];
        expect(shipRoleStats(list, [BuiltObjectSubRole.Escort], 0)).toEqual({ count: 2, firepower: 20, maintenance: 1000 });
        expect(shipRoleStats(list, null, 0.15)).toEqual({ count: 3, firepower: 70, maintenance: 3000 - 450 });
    });
    it('column layout and row labels', () => {
        expect(SHIP_COLUMNS.map((c) => c.rows.length)).toEqual([8, 10, 8]);
        expect(shipRowLabel(SHIP_COLUMNS[1].rows[7])).toBe('Research Station');
        expect(shipRowLabel(SHIP_COLUMNS[1].rows[9])).toBe('Other Bases');
        expect(shipRowLabel(SHIP_COLUMNS[0].rows[0])).toBe('Escort');
    });
});

describe('bonuses', () => {
    it('race ability bonuses (ResolveEmpireAbilityBonusDescriptions)', () => {
        const human = { name: 'Human', pictureIndex: 7 };
        const e = {
            dominantRace: human,
            shipMaintenanceSavings: 0, shipMaintenanceSavingsRace: null,
            resourceExtractionBonus: 0, resourceExtractionBonusRace: null,
            researchBonus: 0.15, researchBonusRace: human,
            espionageBonus: 0, espionageBonusRace: null,
            tradeBonus: 0.1, tradeBonusRace: { name: 'Teekan', pictureIndex: 3 },
        } as unknown as Empire;
        expect(abilityBonusLines(e, true).map((l) => l.text)).toEqual([
            'Gifted Scientists: faster research +15% (from Human)',
            'Natural Merchants: colony income +10% (from Teekan)',
        ]);
        expect(abilityBonusLines(e, false)[0].text).toBe('Gifted Scientists: faster research +15%');
        expect(abilityBonusLines(e, true)[1].image).toEqual({ kind: 'race', pictureIndex: 3 });
    });
    it('leader bonus description', () => {
        const leader = { name: 'Basant', bonusesKnown: true, diplomacy: 0, colonyIncome: 0, colonyHappiness: 0, populationGrowth: 0, tradeIncome: 10, tourismIncome: 0, colonyCorruption: -5, miningRate: 0, troopRecruitmentRate: 0, militaryShipConstructionSpeed: 0, civilianShipConstructionSpeed: 0, colonyShipConstructionSpeed: 0, facilityConstructionSpeed: 0, researchEnergy: 0, researchHighTech: 0, researchWeapons: 0, espionage: 0, counterEspionage: 0, militaryShipMaintenance: 0, militaryBaseMaintenance: 0, civilianShipMaintenance: 0, civilianBaseMaintenance: 0, troopMaintenance: 0, warWeariness: 0 } as unknown as Character;
        expect(leaderBonusDescription(leader)).toBe('Leader Basant: Trade Income +10%, Colony Corruption Reduction -5%');
        expect(leaderBonusDescription({ ...leader, bonusesKnown: false } as Character)).toBe('Leader Basant: ?');
        expect(leaderBonusDescription(null)).toBe('');
    });
    it('pirate faction modifiers (Balanced has none)', () => {
        expect(pirateModifierLines(PiratePlayStyle.Balanced)).toEqual([]);
        const smuggler = pirateModifierLines(PiratePlayStyle.Smuggler);
        expect(smuggler[0].text).toMatch(/\+50%$/);
        expect(smuggler[0].color).toBe(SUMMARY_COLORS.green);
    });
});

describe('harness game', () => {
    it('builds every block for the player empire', async () => {
        const galaxy = cachedTickGame(await loadGameDataFs()).galaxy;
        const player = galaxy.playerEmpire!;
        const rows = colonyStatRows(galaxy, player);
        expect(rows.map((r) => r.label)).toEqual(['Capitals', 'Territory', 'Population', 'Strategic Value', 'Reputation', 'War weariness', 'Troops', 'Intelligence Agents']);
        expect(rows[1].value).toMatch(/^\d+ colonies in \d+ systems$/);
        expect(rows[1].rank).toMatch(/^\(\d+(st|nd|rd|th) of \d+\)$/);
        expect(rows[2].value).toMatch(/^\d+M$/);
        expect(Array.isArray(bonusLines(galaxy, player))).toBe(true);
        const total = shipRoleStats(player.builtObjects, null, 0).count;
        expect(total).toBe(player.builtObjects.length);
    });
});
