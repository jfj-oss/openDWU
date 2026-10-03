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
// [wizardB1] begin
import {
    applyEmpireTypeChoice,
    empireTypeIsCustom,
    empireTypeIsPirate,
    HOME_SYSTEM_NAMES,
    piratePlayStyleFor,
    startLocationsForShape,
    type WizardEmpireType,
} from '../../sim/startGameOptions';
import { isTextLoaded, loadText, tryGetText } from '../../sim/textResolver';
import { pirateModifierLines } from './empireSummaryModel';
import { piratePortraitUrl } from './diplomacyRelationsView';
import { PIRATE_FLAG_SHAPES, pirateFlagShapeUrl } from '../empireEmblem';
// [wizardB1] end
import { parseRace, type Race } from '../../sim/data/races';
import { parseRaceFamilies, type RaceFamily } from '../../sim/data/raceFamilies';
import { parseGovernments, type Government } from '../../sim/data/governments';
import { fetchText } from '../../sim/data/fetchData';
import { resolveDataUrl } from '../../sim/data/paths';
import { DEFAULT_RACE_FILES } from '../../sim/data/gameData';
import { loadScenarioIndex } from '../../sim/scenario/fetchScenario';
import type { ScenarioManifest } from '../../sim/scenario/manifest';
import { addonCatalog, addonPickerModel, canonicalAddons, planAddonStart, resolveAddonSwitches, toggleAddon, type AddonCatalog, type AddonOverrides, type AddonRow } from '../../sim/scenario/addons';

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
// [wizardB1] begin
/** tbarStartNewGameTheGalaxyPirateStrength labels (Start.cs 3224). */
export const PIRATE_STRENGTH_TICKS = ['Very Weak', 'Weak', 'Normal', 'Strong'];
/** cmbStartNewGameTheGalaxyPirateProximity items (Start.1.cs 4774). */
export const PIRATE_PROXIMITY_NAMES = ['Nearby', 'Average', 'Distant'];
/** tbarStartNewGameYourEmpireCorruption labels (Start.cs 3472). */
export const CORRUPTION_TICKS = ['Low', 'Normal', 'High', 'Very High'];
/** tbarStartNewGameYourEmpireHomeSystem labels (Start.cs 3445). */
export const HOME_SYSTEM_TICKS: readonly string[] = HOME_SYSTEM_NAMES;
/** cmbVictoryPiratePlayStyle items (Start.1.cs 4808: Galaxy.ResolveDescription(PiratePlayStyle), GameText "PiratePlayStyle *"). */
export const PIRATE_PLAYSTYLE_NAMES = ['Balanced', 'Raider', 'Mercenary', 'Smuggler'];
/** cmbVictoryThresholdPercentage items (Start.InitializeComponent.cs 2883) and their values (Start.1.cs 3885 method_203). */
export const VICTORY_THRESHOLD_NAMES = ['75%', '80%', '85%', '90%', '95%', '100%'];
export const VICTORY_THRESHOLD_VALUES = [0.75, 0.8, 0.85, 0.9, 0.95, 1.0];
// [wizardB1] end

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
export type WizardPageId = 'type' | 'jumpstart' | 'galaxy' | 'colonization' | 'race' | 'empire' | 'empires' | 'victory' | 'scenario' | 'start';
/** The mod layer's "Scenario" page (tasks/MODLAYER-DESIGN.md §3) sits between Victory Conditions and Start. [wizardB1] The
 * "Playstyle" page (Start.cs pnlStartNewGameYourEmpireType) comes first: its Custom buttons continue with The Galaxy, the
 * other playstyles with the one-page Jump Start (pnlStartNewGameJumpStart), which starts the game. */
export const WIZARD_PAGES: WizardPageId[] = ['type', 'galaxy', 'colonization', 'race', 'empire', 'empires', 'victory', 'scenario', 'start'];

/** Title-bar text per page ("Start a New Game: <page title>"). */
export const WIZARD_PAGE_TITLES: Record<WizardPageId, string> = {
    type: 'Playstyle',
    jumpstart: 'Galaxy, Race, Government, Difficulty',
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
    type: '← Main Menu',
    jumpstart: '← Playstyle',
    galaxy: '← Playstyle',
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
    type: '',
    jumpstart: 'Start Game',
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
    let page: WizardPageId = 'type';
    try {
        const params = new URLSearchParams(window.location.search);
        const requested = params.get('page');
        if (requested !== null && ((WIZARD_PAGES as string[]).includes(requested) || requested === 'jumpstart')) {
            page = requested as WizardPageId;
        }
        // Screenshot / dev hook: ?screen=wizard&page=empire&type=CustomPirate opens the pages of that playstyle.
        const type = params.get('type');
        if (type !== null && (WIZARD_EMPIRE_TYPES as readonly string[]).includes(type)) applyEmpireTypeChoice(options, type as WizardEmpireType);
    } catch {
        // non-browser context: stay on the first page
    }
    // Re-show the current page once GameText.txt is in, so its descriptions use the game's text.
    void ensureWizardGameText().then(() => showPage(page));

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
    const typePage = buildTypePage((t) => {
        applyEmpireTypeChoice(options, t);
        showPage(empireTypeIsCustom(t) ? 'galaxy' : 'jumpstart');
    });
    const jumpStartPage = buildJumpStartPage(options);
    const galaxyPage = buildGalaxyPage(options);
    const colonizationPage = buildColonizationPage(options);
    const racePage = buildRacePage(options, handleRaceChanged);
    const empirePage = buildEmpirePage(options);
    const empiresPage = buildOtherEmpiresPage(options);
    const victoryPage = buildVictoryPage(options);
    const scenarioPage = buildScenarioPage(options);
    const startPage = buildStartPage(options);
    const pageEls: Record<WizardPageId, HTMLElement> = {
        type: typePage,
        jumpstart: jumpStartPage,
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
        // [wizardB1] the Playstyle page continues through its own buttons.
        nextBtn.style.display = id === 'type' ? 'none' : '';
        // [wizardB1] pages whose controls depend on the playstyle / other pages re-sync when shown.
        (pageEls[id] as unknown as { __onShow?: () => void }).__onShow?.();
        if (id === 'start') {
            refreshStartSummary();
        }
    }

    function goBack(): void {
        if (page === 'type') {
            callbacks.onBackToMenu();
            return;
        }
        if (page === 'galaxy' || page === 'jumpstart') {
            showPage('type');
            return;
        }
        const idx = WIZARD_PAGES.indexOf(page);
        showPage(WIZARD_PAGES[idx - 1]);
    }

    function goForward(): void {
        if (page === 'type') return;
        if (page === 'jumpstart') {
            // Start.cs btnJumpStartTheGalaxyNext_Click starts the game from the Jump Start page.
            callbacks.onStartGame({ ...options });
            return;
        }
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
// [wizardB1] The Playstyle page (Start.cs pnlStartNewGameYourEmpireType, laid out by Start.cs 3495 method_41) and the
// Jump Start page (pnlStartNewGameJumpStart, Start.cs 2904 method_35 / method_36).
// ---------------------------------------------------------------------------

/** Every playstyle the page offers (Start.cs wjhRtsSwmsa values). */
export const WIZARD_EMPIRE_TYPES: readonly WizardEmpireType[] = ['CustomStandard', 'CustomPirate', 'ShadowsStandard', 'ShadowsPirate', 'ClassicEra', 'ReturnOfTheShakturi', 'Legends'];

/** TextResolver.GetText(tag) when GameText.txt is loaded, else the English text it holds (GameText.txt). */
function wt(tag: string, fallback: string): string {
    return (tryGetText(tag) ?? fallback).replace(/\\n/g, '\n');
}

/** The wizard runs before the game data loads; load GameText.txt for its descriptions (no-op once loaded). */
async function ensureWizardGameText(): Promise<void> {
    if (isTextLoaded()) return;
    try {
        const text = await fetchText(resolveDataUrl('GameText.txt'));
        if (!isTextLoaded() && isRaceFileText(text)) loadText(text);
    } catch {
        // keep the English fallbacks
    }
}

interface PlaystyleButtonSpec {
    type: WizardEmpireType | 'AncientGalaxy' | 'Introductory';
    titleTag: string;
    title: string;
    descTag: string;
    desc: string;
    image: string;
}

const PLAYSTYLE_ERAS: PlaystyleButtonSpec[] = [
    { type: 'AncientGalaxy', titleTag: 'Start New Game - Ancient Galaxy', title: 'The Ancient Galaxy', descTag: 'Start New Game Description - Ancient Galaxy', desc: 'Travel back to a time when the galaxy was young. Ancient empires have carved out their territories and formed alliances amongst themselves.', image: '/assets/dwu/images/ui/achievements/DefeatAncients.png' },
    { type: 'ShadowsPirate', titleTag: 'Start New Game - Shadows Pirate', title: 'Pirate Faction in the Age of Shadows', descTag: 'Start New Game Description - Shadows Pirate', desc: 'You are a pirate faction in the Age of Shadows. Civilization has crumbled and pirates, smugglers and mercenaries rule the galaxy.', image: `${CHROME}playstyle_pirateshadows.png` },
    { type: 'ShadowsStandard', titleTag: 'Start New Game - Shadows Standard', title: 'Standard Empire in the Age of Shadows', descTag: 'Start New Game Description - Shadows Standard', desc: 'You are a standard empire in the Age of Shadows. Civilization has crumbled and pirates, smugglers and mercenaries rule the galaxy.', image: `${CHROME}playstyle_normalshadows.png` },
    { type: 'ClassicEra', titleTag: 'Start New Game - Classic Era', title: 'Classic Era', descTag: 'Start New Game Description - Classic Era', desc: 'You are a standard empire in the Classic Era. Your empire has begun to expand beyond your own star system.', image: `${CHROME}playstyle_normalclassic.png` },
    { type: 'ReturnOfTheShakturi', titleTag: 'Start New Game - Return of the Shakturi', title: 'Return of the Shakturi', descTag: 'Start New Game Description - Return of the Shakturi', desc: 'You are a standard empire in the Classic Era, with the Return of the Shakturi storyline.', image: '/assets/dwu/images/ui/achievements/DefeatShakturi.png' },
    { type: 'Legends', titleTag: 'Start New Game - Legends', title: 'Legends', descTag: 'Start New Game Description - Legends', desc: 'You are a standard empire in the Classic Era. This start includes all of the Distant Worlds storyline and events: Original, Return of the Shakturi and Legends.', image: '/assets/dwu/images/ui/achievements/DefeatLegendaryPirates.png' },
];
const PLAYSTYLE_CUSTOM: PlaystyleButtonSpec[] = [
    { type: 'CustomStandard', titleTag: 'Start New Game - Custom Standard', title: 'Custom Game as Standard Empire', descTag: 'Start New Game Description - Custom Standard', desc: 'Set up a new game as a standard empire with the full range of options.', image: `${CHROME}playstyle_normalclassic.png` },
    { type: 'CustomPirate', titleTag: 'Start New Game - Custom Pirate', title: 'Custom Game as Pirate Faction', descTag: 'Start New Game Description - Custom Pirate', desc: 'Set up a new game as a pirate faction with the full range of options.', image: `${CHROME}playstyle_pirateclassic.png` },
];
const PLAYSTYLE_INTRODUCTORY: PlaystyleButtonSpec = { type: 'Introductory', titleTag: 'Introductory Game', title: 'Introductory Game', descTag: 'Start New Game Description - Introductory Game', desc: 'An introduction to Distant Worlds. Jump straight into an easy game in the Classic Era, with abundant resources and few pirates.', image: '' };

function buildTypePage(onChoose: (type: WizardEmpireType) => void): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'wizard-page wizard-type-page';
    const desc = document.createElement('div');
    desc.className = 'wizard-type-desc';

    function makeButton(spec: PlaystyleButtonSpec, cls: string): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `wizard-type-btn ${cls}`;
        btn.dataset.type = spec.type;
        if (spec.image !== '') {
            const img = document.createElement('img');
            img.src = spec.image;
            img.alt = '';
            btn.appendChild(img);
        }
        const label = document.createElement('span');
        label.textContent = `${wt(spec.titleTag, spec.title)} >>`;
        btn.appendChild(label);
        const showDesc = (): void => {
            label.textContent = `${wt(spec.titleTag, spec.title)} >>`;
            desc.textContent = wt(spec.descTag, spec.desc);
        };
        btn.addEventListener('mouseenter', showDesc);
        btn.addEventListener('focus', showDesc);
        if (spec.type === 'AncientGalaxy' || spec.type === 'Introductory') {
            // TODO(port): The Ancient Galaxy (Start.cs 5583: switches to "The Ancient Galaxy" theme and starts its prebuilt
            // galaxy map, method_221) and the Introductory Game (Start.cs 5363 btnStartNewGameIntroductory_Click preset) are
            // not ported yet.
            btn.disabled = true;
            btn.title = 'Not available yet';
        } else {
            const t = spec.type;
            btn.addEventListener('click', () => onChoose(t));
        }
        return btn;
    }

    const intro = document.createElement('div');
    intro.className = 'wizard-type-intro';
    intro.appendChild(makeButton(PLAYSTYLE_INTRODUCTORY, 'wizard-type-btn-intro'));
    wrap.appendChild(intro);
    const eras = document.createElement('div');
    eras.className = 'wizard-type-eras';
    for (const spec of PLAYSTYLE_ERAS) eras.appendChild(makeButton(spec, 'wizard-type-btn-era'));
    wrap.appendChild(eras);
    wrap.appendChild(desc);
    const custom = document.createElement('div');
    custom.className = 'wizard-type-custom';
    for (const spec of PLAYSTYLE_CUSTOM) custom.appendChild(makeButton(spec, 'wizard-type-btn-custom'));
    wrap.appendChild(custom);
    const note = document.createElement('div');
    note.className = 'wizard-type-note';
    note.textContent = wt('Start New Game New Player Explanation Text UNIVERSE', 'For a simple introduction to Distant Worlds try playing as a standard empire in the Classic Era.');
    wrap.appendChild(note);
    (wrap as unknown as { __onShow?: () => void }).__onShow = () => {
        desc.textContent = wt('Start New Game Description - Custom Standard', PLAYSTYLE_CUSTOM[0].desc);
        note.textContent = wt('Start New Game New Player Explanation Text UNIVERSE', note.textContent ?? '');
    };
    return wrap;
}

/** The pirate playstyle combo + its description and portrait (Start.cs 3384-3397 cmbVictoryPiratePlayStyle /
 *  lblPiratePlaystyleDescription / picStartNewGameYourEmpirePiratePlaystyle; text from Start.2.cs 3147 method_101). */
function buildPiratePlaystyleSection(options: StartGameOptions): HTMLDivElement {
    const section = document.createElement('div');
    section.className = 'wizard-pirate-playstyle';
    const row = document.createElement('div');
    row.className = 'wizard-empire-name-row';
    const label = document.createElement('span');
    label.className = 'wizard-empire-label';
    label.textContent = wt('Pirate Playstyle', 'Pirate Playstyle');
    row.appendChild(label);
    const select = document.createElement('select');
    select.className = 'wizard-empire-gov-select wizard-pirate-playstyle-select';
    PIRATE_PLAYSTYLE_NAMES.forEach((n, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = n;
        select.appendChild(opt);
    });
    select.value = String(options.piratePlayStyleIndex ?? 0);
    row.appendChild(select);
    section.appendChild(row);
    const body = document.createElement('div');
    body.className = 'wizard-pirate-playstyle-body';
    const text = document.createElement('div');
    text.className = 'wizard-pirate-playstyle-desc';
    const img = document.createElement('img');
    img.className = 'wizard-pirate-playstyle-img';
    img.alt = '';
    body.appendChild(text);
    body.appendChild(img);
    section.appendChild(body);
    const DESC_TAGS = ['Balanced', 'Pirate', 'Mercenary', 'Smuggler'];
    const DESC_FALLBACK = [
        'Balanced playstyle pirates attempt to control colonies, gain income from protection arrangements with other empires, and capture enemy ships and bases.',
        'Raiders attempt to control colonies, both independent and those owned by standard empires. They grow rich by siphoning off the wealth from these controlled colonies.',
        'Mercenaries are guns for hire who seek out attack and defense missions to perform for other empires.',
        'Smugglers are focussed on gaining income by smuggling resources to colonies and building a network of protection arrangements with other empires.',
    ];
    function paint(): void {
        const i = options.piratePlayStyleIndex ?? 0;
        const style = piratePlayStyleFor(i);
        const lines = [wt(`Pirate Playstyle Description ${DESC_TAGS[i] ?? 'Balanced'}`, DESC_FALLBACK[i] ?? DESC_FALLBACK[0]), '', ...pirateModifierLines(style).map((l) => l.text)];
        text.textContent = lines.join('\n').trim();
        img.src = piratePortraitUrl(style);
    }
    select.addEventListener('change', () => {
        options.piratePlayStyleIndex = parseInt(select.value, 10);
        paint();
    });
    (section as unknown as { __paint?: () => void }).__paint = () => {
        select.value = String(options.piratePlayStyleIndex ?? 0);
        paint();
    };
    paint();
    return section;
}

/** A labelled <select> bound to an index. */
function makeWizardSelect(title: string, items: readonly string[], get: () => number, set: (i: number) => void): { row: HTMLDivElement; select: HTMLSelectElement; setItems: (items: readonly string[]) => void } {
    const row = document.createElement('div');
    row.className = 'wizard-select-row';
    const label = document.createElement('span');
    label.className = 'wizard-slider-title';
    label.textContent = title;
    row.appendChild(label);
    const select = document.createElement('select');
    select.className = 'wizard-empire-gov-select';
    function setItems(list: readonly string[]): void {
        select.replaceChildren(...list.map((n, i) => {
            const opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = n;
            return opt;
        }));
        select.value = String(Math.min(Math.max(0, get()), list.length - 1));
    }
    setItems(items);
    select.addEventListener('change', () => set(parseInt(select.value, 10)));
    row.appendChild(select);
    return { row, select, setItems };
}

/** A checkbox row bound to a boolean. */
function makeWizardCheckbox(text: string, get: () => boolean, set: (v: boolean) => void): { row: HTMLLabelElement; input: HTMLInputElement; label: HTMLSpanElement } {
    const row = document.createElement('label');
    row.className = 'wizard-checkbox';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = get();
    input.addEventListener('change', () => set(input.checked));
    row.appendChild(input);
    const label = document.createElement('span');
    label.textContent = text;
    row.appendChild(label);
    return { row, input, label };
}

/** The Jump Start page: galaxy shape, star amount, physical size, difficulty (+ scaling), race and government (pirate
 *  playstyle for a pirate) — everything else is the preset of Start.cs btnJumpStartTheGalaxyNext_Click
 *  (startGameOptions.ts toCreateGameOptionsJumpStart). */
function buildJumpStartPage(options: StartGameOptions): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'wizard-page wizard-jumpstart-page';

    const top = document.createElement('div');
    top.className = 'wizard-jumpstart-top';
    wrap.appendChild(top);

    // Galaxy shape (radJumpStartGalaxyShape*) with preview.
    const shapeCol = document.createElement('div');
    shapeCol.className = 'wizard-shape-row';
    const shapeList = document.createElement('div');
    shapeList.className = 'wizard-shape-list';
    const preview = document.createElement('div');
    preview.className = 'wizard-shape-preview';
    const previewImg = document.createElement('img');
    preview.appendChild(previewImg);
    shapeCol.appendChild(shapeList);
    shapeCol.appendChild(preview);
    top.appendChild(shapeCol);
    const radios: HTMLInputElement[] = [];
    function updatePreview(): void {
        const opt = SHAPE_OPTIONS.find((o) => o.shape === options.shape) ?? SHAPE_OPTIONS[1];
        previewImg.src = `${CHROME}${opt.image}`;
        previewImg.alt = opt.label;
    }
    for (const opt of SHAPE_OPTIONS) {
        const label = document.createElement('label');
        label.className = 'wizard-shape-item';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'wizard-jumpstart-shape';
        radio.value = String(opt.shape);
        radio.addEventListener('change', () => {
            options.shape = opt.shape;
            options.startLocationIndex = 0; // Start.1.cs 4064: the start-location combo resets with the shape
            updatePreview();
        });
        radios.push(radio);
        label.appendChild(radio);
        const span = document.createElement('span');
        span.textContent = opt.label;
        label.appendChild(span);
        shapeList.appendChild(label);
    }

    // Race (cmbJumpStartYourEmpireRace, with (Random)) and government / pirate playstyle.
    const empireCol = document.createElement('div');
    empireCol.className = 'wizard-jumpstart-empire';
    top.appendChild(empireCol);
    const raceSel = makeWizardSelect('Race', ['(Random)'], () => 0, () => {});
    empireCol.appendChild(raceSel.row);
    const raceImg = document.createElement('img');
    raceImg.className = 'wizard-jumpstart-race-img';
    raceImg.alt = '';
    empireCol.appendChild(raceImg);
    const govSel = makeWizardSelect('Government', ['(Random)'], () => 0, () => {});
    empireCol.appendChild(govSel.row);
    const pirateSection = buildPiratePlaystyleSection(options);
    empireCol.appendChild(pirateSection);
    let races: Race[] = [];
    let governments: Government[] = [];
    function paintRace(): void {
        const race = races.find((r) => r.name === options.raceName);
        if (race === undefined) {
            raceImg.removeAttribute('src');
            raceImg.style.visibility = 'hidden';
        } else {
            raceImg.style.visibility = '';
            raceImg.src = racePortraitUrls(race.pictureIndex)[0];
        }
    }
    raceSel.select.addEventListener('change', () => {
        const i = parseInt(raceSel.select.value, 10);
        options.raceName = i <= 0 ? '' : races[i - 1]?.name ?? '';
        paintRace();
    });
    govSel.select.addEventListener('change', () => {
        const i = parseInt(govSel.select.value, 10);
        options.governmentId = i <= 0 ? -1 : governments[i - 1]?.governmentId ?? -1;
    });
    void Promise.all([loadWizardRaceData(), loadWizardGovernments()]).then(([data, govs]) => {
        races = playableRacesSorted(data.races);
        governments = filterStartGovernments(govs);
        // The same default as the Your Race page (whichever loads first sets it).
        if (options.raceName === '') options.raceName = defaultRaceName(data.races);
        sync();
    }).catch(() => {});

    // Star Amount, Physical Size, Difficulty (tbarJumpStartTheGalaxy*), Difficulty scaling.
    const grid = document.createElement('div');
    grid.className = 'wizard-slider-grid';
    wrap.appendChild(grid);
    let sliders: HTMLDivElement[] = [];
    function buildSliders(): void {
        for (const el of sliders) el.remove();
        sliders = [
            makeWizardSlider('Star Amount', STAR_AMOUNT_TICKS, options.starCountIndex, (i) => { options.starCountIndex = i; }),
            makeWizardSlider('Physical Size', PHYSICAL_SIZE_TICKS, options.dimensionIndex, (i) => { options.dimensionIndex = i; }),
            makeWizardSlider('Difficulty', DIFFICULTY_TICKS, options.difficultyIndex, (i) => { options.difficultyIndex = i; }),
        ];
        for (const el of sliders) grid.appendChild(el);
    }
    const scaling = makeWizardCheckbox('Difficulty scales as player nears victory', () => options.difficultyScaling, (v) => { options.difficultyScaling = v; });
    wrap.appendChild(scaling.row);
    const typeNote = document.createElement('div');
    typeNote.className = 'wizard-type-desc';
    wrap.appendChild(typeNote);

    function sync(): void {
        radios.forEach((r) => (r.checked = Number(r.value) === options.shape));
        updatePreview();
        raceSel.setItems(['(Random)', ...races.map((r) => r.name)]);
        const ri = races.findIndex((r) => r.name === options.raceName);
        raceSel.select.value = String(ri + 1);
        paintRace();
        govSel.setItems(['(Random)', ...governments.map((g) => g.name)]);
        const gi = governments.findIndex((g) => g.governmentId === options.governmentId);
        govSel.select.value = String(gi + 1);
        // Start.cs 2904 method_35: a pirate start shows the playstyle instead of the government.
        const pirate = empireTypeIsPirate(options.empireType);
        govSel.row.style.display = pirate ? 'none' : '';
        pirateSection.style.display = pirate ? '' : 'none';
        (pirateSection as unknown as { __paint?: () => void }).__paint?.();
        scaling.input.checked = options.difficultyScaling;
        buildSliders();
        const spec = PLAYSTYLE_ERAS.find((p) => p.type === options.empireType);
        typeNote.textContent = spec !== undefined ? `${wt(spec.titleTag, spec.title)}: ${wt(spec.descTag, spec.desc)}` : '';
    }
    (wrap as unknown as { __onShow?: () => void }).__onShow = sync;
    sync();
    return wrap;
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
            options.startLocationIndex = 0; // [wizardB1] Start.1.cs 4064: the start-location combo resets with the shape
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
    // [wizardB1] tbarStartNewGameTheGalaxyPirateStrength (Start.cs 3224; Start.1.cs 3722-3736 → PirateShipMaintenanceFactor).
    sliderGrid.appendChild(makeSlider('Pirate Strength', PIRATE_STRENGTH_TICKS, options.pirateStrengthIndex ?? 2, (i) => {
        options.pirateStrengthIndex = i;
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

    // [wizardB1] cmbStartNewGameTheGalaxyPirateProximity (Start.1.cs 4774, method_190 → Galaxy.PirateProximity) and
    // chkStartNewGameTheGalaxyPiratesRespawn (Start.cs 3193, Start.1.cs 3741 → Galaxy.DestroyedPiratesDoNotRespawn).
    const pirateRow = document.createElement('div');
    pirateRow.className = 'wizard-galaxy-pirate-row';
    pirateRow.appendChild(makeWizardSelect(wt('Pirate Proximity', 'Pirate Proximity'), PIRATE_PROXIMITY_NAMES, () => options.pirateProximityIndex ?? 1, (i) => {
        options.pirateProximityIndex = i;
    }).row);
    const respawn = makeWizardCheckbox(wt('Destroyed Pirates do not respawn', 'Destroyed Pirates do not respawn'), () => options.destroyedPiratesDoNotRespawn ?? false, (v) => {
        options.destroyedPiratesDoNotRespawn = v;
    });
    respawn.row.title = wt('Destroyed Pirates do not respawn Description', 'If checked then pirate factions that are completely wiped out do not respawn replacement pirate factions.');
    pirateRow.appendChild(respawn.row);
    // In the free space right of the shape preview (the original puts them by the Pirates sliders, Start.cs 3150-3199).
    shapeRow.appendChild(pirateRow);

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

    // [wizardB1] the Jump Start page shares the shape: re-sync the radios when shown.
    (wrap as unknown as { __onShow?: () => void }).__onShow = () => {
        for (const r of shapeList.querySelectorAll<HTMLInputElement>('input[type=radio]')) r.checked = Number(r.value) === options.shape;
        updatePreview();
    };

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

    // [wizardB1] chkGalaxyNewEmpiresDuringGame (Start.cs 3655; Start.1.cs 3689 → Galaxy.SpawnNewEmpires, Habitat.cs 1502).
    const spawn = makeWizardCheckbox(
        wt('Allow independent alien colonies to start new empires during the game', 'Allow independent alien colonies to start new empires during the game'),
        () => options.spawnNewEmpires ?? true,
        (v) => {
            options.spawnNewEmpires = v;
        },
    );
    spawn.row.classList.add('wizard-empires-spawn');

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
    wrap.appendChild(spawn.row);
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
    // [wizardB1] cmbYourEmpireStartLocation (items per galaxy shape, Start.1.cs method_205) and the Home System slider.
    const startLocation = makeWizardSelect('Galaxy Location', startLocationsForShape(options.shape), () => options.startLocationIndex ?? 0, (i) => {
        options.startLocationIndex = i;
    });
    eraGrid.appendChild(startLocation.row);
    const homeSystemSlider = makeWizardSlider('Home System', [...HOME_SYSTEM_TICKS], options.homeSystemIndex ?? 2, (i) => {
        options.homeSystemIndex = i;
    });
    eraGrid.appendChild(homeSystemSlider);
    const sizeSlider = makeWizardSlider('Size', EMPIRE_SIZE_TICKS, options.empireExpansionIndex ?? 1, (i) => {
        options.empireExpansionIndex = i;
    });
    eraGrid.appendChild(sizeSlider);
    const techSlider = makeWizardSlider('Tech Level', TECH_LEVEL_TICKS, options.empireTechLevelIndex ?? 1, (i) => {
        options.empireTechLevelIndex = i;
    });
    eraGrid.appendChild(techSlider);
    // [wizardB1] tbarStartNewGameYourEmpireCorruption (Start.cs 3472; method_63 → EmpireStart.CorruptionMultiplier).
    const corruptionSlider = makeWizardSlider('Corruption', CORRUPTION_TICKS, options.empireCorruptionIndex ?? 1, (i) => {
        options.empireCorruptionIndex = i;
    });
    eraGrid.appendChild(corruptionSlider);
    wrap.appendChild(eraGrid);
    // [wizardB1] the pirate playstyle (Start.cs 3384-3420 method_40: shown instead of government / home system / size /
    // corruption for a pirate start).
    const pirateSection = buildPiratePlaystyleSection(options);
    wrap.appendChild(pirateSection);

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

    let stockFlagUrls: string[] = flagShapeTileUrls(undefined);
    // [wizardB1] Start.1.cs 3912 method_204: a pirate start lists Galaxy.FlagShapesPirates instead.
    const pirateFlagUrls = PIRATE_FLAG_SHAPES.map((_, i) => pirateFlagShapeUrl(i));
    let flagUrls: string[] = empireTypeIsPirate(options.empireType) ? pirateFlagUrls : stockFlagUrls;
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
        stockFlagUrls = flagShapeTileUrls(m?.['ui/flagshapes']);
        flagUrls = empireTypeIsPirate(options.empireType) ? pirateFlagUrls : stockFlagUrls;
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

    // [wizardB1] Start.cs 3398-3420 method_40: a pirate start hides the government, home system, size and corruption
    // controls and shows the pirate playstyle; the start locations follow the galaxy shape.
    function syncPlaystyle(): void {
        const pirate = empireTypeIsPirate(options.empireType);
        govSection.style.display = pirate ? 'none' : '';
        homeSystemSlider.style.display = pirate ? 'none' : '';
        sizeSlider.style.display = pirate ? 'none' : '';
        corruptionSlider.style.display = pirate ? 'none' : '';
        pirateSection.style.display = pirate ? '' : 'none';
        (pirateSection as unknown as { __paint?: () => void }).__paint?.();
        startLocation.setItems(startLocationsForShape(options.shape));
        const techInput = techSlider.querySelector<HTMLInputElement>('input[type=range]');
        if (techInput !== null) techInput.value = String(options.empireTechLevelIndex ?? 1);
        const urls = pirate ? pirateFlagUrls : stockFlagUrls;
        if (urls !== flagUrls) {
            flagUrls = urls;
            clampFlagShape();
            buildFlagTiles();
            updateFlagPreview();
        }
    }
    (wrap as unknown as { __onShow?: () => void }).__onShow = syncPlaystyle;
    syncPlaystyle();

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
): { input: HTMLInputElement; label: HTMLSpanElement } {
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
    return { input: check, label: span };
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

    // [wizardB1] chkVictoryTimeStart (Start.1.cs 3792 → VictoryConditions.StartDate): was a dummy, always-checked box.
    makeVictoryCheckbox(sectionTime, 'Victory Conditions apply after years', () => v.timeStart === true, (x) => {
        v.timeStart = x;
    });
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

    // [wizardB1] cmbVictoryThresholdPercentage (Start.1.cs 3804 method_203 → VictoryThresholdPercentage).
    const threshold = makeWizardSelect(wt('Victory Threshold Percent', 'Victory Threshold Percent'), VICTORY_THRESHOLD_NAMES, () => {
        const i = VICTORY_THRESHOLD_VALUES.indexOf(v.victoryThresholdPercentage);
        return i >= 0 ? i : VICTORY_THRESHOLD_VALUES.length - 1;
    }, (i) => {
        v.victoryThresholdPercentage = VICTORY_THRESHOLD_VALUES[i] ?? 1.0;
    });
    sectionTime.appendChild(threshold.row);

    // [wizardB1] the story box (Start.cs 3715-3751): chkStoryDistantWorlds, chkStoryReturnOfTheShakturi, the event toggles,
    // chkStoryShadows; tech trading and Giant Kaltors on the right (Start.cs 3752-3759).
    makeVictoryCheckbox(sectionEvents, wt('Enable original Distant Worlds story events', 'Enable original Distant Worlds story events'), () => v.enableStoryDistantWorlds === true, (x) => {
        v.enableStoryDistantWorlds = x;
    });
    const shakturi = makeVictoryCheckbox(sectionEvents, wt('Enable Return Of The Shakturi story events and victory conditions', 'Enable Return Of The Shakturi story events and victory conditions'), () => v.enableStoryEvents === true, (x) => {
        v.enableStoryEvents = x;
    });
    makeVictoryCheckbox(sectionEvents, 'Enable Disasters and other events', () => v.enableDisasterEvents, (x) => {
        v.enableDisasterEvents = x;
    });
    const raceConditions = makeVictoryCheckbox(sectionEvents, 'Enable race-specific victory conditions', () => v.enableRaceSpecificConditions, (x) => {
        v.enableRaceSpecificConditions = x;
    });
    makeVictoryCheckbox(sectionEvents, 'Enable race-specific events', () => v.enableRaceSpecificEvents, (x) => {
        v.enableRaceSpecificEvents = x;
    });
    const shadows = makeVictoryCheckbox(sectionEvents, wt('Enable Shadows story events', 'Enable Shadows story events'), () => v.enableStoryEventsShadows === true, (x) => {
        v.enableStoryEventsShadows = x;
    });
    const sectionGame = sectionEvents;
    sectionEvents.classList.add('wizard-victory-events');
    makeVictoryCheckbox(sectionGame, wt('Allow Tech Trading', 'Allow Tech Trading'), () => options.allowTechTrading ?? true, (x) => {
        options.allowTechTrading = x;
    });
    makeVictoryCheckbox(sectionGame, wt('Allow Giant Kaltors at game start', 'Allow Giant Kaltors at game start'), () => options.allowGiantKaltorGeneration ?? true, (x) => {
        options.allowGiantKaltorGeneration = x;
    });

    // Start.cs 3770 method_45 (pirate start: Return of the Shakturi unchecked and disabled, pirate-specific conditions,
    // the pirate explanation) and Start.1.cs 3098 btnStartNewGameOtherEmpiresNext_Click (Shadows only in a PreWarp galaxy).
    // The displayed state follows; the stored choice is kept and toCreateGameOptions applies the same rule.
    (wrap as unknown as { __onShow?: () => void }).__onShow = () => {
        const pirate = empireTypeIsPirate(options.empireType);
        shakturi.input.disabled = pirate;
        shakturi.input.checked = !pirate && v.enableStoryEvents === true;
        const prewarp = (options.galaxyExpansionIndex ?? 1) === 0;
        shadows.input.disabled = !prewarp;
        shadows.input.checked = prewarp && v.enableStoryEventsShadows === true;
        raceConditions.label.textContent = pirate ? 'Enable Pirate-specific victory conditions' : 'Enable race-specific victory conditions';
        sandboxNote.textContent = pirate
            ? wt('Victory Conditions Explanation Pirate', 'Enable Pirate-specific victory conditions. Then select the pirate playstyle for your empire. Finally select the percentage threshold for victory.')
            : 'Leave all Victory Conditions unchecked to play in Sandbox mode (open play)';
    };

    return wrap;
}

// ---------------------------------------------------------------------------
// Start page (task 06d): summary of the chosen options before booting.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Scenario page (mod layer, tasks/MODLAYER-DESIGN.md §3): the add-on picker (src/sim/scenario/addons.ts). A checklist of
// the add-ons of /assets/scenarios/index.json grouped by theme; ticking one ticks (and locks) what it needs; a summary
// of what will run; one collapsible settings panel (flags / params) per running add-on. Nothing ticked = the original
// game (options.scenario stays null).
// ---------------------------------------------------------------------------

/** Scenarios listed by the Scenario page (filled when the index loads; read by the Start summary). */
let wizardScenarios: ScenarioManifest[] = [];

/** The wizard's scenario choice for a set of ticks (null = the original game). */
export function addonChoiceFor(cat: AddonCatalog, picked: readonly string[], overrides: AddonOverrides): StartGameOptions['scenario'] {
    const plan = planAddonStart(cat, picked);
    if (plan === null) return null;
    const sw = resolveAddonSwitches(cat, picked, overrides);
    return { id: plan.id, flags: sw.flags, params: sw.params, addons: canonicalAddons(cat, picked) };
}

function buildScenarioPage(options: StartGameOptions): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'wizard-page wizard-scenario-page';

    const intro = document.createElement('div');
    intro.className = 'wizard-victory-sandbox';
    intro.textContent = 'Add-ons change the standard game. Tick any number of them; an add-on that needs another one ticks it for you. Nothing ticked is the original game.';
    wrap.appendChild(intro);

    const summary = document.createElement('div');
    summary.className = 'wizard-addon-summary';
    wrap.appendChild(summary);

    const listSection = document.createElement('div');
    listSection.className = 'wizard-victory-section wizard-scenario-list wizard-addon-list';
    wrap.appendChild(listSection);

    const detail = document.createElement('div');
    detail.className = 'wizard-victory-section wizard-scenario-detail';
    wrap.appendChild(detail);

    let cat: AddonCatalog = addonCatalog([]);
    let picked: string[] = options.scenario?.addons ?? (options.scenario ? [options.scenario.id] : []);
    const overrides: AddonOverrides = { flags: {}, params: {} };
    /** Settings panels the player opened (kept open across re-renders). */
    const openPanels = new Set<string>();
    try {
        // Dev / screenshot hook: ?screen=wizard&page=scenario&addons=timebomb,robotmutiny starts with those ticked.
        const pre = new URLSearchParams(window.location.search).get('addons');
        if (pre !== null && pre !== '') picked = pre.split(',').map((x) => x.trim());
    } catch {
        // non-browser context
    }

    function update(): void {
        options.scenario = addonChoiceFor(cat, picked, overrides);
        render();
    }

    function rowEl(r: AddonRow): HTMLElement {
        const row = document.createElement('label');
        row.className = 'wizard-addon-row' + (r.locked ? ' is-locked' : '') + (r.disabled && !r.locked ? ' is-disabled' : '');
        if (r.tooltip) row.title = r.tooltip;
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = r.checked;
        check.disabled = r.disabled;
        if (r.tooltip) check.title = r.tooltip;
        check.addEventListener('change', () => {
            picked = toggleAddon(cat, picked, r.id, check.checked);
            update();
        });
        row.appendChild(check);
        const text = document.createElement('div');
        text.className = 'wizard-addon-text';
        const head = document.createElement('div');
        head.className = 'wizard-addon-head';
        const name = document.createElement('span');
        name.className = 'wizard-addon-name';
        name.textContent = r.name;
        head.appendChild(name);
        const deps = [r.needs.length > 0 ? `needs: ${r.needs.join(', ')}` : '', r.loads.length > 0 ? `loads: ${r.loads.join(', ')}` : ''].filter((x) => x !== '');
        if (deps.length > 0) {
            const needs = document.createElement('span');
            needs.className = 'wizard-addon-needs';
            needs.textContent = deps.join(' · ');
            head.appendChild(needs);
        }
        text.appendChild(head);
        const desc = document.createElement('div');
        desc.className = 'wizard-addon-desc';
        desc.textContent = firstSentence(r.description);
        desc.title = r.description;
        text.appendChild(desc);
        const note = r.locked ? `required by ${r.requiredBy.join(', ')}` : r.conflictsWith.length > 0 ? `conflicts with ${r.conflictsWith.join(', ')}` : r.loadedFor.length > 0 ? `data loaded for ${r.loadedFor.join(', ')} (off unless ticked)` : '';
        if (note !== '') {
            const n = document.createElement('div');
            n.className = 'wizard-addon-note';
            n.textContent = note;
            text.appendChild(n);
        }
        row.appendChild(text);
        return row;
    }

    function render(): void {
        const model = addonPickerModel(cat, picked);
        summary.textContent = `Running: ${model.summary}`;
        listSection.replaceChildren();
        if (cat.list.length === 0) {
            const none = document.createElement('div');
            none.className = 'wizard-todo';
            none.textContent = 'No add-ons found (/assets/scenarios/index.json).';
            listSection.appendChild(none);
        }
        for (const g of model.groups) {
            const h = document.createElement('div');
            h.className = 'wizard-addon-group';
            h.textContent = g.group;
            listSection.appendChild(h);
            const grid = document.createElement('div');
            grid.className = 'wizard-addon-grid';
            for (const r of g.rows) grid.appendChild(rowEl(r));
            listSection.appendChild(grid);
        }

        detail.replaceChildren();
        const choice = options.scenario ?? null;
        const title = document.createElement('div');
        title.className = 'wizard-scenario-description';
        title.textContent = choice === null ? 'The original game, unchanged.' : 'Settings of the running add-ons';
        detail.appendChild(title);
        if (choice === null) return;
        for (const id of model.panels) {
            const m = cat.manifests.get(id);
            const a = cat.byId.get(id);
            if (m === undefined || a === undefined) continue;
            const panel = document.createElement('details');
            panel.className = 'wizard-addon-panel';
            panel.open = openPanels.has(id);
            panel.addEventListener('toggle', () => {
                if (panel.open) openPanels.add(id);
                else openPanels.delete(id);
            });
            const sum = document.createElement('summary');
            sum.textContent = m.name;
            panel.appendChild(sum);
            const body = document.createElement('div');
            body.className = 'wizard-addon-panel-body';
            for (const f of m.flags) {
                if (f.name === a.masterFlag) continue; // the tick is the master switch
                makeVictoryCheckbox(body, f.label, () => choice.flags[f.name] ?? f.default, (x) => {
                    overrides.flags[f.name] = x;
                    options.scenario = addonChoiceFor(cat, picked, overrides);
                });
                if (f.description) {
                    const note = document.createElement('div');
                    note.className = 'wizard-todo wizard-scenario-note';
                    note.textContent = f.description;
                    body.appendChild(note);
                }
            }
            for (const p of m.params) {
                makeVictoryNumberRow(body, p.label, '', p.min ?? -Number.MAX_SAFE_INTEGER, p.max ?? Number.MAX_SAFE_INTEGER, () => choice.params[p.name] ?? p.default, (x) => {
                    overrides.params[p.name] = x;
                    options.scenario = addonChoiceFor(cat, picked, overrides);
                });
            }
            panel.appendChild(body);
            detail.appendChild(panel);
        }
    }

    render();
    void loadScenarioIndex(fetchText).then((list) => {
        wizardScenarios = list;
        cat = addonCatalog(list);
        update();
    });
    return wrap;
}

/** A description's opening (the picker's one-liner; the full text is the row's hover title): its first sentence, or
 * the first two when the first is only a label ("End-game hidden threat."). */
export function firstSentence(text: string): string {
    const sentences = text.trim().match(/[^.!?]*(?:[.!?](?=\s|$)|[^.!?]+$)|[^\s].*$/g) ?? [];
    let out = '';
    for (const s of sentences) {
        out = (out + s).trim() === '' ? '' : out + s;
        if (out.trim().length >= 40) break;
    }
    return out.trim() || text.trim();
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
        // [wizardB1] the playstyle and the options added with it.
        const typeSpec = [...PLAYSTYLE_CUSTOM, ...PLAYSTYLE_ERAS].find((p) => p.type === (options.empireType ?? 'CustomStandard'));
        const pirate = empireTypeIsPirate(options.empireType);
        const stories = [
            options.victory.enableStoryDistantWorlds === true && 'Distant Worlds',
            !pirate && options.victory.enableStoryEvents === true && 'Return of the Shakturi',
            (options.galaxyExpansionIndex ?? 1) === 0 && options.victory.enableStoryEventsShadows === true && 'Shadows',
        ].filter(Boolean).join(', ');
        const rows: Array<[string, string]> = [
            ['Playstyle', typeSpec !== undefined ? wt(typeSpec.titleTag, typeSpec.title) : String(options.empireType)],
            ...(pirate ? [['Pirate Playstyle', PIRATE_PLAYSTYLE_NAMES[options.piratePlayStyleIndex ?? 0] ?? 'Balanced'] as [string, string]] : []),
            ['Galaxy Shape', shapeOpt.label],
            ['Star Amount', STAR_AMOUNT_TICKS[options.starCountIndex] ?? `${starCountFor(options.starCountIndex)} stars`],
            ['Physical Size', PHYSICAL_SIZE_TICKS[options.dimensionIndex] ?? `${sectorsFor(options.dimensionIndex)}×${sectorsFor(options.dimensionIndex)} sectors`],
            ['Colony Prevalence', COLONY_PREVALENCE_TICKS[options.colonyPrevalenceIndex] ?? `index ${options.colonyPrevalenceIndex}`],
            ['Alien Life', ALIEN_LIFE_TICKS[options.alienLifeIndex] ?? `index ${options.alienLifeIndex}`],
            ['Space Creatures', SPACE_CREATURES_TICKS[options.spaceCreaturesIndex] ?? `index ${options.spaceCreaturesIndex}`],
            ['Pirates', `${PIRATES_TICKS[options.piratesIndex] ?? `index ${options.piratesIndex}`} · ${PIRATE_STRENGTH_TICKS[options.pirateStrengthIndex ?? 2]} · ${PIRATE_PROXIMITY_NAMES[options.pirateProximityIndex ?? 1]}${options.destroyedPiratesDoNotRespawn === true ? ' · no respawn' : ''}`],
            ['Aggression', AGGRESSION_TICKS[options.aggressionIndex] ?? `index ${options.aggressionIndex}`],
            ['Expansion', EXPANSION_TICKS[options.galaxyExpansionIndex ?? 1] ?? `index ${options.galaxyExpansionIndex}`],
            ['Empire Size', EMPIRE_SIZE_TICKS[options.empireExpansionIndex ?? 1] ?? `index ${options.empireExpansionIndex}`],
            ['Tech Level', TECH_LEVEL_TICKS[options.empireTechLevelIndex ?? 1] ?? `index ${options.empireTechLevelIndex}`],
            ['Difficulty', DIFFICULTY_TICKS[options.difficultyIndex] ?? `index ${options.difficultyIndex}` + (options.difficultyScaling ? ' (scales near victory)' : '')],
            ['Your Race', options.raceName || '(not chosen)'],
            ['Home System', `${HOME_SYSTEM_TICKS[options.homeSystemIndex ?? 2]} · ${startLocationsForShape(options.shape)[options.startLocationIndex ?? 0] ?? '(Random)'} · corruption ${CORRUPTION_TICKS[options.empireCorruptionIndex ?? 1]}`],
            ['Story Lines', stories || 'None'],
            ['Game Options', [
                (options.spawnNewEmpires ?? true) ? 'new empires during game' : 'no new empires',
                (options.allowTechTrading ?? true) ? 'tech trading' : 'no tech trading',
                (options.allowGiantKaltorGeneration ?? true) ? 'Giant Kaltors' : 'no Giant Kaltors',
            ].join(', ')],
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