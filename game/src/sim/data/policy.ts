// Port of EmpirePolicy.cs (DistantWorlds.Types.EmpirePolicy, v1.9.5):
// the EmpirePolicy class fields and LoadFromFile / SetNameValuePair.
// Pure parsing — no fs. Handles UTF-8 BOM, `'`-comment lines, and CRLF.
//
// Enum-typed fields (ComponentCategoryType, ComponentType, ShipDesignFocus,
// IndustryType, BuiltObjectFleeWhen, ColonyPopulationPolicy) are represented
// as plain numbers holding the C# underlying values; the enums themselves are
// not yet ported into src/sim (see TODO(port) notes below).

export interface EmpirePolicy {
    // --- Intelligence ---
    intelligenceCounterIntelligenceProportion: number; // float = 30f
    intelligenceAllowMissionSabotageConstruction: boolean; // true
    intelligenceAllowMissionStealTerritoryMap: boolean; // true
    intelligenceAllowMissionStealGalaxyMap: boolean; // true
    intelligenceAllowMissionStealOperationsMap: boolean; // true
    intelligenceAllowMissionStealTechData: boolean; // true
    intelligenceAllowMissionSabotageColony: boolean; // true
    intelligenceAllowMissionDeepCover: boolean; // true
    intelligenceAllowMissionInciteRevolution: boolean; // true
    intelligenceAllowMissionAssassinateCharacter: boolean; // true
    intelligenceAllowMissionDestroyBase: boolean; // true
    intelligenceUseEspionageAgainstEmpireWhen: number; // int = 2
    intelligenceUseSabotageAgainstEmpireWhen: number; // int = 1

    // --- Diplomacy ---
    diplomacyTradeSanctionsUseBlockades: boolean; // true
    diplomacySendGiftsUpToAmount: number; // int = 20000

    // --- Colony ---
    colonyActionForNewTroopRecruitment: boolean; // [OptionalField] bool = false
    // TODO(port): C# `public Design ColonyActionForNewBuildDesign;` — a Design
    // reference that is never read by LoadFromFile/SetNameValuePair/SaveToFile
    // (only Clone copies it); needs the Design type before it can be modeled.
    colonyAllowFacilityTroopTrainingCenter: boolean; // true
    colonyAllowFacilityRoboticTroopFoundry: boolean; // true
    colonyAllowFacilityCloningFacility: boolean; // true
    colonyAllowFacilityPlanetaryShield: boolean; // true
    colonyAllowFacilityGiantIonCannon: boolean; // true
    colonyAllowFacilityFortifiedBunker: boolean; // true
    colonyAllowFacilityRegionalCapital: boolean; // true
    colonyAllowFacilityTerraformingFacility: boolean; // true
    colonyAllowFacilityArmoredFactory: boolean; // true
    colonyAllowFacilityMilitaryAcademy: boolean; // true
    colonyAllowFacilitySpyAcademy: boolean; // true
    colonyAllowFacilityNavalAcademy: boolean; // true
    colonyAllowFacilityScienceAcademy: boolean; // true
    colonyFacilityPopulationThresholdTroopTrainingCenter: number; // 500
    colonyFacilityPopulationThresholdRoboticTroopFoundry: number; // 500
    colonyFacilityPopulationThresholdCloningFacility: number; // 500
    colonyFacilityPopulationThresholdPlanetaryShield: number; // 2000
    colonyFacilityPopulationThresholdGiantIonCannon: number; // 5000
    colonyFacilityPopulationThresholdFortifiedBunker: number; // 500
    colonyFacilityPopulationThresholdRegionalCapital: number; // 5000
    colonyFacilityPopulationThresholdTerraformingFacility: number; // 500
    colonyFacilityPopulationThresholdArmoredFactory: number; // 500
    colonyFacilityPopulationThresholdMilitaryAcademy: number; // 2000
    colonyFacilityPopulationThresholdSpyAcademy: number; // 2000
    colonyFacilityPopulationThresholdNavalAcademy: number; // 5000
    colonyFacilityPopulationThresholdScienceAcademy: number; // 5000
    colonyTaxRateSmallColony: number; // int = 0
    colonyTaxRateMediumColony: number; // int = 2
    colonyTaxRateLargeColony: number; // int = 3
    colonyTaxRateIncreaseWhenAtWar: boolean; // true
    colonyPopulationThresholdTroopRecruitment: number; // int = 0

    // --- Research & design ---
    // TODO(port): C# field type is ShipDesignFocus (enum not yet ported);
    // stored as the enum's underlying int (0..3 valid per SetNameValuePair).
    researchDesignOverallFocus: number; // ShipDesignFocus = Undefined (0)
    // TODO(port): C# field types are ComponentCategoryType / ComponentType
    // (enums not yet ported); stored as underlying ints, resolved via
    // Galaxy.ResolveTechFocus (not yet ported either — see parse helper).
    researchDesignTechFocus1: number; // ComponentCategoryType = Undefined (0)
    researchDesignTechFocus2: number;
    researchDesignTechFocus3: number;
    researchDesignTechFocus4: number;
    researchDesignTechFocus5: number;
    researchDesignTechFocus6: number;
    researchDesignTechFocusType1: number; // ComponentType = Undefined (0)
    researchDesignTechFocusType2: number;
    researchDesignTechFocusType3: number;
    researchDesignTechFocusType4: number;
    researchDesignTechFocusType5: number;
    researchDesignTechFocusType6: number;
    researchDesignAutoRetrofit: boolean; // true
    researchDesignAutoUpgradeFighters: boolean; // true

    // --- Construction ---
    constructionMilitary: number; // int = 1
    constructionMilitaryEscort: number; // float = 18f
    constructionMilitaryFrigate: number; // float = 24f
    constructionMilitaryDestroyer: number; // float = 20f
    constructionMilitaryCruiser: number; // float = 15f
    constructionMilitaryCapitalShip: number; // float = 7f
    constructionMilitaryTroopTransport: number; // float = 8f
    constructionMilitaryCarrier: number; // float = 8f
    constructionSpaceportMinimumDistance: number; // int = 700
    constructionSpaceportSmallColonyPopulationThreshold: number; // int = 30
    constructionSpaceportMediumColonyPopulationThreshold: number; // int = 500
    constructionSpaceportLargeColonyPopulationThreshold: number; // int = 3000

    // --- War & fleets ---
    warAttacksAllowColonyBombardment: number; // int = 2
    warAttacksAllowPlanetDestroying: number; // int = 2
    warAttacksHarassEnemies: boolean; // true
    fleetTypicalSize: number; // int = 15
    fleetStrikeForceTypicalSize: number; // int = 4
    fleetMilitaryProportionForFleets: number; // float = 60f

    // --- General behavior ---
    tradeWithOtherEmpires: boolean; // true
    engageInTourism: boolean; // true
    // TODO(port): C# field type is ColonyPopulationPolicy (enum not yet
    // ported); stored as the enum's underlying int (byte.TryParse result).
    newColonyPopulationPolicyAllRaces: number; // ColonyPopulationPolicy = 0
    newColonyPopulationPolicyYourRaceFamily: number;
    implementEnslavementWithPenalColonies: boolean; // true
    homeworldDefensePriority: number; // double = 1.0
    protectLeaderAtAllCosts: boolean; // false
    prioritizeBuildWonderId: number; // int = -1
    colonizeContinentalPriority: number; // double = 1.0
    colonizeMarshySwampPriority: number; // double = 1.0
    colonizeOceanPriority: number; // double = 1.0
    colonizeDesertPriority: number; // double = 1.0
    colonizeIcePriority: number; // double = 1.0
    colonizeVolcanicPriority: number; // double = 1.0
    colonizeRuinsPriority: number; // double = 1.0
    controlRestrictedResourcesPriority: number; // double = 1.0
    // TODO(port): C# field type is IndustryType (partially ported in
    // types.ts); stored as the enum's underlying int here to keep this module
    // self-contained.
    researchIndustryFocus: number; // IndustryType = Undefined (0)
    researchPriority: number; // double = 1.0
    tradePriority: number; // double = 1.0
    alliancePriority: number; // double = 1.0
    subjugationPriority: number; // double = 1.0
    tourismPriority: number; // double = 1.0
    explorationPriority: number; // double = 1.0
    warWillingness: number; // double = 1.0
    breakTreatyWillingness: number; // double = 1.0
    invasionOverkillFactor: number; // double = 1.0
    shipBattleCautionFactor: number; // double = 1.0
    // TODO(port): C# field type is BuiltObjectFleeWhen (enum not yet ported);
    // stored as the enum's underlying int (default Shields20 = 20).
    defaultMilitaryFleeWhen: number; // BuiltObjectFleeWhen.Shields20 (20)

    // --- Design upgrades (all default true) ---
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

    // --- Capture / pirate missions ---
    captureTargetConditionShip: number; // int = 1
    captureTargetConditionBase: number; // int = 1
    offerPirateAttackMissions: number; // int = 2
    bidOnPirateAttackMissions: boolean; // true
    captureEnlistMilitaryShip: number; // int = 0
    captureDisassembleMilitaryShip: number; // int = 1
    captureEnlistCivilianShip: number; // int = 2
    captureDisassembleCivilianShip: number; // int = 1
    captureEnlistBase: number; // int = 0
    upgradeEnlistedMilitaryShips: boolean; // true
    upgradeEnlistedCivilianShips: boolean; // true
    offerDefensivePirateMissions: number; // int = 2
    pirateSmugglerFreighterLevel: number; // double = 1.0
    pirateSmugglerMiningLevel: number; // double = 1.0
    pirateSmugglerPassengerLevel: number; // double = 1.0
    bidOnPirateDefendMissions: boolean; // true
    acceptPirateSmugglingMissions: boolean; // true
    offerDefensivePirateMissionsSituation: number; // int = 2
    offerSmugglingPirateMissions: number; // int = 2

    // --- Troops ---
    troopRecruitInfantryLevel: number; // double = 1.0
    troopRecruitArmorLevel: number; // double = 1.0
    troopRecruitArtilleryLevel: number; // double = 1.0
    troopRecruitSpecialForcesLevel: number; // double = 1.0
    troopUseDefaultTransportLoadout: boolean; // true
    troopDefaultTransportLoadoutInfantry: number; // float = 0.25f
    troopDefaultTransportLoadoutArmor: number; // float = 0.5f
    troopDefaultTransportLoadoutArtillery: number; // float = 0f
    troopDefaultTransportLoadoutSpecialForces: number; // float = 0.25f
    troopGarrisonMinimumPerColony: number; // int = 0
    troopGarrisonLevel: number; // double = 1.0

    // --- Misc ---
    useExplorationShipsToScoutEnemySystems: boolean; // true
    buildPlanetDestroyers: boolean; // false
}

// Defaults exactly as initialized in the C# class (fields without an
// initializer get the C# zero value for their type).
export function createEmpirePolicy(): EmpirePolicy {
    return {
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

        researchDesignOverallFocus: 0,
        researchDesignTechFocus1: 0,
        researchDesignTechFocus2: 0,
        researchDesignTechFocus3: 0,
        researchDesignTechFocus4: 0,
        researchDesignTechFocus5: 0,
        researchDesignTechFocus6: 0,
        researchDesignTechFocusType1: 0,
        researchDesignTechFocusType2: 0,
        researchDesignTechFocusType3: 0,
        researchDesignTechFocusType4: 0,
        researchDesignTechFocusType5: 0,
        researchDesignTechFocusType6: 0,
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
        newColonyPopulationPolicyAllRaces: 0,
        newColonyPopulationPolicyYourRaceFamily: 0,
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
        researchIndustryFocus: 0,
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
        // BuiltObjectFleeWhen.Shields20 (enum not yet ported; underlying value 20).
        defaultMilitaryFleeWhen: 20,

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

function stripBom(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// Port of EmpirePolicy.ParseIntValue: int.TryParse(value, NumberStyles.Any,
// InvariantCulture) — on failure the C# out value stays 0. JS parseInt
// accepts a leading integer prefix ("12.5" -> 12) where C# fails outright,
// so reject any non-digit remainder and coerce NaN back to 0.
function parseIntValue(value: string): number {
    const trimmed = value.trim();
    const match = /^-?\d+$/.exec(trimmed);
    if (match === null) {
        return 0;
    }
    const n = parseInt(match[0], 10);
    return Number.isNaN(n) ? 0 : n;
}

// Port of EmpirePolicy.ParseFloatValue (float.TryParse, InvariantCulture).
function parseFloatValue(value: string): number {
    const n = parseFloat(value.trim());
    return Number.isNaN(n) ? 0 : n;
}

// Port of EmpirePolicy.ParseDoubleValue (double.TryParse, InvariantCulture).
function parseDoubleValue(value: string): number {
    const n = parseFloat(value.trim());
    return Number.isNaN(n) ? 0 : n;
}

// Port of EmpirePolicy.ParseBoolValue: true only for "y" (case-insensitive),
// false for "n" or anything else.
function parseBoolValue(value: string): boolean {
    return value.trim().toLowerCase() === 'y';
}

// Port of EmpirePolicy.ParseByteValue: byte.TryParse -> (ColonyPopulationPolicy)
// / (BuiltObjectFleeWhen). On failure the C# out value stays 0 (= Undefined).
// JS parseInt accepts a leading integer prefix where C# fails outright, so
// reject any non-digit remainder and values outside 0..255.
function parseByteValue(value: string): number {
    const match = /^\d+$/.exec(value.trim());
    if (match === null) {
        return 0;
    }
    const n = parseInt(match[0], 10);
    if (Number.isNaN(n) || n > 255) {
        return 0;
    }
    return n;
}

// Port of the priority clamping used by every *Priority / *Willingness /
// *Factor case in SetNameValuePair: Math.Max(0.5, Math.Min(4.0, v)).
function clampPriority(v: number): number {
    return Math.max(0.5, Math.min(4.0, v));
}

// Port of EmpirePolicy.LoadFromFile: line-by-line reader that skips null,
// empty, whitespace-only, and `'`-prefixed lines; each remaining line is
// split at the first ';' and both halves trimmed before SetNameValuePair.
// The C# method swallows all exceptions (a missing/unreadable file leaves
// the policy at its defaults); our pure-text equivalent simply parses what
// it is given.
export function parseEmpirePolicy(text: string): EmpirePolicy {
    const policy = createEmpirePolicy();
    const lines = stripBom(text).split(/\r\n|\r|\n/);
    for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (trimmed === '' || trimmed.substring(0, 1) === "'") {
            continue;
        }
        const length = rawLine.indexOf(';');
        if (length >= 0) {
            setNameValuePair(policy, rawLine.substring(0, length).trim(), rawLine.substring(length + 1).trim());
        }
    }
    return policy;
}

// Port of EmpirePolicy.SetNameValuePair: dispatches on the exact key names
// from the C# switch statement.
function setNameValuePair(policy: EmpirePolicy, name: string, value: string): void {
    switch (name) {
        case 'ImmediatelyRecruitNewTroopsWhenColonize':
            policy.colonyActionForNewTroopRecruitment = parseBoolValue(value);
            break;
        case 'ColonyAllowFacilityCloningFacility':
            policy.colonyAllowFacilityCloningFacility = parseBoolValue(value);
            break;
        case 'ColonyAllowFacilityFortifiedBunker':
            policy.colonyAllowFacilityFortifiedBunker = parseBoolValue(value);
            break;
        case 'ColonyAllowFacilityGiantIonCannon':
            policy.colonyAllowFacilityGiantIonCannon = parseBoolValue(value);
            break;
        case 'ColonyAllowFacilityPlanetaryShield':
            policy.colonyAllowFacilityPlanetaryShield = parseBoolValue(value);
            break;
        case 'ColonyAllowFacilityRegionalCapital':
            policy.colonyAllowFacilityRegionalCapital = parseBoolValue(value);
            break;
        case 'ColonyAllowFacilityTerraformingFacility':
            policy.colonyAllowFacilityTerraformingFacility = parseBoolValue(value);
            break;
        case 'ColonyAllowFacilityRoboticTroopFoundry':
            policy.colonyAllowFacilityRoboticTroopFoundry = parseBoolValue(value);
            break;
        case 'ColonyAllowFacilityTroopTrainingCenter':
            policy.colonyAllowFacilityTroopTrainingCenter = parseBoolValue(value);
            break;
        case 'ColonyAllowFacilityArmoredFactory':
            policy.colonyAllowFacilityArmoredFactory = parseBoolValue(value);
            break;
        case 'ColonyAllowFacilitySpyAcademy':
            policy.colonyAllowFacilitySpyAcademy = parseBoolValue(value);
            break;
        case 'ColonyAllowFacilityScienceAcademy':
            policy.colonyAllowFacilityScienceAcademy = parseBoolValue(value);
            break;
        case 'ColonyAllowFacilityNavalAcademy':
            policy.colonyAllowFacilityNavalAcademy = parseBoolValue(value);
            break;
        case 'ColonyAllowFacilityMilitaryAcademy':
            policy.colonyAllowFacilityMilitaryAcademy = parseBoolValue(value);
            break;
        case 'ColonyFacilityPopulationThresholdCloningFacility':
            policy.colonyFacilityPopulationThresholdCloningFacility = parseIntValue(value);
            break;
        case 'ColonyFacilityPopulationThresholdFortifiedBunker':
            policy.colonyFacilityPopulationThresholdFortifiedBunker = parseIntValue(value);
            break;
        case 'ColonyFacilityPopulationThresholdGiantIonCannon':
            policy.colonyFacilityPopulationThresholdGiantIonCannon = parseIntValue(value);
            break;
        case 'ColonyFacilityPopulationThresholdPlanetaryShield':
            policy.colonyFacilityPopulationThresholdPlanetaryShield = parseIntValue(value);
            break;
        case 'ColonyFacilityPopulationThresholdRegionalCapital':
            policy.colonyFacilityPopulationThresholdRegionalCapital = parseIntValue(value);
            break;
        case 'ColonyFacilityPopulationThresholdTerraformingFacility':
            policy.colonyFacilityPopulationThresholdTerraformingFacility = parseIntValue(value);
            break;
        case 'ColonyFacilityPopulationThresholdRoboticTroopFoundry':
            policy.colonyFacilityPopulationThresholdRoboticTroopFoundry = parseIntValue(value);
            break;
        case 'ColonyFacilityPopulationThresholdTroopTrainingCenter':
            policy.colonyFacilityPopulationThresholdTroopTrainingCenter = parseIntValue(value);
            break;
        case 'ColonyFacilityPopulationThresholdArmoredFactory':
            policy.colonyFacilityPopulationThresholdArmoredFactory = parseIntValue(value);
            break;
        case 'ColonyFacilityPopulationThresholdSpyAcademy':
            policy.colonyFacilityPopulationThresholdSpyAcademy = parseIntValue(value);
            break;
        case 'ColonyFacilityPopulationThresholdScienceAcademy':
            policy.colonyFacilityPopulationThresholdScienceAcademy = parseIntValue(value);
            break;
        case 'ColonyFacilityPopulationThresholdNavalAcademy':
            policy.colonyFacilityPopulationThresholdNavalAcademy = parseIntValue(value);
            break;
        case 'ColonyFacilityPopulationThresholdMilitaryAcademy':
            policy.colonyFacilityPopulationThresholdMilitaryAcademy = parseIntValue(value);
            break;
        case 'ColonyPopulationThresholdTroopRecruitment':
            policy.colonyPopulationThresholdTroopRecruitment = parseIntValue(value);
            break;
        case 'ColonyTaxRateIncreaseWhenAtWar':
            policy.colonyTaxRateIncreaseWhenAtWar = parseBoolValue(value);
            break;
        case 'ColonyTaxRateLargeColony':
            policy.colonyTaxRateLargeColony = parseIntValue(value);
            break;
        case 'ColonyTaxRateMediumColony':
            policy.colonyTaxRateMediumColony = parseIntValue(value);
            break;
        case 'ColonyTaxRateSmallColony':
            policy.colonyTaxRateSmallColony = parseIntValue(value);
            break;
        case 'MilitaryConstructionLevel':
            policy.constructionMilitary = parseIntValue(value);
            break;
        case 'ConstructionMilitaryCapitalShip':
            policy.constructionMilitaryCapitalShip = parseFloatValue(value);
            break;
        case 'ConstructionMilitaryCarrier':
            policy.constructionMilitaryCarrier = parseFloatValue(value);
            break;
        case 'ConstructionMilitaryCruiser':
            policy.constructionMilitaryCruiser = parseFloatValue(value);
            break;
        case 'ConstructionMilitaryDestroyer':
            policy.constructionMilitaryDestroyer = parseFloatValue(value);
            break;
        case 'ConstructionMilitaryEscort':
            policy.constructionMilitaryEscort = parseFloatValue(value);
            break;
        case 'ConstructionMilitaryFrigate':
            policy.constructionMilitaryFrigate = parseFloatValue(value);
            break;
        case 'ConstructionMilitaryTroopTransport':
            policy.constructionMilitaryTroopTransport = parseFloatValue(value);
            break;
        case 'ConstructionSpaceportLargeColonyPopulationThreshold':
            policy.constructionSpaceportLargeColonyPopulationThreshold = parseIntValue(value);
            break;
        case 'ConstructionSpaceportMediumColonyPopulationThreshold':
            policy.constructionSpaceportMediumColonyPopulationThreshold = parseIntValue(value);
            break;
        case 'ConstructionSpaceportMinimumDistance':
            policy.constructionSpaceportMinimumDistance = parseIntValue(value);
            break;
        case 'ConstructionSpaceportSmallColonyPopulationThreshold':
            policy.constructionSpaceportSmallColonyPopulationThreshold = parseIntValue(value);
            break;
        case 'DiplomacySendGiftsUpToAmount':
            policy.diplomacySendGiftsUpToAmount = parseIntValue(value);
            break;
        case 'DiplomacyTradeSanctionsUseBlockades':
            policy.diplomacyTradeSanctionsUseBlockades = parseBoolValue(value);
            break;
        case 'EngageInTourism':
            policy.engageInTourism = parseBoolValue(value);
            break;
        case 'FleetMilitaryProportionForFleets':
            policy.fleetMilitaryProportionForFleets = parseFloatValue(value);
            break;
        case 'FleetStrikeForceTypicalSize':
            policy.fleetStrikeForceTypicalSize = parseIntValue(value);
            break;
        case 'FleetTypicalSize':
            policy.fleetTypicalSize = parseIntValue(value);
            break;
        case 'ImplementEnslavementWithPenalColonies':
            policy.implementEnslavementWithPenalColonies = parseBoolValue(value);
            break;
        case 'IntelligenceAllowMissionDeepCover':
            policy.intelligenceAllowMissionDeepCover = parseBoolValue(value);
            break;
        case 'IntelligenceAllowMissionInciteRevolution':
            policy.intelligenceAllowMissionInciteRevolution = parseBoolValue(value);
            break;
        case 'IntelligenceAllowMissionSabotageColony':
            policy.intelligenceAllowMissionSabotageColony = parseBoolValue(value);
            break;
        case 'IntelligenceAllowMissionSabotageConstruction':
            policy.intelligenceAllowMissionSabotageConstruction = parseBoolValue(value);
            break;
        case 'IntelligenceAllowMissionStealGalaxyMap':
            policy.intelligenceAllowMissionStealGalaxyMap = parseBoolValue(value);
            break;
        case 'IntelligenceAllowMissionStealOperationsMap':
            policy.intelligenceAllowMissionStealOperationsMap = parseBoolValue(value);
            break;
        case 'IntelligenceAllowMissionStealTechData':
            policy.intelligenceAllowMissionStealTechData = parseBoolValue(value);
            break;
        case 'IntelligenceAllowMissionStealTerritoryMap':
            policy.intelligenceAllowMissionStealTerritoryMap = parseBoolValue(value);
            break;
        case 'IntelligenceAllowMissionAssassinateCharacter':
            policy.intelligenceAllowMissionAssassinateCharacter = parseBoolValue(value);
            break;
        case 'IntelligenceAllowMissionDestroyBase':
            policy.intelligenceAllowMissionDestroyBase = parseBoolValue(value);
            break;
        case 'IntelligenceCounterIntelligenceProportion':
            policy.intelligenceCounterIntelligenceProportion = parseFloatValue(value);
            break;
        case 'IntelligenceUseEspionageAgainstEmpireWhen':
            policy.intelligenceUseEspionageAgainstEmpireWhen = parseIntValue(value);
            break;
        case 'IntelligenceUseSabotageAgainstEmpireWhen':
            policy.intelligenceUseSabotageAgainstEmpireWhen = parseIntValue(value);
            break;
        case 'NewColonyPopulationPolicyAllRaces':
            // Port of ParseColonyPopulationPolicyValue (byte.TryParse ->
            // (ColonyPopulationPolicy); enum not yet ported, kept as int).
            policy.newColonyPopulationPolicyAllRaces = parseByteValue(value);
            break;
        case 'NewColonyPopulationPolicyYourRaceFamily':
            policy.newColonyPopulationPolicyYourRaceFamily = parseByteValue(value);
            break;
        case 'ResearchDesignAutoRetrofit':
            policy.researchDesignAutoRetrofit = parseBoolValue(value);
            break;
        case 'ResearchDesignAutoUpgradeFighters':
            policy.researchDesignAutoUpgradeFighters = parseBoolValue(value);
            break;
        case 'ResearchDesignOverallFocus':
            // C# quirk faithfully preserved: this case uses `return` (not
            // `break`) after setting/ignoring the value — but since it is the
            // last action of SetNameValuePair anyway, behavior is identical.
            {
                const intValue = parseIntValue(value);
                if (intValue >= 0 && intValue <= 3) {
                    policy.researchDesignOverallFocus = intValue;
                }
            }
            break;
        case 'ResearchDesignTechFocus1':
            resolveTechFocus(parseIntValue(value), policy, 'researchDesignTechFocus1', 'researchDesignTechFocusType1');
            break;
        case 'ResearchDesignTechFocus2':
            resolveTechFocus(parseIntValue(value), policy, 'researchDesignTechFocus2', 'researchDesignTechFocusType2');
            break;
        case 'ResearchDesignTechFocus3':
            resolveTechFocus(parseIntValue(value), policy, 'researchDesignTechFocus3', 'researchDesignTechFocusType3');
            break;
        case 'ResearchDesignTechFocus4':
            resolveTechFocus(parseIntValue(value), policy, 'researchDesignTechFocus4', 'researchDesignTechFocusType4');
            break;
        case 'ResearchDesignTechFocus5':
            resolveTechFocus(parseIntValue(value), policy, 'researchDesignTechFocus5', 'researchDesignTechFocusType5');
            break;
        case 'ResearchDesignTechFocus6':
            resolveTechFocus(parseIntValue(value), policy, 'researchDesignTechFocus6', 'researchDesignTechFocusType6');
            break;
        case 'TradeWithOtherEmpires':
            policy.tradeWithOtherEmpires = parseBoolValue(value);
            break;
        case 'WarAttacksAllowColonyBombardment':
            policy.warAttacksAllowColonyBombardment = parseIntValue(value);
            break;
        case 'WarAttacksAllowPlanetDestroying':
            policy.warAttacksAllowPlanetDestroying = parseIntValue(value);
            break;
        case 'WarAttacksHarassEnemies':
            policy.warAttacksHarassEnemies = parseBoolValue(value);
            break;
        case 'HomeworldDefensePriority':
            policy.homeworldDefensePriority = clampPriority(parseDoubleValue(value));
            break;
        case 'ColonizeContinentalPriority':
            policy.colonizeContinentalPriority = clampPriority(parseDoubleValue(value));
            break;
        case 'ColonizeMarshySwampPriority':
            policy.colonizeMarshySwampPriority = clampPriority(parseDoubleValue(value));
            break;
        case 'ColonizeOceanPriority':
            policy.colonizeOceanPriority = clampPriority(parseDoubleValue(value));
            break;
        case 'ColonizeDesertPriority':
            policy.colonizeDesertPriority = clampPriority(parseDoubleValue(value));
            break;
        case 'ColonizeIcePriority':
            policy.colonizeIcePriority = clampPriority(parseDoubleValue(value));
            break;
        case 'ColonizeVolcanicPriority':
            policy.colonizeVolcanicPriority = clampPriority(parseDoubleValue(value));
            break;
        case 'ColonizeRuinsPriority':
            policy.colonizeRuinsPriority = clampPriority(parseDoubleValue(value));
            break;
        case 'ControlRestrictedResourcesPriority':
            policy.controlRestrictedResourcesPriority = clampPriority(parseDoubleValue(value));
            break;
        case 'ResearchPriority':
            policy.researchPriority = clampPriority(parseDoubleValue(value));
            break;
        case 'TradePriority':
            policy.tradePriority = clampPriority(parseDoubleValue(value));
            break;
        case 'AlliancePriority':
            policy.alliancePriority = clampPriority(parseDoubleValue(value));
            break;
        case 'SubjugationPriority':
            policy.subjugationPriority = clampPriority(parseDoubleValue(value));
            break;
        case 'TourismPriority':
            policy.tourismPriority = clampPriority(parseDoubleValue(value));
            break;
        case 'ExplorationPriority':
            policy.explorationPriority = clampPriority(parseDoubleValue(value));
            break;
        case 'WarWillingness':
            policy.warWillingness = clampPriority(parseDoubleValue(value));
            break;
        case 'BreakTreatyWillingness':
            policy.breakTreatyWillingness = clampPriority(parseDoubleValue(value));
            break;
        case 'InvasionOverkillFactor':
            policy.invasionOverkillFactor = clampPriority(parseDoubleValue(value));
            break;
        case 'ShipBattleCautionFactor':
            policy.shipBattleCautionFactor = clampPriority(parseDoubleValue(value));
            break;
        case 'ProtectLeaderAtAllCosts':
            policy.protectLeaderAtAllCosts = parseBoolValue(value);
            break;
        case 'PrioritizeBuildWonderId':
            policy.prioritizeBuildWonderId = parseIntValue(value);
            break;
        case 'ResearchIndustryFocus':
            policy.researchIndustryFocus = parseByteValue(value);
            break;
        case 'DefaultMilitaryFleeWhen':
            // Port of ParseFleeWhenValue (byte.TryParse ->
            // (BuiltObjectFleeWhen); enum not yet ported, kept as int).
            policy.defaultMilitaryFleeWhen = parseByteValue(value);
            break;
        case 'DesignUpgradeEscort':
            policy.designUpgradeEscort = parseBoolValue(value);
            break;
        case 'DesignUpgradeFrigate':
            policy.designUpgradeFrigate = parseBoolValue(value);
            break;
        case 'DesignUpgradeDestroyer':
            policy.designUpgradeDestroyer = parseBoolValue(value);
            break;
        case 'DesignUpgradeCruiser':
            policy.designUpgradeCruiser = parseBoolValue(value);
            break;
        case 'DesignUpgradeCapitalShip':
            policy.designUpgradeCapitalShip = parseBoolValue(value);
            break;
        case 'DesignUpgradeTroopTransport':
            policy.designUpgradeTroopTransport = parseBoolValue(value);
            break;
        case 'DesignUpgradeCarrier':
            policy.designUpgradeCarrier = parseBoolValue(value);
            break;
        case 'DesignUpgradeResupplyShip':
            policy.designUpgradeResupplyShip = parseBoolValue(value);
            break;
        case 'DesignUpgradeExplorationShip':
            policy.designUpgradeExplorationShip = parseBoolValue(value);
            break;
        case 'DesignUpgradeColonyShip':
            policy.designUpgradeColonyShip = parseBoolValue(value);
            break;
        case 'DesignUpgradeConstructionShip':
            policy.designUpgradeConstructionShip = parseBoolValue(value);
            break;
        case 'DesignUpgradeSmallSpacePort':
            policy.designUpgradeSmallSpacePort = parseBoolValue(value);
            break;
        case 'DesignUpgradeMediumSpacePort':
            policy.designUpgradeMediumSpacePort = parseBoolValue(value);
            break;
        case 'DesignUpgradeLargeSpacePort':
            policy.designUpgradeLargeSpacePort = parseBoolValue(value);
            break;
        case 'DesignUpgradeResortBase':
            policy.designUpgradeResortBase = parseBoolValue(value);
            break;
        case 'DesignUpgradeGenericBase':
            policy.designUpgradeGenericBase = parseBoolValue(value);
            break;
        case 'DesignUpgradeEnergyResearchStation':
            policy.designUpgradeEnergyResearchStation = parseBoolValue(value);
            break;
        case 'DesignUpgradeWeaponsResearchStation':
            policy.designUpgradeWeaponsResearchStation = parseBoolValue(value);
            break;
        case 'DesignUpgradeHighTechResearchStation':
            policy.designUpgradeHighTechResearchStation = parseBoolValue(value);
            break;
        case 'DesignUpgradeMonitoringStation':
            policy.designUpgradeMonitoringStation = parseBoolValue(value);
            break;
        case 'DesignUpgradeDefensiveBase':
            policy.designUpgradeDefensiveBase = parseBoolValue(value);
            break;
        case 'DesignUpgradeSmallFreighter':
            policy.designUpgradeSmallFreighter = parseBoolValue(value);
            break;
        case 'DesignUpgradeMediumFreighter':
            policy.designUpgradeMediumFreighter = parseBoolValue(value);
            break;
        case 'DesignUpgradeLargeFreighter':
            policy.designUpgradeLargeFreighter = parseBoolValue(value);
            break;
        case 'DesignUpgradePassengerShip':
            policy.designUpgradePassengerShip = parseBoolValue(value);
            break;
        case 'DesignUpgradeGasMiningShip':
            policy.designUpgradeGasMiningShip = parseBoolValue(value);
            break;
        case 'DesignUpgradeMiningShip':
            policy.designUpgradeMiningShip = parseBoolValue(value);
            break;
        case 'DesignUpgradeGasMiningStation':
            policy.designUpgradeGasMiningStation = parseBoolValue(value);
            break;
        case 'DesignUpgradeMiningStation':
            policy.designUpgradeMiningStation = parseBoolValue(value);
            break;
        case 'CaptureTargetConditionShip':
            policy.captureTargetConditionShip = parseIntValue(value);
            break;
        case 'CaptureTargetConditionBase':
            policy.captureTargetConditionBase = parseIntValue(value);
            break;
        case 'OfferPirateAttackMissions':
            policy.offerPirateAttackMissions = parseIntValue(value);
            break;
        case 'BidOnPirateAttackMissions':
            policy.bidOnPirateAttackMissions = parseBoolValue(value);
            break;
        case 'BidOnPirateDefendMissions':
            policy.bidOnPirateDefendMissions = parseBoolValue(value);
            break;
        case 'AcceptPirateSmugglingMissions':
            policy.acceptPirateSmugglingMissions = parseBoolValue(value);
            break;
        case 'OfferDefensivePirateMissionsSituation':
            policy.offerDefensivePirateMissionsSituation = parseIntValue(value);
            break;
        case 'OfferSmugglingPirateMissions':
            policy.offerSmugglingPirateMissions = parseIntValue(value);
            break;
        case 'CaptureEnlistMilitaryShip':
            policy.captureEnlistMilitaryShip = parseIntValue(value);
            break;
        case 'CaptureDisassembleMilitaryShip':
            policy.captureDisassembleMilitaryShip = parseIntValue(value);
            break;
        case 'CaptureEnlistCivilianShip':
            policy.captureEnlistCivilianShip = parseIntValue(value);
            break;
        case 'CaptureDisassembleCivilianShip':
            policy.captureDisassembleCivilianShip = parseIntValue(value);
            break;
        case 'CaptureEnlistBase':
            policy.captureEnlistBase = parseIntValue(value);
            break;
        case 'UpgradeEnlistedMilitaryShips':
            policy.upgradeEnlistedMilitaryShips = parseBoolValue(value);
            break;
        case 'UpgradeEnlistedCivilianShips':
            policy.upgradeEnlistedCivilianShips = parseBoolValue(value);
            break;
        case 'OfferDefensivePirateMissions':
            policy.offerDefensivePirateMissions = parseIntValue(value);
            break;
        case 'PirateSmugglerFreighterLevel':
            policy.pirateSmugglerFreighterLevel = parseDoubleValue(value);
            break;
        case 'PirateSmugglerMiningLevel':
            policy.pirateSmugglerMiningLevel = parseDoubleValue(value);
            break;
        case 'PirateSmugglerPassengerLevel':
            policy.pirateSmugglerPassengerLevel = parseDoubleValue(value);
            break;
        case 'TroopRecruitInfantryLevel':
            policy.troopRecruitInfantryLevel = parseDoubleValue(value);
            break;
        case 'TroopRecruitArmorLevel':
            policy.troopRecruitArmorLevel = parseDoubleValue(value);
            break;
        case 'TroopRecruitArtilleryLevel':
            policy.troopRecruitArtilleryLevel = parseDoubleValue(value);
            break;
        case 'TroopRecruitSpecialForcesLevel':
            policy.troopRecruitSpecialForcesLevel = parseDoubleValue(value);
            break;
        case 'TroopUseDefaultTransportLoadout':
            policy.troopUseDefaultTransportLoadout = parseBoolValue(value);
            break;
        case 'TroopDefaultTransportLoadoutInfantry':
            policy.troopDefaultTransportLoadoutInfantry = parseFloatValue(value);
            break;
        case 'TroopDefaultTransportLoadoutArmor':
            policy.troopDefaultTransportLoadoutArmor = parseFloatValue(value);
            break;
        case 'TroopDefaultTransportLoadoutArtillery':
            policy.troopDefaultTransportLoadoutArtillery = parseFloatValue(value);
            break;
        case 'TroopDefaultTransportLoadoutSpecialForces':
            policy.troopDefaultTransportLoadoutSpecialForces = parseFloatValue(value);
            break;
        case 'TroopGarrisonMinimumPerColony':
            policy.troopGarrisonMinimumPerColony = parseIntValue(value);
            break;
        case 'TroopGarrisonLevel':
            policy.troopGarrisonLevel = parseDoubleValue(value);
            break;
        case 'UseExplorationShipsToScoutEnemySystems':
            policy.useExplorationShipsToScoutEnemySystems = parseBoolValue(value);
            break;
        case 'BuildPlanetDestroyers':
            policy.buildPlanetDestroyers = parseBoolValue(value);
            break;
        default:
            // Unknown keys are silently ignored, as in the C# switch.
            break;
    }
}

// Port of the ResearchDesignTechFocusN cases in SetNameValuePair, which call
// Galaxy.ResolveTechFocus(index, out category, out type) with both outputs
// pre-initialized to Undefined.
// TODO(port): Galaxy.ResolveTechFocus (Galaxy.?.cs) is not yet ported; until
// then every parsed focus index yields (category, type) = (0, 0) i.e.
// (Undefined, Undefined), matching the C# pre-initialization when resolution
// fails. Once ResolveTechFocus exists, wire it in here.
function resolveTechFocus(
    index: number,
    policy: EmpirePolicy,
    categoryField: `researchDesignTechFocus${1 | 2 | 3 | 4 | 5 | 6}`,
    typeField: `researchDesignTechFocusType${1 | 2 | 3 | 4 | 5 | 6}`
): void {
    let category = 0; // ComponentCategoryType.Undefined
    let type = 0; // ComponentType.Undefined
    // TODO(port): replace with Galaxy.ResolveTechFocus(index, ...) once ported.
    void index;
    policy[categoryField] = category;
    policy[typeField] = type;
}