// M4z6 — pirate-control readers & C# leftovers (tasks/M4-deferred-plan.md M4z6): unit tests against the C# sources.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { PlanetaryFacilityType } from '../src/sim/researchSystem';
import { PlanetaryFacility, definitionsFindFacilityByType, planetaryFacilityDefinitionsStatic } from '../src/sim/construction/facilities';
import { inflictBombardDamage, selectRandomFacility } from '../src/sim/combat/damage';
import { PirateColonyControl, checkColonyRevenueFromPirateControl } from '../src/sim/pirates/pirateColonyControl';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function aiEmpire(g: Galaxy): Empire {
    return g.empires.find((e) => e !== g.playerEmpire)!;
}
function facility(g: Galaxy, type: PlanetaryFacilityType, progress = 1): PlanetaryFacility {
    return new PlanetaryFacility(definitionsFindFacilityByType(planetaryFacilityDefinitionsStatic(g), type)!, progress);
}
/** Replace Galaxy.Rnd with a deterministic stub: Next(min, max) → min, NextDouble → 0. */
function stubRnd(g: Galaxy): void {
    const r = g.rnd as unknown as { next: (a?: number, b?: number) => number; nextDouble: () => number };
    r.next = (a?: number, b?: number) => (b === undefined ? 0 : (a ?? 0));
    r.nextDouble = () => 0;
}

describe('M4z6 (1) Habitat.cs 6070 CheckColonyRevenueFromPirateControl', () => {
    it('true only for a pirate faction on a colony it does not own', () => {
        const g = createTickGame(gameData).galaxy;
        const e = aiEmpire(g);
        const pirate = g.pirateEmpires[0];
        const cap = e.capital!;
        expect(checkColonyRevenueFromPirateControl(cap, e)).toBe(false);
        expect(checkColonyRevenueFromPirateControl(cap, null)).toBe(false);
        expect(checkColonyRevenueFromPirateControl(cap, pirate)).toBe(true);
        expect(checkColonyRevenueFromPirateControl({ empire: pirate }, pirate)).toBe(false);
    });
});
