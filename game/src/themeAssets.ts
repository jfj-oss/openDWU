// Theme (customization set) art and sound resolution: the URL the original would load for an install file under
// /assets/dwu/images/... or /assets/dwu/Sounds/... while a theme is active. Pure string logic over the active
// CustomizationSet (sim/data/customization.ts); with no theme every function returns its input unchanged, so the
// stock game is untouched.
//
// The original's loaders (Main.Part12.cs / Main.Part13.cs Load*, HabitatImageCache, BuiltObjectImageCache,
// CharacterImageCache, ColonyInvasion, EffectsPlayer) mostly resolve each file on its own — Main.Part13.cs method_10:
// Customization\<set>\images\<file> when File.Exists, else images\<file> — with these exceptions, ported here:
//   - base only (no customization at all): LoadMapStars (environment\mapstars, Main.Part13.cs 993, called with the
//     stock path only, Main.Part12.cs 1018) and LoadNebulae (environment\nebulae, Main.Part13.cs 1220);
//   - ui\chrome: LoadUiChromeForRace (Main.Part12.cs 607) / LoadUiChromeButtons (431) look in the player race's
//     Customization\<set>\images\ui\chrome\<Race>\ folder first (method_11 / method_55), except the method_10 files
//     (galaxy.png, storyEvent.jpg, ... Menu_*); chrome art the original embeds as resources (not loaded from
//     images\ui\chrome) is never themed;
//   - ui\components\Component_<n> and ui\resources\Resource_<n> (LoadUiComponents 2261 / LoadUiResources 2336): the
//     set's .png, the set's .bmp, the stock .png, the stock .bmp;
//   - whole-folder replacement (the set's folder is used for every file once it qualifies, else the stock folder for
//     every file): effects\weapons, effects\planetdestroy, effects\enginethrusters / mining / gasmining /
//     construction / tractorbeamstrike, environment\supernovae (folder exists and holds a *.png), effects\explosions
//     (folder has a subfolder), effects\hyperenter / hyperexit (folder has a "0" subfolder), environment\landscapes\
//     other (folder exists) — Main.Part12.cs 55 / 134 / 169 / 287, Main.Part13.cs 1193 / 1249-1264 / 1366-1506;
//   - ui\flagshapes[\pirate] (Galaxy.4.cs LoadFlagShapes 414): folder replacement by Directory.Exists, see
//     themeFlagShapeFiles;
//   - Sounds\Effects: per file (EffectsPlayer.cs 112-118, 810-826); Sounds\Music: the set's folder replaces the list
//     when it holds an *.mp3 (Main.Part12.cs 1342 method_68, see themeMusicFolder).
import { activeCustomizationSet, customizationFileUrl, type CustomizationSet } from './sim/data/customization';

const PREFIX = '/assets/dwu/';

/** Query marking an install URL the original loads from the stock folder even with a theme (e.g. Start.cs 1051). */
export const STOCK_ASSET_QUERY = '?stock=1';

/** LoadUiChromeForRace's method_10 files (no race subfolder; Main.Part12.cs 607-760), lower-case. */
const CHROME_NO_RACE = new Set(
    [
        'galaxy.png', 'storyEvent.jpg', 'storyMessage.jpg', 'blank.png', 'arrowhead.png',
        'playstyle_pirateshadows.png', 'playstyle_normalshadows.png', 'playstyle_pirateclassic.png', 'playstyle_normalclassic.png',
        ...['Tutorials', 'StartNewGame', 'LoadGame', 'Options', 'ChangeTheme', 'Exit', 'Galactopedia', 'Credits', 'CheckForUpdates'].flatMap((m) => [`Menu_${m}_Active.png`, `Menu_${m}_Inactive.png`]),
    ].map((f) => f.toLowerCase()),
);

/** LoadUiChromeForRace's method_11 files and LoadUiChromeButtons' method_55 files (race folder first), lower-case. */
const CHROME_RACE = new Set(
    [
        'happy', 'neutral', 'sad', 'angry', 'developmentLevel', 'colony', 'firepower', 'fleetLeader', 'capital', 'refuel', 'scrapbase',
        'pauseresume_Play', 'pauseresume_Pause', 'treaty', 'pirateflag', 'pirateflag_small', 'characters', 'money', 'automate',
        'unautomate', 'emergency', 'fighters', 'launchfighters', 'launchbombers', 'retrievefighters', 'retrievebombers',
        'upgradefighters', 'joinfleet', 'leavefleet', 'retrofitship', 'retrofitbase', 'returntotop', 'buildfighter', 'buildbomber',
        'colonize', 'build', 'construction', 'loadtroops', 'stop', 'newfleet', 'scrapfighter', 'research', 'advisorsuggestion',
        'bombard', 'exclamation', 'raid', 'assault', 'UpArrow', 'ScrollUpArrow', 'ScrollDownArrow', 'panelframe', 'asteroid',
        'asteroidField', 'debrisField', 'eraseitem', 'erasecolony', 'erasepopulation', 'eraseruins', 'eraseasteroidfield', 'mine',
        'attack', 'fleetAttackPosture', 'fleetDefendPosture', 'fleetRangeTarget', 'fleetRangeSystem', 'fleetRangeArea',
        'fleetRangeSector', 'fleetRangeAny', 'fleetAttackPoint', 'fleetHomeBase', 'research_small', 'scenery', 'territory',
        'longrangescanner', 'travelvectorMilitary', 'travelvectorCivilian', 'fleetposture', 'civilianfade', 'warpjump_large',
        'colonization_large', 'pirateMissionAttack', 'pirateMissionDefend', 'pirateMissionSmuggle', 'Space', 'assaultpod_landing',
        ...['Leader', 'Ambassador', 'ColonyGovernor', 'FleetAdmiral', 'TroopGeneral', 'IntelligenceAgent', 'Scientist', 'PirateLeader', 'ShipCaptain'].map((r) => `characterRole_${r}`),
        'expansionPlanner', 'gameEditor', 'key', 'shipsAndBases', 'fleets', 'diplomacy', 'troops', 'galaxyMap', 'designs', 'empirePolicy',
        'empireGraphs', 'messages', 'galacticHistory', 'forward', 'back', 'galactopedia', 'gameOptions',
        // LoadUiChromeButtons (method_55)
        'gameEditorButton', 'coloniesButton', 'shipsAndBasesButton', 'diplomacyButton', 'troopsButton', 'galaxyMapButton',
        'fleetsButton', 'constructionYardsButton', 'charactersButton', 'designsButton', 'expansionPlannerButton',
        'empirePolicyButton', 'empireGraphsButton', 'buildButton', 'galacticHistoryButton', 'messagesButton', 'gameOptionsButton',
        'galactopediaButton', 'galactopediaHome', 'cycleBases', 'cycleBasesBack', 'cycleColonies', 'cycleColoniesBack',
        'cycleConstruction', 'cycleConstructionBack', 'cycleIdleShips', 'cycleIdleShipsBack', 'cycleMilitary', 'cycleMilitaryBack',
        'cycleOther', 'cycleOtherBack', 'cycleFleets', 'cycleFleetsBack', 'shipStance', 'lockView', 'nearestMilitary',
        'selectionPanelSize', 'zoomColony', 'zoomIn', 'zoomOut', 'zoomRegion', 'zoomSector', 'zoomSelection', 'zoomSystem',
    ].map((f) => `${f}.png`.toLowerCase()),
);

/** Whole-folder replacement rules (lower-case folder relative to images/ -> the qualifying test on the set). */
type FolderRule = (set: CustomizationSet, dir: string) => boolean;
const hasPng: FolderRule = (set, dir) => set.listFiles(dir, '.png').length > 0;
const hasSubfolder = (sub?: string): FolderRule => (set, dir) => (sub !== undefined ? set.dirExists(`${dir}/${sub}`) : setHasAnySubfolder(set, dir));
const exists: FolderRule = (set, dir) => set.dirExists(dir);
const FOLDER_RULES: ReadonlyArray<[string, FolderRule]> = [
    ['images/effects/weapons', hasPng],
    ['images/effects/planetdestroy', hasPng],
    ['images/effects/enginethrusters', hasPng],
    ['images/effects/mining', hasPng],
    ['images/effects/gasmining', hasPng],
    ['images/effects/construction', hasPng],
    ['images/effects/tractorbeamstrike', hasPng],
    ['images/environment/supernovae', hasPng],
    ['images/effects/explosions', hasSubfolder()],
    ['images/effects/hyperenter', hasSubfolder('0')],
    ['images/effects/hyperexit', hasSubfolder('0')],
    ['images/environment/landscapes/other', exists],
];

function setHasAnySubfolder(set: CustomizationSet, dir: string): boolean {
    return set.hasSubfolder(dir);
}

const BASE_ONLY = ['images/environment/mapstars/', 'images/environment/nebulae/'];

let chromeRace = '';

/**
 * The player race whose Customization\<set>\images\ui\chrome\<Race>\ folder is searched first (Main.Part12.cs
 * method_56, applied with the player's DominantRace when a game starts or loads; "" on the menu).
 */
export function setThemeChromeRace(raceName: string | null | undefined): void {
    chromeRace = raceName ?? '';
}

export function themeChromeRace(): string {
    return chromeRace;
}

/** Split a URL into (prefix up to and including /assets/dwu/, decoded install-relative path, query/hash) or null. */
function splitAssetUrl(url: string): { head: string; rel: string; tail: string } | null {
    const i = url.indexOf(PREFIX);
    if (i < 0) return null;
    const restStart = i + PREFIX.length;
    let end = url.length;
    const q = url.indexOf('?', restStart);
    const h = url.indexOf('#', restStart);
    if (q >= 0) end = Math.min(end, q);
    if (h >= 0) end = Math.min(end, h);
    let rel: string;
    try {
        rel = decodeURIComponent(url.slice(restStart, end));
    } catch {
        return null;
    }
    return { head: url.slice(0, i), rel, tail: url.slice(end) };
}

/** The set's copy of `rel` as a URL keeping `head`/`tail`, or null. */
function setUrl(set: CustomizationSet, rel: string, head: string, tail: string): string | null {
    const actual = set.actualPath(rel);
    return actual === null ? null : head + customizationFileUrl(set.name, actual) + tail;
}

/**
 * The URL the original would load for install file `url` (an /assets/dwu/... URL, absolute or root-relative) with
 * the active theme: its customized copy when the original's rule picks one, else `url` unchanged. URLs already inside
 * Customization/, data files, and everything with no theme active are returned as given.
 */
export function themedAssetUrl(url: string): string {
    const set = activeCustomizationSet();
    if (set === null) return url;
    const parts = splitAssetUrl(url);
    if (parts === null) return url;
    const { head, rel, tail } = parts;
    if (tail.startsWith(STOCK_ASSET_QUERY)) return url;
    const lower = rel.toLowerCase();
    if (lower.startsWith('customization/')) return url;
    if (lower.startsWith('sounds/effects/')) {
        // EffectsPlayer.cs 112-118 / Start.cs method_5-6: the set's sounds\effects\<file> when it exists.
        return setUrl(set, rel, head, tail) ?? url;
    }
    if (!lower.startsWith('images/')) return url;
    if (BASE_ONLY.some((p) => lower.startsWith(p))) return url;
    if (lower.startsWith('images/ui/flagshapes/')) return url; // folder rule: themeFlagShapeFiles builds these URLs
    for (const [dir, rule] of FOLDER_RULES) {
        if (lower.startsWith(dir + '/')) {
            if (!rule(set, dir)) return url;
            return setUrl(set, rel, head, tail) ?? url;
        }
    }
    if (lower.startsWith('images/ui/chrome/')) {
        const file = rel.slice('images/ui/chrome/'.length);
        const fileLower = file.toLowerCase();
        if (file.includes('/')) return setUrl(set, rel, head, tail) ?? url;
        if (CHROME_RACE.has(fileLower)) {
            if (chromeRace !== '') {
                const raced = setUrl(set, `images/ui/chrome/${chromeRace}/${file}`, head, tail);
                if (raced !== null) return raced;
            }
            return setUrl(set, rel, head, tail) ?? url;
        }
        if (CHROME_NO_RACE.has(fileLower)) return setUrl(set, rel, head, tail) ?? url;
        return url; // chrome the original embeds (resx) rather than loading from images\ui\chrome
    }
    const cr = /^images\/ui\/(components\/component|resources\/resource)_(\d+)\.(png|bmp)$/i.exec(rel);
    if (cr !== null) {
        // LoadUiComponents / LoadUiResources: set .png, set .bmp, stock .png, stock .bmp.
        const stem = rel.slice(0, rel.length - 4);
        return setUrl(set, `${stem}.png`, head, tail) ?? setUrl(set, `${stem}.bmp`, head, tail) ?? url;
    }
    // method_10 / HabitatImageCache / BuiltObjectImageCache / CharacterImageCache / ColonyInvasion: per file.
    return setUrl(set, rel, head, tail) ?? url;
}

/**
 * Galaxy.4.cs LoadFlagShapes / LoadFlagShapesPirates (414 / 441): the set's images\ui\flagshapes[\pirate]\ folder
 * when it exists (Directory.Exists) else the stock one, every *.png, Array.Sort'ed. Returns the set's file URLs, or
 * null when no theme is active or the set has no such folder (the caller uses the stock list).
 */
export function themeFlagShapeUrls(pirate: boolean): string[] | null {
    const set = activeCustomizationSet();
    if (set === null) return null;
    const dir = pirate ? 'images/ui/flagshapes/pirate' : 'images/ui/flagshapes';
    if (!set.dirExists(dir)) return null;
    // Array.Sort(string[]) of full paths: the culture-sensitive default comparer.
    const files = set.listFiles(dir, '.png').sort(new Intl.Collator('en-US').compare);
    return files.map((f) => set.listedFileUrl(dir, f));
}

/**
 * Main.Part12.cs method_68 (1342): the set's sounds\music\ folder when it exists and holds an *.mp3 — then its
 * tracks REPLACE the stock list, the theme track being DistantWorldsTheme.mp3 if present else the first file — or
 * null (the stock folder).
 */
export function themeMusicFolder(): { files: string[]; urlOf: (file: string) => string; themeFile: string } | null {
    const set = activeCustomizationSet();
    if (set === null) return null;
    const dir = 'sounds/music';
    if (!set.dirExists(dir)) return null;
    const files = set.listFiles(dir, '.mp3');
    if (files.length === 0) return null;
    const themeFile = files.find((f) => f.toLowerCase() === 'distantworldstheme.mp3') ?? files[0];
    return { files, urlOf: (f) => set.listedFileUrl(dir, f), themeFile };
}

/**
 * A whole-folder art set chosen like the FOLDER_RULES above: the set's file names (Directory.GetFiles order) and a
 * URL builder when the set's folder qualifies, else null (the stock folder). `relDir` is relative to the install.
 */
export function themeArtFolder(relDir: string): { files: string[]; subfolders: string[]; urlOf: (file: string) => string } | null {
    const set = activeCustomizationSet();
    if (set === null) return null;
    const lower = relDir.toLowerCase().replace(/\/+$/, '');
    const rule = FOLDER_RULES.find(([d]) => d === lower)?.[1];
    if (rule === undefined || !rule(set, lower)) return null;
    return { files: set.listFiles(lower), subfolders: set.subfolders(lower), urlOf: (f) => set.listedFileUrl(lower, f) };
}

/** BaconStart.cs 23-40 InitializeMore: Customization\<set>\images\customBackgroundImage.jpg replaces the menu background. */
export function themeMenuBackgroundUrl(): string | null {
    return activeCustomizationSet()?.fileUrl('images/customBackgroundImage.jpg') ?? null;
}

/**
 * HabitatImageCache.cs GenerateHabitatImageFilepaths 334-343: with a theme whose images\environment\planets\other\
 * folder exists, its *.png (Directory.GetFiles order) follow the 665 fixed habitat pictures — Habitat.PictureRef
 * HabitatImageOffsetOTHER + i is the i-th (GalaxyImages.cs 35). The theme's file URLs, [] with no theme or no folder.
 * (The fixed pictures are themed per file, GetFilePathForImage: themedAssetUrl's default rule.)
 */
export function themeOtherPlanetUrls(): string[] {
    const set = activeCustomizationSet();
    if (set === null) return [];
    const dir = 'images/environment/planets/other';
    if (!set.dirExists(dir)) return [];
    return set.listFiles(dir, '.png').map((f) => set.listedFileUrl(dir, f));
}
