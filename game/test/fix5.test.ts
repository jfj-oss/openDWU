// fix5: player-layer review fixes (tasks/REVIEW-player-layer-2026-09-25.md). Expectations are hand-worked from the C#.
import { beforeAll, describe, expect, it } from 'vitest';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Habitat } from '../src/sim/types';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { PlanetaryFacility } from '../src/sim/construction/facilities';
import { WonderType } from '../src/sim/researchSystem';
import { MIN_TIME } from '../src/sim/tick/simTime';
import { ShipActionType, createShipAction } from '../src/sim/player/shipAction';
import { executeShipAction } from '../src/sim/player/executeShipAction';
import { canDeployXaraktorVirus } from '../src/sim/player/orderMenu';
import { checkWithinDistancePotential } from '../src/sim/movement';
import { checkWithinDistancePotential as damageCheckWithinDistancePotential } from '../src/sim/combat/damage';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

const startOptions = { ...defaultStartGameOptions(), seed: 1 };

function timeOf(game: Game): GalaxyTime {
    const time = new GalaxyTime();
    time.togglePause();
    time.advance(game.galaxy.nowMs);
    return time;
}

describe('item 1: Empire.LastXaraktorVirusDeploy (Empire.cs 881; Main.Part7.cs 1042; Empire.10.cs 4532)', { timeout: 600000 }, () => {
    it('DeployVirus stamps the player empire, CanDeployXaraktorVirus refuses for 150 s, and the field is saved', () => {
        const game = createTickGame(gameData);
        const g = game.galaxy;
        const player = g.playerEmpire!;
        // Give the player the Xaraktor virus (SpecialFunctionCode 1) and a completed RaceAchievement wonder with Value2 == 2.
        // The stock plagues.txt / facilities.txt define neither (mod data does), so both are copies of stock rows.
        const virus = { ...g.researchStatic!.plagues[0], specialFunctionCode: 1 };
        player.research.enabledPlagues.push(virus);
        const raceWonder = gameData.facilities.find((f) => f.wonderType === WonderType.RaceAchievement)!;
        const wonderDef = { ...raceWonder, value2: 2 };
        const capital = player.capital!;
        capital.facilities ??= [];
        capital.facilities.push(new PlanetaryFacility(wonderDef, 1.0));

        // Empire.cs 881 default DateTime.MinValue: allowed before the first deploy.
        expect(player.lastXaraktorVirusDeploy).toBe(MIN_TIME);
        expect(canDeployXaraktorVirus(g, player).result).toBe(true);

        const target = g.habitats.find((h): h is Habitat => h.population !== null && h.population.totalAmount > 0 && h.empire !== null && h.empire !== player)!;
        expect(target).toBeDefined();
        const action = createShipAction(ShipActionType.DeployVirus, target);
        action.target2 = virus;
        g.nowMs += 5000;
        executeShipAction(g, player, target, action, false);
        expect(player.lastXaraktorVirusDeploy).toBe(g.nowMs);

        // Empire.10.cs 4532: CurrentDateTime - LastXaraktorVirusDeploy must exceed 150 s ("too soon" otherwise).
        const r = canDeployXaraktorVirus(g, player);
        expect(r.result).toBe(false);
        expect(r.virus).toBe(virus);
        expect(r.reason).not.toBe('');
        g.nowMs += 150_000;
        expect(canDeployXaraktorVirus(g, player).result).toBe(false); // exactly 150 s: not > 150
        g.nowMs += 1;
        expect(canDeployXaraktorVirus(g, player).result).toBe(true);

        // Empire is a registered class: the new field round-trips through the save.
        const text = serializeGame(game, timeOf(game), startOptions);
        const restored = deserializeGame(text, gameData);
        expect(restored.game.galaxy.playerEmpire!.lastXaraktorVirusDeploy).toBe(player.lastXaraktorVirusDeploy);
    });
});

describe('item 2: Galaxy.7.cs 747 CheckWithinDistancePotential (distance doubled, axes ORed)', () => {
    it('is one shared port and matches the C# test', () => {
        expect(damageCheckWithinDistancePotential).toBe(checkWithinDistancePotential);
        // distance += distance; |x1 - x2| < distance || |y1 - y2| < distance
        expect(checkWithinDistancePotential(100, 0, 0, 150, 150)).toBe(true); // within 2d on both (the old copy: false)
        expect(checkWithinDistancePotential(100, 0, 0, 199, 50000)).toBe(true); // one axis suffices (OR)
        expect(checkWithinDistancePotential(100, 0, 0, 50000, -199.5)).toBe(true);
        expect(checkWithinDistancePotential(100, 0, 0, 200, 200)).toBe(false); // strict <
        expect(checkWithinDistancePotential(100, 0, 0, 300, -250)).toBe(false);
        expect(checkWithinDistancePotential(400.0, 1000, 1000, 1000 + 799.9, 1000 + 5000)).toBe(true);
    });
});
