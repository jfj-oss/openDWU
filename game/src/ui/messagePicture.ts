// The large picture of a message popup card: port of MessagePopup.cs SetUpMessageDisplay (the _MainImage switch,
// DistantWorlds.Controls/Controls/MessagePopup.cs 125-1000) and the card's text (_MessageDescription: "Sender: " +
// Description, the sender's flag faded to 50 % behind it). Pure: no DOM. messagePopups.ts draws the result.
//
// The original composes some pictures into new bitmaps; the descriptor names the parts and the DOM side stacks them:
//   ImprintFlag  (MessagePopup.cs 1032)  the sender's LargeFlagPicture at (65, 30) 100 × 60 over the message image
//   StripeBitmap (MessagePopup.cs 1046)  2 px transparent stripes every 10 px (a lost / failed / destroyed subject)
//   the research overlay (MessagePopup.cs 325-357)  a 170 × 134 bitmap: researchbreakthrough.png at (0, 0) 79 × 134,
//                the benefit's picture × 2.5 right-aligned, vertically centred
//   the empire picture (MessagePopup.cs 667-688)    a 170 × 60 bitmap: the flag (0, 0) 100 × 60, the race (110, 0) 60 × 60
// LimitImageSize(240, 180) then caps the result (CSS max-width / max-height on the card).

import { EmpireMessageType, type EmpireMessage } from '../sim/messages';
import { DiplomaticRelationType } from '../sim/diplomacy';
import { BuiltObject } from '../sim/builtObject';
import { Habitat } from '../sim/types';
import { Character } from '../sim/characters';
import { Empire } from '../sim/empire';
import { PlanetaryFacility } from '../sim/construction/facilities';
import { ResearchAbilityType, abilityTypeFromFile, type TechNode } from '../sim/researchSystem';
import { HabitatImageOffsetContinental, HabitatImageOffsetDesert, HabitatImageOffsetIce, HabitatImageOffsetMarshySwamp, HabitatImageOffsetOcean, HabitatImageOffsetVolcanic, habitatImageFile } from '../sim/galaxyImages';

const MSG = '/assets/dwu/images/ui/messages/';

// BaconMain.cs 2165 LoadUiMessages: the bitmap_28 (_MessageImages) index → file.
export const MESSAGE_IMAGE_FILES = [
    'underAttack.png', 'colonygain.png', 'colonyloss.png', 'declarewar.png', 'endwar.png', 'freetradeagreement.png',
    'mutualdefensepact.png', 'protectorate.png', 'researchbreakthrough.png', 'resumetrade.png', 'subjugateddominion.png',
    'tradesanctions.png', 'canceltreaty.png', 'treatyrefused.png', 'money.png', 'warning.png', 'construction.png',
    'request.png', 'agentsuccess.png', 'agentfailure.png', 'blockade.png', 'blockadecancelled.png', 'restrictedArea.png',
    'agentalert.png', 'explorationDiscovery.png', 'galacticHistory.png', 'information.png', 'pirateMessage.png',
    'planetdestroy.png', 'galacticnewsnet.png', 'construction_stalled.png',
] as const;

/** _MessageImages[i] as a URL. */
export function messageImageUrl(i: number): string {
    return MSG + MESSAGE_IMAGE_FILES[i];
}

/** Main.Part6.cs method_396 (1568-1573): habitatImageCache.ObtainImageSmall(HabitatImageOffset<Type>) — the first picture
 *  of Continental, MarshySwamp, Ocean, Desert, Ice, Volcanic. */
const HABITAT_TYPE_IMAGES: readonly string[] = [
    HabitatImageOffsetContinental,
    HabitatImageOffsetMarshySwamp,
    HabitatImageOffsetOcean,
    HabitatImageOffsetDesert,
    HabitatImageOffsetIce,
    HabitatImageOffsetVolcanic,
].map((ref) => `/assets/dwu/images/environment/${habitatImageFile(ref)}`);

const facilityUrl = (pictureRef: number): string => `/assets/dwu/images/environment/planetaryfacilities/facility_${pictureRef}.png`;
const componentUrl = (pictureRef: number): string => `/assets/dwu/images/ui/components/Component_${pictureRef}.bmp`;
const ruinUrl = (pictureRef: number): string => `/assets/dwu/images/environment/ruins/ruin_${pictureRef}.png`;
const raceUrl = (pictureIndex: number): string => `/assets/dwu/images/units/races/race_${pictureIndex}.png`;
const resourceUrl = (pictureRef: number): string => `/assets/dwu/images/ui/resources/Resource_${pictureRef}.bmp`;

/** What the card draws as its _MainImage (null: no picture, the text alone). */
export type MessagePicture =
    /** A plain image; `flag` = ImprintFlag with that empire's flag, `striped` = StripeBitmap. */
    | { kind: 'url'; url: string; flag: Empire | null; striped: boolean }
    /** The research overlay: researchbreakthrough.png + `url` × 2.5 (`tile`: a component .bmp, drawn opaque). */
    | { kind: 'research'; url: string; tile: boolean }
    /** builtObjectImageCache.ObtainImage (the ship / base picture). */
    | { kind: 'ship'; builtObject: BuiltObject }
    /** habitatImageCache.ObtainImage (the planet picture). */
    | { kind: 'habitat'; habitat: Habitat }
    /** Habitat.LandscapePictureRef (images/environment/landscapes/...). */
    | { kind: 'landscape'; ref: number; striped: boolean }
    /** characterImageCache.ObtainCharacterImage. */
    | { kind: 'character'; character: Character }
    /** The empire's LargeFlagPicture. */
    | { kind: 'flag'; empire: Empire }
    /** The 170 × 60 flag + race picture (EmpireDiscovered; striped for EmpireDefeated). */
    | { kind: 'empire'; empire: Empire; striped: boolean };

const img = (i: number, flag: Empire | null = null, striped = false): MessagePicture => ({ kind: 'url', url: messageImageUrl(i), flag, striped });

function isTechNode(v: unknown): v is TechNode {
    return v !== null && typeof v === 'object' && 'def' in v && 'isResearched' in v;
}

// MessagePopup.cs 163-257: the treaty images by the subject's DiplomaticRelationType.
function relationPicture(message: EmpireMessage, player: Empire, propose: boolean): MessagePicture | null {
    const subject = message.subject;
    const R = DiplomaticRelationType;
    const sender = message.sender;
    let i: number | null = null;
    switch (typeof subject === 'number' ? subject : R.NotMet) {
        case R.None: {
            const rel = sender === null ? null : player.diplomaticRelations?.byEmpire(sender) ?? null;
            if (rel === null) i = 12;
            else if (rel.type === R.TradeSanctions) i = 9;
            else if (rel.type === R.War) i = 4;
            else i = propose && message.description.toLowerCase().includes('trade') ? 9 : 12;
            break;
        }
        case R.FreeTradeAgreement:
            i = 5;
            break;
        case R.MutualDefensePact:
            i = 6;
            break;
        case R.SubjugatedDominion:
            i = 10;
            break;
        case R.Protectorate:
            i = 7;
            break;
        case R.TradeSanctions:
            i = 11;
            break;
        case R.War:
            i = 3;
            break;
    }
    return i === null ? null : img(i, sender);
}

// MessagePopup.cs 325-560: the research breakthrough picture (facility, else the overlay of the first benefit).
function researchPicture(node: TechNode, player: Empire): MessagePicture | null {
    const rs = player.research;
    const facility = rs?.planetaryFacilityOf?.(node) ?? null;
    if (facility !== null) return { kind: 'url', url: facilityUrl(facility.pictureRef), flag: null, striped: false };
    const def = node.def;
    const comp = def.components.length > 0 ? rs?.definitionFor(def.components[0]) : def.componentImprovements.length > 0 ? rs?.definitionFor(def.componentImprovements[0].componentId) : undefined;
    if (comp) return { kind: 'research', url: componentUrl(comp.pictureRef), tile: true };
    const a = def.abilities[0];
    if (a !== undefined) {
        const type = abilityTypeFromFile(a.type);
        if (type === ResearchAbilityType.Boarding) return { kind: 'url', url: componentUrl(115), flag: null, striped: false };
        if (type === ResearchAbilityType.ColonizeHabitatType || type === ResearchAbilityType.PopulationGrowthRate) {
            const url = HABITAT_TYPE_IMAGES[a.value - 1];
            if (url !== undefined) return { kind: 'research', url, tile: false };
        }
        // TODO(port): EnableShipSubRole (the new ship picture), Troop (the race's troop pictures), ConstructionSize
        // (bitmap_73) and Fighters (the rotated fighter / bomber) — MessagePopup.cs 360-560
    }
    return img(8);
}

/** Port of MessagePopup.cs SetUpMessageDisplay's _MainImage switch. */
export function messagePicture(message: EmpireMessage, player: Empire): MessagePicture | null {
    const T = EmpireMessageType;
    const subject = message.subject;
    const sender = message.sender;
    const ship = subject instanceof BuiltObject ? subject : null;
    const habitat = subject instanceof Habitat ? subject : null;
    const shipPic: MessagePicture | null = ship !== null ? { kind: 'ship', builtObject: ship } : null;
    const flagOfSender: MessagePicture | null = sender !== null ? { kind: 'flag', empire: sender } : null;
    switch (message.messageType) {
        case T.DiplomaticRelationChange:
        case T.AcceptDiplomaticRelation:
            return relationPicture(message, player, false);
        case T.ProposeDiplomaticRelation:
            return relationPicture(message, player, true);
        case T.RefuseDiplomaticRelation:
            return img(13);
        case T.RemoveColoniesFromSystem:
        case T.StopMissionsAgainstUs:
        case T.StopAttacks:
        case T.LeaveSystem:
        case T.RemoveForcesFromSystem:
            return img(15, sender);
        case T.RequestJointWar:
        case T.RequestJointTradeSanctions:
        case T.RequestStopWar:
        case T.RequestLiftTradeSanctions:
            return img(17, sender);
        case T.GiveGift:
            return img(14);
        case T.ShipBaseCompleted:
        case T.AdvisorSuggestion:
            return img(16);
        case T.NewColony:
            return habitat !== null && habitat.landscapePictureRef >= 0 ? { kind: 'landscape', ref: habitat.landscapePictureRef, striped: false } : null;
        case T.NewColonyFailed:
            return habitat !== null && habitat.landscapePictureRef >= 0 ? { kind: 'landscape', ref: habitat.landscapePictureRef, striped: true } : null;
        case T.ResearchBreakthrough:
        case T.ResearchCriticalBreakthrough:
        case T.ResearchCriticalFailure:
            if (isTechNode(subject)) return researchPicture(subject, player);
            return img(8);
        case T.BattleUnderAttack:
        case T.BattleAttacking:
        case T.IncomingEnemyFleet:
            return img(0);
        case T.CharacterAppearance:
        case T.CharacterSkillTraitChange:
            return subject instanceof Character ? { kind: 'character', character: subject } : img(18);
        case T.CharacterDeath:
            return subject instanceof Character ? { kind: 'character', character: subject } : img(19);
        case T.CharacterMissionAccomplished:
            return img(18);
        case T.CharacterMissionFailure:
            return img(19);
        case T.EmpireDiscovered:
            return subject instanceof Empire ? { kind: 'empire', empire: subject, striped: false } : null;
        case T.EmpireDefeated:
            return subject instanceof Empire ? { kind: 'empire', empire: subject, striped: true } : null;
        case T.ColonyGained:
            return img(1);
        case T.ColonyLost:
        case T.ColonyDefended:
        case T.ColonyRebelling:
        case T.Revolution:
            return img(2);
        case T.BlockadeInitiated:
            return img(20);
        case T.BlockadeCancelled:
            return img(21);
        case T.ExplorationRuins:
            return habitat?.ruin != null && habitat.ruin.pictureRef >= 0 ? { kind: 'url', url: ruinUrl(habitat.ruin.pictureRef), flag: null, striped: false } : null;
        case T.ExplorationBuiltObject:
            return shipPic;
        case T.ExplorationHabitat:
            return habitat?.ruin != null && habitat.ruin.pictureRef >= 0 ? { kind: 'url', url: ruinUrl(habitat.ruin.pictureRef), flag: null, striped: false } : img(24);
        case T.ExplorationLocation:
            return img(24);
        case T.GalacticHistory:
        case T.HistoryOfferLocationHint:
        case T.HistoryOfferStoryClue:
        case T.StoryMessage:
            return img(25);
        case T.RestrictedResourceDiscovered:
        case T.RestrictedResourceTradingAllowed:
        case T.RestrictedResourceTradingBlocked: {
            // TODO(port): the habitat's restricted resource / the sender's supplied super-luxuries — MessagePopup.cs 764-822
            const pic = resourcePictureRef(subject);
            return pic !== null ? { kind: 'url', url: resourceUrl(pic), flag: null, striped: false } : img(24);
        }
        case T.ShipMissionComplete:
        case T.ShipNeedsRefuelling:
        case T.ShipNeedsRepair:
        case T.ShipBaseBoardedCaptured:
        case T.ShipBaseBoardedLost:
        case T.PirateAttackMissionCompleted:
        case T.PirateSmugglerDetected:
        case T.ShipBaseScrapped:
        case T.ColonyShipMissionCancelled:
            return shipPic;
        case T.GeneralWarning:
            return img(15);
        case T.GeneralBadEvent:
            return habitat !== null ? { kind: 'habitat', habitat } : flagOfSender;
        case T.GeneralNeutralEvent:
            if (isRace(subject)) return { kind: 'url', url: raceUrl(subject.pictureIndex), flag: null, striped: false };
            return flagOfSender;
        case T.GeneralGoodEvent:
            return shipPic ?? flagOfSender;
        case T.GeneralDecision:
            return flagOfSender;
        case T.ColonyFacilityCompleted:
        case T.ColonyFacilityCancelled:
        case T.ColonyWonderBegun:
        case T.PlanetaryFacilityDestroyed:
        case T.PlanetaryFacilityDamaged: {
            const striped = message.messageType === T.ColonyFacilityCancelled || message.messageType === T.PlanetaryFacilityDestroyed;
            if (habitat !== null) {
                // The newest completed facility (MessagePopup.cs 868-884; no stripes on this path).
                const fs = habitat.facilities ?? [];
                for (let i = fs.length - 1; i >= 0; i--) {
                    const f = fs[i];
                    if (f != null && f.constructionProgress >= 1) return { kind: 'url', url: facilityUrl(f.def.pictureRef), flag: null, striped: false };
                }
                return null;
            }
            if (subject instanceof PlanetaryFacility) return { kind: 'url', url: facilityUrl(subject.def.pictureRef), flag: null, striped };
            const ref = facilityDefinitionPictureRef(subject);
            return ref !== null ? { kind: 'url', url: facilityUrl(ref), flag: null, striped } : null;
        }
        case T.ColonyDestroyed:
            return img(28);
        case T.GalacticNewsNet:
            return img(29);
        case T.PirateAttackMissionAvailable:
        case T.PirateDefendMissionAvailable:
        case T.PirateSmugglingMissionAvailable:
            return img(14);
        case T.PirateAttackMissionFailed:
        case T.PirateDefendMissionFailed:
        case T.RaidBonuses:
        case T.RaidVictim:
            return img(27);
        case T.PirateDefendMissionCompleted:
        case T.PirateSmugglingMissionCompleted:
            return shipPic ?? (habitat !== null ? { kind: 'habitat', habitat } : null);
        case T.ConstructionResourceShortage:
            return img(30);
        // TODO(port): MilitaryRefueling* / MiningRights* (bitmap_55 / bitmap_81, the refuel / mining chrome) — MessagePopup.cs 964-971
        default:
            return null;
    }
}

function isRace(v: unknown): v is { pictureIndex: number; name: string } {
    return v !== null && typeof v === 'object' && typeof (v as { pictureIndex?: unknown }).pictureIndex === 'number' && !(v instanceof Character);
}

function resourcePictureRef(v: unknown): number | null {
    if (v === null || typeof v !== 'object' || v instanceof Habitat) return null;
    const r = v as { pictureRef?: unknown; resourceId?: unknown };
    return typeof r.pictureRef === 'number' && typeof r.resourceId === 'number' ? r.pictureRef : null;
}

function facilityDefinitionPictureRef(v: unknown): number | null {
    if (v === null || typeof v !== 'object') return null;
    const r = v as { pictureRef?: unknown; facilityId?: unknown };
    return typeof r.pictureRef === 'number' && r.facilityId !== undefined ? r.pictureRef : null;
}

/** _MessageDescription: "<sender>: " (not for GalacticNewsNet or the player's own messages) + Description. */
export function messageCardText(message: EmpireMessage, player: Empire, description: string): string {
    const sender = message.sender;
    if (sender !== null && sender !== player && message.messageType !== EmpireMessageType.GalacticNewsNet) return `${sender.name}: ${description}`;
    return description;
}

/** The faded sender flag behind the card's text (MessagePopup.cs 141-146: any sender other than the player). */
export function messageCardFlagEmpire(message: EmpireMessage, player: Empire): Empire | null {
    return message.sender !== null && message.sender !== player ? message.sender : null;
}
