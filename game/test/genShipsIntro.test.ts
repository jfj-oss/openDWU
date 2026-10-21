// Generation Ships: the target's owner is always introduced (contact popup, ultimatum card) before the faction goes to war
// with it, also when the target changes hands mid-arc (the new holder gets the contact and a fresh window).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { CreateGameOptions } from '../src/sim/game';
import { comboOverlayFs, createScenarioGame } from './helpers/scenarioGame';
import { EmpireMessageType, empireMessages } from '../src/sim/messages';
import { obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { takeOwnershipOfColonyFull } from '../src/sim/combat/ownership';
import { pendingScenarioDecisions } from '../src/sim/scenario/decisions';
import { genShipsKnownSites, genShipsPeriodic, genShipsSpawnNow, genShipsState } from '../src/sim/scenario/threats/generationShips';
import { KNOWLEDGE_CONFIRMED } from '../src/sim/scenario/threats/framework';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });
const PARAMS = { genShipsEarliestYear: 0, genShipsTechLevel: 1, genShipsEmpiresAtTech: 1, genShipsFlavour: 1, genShipsAiFightRatioPct: 100000, genShipsMinFirepower: 500 };

function game(extra: Record<string, number> = {}): Galaxy {
    const { game: g } = createScenarioGame(base, { scenario: comboOverlayFs(['threat-framework', 'generation-ships']), flags: { threatGenerationShips: true }, params: { ...PARAMS, ...extra }, options: age3 });
    return g.galaxy;
}
const forced = (e: Empire, type: EmpireMessageType) => empireMessages(e).filter((m) => m.messageType === type && m.scenarioPopup === 'force');

describe('generation ships: the target is introduced before the war', () => {
    it('a human owner gets a forced contact popup, a forced ultimatum card, and the faction is on the Intel list from arrival', () => {
        const g = game();
        const me = g.playerEmpire!;
        expect(genShipsSpawnNow(g, me)).toBe(true);
        const st = genShipsState(g);
        expect(st.owner).toBe(me);
        // Intel: every empire lists the arrived world ship; the owner has it confirmed.
        const other = g.empires.find((e): e is Empire => e !== null && e !== me && e !== g.independentEmpire && e.active && e !== st.faction && e.pirateEmpireBaseHabitat === null)!;
        expect(genShipsKnownSites(g, other).length).toBe(1);
        expect(genShipsKnownSites(g, me)[0].level).toBe(KNOWLEDGE_CONFIRMED);
        st.contactDate = 0;
        genShipsPeriodic(g);
        expect(st.phase).toBe('contact');
        expect(forced(me, EmpireMessageType.GeneralWarning).length).toBe(1);
        st.ultimatumDate = 0;
        genShipsPeriodic(g);
        expect(st.phase).toBe('ultimatum');
        expect(forced(me, EmpireMessageType.GeneralDecision).length).toBe(1);
        expect(obtainDiplomaticRelation(st.faction!, me).locked).toBe(false);
    }, 600000);

    it('the target changes hands before the ultimatum: the new holder gets contact and an ultimatum of its own', () => {
        const g = game();
        const me = g.playerEmpire!;
        const ai = g.empires.find((e): e is Empire => e !== null && e !== me && e !== g.independentEmpire && e.active && e.pirateEmpireBaseHabitat === null && e.colonies.length > 1)!;
        expect(genShipsSpawnNow(g, ai)).toBe(true);
        const st = genShipsState(g);
        st.contactDate = 0;
        genShipsPeriodic(g);
        expect(st.phase).toBe('contact');
        expect(forced(me, EmpireMessageType.GeneralWarning).length).toBe(0);
        takeOwnershipOfColonyFull(g, ai, st.target!, me, false, true);
        genShipsPeriodic(g);
        expect(st.owner).toBe(me);
        expect(st.phase).toBe('contact');
        expect(forced(me, EmpireMessageType.GeneralWarning).length).toBe(1);
        expect(knownLevel(g, me)).toBe(KNOWLEDGE_CONFIRMED);
        expect(obtainDiplomaticRelation(st.faction!, me).locked).toBe(false);
        st.ultimatumDate = 0;
        genShipsPeriodic(g);
        expect(st.phase).toBe('ultimatum');
        expect(pendingScenarioDecisions(g, me).length).toBe(1);
        expect(forced(me, EmpireMessageType.GeneralDecision).length).toBe(1);
        expect(obtainDiplomaticRelation(st.faction!, me).locked).toBe(false);
    }, 600000);

    it('the target changes hands during the war: no war with the new holder before its own contact and ultimatum', () => {
        const g = game({ genShipsAiFightRatioPct: 0 });
        const me = g.playerEmpire!;
        const ai = g.empires.find((e): e is Empire => e !== null && e !== me && e !== g.independentEmpire && e.active && e.pirateEmpireBaseHabitat === null && e.colonies.length > 1)!;
        expect(genShipsSpawnNow(g, ai)).toBe(true);
        const st = genShipsState(g);
        st.contactDate = 0;
        genShipsPeriodic(g);
        st.ultimatumDate = 0;
        genShipsPeriodic(g); // the AI refuses (fight ratio 100000%): war with it
        expect(st.phase).toBe('war');
        expect(obtainDiplomaticRelation(st.faction!, ai).locked).toBe(true);
        takeOwnershipOfColonyFull(g, ai, st.target!, me, false, true);
        genShipsPeriodic(g);
        expect(st.owner).toBe(me);
        expect(st.phase).toBe('contact');
        expect(forced(me, EmpireMessageType.GeneralWarning).length).toBe(1);
        expect(obtainDiplomaticRelation(st.faction!, me).locked).toBe(false);
        st.ultimatumDate = 0;
        genShipsPeriodic(g);
        expect(pendingScenarioDecisions(g, me).length).toBe(1);
    }, 600000);
});

function knownLevel(g: Galaxy, e: Empire): number {
    return genShipsState(g).knowledge.find((k) => k.empireId === e.empireId)?.level ?? 0;
}
