// Empires / Diplomacy screen data model (known vs unknown info), the diplomacy commands' effect after the frame
// boundary, and the selection panel's ship/fleet fields. Pure data; the DOM needs a browser.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { BuiltObject } from '../src/sim/builtObject';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { SystemVisibilityStatus } from '../src/sim/visibility';
import { empireIntel, formatMillions, isMet } from '../src/ui/screens/empireIntel';
import { totalMobileMilitaryFirepower } from '../src/sim/forceStructure';
import { diplomacyRows } from '../src/ui/screens/diplomacyScreen';
import { flushPlayerCommands, issuePlayerCommand } from '../src/sim/player/playerCommands';
import { listProposals } from '../src/sim/player/diplomacyProposals';
import { runSimFrame } from '../src/sim/tick/scheduler';
import { createShipAction, ShipActionType } from '../src/sim/player/shipAction';
import { automationToggleLabel, builtObjectRows, builtObjectStatusRows, hyperjumpStatusText } from '../src/ui/hud';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';

let gameData: GameData;
let galaxy: Galaxy;
let player: Empire;
let ai: Empire;

function meet(type: DiplomaticRelationType, initiator: Empire = player): void {
    for (const [x, y] of [[player, ai], [ai, player]] as const) {
        const r = obtainDiplomaticRelation(x, y);
        r.type = type;
        r.initiator = initiator;
        r.locked = false;
    }
}

beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);
beforeEach(() => {
    galaxy = cachedTickGame(gameData).galaxy;
    player = galaxy.playerEmpire!;
    ai = galaxy.empires.find((e) => e !== player && e.pirateEmpireBaseHabitat === null && e !== galaxy.independentEmpire && e.active)!;
    ai.reclusive = false;
    player.stateMoney = 80000;
});

describe('empire screen data model: known vs unknown', () => {
    it('unmet empires are not listed; met ones carry their strengths', () => {
        meet(DiplomaticRelationType.NotMet);
        expect(isMet(player, ai)).toBe(false);
        expect(diplomacyRows(player, galaxyStarDate(galaxy), '').some((r) => r.empire === ai)).toBe(false);
        meet(DiplomaticRelationType.None);
        expect(isMet(player, ai)).toBe(true);
        expect(diplomacyRows(player, galaxyStarDate(galaxy), '').some((r) => r.empire === ai)).toBe(true);
        const i = empireIntel(player, ai);
        expect(i.colonies).toBe(ai.colonies.length);
        expect(i.populationMillions).toBe(ai.totalPopulation / 1000000);
        expect(i.firepower).toBe(totalMobileMilitaryFirepower(ai.builtObjects));
        expect(i.raceName).toBe(ai.dominantRace!.name);
        expect(i.raceFamily).not.toBe('');
        expect(i.racePictureIndex).toBe(ai.dominantRace!.pictureIndex);
        expect(i.government).not.toBe('');
        expect(formatMillions(1234.4)).toBe('1,234M');
    });

    it("the capital is '(Unknown)' (null) until the player has explored its system (EmpireDetailView.cs:420)", () => {
        const cap = ai.capital!;
        const status = player.visibility.systemVisibility[cap.systemIndex];
        const saved = status.status;
        status.status = SystemVisibilityStatus.Unexplored;
        expect(player.visibility.checkSystemExplored(cap.systemIndex)).toBe(false);
        expect(empireIntel(player, ai).capital).toBeNull();
        status.status = SystemVisibilityStatus.Explored;
        expect(empireIntel(player, ai).capital).toContain(cap.name);
        status.status = saved;
    });
});

describe('diplomacy commands take effect at the frame boundary', () => {
    it('gift: money moves only after the next frame; relation options include treaty, gift, warning, trade', () => {
        meet(DiplomaticRelationType.None);
        const ids = listProposals(galaxy, player, ai).map((o) => o.id);
        expect(ids).toEqual(expect.arrayContaining(['GIFT_GIVE:small', 'DEAL_BEGIN:trade']));
        expect(ids.some((id) => id.startsWith('WARNING'))).toBe(true);
        const money = player.stateMoney;
        let res: unknown = null;
        issuePlayerCommand(galaxy, player, 'submitProposal', [ai, 'GIFT_GIVE:large'], (r) => (res = r));
        expect(player.stateMoney).toBe(money);
        runSimFrame(galaxy, 17);
        expect(res).toMatchObject({ ok: true, accepted: true });
        expect(player.stateMoney).toBe(money - 10000);
    });

    it('declare war changes the relation only after the frame', () => {
        meet(DiplomaticRelationType.None);
        issuePlayerCommand(galaxy, player, 'submitProposal', [ai, 'WAR_DECLARE'], () => undefined);
        expect(obtainDiplomaticRelation(player, ai).type).toBe(DiplomaticRelationType.None);
        runSimFrame(galaxy, 17);
        expect(obtainDiplomaticRelation(player, ai).type).toBe(DiplomaticRelationType.War);
    });

    it('DEAL_BEGIN opens a trade negotiation (money/techs/maps/territory items)', () => {
        meet(DiplomaticRelationType.None);
        let res: { trade: unknown } | null = null;
        issuePlayerCommand(galaxy, player, 'submitProposal', [ai, 'DEAL_BEGIN:trade'], (r) => (res = r as { trade: unknown }));
        runSimFrame(galaxy, 17);
        expect(res!.trade).not.toBeNull();
    });
});

describe('selection panel fields', () => {
    function ship(): BuiltObject {
        return player.builtObjects.find((b) => b != null && b.role !== BuiltObjectRole.Base && b.owner === player && !b.hasBeenDestroyed)!;
    }
    const value = (rows: { label: string; value: string }[], l: string): string | undefined => rows.find((r) => r.label === l)?.value;

    it('shows shields current/max, weapons firepower, hyperjump status and type', () => {
        const b = ship();
        const rows = builtObjectStatusRows(b, player);
        expect(value(rows, 'Shields')).toBe(`${Math.trunc(b.currentShields)} / ${Math.trunc(b.shieldsCapacity)}`);
        expect(value(rows, 'Weapons')).toBe(b.firepowerRaw === 0 ? '(None)' : `Firepower: ${b.firepowerRaw}, Range: ${Math.trunc(b.maximumWeaponsRange)}`);
        expect(value(rows, 'Hyperjump')).toBeDefined();
        expect(value(builtObjectRows(b), 'Type')).toBe('STATE');
    });

    it('hyperjump: no hyperdrive / charging countdown / ready', () => {
        const b = ship();
        const saved = { w: b.warpSpeed, p: b.hyperjumpPrepare, c: b.hyperjumpCountdown, d: b.hyperjumpDisabledLocation };
        b.warpSpeed = 0;
        expect(hyperjumpStatusText(b)).toBe('No hyperdrive');
        b.warpSpeed = 3000;
        b.hyperjumpDisabledLocation = false;
        b.canHyperJump = true;
        b.hyperjumpPrepare = true;
        b.hyperjumpCountdown = galaxyStarDate(galaxy) + 7500;
        expect(hyperjumpStatusText(b)).toBe('Charging (8 s)');
        b.hyperjumpPrepare = false;
        expect(hyperjumpStatusText(b)).toBe('Ready');
        b.warpSpeed = saved.w;
        b.hyperjumpPrepare = saved.p;
        b.hyperjumpCountdown = saved.c;
        b.hyperjumpDisabledLocation = saved.d;
    });

    it('the automation toggle goes through the command log and flips IsAutoControlled', () => {
        const b = ship();
        b.isAutoControlled = false;
        expect(automationToggleLabel(b).automated).toBe(false);
        issuePlayerCommand(galaxy, player, 'shipAction', [b, createShipAction(ShipActionType.AutomateShip, b), false, undefined], () => undefined);
        expect(b.isAutoControlled).toBe(false);
        flushPlayerCommands(galaxy);
        expect(b.isAutoControlled).toBe(true);
        expect(automationToggleLabel(b).automated).toBe(true);
        issuePlayerCommand(galaxy, player, 'shipAction', [b, createShipAction(ShipActionType.UnautomateShip, b), false, undefined], () => undefined);
        flushPlayerCommands(galaxy);
        expect(b.isAutoControlled).toBe(false);
    });
});
