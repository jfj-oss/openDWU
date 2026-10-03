// Parity batch D3: the diplomacy player commands (restricted-resource trading, alliance names), pirate "Buy information",
// the WAR_END answer to an AI's SubjugateRequest, the talk panel's reply after a choice, the Empire Policy file format
// (load / save) and its design picker, character rename / description, and the colony attitude bonus lines.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Empire } from '../src/sim/empire';
import type { Galaxy } from '../src/sim/galaxy';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { runPlayerCommand } from '../src/sim/player/playerCommands';
import { commandLog } from '../src/sim/player/commandLog';
import { listProposals, submitProposal } from '../src/sim/player/diplomacyProposals';
import { answerConversationReply, infoReplyArgs } from '../src/sim/player/conversationReplies';
import { PirateRelationType, obtainPirateRelation } from '../src/sim/pirateRelations';
import { generateSaleableInfoForEmpire } from '../src/sim/pirates/pirateRelationsAI';
import { EmpireMessage, EmpireMessageType } from '../src/sim/messages';
import { conversationActions, conversationReplyView, type ConversationAction } from '../src/ui/conversationActions';
import { isWarEndConversation, pruneConversationQueue, type ConversationEntry } from '../src/ui/messagePipeline';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { DiplomaticRelation } from '../src/sim/diplomacy';
import { defaultEmpirePolicy, loadEmpirePolicyFile, parseEmpirePolicy, writeEmpirePolicyFile } from '../src/sim/data/policies';
import { policyFileEntries, policyFileName, readSavedPolicyFile, savedPolicyFiles, writeSavedPolicyFile } from '../src/ui/policyFiles';
import { applyPolicyPanel, buildPolicyPanel, panelControls, type DesignControl } from '../src/ui/screens/empirePolicyModel';
import { planetaryFacilityDefinitionsStatic } from '../src/sim/construction/facilities';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { resolveCharacterDescription } from '../src/ui/screens/intelligence';
import { habitatRacialBonuses, habitatResourceBonuses, resolveWonderDescriptionShort } from '../src/ui/screens/coloniesScreen';
import { WonderType } from '../src/sim/researchSystem';
import { HabitatType } from '../src/sim/types';
import type { Character } from '../src/sim/characters';
import { CharacterRole } from '../src/sim/characters';
import type { Design } from '../src/sim/design';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function otherEmpire(g: Galaxy, player: Empire): Empire {
    return g.empires.find((e) => e !== player && e.active && e.pirateEmpireBaseHabitat === null && e !== g.independentEmpire)!;
}

describe('diplomacy player commands (journaled)', () => {
    it('TradeRestrictedResourcesPanel checkbox: SupplyRestrictedResources towards the other empire', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const player = game.playerEmpire;
        const other = otherEmpire(g, player);
        expect(runPlayerCommand(g, player, 'setSupplyRestrictedResources', [other, true])).toBe(true);
        expect(player.diplomaticRelations.byEmpire(other)!.supplyRestrictedResources).toBe(true);
        expect(runPlayerCommand(g, player, 'setSupplyRestrictedResources', [other, false])).toBe(true);
        expect(player.diplomaticRelations.byEmpire(other)!.supplyRestrictedResources).toBe(false);
        expect(runPlayerCommand(g, player, 'setSupplyRestrictedResources', [player, true])).toBe(false);
        const ops = commandLog(g).map((e) => (e as { op?: string }).op);
        expect(ops.filter((o) => o === 'setSupplyRestrictedResources').length).toBe(3);
    }, 300000);

    it('pnlRelationAllianceName Apply (method_683): the name on both relations', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const player = game.playerEmpire;
        const other = otherEmpire(g, player);
        expect(runPlayerCommand(g, player, 'setAllianceName', [other, 'Grand Concord'])).toBe(true);
        expect(player.diplomaticRelations.byEmpire(other)!.allianceName).toBe('Grand Concord');
        expect(other.diplomaticRelations.byEmpire(player)!.allianceName).toBe('Grand Concord');
        expect(commandLog(g).some((e) => (e as { op?: string }).op === 'setAllianceName')).toBe(true);
    }, 300000);

    it('CharacterSummary txtName_Leave: renameCharacter stores the text', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const player = game.playerEmpire;
        const c = (player.characters as (Character | null)[]).find((x) => x != null)!;
        expect(runPlayerCommand(g, player, 'renameCharacter', [c, 'Ada Vey'])).toBe(true);
        expect(c.name).toBe('Ada Vey');
    }, 300000);
});

describe('pirate "Buy information" (Main.Part9.cs:101 / 215)', () => {
    it('is on the greeting menu; its reply lists GenerateSaleableInfoForEmpire at the C# prices; buying pays and reveals', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const player = game.playerEmpire;
        const pirate = g.pirateEmpires.find((p) => !p.pirateEmpireSuperPirates)!;
        obtainPirateRelation(player, pirate).type = PirateRelationType.None;
        obtainPirateRelation(pirate, player).type = PirateRelationType.None;
        const ids = listProposals(g, player, pirate).map((o) => o.id);
        expect(ids).toEqual(['PIRATE_PROTECTIONPROPOSE', 'PIRATE_BUYINFO']);
        const r = submitProposal(g, player, pirate, 'PIRATE_BUYINFO');
        expect(r.ok).toBe(true);
        expect(r.reply).toBe('PIRATE_BUYINFO');
        const info = generateSaleableInfoForEmpire(g, pirate, player);
        const expected: string[] = [];
        if (info.unmetEmpires.length > 0) expected.push('INFO_UNMETEMPIRE');
        if (info.unexploredSystems.length > 0) expected.push('INFO_EXPLORATION');
        if (info.independentColonies.length > 0) expected.push('INFO_INDEPENDENTCOLONY');
        if (info.ruinHabitats.length > 0) expected.push('INFO_RUINS');
        else if (info.restrictedAreaLocations.length > 0) expected.push('INFO_RESTRICTEDAREA');
        else if (info.debrisFieldLocations.length > 0) expected.push('INFO_DEBRISFIELD');
        else if (info.planetDestroyerLocations.length > 0) expected.push('INFO_PLANETDESTROYER');
        expect(r.followUps.map((o) => o.id)).toEqual(expected);
        for (const o of r.followUps) {
            if (o.id === 'INFO_EXPLORATION') expect(o.cost).toBe(2000);
            if (o.id === 'INFO_INDEPENDENTCOLONY') expect(o.cost).toBe(20000);
            if (o.id === 'INFO_UNMETEMPIRE') expect(o.cost).toBeLessThanOrEqual(10000);
        }
        const offer = r.followUps[0];
        if (offer === undefined) return;
        // No money: INFO_NOFUNDS, nothing changes.
        player.stateMoney = 0;
        const poor = submitProposal(g, player, pirate, offer.id);
        expect(poor.ok).toBe(true);
        expect(poor.accepted).toBe(false);
        expect(poor.reply).toBe('INFO_NOFUNDS');
        player.stateMoney = offer.cost + 5000;
        const pirateMoney = pirate.stateMoney;
        const bought = submitProposal(g, player, pirate, offer.id);
        expect(bought.accepted).toBe(true);
        expect(bought.reply).toBe(offer.id);
        expect(player.stateMoney).toBe(5000);
        expect(pirate.stateMoney).toBe(pirateMoney + offer.cost);
        expect(bought.replyArgs.length).toBeGreaterThan(0);
    }, 300000);

    it('method_230 INFO_* arguments', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const cap = game.playerEmpire.capital!;
        const args = infoReplyArgs(g, 'INFO_EXPLORATION', cap);
        expect(args[0]).toBe(cap.name);
        expect(args[1]).toMatch(/^[A-Z]\d+$/);
        expect(infoReplyArgs(g, 'INFO_INDEPENDENTCOLONY', cap)[0]).toContain(cap.name);
    }, 300000);
});

describe("an AI's SubjugateRequest reaches the player as WAR_END (Empire.8.cs 1527, Main.Part9.cs:1723)", () => {
    function atWar(g: Galaxy, player: Empire, other: Empire): void {
        obtainDiplomaticRelation(player, other).type = DiplomaticRelationType.War;
        obtainDiplomaticRelation(other, player).type = DiplomaticRelationType.War;
    }
    it('stays queued and offers the WAR_END answers; WAR_END_ACCEPT ends the war (Main.Part10.cs:4798)', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const player = game.playerEmpire;
        const other = otherEmpire(g, player);
        atWar(g, player, other);
        // SubjugateRequest: the proposed SubjugatedDominion relation, the message naming None.
        player.proposedDiplomaticRelations.add(new DiplomaticRelation(DiplomaticRelationType.SubjugatedDominion, other, other, player, galaxyStarDate(g), false));
        const m = new EmpireMessage(other, EmpireMessageType.ProposeDiplomaticRelation, DiplomaticRelationType.None);
        m.description = 'Surrender';
        const entry: ConversationEntry = { message: m, conversation: 'WAR_END', sender: other };
        expect(isWarEndConversation(entry, player)).toBe(true);
        const queue = [entry];
        pruneConversationQueue(queue, player, galaxyStarDate(g));
        expect(queue).toEqual([entry]);
        const actions = conversationActions(entry, { player, galaxy: g, answerable: false, pirateOffer: false });
        expect(actions.map((a) => a.id)).toEqual(['WAR_END_ACCEPT', 'WAR_END_SUBJUGATIONDEMAND', 'WAR_END_REJECT']);
        const r = runPlayerCommand(g, player, 'answerConversation', [other, 'WAR_END_ACCEPT', null, 0]);
        expect(r.ok).toBe(true);
        expect(r.reply).toBe('WAR_END_ACCEPT_RESPONSE');
        expect(r.expireFor).toBe(other);
        expect(player.diplomaticRelations.byEmpire(other)!.type).toBe(DiplomaticRelationType.None);
        expect(other.diplomaticRelations.byEmpire(player)!.type).toBe(DiplomaticRelationType.None);
        // Peace now: the conversation goes, and a second accept does nothing.
        pruneConversationQueue(queue, player, galaxyStarDate(g));
        expect(queue).toEqual([]);
        expect(answerConversationReply(g, player, other, 'WAR_END_ACCEPT', null, 0).ok).toBe(false);
    }, 300000);
});

describe('the reply after a choice (Main.Part9.cs:731 method_241, method_237 reply parts)', () => {
    const player = { diplomaticRelations: { byEmpire: () => null } } as unknown as Empire;
    const entry = { message: new EmpireMessage(null, EmpireMessageType.Undefined, null), sender: null };
    const a = (id: string, effect: ConversationAction['effect']): ConversationAction => ({ id, label: id, effect });
    it('treaty answers', () => {
        expect(conversationReplyView(a('FREETRADE_ACCEPT', { kind: 'acceptProposal' }), entry, player, true)).toEqual({ kind: 'reply', part: 'TREATY_ACCEPTRESPONSE', args: [] });
        expect(conversationReplyView(a('SUBJUGATIONDEMAND_ACCEPT', { kind: 'acceptProposal' }), entry, player, true)).toEqual({ kind: 'reply', part: 'SUBJUGATIONDEMAND_ACCEPT_RESPONSE', args: [] });
        expect(conversationReplyView(a('WAR_END_ACCEPT', { kind: 'acceptProposal' }), entry, player, true)).toEqual({ kind: 'reply', part: 'WAR_END_ACCEPT_RESPONSE', args: [] });
        expect(conversationReplyView(a('FREETRADE_ACCEPT', { kind: 'acceptProposal' }), entry, player, false).kind).toBe('failed');
        expect(conversationReplyView(a('MUTUALDEFENSE_REJECT', { kind: 'declineProposal' }), entry, player, true)).toEqual({ kind: 'reply', part: 'TREATY_REJECTRESPONSE', args: [] });
        expect(conversationReplyView(a('WAR_END_REJECT', { kind: 'declineProposal' }), entry, player, true)).toEqual({ kind: 'close' });
    });
    it('executor replies, text-only answers and closes', () => {
        const reply = { kind: 'reply', part: 'INFO_EXPLORATION', related: null, cost: 0 } as const;
        expect(conversationReplyView(a('INFO_EXPLORATION', reply), entry, player, { ok: true, noFunds: false, expireFor: null, history: null, reply: 'INFO_EXPLORATION', replyArgs: ['Sol', 'B3'] })).toEqual({
            kind: 'reply',
            part: 'INFO_EXPLORATION',
            args: ['Sol', 'B3'],
        });
        const deal = { kind: 'reply', part: 'DEAL_REJECT', related: null, cost: 0 } as const;
        expect(conversationReplyView(a('DEAL_REJECTCOMPLAIN', deal), entry, player, { ok: true, noFunds: false, expireFor: null, history: null, reply: 'DEAL_REJECT_RESPONSE', replyArgs: [] })).toEqual({
            kind: 'reply',
            part: 'DEAL_REJECTDEMAND_RESPONSE',
            args: [],
        });
        expect(conversationReplyView(a('WAR_DECLARE_REQUESTJOINT_REJECT', { kind: 'close' }), entry, player)).toEqual({ kind: 'reply', part: 'TREATY_REJECTRESPONSE', args: [] });
        expect(conversationReplyView(a('Exit', { kind: 'close' }), entry, player)).toEqual({ kind: 'close' });
        expect(conversationReplyView(a('PIRATE_TRUCEACCEPTRESPONSE', { kind: 'acceptPirate' }), entry, player, { accepted: false, cost: 0 })).toEqual({ kind: 'reply', part: 'PIRATE_PROTECTIONALREADYPAID', args: [] });
    });
});

describe('Empire Policy files (EmpirePolicy.cs SaveToFile / LoadFromFile)', () => {
    const policyDir = resolve(__dirname, '../public/assets/dwu/Policy');
    it('writes the installed files back with the same values (the files are an older, shorter SaveToFile)', () => {
        const lines = (t: string): Map<string, string> => {
            const m = new Map<string, string>();
            for (const l of t.replace(/\r\n/g, '\n').split('\n')) {
                const i = l.indexOf(';');
                if (i > 0 && !l.startsWith("'")) m.set(l.substring(0, i).trim(), l.substring(i + 1).trim());
            }
            return m;
        };
        for (const name of ['Human.txt', 'Zenox.txt', 'MyPolicy.txt']) {
            const text = readFileSync(resolve(policyDir, name), 'utf8');
            const written = writeEmpirePolicyFile(parseEmpirePolicy(text));
            expect(written.startsWith("'Distant Worlds - Empire Policy - 1.9.0.0\r\n\r\n")).toBe(true);
            const ours = lines(written);
            let compared = 0;
            for (const [k, v] of lines(text)) {
                if (!ours.has(k)) continue; // an older setting the 1.9.5 writer no longer writes
                expect(`${k}=${ours.get(k)}`).toBe(`${k}=${v}`);
                compared++;
            }
            expect(compared).toBeGreaterThan(80);
            expect(ours.size).toBe(163);
        }
    });
    it('round-trips a changed policy; a load keeps the settings the file does not name (the design)', () => {
        const p = defaultEmpirePolicy();
        p.constructionMilitaryCruiser = Math.fround(17.5);
        p.warWillingness = 1.5;
        p.colonyTaxRateIncreaseWhenAtWar = true;
        p.researchDesignTechFocus1 = 1 as never;
        const back = parseEmpirePolicy(writeEmpirePolicyFile(p));
        expect(back.constructionMilitaryCruiser).toBe(Math.fround(17.5));
        expect(back.warWillingness).toBe(1.5);
        expect(back.colonyTaxRateIncreaseWhenAtWar).toBe(true);
        const design = { name: 'Outpost' };
        const current = { ...defaultEmpirePolicy(), colonyActionForNewBuildDesign: design };
        const loaded = loadEmpirePolicyFile(current, 'WarWillingness\t\t;0.5\r\n');
        expect(loaded.warWillingness).toBe(0.5);
        expect(loaded.colonyActionForNewBuildDesign).toBe(design);
        expect(current.warWillingness).toBe(1);
    });
    it('browser storage saves (guarded) and the Load list', () => {
        const mem = new Map<string, string>();
        const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
        expect(policyFileName('  War Plan ')).toBe('War Plan.txt');
        expect(policyFileName('a/b.TXT')).toBe('a_b.TXT');
        expect(writeSavedPolicyFile('War Plan.txt', 'X\t\t;Y', storage)).toBe(true);
        expect(savedPolicyFiles(storage)).toEqual(['War Plan.txt']);
        expect(readSavedPolicyFile('War Plan.txt', storage)).toBe('X\t\t;Y');
        expect(policyFileEntries({ Policy: ['Human.txt'], 'Policy/pirate': ['Human.txt'] }, storage)).toEqual([
            { name: 'War Plan.txt', source: 'saved' },
            { name: 'Human.txt', source: 'install' },
            { name: 'pirate/Human.txt', source: 'install' },
        ]);
        const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
        expect(savedPolicyFiles(broken)).toEqual([]);
        expect(writeSavedPolicyFile('a.txt', 'x', broken)).toBe(false);
        expect(savedPolicyFiles(null)).toEqual([]);
    });
    it('the ColonyActionForNewBuildDesign picker lists buildable Base designs (Main.Part3.cs:4710-4716) and reads back', () => {
        const game = cachedTickGame(gameData);
        const player = game.playerEmpire;
        const ctx = { facilities: planetaryFacilityDefinitionsStatic(game.galaxy) };
        const sections = buildPolicyPanel(player, player.policy ?? defaultEmpirePolicy(), ctx);
        const controls = panelControls(sections);
        const c = controls.get('ColonyActionForNewBuildDesign') as DesignControl;
        expect(c.kind).toBe('design');
        for (const d of c.designs as Design[]) {
            expect(d.role).toBe(BuiltObjectRole.Base);
            expect(d.isObsolete).toBe(false);
        }
        const row = sections.flatMap((s) => s.rows).find((r) => r.name === 'ColonyActionForNewBuildDesign')!;
        expect(row.readOnly).toBeUndefined();
        if (c.designs.length > 0) {
            c.design = c.designs[0];
            expect(applyPolicyPanel(player, false, controls, ctx).colonyActionForNewBuildDesign).toBe(c.designs[0]);
        }
    }, 300000);
});

describe('characters and colonies text', () => {
    it('Galaxy.2.cs ResolveCharacterDescription', () => {
        const game = cachedTickGame(gameData);
        const c = (game.playerEmpire.characters as (Character | null)[]).find((x) => x != null)!;
        const withName = resolveCharacterDescription(c);
        expect(withName.startsWith(`${c.name} (`)).toBe(true);
        const without = resolveCharacterDescription(c, false);
        expect(without.startsWith(c.name)).toBe(false);
        expect(without).toMatch(/^(\(.*\)\n\n)?SKILLS \(/);
        expect(resolveCharacterDescription(null)).toBe('');
    }, 300000);

    it('HabitatAttitudeSummary bonus lines: wonders, racial (the C# "-0%" doubling) and resources', () => {
        expect(resolveWonderDescriptionShort({ name: 'Grand Bazaar', wonderType: WonderType.ColonyIncome, value1: 0, value2: 25 })).toContain('+25%');
        const race = {
            name: 'Testers', warWearinessAttenuation: 20, satisfactionModifier: 10, colonyConstructionSpeedFactorOcean: 0.8, colonyPopulationPolicyGrowthFactorExterminate: 1,
            spaceportArmorStrengthFactor: 1.25, migrationFactor: 1, troopRegenerationFactor: 1, raceFamily: 0,
        };
        const h = {
            population: { dominantRace: race, items: [] }, empire: { characters: [], dominantRace: race }, raceEventType: 1, slaveryBonusFactor: 1,
            type: HabitatType.Ocean, colonyPopulationPolicy: 0, colonyPopulationPolicyRaceFamily: 0,
        } as never;
        const lines = habitatRacialBonuses(h);
        expect(lines.some((l) => l.includes('(-20%)'))).toBe(true);
        expect(lines.some((l) => l.includes('(+10%)'))).toBe(true);
        expect(lines.some((l) => l.includes('+25%'))).toBe(true);
        // `(0.8 - 1.0).ToString("-0%")`: the literal sign and the value's own minus.
        expect(lines.some((l) => l.includes('(--20%)'))).toBe(true);
        const game = cachedTickGame(gameData);
        const res = game.galaxy.resourceSystem.resources[0];
        const h2 = { resourceBonuses: [{ resourceId: res.resourceId, effect: 10, value: 15, appliesOnlyToSources: false }, { resourceId: res.resourceId, effect: 1, value: 5, appliesOnlyToSources: false }] } as never;
        const rb = habitatResourceBonuses(game.galaxy, h2);
        expect(rb.length).toBe(1);
        expect(rb[0]).toContain(res.name);
        void CharacterRole;
    }, 300000);
});
