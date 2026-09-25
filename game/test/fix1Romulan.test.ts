// BaconBuiltObject.cs 2823-2905 ModMyShip "Romulan" bonuses: an empire name containing "Romulan" must not crash ReDefine,
// and its ships get the bonuses (fuel burn halved, turn rate doubled).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import type { GameData } from '../src/sim/data/gameData';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

describe('BaconBuiltObject ModMyShip (Romulan)', () => {
    it('applies the bonuses without throwing', () => {
        const g = createTickGame(gameData).galaxy;
        const e = g.empires[1];
        const ship = e.builtObjects.find((b) => b.cruiseSpeedFuelBurn > 1 && b.turnRate > 0)!;
        ship.reDefine();
        const burn0 = ship.cruiseSpeedFuelBurn;
        const turn0 = ship.turnRate;
        e.name = 'Romulan Star Empire';
        expect(() => ship.reDefine()).not.toThrow();
        expect(ship.cruiseSpeedFuelBurn).toBe(Math.trunc(burn0 / 2));
        expect(ship.turnRate).toBe(Math.fround(turn0 * 2));
    });
});
