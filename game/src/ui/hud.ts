import { computeHudLayout, type Rect } from './hudLayout';

// Port of Main.Part12.cs LoadUiChromeButtons (381–520): the control → chrome
// button image mapping. The original loads each control's image from
// images/ui/chrome/<file>, falling back to the customization folder; here the
// desktop shell / dev server serves the same files under /assets/dwu/.
// Only file names that exist in the original chrome folder are used (see the
// task's file list); controls whose image is a runtime bitmap (play/pause,
// selection arrows) or has no chrome file are mapped to null.

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
    btnGameMenu: 'gameOptionsButton.png',
    btnHelp: 'galactopediaButton.png',
    // Runtime bitmaps in the original (bitmap_45/46, 156/157) — not chrome files.
    btnPlayPause: null,
    btnSelectionBack: null,
    btnSelectionForward: null,
    // Selection panel buttons.
    btnCycleBases: 'cycleBases.png',
    btnCycleBasesBack: 'cycleBasesBack.png',
    btnCycleColonies: 'cycleColonies.png',
    btnCycleColoniesBack: 'cycleColoniesBack.png',
    btnCycleConstruction: 'cycleConstruction.png',
    btnCycleConstructionBack: 'cycleConstructionBack.png',
    btnCycleIdleShips: 'cycleIdleShips.png',
    btnCycleIdleShipsBack: 'cycleIdleShipsBack.png',
    btnCycleMilitary: 'cycleMilitary.png',
    btnCycleMilitaryBack: 'cycleMilitaryBack.png',
    btnCycleOther: 'cycleOther.png',
    btnCycleOtherBack: 'cycleOtherBack.png',
    btnCycleShipGroups: 'cycleFleets.png',
    btnCycleShipGroupsBack: 'cycleFleetsBack.png',
    btnCycleShipStance: 'shipStance.png',
    btnLockView: 'lockView.png',
    btnSelectNearestMilitary: 'nearestMilitary.png',
    btnSelectionPanelSize: 'selectionPanelSize.png',
    // System-map zoom buttons (C# names use lowercase "Colony"/"In"; the
    // chrome folder only contains the lowercase-z variants).
    btnZoomColony: 'zoomcolony.png',
    btnZoomIn: 'zoomin.png',
    btnZoomOut: 'zoomout.png',
    // TODO(port): btnZoomSystem / btnZoomRegion / jQaYpdpkDs — no matching
    // chrome file in the original folder list (zoomsystem.png etc. are absent).
    btnZoomSystem: null,
    btnZoomRegion: null,
    jQaYpdpkDs: null,
};

/** Control name → chrome png file name (or null if none applies). */
export function chromeButtonFile(name: string): string | null {
    return CHROME_BUTTONS[name] ?? null;
}

// ---------------------------------------------------------------------------
// DOM overlay. One element per rect from computeHudLayout, re-laid-out on
// resize. The overlay is pointer-events:none; buttons re-enable it.
// ---------------------------------------------------------------------------

const PANEL_NAMES = new Set(['pnlDetailInfo', 'lstMessages', 'pnlSystemMap']);

// Controls rendered as plain dark buttons when they have no chrome image.
const BARE_BUTTONS = new Set([
    'btnPlayPause',
    'btnSelectionBack',
    'btnSelectionForward',
    'btnZoomSystem',
    'btnZoomRegion',
    'jQaYpdpkDs',
]);

/** Names that are text labels rather than controls or panels. */
const LABEL_NAMES = new Set([
    'lblStarDate',
    'lblSystemName',
    'lblStateMoney',
    'lblPrivateMoney',
    'lblGodData',
]);

export interface HudRefs {
    root: HTMLDivElement;
    elements: Map<string, HTMLElement>;
}

/** Build the HUD overlay and append it to document.body. */
export function createHud(): HudRefs {
    const root = document.createElement('div');
    root.id = 'hud';
    const elements = new Map<string, HTMLElement>();

    for (const [name, rect] of Object.entries(computeHudLayout(window.innerWidth, window.innerHeight))) {
        let el: HTMLElement;
        if (PANEL_NAMES.has(name)) {
            el = buildPanel(name);
        } else if (LABEL_NAMES.has(name)) {
            el = buildLabel(name);
        } else {
            el = buildButton(name);
        }
        el.classList.add('hud-el');
        el.dataset.hud = name;
        applyRect(el, rect);
        root.appendChild(el);
        elements.set(name, el);
    }

    document.body.appendChild(root);
    return { root, elements };
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

function buildButton(name: string): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hud-btn';
    const file = chromeButtonFile(name);
    if (file) {
        const img = document.createElement('img');
        img.src = `/assets/dwu/images/ui/chrome/${file}`;
        img.alt = '';
        img.draggable = false;
        btn.appendChild(img);
    } else {
        btn.classList.add('hud-btn-bare');
        btn.textContent = name;
    }
    // TODO(screen): open the original's panel/screen for this control.
    btn.addEventListener('click', () => console.log(`TODO(screen): ${name}`));
    return btn;
}

function buildLabel(name: string): HTMLElement {
    const label = document.createElement('div');
    label.className = 'hud-label';
    switch (name) {
        case 'lblStarDate':
            label.textContent = '9860.01.01';
            break;
        case 'lblSystemName':
            label.textContent = '';
            break;
        case 'lblStateMoney': {
            // Money / Cashflow / Bonus Income block with placeholder zeros.
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
                label.appendChild(line);
            }
            break;
        }
        default:
            label.textContent = '';
    }
    return label;
}

function buildPanel(name: string): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'hud-panel';
    if (name === 'lstMessages') {
        // Five empty message lines as placeholders.
        panel.textContent = '\n\n\n\n\n';
    } else if (name === 'pnlDetailInfo') {
        // Selection detail panel: header + body, content filled by a later task.
        const header = document.createElement('div');
        header.className = 'hud-label';
        header.textContent = 'Selection';
        panel.appendChild(header);
        // TODO(port): selection detail rows — Main.Part*.cs pnlDetailInfo population.
    }
    // pnlSystemMap stays an empty container: the system map renders in Pixi.
    return panel;
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