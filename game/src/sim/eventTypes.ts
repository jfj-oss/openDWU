// M4u — event enums and plague lookups shared by several packages (EventMessageType, DisasterEventType, RaceEventType,
// Galaxy.Plagues, Habitat.GetPlagueUnhappinessFactor). A leaf module (type-only imports) so colony / tax / troop code
// can read them without an import cycle through events.ts.

import type { Galaxy } from './galaxy';
import type { Habitat } from './types';
import type { Race } from './data/races';
import type { PlagueStatic } from './researchSystem';

/** EventMessageType.cs (enum, declaration order). */
export enum EventMessageType {
    Undefined, NewEmpireRaceAbility, ExoticTechDiscovered, SpecialGovernmentType, CreatureOutbreak, GalacticRefugees, SleepersAwake,
    NewEmpireEmerges, OriginsDiscovery, LostBuiltObjectCoordinates, LostColonyCoordinates, FreeSuperShip, PirateFactionJoinsYou,
    TreasureFound, LostColonyFound, AncientBattleDebrisField, IndependentPopulation, GeneralRuinsDiscovery, EncounterRuins,
    EncounterBuiltObject, BuiltObjectExplodes, PirateAmbush, CreatureSwarm, StoryClue, SpecialArea, RestrictedResourceDiscovered,
    RuinsEmpireBonus, RogueFleetDefectsToUs, RogueFleetDefectsFromUs, EmpireSplits, UncoverPirateAttackFundingAnotherEmpire,
    UncoverPirateAttackFundingYourEmpire, UncoverPlanetDestroyerConstruction, UncoverKnownLocation, RareResourceIntercepted,
    GeneralDiscovery, DisasterEvent, ResourceAppearance, ResourceDepletion, RaceEvent, WonderBuilt, CharacterEvent, PhantomPirates,
    LeaderChange,
}

/** DisasterEventType.cs (enum, declaration order). */
export enum DisasterEventType {
    Undefined, Earthquake, Sinkhole, Tsunami, Sandstorm, Blizzard, Eruption, Plague, EconomicCrisis,
}

/** RaceEventType.cs (byte enum, declaration order). */
export enum RaceEventType {
    Undefined, NepthysWineVintage, UnderwaterLeviathan, GreatHuntStrongTroops, SuppressedKnowledgeLoseResearch,
    ShakturiArtifactWeaponResearch, WarriorWaveTroopRecruitment, SwarmsFullTroopTransport, CannibalismPopulationShrinks,
    MetamorphosisCharacterChange, StrengthInNumbersMaintenanceLowerForSmallShips, AntiXenoRiotsExterminate, XenophobiaNoAssimilate,
    DestinyCharacterTraits, NaturalHarmonyColonyQualityIncreased, SecurityConcernsCharacterReplaced, NeverSurrenderWarWearinessReset,
    ScientificBreakthroughResearchProgress, ForcedRetirementLeaderReplaced, TodashGalacticChampionships,
    HistoricalKnowledgeUncoverHiddenLocation, IsolationistsResetFirstContactPenalty, GrandPerformanceDiplomacyBonus,
    FriendsInManyPlacesRevealTerritory, LuckyAvertColonyDisaster, SupremeWarriorNewGeneral, DeathCultExterminate,
    CreativeReengineeringFreeCrashResearch, PredictiveHistory, HistoricalDiscoveryExploreRuinsForResearchBoost,
}

/** Race.cs 235 ImmuneToPlagues ("ImmuneToPlagues" line, Race.cs 1607 ParseBoolValue: "y" → true; kept in Race.extra). */
export function raceImmuneToPlagues(race: Race): boolean {
    const raw = race.extra['ImmuneToPlagues'];
    return raw !== undefined && raw.trim().toLowerCase() === 'y';
}

/**
 * Galaxy.Plagues (Galaxy.3.cs 4949 `Plagues = PlaguesStatic.Clone()`, a shallow PlagueList clone — the same Plague objects
 * as Galaxy.PlaguesStatic, which the research runtime mutates): galaxy.researchStatic.plagues.
 */
export function galaxyPlagues(galaxy: Galaxy): PlagueStatic[] {
    return galaxy.researchStatic !== null ? galaxy.researchStatic.plagues : [];
}

/** Habitat.cs 1874 GetPlagueUnhappinessFactor(out plague) (Galaxy.PlaguesStatic). No Rnd. */
export function getPlagueUnhappinessFactorWithPlague(galaxy: Galaxy, habitat: Habitat): { result: number; plague: PlagueStatic | null } {
    let result = 0.0;
    let plague: PlagueStatic | null = null;
    const plaguesStatic = galaxyPlagues(galaxy);
    if (habitat.plagueId >= 0 && habitat.plagueId < plaguesStatic.length) {
        plague = plaguesStatic[habitat.plagueId];
        if (plague != null) {
            let num = plague.mortalityRate;
            if (plague.exceptionRaceName !== '' && habitat.population != null) {
                const dominantRace = habitat.population.dominantRace;
                if (dominantRace !== null && dominantRace.name === plague.exceptionRaceName) num = plague.exceptionMortalityRate;
            }
            result = num * -20.0;
        }
    }
    return { result, plague };
}
