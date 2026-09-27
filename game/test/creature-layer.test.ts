// Creature layer (src/render/creatureLayer.ts): the original's creature size / zoom / frame rules, the method_145 pick
// and the selection-panel / hover data. No DOM — fakes are cast to the sim types.
import { describe, expect, it } from 'vitest';
import {
    CREATURE_FRAME_SETS,
    CREATURE_LOADED_SIDE,
    creatureContentPixels,
    creatureDamageAlpha,
    creatureDrawPx,
    creatureFrameIndex,
    creatureFrameSetIndexes,
    creatureFrameUrls,
    creatureHealthPercent,
    creaturePickWorldSize,
    creaturePreparedPx,
    creatureSelectionRows,
    creatureTooltipText,
    creatureUsesAttackFrames,
    creatureZoomFactor,
    creaturesNear,
    pickCreature,
} from '../src/render/creatureLayer';
import { CreatureType, type Creature } from '../src/sim/creature';
import type { Galaxy } from '../src/sim/galaxy';

function fakeCreature(over: Partial<Creature>): Creature {
    return {
        name: 'Kaltor 7',
        type: CreatureType.Kaltor,
        pictureRef: 2,
        xpos: 0,
        ypos: 0,
        size: 120,
        attackStrength: 14,
        damage: 0,
        damageKillThreshold: 600,
        currentSpeed: 0,
        movementSpeed: 30,
        currentTarget: null,
        distanceToTarget: 0,
        parentHabitat: null,
        nearestSystemStar: null,
        hasBeenDestroyed: false,
        ...over,
    } as unknown as Creature;
}

describe('creature size and zoom rules', () => {
    it('CalculateCreatureZoomFactor (Main.Part11.cs 475): f up to 3, then max(3, f / 2) with the 240 / f cap', () => {
        expect(creatureZoomFactor(1)).toEqual({ factor: 1, maxWidth: 240 });
        expect(creatureZoomFactor(3)).toEqual({ factor: 3, maxWidth: 240 });
        expect(creatureZoomFactor(4)).toEqual({ factor: 3, maxWidth: 60 });
        expect(creatureZoomFactor(10)).toEqual({ factor: 5, maxWidth: 24 });
        expect(creatureZoomFactor(100)).toEqual({ factor: 50, maxWidth: 2.4 });
    });

    it('PrepareCreatureImage (Main.Part12.cs 4804): 108 px loaded frame × sqrt(size / (content / 8))', () => {
        expect(CREATURE_LOADED_SIDE).toBe(108);
        expect(creaturePreparedPx(2432, 304)).toBe(108); // content / 8 = 304 → scale 1
        expect(creaturePreparedPx(2432, 304 * 4)).toBe(216);
        expect(creaturePreparedPx(2432, 76)).toBe(54);
    });

    it('drawn size: prepared / zoom divisor, capped at trunc(240 / f) (MainView.1.cs 1640-1645)', () => {
        expect(creatureDrawPx(2432, 304, 1)).toBe(108);
        expect(creatureDrawPx(2432, 304 * 9, 1)).toBe(240); // 324 capped
        expect(creatureDrawPx(2432, 304, 2)).toBe(54);
        expect(creatureDrawPx(2432, 304, 10)).toBe(21); // 108 / 5 = 21 (cap 24)
        expect(creatureDrawPx(2432, 304, 40)).toBe(5); // 108 / 20 = 5 (cap 6)
        expect(creatureDrawPx(2432, 304 * 9, 1, 3)).toBe(324); // the pilot's widened cap
    });

    it('pick rect is not capped (Main.Part11.cs 1535-1539): world units = loaded × d × f / factor', () => {
        expect(creaturePickWorldSize(2432, 304, 1)).toBe(108);
        expect(creaturePickWorldSize(2432, 304 * 9, 1)).toBe(324);
        expect(creaturePickWorldSize(2432, 304, 10)).toBe(216); // 108 × 10 / 5
    });

    it('method_8 content count: alpha > 0 and not opaque black', () => {
        const px = [0, 0, 0, 255, 0, 0, 0, 0, 10, 0, 0, 255, 0, 0, 0, 12, 255, 255, 255, 1];
        expect(creatureContentPixels(px)).toBe(3);
    });
});

describe('creature frames', () => {
    it('LoadCreatures sets: Kaltor 12 moving + 8 attack = 20, the others 12', () => {
        const count = (t: CreatureType): number => {
            const i = creatureFrameSetIndexes(t)!;
            const moving = CREATURE_FRAME_SETS[i.moving].count;
            const attack = CREATURE_FRAME_SETS[i.attack];
            return moving + (attack.prefix === CREATURE_FRAME_SETS[i.moving].prefix ? 0 : attack.count);
        };
        expect(count(CreatureType.Kaltor)).toBe(20);
        expect(count(CreatureType.RockSpaceSlug)).toBe(12);
        expect(count(CreatureType.DesertSpaceSlug)).toBe(12);
        expect(count(CreatureType.SilverMist)).toBe(12);
        expect(CREATURE_FRAME_SETS[creatureFrameSetIndexes(CreatureType.Ardilus)!.moving].count).toBe(12);
        expect(creatureFrameSetIndexes(CreatureType.Undefined)).toBeNull();
    });

    it('frame URLs follow /assets/dwu/images/units/creatures/<folder>/<Name>_NNNNN.png', () => {
        const urls = creatureFrameUrls(CREATURE_FRAME_SETS[7]);
        expect(urls).toHaveLength(8);
        expect(urls[0]).toBe('/assets/dwu/images/units/creatures/kaltor/KaltorAttack_00000.png');
        expect(creatureFrameUrls(CREATURE_FRAME_SETS[1])[11]).toBe('/assets/dwu/images/units/creatures/sandslug/Sandworm_00011.png');
    });

    it('method_113 schedule: 12 frames at 10 fps over 1.2 s; 8 attack frames over 0.8 s', () => {
        expect(creatureFrameIndex(0, 12, 10)).toBe(0);
        expect(creatureFrameIndex(1100, 12, 10)).toBe(10);
        expect(creatureFrameIndex(1199, 12, 10)).toBe(11);
        expect(creatureFrameIndex(1200, 12, 10)).toBe(0);
        expect(creatureFrameIndex(799, 8, 10)).toBe(7);
    });

    it('attack frames only with a target within 40 and a non-empty attack set', () => {
        const target = {} as never;
        expect(creatureUsesAttackFrames(fakeCreature({ currentTarget: target, distanceToTarget: 40 }), 8)).toBe(true);
        expect(creatureUsesAttackFrames(fakeCreature({ currentTarget: target, distanceToTarget: 41 }), 8)).toBe(false);
        expect(creatureUsesAttackFrames(fakeCreature({ currentTarget: target, distanceToTarget: 10 }), 0)).toBe(false);
        expect(creatureUsesAttackFrames(fakeCreature({ currentTarget: null, distanceToTarget: 0 }), 8)).toBe(false);
    });

    it('method_108: only a damaged SilverMist fades (1 - 0.95 x damage / threshold)', () => {
        expect(creatureDamageAlpha(fakeCreature({ damage: 300 }))).toBe(1);
        expect(creatureDamageAlpha(fakeCreature({ type: CreatureType.SilverMist, damage: 0 }))).toBe(1);
        expect(creatureDamageAlpha(fakeCreature({ type: CreatureType.SilverMist, damage: 300 }))).toBeCloseTo(0.525, 5);
    });
});

describe('creature pick (Main.Part11.cs method_145, f <= 100)', () => {
    const content = (): number => 2432;
    it('hits within the padded rect and prefers the smaller creature', () => {
        const big = fakeCreature({ name: 'big', size: 304 * 4, xpos: 1000, ypos: 1000 }); // 216 wide at f = 1
        const small = fakeCreature({ name: 'small', size: 304, xpos: 1050, ypos: 1000 }); // 108 wide
        const list = [big, small];
        // f = 1: pad 1. The small one's rect is 996..1104.
        expect(pickCreature(list, 1060, 1000, 1, content, () => true)).toBe(small);
        // 1106 is outside small (1104 + 1) but inside big (892..1108 + 1).
        expect(pickCreature(list, 1106, 1000, 1, content, () => true)).toBe(big);
        expect(pickCreature(list, 1300, 1000, 1, content, () => true)).toBeNull();
    });

    it('skips creatures the player cannot see', () => {
        const c = fakeCreature({ xpos: 0, ypos: 0 });
        expect(pickCreature([c], 0, 0, 1, content, () => false)).toBeNull();
        expect(pickCreature([c, null], 0, 0, 1, content, () => true)).toBe(c);
    });
});

describe('creaturesNear (MainView.1.cs 1567-1585)', () => {
    it('within MaxSolarSystemSize + 5000 of the star: that system’s creatures; beyond: restricted-area ones', () => {
        const a = fakeCreature({ name: 'a' });
        const b = fakeCreature({ name: 'b' });
        const star = { xpos: 0, ypos: 0, systemIndex: 0 };
        const galaxy = {
            systems: [{ creatures: [a] }],
            calculateDistance: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x1 - x2, y1 - y2),
            determineGalaxyLocationsAtPoint: () => [{ relatedCreatures: [b] }],
        } as unknown as Galaxy;
        expect(creaturesNear(galaxy, star, 28000, 0)).toEqual([a]);
        expect(creaturesNear(galaxy, star, 28001, 0)).toEqual([b]);
        expect(creaturesNear(galaxy, null, 0, 0)).toEqual([]);
    });
});

describe('creature selection / hover data (InfoPanel.cs DrawCreature, HoverPanel.cs method_2)', () => {
    it('selection rows: type, size, attack strength, health, speed, location', () => {
        const star = { name: 'Zeta' };
        const c = fakeCreature({ size: 150, attackStrength: 22, damage: 150, damageKillThreshold: 600, currentSpeed: 12.7, movementSpeed: 30, nearestSystemStar: star as never });
        expect(creatureSelectionRows(c)).toEqual([
            { label: 'Type', value: 'Giant Kaltor' },
            { label: 'Size', value: '150' },
            { label: 'Attack Strength', value: '22' },
            { label: 'Health', value: '450 / 600 (75%)' },
            { label: 'Speed', value: '12 / 30' },
            { label: 'Location', value: 'Zeta system' },
        ]);
        const onPlanet = fakeCreature({ type: CreatureType.DesertSpaceSlug, parentHabitat: { name: 'Zeta II' } as never, nearestSystemStar: star as never });
        const rows = creatureSelectionRows(onPlanet);
        expect(rows[0].value).toBe('Sand Slug');
        expect(rows[5].value).toBe('Zeta II');
        expect(creatureSelectionRows(fakeCreature({}))[5].value).toBe('Deep space');
    });

    it('health percent and the hover text', () => {
        expect(creatureHealthPercent(fakeCreature({ damage: 1, damageKillThreshold: 3 }))).toBe(67);
        expect(creatureHealthPercent(fakeCreature({ damage: 0 }))).toBe(100);
        expect(creatureTooltipText(fakeCreature({ name: 'Old One', size: 99, attackStrength: 9, damage: 60, damageKillThreshold: 600 }))).toBe(
            'Old One — Size: 99, Strength: 9, Health: 90%',
        );
    });
});
