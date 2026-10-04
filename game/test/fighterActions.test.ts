// Selected-fighter actions (parity: fighters):
// - the selection panel's buttons for a fighter (Main.Part3.cs 3602-3614 → sim/player/orderMenu.ts selectionActions) and
//   their execution through the journaled 'shipAction' command (Main.Part7.cs 73-101 method_347's Fighter branch);
// - the command-log codec naming a Fighter by its carrier + fighterID (player/commandCodec.ts), so those orders replay;
// - the right-click action menu with a fighter under the cursor (Main.Part11.cs 1579-1600 method_145 returns it at
//   f < 50; Main.Part8.cs method_344 / method_311 / method_315 build the items);
// - the fighter "Bonuses" line (InfoPanel.cs 3627-3634, Galaxy.2.cs 4043 GenerateCharacterBonusDescription(Fighter)).
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { Fighter, FighterMissionType, FighterType, buildNewFighters, fightersOf } from '../src/sim/combat/fighters';
import { ShipAction, ShipActionType } from '../src/sim/player/shipAction';
import { buildActionMenu, resolveHoverOrder, selectionActions, selectionButtons, type OrderMenuContext } from '../src/sim/player/orderMenu';
import { runPlayerCommand } from '../src/sim/player/playerCommands';
import { commandLog } from '../src/sim/player/commandLog';
import { decodeCommandArg, encodeCommandArg } from '../src/sim/player/commandCodec';
import { captainBonusMap } from '../src/sim/characters';
import { ShipGroup } from '../src/sim/fleets/shipGroup';
import { fighterCharacterBonusDescription, fighterInfo, rowText } from '../src/ui/selectionInfo';
import { selectionTarget } from '../src/ui/orderMenu';
import { selectedStellarObject, shipsMovingToDestination } from '../src/render/overlayLayer';
import { issuePlayerCommand } from '../src/sim/player/playerCommands';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { FRAME_REAL_MS } from '../src/sim/tick/scheduler';
import { SimHost } from '../src/simworker/simHost';
import { SimClientCore } from '../src/simworker/clientCore';
import type { ToWorker } from '../src/simworker/protocol';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import type { ShipActionResult } from '../src/sim/player/executeShipAction';

let gameData: GameData;
let galaxy: Galaxy;
let player: Empire;

beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);
beforeEach(() => {
    galaxy = cachedTickGame(gameData).galaxy;
    player = galaxy.playerEmpire!;
});

/** The player's first fighter carrier (the capital space port on the seed-1 harness game). */
function playerCarrier(): BuiltObject {
    const c = galaxy.builtObjects.find((b): b is BuiltObject => b !== null && b.empire === player && b.fighterCapacity > 0);
    expect(c).toBeDefined();
    return c!;
}
/** The carrier's fighters, built and finished (health 1, onboard). */
function readyFighters(carrier: BuiltObject): Fighter[] {
    buildNewFighters(galaxy, carrier);
    const fighters = fightersOf(carrier)!;
    for (const f of fighters) {
        f.health = 1;
        f.underConstruction = false;
    }
    expect(fighters.length).toBeGreaterThan(0);
    return fighters;
}
const kinds = (slots: (ShipAction | null)[] | null): string[] | null =>
    slots === null ? null : slots.map((a) => (a === null ? '-' : a.actionType !== ShipActionType.Undefined ? ShipActionType[a.actionType] : BuiltObjectMissionType[a.missionType]));

describe('Main.Part3.cs 3602-3614: the selected fighter\'s buttons', () => {
    it('onboard: Launch this Fighter; launched: Return this Fighter; always Retire in slot 8', () => {
        const [f] = readyFighters(playerCarrier());
        const ctx = { galaxy, empire: player, selected: f };
        expect(kinds(selectionActions(ctx, null))).toEqual(['FighterLaunchFighters', '-', '-', '-', '-', '-', '-', 'Retire']);
        f.onboardCarrier = false;
        expect(kinds(selectionActions(ctx, null))).toEqual(['FighterRetrieveFighters', '-', '-', '-', '-', '-', '-', 'Retire']);
        const buttons = selectionButtons(ctx, null)!;
        expect(buttons[0].hint).toBe('Return this Fighter to carrier');
        expect(buttons[7].hint).toBe('Scrap Fighter immediately');
    });
    it('a bomber gets the bomber actions; one being built only Retire; another empire\'s none (buttons unchanged)', () => {
        const [f] = readyFighters(playerCarrier());
        const ctx = { galaxy, empire: player, selected: f };
        f.specification = { ...f.specification, type: FighterType.Bomber };
        expect(kinds(selectionActions(ctx, null))![0]).toBe('FighterLaunchBombers');
        f.underConstruction = true;
        expect(kinds(selectionActions(ctx, null))).toEqual(['-', '-', '-', '-', '-', '-', '-', 'Retire']);
        const other = galaxy.empires.find((e) => e !== player)!;
        expect(selectionActions({ galaxy, empire: other, selected: f }, null)).toBeNull();
    });
    it('the HUD selection hands the fighter to the action bar (the C# SelectedObject)', () => {
        const [f] = readyFighters(playerCarrier());
        expect(selectionTarget({ habitat: galaxy.habitats[0], fighter: f })).toBe(f);
    });
});

describe('Main.Part7.cs 73-101: the fighter orders, journaled and replayable', () => {
    it('Launch, Return and Retire through the shipAction command; the log names the fighter by carrier + id', () => {
        const carrier = playerCarrier();
        const [f] = readyFighters(carrier);
        const before = commandLog(galaxy).length;
        // Launch this Fighter.
        runPlayerCommand(galaxy, player, 'shipAction', [f, ShipAction.forAction(ShipActionType.FighterLaunchFighters, f), false, undefined]);
        expect(f.onboardCarrier).toBe(false);
        // Return this Fighter to carrier.
        runPlayerCommand(galaxy, player, 'shipAction', [f, ShipAction.forAction(ShipActionType.FighterRetrieveFighters, f), false, undefined]);
        expect(f.missionType).toBe(FighterMissionType.ReturnToCarrier);
        // Retire: CompleteTeardown, method_208(null).
        const r = runPlayerCommand(galaxy, player, 'shipAction', [f, ShipAction.forMission(BuiltObjectMissionType.Retire, f), false, undefined]);
        expect(f.hasBeenDestroyed).toBe(true);
        expect(fightersOf(carrier)!.includes(f)).toBe(false);
        expect(r.select).toBeNull();
        const entries = commandLog(galaxy).slice(before);
        expect(entries.length).toBe(3);
        for (const e of entries) {
            expect(e.source === 'player' && e.error).toBeFalsy();
            if (e.source === 'player') expect(e.args[0]).toEqual({ r: 'fi', k: [carrier.builtObjectID, f.fighterID] });
        }
    });
    it('encodeCommandArg / decodeCommandArg round-trip a fighter (and its ShipAction target)', () => {
        const fighters = readyFighters(playerCarrier());
        const f = fighters[fighters.length - 1];
        expect(decodeCommandArg(galaxy, encodeCommandArg(galaxy, f))).toBe(f);
        const action = decodeCommandArg(galaxy, encodeCommandArg(galaxy, ShipAction.forMission(BuiltObjectMissionType.Retire, f))) as ShipAction;
        expect(action).toBeInstanceOf(ShipAction);
        expect(action.target).toBe(f);
    });
});

describe('right-click with a fighter under the cursor (method_145 → method_344)', () => {
    function warship(): BuiltObject {
        const s = player.builtObjects.find((b) => b.role !== BuiltObjectRole.Base && b.builtAt === null && b.topSpeed > 0 && b.firepowerRaw > 0);
        expect(s).toBeDefined();
        return s!;
    }
    it('no default (hover) order: mainView_MouseMove has no Fighter case (Main.Part10.cs 332-697)', () => {
        const [f] = readyFighters(playerCarrier());
        const ship = warship();
        const hover = resolveHoverOrder({ galaxy, empire: player, selected: ship, x: Math.trunc(f.xpos), y: Math.trunc(f.ypos), target: f, shift: false, alt: false, ctrl: false });
        expect(hover.action).toBeNull();
    });
    it('"Move to X" targets the fighter (method_315: no offset), its text unformatted (method_311 has no Fighter case)', () => {
        const [f] = readyFighters(playerCarrier());
        f.onboardCarrier = false;
        const ship = warship();
        const ctx: OrderMenuContext = { galaxy, empire: player, selected: ship, cursorX: Math.trunc(f.xpos) + 3, cursorY: Math.trunc(f.ypos), zoomFactor: 1, pickAt: () => f };
        const items = buildActionMenu(ctx);
        const move = items[0];
        expect(move.key).toBe('Move to X');
        expect(move.action!.missionType).toBe(BuiltObjectMissionType.Move);
        expect(move.action!.target).toBe(f);
        expect(move.action!.position).toEqual({ x: 0, y: 0 });
        // Not an enemy: no Attack item (flag9 needs another empire's ship / colony / fleet, or a creature).
        expect(items.some((i) => i.key === 'Attack X')).toBe(false);
        // The order runs as a journaled command. BuiltObjectMission's ctor (BuiltObjectMission.cs 446-468) keeps a
        // BuiltObject / Habitat / Creature / ShipGroup / Sector target only: the Move has no target, as in the C#.
        runPlayerCommand(galaxy, player, 'shipAction', [ship, move.action!, true, { x: ctx.cursorX, y: ctx.cursorY }]);
        const m = builtObjectMission(ship.mission)!;
        expect(m.type).toBe(BuiltObjectMissionType.Move);
        expect(m.target).toBeNull();
        // So no ship is ever "moving to" a selected fighter (Empire.6.cs 1186 compares the mission Target).
        expect(shipsMovingToDestination(player, selectedStellarObject({ habitat: galaxy.habitats[0], fighter: f })).size).toBe(0);
    });
    it('a creature as the selected destination: the ships attacking it are the special-highlight set (Main.Part10.cs 1328)', () => {
        const ship = warship();
        const creature = galaxy.creatures.find((c) => c !== null && !c.hasBeenDestroyed)!;
        expect(creature).toBeDefined();
        runPlayerCommand(galaxy, player, 'shipAction', [ship, ShipAction.forMission(BuiltObjectMissionType.Attack, creature), true, undefined]);
        expect(builtObjectMission(ship.mission)?.target).toBe(creature);
        const target = selectedStellarObject({ habitat: galaxy.habitats[0], creature });
        expect(target).toBe(creature);
        expect(shipsMovingToDestination(player, target)).toContain(ship);
    });
});

describe('Galaxy.2.cs 4043 GenerateCharacterBonusDescription(Fighter): the Bonuses line', () => {
    it('empty without a carrier, or when the carrier\'s captain gives no Fighters bonus and it is in no fleet', () => {
        const carrier = playerCarrier();
        const [f] = readyFighters(carrier);
        expect(fighterCharacterBonusDescription({ parentBuiltObject: null })).toBe('');
        captainBonusMap.delete(carrier);
        carrier.shipGroup = null;
        expect(fighterCharacterBonusDescription(f)).toBe('');
        const text = fighterInfo({ galaxy, player, resource: () => undefined } as never, f).rows.map(rowText).join('\n');
        expect(text).not.toContain('Bonuses');
    });
    it('the captain\'s bonus: "Ship Captain: +15% Fighters" (and the panel shows it)', () => {
        const carrier = playerCarrier();
        const [f] = readyFighters(carrier);
        carrier.shipGroup = null;
        captainBonusMap.set(carrier, { targeting: 100, countermeasures: 100, shipManeuvering: 100, fighters: 115, shipEnergyUsage: 100, weaponsDamage: 100, weaponsRange: 100, shieldRechargeRate: 100, damageControl: 100, repair: 100, hyperjumpSpeed: 100 } as never);
        const text = fighterCharacterBonusDescription(f);
        expect(text).toMatch(/: \+15% /);
        expect(text.startsWith('Ship Captain')).toBe(true);
        const rows = fighterInfo({ galaxy, player, resource: () => undefined } as never, f).rows.map(rowText).join('\n');
        expect(rows).toContain(`Bonuses: ${text}`);
    });
    it('in a fleet the admiral\'s factor is ADDED (as the C#): no bonuses anywhere reads +100%', () => {
        const carrier = playerCarrier();
        const [f] = readyFighters(carrier);
        captainBonusMap.delete(carrier);
        const g = new ShipGroup(galaxy);
        g.fightersBonusBase = 1.2;
        carrier.shipGroup = g;
        // num = 1.0 + 1.2 = 2.2; only the admiral's flag.
        expect(fighterCharacterBonusDescription(f)).toMatch(/^Fleet Admiral: \+120% /);
        g.fightersBonusBase = 1.0;
        expect(fighterCharacterBonusDescription(f)).toMatch(/^: \+100% /);
    });
});

describe('?simWorker=1: the fighter order from the replica', () => {
    function fakeClock(): () => number {
        let t = 0;
        return () => (t += 0.001);
    }
    it('the replica fighter\'s Launch button goes to the worker, which journals the fighter by carrier + id', () => {
        const game = cachedTickGame(gameData);
        galaxy = game.galaxy;
        player = galaxy.playerEmpire!;
        const carrier = playerCarrier();
        const fighters = readyFighters(carrier);
        const real = fighters[0];
        const time = new GalaxyTime();
        time.paused = false;
        const host = new SimHost(game, time, {} as StartGameOptions, { now: fakeClock() });
        const client = new SimClientCore(gameData, structuredClone(host.snapshot()), {
            post: (m: ToWorker) => {
                const c = structuredClone(m);
                if (c.type === 'command') host.command(c);
                else if (c.type === 'clock') host.clock(c);
            },
            now: fakeClock(),
        });
        const uiTime = new GalaxyTime();
        uiTime.bindGalaxy(client.galaxy);
        uiTime.speed = time.speed;
        uiTime.paused = false;
        const tick = (): void => {
            client.syncClock(uiTime);
            const m = host.tick(FRAME_REAL_MS);
            if (m !== null) client.receive(structuredClone(m));
            client.frame(uiTime);
        };
        tick();
        const rg = client.galaxy;
        const rp = client.game.playerEmpire;
        const rCarrier = rg.builtObjects.find((b) => b !== null && b.builtObjectID === carrier.builtObjectID)!;
        const rf = fightersOf(rCarrier)!.find((f) => f.fighterID === real.fighterID)!;
        expect(rf).toBeDefined();
        expect(rf).not.toBe(real);
        // The buttons are a read of the replica (no command).
        const buttons = selectionButtons({ galaxy: rg, empire: rp, selected: rf }, null)!;
        expect(buttons[0].action!.actionType).toBe(ShipActionType.FighterLaunchFighters);
        let reply: ShipActionResult | null = null;
        issuePlayerCommand(rg, rp, 'shipAction', [rf, buttons[0].action!, false, undefined], (r) => (reply = r));
        for (let i = 0; i < 3 && reply === null; i++) tick();
        expect(reply).not.toBeNull();
        expect(real.onboardCarrier).toBe(false);
        const last = commandLog(game.galaxy).filter((e) => e.source === 'player').at(-1)!;
        expect(last.source === 'player' && last.op).toBe('shipAction');
        if (last.source === 'player') {
            expect(last.error).toBeUndefined();
            expect(last.args[0]).toEqual({ r: 'fi', k: [carrier.builtObjectID, real.fighterID] });
        }
        client.dispose();
        host.dispose();
    }, 300000);
});
