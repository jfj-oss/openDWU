// Port of Empire.cs (DistantWorlds.Types) — the Empire constructors and the
// startup helpers they call (Empire.cs 3748–4146, task M2a). Headless sim:
// no DOM/Pixi imports; all randomness goes through galaxy.rnd in the same
// order as the C# Galaxy.Rnd calls.
//
// Fields are declared only for what the constructors assign or read
// (camelCase of the C# names; _Field backing fields → property name).
// Anything the constructors call but that isn't ported yet is a stub method
// marked TODO(port) so the constructor's order of operations stays visible.

import type { Galaxy } from './galaxy';
import { HabitatCategoryType, HabitatType } from './types';
import type { Habitat } from './types';
import type { Race } from './data/races';
import type { Government } from './data/governments';
import { START_STAR_DATE, startStarDateForAge } from './galaxyTime';
import type { BuiltObject } from './builtObject';
import { Cargo, CargoList, ResourceRef, TroopList } from './cargo';
import {
    checkEmpireColorUsed,
    determineSecondaryColor,
    selectColorFromKey,
    selectComplementaryColorKey,
    selectUnusedMainColor,
} from './empireColors';
import { ResearchSystem, ResearchAbilityType } from './researchSystem';
import type { PiratePlayStyle, PirateFactionModifiers } from './pirates';
import { defaultEmpirePolicy, type EmpirePolicy as PolicyData } from './data/policies';
import type { Design } from './design';
import { BuiltObjectRole } from './data/designSpecifications';
import { DesignNameState } from './designNames';
import { loadDesignSpecification as loadDesignSpecificationData, type DesignSpecification } from './data/designSpecifications';
import { EmpireVisibility, SystemVisibilityStatus, type SystemVisibility, type VisibilityOwner, type VisibilityUnit } from './visibility';
import type { ForceStructureProjectionList } from './forceStructureProjection';
import type { HabitatPrioritization } from './resourceTargets';
import { PirateRelationList, PirateRelationType, obtainPirateRelation, changePirateRelation, galaxyCurrentStarDate } from './pirateRelations';
import { recalculateDevelopmentLevelBaseline } from './developmentLevel';
import { recalculateColonyInfluenceRadius } from './territory';
import type { Character } from './characters';
import { DiplomaticRelationList } from './diplomacy';

// Empire.1.cs TakeOwnershipOfColony callees that live in modules importing empire.ts
// (forceStructure.ts RecalculateDistanceFactor / RecalculateAnnualTaxRevenue, taxes.ts
// SetColonyTaxRate). taxes.ts registers them at module load; colony.ts and
// empireGeneration.ts import taxes.ts, so every game path has them.
export interface TakeOwnershipOfColonyHooks {
    recalculateDistanceFactor(galaxy: Galaxy, colony: Habitat): void;
    setColonyTaxRate(galaxy: Galaxy, empire: Empire, colony: Habitat, atWar: boolean): void;
    recalculateAnnualTaxRevenue(galaxy: Galaxy, colony: Habitat): void;
}
let takeOwnershipOfColonyHooks: TakeOwnershipOfColonyHooks | null = null;
export function registerTakeOwnershipOfColonyHooks(hooks: TakeOwnershipOfColonyHooks): void {
    takeOwnershipOfColonyHooks = hooks;
}
function requireTakeOwnershipOfColonyHooks(): TakeOwnershipOfColonyHooks {
    if (takeOwnershipOfColonyHooks === null) throw new Error('takeOwnershipOfColony: import ./taxes first (registers the Empire.1.cs 240/241/269 callees)');
    return takeOwnershipOfColonyHooks;
}

// EmpirePolicy.cs: only the research tech-focus fields are ported (data/policies.ts).
export type EmpirePolicy = PolicyData | null;

// Port of DistantWorlds.Types.AutomationLevel (AutomationLevel.cs).
export enum AutomationLevel {
    Undefined,
    PartiallyAutomated,
    FullyAutomated,
}

// SystemVisibilityStatus lives in visibility.ts (task C1; C# order
// Undefined, Unexplored, Explored, Visible).
export { SystemVisibilityStatus } from './visibility';

// BuiltObjectSubRole (full C# member order) lives in builtObjectTypes.ts.
export { BuiltObjectSubRole } from './builtObjectTypes';
import { BuiltObjectSubRole } from './builtObjectTypes';



// TODO(port): EmpireCounters — EmpireCounters.cs.
// Race.cs DefaultMainColorPirates (line 726): Color.FromArgb(R/2, G/2, B/2)
// using C# integer division.
function halveRgb(color: number): number {
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    return (((r / 2) | 0) << 16) | (((g / 2) | 0) << 8) | ((b / 2) | 0);
}

export class EmpireCounters {
    constructor(_empire: Empire) {}
}

// TODO(port): PirateEconomy — PirateEconomy.cs.
export class PirateEconomy {
    constructor(_startStarDate: number) {}
}

// Port of DesignSpecification.LoadFromFile(galaxy, subRoleName, subRole, isMobile, race,
// isPirate, [standAlone,] raceNameOverride) (DesignSpecification.cs 148/185): a null race
// skips the files and falls back to Galaxy.DesignSpecifications.GetBySubRole
// (standAlone → null).
function loadDesignSpecification(
    galaxy: Galaxy,
    name: string,
    subRole: BuiltObjectSubRole,
    isMobile: boolean,
    dominantRace: Race | null,
    isPirate: boolean,
    raceNameOverride?: string | null,
    standAlone = false,
): DesignSpecification | null {
    return loadDesignSpecificationData(galaxy.designSpecificationTexts, name, subRole, isMobile, dominantRace !== null ? (raceNameOverride ?? '') : null, isPirate, standAlone);
}

// Module-level stand-in for Galaxy.GovernmentsStatic (the parsed government
// definitions, normally loaded with the game data). Tests populate it via
// setGovernmentsStatic(); until then the resolvers see an empty list.
let governmentsStatic: (Government | null)[] = [];
export function setGovernmentsStatic(list: (Government | null)[]): void {
    governmentsStatic = list;
}
/** Galaxy.GovernmentsStatic / Galaxy.Governments (read by gameStartTail.ts SelectSpecialRuins). */
export function getGovernmentsStatic(): readonly (Government | null)[] {
    return governmentsStatic;
}

// Per-galaxy empire-id counter standing in for Galaxy.GetNextEmpireID()
// (Galaxy.cs). The TS Galaxy class has no such member and cannot be edited
// for this task, so the counter lives here keyed by galaxy instance.

// TODO(port): exact value of Empire._LongProcessingInterval — Empire.cs
// (field initializer not in the excerpt); used to back-date the five
// "last touch" timestamps at construction.
const LONG_PROCESSING_INTERVAL_MS = 120_000; // C#: double _LongProcessingInterval = 120.0 (seconds), Empire.cs:184

// TODO(port): Galaxy.ColonyAnnualResourceConsumptionRate /
// ColonyAnnualLuxuryResourceConsumptionRate / MinimumLuxuryResourceReorderAmount
// statics — Galaxy.cs (values not in the excerpt).
// Values from Galaxy.3.cs InitializeStatics 5004-5005, 5026, 5039.
export const COLONY_ANNUAL_RESOURCE_CONSUMPTION_RATE = 1e-8;
export const COLONY_ANNUAL_LUXURY_RESOURCE_CONSUMPTION_RATE = 2e-8;
export const MINIMUM_LUXURY_RESOURCE_REORDER_AMOUNT = 100;
export const COLONY_MAXIMUM_TROOP_STRENGTH = 150000;
export const BUILD_COLONY_SHIP_POPULATION_REQUIREMENT = 500000000; // Galaxy.3.cs:5001

export class Empire {
    galaxy!: Galaxy;
    active = true;
    empireId = 0;
    counters = new EmpireCounters(this);
    pirateEconomy = new PirateEconomy(START_STAR_DATE);
    // Task C1/C2a: SystemVisibility + ResourceMap + SystemsVisible +
    // EmpiresSharedVisibility + KnownGalaxyLocations (visibility.ts).
    visibility!: EmpireVisibility;
    get resourceMap() {
        return this.visibility.resourceMap;
    }
    name = '';
    capital: Habitat | null = null;
    homeWorld: Habitat | null = null;
    dominantRace: Race | null = null;
    corruptionMultiplier = 0;
    // Colony approval / tax model (taxes.ts): C# double Corruption (Empire.cs 70,
    // written by RecalculateEmpireCorruption), long _TotalPopulation (509, written by
    // RecalculateEmpirePopulation) and double _EconomyEfficiency = 1.0 (501).
    corruption = 0;
    totalPopulation = 0;
    economyEfficiency = 1.0;
    lastDisasterDate = START_STAR_DATE;
    policy: EmpirePolicy = defaultEmpirePolicy();
    reclusive = false;
    allowableGovernmentTypes: number[] = [];
    governmentId = -1;
    designNamesIndex = 0;
    builtObjects: BuiltObject[] = [];
    shipGroups: unknown[] = [];
    designs: Design[] = [];
    latestDesigns: (Design | null)[] = [];
    /** Empire design-name prefixes / model numbers / _DesignNamesUsage (designNames.ts). */
    designNameState = new DesignNameState();
    foreignDesigns: unknown[] = [];
    characters: unknown[] = [];
    troops = new TroopList();
    intelligenceMissions: unknown[] = [];
    outlaws: unknown[] = [];
    // Empire.cs 870 DiplomaticRelations / 78 _ProposedDiplomaticRelations (diplomacy.ts); both
    // ctors (Empire.cs 3810-3812 / 4187-4189) recreate them with InvertEmpireIndexing = true
    // on the proposed list.
    diplomaticRelations = new DiplomaticRelationList();
    proposedDiplomaticRelations = ((): DiplomaticRelationList => {
        const list = new DiplomaticRelationList();
        list.invertEmpireIndexing = true;
        return list;
    })();
    colonies: Habitat[] = [];
    // Pirate-faction state (Galaxy.8.cs GeneratePirateEmpire; task C2d).
    piratePlayStyle: PiratePlayStyle = 0 as PiratePlayStyle;
    pirateEmpireBaseHabitat: Habitat | null = null;
    pirateEmpireSuperPirates = false;
    pirateFactionModifiers: PirateFactionModifiers | null = null;
    knownPirateEmpires: Empire[] = [];
    // Empire.cs 493: public PirateRelationList PirateRelations (pirateRelations.ts).
    pirateRelations = new PirateRelationList();
    colonizationTargets: { habitat: Habitat; priority: number }[] = [];
    // Galaxy.SetEmpireDifficultyFactors (pirates.ts setEmpireDifficultyFactors).
    difficultyLevel = 1.0;
    // Empire._BaseMaximumConstructionSize / _CanBuildCarriers / _CanBuildResupplyShips /
    // _ComponentsAvailable (indexed by BuiltObjectSubRole).
    baseMaximumConstructionSize = 0;
    canBuildCarriers = false;
    canBuildResupplyShips = false;
    componentsAvailable: boolean[] = new Array<boolean>(30).fill(false);
    difficultyLevelModifier = 0.0;
    difficultyFactors: Record<string, number> | null = null;
    constructionYards: unknown[] = [];
    distressSignals: unknown[] = [];
    manufacturers: unknown[] = [];
    privateBuiltObjects: BuiltObject[] = [];
    refuellingDepots: unknown[] = [];
    resourceExtractors: unknown[] = [];
    spacePorts: BuiltObject[] = [];
    miningStations: BuiltObject[] = [];
    freighters: unknown[] = [];
    constructionShips: unknown[] = [];
    longRangeScanners: unknown[] = [];
    researchFacilities: unknown[] = [];
    resortBases: unknown[] = [];
    resupplyShips: unknown[] = [];
    planetDestroyers: unknown[] = [];
    messages: unknown[] = [];
    empireEvaluations: unknown[] = [];
    get systemVisibility(): SystemVisibility[] {
        return this.visibility.systemVisibility;
    }
    controlColonization: AutomationLevel = AutomationLevel.Undefined;
    controlColonyDevelopment = false;
    controlColonyStockLevels = false;
    controlColonyTaxRates = false;
    controlDesigns = false;
    controlDiplomacyGifts: AutomationLevel = AutomationLevel.Undefined;
    controlDiplomacyOffense: AutomationLevel = AutomationLevel.Undefined;
    controlDiplomacyTreaties: AutomationLevel = AutomationLevel.Undefined;
    controlMilitaryAttacks: AutomationLevel = AutomationLevel.Undefined;
    controlMilitaryFleets = false;
    controlStateConstruction: AutomationLevel = AutomationLevel.Undefined;
    controlTroopGeneration = false;
    controlAgentAssignment: AutomationLevel = AutomationLevel.Undefined;
    controlResearch = false;
    controlColonyFacilities: AutomationLevel = AutomationLevel.Undefined;
    controlPopulationPolicy = false;
    controlCharacterLocations = false;
    controlOfferPirateMissions: AutomationLevel = AutomationLevel.Undefined;
    mainColor = 0;
    secondaryColor = 0;
    flagShape = -1;
    smallFlagPicture = 0;
    largeFlagPicture = 0;
    troopDescription = '';
    troopPictureRef = 0;
    stateMoney = 0.0;
    // Port of Empire.3.cs CheckEmpireHasHyperDriveTech (Research.GetLatestComponent(HyperDrive)).
    get hasHyperDriveTech(): boolean {
        return this.research.hasHyperDrive();
    }
    // Empire.CanColonize* (ReviewColonizationTypes).
    canColonizeContinental = false;
    canColonizeMarshySwamp = false;
    canColonizeOcean = false;
    canColonizeDesert = false;
    canColonizeIce = false;
    canColonizeVolcanic = false;
    // Task C2b: fields GenerateEmpire sets.
    designPictureFamilyIndex = 0;
    preWarpProgressEventsOccurred = false;
    initiateConstruction = true;
    expansion = 0;
    playerEmpire = false;
    privateMoney = 0.0;
    research = new ResearchSystem(null);
    lastLeaderChangeDate = START_STAR_DATE;
    // C# _DesignSpecifications may hold null (GetBySubRole miss); CreateNewDesigns would then throw.
    designSpecifications: (DesignSpecification | null)[] = [];
    planetDestroyerDesignSpecification: DesignSpecification | null = null;

    // Port of Empire.cs ctor Empire(Galaxy, string, Habitat, Race, int, double, EmpirePolicy)
    // (delegates to the 8-arg ctor with isPlayerEmpire: false).
    constructor(
        galaxy: Galaxy,
        name: string,
        capital: Habitat | null,
        dominantRace: Race | null,
        governmentId: number,
        corruptionMultiplier: number,
        policy: EmpirePolicy,
        isPlayerEmpire?: boolean,
    );
    // Port of Empire.cs ctor Empire(Galaxy, string, bool, Habitat, Race, EmpirePolicy)
    // (independent-empire constructor).
    // TODO(port): independent-empire ctor body — Empire.cs:4146+ (body not in
    // the M2a excerpt); neutral delegation to the primary ctor keeps the
    // signature wired up.
    constructor(
        galaxy: Galaxy,
        name: string,
        isIndependentEmpire: boolean,
        homeHabitat: Habitat | null,
        dominantRace: Race | null,
        policy: EmpirePolicy,
    );
    constructor(
        galaxy: Galaxy,
        name: string,
        arg3: Habitat | null | boolean,
        arg4: Habitat | Race | null | number,
        arg5: Race | null | number,
        arg6: EmpirePolicy | number,
        arg7?: EmpirePolicy,
        arg8?: boolean,
    ) {
        if (typeof arg3 === 'boolean') {
            this.initializeIndependentCtor(galaxy, name, arg3, arg4 as Habitat | null, arg5 as Race | null, arg6 as EmpirePolicy);
        } else {
            this.initialize(galaxy, name, arg3, arg4 as Race | null, arg5 as number, arg6 as number, arg7 ?? null, arg8 ?? false);
        }
    }

    // Port of Empire.cs ctor Empire(galaxy, name, isIndependentEmpire,
    // homeHabitat, dominantRace, policy) (4146), in C# order. Rnd: one draw in
    // SelectEmpireColors (colours then overridden with grey for the
    // independent empire); FastFindNearestUnexploredSystem (homeHabitat path)
    // and the Age > 0 contact loop are TODO(port) — game setup passes a null
    // homeHabitat and no empires exist yet when it runs.
    private initializeIndependentCtor(galaxy: Galaxy, name: string, isIndependentEmpire: boolean, homeHabitat: Habitat | null, dominantRace: Race | null, policy: EmpirePolicy): void {
        this.galaxy = galaxy;
        this.active = true;
        this.empireId = isIndependentEmpire ? 0 : galaxy.getNextEmpireID();
        this.counters = new EmpireCounters(this);
        this.pirateEconomy = new PirateEconomy(START_STAR_DATE);
        this.visibility = new EmpireVisibility(galaxy, this.visibilityOwner(isIndependentEmpire));
        this.name = name === '' ? 'Independent' : name;
        this.dominantRace = dominantRace;
        this.lastDisasterDate = START_STAR_DATE;
        if (policy !== null && !isIndependentEmpire) this.policy = policy;
        this.allowableGovernmentTypes = Empire.resolveDefaultAllowableGovernmentTypes(dominantRace, true);
        this.troops = new TroopList();
        this.selectEmpireColors(false, (main, secondary) => {
            this.mainColor = main;
            this.secondaryColor = secondary;
        });
        if (isIndependentEmpire) {
            this.mainColor = 0x606060;
            this.secondaryColor = 0x606060;
        }
        if (homeHabitat !== null) {
            this.resourceMap.setResourcesKnown(galaxy.systems[homeHabitat.systemIndex].systemStar, true);
            // (C# loops `k > Habitats.Count` here, so the home system's habitats are never marked.)
            const num = Math.trunc(2.0 * Math.sqrt(galaxy.starCount));
            for (let l = 0; l < num; l++) {
                const habitat = galaxy.fastFindNearestUnexploredSystem(homeHabitat.xpos, homeHabitat.ypos, this);
                if (habitat !== null) {
                    this.visibility.systemVisibility[habitat.systemIndex].status = SystemVisibilityStatus.Explored;
                    this.resourceMap.setResourcesKnown(galaxy.systems[habitat.systemIndex].systemStar, true);
                    for (const h of galaxy.systemHabitatsOf(habitat.systemIndex)) this.resourceMap.setResourcesKnown(h, true);
                }
            }
        } else {
            for (const h of galaxy.habitats) this.resourceMap.setResourcesKnown(h, true);
            for (const v of this.visibility.systemVisibility) v.status = SystemVisibilityStatus.Visible;
        }
        if (galaxy.age > 0) {
            // Empire.cs 4275: meet empires whose explored space overlaps (one Rnd.Next(0,3) per
            // mutually explored system until the first hit).
            for (const empire of galaxy.empires) {
                if (!empire.active || empire === this) continue;
                for (const systemInfo of galaxy.systems) {
                    const idx = systemInfo.systemStar.systemIndex;
                    const status = empire.visibility.systemVisibility[idx].status;
                    const status2 = this.visibility.systemVisibility[idx].status;
                    const seen = (st: SystemVisibilityStatus) => st === SystemVisibilityStatus.Explored || st === SystemVisibilityStatus.Visible;
                    let flag = false;
                    if (seen(status2) && status === SystemVisibilityStatus.Visible) flag = true;
                    if (seen(status) && seen(status2) && galaxy.rnd.next(0, 3) === 1) flag = true;
                    if (!flag) continue;
                    const pirateRelation = obtainPirateRelation(this, empire);
                    if (pirateRelation.type === PirateRelationType.NotMet) {
                        changePirateRelation(this, empire, PirateRelationType.None, galaxyCurrentStarDate(galaxy));
                        if (this.pirateEmpireBaseHabitat !== null && !empire.knownPirateEmpires.includes(this)) empire.knownPirateEmpires.push(this);
                        if (empire.pirateEmpireBaseHabitat !== null && !this.knownPirateEmpires.includes(empire)) this.knownPirateEmpires.push(empire);
                    }
                    break;
                }
            }
        }
        this.stateMoney = 30000.0;
        this.privateMoney = 100000.0;
        this.research = new ResearchSystem(galaxy.researchStatic);
        this.research.obtainTechTree();
        // Empire.cs 4329: SetTechTreeStartingDefaults(TechTree, dominantRace, policy).
        this.research.setTechTreeStartingDefaults(dominantRace, policy);
        this.research.update();
        this.reviewResearchAbilities();
        this.reviewDesignsBuiltObjectsImprovedComponents();
        this.reviewColonizationTypes();
        this.reviewPopulationGrowthRates();
        this.reviewMaximumConstructionSize(() => {});
        this.reviewCanBuildShipTypes();
        this.reviewTroopTypes();
    }

    // Body of the 8-arg Empire constructor (Empire.cs 3754–4146), ported in
    // the exact order of operations.
    private initialize(
        galaxy: Galaxy,
        name: string,
        capital: Habitat | null,
        dominantRace: Race | null,
        governmentId: number,
        corruptionMultiplier: number,
        policy: EmpirePolicy,
        isPlayerEmpire: boolean,
    ): void {
        this.galaxy = galaxy;
        this.active = true;
        this.empireId = galaxy.getNextEmpireID();
        this.counters = new EmpireCounters(this);
        // TODO(port): Galaxy.CurrentStarDate — Galaxy.cs (no time on the TS
        // Galaxy yet); stand in with the start star date.
        this.pirateEconomy = new PirateEconomy(START_STAR_DATE);
        // ResourceMap.InitializeFlags(Habitats.Count) + one Unexplored
        // SystemVisibility per system (Empire.cs 3760, 3831-3840).
        this.visibility = new EmpireVisibility(galaxy, this.visibilityOwner());
        this.name = name;
        this.capital = capital;
        this.homeWorld = this.capital;
        this.dominantRace = dominantRace;
        this.corruptionMultiplier = corruptionMultiplier;
        // TODO(port): Galaxy.ColonyNames/ColonyNameIndex — Galaxy.cs (not
        // ported); player-empire capital rename branch is a guarded no-op.
        // Empire.cs: player capital takes the next colony name.
        if (isPlayerEmpire && capital !== null && galaxy.colonyNames !== null && galaxy.colonyNames.length > galaxy.colonyNameIndex) {
            capital.name = galaxy.colonyNames[galaxy.colonyNameIndex];
            galaxy.colonyNameIndex++;
        }
        this.lastDisasterDate = START_STAR_DATE;
        if (this.dominantRace !== null) {
            // TODO(port): Policy.ResearchDesign* fields — Policy.cs (policy
            // data model not ported); values are carried on the race itself.
            if (!this.dominantRace.expanding) {
                this.reclusive = true;
            }
        }
        if (policy !== null) {
            this.policy = policy;
        }
        this.allowableGovernmentTypes = Empire.resolveDefaultAllowableGovernmentTypes(this.dominantRace, true);
        this.changeGovernment(governmentId);
        this.designNamesIndex = this.dominantRace?.designNamesIndex ?? 0;
        if (name === '') {
            this.name = this.generateEmpireName(governmentId);
        }
        this.builtObjects = [];
        this.shipGroups = [];
        this.designs = [];
        this.latestDesigns = [];
        for (let i = 0; i < Object.values(BuiltObjectSubRole).length / 2; i++) {
            // C#: Array values = Enum.GetValues(typeof(BuiltObjectSubRole));
            // LatestDesigns.Add(null) per value. TS numeric enums have a
            // reverse mapping, hence /2.
            this.latestDesigns.push(null);
        }
        this.foreignDesigns = [];
        this.characters = [];
        this.troops = new TroopList();
        this.intelligenceMissions = [];
        this.outlaws = [];
        this.diplomaticRelations = new DiplomaticRelationList();
        this.proposedDiplomaticRelations = new DiplomaticRelationList();
        this.proposedDiplomaticRelations.invertEmpireIndexing = true;
        this.colonies = [];
        this.constructionYards = [];
        this.distressSignals = [];
        this.manufacturers = [];
        this.privateBuiltObjects = [];
        this.refuellingDepots = [];
        this.resourceExtractors = [];
        this.spacePorts = [];
        this.miningStations = [];
        this.freighters = [];
        this.constructionShips = [];
        this.longRangeScanners = [];
        this.researchFacilities = [];
        this.resortBases = [];
        this.resupplyShips = [];
        this.planetDestroyers = [];
        this.messages = [];
        this.empireEvaluations = [];
        // (SystemVisibility list already built by EmpireVisibility above.)
        this.controlColonization = AutomationLevel.FullyAutomated;
        this.controlColonyDevelopment = true;
        this.controlColonyStockLevels = true;
        this.controlColonyTaxRates = true;
        this.controlDesigns = true;
        this.controlDiplomacyGifts = AutomationLevel.FullyAutomated;
        this.controlDiplomacyOffense = AutomationLevel.FullyAutomated;
        this.controlDiplomacyTreaties = AutomationLevel.FullyAutomated;
        this.controlMilitaryAttacks = AutomationLevel.FullyAutomated;
        this.controlMilitaryFleets = true;
        this.controlStateConstruction = AutomationLevel.FullyAutomated;
        this.controlTroopGeneration = true;
        this.controlAgentAssignment = AutomationLevel.FullyAutomated;
        this.controlResearch = true;
        this.controlColonyFacilities = AutomationLevel.FullyAutomated;
        this.controlPopulationPolicy = true;
        this.controlCharacterLocations = true;
        this.controlOfferPirateMissions = AutomationLevel.FullyAutomated;
        this.selectEmpireColors(false, (main, secondary) => {
            this.mainColor = main;
            this.secondaryColor = secondary;
        });
        // TODO(port): Galaxy.GenerateEmpireFlag + Galaxy.FlagShapes —
        // Galaxy.cs (flag generation not ported); shape passes through.
        this.flagShape = this.dominantRace !== null ? this.dominantRace.defaultFlagDesign : -1;
        // C# finds the capital's parent star by scanning the
        // Galaxy.HabitatIndex grid; the TS Galaxy has no such grid, so scan
        // the habitat list directly (equivalent result: the capital's
        // top-level star).
        let habitat: Habitat | null = null;
        if (this.capital !== null) {
            if (
                this.capital.category === HabitatCategoryType.Asteroid ||
                this.capital.category === HabitatCategoryType.Planet
            ) {
                habitat = this.capital.parent;
            } else if (this.capital.category === HabitatCategoryType.Moon) {
                habitat = this.capital.parent?.parent ?? null;
            }
        }
        for (let n = 0; n < galaxy.habitats.length; n++) {
            const habitat2 = galaxy.habitats[n];
            let known = false;
            if (habitat2.category === HabitatCategoryType.Star) {
                known = true;
            }
            if (
                habitat !== null &&
                (habitat2.parent === habitat || (habitat2.parent !== null && habitat2.parent.parent === habitat))
            ) {
                known = true;
                this.systemVisibility[habitat2.systemIndex].status = SystemVisibilityStatus.Visible;
            }
            this.resourceMap.setResourcesKnown(habitat2, known);
        }
        if (this.capital !== null) {
            if (this.capital.troops === null) {
                this.capital.troops = new TroopList();
            }
            this.troopDescription = this.dominantRace?.troopName ?? '';
            this.troopPictureRef = this.dominantRace?.pictureIndex ?? 0;
            this.capital.setDevelopmentLevel(10);
        }
        // C#: five Last*Touch dates = CurrentDateTime minus
        // (_LongProcessingInterval + 1) seconds. No time on the TS Galaxy;
        // keep the ordering visible with the stand-in start date.
        // TODO(port): Galaxy.CurrentDateTime — Galaxy.cs.
        const lastLongTouch = START_STAR_DATE - (LONG_PROCESSING_INTERVAL_MS + 1000);
        void lastLongTouch;
        if (capital !== null) {
            // Re-title cargo owned by the independent empire to this empire
            // (Cargo.Cargo(commodity, amount, empire, reserved)).
            // TODO(port): full Cargo semantics (component vs resource
            // commodities, Reserved) — Cargo.cs.
            if (capital.cargo !== null) {
                const cargoList: import('./cargo').Cargo[] = [];
                for (const item2 of capital.cargo.items) {
                    // C#: item2.EmpireId == _Galaxy.IndependentEmpire.EmpireId.
                    // The TS Galaxy has no IndependentEmpire yet; treat all
                    // existing cargo as independent-owned (it was created
                    // during generation before any empire existed).
                    cargoList.push(item2);
                }
                for (const item3 of cargoList) {
                    capital.cargo.remove(item3);
                    const cargo = new Cargo(item3.commodity, item3.amount, this, item3.reserved);
                    capital.cargo.add(cargo);
                }
            }
            this.setStartupColonyResourceCargo(capital);
        }
        this.stateMoney = 30000.0;
        this.privateMoney = 100000.0;
        this.research = new ResearchSystem(galaxy.researchStatic);
        // Empire.cs 3961-3962: ObtainTechTree(race) + SetTechTreeStartingDefaults(race, policy).
        this.research.obtainTechTree();
        this.research.setTechTreeStartingDefaults(dominantRace, policy);
        this.research.update();
        this.reviewResearchAbilities();
        this.reviewDesignsBuiltObjectsImprovedComponents();
        this.reviewColonizationTypes();
        this.reviewPopulationGrowthRates();
        let newSize = 0;
        this.reviewMaximumConstructionSize((size) => {
            newSize = size;
        });
        void newSize;
        this.reviewCanBuildShipTypes();
        this.reviewTroopTypes();
        this.lastLeaderChangeDate = START_STAR_DATE;
    }

    // Port of Empire.cs SetStartupColonyResourceCargo (Empire.cs ~3960).
    setStartupColonyResourceCargo(colony: Habitat): number {
        let val = 1 + Math.trunc(colony.population.totalAmount / 250000000);
        val = Math.min(10, val);
        let num = COLONY_ANNUAL_RESOURCE_CONSUMPTION_RATE * (colony.population.totalAmount / 15.0);
        if (num < 1.0) {
            num = 1.0;
        } else if (num > 5.0) {
            num = 5.0;
        }
        let cargo: import('./cargo').Cargo | null = null;
        if (colony.cargo === null) {
            colony.cargo = new CargoList();
        }
        const rs = this.galaxy.resourceSystem;
        for (const resourceDefinition of rs.strategicResourcesOrderedByRelativeImportance) {
            if (resourceDefinition.colonyManufacturingLevel <= 0) {
                const imp = rs.relativeImportance.get(resourceDefinition.resourceId) ?? 0;
                cargo = new Cargo(new ResourceRef(resourceDefinition.resourceId), Math.trunc(Math.fround(imp * 6000) * num), this);
                colony.cargo!.add(cargo);
            }
        }
        for (let j = 0; j < 4; j++) {
            const index = this.galaxy.rnd.next(0, rs.luxuryResources.length);
            const resourceDefinition2 = rs.luxuryResources[index];
            if (resourceDefinition2 !== undefined && resourceDefinition2.superLuxuryBonusAmount <= 0 && resourceDefinition2.colonyManufacturingLevel <= 0) {
                cargo = new Cargo(new ResourceRef(resourceDefinition2.resourceId), 600, this);
                colony.cargo!.add(cargo);
            }
        }
        const num2 = Math.max(500000000, colony.population.totalAmount);
        let num3 = Math.trunc(COLONY_ANNUAL_LUXURY_RESOURCE_CONSUMPTION_RATE * num2 * 5.0);
        num3 = Math.max(num3 * 3, MINIMUM_LUXURY_RESOURCE_REORDER_AMOUNT);
        num3 = Math.max(400, num3);
        num3 = Math.trunc(num3 * 1.5);
        for (let k = 0; k < val; k++) {
            let resource = this.selectRandomLuxuryResource();
            let num4 = colony.cargo!.indexOf(resource, this);
            let num5 = 0;
            while (num4 >= 0 && num5 < 10) {
                resource = this.selectRandomLuxuryResource();
                num4 = colony.cargo!.indexOf(resource, this);
                num5++;
            }
            if (num4 >= 0) {
                resource = this.selectRandomLuxuryResource();
            }
            cargo = new Cargo(new ResourceRef(resource.resourceId), num3, this);
            colony.cargo!.add(cargo);
        }
        return val;
    }

    // Port of Galaxy.3.cs SelectRandomLuxuryResource (line 429): up to 50
    // tries for a luxury that isn't restricted (super-luxury) or manufactured.
    private selectRandomLuxuryResource(): ResourceRef {
        const lux = this.galaxy.resourceSystem.luxuryResources;
        let resource = new ResourceRef(0);
        let flag = false;
        let iterationCount = 0;
        while (iterationCount < 50 && !flag) {
            iterationCount++;
            const def = lux[this.galaxy.rnd.next(0, lux.length)];
            resource = new ResourceRef(def.resourceId);
            flag = !(def.superLuxuryBonusAmount > 0 || def.colonyManufacturingLevel > 0);
        }
        return resource;
    }

    // Hooks visibility.ts needs from the empire (task C1 VisibilityOwner).
    visibilityOwner(isIndependent = false): VisibilityOwner {
        return {
            isIndependent,
            active: true,
            controlsHabitat: (h: Habitat) => h.owner === this,
            // TODO(port): BuiltObjects / PrivateBuiltObjects (no ships yet).
            hasUnitInSystem: (_star: Habitat, _exclude: VisibilityUnit | null) => false,
            longRangeScanners: () => [],
            hasShipOutsideSystemWithScanRange: () => false,
        };
    }

    // Port of Empire.9.cs ResolveSystemVisibility(x, y, null, null).
    resolveSystemVisibility(x: number, y: number): void {
        this.visibility.resolveSystemVisibilityAt(x, y);
    }

    // Port of Empire.1.cs TakeOwnershipOfColony(colony, newEmpire) (line 54 →
    // 64 with destroyBases/destroyTroops false). Ported: the container
    // initialisation, owner change, colony-list moves, capital fallback,
    // refuelling flag and system visibility. No Rnd calls in the C#.
    // TODO(port): events, ConstructionQueue/ManufacturingQueue/docking bays,
    // fleet home bases, troop/character re-assignment details, orders,
    // blockades/attacks cancellation, tax rate, population policy, bases and
    // mining stations, empire defeat/teardown — Empire.1.cs 64-370.
    takeOwnershipOfColony(colony: Habitat, newEmpire: Empire | null): void {
        const empire = colony.empire;
        let flag = false;
        if (empire !== null) {
            if (empire.capital === colony) flag = true;
            const i = empire.colonies.indexOf(colony);
            if (i >= 0) empire.colonies.splice(i, 1);
        }
        if (colony.cargo === null) colony.cargo = new CargoList();
        if (colony.troops === null) colony.troops = new TroopList();
        if (colony.troopsToRecruit === null) colony.troopsToRecruit = new TroopList();
        if (colony.invadingTroops === null) colony.invadingTroops = new TroopList();
        if (colony.facilities === null) colony.facilities = [];
        colony.owner = newEmpire;
        colony.empire = newEmpire;
        if (empire !== null && flag) {
            // TODO(port): SelectBestCandidateForCapital — Empire.cs.
            empire.capital = empire.colonies[0] ?? null;
        }
        if (newEmpire !== null) {
            colony.isRefuellingDepot = true;
            if (newEmpire.capital === null) newEmpire.capital = colony;
            if (!newEmpire.colonies.includes(colony)) newEmpire.colonies.push(colony);
            // Empire.1.cs 240: colony.RecalculateDistanceFactor().
            requireTakeOwnershipOfColonyHooks().recalculateDistanceFactor(this.galaxy, colony);
            // Empire.1.cs 241: newEmpire.SetColonyTaxRate(colony, atWar: false).
            requireTakeOwnershipOfColonyHooks().setColonyTaxRate(this.galaxy, newEmpire, colony, false);
            // Empire.1.cs 242-246.
            if (newEmpire.policy != null) {
                colony.colonyPopulationPolicy = newEmpire.policy.newColonyPopulationPolicyAllRaces;
                colony.colonyPopulationPolicyRaceFamily = newEmpire.policy.newColonyPopulationPolicyYourRaceFamily;
            }
        } else {
            colony.isRefuellingDepot = false;
            // TODO(port): Empire.1.cs 250-266 order removal (Galaxy.Orders) — no orders at game start.
        }
        // Empire.1.cs 268: colony.RecalculateDevelopmentLevelBaseline().
        recalculateDevelopmentLevelBaseline(colony);
        // Empire.1.cs 269: colony.RecalculateAnnualTaxRevenue().
        requireTakeOwnershipOfColonyHooks().recalculateAnnualTaxRevenue(this.galaxy, colony);
        // Empire.1.cs 270-271: RecalculateColonyInfluenceRadius(CheckEmpireHasHyperDriveTech(this)).
        recalculateColonyInfluenceRadius(this.galaxy, colony, this.hasHyperDriveTech);
        // TODO(port): Empire.1.cs 272+ mining-station teardown, bases, troops, events.
        this.resolveSystemVisibility(colony.xpos, colony.ypos);
    }

    // Port of Empire.cs ResolveRaceSpecificGovernmentTypes (static).
    static resolveRaceSpecificGovernmentTypes(dominantRace: Race | null): number[] {
        const list: number[] = [];
        if (dominantRace !== null && dominantRace.specialGovernment >= 0) {
            list.push(dominantRace.specialGovernment);
        }
        return list;
    }

    // Port of Empire.cs ResolveDefaultAllowableGovernmentTypes (static,
    // forceIncludeSpecialTypesIfRaceAllows: false overload).
    static resolveDefaultAllowableGovernmentTypes(dominantRace: Race | null): number[];
    // Port of Empire.cs ResolveDefaultAllowableGovernmentTypes(Race, bool).
    static resolveDefaultAllowableGovernmentTypes(dominantRace: Race | null, forceIncludeSpecialTypesIfRaceAllows: boolean): number[];
    static resolveDefaultAllowableGovernmentTypes(dominantRace: Race | null, forceIncludeSpecialTypesIfRaceAllows = false): number[] {
        const list: number[] = [];
        for (let i = 0; i < governmentsStatic.length; i++) {
            const governmentAttributes = governmentsStatic[i];
            if (governmentAttributes === null) {
                continue;
            }
            let flag = true;
            if (dominantRace !== null && dominantRace.disallowedGovernments.includes(governmentAttributes.governmentId)) {
                flag = false;
            }
            if (!flag) {
                continue;
            }
            switch (governmentAttributes.availability) {
                case 0:
                    list.push(governmentAttributes.governmentId);
                    break;
                case 1:
                    if (dominantRace !== null && dominantRace.specialGovernment === governmentAttributes.governmentId) {
                        list.push(governmentAttributes.governmentId);
                    }
                    break;
                case 2:
                    if (dominantRace !== null && (forceIncludeSpecialTypesIfRaceAllows || dominantRace.name === 'Mechanoid') && dominantRace.specialGovernment === governmentAttributes.governmentId) {
                        list.push(governmentAttributes.governmentId);
                    } else if (dominantRace !== null && dominantRace.specialGovernment === governmentAttributes.governmentId) {
                        list.push(governmentAttributes.governmentId);
                    }
                    break;
                case 3:
                    if (dominantRace !== null && (forceIncludeSpecialTypesIfRaceAllows || dominantRace.name === 'Shakturi') && dominantRace.specialGovernment === governmentAttributes.governmentId) {
                        list.push(governmentAttributes.governmentId);
                    } else if (dominantRace !== null && dominantRace.specialGovernment === governmentAttributes.governmentId) {
                        list.push(governmentAttributes.governmentId);
                    }
                    break;
            }
        }
        return list;
    }

    // Port of Empire.cs GenerateDesignSpecifications (call list preserved;
    // each LoadFromFile is a stub — see DesignSpecification above).
    generateDesignSpecifications(galaxy: Galaxy, dominantRace: Race | null, isPirate: boolean, raceNameOverride?: string | null): void {
        this.designSpecifications = [];
        this.planetDestroyerDesignSpecification = null;
        // TODO(port): PlanetDestroyer spec load from
        // galaxy.ApplicationStartupPath/CustomizationSetPath (standAlone) —
        // DesignSpecification.cs / Galaxy.cs path fields.
        if (!isPirate) {
            this.planetDestroyerDesignSpecification = loadDesignSpecification(galaxy, 'PlanetDestroyer', BuiltObjectSubRole.CapitalShip, true, dominantRace, isPirate, raceNameOverride, true);
        }
        this.designSpecifications.push(loadDesignSpecification(galaxy, 'CapitalShip', BuiltObjectSubRole.CapitalShip, true, dominantRace, isPirate, raceNameOverride));
        this.designSpecifications.push(loadDesignSpecification(galaxy, 'Carrier', BuiltObjectSubRole.Carrier, true, dominantRace, isPirate, raceNameOverride));
        this.designSpecifications.push(loadDesignSpecification(galaxy, 'ColonyShip', BuiltObjectSubRole.ColonyShip, true, dominantRace, isPirate, raceNameOverride));
        this.designSpecifications.push(loadDesignSpecification(galaxy, 'ConstructionShip', BuiltObjectSubRole.ConstructionShip, true, dominantRace, isPirate, raceNameOverride));
        this.designSpecifications.push(loadDesignSpecification(galaxy, 'Cruiser', BuiltObjectSubRole.Cruiser, true, dominantRace, isPirate, raceNameOverride));
        this.designSpecifications.push(loadDesignSpecification(galaxy, 'DefensiveBase', BuiltObjectSubRole.DefensiveBase, false, dominantRace, isPirate, raceNameOverride));
        this.designSpecifications.push(loadDesignSpecification(galaxy, 'Destroyer', BuiltObjectSubRole.Destroyer, true, dominantRace, isPirate, raceNameOverride));
        this.designSpecifications.push(loadDesignSpecification(galaxy, 'EnergyResearchStation', BuiltObjectSubRole.EnergyResearchStation, false, dominantRace, isPirate, raceNameOverride));
        this.designSpecifications.push(loadDesignSpecification(galaxy, 'Escort', BuiltObjectSubRole.Escort, true, dominantRace, isPirate, raceNameOverride));
        this.designSpecifications.push(loadDesignSpecification(galaxy, 'ExplorationShip', BuiltObjectSubRole.ExplorationShip, true, dominantRace, isPirate, raceNameOverride));
        this.designSpecifications.push(loadDesignSpecification(galaxy, 'Frigate', BuiltObjectSubRole.Frigate, true, dominantRace, isPirate, raceNameOverride));
        this.designSpecifications.push(loadDesignSpecification(galaxy, 'GasMiningShip', BuiltObjectSubRole.GasMiningShip, true, dominantRace, isPirate, raceNameOverride));
        this.designSpecifications.push(loadDesignSpecification(galaxy, 'GasMiningStation', BuiltObjectSubRole.GasMiningStation, false, dominantRace, isPirate, raceNameOverride));
        this.designSpecifications.push(loadDesignSpecification(galaxy, 'HighTechResearchStation', BuiltObjectSubRole.HighTechResearchStation, false, dominantRace, isPirate, raceNameOverride));
        this.designSpecifications.push(loadDesignSpecification(galaxy, 'LargeFreighter', BuiltObjectSubRole.LargeFreighter, true, dominantRace, isPirate, raceNameOverride));
        this.designSpecifications.push(loadDesignSpecification(galaxy, 'LargeSpacePort', BuiltObjectSubRole.LargeSpacePort, false, dominantRace, isPirate, raceNameOverride));
        this.designSpecifications.push(loadDesignSpecification(galaxy, 'MediumFreighter', BuiltObjectSubRole.MediumFreighter, true, dominantRace, isPirate, raceNameOverride));
        this.designSpecifications.push(loadDesignSpecification(galaxy, 'MediumSpacePort', BuiltObjectSubRole.MediumSpacePort, false, dominantRace, isPirate, raceNameOverride));
        this.designSpecifications.push(loadDesignSpecification(galaxy, 'MiningShip', BuiltObjectSubRole.MiningShip, true, dominantRace, isPirate, raceNameOverride));
        this.designSpecifications.push(loadDesignSpecification(galaxy, 'MiningStation', BuiltObjectSubRole.MiningStation, false, dominantRace, isPirate, raceNameOverride));
        this.designSpecifications.push(loadDesignSpecification(galaxy, 'MonitoringStation', BuiltObjectSubRole.MonitoringStation, false, dominantRace, isPirate, raceNameOverride));
        this.designSpecifications.push(loadDesignSpecification(galaxy, 'PassengerShip', BuiltObjectSubRole.PassengerShip, true, dominantRace, isPirate, raceNameOverride));
        this.designSpecifications.push(loadDesignSpecification(galaxy, 'ResortBase', BuiltObjectSubRole.ResortBase, false, dominantRace, isPirate, raceNameOverride));
        this.designSpecifications.push(loadDesignSpecification(galaxy, 'ResupplyShip', BuiltObjectSubRole.ResupplyShip, true, dominantRace, isPirate, raceNameOverride));
        this.designSpecifications.push(loadDesignSpecification(galaxy, 'SmallFreighter', BuiltObjectSubRole.SmallFreighter, true, dominantRace, isPirate, raceNameOverride));
        this.designSpecifications.push(loadDesignSpecification(galaxy, 'SmallSpacePort', BuiltObjectSubRole.SmallSpacePort, false, dominantRace, isPirate, raceNameOverride));
        this.designSpecifications.push(loadDesignSpecification(galaxy, 'TroopTransport', BuiltObjectSubRole.TroopTransport, true, dominantRace, isPirate, raceNameOverride));
        this.designSpecifications.push(loadDesignSpecification(galaxy, 'WeaponsResearchStation', BuiltObjectSubRole.WeaponsResearchStation, false, dominantRace, isPirate, raceNameOverride));
    }

    // TODO(port): ChangeGovernment — Empire.cs (sets government + effects);
    // store the id so callers/tests can observe it.
    changeGovernment(governmentId: number): void {
        this.governmentId = governmentId;
    }

    // Port of Empire.cs GenerateEmpireName(governmentId) (line 4482). Note the
    // C# quirk: the adjective (text2) is not reset between retries.
    generateEmpireName(governmentId: number): string {
        const rnd = this.galaxy.rnd;
        let text = '';
        const government = governmentId >= 0 && governmentId < governmentsStatic.length ? governmentsStatic[governmentId] : null;
        let text2 = '';
        let flag = true;
        let num = 0;
        while (flag && num < 50) {
            text = '';
            let empty: string;
            const roll = rnd.next(0, 2) === 1;
            if ((roll && this.dominantRace!.name.toLowerCase() !== 'human') || this.capital === null) {
                empty = this.dominantRace!.name;
            } else {
                empty = this.galaxy.determineHabitatSystemStar(this.capital).name;
            }
            let list: string[] = government?.empireNameAdjectives ?? [];
            let list2: string[] = government?.empireNameNouns ?? [];
            if (list.length === 0) list = ['United', 'Combined', 'Imperial', 'Great', 'Grand'];
            if (list2.length === 0) {
                list2 = ['Empire', 'Alliance', 'Group', 'Dominion', 'Territory', 'Nation', 'Realm', 'Federation', 'Authority', 'Enclave', 'Confederacy', 'Coalition', 'Domain'];
            }
            const empty2 = list2[rnd.next(0, list2.length)];
            const text3 = `${empty} ${empty2}`;
            if (rnd.next(0, 4) === 1 && text3.length < 18 && list.length > 0) {
                text2 = list[rnd.next(0, list.length)];
            }
            if (text2 !== '') text = `${text}${text2} `;
            text = `${text}${empty} `;
            text += empty2;
            flag = this.galaxy.empires.some((e) => e.name === text);
            num++;
        }
        return text;
    }

    // Port of Empire.cs SelectEmpireColors (line 4385).
    selectEmpireColors(isPirateFaction: boolean, setColors: (main: number, secondary: number) => void): void {
        let flag = false;
        let mainColor = 0;
        let secondaryColor = 0;
        let iterationCount = 0;
        while (iterationCount < 200 && !flag) {
            iterationCount++;
            const race = this.dominantRace;
            // DominantRace.DefaultMainColorPirates = half the RGB channels of
            // DefaultMainColor (Race.cs 726).
            const color =
                race !== null
                    ? isPirateFaction
                        ? halveRgb(selectColorFromKey(race.defaultPrimaryColor))
                        : selectColorFromKey(race.defaultPrimaryColor)
                    : 0;
            if (race !== null && !checkEmpireColorUsed(this.galaxy, isPirateFaction, color)) {
                mainColor = color;
                secondaryColor = selectColorFromKey(race.defaultSecondaryColor);
            } else {
                const u = selectUnusedMainColor(this.galaxy, isPirateFaction);
                mainColor = u.color;
                if (u.unusedColorKey < 0) {
                    secondaryColor = isPirateFaction ? 0xfefefe : selectColorFromKey(this.galaxy.rnd.next(0, 23));
                } else {
                    secondaryColor = selectColorFromKey(selectComplementaryColorKey(u.unusedColorKey));
                }
            }
            if (isPirateFaction) {
                secondaryColor = determineSecondaryColor(mainColor);
            }
            flag = true;
            for (const e of isPirateFaction ? this.galaxy.pirateEmpires : this.galaxy.empires) {
                if ((e.mainColor === mainColor && e.secondaryColor === secondaryColor) || mainColor === secondaryColor) {
                    flag = false;
                    break;
                }
            }
            if (mainColor === secondaryColor) flag = false;
        }
        setColors(mainColor, secondaryColor);
    }

    // Port of Empire.3.cs ReviewResearchAbilities (2059).
    // TODO(port): ReviewPopulationGrowthRates / MaximumConstructionSize / CanBuildShipTypes / TroopTypes bodies.
    reviewResearchAbilities(): void {
        this.reviewColonizationTypes();
        this.reviewPopulationGrowthRates();
        this.reviewMaximumConstructionSize(() => {});
        this.reviewCanBuildShipTypes();
        this.reviewTroopTypes();
    }

    // TODO(port): ReviewDesignsBuiltObjectsImprovedComponents — Empire.cs.
    reviewDesignsBuiltObjectsImprovedComponents(): void {}

    // TODO(port): ReviewColonizationTypes — Empire.cs.
    // Port of Empire.3.cs ReviewColonizationTypes (2184).
    reviewColonizationTypes(): void {
        const flags = [false, false, false, false, false, false, false];
        for (const a of this.research.abilities) {
            if (a.type === ResearchAbilityType.ColonizeHabitatType && a.value >= 1 && a.value <= 6) flags[a.value] = true;
        }
        [, this.canColonizeContinental, this.canColonizeMarshySwamp, this.canColonizeOcean, this.canColonizeDesert, this.canColonizeIce, this.canColonizeVolcanic] = flags;
    }

    // Port of Empire.7.cs ColonizableHabitatTypesForEmpire (1595).
    // BuildColonyShipPopulationRequirement: Galaxy.3.cs static.
    colonizableHabitatTypesForEmpire(): HabitatType[] {
        const list: HabitatType[] = [];
        if (this.canColonizeContinental) list.push(HabitatType.Continental);
        if (this.canColonizeMarshySwamp) list.push(HabitatType.MarshySwamp);
        if (this.canColonizeOcean) list.push(HabitatType.Ocean);
        if (this.canColonizeDesert) list.push(HabitatType.Desert);
        if (this.canColonizeIce) list.push(HabitatType.Ice);
        if (this.canColonizeVolcanic) list.push(HabitatType.Volcanic);
        for (const c of this.colonies) {
            if (c.population.totalAmount >= BUILD_COLONY_SHIP_POPULATION_REQUIREMENT) {
                const r = c.population.dominantRace;
                if (r !== null && !list.includes(r.nativeHabitatType)) list.push(r.nativeHabitatType);
            }
        }
        return list;
    }

    // Port of Empire.7.cs CanDesignColonizeHabitat(design, habitat) (1509).
    canDesignColonizeHabitat(design: Design | null, habitat: Habitat): boolean {
        if (design !== null && design.role !== BuiltObjectRole.Colony) return false;
        if (habitat.category !== HabitatCategoryType.Planet && habitat.category !== HabitatCategoryType.Moon) return false;
        if (habitat.population.totalAmount > 0 && (habitat.empire === null || habitat.empire === this.galaxy.independentEmpire)) return true;
        const designOwner = design !== null && design.empire !== null ? this.galaxy.empires.find((e) => e.empireId === design.empire!.empireId) ?? null : null;
        const empire = designOwner ?? this;
        switch (habitat.type) {
            case HabitatType.Continental:
                return empire.canColonizeContinental;
            case HabitatType.MarshySwamp:
                return empire.canColonizeMarshySwamp;
            case HabitatType.Desert:
                return empire.canColonizeDesert;
            case HabitatType.Ocean:
                return empire.canColonizeOcean;
            case HabitatType.Ice:
                return empire.canColonizeIce;
            case HabitatType.Volcanic:
                return empire.canColonizeVolcanic;
            default:
                return false;
        }
    }

    // Port of Empire.4.cs DetermineColonizeLowQualityHabitat(habitat) (4254).
    // TODO(port): habitat.Ruin (Ruin.cs) is not modeled — at game start no
    // ruins have been placed/discovered for the search to see, so the Ruin
    // bonus branch is always false here, matching the value C# would read.
    determineColonizeLowQualityHabitat(habitat: Habitat): boolean {
        if (habitat.quality >= 0.5) return true;
        if (habitat.resources.length > 0 && habitat.resources.some((r) => (this.galaxy.resourceSystem.byId.get(r.resourceId)?.superLuxuryBonusAmount ?? 0) > 0)) {
            return true;
        }
        return false;
    }

    // TODO(port): ReviewPopulationGrowthRates — Empire.cs.
    reviewPopulationGrowthRates(): void {}

    // Port of Empire.10.cs MaximumConstructionSize(shipSubRole) (630).
    maximumConstructionSize(shipSubRole: BuiltObjectSubRole = BuiltObjectSubRole.Undefined): number {
        const race = this.dominantRace;
        if (race !== null) {
            const S = BuiltObjectSubRole;
            const romulan = this.name.includes('Romulan'); // BaconRace.*ShipSizeMultiplier = 3.0
            switch (shipSubRole) {
                case S.SmallFreighter:
                case S.MediumFreighter:
                case S.LargeFreighter:
                case S.PassengerShip:
                case S.GasMiningShip:
                case S.MiningShip:
                    return Math.trunc(this.baseMaximumConstructionSize * raceShipSizeFactor(race, 'ShipSizeFactorCivilian') * (romulan ? 3.0 : 1.0));
                case S.Escort:
                case S.Frigate:
                case S.Destroyer:
                case S.Cruiser:
                case S.CapitalShip:
                case S.TroopTransport:
                case S.ResupplyShip:
                case S.ExplorationShip:
                    return Math.trunc(this.baseMaximumConstructionSize * raceShipSizeFactor(race, 'ShipSizeFactorMilitary') * (romulan ? 3.0 : 1.0));
                case S.Carrier:
                    return Math.trunc(this.baseMaximumConstructionSize * 1.5 * raceShipSizeFactor(race, 'ShipSizeFactorMilitary') * (romulan ? 3.0 : 1.0));
                default:
                    return this.baseMaximumConstructionSize;
            }
        }
        return this.baseMaximumConstructionSize;
    }

    // Port of Empire.10.cs MaximumConstructionSizeBase(baseSubRole) (666).
    maximumConstructionSizeBase(baseSubRole: BuiltObjectSubRole = BuiltObjectSubRole.Undefined): number {
        const num = this.baseMaximumConstructionSize * 3;
        if (baseSubRole === BuiltObjectSubRole.ResupplyShip && this.dominantRace !== null) {
            return Math.trunc(num * raceShipSizeFactor(this.dominantRace, 'ShipSizeFactorMilitary'));
        }
        return num;
    }

    // Port of Empire.3.cs ReviewMaximumConstructionSize(out int newSize) (2276):
    // 160, or the Value of the highest-Level ConstructionSize ability.
    reviewMaximumConstructionSize(setSize: (size: number) => void): void {
        let newSize = -1;
        this.baseMaximumConstructionSize = 160;
        let best: { level: number; value: number } | null = null;
        for (const a of this.research.abilities) {
            if (a.type === ResearchAbilityType.ConstructionSize && (best === null || a.level > best.level)) best = a;
        }
        if (best !== null) {
            this.baseMaximumConstructionSize = best.value;
            newSize = this.baseMaximumConstructionSize;
        }
        setSize(newSize);
    }

    // Port of Empire.3.cs ReviewCanBuildShipTypes (2468). research.txt EnableShipSubRole
    // related object: 0 = Carrier, 1 = ResupplyShip (ResearchNodeDefinitionList.cs 575).
    reviewCanBuildShipTypes(): void {
        let carriers = false;
        let resupply = false;
        for (const a of this.research.abilities) {
            if (a.type !== ResearchAbilityType.EnableShipSubRole) continue;
            if (a.relatedObjectIndex === 0) carriers = true;
            else if (a.relatedObjectIndex === 1) resupply = true;
        }
        this.canBuildCarriers = carriers;
        this.canBuildResupplyShips = resupply;
    }

    // Empire.cs 736-765 (troop abilities, set by ReviewTroopTypes; floats default 1f).
    troopCanRecruitInfantry = false;
    troopCanRecruitArmored = false;
    troopCanRecruitArtillery = false;
    troopCanRecruitSpecialForces = false;
    troopAttackStrengthBonusFactorInfantry = 1;
    troopAttackStrengthBonusFactorArmored = 1;
    troopAttackStrengthBonusFactorArtillery = 1;
    troopAttackStrengthBonusFactorSpecialForces = 1;
    troopDefendStrengthBonusFactorInfantry = 1;
    troopDefendStrengthBonusFactorArmored = 1;
    troopDefendStrengthBonusFactorSpecialForces = 1;
    troopPlanetaryDefenseInterceptBonusFactor = 1;
    troopMaintenanceFactor = 1;
    boardingAttackFactor = 1;
    boardingDefenseFactor = 1;
    /** Empire.cs:529 private int _TroopCount (GenerateTroopDescription). */
    troopCount = 0;

    // Port of Empire.3.cs ReviewTroopTypes (2299-2466). Research ability RelatedObject for
    // Troop abilities: research.txt index 0-4 → TroopType Undefined..SpecialForces
    // (ResearchNodeDefinitionList.cs 581-596); any other index leaves it null (skipped).
    // No Rnd.
    reviewTroopTypes(): void {
        let troopCanRecruitInfantry = false;
        let troopCanRecruitArmored = false;
        let troopCanRecruitArtillery = false;
        let troopCanRecruitSpecialForces = false;
        let num = 1;
        let num2 = 1;
        let num3 = 1;
        let num4 = 1;
        let num5 = 1;
        let num6 = 1;
        let num7 = 1;
        let num8 = 1;
        let num9 = 1;
        let num10 = 1;
        let num11 = 1;
        const f = Math.fround;
        // 1f + Math.Abs((float)Value / 100f) / Math.Abs((float)Value / 100f).
        const plus = (v: number) => f(1 + f(Math.abs(f(f(v) / 100))));
        const abs = (v: number) => f(Math.abs(f(f(v) / 100)));
        const abilities = this.research?.abilities ?? null;
        if (abilities !== null && abilities.length > 0) {
            for (let i = 0; i < abilities.length; i++) {
                const researchAbility = abilities[i];
                if (researchAbility.type === ResearchAbilityType.Boarding) {
                    if (researchAbility.value > 0) {
                        const num12 = plus(researchAbility.value);
                        if (num12 > num10) num10 = num12;
                    } else if (researchAbility.value < 0) {
                        const num13 = plus(researchAbility.value);
                        if (num13 > num11) num11 = num13;
                    }
                } else {
                    if (researchAbility.type !== ResearchAbilityType.Troop) continue;
                    const rel = researchAbility.relatedObjectIndex;
                    if (rel >= 0 && rel <= 4) {
                        switch (rel) {
                            case 0: // TroopType.Undefined
                                if (researchAbility.value < 0) {
                                    const num16 = abs(researchAbility.value);
                                    const num17 = f(1 - num16);
                                    if (num17 < num9) num9 = num17;
                                }
                                break;
                            case 1: // Infantry
                                troopCanRecruitInfantry = true;
                                if (researchAbility.value > 0) {
                                    const num18 = plus(researchAbility.value);
                                    if (num18 > num) num = num18;
                                } else if (researchAbility.value < 0) {
                                    const num19 = plus(researchAbility.value);
                                    if (num19 > num2) num2 = num19;
                                }
                                break;
                            case 2: // Armored
                                troopCanRecruitArmored = true;
                                if (researchAbility.value > 0) {
                                    const num22 = plus(researchAbility.value);
                                    if (num22 > num3) num3 = num22;
                                } else if (researchAbility.value < 0) {
                                    const num23 = plus(researchAbility.value);
                                    if (num23 > num4) num4 = num23;
                                }
                                break;
                            case 3: // Artillery
                                troopCanRecruitArtillery = true;
                                if (researchAbility.value > 0) {
                                    const num20 = plus(researchAbility.value);
                                    if (num20 > num6) num6 = num20;
                                } else if (researchAbility.value < 0) {
                                    const num21 = plus(researchAbility.value);
                                    if (num21 > num5) num5 = num21;
                                }
                                break;
                            case 4: // SpecialForces
                                troopCanRecruitSpecialForces = true;
                                if (researchAbility.value > 0) {
                                    const num14 = plus(researchAbility.value);
                                    if (num14 > num7) num7 = num14;
                                } else if (researchAbility.value < 0) {
                                    const num15 = plus(researchAbility.value);
                                    if (num15 > num8) num8 = num15;
                                }
                                break;
                        }
                    } else if (researchAbility.value < 0) {
                        // RelatedObject null / not a TroopType (Empire.3.cs 2438).
                        const num24 = abs(researchAbility.value);
                        const num25 = f(1 - num24);
                        if (num25 < num9) num9 = num25;
                    }
                }
            }
        }
        this.troopCanRecruitInfantry = troopCanRecruitInfantry;
        this.troopCanRecruitArmored = troopCanRecruitArmored;
        this.troopCanRecruitArtillery = troopCanRecruitArtillery;
        this.troopCanRecruitSpecialForces = troopCanRecruitSpecialForces;
        this.troopAttackStrengthBonusFactorInfantry = num;
        this.troopAttackStrengthBonusFactorArmored = num3;
        this.troopAttackStrengthBonusFactorArtillery = num6;
        this.troopAttackStrengthBonusFactorSpecialForces = num7;
        this.troopDefendStrengthBonusFactorInfantry = num2;
        this.troopDefendStrengthBonusFactorArmored = num4;
        this.troopDefendStrengthBonusFactorSpecialForces = num8;
        this.troopPlanetaryDefenseInterceptBonusFactor = num5;
        // BaconEmpire.MultiplyTroopMaintenance: 0.05f for "Romulan" empires, else 1f.
        this.troopMaintenanceFactor = f(num9 * (this.name.includes('Romulan') ? f(0.05) : 1));
        this.boardingAttackFactor = num10;
        this.boardingDefenseFactor = num11;
    }

    // Port of Empire.4.cs GenerateTroopDescription() (4036) / GenerateTroopDescription(label)
    // (4041) + Galaxy.5.cs OrderedNumberDescription (3304). No Rnd.
    generateTroopDescription(troopLabel: string = this.troopDescription): string {
        this.troopCount++;
        const number = this.troopCount;
        let text = String(number);
        switch (text.substring(text.length - 1)) {
            case '0':
            case '4':
            case '5':
            case '6':
            case '7':
            case '8':
            case '9':
                text += 'th';
                break;
            case '1':
                text = number % 100 !== 11 ? text + 'st' : text + 'th';
                break;
            case '2':
                text = number % 100 !== 12 ? text + 'nd' : text + 'th';
                break;
            case '3':
                text = number % 100 !== 13 ? text + 'rd' : text + 'th';
                break;
        }
        return text + ' ' + troopLabel;
    }

    // Port of Empire.9.cs SelectRandomColony (2364). Rnd: Next(0, Colonies.Count).
    selectRandomColony(): Habitat {
        const index = this.galaxy.rnd.next(0, this.colonies.length);
        return this.colonies[index];
    }

    // Port of Empire.7.cs AddBuiltObjectToGalaxy(builtObject, parent, offsetLocationFromParent,
    // isStateOwned, offsetX, offsetY, sendMessage) (1326-1431) and its shorter overloads
    // (1311-1324: offsetX = offsetY = -2000000001, sendMessage = true).
    // Rnd: only with offsetLocationFromParent and a Habitat parent — NextDouble for the
    // radius, and (when no explicit offset is given) NextDouble for the angle.
    addBuiltObjectToGalaxy(builtObject: BuiltObject, parent: Habitat | BuiltObject | null, offsetLocationFromParent: boolean, isStateOwned: boolean, offsetX = -2000000001, offsetY = -2000000001, sendMessage = true): void {
        builtObject.builtObjectID = this.galaxy.getNextBuiltObjectID();
        // TODO(port): Galaxy.CurrentStarDate — no galaxy clock on the TS Galaxy yet; at game
        // start it is the start star date (Start.2.cs startStarDate for Galaxy._Age).
        builtObject.dateBuilt = startStarDateForAge(this.galaxy.age);
        builtObject.dateRetrofit = startStarDateForAge(this.galaxy.age);
        let arg = '';
        if (parent !== null) {
            let num = 0.0;
            if (!isBuiltObject(parent)) {
                num = !offsetLocationFromParent ? 0.0 : parent.diameter / 2.0 - this.galaxy.rnd.nextDouble() * parent.diameter;
                builtObject.parentHabitat = parent;
                builtObject.xpos = builtObject.parentHabitat.xpos;
                builtObject.ypos = builtObject.parentHabitat.ypos;
                arg = builtObject.parentHabitat.name;
                if (builtObject.role === BuiltObjectRole.Base) {
                    parent.basesAtHabitat.push(builtObject);
                }
            } else {
                num = 0.0;
                builtObject.parentBuiltObject = parent;
                builtObject.xpos = builtObject.parentBuiltObject.xpos;
                builtObject.ypos = builtObject.parentBuiltObject.ypos;
                arg = builtObject.parentBuiltObject.name;
            }
            if (offsetX > -2000000001 && offsetY > -2000000001) {
                builtObject.parentOffsetX = offsetX;
                builtObject.parentOffsetY = offsetY;
            } else {
                builtObject.parentOffsetX = 0.0;
                builtObject.parentOffsetY = 0.0;
                if (offsetLocationFromParent) {
                    const num2 = this.galaxy.rnd.nextDouble() * Math.PI * 2.0;
                    const parentOffsetX = Math.cos(num2) * num;
                    const parentOffsetY = Math.sin(num2) * num;
                    builtObject.parentOffsetX = parentOffsetX;
                    builtObject.parentOffsetY = parentOffsetY;
                }
            }
            builtObject.xpos += builtObject.parentOffsetX;
            builtObject.ypos += builtObject.parentOffsetY;
        }
        // TextResolver "Ship Purchased NAME LOCATION" / "Base Purchased NAME LOCATION"
        // (GameText.txt 1493/1494).
        const empty = builtObject.role !== BuiltObjectRole.Base ? `The ship '${builtObject.name}' has been purchased at ${arg}` : `The base '${builtObject.name}' has been purchased at ${arg}`;
        const galaxyIndex = this.galaxy.resolveIndex(builtObject.xpos, builtObject.ypos);
        const x = galaxyIndex.x;
        const y = galaxyIndex.y;
        if (this.pirateEmpireBaseHabitat !== null) {
            builtObject.pirateEmpireId = this.empireId & 0xff;
        }
        if (isStateOwned) {
            this.builtObjects.push(builtObject);
            builtObject.owner = this;
        } else {
            this.privateBuiltObjects.push(builtObject);
        }
        this.galaxy.builtObjects.push(builtObject);
        this.galaxy.builtObjectIndexGrid[x][y].push(builtObject);
        const boEmpire = builtObject.empire as Empire;
        if ((builtObject.subRole === BuiltObjectSubRole.SmallSpacePort || builtObject.subRole === BuiltObjectSubRole.MediumSpacePort || builtObject.subRole === BuiltObjectSubRole.LargeSpacePort) && builtObject.isSpacePort && !boEmpire.spacePorts.includes(builtObject)) {
            boEmpire.spacePorts.push(builtObject);
        }
        if ((builtObject.subRole === BuiltObjectSubRole.GasMiningStation || builtObject.subRole === BuiltObjectSubRole.MiningStation) && builtObject.isResourceExtractor && !boEmpire.miningStations.includes(builtObject)) {
            boEmpire.miningStations.push(builtObject);
        }
        if (builtObject.nearestSystemStar === null) {
            const habitat = this.galaxy.fastFindNearestSystem(builtObject.xpos, builtObject.ypos);
            if (habitat !== null) {
                const num3 = this.galaxy.calculateDistance(builtObject.xpos, builtObject.ypos, habitat.xpos, habitat.ypos);
                if (Math.trunc(num3) <= this.galaxy.maxSolarSystemSize + 500) {
                    builtObject.nearestSystemStar = habitat;
                }
            }
        }
        boEmpire.resolveSystemVisibility(builtObject.xpos, builtObject.ypos);
        builtObject.reDefine();
        if (builtObject.troopCapacity > 0 && this.policy !== null) {
            builtObject.setTroopLoadoutsFromPolicy(this.policy);
        }
        if (sendMessage) {
            // TODO(port): builtObject.Empire.SendMessageToEmpire(builtObject.Empire,
            // EmpireMessageType.ShipBasePurchased, builtObject, empty) — EmpireMessage model not
            // ported (adds to Empire.Messages / MessageRecipient; no Rnd).
            void empty;
        }
    }

    // --- Task M3b (forceStructure.ts / resourceTargets.ts) ---
    // Empire.cs _StateForceStructureProjections / _PrivateForceStructureProjections
    // (null until the first ProjectForceStructure / ProjectPrivateForceStructure).
    stateForceStructureProjections: ForceStructureProjectionList | null = null;
    privateForceStructureProjections: ForceStructureProjectionList | null = null;
    // Empire.cs _ResourceTargets = new HabitatPrioritizationList() (IdentifyResourceCentres).
    resourceTargets: HabitatPrioritization[] = [];
    // Empire.cs public double BuildFactor = 1.0.
    buildFactor = 1.0;

    // --- Task M3d (stationPlacement.ts) ---
    // Empire.cs _ResearchHabitats = new HabitatList() (277; DetermineResearchStationLocation).
    researchHabitats: Habitat[] = [];
    // Empire.cs _UnavailableLuxuryResources = new ResourceList() / _SelfSuppliedLuxuryResources
    // (null until IdentifyUnavailableLuxuryResources / EvaluateColonyVariablesPirate).
    unavailableLuxuryResources: ResourceRef[] = [];
    selfSuppliedLuxuryResources: ResourceRef[] | null = null;
    // Empire.cs _KnownPirateBases = new BuiltObjectList() (481). TODO(port): filled by
    // visibility scans (BuiltObject.1.cs 1902/1928, Galaxy.4.cs 3798) — empty at game start.
    knownPirateBases: BuiltObject[] = [];

    // --- independentTraders.ts (Galaxy DoTasks long block) ---
    // Empire.cs 323: public BuiltObjectList DisputedBases = new BuiltObjectList() (IdentifyDisputedBases).
    disputedBases: BuiltObject[] | null = [];
    // Empire.cs 283/286: _RefuellingLocations / _RefuellingLocationsMilitaryOnly = new StellarObjectList()
    // (UpdateEmpireRefuellingLocations, Empire.6.cs 3845).
    refuellingLocations: (Habitat | BuiltObject)[] = [];
    refuellingLocationsMilitaryOnly: (Habitat | BuiltObject)[] = [];

    // --- characters.ts (Empire.6.cs GenerateStartingCharacters) ---
    // Empire.cs 866: public Character Leader (assigned by Character.CompleteEmpireChange).
    // Empire.characters (Empire.cs CharacterList Characters) holds Character objects (characters.ts).
    leader: Character | null = null;
    // Empire.cs 862: public CharacterList AvailableCharacters = new CharacterList() — empty for a
    // new game (filled only by the scenario editor / game events).
    availableCharacters: Character[] = [];
}

// Task M3b: Empire.GovernmentAttributes (Empire.cs 2805: _Galaxy.Governments[_GovernmentId],
// assigned by ChangeGovernment — the TS changeGovernment only stores the id).
// C# `parent is BuiltObject` for AddBuiltObjectToGalaxy's object parent (Habitat otherwise).
function isBuiltObject(o: Habitat | BuiltObject): o is BuiltObject {
    return (o as BuiltObject).builtObjectID !== undefined && (o as BuiltObject).design !== undefined;
}

export function empireGovernmentAttributes(empire: Empire): Government | null {
    const id = empire.governmentId;
    return id >= 0 && id < governmentsStatic.length ? governmentsStatic[id] : null;
}

// Race.cs ShipSizeFactorCivilian / ShipSizeFactorMilitary (default 1.0; parsed values
// clamped to [0.7, 5.1]), read from the race file's extra keys.
export function raceShipSizeFactor(race: Race, key: 'ShipSizeFactorCivilian' | 'ShipSizeFactorMilitary'): number {
    const raw = race.extra?.[key];
    if (raw === undefined) return 1.0;
    return Math.max(0.7, Math.min(Number(raw), 5.1));
}

// Race.cs DesignsPictureFamilyIndexPirates (default -1; -1 when not an int).
export function raceDesignPictureFamilyIndexPirates(race: Race): number {
    const raw = race.extra?.['DesignsPictureFamilyIndexPirates'];
    if (raw === undefined) return -1;
    const n = Number(raw.trim());
    return Number.isInteger(n) ? n : -1;
}
