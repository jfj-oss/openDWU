// Fleet templates with auto-refill and Replenish for the player (src/sim/player/fleetRefill.ts; a gameplay addition,
// not in the original): a fleet that loses ships gets replacements queued (Build Order purchase path), built, and
// joining it (AddShipToFleet + the original's AssignFleetWaypointMission); unused it changes nothing; unaffordable it
// waits without spamming the queue; Replenish queues once; a fleet destroyed in battle is re-formed; saved with the game.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { BuiltObject } from '../src/sim/builtObject';
import type { ShipGroup } from '../src/sim/fleets/shipGroup';
import { empireShipGroups } from '../src/sim/fleets/shipGroup';
import { runPlayerCommand } from '../src/sim/player/playerCommands';
import { BuiltObjectMissionType } from '../src/sim/missions/mission';
import { builtObjectCompleteTeardown } from '../src/sim/combat/teardown';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { fleetDesignBook, fleetTemplateLinkOf, unassignedWarships } from '../src/sim/player/fleetTemplates';
import { fleetRefillText, fleetTemplateSummary, replenishButtonState } from '../src/ui/fleetRefillControls';
import { REFILL_CHECK_MS, REFILL_RETRY_MS, fleetRefillStatus, fleetReplacementsBuilding, refillYards } from '../src/sim/player/fleetRefill';

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

interface Setup {
    game: Game;
    fleet: ShipGroup;
    templateId: number;
    count: number;
}

/** A fleet formed from a template of the most common unassigned warship design (Form from existing links it). */
function setup(money = 2_000_000): Setup {
    const game = cachedTickGame(gameData);
    const p = game.playerEmpire;
    p.controlMilitaryFleets = false; // the player manages fleets (as the Form / Build buttons ask)
    p.stateMoney = money;
    // One row per design of the unassigned warships (the seed-1 player has a few, mostly one of each).
    const ships = unassignedWarships(p);
    const byDesign = new Map<BuiltObject['design'], number>();
    for (const b of ships) byDesign.set(b.design, (byDesign.get(b.design) ?? 0) + 1);
    expect(ships.length).toBeGreaterThanOrEqual(2);
    const templateId = runPlayerCommand(game.galaxy, p, 'fleetTemplateCreate', ['Refill Group']);
    for (const [d, n] of byDesign) expect(runPlayerCommand(game.galaxy, p, 'fleetTemplateSetEntry', [templateId, d, n])).toBe(true);
    const res = runPlayerCommand(game.galaxy, p, 'fleetTemplateForm', [templateId, p.capital, false]);
    expect(res.ok).toBe(true);
    expect(res.fleet!.ships.length).toBe(ships.length);
    return { game, fleet: res.fleet!, templateId, count: ships.length };
}

/** Destroy `n` of the fleet's ships (the teardown of a ship destroyed in battle). */
function lose(game: Game, fleet: ShipGroup, n: number): BuiltObject[] {
    const gone = fleet.ships.slice(0, n);
    for (const b of gone) builtObjectCompleteTeardown(game.galaxy, b);
    return gone;
}

function queuedFor(game: Game, fleet: ShipGroup): BuiltObject[] {
    const link = fleetTemplateLinkOf(game.playerEmpire, fleet);
    return link === null ? [] : fleetReplacementsBuilding(game.playerEmpire, link);
}

describe('fleet template link', () => {
    it('Form from existing assigns the template (auto-refill off); assign / yard / toggle are journaled commands, saved', () => {
        const { game, fleet, templateId } = setup();
        const p = game.playerEmpire;
        const link = fleetTemplateLinkOf(p, fleet)!;
        expect(link).not.toBeNull();
        expect(link.templateId).toBe(templateId);
        expect(link.autoRefill).toBe(false);
        expect(runPlayerCommand(game.galaxy, p, 'fleetTemplateAutoRefill', [fleet, true])).toBe(true);
        const yard = refillYards(p)[0];
        expect(yard).toBeDefined();
        expect(runPlayerCommand(game.galaxy, p, 'fleetTemplateRefillYard', [fleet, yard])).toBe(true);
        expect(runPlayerCommand(game.galaxy, p, 'fleetTemplateRefillYard', [fleet, p.capital as unknown as BuiltObject])).toBe(false);
        // AI fleets: refused (the AI is never affected).
        const ai = game.galaxy.empires.find((e) => e !== p && empireShipGroups(e).length > 0);
        if (ai !== undefined) expect(runPlayerCommand(game.galaxy, ai, 'fleetTemplateAutoRefill', [empireShipGroups(ai)[0]!, true])).toBe(false);
        const loaded = saveLoad(game);
        const lp = loaded.playerEmpire;
        const lf = empireShipGroups(lp).find((f) => f !== null && f.name === fleet.name)!;
        const ll = fleetTemplateLinkOf(lp, lf)!;
        expect(ll.autoRefill).toBe(true);
        expect(ll.yard?.builtObjectID).toBe(yard.builtObjectID);
        expect(lp.spacePorts).toContain(ll.yard);
        // Unassign.
        expect(runPlayerCommand(game.galaxy, p, 'fleetTemplateAssign', [fleet, 0])).toBe(true);
        expect(fleetTemplateLinkOf(p, fleet)).toBeNull();
        expect(runPlayerCommand(game.galaxy, p, 'fleetTemplateAutoRefill', [fleet, true])).toBe(false); // needs a template
    }, 300000);
});

describe('auto-refill off', () => {
    it('changes nothing: the same game, digest and queues as without any template', () => {
        const run = (withTemplate: boolean): { digest: string; orders: number; money: number } => {
            const game = cachedTickGame(gameData);
            const p = game.playerEmpire;
            p.controlMilitaryFleets = false;
            const ships = unassignedWarships(p).slice(0, 3);
            const fleet = runPlayerCommand(game.galaxy, p, 'setShipsFleet', [ships, 'new'])!;
            if (withTemplate) {
                const id = runPlayerCommand(game.galaxy, p, 'fleetTemplateCreate', ['Inert']);
                runPlayerCommand(game.galaxy, p, 'fleetTemplateSetEntry', [id, ships[0].design, 5]);
                expect(runPlayerCommand(game.galaxy, p, 'fleetTemplateAssign', [fleet, id])).toBe(true);
                runPlayerCommand(game.galaxy, p, 'fleetTemplateRefillYard', [fleet, refillYards(p)[0] ?? null]);
                runPlayerCommand(game.galaxy, p, 'fleetTemplateAutoRefill', [fleet, true]);
                runPlayerCommand(game.galaxy, p, 'fleetTemplateAutoRefill', [fleet, false]);
            }
            lose(game, fleet, 1);
            runGameSeconds(game, 60);
            return { digest: stateDigest(game.galaxy), orders: fleetDesignBook(p).orders.length, money: p.stateMoney };
        };
        const a = run(false);
        const b = run(true);
        expect(b.orders).toBe(0);
        expect(b.money).toBe(a.money);
        expect(b.digest).toBe(a.digest);
    }, 600000);
});

describe('auto-refill on', () => {
    it('a fleet that loses ships gets replacements queued, built, and joining it', () => {
        const { game, fleet, count } = setup();
        const p = game.playerEmpire;
        runPlayerCommand(game.galaxy, p, 'fleetTemplateAutoRefill', [fleet, true]);
        runGameSeconds(game, 2);
        expect(queuedFor(game, fleet)).toHaveLength(0); // nothing missing yet
        expect(fleetTemplateLinkOf(p, fleet)!.state).toBe('full');
        const lost = Math.min(2, count - 1);
        lose(game, fleet, lost);
        expect(fleet.ships.length).toBe(count - lost);
        const money = p.stateMoney;
        runGameSeconds(game, (REFILL_CHECK_MS + 1000) / 1000);
        const queued = queuedFor(game, fleet);
        expect(queued).toHaveLength(lost);
        expect(p.stateMoney).toBeLessThan(money); // paid from the treasury
        for (const b of queued) expect(b.builtAt).not.toBeNull();
        const status = fleetRefillStatus(game.galaxy, p, fleet)!;
        expect(status.building).toBe(lost);
        expect(status.missing).toBe(0);
        expect(status.buildingAt.length).toBeGreaterThan(0);
        // More checks never queue more than is missing.
        runGameSeconds(game, (3 * REFILL_CHECK_MS) / 1000);
        expect(queuedFor(game, fleet).length).toBeLessThanOrEqual(lost);
        expect(fleetDesignBook(p).orders.filter((o) => o.refillLinkId !== undefined).reduce((s, o) => s + o.queued, 0)).toBe(lost);

        // Built → they join the fleet; the original's AssignFleetWaypointMission sends them to it.
        const joinedMission = new Map<BuiltObject, BuiltObjectMissionType | undefined>();
        for (let t = 0; t < 60 && queued.some((b) => b.builtAt !== null && !b.hasBeenDestroyed); t++) {
            runGameSeconds(game, 30, {
                onFrame: () => {
                    for (const b of queued) if (b.builtAt === null && !joinedMission.has(b)) joinedMission.set(b, (b.mission as { type?: BuiltObjectMissionType } | null)?.type);
                },
            });
        }
        const done = queued.filter((b) => b.builtAt === null && !b.hasBeenDestroyed);
        expect(done.length).toBe(lost);
        for (const b of done) {
            expect(b.shipGroup).toBe(fleet);
            expect(joinedMission.get(b)).toBe(BuiltObjectMissionType.Move);
        }
        expect(fleet.ships.length).toBe(count);
        expect(fleetRefillStatus(game.galaxy, p, fleet)!.missing).toBe(0);
    }, 900000);

    it('unaffordable: waits (no queueing, no spam), then queues once the treasury can pay', () => {
        const { game, fleet } = setup(0);
        const p = game.playerEmpire;
        lose(game, fleet, 1);
        runPlayerCommand(game.galaxy, p, 'fleetTemplateAutoRefill', [fleet, true]);
        // Keep the treasury in debt (the empire's income arrives in lumps that pay for a ship within a frame).
        const DEBT = -10_000_000;
        const broke = { onFrame: () => void (p.stateMoney = DEBT) };
        p.stateMoney = DEBT;
        runGameSeconds(game, 2, broke);
        const link = fleetTemplateLinkOf(p, fleet)!;
        expect(queuedFor(game, fleet)).toHaveLength(0);
        expect(link.state).toBe('funds');
        expect(link.short).toBe(1);
        expect(link.shortCost).toBeGreaterThan(0);
        expect(link.nextCheckMs).toBeGreaterThanOrEqual(game.galaxy.nowMs + REFILL_RETRY_MS - 3000);
        const status = fleetRefillStatus(game.galaxy, p, fleet)!;
        expect(status.plan.cost).toBeGreaterThan(p.stateMoney);
        // Waiting: no queueing and no new checks before the retry time.
        const next = link.nextCheckMs;
        runGameSeconds(game, 10, broke);
        expect(queuedFor(game, fleet)).toHaveLength(0);
        expect(link.nextCheckMs).toBe(next);
        runGameSeconds(game, (REFILL_RETRY_MS + 1000) / 1000, broke);
        expect(queuedFor(game, fleet)).toHaveLength(0);
        expect(link.nextCheckMs).toBeGreaterThan(next); // retried, still waiting
        expect(link.state).toBe('funds');
        // Replenish is refused too (all or nothing).
        p.stateMoney = DEBT;
        expect(runPlayerCommand(game.galaxy, p, 'fleetTemplateReplenish', [fleet]).ok).toBe(false);
        expect(queuedFor(game, fleet)).toHaveLength(0);
        // Money arrives: the next retry queues exactly the missing ship.
        p.stateMoney = 2_000_000;
        runGameSeconds(game, (REFILL_RETRY_MS + 2000) / 1000);
        expect(queuedFor(game, fleet)).toHaveLength(1);
        runGameSeconds(game, (3 * REFILL_RETRY_MS) / 1000);
        expect(fleetDesignBook(p).orders.filter((o) => o.refillLinkId !== undefined).reduce((s, o) => s + o.queued, 0)).toBe(1);
    }, 600000);
});

describe('Replenish', () => {
    it('queues the missing ships once, with auto-refill off; a second press finds nothing missing', () => {
        const { game, fleet } = setup();
        const p = game.playerEmpire;
        const r0 = runPlayerCommand(game.galaxy, p, 'fleetTemplateReplenish', [fleet]);
        expect(r0.ok).toBe(false); // nothing missing
        const full = fleetRefillStatus(game.galaxy, p, fleet)!;
        expect(replenishButtonState(full, p.stateMoney)).toMatchObject({ enabled: false, title: 'Nothing is missing: the fleet matches its design' });
        expect(fleetRefillText(full)).toMatch(/^Complete \(\d+\/\d+ ships\)$/);
        expect(fleetTemplateSummary(full)).toMatch(/^Refill Group · Complete/);
        expect(replenishButtonState(null, p.stateMoney).enabled).toBe(false);
        lose(game, fleet, 1);
        const status = fleetRefillStatus(game.galaxy, p, fleet)!;
        expect(status.missing).toBe(1);
        expect(status.plan.cost).toBeGreaterThan(0);
        expect(replenishButtonState(status, p.stateMoney).enabled).toBe(true);
        const poor = replenishButtonState(status, 0);
        expect(poor.enabled).toBe(false);
        expect(poor.title).toMatch(/^Cannot afford the 1 missing ship: /);
        expect(fleetRefillText(status)).toBe('1 missing');
        const money = p.stateMoney;
        const r = runPlayerCommand(game.galaxy, p, 'fleetTemplateReplenish', [fleet]);
        expect(r).toMatchObject({ ok: true, queued: 1, short: 0 });
        expect(p.stateMoney).toBeCloseTo(money - status.plan.cost, 3);
        expect(runPlayerCommand(game.galaxy, p, 'fleetTemplateReplenish', [fleet]).ok).toBe(false);
        expect(queuedFor(game, fleet)).toHaveLength(1);
        const after = fleetRefillStatus(game.galaxy, p, fleet)!;
        expect(fleetRefillText(after)).toMatch(/^1 replacement building at .+/);
        expect(replenishButtonState(after, p.stateMoney).title).toBe('Nothing is missing: the replacements are already under construction');
        // Auto-refill stays off: no periodic queueing.
        expect(fleetTemplateLinkOf(p, fleet)!.autoRefill).toBe(false);
        lose(game, fleet, 1);
        runGameSeconds(game, (2 * REFILL_CHECK_MS) / 1000);
        expect(queuedFor(game, fleet)).toHaveLength(1);
        // Cancelling the replacements from the Build Queue refunds the unstarted ones (and keeps auto-refill off).
        const order = fleetDesignBook(p).orders.find((o) => o.refillLinkId !== undefined)!;
        expect(runPlayerCommand(game.galaxy, p, 'fleetTemplateCancelOrder', [order.id]).ok).toBe(true);
    }, 600000);
});

describe('a fleet destroyed in battle', () => {
    it('is re-formed by its replacements under its name; a disbanded fleet loses its link', () => {
        const { game, fleet, count } = setup();
        const p = game.playerEmpire;
        const name = fleet.name;
        runPlayerCommand(game.galaxy, p, 'fleetTemplateAutoRefill', [fleet, true]);
        runGameSeconds(game, 2);
        lose(game, fleet, fleet.ships.length);
        expect(empireShipGroups(p)).not.toContain(fleet);
        runGameSeconds(game, (REFILL_CHECK_MS + 1000) / 1000);
        const link = fleetDesignBook(p).links!.find((l) => l.name === name)!;
        expect(link).toBeDefined();
        expect(link.fleet).toBeNull();
        const order = fleetDesignBook(p).orders.find((o) => o.refillLinkId === link.id)!;
        expect(order.pending.length).toBe(count);
        const pending = order.pending.slice();
        for (let t = 0; t < 60 && link.fleet === null; t++) runGameSeconds(game, 30);
        expect(link.fleet).not.toBeNull();
        expect(link.fleet!.name).toBe(name);
        expect(empireShipGroups(p)).toContain(link.fleet);
        const built = pending.filter((b) => b.builtAt === null && !b.hasBeenDestroyed);
        for (const b of built) expect(b.shipGroup).toBe(link.fleet);

        // Disbanded by the player (ships alive): the link goes at the next check, nothing is queued for it.
        const f2 = link.fleet!;
        for (let t = 0; t < 60 && pending.some((b) => b.builtAt !== null && !b.hasBeenDestroyed); t++) runGameSeconds(game, 30);
        runPlayerCommand(game.galaxy, p, 'setShipsFleet', [f2.ships.slice(), null]);
        expect(empireShipGroups(p)).not.toContain(f2);
        const ordersBefore = fleetDesignBook(p).orders.length;
        runGameSeconds(game, (REFILL_CHECK_MS + 1000) / 1000);
        expect(fleetDesignBook(p).links!.some((l) => l.id === link.id)).toBe(false);
        expect(fleetDesignBook(p).orders.length).toBeLessThanOrEqual(ordersBefore);
    }, 1200000);
});
