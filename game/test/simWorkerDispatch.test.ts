// Sim worker: the selection panel's habitat dispatch slots (hud.ts habitatDispatchSlots, docs/sim-worker.md §4.4).
// - A click re-resolves the slot with the journaled 'habitatDispatch' command and gives the order from its reply: a
//   build slot adds a construction job (constructionJobAdd), a mission slot sends the ship (shipAction). In worker mode
//   the job / mission lands in the authoritative game with the player's own design, the toasts are the in-thread ones,
//   and the command log and state digest are the in-thread ones.
// - Every way the chain can fail releases the slot's busy lock (pendingCommands.ts PendingOnce) with a toast: a
//   command that cannot be posted to the worker, an executor that throws (worker and in-thread), so a later click on
//   the slot gives the order again instead of being silently ignored.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/toast', () => ({ showToast: vi.fn(), hideToast: vi.fn() }));

import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import { inThread, inWorker, type Side, type WorkerSide } from './helpers/simWorkerSides';
import type { GameData } from '../src/sim/data/gameData';
import type { Habitat } from '../src/sim/types';
import type { BuiltObject } from '../src/sim/builtObject';
import { Design } from '../src/sim/design';
import { BuiltObjectMissionType } from '../src/sim/missions/mission';
import { PLAYER_OPS } from '../src/sim/player/playerOps';
import { commandLog } from '../src/sim/player/commandLog';
import { showToast } from '../src/ui/toast';
import type { ToWorker } from '../src/simworker/protocol';
import { dispatchSlotBusy, habitatDispatchSlots, playerDesignFor } from '../src/ui/hud';
import type { SelectionExtraSlot } from '../src/ui/orderMenu';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

const toast = vi.mocked(showToast);
afterEach(() => {
    vi.restoreAllMocks();
    toast.mockClear();
});

/** The habitat whose slots the tests click: a body in the capital system with build and mission slots. */
function target(s: Side): Habitat {
    const p = s.player;
    return s.galaxy.habitats.filter((h) => h.systemIndex === p.capital!.systemIndex)[1];
}

/** The slots the panel would show for `h` (the 'habitatDispatch' reply). */
function slotsFor(s: Side, h: Habitat): SelectionExtraSlot[] {
    let slots: SelectionExtraSlot[] | null = null;
    habitatDispatchSlots(s.galaxy, s.player, h, (x) => (slots = x));
    for (let i = 0; i < 10 && slots === null; i++) s.tick();
    expect(slots).not.toBeNull();
    return slots!;
}

/** The toasts shown so far, without the app loop's own "Simulation error" one (simLoop.ts). */
const orderToasts = (): string[] => toast.mock.calls.map((c) => String(c[0])).filter((t) => !t.startsWith('Simulation error'));

/** Click the slot labelled `label` and run until its toast (the order's outcome). */
async function click(s: Side, slots: SelectionExtraSlot[], label: string): Promise<string> {
    const slot = slots.find((x) => x.label === label);
    expect(slot, `slot ${label} in ${slots.map((x) => x.label).join(', ')}`).toBeDefined();
    const before = orderToasts().length;
    slot!.onClick();
    for (let i = 0; i < 12 && orderToasts().length === before; i++) {
        s.tick();
        await new Promise((r) => setTimeout(r, 0));
    }
    expect(orderToasts().length).toBe(before + 1);
    return orderToasts()[before];
}

/** The player commands of the log, without their boundary (a worker reply lands one round trip later than in-thread). */
const loggedOrders = (s: Side): string[] => commandLog(s.real).map((e) => JSON.stringify({ ...e, nowMs: undefined, starDate: undefined }));

/** The ship a mission slot's title names ("Explore: sends <ship> (...)"). */
function shipOf(s: Side, slot: SelectionExtraSlot): BuiltObject {
    const m = /sends (.+?) \(/.exec(slot.title);
    expect(m).not.toBeNull();
    return s.real.playerEmpire!.builtObjects.find((b) => b.name === m![1])!;
}

/** The labels the tests click: every build slot and every enabled mission slot. */
function clickable(slots: SelectionExtraSlot[]): { builds: string[]; missions: SelectionExtraSlot[] } {
    return {
        builds: slots.filter((x) => x.label.startsWith('Build ') && x.disabled !== true).map((x) => x.label),
        missions: slots.filter((x) => !x.label.startsWith('Build ') && x.disabled !== true),
    };
}

describe('sim worker: habitat dispatch slots', () => {
    it('build slots add construction jobs and mission slots send the ship, in worker mode as in-thread', async () => {
        const run = async (s: Side): Promise<string[]> => {
            const seen: string[] = [];
            for (let i = 0; i < 3; i++) s.tick();
            const h = target(s);
            const slots = slotsFor(s, h);
            const { builds, missions } = clickable(slots);
            expect(builds.length).toBeGreaterThan(0);
            expect(missions.length).toBeGreaterThan(0);
            for (const label of builds) seen.push(await click(s, slots, label));
            for (const m of missions) {
                const ship = shipOf(s, m);
                seen.push(await click(s, slots, m.label));
                // The mission landed in the authoritative game (as the ship's mission or queued behind its task).
                const missionsOf = [ship.mission, ...ship.subsequentMissions] as ({ type: BuiltObjectMissionType } | null)[];
                const types = missionsOf.map((x) => x?.type ?? BuiltObjectMissionType.Undefined).filter((t) => t !== BuiltObjectMissionType.Undefined);
                expect(types.length, `${ship.name} has a mission after ${m.label}`).toBeGreaterThan(0);
                seen.push(`${m.label}: ${ship.name} ${types.join(',')}`);
            }
            // The jobs are on the authoritative board, each with the player's own design.
            const real = s.real.playerEmpire!;
            const jobs = real.constructionBoard?.jobs ?? [];
            expect(jobs.length).toBe(builds.length);
            for (const j of jobs) expect(real.designs.includes(j.design)).toBe(true);
            seen.push(`jobs ${jobs.map((j) => `${j.design.name}@${j.habitat?.name}`).join(',')}`);
            return seen;
        };
        const local = inThread(cachedTickGame(gameData));
        const ref = await run(local);
        expect(ref.filter((x) => x.startsWith('Construction job added: ')).length).toBeGreaterThan(0);
        expect(ref.some((x) => / sent: /.test(x))).toBe(true);
        const w = inWorker(cachedTickGame(gameData), gameData);
        const got = await run(w);
        expect(got).toEqual(ref);
        // The same orders with the same arguments (the player's own designs, by reference) as in-thread.
        expect(loggedOrders(w)).toEqual(loggedOrders(local));
        // The replica shows the jobs too.
        w.settle();
        expect(w.player.constructionBoard?.jobs.length).toBe(local.real.playerEmpire!.constructionBoard?.jobs.length);
        expect(w.replicaWrites()).toEqual([]);
        w.dispose();
        local.dispose();
    }, 600000);

    it('a command that cannot be posted releases the slot (toast), and the next click gives the order', async () => {
        const w: WorkerSide = inWorker(cachedTickGame(gameData), gameData);
        for (let i = 0; i < 3; i++) w.tick();
        const h = target(w);
        const slots = slotsFor(w, h);
        const label = clickable(slots).builds[0];
        const command = w.host.command.bind(w.host);
        const spy = vi.spyOn(w.host, 'command').mockImplementation((m: Extract<ToWorker, { type: 'command' }>) => {
            if (m.op === 'constructionJobAdd') throw new DOMException('could not be cloned', 'DataCloneError');
            command(m);
        });
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(await click(w, slots, label)).toBe(`${label} ${h.name}: not possible`);
        expect(w.client.pendingReplies).toBe(0);
        expect(err.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/constructionJobAdd: posting it failed/);
        expect(w.real.playerEmpire!.constructionBoard?.jobs.length ?? 0).toBe(0);
        spy.mockRestore();
        warn.mockRestore();
        err.mockRestore();
        // Not locked: the next click on the slot gives the order.
        expect(await click(w, slots, label)).toBe(`Construction job added: ${label} at ${h.name}`);
        expect(w.real.playerEmpire!.constructionBoard?.jobs.length).toBe(1);
        w.dispose();
    }, 600000);

    for (const worker of [true, false]) {
        it(`an executor that throws releases the slot (toast) ${worker ? 'in worker mode' : 'in-thread'}`, async () => {
            const s = worker ? inWorker(cachedTickGame(gameData), gameData) : inThread(cachedTickGame(gameData));
            for (let i = 0; i < 3; i++) s.tick();
            const h = target(s);
            const slots = slotsFor(s, h);
            const label = clickable(slots).builds[0];
            const spy = vi.spyOn(PLAYER_OPS, 'constructionJobAdd').mockImplementation(() => {
                throw new Error('boom');
            });
            const err = vi.spyOn(console, 'error').mockImplementation(() => {});
            const tick = s.tick;
            // In-thread the boundary's exception stops the frame (the app loop pauses with a simulation error).
            s.tick = () => {
                try {
                    tick();
                } catch (e) {
                    if (!(e instanceof Error && /boom/.test(e.message))) throw e;
                }
            };
            const text = await click(s, slots, label);
            expect(text).toMatch(new RegExp(`^${label} ${h.name}: .*boom`));
            spy.mockRestore();
            err.mockRestore();
            // The slot is free again: the next click gives the order.
            expect(await click(s, slots, label)).toBe(`Construction job added: ${label} at ${h.name}`);
            expect(s.real.playerEmpire!.constructionBoard?.jobs.length).toBe(1);
            s.dispose();
        }, 600000);
    }

    it('a double click sends one order: the slot is busy until the reply', async () => {
        const w = inWorker(cachedTickGame(gameData), gameData);
        for (let i = 0; i < 3; i++) w.tick();
        const h = target(w);
        const slots = slotsFor(w, h);
        const label = clickable(slots).builds[0];
        const slot = slots.find((x) => x.label === label)!;
        slot.onClick();
        slot.onClick();
        expect([...Array(40)].some((_, i) => dispatchSlotBusy(h, `build:${i}`))).toBe(true);
        for (let i = 0; i < 12 && toast.mock.calls.length === 0; i++) {
            w.tick();
            await new Promise((r) => setTimeout(r, 0));
        }
        expect(toast.mock.calls.map((c) => c[0])).toEqual([`Construction job added: ${label} at ${h.name}`]);
        expect([...Array(40)].some((_, i) => dispatchSlotBusy(h, `build:${i}`))).toBe(false);
        expect(w.real.playerEmpire!.constructionBoard?.jobs.length).toBe(1);
        w.dispose();
    }, 600000);

    it('playerDesignFor: a copy of a design resolves to the player\'s own listed design', () => {
        const game = cachedTickGame(gameData);
        const p = game.playerEmpire;
        const own = (p.designs as Design[])[0];
        expect(playerDesignFor(p, own)).toBe(own);
        const copy = Object.assign(Object.create(Design.prototype) as Design, own);
        expect(playerDesignFor(p, copy)).toBe(own);
        const stranger = Object.assign(Object.create(Design.prototype) as Design, own, { name: 'Nobody 9' });
        expect(playerDesignFor(p, stranger)).toBe(stranger);
    });
});
