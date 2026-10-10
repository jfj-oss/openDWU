// Sim worker: how the worker gets its game (docs/sim-worker.md §5, §9 chunk 1) — create (wizard / autostart / tutorial),
// load (a save's text, or a URL the worker fetches itself) and generate (main.ts bootGameWithOptions without
// ?autostart: a bare generateGalaxy). DOM-free and transport-free: worker.ts passes fetch-based data loaders, the tests
// pass fs-loaded ones.
//
// A load is parsed here, once, and only here: the worker reads the save's scenario (savedScenarioId / Include) from the
// parsed object, builds its data with that overlay, and deserializes the same object. The main thread no longer parses
// the save (a late-game save is 100+ MB of JSON, seconds of a frozen tab); it learns the scenario from the snapshot
// (SnapshotMessage.scenario) and builds its replica's static data from that.
// No DOM / Pixi imports.

import { activeCustomizationSetName } from '../sim/data/customization';
import type { GameData } from '../sim/data/gameData';
import { createGameSteps, installGameStatics, registerGameHooks, type Game } from '../sim/game';
import { generateGalaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { GalaxyTime } from '../sim/galaxyTime';
import { deserializeGame, savedCustomizationSet, savedScenarioId, savedScenarioInclude, type GameSaveJSON } from '../sim/save/gameSave';
import type { StartGameOptions } from '../sim/startGameOptions';
import { applyScenarioOverlay, type ScenarioOverlay } from '../sim/scenario/overlay';
import { COMPOSITE_SCENARIO_ID, addonCatalog, planSaveAddonAddition, scenarioOverlayFor } from '../sim/scenario/addons';
import { reviveCreateOptions } from './bootOptions';
import { saveTextString } from '../saveData';
import type { ScenarioRef, WorkerBoot } from './protocol';

export interface WorkerBootDeps {
    /** The base DW:U data (no scenario). */
    baseData(): Promise<GameData>;
    /** Every scenario overlay of the index, by id (only asked for when the game has a scenario). */
    overlays(): Promise<ReadonlyMap<string, ScenarioOverlay>>;
    /** A save by URL (load boots with `url`). */
    fetchSave?(url: string): Promise<string>;
    progress?(step: string, fraction: number): void;
    now?(): number;
}

export interface BootedGame {
    game: Game;
    time: GalaxyTime;
    gameData: GameData;
    scenario: ScenarioRef;
    /** A loaded save's start options (create / generate: the init message's). */
    startOptions: StartGameOptions | null;
}

/** The base data with a scenario's overlay, as main.ts gameDataWithScenario builds it (same error text). */
export async function scenarioGameData(deps: WorkerBootDeps, scenario: ScenarioRef): Promise<GameData> {
    const base = await deps.baseData();
    if (scenario === null) return base;
    try {
        return applyScenarioOverlay(base, scenarioOverlayFor(scenario.id, scenario.include, await deps.overlays()));
    } catch (err) {
        throw new Error(`Scenario "${scenario.id}" is not available; cannot load this game. (${err instanceof Error ? err.message : String(err)})`);
    }
}

/** A parsed save's scenario (the composite add-on list only for a composite game, as main.ts gameDataForSave reads it). */
export function saveScenarioRef(save: GameSaveJSON): ScenarioRef {
    const id = savedScenarioId(save);
    return id === null ? null : { id, include: id === COMPOSITE_SCENARIO_ID ? savedScenarioInclude(save) : null };
}

/** Build the worker's game for `boot`. */
export async function bootWorkerGame(boot: WorkerBoot, deps: WorkerBootDeps): Promise<BootedGame> {
    const progress = deps.progress ?? (() => undefined);
    const now = deps.now ?? (() => performance.now());
    if (boot.kind === 'create') {
        progress('Loading game data', 0);
        const gameData = await scenarioGameData(deps, boot.scenario);
        installGameStatics(gameData);
        registerGameHooks();
        const steps = createGameSteps(reviveCreateOptions(boot.options, gameData));
        let game: Game;
        let lastPost = -Infinity;
        for (;;) {
            const r = steps.next();
            if (r.done === true) {
                game = r.value;
                break;
            }
            if (now() - lastPost > 50) {
                lastPost = now();
                progress(r.value.step, r.value.fraction);
            }
        }
        return { game, time: new GalaxyTime(), gameData, scenario: boot.scenario, startOptions: null };
    }
    if (boot.kind === 'generate') {
        // As main.ts bootGameWithOptions in-thread: generateGalaxy with the base data, no game statics / hooks.
        progress('Loading game data', 0);
        const gameData = await deps.baseData();
        progress('Creating galaxy', 0.2);
        const galaxy = generateGalaxy({ ...boot.options, gameData });
        const game: Game = { galaxy, playerEmpire: galaxy.playerEmpire as Empire, viewX: boot.viewX, viewY: boot.viewY };
        return { game, time: new GalaxyTime(), gameData, scenario: null, startOptions: null };
    }
    // Load.
    let text = boot.text;
    if (text === undefined && boot.blob !== undefined) {
        // A gzip save is inflated here, in the worker, as a stream (saveData.ts); an older plain one is read as before.
        text = await saveTextString(boot.blob);
        boot.blob = undefined;
    }
    if (text === undefined) {
        if (boot.url === undefined) throw new Error('load boot without a save (text or url)');
        if (deps.fetchSave === undefined) throw new Error('load boot by url: no fetch');
        progress('Downloading save', 0);
        text = await deps.fetchSave(boot.url);
    }
    progress(`Reading save (${Math.max(1, Math.round(text.length / 1048576))} MB)`, 0.05);
    let save: GameSaveJSON;
    try {
        save = JSON.parse(text) as GameSaveJSON;
    } catch (err) {
        throw new Error(`Not a save file: ${err instanceof Error ? err.message : String(err)}`);
    }
    // The message is consumed: drop both references to the text so it can be collected while the game is rebuilt.
    text = undefined;
    boot.text = undefined;
    const savedScenario = saveScenarioRef(save);
    // Adding add-ons (the Load screen's picker): the combined set, planned from the save's own scenario.
    const addAddons = boot.addAddons !== undefined && boot.addAddons.length > 0 ? planSaveAddonAddition(addonCatalog([...(await deps.overlays()).values()].map((o) => o.manifest)), { id: savedScenario?.id ?? null, include: savedScenario?.include ?? null }, boot.addAddons) : undefined;
    const scenario: ScenarioRef = addAddons !== undefined ? { id: addAddons.to.id, include: addAddons.to.include } : savedScenario;
    // The main thread switches to a save's theme before booting the worker on it (main.ts loadSaveWithProgress,
    // Start.cs 1777); a save fetched here by URL can still name another one: its tables would not match this data.
    const saveTheme = savedCustomizationSet(save);
    if (saveTheme !== activeCustomizationSetName()) {
        throw new Error(`This game was saved with the ${saveTheme === '' ? '(Default)' : `"${saveTheme}"`} theme; switch to it (Change Theme) to load it.`);
    }
    progress('Loading game data', 0.25);
    const gameData = await scenarioGameData(deps, scenario);
    // main.ts gameDataForSave: the static tables and hooks createGame installs.
    installGameStatics(gameData);
    registerGameHooks();
    progress('Rebuilding galaxy', 0.35);
    const loaded = addAddons !== undefined ? deserializeGame(save, gameData, { addAddons }) : deserializeGame(save, gameData);
    return { game: loaded.game, time: loaded.time, gameData, scenario, startOptions: loaded.startOptions };
}
