// Port of Race.cs (top-of-file fields) + LoadFromFile (line 752). Pure
// parsing — no fs. Handles UTF-8 BOM, `'`-comment lines, and CRLF. Each
// non-comment line is "Key<whitespace>;Value" (first `;` splits key/value,
// per LoadFromFile's `text.IndexOf(";")`).

import { HabitatType, IndustryType, resolveColonyHabitatTypeByIndexDesertBeforeOcean } from '../types';
import { netSort } from '../netSort';

// Port of ResourceBonus.cs (race critical resources).
export interface ResourceBonus {
    resourceId: number;
    /** ColonyResourceEffect (1..11; 0 = Undefined is never stored). */
    effect: number;
    value: number;
    appliesOnlyToSources: boolean;
}

// Port of RaceVictoryConditionType.cs (byte enum, exact member order).
export enum RaceVictoryConditionType {
    Undefined,
    ControlHomeworld,
    ControlPlanetTypePercentage,
    ControlLargestColoniesByType,
    ControlMostRuins,
    PopulationHighest,
    PopulationHappiest,
    MostHomeworlds,
    OwnLargestCapitalShip,
    MostSpaceports,
    MostMiningStations,
    MostResortBases,
    DestroyMostShips,
    DestroyMostTroops,
    DestroyMoreShipsThanLoseTimesFactor,
    DestroyMoreEnemyTroopsThanLoseTimesFactor,
    DestroyMostCreaturesByType,
    LoseFewestShips,
    LoseFewestTroops,
    MostIntelligenceMissionsSucceed,
    MostIntelligenceMissionsIntercepted,
    ConquerMostEnemyColonies,
    ExterminateOrEnslaveMostPopulation,
    EnslavePopulationProportionEmpire,
    BuildWonder,
    KeepLeaderAlive,
    MostScientists,
    MostExperiencedAdmiral,
    MostExperiencedGeneral,
    ResearchLeastAdvanced,
    ResearchMostAdvanced,
    ResearchMostCompletedBranches,
    ResearchMostCompletedBranchesByIndustry,
    HighestTradeVolume,
    MostTourismIncome,
    MostTradeIncome,
    HighestPrivateRevenue,
    ControlRestrictedResourceSupply,
    LargestMilitary,
    LargestMilitaryNonAllied,
    MostTroops,
    MostTroopsNonAllied,
    MutualDefensePactsFormedProportionAllEmpires,
    FreeTradeAgreementsFormedProportionAllEmpires,
    LeastWarsStarted,
    LeastBrokenTreaties,
    LeastTreaties,
    MostTimeWarring,
    LeastTimeWarring,
    MostSubjugatedDominions,
    OldestMutualDefensePact,
    OldestFreeTradeAgreement,
    ExploreMostSystems,
    ExploreGalaxyPercentage,
    MineMostResourcesLuxury,
    MineMostResourcesStrategic,
    BuildMostMilitaryShips,
    BuildMostCivilianShips,
    BuildMostBases,
    CaptureMostShips,
    PirateBuildMostHiddenBases,
    PirateBuildHiddenFortress,
    PirateControlColoniesPercentage,
    PirateEliminateMostPirateFactions,
    PirateMostSuccessfulMissionsAttack,
    PirateMostSuccessfulMissionsDefend,
    PirateMostSmugglingIncome,
    PirateMostProtectionIncome,
    PirateMostSuccessfulRaids,
    PirateBuildCriminalNetwork,
    MineMostResourcesColonyManufactured,
}

// Port of CharacterTraitType.cs (byte enum, exact member order).
export enum CharacterTraitType {
    Undefined, Paranoid, Trusting, PeaceThroughStrength, Pacifist, Expansionist, Isolationist,
    Diplomat, Obnoxious, Famous, Disliked, GoodAdministrator, PoorAdministrator, BeanCounter,
    Generous, Engineer, Luddite, FreeTrader, Protectionist, Environmentalist, Industrialist,
    InspiringPresence, Demoralizing, Organized, Disorganized, HealthOriented, LaborOriented,
    Spiritual, Logical, GoodStrategist, PoorStrategist, Uninhibited, Measured, Addict, Sober,
    Courageous, Weak, Tolerant, Xenophobic, EloquentSpeaker, PoorSpeaker, Corrupt, Lawful, Lazy,
    Energetic, Linguist, TongueTied, Technical, NonTechnical, GoodTactician, PoorTactician,
    StrongSpaceAttacker, PoorSpaceAttacker, StrongSpaceDefender, PoorSpaceDefender, Drunk,
    ToughDiscipline, LaxDiscipline, LocalDefenseTactics, PlanetarySupport, GoodSpaceLogistician,
    PoorSpaceLogistician, NaturalSpaceLeader, SkilledNavigator, PoorNavigator, StrongGroundAttacker,
    PoorGroundAttacker, StrongGroundDefender, PoorGroundDefender, GoodGroundLogistician,
    PoorGroundLogistician, NaturalGroundLeader, GoodRecruiter, PoorRecruiter, CarefulAttacker,
    RecklessAttacker, DoubleAgent, Creative, Methodical, ForeignSpy, Patriot, UltraGenius,
    IntelligenceUninhibited, IntelligenceMeasured, IntelligenceAddict, IntelligenceSober,
    IntelligenceCourageous, IntelligenceWeak, IntelligenceTolerant, IntelligenceXenophobic,
    IntelligenceEloquentSpeaker, IntelligencePoorSpeaker, IntelligenceCorrupt, IntelligenceLawful,
    Smuggler, BountyHunter,
}

// Port of ComponentCategoryType.cs (byte enum, full, exact member order).
// NOTE: designTemplates.ts declares a partial enum of the same name whose
// values do NOT follow the C# order; this one does.
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

// Port of RaceVictoryCondition.cs.
export interface RaceVictoryCondition {
    type: RaceVictoryConditionType;
    amount: number;
    proportion: number;
    /** Race.cs ParseConditionAdditionalData, by type:
     *  BuildWonder -> raw index into facilities.txt order
     *  (PlanetaryFacilityDefinitionsStatic[index]; the caller resolves it and
     *  treats out-of-range as null, as the C# does);
     *  ControlLargestColoniesByType / ControlPlanetTypePercentage -> HabitatType
     *  (ResolveColonyHabitatTypeByIndexIncludingUndefined);
     *  DestroyMostCreaturesByType -> CreatureType value (ResolveCreatureTypeByIndex);
     *  ResearchMostCompletedBranchesByIndustry -> IndustryType value (raw cast);
     *  otherwise null. */
    additionalData: number | null;
}

// Port of Galaxy.4.cs ResolveColonyHabitatTypeByIndexIncludingUndefined.
export function resolveColonyHabitatTypeByIndexIncludingUndefined(index: number): HabitatType {
    switch (index) {
        case 1: return HabitatType.Continental;
        case 2: return HabitatType.MarshySwamp;
        case 3: return HabitatType.Ocean;
        case 4: return HabitatType.Desert;
        case 5: return HabitatType.Ice;
        case 6: return HabitatType.Volcanic;
        default: return HabitatType.Undefined;
    }
}

// Port of Galaxy.4.cs ResolveCreatureTypeByIndex: 1..5 -> Kaltor, RockSpaceSlug,
// DesertSpaceSlug, Ardilus, SilverMist (CreatureType values 1..5 in
// creature.ts); anything else -> Undefined (0).
export function resolveCreatureTypeByIndex(index: number): number {
    return index >= 1 && index <= 5 ? index : 0;
}

// Port of Galaxy.4.cs ResolveTechDisallow (race file DisallowedResearchAreaN).
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

// Port of Race.cs ParseConditionAdditionalData.
function parseConditionAdditionalData(type: RaceVictoryConditionType, index: number): number | null {
    switch (type) {
        case RaceVictoryConditionType.BuildWonder:
            return index >= 0 ? index : null;
        case RaceVictoryConditionType.ControlLargestColoniesByType:
        case RaceVictoryConditionType.ControlPlanetTypePercentage:
            return resolveColonyHabitatTypeByIndexIncludingUndefined(index);
        case RaceVictoryConditionType.DestroyMostCreaturesByType:
            return resolveCreatureTypeByIndex(index);
        case RaceVictoryConditionType.ResearchMostCompletedBranchesByIndustry:
            return index as IndustryType;
        default:
            return null;
    }
}

export interface Race {
    name: string;
    /** Port of Race.cs LoadFromFile: `case "PictureIndex": race.PictureRef = ParseIntValue(value);` —
     *  the race's portrait index, i.e. the original's PictureRef (race_<i>.png /
     *  race_<i>a.png under images/units/races/, Main.Part13.cs ~2195). Kept named
     *  pictureIndex to match existing call sites (e.g. galaxy.ts). */
    pictureIndex: number;
    raceFamily: number;
    reproductionRate: number;
    intelligence: number;
    aggression: number;
    caution: number;
    friendliness: number;
    loyalty: number;
    designsPictureFamilyIndex: number;
    designNamesIndex: number;
    shipMaintenanceSavings: number;
    troopMaintenanceSavings: number;
    resourceExtractionBonus: number;
    warWearinessAttenuation: number;
    satisfactionModifier: number;
    researchBonus: number;
    espionageBonus: number;
    tradeBonus: number;
    overallShipDesignFocus: number;
    techFocus1: number;
    techFocus2: number;
    nativePlanetType: number;
    /** Port of Race.cs LoadFromFile (line 1286): NativeHabitatType is the
     *  file's NativePlanetType index resolved to a HabitatType via
     *  Galaxy.ResolveColonyHabitatTypeByIndexDesertBeforeOcean. */
    nativeHabitatType: HabitatType;
    specialComponent: number;
    weaponsResearchProjectOrder: number[];
    energyResearchProjectOrder: number[];
    highTechResearchProjectOrder: number[];
    specialGovernment: number;
    preferredStartingGovernment: number;
    disallowedGovernments: number[];
    canChangeGovernment: boolean;
    expanding: boolean;
    canBePirate: boolean;
    canBeNormalEmpire: boolean;
    playable: boolean;
    homeSystemName: string;
    troopStrength: number;
    troopName: string;
    troopNameArmored: string;
    troopNamePlanetaryDefense: string;
    troopNameSpecialForces: string;
    defaultPrimaryColor: number;
    defaultSecondaryColor: number;
    defaultFlagDesign: number;
    /** Race.cs CriticalResources (ResourceBonusList), built from Resource1..3*. */
    criticalResources: ResourceBonus[];
    /** Race.cs VictoryConditions, from Condition1..5*: only types other than
     *  Undefined, then List.Sort by Proportion + Reverse (LoadFromFile). */
    victoryConditions: RaceVictoryCondition[];
    /** PeriodicChangeInterval / PeriodicChangeLength (ChangePeriodYears*). */
    changePeriodYearsInterval: number;
    changePeriodYearsLength: number;
    /** PeriodicFactors* (clamped as in SetNameValuePair). */
    periodicGrowthRate: number;
    periodicAggressionLevel: number;
    periodicCautionLevel: number;
    periodicFriendlinessLevel: number;
    /** ShipSizeFactorCivilian / ShipSizeFactorMilitary. */
    civilianShipSizeFactor: number;
    militaryShipSizeFactor: number;
    /** DisallowedResearchArea1..3 via ResolveTechDisallow, one entry per line
     *  present (entries may be Undefined). */
    disallowedResearchAreas: ComponentCategoryType[];
    /** DisallowedComponentIds (LoadFromFile keeps ids in 0..component count-1;
     *  the upper bound is checked by users that have the component list). */
    disallowedComponentIds: number[];
    /** AdditionalIntelligenceAgents (IntelligenceAgentAdditional, 0..5). */
    intelligenceAgentAdditional: number;
    /** ConstructionSpeedFactor (ConstructionSpeedModifier). */
    constructionSpeedModifier: number;
    characterRandomAppearanceChanceLeader: number;
    characterRandomAppearanceChanceAmbassador: number;
    characterRandomAppearanceChanceGovernor: number;
    characterRandomAppearanceChanceAdmiral: number;
    characterRandomAppearanceChanceGeneral: number;
    characterRandomAppearanceChanceScientist: number;
    characterRandomAppearanceChanceIntelligenceAgent: number;
    characterRandomAppearanceChancePirateLeader: number;
    characterRandomAppearanceChanceShipCaptain: number;
    researchColonizationCostFactorContinental: number;
    researchColonizationCostFactorMarshySwamp: number;
    researchColonizationCostFactorOcean: number;
    researchColonizationCostFactorDesert: number;
    researchColonizationCostFactorIce: number;
    researchColonizationCostFactorVolcanic: number;
    colonyConstructionSpeedFactorContinental: number;
    colonyConstructionSpeedFactorMarshySwamp: number;
    colonyConstructionSpeedFactorOcean: number;
    colonyConstructionSpeedFactorDesert: number;
    colonyConstructionSpeedFactorIce: number;
    colonyConstructionSpeedFactorVolcanic: number;
    characterStartingTraitLeader: CharacterTraitType;
    characterStartingTraitAmbassador: CharacterTraitType;
    characterStartingTraitGovernor: CharacterTraitType;
    characterStartingTraitAdmiral: CharacterTraitType;
    characterStartingTraitGeneral: CharacterTraitType;
    characterStartingTraitScientist: CharacterTraitType;
    characterStartingTraitIntelligenceAgent: CharacterTraitType;
    characterStartingTraitPirateLeader: CharacterTraitType;
    characterStartingTraitShipCaptain: CharacterTraitType;
    colonyPopulationPolicyGrowthFactorExterminate: number;
    /** ImmuneNaturalDisastersAtColonyType via ResolveColonyHabitatTypeByIndexIncludingUndefined. */
    immuneNaturalDisastersAtColonyType: HabitatType;
    spaceportArmorStrengthFactor: number;
    tourismIncomeFactor: number;
    freeTradeIncomeFactor: number;
    migrationFactor: number;
    troopRegenerationFactor: number;
    knownStartingGalacticHistoryLocations: number;
    /** Fields present in the file but not modeled above, keyed by raw field name. */
    extra: Record<string, string>;
}

function stripBom(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseIntField(raw: string | undefined, fallback = 0): number {
    if (raw === undefined || raw.trim() === '') return fallback;
    const n = parseInt(raw.trim(), 10);
    return Number.isNaN(n) ? fallback : n;
}

function parseFloatField(raw: string | undefined, fallback = 0): number {
    if (raw === undefined || raw.trim() === '') return fallback;
    const n = parseFloat(raw.trim());
    return Number.isNaN(n) ? fallback : n;
}

function parseBoolField(raw: string | undefined, fallback = false): boolean {
    if (raw === undefined || raw.trim() === '') return fallback;
    return raw.trim().toUpperCase() === 'Y';
}

// Port of Race.cs LoadFromFile: comma-separated int list fields, e.g.
// WeaponsResearchProjectOrder/EnergyResearchProjectOrder/
// HighTechResearchProjectOrder/DisallowedGovernments.
function parseIntList(raw: string | undefined): number[] {
    if (raw === undefined || raw.trim() === '') return [];
    return raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '')
        .map((s) => parseInt(s, 10))
        .filter((n) => !Number.isNaN(n));
}

// Port of Race.cs LoadFromFile (lines 759-770, 901-962, 1085-1099):
// Resource{N}Type/Effect/Amount/AppliesOnlyToSource → CriticalResources,
// added in order 1,2,3 only when the effect is not Undefined.
function parseCriticalResources(fields: Map<string, string>): ResourceBonus[] {
    const list: ResourceBonus[] = [];
    for (let n = 1; n <= 3; n++) {
        let resourceId = 255; // byte.MaxValue
        const typeRaw = fields.get(`Resource${n}Type`);
        if (typeRaw !== undefined) {
            // ParseByteValue: byte.TryParse, failure -> 0.
            const b = /^\s*\+?\d+\s*$/.test(typeRaw) ? parseInt(typeRaw, 10) : NaN;
            resourceId = Number.isNaN(b) || b > 255 ? 0 : b;
        }
        let effect = 0;
        const effRaw = fields.get(`Resource${n}Effect`);
        if (effRaw !== undefined) {
            // (byte)ParseIntValue, then Enum.IsDefined(ColonyResourceEffect) (0..11).
            const e = parseIntField(effRaw) & 0xff;
            if (e >= 0 && e <= 11) effect = e;
        }
        const value = parseFloatField(fields.get(`Resource${n}Amount`));
        const applies = parseBoolField(fields.get(`Resource${n}AppliesOnlyToSource`));
        if (effect !== 0) {
            list.push({ resourceId, effect, value, appliesOnlyToSources: applies });
        }
    }
    return list;
}

const ROLE_SUFFIXES = ['Leader', 'Ambassador', 'Governor', 'Admiral', 'General', 'Scientist', 'IntelligenceAgent', 'PirateLeader', 'ShipCaptain'];
const COLONY_SUFFIXES = ['Continental', 'MarshySwamp', 'Ocean', 'Desert', 'Ice', 'Volcanic'];

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, hi));

// Port of Race.cs LoadFromFile (Condition1..5 Type/Value/Proportion/
// AdditionalData): a condition is added, in order 1..5, when its type is not
// Undefined; then VictoryConditions.Sort() (by Proportion, .NET introsort —
// netSort) and Reverse().
function parseVictoryConditions(fields: Map<string, string>): RaceVictoryCondition[] {
    const list: RaceVictoryCondition[] = [];
    for (let n = 1; n <= 5; n++) {
        let type = RaceVictoryConditionType.Undefined;
        const typeRaw = fields.get(`Condition${n}Type`);
        if (typeRaw !== undefined) {
            // (byte)ParseIntValue, then Enum.IsDefined(RaceVictoryConditionType).
            const t = parseIntField(typeRaw) & 0xff;
            if (t <= RaceVictoryConditionType.MineMostResourcesColonyManufactured) type = t;
        }
        if (type === RaceVictoryConditionType.Undefined) continue;
        const amount = parseFloatField(fields.get(`Condition${n}Value`));
        // ParseFloatValue: float.Parse -> single precision.
        const proportion = Math.fround(parseFloatField(fields.get(`Condition${n}Proportion`)));
        const index = parseIntField(fields.get(`Condition${n}AdditionalData`));
        list.push({ type, amount, proportion, additionalData: parseConditionAdditionalData(type, index) });
    }
    netSort(list, (a, b) => (a.proportion < b.proportion ? -1 : a.proportion > b.proportion ? 1 : 0));
    list.reverse();
    return list;
}

// Port of Race.cs SetNameValuePair CharacterStartingTrait*: (byte)ParseIntValue,
// kept only when Enum.IsDefined(CharacterTraitType).
function parseTraitField(raw: string | undefined): CharacterTraitType {
    if (raw === undefined) return CharacterTraitType.Undefined;
    const b = parseIntField(raw) & 0xff;
    return b <= CharacterTraitType.BountyHunter ? b : CharacterTraitType.Undefined;
}

// Port of Race.cs LoadFromFile (line 752). `text` is the full content of a
// races/*.txt file (e.g. races/human.txt).
export function parseRace(text: string): Race {
    const fields = new Map<string, string>();
    const lines = stripBom(text).split(/\r\n|\r|\n/);
    for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (trimmed === '' || trimmed.substring(0, 1) === "'") {
            continue;
        }
        const sepIndex = rawLine.indexOf(';');
        if (sepIndex < 0) {
            continue;
        }
        const key = rawLine.substring(0, sepIndex).trim();
        const value = rawLine.substring(sepIndex + 1).trim();
        if (key === '') continue;
        // Later occurrences of the same key (shouldn't normally happen)
        // overwrite earlier ones, matching the C# switch-per-line behavior.
        fields.set(key, value);
    }

    const knownKeys = new Set([
        'Name', 'PictureIndex', 'RaceFamily', 'ReproductionRate', 'Intelligence',
        'Aggression', 'Caution', 'Friendliness', 'Loyalty', 'DesignsPictureFamilyIndex',
        'DesignNamesIndex', 'ShipMaintenanceSavings', 'TroopMaintenanceSavings',
        'ResourceExtractionBonus', 'WarWearinessAttenuation', 'SatisfactionModifier',
        'ResearchBonus', 'EspionageBonus', 'TradeBonus', 'OverallShipDesignFocus',
        'TechFocus1', 'TechFocus2', 'NativePlanetType', 'SpecialComponent',
        'WeaponsResearchProjectOrder', 'EnergyResearchProjectOrder',
        'HighTechResearchProjectOrder', 'SpecialGovernment', 'PreferredStartingGovernment',
        'DisallowedGovernments', 'CanChangeGovernment', 'Expanding', 'CanBePirate',
        'CanBeNormalEmpire', 'Playable', 'HomeSystemName', 'TroopStrength', 'TroopName',
        'TroopNameArmored', 'TroopNamePlanetaryDefense', 'TroopNameSpecialForces',
        'DefaultPrimaryColor', 'DefaultSecondaryColor', 'DefaultFlagDesign',
        'Resource1Type', 'Resource1Effect', 'Resource1Amount', 'Resource1AppliesOnlyToSource',
        'Resource2Type', 'Resource2Effect', 'Resource2Amount', 'Resource2AppliesOnlyToSource',
        'Resource3Type', 'Resource3Effect', 'Resource3Amount', 'Resource3AppliesOnlyToSource',
        'PeriodicChangeInterval', 'PeriodicChangeLength', 'PeriodicFactorsGrowth',
        'PeriodicFactorsAggression', 'PeriodicFactorsCaution', 'PeriodicFactorsFriendliness',
        'ShipSizeFactorCivilian', 'ShipSizeFactorMilitary', 'DisallowedResearchArea1',
        'DisallowedResearchArea2', 'DisallowedResearchArea3', 'DisallowedComponentIds',
        'AdditionalIntelligenceAgents', 'ConstructionSpeedFactor',
        'ColonyPopulationPolicyGrowthFactorExterminate', 'ImmuneNaturalDisastersAtColonyType',
        'SpaceportArmorStrengthFactor', 'TourismIncomeFactor', 'FreeTradeIncomeFactor',
        'MigrationFactor', 'TroopRegenerationFactor', 'KnownStartingGalacticHistoryLocations',
        ...ROLE_SUFFIXES.map((r) => `CharacterRandomAppearanceChance${r}`),
        ...ROLE_SUFFIXES.map((r) => `CharacterStartingTrait${r}`),
        ...COLONY_SUFFIXES.map((c) => `ResearchColonizationCostFactor${c}`),
        ...COLONY_SUFFIXES.map((c) => `ColonyConstructionSpeedFactor${c}`),
        ...[1, 2, 3, 4, 5].flatMap((n) => ['Type', 'Value', 'Proportion', 'AdditionalData'].map((x) => `Condition${n}${x}`)),
    ]);
    const f = (key: string): string | undefined => fields.get(key);
    // Clamped like SetNameValuePair; an absent line keeps the Race default.
    const dbl = (key: string, def: number, lo: number, hi: number): number => {
        const raw = f(key);
        return raw === undefined ? def : clamp(parseFloatField(raw), lo, hi);
    };
    const int = (key: string, def: number, lo: number, hi: number): number => {
        const raw = f(key);
        return raw === undefined ? def : clamp(parseIntField(raw), lo, hi);
    };
    // Race.cs: DisallowedResearchAreas gets one entry per DisallowedResearchAreaN line.
    const disallowedResearchAreas: ComponentCategoryType[] = [];
    for (const n of [1, 2, 3]) {
        const raw = f(`DisallowedResearchArea${n}`);
        if (raw !== undefined) disallowedResearchAreas.push(resolveTechDisallow(parseIntField(raw)));
    }
    const extra: Record<string, string> = {};
    for (const [key, value] of fields) {
        if (!knownKeys.has(key)) {
            extra[key] = value;
        }
    }

    return {
        name: fields.get('Name') ?? '',
        pictureIndex: parseIntField(fields.get('PictureIndex')),
        raceFamily: parseIntField(fields.get('RaceFamily')),
        reproductionRate: parseFloatField(fields.get('ReproductionRate'), 1.0),
        intelligence: parseIntField(fields.get('Intelligence'), 100),
        aggression: parseIntField(fields.get('Aggression'), 100),
        caution: parseIntField(fields.get('Caution'), 100),
        friendliness: parseIntField(fields.get('Friendliness'), 100),
        loyalty: parseIntField(fields.get('Loyalty'), 100),
        designsPictureFamilyIndex: parseIntField(fields.get('DesignsPictureFamilyIndex')),
        designNamesIndex: parseIntField(fields.get('DesignNamesIndex')),
        shipMaintenanceSavings: parseFloatField(fields.get('ShipMaintenanceSavings')),
        troopMaintenanceSavings: parseFloatField(fields.get('TroopMaintenanceSavings')),
        resourceExtractionBonus: parseFloatField(fields.get('ResourceExtractionBonus')),
        warWearinessAttenuation: parseFloatField(fields.get('WarWearinessAttenuation')),
        satisfactionModifier: parseFloatField(fields.get('SatisfactionModifier')),
        researchBonus: parseFloatField(fields.get('ResearchBonus')),
        espionageBonus: parseFloatField(fields.get('EspionageBonus')),
        tradeBonus: parseFloatField(fields.get('TradeBonus')),
        overallShipDesignFocus: parseIntField(fields.get('OverallShipDesignFocus')),
        techFocus1: parseIntField(fields.get('TechFocus1')),
        techFocus2: parseIntField(fields.get('TechFocus2')),
        nativePlanetType: parseIntField(fields.get('NativePlanetType')),
        // Port of Race.cs LoadFromFile (line 1286): NativeHabitatType =
        // Galaxy.ResolveColonyHabitatTypeByIndexDesertBeforeOcean(NativePlanetType).
        nativeHabitatType: resolveColonyHabitatTypeByIndexDesertBeforeOcean(parseIntField(fields.get('NativePlanetType'))),
        specialComponent: parseIntField(fields.get('SpecialComponent'), -1),
        weaponsResearchProjectOrder: parseIntList(fields.get('WeaponsResearchProjectOrder')),
        energyResearchProjectOrder: parseIntList(fields.get('EnergyResearchProjectOrder')),
        highTechResearchProjectOrder: parseIntList(fields.get('HighTechResearchProjectOrder')),
        specialGovernment: parseIntField(fields.get('SpecialGovernment'), -1),
        preferredStartingGovernment: parseIntField(fields.get('PreferredStartingGovernment'), -1),
        disallowedGovernments: parseIntList(fields.get('DisallowedGovernments')),
        canChangeGovernment: parseBoolField(fields.get('CanChangeGovernment'), true),
        expanding: parseBoolField(fields.get('Expanding'), true),
        canBePirate: parseBoolField(fields.get('CanBePirate'), true),
        canBeNormalEmpire: parseBoolField(fields.get('CanBeNormalEmpire'), true),
        playable: parseBoolField(fields.get('Playable'), true),
        homeSystemName: fields.get('HomeSystemName') ?? '',
        troopStrength: parseIntField(fields.get('TroopStrength'), 100),
        troopName: fields.get('TroopName') ?? '',
        troopNameArmored: fields.get('TroopNameArmored') ?? '',
        troopNamePlanetaryDefense: fields.get('TroopNamePlanetaryDefense') ?? '',
        troopNameSpecialForces: fields.get('TroopNameSpecialForces') ?? '',
        defaultPrimaryColor: parseIntField(fields.get('DefaultPrimaryColor')),
        defaultSecondaryColor: parseIntField(fields.get('DefaultSecondaryColor')),
        defaultFlagDesign: parseIntField(fields.get('DefaultFlagDesign')),
        criticalResources: parseCriticalResources(fields),
        victoryConditions: parseVictoryConditions(fields),
        changePeriodYearsInterval: parseIntField(f('PeriodicChangeInterval')),
        changePeriodYearsLength: parseIntField(f('PeriodicChangeLength')),
        periodicGrowthRate: dbl('PeriodicFactorsGrowth', 1.0, 1.0, 2.0),
        periodicAggressionLevel: int('PeriodicFactorsAggression', 100, 50, 200),
        periodicCautionLevel: int('PeriodicFactorsCaution', 100, 50, 200),
        periodicFriendlinessLevel: int('PeriodicFactorsFriendliness', 100, 50, 200),
        civilianShipSizeFactor: dbl('ShipSizeFactorCivilian', 1.0, 0.7, 5.1),
        militaryShipSizeFactor: dbl('ShipSizeFactorMilitary', 1.0, 0.7, 5.1),
        disallowedResearchAreas,
        disallowedComponentIds: parseIntList(f('DisallowedComponentIds')).filter((id) => id >= 0),
        intelligenceAgentAdditional: int('AdditionalIntelligenceAgents', 0, 0, 5),
        constructionSpeedModifier: dbl('ConstructionSpeedFactor', 1.0, 0.3, 5.5),
        characterRandomAppearanceChanceLeader: dbl('CharacterRandomAppearanceChanceLeader', 1.0, 0.0, 5.0),
        characterRandomAppearanceChanceAmbassador: dbl('CharacterRandomAppearanceChanceAmbassador', 1.0, 0.0, 5.0),
        characterRandomAppearanceChanceGovernor: dbl('CharacterRandomAppearanceChanceGovernor', 1.0, 0.0, 5.0),
        characterRandomAppearanceChanceAdmiral: dbl('CharacterRandomAppearanceChanceAdmiral', 1.0, 0.0, 5.0),
        characterRandomAppearanceChanceGeneral: dbl('CharacterRandomAppearanceChanceGeneral', 1.0, 0.0, 5.0),
        characterRandomAppearanceChanceScientist: dbl('CharacterRandomAppearanceChanceScientist', 1.0, 0.0, 5.0),
        characterRandomAppearanceChanceIntelligenceAgent: dbl('CharacterRandomAppearanceChanceIntelligenceAgent', 1.0, 0.0, 5.0),
        characterRandomAppearanceChancePirateLeader: dbl('CharacterRandomAppearanceChancePirateLeader', 1.0, 0.0, 5.0),
        characterRandomAppearanceChanceShipCaptain: dbl('CharacterRandomAppearanceChanceShipCaptain', 1.0, 0.0, 5.0),
        researchColonizationCostFactorContinental: dbl('ResearchColonizationCostFactorContinental', 1.0, 0.2, 5.0),
        researchColonizationCostFactorMarshySwamp: dbl('ResearchColonizationCostFactorMarshySwamp', 1.0, 0.2, 5.0),
        researchColonizationCostFactorOcean: dbl('ResearchColonizationCostFactorOcean', 1.0, 0.2, 5.0),
        researchColonizationCostFactorDesert: dbl('ResearchColonizationCostFactorDesert', 1.0, 0.2, 5.0),
        researchColonizationCostFactorIce: dbl('ResearchColonizationCostFactorIce', 1.0, 0.2, 5.0),
        researchColonizationCostFactorVolcanic: dbl('ResearchColonizationCostFactorVolcanic', 1.0, 0.2, 5.0),
        colonyConstructionSpeedFactorContinental: dbl('ColonyConstructionSpeedFactorContinental', 1.0, 0.2, 5.0),
        colonyConstructionSpeedFactorMarshySwamp: dbl('ColonyConstructionSpeedFactorMarshySwamp', 1.0, 0.2, 5.0),
        colonyConstructionSpeedFactorOcean: dbl('ColonyConstructionSpeedFactorOcean', 1.0, 0.2, 5.0),
        colonyConstructionSpeedFactorDesert: dbl('ColonyConstructionSpeedFactorDesert', 1.0, 0.2, 5.0),
        colonyConstructionSpeedFactorIce: dbl('ColonyConstructionSpeedFactorIce', 1.0, 0.2, 5.0),
        colonyConstructionSpeedFactorVolcanic: dbl('ColonyConstructionSpeedFactorVolcanic', 1.0, 0.2, 5.0),
        characterStartingTraitLeader: parseTraitField(f('CharacterStartingTraitLeader')),
        characterStartingTraitAmbassador: parseTraitField(f('CharacterStartingTraitAmbassador')),
        characterStartingTraitGovernor: parseTraitField(f('CharacterStartingTraitGovernor')),
        characterStartingTraitAdmiral: parseTraitField(f('CharacterStartingTraitAdmiral')),
        characterStartingTraitGeneral: parseTraitField(f('CharacterStartingTraitGeneral')),
        characterStartingTraitScientist: parseTraitField(f('CharacterStartingTraitScientist')),
        characterStartingTraitIntelligenceAgent: parseTraitField(f('CharacterStartingTraitIntelligenceAgent')),
        characterStartingTraitPirateLeader: parseTraitField(f('CharacterStartingTraitPirateLeader')),
        characterStartingTraitShipCaptain: parseTraitField(f('CharacterStartingTraitShipCaptain')),
        colonyPopulationPolicyGrowthFactorExterminate: dbl('ColonyPopulationPolicyGrowthFactorExterminate', 1.0, 0.2, 5.0),
        immuneNaturalDisastersAtColonyType: resolveColonyHabitatTypeByIndexIncludingUndefined(parseIntField(f('ImmuneNaturalDisastersAtColonyType'))),
        spaceportArmorStrengthFactor: dbl('SpaceportArmorStrengthFactor', 1.0, 0.3, 3.0),
        tourismIncomeFactor: dbl('TourismIncomeFactor', 1.0, 0.2, 5.0),
        freeTradeIncomeFactor: dbl('FreeTradeIncomeFactor', 1.0, 0.2, 5.0),
        migrationFactor: dbl('MigrationFactor', 1.0, 0.2, 5.0),
        troopRegenerationFactor: dbl('TroopRegenerationFactor', 1.0, 0.2, 5.0),
        knownStartingGalacticHistoryLocations: int('KnownStartingGalacticHistoryLocations', 0, 0, 10),
        extra,
    };
}
