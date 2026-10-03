import { afterEach, describe, expect, it } from 'vitest';
import { characterPublicEvents, resolveCharacterEventDescription } from '../src/ui/screens/characterEventText';
import { Character, CharacterEvent, CharacterEventType as ET, CharacterRole, CharacterSkill, CharacterSkillType } from '../src/sim/characters';
import { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { Empire } from '../src/sim/empire';
import { Habitat, HabitatCategoryType, HabitatType } from '../src/sim/types';
import { InvasionStats } from '../src/sim/combat/invasion';
import { SpaceBattleStats } from '../src/sim/combat/damage';
import { clearText, loadText } from '../src/sim/textResolver';

function ship(name: string, subRole: BuiltObjectSubRole, role = BuiltObjectRole.Military, groupName: string | null = null): BuiltObject {
    const bo = Object.create(BuiltObject.prototype) as BuiltObject;
    bo.name = name;
    bo.subRole = subRole;
    bo.role = role;
    bo.shipGroup = groupName !== null ? { name: groupName } : null;
    return bo;
}
function empire(name: string): Empire {
    const e = Object.create(Empire.prototype) as Empire;
    e.name = name;
    return e;
}
function planet(name: string): Habitat {
    return new Habitat(HabitatCategoryType.Planet, HabitatType.Continental, name, 0, 0);
}

afterEach(() => clearText());

describe('resolveCharacterEventDescription (no text table: tags)', () => {
    it('Boarding uses the ship name; empty data falls back to the type title', () => {
        const r = resolveCharacterEventDescription(new CharacterEvent(ET.Boarding, ship('Valiant', BuiltObjectSubRole.Frigate), 0), null);
        expect(r).toEqual({ title: 'Character Event Title Boarding', text: 'Character Event Description Boarding' });
        const r2 = resolveCharacterEventDescription(new CharacterEvent(ET.Boarding, null, 0), null);
        expect(r2).toEqual({ title: 'Character Event Boarding', text: '' });
    });
    it('types with no ResolveDescription(CharacterEventType) case have an empty title', () => {
        const r = resolveCharacterEventDescription(new CharacterEvent(ET.ColonyDevelopmentIncrease, planet('Terra'), 0), null);
        expect(r.title).toBe('');
        expect(r.text).toBe('Character Event Description Colony Development Change');
    });
    it('TradeIncome: Bacon text or spyMessage pair', () => {
        expect(resolveCharacterEventDescription(new CharacterEvent(ET.TradeIncome, null, 0), null)).toEqual({
            title: 'Character Event Trade Income',
            text: 'Character Event Description Trade Income',
        });
        const spy = new Map<string, unknown>([['spyMessage', ['T', 'D']]]);
        expect(resolveCharacterEventDescription(new CharacterEvent(ET.TradeIncome, spy, 0), null)).toEqual({ title: 'T', text: 'D' });
    });
});

describe('resolveCharacterEventDescription (with text)', () => {
    const GT = [
        'Character Event Title ShipBase Built\t\t;{0} Built',
        'Character Event Description Build Ship\t\t;A new {0} has been built ({1})',
        'Character Event Description Start\t\t;A new {0} named {1} has appeared at {2}',
        'Character Event Description Transfer Location\t\t;{0} has moved to {1}',
        'Character Event Title War Started\t\t;War with {0}',
        'Character Event Description War Started\t\t;War started with {0}',
        'Character Event Description Skill Gain\t\t;Gained skill: {0}',
        'Colony Invasion Title\t\t;Invasion of {0}',
        'Colony Defense Title\t\t;Defense of {0}',
        'Colony Defense Succeeded\t\t;We held {0}',
        'Colony Invasion Succeeded\t\t;We took {0}',
        'Colony Invasion Troop Losses\t\t;Losses {0}/{1}',
        'Space Skirmish Title\t\t;Skirmish at {0}',
        'Space Battle Stats Destroyed Tonnage\t\t;E {0} {1} {2} F {3} {4} {5}',
        'Space Battle Enemy Losses\t\t;Enemy: {0}',
        'Space Battle Friendly Losses\t\t;Ours: {0}',
        'None\t\t;None',
        'Fighters\t\t;Fighters',
        'Ship SubRole Frigate\t\t;Frigate',
        'Ship Captain\t\t;Ship Captain',
    ].join('\n');

    it('ship built / war started', () => {
        loadText(GT);
        const r = resolveCharacterEventDescription(new CharacterEvent(ET.BuildMilitaryShip, ship('Valiant', BuiltObjectSubRole.Frigate), 0), null);
        expect(r.title).toBe('Frigate Built');
        expect(r.text).toBe('A new Frigate has been built (Valiant)');
        const w = resolveCharacterEventDescription(new CharacterEvent(ET.WarStarted, empire('Zorg'), 0), null);
        expect(w).toEqual({ title: 'War with Zorg', text: 'War started with Zorg' });
    });

    it('CharacterStart / TransferLocation location text', () => {
        loadText(GT);
        const c = new Character('Ada', CharacterRole.ShipCaptain, '', null, null, null, 0);
        const ev = new CharacterEvent(ET.CharacterStart, [c, ship('Valiant', BuiltObjectSubRole.Frigate, BuiltObjectRole.Military, 'First Fleet')], 0);
        expect(resolveCharacterEventDescription(ev, null).text).toBe('A new Ship Captain named Ada has appeared at Frigate Valiant (First Fleet)');
        const ev2 = new CharacterEvent(ET.CharacterTransferLocation, [c, planet('Terra')], 0);
        expect(resolveCharacterEventDescription(ev2, null).text).toBe('Ada has moved to Terra');
        const ev3 = new CharacterEvent(ET.CharacterTransferLocation, [c, ship('Base1', BuiltObjectSubRole.DefensiveBase, BuiltObjectRole.Base)], 0);
        expect(resolveCharacterEventDescription(ev3, null).text).toBe('Ada has moved to Base1');
    });

    it('skill gain', () => {
        loadText(GT);
        const r = resolveCharacterEventDescription(new CharacterEvent(ET.CharacterSkillGain, new CharacterSkill(CharacterSkillType.ColonyIncome, 5), 0), null);
        expect(r.text.startsWith('Gained skill: ')).toBe(true);
    });

    it('ground invasion depends on calling empire', () => {
        loadText(GT);
        const a = empire('A');
        const d = empire('D');
        const stats = new InvasionStats(planet('Terra'), a, d);
        stats.destroyedDefendingTroops = 3;
        stats.destroyedInvadingTroops = 7;
        stats.invasionSucceeded = false;
        expect(resolveCharacterEventDescription(new CharacterEvent(ET.GroundInvasion, stats, 0), d)).toEqual({
            title: 'Defense of Terra',
            text: 'We held Terra\n\nLosses 3/7',
        });
        stats.invasionSucceeded = true;
        expect(resolveCharacterEventDescription(new CharacterEvent(ET.GroundInvasion, stats, 0), a)).toEqual({
            title: 'Invasion of Terra',
            text: 'We took Terra\n\nLosses 3/7',
        });
    });

    it('space battle stats', () => {
        loadText(GT);
        const s = new SpaceBattleStats();
        s.location = planet('Terra');
        s.nearLocation = true;
        s.destroyedEnemyShipBaseSize = 1200;
        s.destroyedEnemyShipBaseSizeByFighters = 300;
        s.destroyedEnemyShipsFrigate = 2;
        s.destroyedEnemyFighters = 4;
        const r = resolveCharacterEventDescription(new CharacterEvent(ET.SpaceBattle, s, 0), null);
        // num7 = 1500 > 800 -> "Space Battle Title" (not in this table -> KEY NOT FOUND).
        expect(r.title).toBe("KEY NOT FOUND: 'Space Battle Title'");
        expect(r.text).toBe('E 2 1,500 20% F 0 0 0%\n\nEnemy: 2 x Frigate, 4 x Fighters\n\nOurs: None\n\n');
    });
});

describe('characterPublicEvents', () => {
    it('filters to public events, newest first, without mutating the history', () => {
        const c = new Character('Ada', CharacterRole.Ambassador, '', null, null, null, 0);
        const e1 = new CharacterEvent(ET.WarStarted, null, 100);
        const e2 = new CharacterEvent(ET.TradeIncome, null, 200); // not public
        const e3 = new CharacterEvent(ET.TreatySigned, null, 300);
        const e4 = new CharacterEvent(ET.WarEnded, null, 50);
        c.eventHistory.push(e1, e2, e3, e4);
        const before = c.eventHistory.slice();
        const list = characterPublicEvents(c);
        expect(list).toEqual([e3, e1, e4]);
        expect(c.eventHistory).toEqual(before);
        expect(list).not.toBe(c.eventHistory);
    });
});
