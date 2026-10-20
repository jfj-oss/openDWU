// The Age 2 knowledge milestones 2-8 (threats/giantworks/age2Milestones.ts): each fires once per empire, a human gets the forced popup, an AI
// empire the milestone only, and a human that remembers Age 1 the extra closing line.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Empire } from '../src/sim/empire';
import type { Galaxy } from '../src/sim/galaxy';
import type { CreateGameOptions, Game } from '../src/sim/game';
import { comboOverlayFs, createScenarioGame } from './helpers/scenarioGame';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { empireMessages } from '../src/sim/messages';
import { setGalaxyResetSupported } from '../src/sim/galaxyReset';
import { buildAge2Game } from '../src/sim/longNightReset';
import { investigateRuins } from '../src/sim/exploration';
import { scenarioEmit } from '../src/sim/scenario/hooks';
import { SystemVisibilityStatus } from '../src/sim/visibility';
import { spawnGreatWork } from '../src/sim/scenario/threats/giantworks/framework';
import { BEACON_KIND, peekBeaconState, type CoreRec } from '../src/sim/scenario/threats/giantworks/beaconState';
import { lossCheck } from '../src/sim/scenario/threats/giantworks/beaconFleet';
import { age2WorldOf } from '../src/sim/scenario/threats/giantworks/age2World';
import { SHARED_MYTH_TRUTH, MYTH_VARIANTS, milestoneArk, milestoneRowsOf, mythVariant, onCouncilFounded, onEncounter, scarCheck, scarHabitats, truthsOf } from '../src/sim/scenario/threats/giantworks/age2Milestones';
import { milestoneReached, peekLongNight } from '../src/sim/scenario/threats/giantworks/longNightState';
import { CV_FLAG } from '../src/sim/scenario/charactersVictory/common';
import { CV_COUNCIL_FLAG } from '../src/sim/scenario/charactersVictory/diet/dietState';
import { COUNCIL_FLAG } from '../src/sim/scenario/emergent/council';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });

let next: Game;
let gameData0: GameData;
let g: Galaxy;
let me: Empire;
let ai: Empire;
let ai2: Empire;
const titlesOf = (e: Empire): string[] => empireMessages(e).map((m) => m.title);
const popups = (e: Empire, title: string) => empireMessages(e).filter((m) => m.title === title && m.scenarioPopup === 'force');

beforeAll(() => {
    const { game, gameData } = createScenarioGame(base, { scenario: comboOverlayFs(['threat-framework', 'giantworks']), flags: {}, options: age3 });
    const old = game.galaxy;
    old.scenario!.flags.gwBeacon = true;
    expect(spawnGreatWork(old, BEACON_KIND)).toBe(true);
    const st = peekBeaconState(old)!;
    const player = old.playerEmpire!;
    const victim = old.empires.find((e): e is Empire => e !== null && e !== old.independentEmpire && e !== player && e.pirateEmpireBaseHabitat === null && e.active)!;
    const core: CoreRec = { colony: victim.colonies.find((c) => c !== victim.capital)!, since: 0, harvester: null, pens: [], waiting: 0, received: 0, processed: 0, popStart: 100, knownBy: [player.empireId], ended: null, endDate: 0 };
    st.cores = [core];
    st.phase = 'reclamation';
    st.reclamationDate = 1;
    st.popBaseline = 1000;
    st.popEliminated = 900;
    setGalaxyResetSupported(old, true);
    lossCheck(old, st);
    gameData0 = gameData;
    next = buildAge2Game(game, gameData);
    g = next.galaxy;
    me = g.playerEmpire!;
    const others = g.empires.filter((e): e is Empire => e !== null && e !== me && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.active);
    ai = others[0];
    ai2 = others[1];
}, 900000);

describe('milestone 2: the first warp jump', () => {
    it('opens "the songs were true" once for a human; an AI empire gets the milestone without a popup', () => {
        const ship = null as never;
        scenarioEmit(g, 'hyperjumpStarted', { empire: me, ship });
        scenarioEmit(g, 'hyperjumpStarted', { empire: me, ship });
        scenarioEmit(g, 'hyperjumpStarted', { empire: ai, ship });
        expect(popups(me, 'The Songs Were True').length).toBe(1);
        expect(milestoneReached(g, 'warp', me.empireId)).toBe(true);
        expect(milestoneReached(g, 'warp', ai.empireId)).toBe(true);
        expect(empireMessages(ai).filter((m) => m.scenarioPopup === 'force' && m.title.includes('Songs')).length).toBe(0);
    });
});

describe('milestone 3: first contact and the shared myth', () => {
    it('keys each species\' version to its race', () => {
        expect(mythVariant('Human')).toBe(mythVariant('Human'));
        for (const r of ['Human', 'Mortalen', 'Teekan', 'Dhayut', 'Ackdarian']) expect(mythVariant(r)).toBeLessThan(MYTH_VARIANTS);
    });

    it('fires once per empire with the other\'s species, a "know" line only for a human with the memory; three species give the Truth', () => {
        const others = g.empires.filter((e): e is Empire => e !== null && e !== me && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.active && e.dominantRace !== me.dominantRace);
        onEncounter(g, ai, me); // an AI meets the player: milestone, no popup
        expect(milestoneReached(g, 'contact', ai.empireId)).toBe(true);
        expect(empireMessages(ai).some((m) => m.scenarioPopup === 'force' && m.title.includes('Not Alone'))).toBe(false);
        const first = others.find((o) => o.dominantRace !== me.dominantRace)!;
        onEncounter(g, me, first);
        const pop = popups(me, 'We Are Not Alone');
        expect(pop.length).toBe(1);
        expect(pop[0].description).toContain(first.name);
        expect(pop[0].description).toContain('You know what this is.');
        onEncounter(g, me, first);
        expect(popups(me, 'We Are Not Alone').length).toBe(1);
        // the Truth after three different species (the test galaxy has few: one empire takes three races in turn)
        expect(truthsOf(g, me)).not.toContain(SHARED_MYTH_TRUTH);
        const saved = first.dominantRace;
        const pool = base.races.filter((r) => r !== me.dominantRace && r !== saved).slice(0, 3);
        expect(pool.length).toBe(3);
        for (const r of pool) {
            (first as { dominantRace: unknown }).dominantRace = r;
            onEncounter(g, me, first);
        }
        (first as { dominantRace: unknown }).dominantRace = saved;
        expect(truthsOf(g, me)).toContain(SHARED_MYTH_TRUTH);
        expect(peekLongNight(g)!.memory!.truths).toContain(SHARED_MYTH_TRUTH);
        expect(popups(me, 'One Story, Told Many Ways').length).toBe(1);
    });
});

describe('milestone 4: an old-capital ruin', () => {
    it('logs "we were not the first" once, quietly (the ruin survey popup tells it), with the know line for a human with the memory', () => {
        const site = age2WorldOf(g)?.ruins[0];
        expect(site).toBeDefined();
        investigateRuins(g, me, site!.habitat);
        investigateRuins(g, me, site!.habitat);
        expect(popups(me, 'We Were Not the First').length).toBe(0);
        const logged = empireMessages(me).filter((m) => m.title.includes('We Were Not the First'));
        expect(logged.length).toBe(1);
        expect(logged[0].description).toContain('You know what this is.');
        investigateRuins(g, ai2, site!.habitat);
        expect(milestoneReached(g, 'ruin', ai2.empireId)).toBe(true);
        expect(empireMessages(ai2).some((m) => m.title.includes('Not the First'))).toBe(false);
    });
});

describe('milestone 5: the survivor-ark hook', () => {
    it('milestoneArk marks once and tells a human', () => {
        expect(milestoneArk(g, me)).toBe(true);
        expect(milestoneArk(g, me)).toBe(false);
        expect(popups(me, 'A Witness').length).toBe(1);
        expect(milestoneArk(g, ai)).toBe(true);
        expect(empireMessages(ai).some((m) => m.title.includes('Witness'))).toBe(false);
    });
});

describe('milestone 6: the first Harvest Scar', () => {
    it('fires when the scar\'s system is explored, once, with the know line; an AI gets no popup', () => {
        const scars = scarHabitats(g);
        expect(scars.length).toBeGreaterThan(0);
        scarCheck(g);
        const seenBefore = milestoneReached(g, 'scar', me.empireId);
        for (const e of [me, ai]) e.systemVisibility[scars[0].systemIndex].status = SystemVisibilityStatus.Explored;
        scarCheck(g);
        scarCheck(g);
        expect(milestoneReached(g, 'scar', me.empireId)).toBe(true);
        expect(milestoneReached(g, 'scar', ai.empireId)).toBe(true);
        if (!seenBefore) {
            const pop = popups(me, 'The Pens');
            expect(pop.length).toBe(1);
            expect(pop[0].description).toContain('You know what this is.');
        }
        expect(empireMessages(ai).some((m) => m.title.includes('Pens'))).toBe(false);
    });
});

describe('milestone 7: the Founders\' Compact rumour', () => {
    it('"it is happening again" for a human with the memory, a neutral line without it', () => {
        scenarioEmit(g, 'foundersRumour', { empire: me });
        scenarioEmit(g, 'foundersRumour', { empire: me });
        expect(popups(me, 'It Is Happening Again').length).toBe(1);
        expect(popups(me, 'A Secret Among the Independents').length).toBe(0);
        scenarioEmit(g, 'foundersRumour', { empire: ai });
        expect(milestoneReached(g, 'rumour', ai.empireId)).toBe(true);
        expect(empireMessages(ai).some((m) => m.scenarioPopup === 'force' && m.title.includes('Happening'))).toBe(false);
    });

    it('is neutral for a human that does not hold the memory record', () => {
        const ln = peekLongNight(g)!;
        const mem = ln.memory;
        ln.memory = null;
        const key = ln.milestones['rumour'];
        ln.milestones['rumour'] = key.filter((id) => id !== me.empireId);
        const before = empireMessages(me).length;
        scenarioEmit(g, 'foundersRumour', { empire: me });
        ln.memory = mem;
        const fresh = empireMessages(me).slice(before);
        expect(fresh.some((m) => m.title.includes('Secret Among'))).toBe(true);
        expect(fresh.some((m) => m.title.includes('Happening Again'))).toBe(false);
    });
});

describe('milestone 8: the Diet re-forms', () => {
    it('opens "the preparation begins" for each founding member once, only when the Diet runs', () => {
        onCouncilFounded(g, [me, ai]);
        expect(milestoneReached(g, 'diet', me.empireId)).toBe(false);
        g.scenario!.flags[CV_FLAG] = true;
        g.scenario!.flags[CV_COUNCIL_FLAG] = true;
        g.scenario!.flags[COUNCIL_FLAG] = true;
        g.deferEventsForGameStart = false;
        scenarioEmit(g, 'councilFounded', { members: [me, ai] });
        scenarioEmit(g, 'councilFounded', { members: [me, ai] });
        expect(popups(me, 'The Preparation Begins').length).toBe(1);
        expect(milestoneReached(g, 'diet', ai.empireId)).toBe(true);
        expect(empireMessages(ai).some((m) => m.title.includes('Preparation'))).toBe(false);
    });
});

describe('the Knowledge page and saves', () => {
    it('lists the reached milestones in plan order', () => {
        const rows = milestoneRowsOf(g, me);
        expect(rows.map((r) => r.key).slice(0, 3)).toEqual(['unification', 'warp', 'contact']);
        expect(rows.map((r) => r.key)).toContain('diet');
        expect(titlesOf(me)).toContain('The Unification');
    });

    it('survives a save round trip (milestones, truths, species met) and does not fire again', () => {
        const rt = deserializeGame(serializeGame(next, new GalaxyTime(), {} as StartGameOptions), gameData0).game;
        const g2 = rt.galaxy;
        const me2 = g2.playerEmpire!;
        expect(milestoneReached(g2, 'warp', me2.empireId)).toBe(true);
        expect(milestoneReached(g2, 'diet', me2.empireId)).toBe(true);
        expect(truthsOf(g2, me2)).toEqual(truthsOf(g, me));
        const n = empireMessages(me2).length;
        scenarioEmit(g2, 'hyperjumpStarted', { empire: me2, ship: null as never });
        scenarioEmit(g2, 'foundersRumour', { empire: me2 });
        expect(empireMessages(me2).length).toBe(n);
        expect(milestoneRowsOf(g2, me2).length).toBe(milestoneRowsOf(g, me).length);
    });
});
