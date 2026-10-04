// Fighter picking / selection (render/fighterLayer.ts pickDrawnFighter: Main.Part11.cs 1579-1600; ui/selectionInfo.ts
// fighterInfo: InfoPanel.cs 3495 DrawFighter; render/fog.ts selectionUnseen: Main.Part10.cs method_209).
import { describe, expect, it } from 'vitest';
import { FIGHTER_PICK_MAX_FACTOR, pickDrawnFighter } from '../src/render/fighterLayer';
import { FighterMissionType } from '../src/sim/combat/fighters';
import { fighterInfo, fighterMissionDescription, rowText } from '../src/ui/selectionInfo';
import { selectionUnseen } from '../src/render/fog';

const fighter = (o: Record<string, unknown> = {}) => ({ onboardCarrier: false, hasBeenDestroyed: false, ...o }) as never;

describe('pickDrawnFighter', () => {
    it('hits the drawn rect padded by (int)(f x 1.3), first in draw order', () => {
        const a = fighter();
        const b = fighter();
        const drawn = [
            { fighter: a, x: 1000, y: 1000, px: 10 },
            { fighter: b, x: 1000, y: 1000, px: 10 },
        ];
        // f = 2: half extent trunc(10 x 2 / 2) = 10 world units + pad 2.
        expect(pickDrawnFighter(drawn, 1012, 1000, 2)).toBe(a);
        expect(pickDrawnFighter(drawn, 1013, 1000, 2)).toBeNull();
    });
    it('only below zoom factor 50, and never a fighter back aboard', () => {
        const a = fighter();
        expect(pickDrawnFighter([{ fighter: a, x: 0, y: 0, px: 10 }], 0, 0, FIGHTER_PICK_MAX_FACTOR)).toBeNull();
        expect(pickDrawnFighter([{ fighter: fighter({ onboardCarrier: true }), x: 0, y: 0, px: 10 }], 0, 0, 1)).toBeNull();
    });
});

describe('fighter selection panel (DrawFighter)', () => {
    const player = { name: 'Us', empiresViewable: [] } as never;
    const other = { name: 'Them', empiresViewable: [] } as never;
    const galaxy = { independentEmpire: null } as never;
    const spec = { energyCapacity: 50, shieldsCapacity: 20, weaponRange: 300 };
    const f = (o: Record<string, unknown> = {}) =>
        ({ name: 'Wasp', empire: player, missionType: FighterMissionType.Patrol, currentTarget: null, parentBuiltObject: { name: 'Carrier A' }, health: 0.5, currentEnergy: 30.7, currentShields: 12.9, topSpeed: 400, currentSpeed: 120, firepowerRaw: 8, specification: spec, pictureRef: 0, size: 10, heading: 0, underConstruction: false, shieldsReducedLocation: false, movementSlowedLocation: false, ...o }) as never;
    it('resolves the mission text (Galaxy.2.cs 5675)', () => {
        expect(fighterMissionDescription(f())).toBe('Patrol Carrier A');
        expect(fighterMissionDescription(f({ missionType: FighterMissionType.Undefined }))).toBe('(No mission)');
        expect(fighterMissionDescription(f({ missionType: FighterMissionType.ReturnToCarrier }))).toBe('Return to carrier (Carrier A)');
        expect(fighterMissionDescription(f({ missionType: FighterMissionType.Attack, currentTarget: { name: 'Raider' } }))).toBe('Attack Raider');
    });
    it('shows health / energy / shields / speed / weapons for the own fighter', () => {
        const text = fighterInfo({ galaxy, player, resource: () => undefined } as never, f()).rows.map(rowText).join('\n');
        expect(text).toContain('Patrol Carrier A');
        expect(text).toContain('Health: 50 / 100');
        expect(text).toContain('Energy: 30 / 50');
        expect(text).toContain('Shields: 12 / 20');
        expect(text).toContain('Speed: 120 / 400');
        expect(text).toContain('Weapons: Firepower: 8, Range: 300');
    });
    it("hides another empire's mission, health and energy", () => {
        const text = fighterInfo({ galaxy, player, resource: () => undefined } as never, f({ empire: other })).rows.map(rowText).join('\n');
        expect(text).toContain('(Unknown mission)');
        expect(text).toContain('Health: (Unknown)');
        expect(text).toContain('Shields: 12 / 20');
    });
    it('a destroyed fighter drops the selection', () => {
        expect(selectionUnseen({} as never, player, { fighter: f({ hasBeenDestroyed: true }) })).toBe(true);
    });
});
