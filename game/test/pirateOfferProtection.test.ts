// Bug fix: pirate offer messages such as EmpireMessageType.PirateOfferProtection ("We offer you our valuable
// services to protect your vulnerable empire", GameText.txt:1655) showed only an OK button. The original's popup
// for this message is a conversation with Accept and Decline responses (dialog/base_dialog.txt
// PIRATE_PROTECTIONPROPOSEINITIATE / PIRATE_TRUCEPROPOSEINITIATE / PIRATE_EXTORTPROTECTION, each with an
// ...ACCEPTRESPONSE and a ...REJECTRESPONSE) and clicking the advisor-queue stub opens the full Diplomacy talk
// panel on the pirate (Main.Part8.cs:449 method_296, wired from Main.Part12.cs:2706 method_79). This test covers:
//  1. the popup routes a PirateOfferProtection message to the pirate-protection button set (Accept / Open
//     Diplomacy / Decline), not the plain-OK set other conversations (and CancelPirateProtection) get;
//  2. Accept issues the 'acceptPirateOfferProtection' player command, which only takes effect at the next frame
//     boundary, and then the protection agreement exists with the ported Empire.3.cs 4213 AcceptPirateProtection
//     cost/effects (money moves, PirateRelationType.Protection on both sides);
//  3. Open Diplomacy calls toggleDiplomacyScreen with the sender pre-selected;
//  4. no command / no sim-state change is the only thing "Decline" (or the plain OK button) ever does.

import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as DiplomacyScreenModule from '../src/ui/screens/diplomacyScreen';

const { toggleDiplomacyScreenMock } = vi.hoisted(() => ({ toggleDiplomacyScreenMock: vi.fn() }));
vi.mock('../src/ui/screens/diplomacyScreen', async (importOriginal) => {
    const actual = await importOriginal<typeof DiplomacyScreenModule>();
    return { ...actual, toggleDiplomacyScreen: toggleDiplomacyScreenMock };
});

import { isPirateProtectionOfferEntry, openDiplomacyForPirateOffer, type ConversationEntry } from '../src/ui/messagePopups';
import { defaultMessageOptions, routeEmpireMessage } from '../src/ui/messageRouting';
import { EmpireMessage, EmpireMessageType } from '../src/sim/messages';
import { PirateRelationType, obtainPirateRelation } from '../src/sim/pirateRelations';
import { calculatePirateProtectionPricePerMonth } from '../src/sim/pirates/pirateRelationsAI';
import { flushPlayerCommands, issuePlayerCommand, pendingPlayerCommands } from '../src/sim/player/playerCommands';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Empire } from '../src/sim/empire';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

describe('pirate protection offer popup: button set (Main.Part9.cs:2075-2091)', () => {
    it('a PirateOfferProtection message routes to the Accept / Open Diplomacy / Decline conversation', () => {
        const sender = {} as Empire;
        const message = new EmpireMessage(sender, EmpireMessageType.PirateOfferProtection, null);
        message.money = 5000; // a real (non-truce) offer: messageRouting.ts uses message.money > 0 as the proxy
        const options = defaultMessageOptions();
        const route = routeEmpireMessage(message, null, options);
        expect(route.conversation).toBe('PIRATE_PROTECTIONPROPOSEINITIATE');
        const entry: ConversationEntry = { message, conversation: route.conversation!, sender };
        expect(isPirateProtectionOfferEntry(entry)).toBe(true);
    });

    it('the truce and extortion variants also get the button set', () => {
        const sender = {} as Empire;
        const options = defaultMessageOptions();
        const truce = new EmpireMessage(sender, EmpireMessageType.PirateOfferProtection, null);
        truce.money = 0;
        const truceRoute = routeEmpireMessage(truce, null, options);
        expect(truceRoute.conversation).toBe('PIRATE_TRUCEPROPOSEINITIATE');
        expect(isPirateProtectionOfferEntry({ message: truce, conversation: truceRoute.conversation!, sender })).toBe(true);

        const extort = new EmpireMessage(sender, EmpireMessageType.PirateOfferProtection, null);
        extort.hint = 'extort';
        const extortRoute = routeEmpireMessage(extort, null, options);
        expect(extortRoute.conversation).toBe('PIRATE_EXTORTPROTECTION');
        expect(isPirateProtectionOfferEntry({ message: extort, conversation: extortRoute.conversation!, sender })).toBe(true);
    });

    it('a sender-less entry (defensive) and other pirate conversations fall back to the plain OK button', () => {
        const sender = {} as Empire;
        // No ConversationOption in the original (Main.Part9.cs:2313): plain popup, no conversation at all.
        const attackMission = new EmpireMessage(sender, EmpireMessageType.PirateAttackMissionAvailable, null);
        const route = routeEmpireMessage(attackMission, null, defaultMessageOptions());
        expect(route.conversation).toBeNull();

        // CancelPirateProtection is a conversation, but not one of the three protection-offer types.
        const cancel = new EmpireMessage(sender, EmpireMessageType.CancelPirateProtection, null);
        const cancelRoute = routeEmpireMessage(cancel, null, defaultMessageOptions());
        expect(cancelRoute.conversation).toBe('CANCELPIRATEPROTECTION');
        expect(isPirateProtectionOfferEntry({ message: cancel, conversation: cancelRoute.conversation!, sender })).toBe(false);

        // A protection offer with no sender (defensive: never reached from a real message) also falls back.
        const noSender = new EmpireMessage(sender, EmpireMessageType.PirateOfferProtection, null);
        expect(isPirateProtectionOfferEntry({ message: noSender, conversation: 'PIRATE_PROTECTIONPROPOSEINITIATE', sender: null })).toBe(false);
    });
});

describe('pirate protection offer popup: Open Diplomacy (Main.Part8.cs:449 method_296)', () => {
    it('calls toggleDiplomacyScreen with the sender pre-selected', () => {
        toggleDiplomacyScreenMock.mockClear();
        const player = {} as Empire;
        const sender = {} as Empire;
        openDiplomacyForPirateOffer(player, sender);
        expect(toggleDiplomacyScreenMock).toHaveBeenCalledTimes(1);
        expect(toggleDiplomacyScreenMock).toHaveBeenCalledWith({ player, selectedEmpire: sender });
    });
});

describe('pirate protection offer popup: Accept (Main.Part10.cs:5132 PIRATE_PROTECTIONACCEPTRESPONSE)', () => {
    it('issues a command; nothing changes until the next frame boundary, then the agreement exists at the ported cost', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const player = game.playerEmpire;
        const pirate = g.pirateEmpires[0];
        expect(pirate).toBeDefined();
        expect(obtainPirateRelation(player, pirate).type).not.toBe(PirateRelationType.Protection);

        const expectedCost = calculatePirateProtectionPricePerMonth(g, pirate, player).price;
        const playerMoneyBefore = player.stateMoney;
        const pirateMoneyBefore = pirate.stateMoney;

        let result: { accepted: boolean; cost: number } | null = null;
        issuePlayerCommand(g, player, 'acceptPirateOfferProtection', [pirate], (r) => (result = r));
        // Not applied yet: the command only runs at the next frame boundary (player/playerCommands.ts).
        expect(pendingPlayerCommands(g)).toBe(1);
        expect(obtainPirateRelation(player, pirate).type).not.toBe(PirateRelationType.Protection);
        expect(player.stateMoney).toBe(playerMoneyBefore);

        // The frame boundary, isolated from the sim's own per-tick economy (no runSimFrame/clock advance): only the
        // queued command's own effect should move state.
        flushPlayerCommands(g);

        expect(pendingPlayerCommands(g)).toBe(0);
        expect(result).toEqual({ accepted: true, cost: expectedCost });
        expect(obtainPirateRelation(player, pirate).type).toBe(PirateRelationType.Protection);
        expect(obtainPirateRelation(pirate, player).type).toBe(PirateRelationType.Protection);
        if (expectedCost > 0) {
            expect(player.stateMoney).toBe(playerMoneyBefore - expectedCost);
            expect(pirate.stateMoney).toBe(pirateMoneyBefore + expectedCost);
        } else {
            expect(player.stateMoney).toBe(playerMoneyBefore);
            expect(pirate.stateMoney).toBe(pirateMoneyBefore);
        }
    }, 300000);

    it('accepting again once already protected is a no-op (PIRATE_PROTECTIONALREADYPAID)', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const player = game.playerEmpire;
        const pirate = g.pirateEmpires[0];
        issuePlayerCommand(g, player, 'acceptPirateOfferProtection', [pirate]);
        flushPlayerCommands(g);
        expect(obtainPirateRelation(player, pirate).type).toBe(PirateRelationType.Protection);

        const playerMoneyBefore = player.stateMoney;
        const pirateMoneyBefore = pirate.stateMoney;
        let result: { accepted: boolean; cost: number } | null = null;
        issuePlayerCommand(g, player, 'acceptPirateOfferProtection', [pirate], (r) => (result = r));
        flushPlayerCommands(g);
        expect(result).toEqual({ accepted: false, cost: 0 });
        expect(player.stateMoney).toBe(playerMoneyBefore);
        expect(pirate.stateMoney).toBe(pirateMoneyBefore);
    }, 300000);
});

describe('pirate protection offer popup: Decline / OK do nothing to sim state', () => {
    it('no command issued leaves the pirate relation and both empires\' money untouched at the frame boundary', () => {
        // The Decline / OK button handlers (src/ui/messagePopups.ts openDialog) only remove the queue entry and
        // close the dialog — they never call issuePlayerCommand, so declining is exactly "no command issued".
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const player = game.playerEmpire;
        const pirate = g.pirateEmpires[0];
        const before = obtainPirateRelation(player, pirate).type;
        const playerMoneyBefore = player.stateMoney;
        const pirateMoneyBefore = pirate.stateMoney;

        expect(pendingPlayerCommands(g)).toBe(0);
        flushPlayerCommands(g);

        expect(obtainPirateRelation(player, pirate).type).toBe(before);
        expect(player.stateMoney).toBe(playerMoneyBefore);
        expect(pirate.stateMoney).toBe(pirateMoneyBefore);
    }, 300000);
});
