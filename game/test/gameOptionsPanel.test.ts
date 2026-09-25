import { beforeEach, describe, expect, it } from 'vitest';
import {
    AUTOMATION_ROWS,
    MESSAGE_OPTION_ROWS,
    automationValue,
    messageRowValue,
    setAutomationValue,
    setMessageRowValue,
} from '../src/ui/screens/gameOptionsPanel';
import { getMessageOptions, MessageCategory, resetMessageOptions } from '../src/ui/messageRouting';
import { AutomationLevel, type Empire } from '../src/sim/empire';
import { isKeyActionAvailable } from '../src/ui/keyboard';

// Task 16d: Game Options rows (Main.Part6.cs:2524-2539, Main.Part3.cs:934-972).

beforeEach(() => resetMessageOptions());

describe('AUTOMATION_ROWS', () => {
    it('has the 16 C# controls', () => {
        expect(AUTOMATION_ROWS).toHaveLength(16);
        expect(AUTOMATION_ROWS[0]).toMatchObject({ field: 'controlMilitaryAttacks', label: 'Attacks Against Enemies', kind: 'level' });
        expect(AUTOMATION_ROWS[0].options?.[1]).toBe('Suggest attack targets');
        expect(AUTOMATION_ROWS.find((r) => r.label === 'Treaties')?.options?.[1]).toBe('Suggest new treaties');
        expect(AUTOMATION_ROWS.filter((r) => r.kind === 'bool')).toHaveLength(7);
    });

    it('setAutomationValue ports method_419', () => {
        const e = { controlDiplomacyTreaties: AutomationLevel.FullyAutomated, controlResearch: true } as unknown as Empire;
        const treaties = AUTOMATION_ROWS.find((r) => r.field === 'controlDiplomacyTreaties')!;
        const research = AUTOMATION_ROWS.find((r) => r.field === 'controlResearch')!;
        setAutomationValue(e, treaties, 0);
        expect(e.controlDiplomacyTreaties).toBe(AutomationLevel.Undefined);
        expect(automationValue(e, treaties)).toBe(0);
        setAutomationValue(e, treaties, 1);
        expect(e.controlDiplomacyTreaties).toBe(AutomationLevel.PartiallyAutomated);
        setAutomationValue(e, research, false);
        expect(e.controlResearch).toBe(false);
    });
});

describe('MESSAGE_OPTION_ROWS', () => {
    it('has the 19 rows with two-category rows', () => {
        expect(MESSAGE_OPTION_ROWS).toHaveLength(19);
        const colony = MESSAGE_OPTION_ROWS.find((r) => r.label === 'Colony Gain or Loss')!;
        expect(colony.categories).toEqual([MessageCategory.ColonyInvaded, MessageCategory.NewColony]);
        setMessageRowValue(colony, 'popup', false);
        expect(getMessageOptions().popup[MessageCategory.ColonyInvaded]).toBe(false);
        expect(getMessageOptions().popup[MessageCategory.NewColony]).toBe(false);
        expect(messageRowValue(getMessageOptions(), colony, 'popup')).toBe(false);
        expect(MESSAGE_OPTION_ROWS[15].label).toBe('Under Attack - Colony & Construction Ships');
    });
});

describe('keyboard', () => {
    it('O is implemented', () => {
        expect(isKeyActionAvailable('gameOptionsScreen')).toBe(true);
    });
});
