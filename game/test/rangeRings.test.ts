import { describe, expect, it } from 'vitest';
import type { BuiltObject } from '../src/sim/builtObject';
import { currentRange } from '../src/sim/movement';
import { fleetRangeRadii, shipRangeRadii } from '../src/render/rangeRings';

function ship(fuel: number, warp = 1000): BuiltObject {
    return { hasBeenDestroyed: false, warpSpeed: warp, warpSpeedFuelBurn: 10, staticEnergyConsumption: 0, fuelCapacity: 1000, currentFuel: fuel, cruiseSpeed: 100, reactorCycleFuelConsumption: 1000, reactorStorageCapacity: 0 } as unknown as BuiltObject;
}

describe('range rings', () => {
    it('range100 is the sim currentRange, range45 is 45% of it', () => {
        const b = ship(500);
        const r = shipRangeRadii(b)!;
        expect(r.range100).toBeCloseTo(currentRange(b, 0));
        expect(r.range45).toBeCloseTo(r.range100 * 0.45);
        expect(shipRangeRadii(ship(1000))!.range100).toBeCloseTo(r.range100 * 2);
    });
    it('no rings without a hyperdrive or fuel', () => {
        expect(shipRangeRadii(ship(500, 0))).toBeNull();
        expect(shipRangeRadii(ship(0))).toBeNull();
    });
    it('a fleet uses its worst ship', () => {
        const f = fleetRangeRadii([ship(1000), ship(250)])!;
        expect(f.range100).toBeCloseTo(shipRangeRadii(ship(250))!.range100);
        expect(fleetRangeRadii([ship(1000), ship(0)])).toBeNull();
    });
});
