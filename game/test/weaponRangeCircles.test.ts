// Weapon-range circles / gravity-well ring (render/weaponRangeCircles.ts): BaconMain.cs 404 / 442.
import { afterEach, describe, expect, it } from 'vitest';
import { ComponentType } from '../src/sim/data/components';
import { FighterType } from '../src/sim/combat/fighters';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { baconMovementSettings } from '../src/sim/movement';
import { COLOR_BEIGE, COLOR_BLUE, COLOR_GOLD, COLOR_RED, COLOR_SILVER, gravityWellRing, weaponRangeCircles } from '../src/render/weaponRangeCircles';

const w = (type: ComponentType, range: number, name = 'Gun') => ({ component: { type, def: { name } }, range });

describe('weaponRangeCircles', () => {
    it('one circle per weapon type (first of each), Assault Pods skipped, colour carried over', () => {
        const c = weaponRangeCircles({ weapons: [w(ComponentType.WeaponBeam, 400), w(ComponentType.WeaponBeam, 900), w(ComponentType.WeaponTorpedo, 700), w(ComponentType.AssaultPod, 300, 'Assault Pod'), w(ComponentType.WeaponPointDefense, 200)], fighters: null }, 1);
        expect(c).toEqual([
            { radius: 400, color: COLOR_BLUE, dashed: false },
            { radius: 700, color: COLOR_RED, dashed: false },
            // Point defence has no colour of its own: it keeps the torpedo's.
            { radius: 200, color: COLOR_RED, dashed: false },
        ]);
        expect(weaponRangeCircles({ weapons: [w(ComponentType.WeaponPointDefense, 200)], fighters: null }, 1)[0].color).toBe(COLOR_BEIGE);
    });
    it('fighter circles per specification, only beyond f = 7.76', () => {
        const si = { type: FighterType.Interceptor };
        const sb = { type: FighterType.Bomber };
        const fighters = [{ specification: si }, { specification: si }, { specification: sb }];
        const range = () => 10000.004;
        expect(weaponRangeCircles({ weapons: [], fighters }, 7.76, range)).toEqual([]);
        const c = weaponRangeCircles({ weapons: [], fighters }, 8, range);
        expect(c.map((x) => x.color)).toEqual([COLOR_SILVER, COLOR_GOLD]);
        expect(c[0].radius).toBe(100);
    });
});

describe('gravityWellRing', () => {
    const was = baconMovementSettings.useStarGravityWells;
    afterEach(() => {
        baconMovementSettings.useStarGravityWells = was;
    });
    const player = {} as never;
    const star = { xpos: 5, ypos: 6, solarRadiation: 50, microwaveRadiation: 30, xrayRadiation: 20 };
    const ship = (o: Record<string, unknown> = {}) => ({ role: BuiltObjectRole.Military, actualEmpire: player, nearestSystemStar: star, components: { items: [] }, ...o }) as never;
    it('follows useStarGravityWells and the player / non-base / nearest-star rules', () => {
        baconMovementSettings.useStarGravityWells = false;
        expect(gravityWellRing({ builtObject: ship() }, player)).toBeNull();
        baconMovementSettings.useStarGravityWells = true;
        const r = gravityWellRing({ builtObject: ship() }, player);
        expect(r?.star).toBe(star);
        expect(r!.radius).toBeGreaterThan(0);
        expect(gravityWellRing({ builtObject: ship({ role: BuiltObjectRole.Base }) }, player)).toBeNull();
        expect(gravityWellRing({ builtObject: ship({ actualEmpire: {} }) }, player)).toBeNull();
        expect(gravityWellRing({ builtObject: ship({ nearestSystemStar: null }) }, player)).toBeNull();
        expect(gravityWellRing({ shipGroup: { leadShip: ship() } as never }, player)?.star).toBe(star);
    });
});
