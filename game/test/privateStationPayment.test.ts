// Who pays when the PLAYER orders a mining station (or another base): the state treasury (Empire.StateMoney) or the
// private sector (Empire.PrivateMoney via PerformPrivateTransaction)?
//
// C# (DistantWorlds.Types):
//   - Construction ship "Build here" / "Build at X" / Expansion Planner (Main.Part8.cs 1751 / 2867, Main.Part4.cs 2871
//     method_540 → a Build mission): BuiltObject.2.cs 1444 case Build. Mining / gas mining stations are not in the
//     flag7 (state-owned) switch (1542-1560), so AddBuiltObjectToGalaxy(isStateOwned: false) puts them in
//     PrivateBuiltObjects and 1589-1592 charges builtObject.Empire.PerformPrivateTransaction(-price) and adds
//     BaconBuiltObject.PrivateSectorBuildOrRefitInvestInInfrastructure(this, price) (= privateBuildCostToStateMoney ×
//     price, BaconBuiltObject.cs 5106) to StateMoney. State bases (space ports, research / monitoring stations,
//     defensive and generic bases, resort bases) are state-owned and charged nothing in cash there (the menus still
//     grey out any design whose price exceeds StateMoney, Main.Part8.cs 1843 / 2898).
//   - Construction yard / colony purchase (ConstructionYardPurchaser.cs 197-207, Main.Part7.cs 379 / 1180):
//     Empire.6.cs 1996 / 2098 PurchaseNewBuiltObject(design, yard, isStateOwned = DetermineBuiltObjectIsState(subRole)
//     (Galaxy.4.cs 2495: Mining / GasMiningStation → false), ...): private → PerformPrivateTransaction(-price)
//     (Empire.6.cs 2080-2083 / 2165-2168), state → StateMoney -= price.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { BuiltObject } from '../src/sim/builtObject';
import type { Design } from '../src/sim/design';
import type { Empire } from '../src/sim/empire';
import { empireGovernmentAttributes } from '../src/sim/empire';
import { HabitatCategoryType, type Habitat } from '../src/sim/types';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectMissionType, CommandAction, builtObjectMission, COORD_UNSET_DOUBLE } from '../src/sim/missions/mission';
import { clearPreviousMissionRequirements } from '../src/sim/missions/assign';
import { executeCommands } from '../src/sim/missions/executeCommands';
import { runPlayerCommand } from '../src/sim/player/playerCommands';
import { commandLog } from '../src/sim/player/commandLog';
import { boardShipEligible, constructionBoardOf, jobInvalidReason, type ConstructionJob } from '../src/sim/player/constructionBoard';
import { baconSettings } from '../src/sim/data/baconSettings';
import { galaxyNow, galaxyStarDate } from '../src/sim/tick/simTime';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function miningDesign(game: Game, h: Habitat): Design {
    const sub = h.category === HabitatCategoryType.GasCloud ? BuiltObjectSubRole.GasMiningStation : BuiltObjectSubRole.MiningStation;
    const d = game.playerEmpire.designs.find((x) => x.subRole === sub && !x.isObsolete);
    expect(d).toBeDefined();
    return d!;
}

/** The nearest habitat to (x, y) where the player may build a mining station now. */
function miningSite(game: Game, x: number, y: number): Habitat {
    const g = game.galaxy;
    const p = game.playerEmpire;
    const all = g.habitats.filter((h) => h.category !== HabitatCategoryType.Star && h.resources.length > 0);
    all.sort((a, b) => Math.hypot(a.xpos - x, a.ypos - y) - Math.hypot(b.xpos - x, b.ypos - y));
    for (const h of all) {
        const job = { id: 0, design: miningDesign(game, h), habitat: h, x: COORD_UNSET_DOUBLE, y: COORD_UNSET_DOUBLE, ship: null, active: false, basesAtStart: 0, attempts: 0 } as ConstructionJob;
        if (jobInvalidReason(g, p, job) === null && !(p.constructionShips as BuiltObject[]).some((s) => builtObjectMission(s.mission)?.targetHabitat === h)) return h;
    }
    throw new Error('no mining site');
}

/** Expected (state, private) money deltas of Empire.4.cs 1766 PerformPrivateTransaction(amount). */
function privateTransactionDeltas(empire: Empire, amount: number): { state: number; priv: number } {
    const gov = empireGovernmentAttributes(empire);
    if ((gov !== null && gov.specialFunctionCode === 1) || empire.pirateEmpireBaseHabitat !== null) return { state: amount, priv: 0 };
    return { state: 0, priv: amount };
}

/**
 * Player-orders a base through the construction job board ('constructionJobAdd', the journaled player op the "Build
 * at X" / "Build here" menus, the habitat dispatch button and the Expansion Planner use), then runs the construction
 * ship's Build command on arrival (BuiltObject.2.cs 1444) and returns the money deltas of that one call.
 */
function buildWithConstructionShip(game: Game, design: Design, site: Habitat): { ship: BuiltObject; base: BuiltObject; dState: number; dPrivate: number; price: number } {
    const g = game.galaxy;
    const p = game.playerEmpire;
    for (const s of (p.constructionShips as BuiltObject[]).filter((s) => boardShipEligible(p, s))) {
        clearPreviousMissionRequirements(g, s, true);
        s.subsequentMissions.length = 0;
        s.revertMission = null;
    }
    const id = runPlayerCommand(g, p, 'constructionJobAdd', [design, site, COORD_UNSET_DOUBLE, COORD_UNSET_DOUBLE]);
    expect(id).toBeGreaterThan(0);
    const log = commandLog(g).filter((e) => e.source === 'player' && e.op === 'constructionJobAdd');
    expect(log.length).toBeGreaterThan(0);
    const job = constructionBoardOf(p).jobs.find((j) => j.id === id)!;
    expect(job.ship).not.toBeNull();
    const ship = job.ship!;
    const m = builtObjectMission(ship.mission)!;
    expect(m.type).toBe(BuiltObjectMissionType.Build);
    expect(m.design).toBe(design);
    // Skip the travel: complete the commands up to the Build command and put the ship at the site.
    let guard = 0;
    while (m.fastPeekCurrentCommand() !== null && m.fastPeekCurrentCommand()!.action !== CommandAction.Build) {
        m.completeCommand();
        expect(++guard).toBeLessThan(50);
    }
    expect(m.fastPeekCurrentCommand()?.action).toBe(CommandAction.Build);
    ship.parentHabitat = site;
    ship.parentBuiltObject = null;
    ship.dockedAt = null;
    ship.parentOffsetX = 0;
    ship.parentOffsetY = 0;
    ship.xpos = site.xpos;
    ship.ypos = site.ypos;
    ship.firstExecutionOfCommand = true;
    const price = design.calculateCurrentPurchasePrice(g);
    const s0 = p.stateMoney;
    const p0 = p.privateMoney;
    executeCommands(g, ship, 0.05, galaxyNow(g), galaxyStarDate(g));
    const base = m.secondaryTargetBuiltObject;
    expect(base).not.toBeNull();
    expect(base!.design).toBe(design);
    // The ship's yard accepted it (ConstructionQueue.AddBuiltObjectToConstruct, 1537) and it was added to the galaxy.
    expect(g.builtObjects).toContain(base!);
    return { ship, base: base!, dState: p.stateMoney - s0, dPrivate: p.privateMoney - p0, price };
}

describe('player-ordered private stations are paid by the private sector', () => {
    it('construction ship: a player-ordered mining station is private and PerformPrivateTransaction(-price) pays it (+ the Bacon share to the state)', () => {
        const game = cachedTickGame(gameData);
        const p = game.playerEmpire;
        const ship0 = (p.constructionShips as BuiltObject[]).find((s) => boardShipEligible(p, s))!;
        expect(ship0).toBeDefined();
        const site = miningSite(game, ship0.xpos, ship0.ypos);
        const design = miningDesign(game, site);
        const { base, dState, dPrivate, price } = buildWithConstructionShip(game, design, site);
        expect(price).toBeGreaterThan(0);
        // Private: AddBuiltObjectToGalaxy(isStateOwned: false) (Empire.7.cs 1386-1394).
        expect(p.privateBuiltObjects).toContain(base);
        expect(p.builtObjects).not.toContain(base);
        expect(base.owner).toBeNull();
        expect(base.empire).toBe(p);
        expect(base.parentHabitat).toBe(site);
        // BuiltObject.2.cs 1589-1592: PerformPrivateTransaction(-price); StateMoney += privateBuildCostToStateMoney × price.
        const pt = privateTransactionDeltas(p, -price);
        const bacon = baconSettings.privateBuildCostToStateMoney * price;
        expect(dPrivate).toBeCloseTo(pt.priv, 6);
        expect(dState).toBeCloseTo(pt.state + bacon, 6);
        // The standard player empire is a normal one: the private sector pays the full price.
        expect(pt.priv).toBeCloseTo(-price, 6);
        expect(dState).toBeGreaterThanOrEqual(0); // the treasury is never charged for it
    }, 300000);

    it('construction yard purchase: a mining station is bought by the private sector, a state ship by the treasury', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        const colony = p.colonies.find((c) => c.constructionQueue !== null)!;
        expect(colony).toBeDefined();
        // Make sure both accounts can afford it (PurchaseNewBuiltObject checks GetPrivateFunds for private purchases).
        p.stateMoney += 1e6;
        p.privateMoney += 1e6;
        const mining = p.designs.find((d) => d.subRole === BuiltObjectSubRole.MiningStation && !d.isObsolete)!;
        const price = mining.calculateCurrentPurchasePrice(g);
        let s0 = p.stateMoney;
        let p0 = p.privateMoney;
        const bo = runPlayerCommand(g, p, 'yardPurchase', [mining, colony]);
        expect(bo).not.toBeNull();
        // Empire.6.cs 2067 AddBuiltObjectToGalaxy(isStateOwned: false) + 2080-2083 PerformPrivateTransaction(-price).
        expect(p.privateBuiltObjects).toContain(bo);
        expect(p.builtObjects).not.toContain(bo);
        expect(bo!.owner).toBeNull();
        const pt = privateTransactionDeltas(p, -price);
        expect(pt.priv).toBeCloseTo(-price, 6);
        expect(p.stateMoney - s0).toBeCloseTo(pt.state, 6);
        expect(p.privateMoney - p0).toBeCloseTo(pt.priv, 6);
        // A state ship (construction ship): Empire.6.cs 2075-2078 StateMoney -= price.
        const cs = p.designs.find((d) => d.subRole === BuiltObjectSubRole.ConstructionShip && !d.isObsolete)!;
        const price2 = cs.calculateCurrentPurchasePrice(g);
        s0 = p.stateMoney;
        p0 = p.privateMoney;
        const bo2 = runPlayerCommand(g, p, 'yardPurchase', [cs, colony]);
        expect(bo2).not.toBeNull();
        expect(p.builtObjects).toContain(bo2);
        expect(p.stateMoney - s0).toBeCloseTo(-price2, 6);
        expect(p.privateMoney - p0).toBe(0);
    }, 300000);

    it("the job board refuses a construction-ship mining station at the player's own colony, as cmdBuild would on arrival", () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        // BuiltObject.2.cs 1456-1463: Mining / GasMiningStation at a habitat with Owner != null && != Independent → refused.
        const own = p.colonies.find((c) => c.category !== HabitatCategoryType.Star && c.resources.length > 0)!;
        expect(own).toBeDefined();
        const job = { id: 0, design: miningDesign(game, own), habitat: own, x: COORD_UNSET_DOUBLE, y: COORD_UNSET_DOUBLE, ship: null, active: false, basesAtStart: 0, attempts: 0 } as ConstructionJob;
        expect(jobInvalidReason(g, p, job)).toMatch(/is owned by/);
        expect(runPlayerCommand(g, p, 'constructionJobAdd', [job.design, own, COORD_UNSET_DOUBLE, COORD_UNSET_DOUBLE])).toBe(0);
    }, 300000);
});
