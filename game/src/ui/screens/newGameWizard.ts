// New-game wizard: The Galaxy page (task 06b). Port of the visual layout of
// Start.InitializeComponent.cs pnlStartNewGameTheGalaxy, modernised like the
// HUD panels. Only the Galaxy page is implemented; other wizard pages are a
// TODO(port) for a later task.
import './newGameWizard.css';
import { GalaxyShape } from '../../sim/types';
import { defaultStartGameOptions, sectorsFor, starCountFor, type StartGameOptions } from '../../sim/startGameOptions';

const CHROME = '/assets/dwu/images/ui/chrome/';

export interface ShapeOption {
    shape: GalaxyShape;
    label: string;
    /** File name under images/ui/chrome/ for the square preview image. */
    image: string;
    description: string;
}

/** Radio list order + labels/preview art (task 06b source). */
export const SHAPE_OPTIONS: ShapeOption[] = [
    { shape: GalaxyShape.Elliptical, label: 'Elliptical', image: 'galaxyshape_elliptical.png', description: 'A smooth elliptical distribution of stars.' },
    { shape: GalaxyShape.Spiral, label: 'Spiral', image: 'galaxyshape_spiral.png', description: 'A classic spiral galaxy with several arms.' },
    { shape: GalaxyShape.Ring, label: 'Ring', image: 'galaxyshape_ring.png', description: 'Stars arranged in a ring around an empty core.' },
    { shape: GalaxyShape.Irregular, label: 'Irregular', image: 'galaxyshape_irregular.png', description: 'An irregular, unstructured scattering of stars.' },
    { shape: GalaxyShape.ClustersEven, label: 'Even Clusters', image: 'galaxyshape_clusterseven.png', description: 'Stars grouped into evenly sized clusters.' },
    { shape: GalaxyShape.ClustersVaried, label: 'Varied Clusters', image: 'galaxyshape_clustersvaried.png', description: 'Stars grouped into clusters of varied sizes.' },
];

export const STAR_AMOUNT_TICKS = ['Dwarf 100', 'Tiny 250', 'Small 400', 'Standard 700', 'Large 1000', 'Huge 1400'];
export const PHYSICAL_SIZE_TICKS = ['Tiny 4×4', 'Small 6×6', 'Medium 8×8', 'Large 10×10', 'Huge 15×15 sectors'];

export interface NewGameWizardCallbacks {
    onBackToMenu: () => void;
    onStartGame: (options: StartGameOptions) => void;
}

export interface NewGameWizardRefs {
    root: HTMLDivElement;
    destroy: () => void;
}

function randomSeed(): number {
    return Math.floor(Math.random() * 2147483647);
}

/** Build the new-game wizard's Galaxy page and append it to document.body. */
export function createNewGameWizard(callbacks: NewGameWizardCallbacks): NewGameWizardRefs {
    const options: StartGameOptions = defaultStartGameOptions();

    const overlay = document.createElement('div');
    overlay.className = 'wizard-overlay';

    const win = document.createElement('div');
    win.className = 'wizard-window';
    overlay.appendChild(win);

    // Title bar.
    const titleBar = document.createElement('div');
    titleBar.className = 'wizard-titlebar';
    const titleText = document.createElement('span');
    titleText.textContent = 'Start a New Game: The Galaxy';
    titleBar.appendChild(titleText);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'wizard-close';
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => callbacks.onBackToMenu());
    titleBar.appendChild(closeBtn);
    win.appendChild(titleBar);

    const body = document.createElement('div');
    body.className = 'wizard-body';
    win.appendChild(body);

    // --- Shape row: radio list left, preview + description right. ---
    const shapeRow = document.createElement('div');
    shapeRow.className = 'wizard-shape-row';
    body.appendChild(shapeRow);

    const shapeList = document.createElement('div');
    shapeList.className = 'wizard-shape-list';
    shapeRow.appendChild(shapeList);

    const preview = document.createElement('div');
    preview.className = 'wizard-shape-preview';
    const previewImg = document.createElement('img');
    preview.appendChild(previewImg);
    const previewDesc = document.createElement('div');
    previewDesc.className = 'wizard-shape-desc';
    preview.appendChild(previewDesc);
    shapeRow.appendChild(preview);

    const radioButtons: HTMLInputElement[] = [];
    function updatePreview(): void {
        const opt = SHAPE_OPTIONS.find((o) => o.shape === options.shape) ?? SHAPE_OPTIONS[1];
        previewImg.src = `${CHROME}${opt.image}`;
        previewImg.alt = opt.label;
        previewDesc.textContent = opt.description;
    }
    SHAPE_OPTIONS.forEach((opt, i) => {
        const label = document.createElement('label');
        label.className = 'wizard-shape-item';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'wizard-shape';
        radio.value = String(opt.shape);
        radio.checked = opt.shape === options.shape;
        radio.addEventListener('change', () => {
            options.shape = opt.shape;
            updatePreview();
        });
        radioButtons[i] = radio;
        label.appendChild(radio);
        const span = document.createElement('span');
        span.textContent = opt.label;
        label.appendChild(span);
        shapeList.appendChild(label);
    });
    updatePreview();

    // --- Sliders ---
    function makeSlider(title: string, ticks: string[], defaultIndex: number, onChange: (i: number) => void): HTMLDivElement {
        const wrap = document.createElement('div');
        wrap.className = 'wizard-slider';
        const label = document.createElement('div');
        label.className = 'wizard-slider-title';
        label.textContent = title;
        wrap.appendChild(label);

        const input = document.createElement('input');
        input.type = 'range';
        input.min = '0';
        input.max = String(ticks.length - 1);
        input.step = '1';
        input.value = String(defaultIndex);
        input.addEventListener('input', () => onChange(parseInt(input.value, 10)));
        wrap.appendChild(input);

        const ticksRow = document.createElement('div');
        ticksRow.className = 'wizard-slider-ticks';
        // One span per tick so CSS space-between spreads the labels evenly
        // under the slider (task 06c).
        for (const t of ticks) {
            const span = document.createElement('span');
            span.textContent = t;
            ticksRow.appendChild(span);
        }
        wrap.appendChild(ticksRow);

        return wrap;
    }

    const starSlider = makeSlider('Star Amount', STAR_AMOUNT_TICKS, options.starCountIndex, (i) => {
        options.starCountIndex = i;
    });
    body.appendChild(starSlider);

    const sizeSlider = makeSlider('Physical Size', PHYSICAL_SIZE_TICKS, options.dimensionIndex, (i) => {
        options.dimensionIndex = i;
    });
    body.appendChild(sizeSlider);

    // --- Seed ---
    const seedRow = document.createElement('div');
    seedRow.className = 'wizard-seed-row';
    const seedLabel = document.createElement('span');
    seedLabel.textContent = 'Seed';
    seedRow.appendChild(seedLabel);
    const seedInput = document.createElement('input');
    seedInput.type = 'number';
    seedInput.className = 'wizard-seed-input';
    seedInput.value = String(options.seed);
    seedInput.addEventListener('input', () => {
        const v = parseInt(seedInput.value, 10);
        if (!Number.isNaN(v)) {
            options.seed = v;
        }
    });
    seedRow.appendChild(seedInput);
    const rerollBtn = document.createElement('button');
    rerollBtn.type = 'button';
    rerollBtn.className = 'wizard-seed-reroll';
    rerollBtn.title = 'Re-roll seed';
    rerollBtn.textContent = '\u{1F3B2}';
    rerollBtn.addEventListener('click', () => {
        options.seed = randomSeed();
        seedInput.value = String(options.seed);
    });
    seedRow.appendChild(rerollBtn);
    body.appendChild(seedRow);

    // TODO(port): remaining wizard pages (playstyle, colonization/territory,
    // race, empire, other empires, victory conditions, quick start) —
    // Start.InitializeComponent.cs pnlStartNewGame* panels other than
    // pnlStartNewGameTheGalaxy.
    const moreTodo = document.createElement('div');
    moreTodo.className = 'wizard-todo';
    moreTodo.textContent = 'Other wizard pages (playstyle, colonization, race, empire, victory conditions) — coming later.';
    body.appendChild(moreTodo);

    // --- Footer ---
    const footer = document.createElement('div');
    footer.className = 'wizard-footer';
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'wizard-btn wizard-btn-secondary';
    backBtn.textContent = '← Main Menu';
    backBtn.addEventListener('click', () => callbacks.onBackToMenu());
    footer.appendChild(backBtn);

    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.className = 'wizard-btn wizard-btn-primary';
    startBtn.textContent = 'Start Game';
    startBtn.addEventListener('click', () => callbacks.onStartGame({ ...options }));
    footer.appendChild(startBtn);
    win.appendChild(footer);

    document.body.appendChild(overlay);

    return {
        root: overlay,
        destroy: () => overlay.remove(),
    };
}

// Re-exported for convenience (main.ts maps wizard options -> generateGalaxy).
export { starCountFor, sectorsFor };
