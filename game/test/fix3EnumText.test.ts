// Galaxy.2.cs ResolveDescription(enum) overloads (enumText.ts): message texts carry the GameText text of the enum member
// (the C# formats TextResolver.GetText(<tag>) into the message), not the raw C# member name.
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadText, resolveGameText, tryGetText } from '../src/sim/textResolver';
import { resolveDescription } from '../src/sim/messages';
import * as ET from '../src/sim/enumText';
import { CharacterRole, CharacterSkillType, CharacterTraitType } from '../src/sim/characters';
import { CharacterTraitType as RaceCharacterTraitType } from '../src/sim/data/races';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { DisasterEventType, RaceEventType } from '../src/sim/eventTypes';
import { DiplomaticRelationType } from '../src/sim/diplomacy';
import { HabitatCategoryType, HabitatType } from '../src/sim/types';
import { gameText } from '../src/sim/colonyTick';

beforeAll(() => {
    loadText(readFileSync(resolve(__dirname, '../public/assets/dwu/GameText.txt'), 'utf-8'));
});

const E = (e: object) => e as unknown as Record<number, string>;

describe('ResolveDescription(enum) tables', () => {
    it('every C# case is a member of the TS enum and every tag is in GameText.txt', () => {
        const pairs: [ET.EnumText, object][] = [
            [ET.CHARACTER_TRAIT, CharacterTraitType], [ET.CHARACTER_TRAIT, RaceCharacterTraitType], [ET.CHARACTER_SKILL, CharacterSkillType],
            [ET.CHARACTER_ROLE, CharacterRole], [ET.BUILT_OBJECT_SUB_ROLE, BuiltObjectSubRole], [ET.DISASTER_EVENT, DisasterEventType],
            [ET.DIPLOMATIC_RELATION, DiplomaticRelationType], [ET.HABITAT_CATEGORY, HabitatCategoryType], [ET.HABITAT_TYPE, HabitatType],
            [ET.RACE_EVENT, RaceEventType],
        ];
        for (const [table, enumType] of pairs) {
            for (const [member, tag] of Object.entries(table.tags)) {
                expect(typeof (enumType as Record<string, unknown>)[member], member).toBe('number');
                expect(tryGetText(tag), tag).not.toBeNull();
            }
        }
    });

    it('resolves members to GameText text (Galaxy.2.cs 1977 / 2133 / 2488 / 2523 / 1518)', () => {
        expect(resolveDescription(E(CharacterRole), CharacterRole.TroopGeneral)).toBe('Troop General');
        expect(resolveDescription(E(CharacterRole), CharacterRole.Undefined)).toBe('');
        expect(resolveDescription(E(BuiltObjectSubRole), BuiltObjectSubRole.CapitalShip)).toBe('Capital Ship');
        expect(resolveDescription(E(BuiltObjectSubRole), BuiltObjectSubRole.Undefined)).toBe('None');
        expect(resolveDescription(E(DiplomaticRelationType), DiplomaticRelationType.TradeSanctions)).toBe('Trade Sanctions');
        expect(resolveDescription(E(HabitatType), HabitatType.MarshySwamp).toLowerCase()).toBe('marshy swamp');
        expect(resolveDescription(E(CharacterTraitType), CharacterTraitType.IntelligenceEloquentSpeaker)).toBe('Eloquent Speaker');
        expect(resolveDescription(E(DisasterEventType), DisasterEventType.Undefined)).toBe('');
    });

    it('a message built with it decodes to the C# text (Character.cs 4472 SendDeathMessage)', () => {
        const text = gameText('Character Death Description', resolveDescription(E(CharacterRole), CharacterRole.ColonyGovernor), 'Ann Lee', 'Terra');
        expect(resolveGameText(text)).toBe('Our Colony Governor Ann Lee has died at Terra!');
    });
});
