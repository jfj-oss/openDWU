// New-game wizard (tasks 06b/06d/06e): The Galaxy → Your Race → Your Empire
// → Start pages.
// Port of the visual layout of Start.InitializeComponent.cs pnlStartNewGame*
// panels, modernised like the HUD panels. "The Galaxy" page is task 06b;
// "Your Race" (race list + portrait/stats detail) is task 06d; "Your Empire"
// (name / government / flag) and the final summary "Start" page are tasks
// 06e/06d.
import './newGameWizard.css';
import { GalaxyShape } from '../../sim/types';
import {
    applyEmpireDefaults,
    defaultRaceName,
    defaultStartGameOptions,
    FLAG_COLOR_PALETTE,
    flagShapeUrl,
    sectorsFor,
    starCountFor,
    type StartGameOptions,
} from '../../sim/startGameOptions';
import { parseRace, type Race } from '../../sim/data/races';
import { parseRaceFamilies, type RaceFamily } from '../../sim/data/raceFamilies';
import { parseGovernments, type Government } from '../../sim/data/governments';
import { fetchText } from '../../sim/data/fetchData';
import { resolveDataUrl } from '../../sim/data/paths';

const CHROME = '/assets/dwu/images/ui/chrome/';
const RACES_DIR = '/assets/dwu/images/units/races/';

/** Task 06e: race name → index among playable races (sorted by name), the
 * same ordering the "Your Race" page lists them in. Filled lazily by
 * loadWizardRaceData; falls back to 0 until then. */
export const PLAYABLE_RACE_INDEX = new Map<string, number>();

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

/** Task 06e: called when the user picks a different race on the "Your Race"
 * page, so the "Your Empire" page can re-apply its defaults (empire name,
 * flag colours). `prevRaceName` is the previously selected race. */
export type WizardRaceChangedHandler = (raceName: string, prevRaceName?: string) => void;

export interface NewGameWizardRefs {
    root: HTMLDivElement;
    destroy: () => void;
}

/** Wizard page ids / navigation order (task 06e): The Galaxy → Your Race →
 * Your Empire → Start. */
export type WizardPageId = 'galaxy' | 'race' | 'empire' | 'start';
export const WIZARD_PAGES: WizardPageId[] = ['galaxy', 'race', 'empire', 'start'];

/** Title-bar text per page ("Start a New Game: <page title>"). */
export const WIZARD_PAGE_TITLES: Record<WizardPageId, string> = {
    galaxy: 'The Galaxy',
    race: 'Your Race',
    empire: 'Your Empire',
    start: 'Start',
};

/** Footer back-button label per page. */
export const WIZARD_BACK_LABELS: Record<WizardPageId, string> = {
    galaxy: '← Main Menu',
    race: '← The Galaxy',
    empire: '← Your Race',
    start: '← Your Empire',
};

/** Footer forward-button label per page. */
export const WIZARD_FORWARD_LABELS: Record<WizardPageId, string> = {
    galaxy: 'Next →',
    race: 'Next →',
    empire: 'Next →',
    start: 'Start Game',
};

/** Task 06e: the key numeric modifiers shown in the small two-column table
 * under the government dropdown (fields of the parsed Government, see
 * src/sim/data/governments.ts). */
export const GOVERNMENT_MODIFIER_FIELDS: ReadonlyArray<{ key: keyof Government; label: string }> = [
    { key: 'corruption', label: 'Corruption' },
    { key: 'warWeariness', label: 'War Weariness' },
    { key: 'maintenanceCosts', label: 'Maintenance Costs' },
    { key: 'approvalRating', label: 'Approval Rating' },
    { key: 'populationGrowth', label: 'Population Growth' },
    { key: 'researchSpeed', label: 'Research Speed' },
    { key: 'troopRecruitment', label: 'Troop Recruitment' },
    { key: 'tradeBonus', label: 'Trade Bonus' },
    { key: 'stability', label: 'Stability' },
];

/** Task 06e: governments available to a new player empire at start. The
 * original's Government type carries an availability field (0 = all empires)
 * plus specialFunctionCode — storyline-only governments have a non-zero
 * special function (e.g. 1 = nationalize private sector), so both are
 * excluded here. */
export function filterStartGovernments(governments: Government[]): Government[] {
    return governments.filter((g) => g.availability === 0 && g.specialFunctionCode === 0);
}

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
    cachedRaces = races;
    // Task 06e: record each playable race's index in the sorted list so the
    // "Your Empire" page can derive deterministic flag colours by race index.
    [...races]
        .filter((r) => r.playable)
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((r, i) => PLAYABLE_RACE_INDEX.set(r.name, i));
    return { races, families, missing };
}

/** True when a fetched data body is a real DW:U .txt file (starts with the
 * "'Distant Worlds" comment line) rather than the dev server's HTML 404
 * fallback for a missing file. */
function isRaceFileText(text: string): boolean {
    const first = text.split(/\r\n|\r|\n/, 1)[0]?.trimStart() ?? '';
    return first.startsWith("'");
}

/** Build the new-game wizard (Galaxy → Your Race → Your Empire → Start) and
 * append it to document.body. When opened via ?screen=wizard&page=empire the
 * wizard starts on the named page (screenshot/dev hook; main.ts does not pass
 * the page). */
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
    const racePage = buildRacePage(options, handleRaceChanged);
    const empirePage = buildEmpirePage(options);
    const startPage = buildStartPage(options);
    const pageEls: Record<WizardPageId, HTMLElement> = {
        galaxy: galaxyPage,
        race: racePage,
        empire: empirePage,
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

    /** Task 06e: the "Your Race" page reports a new selection here so the
     * "Your Empire" page can re-derive its defaults. */
    function handleRaceChanged(raceName: string): void {
        const prev = options.raceName;
        options.raceName = raceName;
        const handler = (empirePage as unknown as { __onRaceChanged?: WizardRaceChangedHandler }).__onRaceChanged;
        if (handler) handler(raceName, prev);
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

function buildRacePage(options: StartGameOptions, onRaceChanged?: WizardRaceChangedHandler): HTMLDivElement {
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
            renderRacePage(wrap, races, families, options, onRaceChanged);
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
    onRaceChanged?: WizardRaceChangedHandler,
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
        // Task 06e: let the "Your Empire" page re-derive its defaults.
        onRaceChanged?.(race.name);
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

    // Task 06e: expose the race-changed hook to the wizard shell. The
    // initial selection above already ran onRaceChanged (which re-applies
    // the empire defaults for that race), so nothing else is needed here.
    if (onRaceChanged) {
        (wrap as unknown as { __raceChanged?: WizardRaceChangedHandler }).__raceChanged = onRaceChanged;
    }
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
// Your Empire page (task 06e): name, government, flag.
// ---------------------------------------------------------------------------

/** Task 06e: load governments.txt via the same URL resolution the engine
 * uses (Customization/<set>/ first, base last). A body that is not a real
 * DW:U .txt file (the dev server's HTML 404 fallback) yields no rows. */
/** Task 06e: the race's preferred starting government id, or -1 if the race
 * is unknown / has no preference. The "Your Empire" page uses this to preselect
 * a sensible default when the user hasn't chosen one yet. */
export function preferredGovernmentForRace(raceName: string): number {
    const races = loadWizardRacesSync();
    const race = races.find((r) => r.name === raceName);
    return race?.preferredStartingGovernment ?? -1;
}

/** Synchronous cache of the parsed races, populated by loadWizardRaceData.
 * (The wizard always loads race data before the empire page needs it.) */
let cachedRaces: Race[] | null = null;
function loadWizardRacesSync(): Race[] {
    return cachedRaces ?? [];
}

async function loadWizardGovernments(): Promise<Government[]> {
    const text = await fetchText(resolveDataUrl('governments.txt'));
    if (!isRaceFileText(text)) {
        return [];
    }
    return parseGovernments(text);
}

function buildEmpirePage(options: StartGameOptions): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'wizard-page wizard-empire-page';

    // --- Empire name ---
    const nameRow = document.createElement('div');
    nameRow.className = 'wizard-empire-name-row';
    const nameLabel = document.createElement('span');
    nameLabel.className = 'wizard-empire-label';
    nameLabel.textContent = 'Empire Name';
    nameRow.appendChild(nameLabel);
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'wizard-empire-name-input';
    nameInput.value = options.empireName;
    nameInput.addEventListener('input', () => {
        // Any user edit marks the name as customised — applyEmpireDefaults
        // will then leave it alone when the race changes.
        options.empireName = nameInput.value;
    });
    nameRow.appendChild(nameInput);
    wrap.appendChild(nameRow);

    // --- Government (dropdown + modifier table) ---
    const govSection = document.createElement('div');
    govSection.className = 'wizard-empire-gov';
    const govLabel = document.createElement('span');
    govLabel.className = 'wizard-empire-label';
    govLabel.textContent = 'Government';
    govSection.appendChild(govLabel);

    const govLoading = document.createElement('div');
    govLoading.className = 'wizard-race-loading';
    govLoading.textContent = 'Loading governments…';
    govSection.appendChild(govLoading);

    const govSelect = document.createElement('select');
    govSelect.className = 'wizard-empire-gov-select';
    govSelect.style.display = 'none';
    const govTable = document.createElement('table');
    govTable.className = 'wizard-empire-gov-table';
    govTable.style.display = 'none';
    govSection.appendChild(govSelect);
    govSection.appendChild(govTable);
    wrap.appendChild(govSection);

    let governments: Government[] = [];

    function selectedGovernment(): Government | null {
        return governments.find((g) => g.governmentId === options.governmentId) ?? null;
    }

    function renderGovModifiers(): void {
        const gov = selectedGovernment();
        if (gov === null) {
            govTable.replaceChildren();
            return;
        }
        const tbody = document.createElement('tbody');
        for (const { key, label } of GOVERNMENT_MODIFIER_FIELDS) {
            const value = gov[key];
            const tr = document.createElement('tr');
            const tdKey = document.createElement('td');
            tdKey.textContent = titleCase(label);
            const tdVal = document.createElement('td');
            tdVal.textContent = typeof value === 'number' ? String(value) : String(value);
            tr.appendChild(tdKey);
            tr.appendChild(tdVal);
            tbody.appendChild(tr);
        }
        govTable.replaceChildren(tbody);
    }

    function selectGovernment(id: number): void {
        options.governmentId = id;
        renderGovModifiers();
    }

    void loadWizardGovernments()
        .then((all) => {
            govLoading.remove();
            governments = filterStartGovernments(all);
            if (governments.length === 0) {
                const note = document.createElement('div');
                note.className = 'wizard-todo';
                note.textContent = 'No start-available government data found in this install.';
                govSection.appendChild(note);
                return;
            }
            // Default selection: the race's preferred starting government
            // when it is in the available list, else the first available one.
            if (options.governmentId < 0) {
                const preferred = preferredGovernmentForRace(options.raceName);
                options.governmentId =
                    preferred >= 0 && governments.some((g) => g.governmentId === preferred)
                        ? preferred
                        : governments[0].governmentId;
            }
            for (const g of governments) {
                const optEl = document.createElement('option');
                optEl.value = String(g.governmentId);
                optEl.textContent = g.name;
                optEl.selected = g.governmentId === options.governmentId;
                govSelect.appendChild(optEl);
            }
            govSelect.addEventListener('change', () => {
                selectGovernment(parseInt(govSelect.value, 10));
            });
            govSelect.style.display = '';
            govTable.style.display = '';
            renderGovModifiers();
        })
        .catch((err) => {
            govLoading.remove();
            const error = document.createElement('div');
            error.className = 'wizard-race-error';
            error.textContent = `Failed to load government data: ${String(err)}`;
            govSection.appendChild(error);
        });

    // --- Flag: shape grid + colour pickers + preview ---
    const flagSection = document.createElement('div');
    flagSection.className = 'wizard-empire-flag';
    const flagLabel = document.createElement('span');
    flagLabel.className = 'wizard-empire-label';
    flagLabel.textContent = 'Flag';
    flagSection.appendChild(flagLabel);

    const flagGrid = document.createElement('div');
    flagGrid.className = 'wizard-empire-flag-grid';
    flagSection.appendChild(flagGrid);

    const colorRow = document.createElement('div');
    colorRow.className = 'wizard-empire-color-row';
    for (const [labelText, prop] of [['Primary Colour', 'primaryColor'], ['Secondary Colour', 'secondaryColor']] as const) {
        const cell = document.createElement('div');
        cell.className = 'wizard-empire-color-cell';
        const span = document.createElement('span');
        span.textContent = labelText;
        const input = document.createElement('input');
        input.type = 'color';
        input.className = 'wizard-empire-color-input';
        input.value = options[prop] || '#808080';
        input.addEventListener('input', () => {
            options[prop] = input.value;
            updateFlagPreview();
        });
        cell.appendChild(span);
        cell.appendChild(input);
        colorRow.appendChild(cell);
    }
    flagSection.appendChild(colorRow);

    const previewWrap = document.createElement('div');
    previewWrap.className = 'wizard-empire-flag-preview-wrap';
    const previewBg = document.createElement('div');
    previewBg.className = 'wizard-empire-flag-preview-bg';
    const previewShape = document.createElement('div');
    previewShape.className = 'wizard-empire-flag-preview-shape';
    previewWrap.appendChild(previewBg);
    previewWrap.appendChild(previewShape);
    flagSection.appendChild(previewWrap);
    wrap.appendChild(flagSection);

    function updateFlagPreview(): void {
        const url = flagShapeUrl(options.flagShapeIndex >= 0 ? options.flagShapeIndex : 0);
        previewBg.style.background = options.primaryColor || '#808080';
        previewShape.style.backgroundColor = options.secondaryColor || '#ffffff';
        previewShape.style.maskImage = `url(${url})`;
        previewShape.style.webkitMaskImage = `url(${url})`;
        previewShape.style.maskSize = 'contain';
        previewShape.style.webkitMaskSize = 'contain';
        previewShape.style.maskRepeat = 'no-repeat';
        previewShape.style.webkitMaskRepeat = 'no-repeat';
        previewShape.style.maskPosition = 'center';
        previewShape.style.webkitMaskPosition = 'center';
    }

    function selectFlagShape(index: number): void {
        options.flagShapeIndex = index;
        for (const child of flagGrid.children) {
            (child as HTMLElement).classList.toggle('selected', Number((child as HTMLElement).dataset.index) === index);
        }
        updateFlagPreview();
    }

    for (let i = 0; i < 83; i++) {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'wizard-empire-flag-tile';
        tile.dataset.index = String(i);
        const img = document.createElement('img');
        img.src = flagShapeUrl(i);
        img.alt = `Flag shape ${i}`;
        img.loading = 'lazy';
        tile.appendChild(img);
        tile.addEventListener('click', () => selectFlagShape(i));
        flagGrid.appendChild(tile);
    }

    /** Task 06e: re-apply the "Your Empire" defaults when the race changes
     * (name auto-update rule + deterministic flag colours by race index),
     * then refresh the UI controls to match. */
    function onRaceChanged(raceName: string, prevRaceName?: string): void {
        const raceIndex = Math.max(0, PLAYABLE_RACE_INDEX.get(raceName) ?? 0);
        applyEmpireDefaults(options, raceIndex, prevRaceName);
        nameInput.value = options.empireName;
        const colorInputs = colorRow.querySelectorAll<HTMLInputElement>('input[type="color"]');
        if (colorInputs.length >= 2) {
            colorInputs[0].value = options.primaryColor;
            colorInputs[1].value = options.secondaryColor;
        }
        if (options.flagShapeIndex >= 0) {
            for (const child of flagGrid.children) {
                (child as HTMLElement).classList.toggle('selected', Number((child as HTMLElement).dataset.index) === options.flagShapeIndex);
            }
        }
        updateFlagPreview();
    }
    (wrap as unknown as { __onRaceChanged?: WizardRaceChangedHandler }).__onRaceChanged = onRaceChanged;

    // Initial paint: apply defaults once so the controls show something even
    // before any race has been picked (raceName '' → race index 0).
    onRaceChanged(options.raceName);

    return wrap;
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
            ['Empire Name', options.empireName || '(not set)'],
            ['Government', options.governmentId >= 0 ? `#${options.governmentId}` : '(not chosen)'],
            ['Flag', `shape ${options.flagShapeIndex} · ${options.primaryColor} / ${options.secondaryColor}`],
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