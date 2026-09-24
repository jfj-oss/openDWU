// New-game wizard (tasks 06b/06d): The Galaxy → Your Race → Start pages.
// Port of the visual layout of Start.InitializeComponent.cs pnlStartNewGame*
// panels, modernised like the HUD panels. "The Galaxy" page is task 06b;
// "Your Race" (race list + portrait/stats detail) and the final summary
// "Start" page are task 06d.
import './newGameWizard.css';
import { GalaxyShape } from '../../sim/types';
import { defaultRaceName, defaultStartGameOptions, sectorsFor, starCountFor, type StartGameOptions } from '../../sim/startGameOptions';
import { parseRace, type Race } from '../../sim/data/races';
import { parseRaceFamilies, type RaceFamily } from '../../sim/data/raceFamilies';
import { fetchText } from '../../sim/data/fetchData';
import { resolveDataUrl } from '../../sim/data/paths';

const CHROME = '/assets/dwu/images/ui/chrome/';
const RACES_DIR = '/assets/dwu/images/units/races/';

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

/** Wizard page ids / navigation order (task 06d): The Galaxy → Your Race → Start. */
export type WizardPageId = 'galaxy' | 'race' | 'start';
export const WIZARD_PAGES: WizardPageId[] = ['galaxy', 'race', 'start'];

/** Title-bar text per page ("Start a New Game: <page title>"). */
export const WIZARD_PAGE_TITLES: Record<WizardPageId, string> = {
    galaxy: 'The Galaxy',
    race: 'Your Race',
    start: 'Start',
};

/** Footer back-button label per page. */
export const WIZARD_BACK_LABELS: Record<WizardPageId, string> = {
    galaxy: '← Main Menu',
    race: '← The Galaxy',
    start: '← Your Race',
};

/** Footer forward-button label per page. */
export const WIZARD_FORWARD_LABELS: Record<WizardPageId, string> = {
    galaxy: 'Next →',
    race: 'Next →',
    start: 'Start Game',
};

/** Task 06d: every numeric field the race parser has (src/sim/data/races.ts),
 * shown on the "Your Race" page as a two-column stats grid. */
export const RACE_STAT_FIELDS: ReadonlyArray<{ key: keyof Race; label: string }> = [
    { key: 'pictureIndex', label: 'Picture Index' },
    { key: 'raceFamily', label: 'Race Family' },
    { key: 'reproductionRate', label: 'Reproduction Rate' },
    { key: 'intelligence', label: 'Intelligence' },
    { key: 'aggression', label: 'Aggression' },
    { key: 'caution', label: 'Caution' },
    { key: 'friendliness', label: 'Friendliness' },
    { key: 'loyalty', label: 'Loyalty' },
    { key: 'designsPictureFamilyIndex', label: 'Designs Picture Family Index' },
    { key: 'designNamesIndex', label: 'Design Names Index' },
    { key: 'shipMaintenanceSavings', label: 'Ship Maintenance Savings' },
    { key: 'troopMaintenanceSavings', label: 'Troop Maintenance Savings' },
    { key: 'resourceExtractionBonus', label: 'Resource Extraction Bonus' },
    { key: 'warWearinessAttenuation', label: 'War Weariness Attenuation' },
    { key: 'satisfactionModifier', label: 'Satisfaction Modifier' },
    { key: 'researchBonus', label: 'Research Bonus' },
    { key: 'espionageBonus', label: 'Espionage Bonus' },
    { key: 'tradeBonus', label: 'Trade Bonus' },
    { key: 'overallShipDesignFocus', label: 'Overall Ship Design Focus' },
    { key: 'techFocus1', label: 'Tech Focus 1' },
    { key: 'techFocus2', label: 'Tech Focus 2' },
    { key: 'nativePlanetType', label: 'Native Planet Type' },
    { key: 'specialComponent', label: 'Special Component' },
    { key: 'troopStrength', label: 'Troop Strength' },
    { key: 'defaultPrimaryColor', label: 'Default Primary Color' },
    { key: 'defaultSecondaryColor', label: 'Default Secondary Color' },
    { key: 'defaultFlagDesign', label: 'Default Flag Design' },
];

/** Task 06d: the original's race portrait file names (Main.Part13.cs ~2195):
 * race_<i>.png, indexed by the race's PictureRef, with alternate
 * race_<i>a.png. Kept here (pure) so tests can check them without a DOM. */
export function racePortraitUrls(pictureRef: number): string[] {
    return [`${RACES_DIR}race_${pictureRef}.png`, `${RACES_DIR}race_${pictureRef}a.png`];
}

function randomSeed(): number {
    return Math.floor(Math.random() * 2147483647);
}

/** Load all races (races/*.txt) plus raceFamilies.txt via the same URL
 * resolution the engine uses (Customization/<set>/ first, base last). A race
 * file that is absent from the install (or a customization set) makes the dev
 * server answer with its SPA index.html fallback instead of the .txt — we
 * detect that and skip the file rather than parsing garbage, so a partial
 * install still lists every race it actually has. */
async function loadWizardRaceData(): Promise<{ races: Race[]; families: RaceFamily[]; missing: string[] }> {
    // Same 22 files the game loads (GameData default raceFileNames).
    const raceFiles = [
        'human.txt', 'mechanoid.txt', 'evuck.txt', 'ackdarians.txt', 'teekan.txt',
        'kaltor.txt', 'dryad.txt', 'illo.txt', 'evuckian.txt', 'tao.txt',
        'shaktur.txt', 'mithrilar.txt', 'human_pirate.txt', 'mechanoid_pirate.txt',
        'draxian.txt', 'magellan.txt', 'dhayut.txt', 'sentinel.txt', 'thrynn.txt',
        'soulless.txt', 'human_cai.txt', 'mechanoid_ancient.txt',
    ];
    const familyText = await fetchText(resolveDataUrl('raceFamilies.txt'));
    const races: Race[] = [];
    const missing: string[] = [];
    for (const f of raceFiles) {
        const text = await fetchText(resolveDataUrl(`races/${f}`));
        if (!isRaceFileText(text)) {
            missing.push(f);
            continue;
        }
        races.push(parseRace(text));
    }
    const families = parseRaceFamilies(familyText);
    return { races, families, missing };
}

/** True when a fetched data body is a real DW:U .txt file (starts with the
 * "'Distant Worlds" comment line) rather than the dev server's HTML 404
 * fallback for a missing file. */
function isRaceFileText(text: string): boolean {
    const first = text.split(/\r\n|\r|\n/, 1)[0]?.trimStart() ?? '';
    return first.startsWith("'");
}

/** Build the new-game wizard (Galaxy → Your Race → Start) and append it to
 * document.body. When opened via ?screen=wizard&page=race the wizard starts
 * on the named page (screenshot/dev hook; main.ts does not pass the page). */
export function createNewGameWizard(callbacks: NewGameWizardCallbacks): NewGameWizardRefs {
    const options: StartGameOptions = defaultStartGameOptions();
    let page: WizardPageId = 'galaxy';
    try {
        const requested = new URLSearchParams(window.location.search).get('page');
        if (requested !== null && (WIZARD_PAGES as string[]).includes(requested)) {
            page = requested as WizardPageId;
        }
    } catch {
        // non-browser context: stay on the first page
    }

    const overlay = document.createElement('div');
    overlay.className = 'wizard-overlay';

    const win = document.createElement('div');
    win.className = 'wizard-window';
    overlay.appendChild(win);

    // Title bar (text changes per page).
    const titleBar = document.createElement('div');
    titleBar.className = 'wizard-titlebar';
    const titleText = document.createElement('span');
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

    // --- Page containers (built once, shown/hidden on navigation). ---
    const galaxyPage = buildGalaxyPage(options);
    const racePage = buildRacePage(options);
    const startPage = buildStartPage(options);
    const pageEls: Record<WizardPageId, HTMLElement> = {
        galaxy: galaxyPage,
        race: racePage,
        start: startPage,
    };
    for (const el of Object.values(pageEls)) {
        el.style.display = 'none';
        body.appendChild(el);
    }

    function refreshStartSummary(): void {
        const refresh = (startPage as unknown as { __refresh?: () => void }).__refresh;
        if (refresh) refresh();
    }

    // --- Footer (back/forward buttons change per page). ---
    const footer = document.createElement('div');
    footer.className = 'wizard-footer';
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'wizard-btn wizard-btn-secondary';
    footer.appendChild(backBtn);

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'wizard-btn wizard-btn-primary';
    footer.appendChild(nextBtn);
    win.appendChild(footer);

    function showPage(id: WizardPageId): void {
        page = id;
        titleText.textContent = `Start a New Game: ${WIZARD_PAGE_TITLES[id]}`;
        for (const [pid, el] of Object.entries(pageEls)) {
            el.style.display = pid === id ? '' : 'none';
        }
        backBtn.textContent = WIZARD_BACK_LABELS[id];
        nextBtn.textContent = WIZARD_FORWARD_LABELS[id];
        if (id === 'start') {
            refreshStartSummary();
        }
    }

    function goBack(): void {
        if (page === 'galaxy') {
            callbacks.onBackToMenu();
            return;
        }
        const idx = WIZARD_PAGES.indexOf(page);
        showPage(WIZARD_PAGES[idx - 1]);
    }

    function goForward(): void {
        const idx = WIZARD_PAGES.indexOf(page);
        if (idx < WIZARD_PAGES.length - 1) {
            showPage(WIZARD_PAGES[idx + 1]);
        } else {
            callbacks.onStartGame({ ...options });
        }
    }

    backBtn.addEventListener('click', goBack);
    nextBtn.addEventListener('click', goForward);

    document.body.appendChild(overlay);
    showPage(page);

    return {
        root: overlay,
        destroy: () => overlay.remove(),
    };
}

// ---------------------------------------------------------------------------
// The Galaxy page (task 06b).
// ---------------------------------------------------------------------------

function buildGalaxyPage(options: StartGameOptions): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'wizard-page';

    // --- Shape row: radio list left, preview + description right. ---
    const shapeRow = document.createElement('div');
    shapeRow.className = 'wizard-shape-row';
    wrap.appendChild(shapeRow);

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

    function updatePreview(): void {
        const opt = SHAPE_OPTIONS.find((o) => o.shape === options.shape) ?? SHAPE_OPTIONS[1];
        previewImg.src = `${CHROME}${opt.image}`;
        previewImg.alt = opt.label;
        previewDesc.textContent = opt.description;
    }
    SHAPE_OPTIONS.forEach((opt) => {
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
        label.appendChild(radio);
        const span = document.createElement('span');
        span.textContent = opt.label;
        label.appendChild(span);
        shapeList.appendChild(label);
    });
    updatePreview();

    // --- Sliders ---
    function makeSlider(title: string, ticks: string[], defaultIndex: number, onChange: (i: number) => void): HTMLDivElement {
        const sliderWrap = document.createElement('div');
        sliderWrap.className = 'wizard-slider';
        const label = document.createElement('div');
        label.className = 'wizard-slider-title';
        label.textContent = title;
        sliderWrap.appendChild(label);

        const input = document.createElement('input');
        input.type = 'range';
        input.min = '0';
        input.max = String(ticks.length - 1);
        input.step = '1';
        input.value = String(defaultIndex);
        input.addEventListener('input', () => onChange(parseInt(input.value, 10)));
        sliderWrap.appendChild(input);

        const ticksRow = document.createElement('div');
        ticksRow.className = 'wizard-slider-ticks';
        // One span per tick so CSS space-between spreads the labels evenly
        // under the slider (task 06c).
        for (const t of ticks) {
            const span = document.createElement('span');
            span.textContent = t;
            ticksRow.appendChild(span);
        }
        sliderWrap.appendChild(ticksRow);

        return sliderWrap;
    }

    wrap.appendChild(makeSlider('Star Amount', STAR_AMOUNT_TICKS, options.starCountIndex, (i) => {
        options.starCountIndex = i;
    }));
    wrap.appendChild(makeSlider('Physical Size', PHYSICAL_SIZE_TICKS, options.dimensionIndex, (i) => {
        options.dimensionIndex = i;
    }));

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
    wrap.appendChild(seedRow);

    // TODO(port): remaining wizard pages (playstyle, colonization/territory,
    // empire, other empires, victory conditions, quick start) —
    // Start.InitializeComponent.cs pnlStartNewGame* panels other than
    // pnlStartNewGameTheGalaxy / pnlStartNewGameRace.
    const moreTodo = document.createElement('div');
    moreTodo.className = 'wizard-todo';
    moreTodo.textContent = 'Other wizard pages (playstyle, colonization, empire, victory conditions) — coming later.';
    wrap.appendChild(moreTodo);

    return wrap;
}

// ---------------------------------------------------------------------------
// Your Race page (task 06d).
// ---------------------------------------------------------------------------

function titleCase(label: string): string {
    return label.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Small portrait img that falls back to the alternate race_<i>a.png
 * (Main.Part13.cs ~2195) when the primary one fails to load. */
function makeRacePortrait(pictureRef: number, altText: string, className: string): HTMLImageElement {
    const img = document.createElement('img');
    img.className = className;
    img.alt = altText;
    const urls = racePortraitUrls(pictureRef);
    img.src = urls[0];
    img.addEventListener('error', () => {
        if (urls.length > 1 && img.src !== urls[1]) {
            img.src = urls[1];
        }
    });
    return img;
}

function buildRacePage(options: StartGameOptions): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'wizard-page wizard-race-page';

    const loading = document.createElement('div');
    loading.className = 'wizard-race-loading';
    loading.textContent = 'Loading races…';
    wrap.appendChild(loading);

    void loadWizardRaceData()
        .then(({ races, families, missing }) => {
            loading.remove();
            if (races.length === 0) {
                const err = document.createElement('div');
                err.className = 'wizard-race-error';
                err.textContent = 'No race data available.';
                wrap.appendChild(err);
                return;
            }
            // Default selection: first playable race, sorted by name.
            if (options.raceName === '') {
                options.raceName = defaultRaceName(races);
            }
            renderRacePage(wrap, races, families, options);
            if (missing.length > 0) {
                const note = document.createElement('div');
                note.className = 'wizard-race-missing';
                note.textContent = `${missing.length} race file(s) not found in this install and are hidden: ${missing.join(', ')}.`;
                wrap.appendChild(note);
            }
        })
        .catch((err) => {
            loading.remove();
            const error = document.createElement('div');
            error.className = 'wizard-race-error';
            error.textContent = `Failed to load race data: ${String(err)}`;
            wrap.appendChild(error);
        });

    return wrap;
}

function renderRacePage(
    wrap: HTMLDivElement,
    races: Race[],
    families: RaceFamily[],
    options: StartGameOptions,
): void {
    const sorted = [...races].sort((a, b) => a.name.localeCompare(b.name));
    const familyName = (id: number): string =>
        families.find((f) => f.raceFamilyId === id)?.name ?? `Family ${id}`;

    const row = document.createElement('div');
    row.className = 'wizard-race-row';
    wrap.appendChild(row);

    // --- Left: scrollable list of all playable races (name + small portrait). ---
    const list = document.createElement('div');
    list.className = 'wizard-race-list';
    row.appendChild(list);

    // --- Right: large portrait, name, family, stats grid. ---
    const detail = document.createElement('div');
    detail.className = 'wizard-race-detail';
    row.appendChild(detail);

    const detailPortrait = document.createElement('div');
    detailPortrait.className = 'wizard-race-portrait-wrap';
    detail.appendChild(detailPortrait);

    const detailName = document.createElement('div');
    detailName.className = 'wizard-race-name';
    detail.appendChild(detailName);

    const detailFamily = document.createElement('div');
    detailFamily.className = 'wizard-race-family';
    detail.appendChild(detailFamily);

    const statsGrid = document.createElement('div');
    statsGrid.className = 'wizard-race-stats';
    detail.appendChild(statsGrid);

    function selectRace(race: Race): void {
        options.raceName = race.name;
        detailPortrait.replaceChildren(makeRacePortrait(race.pictureIndex, race.name, 'wizard-race-portrait'));
        detailName.textContent = race.name;
        detailFamily.textContent = `Family: ${familyName(race.raceFamily)}`;
        statsGrid.replaceChildren(...buildStatsCells(race));
        for (const item of list.children) {
            item.classList.toggle('selected', (item as HTMLElement).dataset.race === race.name);
        }
    }

    for (const race of sorted) {
        if (!race.playable) continue;
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'wizard-race-item';
        item.dataset.race = race.name;
        const thumb = makeRacePortrait(race.pictureIndex, race.name, 'wizard-race-thumb');
        item.appendChild(thumb);
        const nameSpan = document.createElement('span');
        nameSpan.textContent = race.name;
        item.appendChild(nameSpan);
        item.addEventListener('click', () => selectRace(race));
        list.appendChild(item);
    }

    const initial = sorted.find((r) => r.name === options.raceName) ?? sorted.find((r) => r.playable) ?? sorted[0];
    selectRace(initial);
}

/** Two-column grid cells for every numeric race stat field. */
function buildStatsCells(race: Race): HTMLElement[] {
    const cells: HTMLElement[] = [];
    for (const { key, label } of RACE_STAT_FIELDS) {
        const value = race[key];
        const cell = document.createElement('div');
        cell.className = 'wizard-race-stat';
        const labelEl = document.createElement('div');
        labelEl.className = 'wizard-race-stat-label';
        labelEl.textContent = titleCase(label);
        const valueEl = document.createElement('div');
        valueEl.className = 'wizard-race-stat-value';
        valueEl.textContent = typeof value === 'number' ? String(value) : String(value);
        cell.appendChild(labelEl);
        cell.appendChild(valueEl);
        cells.push(cell);
    }
    return cells;
}

// ---------------------------------------------------------------------------
// Start page (task 06d): summary of the chosen options before booting.
// ---------------------------------------------------------------------------

function buildStartPage(options: StartGameOptions): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'wizard-page wizard-start-page';

    const heading = document.createElement('div');
    heading.className = 'wizard-start-heading';
    heading.textContent = 'Start a New Game';
    wrap.appendChild(heading);

    const summary = document.createElement('div');
    summary.className = 'wizard-start-summary';
    wrap.appendChild(summary);

    const note = document.createElement('div');
    note.className = 'wizard-todo';
    note.textContent = 'Press “Start Game” to generate your galaxy.';
    wrap.appendChild(note);

    function refreshSummary(): void {
        const shapeOpt = SHAPE_OPTIONS.find((o) => o.shape === options.shape) ?? SHAPE_OPTIONS[1];
        const rows: Array<[string, string]> = [
            ['Galaxy Shape', shapeOpt.label],
            ['Star Amount', STAR_AMOUNT_TICKS[options.starCountIndex] ?? `${starCountFor(options.starCountIndex)} stars`],
            ['Physical Size', PHYSICAL_SIZE_TICKS[options.dimensionIndex] ?? `${sectorsFor(options.dimensionIndex)}×${sectorsFor(options.dimensionIndex)} sectors`],
            ['Your Race', options.raceName || '(not chosen)'],
            ['Seed', String(options.seed)],
        ];
        summary.replaceChildren(...rows.map(([k, v]) => {
            const line = document.createElement('div');
            line.className = 'wizard-start-line';
            const keyEl = document.createElement('span');
            keyEl.className = 'wizard-start-key';
            keyEl.textContent = k;
            const valEl = document.createElement('span');
            valEl.className = 'wizard-start-value';
            valEl.textContent = v;
            line.appendChild(keyEl);
            line.appendChild(valEl);
            return line;
        }));
    }

    // Expose the refresher to the wizard shell (which calls it when this
    // page is shown, so the summary reflects the latest option edits).
    (wrap as unknown as { __refresh?: () => void }).__refresh = refreshSummary;
    refreshSummary();

    return wrap;
}

/** Re-exported for convenience (main.ts maps wizard options -> generateGalaxy). */
export { starCountFor, sectorsFor };