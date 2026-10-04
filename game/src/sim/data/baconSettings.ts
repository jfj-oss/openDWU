// BaconSettings.txt: the Bacon mod's KEY=VALUE settings file in the install root.
//
// Port of BaconMain.cs 1101 ReadBaconSettings (the reader) and the settings half of BaconMain.cs 551
// BaconInitialize (605-1062: one TryGetValue + TryParse per key, written to a static field). The C# fields are
// process-wide statics with class defaults (Galaxy.3.cs InitializeStatics for the Galaxy.* ones); BaconInitialize
// runs when a created or loaded game starts running (Main.Part7.cs 2190 / Part11.cs 2224 / Part12.cs 3151), i.e.
// after the galaxy is generated. On a fresh launch the first galaxy is therefore generated with the class defaults and
// the file's values apply from game start on; sim/baconSettings.ts (baconInitializeSettings) models exactly that for every game.
//
// Pure parsing, no I/O: gameData.ts fetches the file (/assets/dwu/BaconSettings.txt; a missing file leaves every
// field at its C# default, as the C# FileNotFoundException catch does).
//
// Number parsing follows .NET Framework on an en-US machine:
// - int / short / long.TryParse(value): NumberStyles.Integer (surrounding white space, one leading sign, digits only;
//   out of range → false). "10F" (the shipped pirateFortressTroops line) fails, so the default (12) stays.
// - float / double.TryParse(value, NumberStyles.Float, InvariantCulture): white space, sign, digits with an optional
//   '.' and exponent; no thousands separators. A float value assigned to a double field keeps the float rounding
//   (e.g. shipMarkupFactor=9 → 9.0, spyCaptureChance=0.3 → Math.fround(0.3)).
// - The noFuel*SpeedMultiplier keys use CultureInfo.CurrentUICulture in the C#; taken as invariant here (en-US).
// - bool: `value.Trim() == "true" || value == "false"` gate, then bool.TryParse (trims, case-insensitive), so
//   "true " is accepted but " false" and "True" are not.
// - European decimal commas: ReadBaconSettings replaces every ',' in a value with '.', so "0,25" reads as 0.25 (and
//   "1,000" becomes "1.000", which int.TryParse rejects and float.TryParse reads as 1.0). The file's own comment
//   telling European users to write commas predates that replacement; either spelling parses the same way here.

const f = Math.fround;

/** Every static BaconInitialize assigns from BaconSettings.txt, at its C# default (field name = C# field name). */
export interface BaconSettings {
    /** Galaxy.HyperJumpThreshhold (int, Galaxy.3.cs 4971). Key HyperJumpThreshhold. */
    hyperJumpThreshhold: number;
    /** Galaxy.BaseHyperJumpAccuracy (double, 4972; the C# parses it with int.TryParse). Key BaseHyperJumpAccuracy. */
    baseHyperJumpAccuracy: number;
    /**
     * Galaxy.IndependentEmpire.Policy.TroopGarrisonMinimumPerColony (int). Not a static: null when the key is absent or
     * does not parse, and the independent empire's policy keeps its own value. Key TroopGarrisonMinimumPerColony.
     */
    troopGarrisonMinimumPerColony: number | null;
    /** BaconBuiltObject.useStarGravityWells (bool, BaconBuiltObject.cs 49). */
    useStarGravityWells: boolean;
    /** BaconBuiltObject.smallShipsJumpSooner (bool, 50). */
    smallShipsJumpSooner: boolean;
    /** BaconGalaxy.priceReductionFactor (int, BaconGalaxy.cs 17). */
    priceReductionFactor: number;
    /** BaconBuiltObject.sublightFuelBurnDivisor (float, 51). */
    sublightFuelBurnDivisor: number;
    /** BaconFighter.fighterRangeMultiple (double, BaconFighter.cs 19). */
    fighterRangeMultiple: number;
    /** BaconFighter.ammoExhaustChanceMissile (float, 22). */
    ammoExhaustChanceMissile: number;
    /** BaconFighter.ammoExhaustChanceTorpedo (float, 23). */
    ammoExhaustChanceTorpedo: number;
    /** BaconFighter.fighterBuildCost (int, 25). */
    fighterBuildCost: number;
    /** BaconFighter.fighterBuildSpeedDivisor (float, 24). */
    fighterBuildSpeedDivisor: number;
    /** BaconInfoPanel.shadow (bool, BaconInfoPanel.cs 21; UI). Key Shadow. */
    shadow: boolean;
    /** BaconMain.saveStats (bool, BaconMain.cs 30). */
    saveStats: boolean;
    /** BaconMain.statSaveIntervalInGameDays (short, 32; at least 10). Key saveInterval. */
    statSaveIntervalInGameDays: number;
    /** BaconEmpire.researchPerLab (float field, int.TryParse; BaconEmpire.cs 23). */
    researchPerLab: number;
    /** BaconFighter.fighterOnBomberDamageMultiplier (float, 26). Key fighterOnBomberViolence. */
    fighterOnBomberDamageMultiplier: number;
    /** BaconMain.backgroundStarsAtZoomLevel (double, 34; UI). */
    backgroundStarsAtZoomLevel: number;
    /** BaconStart.lowStarCount (int, BaconStart.cs 20; clamped to 10..100). */
    lowStarCount: number;
    /** BaconHabitat.alwaysShowAsteroidColonies (bool, BaconHabitat.cs 22; UI). */
    alwaysShowAsteroidColonies: boolean;
    /** BaconHabitat.allowAsteroidColonies (bool, 23). */
    allowAsteroidColonies: boolean;
    /** BaconHabitat.asteroidColonyCost (int, 25). */
    asteroidColonyCost: number;
    /** BaconBuiltObject.scientificDataForResourceSurvey (int, 58). */
    scientificDataForResourceSurvey: number;
    /** BaconBuiltObject.scientificDataForRuins (int, 59). */
    scientificDataForRuins: number;
    /** BaconGalaxy.tradeEverything (bool, BaconGalaxy.cs 18). */
    tradeEverything: boolean;
    /** Galaxy.ShipMaintenanceCostPerSizeUnit (double, Galaxy.3.cs 5084; float.TryParse). Key shipMaintenanceCostPerSizeUnit. */
    shipMaintenanceCostPerSizeUnit: number;
    /** Galaxy.ShipMarkupFactor (double, 5070; float.TryParse). Key shipMarkupFactor. */
    shipMarkupFactor: number;
    /** Galaxy.ShipMarkupFactorPirates (double, 5071; float.TryParse). Key shipMarkupFactorPirates. */
    shipMarkupFactorPirates: number;
    /** Galaxy.WarWearinessMaximum (double, 5107; float.TryParse). Key warWearinessMax. */
    warWearinessMaximum: number;
    /** BaconHabitat.asteroidColonyPrevalenceDivisor (float, 26). */
    asteroidColonyPrevalenceDivisor: number;
    /** BaconStart.lowIndependentLifeValue (int, BaconStart.cs 21). */
    lowIndependentLifeValue: number;
    /** BaconEmpire.warWearinessReduction (int, BaconEmpire.cs 24). */
    warWearinessReduction: number;
    /** BaconCharacter.spyCaptureChance (float, BaconCharacter.cs 18). */
    spyCaptureChance: number;
    /** BaconCharacter.spyBaseEscapeChance (double, 20; float.TryParse). Key capturedSpyEscapeChance. */
    spyBaseEscapeChance: number;
    /** BaconCharacter.spyBaseDefectChance (double, 21; float.TryParse). Key capturedSpyDefectChance. */
    spyBaseDefectChance: number;
    /** BaconCharacter.spyBaseValue (int, 19). */
    spyBaseValue: number;
    /** BaconMain.tradeTax (double, BaconMain.cs 74; planetCargoDataForm UI). */
    tradeTax: number;
    /** BaconEmpire.SubjugationTributePercentage and Galaxy.SubjugationTributePercentage (double, 0.1). */
    subjugationTributePercentage: number;
    /** BaconBuiltObject.weaponRangeMultiplierForBases (float, 55). */
    weaponRangeMultiplierForBases: number;
    /** BaconHabitat.allowInfrastructureImprovements (bool, 24). */
    allowInfrastructureImprovements: boolean;
    /** BaconHabitat.infrastructureSpendingPerDevelopmentLevel (int, 27; at least 10000). */
    infrastructureSpendingPerDevelopmentLevel: number;
    /** BaconHabitat.maxInfrastructureInvestmentAllowed (int, 28; at least 10000). */
    maxInfrastructureInvestmentAllowed: number;
    /** BaconHabitat.infrasetuctureDurability (float, 29; clamped to 0.1..1). Key infrastuctureDurability. */
    infrasetuctureDurability: number;
    /** BaconHabitat.marketPriceUpdateChance (double, 31). */
    marketPriceUpdateChance: number;
    /** BaconMain.maximumResourceLevelToStockAtBaseNotAtColony (int, 90). */
    maximumResourceLevelToStockAtBaseNotAtColony: number;
    /** BaconBuiltObject.noFuelCruiseSpeedMultiplier (float, 52; clamped to 0.1..1). */
    noFuelCruiseSpeedMultiplier: number;
    /** BaconBuiltObject.noFuelTopSpeedMultiplier (float, 53; clamped to 0.1..1, then at least the cruise one). */
    noFuelTopSpeedMultiplier: number;
    /** BaconBuiltObject.noFuelHyperSpeedMultiplier (float, 54; clamped to 0.1..1). */
    noFuelHyperSpeedMultiplier: number;
    /** BaconHabitat.pirateControlLevelToBuildShipsAtIndependentPlanets (float, 33; clamped to 0.1..1). */
    pirateControlLevelToBuildShipsAtIndependentPlanets: number;
    /** BaconBuiltObject.shipFreeRepairTimeFromCrewSkill* (int, 66-70). */
    shipFreeRepairTimeFromCrewSkillAverage: number;
    shipFreeRepairTimeFromCrewSkillExperienced: number;
    shipFreeRepairTimeFromCrewSkillVeteran: number;
    shipFreeRepairTimeFromCrewSkillElite: number;
    shipFreeRepairTimeFromCrewSkillLegendary: number;
    /** BaconBuiltObject.fighterBayLabel / bomberBayLabel / mixedBayLabel (string, 71-73; lower-cased). */
    fighterBayLabel: string;
    bomberBayLabel: string;
    mixedBayLabel: string;
    /** BaconBuiltObject.pointDefenseAffectsMissiles (bool, 74). */
    pointDefenseAffectsMissiles: boolean;
    /** BaconBuiltObject.orbitalAsteroidCost (int, 76; player UI action). */
    orbitalAsteroidCost: number;
    /** BaconBuiltObject.privateBuildCostToStateMoney (double, 77; clamped to 0..1). */
    privateBuildCostToStateMoney: number;
    /** BaconHabitat.addSalesTax (bool, 32; planetCargoDataForm UI). */
    addSalesTax: boolean;
    /** BaconMain.newIDCost / baseShipOfficerCost / componentEquipCost (int, 76-80; player UI actions). */
    newIDCost: number;
    baseShipOfficerCost: number;
    componentEquipCost: number;
    /** BaconMain.invasionStrategyResult (float, 96; InvasionCommandForm UI). */
    invasionStrategyResult: number;
    /** BaconMain.invasionStrategyRemainingGuesses (float, 98; at least 0; UI). */
    invasionStrategyRemainingGuesses: number;
    /** BaconMain.useInvasionModifierReputation (bool, 100). */
    useInvasionModifierReputation: boolean;
    /** BaconMain.quartersOfCashAvailable (int, 102). */
    quartersOfCashAvailable: number;
    /** BaconBuiltObject.limitNewFighterBuildToColonies (bool, 75). */
    limitNewFighterBuildToColonies: boolean;
    /** BaconBuiltObject.tailGunnerResearch (string, 79). Key tailGunnerReasearch. */
    tailGunnerResearch: string;
    /** BaconMain.useStargates (bool, 82). */
    useStargates: boolean;
    /** BaconHabitat.pirateBaseTroops / pirateFortressTroops / pirateCriminalNetworkTroops (int, 34-36). */
    pirateBaseTroops: number;
    pirateFortressTroops: number;
    pirateCriminalNetworkTroops: number;
    /** BaconMain.drawWeaponRangeCircles / minZoomLevelForWeaponsCircles (46-48; UI). Key showRangeCircles. */
    drawWeaponRangeCircles: boolean;
    minZoomLevelForWeaponsCircles: number;
    /** BaconHabitat.pirateMaxPopulationInfluence (long, 37). */
    pirateMaxPopulationInfluence: number;
    /** BaconMain.customDifficulty* (double, 104-120; clamped to 0.01..10; used only by the !setdifficulty command). */
    customDifficultyColonyCorruptionFactor: number;
    customDifficultyWarWearinessFactor: number;
    customDifficultyResearchRate: number;
    customDifficultyPopulationGrowthRate: number;
    customDifficultyMiningRate: number;
    customDifficultyTargettingFactor: number;
    customDifficultyCountermeasuresFactor: number;
    customDifficultyColonyShipBuildSpeedRate: number;
    customDifficultyColonyIncomeFactor: number;
    /** BaconBuiltObject.AllowPrivateShipAssigment (bool, 84; player UI). */
    allowPrivateShipAssigment: boolean;
}

/** The C# class / InitializeStatics defaults (what every field holds when BaconSettings.txt is missing). */
export function defaultBaconSettings(): BaconSettings {
    return {
        hyperJumpThreshhold: 12000,
        baseHyperJumpAccuracy: 3000.0,
        troopGarrisonMinimumPerColony: null,
        useStarGravityWells: true,
        smallShipsJumpSooner: false,
        priceReductionFactor: 1,
        sublightFuelBurnDivisor: f(1),
        fighterRangeMultiple: 1.0,
        ammoExhaustChanceMissile: f(0.2),
        ammoExhaustChanceTorpedo: f(0.25),
        fighterBuildCost: 0,
        fighterBuildSpeedDivisor: f(2),
        shadow: true,
        saveStats: true,
        statSaveIntervalInGameDays: 90,
        researchPerLab: f(0),
        fighterOnBomberDamageMultiplier: f(1),
        backgroundStarsAtZoomLevel: 300.0,
        lowStarCount: 100,
        alwaysShowAsteroidColonies: true,
        allowAsteroidColonies: false,
        asteroidColonyCost: 50000,
        scientificDataForResourceSurvey: 3,
        scientificDataForRuins: 90,
        tradeEverything: false,
        shipMaintenanceCostPerSizeUnit: 1.0,
        shipMarkupFactor: 5.0,
        shipMarkupFactorPirates: 2.5,
        warWearinessMaximum: 40.0,
        asteroidColonyPrevalenceDivisor: f(100),
        lowIndependentLifeValue: 150,
        warWearinessReduction: -2,
        spyCaptureChance: f(1),
        spyBaseEscapeChance: 0.02,
        spyBaseDefectChance: 0.02,
        spyBaseValue: 25000,
        tradeTax: 0.1,
        subjugationTributePercentage: 0.1,
        weaponRangeMultiplierForBases: f(1),
        allowInfrastructureImprovements: false,
        infrastructureSpendingPerDevelopmentLevel: 50000,
        maxInfrastructureInvestmentAllowed: 1000000,
        infrasetuctureDurability: f(0.9),
        marketPriceUpdateChance: 1.0,
        maximumResourceLevelToStockAtBaseNotAtColony: 50,
        noFuelCruiseSpeedMultiplier: f(0.33),
        noFuelTopSpeedMultiplier: f(0.33),
        noFuelHyperSpeedMultiplier: f(0.33),
        pirateControlLevelToBuildShipsAtIndependentPlanets: f(0.9),
        shipFreeRepairTimeFromCrewSkillAverage: 160,
        shipFreeRepairTimeFromCrewSkillExperienced: 120,
        shipFreeRepairTimeFromCrewSkillVeteran: 80,
        shipFreeRepairTimeFromCrewSkillElite: 40,
        shipFreeRepairTimeFromCrewSkillLegendary: 20,
        fighterBayLabel: 'fighter',
        bomberBayLabel: 'bomber',
        mixedBayLabel: 'assault',
        pointDefenseAffectsMissiles: true,
        orbitalAsteroidCost: 10000,
        privateBuildCostToStateMoney: 1.0,
        addSalesTax: true,
        newIDCost: 10000,
        baseShipOfficerCost: 5000,
        componentEquipCost: 1000,
        invasionStrategyResult: f(1.5),
        invasionStrategyRemainingGuesses: f(0.1),
        useInvasionModifierReputation: true,
        quartersOfCashAvailable: 4,
        limitNewFighterBuildToColonies: false,
        tailGunnerResearch: 'Point Defense Weapons',
        useStargates: false,
        pirateBaseTroops: 7,
        pirateFortressTroops: 12,
        pirateCriminalNetworkTroops: 18,
        drawWeaponRangeCircles: true,
        minZoomLevelForWeaponsCircles: 0.9,
        pirateMaxPopulationInfluence: 1500000000,
        customDifficultyColonyCorruptionFactor: 1.0,
        customDifficultyWarWearinessFactor: 1.0,
        customDifficultyResearchRate: 1.0,
        customDifficultyPopulationGrowthRate: 1.0,
        customDifficultyMiningRate: 1.0,
        customDifficultyTargettingFactor: 1.0,
        customDifficultyCountermeasuresFactor: 1.0,
        customDifficultyColonyShipBuildSpeedRate: 1.0,
        customDifficultyColonyIncomeFactor: 1.0,
        allowPrivateShipAssigment: false,
    };
}

/**
 * BaconMain.cs 1101 ReadBaconSettings(): each line (StreamReader.ReadLine: split on \r\n, \r or \n) that does not start
 * with "//" and is not empty becomes `dictionary.Add(parts[0], parts[last].Replace(',', '.'))` of `line.Split('=')` — no
 * trimming, "a=b=c" is (a, c), a line without '=' is (line, line). A repeated key makes Dictionary.Add throw; the catch
 * (Exception) swallows it and the entries read so far are returned (reading stops there). `text` null = file missing.
 */
export function readBaconSettings(text: string | null): Map<string, string> {
    const dictionary = new Map<string, string>();
    if (text === null) return dictionary;
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // StreamReader drops the byte-order mark.
    const lines = text.split(/\r\n|\r|\n/);
    // ReadLine returns null after the last line terminator: a trailing "" from split is not a line.
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    for (const line of lines) {
        if (line.startsWith('//') || line === '') continue;
        const array = line.split('=');
        const key = array[0];
        const value = array[array.length - 1].replace(/,/g, '.');
        if (dictionary.has(key)) break; // Dictionary.Add ArgumentException → catch → return what was read.
        dictionary.set(key, value);
    }
    return dictionary;
}

// .NET white space for number parsing (Char.IsWhiteSpace subset the Number parser trims: U+0009-U+000D, U+0020).
const WS = '[\\t\\n\\v\\f\\r ]*';
const INTEGER_RE = new RegExp(`^${WS}([+-]?)([0-9]+)${WS}$`);
const FLOAT_RE = new RegExp(`^${WS}([+-]?(?:[0-9]+\\.?[0-9]*|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?)${WS}$`);

function tryParseInteger(value: string, min: number, max: number): number | null {
    const m = INTEGER_RE.exec(value);
    if (m === null) return null;
    const big = BigInt((m[1] === '-' ? '-' : '') + m[2]);
    if (big < BigInt(min) || big > BigInt(max)) return null;
    return Number(big);
}

/** int.TryParse(value, out result) (Int32, NumberStyles.Integer). */
export function csTryParseInt(value: string): number | null {
    return tryParseInteger(value, -2147483648, 2147483647);
}
/** short.TryParse. */
function csTryParseShort(value: string): number | null {
    return tryParseInteger(value, -32768, 32767);
}
/** long.TryParse (Int64; values beyond 2^53 lose precision as JS numbers). */
function csTryParseLong(value: string): number | null {
    const m = INTEGER_RE.exec(value);
    if (m === null) return null;
    const big = BigInt((m[1] === '-' ? '-' : '') + m[2]);
    if (big < -9223372036854775808n || big > 9223372036854775807n) return null;
    return Number(big);
}

/**
 * double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture): the invariant "Infinity" / "-Infinity" /
 * "NaN" symbols parse (after trimming); a numeric overflow fails (.NET Framework).
 */
export function csTryParseDouble(value: string): number | null {
    const m = FLOAT_RE.exec(value);
    if (m === null) {
        const t = value.trim();
        if (t === 'Infinity') return Infinity;
        if (t === '-Infinity') return -Infinity;
        if (t === 'NaN') return NaN;
        return null;
    }
    const d = Number(m[1]);
    return Number.isFinite(d) ? d : null;
}

/** float.TryParse(..., NumberStyles.Float, InvariantCulture): as double, then (float); a float overflow fails. */
export function csTryParseFloat(value: string): number | null {
    const d = csTryParseDouble(value);
    if (d === null) return null;
    const r = f(d);
    if (!Number.isFinite(r) && Number.isFinite(d)) return null;
    return r;
}

/** `value.Trim() == "true" || value == "false"` then bool.TryParse(value) (BaconMain.cs 618 and every bool key). */
function tryParseBaconBool(value: string): boolean | null {
    if (!(value.trim() === 'true' || value === 'false')) return null;
    const t = value.trim().toLowerCase();
    if (t === 'true') return true;
    if (t === 'false') return false;
    return null;
}

/**
 * BaconMain.cs 605-1062 (the settings half of BaconInitialize): starting from the C# defaults, each key present in
 * ReadBaconSettings' dictionary whose value parses overwrites its field, with the C# clamps. `text` null = no file.
 */
export function parseBaconSettings(text: string | null): BaconSettings {
    const s = defaultBaconSettings();
    const d = readBaconSettings(text);
    const get = (key: string): string | undefined => d.get(key);
    const int = (key: string, set: (v: number) => void): void => {
        const v = get(key);
        if (v === undefined) return;
        const r = csTryParseInt(v);
        if (r !== null) set(r);
    };
    const flt = (key: string, set: (v: number) => void): void => {
        const v = get(key);
        if (v === undefined) return;
        const r = csTryParseFloat(v);
        if (r !== null) set(r);
    };
    const dbl = (key: string, set: (v: number) => void): void => {
        const v = get(key);
        if (v === undefined) return;
        const r = csTryParseDouble(v);
        if (r !== null) set(r);
    };
    const bool = (key: string, set: (v: boolean) => void): void => {
        const v = get(key);
        if (v === undefined) return;
        const r = tryParseBaconBool(v);
        if (r !== null) set(r);
    };
    const fMin = (a: number, b: number) => (a < b ? a : b);
    const fMax = (a: number, b: number) => (a > b ? a : b);
    const clampF01 = (v: number) => fMin(fMax(v, f(0.1)), f(1)); // Math.Min(Math.Max(v, 0.1f), 1f)
    const clampDifficulty = (v: number) => Math.max(0.01, Math.min(10.0, v));

    int('HyperJumpThreshhold', (v) => (s.hyperJumpThreshhold = v)); // 606
    int('BaseHyperJumpAccuracy', (v) => (s.baseHyperJumpAccuracy = v)); // 610
    int('TroopGarrisonMinimumPerColony', (v) => (s.troopGarrisonMinimumPerColony = v)); // 614
    bool('useStarGravityWells', (v) => (s.useStarGravityWells = v)); // 618
    bool('smallShipsJumpSooner', (v) => (s.smallShipsJumpSooner = v)); // 626
    int('priceReductionFactor', (v) => (s.priceReductionFactor = v)); // 634
    flt('sublightFuelBurnDivisor', (v) => (s.sublightFuelBurnDivisor = v)); // 638
    dbl('fighterRangeMultiple', (v) => (s.fighterRangeMultiple = v)); // 642
    flt('ammoExhaustChanceMissile', (v) => (s.ammoExhaustChanceMissile = v)); // 646
    flt('ammoExhaustChanceTorpedo', (v) => (s.ammoExhaustChanceTorpedo = v)); // 650
    int('fighterBuildCost', (v) => (s.fighterBuildCost = v)); // 654
    flt('fighterBuildSpeedDivisor', (v) => (s.fighterBuildSpeedDivisor = v)); // 658
    bool('Shadow', (v) => (s.shadow = v)); // 662
    bool('saveStats', (v) => (s.saveStats = v)); // 670
    {
        // 678: short.TryParse, at least 10.
        const v = get('saveInterval');
        const r = v === undefined ? null : csTryParseShort(v);
        if (r !== null) s.statSaveIntervalInGameDays = r < 10 ? 10 : r;
    }
    int('researchPerLab', (v) => (s.researchPerLab = f(v))); // 700
    flt('fighterOnBomberViolence', (v) => (s.fighterOnBomberDamageMultiplier = v)); // 718
    dbl('backgroundStarsAtZoomLevel', (v) => (s.backgroundStarsAtZoomLevel = v)); // 722
    int('lowStarCount', (v) => (s.lowStarCount = Math.max(Math.min(100, v), 10))); // 726
    bool('alwaysShowAsteroidColonies', (v) => (s.alwaysShowAsteroidColonies = v)); // 730
    bool('allowAsteroidColonies', (v) => (s.allowAsteroidColonies = v)); // 738
    int('asteroidColonyCost', (v) => (s.asteroidColonyCost = v)); // 746
    int('scientificDataForResourceSurvey', (v) => (s.scientificDataForResourceSurvey = v)); // 750
    int('scientificDataForRuins', (v) => (s.scientificDataForRuins = v)); // 754
    bool('tradeEverything', (v) => (s.tradeEverything = v)); // 758
    flt('shipMaintenanceCostPerSizeUnit', (v) => (s.shipMaintenanceCostPerSizeUnit = v)); // 766
    flt('shipMarkupFactor', (v) => (s.shipMarkupFactor = v)); // 770
    flt('shipMarkupFactorPirates', (v) => (s.shipMarkupFactorPirates = v)); // 774
    flt('warWearinessMax', (v) => (s.warWearinessMaximum = v)); // 778
    flt('asteroidColonyPrevalenceDivisor', (v) => (s.asteroidColonyPrevalenceDivisor = v)); // 782
    int('lowIndependentLifeValue', (v) => (s.lowIndependentLifeValue = v)); // 786
    int('warWearinessReduction', (v) => (s.warWearinessReduction = v)); // 790
    flt('spyCaptureChance', (v) => (s.spyCaptureChance = v)); // 794
    flt('capturedSpyEscapeChance', (v) => (s.spyBaseEscapeChance = v)); // 798
    flt('capturedSpyDefectChance', (v) => (s.spyBaseDefectChance = v)); // 802
    int('spyBaseValue', (v) => (s.spyBaseValue = v)); // 806
    dbl('tradeTax', (v) => (s.tradeTax = v)); // 810
    dbl('SubjugationTributePercentage', (v) => (s.subjugationTributePercentage = v)); // 814
    flt('weaponRangeMultiplierForBases', (v) => (s.weaponRangeMultiplierForBases = v)); // 819
    bool('allowInfrastructureImprovements', (v) => (s.allowInfrastructureImprovements = v)); // 823
    int('infrastructureSpendingPerDevelopmentLevel', (v) => (s.infrastructureSpendingPerDevelopmentLevel = v < 10000 ? 10000 : v)); // 831
    int('maxInfrastructureInvestmentAllowed', (v) => (s.maxInfrastructureInvestmentAllowed = v < 10000 ? 10000 : v)); // 839
    flt('infrastuctureDurability', (v) => (s.infrasetuctureDurability = clampF01(v))); // 847
    dbl('marketPriceUpdateChance', (v) => (s.marketPriceUpdateChance = v)); // 851
    int('maximumResourceLevelToStockAtBaseNotAtColony', (v) => (s.maximumResourceLevelToStockAtBaseNotAtColony = v)); // 855
    flt('noFuelCruiseSpeedMultiplier', (v) => (s.noFuelCruiseSpeedMultiplier = clampF01(v))); // 859
    flt('noFuelTopSpeedMultiplier', (v) => { // 863
        // 863-870: clamped, then never below the cruise multiplier (as read so far).
        s.noFuelTopSpeedMultiplier = clampF01(v);
        if (s.noFuelTopSpeedMultiplier < s.noFuelCruiseSpeedMultiplier) s.noFuelTopSpeedMultiplier = s.noFuelCruiseSpeedMultiplier;
    });
    flt('noFuelHyperSpeedMultiplier', (v) => (s.noFuelHyperSpeedMultiplier = clampF01(v))); // 871
    flt('pirateControlLevelToBuildShipsAtIndependentPlanets', (v) => (s.pirateControlLevelToBuildShipsAtIndependentPlanets = clampF01(v))); // 875
    int('shipFreeRepairTimeFromCrewSkillAverage', (v) => (s.shipFreeRepairTimeFromCrewSkillAverage = v)); // 879
    int('shipFreeRepairTimeFromCrewSkillExperienced', (v) => (s.shipFreeRepairTimeFromCrewSkillExperienced = v)); // 883
    int('shipFreeRepairTimeFromCrewSkillVeteran', (v) => (s.shipFreeRepairTimeFromCrewSkillVeteran = v)); // 887
    int('shipFreeRepairTimeFromCrewSkillElite', (v) => (s.shipFreeRepairTimeFromCrewSkillElite = v)); // 891
    int('shipFreeRepairTimeFromCrewSkillLegendary', (v) => (s.shipFreeRepairTimeFromCrewSkillLegendary = v)); // 895
    // 899-910: the bay labels are taken as-is (lower-cased), no parse.
    const fighterBayLabel = get('fighterBayLabel');
    if (fighterBayLabel !== undefined) s.fighterBayLabel = fighterBayLabel.toLowerCase();
    const bomberBayLabel = get('bomberBayLabel');
    if (bomberBayLabel !== undefined) s.bomberBayLabel = bomberBayLabel.toLowerCase();
    const mixedBayLabel = get('mixedBayLabel');
    if (mixedBayLabel !== undefined) s.mixedBayLabel = mixedBayLabel.toLowerCase();
    bool('pointDefenseAffectsMissiles', (v) => (s.pointDefenseAffectsMissiles = v)); // 911
    int('orbitalAsteroidCost', (v) => (s.orbitalAsteroidCost = v)); // 919
    dbl('privateBuildCostToStateMoney', (v) => (s.privateBuildCostToStateMoney = Math.max(0.0, Math.min(1.0, v)))); // 923
    bool('addSalesTax', (v) => (s.addSalesTax = v)); // 927
    int('newIDCost', (v) => (s.newIDCost = v)); // 935
    int('baseShipOfficerCost', (v) => (s.baseShipOfficerCost = v)); // 939
    int('componentEquipCost', (v) => (s.componentEquipCost = v)); // 943
    flt('invasionStrategyResult', (v) => (s.invasionStrategyResult = v)); // 947
    flt('invasionStrategyRemainingGuesses', (v) => (s.invasionStrategyRemainingGuesses = fMax(0, v))); // 951
    bool('useInvasionModifierReputation', (v) => (s.useInvasionModifierReputation = v)); // 955
    int('quartersOfCashAvailable', (v) => (s.quartersOfCashAvailable = v)); // 963
    bool('limitNewFighterBuildToColonies', (v) => (s.limitNewFighterBuildToColonies = v)); // 967
    const tailGunner = get('tailGunnerReasearch'); // 975 (sic)
    if (tailGunner !== undefined) s.tailGunnerResearch = tailGunner;
    bool('useStargates', (v) => (s.useStargates = v)); // 979
    int('pirateBaseTroops', (v) => (s.pirateBaseTroops = v)); // 987
    int('pirateFortressTroops', (v) => (s.pirateFortressTroops = v)); // 991
    int('pirateCriminalNetworkTroops', (v) => (s.pirateCriminalNetworkTroops = v)); // 995
    bool('showRangeCircles', (v) => { // 999
        // 999-1015
        s.drawWeaponRangeCircles = v;
        s.minZoomLevelForWeaponsCircles = v ? 0.9 : 5.0;
    });
    {
        // 1016: long.TryParse.
        const v = get('pirateMaxPopulationInfluence');
        const r = v === undefined ? null : csTryParseLong(v);
        if (r !== null) s.pirateMaxPopulationInfluence = r;
    }
    dbl('customDifficultyColonyCorruptionFactor', (v) => (s.customDifficultyColonyCorruptionFactor = clampDifficulty(v))); // 1020
    dbl('customDifficultyWarWearinessFactor', (v) => (s.customDifficultyWarWearinessFactor = clampDifficulty(v))); // 1024
    dbl('customDifficultyResearchRate', (v) => (s.customDifficultyResearchRate = clampDifficulty(v))); // 1028
    dbl('customDifficultyPopulationGrowthRate', (v) => (s.customDifficultyPopulationGrowthRate = clampDifficulty(v))); // 1032
    dbl('customDifficultyMiningRate', (v) => (s.customDifficultyMiningRate = clampDifficulty(v))); // 1036
    dbl('customDifficultyTargettingFactor', (v) => (s.customDifficultyTargettingFactor = clampDifficulty(v))); // 1040
    dbl('customDifficultyCountermeasuresFactor', (v) => (s.customDifficultyCountermeasuresFactor = clampDifficulty(v))); // 1044
    dbl('customDifficultyColonyShipBuildSpeedRate', (v) => (s.customDifficultyColonyShipBuildSpeedRate = clampDifficulty(v))); // 1048
    dbl('customDifficultyColonyIncomeFactor', (v) => (s.customDifficultyColonyIncomeFactor = clampDifficulty(v))); // 1052
    bool('AllowPrivateShipAssigment', (v) => (s.allowPrivateShipAssigment = v)); // 1056
    return s;
}

/**
 * The settings the running sim reads (the C# statics). Starts at the C# defaults; sim/baconInitialize.ts resets it at
 * galaxy generation and overwrites it at game start. Read fields at use time (never copy them into module constants).
 */
export const baconSettings: BaconSettings = defaultBaconSettings();

/** Overwrite every field of the live `baconSettings` (the C# assigns the statics one by one). */
export function setBaconSettings(settings: BaconSettings): void {
    Object.assign(baconSettings, settings);
}

// ---------------------------------------------------------------------------------------------------------------------
// Per-game settings (ours; the C# has one process-wide set of statics read from the install's file). A game stores the
// keys it changed (Galaxy.baconSettingsOverrides, only those that differ from the install's BaconSettings.txt) and the
// in-game Bacon Mod Settings window changes them with the journaled setBaconSettings command (sim/baconSettings.ts).
// ---------------------------------------------------------------------------------------------------------------------

/** How a field is parsed in BaconInitialize (605-1062): the TryParse used and the clamp applied after it. */
export type BaconSettingType = 'int' | 'intOrNull' | 'short' | 'long' | 'float' | 'double' | 'bool' | 'string' | 'derived';

export interface BaconSettingField {
    /** The BaconSettings.txt key (BaconMain.cs TryGetValue name). */
    fileKey: string;
    type: BaconSettingType;
    min?: number;
    max?: number;
    /** The C# lower-cases the value (the bay labels, 899-910). */
    lowerCase?: boolean;
}

const fld = (fileKey: string, type: BaconSettingType, min?: number, max?: number): BaconSettingField => ({ fileKey, type, min, max });
const F01: [number, number] = [f(0.1), f(1)];

/** Every BaconSettings field, in BaconInitialize order, with its file key, parse type and clamps (parseBaconSettings). */
export const BACON_SETTING_FIELDS: { readonly [K in keyof BaconSettings]: BaconSettingField } = {
    hyperJumpThreshhold: fld('HyperJumpThreshhold', 'int'),
    baseHyperJumpAccuracy: fld('BaseHyperJumpAccuracy', 'int'),
    troopGarrisonMinimumPerColony: fld('TroopGarrisonMinimumPerColony', 'intOrNull'),
    useStarGravityWells: fld('useStarGravityWells', 'bool'),
    smallShipsJumpSooner: fld('smallShipsJumpSooner', 'bool'),
    priceReductionFactor: fld('priceReductionFactor', 'int'),
    sublightFuelBurnDivisor: fld('sublightFuelBurnDivisor', 'float'),
    fighterRangeMultiple: fld('fighterRangeMultiple', 'double'),
    ammoExhaustChanceMissile: fld('ammoExhaustChanceMissile', 'float'),
    ammoExhaustChanceTorpedo: fld('ammoExhaustChanceTorpedo', 'float'),
    fighterBuildCost: fld('fighterBuildCost', 'int'),
    fighterBuildSpeedDivisor: fld('fighterBuildSpeedDivisor', 'float'),
    shadow: fld('Shadow', 'bool'),
    saveStats: fld('saveStats', 'bool'),
    statSaveIntervalInGameDays: fld('saveInterval', 'short', 10),
    researchPerLab: fld('researchPerLab', 'int'),
    fighterOnBomberDamageMultiplier: fld('fighterOnBomberViolence', 'float'),
    backgroundStarsAtZoomLevel: fld('backgroundStarsAtZoomLevel', 'double'),
    lowStarCount: fld('lowStarCount', 'int', 10, 100),
    alwaysShowAsteroidColonies: fld('alwaysShowAsteroidColonies', 'bool'),
    allowAsteroidColonies: fld('allowAsteroidColonies', 'bool'),
    asteroidColonyCost: fld('asteroidColonyCost', 'int'),
    scientificDataForResourceSurvey: fld('scientificDataForResourceSurvey', 'int'),
    scientificDataForRuins: fld('scientificDataForRuins', 'int'),
    tradeEverything: fld('tradeEverything', 'bool'),
    shipMaintenanceCostPerSizeUnit: fld('shipMaintenanceCostPerSizeUnit', 'float'),
    shipMarkupFactor: fld('shipMarkupFactor', 'float'),
    shipMarkupFactorPirates: fld('shipMarkupFactorPirates', 'float'),
    warWearinessMaximum: fld('warWearinessMax', 'float'),
    asteroidColonyPrevalenceDivisor: fld('asteroidColonyPrevalenceDivisor', 'float'),
    lowIndependentLifeValue: fld('lowIndependentLifeValue', 'int'),
    warWearinessReduction: fld('warWearinessReduction', 'int'),
    spyCaptureChance: fld('spyCaptureChance', 'float'),
    spyBaseEscapeChance: fld('capturedSpyEscapeChance', 'float'),
    spyBaseDefectChance: fld('capturedSpyDefectChance', 'float'),
    spyBaseValue: fld('spyBaseValue', 'int'),
    tradeTax: fld('tradeTax', 'double'),
    subjugationTributePercentage: fld('SubjugationTributePercentage', 'double'),
    weaponRangeMultiplierForBases: fld('weaponRangeMultiplierForBases', 'float'),
    allowInfrastructureImprovements: fld('allowInfrastructureImprovements', 'bool'),
    infrastructureSpendingPerDevelopmentLevel: fld('infrastructureSpendingPerDevelopmentLevel', 'int', 10000),
    maxInfrastructureInvestmentAllowed: fld('maxInfrastructureInvestmentAllowed', 'int', 10000),
    infrasetuctureDurability: fld('infrastuctureDurability', 'float', ...F01),
    marketPriceUpdateChance: fld('marketPriceUpdateChance', 'double'),
    maximumResourceLevelToStockAtBaseNotAtColony: fld('maximumResourceLevelToStockAtBaseNotAtColony', 'int'),
    noFuelCruiseSpeedMultiplier: fld('noFuelCruiseSpeedMultiplier', 'float', ...F01),
    noFuelTopSpeedMultiplier: fld('noFuelTopSpeedMultiplier', 'float', ...F01),
    noFuelHyperSpeedMultiplier: fld('noFuelHyperSpeedMultiplier', 'float', ...F01),
    pirateControlLevelToBuildShipsAtIndependentPlanets: fld('pirateControlLevelToBuildShipsAtIndependentPlanets', 'float', ...F01),
    shipFreeRepairTimeFromCrewSkillAverage: fld('shipFreeRepairTimeFromCrewSkillAverage', 'int'),
    shipFreeRepairTimeFromCrewSkillExperienced: fld('shipFreeRepairTimeFromCrewSkillExperienced', 'int'),
    shipFreeRepairTimeFromCrewSkillVeteran: fld('shipFreeRepairTimeFromCrewSkillVeteran', 'int'),
    shipFreeRepairTimeFromCrewSkillElite: fld('shipFreeRepairTimeFromCrewSkillElite', 'int'),
    shipFreeRepairTimeFromCrewSkillLegendary: fld('shipFreeRepairTimeFromCrewSkillLegendary', 'int'),
    fighterBayLabel: { fileKey: 'fighterBayLabel', type: 'string', lowerCase: true },
    bomberBayLabel: { fileKey: 'bomberBayLabel', type: 'string', lowerCase: true },
    mixedBayLabel: { fileKey: 'mixedBayLabel', type: 'string', lowerCase: true },
    pointDefenseAffectsMissiles: fld('pointDefenseAffectsMissiles', 'bool'),
    orbitalAsteroidCost: fld('orbitalAsteroidCost', 'int'),
    privateBuildCostToStateMoney: fld('privateBuildCostToStateMoney', 'double', 0, 1),
    addSalesTax: fld('addSalesTax', 'bool'),
    newIDCost: fld('newIDCost', 'int'),
    baseShipOfficerCost: fld('baseShipOfficerCost', 'int'),
    componentEquipCost: fld('componentEquipCost', 'int'),
    invasionStrategyResult: fld('invasionStrategyResult', 'float'),
    invasionStrategyRemainingGuesses: fld('invasionStrategyRemainingGuesses', 'float', 0),
    useInvasionModifierReputation: fld('useInvasionModifierReputation', 'bool'),
    quartersOfCashAvailable: fld('quartersOfCashAvailable', 'int'),
    limitNewFighterBuildToColonies: fld('limitNewFighterBuildToColonies', 'bool'),
    tailGunnerResearch: fld('tailGunnerReasearch', 'string'),
    useStargates: fld('useStargates', 'bool'),
    pirateBaseTroops: fld('pirateBaseTroops', 'int'),
    pirateFortressTroops: fld('pirateFortressTroops', 'int'),
    pirateCriminalNetworkTroops: fld('pirateCriminalNetworkTroops', 'int'),
    drawWeaponRangeCircles: fld('showRangeCircles', 'bool'),
    // 999-1015: set from showRangeCircles (0.9 on, 5.0 off), never by its own key.
    minZoomLevelForWeaponsCircles: fld('showRangeCircles', 'derived'),
    pirateMaxPopulationInfluence: fld('pirateMaxPopulationInfluence', 'long'),
    customDifficultyColonyCorruptionFactor: fld('customDifficultyColonyCorruptionFactor', 'double', 0.01, 10),
    customDifficultyWarWearinessFactor: fld('customDifficultyWarWearinessFactor', 'double', 0.01, 10),
    customDifficultyResearchRate: fld('customDifficultyResearchRate', 'double', 0.01, 10),
    customDifficultyPopulationGrowthRate: fld('customDifficultyPopulationGrowthRate', 'double', 0.01, 10),
    customDifficultyMiningRate: fld('customDifficultyMiningRate', 'double', 0.01, 10),
    customDifficultyTargettingFactor: fld('customDifficultyTargettingFactor', 'double', 0.01, 10),
    customDifficultyCountermeasuresFactor: fld('customDifficultyCountermeasuresFactor', 'double', 0.01, 10),
    customDifficultyColonyShipBuildSpeedRate: fld('customDifficultyColonyShipBuildSpeedRate', 'double', 0.01, 10),
    customDifficultyColonyIncomeFactor: fld('customDifficultyColonyIncomeFactor', 'double', 0.01, 10),
    allowPrivateShipAssigment: fld('AllowPrivateShipAssigment', 'bool'),
};

export type BaconSettingKey = keyof BaconSettings;
export type BaconSettingsOverrides = Partial<{ [K in BaconSettingKey]: BaconSettings[K] }>;

const isBaconSettingKey = (k: string): k is BaconSettingKey => Object.prototype.hasOwnProperty.call(BACON_SETTING_FIELDS, k);

/**
 * One value as BaconInitialize would store it after its TryParse and clamp (the field's type, Math.fround for a float
 * field, the min / max clamps); undefined when the value would not parse (the static keeps its value). Floats clamp in
 * float arithmetic as the C# Math.Min(Math.Max(v, 0.1f), 1f) does.
 */
export function normalizeBaconSettingValue(key: BaconSettingKey, value: unknown): BaconSettings[BaconSettingKey] | undefined {
    const d = BACON_SETTING_FIELDS[key];
    const integer = (lo: number, hi: number): number | undefined => (typeof value === 'number' && Number.isInteger(value) && value >= lo && value <= hi ? value : undefined);
    const clamp = (v: number): number => {
        if (d.min !== undefined && v < d.min) v = d.min;
        if (d.max !== undefined && v > d.max) v = d.max;
        return v;
    };
    switch (d.type) {
        case 'int': {
            const v = integer(-2147483648, 2147483647);
            if (v === undefined) return undefined;
            return key === 'researchPerLab' ? f(v) : clamp(v);
        }
        case 'intOrNull':
            return value === null ? null : integer(-2147483648, 2147483647);
        case 'short': {
            const v = integer(-32768, 32767);
            return v === undefined ? undefined : clamp(v);
        }
        case 'long':
            return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
        case 'float': {
            if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
            const v = f(value);
            if (!Number.isFinite(v)) return undefined;
            return f(clamp(v));
        }
        case 'double':
            return typeof value === 'number' && !Number.isNaN(value) ? clamp(value) : undefined;
        case 'bool':
            return typeof value === 'boolean' ? value : undefined;
        case 'string':
            return typeof value === 'string' ? (d.lowerCase === true ? value.toLowerCase() : value) : undefined;
        case 'derived':
            return undefined;
    }
}

/**
 * The settings a game runs with: the install's (BaconSettings.txt as parsed) with the game's overrides applied the way
 * BaconInitialize applies a key (normalizeBaconSettingValue; an override that does not parse is ignored), plus the two
 * cross-key rules: showRangeCircles sets minZoomLevelForWeaponsCircles (999-1015) and the no-fuel top speed multiplier
 * is never below the cruise one (863-870).
 */
export function mergeBaconSettings(install: BaconSettings, overrides: BaconSettingsOverrides | null | undefined): BaconSettings {
    const s: BaconSettings = { ...install };
    if (overrides === null || overrides === undefined) return s;
    const out = s as unknown as Record<string, unknown>;
    for (const k of Object.keys(overrides)) {
        if (!isBaconSettingKey(k)) continue;
        const v = normalizeBaconSettingValue(k, (overrides as Record<string, unknown>)[k]);
        if (v !== undefined) out[k] = v;
    }
    if (overrides.drawWeaponRangeCircles !== undefined) s.minZoomLevelForWeaponsCircles = s.drawWeaponRangeCircles ? 0.9 : 5.0;
    if (overrides.noFuelTopSpeedMultiplier !== undefined || overrides.noFuelCruiseSpeedMultiplier !== undefined) {
        if (s.noFuelTopSpeedMultiplier < s.noFuelCruiseSpeedMultiplier) s.noFuelTopSpeedMultiplier = s.noFuelCruiseSpeedMultiplier;
    }
    return s;
}

/**
 * The overrides a game stores for `requested` on top of `install`: each key that parses (normalizeBaconSettingValue),
 * as merged, and only when it differs from the install's value (so an unchanged game writes nothing). Key order =
 * BACON_SETTING_FIELDS order (deterministic save text).
 */
export function baconSettingsOverrides(install: BaconSettings, requested: BaconSettingsOverrides | null | undefined): BaconSettingsOverrides {
    const merged = mergeBaconSettings(install, requested);
    const out: Record<string, unknown> = {};
    if (requested === null || requested === undefined) return out;
    for (const k of Object.keys(BACON_SETTING_FIELDS) as BaconSettingKey[]) {
        if (BACON_SETTING_FIELDS[k].type === 'derived') continue;
        if (!Object.prototype.hasOwnProperty.call(requested, k)) continue;
        if (!Object.is(merged[k], install[k])) out[k] = merged[k];
    }
    return out as BaconSettingsOverrides;
}

/**
 * The file's own comment text for each key: the `//` lines above a key (a block of comment lines, then the key lines
 * that follow it up to the next comment or blank line, share it), joined into one string. Keys with no comment above
 * them are absent. A blank line ends a comment block, so the header blocks (format, European decimals) attach to no key.
 */
export function readBaconSettingsComments(text: string | null): Record<string, string> {
    const out: Record<string, string> = {};
    if (text === null) return out;
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    let comment: string[] = [];
    let afterKey = false;
    for (const raw of text.split(/\r\n|\r|\n/)) {
        const line = raw.trim();
        if (line === '') {
            comment = [];
            afterKey = false;
            continue;
        }
        if (line.startsWith('//')) {
            if (afterKey) comment = [];
            afterKey = false;
            comment.push(line.replace(/^\/\/\s?/, '').trim());
            continue;
        }
        const key = raw.split('=')[0];
        if (comment.length > 0 && !(key in out)) out[key] = comment.join(' ');
        afterKey = true;
    }
    return out;
}
