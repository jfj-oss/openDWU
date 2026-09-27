// New-game wizard (tasks 06b/06d/06e/06h): The Galaxy → Colonization and
// Territory → Your Race → Your Empire → Other Empires → Start pages.
// Port of the visual layout of Start.InitializeComponent.cs pnlStartNewGame*
// panels, modernised like the HUD panels. "The Galaxy" page is task 06b;
// "Colonization and Territory" is task 06h; "Your Race" (race list +
// portrait/stats detail) is task 06d; "Your Empire" (name / government /
// flag) and the final summary "Start" page are tasks 06e/06d; "Other
// Empires" is task 06h.
import './newGameWizard.css';
import { GalaxyShape, HabitatType } from '../../sim/types';

/** 'MarshySwamp' → 'Marshy Swamp'. */
function habitatTypeLabel(t: HabitatType): string {
    return (HabitatType[t] ?? String(t)).replace(/([a-z])([A-Z])/g, '$1 $2');
}
import {
    applyEmpireDefaults,
    COLONIZATION_RANGE_KLY_MAX,
    COLONIZATION_RANGE_KLY_MIN,
    COLONY_INFLUENCE_RANGE_PCT_MAX,
    COLONY_INFLUENCE_RANGE_PCT_MIN,
    defaultRaceName,
    defaultScenarioChoice,
    defaultStartGameOptions,
    FLAG_COLOR_PALETTE,
    scenarioChoiceSummary,
    flagShapeUrl,
    OTHER_EMPIRES_COUNT_MAX,
    OTHER_EMPIRES_COUNT_MIN,
    type ManualEmpireStart,
    sectorsFor,
    starCountFor,
    VICTORY_PERCENT_MIN,
    VICTORY_TIME_LIMIT_YEARS_MAX,
    VICTORY_TIME_LIMIT_YEARS_MIN,
    VICTORY_TIME_START_YEARS_MAX,
    VICTORY_TIME_START_YEARS_MIN,
    type StartGameOptions,
} from '../../sim/startGameOptions';
// [todosweep2] begin
import { GALAXY_RESEARCH_SPEED_MAX, GALAXY_RESEARCH_SPEED_MIN, researchBaseTechCostForSliderIndex, researchSpeedSliderIndexFor } from '../../sim/startGameOptions';
// [todosweep2] end
import { parseRace, type Race } from '../../sim/data/races';
import { parseRaceFamilies, type RaceFamily } from '../../sim/data/raceFamilies';
import { parseGovernments, type Government } from '../../sim/data/governments';
import { fetchText } from '../../sim/data/fetchData';
import { resolveDataUrl } from '../../sim/data/paths';
import { DEFAULT_RACE_FILES } from '../../sim/data/gameData';
import { loadScenarioIndex } from '../../sim/scenario/fetchScenario';
import type { ScenarioManifest } from '../../sim/scenario/manifest';

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

/** Task 06f: tick labels for the remaining "The Galaxy" sliders. Aggression,
 * Space Creatures and Pirates use the original UI's tick names (gameplay
 * frame); Colony Prevalence / Alien Life have no named ticks in the original,
 * so they are labelled Rare … Common evenly across their five cases (the
 * number of cases in their conversion methods). */
export const COLONY_PREVALENCE_TICKS = ['Rare', 'Uncommon', 'Less Common', 'Common', 'Very Common'];
export const ALIEN_LIFE_TICKS = ['Rare', 'Uncommon', 'Less Common', 'Common', 'Very Common'];
export const SPACE_CREATURES_TICKS = ['None', 'Few', 'Normal', 'Many'];
export const PIRATES_TICKS = ['None', 'Very Few', 'Few', 'Normal', 'Many', 'Very Many'];
export const AGGRESSION_TICKS = ['Peaceful', 'Normal', 'Restless', 'Unstable', 'Chaos'];
export const DIFFICULTY_TICKS = ['Easy', 'Normal', 'Hard', 'Very Hard', 'Extreme'];
/** Task M4x: "The Galaxy" Expansion slider labels (Start.cs 3166-3174). */
// [todosweep2] Start.cs 3200 tbarStartNewGameTheGalaxyResearchSpeed.SetLabels.
export const RESEARCH_COST_TICKS = ['Very Expensive', 'Expensive', 'Normal', 'Cheap', 'Very Cheap'];
export const EXPANSION_TICKS = ['Pre-Warp', 'Starting', 'Young', 'Expanding', 'Mature', 'Old'];
/** Task M4x: "Your Empire" size slider labels (Start.cs 3451-3459). */
export const EMPIRE_SIZE_TICKS = ['Random', 'Starting', 'Young', 'Expanding', 'Mature', 'Old'];
/** Task M4x: "Your Empire" tech-level slider labels (Start.cs 3460-3471). */
export const TECH_LEVEL_TICKS = ['Pre-Warp', 'Normal', 'Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5', 'Level 6', 'Level 7'];

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

/** Wizard page ids / navigation order (task 06e; task 06g inserts the
 * "Victory Conditions" page as the last page before Start; task 06h inserts
 * "Colonization and Territory" after The Galaxy and "Other Empires" between
 * Your Empire and Victory Conditions, matching the original): The Galaxy →
 * Colonization and Territory → Your Race → Your Empire → Other Empires →
 * Victory Conditions → Start. */
export type WizardPageId = 'galaxy' | 'colonization' | 'race' | 'empire' | 'empires' | 'victory' | 'scenario' | 'start';
/** The mod layer's "Scenario" page (tasks/MODLAYER-DESIGN.md §3) sits between Victory Conditions and Start. */
export const WIZARD_PAGES: WizardPageId[] = ['galaxy', 'colonization', 'race', 'empire', 'empires', 'victory', 'scenario', 'start'];

/** Title-bar text per page ("Start a New Game: <page title>"). */
export const WIZARD_PAGE_TITLES: Record<WizardPageId, string> = {
    galaxy: 'The Galaxy',
    colonization: 'Colonization and Territory',
    race: 'Your Race',
    empire: 'Your Empire',
    empires: 'Other Empires',
    victory: 'Victory Conditions',
    scenario: 'Scenario',
    start: 'Start',
};

/** Footer back-button label per page. */
export const WIZARD_BACK_LABELS: Record<WizardPageId, string> = {
    galaxy: '← Main Menu',
    colonization: '← The Galaxy',
    race: '← Colonization and Territory',
    empire: '← Your Race',
    empires: '← Your Empire',
    victory: '← Other Empires',
    scenario: '← Victory Conditions',
    start: '← Scenario',
};

/** Footer forward-button label per page: names the next page in the wizard
 * order (mirrors WIZARD_BACK_LABELS), except the last page which starts the
 * game rather than navigating. */
export const WIZARD_FORWARD_LABELS: Record<WizardPageId, string> = {
    galaxy: 'Colonization and Territory →',
    colonization: 'Your Race →',
    race: 'Your Empire →',
    empire: 'Other Empires →',
    empires: 'Victory Conditions →',
    victory: 'Scenario →',
    scenario: 'Start →',
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
    { key: 'nativeHabitatType', label: 'Native Planet Type' },
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

let wizardManifest: Promise<Record<string, unknown> | null> | null = null;
/** public/asset-manifest.json (folder listings the browser cannot make), fetched once. */
function loadWizardManifest(): Promise<Record<string, unknown> | null> {
    wizardManifest ??= fetchText(['/asset-manifest.json'])
        .then((t) => JSON.parse(t) as Record<string, unknown>)
        .catch(() => null);
    return wizardManifest;
}

/** Stock install flag shapes: images/ui/flagshapes/flag00.png … flag40.png. */
export const STOCK_FLAG_SHAPE_COUNT = 41;

/** Flag shape tile URLs, index = flag shape index. Port of Galaxy.4.cs
 * LoadFlagShapes: every *.png directly in images/ui/flagshapes/, sorted
 * (Array.Sort), the shape index being the position in that list; Start.cs 1348
 * fills cmbFlagShape with one item per loaded shape. The listing comes from
 * the asset manifest ("ui/flagshapes"); without it the stock 41 files. */
export function flagShapeTileUrls(manifestFlagShapes: unknown): string[] {
    if (Array.isArray(manifestFlagShapes)) {
        const files = manifestFlagShapes.filter((f): f is string => typeof f === 'string' && /\.png$/i.test(f));
        if (files.length > 0) return files.map((f) => `/assets/dwu/images/ui/flagshapes/${f}`);
    }
    return Array.from({ length: STOCK_FLAG_SHAPE_COUNT }, (_, i) => flagShapeUrl(i));
}

/** Placeholder of the empty "Empire Name" box. The original's default
 * YourEmpireName is "" (Main.Part9.cs 2686); an empty name makes the Empire
 * generate one from its race (Empire.cs 4482 GenerateEmpireName: race name —
 * or, for Humans and half the others, the capital's star — plus a
 * government noun such as "Empire"), which src/sim/empire.ts ports. */
export function empireNamePlaceholder(raceName: string): string {
    return raceName === '' ? 'Generated at start' : `Generated at start, e.g. "${raceName} Empire"`;
}

/** The race files the wizard loads: the races/ folder listing from the asset
 * manifest (Galaxy.LoadRaces reads the whole folder, Start.cs 1318), else the
 * stock install's 22 files (gameData.ts DEFAULT_RACE_FILES). */
export function wizardRaceFiles(manifestRaces: unknown): string[] {
    if (Array.isArray(manifestRaces)) {
        const files = manifestRaces.filter((f): f is string => typeof f === 'string' && /\.txt$/i.test(f));
        if (files.length > 0) return files;
    }
    return [...DEFAULT_RACE_FILES];
}

/** Races offered on "Your Race": RaceList.ResolvePlayableRaces (Start.cs 1321)
 * keeps the races whose Playable flag is set; the list is sorted by name
 * (raceList_0.Sort(), Start.cs 1328). */
export function playableRacesSorted(races: readonly Race[]): Race[] {
    return races.filter((r) => r.playable).sort((a, b) => a.name.localeCompare(b.name));
}

/** Load all races (races/*.txt) plus raceFamilies.txt via the same URL
 * resolution the engine uses (Customization/<set>/ first, base last). A race
 * file that is absent from the install (or a customization set) makes the dev
 * server answer with its SPA index.html fallback instead of the .txt — we
 * detect that and skip the file rather than parsing garbage, so a partial
 * install still lists every race it actually has. */
async function loadWizardRaceData(): Promise<{ races: Race[]; families: RaceFamily[]; missing: string[] }> {
    // Galaxy.LoadRaces (Start.cs 1318) reads every file of the races/ folder;
    // the asset manifest is that folder listing (same source loadGameData uses).
    const raceFiles = wizardRaceFiles((await loadWizardManifest())?.races);
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
    playableRacesSorted(races).forEach((r, i) => PLAYABLE_RACE_INDEX.set(r.name, i));
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
    const colonizationPage = buildColonizationPage(options);
    const racePage = buildRacePage(options, handleRaceChanged);
    const empirePage = buildEmpirePage(options);
    const empiresPage = buildOtherEmpiresPage(options);
    const victoryPage = buildVictoryPage(options);
    const scenarioPage = buildScenarioPage(options);
    const startPage = buildStartPage(options);
    const pageEls: Record<WizardPageId, HTMLElement> = {
        galaxy: galaxyPage,
        colonization: colonizationPage,
        race: racePage,
        empire: empirePage,
        empires: empiresPage,
        victory: victoryPage,
        scenario: scenarioPage,
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

    // Keyboard nav: Enter advances (like clicking the primary button), Esc
    // always exits straight to the main menu (matches the ✕ close button,
    // not the per-page "Back" button, so it's a predictable "cancel" key).
    function onKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Enter') {
            // Let a <select> keep its own Enter handling (closing/confirming
            // its native dropdown) rather than also advancing the wizard.
            if ((e.target as HTMLElement | null)?.tagName === 'SELECT') return;
            e.preventDefault();
            goForward();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            callbacks.onBackToMenu();
        }
    }
    document.addEventListener('keydown', onKeyDown);

    document.body.appendChild(overlay);
    showPage(page);

    return {
        root: overlay,
        destroy: () => {
            document.removeEventListener('keydown', onKeyDown);
            overlay.remove();
        },
    };
}

// ---------------------------------------------------------------------------
// The Galaxy page (task 06b).
// ---------------------------------------------------------------------------

// A titled range slider with one label per tick (task 06c/06f; shared by the galaxy and empire pages).
function makeWizardSlider(title: string, ticks: string[], defaultIndex: number, onChange: (i: number) => void): HTMLDivElement {
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

    // --- Sliders (makeWizardSlider) ---
    const makeSlider = makeWizardSlider;

    // Two-column grid for all 9 sliders (task 06f adds the 6 below Star; M4x adds Expansion
    // Amount / Physical Size) — keeps the whole page visible without
    // scrolling instead of one long single column.
    const sliderGrid = document.createElement('div');
    sliderGrid.className = 'wizard-slider-grid';
    wrap.appendChild(sliderGrid);

    sliderGrid.appendChild(makeSlider('Star Amount', STAR_AMOUNT_TICKS, options.starCountIndex, (i) => {
        options.starCountIndex = i;
    }));
    sliderGrid.appendChild(makeSlider('Physical Size', PHYSICAL_SIZE_TICKS, options.dimensionIndex, (i) => {
        options.dimensionIndex = i;
    }));
    sliderGrid.appendChild(makeSlider('Colony Prevalence', COLONY_PREVALENCE_TICKS, options.colonyPrevalenceIndex, (i) => {
        options.colonyPrevalenceIndex = i;
    }));
    sliderGrid.appendChild(makeSlider('Alien Life', ALIEN_LIFE_TICKS, options.alienLifeIndex, (i) => {
        options.alienLifeIndex = i;
    }));
    sliderGrid.appendChild(makeSlider('Space Creatures', SPACE_CREATURES_TICKS, options.spaceCreaturesIndex, (i) => {
        options.spaceCreaturesIndex = i;
    }));
    sliderGrid.appendChild(makeSlider('Pirates', PIRATES_TICKS, options.piratesIndex, (i) => {
        options.piratesIndex = i;
    }));
    sliderGrid.appendChild(makeSlider('Aggression', AGGRESSION_TICKS, options.aggressionIndex, (i) => {
        options.aggressionIndex = i;
    }));
    sliderGrid.appendChild(makeSlider('Difficulty', DIFFICULTY_TICKS, options.difficultyIndex, (i) => {
        options.difficultyIndex = i;
    }));
    // Task M4x: tbarStartNewGameTheGalaxyExpansion (Start.cs 3166, "Expansion") → Galaxy.Age.
    sliderGrid.appendChild(makeSlider('Expansion', EXPANSION_TICKS, options.galaxyExpansionIndex ?? 1, (i) => {
        options.galaxyExpansionIndex = i;
    }));

    // [todosweep2] begin
    // "Research Costs" (tbarStartNewGameTheGalaxyResearchSpeed, Start.cs 3200 labels) + the research-cost box
    // (numStartNewGameTheGalaxyResearchBaseTech, 1..999 thousands). The slider only writes the box (Start.1.cs 4408
    // meEawywtba / 1000); the box value is what the game uses (Start.1.cs 3693 × 1000 → Galaxy.BaseTechCost).
    {
        const researchSlider = makeSlider('Research Costs', RESEARCH_COST_TICKS, researchSpeedSliderIndexFor((options.galaxyResearchSpeed ?? 120) * 1000), (i) => {
            options.galaxyResearchSpeed = researchBaseTechCostForSliderIndex(i) / 1000;
            researchBox.value = String(options.galaxyResearchSpeed);
        });
        const researchBox = document.createElement('input');
        researchBox.type = 'number';
        researchBox.className = 'wizard-research-base-tech';
        researchBox.min = String(GALAXY_RESEARCH_SPEED_MIN);
        researchBox.max = String(GALAXY_RESEARCH_SPEED_MAX);
        researchBox.value = String(options.galaxyResearchSpeed ?? 120);
        researchBox.title = 'Base research cost (thousands)';
        researchBox.addEventListener('input', () => {
            const v = parseInt(researchBox.value, 10);
            if (!Number.isNaN(v)) options.galaxyResearchSpeed = Math.min(GALAXY_RESEARCH_SPEED_MAX, Math.max(GALAXY_RESEARCH_SPEED_MIN, v));
        });
        const researchBoxLabel = document.createElement('span');
        researchBoxLabel.textContent = 'K';
        researchSlider.appendChild(researchBox);
        researchSlider.appendChild(researchBoxLabel);
        sliderGrid.appendChild(researchSlider);
    }
    // [todosweep2] end

    // "Difficulty scales as player nears victory" (chkStartNewGameTheGalaxyDifficultyScaling).
    const scalingRow = document.createElement('label');
    scalingRow.className = 'wizard-checkbox';
    const scalingCheck = document.createElement('input');
    scalingCheck.type = 'checkbox';
    scalingCheck.checked = options.difficultyScaling;
    scalingCheck.addEventListener('change', () => {
        options.difficultyScaling = scalingCheck.checked;
    });
    scalingRow.appendChild(scalingCheck);
    const scalingText = document.createElement('span');
    scalingText.textContent = 'Difficulty scales as player nears victory';
    scalingRow.appendChild(scalingText);
    wrap.appendChild(scalingRow);

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

    return wrap;
}

// ---------------------------------------------------------------------------
// Colonization and Territory page (task 06h). Port of the visual layout of
// Start.InitializeComponent.cs pnlStartNewGameColonizationTerritory controls.
// ---------------------------------------------------------------------------

/** Task 06h: a "Title — <range slider> — value label" row bound to one of
 * the colonization page's numeric sliders, clamped into [min, max] on input.
 * `format` renders the current value (e.g. "4000K", "100%") in the single
 * value badge next to the slider — there is no separate raw-number label. */
function makeColonizationSlider(
    wrap: HTMLDivElement,
    title: string,
    min: number,
    max: number,
    get: () => number,
    set: (v: number) => void,
    format: (v: number) => string,
): HTMLSpanElement {
    const sliderWrap = document.createElement('div');
    sliderWrap.className = 'wizard-slider';
    const titleRow = document.createElement('div');
    titleRow.className = 'wizard-slider-title-row';
    const label = document.createElement('div');
    label.className = 'wizard-slider-title';
    label.textContent = title;
    titleRow.appendChild(label);

    const value = document.createElement('span');
    value.className = 'wizard-colonization-value';
    function paint(): void {
        value.textContent = format(get());
    }
    paint();
    titleRow.appendChild(value);
    sliderWrap.appendChild(titleRow);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = '1';
    input.value = String(get());
    input.addEventListener('input', () => {
        const v = parseInt(input.value, 10);
        if (!Number.isNaN(v)) {
            set(Math.min(max, Math.max(min, v)));
            paint();
        }
    });
    sliderWrap.appendChild(input);

    wrap.appendChild(sliderWrap);
    return value;
}

function buildColonizationPage(options: StartGameOptions): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'wizard-page wizard-colonization-page';
    const c = options.colonization;

    // --- Enforce Colonization Range Limits group box
    // (grpStartNewGameColonizationTerritoryColonizationRange). ---
    const rangeGroup = document.createElement('div');
    rangeGroup.className = 'wizard-colonization-group';

    const enforceRow = document.createElement('label');
    enforceRow.className = 'wizard-checkbox';
    const enforceCheck = document.createElement('input');
    enforceCheck.type = 'checkbox';
    enforceCheck.checked = c.enforceRangeLimits;
    enforceCheck.addEventListener('change', () => {
        c.enforceRangeLimits = enforceCheck.checked;
    });
    enforceRow.appendChild(enforceCheck);
    const enforceText = document.createElement('span');
    enforceText.textContent = 'Enforce Colonization Range Limits';
    enforceRow.appendChild(enforceText);
    rangeGroup.appendChild(enforceRow);

    // Colonization Range (lbl…ColonizationRangeTitle / Value, sld…colorSlider2).
    makeColonizationSlider(rangeGroup, 'Colonization Range', COLONIZATION_RANGE_KLY_MIN, COLONIZATION_RANGE_KLY_MAX,
        () => c.colonizationRangeKly, (x) => {
            c.colonizationRangeKly = x;
        }, (v) => `${v}K`);

    // Colony Influence Range (lbl…ColonyInfluenceRange* / Suggestion,
    // sld…colorSlider1), shown as a percent.
    makeColonizationSlider(rangeGroup, 'Colony Influence Range', COLONY_INFLUENCE_RANGE_PCT_MIN, COLONY_INFLUENCE_RANGE_PCT_MAX,
        () => c.colonyInfluenceRangePercent, (x) => {
            c.colonyInfluenceRangePercent = x;
        }, (v) => `${v}%`);
    const suggestion = document.createElement('span');
    suggestion.className = 'wizard-colonization-suggestion';
    suggestion.textContent = 'Suggestion';
    rangeGroup.appendChild(suggestion);
    wrap.appendChild(rangeGroup);

    // --- Allow same-system option (chkOptionsAllowSameSystemAsOtherEmpires). ---
    const sameSystemRow = document.createElement('label');
    sameSystemRow.className = 'wizard-checkbox';
    const sameSystemCheck = document.createElement('input');
    sameSystemCheck.type = 'checkbox';
    sameSystemCheck.checked = c.allowSameSystemAsOtherEmpires;
    sameSystemCheck.addEventListener('change', () => {
        c.allowSameSystemAsOtherEmpires = sameSystemCheck.checked;
    });
    sameSystemRow.appendChild(sameSystemCheck);
    const sameSystemText = document.createElement('span');
    sameSystemText.textContent = 'Allow colonization and mining stations in other empires systems';
    sameSystemRow.appendChild(sameSystemText);
    wrap.appendChild(sameSystemRow);

    return wrap;
}

/**
 * Task 19k-1a (Big Galaxies): a headless soak at 60 total empires / 1400 stars measured ~335 game-days/min of
 * throughput (300 game-s wall-clock, single run, seed 1) — well clear of the ~36 game-days/min real-time budget
 * (RealSecondsInGalacticYear 600 = 365 game-days, so 1x speed needs ~36.5 days/min). That comfortably covers the
 * "Big galaxies" 60-empire cap, so this is informational, not a hard limit — OTHER_EMPIRES_COUNT_MAX stays 100 and
 * higher counts are simply unmeasured (the wizard cap was already 100 before this task; this task did not raise or
 * lower it). `totalEmpireCount` is the game's total empire count (this many other empires + the player).
 */
export function empireCountPerformanceNote(totalEmpireCount: number): string | null {
    if (totalEmpireCount <= 60) return null;
    return (
        `${totalEmpireCount} empires (including you) is above the measured 60-empire / 1400-star range, which comfortably ` +
        'holds real-time speed on this machine. Higher counts have not been speed-tested and may run slower than ' +
        'real time, especially on slower machines.'
    );
}

// ---------------------------------------------------------------------------
// Other Empires page (task 06h). Port of the visual layout of
// Start.InitializeComponent.cs pnlStartNewGameOtherEmpires controls.
// ---------------------------------------------------------------------------

function buildOtherEmpiresPage(options: StartGameOptions): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'wizard-page wizard-empires-page';
    const o = options.otherEmpires;

    // Group the auto-generate controls in a panel, matching the boxed
    // sections used on the Colonization and Victory Conditions pages.
    const autoGroup = document.createElement('div');
    autoGroup.className = 'wizard-panel-group';
    wrap.appendChild(autoGroup);

    // --- Auto-Generate Starting Empires (chkOtherEmpiresAutogenerate). ---
    const autoRow = document.createElement('label');
    autoRow.className = 'wizard-checkbox';
    const autoCheck = document.createElement('input');
    autoCheck.type = 'checkbox';
    autoCheck.checked = o.autogenerate;
    autoCheck.addEventListener('change', () => {
        o.autogenerate = autoCheck.checked;
    });
    autoRow.appendChild(autoCheck);
    const autoText = document.createElement('span');
    autoText.textContent = 'Auto-Generate Starting Empires';
    autoRow.appendChild(autoText);
    autoGroup.appendChild(autoRow);

    // --- "Generate <n> starting empires" (lbl…AutoGenNumberDescrip1/2). ---
    const countRow = document.createElement('div');
    countRow.className = 'wizard-empires-count-row';
    const pre = document.createElement('span');
    pre.textContent = 'Generate';
    countRow.appendChild(pre);
    const countInput = document.createElement('input');
    countInput.type = 'number';
    countInput.className = 'wizard-empires-count-input';
    countInput.min = String(OTHER_EMPIRES_COUNT_MIN);
    countInput.max = String(OTHER_EMPIRES_COUNT_MAX);
    countInput.step = '1';
    countInput.value = String(o.empireCount);
    countInput.addEventListener('input', () => {
        const v = parseInt(countInput.value, 10);
        if (!Number.isNaN(v)) {
            o.empireCount = Math.min(OTHER_EMPIRES_COUNT_MAX, Math.max(OTHER_EMPIRES_COUNT_MIN, v));
        }
    });
    countRow.appendChild(countInput);
    const post = document.createElement('span');
    post.textContent = 'starting empires';
    countRow.appendChild(post);
    autoGroup.appendChild(countRow);

    // Task 19k-1a: informational note once the total empire count (this many + the player) goes above the
    // measured 60-empire / 1400-star range. Refreshed by paintPreview (count changes, manual-list changes).
    const perfNote = document.createElement('div');
    perfNote.className = 'wizard-todo wizard-empires-perf-note';
    autoGroup.appendChild(perfNote);

    // --- OR specify the starting empires below (lbl…OR). Task 06j: the
    // original lists each AI empire here for manual editing — an editable row
    // per empire with race / government pickers and a name field. ---
    const orLabel = document.createElement('div');
    orLabel.className = 'wizard-empires-or';
    orLabel.textContent = 'OR specify the starting empires below';
    wrap.appendChild(orLabel);

    const listPreview = document.createElement('div');
    listPreview.className = 'wizard-empires-list-preview';

    const listWrap = document.createElement('div');
    listWrap.className = 'wizard-empires-manual-wrap';
    wrap.appendChild(listWrap);

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'wizard-btn wizard-btn-secondary wizard-empires-add-btn';
    addBtn.textContent = 'Add empire';
    wrap.appendChild(addBtn);

    let governments: Government[] = [];
    function playableRaces(): Race[] {
        return loadWizardRacesSync()
            .filter((r) => r.playable)
            .sort((a, b) => a.name.localeCompare(b.name));
    }
    /** Task 06j: default display name for a manual empire row ("<Race> Empire"). */
    function defaultEmpireName(raceName: string): string {
        return `${raceName} Empire`;
    }
    function paintPreview(): void {
        if (o.manual.length > 0) {
            listPreview.textContent = `Manual list — ${o.manual.length} specified empire${o.manual.length === 1 ? '' : 's'} (overrides auto-generation)`;
        } else {
            listPreview.textContent = o.autogenerate
                ? `${o.empireCount} ${o.empireCount === 1 ? 'empire' : 'empires'} will be generated`
                : `No manual empires — ${o.empireCount} random empires (auto-generation off)`;
        }
        // Task 19k-1a: the effective other-empires count is the manual list when non-empty, else empireCount
        // (matches the preview text above); +1 for the player.
        const otherEmpiresCount = o.manual.length > 0 ? o.manual.length : o.empireCount;
        const note = empireCountPerformanceNote(otherEmpiresCount + 1);
        perfNote.textContent = note ?? '';
        perfNote.style.display = note === null ? 'none' : '';
    }

    // One editable row per manual empire (task 06j): race dropdown,
    // government dropdown, name text input, remove ✕.
    function makeRow(m: ManualEmpireStart): HTMLDivElement {
        const row = document.createElement('div');
        row.className = 'wizard-empires-row';

        const raceSelect = document.createElement('select');
        raceSelect.className = 'wizard-empires-race-select';
        for (const r of playableRaces()) {
            const opt = document.createElement('option');
            opt.value = r.name;
            opt.textContent = r.name;
            opt.selected = r.name === m.race;
            raceSelect.appendChild(opt);
        }
        if (!playableRaces().some((r) => r.name === m.race)) {
            const opt = document.createElement('option');
            opt.value = m.race;
            opt.textContent = m.race;
            raceSelect.appendChild(opt);
        }
        raceSelect.addEventListener('change', () => {
            m.race = raceSelect.value;
            if (m.name === '') {
                m.name = defaultEmpireName(m.race);
                nameInput.value = m.name;
            }
        });
        row.appendChild(raceSelect);

        const govSelect = document.createElement('select');
        govSelect.className = 'wizard-empires-gov-select';
        const noneOpt = document.createElement('option');
        noneOpt.value = '-1';
        noneOpt.textContent = '(Random)';
        noneOpt.selected = m.governmentId < 0;
        govSelect.appendChild(noneOpt);
        for (const g of governments) {
            const opt = document.createElement('option');
            opt.value = String(g.governmentId);
            opt.textContent = g.name;
            opt.selected = g.governmentId === m.governmentId;
            govSelect.appendChild(opt);
        }
        govSelect.addEventListener('change', () => {
            m.governmentId = parseInt(govSelect.value, 10);
        });
        row.appendChild(govSelect);

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'wizard-empires-name-input';
        nameInput.placeholder = defaultEmpireName(m.race);
        nameInput.value = m.name;
        nameInput.addEventListener('input', () => {
            m.name = nameInput.value;
        });
        row.appendChild(nameInput);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'wizard-empires-remove-btn';
        removeBtn.title = 'Remove empire';
        removeBtn.textContent = '✕';
        removeBtn.addEventListener('click', () => {
            const i = o.manual.indexOf(m);
            if (i >= 0) o.manual.splice(i, 1);
            row.remove();
            paintList();
        });
        row.appendChild(removeBtn);

        return row;
    }

    function paintList(): void {
        listWrap.replaceChildren(...o.manual.map(makeRow));
        addBtn.disabled = o.manual.length >= OTHER_EMPIRES_COUNT_MAX;
        paintPreview();
    }

    addBtn.addEventListener('click', () => {
        if (o.manual.length >= OTHER_EMPIRES_COUNT_MAX) return;
        const races = playableRaces();
        const race = races[0]?.name ?? '';
        o.manual.push({ race, governmentId: -1, name: race === '' ? '' : defaultEmpireName(race) });
        paintList();
    });

    paintPreview();
    wrap.appendChild(listPreview);
    autoCheck.addEventListener('change', paintPreview);
    countInput.addEventListener('input', paintPreview);

    // Load race + government data (both are already loaded by the time the
    // user reaches this page, but re-load defensively like buildEmpirePage),
    // then render any pre-existing rows.
    const loading = document.createElement('div');
    loading.className = 'wizard-race-loading';
    loading.textContent = 'Loading races and governments…';
    listWrap.appendChild(loading);
    Promise.all([loadWizardRaceData(), loadWizardGovernments()])
        .then(([, allGovs]) => {
            loading.remove();
            governments = filterStartGovernments(allGovs);
            paintList();
        })
        .catch(() => {
            loading.remove();
            const err = document.createElement('div');
            err.className = 'wizard-race-error';
            err.textContent = 'Failed to load race/government data for the manual empire list.';
            listWrap.appendChild(err);
        });

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
        // Native planet type: show the resolved HabitatType name (Race.cs
        // stores NativeHabitatType, not the raw races.txt index).
        valueEl.textContent = key === 'nativeHabitatType' ? habitatTypeLabel(value as HabitatType) : String(value);
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
    // The name stays empty (engine-generated, see empireNamePlaceholder)
    // until the user types one; a typed name survives race changes.
    let nameCustomised = options.empireName !== '';
    nameInput.addEventListener('input', () => {
        options.empireName = nameInput.value.trim() === '' ? '' : nameInput.value;
        nameCustomised = options.empireName !== '';
    });
    nameRow.appendChild(nameInput);
    wrap.appendChild(nameRow);

    // --- Task M4x: size (tbarStartNewGameYourEmpireSize) and tech level (tbarStartNewGameYourEmpireTechLevel). ---
    const eraGrid = document.createElement('div');
    eraGrid.className = 'wizard-slider-grid';
    eraGrid.appendChild(makeWizardSlider('Size', EMPIRE_SIZE_TICKS, options.empireExpansionIndex ?? 1, (i) => {
        options.empireExpansionIndex = i;
    }));
    eraGrid.appendChild(makeWizardSlider('Tech Level', TECH_LEVEL_TICKS, options.empireTechLevelIndex ?? 1, (i) => {
        options.empireTechLevelIndex = i;
    }));
    wrap.appendChild(eraGrid);

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

    // --- Flag: colour pickers + preview (header row, always visible) then
    // the shape grid below in its own scroll box, so 83 tiles don't push the
    // colour/preview controls off the bottom of the page (overflow fix). ---
    const flagSection = document.createElement('div');
    flagSection.className = 'wizard-empire-flag';
    const flagLabel = document.createElement('span');
    flagLabel.className = 'wizard-empire-label';
    flagLabel.textContent = 'Flag';
    flagSection.appendChild(flagLabel);

    const flagHeaderRow = document.createElement('div');
    flagHeaderRow.className = 'wizard-empire-flag-header';
    flagSection.appendChild(flagHeaderRow);

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
    flagHeaderRow.appendChild(colorRow);

    const previewWrap = document.createElement('div');
    previewWrap.className = 'wizard-empire-flag-preview-wrap';
    const previewBg = document.createElement('div');
    previewBg.className = 'wizard-empire-flag-preview-bg';
    const previewShape = document.createElement('div');
    previewShape.className = 'wizard-empire-flag-preview-shape';
    previewWrap.appendChild(previewBg);
    previewWrap.appendChild(previewShape);
    flagHeaderRow.appendChild(previewWrap);

    const flagGrid = document.createElement('div');
    flagGrid.className = 'wizard-empire-flag-grid';
    flagSection.appendChild(flagGrid);
    wrap.appendChild(flagSection);

    function updateFlagPreview(): void {
        const url = shapeUrl(options.flagShapeIndex >= 0 ? options.flagShapeIndex : 0);
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

    let flagUrls: string[] = flagShapeTileUrls(undefined);
    const shapeUrl = (i: number): string => flagUrls[i] ?? flagShapeUrl(i);
    function buildFlagTiles(): void {
        flagGrid.replaceChildren();
        flagUrls.forEach((url, i) => {
            const tile = document.createElement('button');
            tile.type = 'button';
            tile.className = 'wizard-empire-flag-tile';
            tile.dataset.index = String(i);
            tile.classList.toggle('selected', i === options.flagShapeIndex);
            const img = document.createElement('img');
            img.src = url;
            img.alt = `Flag shape ${i}`;
            img.loading = 'lazy';
            tile.appendChild(img);
            tile.addEventListener('click', () => selectFlagShape(i));
            flagGrid.appendChild(tile);
        });
    }
    /** A default shape index past the loaded shapes wraps (Start.1.cs 3453
     * only selects YourEmpireFlagShape when it is below the item count). */
    function clampFlagShape(): void {
        if (options.flagShapeIndex >= flagUrls.length) options.flagShapeIndex %= flagUrls.length;
    }
    buildFlagTiles();
    void loadWizardManifest().then((m) => {
        flagUrls = flagShapeTileUrls(m?.['ui/flagshapes']);
        clampFlagShape();
        buildFlagTiles();
        updateFlagPreview();
    });

    /** Task 06e: re-apply the "Your Empire" defaults when the race changes
     * (name auto-update rule + deterministic flag colours by race index),
     * then refresh the UI controls to match. */
    function onRaceChanged(raceName: string, prevRaceName?: string): void {
        const raceIndex = Math.max(0, PLAYABLE_RACE_INDEX.get(raceName) ?? 0);
        applyEmpireDefaults(options, raceIndex, prevRaceName);
        // applyEmpireDefaults fills "<Race> Empire"; the original leaves the
        // box empty so the engine generates the name (empireNamePlaceholder).
        if (!nameCustomised) options.empireName = '';
        clampFlagShape();
        nameInput.value = options.empireName;
        nameInput.placeholder = empireNamePlaceholder(raceName);
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
// Victory Conditions page (task 06g): victory types + thresholds, time
// limits, event toggles. Port of the visual layout of
// Start.InitializeComponent.cs pnlStartNewGameVictoryConditions controls.
// ---------------------------------------------------------------------------

/** Task 06g: checkbox row bound to a boolean field of options.victory. */
function makeVictoryCheckbox(
    wrap: HTMLDivElement,
    label: string,
    get: () => boolean,
    set: (v: boolean) => void,
): void {
    const row = document.createElement('label');
    row.className = 'wizard-checkbox';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = get();
    check.addEventListener('change', () => set(check.checked));
    row.appendChild(check);
    const span = document.createElement('span');
    span.textContent = label;
    row.appendChild(span);
    wrap.appendChild(row);
}

/** Task 06g: "Label … <number input> years/%" row for one numeric victory
 * control (percent boxes or year boxes), clamped into [min, max] on edit. */
function makeVictoryNumberRow(
    wrap: HTMLDivElement,
    prefix: string,
    suffix: string,
    min: number,
    max: number,
    get: () => number,
    set: (v: number) => void,
): void {
    const row = document.createElement('div');
    row.className = 'wizard-victory-number-row';
    const pre = document.createElement('span');
    pre.textContent = prefix;
    row.appendChild(pre);
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'wizard-victory-number-input';
    input.min = String(min);
    input.max = String(max);
    input.step = '1';
    input.value = String(get());
    input.addEventListener('input', () => {
        const v = parseInt(input.value, 10);
        if (!Number.isNaN(v)) {
            set(Math.min(max, Math.max(min, v)));
        }
    });
    row.appendChild(input);
    const post = document.createElement('span');
    post.textContent = suffix;
    row.appendChild(post);
    wrap.appendChild(row);
}

function buildVictoryPage(options: StartGameOptions): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'wizard-page wizard-victory-page';
    const v = options.victory;

    // --- Sandbox note (lblVictorySandbox). ---
    const sandboxNote = document.createElement('div');
    sandboxNote.className = 'wizard-victory-sandbox';
    sandboxNote.textContent = 'Leave all Victory Conditions unchecked to play in Sandbox mode (open play)';
    wrap.appendChild(sandboxNote);

    // --- Victory types with their threshold rows. The original labels embed
    // the percent value inside the checkbox text ("… generates   % of galaxy
    // total"); here the checkbox carries the type name and the threshold is
    // a separate "… <n> % of …" row below it. ---
    const sectionTypes = document.createElement('div');
    sectionTypes.className = 'wizard-victory-section';
    wrap.appendChild(sectionTypes);

    makeVictoryCheckbox(sectionTypes, 'Territory: control % of colonies in galaxy', () => v.territory, (x) => {
        v.territory = x;
    });
    makeVictoryNumberRow(
        sectionTypes,
        '',
        '% of colonies in galaxy',
        VICTORY_PERCENT_MIN,
        Number.MAX_SAFE_INTEGER,
        () => v.territoryPercent,
        (x) => {
            v.territoryPercent = x;
        },
    );

    makeVictoryCheckbox(sectionTypes, 'Population: control % of population in galaxy', () => v.population, (x) => {
        v.population = x;
    });
    makeVictoryNumberRow(
        sectionTypes,
        '',
        '% of population in galaxy',
        VICTORY_PERCENT_MIN,
        Number.MAX_SAFE_INTEGER,
        () => v.populationPercent,
        (x) => {
            v.populationPercent = x;
        },
    );

    makeVictoryCheckbox(sectionTypes, 'Economy: private economy generates % of galaxy total', () => v.economy, (x) => {
        v.economy = x;
    });
    makeVictoryNumberRow(
        sectionTypes,
        '',
        '% of galaxy total',
        VICTORY_PERCENT_MIN,
        Number.MAX_SAFE_INTEGER,
        () => v.economyPercent,
        (x) => {
            v.economyPercent = x;
        },
    );

    // --- Time limit / time start (chkVictoryTimeLimit / chkVictoryTimeStart). ---
    const sectionTime = document.createElement('div');
    sectionTime.className = 'wizard-victory-section';
    wrap.appendChild(sectionTime);

    makeVictoryCheckbox(sectionTime, 'Time Limit: game finishes after years', () => v.timeLimit, (x) => {
        v.timeLimit = x;
    });
    makeVictoryNumberRow(
        sectionTime,
        '',
        'years',
        VICTORY_TIME_LIMIT_YEARS_MIN,
        VICTORY_TIME_LIMIT_YEARS_MAX,
        () => v.timeLimitYears,
        (x) => {
            v.timeLimitYears = x;
        },
    );

    makeVictoryCheckbox(sectionTime, 'Victory Conditions apply after years', () => true, () => {});
    makeVictoryNumberRow(
        sectionTime,
        '',
        'years',
        VICTORY_TIME_START_YEARS_MIN,
        VICTORY_TIME_START_YEARS_MAX,
        () => v.startDateYears,
        (x) => {
            v.startDateYears = x;
        },
    );

    // --- Event toggles (chkVictoryEnable*). ---
    const sectionEvents = document.createElement('div');
    sectionEvents.className = 'wizard-victory-section';
    wrap.appendChild(sectionEvents);

    makeVictoryCheckbox(sectionEvents, 'Enable Disasters and other events', () => v.enableDisasterEvents, (x) => {
        v.enableDisasterEvents = x;
    });
    makeVictoryCheckbox(sectionEvents, 'Enable race-specific victory conditions', () => v.enableRaceSpecificConditions, (x) => {
        v.enableRaceSpecificConditions = x;
    });
    makeVictoryCheckbox(sectionEvents, 'Enable race-specific events', () => v.enableRaceSpecificEvents, (x) => {
        v.enableRaceSpecificEvents = x;
    });

    return wrap;
}

// ---------------------------------------------------------------------------
// Start page (task 06d): summary of the chosen options before booting.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Scenario page (mod layer, tasks/MODLAYER-DESIGN.md §3): "None" (default) or one of /assets/scenarios/index.json,
// with the selected scenario's description, a checkbox per flag and a number box per param.
// ---------------------------------------------------------------------------

/** Scenarios listed by the Scenario page (filled when the index loads; read by the Start summary). */
let wizardScenarios: ScenarioManifest[] = [];

function buildScenarioPage(options: StartGameOptions): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'wizard-page wizard-scenario-page';

    const intro = document.createElement('div');
    intro.className = 'wizard-victory-sandbox';
    intro.textContent = 'Scenarios add content and rules on top of the standard game. Choose “None” for the original game.';
    wrap.appendChild(intro);

    const listSection = document.createElement('div');
    listSection.className = 'wizard-victory-section wizard-scenario-list';
    wrap.appendChild(listSection);

    const detail = document.createElement('div');
    detail.className = 'wizard-victory-section wizard-scenario-detail';
    wrap.appendChild(detail);

    function renderDetail(): void {
        detail.replaceChildren();
        const choice = options.scenario ?? null;
        const m = choice === null ? null : wizardScenarios.find((x) => x.id === choice.id) ?? null;
        const desc = document.createElement('div');
        desc.className = 'wizard-scenario-description';
        desc.textContent = m === null ? 'The original game, unchanged.' : m.description || m.name;
        detail.appendChild(desc);
        if (m === null || choice === null) return;
        for (const f of m.flags) {
            makeVictoryCheckbox(detail, f.label, () => choice.flags[f.name] ?? f.default, (x) => {
                choice.flags[f.name] = x;
            });
            if (f.description) {
                const note = document.createElement('div');
                note.className = 'wizard-todo wizard-scenario-note';
                note.textContent = f.description;
                detail.appendChild(note);
            }
        }
        for (const p of m.params) {
            makeVictoryNumberRow(detail, p.label, '', p.min ?? -Number.MAX_SAFE_INTEGER, p.max ?? Number.MAX_SAFE_INTEGER, () => choice.params[p.name] ?? p.default, (x) => {
                choice.params[p.name] = x;
            });
        }
    }

    function renderList(): void {
        listSection.replaceChildren();
        const entries: Array<{ id: string | null; label: string }> = [{ id: null, label: 'None' }, ...wizardScenarios.map((m) => ({ id: m.id, label: m.name }))];
        for (const e of entries) {
            const row = document.createElement('label');
            row.className = 'wizard-checkbox';
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'wizard-scenario';
            radio.checked = (options.scenario?.id ?? null) === e.id;
            radio.addEventListener('change', () => {
                if (!radio.checked) return;
                const m = e.id === null ? null : wizardScenarios.find((x) => x.id === e.id) ?? null;
                options.scenario = m === null ? null : defaultScenarioChoice(m);
                renderDetail();
            });
            row.appendChild(radio);
            const span = document.createElement('span');
            span.textContent = e.label;
            row.appendChild(span);
            listSection.appendChild(row);
        }
    }

    renderList();
    renderDetail();
    void loadScenarioIndex(fetchText).then((list) => {
        wizardScenarios = list;
        renderList();
        renderDetail();
    });
    return wrap;
}

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
            ['Colony Prevalence', COLONY_PREVALENCE_TICKS[options.colonyPrevalenceIndex] ?? `index ${options.colonyPrevalenceIndex}`],
            ['Alien Life', ALIEN_LIFE_TICKS[options.alienLifeIndex] ?? `index ${options.alienLifeIndex}`],
            ['Space Creatures', SPACE_CREATURES_TICKS[options.spaceCreaturesIndex] ?? `index ${options.spaceCreaturesIndex}`],
            ['Pirates', PIRATES_TICKS[options.piratesIndex] ?? `index ${options.piratesIndex}`],
            ['Aggression', AGGRESSION_TICKS[options.aggressionIndex] ?? `index ${options.aggressionIndex}`],
            ['Expansion', EXPANSION_TICKS[options.galaxyExpansionIndex ?? 1] ?? `index ${options.galaxyExpansionIndex}`],
            ['Empire Size', EMPIRE_SIZE_TICKS[options.empireExpansionIndex ?? 1] ?? `index ${options.empireExpansionIndex}`],
            ['Tech Level', TECH_LEVEL_TICKS[options.empireTechLevelIndex ?? 1] ?? `index ${options.empireTechLevelIndex}`],
            ['Difficulty', DIFFICULTY_TICKS[options.difficultyIndex] ?? `index ${options.difficultyIndex}` + (options.difficultyScaling ? ' (scales near victory)' : '')],
            ['Your Race', options.raceName || '(not chosen)'],
            ['Empire Name', options.empireName || '(generated at start)'],
            ['Government', options.governmentId >= 0 ? `#${options.governmentId}` : '(not chosen)'],
            ['Flag', `shape ${options.flagShapeIndex} · ${options.primaryColor} / ${options.secondaryColor}`],
            // Task 06h: colonization & territory summary.
            [
                'Colonization',
                options.colonization.enforceRangeLimits
                    ? `Range limits on (${options.colonization.colonizationRangeKly}K range, ${options.colonization.colonyInfluenceRangePercent}% influence)`
                    : `No range limits (range ${options.colonization.colonizationRangeKly}K, influence ${options.colonization.colonyInfluenceRangePercent}%)`,
            ],
            ['Same-System Colonies', options.colonization.allowSameSystemAsOtherEmpires ? 'Allowed' : 'Disallowed'],
            // Task 06h/06j: other empires summary (manual list overrides).
            [
                'Other Empires',
                options.otherEmpires.manual.length > 0
                    ? `${options.otherEmpires.manual.length} manual (${options.otherEmpires.manual.map((m) => m.name || m.race).join(', ')})`
                    : options.otherEmpires.autogenerate
                        ? `${options.otherEmpires.empireCount} auto-generated`
                        : `${options.otherEmpires.empireCount} random`,
            ],
            // Task 06g: victory conditions summary (sandbox when none checked).
            [
                'Victory Conditions',
                options.victory.territory || options.victory.population || options.victory.economy || options.victory.timeLimit
                    ? [
                        options.victory.territory && `Territory ≥ ${options.victory.territoryPercent}%`,
                        options.victory.population && `Population ≥ ${options.victory.populationPercent}%`,
                        options.victory.economy && `Economy ≥ ${options.victory.economyPercent}%`,
                        options.victory.timeLimit && `Time limit ${options.victory.timeLimitYears}y`,
                    ]
                        .filter(Boolean)
                        .join(', ') + ` (apply after ${options.victory.startDateYears}y)`
                    : 'Sandbox mode (no victory conditions)',
            ],
            // Mod layer: the Scenario page's choice.
            ['Scenario', scenarioChoiceSummary(options.scenario, wizardScenarios)],
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