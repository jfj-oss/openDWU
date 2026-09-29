// Build Order panel design drop-down (Main.Part2.cs method_630 / DesignDropDown): the per-category design list, the
// selection, and that queuing the pick issues buildNewShips through the command log so the yard gets the chosen design
// at the next frame boundary. Also the stub double right-click on real mouse events (mousedown / contextmenu).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { findNewestCanBuild } from '../src/sim/designGeneration';
import type { BuiltObject } from '../src/sim/builtObject';
import { Design } from '../src/sim/design';
import { queueOf } from '../src/sim/construction/empireConstruction';
import { issuePlayerCommand, pendingPlayerCommands, flushPlayerCommands } from '../src/sim/player/playerCommands';
import { BUILD_ORDER_SUBROLES, buildOrderDesignLabel, buildOrderDesignOptions, buildOrderPurchaseLists, buildOrderRow, buildOrderRows } from '../src/ui/screens/buildOrder';
import { DOUBLE_RIGHT_CLICK_MS, handleStubMouseEvent, type RightClickTracker } from '../src/ui/messageStubs';
import { EmpireMessage, EmpireMessageType } from '../src/sim/messages';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function cloneDesign(d: Design, name: string, dateCreated: number): Design {
    const c = Object.assign(Object.create(Object.getPrototypeOf(d)) as Design, d);
    c.name = name;
    c.dateCreated = dateCreated;
    return c;
}

describe('Build Order design drop-down', () => {
    it('lists the empire designs of the row sub-role, sorted by name, skipping obsolete and other classes', () => {
        const { playerEmpire: e } = cachedTickGame(gameData);
        const frigate = e.designs.find((d) => d.subRole === BuiltObjectSubRole.Frigate)!;
        const b = cloneDesign(frigate, 'Zeta', frigate.dateCreated + 2);
        const a = cloneDesign(frigate, 'Alpha', frigate.dateCreated + 1);
        const old = cloneDesign(frigate, 'Ancient', frigate.dateCreated + 3);
        old.isObsolete = true;
        e.designs.push(b, a, old);
        const names = buildOrderDesignOptions(e, BuiltObjectSubRole.Frigate).map((d) => d.name);
        expect(names).toEqual([...names].sort());
        expect(names).toContain('Alpha');
        expect(names).toContain('Zeta');
        expect(names).not.toContain('Ancient');
        expect(buildOrderDesignOptions(e, BuiltObjectSubRole.Frigate).every((d) => d.subRole === BuiltObjectSubRole.Frigate)).toBe(true);
        expect(buildOrderDesignLabel(a)).toBe('Frigate (Alpha)');
    });

    it('defaults to FindNewestCanBuild and keeps the player pick', () => {
        const { galaxy: g, playerEmpire: e } = cachedTickGame(gameData);
        const escort = e.designs.find((d) => d.subRole === BuiltObjectSubRole.Escort)!;
        const newer = cloneDesign(escort, 'Newer Escort', escort.dateCreated + 100);
        e.designs.push(newer);
        expect(buildOrderRow(e, g, BuiltObjectSubRole.Escort).design).toBe(findNewestCanBuild(e.designs, BuiltObjectSubRole.Escort, e));
        const row = buildOrderRow(e, g, BuiltObjectSubRole.Escort, escort);
        expect(row.design).toBe(escort);
        expect(row.options).toContain(newer);
        expect(row.unitCost).toBeCloseTo(escort.calculateCurrentPurchasePrice(g), 6);
        // A pick that is no longer in the list falls back to the newest.
        newer.isObsolete = true;
        const fallback = buildOrderRow(e, g, BuiltObjectSubRole.Escort, newer);
        expect(fallback.design).not.toBe(newer);
        expect(fallback.design).toBe(findNewestCanBuild(e.designs, BuiltObjectSubRole.Escort, e));
    });

    it('queuing the picked design issues buildNewShips and the yard gets that design at the frame boundary', () => {
        const { galaxy: g, playerEmpire: e } = cachedTickGame(gameData);
        const frigate = e.designs.find((d) => d.subRole === BuiltObjectSubRole.Frigate)!;
        const pick = cloneDesign(frigate, 'Picked Frigate', frigate.dateCreated - 5); // older: not the default
        e.designs.push(pick);
        const chosen = new Map([[BuiltObjectSubRole.Frigate, pick]]);
        const rows = buildOrderRows(e, g, chosen);
        const i = BUILD_ORDER_SUBROLES.indexOf(BuiltObjectSubRole.Frigate);
        expect(rows[i].design).toBe(pick);
        const amounts = rows.map(() => 0);
        amounts[i] = 2;
        const lists = buildOrderPurchaseLists(rows, amounts);
        expect(lists.designs).toEqual([pick]);
        expect(lists.amounts).toEqual([2]);
        let result: { built: (BuiltObject & { design: Design })[] } | null = null;
        issuePlayerCommand(g, e, 'buildNewShips', [lists.designs, lists.amounts], (r) => (result = r));
        expect(pendingPlayerCommands(g)).toBeGreaterThan(0);
        expect(result).toBeNull(); // queued, not applied yet
        flushPlayerCommands(g);
        expect(result).not.toBeNull();
        expect(result!.built.map((b) => b.design.name)).toEqual(['Picked Frigate', 'Picked Frigate']);
        for (const bo of result!.built) {
            const q = queueOf(bo.builtAt as Parameters<typeof queueOf>[0])!;
            const inQueue = [...(q.constructionWaitQueue ?? []), ...(q.constructionYards ?? []).map((y) => y.shipUnderConstruction)];
            expect(inQueue).toContain(bo);
        }
    });
});

describe('badge double right-click on real mouse events', () => {
    const msg = new EmpireMessage(null, EmpireMessageType.NewColony, null);
    const ev = (type: string, button = 2) => ({ type, button, preventDefault: vi.fn(), stopPropagation: vi.fn() });

    it('a press + contextmenu pair counts once per physical click; the second click within 450 ms dismisses', () => {
        const t: RightClickTracker = { key: null, at: 0 };
        const d1 = ev('mousedown');
        const c1 = ev('contextmenu');
        expect(handleStubMouseEvent(d1, t, msg, 1000)).toBe(false);
        expect(handleStubMouseEvent(c1, t, msg, 1002)).toBe(false); // the same press's menu event
        expect(c1.preventDefault).toHaveBeenCalled();
        const d2 = ev('mousedown');
        expect(handleStubMouseEvent(d2, t, msg, 1000 + DOUBLE_RIGHT_CLICK_MS - 10)).toBe(true);
        const c2 = ev('contextmenu');
        handleStubMouseEvent(c2, t, msg, 1000 + DOUBLE_RIGHT_CLICK_MS - 8);
        expect(c2.preventDefault).toHaveBeenCalled();
    });
    it('left clicks never count; a contextmenu without a press (ctrl-click, long press) counts by itself', () => {
        const t: RightClickTracker = { key: null, at: 0 };
        expect(handleStubMouseEvent(ev('mousedown', 0), t, msg, 0)).toBe(false);
        expect(handleStubMouseEvent(ev('mousedown', 0), t, msg, 10)).toBe(false);
        expect(handleStubMouseEvent(ev('contextmenu'), t, msg, 100)).toBe(false);
        expect(handleStubMouseEvent(ev('contextmenu'), t, msg, 300)).toBe(true);
    });
    it('two slow right presses do not dismiss', () => {
        const t: RightClickTracker = { key: null, at: 0 };
        expect(handleStubMouseEvent(ev('mousedown'), t, msg, 0)).toBe(false);
        expect(handleStubMouseEvent(ev('mousedown'), t, msg, DOUBLE_RIGHT_CLICK_MS + 1)).toBe(false);
    });
});
