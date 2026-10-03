// Intelligence Agents screen (F4 / tbtnIntelligenceAgents). In DW:U 1.9.5 this button opens the Characters
// panel (Main.Part6.cs:3231 tbtnIntelligenceAgents_Click → method_424 → method_425(character, PlayerEmpire, false)):
//   - lblCharacterSummary: Galaxy.ResolveCharacterSummary(empire) (Galaxy.2.cs:3512);
//   - ctlIntelligenceAgents (CharacterListView.cs BindData): every character of the empire — Name, Role, Location,
//     Mission (Galaxy.2.cs:5240 ResolveDescriptionCharacterTask);
//   - ctlCharacterSummary (CharacterSummary.cs / CharacterSkillsTraitsProgress.cs): role, task, traits and skills;
//   - pnlCharacterMission (CharacterMission.cs): the mission form, shown only for an IntelligenceAgent;
//   - btnIntelligenceAgentsDisband ("Dismiss", Main.Part6.cs:3351).
// btnIntelligenceAgentsRecruit is hidden by method_425 (Main.Part6.cs:3200 `Visible = false`), so there is no
// recruit button here either (agents appear through Empire.CheckForCharacterAppearance, characterRuntime.ts).
//
//   - btnCharacterShowEventHistory → pnlCharacterEventHistory (Main.Part2.cs:3478 method_662, CharacterEventListView);
//   - CharacterSummary "Transfer to new location" (SetupTransferControls / btnTransfer_Click).
// The window is the shared original-style ScreenPanel (originalWindow.ts) at the original's 1020 × 770 and control
// rects. Our extra: lblCharacterSummary's "n Role" entries are role-filter toggles with the characterRole_* icons.
//
// Pure logic (rows, texts, the mission form state machine, GetState, the difficulty texts, pictures, transfer
// destinations, role filter) is exported and tested (test/intelligence.test.ts); the DOM half only wires it.

import { blameOptions, missionFrameLabel, type BlameOption } from '../../sim/scenario/emergent/espionageView';
import { missionFrame } from '../../sim/scenario/emergent/espionage';
import './intelligence.css';
import {
    COLORS,
    FONT,
    OwGrid,
    chromeImageUrl,
    dropDown,
    dropText,
    el,
    glassButton,
    gradientPanel,
    linkLabel,
    messageBox,
    openOriginalWindow,
    place,
    scrollPanel,
    setText,
    text,
    type GridColumn,
    type OriginalWindow,
} from '../originalWindow';
import { characterPortrait, characterPortraitUrl } from '../characterPortrait';
import { openGalactopedia } from './galactopedia';
import { characterPublicEvents, resolveCharacterEventDescription } from './characterEventText';
import { compareShipGroups, shipGroupDetermineStrongestTroopTransport } from '../../sim/fleets/shipGroupTasks';
import { netSort } from '../../sim/netSort';
import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import type { Habitat } from '../../sim/types';
import type { TechNode } from '../../sim/researchSystem';
import type { ShipGroup } from '../../sim/fleets/shipGroup';
import { BuiltObject } from '../../sim/builtObject';
import { Habitat as HabitatClass } from '../../sim/types';
import { BuiltObjectRole } from '../../sim/data/designSpecifications';
import {
    Character,
    CharacterEvent,
    CharacterRole,
    CharacterSkillType,
    CharacterTraitType,
    IntelligenceMission,
    determineEffectsOfCharacterTrait,
    getEmpireCharacters,
    type StellarObject,
} from '../../sim/characters';
import {
    IntelligenceMissionOutcome,
    IntelligenceMissionType,
    calculateIntelligenceMissionSuccessChance,
    characterMission,
    newIntelligenceMissionAgainstBuiltObject,
    newIntelligenceMissionAgainstCharacter,
    newIntelligenceMissionAgainstEmpire,
    newIntelligenceMissionAgainstHabitat,
    newIntelligenceMissionStealTechData,
    resolveIntelligenceMissionDescription,
    resolveKnownBases,
    resolveKnownCharacters,
    resolveKnownColonies,
    resolveKnownConstructionYards,
    resolveMoreAdvancedProjectsIncludeSpecial,
} from '../../sim/espionage';
import { DiplomaticRelationType } from '../../sim/diplomacy';
import { PirateRelationType } from '../../sim/pirateRelations';
import { galaxyCurrentStarDate } from '../../sim/pirateRelations';
import { checkAtWarWithEmpire } from '../../sim/fleets/shipGroupTasks';
import { resolveStarDateDescription } from '../../sim/galaxyTime';
import { REAL_SECONDS_IN_GALACTIC_YEAR } from '../../sim/tick/simTime';
import { AutomationLevel } from '../../sim/empire';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import { CHARACTER_ROLE, CHARACTER_SKILL, CHARACTER_TRAIT, INTELLIGENCE_MISSION, resolveEnumTextDescription } from '../../sim/enumText';
import { formatNet, getText, isTextLoaded, resolveGameText } from '../../sim/textResolver';
import { politicsDetail, politicsRowCells, politicsVisible } from '../emergentPolitics'; // [emergent]
import { courtDetail } from '../courtView'; // [court]
import type { SeatName } from '../../sim/scenario/court/court'; // [court]
import { investigatorOptions, leadRows, securityVisible } from '../internalSecurityView'; // [security]

const MT = IntelligenceMissionType;

/** TextResolver.GetText(tag) formatted with args (string.Format); the tag itself when no table is loaded. */
function T(tag: string, ...args: unknown[]): string {
    const template = isTextLoaded() ? getText(tag) : tag;
    return args.length > 0 ? formatNet(template, args) : template;
}

// ---------------------------------------------------------------------------------------------------------------
// Galaxy.2.cs text helpers
// ---------------------------------------------------------------------------------------------------------------

/** Galaxy.2.cs:1977 ResolveDescription(CharacterRole). */
export function resolveRoleDescription(role: CharacterRole): string {
    return resolveEnumTextDescription(CHARACTER_ROLE, CharacterRole[role]);
}

/** Galaxy.2.cs:2591 ResolveDescription(IntelligenceMissionType). */
export function resolveMissionTypeDescription(type: IntelligenceMissionType): string {
    return resolveEnumTextDescription(INTELLIGENCE_MISSION, MT[type]);
}

/** Galaxy.2.cs CapitalizeFirstLetter(text). */
export function capitalizeFirstLetter(text: string): string {
    return text.substring(0, 1).toUpperCase() + text.substring(1);
}

function countByRole(empire: Empire, role: CharacterRole): number {
    return getEmpireCharacters(empire).filter((c) => c.role === role).length;
}

/** Galaxy.2.cs:3512 ResolveCharacterSummary(empire): "n Leader, n Ambassador, …, n Intelligence Agent". */
export function resolveCharacterSummary(empire: Empire | null): string {
    if (empire === null) return '';
    const roles =
        empire.pirateEmpireBaseHabitat === null
            ? [CharacterRole.Leader, CharacterRole.Ambassador, CharacterRole.ColonyGovernor, CharacterRole.FleetAdmiral, CharacterRole.ShipCaptain, CharacterRole.TroopGeneral, CharacterRole.Scientist, CharacterRole.IntelligenceAgent]
            : [CharacterRole.PirateLeader, CharacterRole.FleetAdmiral, CharacterRole.ShipCaptain, CharacterRole.Scientist, CharacterRole.IntelligenceAgent];
    return roles.map((r) => `${countByRole(empire, r)} ${T(CHARACTER_ROLE.tags[CharacterRole[r]])}`).join(', ');
}

function locationName(c: Character): string {
    return c.location?.name ?? '';
}

function shipGroupName(bo: BuiltObject): string | null {
    const sg = bo.shipGroup as ShipGroup | null;
    return sg !== null ? sg.name : null;
}

/** Galaxy.2.cs:3551 ResolveCharacterLocationDescription(character). An agent on a mission (other than counter-intelligence) is "(Unknown)". */
export function resolveCharacterLocationDescription(c: Character | null): string {
    if (c === null) return `(${T('Unknown')})`;
    if (c.location === null) return `(${T('None')})`;
    switch (c.role) {
        case CharacterRole.FleetAdmiral:
        case CharacterRole.TroopGeneral:
        case CharacterRole.ShipCaptain: {
            let text = locationName(c);
            if (c.location instanceof BuiltObject) {
                const g = shipGroupName(c.location);
                if (g !== null) text += `  (${g})`;
            }
            return text;
        }
        case CharacterRole.IntelligenceAgent: {
            const m = characterMission(c);
            if (m !== null && m.type !== MT.Undefined) return m.type !== MT.CounterIntelligence ? `(${T('Unknown')})` : locationName(c);
            return locationName(c);
        }
        default:
            return locationName(c);
    }
}

function transferText(c: Character, galaxy: Galaxy): string {
    const dest = c.transferDestination!;
    let name = dest.name;
    if (dest instanceof BuiltObject) {
        const g = shipGroupName(dest);
        if (g !== null) name += `  (${g})`;
    }
    const arrival = resolveStarDateDescription(c.transferExpectedArrivalDate(galaxy));
    return `${T('Transferring to DESTINATION', name)} (${T('Expected Arrival', arrival)})`;
}

/** Galaxy.2.cs:5240 ResolveDescriptionCharacterTask(character, galaxy) — the list's Mission column. */
export function resolveDescriptionCharacterTask(c: Character | null, galaxy: Galaxy): string {
    if (c === null) return '';
    let result = '';
    const loc = c.location;
    const waiting = (): string => T('Waiting at X', locationName(c));
    const transferring = c.transferDestination !== null && c.transferTimeRemaining > 0;
    switch (c.role) {
        case CharacterRole.IntelligenceAgent: {
            result = `(${T('No mission')})`;
            const m = characterMission(c);
            if (m !== null && m.type !== MT.Undefined) {
                let text3 = capitalizeFirstLetter(resolveText(resolveIntelligenceMissionDescription(m, c.empire)));
                if (m.type === MT.DeepCover && m.outcome === IntelligenceMissionOutcome.SucceedNotDetect) {
                    text3 = T('Deep cover in the EMPIRE', m.targetEmpire?.name ?? '');
                }
                let arg3 = T('completed DATE', resolveStarDateDescription(m.startDate + m.timeLength));
                if (m.timeLength > 1000000000) arg3 = T('Until cancelled');
                result = `${text3}  (${arg3})`;
            } else if (transferring) {
                result = transferText(c, galaxy);
            }
            break;
        }
        case CharacterRole.TroopGeneral:
            if (loc !== null && loc.empire !== c.empire && c.empire !== null && loc.empire !== null && checkAtWarWithEmpire(c.empire, loc.empire)) {
                result = T('Leading invasion of LOCATION', loc.name);
            } else if (transferring) {
                result = transferText(c, galaxy);
            }
            break;
        case CharacterRole.FleetAdmiral:
            if (loc === null) break;
            if (loc instanceof BuiltObject) {
                const g = shipGroupName(loc);
                result = g === null ? T('Commanding SHIPNAME', loc.name) : T('Commanding FLEETNAME', g);
            } else result = waiting();
            break;
        case CharacterRole.ShipCaptain:
            if (loc === null) break;
            result = loc instanceof BuiltObject ? T('Commanding SHIPNAME', loc.name) : waiting();
            break;
        case CharacterRole.Ambassador:
            if (loc === null) break;
            if (loc instanceof HabitatClass) {
                const e = loc.empire;
                result = e === null || e.capital !== loc || e === c.empire ? waiting() : T('Ambassador to EMPIRE at COLONY', e.name, loc.name);
            } else result = waiting();
            break;
        case CharacterRole.ColonyGovernor:
            if (loc === null) break;
            if (loc instanceof HabitatClass) result = loc.empire !== c.empire ? waiting() : T('Governing COLONY', loc.name);
            else result = waiting();
            break;
        case CharacterRole.Leader:
            if (loc === null) break;
            if (loc instanceof HabitatClass) {
                const e = loc.empire;
                result = e === null || e !== c.empire || !e.capitals.includes(loc) ? waiting() : T('Ruling from COLONY', loc.name);
            } else result = waiting();
            break;
        case CharacterRole.PirateLeader:
            if (loc === null) break;
            if (loc instanceof HabitatClass) {
                result = !loc.pirateColonyControl.checkFactionHasControl(c.empire?.empireId ?? null) ? waiting() : T('Ruling from COLONY', loc.name);
            } else if (loc instanceof BuiltObject) {
                const g = shipGroupName(loc);
                result =
                    loc.empire !== null && loc.empire === c.empire && loc.role === BuiltObjectRole.Base
                        ? T('Ruling from COLONY', loc.name)
                        : g === null
                          ? T('Onboard SHIPNAME', loc.name)
                          : T('Commanding FLEETNAME', g);
            } else result = waiting();
            break;
        case CharacterRole.Scientist:
            if (loc === null) break;
            if (loc instanceof BuiltObject) {
                result = loc.researchEnergy <= 0 && loc.researchWeapons <= 0 && loc.researchHighTech <= 0 ? waiting() : T('Researching at X', loc.name);
            } else result = waiting();
            break;
        default:
            if (transferring) result = transferText(c, galaxy);
            break;
    }
    if (transferring) result = transferText(c, galaxy);
    return result;
}

/** A sim text (resolveIntelligenceMissionDescription formats it now, like Galaxy.2.cs 5563; a gameText() "tag|arg…"
 *  encoding is still decoded) → the English text. */
function resolveText(encoded: string): string {
    return resolveGameText(encoded);
}

// ---------------------------------------------------------------------------------------------------------------
// List rows (CharacterListView.cs BindData)
// ---------------------------------------------------------------------------------------------------------------

export interface CharacterRow {
    character: Character;
    name: string;
    role: string;
    location: string;
    mission: string;
}

/** CharacterListView.cs BindData: one row per character of empire.Characters, in list order. */
export function characterRows(empire: Empire, galaxy: Galaxy): CharacterRow[] {
    return getEmpireCharacters(empire).map((c) => ({
        character: c,
        name: c.name,
        role: resolveRoleDescription(c.role),
        location: c.location === null ? `(${T('None')})` : resolveCharacterLocationDescription(c),
        mission: resolveDescriptionCharacterTask(c, galaxy),
    }));
}

// ---------------------------------------------------------------------------------------------------------------
// Character detail (CharacterSkillsTraitsProgress.cs:60-150 OnPaint)
// ---------------------------------------------------------------------------------------------------------------

export interface SkillLine {
    name: string;
    /** "+25%" / "-10%" (`(level / 100).ToString("+0%;-0%")`), or "?%" while the bonuses are unknown. */
    value: string;
    positive: boolean;
    /** Progress to the next level, `(Progress / NextProgressThreshold).ToString("0%")`; null for trait skills. */
    progress: string | null;
    fromTrait: boolean;
}

function signedPercent(level: number): string {
    const p = Math.round(Math.abs(level));
    return (level >= 0 ? '+' : '-') + p + '%';
}

/** `ToString("+#0;-#0")` of a whole-percent level. */
function signedLevel(level: number): string {
    const v = Math.round(level);
    return (v < 0 ? '-' : '+') + Math.abs(v);
}

/**
 * Port of Galaxy.2.cs:4608 ResolveCharacterDescription(character, includeName): the character tooltip text — the name
 * and role (includeName), the untested note, SKILLS (including bonuses from traits) with their levels ("?%" while
 * untested), then TRAITS with each trait's effect (the special texts, else up to three "+N% skill" per line).
 */
export function resolveCharacterDescription(character: Character | null, includeName = true): string {
    let text = '';
    if (character === null) return text;
    if (includeName) {
        text += `${character.name} (${resolveRoleDescription(character.role)})\n`;
        text += '\n';
    }
    if (!character.bonusesKnown) text += `(${T('Character untested - skill levels and traits unknown')})\n\n`;
    text += `${T('Skills').toUpperCase()} (`;
    text += `${T('including bonuses from traits')})\n`;
    const skill = (t: CharacterSkillType): string => resolveEnumTextDescription(CHARACTER_SKILL, CharacterSkillType[t]);
    for (const type of character.resolveCharacterSkillTypes(false)) {
        const skillLevel = character.getSkillLevel(type);
        if (character.bonusesKnown) {
            if (skillLevel !== 0) text += `${skill(type)}: ${signedLevel(skillLevel)}%\n`;
        } else {
            text += `${skill(type)}: ?%\n`;
        }
    }
    if (character.traits.length > 0) {
        text += '\n';
        text += `${T('Traits').toUpperCase()}\n`;
        if (character.bonusesKnown) {
            for (const trait of character.traits) {
                const effects = determineEffectsOfCharacterTrait(trait, character.role);
                text += `${resolveEnumTextDescription(CHARACTER_TRAIT, CharacterTraitType[trait])}: `;
                switch (trait) {
                    case CharacterTraitType.Lazy:
                    case CharacterTraitType.PoorTactician:
                    case CharacterTraitType.Drunk:
                    case CharacterTraitType.LaxDiscipline:
                        text += T('Amount To All Skills', '-5%');
                        break;
                    case CharacterTraitType.Energetic:
                    case CharacterTraitType.GoodTactician:
                    case CharacterTraitType.ToughDiscipline:
                        text += T('Amount To All Skills', '+5%');
                        break;
                    case CharacterTraitType.InspiringPresence:
                        text += T('Character Trait Description InspiringPresence');
                        break;
                    case CharacterTraitType.Demoralizing:
                        text += T('Character Trait Description Demoralizing');
                        break;
                    case CharacterTraitType.LocalDefenseTactics:
                        text += T('Character Trait Description LocalDefenseTactics', '+20%');
                        break;
                    case CharacterTraitType.ForeignSpy:
                        text += T('Character Trait Description ForeignSpy');
                        break;
                    case CharacterTraitType.Patriot:
                        text += T('Character Trait Description Patriot');
                        break;
                    case CharacterTraitType.UltraGenius:
                        text += T('Character Trait Description UltraGenius', '+20%');
                        break;
                    case CharacterTraitType.Creative:
                        text += T('Character Trait Description Creative');
                        break;
                    case CharacterTraitType.Methodical:
                        text += T('Character Trait Description Methodical');
                        break;
                    default: {
                        let num = 0;
                        for (const cs of effects.items) {
                            if (cs == null) continue;
                            if (num > 2) {
                                text += '\n';
                                num = 0;
                            }
                            text += `${signedLevel(cs.level)}% ${skill(cs.type)}, `;
                            num++;
                        }
                        if (effects.items.length > 0) text = text.substring(0, text.length - 2);
                        if (trait === CharacterTraitType.IntelligenceSober || trait === CharacterTraitType.IntelligenceAddict) {
                            text += ` (${T('Character Trait Description OnlyAppliesToExistingSkills')})`;
                        }
                        break;
                    }
                }
                text += '\n';
            }
        } else {
            text += '?\n';
        }
    }
    if (text.length > 1) text = text.substring(0, text.length - 1);
    return text;
}

/** CharacterSkillsTraitsProgress.cs:73-87: "TRAITS: a, b" (or the untested text); '' without traits. */
export function characterTraitsLine(c: Character): string {
    if (c.traits.length === 0) return '';
    let text = T('Traits').toUpperCase() + ': ';
    if (c.bonusesKnown) text += c.traits.map((t) => resolveEnumTextDescription(CHARACTER_TRAIT, CharacterTraitType[t])).join(', ');
    else text += T('Character untested - skill levels and traits unknown');
    return text;
}

/** CharacterSkillsTraitsProgress.cs:89-146: each skill, then (when known) every non-zero trait-only skill "(from Trait)". */
export function characterSkillLines(c: Character): SkillLine[] {
    const out: SkillLine[] = [];
    for (const skill of c.skills.items) {
        if (skill === null) continue;
        const level = c.getSkillLevel(skill.type);
        out.push({
            name: resolveEnumTextDescription(CHARACTER_SKILL, CharacterSkillType[skill.type]),
            value: c.bonusesKnown ? signedPercent(level) : '?%',
            positive: !c.bonusesKnown || level >= 0,
            progress: Math.round((Math.fround(skill.progress / skill.nextProgressThreshold)) * 100) + '%',
            fromTrait: false,
        });
    }
    if (c.bonusesKnown) {
        for (const ts of c.traitSkills.items) {
            if (ts === null || c.skills.getSkillByType(ts.type) !== null) continue;
            const level = c.getSkillLevel(ts.type);
            if (level === 0) continue;
            out.push({
                name: resolveEnumTextDescription(CHARACTER_SKILL, CharacterSkillType[ts.type]),
                value: signedPercent(level),
                positive: level >= 0,
                progress: null,
                fromTrait: true,
            });
        }
    }
    return out;
}

/**
 * Counter-intelligence summary: Empire.5.cs:5375 CountAgentsAssigned (espionage.ts countAgentsAssigned) restricted to
 * the IntelligenceAgent role, the split the C# AI uses to decide how many agents defend.
 */
export function agentAssignmentSummary(empire: Empire): { agents: number; offensive: number; counterIntelligence: number; idle: number } {
    let offensive = 0;
    let counterIntelligence = 0;
    let idle = 0;
    for (const c of getEmpireCharacters(empire)) {
        if (c.role !== CharacterRole.IntelligenceAgent) continue;
        const m = characterMission(c);
        if (m !== null && m.type !== MT.Undefined) {
            if (m.type === MT.CounterIntelligence) counterIntelligence++;
            else offensive++;
        } else idle++;
    }
    return { agents: offensive + counterIntelligence + idle, offensive, counterIntelligence, idle };
}

// ---------------------------------------------------------------------------------------------------------------
// Mission form (CharacterMission.cs)
// ---------------------------------------------------------------------------------------------------------------

/** cmbMissionType items, in CharacterMission.cs BindData order (the combo index is SetState's SelectedIndex). */
export const MISSION_TYPE_ORDER: readonly IntelligenceMissionType[] = [
    MT.CounterIntelligence,
    MT.SabotageConstruction,
    MT.DestroyBase,
    MT.StealTerritoryMap,
    MT.StealOperationsMap,
    MT.StealGalaxyMap,
    MT.StealTechData,
    MT.SabotageColony,
    MT.InciteRevolution,
    MT.AssassinateCharacter,
    MT.DeepCover,
];

/** Mission types with a cmbTargetObject (CharacterMission.cs cmbMissionType_SelectedIndexChanged switch). */
export function missionNeedsTarget(type: IntelligenceMissionType): boolean {
    return type === MT.SabotageConstruction || type === MT.StealTechData || type === MT.SabotageColony || type === MT.AssassinateCharacter || type === MT.DestroyBase;
}

/** CharacterMission.cs ResolveTimeToComplete: One month / Three months / One year / Until cancelled (4611686018427387903). */
export const TIME_ONE_MONTH = Math.trunc((REAL_SECONDS_IN_GALACTIC_YEAR * 1000) / 12);
export const TIME_THREE_MONTHS = Math.trunc((REAL_SECONDS_IN_GALACTIC_YEAR * 1000) / 4);
export const TIME_ONE_YEAR = REAL_SECONDS_IN_GALACTIC_YEAR * 1000;
export const TIME_UNTIL_CANCELLED = 4611686018427387903;

export interface TimeOption {
    label: string;
    value: number;
}

const TIME_STANDARD = (): TimeOption[] => [
    { label: T('One month'), value: TIME_ONE_MONTH },
    { label: T('Three months'), value: TIME_THREE_MONTHS },
    { label: T('One year'), value: TIME_ONE_YEAR },
];

/** cmbMissionType_SelectedIndexChanged: counter-intelligence lists "Until cancelled" first (selected); others the three durations, none selected. */
export function timeOptionsForType(type: IntelligenceMissionType): { options: TimeOption[]; selected: number } {
    if (type === MT.CounterIntelligence) return { options: [{ label: T('Until cancelled'), value: TIME_UNTIL_CANCELLED }, ...TIME_STANDARD()], selected: 0 };
    return { options: TIME_STANDARD(), selected: -1 };
}

/**
 * CharacterMission.cs BindData 80-110: the target-empire combo — met empires (DiplomaticRelations[e].Type != NotMet,
 * or the pirate relation for a pirate player), then met pirate factions; sorted by name (Empire.10.cs:4574 CompareTo).
 * The C# ObtainPirateRelation adds a NotMet relation when missing; reading it without adding filters the same.
 */
export function missionTargetEmpires(galaxy: Galaxy, player: Empire): Empire[] {
    const out: Empire[] = [];
    const pirateMet = (e: Empire): boolean => {
        const r = player.pirateRelations.getRelationByOtherEmpire(e);
        return r !== null && r.type !== PirateRelationType.NotMet;
    };
    for (const e of galaxy.empires) {
        if (e === null || e === player || e === galaxy.independentEmpire) continue;
        if (player.pirateEmpireBaseHabitat === null) {
            const r = player.diplomaticRelations.byEmpire(e);
            if (r !== null && r.type !== DiplomaticRelationType.NotMet) out.push(e);
        } else if (pirateMet(e)) out.push(e);
    }
    for (const e of galaxy.pirateEmpires) {
        if (e === null || e === player || out.includes(e)) continue;
        if (pirateMet(e)) out.push(e);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** CharacterMission.cs SetTargetObjectKnown* / SetTargetObjectAdvancedResearch: the target combo's (sorted) item texts. */
export function missionTargetOptions(galaxy: Galaxy, player: Empire, targetEmpire: Empire, type: IntelligenceMissionType): string[] {
    let names: string[] = [];
    switch (type) {
        case MT.SabotageConstruction:
            names = resolveKnownConstructionYards(galaxy, player, targetEmpire).filter((so) => so.empire === targetEmpire).map((so) => so.name);
            break;
        case MT.StealTechData:
            names = resolveMoreAdvancedProjectsIncludeSpecial(player, targetEmpire, true).map((n) => n.def.name);
            break;
        case MT.SabotageColony:
            names = resolveKnownColonies(player, targetEmpire).filter((h) => h.empire === targetEmpire).map((h) => h.name);
            break;
        case MT.AssassinateCharacter:
            names = resolveKnownCharacters(galaxy, player, targetEmpire).map((c) => characterTargetLabel(c));
            break;
        case MT.DestroyBase:
            names = resolveKnownBases(galaxy, player, targetEmpire).map((b) => b.name);
            break;
        default:
            return [];
    }
    return names.sort((a, b) => a.localeCompare(b));
}

/** CharacterMission.cs SetTargetObjectKnownCharacters: "Name (Role)". */
export function characterTargetLabel(c: Character): string {
    return `${c.name} (${resolveRoleDescription(c.role)})`;
}

/** The form's selections (the four combos). */
export interface MissionForm {
    targetEmpire: Empire | null;
    type: IntelligenceMissionType;
    targetOptions: string[];
    /** Selected cmbTargetObject text, null when none is selected. */
    target: string | null;
    timeOptions: TimeOption[];
    /** Selected cmbTimeToComplete index, -1 when none. */
    timeIndex: number;
}

/** CharacterMission.cs SetState(null): first empire, Counter Intelligence, One month (the BindData durations). */
export function initialMissionForm(galaxy: Galaxy, player: Empire): MissionForm {
    const empires = missionTargetEmpires(galaxy, player);
    return { targetEmpire: empires[0] ?? null, type: MT.CounterIntelligence, targetOptions: [], target: null, timeOptions: TIME_STANDARD(), timeIndex: 0 };
}

/** CharacterMission.cs cmbMissionType_SelectedIndexChanged: new duration list; target list for the type (nothing selected). */
export function withMissionType(galaxy: Galaxy, player: Empire, form: MissionForm, type: IntelligenceMissionType): MissionForm {
    const t = timeOptionsForType(type);
    const targetOptions = form.targetEmpire !== null && missionNeedsTarget(type) ? missionTargetOptions(galaxy, player, form.targetEmpire, type) : [];
    return { ...form, type, targetOptions, target: null, timeOptions: t.options, timeIndex: t.selected };
}

/** CharacterMission.cs cmbTargetEmpire_SelectedIndexChanged: `cmbMissionType.SelectedIndex = 0; … = 1` (ends on Sabotage Construction). */
export function withTargetEmpire(galaxy: Galaxy, player: Empire, form: MissionForm, empire: Empire | null): MissionForm {
    const f = { ...form, targetEmpire: empire };
    return withMissionType(galaxy, player, withMissionType(galaxy, player, f, MISSION_TYPE_ORDER[0]), MISSION_TYPE_ORDER[1]);
}

/** CharacterMission.cs SetState(mission): the form showing an assigned mission (time index by TimeLength thresholds). */
export function formFromMission(galaxy: Galaxy, player: Empire, m: IntelligenceMission): MissionForm {
    const target = m.targetIsBuiltObject ? m.targetBuiltObject?.name ?? null
        : m.targetIsHabitat ? m.targetHabitat?.name ?? null
        : m.targetIsResearch ? m.targetResearchNode?.def.name ?? null
        : m.targetIsCharacter && m.targetCharacter !== null ? characterTargetLabel(m.targetCharacter)
        : null;
    const timeIndex = m.timeLength <= TIME_ONE_MONTH ? 0 : m.timeLength <= TIME_THREE_MONTHS ? 1 : 2;
    void galaxy; void player;
    return { targetEmpire: m.targetEmpire, type: m.type, targetOptions: target !== null ? [target] : [], target, timeOptions: TIME_STANDARD(), timeIndex };
}

/** CharacterMission.cs SetState flag: the duration row is hidden for counter-intelligence and an established deep cover. */
export function missionShowsTime(m: IntelligenceMission): boolean {
    if (m.type === MT.CounterIntelligence) return false;
    return !(m.type === MT.DeepCover && m.outcome === IntelligenceMissionOutcome.SucceedNotDetect);
}

/**
 * CharacterMission.cs GetState: the mission the selections describe, or null when they do not make one (Assign stays
 * disabled). Counter-intelligence needs nothing else; every other type needs a target empire and a duration, and the
 * target types a resolved target object (the first object whose name matches the selected text, as the C# resolves).
 */
export function buildMissionState(galaxy: Galaxy, player: Empire, agent: Character, form: MissionForm): IntelligenceMission | null {
    const empire = form.targetEmpire;
    const type = form.type;
    const time = form.timeIndex >= 0 && form.timeIndex < form.timeOptions.length ? form.timeOptions[form.timeIndex].value : 0;
    const date = galaxyCurrentStarDate(galaxy);
    let state: IntelligenceMission | null = null;
    if (type === MT.CounterIntelligence) {
        state = new IntelligenceMission(player, agent, date);
    } else if (empire !== null && type !== MT.Undefined && time > 0) {
        const name = form.target;
        switch (type) {
            case MT.SabotageConstruction: {
                const obj = name === null ? undefined : resolveKnownConstructionYards(galaxy, player, empire).find((so) => so.name === name);
                if (obj instanceof HabitatClass) state = newIntelligenceMissionAgainstHabitat(player, agent, type, date, obj);
                else if (obj instanceof BuiltObject) state = newIntelligenceMissionAgainstBuiltObject(player, agent, MT.SabotageConstruction, date, obj);
                break;
            }
            case MT.StealGalaxyMap:
            case MT.StealOperationsMap:
            case MT.DeepCover:
            case MT.InciteRevolution:
            case MT.StealTerritoryMap:
                state = newIntelligenceMissionAgainstEmpire(player, agent, type, date, empire);
                break;
            case MT.StealTechData: {
                // ResolveTargetObjectResearch: by name in the player's tech tree.
                const node: TechNode | undefined = name === null ? undefined : player.research.techTree.find((n) => n.def.name === name);
                if (node !== undefined) state = newIntelligenceMissionStealTechData(player, agent, date, empire, node);
                break;
            }
            case MT.SabotageColony: {
                const lower = name?.toLowerCase();
                const h: Habitat | undefined = lower === undefined ? undefined : resolveKnownColonies(player, empire).find((c) => c.name.toLowerCase() === lower);
                if (h !== undefined) state = newIntelligenceMissionAgainstHabitat(player, agent, type, date, h);
                break;
            }
            case MT.AssassinateCharacter: {
                const c = name === null ? undefined : resolveKnownCharacters(galaxy, player, empire).find((k) => characterTargetLabel(k) === name);
                if (c !== undefined) state = newIntelligenceMissionAgainstCharacter(player, agent, MT.AssassinateCharacter, date, c);
                break;
            }
            case MT.DestroyBase: {
                const b = name === null ? undefined : resolveKnownBases(galaxy, player, empire).find((k) => k.name === name);
                if (b !== undefined) state = newIntelligenceMissionAgainstBuiltObject(player, agent, MT.DestroyBase, date, b);
                break;
            }
        }
    }
    if (state !== null) state.timeLength = time;
    return state;
}

/** CharacterMission.cs GetMissionDifficultyDescription: `CalculateIntelligenceMissionSuccessChance.ToString("#0%")`; '' for counter-intelligence / established deep cover. */
export function missionDifficultyDescription(m: IntelligenceMission | null, agent: Character): string {
    if (m === null) return `(${T('Unknown')})`;
    if (m.type === MT.CounterIntelligence) return '';
    if (m.type === MT.DeepCover && m.outcome === IntelligenceMissionOutcome.SucceedNotDetect) return '';
    return Math.round(calculateIntelligenceMissionSuccessChance(agent.empire!, m, agent) * 100) + '%';
}

/** CharacterMission.cs GetMissionDifficultyWarning: < 0.7 highly risky, < 0.85 somewhat risky. */
export function missionDifficultyWarning(m: IntelligenceMission | null, agent: Character): string {
    if (m === null || m.type === MT.CounterIntelligence) return '';
    if (m.type === MT.DeepCover && m.outcome === IntelligenceMissionOutcome.SucceedNotDetect) return '';
    const chance = calculateIntelligenceMissionSuccessChance(agent.empire!, m, agent);
    if (chance < 0.7) return T('WARNING: This mission is highly risky - your agent may be captured');
    if (chance < 0.85) return T('This mission is somewhat risky, maybe you should reconsider');
    return '';
}

/** Main.Part6.cs:3185 / 3289: the mission panel shows only for an IntelligenceAgent; 'active' when a mission is set (SetControlsAndMission). */
export function missionPanelMode(c: Character | null): 'hidden' | 'assign' | 'active' {
    if (c === null || c.role !== CharacterRole.IntelligenceAgent) return 'hidden';
    const m = characterMission(c);
    return m !== null && m.type !== MT.Undefined ? 'active' : 'assign';
}

/** Main.Part6.cs:3351 btnIntelligenceAgentsDisband_Click: a leader cannot be dismissed right after a leadership change. */
export function canDismissCharacter(c: Character, player: Empire): boolean {
    return !((c.role === CharacterRole.Leader || c.role === CharacterRole.PirateLeader) && player.leaderChangeInfluence !== 0.0);
}

// Dismiss / assign / cancel are player commands (playerOps.ts dismissCharacter, setAgentMission, cancelAgentMission):
// the screen never writes Character.mission or kills a character itself (docs/sim-worker.md §9 chunk 7).

// ---------------------------------------------------------------------------------------------------------------
// Pictures (CharacterImageCache.cs, CharacterSummary.cs GenerateCharacterPlanetCompositeImage)
// ---------------------------------------------------------------------------------------------------------------

// Role icons, portraits and OverlayRoleIcon: characterPortrait.ts (CharacterImageCache.cs).
export { characterPortraitUrl, roleIconOverlayRect, roleIconUrl } from '../characterPortrait';

/** Main.Part12.cs LoadEnvLandscapes: the landscape bitmaps in GalaxyImages LandscapeImageOffset order. */
const LANDSCAPE_FOLDERS: readonly [string, number][] = [
    ['barrenrock', 4],
    ['continental', 4],
    ['forest', 1],
    ['frozengasgiant', 2],
    ['gasgiant', 6],
    ['iceglacial', 3],
    ['marshyswamp', 3],
    ['ocean', 2],
    ['sandydesert', 3],
    ['volcanic', 2],
];

/** Habitat.LandscapePictureRef → images/environment/landscapes/<type>/landscape_<i>.png; null when out of range. */
export function landscapeImageUrl(ref: number): string | null {
    if (!Number.isInteger(ref) || ref < 0) return null;
    let i = ref;
    for (const [folder, count] of LANDSCAPE_FOLDERS) {
        if (i < count) return `/assets/dwu/images/environment/landscapes/${folder}/landscape_${i}.png`;
        i -= count;
    }
    return null;
}

/** CharacterSummary.cs DrawCharacter: no location, a transfer under way or an agent on an offensive mission. */
export function characterInTransitOrUnknown(c: Character): boolean {
    if (c.location === null) return true;
    if (c.transferDestination !== null && c.transferTimeRemaining > 0) return true;
    const m = characterMission(c);
    return m !== null && m.type !== MT.CounterIntelligence && m.type !== MT.Undefined;
}

/**
 * GenerateCharacterPlanetCompositeImage's background: the location's landscape (Galaxy.4.cs:1769
 * SelectCharacterLandscapeImageIndex — a Habitat's LandscapePictureRef), else / in transit the space image
 * (bitmap_189 = images/ui/chrome/storyEvent.jpg).
 */
export function characterBackdropUrl(c: Character): string {
    const space = chromeImageUrl('storyEvent.jpg');
    if (characterInTransitOrUnknown(c)) return space;
    const loc = c.location;
    if (loc instanceof HabitatClass) return landscapeImageUrl(loc.landscapePictureRef) ?? space;
    return space;
}

// ---------------------------------------------------------------------------------------------------------------
// Role filter (our extra on lblCharacterSummary: the summary's "n Role" entries as toggle buttons)
// ---------------------------------------------------------------------------------------------------------------

export interface RoleCount {
    role: CharacterRole;
    count: number;
    label: string;
}

/** Galaxy.2.cs:3512 ResolveCharacterSummary's roles and counts, in its order. */
export function characterRoleCounts(empire: Empire): RoleCount[] {
    const roles =
        empire.pirateEmpireBaseHabitat === null
            ? [CharacterRole.Leader, CharacterRole.Ambassador, CharacterRole.ColonyGovernor, CharacterRole.FleetAdmiral, CharacterRole.ShipCaptain, CharacterRole.TroopGeneral, CharacterRole.Scientist, CharacterRole.IntelligenceAgent]
            : [CharacterRole.PirateLeader, CharacterRole.FleetAdmiral, CharacterRole.ShipCaptain, CharacterRole.Scientist, CharacterRole.IntelligenceAgent];
    return roles.map((role) => ({ role, count: countByRole(empire, role), label: T(CHARACTER_ROLE.tags[CharacterRole[role]]) }));
}

/** The list rows shown for a role filter (null = every character). */
export function filterCharacterRows(rows: readonly CharacterRow[], role: CharacterRole | null): CharacterRow[] {
    return role === null ? rows.slice() : rows.filter((r) => r.character.role === role);
}

// ---------------------------------------------------------------------------------------------------------------
// Transfer (CharacterSummary.cs SetupTransferControls / btnTransfer_Click)
// ---------------------------------------------------------------------------------------------------------------

export interface TransferOption {
    label: string;
    /** The fleet (its destination is resolved on Transfer) or the stellar object. */
    fleet: ShipGroup | null;
    target: StellarObject | null;
}

function sortedFleets(empire: Empire): ShipGroup[] {
    // FleetDropDown.BindData sorts the bound list (ShipGroup.CompareTo: SortTag, then Name) — on a copy here.
    const out = (empire.shipGroups as ShipGroup[]).filter((g) => g !== null);
    netSort(out, compareShipGroups);
    return out;
}

function habitatsByName(list: readonly Habitat[]): Habitat[] {
    // HabitatDropDown.BindData: HabitatList.OrderByName().
    return list.filter((h) => h !== null).slice().sort((a, b) => a.name.localeCompare(b.name));
}

const fleetOption = (g: ShipGroup): TransferOption => ({ label: g.name ?? '', fleet: g, target: null });
const objectOption = (o: StellarObject): TransferOption => ({ label: o.name, fleet: null, target: o });

/**
 * CharacterSummary.cs SetupTransferControls (not editing): the destinations of the role's combo, in its order; null
 * when the role has no transfer combo (intelligence agents).
 */
export function transferOptions(galaxy: Galaxy, c: Character): TransferOption[] | null {
    const e = c.empire;
    switch (c.role) {
        case CharacterRole.Leader:
            return e === null ? [] : habitatsByName(e.capitals).map(objectOption);
        case CharacterRole.Ambassador: {
            const out: Habitat[] = [];
            if (e !== null) {
                for (const r of e.diplomaticRelations) {
                    const other = r?.otherEmpire ?? null;
                    if (r === null || r.type === DiplomaticRelationType.NotMet || r.type === DiplomaticRelationType.War || other === null || other === e || other.capital === null) continue;
                    const star = galaxy.determineHabitatSystemStar(other.capital);
                    if (star !== null && e.visibility.checkSystemExplored(star.systemIndex)) out.push(other.capital);
                }
            }
            return habitatsByName(out).map(objectOption);
        }
        case CharacterRole.ColonyGovernor:
            return e === null ? [] : habitatsByName(e.colonies).map(objectOption);
        case CharacterRole.FleetAdmiral:
            return e === null ? [] : sortedFleets(e).map(fleetOption);
        case CharacterRole.TroopGeneral:
            return e === null ? [] : [...sortedFleets(e).map(fleetOption), ...e.colonies.filter((h) => h !== null).map(objectOption)];
        case CharacterRole.Scientist:
            return e === null ? [] : (e.researchFacilities as BuiltObject[]).filter((b) => b !== null).map(objectOption);
        case CharacterRole.PirateLeader:
            if (e === null) return [];
            return [
                ...sortedFleets(e).map(fleetOption),
                ...e.builtObjects.filter((b) => b !== null && b.role === BuiltObjectRole.Base).map(objectOption),
                ...e.colonies.filter((h) => h !== null && h.empire === e).map(objectOption),
            ];
        case CharacterRole.ShipCaptain: {
            if (e === null) return [];
            const roles = [BuiltObjectRole.Build, BuiltObjectRole.Exploration, BuiltObjectRole.Freight, BuiltObjectRole.Military, BuiltObjectRole.Passenger, BuiltObjectRole.Resource];
            return e.builtObjects.filter((b) => b !== null && roles.includes(b.role)).map(objectOption);
        }
        default:
            return null;
    }
}

/** btnTransfer_Click: a fleet resolves to its strongest troop transport (troop general / pirate leader) or lead ship. */
export function resolveTransferDestination(c: Character, o: TransferOption | null): StellarObject | null {
    if (o === null) return null;
    if (o.fleet !== null) {
        if (c.role === CharacterRole.TroopGeneral || c.role === CharacterRole.PirateLeader) return shipGroupDetermineStrongestTroopTransport(o.fleet) ?? o.fleet.leadShip;
        return o.fleet.leadShip;
    }
    return o.target;
}

/** btnTransfer_Click: the transfer happens only to a new location while no transfer is under way. */
export function canTransfer(c: Character, destination: StellarObject | null): boolean {
    return destination !== null && destination !== c.location && c.transferDestination === null;
}

// ---------------------------------------------------------------------------------------------------------------
// DOM (Main.Part6.cs:3098 method_425: pnlIntelligenceAgents, 1020 × 770)
// ---------------------------------------------------------------------------------------------------------------

// The summary's name box renames (CharacterSummary.cs txtName_Enter / _Leave / _KeyDown, a renameCharacter player
// command), and the summary's tooltip is Main.Part6.cs:3164-3170: "Name (Role)" over ResolveCharacterDescription.
export interface IntelligenceScreenOptions {
    player: Empire;
    /** CharacterDoubleClicked: move the view to the character's location. */
    onZoomTo?: (target: BuiltObject | Habitat) => void;
    /** method_424(character): open with this character selected. */
    character?: Character | null;
}

interface OpenState {
    close: () => void;
}

let open: OpenState | null = null;

/** F4 / tbtnIntelligenceAgents_Click: toggle the screen. */
export function toggleIntelligenceScreen(opts: IntelligenceScreenOptions): void {
    if (open) open.close();
    else open = createIntelligenceScreen(opts);
}

/** Close the screen (no-op when closed). */
export function closeIntelligenceScreen(): void {
    open?.close();
}

/** CharacterSummary.cs GenerateAutomationMessageBox → "off" turns the automation off. */
async function automationOff(task: string): Promise<boolean> {
    const answer = await messageBox({
        caption: T('Turn Off TASKNAME Automation?', task),
        text: T('Would you like to turn off automation', task),
        buttons: [T('Leave automation on'), T('Turn off automation')],
        icon: 'question',
        width: 520,
        buttonWidth: 190,
    });
    return answer === T('Turn off automation');
}

/** A combo whose items are labels; -1 = nothing selected (a hidden blank first option). */
function fillSelect(sel: HTMLSelectElement, labels: string[], selected: number): void {
    const cur = Array.from(sel.options).map((o) => o.textContent);
    const want = ['', ...labels];
    if (cur.length !== want.length || cur.some((t, i) => t !== want[i])) {
        sel.replaceChildren();
        want.forEach((t, i) => {
            const o = document.createElement('option');
            o.value = String(i - 1);
            o.textContent = t;
            if (i === 0) o.hidden = true;
            sel.appendChild(o);
        });
    }
    sel.value = String(selected);
}

function labelledCombo(parent: HTMLElement, label: string, x: number, y: number, w: number): { label: HTMLDivElement; sel: HTMLSelectElement } {
    const l = dropText(parent, label, x, y - 14, { size: FONT.tiny, bold: true, color: COLORS.label, shadow: false });
    const sel = dropDown([], '', () => {});
    place(sel, x, y, w, 21);
    sel.style.fontSize = `${FONT.small}px`;
    parent.appendChild(sel);
    return { label: l, sel };
}

function createIntelligenceScreen(opts: IntelligenceScreenOptions): OpenState {
    const player = opts.player;
    const galaxy = player.galaxy as Galaxy;
    let timer = 0;
    let historyWin: OriginalWindow | null = null;
    let securityWin: OriginalWindow | null = null;
    const win = openOriginalWindow({
        id: 'characters',
        title: T('Characters'),
        icon: 'characters.png',
        width: 1020,
        height: 770,
        onClose: () => {
            window.clearInterval(timer);
            historyWin?.close(); // method_426 → method_663
            securityWin?.close();
            open = null;
        },
    });
    const body = win.body;
    body.classList.add('ch-body');

    // --- lblCharacterSummary (10, 8) 570 × 35: the "n Role" entries, here as role filter toggles (our extra). ---
    let roleFilter: CharacterRole | null = null;
    const chips = el('div', 'ch-roles');
    place(chips, 10, 6, 570, 30);
    body.appendChild(chips);
    let chipsKey = '';
    function renderChips(): void {
        const counts = characterRoleCounts(player);
        const key = counts.map((r) => `${r.role}:${r.count}`).join(',') + `|${roleFilter}`;
        if (key === chipsKey) return;
        chipsKey = key;
        chips.replaceChildren();
        chips.title = resolveCharacterSummary(player);
        const w = Math.floor((570 - (counts.length - 1) * 4) / counts.length);
        counts.forEach((r, i) => {
            const b = glassButton(String(r.count), {
                image: `characterRole_${CharacterRole[r.role]}.png`,
                toggled: roleFilter === r.role,
                size: FONT.normal,
                title: `${r.count} ${r.label}` + (roleFilter === r.role ? ' — click to show every character' : ` — click to show only ${r.label}`),
                className: 'ch-role-btn',
                onClick: () => {
                    roleFilter = roleFilter === r.role ? null : r.role;
                    chipsKey = '';
                    renderChips();
                    renderList(true);
                },
            });
            chips.appendChild(place(b, i * (w + 4), 0, w, 30));
        });
    }

    // --- btnIntelligenceAgentsDisband (595, 8) 90 × 30, btnCharacterShowEventHistory (689, 8) 146 × 30, the link. ---
    const dismissBtn = glassButton(T('Dismiss'), { onClick: () => void dismiss() });
    body.appendChild(place(dismissBtn, 595, 8, 90, 30));
    const historyBtn = glassButton(T('Show Event History'), { onClick: () => openHistory(selected) });
    body.appendChild(place(historyBtn, 689, 8, 146, 30));
    const showSecurity = securityVisible(galaxy); // [security]
    const learn = linkLabel(T('Learn about Characters') + '...', () => openGalactopedia({ topic: T('Characters') }));
    body.appendChild(place(learn, 840, showSecurity ? 2 : 12, 160, 21));
    // [security] begin — 19m internal security: the leads table in its own window (flag on only)
    if (showSecurity) body.appendChild(place(linkLabel('Internal Security...', () => openSecurity()), 840, 21, 160, 21));
    // [security] end

    // --- ctlIntelligenceAgents (10, 40) 570 × 655: Image 40, Name 100, Role 100, Location 100, Mission 230. ---
    const showPolitics = politicsVisible(galaxy); // [emergent] 19d1: Loyalty / Ambition columns
    const zoomTo = (c: Character): void => {
        const loc = c.location;
        if (loc !== null && opts.onZoomTo && (loc instanceof BuiltObject || loc instanceof HabitatClass)) opts.onZoomTo(loc);
    };
    const tip = T('Double-click to move to location');
    const columns: GridColumn<CharacterRow>[] = [
        {
            id: 'image',
            header: '',
            width: 40,
            render: (r, cell) => {
                cell.title = tip;
                cell.appendChild(characterPortrait(r.character, 'small', 38));
            },
        },
        { id: 'name', header: T('Name'), width: 100, sort: (r) => r.name, render: (r, cell) => wrapCell(cell, r.name, tip) },
        { id: 'role', header: T('Role'), width: 100, sort: (r) => r.role, render: (r, cell) => wrapCell(cell, r.role, tip) },
        { id: 'location', header: T('Location'), width: 100, sort: (r) => r.location, render: (r, cell) => wrapCell(cell, r.location, tip) },
        {
            id: 'mission',
            header: T('Mission'),
            width: showPolitics ? 130 : 230,
            sort: (r) => r.mission,
            render: (r, cell) => {
                const ff = missionFrameLabel(galaxy, characterMission(r.character)); // [emergent] 19d3 false flag
                wrapCell(cell, ff === '' ? r.mission : `${r.mission} ${ff}`, tip);
            },
        },
    ];
    // [emergent] begin
    if (showPolitics) {
        columns.push(
            { id: 'loyalty', header: 'Loyalty', width: 50, align: 'right', render: (r, cell) => wrapCell(cell, politicsRowCells(galaxy, r.character).loyalty, tip) },
            { id: 'ambition', header: 'Ambition', width: 50, align: 'right', render: (r, cell) => wrapCell(cell, politicsRowCells(galaxy, r.character).ambition, tip) },
        );
    }
    // [emergent] end
    const grid = new OwGrid<CharacterRow>({
        columns,
        key: (r) => r.character,
        rowHeight: 40,
        fontSize: FONT.normal,
        onSelect: (r) => select(r.character),
        onDoubleClick: (r) => zoomTo(r.character),
        rowClass: (r) => (showPolitics && politicsRowCells(galaxy, r.character).risk ? 'ch-row-risk' : ''),
    });
    grid.el.classList.add('ch-list');
    body.appendChild(place(grid.el, 10, 40, 570, 655));

    // --- ctlCharacterSummary (595, 40) 400 × 655 (470 with the mission panel). ---
    const summary = gradientPanel({ className: 'ch-summary' });
    body.appendChild(place(summary, 595, 40, 400, 655));
    const pictureWrap = el('div', 'ch-composite');
    summary.appendChild(place(pictureWrap, 10, 10, 250, 250));
    const sRole = dropText(summary, '', 270, 10, { size: FONT.large, bold: true, color: COLORS.label, className: 'ch-center' });
    sRole.style.width = '120px';
    // txtName (270, 38) 120 × 62: multiline, centred, borderless until focused (txtName_Enter: FixedSingle + SelectAll);
    // txtName_Leave stores the text as the name; Enter leaves the box (txtName_KeyDown → Focus()).
    const sName = el('textarea', 'ch-center ch-name-box');
    sName.spellcheck = false;
    sName.rows = 2;
    place(sName, 270, 38, 120, 62);
    summary.appendChild(sName);
    sName.addEventListener('focus', () => sName.select());
    sName.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
            e.preventDefault();
            sName.blur();
        }
    });
    sName.addEventListener('blur', () => {
        const c = selected;
        if (c === null || sName.value === c.name) return;
        // Command log: queued, applied at the next frame boundary; the list shows the new name then.
        issuePlayerCommand(galaxy, player, 'renameCharacter', [c, sName.value], () => render());
    });
    const sTask = dropText(summary, '', 270, 108, { size: FONT.large, color: COLORS.label, shadow: false, wrapWidth: 120 });
    sTask.style.height = '152px';
    sTask.style.overflow = 'hidden';
    const skills = scrollPanel('ch-skills');
    summary.appendChild(place(skills, 13, 272, 377, 270));
    const skillsInner = el('div', 'ch-skills-inner');
    skills.appendChild(skillsInner);
    const dPolitics = el('div', 'ch-extra'); // [emergent] 19d1 politics block
    const dCourt = el('div', 'ch-extra'); // [court] 19n house / seat / appoint
    skills.append(dPolitics, dCourt);
    // cmb* (85, 565) 230 × 22 and btnTransfer (85, 595) 230 × 25.
    const transferSel = dropDown([], '', () => {});
    transferSel.style.fontSize = `${FONT.large}px`;
    summary.appendChild(place(transferSel, 85, 565, 230, 24));
    const transferBtn = glassButton(T('Transfer to new location'), { size: FONT.large, onClick: () => void doTransfer() });
    summary.appendChild(place(transferBtn, 85, 595, 230, 25));

    // --- pnlCharacterMission (595, 510) 400 × 185. ---
    const mission = gradientPanel({ className: 'ch-mission' });
    body.appendChild(place(mission, 595, 510, 400, 185));
    mission.appendChild(place(linkLabel(T('Learn about Intelligence Missions...'), () => openGalactopedia({ topic: T('Intelligence Missions') }), FONT.small), 200, 5, 190, 20));
    const fEmpire = labelledCombo(mission, T('Target Empire'), 10, 23, 180);
    const fType = labelledCombo(mission, T('Mission Type'), 10, 66, 180);
    const fTarget = labelledCombo(mission, T('Target'), 10, 109, 180);
    const fTime = labelledCombo(mission, T('Time to Complete'), 10, 152, 180);
    const chanceValue = dropText(mission, '', 275, 24, { size: FONT.title, bold: true, color: COLORS.label, shadow: false });
    const chanceLabel = dropText(mission, '', 200, 56, { size: FONT.small, bold: true, color: COLORS.label, shadow: false, wrapWidth: 190 });
    const warning = dropText(mission, '', 200, 72, { size: FONT.large, color: COLORS.label, shadow: false, wrapWidth: 190 });
    warning.style.maxHeight = '80px';
    warning.style.overflow = 'hidden';
    // 19d3 (scenario `espionageConsequences`): the false-flag "Blame" combo; hidden when blameOptions is empty.
    const fBlame = labelledCombo(mission, 'Blame', 200, 127, 190);
    let blameList: BlameOption[] = [];
    let blameId = -1;
    const assignBtn = glassButton(T('Assign Mission'), { onClick: () => void assign() });
    const cancelBtn = glassButton(T('Cancel Mission'), { onClick: () => void cancel() });
    mission.appendChild(place(assignBtn, 200, 152, 190, 25));
    mission.appendChild(place(cancelBtn, 200, 152, 190, 25));

    let selected: Character | null = null;
    let form: MissionForm = initialMissionForm(galaxy, player);
    let formEmpires: Empire[] = [];
    let shownMission: unknown = undefined;
    let transferList: TransferOption[] = [];
    let transferFor: Character | null | undefined = undefined;
    let pictureKey = '';
    let skillsKey = '';

    function wrapCell(cell: HTMLDivElement, value: string, title: string): void {
        const s = el('span', 'ch-wrap', value);
        cell.title = title;
        cell.appendChild(s);
    }

    function rows(): CharacterRow[] {
        return filterCharacterRows(characterRows(player, galaxy), roleFilter);
    }

    function renderList(scroll = false): void {
        const list = rows();
        grid.setRows(list);
        if (selected === null || !list.some((r) => r.character === selected)) {
            select(grid.displayed[0]?.character ?? null, scroll);
            return;
        }
        if (scroll) grid.select(selected, true);
    }

    function renderPicture(c: Character): void {
        const backdrop = characterBackdropUrl(c);
        const key = `${backdrop}|${characterPortraitUrl(c)}|${c.role}`;
        if (key === pictureKey) return;
        pictureKey = key;
        pictureWrap.replaceChildren();
        // GenerateCharacterPlanetCompositeImage: backdrop and portrait cover-fill 238 × 238 at (6, 6), the frame on top.
        const bg = el('img', 'ch-fill');
        bg.src = backdrop;
        bg.alt = '';
        bg.draggable = false;
        pictureWrap.appendChild(place(bg, 6, 6, 238, 238));
        pictureWrap.appendChild(place(characterPortrait(c, 'large', 238), 6, 6, 238, 238));
        const frame = el('img');
        frame.src = chromeImageUrl('panelframe.png');
        frame.alt = '';
        frame.draggable = false;
        pictureWrap.appendChild(place(frame, 0, 0, 250, 250));
    }

    function renderSkills(c: Character): void {
        const lines = characterSkillLines(c);
        const traits = characterTraitsLine(c);
        const key = traits + '#' + lines.map((l) => `${l.name}|${l.value}|${l.progress}`).join(';');
        if (key === skillsKey) return;
        skillsKey = key;
        skillsInner.replaceChildren();
        if (traits !== '') skillsInner.appendChild(text(traits, { size: FONT.large, color: COLORS.label, wrapWidth: 357, className: 'ch-traits' }));
        for (const l of lines) {
            // CharacterSkillsTraitsProgress.DrawCharacter: name right-aligned to 205, value (22.67 bold) at 200,
            // progress bar 100 × 18 at 260 (or "(from Trait)").
            const row = el('div', 'ch-skill');
            row.appendChild(place(text(l.name, { size: FONT.large, color: COLORS.label, className: 'ch-skill-name' }), 0, 0, 197));
            const color = l.value === '?%' ? COLORS.label : l.positive ? 'rgb(0, 128, 0)' : COLORS.red;
            row.appendChild(place(text(l.value, { size: FONT.title, bold: true, color }), 200, -5));
            if (l.fromTrait) {
                const t = text(`(${T('from Trait')})`, { size: FONT.tiny, color: COLORS.label, className: 'ch-center' });
                row.appendChild(place(t, 260, 1, 100));
            } else {
                const bar = el('div', 'ch-progress');
                const fill = el('div', 'ch-progress-fill');
                fill.style.width = l.progress ?? '0%';
                bar.append(fill, el('span', 'ch-progress-text', l.progress ?? ''));
                row.appendChild(place(bar, 260, -2, 100, 18));
            }
            skillsInner.appendChild(row);
        }
    }

    function renderTransfer(c: Character | null): void {
        const opts2 = c === null ? null : transferOptions(galaxy, c);
        const visible = opts2 !== null;
        transferSel.style.display = visible ? '' : 'none';
        transferBtn.style.display = visible ? '' : 'none';
        if (!visible) {
            transferList = [];
            transferFor = c;
            return;
        }
        const prev = transferFor === c ? transferList[Number(transferSel.value)] ?? null : null;
        const labels = opts2.map((o) => o.label);
        const changed = labels.length !== transferList.length || labels.some((l, i) => l !== transferList[i].label);
        if (changed || transferFor !== c) {
            transferList = opts2;
            const idx = prev === null ? -1 : opts2.findIndex((o) => (o.fleet ?? o.target) === (prev.fleet ?? prev.target));
            fillSelect(transferSel, labels, idx); // option values are list indexes (-1 = the hidden blank)
        }
        transferFor = c;
        const dest = resolveTransferDestination(c!, transferList[Number(transferSel.value)] ?? null);
        transferBtn.disabled = !canTransfer(c!, dest);
    }

    function renderDetail(): void {
        const c = selected;
        dismissBtn.disabled = c === null;
        historyBtn.disabled = c === null;
        summary.style.visibility = c === null ? 'hidden' : '';
        if (c === null) {
            renderTransfer(null);
            return;
        }
        const agent = missionPanelMode(c) !== 'hidden';
        // method_425: the summary shrinks to 400 × 470 (skills 377 × 188) for an agent.
        summary.style.height = agent ? '470px' : '655px';
        skills.style.height = agent ? '188px' : '270px';
        renderPicture(c);
        setText(sRole, resolveRoleDescription(c.role));
        if (document.activeElement !== sName && sName.value !== c.name) sName.value = c.name;
        // Main.Part6.cs:3164-3170: toolTip_0 on ctlCharacterSummary (title "Name (Role)", ResolveCharacterDescription).
        summary.title = `${c.name} (${resolveRoleDescription(c.role)})\n\n${resolveCharacterDescription(c, false)}`;
        const task = resolveDescriptionCharacterTask(c, galaxy);
        setText(sTask, task !== '' ? task : resolveCharacterLocationDescription(c));
        renderSkills(c);
        renderPolitics(c); // [emergent]
        renderCourt(c); // [court]
        renderTransfer(c);
    }

    // [emergent] begin — 19d1 internal politics: loyalty, trend, causes, Honour / Arrest / Purge (command queue)
    function renderPolitics(c: Character): void {
        const p = politicsDetail(galaxy, player, c);
        const key = p === null ? '' : JSON.stringify(p);
        if (dPolitics.dataset.key === key) return;
        dPolitics.dataset.key = key;
        dPolitics.replaceChildren();
        if (p === null) return;
        dPolitics.appendChild(text('POLITICS', { size: FONT.large, bold: true, color: COLORS.label }));
        dPolitics.appendChild(text(`Loyalty ${p.loyalty}   (last year ${p.trend})${p.exposed ? '   — plot uncovered' : ''}`, { size: FONT.normal, color: COLORS.text, wrapWidth: 357 }));
        if (p.causes.length > 0) dPolitics.appendChild(text(p.causes.join(' · '), { size: FONT.small, color: COLORS.label, wrapWidth: 357 }));
        if (p.grievances.length > 0) dPolitics.appendChild(text(`Grievances: ${p.grievances.join(' · ')}`, { size: FONT.small, color: 'rgb(255, 160, 96)', wrapWidth: 357 }));
        const buttons = el('div', 'ch-extra-buttons');
        for (const b of p.buttons) {
            buttons.appendChild(
                glassButton(b.label, {
                    disabled: !b.enabled,
                    title: b.reason,
                    size: FONT.small,
                    onClick: async () => {
                        if (b.action === 'purge') {
                            const a = await messageBox({ caption: 'Purge', text: `Purge ${c.name}? Every other official will resent it.`, buttons: ['Yes', 'No'], icon: 'warning' });
                            if (a !== 'Yes') return;
                        }
                        issuePlayerCommand(galaxy, player, 'politicsAction', [b.action, c], () => {
                            dPolitics.dataset.key = '';
                            render();
                        });
                    },
                }),
            );
        }
        dPolitics.appendChild(buttons);
    }
    // [emergent] end

    // [court] begin — 19n court & dynasties: house, seat, heir; appoint / vacate through the command queue
    function renderCourt(c: Character): void {
        const p = courtDetail(galaxy, player, c);
        const key = p === null ? '' : JSON.stringify(p);
        if (dCourt.dataset.key === key) return;
        dCourt.dataset.key = key;
        dCourt.replaceChildren();
        if (p === null) return;
        dCourt.appendChild(text('COURT', { size: FONT.large, bold: true, color: COLORS.label }));
        dCourt.appendChild(text(`${p.house} — ${p.seat}${p.heir ? ' — heir' : ''}`, { size: FONT.normal, color: COLORS.text, wrapWidth: 357 }));
        const buttons = el('div', 'ch-extra-buttons');
        const issue = (seat: SeatName, who: Character | null): void => {
            issuePlayerCommand(galaxy, player, 'courtAppoint', [seat, who], () => {
                dCourt.dataset.key = '';
                render();
            });
        };
        for (const b of p.buttons) buttons.appendChild(glassButton(b.label, { disabled: !b.enabled, title: b.reason, size: FONT.small, onClick: () => issue(b.seat, c) }));
        if (p.vacate !== null) {
            const seat = p.vacate;
            buttons.appendChild(glassButton('Leave seat', { size: FONT.small, onClick: () => issue(seat, null) }));
        }
        dCourt.appendChild(buttons);
    }
    // [court] end

    /** Push `form` into the combos (SetState / the change handlers). */
    function writeForm(editable: boolean): void {
        formEmpires = missionTargetEmpires(galaxy, player);
        if (form.targetEmpire !== null && !formEmpires.includes(form.targetEmpire)) formEmpires = [...formEmpires, form.targetEmpire];
        fillSelect(fEmpire.sel, formEmpires.map((e) => e.name), form.targetEmpire ? formEmpires.indexOf(form.targetEmpire) : -1);
        fillSelect(fType.sel, MISSION_TYPE_ORDER.map((t) => resolveMissionTypeDescription(t)), MISSION_TYPE_ORDER.indexOf(form.type));
        fillSelect(fTarget.sel, form.targetOptions, form.target !== null ? form.targetOptions.indexOf(form.target) : -1);
        fillSelect(fTime.sel, form.timeOptions.map((o) => o.label), form.timeIndex);
        const showTarget = missionNeedsTarget(form.type);
        fTarget.sel.style.display = fTarget.label.style.display = showTarget ? '' : 'none';
        blameList = blameOptions(galaxy, player, form.type, form.targetEmpire);
        if (!editable) {
            const m = selected !== null ? characterMission(selected) : null;
            const f = m !== null ? missionFrame(galaxy, m) : null;
            blameId = f === null ? -1 : f.empireId;
            if (blameList.length === 0 && f !== null) blameList = [{ empireId: f.empireId, label: f.name }];
        } else if (!blameList.some((o) => o.empireId === blameId)) {
            blameId = -1;
        }
        fillSelect(fBlame.sel, blameList.map((o) => o.label), blameList.findIndex((o) => o.empireId === blameId));
        const showBlame = blameList.length > 0;
        fBlame.sel.style.display = fBlame.label.style.display = showBlame ? '' : 'none';
        warning.style.maxHeight = showBlame ? '38px' : '80px';
        for (const f of [fEmpire, fType, fTarget, fTime, fBlame]) f.sel.disabled = !editable;
    }

    function setWarning(m: IntelligenceMission | null, c: Character): void {
        const w = m !== null ? missionDifficultyWarning(m, c) : '';
        setText(warning, w);
        if (m === null || w === '') warning.style.color = COLORS.label;
        else warning.style.color = calculateIntelligenceMissionSuccessChance(c.empire!, m, c) < 0.7 ? 'rgb(255, 0, 0)' : 'rgb(255, 255, 0)';
    }

    function renderMission(force = false): void {
        const c = selected;
        const mode = missionPanelMode(c);
        mission.style.display = mode === 'hidden' ? 'none' : '';
        if (mode === 'hidden' || c === null) {
            shownMission = undefined;
            return;
        }
        const m = characterMission(c);
        if (mode === 'active' && m !== null) {
            if (force || shownMission !== m) {
                shownMission = m;
                form = formFromMission(galaxy, player, m);
                writeForm(false);
            }
            const showTime = missionShowsTime(m);
            fTime.sel.style.display = fTime.label.style.display = showTime ? '' : 'none';
            const d = missionDifficultyDescription(m, c);
            setText(chanceValue, d);
            setWarning(m, c);
            // SetControlsAndMission: no estimate → the task description in a taller label at (200, 41).
            if (d === '') {
                setText(chanceLabel, resolveDescriptionCharacterTask(c, galaxy) || resolveCharacterLocationDescription(c));
                chanceLabel.style.top = '41px';
                chanceLabel.style.maxHeight = '50px';
            } else {
                setText(chanceLabel, T('Success Probability'));
                chanceLabel.style.top = '56px';
                chanceLabel.style.maxHeight = '20px';
            }
            assignBtn.style.display = 'none';
            cancelBtn.style.display = '';
        } else {
            if (force || shownMission !== null) {
                shownMission = null;
                form = initialMissionForm(galaxy, player);
                writeForm(true);
            }
            fTime.sel.style.display = fTime.label.style.display = '';
            const state = buildMissionState(galaxy, player, c, form);
            const d = state !== null ? missionDifficultyDescription(state, c) : '';
            setText(chanceValue, d);
            setWarning(state, c);
            setText(chanceLabel, d === '' ? '' : T('Success Probability'));
            chanceLabel.style.top = '56px';
            chanceLabel.style.maxHeight = '20px';
            assignBtn.disabled = state === null;
            assignBtn.style.display = '';
            cancelBtn.style.display = 'none';
        }
    }

    function render(): void {
        renderChips();
        renderList();
        renderDetail();
        renderMission();
        if (securityWin !== null) renderSecurity(); // [security]
    }

    function select(c: Character | null, scroll = true): void {
        selected = c;
        grid.select(c, scroll);
        pictureKey = skillsKey = '';
        skills.scrollTop = 0;
        renderDetail();
        renderMission(true);
    }

    fEmpire.sel.addEventListener('change', () => {
        const e = formEmpires[Number(fEmpire.sel.value)] ?? null;
        form = withTargetEmpire(galaxy, player, form, e);
        writeForm(true);
        renderMission();
    });
    fType.sel.addEventListener('change', () => {
        const t = MISSION_TYPE_ORDER[Number(fType.sel.value)] ?? MT.CounterIntelligence;
        form = withMissionType(galaxy, player, form, t);
        writeForm(true);
        renderMission();
    });
    fTarget.sel.addEventListener('change', () => {
        form = { ...form, target: form.targetOptions[Number(fTarget.sel.value)] ?? null };
        renderMission();
    });
    fBlame.sel.addEventListener('change', () => {
        blameId = blameList[Number(fBlame.sel.value)]?.empireId ?? -1;
    });
    fTime.sel.addEventListener('change', () => {
        form = { ...form, timeIndex: Number(fTime.sel.value) };
        renderMission();
    });
    transferSel.addEventListener('change', () => renderTransfer(selected));

    /** CharacterMission.cs btnAssign/CancelMission_Click: the ControlAgentAssignment automation prompt first. */
    async function agentAutomationPrompt(): Promise<void> {
        if (player.controlAgentAssignment === AutomationLevel.FullyAutomated && (await automationOff(T('Agent Assignment')))) {
            // C# AutomationLevel.Manual (0). Command log: queued, applied at the next frame boundary.
            issuePlayerCommand(galaxy, player, 'setEmpireControl', ['controlAgentAssignment', AutomationLevel.Undefined]);
        }
    }
    async function assign(): Promise<void> {
        const c = selected;
        if (c === null) return;
        await agentAutomationPrompt();
        if (open === null || selected !== c) return;
        const state = buildMissionState(galaxy, player, c, form);
        if (state === null) return;
        const framed = blameId >= 0 ? galaxy.empires.find((e) => e.empireId === blameId) ?? null : null;
        if (framed === null) {
            issuePlayerCommand(galaxy, player, 'setAgentMission', [c, state], () => render());
            return;
        }
        issuePlayerCommand(galaxy, player, 'setAgentMission', [c, state]);
        issuePlayerCommand(galaxy, player, 'setAgentMissionFrame', [state, framed], () => render());
    }
    async function cancel(): Promise<void> {
        const c = selected;
        if (c === null) return;
        await agentAutomationPrompt();
        if (open === null || selected !== c) return;
        // pnlCharacterMission_MissionCancelled → method_424(selected): rebind.
        issuePlayerCommand(galaxy, player, 'cancelAgentMission', [c], () => render());
    }
    /** CharacterSummary.cs btnTransfer_Click (not editing). */
    async function doTransfer(): Promise<void> {
        const c = selected;
        if (c === null) return;
        const option = transferList[Number(transferSel.value)] ?? null;
        if (player.controlCharacterLocations && (await automationOff(T('Character Locations')))) {
            issuePlayerCommand(galaxy, player, 'setEmpireControl', ['controlCharacterLocations', false]);
        }
        if (open === null || selected !== c) return;
        const dest = resolveTransferDestination(c, option);
        if (!canTransfer(c, dest)) return;
        // CharacterTransferInitiated → method_425(selected): rebind.
        issuePlayerCommand(galaxy, player, 'transferCharacter', [c, dest], () => render());
    }
    /** Main.Part6.cs:3351 btnIntelligenceAgentsDisband_Click. */
    async function dismiss(): Promise<void> {
        const c = selected;
        if (c === null) return;
        if (!canDismissCharacter(c, player)) {
            await messageBox({ caption: T('Cannot Dismiss Leader Now'), text: T('You cannot currently dismiss your leader, because your empire already had a recent leadership change', c.name), icon: 'stop' });
            return;
        }
        const a = await messageBox({ caption: T('Disband Character'), text: T('Are you sure that you wish to disband this character?', c.name), buttons: ['Yes', 'No'], icon: 'question' });
        if (a !== 'Yes' || open === null) return;
        issuePlayerCommand(galaxy, player, 'dismissCharacter', [c], () => {
            selected = null;
            render();
        });
    }

    /** Main.Part2.cs:3478 method_662: pnlCharacterEventHistory (670 × 454). */
    function openHistory(c: Character | null): void {
        historyWin?.close();
        const w = openOriginalWindow({
            id: 'character-events',
            title: T('Character Event History') + (c !== null ? `: ${c.name}` : ''),
            icon: 'characters.png',
            width: 670,
            height: 454,
            onClose: () => {
                if (historyWin === w) historyWin = null;
            },
        });
        historyWin = w;
        const events = c !== null ? characterPublicEvents(c) : [];
        const title = dropText(w.body, '', 300, 10, { size: FONT.large, bold: true, color: COLORS.text });
        title.style.width = '343px';
        const desc = scrollPanel('ch-event-text');
        w.body.appendChild(place(desc, 300, 32, 343, 348));
        const show = (ev: CharacterEvent | null): void => {
            // method_664.
            const d = ev !== null ? resolveCharacterEventDescription(ev, player) : { title: '', text: '' };
            setText(title, d.title);
            setText(desc, d.text);
        };
        const eventGrid = new OwGrid<CharacterEvent>({
            columns: [
                { id: 'date', header: T('Star Date'), width: 70, sort: (e) => e.starDate, render: (e, cell) => (cell.textContent = resolveStarDateDescription(e.starDate)) },
                { id: 'title', header: T('Event'), width: 210, sort: (e) => resolveCharacterEventDescription(e, player).title, render: (e, cell) => (cell.textContent = resolveCharacterEventDescription(e, player).title) },
            ],
            key: (e) => e,
            onSelect: (e) => show(e),
            empty: '',
        });
        w.body.appendChild(place(eventGrid.el, 10, 10, 280, 370));
        eventGrid.setRows(events);
        eventGrid.select(events[0] ?? null);
        show(events[0] ?? null);
    }

    // [security] begin — 19m internal security: leads and Investigate / actions (command queue), in its own window
    let securitySig = '';
    let securityBody: HTMLDivElement | null = null;
    function openSecurity(): void {
        if (securityWin !== null) {
            securityWin.close();
            return;
        }
        const w = openOriginalWindow({
            id: 'internal-security',
            title: 'Internal Security',
            icon: 'characters.png',
            width: 900,
            height: 520,
            onClose: () => {
                securityWin = null;
                securityBody = null;
            },
        });
        securityWin = w;
        securityBody = scrollPanel('ch-security');
        w.body.appendChild(place(securityBody, 10, 10, w.bodySize.w - 20, w.bodySize.h - 20));
        securitySig = '';
        renderSecurity();
    }
    function renderSecurity(): void {
        const host = securityBody;
        if (host === null) return;
        const agents = investigatorOptions(galaxy, player);
        const leads = leadRows(galaxy, player);
        const sig = leads.map((r) => `${r.lead.id}:${r.level}:${r.status}:${r.actions.length}:${r.canInvestigate}`).join('|') + '#' + agents.map((a) => a.name).join(',');
        if (sig === securitySig) return;
        securitySig = sig;
        host.replaceChildren();
        if (leads.length === 0) {
            host.appendChild(text('No leads. Agents on counter-intelligence look for plots, converts, sleepers and foreign agents once a year.', { size: FONT.normal, color: COLORS.label, wrapWidth: 840 }));
            return;
        }
        const table = el('div', 'ch-sec-table');
        const head = el('div', 'ch-sec-row ch-sec-head');
        for (const h of ['Lead', 'Target', 'Level', 'Since', 'Status', '']) head.appendChild(el('span', '', h));
        table.appendChild(head);
        for (const r of leads) {
            const row = el('div', `ch-sec-row ch-lead-${r.level}${r.lead.closed ? ' ch-lead-closed' : ''}`);
            row.append(el('span', '', r.kind), el('span', '', r.target), el('span', '', r.level), el('span', '', r.since), el('span', '', r.status));
            const cell = el('span', 'ch-sec-actions');
            if (r.canInvestigate && agents.length > 0) {
                const sel = dropDown(agents.map((a, i) => ({ value: String(i), label: a.name })), '0', () => {});
                sel.style.position = 'static';
                cell.appendChild(sel);
                cell.appendChild(
                    glassButton('Investigate', {
                        size: FONT.small,
                        onClick: () => {
                            const agent = agents[Number(sel.value)];
                            if (agent !== undefined) issuePlayerCommand(galaxy, player, 'securityInvestigate', [r.lead.id, agent], () => {
                                securitySig = '';
                                renderSecurity();
                            });
                        },
                    }),
                );
            }
            for (const a of r.actions) {
                cell.appendChild(glassButton(a.label, { size: FONT.small, onClick: () => issuePlayerCommand(galaxy, player, 'securityAction', [a.action, r.lead.id], () => renderSecurity()) }));
            }
            row.appendChild(cell);
            table.appendChild(row);
        }
        host.appendChild(table);
    }
    // [security] end

    // method_425: select the requested character (if it is the empire's), else the first row.
    renderChips();
    grid.setRows(rows());
    const initial = opts.character && opts.character.empire === player ? opts.character : grid.displayed[0]?.character ?? null;
    select(initial);
    timer = window.setInterval(render, 1000);
    return { close: () => win.close() };
}
