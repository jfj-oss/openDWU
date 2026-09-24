// Boot: create the PixiJS app, generate the galaxy from URL parameters
// (?seed=, ?shape=, ?stars=, ?zoom=, ?cx=, ?cy=) and start the Main View.
// All DW:U data/art is fetched by URL from /assets/dwu/... (mapped to the
// install folder by the desktop shell; under `npm run dev` a public symlink
// plus the probe middleware in vite.config.ts does the same).

import { Application } from 'pixi.js';
import { Camera } from './render/camera';
import { MainView } from './render/mainView';
import { AssetStore, loadManifest } from './render/assets';
import { generateGalaxy } from './sim/galaxy';
import { Galaxy } from './sim/galaxy';
import { createGame, type CreateGameOptions } from './sim/game';
import { parseSystemNames } from './sim/data';
import { loadGameData, type FetchText, type GameData } from './sim/data/gameData';
import { GalaxyShape } from './sim/types';
import { createHud, layoutHud, nearestSystemName, type HudRefs } from './ui/hud';
import { GalaxyTime } from './sim/clock';
import { START_STAR_DATE } from './sim/galaxyTime';
import { formatClockLabel, SYSTEM_LEVEL_ZOOM, type Selection } from './ui/hud';
import { Habitat, HabitatCategoryType } from './sim/types';
import { createMapOverlayState } from './ui/mapOverlays';
import { buildDefaultHandlers, createShortcutsOverlay, dispatchKey } from './ui/keyboard';
import { createMainMenu } from './ui/screens/mainMenu';
import { startMusic } from './audio/musicPlayer';
import { createNewGameWizard } from './ui/screens/newGameWizard';
import { toCreateGameOptions, type StartGameOptions } from './sim/startGameOptions';
import { type Game } from './sim/game';
import './ui/hud.css';

// ?shape= names accepted by the boot URL.
const SHAPE_BY_NAME: Record<string, GalaxyShape> = {
    spiral: GalaxyShape.Spiral,
    elliptical: GalaxyShape.Elliptical,
    irregular: GalaxyShape.Irregular,
    ring: GalaxyShape.Ring,
    clustereven: GalaxyShape.ClustersEven,
    clustersvaried: GalaxyShape.ClustersVaried,
};

// Used when no DW:U install (systemNames.txt) is available so generation
// still runs with plausible names.
const FALLBACK_SYSTEM_NAMES = [
    'Aldra', 'Borin', 'Cathis', 'Dravos', 'Eltan', 'Fennra', 'Ghoris', 'Halvard',
    'Iskren', 'Jovara', 'Keldris', 'Lumien', 'Morvath', 'Nethis', 'Ostara', 'Pellin',
    'Quarion', 'Raventh', 'Solvane', 'Thessik', 'Ulmaran', 'Vindemi', 'Wyrnhol', 'Xanthea',
    'Yorvane', 'Zarell', 'Anthis', 'Brakka', 'Cordelis', 'Drenn', 'Erynd', 'Fellmar',
    'Gryvanne', 'Hordath', 'Ilyra', 'Jorvane', 'Kaldris', 'Lynthea', 'Mordath', 'Nyrvane',
    'Orvallis', 'Quendrin', 'Rethalis', 'Silvarin', 'Torvane', 'Undris', 'Vellora', 'Wynthal',
    'Xalvane', 'Yorvath', 'Zelindra', 'Aldrenna', 'Brythas', 'Caelvane', 'Dorvane', 'Elthyr',
    'Feldris', 'Gravenne', 'Iskval', 'Jorvane II', 'Keltharis', 'Lorvane', 'Melthas', 'Nyrthala',
];

/** Probe whether a DW:U install (original data/art) is reachable. */
async function detectDwuPresent(): Promise<boolean> {
    try {
        // Dev server: dedicated probe middleware (vite.config.ts).
        const r = await fetch('/assets/dwu/__dwu_probe');
        if (r.ok) {
            const j = (await r.json()) as { present: boolean };
            return j.present;
        }
    } catch {
        // no probe endpoint (built desktop shell)
    }
    try {
        // Built shell: probe a data file directly.
        return (await fetch('/assets/dwu/systemNames.txt')).ok;
    } catch {
        return false;
    }
}

/**
 * Load the system name list from systemNames.txt. Port of Galaxy.4.cs
 * LoadSystemNames: lines starting with `'` are comments; each other line is
 * a comma-separated list of names (with a trailing comma), trimmed, empties
 * dropped. (The file is NOT one-name-per-line.)
 */
async function loadSystemNames(dwuPresent: boolean): Promise<string[]> {
    if (dwuPresent) {
        try {
            const text = await (await fetch('/assets/dwu/systemNames.txt')).text();
            const names = parseSystemNames(text);
            if (names.length > 0) {
                return names;
            }
        } catch {
            // fall through to the fallback list
        }
    }
    return FALLBACK_SYSTEM_NAMES;
}

/** Keys that, when present on the boot URL, skip the main menu and boot
 * straight into the game (keeps screenshot scripts / dev links working). */
const SKIP_MENU_PARAMS = ['seed', 'shape', 'stars', 'zoom', 'cx', 'cy', 'select', 'skipMenu', 'autostart'];

/** FetchText for the browser: try each candidate URL in order. */
const fetchTextBrowser: FetchText = async (candidates: string[]): Promise<string> => {
    for (const url of candidates) {
        try {
            const r = await fetch(url);
            if (r.ok) {
                return await r.text();
            }
        } catch {
            // try the next candidate
        }
    }
    throw new Error(`Could not load any of: ${candidates.join(', ')}`);
};

/** Load all parsed DW:U data (resources, races, ...) when an install is
 * reachable; null otherwise so generation falls back to no resources. */
async function loadGameDataOrNone(dwuPresent: boolean): Promise<GameData | null> {
    if (!dwuPresent) return null;
    try {
        return await loadGameData(fetchTextBrowser);
    } catch (err) {
        console.warn('DW:U game data failed to load; continuing without it', err);
        return null;
    }
}

/** Open the new-game wizard (task 06b), replacing the main menu. Start Game
 * maps the chosen StartGameOptions onto createGame's options and boots the
 * Main View + HUD with the returned galaxy/empires (task 06i). */
function openWizard(onBackToMenu: () => void): void {
    const wizard = createNewGameWizard({
        onBackToMenu: () => {
            wizard.destroy();
            onBackToMenu();
        },
        onStartGame: (options: StartGameOptions) => {
            wizard.destroy();
            void bootGameFromWizard(options);
        },
    });
}

/** Task 06i: boot from the wizard's StartGameOptions via createGame (galaxy +
 * player/AI empires + starting colonies), then the Main View + HUD. The URL-
 * param boot path (bootGameWithOptions) still uses generateGalaxy only. */
async function bootGameFromWizard(startOptions: StartGameOptions): Promise<void> {
    const dwuPresent = await detectDwuPresent();
    const systemNames = await loadSystemNames(dwuPresent);
    const gameData = await loadGameDataOrNone(dwuPresent);
    // Real-art file lists (scripts/gen-asset-manifest.mjs, predev/prebuild).
    if (dwuPresent) {
        await loadManifest();
    }

    const app = new Application();
    await app.init({
        resizeTo: window,
        background: 0x000000,
        antialias: true,
        preference: 'webgl',
    });
    document.body.appendChild(app.canvas);

    // createGame needs full game data (races/governments); without a DW:U
    // install there is no fallback, so report it rather than booting broken.
    if (gameData === null) {
        console.error('DW:U game data is required to start a game from the wizard but failed to load.');
        return;
    }

    const game: Game = createGame(toCreateGameOptions(startOptions, gameData, systemNames));
    const galaxy = game.galaxy;

    const camera = new Camera();
    camera.setViewport(app.renderer.width, app.renderer.height);
    camera.setGalaxyBounds(galaxy.sizeX, galaxy.sizeY);
    // Centre on the player's capital (createGame returns viewX/viewY).
    camera.centerOn(game.viewX, game.viewY);
    camera.zoom = camera.minZoom;

    const store = new AssetStore(dwuPresent);
    const view = new MainView(app, camera, galaxy, store);
    await view.init();

    // Debug / screenshot hook: the created game (galaxy + player empire).
    (window as unknown as { __dwu?: unknown }).__dwu = { camera, galaxy, view, app, game };

    const time = new GalaxyTime(START_STAR_DATE);
    const overlays = createMapOverlayState();
    const hud: HudRefs = createHud({ clock: time, overlays, camera, galaxy, gameData });
    const systemNameEl = hud.elements.get('pnlMoney')?.querySelector('.hud-system-name');
    const dateEl = hud.elements.get('pnlTopLeftBar')?.querySelector('.hud-date');
    const pauseBtn = hud.elements.get('pnlTopLeftBar')?.querySelector<HTMLButtonElement>('button[title="Play / pause"]');
    const setSelection = (h: Habitat | null): void => {
        if (h === null) {
            hud.onSelectionChange?.(null);
            return;
        }
        const system = galaxy.systems.find((s) => s.habitats.includes(h)) ?? galaxy.systems[h.systemIndex];
        const sel: Selection = { habitat: h, system };
        hud.onSelectionChange?.(sel);
    };
    view.onSelectionChange = setSelection;
    view.onDoubleClickStar = (star: Habitat) => {
        if (star.category !== HabitatCategoryType.Star) return;
        camera.centerOn(star.xpos, star.ypos);
        camera.zoomAt(SYSTEM_LEVEL_ZOOM, camera.width / 2, camera.height / 2);
    };
    const refreshHud = (): void => {
        if (systemNameEl) {
            systemNameEl.textContent = nearestSystemName(
                { galaxy },
                camera,
            );
        }
    };
    refreshHud();
    window.addEventListener('resize', () => layoutHud(hud));
    setInterval(refreshHud, 250);
    const refreshClockLabel = (): void => {
        if (dateEl) {
            dateEl.textContent = formatClockLabel(time.currentStarDate, time.speed);
        }
        if (pauseBtn) {
            pauseBtn.textContent = time.paused ? '▶' : '⏸';
        }
    };
    setInterval(refreshClockLabel, 250);

    const shortcuts = createShortcutsOverlay();
    const keyHandlers = buildDefaultHandlers(camera, time);
    window.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === '?' || e.key === 'F1') {
            e.preventDefault();
            shortcuts.toggle();
            return;
        }
        const action = dispatchKey(e, keyHandlers);
        if (action === 'togglePause' || action === 'speedUp' || action === 'speedDown') {
            refreshClockLabel();
        }
    });

    app.ticker.add(() => {
        const gameMs = time.advance(app.ticker.deltaMS);
        if (gameMs > 0) {
            galaxy.step(gameMs);
        }
        view.update();
    });
    app.renderer.on('resize', () => {
        camera.setViewport(app.renderer.width, app.renderer.height);
        layoutHud(hud);
    });
}

async function main(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const skipMenu = SKIP_MENU_PARAMS.some((k) => params.has(k));

    if (params.get('screen') === 'wizard') {
        // Screenshot / dev hook (task 06b): jump straight to the wizard.
        openWizard(() => {
            // Nothing to go back to when opened directly; reload to the menu.
            window.location.search = '';
        });
        return;
    }

    if (!skipMenu) {
        showMainMenu();
        return;
    }

    await bootGame(params);
}

/** Show the main menu; Start New Game opens the wizard, whose back button
 * returns here. */
function showMainMenu(): void {
    const menu = createMainMenu({
        onStartNewGame: () => {
            menu.destroy();
            openWizard(showMainMenu);
        },
    });
    startMusic();
}

/** Fully-resolved options to start a game (from the boot URL or the wizard). */
interface BootOptions {
    seed: number;
    shape: GalaxyShape;
    starCount: number;
    sectorWidth: number;
    sectorHeight: number;
    zoom: number | null;
    cx: number | null;
    cy: number | null;
    /** ?select=<habitat name>: select that habitat on boot (screenshots). */
    select: string | null;
}

/** Parse `bootGame`'s URL-param path into a BootOptions (task 06a defaults:
 * seed=1, spiral, 700 stars, 4x4 sectors). */
function parseBootOptions(params: URLSearchParams): BootOptions {
    return {
        seed: parseInt(params.get('seed') ?? '1', 10) || 1,
        starCount: parseInt(params.get('stars') ?? '700', 10) || 700,
        shape: SHAPE_BY_NAME[params.get('shape') ?? 'spiral'] ?? GalaxyShape.Spiral,
        sectorWidth: 4,
        sectorHeight: 4,
        zoom: params.get('zoom') !== null ? parseFloat(params.get('zoom')!) : null,
        cx: params.get('cx') !== null ? parseFloat(params.get('cx')!) : null,
        cy: params.get('cy') !== null ? parseFloat(params.get('cy')!) : null,
        select: params.get('select'),
    };
}

async function bootGame(params: URLSearchParams): Promise<void> {
    await bootGameWithOptions(parseBootOptions(params));
}

/** Task M2e: `?autostart=1` boots a full game via createGame (player + 3 AI
 * empires, defaults) instead of a bare generateGalaxy, so the Main View has
 * owned colonies to draw empire rings/territory for. */
function paramsHasAutostart(): boolean {
    return new URLSearchParams(window.location.search).has('autostart');
}

async function buildAutostartGame(
    seed: number,
    shape: GalaxyShape,
    starCount: number,
    sectorWidth: number,
    sectorHeight: number,
    systemNames: string[],
    gameData: GameData | null,
): Promise<{ galaxy: Galaxy; viewX: number; viewY: number } | null> {
    if (gameData === null) {
        console.warn('?autostart=1 needs DW:U game data (races/governments); falling back to generateGalaxy');
        return null;
    }
    const ai = { race: '(Random)', homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', age: 1, techLevel: 0 };
    const opts: CreateGameOptions = {
        seed,
        shape,
        starCount,
        sectorWidth,
        sectorHeight,
        systemNames,
        gameData,
        player: { race: 'Human', homeSystemFavourability: 'Normal', startLocation: '(Random)', age: 1, techLevel: 0 },
        aiEmpires: [ai, { ...ai }, { ...ai }],
    };
    try {
        const game = createGame(opts);
        return { galaxy: game.galaxy, viewX: game.viewX, viewY: game.viewY };
    } catch (err) {
        console.warn('?autostart=1 createGame failed; falling back to generateGalaxy', err);
        return null;
    }
}

async function bootGameWithOptions(opts: BootOptions): Promise<void> {
    const { seed, shape, starCount, sectorWidth, sectorHeight, zoom: zoomParam, cx, cy, select } = opts;

    const dwuPresent = await detectDwuPresent();
    const systemNames = await loadSystemNames(dwuPresent);
    const gameData = await loadGameDataOrNone(dwuPresent);
    // Real-art file lists (scripts/gen-asset-manifest.mjs, predev/prebuild).
    if (dwuPresent) {
        await loadManifest();
    }

    const app = new Application();
    await app.init({
        resizeTo: window,
        background: 0x000000,
        antialias: true,
        preference: 'webgl',
    });
    document.body.appendChild(app.canvas);

    // Deterministic galaxy (seed/shape/stars/sectors from the URL or wizard).
    // ?autostart=1 runs the full createGame (empires with colours + colonies);
    // otherwise a bare generateGalaxy.
    let galaxy = generateGalaxy({
        seed,
        shape,
        starCount: starCount,
        sectorWidth,
        sectorHeight,
        systemNames,
        gameData: gameData ?? undefined,
    });
    let viewX = galaxy.sizeX / 2;
    let viewY = galaxy.sizeY / 2;
    if (paramsHasAutostart()) {
        const started = await buildAutostartGame(seed, shape, starCount, sectorWidth, sectorHeight, systemNames, gameData);
        if (started !== null) {
            galaxy = started.galaxy;
            viewX = started.viewX;
            viewY = started.viewY;
        }
    }

    const camera = new Camera();
    camera.setViewport(app.renderer.width, app.renderer.height);
    camera.setGalaxyBounds(galaxy.sizeX, galaxy.sizeY);
    if (cx !== null && cy !== null) {
        camera.centerOn(cx, cy);
    } else {
        camera.centerOn(viewX, viewY);
    }
    if (zoomParam !== null) {
        // zoom >= 1 is the original zoom *factor* (reciprocal of px/unit);
        // zoom < 1 is a direct px/unit value.
        camera.zoom = camera.clampZoom(zoomParam >= 1 ? 1 / zoomParam : zoomParam);
    } else {
        // No ?zoom= : start at the whole-galaxy view.
        camera.zoom = camera.minZoom;
    }

    const store = new AssetStore(dwuPresent);
    const view = new MainView(app, camera, galaxy, store);
    await view.init();

    // Debug / screenshot hook: the camera and the generated galaxy model.
    (window as unknown as { __dwu?: unknown }).__dwu = { camera, galaxy, view, app };

    // Task 07b: the compact top-left bar drives the galaxy-time clock
    // (GalaxyTime, starts paused at 1x per the original); the bottom-right
    // list drives the camera and overlay toggles; the selection panel is
    // refreshed as the camera moves (demo: nearest star/planet to the view
    // centre).
    const time = new GalaxyTime(START_STAR_DATE);
    const overlays = createMapOverlayState();
    const hud: HudRefs = createHud({ clock: time, overlays, camera, galaxy, gameData: gameData ?? undefined });
    const systemNameEl = hud.elements.get('pnlMoney')?.querySelector('.hud-system-name');
    const dateEl = hud.elements.get('pnlTopLeftBar')?.querySelector('.hud-date');
    const pauseBtn = hud.elements.get('pnlTopLeftBar')?.querySelector<HTMLButtonElement>('button[title="Play / pause"]');
    // Task 08g: push a Main View pick (or null) to the HUD selection panel.
    const setSelection = (h: Habitat | null): void => {
        if (h === null) {
            hud.onSelectionChange?.(null);
            return;
        }
        const system = galaxy.systems.find((s) => s.habitats.includes(h)) ?? galaxy.systems[h.systemIndex];
        const sel: Selection = { habitat: h, system };
        hud.onSelectionChange?.(sel);
    };
    view.onSelectionChange = setSelection;
    // Task 10b: ?select=<habitat name> selects that habitat on boot (used by
    // screenshot scripts to show a filled-in selection panel).
    if (select !== null && select !== '') {
        const target = galaxy.habitats.find((h) => h.name === select);
        if (target) {
            camera.centerOn(target.xpos, target.ypos);
            setSelection(target);
        } else {
            console.warn(`?select=: no habitat named "${select}"`);
        }
    }
    // Double-click a star at galaxy/sector zoom -> System level centred on it.
    view.onDoubleClickStar = (star: Habitat) => {
        if (star.category !== HabitatCategoryType.Star) return;
        camera.centerOn(star.xpos, star.ypos);
        camera.zoomAt(SYSTEM_LEVEL_ZOOM, camera.width / 2, camera.height / 2);
    };
    const refreshHud = (): void => {
        if (systemNameEl) {
            systemNameEl.textContent = nearestSystemName(
                { galaxy },
                camera,
            );
        }
    };
    refreshHud();
    window.addEventListener('resize', () => layoutHud(hud));
    // The camera centre moves with panning/zooming; keep lblSystemName fresh.
    setInterval(refreshHud, 250);
    // Task 07b: keep the star-date label (and the play/pause glyph) fresh.
    const refreshClockLabel = (): void => {
        if (dateEl) {
            dateEl.textContent = formatClockLabel(time.currentStarDate, time.speed);
        }
        if (pauseBtn) {
            pauseBtn.textContent = time.paused ? '▶' : '⏸';
        }
    };
    setInterval(refreshClockLabel, 250);

    // Task 10a: the full original keyboard command table (UI_KeyboardCommands)
    // dispatches on keydown; it replaces the ad-hoc spacebar handler. '?' / F1
    // toggle the "Keyboard shortcuts" overlay listing the table.
    const shortcuts = createShortcutsOverlay();
    const keyHandlers = buildDefaultHandlers(camera, time);
    window.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === '?' || e.key === 'F1') {
            e.preventDefault();
            shortcuts.toggle();
            return;
        }
        const action = dispatchKey(e, keyHandlers);
        if (action === 'togglePause' || action === 'speedUp' || action === 'speedDown') {
            refreshClockLabel();
        }
    });

    // Task 07b: drive galaxy time each frame — advance the clock by real
    // time, then advance planet/moon orbits by the game ms advanced.
    app.ticker.add(() => {
        const gameMs = time.advance(app.ticker.deltaMS);
        if (gameMs > 0) {
            galaxy.step(gameMs);
        }
        view.update();
    });
    app.renderer.on('resize', () => {
        camera.setViewport(app.renderer.width, app.renderer.height);
        layoutHud(hud);
    });
}

main().catch((err) => {
    console.error('DW:U boot failed', err);
});