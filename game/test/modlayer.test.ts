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
    registerScenarioPeriodic,
    scenarioPeriodicTick,
    GAME_DAY_LENGTH,
    registerScenarioGameStart,
    registerScenarioEvent,
    registerScenarioQuery,
    scenarioQuery,
    scenarioEmit,
    resolveScenarioIncludes,
    registerScenarioDecision,
    raiseScenarioDecision,
    answerScenarioDecision,
    pendingScenarioDecisions,
    expireScenarioDecisions,
    isScenarioDecision,
} from '../src/sim/scenario';
import { empireApprovalRating } from '../src/sim/taxes';
import { builtObjectCompleteTeardown } from '../src/sim/combat/teardown';
import { takeOwnershipOfColonyFull } from '../src/sim/combat/ownership';
import { declareWar } from '../src/sim/diplomacyTick';
import { DiplomaticRelationType } from '../src/sim/diplomacy';

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
        scenarioState(game.galaxy, 'test', () => ({ counter: 3, empire: game.playerEmpire, byId: new Map<number, { loyalty: number; empire: unknown }>([[game.playerEmpire.empireId, { loyalty: 7, empire: game.playerEmpire }]]) }));
        expect(game.galaxy.races.some((r) => r.name === 'Teekan Guild')).toBe(true);
        const text = saveText(game, { id: 'example', flags: { exampleFlag: true }, params: {} });
        expect(savedScenarioId(text)).toBe('example');
        expect(() => deserializeGame(text, base)).toThrow(/scenario example/);
        const loaded = deserializeGame(text, gameData);
        const s = loaded.game.galaxy.scenario!;
        expect(s.flags).toEqual({ exampleFlag: true });
        expect((s.state.test as { counter: number; empire: unknown }).counter).toBe(3);
        expect((s.state.test as { empire: unknown }).empire).toBe(loaded.game.galaxy.playerEmpire);
        const byId = (s.state.test as { byId: Map<number, { loyalty: number; empire: unknown }> }).byId;
        expect(byId.get(loaded.game.galaxy.playerEmpire!.empireId)).toEqual({ loyalty: 7, empire: loaded.game.galaxy.playerEmpire });
        expect(byId.get(loaded.game.galaxy.playerEmpire!.empireId)!.empire).toBe(loaded.game.galaxy.playerEmpire);
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

describe('spec-driven additions (periodic, game start, events, queries, BasedOn, adopt, include, decisions)', () => {
    function on(g: Galaxy, flags: Record<string, boolean> = { f: true }): void {
        g.scenario = createGalaxyScenario(parseScenarioManifest({ id: 'x2', flags: Object.keys(flags).map((name) => ({ name, default: false })) }), { flags }, base.resources);
    }

    it('periodic tick: anchors per handler, then runs every periodDays', () => {
        const g = cachedTickGame(base).galaxy;
        on(g);
        const runs: number[] = [];
        unregister.push(registerScenarioPeriodic({ id: 'p', flag: 'f', periodDays: 30, run: (_g, d) => runs.push(d) }));
        unregister.push(registerScenarioPeriodic({ id: 'q', flag: 'off', periodDays: 1, run: () => runs.push(-1) }));
        scenarioPeriodicTick(g);
        g.nowMs += 29 * GAME_DAY_LENGTH;
        scenarioPeriodicTick(g);
        expect(runs).toEqual([]);
        g.nowMs += GAME_DAY_LENGTH;
        scenarioPeriodicTick(g);
        expect(runs).toEqual([galaxyStarDate(g)]);
        expect(g.scenario!.periodicLast.p).toBe(galaxyStarDate(g));
    });

    it('game-start hook runs once at the end of createGame, only with its flag', () => {
        let ran = 0;
        let sawPlayer = false;
        unregister.push(registerScenarioGameStart({ id: 'gs', flag: 'start', run: (g, ctx) => {
            ran++;
            sawPlayer = g.playerEmpire !== null && typeof ctx.randomPointInRing === 'function';
        } }));
        const { game } = createScenarioGame(base, { scenario: inlineOverlay({ id: 'gs', flags: [{ name: 'start', default: true }] }) });
        expect(ran).toBe(1);
        expect(sawPlayer).toBe(true);
        expect(game.galaxy.scenario!.flags.start).toBe(true);
    }, 600000);

    it('events reach gated subscribers from the base-sim sites; queries fold over the stock value', () => {
        const game = cachedTickGame(base);
        const g = game.galaxy;
        const seen: string[] = [];
        unregister.push(registerScenarioEvent({ id: 'rm', flag: 'f', event: 'builtObjectRemoved', run: (_g, p) => seen.push(`removed:${p.builtObject.name}`) }));
        unregister.push(registerScenarioEvent({ id: 'dip', flag: 'f', event: 'diplomaticRelationChanged', run: (_g, p) => seen.push(`rel:${p.to}`) }));
        unregister.push(registerScenarioEvent({ id: 'col', flag: 'f', event: 'colonyOwnerChanged', run: (_g, p) => seen.push(`col:${p.to?.name}`) }));
        const ship = g.builtObjects.find((b) => b !== null && b.empire === game.playerEmpire)!;
        const colony = g.habitats.find((h) => h.empire === g.independentEmpire && h.population.items.length > 0)!;
        const h = game.playerEmpire.capital!;
        // No scenario: nothing is delivered.
        builtObjectCompleteTeardown(g, g.builtObjects.find((b) => b !== null && b !== ship && b.empire === game.playerEmpire)!);
        expect(seen).toEqual([]);
        on(g);
        builtObjectCompleteTeardown(g, ship);
        declareWar(g, game.playerEmpire, g.empires[1]);
        takeOwnershipOfColonyFull(g, game.playerEmpire, colony, game.playerEmpire, false, false);
        expect(seen[0]).toBe(`removed:${ship.name}`);
        expect(seen).toContain(`rel:${DiplomaticRelationType.War}`);
        expect(seen).toContain(`col:${game.playerEmpire.name}`);
        unregister.push(registerScenarioQuery({ id: 'ap', flag: 'f', query: 'empireApprovalRating', run: (_g, v) => v + 10 }));
        g.scenario!.flags.f = false;
        const approval = empireApprovalRating(g, h);
        g.scenario!.flags.f = true;
        expect(empireApprovalRating(g, h)).toBeCloseTo(approval + 10, 9);
        g.scenario!.flags.f = false;
        expect(empireApprovalRating(g, h)).toBe(approval);
        expect(scenarioQuery(g, 'empireApprovalRating', 1, { habitat: h, empire: h.empire })).toBe(1);
        scenarioEmit(g, 'builtObjectRemoved', { builtObject: ship });
        expect(seen.filter((x) => x.startsWith('removed')).length).toBe(1);
    });

    it('BasedOn race files extend a stock race (new race with the parent policy and bias row)', () => {
        const gd = applyScenarioOverlay(base, inlineOverlay({ id: 'b' }, { 'races/harvester.txt': "'x\nBasedOn ;mechanoid.txt\nName ;Harvester\nPlayable ;N\nAggression ;90\n" }));
        expect(gd.scenario!.warnings).toEqual([]);
        const mech = base.races.find((r) => r.name === 'Mechanoid')!;
        const harv = gd.races.at(-1)!;
        expect(gd.races.length).toBe(base.races.length + 1);
        expect(harv.name).toBe('Harvester');
        expect(harv.playable).toBe(false);
        expect(harv.aggression).toBe(90);
        expect({ ...harv, name: mech.name, playable: mech.playable, aggression: mech.aggression }).toEqual(mech);
        expect(gd.raceBiases.names.length).toBe(gd.races.length);
        expect(gd.raceBiases.matrix.every((r) => r.length === gd.races.length)).toBe(true);
        if (base.policies!.has('Mechanoid')) expect(gd.policies!.get('Harvester')).toBe(base.policies!.get('Mechanoid'));
        expect(gd.races.find((r) => r.name === 'Mechanoid')).toBe(mech);
        const bad = applyScenarioOverlay(base, inlineOverlay({ id: 'b' }, { 'races/x.txt': 'BasedOn ;nope.txt\nName ;X' }));
        expect(bad.races.length).toBe(base.races.length);
        expect(bad.scenario!.warnings[0]).toMatch(/BasedOn nope.txt/);
    });

    it('include: included overlays apply first, manifests merge, cycles are rejected', () => {
        const inner = inlineOverlay({ id: 'inner', flags: [{ name: 'a', default: true }] }, { 'GameText.txt': 'Inc Tag;inner\nShared Tag;inner' });
        const outer = inlineOverlay({ id: 'outer', include: ['inner'], flags: [{ name: 'b', default: false }] }, { 'GameText.txt': 'Shared Tag;outer' });
        const byId = new Map([['inner', inner], ['outer', outer]]);
        const gd = applyScenarioOverlay(base, resolveScenarioIncludes(outer, byId));
        expect(gd.scenario!.manifest.id).toBe('outer');
        expect(gd.scenario!.manifest.flags.map((f) => f.name)).toEqual(['b', 'a']);
        expect(gd.scenario!.files).toEqual(['inner:GameText.txt', 'GameText.txt']);
        expect(getText('Inc Tag')).toBe('inner');
        expect(getText('Shared Tag')).toBe('outer');
        expect(() => applyScenarioOverlay(base, outer)).toThrow(/not resolved/);
        const loopA = inlineOverlay({ id: 'la', include: ['lb'] });
        const loopB = inlineOverlay({ id: 'lb', include: ['la'] });
        expect(() => resolveScenarioIncludes(loopA, new Map([['la', loopA], ['lb', loopB]]))).toThrow(/cycle/);
    });

    it('createEmpireMidGame adoptOnly takes a colony without reshaping it; preserveHome keeps the planet; both save', () => {
        const game = cachedTickGame(base);
        const g = game.galaxy;
        const colony = g.habitats.find((h) => h.empire === g.independentEmpire && h.population.items.length > 0)!;
        const before = { diameter: colony.diameter, baseQuality: colony.baseQuality, resources: colony.resources.map((r) => ({ ...r })), pop: colony.population.totalAmount };
        const n = g.empires.length;
        const e = createEmpireMidGame(g, { race: 'Ugnari', name: 'Adopted', adoptOnly: true, adopt: { colonies: [colony] } })!;
        expect(g.empires.length).toBe(n + 1);
        expect(colony.empire).toBe(e);
        expect(e.colonies).toContain(colony);
        expect({ diameter: colony.diameter, baseQuality: colony.baseQuality, resources: colony.resources, pop: colony.population.totalAmount }).toEqual(before);

        const race = g.races.find((r) => r.name === 'Ugnari')!;
        const home = g.habitats.find((h) => h.empire === null && h.type === race.nativeHabitatType && h.population.items.length === 0 && h.resources.length > 0)!;
        const kept = { diameter: home.diameter, baseQuality: home.baseQuality, resources: home.resources.map((r) => ({ ...r })) };
        const c = createEmpireMidGame(g, { race: 'Ugnari', name: 'Company', home, age: 0, preserveHome: true, homeSystemFactor: 0.1, setup: false })!;
        expect(c.capital).toBe(home);
        expect({ diameter: home.diameter, baseQuality: home.baseQuality, resources: home.resources }).toEqual(kept);
        expect(home.population.totalAmount).toBeLessThan(0.1 * 2.2e9 + 0.1 * 5e8 + 1);

        runGameSeconds(game, 20);
        const text = saveText(game);
        const loaded = deserializeGame(text, base);
        expect(loaded.game.galaxy.empires.map((x) => x.name)).toEqual(g.empires.map((x) => x.name));
        expect(saveText(loaded.game)).toBe(text);
    }, 600000);

    it('decisions: the player answers from a message, AI empires answer at once, unanswered ones expire; pending ones save', () => {
        const game = cachedTickGame(base);
        const g = game.galaxy;
        on(g);
        const resolved: string[] = [];
        unregister.push(registerScenarioDecision({ id: 'd', flag: 'f', kind: 'test.bribe', resolve: (_g, d, o) => resolved.push(`${d.empire.name}:${o}`), aiChoose: () => 'refuse' }));
        const opts = [{ id: 'pay', label: 'Pay' }, { id: 'refuse', label: 'Refuse' }];
        const d = raiseScenarioDecision(g, game.playerEmpire, { kind: 'test.bribe', title: 'Bribe', text: 'Pay?', options: opts, defaultOption: 'refuse', expiresDays: 10 });
        const msg = empireMessages(game.playerEmpire).at(-1)!;
        expect(msg.messageType).toBe(EmpireMessageType.GeneralDecision);
        expect(msg.subject).toBe(d);
        expect(isScenarioDecision(msg.subject)).toBe(true);
        expect(pendingScenarioDecisions(g, game.playerEmpire)).toEqual([d]);
        raiseScenarioDecision(g, g.empires[1], { kind: 'test.bribe', title: 'Bribe', text: 'Pay?', options: opts });
        expect(resolved).toEqual([`${g.empires[1].name}:refuse`]);

        const text = saveText(game);
        const loaded = deserializeGame(text, applyScenarioOverlay(base, inlineOverlay({ id: 'x2' })));
        const lp = pendingScenarioDecisions(loaded.game.galaxy);
        expect(lp.length).toBe(1);
        expect(empireMessages(loaded.game.galaxy.playerEmpire!).at(-1)!.subject).toBe(lp[0]);

        expect(answerScenarioDecision(g, d.id, 'nope')).toBe(false);
        expect(answerScenarioDecision(g, d.id, 'pay')).toBe(true);
        expect(answerScenarioDecision(g, d.id, 'pay')).toBe(false);
        expect(resolved.at(-1)).toBe(`${game.playerEmpire.name}:pay`);

        const d2 = raiseScenarioDecision(g, game.playerEmpire, { kind: 'test.bribe', title: 'B', text: 'T', options: opts, defaultOption: 'refuse', expiresDays: 10 });
        g.nowMs += 10 * GAME_DAY_LENGTH;
        expireScenarioDecisions(g);
        expect(d2.answeredBy).toBe('expired');
        expect(resolved.at(-1)).toBe(`${game.playerEmpire.name}:refuse`);
    });
});
