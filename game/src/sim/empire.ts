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
import { HabitatCategoryType } from './types';
import type { Habitat } from './types';
import type { Race } from './data/races';
import type { Government } from './data/governments';
import { START_STAR_DATE } from './galaxyTime';
import { Cargo, CargoList, ResourceRef, TroopList } from './cargo';

// TODO(port): EmpirePolicy type — Empire.cs / Policy.cs (policy data model
// not ported yet); constructors treat it as an opaque value.
export type EmpirePolicy = unknown;

// Port of DistantWorlds.Types.AutomationLevel (AutomationLevel.cs).
export enum AutomationLevel {
    Undefined,
    PartiallyAutomated,
    FullyAutomated,
}

// Port of DistantWorlds.Types.SystemVisibilityStatus (SystemVisibility.cs).
export enum SystemVisibilityStatus {
    Unexplored,
    Visible,
    Explored,
}

// Port of DistantWorlds.Types.BuiltObjectSubRole (BuiltObjectSubRole.cs).
// Only the members referenced by GenerateDesignSpecifications are listed;
// LatestDesigns is sized to this list in the constructor (C# uses
// Enum.GetValues(typeof(BuiltObjectSubRole))).
export enum BuiltObjectSubRole {
    CapitalShip,
    Carrier,
    ColonyShip,
    ConstructionShip,
    Cruiser,
    DefensiveBase,
    Destroyer,
    EnergyResearchStation,
    Escort,
    ExplorationShip,
    Frigate,
    GasMiningShip,
    GasMiningStation,
    HighTechResearchStation,
    LargeFreighter,
    LargeSpacePort,
    MediumFreighter,
    MediumSpacePort,
    MiningShip,
    MiningStation,
    MonitoringStation,
    PassengerShip,
    ResortBase,
    ResupplyShip,
    SmallFreighter,
    SmallSpacePort,
    TroopTransport,
    WeaponsResearchStation,
}

// One entry of Empire.SystemVisibility (SystemVisibility.cs).
export interface SystemVisibilityEntry {
    status: SystemVisibilityStatus;
    systemStar: Habitat;
}

// TODO(port): ResearchSystem + tech tree — ResearchSystem.cs /
// Galaxy.ResearchNodeDefinitionsStatic.ObtainTechTree/SetTechTreeStartingDefaults.
class ResearchSystem {
    techTree: unknown = null;
    // TODO(port): ResearchSystem.Update(race) — ResearchSystem.cs.
    update(_race: Race | null): void {}
}

// TODO(port): EmpireCounters — EmpireCounters.cs.
class EmpireCounters {
    constructor(_empire: Empire) {}
}

// TODO(port): PirateEconomy — PirateEconomy.cs.
class PirateEconomy {
    constructor(_startStarDate: number) {}
}

// TODO(port): ResourceMap.InitializeFlags/SetResourcesKnown — ResourceMap.cs.
class ResourceMap {
    initializeFlags(_habitatCount: number, _galaxy: Galaxy): void {}
    setResourcesKnown(_habitat: Habitat, _known: boolean): void {}
}

// TODO(port): DesignSpecification.LoadFromFile — DesignSpecification.cs.
interface DesignSpecification {}

function loadDesignSpecification(
    _galaxy: Galaxy,
    _name: string,
    _subRole: BuiltObjectSubRole,
    _isMobile: boolean,
    _dominantRace: Race | null,
    _isPirate: boolean,
    _raceNameOverride?: string | null,
): DesignSpecification {
    return {};
}

// Module-level stand-in for Galaxy.GovernmentsStatic (the parsed government
// definitions, normally loaded with the game data). Tests populate it via
// setGovernmentsStatic(); until then the resolvers see an empty list.
let governmentsStatic: (Government | null)[] = [];
export function setGovernmentsStatic(list: (Government | null)[]): void {
    governmentsStatic = list;
}

// Per-galaxy empire-id counter standing in for Galaxy.GetNextEmpireID()
// (Galaxy.cs). The TS Galaxy class has no such member and cannot be edited
// for this task, so the counter lives here keyed by galaxy instance.
const empireIdCounters = new WeakMap<Galaxy, number>();
function nextEmpireId(galaxy: Galaxy): number {
    const current = empireIdCounters.get(galaxy) ?? 0;
    empireIdCounters.set(galaxy, current + 1);
    return current;
}

// TODO(port): exact value of Empire._LongProcessingInterval — Empire.cs
// (field initializer not in the excerpt); used to back-date the five
// "last touch" timestamps at construction.
const LONG_PROCESSING_INTERVAL_MS = 60_000;

// TODO(port): Galaxy.ColonyAnnualResourceConsumptionRate /
// ColonyAnnualLuxuryResourceConsumptionRate / MinimumLuxuryResourceReorderAmount
// statics — Galaxy.cs (values not in the excerpt).
const COLONY_ANNUAL_RESOURCE_CONSUMPTION_RATE = 1.0;
const COLONY_ANNUAL_LUXURY_RESOURCE_CONSUMPTION_RATE = 1.0;
const MINIMUM_LUXURY_RESOURCE_REORDER_AMOUNT = 400;

export class Empire {
    galaxy!: Galaxy;
    active = true;
    empireId = 0;
    counters = new EmpireCounters(this);
    pirateEconomy = new PirateEconomy(START_STAR_DATE);
    resourceMap = new ResourceMap();
    name = '';
    capital: Habitat | null = null;
    homeWorld: Habitat | null = null;
    dominantRace: Race | null = null;
    corruptionMultiplier = 0;
    lastDisasterDate = START_STAR_DATE;
    policy: EmpirePolicy = {};
    reclusive = false;
    allowableGovernmentTypes: number[] = [];
    governmentId = -1;
    designNamesIndex = 0;
    builtObjects: unknown[] = [];
    shipGroups: unknown[] = [];
    designs: unknown[] = [];
    latestDesigns: unknown[] = [];
    foreignDesigns: unknown[] = [];
    characters: unknown[] = [];
    troops = new TroopList();
    intelligenceMissions: unknown[] = [];
    outlaws: unknown[] = [];
    diplomaticRelations: unknown[] = [];
    proposedDiplomaticRelations: unknown[] = [];
    colonies: Habitat[] = [];
    constructionYards: unknown[] = [];
    distressSignals: unknown[] = [];
    manufacturers: unknown[] = [];
    privateBuiltObjects: unknown[] = [];
    refuellingDepots: unknown[] = [];
    resourceExtractors: unknown[] = [];
    spacePorts: unknown[] = [];
    miningStations: unknown[] = [];
    freighters: unknown[] = [];
    constructionShips: unknown[] = [];
    longRangeScanners: unknown[] = [];
    researchFacilities: unknown[] = [];
    resortBases: unknown[] = [];
    resupplyShips: unknown[] = [];
    planetDestroyers: unknown[] = [];
    messages: unknown[] = [];
    empireEvaluations: unknown[] = [];
    systemVisibility: SystemVisibilityEntry[] = [];
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
    privateMoney = 0.0;
    research = new ResearchSystem();
    lastLeaderChangeDate = START_STAR_DATE;
    designSpecifications: DesignSpecification[] = [];
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
    ) {
        if (typeof arg3 === 'boolean') {
            // Independent-empire overload.
            void arg3;
            this.initialize(galaxy, name, arg4 as Habitat | null, arg5 as Race | null, -1, 1.0, arg6 as EmpirePolicy, false);
        } else {
            this.initialize(galaxy, name, arg3, arg4 as Race | null, arg5 as number, arg6 as number, arg7 ?? ({} as EmpirePolicy), false);
        }
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
        this.empireId = nextEmpireId(galaxy);
        this.counters = new EmpireCounters(this);
        // TODO(port): Galaxy.CurrentStarDate — Galaxy.cs (no time on the TS
        // Galaxy yet); stand in with the start star date.
        this.pirateEconomy = new PirateEconomy(START_STAR_DATE);
        this.resourceMap.initializeFlags(galaxy.habitats.length, galaxy);
        this.name = name;
        this.capital = capital;
        this.homeWorld = this.capital;
        this.dominantRace = dominantRace;
        this.corruptionMultiplier = corruptionMultiplier;
        // TODO(port): Galaxy.ColonyNames/ColonyNameIndex — Galaxy.cs (not
        // ported); player-empire capital rename branch is a guarded no-op.
        if (isPlayerEmpire && false) {
            // capital.Name = galaxy.ColonyNames[galaxy.ColonyNameIndex++];
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
        this.diplomaticRelations = [];
        this.proposedDiplomaticRelations = [];
        // C#: _ProposedDiplomaticRelations.InvertEmpireIndexing = true —
        // TODO(port): DiplomaticRelationList — DiplomaticRelation.cs.
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
        this.systemVisibility = [];
        for (let j = 0; j < galaxy.systems.length; j++) {
            this.systemVisibility.push({
                status: SystemVisibilityStatus.Unexplored,
                systemStar: galaxy.systems[j].systemStar,
            });
        }
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
        this.research = new ResearchSystem();
        // TODO(port): Galaxy.ResearchNodeDefinitionsStatic.ObtainTechTree /
        // SetTechTreeStartingDefaults — Galaxy.cs / ResearchNodeDefinition.cs.
        this.research.techTree = null;
        this.research.update(this.dominantRace);
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
        // C# iterates Galaxy.ResourceSystem.StrategicResourcesOrderedByRelativeImportance.
        // TODO(port): ResourceSystem strategic-resource ordering +
        // RelativeImportance — ResourceSystem.cs (not ported); substitute the
        // galaxy's mineral (type 0) resources in file order with importance 1.
        for (const resourceDefinition of this.galaxy.resources) {
            if (resourceDefinition.type === 0 && resourceDefinition.colonyManufacturingLevel <= 0) {
                cargo = new Cargo(new ResourceRef(resourceDefinition.resourceId), Math.trunc(1 * 6000 * num), this);
                colony.cargo!.add(cargo);
            }
        }
        // C#: 4 picks from Galaxy.ResourceSystem.LuxuryResources via
        // Galaxy.Rnd.Next(0, count). Luxury pool = type-2 resources.
        const luxuryResources = this.galaxy.resources.filter((r) => r.type === 2);
        for (let j = 0; j < 4; j++) {
            const index = this.galaxy.rnd.next(0, luxuryResources.length);
            const resourceDefinition2 = luxuryResources[index];
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

    // TODO(port): Galaxy.SelectRandomLuxuryResource — Galaxy.cs (random
    // luxury pick); substitute a uniform pick over the galaxy's type-2
    // resources using galaxy.rnd so the Rnd call stays in position.
    private selectRandomLuxuryResource(): ResourceRef {
        const pool = this.galaxy.resources.filter((r) => r.type === 2);
        if (pool.length === 0) {
            return new ResourceRef(-1);
        }
        return new ResourceRef(pool[this.galaxy.rnd.next(0, pool.length)].resourceId);
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
            this.planetDestroyerDesignSpecification = loadDesignSpecification(galaxy, 'PlanetDestroyer', BuiltObjectSubRole.CapitalShip, true, dominantRace, isPirate, raceNameOverride);
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

    // TODO(port): GenerateEmpireName — Empire.cs (adjective/noun tables from
    // the government definition + Galaxy random name parts); deterministic
    // fallback until the naming data is wired up.
    generateEmpireName(governmentId: number): string {
        const government = governmentsStatic.find((g) => g !== null && g.governmentId === governmentId);
        if (government !== undefined && government !== null && government.empireNameAdjectives.length > 0 && government.empireNameNouns.length > 0) {
            const adjective = government.empireNameAdjectives[0];
            const noun = government.empireNameNouns[0];
            return `${adjective} ${noun}`;
        }
        return 'Empire';
    }

    // TODO(port): SelectEmpireColors — Empire.cs (race default colors /
    // palette); neutral colors until ported.
    selectEmpireColors(_isPirateFaction: boolean, setColors: (main: number, secondary: number) => void): void {
        setColors(this.dominantRace?.defaultPrimaryColor ?? 0, this.dominantRace?.defaultSecondaryColor ?? 0);
    }

    // TODO(port): ReviewResearchAbilities — Empire.cs.
    reviewResearchAbilities(): void {}

    // TODO(port): ReviewDesignsBuiltObjectsImprovedComponents — Empire.cs.
    reviewDesignsBuiltObjectsImprovedComponents(): void {}

    // TODO(port): ReviewColonizationTypes — Empire.cs.
    reviewColonizationTypes(): void {}

    // TODO(port): ReviewPopulationGrowthRates — Empire.cs.
    reviewPopulationGrowthRates(): void {}

    // TODO(port): ReviewMaximumConstructionSize(out int) — Empire.cs.
    reviewMaximumConstructionSize(setSize: (size: number) => void): void {
        setSize(0);
    }

    // TODO(port): ReviewCanBuildShipTypes — Empire.cs.
    reviewCanBuildShipTypes(): void {}

    // TODO(port): ReviewTroopTypes — Empire.cs.
    reviewTroopTypes(): void {}
}