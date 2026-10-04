// Battle bars at zoom factor <= 3 (render/combatBars.ts): ports of MainView.2.cs method_194 / method_195 / method_191 /
// method_214 and the per-ship rules of MainView.1.cs 1251-1295.
import { describe, expect, it } from 'vitest';
import {
    ASSAULT_BAR_OFFSET_PX,
    COLOR_10,
    COLOR_11,
    COLOR_12,
    COLOR_13,
    COLOR_14,
    COLOR_9,
    SHIELD_LINE_OFFSET_PX,
    assaultBar,
    assaultIconTint,
    fleetLeaderBadgeOffset,
    pulseColor,
    shieldLine,
    shipBattleBars,
    showsAssaultIcon,
    showsFleetLeaderBadge,
} from '../src/render/combatBars';

const ship = (o: Record<string, unknown> = {}) =>
    ({
        inBattle: true,
        shieldsCapacity: 0,
        currentShields: 0,
        assaultDefenseValue: 0,
        assaultDefenseValueFixed: 0,
        assaultDefenseValueDefault: 0,
        assaultAttackValue: 0,
        shipGroup: null,
        ...o,
    }) as never;

describe('method_194 shield line', () => {
    it('is blue up to the charge and red for the rest', () => {
        expect(shieldLine(40, 200, 50, -8)).toEqual([
            { x1: 10, x2: 40, y: -8, color: COLOR_10 },
            { x1: 0, x2: 10, y: -8, color: COLOR_9 },
        ]);
    });
    it('has no red part at full charge', () => {
        expect(shieldLine(40, 200, 200, -8)).toEqual([{ x1: 0, x2: 40, y: -8, color: COLOR_9 }]);
    });
    it('truncates the split point', () => {
        expect(shieldLine(33, 100, 50, 0)[1].x2).toBe(16);
    });
});

describe('method_195 boarding bar', () => {
    it('splits fixed / rest / attack shares while boarding', () => {
        // num = 10 + 30 + 60 = 100 → 10 % and 30 % of 50 px, then the attack remainder in orange.
        expect(assaultBar(50, 40, 10, 30, 60, -4)).toEqual([
            { x1: 0, x2: 5, y: -4, color: COLOR_11 },
            { x1: 5, x2: 20, y: -4, color: COLOR_12 },
            { x1: 20, x2: 50, y: -4, color: COLOR_14 },
        ]);
    });
    it('shows the defence against its default otherwise', () => {
        expect(assaultBar(50, 100, 20, 30, 0, -4)).toEqual([
            { x1: 0, x2: 10, y: -4, color: COLOR_11 },
            { x1: 10, x2: 25, y: -4, color: COLOR_12 },
            { x1: 25, x2: 50, y: -4, color: COLOR_13 },
        ]);
    });
    it('caps a share at the full width and draws nothing without attack or default', () => {
        expect(assaultBar(50, 10, 30, 0, 0, 0)[0].x2).toBe(50);
        expect(assaultBar(50, 0, 0, 0, 0, 0)).toEqual([]);
    });
});

describe('ship bars (MainView.1.cs 1251-1295)', () => {
    it('draws nothing outside battle', () => {
        expect(shipBattleBars(ship({ inBattle: false, shieldsCapacity: 100, currentShields: 50 }), 40)).toEqual([]);
    });
    it('puts the shield line 8 px and the boarding bar 4 px above the zoom-1 image', () => {
        const lines = shipBattleBars(ship({ shieldsCapacity: 100, currentShields: 100, assaultDefenseValue: 20, assaultDefenseValueFixed: 5, assaultDefenseValueDefault: 20 }), 40);
        expect(lines.filter((l) => l.y === -SHIELD_LINE_OFFSET_PX)).toHaveLength(1);
        expect(lines.filter((l) => l.y === -ASSAULT_BAR_OFFSET_PX)).toHaveLength(3);
    });
    it('passes max(0, defence - fixed) as the second share', () => {
        const lines = shipBattleBars(ship({ assaultDefenseValue: 3, assaultDefenseValueFixed: 5, assaultDefenseValueDefault: 10 }), 40);
        expect(lines[1]).toMatchObject({ x1: 20, x2: 20 });
    });
    it('flashes the boarding icon only while boarding in battle', () => {
        expect(showsAssaultIcon(ship({ assaultAttackValue: 4 }))).toBe(true);
        expect(showsAssaultIcon(ship({ assaultAttackValue: 4, inBattle: false }))).toBe(false);
        expect(showsAssaultIcon(ship())).toBe(false);
    });
    it('badges the fleet lead ship, at width + 2 - 14 px, 2 px above', () => {
        const group: { leadShip: unknown } = { leadShip: null };
        const lead = ship({ shipGroup: group });
        group.leadShip = lead;
        expect(showsFleetLeaderBadge(lead)).toBe(true);
        expect(showsFleetLeaderBadge(ship({ shipGroup: group }))).toBe(false);
        expect(showsFleetLeaderBadge(ship())).toBe(false);
        expect(fleetLeaderBadgeOffset(40)).toEqual({ x: 28, y: -2 });
    });
});

describe('method_214 pulse', () => {
    it('is the end colour on the even second, the start colour one second later', () => {
        expect(pulseColor(0xffff0000, 0xffffff00, 0, 0)).toBe(0xffffff00);
        expect(pulseColor(0xffff0000, 0xffffff00, 1, 0)).toBe(0xffff0000);
        expect(pulseColor(0xffff0000, 0xffffff00, 0, 500)).toBe(0xffff7f00);
    });
    it('keeps the C# byte arithmetic for a falling channel', () => {
        // color_7 (128, 112, 0, 160) -> color_8 (224, 255, 32, 112) halfway: alpha 176, R 183, G 16, B 136.
        const c = pulseColor(0x807000a0, 0xe0ff2070, 1, 500);
        expect([(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255]).toEqual([176, 183, 16, 136]);
    });
    it('the boarding icon tint runs red ↔ yellow on game time', () => {
        expect(assaultIconTint(0)).toBe(0xffff00);
        expect(assaultIconTint(1000)).toBe(0xff0000);
    });
});
