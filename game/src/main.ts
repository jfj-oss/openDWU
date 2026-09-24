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
import { createHud, layoutHud, nearestSystemName, pickSelection, type HudRefs } from './ui/hud';
import { GalaxyTime } from './sim/clock';
import { START_STAR_DATE } from './sim/galaxyTime';
import { formatClockLabel } from './ui/hud';
import { createMapOverlayState } from './ui/mapOverlays';
import { createMainMenu, shouldSkipMenu } from './ui/screens/mainMenu';
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

async function main(): Promise<void> {
    const params = new URLSearchParams(window.location.search);

    // Task 06a: show the main menu first; the galaxy/Main View/HUD are created
    // only after Start New Game. Any of ?seed/shape/stars/zoom/cx/cy/skipMenu
    // skips the menu and boots straight into the game (screenshot scripts).
    if (!shouldSkipMenu(window.location.search)) {
        const menu = createMainMenu(() => {
            menu.destroy();
            bootGame({ seed: Date.now() % 2147483647, starCount: 700 });
        });
        return;
    }

    const seed = parseInt(params.get('seed') ?? '1', 10) || 1;
    const starCount = parseInt(params.get('stars') ?? '700', 10) || 700;
    await bootGame({ seed, starCount, params });
}

/** Boot the game directly (menu skipped via URL params or Start New Game). */
async function bootGame(opts: {
    seed: number;
    starCount: number;
    params?: URLSearchParams;
}): Promise<void> {
    const params = opts.params ?? new URLSearchParams(window.location.search);
    const seed = opts.seed;
    const starCount = opts.starCount;
    const shape = SHAPE_BY_NAME[params.get('shape') ?? 'spiral'] ?? GalaxyShape.Spiral;
    const zoomParam = params.get('zoom') !== null ? parseFloat(params.get('zoom')!) : null;
    const cx = params.get('cx') !== null ? parseFloat(params.get('cx')!) : null;
    const cy = params.get('cy') !== null ? parseFloat(params.get('cy')!) : null;

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

    // Deterministic galaxy (seed/shape/stars from the URL, defaults per the
    // task: seed=1, spiral, 700 stars, 4x4 sectors).
    const galaxy = generateGalaxy({
        seed,
        shape,
        starCount: starCount,
        sectorWidth: 4,
        sectorHeight: 4,
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
    (window as unknown as { __dwu?: unknown }).__dwu = { camera, galaxy, view, app };

    // Task 07b: the compact top-left bar drives the galaxy-time clock
    // (GalaxyTime, starts paused at 1x per the original); the bottom-right
    // list drives the camera and overlay toggles; the selection panel is
    // refreshed as the camera moves (demo: nearest star/planet to the view
    // centre).
    const time = new GalaxyTime(START_STAR_DATE);
    const overlays = createMapOverlayState();
    const hud: HudRefs = createHud({ clock: time, overlays, camera, galaxy });
    const systemNameEl = hud.elements.get('pnlMoney')?.querySelector('.hud-system-name');
    const dateEl = hud.elements.get('pnlTopLeftBar')?.querySelector('.hud-date');
    const pauseBtn = hud.elements.get('pnlTopLeftBar')?.querySelector<HTMLButtonElement>('button[title="Play / pause"]');
    const refreshHud = (): void => {
        if (systemNameEl) {
            systemNameEl.textContent = nearestSystemName(
                { galaxy },
                camera,
            );
        }
        // Demo selection: the object nearest the camera centre (the Main View
        // does not expose picking yet — TODO(port): click-to-select in
        // MainView's input handlers, Controls/MainView.cs mouse handling).
        hud.onSelectionChange?.(pickSelection({ galaxy }, camera));
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