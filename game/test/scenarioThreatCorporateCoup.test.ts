// 19f #10 Corporate Coup (tasks/19f-hidden-threats.md §10): flag off, a subject company stubbed via
// createEmpireMidGame + registerSubjectCompany (19c is not on this branch — see corporateCoup.ts's doc comment),
// forced bribery, trigger (bought governors' colonies rise from inside), discovery, and ends. Short, direct-call
// tests.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game, CreateGameOptions } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import { runGameSeconds } from '../src/sim/tick/harness';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { setGameEndHandler, type GameEndEventArgs } from '../src/sim/victory';
import { createEmpireMidGame } from '../src/sim/scenario/empireMidGame';
import { CharacterRole, generateNewCharacter } from '../src/sim/characters';
import { builtObjectCompleteTeardown } from '../src/sim/combat/teardown';
import { takeOwnershipOfColonyFull } from '../src/sim/combat/ownership';
import { TroopList } from '../src/sim/cargo';
import { makeRobotTroop } from '../src/sim/scenario/threats/framework';
import {
    CORPORATE_COUP_CODE_CONTAINED,
    CORPORATE_COUP_CODE_DEFEAT,
    coupBribeYearly,
    coupTrigger,
    corporateCoupPeriodic,
    corporateCoupState,
    peekCorporateCoupState,
    registerSubjectCompany,
} from '../src/sim/scenario/threats/corporateCoup';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });

function ccGame(flags: Record<string, boolean> = {}): { game: Game; g: Galaxy } {
    const { game } = createScenarioGame(base, {
        scenario: 'corporatecoup',
        flags: { threatCorporateCoup: true, ...flags },
        params: { coupBribePct: 1000, coupGovernors: 1, coupMinYears: 0, corporateCoupExistChancePct: 100, corporateCoupMinYear: 0 },
        options: age3,
    });
    return { game, g: game.galaxy };
}

/** Stubs "a subject company empire" (19c is not on this branch) via createEmpireMidGame, adoptOnly, then registers
 * it through corporateCoup.ts's clearly-named hook. */
function stubCompany(g: Galaxy, holder: import('../src/sim/empire').Empire) {
    const company = createEmpireMidGame(g, { race: holder.dominantRace!.name, name: 'Rim Traders Inc', adoptOnly: true, relationBias: -50 })!;
    registerSubjectCompany(g, company, holder);
    return company;
}

describe('Corporate Coup: flag off', () => {
    it('no state with the flag off', () => {
        const { game, g } = ccGame({ threatCorporateCoup: false });
        runGameSeconds(game, 65);
        expect(peekCorporateCoupState(g)).toBeNull();
    }, 300000);
});

describe('Corporate Coup: stubbed subject company, bribery, trigger, ends', () => {
    it('registerSubjectCompany: the clearly-named hook registers a company against its holder', () => {
        const { game, g } = ccGame();
        const holder = g.empires.find((e) => e !== g.playerEmpire && e.pirateEmpireBaseHabitat === null)!;
        const company = stubCompany(g, holder);
        const st = corporateCoupState(g);
        expect(st.companies).toHaveLength(1);
        expect(st.companies[0].empire).toBe(company);
        expect(st.companies[0].holder).toBe(holder);
    }, 300000);

    it('bribery: a governor at the holder is bought (forced 100% chance)', () => {
        const { game, g } = ccGame();
        const holder = g.empires.find((e) => e !== g.playerEmpire && e.pirateEmpireBaseHabitat === null && e.colonies.length > 0)!;
        stubCompany(g, holder);
        const colony = holder.colonies[0];
        generateNewCharacter(g, holder, CharacterRole.ColonyGovernor, colony);
        const st = corporateCoupState(g);
        coupBribeYearly(g);
        expect(st.companies[0].bought.length).toBeGreaterThan(0);
    }, 300000);

    it('trigger: bought governors\' colonies rise from inside once charter age and count are met', () => {
        const { game, g } = ccGame();
        const holder = g.empires.find((e) => e !== g.playerEmpire && e.pirateEmpireBaseHabitat === null && e.colonies.length > 0)!;
        const company = stubCompany(g, holder);
        const colony = holder.colonies[0];
        const { character: gov } = generateNewCharacter(g, holder, CharacterRole.ColonyGovernor, colony);
        if (colony.troops === null) colony.troops = new TroopList();
        const t = makeRobotTroop(g, holder, 60, 'Garrison');
        t.colony = colony;
        colony.troops.add(t);
        holder.troops.add(t);
        const st = corporateCoupState(g);
        st.companies[0].bought.push(gov);
        expect(coupTrigger(g, st.companies[0])).toBe(true);
        expect(st.companies[0].triggered).toBe(true);
        expect(obtainDiplomaticRelation(company, holder).type).toBe(DiplomaticRelationType.War);
        expect(obtainDiplomaticRelation(company, holder).locked).toBe(true);
        expect(colony.invadingTroops!.count).toBeGreaterThanOrEqual(1);
    }, 600000);

    it('end: a torn-down company is contained (2020)', () => {
        const { game, g } = ccGame();
        const holder = g.empires.find((e) => e !== g.playerEmpire && e.pirateEmpireBaseHabitat === null && e.colonies.length > 0)!;
        const company = stubCompany(g, holder);
        const colony = holder.colonies[0];
        const { character: gov } = generateNewCharacter(g, holder, CharacterRole.ColonyGovernor, colony);
        const st = corporateCoupState(g);
        st.companies[0].bought.push(gov);
        expect(coupTrigger(g, st.companies[0])).toBe(true);
        for (const bo of [...company.builtObjects]) builtObjectCompleteTeardown(g, bo);
        const ends: GameEndEventArgs[] = [];
        setGameEndHandler(g, (e) => ends.push(e));
        corporateCoupPeriodic(g);
        expect(company.active).toBe(false);
        expect(ends.map((e) => e.code)).toEqual([CORPORATE_COUP_CODE_CONTAINED]);
        setGameEndHandler(g, null);
    }, 600000);

    it('end: the company holding enough of the holder\'s population ends the game in defeat (1920)', () => {
        const { game, g } = ccGame();
        const holder = g.empires.find((e) => e !== g.playerEmpire && e.pirateEmpireBaseHabitat === null && e.colonies.length > 1 && e.colonies.some((c) => c.population.totalAmount > 0))!;
        const company = stubCompany(g, holder);
        const colony = holder.colonies.find((c) => c.population.totalAmount > 0)!;
        const { character: gov } = generateNewCharacter(g, holder, CharacterRole.ColonyGovernor, colony);
        const st = corporateCoupState(g);
        st.companies[0].bought.push(gov);
        expect(coupTrigger(g, st.companies[0])).toBe(true);
        // Simulate the ground war resolving in the company's favour (the stock invasion, not re-tested here).
        takeOwnershipOfColonyFull(g, holder, colony, company, false, false);
        g.scenario!.params.coupDefeatPopulationPct = 0.0001;
        const ends: GameEndEventArgs[] = [];
        setGameEndHandler(g, (e) => ends.push(e));
        corporateCoupPeriodic(g);
        expect(ends.map((e) => e.code)).toEqual([CORPORATE_COUP_CODE_DEFEAT]);
        setGameEndHandler(g, null);
    }, 600000);
});
