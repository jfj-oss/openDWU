// Player fleet templates (Fleet Designs tab of the Fleets window, src/sim/player/fleetTemplates.ts): template commands
// (journaled, saved), Form from existing, Build fleet (queued at the chosen sector's yards; completed ships join the
// forming fleet) and cancelling a build order.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { BuiltObject } from '../src/sim/builtObject';
import { flushPlayerCommands, issuePlayerCommand, runPlayerCommand } from '../src/sim/player/playerCommands';
import { commandLog, type PlayerLogEntry } from '../src/sim/player/commandLog';
import { empireShipGroups } from '../src/sim/fleets/shipGroup';
import { BuiltObjectMissionType } from '../src/sim/missions/mission';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { runGameSeconds } from '../src/sim/tick/harness';
import { buildDesignFor, fleetBuildProgress, fleetDesignBook, sectorOf, shipyardSectors, unassignedWarships } from '../src/sim/player/fleetTemplates';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function saveLoad(game: Game): Game {
    const time = new GalaxyTime();
    time.togglePause();
    time.advance(game.galaxy.nowMs);
    return deserializeGame(serializeGame(game, time, { ...defaultStartGameOptions(), seed: 1 }), gameData).game;
}

/** A template with `count` of the design of the first unassigned warship. */
function templateFor(game: Game, extra = 0): { id: number; ship: BuiltObject; count: number } {
    const p = game.playerEmpire;
    const ship = unassignedWarships(p)[0];
    expect(ship).toBeDefined();
    const count = unassignedWarships(p).filter((b) => b.design === ship.design).length + extra;
    const id = runPlayerCommand(game.galaxy, p, 'fleetTemplateCreate', ['Strike Group']);
    expect(runPlayerCommand(game.galaxy, p, 'fleetTemplateSetEntry', [id, ship.design, count])).toBe(true);
    return { id, ship, count };
}

describe('fleet template commands', () => {
    it('create / set rows / rename / delete are journaled player commands and survive save + load', () => {
        const game = cachedTickGame(gameData);
        const p = game.playerEmpire;
        expect(p.fleetDesigns).toBeUndefined(); // nothing until first used (AI empires never get one)
        issuePlayerCommand(game.galaxy, p, 'fleetTemplateCreate', ['Home Guard']);
        expect(p.fleetDesigns).toBeUndefined(); // applied only at the boundary
        flushPlayerCommands(game.galaxy);
        const t = fleetDesignBook(p).templates[0];
        expect(t.name).toBe('Home Guard');
        const ship = unassignedWarships(p)[0];
        runPlayerCommand(game.galaxy, p, 'fleetTemplateSetEntry', [t.id, ship.design, 3]);
        runPlayerCommand(game.galaxy, p, 'fleetTemplateSetEntry', [t.id, ship.design, 5]);
        expect(t.entries).toEqual([{ design: ship.design, count: 5 }]);
        const civilian = p.designs.find((d) => d.role !== ship.design.role)!;
        expect(runPlayerCommand(game.galaxy, p, 'fleetTemplateSetEntry', [t.id, civilian, 1])).toBe(false); // warships only
        expect(runPlayerCommand(game.galaxy, p, 'fleetTemplateRename', [t.id, '  '])).toBe(false);
        runPlayerCommand(game.galaxy, p, 'fleetTemplateRename', [t.id, 'Home Fleet']);
        const second = runPlayerCommand(game.galaxy, p, 'fleetTemplateCreate', ['']);
        expect(fleetDesignBook(p).templates.map((x) => x.name)).toEqual(['Home Fleet', `Fleet Design ${second}`]);
        runPlayerCommand(game.galaxy, p, 'fleetTemplateDelete', [second]);
        const ops = commandLog(game.galaxy).filter((e): e is PlayerLogEntry => e.source === 'player').map((e) => e.op);
        expect(ops.filter((o) => o.startsWith('fleetTemplate')).length).toBe(8);
        expect(commandLog(game.galaxy).every((e) => e.source !== 'player' || (e as PlayerLogEntry).error === undefined)).toBe(true);

        const loaded = saveLoad(game);
        const lp = loaded.playerEmpire;
        const lt = fleetDesignBook(lp).templates;
        expect(lt).toHaveLength(1);
        expect(lt[0].name).toBe('Home Fleet');
        expect(lt[0].entries[0].count).toBe(5);
        expect(lp.designs).toContain(lt[0].entries[0].design); // the reference resolves to the loaded empire's design
        expect(lt[0].entries[0].design.name).toBe(ship.design.name);
        // AI empires carry nothing; an old save without the field reads as an empty book.
        for (const e of loaded.galaxy.empires) if (e !== lp) expect(e.fleetDesigns).toBeUndefined();
        expect(fleetDesignBook(loaded.galaxy.empires.find((e) => e !== lp)!).templates).toEqual([]);
    }, 300000);
});

describe('Form from existing', () => {
    it('gathers the unassigned ships of the design into a new fleet, reports the shortfall, substitutes by subrole', () => {
        const game = cachedTickGame(gameData);
        const p = game.playerEmpire;
        const { id, ship, count } = templateFor(game, 2);
        const fleetsBefore = empireShipGroups(p).length;
        const res = runPlayerCommand(game.galaxy, p, 'fleetTemplateForm', [id, p.capital, false]);
        expect(res.ok).toBe(true);
        expect(empireShipGroups(p).length).toBe(fleetsBefore + 1);
        const fleet = res.fleet!;
        expect(fleet.name).toBe('Strike Group');
        expect(fleet.ships.length).toBe(count - 2);
        expect(fleet.ships.every((b) => b.design === ship.design)).toBe(true);
        expect(res.entries[0]).toMatchObject({ wanted: count, exact: count - 2, short: 2, substitutes: [] });
        expect(fleet.gatherPoint).toBe(p.capital);
        expect(fleet.mission?.type).toBe(BuiltObjectMissionType.Move);
        expect(unassignedWarships(p).some((b) => b.design === ship.design)).toBe(false);

        // With substitutes on, a second template of the same subrole takes other designs of that subrole.
        const same = unassignedWarships(p).filter((b) => b.subRole === ship.subRole);
        const id2 = runPlayerCommand(game.galaxy, p, 'fleetTemplateCreate', ['Second']);
        runPlayerCommand(game.galaxy, p, 'fleetTemplateSetEntry', [id2, ship.design, 1]);
        const res2 = runPlayerCommand(game.galaxy, p, 'fleetTemplateForm', [id2, p.capital, true]);
        if (same.length > 0) {
            expect(res2.ok).toBe(true);
            expect(res2.entries[0].exact).toBe(0);
            expect(res2.entries[0].substitutes.reduce((s, x) => s + x.count, 0)).toBe(1);
        } else {
            expect(res2.ok).toBe(false);
            expect(res2.entries[0].short).toBe(1);
        }
    }, 300000);
});

describe('Build fleet', () => {
    it('queues the template at the chosen sector, completed ships join the forming fleet; cancel refunds unstarted ships', () => {
        const game = cachedTickGame(gameData);
        const p = game.playerEmpire;
        p.stateMoney += 1_000_000;
        const ship = unassignedWarships(p)[0];
        const design = buildDesignFor(p, ship.design)!;
        expect(design).not.toBeNull();
        const id = runPlayerCommand(game.galaxy, p, 'fleetTemplateCreate', ['New Build']);
        runPlayerCommand(game.galaxy, p, 'fleetTemplateSetEntry', [id, design, 2]);
        const sector = shipyardSectors(game.galaxy, p)[0];
        expect(sector).toBeDefined();
        const money = p.stateMoney;
        const res = runPlayerCommand(game.galaxy, p, 'fleetTemplateBuild', [id, 'all', sector, null, false]);
        expect(res.ok).toBe(true);
        expect(res.queued).toEqual([{ designName: design.name, count: 2 }]);
        expect(p.stateMoney).toBeLessThan(money);
        const order = fleetDesignBook(p).orders[0];
        expect(order.pending).toHaveLength(2);
        for (const b of order.pending) {
            expect(b.design).toBe(design);
            const yard = b.builtAt as BuiltObject;
            expect(sectorOf(game.galaxy, yard.xpos, yard.ypos)).toEqual(sector);
        }
        expect(fleetBuildProgress(p, order)).toEqual({ built: 0, total: 2, building: 2, lost: 0 });
        // The order survives save + load (ship references included).
        const loaded = saveLoad(game);
        const lo = fleetDesignBook(loaded.playerEmpire).orders[0];
        expect(lo.pending.map((b) => b.builtObjectID)).toEqual(order.pending.map((b) => b.builtObjectID));
        expect(loaded.playerEmpire.builtObjects).toContain(lo.pending[0]);

        // Run until both ships are built (or the time cap); each completed ship is in the order's fleet.
        // Fleet automation off (the player manages fleets): with it on, MaintainShipGroups may disband any idle
        // automated fleet of the player's, as in the original (Empire.cs MaintainShipGroups).
        p.controlMilitaryFleets = false;
        const pending = order.pending.slice();
        for (let t = 0; t < 40 && fleetDesignBook(p).orders.length > 0; t++) {
            runGameSeconds(game, 30);
        }
        const done = pending.filter((b) => b.builtAt === null && !b.hasBeenDestroyed);
        expect(done.length).toBeGreaterThan(0);
        const fleet = done[0].shipGroup as { name: string; ships: BuiltObject[] } | null;
        expect(fleet).not.toBeNull();
        expect(fleet!.name).toBe('New Build');
        for (const b of done) expect(b.shipGroup).toBe(fleet);
        expect(empireShipGroups(p)).toContain(fleet);

        // Cancel: a fresh order, cancelled at once, removes its (not started) ships and refunds them.
        const before = p.stateMoney;
        const res2 = runPlayerCommand(game.galaxy, p, 'fleetTemplateBuild', [id, 'all', null, p.capital, false]);
        expect(res2.ok).toBe(true);
        const queued = fleetDesignBook(p).orders.find((o) => o.id === res2.orderId)!.pending.slice();
        const cancel = runPlayerCommand(game.galaxy, p, 'fleetTemplateCancelOrder', [res2.orderId!]);
        expect(cancel.ok).toBe(true);
        expect(cancel.removed).toBe(2); // both still waiting in the yard queues
        expect(fleetDesignBook(p).orders.some((o) => o.id === res2.orderId)).toBe(false);
        for (const b of queued) {
            expect(b.hasBeenDestroyed).toBe(true);
            expect(p.builtObjects).not.toContain(b);
        }
        expect(cancel.refund).toBeCloseTo(queued.reduce((s, b) => s + b.purchasePrice, 0), 6);
        expect(p.stateMoney).toBeCloseTo(before, 3);
        runGameSeconds(game, 10); // the sim carries on after the removal
    }, 600000);

    it("'missing' forms the existing ships now and queues only the shortfall", () => {
        const game = cachedTickGame(gameData);
        const p = game.playerEmpire;
        p.stateMoney += 1_000_000;
        const { id, ship, count } = templateFor(game, 1);
        const design = buildDesignFor(p, ship.design);
        const res = runPlayerCommand(game.galaxy, p, 'fleetTemplateBuild', [id, 'missing', null, p.capital, false]);
        expect(res.ok).toBe(true);
        expect(res.fleet!.ships.length).toBe(count - 1);
        expect(res.queued).toEqual([{ designName: design!.name, count: 1 }]);
        const order = fleetDesignBook(p).orders[0];
        expect(order.fleet).toBe(res.fleet);
        expect(fleetBuildProgress(p, order)).toMatchObject({ built: count - 1, total: count, building: 1 });
    }, 300000);
});
