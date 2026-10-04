// How the player's event messages are presented: port of Main.Part4.cs:487 method_523 (the picture switch, the popup
// level `num`, the flag7 gate on the Game Options discovery settings) and of the panels it opens — pnlEventMessage
// (method_508 Close / Go to Event Location, method_509-511 the two choice buttons) and pnlStoryEvent (method_570 for a
// story EventAction, method_571 for origins discoveries / story clues). Pure: no DOM (messagePopups.ts draws it,
// eventMessages.ts wires it).

import { EventMessageType, DisasterEventType, RaceEventType } from '../sim/eventTypes';
import { BuiltObject } from '../sim/builtObject';
import { Habitat } from '../sim/types';
import { Character } from '../sim/characters';
import { Empire } from '../sim/empire';
import { Creature, CreatureType } from '../sim/creature';
import { Ruin } from '../sim/ruins';
import { GalaxyLocation, GalaxyLocationType } from '../sim/galaxyLocation';
import { EmpireActivity } from '../sim/pirates/empireActivity';
import { PlanetaryFacility } from '../sim/construction/facilities';
import { EventAction, EventActionType } from '../sim/story/gameEventModel';
import { ComponentType, type Component } from '../sim/data/components';
import { BuiltObjectRole } from '../sim/data/designSpecifications';
import { findAbandonedShipsInDebrisField } from '../sim/events';
import type { Galaxy } from '../sim/galaxy';
import type { TechNode } from '../sim/researchSystem';
import { HabitatImageOffsetContinental, HabitatImageOffsetOcean, LandscapeImageOffsetOcean } from '../sim/galaxyImages';

const CHROME = '/assets/dwu/images/ui/chrome/';
const MESSAGES = '/assets/dwu/images/ui/messages/';

/** bitmap_49 / 52 / 83 / 89 / 90 / 189 (Main.Part12.cs:636-704, images/ui/chrome). */
export const EVENT_CHROME = {
    pirateFlag: `${CHROME}pirateflag.png`, // bitmap_49
    money: `${CHROME}money.png`, // bitmap_52
    research: `${CHROME}research.png`, // bitmap_83
    warpJump: `${CHROME}warpjump_large.png`, // bitmap_89
    colonization: `${CHROME}colonization_large.png`, // bitmap_90
    storyEvent: `${CHROME}storyEvent.jpg`, // bitmap_189
} as const;

/** bitmap_30 (Main.Part12.cs:206-218 LoadUiEvents, images/ui/events), indexed by DisasterEventType - 1. */
const DISASTER_FILES = ['earthquake.png', 'sinkhole.png', 'tsunami.png', 'sandstorm.png', 'blizzard.png', 'eruption.png', 'plague.png', 'economiccrisis.png'];

export const ruinImageUrl = (pictureRef: number): string => `/assets/dwu/images/environment/ruins/ruin_${pictureRef}.png`;
export const componentImageUrl = (pictureRef: number): string => `/assets/dwu/images/ui/components/Component_${pictureRef}.bmp`;
export const facilityImageUrl = (pictureRef: number): string => `/assets/dwu/images/environment/planetaryfacilities/facility_${pictureRef}.png`;
export const resourceImageUrl = (pictureRef: number): string => `/assets/dwu/images/ui/resources/Resource_${pictureRef}.bmp`;
export const raceImageUrl = (pictureIndex: number): string => `/assets/dwu/images/units/races/race_${pictureIndex}.png`;
/** bitmap_28[i] (BaconMain.cs 2165 LoadUiMessages; 0 underAttack, 22 restrictedArea, 25 galacticHistory). */
const messageImage = (file: string): string => MESSAGES + file;
/** images/ui/story/<file> (Main.Part4.cs:1036-1060 method_10 for an EventAction's ImageFilename). */
export const storyImageUrl = (file: string): string => `/assets/dwu/images/ui/story/${file}`;

/** What method_523 draws as the event's `bitmap`. */
export type EventPicture =
    /** An image file; `fallback` when it is missing (method_10 returns null → the default picture). */
    | { kind: 'url'; url: string; fallback?: string }
    /** PrepareBuiltObjectImage(builtObjectImageCache.ObtainImage(bo)). */
    | { kind: 'ship'; builtObject: BuiltObject }
    /** habitatImageCache.ObtainImage(habitat). */
    | { kind: 'habitat'; habitat: Habitat }
    /** habitatImageCache.ObtainImage(pictureRef): a fixed GalaxyImages habitat picture. */
    | { kind: 'habitatPicture'; ref: number }
    /** bitmap_29[Habitat.LandscapePictureRef]. */
    | { kind: 'landscape'; ref: number }
    /** characterImageCache.ObtainCharacterImage. */
    | { kind: 'character'; character: Character }
    /** Empire.LargeFlagPicture. */
    | { kind: 'flag'; empire: Empire }
    /** method_652(empire, 200): the flag beside the dominant race's picture. */
    | { kind: 'flagRace'; empire: Empire }
    /** bitmap_10[set][0], the creature's first frame (`rotate`: the clockwise turn from the file, degrees). */
    | { kind: 'creature'; type: CreatureType; url: string; rotate: number }
    /** method_654(left, right): the two side by side (a planet and its resource). */
    | { kind: 'pair'; left: EventPicture; right: EventPicture };

/** The panel method_523 opens for the event. */
export type EventPanelKind =
    /** method_508: pnlEventMessage with Close (+ Go to Event Location). */
    | 'event'
    /** method_509 / 510 / 511: pnlEventMessage with the two choice buttons. */
    | 'choice'
    /** method_570: pnlStoryEvent, the full-view story panel with the event's own picture. */
    | 'story'
    /** method_571: pnlStoryEvent over storyEvent.jpg (the picture is not used). */
    | 'storyHistory';

/** A choice button's action (Main.Part4.cs:1777 btnEventMessageInvestigate_Click). */
export type EventChoice =
    | { kind: 'investigateRuins'; habitat: Habitat }
    | { kind: 'investigateBuiltObject'; builtObject: BuiltObject }
    | { kind: 'warnTargetOfPirateAttackFunding'; requestingEmpire: Empire; targetEmpire: Empire }
    | { kind: 'exposePlanetDestroyer'; builder: Empire; location: GalaxyLocation }
    | { kind: 'none' };

export interface EventPresentation {
    panel: EventPanelKind;
    picture: EventPicture | null;
    /**
     * The popup level (`num`): 0-2 pick flag4 / flag5 / flag6 of the DiscoveryActionRuin setting, 3 (default) flag6.
     * The choice panels are not gated by it (null).
     */
    level: number | null;
    /** For 'choice': the Investigate button's text key, its action, and the Avoid button's text key. */
    investigateText?: string;
    avoidText?: string;
    choice?: EventChoice;
}

/** `object_7 is Race` (the TS race is the races.txt record). */
function isRace(v: unknown): v is { pictureIndex: number; name: string } {
    return v !== null && typeof v === 'object' && typeof (v as { pictureIndex?: unknown }).pictureIndex === 'number' && !(v instanceof Character);
}

/** `object_7 is Resource` / ResourceDefinition: the resources.txt record. */
function resourcePictureRef(v: unknown, galaxy: Galaxy | null): number | null {
    if (typeof v === 'number') return galaxy?.resourceSystem?.byId.get(v)?.pictureRef ?? null; // the TS events pass the id
    if (v === null || typeof v !== 'object' || v instanceof Habitat) return null;
    const r = v as { pictureRef?: unknown; resourceId?: unknown };
    return typeof r.pictureRef === 'number' && typeof r.resourceId === 'number' ? r.pictureRef : null;
}

/** `object_7 is PlanetaryFacilityDefinition` (the facilities.txt record). */
function facilityDefinitionPictureRef(v: unknown): number | null {
    if (v === null || typeof v !== 'object' || v instanceof PlanetaryFacility) return null;
    const r = v as { pictureRef?: unknown; facilityId?: unknown; wonderType?: unknown };
    return typeof r.pictureRef === 'number' && r.facilityId !== undefined && r.wonderType !== undefined ? r.pictureRef : null;
}

/** `object_7 is Component` (components.txt record). */
function isComponent(v: unknown): v is Component {
    if (v === null || typeof v !== 'object') return false;
    const c = v as Partial<Component>;
    return typeof c.componentId === 'number' && typeof c.pictureRef === 'number' && typeof c.type === 'number' && typeof c.value1 === 'number';
}

function isTechNode(v: unknown): v is TechNode {
    return v !== null && typeof v === 'object' && 'def' in v && 'isResearched' in v;
}

/** `object_7 is ResearchNodeDefinition` (research.txt record). */
function isResearchNodeDefinition(v: unknown): v is { components: number[]; componentImprovements: { componentId: number }[]; facilityId: number | null } {
    return v !== null && typeof v === 'object' && Array.isArray((v as { components?: unknown }).components) && Array.isArray((v as { componentImprovements?: unknown }).componentImprovements) && !isTechNode(v);
}

const url = (u: string): EventPicture => ({ kind: 'url', url: u });
const ship = (b: BuiltObject): EventPicture => ({ kind: 'ship', builtObject: b });
const ruin = (r: Ruin): EventPicture => url(ruinImageUrl(r.pictureRef));
const landscape = (h: Habitat): EventPicture | null => (h.landscapePictureRef >= 0 ? { kind: 'landscape', ref: h.landscapePictureRef } : null);

/**
 * bitmap_10[0..4][0] (Main.Part13.cs:2049-2058 LoadCreatures; render/creatureLayer.ts CREATURE_FRAME_SETS): the first
 * moving frame of each creature type, by bitmap_10 index (rock slug, desert slug, Kaltor, Ardilus, Silver Mist).
 */
const CREATURE_FIRST_FRAMES: readonly { type: CreatureType; url: string }[] = [
    { type: CreatureType.RockSpaceSlug, url: '/assets/dwu/images/units/creatures/spaceslug/Slug_00000.png' },
    { type: CreatureType.DesertSpaceSlug, url: '/assets/dwu/images/units/creatures/sandslug/Sandworm_00000.png' },
    { type: CreatureType.Kaltor, url: '/assets/dwu/images/units/creatures/kaltor/Kaltor_00000.png' },
    { type: CreatureType.Ardilus, url: '/assets/dwu/images/units/creatures/ardilus/ArdillusMoving2_00000.png' },
    { type: CreatureType.SilverMist, url: '/assets/dwu/images/units/creatures/silvermist/SilverMist_00000.png' },
];
/**
 * A creature picture. LoadCreaturesImpl turns every frame 90° clockwise on load (Main.Part13.cs:2027); the
 * CreatureOutbreak picture turns it back (Rotate270, 1316), GeneralDiscovery keeps the loaded frame.
 */
function creatureSetOf(type: CreatureType, rotate: number): EventPicture {
    const f = CREATURE_FIRST_FRAMES.find((x) => x.type === type) ?? CREATURE_FIRST_FRAMES[2];
    return { kind: 'creature', type: f.type, url: f.url, rotate };
}
const creatureSet = (set: number, rotate: number): EventPicture => creatureSetOf(CREATURE_FIRST_FRAMES[set]?.type ?? CreatureType.Kaltor, rotate);

/** Main.Part4.cs:857-874 / 911-928: an ancient battle debris field's first abandoned ship. */
function debrisFieldPicture(galaxy: Galaxy | null, location: GalaxyLocation): EventPicture | null {
    if (galaxy === null) return null;
    const ships = findAbandonedShipsInDebrisField(galaxy, location);
    return ships.length > 0 ? ship(ships[0]) : null;
}

/** method_654(habitat image scaled to 150, resource picture, 150, 75), Main.Part4.cs:1117-1168. */
function resourceEventPicture(additionalData: unknown, location: unknown, galaxy: Galaxy | null): EventPicture | null {
    const ref = resourcePictureRef(additionalData, galaxy);
    if (ref === null) return null;
    const resource = url(resourceImageUrl(ref));
    if (location instanceof Habitat) return { kind: 'pair', left: { kind: 'habitat', habitat: location }, right: resource };
    return resource;
}

/** Main.Part4.cs:1169-1271: the RaceEvent pictures by RaceEventType (player = _Game.PlayerEmpire). */
function raceEventPicture(type: RaceEventType, player: Empire, galaxy: Galaxy | null): EventPicture | null {
    const R = RaceEventType;
    const race = player.dominantRace;
    const racePic = race !== null && isRace(race) ? url(raceImageUrl(race.pictureIndex)) : null;
    // `RaceEventData is Character` → its picture. The C# also clears RaceEventData here; the TS UI only reads it (the
    // field is saved game state, and a UI write would change the sim outside the command log).
    const eventCharacter = (): EventPicture | null => {
        const data = player.raceEventData;
        return data instanceof Character ? { kind: 'character', character: data } : null;
    };
    switch (type) {
        case R.NepthysWineVintage: {
            // Main.Part4.cs:1186-1192: method_654(habitatImageCache.ObtainImage(HabitatImageOffsetOcean + 1) 150 × 150,
            // the Nepthys Wine picture) — the second ocean planet beside the resource; nothing without the resource.
            const wine = galaxy?.resourceSystem.resources.find((r) => r.name === 'Nepthys Wine') ?? null;
            return wine !== null ? { kind: 'pair', left: { kind: 'habitatPicture', ref: HabitatImageOffsetOcean + 1 }, right: url(resourceImageUrl(wine.pictureRef)) } : null;
        }
        case R.UnderwaterLeviathan:
            // Main.Part4.cs:1197: bitmap_29[LandscapeImageOffsetOcean + 1] — the second ocean landscape.
            return { kind: 'landscape', ref: LandscapeImageOffsetOcean + 1 };
        case R.StrengthInNumbersMaintenanceLowerForSmallShips:
            // TODO(port): the empire's standard frigate picture (ShipImageHelper.ResolveStandardShipImageByFamilyAndSubRole) — Main.Part4.cs:1191-1197
            return null;
        case R.NaturalHarmonyColonyQualityIncreased:
            // Main.Part4.cs:1207-1208: habitatImageCache.ObtainImage(HabitatImageOffsetContinental + 1), the second
            // continental planet.
            return { kind: 'habitatPicture', ref: HabitatImageOffsetContinental + 1 };
        case R.ForcedRetirementLeaderReplaced: {
            const c = eventCharacter();
            if (c !== null) return c;
            return player.leader !== null ? { kind: 'character', character: player.leader } : null;
        }
        case R.DestinyCharacterTraits:
        case R.SecurityConcernsCharacterReplaced:
        case R.SupremeWarriorNewGeneral:
            return eventCharacter() ?? racePic;
        case R.GreatHuntStrongTroops:
        case R.WarriorWaveTroopRecruitment:
        case R.SwarmsFullTroopTransport:
        case R.CannibalismPopulationShrinks:
        case R.MetamorphosisCharacterChange:
        case R.AntiXenoRiotsExterminate:
        case R.XenophobiaNoAssimilate:
        case R.NeverSurrenderWarWearinessReset:
        case R.TodashGalacticChampionships:
        case R.IsolationistsResetFirstContactPenalty:
        case R.GrandPerformanceDiplomacyBonus:
        case R.FriendsInManyPlacesRevealTerritory:
        case R.LuckyAvertColonyDisaster:
        case R.DeathCultExterminate:
            return racePic;
        case R.HistoricalKnowledgeUncoverHiddenLocation:
        case R.PredictiveHistory:
            return url(messageImage('galacticHistory.png')); // bitmap_28[25]
        case R.SuppressedKnowledgeLoseResearch:
        case R.ShakturiArtifactWeaponResearch:
        case R.ScientificBreakthroughResearchProgress:
        case R.CreativeReengineeringFreeCrashResearch:
        case R.HistoricalDiscoveryExploreRuinsForResearchBoost:
            return url(EVENT_CHROME.research); // bitmap_83
        default:
            return null;
    }
}

/** Main.Part4.cs:887-1078 case GeneralDiscovery: the picture by the additionalData's type (first match wins). */
function generalDiscoveryPicture(d: unknown, player: Empire, galaxy: Galaxy | null): { picture: EventPicture | null; story: boolean } {
    const none = { picture: null, story: false };
    const pic = (p: EventPicture | null) => ({ picture: p, story: false });
    const resource = resourcePictureRef(typeof d === 'number' ? null : d, galaxy);
    if (resource !== null) return pic(url(resourceImageUrl(resource)));
    if (d instanceof PlanetaryFacility) return pic(url(facilityImageUrl(d.def.pictureRef)));
    const facilityDef = facilityDefinitionPictureRef(d);
    if (facilityDef !== null) return pic(url(facilityImageUrl(facilityDef)));
    if (d instanceof GalaxyLocation) {
        if (d.type === GalaxyLocationType.DebrisField) return pic(debrisFieldPicture(galaxy, d));
        if (d.type === GalaxyLocationType.RestrictedArea) return pic(url(messageImage('restrictedArea.png'))); // bitmap_28[22]
        return none;
    }
    if (d instanceof Ruin) return pic(ruin(d));
    if (d instanceof BuiltObject) return pic(ship(d));
    if (d instanceof Habitat) return pic({ kind: 'habitat', habitat: d });
    if (isRace(d)) return pic(url(raceImageUrl(d.pictureIndex)));
    if (d instanceof Creature) return pic(creatureSetOf(d.type, 90));
    if (d instanceof Character) return pic({ kind: 'character', character: d });
    if (isComponent(d)) {
        // 972-984: the first (primitive) hyperdrive and colonization module get the chrome pictures.
        if (d.type === ComponentType.HyperDrive && d.value1 < 5000) return pic(url(EVENT_CHROME.warpJump));
        if (d.type === ComponentType.HabitationColonization && d.value1 <= 30000000) return pic(url(EVENT_CHROME.colonization));
        return pic(url(componentImageUrl(d.pictureRef)));
    }
    if (isTechNode(d)) {
        const rs = player.research;
        const def = d.def;
        const comp = def.components.length > 0 ? rs?.definitionFor(def.components[0]) : def.componentImprovements.length > 0 ? rs?.definitionFor(def.componentImprovements[0].componentId) : undefined;
        if (comp !== undefined) return pic(url(componentImageUrl(comp.pictureRef)));
        const facility = rs?.planetaryFacilityOf?.(d) ?? null;
        return pic(facility !== null ? url(facilityImageUrl(facility.pictureRef)) : null);
    }
    if (isResearchNodeDefinition(d)) {
        const id = d.components.length > 0 ? d.components[0] : d.componentImprovements.length > 0 ? d.componentImprovements[0].componentId : -1;
        const comp = id >= 0 ? galaxy?.researchStatic?.componentsById.get(id) : undefined;
        return pic(comp !== undefined ? url(componentImageUrl(comp.pictureRef)) : null);
    }
    if (d instanceof Empire) return pic({ kind: 'flag', empire: d });
    if (d instanceof EventAction) {
        // 1032-1078: a story message (GeneralMessageToEmpire / EmpireMessageToEmpire) opens the story panel (flag2).
        if (d.type === EventActionType.GeneralMessageToEmpire) {
            return { picture: d.imageFilename ? { kind: 'url', url: storyImageUrl(d.imageFilename), fallback: EVENT_CHROME.storyEvent } : url(EVENT_CHROME.storyEvent), story: true };
        }
        if (d.type === EventActionType.EmpireMessageToEmpire) {
            // TODO(port): a missing ImageFilename falls back to the flag + race overlay (1062-1075), not the plain storyEvent.jpg
            if (d.imageFilename) return { picture: { kind: 'url', url: storyImageUrl(d.imageFilename), fallback: EVENT_CHROME.storyEvent }, story: true };
            // storyEvent.jpg with method_652(empire, 200) centred on it (messagePopups.ts draws the overlay).
            return { picture: d.empire !== null ? { kind: 'pair', left: url(EVENT_CHROME.storyEvent), right: { kind: 'flagRace', empire: d.empire } } : url(EVENT_CHROME.storyEvent), story: true };
        }
        return none;
    }
    return none;
}

/**
 * Port of Main.Part4.cs:487 method_523's presentation: which panel, the picture and the popup level, for one event the
 * player's recipient received. `player` is _Game.PlayerEmpire.
 */
export function eventMessagePresentation(type: EventMessageType, additionalData: unknown, location: unknown, player: Empire, galaxy: Galaxy | null): EventPresentation {
    const T = EventMessageType;
    const d = additionalData;
    // 503-554: the two encounter popups return early with their choice buttons.
    switch (type) {
        case T.EncounterBuiltObject:
            if (d instanceof BuiltObject) {
                const base = d.role === BuiltObjectRole.Base; // method_511 (85-108)
                return {
                    panel: 'choice',
                    picture: ship(d),
                    level: null,
                    investigateText: base ? 'Investigate Base' : 'Investigate Ship',
                    avoidText: base ? 'Leave the Base alone' : 'Leave the Ship alone',
                    choice: { kind: 'investigateBuiltObject', builtObject: d },
                };
            }
            return { panel: 'choice', picture: null, level: null, choice: { kind: 'none' } };
        case T.EncounterRuins:
            if (d instanceof Habitat) {
                return {
                    panel: 'choice',
                    picture: d.ruin !== null ? ruin(d.ruin) : null,
                    level: null,
                    investigateText: 'Investigate Ruins',
                    avoidText: 'Leave the Ruins alone',
                    choice: { kind: 'investigateRuins', habitat: d },
                };
            }
            return { panel: 'choice', picture: null, level: null, choice: { kind: 'none' } };
        // 1468-1505: the three decision events (else branch, method_509).
        case T.UncoverPirateAttackFundingAnotherEmpire: {
            const a = d instanceof EmpireActivity ? d : null;
            return {
                panel: 'choice',
                picture: url(EVENT_CHROME.pirateFlag),
                level: null,
                investigateText: 'Warn target empire about this secret deal',
                avoidText: 'Keep this information to ourselves',
                choice: a !== null && a.requestingEmpire !== null && a.targetEmpire !== null ? { kind: 'warnTargetOfPirateAttackFunding', requestingEmpire: a.requestingEmpire, targetEmpire: a.targetEmpire } : { kind: 'none' },
            };
        }
        case T.UncoverPlanetDestroyerConstruction: {
            // 1482-1490 casts object_7 to BuiltObject, but the sender (Empire.1.cs 1426) passes object[] { builder, location }
            // with the planet destroyer as the location; its picture is drawn from that ship.
            const arr = Array.isArray(d) ? d : null;
            const builder = arr !== null && arr[0] instanceof Empire ? arr[0] : null;
            const where = arr !== null && arr[1] instanceof GalaxyLocation ? arr[1] : null;
            return {
                panel: 'choice',
                picture: location instanceof BuiltObject ? ship(location) : d instanceof BuiltObject ? ship(d) : null,
                level: null,
                investigateText: 'Expose this secret project to all empires',
                avoidText: 'Keep this information to ourselves',
                choice: builder !== null && where !== null ? { kind: 'exposePlanetDestroyer', builder, location: where } : { kind: 'none' },
            };
        }
        case T.RogueFleetDefectsToUs:
            // 1491-1497: the rogue fleet's lead ship. TODO(port): Accept → Empire.DefectFleet (no TS sender raises this event yet)
            return { panel: 'choice', picture: null, level: null, investigateText: 'Accept rogue fleet into our empire', avoidText: 'Reject offer from rogue fleet', choice: { kind: 'none' } };
    }

    let picture: EventPicture | null = null;
    let num = 0;
    let panel: EventPanelKind = 'event';
    switch (type) {
        case T.NewEmpireRaceAbility:
            if (isRace(d)) picture = url(raceImageUrl(d.pictureIndex));
            num = 2;
            break;
        case T.ExoticTechDiscovered:
        case T.SpecialGovernmentType:
        case T.GalacticRefugees:
            if (d instanceof Ruin) picture = ruin(d);
            num = 2;
            break;
        case T.CreatureOutbreak:
            picture = creatureSet(2, 0);
            num = 1;
            if (d instanceof Creature) {
                if (d.type === CreatureType.SilverMist) num = 3;
                if (d.type !== CreatureType.Undefined) picture = creatureSetOf(d.type, 0);
            }
            break;
        case T.SleepersAwake:
            if (d instanceof Ruin) picture = ruin(d);
            else if (isRace(d)) picture = url(raceImageUrl(d.pictureIndex));
            num = 2;
            break;
        case T.NewEmpireEmerges:
            num = 3;
            break;
        case T.LostBuiltObjectCoordinates:
            if (d instanceof Ruin) picture = ruin(d);
            else if (d instanceof BuiltObject) picture = ship(d);
            num = 2;
            break;
        case T.LostColonyCoordinates:
        case T.RuinsEmpireBonus:
            if (d instanceof Ruin) picture = ruin(d);
            else if (d instanceof Habitat) picture = { kind: 'habitat', habitat: d };
            num = 2;
            break;
        case T.FreeSuperShip:
            if (d instanceof Habitat) picture = landscape(d);
            else if (d instanceof Character) picture = { kind: 'character', character: d };
            else if (d instanceof BuiltObject) picture = ship(d); // TODO(port): method_116 unbuilt-component shading — Main.Part4.cs:684
            num = 2;
            break;
        case T.PirateFactionJoinsYou:
            picture = url(EVENT_CHROME.pirateFlag);
            num = 3;
            break;
        case T.TreasureFound:
            picture = url(EVENT_CHROME.money);
            num = 1;
            break;
        case T.LostColonyFound:
            if (d instanceof Habitat) picture = landscape(d);
            num = 2;
            break;
        case T.IndependentPopulation:
            // TODO(port): lnkEventMessageLink (the race's encyclopedia link) — Main.Part4.cs:711-716
            if (isRace(d)) picture = url(raceImageUrl(d.pictureIndex));
            num = 2;
            break;
        case T.GeneralRuinsDiscovery:
            if (d instanceof Ruin) picture = ruin(d);
            num = 1;
            break;
        case T.BuiltObjectExplodes:
            picture = url(messageImage('underAttack.png')); // bitmap_28[0]
            num = 1;
            break;
        case T.PirateAmbush:
            picture = url(EVENT_CHROME.pirateFlag);
            num = 1;
            break;
        case T.OriginsDiscovery:
        case T.StoryClue:
            // 751-771: bool_2 → method_508 hands over to method_571 (the story panel over storyEvent.jpg).
            if (d instanceof Habitat) picture = landscape(d);
            else if (d instanceof Ruin) picture = ruin(d);
            else if (d instanceof BuiltObject) picture = ship(d);
            panel = 'storyHistory';
            num = 2;
            break;
        case T.RestrictedResourceDiscovered: {
            const ref = resourcePictureRef(d, galaxy);
            if (ref !== null) picture = url(resourceImageUrl(ref));
            else if (d instanceof Habitat) picture = landscape(d);
            num = 2;
            break;
        }
        case T.RogueFleetDefectsFromUs:
        case T.EmpireSplits:
            if (d instanceof Empire) picture = { kind: 'flag', empire: d };
            num = 3;
            break;
        case T.UncoverPirateAttackFundingYourEmpire:
            picture = d instanceof EmpireActivity && d.requestingEmpire !== null ? { kind: 'flag', empire: d.requestingEmpire } : url(EVENT_CHROME.pirateFlag);
            num = 3;
            break;
        case T.UncoverKnownLocation:
            // 833-850: num = 3, then a debris field / restricted area goes on as AncientBattleDebrisField / SpecialArea.
            if (d instanceof GalaxyLocation) {
                num = 3;
                if (d.type === GalaxyLocationType.DebrisField) {
                    picture = debrisFieldPicture(galaxy, d);
                    num = 2;
                } else if (d.type === GalaxyLocationType.RestrictedArea) {
                    picture = url(messageImage('restrictedArea.png'));
                    num = 2;
                }
            }
            break;
        case T.SpecialArea:
            if (d instanceof GalaxyLocation) picture = url(messageImage('restrictedArea.png')); // bitmap_28[22]
            num = 2;
            break;
        case T.AncientBattleDebrisField:
            if (d instanceof GalaxyLocation && d.type === GalaxyLocationType.DebrisField) picture = debrisFieldPicture(galaxy, d);
            num = 2;
            break;
        case T.RareResourceIntercepted: {
            const ref = resourcePictureRef(d, galaxy);
            if (ref !== null) picture = url(resourceImageUrl(ref));
            num = 3;
            break;
        }
        case T.GeneralDiscovery: {
            const g = generalDiscoveryPicture(d, player, galaxy);
            picture = g.picture;
            if (g.story) panel = 'story';
            num = 1;
            if (d instanceof EventAction) num = 3; // 1078: `num = 3` after the EventAction switch
            break;
        }
        case T.DisasterEvent: {
            const f = typeof d === 'number' && d >= DisasterEventType.Earthquake ? DISASTER_FILES[d - 1] : undefined;
            if (f !== undefined) picture = url(`/assets/dwu/images/ui/events/${f}`);
            num = 3;
            break;
        }
        case T.ResourceAppearance:
        case T.ResourceDepletion:
            picture = resourceEventPicture(d, location, galaxy);
            num = 3;
            break;
        case T.RaceEvent:
            if (typeof d === 'number') picture = raceEventPicture(d as RaceEventType, player, galaxy);
            num = 3;
            break;
        case T.WonderBuilt:
            if (d instanceof PlanetaryFacility) picture = url(facilityImageUrl(d.def.pictureRef));
            num = 3;
            break;
        case T.PhantomPirates:
            if (d instanceof Empire) picture = d.dominantRace === null ? { kind: 'flag', empire: d } : { kind: 'flagRace', empire: d };
            num = 3;
            break;
        case T.CharacterEvent:
        case T.LeaderChange:
            if (d instanceof Character) picture = { kind: 'character', character: d };
            num = 3;
            break;
        default:
            break;
    }
    return { panel, picture, level: num };
}

/**
 * Main.Part4.cs:1314-1398 flag7: whether method_523 shows the panel. `suppressAllPopups` (GameOptions) hides all; an
 * abandoned-ship subject follows DiscoveryActionAbandonedShipBase (2 = never), everything else the popup level against
 * DiscoveryActionRuin (2 hides level 0, 3 hides levels 0-1, 4 hides all). The choice panels only check SuppressAllPopups
 * (509-554 / 1506-1510).
 */
export function eventPopupShown(p: EventPresentation, additionalData: unknown, player: Empire, suppressAllPopups: boolean): boolean {
    if (suppressAllPopups) return false;
    if (p.level === null) return true;
    const flag3 = player.discoveryActionAbandonedShipBase !== 2;
    const ruinSetting = player.discoveryActionRuin;
    const flag4 = !(ruinSetting === 2 || ruinSetting === 3 || ruinSetting === 4);
    const flag5 = !(ruinSetting === 3 || ruinSetting === 4);
    const flag6 = ruinSetting !== 4;
    if (additionalData instanceof BuiltObject) return flag3;
    switch (p.level) {
        case 0:
            return flag4;
        case 1:
            return flag5;
        default:
            return flag6;
    }
}

/** The Go to Event Location target (method_513 `flag`: object_2 = the event's location is one of these). */
export type EventGoToTarget =
    | { kind: 'stellar'; object: BuiltObject | Habitat }
    | { kind: 'creature'; creature: Creature }
    | { kind: 'point'; x: number; y: number };

/** btnEventMessageGoto_Click (Main.Part4.cs:1525-1555 → method_157 / method_156). */
export function eventGoToTarget(location: unknown): EventGoToTarget | null {
    if (location instanceof BuiltObject || location instanceof Habitat) return { kind: 'stellar', object: location };
    if (location instanceof Creature) return { kind: 'creature', creature: location };
    if (location instanceof Character) {
        // method_157(Character): the character's location.
        const at = location.location;
        if (at instanceof BuiltObject || at instanceof Habitat) return { kind: 'stellar', object: at };
        return null;
    }
    if (location !== null && typeof location === 'object' && !Array.isArray(location)) {
        const p = location as { x?: unknown; y?: unknown };
        if (typeof p.x === 'number' && typeof p.y === 'number' && Object.keys(location).length === 2) return { kind: 'point', x: p.x, y: p.y };
    }
    return null;
}
