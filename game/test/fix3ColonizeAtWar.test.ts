// Galaxy.cs 3613 CheckEmpireTerritoryCanColonizeHabitat(empire, habitat, out canColonizeBecauseAtWar): a habitat in a
// system owned by another empire may be colonized only when the colonizing empire is at war with the owner
// (Galaxy.cs 3620-3626: ObtainDiplomaticRelation(owner).Type == War -> canColonizeBecauseAtWar = true, return true).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 180000);

describe('CheckEmpireTerritoryCanColonizeHabitat at-war branch', () => {
    it('refuses another empire\'s system unless at war with its owner', () => {
        const g = cachedTickGame(gameData).galaxy;
        const a = g.empires[0];
        const b = g.empires[1];
        const capital = b.capital!;
        const sys = g.systems[g.determineHabitatSystemStar(capital).systemIndex];
        expect(sys.dominantEmpire?.empire).toBe(b);
        const target = sys.habitats.find((h) => h !== sys.systemStar && h !== capital && h.empire === null)!;
        expect(target).toBeDefined();

        const out = { canColonizeBecauseAtWar: true };
        expect(g.checkEmpireTerritoryCanColonizeHabitat(a, target, out)).toBe(false);
        expect(out.canColonizeBecauseAtWar).toBe(false);
        // The owner itself may colonize its own system (not disputed at start).
        expect(g.checkEmpireTerritoryCanColonizeHabitat(b, target)).toBe(!(sys.otherEmpires != null && sys.otherEmpires.length > 0));

        obtainDiplomaticRelation(a, b).type = DiplomaticRelationType.War;
        expect(g.checkEmpireTerritoryCanColonizeHabitat(a, target, out)).toBe(true);
        expect(out.canColonizeBecauseAtWar).toBe(true);
        expect(g.checkEmpireTerritoryCanColonizeHabitat(a, target)).toBe(true);
    }, 300000);
});
