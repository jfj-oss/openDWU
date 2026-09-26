// suggest: advisor suggestions for SemiAutomated tasks — Empire.8.cs 4395 CheckTaskAuthorized (the suggestion + the
// DeclinedTaskList), Main.Part2.cs 1369 btnAdvisorSuggestionApprove_Click / 2732 btnAdvisorSuggestionDecline_Click.
// Harness game: the shared tick game (seed 1, the human player at "Sol 2"). The construction decision is forced by
// clearing the player's research-colony list (Empire.ResearchHabitats), which makes Empire.6.cs 2586-2629 (a research
// station at a colony, CheckBuildoutResearchCapacityAtColonies) want an Energy Research Station at Sol 2.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import { AutomationLevel } from '../src/sim/empire';
import { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { directConstruction, queueOf } from '../src/sim/construction/empireConstruction';
import { checkTaskAuthorized } from '../src/sim/diplomacyTick';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { EmpireMessage, EmpireMessageType } from '../src/sim/messages';
import {
    ADVISOR_SUGGESTION_LIFETIME,
    AdvisorMessageType,
    BoxedPirateRelationType,
    addAdvisorSuggestion,
    advisorSuggestions,
    expireAdvisorSuggestionsForEmpire,
    expireOldAdvisorSuggestions,
    receiveAdvisorSuggestionMessage,
} from '../src/sim/advisorQueue';
import {
    DECLINED_ATTACK_EMPIRE_WINDOW,
    DECLINED_TASK_TARGET_WINDOW,
    DeclinedTask,
    declinedTaskIndexOf,
    declinedTasksCheckAttackEmpireTargetValid,
    declinedTasksCheckTaskTargetValid,
} from '../src/sim/missions/distress';
import {
    advisorSuggestionCost,
    advisorSuggestionShowTarget,
    advisorSuggestionTitle,
    approveSuggestion,
    declineSuggestion,
} from '../src/sim/player/advisorSuggestions';
import { galaxyFromJSON, galaxyToJSON } from '../src/sim/save/galaxySave';
import type { Design } from '../src/sim/design';
import type { Habitat } from '../src/sim/types';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

const SEMI = AutomationLevel.PartiallyAutomated;
const FULL = AutomationLevel.FullyAutomated;
const MANUAL = AutomationLevel.Undefined;

/** A fresh harness game whose next DirectConstruction wants a research station at the capital. */
function forcedGame(level: AutomationLevel): Game {
    const game = createTickGame(gameData);
    const e = game.playerEmpire;
    e.controlStateConstruction = level;
    e.stateMoney = 1e6;
    e.researchHabitats = [];
    return game;
}

interface Built {
    subRole: BuiltObjectSubRole;
    design: string;
    builtAt: unknown;
    price: number;
}
function builtSince(game: Game, n0: number): Built[] {
    return game.galaxy.builtObjects.slice(n0).map((b: BuiltObject) => ({ subRole: b.subRole, design: b.design!.name, builtAt: b.builtAt, price: b.purchasePrice }));
}

describe('DeclinedTaskList (DeclinedTaskList.cs)', () => {
    it('CheckTaskTargetValid: invalid while ExpiryDate >= starDate; IndexOf matches by identity per class', () => {
        const game = createTickGame(gameData);
        const h = game.playerEmpire.capital!;
        const other = game.galaxy.empires.find((x) => x !== game.playerEmpire)!;
        const list = [new DeclinedTask(1000, h), new DeclinedTask(2000, null, other)];
        expect(declinedTaskIndexOf(list, h)).toBe(0);
        expect(declinedTaskIndexOf(list, other)).toBe(-1); // the attack-empire entry has no TaskTarget
        expect(declinedTasksCheckTaskTargetValid(list, h, 1000)).toBe(false);
        expect(declinedTasksCheckTaskTargetValid(list, h, 1001)).toBe(true);
        expect(declinedTasksCheckTaskTargetValid(list, null, 0)).toBe(true);
        expect(declinedTasksCheckAttackEmpireTargetValid(list, other, 2000)).toBe(false);
        expect(declinedTasksCheckAttackEmpireTargetValid(list, other, 2001)).toBe(true);
        expect(DECLINED_TASK_TARGET_WINDOW).toBe(600000);
        expect(DECLINED_ATTACK_EMPIRE_WINDOW).toBe(240000);
    }, 300000);
});

describe('checkTaskAuthorized (Empire.8.cs 4395)', () => {
    it('Fully → true, Manual → false, both record nothing; Semi (player) → a queued suggestion + DeclinedTasks, once', () => {
        const game = createTickGame(gameData);
        const { galaxy: g, playerEmpire: e } = game;
        const h = e.capital!;
        const other = g.empires.find((x) => x !== e && x.pirateEmpireBaseHabitat === null)!;
        const q = advisorSuggestions(e);
        const q0 = q.length;
        const d0 = e.declinedTasks.length;
        const draws0 = g.rnd.drawCount;
        expect(checkTaskAuthorized(g, e, FULL, { value: 0 }, 'x', h, AdvisorMessageType.BuildOneOff)).toBe(true);
        expect(checkTaskAuthorized(g, e, MANUAL, { value: 0 }, 'x', h, AdvisorMessageType.BuildOneOff)).toBe(false);
        expect(q.length).toBe(q0);
        expect(e.declinedTasks.length).toBe(d0);

        const refusal = { value: 0 };
        expect(checkTaskAuthorized(g, e, SEMI, refusal, 'Build it', h, AdvisorMessageType.BuildOneOff, other, 'data', 'data2')).toBe(false);
        expect(refusal.value).toBe(1);
        expect(q.length).toBe(q0 + 1);
        const m = q[q.length - 1];
        expect(m.messageType).toBe(EmpireMessageType.AdvisorSuggestion);
        expect(m.advisorMessageType).toBe(AdvisorMessageType.BuildOneOff);
        expect(m.subject).toBe(h);
        expect(m.description).toBe('Build it');
        expect(m.advisorMessageData).toBe('data');
        expect(m.advisorMessageData2).toBe('data2');
        const now = galaxyStarDate(g);
        expect(m.starDate).toBe(now);
        // 4425-4449: attack-empire entry (240 000) then the task target (600 000).
        const added = e.declinedTasks.slice(d0);
        expect(added.map((t) => [t.taskTarget, t.attackEmpireTarget, t.expiryDate])).toEqual([
            [null, other, now + 240000],
            [h, null, now + 600000],
        ]);
        // The refusal cap (Galaxy.MaximumMissionRefusals = 1) and the declined target both block a second suggestion.
        expect(checkTaskAuthorized(g, e, SEMI, refusal, 'again', other, AdvisorMessageType.TreatyOffer)).toBe(false);
        expect(checkTaskAuthorized(g, e, SEMI, { value: 0 }, 'again', h, AdvisorMessageType.BuildOneOff)).toBe(false);
        expect(q.length).toBe(q0 + 1);
        // A non-player empire at SemiAutomated is answered Yes.
        expect(checkTaskAuthorized(g, other, SEMI, { value: 0 }, 'x', h, AdvisorMessageType.BuildOneOff)).toBe(true);
        expect(g.rnd.drawCount).toBe(draws0);
    }, 300000);

    it('DiplomaticGift carries the amount in Money (4417)', () => {
        const { galaxy: g, playerEmpire: e } = createTickGame(gameData);
        const other = g.empires.find((x) => x !== e)!;
        checkTaskAuthorized(g, e, SEMI, { value: 0 }, 'gift', other, AdvisorMessageType.DiplomaticGift, null, 1234.9, null);
        const m = advisorSuggestions(e).at(-1)!;
        expect(m.money).toBe(1234);
        expect(m.advisorMessageData).toBeNull();
    }, 300000);
});

describe('advisor queue (DiplomaticMessageQueue.cs)', () => {
    it('ExpireInvalidMessages replaces an equivalent suggestion; BuildOrder keeps only the newest; old ones expire', () => {
        const { galaxy: g, playerEmpire: e } = createTickGame(gameData);
        const h = e.capital!;
        const mk = (t: AdvisorMessageType, subject: unknown, data: unknown = null, date = 0): EmpireMessage => {
            const m = new EmpireMessage(e, EmpireMessageType.AdvisorSuggestion, subject);
            m.advisorMessageType = t;
            m.advisorMessageData = data;
            m.starDate = date;
            return m;
        };
        const q = advisorSuggestions(e);
        q.length = 0;
        const a = mk(AdvisorMessageType.BuildOneOff, h, 'D1');
        addAdvisorSuggestion(e, a);
        addAdvisorSuggestion(e, mk(AdvisorMessageType.BuildOneOff, h, 'D2')); // different data: both stay
        const c = mk(AdvisorMessageType.BuildOneOff, h, 'D1');
        addAdvisorSuggestion(e, c); // equivalent to a: a goes
        expect(q.includes(a)).toBe(false);
        expect(q.length).toBe(2);
        const b1 = mk(AdvisorMessageType.BuildOrder, null);
        expect(receiveAdvisorSuggestionMessage(e, b1)).toBe(true);
        expect(receiveAdvisorSuggestionMessage(e, b1)).toBe(false);
        const b2 = mk(AdvisorMessageType.BuildOrder, null);
        receiveAdvisorSuggestionMessage(e, b2);
        expect(q.includes(b1)).toBe(false);
        expect(q.includes(b2)).toBe(true);
        // TreatyOffer / WarTradeSanctions supersede each other per target empire; ExpireDiplomacyMessagesForEmpire drops them.
        const other = g.empires.find((x) => x !== e)!;
        const t1 = mk(AdvisorMessageType.TreatyOffer, other, 1);
        addAdvisorSuggestion(e, t1);
        const t2 = mk(AdvisorMessageType.WarTradeSanctions, other, 7);
        addAdvisorSuggestion(e, t2);
        expect(q.includes(t1)).toBe(false);
        expect(expireAdvisorSuggestionsForEmpire(e, other)).toBe(1);
        // method_3: older than 250 × RealSecondsInGalacticYear.
        expect(ADVISOR_SUGGESTION_LIFETIME).toBe(150000);
        q.length = 0;
        const old = mk(AdvisorMessageType.ColonyFacility, h, 'F', 100);
        addAdvisorSuggestion(e, old);
        expect(expireOldAdvisorSuggestions(e, 100 + 150000)).toBe(0);
        expect(expireOldAdvisorSuggestions(e, 100 + 150001)).toBe(1);
        expect(q.includes(old)).toBe(false);
    }, 300000);
});

describe('a SemiAutomated player is advised instead of building (Empire.6.cs 2586-2629)', () => {
    it('FullyAutomated builds the research station; SemiAutomated queues a BuildOneOff suggestion; Manual does neither', () => {
        const full = forcedGame(FULL);
        const n0 = full.galaxy.builtObjects.length;
        directConstruction(full.galaxy, full.playerEmpire);
        const fullBuilt = builtSince(full, n0);
        expect(fullBuilt.length).toBe(1);
        expect(fullBuilt[0].subRole).toBe(BuiltObjectSubRole.EnergyResearchStation);
        expect(fullBuilt[0].builtAt).toBe(full.playerEmpire.capital);
        expect(advisorSuggestions(full.playerEmpire).length).toBe(0);

        const semi = forcedGame(SEMI);
        const s0 = semi.galaxy.builtObjects.length;
        directConstruction(semi.galaxy, semi.playerEmpire);
        expect(builtSince(semi, s0)).toEqual([]);
        const q = advisorSuggestions(semi.playerEmpire);
        expect(q.length).toBe(1);
        expect(q[0].advisorMessageType).toBe(AdvisorMessageType.BuildOneOff);
        expect(q[0].subject).toBe(semi.playerEmpire.capital);
        expect((q[0].advisorMessageData as Design).name).toBe(fullBuilt[0].design);
        expect(advisorSuggestionTitle(semi.galaxy, semi.playerEmpire, q[0])).toBe('Advisor Message BuildOneOff');
        expect(advisorSuggestionCost(semi.galaxy, semi.playerEmpire, q[0])).toBe(fullBuilt[0].price);
        const show = advisorSuggestionShowTarget(q[0])!;
        expect(show.kind).toBe('object');
        expect(show.kind === 'object' && show.object).toBe(semi.playerEmpire.capital);

        const manual = forcedGame(MANUAL);
        const m0 = manual.galaxy.builtObjects.length;
        directConstruction(manual.galaxy, manual.playerEmpire);
        expect(builtSince(manual, m0)).toEqual([]);
        expect(advisorSuggestions(manual.playerEmpire).length).toBe(0);
    }, 300000);

    it('Approve queues the same station at the same colony for the same price as FullyAutomated', () => {
        const full = forcedGame(FULL);
        const fMoney = full.playerEmpire.stateMoney;
        const n0 = full.galaxy.builtObjects.length;
        directConstruction(full.galaxy, full.playerEmpire);
        const fullBuilt = builtSince(full, n0);

        const semi = forcedGame(SEMI);
        const { galaxy: g, playerEmpire: e } = semi;
        directConstruction(g, e);
        const m = advisorSuggestions(e)[0];
        const money0 = e.stateMoney;
        const s0 = g.builtObjects.length;
        const r = approveSuggestion(g, e, m);
        expect(r.handled).toBe(true);
        const built = builtSince(semi, s0);
        expect(built.map((b) => ({ ...b, builtAt: (b.builtAt as Habitat).name }))).toEqual(fullBuilt.map((b) => ({ ...b, builtAt: (b.builtAt as Habitat).name })));
        const bo = g.builtObjects[s0];
        expect(queueOf(e.capital!)!.constructionWaitQueue!.includes(bo) || queueOf(e.capital!)!.construction.includes(bo)).toBe(true);
        expect(e.builtObjects).toContain(bo);
        // Main.Part2.cs 1427 StateMoney -= price; the tick path charges the same sum at Empire.6.cs 2840 (StateMoney -= num12).
        expect(e.stateMoney).toBe(money0 - built[0].price);
        expect(full.playerEmpire.stateMoney).toBe(fMoney - fullBuilt[0].price);
        expect(advisorSuggestions(e).includes(m)).toBe(false);
    }, 300000);

    it('Decline records Sol 2 for 600 000; DirectConstruction does not re-suggest within the window, and does after it', () => {
        const semi = forcedGame(SEMI);
        const { galaxy: g, playerEmpire: e } = semi;
        directConstruction(g, e);
        const m = advisorSuggestions(e)[0];
        const now = galaxyStarDate(g);
        expect(declineSuggestion(g, e, m)).toBe(true);
        expect(advisorSuggestions(e).length).toBe(0);
        const decl = e.declinedTasks.filter((t) => t.taskTarget === e.capital);
        expect(decl.map((t) => t.expiryDate)).toEqual([now + 600000, now + 600000]); // the prompt's record + the decline's
        directConstruction(g, e);
        expect(advisorSuggestions(e).length).toBe(0);
        g.nowMs += 600000; // still within: ExpiryDate >= starDate
        directConstruction(g, e);
        expect(advisorSuggestions(e).length).toBe(0);
        g.nowMs += 1;
        directConstruction(g, e);
        expect(advisorSuggestions(e).length).toBe(1);
    }, 300000);
});

describe('save round trip', () => {
    it('the player suggestion queue and declined tasks survive galaxyToJSON / galaxyFromJSON', () => {
        const semi = forcedGame(SEMI);
        const { galaxy: g, playerEmpire: e } = semi;
        directConstruction(g, e);
        const other = g.empires.find((x) => x !== e)!;
        checkTaskAuthorized(g, e, SEMI, { value: 0 }, 'protect', other, AdvisorMessageType.TreatyOffer, null, new BoxedPirateRelationType(1), null);
        const json = JSON.stringify(galaxyToJSON(g));
        const g2 = galaxyFromJSON(JSON.parse(json), gameData);
        const e2 = g2.playerEmpire!;
        const q2 = advisorSuggestions(e2);
        expect(q2.length).toBe(2);
        expect(q2[0]).toBeInstanceOf(EmpireMessage);
        expect(q2[0].subject).toBe(e2.capital);
        expect((q2[0].advisorMessageData as Design).name).toBe((advisorSuggestions(e)[0].advisorMessageData as Design).name);
        expect(e2.designs).toContain(q2[0].advisorMessageData);
        expect(q2[1].advisorMessageData).toBeInstanceOf(BoxedPirateRelationType);
        expect(e2.declinedTasks.map((t) => t.expiryDate)).toEqual(e.declinedTasks.map((t) => t.expiryDate));
        expect(e2.declinedTasks[e2.declinedTasks.length - 1].taskTarget).toBe(g2.empires.find((x) => x.name === other.name));
        expect(JSON.stringify(galaxyToJSON(g2))).toBe(json);
        // Approve after load works on the loaded graph.
        const s0 = g2.builtObjects.length;
        approveSuggestion(g2, e2, q2[0]);
        expect(g2.builtObjects.length).toBe(s0 + 1);
    }, 300000);
});
