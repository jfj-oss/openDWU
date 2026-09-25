// Empire.6.cs 1991-2180 PurchaseNewBuiltObject (src/sim/construction/empireConstruction.ts) and the player orders that
// call it (src/sim/player/executeShipAction.ts: Main.Part7.cs 379 Build at a base, 1180 Build at a colony, 895 →
// Main.Part4.cs 2826 method_539 BuildColonize), on the seed-1 harness game. Expectations are hand-worked from the C#.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import { HabitatCategoryType, HabitatType, type Habitat } from '../src/sim/types';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { findNewestCanBuild } from '../src/sim/designGeneration';
import { canEmpireColonizeHabitat } from '../src/sim/exploration';
import { stateDigest } from '../src/sim/tick/digest';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { purchaseNewBuiltObjectAt, queueOf } from '../src/sim/construction/empireConstruction';
import { ShipAction, ShipActionType } from '../src/sim/player/shipAction';
import { executeShipAction } from '../src/sim/player/executeShipAction';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function newGame(): Game {
    return createTickGame(gameData);
}

/** Galaxy.4.cs GenerateBuiltObjectName numbered names: BuildCount as "000". */
function numbered(name: string, n: number): string {
    return name + ' ' + String(n).padStart(3, '0');
}

describe('Build at the space port (Main.Part7.cs 379 → Empire.6.cs 2098 PurchaseNewBuiltObject(design, BuiltObject yard))', () => {
    it('queues one escort at the port, named, charged the purchase price, 0 Rnd draws', () => {
        const { galaxy: g, playerEmpire: e } = newGame();
        const port = e.spacePorts[0];
        expect(port).toBeDefined();
        const d = findNewestCanBuild(e.designs, BuiltObjectSubRole.Escort, e)!;
        expect(d).not.toBeNull();
        const price = d.calculateCurrentPurchasePrice(g);
        const money0 = e.stateMoney;
        const buildCount0 = d.buildCount;
        const q = queueOf(port)!;
        const wait0 = q.constructionWaitQueue!.length;
        const bos0 = g.builtObjects.length;
        const draws0 = g.rnd.drawCount;

        const r = executeShipAction(g, e, port, ShipAction.forMissionAt(BuiltObjectMissionType.Build, port, { x: 0, y: 0 }, d), false);

        expect(r.ok).toBe(true);
        expect(r.message).toBeUndefined();
        expect(g.builtObjects.length).toBe(bos0 + 1);
        const b = g.builtObjects[bos0]!;
        expect(q.constructionWaitQueue!.slice(wait0)).toEqual([b]);
        // Escorts take GenerateBuiltObjectName's numbered branch: "<design> <BuildCount:000>" (Empire.6.cs 2121/2132/2135).
        expect(b.name).toBe(numbered(d.name, buildCount0 + 1));
        expect(d.buildCount).toBe(buildCount0 + 1);
        expect(b.design).toBe(d);
        expect(b.builtAt).toBe(port);
        expect(b.parentBuiltObject).toBe(port);
        expect(b.purchasePrice).toBe(price);
        // Main.Part7.cs 369-378: an escort is state-owned (flag = true) with NewBuiltObjectShouldBeAutomated's value.
        expect(b.owner).toBe(e);
        expect(e.builtObjects).toContain(b);
        // Empire.6.cs 2160-2163: StateMoney -= num.
        expect(e.stateMoney).toBe(money0 - price);
        // Rnd: 0. GenerateBuiltObjectName(design) and GenerateBuiltObjectName(design, port.ParentHabitat) both take the
        // numbered branch (no SelectUniqueBuiltObjectName); not a mining station (no surface point / heading);
        // AddBuiltObjectToGalaxy with a BuiltObject parent and offsetLocationFromParent: false draws nothing;
        // ProcureConstructionComponents / CreateOrder draw nothing.
        expect(g.rnd.drawCount - draws0).toBe(0);
    }, 300000);

    it('unaffordable: ok:false, no message box in the C#, nothing changes', () => {
        const { galaxy: g, playerEmpire: e } = newGame();
        const port = e.spacePorts[0];
        const d = findNewestCanBuild(e.designs, BuiltObjectSubRole.Escort, e)!;
        const price = d.calculateCurrentPurchasePrice(g);
        e.stateMoney = price - 1.0;
        const digest0 = stateDigest(g);
        const draws0 = g.rnd.drawCount;
        const buildCount0 = d.buildCount;
        const bos0 = g.builtObjects.length;
        const orders0 = g.orders.count;
        const wait0 = queueOf(port)!.constructionWaitQueue!.length;

        const r = executeShipAction(g, e, port, ShipAction.forMissionAt(BuiltObjectMissionType.Build, port, { x: 0, y: 0 }, d), false);

        // Empire.6.cs 2108-2119: num > StateMoney → flag false → null. Main.Part7.cs 379-381: `== null` has an empty
        // body — the original shows no GameText (the action menu greys the item out instead, Main.Part8.cs 1843).
        expect(r.ok).toBe(false);
        expect(r.message).toBe('PurchaseNewBuiltObject returned null (Main.Part7.cs:379: no message)');
        expect(e.stateMoney).toBe(price - 1.0);
        expect(d.buildCount).toBe(buildCount0);
        expect(g.builtObjects.length).toBe(bos0);
        expect(g.orders.count).toBe(orders0);
        expect(queueOf(port)!.constructionWaitQueue!.length).toBe(wait0);
        expect(g.rnd.drawCount).toBe(draws0);
        expect(stateDigest(g)).toBe(digest0);
    }, 300000);
});

describe('BuildColonize (Main.Part7.cs 880-895 → Main.Part4.cs 2826 method_539)', () => {
    it('buys a colony ship at the capital and sends it to colonize the target', () => {
        const { galaxy: g, playerEmpire: e } = newGame();
        const design = findNewestCanBuild(e.designs, BuiltObjectSubRole.ColonyShip, e)!;
        expect(design).not.toBeNull();
        // Setup: at the start no unowned Continental planet is within Empire.4.cs 4408's 3,000,000 colonization range, so
        // give the player the Ice colonization ability (as its research would, Empire.3.cs 2184 ReviewColonizationTypes)
        // and target the home system's Ice planet.
        e.canColonizeIce = true;
        const cap = e.capital!;
        const target = g.habitats.find((h: Habitat) => h.systemIndex === cap.systemIndex && h.type === HabitatType.Ice && h.category === HabitatCategoryType.Planet && h.owner === null);
        expect(target).toBeDefined();
        expect(canEmpireColonizeHabitat(g, e, e, target!, e.colonizableHabitatTypesForEmpire(), design)).toBe(true);
        const price = design.calculateCurrentPurchasePrice(g);
        const money0 = e.stateMoney;
        const buildCount0 = design.buildCount;
        const bos0 = g.builtObjects.length;
        const draws0 = g.rnd.drawCount;

        const r = executeShipAction(g, e, target!, ShipAction.forAction(ShipActionType.BuildColonize, target!), false);

        expect(r.ok).toBe(true);
        expect(g.builtObjects.length).toBe(bos0 + 1);
        const b = g.builtObjects[bos0]!;
        expect(b.subRole).toBe(BuiltObjectSubRole.ColonyShip);
        // One colony: method_539's yard loop picks it (population ≥ BuildColonyShipPopulationRequirement).
        expect(e.colonies.length).toBe(1);
        expect(b.builtAt).toBe(e.colonies[0]);
        expect(queueOf(e.colonies[0])!.constructionWaitQueue).toContain(b);
        expect(b.owner).toBe(e);
        expect(e.stateMoney).toBe(money0 - price);
        // Main.Part4.cs 2867: ?.AssignMission(Colonize, habitat_9, null, Normal, manuallyAssigned: true).
        const m = builtObjectMission(b.mission)!;
        expect(m).not.toBeNull();
        expect(m.type).toBe(BuiltObjectMissionType.Colonize);
        expect(m.targetHabitat).toBe(target);
        expect(m.priority).toBe(BuiltObjectMissionPriority.Normal);
        expect(m.manuallyAssigned).toBe(true);
        // Rnd: 3. Empire.6.cs 2016 GenerateBuiltObjectName(design, colony): colony ships take the unique-name branch,
        // Galaxy.5.cs 2356 SelectRandomUniqueStandardShipName = Next(0, 127), Next(0, 125), Next(0, 7) (≥ 2 on this seed,
        // so no Next(0, 3)). Not a base sub-role (no surface point / heading, 2023); AddBuiltObjectToGalaxy with
        // offsetLocationFromParent: false draws nothing; method_539's yard choice, ProcureConstructionComponents and
        // AssignMission(Colonize) draw nothing.
        expect(g.rnd.drawCount - draws0).toBe(3);
        expect(design.buildCount).toBe(buildCount0 + 1);
    }, 300000);
});

describe('purchaseNewBuiltObjectAt (Empire.6.cs 1996, Habitat yard with a chosen point)', () => {
    it('a space port at a far point is pulled in to Diameter/8 + 10 along the C# CalculateAngleFromCoords angle', () => {
        const { galaxy: g, playerEmpire: e } = newGame();
        const colony = e.colonies[0];
        const d = findNewestCanBuild(e.designs, BuiltObjectSubRole.SmallSpacePort, e)!;
        expect(d).not.toBeNull();
        const x = Math.trunc(colony.xpos) + 600;
        const y = Math.trunc(colony.ypos) - 800;
        const draws0 = g.rnd.drawCount;
        const money0 = e.stateMoney;
        const b = purchaseNewBuiltObjectAt(g, e, d, colony, x, y, true, true);
        expect(b).not.toBeNull();
        // Empire.6.cs 2016: space ports are named "<yard> Space Port" (no Rnd).
        expect(b!.name).toBe(colony.name + ' Space Port');
        const x2 = x - colony.xpos;
        const y2 = y - colony.ypos;
        const num2 = Math.trunc(colony.diameter / 8) + 10.0;
        const num3 = Math.sqrt(y2 * y2 + x2 * x2);
        expect(num3).toBeGreaterThan(num2);
        // Galaxy.6.cs 2737: x >= centerX, y < centerY → Asin((y - centerY) / distance) (negative: north-east).
        const num4 = Math.asin(y2 / num3);
        // Empire.6.cs 2061-2062 set ParentOffset = (x2, y2); AddBuiltObjectToGalaxy(…, (int)x2, (int)y2) (2067,
        // Empire.7.cs 1326) then overwrites it with the truncated offsets.
        expect(b!.parentOffsetX).toBe(Math.trunc(Math.cos(num4) * num2));
        expect(b!.parentOffsetY).toBe(Math.trunc(Math.sin(num4) * num2));
        expect(b!.parentOffsetY).toBeLessThan(0);
        expect(b!.parentHabitat).toBe(colony);
        expect(b!.xpos).toBe(colony.xpos + Math.trunc(Math.cos(num4) * num2));
        expect(b!.ypos).toBe(colony.ypos + Math.trunc(Math.sin(num4) * num2));
        expect(e.stateMoney).toBe(money0 - d.calculateCurrentPurchasePrice(g));
        // Rnd: only SelectRandomHeading (1 NextDouble) — Empire.6.cs 2063.
        expect(g.rnd.drawCount - draws0).toBe(1);
    }, 300000);
});
