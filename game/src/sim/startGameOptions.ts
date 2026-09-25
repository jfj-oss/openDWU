// New-game wizard options (task 06b). Headless — no DOM/Pixi imports.
import { GalaxyShape } from './types';
import type { Race } from './data/races';
import type { GameData } from './data/gameData';
import type { CreateGameOptions, EmpireStartOptions } from './game';
import { Random } from './random';

export interface StartGameOptions {
    shape: GalaxyShape;
    /** Index into the star-amount slider (0..5), see starCountFor. */
    starCountIndex: number;
    /** Index into the physical-size slider (0..4), see sectorsFor. */
    dimensionIndex: number;
    seed: number;
    /** Task 06d: name of the player's race (a parsed races/*.txt Name).
     *  Empty until a race is chosen on the wizard's "Your Race" page. */
    raceName: string;
    /** Task 06e: empire display name. Default "<Race name> Empire"; the
     *  wizard re-derives it when the race changes and the user hasn't
     *  edited it (see defaultEmpireName / applyEmpireDefaults). */
    empireName: string;
    /** Task 06e: governmentId from governments.txt (-1 = not chosen yet;
     *  the wizard's "Your Empire" page fills it in). */
    governmentId: number;
    /** Task 06e: index 0..82 into images/ui/flagshapes/flagNN.png. */
    flagShapeIndex: number;
    /** Task 06e: flag primary colour (background), '#rrggbb'. */
    primaryColor: string;
    /** Task 06e: flag secondary colour (shape tint), '#rrggbb'. */
    secondaryColor: string;
    /** Task 06f: index into the colony-prevalence slider (0..4), see
     * colonyPrevalenceFor. */
    colonyPrevalenceIndex: number;
    /** Task 06f: index into the alien-life slider (0..4), see alienLifeFor. */
    alienLifeIndex: number;
    /** Task 06f: index into the space-creatures slider (0..3), see
     * spaceCreaturesFor. */
    spaceCreaturesIndex: number;
    /** Task 06f: index into the pirates slider (0..5), see piratesFor. */
    piratesIndex: number;
    /** Task 06f: index into the aggression slider (0..4), see aggressionFor. */
    aggressionIndex: number;
    /** Task 06f: index into the difficulty slider (0..4), see difficultyFor. */
    difficultyIndex: number;
    /** Task 06f: "Difficulty scales as player nears victory" checkbox
     * (chkStartNewGameTheGalaxyDifficultyScaling). */
    difficultyScaling: boolean;
    /** Task 06g: the wizard's "Victory Conditions" page options, ported from
     * DistantWorlds.Types.VictoryConditions (see VictoryConditions below). */
    victory: VictoryConditions;
    /** Task 06h: the wizard's "Colonization and Territory" page options
     * (see ColonizationOptions below). */
    colonization: ColonizationOptions;
    /** Task 06h: the wizard's "Other Empires" page options (see
     * OtherEmpiresOptions below). */
    otherEmpires: OtherEmpiresOptions;
    /** Task M4x: "The Galaxy" Expansion slider (tbarStartNewGameTheGalaxyExpansion, 0..5 = PreWarp, Starting,
     * Young, Expanding, Mature, Old; Start.cs 3166). Becomes Galaxy.Age (Start.1.cs 3695, Start.2.cs 113) and
     * drives the AI empires' age / tech level. Optional so older saves still load (unset = 1). */
    galaxyExpansionIndex?: number;
    /** Task M4x: "Your Empire" size slider (tbarStartNewGameYourEmpireSize, 0..5 = (Random), Starting, Young,
     * Expanding, Mature, Old; Start.cs 3451 / method_74). Unset = 1 (Main.Part9.cs 2680 YourEmpireExpansion = 1). */
    empireExpansionIndex?: number;
    /** Task M4x: "Your Empire" tech-level slider (tbarStartNewGameYourEmpireTechLevel, 0..8 = PreWarp, Normal,
     * Level 1..7; Start.cs 3460 / method_75). Unset = 1 (Normal, tech 0.5). */
    empireTechLevelIndex?: number;
}

/**
 * Port of DistantWorlds.Types.VictoryConditions (DistantWorlds.Types assembly,
 * see task 06g source). Only the fields the new-game wizard edits are kept —
 * the habitat/empire story-event targets (DefendHabitat, TargetHabitat, ...)
 * are set by the engine at start, not by the player.
 */
export interface VictoryConditions {
    /** chkVictoryTerritory: win by controlling TerritoryPercent % of colonies. */
    territory: boolean;
    /** numVictoryTerritoryPercent (1..100, default 33). */
    territoryPercent: number;
    /** chkVictoryPopulation: win by controlling PopulationPercent % of population. */
    population: boolean;
    /** numVictoryPopulationPercent (1..100, default 33). */
    populationPercent: number;
    /** chkVictoryEconomy: win when the private economy generates
     * EconomyPercent % of the galaxy total. */
    economy: boolean;
    /** numVictoryEconomyPercent (1..100, default 33). */
    economyPercent: number;
    /** chkVictoryTimeLimit: game finishes after timeLimitYears years. */
    timeLimit: boolean;
    /** numVictoryTimeLimitYears (1..1000, default 10). */
    timeLimitYears: number;
    /** chkVictoryTimeStart: victory conditions apply after startDateYears
     * years (numVictoryTimeStartYears, 1..99, default 3). */
    startDateYears: number;
    /** chkVictoryEnableDisasterEvents (C# field EnableDisasterEvents, true). */
    enableDisasterEvents: boolean;
    /** chkVictoryEnableRaceSpecificConditions (C# field
     * EnableRaceSpecificVictoryConditions, true). */
    enableRaceSpecificConditions: boolean;
    /** chkVictoryEnableRaceSpecificEvents (C# field EnableRaceSpecificEvents,
     * true). */
    enableRaceSpecificEvents: boolean;
    /** C# field VictoryThresholdPercentage (default 1.0); the original UI
     * exposes it via lblVictoryThresholdPercentage on this page. */
    victoryThresholdPercentage: number;
}

/** Min/max bounds of the wizard's numeric victory controls, straight from
 * Start.InitializeComponent.cs (task 06g): the three percent boxes have
 * Minimum = 1 (no Maximum in InitializeComponent), the time-limit box is
 * 1..1000 and the time-start box is 1..99. */
export const VICTORY_PERCENT_MIN = 1;
export const VICTORY_TIME_LIMIT_YEARS_MIN = 1;
export const VICTORY_TIME_LIMIT_YEARS_MAX = 1000;
export const VICTORY_TIME_START_YEARS_MIN = 1;
export const VICTORY_TIME_START_YEARS_MAX = 99;

/** Task 06g: default VictoryConditions matching the C# class defaults plus
 * the wizard control values from Start.InitializeComponent.cs: all victory
 * types unchecked (sandbox mode), percents 33, time limit 10 years, time
 * start 3 years, all event toggles on, threshold 1.0. */
export function defaultVictoryConditions(): VictoryConditions {
    return {
        territory: false,
        territoryPercent: 33,
        population: false,
        populationPercent: 33,
        economy: false,
        economyPercent: 33,
        timeLimit: false,
        timeLimitYears: 10,
        startDateYears: 3,
        enableDisasterEvents: true,
        enableRaceSpecificConditions: true,
        enableRaceSpecificEvents: true,
        victoryThresholdPercentage: 1.0,
    };
}

/** Task 06h: clamp a VictoryConditions' numeric fields into the wizard
 * control bounds (percent >= 1; time limit 1..1000 years; time start
 * 1..99 years) and return a copy. Booleans pass through unchanged. */
export function clampVictory(v: VictoryConditions): VictoryConditions {
    const pct = (x: number): number => Math.max(VICTORY_PERCENT_MIN, x);
    return {
        ...v,
        territoryPercent: pct(v.territoryPercent),
        populationPercent: pct(v.populationPercent),
        economyPercent: pct(v.economyPercent),
        timeLimitYears: Math.min(
            VICTORY_TIME_LIMIT_YEARS_MAX,
            Math.max(VICTORY_TIME_LIMIT_YEARS_MIN, v.timeLimitYears),
        ),
        startDateYears: Math.min(
            VICTORY_TIME_START_YEARS_MAX,
            Math.max(VICTORY_TIME_START_YEARS_MIN, v.startDateYears),
        ),
    };
}

/**
 * Task 06h: the wizard's "Colonization and Territory" page options, ported
 * from the pnlStartNewGameColonizationTerritory controls of
 * Start.InitializeComponent.cs.
 */
export interface ColonizationOptions {
    /** grpStartNewGameColonizationTerritoryColonizationRange: enforce the
     * colonization-range limits below. */
    enforceRangeLimits: boolean;
    /** sldStartNewGameColonizationTerritoryColonizationRange (500..5000 Kly,
     * default 4000). The player may only colonise systems within this range
     * of their home system when enforcement is on. */
    colonizationRangeKly: number;
    /** sldStartNewGameColonizationTerritoryColonyInfluenceRange (10..200 %,
     * default 100). Suggested colony influence range for new colonies. */
    colonyInfluenceRangePercent: number;
    /** chkOptionsAllowSameSystemAsOtherEmpires: allow building colonies and
     * mining stations in other empires' systems. */
    allowSameSystemAsOtherEmpires: boolean;
}

/** Min/max bounds of the wizard's colonization-range slider, straight from
 * Start.InitializeComponent.cs (task 06h): Minimum = 500, Maximum = 5000. */
export const COLONIZATION_RANGE_KLY_MIN = 500;
export const COLONIZATION_RANGE_KLY_MAX = 5000;

/** Min/max bounds of the wizard's colony-influence-range slider (10..200 %). */
export const COLONY_INFLUENCE_RANGE_PCT_MIN = 10;
export const COLONY_INFLUENCE_RANGE_PCT_MAX = 200;

/** Task 06h: default ColonizationOptions matching the wizard control values
 * from Start.InitializeComponent.cs: enforcement off, colonization range
 * 4000 Kly, colony influence range 100 %, same-system option unchecked. */
export function defaultColonizationOptions(): ColonizationOptions {
    return {
        enforceRangeLimits: false,
        colonizationRangeKly: 4000,
        colonyInfluenceRangePercent: 100,
        allowSameSystemAsOtherEmpires: false,
    };
}

/** Task 06h: clamp a ColonizationOptions' numeric fields into the wizard
 * control bounds (range 500..5000 Kly; influence 10..200 %) and return a
 * copy. Booleans pass through unchanged. */
export function clampColonization(c: ColonizationOptions): ColonizationOptions {
    return {
        ...c,
        colonizationRangeKly: Math.min(
            COLONIZATION_RANGE_KLY_MAX,
            Math.max(COLONIZATION_RANGE_KLY_MIN, c.colonizationRangeKly),
        ),
        colonyInfluenceRangePercent: Math.min(
            COLONY_INFLUENCE_RANGE_PCT_MAX,
            Math.max(COLONY_INFLUENCE_RANGE_PCT_MIN, c.colonyInfluenceRangePercent),
        ),
    };
}

/**
 * Task 06h: the wizard's "Other Empires" page options, ported from the
 * pnlStartNewGameOtherEmpires controls of Start.InitializeComponent.cs.
 */
export interface OtherEmpiresOptions {
    /** chkOtherEmpiresAutogenerate: auto-generate the starting AI empires
     * instead of specifying them manually below. */
    autogenerate: boolean;
    /** lblStartNewGameOtherEmpiresAutoGenNumberDescrip1/2 ("Generate <n>
     * starting empires"): how many AI empires to generate. */
    empireCount: number;
    /** Task 06j: the wizard's manual per-empire list (the "OR specify the
     * starting empires below" rows). When non-empty it overrides
     * auto-generation for those slots — see toCreateGameOptions. Empty by
     * default (pure auto-generation, as in task 06h). */
    manual: ManualEmpireStart[];
}

/** Task 06j: one row of the wizard's manual AI-empire list. Race and
 * government are stored by their parsed names / ids (as chosen on the page);
 * name defaults to "<Race> Empire" when the user leaves it empty. */
export interface ManualEmpireStart {
    /** Race name (a parsed races/*.txt Name) or '(Random)'. */
    race: string;
    /** Government id from governments.txt (-1 = not chosen yet → '(Random)'). */
    governmentId: number;
    /** Empire display name ('' = use the "<Race> Empire" default). */
    name: string;
}

/** Min/max bounds of the wizard's "generate N starting empires" control.
 * The original's InitializeComponent excerpt (task 06h) lists no explicit
 * min/max for it, so sensible bounds are used: at least 0 (no AI empires)
 * and at most 100. */
export const OTHER_EMPIRES_COUNT_MIN = 0;
export const OTHER_EMPIRES_COUNT_MAX = 100;

/** Task 06h: default OtherEmpiresOptions — auto-generation on with 10
 * starting empires (the typical DW:U starting-empire count). Task 06j: the
 * manual list starts empty. */
export function defaultOtherEmpiresOptions(): OtherEmpiresOptions {
    return {
        autogenerate: true,
        empireCount: 10,
        manual: [],
    };
}

/** Task 06h: clamp an OtherEmpiresOptions' empire count into the wizard
 * control bounds (0..100) and return a copy. Booleans pass through. The
 * manual list is copied (task 06j) so mutating the copy's rows can't affect
 * the original. */
export function clampOtherEmpires(o: OtherEmpiresOptions): OtherEmpiresOptions {
    return {
        ...o,
        empireCount: Math.min(
            OTHER_EMPIRES_COUNT_MAX,
            Math.max(OTHER_EMPIRES_COUNT_MIN, o.empireCount),
        ),
        manual: o.manual.map((m) => ({ ...m })),
    };
}

/**
 * Port of Start.cs BaconStart.method_60 (vanilla star-amount slider values).
 * Dwarf/Tiny/Small/Standard/Large/Huge; out-of-range defaults to Standard.
 */
export function starCountFor(index: number): number {
    switch (index) {
        case 0:
            return 100;
        case 1:
            return 250;
        case 2:
            return 400;
        case 3:
            return 700;
        case 4:
            return 1000;
        case 5:
            return 1400;
        default:
            return 400;
    }
}

/**
 * Port of Start.cs Start.method_69 (physical-size slider values, sectors per
 * side). Tiny/Small/Medium/Large/Huge; out-of-range defaults to (10,10).
 */
export function sectorsFor(index: number): number {
    switch (index) {
        case 0:
            return 4;
        case 1:
            return 6;
        case 2:
            return 8;
        case 3:
            return 10;
        case 4:
            return 15;
        default:
            return 10;
    }
}

/**
 * Port of Start.cs Start.method_64 (colony-prevalence slider values).
 * Out-of-range defaults to 0.75 (the C# pre-switch default).
 */
export function colonyPrevalenceFor(index: number): number {
    switch (index) {
        case 0:
            return 0.35;
        case 1:
            return 0.5;
        case 2:
            return 0.65;
        case 3:
            return 0.82;
        case 4:
            return 1.0;
        default:
            return 0.75;
    }
}

/**
 * Port of Start.cs Start.method_67, which delegates to
 * BaconStart.OverrideLowIndependentLifeValue (vanilla table). The 150 case is
 * replaced by a Bacon setting in the mod; per the task rule we use the vanilla
 * value (150) and comment the override. Out-of-range defaults to 400 (the C#
 * pre-switch default).
 */
export function alienLifeFor(index: number): number {
    switch (index) {
        case 0:
            // BaconStart overrides this with BaconStart.lowIndependentLifeValue;
            // the vanilla value 150 is used here.
            return 150;
        case 1:
            return 250;
        case 2:
            return 400;
        case 3:
            return 700;
        case 4:
            return 1000;
        default:
            return 400;
    }
}

/**
 * Port of Start.cs Start.method_62 (space-creatures slider values).
 * Out-of-range defaults to 0.
 */
export function spaceCreaturesFor(index: number): number {
    switch (index) {
        case 0:
            return 0.0;
        case 1:
            return 0.3;
        case 2:
            return 0.6;
        case 3:
            return 1.0;
        default:
            return 0.0;
    }
}

/**
 * Port of Start.cs Start.method_66 (pirates slider values).
 * Out-of-range defaults to 0.
 */
export function piratesFor(index: number): number {
    switch (index) {
        case 0:
            return 0.0;
        case 1:
            return 0.07;
        case 2:
            return 0.2;
        case 3:
            return 0.4;
        case 4:
            return 0.7;
        case 5:
            return 1.0;
        default:
            return 0.0;
    }
}

/**
 * Port of Start.cs Start.method_71 (aggression slider values).
 * Out-of-range defaults to 0.
 */
export function aggressionFor(index: number): number {
    switch (index) {
        case 0:
            return 0.9;
        case 1:
            return 1.1;
        case 2:
            return 1.3;
        case 3:
            return 1.5;
        case 4:
            return 1.7;
        default:
            return 0.0;
    }
}

/**
 * Port of Start.1.cs Start.method_201 (difficulty slider values).
 * Out-of-range defaults to 1.0 (the C# pre-switch default).
 */
export function difficultyFor(index: number): number {
    switch (index) {
        case 0:
            return 0.7;
        case 1:
            return 1.0;
        case 2:
            return 1.25;
        case 3:
            return 1.6;
        case 4:
            return 2.0;
        default:
            return 1.0;
    }
}

/** Task 06d: the wizard's default player race — the first playable race,
 * sorted by name. Falls back to the first race overall (still sorted) when
 * no race is playable, and '' when there are no races at all. */
export function defaultRaceName(races: Race[]): string {
    const sorted = [...races].sort((a, b) => a.name.localeCompare(b.name));
    const playable = sorted.find((r) => r.playable);
    return (playable ?? sorted[0])?.name ?? '';
}

/** Task 06e: the wizard's default empire name for a chosen race. */
export function defaultEmpireName(raceName: string): string {
    return `${raceName} Empire`;
}

/** Task 06e: the flag colour palette (12 colours); the wizard picks the
 * primary/secondary defaults deterministically by race index. */
export const FLAG_COLOR_PALETTE = [
    '#c8373a', // red
    '#e8a33d', // orange
    '#e8d24a', // yellow
    '#5aa05a', // green
    '#3a8f9e', // teal
    '#3a6fb0', // blue
    '#6a5acd', // indigo
    '#9e4fb0', // purple
    '#b05a8f', // pink
    '#8a6f4f', // brown
    '#9aa5b1', // grey
    '#f0f0f0', // white
] as const;

/** Task 06e: deterministic default flag colours for a race index —
 * primary at index % 12, secondary offset by 5. */
export function defaultFlagColors(raceIndex: number): { primary: string; secondary: string } {
    const n = FLAG_COLOR_PALETTE.length;
    const i = ((raceIndex % n) + n) % n;
    return {
        primary: FLAG_COLOR_PALETTE[i],
        secondary: FLAG_COLOR_PALETTE[(i + 5) % n],
    };
}

/** Task 06e: URL of a flag shape tile (flagNN.png, two-digit index). */
export function flagShapeUrl(index: number): string {
    return `/assets/dwu/images/ui/flagshapes/flag${String(index).padStart(2, '0')}.png`;
}

/** Task 06e: apply the "Your Empire" page defaults to options when the
 * user hasn't customised each field yet:
 * - empireName: "<Race name> Empire". Auto-updates when the race changes
 *   (prevRaceName) as long as the current name still equals the previous
 *   race's default (or is empty); a user-edited name survives.
 * - governmentId: -1 until the wizard's dropdown fills it in.
 * - flagShapeIndex / colours: deterministic pick from FLAG_COLOR_PALETTE
 *   by race index, only while the user hasn't touched them. */
export function applyEmpireDefaults(options: StartGameOptions, raceIndex: number, prevRaceName?: string): void {
    const prevDefault = prevRaceName !== undefined ? defaultEmpireName(prevRaceName) : '';
    if (options.empireName === '' || options.empireName === prevDefault) {
        options.empireName = defaultEmpireName(options.raceName);
    }
    if (options.governmentId < 0) {
        options.governmentId = -1;
    }
    if (options.flagShapeIndex < 0) {
        options.flagShapeIndex = raceIndex % 83;
    }
    if (options.primaryColor === '') {
        options.primaryColor = defaultFlagColors(raceIndex).primary;
    }
    if (options.secondaryColor === '') {
        options.secondaryColor = defaultFlagColors(raceIndex).secondary;
    }
}

/** Default new-game options: Spiral, star index 3 (Standard/700), dimension
 * index 2 (Medium/8x8), a random seed, no race chosen yet (the wizard's
 * "Your Race" page fills in raceName; see defaultRaceName). The "Your
 * Empire" fields start uncustomised so applyEmpireDefaults can fill them.
 * Task 06f galaxy-option sliders: the original's default slider positions
 * are not visible in the task context, so each defaults to its middle tick
 * (colony prevalence / alien life 2 of 5, space creatures 1 of 4, pirates
 * 2 of 6, aggression 2 of 5, difficulty 2 of 5); difficulty scaling is off.
 * Task 06g: victory conditions start at the C# defaults (all types
 * unchecked = sandbox mode; see defaultVictoryConditions). Task 06h:
 * colonization and other-empires options start at the wizard control
 * defaults (see defaultColonizationOptions / defaultOtherEmpiresOptions). */
export function defaultStartGameOptions(): StartGameOptions {
    return {
        shape: GalaxyShape.Spiral,
        starCountIndex: 3,
        dimensionIndex: 2,
        seed: Date.now() % 2147483647,
        raceName: '',
        empireName: '',
        governmentId: -1,
        flagShapeIndex: -1,
        primaryColor: '',
        secondaryColor: '',
        colonyPrevalenceIndex: 2,
        alienLifeIndex: 2,
        spaceCreaturesIndex: 1,
        piratesIndex: 2,
        aggressionIndex: 2,
        difficultyIndex: 2,
        difficultyScaling: false,
        victory: defaultVictoryConditions(),
        colonization: defaultColonizationOptions(),
        otherEmpires: defaultOtherEmpiresOptions(),
        // Task M4x: the "Starting" era — the standard-game preset of Start.cs 3298-3302 / 3321-3327
        // (Expansion 1, empire tech Normal). NOTE: the C# StartGameOptions defaults (Main.Part9.cs 2664 / 2689,
        // GalaxyExpansion = 0, YourEmpireTechLevel = 0) would be a full pre-warp start.
        galaxyExpansionIndex: 1,
        empireExpansionIndex: 1,
        empireTechLevelIndex: 1,
    };
}

/**
 * Task 06i: map the wizard's StartGameOptions (all pages) onto createGame's
 * CreateGameOptions (src/sim/game.ts). Port of the option-gathering part of
 * DistantWorlds/Start.2.cs CreateGameFromSettings, which reads the wizard's
 * StartNewGameForm controls and builds the Galaxy + EmpireStartList it hands
 * to the engine.
 *
 * gameData and systemNames are not carried by StartGameOptions (they come from
 * the DW:U install / fallback list at boot), so they are passed in explicitly;
 * both are required by CreateGameOptions.
 *
 * Task M4x: galaxy age and every empire's age / tech level follow the
 * original's btnStartNewGameStart_Click (Start.1.cs 3685-3770): the galaxy
 * Expansion slider is Galaxy.Age, the player's age / tech come from the
 * "Your Empire" size and tech-level sliders, auto-generated AI empires get
 * method_109 / method_89 of the Expansion slider.
 */
export function toCreateGameOptions(
    startOptions: StartGameOptions,
    gameData: GameData,
    systemNames: string[],
): CreateGameOptions {
    const o = startOptions;
    // Start.1.cs 3695 `int value = tbarStartNewGameTheGalaxyExpansion.Value`.
    const value = o.galaxyExpansionIndex ?? 1;
    // Start.1.cs 3685 `Random random_ = new Random((int)DateTime.Now.Ticks)` (clock-seeded → seeded from the
    // galaxy seed, as elsewhere in the port); the other clock Randoms are method-local (see the helpers).
    const random_ = new Random((o.seed ^ 0x3685) | 0);
    // Start.1.cs 3710-3716: player age / tech level.
    const playerAge = playerEmpireAge(o.empireExpansionIndex ?? 1, value, new Random((o.seed ^ 0x4302) | 0));
    const playerTechLevel = techLevelForSliderIndex(o.empireTechLevelIndex ?? 1);

    // Player empire (task 06d race, task 06e name/government/colours).
    // governmentId (-1 = not chosen) is resolved to a government *name* here
    // because createGame matches governments by name (game.ts
    // resolveGovernmentId); '(Random)' lets the engine pick a suitable one.
    const governmentName =
        o.governmentId >= 0 ? gameData.governments[o.governmentId]?.name ?? '(Random)' : '(Random)';
    const player: EmpireStartOptions = {
        name: o.empireName,
        race: o.raceName === '' ? '(Random)' : o.raceName,
        governmentStyle: governmentName,
        homeSystemFavourability: 'Normal',
        startLocation: '(Random)',
        age: playerAge,
        techLevel: playerTechLevel,
        // TODO(createGame): flag colours (primaryColor/secondaryColor) and
        // flagShapeIndex are not accepted by createGame yet (empire flags are
        // an unported TODO(port) in game.ts).
    };

    // AI empires (task 06h "Other Empires" page). Auto-generation produces
    // `empireCount` random-race empires placed at random proximity. Task 06j:
    // a non-empty manual list overrides auto-generation — each row becomes an
    // explicit EmpireStartOptions (createGame's aiEmpires field accepts
    // specific race / government names; '(Random)' keeps a slot open).
    const aiEmpires: EmpireStartOptions[] = [];
    const manual = o.otherEmpires.manual;
    if (manual.length > 0) {
        // Start.1.cs 3768-3769 method_199: each grid row carries its own Size / TechLevel cells (3577-3598).
        // TODO(port): the wizard's manual rows have no Size / TechLevel cells yet; they use the galaxy-era values
        // the original seeds the list with (Start.1.cs 3343-3344: method_58(GalaxyExpansion) and
        // method_55(method_89(GalaxyExpansion)), read back through method_57 / method_54 as in method_199).
        const rowAge = value; // method_57(method_58(value))
        const rowTech = techLevelFromBucket(aiTechLevelForExpansion(value, new Random((o.seed ^ 0x2634) | 0)));
        for (const m of manual) {
            aiEmpires.push({
                name: m.name === '' ? undefined : m.name,
                race: m.race === '' ? '(Random)' : m.race,
                governmentStyle:
                    m.governmentId >= 0
                        ? gameData.governments[m.governmentId]?.name ?? '(Random)'
                        : '(Random)',
                homeSystemFavourability: 'Normal',
                proximityDistance: 'Random',
                age: rowAge,
                techLevel: rowTech,
            });
        }
    } else {
        const count = clampOtherEmpires(o.otherEmpires).empireCount;
        for (let i = 0; i < count; i++) {
            // Start.1.cs 3759-3761: Age = method_57(method_109(string_, random_)); TechLevel = method_89(value)
            // (method_89 news its own clock Random per call).
            const age = aiEmpireAge(value, random_);
            const techLevel = aiTechLevelForExpansion(value, new Random((o.seed ^ 0x2634 ^ (i + 1)) | 0));
            aiEmpires.push({
                race: '(Random)',
                governmentStyle: '(Random)',
                homeSystemFavourability: 'Normal',
                proximityDistance: 'Random',
                age,
                techLevel,
            });
        }
    }

    return {
        seed: o.seed,
        shape: o.shape,
        // Start.2.cs 113 `galaxy_0.Age = int_5` (int_5 = the Expansion slider value, Start.1.cs 3845).
        galaxyAge: value,
        starCount: starCountFor(o.starCountIndex),
        sectorWidth: sectorsFor(o.dimensionIndex),
        sectorHeight: sectorsFor(o.dimensionIndex),
        systemNames,
        gameData,
        colonyPrevalence: colonyPrevalenceFor(o.colonyPrevalenceIndex),
        player,
        aiEmpires,
        allowEmpiresInSameSystem: o.colonization.allowSameSystemAsOtherEmpires,
        // Only meaningful when the range limits are enforced; <= 0 lets
        // createGame fall back to its auto value.
        empireTerritoryColonyInfluenceRangeFactor: o.colonization.enforceRangeLimits
            ? o.colonization.colonyInfluenceRangePercent
            : undefined,
        // TODO(createGame): fields createGame does not accept yet stay on
        // StartGameOptions and are ignored here:
        //   - alien life (alienLifeIndex → alienLifeFor): independent-life count
        //   - space creatures (spaceCreaturesIndex → spaceCreaturesFor)
        //   - pirates (piratesIndex → piratesFor): pirate empires are unported
        //   - aggression (aggressionIndex → aggressionFor)
        //   - difficulty (difficultyIndex → difficultyFor) + difficultyScaling
        //     (SetEmpireDifficultyFactors is an unported TODO(port))
        //   - victory conditions (o.victory): applied post-creation, not a
        //     generation input
        //   - colonization range (colonizationRangeKly) enforcement radius
    };
}

/** Tech level of the "Normal" start (Start.cs 4162 method_54 "Normal" = 0.5: starting ships, space port,
 * stations); 0 = PreWarp (no space port, no ships: Start.2.cs 1146 / 1308 / 1314 / 1367 gate on TechLevel > 0).
 * Used by the dev autostart / tutorial paths in main.ts. */
export const STARTING_TECH_LEVEL = 0.5;

/** Task M4x: the wizard's era names (Start.cs 4342 method_58, ages 0..6). */
export const AGE_NAMES = ['PreWarp', 'Starting', 'Young', 'Expanding', 'Mature', 'Old', 'Supersize'] as const;

/** Task M4x: Start.1.cs 3710-3715 + Start.cs 4687 method_74 + Start.cs 4302 method_57. The "Your Empire" size
 * slider (0 = (Random), 1..5 = Starting..Old) → EmpireStart.Age; "Starting" in a PreWarp galaxy (Expansion 0)
 * becomes PreWarp (age 0). (Random) draws `new Random(clock).Next(1, 6)` (clockRnd stands in for it). */
export function playerEmpireAge(empireExpansionIndex: number, galaxyExpansionIndex: number, clockRnd: Random): number {
    if (empireExpansionIndex === 1 && galaxyExpansionIndex === 0) return 0; // Start.1.cs 3711-3714
    if (empireExpansionIndex <= 0 || empireExpansionIndex > 5) return clockRnd.next(1, 6); // method_74 default "(Random)"
    return empireExpansionIndex; // method_57("Starting".."Old") = 1..5
}

/** Task M4x: Start.cs 4714 method_75 + Start.cs 4149 method_54. The tech-level slider (0 = PreWarp,
 * 1 = Normal, 2..8 = Level 1..7) → EmpireStart.TechLevel. */
export function techLevelForSliderIndex(index: number): number {
    if (index === 0) return 0.0; // PreWarp
    if (index >= 2 && index <= 8) return index - 1; // Level X
    return 0.5; // method_75 default "Normal"
}

/** Task M4x: Start.2.cs 3963 method_109 then Start.cs 4302 method_57 for an auto-generated AI empire:
 * the age name of the galaxy Expansion slider (method_58) is widened by one Next(0, 2) draw on random_. */
export function aiEmpireAge(galaxyExpansionIndex: number, random_: Random, clockRnd?: Random): number {
    switch (galaxyExpansionIndex) {
        case 0:
            return 0; // PreWarp
        case 1:
            return 1; // Starting
        case 2:
            return random_.next(0, 2) === 0 ? 1 : 2; // Starting / Young
        case 3:
            return random_.next(0, 2) === 0 ? 2 : 3; // Young / Expanding
        case 4:
            return random_.next(0, 2) === 0 ? 3 : 4; // Expanding / Mature
        case 5:
            return random_.next(0, 2) === 0 ? 4 : 5; // Mature / Old
        case 6: {
            const r = random_.next(0, 3); // Supersize: Mature / Old / Supersize
            return r === 0 ? 4 : r === 1 ? 5 : 6;
        }
        default:
            // method_58 of any other value: method_109 keeps "(Random)" and method_57 draws its own clock Random
            // (unreachable from the 0..5 slider).
            return (clockRnd ?? random_).next(1, 6);
    }
}

/** Task M4x: port of Start.2.cs 2634 method_89 (AI tech level from the galaxy Expansion slider).
 * `clockRnd` stands in for its `new Random((int)DateTime.Now.Ticks)`. */
export function aiTechLevelForExpansion(int_1: number, clockRnd: Random): number {
    let num2 = 1.0;
    let num3 = 6.99;
    switch (int_1) {
        case 0: num2 = 0.0; num3 = 0.0; break;
        case 1: num2 = 0.5; num3 = 0.5; break;
        case 2: num2 = 1.0; num3 = 1.99; break;
        case 3: num2 = 1.0; num3 = 2.99; break;
        case 4: num2 = 2.0; num3 = 3.99; break;
        case 5: num2 = 3.0; num3 = 4.99; break;
        case 6: num2 = 4.0; num3 = 5.99; break;
    }
    let num = num2 + clockRnd.nextDouble() * (num3 - num2);
    if (int_1 === 1) num = 0.5;
    return num;
}

/** Task M4x: Start.cs 4196 method_55 (tech level → name) read back by Start.1.cs 3593-3597 (method_199:
 * "Starting" → "Normal", then method_54). Negative = "(Random)" → -1 (Start.1.cs 3589). */
export function techLevelFromBucket(double_1: number): number {
    if (double_1 < 0.0) return -1.0;
    if (double_1 === 0.0) return 0.0;
    if (double_1 === 0.5) return 0.5;
    for (let x = 1; x <= 6; x++) if (double_1 > x - 1 && double_1 <= x && (x > 1 || double_1 > 0.5)) return x;
    return 7.0; // includes (0, 0.5), as in the C# fall-through
}
