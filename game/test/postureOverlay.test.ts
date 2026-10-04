// Fleet Postures / Long Range Scanners overlays (render/postureOverlay.ts): MainView.2.cs method_247 and the scanner
// discs of the backdrops (MainView.1.cs 4006, MainView.2.cs 277).
import { describe, expect, it } from 'vitest';
import { FleetPosture } from '../src/sim/diplomacyTick';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import {
    POSTURE_ATTACK_COLOR,
    POSTURE_DEFEND_COLOR,
    fleetPostureMarks,
    longRangeScannerDiscs,
    postureRadius,
    scannerLayerFade,
} from '../src/render/postureOverlay';

const pt = (x: number, y: number) => ({ xpos: x, ypos: y });
const fleet = (o: Record<string, unknown>) => ({ leadShip: {}, posture: FleetPosture.Attack, attackPoint: null, gatherPoint: null, postureRangeSquared: Number.MAX_VALUE, ...o });

describe('postureRadius', () => {
    it('draws only ranges between 1500² and float.MaxValue', () => {
        expect(postureRadius(1500 * 1500)).toBe(0);
        expect(postureRadius(2000 * 2000)).toBe(2000);
        expect(postureRadius(3.4028234663852886e38)).toBe(0);
        expect(postureRadius(Number.MAX_VALUE)).toBe(0);
    });
});

describe('fleetPostureMarks (method_247)', () => {
    it('attack: disc at the attack point, line from the gather point', () => {
        const marks = fleetPostureMarks({ shipGroups: [fleet({ attackPoint: pt(10, 20), gatherPoint: pt(1, 2), postureRangeSquared: 4e6 })] } as never);
        expect(marks).toEqual([{ posture: 'attack', x: 10, y: 20, radius: 2000, color: POSTURE_ATTACK_COLOR, from: { x: 1, y: 2 } }]);
    });
    it('attack needs an attack point; the line is drawn even without a disc', () => {
        expect(fleetPostureMarks({ shipGroups: [fleet({ gatherPoint: pt(1, 2) })] } as never)).toEqual([]);
        expect(fleetPostureMarks({ shipGroups: [fleet({ attackPoint: pt(5, 5), gatherPoint: pt(1, 2) })] } as never)[0]).toMatchObject({ radius: 0, from: { x: 1, y: 2 } });
    });
    it('defend: disc at the gather point; fleets without a lead ship are skipped', () => {
        const marks = fleetPostureMarks({ shipGroups: [fleet({ posture: FleetPosture.Defend, gatherPoint: pt(3, 4), postureRangeSquared: 9e6 }), fleet({ leadShip: null, attackPoint: pt(0, 0) }), null] } as never);
        expect(marks).toEqual([{ posture: 'defend', x: 3, y: 4, radius: 3000, color: POSTURE_DEFEND_COLOR, from: null }]);
    });
});

describe('long range scanners', () => {
    it('bases and stationary ships draw a disc of 1.2 x the sensor range', () => {
        const discs = longRangeScannerDiscs({
            longRangeScanners: [
                { role: BuiltObjectRole.Base, currentSpeed: 5, xpos: 100.7, ypos: 50.2, sensorLongRange: 1000 },
                { role: BuiltObjectRole.Military, currentSpeed: 0, xpos: 0, ypos: 0, sensorLongRange: 500 },
                { role: BuiltObjectRole.Military, currentSpeed: 30, xpos: 0, ypos: 0, sensorLongRange: 500 },
                null,
            ],
        } as never);
        expect(discs).toEqual([
            { x: 100, y: 50, radius: 1200 },
            { x: 0, y: 0, radius: 600 },
        ]);
    });
    it('shows with the backdrops: nothing at f <= 70, fading in below 210', () => {
        expect(scannerLayerFade(70)).toBe(0);
        expect(scannerLayerFade(140)).toBeCloseTo(1 / 3);
        expect(scannerLayerFade(209)).toBeCloseTo(139 / 210);
        expect(scannerLayerFade(210)).toBe(1);
        expect(scannerLayerFade(5000)).toBe(1);
    });
});
