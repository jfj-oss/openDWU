// BaconSettings.txt: the DistantWorldsExpanded settings file in the install root, read by BaconMain.BaconInitialize
// once a game exists (Main.Part12.cs 3151 after a new game / load, Main.Part11.cs 2224 on resume). Pure: the caller
// passes the settings dictionary (ReadBaconSettings' result).
import { BACON_MOVEMENT_SETTINGS_DEFAULTS, baconMovementSettings } from './movement';

/**
 * The BaconSettings.txt keys baconInitializeSettings reads, as shipped in the stock install root (BaconMain.cs 1101
 * ReadBaconSettings: `KEY=VALUE`, value after the last '=' with ',' → '.'): BaconSettings.txt lines 11, 14, 22, 25, 29,
 * 137-139 (useStargates is absent from the file, so it keeps its class default).
 * TODO(port): read these from the loaded BaconSettings.txt once the sim data loader provides it (dataload), and pass that
 * dictionary to baconInitializeSettings instead of this constant.
 */
export const STOCK_BACON_SETTINGS: ReadonlyMap<string, string> = new Map([
    ['HyperJumpThreshhold', '4000'],
    ['BaseHyperJumpAccuracy', '666'],
    ['useStarGravityWells', 'false'],
    ['smallShipsJumpSooner', 'false'],
    ['sublightFuelBurnDivisor', '20'],
    ['noFuelCruiseSpeedMultiplier', '0.90'],
    ['noFuelTopSpeedMultiplier', '0.90'],
    ['noFuelHyperSpeedMultiplier', '0.50'],
]);

// .NET parsing helpers (whitespace allowed around the number, as NumberStyles.Integer / Float allow).
const INT_RE = /^\s*[+-]?\d+\s*$/;
const FLOAT_RE = /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/;

/** int.TryParse(value, out result). */
function tryParseInt(value: string): number | null {
    if (!INT_RE.test(value)) return null;
    const n = Number(value.trim());
    return n >= -2147483648 && n <= 2147483647 ? n : null;
}

/** float.TryParse(value, NumberStyles.Float, culture, out result) (invariant / en-US: '.' decimal point). */
function tryParseFloat(value: string): number | null {
    if (!FLOAT_RE.test(value)) return null;
    return Math.fround(Number(value.trim()));
}

/** `(value.Trim() == "true" || value == "false") && bool.TryParse(value, out result)` (TryParse trims, ignores case). */
function tryParseBoolSetting(value: string): boolean | null {
    if (!(value.trim() === 'true' || value === 'false')) return null;
    const t = value.trim().toLowerCase();
    return t === 'true' ? true : t === 'false' ? false : null;
}

/** Restores the class / Galaxy.InitializeStatics defaults (the state before BaconInitialize ever ran). */
export function resetBaconSettings(): void {
    Object.assign(baconMovementSettings, BACON_MOVEMENT_SETTINGS_DEFAULTS);
}

/**
 * Port of BaconMain.cs 551 BaconInitialize, settings part (605 `ReadBaconSettings()` and the TryGetValue blocks),
 * for the statics the movement / hyperjump / fuel code reads (movement.ts baconMovementSettings).
 * In the stock install this is what turns the Bacon star gravity wells off (BaconSettings.txt `useStarGravityWells=false`,
 * BaconMain.cs 618-625): without it every hyperjump first flies to the gravity-well edge at cruise speed
 * (BaconBuiltObject.cs 3746 SendShipTowardsEdgeOfGravityWell), ~200 game days for a starting explorer.
 *
 * TODO(port) BaconInitialize: the other keys (TroopGarrisonMinimumPerColony 614, priceReductionFactor 634,
 * fighterRangeMultiple 642 ... AllowPrivateShipAssigment 1056), Galaxy.MinimumHabitatPopulationAmount = 100 (558), the
 * stats files (559-600), AddOtherDelayedEvents (1075; RND: Galaxy.Rnd.Next(10, 12) not drawn), ModAllShips (1090),
 * BaconDesign.RedefineAllBases — BaconMain.cs 551-1073.
 */
export function baconInitializeSettings(dictionary: ReadonlyMap<string, string> = STOCK_BACON_SETTINGS): void {
    const s = baconMovementSettings;
    let value: string | undefined;
    let n: number | null;
    let b: boolean | null;
    // 606-613
    if ((value = dictionary.get('HyperJumpThreshhold')) !== undefined && (n = tryParseInt(value)) !== null) s.hyperJumpThreshhold = n;
    if ((value = dictionary.get('BaseHyperJumpAccuracy')) !== undefined && (n = tryParseInt(value)) !== null) s.baseHyperJumpAccuracy = n;
    // 618-633
    if ((value = dictionary.get('useStarGravityWells')) !== undefined && (b = tryParseBoolSetting(value)) !== null) s.useStarGravityWells = b;
    if ((value = dictionary.get('smallShipsJumpSooner')) !== undefined && (b = tryParseBoolSetting(value)) !== null) s.smallShipsJumpSooner = b;
    // 638-641
    if ((value = dictionary.get('sublightFuelBurnDivisor')) !== undefined && (n = tryParseFloat(value)) !== null) s.sublightFuelBurnDivisor = n;
    // 859-874: clamped to [0.1f, 1f]; top speed at least the cruise multiplier.
    if ((value = dictionary.get('noFuelCruiseSpeedMultiplier')) !== undefined && (n = tryParseFloat(value)) !== null) {
        s.noFuelCruiseSpeedMultiplier = Math.min(Math.max(n, Math.fround(0.1)), 1);
    }
    if ((value = dictionary.get('noFuelTopSpeedMultiplier')) !== undefined && (n = tryParseFloat(value)) !== null) {
        s.noFuelTopSpeedMultiplier = Math.min(Math.max(n, Math.fround(0.1)), 1);
        if (s.noFuelTopSpeedMultiplier < s.noFuelCruiseSpeedMultiplier) s.noFuelTopSpeedMultiplier = s.noFuelCruiseSpeedMultiplier;
    }
    if ((value = dictionary.get('noFuelHyperSpeedMultiplier')) !== undefined && (n = tryParseFloat(value)) !== null) {
        s.noFuelHyperSpeedMultiplier = Math.min(Math.max(n, Math.fround(0.1)), 1);
    }
    // 979-986
    if ((value = dictionary.get('useStargates')) !== undefined && (b = tryParseBoolSetting(value)) !== null) s.useStargates = b;
}
