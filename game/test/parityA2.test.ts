// Parity fixes A2 (docs/parity/empire-ai-economy.md, ships-combat-fleets.md, galaxy-world-events.md): each block pins one
// C# behaviour that the port previously skipped or approximated.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Empire } from '../src/sim/empire';
import { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { PirateRelationType, obtainPirateRelation } from '../src/sim/pirateRelations';
import { checkSystemEnemyShipLevel, determineNewSpacePortLocations } from '../src/sim/stationPlacement';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function newGame(): Game {
    return cachedTickGame(gameData);
}

function mobileWarship(g: Game, owner: Empire): BuiltObject {
    const bo = g.galaxy.builtObjects.find((b) => b != null && b.empire === owner && b.role === BuiltObjectRole.Military && b.topSpeed > 0 && b.isFunctional && b.firepowerRaw > 0);
    expect(bo, `a mobile functional warship of ${owner.name}`).toBeDefined();
    return bo!;
}

describe('Empire.6.cs 3165 CheckSystemEnemyShipLevel', () => {
    it('sums FirepowerRaw of mobile functional ships of war enemies / non-protection pirates in SystemVisibility.Threats', () => {
        const g = newGame();
        const e = g.playerEmpire;
        const others = g.galaxy.empires.filter((x) => x !== e && x.pirateEmpireBaseHabitat === null && x !== g.galaxy.independentEmpire);
        const enemy = others.find((x) => g.galaxy.builtObjects.some((b) => b != null && b.empire === x && b.role === BuiltObjectRole.Military && b.topSpeed > 0 && b.isFunctional && b.firepowerRaw > 0))!;
        const ship = mobileWarship(g, enemy);
        const colony = e.colonies[0];
        const sv = e.visibility.systemVisibility[colony.systemIndex];
        sv.threats = [ship];
        const rel = obtainDiplomaticRelation(e, enemy);
        rel.type = DiplomaticRelationType.NotMet;
        expect(checkSystemEnemyShipLevel(e, colony.systemIndex)).toBe(0);
        rel.type = DiplomaticRelationType.War;
        expect(checkSystemEnemyShipLevel(e, colony.systemIndex)).toBe(ship.firepowerRaw);
        sv.threats = [ship, ship];
        expect(checkSystemEnemyShipLevel(e, colony.systemIndex)).toBe(2 * ship.firepowerRaw);
        // Our own ships never count.
        sv.threats = [mobileWarship(g, e)];
        expect(checkSystemEnemyShipLevel(e, colony.systemIndex)).toBe(0);

        const pirates = g.galaxy.pirateEmpires.find((p) => g.galaxy.builtObjects.some((b) => b != null && b.empire === p && b.role === BuiltObjectRole.Military && b.topSpeed > 0 && b.isFunctional && b.firepowerRaw > 0));
        if (pirates !== undefined) {
            const pship = mobileWarship(g, pirates);
            sv.threats = [pship];
            const pr = obtainPirateRelation(e, pirates);
            pr.type = PirateRelationType.Protection;
            expect(checkSystemEnemyShipLevel(e, colony.systemIndex)).toBe(0);
            pr.type = PirateRelationType.None;
            expect(checkSystemEnemyShipLevel(e, colony.systemIndex)).toBe(pship.firepowerRaw);
        }
    });

    it('DetermineNewSpacePortLocations(excludeColoniesWithEnemiesPresent) skips a colony whose system holds an enemy warship', () => {
        const g = newGame();
        // The seed-1 start gives each empire one colony (with its port), so offer the player an independent colony in a
        // portless system as the candidate (with ConstructionSpaceportMinimumDistance 0 any portless system qualifies).
        const e = g.playerEmpire;
        e.policy!.constructionSpaceportMinimumDistance = 0;
        const portSystems = new Set(e.spacePorts.map((p) => p.parentHabitat?.systemIndex));
        const colony = g.galaxy.habitats.find((h) => h.empire === g.galaxy.independentEmpire && h.population.totalAmount > 0 && !portSystems.has(h.systemIndex))!;
        expect(colony).toBeDefined();
        expect(determineNewSpacePortLocations(g.galaxy, e, [colony], 1, true)).toEqual([colony]);
        const enemy = g.galaxy.empires.find((x) => x !== e && x.pirateEmpireBaseHabitat === null && x !== g.galaxy.independentEmpire && g.galaxy.builtObjects.some((b) => b != null && b.empire === x && b.role === BuiltObjectRole.Military && b.topSpeed > 0 && b.isFunctional && b.firepowerRaw > 0))!;
        obtainDiplomaticRelation(e, enemy).type = DiplomaticRelationType.War;
        e.visibility.systemVisibility[colony.systemIndex].threats = [mobileWarship(g, enemy)];
        expect(determineNewSpacePortLocations(g.galaxy, e, [colony], 1, true)).toEqual([]);
        expect(determineNewSpacePortLocations(g.galaxy, e, [colony], 1, false)).toEqual([colony]);
    });
});
