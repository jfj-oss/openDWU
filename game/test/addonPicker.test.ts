// Add-on picker (src/sim/scenario/addons.ts; the wizard's Scenario page): dependencies derived from `include` (+
// `requires`), transitive closure with cycles cut, single vs composite start plans, the tick / lock UI model, the
// resolved switches, and the games: nothing ticked = the stock game byte for byte, one add-on = the old single-scenario
// start, the composite of ai-parity's set = ai-parity itself, and a composite save round trip.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame, inlineOverlay, scenarioGameData, scenarioIndexFs, scenarioOverlaysFs } from './helpers/scenarioGame';
import { tickGameOptions } from './helpers/tickGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import { createGame } from '../src/sim/game';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, savedScenarioId, savedScenarioInclude, serializeGame } from '../src/sim/save/gameSave';
import { defaultStartGameOptions, scenarioChoiceSummary, toCreateGameOptions, type StartScenarioChoice } from '../src/sim/startGameOptions';
import { parseScenarioManifest, type ScenarioManifest } from '../src/sim/scenario/manifest';
import type { ScenarioOverlay } from '../src/sim/scenario/overlay';
import {
    COMPOSITE_SCENARIO_ID,
    addonCatalog,
    addonClosure,
    addonCycles,
    addonPickerModel,
    addonStartOverlay,
    compositeOverlay,
    compositeScenarioManifest,
    planAddonStart,
    resolveAddonSwitches,
    scenarioOverlayFor,
    toggleAddon,
    type AddonCatalog,
} from '../src/sim/scenario/addons';
import { scenarioRuns } from '../src/sim/scenario/state';
import { parityFlags } from '../src/sim/scenario/llm/parity';
import { addonChoiceFor, firstSentence } from '../src/ui/screens/newGameWizard';

let base: GameData;
let cat: AddonCatalog;
let byId: Map<string, ScenarioOverlay>;
beforeAll(async () => {
    base = await loadGameDataFs();
    cat = addonCatalog(scenarioIndexFs());
    byId = scenarioOverlaysFs();
}, 120000);

const deps = (id: string) => cat.byId.get(id)!.deps.map((d) => `${d.id}:${d.kind}`);
const m = (o: Record<string, unknown>): ScenarioManifest => parseScenarioManifest(o);

function saveText(game: Game, scenario: StartScenarioChoice | null = null): string {
    const time = new GalaxyTime();
    time.togglePause();
    time.advance(game.galaxy.nowMs);
    return serializeGame(game, time, { ...defaultStartGameOptions(), seed: 1, scenario });
}

describe('dependencies derived from include / requires', () => {
    it('the repo index: include edges, data-only loads, no cycles', () => {
        expect(deps('timebomb')).toEqual(['cult:on', 'threat-framework:on']);
        expect(deps('robotmutiny')).toEqual(['darkfarms:data', 'threat-framework:on']);
        for (const t of ['cult', 'darkfarms', 'doppelgangers', 'greytide', 'hive', 'silence', 'exchange', 'ghostarmada', 'corporatecoup']) expect(deps(t)).toEqual(['threat-framework:on']);
        expect(deps('llm-layer')).toEqual(['event-log:on', 'threat-framework:on']);
        expect(deps('new-fauna')).toEqual(['rim-fauna:on']);
        expect(deps('independents-active')).toEqual(['rim-herders:data']);
        expect(addonCycles(cat)).toEqual([]);
        // Hidden infrastructure is in the catalog but never a row.
        for (const h of ['threat-framework', 'example', 'ai-parity']) expect(cat.byId.get(h)!.hidden).toBe(true);
        expect(cat.byId.get('art-bundle')!.hidden).toBe(false);
    });

    it('closure is transitive, deps-first, and a cycle is cut instead of looping', () => {
        expect(addonClosure(cat, ['frontier-autonomy'], 'on')).toEqual(expect.arrayContaining(['court-dynasties', 'internal-security', 'emergent', 'threat-framework', 'frontier-autonomy']));
        const on = addonClosure(cat, ['frontier-autonomy'], 'on');
        expect(on.indexOf('internal-security')).toBeLessThan(on.indexOf('court-dynasties'));
        expect(on).not.toContain('cult'); // data-only for internal-security
        expect(addonClosure(cat, ['frontier-autonomy'], 'all')).toContain('cult');
        const cyc = addonCatalog([m({ id: 'a', requires: ['b'] }), m({ id: 'b', include: ['c'] }), m({ id: 'c', requires: ['a'] })]);
        expect(addonClosure(cyc, ['a'])).toEqual(['c', 'b', 'a']);
        expect(addonCycles(cyc)).toEqual([['a', 'b', 'c', 'a']]);
        expect(() => m({ id: 'a', requires: ['a'] })).toThrow(/requires itself/);
        // Explicit `requires` counts as an "on" dependency and is only in the parsed manifest when present.
        expect(addonCatalog([m({ id: 'x', requires: ['y'] }), m({ id: 'y' })]).byId.get('x')!.deps).toEqual([{ id: 'y', kind: 'on' }]);
        expect('requires' in m({ id: 'z' })).toBe(false);
    });
});

describe('start plan', () => {
    it('stock / single / composite', () => {
        expect(planAddonStart(cat, [])).toBeNull();
        expect(planAddonStart(cat, ['cult'])).toEqual({ kind: 'single', id: 'cult' });
        expect(planAddonStart(cat, ['timebomb'])).toEqual({ kind: 'single', id: 'timebomb' });
        expect(planAddonStart(cat, ['cult', 'timebomb'])).toEqual({ kind: 'single', id: 'timebomb' });
        expect(planAddonStart(cat, ['robotmutiny'])).toEqual({ kind: 'single', id: 'robotmutiny' });
        const p = planAddonStart(cat, ['hive', 'cult']);
        expect(p?.kind).toBe('composite');
        if (p?.kind !== 'composite') return;
        expect(p.id).toBe(COMPOSITE_SCENARIO_ID);
        expect(p.manifest.include).toEqual(['threat-framework', 'cult', 'hive']); // canonical order, deps first
        expect(p.manifest.name).toBe('Add-ons: The Cult, The Hive');
        // A composite has every package in its direct include, so the direct-include gate sees them all.
        const gd = scenarioGameData(base, compositeOverlay(p.manifest, byId));
        expect(gd.scenario!.manifest.include).toEqual(['threat-framework', 'cult', 'hive']);
        expect(gd.scenario!.manifest.flags.map((f) => f.name).sort()).toEqual(['cult', 'hive']);
        // Explicit requires outside the include tree forces a composite.
        const rq = addonCatalog([m({ id: 'x', requires: ['y'] }), m({ id: 'y' })]);
        expect(planAddonStart(rq, ['x'])?.kind).toBe('composite');
    });

    it('resolved switches: masters of running add-ons on, data-only ones off, overrides never over a master', () => {
        const t = resolveAddonSwitches(cat, ['timebomb']);
        expect(t.flags).toMatchObject({ threatTimeBomb: true, cult: true });
        const r = resolveAddonSwitches(cat, ['robotmutiny'], { flags: { darkFarms: true, threatRobotMutiny: false, darkFarmsGameEnd: false }, params: { mutinyYear: 3 } });
        expect(r.flags).toMatchObject({ threatRobotMutiny: true, darkFarms: false, darkFarmsGameEnd: false });
        expect(r.params.mutinyYear).toBe(3);
        // Independents' own override of the bundled herders (off) wins, as in the nested include merge ...
        expect(resolveAddonSwitches(cat, ['independents-active']).flags).toMatchObject({ independentActors: true, rimHerders: false, rimFauna: false });
        // ... unless the herders are ticked too.
        expect(resolveAddonSwitches(cat, ['independents-active', 'rim-herders']).flags).toMatchObject({ rimHerders: true, rimFauna: true });
    });
});

describe('picker UI model (tick / lock)', () => {
    const row = (picked: string[], id: string) => addonPickerModel(cat, picked).groups.flatMap((g) => g.rows).find((r) => r.id === id)!;

    it('ticking an add-on ticks and locks its requirements; they cannot be unticked while needed', () => {
        let picked = toggleAddon(cat, [], 'timebomb', true);
        expect(picked).toEqual(['timebomb']);
        const cult = row(picked, 'cult');
        expect(cult).toMatchObject({ checked: true, locked: true, disabled: true, requiredBy: ['Time-Bomb Tech'], tooltip: 'needed by Time-Bomb Tech' });
        expect(row(picked, 'timebomb')).toMatchObject({ checked: true, locked: false, needs: ['The Cult'] });
        expect(toggleAddon(cat, picked, 'cult', false)).toEqual(['timebomb']); // refused
        // Ticking it explicitly too keeps it after the dependent goes.
        picked = toggleAddon(cat, picked, 'cult', true);
        expect(picked).toEqual(['timebomb']); // already running: no change
        picked = toggleAddon(cat, picked, 'timebomb', false);
        expect(picked).toEqual([]);
        expect(row(picked, 'cult')).toMatchObject({ checked: false, locked: false, disabled: false, requiredBy: [] });
        expect(addonPickerModel(cat, []).summary).toBe('None (the original game)');
    });

    it('data-only loads, hidden infrastructure, groups, summary, panels', () => {
        const model = addonPickerModel(cat, ['robotmutiny', 'new-fauna']);
        const rows = model.groups.flatMap((g) => g.rows);
        expect(rows.some((r) => r.id === 'threat-framework' || r.id === 'ai-parity' || r.id === 'example')).toBe(false);
        expect(row(['robotmutiny'], 'darkfarms')).toMatchObject({ checked: false, locked: false, loadedFor: ['Robot Mutiny'] });
        expect(row(['robotmutiny'], 'robotmutiny').loads).toEqual(['Dark Farms']);
        expect(row([], 'robotmutiny').needs).toEqual([]); // the framework is hidden
        expect(model.finalNames).toEqual(['New Fauna', 'Rim Fauna', 'Robot Mutiny']);
        expect(model.summary).toBe('New Fauna, Rim Fauna, Robot Mutiny');
        expect(model.panels).toEqual(expect.arrayContaining(['threat-framework', 'robotmutiny', 'new-fauna', 'rim-fauna']));
        expect(model.groups.map((g) => g.group)).toEqual(['Rim', 'Hidden threats', 'Politics & court', 'Economy & factions', 'LLM layer', 'Visuals']);
        expect(scenarioChoiceSummary(addonChoiceFor(cat, ['robotmutiny', 'new-fauna'], { flags: {}, params: {} }), scenarioIndexFs())).toBe('New Fauna, Rim Fauna, Robot Mutiny');
        expect(firstSentence('End-game hidden threat. A creed spreads. More.')).toBe('End-game hidden threat. A creed spreads.');
    });

    it('conflicts grey the other side out and refuse the tick', () => {
        const c = addonCatalog([m({ id: 'a', conflicts: ['b'] }), m({ id: 'b' }), m({ id: 'c', include: ['b'] })]);
        const rows = addonPickerModel(c, ['a']).groups.flatMap((g) => g.rows);
        expect(rows.find((r) => r.id === 'b')).toMatchObject({ disabled: true, conflictsWith: ['a'], tooltip: 'conflicts with a' });
        expect(toggleAddon(c, ['a'], 'b', true)).toEqual(['a']);
        expect(toggleAddon(c, ['a'], 'c', true)).toEqual(['a']); // c needs b
        expect(toggleAddon(c, ['b'], 'a', true)).toEqual(['b']);
    });
});

describe('games', () => {
    it('nothing ticked is byte-identical to the stock game', () => {
        const choice = addonChoiceFor(cat, [], { flags: {}, params: {} });
        expect(choice).toBeNull();
        expect(addonStartOverlay(cat, [], byId)).toBeNull();
        const start = { ...defaultStartGameOptions(), seed: 7 };
        const stockOpts = toCreateGameOptions(start, base, ['A']);
        expect(toCreateGameOptions({ ...start, scenario: choice }, base, ['A'])).toEqual(stockOpts);
        const stock = createGame(tickGameOptions(base));
        const picked = createGame({ ...tickGameOptions(base), ...(choice != null ? { scenarioFlags: choice.flags, scenarioParams: choice.params } : {}) });
        runGameSeconds(stock, 20);
        runGameSeconds(picked, 20);
        expect(saveText(picked, choice)).toBe(saveText(stock, null));
    }, 600000);

    it('one add-on starts exactly as the old single-scenario start', () => {
        for (const id of ['timebomb', 'wreckage-salvage']) {
            const choice = addonChoiceFor(cat, [id], { flags: {}, params: {} })!;
            expect(choice.id).toBe(id);
            const overlay = addonStartOverlay(cat, [id], byId)!;
            const now = createScenarioGame(base, { scenario: overlay, flags: choice.flags, params: choice.params }).game;
            const old = createScenarioGame(base, { scenario: id, flags: choice.flags, params: choice.params }).game;
            runGameSeconds(now, 20);
            runGameSeconds(old, 20);
            expect(saveText(now)).toBe(saveText(old));
        }
        // With a default-on master, the picker's switches are the old manifest defaults exactly.
        const gd = scenarioGameData(base, 'wreckage-salvage');
        const defaults = Object.fromEntries(gd.scenario!.manifest.flags.map((f) => [f.name, f.default]));
        expect(resolveAddonSwitches(cat, ['wreckage-salvage']).flags).toEqual(defaults);
    }, 600000);

    it('the composite of ai-parity’s set runs the same game as ai-parity', () => {
        const parity = scenarioGameData(base, 'ai-parity');
        const flags = parityFlags(parity.scenario!.manifest.flags);
        const set = cat.manifests.get('ai-parity')!.include;
        const comp = compositeScenarioManifest(cat, set);
        const a = createScenarioGame(base, { scenario: 'ai-parity', flags }).game;
        const b = createScenarioGame(base, { scenario: compositeOverlay(comp, byId), flags }).game;
        expect(b.galaxy.scenario!.id).toBe(COMPOSITE_SCENARIO_ID);
        expect(b.galaxy.scenario!.flags).toEqual(a.galaxy.scenario!.flags);
        expect(b.galaxy.scenario!.params).toEqual(a.galaxy.scenario!.params);
        for (const id of ['lively-galaxy', 'threat-framework']) expect(scenarioRuns(b.galaxy.scenario, id)).toBe(true);
        expect(stateDigest(b.galaxy)).toBe(stateDigest(a.galaxy));
        runGameSeconds(a, 60);
        runGameSeconds(b, 60);
        expect(stateDigest(b.galaxy)).toBe(stateDigest(a.galaxy));
        expect(b.galaxy.rnd.drawCount).toBe(a.galaxy.rnd.drawCount);
    }, 1200000);

    it('a composite game saves, reloads from its add-on list and re-saves byte-identically', () => {
        const picked = ['hive', 'cult'];
        const choice = addonChoiceFor(cat, picked, { flags: {}, params: { hiveMinNodes: 2 } })!;
        expect(choice.id).toBe(COMPOSITE_SCENARIO_ID);
        expect(choice.addons).toEqual(['cult', 'hive']);
        const { game, gameData } = createScenarioGame(base, { scenario: addonStartOverlay(cat, picked, byId)!, flags: choice.flags, params: choice.params });
        expect(game.galaxy.scenario!.params.hiveMinNodes).toBe(2);
        runGameSeconds(game, 10);
        const text = saveText(game, choice);
        expect(savedScenarioId(text)).toBe(COMPOSITE_SCENARIO_ID);
        expect(savedScenarioInclude(text)).toEqual(['threat-framework', 'cult', 'hive']);
        const data = scenarioGameData(base, scenarioOverlayFor(COMPOSITE_SCENARIO_ID, savedScenarioInclude(text), byId));
        expect(data.scenario!.manifest.include).toEqual(gameData.scenario!.manifest.include);
        const loaded = deserializeGame(text, data);
        expect(loaded.startOptions.scenario).toEqual(choice);
        expect(saveText(loaded.game, loaded.startOptions.scenario ?? null)).toBe(text);
        // Another add-on set (or a single scenario's data) refuses it.
        expect(() => deserializeGame(text, scenarioGameData(base, scenarioOverlayFor(COMPOSITE_SCENARIO_ID, ['threat-framework', 'cult'], byId)))).toThrow(/add-ons/);
        expect(() => deserializeGame(text, scenarioGameData(base, 'cult'))).toThrow(/scenario/);
        // An inline overlay with no include still works through the single path.
        expect(scenarioOverlayFor('x', null, new Map([['x', inlineOverlay({ id: 'x' })]])).manifest.id).toBe('x');
    }, 600000);
});
