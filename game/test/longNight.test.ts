// The Harvest Cycle's Long Night (threats/giantworks/longNight.ts, sim/longNightReset.ts, sim/galaxyReset.ts): the Beacon's defeat starts the
// next cycle instead of ending the game (option gwHarvestCycle), the reset builds a pre-warp galaxy from the same seed, the memory record
// crosses it and a save, the Age 2 popups fire, and surveying the crashed hull unlocks the primitive hyperdrive research.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { CreateGameOptions, Game } from '../src/sim/game';
import { comboOverlayFs, createScenarioGame } from './helpers/scenarioGame';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { empireMessages } from '../src/sim/messages';
import { stateDigest } from '../src/sim/tick/digest';
import { setGameEndHandler, type GameEndEventArgs } from '../src/sim/victory';
import { galaxyResetPending, setGalaxyResetSupported } from '../src/sim/galaxyReset';
import { buildAge2Game, performGalaxyReset } from '../src/sim/longNightReset';
import { investigateRuins } from '../src/sim/exploration';
import { RuinType } from '../src/sim/ruins';
import { EXPANSION_ARTICLES, articleKnown, setGalacticAge } from '../src/sim/scenario/expansionArticles';
import { spawnGreatWork, greatWorks } from '../src/sim/scenario/threats/giantworks/framework';
import { BEACON_KIND, peekBeaconState, type BeaconState, type CoreRec } from '../src/sim/scenario/threats/giantworks/beaconState';
import { lossCheck } from '../src/sim/scenario/threats/giantworks/beaconFleet';
import { beginLongNight, hyperdriveUnlockNodeId, markCrashSites, readMegaStation } from '../src/sim/scenario/threats/giantworks/longNight';
import { AGE_PREPARATION, galaxyAgeOf, longNightState, markMilestone, memoryRecordOf, peekLongNight, registerMemoryContributor } from '../src/sim/scenario/threats/giantworks/longNightState';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });
const ids = ['threat-framework', 'giantworks'];

interface Setup {
    game: Game;
    gameData: GameData;
    g: Galaxy;
    st: BeaconState;
}

/** A seed-1 Giantworks game with the Beacon on the brink: the Reclamation under way, 90% of the people eliminated, one known harvest core. */
function brink(flags: Record<string, boolean> = {}): Setup {
    const { game, gameData } = createScenarioGame(base, { scenario: comboOverlayFs(ids), flags, options: age3 });
    const g = game.galaxy;
    g.scenario!.flags.gwBeacon = true;
    expect(spawnGreatWork(g, BEACON_KIND)).toBe(true);
    const st = peekBeaconState(g)!;
    const player = g.playerEmpire!;
    const victim = g.empires.find((e): e is Empire => e !== null && e !== g.independentEmpire && e !== player && e.pirateEmpireBaseHabitat === null && e.active)!;
    const colony = victim.colonies.find((c) => c !== victim.capital)!;
    const core: CoreRec = { colony, since: 0, harvester: null, pens: [], waiting: 0, received: 0, processed: 0, popStart: 100, knownBy: [player.empireId], ended: null, endDate: 0 };
    st.cores = [core, { ...core, colony: victim.capital!, knownBy: [], ended: 'broken' }];
    st.phase = 'reclamation';
    st.reclamationDate = 1;
    st.popBaseline = 1000;
    st.popEliminated = 900;
    return { game, gameData, g, st };
}

function endsOf(g: Galaxy): GameEndEventArgs[] {
    const ends: GameEndEventArgs[] = [];
    setGameEndHandler(g, (e) => ends.push(e));
    return ends;
}

const raceSet = (g: Galaxy): string[] => g.empires.slice(0, 4).map((e) => e!.dominantRace!.name).sort();
const titles = (e: Empire): string[] => empireMessages(e).map((m) => m.title);

describe('the Long Night trigger', () => {
    it('the option is on by default and the game keeps its new-game options', () => {
        const { g } = brink();
        const ln = peekLongNight(g)!;
        expect(g.scenario!.flags.gwHarvestCycle).toBe(true);
        expect(ln.age).toBe(1);
        expect(ln.createOptions).toBeDefined();
        expect(ln.createOptions!['seed']).toBe(1);
        expect(ln.createOptions!['gameData']).toBeUndefined();
        expect(galaxyAgeOf(g)).toBe(1);
    }, 600000);

    it('with the option on and a driver that can swap, the defeat begins the Long Night: no game end, a reset is pending, the memory is taken', () => {
        const { g, st } = brink();
        const ends = endsOf(g);
        setGalaxyResetSupported(g, true);
        lossCheck(g, st);
        expect(ends).toEqual([]);
        expect(galaxyResetPending(g)).toBe(true);
        const mem = peekLongNight(g)!.pending!;
        expect(mem.age).toBe(AGE_PREPARATION);
        expect(mem.seed).toBe(g.randomSeed);
        expect(mem.eliminatedPct).toBeCloseTo(90);
        expect(mem.scars.map((s) => s.fate)).toEqual(['live', 'broken']);
        expect(mem.scars.map((s) => s.knownToPlayer)).toEqual([true, false]);
        expect(mem.player?.name).toBe(g.playerEmpire!.name);
        // asking again while pending does nothing
        expect(beginLongNight(g, st)).toBe(false);
    }, 600000);

    it('with the option off the defeat ends the game as before', () => {
        const { g, st } = brink({ gwHarvestCycle: false });
        const ends = endsOf(g);
        setGalaxyResetSupported(g, true);
        lossCheck(g, st);
        expect(galaxyResetPending(g)).toBe(false);
        expect(ends.map((e) => e.code)).toEqual([2051]);
    }, 600000);

    it('with a driver that cannot swap the galaxy (in-thread, multiplayer) the defeat ends the game as before', () => {
        const { g, st } = brink();
        const ends = endsOf(g);
        lossCheck(g, st);
        expect(galaxyResetPending(g)).toBe(false);
        expect(ends.map((e) => e.code)).toEqual([2051]);
    }, 600000);
});

describe('the reset', () => {
    let s: Setup;
    let next: Game;
    beforeAll(() => {
        s = brink();
        registerMemoryContributor({ id: 'test', capture: () => ({ foundries: [1, 2] }), restore: (g, d) => void ((g.scenario!.state['testRestored'] as unknown) = d) });
        setGalaxyResetSupported(s.g, true);
        // the player's mega-station parts and blueprint progress (beaconComponents.ts) carry into the next age
        s.st.parts = { held: { [String(s.g.playerEmpire!.empireId)]: { beamLens: true, mindFragments: 7, blueprint: { since: 1, progress: 1234, sharePct: 25 } } }, peakAssets: 0, lastAssets: 0, shipUnit: 0, firstBeam: 0, revealDate: 0, visited: [] };
        lossCheck(s.g, s.st);
        next = buildAge2Game(s.game, s.gameData);
    }, 900000);

    it('is the same galaxy: the same seed gives the same stars, in the same places', () => {
        const a = s.g.systems.map((x) => (x?.systemStar === undefined || x.systemStar === null ? null : [x.systemStar.name, x.systemStar.xpos, x.systemStar.ypos]));
        const b = next.galaxy.systems.map((x) => (x?.systemStar === undefined || x.systemStar === null ? null : [x.systemStar.name, x.systemStar.xpos, x.systemStar.ypos]));
        expect(b).toEqual(a);
        expect(next.galaxy.randomSeed).toBe(s.g.randomSeed);
        // the same empires start (the first four of the list; the old galaxy also grew the Reclaimers' and the Compact's faction empires)
        expect(raceSet(next.galaxy)).toEqual(raceSet(s.g));
    });

    it('starts pre-warp: age 0, no empire has ships, the player keeps race, name and colours', () => {
        const g = next.galaxy;
        expect(g.age).toBe(0);
        const old = s.g.playerEmpire!;
        const me = g.playerEmpire!;
        expect(me.name).toBe(old.name);
        expect(me.dominantRace!.name).toBe(old.dominantRace!.name);
        expect(raceSet(g)).toEqual(raceSet(s.g));
        expect(me.mainColor).toBe(old.mainColor);
        expect(me.secondaryColor).toBe(old.secondaryColor);
        for (const e of g.empires) if (e !== null && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.capital !== null) expect(e.builtObjects.filter((b) => b.topSpeed > 0).length).toBe(0);
    });

    it('carries the memory record: Age 2, the scars, the player, the contributors', () => {
        const g = next.galaxy;
        const mem = memoryRecordOf(g)!;
        expect(galaxyAgeOf(g)).toBe(AGE_PREPARATION);
        expect(mem.scars.length).toBe(2);
        expect(mem.scars[0]).toMatchObject({ fate: 'live', knownToPlayer: true });
        expect(mem.scars[0].name.length).toBeGreaterThan(0);
        expect(mem.truths).toEqual(['age1-harvest']);
        expect(mem.megaStation).toEqual({ components: {}, blueprintPoints: 0 });
        expect(mem.foundries).toEqual({ located: [], destroyed: [] });
        expect(mem.extra['test']).toEqual({ foundries: [1, 2] });
        expect(g.scenario!.state['testRestored']).toEqual({ foundries: [1, 2] });
        expect(peekLongNight(g)!.pending).toBeFalsy();
        const carried = peekBeaconState(g)?.parts?.held[String(g.playerEmpire!.empireId)];
        expect(carried).toMatchObject({ beamLens: true, mindFragments: 7, blueprint: { progress: 1234 } });
    });

    it('sends the transition and popup #0 "The Unification" (approved text) to the player', () => {
        const me = next.galaxy.playerEmpire!;
        const msgs = empireMessages(me).filter((m) => m.scenarioPopup === 'force');
        expect(msgs.map((m) => m.title)).toEqual(expect.arrayContaining(['The Unification']));
        const uni = msgs.find((m) => m.title === 'The Unification')!;
        expect(uni.description.startsWith('For longer than any record goes back, this world belonged to warlords.')).toBe(true);
        expect(uni.description.endsWith('As far as anyone knows, no one ever could.')).toBe(true);
        expect(uni.description.split('\n\n').length).toBe(4);
    });

    it('survives a save and load: the memory record and the crash sites', () => {
        const time = new GalaxyTime();
        const text = serializeGame(next, time, {} as StartGameOptions);
        const { game } = deserializeGame(text, s.gameData);
        const a = memoryRecordOf(next.galaxy)!;
        const b = memoryRecordOf(game.galaxy)!;
        expect(b).toEqual(a);
        const sitesA = peekLongNight(next.galaxy)!.crashSites;
        const sitesB = peekLongNight(game.galaxy)!.crashSites;
        expect(sitesB.map((x) => [x.habitat.name, x.empireId])).toEqual(sitesA.map((x) => [x.habitat.name, x.empireId]));
        for (const site of sitesB) expect(game.galaxy.habitats.includes(site.habitat)).toBe(true);
        expect(peekLongNight(game.galaxy)!.createOptions).toEqual(peekLongNight(next.galaxy)!.createOptions);
    }, 600000);

    it('is deterministic: the same old game gives the same new one', () => {
        const again = buildAge2Game(s.game, s.gameData);
        expect(stateDigest(again.galaxy)).toBe(stateDigest(next.galaxy));
    }, 900000);

    it('performGalaxyReset hands the driver a paused game on the old clock', () => {
        const time = new GalaxyTime();
        time.paused = false;
        const r = performGalaxyReset(s.game, time, s.gameData);
        expect(r.time.paused).toBe(true);
        expect(r.game.galaxy.randomSeed).toBe(s.g.randomSeed);
    }, 900000);
});

describe('Giantworks in Age 2', () => {
    it('seeds again in the new galaxy (the Beacon is planned by the normal seeding) and the record is readable by it', () => {
        const { game, gameData } = createScenarioGame(base, { scenario: comboOverlayFs(ids), flags: { threatGiantworks: true }, options: age3 });
        expect(greatWorks(game.galaxy).map((w) => w.wonder)).toContain(BEACON_KIND);
        longNightState(game.galaxy).pending = { age: AGE_PREPARATION, seed: 1, fromDate: 0, eliminatedPct: 90, scars: [], foundries: { located: [], destroyed: [] }, megaStation: { components: {}, blueprintPoints: 0 }, truths: [], player: null, extra: {} };
        const g = buildAge2Game(game, gameData).galaxy;
        expect(greatWorks(g).map((w) => w.wonder)).toContain(BEACON_KIND);
        expect(memoryRecordOf(g)!.age).toBe(AGE_PREPARATION);
        expect(peekLongNight(g)!.createOptions).toBeDefined();
    }, 900000);
});

describe('the crashed hull (milestone 1)', () => {
    let s: Setup;
    let next: Game;
    beforeAll(() => {
        s = brink();
        setGalaxyResetSupported(s.g, true);
        lossCheck(s.g, s.st);
        next = buildAge2Game(s.game, s.gameData);
    }, 900000);

    it('lies on a rocky planet of the home system of every pre-warp empire, as the stock research ruin', () => {
        const g = next.galaxy;
        const sites = peekLongNight(g)!.crashSites;
        const node = hyperdriveUnlockNodeId(g);
        expect(node).not.toBeNull();
        expect(sites.length).toBeGreaterThan(0);
        for (const site of sites) {
            const e = g.empires.find((x) => x !== null && x.empireId === site.empireId)!;
            expect(site.habitat.systemIndex).toBe(e.capital!.systemIndex);
            expect(site.habitat.ruin!.type).toBe(RuinType.UnlockResearchProject);
            expect(site.habitat.ruin!.researchProjectId).toBe(node);
            expect(site.habitat.type).not.toBe(undefined);
        }
        expect(peekLongNight(g)!.crashSites.map((x) => x.empireId)).toContain(g.playerEmpire!.empireId);
        // a second marking finds the same sites (no Rnd, nothing new placed)
        expect(markCrashSites(g).length).toBe(sites.length);
    });

    it('surveying it opens "The Thing in the Crater" once and unlocks the hyperdrive research', () => {
        const g = next.galaxy;
        const me = g.playerEmpire!;
        const site = peekLongNight(g)!.crashSites.find((x) => x.empireId === me.empireId)!;
        const node = me.research.techTree[site.habitat.ruin!.researchProjectId];
        expect(node.isEnabled).toBe(false);
        investigateRuins(g, me, site.habitat);
        expect(node.isEnabled).toBe(true);
        const crater = empireMessages(me).filter((m) => m.title === 'The Thing in the Crater');
        expect(crater.length).toBe(1);
        expect(crater[0].scenarioPopup).toBe('force');
        expect(crater[0].description).toContain(`The crater on ${site.habitat.name} is old`);
        expect(crater[0].description).not.toContain('{0}');
        expect(titles(me)).toContain('The Unification');
        // surveying again: the stock silence, no second popup
        investigateRuins(g, me, site.habitat);
        expect(empireMessages(me).filter((m) => m.title === 'The Thing in the Crater').length).toBe(1);
        expect(markMilestone(g, 'crash', me.empireId)).toBe(false);
    });

    it('an AI empire that surveys its own hull gets the unlock and the milestone but no popup', () => {
        const g = next.galaxy;
        const site = peekLongNight(g)!.crashSites.find((x) => x.empireId !== g.playerEmpire!.empireId);
        if (site === undefined) return;
        const ai = g.empires.find((x) => x !== null && x.empireId === site.empireId)!;
        const node = ai.research.techTree[site.habitat.ruin!.researchProjectId];
        investigateRuins(g, ai, site.habitat);
        expect(node.isEnabled).toBe(true);
        expect(empireMessages(ai).filter((m) => m.title === 'The Thing in the Crater').length).toBe(0);
        expect(peekLongNight(g)!.milestones['crash']).toContain(ai.empireId);
    });
});

describe('the Galactopedia entry', () => {
    it('"The Long Night, and After" is known only from Age 2', () => {
        const a = EXPANSION_ARTICLES.find((x) => x.id === 'long-night')!;
        expect(a.title).toBe('The Long Night, and After');
        setGalacticAge(1);
        expect(articleKnown(a)).toBe(false);
        expect(articleKnown(EXPANSION_ARTICLES.find((x) => x.id === 'giantworks')!)).toBe(true);
        setGalacticAge(2);
        expect(articleKnown(a)).toBe(true);
        setGalacticAge(1);
    });
});

describe('the mega-station memory', () => {
    it('reads a mega-station state defensively and ignores what it does not know', () => {
        const { g } = brink();
        expect(readMegaStation(g)).toEqual({ components: {}, blueprintPoints: 0 });
        g.scenario!.state['megaStation'] = { components: { 'beam lens': 1, 'void frame': 3, junk: 'x' }, blueprint: 1250000 };
        expect(readMegaStation(g)).toEqual({ components: { 'beam lens': 1, 'void frame': 3 }, blueprintPoints: 1250000 });
        g.scenario!.state['megaStation'] = 'garbage';
        expect(readMegaStation(g)).toEqual({ components: {}, blueprintPoints: 0 });
    }, 600000);
});
