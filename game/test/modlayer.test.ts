// Mod layer (tasks/MODLAYER-DESIGN.md): data overlay, flags, save round trip, hook points, example scenario, harness.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame, cachedTickGameRun } from './helpers/gameCache';
import { createScenarioGame, inlineOverlay, loadScenarioOverlayFs, scenarioGameData, scenarioIndexFs } from './helpers/scenarioGame';
import { createTickGame } from './helpers/tickGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Habitat } from '../src/sim/types';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateCounts, stateDigest } from '../src/sim/tick/digest';
import { GalaxyTime, YEAR_LENGTH } from '../src/sim/galaxyTime';
import { deserializeGame, savedScenarioId, serializeGame } from '../src/sim/save/gameSave';
import { defaultStartGameOptions, toCreateGameOptions } from '../src/sim/startGameOptions';
import { getText } from '../src/sim/textResolver';
import { EmpireMessageType, empireMessages } from '../src/sim/messages';
import { obtainEmpireEvaluation } from '../src/sim/diplomacy';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import {
    applyScenarioOverlay,
    createEmpireMidGame,
    createGalaxyScenario,
    emptyScenarioManifest,
    gameYear,
    parseScenarioManifest,
    radiusFraction,
    registerScenarioYearly,
    scenarioActive,
    scenarioFlag,
    scenarioMessage,
    scenarioNews,
    scenarioParam,
    scenarioResourceAllowed,
    scenarioState,
    scenarioText,
    scenarioYearlyTick,
} from '../src/sim/scenario';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const unregister: (() => void)[] = [];
afterEach(() => {
    while (unregister.length > 0) unregister.pop()!();
});

function withoutScenario(gd: GameData): Omit<GameData, 'scenario'> {
    const { scenario: _s, ...rest } = gd;
    return rest;
}

function saveText(game: { galaxy: Galaxy; playerEmpire: unknown; viewX: number; viewY: number }, scenario: { id: string; flags: Record<string, boolean>; params: Record<string, number> } | null = null): string {
    const time = new GalaxyTime();
    time.togglePause();
    time.advance(game.galaxy.nowMs);
    return serializeGame(game as never, time, { ...defaultStartGameOptions(), seed: 1, scenario });
}

describe('manifest', () => {
    it('parses and fills defaults', () => {
        const m = parseScenarioManifest('{"id":"rim-trader","flags":[{"name":"a","default":true}],"params":[{"name":"n","default":3,"min":0,"max":5}]}');
        expect(m.name).toBe('rim-trader');
        expect(m.flags).toEqual([{ name: 'a', label: 'a', description: undefined, default: true }]);
        expect(m.params[0]).toMatchObject({ name: 'n', default: 3, min: 0, max: 5 });
        expect(m.homePlacement).toEqual([]);
        expect(m.resourcePlacement).toEqual([]);
    });
    it('rejects malformed manifests', () => {
        expect(() => parseScenarioManifest({ id: 'bad id' })).toThrow();
        expect(() => parseScenarioManifest({ id: 'x', flags: [{ name: 'a' }, { name: 'a' }] })).toThrow(/duplicate/);
        expect(() => parseScenarioManifest({ id: 'x', homePlacement: [{ race: 'Human', minRadius: 0.9, maxRadius: 0.5 }] })).toThrow();
    });
    it('the repo index lists the example scenario with its files', () => {
        const ex = scenarioIndexFs().find((m) => m.id === 'example');
        expect(ex).toBeDefined();
        expect(ex!.files).toEqual(['GameText.txt', 'races/teekan.txt']);
        expect(ex!.flags.map((f) => f.name)).toEqual(['exampleFlag']);
    });
});

describe('data overlay', () => {
    it('an empty overlay yields identical GameData', () => {
        const gd = applyScenarioOverlay(base, { manifest: emptyScenarioManifest(), files: new Map() });
        expect(withoutScenario(gd)).toEqual(withoutScenario(base));
        expect(gd.scenario).toEqual({ manifest: emptyScenarioManifest(), files: [], warnings: [] });
        expect(base.scenario).toBeUndefined();
    });

    it('the example renames Teekan (inheriting its files) and adds a GameText line; base untouched', () => {
        const gd = scenarioGameData(base, 'example');
        expect(gd.scenario!.warnings).toEqual([]);
        const names = gd.races.map((r) => r.name);
        expect(names).toContain('Teekan Guild');
        expect(names).not.toContain('Teekan');
        expect(gd.races.length).toBe(base.races.length);
        const i = base.races.findIndex((r) => r.name === 'Teekan');
        expect(gd.races[i].name).toBe('Teekan Guild');
        // Every other field of the race is the base value.
        expect({ ...gd.races[i], name: 'Teekan' }).toEqual(base.races[i]);
        expect(base.races[i].name).toBe('Teekan');
        if (base.policies!.has('Teekan')) expect(gd.policies!.get('Teekan Guild')).toBe(base.policies!.get('Teekan'));
        const tpl = [...base.designSpecificationTexts!.keys()].filter((k) => k.startsWith('designTemplates/teekan/'));
        for (const k of tpl) expect(gd.designSpecificationTexts!.get(k.replace('/teekan/', '/teekan guild/'))).toBe(base.designSpecificationTexts!.get(k));
        expect(gd.raceBiases.names).toContain('Teekan Guild');
        expect(base.raceBiases.names).toContain('Teekan');
        expect(getText('Scenario Example Greeting')).toBe('Welcome to the example scenario, {0}.');
        expect(scenarioText('Scenario Example Greeting', 'Admiral')).toBe('Welcome to the example scenario, Admiral.');
    });

    it('record files merge by name; new races append and need a bias row', () => {
        const human = base.sourceTexts!.get('races/human.txt')!;
        const steel = base.resources.find((r) => r.name === 'Steel')!;
        const noBias = applyScenarioOverlay(base, inlineOverlay({ id: 't' }, {
            'races/clone.txt': `${human}\nName ;Clonoid`,
            'resources.txt': `10, Steel, 10, 7.0, 0, 0, N, Y, 0.6, 0,\t1, 6, 0.17, 0.4, 0.9,\n90, Rimstone, 90, 50.0, 2, 0, N, N, 0, 0,\t0, 6, 0.2, 0.2, 0.8,\n`,
        }));
        expect(noBias.races.map((r) => r.name).slice(-1)).toEqual(['Clonoid']);
        expect(noBias.resources.length).toBe(base.resources.length + 1);
        const steel2 = noBias.resources.find((r) => r.name === 'Steel')!;
        expect(steel2.resourceId).toBe(steel.resourceId);
        expect(noBias.resources.indexOf(steel2)).toBe(base.resources.indexOf(steel));
        expect(noBias.resources.at(-1)!.name).toBe('Rimstone');
        expect(noBias.scenario!.warnings.some((w) => w.startsWith('raceBiases'))).toBe(true);
        const row = `0, Clonoid, ${base.raceBiases.names.map(() => '5').join(', ')}, 0`;
        const withBias = applyScenarioOverlay(base, inlineOverlay({ id: 't' }, { 'races/clone.txt': `${human}\nName ;Clonoid`, 'raceBiases.txt': row }));
        expect(withBias.scenario!.warnings).toEqual([]);
        expect(withBias.raceBiases.names.length).toBe(withBias.races.length);
        expect(withBias.raceBiases.matrix.every((r) => r.length === withBias.races.length)).toBe(true);
        expect(base.raceBiases.names.length).toBe(base.races.length);
    });

    it('policy overlays patch the base policy text', () => {
        const gd = applyScenarioOverlay(base, inlineOverlay({ id: 't' }, { 'Policy/Human.txt': 'TradeWithOtherEmpires ;false\n', 'unknown.xyz': 'x' }));
        expect(gd.policies!.get('Human')).not.toBe(base.policies!.get('Human'));
        expect(gd.scenario!.warnings).toEqual(['unknown.xyz: not an overlayable file (ignored)']);
    });
});

describe('flags and state', () => {
    it('readers are off without a scenario', () => {
        const g = cachedTickGame(base).galaxy;
        expect(g.scenario).toBeNull();
        expect(scenarioActive(g)).toBe(false);
        expect(scenarioFlag(g, 'anything')).toBe(false);
        expect(scenarioParam(g, 'n', 7)).toBe(7);
        expect(() => scenarioState(g, 'k', () => 1)).toThrow();
    });
    it('createGalaxyScenario resolves defaults, overrides and clamps', () => {
        const m = parseScenarioManifest({ id: 's', flags: [{ name: 'a', default: true }, { name: 'b', default: false }], params: [{ name: 'n', default: 3, max: 5 }], resourcePlacement: [{ resource: 'steel', minRadius: 0.5, maxRadius: 1 }] });
        const s = createGalaxyScenario(m, { flags: { b: true, zzz: true }, params: { n: 99 } }, base.resources);
        expect(s.flags).toEqual({ a: true, b: true });
        expect(s.params).toEqual({ n: 5 });
        expect(s.resourceRules).toEqual([{ resourceId: base.resources.find((r) => r.name === 'Steel')!.resourceId, minRadius: 0.5, maxRadius: 1 }]);
    });
    it('toCreateGameOptions passes the wizard choice (none when absent)', () => {
        const none = toCreateGameOptions(defaultStartGameOptions(), base, ['A']);
        expect('scenarioFlags' in none).toBe(false);
        const withS = toCreateGameOptions({ ...defaultStartGameOptions(), scenario: { id: 'example', flags: { exampleFlag: true }, params: {} } }, base, ['A']);
        expect(withS.scenarioFlags).toEqual({ exampleFlag: true });
    });
});

describe('flags off = faithful game', () => {
    it('an empty scenario gives the same seed-1 game and 600 s run as no scenario', () => {
        const ref = cachedTickGameRun(base, { seconds: 600 });
        const gd = applyScenarioOverlay(base, { manifest: emptyScenarioManifest(), files: new Map() });
        const game = createTickGame(gd);
        expect(game.galaxy.scenario).not.toBeNull();
        const run = runGameSeconds(game, 600);
        expect(stateDigest(game.galaxy)).toBe(stateDigest(ref.game.galaxy));
        expect(stateCounts(game.galaxy)).toEqual(stateCounts(ref.game.galaxy));
        expect(run.rndDraws).toBe(ref.run.rndDraws);
        expect(game.galaxy.rnd.drawCount).toBe(ref.game.galaxy.rnd.drawCount); // same stream position
        // The yearly tick anchored (and advanced at most to the current year) without drawing.
        expect(game.galaxy.scenario!.lastYear).toBeGreaterThanOrEqual(0);
        expect(game.galaxy.scenario!.lastYear).toBeLessThanOrEqual(gameYear(galaxyStarDate(game.galaxy)));
    }, 1200000);
});

describe('save round trip', () => {
    it('a scenario game saves, loads only with its scenario data, and re-saves byte-identically', () => {
        const { game, gameData } = createScenarioGame(base, { scenario: 'example', flags: { exampleFlag: true } });
        expect(game.galaxy.scenario!.id).toBe('example');
        expect(scenarioFlag(game.galaxy, 'exampleFlag')).toBe(true);
        scenarioState(game.galaxy, 'test', () => ({ counter: 3, empire: game.playerEmpire }));
        expect(game.galaxy.races.some((r) => r.name === 'Teekan Guild')).toBe(true);
        const text = saveText(game, { id: 'example', flags: { exampleFlag: true }, params: {} });
        expect(savedScenarioId(text)).toBe('example');
        expect(() => deserializeGame(text, base)).toThrow(/scenario example/);
        const loaded = deserializeGame(text, gameData);
        const s = loaded.game.galaxy.scenario!;
        expect(s.flags).toEqual({ exampleFlag: true });
        expect((s.state.test as { counter: number; empire: unknown }).counter).toBe(3);
        expect((s.state.test as { empire: unknown }).empire).toBe(loaded.game.galaxy.playerEmpire);
        expect(saveText(loaded.game, loaded.startOptions.scenario ?? null)).toBe(text);
        expect(loaded.startOptions.scenario).toEqual({ id: 'example', flags: { exampleFlag: true }, params: {} });
    }, 600000);
    it('a faithful save does not load with scenario data', () => {
        const game = cachedTickGame(base);
        expect(savedScenarioId(saveText(game))).toBeNull();
        expect(() => deserializeGame(saveText(game), scenarioGameData(base, 'example'))).toThrow(/scenario/);
    });
});

describe('hook points', () => {
    function scenarioOn(g: Galaxy, flags: Record<string, boolean> = { f: true }): void {
        g.scenario = createGalaxyScenario(parseScenarioManifest({ id: 'hooks', flags: Object.keys(flags).map((name) => ({ name, default: false })) }), { flags }, base.resources);
    }

    it('yearly tick: anchors, then runs gated handlers once per new year in order', () => {
        const g = cachedTickGame(base).galaxy;
        const calls: string[] = [];
        unregister.push(registerScenarioYearly({ id: 'b', flag: 'f', run: (_g, y) => calls.push(`b${y}`) }));
        unregister.push(registerScenarioYearly({ id: 'a', order: 1, flag: 'f', run: () => calls.push('a') }));
        unregister.push(registerScenarioYearly({ id: 'off', flag: 'other', run: () => calls.push('off') }));
        unregister.push(registerScenarioYearly({ id: 'elsewhere', scenarioId: 'nope', run: () => calls.push('elsewhere') }));
        scenarioYearlyTick(g); // no scenario: nothing
        scenarioOn(g, { f: true, other: false });
        const draws = g.rnd.drawCount;
        scenarioYearlyTick(g); // anchors
        expect(calls).toEqual([]);
        const y = gameYear(galaxyStarDate(g));
        g.nowMs += YEAR_LENGTH;
        scenarioYearlyTick(g);
        scenarioYearlyTick(g); // same year: once
        expect(calls).toEqual([`b${y + 1}`, 'a']);
        expect(g.rnd.drawCount).toBe(draws);
    });

    it('yearly tick runs from the galaxy long block', () => {
        const game = cachedTickGame(base);
        const g = game.galaxy;
        scenarioOn(g);
        let ran = 0;
        unregister.push(registerScenarioYearly({ id: 'x', flag: 'f', run: (gal) => {
            ran++;
            gal.rnd.next(0, 10); // scenario draws belong in its own tick
        } }));
        g.scenario!.lastYear = gameYear(galaxyStarDate(g)) - 1;
        runGameSeconds(game, 61);
        expect(ran).toBe(1);
    }, 600000);

    it('createEmpireMidGame: an AI empire and a pirate faction, saved and reloaded', () => {
        const game = cachedTickGame(base);
        const g = game.galaxy;
        const race = g.races.find((r) => r.name === 'Ugnari')!;
        const colonies = g.habitats.filter((h) => h.empire !== null);
        const far = (h: Habitat) => Math.min(...colonies.map((c) => g.calculateDistance(h.xpos, h.ypos, c.xpos, c.ypos)));
        const candidates = g.habitats.filter((h) => h.empire === null && h.type === race.nativeHabitatType && h.population.items.length === 0);
        candidates.sort((a, b) => far(b) - far(a));
        const home = candidates[0];
        const empiresBefore = g.empires.length;
        const e = createEmpireMidGame(g, { race: 'Ugnari', name: 'Rim Company', home, relationBias: -20 })!;
        expect(e).not.toBeNull();
        expect(g.empires.length).toBe(empiresBefore + 1);
        expect(g.empires).toContain(e);
        expect(e.name).toBe('Rim Company');
        expect(e.capital).toBe(home);
        expect(e.playerEmpire).toBe(false);
        expect(home.empire).toBe(e);
        expect(obtainEmpireEvaluation(g, e, game.playerEmpire).bias).toBe(-20);
        expect(obtainEmpireEvaluation(g, game.playerEmpire, e).bias).toBe(-20);

        const base2 = candidates.find((h) => h !== home && h.empire === null)!;
        const piratesBefore = g.pirateEmpires.length;
        const p = createEmpireMidGame(g, { kind: 'pirate', race: 'Ugnari', name: 'Dark Farm', home: base2 })!;
        expect(g.pirateEmpires.length).toBe(piratesBefore + 1);
        expect(p.name).toBe('Dark Farm');
        expect(p.pirateEmpireBaseHabitat).toBe(base2);

        runGameSeconds(game, 30);
        const text = saveText(game);
        const loaded = deserializeGame(text, base);
        const e2 = loaded.game.galaxy.empires.find((x) => x.name === 'Rim Company')!;
        expect(e2.capital!.name).toBe(home.name);
        expect(loaded.game.galaxy.pirateEmpires.some((x) => x.name === 'Dark Farm')).toBe(true);
        expect(saveText(loaded.game)).toBe(text);
        expect(stateDigest(loaded.game.galaxy)).toBe(stateDigest(g));
    }, 600000);

    it('home and resource placement rules apply at generation', () => {
        const { game } = createScenarioGame(base, {
            scenario: inlineOverlay({
                id: 'rim',
                homePlacement: [{ race: 'Human', minRadius: 0.8, maxRadius: 1.0 }],
                resourcePlacement: [{ resource: 'Steel', minRadius: 0.7, maxRadius: 2 }],
            }),
        });
        const g = game.galaxy;
        const cap = game.playerEmpire.capital!;
        expect(radiusFraction(g, cap.xpos, cap.ypos)).toBeGreaterThanOrEqual(0.8);
        const steelId = base.resources.find((r) => r.name === 'Steel')!.resourceId;
        // Habitats generated with Steel are all outside 0.7 (colonies can still manufacture / receive it in cargo).
        const naturalSteel = g.habitats.filter((h) => h.resources.some((r) => r.resourceId === steelId));
        expect(naturalSteel.length).toBeGreaterThan(0);
        for (const h of naturalSteel) expect(radiusFraction(g, h.xpos, h.ypos)).toBeGreaterThanOrEqual(0.7);
        expect(scenarioResourceAllowed(g, naturalSteel[0], steelId)).toBe(true);
        // The faithful game has Steel inside 0.7.
        const ref = cachedTickGame(base).galaxy;
        expect(ref.habitats.some((h) => h.resources.some((r) => r.resourceId === steelId) && radiusFraction(ref, h.xpos, h.ypos) < 0.7)).toBe(true);
    }, 600000);

    it('messages and news reach the empires', () => {
        const game = cachedTickGame(base);
        const g = game.galaxy;
        const before = empireMessages(game.playerEmpire).length;
        const m = scenarioMessage(g, game.playerEmpire, 'Title', 'Body', { type: EmpireMessageType.GeneralWarning });
        expect(empireMessages(game.playerEmpire).length).toBe(before + 1);
        expect(m.title).toBe('Title');
        const sent = scenarioNews(g, game.playerEmpire, 'Something happened');
        expect(sent.length).toBe([...g.empires, ...g.pirateEmpires].filter((e) => e.active).length);
        const last = empireMessages(g.empires[1]).at(-1)!;
        expect(last.messageType).toBe(EmpireMessageType.GalacticNewsNet);
        expect(last.description).toContain('Something happened');
    });
});

describe('scenario harness', () => {
    it('loads the example overlay from the repo folder', () => {
        const o = loadScenarioOverlayFs('example');
        expect([...o.files.keys()]).toEqual(['GameText.txt', 'races/teekan.txt']);
        expect(o.manifest.name).toBe('Example Scenario');
    });
});

describe('wizard scenario choice', () => {
    it('defaults to None; a chosen scenario starts at its manifest defaults', async () => {
        const { defaultScenarioChoice, scenarioChoiceSummary } = await import('../src/sim/startGameOptions');
        expect(defaultStartGameOptions().scenario).toBeUndefined();
        const m = parseScenarioManifest({ id: 's', name: 'Rim', flags: [{ name: 'a', label: 'A on', default: true }, { name: 'b', default: false }], params: [{ name: 'n', label: 'Count', default: 3 }] });
        const c = defaultScenarioChoice(m);
        expect(c).toEqual({ id: 's', flags: { a: true, b: false }, params: { n: 3 } });
        expect(scenarioChoiceSummary(null, [m])).toBe('None');
        expect(scenarioChoiceSummary(c, [m])).toBe('Rim (A on, Count 3)');
    });
});
