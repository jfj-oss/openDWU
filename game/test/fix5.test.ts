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
import { calculateAngleFromCoords } from '../src/sim/galaxy';
import { BuiltObject as BuiltObjectClass, determineBuiltObjectIsState } from '../src/sim/builtObject';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { canBuiltObjectColonizeHabitat } from '../src/sim/construction/constructionQueue';
import { canBuildDesign } from '../src/sim/designGeneration';
import { BuiltObjectMission, BuiltObjectMissionPriority, BuiltObjectMissionType, Command, CommandAction } from '../src/sim/missions/mission';
import { cmdColonize } from '../src/sim/missions/cmdTroops';
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

describe('item 3: Galaxy.6.cs 2737 CalculateAngleFromCoords; BuiltObject.2.cs 1108-1109 Colonize → PurchaseNewBuiltObject', { timeout: 600000 }, () => {
    it('has no negation in the (x >= centerX, y < centerY) branch, and is the one shared helper', () => {
        const d = Math.sqrt(200);
        expect(calculateAngleFromCoords(10, -10, 0, 0, d)).toBe(Math.asin(-10 / d)); // was −asin(...) (mirrored)
        expect(calculateAngleFromCoords(10, 10, 0, 0, d)).toBe(Math.asin(10 / d));
        expect(calculateAngleFromCoords(-10, 10, 0, 0, d)).toBe(Math.PI / 2 + (Math.PI / 2 - Math.asin(10 / d)));
        expect(calculateAngleFromCoords(-10, -10, 0, 0, d)).toBe(-(Math.PI / 2) - (Math.PI / 2 + Math.asin(-10 / d)));
    });

    it('a Colonize completion with Policy.ColonyActionForNewBuildDesign buys the base at the new colony (no throw)', () => {
        const game = createTickGame(gameData);
        const g = game.galaxy;
        // No colony ship exists at the start: build one for the player (as the placement tests do).
        const empire = g.playerEmpire!;
        const colonyDesign = empire.designs.find((d) => d.subRole === BuiltObjectSubRole.ColonyShip)!;
        expect(colonyDesign).toBeDefined();
        const ship = new BuiltObjectClass(colonyDesign, 'Colonist', g, true);
        ship.reDefine();
        empire.addBuiltObjectToGalaxy(ship, empire.colonies[0], false, true, 200, 0, false);
        // Allow every colonizable type so an uninhabited planet qualifies (no Rnd repel roll on the populated branch).
        empire.canColonizeContinental = empire.canColonizeMarshySwamp = empire.canColonizeDesert = true;
        empire.canColonizeOcean = empire.canColonizeIce = empire.canColonizeVolcanic = true;
        const target = g.habitats.find((h) => (h.owner === null || h.owner === g.independentEmpire) && h.population.totalAmount <= 0 && canBuiltObjectColonizeHabitat(g, empire, ship, h).result)!;
        expect(target).toBeDefined();
        const design = empire.designs.find((d) => d.role === BuiltObjectRole.Base && d.subRole === BuiltObjectSubRole.MonitoringStation && canBuildDesign(empire, d, false))
            ?? empire.designs.find((d) => d.role === BuiltObjectRole.Base && canBuildDesign(empire, d, false))!;
        expect(design).toBeDefined();
        empire.policy!.colonyActionForNewBuildDesign = design;
        empire.stateMoney = 1e9;
        ship.xpos = target.xpos;
        ship.ypos = target.ypos;
        const command = Command.forTarget(CommandAction.Colonize, target);
        const mission = new BuiltObjectMission(g, ship, BuiltObjectMissionType.Colonize, target, null, BuiltObjectMissionPriority.Normal);
        const buildCount = design.buildCount;
        const money = empire.stateMoney;
        const price = design.calculateCurrentPurchasePrice(g);
        const isState = determineBuiltObjectIsState(design.subRole);
        cmdColonize({ galaxy: g, bo: ship, mission, command, timePassed: 0.1, time: g.nowMs, starDate: 0, targetX: target.xpos, targetY: target.ypos, indexX: 0, indexY: 0, xpos: ship.xpos, ypos: ship.ypos } as Parameters<typeof cmdColonize>[0]);
        expect(target.empire).toBe(empire);
        // Empire.6.cs 2001-2016: affordable → BuildCount++, then paid from StateMoney (state) or private funds.
        expect(design.buildCount).toBe(buildCount + 1);
        if (isState) expect(empire.stateMoney).toBeLessThanOrEqual(money - price + 1e-6);
    });
});
