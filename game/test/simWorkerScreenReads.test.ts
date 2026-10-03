// Sim worker, chunk 7 (docs/sim-worker.md §9): everything the diplomacy, empires, characters and politics screens still
// compute from the REPLICA in worker mode is write-free — the replica's save text (every object, the side tables, the
// RNG state) is unchanged after a full round of the screens' reads, in the stock game and in the scenarios whose screen
// blocks they show (politics, court, security, council, reputation, war goals, rim trader, charters). The reads that do
// write (listProposals, the pirate protection price) are read-only too; the records they obtain come from a journaled
// command (sim/readOnlyQuery.ts, test/uiSimWrites.test.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import { createScenarioGame } from './helpers/scenarioGame';
import { inWorker, meetAll } from './helpers/simWorkerSides';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import { galaxyToJSON } from '../src/sim/save/galaxySave';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { CharacterRole, getEmpireCharacters } from '../src/sim/characters';
import { characterMission } from '../src/sim/espionage';
import { buildTerms, describeTerms, termsChoices, warView } from '../src/sim/scenario/lively/peaceTerms';
import { diplomacyRows, isProposalValid, playerGovernmentName } from '../src/ui/screens/diplomacyScreen';
import { relationshipFactors } from '../src/sim/player/relationFactors';
import { empireIntel } from '../src/ui/screens/empireIntel';
import { ambassadorAt, empireRaces, relationLine } from '../src/ui/screens/diplomacyRelationsView';
import { determineResourcesEmpireSupplies } from '../src/sim/diplomacyTick';
import { councilView } from '../src/sim/scenario/emergent/councilView';
import { reputationRows } from '../src/sim/scenario/reputation/view';
import { incidentRows, blameOptions, missionFrameLabel } from '../src/sim/scenario/emergent/espionageView';
import { companyHeaderLine, companyTag } from '../src/ui/screens/charters';
import { peekDiplomaticRelation, rimTraderTermsRows, rimTraderTag } from '../src/ui/scenario/rimTraderRows';
import { rimTraderEmpire } from '../src/sim/scenario/rimTrade/common';
import { obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { empireRows } from '../src/ui/screens/empiresList';
import {
    MISSION_TYPE_ORDER,
    agentAssignmentSummary,
    buildMissionState,
    characterBackdropUrl,
    characterRoleCounts,
    characterRows,
    characterSkillLines,
    characterTraitsLine,
    initialMissionForm,
    missionDifficultyDescription,
    missionDifficultyWarning,
    missionTargetEmpires,
    missionTargetOptions,
    resolveCharacterSummary,
    resolveTransferDestination,
    transferOptions,
    withMissionType,
    withTargetEmpire,
} from '../src/ui/screens/intelligence';
import { characterPublicEvents, resolveCharacterEventDescription } from '../src/ui/screens/characterEventText';
import { politicsDetail, politicsRowCells } from '../src/ui/emergentPolitics';
import { courtDetail, courtSummaryRows } from '../src/ui/courtView';
import { investigatorOptions, leadRows } from '../src/ui/internalSecurityView';
import { leagueListRows } from '../src/ui/leagueRows';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

describe('sim worker chunk 7: the screens read the replica without writing it', () => {
    /** Everything the diplomacy, empires, characters and politics screens compute from the replica. */
    function screenReads(g: Galaxy): void {
        const player = g.playerEmpire!;
        const others = [...g.empires, ...g.pirateEmpires].filter((e) => e !== null && e !== player && e !== g.independentEmpire);
        const gov = playerGovernmentName(player);
        diplomacyRows(player, galaxyStarDate(g), gov);
        for (const o of others) {
            const p = player.proposedDiplomaticRelations.byEmpire(o);
            if (p !== null) isProposalValid(p, o, player, galaxyStarDate(g));
            relationshipFactors(player, o, gov);
            empireIntel(player, o);
            ambassadorAt(player, o);
            empireRaces(o);
            determineResourcesEmpireSupplies(o);
            reputationRows(g, player, o);
            incidentRows(g, player, o);
            if (warView(g, player, o) !== null) describeTerms(buildTerms(g, player, o));
            termsChoices(g, player, o);
            companyHeaderLine(g, o);
            companyTag(g, o);
            rimTraderTag(g, o);
            o.diplomaticRelations.getHighestAllianceName();
            for (const v of [player, ...others]) relationLine(v, o, player);
        }
        councilView(g, player);
        rimTraderTermsRows(g, player);
        empireRows(g.empires, player);
        leagueListRows(g);
        const agent = getEmpireCharacters(player).find((c) => c.role === CharacterRole.IntelligenceAgent) ?? null;
        for (const e of [player, ...others]) {
            characterRows(e, g);
            resolveCharacterSummary(e);
            characterRoleCounts(e);
            agentAssignmentSummary(e);
        }
        for (const c of getEmpireCharacters(player)) {
            characterSkillLines(c);
            characterTraitsLine(c);
            characterBackdropUrl(c);
            for (const ev of characterPublicEvents(c)) resolveCharacterEventDescription(ev, player);
            for (const o of transferOptions(g, c) ?? []) resolveTransferDestination(c, o);
            politicsRowCells(g, c);
            politicsDetail(g, player, c);
            courtDetail(g, player, c);
            missionFrameLabel(g, characterMission(c));
        }
        courtSummaryRows(g, player);
        leadRows(g, player);
        investigatorOptions(g, player);
        for (const t of missionTargetEmpires(g, player)) {
            let f = withTargetEmpire(g, player, initialMissionForm(g, player), t);
            for (const ty of MISSION_TYPE_ORDER) {
                f = withMissionType(g, player, f, ty);
                missionTargetOptions(g, player, t, ty);
                if (agent === null) continue;
                const m = buildMissionState(g, player, agent, { ...f, timeIndex: 0, target: f.targetOptions[0] ?? null });
                missionDifficultyDescription(m, agent);
                missionDifficultyWarning(m, agent);
                blameOptions(g, player, ty, t);
            }
        }
    }

    for (const scenario of [null, 'emergent', 'court-dynasties', 'internal-security', 'galactic-council', 'reputation', 'lively-galaxy', 'rimTrade', 'chartered-companies'] as const) {
        it(`${scenario ?? 'stock game'}: replica save text and RNG unchanged`, () => {
            const { game, gameData } = scenario === null ? { game: cachedTickGame(base), gameData: base } : createScenarioGame(base, { scenario });
            meetAll(game.galaxy);
            const w = inWorker(game, gameData);
            for (let i = 0; i < 30; i++) w.tick();
            w.settle();
            const before = JSON.stringify(galaxyToJSON(w.galaxy));
            screenReads(w.galaxy);
            expect(JSON.stringify(galaxyToJSON(w.galaxy)) === before).toBe(true);
            // And chunk 0's write detector agrees (it also sees fields the save does not carry).
            expect(w.replicaWrites()).toEqual([]);
            w.dispose();
        }, 600000);
    }

    it('the Concord terms read its relation without adding one (peekDiplomaticRelation = obtainDiplomaticRelation minus the write)', () => {
        const { game } = createScenarioGame(base, { scenario: 'rimTrade' });
        const g = game.galaxy;
        const player = g.playerEmpire!;
        const r = rimTraderEmpire(g)!;
        expect(r).not.toBeNull();
        const rel = r.diplomaticRelations.byEmpire(player);
        if (rel !== null) r.diplomaticRelations.remove(rel);
        const rows = rimTraderTermsRows(g, player)!;
        expect(r.diplomaticRelations.byEmpire(player)).toBeNull();
        expect([rows.met, rows.open]).toEqual([false, false]);
        // The same answers as obtain, for every pair (obtain last: it adds the missing records).
        const all = [...g.empires, ...g.pirateEmpires].filter((e) => e !== null);
        for (const a of all) {
            for (const b of [...all, null]) {
                const peek = peekDiplomaticRelation(a, b);
                const got = obtainDiplomaticRelation(a, b);
                expect({ type: peek.type, supply: peek.supplyRestrictedResources }).toEqual({ type: got.type, supply: got.supplyRestrictedResources });
            }
        }
    }, 600000);
});
