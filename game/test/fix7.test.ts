// fix7: sim fixes (capital DoTasks at generation, colonize at an independent populated planet, explorer assignment).
// Expectations are hand-worked from the C#.
import { beforeAll, describe, expect, it } from 'vitest';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Habitat } from '../src/sim/types';
import { BuiltObject as BuiltObjectClass } from '../src/sim/builtObject';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { canBuiltObjectColonizeHabitat } from '../src/sim/construction/constructionQueue';
import { checkShouldAttemptColonization } from '../src/sim/construction/empireConstruction';
import { checkColonizationLikeliness } from '../src/sim/tradeItems';
import { BuiltObjectMission, BuiltObjectMissionPriority, BuiltObjectMissionType, Command, CommandAction } from '../src/sim/missions/mission';
import { cmdColonize } from '../src/sim/missions/cmdTroops';
import { EmpireMessageType, type EmpireMessage } from '../src/sim/messages';
import { Random } from '../src/sim/random';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs(); // also loads GameText.txt into the TextResolver table
}, 120000);

/**
 * BuiltObject.2.cs 957-975: the repel roll on a populated independent target. Replays the draws on a copy of the
 * stream: Next(0, 80) − 40, Next(0, 20) (only when likeliness ≤ 0 and < the first roll), Next(0, 20) == 8 fails.
 */
function predictJoins(galaxy: Galaxy, likeliness: number): boolean {
    const r = new Random(0);
    r.setState(galaxy.rnd.getState());
    let joins = true;
    const num107 = r.next(0, 80) - 40;
    if (likeliness <= 0 && likeliness < num107 && r.next(0, 20) !== 1) joins = false;
    if (r.next(0, 20) === 8) joins = false;
    return joins;
}

function setUp(): { g: Galaxy; empire: Empire; target: Habitat; ship: BuiltObjectClass } {
    const game = createTickGame(gameData);
    const g = game.galaxy;
    const empire = g.empires.find((e) => e !== g.playerEmpire && e.pirateEmpireBaseHabitat === null)!;
    const colonyDesign = empire.designs.find((d) => d.subRole === BuiltObjectSubRole.ColonyShip)!;
    const ship = new BuiltObjectClass(colonyDesign, 'Colonist', g, true);
    ship.reDefine();
    empire.addBuiltObjectToGalaxy(ship, empire.colonies[0], false, true, 200, 0, false);
    const target = g.habitats.find((h) => h.owner === g.independentEmpire && h.population.totalAmount > 0 && canBuiltObjectColonizeHabitat(g, empire, ship, h).result)!;
    expect(target).toBeDefined();
    ship.xpos = target.xpos;
    ship.ypos = target.ypos;
    return { g, empire, target, ship };
}

/** Advance galaxy.rnd until the replayed roll gives `joins` (the draws stand in for earlier game activity). */
function steerRoll(g: Galaxy, likeliness: number, joins: boolean): void {
    for (let i = 0; i < 10000 && predictJoins(g, likeliness) !== joins; i++) g.rnd.next(0, 2);
    expect(predictJoins(g, likeliness)).toBe(joins);
}

function colonize(g: Galaxy, ship: BuiltObjectClass, target: Habitat): void {
    const command = Command.forTarget(CommandAction.Colonize, target);
    const mission = new BuiltObjectMission(g, ship, BuiltObjectMissionType.Colonize, target, null, BuiltObjectMissionPriority.Normal);
    cmdColonize({ galaxy: g, bo: ship, mission, command, timePassed: 0.1, time: g.nowMs, starDate: 0, targetX: target.xpos, targetY: target.ypos, indexX: 0, indexY: 0, xpos: ship.xpos, ypos: ship.ypos } as Parameters<typeof cmdColonize>[0]);
}

describe('item 2: BuiltObject.2.cs 936 Colonize at an independent populated planet', { timeout: 600000 }, () => {
    it('a repelled attempt keeps the planet Independent, tears the ship down and sends NewColonyFailed with the C# text', () => {
        const { g, empire, target, ship } = setUp();
        const race = target.population.dominantRace!;
        const likeliness = checkColonizationLikeliness(g, target, empire.dominantRace!);
        steerRoll(g, likeliness, false);
        const before = empire.messages.length;
        colonize(g, ship, target);
        expect(target.empire).toBe(g.independentEmpire);
        expect(ship.hasBeenDestroyed).toBe(true);
        expect(empire.builtObjects.includes(ship)).toBe(false);
        const msgs = (empire.messages as EmpireMessage[]).slice(before);
        expect(msgs.map((m) => m.messageType)).toEqual([EmpireMessageType.NewColonyFailed]);
        // BuiltObject.2.cs 1134-1136: GetText("Colonization attempt failed") (GameText.txt 1342) + "." + text2 (1334).
        expect(msgs[0].description).toBe(`Our attempt to colonize ${target.name} has failed. The existing population of ${race.name}s repelled our colonization attempt.`);
    });

    it('a successful attempt makes it our colony and sends NewColony with the C# text', () => {
        const { g, empire, target, ship } = setUp();
        const race = target.population.dominantRace!;
        const likeliness = checkColonizationLikeliness(g, target, empire.dominantRace!);
        steerRoll(g, likeliness, true);
        const before = empire.messages.length;
        colonize(g, ship, target);
        expect(target.empire).toBe(empire);
        expect(ship.hasBeenDestroyed).toBe(true);
        const msgs = (empire.messages as EmpireMessage[]).slice(before).filter((m) => m.messageType === EmpireMessageType.NewColony);
        expect(msgs.length).toBe(1);
        // GameText.txt 1335 + 1333; any native-bonus sentence follows (BuiltObject.2.cs 1003-1043).
        expect(msgs[0].description.startsWith(`${target.name} has been colonized. The existing population of ${race.name}s have also joined our empire.`)).toBe(true);
    });

    it('the AI only targets an independent colony whose likeliness is ≥ −3 (Empire.6.cs 2280 CheckShouldAttemptColonization)', () => {
        const { g, empire } = setUp();
        for (const h of g.habitats) {
            if (h.owner !== g.independentEmpire || h.population.totalAmount <= 0) continue;
            if (checkColonizationLikeliness(g, h, empire.dominantRace!) < -3) expect(checkShouldAttemptColonization(g, empire, h)).toBe(false);
        }
    });
});
