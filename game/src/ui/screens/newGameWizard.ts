// New-game wizard (tasks 06b/06d/06e/06h, [wizardB1], WP1 restyle): Playstyle → (Jump Start | The Galaxy →
// Colonization and Territory → Your Race → Your Empire → Other Empires → Victory Conditions → Scenario → Start).
//
// The original's look and layout: Start.cs method_31 opens pnlNewGame (a ScreenPanel, 927 × 768, centred) whose body
// holds the help line (lblHelpTitle (10, 7) font_6 yellow + lblHelpDescription font_3 yellow, Start.2.cs method_100)
// and one 900 × 660 page panel at (5, 40) per step. Each page is laid out in its own method, in the page's pixels:
//   Playstyle            pnlStartNewGameYourEmpireType      Start.cs 3496 method_41
//   Jump Start           pnlStartNewGameJumpStart           Start.cs 2924 method_36 (+ 2904 method_35)
//   The Galaxy           pnlStartNewGameTheGalaxy           Start.cs 3062 method_37
//   Colonization         pnlStartNewGameColonizationTerritory Start.cs 2835 method_34
//   Your Race            pnlStartNewGameYourRace            Start.cs 3570 method_42
//   Your Empire          pnlStartNewGameYourEmpire          Start.cs 3337 method_40
//   Other Empires        pnlStartNewGameOtherEmpires        Start.cs 3615 method_43
//   Victory Conditions   pnlStartNewGameVictoryConditions   Start.cs 3670 method_44 (+ 3771 method_45)
// with the controls of Start.InitializeComponent.cs (LabelledTrackBar, GlassButton, GradientPanel, RaceDropDown,
// GovernmentStyleDropDown, ColorDropDown, RaceSummaryPanel, StartingEmpiresListView, RoundRectanglePanel) from the
// shared original-style toolkit (originalWindow.ts / originalWindowControls.ts), and the pages' pictures read from
// Start.resx at runtime (resxImage.ts). Each page's "<< Previous" / "Next >>" GlassButtons are 300 × 40 font_7 at
// (10, 610) / (590, 610).
//
// Recreation additions, styled like the rest: the custom galaxy size (star-count box, Sectors W × H boxes, their
// preset lists and the density warning) in place of the Star Amount / Physical Size trackbars, the seed box, "Scale
// debris fields with galaxy size", the Scenario (add-on) page and the Start summary page, the playstyle descriptions
// in the help line, the manual empire list's ✕ / Add buttons and the empire-count notes.
import { themeFlagShapeUrls } from '../../themeAssets';
import './newGameWizard.css';
import { GalaxyShape } from '../../sim/types';
import {
    applyEmpireDefaults,
    COLONIZATION_RANGE_KLY_MAX,
    COLONIZATION_RANGE_KLY_MIN,
    COLONY_INFLUENCE_RANGE_PCT_MAX,
    COLONY_INFLUENCE_RANGE_PCT_MIN,
    colonyInfluenceRangeSuggestion,
    defaultRaceName,
    wizardStartGameOptions,
    scenarioChoiceSummary,
    flagShapeUrl,
    OTHER_EMPIRES_COUNT_MAX,
    OTHER_EMPIRES_COUNT_MIN,
    type ManualEmpireStart,
    sectorsFor,
    starCountFor,
    CUSTOM_MAX_SECTORS,
    CUSTOM_MIN_SECTORS,
    GALAXY_STAR_COUNT_MIN,
    STAR_COUNT_PRESETS,
    SECTOR_PRESETS,
    galaxyDensityWarning,
    galaxySectorCounts,
    galaxySizeIsCustom,
    galaxyStarCount,
    setGalaxySectors,
    setGalaxyStarCount,
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
import { formatNet, isTextLoaded, loadText, tryGetText } from '../../sim/textResolver';
import { pirateModifierLines } from './empireSummaryModel';
import { racePictureCanvas, racePicturePlan } from '../raceLandscapePicture';
import { PIRATE_FLAG_SHAPES, pirateFlagShapeUrl } from '../empireEmblem';
// [wizardB1] end
import { parseRace, type Race } from '../../sim/data/races';
import { parseRaceFamilies, type RaceFamily } from '../../sim/data/raceFamilies';
import { parseGovernments, type Government } from '../../sim/data/governments';
import { parseResources } from '../../sim/data/resources';
import { parseComponents } from '../../sim/data/components';
import { parseFacilities } from '../../sim/data/facilities';
import { parseResearch } from '../../sim/data/research';
import { parseGameText, type GameText } from '../../sim/data/gameText';
import { fetchText } from '../../sim/data/fetchData';
import { resolveThemedDataUrl, themedRaceFiles } from '../../sim/data/paths';
import { DEFAULT_RACE_FILES } from '../../sim/data/gameData';
import { activeCustomizationSetName } from '../../sim/data/customization';
import { selectColorFromKey } from '../../sim/empireColors';
import { loadScenarioIndex } from '../../sim/scenario/fetchScenario';
import type { ScenarioManifest } from '../../sim/scenario/manifest';
import { SMARTER_AI_ADDON_ID, addonCatalog, addonPickerModel, canonicalAddons, defaultSmarterAIChoice, planAddonStart, resolveAddonSwitches, toggleAddon, withSmarterAI, type AddonCatalog, type AddonOverrides, type AddonRow, type SmarterAIChoice } from '../../sim/scenario/addons';
import {
    COLORS,
    FONT,
    OwGrid,
    checkBox,
    dropDown,
    el,
    glassButton,
    gradientPanel,
    imageCombo,
    linkLabel,
    openOriginalWindow,
    place,
    scrollPanel,
    setButtonLabel,
    setText,
    text,
    textBox,
    type GlassButtonOptions,
    type ImageComboItem,
    type TextOptions,
} from '../originalWindow';
import { checkBoxRight, colorDropDown, colorSlider, groupBox, labelledTrackBar, radioButton, raceDropDown, roundRectanglePanel } from '../originalWindowControls';
import { startResxImageUrl } from '../resxImage';
import { generateRaceSummary, openGalactopedia, type RaceSummaryData, type RaceSummarySection } from './galactopedia';

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
    /** GameText tag of the description lblStartNewGameGalaxyShapeDescription shows (Start.1.cs 4003 method_205). */
    descriptionTag?: string;
}

/** Radio list order + labels/preview art (task 06b source); descriptions from Start.1.cs method_205. */
export const SHAPE_OPTIONS: ShapeOption[] = [
    { shape: GalaxyShape.Elliptical, label: 'Elliptical', image: 'galaxyshape_elliptical.png', description: 'A smooth elliptical distribution of stars.', descriptionTag: 'Elliptical galaxies have a classic spiral shape' },
    { shape: GalaxyShape.Spiral, label: 'Spiral', image: 'galaxyshape_spiral.png', description: 'A classic spiral galaxy with several arms.', descriptionTag: 'Spiral galaxies have a distinctive shape' },
    { shape: GalaxyShape.Ring, label: 'Ring', image: 'galaxyshape_ring.png', description: 'Stars arranged in a ring around an empty core.', descriptionTag: 'Ring galaxies contain most of their stars' },
    { shape: GalaxyShape.Irregular, label: 'Irregular', image: 'galaxyshape_irregular.png', description: 'An irregular, unstructured scattering of stars.', descriptionTag: 'Irregular galaxies have no fixed shape or structure' },
    { shape: GalaxyShape.ClustersEven, label: 'Even Clusters', image: 'galaxyshape_clusterseven.png', description: 'Stars grouped into evenly sized clusters.', descriptionTag: 'Cluster galaxies have groups of stars clustered together' },
    { shape: GalaxyShape.ClustersVaried, label: 'Varied Clusters', image: 'galaxyshape_clustersvaried.png', description: 'Stars grouped into clusters of varied sizes.', descriptionTag: 'Cluster galaxies have groups of stars clustered together Varied' },
];

export const STAR_AMOUNT_TICKS = ['Dwarf 100', 'Tiny 250', 'Small 400', 'Standard 700', 'Large 1000', 'Huge 1400'];
export const PHYSICAL_SIZE_TICKS = ['Tiny 4×4', 'Small 6×6', 'Medium 8×8', 'Large 10×10', 'Huge 15×15 sectors'];

/** The Colonization page's two trackbars (Start.cs 2843 method_34 SetLabels): Colony Prevalence and Independent Alien
 *  Life; Aggression, Space Creatures and Pirates as on The Galaxy page (method_37). */
export const COLONY_PREVALENCE_TICKS = ['Scarce', 'Occasional', 'Normal', 'Plentiful', 'Abundant'];
export const ALIEN_LIFE_TICKS = ['Rare', 'Scattered', 'Normal', 'Plentiful', 'Teeming'];
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

/** Title-bar text per page ("Start a New Game: <page title>", pnlNewGame.HeaderTitle). */
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

/** Back-button label per page: the original's "<< Previous: <page>" (Start.1.cs 4905-4913 SetControlLocalizedLabels);
 *  the Playstyle page's button returns to the main menu (the original has only the close button there). */
export const WIZARD_BACK_LABELS: Record<WizardPageId, string> = {
    type: '<< Main Menu',
    jumpstart: '<< Previous: Playstyle',
    galaxy: '<< Previous: Playstyle',
    colonization: '<< Previous: The Galaxy',
    race: '<< Previous: Colonization and Territory',
    empire: '<< Previous: Your Race',
    empires: '<< Previous: Your Empire',
    victory: '<< Previous: Other Empires',
    scenario: '<< Previous: Victory Conditions',
    start: '<< Previous: Scenario',
};

/** Forward-button label per page: "Next: <page> >>", and the original's "Start the Game!" (btnStartNewGameStart /
 *  btnJumpStartTheGalaxyNext) on the pages that start the game. */
export const WIZARD_FORWARD_LABELS: Record<WizardPageId, string> = {
    type: '',
    jumpstart: 'Start the Game!',
    galaxy: 'Next: Colonization and Territory >>',
    colonization: 'Next: Your Race >>',
    race: 'Next: Your Empire >>',
    empire: 'Next: Other Empires >>',
    empires: 'Next: Victory Conditions >>',
    victory: 'Next: Scenario >>',
    scenario: 'Next: Start >>',
    start: 'Start the Game!',
};

/** Task 06e: governments available to a new player empire at start. The
 * original's Government type carries an availability field (0 = all empires)
 * plus specialFunctionCode — storyline-only governments have a non-zero
 * special function (e.g. 1 = nationalize private sector), so both are
 * excluded here. */
export function filterStartGovernments(governments: Government[]): Government[] {
    return governments.filter((g) => g.availability === 0 && g.specialFunctionCode === 0);
}

/** .NET `(value).ToString("+#0%;-#0%;<zero>")`: the percentage rounded half away from zero, a sign, or `zero` when it
 *  rounds to 0. */
function signedPercent(value: number, zero: string): string {
    const pct = Math.floor(Number((Math.abs(value) * 100).toPrecision(15)) + 0.5);
    if (pct === 0) return zero;
    return `${value < 0 ? '-' : '+'}${pct}%`;
}

/** Port of Start.1.cs 4258 method_208: lblStartNewGameYourEmpireGovernmentAttributes — eight "Name: +x%" lines of the
 *  government's factors ("Normal" at 1.0), or "(Government randomly selected)" without one. */
export function governmentAttributesText(gov: Government | null, getText: (tag: string) => string = (t) => wt(t, t)): string {
    if (gov === null) return `(${getText('Government randomly selected')})`;
    const normal = getText('Normal');
    const lines: Array<[string, number]> = [
        ['Approval', gov.approvalRating],
        ['Corruption', gov.corruption],
        ['Growth rate', gov.populationGrowth],
        ['Research speed', gov.researchSpeed],
        ['Colony Income', gov.tradeBonus],
        ['Maintenance costs', gov.maintenanceCosts],
        ['Troop recruitment', gov.troopRecruitment],
        ['War weariness', gov.warWeariness],
    ];
    return lines.map(([tag, v]) => `${getText(tag)}: ${signedPercent(v - 1.0, normal)}`).join('\n');
}

/** Task 06d: the original's race portrait file names (Main.Part13.cs ~2195):
 * race_<i>.png, indexed by the race's PictureRef, with alternate
 * race_<i>a.png. Kept here (pure) so tests can check them without a DOM. */
export function racePortraitUrls(pictureRef: number): string[] {
    return [`${RACES_DIR}race_${pictureRef}.png`, `${RACES_DIR}race_${pictureRef}a.png`];
}

/** ColorDropDown.Ignite → ResolveColors: Galaxy.SelectColorFromKey(0 .. 19) (white and black not allowed). */
export function wizardColorPalette(): string[] {
    return Array.from({ length: 20 }, (_, k) => `#${selectColorFromKey(k).toString(16).padStart(6, '0')}`);
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
    const themed = themeFlagShapeUrls(false); // the active theme's folder replaces the stock list
    if (themed !== null && themed.length > 0) return themed;
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

interface WizardRaceData {
    races: Race[];
    families: RaceFamily[];
    missing: string[];
}

/** The race data of this wizard session (reset when a wizard opens, so a theme change between openings is seen). */
let raceDataPromise: Promise<WizardRaceData> | null = null;

/** Load all races (races/*.txt) plus raceFamilies.txt via the same URL
 * resolution the engine uses (Customization/<set>/ first, base last). A race
 * file that is absent from the install (or a customization set) makes the dev
 * server answer with its SPA index.html fallback instead of the .txt — we
 * detect that and skip the file rather than parsing garbage, so a partial
 * install still lists every race it actually has. */
function loadWizardRaceData(): Promise<WizardRaceData> {
    raceDataPromise ??= (async () => {
        // Galaxy.LoadRaces (Start.cs 1318) reads every file of the races/ folder;
        // the asset manifest is that folder listing (same source loadGameData uses).
        // With a theme: its races\ folder replaces the stock one (themedRaceFiles), its raceFamilies.txt the stock file.
        const raceSource = themedRaceFiles(wizardRaceFiles((await loadWizardManifest())?.races));
        const familyText = await fetchText(resolveThemedDataUrl('raceFamilies.txt'));
        const races: Race[] = [];
        const missing: string[] = [];
        for (const f of raceSource.files) {
            const text = await fetchText(raceSource.url(f));
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
    })();
    raceDataPromise.catch(() => {
        raceDataPromise = null;
    });
    return raceDataPromise;
}

/** True when a fetched data body is a real DW:U .txt file (starts with the
 * "'Distant Worlds" comment line) rather than the dev server's HTML 404
 * fallback for a missing file. */
function isRaceFileText(text: string): boolean {
    const first = text.split(/\r\n|\r|\n/, 1)[0]?.trimStart() ?? '';
    return first.startsWith("'");
}

/** Build the new-game wizard and append it to document.body. When opened via ?screen=wizard&page=empire the wizard
 * starts on the named page (screenshot/dev hook; main.ts does not pass the page). */
export function createNewGameWizard(callbacks: NewGameWizardCallbacks): NewGameWizardRefs {
    raceDataPromise = null;
    summaryDataPromise = null;
    governmentsPromise = null;
    const options: StartGameOptions = wizardStartGameOptions();
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
    // Re-show the current page once GameText.txt is in, so its texts use the game's text.
    void ensureWizardGameText().then(() => {
        if (!torn) showPage(page);
    });

    // The main menu's background behind the window (the original draws pnlNewGame on the Start form).
    const overlay = document.createElement('div');
    overlay.className = 'wizard-overlay';
    document.body.appendChild(overlay);

    // Start.cs method_31: pnlNewGame 927 × 768, centred.
    let torn = false;
    const win = openOriginalWindow({
        id: 'newgame',
        title: `Start a New Game: ${WIZARD_PAGE_TITLES[page]}`,
        width: 927,
        height: 768,
        noAutoPause: true,
        // The close button / Escape (pnlNewGame_CloseButtonClicked): back to the main menu.
        onClose: () => {
            if (torn) return;
            teardown();
            callbacks.onBackToMenu();
        },
    });
    win.frame.classList.add('wizard-window');
    overlay.appendChild(win.root);
    const body = win.body;
    body.classList.add('wizard-body');

    // --- The help line (lblHelpTitle / lblHelpDescription, Start.2.cs method_100). ---
    const helpTitle = text('', { size: FONT.normal, bold: true, color: 'rgb(255, 255, 0)', shadow: false, className: 'wizard-help-title' });
    const helpDesc = text('', { size: FONT.large, color: 'rgb(255, 255, 0)', shadow: false, className: 'wizard-help-desc' });
    body.append(place(helpTitle, 10, 7), place(helpDesc, 175, 8));
    function help(title: string, desc: string): void {
        setText(helpTitle, title);
        setText(helpDesc, desc);
        // lblHelpDescription.Location = (lblHelpTitle.Width + 15, 8), MaximumSize (900 - Left, 32).
        const left = (title === '' ? 0 : helpTitle.offsetWidth) + 15;
        helpDesc.style.left = `${left}px`;
        helpDesc.style.width = `${900 - left}px`;
        helpDesc.title = desc;
    }
    const ctx: WizardCtx = {
        options,
        help,
        helpOn(target, fn) {
            const show = (): void => {
                const [t, d] = fn();
                help(t, d);
            };
            target.addEventListener('focusin', show);
            target.addEventListener('pointerdown', show);
        },
        listParent: () => body,
        refreshScenario: () => {},
    };

    // --- Page containers (built once, shown/hidden on navigation), 900 × 660 at (5, 40). ---
    const typePage = buildTypePage(ctx, (t) => {
        applyEmpireTypeChoice(options, t);
        // Start.cs 5374 btnStartNewGameIntroductory_Click starts the preset game at once (toCreateGameOptionsIntroductory).
        if (t === 'Introductory') {
            callbacks.onStartGame({ ...options });
            return;
        }
        showPage(empireTypeIsCustom(t) ? 'galaxy' : 'jumpstart');
    });
    const jumpStartPage = buildJumpStartPage(ctx);
    const galaxyPage = buildGalaxyPage(ctx);
    const colonizationPage = buildColonizationPage(ctx);
    const racePage = buildRacePage(ctx, handleRaceChanged);
    const empirePage = buildEmpirePage(ctx);
    const empiresPage = buildOtherEmpiresPage(ctx);
    const victoryPage = buildVictoryPage(ctx);
    const scenarioPage = buildScenarioPage(ctx);
    const startPage = buildStartPage(ctx);
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
    for (const pageEl of Object.values(pageEls)) {
        pageEl.style.display = 'none';
        body.appendChild(place(pageEl, 5, 40, 900, 660));
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

    // --- The page's "<< Previous" / "Next >>" GlassButtons (300 × 40, font_7, at (10, 610) / (590, 610)). ---
    const backBtn = glassButton('', { size: FONT.header, className: 'wizard-btn wizard-btn-secondary', onClick: () => goBack() });
    const nextBtn = glassButton('', { size: FONT.header, className: 'wizard-btn wizard-btn-primary', onClick: () => goForward() });
    body.append(backBtn, nextBtn);

    function showPage(id: WizardPageId): void {
        page = id;
        win.setTitle(`Start a New Game: ${WIZARD_PAGE_TITLES[id]}`);
        for (const [pid, pageEl] of Object.entries(pageEls)) {
            pageEl.style.display = pid === id ? '' : 'none';
        }
        setButtonLabel(backBtn, WIZARD_BACK_LABELS[id]);
        setButtonLabel(nextBtn, WIZARD_FORWARD_LABELS[id]);
        // The Playstyle page continues through its own buttons; its "<< Main Menu" sits left of the Introductory frame.
        if (id === 'type') place(backBtn, 5 + 10, 40 + 46, 200, 40);
        else place(backBtn, 5 + 10, 40 + 610, 300, 40);
        place(nextBtn, 5 + 590, 40 + 610, 300, 40);
        nextBtn.style.display = id === 'type' ? 'none' : '';
        help('', '');
        // [wizardB1] pages whose controls depend on the playstyle / other pages re-sync when shown.
        (pageEls[id] as unknown as { __onShow?: () => void }).__onShow?.();
        if (id === 'start') {
            refreshStartSummary();
        }
    }

    function goBack(): void {
        if (page === 'type') {
            win.close();
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
            ctx.refreshScenario();
            callbacks.onStartGame({ ...options });
            return;
        }
        const idx = WIZARD_PAGES.indexOf(page);
        if (idx < WIZARD_PAGES.length - 1) {
            showPage(WIZARD_PAGES[idx + 1]);
        } else {
            ctx.refreshScenario();
            callbacks.onStartGame({ ...options });
        }
    }

    // Keyboard nav: Enter advances (like clicking the forward button); Escape closes the window (the ScreenPanel's
    // close button, originalWindow.ts) — straight back to the main menu, not the per-page "Previous".
    function onKeyDown(e: KeyboardEvent): void {
        if (e.key !== 'Enter') return;
        const t = e.target as HTMLElement | null;
        // A window over the wizard (the Galactopedia, a message box) keeps its own Enter.
        if (t !== null && t !== document.body && !win.frame.contains(t)) return;
        // Let a combo box keep its own Enter handling (closing/confirming its dropdown) rather than also advancing.
        if (t?.tagName === 'SELECT' || t?.closest('.ow-combo') != null) return;
        e.preventDefault();
        goForward();
    }
    document.addEventListener('keydown', onKeyDown);

    function teardown(): void {
        if (torn) return;
        torn = true;
        document.removeEventListener('keydown', onKeyDown);
        win.close();
        overlay.remove();
    }

    showPage(page);

    return {
        root: overlay,
        destroy: teardown,
    };
}

// ---------------------------------------------------------------------------
// Shared page helpers (original pixels inside the page / panel, place()).
// ---------------------------------------------------------------------------

interface WizardCtx {
    options: StartGameOptions;
    /** Start.2.cs method_100: the help line's title and description. */
    help: (title: string, desc: string) => void;
    /** The control's Enter event sets the help line (Start.1.cs / Start.2.cs *_Enter → method_100). */
    helpOn: (target: HTMLElement, fn: () => [string, string]) => void;
    /** Where open combo lists go (the window body: the GradientPanels clip their children). */
    listParent: () => HTMLElement;
    /** Recomputes options.scenario from the Scenario page's picks and options.smarterAI (set by the Scenario page). */
    refreshScenario: () => void;
}

/** TextResolver.GetText(tag) when GameText.txt is loaded, else the English text it holds (GameText.txt). */
function wt(tag: string, fallback: string): string {
    return (tryGetText(tag) ?? fallback).replace(/\\n/g, '\n');
}

/** GetText(a) + ": " + GetText(b), the help titles' form. */
function helpTitle2(a: string, b: string): string {
    return `${wt(a, a)}: ${wt(b, b)}`;
}

/** The wizard runs before the game data loads; load GameText.txt for its descriptions (no-op once loaded). */
async function ensureWizardGameText(): Promise<void> {
    if (isTextLoaded()) return;
    try {
        const text = await fetchText(resolveThemedDataUrl('GameText.txt'));
        if (!isTextLoaded() && isRaceFileText(text)) loadText(text);
    } catch {
        // keep the English fallbacks
    }
}

/** A page panel (System.Windows.Forms.Panel, transparent). */
function pageDiv(className: string): HTMLDivElement {
    return el('div', `wizard-page ${className}`);
}

/** A SmoothLabel / Label: (170, 170, 170), no drop shadow, font_0 unless given. */
function label(parent: HTMLElement, content: string, x: number, y: number, o: TextOptions = {}): HTMLDivElement {
    const t = text(content, { size: FONT.normal, color: COLORS.label, shadow: false, ...o });
    parent.appendChild(place(t, x, y));
    return t;
}

/** A GradientPanel of the new-game pages: (39, 40, 44) / (22, 21, 26) / (51, 54, 61), 2 px (67, 67, 77) border,
 *  Curvature 20 on all corners (pnlStartNewGameGalaxyShapeSize etc., Start.InitializeComponent.cs). */
function panel(parent: HTMLElement, x: number, y: number, w: number, h: number, className = ''): HTMLDivElement {
    const p = gradientPanel({ corners: { tl: true, tr: true, br: true, bl: true }, radius: 20, borderWidth: 2, className: `wizard-panel${className ? ` ${className}` : ''}` });
    parent.appendChild(place(p, x, y, w, h));
    return p;
}

interface TrackBarSpec {
    x: number;
    y: number;
    w: number;
    h: number;
    label: string;
    labelWidth?: number;
    labels: readonly string[];
    value: number;
    onChange: (i: number) => void;
    sliderOffset?: number;
    linkWidth?: number;
    linkText?: string;
    onLink?: () => void;
    className?: string;
}

/** A LabelledTrackBar after Setup() (font_0, the step labels above a 10 px-thumb ColorSlider). */
function trackBar(parent: HTMLElement, s: TrackBarSpec): ReturnType<typeof labelledTrackBar> {
    const t = labelledTrackBar({
        width: s.w,
        height: s.h,
        labelText: s.label,
        labelWidth: s.labelWidth ?? 100,
        labels: s.labels,
        value: s.value,
        size: FONT.normal,
        onChange: s.onChange,
        sliderOffset: s.sliderOffset,
        linkWidth: s.linkWidth,
        linkText: s.linkText,
        onLink: s.onLink,
    });
    t.el.classList.add('wizard-trackbar', 'wizard-slider');
    if (s.className) t.el.classList.add(s.className);
    parent.appendChild(place(t.el, s.x, s.y));
    return t;
}

/** A CheckBox ((170, 170, 170), font_3 unless given). */
function check(parent: HTMLElement, content: string, checked: boolean, x: number, y: number, onChange: (v: boolean) => void, size: number = FONT.large): { row: HTMLLabelElement; input: HTMLInputElement; label: HTMLSpanElement } {
    const row = checkBox(content, checked, onChange, size);
    row.classList.add('wizard-checkbox');
    parent.appendChild(place(row, x, y));
    return { row, input: row.querySelector('input')!, label: row.querySelector('span')! };
}

/** A ComboBox (DropDownList, FlatStyle Popup, (48, 48, 64) / (170, 170, 170)) bound to an item index. */
function combo(parent: HTMLElement, items: readonly string[], index: number, x: number, y: number, w: number, h: number, onChange: (i: number) => void, className = ''): { select: HTMLSelectElement; setItems: (items: readonly string[], index: number) => void } {
    const select = dropDown(
        items.map((t, i) => ({ value: String(i), label: t })),
        String(index),
        (v) => onChange(parseInt(v, 10)),
    );
    select.classList.add('wizard-combo');
    if (className) for (const c of className.split(' ')) select.classList.add(c);
    select.style.fontSize = `${FONT.normal}px`;
    parent.appendChild(place(select, x, y, w, h));
    function setItems(list: readonly string[], i: number): void {
        select.replaceChildren(
            ...list.map((t, k) => {
                const opt = el('option', '', t);
                opt.value = String(k);
                return opt;
            }),
        );
        select.value = String(Math.min(Math.max(0, i), list.length - 1));
    }
    return { select, setItems };
}

/** A NumericUpDown-looking box ((48, 48, 64) / (170, 170, 170), up / down buttons) that keeps a plain number field's
 *  semantics: the caller reads `input.value` on 'input' / 'change'; the buttons and arrow keys step it by 1 inside
 *  [min, max] and fire both events. */
function spinBox(className: string, value: number | string, bounds: { min?: number; max?: number } = {}): { el: HTMLDivElement; input: HTMLInputElement } {
    const wrap = el('div', 'ow-spin wizard-spin');
    const input = el('input', `ow-spin-input ${className}`);
    input.type = 'text';
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = String(value);
    input.style.textAlign = 'right';
    const up = el('button', 'ow-spin-btn ow-spin-up');
    const down = el('button', 'ow-spin-btn ow-spin-down');
    up.type = down.type = 'button';
    up.tabIndex = down.tabIndex = -1;
    wrap.append(input, up, down);
    const bump = (d: number): void => {
        const cur = parseInt(input.value, 10);
        let v = (Number.isNaN(cur) ? 0 : cur) + d;
        if (bounds.min !== undefined) v = Math.max(bounds.min, v);
        if (bounds.max !== undefined) v = Math.min(bounds.max, v);
        input.value = String(v);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    up.addEventListener('click', (e) => {
        e.stopPropagation();
        bump(1);
    });
    down.addEventListener('click', (e) => {
        e.stopPropagation();
        bump(-1);
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            bump(e.key === 'ArrowUp' ? 1 : -1);
        }
    });
    return { el: wrap, input };
}

/** A GlassButton (15.83 px bold, Start.cs 1014 method_152 for every GlassButton, unless given). */
function glass(parent: HTMLElement, content: string, x: number, y: number, w: number, h: number, onClick: () => void, o: GlassButtonOptions = {}): HTMLButtonElement {
    const b = glassButton(content, { onClick, size: 15.83, ...o });
    parent.appendChild(place(b, x, y, w, h));
    return b;
}

/** A PictureBox whose image is a Start.resx resource (read from the install at runtime, resxImage.ts); SizeMode
 *  Normal (top-left, clipped), Zoom or CenterImage. Empty when the install has no decompiled source. */
function resxPicture(parent: HTMLElement, name: string, x: number, y: number, w: number, h: number, mode: 'normal' | 'zoom' | 'center', className = ''): HTMLDivElement {
    const box = place(el('div', `wizard-picture wizard-picture-${mode}${className ? ` ${className}` : ''}`), x, y, w, h);
    void startResxImageUrl(name).then((u) => {
        if (u === null) return;
        const img = el('img');
        img.src = u;
        img.alt = '';
        img.draggable = false;
        box.appendChild(img);
    });
    parent.appendChild(box);
    return box;
}

/** A LinkLabel (255, 192, 0) at font_3 that opens the Galactopedia on a topic (Start.1.cs method_127). */
function helpLink(parent: HTMLElement, content: string, x: number, y: number, topic: () => string, maxWidth?: number): HTMLAnchorElement {
    const a = linkLabel(content, () => openGalactopedia({ topic: topic() }), FONT.large);
    a.classList.add('wizard-link');
    if (maxWidth !== undefined) {
        a.style.maxWidth = `${maxWidth}px`;
        a.style.whiteSpace = 'normal';
    }
    parent.appendChild(place(a, x, y));
    return a;
}

// ---------------------------------------------------------------------------
// [wizardB1] The Playstyle page (Start.cs pnlStartNewGameYourEmpireType, laid out by Start.cs 3496 method_41) and the
// Jump Start page (pnlStartNewGameJumpStart, Start.cs 2904 method_35 / 2924 method_36).
// ---------------------------------------------------------------------------

/** Every playstyle the page offers (Start.cs wjhRtsSwmsa values). */
export const WIZARD_EMPIRE_TYPES: readonly WizardEmpireType[] = ['CustomStandard', 'CustomPirate', 'ShadowsStandard', 'ShadowsPirate', 'ClassicEra', 'ReturnOfTheShakturi', 'Legends'];

interface PlaystyleButtonSpec {
    type: WizardEmpireType | 'AncientGalaxy';
    titleTag: string;
    title: string;
    descTag: string;
    desc: string;
    /** Fallback picture when the install has no decompiled Start.resx. */
    image: string;
    /** The button's Image in Start.resx (btnStartNewGameYourEmpireType*.Image). */
    resx: string;
}

const PLAYSTYLE_ERAS: PlaystyleButtonSpec[] = [
    { type: 'AncientGalaxy', titleTag: 'Start New Game - Ancient Galaxy', title: 'The Ancient Galaxy', descTag: 'Start New Game Description - Ancient Galaxy', desc: 'Travel back to a time when the galaxy was young. Ancient empires have carved out their territories and formed alliances amongst themselves.', image: '/assets/dwu/images/ui/achievements/DefeatAncients.png', resx: 'btnStartNewGameYourEmpireTypeTheAncientGalaxy.Image' },
    { type: 'ShadowsPirate', titleTag: 'Start New Game - Shadows Pirate', title: 'Pirate Faction in the Age of Shadows', descTag: 'Start New Game Description - Shadows Pirate', desc: 'You are a pirate faction in the Age of Shadows. Civilization has crumbled and pirates, smugglers and mercenaries rule the galaxy.', image: `${CHROME}playstyle_pirateshadows.png`, resx: 'btnStartNewGameYourEmpireTypePirateShadows.Image' },
    { type: 'ShadowsStandard', titleTag: 'Start New Game - Shadows Standard', title: 'Standard Empire in the Age of Shadows', descTag: 'Start New Game Description - Shadows Standard', desc: 'You are a standard empire in the Age of Shadows. Civilization has crumbled and pirates, smugglers and mercenaries rule the galaxy.', image: `${CHROME}playstyle_normalshadows.png`, resx: 'btnStartNewGameYourEmpireTypeNormalShadows.Image' },
    { type: 'ClassicEra', titleTag: 'Start New Game - Classic Era', title: 'Classic Era', descTag: 'Start New Game Description - Classic Era', desc: 'You are a standard empire in the Classic Era. Your empire has begun to expand beyond your own star system.', image: `${CHROME}playstyle_normalclassic.png`, resx: 'btnStartNewGameYourEmpireTypeClassicEra.Image' },
    { type: 'ReturnOfTheShakturi', titleTag: 'Start New Game - Return of the Shakturi', title: 'Return of the Shakturi', descTag: 'Start New Game Description - Return of the Shakturi', desc: 'You are a standard empire in the Classic Era, with the Return of the Shakturi storyline.', image: '/assets/dwu/images/ui/achievements/DefeatShakturi.png', resx: 'btnStartNewGameYourEmpireTypeReturnOfTheShakturi.Image' },
    { type: 'Legends', titleTag: 'Start New Game - Legends', title: 'Legends', descTag: 'Start New Game Description - Legends', desc: 'You are a standard empire in the Classic Era. This start includes all of the Distant Worlds storyline and events: Original, Return of the Shakturi and Legends.', image: '/assets/dwu/images/ui/achievements/DefeatLegendaryPirates.png', resx: 'btnStartNewGameYourEmpireTypeLegends.Image' },
];
const PLAYSTYLE_CUSTOM: PlaystyleButtonSpec[] = [
    { type: 'CustomStandard', titleTag: 'Start New Game - Custom Standard', title: 'Custom Game as Standard Empire', descTag: 'Start New Game Description - Custom Standard', desc: 'Set up a new game as a standard empire with the full range of options.', image: `${CHROME}playstyle_normalclassic.png`, resx: 'btnStartNewGameYourEmpireTypeNormalClassic.Image' },
    { type: 'CustomPirate', titleTag: 'Start New Game - Custom Pirate', title: 'Custom Game as Pirate Faction', descTag: 'Start New Game Description - Custom Pirate', desc: 'Set up a new game as a pirate faction with the full range of options.', image: `${CHROME}playstyle_pirateclassic.png`, resx: 'btnStartNewGameYourEmpireTypePirateClassic.Image' },
];
const PLAYSTYLE_INTRODUCTORY: PlaystyleButtonSpec = { type: 'Introductory', titleTag: 'Introductory Game', title: 'Introductory Game', descTag: 'Start New Game Description - Introductory Game', desc: 'An introduction to Distant Worlds. Jump straight into an easy game in the Classic Era, with abundant resources and few pirates.', image: '', resx: '' };

function buildTypePage(ctx: WizardCtx, onChoose: (type: WizardEmpireType) => void): HTMLDivElement {
    const wrap = pageDiv('wizard-type-page');
    const newPlayers = (): [string, string] => [
        `${wt('Start New Game New Player Explanation Title UNIVERSE', 'NEW PLAYERS')}:`,
        wt('Start New Game New Player Explanation Text UNIVERSE', 'For a simple introduction to Distant Worlds try playing as a standard empire in the Classic Era.'),
    ];

    /** A playstyle GlassButton: the Image centred with the text over it (Button defaults: ImageAlign / TextAlign
     *  MiddleCenter, TextImageRelation Overlay); the description is the button's ToolTip (toolTip.SetToolTip) and,
     *  in the recreation, the help line on hover. */
    function makeButton(spec: PlaystyleButtonSpec, cls: string, size: number, labelText: string): HTMLButtonElement {
        const btn = glassButton(labelText, { size, className: `wizard-type-btn ${cls}`, title: wt(spec.descTag, spec.desc) });
        btn.dataset.type = spec.type;
        if (spec.resx !== '') {
            const img = el('img', 'wizard-type-img');
            img.alt = '';
            img.draggable = false;
            btn.insertBefore(img, btn.firstChild);
            void startResxImageUrl(spec.resx).then((u) => {
                if (u !== null) img.src = u;
                else {
                    img.classList.add('wizard-type-img-fallback');
                    img.src = spec.image;
                }
            });
        }
        const showDesc = (): void => {
            btn.title = wt(spec.descTag, spec.desc);
            ctx.help(`${wt(spec.titleTag, spec.title)}:`, wt(spec.descTag, spec.desc));
        };
        btn.addEventListener('mouseenter', showDesc);
        btn.addEventListener('focus', showDesc);
        if (spec.type === 'AncientGalaxy') {
            // TODO(port): The Ancient Galaxy (Start.cs 5583 btnStartNewGameYourEmpireTypeTheAncientGalaxy_Click: switches to
            // the "The Ancient Galaxy" theme — Customization/The Ancient Galaxy, a mod set — and starts its prebuilt galaxy
            // map maps/The Ancient Galaxy.dwg through method_221). Needs a reader for the .dwg (a .NET-serialized galaxy)
            // and theme switching; neither exists in the port.
            btn.disabled = true;
            btn.title = 'Not available yet';
        } else {
            const t = spec.type;
            btn.addEventListener('click', () => onChoose(t));
        }
        return btn;
    }

    // pnlStartNewGameIntroductoryBorder: RoundRectanglePanel 434 × 104 at (233, 14), BorderWidth 8, CornerCurveRadius 10,
    // ForeColor Green; btnStartNewGameIntroductory 420 × 90 at (7, 7), font_9.
    const intro = roundRectanglePanel('rgb(0, 128, 0)', 8, 10);
    intro.classList.add('wizard-type-intro');
    wrap.appendChild(place(intro, 233, 14, 434, 104));
    intro.appendChild(place(makeButton(PLAYSTYLE_INTRODUCTORY, 'wizard-type-btn-intro', FONT.title, `${wt('Introductory Game', 'Introductory Game')} >>`), 7 - 8, 7 - 8, 420, 90));

    // The six era buttons: 140 × 230 at (10 + i × 148, 140), font_7, "<title>>>".
    const eras = place(el('div', 'wizard-type-eras'), 0, 0, 900, 660);
    PLAYSTYLE_ERAS.forEach((spec, i) => {
        eras.appendChild(place(makeButton(spec, 'wizard-type-btn-era', FONT.header, `${wt(spec.titleTag, spec.title)}>>`), 10 + i * 148, 140, 140, 230));
    });
    wrap.appendChild(eras);

    // picStartNewGameYourEmpireTypeTimeline 880 × 150 at (10, 370).
    resxPicture(wrap, 'picStartNewGameYourEmpireTypeTimeline.Image', 10, 370, 880, 150, 'normal', 'wizard-type-timeline');

    // The two Custom buttons: 340 × 100 at (70, 540) and (490, 540), font_7.
    const custom = place(el('div', 'wizard-type-custom'), 0, 0, 900, 660);
    PLAYSTYLE_CUSTOM.forEach((spec, i) => {
        custom.appendChild(place(makeButton(spec, 'wizard-type-btn-custom', FONT.header, `${wt(spec.titleTag, spec.title)}>>`), i === 0 ? 70 : 490, 540, 340, 100));
    });
    wrap.appendChild(custom);

    // lblStartNewGameActiveTheme: "Current Theme: <name>" (Start.cs 1419 method_1), (255, 192, 0), font_6, centred at y 640.
    const theme = label(wrap, '', 450, 640, { bold: true, color: COLORS.link, className: 'ow-center wizard-type-theme' });

    (wrap as unknown as { __onShow?: () => void }).__onShow = () => {
        const [t, d] = newPlayers();
        ctx.help(t, d);
        const name = activeCustomizationSetName();
        setText(theme, name === '' ? '' : `${wt('Current Theme', 'Current Theme')}: ${name}`);
    };
    return wrap;
}

/** The galaxy shape radio buttons, preview, "<Shape> Galaxy" title and description (radStartNewGameGalaxyShape* /
 *  picStartNewGameTheGalaxyPreview / lblStartNewGameGalaxyShapeTitle / Description, Start.1.cs method_205 / 206). */
function buildShapeChooser(
    ctx: WizardCtx,
    parent: HTMLElement,
    group: string,
    L: { preview: [number, number, number]; title: [number, number]; desc: [number, number, number, number] },
): { sync: () => void } {
    const options = ctx.options;
    const radios: HTMLInputElement[] = [];
    const list = place(el('div', 'wizard-shape-list'), 0, 0);
    parent.appendChild(list);
    SHAPE_OPTIONS.forEach((opt, i) => {
        const r = radioButton(wt(opt.label, opt.label), group, opt.shape === options.shape, () => {
            options.shape = opt.shape;
            options.startLocationIndex = 0; // Start.1.cs 4064: the start-location combo resets with the shape
            update();
        }, FONT.large);
        r.classList.add('wizard-shape-item');
        const input = r.querySelector('input')!;
        input.value = String(opt.shape);
        radios.push(input);
        list.appendChild(place(r, 10, 10 + 20 * i));
        ctx.helpOn(r, () => [helpTitle2('The Galaxy', 'Shape'), wt('Determines the layout and distribution of stars within the galaxy', 'Determines the layout and distribution of stars within the galaxy')]);
    });
    const [px, py, ps] = L.preview;
    const preview = place(el('div', 'wizard-shape-preview'), px, py, ps, ps);
    const previewImg = el('img');
    previewImg.draggable = false;
    preview.appendChild(previewImg);
    parent.appendChild(preview);
    const title = label(parent, '', L.title[0], L.title[1], { size: FONT.header, bold: true, className: 'wizard-shape-title' });
    const desc = label(parent, '', L.desc[0], L.desc[1], { wrapWidth: L.desc[2], className: 'wizard-shape-desc' });
    desc.style.maxHeight = `${L.desc[3]}px`;
    function update(): void {
        const opt = SHAPE_OPTIONS.find((o) => o.shape === options.shape) ?? SHAPE_OPTIONS[1];
        previewImg.src = `${CHROME}${opt.image}`;
        previewImg.alt = opt.label;
        setText(title, formatNet(wt('SHAPE Galaxy', '{0} Galaxy'), [wt(opt.label, opt.label)]));
        setText(desc, opt.descriptionTag ? wt(opt.descriptionTag, opt.description) : opt.description);
    }
    function sync(): void {
        radios.forEach((r) => (r.checked = Number(r.value) === options.shape));
        update();
    }
    sync();
    return { sync };
}

/** The pirate playstyle combo, its description and picture (Start.cs 3384-3397 cmbVictoryPiratePlayStyle /
 *  lblPiratePlaystyleDescription / picStartNewGameYourEmpirePiratePlaystyle — Jump Start: cmbJumpStartVictoryPiratePlayStyle
 *  / pnlJumpStartPiratePlaystyleDescriptionContainer / picJumpStartYourEmpirePiratePlaystyle; text from Start.2.cs 3147
 *  method_101). `pictureSize`: the picture box the C# composes into (300 Your Empire, 160 Jump Start). */
function buildPiratePlaystyle(
    ctx: WizardCtx,
    parent: HTMLElement,
    L: { label: [number, number]; combo: [number, number, number, number]; desc: [number, number, number, number]; pic: [number, number, number] },
): { show: (on: boolean) => void; paint: () => void } {
    const options = ctx.options;
    const els: HTMLElement[] = [];
    els.push(label(parent, wt('Pirate Playstyle', 'Pirate Playstyle'), L.label[0], L.label[1], { size: FONT.header, bold: true }));
    const c = combo(parent, PIRATE_PLAYSTYLE_NAMES, options.piratePlayStyleIndex ?? 0, L.combo[0], L.combo[1], L.combo[2], L.combo[3], (i) => {
        options.piratePlayStyleIndex = i;
        paint();
    }, 'wizard-pirate-playstyle-select');
    els.push(c.select);
    ctx.helpOn(c.select, () => [helpTitle2('Your Empire', 'Pirate Playstyle'), wt('Determines the play focus and pirate victory conditions for your pirate empire', 'Determines the play focus and pirate victory conditions for your pirate empire')]);
    const descBox = scrollPanel('wizard-pirate-playstyle-desc');
    parent.appendChild(place(descBox, L.desc[0], L.desc[1], L.desc[2], L.desc[3]));
    const descText = el('div', 'wizard-pirate-playstyle-text');
    descBox.appendChild(descText);
    els.push(descBox);
    const [picX, picY, pictureSize] = L.pic;
    const img = place(el('div', 'wizard-pirate-playstyle-img'), picX, picY, pictureSize, pictureSize);
    parent.appendChild(img);
    els.push(img);
    const DESC_TAGS = ['Balanced', 'Pirate', 'Mercenary', 'Smuggler'];
    const DESC_FALLBACK = [
        'Balanced playstyle pirates attempt to control colonies, gain income from protection arrangements with other empires, and capture enemy ships and bases.',
        'Raiders attempt to control colonies, both independent and those owned by standard empires. They grow rich by siphoning off the wealth from these controlled colonies.',
        'Mercenaries are guns for hire who seek out attack and defense missions to perform for other empires.',
        'Smugglers are focussed on gaining income by smuggling resources to colonies and building a network of protection arrangements with other empires.',
    ];
    function paint(): void {
        const i = options.piratePlayStyleIndex ?? 0;
        c.select.value = String(i);
        const style = piratePlayStyleFor(i);
        const lines = [wt(`Pirate Playstyle Description ${DESC_TAGS[i] ?? 'Balanced'}`, DESC_FALLBACK[i] ?? DESC_FALLBACK[0]), '', ...pirateModifierLines(style).map((l) => l.text)];
        descText.textContent = lines.join('\n').trim();
        // Start.2.cs 3191 / 3201: method_119(null, the selected race, size, size, bitmap_31, 6, pirate: true, style) — the
        // playstyle's pirate image on storyEvent.jpg in the panel frame; nothing for "(Random)" (no race).
        const race = cachedRaces?.find((r) => r.name === options.raceName) ?? null;
        if (cachedRaces === null) void loadWizardRaceData().then(paint, () => {});
        img.replaceChildren(racePictureCanvas(racePicturePlan({ empire: null, race, width: pictureSize, height: pictureSize, inset: 6, pirate: true, piratePlayStyle: style }), 'wizard-race-picture'));
    }
    paint();
    return {
        show(on: boolean) {
            for (const e of els) e.style.display = on ? '' : 'none';
        },
        paint,
    };
}

/** The race summary (RaceSummaryPanel.DrawSummary): each section's heading in the header font (font_7) at x 0, its
 *  items in font_3 indented 20 px, 10 px between sections, (170, 170, 170) with a black drop shadow. */
function renderRaceSummary(container: HTMLElement, sections: readonly RaceSummarySection[]): void {
    container.replaceChildren(
        ...sections.map((s) => {
            const sec = el('div', 'wizard-race-summary-section');
            if (s.heading !== '') sec.appendChild(el('div', 'wizard-race-summary-heading', s.heading));
            for (const item of s.items) sec.appendChild(el('div', 'wizard-race-summary-item', item));
            return sec;
        }),
    );
}

/** Fill `container` with the race's Galaxy.GenerateRaceSummary sections (galactopedia.ts generateRaceSummary) once
 *  the data it reads is loaded; empty for no race ("(Random)"). */
function showRaceSummary(container: HTMLElement, race: Race | null): void {
    container.dataset.race = race?.name ?? '';
    if (race === null) {
        container.replaceChildren();
        return;
    }
    void loadRaceSummaryData().then(
        (d) => {
            if (container.dataset.race !== race.name) return;
            renderRaceSummary(container, generateRaceSummary(d.text, race, d.families, d.data));
            if (container.parentElement) container.parentElement.scrollTop = 0;
        },
        () => {},
    );
}

/** The Jump Start page: galaxy shape, star amount, physical size, difficulty (+ scaling), race and government (pirate
 *  playstyle for a pirate) — everything else is the preset of Start.cs btnJumpStartTheGalaxyNext_Click
 *  (startGameOptions.ts toCreateGameOptionsJumpStart). Layout: Start.cs 2924 method_36. */
function buildJumpStartPage(ctx: WizardCtx): HTMLDivElement {
    const options = ctx.options;
    const wrap = pageDiv('wizard-jumpstart-page');

    // pnlJumpStartGalaxyShapeSize 880 × 275 at (10, 10): radios (10, 10 + 20 i), preview 120 × 120 at (125, 10), title
    // (255, 7), description (255, 32) max 615 × 168; Star Amount (10, 145) and Physical Size (10, 210), 860 × 55.
    const shapePanel = panel(wrap, 10, 10, 880, 275, 'wizard-shape-row');
    const shapes = buildShapeChooser(ctx, shapePanel, 'wizard-jumpstart-shape', { preview: [125, 10, 120], title: [255, 7], desc: [255, 32, 615, 92] });
    const size = buildGalaxySizeControls(ctx, shapePanel, { x: 10, starY: 145, sizeY: 210, w: 860 });

    // pnlJumpStartYourEmpireRace 480 × 240 at (10, 295): cmbJumpStartYourEmpireRace 160 × 26 at (15, 15) with "(Random)",
    // picJumpStartYourEmpireRace 160 × 160 at (15, 52), lnkJumpStartYourEmpireRace (15, 218), the race summary in a
    // 280 × 179 scrolling container at (190, 51).
    const racePanel = panel(wrap, 10, 295, 480, 240, 'wizard-jumpstart-empire');
    let races: Race[] = [];
    let governments: Government[] = [];
    const raceCombo = raceDropDown({
        races: [],
        value: options.raceName,
        randomText: `(${wt('Random', 'Random')})`,
        height: 26,
        size: FONT.large,
        listParent: ctx.listParent,
        onChange: (name) => {
            options.raceName = name;
            paintRace();
        },
    });
    raceCombo.el.classList.add('wizard-jumpstart-race-select');
    racePanel.appendChild(place(raceCombo.el, 15, 15, 160, 26));
    ctx.helpOn(raceCombo.el, () => [helpTitle2('Your Race', 'Race'), wt("The dominant race at your empire's home colony", "The dominant race at your empire's home colony")]);
    const raceImg = place(el('div', 'wizard-jumpstart-race-img'), 15, 52, 160, 160);
    racePanel.appendChild(raceImg);
    helpLink(racePanel, `${wt('Read more about this race', 'Read more about this race')}...`, 15, 218, () => options.raceName || wt('Alien Races', 'Alien Races'));
    const raceSummaryBox = scrollPanel('wizard-race-summary-scroll');
    racePanel.appendChild(place(raceSummaryBox, 190, 51, 280, 179));
    const raceSummary = el('div', 'wizard-race-summary');
    raceSummary.style.width = '260px';
    raceSummaryBox.appendChild(raceSummary);

    // pnlJumpStartYourEmpireGovernment 390 × 240 at (500, 295): "Your Government: <name>" (10, 10) font_7,
    // cmbJumpStartYourEmpireGovernment 155 × 21 at (15, 35) with "(Random)", the attributes (180, 37) max 200 × 170, the
    // link (180, 200).
    const govPanel = panel(wrap, 500, 295, 390, 240, 'wizard-jumpstart-gov');
    const govTitle = label(govPanel, '', 10, 10, { size: FONT.header, bold: true });
    const govSel = combo(govPanel, ['(Random)'], 0, 15, 35, 155, 21, (i) => {
        options.governmentId = i <= 0 ? -1 : governments[i - 1]?.governmentId ?? -1;
        paintGov();
    });
    ctx.helpOn(govSel.select, () => [helpTitle2('Your Empire', 'Government'), wt('The form of government that your empire follows', 'The form of government that your empire follows')]);
    const govAttrs = label(govPanel, '', 180, 37, { size: FONT.large, wrapWidth: 200, className: 'wizard-gov-attributes' });
    govAttrs.style.maxHeight = '170px';
    helpLink(govPanel, `${wt('Read more about this Government type', 'Read more about this Government type')}...`, 180, 200, () => governments.find((g) => g.governmentId === options.governmentId)?.name ?? wt('Government Types', 'Government Types'), 200);

    // The pirate playstyle (method_35: shown instead of the government panel): label (500, 298), combo 160 × 21 at
    // (730, 295), description 220 × 205 at (500, 331), picture 160 × 160 at (730, 331).
    const pirate = buildPiratePlaystyle(ctx, wrap, { label: [500, 298], combo: [730, 295, 160, 21], desc: [500, 331, 220, 205], pic: [730, 331, 160] });

    // tbarJumpStartTheGalaxyDifficulty 630 × 55 at (10, 545), LabelWidth 80; chkJumpStartTheGalaxyDifficultyScaling (650, 560).
    const difficulty = trackBar(wrap, { x: 10, y: 545, w: 630, h: 55, label: wt('Difficulty', 'Difficulty'), labelWidth: 80, labels: DIFFICULTY_TICKS, value: options.difficultyIndex, onChange: (i) => (options.difficultyIndex = i) });
    ctx.helpOn(difficulty.el, () => [helpTitle2('The Galaxy', 'Difficulty'), wt('Determines difficulty and aggression of gameplay', 'Determines difficulty and aggression of gameplay')]);
    const scaling = check(wrap, wt('Difficulty scales as player nears victory', 'Difficulty scales as player nears victory'), options.difficultyScaling, 650, 560, (v) => (options.difficultyScaling = v), FONT.normal);
    scaling.row.classList.add('wizard-check-wrap');
    scaling.row.style.width = '240px';

    function paintRace(): void {
        // Start.cs 5152: picJumpStartYourEmpireRace (160 × 160) = method_118(null, race, 160, 160, bitmap_31, 6, false) —
        // the race on its native landscape in the panel frame; empty for "(Random)".
        const race = races.find((r) => r.name === options.raceName) ?? null;
        raceImg.replaceChildren(racePictureCanvas(racePicturePlan({ empire: null, race, width: 160, height: 160, inset: 6, pirate: false }), 'wizard-race-picture'));
        showRaceSummary(raceSummary, race);
        pirate.paint();
    }
    function paintGov(): void {
        const gov = governments.find((g) => g.governmentId === options.governmentId) ?? null;
        setText(govTitle, `${wt('Your Government', 'Your Government')}: ${gov?.name ?? `(${wt('Random', 'Random')})`}`);
        setText(govAttrs, governmentAttributesText(gov));
    }
    void Promise.all([loadWizardRaceData(), loadWizardGovernments()]).then(([data, govs]) => {
        races = playableRacesSorted(data.races);
        governments = filterStartGovernments(govs);
        // The same default as the Your Race page (whichever loads first sets it).
        if (options.raceName === '') options.raceName = defaultRaceName(data.races);
        raceCombo.setRaces(races.map((r) => ({ name: r.name, pictureUrl: racePortraitUrls(r.pictureIndex)[0] })));
        sync();
    }).catch(() => {});

    function sync(): void {
        shapes.sync();
        size.sync();
        raceCombo.setValue(races.some((r) => r.name === options.raceName) ? options.raceName : '');
        paintRace();
        govSel.setItems([`(${wt('Random', 'Random')})`, ...governments.map((g) => g.name)], governments.findIndex((g) => g.governmentId === options.governmentId) + 1);
        paintGov();
        // Start.cs 2904 method_35: a pirate start shows the playstyle instead of the government.
        const isPirate = empireTypeIsPirate(options.empireType);
        govPanel.style.display = isPirate ? 'none' : '';
        pirate.show(isPirate);
        pirate.paint();
        scaling.input.checked = options.difficultyScaling;
        difficulty.slider.setValue(options.difficultyIndex);
    }
    (wrap as unknown as { __onShow?: () => void }).__onShow = () => {
        sync();
        // The chosen playstyle and its description in the help line (the recreation's note of what the preset is).
        const spec = PLAYSTYLE_ERAS.find((p) => p.type === options.empireType);
        if (spec !== undefined) ctx.help(`${wt(spec.titleTag, spec.title)}:`, wt(spec.descTag, spec.desc));
    };
    sync();
    return wrap;
}

// ---------------------------------------------------------------------------
// The Galaxy page (task 06b; Start.cs 3062 method_37).
// ---------------------------------------------------------------------------

/**
 * Custom galaxy size (not a port): the "Star Amount" and "Physical Size" controls as number boxes — a star-count box and
 * "Sectors: W × H" — each with a preset list holding the original slider values (Start.cs method_60 / method_69), so a
 * preset still starts the original game. A density warning shows when a custom size leaves the presets' range. Drawn as
 * the LabelledTrackBars they replace (the trackbar panel and its bold "Star\nAmount" / "Physical\nSize" caption).
 * `warning`: where the density warning goes (default: inside the Physical Size panel, right of its boxes).
 */
function buildGalaxySizeControls(
    ctx: WizardCtx,
    parent: HTMLElement,
    L: { x: number; starY: number; sizeY: number; w: number; warning?: { parent: HTMLElement; x: number; y: number; w: number } },
): { sync: () => void } {
    const options = ctx.options;
    const H = 55;
    const PRESET_W = 170;
    const presetX = L.w - 4 - PRESET_W;
    const block = (y: number, caption: string): HTMLDivElement => {
        const p = gradientPanel({
            colors: ['rgb(39, 40, 44)', 'rgb(36, 35, 40)', 'rgb(51, 54, 61)'],
            corners: { tl: true, tr: true, br: true, bl: true },
            radius: 10,
            borderWidth: 1,
            className: 'owc-trackbar wizard-slider wizard-size-control',
        });
        p.style.fontSize = `${FONT.normal}px`;
        p.appendChild(place(el('div', 'owc-trackbar-caption', caption), -1, -1, 100, H));
        parent.appendChild(place(p, L.x, y, L.w, H));
        return p;
    };
    const presetSelect = (cls: string, labels: readonly string[]): HTMLSelectElement => {
        const sel = dropDown(['Custom', ...labels].map((t, i) => ({ value: String(i - 1), label: t })), '-1', () => {});
        sel.classList.add('wizard-size-preset', cls);
        sel.style.fontSize = `${FONT.normal}px`;
        (sel.options[0] as HTMLOptionElement).disabled = true;
        return sel;
    };

    // Star Amount: [count] stars [preset].
    const starBlock = block(L.starY, wt('Star\\nAmount', 'Star\nAmount'));
    const starBox = spinBox('wizard-size-box wizard-star-count', galaxyStarCount(options), { min: GALAXY_STAR_COUNT_MIN });
    starBlock.appendChild(place(starBox.el, 128, 15, 90, 23));
    label(starBlock, wt('stars', 'stars'), 224, 18, { className: 'wizard-size-unit' });
    const starPreset = presetSelect('wizard-star-preset', STAR_AMOUNT_TICKS);
    starBlock.appendChild(place(starPreset, presetX, 15, PRESET_W, 23));
    ctx.helpOn(starBlock, () => [helpTitle2('The Galaxy', 'Star Amount'), 'The number of star systems in the galaxy. The presets are the original sizes; any count up to the density limit of the physical size works.']);

    // Physical Size: Sectors: [W] × [H] [preset].
    const sizeBlock = block(L.sizeY, wt('Physical\\nSize', 'Physical\nSize'));
    label(sizeBlock, 'Sectors:', 128, 18, { className: 'wizard-size-unit' });
    const wBox = spinBox('wizard-size-box wizard-sectors-w', 10, { min: CUSTOM_MIN_SECTORS, max: CUSTOM_MAX_SECTORS });
    sizeBlock.appendChild(place(wBox.el, 188, 15, 64, 23));
    label(sizeBlock, '×', 258, 18, { className: 'wizard-size-unit' });
    const hBox = spinBox('wizard-size-box wizard-sectors-h', 10, { min: CUSTOM_MIN_SECTORS, max: CUSTOM_MAX_SECTORS });
    sizeBlock.appendChild(place(hBox.el, 274, 15, 64, 23));
    const sizePreset = presetSelect('wizard-sectors-preset', PHYSICAL_SIZE_TICKS.map((t) => t.replace(/ sectors$/, '')));
    sizeBlock.appendChild(place(sizePreset, presetX, 15, PRESET_W, 23));
    ctx.helpOn(sizeBlock, () => [helpTitle2('The Galaxy', 'Physical Size'), 'The width and height of the galaxy in sectors. The presets are the original sizes; any size from 2 × 2 to 100 × 100 sectors works.']);
    const W = L.warning;
    const warning = W
        ? label(W.parent, '', W.x, W.y, { size: FONT.tiny, wrapWidth: W.w, className: 'wizard-density-warning' })
        : label(sizeBlock, '', 348, 3, { size: FONT.tiny, wrapWidth: presetX - 348 - 8, className: 'wizard-density-warning wizard-density-warning-inline' });

    /** Re-reads the options; `boxes` false leaves the number boxes as typed (while the user is still typing). */
    function sync(boxes = true): void {
        const { width, height } = galaxySectorCounts(options);
        const stars = galaxyStarCount(options);
        if (boxes) {
            starBox.input.value = String(stars);
            wBox.input.value = String(width);
            hBox.input.value = String(height);
        }
        starPreset.value = String(options.customStarCount === undefined ? STAR_COUNT_PRESETS.indexOf(stars) : -1);
        sizePreset.value = String(width === height && options.customSectorWidth === undefined ? SECTOR_PRESETS.indexOf(width) : -1);
        const warn = galaxyDensityWarning(options);
        warning.textContent = warn?.text ?? '';
        warning.dataset.kind = warn?.kind ?? '';
        warning.hidden = warn === null;
        sizeBlock.classList.toggle('wizard-size-custom', galaxySizeIsCustom(options));
    }
    const readInt = (box: HTMLInputElement): number | null => {
        const v = parseInt(box.value, 10);
        return Number.isNaN(v) ? null : v;
    };
    const applyStars = (commit: boolean): void => {
        const v = readInt(starBox.input);
        if (v !== null) setGalaxyStarCount(options, v);
        sync(commit);
    };
    const applySectors = (commit: boolean): void => {
        const w = readInt(wBox.input);
        const h = readInt(hBox.input);
        if (w !== null && h !== null) {
            setGalaxySectors(options, w, h);
            // The star box shows the count the new size allows.
            starBox.input.value = String(galaxyStarCount(options));
        }
        sync(commit);
    };
    starBox.input.addEventListener('input', () => applyStars(false));
    starBox.input.addEventListener('change', () => applyStars(true));
    wBox.input.addEventListener('input', () => applySectors(false));
    hBox.input.addEventListener('input', () => applySectors(false));
    wBox.input.addEventListener('change', () => applySectors(true));
    hBox.input.addEventListener('change', () => applySectors(true));
    starPreset.addEventListener('change', () => {
        const i = parseInt(starPreset.value, 10);
        if (i >= 0) setGalaxyStarCount(options, STAR_COUNT_PRESETS[i]);
        sync();
    });
    sizePreset.addEventListener('change', () => {
        const i = parseInt(sizePreset.value, 10);
        if (i >= 0) setGalaxySectors(options, SECTOR_PRESETS[i], SECTOR_PRESETS[i]);
        sync();
    });
    sync();
    return { sync };
}

function buildGalaxyPage(ctx: WizardCtx): HTMLDivElement {
    const options = ctx.options;
    const wrap = pageDiv('wizard-galaxy-page');

    // pnlStartNewGameGalaxyShapeSize 650 × 345 at (10, 10): radios (10, 10 + 20 i), preview 190 × 190 at (120, 10), title
    // (335, 10), description (335, 35) max 305 × 235; Star Amount (10, 215) and Physical Size (10, 280), 630 × 55.
    const shapePanel = panel(wrap, 10, 10, 650, 345, 'wizard-shape-row');
    const shapes = buildShapeChooser(ctx, shapePanel, 'wizard-shape', { preview: [120, 10, 190], title: [335, 10], desc: [335, 35, 305, 166] });

    // The right column (670, 10) 220 × 345 is pnlStartNewGameTheGalaxyLoadExisting in the original ("OR Load existing
    // Galaxy as map"). TODO(port): loading a saved galaxy as the map — Start.1.cs btnStartNewGameTheGalaxyLoadExistingBrowse_Click
    // (needs a .dwg reader). The recreation's seed box and the custom size's density warning sit in that panel instead.
    const seedPanel = panel(wrap, 670, 10, 220, 345, 'wizard-galaxy-seed-panel');
    label(seedPanel, 'Galaxy Seed', 10, 10, { size: FONT.header, bold: true });
    label(seedPanel, 'The same seed and settings make the same galaxy.', 10, 36, { size: FONT.tiny, wrapWidth: 196 });
    const seed = spinBox('wizard-seed-input', options.seed);
    seedPanel.appendChild(place(seed.el, 10, 74, 120, 23));
    seed.input.addEventListener('input', () => {
        const v = parseInt(seed.input.value, 10);
        if (!Number.isNaN(v)) {
            options.seed = v;
        }
    });
    glass(seedPanel, 'Random', 136, 72, 72, 27, () => {
        options.seed = randomSeed();
        seed.input.value = String(options.seed);
    }, { title: 'Re-roll seed', className: 'wizard-seed-reroll' });

    const sizeControls = buildGalaxySizeControls(ctx, shapePanel, { x: 10, starY: 215, sizeY: 280, w: 630, warning: { parent: seedPanel, x: 10, y: 118, w: 196 } });

    // tbarStartNewGameTheGalaxyExpansion / Aggression / Difficulty: 380 × 55 at (10, 370 / 430 / 490), LabelWidth 80.
    // Task M4x: Expansion → Galaxy.Age (Setup(2): SliderOffset 2).
    trackBar(wrap, { x: 10, y: 370, w: 380, h: 55, label: wt('Expansion', 'Expansion'), labelWidth: 80, sliderOffset: 2, labels: EXPANSION_TICKS, value: options.galaxyExpansionIndex ?? 1, onChange: (i) => (options.galaxyExpansionIndex = i) });
    trackBar(wrap, { x: 10, y: 430, w: 380, h: 55, label: wt('Aggression', 'Aggression'), labelWidth: 80, labels: AGGRESSION_TICKS, value: options.aggressionIndex, onChange: (i) => (options.aggressionIndex = i) });
    const difficulty = trackBar(wrap, { x: 10, y: 490, w: 380, h: 55, label: wt('Difficulty', 'Difficulty'), labelWidth: 80, labels: DIFFICULTY_TICKS, value: options.difficultyIndex, onChange: (i) => (options.difficultyIndex = i) });
    ctx.helpOn(difficulty.el, () => [helpTitle2('The Galaxy', 'Difficulty'), wt('Determines difficulty and aggression of gameplay', 'Determines difficulty and aggression of gameplay')]);

    // [todosweep2] begin
    // "Research Costs" (tbarStartNewGameTheGalaxyResearchSpeed 433 × 55 at (400, 370), LabelWidth 70, LinkWidth 65) + the
    // research-cost box (numStartNewGameTheGalaxyResearchBaseTech at (838, 384), 1..999 thousands, "K" at (878, 384)). The
    // slider only writes the box (Start.1.cs 4408 meEawywtba / 1000); the box value is what the game uses (Start.1.cs 3693
    // × 1000 → Galaxy.BaseTechCost).
    const researchBox = spinBox('wizard-research-base-tech', options.galaxyResearchSpeed ?? 120, { min: GALAXY_RESEARCH_SPEED_MIN, max: GALAXY_RESEARCH_SPEED_MAX });
    trackBar(wrap, {
        x: 400,
        y: 370,
        w: 433,
        h: 55,
        label: wt('Research \\nCosts', 'Research \nCosts'),
        labelWidth: 70,
        linkWidth: 65,
        linkText: wt('About Research...', 'About Research...'),
        onLink: () => openGalactopedia({ topic: wt('Research', 'Research') }),
        labels: RESEARCH_COST_TICKS,
        value: researchSpeedSliderIndexFor((options.galaxyResearchSpeed ?? 120) * 1000),
        onChange: (i) => {
            options.galaxyResearchSpeed = researchBaseTechCostForSliderIndex(i) / 1000;
            researchBox.input.value = String(options.galaxyResearchSpeed);
        },
    });
    researchBox.input.title = 'Base research cost (thousands)';
    researchBox.input.addEventListener('input', () => {
        const v = parseInt(researchBox.input.value, 10);
        if (!Number.isNaN(v)) options.galaxyResearchSpeed = Math.min(GALAXY_RESEARCH_SPEED_MAX, Math.max(GALAXY_RESEARCH_SPEED_MIN, v));
    });
    wrap.appendChild(place(researchBox.el, 836, 384, 44, 23));
    label(wrap, 'K', 882, 387, { bold: true });
    // [todosweep2] end

    // tbarStartNewGameTheGalaxySpaceCreatures 490 × 55 at (400, 430), LabelWidth 70, LinkWidth 65.
    const creatures = trackBar(wrap, {
        x: 400,
        y: 430,
        w: 490,
        h: 55,
        label: wt('Space Creatures', 'Space Creatures'),
        labelWidth: 70,
        linkWidth: 65,
        linkText: wt('About Space Creatures...', 'About Space Creatures...'),
        onLink: () => openGalactopedia({ topic: wt('Space Creatures', 'Space Creatures') }),
        labels: SPACE_CREATURES_TICKS,
        value: options.spaceCreaturesIndex,
        onChange: (i) => (options.spaceCreaturesIndex = i),
    });
    ctx.helpOn(creatures.el, () => [helpTitle2('Galaxy', 'Creatures'), wt('Space creatures are distributed throughout the galaxy at the start of the game', 'Space creatures are distributed throughout the galaxy at the start of the game')]);
    // tbarStartNewGameTheGalaxyPirates 403 × 55 at (400, 490), LabelWidth 60, LinkWidth 65.
    const pirates = trackBar(wrap, {
        x: 400,
        y: 490,
        w: 403,
        h: 55,
        label: wt('Pirates', 'Pirates'),
        labelWidth: 60,
        linkWidth: 65,
        linkText: wt('About Pirates...', 'About Pirates...'),
        onLink: () => openGalactopedia({ topic: wt('Pirates', 'Pirates') }),
        labels: PIRATES_TICKS,
        value: options.piratesIndex,
        onChange: (i) => (options.piratesIndex = i),
    });
    ctx.helpOn(pirates.el, () => [helpTitle2('Galaxy', 'Pirates'), wt('Pirates are distributed throughout the galaxy at the start of the game', 'Pirates are distributed throughout the galaxy at the start of the game')]);
    // [wizardB1] tbarStartNewGameTheGalaxyPirateStrength 380 × 55 at (400, 550), LabelWidth 80 (Start.1.cs 3722-3736 →
    // PirateShipMaintenanceFactor).
    trackBar(wrap, { x: 400, y: 550, w: 380, h: 55, label: wt('Pirate Strength', 'Pirate Strength'), labelWidth: 80, labels: PIRATE_STRENGTH_TICKS, value: options.pirateStrengthIndex ?? 2, onChange: (i) => (options.pirateStrengthIndex = i) });

    // [wizardB1] lblStartNewGameTheGalaxyPirateProximityLabel (805, 493) + cmbStartNewGameTheGalaxyPirateProximity 80 × 21 at
    // (807, 508) (Start.1.cs 4774, method_190 → Galaxy.PirateProximity).
    label(wrap, wt('Pirate Proximity', 'Pirate Proximity'), 805, 493, { size: FONT.tiny });
    combo(wrap, PIRATE_PROXIMITY_NAMES.map((n) => wt(n, n)), options.pirateProximityIndex ?? 1, 807, 510, 83, 21, (i) => (options.pirateProximityIndex = i), 'wizard-pirate-proximity');
    // chkStartNewGameTheGalaxyPiratesRespawn 105 × 60 at (785, 550), CheckAlign / TextAlign MiddleRight (Start.cs 3193,
    // Start.1.cs 3741 → Galaxy.DestroyedPiratesDoNotRespawn).
    const respawn = checkBoxRight(wt('Destroyed Pirates do not respawn', 'Destroyed Pirates do not respawn'), options.destroyedPiratesDoNotRespawn ?? false, (v) => {
        options.destroyedPiratesDoNotRespawn = v;
    }, FONT.normal);
    respawn.classList.add('wizard-checkbox', 'wizard-respawn');
    respawn.title = wt('Destroyed Pirates do not respawn Description', 'If checked then pirate factions that are completely wiped out do not respawn replacement pirate factions.');
    wrap.appendChild(place(respawn, 785, 550, 105, 60));

    // chkStartNewGameTheGalaxyDifficultyScaling (10, 550).
    check(wrap, wt('Difficulty scales as player nears victory', 'Difficulty scales as player nears victory'), options.difficultyScaling, 10, 552, (v) => (options.difficultyScaling = v), FONT.normal);

    // [wizardB1] the Jump Start page shares the shape: re-sync the radios when shown.
    (wrap as unknown as { __onShow?: () => void }).__onShow = () => {
        shapes.sync();
        sizeControls.sync();
        ctx.help(helpTitle2('The Galaxy', 'Shape'), wt('Determines the layout and distribution of stars within the galaxy', 'Determines the layout and distribution of stars within the galaxy'));
    };

    return wrap;
}

// ---------------------------------------------------------------------------
// Colonization and Territory page (task 06h; Start.cs 2835 method_34).
// ---------------------------------------------------------------------------

function buildColonizationPage(ctx: WizardCtx): HTMLDivElement {
    const options = ctx.options;
    const wrap = pageDiv('wizard-colonization-page');
    const c = options.colonization;

    // tbarStartNewGameTheGalaxyColonyPrevalence / AlienLife: 880 × 55 at (10, 10) / (10, 80), LabelWidth 90; Alien Life's
    // LinkWidth 90 "About Alien Life..." (Galactopedia "Independent planets and Traders").
    trackBar(wrap, { x: 10, y: 10, w: 880, h: 55, label: wt('Colony Prevalence', 'Colony Prevalence'), labelWidth: 90, labels: COLONY_PREVALENCE_TICKS.map((t) => wt(t, t)), value: options.colonyPrevalenceIndex, onChange: (i) => (options.colonyPrevalenceIndex = i) });
    trackBar(wrap, {
        x: 10,
        y: 80,
        w: 880,
        h: 55,
        label: wt('Independent Alien Life', 'Independent Alien Life'),
        labelWidth: 90,
        linkWidth: 90,
        linkText: wt('About Alien Life...', 'About Alien Life...'),
        onLink: () => openGalactopedia({ topic: wt('Independent planets and Traders', 'Independent planets and Traders') }),
        labels: ALIEN_LIFE_TICKS.map((t) => wt(t, t)),
        value: options.alienLifeIndex,
        onChange: (i) => (options.alienLifeIndex = i),
    });

    // Colony Influence Range: title (10, 160) font_3, ColorSlider 680 × 16 at (150, 160), value (840, 160), the suggestion
    // (425, 180) 450 × 30 right-aligned (Start.1.cs 3181 method_188).
    label(wrap, wt('Colony Influence Range', 'Colony Influence Range'), 10, 158, { size: FONT.large });
    const influenceValue = label(wrap, `${c.colonyInfluenceRangePercent}%`, 840, 158, { size: FONT.large, className: 'wizard-colonization-value' });
    const influence = colorSlider({
        value: c.colonyInfluenceRangePercent,
        min: COLONY_INFLUENCE_RANGE_PCT_MIN,
        max: COLONY_INFLUENCE_RANGE_PCT_MAX,
        width: 680,
        height: 16,
        thumbSize: 20,
        onChange: (v) => {
            c.colonyInfluenceRangePercent = Math.min(COLONY_INFLUENCE_RANGE_PCT_MAX, Math.max(COLONY_INFLUENCE_RANGE_PCT_MIN, v));
            setText(influenceValue, `${c.colonyInfluenceRangePercent}%`);
        },
    });
    influence.el.classList.add('wizard-colony-influence');
    wrap.appendChild(place(influence.el, 150, 160));
    const suggestion = label(wrap, '', 425, 182, { size: FONT.large, wrapWidth: 450, className: 'wizard-colonization-suggestion' });

    // grpStartNewGameColonizationTerritoryColonizationRange 880 × 60 at (10, 215), its caption "          Enforce
    // Colonization Range Limits" with chkStartNewGameColonizationTerritoryEnforceColonizationRange over the spaces at
    // (21, 217); inside: "Colonization Range" (10, 25), ColorSlider 645 × 16 at (140, 25), value (795, 25).
    const group = groupBox(`          ${wt('Enforce Colonization Range Limits', 'Enforce Colonization Range Limits')}`, 880, 60, FONT.large);
    group.classList.add('wizard-colonization-group');
    wrap.appendChild(place(group, 10, 215));
    label(group, wt('Colonization Range', 'Colonization Range'), 10, 23, { size: FONT.large });
    const rangeValue = label(group, `${c.colonizationRangeKly}K`, 795, 23, { size: FONT.large, className: 'wizard-colonization-value' });
    const range = colorSlider({
        value: c.colonizationRangeKly,
        min: COLONIZATION_RANGE_KLY_MIN,
        max: COLONIZATION_RANGE_KLY_MAX,
        width: 645,
        height: 16,
        thumbSize: 20,
        onChange: (v) => {
            c.colonizationRangeKly = Math.min(COLONIZATION_RANGE_KLY_MAX, Math.max(COLONIZATION_RANGE_KLY_MIN, v));
            setText(rangeValue, `${c.colonizationRangeKly}K`);
        },
    });
    range.el.classList.add('wizard-colonization-range');
    group.appendChild(place(range.el, 140, 25));
    const enforce = check(wrap, '', c.enforceRangeLimits, 21, 215, (v) => (c.enforceRangeLimits = v));
    enforce.row.classList.add('wizard-colonization-enforce');
    enforce.row.title = wt('Enforce Colonization Range Limits', 'Enforce Colonization Range Limits');

    // chkOptionsAllowSameSystemAsOtherEmpires (the original's Game Options item, kept here as before).
    check(wrap, wt('Allow colonization and mining stations in other empires systems', 'Allow colonization and mining stations in other empires systems'), c.allowSameSystemAsOtherEmpires, 10, 285, (v) => (c.allowSameSystemAsOtherEmpires = v));

    // picStartNewGameColonizationTerritoryImage 880 × 253 at (10, 315).
    resxPicture(wrap, 'picStartNewGameColonizationTerritoryImage.Image', 10, 315, 880, 253, 'normal');

    // Start.1.cs 3169 method_187 (entering the page): the suggestion for the chosen star count and size.
    (wrap as unknown as { __onShow?: () => void }).__onShow = () => {
        const stars = galaxyStarCount(options);
        const { width, height } = galaxySectorCounts(options);
        const pct = Math.floor(colonyInfluenceRangeSuggestion(stars, width, height) * 100 + 0.5);
        setText(suggestion, formatNet(wt('Colony Influence Range Suggestion', 'Suggested range for a {0}-star galaxy of size {1} x {2} sectors: {3}'), [stars, width, height, `${pct}%`]));
    };
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
// Other Empires page (task 06h / 06j; Start.cs 3615 method_43).
// ---------------------------------------------------------------------------

function buildOtherEmpiresPage(ctx: WizardCtx): HTMLDivElement {
    const options = ctx.options;
    const wrap = pageDiv('wizard-empires-page');
    const o = options.otherEmpires;

    // pnlStartNewGameOtherEmpiresAutoGen 350 × 75 at (10, 10): chkOtherEmpiresAutogenerate (10, 10), "Generate" right-aligned
    // to end 5 px before numAutogenerateEmpiresAmount at (142, 41), "starting empires" 5 px after it.
    const autoGroup = panel(wrap, 10, 10, 350, 75, 'wizard-panel-group');
    check(autoGroup, wt('Auto-Generate Starting Empires', 'Auto-Generate Starting Empires'), o.autogenerate, 10, 10, (v) => {
        o.autogenerate = v;
        paintPreview();
    });
    label(autoGroup, wt('Generate', 'Generate'), 137, 43, { size: FONT.large, className: 'ow-right' });
    const count = spinBox('wizard-empires-count-input', o.empireCount, { min: OTHER_EMPIRES_COUNT_MIN, max: OTHER_EMPIRES_COUNT_MAX });
    autoGroup.appendChild(place(count.el, 142, 40, 50, 23));
    count.input.addEventListener('input', () => {
        const v = parseInt(count.input.value, 10);
        if (!Number.isNaN(v)) {
            o.empireCount = Math.min(OTHER_EMPIRES_COUNT_MAX, Math.max(OTHER_EMPIRES_COUNT_MIN, v));
        }
        paintPreview();
    });
    label(autoGroup, wt('starting empires', 'starting empires'), 197, 43, { size: FONT.large });

    // Recreation notes right of the panel: what will be generated, and (task 19k-1a) the note once the total empire count
    // (this many + the player) goes above the measured 60-empire / 1400-star range.
    const listPreview = label(wrap, '', 375, 16, { size: FONT.large, wrapWidth: 515, className: 'wizard-empires-list-preview' });
    const perfNote = label(wrap, '', 375, 40, { size: FONT.tiny, wrapWidth: 515, color: COLORS.link, className: 'wizard-todo wizard-empires-perf-note' });

    // lblStartNewGameOtherEmpiresOR (20, 95) font_7.
    label(wrap, wt('OR specify the starting empires below', 'OR specify the starting empires below'), 20, 95, { size: FONT.header, bold: true, className: 'wizard-empires-or' });

    // pnlStartNewGameOtherEmpiresList 882 × 307 at (10, 125): btnAddNewEmpire 200 × 25 at (670, 10); ctlStartingEmpiresList
    // (StartingEmpiresListView, rows 25 px) 860 × 260 at (10, 35). The recreation's rows have the Name, Race and
    // Government cells (TODO(port): Size / Tech Level / Home System / Proximity cells — StartingEmpiresListView.cs columns,
    // read by Start.1.cs method_114; ManualEmpireStart has no fields for them yet) and the Remove image (remove.png).
    const listPanel = panel(wrap, 10, 125, 882, 307, 'wizard-empires-list-panel');
    const addBtn = glass(listPanel, wt('Add New Empire', 'Add New Empire'), 670, 10, 200, 25, () => {
        if (o.manual.length >= OTHER_EMPIRES_COUNT_MAX) return;
        const races = playableRaces();
        const race = races[0]?.name ?? '';
        o.manual.push({ race, governmentId: -1, name: race === '' ? '' : defaultEmpireName(race) });
        paintList();
    }, { className: 'wizard-btn wizard-btn-secondary wizard-empires-add-btn' });
    const grid = place(el('div', 'ow-grid wizard-empires-grid'), 10, 35, 860, 260);
    grid.style.fontSize = `${FONT.normal}px`;
    const COLS = [300, 240, 276, 30];
    grid.style.setProperty('--ow-cols', COLS.map((w) => `${w}px`).join(' '));
    const head = el('div', 'ow-grid-head');
    for (const h of [wt('Name', 'Name'), wt('Race', 'Race'), wt('Government', 'Government'), '']) head.appendChild(el('div', 'ow-grid-hcell ow-align-left', h));
    grid.appendChild(head);
    const listWrap = el('div', 'ow-grid-body ow-scroll wizard-empires-manual-wrap');
    grid.appendChild(listWrap);
    listPanel.appendChild(grid);

    // chkGalaxyNewEmpiresDuringGame (10, 440) font_3 ([wizardB1] Start.cs 3655; Start.1.cs 3689 → Galaxy.SpawnNewEmpires,
    // Habitat.cs 1502).
    const spawn = check(
        wrap,
        wt('Allow independent alien colonies to start new empires during the game', 'Allow independent alien colonies to start new empires during the game'),
        options.spawnNewEmpires ?? true,
        10,
        440,
        (v) => {
            options.spawnNewEmpires = v;
        },
    );
    spawn.row.classList.add('wizard-empires-spawn');

    // Not in the original: the Smarter AI add-on (scenarios/smarter-ai; folded into options.scenario by
    // addonChoiceFor). A GradientPanel under the spawn checkbox: the main CheckBox, its two sub-CheckBoxes and the
    // growth-tax threshold box; the sub-controls are disabled while the main one is off.
    const smart: SmarterAIChoice = options.smarterAI ?? defaultSmarterAIChoice();
    options.smarterAI = smart;
    const smartPanel = panel(wrap, 10, 468, 880, 62, 'wizard-panel-group wizard-smarter-ai');
    const smartMain = check(smartPanel, 'Smarter AI (AI empires only)', smart.enabled, 10, 6, (v) => {
        smart.enabled = v;
        paintSmart();
    });
    smartMain.row.classList.add('wizard-smarter-ai-main');
    const smartResearch = check(smartPanel, 'Optimised research order', smart.research, 30, 33, (v) => {
        smart.research = v;
        ctx.refreshScenario();
    }, FONT.normal);
    smartResearch.row.classList.add('wizard-smarter-ai-research');
    const smartTax = check(smartPanel, 'Growth taxes', smart.growthTaxes, 290, 33, (v) => {
        smart.growthTaxes = v;
        paintSmart();
    }, FONT.normal);
    smartTax.row.classList.add('wizard-smarter-ai-taxes');
    // Statecraft sub-switches (plain rows; the coordinator folds them into the sub-option list later).
    const statecraftKeys = [
        ['researchStations', 'Smarter research stations', 'wizard-smarter-ai-stations'],
        ['wonders', 'Pursue wonders', 'wizard-smarter-ai-wonders'],
        ['espionage', 'Use spies well', 'wizard-smarter-ai-espionage'],
        ['diplomacy', 'Diplomacy with purpose', 'wizard-smarter-ai-diplomacy'],
    ] as const;
    const statecraftChecks = statecraftKeys.map(([key, text, cls], i) => {
        const c = check(smartPanel, text, smart[key] ?? true, 30 + i * 215, 56, (v) => {
            smart[key] = v;
            ctx.refreshScenario();
        }, FONT.normal);
        c.row.classList.add(cls);
        return c;
    });
    const taxLabel = label(smartPanel, 'untaxed below', 420, 35, { size: FONT.normal });
    const taxBox = numberBox(smartPanel, 'wizard-smarter-ai-threshold', 515, 33, 46, 0, 100, () => smart.growthTaxThreshold, (x) => {
        smart.growthTaxThreshold = x;
        ctx.refreshScenario();
    });
    const taxUnit = label(smartPanel, '% of maximum population', 566, 35, { size: FONT.normal });
    ctx.helpOn(smartPanel, () => ['Smarter AI', 'AI empires only (never you or pirates): an optimised research order, and no taxes on growing colonies unless the treasury needs them.']);
    function paintSmart(): void {
        smartResearch.input.disabled = !smart.enabled;
        smartTax.input.disabled = !smart.enabled;
        for (const c of statecraftChecks) {
            c.input.disabled = !smart.enabled;
            c.row.classList.toggle('is-disabled', !smart.enabled);
        }
        const taxOn = smart.enabled && smart.growthTaxes;
        const taxInput = taxBox.querySelector('input');
        if (taxInput !== null) taxInput.disabled = !taxOn;
        for (const e of [smartResearch.row, smartTax.row]) e.classList.toggle('is-disabled', !smart.enabled);
        for (const e of [taxLabel, taxBox, taxUnit]) e.classList.toggle('is-disabled', !taxOn);
        ctx.refreshScenario();
    }
    paintSmart();

    // picStartNewGameOtherEmpiresImageBottom 880 × 130 at (10, 470), CenterImage (moved down under the Smarter AI panel).
    resxPicture(wrap, 'picStartNewGameOtherEmpiresImageBottom.Image', 10, 536, 880, 64, 'center');

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

    // One editable row per manual empire (task 06j): name text box, race and government combos, the Remove image.
    function makeRow(m: ManualEmpireStart, i: number): HTMLDivElement {
        const row = el('div', `ow-grid-row wizard-empires-row${i % 2 === 1 ? ' ow-alt' : ''}`);
        row.style.setProperty('--ow-row-h', '25px');

        const nameCell = el('div', 'ow-grid-cell');
        const nameInput = textBox(m.name, defaultEmpireName(m.race), (v) => {
            m.name = v;
        });
        nameInput.classList.add('wizard-empires-name-input');
        nameCell.appendChild(nameInput);
        row.appendChild(nameCell);

        const raceCell = el('div', 'ow-grid-cell');
        const raceSelect = el('select', 'ow-input ow-select wizard-empires-race-select');
        for (const r of playableRaces()) {
            const opt = el('option', '', r.name);
            opt.value = r.name;
            opt.selected = r.name === m.race;
            raceSelect.appendChild(opt);
        }
        if (!playableRaces().some((r) => r.name === m.race)) {
            const opt = el('option', '', m.race);
            opt.value = m.race;
            raceSelect.appendChild(opt);
        }
        raceSelect.addEventListener('change', () => {
            m.race = raceSelect.value;
            if (m.name === '') {
                m.name = defaultEmpireName(m.race);
                nameInput.value = m.name;
            }
        });
        raceSelect.addEventListener('keydown', (e) => e.stopPropagation());
        raceCell.appendChild(raceSelect);
        row.appendChild(raceCell);

        const govCell = el('div', 'ow-grid-cell');
        const govSelect = el('select', 'ow-input ow-select wizard-empires-gov-select');
        const noneOpt = el('option', '', `(${wt('Random', 'Random')})`);
        noneOpt.value = '-1';
        noneOpt.selected = m.governmentId < 0;
        govSelect.appendChild(noneOpt);
        for (const g of governments) {
            const opt = el('option', '', g.name);
            opt.value = String(g.governmentId);
            opt.selected = g.governmentId === m.governmentId;
            govSelect.appendChild(opt);
        }
        govSelect.addEventListener('change', () => {
            m.governmentId = parseInt(govSelect.value, 10);
        });
        govSelect.addEventListener('keydown', (e) => e.stopPropagation());
        govCell.appendChild(govSelect);
        row.appendChild(govCell);

        const removeCell = el('div', 'ow-grid-cell ow-align-center');
        const removeBtn = el('button', 'wizard-empires-remove-btn');
        removeBtn.type = 'button';
        removeBtn.title = 'Remove empire';
        const removeImg = el('img');
        removeImg.src = `${CHROME}remove.png`;
        removeImg.alt = '✕';
        removeImg.draggable = false;
        removeBtn.appendChild(removeImg);
        removeBtn.addEventListener('click', () => {
            const k = o.manual.indexOf(m);
            if (k >= 0) o.manual.splice(k, 1);
            paintList();
        });
        removeCell.appendChild(removeBtn);
        row.appendChild(removeCell);

        return row;
    }

    function paintList(): void {
        listWrap.replaceChildren(...o.manual.map(makeRow));
        addBtn.disabled = o.manual.length >= OTHER_EMPIRES_COUNT_MAX;
        paintPreview();
    }

    paintPreview();

    // Load race + government data (both are already loaded by the time the
    // user reaches this page, but re-load defensively like buildEmpirePage),
    // then render any pre-existing rows.
    const loading = el('div', 'wizard-race-loading', 'Loading races and governments…');
    listWrap.appendChild(loading);
    Promise.all([loadWizardRaceData(), loadWizardGovernments()])
        .then(([, allGovs]) => {
            loading.remove();
            governments = filterStartGovernments(allGovs);
            paintList();
        })
        .catch(() => {
            loading.remove();
            listWrap.appendChild(el('div', 'wizard-race-error', 'Failed to load race/government data for the manual empire list.'));
        });

    return wrap;
}

// ---------------------------------------------------------------------------
// Your Race page (task 06d; Start.cs 3570 method_42).
// ---------------------------------------------------------------------------

/** The data Galaxy.GenerateRaceSummary reads (GameText, race families and the static tables), loaded once per wizard. */
let summaryDataPromise: Promise<{ text: GameText; families: RaceFamily[]; data: RaceSummaryData }> | null = null;

function loadDataFile<T>(file: string, parse: (t: string) => T[]): Promise<T[]> {
    return fetchText(resolveThemedDataUrl(file))
        .then((t) => (isRaceFileText(t) ? parse(t) : []))
        .catch(() => []);
}

function loadRaceSummaryData(): Promise<{ text: GameText; families: RaceFamily[]; data: RaceSummaryData }> {
    summaryDataPromise ??= (async () => {
        const [gameText, raceData, governments, resources, components, facilities, research] = await Promise.all([
            fetchText(resolveThemedDataUrl('GameText.txt')).catch(() => ''),
            loadWizardRaceData(),
            loadWizardGovernments().catch(() => [] as Government[]),
            loadDataFile('resources.txt', parseResources),
            loadDataFile('components.txt', parseComponents),
            loadDataFile('facilities.txt', parseFacilities),
            loadDataFile('research.txt', parseResearch),
        ]);
        return {
            text: parseGameText(isRaceFileText(gameText) ? gameText : '').text,
            families: raceData.families,
            data: { races: raceData.races, resources, governments, research, components, facilities },
        };
    })();
    return summaryDataPromise;
}

function buildRacePage(ctx: WizardCtx, onRaceChanged?: WizardRaceChangedHandler): HTMLDivElement {
    const options = ctx.options;
    const wrap = pageDiv('wizard-race-page');

    // pnlStartNewGameYourEmpireRace 750 × 595 at (5, 5); picStartNewGameYourRaceImage 130 × 595 at (760, 5), Zoom.
    const racePanel = panel(wrap, 5, 5, 750, 595, 'wizard-race-row');
    resxPicture(wrap, 'picStartNewGameYourRaceImage.Image', 760, 5, 130, 595, 'zoom');

    const loading = label(racePanel, 'Loading races…', 15, 20, { size: FONT.large, className: 'wizard-race-loading' });

    void loadWizardRaceData()
        .then(({ races, missing }) => {
            loading.remove();
            if (races.length === 0) {
                label(racePanel, 'No race data available.', 15, 20, { size: FONT.large, className: 'wizard-race-error' });
                return;
            }
            // Default selection: first playable race, sorted by name.
            if (options.raceName === '') {
                options.raceName = defaultRaceName(races);
            }
            renderRacePage(ctx, racePanel, races, onRaceChanged);
            if (missing.length > 0) {
                label(racePanel, `${missing.length} race file(s) not found in this install and are hidden: ${missing.join(', ')}.`, 15, 395, { size: FONT.tiny, wrapWidth: 300, color: COLORS.link, className: 'wizard-race-missing' });
            }
        })
        .catch((err) => {
            loading.remove();
            label(racePanel, `Failed to load race data: ${String(err)}`, 15, 20, { size: FONT.large, wrapWidth: 700, className: 'wizard-race-error' });
        });

    (wrap as unknown as { __onShow?: () => void }).__onShow = () => {
        ctx.help(helpTitle2('Your Race', 'Race'), wt("The dominant race at your empire's home colony", "The dominant race at your empire's home colony"));
    };
    return wrap;
}

/** cmbStartNewGameYourEmpireRace 300 × 26 at (15, 20), picStartNewGameYourEmpireRace 300 × 300 at (15, 57), the link
 *  (15, 365), lblStartNewGameYourEmpireRaceName (325, 20) font_9 and the RaceSummaryPanel (390 wide) in a 410 × 525
 *  scrolling container at (330, 57) (Start.1.cs 4156 cmbStartNewGameYourEmpireRace_SelectedIndexChanged). */
function renderRacePage(ctx: WizardCtx, parent: HTMLElement, races: Race[], onRaceChanged?: WizardRaceChangedHandler): void {
    const options = ctx.options;
    const sorted = [...races].sort((a, b) => a.name.localeCompare(b.name));
    const playable = sorted.filter((r) => r.playable);

    const raceCombo = raceDropDown({
        races: playable.map((r) => ({ name: r.name, pictureUrl: racePortraitUrls(r.pictureIndex)[0] })),
        value: options.raceName,
        height: 26,
        size: FONT.large,
        maxItems: 16,
        listParent: ctx.listParent,
        onChange: (name) => {
            const r = sorted.find((x) => x.name === name);
            if (r) selectRace(r);
        },
    });
    raceCombo.el.classList.add('wizard-race-list');
    parent.appendChild(place(raceCombo.el, 15, 20, 300, 26));
    ctx.helpOn(raceCombo.el, () => [helpTitle2('Your Race', 'Race'), wt("The dominant race at your empire's home colony", "The dominant race at your empire's home colony")]);

    const detailPortrait = place(el('div', 'wizard-race-portrait-wrap'), 15, 57, 300, 300);
    parent.appendChild(detailPortrait);
    helpLink(parent, `${wt('Read more about this race', 'Read more about this race')}...`, 15, 365, () => options.raceName || wt('Alien Races', 'Alien Races'));
    const detailName = label(parent, '', 325, 18, { size: FONT.title, bold: true, className: 'wizard-race-name' });
    const summaryBox = scrollPanel('wizard-race-summary-scroll wizard-race-detail');
    parent.appendChild(place(summaryBox, 330, 57, 410, 525));
    const summary = el('div', 'wizard-race-summary');
    summary.style.width = '390px';
    summaryBox.appendChild(summary);

    function selectRace(race: Race): void {
        options.raceName = race.name;
        raceCombo.setValue(race.name);
        // picStartNewGameYourEmpireRace (300 × 300, Start.cs 3579): method_118(null, race, 300, 300, bitmap_31, 6, false)
        // (Start.1.cs 4189) — the race on its native landscape in the panel frame.
        detailPortrait.replaceChildren(racePictureCanvas(racePicturePlan({ empire: null, race, width: 300, height: 300, inset: 6, pirate: false }), 'wizard-race-picture wizard-race-portrait'));
        setText(detailName, race.name);
        showRaceSummary(summary, race);
        // Task 06e: let the "Your Empire" page re-derive its defaults.
        onRaceChanged?.(race.name);
    }

    const initial = sorted.find((r) => r.name === options.raceName) ?? sorted.find((r) => r.playable) ?? sorted[0];
    selectRace(initial);
}

// ---------------------------------------------------------------------------
// Your Empire page (task 06e; Start.cs 3337 method_40): name, colours, flag, location, trackbars, government.
// ---------------------------------------------------------------------------

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

let governmentsPromise: Promise<Government[]> | null = null;
/** Task 06e: load governments.txt via the same URL resolution the engine
 * uses (Customization/<set>/ first, base last). A body that is not a real
 * DW:U .txt file (the dev server's HTML 404 fallback) yields no rows. */
function loadWizardGovernments(): Promise<Government[]> {
    governmentsPromise ??= fetchText(resolveThemedDataUrl('governments.txt')).then((text) => (isRaceFileText(text) ? parseGovernments(text) : []));
    governmentsPromise.catch(() => {
        governmentsPromise = null;
    });
    return governmentsPromise;
}

/** cmbStartNewGameYourEmpireGalaxyLocation's picture (Start.2.cs 2794 cmbYourEmpireStartLocation_SelectedIndexChanged):
 *  the galaxy shape image with a (96, 255, 64, 64) ring of the start region — inner radius `inner`, width `width`, as
 *  fractions of the image's half width. */
export function startLocationRing(location: string, shape: GalaxyShape): { inner: number; width: number } {
    switch (location) {
        case 'Deep Core': return { inner: 0, width: 0.29 };
        case 'Outer Core': return { inner: 0.29, width: 0.19 };
        case 'Inner Rim': return { inner: 0.48, width: 0.38 };
        case 'Outer Rim': return { inner: 0.86, width: 0.14 };
        case 'Far Regions': return { inner: 0.48, width: 0.52 };
        case 'Core': return { inner: 0, width: 0.29 };
        case 'Void': return { inner: 0.29, width: 0.53 };
        case 'Rim': return { inner: 0.82, width: 0.18 };
        case 'Center': return { inner: 0, width: 0.48 };
        case 'Edge': return { inner: 0.48, width: 0.96 };
        default: {
            const clustered = shape === GalaxyShape.Irregular || shape === GalaxyShape.ClustersEven || shape === GalaxyShape.ClustersVaried;
            return { inner: 0, width: clustered ? 1.44 : 1.0 };
        }
    }
}

function buildEmpirePage(ctx: WizardCtx): HTMLDivElement {
    const options = ctx.options;
    const wrap = pageDiv('wizard-empire-page');

    // pnlStartNewGameYourEmpireDetails 340 × 110 at (10, 8): "Empire Name" (10, 10) font_6 max 90 × 35, txtYourEmpireName
    // 220 × 23 at (105, 9); "Main Color" (10, 47) / "Secondary Color" (10, 82); cmbPrimaryColor / cmbSecondaryColor 80 × 22
    // at (105, 41) / (105, 76); cmbFlagShape 128 wide at (196, 41), ItemHeight 63, DropDownHeight 700.
    const details = panel(wrap, 10, 8, 340, 110, 'wizard-empire-details');
    label(details, wt('Empire Name', 'Empire Name'), 10, 10, { bold: true, wrapWidth: 90, className: 'wizard-empire-label' });
    // The name stays empty (engine-generated, see empireNamePlaceholder)
    // until the user types one; a typed name survives race changes.
    let nameCustomised = options.empireName !== '';
    const nameInput = textBox(options.empireName, '', (v) => {
        options.empireName = v.trim() === '' ? '' : v;
        nameCustomised = options.empireName !== '';
    });
    nameInput.classList.add('wizard-empire-name-input');
    nameInput.style.fontSize = `${FONT.normal}px`;
    details.appendChild(place(nameInput, 105, 9, 220, 23));
    ctx.helpOn(nameInput, () => [helpTitle2('Your Empire', 'Name'), wt('Type the name of your empire here', 'Type the name of your empire here')]);
    label(details, wt('Main Color', 'Main Color'), 10, 47);
    label(details, wt('Secondary Color', 'Secondary Color'), 10, 82, { size: FONT.tiny });

    const palette = wizardColorPalette();
    const primary = colorDropDown({
        colors: palette,
        value: options.primaryColor || '#808080',
        allowCustom: true,
        listParent: ctx.listParent,
        onChange: (c) => {
            options.primaryColor = c;
            updateFlagPreview();
        },
    });
    primary.el.classList.add('wizard-empire-color-input', 'wizard-empire-primary');
    details.appendChild(place(primary.el, 105, 41, 80, 22));
    ctx.helpOn(primary.el, () => [helpTitle2('Your Empire', 'Main Color'), wt('The primary color for your empire', 'The primary color for your empire')]);
    const secondary = colorDropDown({
        colors: palette,
        value: options.secondaryColor || '#ffffff',
        allowCustom: true,
        listParent: ctx.listParent,
        onChange: (c) => {
            options.secondaryColor = c;
            updateFlagPreview();
        },
    });
    secondary.el.classList.add('wizard-empire-color-input', 'wizard-empire-secondary');
    details.appendChild(place(secondary.el, 105, 76, 80, 22));
    ctx.helpOn(secondary.el, () => [helpTitle2('Your Empire', 'Secondary Color'), wt('The secondary color for your empire', 'The secondary color for your empire')]);

    let stockFlagUrls: string[] = flagShapeTileUrls(undefined);
    // [wizardB1] Start.1.cs 3912 method_204: a pirate start lists Galaxy.FlagShapesPirates instead.
    const pirateFlagUrls = themeFlagShapeUrls(true) ?? PIRATE_FLAG_SHAPES.map((_, i) => pirateFlagShapeUrl(i)); // a theme's pirate folder replaces the list
    let flagUrls: string[] = empireTypeIsPirate(options.empireType) ? pirateFlagUrls : stockFlagUrls;
    /** cmbFlagShape_DrawItem (Start.2.cs 2932): GenerateEmpireFlag in the chosen colours (grey / white while they are
     *  equal), Height - 2 tall and Height / 0.6 wide, centred. */
    const drawFlag = (url: string) => (row: HTMLDivElement, h: number): void => {
        const fh = h - 2;
        const fw = Math.trunc(fh / 0.6);
        const same = (options.primaryColor || '#808080') === (options.secondaryColor || '#ffffff');
        const f = el('div', 'wizard-flag');
        f.style.width = `${fw}px`;
        f.style.height = `${fh}px`;
        f.style.background = same ? '#808080' : options.primaryColor || '#808080';
        const s = el('div', 'wizard-flag-shape');
        s.style.backgroundColor = same ? '#ffffff' : options.secondaryColor || '#ffffff';
        s.style.maskImage = `url(${url})`;
        s.style.webkitMaskImage = `url(${url})`;
        f.appendChild(s);
        row.appendChild(f);
    };
    const flagItems = (): ImageComboItem[] => flagUrls.map((url, i) => ({ value: String(i), label: `Flag shape ${i}`, title: `Flag shape ${i}`, draw: drawFlag(url) }));
    const flagCombo = imageCombo({
        items: flagItems(),
        value: String(options.flagShapeIndex),
        itemHeight: 63,
        maxItems: 11,
        className: 'wizard-flag-combo',
        listParent: ctx.listParent,
        onChange: (v) => selectFlagShape(parseInt(v, 10)),
    });
    flagCombo.el.classList.add('wizard-empire-flag-grid');
    details.appendChild(place(flagCombo.el, 196, 41, 128, 65));
    ctx.helpOn(flagCombo.el, () => [helpTitle2('Your Empire', 'Flag'), wt("The design of your empire's flag", "The design of your empire's flag")]);

    // pnlStartNewGameYourEmpireGalaxyLocation 300 × 110 at (360, 8): "Galaxy Starting Location" (10, 10) font_6,
    // cmbYourEmpireStartLocation 160 × 24 at (10, 35), the 98 × 98 picture at (180, 6).
    // [wizardB1] cmbYourEmpireStartLocation (items per galaxy shape, Start.1.cs method_205).
    const locPanel = panel(wrap, 360, 8, 300, 110, 'wizard-empire-location');
    label(locPanel, wt('Galaxy Starting Location', 'Galaxy Starting Location'), 10, 10, { bold: true });
    const startLocation = combo(locPanel, startLocationsForShape(options.shape), options.startLocationIndex ?? 0, 10, 35, 160, 24, (i) => {
        options.startLocationIndex = i;
        paintLocation();
    }, 'wizard-start-location');
    ctx.helpOn(startLocation.select, () => [helpTitle2('Your Empire', 'Start Location'), wt('The approximate starting location of your empire within the galaxy', 'The approximate starting location of your empire within the galaxy')]);
    const locCanvas = el('canvas', 'wizard-location-picture');
    locPanel.appendChild(place(locCanvas, 180, 6, 98, 98));
    let locImageShape: GalaxyShape | null = null;
    const locImage = new Image();
    locImage.addEventListener('load', () => paintLocation());
    function paintLocation(): void {
        const opt = SHAPE_OPTIONS.find((o) => o.shape === options.shape) ?? SHAPE_OPTIONS[1];
        if (locImageShape !== opt.shape) {
            locImageShape = opt.shape;
            locImage.src = `${CHROME}${opt.image}`;
            return;
        }
        if (!locImage.complete || locImage.naturalWidth === 0) return;
        const W = locImage.naturalWidth;
        locCanvas.width = W;
        locCanvas.height = locImage.naturalHeight;
        const g = locCanvas.getContext('2d');
        if (g === null) return;
        g.drawImage(locImage, 0, 0);
        const names = startLocationsForShape(options.shape);
        const ring = startLocationRing(names[options.startLocationIndex ?? 0] ?? '(Random)', options.shape);
        const half = Math.trunc(W / 2);
        const pen = Math.trunc(ring.width * half);
        const inner = Math.trunc(ring.inner * half);
        let x = half - (inner + pen);
        let d = (inner + pen) * 2;
        x += pen / 2;
        d -= pen;
        if (pen <= 0 || d <= 0) return;
        g.strokeStyle = 'rgba(255, 64, 64, 0.376)';
        g.lineWidth = pen;
        g.beginPath();
        g.ellipse(x + d / 2, x + d / 2, d / 2, d / 2, 0, 0, Math.PI * 2);
        g.stroke();
    }

    // tbarStartNewGameYourEmpireHomeSystem / Size / TechLevel / Corruption: 650 × 42 at (10, 123 / 168 / 213 / 258)
    // (a pirate start: Tech Level at (10, 123), the others hidden).
    const homeSystemSlider = trackBar(wrap, { x: 10, y: 123, w: 650, h: 42, label: wt('Home System', 'Home System'), labels: HOME_SYSTEM_TICKS.map((t) => wt(t, t)), value: options.homeSystemIndex ?? 2, onChange: (i) => (options.homeSystemIndex = i) });
    // Task M4x: size (tbarStartNewGameYourEmpireSize) and tech level (tbarStartNewGameYourEmpireTechLevel).
    const sizeSlider = trackBar(wrap, { x: 10, y: 168, w: 650, h: 42, label: wt('Size', 'Size'), labels: EMPIRE_SIZE_TICKS, value: options.empireExpansionIndex ?? 1, onChange: (i) => (options.empireExpansionIndex = i) });
    const techSlider = trackBar(wrap, { x: 10, y: 213, w: 650, h: 42, label: wt('Tech Level', 'Tech Level'), labels: TECH_LEVEL_TICKS, value: options.empireTechLevelIndex ?? 1, onChange: (i) => (options.empireTechLevelIndex = i) });
    // [wizardB1] tbarStartNewGameYourEmpireCorruption (Start.cs 3472; method_63 → EmpireStart.CorruptionMultiplier).
    const corruptionSlider = trackBar(wrap, { x: 10, y: 258, w: 650, h: 42, label: wt('Corruption', 'Corruption'), labels: CORRUPTION_TICKS, value: options.empireCorruptionIndex ?? 1, onChange: (i) => (options.empireCorruptionIndex = i) });

    // [wizardB1] the pirate playstyle (method_40: shown instead of government / home system / size / corruption for a
    // pirate start): label (10, 197) font_7, combo 120 × 21 at (140, 194), description 340 × 350 at (10, 230), picture
    // 300 × 300 at (360, 230).
    const pirate = buildPiratePlaystyle(ctx, wrap, { label: [10, 197], combo: [140, 194, 120, 21], desc: [10, 230, 340, 350], pic: [360, 230, 300] });

    // pnlStartNewGameYourEmpireGovernment 650 × 285 at (10, 308): "Your Government: <name>" (10, 10) font_7,
    // cmbStartNewGameYourEmpireGovernment 175 × 21 at (15, 35) (AllowNullItem "(Random)"), the attributes (200, 37) max
    // 430 × 200, lnkStartNewGameYourEmpireGovernment (200, 255).
    const govSection = panel(wrap, 10, 308, 650, 285, 'wizard-empire-gov');
    const govTitle = label(govSection, `${wt('Your Government', 'Your Government')}`, 10, 10, { size: FONT.header, bold: true, className: 'wizard-empire-label' });
    const govLoading = label(govSection, 'Loading governments…', 15, 37, { size: FONT.large, className: 'wizard-race-loading' });
    const govSel = combo(govSection, [], 0, 15, 35, 175, 21, (i) => selectGovernment(i <= 0 ? -1 : governments[i - 1]?.governmentId ?? -1), 'wizard-empire-gov-select');
    govSel.select.style.display = 'none';
    ctx.helpOn(govSel.select, () => [helpTitle2('Your Empire', 'Government'), wt('The form of government that your empire follows', 'The form of government that your empire follows')]);
    const govAttrs = label(govSection, '', 200, 37, { size: FONT.large, wrapWidth: 430, className: 'wizard-empire-gov-table' });
    govAttrs.style.maxHeight = '200px';
    helpLink(govSection, `${wt('Read more about this Government type', 'Read more about this Government type')}...`, 200, 255, () => selectedGovernment()?.name ?? wt('Government Types', 'Government Types'), 360);

    // picStartNewGameYourEmpireImage 220 × 585 at (670, 8), Zoom.
    resxPicture(wrap, 'picStartNewGameYourEmpireImage.Image', 670, 8, 220, 585, 'zoom');

    let governments: Government[] = [];

    function selectedGovernment(): Government | null {
        return governments.find((g) => g.governmentId === options.governmentId) ?? null;
    }

    function renderGovModifiers(): void {
        const gov = selectedGovernment();
        setText(govTitle, `${wt('Your Government', 'Your Government')}: ${gov?.name ?? `(${wt('Random', 'Random')})`}`);
        setText(govAttrs, governments.length === 0 ? '' : governmentAttributesText(gov));
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
                label(govSection, 'No start-available government data found in this install.', 15, 37, { size: FONT.large, className: 'wizard-todo' });
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
            govSel.setItems([`(${wt('Random', 'Random')})`, ...governments.map((g) => g.name)], governments.findIndex((g) => g.governmentId === options.governmentId) + 1);
            govSel.select.style.display = '';
            renderGovModifiers();
        })
        .catch((err) => {
            govLoading.remove();
            label(govSection, `Failed to load government data: ${String(err)}`, 15, 37, { size: FONT.large, wrapWidth: 620, className: 'wizard-race-error' });
        });

    function updateFlagPreview(): void {
        flagCombo.refresh();
    }

    function selectFlagShape(index: number): void {
        options.flagShapeIndex = index;
        flagCombo.setValue(String(index));
        updateFlagPreview();
    }

    /** A default shape index past the loaded shapes wraps (Start.1.cs 3453
     * only selects YourEmpireFlagShape when it is below the item count). */
    function clampFlagShape(): void {
        if (options.flagShapeIndex >= flagUrls.length) options.flagShapeIndex %= flagUrls.length;
    }
    function buildFlagTiles(): void {
        flagCombo.setItems(flagItems());
        flagCombo.setValue(String(options.flagShapeIndex));
    }
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
        primary.setColor(options.primaryColor || '#808080');
        secondary.setColor(options.secondaryColor || '#ffffff');
        if (options.flagShapeIndex >= 0) flagCombo.setValue(String(options.flagShapeIndex));
        updateFlagPreview();
        // Start.1.cs 4176 method_207 → method_101: the pirate playstyle picture shows the selected race.
        pirate.paint();
    }
    (wrap as unknown as { __onRaceChanged?: WizardRaceChangedHandler }).__onRaceChanged = onRaceChanged;

    // Initial paint: apply defaults once so the controls show something even
    // before any race has been picked (raceName '' → race index 0).
    onRaceChanged(options.raceName);

    // [wizardB1] Start.cs 3398-3420 method_40: a pirate start hides the government, home system, size and corruption
    // controls and shows the pirate playstyle; the start locations follow the galaxy shape.
    function syncPlaystyle(): void {
        const isPirate = empireTypeIsPirate(options.empireType);
        govSection.style.display = isPirate ? 'none' : '';
        homeSystemSlider.el.style.display = isPirate ? 'none' : '';
        sizeSlider.el.style.display = isPirate ? 'none' : '';
        corruptionSlider.el.style.display = isPirate ? 'none' : '';
        place(techSlider.el, 10, isPirate ? 123 : 213);
        pirate.show(isPirate);
        pirate.paint();
        startLocation.setItems(startLocationsForShape(options.shape), options.startLocationIndex ?? 0);
        paintLocation();
        techSlider.slider.setValue(options.empireTechLevelIndex ?? 1);
        const urls = isPirate ? pirateFlagUrls : stockFlagUrls;
        if (urls !== flagUrls) {
            flagUrls = urls;
            clampFlagShape();
            buildFlagTiles();
            updateFlagPreview();
        }
    }
    (wrap as unknown as { __onShow?: () => void }).__onShow = () => {
        syncPlaystyle();
        ctx.help(helpTitle2('Your Empire', 'Name'), wt('Type the name of your empire here', 'Type the name of your empire here'));
    };
    syncPlaystyle();

    return wrap;
}

// ---------------------------------------------------------------------------
// Victory Conditions page (task 06g; Start.cs 3670 method_44 / 3771 method_45): victory types + thresholds, time
// limits, story and event toggles.
// ---------------------------------------------------------------------------

/** A numeric box ("XX" of the original's labels) bound to one victory / scenario number, clamped into [min, max] on
 *  edit (the box keeps what was typed). */
function numberBox(parent: HTMLElement, cls: string, x: number, y: number, w: number, min: number, max: number, get: () => number, set: (v: number) => void): HTMLDivElement {
    const s = spinBox(`wizard-victory-number-input ${cls}`, get(), { min, max });
    s.input.addEventListener('input', () => {
        const v = parseInt(s.input.value, 10);
        if (!Number.isNaN(v)) {
            set(Math.min(max, Math.max(min, v)));
        }
    });
    parent.appendChild(place(s.el, x, y, w, 21));
    return s.el;
}

function buildVictoryPage(ctx: WizardCtx): HTMLDivElement {
    const options = ctx.options;
    const wrap = pageDiv('wizard-victory-page');
    const v = options.victory;
    const xx = (tag: string, fallback: string): string => formatNet(wt(tag, fallback), ['XX']);

    // pnlStartNewGameVictoryConditionsGroup 880 × 155 at (10, 10), BackColor (80, 0, 40): lblVictorySandbox (8, 8)
    // 339 × 139 font_6; chkVictoryTerritory / Population / Economy / EnableRaceSpecificConditions at (355, 12 / 37 / 62 / 87)
    // font_3 with their boxes at (830, 12 / 37 / 62); cmbVictoryThresholdPercentage 60 × 21 at (355, 117) + its label (421, 119).
    const group = place(el('div', 'wizard-victory-section wizard-victory-group'), 10, 10, 880, 155);
    wrap.appendChild(group);
    const sandboxNote = label(group, '', 8, 8, { bold: true, wrapWidth: 339, className: 'wizard-victory-sandbox' });
    sandboxNote.style.maxHeight = '139px';
    const territory = check(group, xx('TERRITORY control X', 'TERRITORY: control {0}% of the colonies in the galaxy'), v.territory, 355, 12, (x) => (v.territory = x));
    ctx.helpOn(territory.row, () => [helpTitle2('Victory', 'Territory'), wt('Victory Condition Target: Control the specified percentage of all colonies in the galaxy', 'Victory Condition Target: Control the specified percentage of all colonies in the galaxy')]);
    numberBox(group, 'wizard-victory-territory', 830, 12, 46, VICTORY_PERCENT_MIN, Number.MAX_SAFE_INTEGER, () => v.territoryPercent, (x) => (v.territoryPercent = x));
    const population = check(group, xx('POPULATION control X', "POPULATION: control {0}% of the galaxy's population"), v.population, 355, 37, (x) => (v.population = x));
    ctx.helpOn(population.row, () => [helpTitle2('Victory', 'Population'), wt("Victory Condition Target: Control the specified percentage of the galaxy's population", "Victory Condition Target: Control the specified percentage of the galaxy's population")]);
    numberBox(group, 'wizard-victory-population', 830, 37, 46, VICTORY_PERCENT_MIN, Number.MAX_SAFE_INTEGER, () => v.populationPercent, (x) => (v.populationPercent = x));
    const economy = check(group, xx('ECONOMY control X', 'ECONOMY: private economy generates {0}% of the galaxy total'), v.economy, 355, 62, (x) => (v.economy = x));
    ctx.helpOn(economy.row, () => [helpTitle2('Victory', 'Economy'), wt("Victory Condition Target: Your empire's private economy must generate the specified percentage of the galaxy's total income", "Victory Condition Target: Your empire's private economy must generate the specified percentage of the galaxy's total income")]);
    numberBox(group, 'wizard-victory-economy', 830, 62, 46, VICTORY_PERCENT_MIN, Number.MAX_SAFE_INTEGER, () => v.economyPercent, (x) => (v.economyPercent = x));
    const raceConditions = check(group, wt('Enable Race-specific Victory Conditions', 'Enable Race-specific Victory Conditions'), v.enableRaceSpecificConditions, 355, 87, (x) => (v.enableRaceSpecificConditions = x));
    ctx.helpOn(raceConditions.row, () =>
        empireTypeIsPirate(options.empireType)
            ? [helpTitle2('Victory', 'Pirate-specific Conditions'), wt('Enables Pirate-specific Victory Conditions in the game', 'Enables Pirate-specific Victory Conditions in the game')]
            : [helpTitle2('Victory', 'Race-specific Conditions'), wt('Enables Race-specific Victory Conditions in the game', 'Enables Race-specific Victory Conditions in the game')],
    );
    // [wizardB1] cmbVictoryThresholdPercentage (Start.1.cs 3804 method_203 → VictoryThresholdPercentage).
    const thresholdIndex = (): number => {
        const i = VICTORY_THRESHOLD_VALUES.indexOf(v.victoryThresholdPercentage);
        return i >= 0 ? i : VICTORY_THRESHOLD_VALUES.length - 1;
    };
    const threshold = combo(group, VICTORY_THRESHOLD_NAMES, thresholdIndex(), 355, 117, 64, 21, (i) => {
        v.victoryThresholdPercentage = VICTORY_THRESHOLD_VALUES[i] ?? 1.0;
    }, 'wizard-victory-threshold');
    ctx.helpOn(threshold.select, () => [helpTitle2('Victory', 'Victory Threshold Percentage'), wt('Sets the percentage of Victory Conditions that must be fulfilled to win the game', 'Sets the percentage of Victory Conditions that must be fulfilled to win the game')]);
    label(group, wt('Victory Threshold Percent', 'Victory Threshold Percent'), 425, 118, { size: FONT.header, bold: true });

    // chkVictoryTimeStart (365, 175) / chkVictoryTimeLimit (365, 200), their year boxes at (840, 175 / 200).
    // [wizardB1] chkVictoryTimeStart (Start.1.cs 3792 → VictoryConditions.StartDate): was a dummy, always-checked box.
    const timeStart = check(wrap, xx('Victory Conditions X', 'Victory Conditions apply after {0} years'), v.timeStart === true, 365, 175, (x) => (v.timeStart = x));
    ctx.helpOn(timeStart.row, () => [helpTitle2('Victory', 'Start Time'), wt('Victory Conditions will not apply until the specified number of years have passed', 'Victory Conditions will not apply until the specified number of years have passed')]);
    numberBox(wrap, 'wizard-victory-start-years', 840, 175, 46, VICTORY_TIME_START_YEARS_MIN, VICTORY_TIME_START_YEARS_MAX, () => v.startDateYears, (x) => (v.startDateYears = x));
    const timeLimit = check(wrap, xx('TIME LIMIT X', 'TIME LIMIT: game finishes after {0} years'), v.timeLimit, 365, 200, (x) => (v.timeLimit = x));
    ctx.helpOn(timeLimit.row, () => [helpTitle2('Victory', 'Time Limit'), wt('The game will finish after the specified number of years have passed', 'The game will finish after the specified number of years have passed')]);
    numberBox(wrap, 'wizard-victory-limit-years', 840, 200, 46, VICTORY_TIME_LIMIT_YEARS_MIN, VICTORY_TIME_LIMIT_YEARS_MAX, () => v.timeLimitYears, (x) => (v.timeLimitYears = x));

    // [wizardB1] the story box (Start.cs 3715-3751): chkStoryDistantWorlds, chkStoryReturnOfTheShakturi, the event toggles,
    // chkStoryShadows at (20, 245 + 25 i); tech trading and Giant Kaltors right-aligned at y 320 / 345 (Start.cs
    // 3752-3759), with the recreation's "Scale debris fields with galaxy size" above them.
    const events = place(el('div', 'wizard-victory-section wizard-victory-events'), 0, 0, 900, 660);
    wrap.appendChild(events);
    const storyHelp = (): [string, string] => [helpTitle2('Victory', 'Story Events'), wt('Enables story events in the game', 'Enables story events in the game')];
    ctx.helpOn(check(events, wt('Enable original Distant Worlds story events', 'Enable original Distant Worlds story events'), v.enableStoryDistantWorlds === true, 20, 245, (x) => (v.enableStoryDistantWorlds = x)).row, storyHelp);
    const shakturi = check(events, wt('Enable Return Of The Shakturi story events and victory conditions', 'Enable Return Of The Shakturi story events and victory conditions'), v.enableStoryEvents === true, 20, 270, (x) => (v.enableStoryEvents = x));
    ctx.helpOn(shakturi.row, storyHelp);
    ctx.helpOn(check(events, wt('Enable Disasters and other events', 'Enable Disasters and other events'), v.enableDisasterEvents, 20, 295, (x) => (v.enableDisasterEvents = x)).row, () => [helpTitle2('Victory', 'Disaster Events'), wt('Enables various random game events, such as disasters at colonies', 'Enables various random game events, such as disasters at colonies')]);
    ctx.helpOn(check(events, wt('Enable Race-specific events', 'Enable Race-specific events'), v.enableRaceSpecificEvents, 20, 320, (x) => (v.enableRaceSpecificEvents = x)).row, () => [helpTitle2('Victory', 'Race-specific Events'), wt('Enables Race-specific Events in the game', 'Enables Race-specific Events in the game')]);
    const shadows = check(events, wt('Enable Shadows story events', 'Enable Shadows story events'), v.enableStoryEventsShadows === true, 20, 345, (x) => (v.enableStoryEventsShadows = x));
    ctx.helpOn(shadows.row, () => [helpTitle2('Victory', 'Shadows Events'), wt('Enables pre-warp game events, such as triggered pirate attacks and creature outbreaks', 'Enables pre-warp game events, such as triggered pirate attacks and creature outbreaks')]);
    const rightCheck = (content: string, checked: boolean, y: number, onChange: (x: boolean) => void): HTMLLabelElement => {
        const c = checkBoxRight(content, checked, onChange, FONT.large);
        c.classList.add('wizard-checkbox', 'wizard-check-right');
        events.appendChild(place(c, 0, y));
        c.style.left = 'auto';
        c.style.right = '20px';
        return c;
    };
    rightCheck(wt('Scale debris fields with galaxy size', 'Scale debris fields with galaxy size'), options.scaleDebrisFields ?? false, 295, (x) => (options.scaleDebrisFields = x));
    ctx.helpOn(rightCheck(wt('Allow Tech Trading', 'Allow Tech Trading'), options.allowTechTrading ?? true, 320, (x) => (options.allowTechTrading = x)), () => [helpTitle2('Victory', 'Tech Trading'), wt('Enables tech trading between empires in the Diplomacy screen', 'Enables tech trading between empires in the Diplomacy screen')]);
    ctx.helpOn(rightCheck(wt('Allow Giant Kaltors at game start', 'Allow Giant Kaltors at game start'), options.allowGiantKaltorGeneration ?? true, 345, (x) => (options.allowGiantKaltorGeneration = x)), () => [helpTitle2('Victory', 'Giant Kaltors'), wt('Allow Giant Kaltors to exist in the galaxy at the start of the game. These can be disabled to support storylines without them', 'Allow Giant Kaltors to exist in the galaxy at the start of the game. These can be disabled to support storylines without them')]);

    // picStartNewGameVictoryConditionsImage 870 × 220 at (15, 375).
    resxPicture(wrap, 'picStartNewGameVictoryConditionsImage.Image', 15, 375, 870, 220, 'normal');

    // Start.cs 3771 method_45 (pirate start: Return of the Shakturi unchecked and disabled, pirate-specific conditions,
    // the pirate explanation) and Start.1.cs 3098 btnStartNewGameOtherEmpiresNext_Click (Shadows only in a PreWarp galaxy).
    // The displayed state follows; the stored choice is kept and toCreateGameOptions applies the same rule.
    (wrap as unknown as { __onShow?: () => void }).__onShow = () => {
        const isPirate = empireTypeIsPirate(options.empireType);
        shakturi.input.disabled = isPirate;
        shakturi.input.checked = !isPirate && v.enableStoryEvents === true;
        const prewarp = (options.galaxyExpansionIndex ?? 1) === 0;
        shadows.input.disabled = !prewarp;
        shadows.input.checked = prewarp && v.enableStoryEventsShadows === true;
        setText(raceConditions.label, isPirate ? wt('Enable Pirate-specific Victory Conditions', 'Enable Pirate-specific Victory Conditions') : wt('Enable Race-specific Victory Conditions', 'Enable Race-specific Victory Conditions'));
        setText(
            sandboxNote,
            isPirate
                ? wt('Victory Conditions Explanation Pirate', 'Enable Pirate-specific victory conditions. Then select the pirate playstyle for your empire. Finally select the percentage threshold for victory.')
                : wt('Victory Conditions Explanation', 'Select any combination of Territory, Population, Economy or Race-specific victory conditions at right. Then select the percentage threshold for victory: this is the portion of the selected victory conditions that must be met for victory.\n\nLeave all victory conditions unchecked to play in Sandbox mode (open play)'),
        );
    };

    return wrap;
}

// ---------------------------------------------------------------------------
// Scenario page (mod layer, tasks/MODLAYER-DESIGN.md §3): the add-on picker (src/sim/scenario/addons.ts). A checklist of
// the add-ons of /assets/scenarios/index.json grouped by theme; ticking one ticks (and locks) what it needs; a summary
// of what will run; one collapsible settings panel (flags / params) per running add-on. Nothing ticked = the original
// game (options.scenario stays null). Not in the original; drawn like the Victory Conditions page (GradientPanels,
// CheckBoxes, the numeric boxes).
// ---------------------------------------------------------------------------

/** Scenarios listed by the Scenario page (filled when the index loads; read by the Start summary). */
let wizardScenarios: ScenarioManifest[] = [];

/**
 * The wizard's scenario choice for a set of ticks (null = the original game), with the Other Empires page's Smarter AI
 * choice folded in (addons.ts withSmarterAI).
 */
export function addonChoiceFor(cat: AddonCatalog, picked: readonly string[], overrides: AddonOverrides, smart: SmarterAIChoice | null = null): StartGameOptions['scenario'] {
    const w = withSmarterAI(picked, overrides, smart);
    const plan = planAddonStart(cat, w.picked);
    if (plan === null) return null;
    const sw = resolveAddonSwitches(cat, w.picked, w.overrides);
    return { id: plan.id, flags: sw.flags, params: sw.params, addons: canonicalAddons(cat, w.picked) };
}

function buildScenarioPage(ctx: WizardCtx): HTMLDivElement {
    const options = ctx.options;
    const wrap = pageDiv('wizard-scenario-page');

    label(wrap, 'Add-ons change the standard game. Tick any number of them; an add-on that needs another one ticks it for you. Nothing ticked is the original game.', 10, 4, { wrapWidth: 880, className: 'wizard-victory-sandbox wizard-scenario-intro' });

    const summary = label(wrap, '', 10, 30, { size: FONT.large, bold: true, color: COLORS.link, wrapWidth: 864, className: 'wizard-addon-summary' });
    summary.style.width = '880px';

    // The add-on list: a GradientPanel with a scrolling list (group captions like a GroupBox's, three columns of rows).
    const listPanel = panel(wrap, 10, 62, 880, 350, 'wizard-scenario-list-panel');
    const listSection = scrollPanel('wizard-victory-section wizard-scenario-list wizard-addon-list');
    listPanel.appendChild(place(listSection, 8, 8, 860, 330));

    // The running add-ons' settings.
    const detailPanel = panel(wrap, 10, 420, 880, 182, 'wizard-scenario-detail-panel');
    const detail = scrollPanel('wizard-victory-section wizard-scenario-detail');
    detailPanel.appendChild(place(detail, 8, 8, 860, 162));

    let cat: AddonCatalog = addonCatalog([]);
    // The Smarter AI add-on is the Other Empires page's (options.smarterAI), not a tick of this page.
    let picked: string[] = (options.scenario?.addons ?? (options.scenario ? [options.scenario.id] : [])).filter((id) => id !== SMARTER_AI_ADDON_ID);
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
        options.scenario = addonChoiceFor(cat, picked, overrides, options.smarterAI ?? null);
        render();
    }
    ctx.refreshScenario = update;

    function rowEl(r: AddonRow): HTMLElement {
        const row = el('label', 'wizard-addon-row' + (r.locked ? ' is-locked' : '') + (r.disabled && !r.locked ? ' is-disabled' : ''));
        if (r.tooltip) row.title = r.tooltip;
        const check = el('input');
        check.type = 'checkbox';
        check.checked = r.checked;
        check.disabled = r.disabled;
        if (r.tooltip) check.title = r.tooltip;
        check.addEventListener('change', () => {
            picked = toggleAddon(cat, picked, r.id, check.checked);
            update();
        });
        row.appendChild(check);
        const txt = el('div', 'wizard-addon-text');
        const head = el('div', 'wizard-addon-head');
        head.appendChild(el('span', 'wizard-addon-name', r.name));
        const deps = [r.needs.length > 0 ? `needs: ${r.needs.join(', ')}` : '', r.loads.length > 0 ? `loads: ${r.loads.join(', ')}` : ''].filter((x) => x !== '');
        if (deps.length > 0) head.appendChild(el('span', 'wizard-addon-needs', deps.join(' · ')));
        txt.appendChild(head);
        const desc = el('div', 'wizard-addon-desc', firstSentence(r.description));
        desc.title = r.description;
        txt.appendChild(desc);
        const note = r.locked ? `required by ${r.requiredBy.join(', ')}` : r.conflictsWith.length > 0 ? `conflicts with ${r.conflictsWith.join(', ')}` : r.loadedFor.length > 0 ? `data loaded for ${r.loadedFor.join(', ')} (off unless ticked)` : '';
        if (note !== '') txt.appendChild(el('div', 'wizard-addon-note', note));
        row.appendChild(txt);
        return row;
    }

    function render(): void {
        const model = addonPickerModel(cat, picked);
        summary.textContent = `Running: ${model.summary}`;
        const scroll = listSection.scrollTop;
        listSection.replaceChildren();
        if (cat.list.length === 0) {
            listSection.appendChild(el('div', 'wizard-todo', 'No add-ons found (/assets/scenarios/index.json).'));
        }
        for (const g of model.groups) {
            listSection.appendChild(el('div', 'wizard-addon-group', g.group));
            const grid = el('div', 'wizard-addon-grid');
            for (const r of g.rows) grid.appendChild(rowEl(r));
            listSection.appendChild(grid);
        }
        listSection.scrollTop = scroll;

        detail.replaceChildren();
        const choice = options.scenario ?? null;
        detail.appendChild(el('div', 'wizard-scenario-description', choice === null ? 'The original game, unchanged.' : 'Settings of the running add-ons'));
        if (choice === null) return;
        for (const id of model.panels) {
            const m = cat.manifests.get(id);
            const a = cat.byId.get(id);
            if (m === undefined || a === undefined) continue;
            const pnl = el('details', 'wizard-addon-panel');
            pnl.open = openPanels.has(id);
            pnl.addEventListener('toggle', () => {
                if (pnl.open) openPanels.add(id);
                else openPanels.delete(id);
            });
            pnl.appendChild(el('summary', '', m.name));
            const body = el('div', 'wizard-addon-panel-body');
            for (const f of m.flags) {
                if (f.name === a.masterFlag) continue; // the tick is the master switch
                const c = checkBox(f.label, choice.flags[f.name] ?? f.default, (x) => {
                    overrides.flags[f.name] = x;
                    options.scenario = addonChoiceFor(cat, picked, overrides, options.smarterAI ?? null);
                }, FONT.normal);
                c.classList.add('wizard-checkbox', 'wizard-flow');
                body.appendChild(c);
                if (f.description) body.appendChild(el('div', 'wizard-todo wizard-scenario-note', f.description));
            }
            for (const p of m.params) {
                const row = el('div', 'wizard-victory-number-row');
                row.appendChild(el('span', '', p.label));
                const min = p.min ?? -Number.MAX_SAFE_INTEGER;
                const max = p.max ?? Number.MAX_SAFE_INTEGER;
                const s = spinBox('wizard-victory-number-input', choice.params[p.name] ?? p.default, { min, max });
                s.input.addEventListener('input', () => {
                    const v = parseInt(s.input.value, 10);
                    if (!Number.isNaN(v)) {
                        overrides.params[p.name] = Math.min(max, Math.max(min, v));
                        options.scenario = addonChoiceFor(cat, picked, overrides, options.smarterAI ?? null);
                    }
                });
                s.el.classList.add('wizard-flow-spin');
                row.appendChild(s.el);
                body.appendChild(row);
            }
            pnl.appendChild(body);
            detail.appendChild(pnl);
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

// ---------------------------------------------------------------------------
// Start page (task 06d): summary of the chosen options before booting (not in the original, whose Victory Conditions
// page starts the game); a ListViewBase grid of setting / value rows in a GradientPanel.
// ---------------------------------------------------------------------------

function buildStartPage(ctx: WizardCtx): HTMLDivElement {
    const options = ctx.options;
    const wrap = pageDiv('wizard-start-page');

    label(wrap, 'Start a New Game', 10, 4, { size: FONT.header, bold: true, className: 'wizard-start-heading' });

    const summaryPanel = panel(wrap, 10, 32, 880, 548, 'wizard-start-panel');
    const grid = new OwGrid<[string, string]>({
        columns: [
            {
                id: 'key',
                header: 'Setting',
                width: 220,
                render: (r, cell) => {
                    cell.appendChild(el('span', 'wizard-start-key', r[0]));
                },
            },
            {
                id: 'value',
                header: 'Value',
                render: (r, cell) => {
                    cell.appendChild(el('span', 'wizard-start-value', r[1]));
                    cell.title = r[1];
                },
            },
        ],
        key: (r) => r[0],
        rowHeight: 19,
        fontSize: FONT.normal,
        rowClass: () => 'wizard-start-line',
    });
    grid.el.classList.add('wizard-start-summary');
    summaryPanel.appendChild(place(grid.el, 8, 8, 860, 528));

    label(wrap, 'Press “Start the Game!” to generate your galaxy.', 10, 588, { className: 'wizard-todo' });

    function refreshSummary(): void {
        const shapeOpt = SHAPE_OPTIONS.find((o) => o.shape === options.shape) ?? SHAPE_OPTIONS[1];
        // [wizardB1] the playstyle and the options added with it.
        const typeSpec = [...PLAYSTYLE_CUSTOM, ...PLAYSTYLE_ERAS].find((p) => p.type === (options.empireType ?? 'CustomStandard'));
        const isPirate = empireTypeIsPirate(options.empireType);
        const stories = [
            options.victory.enableStoryDistantWorlds === true && 'Distant Worlds',
            !isPirate && options.victory.enableStoryEvents === true && 'Return of the Shakturi',
            (options.galaxyExpansionIndex ?? 1) === 0 && options.victory.enableStoryEventsShadows === true && 'Shadows',
        ].filter(Boolean).join(', ');
        const rows: Array<[string, string]> = [
            ['Playstyle', typeSpec !== undefined ? wt(typeSpec.titleTag, typeSpec.title) : String(options.empireType)],
            ...(isPirate ? [['Pirate Playstyle', PIRATE_PLAYSTYLE_NAMES[options.piratePlayStyleIndex ?? 0] ?? 'Balanced'] as [string, string]] : []),
            ['Galaxy Shape', shapeOpt.label],
            ['Star Amount', options.customStarCount === undefined ? STAR_AMOUNT_TICKS[options.starCountIndex] ?? `${starCountFor(options.starCountIndex)} stars` : `${galaxyStarCount(options)} stars`],
            ['Physical Size', options.customSectorWidth === undefined && options.customSectorHeight === undefined ? PHYSICAL_SIZE_TICKS[options.dimensionIndex] ?? `${sectorsFor(options.dimensionIndex)}×${sectorsFor(options.dimensionIndex)} sectors` : `${galaxySectorCounts(options).width}×${galaxySectorCounts(options).height} sectors`],
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
                (options.scaleDebrisFields ?? false) ? 'scaled debris fields' : 'standard debris fields',
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
        grid.setRows(rows);
    }

    // Expose the refresher to the wizard shell (which calls it when this
    // page is shown, so the summary reflects the latest option edits).
    (wrap as unknown as { __refresh?: () => void }).__refresh = refreshSummary;
    refreshSummary();

    return wrap;
}

/** Re-exported for convenience (main.ts maps wizard options -> generateGalaxy). */
export { starCountFor, sectorsFor };
