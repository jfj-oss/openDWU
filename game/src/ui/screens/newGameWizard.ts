// New-game wizard, "The Galaxy" page (task 06b). A centred dark window over
// the menu background: galaxy-shape radio list with a preview image on the
// left, Star Amount / Physical Size sliders and a Seed input in the middle,
// and a footer with Main Menu / Start Game. The slider tick labels mirror the
// original's BaconStart.method_60 / Start.method_69 tables (see
// src/sim/startGameOptions.ts).
// TODO(port): the remaining wizard pages (Empire, ...) — later tasks; the
// original shows them as tabs after the Galaxy page (BaconStart UI).

import { GalaxyShape } from '../../sim/types';
import type { StartGameOptions } from '../../sim/startGameOptions';
import './newGameWizard.css';

const CHROME = '/assets/dwu/images/ui/chrome';

/** Shape radio entries, in display order (original wizard order), each with
 * its preview image file name and a one-line description. */
export const SHAPE_ENTRIES: readonly { shape: GalaxyShape; label: string; image: string; blurb: string }[] = [
    { shape: GalaxyShape.Elliptical, label: 'Elliptical', image: 'galaxyshape_elliptical.png', blurb: 'A smooth oval of stars, densest at the core.' },
    { shape: GalaxyShape.Spiral, label: 'Spiral', image: 'galaxyshape_spiral.png', blurb: 'Classic spiral arms winding out from a bright centre.' },
    { shape: GalaxyShape.Ring, label: 'Ring', image: 'galaxyshape_ring.png', blurb: 'Stars concentrated in a ring around an empty core.' },
    { shape: GalaxyShape.Irregular, label: 'Irregular', image: 'galaxyshape_irregular.png', blurb: 'No dominant structure — a chaotic scatter of stars.' },
    { shape: GalaxyShape.ClustersEven, label: 'Even Clusters', image: 'galaxyshape_clusterseven.png', blurb: 'Distinct star clusters spread evenly across the galaxy.' },
    { shape: GalaxyShape.ClustersVaried, label: 'Varied Clusters', image: 'galaxyshape_clustersvaried.png', blurb: 'Clusters of varying size scattered through the galaxy.' },
];

/** Star Amount slider ticks (BaconStart.method_60 vanilla values). */
export const STAR_AMOUNT_TICKS: readonly { label: string; count: number }[] = [
    { label: 'Dwarf', count: 100 },
    { label: 'Tiny', count: 250 },
    { label: 'Small', count: 400 },
    { label: 'Standard', count: 700 },
    { label: 'Large', count: 1000 },
    { label: 'Huge', count: 1400 },
];

/** Physical Size slider ticks (Start.method_69, square sectors). */
export const PHYSICAL_SIZE_TICKS: readonly { label: string; sectors: number }[] = [
    { label: 'Tiny', sectors: 4 },
    { label: 'Small', sectors: 6 },
    { label: 'Medium', sectors: 8 },
    { label: 'Large', sectors: 10 },
    { label: 'Huge', sectors: 15 },
];

export interface NewGameWizardRefs {
    root: HTMLDivElement;
    /** Remove the wizard from the document (back to menu / close ✕). */
    destroy(): void;
}

export interface NewGameWizardCallbacks {
    /** Start Game clicked, with the current options. */
    onStart(options: StartGameOptions): void;
    /** Close ✕ or ← Main Menu: back to the main menu. */
    onCancel(): void;
}

/** Build the "The Galaxy" wizard page and append it to document.body. */
export function createNewGameWizard(
    initial: StartGameOptions,
    callbacks: NewGameWizardCallbacks,
): NewGameWizardRefs {
    const state: StartGameOptions = { ...initial };

    const root = document.createElement('div');
    root.id = 'new-game-wizard';

    // Same full-screen menu background as the main menu (the wizard is shown
    // over the menu, which stays mounted underneath).
    const bg = document.createElement('img');
    bg.className = 'wizard-background';
    bg.src = `${CHROME}/MainBackground.jpg`;
    bg.alt = '';
    bg.draggable = false;
    root.appendChild(bg);

    const window_ = document.createElement('div');
    window_.className = 'wizard-window';
    root.appendChild(window_);

    // Title bar: "Start a New Game: The Galaxy" + close ✕.
    const titleBar = document.createElement('div');
    titleBar.className = 'wizard-titlebar';
    const title = document.createElement('div');
    title.className = 'wizard-title';
    title.textContent = 'Start a New Game: The Galaxy';
    titleBar.appendChild(title);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'wizard-close';
    closeBtn.title = 'Close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => callbacks.onCancel());
    titleBar.appendChild(closeBtn);
    window_.appendChild(titleBar);

    const body = document.createElement('div');
    body.className = 'wizard-body';
    window_.appendChild(body);

    // Left column: shape radio list + preview image + one-line description.
    const left = document.createElement('div');
    left.className = 'wizard-shapes';
    const list = document.createElement('div');
    list.className = 'wizard-shape-list';
    const preview = document.createElement('img');
    preview.className = 'wizard-shape-preview';
    preview.alt = '';
    preview.draggable = false;
    const blurb = document.createElement('div');
    blurb.className = 'wizard-shape-blurb';

    const refreshPreview = (): void => {
        const entry = SHAPE_ENTRIES.find((e) => e.shape === state.shape)!;
        preview.src = `${CHROME}/${entry.image}`;
        blurb.textContent = entry.blurb;
    };

    for (const entry of SHAPE_ENTRIES) {
        const row = document.createElement('label');
        row.className = 'wizard-shape-row';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'galaxy-shape';
        radio.value = String(entry.shape);
        if (entry.shape === state.shape) {
            radio.checked = true;
        }
        radio.addEventListener('change', () => {
            state.shape = entry.shape;
            refreshPreview();
        });
        const span = document.createElement('span');
        span.textContent = entry.label;
        row.appendChild(radio);
        row.appendChild(span);
        list.appendChild(row);
    }
    refreshPreview();
    left.appendChild(list);
    left.appendChild(preview);
    left.appendChild(blurb);
    body.appendChild(left);

    // Right column: the two sliders and the seed input.
    const right = document.createElement('div');
    right.className = 'wizard-options';
    body.appendChild(right);

    const starSlider = buildTickSlider({
        id: 'wizard-star-amount',
        title: 'Star Amount',
        ticks: STAR_AMOUNT_TICKS.map((t) => t.label),
        value: state.starCountIndex,
        onChange: (i) => {
            state.starCountIndex = i;
        },
    });
    right.appendChild(starSlider);

    const sizeSlider = buildTickSlider({
        id: 'wizard-physical-size',
        title: 'Physical Size',
        ticks: PHYSICAL_SIZE_TICKS.map((t) => `${t.label} ${t.sectors}×${t.sectors}`),
        value: state.dimensionIndex,
        onChange: (i) => {
            state.dimensionIndex = i;
        },
    });
    right.appendChild(sizeSlider);

    // Seed row: number input + 🎲 re-roll button.
    const seedRow = document.createElement('div');
    seedRow.className = 'wizard-seed-row';
    const seedLabel = document.createElement('div');
    seedLabel.className = 'wizard-option-title';
    seedLabel.textContent = 'Seed';
    const seedInput = document.createElement('input');
    seedInput.type = 'number';
    seedInput.className = 'wizard-seed-input';
    seedInput.min = '0';
    seedInput.step = '1';
    seedInput.value = String(state.seed);
    seedInput.addEventListener('input', () => {
        const v = parseInt(seedInput.value, 10);
        if (!Number.isNaN(v)) {
            state.seed = v;
        }
    });
    const reroll = document.createElement('button');
    reroll.type = 'button';
    reroll.className = 'wizard-reroll';
    reroll.title = 'Random seed';
    reroll.textContent = '🎲';
    reroll.addEventListener('click', () => {
        state.seed = randomSeed();
        seedInput.value = String(state.seed);
    });
    seedRow.appendChild(seedLabel);
    seedRow.appendChild(seedInput);
    seedRow.appendChild(reroll);
    right.appendChild(seedRow);

    // Footer: ← Main Menu (left), Start Game (right).
    const footer = document.createElement('div');
    footer.className = 'wizard-footer';
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'wizard-btn';
    backBtn.textContent = '← Main Menu';
    backBtn.addEventListener('click', () => callbacks.onCancel());
    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.className = 'wizard-btn wizard-btn-primary';
    startBtn.textContent = 'Start Game';
    startBtn.addEventListener('click', () => callbacks.onStart({ ...state }));
    footer.appendChild(backBtn);
    footer.appendChild(startBtn);
    window_.appendChild(footer);

    document.body.appendChild(root);
    return {
        root,
        destroy() {
            root.remove();
        },
    };
}

interface TickSliderSpec {
    id: string;
    title: string;
    ticks: string[];
    value: number;
    onChange(index: number): void;
}

/** A labelled range slider whose detents are the given tick labels (shown
 * below the track, evenly spaced). */
function buildTickSlider(spec: TickSliderSpec): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'wizard-slider';
    wrap.id = spec.id;

    const head = document.createElement('div');
    head.className = 'wizard-option-title';
    head.textContent = spec.title;
    wrap.appendChild(head);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = String(spec.ticks.length - 1);
    input.step = '1';
    input.value = String(Math.max(0, Math.min(spec.ticks.length - 1, spec.value)));
    input.addEventListener('input', () => {
        spec.onChange(parseInt(input.value, 10));
    });
    wrap.appendChild(input);

    const ticks = document.createElement('div');
    ticks.className = 'wizard-tick-labels';
    for (const label of spec.ticks) {
        const span = document.createElement('span');
        span.textContent = label;
        ticks.appendChild(span);
    }
    wrap.appendChild(ticks);
    return wrap;
}

/** A fresh non-negative seed (matches the .NET-style positive range used at boot). */
function randomSeed(): number {
    return Math.floor(Math.random() * 2147483647);
}