// Selection panel Bonuses lines for ships and fleets (Galaxy.2.cs 4084 / 4152, BaconInfoPanel.cs 777 / 1067) and the
// message hover ping (Main.Part9.cs 742 method_242 / 777 method_244).

import { describe, expect, it } from 'vitest';
import { fmtPlusMinusPct, builtObjectCharacterBonusDescription, shipGroupCharacterBonusDescription } from '../src/ui/characterBonusText';
import { messagePingObject, pingMessage, unpingMessage } from '../src/ui/messageGoto';
import { EmpireMessage } from '../src/sim/messages';
import { mapHighlightsOf } from '../src/render/mapHighlights';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObject } from '../src/sim/builtObject';
import { Empire } from '../src/sim/empire';
import { captainBonusMap } from '../src/sim/characters';

const fleet = (over: Record<string, number> = {}) => ({
    targetingBonus: 1, countermeasuresBonus: 1, shipManeuveringBonus: 1, fightersBonus: 1, shipEnergyUsageBonus: 1,
    weaponsDamageBonus: 1, weaponsRangeBonus: 1, shieldRechargeRateBonus: 1, damageControlBonus: 1, repairBonus: 1,
    hyperjumpSpeedBonus: 1, ...over,
});

function ship(group: unknown, captain?: { targeting: number }): BuiltObject {
    const bo = Object.create(BuiltObject.prototype) as BuiltObject;
    Object.assign(bo, { role: BuiltObjectRole.Military, subRole: BuiltObjectSubRole.Frigate, characters: [], empire: null, parentHabitat: null, shipGroup: group, constructionQueue: null });
    if (captain) captainBonusMap.set(bo, { targeting: captain.targeting, countermeasures: 100, shipManeuvering: 100, fighters: 100, shipEnergyUsage: 100, weaponsDamage: 100, weaponsRange: 100, shieldRechargeRate: 100, damageControl: 100, repair: 100, hyperjumpSpeed: 100 });
    return bo;
}

describe('"+0%;-0%" format', () => {
    it('rounds half away from zero and signs zero as +', () => {
        expect(fmtPlusMinusPct(0.1)).toBe('+10%');
        expect(fmtPlusMinusPct(-0.05)).toBe('-5%');
        expect(fmtPlusMinusPct(0.005)).toBe('+1%');
        expect(fmtPlusMinusPct(0)).toBe('+0%');
    });
});

describe('GenerateCharacterBonusDescription(ShipGroup) (Galaxy.2.cs 4084)', () => {
    it('is empty with no bonus, else "+N% Skill" parts joined by ", " in field order', () => {
        expect(shipGroupCharacterBonusDescription(null)).toBe('');
        expect(shipGroupCharacterBonusDescription(fleet() as never)).toBe('');
        const t = shipGroupCharacterBonusDescription(fleet({ targetingBonus: 1.1, weaponsDamageBonus: 0.95, hyperjumpSpeedBonus: 1.2 }) as never);
        expect(t).toMatch(/^\+10% .+, -5% .+, \+20% .+$/);
        expect(t.split(', ')).toHaveLength(3);
    });
});

describe('GenerateCharacterBonusDescription(BuiltObject) (Galaxy.2.cs 4152)', () => {
    it('is empty for a plain ship, with or without a neutral fleet', () => {
        expect(builtObjectCharacterBonusDescription(null)).toBe('');
        expect(builtObjectCharacterBonusDescription(ship(null))).toBe('');
        expect(builtObjectCharacterBonusDescription(ship(fleet() as never))).toBe('');
    });
    it('adds the fleet admiral bonus to the captain bonus (a fleet baseline is 2.0) and prefixes the roles', () => {
        const t = builtObjectCharacterBonusDescription(ship(fleet({ targetingBonus: 1.1 }) as never));
        expect(t).toMatch(/^.+ & .+: \+10% .+$/);
        // Captain only (no fleet): baseline 1.0, the captain's 120 % is +20 %.
        const c = builtObjectCharacterBonusDescription(ship(null, { targeting: 120 }));
        expect(c).toMatch(/: \+20% /);
    });
});

describe('message hover ping (method_242 / 244)', () => {
    const galaxy = {} as never;
    const sender = Object.create(Empire.prototype) as Empire;
    it('picks the subject; a relation type or a money offer is about the sender, an Empire falls back to the Location', () => {
        const point = { x: 120, y: 340 };
        const m = new EmpireMessage(sender, 0, point);
        expect(messagePingObject(m)).toEqual(point);
        const rel = new EmpireMessage(sender, 0, 3);
        rel.location = point;
        expect(messagePingObject(rel)).toEqual(point); // relation type -> Sender (an Empire) -> Location
        const money = new EmpireMessage(sender, 0, point);
        money.money = 10;
        money.location = { x: 5, y: 6 };
        expect(messagePingObject(money)).toEqual({ x: 5, y: 6 });
    });
    it('adds the ping on enter and removes it on leave', () => {
        const g = {} as object;
        const m = new EmpireMessage(sender, 0, { x: 7, y: 9 });
        pingMessage(g as never, m);
        expect(mapHighlightsOf(g).eventLocations.map((e) => e.obj)).toEqual([{ x: 7, y: 9 }]);
        unpingMessage(g as never, m);
        expect(mapHighlightsOf(g).eventLocations).toEqual([]);
        void galaxy;
    });
});
