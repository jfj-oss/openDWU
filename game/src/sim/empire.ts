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
import { START_STAR_DATE } from './galaxyTime';
import { Cargo, CargoList, ResourceRef, TroopList } from './cargo';
import { checkEmpireColorUsed, selectColorFromKey, selectComplementaryColorKey, selectUnusedMainColor } from './empireColors';
import { ResearchSystem, ResearchAbilityType } from './researchSystem';
import { EmpireVisibility, SystemVisibilityStatus, type SystemVisibility, type VisibilityOwner, type VisibilityUnit } from './visibility';

// TODO(port): EmpirePolicy type — Empire.cs / Policy.cs (policy data model
// not ported yet); constructors treat it as an opaque value.
export type EmpirePolicy = unknown;

// Port of DistantWorlds.Types.AutomationLevel (AutomationLevel.cs).
export enum AutomationLevel {
    Undefined,
    PartiallyAutomated,
    FullyAutomated,
}

// SystemVisibilityStatus lives in visibility.ts (task C1; C# order
// Undefined, Unexplored, Explored, Visible).
export { SystemVisibilityStatus } from './visibility';

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



// TODO(port): EmpireCounters — EmpireCounters.cs.
class EmpireCounters {
    constructor(_empire: Empire) {}
}

// TODO(port): PirateEconomy — PirateEconomy.cs.
class PirateEconomy {
    constructor(_startStarDate: number) {}
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
            // Independent-empire overload.
            void arg3;
            this.initialize(galaxy, name, arg4 as Habitat | null, arg5 as Race | null, -1, 1.0, arg6 as EmpirePolicy, false);
        } else {
            this.initialize(galaxy, name, arg3, arg4 as Race | null, arg5 as number, arg6 as number, arg7 ?? ({} as EmpirePolicy), arg8 ?? false);
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
        // TODO(port): Galaxy.ResearchNodeDefinitionsStatic.ObtainTechTree /
        // SetTechTreeStartingDefaults — Galaxy.cs / ResearchNodeDefinition.cs.
        // Empire.cs 3961-3962: ObtainTechTree(race) + SetTechTreeStartingDefaults(race, policy).
        // TODO(port): SetTechTreeStartingDefaults — GenerateEmpire's SetTechTreeLevel
        // re-sets IsResearched for every node for integer tech levels anyway.
        this.research.obtainTechTree();
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
    visibilityOwner(): VisibilityOwner {
        return {
            get isIndependent() {
                return false;
            },
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
        } else {
            colony.isRefuellingDepot = false;
        }
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

    // Port of Empire.cs SelectEmpireColors (line 4385), non-pirate path.
    // TODO(port): pirate-faction branch (DefaultMainColorPirates, DetermineSecondaryColor) — C2d.
    selectEmpireColors(isPirateFaction: boolean, setColors: (main: number, secondary: number) => void): void {
        let flag = false;
        let mainColor = 0;
        let secondaryColor = 0;
        let iterationCount = 0;
        while (iterationCount < 200 && !flag) {
            iterationCount++;
            const race = this.dominantRace;
            const color = race !== null ? selectColorFromKey(race.defaultPrimaryColor) : 0;
            if (race !== null && !checkEmpireColorUsed(this.galaxy, isPirateFaction, color)) {
                mainColor = color;
                secondaryColor = selectColorFromKey(race.defaultSecondaryColor);
            } else {
                const u = selectUnusedMainColor(this.galaxy, isPirateFaction);
                mainColor = u.color;
                if (u.unusedColorKey < 0) {
                    secondaryColor = selectColorFromKey(this.galaxy.rnd.next(0, 23));
                } else {
                    secondaryColor = selectColorFromKey(selectComplementaryColorKey(u.unusedColorKey));
                }
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