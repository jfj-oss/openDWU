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
import { MIN_TIME, galaxyStarDate } from '../src/sim/tick/simTime';
import { ShipActionType, createShipAction } from '../src/sim/player/shipAction';
import { calculateValueOfCargoForEmpire, executeShipAction, findResalePriceOfShip } from '../src/sim/player/executeShipAction';
import { ComponentStatus } from '../src/sim/builtObjectComponent';
import { calculateCrewLevel } from '../src/sim/achievements';
import { checkAtWar } from '../src/sim/forceStructure';
import { determineEmpireRelationshipFactors } from '../src/sim/empireRelationshipFactors';
import { canDeployXaraktorVirus } from '../src/sim/player/orderMenu';
import { checkWithinDistancePotential } from '../src/sim/movement';
import { checkWithinDistancePotential as damageCheckWithinDistancePotential } from '../src/sim/combat/damage';
import { calculateAngleFromCoords } from '../src/sim/galaxy';
import { BuiltObject as BuiltObjectClass, determineBuiltObjectIsState } from '../src/sim/builtObject';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { canBuiltObjectColonizeHabitat } from '../src/sim/construction/constructionQueue';
import { canBuildDesign, canBuildDesignTech } from '../src/sim/designGeneration';
import { BuiltObjectMission, BuiltObjectMissionPriority, BuiltObjectMissionType, Command, CommandAction } from '../src/sim/missions/mission';
import { cmdColonize } from '../src/sim/missions/cmdTroops';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame, tickGameOptions } from './helpers/tickGame';
import { createGame } from '../src/sim/game';
import { PiratePlayStyle } from '../src/sim/pirates';
import { PirateRelationType, changePirateRelation, obtainPirateRelation } from '../src/sim/pirateRelations';
import { calculatePirateProtectionPricePerMonth } from '../src/sim/pirates/pirateRelationsAI';
import { determineDesirePirateProtection } from '../src/sim/pirates/pirateAI';
import { price0 } from '../src/sim/pirates/missionsMarket';
import { gameText } from '../src/sim/colonyTick';
import { listProposals, submitProposal } from '../src/sim/player/diplomacyProposals';

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

describe('item 4: pirate player conversation (Main.Part9.cs:175-190; Main.Part10.cs:5088-5131)', { timeout: 600000 }, () => {
    it('offers protection / cancel / trade to a pirate player and evaluates them like method_237', () => {
        const o = tickGameOptions(gameData);
        const game = createGame({ ...o, player: { ...o.player, playAsPirate: true, piratePlayStyle: PiratePlayStyle.Balanced, name: 'Test Pirates' } });
        const g = game.galaxy;
        const player = g.playerEmpire!;
        expect(player.pirateEmpireBaseHabitat).not.toBeNull();
        const other = g.empires.find((e) => e.pirateEmpireBaseHabitat === null && e.active)!;
        // Meet them (DiplomaticRelationListView.cs 171-176 lists pirate relations that are not NotMet).
        obtainPirateRelation(player, other).type = PirateRelationType.None;
        obtainPirateRelation(other, player).type = PirateRelationType.None;

        const options = listProposals(g, player, other);
        const price = calculatePirateProtectionPricePerMonth(g, player, other).price;
        expect(options.map((x) => x.id)).toEqual(['PIRATE_PROTECTIONPROPOSE_OFFER', 'DEAL_BEGIN:trade']);
        expect(options[0].cost).toBe(price);
        expect(options[0].label).toBe(gameText('Propose Pirate Protection', price0(price)));

        const wants = determineDesirePirateProtection(g, other, player);
        const r = submitProposal(g, player, other, 'PIRATE_PROTECTIONPROPOSE_OFFER');
        expect(r.ok).toBe(true);
        expect(r.reply).toBe(wants ? 'PIRATE_PROTECTIONPROPOSE_OFFER_ACCEPT' : 'PIRATE_PROTECTIONPROPOSE_OFFER_REJECT');
        if (wants) {
            // AcceptPirateProtection (Empire.3.cs 4213): the pirate's relation becomes Protection with the monthly fee.
            expect(obtainPirateRelation(player, other).type).toBe(PirateRelationType.Protection);
            expect(obtainPirateRelation(player, other).monthlyProtectionFeeToThisEmpire).toBe(price);
        } else {
            changePirateRelation(player, other, PirateRelationType.Protection, galaxyStarDate(g), price);
        }

        expect(listProposals(g, player, other).map((x) => x.id)).toEqual(['CANCELPIRATEPROTECTION', 'DEAL_BEGIN:trade']);
        const offense = obtainPirateRelation(other, player).calculateOffenseOverCancellingProtection(galaxyStarDate(g));
        const before = obtainPirateRelation(other, player).evaluationProtectionCancelled;
        const c = submitProposal(g, player, other, 'CANCELPIRATEPROTECTION');
        expect(c.ok).toBe(true);
        expect(['CANCELTREATY_RESPONSE_ANGRY', 'CANCELTREATY_RESPONSE_NEUTRAL', 'CANCELTREATY_RESPONSE_FRIENDLY']).toContain(c.reply);
        expect(obtainPirateRelation(player, other).type).toBe(PirateRelationType.None);
        expect(obtainPirateRelation(other, player).evaluationProtectionCancelled).toBe(Math.fround(before + offense));

        const t = submitProposal(g, player, other, 'DEAL_BEGIN:trade');
        expect(t.ok).toBe(true);
        expect(t.trade).not.toBeNull();
    });
});

describe('item 5: BaconMain.cs 160-213 GiveBuiltObject by a "Romulan" / "Mining Company" empire (BaconBuiltObject.cs 3860)', { timeout: 600000 }, () => {
    it('the receiver pays FindResalePriceOfShip to the giver, then method_347 hands the ship over', () => {
        const game = createTickGame(gameData);
        const g = game.galaxy;
        const player = g.playerEmpire!;
        player.name = 'Romulan Star Empire';
        const other = g.empires.find((e) => e !== player && e.pirateEmpireBaseHabitat === null)!;
        const ship = player.builtObjects.find((b) => b.role !== BuiltObjectRole.Base && b.builtAt === null && b.topSpeed > 0)!;
        expect(ship).toBeDefined();

        // Hand-worked BaconBuiltObject.cs 3860-3899 for this ship (no unbuilt components at the start).
        expect(ship.components.items.some((x) => x.status === ComponentStatus.Unbuilt)).toBe(false);
        let expected = ship.design!.calculateCurrentPurchasePrice(g) * (1.0 + player.tradeBonus - other.tradeBonus);
        if (!canBuildDesignTech(other, ship.design!)) expected *= 2.0;
        const crew = calculateCrewLevel(ship);
        expected *= ({ green: 0.9, experienced: 1.1, veteran: 1.2, elite: 1.3, legendary: 1.4 } as Record<string, number>)[crew] ?? 1.0;
        if (ship.role === BuiltObjectRole.Military && checkAtWar(other)) expected *= 1.2;
        if (ship.cargo !== null) expected += calculateValueOfCargoForEmpire(g, ship.cargo, player) * Math.max(0.02, 1 - Math.trunc(player.totalPopulation / 1e9));
        const fuel = ship.currentFuel / Math.max(1, ship.fuelCapacity);
        if (fuel < 0.25) expected *= 0.5;
        else if (fuel > 0.9) expected *= 1.1;
        const factors = determineEmpireRelationshipFactors(player, other).reduce((a, f) => a + f.value, 0.0);
        const price = Math.trunc(expected * Math.max(0.0, 1.0 + factors / 100.0));
        expect(findResalePriceOfShip(g, ship, other)).toBe(price);
        expect(price).toBeGreaterThan(0);

        const giverMoney = player.stateMoney;
        const buyerMoney = other.stateMoney;
        const action = createShipAction(ShipActionType.GiveBuiltObject, ship);
        action.target2 = other;
        const r = executeShipAction(g, player, ship, action, false);
        expect(r.ok).toBe(true);
        expect(player.stateMoney).toBe(giverMoney + price);
        expect(other.stateMoney).toBe(buyerMoney - price);
        expect(ship.empire).toBe(other); // Main.Part7.cs 188-206 TakeOwnershipOfBuiltObject — no longer aborted
    });

    it('any other empire gives ships for free', () => {
        const game = createTickGame(gameData);
        const g = game.galaxy;
        const player = g.playerEmpire!;
        const other = g.empires.find((e) => e !== player && e.pirateEmpireBaseHabitat === null)!;
        const ship = player.builtObjects.find((b) => b.role !== BuiltObjectRole.Base && b.builtAt === null && b.topSpeed > 0)!;
        const giverMoney = player.stateMoney;
        const action = createShipAction(ShipActionType.GiveBuiltObject, ship);
        action.target2 = other;
        executeShipAction(g, player, ship, action, false);
        expect(player.stateMoney).toBe(giverMoney);
        expect(ship.empire).toBe(other);
    });
});
