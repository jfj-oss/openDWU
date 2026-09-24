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
import { parseSystemNames } from './sim/data';
import { GalaxyShape } from './sim/types';
import { createHud, layoutHud, nearestSystemName, type HudRefs } from './ui/hud';
import { GalaxyTime } from './sim/clock';
import { START_STAR_DATE } from './sim/galaxyTime';
import { formatClockLabel, SYSTEM_LEVEL_ZOOM, type Selection } from './ui/hud';
import { Habitat, HabitatCategoryType } from './sim/types';
import { createMapOverlayState } from './ui/mapOverlays';
import { createMainMenu } from './ui/screens/mainMenu';
import { createNewGameWizard } from './ui/screens/newGameWizard';
import { createGalaxyMap } from './ui/screens/galaxyMap';
import { sectorsFor, starCountFor, type StartGameOptions } from './sim/startGameOptions';
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
const SKIP_MENU_PARAMS = ['seed', 'shape', 'stars', 'zoom', 'cx', 'cy', 'skipMenu'];

/** Open the new-game wizard (task 06b), replacing the main menu. Start Game
 * maps the chosen StartGameOptions to generateGalaxy's options and boots. */
function openWizard(onBackToMenu: () => void): void {
    const wizard = createNewGameWizard({
        onBackToMenu: () => {
            wizard.destroy();
            onBackToMenu();
        },
        onStartGame: (options: StartGameOptions) => {
            wizard.destroy();
            void bootGameWithOptions({
                seed: options.seed,
                shape: options.shape,
                starCount: starCountFor(options.starCountIndex),
                sectorWidth: sectorsFor(options.dimensionIndex),
                sectorHeight: sectorsFor(options.dimensionIndex),
                zoom: null,
                cx: null,
                cy: null,
            });
        },
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
    };
}

async function bootGame(params: URLSearchParams): Promise<void> {
    await bootGameWithOptions(parseBootOptions(params));
}

async function bootGameWithOptions(opts: BootOptions): Promise<void> {
    const { seed, shape, starCount, sectorWidth, sectorHeight, zoom: zoomParam, cx, cy } = opts;

    const dwuPresent = await detectDwuPresent();
    const systemNames = await loadSystemNames(dwuPresent);
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
    const galaxy = generateGalaxy({
        seed,
        shape,
        starCount: starCount,
        sectorWidth,
        sectorHeight,
        systemNames,
    });

    const camera = new Camera();
    camera.setViewport(app.renderer.width, app.renderer.height);
    camera.setGalaxyBounds(galaxy.sizeX, galaxy.sizeY);
    if (cx !== null && cy !== null) {
        camera.centerOn(cx, cy);
    } else {
        camera.centerOn(galaxy.sizeX / 2, galaxy.sizeY / 2);
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
    const debugHook: Record<string, unknown> = { camera, galaxy, view, app };
    (window as unknown as { __dwu?: unknown }).__dwu = debugHook;

    // Task 07b: the compact top-left bar drives the galaxy-time clock
    // (GalaxyTime, starts paused at 1x per the original); the bottom-right
    // list drives the camera and overlay toggles; the selection panel is
    // refreshed as the camera moves (demo: nearest star/planet to the view
    // centre).
    const time = new GalaxyTime(START_STAR_DATE);
    const overlays = createMapOverlayState();
    // Task C3: Galaxy Map screen (G key / HUD "Galaxy map (G)" row).
    const galaxyMap = createGalaxyMap({
        galaxy,
        getViewRect: () => {
            const tl = camera.screenToWorld(0, 0);
            const br = camera.screenToWorld(camera.width, camera.height);
            return { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y };
        },
        jumpTo: (x, y) => camera.centerOn(x, y),
    });
    document.body.appendChild(galaxyMap.element);
    debugHook.galaxyMap = galaxyMap;
    const hud: HudRefs = createHud({ clock: time, overlays, camera, galaxy, onGalaxyMap: () => galaxyMap.toggle() });
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

    // Spacebar toggles play/pause (streamlined HUD control set).
    window.addEventListener('keydown', (e: KeyboardEvent) => {
        if ((e.code === 'KeyG' && e.target === document.body) || (e.code === 'Escape' && galaxyMap.isOpen)) {
            e.preventDefault();
            if (e.code === 'Escape') galaxyMap.close();
            else galaxyMap.toggle();
            return;
        }
        if (e.code === 'Space' && e.target === document.body) {
            e.preventDefault();
            time.togglePause();
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