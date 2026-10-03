// Character event texts for the character event history (CharacterEventView.cs): Galaxy.2.cs ResolveDescription
// (CharacterEvent, Empire, out title), its helpers, and CharacterEventList.ObtainPublicEvents + the view's
// `Sort(); Reverse();` ordering. Pure: no DOM imports (test/characterEventText.test.ts).

import { BuiltObject } from '../../sim/builtObject';
import { BuiltObjectSubRole } from '../../sim/builtObjectTypes';
import { Habitat } from '../../sim/types';
import { Creature } from '../../sim/creature';
import { Empire, empireGovernmentAttributes } from '../../sim/empire';
import type { ShipGroup } from '../../sim/fleets/shipGroup';
import type { TechNode } from '../../sim/researchSystem';
import { PlanetaryFacilityType } from '../../sim/researchSystem';
import { BuiltObjectRole } from '../../sim/data/designSpecifications';
import { DiplomaticRelation, DiplomaticRelationType } from '../../sim/diplomacy';
import { Troop } from '../../sim/cargo';
import { SpaceBattleStats } from '../../sim/combat/damage';
import { InvasionStats } from '../../sim/combat/invasion';
import { PlanetaryFacility } from '../../sim/construction/facilities';
import {
    Character,
    CharacterEvent,
    CharacterEventType,
    CharacterRole,
    CharacterSkill,
    CharacterSkillType,
    CharacterTraitType,
    IntelligenceMission,
} from '../../sim/characters';
import { determineCharacterEventIsPublic } from '../../sim/characterRuntime';
import {
    IntelligenceMissionOutcome,
    IntelligenceMissionType,
    characterMission,
    resolveIntelligenceMissionDescription,
} from '../../sim/espionage';
import {
    BUILT_OBJECT_SUB_ROLE,
    CHARACTER_ROLE,
    CHARACTER_SKILL,
    CHARACTER_TRAIT,
    DIPLOMATIC_RELATION,
    resolveEnumTextDescription,
} from '../../sim/enumText';
import { formatNet, getText, isTextLoaded } from '../../sim/textResolver';

const ET = CharacterEventType;

/** TextResolver.GetText(tag) formatted with args (string.Format); the tag itself when no table is loaded. */
function T(tag: string, ...args: unknown[]): string {
    const template = isTextLoaded() ? getText(tag) : tag;
    return args.length > 0 ? formatNet(template, args) : template;
}

// ---------------------------------------------------------------------------------------------------------------
// Galaxy.*.cs ResolveDescription(<enum>) helpers
// ---------------------------------------------------------------------------------------------------------------

function subRoleText(subRole: BuiltObjectSubRole): string {
    return resolveEnumTextDescription(BUILT_OBJECT_SUB_ROLE, BuiltObjectSubRole[subRole]);
}
function roleText(role: CharacterRole): string {
    return resolveEnumTextDescription(CHARACTER_ROLE, CharacterRole[role]);
}
function traitText(trait: CharacterTraitType): string {
    return resolveEnumTextDescription(CHARACTER_TRAIT, CharacterTraitType[trait]);
}
function skillText(skill: CharacterSkillType): string {
    return resolveEnumTextDescription(CHARACTER_SKILL, CharacterSkillType[skill]);
}
function diplomaticRelationText(type: DiplomaticRelationType): string {
    return resolveEnumTextDescription(DIPLOMATIC_RELATION, DiplomaticRelationType[type]);
}

/** Galaxy.1.cs:5732 ResolveDescription(CharacterEventType). */
export function resolveCharacterEventTypeDescription(eventType: CharacterEventType): string {
    switch (eventType) {
        case ET.BuildMilitaryShip:
        case ET.BuildCivilianShip:
        case ET.BuildColonyShip:
            return T('Character Event Ship Built');
        case ET.BuildFacility:
            return T('Character Event Facility Built');
        case ET.BuildMilitaryBase:
        case ET.BuildResearchStationWeapons:
        case ET.BuildResearchStationEnergy:
        case ET.BuildResearchStationHighTech:
        case ET.BuildMiningStation:
        case ET.BuildResortBase:
        case ET.BuildOtherBase:
            return T('Character Event Base Built');
        case ET.BuildSpaceport:
            return T('Character Event Spaceport Built');
        case ET.BuildWonder:
            return T('Character Event Wonder Built');
        case ET.CashNegative:
            return T('Character Event Cash Negative');
        case ET.CashPositive:
            return T('Character Event Cash Positive');
        case ET.GroundInvasion:
            return T('Character Event Ground Invasion');
        case ET.IntelligenceAgentOursCaptured:
            return T('Character Event Intelligence Agent Captured');
        case ET.IntelligenceAgentRecruited:
            return T('Character Event Intelligence Agent Recruited');
        case ET.IntelligenceMissionFailEspionage:
        case ET.IntelligenceMissionFailSabotage:
            return T('Character Event Intelligence Mission Failed');
        case ET.IntelligenceMissionInterceptEnemy:
            return T('Character Event Intelligence Agent Intercepted');
        case ET.IntelligenceMissionSucceedEspionage:
        case ET.IntelligenceMissionSucceedSabotage:
            return T('Character Event Intelligence Mission Succeeded');
        case ET.CriticalResearchFailure:
            return T('Character Event Research Critical Failure');
        case ET.CriticalResearchSuccess:
            return T('Character Event Research Critical Success');
        case ET.CharacterStart:
            return T('Character Event Start');
        case ET.CharacterTransferLocation:
            return T('Character Event Transfer Location');
        case ET.CharacterTraitGain:
            return T('Character Event Trait Gain');
        case ET.CharacterSkillGain:
            return T('Character Event Skill Gain');
        case ET.CharacterSkillProgress:
            return T('Character Event Skill Progress');
        case ET.ResearchAdvanceWeapons:
        case ET.ResearchAdvanceEnergy:
        case ET.ResearchAdvanceHighTech:
            return T('Character Event Research Breakthrough');
        case ET.SpaceBattle:
            return T('Character Event Space Battle');
        case ET.TourismIncome:
            return T('Character Event Tourism Income');
        case ET.TradeIncome:
            return T('Character Event Trade Income');
        case ET.TreatySigned:
            return T('Character Event Treaty Signed');
        case ET.TroopComplete:
            return T('Character Event Troop Complete');
        case ET.WarEnded:
            return T('Character Event War Ended');
        case ET.WarStarted:
            return T('Character Event War Started');
        case ET.TargetOfFailedAssassination:
            return T('Character Event Target Of Failed Assassination');
        case ET.Subjugated:
            return T('Character Event Subjugated');
        case ET.TreatyBroken:
            return T('Character Event Treaty Broken');
        case ET.AmbassadorAssignedToEmpire:
            return T('Character Event Ambassador Assigned To Empire');
        case ET.Boarding:
            return T('Character Event Boarding');
        case ET.Raid:
            return T('Character Event Raid');
        case ET.SmugglingSuccess:
            return T('Character Event Smuggling Success');
        case ET.SmugglingDetection:
            return T('Character Event Smuggling Detection');
        default:
            return '';
    }
}

/** Galaxy.2.cs:692 ResolveDescriptionFull(IntelligenceMission, callingEmpire). */
export function resolveIntelligenceMissionDescriptionFull(mission: IntelligenceMission | null, callingEmpire: Empire | null): string {
    let result = '';
    if (mission !== null) {
        // C# dereferences agent / agent.Empire unguarded (NullReferenceException); '' here.
        const agent = mission.agent;
        const agentName = agent?.name ?? '';
        const agentEmpireName = agent?.empire?.name ?? '';
        const desc = (): string => resolveIntelligenceMissionDescription(mission, callingEmpire);
        const ours = callingEmpire !== mission.targetEmpire;
        switch (mission.outcome as IntelligenceMissionOutcome) {
            case IntelligenceMissionOutcome.Capture:
                result = ours ? T('Our Agent Captured In Act', agentName, desc()) : T('Enemy Agent Captured In Act', agentName, agentEmpireName, desc());
                break;
            case IntelligenceMissionOutcome.FailDetect:
                result = ours ? T('Our Agent Detect Fail', agentName, desc()) : T('Enemy Agent Detect Fail', agentName, agentEmpireName, desc());
                break;
            case IntelligenceMissionOutcome.SucceedDetect:
                result = ours ? T('Our Agent Detect Succeed', agentName, desc()) : T('Enemy Agent Detect Succeed', agentName, agentEmpireName, desc());
                break;
            case IntelligenceMissionOutcome.FailNotDetect:
                result = ours ? T('Our Agent Fail', agentName, desc()) : T('Enemy Agent Fail', agentName, agentEmpireName, desc());
                break;
            case IntelligenceMissionOutcome.SucceedNotDetect:
                if (ours) {
                    result = T('Our Agent Succeed', agentName, desc());
                } else {
                    const agentMission = agent !== null ? characterMission(agent) : null;
                    if (agentMission === null || agentMission.type !== IntelligenceMissionType.InciteRevolution) {
                        result = T('Enemy Agent Succeed', agentName, agentEmpireName, desc());
                    } else {
                        const ga = mission.targetEmpire !== null ? empireGovernmentAttributes(mission.targetEmpire) : null;
                        result = T('Agent Revolution', ga?.name ?? '');
                    }
                }
                break;
        }
    }
    return result;
}

/** BaconGalaxy.cs:364 ResolveDescription(CharacterEvent, out title): the TradeIncome text, or a "spyMessage" pair. */
function resolveBaconDescription(ev: CharacterEvent): { title: string; text: string } {
    let str = '';
    let title = '';
    if (ev.eventData instanceof Map) {
        const eventData = ev.eventData as Map<string, unknown>;
        if (eventData.has('spyMessage')) {
            const stringList = eventData.get('spyMessage') as string[];
            title = stringList[0];
            str = stringList[1];
        }
    } else {
        str = T('Character Event Description Trade Income');
    }
    return { title, text: str };
}

// ---------------------------------------------------------------------------------------------------------------
// C# `is` tests
// ---------------------------------------------------------------------------------------------------------------

type StellarObjectLike = BuiltObject | Habitat | Creature;
function isStellarObject(o: unknown): o is StellarObjectLike {
    return o instanceof BuiltObject || o instanceof Habitat || o instanceof Creature;
}
/** ResearchNode: researchSystem.ts TechNode is an interface — structural test. */
function isResearchNode(o: unknown): o is TechNode {
    return typeof o === 'object' && o !== null && 'def' in o && 'isResearched' in o && 'progress' in o && 'parentNodes' in o;
}
/** CharacterTraitType is a boxed enum in C#: a number here. */
function isTraitType(o: unknown): o is CharacterTraitType {
    return typeof o === 'number';
}

/** The "subrole name (fleet)" location text of CharacterStart / CharacterTransferLocation. */
function locationText(stellarObject: StellarObjectLike): string {
    let text = stellarObject.name;
    if (stellarObject instanceof BuiltObject && stellarObject.role !== BuiltObjectRole.Base) {
        text = subRoleText(stellarObject.subRole) + ' ' + stellarObject.name;
        const shipGroup = stellarObject.shipGroup as ShipGroup | null;
        if (shipGroup != null) text = text + ' (' + (shipGroup.name ?? '') + ')';
    }
    return text;
}

/** .NET int.ToString("###,###,##0") (invariant/en-US group separator). */
function formatThousands(n: number): string {
    const s = String(Math.abs(Math.trunc(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return n < 0 ? '-' + s : s;
}
/** .NET double.ToString("0%"): value * 100 rounded away from zero, then "%". */
function formatPercent(x: number): string {
    const v = x * 100;
    return String(Math.sign(v) * Math.round(Math.abs(v))) + '%';
}

// Port of Galaxy.2.cs ResolveDescription(CharacterEvent, Empire, out string title)
export function resolveCharacterEventDescription(ev: CharacterEvent, callingEmpire: Empire | null): { title: string; text: string } {
    let title = '';
    let text = '';
    if (ev == null) return { title, text };
    const data = ev.eventData;
    switch (ev.type) {
        case ET.Boarding:
            if (data instanceof BuiltObject) {
                title = T('Character Event Title Boarding', data.name);
                text = T('Character Event Description Boarding', data.name);
            }
            break;
        case ET.Raid:
            if (data == null) break;
            if (data instanceof Habitat) {
                title = T('Character Event Title Raid', data.name);
                text = T('Character Event Description Raid', data.name);
            } else if (data instanceof BuiltObject) {
                title = T('Character Event Title Raid', data.name);
                text = T('Character Event Description Raid', data.name);
            }
            break;
        case ET.SmugglingSuccess:
            if (isStellarObject(data)) {
                title = T('Character Event Title Smuggling Success', data.name);
                text = T('Character Event Description Smuggling Success', data.name);
            }
            break;
        case ET.SmugglingDetection:
            if (isStellarObject(data)) {
                title = T('Character Event Title Smuggling Detection', data.name);
                text = T('Character Event Description Smuggling Detection', data.name);
            }
            break;
        case ET.CriticalResearchFailure:
            if (isResearchNode(data)) text = T('Character Event Description Critical Research Failure', data.def.name);
            break;
        case ET.CriticalResearchSuccess:
            if (isResearchNode(data)) text = T('Character Event Description Critical Research Success', data.def.name);
            break;
        case ET.Subjugated:
            if (data instanceof Empire) {
                title = T('Character Event Title Subjugated', data.name);
                text = T('Character Event Description Subjugated', data.name);
            }
            break;
        case ET.TreatyBroken:
            if (data instanceof Empire) {
                title = T('Character Event Title Treaty Broken', data.name);
                text = T('Character Event Description Treaty Broken', data.name);
            }
            break;
        case ET.AmbassadorAssignedToEmpire:
            if (data instanceof Empire) {
                title = T('Character Event Title Ambassador Assigned To Empire', data.name);
                text = T('Character Event Description Ambassador Assigned To Empire', data.name);
            }
            break;
        case ET.TargetOfFailedAssassination:
            text = T('Character Event Description Target Of Failed Assassination');
            break;
        case ET.BuildMilitaryShip:
        case ET.BuildCivilianShip:
        case ET.BuildColonyShip:
            if (data instanceof BuiltObject) {
                title = T('Character Event Title ShipBase Built', subRoleText(data.subRole));
                text = T('Character Event Description Build Ship', subRoleText(data.subRole), data.name);
            }
            break;
        case ET.BuildMilitaryBase:
        case ET.BuildResearchStationWeapons:
        case ET.BuildResearchStationEnergy:
        case ET.BuildResearchStationHighTech:
        case ET.BuildMiningStation:
        case ET.BuildResortBase:
        case ET.BuildOtherBase:
            if (data instanceof BuiltObject) {
                title = T('Character Event Title ShipBase Built', subRoleText(data.subRole));
                text = T('Character Event Description Build Base', subRoleText(data.subRole), data.name);
            }
            break;
        case ET.BuildSpaceport:
            if (data instanceof BuiltObject) {
                title = T('Character Event Title ShipBase Built', data.name);
                text = T('Character Event Description Build Spaceport', subRoleText(data.subRole), data.name);
            }
            break;
        case ET.CashNegative:
            text = T('Character Event Description Cash Negative');
            break;
        case ET.CashPositive:
            text = T('Character Event Description Cash Positive');
            break;
        case ET.ColonyDevelopmentIncrease:
        case ET.ColonyDevelopmentDecrease:
            if (data instanceof Habitat) text = T('Character Event Description Colony Development Change', data.name);
            break;
        case ET.HyperjumpExit:
            if (data instanceof BuiltObject) text = T('Character Event Description Hyperjump Exit', subRoleText(data.subRole), data.name);
            break;
        case ET.IntelligenceAgentRecruited:
            if (data instanceof Character) text = T('Character Event Description Intelligence Agent Recruited', data.name);
            break;
        case ET.CharacterTransferLocation:
        case ET.CharacterStart: {
            if (!Array.isArray(data) || data.length !== 2) break;
            const character = data[0] instanceof Character ? data[0] : null;
            let locText = '';
            const stellarObject = isStellarObject(data[1]) ? data[1] : null;
            if (stellarObject !== null) locText = locationText(stellarObject);
            if (character !== null && stellarObject !== null) {
                text =
                    ev.type === ET.CharacterStart
                        ? T('Character Event Description Start', roleText(character.role), character.name, locText)
                        : T('Character Event Description Transfer Location', character.name, locText);
            }
            break;
        }
        case ET.CharacterTraitGain:
            if (isTraitType(data) && data !== 0) text = T('Character Event Description Trait Gain', traitText(data));
            break;
        case ET.CharacterSkillGain:
            if (data instanceof CharacterSkill) text = T('Character Event Description Skill Gain', skillText(data.type));
            break;
        case ET.CharacterSkillProgress:
            if (data instanceof CharacterSkill) text = T('Character Event Description Skill Progress', skillText(data.type));
            break;
        case ET.ResearchAdvanceWeapons:
        case ET.ResearchAdvanceEnergy:
        case ET.ResearchAdvanceHighTech:
            if (isResearchNode(data)) {
                title = T('Character Event Title Research Breakthrough', data.def.name);
                text = T('Character Event Description Research Advance', data.def.name);
            }
            break;
        case ET.TourismIncome:
            text = T('Character Event Description Tourism Income');
            break;
        case ET.TradeIncome: {
            const r = resolveBaconDescription(ev);
            text = r.text;
            title = r.title;
            break;
        }
        case ET.TreatySigned:
            if (data instanceof DiplomaticRelation) {
                // C# dereferences OtherEmpire unguarded.
                const otherName = data.otherEmpire?.name ?? '';
                title = T('Character Event Title Treaty Signed', otherName);
                text = T('Character Event Description Treaty Signed', diplomaticRelationText(data.type), otherName);
            }
            break;
        case ET.TroopComplete:
            if (data instanceof Troop) text = T('Character Event Description Troop Complete', data.name);
            break;
        case ET.WarEnded:
            if (data instanceof Empire) {
                title = T('Character Event Title War Ended', data.name);
                text = T('Character Event Description War Ended', data.name);
            }
            break;
        case ET.WarStarted:
            if (data instanceof Empire) {
                title = T('Character Event Title War Started', data.name);
                text = T('Character Event Description War Started', data.name);
            }
            break;
        case ET.SpaceBattle: {
            if (!(data instanceof SpaceBattleStats)) break;
            const s = data;
            const num = s.destroyedEnemyShipBaseSize + s.destroyedEnemyShipBaseSizeByFighters;
            const num2 =
                s.destroyedEnemyShipsEscort + s.destroyedEnemyShipsFrigate + s.destroyedEnemyShipsDestroyer + s.destroyedEnemyShipsCruiser +
                s.destroyedEnemyShipsCapitalShip + s.destroyedEnemyShipsCarrier + s.destroyedEnemyShipsTroopTransport + s.destroyedEnemyShipsResupplyShip +
                s.destroyedEnemyShipsDefensiveBase + s.destroyedEnemyShipsOtherBase + s.destroyedEnemyShipsOtherShips + s.destroyedEnemyShipsSpaceport;
            const num3 = s.destroyedEnemyShipBaseSizeByFighters / (1.0 + num);
            const num4 = s.destroyedFriendlyShipBaseSize + s.destroyedFriendlyShipBaseSizeByFighters;
            const num5 =
                s.destroyedFriendlyShipsEscort + s.destroyedFriendlyShipsFrigate + s.destroyedFriendlyShipsDestroyer + s.destroyedFriendlyShipsCruiser +
                s.destroyedFriendlyShipsCapitalShip + s.destroyedFriendlyShipsCarrier + s.destroyedFriendlyShipsTroopTransport +
                s.destroyedFriendlyShipsResupplyShip + s.destroyedFriendlyShipsDefensiveBase + s.destroyedFriendlyShipsOtherBase +
                s.destroyedFriendlyShipsOtherShips + s.destroyedFriendlyShipsSpaceport;
            const num6 = s.destroyedFriendlyShipBaseSizeByFighters / (1.0 + num4);
            const num7 = num + num4;
            if (s.location !== null) {
                if (num7 > 800) {
                    title = s.nearLocation ? T('Space Battle Title', s.location.name) : T('Space Battle Title Nearby', s.location.name);
                } else {
                    title = s.nearLocation ? T('Space Skirmish Title', s.location.name) : T('Space Skirmish Title Nearby', s.location.name);
                }
            }
            text += T('Space Battle Stats Destroyed Tonnage', String(num2), formatThousands(num), formatPercent(num3), String(num5), formatThousands(num4), formatPercent(num6));
            text += '\n\n';
            const losses = (side: 'Enemy' | 'Friendly', baseSize: number): string => {
                const g = (k: string): number => (s as unknown as Record<string, number>)[`destroyed${side}${k}`];
                const fighters = g('Fighters');
                let t = '';
                if (baseSize <= 0 && fighters <= 0) t = T('None');
                const add = (count: number, label: string): void => {
                    if (count > 0) t = t + String(count) + ' x ' + label + ', ';
                };
                add(g('ShipsEscort'), subRoleText(BuiltObjectSubRole.Escort));
                add(g('ShipsFrigate'), subRoleText(BuiltObjectSubRole.Frigate));
                add(g('ShipsDestroyer'), subRoleText(BuiltObjectSubRole.Destroyer));
                add(g('ShipsCruiser'), subRoleText(BuiltObjectSubRole.Cruiser));
                add(g('ShipsCapitalShip'), subRoleText(BuiltObjectSubRole.CapitalShip));
                add(g('ShipsCarrier'), subRoleText(BuiltObjectSubRole.Carrier));
                add(g('ShipsTroopTransport'), subRoleText(BuiltObjectSubRole.TroopTransport));
                add(fighters, T('Fighters'));
                add(g('ShipsResupplyShip'), subRoleText(BuiltObjectSubRole.ResupplyShip));
                add(g('ShipsSpaceport'), T('Space Port'));
                add(g('ShipsDefensiveBase'), subRoleText(BuiltObjectSubRole.DefensiveBase));
                add(g('ShipsOtherBase'), T('Other Bases'));
                add(g('ShipsOtherShips'), T('Other Ships'));
                if ((baseSize > 0 || fighters > 0) && t.length >= 2) t = t.substring(0, t.length - 2);
                return t;
            };
            const text4 = losses('Enemy', num);
            if (text4 !== '') {
                text += T('Space Battle Enemy Losses', text4);
                text += '\n\n';
            }
            const text9 = losses('Friendly', num4);
            if (text9 !== '') {
                text += T('Space Battle Friendly Losses', text9);
                text += '\n\n';
            }
            break;
        }
        case ET.GroundInvasion: {
            if (!(data instanceof InvasionStats)) break;
            const inv = data;
            if (inv.colony !== null) {
                const colonyName = inv.colony.name;
                title = T('Colony Invasion Title', colonyName);
                if (inv.defendingEmpire === callingEmpire) title = T('Colony Defense Title', colonyName);
                if (inv.defendingEmpire === callingEmpire) {
                    text += inv.invasionSucceeded ? T('Colony Defense Failed', colonyName) : T('Colony Defense Succeeded', colonyName);
                } else {
                    text += inv.invasionSucceeded ? T('Colony Invasion Succeeded', colonyName) : T('Colony Invasion Failed', colonyName);
                }
                text += '\n\n';
            }
            text += T('Colony Invasion Troop Losses', String(inv.destroyedDefendingTroops), String(inv.destroyedInvadingTroops));
            break;
        }
        case ET.IntelligenceAgentOursCaptured:
            // espionagePrisoners.ts addEventToCharacter stores a "spyMessage" Map here: not a Character, so the C#
            // shows only the type title and an empty text (ported as is).
            if (data instanceof Character) {
                title = T('Character Event Title Intelligence Agent Captured', data.name);
                text += resolveIntelligenceMissionDescriptionFull(characterMission(data), callingEmpire);
            }
            break;
        case ET.IntelligenceMissionInterceptEnemy:
            if (data instanceof Character) text += T('Enemy Agent Captured Generic', data.name);
            break;
        case ET.IntelligenceMissionSucceedEspionage:
        case ET.IntelligenceMissionSucceedSabotage:
        case ET.IntelligenceMissionFailEspionage:
        case ET.IntelligenceMissionFailSabotage:
            if (data instanceof IntelligenceMission) text += resolveIntelligenceMissionDescriptionFull(data, callingEmpire);
            break;
        case ET.BuildFacility:
        case ET.BuildWonder: {
            if (!(data instanceof PlanetaryFacility)) break;
            let arg = '';
            // HabitatList.FindColonyWithFacility (C# NullReferenceException on a null callingEmpire; '' here).
            if (callingEmpire !== null) {
                const habitat = callingEmpire.colonies.find((h) => h != null && !h.hasBeenDestroyed && h.facilities != null && h.facilities.includes(data));
                if (habitat !== undefined) arg = habitat.name;
            }
            if (data.type === PlanetaryFacilityType.Wonder) {
                title = T('Wonder Build Title', data.name);
                text += T('Wonder Built', data.name, arg);
            } else {
                title = T('Character Event Title Facility Built', data.name);
                text += T('Facility Built', data.name, arg);
            }
            break;
        }
    }
    if (title === '' || title == null) title = resolveCharacterEventTypeDescription(ev.type);
    return { title, text };
}

/**
 * CharacterEventList.ObtainPublicEvents (Galaxy.DetermineCharacterEventIsPublic filter), then CharacterEventView
 * BindData's `Sort(); Reverse();` (CharacterEvent.CompareTo: StarDate) — newest first. A new array; the character's
 * eventHistory is left untouched. (.NET List.Sort is unstable; a stable sort is used here.)
 */
export function characterPublicEvents(c: Character): CharacterEvent[] {
    const list = c.eventHistory.filter((e) => e != null && determineCharacterEventIsPublic(e.type));
    list.sort((a, b) => (a.starDate < b.starDate ? -1 : a.starDate > b.starDate ? 1 : 0));
    list.reverse();
    return list;
}
