// Port of the character system needed at game start (DistantWorlds.Types):
// - enums CharacterRole.cs / CharacterSkillType.cs / CharacterTraitType.cs / CharacterEventType.cs
//   (exact C# member order),
// - CharacterSkill.cs, CharacterSkillList.cs, CharacterEvent.cs, CharacterList.cs (as helper
//   functions over Character[]),
// - Character.cs (fields, skill/trait caches, AddSkill / AddTrait / CheckNewTraitValid /
//   RebuildCachedSkillValues / ReviewTraitSkills / ClearIrrelevantTraitSkills,
//   DetermineValidSkillsForRole / DetermineValidTraitsForRole, Activate / CompleteEmpireChange /
//   CompleteLocationTransfer / TransferToNewLocation, Determine* location helpers),
// - Galaxy.1.cs CheckCharacterTraitAppliesOnlyToExistingSkills / DetermineEffectsOfCharacterTrait /
//   DetermineCharacterEventRelevantToRole / DoCharacterEvent (game-start events),
// - Galaxy.4.cs SetRaceStartupCharacters / LoadCharacters / LoadCharactersCompleteFilePath /
//   SelectRandomSkillForRole / SelectRandomTraitForRole, LoadAgentNames (data/characters.ts),
//   Galaxy.5.cs GenerateUniqueAgentName, Galaxy.7.cs ConditionCheckLimit,
// - Empire.6.cs GenerateStartingCharacters (4304/4309), GenerateNewCharacter (4413-4461),
//   GenerateNewCharacterRandom, SelectRandomRaceFromColoniesPreferNonDominant,
//   ApplyRandomCharacterSkillsTraits, GenerateAgentName, Empire.7.cs ReviewCharacterLocation /
//   CheckLocationSafeForDemoralizingCharacter, Empire.3.cs IdentifyResearchStationHighestBonus,
//   Galaxy.9.cs IdentifyPirateBase, BuiltObject.cs ReviewCaptainBonuses /
//   GetCharacterMaintenanceBonuses, BaconCharacter.IncrementSkillProgress /
//   BaconEmpire.EnhanceCharacter ("Romulan" empires),
// - the character bonus reads other modules need (resolveCharacter*: Habitat.cs / Empire.cs /
//   BuiltObject.cs expressions, see the bottom of this file).
//
// Headless sim: all randomness goes through galaxy.rnd in the C# Galaxy.Rnd order. Numeric
// semantics: the C# sbyte skill caches are Int8Array slots (compound += / -= wrap like the C#
// implicit sbyte narrowing), ints are Math.trunc'ed where C# truncates.
//
// Storage notes (TS-only, no behaviour change):
// - Empire.Characters is empire.characters (typed unknown[] in empire.ts; holds Character).
// - StellarObject.Characters: BuiltObject.characters (builtObject.ts) for built objects and a
//   per-habitat WeakMap for habitats (types.ts Habitat has no field yet) — see
//   stellarObjectCharacters().
// - Race.AvailableCharacters (Race.cs 107, filled per galaxy by SetRaceStartupCharacters in the
//   Galaxy ctor, Galaxy.4.cs 2134) and Galaxy._AgentFirstNames/_AgentLastNames (LoadAgentNames,
//   Galaxy.4.cs 2133) live in a per-galaxy WeakMap built lazily from galaxy.characterNames /
//   galaxy.characterFiles (neither uses Galaxy.Rnd, so building on first use is equivalent).
// - BuiltObject._Captain*Bonus (ReviewCaptainBonuses) are kept in a WeakMap (builtObject.ts
//   has no fields yet) — captainBonuses().
//
// Rnd usage (Galaxy.Rnd, in C# order):
// - GenerateNewCharacter (random character only, i.e. no available character of that role):
//   role not Leader/PirateLeader → Next(0,4) [== 1 → SelectRandomRaceFromColoniesPreferNonDominant:
//   per try Next(0,Colonies.Count) + Next(0,Population.Count), up to 10 tries]; race null →
//   SelectRandomRace(0) (1 draw); GenerateUniqueAgentName → Next(0,first.Length), Next(0,last.Length);
//   ApplyRandomCharacterSkillsTraits (see there).
// - ApplyRandomCharacterSkillsTraits: skill count loop Next(0,2) per iteration (stops on != 1 or
//   limit); per skill slot: up to 20 tries of [Next(0,3) when secondary skills exist] + Next(0,n);
//   per chosen skill Next(0,maxValue) + one level draw; trait count loop Next(0,2); per trait
//   slot up to 20 tries of Next(0,traits.Count).
// - Character.Activate → CompleteLocationTransfer → DoCharacterEvent(CharacterTransferLocation)
//   and GenerateStartingCharacters' DoCharacterEvent(CharacterStart): Next(0,5), Next(0,20),
//   Next(0,80) per character per event (6 draws per started character).
// - ReviewCharacterLocation (ShipCaptain only): Next(0, candidates) — no ship captains at start.
// Galaxy.RndStatic (clock-seeded in C#; here a stream seeded from the galaxy seed — documented
// deviation) is used only for "?" fields in characters/<race>.txt (none in the shipped data), and
// the unseeded `new Random()` for "?" appearance orders likewise.

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';
import type { Race } from './data/races';
import type { BuiltObject } from './builtObject';
import type { CharacterFileRow } from './data/characters';
import { HabitatCategoryType, HabitatType, IndustryType, type Habitat } from './types';
import { BuiltObjectRole } from './data/designSpecifications';
import { BuiltObjectSubRole } from './builtObjectTypes';
import { SystemVisibilityStatus } from './visibility';
import { Random } from './random';
import { netSort } from './netSort';
import { galaxyCurrentStarDate } from './pirateRelations';
import { selectRandomRace } from './pirates';
import { identifyEmpireCapitals } from './forceStructure';
import { strategicValue as habitatStrategicValue } from './territory';
import { PirateRelationType } from './pirateRelations';

/** C# StellarObject (Habitat or BuiltObject) as a character location. */
export type StellarObject = Habitat | BuiltObject;

// C# long.MaxValue (Character._TransferArrivalDate initial value) — not exactly representable
// as a double; only compared by magnitude.
const LONG_MAX_VALUE = 9223372036854775807;
const INT_MIN_VALUE = -2147483648;

// ---------------------------------------------------------------------------
// Enums (exact C# member order)
// ---------------------------------------------------------------------------

// CharacterRole.cs
export enum CharacterRole {
    Undefined,
    Leader,
    Ambassador,
    ColonyGovernor,
    FleetAdmiral,
    TroopGeneral,
    IntelligenceAgent,
    Scientist,
    PirateLeader,
    ShipCaptain,
}

// CharacterSkillType.cs
export enum CharacterSkillType {
    Undefined,
    Diplomacy,
    ColonyIncome,
    TradeIncome,
    TourismIncome,
    ColonyCorruption,
    ColonyHappiness,
    PopulationGrowth,
    MiningRate,
    TroopRecruitment,
    MilitaryShipConstructionSpeed,
    CivilianShipConstructionSpeed,
    ColonyShipConstructionSpeed,
    FacilityConstructionSpeed,
    ResearchWeapons,
    ResearchEnergy,
    ResearchHighTech,
    Espionage,
    CounterEspionage,
    Sabotage,
    Concealment,
    PsyOps,
    Assassination,
    MilitaryShipMaintenance,
    MilitaryBaseMaintenance,
    CivilianShipMaintenance,
    CivilianBaseMaintenance,
    TroopMaintenance,
    WarWeariness,
    Targeting,
    Countermeasures,
    ShipManeuvering,
    Fighters,
    ShipEnergyUsage,
    WeaponsDamage,
    WeaponsRange,
    ShieldRechargeRate,
    DamageControl,
    RepairBonus,
    HyperjumpSpeed,
    TroopGroundAttack,
    TroopGroundDefense,
    TroopExperienceGain,
    TroopRecoveryRate,
    TroopStrengthArmor,
    TroopStrengthInfantry,
    TroopStrengthSpecialForces,
    TroopStrengthPlanetaryDefense,
    SmugglingIncome,
    SmugglingEvasion,
    BoardingAssault,
}
const CHARACTER_SKILL_TYPE_COUNT = 51;

// CharacterTraitType.cs
export enum CharacterTraitType {
    Undefined,
    Paranoid,
    Trusting,
    PeaceThroughStrength,
    Pacifist,
    Expansionist,
    Isolationist,
    Diplomat,
    Obnoxious,
    Famous,
    Disliked,
    GoodAdministrator,
    PoorAdministrator,
    BeanCounter,
    Generous,
    Engineer,
    Luddite,
    FreeTrader,
    Protectionist,
    Environmentalist,
    Industrialist,
    InspiringPresence,
    Demoralizing,
    Organized,
    Disorganized,
    HealthOriented,
    LaborOriented,
    Spiritual,
    Logical,
    GoodStrategist,
    PoorStrategist,
    Uninhibited,
    Measured,
    Addict,
    Sober,
    Courageous,
    Weak,
    Tolerant,
    Xenophobic,
    EloquentSpeaker,
    PoorSpeaker,
    Corrupt,
    Lawful,
    Lazy,
    Energetic,
    Linguist,
    TongueTied,
    Technical,
    NonTechnical,
    GoodTactician,
    PoorTactician,
    StrongSpaceAttacker,
    PoorSpaceAttacker,
    StrongSpaceDefender,
    PoorSpaceDefender,
    Drunk,
    ToughDiscipline,
    LaxDiscipline,
    LocalDefenseTactics,
    PlanetarySupport,
    GoodSpaceLogistician,
    PoorSpaceLogistician,
    NaturalSpaceLeader,
    SkilledNavigator,
    PoorNavigator,
    StrongGroundAttacker,
    PoorGroundAttacker,
    StrongGroundDefender,
    PoorGroundDefender,
    GoodGroundLogistician,
    PoorGroundLogistician,
    NaturalGroundLeader,
    GoodRecruiter,
    PoorRecruiter,
    CarefulAttacker,
    RecklessAttacker,
    DoubleAgent,
    Creative,
    Methodical,
    ForeignSpy,
    Patriot,
    UltraGenius,
    IntelligenceUninhibited,
    IntelligenceMeasured,
    IntelligenceAddict,
    IntelligenceSober,
    IntelligenceCourageous,
    IntelligenceWeak,
    IntelligenceTolerant,
    IntelligenceXenophobic,
    IntelligenceEloquentSpeaker,
    IntelligencePoorSpeaker,
    IntelligenceCorrupt,
    IntelligenceLawful,
    Smuggler,
    BountyHunter,
}

// CharacterEventType.cs
export enum CharacterEventType {
    Undefined,
    TreatySigned,
    WarStarted,
    WarEnded,
    TradeIncome,
    TourismIncome,
    ColonyDevelopmentIncrease,
    ColonyDevelopmentDecrease,
    CashNegative,
    CashPositive,
    TroopComplete,
    IntelligenceMissionSucceedEspionage,
    IntelligenceMissionSucceedSabotage,
    IntelligenceMissionFailEspionage,
    IntelligenceMissionFailSabotage,
    IntelligenceMissionInterceptEnemy,
    IntelligenceAgentOursCaptured,
    IntelligenceAgentRecruited,
    ResearchAdvanceWeapons,
    ResearchAdvanceEnergy,
    ResearchAdvanceHighTech,
    BuildMilitaryShip,
    BuildCivilianShip,
    BuildColonyShip,
    BuildMilitaryBase,
    BuildSpaceport,
    BuildResearchStationWeapons,
    BuildResearchStationEnergy,
    BuildResearchStationHighTech,
    BuildMiningStation,
    BuildResortBase,
    BuildOtherBase,
    BuildFacility,
    BuildWonder,
    HyperjumpExit,
    SpaceBattle,
    GroundInvasion,
    TargetOfFailedAssassination,
    Subjugated,
    TreatyBroken,
    AmbassadorAssignedToEmpire,
    CriticalResearchSuccess,
    CriticalResearchFailure,
    CharacterStart,
    CharacterTraitGain,
    CharacterSkillGain,
    CharacterSkillProgress,
    CharacterTransferLocation,
    Boarding,
    Raid,
    SmugglingSuccess,
    SmugglingDetection,
}

const isDefinedRole = (b: number): boolean => b >= 0 && b <= 9;
const isDefinedSkillType = (b: number): boolean => b >= 0 && b < CHARACTER_SKILL_TYPE_COUNT;
const isDefinedTraitType = (b: number): boolean => b >= 0 && b <= 95;

// ---------------------------------------------------------------------------
// CharacterSkill.cs / CharacterSkillList.cs / CharacterEvent.cs
// ---------------------------------------------------------------------------

export class CharacterSkill {
    type: CharacterSkillType;
    level: number; // int
    progress = 0; // float
    nextProgressThreshold = 1; // float 1f

    constructor(skillType: CharacterSkillType, level: number) {
        this.type = skillType;
        this.level = level;
    }
}

export class CharacterSkillList {
    items: CharacterSkill[] = [];
    get count(): number {
        return this.items.length;
    }
    add(skill: CharacterSkill): void {
        this.items.push(skill);
    }
    /** List<T>.Remove: first occurrence by reference. */
    remove(skill: CharacterSkill): boolean {
        const i = this.items.indexOf(skill);
        if (i < 0) return false;
        this.items.splice(i, 1);
        return true;
    }
    clear(): void {
        this.items.length = 0;
    }
    // CharacterSkillList.CombineSkillList
    combineSkillList(newSkills: CharacterSkillList | null): void {
        if (newSkills === null) return;
        for (let index = 0; index < newSkills.count; ++index) {
            const newSkill = newSkills.items[index];
            if (newSkill !== null) {
                const skillByType = this.getSkillByType(newSkill.type);
                if (skillByType !== null) skillByType.level += newSkill.level;
                else this.add(newSkill);
            }
        }
    }
    // CharacterSkillList.GetSkillByType
    getSkillByType(skillType: CharacterSkillType): CharacterSkill | null {
        for (let index = 0; index < this.count; ++index) {
            const skillByType = this.items[index];
            if (skillByType !== null && skillByType.type === skillType) return skillByType;
        }
        return null;
    }
}

export class CharacterEvent {
    type: CharacterEventType;
    eventData: unknown;
    starDate: number;

    // CharacterEvent.cs ctor: CharacterStart / CharacterTransferLocation with a Character store
    // { character, character.Location }.
    constructor(type: CharacterEventType, eventData: unknown, starDate: number) {
        switch (type) {
            case CharacterEventType.CharacterStart:
            case CharacterEventType.CharacterTransferLocation:
                if (eventData instanceof Character) {
                    const character = eventData;
                    if (character !== null) {
                        eventData = [character, character.location];
                        break;
                    }
                    break;
                }
                break;
        }
        this.type = type;
        this.eventData = eventData;
        this.starDate = starDate;
    }
}

// ---------------------------------------------------------------------------
// StellarObject helpers
// ---------------------------------------------------------------------------

/** C# `obj is BuiltObject` (same structural test as empire.ts isBuiltObject). */
export function isBuiltObjectLocation(o: StellarObject): o is BuiltObject {
    return (o as BuiltObject).builtObjectID !== undefined && (o as BuiltObject).design !== undefined;
}

const habitatCharacters = new WeakMap<Habitat, Character[]>();
const habitatInvadingCharacters = new WeakMap<Habitat, Character[]>();

/** StellarObject.Characters (StellarObject.cs 29): null when never assigned. */
export function stellarObjectCharacters(o: StellarObject): Character[] | null {
    if (isBuiltObjectLocation(o)) return o.characters as Character[] | null;
    return habitatCharacters.get(o) ?? null;
}
function setStellarObjectCharacters(o: StellarObject, list: Character[]): void {
    if (isBuiltObjectLocation(o)) o.characters = list;
    else habitatCharacters.set(o, list);
}
/** Habitat.InvadingCharacters (Habitat.cs 411). */
export function habitatInvadingCharacterList(h: Habitat): Character[] | null {
    return habitatInvadingCharacters.get(h) ?? null;
}

function removeFirst<T>(list: T[], item: T): boolean {
    const i = list.indexOf(item);
    if (i < 0) return false;
    list.splice(i, 1);
    return true;
}

function empireCharacters(empire: Empire): Character[] {
    return empire.characters as Character[];
}

// ---------------------------------------------------------------------------
// Race character fields (Race.cs LoadFromFile, read from the race file's extra keys)
// ---------------------------------------------------------------------------

// C# int.TryParse (Race.cs ParseIntValue): 0 when not an int.
function raceParseIntValue(raw: string | undefined): number {
    if (raw === undefined) return 0;
    const t = raw.trim();
    if (!/^[+-]?\d+$/.test(t)) return 0;
    const n = parseInt(t, 10);
    return n > 2147483647 || n < -2147483648 ? 0 : n;
}

/** Race.IntelligenceAgentAdditional (Race.cs 1396: Math.Min(5, Math.Max(0, ParseIntValue))). */
export function raceIntelligenceAgentAdditional(race: Race): number {
    const raw = race.extra?.['AdditionalIntelligenceAgents'];
    if (raw === undefined) return 0;
    return Math.min(5, Math.max(0, raceParseIntValue(raw)));
}

/** Race.CharacterStartingTrait<Role> (Race.cs 1492-1572: (byte)ParseIntValue, Enum.IsDefined). */
export function raceCharacterStartingTrait(race: Race, key: string): CharacterTraitType {
    const raw = race.extra?.[key];
    if (raw === undefined) return CharacterTraitType.Undefined;
    const b = raceParseIntValue(raw) & 0xff;
    return isDefinedTraitType(b) ? (b as CharacterTraitType) : CharacterTraitType.Undefined;
}

// ---------------------------------------------------------------------------
// Galaxy.1.cs trait helpers
// ---------------------------------------------------------------------------

// Galaxy.1.cs CheckCharacterTraitAppliesOnlyToExistingSkills (1481).
export function checkCharacterTraitAppliesOnlyToExistingSkills(trait: CharacterTraitType): boolean {
    switch (trait) {
        case CharacterTraitType.Lazy:
        case CharacterTraitType.Energetic:
        case CharacterTraitType.GoodTactician:
        case CharacterTraitType.PoorTactician:
        case CharacterTraitType.Drunk:
        case CharacterTraitType.ToughDiscipline:
        case CharacterTraitType.LaxDiscipline:
        case CharacterTraitType.IntelligenceAddict:
        case CharacterTraitType.IntelligenceSober:
            return true;
        default:
            return false;
    }
}

// Galaxy.1.cs DetermineEffectsOfCharacterTrait (1500/1505).
export function determineEffectsOfCharacterTrait(trait: CharacterTraitType, role: CharacterRole = CharacterRole.Undefined): CharacterSkillList {
    const characterSkillList = new CharacterSkillList();
    const num = 10;
    const num2 = 5;
    const num3 = 20;
    switch (trait) {
        case CharacterTraitType.Smuggler:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.SmugglingIncome, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.SmugglingEvasion, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.DamageControl, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Countermeasures, num));
            break;
        case CharacterTraitType.BountyHunter:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.BoardingAssault, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.WeaponsDamage, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Targeting, num));
            break;
        case CharacterTraitType.IntelligenceAddict:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Espionage, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CounterEspionage, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Sabotage, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.PsyOps, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Concealment, -num));
            break;
        case CharacterTraitType.IntelligenceCorrupt:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Espionage, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CounterEspionage, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Sabotage, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.PsyOps, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Concealment, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Assassination, -num));
            break;
        case CharacterTraitType.IntelligenceCourageous:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Espionage, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CounterEspionage, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Sabotage, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.PsyOps, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Concealment, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Assassination, num));
            break;
        case CharacterTraitType.IntelligenceEloquentSpeaker:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.PsyOps, num));
            break;
        case CharacterTraitType.IntelligenceLawful:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Espionage, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CounterEspionage, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Sabotage, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.PsyOps, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Concealment, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Assassination, -num));
            break;
        case CharacterTraitType.IntelligenceMeasured:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.PsyOps, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Concealment, num));
            break;
        case CharacterTraitType.IntelligencePoorSpeaker:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.PsyOps, -num));
            break;
        case CharacterTraitType.IntelligenceSober:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Espionage, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CounterEspionage, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Sabotage, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.PsyOps, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Concealment, num));
            break;
        case CharacterTraitType.IntelligenceTolerant:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CounterEspionage, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Concealment, num));
            break;
        case CharacterTraitType.IntelligenceUninhibited:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.PsyOps, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Concealment, -num));
            break;
        case CharacterTraitType.IntelligenceWeak:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Espionage, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CounterEspionage, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Sabotage, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.PsyOps, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Concealment, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Assassination, -num));
            break;
        case CharacterTraitType.IntelligenceXenophobic:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CounterEspionage, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Concealment, -num));
            break;
        case CharacterTraitType.Paranoid:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CounterEspionage, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Diplomacy, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyHappiness, -num));
            break;
        case CharacterTraitType.Trusting:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CounterEspionage, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Diplomacy, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyHappiness, num));
            break;
        case CharacterTraitType.PeaceThroughStrength:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopRecruitment, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MilitaryShipConstructionSpeed, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyHappiness, -num));
            break;
        case CharacterTraitType.Pacifist:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopRecruitment, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MilitaryShipConstructionSpeed, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyHappiness, num));
            break;
        case CharacterTraitType.Expansionist:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ResearchHighTech, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyShipConstructionSpeed, num));
            break;
        case CharacterTraitType.Isolationist:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ResearchWeapons, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyShipConstructionSpeed, -num));
            break;
        case CharacterTraitType.Diplomat:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Diplomacy, num));
            break;
        case CharacterTraitType.Obnoxious:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Diplomacy, -num));
            break;
        case CharacterTraitType.Famous:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyHappiness, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TourismIncome, num));
            break;
        case CharacterTraitType.Disliked:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyHappiness, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TourismIncome, -num));
            break;
        case CharacterTraitType.GoodAdministrator:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyIncome, num));
            break;
        case CharacterTraitType.PoorAdministrator:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyIncome, -num));
            break;
        case CharacterTraitType.BeanCounter:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyCorruption, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyHappiness, -num));
            break;
        case CharacterTraitType.Generous:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyCorruption, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyHappiness, num));
            break;
        case CharacterTraitType.Engineer:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ResearchHighTech, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CivilianShipConstructionSpeed, num));
            break;
        case CharacterTraitType.Luddite:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ResearchHighTech, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CivilianShipConstructionSpeed, -num));
            break;
        case CharacterTraitType.FreeTrader:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TradeIncome, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CivilianShipConstructionSpeed, num));
            break;
        case CharacterTraitType.Protectionist:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TradeIncome, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CivilianShipConstructionSpeed, -num));
            break;
        case CharacterTraitType.Environmentalist:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.PopulationGrowth, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MiningRate, -num));
            break;
        case CharacterTraitType.Industrialist:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.PopulationGrowth, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MiningRate, num));
            break;
        case CharacterTraitType.Organized:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MilitaryShipConstructionSpeed, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CivilianShipConstructionSpeed, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyShipConstructionSpeed, num));
            break;
        case CharacterTraitType.Disorganized:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MilitaryShipConstructionSpeed, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CivilianShipConstructionSpeed, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyShipConstructionSpeed, -num));
            break;
        case CharacterTraitType.HealthOriented:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.PopulationGrowth, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyHappiness, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyIncome, -num));
            break;
        case CharacterTraitType.LaborOriented:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.PopulationGrowth, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyHappiness, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyIncome, num));
            break;
        case CharacterTraitType.Spiritual:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyHappiness, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Diplomacy, -num));
            break;
        case CharacterTraitType.Logical:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyHappiness, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Diplomacy, num));
            break;
        case CharacterTraitType.GoodStrategist:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopMaintenance, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MilitaryShipMaintenance, num));
            break;
        case CharacterTraitType.PoorStrategist:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopMaintenance, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MilitaryShipMaintenance, -num));
            break;
        case CharacterTraitType.Uninhibited:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyHappiness, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyCorruption, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Diplomacy, -num));
            break;
        case CharacterTraitType.Measured:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyHappiness, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyCorruption, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Diplomacy, num));
            break;
        case CharacterTraitType.Addict:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyCorruption, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Diplomacy, -num));
            break;
        case CharacterTraitType.Sober:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyCorruption, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Diplomacy, num));
            break;
        case CharacterTraitType.Courageous:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.WarWeariness, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopRecruitment, num));
            break;
        case CharacterTraitType.Weak:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.WarWeariness, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopRecruitment, -num));
            break;
        case CharacterTraitType.Tolerant:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TradeIncome, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Diplomacy, num));
            break;
        case CharacterTraitType.Xenophobic:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TradeIncome, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Diplomacy, -num));
            break;
        case CharacterTraitType.EloquentSpeaker:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyHappiness, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Diplomacy, num));
            break;
        case CharacterTraitType.PoorSpeaker:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyHappiness, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Diplomacy, -num));
            break;
        case CharacterTraitType.Corrupt:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyCorruption, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TradeIncome, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TourismIncome, -num));
            break;
        case CharacterTraitType.Lawful:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyCorruption, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TradeIncome, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TourismIncome, num));
            break;
        case CharacterTraitType.Lazy:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Diplomacy, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyIncome, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TradeIncome, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TourismIncome, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyCorruption, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyHappiness, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.PopulationGrowth, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MiningRate, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopRecruitment, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MilitaryShipConstructionSpeed, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CivilianShipConstructionSpeed, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyShipConstructionSpeed, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.FacilityConstructionSpeed, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ResearchWeapons, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ResearchEnergy, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ResearchHighTech, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Espionage, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CounterEspionage, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Sabotage, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Concealment, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.PsyOps, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Assassination, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MilitaryShipMaintenance, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CivilianShipMaintenance, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MilitaryBaseMaintenance, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CivilianBaseMaintenance, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopMaintenance, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.WarWeariness, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Targeting, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Countermeasures, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ShipManeuvering, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Fighters, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ShipEnergyUsage, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.WeaponsDamage, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.WeaponsRange, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ShieldRechargeRate, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.DamageControl, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.RepairBonus, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.HyperjumpSpeed, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopGroundAttack, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopGroundDefense, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopExperienceGain, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopRecoveryRate, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopStrengthArmor, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopStrengthInfantry, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopStrengthSpecialForces, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopStrengthPlanetaryDefense, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.SmugglingIncome, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.SmugglingEvasion, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.BoardingAssault, -num2));
            break;
        case CharacterTraitType.Energetic:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Diplomacy, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyIncome, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TradeIncome, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TourismIncome, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyCorruption, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyHappiness, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.PopulationGrowth, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MiningRate, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopRecruitment, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MilitaryShipConstructionSpeed, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CivilianShipConstructionSpeed, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyShipConstructionSpeed, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.FacilityConstructionSpeed, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ResearchWeapons, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ResearchEnergy, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ResearchHighTech, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Espionage, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CounterEspionage, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Sabotage, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Concealment, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.PsyOps, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Assassination, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MilitaryShipMaintenance, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CivilianShipMaintenance, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MilitaryBaseMaintenance, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CivilianBaseMaintenance, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopMaintenance, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.WarWeariness, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Targeting, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Countermeasures, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ShipManeuvering, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Fighters, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ShipEnergyUsage, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.WeaponsDamage, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.WeaponsRange, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ShieldRechargeRate, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.DamageControl, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.RepairBonus, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.HyperjumpSpeed, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopGroundAttack, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopGroundDefense, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopExperienceGain, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopRecoveryRate, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopStrengthArmor, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopStrengthInfantry, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopStrengthSpecialForces, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopStrengthPlanetaryDefense, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.SmugglingIncome, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.SmugglingEvasion, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.BoardingAssault, num2));
            break;
        case CharacterTraitType.Linguist:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Diplomacy, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TourismIncome, num));
            break;
        case CharacterTraitType.TongueTied:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Diplomacy, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TourismIncome, -num));
            break;
        case CharacterTraitType.Technical:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MilitaryShipConstructionSpeed, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CivilianShipConstructionSpeed, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyShipConstructionSpeed, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.FacilityConstructionSpeed, num));
            break;
        case CharacterTraitType.NonTechnical:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MilitaryShipConstructionSpeed, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CivilianShipConstructionSpeed, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyShipConstructionSpeed, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.FacilityConstructionSpeed, -num));
            break;
        case CharacterTraitType.PoorTactician:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Diplomacy, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyIncome, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TradeIncome, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TourismIncome, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyCorruption, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyHappiness, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.PopulationGrowth, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MiningRate, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopRecruitment, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MilitaryShipConstructionSpeed, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CivilianShipConstructionSpeed, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyShipConstructionSpeed, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.FacilityConstructionSpeed, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ResearchWeapons, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ResearchEnergy, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ResearchHighTech, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Espionage, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CounterEspionage, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Sabotage, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Concealment, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.PsyOps, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Assassination, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MilitaryShipMaintenance, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CivilianShipMaintenance, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MilitaryBaseMaintenance, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CivilianBaseMaintenance, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopMaintenance, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.WarWeariness, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Targeting, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Countermeasures, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ShipManeuvering, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Fighters, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ShipEnergyUsage, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.WeaponsDamage, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.WeaponsRange, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ShieldRechargeRate, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.DamageControl, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.RepairBonus, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.HyperjumpSpeed, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopGroundAttack, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopGroundDefense, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopExperienceGain, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopRecoveryRate, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopStrengthArmor, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopStrengthInfantry, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopStrengthSpecialForces, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopStrengthPlanetaryDefense, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.SmugglingIncome, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.SmugglingEvasion, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.BoardingAssault, -num2));
            break;
        case CharacterTraitType.GoodTactician:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Diplomacy, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyIncome, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TradeIncome, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TourismIncome, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyCorruption, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyHappiness, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.PopulationGrowth, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MiningRate, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopRecruitment, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MilitaryShipConstructionSpeed, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CivilianShipConstructionSpeed, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyShipConstructionSpeed, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.FacilityConstructionSpeed, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ResearchWeapons, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ResearchEnergy, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ResearchHighTech, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Espionage, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CounterEspionage, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Sabotage, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Concealment, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.PsyOps, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Assassination, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MilitaryShipMaintenance, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CivilianShipMaintenance, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MilitaryBaseMaintenance, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CivilianBaseMaintenance, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopMaintenance, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.WarWeariness, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Targeting, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Countermeasures, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ShipManeuvering, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Fighters, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ShipEnergyUsage, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.WeaponsDamage, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.WeaponsRange, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ShieldRechargeRate, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.DamageControl, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.RepairBonus, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.HyperjumpSpeed, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopGroundAttack, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopGroundDefense, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopExperienceGain, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopRecoveryRate, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopStrengthArmor, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopStrengthInfantry, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopStrengthSpecialForces, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopStrengthPlanetaryDefense, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.SmugglingIncome, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.SmugglingEvasion, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.BoardingAssault, num2));
            break;
        case CharacterTraitType.StrongSpaceAttacker:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Targeting, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ShipManeuvering, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.WeaponsDamage, num));
            break;
        case CharacterTraitType.PoorSpaceAttacker:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Targeting, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ShipManeuvering, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.WeaponsDamage, -num));
            break;
        case CharacterTraitType.StrongSpaceDefender:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Countermeasures, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ShipManeuvering, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ShieldRechargeRate, num));
            break;
        case CharacterTraitType.PoorSpaceDefender:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Countermeasures, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ShipManeuvering, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ShieldRechargeRate, -num));
            break;
        case CharacterTraitType.Drunk:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Diplomacy, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyIncome, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TradeIncome, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TourismIncome, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyCorruption, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyHappiness, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.PopulationGrowth, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MiningRate, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopRecruitment, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MilitaryShipConstructionSpeed, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CivilianShipConstructionSpeed, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyShipConstructionSpeed, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.FacilityConstructionSpeed, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ResearchWeapons, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ResearchEnergy, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ResearchHighTech, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Espionage, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CounterEspionage, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Sabotage, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Concealment, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.PsyOps, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Assassination, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MilitaryShipMaintenance, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CivilianShipMaintenance, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MilitaryBaseMaintenance, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CivilianBaseMaintenance, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopMaintenance, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.WarWeariness, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Targeting, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Countermeasures, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ShipManeuvering, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Fighters, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ShipEnergyUsage, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.WeaponsDamage, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.WeaponsRange, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ShieldRechargeRate, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.DamageControl, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.RepairBonus, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.HyperjumpSpeed, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopGroundAttack, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopGroundDefense, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopExperienceGain, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopRecoveryRate, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopStrengthArmor, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopStrengthInfantry, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopStrengthSpecialForces, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopStrengthPlanetaryDefense, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.SmugglingIncome, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.SmugglingEvasion, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.BoardingAssault, -num2));
            break;
        case CharacterTraitType.ToughDiscipline:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Diplomacy, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyIncome, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TradeIncome, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TourismIncome, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyCorruption, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyHappiness, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.PopulationGrowth, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MiningRate, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopRecruitment, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MilitaryShipConstructionSpeed, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CivilianShipConstructionSpeed, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyShipConstructionSpeed, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.FacilityConstructionSpeed, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ResearchWeapons, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ResearchEnergy, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ResearchHighTech, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Espionage, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CounterEspionage, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Sabotage, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Concealment, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.PsyOps, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Assassination, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MilitaryShipMaintenance, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CivilianShipMaintenance, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MilitaryBaseMaintenance, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CivilianBaseMaintenance, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopMaintenance, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.WarWeariness, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Targeting, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Countermeasures, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ShipManeuvering, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Fighters, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ShipEnergyUsage, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.WeaponsDamage, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.WeaponsRange, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ShieldRechargeRate, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.DamageControl, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.RepairBonus, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.HyperjumpSpeed, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopGroundAttack, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopGroundDefense, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopExperienceGain, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopRecoveryRate, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopStrengthArmor, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopStrengthInfantry, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopStrengthSpecialForces, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopStrengthPlanetaryDefense, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.SmugglingIncome, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.SmugglingEvasion, num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.BoardingAssault, num2));
            break;
        case CharacterTraitType.LaxDiscipline:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Diplomacy, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyIncome, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TradeIncome, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TourismIncome, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyCorruption, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyHappiness, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.PopulationGrowth, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MiningRate, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopRecruitment, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MilitaryShipConstructionSpeed, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CivilianShipConstructionSpeed, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ColonyShipConstructionSpeed, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.FacilityConstructionSpeed, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ResearchWeapons, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ResearchEnergy, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ResearchHighTech, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Espionage, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CounterEspionage, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Sabotage, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Concealment, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.PsyOps, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Assassination, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MilitaryShipMaintenance, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CivilianShipMaintenance, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.MilitaryBaseMaintenance, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CivilianBaseMaintenance, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopMaintenance, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.WarWeariness, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Targeting, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Countermeasures, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ShipManeuvering, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Fighters, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ShipEnergyUsage, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.WeaponsDamage, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.WeaponsRange, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ShieldRechargeRate, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.DamageControl, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.RepairBonus, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.HyperjumpSpeed, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopGroundAttack, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopGroundDefense, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopExperienceGain, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopRecoveryRate, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopStrengthArmor, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopStrengthInfantry, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopStrengthSpecialForces, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopStrengthPlanetaryDefense, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.SmugglingIncome, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.SmugglingEvasion, -num2));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.BoardingAssault, -num2));
            break;
        case CharacterTraitType.GoodSpaceLogistician:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ShipEnergyUsage, num));
            break;
        case CharacterTraitType.PoorSpaceLogistician:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.ShipEnergyUsage, -num));
            break;
        case CharacterTraitType.NaturalSpaceLeader:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.WeaponsDamage, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.DamageControl, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Targeting, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Countermeasures, num));
            break;
        case CharacterTraitType.SkilledNavigator:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.HyperjumpSpeed, num));
            break;
        case CharacterTraitType.PoorNavigator:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.HyperjumpSpeed, -num));
            break;
        case CharacterTraitType.StrongGroundAttacker:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopGroundAttack, num));
            break;
        case CharacterTraitType.PoorGroundAttacker:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopGroundAttack, -num));
            break;
        case CharacterTraitType.StrongGroundDefender:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopGroundDefense, num));
            break;
        case CharacterTraitType.PoorGroundDefender:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopGroundDefense, -num));
            break;
        case CharacterTraitType.GoodGroundLogistician:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopMaintenance, num));
            break;
        case CharacterTraitType.PoorGroundLogistician:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopMaintenance, -num));
            break;
        case CharacterTraitType.NaturalGroundLeader:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopGroundAttack, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopGroundDefense, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopRecruitment, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopExperienceGain, num));
            break;
        case CharacterTraitType.GoodRecruiter:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopRecruitment, num));
            break;
        case CharacterTraitType.PoorRecruiter:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopRecruitment, -num));
            break;
        case CharacterTraitType.CarefulAttacker:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopGroundAttack, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopGroundDefense, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopRecoveryRate, num));
            break;
        case CharacterTraitType.RecklessAttacker:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopGroundAttack, num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopGroundDefense, -num));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.TroopRecoveryRate, -num));
            break;
        case CharacterTraitType.DoubleAgent:
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Espionage, -num3));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.CounterEspionage, -num3));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Sabotage, -num3));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Concealment, -num3));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.PsyOps, -num3));
            characterSkillList.add(new CharacterSkill(CharacterSkillType.Assassination, -num3));
            break;
    }
    if (role !== 0) {
        const characterSkillList2 = new CharacterSkillList();
        for (let i = 0; i < characterSkillList.count; i++) {
            if (!checkSkillValid(characterSkillList.items[i].type, role)) {
                characterSkillList2.add(characterSkillList.items[i]);
            }
        }
        for (let j = 0; j < characterSkillList2.count; j++) {
            characterSkillList.remove(characterSkillList2.items[j]);
        }
    }
    return characterSkillList;
}

// Galaxy.1.cs DetermineCharacterEventRelevantToRole (2572).
export function determineCharacterEventRelevantToRole(eventType: CharacterEventType, role: CharacterRole): boolean {
    switch (role) {
        case CharacterRole.Ambassador:
            switch (eventType) {
                case CharacterEventType.TreatySigned:
                case CharacterEventType.WarStarted:
                case CharacterEventType.WarEnded:
                case CharacterEventType.TradeIncome:
                case CharacterEventType.TourismIncome:
                case CharacterEventType.IntelligenceMissionSucceedEspionage:
                case CharacterEventType.IntelligenceMissionSucceedSabotage:
                case CharacterEventType.IntelligenceMissionFailEspionage:
                case CharacterEventType.IntelligenceMissionFailSabotage:
                case CharacterEventType.IntelligenceMissionInterceptEnemy:
                case CharacterEventType.IntelligenceAgentOursCaptured:
                case CharacterEventType.IntelligenceAgentRecruited:
                case CharacterEventType.TargetOfFailedAssassination:
                case CharacterEventType.Subjugated:
                case CharacterEventType.TreatyBroken:
                case CharacterEventType.AmbassadorAssignedToEmpire:
                case CharacterEventType.CharacterStart:
                case CharacterEventType.CharacterTraitGain:
                case CharacterEventType.CharacterSkillGain:
                case CharacterEventType.CharacterSkillProgress:
                case CharacterEventType.CharacterTransferLocation:
                    return true;
            }
            break;
        case CharacterRole.ColonyGovernor:
            switch (eventType) {
                case CharacterEventType.TradeIncome:
                case CharacterEventType.TourismIncome:
                case CharacterEventType.ColonyDevelopmentIncrease:
                case CharacterEventType.ColonyDevelopmentDecrease:
                case CharacterEventType.CashNegative:
                case CharacterEventType.CashPositive:
                case CharacterEventType.TroopComplete:
                case CharacterEventType.BuildMilitaryShip:
                case CharacterEventType.BuildCivilianShip:
                case CharacterEventType.BuildColonyShip:
                case CharacterEventType.BuildMilitaryBase:
                case CharacterEventType.BuildSpaceport:
                case CharacterEventType.BuildResearchStationWeapons:
                case CharacterEventType.BuildResearchStationEnergy:
                case CharacterEventType.BuildResearchStationHighTech:
                case CharacterEventType.BuildMiningStation:
                case CharacterEventType.BuildResortBase:
                case CharacterEventType.BuildOtherBase:
                case CharacterEventType.BuildFacility:
                case CharacterEventType.BuildWonder:
                case CharacterEventType.TargetOfFailedAssassination:
                case CharacterEventType.CharacterStart:
                case CharacterEventType.CharacterTraitGain:
                case CharacterEventType.CharacterSkillGain:
                case CharacterEventType.CharacterSkillProgress:
                case CharacterEventType.CharacterTransferLocation:
                    return true;
            }
            break;
        case CharacterRole.FleetAdmiral:
            switch (eventType) {
                case CharacterEventType.WarStarted:
                case CharacterEventType.WarEnded:
                case CharacterEventType.HyperjumpExit:
                case CharacterEventType.SpaceBattle:
                case CharacterEventType.TargetOfFailedAssassination:
                case CharacterEventType.CharacterStart:
                case CharacterEventType.CharacterTraitGain:
                case CharacterEventType.CharacterSkillGain:
                case CharacterEventType.CharacterSkillProgress:
                case CharacterEventType.CharacterTransferLocation:
                case CharacterEventType.Raid:
                    return true;
            }
            break;
        case CharacterRole.ShipCaptain:
            switch (eventType) {
                case CharacterEventType.WarStarted:
                case CharacterEventType.WarEnded:
                case CharacterEventType.HyperjumpExit:
                case CharacterEventType.SpaceBattle:
                case CharacterEventType.TargetOfFailedAssassination:
                case CharacterEventType.CharacterStart:
                case CharacterEventType.CharacterTraitGain:
                case CharacterEventType.CharacterSkillGain:
                case CharacterEventType.CharacterSkillProgress:
                case CharacterEventType.CharacterTransferLocation:
                case CharacterEventType.Boarding:
                case CharacterEventType.Raid:
                case CharacterEventType.SmugglingSuccess:
                case CharacterEventType.SmugglingDetection:
                    return true;
            }
            break;
        case CharacterRole.IntelligenceAgent:
            switch (eventType) {
                case CharacterEventType.IntelligenceMissionSucceedEspionage:
                case CharacterEventType.IntelligenceMissionSucceedSabotage:
                case CharacterEventType.IntelligenceMissionFailEspionage:
                case CharacterEventType.IntelligenceMissionFailSabotage:
                case CharacterEventType.IntelligenceMissionInterceptEnemy:
                case CharacterEventType.IntelligenceAgentOursCaptured:
                case CharacterEventType.IntelligenceAgentRecruited:
                case CharacterEventType.TargetOfFailedAssassination:
                case CharacterEventType.CharacterStart:
                case CharacterEventType.CharacterTraitGain:
                case CharacterEventType.CharacterSkillGain:
                case CharacterEventType.CharacterSkillProgress:
                case CharacterEventType.CharacterTransferLocation:
                    return true;
            }
            break;
        case CharacterRole.Leader:
        case CharacterRole.PirateLeader:
            return true;
        case CharacterRole.Scientist:
            switch (eventType) {
                case CharacterEventType.ResearchAdvanceWeapons:
                case CharacterEventType.ResearchAdvanceEnergy:
                case CharacterEventType.ResearchAdvanceHighTech:
                case CharacterEventType.BuildResearchStationWeapons:
                case CharacterEventType.BuildResearchStationEnergy:
                case CharacterEventType.BuildResearchStationHighTech:
                case CharacterEventType.TargetOfFailedAssassination:
                case CharacterEventType.CriticalResearchSuccess:
                case CharacterEventType.CriticalResearchFailure:
                case CharacterEventType.CharacterStart:
                case CharacterEventType.CharacterTraitGain:
                case CharacterEventType.CharacterSkillGain:
                case CharacterEventType.CharacterSkillProgress:
                case CharacterEventType.CharacterTransferLocation:
                    return true;
            }
            break;
        case CharacterRole.TroopGeneral:
            switch (eventType) {
                case CharacterEventType.WarStarted:
                case CharacterEventType.WarEnded:
                case CharacterEventType.TroopComplete:
                case CharacterEventType.BuildMilitaryBase:
                case CharacterEventType.BuildFacility:
                case CharacterEventType.BuildWonder:
                case CharacterEventType.GroundInvasion:
                case CharacterEventType.TargetOfFailedAssassination:
                case CharacterEventType.CharacterStart:
                case CharacterEventType.CharacterTraitGain:
                case CharacterEventType.CharacterSkillGain:
                case CharacterEventType.CharacterSkillProgress:
                case CharacterEventType.CharacterTransferLocation:
                    return true;
            }
            break;
    }
    return false;
}

// Galaxy.1.cs IntersectTraitLists.
function intersectTraitLists(traits1: CharacterTraitType[] | null, traits2: CharacterTraitType[] | null): CharacterTraitType[] {
    const list: CharacterTraitType[] = [];
    if (traits1 !== null && traits2 !== null) {
        for (let i = 0; i < traits1.length; i++) {
            if (traits2.includes(traits1[i])) list.push(traits1[i]);
        }
    }
    return list;
}

// ---------------------------------------------------------------------------
// Character.cs static role tables
// ---------------------------------------------------------------------------

// Character.cs DetermineValidSkillsForRole (1000/1005).
export function determineValidSkillsForRole(role: CharacterRole, primarySkills = true, secondarySkills = true): CharacterSkillType[] {
    const list: CharacterSkillType[] = [];
    switch (role) {
        case CharacterRole.Ambassador:
            if (primarySkills) {
                list.push(CharacterSkillType.Diplomacy);
                list.push(CharacterSkillType.CounterEspionage);
            }
            if (secondarySkills) {
                list.push(CharacterSkillType.TradeIncome);
                list.push(CharacterSkillType.TourismIncome);
                list.push(CharacterSkillType.Espionage);
            }
            break;
        case CharacterRole.ColonyGovernor:
            if (primarySkills) {
                list.push(CharacterSkillType.ColonyIncome);
                list.push(CharacterSkillType.ColonyHappiness);
                list.push(CharacterSkillType.PopulationGrowth);
            }
            if (secondarySkills) {
                list.push(CharacterSkillType.TradeIncome);
                list.push(CharacterSkillType.TourismIncome);
                list.push(CharacterSkillType.ColonyCorruption);
                list.push(CharacterSkillType.MiningRate);
                list.push(CharacterSkillType.TroopRecruitment);
                list.push(CharacterSkillType.MilitaryShipConstructionSpeed);
                list.push(CharacterSkillType.CivilianShipConstructionSpeed);
                list.push(CharacterSkillType.ColonyShipConstructionSpeed);
                list.push(CharacterSkillType.FacilityConstructionSpeed);
                list.push(CharacterSkillType.MilitaryBaseMaintenance);
                list.push(CharacterSkillType.CivilianBaseMaintenance);
                list.push(CharacterSkillType.TroopMaintenance);
                list.push(CharacterSkillType.WarWeariness);
            }
            break;
        case CharacterRole.FleetAdmiral:
            if (primarySkills) {
                list.push(CharacterSkillType.Targeting);
                list.push(CharacterSkillType.Countermeasures);
                list.push(CharacterSkillType.ShipManeuvering);
                list.push(CharacterSkillType.ShipEnergyUsage);
                list.push(CharacterSkillType.DamageControl);
                list.push(CharacterSkillType.RepairBonus);
                list.push(CharacterSkillType.HyperjumpSpeed);
            }
            if (secondarySkills) {
                list.push(CharacterSkillType.MilitaryShipMaintenance);
                list.push(CharacterSkillType.Fighters);
                list.push(CharacterSkillType.WeaponsDamage);
                list.push(CharacterSkillType.WeaponsRange);
                list.push(CharacterSkillType.ShieldRechargeRate);
                list.push(CharacterSkillType.BoardingAssault);
            }
            break;
        case CharacterRole.IntelligenceAgent:
            if (primarySkills) {
                list.push(CharacterSkillType.Espionage);
                list.push(CharacterSkillType.CounterEspionage);
                list.push(CharacterSkillType.Sabotage);
            }
            if (secondarySkills) {
                list.push(CharacterSkillType.PsyOps);
                list.push(CharacterSkillType.Concealment);
                list.push(CharacterSkillType.Assassination);
            }
            break;
        case CharacterRole.Leader:
            if (primarySkills) {
                list.push(CharacterSkillType.Diplomacy);
                list.push(CharacterSkillType.ColonyIncome);
                list.push(CharacterSkillType.ColonyHappiness);
                list.push(CharacterSkillType.PopulationGrowth);
            }
            if (secondarySkills) {
                list.push(CharacterSkillType.TradeIncome);
                list.push(CharacterSkillType.TourismIncome);
                list.push(CharacterSkillType.ColonyCorruption);
                list.push(CharacterSkillType.MiningRate);
                list.push(CharacterSkillType.TroopRecruitment);
                list.push(CharacterSkillType.MilitaryShipConstructionSpeed);
                list.push(CharacterSkillType.CivilianShipConstructionSpeed);
                list.push(CharacterSkillType.ColonyShipConstructionSpeed);
                list.push(CharacterSkillType.FacilityConstructionSpeed);
                list.push(CharacterSkillType.ResearchWeapons);
                list.push(CharacterSkillType.ResearchEnergy);
                list.push(CharacterSkillType.ResearchHighTech);
                list.push(CharacterSkillType.Espionage);
                list.push(CharacterSkillType.CounterEspionage);
                list.push(CharacterSkillType.MilitaryShipMaintenance);
                list.push(CharacterSkillType.MilitaryBaseMaintenance);
                list.push(CharacterSkillType.CivilianShipMaintenance);
                list.push(CharacterSkillType.CivilianBaseMaintenance);
                list.push(CharacterSkillType.TroopMaintenance);
                list.push(CharacterSkillType.WarWeariness);
            }
            break;
        case CharacterRole.PirateLeader:
            if (primarySkills) {
                list.push(CharacterSkillType.Diplomacy);
                list.push(CharacterSkillType.Espionage);
                list.push(CharacterSkillType.MilitaryShipConstructionSpeed);
                list.push(CharacterSkillType.CivilianShipConstructionSpeed);
                list.push(CharacterSkillType.MilitaryShipMaintenance);
                list.push(CharacterSkillType.MilitaryBaseMaintenance);
                list.push(CharacterSkillType.CivilianShipMaintenance);
                list.push(CharacterSkillType.CivilianBaseMaintenance);
            }
            if (secondarySkills) {
                list.push(CharacterSkillType.TradeIncome);
                list.push(CharacterSkillType.TourismIncome);
                list.push(CharacterSkillType.MiningRate);
                list.push(CharacterSkillType.FacilityConstructionSpeed);
                list.push(CharacterSkillType.ResearchWeapons);
                list.push(CharacterSkillType.ResearchEnergy);
                list.push(CharacterSkillType.ResearchHighTech);
                list.push(CharacterSkillType.CounterEspionage);
                list.push(CharacterSkillType.Targeting);
                list.push(CharacterSkillType.Countermeasures);
                list.push(CharacterSkillType.ShipManeuvering);
                list.push(CharacterSkillType.ShipEnergyUsage);
                list.push(CharacterSkillType.DamageControl);
                list.push(CharacterSkillType.RepairBonus);
                list.push(CharacterSkillType.HyperjumpSpeed);
                list.push(CharacterSkillType.Fighters);
                list.push(CharacterSkillType.WeaponsDamage);
                list.push(CharacterSkillType.WeaponsRange);
                list.push(CharacterSkillType.ShieldRechargeRate);
                list.push(CharacterSkillType.SmugglingIncome);
                list.push(CharacterSkillType.SmugglingEvasion);
                list.push(CharacterSkillType.BoardingAssault);
            }
            break;
        case CharacterRole.ShipCaptain:
            if (primarySkills) {
                list.push(CharacterSkillType.Targeting);
                list.push(CharacterSkillType.Countermeasures);
                list.push(CharacterSkillType.ShipManeuvering);
                list.push(CharacterSkillType.ShipEnergyUsage);
                list.push(CharacterSkillType.DamageControl);
                list.push(CharacterSkillType.RepairBonus);
                list.push(CharacterSkillType.HyperjumpSpeed);
            }
            if (secondarySkills) {
                list.push(CharacterSkillType.MilitaryShipMaintenance);
                list.push(CharacterSkillType.Fighters);
                list.push(CharacterSkillType.WeaponsDamage);
                list.push(CharacterSkillType.WeaponsRange);
                list.push(CharacterSkillType.ShieldRechargeRate);
                list.push(CharacterSkillType.SmugglingIncome);
                list.push(CharacterSkillType.SmugglingEvasion);
                list.push(CharacterSkillType.BoardingAssault);
            }
            break;
        case CharacterRole.Scientist:
            if (primarySkills) {
                list.push(CharacterSkillType.ResearchWeapons);
                list.push(CharacterSkillType.ResearchEnergy);
                list.push(CharacterSkillType.ResearchHighTech);
            }
            break;
        case CharacterRole.TroopGeneral:
            if (primarySkills) {
                list.push(CharacterSkillType.TroopGroundAttack);
                list.push(CharacterSkillType.TroopGroundDefense);
                list.push(CharacterSkillType.TroopRecoveryRate);
            }
            if (secondarySkills) {
                list.push(CharacterSkillType.TroopMaintenance);
                list.push(CharacterSkillType.TroopRecruitment);
                list.push(CharacterSkillType.TroopExperienceGain);
                list.push(CharacterSkillType.TroopStrengthArmor);
                list.push(CharacterSkillType.TroopStrengthInfantry);
                list.push(CharacterSkillType.TroopStrengthSpecialForces);
                list.push(CharacterSkillType.TroopStrengthPlanetaryDefense);
            }
            break;
    }
    return list;
}

// Character.cs CheckSkillValid (1219).
export function checkSkillValid(skillType: CharacterSkillType, role: CharacterRole): boolean {
    const list = determineValidSkillsForRole(role);
    if (list.includes(skillType)) return true;
    return false;
}

// Character.cs DetermineValidTraitsForRole (3537/3542/3547): the 1-arg overload passes
// includeStartingTraits false, the 2-arg overload includeHighlyNegativeTraits true.
export function determineValidTraitsForRole(role: CharacterRole, includeStartingTraits = false, includeHighlyNegativeTraits = true): CharacterTraitType[] {
    const list: CharacterTraitType[] = [];
    switch (role) {
        case CharacterRole.Ambassador:
            if (includeStartingTraits) {
                list.push(CharacterTraitType.Trusting);
                list.push(CharacterTraitType.InspiringPresence);
                list.push(CharacterTraitType.Demoralizing);
                list.push(CharacterTraitType.Spiritual);
                list.push(CharacterTraitType.Logical);
                list.push(CharacterTraitType.Energetic);
            }
            if (includeHighlyNegativeTraits) {
                list.push(CharacterTraitType.Addict);
                list.push(CharacterTraitType.Lazy);
            }
            list.push(CharacterTraitType.Linguist);
            list.push(CharacterTraitType.TongueTied);
            list.push(CharacterTraitType.Diplomat);
            list.push(CharacterTraitType.Obnoxious);
            list.push(CharacterTraitType.Paranoid);
            list.push(CharacterTraitType.Famous);
            list.push(CharacterTraitType.Disliked);
            list.push(CharacterTraitType.FreeTrader);
            list.push(CharacterTraitType.Protectionist);
            list.push(CharacterTraitType.Uninhibited);
            list.push(CharacterTraitType.Measured);
            list.push(CharacterTraitType.Sober);
            list.push(CharacterTraitType.Tolerant);
            list.push(CharacterTraitType.Xenophobic);
            list.push(CharacterTraitType.EloquentSpeaker);
            list.push(CharacterTraitType.PoorSpeaker);
            list.push(CharacterTraitType.Corrupt);
            list.push(CharacterTraitType.Lawful);
            break;
        case CharacterRole.ColonyGovernor:
            if (includeStartingTraits) {
                list.push(CharacterTraitType.Trusting);
                list.push(CharacterTraitType.InspiringPresence);
                list.push(CharacterTraitType.Demoralizing);
                list.push(CharacterTraitType.Spiritual);
                list.push(CharacterTraitType.Logical);
                list.push(CharacterTraitType.Energetic);
            }
            if (includeHighlyNegativeTraits) {
                list.push(CharacterTraitType.Luddite);
                list.push(CharacterTraitType.Addict);
                list.push(CharacterTraitType.Lazy);
            }
            list.push(CharacterTraitType.Paranoid);
            list.push(CharacterTraitType.PeaceThroughStrength);
            list.push(CharacterTraitType.Pacifist);
            list.push(CharacterTraitType.Expansionist);
            list.push(CharacterTraitType.Isolationist);
            list.push(CharacterTraitType.Famous);
            list.push(CharacterTraitType.Disliked);
            list.push(CharacterTraitType.GoodAdministrator);
            list.push(CharacterTraitType.PoorAdministrator);
            list.push(CharacterTraitType.BeanCounter);
            list.push(CharacterTraitType.Generous);
            list.push(CharacterTraitType.Engineer);
            list.push(CharacterTraitType.FreeTrader);
            list.push(CharacterTraitType.Protectionist);
            list.push(CharacterTraitType.Environmentalist);
            list.push(CharacterTraitType.Industrialist);
            list.push(CharacterTraitType.Organized);
            list.push(CharacterTraitType.Disorganized);
            list.push(CharacterTraitType.HealthOriented);
            list.push(CharacterTraitType.LaborOriented);
            list.push(CharacterTraitType.GoodStrategist);
            list.push(CharacterTraitType.PoorStrategist);
            list.push(CharacterTraitType.Uninhibited);
            list.push(CharacterTraitType.Measured);
            list.push(CharacterTraitType.Sober);
            list.push(CharacterTraitType.Courageous);
            list.push(CharacterTraitType.Weak);
            list.push(CharacterTraitType.Tolerant);
            list.push(CharacterTraitType.Xenophobic);
            list.push(CharacterTraitType.EloquentSpeaker);
            list.push(CharacterTraitType.PoorSpeaker);
            list.push(CharacterTraitType.Corrupt);
            list.push(CharacterTraitType.Lawful);
            list.push(CharacterTraitType.Technical);
            list.push(CharacterTraitType.NonTechnical);
            break;
        case CharacterRole.FleetAdmiral:
            if (includeStartingTraits) {
                list.push(CharacterTraitType.InspiringPresence);
                list.push(CharacterTraitType.Demoralizing);
                list.push(CharacterTraitType.Energetic);
                list.push(CharacterTraitType.ToughDiscipline);
                list.push(CharacterTraitType.NaturalSpaceLeader);
                if (includeHighlyNegativeTraits) {
                    list.push(CharacterTraitType.LaxDiscipline);
                }
            }
            if (includeHighlyNegativeTraits) {
                list.push(CharacterTraitType.Lazy);
                list.push(CharacterTraitType.Drunk);
            }
            list.push(CharacterTraitType.GoodTactician);
            list.push(CharacterTraitType.PoorTactician);
            list.push(CharacterTraitType.StrongSpaceAttacker);
            list.push(CharacterTraitType.PoorSpaceAttacker);
            list.push(CharacterTraitType.StrongSpaceDefender);
            list.push(CharacterTraitType.PoorSpaceDefender);
            list.push(CharacterTraitType.LocalDefenseTactics);
            list.push(CharacterTraitType.GoodSpaceLogistician);
            list.push(CharacterTraitType.PoorSpaceLogistician);
            list.push(CharacterTraitType.SkilledNavigator);
            list.push(CharacterTraitType.PoorNavigator);
            break;
        case CharacterRole.ShipCaptain:
            if (includeStartingTraits) {
                list.push(CharacterTraitType.InspiringPresence);
                list.push(CharacterTraitType.Demoralizing);
                list.push(CharacterTraitType.Energetic);
                list.push(CharacterTraitType.ToughDiscipline);
                list.push(CharacterTraitType.NaturalSpaceLeader);
                if (includeHighlyNegativeTraits) {
                    list.push(CharacterTraitType.LaxDiscipline);
                }
            }
            if (includeHighlyNegativeTraits) {
                list.push(CharacterTraitType.Lazy);
                list.push(CharacterTraitType.Drunk);
            }
            list.push(CharacterTraitType.GoodTactician);
            list.push(CharacterTraitType.PoorTactician);
            list.push(CharacterTraitType.StrongSpaceAttacker);
            list.push(CharacterTraitType.PoorSpaceAttacker);
            list.push(CharacterTraitType.StrongSpaceDefender);
            list.push(CharacterTraitType.PoorSpaceDefender);
            list.push(CharacterTraitType.LocalDefenseTactics);
            list.push(CharacterTraitType.GoodSpaceLogistician);
            list.push(CharacterTraitType.PoorSpaceLogistician);
            list.push(CharacterTraitType.SkilledNavigator);
            list.push(CharacterTraitType.PoorNavigator);
            list.push(CharacterTraitType.Smuggler);
            list.push(CharacterTraitType.BountyHunter);
            break;
        case CharacterRole.IntelligenceAgent:
            if (includeStartingTraits) {
                list.push(CharacterTraitType.InspiringPresence);
                list.push(CharacterTraitType.Demoralizing);
                list.push(CharacterTraitType.IntelligenceCourageous);
                list.push(CharacterTraitType.Energetic);
            }
            if (includeHighlyNegativeTraits) {
                list.push(CharacterTraitType.Lazy);
                list.push(CharacterTraitType.IntelligenceAddict);
                list.push(CharacterTraitType.DoubleAgent);
            }
            list.push(CharacterTraitType.IntelligenceUninhibited);
            list.push(CharacterTraitType.IntelligenceMeasured);
            list.push(CharacterTraitType.IntelligenceSober);
            list.push(CharacterTraitType.IntelligenceWeak);
            list.push(CharacterTraitType.IntelligenceTolerant);
            list.push(CharacterTraitType.IntelligenceXenophobic);
            list.push(CharacterTraitType.IntelligenceEloquentSpeaker);
            list.push(CharacterTraitType.IntelligencePoorSpeaker);
            list.push(CharacterTraitType.IntelligenceCorrupt);
            list.push(CharacterTraitType.IntelligenceLawful);
            break;
        case CharacterRole.Leader:
            if (includeStartingTraits) {
                list.push(CharacterTraitType.Trusting);
                list.push(CharacterTraitType.InspiringPresence);
                list.push(CharacterTraitType.Demoralizing);
                list.push(CharacterTraitType.Spiritual);
                list.push(CharacterTraitType.Logical);
                list.push(CharacterTraitType.Courageous);
                list.push(CharacterTraitType.Energetic);
            }
            if (includeHighlyNegativeTraits) {
                list.push(CharacterTraitType.Luddite);
                list.push(CharacterTraitType.Addict);
                list.push(CharacterTraitType.Lazy);
            }
            list.push(CharacterTraitType.Paranoid);
            list.push(CharacterTraitType.PeaceThroughStrength);
            list.push(CharacterTraitType.Pacifist);
            list.push(CharacterTraitType.Expansionist);
            list.push(CharacterTraitType.Isolationist);
            list.push(CharacterTraitType.Diplomat);
            list.push(CharacterTraitType.Obnoxious);
            list.push(CharacterTraitType.Famous);
            list.push(CharacterTraitType.Disliked);
            list.push(CharacterTraitType.GoodAdministrator);
            list.push(CharacterTraitType.PoorAdministrator);
            list.push(CharacterTraitType.BeanCounter);
            list.push(CharacterTraitType.Generous);
            list.push(CharacterTraitType.Engineer);
            list.push(CharacterTraitType.FreeTrader);
            list.push(CharacterTraitType.Protectionist);
            list.push(CharacterTraitType.Environmentalist);
            list.push(CharacterTraitType.Industrialist);
            list.push(CharacterTraitType.Organized);
            list.push(CharacterTraitType.Disorganized);
            list.push(CharacterTraitType.HealthOriented);
            list.push(CharacterTraitType.LaborOriented);
            list.push(CharacterTraitType.GoodStrategist);
            list.push(CharacterTraitType.PoorStrategist);
            list.push(CharacterTraitType.Uninhibited);
            list.push(CharacterTraitType.Measured);
            list.push(CharacterTraitType.Sober);
            list.push(CharacterTraitType.Weak);
            list.push(CharacterTraitType.Tolerant);
            list.push(CharacterTraitType.Xenophobic);
            list.push(CharacterTraitType.EloquentSpeaker);
            list.push(CharacterTraitType.PoorSpeaker);
            list.push(CharacterTraitType.Corrupt);
            list.push(CharacterTraitType.Lawful);
            break;
        case CharacterRole.PirateLeader:
            if (includeStartingTraits) {
                list.push(CharacterTraitType.Trusting);
                list.push(CharacterTraitType.InspiringPresence);
                list.push(CharacterTraitType.Demoralizing);
                list.push(CharacterTraitType.Spiritual);
                list.push(CharacterTraitType.Logical);
                list.push(CharacterTraitType.Energetic);
                list.push(CharacterTraitType.ToughDiscipline);
                list.push(CharacterTraitType.NaturalSpaceLeader);
                if (includeHighlyNegativeTraits) {
                    list.push(CharacterTraitType.LaxDiscipline);
                }
            }
            if (includeHighlyNegativeTraits) {
                list.push(CharacterTraitType.Luddite);
                list.push(CharacterTraitType.Addict);
                list.push(CharacterTraitType.Lazy);
                list.push(CharacterTraitType.Drunk);
            }
            list.push(CharacterTraitType.Paranoid);
            list.push(CharacterTraitType.PeaceThroughStrength);
            list.push(CharacterTraitType.Pacifist);
            list.push(CharacterTraitType.Expansionist);
            list.push(CharacterTraitType.Isolationist);
            list.push(CharacterTraitType.Diplomat);
            list.push(CharacterTraitType.Obnoxious);
            list.push(CharacterTraitType.Famous);
            list.push(CharacterTraitType.Disliked);
            list.push(CharacterTraitType.Engineer);
            list.push(CharacterTraitType.FreeTrader);
            list.push(CharacterTraitType.Protectionist);
            list.push(CharacterTraitType.Environmentalist);
            list.push(CharacterTraitType.Industrialist);
            list.push(CharacterTraitType.Organized);
            list.push(CharacterTraitType.Disorganized);
            list.push(CharacterTraitType.GoodStrategist);
            list.push(CharacterTraitType.PoorStrategist);
            list.push(CharacterTraitType.Uninhibited);
            list.push(CharacterTraitType.Measured);
            list.push(CharacterTraitType.Sober);
            list.push(CharacterTraitType.Tolerant);
            list.push(CharacterTraitType.Xenophobic);
            list.push(CharacterTraitType.EloquentSpeaker);
            list.push(CharacterTraitType.PoorSpeaker);
            list.push(CharacterTraitType.Corrupt);
            list.push(CharacterTraitType.Lawful);
            list.push(CharacterTraitType.GoodTactician);
            list.push(CharacterTraitType.PoorTactician);
            list.push(CharacterTraitType.StrongSpaceAttacker);
            list.push(CharacterTraitType.PoorSpaceAttacker);
            list.push(CharacterTraitType.StrongSpaceDefender);
            list.push(CharacterTraitType.PoorSpaceDefender);
            list.push(CharacterTraitType.LocalDefenseTactics);
            list.push(CharacterTraitType.GoodSpaceLogistician);
            list.push(CharacterTraitType.PoorSpaceLogistician);
            list.push(CharacterTraitType.SkilledNavigator);
            list.push(CharacterTraitType.PoorNavigator);
            break;
        case CharacterRole.Scientist:
            if (includeStartingTraits) {
                list.push(CharacterTraitType.InspiringPresence);
                list.push(CharacterTraitType.Demoralizing);
                list.push(CharacterTraitType.Energetic);
                list.push(CharacterTraitType.UltraGenius);
            }
            if (includeHighlyNegativeTraits) {
                list.push(CharacterTraitType.Lazy);
            }
            list.push(CharacterTraitType.Creative);
            list.push(CharacterTraitType.Methodical);
            list.push(CharacterTraitType.ForeignSpy);
            list.push(CharacterTraitType.Patriot);
            break;
        case CharacterRole.TroopGeneral:
            if (includeStartingTraits) {
                list.push(CharacterTraitType.InspiringPresence);
                list.push(CharacterTraitType.Demoralizing);
                list.push(CharacterTraitType.Energetic);
                list.push(CharacterTraitType.ToughDiscipline);
                list.push(CharacterTraitType.NaturalGroundLeader);
                if (includeHighlyNegativeTraits) {
                    list.push(CharacterTraitType.LaxDiscipline);
                }
            }
            if (includeHighlyNegativeTraits) {
                list.push(CharacterTraitType.Lazy);
                list.push(CharacterTraitType.Drunk);
            }
            list.push(CharacterTraitType.GoodTactician);
            list.push(CharacterTraitType.PoorTactician);
            list.push(CharacterTraitType.StrongGroundAttacker);
            list.push(CharacterTraitType.PoorGroundAttacker);
            list.push(CharacterTraitType.StrongGroundDefender);
            list.push(CharacterTraitType.PoorGroundDefender);
            list.push(CharacterTraitType.GoodGroundLogistician);
            list.push(CharacterTraitType.PoorGroundLogistician);
            list.push(CharacterTraitType.GoodRecruiter);
            list.push(CharacterTraitType.PoorRecruiter);
            list.push(CharacterTraitType.CarefulAttacker);
            list.push(CharacterTraitType.RecklessAttacker);
            break;
    }
    return list;
}

// ---------------------------------------------------------------------------
// Character.cs
// ---------------------------------------------------------------------------

// BaconCharacter.cs IncrementSkillProgress (23): 3 (mySkillMultiplier) for "Romulan" empires.
function baconIncrementSkillProgress(character: Character): number {
    let num = 1;
    if (character.empire !== null && character.empire.name.includes('Romulan')) num = 3;
    return num;
}

export class Character {
    name: string;
    race: Race | null;
    private _pictureFilename: string;
    private _startDate = 0;
    private _endDate = 0;
    private _active = false;
    private _empire: Empire | null = null;
    // TODO(port): IntelligenceMission (IntelligenceMission.cs) — null at game start.
    private _mission: unknown = null;
    private _appearanceOrder = 0;
    private _location: StellarObject | null = null;
    private _transferDestination: StellarObject | null = null;
    private _transferTimeRemaining = 0; // float
    private _transferArrivalDate = LONG_MAX_VALUE;
    // C# DateTime _LastTouch — galaxy.currentTimeSeconds (Galaxy.CurrentDateTime model).
    private _lastTouch = 0;
    role: CharacterRole;
    skills = new CharacterSkillList();
    traitSkills = new CharacterSkillList();
    traits: CharacterTraitType[] = [];
    eventHistory: CharacterEvent[] = [];
    bonusesKnown = false;
    // Character.cs sbyte _<Skill> / _<Skill>Traits caches (59-257), indexed by CharacterSkillType
    // (_TroopRecruitmentRate ↔ TroopRecruitment).
    private readonly skillBase = new Int8Array(CHARACTER_SKILL_TYPE_COUNT);
    private readonly skillTraits = new Int8Array(CHARACTER_SKILL_TYPE_COUNT);

    // Character.cs ctor (4248). Note: the C# checks `_Location != null` before assigning it, so
    // the location argument is never used (the character gets a location only via Activate /
    // CompleteLocationTransfer).
    constructor(name: string, role: CharacterRole, pictureFilename: string, race: Race | null, empire: Empire | null, location: StellarObject | null, appearanceOrder: number) {
        void location;
        this.name = name;
        this.race = race;
        this.role = role;
        this._pictureFilename = pictureFilename;
        this._empire = empire;
        if (this._empire !== null && !empireCharacters(this._empire).includes(this)) {
            empireCharacters(this._empire).push(this);
        }
        if (this._location !== null) {
            let list = stellarObjectCharacters(this._location);
            if (list === null) setStellarObjectCharacters(this._location, (list = []));
            if (!list.includes(this)) list.push(this);
        }
        this._appearanceOrder = appearanceOrder;
        this._active = false;
    }

    get transferArrivalDate(): number { return this._transferArrivalDate; }
    // Character.cs 261-371: <Skill> => _<Skill> + _<Skill>Traits (sbyte + sbyte → int).
    get diplomacy(): number { return this.skillBase[CharacterSkillType.Diplomacy] + this.skillTraits[CharacterSkillType.Diplomacy]; }
    get colonyIncome(): number { return this.skillBase[CharacterSkillType.ColonyIncome] + this.skillTraits[CharacterSkillType.ColonyIncome]; }
    get tradeIncome(): number { return this.skillBase[CharacterSkillType.TradeIncome] + this.skillTraits[CharacterSkillType.TradeIncome]; }
    get tourismIncome(): number { return this.skillBase[CharacterSkillType.TourismIncome] + this.skillTraits[CharacterSkillType.TourismIncome]; }
    get colonyCorruption(): number { return this.skillBase[CharacterSkillType.ColonyCorruption] + this.skillTraits[CharacterSkillType.ColonyCorruption]; }
    get colonyHappiness(): number { return this.skillBase[CharacterSkillType.ColonyHappiness] + this.skillTraits[CharacterSkillType.ColonyHappiness]; }
    get populationGrowth(): number { return this.skillBase[CharacterSkillType.PopulationGrowth] + this.skillTraits[CharacterSkillType.PopulationGrowth]; }
    get miningRate(): number { return this.skillBase[CharacterSkillType.MiningRate] + this.skillTraits[CharacterSkillType.MiningRate]; }
    get troopRecruitmentRate(): number { return this.skillBase[CharacterSkillType.TroopRecruitment] + this.skillTraits[CharacterSkillType.TroopRecruitment]; }
    get militaryShipConstructionSpeed(): number { return this.skillBase[CharacterSkillType.MilitaryShipConstructionSpeed] + this.skillTraits[CharacterSkillType.MilitaryShipConstructionSpeed]; }
    get civilianShipConstructionSpeed(): number { return this.skillBase[CharacterSkillType.CivilianShipConstructionSpeed] + this.skillTraits[CharacterSkillType.CivilianShipConstructionSpeed]; }
    get colonyShipConstructionSpeed(): number { return this.skillBase[CharacterSkillType.ColonyShipConstructionSpeed] + this.skillTraits[CharacterSkillType.ColonyShipConstructionSpeed]; }
    get facilityConstructionSpeed(): number { return this.skillBase[CharacterSkillType.FacilityConstructionSpeed] + this.skillTraits[CharacterSkillType.FacilityConstructionSpeed]; }
    get researchWeapons(): number { return this.skillBase[CharacterSkillType.ResearchWeapons] + this.skillTraits[CharacterSkillType.ResearchWeapons]; }
    get researchEnergy(): number { return this.skillBase[CharacterSkillType.ResearchEnergy] + this.skillTraits[CharacterSkillType.ResearchEnergy]; }
    get researchHighTech(): number { return this.skillBase[CharacterSkillType.ResearchHighTech] + this.skillTraits[CharacterSkillType.ResearchHighTech]; }
    get espionage(): number { return this.skillBase[CharacterSkillType.Espionage] + this.skillTraits[CharacterSkillType.Espionage]; }
    // Character.cs EspionageFactored: (int)(25.0 * (1.0 + (double)Espionage / 100.0 * 3.0)).
    get espionageFactored(): number { return Math.trunc(25.0 * (1.0 + (this.espionage / 100.0) * 3.0)); }
    get counterEspionage(): number { return this.skillBase[CharacterSkillType.CounterEspionage] + this.skillTraits[CharacterSkillType.CounterEspionage]; }
    // Character.cs CounterEspionageFactored: (int)(25.0 * (1.0 + (double)CounterEspionage / 100.0 * 3.0)).
    get counterEspionageFactored(): number { return Math.trunc(25.0 * (1.0 + (this.counterEspionage / 100.0) * 3.0)); }
    get sabotage(): number { return this.skillBase[CharacterSkillType.Sabotage] + this.skillTraits[CharacterSkillType.Sabotage]; }
    // Character.cs SabotageFactored: (int)(25.0 * (1.0 + (double)Sabotage / 100.0 * 3.0)).
    get sabotageFactored(): number { return Math.trunc(25.0 * (1.0 + (this.sabotage / 100.0) * 3.0)); }
    get concealment(): number { return this.skillBase[CharacterSkillType.Concealment] + this.skillTraits[CharacterSkillType.Concealment]; }
    // Character.cs ConcealmentFactored: (int)(25.0 * (1.0 + (double)Concealment / 100.0 * 3.0)).
    get concealmentFactored(): number { return Math.trunc(25.0 * (1.0 + (this.concealment / 100.0) * 3.0)); }
    get psyOps(): number { return this.skillBase[CharacterSkillType.PsyOps] + this.skillTraits[CharacterSkillType.PsyOps]; }
    // Character.cs PsyOpsFactored: (int)(25.0 * (1.0 + (double)PsyOps / 100.0 * 3.0)).
    get psyOpsFactored(): number { return Math.trunc(25.0 * (1.0 + (this.psyOps / 100.0) * 3.0)); }
    get assassination(): number { return this.skillBase[CharacterSkillType.Assassination] + this.skillTraits[CharacterSkillType.Assassination]; }
    // Character.cs AssassinationFactored: (int)(25.0 * (1.0 + (double)Assassination / 100.0 * 3.0)).
    get assassinationFactored(): number { return Math.trunc(25.0 * (1.0 + (this.assassination / 100.0) * 3.0)); }
    get militaryShipMaintenance(): number { return this.skillBase[CharacterSkillType.MilitaryShipMaintenance] + this.skillTraits[CharacterSkillType.MilitaryShipMaintenance]; }
    get civilianShipMaintenance(): number { return this.skillBase[CharacterSkillType.CivilianShipMaintenance] + this.skillTraits[CharacterSkillType.CivilianShipMaintenance]; }
    get militaryBaseMaintenance(): number { return this.skillBase[CharacterSkillType.MilitaryBaseMaintenance] + this.skillTraits[CharacterSkillType.MilitaryBaseMaintenance]; }
    get civilianBaseMaintenance(): number { return this.skillBase[CharacterSkillType.CivilianBaseMaintenance] + this.skillTraits[CharacterSkillType.CivilianBaseMaintenance]; }
    get troopMaintenance(): number { return this.skillBase[CharacterSkillType.TroopMaintenance] + this.skillTraits[CharacterSkillType.TroopMaintenance]; }
    get warWeariness(): number { return this.skillBase[CharacterSkillType.WarWeariness] + this.skillTraits[CharacterSkillType.WarWeariness]; }
    get targeting(): number { return this.skillBase[CharacterSkillType.Targeting] + this.skillTraits[CharacterSkillType.Targeting]; }
    get countermeasures(): number { return this.skillBase[CharacterSkillType.Countermeasures] + this.skillTraits[CharacterSkillType.Countermeasures]; }
    get shipManeuvering(): number { return this.skillBase[CharacterSkillType.ShipManeuvering] + this.skillTraits[CharacterSkillType.ShipManeuvering]; }
    get fighters(): number { return this.skillBase[CharacterSkillType.Fighters] + this.skillTraits[CharacterSkillType.Fighters]; }
    get shipEnergyUsage(): number { return this.skillBase[CharacterSkillType.ShipEnergyUsage] + this.skillTraits[CharacterSkillType.ShipEnergyUsage]; }
    get weaponsDamage(): number { return this.skillBase[CharacterSkillType.WeaponsDamage] + this.skillTraits[CharacterSkillType.WeaponsDamage]; }
    get weaponsRange(): number { return this.skillBase[CharacterSkillType.WeaponsRange] + this.skillTraits[CharacterSkillType.WeaponsRange]; }
    get shieldRechargeRate(): number { return this.skillBase[CharacterSkillType.ShieldRechargeRate] + this.skillTraits[CharacterSkillType.ShieldRechargeRate]; }
    get damageControl(): number { return this.skillBase[CharacterSkillType.DamageControl] + this.skillTraits[CharacterSkillType.DamageControl]; }
    get repairBonus(): number { return this.skillBase[CharacterSkillType.RepairBonus] + this.skillTraits[CharacterSkillType.RepairBonus]; }
    get hyperjumpSpeed(): number { return this.skillBase[CharacterSkillType.HyperjumpSpeed] + this.skillTraits[CharacterSkillType.HyperjumpSpeed]; }
    get troopGroundAttack(): number { return this.skillBase[CharacterSkillType.TroopGroundAttack] + this.skillTraits[CharacterSkillType.TroopGroundAttack]; }
    get troopGroundDefense(): number { return this.skillBase[CharacterSkillType.TroopGroundDefense] + this.skillTraits[CharacterSkillType.TroopGroundDefense]; }
    get troopExperienceGain(): number { return this.skillBase[CharacterSkillType.TroopExperienceGain] + this.skillTraits[CharacterSkillType.TroopExperienceGain]; }
    get troopRecoveryRate(): number { return this.skillBase[CharacterSkillType.TroopRecoveryRate] + this.skillTraits[CharacterSkillType.TroopRecoveryRate]; }
    get troopStrengthArmor(): number { return this.skillBase[CharacterSkillType.TroopStrengthArmor] + this.skillTraits[CharacterSkillType.TroopStrengthArmor]; }
    get troopStrengthInfantry(): number { return this.skillBase[CharacterSkillType.TroopStrengthInfantry] + this.skillTraits[CharacterSkillType.TroopStrengthInfantry]; }
    get troopStrengthSpecialForces(): number { return this.skillBase[CharacterSkillType.TroopStrengthSpecialForces] + this.skillTraits[CharacterSkillType.TroopStrengthSpecialForces]; }
    get troopStrengthPlanetaryDefense(): number { return this.skillBase[CharacterSkillType.TroopStrengthPlanetaryDefense] + this.skillTraits[CharacterSkillType.TroopStrengthPlanetaryDefense]; }
    get smugglingIncome(): number { return this.skillBase[CharacterSkillType.SmugglingIncome] + this.skillTraits[CharacterSkillType.SmugglingIncome]; }
    get smugglingEvasion(): number { return this.skillBase[CharacterSkillType.SmugglingEvasion] + this.skillTraits[CharacterSkillType.SmugglingEvasion]; }
    get boardingAssault(): number { return this.skillBase[CharacterSkillType.BoardingAssault] + this.skillTraits[CharacterSkillType.BoardingAssault]; }
    get pictureFilename(): string { return this._pictureFilename; }
    set pictureFilename(v: string) { this._pictureFilename = v; }
    get location(): StellarObject | null { return this._location; }
    set location(v: StellarObject | null) { this._location = v; }
    get transferDestination(): StellarObject | null { return this._transferDestination; }
    get transferTimeRemaining(): number { return this._transferTimeRemaining; }
    get mission(): unknown { return this._mission; }
    set mission(v: unknown) { this._mission = v; }
    get empire(): Empire | null { return this._empire; }
    set empire(v: Empire | null) { this._empire = v; }
    get startDate(): number { return this._startDate; }
    set startDate(v: number) { this._startDate = v; }
    get endDate(): number { return this._endDate; }
    set endDate(v: number) { this._endDate = v; }
    get appearanceOrder(): number { return this._appearanceOrder; }
    set appearanceOrder(v: number) { this._appearanceOrder = v; }
    get active(): boolean { return this._active; }
    set active(v: boolean) { this._active = v; }
    get lastTouch(): number { return this._lastTouch; }

    // Character.cs GetSkillLevelTotal (855).
    getSkillLevelTotal(): number {
        let num = 0;
        const list = this.resolveCharacterSkillTypes(true);
        for (let i = 0; i < list.length; i++) num += this.getSkillLevel(list[i]);
        return num;
    }

    // Character.cs ResolveCharacterSkillTypes (866).
    resolveCharacterSkillTypes(includeUnknownBonuses: boolean): CharacterSkillType[] {
        const list: CharacterSkillType[] = [];
        for (let i = 0; i < this.skills.count; i++) list.push(this.skills.items[i].type);
        if (includeUnknownBonuses || this.bonusesKnown) {
            for (let j = 0; j < this.traitSkills.count; j++) {
                if (!list.includes(this.traitSkills.items[j].type)) list.push(this.traitSkills.items[j].type);
            }
        }
        return list;
    }

    // Character.cs GetSkillLevel (886): _<Skill>Traits + _<Skill>; Undefined → 0.
    getSkillLevel(skill: CharacterSkillType): number {
        if (skill <= CharacterSkillType.Undefined || skill >= CHARACTER_SKILL_TYPE_COUNT) return 0;
        return this.skillTraits[skill] + this.skillBase[skill];
    }

    // Character.cs UpdateSkillLevel (698): _<Skill> = (sbyte)level.
    private updateSkillLevel(skill: CharacterSkillType, level: number): void {
        if (skill <= CharacterSkillType.Undefined || skill >= CHARACTER_SKILL_TYPE_COUNT) return;
        this.skillBase[skill] = level;
    }

    // Character.cs AddSkill (944).
    addSkill(skillType: CharacterSkillType, level: number, galaxy: Galaxy | null): boolean {
        for (let i = 0; i < this.skills.count; i++) {
            const characterSkill = this.skills.items[i];
            if (characterSkill !== null && characterSkill.type === skillType) return false;
        }
        let num = 4;
        if (this.role === CharacterRole.IntelligenceAgent) num = 4;
        if (this.skills.count < num * baconIncrementSkillProgress(this)) {
            const characterSkill2 = new CharacterSkill(skillType, level);
            this.skills.add(characterSkill2);
            this.rebuildCachedSkillValues();
            if (galaxy !== null) {
                const currentStarDate = galaxyCurrentStarDate(galaxy);
                const characterEvent = new CharacterEvent(CharacterEventType.CharacterSkillGain, characterSkill2, currentStarDate);
                this.eventHistory.push(characterEvent);
            }
            return true;
        }
        return false;
    }

    // Character.cs GetSkill (975).
    getSkill(skillType: CharacterSkillType): CharacterSkill | null {
        for (let i = 0; i < this.skills.count; i++) {
            const characterSkill = this.skills.items[i];
            if (characterSkill !== null && characterSkill.type === skillType) return characterSkill;
        }
        return null;
    }

    // Character.cs CheckHasSkill (988).
    checkHasSkill(skill: CharacterSkillType): boolean {
        for (let i = 0; i < this.skills.count; i++) {
            if (this.skills.items[i].type === skill) return true;
        }
        return false;
    }

    // Character.cs TotalSkillValuesIfPresent (1205).
    totalSkillValuesIfPresent(skills: CharacterSkillType[]): number {
        let num = 0;
        for (let i = 0; i < skills.length; i++) {
            const skillByType = this.skills.getSkillByType(skills[i]);
            if (skillByType !== null) num += skillByType.level;
        }
        return num;
    }

    // Character.cs AddTrait (1229).
    addTrait(trait: CharacterTraitType, starting: boolean, galaxy: Galaxy | null): boolean {
        if (this.checkNewTraitValid(trait)) {
            const list = determineValidTraitsForRole(this.role, starting);
            if (list.includes(trait)) {
                const num = 4;
                if (this.traits.length < num) {
                    this.traits.push(trait);
                    this.reviewTraitSkills();
                    if (galaxy !== null) {
                        const currentStarDate = galaxyCurrentStarDate(galaxy);
                        const characterEvent = new CharacterEvent(CharacterEventType.CharacterTraitGain, trait, currentStarDate);
                        this.eventHistory.push(characterEvent);
                    }
                    return true;
                }
            }
        }
        return false;
    }

    // Character.cs RemoveAllSkillsAndTraits (1254).
    removeAllSkillsAndTraits(): void {
        this.skills.clear();
        this.traits.length = 0;
        this.rebuildCachedSkillValues();
        this.reviewTraitSkills();
    }

    // Character.cs RemoveTrait (1262).
    removeTrait(trait: CharacterTraitType): boolean {
        if (this.traits.includes(trait)) {
            removeFirst(this.traits, trait);
            this.reviewTraitSkills();
            return true;
        }
        return false;
    }

    // Character.cs CheckNewTraitValid (1273).
    checkNewTraitValid(trait: CharacterTraitType): boolean {
        for (let i = 0; i < this.traits.length; i++) {
            switch (this.traits[i]) {
                case CharacterTraitType.IntelligenceUninhibited:
                case CharacterTraitType.IntelligenceMeasured:
                    if (trait === CharacterTraitType.IntelligenceUninhibited || trait === CharacterTraitType.IntelligenceMeasured) {
                        return false;
                    }
                    break;
                case CharacterTraitType.IntelligenceAddict:
                case CharacterTraitType.IntelligenceSober:
                    if (trait === CharacterTraitType.IntelligenceAddict || trait === CharacterTraitType.IntelligenceSober) {
                        return false;
                    }
                    break;
                case CharacterTraitType.IntelligenceCourageous:
                case CharacterTraitType.IntelligenceWeak:
                    if (trait === CharacterTraitType.IntelligenceCourageous || trait === CharacterTraitType.IntelligenceWeak) {
                        return false;
                    }
                    break;
                case CharacterTraitType.IntelligenceTolerant:
                case CharacterTraitType.IntelligenceXenophobic:
                    if (trait === CharacterTraitType.IntelligenceTolerant || trait === CharacterTraitType.IntelligenceXenophobic) {
                        return false;
                    }
                    break;
                case CharacterTraitType.IntelligenceEloquentSpeaker:
                case CharacterTraitType.IntelligencePoorSpeaker:
                    if (trait === CharacterTraitType.IntelligenceEloquentSpeaker || trait === CharacterTraitType.IntelligencePoorSpeaker) {
                        return false;
                    }
                    break;
                case CharacterTraitType.IntelligenceCorrupt:
                case CharacterTraitType.IntelligenceLawful:
                    if (trait === CharacterTraitType.IntelligenceCorrupt || trait === CharacterTraitType.IntelligenceLawful) {
                        return false;
                    }
                    break;
                case CharacterTraitType.Paranoid:
                case CharacterTraitType.Trusting:
                    if (trait === CharacterTraitType.Paranoid || trait === CharacterTraitType.Trusting) {
                        return false;
                    }
                    break;
                case CharacterTraitType.PeaceThroughStrength:
                case CharacterTraitType.Pacifist:
                    if (trait === CharacterTraitType.PeaceThroughStrength || trait === CharacterTraitType.Pacifist) {
                        return false;
                    }
                    break;
                case CharacterTraitType.Expansionist:
                case CharacterTraitType.Isolationist:
                    if (trait === CharacterTraitType.Expansionist || trait === CharacterTraitType.Isolationist) {
                        return false;
                    }
                    break;
                case CharacterTraitType.Diplomat:
                case CharacterTraitType.Obnoxious:
                    if (trait === CharacterTraitType.Diplomat || trait === CharacterTraitType.Obnoxious) {
                        return false;
                    }
                    break;
                case CharacterTraitType.Famous:
                case CharacterTraitType.Disliked:
                    if (trait === CharacterTraitType.Famous || trait === CharacterTraitType.Disliked) {
                        return false;
                    }
                    break;
                case CharacterTraitType.GoodAdministrator:
                case CharacterTraitType.PoorAdministrator:
                    if (trait === CharacterTraitType.GoodAdministrator || trait === CharacterTraitType.PoorAdministrator) {
                        return false;
                    }
                    break;
                case CharacterTraitType.BeanCounter:
                case CharacterTraitType.Generous:
                    if (trait === CharacterTraitType.BeanCounter || trait === CharacterTraitType.Generous) {
                        return false;
                    }
                    break;
                case CharacterTraitType.Engineer:
                case CharacterTraitType.Luddite:
                    if (trait === CharacterTraitType.Engineer || trait === CharacterTraitType.Luddite) {
                        return false;
                    }
                    break;
                case CharacterTraitType.FreeTrader:
                case CharacterTraitType.Protectionist:
                    if (trait === CharacterTraitType.FreeTrader || trait === CharacterTraitType.Protectionist) {
                        return false;
                    }
                    break;
                case CharacterTraitType.Environmentalist:
                case CharacterTraitType.Industrialist:
                    if (trait === CharacterTraitType.Environmentalist || trait === CharacterTraitType.Industrialist) {
                        return false;
                    }
                    break;
                case CharacterTraitType.InspiringPresence:
                case CharacterTraitType.Demoralizing:
                    if (trait === CharacterTraitType.InspiringPresence || trait === CharacterTraitType.Demoralizing) {
                        return false;
                    }
                    break;
                case CharacterTraitType.Organized:
                case CharacterTraitType.Disorganized:
                    if (trait === CharacterTraitType.Organized || trait === CharacterTraitType.Disorganized) {
                        return false;
                    }
                    break;
                case CharacterTraitType.HealthOriented:
                case CharacterTraitType.LaborOriented:
                    if (trait === CharacterTraitType.HealthOriented || trait === CharacterTraitType.LaborOriented) {
                        return false;
                    }
                    break;
                case CharacterTraitType.Spiritual:
                case CharacterTraitType.Logical:
                    if (trait === CharacterTraitType.Logical || trait === CharacterTraitType.Spiritual) {
                        return false;
                    }
                    break;
                case CharacterTraitType.GoodStrategist:
                case CharacterTraitType.PoorStrategist:
                    if (trait === CharacterTraitType.GoodStrategist || trait === CharacterTraitType.PoorStrategist) {
                        return false;
                    }
                    break;
                case CharacterTraitType.Uninhibited:
                case CharacterTraitType.Measured:
                    if (trait === CharacterTraitType.Uninhibited || trait === CharacterTraitType.Measured) {
                        return false;
                    }
                    break;
                case CharacterTraitType.Addict:
                case CharacterTraitType.Sober:
                    if (trait === CharacterTraitType.Addict || trait === CharacterTraitType.Sober) {
                        return false;
                    }
                    break;
                case CharacterTraitType.Courageous:
                case CharacterTraitType.Weak:
                    if (trait === CharacterTraitType.Courageous || trait === CharacterTraitType.Weak) {
                        return false;
                    }
                    break;
                case CharacterTraitType.Tolerant:
                case CharacterTraitType.Xenophobic:
                    if (trait === CharacterTraitType.Tolerant || trait === CharacterTraitType.Xenophobic) {
                        return false;
                    }
                    break;
                case CharacterTraitType.EloquentSpeaker:
                case CharacterTraitType.PoorSpeaker:
                    if (trait === CharacterTraitType.EloquentSpeaker || trait === CharacterTraitType.PoorSpeaker) {
                        return false;
                    }
                    break;
                case CharacterTraitType.Corrupt:
                case CharacterTraitType.Lawful:
                    if (trait === CharacterTraitType.Corrupt || trait === CharacterTraitType.Lawful) {
                        return false;
                    }
                    break;
                case CharacterTraitType.Lazy:
                case CharacterTraitType.Energetic:
                    if (trait === CharacterTraitType.Lazy || trait === CharacterTraitType.Energetic) {
                        return false;
                    }
                    break;
                case CharacterTraitType.Linguist:
                case CharacterTraitType.TongueTied:
                    if (trait === CharacterTraitType.Linguist || trait === CharacterTraitType.TongueTied) {
                        return false;
                    }
                    break;
                case CharacterTraitType.Technical:
                case CharacterTraitType.NonTechnical:
                    if (trait === CharacterTraitType.Technical || trait === CharacterTraitType.NonTechnical) {
                        return false;
                    }
                    break;
                case CharacterTraitType.GoodTactician:
                case CharacterTraitType.PoorTactician:
                    if (trait === CharacterTraitType.GoodTactician || trait === CharacterTraitType.PoorTactician) {
                        return false;
                    }
                    break;
                case CharacterTraitType.StrongSpaceAttacker:
                case CharacterTraitType.PoorSpaceAttacker:
                    if (trait === CharacterTraitType.StrongSpaceAttacker || trait === CharacterTraitType.PoorSpaceAttacker) {
                        return false;
                    }
                    break;
                case CharacterTraitType.StrongSpaceDefender:
                case CharacterTraitType.PoorSpaceDefender:
                    if (trait === CharacterTraitType.StrongSpaceDefender || trait === CharacterTraitType.PoorSpaceDefender) {
                        return false;
                    }
                    break;
                case CharacterTraitType.Drunk:
                    if (trait === CharacterTraitType.Drunk) {
                        return false;
                    }
                    break;
                case CharacterTraitType.ToughDiscipline:
                case CharacterTraitType.LaxDiscipline:
                    if (trait === CharacterTraitType.ToughDiscipline || trait === CharacterTraitType.LaxDiscipline) {
                        return false;
                    }
                    break;
                case CharacterTraitType.LocalDefenseTactics:
                    if (trait === CharacterTraitType.LocalDefenseTactics) {
                        return false;
                    }
                    break;
                case CharacterTraitType.PlanetarySupport:
                    if (trait === CharacterTraitType.PlanetarySupport) {
                        return false;
                    }
                    break;
                case CharacterTraitType.GoodSpaceLogistician:
                case CharacterTraitType.PoorSpaceLogistician:
                    if (trait === CharacterTraitType.GoodSpaceLogistician || trait === CharacterTraitType.PoorSpaceLogistician) {
                        return false;
                    }
                    break;
                case CharacterTraitType.NaturalSpaceLeader:
                    if (trait === CharacterTraitType.NaturalSpaceLeader) {
                        return false;
                    }
                    break;
                case CharacterTraitType.SkilledNavigator:
                case CharacterTraitType.PoorNavigator:
                    if (trait === CharacterTraitType.SkilledNavigator || trait === CharacterTraitType.PoorNavigator) {
                        return false;
                    }
                    break;
                case CharacterTraitType.StrongGroundAttacker:
                case CharacterTraitType.PoorGroundAttacker:
                    if (trait === CharacterTraitType.StrongGroundAttacker || trait === CharacterTraitType.PoorGroundAttacker) {
                        return false;
                    }
                    break;
                case CharacterTraitType.StrongGroundDefender:
                case CharacterTraitType.PoorGroundDefender:
                    if (trait === CharacterTraitType.StrongGroundAttacker || trait === CharacterTraitType.PoorGroundDefender) {
                        return false;
                    }
                    break;
                case CharacterTraitType.GoodGroundLogistician:
                case CharacterTraitType.PoorGroundLogistician:
                    if (trait === CharacterTraitType.GoodGroundLogistician || trait === CharacterTraitType.PoorGroundLogistician) {
                        return false;
                    }
                    break;
                case CharacterTraitType.NaturalGroundLeader:
                    if (trait === CharacterTraitType.NaturalGroundLeader) {
                        return false;
                    }
                    break;
                case CharacterTraitType.GoodRecruiter:
                case CharacterTraitType.PoorRecruiter:
                    if (trait === CharacterTraitType.GoodRecruiter || trait === CharacterTraitType.PoorRecruiter) {
                        return false;
                    }
                    break;
                case CharacterTraitType.CarefulAttacker:
                case CharacterTraitType.RecklessAttacker:
                    if (trait === CharacterTraitType.CarefulAttacker || trait === CharacterTraitType.RecklessAttacker) {
                        return false;
                    }
                    break;
                case CharacterTraitType.DoubleAgent:
                    if (trait === CharacterTraitType.DoubleAgent) {
                        return false;
                    }
                    break;
                case CharacterTraitType.Creative:
                case CharacterTraitType.Methodical:
                    if (trait === CharacterTraitType.Creative || trait === CharacterTraitType.Methodical) {
                        return false;
                    }
                    break;
                case CharacterTraitType.ForeignSpy:
                case CharacterTraitType.Patriot:
                    if (trait === CharacterTraitType.ForeignSpy || trait === CharacterTraitType.Patriot) {
                        return false;
                    }
                    break;
                case CharacterTraitType.UltraGenius:
                    if (trait === CharacterTraitType.UltraGenius) {
                        return false;
                    }
                    break;
                case CharacterTraitType.Smuggler:
                    if (trait === CharacterTraitType.Smuggler) {
                        return false;
                    }
                    break;
                case CharacterTraitType.BountyHunter:
                    if (trait === CharacterTraitType.BountyHunter) {
                        return false;
                    }
                    break;
            }
        }
        return true;
    }

    // Character.cs RebuildCachedSkillValues (1639).
    rebuildCachedSkillValues(): void {
        const s = this.skillBase;
        s[CharacterSkillType.Diplomacy] = 0;
        s[CharacterSkillType.ColonyIncome] = 0;
        s[CharacterSkillType.TradeIncome] = 0;
        s[CharacterSkillType.TourismIncome] = 0;
        s[CharacterSkillType.ColonyCorruption] = 0;
        s[CharacterSkillType.ColonyHappiness] = 0;
        s[CharacterSkillType.PopulationGrowth] = 0;
        s[CharacterSkillType.MiningRate] = 0;
        s[CharacterSkillType.TroopRecruitment] = 0;
        s[CharacterSkillType.MilitaryShipConstructionSpeed] = 0;
        s[CharacterSkillType.CivilianShipConstructionSpeed] = 0;
        s[CharacterSkillType.ColonyShipConstructionSpeed] = 0;
        s[CharacterSkillType.FacilityConstructionSpeed] = 0;
        s[CharacterSkillType.ResearchWeapons] = 0;
        s[CharacterSkillType.ResearchEnergy] = 0;
        s[CharacterSkillType.ResearchHighTech] = 0;
        s[CharacterSkillType.Espionage] = 0;
        s[CharacterSkillType.CounterEspionage] = 0;
        s[CharacterSkillType.Sabotage] = 0;
        s[CharacterSkillType.Concealment] = 0;
        s[CharacterSkillType.PsyOps] = 0;
        s[CharacterSkillType.Assassination] = 0;
        s[CharacterSkillType.MilitaryShipMaintenance] = 0;
        s[CharacterSkillType.CivilianShipMaintenance] = 0;
        s[CharacterSkillType.MilitaryBaseMaintenance] = 0;
        s[CharacterSkillType.CivilianBaseMaintenance] = 0;
        s[CharacterSkillType.TroopMaintenance] = 0;
        s[CharacterSkillType.WarWeariness] = 0;
        s[CharacterSkillType.Targeting] = 0;
        s[CharacterSkillType.Countermeasures] = 0;
        s[CharacterSkillType.ShipManeuvering] = 0;
        s[CharacterSkillType.Fighters] = 0;
        s[CharacterSkillType.ShipEnergyUsage] = 0;
        s[CharacterSkillType.WeaponsDamage] = 0;
        s[CharacterSkillType.WeaponsRange] = 0;
        s[CharacterSkillType.ShieldRechargeRate] = 0;
        s[CharacterSkillType.DamageControl] = 0;
        s[CharacterSkillType.RepairBonus] = 0;
        s[CharacterSkillType.HyperjumpSpeed] = 0;
        s[CharacterSkillType.TroopGroundAttack] = 0;
        s[CharacterSkillType.TroopGroundDefense] = 0;
        s[CharacterSkillType.TroopExperienceGain] = 0;
        s[CharacterSkillType.TroopRecoveryRate] = 0;
        s[CharacterSkillType.TroopStrengthArmor] = 0;
        s[CharacterSkillType.TroopStrengthInfantry] = 0;
        s[CharacterSkillType.TroopStrengthSpecialForces] = 0;
        s[CharacterSkillType.TroopStrengthPlanetaryDefense] = 0;
        s[CharacterSkillType.SmugglingIncome] = 0;
        s[CharacterSkillType.SmugglingEvasion] = 0;
        s[CharacterSkillType.BoardingAssault] = 0;
        for (let i = 0; i < this.skills.count; i++) {
            const characterSkill = this.skills.items[i];
            if (characterSkill !== null) {
                const b = Math.min(100, Math.max(-100, characterSkill.level));
                switch (characterSkill.type) {
                    case CharacterSkillType.Assassination:
                        s[CharacterSkillType.Assassination] = b;
                        break;
                    case CharacterSkillType.CivilianBaseMaintenance:
                        s[CharacterSkillType.CivilianBaseMaintenance] = b;
                        break;
                    case CharacterSkillType.CivilianShipConstructionSpeed:
                        s[CharacterSkillType.CivilianShipConstructionSpeed] = b;
                        break;
                    case CharacterSkillType.CivilianShipMaintenance:
                        s[CharacterSkillType.CivilianShipMaintenance] = b;
                        break;
                    case CharacterSkillType.ColonyCorruption:
                        s[CharacterSkillType.ColonyCorruption] = b;
                        break;
                    case CharacterSkillType.ColonyHappiness:
                        s[CharacterSkillType.ColonyHappiness] = b;
                        break;
                    case CharacterSkillType.ColonyIncome:
                        s[CharacterSkillType.ColonyIncome] = b;
                        break;
                    case CharacterSkillType.ColonyShipConstructionSpeed:
                        s[CharacterSkillType.ColonyShipConstructionSpeed] = b;
                        break;
                    case CharacterSkillType.Concealment:
                        s[CharacterSkillType.Concealment] = b;
                        break;
                    case CharacterSkillType.CounterEspionage:
                        s[CharacterSkillType.CounterEspionage] = b;
                        break;
                    case CharacterSkillType.Countermeasures:
                        s[CharacterSkillType.Countermeasures] = b;
                        break;
                    case CharacterSkillType.DamageControl:
                        s[CharacterSkillType.DamageControl] = b;
                        break;
                    case CharacterSkillType.Diplomacy:
                        s[CharacterSkillType.Diplomacy] = b;
                        break;
                    case CharacterSkillType.Espionage:
                        s[CharacterSkillType.Espionage] = b;
                        break;
                    case CharacterSkillType.FacilityConstructionSpeed:
                        s[CharacterSkillType.FacilityConstructionSpeed] = b;
                        break;
                    case CharacterSkillType.Fighters:
                        s[CharacterSkillType.Fighters] = b;
                        break;
                    case CharacterSkillType.HyperjumpSpeed:
                        s[CharacterSkillType.HyperjumpSpeed] = b;
                        break;
                    case CharacterSkillType.MilitaryBaseMaintenance:
                        s[CharacterSkillType.MilitaryBaseMaintenance] = b;
                        break;
                    case CharacterSkillType.MilitaryShipConstructionSpeed:
                        s[CharacterSkillType.MilitaryShipConstructionSpeed] = b;
                        break;
                    case CharacterSkillType.MilitaryShipMaintenance:
                        s[CharacterSkillType.MilitaryShipMaintenance] = b;
                        break;
                    case CharacterSkillType.MiningRate:
                        s[CharacterSkillType.MiningRate] = b;
                        break;
                    case CharacterSkillType.PopulationGrowth:
                        s[CharacterSkillType.PopulationGrowth] = b;
                        break;
                    case CharacterSkillType.PsyOps:
                        s[CharacterSkillType.PsyOps] = b;
                        break;
                    case CharacterSkillType.RepairBonus:
                        s[CharacterSkillType.RepairBonus] = b;
                        break;
                    case CharacterSkillType.ResearchEnergy:
                        s[CharacterSkillType.ResearchEnergy] = b;
                        break;
                    case CharacterSkillType.ResearchHighTech:
                        s[CharacterSkillType.ResearchHighTech] = b;
                        break;
                    case CharacterSkillType.ResearchWeapons:
                        s[CharacterSkillType.ResearchWeapons] = b;
                        break;
                    case CharacterSkillType.Sabotage:
                        s[CharacterSkillType.Sabotage] = b;
                        break;
                    case CharacterSkillType.ShieldRechargeRate:
                        s[CharacterSkillType.ShieldRechargeRate] = b;
                        break;
                    case CharacterSkillType.ShipEnergyUsage:
                        s[CharacterSkillType.ShipEnergyUsage] = b;
                        break;
                    case CharacterSkillType.ShipManeuvering:
                        s[CharacterSkillType.ShipManeuvering] = b;
                        break;
                    case CharacterSkillType.Targeting:
                        s[CharacterSkillType.Targeting] = b;
                        break;
                    case CharacterSkillType.TourismIncome:
                        s[CharacterSkillType.TourismIncome] = b;
                        break;
                    case CharacterSkillType.TradeIncome:
                        s[CharacterSkillType.TradeIncome] = b;
                        break;
                    case CharacterSkillType.TroopExperienceGain:
                        s[CharacterSkillType.TroopExperienceGain] = b;
                        break;
                    case CharacterSkillType.TroopGroundAttack:
                        s[CharacterSkillType.TroopGroundAttack] = b;
                        break;
                    case CharacterSkillType.TroopGroundDefense:
                        s[CharacterSkillType.TroopGroundDefense] = b;
                        break;
                    case CharacterSkillType.TroopMaintenance:
                        s[CharacterSkillType.TroopMaintenance] = b;
                        break;
                    case CharacterSkillType.TroopRecoveryRate:
                        s[CharacterSkillType.TroopRecoveryRate] = b;
                        break;
                    case CharacterSkillType.TroopRecruitment:
                        s[CharacterSkillType.TroopRecruitment] = b;
                        break;
                    case CharacterSkillType.WarWeariness:
                        s[CharacterSkillType.WarWeariness] = b;
                        break;
                    case CharacterSkillType.WeaponsDamage:
                        s[CharacterSkillType.WeaponsDamage] = b;
                        break;
                    case CharacterSkillType.WeaponsRange:
                        s[CharacterSkillType.WeaponsRange] = b;
                        break;
                    case CharacterSkillType.TroopStrengthArmor:
                        s[CharacterSkillType.TroopStrengthArmor] = b;
                        break;
                    case CharacterSkillType.TroopStrengthInfantry:
                        s[CharacterSkillType.TroopStrengthInfantry] = b;
                        break;
                    case CharacterSkillType.TroopStrengthSpecialForces:
                        s[CharacterSkillType.TroopStrengthSpecialForces] = b;
                        break;
                    case CharacterSkillType.TroopStrengthPlanetaryDefense:
                        s[CharacterSkillType.TroopStrengthPlanetaryDefense] = b;
                        break;
                    case CharacterSkillType.SmugglingIncome:
                        s[CharacterSkillType.SmugglingIncome] = b;
                        break;
                    case CharacterSkillType.SmugglingEvasion:
                        s[CharacterSkillType.SmugglingEvasion] = b;
                        break;
                    case CharacterSkillType.BoardingAssault:
                        s[CharacterSkillType.BoardingAssault] = b;
                        break;
                }
            }
        }
    }

    // Character.cs ReviewTraitSkills (1854).
    reviewTraitSkills(): void {
        const s = this.skillBase;
        const t = this.skillTraits;
        t[CharacterSkillType.Diplomacy] = 0;
        t[CharacterSkillType.ColonyIncome] = 0;
        t[CharacterSkillType.TradeIncome] = 0;
        t[CharacterSkillType.TourismIncome] = 0;
        t[CharacterSkillType.ColonyCorruption] = 0;
        t[CharacterSkillType.ColonyHappiness] = 0;
        t[CharacterSkillType.PopulationGrowth] = 0;
        t[CharacterSkillType.MiningRate] = 0;
        t[CharacterSkillType.TroopRecruitment] = 0;
        t[CharacterSkillType.MilitaryShipConstructionSpeed] = 0;
        t[CharacterSkillType.CivilianShipConstructionSpeed] = 0;
        t[CharacterSkillType.ColonyShipConstructionSpeed] = 0;
        t[CharacterSkillType.FacilityConstructionSpeed] = 0;
        t[CharacterSkillType.ResearchWeapons] = 0;
        t[CharacterSkillType.ResearchEnergy] = 0;
        t[CharacterSkillType.ResearchHighTech] = 0;
        t[CharacterSkillType.Espionage] = 0;
        t[CharacterSkillType.CounterEspionage] = 0;
        t[CharacterSkillType.Sabotage] = 0;
        t[CharacterSkillType.Concealment] = 0;
        t[CharacterSkillType.PsyOps] = 0;
        t[CharacterSkillType.Assassination] = 0;
        t[CharacterSkillType.MilitaryShipMaintenance] = 0;
        t[CharacterSkillType.CivilianShipMaintenance] = 0;
        t[CharacterSkillType.MilitaryBaseMaintenance] = 0;
        t[CharacterSkillType.CivilianBaseMaintenance] = 0;
        t[CharacterSkillType.TroopMaintenance] = 0;
        t[CharacterSkillType.WarWeariness] = 0;
        t[CharacterSkillType.Targeting] = 0;
        t[CharacterSkillType.Countermeasures] = 0;
        t[CharacterSkillType.ShipManeuvering] = 0;
        t[CharacterSkillType.Fighters] = 0;
        t[CharacterSkillType.ShipEnergyUsage] = 0;
        t[CharacterSkillType.WeaponsDamage] = 0;
        t[CharacterSkillType.WeaponsRange] = 0;
        t[CharacterSkillType.ShieldRechargeRate] = 0;
        t[CharacterSkillType.DamageControl] = 0;
        t[CharacterSkillType.RepairBonus] = 0;
        t[CharacterSkillType.HyperjumpSpeed] = 0;
        t[CharacterSkillType.TroopGroundAttack] = 0;
        t[CharacterSkillType.TroopGroundDefense] = 0;
        t[CharacterSkillType.TroopExperienceGain] = 0;
        t[CharacterSkillType.TroopRecoveryRate] = 0;
        t[CharacterSkillType.TroopStrengthArmor] = 0;
        t[CharacterSkillType.TroopStrengthInfantry] = 0;
        t[CharacterSkillType.TroopStrengthSpecialForces] = 0;
        t[CharacterSkillType.TroopStrengthPlanetaryDefense] = 0;
        t[CharacterSkillType.SmugglingIncome] = 0;
        t[CharacterSkillType.SmugglingEvasion] = 0;
        t[CharacterSkillType.BoardingAssault] = 0;
        this.traitSkills.clear();
        const b = 10;
        const b2 = 5;
        const b3 = 20;
        for (let i = 0; i < this.traits.length; i++) {
            const characterTraitType = this.traits[i];
            if (!checkCharacterTraitAppliesOnlyToExistingSkills(characterTraitType)) {
                const newSkills = determineEffectsOfCharacterTrait(characterTraitType, this.role);
                this.traitSkills.combineSkillList(newSkills);
                switch (characterTraitType) {
                    case CharacterTraitType.Smuggler:
                        t[CharacterSkillType.SmugglingIncome] += b;
                        t[CharacterSkillType.SmugglingEvasion] += b;
                        t[CharacterSkillType.DamageControl] += b;
                        t[CharacterSkillType.Countermeasures] += b;
                        break;
                    case CharacterTraitType.BountyHunter:
                        t[CharacterSkillType.BoardingAssault] += b;
                        t[CharacterSkillType.WeaponsDamage] += b;
                        t[CharacterSkillType.Targeting] += b;
                        break;
                    case CharacterTraitType.IntelligenceCorrupt:
                        t[CharacterSkillType.Espionage] -= b;
                        t[CharacterSkillType.CounterEspionage] -= b;
                        t[CharacterSkillType.Sabotage] -= b;
                        t[CharacterSkillType.PsyOps] -= b;
                        t[CharacterSkillType.Concealment] -= b;
                        t[CharacterSkillType.Assassination] -= b;
                        break;
                    case CharacterTraitType.IntelligenceCourageous:
                        t[CharacterSkillType.Espionage] += b;
                        t[CharacterSkillType.CounterEspionage] += b;
                        t[CharacterSkillType.Sabotage] += b;
                        t[CharacterSkillType.PsyOps] += b;
                        t[CharacterSkillType.Concealment] += b;
                        t[CharacterSkillType.Assassination] += b;
                        break;
                    case CharacterTraitType.IntelligenceEloquentSpeaker:
                        t[CharacterSkillType.PsyOps] += b;
                        break;
                    case CharacterTraitType.IntelligenceLawful:
                        t[CharacterSkillType.Espionage] -= b;
                        t[CharacterSkillType.CounterEspionage] += b;
                        t[CharacterSkillType.Sabotage] -= b;
                        t[CharacterSkillType.PsyOps] -= b;
                        t[CharacterSkillType.Concealment] -= b;
                        t[CharacterSkillType.Assassination] -= b;
                        break;
                    case CharacterTraitType.IntelligenceMeasured:
                        t[CharacterSkillType.Concealment] += b;
                        t[CharacterSkillType.PsyOps] += b;
                        break;
                    case CharacterTraitType.IntelligencePoorSpeaker:
                        t[CharacterSkillType.PsyOps] -= b;
                        break;
                    case CharacterTraitType.IntelligenceTolerant:
                        t[CharacterSkillType.CounterEspionage] -= b;
                        t[CharacterSkillType.Concealment] += b;
                        break;
                    case CharacterTraitType.IntelligenceUninhibited:
                        t[CharacterSkillType.Concealment] -= b;
                        t[CharacterSkillType.PsyOps] -= b;
                        break;
                    case CharacterTraitType.IntelligenceWeak:
                        t[CharacterSkillType.Espionage] -= b;
                        t[CharacterSkillType.CounterEspionage] -= b;
                        t[CharacterSkillType.Sabotage] -= b;
                        t[CharacterSkillType.PsyOps] -= b;
                        t[CharacterSkillType.Concealment] -= b;
                        t[CharacterSkillType.Assassination] -= b;
                        break;
                    case CharacterTraitType.IntelligenceXenophobic:
                        t[CharacterSkillType.CounterEspionage] += b;
                        t[CharacterSkillType.Concealment] -= b;
                        break;
                    case CharacterTraitType.Paranoid:
                        t[CharacterSkillType.CounterEspionage] += b;
                        t[CharacterSkillType.Diplomacy] -= b;
                        t[CharacterSkillType.ColonyHappiness] -= b;
                        break;
                    case CharacterTraitType.Trusting:
                        t[CharacterSkillType.CounterEspionage] -= b;
                        t[CharacterSkillType.Diplomacy] += b;
                        t[CharacterSkillType.ColonyHappiness] += b;
                        break;
                    case CharacterTraitType.PeaceThroughStrength:
                        t[CharacterSkillType.TroopRecruitment] += b;
                        t[CharacterSkillType.MilitaryShipConstructionSpeed] += b;
                        t[CharacterSkillType.ColonyHappiness] -= b;
                        break;
                    case CharacterTraitType.Pacifist:
                        t[CharacterSkillType.TroopRecruitment] -= b;
                        t[CharacterSkillType.MilitaryShipConstructionSpeed] -= b;
                        t[CharacterSkillType.ColonyHappiness] += b;
                        break;
                    case CharacterTraitType.Expansionist:
                        t[CharacterSkillType.ResearchHighTech] += b;
                        t[CharacterSkillType.ColonyShipConstructionSpeed] += b;
                        break;
                    case CharacterTraitType.Isolationist:
                        t[CharacterSkillType.ResearchWeapons] += b;
                        t[CharacterSkillType.ColonyShipConstructionSpeed] -= b;
                        break;
                    case CharacterTraitType.Diplomat:
                        t[CharacterSkillType.Diplomacy] += b;
                        break;
                    case CharacterTraitType.Obnoxious:
                        t[CharacterSkillType.Diplomacy] -= b;
                        break;
                    case CharacterTraitType.Famous:
                        t[CharacterSkillType.ColonyHappiness] += b;
                        t[CharacterSkillType.TourismIncome] += b;
                        break;
                    case CharacterTraitType.Disliked:
                        t[CharacterSkillType.ColonyHappiness] -= b;
                        t[CharacterSkillType.TourismIncome] -= b;
                        break;
                    case CharacterTraitType.GoodAdministrator:
                        t[CharacterSkillType.ColonyIncome] += b;
                        break;
                    case CharacterTraitType.PoorAdministrator:
                        t[CharacterSkillType.ColonyIncome] -= b;
                        break;
                    case CharacterTraitType.BeanCounter:
                        t[CharacterSkillType.ColonyCorruption] += b;
                        t[CharacterSkillType.ColonyHappiness] -= b;
                        break;
                    case CharacterTraitType.Generous:
                        t[CharacterSkillType.ColonyCorruption] -= b;
                        t[CharacterSkillType.ColonyHappiness] += b;
                        break;
                    case CharacterTraitType.Engineer:
                        t[CharacterSkillType.ResearchHighTech] += b;
                        t[CharacterSkillType.CivilianShipConstructionSpeed] += b;
                        break;
                    case CharacterTraitType.Luddite:
                        t[CharacterSkillType.ResearchHighTech] -= b;
                        t[CharacterSkillType.CivilianShipConstructionSpeed] -= b;
                        break;
                    case CharacterTraitType.FreeTrader:
                        t[CharacterSkillType.TradeIncome] += b;
                        t[CharacterSkillType.CivilianShipConstructionSpeed] += b;
                        break;
                    case CharacterTraitType.Protectionist:
                        t[CharacterSkillType.TradeIncome] -= b;
                        t[CharacterSkillType.CivilianShipConstructionSpeed] -= b;
                        break;
                    case CharacterTraitType.Environmentalist:
                        t[CharacterSkillType.PopulationGrowth] += b;
                        t[CharacterSkillType.MiningRate] -= b;
                        break;
                    case CharacterTraitType.Industrialist:
                        t[CharacterSkillType.PopulationGrowth] -= b;
                        t[CharacterSkillType.MiningRate] += b;
                        break;
                    case CharacterTraitType.Organized:
                        t[CharacterSkillType.MilitaryShipConstructionSpeed] += b;
                        t[CharacterSkillType.CivilianShipConstructionSpeed] += b;
                        t[CharacterSkillType.ColonyShipConstructionSpeed] += b;
                        break;
                    case CharacterTraitType.Disorganized:
                        t[CharacterSkillType.MilitaryShipConstructionSpeed] -= b;
                        t[CharacterSkillType.CivilianShipConstructionSpeed] -= b;
                        t[CharacterSkillType.ColonyShipConstructionSpeed] -= b;
                        break;
                    case CharacterTraitType.HealthOriented:
                        t[CharacterSkillType.PopulationGrowth] += b;
                        t[CharacterSkillType.ColonyHappiness] += b;
                        t[CharacterSkillType.ColonyIncome] -= b;
                        break;
                    case CharacterTraitType.LaborOriented:
                        t[CharacterSkillType.PopulationGrowth] -= b;
                        t[CharacterSkillType.ColonyHappiness] -= b;
                        t[CharacterSkillType.ColonyIncome] += b;
                        break;
                    case CharacterTraitType.Spiritual:
                        t[CharacterSkillType.ColonyHappiness] += b;
                        t[CharacterSkillType.Diplomacy] -= b;
                        break;
                    case CharacterTraitType.Logical:
                        t[CharacterSkillType.ColonyHappiness] -= b;
                        t[CharacterSkillType.Diplomacy] += b;
                        break;
                    case CharacterTraitType.GoodStrategist:
                        t[CharacterSkillType.TroopMaintenance] += b;
                        t[CharacterSkillType.MilitaryShipMaintenance] += b;
                        break;
                    case CharacterTraitType.PoorStrategist:
                        t[CharacterSkillType.TroopMaintenance] -= b;
                        t[CharacterSkillType.MilitaryShipMaintenance] -= b;
                        break;
                    case CharacterTraitType.Uninhibited:
                        t[CharacterSkillType.ColonyHappiness] += b;
                        t[CharacterSkillType.ColonyCorruption] -= b;
                        t[CharacterSkillType.Diplomacy] -= b;
                        break;
                    case CharacterTraitType.Measured:
                        t[CharacterSkillType.ColonyHappiness] -= b;
                        t[CharacterSkillType.ColonyCorruption] += b;
                        t[CharacterSkillType.Diplomacy] += b;
                        break;
                    case CharacterTraitType.Addict:
                        t[CharacterSkillType.ColonyCorruption] -= b;
                        t[CharacterSkillType.Diplomacy] -= b;
                        break;
                    case CharacterTraitType.Sober:
                        t[CharacterSkillType.ColonyCorruption] += b;
                        t[CharacterSkillType.Diplomacy] += b;
                        break;
                    case CharacterTraitType.Courageous:
                        t[CharacterSkillType.WarWeariness] += b;
                        t[CharacterSkillType.TroopRecruitment] += b;
                        break;
                    case CharacterTraitType.Weak:
                        t[CharacterSkillType.WarWeariness] -= b;
                        t[CharacterSkillType.TroopRecruitment] -= b;
                        break;
                    case CharacterTraitType.Tolerant:
                        t[CharacterSkillType.TradeIncome] += b;
                        t[CharacterSkillType.Diplomacy] += b;
                        break;
                    case CharacterTraitType.Xenophobic:
                        t[CharacterSkillType.TradeIncome] -= b;
                        t[CharacterSkillType.Diplomacy] -= b;
                        break;
                    case CharacterTraitType.EloquentSpeaker:
                        t[CharacterSkillType.ColonyHappiness] += b;
                        t[CharacterSkillType.Diplomacy] += b;
                        break;
                    case CharacterTraitType.PoorSpeaker:
                        t[CharacterSkillType.ColonyHappiness] -= b;
                        t[CharacterSkillType.Diplomacy] -= b;
                        break;
                    case CharacterTraitType.Corrupt:
                        t[CharacterSkillType.ColonyCorruption] -= b;
                        t[CharacterSkillType.TradeIncome] -= b;
                        t[CharacterSkillType.TourismIncome] -= b;
                        break;
                    case CharacterTraitType.Lawful:
                        t[CharacterSkillType.ColonyCorruption] += b;
                        t[CharacterSkillType.TradeIncome] += b;
                        t[CharacterSkillType.TourismIncome] += b;
                        break;
                    case CharacterTraitType.Linguist:
                        t[CharacterSkillType.Diplomacy] += b;
                        t[CharacterSkillType.TourismIncome] += b;
                        break;
                    case CharacterTraitType.TongueTied:
                        t[CharacterSkillType.Diplomacy] -= b;
                        t[CharacterSkillType.TourismIncome] -= b;
                        break;
                    case CharacterTraitType.Technical:
                        t[CharacterSkillType.MilitaryShipConstructionSpeed] += b;
                        t[CharacterSkillType.CivilianShipConstructionSpeed] += b;
                        t[CharacterSkillType.ColonyShipConstructionSpeed] += b;
                        t[CharacterSkillType.FacilityConstructionSpeed] += b;
                        break;
                    case CharacterTraitType.NonTechnical:
                        t[CharacterSkillType.MilitaryShipConstructionSpeed] -= b;
                        t[CharacterSkillType.CivilianShipConstructionSpeed] -= b;
                        t[CharacterSkillType.ColonyShipConstructionSpeed] -= b;
                        t[CharacterSkillType.FacilityConstructionSpeed] -= b;
                        break;
                    case CharacterTraitType.StrongSpaceAttacker:
                        t[CharacterSkillType.Targeting] += b;
                        t[CharacterSkillType.ShipManeuvering] += b;
                        t[CharacterSkillType.WeaponsDamage] += b;
                        break;
                    case CharacterTraitType.PoorSpaceAttacker:
                        t[CharacterSkillType.Targeting] -= b;
                        t[CharacterSkillType.ShipManeuvering] -= b;
                        t[CharacterSkillType.WeaponsDamage] -= b;
                        break;
                    case CharacterTraitType.StrongSpaceDefender:
                        t[CharacterSkillType.Countermeasures] += b;
                        t[CharacterSkillType.ShipManeuvering] += b;
                        t[CharacterSkillType.ShieldRechargeRate] += b;
                        break;
                    case CharacterTraitType.PoorSpaceDefender:
                        t[CharacterSkillType.Countermeasures] -= b;
                        t[CharacterSkillType.ShipManeuvering] -= b;
                        t[CharacterSkillType.ShieldRechargeRate] -= b;
                        break;
                    case CharacterTraitType.GoodSpaceLogistician:
                        t[CharacterSkillType.ShipEnergyUsage] += b;
                        break;
                    case CharacterTraitType.PoorSpaceLogistician:
                        t[CharacterSkillType.ShipEnergyUsage] -= b;
                        break;
                    case CharacterTraitType.NaturalSpaceLeader:
                        t[CharacterSkillType.WeaponsDamage] += b;
                        t[CharacterSkillType.DamageControl] += b;
                        t[CharacterSkillType.Targeting] += b;
                        t[CharacterSkillType.Countermeasures] += b;
                        break;
                    case CharacterTraitType.SkilledNavigator:
                        t[CharacterSkillType.HyperjumpSpeed] += b;
                        break;
                    case CharacterTraitType.PoorNavigator:
                        t[CharacterSkillType.HyperjumpSpeed] -= b;
                        break;
                    case CharacterTraitType.StrongGroundAttacker:
                        t[CharacterSkillType.TroopGroundAttack] += b;
                        break;
                    case CharacterTraitType.PoorGroundAttacker:
                        t[CharacterSkillType.TroopGroundAttack] -= b;
                        break;
                    case CharacterTraitType.StrongGroundDefender:
                        t[CharacterSkillType.TroopGroundDefense] += b;
                        break;
                    case CharacterTraitType.PoorGroundDefender:
                        t[CharacterSkillType.TroopGroundDefense] -= b;
                        break;
                    case CharacterTraitType.GoodGroundLogistician:
                        t[CharacterSkillType.TroopMaintenance] += b;
                        break;
                    case CharacterTraitType.PoorGroundLogistician:
                        t[CharacterSkillType.TroopMaintenance] -= b;
                        break;
                    case CharacterTraitType.NaturalGroundLeader:
                        t[CharacterSkillType.TroopGroundAttack] += b;
                        t[CharacterSkillType.TroopGroundDefense] += b;
                        t[CharacterSkillType.TroopRecruitment] += b;
                        t[CharacterSkillType.TroopExperienceGain] += b;
                        break;
                    case CharacterTraitType.GoodRecruiter:
                        t[CharacterSkillType.TroopRecruitment] += b;
                        break;
                    case CharacterTraitType.PoorRecruiter:
                        t[CharacterSkillType.TroopRecruitment] -= b;
                        break;
                    case CharacterTraitType.CarefulAttacker:
                        t[CharacterSkillType.TroopGroundAttack] -= b;
                        t[CharacterSkillType.TroopGroundDefense] += b;
                        t[CharacterSkillType.TroopRecoveryRate] += b;
                        break;
                    case CharacterTraitType.RecklessAttacker:
                        t[CharacterSkillType.TroopGroundAttack] += b;
                        t[CharacterSkillType.TroopGroundDefense] -= b;
                        t[CharacterSkillType.TroopRecoveryRate] -= b;
                        break;
                    case CharacterTraitType.DoubleAgent:
                        t[CharacterSkillType.Espionage] -= b3;
                        t[CharacterSkillType.CounterEspionage] -= b3;
                        t[CharacterSkillType.Sabotage] -= b3;
                        t[CharacterSkillType.Concealment] -= b3;
                        t[CharacterSkillType.PsyOps] -= b3;
                        t[CharacterSkillType.Assassination] -= b3;
                        break;
                }
            }
        }
        for (let j = 0; j < this.traits.length; j++) {
            const characterTraitType2 = this.traits[j];
            if (!checkCharacterTraitAppliesOnlyToExistingSkills(characterTraitType2)) {
                continue;
            }
            switch (characterTraitType2) {
                case CharacterTraitType.Lazy:
                    if (s[CharacterSkillType.Diplomacy] !== 0) {
                        t[CharacterSkillType.Diplomacy] -= b2;
                    }
                    if (s[CharacterSkillType.ColonyIncome] !== 0) {
                        t[CharacterSkillType.ColonyIncome] -= b2;
                    }
                    if (s[CharacterSkillType.TradeIncome] !== 0) {
                        t[CharacterSkillType.TradeIncome] -= b2;
                    }
                    if (s[CharacterSkillType.TourismIncome] !== 0) {
                        t[CharacterSkillType.TourismIncome] -= b2;
                    }
                    if (s[CharacterSkillType.ColonyCorruption] !== 0) {
                        t[CharacterSkillType.ColonyCorruption] -= b2;
                    }
                    if (s[CharacterSkillType.ColonyHappiness] !== 0) {
                        t[CharacterSkillType.ColonyHappiness] -= b2;
                    }
                    if (s[CharacterSkillType.PopulationGrowth] !== 0) {
                        t[CharacterSkillType.PopulationGrowth] -= b2;
                    }
                    if (s[CharacterSkillType.MiningRate] !== 0) {
                        t[CharacterSkillType.MiningRate] -= b2;
                    }
                    if (s[CharacterSkillType.TroopRecruitment] !== 0) {
                        t[CharacterSkillType.TroopRecruitment] -= b2;
                    }
                    if (s[CharacterSkillType.MilitaryShipConstructionSpeed] !== 0) {
                        t[CharacterSkillType.MilitaryShipConstructionSpeed] -= b2;
                    }
                    if (s[CharacterSkillType.CivilianShipConstructionSpeed] !== 0) {
                        t[CharacterSkillType.CivilianShipConstructionSpeed] -= b2;
                    }
                    if (s[CharacterSkillType.ColonyShipConstructionSpeed] !== 0) {
                        t[CharacterSkillType.ColonyShipConstructionSpeed] -= b2;
                    }
                    if (s[CharacterSkillType.FacilityConstructionSpeed] !== 0) {
                        t[CharacterSkillType.FacilityConstructionSpeed] -= b2;
                    }
                    if (s[CharacterSkillType.ResearchWeapons] !== 0) {
                        t[CharacterSkillType.ResearchWeapons] -= b2;
                    }
                    if (s[CharacterSkillType.ResearchEnergy] !== 0) {
                        t[CharacterSkillType.ResearchEnergy] -= b2;
                    }
                    if (s[CharacterSkillType.ResearchHighTech] !== 0) {
                        t[CharacterSkillType.ResearchHighTech] -= b2;
                    }
                    if (s[CharacterSkillType.Espionage] !== 0) {
                        t[CharacterSkillType.Espionage] -= b2;
                    }
                    if (s[CharacterSkillType.CounterEspionage] !== 0) {
                        t[CharacterSkillType.CounterEspionage] -= b2;
                    }
                    if (s[CharacterSkillType.Sabotage] !== 0) {
                        t[CharacterSkillType.Sabotage] -= b2;
                    }
                    if (s[CharacterSkillType.Concealment] !== 0) {
                        t[CharacterSkillType.Concealment] -= b2;
                    }
                    if (s[CharacterSkillType.PsyOps] !== 0) {
                        t[CharacterSkillType.PsyOps] -= b2;
                    }
                    if (s[CharacterSkillType.Assassination] !== 0) {
                        t[CharacterSkillType.Assassination] -= b2;
                    }
                    if (s[CharacterSkillType.MilitaryShipMaintenance] !== 0) {
                        t[CharacterSkillType.MilitaryShipMaintenance] -= b2;
                    }
                    if (s[CharacterSkillType.CivilianShipMaintenance] !== 0) {
                        t[CharacterSkillType.CivilianShipMaintenance] -= b2;
                    }
                    if (s[CharacterSkillType.MilitaryBaseMaintenance] !== 0) {
                        t[CharacterSkillType.MilitaryBaseMaintenance] -= b2;
                    }
                    if (s[CharacterSkillType.CivilianBaseMaintenance] !== 0) {
                        t[CharacterSkillType.CivilianBaseMaintenance] -= b2;
                    }
                    if (s[CharacterSkillType.TroopMaintenance] !== 0) {
                        t[CharacterSkillType.TroopMaintenance] -= b2;
                    }
                    if (s[CharacterSkillType.WarWeariness] !== 0) {
                        t[CharacterSkillType.WarWeariness] -= b2;
                    }
                    if (s[CharacterSkillType.Targeting] !== 0) {
                        t[CharacterSkillType.Targeting] -= b2;
                    }
                    if (s[CharacterSkillType.Countermeasures] !== 0) {
                        t[CharacterSkillType.Countermeasures] -= b2;
                    }
                    if (s[CharacterSkillType.ShipManeuvering] !== 0) {
                        t[CharacterSkillType.ShipManeuvering] -= b2;
                    }
                    if (s[CharacterSkillType.Fighters] !== 0) {
                        t[CharacterSkillType.Fighters] -= b2;
                    }
                    if (s[CharacterSkillType.ShipEnergyUsage] !== 0) {
                        t[CharacterSkillType.ShipEnergyUsage] -= b2;
                    }
                    if (s[CharacterSkillType.WeaponsDamage] !== 0) {
                        t[CharacterSkillType.WeaponsDamage] -= b2;
                    }
                    if (s[CharacterSkillType.WeaponsRange] !== 0) {
                        t[CharacterSkillType.WeaponsRange] -= b2;
                    }
                    if (s[CharacterSkillType.ShieldRechargeRate] !== 0) {
                        t[CharacterSkillType.ShieldRechargeRate] -= b2;
                    }
                    if (s[CharacterSkillType.DamageControl] !== 0) {
                        t[CharacterSkillType.DamageControl] -= b2;
                    }
                    if (s[CharacterSkillType.RepairBonus] !== 0) {
                        t[CharacterSkillType.RepairBonus] -= b2;
                    }
                    if (s[CharacterSkillType.HyperjumpSpeed] !== 0) {
                        t[CharacterSkillType.HyperjumpSpeed] -= b2;
                    }
                    if (s[CharacterSkillType.TroopGroundAttack] !== 0) {
                        t[CharacterSkillType.TroopGroundAttack] -= b2;
                    }
                    if (s[CharacterSkillType.TroopGroundDefense] !== 0) {
                        t[CharacterSkillType.TroopGroundDefense] -= b2;
                    }
                    if (s[CharacterSkillType.TroopExperienceGain] !== 0) {
                        t[CharacterSkillType.TroopExperienceGain] -= b2;
                    }
                    if (s[CharacterSkillType.TroopRecoveryRate] !== 0) {
                        t[CharacterSkillType.TroopRecoveryRate] -= b2;
                    }
                    break;
                case CharacterTraitType.Energetic:
                    if (s[CharacterSkillType.Diplomacy] !== 0) {
                        t[CharacterSkillType.Diplomacy] += b2;
                    }
                    if (s[CharacterSkillType.ColonyIncome] !== 0) {
                        t[CharacterSkillType.ColonyIncome] += b2;
                    }
                    if (s[CharacterSkillType.TradeIncome] !== 0) {
                        t[CharacterSkillType.TradeIncome] += b2;
                    }
                    if (s[CharacterSkillType.TourismIncome] !== 0) {
                        t[CharacterSkillType.TourismIncome] += b2;
                    }
                    if (s[CharacterSkillType.ColonyCorruption] !== 0) {
                        t[CharacterSkillType.ColonyCorruption] += b2;
                    }
                    if (s[CharacterSkillType.ColonyHappiness] !== 0) {
                        t[CharacterSkillType.ColonyHappiness] += b2;
                    }
                    if (s[CharacterSkillType.PopulationGrowth] !== 0) {
                        t[CharacterSkillType.PopulationGrowth] += b2;
                    }
                    if (s[CharacterSkillType.MiningRate] !== 0) {
                        t[CharacterSkillType.MiningRate] += b2;
                    }
                    if (s[CharacterSkillType.TroopRecruitment] !== 0) {
                        t[CharacterSkillType.TroopRecruitment] += b2;
                    }
                    if (s[CharacterSkillType.MilitaryShipConstructionSpeed] !== 0) {
                        t[CharacterSkillType.MilitaryShipConstructionSpeed] += b2;
                    }
                    if (s[CharacterSkillType.CivilianShipConstructionSpeed] !== 0) {
                        t[CharacterSkillType.CivilianShipConstructionSpeed] += b2;
                    }
                    if (s[CharacterSkillType.ColonyShipConstructionSpeed] !== 0) {
                        t[CharacterSkillType.ColonyShipConstructionSpeed] += b2;
                    }
                    if (s[CharacterSkillType.FacilityConstructionSpeed] !== 0) {
                        t[CharacterSkillType.FacilityConstructionSpeed] += b2;
                    }
                    if (s[CharacterSkillType.ResearchWeapons] !== 0) {
                        t[CharacterSkillType.ResearchWeapons] += b2;
                    }
                    if (s[CharacterSkillType.ResearchEnergy] !== 0) {
                        t[CharacterSkillType.ResearchEnergy] += b2;
                    }
                    if (s[CharacterSkillType.ResearchHighTech] !== 0) {
                        t[CharacterSkillType.ResearchHighTech] += b2;
                    }
                    if (s[CharacterSkillType.Espionage] !== 0) {
                        t[CharacterSkillType.Espionage] += b2;
                    }
                    if (s[CharacterSkillType.CounterEspionage] !== 0) {
                        t[CharacterSkillType.CounterEspionage] += b2;
                    }
                    if (s[CharacterSkillType.Sabotage] !== 0) {
                        t[CharacterSkillType.Sabotage] += b2;
                    }
                    if (s[CharacterSkillType.Concealment] !== 0) {
                        t[CharacterSkillType.Concealment] += b2;
                    }
                    if (s[CharacterSkillType.PsyOps] !== 0) {
                        t[CharacterSkillType.PsyOps] += b2;
                    }
                    if (s[CharacterSkillType.Assassination] !== 0) {
                        t[CharacterSkillType.Assassination] += b2;
                    }
                    if (s[CharacterSkillType.MilitaryShipMaintenance] !== 0) {
                        t[CharacterSkillType.MilitaryShipMaintenance] += b2;
                    }
                    if (s[CharacterSkillType.CivilianShipMaintenance] !== 0) {
                        t[CharacterSkillType.CivilianShipMaintenance] += b2;
                    }
                    if (s[CharacterSkillType.MilitaryBaseMaintenance] !== 0) {
                        t[CharacterSkillType.MilitaryBaseMaintenance] += b2;
                    }
                    if (s[CharacterSkillType.CivilianBaseMaintenance] !== 0) {
                        t[CharacterSkillType.CivilianBaseMaintenance] += b2;
                    }
                    if (s[CharacterSkillType.TroopMaintenance] !== 0) {
                        t[CharacterSkillType.TroopMaintenance] += b2;
                    }
                    if (s[CharacterSkillType.WarWeariness] !== 0) {
                        t[CharacterSkillType.WarWeariness] += b2;
                    }
                    if (s[CharacterSkillType.Targeting] !== 0) {
                        t[CharacterSkillType.Targeting] += b2;
                    }
                    if (s[CharacterSkillType.Countermeasures] !== 0) {
                        t[CharacterSkillType.Countermeasures] += b2;
                    }
                    if (s[CharacterSkillType.ShipManeuvering] !== 0) {
                        t[CharacterSkillType.ShipManeuvering] += b2;
                    }
                    if (s[CharacterSkillType.Fighters] !== 0) {
                        t[CharacterSkillType.Fighters] += b2;
                    }
                    if (s[CharacterSkillType.ShipEnergyUsage] !== 0) {
                        t[CharacterSkillType.ShipEnergyUsage] += b2;
                    }
                    if (s[CharacterSkillType.WeaponsDamage] !== 0) {
                        t[CharacterSkillType.WeaponsDamage] += b2;
                    }
                    if (s[CharacterSkillType.WeaponsRange] !== 0) {
                        t[CharacterSkillType.WeaponsRange] += b2;
                    }
                    if (s[CharacterSkillType.ShieldRechargeRate] !== 0) {
                        t[CharacterSkillType.ShieldRechargeRate] += b2;
                    }
                    if (s[CharacterSkillType.DamageControl] !== 0) {
                        t[CharacterSkillType.DamageControl] += b2;
                    }
                    if (s[CharacterSkillType.RepairBonus] !== 0) {
                        t[CharacterSkillType.RepairBonus] += b2;
                    }
                    if (s[CharacterSkillType.HyperjumpSpeed] !== 0) {
                        t[CharacterSkillType.HyperjumpSpeed] += b2;
                    }
                    if (s[CharacterSkillType.TroopGroundAttack] !== 0) {
                        t[CharacterSkillType.TroopGroundAttack] += b2;
                    }
                    if (s[CharacterSkillType.TroopGroundDefense] !== 0) {
                        t[CharacterSkillType.TroopGroundDefense] += b2;
                    }
                    if (s[CharacterSkillType.TroopExperienceGain] !== 0) {
                        t[CharacterSkillType.TroopExperienceGain] += b2;
                    }
                    if (s[CharacterSkillType.TroopRecoveryRate] !== 0) {
                        t[CharacterSkillType.TroopRecoveryRate] += b2;
                    }
                    break;
                case CharacterTraitType.Drunk:
                    if (s[CharacterSkillType.Diplomacy] !== 0) {
                        t[CharacterSkillType.Diplomacy] -= b2;
                    }
                    if (s[CharacterSkillType.ColonyIncome] !== 0) {
                        t[CharacterSkillType.ColonyIncome] -= b2;
                    }
                    if (s[CharacterSkillType.TradeIncome] !== 0) {
                        t[CharacterSkillType.TradeIncome] -= b2;
                    }
                    if (s[CharacterSkillType.TourismIncome] !== 0) {
                        t[CharacterSkillType.TourismIncome] -= b2;
                    }
                    if (s[CharacterSkillType.ColonyCorruption] !== 0) {
                        t[CharacterSkillType.ColonyCorruption] -= b2;
                    }
                    if (s[CharacterSkillType.ColonyHappiness] !== 0) {
                        t[CharacterSkillType.ColonyHappiness] -= b2;
                    }
                    if (s[CharacterSkillType.PopulationGrowth] !== 0) {
                        t[CharacterSkillType.PopulationGrowth] -= b2;
                    }
                    if (s[CharacterSkillType.MiningRate] !== 0) {
                        t[CharacterSkillType.MiningRate] -= b2;
                    }
                    if (s[CharacterSkillType.TroopRecruitment] !== 0) {
                        t[CharacterSkillType.TroopRecruitment] -= b2;
                    }
                    if (s[CharacterSkillType.MilitaryShipConstructionSpeed] !== 0) {
                        t[CharacterSkillType.MilitaryShipConstructionSpeed] -= b2;
                    }
                    if (s[CharacterSkillType.CivilianShipConstructionSpeed] !== 0) {
                        t[CharacterSkillType.CivilianShipConstructionSpeed] -= b2;
                    }
                    if (s[CharacterSkillType.ColonyShipConstructionSpeed] !== 0) {
                        t[CharacterSkillType.ColonyShipConstructionSpeed] -= b2;
                    }
                    if (s[CharacterSkillType.FacilityConstructionSpeed] !== 0) {
                        t[CharacterSkillType.FacilityConstructionSpeed] -= b2;
                    }
                    if (s[CharacterSkillType.ResearchWeapons] !== 0) {
                        t[CharacterSkillType.ResearchWeapons] -= b2;
                    }
                    if (s[CharacterSkillType.ResearchEnergy] !== 0) {
                        t[CharacterSkillType.ResearchEnergy] -= b2;
                    }
                    if (s[CharacterSkillType.ResearchHighTech] !== 0) {
                        t[CharacterSkillType.ResearchHighTech] -= b2;
                    }
                    if (s[CharacterSkillType.Espionage] !== 0) {
                        t[CharacterSkillType.Espionage] -= b2;
                    }
                    if (s[CharacterSkillType.CounterEspionage] !== 0) {
                        t[CharacterSkillType.CounterEspionage] -= b2;
                    }
                    if (s[CharacterSkillType.Sabotage] !== 0) {
                        t[CharacterSkillType.Sabotage] -= b2;
                    }
                    if (s[CharacterSkillType.Concealment] !== 0) {
                        t[CharacterSkillType.Concealment] -= b2;
                    }
                    if (s[CharacterSkillType.PsyOps] !== 0) {
                        t[CharacterSkillType.PsyOps] -= b2;
                    }
                    if (s[CharacterSkillType.Assassination] !== 0) {
                        t[CharacterSkillType.Assassination] -= b2;
                    }
                    if (s[CharacterSkillType.MilitaryShipMaintenance] !== 0) {
                        t[CharacterSkillType.MilitaryShipMaintenance] -= b2;
                    }
                    if (s[CharacterSkillType.CivilianShipMaintenance] !== 0) {
                        t[CharacterSkillType.CivilianShipMaintenance] -= b2;
                    }
                    if (s[CharacterSkillType.MilitaryBaseMaintenance] !== 0) {
                        t[CharacterSkillType.MilitaryBaseMaintenance] -= b2;
                    }
                    if (s[CharacterSkillType.CivilianBaseMaintenance] !== 0) {
                        t[CharacterSkillType.CivilianBaseMaintenance] -= b2;
                    }
                    if (s[CharacterSkillType.TroopMaintenance] !== 0) {
                        t[CharacterSkillType.TroopMaintenance] -= b2;
                    }
                    if (s[CharacterSkillType.WarWeariness] !== 0) {
                        t[CharacterSkillType.WarWeariness] -= b2;
                    }
                    if (s[CharacterSkillType.Targeting] !== 0) {
                        t[CharacterSkillType.Targeting] -= b2;
                    }
                    if (s[CharacterSkillType.Countermeasures] !== 0) {
                        t[CharacterSkillType.Countermeasures] -= b2;
                    }
                    if (s[CharacterSkillType.ShipManeuvering] !== 0) {
                        t[CharacterSkillType.ShipManeuvering] -= b2;
                    }
                    if (s[CharacterSkillType.Fighters] !== 0) {
                        t[CharacterSkillType.Fighters] -= b2;
                    }
                    if (s[CharacterSkillType.ShipEnergyUsage] !== 0) {
                        t[CharacterSkillType.ShipEnergyUsage] -= b2;
                    }
                    if (s[CharacterSkillType.WeaponsDamage] !== 0) {
                        t[CharacterSkillType.WeaponsDamage] -= b2;
                    }
                    if (s[CharacterSkillType.WeaponsRange] !== 0) {
                        t[CharacterSkillType.WeaponsRange] -= b2;
                    }
                    if (s[CharacterSkillType.ShieldRechargeRate] !== 0) {
                        t[CharacterSkillType.ShieldRechargeRate] -= b2;
                    }
                    if (s[CharacterSkillType.DamageControl] !== 0) {
                        t[CharacterSkillType.DamageControl] -= b2;
                    }
                    if (s[CharacterSkillType.RepairBonus] !== 0) {
                        t[CharacterSkillType.RepairBonus] -= b2;
                    }
                    if (s[CharacterSkillType.HyperjumpSpeed] !== 0) {
                        t[CharacterSkillType.HyperjumpSpeed] -= b2;
                    }
                    if (s[CharacterSkillType.TroopGroundAttack] !== 0) {
                        t[CharacterSkillType.TroopGroundAttack] -= b2;
                    }
                    if (s[CharacterSkillType.TroopGroundDefense] !== 0) {
                        t[CharacterSkillType.TroopGroundDefense] -= b2;
                    }
                    if (s[CharacterSkillType.TroopExperienceGain] !== 0) {
                        t[CharacterSkillType.TroopExperienceGain] -= b2;
                    }
                    if (s[CharacterSkillType.TroopRecoveryRate] !== 0) {
                        t[CharacterSkillType.TroopRecoveryRate] -= b2;
                    }
                    break;
                case CharacterTraitType.ToughDiscipline:
                    if (s[CharacterSkillType.Diplomacy] !== 0) {
                        t[CharacterSkillType.Diplomacy] += b2;
                    }
                    if (s[CharacterSkillType.ColonyIncome] !== 0) {
                        t[CharacterSkillType.ColonyIncome] += b2;
                    }
                    if (s[CharacterSkillType.TradeIncome] !== 0) {
                        t[CharacterSkillType.TradeIncome] += b2;
                    }
                    if (s[CharacterSkillType.TourismIncome] !== 0) {
                        t[CharacterSkillType.TourismIncome] += b2;
                    }
                    if (s[CharacterSkillType.ColonyCorruption] !== 0) {
                        t[CharacterSkillType.ColonyCorruption] += b2;
                    }
                    if (s[CharacterSkillType.ColonyHappiness] !== 0) {
                        t[CharacterSkillType.ColonyHappiness] += b2;
                    }
                    if (s[CharacterSkillType.PopulationGrowth] !== 0) {
                        t[CharacterSkillType.PopulationGrowth] += b2;
                    }
                    if (s[CharacterSkillType.MiningRate] !== 0) {
                        t[CharacterSkillType.MiningRate] += b2;
                    }
                    if (s[CharacterSkillType.TroopRecruitment] !== 0) {
                        t[CharacterSkillType.TroopRecruitment] += b2;
                    }
                    if (s[CharacterSkillType.MilitaryShipConstructionSpeed] !== 0) {
                        t[CharacterSkillType.MilitaryShipConstructionSpeed] += b2;
                    }
                    if (s[CharacterSkillType.CivilianShipConstructionSpeed] !== 0) {
                        t[CharacterSkillType.CivilianShipConstructionSpeed] += b2;
                    }
                    if (s[CharacterSkillType.ColonyShipConstructionSpeed] !== 0) {
                        t[CharacterSkillType.ColonyShipConstructionSpeed] += b2;
                    }
                    if (s[CharacterSkillType.FacilityConstructionSpeed] !== 0) {
                        t[CharacterSkillType.FacilityConstructionSpeed] += b2;
                    }
                    if (s[CharacterSkillType.ResearchWeapons] !== 0) {
                        t[CharacterSkillType.ResearchWeapons] += b2;
                    }
                    if (s[CharacterSkillType.ResearchEnergy] !== 0) {
                        t[CharacterSkillType.ResearchEnergy] += b2;
                    }
                    if (s[CharacterSkillType.ResearchHighTech] !== 0) {
                        t[CharacterSkillType.ResearchHighTech] += b2;
                    }
                    if (s[CharacterSkillType.Espionage] !== 0) {
                        t[CharacterSkillType.Espionage] += b2;
                    }
                    if (s[CharacterSkillType.CounterEspionage] !== 0) {
                        t[CharacterSkillType.CounterEspionage] += b2;
                    }
                    if (s[CharacterSkillType.Sabotage] !== 0) {
                        t[CharacterSkillType.Sabotage] += b2;
                    }
                    if (s[CharacterSkillType.Concealment] !== 0) {
                        t[CharacterSkillType.Concealment] += b2;
                    }
                    if (s[CharacterSkillType.PsyOps] !== 0) {
                        t[CharacterSkillType.PsyOps] += b2;
                    }
                    if (s[CharacterSkillType.Assassination] !== 0) {
                        t[CharacterSkillType.Assassination] += b2;
                    }
                    if (s[CharacterSkillType.MilitaryShipMaintenance] !== 0) {
                        t[CharacterSkillType.MilitaryShipMaintenance] += b2;
                    }
                    if (s[CharacterSkillType.CivilianShipMaintenance] !== 0) {
                        t[CharacterSkillType.CivilianShipMaintenance] += b2;
                    }
                    if (s[CharacterSkillType.MilitaryBaseMaintenance] !== 0) {
                        t[CharacterSkillType.MilitaryBaseMaintenance] += b2;
                    }
                    if (s[CharacterSkillType.CivilianBaseMaintenance] !== 0) {
                        t[CharacterSkillType.CivilianBaseMaintenance] += b2;
                    }
                    if (s[CharacterSkillType.TroopMaintenance] !== 0) {
                        t[CharacterSkillType.TroopMaintenance] += b2;
                    }
                    if (s[CharacterSkillType.WarWeariness] !== 0) {
                        t[CharacterSkillType.WarWeariness] += b2;
                    }
                    if (s[CharacterSkillType.Targeting] !== 0) {
                        t[CharacterSkillType.Targeting] += b2;
                    }
                    if (s[CharacterSkillType.Countermeasures] !== 0) {
                        t[CharacterSkillType.Countermeasures] += b2;
                    }
                    if (s[CharacterSkillType.ShipManeuvering] !== 0) {
                        t[CharacterSkillType.ShipManeuvering] += b2;
                    }
                    if (s[CharacterSkillType.Fighters] !== 0) {
                        t[CharacterSkillType.Fighters] += b2;
                    }
                    if (s[CharacterSkillType.ShipEnergyUsage] !== 0) {
                        t[CharacterSkillType.ShipEnergyUsage] += b2;
                    }
                    if (s[CharacterSkillType.WeaponsDamage] !== 0) {
                        t[CharacterSkillType.WeaponsDamage] += b2;
                    }
                    if (s[CharacterSkillType.WeaponsRange] !== 0) {
                        t[CharacterSkillType.WeaponsRange] += b2;
                    }
                    if (s[CharacterSkillType.ShieldRechargeRate] !== 0) {
                        t[CharacterSkillType.ShieldRechargeRate] += b2;
                    }
                    if (s[CharacterSkillType.DamageControl] !== 0) {
                        t[CharacterSkillType.DamageControl] += b2;
                    }
                    if (s[CharacterSkillType.RepairBonus] !== 0) {
                        t[CharacterSkillType.RepairBonus] += b2;
                    }
                    if (s[CharacterSkillType.HyperjumpSpeed] !== 0) {
                        t[CharacterSkillType.HyperjumpSpeed] += b2;
                    }
                    if (s[CharacterSkillType.TroopGroundAttack] !== 0) {
                        t[CharacterSkillType.TroopGroundAttack] += b2;
                    }
                    if (s[CharacterSkillType.TroopGroundDefense] !== 0) {
                        t[CharacterSkillType.TroopGroundDefense] += b2;
                    }
                    if (s[CharacterSkillType.TroopExperienceGain] !== 0) {
                        t[CharacterSkillType.TroopExperienceGain] += b2;
                    }
                    if (s[CharacterSkillType.TroopRecoveryRate] !== 0) {
                        t[CharacterSkillType.TroopRecoveryRate] += b2;
                    }
                    break;
                case CharacterTraitType.LaxDiscipline:
                    if (s[CharacterSkillType.Diplomacy] !== 0) {
                        t[CharacterSkillType.Diplomacy] -= b2;
                    }
                    if (s[CharacterSkillType.ColonyIncome] !== 0) {
                        t[CharacterSkillType.ColonyIncome] -= b2;
                    }
                    if (s[CharacterSkillType.TradeIncome] !== 0) {
                        t[CharacterSkillType.TradeIncome] -= b2;
                    }
                    if (s[CharacterSkillType.TourismIncome] !== 0) {
                        t[CharacterSkillType.TourismIncome] -= b2;
                    }
                    if (s[CharacterSkillType.ColonyCorruption] !== 0) {
                        t[CharacterSkillType.ColonyCorruption] -= b2;
                    }
                    if (s[CharacterSkillType.ColonyHappiness] !== 0) {
                        t[CharacterSkillType.ColonyHappiness] -= b2;
                    }
                    if (s[CharacterSkillType.PopulationGrowth] !== 0) {
                        t[CharacterSkillType.PopulationGrowth] -= b2;
                    }
                    if (s[CharacterSkillType.MiningRate] !== 0) {
                        t[CharacterSkillType.MiningRate] -= b2;
                    }
                    if (s[CharacterSkillType.TroopRecruitment] !== 0) {
                        t[CharacterSkillType.TroopRecruitment] -= b2;
                    }
                    if (s[CharacterSkillType.MilitaryShipConstructionSpeed] !== 0) {
                        t[CharacterSkillType.MilitaryShipConstructionSpeed] -= b2;
                    }
                    if (s[CharacterSkillType.CivilianShipConstructionSpeed] !== 0) {
                        t[CharacterSkillType.CivilianShipConstructionSpeed] -= b2;
                    }
                    if (s[CharacterSkillType.ColonyShipConstructionSpeed] !== 0) {
                        t[CharacterSkillType.ColonyShipConstructionSpeed] -= b2;
                    }
                    if (s[CharacterSkillType.FacilityConstructionSpeed] !== 0) {
                        t[CharacterSkillType.FacilityConstructionSpeed] -= b2;
                    }
                    if (s[CharacterSkillType.ResearchWeapons] !== 0) {
                        t[CharacterSkillType.ResearchWeapons] -= b2;
                    }
                    if (s[CharacterSkillType.ResearchEnergy] !== 0) {
                        t[CharacterSkillType.ResearchEnergy] -= b2;
                    }
                    if (s[CharacterSkillType.ResearchHighTech] !== 0) {
                        t[CharacterSkillType.ResearchHighTech] -= b2;
                    }
                    if (s[CharacterSkillType.Espionage] !== 0) {
                        t[CharacterSkillType.Espionage] -= b2;
                    }
                    if (s[CharacterSkillType.CounterEspionage] !== 0) {
                        t[CharacterSkillType.CounterEspionage] -= b2;
                    }
                    if (s[CharacterSkillType.Sabotage] !== 0) {
                        t[CharacterSkillType.Sabotage] -= b2;
                    }
                    if (s[CharacterSkillType.Concealment] !== 0) {
                        t[CharacterSkillType.Concealment] -= b2;
                    }
                    if (s[CharacterSkillType.PsyOps] !== 0) {
                        t[CharacterSkillType.PsyOps] -= b2;
                    }
                    if (s[CharacterSkillType.Assassination] !== 0) {
                        t[CharacterSkillType.Assassination] -= b2;
                    }
                    if (s[CharacterSkillType.MilitaryShipMaintenance] !== 0) {
                        t[CharacterSkillType.MilitaryShipMaintenance] -= b2;
                    }
                    if (s[CharacterSkillType.CivilianShipMaintenance] !== 0) {
                        t[CharacterSkillType.CivilianShipMaintenance] -= b2;
                    }
                    if (s[CharacterSkillType.MilitaryBaseMaintenance] !== 0) {
                        t[CharacterSkillType.MilitaryBaseMaintenance] -= b2;
                    }
                    if (s[CharacterSkillType.CivilianBaseMaintenance] !== 0) {
                        t[CharacterSkillType.CivilianBaseMaintenance] -= b2;
                    }
                    if (s[CharacterSkillType.TroopMaintenance] !== 0) {
                        t[CharacterSkillType.TroopMaintenance] -= b2;
                    }
                    if (s[CharacterSkillType.WarWeariness] !== 0) {
                        t[CharacterSkillType.WarWeariness] -= b2;
                    }
                    if (s[CharacterSkillType.Targeting] !== 0) {
                        t[CharacterSkillType.Targeting] -= b2;
                    }
                    if (s[CharacterSkillType.Countermeasures] !== 0) {
                        t[CharacterSkillType.Countermeasures] -= b2;
                    }
                    if (s[CharacterSkillType.ShipManeuvering] !== 0) {
                        t[CharacterSkillType.ShipManeuvering] -= b2;
                    }
                    if (s[CharacterSkillType.Fighters] !== 0) {
                        t[CharacterSkillType.Fighters] -= b2;
                    }
                    if (s[CharacterSkillType.ShipEnergyUsage] !== 0) {
                        t[CharacterSkillType.ShipEnergyUsage] -= b2;
                    }
                    if (s[CharacterSkillType.WeaponsDamage] !== 0) {
                        t[CharacterSkillType.WeaponsDamage] -= b2;
                    }
                    if (s[CharacterSkillType.WeaponsRange] !== 0) {
                        t[CharacterSkillType.WeaponsRange] -= b2;
                    }
                    if (s[CharacterSkillType.ShieldRechargeRate] !== 0) {
                        t[CharacterSkillType.ShieldRechargeRate] -= b2;
                    }
                    if (s[CharacterSkillType.DamageControl] !== 0) {
                        t[CharacterSkillType.DamageControl] -= b2;
                    }
                    if (s[CharacterSkillType.RepairBonus] !== 0) {
                        t[CharacterSkillType.RepairBonus] -= b2;
                    }
                    if (s[CharacterSkillType.HyperjumpSpeed] !== 0) {
                        t[CharacterSkillType.HyperjumpSpeed] -= b2;
                    }
                    if (s[CharacterSkillType.TroopGroundAttack] !== 0) {
                        t[CharacterSkillType.TroopGroundAttack] -= b2;
                    }
                    if (s[CharacterSkillType.TroopGroundDefense] !== 0) {
                        t[CharacterSkillType.TroopGroundDefense] -= b2;
                    }
                    if (s[CharacterSkillType.TroopExperienceGain] !== 0) {
                        t[CharacterSkillType.TroopExperienceGain] -= b2;
                    }
                    if (s[CharacterSkillType.TroopRecoveryRate] !== 0) {
                        t[CharacterSkillType.TroopRecoveryRate] -= b2;
                    }
                    break;
                case CharacterTraitType.IntelligenceAddict:
                    if (s[CharacterSkillType.Espionage] !== 0) {
                        t[CharacterSkillType.Espionage] -= b;
                    }
                    if (s[CharacterSkillType.CounterEspionage] !== 0) {
                        t[CharacterSkillType.CounterEspionage] -= b;
                    }
                    if (s[CharacterSkillType.Sabotage] !== 0) {
                        t[CharacterSkillType.Sabotage] -= b;
                    }
                    if (s[CharacterSkillType.PsyOps] !== 0) {
                        t[CharacterSkillType.PsyOps] -= b;
                    }
                    if (s[CharacterSkillType.Concealment] !== 0) {
                        t[CharacterSkillType.Concealment] -= b;
                    }
                    break;
                case CharacterTraitType.IntelligenceSober:
                    if (s[CharacterSkillType.Espionage] !== 0) {
                        t[CharacterSkillType.Espionage] += b;
                    }
                    if (s[CharacterSkillType.CounterEspionage] !== 0) {
                        t[CharacterSkillType.CounterEspionage] += b;
                    }
                    if (s[CharacterSkillType.Sabotage] !== 0) {
                        t[CharacterSkillType.Sabotage] += b;
                    }
                    if (s[CharacterSkillType.PsyOps] !== 0) {
                        t[CharacterSkillType.PsyOps] += b;
                    }
                    if (s[CharacterSkillType.Concealment] !== 0) {
                        t[CharacterSkillType.Concealment] += b;
                    }
                    break;
                case CharacterTraitType.GoodTactician:
                    if (s[CharacterSkillType.Diplomacy] !== 0) {
                        t[CharacterSkillType.Diplomacy] += b2;
                    }
                    if (s[CharacterSkillType.ColonyIncome] !== 0) {
                        t[CharacterSkillType.ColonyIncome] += b2;
                    }
                    if (s[CharacterSkillType.TradeIncome] !== 0) {
                        t[CharacterSkillType.TradeIncome] += b2;
                    }
                    if (s[CharacterSkillType.TourismIncome] !== 0) {
                        t[CharacterSkillType.TourismIncome] += b2;
                    }
                    if (s[CharacterSkillType.ColonyCorruption] !== 0) {
                        t[CharacterSkillType.ColonyCorruption] += b2;
                    }
                    if (s[CharacterSkillType.ColonyHappiness] !== 0) {
                        t[CharacterSkillType.ColonyHappiness] += b2;
                    }
                    if (s[CharacterSkillType.PopulationGrowth] !== 0) {
                        t[CharacterSkillType.PopulationGrowth] += b2;
                    }
                    if (s[CharacterSkillType.MiningRate] !== 0) {
                        t[CharacterSkillType.MiningRate] += b2;
                    }
                    if (s[CharacterSkillType.TroopRecruitment] !== 0) {
                        t[CharacterSkillType.TroopRecruitment] += b2;
                    }
                    if (s[CharacterSkillType.MilitaryShipConstructionSpeed] !== 0) {
                        t[CharacterSkillType.MilitaryShipConstructionSpeed] += b2;
                    }
                    if (s[CharacterSkillType.CivilianShipConstructionSpeed] !== 0) {
                        t[CharacterSkillType.CivilianShipConstructionSpeed] += b2;
                    }
                    if (s[CharacterSkillType.ColonyShipConstructionSpeed] !== 0) {
                        t[CharacterSkillType.ColonyShipConstructionSpeed] += b2;
                    }
                    if (s[CharacterSkillType.FacilityConstructionSpeed] !== 0) {
                        t[CharacterSkillType.FacilityConstructionSpeed] += b2;
                    }
                    if (s[CharacterSkillType.ResearchWeapons] !== 0) {
                        t[CharacterSkillType.ResearchWeapons] += b2;
                    }
                    if (s[CharacterSkillType.ResearchEnergy] !== 0) {
                        t[CharacterSkillType.ResearchEnergy] += b2;
                    }
                    if (s[CharacterSkillType.ResearchHighTech] !== 0) {
                        t[CharacterSkillType.ResearchHighTech] += b2;
                    }
                    if (s[CharacterSkillType.Espionage] !== 0) {
                        t[CharacterSkillType.Espionage] += b2;
                    }
                    if (s[CharacterSkillType.CounterEspionage] !== 0) {
                        t[CharacterSkillType.CounterEspionage] += b2;
                    }
                    if (s[CharacterSkillType.Sabotage] !== 0) {
                        t[CharacterSkillType.Sabotage] += b2;
                    }
                    if (s[CharacterSkillType.Concealment] !== 0) {
                        t[CharacterSkillType.Concealment] += b2;
                    }
                    if (s[CharacterSkillType.PsyOps] !== 0) {
                        t[CharacterSkillType.PsyOps] += b2;
                    }
                    if (s[CharacterSkillType.Assassination] !== 0) {
                        t[CharacterSkillType.Assassination] += b2;
                    }
                    if (s[CharacterSkillType.MilitaryShipMaintenance] !== 0) {
                        t[CharacterSkillType.MilitaryShipMaintenance] += b2;
                    }
                    if (s[CharacterSkillType.CivilianShipMaintenance] !== 0) {
                        t[CharacterSkillType.CivilianShipMaintenance] += b2;
                    }
                    if (s[CharacterSkillType.MilitaryBaseMaintenance] !== 0) {
                        t[CharacterSkillType.MilitaryBaseMaintenance] += b2;
                    }
                    if (s[CharacterSkillType.CivilianBaseMaintenance] !== 0) {
                        t[CharacterSkillType.CivilianBaseMaintenance] += b2;
                    }
                    if (s[CharacterSkillType.TroopMaintenance] !== 0) {
                        t[CharacterSkillType.TroopMaintenance] += b2;
                    }
                    if (s[CharacterSkillType.WarWeariness] !== 0) {
                        t[CharacterSkillType.WarWeariness] += b2;
                    }
                    if (s[CharacterSkillType.Targeting] !== 0) {
                        t[CharacterSkillType.Targeting] += b2;
                    }
                    if (s[CharacterSkillType.Countermeasures] !== 0) {
                        t[CharacterSkillType.Countermeasures] += b2;
                    }
                    if (s[CharacterSkillType.ShipManeuvering] !== 0) {
                        t[CharacterSkillType.ShipManeuvering] += b2;
                    }
                    if (s[CharacterSkillType.Fighters] !== 0) {
                        t[CharacterSkillType.Fighters] += b2;
                    }
                    if (s[CharacterSkillType.ShipEnergyUsage] !== 0) {
                        t[CharacterSkillType.ShipEnergyUsage] += b2;
                    }
                    if (s[CharacterSkillType.WeaponsDamage] !== 0) {
                        t[CharacterSkillType.WeaponsDamage] += b2;
                    }
                    if (s[CharacterSkillType.WeaponsRange] !== 0) {
                        t[CharacterSkillType.WeaponsRange] += b2;
                    }
                    if (s[CharacterSkillType.ShieldRechargeRate] !== 0) {
                        t[CharacterSkillType.ShieldRechargeRate] += b2;
                    }
                    if (s[CharacterSkillType.DamageControl] !== 0) {
                        t[CharacterSkillType.DamageControl] += b2;
                    }
                    if (s[CharacterSkillType.RepairBonus] !== 0) {
                        t[CharacterSkillType.RepairBonus] += b2;
                    }
                    if (s[CharacterSkillType.HyperjumpSpeed] !== 0) {
                        t[CharacterSkillType.HyperjumpSpeed] += b2;
                    }
                    if (s[CharacterSkillType.TroopGroundAttack] !== 0) {
                        t[CharacterSkillType.TroopGroundAttack] += b2;
                    }
                    if (s[CharacterSkillType.TroopGroundDefense] !== 0) {
                        t[CharacterSkillType.TroopGroundDefense] += b2;
                    }
                    if (s[CharacterSkillType.TroopExperienceGain] !== 0) {
                        t[CharacterSkillType.TroopExperienceGain] += b2;
                    }
                    if (s[CharacterSkillType.TroopRecoveryRate] !== 0) {
                        t[CharacterSkillType.TroopRecoveryRate] += b2;
                    }
                    break;
                case CharacterTraitType.PoorTactician:
                    if (s[CharacterSkillType.Diplomacy] !== 0) {
                        t[CharacterSkillType.Diplomacy] -= b2;
                    }
                    if (s[CharacterSkillType.ColonyIncome] !== 0) {
                        t[CharacterSkillType.ColonyIncome] -= b2;
                    }
                    if (s[CharacterSkillType.TradeIncome] !== 0) {
                        t[CharacterSkillType.TradeIncome] -= b2;
                    }
                    if (s[CharacterSkillType.TourismIncome] !== 0) {
                        t[CharacterSkillType.TourismIncome] -= b2;
                    }
                    if (s[CharacterSkillType.ColonyCorruption] !== 0) {
                        t[CharacterSkillType.ColonyCorruption] -= b2;
                    }
                    if (s[CharacterSkillType.ColonyHappiness] !== 0) {
                        t[CharacterSkillType.ColonyHappiness] -= b2;
                    }
                    if (s[CharacterSkillType.PopulationGrowth] !== 0) {
                        t[CharacterSkillType.PopulationGrowth] -= b2;
                    }
                    if (s[CharacterSkillType.MiningRate] !== 0) {
                        t[CharacterSkillType.MiningRate] -= b2;
                    }
                    if (s[CharacterSkillType.TroopRecruitment] !== 0) {
                        t[CharacterSkillType.TroopRecruitment] -= b2;
                    }
                    if (s[CharacterSkillType.MilitaryShipConstructionSpeed] !== 0) {
                        t[CharacterSkillType.MilitaryShipConstructionSpeed] -= b2;
                    }
                    if (s[CharacterSkillType.CivilianShipConstructionSpeed] !== 0) {
                        t[CharacterSkillType.CivilianShipConstructionSpeed] -= b2;
                    }
                    if (s[CharacterSkillType.ColonyShipConstructionSpeed] !== 0) {
                        t[CharacterSkillType.ColonyShipConstructionSpeed] -= b2;
                    }
                    if (s[CharacterSkillType.FacilityConstructionSpeed] !== 0) {
                        t[CharacterSkillType.FacilityConstructionSpeed] -= b2;
                    }
                    if (s[CharacterSkillType.ResearchWeapons] !== 0) {
                        t[CharacterSkillType.ResearchWeapons] -= b2;
                    }
                    if (s[CharacterSkillType.ResearchEnergy] !== 0) {
                        t[CharacterSkillType.ResearchEnergy] -= b2;
                    }
                    if (s[CharacterSkillType.ResearchHighTech] !== 0) {
                        t[CharacterSkillType.ResearchHighTech] -= b2;
                    }
                    if (s[CharacterSkillType.Espionage] !== 0) {
                        t[CharacterSkillType.Espionage] -= b2;
                    }
                    if (s[CharacterSkillType.CounterEspionage] !== 0) {
                        t[CharacterSkillType.CounterEspionage] -= b2;
                    }
                    if (s[CharacterSkillType.Sabotage] !== 0) {
                        t[CharacterSkillType.Sabotage] -= b2;
                    }
                    if (s[CharacterSkillType.Concealment] !== 0) {
                        t[CharacterSkillType.Concealment] -= b2;
                    }
                    if (s[CharacterSkillType.PsyOps] !== 0) {
                        t[CharacterSkillType.PsyOps] -= b2;
                    }
                    if (s[CharacterSkillType.Assassination] !== 0) {
                        t[CharacterSkillType.Assassination] -= b2;
                    }
                    if (s[CharacterSkillType.MilitaryShipMaintenance] !== 0) {
                        t[CharacterSkillType.MilitaryShipMaintenance] -= b2;
                    }
                    if (s[CharacterSkillType.CivilianShipMaintenance] !== 0) {
                        t[CharacterSkillType.CivilianShipMaintenance] -= b2;
                    }
                    if (s[CharacterSkillType.MilitaryBaseMaintenance] !== 0) {
                        t[CharacterSkillType.MilitaryBaseMaintenance] -= b2;
                    }
                    if (s[CharacterSkillType.CivilianBaseMaintenance] !== 0) {
                        t[CharacterSkillType.CivilianBaseMaintenance] -= b2;
                    }
                    if (s[CharacterSkillType.TroopMaintenance] !== 0) {
                        t[CharacterSkillType.TroopMaintenance] -= b2;
                    }
                    if (s[CharacterSkillType.WarWeariness] !== 0) {
                        t[CharacterSkillType.WarWeariness] -= b2;
                    }
                    if (s[CharacterSkillType.Targeting] !== 0) {
                        t[CharacterSkillType.Targeting] -= b2;
                    }
                    if (s[CharacterSkillType.Countermeasures] !== 0) {
                        t[CharacterSkillType.Countermeasures] -= b2;
                    }
                    if (s[CharacterSkillType.ShipManeuvering] !== 0) {
                        t[CharacterSkillType.ShipManeuvering] -= b2;
                    }
                    if (s[CharacterSkillType.Fighters] !== 0) {
                        t[CharacterSkillType.Fighters] -= b2;
                    }
                    if (s[CharacterSkillType.ShipEnergyUsage] !== 0) {
                        t[CharacterSkillType.ShipEnergyUsage] -= b2;
                    }
                    if (s[CharacterSkillType.WeaponsDamage] !== 0) {
                        t[CharacterSkillType.WeaponsDamage] -= b2;
                    }
                    if (s[CharacterSkillType.WeaponsRange] !== 0) {
                        t[CharacterSkillType.WeaponsRange] -= b2;
                    }
                    if (s[CharacterSkillType.ShieldRechargeRate] !== 0) {
                        t[CharacterSkillType.ShieldRechargeRate] -= b2;
                    }
                    if (s[CharacterSkillType.DamageControl] !== 0) {
                        t[CharacterSkillType.DamageControl] -= b2;
                    }
                    if (s[CharacterSkillType.RepairBonus] !== 0) {
                        t[CharacterSkillType.RepairBonus] -= b2;
                    }
                    if (s[CharacterSkillType.HyperjumpSpeed] !== 0) {
                        t[CharacterSkillType.HyperjumpSpeed] -= b2;
                    }
                    if (s[CharacterSkillType.TroopGroundAttack] !== 0) {
                        t[CharacterSkillType.TroopGroundAttack] -= b2;
                    }
                    if (s[CharacterSkillType.TroopGroundDefense] !== 0) {
                        t[CharacterSkillType.TroopGroundDefense] -= b2;
                    }
                    if (s[CharacterSkillType.TroopExperienceGain] !== 0) {
                        t[CharacterSkillType.TroopExperienceGain] -= b2;
                    }
                    if (s[CharacterSkillType.TroopRecoveryRate] !== 0) {
                        t[CharacterSkillType.TroopRecoveryRate] -= b2;
                    }
                    break;
            }
        }
        this.clearIrrelevantTraitSkills();
    }

    // Character.cs ClearIrrelevantTraitSkills (3891).
    private clearIrrelevantTraitSkills(): void {
        const t = this.skillTraits;
        const list = determineValidSkillsForRole(this.role);
        const characterSkillList = new CharacterSkillList();
        for (let i = 0; i < this.traitSkills.count; i++) {
            const characterSkill = this.traitSkills.items[i];
            if (characterSkill !== null && !list.includes(characterSkill.type)) {
                characterSkillList.add(characterSkill);
            }
        }
        for (let j = 0; j < characterSkillList.count; j++) {
            this.traitSkills.remove(characterSkillList.items[j]);
        }
        switch (this.role) {
            case CharacterRole.Ambassador:
                t[CharacterSkillType.ColonyIncome] = 0;
                t[CharacterSkillType.ColonyCorruption] = 0;
                t[CharacterSkillType.ColonyHappiness] = 0;
                t[CharacterSkillType.PopulationGrowth] = 0;
                t[CharacterSkillType.MiningRate] = 0;
                t[CharacterSkillType.TroopRecruitment] = 0;
                t[CharacterSkillType.MilitaryShipConstructionSpeed] = 0;
                t[CharacterSkillType.CivilianShipConstructionSpeed] = 0;
                t[CharacterSkillType.ColonyShipConstructionSpeed] = 0;
                t[CharacterSkillType.FacilityConstructionSpeed] = 0;
                t[CharacterSkillType.ResearchWeapons] = 0;
                t[CharacterSkillType.ResearchEnergy] = 0;
                t[CharacterSkillType.ResearchHighTech] = 0;
                t[CharacterSkillType.Sabotage] = 0;
                t[CharacterSkillType.Concealment] = 0;
                t[CharacterSkillType.PsyOps] = 0;
                t[CharacterSkillType.Assassination] = 0;
                t[CharacterSkillType.MilitaryShipMaintenance] = 0;
                t[CharacterSkillType.CivilianShipMaintenance] = 0;
                t[CharacterSkillType.MilitaryBaseMaintenance] = 0;
                t[CharacterSkillType.CivilianBaseMaintenance] = 0;
                t[CharacterSkillType.TroopMaintenance] = 0;
                t[CharacterSkillType.WarWeariness] = 0;
                t[CharacterSkillType.Targeting] = 0;
                t[CharacterSkillType.Countermeasures] = 0;
                t[CharacterSkillType.ShipManeuvering] = 0;
                t[CharacterSkillType.Fighters] = 0;
                t[CharacterSkillType.ShipEnergyUsage] = 0;
                t[CharacterSkillType.WeaponsDamage] = 0;
                t[CharacterSkillType.WeaponsRange] = 0;
                t[CharacterSkillType.ShieldRechargeRate] = 0;
                t[CharacterSkillType.DamageControl] = 0;
                t[CharacterSkillType.RepairBonus] = 0;
                t[CharacterSkillType.HyperjumpSpeed] = 0;
                t[CharacterSkillType.TroopGroundAttack] = 0;
                t[CharacterSkillType.TroopGroundDefense] = 0;
                t[CharacterSkillType.TroopExperienceGain] = 0;
                t[CharacterSkillType.TroopRecoveryRate] = 0;
                t[CharacterSkillType.TroopStrengthArmor] = 0;
                t[CharacterSkillType.TroopStrengthInfantry] = 0;
                t[CharacterSkillType.TroopStrengthSpecialForces] = 0;
                t[CharacterSkillType.TroopStrengthPlanetaryDefense] = 0;
                t[CharacterSkillType.SmugglingIncome] = 0;
                t[CharacterSkillType.SmugglingEvasion] = 0;
                t[CharacterSkillType.BoardingAssault] = 0;
                break;
            case CharacterRole.ColonyGovernor:
                t[CharacterSkillType.Diplomacy] = 0;
                t[CharacterSkillType.ResearchWeapons] = 0;
                t[CharacterSkillType.ResearchEnergy] = 0;
                t[CharacterSkillType.ResearchHighTech] = 0;
                t[CharacterSkillType.Espionage] = 0;
                t[CharacterSkillType.CounterEspionage] = 0;
                t[CharacterSkillType.Sabotage] = 0;
                t[CharacterSkillType.Concealment] = 0;
                t[CharacterSkillType.PsyOps] = 0;
                t[CharacterSkillType.Assassination] = 0;
                t[CharacterSkillType.MilitaryShipMaintenance] = 0;
                t[CharacterSkillType.CivilianShipMaintenance] = 0;
                t[CharacterSkillType.CivilianBaseMaintenance] = 0;
                t[CharacterSkillType.Targeting] = 0;
                t[CharacterSkillType.Countermeasures] = 0;
                t[CharacterSkillType.ShipManeuvering] = 0;
                t[CharacterSkillType.Fighters] = 0;
                t[CharacterSkillType.ShipEnergyUsage] = 0;
                t[CharacterSkillType.WeaponsDamage] = 0;
                t[CharacterSkillType.WeaponsRange] = 0;
                t[CharacterSkillType.ShieldRechargeRate] = 0;
                t[CharacterSkillType.DamageControl] = 0;
                t[CharacterSkillType.RepairBonus] = 0;
                t[CharacterSkillType.HyperjumpSpeed] = 0;
                t[CharacterSkillType.TroopGroundAttack] = 0;
                t[CharacterSkillType.TroopGroundDefense] = 0;
                t[CharacterSkillType.TroopExperienceGain] = 0;
                t[CharacterSkillType.TroopRecoveryRate] = 0;
                t[CharacterSkillType.TroopStrengthArmor] = 0;
                t[CharacterSkillType.TroopStrengthInfantry] = 0;
                t[CharacterSkillType.TroopStrengthSpecialForces] = 0;
                t[CharacterSkillType.TroopStrengthPlanetaryDefense] = 0;
                t[CharacterSkillType.SmugglingIncome] = 0;
                t[CharacterSkillType.SmugglingEvasion] = 0;
                t[CharacterSkillType.BoardingAssault] = 0;
                break;
            case CharacterRole.FleetAdmiral:
                t[CharacterSkillType.Diplomacy] = 0;
                t[CharacterSkillType.ColonyIncome] = 0;
                t[CharacterSkillType.TradeIncome] = 0;
                t[CharacterSkillType.TourismIncome] = 0;
                t[CharacterSkillType.ColonyCorruption] = 0;
                t[CharacterSkillType.ColonyHappiness] = 0;
                t[CharacterSkillType.PopulationGrowth] = 0;
                t[CharacterSkillType.MiningRate] = 0;
                t[CharacterSkillType.TroopRecruitment] = 0;
                t[CharacterSkillType.ColonyShipConstructionSpeed] = 0;
                t[CharacterSkillType.FacilityConstructionSpeed] = 0;
                t[CharacterSkillType.ResearchWeapons] = 0;
                t[CharacterSkillType.ResearchEnergy] = 0;
                t[CharacterSkillType.ResearchHighTech] = 0;
                t[CharacterSkillType.Espionage] = 0;
                t[CharacterSkillType.Sabotage] = 0;
                t[CharacterSkillType.Concealment] = 0;
                t[CharacterSkillType.PsyOps] = 0;
                t[CharacterSkillType.Assassination] = 0;
                t[CharacterSkillType.CivilianShipMaintenance] = 0;
                t[CharacterSkillType.CivilianBaseMaintenance] = 0;
                t[CharacterSkillType.WarWeariness] = 0;
                t[CharacterSkillType.TroopGroundAttack] = 0;
                t[CharacterSkillType.TroopGroundDefense] = 0;
                t[CharacterSkillType.TroopExperienceGain] = 0;
                t[CharacterSkillType.TroopRecoveryRate] = 0;
                t[CharacterSkillType.TroopStrengthArmor] = 0;
                t[CharacterSkillType.TroopStrengthInfantry] = 0;
                t[CharacterSkillType.TroopStrengthSpecialForces] = 0;
                t[CharacterSkillType.TroopStrengthPlanetaryDefense] = 0;
                t[CharacterSkillType.SmugglingIncome] = 0;
                t[CharacterSkillType.SmugglingEvasion] = 0;
                break;
            case CharacterRole.ShipCaptain:
                t[CharacterSkillType.Diplomacy] = 0;
                t[CharacterSkillType.ColonyIncome] = 0;
                t[CharacterSkillType.TradeIncome] = 0;
                t[CharacterSkillType.TourismIncome] = 0;
                t[CharacterSkillType.ColonyCorruption] = 0;
                t[CharacterSkillType.ColonyHappiness] = 0;
                t[CharacterSkillType.PopulationGrowth] = 0;
                t[CharacterSkillType.MiningRate] = 0;
                t[CharacterSkillType.TroopRecruitment] = 0;
                t[CharacterSkillType.ColonyShipConstructionSpeed] = 0;
                t[CharacterSkillType.FacilityConstructionSpeed] = 0;
                t[CharacterSkillType.ResearchWeapons] = 0;
                t[CharacterSkillType.ResearchEnergy] = 0;
                t[CharacterSkillType.ResearchHighTech] = 0;
                t[CharacterSkillType.Espionage] = 0;
                t[CharacterSkillType.Sabotage] = 0;
                t[CharacterSkillType.Concealment] = 0;
                t[CharacterSkillType.PsyOps] = 0;
                t[CharacterSkillType.Assassination] = 0;
                t[CharacterSkillType.CivilianShipMaintenance] = 0;
                t[CharacterSkillType.CivilianBaseMaintenance] = 0;
                t[CharacterSkillType.WarWeariness] = 0;
                t[CharacterSkillType.TroopGroundAttack] = 0;
                t[CharacterSkillType.TroopGroundDefense] = 0;
                t[CharacterSkillType.TroopExperienceGain] = 0;
                t[CharacterSkillType.TroopRecoveryRate] = 0;
                t[CharacterSkillType.TroopStrengthArmor] = 0;
                t[CharacterSkillType.TroopStrengthInfantry] = 0;
                t[CharacterSkillType.TroopStrengthSpecialForces] = 0;
                t[CharacterSkillType.TroopStrengthPlanetaryDefense] = 0;
                break;
            case CharacterRole.IntelligenceAgent:
                t[CharacterSkillType.Diplomacy] = 0;
                t[CharacterSkillType.ColonyIncome] = 0;
                t[CharacterSkillType.TradeIncome] = 0;
                t[CharacterSkillType.TourismIncome] = 0;
                t[CharacterSkillType.ColonyCorruption] = 0;
                t[CharacterSkillType.ColonyHappiness] = 0;
                t[CharacterSkillType.PopulationGrowth] = 0;
                t[CharacterSkillType.MiningRate] = 0;
                t[CharacterSkillType.TroopRecruitment] = 0;
                t[CharacterSkillType.MilitaryShipConstructionSpeed] = 0;
                t[CharacterSkillType.CivilianShipConstructionSpeed] = 0;
                t[CharacterSkillType.ColonyShipConstructionSpeed] = 0;
                t[CharacterSkillType.FacilityConstructionSpeed] = 0;
                t[CharacterSkillType.ResearchWeapons] = 0;
                t[CharacterSkillType.ResearchEnergy] = 0;
                t[CharacterSkillType.ResearchHighTech] = 0;
                t[CharacterSkillType.MilitaryShipMaintenance] = 0;
                t[CharacterSkillType.CivilianShipMaintenance] = 0;
                t[CharacterSkillType.MilitaryBaseMaintenance] = 0;
                t[CharacterSkillType.CivilianBaseMaintenance] = 0;
                t[CharacterSkillType.TroopMaintenance] = 0;
                t[CharacterSkillType.WarWeariness] = 0;
                t[CharacterSkillType.Targeting] = 0;
                t[CharacterSkillType.Countermeasures] = 0;
                t[CharacterSkillType.ShipManeuvering] = 0;
                t[CharacterSkillType.Fighters] = 0;
                t[CharacterSkillType.ShipEnergyUsage] = 0;
                t[CharacterSkillType.WeaponsDamage] = 0;
                t[CharacterSkillType.WeaponsRange] = 0;
                t[CharacterSkillType.ShieldRechargeRate] = 0;
                t[CharacterSkillType.DamageControl] = 0;
                t[CharacterSkillType.RepairBonus] = 0;
                t[CharacterSkillType.HyperjumpSpeed] = 0;
                t[CharacterSkillType.TroopGroundAttack] = 0;
                t[CharacterSkillType.TroopGroundDefense] = 0;
                t[CharacterSkillType.TroopExperienceGain] = 0;
                t[CharacterSkillType.TroopRecoveryRate] = 0;
                t[CharacterSkillType.TroopStrengthArmor] = 0;
                t[CharacterSkillType.TroopStrengthInfantry] = 0;
                t[CharacterSkillType.TroopStrengthSpecialForces] = 0;
                t[CharacterSkillType.TroopStrengthPlanetaryDefense] = 0;
                t[CharacterSkillType.SmugglingIncome] = 0;
                t[CharacterSkillType.SmugglingEvasion] = 0;
                t[CharacterSkillType.BoardingAssault] = 0;
                break;
            case CharacterRole.Leader:
                t[CharacterSkillType.Sabotage] = 0;
                t[CharacterSkillType.Concealment] = 0;
                t[CharacterSkillType.PsyOps] = 0;
                t[CharacterSkillType.Assassination] = 0;
                t[CharacterSkillType.Targeting] = 0;
                t[CharacterSkillType.Countermeasures] = 0;
                t[CharacterSkillType.ShipManeuvering] = 0;
                t[CharacterSkillType.Fighters] = 0;
                t[CharacterSkillType.ShipEnergyUsage] = 0;
                t[CharacterSkillType.WeaponsDamage] = 0;
                t[CharacterSkillType.WeaponsRange] = 0;
                t[CharacterSkillType.ShieldRechargeRate] = 0;
                t[CharacterSkillType.DamageControl] = 0;
                t[CharacterSkillType.RepairBonus] = 0;
                t[CharacterSkillType.HyperjumpSpeed] = 0;
                t[CharacterSkillType.TroopGroundAttack] = 0;
                t[CharacterSkillType.TroopGroundDefense] = 0;
                t[CharacterSkillType.TroopExperienceGain] = 0;
                t[CharacterSkillType.TroopRecoveryRate] = 0;
                t[CharacterSkillType.TroopStrengthArmor] = 0;
                t[CharacterSkillType.TroopStrengthInfantry] = 0;
                t[CharacterSkillType.TroopStrengthSpecialForces] = 0;
                t[CharacterSkillType.TroopStrengthPlanetaryDefense] = 0;
                t[CharacterSkillType.SmugglingIncome] = 0;
                t[CharacterSkillType.SmugglingEvasion] = 0;
                t[CharacterSkillType.BoardingAssault] = 0;
                break;
            case CharacterRole.PirateLeader:
                t[CharacterSkillType.Sabotage] = 0;
                t[CharacterSkillType.Concealment] = 0;
                t[CharacterSkillType.PsyOps] = 0;
                t[CharacterSkillType.Assassination] = 0;
                t[CharacterSkillType.TroopGroundAttack] = 0;
                t[CharacterSkillType.TroopGroundDefense] = 0;
                t[CharacterSkillType.TroopExperienceGain] = 0;
                t[CharacterSkillType.TroopRecoveryRate] = 0;
                t[CharacterSkillType.ColonyIncome] = 0;
                t[CharacterSkillType.ColonyCorruption] = 0;
                t[CharacterSkillType.ColonyHappiness] = 0;
                t[CharacterSkillType.PopulationGrowth] = 0;
                t[CharacterSkillType.TroopRecruitment] = 0;
                t[CharacterSkillType.TroopMaintenance] = 0;
                t[CharacterSkillType.WarWeariness] = 0;
                t[CharacterSkillType.TroopStrengthArmor] = 0;
                t[CharacterSkillType.TroopStrengthInfantry] = 0;
                t[CharacterSkillType.TroopStrengthSpecialForces] = 0;
                t[CharacterSkillType.TroopStrengthPlanetaryDefense] = 0;
                break;
            case CharacterRole.Scientist:
                t[CharacterSkillType.Diplomacy] = 0;
                t[CharacterSkillType.ColonyIncome] = 0;
                t[CharacterSkillType.TradeIncome] = 0;
                t[CharacterSkillType.TourismIncome] = 0;
                t[CharacterSkillType.ColonyCorruption] = 0;
                t[CharacterSkillType.ColonyHappiness] = 0;
                t[CharacterSkillType.PopulationGrowth] = 0;
                t[CharacterSkillType.MiningRate] = 0;
                t[CharacterSkillType.TroopRecruitment] = 0;
                t[CharacterSkillType.MilitaryShipConstructionSpeed] = 0;
                t[CharacterSkillType.CivilianShipConstructionSpeed] = 0;
                t[CharacterSkillType.ColonyShipConstructionSpeed] = 0;
                t[CharacterSkillType.FacilityConstructionSpeed] = 0;
                t[CharacterSkillType.Espionage] = 0;
                t[CharacterSkillType.CounterEspionage] = 0;
                t[CharacterSkillType.Sabotage] = 0;
                t[CharacterSkillType.Concealment] = 0;
                t[CharacterSkillType.PsyOps] = 0;
                t[CharacterSkillType.Assassination] = 0;
                t[CharacterSkillType.MilitaryShipMaintenance] = 0;
                t[CharacterSkillType.CivilianShipMaintenance] = 0;
                t[CharacterSkillType.MilitaryBaseMaintenance] = 0;
                t[CharacterSkillType.CivilianBaseMaintenance] = 0;
                t[CharacterSkillType.TroopMaintenance] = 0;
                t[CharacterSkillType.WarWeariness] = 0;
                t[CharacterSkillType.Targeting] = 0;
                t[CharacterSkillType.Countermeasures] = 0;
                t[CharacterSkillType.ShipManeuvering] = 0;
                t[CharacterSkillType.Fighters] = 0;
                t[CharacterSkillType.ShipEnergyUsage] = 0;
                t[CharacterSkillType.WeaponsDamage] = 0;
                t[CharacterSkillType.WeaponsRange] = 0;
                t[CharacterSkillType.ShieldRechargeRate] = 0;
                t[CharacterSkillType.DamageControl] = 0;
                t[CharacterSkillType.RepairBonus] = 0;
                t[CharacterSkillType.HyperjumpSpeed] = 0;
                t[CharacterSkillType.TroopGroundAttack] = 0;
                t[CharacterSkillType.TroopGroundDefense] = 0;
                t[CharacterSkillType.TroopExperienceGain] = 0;
                t[CharacterSkillType.TroopRecoveryRate] = 0;
                t[CharacterSkillType.TroopStrengthArmor] = 0;
                t[CharacterSkillType.TroopStrengthInfantry] = 0;
                t[CharacterSkillType.TroopStrengthSpecialForces] = 0;
                t[CharacterSkillType.TroopStrengthPlanetaryDefense] = 0;
                t[CharacterSkillType.SmugglingIncome] = 0;
                t[CharacterSkillType.SmugglingEvasion] = 0;
                t[CharacterSkillType.BoardingAssault] = 0;
                break;
            case CharacterRole.TroopGeneral:
                t[CharacterSkillType.Diplomacy] = 0;
                t[CharacterSkillType.ColonyIncome] = 0;
                t[CharacterSkillType.TradeIncome] = 0;
                t[CharacterSkillType.TourismIncome] = 0;
                t[CharacterSkillType.ColonyCorruption] = 0;
                t[CharacterSkillType.ColonyHappiness] = 0;
                t[CharacterSkillType.PopulationGrowth] = 0;
                t[CharacterSkillType.MiningRate] = 0;
                t[CharacterSkillType.MilitaryShipConstructionSpeed] = 0;
                t[CharacterSkillType.CivilianShipConstructionSpeed] = 0;
                t[CharacterSkillType.ColonyShipConstructionSpeed] = 0;
                t[CharacterSkillType.FacilityConstructionSpeed] = 0;
                t[CharacterSkillType.ResearchWeapons] = 0;
                t[CharacterSkillType.ResearchEnergy] = 0;
                t[CharacterSkillType.ResearchHighTech] = 0;
                t[CharacterSkillType.Espionage] = 0;
                t[CharacterSkillType.CounterEspionage] = 0;
                t[CharacterSkillType.Sabotage] = 0;
                t[CharacterSkillType.Concealment] = 0;
                t[CharacterSkillType.PsyOps] = 0;
                t[CharacterSkillType.Assassination] = 0;
                t[CharacterSkillType.MilitaryShipMaintenance] = 0;
                t[CharacterSkillType.CivilianShipMaintenance] = 0;
                t[CharacterSkillType.MilitaryBaseMaintenance] = 0;
                t[CharacterSkillType.CivilianBaseMaintenance] = 0;
                t[CharacterSkillType.WarWeariness] = 0;
                t[CharacterSkillType.Targeting] = 0;
                t[CharacterSkillType.Countermeasures] = 0;
                t[CharacterSkillType.ShipManeuvering] = 0;
                t[CharacterSkillType.Fighters] = 0;
                t[CharacterSkillType.ShipEnergyUsage] = 0;
                t[CharacterSkillType.WeaponsDamage] = 0;
                t[CharacterSkillType.WeaponsRange] = 0;
                t[CharacterSkillType.ShieldRechargeRate] = 0;
                t[CharacterSkillType.DamageControl] = 0;
                t[CharacterSkillType.RepairBonus] = 0;
                t[CharacterSkillType.HyperjumpSpeed] = 0;
                t[CharacterSkillType.SmugglingIncome] = 0;
                t[CharacterSkillType.SmugglingEvasion] = 0;
                t[CharacterSkillType.BoardingAssault] = 0;
                break;
        }
    }

    // Character.cs TransferExpectedArrivalDate (4267).
    transferExpectedArrivalDate(galaxy: Galaxy | null): number {
        let result = 0;
        if (galaxy !== null) result = galaxyCurrentStarDate(galaxy) + Math.trunc(Math.fround(this._transferTimeRemaining * 1000));
        return result;
    }

    // Character.cs ResetTransfer (4299).
    resetTransfer(): void {
        this._transferDestination = null;
        this._transferTimeRemaining = 0;
    }

    // Character.cs CompleteLocationTransfer (4305/4310).
    completeLocationTransfer(destination: StellarObject | null, galaxy: Galaxy | null, invadingDestination = false): void {
        if (this._location !== null) {
            let locationCharacters = stellarObjectCharacters(this._location);
            if (locationCharacters === null) setStellarObjectCharacters(this._location, (locationCharacters = []));
            if (locationCharacters.includes(this)) removeFirst(locationCharacters, this);
            if (!isBuiltObjectLocation(this._location)) {
                const habitat = this._location;
                const invading = habitatInvadingCharacterList(habitat);
                if (invading !== null && invading.includes(this)) removeFirst(invading, this);
            } else {
                const builtObject = this._location;
                reviewCaptainBonuses(builtObject);
            }
        }
        if (destination !== null) {
            if (invadingDestination) {
                if (!isBuiltObjectLocation(destination)) {
                    const habitat2 = destination;
                    let invading = habitatInvadingCharacterList(habitat2);
                    if (invading === null) habitatInvadingCharacters.set(habitat2, (invading = []));
                    if (!invading.includes(this)) invading.push(this);
                }
            } else {
                let destinationCharacters = stellarObjectCharacters(destination);
                if (destinationCharacters === null) setStellarObjectCharacters(destination, (destinationCharacters = []));
                if (!destinationCharacters.includes(this)) destinationCharacters.push(this);
            }
        }
        this._location = destination;
        if (this._location !== null && isBuiltObjectLocation(this._location)) {
            const builtObject2 = this._location;
            reviewCaptainBonuses(builtObject2);
        }
        if (galaxy !== null) this._transferArrivalDate = galaxyCurrentStarDate(galaxy);
        let flag = false;
        if (this.role === CharacterRole.Ambassador && this._location !== null && !isBuiltObjectLocation(this._location)) {
            const habitat3 = this._location;
            if (habitat3 !== null && habitat3.empire !== null && habitat3.empire !== this.empire && habitat3.empire.capital !== null && habitat3.empire.capital === habitat3) {
                if (galaxy !== null) doCharacterEvent(galaxy, CharacterEventType.AmbassadorAssignedToEmpire, habitat3.empire, this);
                flag = true;
            }
        }
        if (!flag) {
            if (galaxy !== null) doCharacterEvent(galaxy, CharacterEventType.CharacterTransferLocation, this, this);
        }
    }

    // Character.cs CompleteEmpireChange (4391).
    completeEmpireChange(newEmpire: Empire | null): void {
        if (this._empire !== null) {
            if (empireCharacters(this._empire).includes(this)) removeFirst(empireCharacters(this._empire), this);
            if (this._empire.leader === this) this._empire.leader = null;
        }
        if (newEmpire !== null) {
            if (!empireCharacters(newEmpire).includes(this)) empireCharacters(newEmpire).push(this);
            if (newEmpire.leader === null && (this.role === CharacterRole.Leader || this.role === CharacterRole.PirateLeader)) newEmpire.leader = this;
        }
        this._empire = newEmpire;
    }

    // Character.cs TransferToNewLocation (4418).
    transferToNewLocation(destination: StellarObject | null, galaxy: Galaxy): void {
        if (destination === null) return;
        const num = Math.fround(30);
        const num2 = Math.fround(90);
        let num3 = 0.0;
        if (this._location !== null) num3 = galaxy.calculateDistance(this._location.xpos, this._location.ypos, destination.xpos, destination.ypos);
        const num4 = Math.fround((num3 / galaxy.sectorSize) * num2);
        const num5 = (this._transferTimeRemaining = Math.fround(num + num4));
        void num5;
        this._transferDestination = destination;
        if ((this.role !== CharacterRole.FleetAdmiral && this.role !== CharacterRole.TroopGeneral && this.role !== CharacterRole.ShipCaptain && this.role !== CharacterRole.PirateLeader) || this._location === null || !isBuiltObjectLocation(this._location)) {
            return;
        }
        const builtObject = this._location;
        if (builtObject !== null && builtObject.shipGroup !== null && isBuiltObjectLocation(destination)) {
            const builtObject2 = destination;
            if (builtObject2 !== null && builtObject2.shipGroup !== null && builtObject.shipGroup === builtObject2.shipGroup) {
                this.completeLocationTransfer(destination, galaxy);
                this._transferDestination = null;
                this._transferTimeRemaining = 0;
            }
        }
    }

    // Character.cs DefectToEmpire (4451).
    defectToEmpire(defectEmpire: Empire | null, destination: StellarObject | null): void {
        if (defectEmpire !== null) {
            this.completeLocationTransfer(destination, defectEmpire.galaxy);
            this.completeEmpireChange(defectEmpire);
        }
    }

    // Character.cs Activate (4460).
    activate(galaxy: Galaxy, empire: Empire | null, location: StellarObject | null): void {
        this._startDate = galaxyCurrentStarDate(galaxy);
        this._lastTouch = galaxy.currentTimeSeconds;
        this._transferArrivalDate = galaxyCurrentStarDate(galaxy);
        this.completeEmpireChange(empire);
        this.completeLocationTransfer(location, galaxy);
        this._transferDestination = null;
        this._transferTimeRemaining = 0;
        this._active = true;
    }

    // Character.cs DetermineFleet (4564). TODO(port): ShipGroup (fleets) — BuiltObject.shipGroup is
    // an untyped placeholder (null at game start).
    determineFleet(): unknown {
        const stellarObject = this.determineLocationWithDestination();
        if (stellarObject !== null && isBuiltObjectLocation(stellarObject)) {
            const builtObject = stellarObject;
            return builtObject.shipGroup;
        }
        return null;
    }

    // Character.cs DetermineLocationWithDestination (4575).
    determineLocationWithDestination(): StellarObject | null {
        if (this._location !== null) {
            if (this._transferDestination === null) return this._location;
            return this._transferDestination;
        }
        if (this._transferDestination !== null) return this._transferDestination;
        return null;
    }

    // Character.cs DetermineLocationEmpire (4592).
    determineLocationEmpire(): Empire | null {
        if (this._location !== null) return this._location.empire;
        return null;
    }

    // Character.cs DetermineLocationEmpireWithTransfer (4601).
    determineLocationEmpireWithTransfer(): Empire | null {
        if (this._location !== null) {
            if (this._transferDestination === null) return this._location.empire;
            return this._transferDestination.empire;
        }
        return null;
    }
}

// Character.cs IComparable<Character>.CompareTo: AppearanceOrder.CompareTo.
function compareCharacters(a: Character, b: Character): number {
    return a.appearanceOrder < b.appearanceOrder ? -1 : a.appearanceOrder > b.appearanceOrder ? 1 : 0;
}

// ---------------------------------------------------------------------------
// CharacterList.cs (helpers over Character[])
// ---------------------------------------------------------------------------

// CharacterList.ObtainNextCharacter: this.Sort() (List.Sort → netSort by AppearanceOrder), first
// with AppearanceOrder >= 0 and matching role (Undefined = any), removed and returned.
export function obtainNextCharacter(list: Character[], role: CharacterRole): Character | null {
    let nextCharacter: Character | null = null;
    netSort(list, compareCharacters);
    for (let index = 0; index < list.length; ++index) {
        const character = list[index];
        if (character !== null && character.appearanceOrder >= 0 && (role === CharacterRole.Undefined || character.role === role)) {
            nextCharacter = character;
            break;
        }
    }
    if (nextCharacter !== null) removeFirst(list, nextCharacter);
    return nextCharacter;
}

// CharacterList.ObtainStartingCharactersExcludingRoles.
export function obtainStartingCharactersExcludingRoles(list: Character[], rolesToExclude: CharacterRole[]): Character[] {
    const charactersExcludingRoles: Character[] = [];
    for (let index = 0; index < list.length; ++index) {
        const character = list[index];
        if (character !== null && character.appearanceOrder === 0 && !rolesToExclude.includes(character.role)) charactersExcludingRoles.push(character);
    }
    for (let index = 0; index < charactersExcludingRoles.length; ++index) removeFirst(list, charactersExcludingRoles[index]);
    return charactersExcludingRoles;
}

// CharacterList.ObtainStartingCharacters.
export function obtainStartingCharacters(list: Character[]): Character[] {
    const startingCharacters: Character[] = [];
    for (let index = 0; index < list.length; ++index) {
        const character = list[index];
        if (character !== null && character.appearanceOrder === 0) startingCharacters.push(character);
    }
    for (let index = 0; index < startingCharacters.length; ++index) removeFirst(list, startingCharacters[index]);
    return startingCharacters;
}

// CharacterList.FindCharactersAtLocationNotTransferring(location, empire, characterToExclude).
export function findCharactersAtLocationNotTransferring(list: Character[], location: StellarObject | null, empire: Empire | null, characterToExclude: Character | null): Character[] {
    const result: Character[] = [];
    for (let index = 0; index < list.length; ++index) {
        const character = list[index];
        if (character !== null && character.empire === empire && character.location === location && character.transferDestination === null && character !== characterToExclude) result.push(character);
    }
    return result;
}

// CharacterList.FindCharactersAtLocationOrTransferring.
export function findCharactersAtLocationOrTransferring(list: Character[], location: StellarObject | null): Character[] {
    const result: Character[] = [];
    for (let index = 0; index < list.length; ++index) {
        const character = list[index];
        if (character !== null) {
            if (character.location === location) {
                if (character.transferDestination === null) result.push(character);
            } else if (character.transferDestination === location) {
                result.push(character);
            }
        }
    }
    return result;
}

// CharacterList.GetHighestSkillLevelExcludeRole.
export function getHighestSkillLevelExcludeRole(list: Character[], skillType: CharacterSkillType, roleToExclude: CharacterRole): number {
    let levelExcludeRole = -100;
    const flag = false;
    for (let index = 0; index < list.length; ++index) {
        const character = list[index];
        if (character !== null && (roleToExclude === CharacterRole.Undefined || character.role !== roleToExclude) && (flag || character.bonusesKnown) && (character.skills.getSkillByType(skillType) !== null || character.traitSkills.getSkillByType(skillType) !== null)) {
            const skillLevel = character.getSkillLevel(skillType);
            if (skillLevel > levelExcludeRole) levelExcludeRole = skillLevel;
        }
    }
    if (levelExcludeRole === -100) levelExcludeRole = 0;
    return levelExcludeRole;
}

// CharacterList.GetHighestSkillLevelExcludeLeaders.
export function getHighestSkillLevelExcludeLeaders(list: Character[], skillType: CharacterSkillType): number {
    let levelExcludeLeaders = -100;
    const flag = false;
    for (let index = 0; index < list.length; ++index) {
        const character = list[index];
        if (character !== null && character.role !== CharacterRole.Leader && character.role !== CharacterRole.PirateLeader && (flag || character.bonusesKnown) && (character.skills.getSkillByType(skillType) !== null || character.traitSkills.getSkillByType(skillType) !== null)) {
            const skillLevel = list[index].getSkillLevel(skillType);
            if (skillLevel > levelExcludeLeaders) levelExcludeLeaders = skillLevel;
        }
    }
    if (levelExcludeLeaders === -100) levelExcludeLeaders = 0;
    return levelExcludeLeaders;
}

// CharacterList.GetHighestSkillLevelExcludeRoles.
export function getHighestSkillLevelExcludeRoles(list: Character[], skillType: CharacterSkillType, rolesToExclude: CharacterRole[]): number {
    let levelExcludeRoles = -100;
    const flag = false;
    for (let index = 0; index < list.length; ++index) {
        const character = list[index];
        if ((rolesToExclude.length === 0 || !rolesToExclude.includes(character.role)) && (flag || character.bonusesKnown) && (character.skills.getSkillByType(skillType) !== null || character.traitSkills.getSkillByType(skillType) !== null)) {
            const skillLevel = character.getSkillLevel(skillType);
            if (skillLevel > levelExcludeRoles) levelExcludeRoles = skillLevel;
        }
    }
    if (levelExcludeRoles === -100) levelExcludeRoles = 0;
    return levelExcludeRoles;
}

// CharacterList.GetHighestSkillLevel.
export function getHighestSkillLevel(list: Character[], skillType: CharacterSkillType): number {
    let highestSkillLevel = -100;
    for (let index = 0; index < list.length; ++index) {
        const character = list[index];
        if (character !== null) {
            const skillLevel = character.getSkillLevel(skillType);
            if (skillLevel > highestSkillLevel) highestSkillLevel = skillLevel;
        }
    }
    if (highestSkillLevel === -100) highestSkillLevel = 0;
    return highestSkillLevel;
}

// CharacterList.GetNonTransferringCharacters(role, characterToExclude).
export function getNonTransferringCharacters(list: Character[], role: CharacterRole = CharacterRole.Undefined, characterToExclude: Character | null = null): Character[] {
    const result: Character[] = [];
    for (let index = 0; index < list.length; ++index) {
        const character = list[index];
        if (character !== null && character.transferDestination === null && character.transferTimeRemaining <= 0.0 && (role === CharacterRole.Undefined || character.role === role) && character !== characterToExclude) result.push(character);
    }
    return result;
}

// CharacterList.GetCharactersByRole.
export function getCharactersByRole(list: Character[], role: CharacterRole): Character[] {
    const charactersByRole: Character[] = [];
    for (let index = 0; index < list.length; ++index) {
        const character = list[index];
        if (character !== null && character.role === role) charactersByRole.push(character);
    }
    return charactersByRole;
}

// CharacterList.CountCharactersByRole.
export function countCharactersByRole(list: Character[], role: CharacterRole): number {
    let num = 0;
    for (let index = 0; index < list.length; ++index) {
        const character = list[index];
        if (character !== null && character.role === role) ++num;
    }
    return num;
}

// CharacterList.CheckCharactersForTrait.
export function checkCharactersForTrait(list: Character[], role: CharacterRole, trait: CharacterTraitType): boolean {
    const charactersByRole = getCharactersByRole(list, role);
    if (charactersByRole !== null) {
        for (let index = 0; index < charactersByRole.length; ++index) {
            if (charactersByRole[index].traits.includes(trait)) return true;
        }
    }
    return false;
}

// CharacterList.GetHighestAppearanceOrder.
export function getHighestAppearanceOrder(list: Character[]): number {
    let highestAppearanceOrder = INT_MIN_VALUE;
    for (const character of list) {
        if (character.appearanceOrder > highestAppearanceOrder) highestAppearanceOrder = character.appearanceOrder;
    }
    return highestAppearanceOrder;
}

// ---------------------------------------------------------------------------
// Per-galaxy character data (Galaxy ctor: LoadAgentNames + SetRaceStartupCharacters)
// ---------------------------------------------------------------------------

interface CharacterGalaxyState {
    agentFirstNames: string[][];
    agentLastNames: string[][];
    /** Race.AvailableCharacters (Race.cs 107) per race of galaxy.races. */
    raceAvailableCharacters: Map<Race, Character[]>;
    /** Galaxy.RndStatic stand-in (clock-seeded in C#). */
    rndStatic: Random;
}
const galaxyStates = new WeakMap<Galaxy, CharacterGalaxyState>();

function characterGalaxyState(galaxy: Galaxy): CharacterGalaxyState {
    let state = galaxyStates.get(galaxy);
    if (state !== undefined) return state;
    state = {
        agentFirstNames: galaxy.characterNames?.firstNames ?? [],
        agentLastNames: galaxy.characterNames?.lastNames ?? [],
        raceAvailableCharacters: new Map(),
        // Documented deviation: C# Galaxy.RndStatic = new Random() (clock seed).
        rndStatic: new Random((galaxy.randomSeed ^ 0x2545f491) | 0),
    };
    galaxyStates.set(galaxy, state);
    // Galaxy.4.cs SetRaceStartupCharacters (1223): races[i].AvailableCharacters = LoadCharacters(...).
    const races = galaxy.races;
    for (let i = 0; i < races.length; i++) {
        state.raceAvailableCharacters.set(races[i], loadCharacters(galaxy, state, races[i], races));
    }
    return state;
}

/** Race.AvailableCharacters for this galaxy (null for a race outside galaxy.races). */
export function raceAvailableCharacters(galaxy: Galaxy, race: Race): Character[] | null {
    return characterGalaxyState(galaxy).raceAvailableCharacters.get(race) ?? null;
}

// Galaxy.4.cs LoadCharacters (1231/1236): characters\<race.Name>.txt (customization first); a
// missing file gives an empty list.
function loadCharacters(galaxy: Galaxy, state: CharacterGalaxyState, race: Race, allRaces: Race[]): Character[] {
    const rows = galaxy.characterFiles?.get(race.name);
    if (rows === undefined) return [];
    return loadCharactersCompleteFilePath(rows, 'characters\\' + race.name + '.txt', race, allRaces, state.rndStatic, galaxy);
}

// C# int.Parse (NumberStyles.Integer): optional surrounding whitespace and sign; throws otherwise.
function csIntParse(text: string): number {
    if (!/^\s*[+-]?\d+\s*$/.test(text)) throw new Error("Input string was not in a correct format: '" + text + "'");
    const n = parseInt(text.trim(), 10);
    if (n > 2147483647 || n < -2147483648) throw new Error('Value was either too large or too small for an Int32.');
    return n;
}

// RaceList this[string] (case-insensitive name match).
function raceByName(allRaces: Race[], raceName: string): Race | null {
    for (const race of allRaces) {
        if (race.name.toLowerCase() === raceName.toLowerCase()) return race;
    }
    return null;
}

// Galaxy.4.cs SelectRandomTraitForRole (1648) — Galaxy.RndStatic.
function selectRandomTraitForRole(role: CharacterRole, traitsToExclude: CharacterTraitType[], rndStatic: Random): CharacterTraitType {
    const list = determineValidTraitsForRole(role, true, false);
    if (list.length > 0) {
        for (let i = 0; i < traitsToExclude.length; i++) removeFirst(list, traitsToExclude[i]);
        if (list.length > 0) {
            const index = rndStatic.next(0, list.length);
            return list[index];
        }
    }
    return CharacterTraitType.Undefined;
}

// Galaxy.4.cs SelectRandomSkillForRole (1666) — Galaxy.RndStatic.
function selectRandomSkillForRole(role: CharacterRole, skillsToExclude: CharacterSkillType[], rndStatic: Random): CharacterSkillType {
    const list = determineValidSkillsForRole(role);
    if (list.length > 0) {
        for (let i = 0; i < skillsToExclude.length; i++) removeFirst(list, skillsToExclude[i]);
        if (list.length > 0) {
            const index = rndStatic.next(0, list.length);
            return list[index];
        }
    }
    return CharacterSkillType.Undefined;
}

/**
 * Galaxy.4.cs LoadCharactersCompleteFilePath (1250): builds the CharacterList from the tokenized
 * rows (data/characters.ts parseCharacterFile). "?" skill types / traits use Galaxy.RndStatic,
 * "?" skill levels RndStatic.Next(1, 21); "?" appearance orders are re-rolled at the end with an
 * unseeded `new Random()` in C# (here seeded from the galaxy seed — documented deviation).
 */
export function loadCharactersCompleteFilePath(rows: CharacterFileRow[], filePath: string, race: Race, allRaces: Race[] | null, rndStatic: Random, galaxy: Galaxy | null): Character[] {
    const characterList: Character[] = [];
    const characterList2: Character[] = [];
    for (const row of rows) {
        const num = row.lineNumber;
        const tk = row.tokens;
        void num;
        void filePath;
        let appearanceOrder = 0;
        let role = CharacterRole.Undefined;
        let characterSkillType = CharacterSkillType.Undefined;
        let characterSkillType2 = CharacterSkillType.Undefined;
        let characterSkillType3 = CharacterSkillType.Undefined;
        let characterSkillType4 = CharacterSkillType.Undefined;
        let characterTraitType = CharacterTraitType.Undefined;
        let characterTraitType2 = CharacterTraitType.Undefined;
        let characterTraitType3 = CharacterTraitType.Undefined;
        let flag = false;
        let flag2 = false;
        const text2 = tk[0];
        if (text2 === '?') flag = true;
        else if (text2 === '-') flag2 = true;
        else appearanceOrder = csIntParse(text2);
        const empty = tk[1];
        const b = csIntParse(tk[2]) & 0xff;
        if (isDefinedRole(b)) role = b as CharacterRole;
        const empty2 = tk[3];
        const empty3 = tk[4];
        const list: CharacterSkillType[] = [];
        // Skill type/level pairs 1-4 (C# text7..text14), in file order.
        const readSkillType = (tok: string): CharacterSkillType => {
            let st = CharacterSkillType.Undefined;
            if (tok === '?') {
                st = selectRandomSkillForRole(role, list, rndStatic);
                if (st !== 0) list.push(st);
            } else {
                const b2 = csIntParse(tok) & 0xff;
                if (isDefinedSkillType(b2)) {
                    st = b2 as CharacterSkillType;
                    list.push(st);
                }
            }
            return st;
        };
        const readSkillLevel = (tok: string): number => {
            let lv = tok !== '?' ? csIntParse(tok) : rndStatic.next(1, 21);
            lv = Math.max(-100, Math.min(100, lv));
            return lv;
        };
        characterSkillType = readSkillType(tk[5]);
        const num2 = readSkillLevel(tk[6]);
        characterSkillType2 = readSkillType(tk[7]);
        const num3 = readSkillLevel(tk[8]);
        characterSkillType3 = readSkillType(tk[9]);
        const num4 = readSkillLevel(tk[10]);
        characterSkillType4 = readSkillType(tk[11]);
        const num5 = readSkillLevel(tk[12]);
        const list2: CharacterTraitType[] = [];
        const readTrait = (tok: string): CharacterTraitType => {
            let tt = CharacterTraitType.Undefined;
            if (tok === '?') {
                tt = selectRandomTraitForRole(role, list2, rndStatic);
                if (tt !== 0) list2.push(tt);
            } else {
                const b6 = csIntParse(tok) & 0xff;
                if (isDefinedTraitType(b6)) {
                    tt = b6 as CharacterTraitType;
                    list2.push(tt);
                }
            }
            return tt;
        };
        characterTraitType = readTrait(tk[13]);
        characterTraitType2 = readTrait(tk[14]);
        characterTraitType3 = readTrait(tk[15]);
        let race2: Race | null = race;
        if (empty3 !== '' && allRaces !== null) {
            race2 = raceByName(allRaces, empty3);
            if (race2 === null) race2 = race;
        }
        if (flag2) appearanceOrder = INT_MIN_VALUE;
        const character = new Character(empty, role, empty2, race2, null, null, appearanceOrder);
        if (flag) characterList2.push(character);
        if (characterSkillType !== 0) character.addSkill(characterSkillType, num2, null);
        if (characterSkillType2 !== 0) character.addSkill(characterSkillType2, num3, null);
        if (characterSkillType3 !== 0) character.addSkill(characterSkillType3, num4, null);
        if (characterSkillType4 !== 0) character.addSkill(characterSkillType4, num5, null);
        if (characterTraitType !== 0) character.addTrait(characterTraitType, true, null);
        if (characterTraitType2 !== 0) character.addTrait(characterTraitType2, true, null);
        if (characterTraitType3 !== 0) character.addTrait(characterTraitType3, true, null);
        characterList.push(character);
    }
    if (characterList2.length <= 0) return characterList;
    // Documented deviation: C# `new Random()` (clock seed).
    const random = new Random(((galaxy?.randomSeed ?? 0) ^ 0x6a09e667) | 0);
    let num8 = getHighestAppearanceOrder(characterList);
    if (num8 < 1) num8 = characterList.length;
    else if (num8 < Math.trunc(characterList.length / 3)) num8 = characterList.length;
    for (let i = 0; i < characterList2.length; i++) {
        const character2 = characterList2[i];
        if (character2 !== null) {
            const num9 = 1;
            const maxValue = Math.max(num9 + 1, num8 + 2);
            character2.appearanceOrder = random.next(num9, maxValue);
        }
    }
    return characterList;
}

// Galaxy.5.cs GenerateUniqueAgentName (2504): Rnd.Next(0, first.Length), Rnd.Next(0, last.Length).
export function generateUniqueAgentName(galaxy: Galaxy, raceFamilyId: number): string {
    const state = characterGalaxyState(galaxy);
    let array: string[] | null = null;
    let array2: string[] | null = null;
    if (raceFamilyId >= 0 && state.agentFirstNames.length > raceFamilyId && state.agentLastNames.length > raceFamilyId) {
        array = state.agentFirstNames[raceFamilyId];
        array2 = state.agentLastNames[raceFamilyId];
    }
    if (array === null || array2 === null) throw new Error('GenerateUniqueAgentName: no characterNames.txt section for race family ' + raceFamilyId + ' (C# NullReferenceException)');
    const num = galaxy.rnd.next(0, array.length);
    const num2 = galaxy.rnd.next(0, array2.length);
    return array[num] + ' ' + array2[num2];
}

// Galaxy.7.cs ConditionCheckLimit (569) — `ref int iterationCount` as a one-slot box.
function conditionCheckLimit(condition: boolean, maximumIterations: number, iterationCount: { v: number }): boolean {
    if (iterationCount.v >= maximumIterations) return false;
    iterationCount.v++;
    return condition;
}

// ---------------------------------------------------------------------------
// Galaxy.1.cs DoCharacterEvent (3762-3781)
// ---------------------------------------------------------------------------

// Event types with a case in the BonusesKnown trait switch (Galaxy.1.cs 3863-4993).
const EVENTS_WITH_TRAIT_CASES = new Set<CharacterEventType>([
    CharacterEventType.Boarding, CharacterEventType.Raid, CharacterEventType.SmugglingSuccess, CharacterEventType.CriticalResearchFailure,
    CharacterEventType.CriticalResearchSuccess, CharacterEventType.TargetOfFailedAssassination, CharacterEventType.WarStarted, CharacterEventType.WarEnded,
    CharacterEventType.GroundInvasion, CharacterEventType.SpaceBattle, CharacterEventType.ResearchAdvanceEnergy, CharacterEventType.ResearchAdvanceHighTech,
    CharacterEventType.ResearchAdvanceWeapons, CharacterEventType.Subjugated, CharacterEventType.BuildMilitaryShip, CharacterEventType.BuildCivilianShip,
    CharacterEventType.BuildColonyShip, CharacterEventType.BuildSpaceport, CharacterEventType.BuildMilitaryBase, CharacterEventType.BuildResearchStationEnergy,
    CharacterEventType.BuildResearchStationHighTech, CharacterEventType.BuildResearchStationWeapons, CharacterEventType.BuildResortBase, CharacterEventType.BuildFacility,
    CharacterEventType.BuildWonder, CharacterEventType.TreatySigned, CharacterEventType.TreatyBroken, CharacterEventType.AmbassadorAssignedToEmpire,
    CharacterEventType.TroopComplete, CharacterEventType.IntelligenceMissionFailEspionage, CharacterEventType.IntelligenceMissionFailSabotage,
    CharacterEventType.IntelligenceMissionInterceptEnemy, CharacterEventType.IntelligenceMissionSucceedEspionage, CharacterEventType.IntelligenceMissionSucceedSabotage,
]);
// Event types with a case in DetermineCharacterSkillsAffectedByEvent (Galaxy.1.cs 2249).
const EVENTS_WITH_SKILL_CASES = new Set<CharacterEventType>([
    CharacterEventType.CriticalResearchSuccess, CharacterEventType.CriticalResearchFailure, CharacterEventType.Subjugated, CharacterEventType.TreatyBroken,
    CharacterEventType.BuildSpaceport, CharacterEventType.BuildOtherBase, CharacterEventType.BuildCivilianShip, CharacterEventType.BuildColonyShip,
    CharacterEventType.BuildFacility, CharacterEventType.BuildWonder, CharacterEventType.BuildMilitaryBase, CharacterEventType.BuildMilitaryShip,
    CharacterEventType.BuildMiningStation, CharacterEventType.BuildResearchStationEnergy, CharacterEventType.BuildResearchStationHighTech,
    CharacterEventType.BuildResearchStationWeapons, CharacterEventType.BuildResortBase, CharacterEventType.CashNegative, CharacterEventType.CashPositive,
    CharacterEventType.ColonyDevelopmentIncrease, CharacterEventType.ColonyDevelopmentDecrease, CharacterEventType.GroundInvasion, CharacterEventType.HyperjumpExit,
    CharacterEventType.IntelligenceAgentOursCaptured, CharacterEventType.IntelligenceAgentRecruited, CharacterEventType.IntelligenceMissionFailEspionage,
    CharacterEventType.IntelligenceMissionFailSabotage, CharacterEventType.IntelligenceMissionInterceptEnemy, CharacterEventType.IntelligenceMissionSucceedEspionage,
    CharacterEventType.IntelligenceMissionSucceedSabotage, CharacterEventType.ResearchAdvanceEnergy, CharacterEventType.ResearchAdvanceHighTech,
    CharacterEventType.ResearchAdvanceWeapons, CharacterEventType.SpaceBattle, CharacterEventType.TourismIncome, CharacterEventType.TradeIncome,
    CharacterEventType.TreatySigned, CharacterEventType.TroopComplete, CharacterEventType.WarEnded, CharacterEventType.WarStarted,
    CharacterEventType.Boarding, CharacterEventType.Raid, CharacterEventType.SmugglingSuccess, CharacterEventType.SmugglingDetection,
]);

/**
 * Galaxy.1.cs DoCharacterEvent (3762 → 3781). Ported for the events a new game raises
 * (CharacterStart, CharacterTransferLocation, and AmbassadorAssignedToEmpire for a character whose
 * bonuses are unknown). TODO(port): the BonusesKnown trait cases (3863-4993) and
 * DetermineCharacterSkillsAffectedByEvent / skill-progress (2249, 5047-5319) for the other events —
 * they throw here instead of silently diverging.
 */
export function doCharacterEvent(galaxy: Galaxy, eventType: CharacterEventType, eventData: unknown, character: Character, includeLeader = false, leaderEmpire: Empire | null = null): void {
    const characterList0: Character[] = [];
    characterList0.push(character);
    doCharacterEventList(galaxy, eventType, eventData, characterList0, includeLeader, leaderEmpire);
}

function doCharacterEventList(galaxy: Galaxy, eventType: CharacterEventType, eventData: unknown, sourceCharacters: Character[] | null, includeLeader: boolean, leaderEmpire: Empire | null): void {
    if (sourceCharacters === null || sourceCharacters.length <= 0) return;
    const characterList: Character[] = [];
    characterList.push(...sourceCharacters);
    if (includeLeader && leaderEmpire !== null) {
        if (leaderEmpire.pirateEmpireBaseHabitat === null) {
            const charactersByRole = getCharactersByRole(empireCharacters(leaderEmpire), CharacterRole.Leader);
            for (let i = 0; i < charactersByRole.length; i++) {
                const c = charactersByRole[i];
                if (c !== null && !characterList.includes(c)) characterList.push(c);
            }
        } else {
            const charactersByRole2 = getCharactersByRole(empireCharacters(leaderEmpire), CharacterRole.PirateLeader);
            for (let j = 0; j < charactersByRole2.length; j++) {
                const c2 = charactersByRole2[j];
                if (c2 !== null && !characterList.includes(c2)) characterList.push(c2);
            }
        }
    }
    // DetermineCharacterSkillsAffectedByEvent(eventType, out relativeImportances).
    if (EVENTS_WITH_SKILL_CASES.has(eventType)) {
        throw new Error('TODO(port): Galaxy.1.cs DetermineCharacterSkillsAffectedByEvent / skill progress for CharacterEventType ' + CharacterEventType[eventType]);
    }
    const list: CharacterSkillType[] = [];
    // GroundInvasion InvasionStats filtering (3818-3840): not reachable (GroundInvasion throws above).
    for (let k = 0; k < characterList.length; k++) {
        const character3 = characterList[k];
        if (character3 === null) continue;
        if (determineCharacterEventRelevantToRole(eventType, character3.role)) {
            const currentStarDate = galaxyCurrentStarDate(galaxy);
            const characterEvent = new CharacterEvent(eventType, eventData, currentStarDate);
            character3.eventHistory.push(characterEvent);
        }
        const traits = determineValidTraitsForRole(character3.role);
        const list2: CharacterTraitType[] = [];
        const list3 = intersectTraitLists(traits, list2);
        void list3;
        const validSkillsForRole = determineValidSkillsForRole(character3.role);
        void validSkillsForRole;
        const flag = galaxy.rnd.next(0, 5) === 1;
        const flag2 = galaxy.rnd.next(0, 20) === 1;
        const flag3 = galaxy.rnd.next(0, 80) === 1;
        void flag;
        void flag2;
        void flag3;
        if (character3.bonusesKnown) {
            if (EVENTS_WITH_TRAIT_CASES.has(eventType)) {
                throw new Error('TODO(port): Galaxy.1.cs DoCharacterEvent BonusesKnown trait case for CharacterEventType ' + CharacterEventType[eventType]);
            }
        }
        if (!character3.bonusesKnown) {
            switch (character3.role) {
                case CharacterRole.ShipCaptain:
                    switch (eventType) {
                        case CharacterEventType.SpaceBattle:
                        case CharacterEventType.Boarding:
                        case CharacterEventType.Raid:
                            character3.bonusesKnown = true;
                            break;
                    }
                    break;
                case CharacterRole.FleetAdmiral:
                    switch (eventType) {
                        case CharacterEventType.SpaceBattle:
                        case CharacterEventType.Boarding:
                        case CharacterEventType.Raid:
                            character3.bonusesKnown = true;
                            break;
                    }
                    break;
                case CharacterRole.IntelligenceAgent:
                    switch (eventType) {
                        case CharacterEventType.IntelligenceMissionSucceedEspionage:
                        case CharacterEventType.IntelligenceMissionSucceedSabotage:
                        case CharacterEventType.IntelligenceMissionFailEspionage:
                        case CharacterEventType.IntelligenceMissionFailSabotage:
                        case CharacterEventType.IntelligenceMissionInterceptEnemy:
                            character3.bonusesKnown = true;
                            break;
                    }
                    break;
                case CharacterRole.TroopGeneral:
                    switch (eventType) {
                        case CharacterEventType.SpaceBattle:
                        case CharacterEventType.GroundInvasion:
                        case CharacterEventType.Raid:
                            character3.bonusesKnown = true;
                            break;
                    }
                    break;
            }
        }
        if (!character3.bonusesKnown || character3.skills === null || character3.skills.count <= 0) continue;
        const list4: CharacterSkillType[] = [];
        for (let m = 0; m < character3.skills.count; m++) {
            const characterSkill = character3.skills.items[m];
            for (let n = 0; n < list.length; n++) {
                if (list[n] === characterSkill.type) list4.push(list[n]);
            }
        }
        let num2 = -1;
        if (list4.length > 0) num2 = galaxy.rnd.next(0, list4.length);
        if (num2 < 0) continue;
        // Unreachable: `list` is empty for the ported events.
        throw new Error('TODO(port): Galaxy.1.cs DoCharacterEvent skill progress (5071-5319)');
    }
}

// ---------------------------------------------------------------------------
// BuiltObject.cs character helpers
// ---------------------------------------------------------------------------

/** BuiltObject._Captain*Bonus bytes (BuiltObject.cs ReviewCaptainBonuses 1448). */
export interface CaptainBonuses {
    targeting: number;
    countermeasures: number;
    shipManeuvering: number;
    fighters: number;
    shipEnergyUsage: number;
    weaponsDamage: number;
    weaponsRange: number;
    shieldRechargeRate: number;
    damageControl: number;
    repair: number;
    hyperjumpSpeed: number;
}
const captainBonusMap = new WeakMap<BuiltObject, CaptainBonuses>();
/** BuiltObject._Captain*Bonus (100 each until ReviewCaptainBonuses runs, C# field defaults are 0 but
 * ReviewCaptainBonuses runs in the BuiltObject ctor paths). TODO(port): move to BuiltObject fields. */
export function captainBonuses(builtObject: BuiltObject): CaptainBonuses | null {
    return captainBonusMap.get(builtObject) ?? null;
}

// BuiltObject.cs ReviewCaptainBonuses (1448).
export function reviewCaptainBonuses(builtObject: BuiltObject): void {
    let captainTargetingBonus = 100;
    let captainCountermeasuresBonus = 100;
    let captainShipManeuveringBonus = 100;
    let captainFightersBonus = 100;
    let captainShipEnergyUsageBonus = 100;
    let captainWeaponsDamageBonus = 100;
    let captainWeaponsRangeBonus = 100;
    let captainShieldRechargeRateBonus = 100;
    let captainDamageControlBonus = 100;
    let captainRepairBonus = 100;
    let captainHyperjumpSpeedBonus = 100;
    const characters = builtObject.characters as Character[] | null;
    if (characters !== null && characters.length > 0) {
        const f = (skill: CharacterSkillType) => Math.max(0, Math.min(200, 100 + getHighestSkillLevel(characters, skill))) & 0xff;
        captainTargetingBonus = f(CharacterSkillType.Targeting);
        captainCountermeasuresBonus = f(CharacterSkillType.Countermeasures);
        captainShipManeuveringBonus = f(CharacterSkillType.ShipManeuvering);
        captainFightersBonus = f(CharacterSkillType.Fighters);
        captainShipEnergyUsageBonus = f(CharacterSkillType.ShipEnergyUsage);
        captainWeaponsDamageBonus = f(CharacterSkillType.WeaponsDamage);
        captainWeaponsRangeBonus = f(CharacterSkillType.WeaponsRange);
        captainShieldRechargeRateBonus = f(CharacterSkillType.ShieldRechargeRate);
        captainDamageControlBonus = f(CharacterSkillType.DamageControl);
        captainRepairBonus = f(CharacterSkillType.RepairBonus);
        captainHyperjumpSpeedBonus = f(CharacterSkillType.HyperjumpSpeed);
    }
    captainBonusMap.set(builtObject, {
        targeting: captainTargetingBonus,
        countermeasures: captainCountermeasuresBonus,
        shipManeuvering: captainShipManeuveringBonus,
        fighters: captainFightersBonus,
        shipEnergyUsage: captainShipEnergyUsageBonus,
        weaponsDamage: captainWeaponsDamageBonus,
        weaponsRange: captainWeaponsRangeBonus,
        shieldRechargeRate: captainShieldRechargeRateBonus,
        damageControl: captainDamageControlBonus,
        repair: captainRepairBonus,
        hyperjumpSpeed: captainHyperjumpSpeedBonus,
    });
}

// BuiltObject.cs GetCharacterMaintenanceBonuses (1488).
export function getCharacterMaintenanceBonuses(builtObject: BuiltObject): number {
    let num = 0;
    const actualEmpire = builtObject.actualEmpire;
    if (actualEmpire !== null) {
        const leader = actualEmpire.leader;
        let characterSkillType = CharacterSkillType.CivilianBaseMaintenance;
        switch (builtObject.role) {
            case BuiltObjectRole.Military:
                characterSkillType = CharacterSkillType.MilitaryShipMaintenance;
                if (leader !== null) num += leader.militaryShipMaintenance;
                break;
            case BuiltObjectRole.Base:
                switch (builtObject.subRole) {
                    case BuiltObjectSubRole.SmallSpacePort:
                    case BuiltObjectSubRole.MediumSpacePort:
                    case BuiltObjectSubRole.LargeSpacePort:
                    case BuiltObjectSubRole.DefensiveBase:
                        characterSkillType = CharacterSkillType.MilitaryBaseMaintenance;
                        if (leader !== null) num += leader.militaryBaseMaintenance;
                        break;
                    default:
                        characterSkillType = CharacterSkillType.CivilianBaseMaintenance;
                        if (leader !== null) num += leader.civilianBaseMaintenance;
                        break;
                }
                break;
            default:
                characterSkillType = CharacterSkillType.CivilianShipMaintenance;
                if (leader !== null) num += leader.civilianShipMaintenance;
                break;
        }
        let val = 0;
        let val2 = 0;
        const characters = builtObject.characters as Character[] | null;
        if (characters !== null && characters.length > 0) val = getHighestSkillLevel(characters, characterSkillType);
        const parentCharacters = builtObject.parentHabitat !== null ? stellarObjectCharacters(builtObject.parentHabitat) : null;
        if (builtObject.parentHabitat !== null && parentCharacters !== null && parentCharacters.length > 0) val2 = getHighestSkillLevelExcludeLeaders(parentCharacters, characterSkillType);
        num += Math.max(val, val2);
    }
    return num;
}

// ---------------------------------------------------------------------------
// Empire.* character methods
// ---------------------------------------------------------------------------

// Empire.6.cs GenerateAgentName (411/416).
export function generateAgentName(galaxy: Galaxy, empire: Empire, race: Race | null = empire.dominantRace): string {
    let result = '';
    if (race !== null) result = generateUniqueAgentName(galaxy, race.raceFamily);
    return result;
}

// Empire.6.cs SelectRandomRaceFromColoniesPreferNonDominant.
export function selectRandomRaceFromColoniesPreferNonDominant(galaxy: Galaxy, empire: Empire): Race | null {
    let race: Race | null = null;
    const dominantRace = empire.dominantRace;
    if (empire.colonies !== null && empire.colonies.length > 0 && dominantRace !== null) {
        let num = 0;
        while ((race === null || race === dominantRace) && num < 10) {
            const index = galaxy.rnd.next(0, empire.colonies.length);
            const habitat = empire.colonies[index];
            if (habitat !== null && habitat.population !== null && habitat.population.items.length > 0) {
                const index2 = galaxy.rnd.next(0, habitat.population.items.length);
                const population = habitat.population.items[index2];
                if (population !== null) {
                    race = population.race;
                    if (race !== null) {
                        if (race === dominantRace) {
                            race = null;
                        } else if (race.raceFamily === dominantRace.raceFamily) {
                            if (habitat.colonyPopulationPolicyRaceFamily !== 0) race = null;
                        } else if (habitat.colonyPopulationPolicy !== 0) {
                            race = null;
                        }
                    }
                }
            }
            num++;
        }
    }
    return race;
}

// Empire.6.cs ApplyRandomCharacterSkillsTraits.
export function applyRandomCharacterSkillsTraits(galaxy: Galaxy, empire: Empire, character: Character | null, boostSkillLevels: boolean): void {
    if (character === null) return;
    const rnd = galaxy.rnd;
    const role = character.role;
    const list = determineValidSkillsForRole(role, true, false);
    const list2 = determineValidSkillsForRole(role, false, true);
    const num = 4;
    let num2 = 1;
    if (empire.pirateEmpireBaseHabitat !== null && role === CharacterRole.IntelligenceAgent) {
        num2++;
        boostSkillLevels = true;
    }
    const iterationCount = { v: 0 };
    while (conditionCheckLimit(rnd.next(0, 2) === 1, 50, iterationCount)) {
        num2++;
        if (num2 >= list.length + list2.length || num2 >= num) break;
    }
    const list3: CharacterSkillType[] = [];
    for (let i = 0; i < num2; i++) {
        let characterSkillType = CharacterSkillType.Undefined;
        let num3 = 0;
        while (characterSkillType === CharacterSkillType.Undefined && num3 < 20) {
            if (list2.length > 0 && rnd.next(0, 3) === 1) {
                const index = rnd.next(0, list2.length);
                characterSkillType = list2[index];
            } else if (list.length > 0) {
                const index2 = rnd.next(0, list.length);
                characterSkillType = list[index2];
            }
            if (list3.includes(characterSkillType)) characterSkillType = CharacterSkillType.Undefined;
            num3++;
        }
        if (characterSkillType !== 0 && !list3.includes(characterSkillType)) list3.push(characterSkillType);
    }
    for (let j = 0; j < list3.length; j++) {
        let maxValue = 4;
        if (boostSkillLevels) maxValue = 6;
        // C# evaluates the named `level:` argument first (Rnd draws), then skillType / galaxy.
        let level: number;
        if (character.role !== CharacterRole.Leader && character.role !== CharacterRole.PirateLeader) {
            level = rnd.next(0, maxValue) !== 1 ? (!boostSkillLevels ? rnd.next(5, 16) : rnd.next(7, 21)) : (!boostSkillLevels ? rnd.next(-5, -1) : rnd.next(-3, -1));
        } else {
            level = rnd.next(0, maxValue) !== 1 ? (!boostSkillLevels ? rnd.next(2, 10) : rnd.next(5, 13)) : (!boostSkillLevels ? rnd.next(-5, -1) : rnd.next(-3, -1));
        }
        character.addSkill(list3[j], level, null);
    }
    const list4 = determineValidTraitsForRole(role, true, false);
    const num5 = 2;
    let num6 = 1;
    if (empire.pirateEmpireBaseHabitat !== null && role === CharacterRole.IntelligenceAgent) num6++;
    const iterationCount2 = { v: 0 };
    while (conditionCheckLimit(rnd.next(0, 2) === 1, 50, iterationCount2)) {
        num6++;
        if (num6 >= list4.length || num6 >= num5) break;
    }
    const list5: CharacterTraitType[] = [];
    for (let k = 0; k < num6; k++) {
        let characterTraitType = CharacterTraitType.Undefined;
        let num7 = 0;
        while (characterTraitType === CharacterTraitType.Undefined && num7 < 20) {
            if (list4.length > 0) {
                const index3 = rnd.next(0, list4.length);
                characterTraitType = list4[index3];
            }
            if (list5.includes(characterTraitType)) characterTraitType = CharacterTraitType.Undefined;
            num7++;
        }
        if (characterTraitType !== 0 && !list5.includes(characterTraitType)) list5.push(characterTraitType);
    }
    for (let l = 0; l < list5.length; l++) character.addTrait(list5[l], true, null);
    const dominantRace = empire.dominantRace;
    if (dominantRace !== null) {
        let characterTraitType2 = CharacterTraitType.Undefined;
        switch (role) {
            case CharacterRole.Ambassador:
                characterTraitType2 = raceCharacterStartingTrait(dominantRace, 'CharacterStartingTraitAmbassador');
                break;
            case CharacterRole.ColonyGovernor:
                characterTraitType2 = raceCharacterStartingTrait(dominantRace, 'CharacterStartingTraitGovernor');
                break;
            case CharacterRole.FleetAdmiral:
                characterTraitType2 = raceCharacterStartingTrait(dominantRace, 'CharacterStartingTraitAdmiral');
                break;
            case CharacterRole.IntelligenceAgent:
                characterTraitType2 = raceCharacterStartingTrait(dominantRace, 'CharacterStartingTraitIntelligenceAgent');
                break;
            case CharacterRole.Leader:
                characterTraitType2 = raceCharacterStartingTrait(dominantRace, 'CharacterStartingTraitLeader');
                break;
            case CharacterRole.Scientist:
                characterTraitType2 = raceCharacterStartingTrait(dominantRace, 'CharacterStartingTraitScientist');
                break;
            case CharacterRole.TroopGeneral:
                characterTraitType2 = raceCharacterStartingTrait(dominantRace, 'CharacterStartingTraitGeneral');
                break;
            case CharacterRole.PirateLeader:
                characterTraitType2 = raceCharacterStartingTrait(dominantRace, 'CharacterStartingTraitPirateLeader');
                break;
            case CharacterRole.ShipCaptain:
                characterTraitType2 = raceCharacterStartingTrait(dominantRace, 'CharacterStartingTraitShipCaptain');
                break;
        }
        if (characterTraitType2 !== 0 && !character.traits.includes(characterTraitType2)) character.addTrait(characterTraitType2, true, null);
    }
}

// BaconEmpire.cs EnhanceCharacter (123): "Romulan" empires get fixed +6 skills.
function baconEnhanceCharacter(empire: Empire | null, character: Character): void {
    if (empire === null || !empire.name.includes('Romulan')) return;
    switch (character.role) {
        case CharacterRole.Leader:
            if (!character.checkHasSkill(CharacterSkillType.ColonyIncome)) character.addSkill(CharacterSkillType.ColonyIncome, 6, null);
            if (!character.checkHasSkill(CharacterSkillType.ColonyHappiness)) character.addSkill(CharacterSkillType.ColonyHappiness, 6, null);
            if (!character.checkHasSkill(CharacterSkillType.PopulationGrowth)) {
                character.addSkill(CharacterSkillType.PopulationGrowth, 6, null);
                break;
            }
            break;
        case CharacterRole.ColonyGovernor:
            if (!character.checkHasSkill(CharacterSkillType.ColonyIncome)) character.addSkill(CharacterSkillType.ColonyIncome, 6, null);
            if (!character.checkHasSkill(CharacterSkillType.ColonyHappiness)) character.addSkill(CharacterSkillType.ColonyHappiness, 6, null);
            if (!character.checkHasSkill(CharacterSkillType.PopulationGrowth)) character.addSkill(CharacterSkillType.PopulationGrowth, 6, null);
            if (!character.checkHasSkill(CharacterSkillType.TradeIncome)) {
                character.addSkill(CharacterSkillType.TradeIncome, 6, null);
                break;
            }
            break;
        case CharacterRole.ShipCaptain:
            if (!character.checkHasSkill(CharacterSkillType.Targeting)) character.addSkill(CharacterSkillType.Targeting, 6, null);
            if (!character.checkHasSkill(CharacterSkillType.ShieldRechargeRate)) character.addSkill(CharacterSkillType.ShieldRechargeRate, 6, null);
            if (!character.checkHasSkill(CharacterSkillType.WeaponsDamage)) character.addSkill(CharacterSkillType.WeaponsDamage, 6, null);
            if (!character.checkHasSkill(CharacterSkillType.WeaponsRange)) {
                character.addSkill(CharacterSkillType.WeaponsRange, 6, null);
                break;
            }
            break;
    }
    character.bonusesKnown = true;
}

// Empire.6.cs GenerateNewCharacter (4413/4419/4424). The `activate` path's
// _Galaxy.GetMatchingGameEventIdCharacterAppears / CheckTriggerEvent (scenario GameEvents) is a
// TODO(port) no-op: a new game defines no GameEvents.
export function generateNewCharacter(galaxy: Galaxy, empire: Empire, role: CharacterRole, location: StellarObject | null, activate = true): { character: Character; isRandomCharacter: boolean } {
    let isRandomCharacter = false;
    let character = obtainNextCharacter(empire.availableCharacters, role);
    const dominantRace = empire.dominantRace;
    const raceChars = dominantRace !== null ? raceAvailableCharacters(galaxy, dominantRace) : null;
    if (character === null && galaxy.allowRaceStartingCharacters && dominantRace !== null && raceChars !== null) {
        character = obtainNextCharacter(raceChars, role);
    }
    if (character === null) {
        let race = dominantRace;
        if (role !== CharacterRole.Leader && role !== CharacterRole.PirateLeader && galaxy.rnd.next(0, 4) === 1) {
            race = selectRandomRaceFromColoniesPreferNonDominant(galaxy, empire);
            if (race === null) race = dominantRace;
        }
        if (race === null) race = selectRandomRace(galaxy, 0);
        const name = generateAgentName(galaxy, empire, race);
        character = new Character(name, role, '', race, empire, location, 0);
        isRandomCharacter = true;
    }
    if (character !== null) {
        if (isRandomCharacter) applyRandomCharacterSkillsTraits(galaxy, empire, character, false);
        if (character.role === CharacterRole.Leader || character.role === CharacterRole.Scientist || character.role === CharacterRole.PirateLeader) character.bonusesKnown = true;
        if (activate && location !== null) {
            character.activate(galaxy, empire, location);
            doCharacterEvent(galaxy, CharacterEventType.CharacterStart, character, character);
            // TODO(port): GetMatchingGameEventIdCharacterAppears + CheckTriggerEvent(CharacterAppears) — no GameEvents.
        }
    }
    baconEnhanceCharacter(empire, character);
    return { character, isRandomCharacter };
}

// Empire.6.cs GenerateNewCharacterRandom.
export function generateNewCharacterRandom(galaxy: Galaxy, empire: Empire, role: CharacterRole, location: StellarObject | null, activate: boolean): Character {
    const dominantRace = empire.dominantRace;
    let race = dominantRace;
    if (role !== CharacterRole.Leader && role !== CharacterRole.PirateLeader && galaxy.rnd.next(0, 4) === 1) {
        race = selectRandomRaceFromColoniesPreferNonDominant(galaxy, empire);
        if (race === null) race = dominantRace;
    }
    if (race === null) race = selectRandomRace(galaxy, 0);
    const name = generateAgentName(galaxy, empire, race);
    const character = new Character(name, role, '', race, empire, location, 0);
    applyRandomCharacterSkillsTraits(galaxy, empire, character, false);
    if (character.role === CharacterRole.Leader || character.role === CharacterRole.Scientist || character.role === CharacterRole.PirateLeader) character.bonusesKnown = true;
    if (activate && location !== null) {
        character.activate(galaxy, empire, location);
        doCharacterEvent(galaxy, CharacterEventType.CharacterStart, character, character);
        // TODO(port): GetMatchingGameEventIdCharacterAppears + CheckTriggerEvent(CharacterAppears) — no GameEvents.
    }
    return character;
}

// Empire.7.cs CheckLocationSafeForDemoralizingCharacter(bool, StellarObject, Character) (431) and
// (StellarObject, Character) (440).
export function checkLocationSafeForDemoralizingCharacter(empire: Empire, characterIsDemoralizing: boolean, location: StellarObject | null, characterToExclude: Character | null): boolean {
    if (characterIsDemoralizing) return checkLocationSafeForDemoralizingCharacterAt(empire, location, characterToExclude);
    return true;
}
function checkLocationSafeForDemoralizingCharacterAt(empire: Empire, location: StellarObject | null, characterToExclude: Character | null): boolean {
    void characterToExclude;
    if (location !== null) {
        const locationCharacters = stellarObjectCharacters(location);
        if (locationCharacters !== null) {
            const characterList = findCharactersAtLocationNotTransferring(locationCharacters, location, empire, null);
            if (characterList !== null && characterList.length > 0) return false;
        }
    }
    return true;
}

// Empire.3.cs IdentifyResearchStationHighestBonus (2691).
export function identifyResearchStationHighestBonus(empire: Empire, industry: IndustryType): BuiltObject | null {
    let result: BuiltObject | null = null;
    let num = 0;
    const researchFacilities = empire.researchFacilities as BuiltObject[];
    for (let i = 0; i < researchFacilities.length; i++) {
        const builtObject = researchFacilities[i];
        let num2 = 0;
        switch (industry) {
            case IndustryType.Weapon:
                num2 = builtObject.researchWeapons;
                break;
            case IndustryType.Energy:
                num2 = builtObject.researchEnergy;
                break;
            case IndustryType.HighTech:
                num2 = builtObject.researchHighTech;
                break;
        }
        if (num2 > 0) {
            let num3 = 0;
            if (builtObject.parentHabitat !== null && builtObject.parentHabitat.researchBonusIndustry === industry && builtObject.parentHabitat.researchBonus > 0) {
                num3 = Math.fround(Math.trunc(builtObject.parentHabitat.researchBonus) / 100);
            } else if (builtObject.nearestSystemStar !== null && builtObject.nearestSystemStar.researchBonusIndustry === industry && builtObject.nearestSystemStar.researchBonus > 0) {
                num3 = Math.fround(Math.trunc(builtObject.nearestSystemStar.researchBonus) / 100);
            }
            if (num3 > num) {
                num = num3;
                result = builtObject;
            }
        }
    }
    return result;
}

// Galaxy.9.cs IdentifyPirateBase (220).
export function identifyPirateBase(pirateFaction: Empire | null): BuiltObject | null {
    if (pirateFaction !== null && pirateFaction.builtObjects !== null && pirateFaction.pirateEmpireBaseHabitat !== null) {
        let builtObject: BuiltObject | null = null;
        if (pirateFaction.pirateEmpireBaseHabitat.basesAtHabitat !== null) {
            for (let i = 0; i < pirateFaction.pirateEmpireBaseHabitat.basesAtHabitat.length; i++) {
                const builtObject2: BuiltObject = pirateFaction.pirateEmpireBaseHabitat.basesAtHabitat[i];
                if (builtObject2.role === BuiltObjectRole.Base && builtObject2.actualEmpire === pirateFaction && builtObject2.parentHabitat !== null && builtObject2.parentHabitat === pirateFaction.pirateEmpireBaseHabitat && builtObject2.extractionGas > 0 && (builtObject === null || builtObject.size < builtObject2.size)) {
                    builtObject = builtObject2;
                }
            }
        }
        if (builtObject === null) {
            for (let j = 0; j < pirateFaction.builtObjects.length; j++) {
                const builtObject3: BuiltObject = pirateFaction.builtObjects[j];
                if (builtObject3.role === BuiltObjectRole.Base && builtObject3.extractionGas > 0 && (builtObject === null || builtObject.size < builtObject3.size)) {
                    builtObject = builtObject3;
                }
            }
        }
        return builtObject;
    }
    return null;
}

// HabitatList.GetHabitatsPopulationBelowThreshold (258).
function getHabitatsPopulationBelowThreshold(list: Habitat[], maxPopulationAmount: number, type: HabitatType): Habitat[] {
    const result: Habitat[] = [];
    for (let index = 0; index < list.length; ++index) {
        if ((type === HabitatType.Undefined || list[index].type === type) && (list[index].population === null || list[index].population.totalAmount < maxPopulationAmount)) result.push(list[index]);
    }
    return result;
}

// HabitatList.OrderByRevenue (399): Array.Sort(revenues, habitats) then Array.Reverse.
// TODO(port): Habitat.AnnualRevenue (Habitat.cs 830) — not ported; with 0 or 1 colonies the sort
// never compares keys (the getter is side-effect free), so only Count > 1 throws.
function orderByRevenue(list: Habitat[]): Habitat[] {
    if (list.length > 1) throw new Error('TODO(port): HabitatList.OrderByRevenue needs Habitat.AnnualRevenue (Habitat.cs 830)');
    const array = list.slice();
    array.reverse();
    return array;
}

// Galaxy.7.cs DetermineHabitatSystemStar (679).
function determineHabitatSystemStar(habitat: Habitat | null): Habitat | null {
    let result: Habitat | null = null;
    if (habitat !== null) {
        switch (habitat.category) {
            case HabitatCategoryType.Planet:
            case HabitatCategoryType.Asteroid:
                result = habitat.parent;
                break;
            case HabitatCategoryType.Moon:
                result = habitat.parent!.parent;
                break;
            case HabitatCategoryType.Star:
            case HabitatCategoryType.GasCloud:
                result = habitat;
                break;
            default:
                result = null;
                break;
        }
    }
    return result;
}
void determineHabitatSystemStar;
void SystemVisibilityStatus;

// Empire.Capitals (Empire.cs 513): assigned by RefreshColonyFacilityInfo (Empire.3.cs 104) in the
// long-interval block of Empire.DoTasks (Empire.1.cs 3654), which the first DoTasks of GenerateEmpire
// runs. TODO(port): not stored on the TS Empire — recomputed with IdentifyEmpireCapitals
// (forceStructure.ts), identical at game start (no facility changes since that DoTasks).
function empireCapitals(empire: Empire): Habitat[] {
    return identifyEmpireCapitals(empire);
}

// Galaxy.7.cs DetermineSpacePortAtColony (295).
function determineSpacePortAtColony(galaxy: Galaxy, colony: Habitat): BuiltObject | null {
    if (colony.empire !== null && colony.empire !== galaxy.independentEmpire) {
        for (let i = 0; i < colony.empire.spacePorts.length; i++) {
            const builtObject = colony.empire.spacePorts[i];
            if (builtObject !== null && builtObject.parentHabitat === colony) return builtObject;
        }
    }
    return null;
}

// Empire.9.cs ResolveEmpiresToDefendAgainst (1696).
function resolveEmpiresToDefendAgainst(empire: Empire): Empire[] {
    const empireList: Empire[] = [];
    if (empire.pirateEmpireBaseHabitat !== null) {
        for (let i = 0; i < empire.pirateRelations.count; i++) {
            const pirateRelation = empire.pirateRelations.get(i);
            if (pirateRelation !== null && pirateRelation.otherEmpire !== null && pirateRelation.type === PirateRelationType.None) empireList.push(pirateRelation.otherEmpire);
        }
    } else {
        // TODO(port): DiplomaticRelation (War / Strategy) — the TS list is empty at game start.
        if (empire.diplomaticRelations.length > 0) throw new Error('TODO(port): Empire.9.cs ResolveEmpiresToDefendAgainst DiplomaticRelations');
    }
    return empireList;
}

// Empire.9.cs ResolveLocationsToDefend (1742/1747). Habitat.HasBeenDestroyed is false at game start
// (not modelled on the TS Habitat).
function resolveLocationsToDefend(galaxy: Galaxy, empire: Empire, includeBases: boolean): StellarObject[] {
    void includeBases;
    let stellarObjectList: StellarObject[] = [];
    if (empire.pirateEmpireBaseHabitat !== null) {
        if (empire.spacePorts !== null) {
            for (let i = 0; i < empire.spacePorts.length; i++) {
                const builtObject = empire.spacePorts[i];
                if (builtObject !== null && !builtObject.hasBeenDestroyed && !stellarObjectList.includes(builtObject)) stellarObjectList.push(builtObject);
            }
        }
        // TODO(port): Habitat.GetPirateControl().GetByFaction (PirateColonyControl) — pirate factions own
        // no colonies at game start.
        if (empire.colonies.length > 0) throw new Error('TODO(port): Empire.9.cs ResolveLocationsToDefend pirate colonies (PirateColonyControl)');
    } else {
        const empireList = resolveEmpiresToDefendAgainst(empire);
        // TODO(port): the three DiplomaticRelation loops (AddWarObjectivesToList) — empireList is empty
        // while DiplomaticRelation is unported.
        if (empireList.length > 0) throw new Error('TODO(port): Empire.9.cs ResolveLocationsToDefend AddWarObjectivesToList');
        const homeWorld = empire.homeWorld;
        if (homeWorld !== null && homeWorld.empire === empire && (empire.policy?.homeworldDefensePriority ?? 1.0) > 1.0 && !stellarObjectList.includes(homeWorld)) stellarObjectList.push(homeWorld);
        const capitals = empireCapitals(empire);
        if (capitals !== null) {
            for (let n = 0; n < capitals.length; n++) {
                const habitat2 = capitals[n];
                if (habitat2 !== null) {
                    const builtObject2 = determineSpacePortAtColony(galaxy, habitat2);
                    if (!stellarObjectList.includes(habitat2) && (builtObject2 === null || !stellarObjectList.includes(builtObject2))) stellarObjectList.push(habitat2);
                }
            }
        }
        if (empire.spacePorts !== null) {
            for (let num = 0; num < empire.spacePorts.length; num++) {
                const builtObject3 = empire.spacePorts[num];
                if (builtObject3 !== null && !builtObject3.hasBeenDestroyed) {
                    const parentHabitat = builtObject3.parentHabitat;
                    if (parentHabitat !== null && !stellarObjectList.includes(builtObject3) && !stellarObjectList.includes(parentHabitat)) stellarObjectList.push(parentHabitat);
                }
            }
        }
        const array = stellarObjectList.slice();
        for (let num2 = 0; num2 < array.length; num2++) {
            if (array[num2].empire !== empire) removeFirst(stellarObjectList, array[num2]);
        }
        stellarObjectList = stellarObjectList.slice();
    }
    return stellarObjectList;
}

/**
 * Empire.7.cs ReviewCharacterLocation (479). Ported branches: pre-checks, Demoralizing relocation,
 * Leader, ColonyGovernor (revenue branch), PirateLeader, Scientist, FleetAdmiral/TroopGeneral fleet
 * search with no fleets, ShipCaptain; IntelligenceAgent has no case (keeps its location).
 * TODO(port) (throw when reached with non-empty inputs): Ambassador DiplomaticRelations
 * (DiplomaticRelation unported; TS empire.diplomaticRelations is empty at game start → C#
 * relations of NotMet empires are all skipped), ColonyGovernor population-growth branch
 * (Habitat.MaximumPopulation / DetermineColonizationValue), ShipGroup fleets (ShipGroups empty at
 * game start), DiplomaticRelation-driven parts of ResolveLocationsToDefend.
 */
export function reviewCharacterLocation(galaxy: Galaxy, empire: Empire, character: Character | null, transferToLocation: boolean): StellarObject | null {
    if (character !== null && character.transferDestination === null && character.transferTimeRemaining <= 0) {
        void character.location;
        const locationEmpire = character.determineLocationEmpire();
        const flag = character.traits.includes(CharacterTraitType.Demoralizing);
        if (flag && character.role !== CharacterRole.Leader && !checkLocationSafeForDemoralizingCharacterAt(empire, character.location, character)) {
            if (empire.pirateEmpireBaseHabitat !== null) {
                for (let i = 0; i < empire.builtObjects.length; i++) {
                    const builtObject = empire.builtObjects[i];
                    if (builtObject !== null && builtObject.role === BuiltObjectRole.Base && checkLocationSafeForDemoralizingCharacter(empire, flag, builtObject, character)) {
                        if (transferToLocation) character.transferToNewLocation(builtObject, galaxy);
                        return builtObject;
                    }
                }
            } else if (empire.colonies !== null) {
                const habitatsPopulationBelowThreshold = getHabitatsPopulationBelowThreshold(empire.colonies, 500000000, HabitatType.Undefined);
                for (let j = 0; j < habitatsPopulationBelowThreshold.length; j++) {
                    const habitat = habitatsPopulationBelowThreshold[j];
                    if (habitat !== null && checkLocationSafeForDemoralizingCharacter(empire, flag, habitat, character)) {
                        if (transferToLocation) character.transferToNewLocation(habitat, galaxy);
                        return habitat;
                    }
                }
                for (let k = 0; k < empire.colonies.length; k++) {
                    const habitat2 = empire.colonies[k];
                    if (habitat2 !== null && checkLocationSafeForDemoralizingCharacter(empire, flag, habitat2, character)) {
                        if (transferToLocation) character.transferToNewLocation(habitat2, galaxy);
                        return habitat2;
                    }
                }
            }
        }
        const characters = empireCharacters(empire);
        switch (character.role) {
            case CharacterRole.Ambassador: {
                const charactersByRole4 = getCharactersByRole(characters, CharacterRole.Ambassador);
                void charactersByRole4;
                if (empire.reclusive) break;
                // TODO(port): DiplomaticRelations loop (Empire.7.cs 541-615) — DiplomaticRelation is
                // unported; the TS list is empty at game start (no relation → no target empire).
                if (empire.diplomaticRelations.length > 0) throw new Error('TODO(port): Empire.7.cs ReviewCharacterLocation Ambassador DiplomaticRelations');
                break;
            }
            case CharacterRole.ColonyGovernor: {
                const charactersByRole3 = getCharactersByRole(characters, CharacterRole.ColonyGovernor);
                if ((character.colonyIncome > character.colonyHappiness && character.colonyIncome > character.populationGrowth) || (character.colonyHappiness > character.colonyIncome && character.colonyHappiness > character.populationGrowth)) {
                    const habitatList = orderByRevenue(empire.colonies);
                    for (let num7 = 0; num7 < habitatList.length; num7++) {
                        const habitat6 = habitatList[num7];
                        if (habitat6 === character.location) break;
                        if (findCharactersAtLocationOrTransferring(charactersByRole3, habitat6).length <= 0 && checkLocationSafeForDemoralizingCharacter(empire, flag, habitat6, character)) {
                            if (transferToLocation) character.transferToNewLocation(habitat6, galaxy);
                            return habitat6;
                        }
                    }
                } else {
                    if (character.populationGrowth <= character.colonyIncome || character.populationGrowth <= character.colonyHappiness) break;
                    // TODO(port): Empire.7.cs 667-718 (Habitat.MaximumPopulation, DetermineColonizationValue).
                    void locationEmpire;
                    throw new Error('TODO(port): Empire.7.cs ReviewCharacterLocation ColonyGovernor population-growth branch (MaximumPopulation / DetermineColonizationValue)');
                }
                break;
            }
            case CharacterRole.PirateLeader: {
                const skills = determineValidSkillsForRole(CharacterRole.FleetAdmiral, true, false);
                const skills2 = determineValidSkillsForRole(CharacterRole.Leader, false, true);
                const num21 = character.totalSkillValuesIfPresent(skills);
                const num22 = character.totalSkillValuesIfPresent(skills2);
                if (num22 > num21) {
                    const builtObject5 = identifyPirateBase(empire);
                    if (builtObject5 !== null && !builtObject5.hasBeenDestroyed && character.location !== builtObject5 && checkLocationSafeForDemoralizingCharacter(empire, flag, builtObject5, character)) {
                        if (transferToLocation) character.transferToNewLocation(builtObject5, galaxy);
                        return builtObject5;
                    }
                } else {
                    if (empire.shipGroups === null || empire.shipGroups.length <= 0) break;
                    // TODO(port): ShipGroups.IdentifyLargestFleet (Empire.7.cs 736-748) — fleets unported.
                    throw new Error('TODO(port): Empire.7.cs ReviewCharacterLocation PirateLeader fleets (ShipGroup)');
                }
                break;
            }
            case CharacterRole.ShipCaptain: {
                const subRoles: BuiltObjectSubRole[] = [BuiltObjectSubRole.Escort, BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.CapitalShip, BuiltObjectSubRole.Carrier];
                if (empire.pirateEmpireBaseHabitat === null) {
                    let flag9 = false;
                    if (character.location === null || !isBuiltObjectLocation(character.location)) flag9 = true;
                    if (character.location !== null && isBuiltObjectLocation(character.location)) {
                        const builtObject13 = character.location;
                        if (builtObject13.role !== BuiltObjectRole.Military) flag9 = true;
                    }
                    if (!flag9) break;
                    const builtObjectsBySubRole = empire.builtObjects.filter((b) => subRoles.includes(b.subRole));
                    if (builtObjectsBySubRole.length <= 0) break;
                    const index = galaxy.rnd.next(0, builtObjectsBySubRole.length);
                    const builtObject14 = builtObjectsBySubRole[index];
                    if (builtObject14 !== null && !builtObject14.hasBeenDestroyed && checkLocationSafeForDemoralizingCharacter(empire, flag, builtObject14, character)) {
                        if (character.location !== builtObject14 && transferToLocation) character.transferToNewLocation(builtObject14, galaxy);
                        return builtObject14;
                    }
                    break;
                }
                let flag10 = false;
                if (character.location === null || !isBuiltObjectLocation(character.location)) flag10 = true;
                if (character.location !== null && isBuiltObjectLocation(character.location)) {
                    const builtObject15 = character.location;
                    if (builtObject15.role !== BuiltObjectRole.Military && builtObject15.role !== BuiltObjectRole.Freight) flag10 = true;
                }
                if (!flag10) break;
                const subRoles2 = [...subRoles, BuiltObjectSubRole.SmallFreighter, BuiltObjectSubRole.MediumFreighter, BuiltObjectSubRole.LargeFreighter];
                const builtObjectsBySubRole2 = empire.builtObjects.filter((b) => subRoles2.includes(b.subRole));
                if (builtObjectsBySubRole2.length <= 0) break;
                const index2 = galaxy.rnd.next(0, builtObjectsBySubRole2.length);
                const builtObject16 = builtObjectsBySubRole2[index2];
                if (builtObject16 !== null && !builtObject16.hasBeenDestroyed && checkLocationSafeForDemoralizingCharacter(empire, flag, builtObject16, character)) {
                    if (character.location !== builtObject16 && transferToLocation) character.transferToNewLocation(builtObject16, galaxy);
                    return builtObject16;
                }
                break;
            }
            case CharacterRole.FleetAdmiral: {
                const shipGroup5 = character.determineFleet();
                let flag3 = true;
                if (shipGroup5 !== null) {
                    // TODO(port): ShipGroup.Mission priority test (Empire.7.cs 563-569).
                    throw new Error('TODO(port): Empire.7.cs ReviewCharacterLocation FleetAdmiral in a fleet (ShipGroup)');
                }
                if (!flag3) break;
                const charactersByRole5 = getCharactersByRole(characters, CharacterRole.FleetAdmiral);
                for (let num17 = 0; num17 < charactersByRole5.length; num17++) {
                    if (charactersByRole5[num17].determineFleet() !== null) throw new Error('TODO(port): Empire.7.cs ReviewCharacterLocation FleetAdmiral fleets (ShipGroup)');
                }
                // GenerateOrderedFleetsByOverallStrength / ByFighterStrength over ShipGroups.
                if (empire.shipGroups.length > 0) throw new Error('TODO(port): Empire.7.cs ReviewCharacterLocation FleetAdmiral GenerateOrderedFleetsBy* (ShipGroup)');
                flag3 = true;
                // shipGroup7 == null and shipGroup5 == null → break.
                break;
            }
            case CharacterRole.Leader: {
                const capital = empire.capital;
                if (character.location !== capital) {
                    if (capital === null) break;
                    if (capital.invadingTroops === null || capital.invadingTroops.items.length <= 0) {
                        if (transferToLocation) character.transferToNewLocation(capital, galaxy);
                        return capital;
                    }
                    let habitat10: Habitat | null = null;
                    if (character.location !== null && !isBuiltObjectLocation(character.location)) habitat10 = character.location;
                    const capitals = empireCapitals(empire);
                    if (habitat10 !== null && capitals.includes(habitat10)) break;
                    for (let num24 = 0; num24 < capitals.length; num24++) {
                        const habitat11 = capitals[num24];
                        if (habitat11.invadingTroops === null || habitat11.invadingTroops.items.length <= 0) {
                            if (transferToLocation) character.transferToNewLocation(habitat11, galaxy);
                            return habitat11;
                        }
                    }
                } else {
                    if (capital === null || character.location !== capital || capital.invadingTroops === null || capital.invadingTroops.items.length <= 0) break;
                    const capitals = empireCapitals(empire);
                    for (let num25 = 0; num25 < capitals.length; num25++) {
                        const habitat12 = capitals[num25];
                        if (habitat12.invadingTroops === null || habitat12.invadingTroops.items.length <= 0) {
                            if (transferToLocation) character.transferToNewLocation(habitat12, galaxy);
                            return habitat12;
                        }
                    }
                    for (let num26 = 0; num26 < empire.colonies.length; num26++) {
                        const habitat13 = empire.colonies[num26];
                        if (habitat13.invadingTroops === null || habitat13.invadingTroops.items.length <= 0) {
                            if (transferToLocation) character.transferToNewLocation(habitat13, galaxy);
                            return habitat13;
                        }
                    }
                }
                break;
            }
            case CharacterRole.Scientist: {
                getCharactersByRole(characters, CharacterRole.Scientist);
                let builtObject7: BuiltObject | null = null;
                const builtObject8 = identifyResearchStationHighestBonus(empire, IndustryType.Weapon);
                const builtObject9 = identifyResearchStationHighestBonus(empire, IndustryType.Energy);
                const builtObject10 = identifyResearchStationHighestBonus(empire, IndustryType.HighTech);
                let industryType = IndustryType.Undefined;
                if (character.researchWeapons > character.researchEnergy && character.researchWeapons > character.researchHighTech) industryType = IndustryType.Weapon;
                else if (character.researchEnergy > character.researchWeapons && character.researchEnergy > character.researchHighTech) industryType = IndustryType.Energy;
                else if (character.researchHighTech > character.researchWeapons && character.researchHighTech > character.researchEnergy) industryType = IndustryType.HighTech;
                switch (industryType) {
                    case IndustryType.Weapon:
                        builtObject7 = builtObject8;
                        if (builtObject7 !== null) break;
                        if (character.researchEnergy > 0 && character.researchEnergy > character.researchHighTech && builtObject9 !== null) {
                            if (checkLocationSafeForDemoralizingCharacter(empire, flag, builtObject9, character)) builtObject7 = builtObject9;
                        } else if (character.researchHighTech > 0 && character.researchHighTech > character.researchEnergy && builtObject10 !== null && checkLocationSafeForDemoralizingCharacter(empire, flag, builtObject10, character)) {
                            builtObject7 = builtObject10;
                        }
                        break;
                    case IndustryType.Energy:
                        builtObject7 = builtObject9;
                        if (builtObject7 !== null) break;
                        if (character.researchWeapons > 0 && character.researchWeapons > character.researchHighTech && builtObject8 !== null) {
                            if (checkLocationSafeForDemoralizingCharacter(empire, flag, builtObject8, character)) builtObject7 = builtObject8;
                        } else if (character.researchHighTech > 0 && character.researchHighTech > character.researchWeapons && builtObject10 !== null && checkLocationSafeForDemoralizingCharacter(empire, flag, builtObject10, character)) {
                            builtObject7 = builtObject10;
                        }
                        break;
                    case IndustryType.HighTech:
                        builtObject7 = builtObject10;
                        if (builtObject7 !== null) break;
                        if (character.researchEnergy > 0 && character.researchEnergy > character.researchWeapons && builtObject9 !== null) {
                            if (checkLocationSafeForDemoralizingCharacter(empire, flag, builtObject9, character)) builtObject7 = builtObject9;
                        } else if (character.researchWeapons > 0 && character.researchWeapons > character.researchEnergy && builtObject8 !== null && checkLocationSafeForDemoralizingCharacter(empire, flag, builtObject8, character)) {
                            builtObject7 = builtObject8;
                        }
                        break;
                }
                if (builtObject7 !== null && character.location !== builtObject7) {
                    if (transferToLocation) character.transferToNewLocation(builtObject7, galaxy);
                    return builtObject7;
                }
                let flag7 = false;
                if (character.location !== null && isBuiltObjectLocation(character.location)) {
                    const builtObject11 = character.location;
                    if (builtObject11.researchWeapons > 0 || builtObject11.researchEnergy > 0 || builtObject11.researchHighTech > 0) flag7 = true;
                }
                if (flag7) break;
                const researchFacilities = empire.researchFacilities as BuiltObject[];
                for (let num23 = 0; num23 < researchFacilities.length; num23++) {
                    const builtObject12 = researchFacilities[num23];
                    let flag8 = false;
                    switch (industryType) {
                        case IndustryType.Energy:
                            if (builtObject12.researchEnergy > 0) flag8 = true;
                            break;
                        case IndustryType.HighTech:
                            if (builtObject12.researchHighTech > 0) flag8 = true;
                            break;
                        case IndustryType.Weapon:
                            if (builtObject12.researchWeapons > 0) flag8 = true;
                            break;
                    }
                    if (flag8 && checkLocationSafeForDemoralizingCharacter(empire, flag, builtObject12, character)) {
                        if (transferToLocation) character.transferToNewLocation(builtObject12, galaxy);
                        return builtObject12;
                    }
                }
                break;
            }
            case CharacterRole.TroopGeneral: {
                if (character.troopGroundAttack >= character.troopGroundDefense) {
                    const shipGroup = character.determineFleet();
                    let flag2 = true;
                    if (shipGroup !== null) {
                        throw new Error('TODO(port): Empire.7.cs ReviewCharacterLocation TroopGeneral in a fleet (ShipGroup)');
                    } else if (character.location !== null && character.location.empire !== null && character.location.empire !== character.empire && !isBuiltObjectLocation(character.location)) {
                        const habitat3 = character.location;
                        const invading = habitatInvadingCharacterList(habitat3);
                        if (invading !== null && invading.includes(character)) flag2 = false;
                    }
                    if (!flag2) break;
                    const charactersByRole = getCharactersByRole(characters, CharacterRole.TroopGeneral);
                    for (let l = 0; l < charactersByRole.length; l++) {
                        if (charactersByRole[l].determineFleet() !== null) throw new Error('TODO(port): Empire.7.cs ReviewCharacterLocation TroopGeneral fleets (ShipGroup)');
                    }
                    // GenerateOrderedFleetsByTroopAttackStrength over ShipGroups.
                    if (empire.shipGroups.length > 0) throw new Error('TODO(port): Empire.7.cs ReviewCharacterLocation TroopGeneral GenerateOrderedFleetsByTroopAttackStrength (ShipGroup)');
                    // shipGroup3 == null → break.
                    break;
                }
                const charactersByRole2 = getCharactersByRole(characters, CharacterRole.TroopGeneral);
                const stellarObjectList = resolveLocationsToDefend(galaxy, empire, true);
                const stellarObjectList2: StellarObject[] = [];
                for (let n = 0; n < stellarObjectList.length; n++) {
                    if (isBuiltObjectLocation(stellarObjectList[n])) stellarObjectList2.push(stellarObjectList[n]);
                }
                for (let num3 = 0; num3 < stellarObjectList2.length; num3++) removeFirst(stellarObjectList, stellarObjectList2[num3]);
                const capitals = empireCapitals(empire);
                for (let num4 = 0; num4 < empire.colonies.length; num4++) {
                    const habitat4 = empire.colonies[num4];
                    const strategicValue = habitatStrategicValue(habitat4);
                    if ((strategicValue > 500000 || capitals.includes(habitat4)) && !stellarObjectList.includes(habitat4)) stellarObjectList.push(habitat4);
                }
                for (let num5 = 0; num5 < stellarObjectList.length; num5++) {
                    const so5 = stellarObjectList[num5];
                    if (isBuiltObjectLocation(so5)) continue;
                    const habitat5 = so5;
                    if (character.location === habitat5) {
                        const characterList = findCharactersAtLocationOrTransferring(charactersByRole2, habitat5);
                        let flag4 = false;
                        for (let num6 = 0; num6 < characterList.length; num6++) {
                            const character3 = characterList[num6];
                            if (character3 !== character && character3.troopGroundDefense > character3.troopGroundAttack) {
                                flag4 = true;
                                break;
                            }
                        }
                        if (!flag4) break;
                    }
                    if (findCharactersAtLocationOrTransferring(charactersByRole2, habitat5).length <= 0 && checkLocationSafeForDemoralizingCharacter(empire, flag, habitat5, character)) {
                        if (transferToLocation) character.transferToNewLocation(habitat5, galaxy);
                        return habitat5;
                    }
                }
                break;
            }
        }
    }
    return character !== null ? character.location : null;
}

// ---------------------------------------------------------------------------
// Empire.6.cs GenerateStartingCharacters (4304 / 4309)
// ---------------------------------------------------------------------------

/**
 * Empire.6.cs GenerateStartingCharacters() (4304) / GenerateStartingCharacters(StellarObject
 * startLocation) (4309). startLocation null → Capital. Normal empires take the empire's and (when
 * Galaxy.AllowRaceStartingCharacters) the dominant race's appearance-order-0 characters, add a
 * random Leader when none, pirates (PirateEmpireBaseHabitat != null) the same excluding
 * Ambassador/ColonyGovernor/Leader/TroopGeneral and add a PirateLeader; then top up intelligence
 * agents to 1 + Race.IntelligenceAgentAdditional, and activate every character at
 * ReviewCharacterLocation (or startLocation) with a CharacterStart event.
 */
export function generateStartingCharacters(galaxy: Galaxy, empire: Empire, startLocation: StellarObject | null = null): void {
    if (startLocation === null) startLocation = empire.capital;
    let characterList: Character[] = [];
    const dominantRace = empire.dominantRace;
    const raceChars = dominantRace !== null ? raceAvailableCharacters(galaxy, dominantRace) : null;
    if (empire.pirateEmpireBaseHabitat === null) {
        characterList = obtainStartingCharacters(empire.availableCharacters);
        if (galaxy.allowRaceStartingCharacters && dominantRace !== null && raceChars !== null) {
            characterList.push(...obtainStartingCharacters(raceChars));
        }
    } else {
        const list: CharacterRole[] = [];
        list.push(CharacterRole.Ambassador);
        list.push(CharacterRole.ColonyGovernor);
        list.push(CharacterRole.Leader);
        list.push(CharacterRole.TroopGeneral);
        const rolesToExclude = list;
        characterList = obtainStartingCharactersExcludingRoles(empire.availableCharacters, rolesToExclude);
        if (galaxy.allowRaceStartingCharacters && dominantRace !== null && raceChars !== null) {
            characterList.push(...obtainStartingCharactersExcludingRoles(raceChars, rolesToExclude));
        }
    }
    if (empire.pirateEmpireBaseHabitat === null) {
        if (countCharactersByRole(characterList, CharacterRole.Leader) <= 0) {
            const item = generateNewCharacter(galaxy, empire, CharacterRole.Leader, startLocation, false).character;
            characterList.push(item);
        }
    } else if (countCharactersByRole(characterList, CharacterRole.PirateLeader) <= 0) {
        const item2 = generateNewCharacter(galaxy, empire, CharacterRole.PirateLeader, startLocation, false).character;
        characterList.push(item2);
    }
    let num = 1;
    if (dominantRace !== null) num = 1 + raceIntelligenceAgentAdditional(dominantRace);
    const num2 = countCharactersByRole(characterList, CharacterRole.IntelligenceAgent);
    if (num2 < num) {
        const num3 = num - num2;
        for (let i = 0; i < num3; i++) {
            const item3 = generateNewCharacter(galaxy, empire, CharacterRole.IntelligenceAgent, startLocation, false).character;
            characterList.push(item3);
        }
    }
    for (let j = 0; j < characterList.length; j++) {
        const character = characterList[j];
        let stellarObject = reviewCharacterLocation(galaxy, empire, character, false);
        if (stellarObject === null) stellarObject = startLocation;
        character.activate(galaxy, empire, stellarObject);
        doCharacterEvent(galaxy, CharacterEventType.CharacterStart, character, character);
        if (character.role === CharacterRole.Leader || character.role === CharacterRole.Scientist || character.role === CharacterRole.PirateLeader) character.bonusesKnown = true;
    }
}

// ---------------------------------------------------------------------------
// Character bonus reads (the C# expressions other modules port)
// ---------------------------------------------------------------------------

/** Empire.Leader (Empire.cs 866). */
export function empireLeader(empire: Empire | null): Character | null {
    return empire !== null ? empire.leader : null;
}

/** Habitat.Characters non-empty → GetHighestSkillLevelExcludeLeaders(skill); else 0. */
export function colonyCharactersHighestSkillExcludeLeaders(colony: Habitat, skill: CharacterSkillType): number {
    const characters = stellarObjectCharacters(colony);
    if (characters !== null && characters.length > 0) return getHighestSkillLevelExcludeLeaders(characters, skill);
    return 0;
}

// Shared shape of Habitat.cs 616-624 / 810-818 / 867-875 / 5800-5808:
// num = colony characters (excluding leaders, bonuses known) + Empire.Leader.<skill>.
function colonyPlusLeaderSkill(colony: Habitat, skill: CharacterSkillType): number {
    let num = 0;
    const characters = stellarObjectCharacters(colony);
    if (characters !== null && characters.length > 0) num += getHighestSkillLevelExcludeLeaders(characters, skill);
    if (colony.empire !== null && colony.empire.leader !== null) num += colony.empire.leader.getSkillLevel(skill);
    return num;
}

/** Habitat.cs 810-818 (colony corruption: val *= 1 - num4 / 100): num4. */
export function resolveCharacterColonyCorruptionBonus(colony: Habitat): number {
    return colonyPlusLeaderSkill(colony, CharacterSkillType.ColonyCorruption);
}

/** Habitat.cs 867-875 (colony income: num *= 1 + num5 / 100): num5. */
export function resolveCharacterColonyIncomeBonus(colony: Habitat): number {
    return colonyPlusLeaderSkill(colony, CharacterSkillType.ColonyIncome);
}

/** Habitat.cs 616-624 / 5800-5808 (approval: num23 / num): colony characters + leader ColonyHappiness. */
export function resolveCharacterColonyHappinessBonus(colony: Habitat): number {
    return colonyPlusLeaderSkill(colony, CharacterSkillType.ColonyHappiness);
}

/** Empire.Leader.ColonyHappiness (0 without a leader) — Habitat.cs 623 / Empire.9.cs 5494. */
export function resolveLeaderColonyHappiness(empire: Empire | null): number {
    return empire !== null && empire.leader !== null ? empire.leader.colonyHappiness : 0;
}

/** Empire.cs WarWeariness (1405-1413): divisor 1 + Leader.WarWeariness / 100 (1.0 without a leader). */
export function resolveEmpireLeaderWarWearinessDivisor(empire: Empire): number {
    let num = 1.0;
    if (empire.leader !== null) num = 1.0 + empire.leader.warWeariness / 100.0;
    return num;
}

/**
 * Habitat.cs 568-578 (colony war weariness): the two divisors, applied in order
 * (num /= leaderDivisor when Empire.Leader != null; num /= charactersDivisor when Characters
 * non-empty). null means "no division".
 */
export function resolveColonyWarWearinessDivisors(colony: Habitat): { leaderDivisor: number | null; charactersDivisor: number | null } {
    let leaderDivisor: number | null = null;
    let charactersDivisor: number | null = null;
    if (colony.empire !== null && colony.empire.leader !== null) leaderDivisor = 1.0 + colony.empire.leader.warWeariness / 100.0;
    const characters = stellarObjectCharacters(colony);
    if (characters !== null && characters.length > 0) {
        const highestSkillLevelExcludeLeaders = getHighestSkillLevelExcludeLeaders(characters, CharacterSkillType.WarWeariness);
        charactersDivisor = 1.0 + highestSkillLevelExcludeLeaders / 100.0;
    }
    return { leaderDivisor, charactersDivisor };
}

/** Empire.cs AnnualTroopMaintenance (2031-2035) / Empire.4.cs 1601 / TroopList.cs 452: 1 + Leader.TroopMaintenance / 100. */
export function resolveLeaderTroopMaintenanceFactor(empire: Empire): number {
    let num2 = 1.0;
    if (empire.leader !== null) num2 *= 1.0 + empire.leader.troopMaintenance / 100.0;
    return num2;
}

/**
 * Empire.cs 2049-2063: per-troop divisor from the troop's colony (characters excluding leaders) or
 * built object (all characters) TroopMaintenance skill; null when no characters there.
 */
export function resolveTroopLocationMaintenanceDivisor(colony: Habitat | null, builtObject: BuiltObject | null): number | null {
    if (colony !== null) {
        const characters = stellarObjectCharacters(colony);
        if (characters !== null && characters.length > 0) return 1.0 + getHighestSkillLevelExcludeLeaders(characters, CharacterSkillType.TroopMaintenance) / 100.0;
        return null;
    }
    if (builtObject !== null) {
        const characters = builtObject.characters as Character[] | null;
        if (characters !== null && characters.length > 0) return 1.0 + getHighestSkillLevel(characters, CharacterSkillType.TroopMaintenance) / 100.0;
    }
    return null;
}

/** BuiltObject.cs AnnualSupportCost 803-804: characterMaintenanceBonuses / 100.0 (num5). */
export function resolveCharacterMaintenanceSavings(builtObject: BuiltObject): number {
    return getCharacterMaintenanceBonuses(builtObject) / 100.0;
}

/** Empire.Characters.CheckCharactersForTrait(role, trait) — e.g. Scientist/UltraGenius (stationPlacement.ts). */
export function empireCharactersHaveTrait(empire: Empire, role: CharacterRole, trait: CharacterTraitType): boolean {
    return checkCharactersForTrait(empireCharacters(empire), role, trait);
}

/** Empire.Characters as Character[]. */
export function getEmpireCharacters(empire: Empire): Character[] {
    return empireCharacters(empire);
}
