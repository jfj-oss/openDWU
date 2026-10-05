// New-game wizard options (task 06b). Headless — no DOM/Pixi imports.
import { themeFlagShapeUrls } from '../themeAssets';
import { VictoryConditions as RuntimeVictoryConditions, victoryConditionsFromWizard } from './victory';
import { PiratePlayStyle } from './pirates';
import { REAL_SECONDS_IN_GALACTIC_YEAR, startStarDateForAge } from './galaxyTime';
import { GalaxyShape } from './types';
import type { Race } from './data/races';
import type { GameData } from './data/gameData';
import type { CreateGameOptions, EmpireStartOptions } from './game';
import { Random } from './random';
import type { ScenarioManifest } from './scenario/manifest';
import { addonCatalog, addonPickerModel, type SmarterAIChoice } from './scenario/addons';
import { CUSTOM_MAX_SECTORS, CUSTOM_MIN_SECTORS, clampCustomSectors } from './galaxy';

export interface StartGameOptions {
    shape: GalaxyShape;
    /** Index into the star-amount slider (0..5), see starCountFor. */
    starCountIndex: number;
    /** Index into the physical-size slider (0..4), see sectorsFor. */
    dimensionIndex: number;
    /**
     * Custom galaxy size (not a port; the wizard's star-count box): the star count when it is not one of the starCountFor
     * presets. Unset = starCountFor(starCountIndex) — every preset leaves it unset, so a preset game is the original.
     * Read through galaxyStarCount; written through setGalaxyStarCount (which keeps starCountIndex at its bracket).
     */
    customStarCount?: number;
    /**
     * Custom galaxy size (not a port; the wizard's "Sectors: W × H" boxes): sectors across / down when they are not one of
     * the sectorsFor preset squares, CUSTOM_MIN_SECTORS..CUSTOM_MAX_SECTORS each (past the C# 4..15 clamp; each sector
     * stays the C# 2,000,000). Both set or both unset. Read through galaxySectorCounts; written through setGalaxySectors.
     */
    customSectorWidth?: number;
    customSectorHeight?: number;
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
    /** "Pirate Proximity" combo (cmbStartNewGameTheGalaxyPirateProximity: 0 Nearby, 1 Average, 2 Distant;
     * Start.1.cs 4774), see pirateProximityFor. Optional so older saves still load (unset = 1, Main.Part9.cs 2667). */
    pirateProximityIndex?: number;
    /** "Pirate Strength" slider (tbarStartNewGameTheGalaxyPirateStrength, 0..3), see
     * pirateShipMaintenanceFactorFor. Unset = 2 (Main.Part9.cs 2666). */
    pirateStrengthIndex?: number;
    // [todosweep2] begin
    /** StartGameOptions.GalaxyResearchSpeed (StartGameOptions.cs 21): the research-cost box numStartNewGameTheGalaxyResearchBaseTech
     * (1..999, thousands; Start.1.cs 3296 / 3413). The "Research Costs" slider only sets it (Start.1.cs 4408
     * tbarStartNewGameTheGalaxyResearchSpeed_ValueChanged). Unset = 120 (Main.Part9.cs 2668). */
    galaxyResearchSpeed?: number;
    // [todosweep2] end
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
    // [wizardB1] begin — options of the original's wizard that were missing (all optional so older saves still load).
    /** The "Playstyle" page (Start.cs pnlStartNewGameYourEmpireType): which start the player picked (Start.cs wjhRtsSwmsa).
     *  Unset = 'CustomStandard' (the full wizard as a standard empire). */
    empireType?: WizardEmpireType;
    /** cmbVictoryPiratePlayStyle / cmbJumpStartVictoryPiratePlayStyle index (0 Balanced, 1 Pirate, 2 Mercenary, 3 Smuggler;
     *  Start.1.cs 3204 method_191). Unset = 0 (StartGameOptions.PiratePlayStyle = 0). Read only for a pirate start. */
    piratePlayStyleIndex?: number;
    /** chkStartNewGameTheGalaxyPiratesRespawn "Destroyed Pirates do not respawn" (Start.1.cs 3741). Unset = false. */
    destroyedPiratesDoNotRespawn?: boolean;
    /** chkGalaxyNewEmpiresDuringGame "Allow independent alien colonies to start new empires during the game" (Start.1.cs 3689
     *  → Galaxy.SpawnNewEmpires). Unset = true (Main.Part9.cs 2677 OtherEmpiresAllowNewEmpiresFromIndependentColonies). */
    spawnNewEmpires?: boolean;
    /** chkStartNewGameEnableTechTrading (Start.1.cs 3737 → Galaxy.AllowTechTrading). Unset = true (StartGameOptions.cs 64). */
    allowTechTrading?: boolean;
    /** chkStartNewGameEnableGiantKaltors (Start.1.cs 3738 → the Galaxy ctor). Unset = true (StartGameOptions.cs 66). */
    allowGiantKaltorGeneration?: boolean;
    /** tbarStartNewGameYourEmpireCorruption (0..3, Start.cs 4436 method_63: 0.9 / 1.1 / 1.3 / 1.5). Unset = 1
     *  (Main.Part9.cs 2689 YourEmpireCorruption = 1 → 1.1, the EmpireStart default). */
    empireCorruptionIndex?: number;
    /** tbarStartNewGameYourEmpireHomeSystem (0..4 Harsh, Trying, Normal, Agreeable, Excellent). Unset = 2 (Main.Part9.cs 2684). */
    homeSystemIndex?: number;
    /** cmbYourEmpireStartLocation index into startLocationsForShape(shape) (0 = (Random)). Unset = 0 (Main.Part9.cs 2682). */
    startLocationIndex?: number;
    // [wizardB1] end
    /** Our addition: "Scale debris fields with galaxy size" (Distant Worlds story). The wizard starts it ON
     *  (wizardStartGameOptions); defaultStartGameOptions (harness, test saves, pins) leaves it unset = off = the original fixed
     *  bands, so the pinned seed-1 saves stay byte-identical. It is part of the saved start options. */
    scaleDebrisFields?: boolean;
    /**
     * Mod layer (tasks/MODLAYER-DESIGN.md §3): the wizard's "Scenario" page. Absent / null = None (the faithful game).
     * The caller loads the scenario's overlay into the GameData it passes to toCreateGameOptions.
     */
    scenario?: StartScenarioChoice | null;
    /**
     * The Other Empires page's "Smarter AI (AI empires only)" add-on (scenarios/smarter-ai). The wizard folds it into
     * `scenario` (addons.ts withSmarterAI); absent / disabled = off.
     */
    smarterAI?: SmarterAIChoice;
}

/** The chosen scenario and its flag / param values (manifest defaults when absent). */
export interface StartScenarioChoice {
    /** The scenario the game starts: a single scenario id, or COMPOSITE_SCENARIO_ID ('addons') for several add-ons. */
    id: string;
    flags: Record<string, boolean>;
    params: Record<string, number>;
    /** Add-on picker: the add-ons the player ticked (index order); absent for a single scenario chosen directly. */
    addons?: string[];
}

/** The wizard's initial choice for a scenario: every flag / param at its manifest default. */
export function defaultScenarioChoice(manifest: ScenarioManifest): StartScenarioChoice {
    const flags: Record<string, boolean> = {};
    const params: Record<string, number> = {};
    for (const f of manifest.flags) flags[f.name] = f.default;
    for (const p of manifest.params) params[p.name] = p.default;
    return { id: manifest.id, flags, params };
}

/** Start-page summary text of a scenario choice ("None" without one). */
export function scenarioChoiceSummary(choice: StartScenarioChoice | null | undefined, manifests: readonly ScenarioManifest[]): string {
    if (choice == null) return 'None';
    if (choice.addons !== undefined) {
        // Add-on picker: every add-on that runs (ticked or required), by name.
        const model = addonPickerModel(addonCatalog(manifests), choice.addons);
        return model.finalNames.length > 0 ? model.finalNames.join(', ') : choice.addons.join(', ');
    }
    const m = manifests.find((x) => x.id === choice.id);
    const on = (m?.flags ?? []).filter((f) => choice.flags[f.name]).map((f) => f.label);
    const params = (m?.params ?? []).map((p) => `${p.label} ${choice.params[p.name] ?? p.default}`);
    const extras = [...on, ...params];
    return `${m?.name ?? choice.id}${extras.length > 0 ? ` (${extras.join(', ')})` : ''}`;
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
    /** M4z4: chkVictoryTimeStart (VictoryConditionsApplyWhen): apply the conditions only after startDateYears
     * (Start.1.cs 3792). Unset = unchecked. */
    timeStart?: boolean;
    /** M4z4: chkStoryReturnOfTheShakturi → VictoryConditions.EnableStoryEvents (Start.1.cs 3800). Unset = unchecked
     * (story events are deferred). */
    enableStoryEvents?: boolean;
    /** M4z4: chkStoryShadows → VictoryConditions.EnableStoryEventsShadows (Start.1.cs 3805). Unset = unchecked. Only offered
     *  in a PreWarp galaxy (Expansion 0): btnStartNewGameOtherEmpiresNext_Click (Start.1.cs 3098) unchecks it otherwise. */
    enableStoryEventsShadows?: boolean;
    /** [wizardB1] chkStoryDistantWorlds "Enable original Distant Worlds story events" → CreateGameFromSettings bool_7 →
     *  Galaxy.StoryDistantWorldsEnabled (Start.1.cs 3850, Start.2.cs 502). Unset = unchecked. */
    enableStoryDistantWorlds?: boolean;
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
        // Original defaults (Main.Part9.cs method_259): Territory / Population / Economy on at 33 %, apply after 20
        // years, time limit off at 30 years, victory threshold index 1 (80 %).
        territory: true,
        territoryPercent: 33,
        population: true,
        populationPercent: 33,
        economy: true,
        economyPercent: 33,
        timeLimit: false,
        timeLimitYears: 30,
        startDateYears: 20,
        timeStart: true,
        enableDisasterEvents: true,
        enableRaceSpecificConditions: true,
        enableRaceSpecificEvents: true,
        victoryThresholdPercentage: 0.8,
        // [wizardB1] the story box: Main.Part9.cs method_259 VictoryConditionsStoryEvents = true (Return of the Shakturi),
        // VictoryConditionsStoryEventsOriginal = true (Distant Worlds) and StartGameOptions.cs 68
        // VictoryConditionsStoryEventsShadows = true (offered only at Expansion 0, see toCreateGameOptions).
        enableStoryEvents: true,
        enableStoryEventsShadows: true,
        enableStoryDistantWorlds: true,
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
     * default 2000 — the C# default's 2 sectors * 1000, Main.Part9.cs
     * 2674-2675). The player may only colonise systems within this range
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

/** Task 06h (fixed wizdefaults): default ColonizationOptions matching the C#
 * default StartGameOptions, not the WinForms designer placeholders on the
 * slider/checkbox (those are overwritten at runtime). The actual defaults
 * come from method_259() in Main.Part9.cs:2674-2675:
 *   startGameOptions.ColonizationRangeEnforceLimit = true;
 *   startGameOptions.ColonizationRange = 2f;
 * ColonizationRange is in sectors; the wizard slider displays it * 1000
 * (Start.1.cs:3449 `val2 = (int)(startGameOptions.ColonizationRange * 1000f)`),
 * so 2f -> 2000 Kly. Colony influence range 100 %, same-system option
 * unchecked (unaffected by this fix). */
export function defaultColonizationOptions(): ColonizationOptions {
    return {
        enforceRangeLimits: true,
        colonizationRangeKly: 2000,
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
            // BaconStart.lowStarCount (BaconStart.cs 20 = 100): BaconSettings.txt lowStarCount (clamped to 10..100,
            // BaconMain.cs 726) is applied at game start, after a fresh launch's wizard (sim/baconInitialize.ts).
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

// ---- Custom galaxy size (not a port): the wizard's number boxes for the star count and the sector counts ----

/** The star-amount slider's presets (starCountFor 0..5) and the physical-size slider's (sectorsFor 0..4). */
export const STAR_COUNT_PRESETS: readonly number[] = [0, 1, 2, 3, 4, 5].map(starCountFor);
export const SECTOR_PRESETS: readonly number[] = [0, 1, 2, 3, 4].map(sectorsFor);
/** The star-count box's range. Below 50 the empire placement runs out of systems for a 10-empire start ("Could not locate
 *  capital!"); 8000 generates in ~25 s headless on 90×90 (4000: ~10 s; the Rim Frontier scenario's former cap). */
export const GALAXY_STAR_COUNT_MIN = 50;
export const GALAXY_STAR_COUNT_MAX = 8000;
/** A custom size's hard density cap (stars per sector): game-start placement (gameStartTail findLonely*, ring searches
 *  over crowded index cells) grows super-linearly with density — 4000 stars on 1×1 takes ~6 minutes. The original's
 *  densest preset is 87.5 (1400 stars on 4×4). */
export const GALAXY_MAX_STARS_PER_SECTOR = 100;
/** The density the original's presets span (stars per sector): 100 stars on 15×15 to 1400 on 4×4. The wizard warns outside. */
export const ORIGINAL_MIN_STARS_PER_SECTOR = 100 / (15 * 15);
export const ORIGINAL_MAX_STARS_PER_SECTOR = 1400 / (4 * 4);
export { CUSTOM_MIN_SECTORS, CUSTOM_MAX_SECTORS };

/** The galaxy's star count: the custom box value (clamped to the box's range for the sectors), else the preset. */
export function galaxyStarCount(o: Pick<StartGameOptions, 'starCountIndex' | 'customStarCount' | 'dimensionIndex' | 'customSectorWidth' | 'customSectorHeight'>): number {
    if (o.customStarCount === undefined) return starCountFor(o.starCountIndex);
    const { width, height } = galaxySectorCounts(o);
    return Math.min(clampStarCount(o.customStarCount), starCountMaxForSectors(width, height));
}

/** The galaxy's sector counts: the custom boxes, else the preset square. */
export function galaxySectorCounts(o: Pick<StartGameOptions, 'dimensionIndex' | 'customSectorWidth' | 'customSectorHeight'>): { width: number; height: number } {
    if (o.customSectorWidth !== undefined || o.customSectorHeight !== undefined) {
        const preset = sectorsFor(o.dimensionIndex);
        return { width: clampCustomSectors(o.customSectorWidth ?? preset), height: clampCustomSectors(o.customSectorHeight ?? preset) };
    }
    const n = sectorsFor(o.dimensionIndex);
    return { width: n, height: n };
}

/** True when the sector counts are not a preset square (the generation then bypasses the C# 4..15 clamp). */
export function galaxySectorsAreCustom(o: Pick<StartGameOptions, 'customSectorWidth' | 'customSectorHeight'>): boolean {
    return o.customSectorWidth !== undefined || o.customSectorHeight !== undefined;
}

/** True when the star count or the sector counts are not presets. */
export function galaxySizeIsCustom(o: Pick<StartGameOptions, 'customStarCount' | 'customSectorWidth' | 'customSectorHeight'>): boolean {
    return o.customStarCount !== undefined || galaxySectorsAreCustom(o);
}

function clampStarCount(n: number): number {
    const v = Math.round(Number.isFinite(n) ? n : 700);
    return Math.max(GALAXY_STAR_COUNT_MIN, Math.min(GALAXY_STAR_COUNT_MAX, v));
}

/** The star-count box's maximum for a sector area: GALAXY_STAR_COUNT_MAX, or less on a small custom galaxy. */
export function starCountMaxForSectors(width: number, height: number): number {
    return Math.max(GALAXY_STAR_COUNT_MIN, Math.min(GALAXY_STAR_COUNT_MAX, Math.floor(GALAXY_MAX_STARS_PER_SECTOR * width * height)));
}

/** The largest preset index whose star count is at most n (0 below the first): the slider bracket of a custom count. */
export function starCountIndexForCount(n: number): number {
    let best = 0;
    for (let i = 0; i < STAR_COUNT_PRESETS.length; i++) if (STAR_COUNT_PRESETS[i] <= n) best = i;
    return best;
}

/** The slider index whose sector preset is nearest to n (the bracket of a custom size). */
function dimensionIndexForSectors(n: number): number {
    let best = 0;
    for (let i = 0; i < SECTOR_PRESETS.length; i++) if (Math.abs(SECTOR_PRESETS[i] - n) < Math.abs(SECTOR_PRESETS[best] - n)) best = i;
    return best;
}

/** The star-amount index the game uses for the slider-keyed values (maximumEmpireAmountFor): the slider's own index for a
 *  preset count, its bracket for a custom one. */
function effectiveStarCountIndex(o: StartGameOptions): number {
    return o.customStarCount !== undefined ? starCountIndexForCount(galaxyStarCount(o)) : o.starCountIndex;
}

/** The star-count box's upper bound for the options' current sectors (GALAXY_MAX_STARS_PER_SECTOR per sector, at most
 *  GALAXY_STAR_COUNT_MAX). Every original preset is within it: the densest is 87.5 per sector. */
export function galaxyStarCountMax(o: Pick<StartGameOptions, 'dimensionIndex' | 'customSectorWidth' | 'customSectorHeight'>): number {
    const { width, height } = galaxySectorCounts(o);
    return starCountMaxForSectors(width, height);
}

/**
 * The star-count box: a preset value selects its slider index (and clears the custom value, so the game is the
 * original's); anything else is a custom count, clamped to GALAXY_STAR_COUNT_MIN..galaxyStarCountMax. Returns the stored count.
 */
export function setGalaxyStarCount(o: StartGameOptions, n: number): number {
    const v = Math.min(clampStarCount(n), galaxyStarCountMax(o));
    const preset = STAR_COUNT_PRESETS.indexOf(v);
    if (preset >= 0) {
        o.starCountIndex = preset;
        delete o.customStarCount;
    } else {
        o.starCountIndex = starCountIndexForCount(v);
        o.customStarCount = v;
    }
    return v;
}

/**
 * The "Sectors: W × H" boxes: a preset square selects its slider index (and clears the custom size); anything else is a
 * custom size, CUSTOM_MIN_SECTORS..CUSTOM_MAX_SECTORS each. The star count is re-clamped to the new size's density cap.
 */
export function setGalaxySectors(o: StartGameOptions, width: number, height: number): { width: number; height: number } {
    const w = clampCustomSectors(width);
    const h = clampCustomSectors(height);
    const preset = w === h ? SECTOR_PRESETS.indexOf(w) : -1;
    if (preset >= 0) {
        o.dimensionIndex = preset;
        delete o.customSectorWidth;
        delete o.customSectorHeight;
    } else {
        o.dimensionIndex = dimensionIndexForSectors(Math.max(w, h));
        o.customSectorWidth = w;
        o.customSectorHeight = h;
    }
    const stars = o.customStarCount ?? starCountFor(o.starCountIndex);
    if (stars > galaxyStarCountMax(o)) setGalaxyStarCount(o, stars);
    return { width: w, height: h };
}

/** The wizard's density warning: outside the original presets' stars-per-sector range, or null. */
export function galaxyDensityWarning(o: StartGameOptions): { kind: 'dense' | 'sparse'; starsPerSector: number; text: string } | null {
    if (!galaxySizeIsCustom(o)) return null;
    const { width, height } = galaxySectorCounts(o);
    const d = galaxyStarCount(o) / (width * height);
    if (d > ORIGINAL_MAX_STARS_PER_SECTOR) {
        return { kind: 'dense', starsPerSector: d, text: `Very dense: ${d.toFixed(0)} stars per sector (the original's densest is ${ORIGINAL_MAX_STARS_PER_SECTOR.toFixed(1)}). Systems crowd together and the galaxy may take a long time to generate.` };
    }
    if (d < ORIGINAL_MIN_STARS_PER_SECTOR) {
        const per = 1 / d;
        return { kind: 'sparse', starsPerSector: d, text: `Very sparse: one star per ${per.toFixed(1)} sectors (the original's sparsest is one per ${(1 / ORIGINAL_MIN_STARS_PER_SECTOR).toFixed(1)}). Empires may be unable to reach other systems.` };
    }
    return null;
}

// [todosweep2] begin
/** Research-cost box bounds (Start.cs 3140-3141 / Start.1.cs 4412-4413: Minimum 1, Maximum 999). */
export const GALAXY_RESEARCH_SPEED_MIN = 1;
export const GALAXY_RESEARCH_SPEED_MAX = 999;

/** Start.1.cs 4394 meEawywtba: "Research Costs" slider index (0 Very Expensive .. 4 Very Cheap, Start.cs 3200) → base tech
 * cost; the slider's ValueChanged (4408) writes `num / 1000` into the research-cost box. */
export function researchBaseTechCostForSliderIndex(index: number): number {
    switch (index) {
        case 0: return 480000;
        case 1: return 240000;
        case 2: return 120000;
        case 3: return 60000;
        case 4: return 30000;
        default: return 120000;
    }
}

/** Start.1.cs 4372 method_209: base tech cost → "Research Costs" slider index (Start.1.cs 3412). */
export function researchSpeedSliderIndexFor(baseTechCost: number): number {
    if (baseTechCost <= 30000) return 4;
    if (baseTechCost <= 60000) return 3;
    if (baseTechCost <= 120000) return 2;
    if (baseTechCost <= 240000) return 1;
    return 0;
}

/** Start.1.cs 3693 `num8 = (double)(numStartNewGameTheGalaxyResearchBaseTech.Value * 1000m)` → CreateGameFromSettings double_4. */
export function baseTechCostFor(galaxyResearchSpeed: number | undefined): number {
    const v = Math.min(GALAXY_RESEARCH_SPEED_MAX, Math.max(GALAXY_RESEARCH_SPEED_MIN, Math.trunc(galaxyResearchSpeed ?? 120)));
    return v * 1000;
}

/** Start.1.cs 3747 `empireStart.ColonizationRange = (float)sld…ColonizationRange.Value / 1000f * (float)Galaxy.SectorSize`
 * (float arithmetic; the slider value is thousandths of a sector, SectorSize = 2000000, Galaxy.3.cs 4970). */
export function colonizationRangeFor(sliderValue: number): number {
    return Math.fround(Math.fround(Math.fround(sliderValue) / 1000) * 2000000);
}
// [todosweep2] end

/**
 * Port of BaconStart.cs 84 method_61 (Start.cs 4410; Start.1.cs 3688 `num2 = method_61(star-density slider,
 * raceList_0)`, raceList_0 = the playable races, Start.cs 1321 ResolvePlayableRaces). The value reaches
 * CreateGameFromSettings as int_2 and becomes Galaxy.MaximumEmpireAmount (Start.2.cs 115 / Galaxy.4.cs 2152),
 * which scales the pirate-faction count (Galaxy.9.cs 22) and caps new empires (events.ts).
 */
export function maximumEmpireAmountFor(starCountIndex: number, playableRaceCount: number): number {
    switch (starCountIndex) {
        case 0:
            return 12;
        case 1:
            return 15;
        case 2:
            return 18;
        case 3:
        case 4:
        case 5:
        case 6:
            return Math.max(playableRaceCount, 20);
        default:
            return 10;
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
            // BaconStart.lowIndependentLifeValue (BaconStart.cs 21 = 150). BaconSettings.txt
            // (lowIndependentLifeValue, BaconMain.cs 786) only sets it at game start, after the
            // wizard of a fresh launch has run (see sim/baconInitialize.ts), so the default applies.
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

/** Port of Start.1.cs 3192 Start.method_190 (pirate-proximity combo → Galaxy.PirateProximity). */
export function pirateProximityFor(index: number): number {
    switch (index) {
        case 0:
            return 0;
        case 1:
            return 1;
        case 2:
            return 2;
        default:
            return 0;
    }
}

/** Start.1.cs 3722-3736: pirate-strength slider → EmpireStart.PirateShipMaintenanceFactor (then
 * Galaxy.PirateShipMaintenanceFactor, Start.2.cs 498). Out of range keeps the EmpireStart default 0.4
 * (EmpireStart.cs 35). */
export function pirateShipMaintenanceFactorFor(index: number): number {
    switch (index) {
        case 0:
            return 1.0;
        case 1:
            return 0.7;
        case 2:
            return 0.4;
        case 3:
            return 0.25;
        default:
            return 0.4;
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

// [wizardB1] begin
/** The "Playstyle" page buttons (Start.cs 3495 method_41; wjhRtsSwmsa values set by their Click handlers, Start.cs 5188-5583).
 *  The Custom types lead to the full wizard (Start.1.cs btnStartNewGameStart_Click); the others to the one-page "Jump Start"
 *  (Start.cs btnJumpStartTheGalaxyNext_Click). The Ancient Galaxy loads a prebuilt galaxy map (not ported). */
export type WizardEmpireType = 'CustomStandard' | 'CustomPirate' | 'ShadowsStandard' | 'ShadowsPirate' | 'ClassicEra' | 'ReturnOfTheShakturi' | 'Legends' | 'Introductory';

/** Start.cs bool_2 (PlayAsAPirate) of each playstyle. */
export function empireTypeIsPirate(t: WizardEmpireType | undefined): boolean {
    return t === 'CustomPirate' || t === 'ShadowsPirate';
}

/** Start.cs bool_3 (an Age of Shadows start) of each playstyle. */
export function empireTypeIsShadows(t: WizardEmpireType | undefined): boolean {
    return t === 'ShadowsStandard' || t === 'ShadowsPirate';
}

/** The playstyles that use the full wizard; the rest use the Jump Start page. */
export function empireTypeIsCustom(t: WizardEmpireType | undefined): boolean {
    return t === undefined || t === 'CustomStandard' || t === 'CustomPirate';
}

/**
 * What a Playstyle button's Click handler does to the options (Start.cs 5188-5583): records the type (wjhRtsSwmsa), and for
 * Custom Pirate raises a PreWarp tech-level slider to Normal (Start.cs 5240 nVkoJxpyvO).
 */
export function applyEmpireTypeChoice(options: StartGameOptions, type: WizardEmpireType): void {
    options.empireType = type;
    if (type === 'CustomPirate' && (options.empireTechLevelIndex ?? 1) === 0) options.empireTechLevelIndex = 1;
}

/** Start.1.cs 3204 method_191 / 3215 method_192: pirate playstyle combo index → PiratePlayStyle (out of range = Balanced). */
export function piratePlayStyleFor(index: number | undefined): PiratePlayStyle {
    switch (index) {
        case 0: return PiratePlayStyle.Balanced;
        case 1: return PiratePlayStyle.Pirate;
        case 2: return PiratePlayStyle.Mercenary;
        case 3: return PiratePlayStyle.Smuggler;
        default: return PiratePlayStyle.Balanced;
    }
}

/** Start.cs 4436 method_63 (corruption slider → EmpireStart.CorruptionMultiplier; out of range 1.1). */
export function corruptionMultiplierFor(index: number | undefined): number {
    switch (index) {
        case 0: return 0.9;
        case 1: return 1.1;
        case 2: return 1.3;
        case 3: return 1.5;
        default: return 1.1;
    }
}

/** tbarStartNewGameYourEmpireHomeSystem labels (Start.cs 3445) → EmpireStart.HomeSystemFavourability (Start.cs ahrJhtHrDu). */
export const HOME_SYSTEM_NAMES = ['Harsh', 'Trying', 'Normal', 'Agreeable', 'Excellent'] as const;
export function homeSystemFor(index: number | undefined): (typeof HOME_SYSTEM_NAMES)[number] {
    return HOME_SYSTEM_NAMES[index ?? 2] ?? 'Normal';
}

/** cmbYourEmpireStartLocation items per galaxy shape (Start.1.cs 3998-4064 method_205; the combo resets to (Random) when the
 *  shape changes). */
export function startLocationsForShape(shape: GalaxyShape): string[] {
    switch (shape) {
        case GalaxyShape.Elliptical: return ['(Random)', 'Deep Core', 'Outer Core', 'Inner Rim', 'Outer Rim'];
        case GalaxyShape.Spiral: return ['(Random)', 'Deep Core', 'Outer Core', 'Far Regions'];
        case GalaxyShape.Ring: return ['(Random)', 'Core', 'Void', 'Rim'];
        default: return ['(Random)', 'Center', 'Edge'];
    }
}

/** Start.1.cs 3189 method_189: the suggested colony influence range factor (Jump Start uses it as the factor). */
export function colonyInfluenceRangeSuggestion(starCount: number, sectorsX: number, sectorsY: number): number {
    const val = Math.sqrt(((sectorsX * sectorsY) / starCount) * 7.0);
    return Math.max(0.5, Math.min(2.0, val));
}
// [wizardB1] end

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
    // Galaxy.4.cs LoadFlagShapes: a theme's images\ui\flagshapes\ folder replaces the stock list (themeAssets.ts).
    const themed = themeFlagShapeUrls(false);
    if (themed !== null && themed.length > 0) return themed[Math.min(Math.max(0, index), themed.length - 1)];
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
 * (colony prevalence / alien life 2 of 5, space creatures 1 of 4, aggression 2 of 5, difficulty 2 of 5); difficulty scaling is off.
 * Task 06g: victory conditions start at the C# defaults (all types
 * unchecked = sandbox mode; see defaultVictoryConditions). Task 06h:
 * colonization and other-empires options start at the wizard control
 * defaults (see defaultColonizationOptions / defaultOtherEmpiresOptions). */
/** The new-game wizard's initial options: defaultStartGameOptions plus our additions that default ON for real games. */
export function wizardStartGameOptions(): StartGameOptions {
    return { ...defaultStartGameOptions(), scaleDebrisFields: true };
}

export function defaultStartGameOptions(): StartGameOptions {
    return {
        // Original defaults (Main.Part9.cs method_259): Elliptical, GalaxySize 3 (700 stars), GalaxyDimensions 3 (10x10).
        shape: GalaxyShape.Elliptical,
        starCountIndex: 3,
        dimensionIndex: 3,
        seed: Date.now() % 2147483647,
        raceName: '',
        empireName: '',
        governmentId: -1,
        flagShapeIndex: -1,
        primaryColor: '',
        secondaryColor: '',
        // [wizardB1] slider positions of the original's fresh-install StartGameOptions (Main.Part9.cs 2659-2708 method_259) and
        // the standard preset (Start.cs 3317-3324 method_38): Colony Prevalence 2, Alien Life 2 (400), Space Creatures 2 (0.6),
        // Aggression 1 (1.1), Difficulty 1 (1.0).
        colonyPrevalenceIndex: 2,
        alienLifeIndex: 2,
        spaceCreaturesIndex: 2,
        // Pirates page: the standard preset Start.cs 3302-3303 (Pirates 3 = 0.4, proximity 1 = Average) and
        // Main.Part9.cs 2665-2667 (GalaxyPirates 3, GalaxyPirateStrength 2, GalaxyPirateProximity 1).
        piratesIndex: 3,
        pirateProximityIndex: 1,
        pirateStrengthIndex: 2,
        galaxyResearchSpeed: 120, // [todosweep2] Main.Part9.cs 2668
        aggressionIndex: 1,
        difficultyIndex: 1,
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
        // [wizardB1] Main.Part9.cs method_259 / StartGameOptions.cs field defaults.
        empireType: 'CustomStandard',
        piratePlayStyleIndex: 0,
        destroyedPiratesDoNotRespawn: false,
        spawnNewEmpires: true,
        allowTechTrading: true,
        allowGiantKaltorGeneration: true,
        empireCorruptionIndex: 1,
        homeSystemIndex: 2,
        startLocationIndex: 0,
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
    // [wizardB1] The Shadows / Classic Era / Return of the Shakturi / Legends playstyles start from the Jump Start page.
    // Start.cs 5374 btnStartNewGameIntroductory_Click: the one-click preset game.
    if (startOptions.empireType === 'Introductory') return toCreateGameOptionsIntroductory(startOptions, gameData, systemNames);
    if (!empireTypeIsCustom(startOptions.empireType)) return toCreateGameOptionsJumpStart(startOptions, gameData, systemNames);
    const o = startOptions;
    // Start.cs bool_2: the "Custom Game as Pirate Faction" playstyle (Start.cs nVkoJxpyvO).
    const playAsPirate = empireTypeIsPirate(o.empireType);
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
        // Start.1.cs 3708-3709 (ahrJhtHrDu: the Home System slider; cmbYourEmpireStartLocation).
        homeSystemFavourability: homeSystemFor(o.homeSystemIndex),
        startLocation: startLocationsForShape(o.shape)[o.startLocationIndex ?? 0] ?? '(Random)',
        age: playerAge,
        techLevel: playerTechLevel,
        // Start.1.cs 3717-3719: flag colours and shape.
        primaryColor: parseHexColor(o.primaryColor),
        secondaryColor: parseHexColor(o.secondaryColor),
        flagShape: o.flagShapeIndex,
        // [wizardB1] Start.1.cs 3720-3721: the corruption slider (method_63) and the pirate playstyle (method_191).
        corruptionMultiplier: corruptionMultiplierFor(o.empireCorruptionIndex),
        ...(playAsPirate ? { playAsPirate: true, piratePlayStyle: piratePlayStyleFor(o.piratePlayStyleIndex) } : {}),
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
                proximityDistance: '(Random)',
                age: rowAge,
                techLevel: rowTech,
                corruptionMultiplier: EMPIRE_START_CORRUPTION_MULTIPLIER,
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
                proximityDistance: '(Random)',
                age,
                techLevel,
                corruptionMultiplier: EMPIRE_START_CORRUPTION_MULTIPLIER,
            });
        }
    }

    return {
        seed: o.seed,
        shape: o.shape,
        // Start.2.cs 113 `galaxy_0.Age = int_5` (int_5 = the Expansion slider value, Start.1.cs 3845).
        galaxyAge: value,
        // Start.1.cs 3686 method_60(star density) / 3690 method_69(physical size); a custom size (the wizard's number boxes,
        // not a port) passes its own counts and bypasses the Galaxy ctor's 4..15 clamp.
        starCount: galaxyStarCount(o),
        sectorWidth: galaxySectorCounts(o).width,
        sectorHeight: galaxySectorCounts(o).height,
        ...(galaxySectorsAreCustom(o) ? { customGalaxyDimensions: true } : {}),
        systemNames,
        gameData,
        colonyPrevalence: colonyPrevalenceFor(o.colonyPrevalenceIndex),
        // Start.1.cs 3688 num2 = method_61(star density, playable races) → Galaxy.MaximumEmpireAmount (Start.2.cs 115).
        // A custom star count uses its slider bracket (starCountIndexForCount).
        maximumEmpireAmount: maximumEmpireAmountFor(effectiveStarCountIndex(o), gameData.races.filter((r) => r.playable).length),
        player,
        aiEmpires,
        allowEmpiresInSameSystem: o.colonization.allowSameSystemAsOtherEmpires,
        // M4z4: Start.1.cs 3772-3805 VictoryConditions from the victory page (Galaxy.GlobalVictoryConditions,
        // Start.2.cs 501-506 / 2026) and Start.2.cs 496 difficulty scaling.
        victoryConditions: victoryConditionsFromWizard(wizardVictoryForStart(o.victory, playAsPirate, value), value),
        difficultyLevelScalesAsPlayerApproachesVictory: o.difficultyScaling,
        // [wizardB1] Start.1.cs 3850 chkStoryDistantWorlds.Checked → CreateGameFromSettings bool_7 → Start.2.cs 502.
        storyDistantWorldsEnabled: o.victory.enableStoryDistantWorlds === true,
        // [wizardB1] Start.1.cs 3687-3694 / 3737-3741 → Start.2.cs 485 Galaxy ctor and 496-499: the Galaxy-page sliders and
        // the option checkboxes.
        lifePrevalence: alienLifeFor(o.alienLifeIndex), // num4 = method_67(Alien Life) → _LifePrevalence
        creaturePrevalence: spaceCreaturesFor(o.spaceCreaturesIndex), // num5 = method_62(Space Creatures) → _CreaturePrevalence
        aggressionLevel: aggressionFor(o.aggressionIndex), // num9 = method_71(Aggression) → _AggressionLevel
        difficultyLevel: difficultyFor(o.difficultyIndex), // EmpireStart.DifficultyLevel = method_201(Difficulty)
        spawnNewEmpires: o.spawnNewEmpires ?? true, // @checked = chkGalaxyNewEmpiresDuringGame
        allowTechTrading: o.allowTechTrading ?? true,
        allowGiantKaltorGeneration: o.allowGiantKaltorGeneration ?? true,
        scaleDebrisFields: o.scaleDebrisFields ?? false,
        destroyedPiratesDoNotRespawn: o.destroyedPiratesDoNotRespawn ?? false,
        // Start.1.cs 3818-3821: method_104 runs on the auto-generated list only.
        autogeneratedAiEmpires: manual.length === 0,
        // Start.1.cs 3745 `empireStart.EmpireTerritoryColonyInfluenceRangeFactor = (float)sld…ColonyInfluenceRange.Value / 100f`
        // (unconditional; → Galaxy.EmpireTerritoryColonyInfluenceRangeFactor, Start.2.cs 507). The slider is a percent:
        // passing it undivided made every colony's influence radius 100x (one or two empires owned the whole galaxy, and
        // the starting-colony placement of a Mature/Old start then looped forever finding no unclaimed system).
        empireTerritoryColonyInfluenceRangeFactor: Math.fround(clampColonization(o.colonization).colonyInfluenceRangePercent / 100),
        // Pirates page: Start.1.cs 3691 num6 = method_66(tbarStartNewGameTheGalaxyPirates.Value) → Galaxy.PiratePrevalence
        // (Start.2.cs 107); 3692 num7 = method_190() → Galaxy.PirateProximity (Start.2.cs 108); 3722-3736 pirate
        // strength → Galaxy.PirateShipMaintenanceFactor (Start.2.cs 498).
        piratePrevalence: piratesFor(o.piratesIndex),
        pirateProximity: pirateProximityFor(o.pirateProximityIndex ?? 1),
        pirateShipMaintenanceFactor: pirateShipMaintenanceFactorFor(o.pirateStrengthIndex ?? 2),
        // [todosweep2] Start.1.cs 3693 num8 (research-cost box × 1000) → CreateGameFromSettings double_4 → Galaxy ctor
        // baseTechCost; Start.1.cs 3746-3747 → EmpireStart.ColonizationRangeEnforceLimit / ColonizationRange → Start.2.cs 508-509.
        baseTechCost: baseTechCostFor(o.galaxyResearchSpeed),
        colonizationRangeEnforceLimit: o.colonization.enforceRangeLimits,
        colonizationRange: colonizationRangeFor(clampColonization(o.colonization).colonizationRangeKly),
        // Mod layer: the scenario's switches (the overlay itself comes in with gameData.scenario).
        ...(o.scenario != null ? { scenarioFlags: { ...o.scenario.flags }, scenarioParams: { ...o.scenario.params } } : {}),
    };
}

// [wizardB1] begin
/** EmpireStart.cs 28 `_CorruptionMultiplier = 1.1`: every AI start the wizard builds keeps it (Start.1.cs 3753-3763 / 3577). */
export const EMPIRE_START_CORRUPTION_MULTIPLIER = 1.1;

/** The victory page's story box as btnStartNewGameStart_Click reads it (Start.1.cs 3800 / 3805): a pirate start has Return of
 *  the Shakturi unchecked and disabled (Start.cs 3776 method_45), and Shadows is unchecked and disabled unless the galaxy is
 *  PreWarp (Start.1.cs 3098 btnStartNewGameOtherEmpiresNext_Click). */
export function wizardVictoryForStart(v: VictoryConditions, playAsPirate: boolean, galaxyExpansionIndex: number): VictoryConditions {
    return {
        ...v,
        enableStoryEvents: playAsPirate ? false : v.enableStoryEvents === true,
        enableStoryEventsShadows: galaxyExpansionIndex === 0 ? v.enableStoryEventsShadows === true : false,
    };
}

/**
 * Port of Start.cs 5613 btnJumpStartTheGalaxyNext_Click: the one-page "Jump Start" behind the Shadows Standard / Shadows
 * Pirate / Classic Era / Return of the Shakturi / Legends playstyles. The page sets galaxy shape, star amount, physical size,
 * difficulty (+ scaling), race, and government or pirate playstyle; everything else is the fixed preset below.
 */
export function toCreateGameOptionsJumpStart(o: StartGameOptions, gameData: GameData, systemNames: string[]): CreateGameOptions {
    const type = o.empireType ?? 'ClassicEra';
    const bool2 = empireTypeIsPirate(type);
    const bool3 = empireTypeIsShadows(type);
    // Start.cs 5619 random_ (clock-seeded → seeded from the galaxy seed, as toCreateGameOptions does).
    const random_ = new Random((o.seed ^ 0x5619) | 0);
    const num = galaxyStarCount(o); // 5621 method_60(star density) (or the custom star count)
    const playable = gameData.races.filter((r) => r.playable).length;
    const num2 = maximumEmpireAmountFor(effectiveStarCountIndex(o), playable); // 5622 method_61
    let num3 = colonyPrevalenceFor(2); // 5624 method_64(2)
    let num4 = alienLifeFor(2); // 5625 method_67(2)
    const num5 = spaceCreaturesFor(2); // 5626 method_62(2)
    let num6 = piratesFor(3); // 5627 method_66(3)
    let num7 = 1; // 5628 pirate proximity
    const num8 = 120000.0; // 5629 base tech cost
    let num9 = aggressionFor(1); // 5630 method_71(1)
    const num10 = bool3 ? 0 : 1; // 5631-5635 galaxy Expansion
    const { width: sectorsX, height: sectorsY } = galaxySectorCounts(o); // 5676 method_69 (or the custom sectors)
    // 5650-5661 player: Starting age (PreWarp in a PreWarp galaxy), Normal tech (PreWarp for a Shadows standard empire).
    const playerAge = num10 === 0 ? 0 : 1;
    const playerTechLevel = bool3 && !bool2 ? 0.0 : 0.5;
    const governmentName = o.governmentId >= 0 ? gameData.governments[o.governmentId]?.name ?? '(Random)' : '(Random)';
    const player: EmpireStartOptions = {
        name: undefined, // 5638 empireStart.Name = string.Empty (the engine names it)
        race: o.raceName === '' ? '(Random)' : o.raceName,
        governmentStyle: governmentName, // 5648 method_73
        startLocation: startLocationsForShape(o.shape)[o.startLocationIndex ?? 0] ?? '(Random)', // 5649 cmbYourEmpireStartLocation
        homeSystemFavourability: 'Normal', // 5650
        age: playerAge,
        techLevel: playerTechLevel,
        // 5662-5667: the race's default flag (createGame keeps the race defaults when no flag shape is passed).
        corruptionMultiplier: corruptionMultiplierFor(1), // 5668 method_63(1)
        ...(bool2 ? { playAsPirate: true, piratePlayStyle: piratePlayStyleFor(o.piratePlayStyleIndex) } : {}), // 5669 method_192
    };
    // 5682-5697: num2 auto-generated AI empires (Age = method_57(method_109(..)), TechLevel = method_89(num10)).
    const aiEmpires: EmpireStartOptions[] = [];
    for (let i = 0; i < num2; i++) {
        aiEmpires.push({
            race: '(Random)',
            governmentStyle: '(Random)',
            homeSystemFavourability: 'Normal',
            proximityDistance: '(Random)',
            age: aiEmpireAge(num10, random_),
            techLevel: aiTechLevelForExpansion(num10, new Random((o.seed ^ 0x5695 ^ (i + 1)) | 0)),
            corruptionMultiplier: EMPIRE_START_CORRUPTION_MULTIPLIER,
        });
    }
    // 5699-5710: economy / population / territory at 33 %, no time limit, conditions apply after 10 years, threshold 80 %.
    const startStarDate = startStarDateForAge(num10);
    const victoryConditions = new RuntimeVictoryConditions();
    victoryConditions.economy = true;
    victoryConditions.economyPercent = 33.0;
    victoryConditions.population = true;
    victoryConditions.populationPercent = 33.0;
    victoryConditions.territory = true;
    victoryConditions.territoryPercent = 33.0;
    victoryConditions.timeLimit = false;
    victoryConditions.timeLimitDate = 0;
    victoryConditions.startDate = startStarDate + 10 * REAL_SECONDS_IN_GALACTIC_YEAR * 1000;
    victoryConditions.victoryThresholdPercentage = 0.8;
    let flag2 = false; // bool_7: StoryDistantWorldsEnabled
    switch (type) {
        case 'Legends':
            victoryConditions.enableStoryEventsShadows = false;
            flag2 = true;
            victoryConditions.enableStoryEvents = true;
            victoryConditions.enableDisasterEvents = true;
            victoryConditions.enableRaceSpecificEvents = true;
            victoryConditions.enableRaceSpecificVictoryConditions = true;
            break;
        case 'ReturnOfTheShakturi':
            victoryConditions.enableStoryEventsShadows = false;
            flag2 = true;
            victoryConditions.enableStoryEvents = true;
            victoryConditions.enableDisasterEvents = false;
            victoryConditions.enableRaceSpecificEvents = false;
            victoryConditions.enableRaceSpecificVictoryConditions = false;
            break;
        case 'ClassicEra':
            victoryConditions.enableStoryEventsShadows = false;
            flag2 = true;
            victoryConditions.enableStoryEvents = false;
            victoryConditions.enableDisasterEvents = false;
            victoryConditions.enableRaceSpecificEvents = false;
            victoryConditions.enableRaceSpecificVictoryConditions = false;
            break;
        case 'ShadowsPirate':
            victoryConditions.enableStoryEventsShadows = true;
            flag2 = false;
            victoryConditions.enableStoryEvents = false;
            victoryConditions.enableDisasterEvents = true;
            victoryConditions.enableRaceSpecificEvents = true;
            victoryConditions.enableRaceSpecificVictoryConditions = true;
            num6 = piratesFor(4);
            num7 = 1;
            num3 = colonyPrevalenceFor(3);
            num4 = alienLifeFor(3);
            num9 = aggressionFor(2);
            break;
        case 'ShadowsStandard':
            victoryConditions.enableStoryEventsShadows = true;
            flag2 = false;
            victoryConditions.enableStoryEvents = true;
            victoryConditions.enableDisasterEvents = true;
            victoryConditions.enableRaceSpecificEvents = true;
            victoryConditions.enableRaceSpecificVictoryConditions = true;
            num6 = piratesFor(4);
            num7 = 0;
            num3 = colonyPrevalenceFor(3);
            num4 = alienLifeFor(3);
            num9 = aggressionFor(2);
            break;
    }
    return {
        seed: o.seed,
        shape: o.shape,
        galaxyAge: num10,
        starCount: num,
        sectorWidth: sectorsX,
        sectorHeight: sectorsY,
        ...(galaxySectorsAreCustom(o) ? { customGalaxyDimensions: true } : {}),
        systemNames,
        gameData,
        colonyPrevalence: num3,
        maximumEmpireAmount: num2,
        player,
        aiEmpires,
        victoryConditions,
        difficultyLevelScalesAsPlayerApproachesVictory: o.difficultyScaling,
        storyDistantWorldsEnabled: flag2,
        scaleDebrisFields: o.scaleDebrisFields ?? false,
        // 5679: EmpireTerritoryColonyInfluenceRangeFactor = (float)method_189(num, sectors, sectors).
        empireTerritoryColonyInfluenceRangeFactor: Math.fround(colonyInfluenceRangeSuggestion(num, sectorsX, sectorsY)),
        piratePrevalence: num6,
        pirateProximity: num7,
        pirateShipMaintenanceFactor: 0.4, // 5670
        baseTechCost: num8,
        colonizationRangeEnforceLimit: true, // 5680
        colonizationRange: Math.fround(2 * 2000000), // 5681 2f * (float)Galaxy.SectorSize
        lifePrevalence: num4,
        creaturePrevalence: num5,
        aggressionLevel: num9,
        difficultyLevel: difficultyFor(o.difficultyIndex), // 5673 method_201(tbarJumpStartTheGalaxyDifficulty)
        spawnNewEmpires: true, // 5623 flag
        allowTechTrading: true, // 5671
        allowGiantKaltorGeneration: true, // 5672
        destroyedPiratesDoNotRespawn: false, // 5675
        ageOfShadows: bool3,
        autogeneratedAiEmpires: true, // 5777 method_104
        ...(o.scenario != null ? { scenarioFlags: { ...o.scenario.flags }, scenarioParams: { ...o.scenario.params } } : {}),
    };
}
/** Start.2.cs 4108 method_115 / 4119 method_116: a random race of IntelligenceLevel >= 70 (from the playable races,
 *  raceList_0) not already in `taken`; "(Random)" when none is left. */
function introductoryRace(playable: readonly Race[], taken: readonly string[], random0: Random): string {
    const list: string[] = [];
    for (const item of playable) {
        if (item.intelligence >= 70 && !taken.some((t) => t.toLowerCase() === item.name.toLowerCase())) list.push(item.name);
    }
    return list.length > 0 ? list[random0.next(0, list.length)] : '(Random)';
}

/** Start.2.cs 3816 method_106(empireCount) → method_107 without a start list: every condition at 100 / count × 5 percent,
 *  clamped to 15-66, threshold 80 %. */
export function introductoryVictoryConditions(empireCount: number): RuntimeVictoryConditions {
    let num = (100.0 / empireCount) * 5.0;
    num = Math.max(Math.min(num, 66.0), 15.0);
    const v = new RuntimeVictoryConditions();
    v.economy = true;
    v.economyPercent = num;
    v.territory = true;
    v.territoryPercent = num;
    v.population = true;
    v.populationPercent = num;
    v.victoryThresholdPercentage = 0.8;
    return v;
}

/**
 * Port of Start.cs 5374 btnStartNewGameIntroductory_Click: "Introductory Game", no further pages. An Elliptical galaxy of
 * 700 stars (EmpireStart's default 10 × 10 sectors, colony influence factor 1, colonization range 3 000 000 enforced), the
 * player a random intelligent race (IntelligenceLevel >= 70) with a random government, an Agreeable home system, Starting
 * age and Normal tech, at difficulty 0.7 (method_201(0)); 15-19 AI empires of other intelligent races, Starting / Normal;
 * MaximumEmpireAmount 20, colony prevalence 1.0, alien life 700, space creatures 0.3, pirates 0.2 at medium proximity,
 * research cost 120000, aggression 1.1; victory at 25 % economy / territory / population (method_106(20)) with the Return
 * of the Shakturi and Distant Worlds stories, race events and race victory conditions on (VictoryConditions' defaults keep
 * the disaster events and the Shadows flag on). The C#'s clock-seeded Random comes from the galaxy seed here.
 */
export function toCreateGameOptionsIntroductory(o: StartGameOptions, gameData: GameData, systemNames: string[]): CreateGameOptions {
    const random = new Random((o.seed ^ 0x5374) | 0);
    const num2 = 700;
    const num3 = 20;
    const num4 = random.next(15, 20);
    const playable = gameData.races.filter((r) => r.playable);
    // method_112(null, list, "Starting", "Normal", random): method_114 builds its exclusion list from empireStart_0 only
    // (empty for the player), then from the player and the AI starts made so far.
    const playerRace = introductoryRace(playable, [], random);
    const taken: string[] = [playerRace];
    const player: EmpireStartOptions = {
        name: undefined,
        race: playerRace,
        governmentStyle: '(Random)',
        startLocation: '(Random)',
        homeSystemFavourability: 'Agreeable',
        age: 1,
        techLevel: STARTING_TECH_LEVEL,
        corruptionMultiplier: EMPIRE_START_CORRUPTION_MULTIPLIER, // EmpireStart._CorruptionMultiplier default 1.1
    };
    const aiEmpires: EmpireStartOptions[] = [];
    for (let i = 0; i < num4; i++) {
        const race = introductoryRace(playable, taken, random);
        taken.push(race);
        aiEmpires.push({
            race,
            governmentStyle: '(Random)',
            homeSystemFavourability: 'Normal',
            proximityDistance: '(Random)',
            age: 1,
            techLevel: STARTING_TECH_LEVEL,
            corruptionMultiplier: EMPIRE_START_CORRUPTION_MULTIPLIER,
        });
    }
    const victoryConditions = introductoryVictoryConditions(num3);
    victoryConditions.enableStoryEvents = true;
    victoryConditions.enableRaceSpecificEvents = true;
    victoryConditions.enableRaceSpecificVictoryConditions = true;
    return {
        seed: o.seed,
        shape: GalaxyShape.Elliptical,
        galaxyAge: 1, // list[9] = method_57("Starting")
        starCount: num2,
        sectorWidth: 10,
        sectorHeight: 10,
        systemNames,
        gameData,
        colonyPrevalence: 1.0,
        maximumEmpireAmount: num3,
        player,
        aiEmpires,
        victoryConditions,
        difficultyLevelScalesAsPlayerApproachesVictory: false,
        storyDistantWorldsEnabled: true, // list[19] = true
        empireTerritoryColonyInfluenceRangeFactor: 1.0,
        piratePrevalence: 0.2,
        pirateProximity: 1,
        pirateShipMaintenanceFactor: 0.4,
        baseTechCost: 120000.0, // meEawywtba(2)
        colonizationRangeEnforceLimit: true,
        colonizationRange: 3000000.0,
        lifePrevalence: 700,
        creaturePrevalence: 0.3,
        aggressionLevel: 1.1,
        difficultyLevel: difficultyFor(0), // method_201(0) = 0.7
        spawnNewEmpires: true,
        allowTechTrading: true,
        allowGiantKaltorGeneration: true,
        destroyedPiratesDoNotRespawn: false,
        ageOfShadows: false,
        autogeneratedAiEmpires: false,
    };
}
// [wizardB1] end

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

/** '#rrggbb' → 0xRRGGBB (undefined when empty / malformed: the race default stays). */
export function parseHexColor(c: string): number | undefined {
    const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
    return m === null ? undefined : parseInt(m[1], 16);
}
