// Empire policy files (Policy/<race>.txt, Policy/pirate/<race>.txt).
// Port of EmpirePolicy.cs: every public field, LoadFromFile (229) /
// SetNameValuePair (256), the Parse* helpers (788-838), and Galaxy.4.cs
// ResolveTechFocus (917) / ResolveTechFocuses (1030).
// SaveToFile (840) / BuildPolicyLine (1052): writeEmpirePolicyFile (the Empire Policy panel's Save). Clone is not
// ported: copies are plain object spreads (cloneEmpirePolicy).

import { ComponentType } from './components';
// ShipDesignFocus is defined in researchSystem.ts (owned by another task in
// flight); researchSystem.ts imports from this module, so importing the
// value here would create a runtime cycle. `import type` is erased at
// compile time, so this is cycle-safe.
import type { ShipDesignFocus } from '../researchSystem';
// BuiltObjectFleeWhen is defined in designSpecifications.ts, which imports
// ComponentCategoryType (value) from this module - so this module must only
// take a type-only import back, to avoid a runtime cycle.
import type { BuiltObjectFleeWhen } from './designSpecifications';
import { IndustryType } from '../types';

// Port of ComponentCategoryType.cs (enum member order exact).
export enum ComponentCategoryType {
    Undefined,
    WeaponBeam,
    WeaponTorpedo,
    WeaponArea,
    WeaponPointDefense,
    WeaponIon,
    WeaponGravity,
    Armor,
    AssaultPod,
    Fighter,
    Shields,
    ShieldRecharge,
    Engine,
    HyperDrive,
    HyperDisrupt,
    Reactor,
    EnergyCollector,
    Extractor,
    Manufacturer,
    Storage,
    Sensor,
    Computer,
    Labs,
    Construction,
    Habitation,
    WeaponSuperBeam,
    WeaponSuperArea,
    WeaponSuperTorpedo,
}

// Port of Galaxy.4.cs DetermineComponentCategoryByIndex (882): research.txt category column.
const CATEGORY_BY_INDEX: ComponentCategoryType[] = [
    ComponentCategoryType.Armor,
    ComponentCategoryType.AssaultPod,
    ComponentCategoryType.Computer,
    ComponentCategoryType.Construction,
    ComponentCategoryType.EnergyCollector,
    ComponentCategoryType.Engine,
    ComponentCategoryType.Extractor,
    ComponentCategoryType.Fighter,
    ComponentCategoryType.Habitation,
    ComponentCategoryType.HyperDisrupt,
    ComponentCategoryType.HyperDrive,
    ComponentCategoryType.Labs,
    ComponentCategoryType.Manufacturer,
    ComponentCategoryType.Reactor,
    ComponentCategoryType.Sensor,
    ComponentCategoryType.ShieldRecharge,
    ComponentCategoryType.Shields,
    ComponentCategoryType.Storage,
    ComponentCategoryType.WeaponArea,
    ComponentCategoryType.WeaponBeam,
    ComponentCategoryType.WeaponGravity,
    ComponentCategoryType.WeaponIon,
    ComponentCategoryType.WeaponPointDefense,
    ComponentCategoryType.WeaponSuperArea,
    ComponentCategoryType.WeaponSuperBeam,
    ComponentCategoryType.WeaponTorpedo,
    ComponentCategoryType.WeaponSuperTorpedo,
];
export function componentCategoryByIndex(index: number): ComponentCategoryType {
    return CATEGORY_BY_INDEX[index] ?? ComponentCategoryType.Undefined;
}

// Port of Galaxy.4.cs ResolveTechDisallow (592): race DisallowedResearchArea1..3.
export function resolveTechDisallow(index: number): ComponentCategoryType {
    switch (index) {
        case 1: return ComponentCategoryType.WeaponTorpedo;
        case 2: return ComponentCategoryType.WeaponPointDefense;
        case 3: return ComponentCategoryType.WeaponArea;
        case 4: return ComponentCategoryType.WeaponIon;
        case 5: return ComponentCategoryType.Fighter;
        case 6: return ComponentCategoryType.Armor;
        case 7: return ComponentCategoryType.HyperDisrupt;
        case 8: return ComponentCategoryType.Sensor;
        default: return ComponentCategoryType.Undefined;
    }
}

export interface TechFocus {
    category: ComponentCategoryType;
    type: ComponentType;
}

// Port of Galaxy.4.cs ResolveTechFocus (917).
export function resolveTechFocus(index: number): TechFocus {
    const C = ComponentCategoryType;
    const T = ComponentType;
    const cat = (category: ComponentCategoryType): TechFocus => ({ category, type: T.Undefined });
    const typ = (type: ComponentType): TechFocus => ({ category: C.Undefined, type });
    switch (index) {
        case 1: return cat(C.WeaponBeam);
        case 2: return typ(T.WeaponPhaser);
        case 3: return typ(T.WeaponRailGun);
        case 4: return cat(C.WeaponTorpedo);
        case 5: return typ(T.WeaponBombard);
        case 6: return typ(T.WeaponMissile);
        case 7: return cat(C.WeaponArea);
        case 8: return cat(C.WeaponIon);
        case 9: return cat(C.Fighter);
        case 10: return typ(T.Armor);
        case 11: return cat(C.Shields);
        case 12: return cat(C.Reactor);
        case 13: return typ(T.EngineMainThrust);
        case 14: return typ(T.EngineVectoring);
        case 15: return cat(C.HyperDrive);
        case 16: return cat(C.HyperDisrupt);
        case 17: return cat(C.Construction);
        case 18: return typ(T.DamageControl);
        case 19: return typ(T.ComputerTargetting);
        case 20: return typ(T.ComputerCountermeasures);
        case 21: return cat(C.Sensor);
        case 22: return typ(T.HabitationMedicalCenter);
        case 23: return typ(T.HabitationRecreationCenter);
        case 24: return typ(T.WeaponTractorBeam);
        case 25: return typ(T.AssaultPod);
        case 26: return typ(T.WeaponGravityBeam);
        case 27: return typ(T.WeaponAreaGravity);
        case 28: return typ(T.WeaponSuperBeam);
        case 29: return typ(T.WeaponSuperArea);
        case 30: return typ(T.WeaponSuperTorpedo);
        case 31: return typ(T.WeaponSuperMissile);
        case 32: return typ(T.WeaponSuperRailGun);
        case 33: return typ(T.WeaponSuperPhaser);
        default: return { category: C.Undefined, type: T.Undefined };
    }
}

// Port of ColonyPopulationPolicy.cs (enum member order exact).
export enum ColonyPopulationPolicy {
    Assimilate,
    DoNotAccept,
    Resettle,
    Enslave,
    Exterminate,
}

export interface EmpirePolicy {
    /** ResearchDesignTechFocus1..6 (category + type per slot); derived convenience view. */
    researchDesignTechFocus: TechFocus[];

    intelligenceCounterIntelligenceProportion: number;
    intelligenceAllowMissionSabotageConstruction: boolean;
    intelligenceAllowMissionStealTerritoryMap: boolean;
    intelligenceAllowMissionStealGalaxyMap: boolean;
    intelligenceAllowMissionStealOperationsMap: boolean;
    intelligenceAllowMissionStealTechData: boolean;
    intelligenceAllowMissionSabotageColony: boolean;
    intelligenceAllowMissionDeepCover: boolean;
    intelligenceAllowMissionInciteRevolution: boolean;
    intelligenceAllowMissionAssassinateCharacter: boolean;
    intelligenceAllowMissionDestroyBase: boolean;
    intelligenceUseEspionageAgainstEmpireWhen: number;
    intelligenceUseSabotageAgainstEmpireWhen: number;
    diplomacyTradeSanctionsUseBlockades: boolean;
    diplomacySendGiftsUpToAmount: number;
    /** [OptionalField], no initializer -> default false. */
    colonyActionForNewTroopRecruitment: boolean;
    /** C# `Design` reference type; not ported, always null here. */
    colonyActionForNewBuildDesign: unknown | null;
    colonyAllowFacilityTroopTrainingCenter: boolean;
    colonyAllowFacilityRoboticTroopFoundry: boolean;
    colonyAllowFacilityCloningFacility: boolean;
    colonyAllowFacilityPlanetaryShield: boolean;
    colonyAllowFacilityGiantIonCannon: boolean;
    colonyAllowFacilityFortifiedBunker: boolean;
    colonyAllowFacilityRegionalCapital: boolean;
    colonyAllowFacilityTerraformingFacility: boolean;
    colonyAllowFacilityArmoredFactory: boolean;
    colonyAllowFacilityMilitaryAcademy: boolean;
    colonyAllowFacilitySpyAcademy: boolean;
    colonyAllowFacilityNavalAcademy: boolean;
    colonyAllowFacilityScienceAcademy: boolean;
    colonyFacilityPopulationThresholdTroopTrainingCenter: number;
    colonyFacilityPopulationThresholdRoboticTroopFoundry: number;
    colonyFacilityPopulationThresholdCloningFacility: number;
    colonyFacilityPopulationThresholdPlanetaryShield: number;
    colonyFacilityPopulationThresholdGiantIonCannon: number;
    colonyFacilityPopulationThresholdFortifiedBunker: number;
    colonyFacilityPopulationThresholdRegionalCapital: number;
    colonyFacilityPopulationThresholdTerraformingFacility: number;
    colonyFacilityPopulationThresholdArmoredFactory: number;
    colonyFacilityPopulationThresholdMilitaryAcademy: number;
    colonyFacilityPopulationThresholdSpyAcademy: number;
    colonyFacilityPopulationThresholdNavalAcademy: number;
    colonyFacilityPopulationThresholdScienceAcademy: number;
    colonyTaxRateSmallColony: number;
    colonyTaxRateMediumColony: number;
    colonyTaxRateLargeColony: number;
    colonyTaxRateIncreaseWhenAtWar: boolean;
    colonyPopulationThresholdTroopRecruitment: number;
    researchDesignOverallFocus: ShipDesignFocus;
    researchDesignTechFocus1: ComponentCategoryType;
    researchDesignTechFocus2: ComponentCategoryType;
    researchDesignTechFocusType1: ComponentType;
    researchDesignTechFocusType2: ComponentType;
    researchDesignAutoRetrofit: boolean;
    /** [OptionalField] but initialised to true in the ctor. */
    researchDesignAutoUpgradeFighters: boolean;
    constructionMilitary: number;
    constructionMilitaryEscort: number;
    constructionMilitaryFrigate: number;
    constructionMilitaryDestroyer: number;
    constructionMilitaryCruiser: number;
    constructionMilitaryCapitalShip: number;
    constructionMilitaryTroopTransport: number;
    constructionMilitaryCarrier: number;
    constructionSpaceportMinimumDistance: number;
    constructionSpaceportSmallColonyPopulationThreshold: number;
    constructionSpaceportMediumColonyPopulationThreshold: number;
    constructionSpaceportLargeColonyPopulationThreshold: number;
    warAttacksAllowColonyBombardment: number;
    warAttacksAllowPlanetDestroying: number;
    warAttacksHarassEnemies: boolean;
    fleetTypicalSize: number;
    fleetStrikeForceTypicalSize: number;
    fleetMilitaryProportionForFleets: number;
    tradeWithOtherEmpires: boolean;
    engageInTourism: boolean;
    newColonyPopulationPolicyAllRaces: ColonyPopulationPolicy;
    newColonyPopulationPolicyYourRaceFamily: ColonyPopulationPolicy;
    implementEnslavementWithPenalColonies: boolean;
    homeworldDefensePriority: number;
    /** No initializer -> default false. */
    protectLeaderAtAllCosts: boolean;
    prioritizeBuildWonderId: number;
    colonizeContinentalPriority: number;
    colonizeMarshySwampPriority: number;
    colonizeOceanPriority: number;
    colonizeDesertPriority: number;
    colonizeIcePriority: number;
    colonizeVolcanicPriority: number;
    colonizeRuinsPriority: number;
    controlRestrictedResourcesPriority: number;
    researchIndustryFocus: IndustryType;
    researchPriority: number;
    tradePriority: number;
    alliancePriority: number;
    subjugationPriority: number;
    tourismPriority: number;
    explorationPriority: number;
    warWillingness: number;
    breakTreatyWillingness: number;
    invasionOverkillFactor: number;
    shipBattleCautionFactor: number;
    defaultMilitaryFleeWhen: BuiltObjectFleeWhen;
    designUpgradeEscort: boolean;
    designUpgradeFrigate: boolean;
    designUpgradeDestroyer: boolean;
    designUpgradeCruiser: boolean;
    designUpgradeCapitalShip: boolean;
    designUpgradeTroopTransport: boolean;
    designUpgradeCarrier: boolean;
    designUpgradeResupplyShip: boolean;
    designUpgradeExplorationShip: boolean;
    designUpgradeColonyShip: boolean;
    designUpgradeConstructionShip: boolean;
    designUpgradeSmallSpacePort: boolean;
    designUpgradeMediumSpacePort: boolean;
    designUpgradeLargeSpacePort: boolean;
    designUpgradeResortBase: boolean;
    designUpgradeGenericBase: boolean;
    designUpgradeEnergyResearchStation: boolean;
    designUpgradeWeaponsResearchStation: boolean;
    designUpgradeHighTechResearchStation: boolean;
    designUpgradeMonitoringStation: boolean;
    designUpgradeDefensiveBase: boolean;
    designUpgradeSmallFreighter: boolean;
    designUpgradeMediumFreighter: boolean;
    designUpgradeLargeFreighter: boolean;
    designUpgradePassengerShip: boolean;
    designUpgradeGasMiningShip: boolean;
    designUpgradeMiningShip: boolean;
    designUpgradeGasMiningStation: boolean;
    designUpgradeMiningStation: boolean;
    researchDesignTechFocus3: ComponentCategoryType;
    researchDesignTechFocus4: ComponentCategoryType;
    researchDesignTechFocus5: ComponentCategoryType;
    researchDesignTechFocus6: ComponentCategoryType;
    researchDesignTechFocusType3: ComponentType;
    researchDesignTechFocusType4: ComponentType;
    researchDesignTechFocusType5: ComponentType;
    researchDesignTechFocusType6: ComponentType;
    captureTargetConditionShip: number;
    captureTargetConditionBase: number;
    offerPirateAttackMissions: number;
    bidOnPirateAttackMissions: boolean;
    captureEnlistMilitaryShip: number;
    captureDisassembleMilitaryShip: number;
    captureEnlistCivilianShip: number;
    captureDisassembleCivilianShip: number;
    captureEnlistBase: number;
    upgradeEnlistedMilitaryShips: boolean;
    upgradeEnlistedCivilianShips: boolean;
    offerDefensivePirateMissions: number;
    pirateSmugglerFreighterLevel: number;
    pirateSmugglerMiningLevel: number;
    pirateSmugglerPassengerLevel: number;
    bidOnPirateDefendMissions: boolean;
    acceptPirateSmugglingMissions: boolean;
    offerDefensivePirateMissionsSituation: number;
    offerSmugglingPirateMissions: number;
    troopRecruitInfantryLevel: number;
    troopRecruitArmorLevel: number;
    troopRecruitArtilleryLevel: number;
    troopRecruitSpecialForcesLevel: number;
    troopUseDefaultTransportLoadout: boolean;
    troopDefaultTransportLoadoutInfantry: number;
    troopDefaultTransportLoadoutArmor: number;
    troopDefaultTransportLoadoutArtillery: number;
    troopDefaultTransportLoadoutSpecialForces: number;
    troopGarrisonMinimumPerColony: number;
    troopGarrisonLevel: number;
    useExplorationShipsToScoutEnemySystems: boolean;
    buildPlanetDestroyers: boolean;
}

export function defaultEmpirePolicy(): EmpirePolicy {
    return {
        researchDesignTechFocus: Array.from({ length: 6 }, () => ({ category: ComponentCategoryType.Undefined, type: ComponentType.Undefined })),

        intelligenceCounterIntelligenceProportion: 30,
        intelligenceAllowMissionSabotageConstruction: true,
        intelligenceAllowMissionStealTerritoryMap: true,
        intelligenceAllowMissionStealGalaxyMap: true,
        intelligenceAllowMissionStealOperationsMap: true,
        intelligenceAllowMissionStealTechData: true,
        intelligenceAllowMissionSabotageColony: true,
        intelligenceAllowMissionDeepCover: true,
        intelligenceAllowMissionInciteRevolution: true,
        intelligenceAllowMissionAssassinateCharacter: true,
        intelligenceAllowMissionDestroyBase: true,
        intelligenceUseEspionageAgainstEmpireWhen: 2,
        intelligenceUseSabotageAgainstEmpireWhen: 1,
        diplomacyTradeSanctionsUseBlockades: true,
        diplomacySendGiftsUpToAmount: 20000,
        colonyActionForNewTroopRecruitment: false,
        colonyActionForNewBuildDesign: null,
        colonyAllowFacilityTroopTrainingCenter: true,
        colonyAllowFacilityRoboticTroopFoundry: true,
        colonyAllowFacilityCloningFacility: true,
        colonyAllowFacilityPlanetaryShield: true,
        colonyAllowFacilityGiantIonCannon: true,
        colonyAllowFacilityFortifiedBunker: true,
        colonyAllowFacilityRegionalCapital: true,
        colonyAllowFacilityTerraformingFacility: true,
        colonyAllowFacilityArmoredFactory: true,
        colonyAllowFacilityMilitaryAcademy: true,
        colonyAllowFacilitySpyAcademy: true,
        colonyAllowFacilityNavalAcademy: true,
        colonyAllowFacilityScienceAcademy: true,
        colonyFacilityPopulationThresholdTroopTrainingCenter: 500,
        colonyFacilityPopulationThresholdRoboticTroopFoundry: 500,
        colonyFacilityPopulationThresholdCloningFacility: 500,
        colonyFacilityPopulationThresholdPlanetaryShield: 2000,
        colonyFacilityPopulationThresholdGiantIonCannon: 5000,
        colonyFacilityPopulationThresholdFortifiedBunker: 500,
        colonyFacilityPopulationThresholdRegionalCapital: 5000,
        colonyFacilityPopulationThresholdTerraformingFacility: 500,
        colonyFacilityPopulationThresholdArmoredFactory: 500,
        colonyFacilityPopulationThresholdMilitaryAcademy: 2000,
        colonyFacilityPopulationThresholdSpyAcademy: 2000,
        colonyFacilityPopulationThresholdNavalAcademy: 5000,
        colonyFacilityPopulationThresholdScienceAcademy: 5000,
        colonyTaxRateSmallColony: 0,
        colonyTaxRateMediumColony: 2,
        colonyTaxRateLargeColony: 3,
        colonyTaxRateIncreaseWhenAtWar: true,
        colonyPopulationThresholdTroopRecruitment: 0,
        researchDesignOverallFocus: 0 as ShipDesignFocus,
        researchDesignTechFocus1: ComponentCategoryType.Undefined,
        researchDesignTechFocus2: ComponentCategoryType.Undefined,
        researchDesignTechFocusType1: ComponentType.Undefined,
        researchDesignTechFocusType2: ComponentType.Undefined,
        researchDesignAutoRetrofit: true,
        researchDesignAutoUpgradeFighters: true,
        constructionMilitary: 1,
        constructionMilitaryEscort: 18,
        constructionMilitaryFrigate: 24,
        constructionMilitaryDestroyer: 20,
        constructionMilitaryCruiser: 15,
        constructionMilitaryCapitalShip: 7,
        constructionMilitaryTroopTransport: 8,
        constructionMilitaryCarrier: 8,
        constructionSpaceportMinimumDistance: 700,
        constructionSpaceportSmallColonyPopulationThreshold: 30,
        constructionSpaceportMediumColonyPopulationThreshold: 500,
        constructionSpaceportLargeColonyPopulationThreshold: 3000,
        warAttacksAllowColonyBombardment: 2,
        warAttacksAllowPlanetDestroying: 2,
        warAttacksHarassEnemies: true,
        fleetTypicalSize: 15,
        fleetStrikeForceTypicalSize: 4,
        fleetMilitaryProportionForFleets: 60,
        tradeWithOtherEmpires: true,
        engageInTourism: true,
        newColonyPopulationPolicyAllRaces: ColonyPopulationPolicy.Assimilate,
        newColonyPopulationPolicyYourRaceFamily: ColonyPopulationPolicy.Assimilate,
        implementEnslavementWithPenalColonies: true,
        homeworldDefensePriority: 1.0,
        protectLeaderAtAllCosts: false,
        prioritizeBuildWonderId: -1,
        colonizeContinentalPriority: 1.0,
        colonizeMarshySwampPriority: 1.0,
        colonizeOceanPriority: 1.0,
        colonizeDesertPriority: 1.0,
        colonizeIcePriority: 1.0,
        colonizeVolcanicPriority: 1.0,
        colonizeRuinsPriority: 1.0,
        controlRestrictedResourcesPriority: 1.0,
        researchIndustryFocus: IndustryType.Undefined,
        researchPriority: 1.0,
        tradePriority: 1.0,
        alliancePriority: 1.0,
        subjugationPriority: 1.0,
        tourismPriority: 1.0,
        explorationPriority: 1.0,
        warWillingness: 1.0,
        breakTreatyWillingness: 1.0,
        invasionOverkillFactor: 1.0,
        shipBattleCautionFactor: 1.0,
        defaultMilitaryFleeWhen: 4 as BuiltObjectFleeWhen, // BuiltObjectFleeWhen.Shields20
        designUpgradeEscort: true,
        designUpgradeFrigate: true,
        designUpgradeDestroyer: true,
        designUpgradeCruiser: true,
        designUpgradeCapitalShip: true,
        designUpgradeTroopTransport: true,
        designUpgradeCarrier: true,
        designUpgradeResupplyShip: true,
        designUpgradeExplorationShip: true,
        designUpgradeColonyShip: true,
        designUpgradeConstructionShip: true,
        designUpgradeSmallSpacePort: true,
        designUpgradeMediumSpacePort: true,
        designUpgradeLargeSpacePort: true,
        designUpgradeResortBase: true,
        designUpgradeGenericBase: true,
        designUpgradeEnergyResearchStation: true,
        designUpgradeWeaponsResearchStation: true,
        designUpgradeHighTechResearchStation: true,
        designUpgradeMonitoringStation: true,
        designUpgradeDefensiveBase: true,
        designUpgradeSmallFreighter: true,
        designUpgradeMediumFreighter: true,
        designUpgradeLargeFreighter: true,
        designUpgradePassengerShip: true,
        designUpgradeGasMiningShip: true,
        designUpgradeMiningShip: true,
        designUpgradeGasMiningStation: true,
        designUpgradeMiningStation: true,
        researchDesignTechFocus3: ComponentCategoryType.Undefined,
        researchDesignTechFocus4: ComponentCategoryType.Undefined,
        researchDesignTechFocus5: ComponentCategoryType.Undefined,
        researchDesignTechFocus6: ComponentCategoryType.Undefined,
        researchDesignTechFocusType3: ComponentType.Undefined,
        researchDesignTechFocusType4: ComponentType.Undefined,
        researchDesignTechFocusType5: ComponentType.Undefined,
        researchDesignTechFocusType6: ComponentType.Undefined,
        captureTargetConditionShip: 1,
        captureTargetConditionBase: 1,
        offerPirateAttackMissions: 2,
        bidOnPirateAttackMissions: true,
        captureEnlistMilitaryShip: 0,
        captureDisassembleMilitaryShip: 1,
        captureEnlistCivilianShip: 2,
        captureDisassembleCivilianShip: 1,
        captureEnlistBase: 0,
        upgradeEnlistedMilitaryShips: true,
        upgradeEnlistedCivilianShips: true,
        offerDefensivePirateMissions: 2,
        pirateSmugglerFreighterLevel: 1.0,
        pirateSmugglerMiningLevel: 1.0,
        pirateSmugglerPassengerLevel: 1.0,
        bidOnPirateDefendMissions: true,
        acceptPirateSmugglingMissions: true,
        offerDefensivePirateMissionsSituation: 2,
        offerSmugglingPirateMissions: 2,
        troopRecruitInfantryLevel: 1.0,
        troopRecruitArmorLevel: 1.0,
        troopRecruitArtilleryLevel: 1.0,
        troopRecruitSpecialForcesLevel: 1.0,
        troopUseDefaultTransportLoadout: true,
        troopDefaultTransportLoadoutInfantry: 0.25,
        troopDefaultTransportLoadoutArmor: 0.5,
        troopDefaultTransportLoadoutArtillery: 0,
        troopDefaultTransportLoadoutSpecialForces: 0.25,
        troopGarrisonMinimumPerColony: 0,
        troopGarrisonLevel: 1.0,
        useExplorationShipsToScoutEnemySystems: true,
        buildPlanetDestroyers: false,
    };
}

// C# int.TryParse(NumberStyles.Any, Invariant) → 0 on failure. Any string
// Number() can parse without producing NaN is accepted (matches TryParse's
// tolerance for signs/decimal points/exponents closely enough for policy
// files, which only ever contain plain integers).
function parseIntValue(value: string): number {
    const n = Number(value.trim());
    return Number.isFinite(n) ? Math.trunc(n) : 0;
}

// C# float.TryParse(NumberStyles.Any, Invariant) → 0 on failure; the stored
// value is then a 32-bit float (Math.fround emulates that truncation).
function parseFloatValue(value: string): number {
    const n = Number(value.trim());
    return Number.isFinite(n) ? Math.fround(n) : 0;
}

// C# double.TryParse(NumberStyles.Any, Invariant) → 0 on failure.
function parseDoubleValue(value: string): number {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : 0;
}

// C# ParseBoolValue: only a trimmed, lower-cased "y" yields true; "n" or any
// other text (including empty) yields false. Note this is NOT general
// boolean parsing - "true"/"1" are NOT accepted, matching the C# source.
function parseBoolValue(value: string): boolean {
    return value.trim().toLowerCase() === 'y';
}

// C# ParseIndustryValue/ParseFleeWhenValue/ParseColonyPopulationPolicyValue:
// byte.TryParse (no NumberStyles -> plain unsigned integer digits only) → 0
// on failure, then cast to the byte-backed enum.
function parseByteValue(value: string): number {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return 0;
    const n = Number(trimmed);
    return n >= 0 && n <= 255 ? n : 0;
}

function parseIndustryValue(value: string): IndustryType {
    return parseByteValue(value) as IndustryType;
}

function parseFleeWhenValue(value: string): BuiltObjectFleeWhen {
    return parseByteValue(value) as BuiltObjectFleeWhen;
}

function parseColonyPopulationPolicyValue(value: string): ColonyPopulationPolicy {
    return parseByteValue(value) as ColonyPopulationPolicy;
}

// C#: Math.Max(0.5, Math.Min(4.0, ParseDoubleValue(value))).
function clampPriority(value: string): number {
    return Math.max(0.5, Math.min(4.0, parseDoubleValue(value)));
}

function setTechFocusSlot(policy: EmpirePolicy, slot: 1 | 2 | 3 | 4 | 5 | 6, value: string): void {
    const { category, type } = resolveTechFocus(parseIntValue(value));
    policy.researchDesignTechFocus[slot - 1] = { category, type };
    switch (slot) {
        case 1: policy.researchDesignTechFocus1 = category; policy.researchDesignTechFocusType1 = type; break;
        case 2: policy.researchDesignTechFocus2 = category; policy.researchDesignTechFocusType2 = type; break;
        case 3: policy.researchDesignTechFocus3 = category; policy.researchDesignTechFocusType3 = type; break;
        case 4: policy.researchDesignTechFocus4 = category; policy.researchDesignTechFocusType4 = type; break;
        case 5: policy.researchDesignTechFocus5 = category; policy.researchDesignTechFocusType5 = type; break;
        case 6: policy.researchDesignTechFocus6 = category; policy.researchDesignTechFocusType6 = type; break;
    }
}

// Port of EmpirePolicy.SetNameValuePair (256).
function setNameValuePair(policy: EmpirePolicy, name: string, value: string): void {
    switch (name) {
        case 'ImmediatelyRecruitNewTroopsWhenColonize': policy.colonyActionForNewTroopRecruitment = parseBoolValue(value); break;
        case 'ColonyAllowFacilityCloningFacility': policy.colonyAllowFacilityCloningFacility = parseBoolValue(value); break;
        case 'ColonyAllowFacilityFortifiedBunker': policy.colonyAllowFacilityFortifiedBunker = parseBoolValue(value); break;
        case 'ColonyAllowFacilityGiantIonCannon': policy.colonyAllowFacilityGiantIonCannon = parseBoolValue(value); break;
        case 'ColonyAllowFacilityPlanetaryShield': policy.colonyAllowFacilityPlanetaryShield = parseBoolValue(value); break;
        case 'ColonyAllowFacilityRegionalCapital': policy.colonyAllowFacilityRegionalCapital = parseBoolValue(value); break;
        case 'ColonyAllowFacilityTerraformingFacility': policy.colonyAllowFacilityTerraformingFacility = parseBoolValue(value); break;
        case 'ColonyAllowFacilityRoboticTroopFoundry': policy.colonyAllowFacilityRoboticTroopFoundry = parseBoolValue(value); break;
        case 'ColonyAllowFacilityTroopTrainingCenter': policy.colonyAllowFacilityTroopTrainingCenter = parseBoolValue(value); break;
        case 'ColonyAllowFacilityArmoredFactory': policy.colonyAllowFacilityArmoredFactory = parseBoolValue(value); break;
        case 'ColonyAllowFacilitySpyAcademy': policy.colonyAllowFacilitySpyAcademy = parseBoolValue(value); break;
        case 'ColonyAllowFacilityScienceAcademy': policy.colonyAllowFacilityScienceAcademy = parseBoolValue(value); break;
        case 'ColonyAllowFacilityNavalAcademy': policy.colonyAllowFacilityNavalAcademy = parseBoolValue(value); break;
        case 'ColonyAllowFacilityMilitaryAcademy': policy.colonyAllowFacilityMilitaryAcademy = parseBoolValue(value); break;
        case 'ColonyFacilityPopulationThresholdCloningFacility': policy.colonyFacilityPopulationThresholdCloningFacility = parseIntValue(value); break;
        case 'ColonyFacilityPopulationThresholdFortifiedBunker': policy.colonyFacilityPopulationThresholdFortifiedBunker = parseIntValue(value); break;
        case 'ColonyFacilityPopulationThresholdGiantIonCannon': policy.colonyFacilityPopulationThresholdGiantIonCannon = parseIntValue(value); break;
        case 'ColonyFacilityPopulationThresholdPlanetaryShield': policy.colonyFacilityPopulationThresholdPlanetaryShield = parseIntValue(value); break;
        case 'ColonyFacilityPopulationThresholdRegionalCapital': policy.colonyFacilityPopulationThresholdRegionalCapital = parseIntValue(value); break;
        case 'ColonyFacilityPopulationThresholdTerraformingFacility': policy.colonyFacilityPopulationThresholdTerraformingFacility = parseIntValue(value); break;
        case 'ColonyFacilityPopulationThresholdRoboticTroopFoundry': policy.colonyFacilityPopulationThresholdRoboticTroopFoundry = parseIntValue(value); break;
        case 'ColonyFacilityPopulationThresholdTroopTrainingCenter': policy.colonyFacilityPopulationThresholdTroopTrainingCenter = parseIntValue(value); break;
        case 'ColonyFacilityPopulationThresholdArmoredFactory': policy.colonyFacilityPopulationThresholdArmoredFactory = parseIntValue(value); break;
        case 'ColonyFacilityPopulationThresholdSpyAcademy': policy.colonyFacilityPopulationThresholdSpyAcademy = parseIntValue(value); break;
        case 'ColonyFacilityPopulationThresholdScienceAcademy': policy.colonyFacilityPopulationThresholdScienceAcademy = parseIntValue(value); break;
        case 'ColonyFacilityPopulationThresholdNavalAcademy': policy.colonyFacilityPopulationThresholdNavalAcademy = parseIntValue(value); break;
        case 'ColonyFacilityPopulationThresholdMilitaryAcademy': policy.colonyFacilityPopulationThresholdMilitaryAcademy = parseIntValue(value); break;
        case 'ColonyPopulationThresholdTroopRecruitment': policy.colonyPopulationThresholdTroopRecruitment = parseIntValue(value); break;
        case 'ColonyTaxRateIncreaseWhenAtWar': policy.colonyTaxRateIncreaseWhenAtWar = parseBoolValue(value); break;
        case 'ColonyTaxRateLargeColony': policy.colonyTaxRateLargeColony = parseIntValue(value); break;
        case 'ColonyTaxRateMediumColony': policy.colonyTaxRateMediumColony = parseIntValue(value); break;
        case 'ColonyTaxRateSmallColony': policy.colonyTaxRateSmallColony = parseIntValue(value); break;
        case 'MilitaryConstructionLevel': policy.constructionMilitary = parseIntValue(value); break;
        case 'ConstructionMilitaryCapitalShip': policy.constructionMilitaryCapitalShip = parseFloatValue(value); break;
        case 'ConstructionMilitaryCarrier': policy.constructionMilitaryCarrier = parseFloatValue(value); break;
        case 'ConstructionMilitaryCruiser': policy.constructionMilitaryCruiser = parseFloatValue(value); break;
        case 'ConstructionMilitaryDestroyer': policy.constructionMilitaryDestroyer = parseFloatValue(value); break;
        case 'ConstructionMilitaryEscort': policy.constructionMilitaryEscort = parseFloatValue(value); break;
        case 'ConstructionMilitaryFrigate': policy.constructionMilitaryFrigate = parseFloatValue(value); break;
        case 'ConstructionMilitaryTroopTransport': policy.constructionMilitaryTroopTransport = parseFloatValue(value); break;
        case 'ConstructionSpaceportLargeColonyPopulationThreshold': policy.constructionSpaceportLargeColonyPopulationThreshold = parseIntValue(value); break;
        case 'ConstructionSpaceportMediumColonyPopulationThreshold': policy.constructionSpaceportMediumColonyPopulationThreshold = parseIntValue(value); break;
        case 'ConstructionSpaceportMinimumDistance': policy.constructionSpaceportMinimumDistance = parseIntValue(value); break;
        case 'ConstructionSpaceportSmallColonyPopulationThreshold': policy.constructionSpaceportSmallColonyPopulationThreshold = parseIntValue(value); break;
        case 'DiplomacySendGiftsUpToAmount': policy.diplomacySendGiftsUpToAmount = parseIntValue(value); break;
        case 'DiplomacyTradeSanctionsUseBlockades': policy.diplomacyTradeSanctionsUseBlockades = parseBoolValue(value); break;
        case 'EngageInTourism': policy.engageInTourism = parseBoolValue(value); break;
        case 'FleetMilitaryProportionForFleets': policy.fleetMilitaryProportionForFleets = parseFloatValue(value); break;
        case 'FleetStrikeForceTypicalSize': policy.fleetStrikeForceTypicalSize = parseIntValue(value); break;
        case 'FleetTypicalSize': policy.fleetTypicalSize = parseIntValue(value); break;
        case 'ImplementEnslavementWithPenalColonies': policy.implementEnslavementWithPenalColonies = parseBoolValue(value); break;
        case 'IntelligenceAllowMissionDeepCover': policy.intelligenceAllowMissionDeepCover = parseBoolValue(value); break;
        case 'IntelligenceAllowMissionInciteRevolution': policy.intelligenceAllowMissionInciteRevolution = parseBoolValue(value); break;
        case 'IntelligenceAllowMissionSabotageColony': policy.intelligenceAllowMissionSabotageColony = parseBoolValue(value); break;
        case 'IntelligenceAllowMissionSabotageConstruction': policy.intelligenceAllowMissionSabotageConstruction = parseBoolValue(value); break;
        case 'IntelligenceAllowMissionStealGalaxyMap': policy.intelligenceAllowMissionStealGalaxyMap = parseBoolValue(value); break;
        case 'IntelligenceAllowMissionStealOperationsMap': policy.intelligenceAllowMissionStealOperationsMap = parseBoolValue(value); break;
        case 'IntelligenceAllowMissionStealTechData': policy.intelligenceAllowMissionStealTechData = parseBoolValue(value); break;
        case 'IntelligenceAllowMissionStealTerritoryMap': policy.intelligenceAllowMissionStealTerritoryMap = parseBoolValue(value); break;
        case 'IntelligenceAllowMissionAssassinateCharacter': policy.intelligenceAllowMissionAssassinateCharacter = parseBoolValue(value); break;
        case 'IntelligenceAllowMissionDestroyBase': policy.intelligenceAllowMissionDestroyBase = parseBoolValue(value); break;
        case 'IntelligenceCounterIntelligenceProportion': policy.intelligenceCounterIntelligenceProportion = parseFloatValue(value); break;
        case 'IntelligenceUseEspionageAgainstEmpireWhen': policy.intelligenceUseEspionageAgainstEmpireWhen = parseIntValue(value); break;
        case 'IntelligenceUseSabotageAgainstEmpireWhen': policy.intelligenceUseSabotageAgainstEmpireWhen = parseIntValue(value); break;
        case 'NewColonyPopulationPolicyAllRaces': policy.newColonyPopulationPolicyAllRaces = parseColonyPopulationPolicyValue(value); break;
        case 'NewColonyPopulationPolicyYourRaceFamily': policy.newColonyPopulationPolicyYourRaceFamily = parseColonyPopulationPolicyValue(value); break;
        case 'ResearchDesignAutoRetrofit': policy.researchDesignAutoRetrofit = parseBoolValue(value); break;
        case 'ResearchDesignAutoUpgradeFighters': policy.researchDesignAutoUpgradeFighters = parseBoolValue(value); break;
        case 'ResearchDesignOverallFocus': {
            const intValue = parseIntValue(value);
            if (intValue === 0 || intValue === 1 || intValue === 2 || intValue === 3) {
                policy.researchDesignOverallFocus = intValue as ShipDesignFocus;
            }
            // default: C# returns without assigning (out-of-range values keep the previous value).
            return;
        }
        case 'ResearchDesignTechFocus1': setTechFocusSlot(policy, 1, value); break;
        case 'ResearchDesignTechFocus2': setTechFocusSlot(policy, 2, value); break;
        case 'TradeWithOtherEmpires': policy.tradeWithOtherEmpires = parseBoolValue(value); break;
        case 'WarAttacksAllowColonyBombardment': policy.warAttacksAllowColonyBombardment = parseIntValue(value); break;
        case 'WarAttacksAllowPlanetDestroying': policy.warAttacksAllowPlanetDestroying = parseIntValue(value); break;
        case 'WarAttacksHarassEnemies': policy.warAttacksHarassEnemies = parseBoolValue(value); break;
        case 'HomeworldDefensePriority': policy.homeworldDefensePriority = clampPriority(value); break;
        case 'ColonizeContinentalPriority': policy.colonizeContinentalPriority = clampPriority(value); break;
        case 'ColonizeMarshySwampPriority': policy.colonizeMarshySwampPriority = clampPriority(value); break;
        case 'ColonizeOceanPriority': policy.colonizeOceanPriority = clampPriority(value); break;
        case 'ColonizeDesertPriority': policy.colonizeDesertPriority = clampPriority(value); break;
        case 'ColonizeIcePriority': policy.colonizeIcePriority = clampPriority(value); break;
        case 'ColonizeVolcanicPriority': policy.colonizeVolcanicPriority = clampPriority(value); break;
        case 'ColonizeRuinsPriority': policy.colonizeRuinsPriority = clampPriority(value); break;
        case 'ControlRestrictedResourcesPriority': policy.controlRestrictedResourcesPriority = clampPriority(value); break;
        case 'ResearchPriority': policy.researchPriority = clampPriority(value); break;
        case 'TradePriority': policy.tradePriority = clampPriority(value); break;
        case 'AlliancePriority': policy.alliancePriority = clampPriority(value); break;
        case 'SubjugationPriority': policy.subjugationPriority = clampPriority(value); break;
        case 'TourismPriority': policy.tourismPriority = clampPriority(value); break;
        case 'ExplorationPriority': policy.explorationPriority = clampPriority(value); break;
        case 'WarWillingness': policy.warWillingness = clampPriority(value); break;
        case 'BreakTreatyWillingness': policy.breakTreatyWillingness = clampPriority(value); break;
        case 'InvasionOverkillFactor': policy.invasionOverkillFactor = clampPriority(value); break;
        case 'ShipBattleCautionFactor': policy.shipBattleCautionFactor = clampPriority(value); break;
        case 'ProtectLeaderAtAllCosts': policy.protectLeaderAtAllCosts = parseBoolValue(value); break;
        case 'PrioritizeBuildWonderId': policy.prioritizeBuildWonderId = parseIntValue(value); break;
        case 'ResearchIndustryFocus': policy.researchIndustryFocus = parseIndustryValue(value); break;
        case 'DefaultMilitaryFleeWhen': policy.defaultMilitaryFleeWhen = parseFleeWhenValue(value); break;
        case 'DesignUpgradeEscort': policy.designUpgradeEscort = parseBoolValue(value); break;
        case 'DesignUpgradeFrigate': policy.designUpgradeFrigate = parseBoolValue(value); break;
        case 'DesignUpgradeDestroyer': policy.designUpgradeDestroyer = parseBoolValue(value); break;
        case 'DesignUpgradeCruiser': policy.designUpgradeCruiser = parseBoolValue(value); break;
        case 'DesignUpgradeCapitalShip': policy.designUpgradeCapitalShip = parseBoolValue(value); break;
        case 'DesignUpgradeTroopTransport': policy.designUpgradeTroopTransport = parseBoolValue(value); break;
        case 'DesignUpgradeCarrier': policy.designUpgradeCarrier = parseBoolValue(value); break;
        case 'DesignUpgradeResupplyShip': policy.designUpgradeResupplyShip = parseBoolValue(value); break;
        case 'DesignUpgradeExplorationShip': policy.designUpgradeExplorationShip = parseBoolValue(value); break;
        case 'DesignUpgradeColonyShip': policy.designUpgradeColonyShip = parseBoolValue(value); break;
        case 'DesignUpgradeConstructionShip': policy.designUpgradeConstructionShip = parseBoolValue(value); break;
        case 'DesignUpgradeSmallSpacePort': policy.designUpgradeSmallSpacePort = parseBoolValue(value); break;
        case 'DesignUpgradeMediumSpacePort': policy.designUpgradeMediumSpacePort = parseBoolValue(value); break;
        case 'DesignUpgradeLargeSpacePort': policy.designUpgradeLargeSpacePort = parseBoolValue(value); break;
        case 'DesignUpgradeResortBase': policy.designUpgradeResortBase = parseBoolValue(value); break;
        case 'DesignUpgradeGenericBase': policy.designUpgradeGenericBase = parseBoolValue(value); break;
        case 'DesignUpgradeEnergyResearchStation': policy.designUpgradeEnergyResearchStation = parseBoolValue(value); break;
        case 'DesignUpgradeWeaponsResearchStation': policy.designUpgradeWeaponsResearchStation = parseBoolValue(value); break;
        case 'DesignUpgradeHighTechResearchStation': policy.designUpgradeHighTechResearchStation = parseBoolValue(value); break;
        case 'DesignUpgradeMonitoringStation': policy.designUpgradeMonitoringStation = parseBoolValue(value); break;
        case 'DesignUpgradeDefensiveBase': policy.designUpgradeDefensiveBase = parseBoolValue(value); break;
        case 'DesignUpgradeSmallFreighter': policy.designUpgradeSmallFreighter = parseBoolValue(value); break;
        case 'DesignUpgradeMediumFreighter': policy.designUpgradeMediumFreighter = parseBoolValue(value); break;
        case 'DesignUpgradeLargeFreighter': policy.designUpgradeLargeFreighter = parseBoolValue(value); break;
        case 'DesignUpgradePassengerShip': policy.designUpgradePassengerShip = parseBoolValue(value); break;
        case 'DesignUpgradeGasMiningShip': policy.designUpgradeGasMiningShip = parseBoolValue(value); break;
        case 'DesignUpgradeMiningShip': policy.designUpgradeMiningShip = parseBoolValue(value); break;
        case 'DesignUpgradeGasMiningStation': policy.designUpgradeGasMiningStation = parseBoolValue(value); break;
        case 'DesignUpgradeMiningStation': policy.designUpgradeMiningStation = parseBoolValue(value); break;
        case 'ResearchDesignTechFocus3': setTechFocusSlot(policy, 3, value); break;
        case 'ResearchDesignTechFocus4': setTechFocusSlot(policy, 4, value); break;
        case 'ResearchDesignTechFocus5': setTechFocusSlot(policy, 5, value); break;
        case 'ResearchDesignTechFocus6': setTechFocusSlot(policy, 6, value); break;
        case 'CaptureTargetConditionShip': policy.captureTargetConditionShip = parseIntValue(value); break;
        case 'CaptureTargetConditionBase': policy.captureTargetConditionBase = parseIntValue(value); break;
        case 'OfferPirateAttackMissions': policy.offerPirateAttackMissions = parseIntValue(value); break;
        case 'BidOnPirateAttackMissions': policy.bidOnPirateAttackMissions = parseBoolValue(value); break;
        case 'BidOnPirateDefendMissions': policy.bidOnPirateDefendMissions = parseBoolValue(value); break;
        case 'AcceptPirateSmugglingMissions': policy.acceptPirateSmugglingMissions = parseBoolValue(value); break;
        case 'OfferDefensivePirateMissionsSituation': policy.offerDefensivePirateMissionsSituation = parseIntValue(value); break;
        case 'OfferSmugglingPirateMissions': policy.offerSmugglingPirateMissions = parseIntValue(value); break;
        case 'CaptureEnlistMilitaryShip': policy.captureEnlistMilitaryShip = parseIntValue(value); break;
        case 'CaptureDisassembleMilitaryShip': policy.captureDisassembleMilitaryShip = parseIntValue(value); break;
        case 'CaptureEnlistCivilianShip': policy.captureEnlistCivilianShip = parseIntValue(value); break;
        case 'CaptureDisassembleCivilianShip': policy.captureDisassembleCivilianShip = parseIntValue(value); break;
        case 'CaptureEnlistBase': policy.captureEnlistBase = parseIntValue(value); break;
        case 'UpgradeEnlistedMilitaryShips': policy.upgradeEnlistedMilitaryShips = parseBoolValue(value); break;
        case 'UpgradeEnlistedCivilianShips': policy.upgradeEnlistedCivilianShips = parseBoolValue(value); break;
        case 'OfferDefensivePirateMissions': policy.offerDefensivePirateMissions = parseIntValue(value); break;
        case 'PirateSmugglerFreighterLevel': policy.pirateSmugglerFreighterLevel = parseDoubleValue(value); break;
        case 'PirateSmugglerMiningLevel': policy.pirateSmugglerMiningLevel = parseDoubleValue(value); break;
        case 'PirateSmugglerPassengerLevel': policy.pirateSmugglerPassengerLevel = parseDoubleValue(value); break;
        case 'TroopRecruitInfantryLevel': policy.troopRecruitInfantryLevel = parseDoubleValue(value); break;
        case 'TroopRecruitArmorLevel': policy.troopRecruitArmorLevel = parseDoubleValue(value); break;
        case 'TroopRecruitArtilleryLevel': policy.troopRecruitArtilleryLevel = parseDoubleValue(value); break;
        case 'TroopRecruitSpecialForcesLevel': policy.troopRecruitSpecialForcesLevel = parseDoubleValue(value); break;
        case 'TroopUseDefaultTransportLoadout': policy.troopUseDefaultTransportLoadout = parseBoolValue(value); break;
        case 'TroopDefaultTransportLoadoutInfantry': policy.troopDefaultTransportLoadoutInfantry = parseFloatValue(value); break;
        case 'TroopDefaultTransportLoadoutArmor': policy.troopDefaultTransportLoadoutArmor = parseFloatValue(value); break;
        case 'TroopDefaultTransportLoadoutArtillery': policy.troopDefaultTransportLoadoutArtillery = parseFloatValue(value); break;
        case 'TroopDefaultTransportLoadoutSpecialForces': policy.troopDefaultTransportLoadoutSpecialForces = parseFloatValue(value); break;
        case 'TroopGarrisonMinimumPerColony': policy.troopGarrisonMinimumPerColony = parseIntValue(value); break;
        case 'TroopGarrisonLevel': policy.troopGarrisonLevel = parseDoubleValue(value); break;
        case 'UseExplorationShipsToScoutEnemySystems': policy.useExplorationShipsToScoutEnemySystems = parseBoolValue(value); break;
        case 'BuildPlanetDestroyers': policy.buildPlanetDestroyers = parseBoolValue(value); break;
        default: break;
    }
}

// Port of EmpirePolicy.LoadFromFile: "name ;value" lines, "'" comments.
export function parseEmpirePolicy(text: string): EmpirePolicy {
    const policy = defaultEmpirePolicy();
    applyEmpirePolicyText(policy, text);
    return policy;
}

/** EmpirePolicy.cs 229 LoadFromFile's line loop: each "name ;value" line through SetNameValuePair, in file order. */
function applyEmpirePolicyText(policy: EmpirePolicy, text: string): void {
    for (const line of text.split(/\r?\n/)) {
        if (line.trim() === '' || line.trim().substring(0, 1) === "'") continue;
        const i = line.indexOf(';');
        if (i < 0) continue;
        const name = line.substring(0, i).trim();
        const value = line.substring(i + 1).trim();
        setNameValuePair(policy, name, value);
    }
}

// Port of Galaxy.4.cs ResolveTechFocuses(policy): category wins over type per slot.
export function resolveTechFocuses(policy: EmpirePolicy | null): { categories: ComponentCategoryType[]; types: ComponentType[] } {
    const categories: ComponentCategoryType[] = [];
    const types: ComponentType[] = [];
    if (policy !== null) {
        for (const f of policy.researchDesignTechFocus) {
            if (f.category !== ComponentCategoryType.Undefined) categories.push(f.category);
            else if (f.type !== ComponentType.Undefined) types.push(f.type);
        }
    }
    return { categories, types };
}

// Port of Galaxy.4.cs:490-545 ResolveTechFocusIndex(ComponentType).
export function resolveTechFocusIndexType(type: ComponentType): number {
    switch (type) {
        case ComponentType.WeaponPhaser: return 2;
        case ComponentType.WeaponRailGun: return 3;
        case ComponentType.WeaponBombard: return 5;
        case ComponentType.WeaponMissile: return 6;
        case ComponentType.Armor: return 10;
        case ComponentType.EngineMainThrust: return 13;
        case ComponentType.EngineVectoring: return 14;
        case ComponentType.DamageControl: return 18;
        case ComponentType.ComputerTargetting: return 19;
        case ComponentType.ComputerCountermeasures: return 20;
        case ComponentType.HabitationMedicalCenter: return 22;
        case ComponentType.HabitationRecreationCenter: return 23;
        case ComponentType.WeaponTractorBeam: return 24;
        case ComponentType.AssaultPod: return 25;
        case ComponentType.WeaponGravityBeam: return 26;
        case ComponentType.WeaponAreaGravity: return 27;
        default: return 0;
    }
}

// Port of Galaxy.4.cs:547-590 ResolveTechFocusIndex(ComponentCategoryType).
export function resolveTechFocusIndexCategory(category: ComponentCategoryType): number {
    switch (category) {
        case ComponentCategoryType.WeaponBeam: return 1;
        case ComponentCategoryType.WeaponTorpedo: return 4;
        case ComponentCategoryType.WeaponArea: return 7;
        case ComponentCategoryType.WeaponIon: return 8;
        case ComponentCategoryType.Fighter: return 9;
        case ComponentCategoryType.Shields: return 11;
        case ComponentCategoryType.Reactor: return 12;
        case ComponentCategoryType.HyperDrive: return 15;
        case ComponentCategoryType.HyperDisrupt: return 16;
        case ComponentCategoryType.Construction: return 17;
        case ComponentCategoryType.Sensor: return 21;
        case ComponentCategoryType.AssaultPod: return 25;
        default: return 0;
    }
}

/** .NET Framework `ToString("G", InvariantCulture)` of a float (7 significant digits) / double (15): the shortest
 *  rounded text, scientific ("E+XX") when the exponent is >= the precision or < -5. */
function netGeneral(value: number, precision: number): string {
    if (value === 0 || !Number.isFinite(value)) return value === 0 ? '0' : String(value);
    const rounded = Number(value.toPrecision(precision));
    const exponent = Math.floor(Math.log10(Math.abs(rounded)));
    if (exponent >= precision || exponent < -5) {
        const [m, e] = rounded.toExponential(precision - 1).split('e');
        const mantissa = m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m;
        const n = Number(e);
        return `${mantissa}E${n < 0 ? '-' : '+'}${String(Math.abs(n)).padStart(2, '0')}`;
    }
    return String(rounded);
}

type PolicyFileKind = 'bool' | 'int' | 'float' | 'double' | 'enum';
type PolicyFileField = readonly [name: string, field: keyof EmpirePolicy, kind: PolicyFileKind] | readonly [name: string, field: 'tech', slot: `tech${1 | 2 | 3 | 4 | 5 | 6}`];

/** EmpirePolicy.cs 840 SaveToFile: the lines it writes, in its order (file name, field, BuildPolicyLine value type). */
const POLICY_FILE_FIELDS: readonly PolicyFileField[] = [
    ['ImmediatelyRecruitNewTroopsWhenColonize', 'colonyActionForNewTroopRecruitment', 'bool'],
    ['ColonyAllowFacilityCloningFacility', 'colonyAllowFacilityCloningFacility', 'bool'],
    ['ColonyAllowFacilityFortifiedBunker', 'colonyAllowFacilityFortifiedBunker', 'bool'],
    ['ColonyAllowFacilityGiantIonCannon', 'colonyAllowFacilityGiantIonCannon', 'bool'],
    ['ColonyAllowFacilityPlanetaryShield', 'colonyAllowFacilityPlanetaryShield', 'bool'],
    ['ColonyAllowFacilityRegionalCapital', 'colonyAllowFacilityRegionalCapital', 'bool'],
    ['ColonyAllowFacilityRoboticTroopFoundry', 'colonyAllowFacilityRoboticTroopFoundry', 'bool'],
    ['ColonyAllowFacilityTerraformingFacility', 'colonyAllowFacilityTerraformingFacility', 'bool'],
    ['ColonyAllowFacilityTroopTrainingCenter', 'colonyAllowFacilityTroopTrainingCenter', 'bool'],
    ['ColonyAllowFacilityArmoredFactory', 'colonyAllowFacilityArmoredFactory', 'bool'],
    ['ColonyAllowFacilitySpyAcademy', 'colonyAllowFacilitySpyAcademy', 'bool'],
    ['ColonyAllowFacilityScienceAcademy', 'colonyAllowFacilityScienceAcademy', 'bool'],
    ['ColonyAllowFacilityNavalAcademy', 'colonyAllowFacilityNavalAcademy', 'bool'],
    ['ColonyAllowFacilityMilitaryAcademy', 'colonyAllowFacilityMilitaryAcademy', 'bool'],
    ['ColonyFacilityPopulationThresholdCloningFacility', 'colonyFacilityPopulationThresholdCloningFacility', 'int'],
    ['ColonyFacilityPopulationThresholdFortifiedBunker', 'colonyFacilityPopulationThresholdFortifiedBunker', 'int'],
    ['ColonyFacilityPopulationThresholdGiantIonCannon', 'colonyFacilityPopulationThresholdGiantIonCannon', 'int'],
    ['ColonyFacilityPopulationThresholdPlanetaryShield', 'colonyFacilityPopulationThresholdPlanetaryShield', 'int'],
    ['ColonyFacilityPopulationThresholdRegionalCapital', 'colonyFacilityPopulationThresholdRegionalCapital', 'int'],
    ['ColonyFacilityPopulationThresholdRoboticTroopFoundry', 'colonyFacilityPopulationThresholdRoboticTroopFoundry', 'int'],
    ['ColonyFacilityPopulationThresholdTerraformingFacility', 'colonyFacilityPopulationThresholdTerraformingFacility', 'int'],
    ['ColonyFacilityPopulationThresholdTroopTrainingCenter', 'colonyFacilityPopulationThresholdTroopTrainingCenter', 'int'],
    ['ColonyFacilityPopulationThresholdArmoredFactory', 'colonyFacilityPopulationThresholdArmoredFactory', 'int'],
    ['ColonyFacilityPopulationThresholdSpyAcademy', 'colonyFacilityPopulationThresholdSpyAcademy', 'int'],
    ['ColonyFacilityPopulationThresholdScienceAcademy', 'colonyFacilityPopulationThresholdScienceAcademy', 'int'],
    ['ColonyFacilityPopulationThresholdNavalAcademy', 'colonyFacilityPopulationThresholdNavalAcademy', 'int'],
    ['ColonyFacilityPopulationThresholdMilitaryAcademy', 'colonyFacilityPopulationThresholdMilitaryAcademy', 'int'],
    ['ColonyPopulationThresholdTroopRecruitment', 'colonyPopulationThresholdTroopRecruitment', 'int'],
    ['ColonyTaxRateIncreaseWhenAtWar', 'colonyTaxRateIncreaseWhenAtWar', 'bool'],
    ['ColonyTaxRateLargeColony', 'colonyTaxRateLargeColony', 'int'],
    ['ColonyTaxRateMediumColony', 'colonyTaxRateMediumColony', 'int'],
    ['ColonyTaxRateSmallColony', 'colonyTaxRateSmallColony', 'int'],
    ['MilitaryConstructionLevel', 'constructionMilitary', 'int'],
    ['ConstructionMilitaryCapitalShip', 'constructionMilitaryCapitalShip', 'float'],
    ['ConstructionMilitaryCarrier', 'constructionMilitaryCarrier', 'float'],
    ['ConstructionMilitaryCruiser', 'constructionMilitaryCruiser', 'float'],
    ['ConstructionMilitaryDestroyer', 'constructionMilitaryDestroyer', 'float'],
    ['ConstructionMilitaryEscort', 'constructionMilitaryEscort', 'float'],
    ['ConstructionMilitaryFrigate', 'constructionMilitaryFrigate', 'float'],
    ['ConstructionMilitaryTroopTransport', 'constructionMilitaryTroopTransport', 'float'],
    ['ConstructionSpaceportLargeColonyPopulationThreshold', 'constructionSpaceportLargeColonyPopulationThreshold', 'int'],
    ['ConstructionSpaceportMediumColonyPopulationThreshold', 'constructionSpaceportMediumColonyPopulationThreshold', 'int'],
    ['ConstructionSpaceportSmallColonyPopulationThreshold', 'constructionSpaceportSmallColonyPopulationThreshold', 'int'],
    ['ConstructionSpaceportMinimumDistance', 'constructionSpaceportMinimumDistance', 'int'],
    ['DiplomacySendGiftsUpToAmount', 'diplomacySendGiftsUpToAmount', 'int'],
    ['DiplomacyTradeSanctionsUseBlockades', 'diplomacyTradeSanctionsUseBlockades', 'bool'],
    ['FleetMilitaryProportionForFleets', 'fleetMilitaryProportionForFleets', 'float'],
    ['FleetStrikeForceTypicalSize', 'fleetStrikeForceTypicalSize', 'int'],
    ['FleetTypicalSize', 'fleetTypicalSize', 'int'],
    ['IntelligenceAllowMissionDeepCover', 'intelligenceAllowMissionDeepCover', 'bool'],
    ['IntelligenceAllowMissionInciteRevolution', 'intelligenceAllowMissionInciteRevolution', 'bool'],
    ['IntelligenceAllowMissionSabotageColony', 'intelligenceAllowMissionSabotageColony', 'bool'],
    ['IntelligenceAllowMissionSabotageConstruction', 'intelligenceAllowMissionSabotageConstruction', 'bool'],
    ['IntelligenceAllowMissionStealGalaxyMap', 'intelligenceAllowMissionStealGalaxyMap', 'bool'],
    ['IntelligenceAllowMissionStealOperationsMap', 'intelligenceAllowMissionStealOperationsMap', 'bool'],
    ['IntelligenceAllowMissionStealTechData', 'intelligenceAllowMissionStealTechData', 'bool'],
    ['IntelligenceAllowMissionStealTerritoryMap', 'intelligenceAllowMissionStealTerritoryMap', 'bool'],
    ['IntelligenceAllowMissionAssassinateCharacter', 'intelligenceAllowMissionAssassinateCharacter', 'bool'],
    ['IntelligenceAllowMissionDestroyBase', 'intelligenceAllowMissionDestroyBase', 'bool'],
    ['IntelligenceCounterIntelligenceProportion', 'intelligenceCounterIntelligenceProportion', 'float'],
    ['IntelligenceUseEspionageAgainstEmpireWhen', 'intelligenceUseEspionageAgainstEmpireWhen', 'int'],
    ['IntelligenceUseSabotageAgainstEmpireWhen', 'intelligenceUseSabotageAgainstEmpireWhen', 'int'],
    ['ResearchDesignAutoRetrofit', 'researchDesignAutoRetrofit', 'bool'],
    ['ResearchDesignOverallFocus', 'researchDesignOverallFocus', 'enum'],
    ['ResearchDesignTechFocus1', 'tech', 'tech1'],
    ['ResearchDesignTechFocus2', 'tech', 'tech2'],
    ['ResearchDesignTechFocus3', 'tech', 'tech3'],
    ['ResearchDesignTechFocus4', 'tech', 'tech4'],
    ['ResearchDesignTechFocus5', 'tech', 'tech5'],
    ['ResearchDesignTechFocus6', 'tech', 'tech6'],
    ['ResearchDesignAutoUpgradeFighters', 'researchDesignAutoUpgradeFighters', 'bool'],
    ['WarAttacksAllowColonyBombardment', 'warAttacksAllowColonyBombardment', 'int'],
    ['WarAttacksAllowPlanetDestroying', 'warAttacksAllowPlanetDestroying', 'int'],
    ['WarAttacksHarassEnemies', 'warAttacksHarassEnemies', 'bool'],
    ['TradeWithOtherEmpires', 'tradeWithOtherEmpires', 'bool'],
    ['EngageInTourism', 'engageInTourism', 'bool'],
    ['NewColonyPopulationPolicyYourRaceFamily', 'newColonyPopulationPolicyYourRaceFamily', 'enum'],
    ['NewColonyPopulationPolicyAllRaces', 'newColonyPopulationPolicyAllRaces', 'enum'],
    ['ImplementEnslavementWithPenalColonies', 'implementEnslavementWithPenalColonies', 'bool'],
    ['HomeworldDefensePriority', 'homeworldDefensePriority', 'double'],
    ['ProtectLeaderAtAllCosts', 'protectLeaderAtAllCosts', 'bool'],
    ['PrioritizeBuildWonderId', 'prioritizeBuildWonderId', 'int'],
    ['ColonizeContinentalPriority', 'colonizeContinentalPriority', 'double'],
    ['ColonizeMarshySwampPriority', 'colonizeMarshySwampPriority', 'double'],
    ['ColonizeOceanPriority', 'colonizeOceanPriority', 'double'],
    ['ColonizeDesertPriority', 'colonizeDesertPriority', 'double'],
    ['ColonizeIcePriority', 'colonizeIcePriority', 'double'],
    ['ColonizeVolcanicPriority', 'colonizeVolcanicPriority', 'double'],
    ['ColonizeRuinsPriority', 'colonizeRuinsPriority', 'double'],
    ['ControlRestrictedResourcesPriority', 'controlRestrictedResourcesPriority', 'double'],
    ['ResearchIndustryFocus', 'researchIndustryFocus', 'enum'],
    ['ResearchPriority', 'researchPriority', 'double'],
    ['TradePriority', 'tradePriority', 'double'],
    ['AlliancePriority', 'alliancePriority', 'double'],
    ['SubjugationPriority', 'subjugationPriority', 'double'],
    ['TourismPriority', 'tourismPriority', 'double'],
    ['ExplorationPriority', 'explorationPriority', 'double'],
    ['WarWillingness', 'warWillingness', 'double'],
    ['BreakTreatyWillingness', 'breakTreatyWillingness', 'double'],
    ['InvasionOverkillFactor', 'invasionOverkillFactor', 'double'],
    ['ShipBattleCautionFactor', 'shipBattleCautionFactor', 'double'],
    ['DefaultMilitaryFleeWhen', 'defaultMilitaryFleeWhen', 'enum'],
    ['DesignUpgradeEscort', 'designUpgradeEscort', 'bool'],
    ['DesignUpgradeFrigate', 'designUpgradeFrigate', 'bool'],
    ['DesignUpgradeDestroyer', 'designUpgradeDestroyer', 'bool'],
    ['DesignUpgradeCruiser', 'designUpgradeCruiser', 'bool'],
    ['DesignUpgradeCapitalShip', 'designUpgradeCapitalShip', 'bool'],
    ['DesignUpgradeTroopTransport', 'designUpgradeTroopTransport', 'bool'],
    ['DesignUpgradeCarrier', 'designUpgradeCarrier', 'bool'],
    ['DesignUpgradeResupplyShip', 'designUpgradeResupplyShip', 'bool'],
    ['DesignUpgradeExplorationShip', 'designUpgradeExplorationShip', 'bool'],
    ['DesignUpgradeColonyShip', 'designUpgradeColonyShip', 'bool'],
    ['DesignUpgradeConstructionShip', 'designUpgradeConstructionShip', 'bool'],
    ['DesignUpgradeSmallSpacePort', 'designUpgradeSmallSpacePort', 'bool'],
    ['DesignUpgradeMediumSpacePort', 'designUpgradeMediumSpacePort', 'bool'],
    ['DesignUpgradeLargeSpacePort', 'designUpgradeLargeSpacePort', 'bool'],
    ['DesignUpgradeResortBase', 'designUpgradeResortBase', 'bool'],
    ['DesignUpgradeGenericBase', 'designUpgradeGenericBase', 'bool'],
    ['DesignUpgradeEnergyResearchStation', 'designUpgradeEnergyResearchStation', 'bool'],
    ['DesignUpgradeWeaponsResearchStation', 'designUpgradeWeaponsResearchStation', 'bool'],
    ['DesignUpgradeHighTechResearchStation', 'designUpgradeHighTechResearchStation', 'bool'],
    ['DesignUpgradeMonitoringStation', 'designUpgradeMonitoringStation', 'bool'],
    ['DesignUpgradeDefensiveBase', 'designUpgradeDefensiveBase', 'bool'],
    ['DesignUpgradeSmallFreighter', 'designUpgradeSmallFreighter', 'bool'],
    ['DesignUpgradeMediumFreighter', 'designUpgradeMediumFreighter', 'bool'],
    ['DesignUpgradeLargeFreighter', 'designUpgradeLargeFreighter', 'bool'],
    ['DesignUpgradePassengerShip', 'designUpgradePassengerShip', 'bool'],
    ['DesignUpgradeGasMiningShip', 'designUpgradeGasMiningShip', 'bool'],
    ['DesignUpgradeMiningShip', 'designUpgradeMiningShip', 'bool'],
    ['DesignUpgradeGasMiningStation', 'designUpgradeGasMiningStation', 'bool'],
    ['DesignUpgradeMiningStation', 'designUpgradeMiningStation', 'bool'],
    ['CaptureTargetConditionShip', 'captureTargetConditionShip', 'int'],
    ['CaptureTargetConditionBase', 'captureTargetConditionBase', 'int'],
    ['OfferPirateAttackMissions', 'offerPirateAttackMissions', 'int'],
    ['BidOnPirateAttackMissions', 'bidOnPirateAttackMissions', 'bool'],
    ['BidOnPirateDefendMissions', 'bidOnPirateDefendMissions', 'bool'],
    ['OfferDefensivePirateMissions', 'offerDefensivePirateMissions', 'int'],
    ['OfferDefensivePirateMissionsSituation', 'offerDefensivePirateMissionsSituation', 'int'],
    ['AcceptPirateSmugglingMissions', 'acceptPirateSmugglingMissions', 'bool'],
    ['OfferSmugglingPirateMissions', 'offerSmugglingPirateMissions', 'int'],
    ['PirateSmugglerFreighterLevel', 'pirateSmugglerFreighterLevel', 'double'],
    ['PirateSmugglerMiningLevel', 'pirateSmugglerMiningLevel', 'double'],
    ['PirateSmugglerPassengerLevel', 'pirateSmugglerPassengerLevel', 'double'],
    ['CaptureEnlistMilitaryShip', 'captureEnlistMilitaryShip', 'int'],
    ['CaptureDisassembleMilitaryShip', 'captureDisassembleMilitaryShip', 'int'],
    ['CaptureEnlistCivilianShip', 'captureEnlistCivilianShip', 'int'],
    ['CaptureDisassembleCivilianShip', 'captureDisassembleCivilianShip', 'int'],
    ['CaptureEnlistBase', 'captureEnlistBase', 'int'],
    ['UpgradeEnlistedMilitaryShips', 'upgradeEnlistedMilitaryShips', 'bool'],
    ['UpgradeEnlistedCivilianShips', 'upgradeEnlistedCivilianShips', 'bool'],
    ['TroopRecruitInfantryLevel', 'troopRecruitInfantryLevel', 'double'],
    ['TroopRecruitArmorLevel', 'troopRecruitArmorLevel', 'double'],
    ['TroopRecruitArtilleryLevel', 'troopRecruitArtilleryLevel', 'double'],
    ['TroopRecruitSpecialForcesLevel', 'troopRecruitSpecialForcesLevel', 'double'],
    ['TroopUseDefaultTransportLoadout', 'troopUseDefaultTransportLoadout', 'bool'],
    ['TroopDefaultTransportLoadoutInfantry', 'troopDefaultTransportLoadoutInfantry', 'float'],
    ['TroopDefaultTransportLoadoutArmor', 'troopDefaultTransportLoadoutArmor', 'float'],
    ['TroopDefaultTransportLoadoutArtillery', 'troopDefaultTransportLoadoutArtillery', 'float'],
    ['TroopDefaultTransportLoadoutSpecialForces', 'troopDefaultTransportLoadoutSpecialForces', 'float'],
    ['TroopGarrisonMinimumPerColony', 'troopGarrisonMinimumPerColony', 'int'],
    ['TroopGarrisonLevel', 'troopGarrisonLevel', 'double'],
    ['UseExplorationShipsToScoutEnemySystems', 'useExplorationShipsToScoutEnemySystems', 'bool'],
    ['BuildPlanetDestroyers', 'buildPlanetDestroyers', 'bool'],
];

/** EmpirePolicy.cs 1052 BuildPolicyLine(name, value): `name\t\t;value` (bool Y / N, numbers invariant, enums as int). */
function buildPolicyLine(name: string, value: number | boolean, kind: PolicyFileKind): string {
    let str = name + '\t\t;';
    switch (kind) {
        case 'bool':
            str += value ? 'Y' : 'N';
            break;
        case 'float':
            str += netGeneral(Math.fround(value as number), 7);
            break;
        case 'double':
            str += netGeneral(value as number, 15);
            break;
        default:
            str += String(Math.trunc(value as number));
            break;
    }
    return str;
}

/** EmpirePolicy.cs 840 SaveToFile: the policy file text (the header comment, a blank line, one line per setting).
 *  ColonyActionForNewBuildDesign (a Design) is not in the file, as in the C#. */
export function writeEmpirePolicyFile(policy: EmpirePolicy): string {
    const lines = ["'Distant Worlds - Empire Policy - 1.9.0.0", ''];
    for (const f of POLICY_FILE_FIELDS) {
        if (f[1] === 'tech') {
            const slot = Number(f[2].substring(4)) as 1 | 2 | 3 | 4 | 5 | 6;
            const category = policy[`researchDesignTechFocus${slot}`];
            const type = policy[`researchDesignTechFocusType${slot}`];
            // 916-921: the category's index, else the type's, else 0.
            let num = 0;
            if (category !== ComponentCategoryType.Undefined) num = resolveTechFocusIndexCategory(category);
            else if (type !== ComponentType.Undefined) num = resolveTechFocusIndexType(type);
            lines.push(buildPolicyLine(f[0], num, 'int'));
        } else {
            lines.push(buildPolicyLine(f[0], policy[f[1]] as number | boolean, f[2]));
        }
    }
    // StreamWriter.WriteLine ends every line with Environment.NewLine.
    return lines.map((l) => l + '\r\n').join('');
}

/** A copy of `policy` (EmpirePolicy.Clone: a field copy; the Design reference is shared). */
export function cloneEmpirePolicy(policy: EmpirePolicy): EmpirePolicy {
    return { ...policy, researchDesignTechFocus: policy.researchDesignTechFocus.map((f) => ({ ...f })) };
}

/** EmpirePolicy.cs 229 LoadFromFile on an existing policy (Main.Part3.cs btnEmpirePolicyLoad_Click:
 *  `PlayerEmpire.Policy.LoadFromFile(file)`): the file's settings over a copy of `current`; settings the file does not
 *  name keep their value (ColonyActionForNewBuildDesign among them). */
export function loadEmpirePolicyFile(current: EmpirePolicy, text: string): EmpirePolicy {
    const policy = cloneEmpirePolicy(current);
    applyEmpirePolicyText(policy, text);
    return policy;
}
