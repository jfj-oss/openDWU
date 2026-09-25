// Galaxy generation: star generation (all GalaxyShape variants), system
// naming, gas clouds, and solar-system contents (planets, moons, asteroid
// fields, resources, treasure asteroids). Ports of
// DistantWorlds.Types.Galaxy (Galaxy.cs / Galaxy.3.cs / Galaxy.4.cs /
// Galaxy.5.cs / Galaxy.6.cs / Galaxy.9.cs). Nebula/galaxy-location
// generation is ported (01e: GalaxyNebulaeGenerator + GalaxyLocation);
// population and creatures are ported (01f2: SelectPopulation, 01f3:
// SelectCreatures) — see the `TODO(port)` markers below for what remains.

import { EmpireActivityList } from './pirates/empireActivity';
import { Random } from './random';
import type { Cargo } from './cargo';
import { newHabitatConstructionQueue } from './construction/constructionYard';
import { Creature, CreatureType } from './creature';
import { GalaxyLocation, GalaxyLocationEffectType, GalaxyLocationShape, GalaxyLocationType } from './galaxyLocation';
import { GalaxyNebulaeGenerator } from './galaxyNebulaeGenerator';
import { setupAlienRacePopulations, type EmpireStart } from './raceRegions';
import { Population, PopulationList } from './population';
import {
    GalaxyShape,
    Habitat,
    HabitatCategoryType,
    HabitatType,
    IndustryType,
    type SystemInfo,
} from './types';
import type { Race } from './data/races';
import type { Resource } from './data/resources';
import { buildResourceSystem, type ResourceSystem } from './resourceSystem';
import { netSort } from './netSort';
import { SystemVisibilityStatus, type GalaxyResourceMap } from './visibility';
import { EmpireTerritory, strategicValue } from './territory';
import { buildResearchStatic, type ResearchStatic } from './researchSystem';
import { buildComponentStatic } from './componentStatic';
import { ensureHabitatManufacturingQueue } from './manufacturingQueue';
import { createHabitatDockingBays, createPopulatedHabitatDockingBays } from './logistics/dockingBays';

// C# string.CompareTo (culture-sensitive; .NET 5+ uses ICU).
const NAME_COLLATOR = new Intl.Collator('en-US');
function compareGroupNames(a: Habitat[], b: Habitat[]): number {
    if (b.length === 0) return a.length > 0 ? 1 : 0;
    if (a.length === 0) return -1;
    return NAME_COLLATOR.compare(a[0].name, b[0].name);
}
import type { Empire } from './empire';
import type { GameData } from './data/gameData';
import type { CharacterFileRow, CharacterNames } from './data/characters';
import type { Design } from './design';
import { findNewestCanBuild, resolveSubRoleDescription } from './designGeneration';
import type { BuiltObject } from './builtObject';
import type { RaceFamily } from './data/raceFamilies';
import { BuiltObjectRole } from './data/designSpecifications';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { MIN_TIME } from './tick/simTime';
import { canEmpireColonizeHabitat, habitatResourcesHaveSuperLuxury } from './exploration';
import type { SchedulerState } from './tick/scheduler';
import { createGalaxyOrderList, type OrderList } from './logistics/orders';

// Port of Galaxy.cs static fields (Galaxy.3.cs InitializeStatics sets
// these): SectorSizeX = SectorSizeY = 2_000_000, IndexSize = 400_000.
const SECTOR_SIZE = 2_000_000;
const INDEX_SIZE = 400_000;
const MAXIMUM_EMPIRE_COUNT = 255; // Galaxy.3.cs:5034
// Port of Galaxy.3.cs InitializeStatics: MaxSolarSystemSize = 23000.
const MAX_SOLAR_SYSTEM_SIZE = 23000;
// Port of Galaxy.3.cs InitializeStatics: MaxMoonOrbitSize = 1200.
const MAX_MOON_ORBIT_SIZE = 1200;
// Port of Galaxy.3.cs InitializeStatics: MovementDecelerationRange = 150 (Galaxy.3.cs:4983;
// Galaxy.cs:170 `public static readonly int`).
export const MOVEMENT_DECELERATION_RANGE = 150;

// C# int.ToString("000") for the non-negative Design.BuildCount.
function buildCount000(n: number): string {
    return String(n).padStart(3, '0');
}

// Galaxy.5.cs SelectRandomUniqueStandardShipName word lists (exact order, incl. duplicates).
const STANDARD_SHIP_NAME_ADJECTIVES: readonly string[] = ["Lucky", "Grand", "Bright", "Sublime", "Lonesome", "Charming", "Enchanted", "Brazen", "Serene", "Placid", "Quiet", "Friendly", "Happy", "Fortunate", "Merry", "Smiling", "Cautious", "Idle", "Brisk", "Bold", "Solitary", "Radiant", "Lavish", "Handsome", "Majestic", "Bountiful", "Gallant", "Intrepid", "Valiant", "Stout", "Superb", "Regal", "Noble", "Hardy", "Strange", "Shining", "Glowing", "Lively", "Daunting", "Slippery", "Crafty", "Risky", "Sneaky", "Lone", "Arduous", "Tenacious", "Outrageous", "Distant", "Doubtful", "Jubilant", "Cheerful", "Adamant", "Resolute", "Curious", "Extravagant", "Audacious", "Futile", "Vain", "Aimless", "Cryptic", "Prudent", "Worthy", "Honest", "Venerable", "Precious", "Celestial", "Foolish", "Roaming", "Blind", "Dusty", "Lost", "Solar", "Swift", "Stellar", "Last", "Wild", "Express", "Rusty", "Far", "Broken", "Fading", "Silent", "Ancient", "Pristine", "Shabby", "Tired", "Weary", "Secretive", "Conspicuous", "Hidden", "Dubious", "Devious", "Elusive", "Shady", "Wily", "Lawless", "Crooked", "Forbidden", "Wry", "Cowering", "Muffled", "Grasping", "Hasty", "Mocking", "Humble", "Sombre", "Solemn", "Eager", "Deep", "Meagre", "Frugal", "Daring", "Nimble", "Feeble", "Arcane", "Profound", "Obscure", "Graceful", "Vanishing", "Trusty", "Late", "Decrepit", "Grimy", "Surly", "Dire", "Tarnished", "Galactic"];
const STANDARD_SHIP_NAME_NOUNS: readonly string[] = ["Queen", "Princess", "Sun", "Star", "Hope", "Chance", "Gamble", "Aspiration", "Traveller", "Voyager", "Wayfarer", "Scoundrel", "Wanderer", "Trader", "Merchant", "Encounter", "Scout", "Obsession", "Moon", "Empress", "Dream", "Fantasy", "Illusion", "Mirage", "Ruse", "Bluff", "Miracle", "Novelty", "Wonder", "Scheme", "Impulse", "Venture", "Wager", "Adventure", "Intrigue", "Luxury", "Challenge", "Maneuver", "Smuggler", "Lurker", "Prowler", "Imposter", "Subterfuge", "Mystery", "Enterprise", "Escapade", "Peril", "Ploy", "Quest", "Force", "Whim", "Adversity", "Navigator", "Ruse", "Gambit", "Subterfuge", "Pearl", "Jewel", "Treasure", "Prize", "Hoard", "Rogue", "Agent", "Envoy", "Guide", "Lady", "Pathfinder", "Expedition", "Journey", "Odyssey", "Errand", "Sojourn", "Bargain", "Way", "Guardian", "Dawn", "Echo", "Interlude", "Ranger", "Victory", "Renegade", "Starseeker", "Starwind", "Solace", "Pride", "Rimrunner", "Starway", "Beggar", "Rover", "Starfire", "Raider", "Deal", "Rendezvous", "Twilight", "Courage", "Burden", "Spirit", "Nightstar", "Profit", "Relic", "Bootlegger", "Shroud", "Remorse", "Disturbance", "Trailblazer", "Resolution", "Decoy", "Culprit", "Destiny", "Tramp", "Vagrant", "Splendor", "Starrider", "Negotiator", "Partisan", "Discovery", "Distress", "Rebel", "Evasion", "Pathway", "Endeavour", "Memory", "Orbit", "Impasse", "Nova"];
// Galaxy.5.cs SelectRandomUniqueMilitaryShipName word lists (exact order, incl. duplicates).
const MILITARY_SHIP_NAME_ADJECTIVES: readonly string[] = ["Grievous", "Prime", "Deadly", "Grand", "Black", "Swift", "Mighty", "Dreadful", "Crushing", "Shattering", "Silent", "Dark", "Supreme", "Ultimate", "Lethal", "Implacable", "Immortal", "Majestic", "Forceful", "Potent", "Great", "Ruinous", "Sinister", "Bleak", "Grim", "Devious", "Overwhelming", "Merciless", "Fearsome", "Cruel", "Iron", "Cunning", "Sly", "Fearless", "Insidious", "Evil", "Fearless", "Eternal", "Terrible", "Looming", "Overpowering", "Smashing", "Angry", "Raging", "Relentless", "Intrepid", "Wrathful", "Bitter", "Evasive", "Decisive", "Proud", "Indomitable", "Elusive", "Inevitable", "Belligerent", "Courageous", "Invincible", "Shrouded", "Growling", "Elite", "Final", "Assured", "Lamented", "Wailing", "Banished", "Discarded", "Worthy", "Desperate", "Reckless", "Fatal", "Hostile", "Tenacious", "Crimson", "Red", "Scarlet", "Formidable"];
const MILITARY_SHIP_NAME_NOUNS: readonly string[] = ["Zenith", "Hand", "Vengeance", "Axe", "Dagger", "Eclipse", "Moon", "Sun", "Phantom", "Executioner", "Revenge", "Horizon", "Star", "Crucible", "Action", "Devastation", "Shadow", "Exploit", "Reprisal", "Surprise", "Strike", "Judgment", "Courage", "Stealth", "Enigma", "Mystery", "Fist", "Death", "Warrior", "Assassin", "Rendezvous", "Fate", "Destiny", "Doom", "Despair", "Curse", "Thunder", "Demise", "Revolution", "Annihilation", "Dominator", "Triumph", "Victory", "Conquest", "Invader", "Downfall", "Chaos", "Turmoil", "Anarchy", "Rebellion", "Sting", "Leader", "Master", "Victor", "Assault", "Cataclysm", "Tyrant", "Plague", "Fury", "Justice", "Reckoning", "Emancipator", "Defender", "Defiance", "Liberty", "Retribution", "Adversary", "Sentinel", "Sentry", "Ravager", "Subjugator", "Starfall", "Vigilance", "Starstream", "Inquisitor", "Swarm", "Intruder", "Bandit", "Allegiance", "Behemoth", "Emperor", "Firestorm", "Nemesis", "Onslaught", "Predator", "Rampage", "Stalker", "Trap", "Arrow", "Skirmish", "Spectre", "Hero", "Verdict", "Mandate", "Dictator", "Decree", "Revolt", "Protector", "Bastion", "Vindication", "Guardian", "Shield", "Champion", "Advocate", "Challenger", "Provocation", "Spite", "Mutiny", "Repulser", "Resistance", "Liberator", "Deception", "Exile", "Outcast", "Fugitive", "Renegade", "Cutlass", "Affliction", "Conflict", "Aggressor", "Banshee", "Battle", "Firelance", "Chariot", "Conqueror", "Demolisher", "Desolation", "Eminence", "Encounter", "Enforcer", "Eviscerator", "Exactor", "Fireclaw", "Firestorm", "Dragon", "Gauntlet", "Claw", "Hammer", "Hunter", "Hydra", "Intimidator", "Mauler", "Mayhem", "Monarch", "Nexus", "Rage", "Sovereign", "Scorpion", "Scourge", "Serpent", "Terror", "Vendetta", "Warlord", "Wolf", "Nightfall", "Night", "Legacy", "Backstab", "Fire", "Marauder", "Nova", "Raider"];

// Default cloud-image count for the nebula generator. The renderer
// should pass the actual number of
// /assets/dwu/images/environment/nebulae/*.png files via
// GenerateGalaxyOptions.cloudImageCount; pictureRef only selects
// which cloud image to draw, and Next(0, N) consumes one RNG sample
// regardless of N, so the generation stream is unaffected by the
// count.
const DEFAULT_CLOUD_IMAGE_COUNT = 40;

export interface GenerateGalaxyOptions {
    seed: number;
    shape: GalaxyShape;
    starCount: number;
    sectorWidth: number;
    sectorHeight: number;
    colonyPrevalence?: number;
    systemNames: string[];
    // Parsed game data (resource definitions, ...). When omitted, no
    // resources are generated (pre-01d behavior).
    gameData?: GameData;
    // Number of nebula cloud images available to the renderer (see
    // DEFAULT_CLOUD_IMAGE_COUNT). Only affects pictureRef values, not
    // the RNG stream.
    cloudImageCount?: number;
    // Port of Galaxy.4.cs ctor: AggressionLevel (default 1.0) drives
    // aggressiveRacesRequired = 3/2/1/0 for >= 1.5 / >= 1.3 / >= 1.1 / else.
    aggressionLevel?: number;
    // Empire starts (resolved race + projected colony amount each). When
    // omitted/empty no race regions are created and SetupAlienRacePopulations
    // consumes zero Rnd calls (pre-01f1 behavior).
    empireStarts?: EmpireStart[];
}

export class Galaxy {
    rnd: Random;
    // Port of Galaxy.cs static CryptoRnd (CryptoRandom, unseeded). The C#
    // class uses an unseeded static RNG for resource prevalence/abundance
    // rolls and the random resource ordering; to keep generation
    // deterministic we substitute a second seeded stream derived from the
    // galaxy seed. (Documented deviation.)
    cryptoRnd: Random;
    // Parsed resource definitions (ResourceSystem.Resources), passed in via
    // GenerateGalaxyOptions.gameData.
    resources: Resource[] = [];
    // Task C2c-3: Galaxy.ResearchNodeDefinitionsStatic + ComponentDefinitionsStatic.
    researchStatic: ResearchStatic | null = null;
    /** GameData.designSpecificationTexts (designTemplates/<race>/[pirate/]<sub>.txt). */
    designSpecificationTexts: Map<string, string> = new Map();
    /** Galaxy.DesignNames (designNames.txt families). */
    designNames: string[][] = [];
    /** Galaxy.DifficultyLevel (Galaxy.cs 465; wizard setting, default 1.0). */
    difficultyLevel = 1.0;
    // Task C2c-2: Galaxy.EmpireTerritory + EmpireTerritoryColonyInfluenceRangeFactor (Galaxy.cs:726).
    empireTerritory = new EmpireTerritory();
    empireTerritoryColonyInfluenceRangeFactor = 1;
    // Task C2a: empires and colony naming (Galaxy.cs).
    empires: Empire[] = [];
    pirateEmpires: Empire[] = [];
    independentEmpire: Empire | null = null;
    playerEmpire: Empire | null = null;
    colonyNames: string[] | null = null;
    colonyNameIndex = 0;
    // Task C2a: Galaxy.ResourceSystem (strategic/luxury lists, RelativeImportance).
    resourceSystem: ResourceSystem = buildResourceSystem([], []);
    sizeX = 0;
    sizeY = 0;
    sectorSize = SECTOR_SIZE;
    sectorWidth: number;
    sectorHeight: number;
    starCount: number;
    galaxyShape: GalaxyShape;
    habitats: Habitat[] = [];
    systems: SystemInfo[] = [];
    // Port of Galaxy.cs RandomSeed (the seed the main Rnd and the
    // nebula generator are both seeded from).
    randomSeed: number;
    // Port of Galaxy.cs _GalaxyLocations.
    galaxyLocations: GalaxyLocation[] = [];
    // Port of Galaxy.cs _GalaxyLocationIndex ([IndexMaxX][IndexMaxY]
    // grid of GalaxyLocation lists, IndexSize = 400_000).
    private galaxyLocationIndex: GalaxyLocation[][][] = [];
    // Port of Galaxy.cs _ColonyPrevalence (defaults to 1.0).
    colonyPrevalence = 1.0;
    // Port of Galaxy.cs _CreaturePrevalence (defaults to 1.0 in the C# ctor).
    creaturePrevalence = 1.0;
    // Port of Galaxy.cs AllowGiantKaltorGeneration (true in the C# ctor).
    allowGiantKaltorGeneration = true;
    // Port of Galaxy.cs Creatures (CreatureList, populated by
    // SelectCreatures/GenerateCreatureAtHabitat — Galaxy.6.cs:654/723).
    creatures: Creature[] = [];
    // Task 08h: C# CurrentDateTime modeled as game seconds (advanced by step).
    currentTimeSeconds = 0;
    // C#: Galaxy._NextCreatureID / SilverMistCreatureCount (Galaxy.cs).
    nextCreatureId = 0;
    silverMistCreatureCount = 0;
    // Port of Galaxy.cs Races (RaceList, loaded from GameData in the ctor).
    races: Race[] = [];
    // Port of Galaxy.cs AllowRaceStartingCharacters (Galaxy.cs 692, default true; Start.2.cs
    // 500/706/717/1478 toggle it). Read by characters.ts (GenerateStartingCharacters).
    allowRaceStartingCharacters = true;
    // Galaxy ctor (Galaxy.4.cs 2133-2134) inputs of LoadAgentNames / SetRaceStartupCharacters:
    // parsed characterNames.txt and characters/<race>.txt rows (GameData). characters.ts builds
    // Galaxy._AgentFirstNames/_AgentLastNames and Race.AvailableCharacters from them per galaxy.
    characterNames: CharacterNames | null = null;
    characterFiles: Map<string, CharacterFileRow[]> | null = null;
    // Port of Galaxy.cs habitat-race lists (_ContinentalRaces etc.),
    // populated by SetupAlienRacePopulations (raceRegions.ts).
    continentalRaces: Race[] = [];
    marshySwampRaces: Race[] = [];
    desertRaces: Race[] = [];
    oceanRaces: Race[] = [];
    iceRaces: Race[] = [];
    volcanicRaces: Race[] = [];
    barrenRockRaces: Race[] = [];

    // Port of Galaxy.cs _StarClusterLocations / _StarClusterPortions
    // (used by the ClustersEven/ClustersVaried shapes).
    private starClusterLocations: { x: number; y: number }[] = [];
    private starClusterPortions: number[] = [];

    // Port of Galaxy.4.cs SystemNames / SystemNamesUsedPlain / SystemNamesUsedAlternative.
    private systemNames: string[];
    private systemNamesUsedPlain: boolean[];
    private systemNamesUsedAlternative: boolean[];

    // Port of Galaxy.6.cs SelectPopulation state (Galaxy.cs fields):
    // _RaceUsed (bool[Races.Count], lazily allocated),
    // _RaceIndependentColonyCount (List<int>, lazily allocated — note the
    // source sizes it by Races.Count but indexes it by race.PictureRef, a
    // quirk preserved here). IndependentCount is public in C# and exposed
    // here for tests; _LifePrevalence defaults to 1000 in the C# ctor.
    private raceUsed: boolean[] | null = null;
    private raceIndependentColonyCount: number[] | null = null;
    independentCount = 0;
    lifePrevalence = 1000;
    age = 0; // C#: _Age (always 0 in new-game generation; set from galaxy age at load time only)
    // Port of Galaxy.cs _PiratePrevalence (double; set by GenerateGalaxy, Galaxy.4.cs 2144, and
    // Start.2.cs 107 `galaxy_0.PiratePrevalence = double_3`). Read by SelectRuins (ruins.ts);
    // createGame must copy CreateGameOptions.piratePrevalence here before ruins are placed.
    piratePrevalence = 0;
    // Port of Galaxy.cs RuinCount (int, 603) and _RuinsHabitats (HabitatList, 613) — ruins.ts.
    ruinCount = 0;
    ruinsHabitats: Habitat[] = [];
    // Task 07a: habitats with a parent, sorted once by orbit depth so step()
    // advances parents before children (stars have no parent; planets before
    // their moons). Rebuilt when habitats change.
    private stepOrder: Habitat[] = [];
    private stepOrderDirty = true;

    constructor(seed: number, shape: GalaxyShape, starCount: number, sectorWidth: number, sectorHeight: number, systemNames: string[], colonyPrevalence?: number) {
        this.randomSeed = seed;
        this.rnd = new Random(seed);
        this.cryptoRnd = new Random(Math.imul(seed, 0x5bd1e995) | 0);
        this.galaxyShape = shape;
        this.starCount = starCount;
        this.sectorWidth = sectorWidth;
        this.sectorHeight = sectorHeight;
        this.systemNames = systemNames;
        if (colonyPrevalence !== undefined) {
            this.colonyPrevalence = colonyPrevalence;
        }
        this.systemNamesUsedPlain = new Array(systemNames.length).fill(false);
        this.systemNamesUsedAlternative = new Array(systemNames.length).fill(false);
        this.setGalaxyPhysicalDimensions(sectorWidth, sectorHeight);
        // Port of the C# ctor's field initializers (_Age = 0,
        // _RaceUsed = null, _RaceIndependentColonyCount = null,
        // IndependentCount = 0, _LifePrevalence = 1000). The class-field
        // initializers above run before the ctor body, so reset them here
        // for parity with a freshly constructed Galaxy.
        this.raceUsed = null;
        this.raceIndependentColonyCount = null;
        this.independentCount = 0;
        this.lifePrevalence = 1000;
        this.age = 0;
        // Port of the C# ctor's remaining field initializers.
        this.creaturePrevalence = 1.0;
        this.allowGiantKaltorGeneration = true;
        this.creatures = [];
    }

    // Task 07a: advance the galaxy by game time (ms). Every habitat with a
    // parent moves along its orbit via Habitat.advanceOrbit(gameMs / 1000)
    // (port of Habitat.cs Move, called every tick from Habitat.DoTasks),
    // parents before children — stars have no parent, planets move before
    // their moons. The depth-sorted order is computed once and cached.
    step(gameMs: number): void {
        if (this.stepOrderDirty) {
            this.rebuildStepOrder();
        }
        const totalSeconds = gameMs / 1000;
        for (const habitat of this.stepOrder) {
            habitat.advanceOrbit(totalSeconds);
        }
        // Task 08h: Creature.DoTasks for every creature (the C# UI drives
        // the viewed system's creatures, Main.Part11.cs 597). Iterate a copy:
        // DoTasks can add (Split/Reproduce) or remove (teardown) creatures.
        this.currentTimeSeconds += totalSeconds;
        for (const creature of this.creatures.slice()) {
            if (!creature.hasBeenDestroyed) {
                creature.doTasks(this.currentTimeSeconds);
            }
        }
    }

    // ---- Task C2c-1: GalaxyIndex grids + ring search (Galaxy.7.cs) ----
    // C#: HabitatList[][] HabitatIndex / SystemInfoList[][] SystemsIndex,
    // IndexSize = 400000, IndexMaxX/Y = SizeX/SizeY / IndexSize.
    habitatIndexGrid: Habitat[][][] = [];
    systemsIndexGrid: SystemInfo[][][] = [];

    get indexMaxX(): number {
        return Math.trunc(this.sizeX / INDEX_SIZE);
    }

    get indexMaxY(): number {
        return Math.trunc(this.sizeY / INDEX_SIZE);
    }

    // Task M3c: C# BuiltObjectList[][] BuiltObjectIndex, sized like HabitatIndex
    // (Galaxy.4.cs 2110-2114).
    builtObjectIndexGrid: BuiltObject[][][] = [];

    initIndexGrids(): void {
        this.habitatIndexGrid = [];
        this.systemsIndexGrid = [];
        this.builtObjectIndexGrid = [];
        for (let i = 0; i < this.indexMaxX; i++) {
            this.habitatIndexGrid.push(Array.from({ length: this.indexMaxY }, () => []));
            this.systemsIndexGrid.push(Array.from({ length: this.indexMaxY }, () => []));
            this.builtObjectIndexGrid.push(Array.from({ length: this.indexMaxY }, () => []));
        }
    }

    // Port of Galaxy.7.cs ResolveIndex(int x, int y) + CorrectIndexCoords.
    resolveIndex(x: number, y: number): { x: number; y: number } {
        let x2 = Math.trunc(Math.trunc(x) / INDEX_SIZE);
        let y2 = Math.trunc(Math.trunc(y) / INDEX_SIZE);
        if (x2 < 0) x2 = 0;
        else if (x2 >= this.indexMaxX) x2 = this.indexMaxX - 1;
        if (y2 < 0) y2 = 0;
        else if (y2 >= this.indexMaxY) y2 = this.indexMaxY - 1;
        return { x: x2, y: y2 };
    }

    // Port of Galaxy.1.cs UpdateSystemInfo(playerEmpire) (840): DetermineSystemInfo for every system (Systems
    // order) + SystemsIndex membership. With a player empire, PlayerPotentialColonies is computed against its newest
    // buildable colony-ship design (Designs.FindNewestCanBuild(ColonyShip)) and ColonizableHabitatTypesForEmpire.
    // No Rnd. (Task M4t: player variant.)
    updateSystemInfo(playerEmpire: Empire | null = null): void {
        let latestColonyDesign: Design | null = null;
        let colonizableHabitatTypes: HabitatType[] = [];
        if (playerEmpire !== null) {
            // DesignList.FindNewestCanBuild(subRole) (DesignList.cs 140): the empire is the first design's owner.
            const designs = playerEmpire.designs;
            const designsEmpire = designs.length > 0 && designs[0] != null ? ((designs[0].empire as Empire | null) ?? null) : null;
            latestColonyDesign = findNewestCanBuild(designs, BuiltObjectSubRole.ColonyShip, designsEmpire);
            colonizableHabitatTypes = playerEmpire.colonizableHabitatTypesForEmpire();
        }
        for (const sys of this.systems) {
            this.determineSystemInfo(sys, playerEmpire, colonizableHabitatTypes, latestColonyDesign);
            const c = this.resolveIndex(sys.systemStar.xpos, sys.systemStar.ypos);
            const cell = this.systemsIndexGrid[c.x][c.y];
            if (!cell.includes(sys)) cell.push(sys);
        }
    }

    // Port of Galaxy.1.cs DetermineSystemInfo(system, playerEmpire, colonizableHabitatTypes, latestColonyDesign)
    // (873): planet/moon/blockade/independent counts, ruins/scenery/research-bonus/plague flags, the player's
    // potential-colony flag, and the dominant empire = highest total StrategicValue (ties: larger population),
    // others listed in first-seen order. Writes the fields in place (C# CopyFromOther of the returned `system`).
    determineSystemInfo(sys: SystemInfo, playerEmpire: Empire | null = null, colonizableHabitatTypes: HabitatType[] = [], latestColonyDesign: Design | null = null): void {
        const empires: Empire[] = [];
        const sv: number[] = [];
        const cc: number[] = [];
        const pop: number[] = [];
        let num = 0;
        let num2 = 0;
        let num3 = 0;
        let num4 = 0;
        let plagueId = -1;
        let flag = false;
        let hasRuins = false;
        let hasScenery = false;
        let hasResearchBonus = false;
        if (sys.systemStar.scenicFactor > 0) hasScenery = true;
        if (sys.systemStar.researchBonus > 0) hasResearchBonus = true;
        for (const h of this.systemHabitatsOf(sys.systemStar.systemIndex)) {
            if (h.category === HabitatCategoryType.Asteroid) continue;
            if (h.ruin !== null) hasRuins = true;
            if (h.scenicFactor > 0) hasScenery = true;
            if (h.researchBonus > 0) hasResearchBonus = true;
            if (h.category === HabitatCategoryType.Planet) num++;
            else if (h.category === HabitatCategoryType.Moon) num2++;
            if (h.isBlockaded) num3++;
            if (h.plagueId >= 0) plagueId = h.plagueId;
            // C#: Empire == IndependentEmpire — also true while both are null.
            if (h.empire === this.independentEmpire) {
                num4++;
            } else if (
                playerEmpire !== null &&
                !flag &&
                canEmpireColonizeHabitat(this, playerEmpire, playerEmpire, h, colonizableHabitatTypes, latestColonyDesign) &&
                (h.quality >= 0.5 ||
                    (h.resources != null && habitatResourcesHaveSuperLuxury(this, h)) ||
                    (h.ruin !== null &&
                        (h.ruin.bonusDefensive > 0.0 ||
                            h.ruin.bonusDiplomacy > 0.0 ||
                            h.ruin.bonusHappiness > 0.0 ||
                            h.ruin.bonusResearchEnergy > 0.0 ||
                            h.ruin.bonusResearchHighTech > 0.0 ||
                            h.ruin.bonusResearchWeapons > 0.0 ||
                            h.ruin.bonusWealth > 0.0)))
            ) {
                flag = true;
            }
            if (h.empire !== null && h.empire !== this.independentEmpire) {
                let i = empires.indexOf(h.empire);
                if (i < 0) {
                    empires.push(h.empire);
                    sv.push(0);
                    cc.push(0);
                    pop.push(0);
                    i = empires.length - 1;
                }
                sv[i] += strategicValue(h);
                pop[i] += h.population.totalAmount;
                cc[i]++;
            }
        }
        let dom: Empire | null = null;
        let num6 = 0;
        let num7 = 0;
        let colonyCount = 0;
        for (let j = 0; j < empires.length; j++) {
            if (sv[j] > num6 || (sv[j] === num6 && pop[j] > num7)) {
                dom = empires[j];
                num6 = sv[j];
                num7 = pop[j];
                colonyCount = cc[j];
            }
        }
        sys.planetCount = num;
        sys.moonCount = num2;
        sys.blockadeCount = num3;
        sys.plagueId = plagueId;
        sys.independentColonyCount = num4;
        sys.hasRuins = hasRuins;
        sys.hasScenery = hasScenery;
        sys.hasResearchBonus = hasResearchBonus;
        if (playerEmpire !== null) sys.playerPotentialColonies = flag;
        sys.dominantEmpire = dom !== null ? { empire: dom, colonyCount, totalStrategicValue: num6 } : null;
        sys.otherEmpires = null;
        if (dom !== null) {
            for (let k = 0; k < empires.length; k++) {
                if (empires[k] === dom) continue;
                if (sys.otherEmpires === null) sys.otherEmpires = [];
                sys.otherEmpires.push({ empire: empires[k], colonyCount: cc[k], totalStrategicValue: sv[k] });
            }
        }
        sys.isDisputed = empires.length > 1;
    }

    // Port of Galaxy.7.cs DetermineClosestIndexEdges (int math).
    private determineClosestIndexEdges(x: number, y: number, l: number, r: number, t: number, b: number): { d: number; nx: number; ny: number } {
        let num = x - INDEX_SIZE * l;
        if (num < 0) num = 536870911;
        let num2 = INDEX_SIZE * (r + 1) - x;
        if (num2 > this.indexMaxX * INDEX_SIZE) num2 = 536870911;
        let num3 = y - INDEX_SIZE * t;
        if (num3 < 0) num3 = 536870911;
        let num4 = INDEX_SIZE * (b + 1) - y;
        if (num4 > this.indexMaxY * INDEX_SIZE) num4 = 536870911;
        let val: number;
        let nx: number;
        if (num < num2) {
            val = num;
            nx = -1;
        } else {
            val = num2;
            nx = 1;
        }
        let val2: number;
        let ny: number;
        if (num3 < num4) {
            val2 = num3;
            ny = -1;
        } else {
            val2 = num4;
            ny = 1;
        }
        return { d: Math.min(val, val2), nx, ny };
    }

    // Port of the ring-search loop shared by every Galaxy FindNearest*/FastFind*
    // (Galaxy.7.cs DetermineSectorBoundaries 2513 + BuildIndexListForSearching
    // 2603). `inIndex` is the per-cell search (C# *InIndex), returning the
    // cell's best habitat and its (non-squared) distance.
    ringSearch<T>(x: number, y: number, inIndex: (cx: number, cy: number) => { item: T | null; distance: number }): T | null {
        const ix = Math.trunc(x);
        const iy = Math.trunc(y);
        let num = Number.MAX_VALUE;
        let result: T | null = null;
        const start = this.resolveIndex(ix, iy);
        const bounds = { l: start.x, r: start.x, t: start.y, b: start.y };
        let num2 = 0;
        let num3 = 0;
        let iterationCount = 0;
        while (iterationCount < 10000 && (iterationCount++, num > num3)) {
            // DetermineSectorBoundaries
            let e = this.determineClosestIndexEdges(ix, iy, bounds.l, bounds.r, bounds.t, bounds.b);
            let row = -1;
            let col = -1;
            if (num2 === 0) {
                row = bounds.t;
                col = bounds.l;
                num3 = e.d;
            } else {
                if (e.nx === -1) {
                    bounds.l--;
                    if (bounds.l < 0) {
                        bounds.r++;
                        bounds.l = 0;
                        if (bounds.r > this.indexMaxX - 1) bounds.r = this.indexMaxX - 1;
                        col = bounds.r;
                    } else col = bounds.l;
                } else if (e.nx === 1) {
                    bounds.r++;
                    if (bounds.r > this.indexMaxX - 1) {
                        bounds.l--;
                        bounds.r = this.indexMaxX - 1;
                        if (bounds.l < 0) bounds.l = 0;
                        col = bounds.l;
                    } else col = bounds.r;
                }
                if (e.ny === -1) {
                    bounds.t--;
                    if (bounds.t < 0) {
                        bounds.b++;
                        bounds.t = 0;
                        if (bounds.b > this.indexMaxY - 1) bounds.b = this.indexMaxY - 1;
                        row = bounds.b;
                    } else row = bounds.t;
                } else if (e.ny === 1) {
                    bounds.b++;
                    if (bounds.b > this.indexMaxY - 1) {
                        bounds.t--;
                        bounds.b = this.indexMaxY - 1;
                        if (bounds.t < 0) bounds.t = 0;
                        row = bounds.t;
                    } else row = bounds.b;
                }
                e = this.determineClosestIndexEdges(ix, iy, bounds.l, bounds.r, bounds.t, bounds.b);
                num3 = e.d;
            }
            // BuildIndexListForSearching
            const cells: [number, number][] = [];
            for (let i = bounds.l; i <= bounds.r; i++) cells.push([i, row]);
            for (let j = bounds.t; j <= bounds.b; j++) if (j !== row) cells.push([col, j]);
            for (const [cx, cy] of cells) {
                // C# indexes the jagged arrays directly; -1 rows/cols never
                // occur because both edges always move on a later step.
                if (cx < 0 || cy < 0 || cx >= this.indexMaxX || cy >= this.indexMaxY) continue;
                const r = inIndex(cx, cy);
                if (r.distance < num) {
                    result = r.item;
                    num = r.distance;
                }
            }
            num2++;
            if (num2 > this.indexMaxX) break;
        }
        return result;
    }

    private static nearestIn(list: readonly Habitat[], x: number, y: number, pred: (h: Habitat) => boolean, calc: (a: number, b: number, c: number, d: number) => number): { item: Habitat | null; distance: number } {
        let habitat: Habitat | null = null;
        let distance = Number.MAX_VALUE;
        for (const h of list) {
            const dx = x - h.xpos;
            const dy = y - h.ypos;
            const num = dx * dx + dy * dy;
            if (num < distance && pred(h)) {
                habitat = h;
                distance = num;
            }
        }
        if (habitat !== null) distance = calc(x, y, habitat.xpos, habitat.ypos);
        return { item: habitat, distance };
    }

    // Port of Galaxy.7.cs FindNearestUncolonizedHabitat (2239): planet/moon of
    // the type (Undefined = any), unowned or independent.
    findNearestUncolonizedHabitat(x: number, y: number, habitatType: HabitatType): Habitat | null {
        const ix = Math.trunc(x);
        const iy = Math.trunc(y);
        return this.ringSearch(x, y, (cx, cy) => {
            let habitat: Habitat | null = null;
            let distance = Number.MAX_VALUE;
            for (const h of this.habitatIndexGrid[cx][cy]) {
                if (h.empire !== null && h.empire !== this.independentEmpire) continue;
                const num = this.calculateDistanceSquared(ix, iy, h.xpos, h.ypos);
                if (!(num < distance) || (h.category !== HabitatCategoryType.Planet && h.category !== HabitatCategoryType.Moon)) continue;
                if (habitatType !== HabitatType.Undefined) {
                    if (h.type === habitatType) {
                        habitat = h;
                        distance = num;
                    }
                } else {
                    habitat = h;
                    distance = num;
                }
            }
            if (habitat !== null) distance = this.calculateDistance(ix, iy, habitat.xpos, habitat.ypos);
            return { item: habitat, distance };
        });
    }

    // Port of Galaxy.7.cs FindNearestHabitatWithResource(x, y, resourceId) (2462 → 2476 /
    // InIndex 2788): nearest habitat carrying the resource. habitatToExclude/empire/
    // systemToExclude are null and allowBases is true on this overload.
    findNearestHabitatWithResource(x: number, y: number, resourceId: number): Habitat | null {
        return this.ringSearch(x, y, (cx, cy) => {
            let habitat: Habitat | null = null;
            let distance = Number.MAX_VALUE;
            for (const h of this.habitatIndexGrid[cx][cy]) {
                if (h.resources.length <= 0) continue;
                if (h.resources.some((r) => r.resourceId === resourceId)) {
                    const num2 = this.calculateDistanceSquared(x, y, h.xpos, h.ypos);
                    if (num2 < distance) {
                        habitat = h;
                        distance = num2;
                    }
                }
            }
            if (habitat !== null) distance = this.calculateDistance(x, y, habitat.xpos, habitat.ypos);
            return { item: habitat, distance };
        });
    }

    /** Galaxy.MaxSolarSystemSize. */
    get maxSolarSystemSize(): number {
        return MAX_SOLAR_SYSTEM_SIZE;
    }
    /** Galaxy.MaximumEmpireCount (Galaxy.3.cs 5034). */
    get maximumEmpireCount(): number {
        return MAXIMUM_EMPIRE_COUNT;
    }

    // Port of Galaxy.7.cs FindNearestHabitat(x, y, type, exclude) (2332/2730).
    findNearestHabitatOfType(x: number, y: number, habitatType: HabitatType, habitatToExclude: Habitat | null = null): Habitat | null {
        const ix = Math.trunc(x);
        const iy = Math.trunc(y);
        return this.ringSearch(x, y, (cx, cy) => {
            let habitat: Habitat | null = null;
            let distance = Number.MAX_VALUE;
            for (const h of this.habitatIndexGrid[cx][cy]) {
                if (h === habitatToExclude) continue;
                const num = this.calculateDistanceSquared(ix, iy, h.xpos, h.ypos);
                if (!(num < distance)) continue;
                if (habitatType !== HabitatType.Undefined) {
                    if (h.type === habitatType) {
                        habitat = h;
                        distance = num;
                    }
                } else {
                    habitat = h;
                    distance = num;
                }
            }
            if (habitat !== null) distance = this.calculateDistance(ix, iy, habitat.xpos, habitat.ypos);
            return { item: habitat, distance };
        });
    }

    // Port of Galaxy.3.cs FindNearestColony(x, y, empire, threshold, includeIndependent)
    // (1739). StrategicValue >= threshold is taken as true for threshold 0
    // (the only value game setup uses). TODO(port): Habitat.StrategicValue.
    findNearestColony(x: number, y: number, empire: Empire | null, includeIndependentColonies: boolean): Habitat | null {
        return this.ringSearch(x, y, (cx, cy) =>
            Galaxy.nearestIn(
                this.habitatIndexGrid[cx][cy],
                x,
                y,
                (h) => (includeIndependentColonies || h.empire !== this.independentEmpire) && (h.owner === empire || empire === null) && h.population.items.length > 0,
                (a, b, c, d) => this.calculateDistance(a, b, c, d),
            ),
        );
    }

    // Port of Galaxy.6.cs FastFindNearestPlanetMoonOfTypesUnoccupiedSystem (2859).
    // Draws Rnd.Next(0, Habitats.Count) for every visited system with planets
    // that passes the dominant-empire / territory checks (C# order).
    fastFindNearestPlanetMoonOfTypesUnoccupiedSystem(x: number, y: number, empire: Empire | null, types: readonly HabitatType[] | null): Habitat | null {
        const ix = Math.trunc(x);
        const iy = Math.trunc(y);
        return this.ringSearch(x, y, (cx, cy) => {
            let habitat: Habitat | null = null;
            let distance = Number.MAX_VALUE;
            for (const sys of this.systemsIndexGrid[cx][cy]) {
                if (this.systemPlanetCount(sys) <= 0) continue;
                const dom = this.systemDominantEmpire(sys);
                if (dom !== null && dom !== empire) continue;
                const tid = this.checkEmpireTerritoryIdAtLocation(sys.systemStar.xpos, sys.systemStar.ypos);
                if (tid >= 0 && tid !== (empire?.empireId ?? -1)) continue;
                const hs = this.systemHabitatsOf(sys.systemStar.systemIndex);
                const num2 = this.rnd.next(0, hs.length);
                const consider = (h: Habitat): void => {
                    if ((h.category === HabitatCategoryType.Moon || h.category === HabitatCategoryType.Planet) && (types === null || types.length === 0 || types.includes(h.type)) && (h.empire === null || h.empire === this.independentEmpire)) {
                        const num3 = this.calculateDistanceSquared(ix, iy, h.xpos, h.ypos);
                        if (num3 < distance) {
                            habitat = h;
                            distance = num3;
                        }
                    }
                };
                for (let j = num2; j < hs.length; j++) consider(hs[j]);
                for (let k = 0; k < num2; k++) consider(hs[k]);
            }
            if (habitat !== null) distance = this.calculateDistance(ix, iy, (habitat as Habitat).xpos, (habitat as Habitat).ypos);
            return { item: habitat, distance };
        });
    }

    // SystemInfo.PlanetCount (cached by DetermineSystemInfo).
    systemPlanetCount(sys: SystemInfo): number {
        return sys.planetCount ?? 0;
    }

    // SystemInfo.DominantEmpire?.Empire (cached by DetermineSystemInfo).
    systemDominantEmpire(sys: SystemInfo): Empire | null {
        return sys.dominantEmpire?.empire ?? null;
    }

    // Port of Galaxy.cs CheckEmpireTerritoryIdAtLocation (3694).
    checkEmpireTerritoryIdAtLocation(x: number, y: number): number {
        return this.empireTerritory.checkLocationOwnership(this, x, y);
    }

    // Port of Galaxy.cs CheckEmpireTerritoryCanColonizeHabitat(empire, habitat)
    // (3607) / the 3-arg overload with `out canColonizeBecauseAtWar` (3613).
    // canColonizeBecauseAtWar is not consumed by any caller ported so far, so
    // only the bool result is returned.
    // TODO(port): DiplomaticRelation/war state (DiplomaticRelation.cs) is not
    // modeled — at game start no wars have been declared yet, so the "at war"
    // branch that would flip a hostile-territory colonization to allowed
    // never applies, matching the value C# would read at this point.
    checkEmpireTerritoryCanColonizeHabitat(empire: Empire, habitat: Habitat): boolean {
        const systemStar = this.determineHabitatSystemStar(habitat);
        const sys = this.systems[systemStar.systemIndex] as SystemInfo | undefined;
        let ownerId = -1;
        let disputed = false;
        if (sys === undefined || sys.dominantEmpire == null || sys.dominantEmpire.empire === null) {
            ownerId = this.empireTerritory.checkLocationOwnership(this, systemStar.xpos, systemStar.ypos);
        } else {
            if (sys.otherEmpires != null && sys.otherEmpires.length > 0) disputed = true;
            ownerId = sys.dominantEmpire.empire.empireId;
        }
        if (ownerId >= 0 && ownerId !== empire.empireId) {
            // C#: at war with the owner -> true (canColonizeBecauseAtWar).
            // No wars exist yet at game start, so this is always false here.
            return false;
        }
        if (disputed) return false;
        return true;
    }

    // Port of Galaxy.7.cs FindNearestColonizableHabitatUnoccupiedSystem(x, y,
    // empire) (1861) + FindNearestColonizableHabitatUnoccupiedSystemInIndex
    // (2093). `colonizableHabitatTypes` mirrors the C# local (computed via
    // empire.ColonizableHabitatTypesForEmpire(empire)) but, like C#, it is
    // never actually read by the per-index search below.
    findNearestColonizableHabitatUnoccupiedSystem(x: number, y: number, empire: Empire): Habitat | null {
        const ix = Math.trunc(x);
        const iy = Math.trunc(y);
        const design: Design | null = findNewestCanBuild(
            empire.designs,
            BuiltObjectSubRole.ColonyShip,
            empire.designs.length > 0 ? (empire.designs[0].empire as Empire | null) : null,
        );
        if (design === null) return null;
        return this.ringSearch(x, y, (cx, cy) => {
            let habitat: Habitat | null = null;
            let distance = Number.MAX_VALUE;
            let lastSystemIndex = -1;
            let hostileSystem = false;
            for (const h of this.habitatIndexGrid[cx][cy]) {
                if (lastSystemIndex !== h.systemIndex) {
                    const dom = this.systems[h.systemIndex]?.dominantEmpire ?? null;
                    hostileSystem = dom !== null && dom.empire !== null && dom.empire !== empire;
                    lastSystemIndex = h.systemIndex;
                }
                if (!hostileSystem && (h.empire === null || h.empire === this.independentEmpire) && this.checkEmpireTerritoryCanColonizeHabitat(empire, h)) {
                    const num2 = this.calculateDistanceSquared(ix, iy, h.xpos, h.ypos);
                    if (num2 < distance && empire.canDesignColonizeHabitat(design, h) && empire.determineColonizeLowQualityHabitat(h)) {
                        habitat = h;
                        distance = num2;
                    }
                }
            }
            if (habitat !== null) distance = this.calculateDistance(ix, iy, habitat.xpos, habitat.ypos);
            return { item: habitat, distance };
        });
    }

    // Port of Galaxy.7.cs FindNearestColonizableHabitat(x, y, empire) (1903) +
    // FindNearestColonizableHabitatInIndex (2215).
    findNearestColonizableHabitat(x: number, y: number, empire: Empire): Habitat | null {
        const ix = Math.trunc(x);
        const iy = Math.trunc(y);
        const design: Design | null = findNewestCanBuild(
            empire.designs,
            BuiltObjectSubRole.ColonyShip,
            empire.designs.length > 0 ? (empire.designs[0].empire as Empire | null) : null,
        );
        if (design === null) return null;
        return this.ringSearch(x, y, (cx, cy) => {
            let habitat: Habitat | null = null;
            let distance = Number.MAX_VALUE;
            for (const h of this.habitatIndexGrid[cx][cy]) {
                if ((h.empire === null || h.empire === this.independentEmpire) && this.checkEmpireTerritoryCanColonizeHabitat(empire, h)) {
                    const num = this.calculateDistanceSquared(ix, iy, h.xpos, h.ypos);
                    if (num < distance && empire.canDesignColonizeHabitat(design, h) && empire.determineColonizeLowQualityHabitat(h)) {
                        habitat = h;
                        distance = num;
                    }
                }
            }
            if (habitat !== null) distance = this.calculateDistance(ix, iy, habitat.xpos, habitat.ypos);
            return { item: habitat, distance };
        });
    }

    // Port of Galaxy.cs GetNextEmpireID (1323): _NextEmpireID starts at 0 and is
    // pre-incremented, so the first normal empire is 1 (the independent is 0).
    nextEmpireId = 0;
    getNextEmpireID(): number {
        if (this.nextEmpireId < MAXIMUM_EMPIRE_COUNT) {
            this.nextEmpireId++;
            return this.nextEmpireId;
        }
        throw new Error('Maximum allowable empire number exceeded!');
    }

    // Port of Galaxy.cs GetNextCreatureID (line 1333).
    getNextCreatureID(): number {
        if (this.nextCreatureId < 2147483647) {
            this.nextCreatureId++;
            return this.nextCreatureId;
        }
        throw new Error('Maximum allowable creature number exceeded!');
    }

    // ---- Task M3c: BuiltObjects in the galaxy (Galaxy.cs / Galaxy.4-7.cs) ----
    // C#: BuiltObjectList BuiltObjects (Galaxy.cs), _NextBuiltObjectID (starts at 0).
    builtObjects: BuiltObject[] = [];
    nextBuiltObjectId = 0;
    /**
     * C#: Galaxy.StartingAge (Start.2.cs sets it from the player's age setting before
     * empire generation). Read by CreateStateShips. The caller wiring createGame sets it.
     */
    startingAge = 0;
    /** C#: Galaxy._AsteroidFields (Galaxy.cs 587): each system's main asteroid belt (Galaxy.4.cs 2286). Task M3d. */
    asteroidFields: Habitat[][] = [];
    /** C#: Galaxy._SuperPirateFactionsGenerated (Galaxy.cs 573). Read/incremented by pirates.ts galaxyEventSuperPirates. */
    superPirateFactionsGenerated = 0;
    /** C#: Galaxy.IndependentColonies (Galaxy.cs 516); rebuilt by independentTraders.ts reviewIndependentColonies (Galaxy.1.cs 827). */
    independentColonies: Habitat[] = [];
    /** C#: Galaxy.PopularDesigns (Galaxy.cs 561); rebuilt by independentTraders.ts selectPopularDesignCandidates (Galaxy.7.cs 4698). */
    popularDesigns: Design[] = [];
    /**
     * C#: Galaxy.SubRoleNameSet (Start.2.cs:510, from Galaxy.LoadShipNames(shipNames.txt)).
     * TODO(port): LoadShipNames — the stock shipNames.txt lists no names for any sub-role,
     * so GetNames returns an empty (or no) list and GetCustomName always yields "";
     * null here is equivalent.
     */
    subRoleNameSet: Map<BuiltObjectSubRole, string[]> | null = null;

    /** Galaxy.MovementDecelerationRange (static readonly int, 150). */
    get movementDecelerationRange(): number {
        return MOVEMENT_DECELERATION_RANGE;
    }

    // Port of Galaxy.cs GetNextBuiltObjectID (1303).
    getNextBuiltObjectID(): number {
        if (this.nextBuiltObjectId < 2147483647) {
            this.nextBuiltObjectId++;
            return this.nextBuiltObjectId;
        }
        throw new Error('Maximum allowable ship number exceeded!');
    }

    // Port of Galaxy.6.cs SelectRelativeParkingPoint(minimumDistance, out x, out y) (3785)
    // and SelectRelativeParkingPoint(out x, out y) (3797, minimumDistance =
    // MovementDecelerationRange). Rnd: NextDouble, Next(0, 2), NextDouble.
    selectRelativeParkingPoint(minimumDistance: number = MOVEMENT_DECELERATION_RANGE): { x: number; y: number } {
        let num = this.rnd.nextDouble() * Math.PI;
        if (this.rnd.next(0, 2) === 1) {
            num *= -1.0;
        }
        const num2 = minimumDistance + this.rnd.nextDouble() * MOVEMENT_DECELERATION_RANGE;
        return { x: Math.cos(num) * num2, y: Math.sin(num) * num2 };
    }

    // Port of Galaxy.4.cs GenerateBuiltObjectName(design[, habitat[, uniqueNamesForSmallMilitaryShips]])
    // (2361-2493). Rnd only through GetCustomName (none) and SelectUniqueBuiltObjectName.
    generateBuiltObjectName(design: Design, habitat: Habitat | null = null, uniqueNamesForSmallMilitaryShips = false): string {
        const S = BuiltObjectSubRole;
        let empty = '';
        let flag = false;
        empty = this.getCustomName(design);
        if (empty === '') {
            switch (design.subRole) {
                case S.Escort:
                case S.Frigate:
                case S.Destroyer:
                case S.TroopTransport:
                    if (!uniqueNamesForSmallMilitaryShips) {
                        flag = true;
                    }
                    break;
                case S.ResupplyShip:
                case S.ExplorationShip:
                case S.SmallFreighter:
                case S.MediumFreighter:
                case S.LargeFreighter:
                case S.ColonyShip:
                case S.PassengerShip:
                case S.ConstructionShip:
                case S.GasMiningShip:
                case S.MiningShip:
                case S.GasMiningStation:
                case S.MiningStation:
                case S.SmallSpacePort:
                case S.MediumSpacePort:
                case S.LargeSpacePort:
                case S.ResortBase:
                case S.GenericBase:
                case S.EnergyResearchStation:
                case S.WeaponsResearchStation:
                case S.HighTechResearchStation:
                case S.MonitoringStation:
                case S.DefensiveBase:
                    flag = false;
                    break;
                default:
                    if (design.buildCount <= 1 && design.subRole !== S.Carrier) {
                        flag = true;
                    }
                    break;
            }
        }
        if (flag) {
            const n = buildCount000(design.buildCount);
            switch (design.subRole) {
                case S.GenericBase:
                    empty = design.name + ' ' + n;
                    break;
                case S.Escort:
                case S.Frigate:
                case S.Destroyer:
                case S.TroopTransport:
                    empty = design.name + ' ' + n;
                    break;
                case S.Cruiser:
                case S.CapitalShip:
                case S.Carrier:
                case S.ResupplyShip:
                    empty = design.name;
                    break;
                case S.MonitoringStation:
                    empty = design.name + ' ' + resolveSubRoleDescription(S.MonitoringStation) + ' ' + n;
                    break;
                case S.DefensiveBase:
                    empty = design.name + ' ' + resolveSubRoleDescription(S.DefensiveBase) + ' ' + n;
                    break;
                case S.EnergyResearchStation:
                    empty = design.name + ' ' + resolveSubRoleDescription(S.EnergyResearchStation) + ' ' + n;
                    break;
                case S.WeaponsResearchStation:
                    empty = design.name + ' ' + resolveSubRoleDescription(S.WeaponsResearchStation) + ' ' + n;
                    break;
                case S.HighTechResearchStation:
                    empty = design.name + ' ' + resolveSubRoleDescription(S.HighTechResearchStation) + ' ' + n;
                    break;
                case S.SmallSpacePort:
                case S.MediumSpacePort:
                case S.LargeSpacePort:
                    // TextResolver.GetText("Space Port") (GameText.txt 521).
                    empty = design.name + ' Space Port ' + n;
                    break;
                case S.MiningShip:
                    empty = design.name + ' ' + n;
                    break;
                case S.GasMiningShip:
                    empty = design.name + ' ' + n;
                    break;
                case S.MiningStation:
                    empty = design.name + ' ' + resolveSubRoleDescription(S.MiningStation) + ' ' + n;
                    break;
                case S.GasMiningStation:
                    empty = design.name + ' ' + resolveSubRoleDescription(S.GasMiningStation) + ' ' + n;
                    break;
                case S.SmallFreighter:
                case S.MediumFreighter:
                case S.LargeFreighter:
                    empty = design.name + ' ' + n;
                    break;
                case S.ColonyShip:
                    empty = design.name + ' ' + n;
                    break;
                case S.ConstructionShip:
                    empty = design.name + ' ' + n;
                    break;
                case S.ExplorationShip:
                    empty = design.name + ' ' + n;
                    break;
            }
        } else {
            empty = this.selectUniqueBuiltObjectName(design, habitat);
        }
        return empty;
    }

    // Port of Galaxy.5.cs GetCustomName (2223). No Rnd.
    private getCustomName(design: Design): string {
        let text = '';
        let list: string[] | null = null;
        if (design.empire === this.playerEmpire && this.subRoleNameSet !== null) {
            list = this.subRoleNameSet.get(design.subRole) ?? null;
        }
        if (list !== null && list.length > 0) {
            let flag = false;
            const empire = design.empire as Empire;
            const builtObjectList: BuiltObject[] = [];
            builtObjectList.push(...empire.builtObjects);
            builtObjectList.push(...empire.privateBuiltObjects);
            for (let num = builtObjectList.length - 1; num >= 0; num--) {
                if (builtObjectList[num].subRole === design.subRole) {
                    const num2 = list.indexOf(builtObjectList[num].name);
                    if (num2 >= 0) {
                        if (num2 === list.length - 1) {
                            flag = true;
                        } else {
                            text = list[num2 + 1];
                        }
                        break;
                    }
                }
            }
            if (text === '' && !flag) {
                text = list[0];
            }
        }
        return text;
    }

    // Port of Galaxy.5.cs SelectUniqueBuiltObjectName (2264). Rnd: see the callees and the
    // Monitoring/Research/Defensive/Generic base arrays (one Next each).
    selectUniqueBuiltObjectName(design: Design, parentHabitat: Habitat | null): string {
        const S = BuiltObjectSubRole;
        let empty = '';
        empty = this.getCustomName(design);
        if (empty !== '') {
            return empty;
        }
        let text = '';
        let text2 = '';
        if (parentHabitat !== null) {
            text = parentHabitat.name;
            const habitat = this.determineHabitatSystemStar(parentHabitat);
            text2 = habitat.name;
        }
        switch (design.subRole) {
            case S.MiningStation:
                empty = text + ' ' + resolveSubRoleDescription(S.MiningStation);
                break;
            case S.GasMiningStation:
                empty = text + ' ' + resolveSubRoleDescription(S.GasMiningStation);
                break;
            case S.Escort:
            case S.Frigate:
            case S.Destroyer:
            case S.Cruiser:
            case S.CapitalShip:
            case S.TroopTransport:
            case S.Carrier:
            case S.ResupplyShip:
                empty = this.selectRandomUniqueMilitaryShipName(parentHabitat);
                break;
            case S.ResortBase:
                empty = this.generateResortBaseName(parentHabitat);
                break;
            case S.MonitoringStation: {
                const array = ['Beacon', 'Sentinel', 'Station', 'Monitoring Facility'];
                empty = text2 !== '' ? text2 + ' ' + array[this.rnd.next(0, array.length)] : array[this.rnd.next(0, array.length)] + ' ' + buildCount000(design.buildCount);
                break;
            }
            case S.EnergyResearchStation:
            case S.WeaponsResearchStation:
            case S.HighTechResearchStation: {
                const array = ['Research Center', 'Station', 'Research Station', 'Research Facility'];
                empty = text2 !== '' ? text2 + ' ' + array[this.rnd.next(0, array.length)] : array[this.rnd.next(0, array.length)] + ' ' + buildCount000(design.buildCount);
                break;
            }
            case S.DefensiveBase: {
                // TextResolver.GetText of each (GameText.txt 1601, 2781-2783).
                const array = ['Defensive Base', 'Weapons Platform', 'Defense Battery', 'Orbital Battery'];
                empty = text !== '' ? text + ' ' + array[this.rnd.next(0, array.length)] : array[this.rnd.next(0, array.length)] + ' ' + buildCount000(design.buildCount);
                break;
            }
            case S.GenericBase: {
                const array = ['Base', 'Station'];
                const text3 = array[this.rnd.next(0, array.length)];
                if (empty === '') {
                    empty = text2 + ' ' + text3;
                }
                break;
            }
            case S.ExplorationShip:
            case S.SmallFreighter:
            case S.MediumFreighter:
            case S.LargeFreighter:
            case S.ColonyShip:
            case S.PassengerShip:
            case S.ConstructionShip:
            case S.GasMiningShip:
            case S.MiningShip:
                empty = this.selectRandomUniqueStandardShipName(parentHabitat);
                break;
            case S.SmallSpacePort:
            case S.MediumSpacePort:
            case S.LargeSpacePort:
                empty = text + ' Space Port';
                break;
            default:
                empty = design.name + ' X';
                break;
        }
        return empty;
    }

    // Port of Galaxy.5.cs SelectRandomUniqueStandardShipName (2356). Rnd: Next(0,127),
    // Next(0,125), Next(0,7); when that is < 2 and habitat != null and the system star name
    // passes the checks, one more Next(0,3).
    selectRandomUniqueStandardShipName(habitat: Habitat | null): string {
        let empty = '';
        const array = STANDARD_SHIP_NAME_ADJECTIVES;
        const array2 = STANDARD_SHIP_NAME_NOUNS;
        let num = this.rnd.next(0, array.length);
        const text = array[num];
        num = this.rnd.next(0, array2.length);
        const text2 = array2[num];
        empty = text + ' ' + text2;
        if (this.rnd.next(0, 7) < 2 && habitat !== null) {
            const habitat2 = this.determineHabitatSystemStar(habitat);
            if (habitat2.category === HabitatCategoryType.Star && habitat2.name.length < 16 && habitat2.name.length > 1) {
                const text3 = habitat2.name.substring(1, 2);
                if (text3.toLowerCase() === text3) {
                    empty = this.rnd.next(0, 3) !== 1 ? habitat2.name + ' ' + text2 : text2 + ' of ' + habitat2.name;
                }
            }
        }
        return empty;
    }

    // Port of Galaxy.5.cs SelectRandomUniqueMilitaryShipName(habitat) (2419). Rnd: Next(0,76),
    // Next(0,162), Next(0,5); when that is < 2 and habitat != null and the system star name
    // passes the checks, one more Next(0,3).
    selectRandomUniqueMilitaryShipName(habitat: Habitat | null = null): string {
        let empty = '';
        let empty2 = '';
        let empty3 = '';
        const array = MILITARY_SHIP_NAME_ADJECTIVES;
        const array2 = MILITARY_SHIP_NAME_NOUNS;
        let num = this.rnd.next(0, array.length);
        empty2 = array[num];
        num = this.rnd.next(0, array2.length);
        empty3 = array2[num];
        empty = empty2 + ' ' + empty3;
        if (this.rnd.next(0, 5) < 2 && habitat !== null) {
            const habitat2 = this.determineHabitatSystemStar(habitat);
            if (habitat2.category === HabitatCategoryType.Star && habitat2.name.length < 16 && habitat2.name.length > 1) {
                const text = habitat2.name.substring(1, 2);
                if (text.toLowerCase() === text) {
                    empty = this.rnd.next(0, 3) !== 1 ? empty3 + ' of ' + habitat2.name : habitat2.name + ' ' + empty3;
                }
            }
        }
        return empty;
    }

    // Port of Galaxy.3.cs GenerateResortBaseName (553).
    private generateResortBaseName(habitat: Habitat | null): string {
        const array = ['Royal', 'Holiday', 'Luxury', 'Grand', 'Horizon'];
        const array2 = ['Resort', 'Hotel', 'Encounter', 'Casino', 'Retreat', 'Stopover', 'Lounge', 'Lodge', 'Club', 'Palace'];
        if (habitat !== null && this.rnd.next(0, 3) > 0) {
            if (habitat.scenicFeature !== null && habitat.scenicFeature !== '') {
                if (habitat.scenicFeature.length < 26) {
                    return habitat.scenicFeature + ' ' + array2[this.rnd.next(0, array2.length)];
                }
                const a = array[this.rnd.next(0, array.length)];
                return a + ' ' + array2[this.rnd.next(0, array2.length)];
            }
            const habitat2 = this.determineHabitatSystemStar(habitat);
            return habitat2.name + ' ' + array2[this.rnd.next(0, array2.length)];
        }
        const a = array[this.rnd.next(0, array.length)];
        return a + ' ' + array2[this.rnd.next(0, array2.length)];
    }

    // Port of Galaxy.7.cs FindNearestBuiltObject(x, y, role[, includeIndependentBuiltObjects = true
    // [, empireToExclude = null]]) (876-920) + FindNearestBuiltObjectInIndex (922). No Rnd.
    findNearestBuiltObject(x: number, y: number, role: BuiltObjectRole = BuiltObjectRole.Undefined, includeIndependentBuiltObjects = true, empireToExclude: Empire | null = null): BuiltObject | null {
        const ix = Math.trunc(x);
        const iy = Math.trunc(y);
        return this.ringSearch(ix, iy, (cx, cy) => {
            let builtObject: BuiltObject | null = null;
            let distance = Number.MAX_VALUE;
            for (const builtObject2 of this.builtObjectIndexGrid[cx][cy]) {
                if (builtObject2 === null || (!includeIndependentBuiltObjects && builtObject2.empire === this.independentEmpire) || (empireToExclude !== null && builtObject2.empire === empireToExclude)) continue;
                const num = this.calculateDistanceSquared(ix, iy, builtObject2.xpos, builtObject2.ypos);
                if (!(num < distance)) continue;
                if (role !== BuiltObjectRole.Undefined) {
                    if (builtObject2.role === role) {
                        builtObject = builtObject2;
                        distance = num;
                    }
                } else {
                    builtObject = builtObject2;
                    distance = num;
                }
            }
            if (builtObject !== null) distance = this.calculateDistance(ix, iy, builtObject.xpos, builtObject.ypos);
            return { item: builtObject, distance };
        });
    }

    // Port of Galaxy.7.cs FindNearestBuiltObject(x, y, empire) (795) + InIndex (838). No Rnd.
    findNearestBuiltObjectOfEmpire(x: number, y: number, empire: Empire | null): BuiltObject | null {
        const ix = Math.trunc(x);
        const iy = Math.trunc(y);
        return this.ringSearch(ix, iy, (cx, cy) => {
            let builtObject: BuiltObject | null = null;
            let distance = Number.MAX_VALUE;
            for (const builtObject2 of this.builtObjectIndexGrid[cx][cy]) {
                if (builtObject2 === null) continue;
                const num = this.calculateDistanceSquared(ix, iy, builtObject2.xpos, builtObject2.ypos);
                if (!(num < distance)) continue;
                if (empire !== null) {
                    if (builtObject2.empire === empire) {
                        builtObject = builtObject2;
                        distance = num;
                    }
                } else {
                    builtObject = builtObject2;
                    distance = num;
                }
            }
            if (builtObject !== null) distance = this.calculateDistance(ix, iy, builtObject.xpos, builtObject.ypos);
            return { item: builtObject, distance };
        });
    }

    // Port of Galaxy.7.cs FindNearestBuiltObject(x, y, empire, subRole, fullyFunctional) (1319)
    // + InIndex (1355). No Rnd.
    findNearestBuiltObjectOfEmpireSubRole(x: number, y: number, empire: Empire | null, subRole: BuiltObjectSubRole, fullyFunctional: boolean): BuiltObject | null {
        const ix = Math.trunc(x);
        const iy = Math.trunc(y);
        return this.ringSearch(ix, iy, (cx, cy) => {
            let builtObject: BuiltObject | null = null;
            let distance = Number.MAX_VALUE;
            for (const builtObject2 of this.builtObjectIndexGrid[cx][cy]) {
                if (builtObject2 === null) continue;
                const num = this.calculateDistanceSquared(ix, iy, builtObject2.xpos, builtObject2.ypos);
                if (!(num < distance)) continue;
                let flag = true;
                if (fullyFunctional && (builtObject2.builtAt !== null || builtObject2.unbuiltOrDamagedComponentCount > 0)) flag = false;
                if (!flag) continue;
                let flag2 = true;
                if (empire !== null && builtObject2.empire !== empire) flag2 = false;
                if (!flag2) continue;
                if (subRole !== BuiltObjectSubRole.Undefined) {
                    if (builtObject2.subRole === subRole) {
                        builtObject = builtObject2;
                        distance = num;
                    }
                } else {
                    builtObject = builtObject2;
                    distance = num;
                }
            }
            if (builtObject !== null) distance = this.calculateDistance(ix, iy, builtObject.xpos, builtObject.ypos);
            return { item: builtObject, distance };
        });
    }

    // Port of Galaxy.7.cs FindNearestBuiltObject(x, y, subRole, includeSecondaryEmpires) (1411)
    // + InIndex (1447). No Rnd.
    findNearestBuiltObjectOfSubRole(x: number, y: number, subRole: BuiltObjectSubRole, includeSecondaryEmpires: boolean): BuiltObject | null {
        const ix = Math.trunc(x);
        const iy = Math.trunc(y);
        return this.ringSearch(ix, iy, (cx, cy) => {
            let builtObject: BuiltObject | null = null;
            let distance = Number.MAX_VALUE;
            for (const builtObject2 of this.builtObjectIndexGrid[cx][cy].slice()) {
                if (builtObject2 === null) continue;
                const num = this.calculateDistanceSquared(ix, iy, builtObject2.xpos, builtObject2.ypos);
                if (!(num < distance)) continue;
                let flag = true;
                if (!includeSecondaryEmpires && (builtObject2.empire === null || builtObject2.empire === this.independentEmpire || builtObject2.empire.pirateEmpireBaseHabitat !== null)) flag = false;
                if (!flag) continue;
                if (subRole !== BuiltObjectSubRole.Undefined) {
                    if (builtObject2.subRole === subRole) {
                        builtObject = builtObject2;
                        distance = num;
                    }
                } else {
                    builtObject = builtObject2;
                    distance = num;
                }
            }
            if (builtObject !== null) distance = this.calculateDistance(ix, iy, builtObject.xpos, builtObject.ypos);
            return { item: builtObject, distance };
        });
    }

    // Port of Galaxy.cs SelectRandomHeading (line 2795); C# returns float.
    selectRandomHeading(): number {
        return Math.fround(Math.PI - this.rnd.nextDouble() * Math.PI * 2.0);
    }

    // Port of Galaxy.6.cs SelectRelativePoint (line 3762).
    selectRelativePoint(range: number): { x: number; y: number } {
        const num = range * this.rnd.nextDouble();
        const num2 = this.selectRandomHeading();
        return { x: Math.cos(num2) * num, y: Math.sin(num2) * num };
    }

    // Port of Galaxy.6.cs SelectRelativeHabitatSurfacePoint (line 3770).
    selectRelativeHabitatSurfacePoint(habitat: Habitat | null): { x: number; y: number } {
        let range = 50.0;
        if (habitat !== null) {
            let num = habitat.diameter - 10.0;
            if (num < 1.0) {
                num = 1.0;
            }
            range = num / 2.0;
        }
        return this.selectRelativePoint(range);
    }

    // Port of Galaxy.6.cs SelectHyperJumpExitPoint (line 3750).
    selectHyperJumpExitPoint(minimumExitDistance: number): { x: number; y: number } {
        let num = this.rnd.nextDouble() * Math.PI;
        if (this.rnd.next(0, 2) === 1) {
            num *= -1.0;
        }
        const num2 = minimumExitDistance + this.rnd.nextDouble() * minimumExitDistance * 0.4;
        return { x: Math.cos(num) * num2, y: Math.sin(num) * num2 };
    }

    // Port of Galaxy.6.cs FastFindNearestUnexploredSystem (3944) /
    // GenerateDistanceOrderedSystemListUnexplored (3920): Unexplored/Undefined systems
    // sorted by squared distance with List.Sort (unstable, netSort); first element.
    fastFindNearestUnexploredSystem(x: number, y: number, empire: Empire): Habitat | null {
        const list: { s: SystemInfo; d: number }[] = [];
        for (const s of this.systems) {
            const st = empire.visibility.systemVisibility[s.systemStar.systemIndex].status;
            if (st === SystemVisibilityStatus.Unexplored || st === SystemVisibilityStatus.Undefined) {
                list.push({ s, d: this.calculateDistanceSquared(x, y, s.systemStar.xpos, s.systemStar.ypos) });
            }
        }
        netSort(list, (a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
        return list.length > 0 ? list[0].s.systemStar : null;
    }

    // Port of Galaxy.6.cs FastFindNearestSystem (line 3648) / FindNearestSystemInIndex
    // (SystemsIndex ring search; C2c-1). Falls back to a linear scan when the
    // index grids haven't been built (galaxies made outside generateGalaxy).
    fastFindNearestSystem(x: number, y: number): Habitat | null {
        const ix = Math.trunc(x);
        const iy = Math.trunc(y);
        if (this.systemsIndexGrid.length === 0) {
            let best: Habitat | null = null;
            let bestDistance = Number.MAX_VALUE;
            for (const system of this.systems) {
                const d = this.calculateDistanceSquared(ix, iy, system.systemStar.xpos, system.systemStar.ypos);
                if (d < bestDistance) {
                    bestDistance = d;
                    best = system.systemStar;
                }
            }
            return best;
        }
        return this.ringSearch(x, y, (cx, cy) => {
            let item: Habitat | null = null;
            let distance = Number.MAX_VALUE;
            for (const sys of this.systemsIndexGrid[cx][cy]) {
                const d = this.calculateDistanceSquared(ix, iy, sys.systemStar.xpos, sys.systemStar.ypos);
                if (d < distance) {
                    item = sys.systemStar;
                    distance = d;
                }
            }
            if (item !== null) distance = this.calculateDistance(ix, iy, (item as Habitat).xpos, (item as Habitat).ypos);
            return { item, distance };
        });
    }

    // Port of Galaxy.6.cs GenerateDistanceOrderedSystemList (line 3011).
    generateDistanceOrderedSystemList(x: number, y: number): SystemInfo[] {
        return this.systems
            .map((s) => ({ s, d: this.calculateDistanceSquared(x, y, s.systemStar.xpos, s.systemStar.ypos) }))
            .sort((a, b) => a.d - b.d)
            .map((e) => e.s);
    }

    // C# Systems[i].Habitats (excludes the star; TS SystemInfo.habitats has it at [0]).
    systemHabitatsOf(systemIndex: number): Habitat[] {
        const system = this.systems[systemIndex];
        return system === undefined ? [] : system.habitats.filter((h) => h !== system.systemStar);
    }

    // Rebuilds the cached step order: habitats that have a parent, sorted by
    // orbit depth (planets before their moons; stars have no parent and are
    // skipped). Depths are memoized per habitat so the sort is O(n log n).
    private rebuildStepOrder(): void {
        const depths = new Map<Habitat, number>();
        const depthOf = (h: Habitat): number => {
            let d = 0;
            let cur = h;
            while (cur.parent !== null) {
                const known = depths.get(cur);
                if (known !== undefined) {
                    d += known;
                    break;
                }
                d++;
                cur = cur.parent;
            }
            depths.set(h, d);
            return d;
        };
        this.stepOrder = this.habitats.filter((h) => h.parent !== null).sort((a, b) => depthOf(a) - depthOf(b));
        this.stepOrderDirty = false;
    }

    // Port of Galaxy.3.cs SetGalaxyPhysicalDimensions
    private setGalaxyPhysicalDimensions(sectorWidth: number, sectorHeight: number): void {
        sectorWidth = Math.max(4, Math.min(15, sectorWidth));
        sectorHeight = Math.max(4, Math.min(15, sectorHeight));
        this.sectorWidth = sectorWidth;
        this.sectorHeight = sectorHeight;
        this.sizeX = sectorWidth * SECTOR_SIZE;
        this.sizeY = sectorHeight * SECTOR_SIZE;
    }

    // Port of Galaxy.5.cs ObtainRandomGalaxyCoordinates(out x, out y)
    obtainRandomGalaxyCoordinates(): { x: number; y: number } {
        return { x: this.rnd.nextDouble() * this.sizeX, y: this.rnd.nextDouble() * this.sizeY };
    }

    // Port of Galaxy.5.cs ObtainRandomGalaxyCoordinates(radiusFromCenterMinimum, radiusFromCenterMaximum, out x, out y)
    obtainRandomGalaxyCoordinatesInRadius(radiusFromCenterMinimum: number, radiusFromCenterMaximum: number): { x: number; y: number } {
        const halfX = this.sizeX / 2.0;
        const halfY = this.sizeY / 2.0;
        const radiusBase = this.sizeX / 2.0;
        const minRadius = radiusBase * radiusFromCenterMinimum;
        const extraRadius = this.rnd.nextDouble() * radiusBase * (radiusFromCenterMaximum - radiusFromCenterMinimum);
        const radius = minRadius + extraRadius;
        const angle = this.rnd.nextDouble() * Math.PI * 2.0;
        const x = halfX + Math.cos(angle) * radius;
        const y = halfY + Math.sin(angle) * radius;
        return { x, y };
    }

    // Port of Galaxy.6.cs CalculateDistance
    calculateDistance(x1: number, y1: number, x2: number, y2: number): number {
        const dx = x1 - x2;
        const dy = y1 - y2;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // Port of Galaxy.5.cs SelectClusterIndex
    private selectClusterIndex(selection: number): number {
        let sum = 0;
        for (let i = 0; i < this.starClusterPortions.length; i++) {
            if (selection >= sum && selection < sum + this.starClusterPortions[i]) {
                return i;
            }
            sum += this.starClusterPortions[i];
        }
        return -1;
    }

    // Simplified port of Galaxy.6.cs FindNearestSystemGasCloudAsteroid.
    // The original walks a spatial GalaxyIndex grid of sectors; that index
    // structure isn't ported yet, so this does a linear scan over the
    // already-placed gas-cloud/asteroid habitats. Semantically equivalent
    // (same nearest-neighbor result), just O(n) instead of index-accelerated.
    // TODO(port): rebuild via GalaxyIndex sectors if this becomes a perf issue.
    private findNearestSystemGasCloudAsteroid(x: number, y: number): Habitat | null {
        let best: Habitat | null = null;
        let bestDistance = Number.MAX_VALUE;
        for (const habitat of this.habitats) {
            if (habitat.category !== HabitatCategoryType.GasCloud && habitat.category !== HabitatCategoryType.Asteroid) {
                continue;
            }
            const distance = this.calculateDistance(x, y, habitat.xpos, habitat.ypos);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = habitat;
            }
        }
        return best;
    }

    // Port of Galaxy.6.cs SelectStar
    private selectStar(): { type: HabitatType; diameter: number; pictureRef: number; solarRadiation: number; microwaveRadiation: number; xrayRadiation: number } {
        const roll = this.rnd.next(0, 77);
        let type: HabitatType;
        let diameter: number;
        let pictureRef: number;
        // Solar/Microwave/Xray radiation rolls (stored on the star, Galaxy.5.cs 1325-1327; read by M4g IndustrialProcessing).
        let solarRadiation: number;
        let microwaveRadiation: number;
        let xrayRadiation: number;
        if (roll >= 0 && roll <= 61) {
            type = HabitatType.MainSequence;
            diameter = this.rnd.next(950, 1400);
            pictureRef = diameter <= 1200 ? 83 : 84;
            this.rnd.next(0, 4); // mapPictureRef roll — MapPictureRef not modeled yet
            solarRadiation = this.rnd.next(40, 60);
            microwaveRadiation = this.rnd.next(5, 20);
            xrayRadiation = this.rnd.next(5, 12);
        } else if (roll >= 62 && roll <= 66) {
            type = HabitatType.RedGiant;
            diameter = this.rnd.next(1450, 1620);
            pictureRef = 85;
            this.rnd.next(0, 3);
            solarRadiation = this.rnd.next(70, 95);
            microwaveRadiation = this.rnd.next(5, 20);
            xrayRadiation = this.rnd.next(5, 12);
        } else if (roll >= 67 && roll <= 69) {
            type = HabitatType.SuperGiant;
            diameter = this.rnd.next(1620, 1950);
            pictureRef = 86;
            this.rnd.next(0, 3);
            solarRadiation = this.rnd.next(80, 100);
            microwaveRadiation = this.rnd.next(5, 20);
            xrayRadiation = this.rnd.next(5, 12);
        } else if (roll >= 70 && roll <= 72) {
            type = HabitatType.WhiteDwarf;
            diameter = this.rnd.next(260, 350);
            pictureRef = 87;
            this.rnd.next(0, 3);
            solarRadiation = this.rnd.next(10, 30);
            microwaveRadiation = this.rnd.next(20, 40);
            xrayRadiation = this.rnd.next(40, 60);
        } else if (roll >= 73 && roll <= 74) {
            type = HabitatType.Neutron;
            diameter = this.rnd.next(180, 230);
            pictureRef = 88;
            solarRadiation = this.rnd.next(1, 5);
            microwaveRadiation = this.rnd.next(60, 90);
            xrayRadiation = this.rnd.next(120, 200);
        } else if (roll === 75) {
            type = HabitatType.BlackHole;
            diameter = this.rnd.next(4500, 6500);
            pictureRef = 95;
            solarRadiation = this.rnd.next(10, 15);
            microwaveRadiation = this.rnd.next(60, 80);
            xrayRadiation = this.rnd.next(90, 130);
        } else {
            type = HabitatType.SuperNova;
            diameter = this.rnd.next(300, 900);
            pictureRef = 0;
            solarRadiation = this.rnd.next(60, 80);
            microwaveRadiation = this.rnd.next(70, 110);
            xrayRadiation = this.rnd.next(160, 220);
        }
        return { type, diameter, pictureRef, solarRadiation, microwaveRadiation, xrayRadiation };
    }

    // Port of Galaxy.4.cs GenerateNebulae (generateImage=false call) plus
    // the constructor wiring (Galaxy.4.cs ~2190: _GalaxyLocations =
    // locations, index-grid re-init, AddGalaxyLocationIndex per location).
    generateNebulae(cloudImageCount: number): void {
        const generator = new GalaxyNebulaeGenerator(cloudImageCount, this.systemNames);
        this.galaxyLocations = generator.generateGalaxyNebulae(this.randomSeed, this.starCount, this.galaxyShape, this.sizeX, this.sizeY);
        const indexMaxX = Math.trunc(this.sizeX / INDEX_SIZE);
        const indexMaxY = Math.trunc(this.sizeY / INDEX_SIZE);
        const grid: GalaxyLocation[][][] = [];
        for (let i = 0; i < indexMaxX; i++) {
            const row: GalaxyLocation[][] = [];
            for (let j = 0; j < indexMaxY; j++) {
                row.push([]);
            }
            grid.push(row);
        }
        this.galaxyLocationIndex = grid;
        for (const location of this.galaxyLocations) {
            this.addGalaxyLocationIndex(location);
        }
    }

    // Port of Galaxy.4.cs AddGalaxyLocationIndex
    addGalaxyLocationIndex(location: GalaxyLocation): void {
        const point = this.resolveGalaxyLocationIndexes(location.xpos, location.ypos);
        const point2 = this.resolveGalaxyLocationIndexes(location.xpos + location.width, location.ypos + location.height);
        for (let i = point.x; i <= point2.x; i++) {
            for (let j = point.y; j <= point2.y; j++) {
                const cell = this.galaxyLocationIndex[i][j];
                if (!cell.includes(location)) {
                    cell.push(location);
                }
            }
        }
    }

    // Port of Galaxy.4.cs RemoveGalaxyLocationIndex
    removeGalaxyLocationIndex(location: GalaxyLocation): void {
        const point = this.resolveGalaxyLocationIndexes(location.xpos, location.ypos);
        const point2 = this.resolveGalaxyLocationIndexes(location.xpos + location.width, location.ypos + location.height);
        for (let i = point.x; i <= point2.x; i++) {
            for (let j = point.y; j <= point2.y; j++) {
                const cell = this.galaxyLocationIndex[i][j];
                const index = cell.indexOf(location);
                if (index >= 0) {
                    cell.splice(index, 1);
                }
            }
        }
    }

    // Port of Galaxy.4.cs ResolveGalaxyLocationIndexes
    private resolveGalaxyLocationIndexes(x: number, y: number): { x: number; y: number } {
        // C# (int) casts truncate toward zero, then int division.
        const coords = {
            x: Math.trunc(Math.trunc(x) / INDEX_SIZE),
            y: Math.trunc(Math.trunc(y) / INDEX_SIZE),
        };
        this.correctIndexCoords(coords);
        return coords;
    }

    // Port of Galaxy.6.cs CorrectIndexCoords (clamps to
    // [0, IndexMaxX-1] / [0, IndexMaxY-1]).
    private correctIndexCoords(coords: { x: number; y: number }): void {
        const indexMaxX = Math.trunc(this.sizeX / INDEX_SIZE);
        const indexMaxY = Math.trunc(this.sizeY / INDEX_SIZE);
        if (coords.x < 0) {
            coords.x = 0;
        } else if (coords.x >= indexMaxX) {
            coords.x = indexMaxX - 1;
        }
        if (coords.y < 0) {
            coords.y = 0;
        } else if (coords.y >= indexMaxY) {
            coords.y = indexMaxY - 1;
        }
    }

    // Port of Galaxy.4.cs DetermineGalaxyLocationsAtPoint(x, y, type);
    // type defaults to Undefined (no filter), matching the 2-arg overload.
    determineGalaxyLocationsAtPoint(x: number, y: number, type: GalaxyLocationType = GalaxyLocationType.Undefined): GalaxyLocation[] {
        const result: GalaxyLocation[] = [];
        const point = this.resolveGalaxyLocationIndexes(x, y);
        for (const location of this.galaxyLocationIndex[point.x][point.y]) {
            const num = location.width / 2.0;
            const num2 = num * num;
            if (type === GalaxyLocationType.Undefined || location.type === type) {
                const num3 = this.calculateDistanceSquared(x, y, location.xpos + num, location.ypos + location.height / 2.0);
                if (num3 < num2) {
                    result.push(location);
                }
            }
        }
        return result;
    }

    // Port of Galaxy.6.cs CalculateDistanceSquared
    calculateDistanceSquared(x1: number, y1: number, x2: number, y2: number): number {
        const dx = x1 - x2;
        const dy = y1 - y2;
        return dx * dx + dy * dy;
    }

    // Port of Galaxy.5.cs SetupSun(galaxyShape).
    private setupSun(galaxyShape: GalaxyShape): Habitat {
        let x = 0;
        let y = 0;
        const clusterBaseRadius = 300000.0 + 175000000.0 / Math.sqrt(this.starCount);
        const clusterCap =
            this.starCount >= 1400 ? 5000000.0 : this.starCount >= 1000 ? 4250000.0 : this.starCount >= 700 ? 3600000.0 : this.starCount < 400 ? 2000000.0 : 2700000.0;
        const clusterVal = Math.min(clusterBaseRadius, clusterCap);
        let num5 = 0;
        let num6 = 0.0;
        let flag = false;
        let flag2 = false;
        let flag3 = false;
        do {
            switch (galaxyShape) {
                case GalaxyShape.ClustersEven:
                case GalaxyShape.ClustersVaried: {
                    if (this.rnd.next(0, 10) === 1) {
                        x = this.sizeX * 0.02 + this.rnd.nextDouble() * (this.sizeX * 0.96);
                        y = this.sizeY * 0.02 + this.rnd.nextDouble() * (this.sizeY * 0.96);
                        break;
                    }
                    const clusterIndex = this.selectClusterIndex(this.rnd.nextDouble());
                    if (clusterIndex >= 0) {
                        const clusterDiameter = Math.sqrt(this.starClusterPortions[clusterIndex]) * clusterVal * 3.0;
                        const clusterRadius = this.rnd.nextDouble() * (clusterDiameter / 2.0);
                        const angle = this.rnd.nextDouble() * Math.PI * 2.0;
                        const dy = Math.sin(angle) * clusterRadius;
                        const dx = Math.cos(angle) * clusterRadius;
                        x = this.starClusterLocations[clusterIndex].x + dy;
                        y = this.starClusterLocations[clusterIndex].y + dx;
                    } else {
                        x = this.sizeX * 0.02 + this.rnd.nextDouble() * (this.sizeX * 0.96);
                        y = this.sizeY * 0.02 + this.rnd.nextDouble() * (this.sizeY * 0.96);
                    }
                    break;
                }
                case GalaxyShape.Ring: {
                    const roll = this.rnd.next(0, 20);
                    if (roll >= 3) {
                        const radius = this.sizeX / 2 - (this.sizeX / 2) * this.rnd.nextDouble() * 0.15;
                        const angle = this.rnd.nextDouble() * Math.PI * 2.0;
                        const dy = Math.sin(angle) * radius;
                        const dx = Math.cos(angle) * radius;
                        x = this.sizeY / 2 + dy;
                        y = this.sizeX / 2 + dx;
                        break;
                    }
                    const spreadX = (this.rnd.next(2, 10) / 10.0) * (this.rnd.next(2, 10) / 10.0) * this.rnd.nextDouble() * this.sizeX / 2.0;
                    const spreadY = (this.rnd.next(2, 10) / 10.0) * (this.rnd.next(2, 10) / 10.0) * this.rnd.nextDouble() * this.sizeY / 2.0;
                    switch (this.rnd.next(1, 3)) {
                        case 1:
                            x = this.sizeX / 2 + spreadX;
                            break;
                        case 2:
                            x = this.sizeX / 2 - spreadX;
                            break;
                    }
                    switch (this.rnd.next(1, 3)) {
                        case 1:
                            y = this.sizeY / 2 + spreadY;
                            break;
                        case 2:
                            y = this.sizeY / 2 - spreadY;
                            break;
                    }
                    break;
                }
                case GalaxyShape.Elliptical: {
                    const roll = this.rnd.next(0, 16);
                    if (roll >= 10) {
                        const spreadX = (this.rnd.next(2, 10) / 10.0) * (this.rnd.next(2, 10) / 10.0) * this.rnd.nextDouble() * this.sizeX / 2.0;
                        const spreadY = (this.rnd.next(2, 10) / 10.0) * (this.rnd.next(2, 10) / 10.0) * this.rnd.nextDouble() * this.sizeY / 2.0;
                        switch (this.rnd.next(1, 3)) {
                            case 1:
                                x = this.sizeX / 2 + spreadX;
                                break;
                            case 2:
                                x = this.sizeX / 2 - spreadX;
                                break;
                        }
                        switch (this.rnd.next(1, 3)) {
                            case 1:
                                y = this.sizeY / 2 + spreadY;
                                break;
                            case 2:
                                y = this.sizeY / 2 - spreadY;
                                break;
                        }
                    } else if (roll >= 5) {
                        const radius = this.sizeX / 2 - (this.sizeX / 2) * this.rnd.nextDouble() * 0.1;
                        const angle = this.rnd.nextDouble() * Math.PI * 2.0;
                        const dy = Math.sin(angle) * radius;
                        const dx = Math.cos(angle) * radius;
                        x = this.sizeY / 2 + dy;
                        y = this.sizeX / 2 + dx;
                    } else {
                        const radius = (this.sizeX / 2) * (0.25 + this.rnd.nextDouble() * 0.6);
                        const angle = this.rnd.nextDouble() * Math.PI * 2.0;
                        const dy = Math.sin(angle) * radius;
                        const dx = Math.cos(angle) * radius;
                        x = this.sizeY / 2 + dy;
                        y = this.sizeX / 2 + dx;
                    }
                    break;
                }
                case GalaxyShape.Spiral: {
                    const spreadX = this.rnd.nextDouble() * this.rnd.nextDouble() * this.sizeX / 2.0;
                    const spreadY = this.rnd.nextDouble() * this.rnd.nextDouble() * this.sizeY / 2.0;
                    switch (this.rnd.next(1, 3)) {
                        case 1:
                            x = this.sizeX / 2 + spreadX;
                            break;
                        case 2:
                            x = this.sizeX / 2 - spreadX;
                            break;
                    }
                    switch (this.rnd.next(1, 3)) {
                        case 1:
                            y = this.sizeY / 2 + spreadY;
                            break;
                        case 2:
                            y = this.sizeY / 2 - spreadY;
                            break;
                    }
                    break;
                }
                case GalaxyShape.Irregular:
                    x = this.rnd.nextDouble() * this.sizeX;
                    y = this.rnd.nextDouble() * this.sizeY;
                    break;
            }
            flag2 = true;
            const margin = MAX_SOLAR_SYSTEM_SIZE + 500.0;
            if (x < margin || x > this.sizeX - margin || y < margin || y > this.sizeY - margin) {
                flag2 = false;
            }
            const nearest = this.findNearestSystemGasCloudAsteroid(x, y);
            num6 = nearest === null ? Number.MAX_VALUE : this.calculateDistance(x, y, nearest.xpos, nearest.ypos);
            const nebulae = this.determineGalaxyLocationsAtPoint(x, y, GalaxyLocationType.NebulaCloud);
            if (nebulae.length > 0) {
                if (this.rnd.next(0, 15) === 1) {
                    flag = true;
                    for (const location of nebulae) {
                        if (location.effect === GalaxyLocationEffectType.LightningDamage) {
                            flag3 = true;
                            break;
                        }
                    }
                } else {
                    flag = false;
                }
            } else {
                flag = true;
            }
            num5++;
        } while ((num6 < MAX_SOLAR_SYSTEM_SIZE * 4 || !flag || !flag2) && num5 < 100);

        // C# re-rolls the star type until it's compatible with any
        // LightningDamage nebula the star landed in (flag3 is sticky for
        // the whole SetupSun call, matching the source).
        let type: HabitatType;
        let diameter: number;
        let pictureRef: number;
        let selected: ReturnType<Galaxy['selectStar']>;
        let flag4 = false;
        do {
            selected = this.selectStar();
            type = selected.type;
            diameter = selected.diameter;
            pictureRef = selected.pictureRef;
            flag4 = true;
            if (flag3) {
                switch (type) {
                    case HabitatType.MainSequence:
                    case HabitatType.RedGiant:
                    case HabitatType.SuperGiant:
                        flag4 = false;
                        break;
                }
            }
        } while (!flag4);
        const star = new Habitat(HabitatCategoryType.Star, type, this.generateCodeName(), x, y);
        star.diameter = diameter;
        star.pictureRef = pictureRef;
        star.landscapePictureRef = -1;
        // Galaxy.5.cs 1325-1327: (byte) casts of the radiation rolls.
        star.solarRadiation = selected.solarRadiation & 0xff;
        star.microwaveRadiation = selected.microwaveRadiation & 0xff;
        star.xrayRadiation = selected.xrayRadiation & 0xff;
        if (type === HabitatType.BlackHole) {
            // Port of Galaxy.5.cs SetupSun black-hole GalaxyLocations
            // (1329-1352). C# renames the star via GenerateBlackHoleName()
            // before building the Pull/Event Horizon location names.
            star.name = this.generateBlackHoleName();
            const pullSize = star.diameter * 1.1;
            const pull = new GalaxyLocation(star.name + ' Pull', GalaxyLocationType.BlackHole, x - pullSize / 2.0, y - pullSize / 2.0, pullSize, pullSize, -1);
            pull.showName = false;
            pull.effect = GalaxyLocationEffectType.ShipPull;
            pull.effectAmount = Math.fround(star.diameter / 600);
            this.galaxyLocations.push(pull);
            this.addGalaxyLocationIndex(pull);
            const horizonSize = star.diameter * 0.04;
            const horizon = new GalaxyLocation(star.name + ' Event Horizon', GalaxyLocationType.BlackHole, x - horizonSize / 2.0, y - horizonSize / 2.0, horizonSize, horizonSize, -1);
            horizon.showName = false;
            horizon.effect = GalaxyLocationEffectType.ShipDamage;
            horizon.effectAmount = Math.fround(star.diameter);
            this.galaxyLocations.push(horizon);
            this.addGalaxyLocationIndex(horizon);
        } else if (type === HabitatType.SuperNova) {
            // Port of Galaxy.5.cs SetupSun supernova branch (1353-1371).
            // TextResolver.GetText("HabitatType SuperNova") = "Super Nova"
            // (TextResolver not ported — literal used).
            star.name = 'Super Nova ' + this.generateCodeName();
            // C# field is float — round to float32 for fidelity.
            star.novaProgression = Math.fround(30000 + this.rnd.nextDouble() * 60000);
            star.novaImageIndexMajor = this.rnd.next(0, 20); // GalaxyImages.NovaImageCountMajor
            star.novaImageIndexMinor = this.rnd.next(0, 56); // GalaxyImages.NovaImageCountMinor
            star.diameter = Math.trunc(Math.trunc(star.novaProgression * 2.0) / 10);
            // Port of Galaxy.5.cs SetupSun supernova GalaxyLocation.
            const num20 = Math.trunc(star.novaProgression * 2.0);
            const location = new GalaxyLocation(star.name, GalaxyLocationType.SuperNova, x - num20 / 2.0, y - num20 / 2.0, num20, num20, -1);
            location.showName = false;
            location.shape = GalaxyLocationShape.Circular;
            location.effect = GalaxyLocationEffectType.ShieldReduction;
            this.galaxyLocations.push(location);
            this.addGalaxyLocationIndex(location);
        }
        return star;
    }

    // Port of Galaxy.4.cs GenerateCodeName
    generateCodeName(): string {
        const letters = String.fromCharCode(this.rnd.next(65, 91)) + String.fromCharCode(this.rnd.next(65, 91));
        return letters + this.rnd.next(1, 1000);
    }

    // Port of Galaxy.5.cs GenerateBlackHoleName (line 2486).
    generateBlackHoleName(): string {
        const prefixes = ["Devil's", 'Dark', 'Ravenous', 'Deadly', 'Perilous', "Traitor's", 'Wretched', 'Devouring', "Destroyer's"];
        const suffixes = [
            'Gate', 'Vortex', 'Whirlpool', 'Wheel', 'Lair', 'Snare', 'Desolation', 'End', 'Mouth', 'Cauldron',
            'Pit', 'Abyss', 'Chasm', 'Dungeon', 'Inferno', 'Void',
        ];
        const prefix = prefixes[this.rnd.next(0, prefixes.length)];
        const suffix = suffixes[this.rnd.next(0, suffixes.length)];
        return prefix + ' ' + suffix;
    }

    // Port of Galaxy.4.cs GenerateMoonName (line 2533). The C# generates a
    // code name (unused local `text`), touches DetermineHabitatSystemStar
    // (no Rnd calls, side-effect free), then returns GenerateRandomNameAlt().
    generateMoonName(moon: Habitat): string {
        const codeName = this.generateCodeName();
        void moon.parent;
        this.determineHabitatSystemStar(moon);
        return this.generateRandomNameAlt();
    }

    // Port of Galaxy.4.cs ConditionCheckLimit(bool condition, int limit, ref int iterationCount).
    // Returns true while the condition holds and the limit has not been hit.
    private conditionCheckLimit(condition: boolean, limit: number, iterationCount: { value: number }): boolean {
        if (!condition) {
            return false;
        }
        if (iterationCount.value >= limit) {
            return false;
        }
        iterationCount.value++;
        return true;
    }

    // Port of Galaxy.4.cs CheckForIllegalVowelCombination(string word, string letter).
    // True when appending `letter` would create an illegal vowel pair at the
    // end of the word ("ee", "oo", "ii").
    private checkForIllegalVowelCombination(word: string, letter: string): boolean {
        if (word.length < 2) {
            return false;
        }
        const last = word[word.length - 1];
        const secondLast = word[word.length - 2];
        return (last === 'e' && secondLast === 'e' && letter === 'e') || (last === 'o' && secondLast === 'o' && letter === 'o') || (last === 'i' && secondLast === 'i' && letter === 'i');
    }

    // Port of Galaxy.4.cs GenerateRandomName — planet-style name generator
    // (not called from generation; kept for fidelity next to its Alt sibling).
    generateRandomName(): string {
        let text = '';
        const vowels = ['a', 'e', 'i', 'o', 'u', 'y'];
        const consonants = ['b', 'c', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'm', 'n', 'p', 'q', 'r', 's', 't', 'v', 'w', 'x', 'y', 'z'];
        const maxLen = 7;
        const parts = this.rnd.next(2, 5);
        for (let i = 0; i < parts; i++) {
            switch (this.rnd.next(0, 4)) {
                case 0:
                    text += consonants[this.rnd.next(0, consonants.length)];
                    text += vowels[this.rnd.next(0, vowels.length)];
                    break;
                case 1: {
                    let v = this.rnd.next(0, vowels.length);
                    let count = { value: 0 };
                    while (this.conditionCheckLimit(this.checkForIllegalVowelCombination(text, vowels[v]), 50, count)) {
                        v = this.rnd.next(0, vowels.length);
                    }
                    text += vowels[v];
                    text += consonants[this.rnd.next(0, consonants.length)];
                    break;
                }
                case 2:
                    text += consonants[this.rnd.next(0, consonants.length)];
                    text += vowels[this.rnd.next(0, vowels.length)];
                    text += consonants[this.rnd.next(0, consonants.length)];
                    break;
                case 3: {
                    let v = this.rnd.next(0, vowels.length);
                    let count = { value: 0 };
                    while (this.conditionCheckLimit(this.checkForIllegalVowelCombination(text, vowels[v]), 50, count)) {
                        v = this.rnd.next(0, vowels.length);
                    }
                    text += vowels[v];
                    text += consonants[this.rnd.next(0, consonants.length)];
                    text += vowels[this.rnd.next(0, vowels.length)];
                    break;
                }
            }
            if (text.length > maxLen) {
                break;
            }
        }
        return text.charAt(0).toUpperCase() + text.slice(1);
    }

    // Port of Galaxy.4.cs GenerateRandomNameAlt — moon-name generator.
    // Alternates vowel/consonant additions until the target length is
    // reached (or the 50-iteration safety limit trips).
    private generateRandomNameAlt(): string {
        let text = '';
        const targetLength = this.rnd.next(4, 9);
        let mode = this.rnd.next(0, 2);
        let vowelCombinationCount = 0;
        let consonantCombinationCount = 0;
        let iterationCount = { value: 0 };
        while (this.conditionCheckLimit(text.length < targetLength, 50, iterationCount)) {
            if (mode === 0) {
                if (this.rnd.next(0, 2) === 0 && text.length > 0 && vowelCombinationCount === 0) {
                    text = text.length < targetLength - 2 ? this.addVowelCombination(text) : this.addVowelCombinationEnd(text);
                    vowelCombinationCount++;
                } else {
                    text = this.addVowel(text);
                }
                mode = 1;
            } else {
                if (this.rnd.next(0, 2) !== 0 || consonantCombinationCount !== 0) {
                    text = text.length < targetLength - 1 ? this.addConsonant(text) : this.addConsonantEnd(text);
                } else {
                    text = text.length <= 0 ? this.addConsonantCombinationStart(text) : text.length < targetLength - 2 ? this.addConsonantCombination(text) : this.addConsonantCombinationEnd(text);
                    consonantCombinationCount++;
                }
                mode = 0;
            }
        }
        return text.charAt(0).toUpperCase() + text.slice(1);
    }

    // Port of Galaxy.4.cs AddVowel — weighted single-vowel table.
    private addVowel(word: string): string {
        const table = ['a', 'a', 'a', 'e', 'e', 'e', 'e', 'i', 'i', 'o', 'o', 'u'];
        return word + table[this.rnd.next(0, table.length)];
    }

    // Port of Galaxy.4.cs AddVowelEnd.
    private addVowelEnd(word: string): string {
        const table = ['a', 'a', 'o', 'o', 'u', 'y'];
        return word + table[this.rnd.next(0, table.length)];
    }

    // Port of Galaxy.4.cs AddVowelCombination.
    private addVowelCombination(word: string): string {
        const table = ['ai', 'au', 'ea', 'ee', 'ei', 'eu', 'ey', 'oa', 'oi', 'oo', 'ou', 'ui'];
        return word + table[this.rnd.next(0, table.length)];
    }

    // Port of Galaxy.4.cs AddVowelCombinationEnd.
    private addVowelCombinationEnd(word: string): string {
        const table = ['ai', 'au', 'ea', 'eu', 'ie', 'oa', 'oi', 'oo', 'oy', 'ui'];
        return word + table[this.rnd.next(0, table.length)];
    }

    // Port of Galaxy.4.cs AddConsonant — weighted single-consonant table.
    private addConsonant(word: string): string {
        const table = [
            'b', 'b', 'c', 'c', 'c', 'd', 'd', 'd', 'd', 'f',
            'f', 'g', 'g', 'h', 'h', 'h', 'h', 'h', 'h', 'j',
            'k', 'l', 'l', 'l', 'l', 'm', 'm', 'm', 'n', 'n',
            'n', 'n', 'n', 'n', 'n', 'p', 'p', 'r', 'r', 'r',
            'r', 'r', 'r', 's', 's', 's', 's', 's', 's', 't',
            't', 't', 't', 't', 't', 't', 't', 't', 'v', 'w',
            'w', 'x', 'y', 'y', 'z',
        ];
        return word + table[this.rnd.next(0, table.length)];
    }

    // Port of Galaxy.4.cs AddConsonantEnd.
    private addConsonantEnd(word: string): string {
        const table = [
            'b', 'd', 'd', 'd', 'd', 'd', 'f', 'f', 'g', 'k',
            'l', 'l', 'm', 'n', 'n', 'n', 'n', 'p', 'r', 'r',
            'r', 's', 's', 's', 's', 's', 's', 's', 't', 't',
            't', 't', 'v', 'x', 'z',
        ];
        return word + table[this.rnd.next(0, table.length)];
    }

    // Port of Galaxy.4.cs AddConsonantCombinationStart.
    private addConsonantCombinationStart(word: string): string {
        const table = [
            'bl', 'br', 'ch', 'cl', 'cr', 'dr', 'fl', 'fr', 'gh', 'gl',
            'gr', 'kl', 'kr', 'ph', 'pl', 'pr', 'qu', 'rh', 'ry', 'sc',
            'sh', 'sk', 'sl', 'sm', 'sn', 'sp', 'st', 'th', 'tr',
        ];
        return word + table[this.rnd.next(0, table.length)];
    }

    // Port of Galaxy.4.cs AddConsonantCombinationEnd.
    private addConsonantCombinationEnd(word: string): string {
        const table = [
            'ff', 'gh', 'ld', 'lf', 'lg', 'lk', 'll', 'lm', 'lt', 'ms',
            'nc', 'nd', 'ng', 'nk', 'ns', 'nt', 'ny', 'ph', 'rc', 'rd',
            'rf', 'rg', 'rk', 'rl', 'rm', 'rn', 'rp', 'rs', 'rt', 'ry',
            'sc', 'sh', 'sk', 'ss', 'st', 'th',
        ];
        return word + table[this.rnd.next(0, table.length)];
    }

    // Port of Galaxy.4.cs AddConsonantCombination.
    private addConsonantCombination(word: string): string {
        const table = [
            'bb', 'bl', 'br', 'ch', 'cl', 'cr', 'dd', 'dr', 'ff', 'fl',
            'fr', 'gg', 'gl', 'gr', 'kl', 'kr', 'lc', 'ld', 'lf', 'lg',
            'lk', 'll', 'lm', 'ln', 'lp', 'ls', 'lt', 'mb', 'mm', 'mn',
            'mp', 'ms', 'nc', 'nd', 'ng', 'nk', 'nn', 'ns', 'nt', 'ph',
            'pl', 'pp', 'pr', 'ps', 'qu', 'rb', 'rc', 'rd', 'rf', 'rg',
            'rh', 'rk', 'rl', 'rm', 'rn', 'rp', 'rr', 'rs', 'rt', 'ry',
            'sc', 'sh', 'sk', 'sl', 'sm', 'sn', 'sp', 'ss', 'st', 'th',
            'tr', 'wl', 'xx',
        ];
        return word + table[this.rnd.next(0, table.length)];
    }

    // Port of Galaxy.4.cs AssignSystemName(Habitat habitat, int PlanetCount)
    assignSystemName(habitat: Habitat, planetCount: number): boolean {
        let name = '';
        if (planetCount <= 0) {
            name = habitat.type === HabitatType.BlackHole ? this.generateBlackHoleName() : this.generateCodeName();
        } else {
            if (this.systemNames.length === 0) {
                return false;
            }
            let attempts = 0;
            let index = this.rnd.next(0, this.systemNames.length);
            while (this.systemNamesUsedPlain[index] && attempts < 100) {
                index = this.rnd.next(0, this.systemNames.length);
                attempts++;
            }
            if (this.systemNamesUsedPlain[index]) {
                if (this.systemNamesUsedAlternative[index]) {
                    return false;
                }
                name = this.systemNames[index];
                switch (this.rnd.next(0, 4)) {
                    case 0:
                        name += ' Major';
                        break;
                    case 1:
                        name += ' Minor';
                        break;
                    case 2:
                        name += ' Junction';
                        break;
                    case 3:
                        name += ' Prime';
                        break;
                }
                this.systemNamesUsedAlternative[index] = true;
            } else {
                name = this.systemNames[index];
                this.systemNamesUsedPlain[index] = true;
            }
        }
        habitat.name = name;
        return true;
    }

    // Port of Galaxy.5.cs SetResearchBonus(Habitat, bool definitelySet).
    setResearchBonus(habitat: Habitat, definitelySet = false): void {
        switch (habitat.type) {
            case HabitatType.Neutron:
            case HabitatType.BlackHole:
            case HabitatType.SuperNova:
                if (definitelySet || this.rnd.next(0, 4) > 0) {
                    habitat.researchBonus = this.rnd.next(5, 16);
                    habitat.researchBonusIndustry = this.rollResearchBonusIndustry();
                }
                break;
            case HabitatType.Volcanic:
            case HabitatType.GasGiant:
            case HabitatType.FrozenGasGiant:
                if (definitelySet || this.rnd.next(0, 40) === 1) {
                    habitat.researchBonus = this.rnd.next(10, 31);
                    habitat.researchBonusIndustry = this.rollResearchBonusIndustry();
                }
                break;
        }
    }

    // Shared IndustryType roll used by SetResearchBonus's two branches
    // (Galaxy.5.cs 1952, the `switch (Rnd.Next(0, 3))` inside each branch).
    private rollResearchBonusIndustry(): IndustryType {
        switch (this.rnd.next(0, 3)) {
            case 0:
                return IndustryType.Weapon;
            case 1:
                return IndustryType.Energy;
            case 2:
                return IndustryType.HighTech;
            default:
                return IndustryType.Undefined;
        }
    }

    // Port of Galaxy.5.cs SetScenicFactor(Habitat, bool definitelySet).
    // TextResolver isn't ported (see the SuperNova-name comment above); the
    // literal English format strings are used directly, matching that
    // existing convention.
    setScenicFactor(habitat: Habitat, definitelySet = false): void {
        const systemStar = this.determineHabitatSystemStar(habitat);
        switch (habitat.type) {
            case HabitatType.BarrenRock:
                if ((habitat.category === HabitatCategoryType.Planet || habitat.category === HabitatCategoryType.Moon) && (definitelySet || this.rnd.next(0, 600) === 1)) {
                    habitat.scenicFactor = 0.1 + this.rnd.nextDouble() * 0.3;
                    habitat.scenicFeature = `Ancient Monolith of ${systemStar.name}`;
                }
                break;
            case HabitatType.MarshySwamp:
            case HabitatType.Continental:
                if (definitelySet || this.rnd.next(0, 70) === 1) {
                    habitat.scenicFactor = 0.2 + this.rnd.nextDouble() * 0.4;
                    switch (this.rnd.next(0, 2)) {
                        case 0:
                            habitat.scenicFeature = `Rings of ${systemStar.name}`;
                            habitat.hasRings = true;
                            break;
                        case 1:
                            habitat.scenicFeature = `${systemStar.name} Falls`;
                            break;
                    }
                }
                break;
            case HabitatType.Ocean:
                if (definitelySet || this.rnd.next(0, 100) === 1) {
                    habitat.scenicFactor = 0.1 + this.rnd.nextDouble() * 0.3;
                    habitat.scenicFeature = `Undersea Ruins of ${systemStar.name}`;
                }
                break;
            case HabitatType.Ice:
                if (definitelySet || this.rnd.next(0, 200) === 1) {
                    habitat.scenicFactor = 0.2 + this.rnd.nextDouble() * 0.4;
                    habitat.scenicFeature = `Ice Rings of ${systemStar.name}`;
                    habitat.hasRings = true;
                }
                break;
            case HabitatType.Volcanic:
            case HabitatType.Desert:
                if (definitelySet || this.rnd.next(0, 200) === 1) {
                    habitat.scenicFactor = 0.2 + this.rnd.nextDouble() * 0.4;
                    switch (this.rnd.next(0, 2)) {
                        case 0: {
                            let scenicFeature = `Rings of ${systemStar.name}`;
                            if (habitat.type === HabitatType.Volcanic) {
                                scenicFeature = `Fire Rings of ${systemStar.name}`;
                            }
                            habitat.scenicFeature = scenicFeature;
                            habitat.hasRings = true;
                            break;
                        }
                        case 1: {
                            let scenicFeature = 'Great Canyon';
                            if (systemStar.name.length < 15) {
                                scenicFeature = `${systemStar.name} Canyon`;
                            }
                            habitat.scenicFeature = scenicFeature;
                            break;
                        }
                    }
                }
                break;
            case HabitatType.BlackHole:
                habitat.scenicFactor = 0.3 + this.rnd.nextDouble() * 0.6;
                break;
            case HabitatType.GasGiant:
                if (definitelySet || this.rnd.next(0, 100) === 1) {
                    habitat.scenicFactor = 0.2 + this.rnd.nextDouble() * 0.2;
                }
                break;
            case HabitatType.Neutron:
                if (definitelySet || this.rnd.next(0, 2) > 0) {
                    habitat.scenicFactor = 0.3 + this.rnd.nextDouble() * 0.3;
                }
                break;
            case HabitatType.SuperNova:
                break;
        }
    }

    // Port of Galaxy.4.cs GenerateGasCloud().
    // The original anchors gas clouds inside existing NebulaCloud
    // GalaxyLocations; nebulae aren't modeled yet, so this places the
    // cloud at a uniform-random galaxy coordinate instead (documented
    // deviation) while keeping the type roll, diameter roll, min-distance
    // retry loop (against other gas clouds/asteroids), SelectResources,
    // radiation rolls, and orbitDirection roll faithful to source.
    // TODO(port): nebula-anchored placement — needs GalaxyLocation.
    generateGasCloud(): Habitat {
        let habitatType = HabitatType.Ammonia;
        switch (this.rnd.next(0, 15)) {
            case 0:
                habitatType = HabitatType.Ammonia;
                break;
            case 1:
                habitatType = HabitatType.Argon;
                break;
            case 2:
                habitatType = HabitatType.CarbonDioxide;
                break;
            case 3:
                habitatType = HabitatType.Chlorine;
                break;
            case 4:
            case 5:
                habitatType = HabitatType.Helium;
                break;
            case 6:
            case 7:
            case 8:
                habitatType = HabitatType.Hydrogen;
                break;
            case 9:
            case 10:
            case 11:
            case 12:
                habitatType = HabitatType.NitrogenOxygen;
                break;
            case 13:
            case 14:
                habitatType = HabitatType.Oxygen;
                break;
        }
        let distance = 0;
        let attempts = 0;
        let habitat: Habitat;
        do {
            const { x, y } = this.obtainRandomGalaxyCoordinates();
            habitat = new Habitat(HabitatCategoryType.GasCloud, habitatType, this.generateCodeName(), x, y);
            habitat.diameter = this.rnd.next(8000, 32000);
            const nearest = this.findNearestSystemGasCloudAsteroid(habitat.xpos, habitat.ypos);
            distance = nearest === null ? Number.MAX_VALUE : this.calculateDistance(habitat.xpos, habitat.ypos, nearest.xpos, nearest.ypos);
            attempts++;
        } while (distance < MAX_SOLAR_SYSTEM_SIZE * 4 && attempts < 200);

        // Galaxy.4.cs 2853-2858 (byte) radiation rolls.
        habitat.solarRadiation = this.rnd.next(40, 60) & 0xff;
        habitat.microwaveRadiation = this.rnd.next(1, 5) & 0xff;
        habitat.xrayRadiation = this.rnd.next(0, 3) & 0xff;

        this.selectResources(habitat);

        switch (habitat.type) {
            case HabitatType.Hydrogen:
            case HabitatType.Helium:
                habitat.pictureRef = habitat.diameter < 1750 ? 79 : habitat.diameter < 3000 ? 80 : habitat.diameter < 4250 ? 81 : 82;
                break;
            case HabitatType.Argon:
            case HabitatType.Ammonia:
            case HabitatType.CarbonDioxide:
                habitat.pictureRef = habitat.diameter < 1750 ? 75 : habitat.diameter < 3000 ? 76 : habitat.diameter < 4250 ? 77 : 78;
                break;
            case HabitatType.Oxygen:
            case HabitatType.NitrogenOxygen:
            case HabitatType.Chlorine:
                habitat.pictureRef = habitat.diameter < 1750 ? 71 : habitat.diameter < 3000 ? 72 : habitat.diameter < 4250 ? 73 : 74;
                break;
        }
        habitat.landscapePictureRef = -1;
        if (this.rnd.next(0, 5) === 2) {
            habitat.orbitDirection = false;
        }
        return habitat;
    }

    // Port of Galaxy.5.cs CheckOrbitOverlap
    private checkOrbitOverlap(existingMin: number, existingMax: number, newMin: number, newMax: number): boolean {
        if (newMin >= existingMin && newMin <= existingMax) {
            return true;
        }
        if (newMax >= existingMin && newMax <= existingMax) {
            return true;
        }
        if (newMin < existingMin && newMax > existingMax) {
            return true;
        }
        return false;
    }

    // Port of Galaxy.6.cs CalculateAngleFromCoords
    private calculateAngleFromCoords(x: number, y: number, centerX: number, centerY: number, distance: number): number {
        const halfPi = Math.PI / 2.0;
        const negHalfPi = -halfPi;
        if (x < centerX) {
            if (y < centerY) {
                return negHalfPi - (halfPi + Math.asin((y - centerY) / distance));
            }
            return halfPi + (halfPi - Math.asin((y - centerY) / distance));
        }
        if (y < centerY) {
            return Math.asin((y - centerY) / distance) * -1.0;
        }
        return Math.asin((y - centerY) / distance);
    }

    // Port of Galaxy.6.cs SelectBarrenRockPlanet(diameter, out pictureRef, out landscapePictureRef)
    private selectBarrenRockPictures(): { pictureRef: number; landscapePictureRef: number } {
        return { pictureRef: 100 + this.rnd.next(0, 10), landscapePictureRef: 200 + this.rnd.next(0, 10) };
    }

    // Port of Galaxy.6.cs SelectBarrenRockPlanet(out type, out pictureRef, out diameter, out minOrbitDistance, out maxOrbitDistance, out landscapePictureRef)
    /** Galaxy.7.cs GenerateEmpire starting-colony switch (Volcanic/Desert/MarshySwamp/Continental/Ocean/Ice, default Desert). */
    selectPlanetOfType(type: HabitatType) {
        switch (type) {
            case HabitatType.Volcanic: return this.selectVolcanicPlanet();
            case HabitatType.Desert: return this.selectDesertPlanet();
            case HabitatType.MarshySwamp: return this.selectMarshySwampPlanet();
            case HabitatType.Continental: return this.selectContinentalPlanet();
            case HabitatType.Ocean: return this.selectOceanPlanet();
            case HabitatType.Ice: return this.selectIcePlanet();
            default: return this.selectDesertPlanet();
        }
    }

    private selectBarrenRockPlanet(): { type: HabitatType; diameter: number; minOrbitDistance: number; maxOrbitDistance: number; pictureRef: number; landscapePictureRef: number } {
        const diameter = this.rnd.next(80, 340);
        const minOrbitDistance = 2500;
        const maxOrbitDistance = 11500;
        const { pictureRef, landscapePictureRef } = this.selectBarrenRockPictures();
        return { type: HabitatType.BarrenRock, diameter, minOrbitDistance, maxOrbitDistance, pictureRef, landscapePictureRef };
    }

    // Port of Galaxy.6.cs SelectContinentalPlanet
    private selectContinentalPlanet(): { type: HabitatType; diameter: number; minOrbitDistance: number; maxOrbitDistance: number; pictureRef: number; landscapePictureRef: number } {
        const diameter = this.rnd.next(200, 320);
        const pictureRef = 300 + this.rnd.next(0, 10);
        const landscapePictureRef = 400 + this.rnd.next(0, 10);
        return { type: HabitatType.Continental, diameter, minOrbitDistance: 5000, maxOrbitDistance: 10000, pictureRef, landscapePictureRef };
    }

    // Port of Galaxy.6.cs SelectIcePlanet
    private selectIcePlanet(): { type: HabitatType; diameter: number; minOrbitDistance: number; maxOrbitDistance: number; pictureRef: number; landscapePictureRef: number } {
        const diameter = this.rnd.next(180, 320);
        const pictureRef = 500 + this.rnd.next(0, 10);
        const landscapePictureRef = 600 + this.rnd.next(0, 10);
        return { type: HabitatType.Ice, diameter, minOrbitDistance: 18000, maxOrbitDistance: 23000, pictureRef, landscapePictureRef };
    }

    // Port of Galaxy.6.cs SelectMarshySwampPlanet
    private selectMarshySwampPlanet(): { type: HabitatType; diameter: number; minOrbitDistance: number; maxOrbitDistance: number; pictureRef: number; landscapePictureRef: number } {
        const diameter = this.rnd.next(200, 320);
        const pictureRef = 700 + this.rnd.next(0, 10);
        const landscapePictureRef = 800 + this.rnd.next(0, 10);
        return { type: HabitatType.MarshySwamp, diameter, minOrbitDistance: 5000, maxOrbitDistance: 9500, pictureRef, landscapePictureRef };
    }

    // Port of Galaxy.6.cs SelectOceanPlanet
    private selectOceanPlanet(): { type: HabitatType; diameter: number; minOrbitDistance: number; maxOrbitDistance: number; pictureRef: number; landscapePictureRef: number } {
        const diameter = this.rnd.next(200, 320);
        const pictureRef = 900 + this.rnd.next(0, 10);
        const landscapePictureRef = 1000 + this.rnd.next(0, 10);
        return { type: HabitatType.Ocean, diameter, minOrbitDistance: 5000, maxOrbitDistance: 10000, pictureRef, landscapePictureRef };
    }

    // Port of Galaxy.6.cs SelectDesertPlanet
    private selectDesertPlanet(): { type: HabitatType; diameter: number; minOrbitDistance: number; maxOrbitDistance: number; pictureRef: number; landscapePictureRef: number } {
        const diameter = this.rnd.next(180, 330);
        const pictureRef = 1100 + this.rnd.next(0, 10);
        const landscapePictureRef = 1200 + this.rnd.next(0, 10);
        return { type: HabitatType.Desert, diameter, minOrbitDistance: 3000, maxOrbitDistance: 10300, pictureRef, landscapePictureRef };
    }

    // Port of Galaxy.6.cs SelectVolcanicPlanet
    private selectVolcanicPlanet(): { type: HabitatType; diameter: number; minOrbitDistance: number; maxOrbitDistance: number; pictureRef: number; landscapePictureRef: number } {
        const diameter = this.rnd.next(160, 330);
        const pictureRef = 1300 + this.rnd.next(0, 10);
        const landscapePictureRef = 1400 + this.rnd.next(0, 10);
        return { type: HabitatType.Volcanic, diameter, minOrbitDistance: 1250, maxOrbitDistance: 3500, pictureRef, landscapePictureRef };
    }

    // Port of Galaxy.6.cs SelectGasGiantPlanet
    private selectGasGiantPlanet(): { type: HabitatType; diameter: number; minOrbitDistance: number; maxOrbitDistance: number; pictureRef: number; landscapePictureRef: number } {
        const diameter = this.rnd.next(550, 970);
        const pictureRef = 1500 + this.rnd.next(0, 10);
        const landscapePictureRef = 1600 + this.rnd.next(0, 10);
        return { type: HabitatType.GasGiant, diameter, minOrbitDistance: 12000, maxOrbitDistance: 17000, pictureRef, landscapePictureRef };
    }

    // Port of Galaxy.6.cs SelectFrozenGasGiantPlanet
    private selectFrozenGasGiantPlanet(): { type: HabitatType; diameter: number; minOrbitDistance: number; maxOrbitDistance: number; pictureRef: number; landscapePictureRef: number } {
        const diameter = this.rnd.next(480, 680);
        const pictureRef = 1700 + this.rnd.next(0, 10);
        const landscapePictureRef = 1800 + this.rnd.next(0, 10);
        return { type: HabitatType.FrozenGasGiant, diameter, minOrbitDistance: 17500, maxOrbitDistance: 22000, pictureRef, landscapePictureRef };
    }

    // Port of Galaxy.6.cs CalculatePlanetTypePrevalenceByStarType (line 2307).
    // colonyPrevalence defaults to 1.0 (matches _ColonyPrevalence's default
    // when GenerateGalaxyOptions.colonyPrevalence is unset).
    private calculatePlanetTypePrevalenceByStarType(starType: HabitatType): number[] {
        let thresholds: number[];
        switch (starType) {
            case HabitatType.MainSequence:
            case HabitatType.RedGiant:
            case HabitatType.SuperGiant:
                thresholds = [0.213, 0.015, 0.019, 0.029, 0.036, 0.058, 0.062, 0.281, 0.287];
                break;
            case HabitatType.WhiteDwarf:
                thresholds = [0.216, 0.0, 0.0, 0.0, 0.0, 0.176, 0.098, 0.0, 0.51];
                break;
            case HabitatType.Neutron:
                thresholds = [0.0, 0.0, 0.0, 0.0, 0.0, 0.333, 0.118, 0.0, 0.549];
                break;
            default:
                thresholds = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
                break;
        }
        const colonyPrevalence = this.colonyPrevalence;
        const num = 1.0 - (1.0 - colonyPrevalence) / 2.0;
        thresholds[1] *= colonyPrevalence;
        thresholds[2] *= colonyPrevalence;
        thresholds[7] *= num;
        return thresholds;
    }

    // Port of Galaxy.6.cs SelectPlanetType (line 2365)
    private selectPlanetType(parentStarType: HabitatType): {
        type: HabitatType;
        pictureRef: number;
        diameter: number;
        minOrbitDistance: number;
        maxOrbitDistance: number;
        landscapePictureRef: number;
    } {
        const prevalenceThresholds = this.calculatePlanetTypePrevalenceByStarType(parentStarType);
        const num = this.rnd.nextDouble();
        let sumLow = 0.0;
        let sumHigh = 0.0;
        let result: { type: HabitatType; diameter: number; minOrbitDistance: number; maxOrbitDistance: number; pictureRef: number; landscapePictureRef: number } | null = null;
        for (let i = 0; i < prevalenceThresholds.length; i++) {
            sumLow = sumHigh;
            sumHigh += prevalenceThresholds[i];
            if (num >= sumLow && num < sumHigh) {
                switch (i) {
                    case 0:
                        result = this.selectFrozenGasGiantPlanet();
                        break;
                    case 1:
                        result = this.selectContinentalPlanet();
                        break;
                    case 2:
                        result = this.selectMarshySwampPlanet();
                        break;
                    case 3:
                        result = this.selectOceanPlanet();
                        break;
                    case 4:
                        result = this.selectDesertPlanet();
                        break;
                    case 5:
                        result = this.selectIcePlanet();
                        break;
                    case 6:
                        result = this.selectVolcanicPlanet();
                        break;
                    case 7:
                        result = this.selectGasGiantPlanet();
                        break;
                    case 8:
                        result = this.selectBarrenRockPlanet();
                        break;
                    default:
                        result = this.selectBarrenRockPlanet();
                        break;
                }
                break;
            }
        }
        if (result === null || result.diameter <= 0) {
            result = this.selectBarrenRockPlanet();
        }
        return result;
    }

    // Port of Galaxy.6.cs CalculateMoonTypePrevalenceByPlanetType (line 1809)
    private calculateMoonTypePrevalenceByPlanetType(planetDiameter: number, planetType: HabitatType): number[] {
        let thresholds: number[];
        if (planetDiameter >= 430) {
            thresholds = planetType === HabitatType.FrozenGasGiant
                ? [0.15, 0.0, 0.0, 0.0, 0.0, 0.0, 0.85]
                : [0.08, 0.024, 0.024, 0.062, 0.062, 0.086, 0.662];
        } else if (planetDiameter >= 340) {
            thresholds = planetType === HabitatType.FrozenGasGiant
                ? [0.15, 0.0, 0.0, 0.0, 0.0, 0.0, 0.85]
                : [0.093, 0.0, 0.0, 0.093, 0.093, 0.093, 0.628];
        } else {
            thresholds = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0];
        }
        const colonyPrevalence = this.colonyPrevalence;
        thresholds[1] *= colonyPrevalence;
        thresholds[2] *= colonyPrevalence;
        return thresholds;
    }

    // Port of Galaxy.6.cs SelectMoonType (line 1873)
    private selectMoonType(parentDiameter: number, parentType: HabitatType): {
        type: HabitatType;
        diameter: number;
        pictureRef: number;
        landscapePictureRef: number;
    } {
        const prevalenceThresholds = this.calculateMoonTypePrevalenceByPlanetType(parentDiameter, parentType);
        const num = this.rnd.nextDouble();
        let sumLow = 0.0;
        let sumHigh = 0.0;
        let result: { type: HabitatType; diameter: number; pictureRef: number; landscapePictureRef: number } | null = null;
        for (let i = 0; i < prevalenceThresholds.length; i++) {
            sumLow = sumHigh;
            sumHigh += prevalenceThresholds[i];
            if (num >= sumLow && num < sumHigh) {
                switch (i) {
                    case 0:
                        result = this.selectIcePlanet();
                        break;
                    case 1:
                        result = this.selectContinentalPlanet();
                        break;
                    case 2:
                        result = this.selectMarshySwampPlanet();
                        break;
                    case 3:
                        result = this.selectOceanPlanet();
                        break;
                    case 4:
                        result = this.selectDesertPlanet();
                        break;
                    case 5:
                        result = this.selectVolcanicPlanet();
                        break;
                    case 6:
                        result = this.selectBarrenRockPlanet();
                        break;
                    default:
                        result = this.selectBarrenRockPlanet();
                        break;
                }
                break;
            }
        }
        if (result === null || result.diameter <= 0) {
            result = this.selectBarrenRockPlanet();
        }
        let diameter = result.diameter;
        if (diameter > parentDiameter * 0.33) {
            diameter = Math.trunc(parentDiameter * (this.rnd.next(28, 33) * 0.01));
        }
        return { type: result.type, diameter, pictureRef: result.pictureRef, landscapePictureRef: result.landscapePictureRef };
    }

    // Port of Galaxy.4.cs ResolveHabitatTypeByIndexIncludeGasClouds (line 774).
    // resources.txt distribution subType is a compact index, not the
    // HabitatType enum value.
    private resolveHabitatTypeByIndexIncludeGasClouds(index: number): HabitatType {
        switch (index) {
            case 0:
                return HabitatType.Continental;
            case 1:
                return HabitatType.MarshySwamp;
            case 2:
                return HabitatType.Ocean;
            case 3:
                return HabitatType.Desert;
            case 4:
                return HabitatType.Ice;
            case 5:
                return HabitatType.Volcanic;
            case 6:
                return HabitatType.BarrenRock;
            case 7:
                return HabitatType.GasGiant;
            case 8:
                return HabitatType.FrozenGasGiant;
            case 9:
                return HabitatType.Metal;
            case 10:
                return HabitatType.Ammonia;
            case 11:
                return HabitatType.Argon;
            case 12:
                return HabitatType.CarbonDioxide;
            case 13:
                return HabitatType.Chlorine;
            case 14:
                return HabitatType.Helium;
            case 15:
                return HabitatType.Hydrogen;
            case 16:
                return HabitatType.NitrogenOxygen;
            case 17:
                return HabitatType.Oxygen;
            default:
                return HabitatType.Continental;
        }
    }

    // Port of ResourceDefinitionList.cs CheckPrevalenceValidForHabitat
    // (line 56). Distribution type: 0=Planet/Moon, 1=Asteroid, 2=GasCloud.
    private checkPrevalenceValidForHabitat(habitat: Habitat, dist: Resource['distributions'][number]): boolean {
        if (this.resolveHabitatTypeByIndexIncludeGasClouds(dist.subType) !== habitat.type) {
            return false;
        }
        let valid = false;
        switch (habitat.category) {
            case HabitatCategoryType.Planet:
            case HabitatCategoryType.Moon:
                valid = dist.type !== 1 && dist.type !== 2;
                break;
            case HabitatCategoryType.Asteroid:
                // C#: this.Type == 1 && this.Type != 2 (the second
                // conjunct is redundant for a single value).
                valid = dist.type === 1;
                break;
            case HabitatCategoryType.GasCloud:
                // C#: this.Type == 2 && this.Type != 1.
                valid = dist.type === 2;
                break;
        }
        return valid;
    }

    // Port of ResourceDefinitionList.cs ResolveValidResourcesForHabitatExcludeManufactured
    // (line 111): resource IDs with a prevalence valid for this habitat
    // (same test as CheckPrevalenceValidForHabitat), excluding manufactured.
    private resolveValidResourcesForHabitatExcludeManufactured(habitat: Habitat): number[] {
        const list: number[] = [];
        for (const def of this.resources) {
            if (def === null || def.colonyManufacturingLevel > 0 || def.distributions.length <= 0) continue;
            for (const dist of def.distributions) {
                if (dist !== null && this.checkPrevalenceValidForHabitat(habitat, dist)) {
                    list.push(def.resourceId);
                    break;
                }
            }
        }
        return list;
    }

    // Port of ResourceSystem.cs GenerateRandomOrderedResources (line 225):
    // Fisher-Yates-style partial shuffle using the (substituted) CryptoRnd.
    private generateRandomOrderedResources(): Resource[] {
        const list = this.resources.slice();
        const ordered: Resource[] = [];
        while (list.length > 0) {
            const index = this.cryptoRnd.next(0, list.length);
            if (index >= 0 && index < list.length) {
                ordered.push(list[index]);
                list.splice(index, 1);
            }
        }
        return ordered;
    }

    // Port of ResourceDefinitionList.cs GetByName.
    private getResourceByName(name: string): Resource | null {
        for (const resource of this.resources) {
            if (resource.name === name) {
                return resource;
            }
        }
        return null;
    }

    // C# Resource.Name is a computed property: ResourceSystemStatic.Resources
    // [ResourceID].Name (Resource.cs:26).
    private getResourceName(resourceId: number): string {
        for (const resource of this.resources) {
            if (resource.resourceId === resourceId) {
                return resource.name;
            }
        }
        return '';
    }

    // Port of Galaxy.4.cs SelectResources (line 3270, all overloads collapse
    // into default parameters here). Prevalence/abundance rolls use the
    // (substituted) CryptoRnd stream; the resource-count roll uses Galaxy.Rnd.
    // C# HabitatResourceList.Add rejects duplicate resource IDs, but the
    // abundance roll happens before Add — so the roll is always performed
    // and only the push is skipped on duplicates (keeps the RNG sequence).
    selectResources(
        habitat: Habitat,
        minimumResourceCount = 0,
        dominantRace: Race | null = null,
        minimumCriticalResourceCount = 0,
        randomOrderedResources: Resource[] | null = null,
    ): Habitat {
        let num = 0;
        if (this.starCount <= 250) {
            num = 1;
        }
        let num2: number;
        if (habitat.diameter >= 85) {
            if (habitat.diameter < 130) {
                num2 = this.rnd.next(0, 3 + num);
            } else if (habitat.diameter >= 170) {
                num2 = this.rnd.next(1 + num, 6);
            } else {
                num2 = this.rnd.next(0, 4 + num);
            }
        } else {
            num2 = this.rnd.next(0, 2 + num);
            if (habitat.category === HabitatCategoryType.Asteroid) {
                num2 = 0;
                if (this.rnd.next(0, 3) === 1) {
                    num2 = this.rnd.next(0, 2 + num);
                }
            }
        }
        if (num2 < minimumResourceCount) {
            num2 = minimumResourceCount;
        }
        minimumCriticalResourceCount = Math.min(minimumCriticalResourceCount, num2);
        // Galaxy.4.cs SelectResources (5-arg): dominant race's critical
        // resources. Source quirk: the C# 4-arg overload passes null for the
        // race, so the one race-passing caller (Galaxy.7.cs:5375) never
        // reaches this; 4-arg-style call sites must pass null here.
        if (dominantRace !== null && minimumResourceCount > 0) {
            const resourceList: number[] = [];
            const resourceList2 = dominantRace.criticalResources.map((b) => b.resourceId);
            for (let i = 0; i < resourceList2.length && i < minimumCriticalResourceCount; i++) {
                resourceList.push(resourceList2[i]);
            }
            const resourceList3 = this.resolveValidResourcesForHabitatExcludeManufactured(habitat);
            for (let j = 0; j < resourceList.length; j++) {
                if (resourceList3.includes(resourceList[j])) {
                    const abundance = this.rnd.next(200, 800);
                    if (!habitat.resources.some((r) => r.resourceId === resourceList[j])) {
                        habitat.resources.push({ resourceId: resourceList[j], abundance });
                    }
                }
            }
        }
        if (randomOrderedResources === null || randomOrderedResources.length <= 0) {
            randomOrderedResources = this.generateRandomOrderedResources();
        }
        for (let k = 0; k < randomOrderedResources.length; k++) {
            if (habitat.resources.length >= 5) {
                break;
            }
            const resourceDefinition = randomOrderedResources[k];
            if (
                resourceDefinition === null ||
                resourceDefinition.colonyManufacturingLevel > 0 ||
                resourceDefinition.distributions.length <= 0 ||
                resourceDefinition.superLuxuryBonusAmount > 0
            ) {
                continue;
            }
            for (let l = 0; l < resourceDefinition.distributions.length; l++) {
                const dist = resourceDefinition.distributions[l];
                if (dist === null || !this.checkPrevalenceValidForHabitat(habitat, dist)) {
                    continue;
                }
                // C#: float num3 = (float)CryptoRnd.NextDouble(); compared
                // against the float prevalence.
                const num3 = Math.fround(this.cryptoRnd.nextDouble());
                if (num3 < Math.fround(dist.prevalence)) {
                    let val = Math.trunc(Math.fround(dist.abundanceMin) * 1000);
                    let val2 = Math.trunc(Math.fround(dist.abundanceMax) * 1000);
                    val = Math.max(0, Math.min(1000, val));
                    val2 = Math.max(0, Math.min(1000, val2));
                    if (val > val2) {
                        val = val2;
                    }
                    const abundance = this.cryptoRnd.next(val, val2);
                    if (!habitat.resources.some((r) => r.resourceId === resourceDefinition.resourceId)) {
                        habitat.resources.push({ resourceId: resourceDefinition.resourceId, abundance });
                    }
                }
            }
        }
        return habitat;
    }

    // Port of Galaxy.6.cs SelectHabitatPictures (line 2062).
    selectHabitatPictures(habitat: Habitat): void {
        if (habitat.category === HabitatCategoryType.Asteroid) {
            switch (habitat.type) {
                case HabitatType.BarrenRock:
                    habitat.pictureRef = 2000 + this.rnd.next(0, 10);
                    habitat.landscapePictureRef = 200 + this.rnd.next(0, 10);
                    break;
                case HabitatType.Ice:
                    habitat.pictureRef = 2100 + this.rnd.next(0, 10);
                    habitat.landscapePictureRef = 200 + this.rnd.next(0, 10);
                    break;
                case HabitatType.Metal:
                    habitat.pictureRef = 2200 + this.rnd.next(0, 10);
                    habitat.landscapePictureRef = 200 + this.rnd.next(0, 10);
                    break;
                default:
                    habitat.pictureRef = 2000 + this.rnd.next(0, 10);
                    habitat.landscapePictureRef = 200 + this.rnd.next(0, 10);
                    break;
            }
            return;
        }
        switch (habitat.type) {
            case HabitatType.BarrenRock:
                habitat.pictureRef = 100 + this.rnd.next(0, 10);
                habitat.landscapePictureRef = 200 + this.rnd.next(0, 10);
                break;
            case HabitatType.Continental:
                habitat.pictureRef = 300 + this.rnd.next(0, 10);
                habitat.landscapePictureRef = 400 + this.rnd.next(0, 10);
                break;
            case HabitatType.FrozenGasGiant:
                // Port of Galaxy.6.cs SelectHabitatPictures FrozenGasGiant
                // case (2097-2143). GalaxyImages constants: landscape
                // 9+Next(0,2); pictures Argon 67/10, Helium 77/10, Krypton
                // 87/11, Tyderios 98/13, Any 111/10.
                habitat.landscapePictureRef = 9 + this.rnd.next(0, 2);
                if (habitat.resources.length > 0) {
                    if (this.rnd.next(0, 5) === 1) {
                        habitat.pictureRef = 111 + this.rnd.next(0, 10);
                        break;
                    }
                    let text2 = 'Tyderios';
                    let num2 = 0;
                    for (const resource of habitat.resources) {
                        if (resource.abundance > num2) {
                            text2 = this.getResourceName(resource.resourceId);
                            num2 = resource.abundance;
                        }
                    }
                    switch (text2.toLowerCase()) {
                        case 'argon':
                            habitat.pictureRef = 67 + this.rnd.next(0, 10);
                            break;
                        case 'helium':
                            habitat.pictureRef = 77 + this.rnd.next(0, 10);
                            break;
                        case 'krypton':
                            habitat.pictureRef = 87 + this.rnd.next(0, 11);
                            break;
                        case 'tyderios':
                            habitat.pictureRef = 98 + this.rnd.next(0, 13);
                            break;
                        default:
                            habitat.pictureRef = 67 + this.rnd.next(0, 10 + 10 + 11 + 13 + 10);
                            break;
                    }
                } else {
                    habitat.pictureRef = 67 + this.rnd.next(0, 10 + 10 + 11 + 13 + 10);
                }
                break;
            case HabitatType.GasGiant:
                // Port of Galaxy.6.cs SelectHabitatPictures GasGiant case
                // (2144-2193). GalaxyImages constants: landscape 11+Next(0,6);
                // pictures Argon 121/5, Caslon 126/5, Helium 131/8, Hydrogen
                // 139/8, Krypton 147/5, Any 152/2.
                habitat.landscapePictureRef = 11 + this.rnd.next(0, 6);
                if (habitat.resources.length > 0) {
                    if (this.rnd.next(0, 5) === 1) {
                        habitat.pictureRef = 152 + this.rnd.next(0, 2);
                        break;
                    }
                    let text = 'Hydrogen';
                    let num = 0;
                    for (const resource of habitat.resources) {
                        if (resource.abundance > num) {
                            text = this.getResourceName(resource.resourceId);
                            num = resource.abundance;
                        }
                    }
                    switch (text.toLowerCase()) {
                        case 'argon':
                            habitat.pictureRef = 121 + this.rnd.next(0, 5);
                            break;
                        case 'helium':
                            habitat.pictureRef = 131 + this.rnd.next(0, 8);
                            break;
                        case 'krypton':
                            habitat.pictureRef = 147 + this.rnd.next(0, 5);
                            break;
                        case 'caslon':
                            habitat.pictureRef = 126 + this.rnd.next(0, 5);
                            break;
                        case 'hydrogen':
                            habitat.pictureRef = 139 + this.rnd.next(0, 8);
                            break;
                        default:
                            habitat.pictureRef = 121 + this.rnd.next(0, 2 + 5 + 5 + 8 + 8 + 5);
                            break;
                    }
                } else {
                    habitat.pictureRef = 121 + this.rnd.next(0, 2 + 5 + 5 + 8 + 8 + 5);
                }
                break;
            case HabitatType.Ice:
                habitat.pictureRef = 500 + this.rnd.next(0, 10);
                habitat.landscapePictureRef = 600 + this.rnd.next(0, 10);
                break;
            case HabitatType.MarshySwamp:
                habitat.pictureRef = 700 + this.rnd.next(0, 10);
                habitat.landscapePictureRef = 800 + this.rnd.next(0, 10);
                break;
            case HabitatType.Ocean:
                habitat.pictureRef = 900 + this.rnd.next(0, 10);
                habitat.landscapePictureRef = 1000 + this.rnd.next(0, 10);
                break;
            case HabitatType.Desert:
                habitat.pictureRef = 1100 + this.rnd.next(0, 10);
                habitat.landscapePictureRef = 1200 + this.rnd.next(0, 10);
                break;
            case HabitatType.Volcanic:
                habitat.pictureRef = 1300 + this.rnd.next(0, 10);
                habitat.landscapePictureRef = 1400 + this.rnd.next(0, 10);
                break;
            // MainSequence/RedGiant/SuperGiant/WhiteDwarf/Neutron/BlackHole
            // (stars) and SuperNova aren't reachable here: SetupSolarSystem
            // only calls SelectHabitatPictures for planets/moons/asteroids.
        }
    }

    // Port of Galaxy.4.cs SelectHabitatQuality (line 3170)
    selectHabitatQuality(habitat: Habitat, colonyPrevalence: number): number {
        let base = 0;
        let spread = 0;
        let lifeChance = 0;
        switch (habitat.type) {
            case HabitatType.BarrenRock:
                base = 0;
                spread = 0.02;
                lifeChance = 0;
                break;
            case HabitatType.Continental:
                base = 1;
                spread = 0.2;
                lifeChance = 0;
                break;
            case HabitatType.Ice:
                base = 0.3;
                spread = 0.18;
                lifeChance = 0.11 * colonyPrevalence;
                break;
            case HabitatType.MarshySwamp:
                base = 0.85;
                spread = 0.15;
                lifeChance = 0;
                break;
            case HabitatType.Ocean: {
                base = 0.8;
                spread = 0.75;
                const diff = base - 0.5;
                base = diff * colonyPrevalence + 0.5;
                lifeChance = 0.03 * colonyPrevalence;
                break;
            }
            case HabitatType.Desert: {
                base = 0.75;
                spread = 0.72;
                const diff = base - 0.5;
                base = diff * colonyPrevalence + 0.5;
                lifeChance = 0.08 * colonyPrevalence;
                break;
            }
            case HabitatType.Volcanic:
                base = 0.25;
                spread = 0.18;
                lifeChance = 0.18 * colonyPrevalence;
                break;
            default:
                base = 0;
                spread = 0;
                lifeChance = 0;
                break;
        }
        let quality = base - this.rnd.nextDouble() * spread;
        if (this.rnd.nextDouble() < lifeChance) {
            quality = 0.5 + this.rnd.nextDouble() * 0.5;
        }
        if (quality >= 0.5 && quality < 0.6 && this.rnd.next(0, 5) > 0) {
            quality = 0.6 + this.rnd.nextDouble() * 0.12;
        }
        return Math.min(1, Math.max(0, quality));
    }

    // Port of Galaxy.9.cs GenerateTreasureAsteroid.
    // TextResolver.GetText("Asteroid") = "Asteroid" (TextResolver not ported —
    // literal used). GalaxyImages: LandscapeImageOffsetBarrenRock=0,
    // LandscapeImageCountBarrenRock=4; HabitatImageOffsetAsteroidsGold=649,
    // HabitatImageCountAsteroidsGold=8; HabitatImageOffsetAsteroidsCrystal=657,
    // HabitatImageCountAsteroidsCrystal=8.
    private generateTreasureAsteroid(
        sun: Habitat,
        orbitAngle: number,
        orbitDistance: number,
        orbitDirection: boolean,
        orbitSpeed: number,
        doInitialMove: boolean,
    ): Habitat | null {
        const byName = this.getResourceByName('Gold');
        const byName2 = this.getResourceByName('Dilithium Crystal');
        if (byName === null && byName2 === null) {
            return null;
        }
        const habitat = new Habitat(HabitatCategoryType.Asteroid, HabitatType.Metal, 'Asteroid', sun, orbitAngle, orbitDirection, orbitDistance, orbitSpeed, doInitialMove);
        habitat.diameter = this.rnd.next(35, 50);
        habitat.landscapePictureRef = 0 + this.rnd.next(0, 4);
        const abundance = this.rnd.next(800, 1000);
        if (byName2 === null) {
            // byName is non-null: the both-null case returned above.
            habitat.pictureRef = 649 + this.rnd.next(0, 8);
            habitat.resources.push({ resourceId: byName!.resourceId, abundance });
            habitat.name = this.generateGoldAsteroidName(sun);
        } else if (byName === null) {
            habitat.pictureRef = 657 + this.rnd.next(0, 8);
            habitat.resources.push({ resourceId: byName2.resourceId, abundance });
            habitat.name = this.generateCrystalAsteroidName(sun);
        } else if (this.rnd.next(0, 2) === 1) {
            habitat.pictureRef = 649 + this.rnd.next(0, 8);
            habitat.resources.push({ resourceId: byName.resourceId, abundance });
            habitat.name = this.generateGoldAsteroidName(sun);
        } else {
            habitat.pictureRef = 657 + this.rnd.next(0, 8);
            habitat.resources.push({ resourceId: byName2.resourceId, abundance });
            habitat.name = this.generateCrystalAsteroidName(sun);
        }
        habitat.scenicFactor = 0.3 + this.rnd.nextDouble() * 0.3;
        return habitat;
    }

    // Port of Galaxy.9.cs GenerateGoldAsteroidName.
    private generateGoldAsteroidName(sun: Habitat | null): string {
        const array = ['Concealed', 'Lost', 'Golden', 'Precious', 'Glittering', 'Hidden', "Miner's"];
        const array2 = ['Hoard', 'Rock', 'Treasure', 'Nugget', 'Fortune', 'Folly', 'Legend', 'Star', 'Prize'];
        if (sun !== null && sun.type !== HabitatType.SuperNova && this.rnd.next(0, 3) === 1) {
            if (this.rnd.next(0, 2) === 1) {
                return sun.name + ' ' + array2[this.rnd.next(0, array2.length)];
            }
            return array2[this.rnd.next(0, array2.length)] + ' of ' + sun.name;
        }
        return array[this.rnd.next(0, array.length)] + ' ' + array2[this.rnd.next(0, array2.length)];
    }

    // Port of Galaxy.9.cs GenerateCrystalAsteroidName.
    private generateCrystalAsteroidName(sun: Habitat | null): string {
        const array = ['Concealed', 'Lost', 'Shining', 'Precious', 'Glittering', 'Hidden', "Miner's", 'Crystal'];
        const array2 = ['Hoard', 'Rock', 'Treasure', 'Jewel', 'Fortune', 'Folly', 'Legend', 'Star', 'Prize', 'Gem'];
        if (sun !== null && sun.type !== HabitatType.SuperNova && this.rnd.next(0, 3) === 1) {
            if (this.rnd.next(0, 2) === 1) {
                return sun.name + ' ' + array2[this.rnd.next(0, array2.length)];
            }
            return array2[this.rnd.next(0, array2.length)] + ' of ' + sun.name;
        }
        return array[this.rnd.next(0, array.length)] + ' ' + array2[this.rnd.next(0, array2.length)];
    }

    // Port of Galaxy.9.cs GenerateAsteroidField (line 3482 overload; the
    // simpler overloads at 3463/3470 that resolve nearestSystemStar/
    // orbitDistance via FindNearestSystemGasCloudAsteroid aren't ported —
    // SetupSolarSystem always supplies nearestSystemStar/orbitDistance
    // directly). `randomOrderedResources` defaults to null, in which case
    // SelectResources shuffles all resources (C#
    // GenerateRandomOrderedResources).
    private generateAsteroidFieldAt(
        asteroidCount: number,
        x: number,
        y: number,
        nearestSystemStar: Habitat,
        orbitDirection: boolean,
        orbitSpeed: number,
        orbitDistance: number,
        distanceSpreadFactor: number,
        arcSpreadFactor: number,
        type: HabitatType,
        randomOrderedResources?: Resource[] | null,
    ): Habitat[] {
        const result: Habitat[] = [];
        const baseAngle = this.calculateAngleFromCoords(x, y, nearestSystemStar.xpos, nearestSystemStar.ypos, orbitDistance);
        let arcSpread = arcSpreadFactor * arcSpreadFactor;
        let val = (MAX_SOLAR_SYSTEM_SIZE - orbitDistance) / (MAX_SOLAR_SYSTEM_SIZE / 3);
        val = Math.min(3.0, Math.max(0.3, val));
        arcSpread *= val;
        const distSpread = Math.max(0.06, 0.13 * (asteroidCount / 350.0));
        const distRange = Math.max(250.0, 500.0 * (asteroidCount / 350.0) * distanceSpreadFactor);
        const negHalf = -0.4;
        let minDist = orbitDistance + negHalf * distRange * distanceSpreadFactor;
        let maxDist = orbitDistance + 0.4 * distRange * distanceSpreadFactor;
        let minAngle = baseAngle + negHalf * distSpread * arcSpread;
        let maxAngle = baseAngle + 0.4 * distSpread * arcSpread;
        if (minAngle > maxAngle) {
            const tmp = maxAngle;
            maxAngle = minAngle;
            minAngle = tmp;
        }
        for (let i = 0; i < asteroidCount; i++) {
            let diameter = this.rnd.next(10, 25);
            if (this.rnd.next(0, 30) === 5) {
                diameter = this.rnd.next(26, 45);
            }
            const pictureRef = 2000 + this.rnd.next(0, 10);
            let dist = orbitDistance + Math.trunc((this.rnd.nextDouble() - 0.5) * this.rnd.nextDouble() * 2.0 * distRange * distanceSpreadFactor);
            let angle = baseAngle + (this.rnd.nextDouble() - 0.5) * this.rnd.nextDouble() * 2.0 * distSpread * arcSpread;
            if (dist > minDist && dist < maxDist && angle > minAngle && angle < maxAngle) {
                const distFrac = this.rnd.nextDouble() * 0.8 - 0.4;
                const angleFrac = this.rnd.nextDouble() * 0.8 - 0.4;
                dist = orbitDistance + Math.trunc(distFrac * distRange * distanceSpreadFactor);
                angle = baseAngle + angleFrac * distSpread * arcSpread;
            }
            const name = this.generateCodeName() + ', Asteroid Field';
            const asteroid = new Habitat(HabitatCategoryType.Asteroid, HabitatType.BarrenRock, name, nearestSystemStar, angle, orbitDirection, dist, orbitSpeed, false);
            asteroid.diameter = diameter;
            asteroid.pictureRef = pictureRef;
            asteroid.landscapePictureRef = -1;
            let minimumResourceCount = 0;
            if (type === HabitatType.Metal && this.rnd.next(0, 3) > 0) {
                minimumResourceCount = 1;
            }
            // C# calls SelectResources(habitat, minimumResourceCount, null, 0,
            // randomOrderedResources) while habitat.Type is still BarrenRock,
            // then sets habitat.Type = type.
            this.selectResources(asteroid, minimumResourceCount, null, 0, randomOrderedResources ?? null);
            asteroid.type = type;
            this.selectHabitatPictures(asteroid);
            if (this.rnd.next(0, 1300) === 1) {
                const treasure = this.generateTreasureAsteroid(nearestSystemStar, angle, dist, orbitDirection, orbitSpeed, false);
                if (treasure !== null) {
                    // C# replaces the asteroid with the treasure habitat (it
                    // would add null if GenerateTreasureAsteroid returned
                    // null); we keep the original asteroid in that case.
                    result.push(treasure);
                    continue;
                }
            }
            result.push(asteroid);
        }
        return result;
    }

    // Port of Galaxy.4.cs DetermineNearestRaceRegion(x, y) (Galaxy.4.cs:1919).
    // Returns the RaceRegion GalaxyLocation whose center is closest to (x, y),
    // or null when there are no race regions.
    determineNearestRaceRegion(x: number, y: number): GalaxyLocation | null {
        let result: GalaxyLocation | null = null;
        let num = Number.MAX_VALUE;
        for (let i = 0; i < this.galaxyLocations.length; i++) {
            if (this.galaxyLocations[i].type === GalaxyLocationType.RaceRegion) {
                const center = this.galaxyLocations[i].resolveLocationCenter();
                const num2 = this.calculateDistanceSquared(x, y, center.x, center.y);
                if (num2 < num) {
                    result = this.galaxyLocations[i];
                    num = num2;
                }
            }
        }
        return result;
    }

    // Port of Galaxy.6.cs CheckIndependentColonyLimitForRace(race)
    // (Galaxy.6.cs:1273). _LifePrevalence defaults to 1000 (C# ctor), so the
    // limit is (int)(Math.Sqrt(StarCount) / 3.5 * _LifePrevalence / 1000.0).
    private checkIndependentColonyLimitForRace(race: Race): boolean {
        const num = this.lifePrevalence / 1000.0;
        const num2 = Math.trunc(Math.sqrt(this.starCount) / 3.5 * num);
        if (this.raceIndependentColonyCount === null || this.raceIndependentColonyCount.length === 0) {
            this.raceIndependentColonyCount = [];
            for (let i = 0; i < this.races.length; i++) {
                this.raceIndependentColonyCount.push(0);
            }
        }
        // C# indexes by race.PictureRef (list sized Races.Count — quirk kept).
        const num3 = this.raceIndependentColonyCount[race.pictureIndex] ?? 0;
        return num3 >= num2;
    }

    // Port of Galaxy.6.cs RenameSystemIfHome(sun, race) (Galaxy.6.cs:1320).
    // The first native population of a given race renames its star system to
    // the race's HomeSystemName and marks that race as used.
    private renameSystemIfHome(sun: Habitat, race: Race, raceUsed: boolean[]): void {
        const pictureRef = race.pictureIndex;
        if (!raceUsed[pictureRef]) {
            sun.name = race.homeSystemName;
            raceUsed[pictureRef] = true;
        }
    }

    // Port of Galaxy.6.cs CalculatePopulationAmount(habitat, race)
    // (Galaxy.6.cs:1330). habitat.Quality reduces to BaseQuality at
    // generation time (no bases/creatures yet).
    private calculatePopulationAmount(habitat: Habitat, race: Race): number {
        let num = habitat.baseQuality * 1000;
        if (habitat.type === race.nativeHabitatType) {
            num *= 1.5;
        }
        let num2 = 0;
        const num3 = this.rnd.next(0, 30);
        // C# multiplies by (long)num — truncate before multiplying.
        num2 = num3 < 0 || num3 > 6 ? this.rnd.next(100000, 300000) * Math.trunc(num) : this.rnd.next(300000, 600000) * Math.trunc(num);
        if (this.age > 0) {
            num2 = Math.trunc(num2 * Math.pow(1.2, this.age));
        }
        return num2;
    }

    // Port of Galaxy.6.cs SelectPopulation(habitat, sun) (Galaxy.6.cs:1218).
    // Places an independent (native) population on the habitat when the
    // nearest race region's race natively inhabits this habitat type and the
    // per-race independent-colony limit hasn't been reached. Every Rnd call
    // goes through this.rnd in source order.
    selectPopulation(habitat: Habitat, sun: Habitat): void {
        if (habitat.diameter < 75) {
            return;
        }
        if (this.raceUsed === null) {
            this.raceUsed = new Array(this.races.length).fill(false);
        }
        const raceUsed = this.raceUsed;
        let race: Race | null = null;
        const galaxyLocation = this.determineNearestRaceRegion(habitat.xpos, habitat.ypos);
        if (galaxyLocation !== null) {
            race = galaxyLocation.relatedRace;
        }
        if (race !== null && race.nativeHabitatType === habitat.type && !this.checkIndependentColonyLimitForRace(race)) {
            if (habitat.baseQuality < 0.6) {
                // C#: habitat.BaseQuality = 0.5f + (float)(Rnd.NextDouble() * 0.4)
                // (float casts throughout — Math.fround matches).
                habitat.baseQuality = Math.fround(0.5 + Math.fround(this.rnd.nextDouble() * 0.4));
            }
            const num = 1;
            for (let i = 0; i < num; i++) {
                this.independentCount++;
                const amount = this.calculatePopulationAmount(habitat, race);
                const population = new Population(race, amount);
                // C#: population.GrowthRate = 1f + ((float)race.ReproductiveRate - 1f) / 3f
                population.growthRate = Math.fround(1 + (Math.fround(race.reproductionRate) - 1) / 3);
                if (this.raceIndependentColonyCount !== null) {
                    const idx = race.pictureIndex;
                    if (idx < this.raceIndependentColonyCount.length) {
                        this.raceIndependentColonyCount[idx]++;
                    }
                }
                habitat.population.add(population);
                this.renameSystemIfHome(sun, race, raceUsed);
            }
            habitat.population.recalculateTotalAmount();
        }
    }
    // ---- Task 08e1: home-system colony helpers (Galaxy.8.cs / Galaxy.9.cs) ----

    private systemHabitatsExcludingStar(systemStar: Habitat): Habitat[] {
        return this.systemHabitatsOf(systemStar.systemIndex);
    }

    // Port of Galaxy.8.cs ResolveHomeSystem (line 595).
    static resolveHomeSystem(homeSystemDescription: string): { capitalHabitatType: HabitatType; homeSystemFactor: number } {
        switch (homeSystemDescription) {
            case 'Harsh':
                return { capitalHabitatType: HabitatType.Desert, homeSystemFactor: 0.4 };
            case 'Trying':
                return { capitalHabitatType: HabitatType.MarshySwamp, homeSystemFactor: 0.7 };
            case 'Normal':
                return { capitalHabitatType: HabitatType.MarshySwamp, homeSystemFactor: 1.0 };
            case 'Agreeable':
                return { capitalHabitatType: HabitatType.Continental, homeSystemFactor: 1.4 };
            case 'Excellent':
                return { capitalHabitatType: HabitatType.Continental, homeSystemFactor: 2.0 };
        }
        return { capitalHabitatType: HabitatType.Undefined, homeSystemFactor: 0.0 };
    }

    // Port of Galaxy.8.cs DetermineEmpireExpansion (line 626); constants
    // EmpireAgeExpansionRateMinimum/Maximum from Galaxy.3.cs 5053-5054.
    static determineEmpireExpansion(rnd: Random, age: number): number {
        const EmpireAgeExpansionRateMinimum = 2.3;
        const EmpireAgeExpansionRateMaximum = 2.7;
        let num = 1.0;
        const num2 = EmpireAgeExpansionRateMaximum - EmpireAgeExpansionRateMinimum;
        age--;
        for (let i = 0; i < age; i++) {
            const num3 = EmpireAgeExpansionRateMinimum + rnd.nextDouble() * num2;
            num *= num3;
        }
        return num;
    }

    // Port of Galaxy.8.cs CheckPlanetaryOrbitalOverlap (line 367).
    private checkPlanetaryOrbitalOverlap(systemStar: Habitat, orbitDistance: number): boolean {
        const num = 150;
        for (const habitat of this.systemHabitatsExcludingStar(systemStar)) {
            const num2 = habitat.orbitDistance - num;
            const num3 = habitat.orbitDistance + num;
            if (orbitDistance >= num2 && orbitDistance <= num3) {
                return true;
            }
        }
        return false;
    }

    // Port of Galaxy.8.cs GeneratePlanetaryOrbitDistance (line 390).
    private generatePlanetaryOrbitDistance(systemStar: Habitat, minOrbitDistance: number, maxOrbitDistance: number): number {
        let num = this.rnd.next(minOrbitDistance, maxOrbitDistance);
        let num2 = 0;
        while (this.checkPlanetaryOrbitalOverlap(systemStar, num) && num2 < 20) {
            num = this.rnd.next(minOrbitDistance, maxOrbitDistance);
            num2++;
        }
        return num;
    }

    // Port of Galaxy.8.cs GenerateContinentalPlanet (line 458), habitat fields only.
    generateContinentalPlanet(sun: Habitat): Habitat {
        const { type, pictureRef, diameter, minOrbitDistance, maxOrbitDistance, landscapePictureRef } = this.selectContinentalPlanet();
        const orbitdistance = this.generatePlanetaryOrbitDistance(sun, minOrbitDistance, maxOrbitDistance);
        const name = this.generateRandomName();
        const orbitAngle = this.rnd.nextDouble() * Math.PI * 2.0;
        const habitat = new Habitat(HabitatCategoryType.Planet, type, name, sun, orbitAngle, true, orbitdistance, this.rnd.next(2, 5));
        habitat.diameter = diameter;
        habitat.pictureRef = pictureRef;
        habitat.landscapePictureRef = landscapePictureRef;
        habitat.baseQuality = this.selectHabitatQuality(habitat, this.colonyPrevalence);
        // TODO(port): DoTasks(CurrentDateTime) — Habitat.DoTasks (galaxy-time driven).
        this.selectResources(habitat);
        if (this.rnd.next(0, 5) === 2) {
            habitat.orbitDirection = false;
        }
        // Galaxy.8.cs 483 (M4h): habitat.ConstructionQueue = new ConstructionQueue(habitat, galaxy). No Rnd.
        newHabitatConstructionQueue(this, habitat);
        // Galaxy.8.cs 484 (M4g): habitat.ManufacturingQueue = new ManufacturingQueue(habitat, galaxy).
        ensureHabitatManufacturingQueue(this, habitat);
        // Galaxy.8.cs 485-493 (M4e): 20 DockingBays (component 74, capacity 100) + DockingBayWaitQueue. No Rnd.
        createHabitatDockingBays(habitat, 20);
        // TODO(port): Cargo/Troops/TroopsToRecruit/InvadingTroops — Galaxy.8.cs GenerateContinentalPlanet.
        return habitat;
    }

    // Port of Galaxy.9.cs AddHabitat (line 3225). Index maps (HabitatIndex
    // grid, FixResourceMaps, SetSystemHabitatExploration) don't exist yet;
    // later Habitats entries are re-numbered so habitatIndex == position.
    addHabitat(habitat: Habitat, nearestSystemStar: Habitat | null): boolean {
        if (nearestSystemStar === null) {
            return false;
        }
        const others = this.systemHabitatsOf(nearestSystemStar.systemIndex);
        const system = this.systems[nearestSystemStar.systemIndex];
        const num = others.length <= 0 ? system.systemStar.habitatIndex + 1 : others[others.length - 1].habitatIndex + 1;
        habitat.habitatIndex = num;
        habitat.systemIndex = nearestSystemStar.systemIndex;
        this.habitats.splice(num, 0, habitat);
        system.habitats.push(habitat);
        // Galaxy.9.cs 3235: HabitatIndex[galaxyIndex].Add(habitat) (index of the system star).
        if (this.habitatIndexGrid.length > 0) {
            const gi = this.resolveIndex(Math.trunc(nearestSystemStar.xpos), Math.trunc(nearestSystemStar.ypos));
            this.habitatIndexGrid[gi.x][gi.y].push(habitat);
        }
        this.fixResourceMaps(habitat.habitatIndex + 1, this.habitats.length - 1, 1, [habitat]);
        this.setSystemHabitatExploration(habitat, nearestSystemStar);
        return true;
    }

    // Port of Galaxy.9.cs FixResourceMaps(startIndex, endIndex, movement, newHabitats) (2994):
    // snapshot every resource map by the (not yet reindexed) HabitatIndex values, reindex
    // (ReindexHabitats 3595), then rebuild the maps sized for the new habitat count.
    private fixResourceMaps(startIndex: number, endIndex: number, movement: number, newHabitats: Habitat[] | null): void {
        const snapshot = (map: GalaxyResourceMap | null): boolean[] => {
            const out = new Array<boolean>(this.habitats.length).fill(false);
            if (map === null) return out;
            for (let j = 0; j < this.habitats.length; j++) {
                const h = this.habitats[j];
                out[j] = newHabitats !== null && newHabitats.includes(h) ? false : map.checkResourcesKnownRaw(h.habitatIndex);
            }
            return out;
        };
        const list = this.empires.map((e) => snapshot(e.resourceMap ?? null));
        const list3 = this.independentEmpire !== null ? snapshot(this.independentEmpire.resourceMap ?? null) : null;
        const list2 = this.pirateEmpires.map((e) => snapshot(e.resourceMap ?? null));
        // ReindexHabitats
        for (let j = startIndex; j <= endIndex; j++) {
            if (j < this.habitats.length && (newHabitats === null || newHabitats.length === 0 || !newHabitats.includes(this.habitats[j]))) {
                this.habitats[j].habitatIndex += movement;
            }
        }
        const rebuild = (map: GalaxyResourceMap, known: boolean[]) => {
            map.initializeFlags(this.habitats.length, this);
            for (let k = 0; k < this.habitats.length; k++) map.setResourcesKnownRaw(this.habitats[k].habitatIndex, known[k]);
        };
        this.empires.forEach((e, i) => {
            if (e.resourceMap) rebuild(e.resourceMap, list[i]);
        });
        this.pirateEmpires.forEach((e, i) => {
            if (e.resourceMap) rebuild(e.resourceMap, list2[i]);
        });
        if (this.independentEmpire?.resourceMap && list3 !== null) rebuild(this.independentEmpire.resourceMap, list3);
    }

    // Port of Galaxy.9.cs SetSystemHabitatExploration / SetSystemHabitatsExploration (3326/3333).
    private setSystemHabitatExploration(systemHabitat: Habitat, systemStar: Habitat): void {
        const seen = (s: SystemVisibilityStatus) => s === SystemVisibilityStatus.Explored || s === SystemVisibilityStatus.Visible;
        for (const e of this.empires) {
            if (!e.resourceMap) continue;
            if (!seen(e.visibility.systemVisibility[systemStar.systemIndex].status)) continue;
            e.resourceMap.setResourcesKnown(systemHabitat, true);
        }
        for (const e of this.pirateEmpires) {
            if (!e.resourceMap) continue;
            if (!seen(e.visibility.systemVisibility[systemStar.systemIndex].status)) continue;
            e.resourceMap.setResourcesKnown(systemHabitat, true);
        }
        const ind = this.independentEmpire;
        if (ind === null || !ind.resourceMap) return;
        if (!seen(ind.visibility.systemVisibility[systemStar.systemIndex].status)) return;
        ind.resourceMap.setResourcesKnown(systemHabitat, true);
    }

    // Port of Galaxy.8.cs SetColonizableHabitatsInSystem (line 95), including
    // the (Owner == null || Owner == IndependentEmpire) checks (102/106).
    setColonizableHabitatsInSystem(systemStar: Habitat, race: Race, colonyCount: number): void {
        const habitats = this.systemHabitatsExcludingStar(systemStar);
        const habitatList: Habitat[] = [];
        const habitatList2: Habitat[] = [];
        for (const item of habitats) {
            const unowned = item.owner === null || item.owner === this.independentEmpire;
            if (unowned && (item.population.totalAmount > 0 || item.type === race.nativeHabitatType) && item.category !== HabitatCategoryType.Asteroid) {
                habitatList.push(item);
            } else if (unowned) {
                if (
                    (item.category === HabitatCategoryType.Moon || item.category === HabitatCategoryType.Planet) &&
                    (item.type === HabitatType.MarshySwamp || item.type === HabitatType.Ocean || item.type === HabitatType.Desert)
                ) {
                    habitatList2.push(item);
                }
                if (item.category === HabitatCategoryType.Planet && item.type === HabitatType.BarrenRock) {
                    habitatList2.push(item);
                }
            }
        }
        if (habitatList.length > colonyCount) {
            const num = habitatList.length - colonyCount;
            for (let i = 0; i < num; i++) {
                if (habitatList[i].population.totalAmount <= 0) {
                    const sel = this.selectBarrenRockPlanet();
                    habitatList[i].type = HabitatType.BarrenRock;
                    habitatList[i].diameter = sel.diameter;
                    habitatList[i].pictureRef = sel.pictureRef;
                    habitatList[i].landscapePictureRef = sel.landscapePictureRef;
                    habitatList[i].baseQuality = this.selectHabitatQuality(habitatList[i], this.colonyPrevalence);
                    habitatList[i].resources = [];
                    this.selectResources(habitatList[i]);
                }
            }
        } else {
            if (habitatList.length >= colonyCount) {
                return;
            }
            const num2 = colonyCount - habitatList.length;
            for (let j = 0; j < num2; j++) {
                if (habitatList2.length > j) {
                    let sel = { diameter: 0, pictureRef: 0, landscapePictureRef: 0 };
                    switch (race.nativeHabitatType) {
                        case HabitatType.Continental:
                            sel = this.selectContinentalPlanet();
                            break;
                        case HabitatType.MarshySwamp:
                            sel = this.selectMarshySwampPlanet();
                            break;
                        case HabitatType.Ocean:
                            sel = this.selectOceanPlanet();
                            break;
                        case HabitatType.Desert:
                            sel = this.selectDesertPlanet();
                            break;
                        case HabitatType.Ice:
                            sel = this.selectIcePlanet();
                            break;
                        case HabitatType.Volcanic:
                            sel = this.selectVolcanicPlanet();
                            break;
                    }
                    habitatList2[j].type = race.nativeHabitatType;
                    habitatList2[j].diameter = sel.diameter;
                    habitatList2[j].pictureRef = sel.pictureRef;
                    habitatList2[j].landscapePictureRef = sel.landscapePictureRef;
                    habitatList2[j].baseQuality = Math.fround(0.7 + this.rnd.nextDouble() * 0.25);
                    habitatList2[j].resources = [];
                    this.selectResources(habitatList2[j]);
                } else {
                    const habitat = this.generateContinentalPlanet(systemStar);
                    this.addHabitat(habitat, systemStar);
                }
            }
        }
    }

    // Port of Galaxy.8.cs SetResourceLevelsInSystem (line 575).
    setResourceLevelsInSystem(systemStar: Habitat, resourceLevelMinimum: number, resourceLevelMaximum: number): void {
        for (const item of this.systemHabitatsExcludingStar(systemStar)) {
            if (item.category === HabitatCategoryType.Planet || item.category === HabitatCategoryType.Moon) {
                if (item.resources.length > resourceLevelMaximum) {
                    item.resources = [];
                } else if (item.resources.length < resourceLevelMinimum) {
                    item.resources = [];
                    this.selectResources(item, resourceLevelMinimum);
                }
            }
        }
    }

    // Port of the tail of Galaxy.7.cs GenerateEmpire (lines 5348-5375).
    // TODO(port): the rest of GenerateEmpire (Empire, policy, tech, troops,
    // population, expansion) — task 08e2, blocked on an Empire model.
    setupHomeSystem(capital: Habitat, race: Race, homeSystemDescription: string, minimumResourceCount: number, minimumCriticalResourceCount: number): void {
        const systemStar = this.determineHabitatSystemStar(capital);
        if (homeSystemDescription === 'Harsh') {
            this.setColonizableHabitatsInSystem(systemStar, race, 0);
            this.setResourceLevelsInSystem(systemStar, 0, 1);
        } else if (homeSystemDescription === 'Trying') {
            this.setColonizableHabitatsInSystem(systemStar, race, 0);
            this.setResourceLevelsInSystem(systemStar, 0, 2);
        } else if (homeSystemDescription === 'Normal') {
            this.setColonizableHabitatsInSystem(systemStar, race, 0);
            this.setResourceLevelsInSystem(systemStar, 1, 4);
        } else if (homeSystemDescription === 'Agreeable') {
            this.setColonizableHabitatsInSystem(systemStar, race, 1);
            this.setResourceLevelsInSystem(systemStar, 1, 5);
        } else if (homeSystemDescription === 'Excellent') {
            this.setColonizableHabitatsInSystem(systemStar, race, 2);
            this.setResourceLevelsInSystem(systemStar, 2, 5);
        }
        capital.resources = [];
        // C# calls the 4-arg SelectResources overload, which passes null for
        // the race (Galaxy.4.cs 3282) — see task 08c.
        this.selectResources(capital, minimumResourceCount, null, minimumCriticalResourceCount);
    }



    // Port of Galaxy.6.cs DetermineHabitatSystemStar(habitat) (Galaxy.6.cs:703).
    // Walks up the parent chain to the star; top-level habitats (stars, gas
    // clouds) are their own system star.
    determineHabitatSystemStar(habitat: Habitat): Habitat {
        let current = habitat;
        while (current.parent !== null) {
            current = current.parent;
        }
        return current;
    }

    // Port of Galaxy.6.cs SelectCreatures(habitat) (Galaxy.6.cs:654).
    // Rolls one Rnd.NextDouble() per call and, depending on the habitat's
    // type/category, spawns 1..9 creatures via GenerateCreatureAtHabitat.
    selectCreatures(habitat: Habitat): void {
        if (this.creaturePrevalence <= 0.0) {
            return;
        }
        const num = this.rnd.nextDouble();
        if (habitat.type === HabitatType.BarrenRock || habitat.category === HabitatCategoryType.Asteroid) {
            const num2 = this.creaturePrevalence * 0.009;
            if (num <= num2) {
                this.generateCreatureAtHabitat(CreatureType.RockSpaceSlug, habitat);
            }
        } else if (habitat.type === HabitatType.Desert) {
            const num3 = this.creaturePrevalence * 0.32;
            const flag = habitat.resources.some((r) => this.getResourceName(r.resourceId) === 'Korabbian Spice');
            if (num <= num3 || flag) {
                this.generateCreatureAtHabitat(CreatureType.DesertSpaceSlug, habitat);
                if (flag) {
                    this.generateCreatureAtHabitat(CreatureType.DesertSpaceSlug, habitat);
                    this.generateCreatureAtHabitat(CreatureType.DesertSpaceSlug, habitat);
                }
            }
        } else if (habitat.type === HabitatType.FrozenGasGiant) {
            const num4 = this.creaturePrevalence * 0.15;
            if (this.allowGiantKaltorGeneration && num <= num4) {
                this.generateCreatureAtHabitat(CreatureType.Kaltor, habitat);
            }
        } else if (habitat.category === HabitatCategoryType.GasCloud) {
            const num5 = this.creaturePrevalence * 0.15;
            if (this.allowGiantKaltorGeneration && num <= num5) {
                const num6 = this.rnd.next(3, 10);
                for (let i = 0; i < num6; i++) {
                    this.generateCreatureAtHabitat(CreatureType.Kaltor, habitat);
                }
            }
        } else if (habitat.type === HabitatType.GasGiant) {
            const num7 = this.creaturePrevalence * 0.06;
            if (num <= num7) {
                this.generateCreatureAtHabitat(CreatureType.Ardilus, habitat);
            }
        }
    }

    // Port of Galaxy.6.cs GenerateCreatureAtHabitat(creatureType, habitat)
    // (Galaxy.6.cs:713) — delegates with lockLocation = false. TypeScript
    // has no overloads, so the C# 2-arg and 3-arg overloads collapse into
    // default parameters here (the 5-arg form is the public API).
    generateCreatureAtHabitat(creatureType: CreatureType, habitat: Habitat, lockLocation = false, offsetX = -2000000001, offsetY = -2000000001): Creature | null {
        const habitat2 = this.determineHabitatSystemStar(habitat);
        switch (creatureType) {
            case CreatureType.SilverMist: {
                const creature = new Creature(this, CreatureType.SilverMist, habitat, offsetX, offsetY);
                creature.locationLocked = false;
                this.creatures.push(creature);
                creature.nearestSystemStar = habitat2;
                if (this.systems.length > habitat2.systemIndex) {
                    const system = this.systems[habitat2.systemIndex];
                    if (!system.creatures) {
                        system.creatures = [];
                    }
                    system.creatures.push(creature);
                }
                return creature;
            }
            case CreatureType.Ardilus: {
                const creature = new Creature(this, CreatureType.Ardilus, habitat, offsetX, offsetY);
                creature.locationLocked = lockLocation;
                this.creatures.push(creature);
                creature.nearestSystemStar = habitat2;
                if (this.systems.length > habitat2.systemIndex) {
                    const system = this.systems[habitat2.systemIndex];
                    if (!system.creatures) {
                        system.creatures = [];
                    }
                    system.creatures.push(creature);
                }
                return creature;
            }
            case CreatureType.DesertSpaceSlug: {
                const creature = new Creature(this, CreatureType.DesertSpaceSlug, habitat, offsetX, offsetY);
                creature.locationLocked = lockLocation;
                this.creatures.push(creature);
                creature.nearestSystemStar = habitat2;
                if (this.systems.length > habitat2.systemIndex) {
                    const system = this.systems[habitat2.systemIndex];
                    if (!system.creatures) {
                        system.creatures = [];
                    }
                    system.creatures.push(creature);
                }
                return creature;
            }
            case CreatureType.RockSpaceSlug: {
                const creature = new Creature(this, CreatureType.RockSpaceSlug, habitat, offsetX, offsetY);
                if (this.rnd.next(0, 30) === 1) {
                    creature.size = this.rnd.next(300, 400);
                    creature.maxSize = 450;
                    creature.attackStrength = Math.trunc(creature.size / 30.0);
                    creature.damageKillThreshold = Math.trunc(creature.size * 1.1);
                }
                creature.locationLocked = lockLocation;
                this.creatures.push(creature);
                creature.nearestSystemStar = habitat2;
                if (this.systems.length > habitat2.systemIndex) {
                    const system = this.systems[habitat2.systemIndex];
                    if (!system.creatures) {
                        system.creatures = [];
                    }
                    system.creatures.push(creature);
                }
                return creature;
            }
            case CreatureType.Kaltor: {
                const creature = new Creature(this, CreatureType.Kaltor, habitat, offsetX, offsetY);
                creature.locationLocked = lockLocation;
                this.creatures.push(creature);
                creature.nearestSystemStar = habitat2;
                if (this.systems.length > habitat2.systemIndex) {
                    const system = this.systems[habitat2.systemIndex];
                    if (!system.creatures) {
                        system.creatures = [];
                    }
                    system.creatures.push(creature);
                }
                return creature;
            }
            default:
                return null;
        }
    }

    // Port of Galaxy.5.cs SetupSolarSystem(galaxyShape, sunHabitat, out
    // asteroidField) (lines 1386-1945). colonyPrevalence (this.colonyPrevalence)
    // stands in for Galaxy._ColonyPrevalence.
    //
    // Not ported (out of scope per task 01c): DockingBay/Cargo/Troop/
    // Character/Construction/Manufacturing list setup, DoTasks.
    // SelectPopulation was ported in task 01f2 (see selectPopulation above)
    // and SelectCreatures in task 01f3 (see selectCreatures above). Every
    // call site that would have called one of the skipped functions is noted
    // in the Worker report together with the (data-dependent, non-fixed)
    // number of Rnd calls it would have consumed in the original — the
    // ported Rnd sequence diverges from the original from the first such
    // call site onward.
    setupSolarSystem(galaxyShape: GalaxyShape): { habitats: Habitat[]; asteroidField: Habitat[] | null } {
        let allowCreatures = true; // C#: flag
        const habitatList: Habitat[] = []; // C#: habitatList (planets/moons/asteroids, unordered)
        const habitatList2: Habitat[] = []; // C#: habitatList2 (final ordered return list)
        let asteroidField: Habitat[] | null = null;
        const minValue = 0; // sunHabitat is always null at this call site (see Galaxy.5.cs sunHabitat==null branch).
        const sunHabitat = this.setupSun(galaxyShape);

        let maxValue = 0;
        let planetCount = 0;
        switch (sunHabitat.type) {
            case HabitatType.MainSequence:
            case HabitatType.RedGiant:
            case HabitatType.SuperGiant:
                maxValue = 12;
                if (this.starCount <= 400) {
                    switch (this.rnd.next(minValue, 8)) {
                        case 0:
                            planetCount = 0;
                            break;
                        case 1:
                        case 2:
                            planetCount = this.rnd.next(1, 4);
                            break;
                        case 3:
                        case 4:
                            planetCount = this.rnd.next(2, 7);
                            break;
                        case 5:
                        case 6:
                            planetCount = this.rnd.next(5, 10);
                            break;
                        case 7:
                            planetCount = this.rnd.next(6, 16);
                            break;
                    }
                } else if (this.starCount <= 1000) {
                    switch (this.rnd.next(minValue, 7)) {
                        case 0:
                            planetCount = 0;
                            break;
                        case 1:
                        case 2:
                            planetCount = this.rnd.next(1, 4);
                            break;
                        case 3:
                        case 4:
                            planetCount = this.rnd.next(3, 7);
                            break;
                        case 5:
                            planetCount = this.rnd.next(4, 9);
                            break;
                        case 6:
                            planetCount = this.rnd.next(5, 15);
                            break;
                    }
                } else {
                    switch (this.rnd.next(minValue, 5)) {
                        case 0:
                            planetCount = 0;
                            break;
                        case 1:
                            planetCount = this.rnd.next(1, 3);
                            break;
                        case 2:
                            planetCount = this.rnd.next(2, 5);
                            break;
                        case 3:
                            planetCount = this.rnd.next(3, 7);
                            break;
                        case 4:
                            planetCount = this.rnd.next(4, 11);
                            break;
                    }
                }
                break;
            case HabitatType.WhiteDwarf:
                maxValue = 3;
                switch (this.rnd.next(minValue, 6)) {
                    case 0:
                    case 1:
                    case 2:
                    case 3:
                        planetCount = 0;
                        break;
                    case 4:
                    case 5:
                        planetCount = this.rnd.next(1, 3);
                        break;
                }
                break;
            case HabitatType.Neutron:
                maxValue = 24;
                switch (this.rnd.next(minValue, 6)) {
                    case 0:
                    case 1:
                    case 2:
                    case 3:
                        planetCount = 0;
                        break;
                    case 4:
                    case 5:
                        planetCount = 1;
                        break;
                }
                break;
            case HabitatType.SuperNova:
                maxValue = 2;
                allowCreatures = false;
                planetCount = 0;
                break;
        }

        if (planetCount > 0) {
            let attempts = 0;
            for (;;) {
                if (attempts < 20) {
                    if (this.assignSystemName(sunHabitat, planetCount)) {
                        break;
                    }
                    attempts++;
                    continue;
                }
                sunHabitat.name = this.generateCodeName();
                break;
            }
        }
        this.setScenicFactor(sunHabitat);
        this.setResearchBonus(sunHabitat);
        habitatList2.push(sunHabitat);

        if (planetCount > 0) {
            for (let i = 0; i < planetCount; i++) {
                let habitat: Habitat = sunHabitat;
                const { type, pictureRef, diameter, minOrbitDistance, maxOrbitDistance, landscapePictureRef } = this.selectPlanetType(habitat.type);
                const halfSpacing = Math.trunc(diameter / 4);
                let attempts = 0;
                let orbitDistance = this.rnd.next(minOrbitDistance, maxOrbitDistance);
                let newMin = orbitDistance - (Math.trunc(diameter / 2) + halfSpacing);
                let newMax = orbitDistance + (Math.trunc(diameter / 2) + halfSpacing);
                let overlap = true;
                while (overlap && attempts < 50) {
                    overlap = false;
                    for (const existing of habitatList) {
                        const existingMin = existing.orbitDistance - (Math.trunc(existing.diameter / 2) + halfSpacing);
                        const existingMax = existing.orbitDistance + (Math.trunc(existing.diameter / 2) + halfSpacing);
                        if (this.checkOrbitOverlap(existingMin, existingMax, newMin, newMax)) {
                            orbitDistance = this.rnd.next(minOrbitDistance, maxOrbitDistance);
                            newMin = orbitDistance - (Math.trunc(diameter / 2) + halfSpacing);
                            newMax = orbitDistance + (Math.trunc(diameter / 2) + halfSpacing);
                            overlap = true;
                            break;
                        }
                    }
                    attempts++;
                }
                let planet = new Habitat(
                    HabitatCategoryType.Planet,
                    type,
                    'Planet',
                    habitat,
                    this.rnd.nextDouble() * Math.PI * 2.0,
                    true,
                    orbitDistance,
                    this.rnd.next(2, 5),
                );
                planet.diameter = diameter;
                planet.pictureRef = pictureRef;
                planet.landscapePictureRef = landscapePictureRef;
                planet.baseQuality = this.selectHabitatQuality(planet, this.colonyPrevalence);
                // TODO(port): DoTasks(CurrentDateTime) — Habitat.DoTasks (galaxy-time driven; out of scope).
                this.selectResources(planet);
                this.setScenicFactor(planet);
                this.setResearchBonus(planet);
                this.selectHabitatPictures(planet);
                if (this.rnd.next(0, 5) === 2) {
                    planet.orbitDirection = false;
                }
                if (planet.type === HabitatType.GasGiant && planet.diameter < 760) {
                    planet.hasRings = true;
                }
                let populationRolls = 1;
                if (this.rnd.next(0, 4) === 1) {
                    populationRolls++;
                }
                for (let p = 0; p < populationRolls; p++) {
                    this.selectPopulation(planet, sunHabitat);
                }
                // Galaxy.5.cs 1609-1618: a populated planet gets `ConstructionQueue` (M4h, 1617) and `ManufacturingQueue` (M4g, 1618).
                // TODO(port): the other containers of that block (Cargo, Troops, Characters; no Rnd).
                if (planet.population.items.length > 0) {
                    newHabitatConstructionQueue(this, planet);
                    ensureHabitatManufacturingQueue(this, planet);
                    // Galaxy.5.cs 1619-1644 (M4e): DockingBays (20, or 1 for asteroids / barren rock / other types) + wait queue.
                    createPopulatedHabitatDockingBays(planet);
                } else {
                    // Galaxy.5.cs 1648: SelectCreatures(habitat2) runs only in the
                    // else-branch of `if (habitat2.Population.Count > 0)`.
                    this.selectCreatures(planet);
                }
                habitatList.push(planet);
                habitat = planet;

                let moonCount = 0;
                if (this.starCount <= 400) {
                    if (planet.diameter <= 370) {
                        moonCount = planet.diameter > 260 ? this.rnd.next(0, 3) : planet.diameter > 150 ? this.rnd.next(0, 2) : 0;
                    } else {
                        moonCount = this.rnd.next(0, Math.min(5, Math.trunc(planet.diameter / 165)));
                    }
                } else if (this.starCount <= 1000) {
                    if (planet.diameter <= 370) {
                        moonCount = planet.diameter > 260 ? this.rnd.next(0, 3) : planet.diameter > 165 ? this.rnd.next(0, 2) : 0;
                    } else {
                        moonCount = this.rnd.next(0, Math.min(5, Math.trunc(planet.diameter / 180)));
                    }
                } else if (planet.diameter <= 370) {
                    moonCount = planet.diameter > 260 ? this.rnd.next(0, 3) : planet.diameter > 180 ? this.rnd.next(0, 2) : 0;
                } else {
                    moonCount = this.rnd.next(0, Math.min(5, Math.trunc(planet.diameter / 180)));
                }

                const moonsForThisPlanet: Habitat[] = [];
                for (let l = 0; l < moonCount; l++) {
                    const moonSel = this.selectMoonType(habitat.diameter, habitat.type);
                    let moonDiameter = moonSel.diameter;
                    let moon = new Habitat(
                        HabitatCategoryType.Moon,
                        moonSel.type,
                        this.generateCodeName(),
                        habitat,
                        this.rnd.nextDouble() * Math.PI * 2.0,
                        true,
                        this.rnd.next(5, 32),
                        this.rnd.next(4, 9),
                    );
                    if (moonDiameter < 15) {
                        moonDiameter = 15;
                    }
                    moon.diameter = moonDiameter;
                    moon.pictureRef = moonSel.pictureRef;
                    moon.landscapePictureRef = moonSel.landscapePictureRef;
                    moon.baseQuality = this.selectHabitatQuality(moon, this.colonyPrevalence);

                    const minMoonOrbit = Math.max(150, Math.trunc(habitat.diameter * 0.75));
                    let maxMoonOrbit = Math.trunc(habitat.diameter * 3.3);
                    if (maxMoonOrbit > MAX_MOON_ORBIT_SIZE) {
                        maxMoonOrbit = MAX_MOON_ORBIT_SIZE;
                    }
                    const moonSpacing = 5;
                    let moonAttempts = 0;
                    let moonOrbitDistance = this.rnd.next(minMoonOrbit, maxMoonOrbit);
                    let moonNewMin = moonOrbitDistance - (Math.trunc(moonDiameter / 2) + moonSpacing);
                    let moonNewMax = moonOrbitDistance + (Math.trunc(moonDiameter / 2) + moonSpacing);
                    let moonOverlap = true;
                    while (moonOverlap && moonAttempts < 50) {
                        moonOverlap = false;
                        for (const existingMoon of moonsForThisPlanet) {
                            const existingMin = existingMoon.orbitDistance - (Math.trunc(existingMoon.diameter / 2) + moonSpacing);
                            const existingMax = existingMoon.orbitDistance + (Math.trunc(existingMoon.diameter / 2) + moonSpacing);
                            if (this.checkOrbitOverlap(existingMin, existingMax, moonNewMin, moonNewMax)) {
                                moonOrbitDistance = this.rnd.next(minMoonOrbit, maxMoonOrbit);
                                moonNewMin = moonOrbitDistance - (Math.trunc(moonDiameter / 2) + moonSpacing);
                                moonNewMax = moonOrbitDistance + (Math.trunc(moonDiameter / 2) + moonSpacing);
                                moonOverlap = true;
                                break;
                            }
                        }
                        moonAttempts++;
                    }
                    moonsForThisPlanet.push(moon);
                    moon.orbitDistance = moonOrbitDistance;
                    // TODO(port): DoTasks(CurrentDateTime) — out of scope (galaxy time).
                    this.selectResources(moon);
                    this.setScenicFactor(moon);
                    this.setResearchBonus(moon);
                    this.selectHabitatPictures(moon);
                    if (this.rnd.next(0, 5) === 2) {
                        moon.orbitDirection = false;
                    }
                    let moonPopulationRolls = 1;
                    if (this.rnd.next(0, 4) === 1 && moon.type !== HabitatType.BarrenRock) {
                        moonPopulationRolls++;
                    }
                    for (let p = 0; p < moonPopulationRolls; p++) {
                        this.selectPopulation(moon, sunHabitat);
                    }
                    // Galaxy.5.cs 1745-1756: as for planets above (ConstructionQueue 1755, ManufacturingQueue 1756).
                    if (moon.population.items.length > 0) {
                        newHabitatConstructionQueue(this, moon);
                        ensureHabitatManufacturingQueue(this, moon);
                        // Galaxy.5.cs 1757-1781 (M4e): DockingBays + wait queue, as for planets.
                        createPopulatedHabitatDockingBays(moon);
                    } else {
                        // Galaxy.5.cs 1785: SelectCreatures(habitat2) only when the moon
                        // has no population (else-branch, as for planets).
                        this.selectCreatures(moon);
                    }
                    habitatList.push(moon);
                }
            }

            // Extra un-clustered asteroids directly orbiting the star.
            const extraAsteroidCount = this.rnd.next(0, Math.trunc(planetCount * 4.5));
            for (let i = 0; i < extraAsteroidCount; i++) {
                const name = this.generateCodeName();
                const diameter = this.rnd.next(20, 35);
                const pictureRef = 2000 + this.rnd.next(0, 10);
                const orbitAngle = this.rnd.nextDouble() * Math.PI * 2.0;
                const asteroid = new Habitat(
                    HabitatCategoryType.Asteroid,
                    HabitatType.BarrenRock,
                    name,
                    sunHabitat,
                    orbitAngle,
                    true,
                    this.rnd.next(10500, 11500),
                    this.rnd.next(2, 8),
                );
                asteroid.diameter = diameter;
                asteroid.pictureRef = pictureRef;
                asteroid.landscapePictureRef = -1;
                asteroid.baseQuality = this.selectHabitatQuality(asteroid, this.colonyPrevalence);
                this.selectResources(asteroid);
                this.selectHabitatPictures(asteroid);
                if (this.rnd.next(0, 5) === 2) {
                    asteroid.orbitDirection = false;
                }
                // Port of Galaxy.6.cs SelectCreatures(habitat2) — Galaxy.6.cs:654 (call
                // site for extra un-clustered asteroids).
                this.selectCreatures(asteroid);
                habitatList.push(asteroid);
            }
        }

        // Main asteroid field (Galaxy.5.cs 1813-1909: inlined equivalent of
        // GenerateAsteroidField, kept in-line here to match source exactly;
        // the standalone generateAsteroidFieldAt() helper above ports
        // Galaxy.9.cs GenerateAsteroidField for API completeness but isn't
        // called from here since SetupSolarSystem doesn't call it).
        if (this.rnd.next(0, maxValue) === 1) {
            let fieldCount = 1;
            if (sunHabitat.type === HabitatType.SuperNova && this.rnd.next(0, 2) === 1) {
                fieldCount = 2;
            }
            for (let f = 0; f < fieldCount; f++) {
                const fieldAsteroids: Habitat[] = [];
                const asteroidCount = this.rnd.next(80, 350);
                const baseAngle = this.rnd.nextDouble() * Math.PI * 2.0;
                let baseOrbitDistance = this.rnd.next(9500, 10500);
                let fieldType = HabitatType.BarrenRock;
                switch (this.rnd.next(0, 4)) {
                    case 1:
                        fieldType = HabitatType.Metal;
                        break;
                    case 2:
                        fieldType = HabitatType.Ice;
                        break;
                }
                if (sunHabitat.type === HabitatType.SuperNova) {
                    fieldType = HabitatType.Metal;
                }
                if (fieldType === HabitatType.Ice) {
                    baseOrbitDistance = this.rnd.next(17200, 22200);
                }
                const orbitSpeed = this.rnd.next(1, 4);
                let orbitDirection = true;
                if (this.rnd.next(0, 4) === 2) {
                    orbitDirection = false;
                }
                const arcSpread = Math.max(0.06, 0.13 * (asteroidCount / 350.0));
                const distRange = Math.max(250.0, 500.0 * (asteroidCount / 350.0));
                const negHalf = -0.4;
                const minDist = baseOrbitDistance + negHalf * distRange;
                const maxDist = baseOrbitDistance + 0.4 * distRange;
                let minAngle = baseAngle + negHalf * arcSpread;
                let maxAngle = baseAngle + 0.4 * arcSpread;
                if (minAngle > maxAngle) {
                    const tmp = maxAngle;
                    maxAngle = minAngle;
                    minAngle = tmp;
                }
                for (let a = 0; a < asteroidCount; a++) {
                    let name = this.generateCodeName();
                    name = name + ', Asteroid Field';
                    let diameter = this.rnd.next(10, 25);
                    if (this.rnd.next(0, 30) === 5) {
                        diameter = this.rnd.next(26, 45);
                    }
                    const pictureRef = 2000 + this.rnd.next(0, 10);
                    let dist = baseOrbitDistance + Math.trunc((this.rnd.nextDouble() - 0.5) * this.rnd.nextDouble() * 2.0 * distRange);
                    let angle = baseAngle + (this.rnd.nextDouble() - 0.5) * this.rnd.nextDouble() * 2.0 * arcSpread;
                    if (dist > minDist && dist < maxDist && angle > minAngle && angle < maxAngle) {
                        const distFrac = this.rnd.nextDouble() * 0.8 - 0.4;
                        const angleFrac = this.rnd.nextDouble() * 0.8 - 0.4;
                        dist = baseOrbitDistance + Math.trunc(distFrac * distRange);
                        angle = baseAngle + angleFrac * arcSpread;
                    }
                    const asteroid = new Habitat(HabitatCategoryType.Asteroid, HabitatType.BarrenRock, name, sunHabitat, angle, orbitDirection, dist, orbitSpeed);
                    asteroid.diameter = diameter;
                    asteroid.pictureRef = pictureRef;
                    asteroid.landscapePictureRef = -1;
                    asteroid.baseQuality = this.selectHabitatQuality(asteroid, this.colonyPrevalence);
                    let minimumResourceCount = 0;
                    if (fieldType === HabitatType.Metal && this.rnd.next(0, 3) > 0) {
                        minimumResourceCount = 1;
                    }
                    // C# sets habitat3.Type = fieldType (Galaxy.5.cs:1894)
                    // before SelectResources(habitat3, minimumResourceCount)
                    // (1895).
                    asteroid.type = fieldType;
                    this.selectResources(asteroid, minimumResourceCount);
                    this.selectHabitatPictures(asteroid);
                    if (allowCreatures) {
                        // Port of Galaxy.6.cs SelectCreatures(habitat3) —
                        // Galaxy.6.cs:654 (call site for main asteroid field).
                        this.selectCreatures(asteroid);
                    }
                    let toAdd = asteroid;
                    if (this.rnd.next(0, 1300) === 1) {
                        const treasure = this.generateTreasureAsteroid(sunHabitat, angle, dist, orbitDirection, orbitSpeed, true);
                        if (treasure !== null) {
                            // C# replaces the asteroid with the treasure
                            // habitat (it would add null if
                            // GenerateTreasureAsteroid returned null); we
                            // keep the original asteroid in that case.
                            toAdd = treasure;
                        }
                    }
                    fieldAsteroids.push(toAdd);
                    habitatList.push(toAdd);
                }
                asteroidField = fieldAsteroids;
            }
        }

        // Sort planets/asteroids by orbit distance, assign final names, and
        // build the ordered return list (Galaxy.5.cs 1910-1944).
        const orderable = habitatList.filter((h) => h.category === HabitatCategoryType.Planet || h.category === HabitatCategoryType.Asteroid);
        orderable.sort((a, b) => a.orbitDistance - b.orbitDistance);
        let planetNumber = 1;
        for (const h of orderable) {
            if (h.category === HabitatCategoryType.Planet) {
                h.name = sunHabitat.name + ' ' + planetNumber;
                planetNumber++;
            }
            if (!habitatList2.includes(h)) {
                habitatList2.push(h);
            }
            for (const moon of habitatList) {
                if (moon.parent === h) {
                    moon.name = this.generateMoonName(moon);
                    habitatList2.push(moon);
                }
            }
        }

        return { habitats: habitatList2, asteroidField };
    }

    // Port of the star-cluster setup portion of the Galaxy.4.cs constructor
    // (2221-2276), only used for the Clusters shapes.
    setupStarClusters(shape: GalaxyShape, starCount: number): void {
        if (shape !== GalaxyShape.ClustersEven && shape !== GalaxyShape.ClustersVaried) {
            return;
        }
        const clusterCount = Math.min(20, Math.max(5, Math.trunc(starCount / 55)));
        const minSeparation = this.sizeX / (Math.sqrt(clusterCount) * 3.0);
        let portionTotal = 0.0;
        for (let i = 0; i < clusterCount; i++) {
            let placed = false;
            let attempts = 0;
            while (!placed && attempts < 50) {
                placed = true;
                let portion = 1.0 / clusterCount;
                if (shape === GalaxyShape.ClustersVaried) {
                    const minPortion = portion / 2.0;
                    if (this.rnd.next(0, 2) !== 1) {
                        const factor = 1.0 + this.rnd.nextDouble() * 4.0;
                        portion *= factor;
                        portion = Math.max(portion, minPortion);
                    }
                }
                const x = this.sizeX * 0.1 + this.rnd.nextDouble() * (this.sizeX * 0.8);
                const y = this.sizeY * 0.1 + this.rnd.nextDouble() * (this.sizeY * 0.8);
                for (let j = 0; j < this.starClusterLocations.length; j++) {
                    const loc = this.starClusterLocations[j];
                    const dist = this.calculateDistance(x, y, loc.x, loc.y);
                    const existingRadius = Math.sqrt(this.starClusterPortions[j]) * this.sizeX * 0.4;
                    if (dist < minSeparation + existingRadius) {
                        placed = false;
                        break;
                    }
                }
                if (placed) {
                    portionTotal += portion;
                    this.starClusterPortions.push(portion);
                    this.starClusterLocations.push({ x, y });
                }
                attempts++;
            }
        }
        if (portionTotal > 1.0) {
            for (let i = 0; i < this.starClusterPortions.length; i++) {
                this.starClusterPortions[i] /= portionTotal;
            }
        }
    }

    // ---- Game-start tail (gameStartTail.ts, Start.2.cs 1568-2034) ----
    /** Galaxy.cs 611 AbandonedBuiltObjects (BuiltObjectList). */
    abandonedBuiltObjects: BuiltObject[] = [];
    /** Galaxy.cs 605 AbandonedShipCount. */
    abandonedShipCount = 0;
    /** Galaxy.cs 542 SilverMistCreatureRuinsHabitat. */
    silverMistCreatureRuinsHabitat: Habitat | null = null;
    /** Galaxy.cs 615 / 617 _RuinsGovernmentWayOfAncients / _RuinsGovernmentWayOfDarkness. */
    ruinsGovernmentWayOfAncients = 0;
    ruinsGovernmentWayOfDarkness = 0;
    /** Galaxy.cs 723 GameDisasterEventsEnabled (= VictoryConditions.EnableDisasterEvents, default true; Start.2.cs 503). */
    gameDisasterEventsEnabled = true;
    /** Galaxy.cs 500 DeferEventsForGameStart. */
    deferEventsForGameStart = true;
    /** Start.2.cs 501: StoryReturnOfTheShakturiEnabled = VictoryConditions.EnableStoryEvents. */
    storyReturnOfTheShakturiEnabled = false;
    /** Start.2.cs 502: StoryDistantWorldsEnabled = bool_7. */
    storyDistantWorldsEnabled = false;
    /**
     * Galaxy.cs 816 RaceFamilies (RaceFamilyList, loaded with the game data). createGame must copy
     * GameData.raceFamilies here; read by gameStartTail.ts SelectSpecialRuins(SleepersAwake).
     */
    raceFamilies: RaceFamily[] = [];

    /**
     * Galaxy.9.cs 3477 GenerateAsteroidField(asteroidCount, x, y, nearestSystemStar, orbitDirection,
     * orbitSpeed, orbitDistance, distanceSpreadFactor, arcSpreadFactor, type) → the 3482 overload with
     * randomOrderedResources = null (generateAsteroidFieldAt).
     */
    generateAsteroidField(asteroidCount: number, x: number, y: number, nearestSystemStar: Habitat, orbitDirection: boolean, orbitSpeed: number, orbitDistance: number, distanceSpreadFactor: number, arcSpreadFactor: number, type: HabitatType): Habitat[] {
        return this.generateAsteroidFieldAt(asteroidCount, x, y, nearestSystemStar, orbitDirection, orbitSpeed, orbitDistance, distanceSpreadFactor, arcSpreadFactor, type, null);
    }

    /**
     * Galaxy.9.cs 3543 AddAsteroidField(asteroids, nearestSystemStar): insert the asteroids into
     * Habitats right before the next parentless habitat after the system star (the next system),
     * number them, add them to Systems[star].Habitats and the star's HabitatIndex cell, shift the
     * later HabitatIndex values and every resource map (FixResourceMapsByteSplicing 2881 when
     * Count % 8 == 0, else FixResourceMaps 2994 — both amount to inserting Count unknown bits at the
     * insertion index), then SetSystemHabitatsExploration (3333). No Rnd.
     */
    addAsteroidField(asteroids: Habitat[] | null, nearestSystemStar: Habitat | null): boolean {
        if (nearestSystemStar !== null && asteroids !== null && asteroids.length > 0) {
            let num = this.habitats.length;
            const num2 = this.habitats.indexOf(nearestSystemStar);
            for (let i = num2 + 1; i < this.habitats.length; i++) {
                if (this.habitats[i].parent === null) {
                    num = i;
                    break;
                }
            }
            const galaxyIndex = this.resolveIndex(nearestSystemStar.xpos, nearestSystemStar.ypos);
            for (let j = 0; j < asteroids.length; j++) {
                asteroids[j].habitatIndex = num + j;
                asteroids[j].systemIndex = nearestSystemStar.systemIndex;
            }
            this.habitats.splice(num, 0, ...asteroids);
            const system = this.systems.find((s) => s.systemStar === nearestSystemStar)!; // Systems[nearestSystemStar]
            system.habitats.push(...asteroids);
            if (this.habitatIndexGrid.length > 0) this.habitatIndexGrid[galaxyIndex.x][galaxyIndex.y].push(...asteroids);
            const startIndex = num + asteroids.length;
            const endIndex = this.habitats.length - 1;
            const count = asteroids.length;
            // Both C# branches (byte splicing / per-habitat snapshot) give the same maps.
            this.fixResourceMaps(startIndex, endIndex, count, asteroids);
            for (const asteroid of asteroids) this.setSystemHabitatExploration(asteroid, nearestSystemStar);
            this.stepOrderDirty = true;
            return true;
        }
        return false;
    }

    // ---- M4a fields (tick core: time model, scheduler; src/sim/tick/*) ----
    /** Sim clock: integer game ms since game start (C# CurrentDateTime − _StartDateTime; tick/simTime.ts). */
    nowMs = 0;
    /**
     * Galaxy.cs 67 _LastGalaxyProcessTimeSensitive (ms). MIN_TIME: Start.2.cs 1108 ResetLastTouchTimes sets it to
     * DateTime.MinValue and nothing but DoTasksTimeSensitive (first sim frame) updates it.
     */
    lastGalaxyProcessTimeSensitive = MIN_TIME;
    /**
     * Galaxy.cs 69/71 _LastGalaxyProcessTime / _LastGalaxyHugeProcessTime (ms). 0 = set by the game-start
     * Galaxy.DoTasks at game time 0 (Start.2.cs 1109; createGame's stand-ins run its huge/long blocks).
     * tick/galaxyTick.ts runGameStartGalaxyTick resets them first (ResetLastTouchTimes, Galaxy.cs 3134).
     */
    lastGalaxyProcessTime = 0;
    lastGalaxyHugeProcessTime = 0;
    /** Galaxy.ResetRandom (Galaxy.cs 3075): never true in play; ReseedRandom is dropped in TS (determinism). */
    resetRandom = false;
    /** Galaxy._PirateProximity (0 near / 1 medium / 2 far) — wizard option, read by GenerateNewPirateEmpires. */
    pirateProximity = 0;
    /** Galaxy.MaximumEmpireAmount — wizard option; 0 = derive (player + AIs = empires at game start). */
    maximumEmpireAmount = 0;
    /** Galaxy.SpawnNewEmpires (Start.2.cs 116, wizard option) — gates Habitat CheckHabitatIsEmpire. */
    spawnNewEmpires = true;
    /** Frame-driver state (cursors int_48..int_58, frame carry; tick/scheduler.ts). Created lazily. */
    scheduler: SchedulerState | null = null;
    // ---- M4b fields (missions & command dispatcher) ----
    // ---- M4c fields (movement, hyperjump, fuel, energy) ----
    // ---- M4d fields (orders, contracts, freight) ----
    /** Galaxy.cs 563 Orders (OrderList, indexed: Galaxy.4.cs 2356 EnableIndexing). */
    orders: OrderList = createGalaxyOrderList();
    // ---- M4e fields (docking, refuelling) ----
    // ---- M4f fields (civilian mission AI) ----
    // ---- M4g fields (extraction, industry) ----
    // ---- M4h fields (construction queues, shipyards) ----
    /** Clock-seeded `new Random()` of BaconBuiltObject.DoRepairs (4787): a galaxy-seed-derived stream (plan §0). */
    baconRepairClockRnd: Random | null = null;
    // ---- M4i fields (empire construction, facilities, wonders) ----
    /** Galaxy.cs 822 _WondersBuilt (bool per PlanetaryFacilityDefinitionsStatic id; construction/wonders.ts). */
    wondersBuilt: boolean[] | null = null;
    // ---- M4j fields (colony growth, treasury, government) ----
    /** Galaxy.cs 665 _ColonyFillFactor = 1.0 (ReviewColonyFillFactor). */
    colonyFillFactor = 1.0;
    /**
     * Race.ChangePeriodActive per race (Race.cs 125 _ChangePeriodActive; ReviewRacePeriodicChanges). Kept per galaxy
     * because the TS Race objects are the shared parsed game data (colonyTick.ts raceReproductiveRate & co. read it).
     */
    raceChangePeriodActive = new Set<Race>();
    /**
     * Stand-in for the clock-seeded `new Random()` instances of BaconHabitat.HugeProcessingSpanActions (plan §0: derived
     * from the galaxy seed, never draws Galaxy.Rnd). Created lazily by colonyTick.ts.
     */
    baconHabitatClockRnd: Random | null = null;
    // ---- M4k fields (research progress) ----
    /** Galaxy.cs 116 _ResearchSpeedModifier (Start.2.cs 110 sets 1.0). */
    researchSpeedModifier = 1.0;
    // ---- M4l fields (ship groups) ----
    // ---- M4m fields (military AI) ----
    // ---- M4n fields (threats, attack AI) ----
    /** Galaxy.cs 597 InvasionAttempts (counter, BuiltObject.2.cs 2270). */
    invasionAttempts = 0;
    // ---- M4o fields (weapons, damage, teardown) ----
    /** The clock-seeded `new Random()` of BaconBuiltObject.CollectScrapFromDestroyedBuiltObjects (5183): one stream per galaxy, seeded from the galaxy seed (plan §0). */
    baconCombatClockRnd: Random | null = null;
    /** BaconBuiltObject.cs 78 static `shipsToBeDestroyed` (ship name → saved resource cargo; SaveShipInfoBeforeDestruction / CollectScrap), kept per galaxy. */
    baconShipsToBeDestroyed = new Map<string, Cargo[]>();
    // ---- M4p fields (fighters) ----
    // ---- M4q fields (invasion, troops, boarding) ----
    // ---- M4r fields (diplomacy runtime) ----
    /**
     * Galaxy.cs 1034 AggressionLevel (_AggressionLevel, Galaxy.4.cs 2151 ctor argument; default 1.0). Read by the
     * EmpireEvaluation attitude model. generateGalaxy stores GenerateGalaxyOptions.aggressionLevel here.
     */
    aggressionLevel = 1.0;
    // ---- M4s fields (pirates runtime) ----
    /** Galaxy.cs 593 PirateMissions (EmpireActivityList: missions on offer / being bid on; pirates/missionsMarket.ts). */
    pirateMissions = new EmpireActivityList();
    /**
     * The clock-seeded `new Random()` of BaconEmpire.cs 1122 / 1156 (CheckPiratesBuildConstructionShipsAtIndependentPlanet,
     * CheckPirateReinforcePirateBases) — one stream per galaxy, seeded from the galaxy seed (plan §0; pirates/pirateAI.ts).
     */
    baconPirateClockRnd: Random | null = null;
    // ---- M4t fields (visibility, exploration, territory) ----
    /**
     * Galaxy.cs _RegeneratingEmpireTerritory / _RegenerateEmpireTerritoryAgain (ReviewEmpireTerritoryCore 3384):
     * in C# a ThreadPool guard; the TS runs the review synchronously, so the flag is only ever true during a
     * call (kept for the re-entry path).
     */
    regeneratingEmpireTerritory = false;
    regenerateEmpireTerritoryAgain = false;
    // ---- M4u fields (events, disasters, characters) ----
    /** Galaxy.cs 721 GameRaceSpecificEventsEnabled = true (Start.2.cs 504: VictoryConditions.EnableRaceSpecificEvents). */
    gameRaceSpecificEventsEnabled = true;
    /**
     * Galaxy.StoryShadowsEnabled (VictoryConditions.EnableStoryEventsShadows — the pre-warp "Shadows" story). Story events
     * are deferred (tasks/M4-plan.md §0.3): the M4u branches that read it throw TODO(port) when it is true.
     */
    storyShadowsEnabled = false;
}

// Port of Galaxy.4.cs Galaxy constructor (star-cluster setup, star loop,
// gas-cloud loop, sort/re-index, Systems build — Galaxy.4.cs 2221-2347).
// colonyPrevalence is accepted for API compatibility with the eventual
// full generator but unused here (no colonies are generated in 01b/01c
// scope yet). TODO(port): colony placement — home-system helpers landed
// in 08e1 (setupHomeSystem etc.); GenerateEmpire wiring is task 08e2.
export function generateGalaxy(options: GenerateGalaxyOptions): Galaxy {
    const { seed, shape, starCount, sectorWidth, sectorHeight, systemNames, colonyPrevalence, gameData, cloudImageCount } = options;
    const galaxy = new Galaxy(seed, shape, starCount, sectorWidth, sectorHeight, systemNames, colonyPrevalence);
    // ResourceSystem.Resources (Galaxy.4.cs ctor loads it before generation).
    galaxy.resources = gameData?.resources ?? [];
    galaxy.resourceSystem = buildResourceSystem(galaxy.resources, gameData?.components ?? []);
    galaxy.researchStatic = gameData ? buildResearchStatic(gameData.research, gameData.components, gameData.races, gameData.policies, gameData.piratePolicies, buildComponentStatic(gameData), gameData.facilities, gameData.fighters, gameData.plagues) : null;
    galaxy.designSpecificationTexts = gameData?.designSpecificationTexts ?? new Map();
    galaxy.designNames = gameData?.designNames ?? [];
    // Port of Galaxy.cs Races (loaded from GameData in the ctor).
    galaxy.races = gameData?.races ?? [];
    // Galaxy.4.cs ctor 2133-2134: LoadAgentNames + SetRaceStartupCharacters inputs (characters.ts
    // builds the agent-name lists and Race.AvailableCharacters lazily; no Galaxy.Rnd use).
    galaxy.characterNames = gameData?.characterNames ?? null;
    galaxy.characterFiles = gameData?.characterFiles ?? null;

    // Nebulae / galaxy locations (Galaxy.4.cs ctor: GenerateNebulae + index
    // grid + AddGalaxyLocationIndex), generated before star placement so
    // SetupSun can avoid/enter them.
    galaxy.generateNebulae(cloudImageCount ?? DEFAULT_CLOUD_IMAGE_COUNT);

    // Cluster setup (Galaxy.4.cs 2221-2276), only for the Clusters shapes.
    galaxy.setupStarClusters(shape, starCount);

    // Race regions (Galaxy.4.cs ~2205-2220: SetupAlienRacePopulations is
    // called before the star loop). aggressiveRacesRequired = 3/2/1/0 for
    // AggressionLevel >= 1.5 / >= 1.3 / >= 1.1 / else. With no empireStarts
    // this consumes zero Rnd calls (pre-01f1 behavior).
    const aggressionLevel = options.aggressionLevel ?? 1.0;
    // Galaxy.4.cs 2151 _AggressionLevel = aggressionLevel (task M4t: read by DoSingleEmpireEncounter).
    galaxy.aggressionLevel = aggressionLevel;
    const aggressiveRacesRequired = aggressionLevel >= 1.5 ? 3 : aggressionLevel >= 1.3 ? 2 : aggressionLevel >= 1.1 ? 1 : 0;
    setupAlienRacePopulations(galaxy, options.empireStarts ?? [], aggressiveRacesRequired);

    // Per-star loop (Galaxy.4.cs 2278-2296). Each system's habitat list
    // (star + planets + moons + asteroids, from setupSolarSystem) forms one
    // group; asteroidField is the subset used for the main asteroid belt
    // (not separately tracked at this level — it's a sub-list of habitats).
    const perStarHabitats: Habitat[][] = [];
    for (let i = 0; i < starCount; i++) {
        const { habitats, asteroidField } = galaxy.setupSolarSystem(shape);
        perStarHabitats.push(habitats);
        // Galaxy.4.cs 2284-2287: if (asteroidField != null) _AsteroidFields.Add(asteroidField).
        if (asteroidField !== null) galaxy.asteroidFields.push(asteroidField);
        galaxy.habitats.push(...habitats);
    }

    // Gas-cloud loop (Galaxy.4.cs 2297-2313). SelectCreatures(habitat) is
    // called right after GenerateGasCloud() in the source (Kaltor swarms).
    const gasCloudCount = galaxy.rnd.next(Math.trunc(starCount / 5), Math.trunc(starCount / 2));
    const gasCloudGroups: Habitat[][] = [];
    for (let i = 0; i < gasCloudCount; i++) {
        const cloud = galaxy.generateGasCloud();
        galaxy.selectCreatures(cloud);
        gasCloudGroups.push([cloud]);
        galaxy.habitats.push(cloud);
    }

    // Sort + re-index (Galaxy.4.cs 2314-2334), task C2c-1: list.Sort() orders
    // the per-system HabitatLists by HabitatList.CompareTo = first habitat's
    // Name.CompareTo (culture-sensitive; ICU en-US collation), with .NET's
    // unstable introsort. Habitats and HabitatIndex are rebuilt in that order;
    // every habitat of a group goes into the index cell of the group's first
    // habitat.
    const allGroups = [...perStarHabitats, ...gasCloudGroups];
    netSort(allGroups, (a, b) => compareGroupNames(a, b));
    galaxy.habitats = [];
    galaxy.initIndexGrids();
    for (const group of allGroups) {
        const cell = galaxy.resolveIndex(group[0].xpos, group[0].ypos);
        for (const habitat of group) {
            habitat.habitatIndex = galaxy.habitats.length;
            galaxy.habitats.push(habitat);
            galaxy.habitatIndexGrid[cell.x][cell.y].push(habitat);
        }
    }

    // Build Systems (Galaxy.4.cs 2335-2347): one SystemInfo per group — gas
    // clouds included (their Habitats list is empty). TS convention: the
    // SystemInfo.habitats array holds the star at [0] (systemHabitatsOf()
    // gives the C# list).
    for (const group of allGroups) {
        const star = group[0];
        const systemIndex = galaxy.systems.length;
        for (const habitat of group) {
            habitat.systemIndex = systemIndex;
        }
        galaxy.systems.push({
            systemStar: star,
            habitats: group,
            sector: {
                x: Math.trunc(star.xpos / galaxy.sectorSize),
                y: Math.trunc(star.ypos / galaxy.sectorSize),
            },
        });
    }
    // UpdateSystemInfo(null): SystemsIndex in Systems order.
    // TODO(port): DetermineSystemInfo fields (PlanetCount etc.) — see updateSystemInfo().
    galaxy.updateSystemInfo();
    // Galaxy.4.cs 2349-2355: creatures join their parent habitat's system.
    for (const c of galaxy.creatures) {
        const ph = c.parentHabitat;
        if (ph === null) continue;
        const sys = galaxy.systems[ph.systemIndex];
        if (!sys.creatures) sys.creatures = [];
        if (!sys.creatures.includes(c)) sys.creatures.push(c);
    }

    return galaxy;
}
