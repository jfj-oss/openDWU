import { computeHudLayout, CYCLE_CHIPS, VIEW_ROWS, type CycleChipKey, type Rect, type ViewRowKey } from './hudLayout';
import { createGameClock, stepSpeed, type GameClock } from '../sim/clock';
import { createMapOverlayState, OVERLAY_ROWS, toggleOverlay, type MapOverlayState } from './mapOverlays';
import { Camera } from '../render/camera';
import { Galaxy } from '../sim/galaxy';
import { Habitat, HabitatCategoryType, HabitatType, SystemInfo } from '../sim/types';

// Port of Main.Part12.cs LoadUiChromeButtons (381–520): the control → chrome
// button image mapping. The original loads each control's image from
// images/ui/chrome/<file>, falling back to the customization folder; here the
// desktop shell / dev server serves the same files under /assets/dwu/.
// Only file names that exist in the original chrome folder are used (see the
// task's file list); controls whose image is a runtime bitmap (play/pause) or
// has no chrome file are mapped to null.

export const CHROME_BUTTONS: Record<string, string | null> = {
    // Top bar buttons (tbtn* / btn* per LoadUiChromeButtons).
    tbtnColonies: 'coloniesButton.png',
    tbtnBuiltObjects: 'shipsAndBasesButton.png',
    tbtnEmpires: 'diplomacyButton.png',
    tbtnTroops: 'troopsButton.png',
    tbtnGalaxyMap: 'galaxyMapButton.png',
    tbtnShipGroups: 'fleetsButton.png',
    tbtnConstructionYards: 'constructionYardsButton.png',
    tbtnIntelligenceAgents: 'charactersButton.png',
    tbtnDesigns: 'designsButton.png',
    btnExpansionPlanner: 'expansionPlannerButton.png',
    btnEmpirePolicy: 'empirePolicyButton.png',
    btnEmpireGraphs: 'empireGraphsButton.png',
    btnGameEditor: 'gameEditorButton.png',
    btnBuildOrder: 'buildButton.png',
    btnGalacticHistory: 'galacticHistoryButton.png',
    btnHistoryMessages: 'messagesButton.png',
    // Menu/help glyphs reuse the original chrome art in the top-left bar.
    btnGameMenu: 'gameOptionsButton.png',
    btnHelp: 'galactopediaButton.png',
    // Runtime bitmaps in the original (bitmap_45/46) — not chrome files.
    btnPlayPause: null,
    // Selection panel cycle chips (icon row in the streamlined footer).
    btnCycleBases: 'cycleBases.png',
    btnCycleColonies: 'cycleColonies.png',
    btnCycleConstruction: 'cycleConstruction.png',
    btnCycleIdleShips: 'cycleIdleShips.png',
    btnCycleMilitary: 'cycleMilitary.png',
    btnCycleOther: 'cycleOther.png',
    btnCycleShipGroups: 'cycleFleets.png',
    // System-map zoom rows (C# names use lowercase "Colony"/"In"; the chrome
    // folder only contains the lowercase-z variants).
    btnZoomColony: 'zoomcolony.png',
    btnZoomIn: 'zoomin.png',
    btnZoomOut: 'zoomout.png',
};

/** Control name → chrome png file name (or null if none applies). */
export function chromeButtonFile(name: string): string | null {
    return CHROME_BUTTONS[name] ?? null;
}

// ---------------------------------------------------------------------------
// DOM overlay (task 05c redesign). One element per rect from
// computeHudLayout, re-laid-out on resize. The overlay is pointer-events:none;
// interactive children re-enable it.
// ---------------------------------------------------------------------------

/** Human labels for chrome-less top-bar buttons (never the control name). */
const TOP_BAR_TEXT_LABELS: Record<string, string> = {
    btnEmpireSummary: 'Empire',
    tbtnResearch: 'Research',
};

/** Cycle chip key → original cycle-button control name (for its icon art). */
const CHIP_CONTROL: Record<CycleChipKey, string> = {
    colonies: 'btnCycleColonies',
    bases: 'btnCycleBases',
    military: 'btnCycleMilitary',
    construction: 'btnCycleConstruction',
    other: 'btnCycleOther',
    fleets: 'btnCycleShipGroups',
    idleShips: 'btnCycleIdleShips',
};

/** View row key → original zoom-button control name (for its icon art). */
const VIEW_ROW_CONTROL: Partial<Record<ViewRowKey, string>> = {
    zoomSelection: 'btnZoomSelection',
    zoomIn: 'btnZoomIn',
    zoomOut: 'btnZoomOut',
    zoomPlanet: 'btnZoomColony',
    galaxyMap: 'tbtnGalaxyMap',
};

/** Planet-level ("100%") camera zoom: 1 px per world unit. */
export const PLANET_LEVEL_ZOOM = 1;

/** System-level view: show ~1 sector (the original's system zoom band). */
export const SYSTEM_LEVEL_ZOOM = 0.001;

/** Sector-level view: show ~4 sectors across. */
export const SECTOR_LEVEL_ZOOM = 0.00025;

/** Whole-galaxy view: the most zoomed-out level (fits the galaxy). */
export const GALAXY_LEVEL_ZOOM = 0.00001;

export interface HudRefs {
    root: HTMLDivElement;
    elements: Map<string, HTMLElement>;
    /** Set by the selection panel; main.ts calls it to push a new selection. */
    onSelectionChange?: (sel: Selection | null) => void;
}

export interface HudWiring {
    /** Simulation clock state (play/pause + speed), mutated by the HUD. */
    clock?: GameClock;
    /** Overlay toggle state, mutated by the options list. */
    overlays?: MapOverlayState;
    /** Main-view camera, driven by the View rows. */
    camera?: Camera;
    /** Generated galaxy model, for selection lookups. */
    galaxy?: Galaxy;
    /** Called after a selection change so main.ts can react. */
    onSelectionChange?: (sel: Selection | null) => void;
}

export interface Selection {
    habitat: Habitat;
    system: SystemInfo;
}

let currentSelection: Selection | null = null;

/** The object currently selected in the streamlined selection panel. */
export function getSelection(): Selection | null {
    return currentSelection;
}

/** Build the HUD overlay and append it to document.body. */
export function createHud(wiring: HudWiring = {}): HudRefs {
    const root = document.createElement('div');
    root.id = 'hud';
    const elements = new Map<string, HTMLElement>();
    const refs: HudRefs = { root, elements };
    // Default state objects when the caller does not supply its own.
    const clock = wiring.clock ?? createGameClock();
    const overlays = wiring.overlays ?? createMapOverlayState();

    for (const [name, rect] of Object.entries(computeHudLayout(window.innerWidth, window.innerHeight))) {
        let el: HTMLElement;
        switch (name) {
            case 'lstMessages':
                el = buildMessagesPanel();
                break;
            case 'pnlTopLeftBar':
                el = buildTopLeftBar(clock);
                break;
            case 'pnlMoney':
                el = buildMoneyPanel();
                break;
            case 'pnlSelection':
                el = buildSelectionPanel({ ...wiring, onSelectionChange: (sel) => {
                    refs.onSelectionChange = wiring.onSelectionChange;
                    wiring.onSelectionChange?.(sel);
                } });
                break;
            case 'pnlOptionsList':
                el = buildOptionsList({ ...wiring, overlays });
                break;
            default:
                el = buildTopBarButton(name);
                break;
        }
        el.classList.add('hud-el');
        el.dataset.hud = name;
        applyRect(el, rect);
        root.appendChild(el);
        elements.set(name, el);
    }

    document.body.appendChild(root);
    return refs;
}

function applyRect(el: HTMLElement, rect: Rect): void {
    el.style.left = `${rect.x}px`;
    el.style.top = `${rect.y}px`;
    if (rect.w > 0) el.style.width = `${rect.w}px`;
    if (rect.h > 0) el.style.height = `${rect.h}px`;
}

/** Re-run computeHudLayout at the current window size and move every element. */
export function layoutHud(refs: HudRefs): void {
    const layout = computeHudLayout(window.innerWidth, window.innerHeight);
    for (const [name, el] of refs.elements) {
        const rect = layout[name];
        if (rect) applyRect(el, rect);
    }
}

// ---------------------------------------------------------------------------
// Element builders
// ---------------------------------------------------------------------------

/** Top-middle message panel: five placeholder lines + envelope/hourglass. */
function buildMessagesPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'hud-panel hud-messages';
    const lines = document.createElement('div');
    lines.className = 'hud-message-lines';
    for (let i = 0; i < 5; i++) {
        const line = document.createElement('div');
        line.className = 'hud-message-line';
        lines.appendChild(line);
    }
    panel.appendChild(lines);
    const actions = document.createElement('div');
    actions.className = 'hud-message-actions';
    const env = makeGlyphButton('✉', 'Messages');
    const hourglass = makeGlyphButton('⧗', 'Historical messages');
    actions.append(env, hourglass);
    panel.appendChild(actions);
    return panel;
}

/** Top-left compact bar: menu | help || play/pause − + || date (speed). */
function buildTopLeftBar(clock: GameClock): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'hud-panel hud-topbar';

    const menu = makeIconButton('btnGameMenu', 'Menu');
    const help = makeIconButton('btnHelp', 'Help');
    bar.append(menu, help);
    bar.appendChild(makeSeparator());

    const pauseBtn = makeGlyphButton('▶', 'Play / pause');
    pauseBtn.addEventListener('click', () => {
        clock.paused = !clock.paused;
        pauseBtn.textContent = clock.paused ? '▶' : '⏸';
    });
    const dec = makeGlyphButton('−', 'Slower');
    dec.addEventListener('click', () => {
        clock.speed = stepSpeed(clock.speed, -1);
        refreshDateLabel(dateEl, clock);
    });
    const inc = makeGlyphButton('+', 'Faster');
    inc.addEventListener('click', () => {
        clock.speed = stepSpeed(clock.speed, 1);
        refreshDateLabel(dateEl, clock);
    });
    bar.append(pauseBtn, dec, inc);
    bar.appendChild(makeSeparator());

    const dateEl = document.createElement('span');
    dateEl.className = 'hud-date';
    refreshDateLabel(dateEl, clock);
    bar.appendChild(dateEl);
    return bar;
}

function refreshDateLabel(el: HTMLElement, clock: GameClock): void {
    // Star date placeholder (lblStarDate) plus the speed multiplier.
    el.textContent = `9860.01.01 (${formatSpeed(clock.speed)}x)`;
}

function formatSpeed(speed: number): string {
    return Number.isInteger(speed) ? String(speed) : String(speed);
}

function makeSeparator(): HTMLElement {
    const sep = document.createElement('span');
    sep.className = 'hud-separator';
    return sep;
}

/** A small text-glyph button (no chrome art). */
function makeGlyphButton(glyph: string, title: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hud-btn hud-btn-glyph';
    btn.title = title;
    btn.textContent = glyph;
    return btn;
}

/** A chrome-art button with a human tooltip (art never shows its name). */
function makeIconButton(controlName: string, title: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hud-btn';
    btn.title = title;
    const file = chromeButtonFile(controlName);
    if (file) {
        const img = document.createElement('img');
        img.src = `/assets/dwu/images/ui/chrome/${file}`;
        img.alt = '';
        img.draggable = false;
        btn.appendChild(img);
    } else {
        btn.classList.add('hud-btn-bare');
        btn.textContent = title;
    }
    // TODO(screen): open the original's panel/screen for this control.
    btn.addEventListener('click', () => console.log(`TODO(screen): ${title}`));
    return btn;
}

/** Top-middle screen-launch button (chrome art, or small text label). */
function buildTopBarButton(name: string): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hud-btn';
    const label = TOP_BAR_TEXT_LABELS[name];
    const file = chromeButtonFile(name);
    if (file) {
        btn.title = label ?? name;
        const img = document.createElement('img');
        img.src = `/assets/dwu/images/ui/chrome/${file}`;
        img.alt = '';
        img.draggable = false;
        btn.appendChild(img);
    } else {
        // No art file: render a small text label, never the control name.
        btn.classList.add('hud-btn-bare');
        btn.textContent = label ?? '';
        btn.title = label ?? '';
    }
    // TODO(screen): open the original's panel/screen for this control.
    btn.addEventListener('click', () => console.log(`TODO(screen): ${label ?? name}`));
    return btn;
}

/** Top-right money block + nearest-system name (existing behaviour kept). */
function buildMoneyPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'hud-panel hud-money';
    for (const row of ['Money', 'Cashflow', 'Bonus Income']) {
        const line = document.createElement('div');
        line.className = 'hud-money-row';
        const k = document.createElement('span');
        k.className = 'hud-label';
        k.textContent = row;
        const v = document.createElement('span');
        v.className = 'hud-value';
        v.textContent = '0';
        line.append(k, v);
        panel.appendChild(line);
    }
    const sys = document.createElement('div');
    sys.className = 'hud-system-name';
    sys.textContent = '';
    panel.appendChild(sys);
    return panel;
}

/** Bottom-left streamlined selection panel. */
function buildSelectionPanel(wiring: HudWiring): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'hud-panel hud-selection';

    const header = document.createElement('div');
    header.className = 'hud-selection-header';
    const nameEl = document.createElement('div');
    nameEl.className = 'hud-selection-name';
    const subEl = document.createElement('div');
    subEl.className = 'hud-selection-sub';
    header.append(nameEl, subEl);
    panel.appendChild(header);

    const body = document.createElement('div');
    body.className = 'hud-selection-body';
    panel.appendChild(body);

    // Footer: ‹ › cycler pair + seven cycle chips.
    const footer = document.createElement('div');
    footer.className = 'hud-selection-footer';
    const back = makeGlyphButton('‹', 'Previous');
    const fwd = makeGlyphButton('›', 'Next');
    let activeChip: CycleChipKey = 'colonies';
    back.addEventListener('click', () => console.log(`TODO(cycle): ${activeChip} back`));
    fwd.addEventListener('click', () => console.log(`TODO(cycle): ${activeChip} forward`));
    footer.append(back, fwd);
    for (const chip of CYCLE_CHIPS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'hud-chip';
        b.title = chip.label;
        const file = chromeButtonFile(CHIP_CONTROL[chip.key]);
        if (file) {
            const img = document.createElement('img');
            img.src = `/assets/dwu/images/ui/chrome/${file}`;
            img.alt = '';
            img.draggable = false;
            b.appendChild(img);
        } else {
            b.classList.add('hud-chip-text');
            b.textContent = chip.label;
        }
        b.addEventListener('click', () => {
            activeChip = chip.key;
            footer.querySelectorAll('.hud-chip').forEach((c) => c.classList.remove('hud-chip-active'));
            b.classList.add('hud-chip-active');
        });
        if (chip.key === activeChip) b.classList.add('hud-chip-active');
        footer.appendChild(b);
    }
    panel.appendChild(footer);

    // Refresh the header/body from the current selection.
    const refresh = (): void => {
        const sel = currentSelection;
        if (!sel) {
            nameEl.textContent = 'Nothing selected';
            nameEl.classList.add('hud-muted');
            subEl.textContent = '';
            body.replaceChildren();
            return;
        }
        nameEl.textContent = sel.habitat.name;
        nameEl.classList.remove('hud-muted');
        const typeName = habitatTypeName(sel.habitat);
        subEl.textContent = `${typeName} · ${sel.system.systemStar.name} system`;
        const rows: Array<[string, string]> = [
            ['Type', typeName],
            ['System', sel.system.systemStar.name],
            ['Diameter', `${sel.habitat.diameter}`],
            ['Quality', `${sel.habitat.baseQuality}`],
        ];
        body.replaceChildren();
        for (const [k, v] of rows) {
            if (v === '') continue; // hide empty rows
            const line = document.createElement('div');
            line.className = 'hud-money-row';
            const kk = document.createElement('span');
            kk.className = 'hud-label';
            kk.textContent = k;
            const vv = document.createElement('span');
            vv.className = 'hud-value';
            vv.textContent = v;
            line.append(kk, vv);
            body.appendChild(line);
        }
    };
    wiring.onSelectionChange = (sel) => {
        currentSelection = sel;
        refresh();
    };
    refresh();
    return panel;
}

/** Bottom-right options list: View rows + overlay toggles. */
function buildOptionsList(wiring: HudWiring): HTMLElement {
    const overlays = wiring.overlays ?? createMapOverlayState();
    const panel = document.createElement('div');
    panel.className = 'hud-panel hud-options';

    const viewHead = document.createElement('div');
    viewHead.className = 'hud-section-head';
    viewHead.textContent = 'View';
    panel.appendChild(viewHead);
    for (const row of VIEW_ROWS) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'hud-option-row';
        const file = chromeButtonFile(VIEW_ROW_CONTROL[row.key] ?? '');
        if (file) {
            const img = document.createElement('img');
            img.src = `/assets/dwu/images/ui/chrome/${file}`;
            img.alt = '';
            img.draggable = false;
            item.appendChild(img);
        }
        const lbl = document.createElement('span');
        lbl.className = 'hud-option-label';
        lbl.textContent = row.label;
        item.appendChild(lbl);
        item.addEventListener('click', () => doViewAction(row.key, wiring));
        panel.appendChild(item);
    }

    const ovHead = document.createElement('div');
    ovHead.className = 'hud-section-head';
    ovHead.textContent = 'Overlays';
    panel.appendChild(ovHead);
    for (const row of OVERLAY_ROWS) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'hud-option-row';
        const check = document.createElement('span');
        check.className = 'hud-option-check';
        check.textContent = overlays[row.key] ? '✓' : '';
        const lbl = document.createElement('span');
        lbl.className = 'hud-option-label';
        lbl.textContent = row.label;
        item.append(check, lbl);
        item.addEventListener('click', () => {
            toggleOverlay(overlays, row.key);
            check.textContent = overlays[row.key] ? '✓' : '';
            // TODO(overlay): render this map overlay in the Main View.
            console.log(`TODO(overlay): ${row.label} -> ${overlays[row.key]}`);
        });
        panel.appendChild(item);
    }
    return panel;
}

/** Drive the camera for a View-list action. */
function doViewAction(key: ViewRowKey, wiring: HudWiring): void {
    const cam = wiring.camera;
    if (!cam) return;
    const cx = cam.width / 2;
    const cy = cam.height / 2;
    switch (key) {
        case 'zoomIn':
            cam.zoomAt(cam.zoom * 2, cx, cy);
            break;
        case 'zoomOut':
            cam.zoomAt(cam.zoom / 2, cx, cy);
            break;
        case 'zoomPlanet':
            cam.zoomAt(PLANET_LEVEL_ZOOM, cx, cy);
            break;
        case 'system':
            cam.zoomAt(SYSTEM_LEVEL_ZOOM, cx, cy);
            break;
        case 'sector':
            cam.zoomAt(SECTOR_LEVEL_ZOOM, cx, cy);
            break;
        case 'galaxy':
        case 'galaxyMap':
            cam.zoomAt(GALAXY_LEVEL_ZOOM, cx, cy);
            break;
        case 'zoomSelection': {
            const sel = currentSelection;
            if (!sel) return;
            cam.centerOn(sel.habitat.xpos, sel.habitat.ypos);
            cam.zoomAt(SYSTEM_LEVEL_ZOOM, cx, cy);
            break;
        }
    }
}

// ---------------------------------------------------------------------------
// Selection helpers
// ---------------------------------------------------------------------------

/** Human-readable planet/star type name for the selection header. */
export function habitatTypeName(h: Habitat): string {
    const t = h.type;
    if (t >= HabitatType.Volcanic && t <= HabitatType.FrozenGasGiant) {
        const planets: Record<number, string> = {
            [HabitatType.Volcanic]: 'Volcanic Planet',
            [HabitatType.Desert]: 'Desert Planet',
            [HabitatType.MarshySwamp]: 'Marshy Swamp Planet',
            [HabitatType.Continental]: 'Continental Planet',
            [HabitatType.Ocean]: 'Ocean Planet',
            [HabitatType.BarrenRock]: 'Barren Rock Planet',
            [HabitatType.Ice]: 'Ice Planet',
            [HabitatType.GasGiant]: 'Gas Giant',
            [HabitatType.FrozenGasGiant]: 'Frozen Gas Giant',
        };
        return planets[t] ?? 'Planet';
    }
    if (t >= HabitatType.MainSequence && t <= HabitatType.SuperNova) {
        const stars: Record<number, string> = {
            [HabitatType.MainSequence]: 'Main Sequence Star',
            [HabitatType.RedGiant]: 'Red Giant',
            [HabitatType.SuperGiant]: 'Super Giant',
            [HabitatType.WhiteDwarf]: 'White Dwarf',
            [HabitatType.Neutron]: 'Neutron Star',
            [HabitatType.BlackHole]: 'Black Hole',
            [HabitatType.SuperNova]: 'Supernova',
        };
        return stars[t] ?? 'Star';
    }
    if (h.category === HabitatCategoryType.Asteroid) return 'Asteroid Field';
    if (h.category === HabitatCategoryType.GasCloud) return 'Gas Cloud';
    return 'Habitat';
}

/**
 * Pick the object to select: the star/planet nearest the given world point
 * (a click position). Falls back to the system nearest the camera centre when
 * the Main View does not expose picking (task 05c demo behaviour).
 */
export function pickSelection(
    dwu: { galaxy?: Galaxy } | undefined,
    camera: { x: number; y: number } | undefined,
    clickWorld?: { x: number; y: number },
): Selection | null {
    const systems = dwu?.galaxy?.systems;
    if (!systems || systems.length === 0) return null;

    // Prefer an explicit click position; otherwise the camera centre.
    const px = clickWorld?.x ?? camera?.x ?? 0;
    const py = clickWorld?.y ?? camera?.y ?? 0;

    let best: Selection | null = null;
    let bestDist = Infinity;
    for (const system of systems) {
        // Consider the star and each planet/moon/asteroid in the system.
        const candidates = [system.systemStar, ...system.habitats];
        for (const h of candidates) {
            const dx = h.xpos - px;
            const dy = h.ypos - py;
            const d = dx * dx + dy * dy;
            if (d < bestDist) {
                bestDist = d;
                best = { habitat: h, system };
            }
        }
    }
    return best;
}

/** Name of the system nearest the camera centre, or '' if unavailable. */
export function nearestSystemName(
    dwu: { galaxy?: { systems?: Array<{ systemStar: { name: string; xpos: number; ypos: number } }> } } | undefined,
    camera: { x: number; y: number } | undefined,
): string {
    const systems = dwu?.galaxy?.systems;
    if (!systems || !camera) return '';
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < systems.length; i++) {
        const star = systems[i].systemStar;
        const dx = star.xpos - camera.x;
        const dy = star.ypos - camera.y;
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
            bestDist = d;
            best = i;
        }
    }
    return best >= 0 ? systems[best].systemStar.name : '';
}