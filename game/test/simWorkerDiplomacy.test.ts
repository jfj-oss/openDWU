// Sim worker, chunk 7 (docs/sim-worker.md §9): diplomacy, intelligence / characters and politics in worker mode.
// - remoteArgs: by-value arguments keep their identity (shared / cyclic values within an argument; the same object sent
//   by two commands of one boundary decodes to one object, as the executors share it in-thread);
// - listProposals and the pirate protection price — C# reads that add the relation records they look up — are UI reads
//   in both modes (on the replica in worker mode) that give the in-thread answers; the records they would add are added
//   by one journaled 'obtainUiRecords' command (sim/readOnlyQuery.ts), so the game they leave is the in-thread one;
// - the screens' command flows issued on the REPLICA (proposals, a trade negotiation edited on the main thread, pirate
//   protection, agent missions with a false flag, character transfer / dismissal, peace terms) give the in-thread
//   command log and state digest, tick for tick;
// (simWorkerScreenReads.test.ts: everything the chunk-7 screens still read on the replica is write-free.)
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import { createScenarioGame } from './helpers/scenarioGame';
import { drive, empireOn, expectSameGame, inThread, inWorker, meetAll, normalAis, setRelation, type Side } from './helpers/simWorkerSides';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Empire } from '../src/sim/empire';
import { commandLog } from '../src/sim/player/commandLog';
import { empireShipGroups } from '../src/sim/fleets/shipGroup';
import { setShipsFleet } from '../src/sim/player/fleetOps';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { issuePlayerCommand } from '../src/sim/player/playerCommands';
import { galaxyToJSON } from '../src/sim/save/galaxySave';
import { RemoteValues, decodeRemoteArg, encodeRemoteArg, type RemoteNaming, type RemoteResolving } from '../src/simworker/remoteArgs';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { Character, CharacterRole, getEmpireCharacters, IntelligenceMission } from '../src/sim/characters';
import { characterMission, IntelligenceMissionType } from '../src/sim/espionage';
import { missionFrame } from '../src/sim/scenario/emergent/espionage';
import { listProposals, type ProposalOption, type ProposalResult } from '../src/sim/player/diplomacyProposals';
import { addTradeItem, tradeItemLabel, tradeTreeRows, type TradeNegotiation, type TradeOfferResult } from '../src/sim/player/tradeNegotiation';
import { TradeableItemType } from '../src/sim/tradeItems';
import { calculatePirateProtectionPricePerMonth } from '../src/sim/pirates/pirateRelationsAI';
import { buildTerms, termsChoices, warView, type PeaceTermsResult } from '../src/sim/scenario/lively/peaceTerms';
import { declareWar } from '../src/sim/diplomacyTick';
import { politicsEntry } from '../src/sim/scenario/emergent/politics';
import { detachTradeNegotiation } from '../src/ui/screens/tradePanel';
import { blameOptions, missionFrameLabel } from '../src/sim/scenario/emergent/espionageView';
import { buildMissionState, initialMissionForm, resolveTransferDestination, transferOptions, withMissionType } from '../src/ui/screens/intelligence';
import { politicsDetail } from '../src/ui/emergentPolitics';
import { courtDetail } from '../src/ui/courtView';
import { investigatorOptions, leadRows } from '../src/ui/internalSecurityView';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

describe('remoteArgs: by-value identity', () => {
    const naming = (): RemoteNaming => {
        const ids = new WeakMap<object, number>();
        let next = 0;
        return {
            syncId: () => -1,
            external: () => undefined,
            valueId: (o) => {
                let v = ids.get(o);
                if (v === undefined) ids.set(o, (v = next++));
                return v;
            },
        };
    };
    const resolving = (values?: RemoteValues): RemoteResolving => ({ object: () => null, external: () => undefined, values });

    it('shared and cyclic values within one argument decode to one object', () => {
        const shared = { n: 1 };
        const v = { a: [shared, shared], b: shared } as { a: unknown[]; b: unknown; self?: unknown; list?: unknown[] };
        v.self = v;
        const list: unknown[] = [];
        list.push(list, shared);
        v.list = list;
        const out = decodeRemoteArg(structuredClone(encodeRemoteArg(v, naming())), resolving()) as typeof v;
        expect(out.a[0]).toBe(out.a[1]);
        expect(out.b).toBe(out.a[0]);
        expect(out.self).toBe(out);
        expect(out.list![0]).toBe(out.list);
        expect(out.list![1]).toBe(out.b);
        expect(out.b).toEqual({ n: 1 });
    });

    it('the same object sent by two commands decodes to one object (RemoteValues)', () => {
        const n = naming();
        const values = new RemoteValues();
        const m = { type: 3, progress: 0, target: 'x' };
        // Same boundary: the second send refills the object with the latest contents.
        const first = decodeRemoteArg(structuredClone(encodeRemoteArg(m, n)), resolving(values)) as typeof m;
        m.progress = 5;
        const second = decodeRemoteArg(structuredClone(encodeRemoteArg([m], n)), resolving(values)) as (typeof m)[];
        expect(second[0]).toBe(first);
        expect(first.progress).toBe(5);
        // The boundary applied it; the sim changes it; the main thread sends it again with one field of its own changed:
        // the same object, the sim's change kept, the main thread's change written.
        values.boundary();
        first.progress = 9;
        m.target = 'y';
        const third = decodeRemoteArg(structuredClone(encodeRemoteArg(m, n)), resolving(values)) as typeof m;
        expect(third).toBe(first);
        expect(third).toEqual({ type: 3, progress: 9, target: 'y' });
        // Forgotten after a few boundaries: a fresh copy.
        values.boundary();
        values.boundary();
        values.boundary();
        expect(values.size).toBe(0);
        const fourth = decodeRemoteArg(structuredClone(encodeRemoteArg(m, n)), resolving(values));
        expect(fourth).not.toBe(first);
        expect(fourth).toEqual(m);
    });

    it('class instances keep their class', () => {
        const n = naming();
        const mission = new IntelligenceMission(null, null, 0);
        const out = decodeRemoteArg(structuredClone(encodeRemoteArg(mission, n)), resolving(new RemoteValues()));
        expect(out).toBeInstanceOf(IntelligenceMission);
        expect(out).toEqual(mission);
    });
});

describe('sim worker chunk 7: the listing reads that obtain records', () => {
    it('listProposals and the protection price: the same answers on the replica, the records added by one journaled command in both modes', async () => {
        // Not everyone met: the reads would add NotMet relations and pirate relations (Obtain*).
        const ga = cachedTickGame(base);
        const gw = cachedTickGame(base);
        const a = inThread(ga);
        const w = inWorker(gw, base);
        w.settle();
        const others = [...normalAis(a.galaxy), ...a.galaxy.pirateEmpires.filter((p) => p !== null)];
        const relationCount = (g: Game): number => [g.playerEmpire, ...normalAis(g.galaxy), ...g.galaxy.pirateEmpires].reduce((n, e) => n + (e?.diplomaticRelations.count ?? 0) + (e?.pirateRelations.count ?? 0), 0);
        const before = relationCount(ga);
        const read = (s: Side) => others.map((o) => {
            const other = empireOn(s, o);
            return {
                options: listProposals(s.galaxy, s.player, other),
                price: other.pirateEmpireBaseHabitat !== null ? calculatePirateProtectionPricePerMonth(s.galaxy, other, s.player).price : undefined,
            };
        });
        const ra = read(a);
        const rw = read(w);
        // A read writes nothing (in-thread the UI galaxy, in worker mode the replica).
        expect(relationCount(ga)).toBe(before);
        expect(w.replicaWrites()).toEqual([]);
        for (let i = 0; i < others.length; i++) {
            expect(rw[i].options.map((o) => [o.id, o.label, o.enabled, o.hint, o.cost])).toEqual(ra[i].options.map((o) => [o.id, o.label, o.enabled, o.hint, o.cost]));
            expect(rw[i].price).toBe(ra[i].price);
        }
        expect(ra.some((r) => r.options.length > 0)).toBe(true);
        expect(ra.some((r) => r.price !== undefined)).toBe(true);
        // After the UI task, the records go out as one command each side, applied at the next boundary.
        await new Promise((r) => setTimeout(r, 0));
        a.tick();
        w.tick();
        const ops = (g: Game) => commandLog(g.galaxy).filter((e) => e.source === 'player').map((e) => (e as { op: string }).op);
        expect(ops(ga)).toEqual(['obtainUiRecords']);
        expect(relationCount(ga)).toBeGreaterThan(before);
        expectSameGame(a, w);
        // Read again: nothing left to add.
        read(a);
        read(w);
        await new Promise((r) => setTimeout(r, 0));
        a.tick();
        w.tick();
        expect(ops(ga)).toEqual(['obtainUiRecords']);
        expectSameGame(a, w);
        expect(w.replicaWrites()).toEqual([]);
        w.dispose();
    }, 600000);
});

describe('sim worker chunk 7: screen command flows through the replica = in-thread', () => {
    it('proposals, a trade negotiation edited on the main thread, and pirate protection', () => {
        const ga = cachedTickGame(base);
        const gw = cachedTickGame(base);
        for (const g of [ga, gw]) {
            meetAll(g.galaxy);
            g.playerEmpire.stateMoney = 500000;
            for (const e of normalAis(g.galaxy)) e.reclusive = false;
        }
        const a = inThread(ga);
        const w = inWorker(gw, base);
        const ais = normalAis(a.galaxy);
        const peaceful = ais.find((e) => obtainDiplomaticRelation(a.player, e).type === DiplomaticRelationType.None)!;
        const atWar = ais.find((e) => obtainDiplomaticRelation(a.player, e).type === DiplomaticRelationType.War)!;
        const pirate = a.galaxy.pirateEmpires.find((p) => p !== null && !p.pirateEmpireSuperPirates)!;
        expect([peaceful, atWar, pirate].every((e) => e !== undefined)).toBe(true);

        interface Ui {
            replies: { id: string; res: ProposalResult }[];
            trade: TradeNegotiation | null;
            tradeResults: TradeOfferResult[];
        }
        const uis = new Map<Side, Ui>([
            [a, { replies: [], trade: null, tradeResults: [] }],
            [w, { replies: [], trade: null, tradeResults: [] }],
        ]);
        const submit = (s: Side, other: Empire, id: string): void => {
            const ui = uis.get(s)!;
            issuePlayerCommand(s.galaxy, s.player, 'submitProposal', [empireOn(s, other), id], (res) => {
                ui.replies.push({ id, res });
                // DEAL_BEGIN: the trade panel's negotiation (detached from the replica in worker mode, tradePanel.ts).
                if (res.trade !== null) ui.trade = s.worker ? detachTradeNegotiation(res.trade) : res.trade;
            });
        };
        drive([a, w], 40, (s, i) => {
            const ui = uis.get(s)!;
            switch (i) {
                case 1:
                    submit(s, peaceful, 'GIFT_GIVE:small');
                    break;
                case 3:
                    submit(s, peaceful, 'OFFER_FREETRADE');
                    submit(s, peaceful, 'WARNING_ATTACKS');
                    break;
                case 5:
                    submit(s, peaceful, 'DEAL_BEGIN:trade');
                    break;
                case 8: {
                    // The trade panel: ask for their first item, offer money (picked by position in the trees). On the
                    // replica it reads without writing.
                    const n = ui.trade!;
                    const before = s.worker ? JSON.stringify(galaxyToJSON(s.galaxy)) : '';
                    for (const t of [n.us, n.them]) for (const g of tradeTreeRows(s.galaxy, t)) for (const r of g.rows) tradeItemLabel(s.galaxy, r.item, true, t.empire === s.galaxy.playerEmpire);
                    if (s.worker) expect(JSON.stringify(galaxyToJSON(s.galaxy)) === before).toBe(true);
                    const theirs = tradeTreeRows(s.galaxy, n.them).flatMap((g) => g.rows).find((r) => r.item.type !== TradeableItemType.Money);
                    const money = tradeTreeRows(s.galaxy, n.us).flatMap((g) => g.rows).filter((r) => r.item.type === TradeableItemType.Money);
                    if (theirs !== undefined) expect(addTradeItem(s.galaxy, n.them, theirs.item)).toBe(true);
                    expect(addTradeItem(s.galaxy, n.us, money[money.length - 1].item)).toBe(true);
                    issuePlayerCommand(s.galaxy, s.player, 'submitTradeOffer', [n], (r) => ui.tradeResults.push(r));
                    break;
                }
                case 12: {
                    // Improve the offer and propose again (the same negotiation object, edited on the main thread).
                    const n = ui.trade!;
                    const money = tradeTreeRows(s.galaxy, n.us).flatMap((g) => g.rows).filter((r) => r.item.type === TradeableItemType.Money);
                    addTradeItem(s.galaxy, n.us, money[money.length - 1].item);
                    issuePlayerCommand(s.galaxy, s.player, 'submitTradeOffer', [n], (r) => ui.tradeResults.push(r));
                    break;
                }
                case 15:
                    submit(s, atWar, 'WAR_END');
                    submit(s, peaceful, 'OFFER_DEAL');
                    break;
                case 18: {
                    const deal = ui.replies.find((r) => r.id === 'OFFER_DEAL')!;
                    if (deal.res.followUps.length > 0) submit(s, peaceful, deal.res.followUps[0].id);
                    submit(s, pirate, 'PIRATE_PROTECTIONPROPOSE');
                    break;
                }
                case 21: {
                    const offer = ui.replies.find((r) => r.id === 'PIRATE_PROTECTIONPROPOSE')!;
                    expect(offer.res.followUps.length).toBeGreaterThan(0);
                    submit(s, pirate, offer.res.followUps[0].id);
                    break;
                }
                case 24:
                    submit(s, peaceful, 'WAR_DECLARE');
                    break;
                case 27:
                    issuePlayerCommand(s.galaxy, s.player, 'setEmpireControl', ['controlDiplomacyTreaties', 0]);
                    break;
            }
        });
        const ra = uis.get(a)!;
        const rw = uis.get(w)!;
        expect(rw.replies.map((r) => [r.id, r.res.ok, r.res.accepted, r.res.reply])).toEqual(ra.replies.map((r) => [r.id, r.res.ok, r.res.accepted, r.res.reply]));
        expect(rw.tradeResults.map((r) => [r.ok, r.accepted, r.reply])).toEqual(ra.tradeResults.map((r) => [r.ok, r.accepted, r.reply]));
        expect(ra.replies.length).toBeGreaterThanOrEqual(8);
        expect(ra.tradeResults.length).toBe(2);
        // The negotiation the worker sent stays a UI object: edits went by value, the replica copy was not touched.
        expect(rw.trade).not.toBeNull();
        expect(w.client.replica.decoder.idOf(rw.trade!)).toBe(-1);
        expectSameGame(a, w);
        // The UI's part of the flow wrote nothing on the replica (chunk 0's write detector).
        expect(w.replicaWrites()).toEqual([]);
        w.dispose();
    }, 600000);

    it('agent missions (assign + false flag in one action, cancel), transfers and dismissal', () => {
        const mk = (): Game => {
            const { game } = createScenarioGame(base, { scenario: 'espionage-consequences' });
            const g = game.galaxy;
            meetAll(g);
            // Two fresh agents at the capital (as intelligence.test.ts), the same in both games.
            for (const name of ['Agent A', 'Agent B']) new Character(name, CharacterRole.IntelligenceAgent, '', game.playerEmpire.dominantRace, null, null, 0).activate(g, game.playerEmpire, game.playerEmpire.capital);
            // An admiral waiting at the capital, to transfer to a fleet (character locations not automated).
            game.playerEmpire.controlCharacterLocations = false;
            new Character('Admiral A', CharacterRole.FleetAdmiral, '', game.playerEmpire.dominantRace, null, null, 0).activate(g, game.playerEmpire, game.playerEmpire.capital);
            // A fleet to transfer the admiral to, kept (the Fleet Formation automation would disband an idle fleet it counts
            // as surplus: Empire.9.cs MaintainShipGroups): the player's idle warships into a new fleet when it has none.
            game.playerEmpire.controlMilitaryFleets = false;
            if (empireShipGroups(game.playerEmpire).length === 0) {
                const ships = game.playerEmpire.builtObjects.filter((b) => b != null && b.role === BuiltObjectRole.Military && b.shipGroup === null).slice(0, 2);
                expect(setShipsFleet(g, game.playerEmpire, ships, 'new'), 'the player forms a fleet').not.toBeNull();
            }
            return game;
        };
        const ga = mk();
        const gw = mk();
        const { gameData } = createScenarioGame(base, { scenario: 'espionage-consequences' });
        const a = inThread(ga);
        const w = inWorker(gw, gameData);
        const realPlayer = new Map<Side, Empire>([
            [a, ga.playerEmpire],
            [w, gw.playerEmpire],
        ]);
        const agentsOf = (e: Empire): Character[] => getEmpireCharacters(e).filter((c) => c.role === CharacterRole.IntelligenceAgent);
        expect(agentsOf(a.player).length).toBeGreaterThanOrEqual(2);
        const target = normalAis(a.galaxy).find((e) => obtainDiplomaticRelation(a.player, e).type === DiplomaticRelationType.None)!;
        const framed = normalAis(a.galaxy).find((e) => e !== target)!;
        drive([a, w], 30, (s, i) => {
            const agent = agentsOf(s.player).find((c) => c.name === 'Agent A')!;
            switch (i) {
                case 2: {
                    // CharacterMission.cs btnAssignMission_Click with a Blame pick (intelligence.ts assign()): two commands
                    // naming the one mission object the form built.
                    const t = empireOn(s, target);
                    const f = { ...withMissionType(s.galaxy, s.player, { ...initialMissionForm(s.galaxy, s.player), targetEmpire: t }, IntelligenceMissionType.InciteRevolution), timeIndex: 1 };
                    const state = buildMissionState(s.galaxy, s.player, agent, f)!;
                    expect(state).not.toBeNull();
                    expect(blameOptions(s.galaxy, s.player, state.type, t).some((b) => b.empireId === framed.empireId)).toBe(true);
                    issuePlayerCommand(s.galaxy, s.player, 'setAgentMission', [agent, state]);
                    issuePlayerCommand(s.galaxy, s.player, 'setAgentMissionFrame', [state, empireOn(s, framed)], (ok) => expect(ok).toBe(true));
                    break;
                }
                case 6: {
                    // The frame is on the agent's own mission: the worker decoded `state` once for both commands.
                    const real = agentsOf(realPlayer.get(s)!).find((c) => c.name === 'Agent A')!;
                    const m = characterMission(real);
                    expect(m).not.toBeNull();
                    expect(missionFrame(s.real, m!)?.empireId).toBe(framed.empireId);
                    expect(missionFrameLabel(s.galaxy, characterMission(agent))).toBe(`(false flag: ${framed.name})`);
                    break;
                }
                case 10:
                    issuePlayerCommand(s.galaxy, s.player, 'cancelAgentMission', [agent]);
                    break;
                case 14: {
                    // CharacterSummary.cs btnTransfer_Click: the admiral to the first fleet.
                    const c = getEmpireCharacters(s.player).find((x) => x.name === 'Admiral A')!;
                    const opt = (transferOptions(s.galaxy, c) ?? []).find((o) => resolveTransferDestination(c, o) !== null && resolveTransferDestination(c, o) !== c.location);
                    expect(opt).toBeDefined();
                    issuePlayerCommand(s.galaxy, s.player, 'transferCharacter', [c, resolveTransferDestination(c, opt!)], (ok) => expect(ok).toBe(true));
                    break;
                }
                case 18:
                    issuePlayerCommand(s.galaxy, s.player, 'dismissCharacter', [agentsOf(s.player).find((c) => c.name === 'Agent B')!]);
                    break;
            }
        });
        expect(commandLog(a.real).filter((e) => e.source === 'player').length).toBeGreaterThanOrEqual(5);
        expect(agentsOf(w.player).some((c) => c.name === 'Agent B')).toBe(false);
        expectSameGame(a, w);
        // The UI's part of the flow wrote nothing on the replica (chunk 0's write detector).
        expect(w.replicaWrites()).toEqual([]);
        w.dispose();
    }, 600000);

    it('politics, court and security: the Characters screen buttons, read on the replica, through commands', () => {
        const flags: Record<string, boolean> = { courtDynasties: true, internalPolitics: true, internalSecurity: true, courtIntrigue: false, livingCharacters: false, cult: false };
        const mk = (): { game: Game; gameData: GameData } => {
            const r = createScenarioGame(base, { scenario: 'court-dynasties', flags, params: { cultSeedYear: 200 } });
            const g = r.game.galaxy;
            const e = r.game.playerEmpire;
            e.stateMoney = 1e7;
            const [c1] = getEmpireCharacters(e).filter((x) => x.active && x.role !== CharacterRole.Leader);
            politicsEntry(g, c1).loyalty = 20;
            return r;
        };
        const ga = mk().game;
        const { game: gw, gameData } = mk();
        const a = inThread(ga);
        const w = inWorker(gw, gameData);
        const results = new Map<Side, unknown[]>([
            [a, []],
            [w, []],
        ]);
        const courtiers = (s: Side): Character[] => getEmpireCharacters(s.player).filter((x) => x.active && x.role !== CharacterRole.Leader);
        drive([a, w], 16, (s, i) => {
            const out = results.get(s)!;
            const push = (r: unknown): void => void out.push(JSON.parse(JSON.stringify(r, (k, v) => (typeof v === 'object' && v !== null && k !== '' && !Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype ? '#obj' : v))));
            if (i === 1) {
                const c1 = courtiers(s)[0];
                const d = politicsDetail(s.galaxy, s.player, c1)!;
                expect(d).not.toBeNull();
                const honour = d.buttons.find((b) => b.action === 'honour')!;
                expect(honour.enabled).toBe(true);
                issuePlayerCommand(s.galaxy, s.player, 'politicsAction', [honour.action, c1], push);
            }
            if (i === 4) {
                const agent = getEmpireCharacters(s.player).find((x) => x.active && x.role === CharacterRole.IntelligenceAgent);
                const d = agent !== undefined ? courtDetail(s.galaxy, s.player, agent) : null;
                const seat = d?.buttons.find((b) => b.enabled) ?? null;
                if (agent !== undefined && seat !== null) issuePlayerCommand(s.galaxy, s.player, 'courtAppoint', [seat.seat, agent], push);
            }
            if (i === 7) {
                const c2 = courtiers(s)[1];
                const purge = politicsDetail(s.galaxy, s.player, c2)?.buttons.find((b) => b.action === 'purge');
                if (purge !== undefined && purge.enabled) issuePlayerCommand(s.galaxy, s.player, 'politicsAction', ['purge', c2], push);
            }
            if (i === 9) {
                const leads = leadRows(s.galaxy, s.player);
                const agent = investigatorOptions(s.galaxy, s.player)[0];
                const lead = leads.find((l) => l.canInvestigate);
                if (lead !== undefined && agent !== undefined) issuePlayerCommand(s.galaxy, s.player, 'securityInvestigate', [lead.lead.id, agent], push);
            }
        });
        expect(results.get(w)).toEqual(results.get(a));
        expect(results.get(a)!.length).toBeGreaterThanOrEqual(2);
        expectSameGame(a, w);
        // The UI's part of the flow wrote nothing on the replica (chunk 0's write detector).
        expect(w.replicaWrites()).toEqual([]);
        w.dispose();
    }, 600000);

    it('peace terms (war goals): the counter-offer the screen builds on the replica, sent by value', () => {
        const flags = { ambitionPressure: false, borderFriction: false, smallerInvasions: false, warGoals: true };
        const mk = (): Game => {
            const { game } = createScenarioGame(base, { scenario: 'lively-galaxy', flags });
            const g = game.galaxy;
            const enemy = normalAis(g)[0];
            setRelation(g.playerEmpire!, enemy, DiplomaticRelationType.None);
            declareWar(g, enemy, g.playerEmpire!);
            return game;
        };
        const ga = mk();
        const gw = mk();
        const { gameData } = createScenarioGame(base, { scenario: 'lively-galaxy', flags });
        const a = inThread(ga);
        const w = inWorker(gw, gameData);
        const enemy = normalAis(a.galaxy)[0];
        const replies = new Map<Side, PeaceTermsResult[]>([
            [a, []],
            [w, []],
        ]);
        drive([a, w], 12, (s, i) => {
            const e = empireOn(s, enemy);
            if (i === 1) expect(warView(s.galaxy, s.player, e)).not.toBeNull();
            if (i === 2) {
                // warTermsPanel.ts "Suggest" + "Offer terms": the terms are built on the main thread (the replica).
                termsChoices(s.galaxy, s.player, e);
                issuePlayerCommand(s.galaxy, s.player, 'proposePeaceTerms', [e, buildTerms(s.galaxy, s.player, e)], (r) => replies.get(s)!.push(r));
            }
            if (i === 5) {
                const c = termsChoices(s.galaxy, s.player, e);
                const terms = { cede: c.theirColonies.slice(0, 1).map((colony) => ({ colony, from: e, to: s.player })), reparations: null, demilitarise: null, release: null };
                issuePlayerCommand(s.galaxy, s.player, 'proposePeaceTerms', [e, terms], (r) => replies.get(s)!.push(r));
            }
        });
        expect(replies.get(w)!.map((r) => [r.ok, r.accepted, r.message])).toEqual(replies.get(a)!.map((r) => [r.ok, r.accepted, r.message]));
        expect(replies.get(a)!.length).toBe(2);
        expectSameGame(a, w);
        // The UI's part of the flow wrote nothing on the replica (chunk 0's write detector).
        expect(w.replicaWrites()).toEqual([]);
        w.dispose();
    }, 600000);
});
