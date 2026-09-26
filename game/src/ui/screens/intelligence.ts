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
// Pure logic (rows, texts, the mission form state machine, GetState, the difficulty texts) is exported and tested
// (test/intelligence.test.ts); the DOM half only wires it.

import './intelligence.css';
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
    CharacterRole,
    CharacterSkillType,
    CharacterTraitType,
    IntelligenceMission,
    getEmpireCharacters,
} from '../../sim/characters';
import {
    IntelligenceMissionOutcome,
    IntelligenceMissionType,
    calculateIntelligenceMissionSuccessChance,
    cancelIntelligenceMission,
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
import { confirmAutomationOff } from '../orderMenu';
import { politicsDetail, politicsRowCells, politicsVisible } from '../emergentPolitics'; // [emergent]

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

/** Main.Part6.cs:3351 btnIntelligenceAgentsDisband_Click (after "yes"): `Mission = null; Kill(galaxy)`. */
export function dismissCharacter(galaxy: Galaxy, c: Character): void {
    c.mission = null;
    c.kill(galaxy);
}

/** CharacterMission.cs btnAssignMission_Click (after the automation prompt): `_Character.Mission = GetState()`. */
export function assignMission(galaxy: Galaxy, player: Empire, agent: Character, form: MissionForm): boolean {
    const state = buildMissionState(galaxy, player, agent, form);
    if (state === null) return false;
    agent.mission = state;
    return true;
}

/** CharacterMission.cs btnCancelMission_Click (after the automation prompt): CancelIntelligenceMission, then Mission = null. */
export function cancelMission(player: Empire, agent: Character): void {
    const m = characterMission(agent);
    if (m !== null) cancelIntelligenceMission(player, m);
    agent.mission = null;
}

// ---------------------------------------------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------------------------------------------

// TODO(port): the panel pauses a running game while open and resumes on close — Main.Part6.cs:3098 method_425 / 3214 method_426 (bool_11).
// TODO(port): CharacterSummary "Transfer to new location" (character transfer) — CharacterSummary.cs btnTransfer_Click / Main.Part6.cs:3325.
// TODO(port): "Show Event History" (CharacterEventListView) and character portraits (CharacterImageCache) — Main.Part6.cs:3135, CharacterListView.cs BindData.
// TODO(port): "Learn about Characters" / "Learn about Intelligence Missions" Galactopedia links — Main.Part6.cs:3124, CharacterMission.cs lnkMissionTypes_LinkClicked.
export interface IntelligenceScreenOptions {
    player: Empire;
    /** CharacterDoubleClicked: move the view to the character's location. */
    onZoomTo?: (target: BuiltObject | Habitat) => void;
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

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

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

function createIntelligenceScreen(opts: IntelligenceScreenOptions): OpenState {
    const player = opts.player;
    const galaxy = player.galaxy as Galaxy;

    const root = el('div', 'intel-wrap');
    const win = el('div', 'intel-window');
    root.appendChild(win);

    const titlebar = el('div', 'intel-titlebar');
    const heading = el('div', 'intel-heading', T('Characters'));
    const closeBtn = el('button', 'intel-close', '✕');
    closeBtn.type = 'button';
    closeBtn.title = 'Close';
    titlebar.append(heading, closeBtn);
    win.appendChild(titlebar);

    const top = el('div', 'intel-top');
    const summary = el('div', 'intel-summary');
    const ciSummary = el('div', 'intel-ci-summary');
    const dismissBtn = el('button', 'intel-btn', T('Dismiss'));
    dismissBtn.type = 'button';
    const summaryBox = el('div', 'intel-summary-box');
    summaryBox.append(summary, ciSummary);
    top.append(summaryBox, dismissBtn);
    win.appendChild(top);

    const body = el('div', 'intel-body');
    win.appendChild(body);

    // Left: the character list.
    const listWrap = el('div', 'intel-list');
    const header = el('div', 'intel-row intel-header');
    for (const h of [T('Name'), T('Role'), T('Location'), T('Mission')]) header.appendChild(el('span', 'intel-cell', h));
    // [emergent] begin — 19d1 internal politics: Loyalty / Ambition columns (flag on only)
    const showPolitics = politicsVisible(galaxy);
    if (showPolitics) {
        listWrap.classList.add('intel-politics');
        for (const h of ['Loyalty', 'Ambition']) header.appendChild(el('span', 'intel-cell intel-num', h));
    }
    // [emergent] end
    listWrap.appendChild(header);
    const listBody = el('div', 'intel-list-body');
    listWrap.appendChild(listBody);
    body.appendChild(listWrap);

    // Right: the character summary and the mission panel.
    const side = el('div', 'intel-side');
    const detail = el('div', 'intel-detail');
    const dName = el('div', 'intel-d-name');
    const dRole = el('div', 'intel-d-role');
    const dTask = el('div', 'intel-d-task');
    const dLoc = el('div', 'intel-d-loc');
    const dTraits = el('div', 'intel-d-traits');
    const dSkills = el('div', 'intel-d-skills');
    detail.append(dName, dRole, dTask, dLoc, dTraits, dSkills);
    // [emergent] begin — 19d1 internal politics: the Politics block
    const dPolitics = el('div', 'intel-politics-block');
    detail.appendChild(dPolitics);
    // [emergent] end
    side.appendChild(detail);

    const mission = el('div', 'intel-mission');
    const mTitle = el('div', 'intel-m-title', T('Assign Mission'));
    const field = (label: string): { row: HTMLDivElement; sel: HTMLSelectElement } => {
        const row = el('div', 'intel-m-field');
        const sel = el('select', 'intel-select');
        row.append(el('label', 'intel-m-label', label), sel);
        return { row, sel };
    };
    const fEmpire = field(T('Target Empire'));
    const fType = field(T('Mission Type'));
    const fTarget = field(T('Target'));
    const fTime = field(T('Time to Complete'));
    const chanceBox = el('div', 'intel-m-chance');
    const chanceLabel = el('div', 'intel-m-chance-label');
    const chanceValue = el('div', 'intel-m-chance-value');
    const warning = el('div', 'intel-m-warning');
    chanceBox.append(chanceLabel, chanceValue, warning);
    const assignBtn = el('button', 'intel-btn', T('Assign Mission'));
    assignBtn.type = 'button';
    const cancelBtn = el('button', 'intel-btn', T('Cancel Mission'));
    cancelBtn.type = 'button';
    const mButtons = el('div', 'intel-m-buttons');
    mButtons.append(assignBtn, cancelBtn);
    mission.append(mTitle, fEmpire.row, fType.row, fTarget.row, fTime.row, chanceBox, mButtons);
    side.appendChild(mission);
    body.appendChild(side);

    document.body.appendChild(root);

    let selected: Character | null = getEmpireCharacters(player)[0] ?? null;
    let form: MissionForm = initialMissionForm(galaxy, player);
    let formEmpires: Empire[] = [];
    let shownMission: unknown = undefined; // mission object the panel was last built for
    const rowEls = new Map<Character, { row: HTMLDivElement; cells: HTMLSpanElement[] }>();

    function renderList(): void {
        const rows = characterRows(player, galaxy);
        const seen = new Set<Character>();
        rows.forEach((r, i) => {
            seen.add(r.character);
            let entry = rowEls.get(r.character);
            if (!entry) {
                const row = el('div', 'intel-row');
                const cells = (showPolitics ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3]).map((k) => el('span', k >= 4 ? 'intel-cell intel-num' : 'intel-cell'));
                row.append(...cells);
                row.title = T('Double-click to move to location');
                const c = r.character;
                row.addEventListener('click', () => select(c));
                row.addEventListener('dblclick', () => {
                    const loc = c.location;
                    if (loc !== null && opts.onZoomTo && (loc instanceof BuiltObject || loc instanceof HabitatClass)) opts.onZoomTo(loc);
                });
                entry = { row, cells };
                rowEls.set(c, entry);
            }
            const vals = [r.name, r.role, r.location, r.mission];
            // [emergent] begin
            if (showPolitics) {
                const p = politicsRowCells(galaxy, r.character);
                vals.push(p.loyalty, p.ambition);
                entry.row.classList.toggle('intel-row-risk', p.risk);
            }
            // [emergent] end
            entry.cells.forEach((cell, k) => {
                if (cell.textContent !== vals[k]) cell.textContent = vals[k];
            });
            entry.row.classList.toggle('intel-row-selected', r.character === selected);
            entry.row.classList.toggle('intel-row-agent', r.character.role === CharacterRole.IntelligenceAgent);
            if (listBody.children[i] !== entry.row) listBody.insertBefore(entry.row, listBody.children[i] ?? null);
        });
        for (const [c, e] of rowEls) {
            if (!seen.has(c)) {
                e.row.remove();
                rowEls.delete(c);
            }
        }
        if (selected !== null && !seen.has(selected)) select(rows[0]?.character ?? null);
    }

    function renderDetail(): void {
        const c = selected;
        dismissBtn.disabled = c === null;
        if (c === null) {
            for (const d of [dName, dRole, dTask, dLoc, dTraits]) d.textContent = '';
            dPolitics.replaceChildren(); // [emergent]
            dSkills.replaceChildren();
            return;
        }
        dName.textContent = c.name;
        dRole.textContent = resolveRoleDescription(c.role);
        dTask.textContent = resolveDescriptionCharacterTask(c, galaxy);
        dLoc.textContent = `${T('Location')}: ${resolveCharacterLocationDescription(c)}`;
        dTraits.textContent = characterTraitsLine(c);
        renderPolitics(c); // [emergent]
        const lines = characterSkillLines(c);
        const key = lines.map((l) => `${l.name}|${l.value}|${l.progress}`).join(';');
        if (dSkills.dataset.key !== key) {
            dSkills.dataset.key = key;
            dSkills.replaceChildren(
                ...lines.map((l) => {
                    const row = el('div', 'intel-skill');
                    row.append(
                        el('span', 'intel-skill-name', l.name),
                        el('span', 'intel-skill-value ' + (l.value === '?%' ? '' : l.positive ? 'intel-good' : 'intel-bad'), l.value),
                        el('span', 'intel-skill-progress', l.fromTrait ? `(${T('from Trait')})` : l.progress ?? ''),
                    );
                    return row;
                }),
            );
        }
    }

    // [emergent] begin — 19d1 internal politics: loyalty, trend, causes, Honour / Arrest / Purge (command queue)
    function renderPolitics(c: Character): void {
        const p = politicsDetail(galaxy, player, c);
        const key = p === null ? '' : JSON.stringify(p);
        if (dPolitics.dataset.key === key) return;
        dPolitics.dataset.key = key;
        dPolitics.replaceChildren();
        if (p === null) return;
        dPolitics.appendChild(el('div', 'intel-m-title', 'Politics'));
        dPolitics.appendChild(el('div', 'intel-pol-line', `Loyalty ${p.loyalty}   (last year ${p.trend})${p.exposed ? '   — plot uncovered' : ''}`));
        if (p.causes.length > 0) dPolitics.appendChild(el('div', 'intel-pol-causes', p.causes.join(' · ')));
        if (p.grievances.length > 0) dPolitics.appendChild(el('div', 'intel-pol-grievances', `Grievances: ${p.grievances.join(' · ')}`));
        const buttons = el('div', 'intel-m-buttons');
        for (const b of p.buttons) {
            const btn = el('button', 'intel-btn', b.label);
            btn.type = 'button';
            btn.disabled = !b.enabled;
            btn.title = b.reason;
            btn.addEventListener('click', () => {
                if (b.action === 'purge' && !window.confirm(`Purge ${c.name}? Every other official will resent it.`)) return;
                issuePlayerCommand(galaxy, player, 'politicsAction', [b.action, c], () => {
                    dPolitics.dataset.key = '';
                    render();
                });
            });
            buttons.appendChild(btn);
        }
        dPolitics.appendChild(buttons);
    }
    // [emergent] end

    function renderSummary(): void {
        summary.textContent = resolveCharacterSummary(player);
        const s = agentAssignmentSummary(player);
        ciSummary.textContent = `${T('IntelligenceMissionType CounterIntelligence')}: ${s.counterIntelligence} / ${s.agents} — offensive ${s.offensive}, idle ${s.idle}`;
    }

    /** Push `form` into the combos (SetState / the change handlers). */
    function writeForm(editable: boolean): void {
        formEmpires = missionTargetEmpires(galaxy, player);
        if (form.targetEmpire !== null && !formEmpires.includes(form.targetEmpire)) formEmpires = [...formEmpires, form.targetEmpire];
        fillSelect(fEmpire.sel, formEmpires.map((e) => e.name), form.targetEmpire ? formEmpires.indexOf(form.targetEmpire) : -1);
        fillSelect(fType.sel, MISSION_TYPE_ORDER.map((t) => resolveMissionTypeDescription(t)), MISSION_TYPE_ORDER.indexOf(form.type));
        fillSelect(fTarget.sel, form.targetOptions, form.target !== null ? form.targetOptions.indexOf(form.target) : -1);
        fillSelect(fTime.sel, form.timeOptions.map((o) => o.label), form.timeIndex);
        fTarget.row.style.display = missionNeedsTarget(form.type) ? '' : 'none';
        for (const f of [fEmpire, fType, fTarget, fTime]) f.sel.disabled = !editable;
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
            fTime.row.style.display = missionShowsTime(m) ? '' : 'none';
            const d = missionDifficultyDescription(m, c);
            chanceValue.textContent = d;
            warning.textContent = missionDifficultyWarning(m, c);
            chanceLabel.textContent = d === '' ? resolveDescriptionCharacterTask(c, galaxy) || resolveCharacterLocationDescription(c) : T('Success Probability');
            assignBtn.style.display = 'none';
            cancelBtn.style.display = '';
            mTitle.textContent = T('Mission');
        } else {
            if (force || shownMission !== null) {
                shownMission = null;
                form = initialMissionForm(galaxy, player);
                writeForm(true);
            }
            fTime.row.style.display = '';
            const state = buildMissionState(galaxy, player, c, form);
            const d = state !== null ? missionDifficultyDescription(state, c) : '';
            chanceValue.textContent = d;
            warning.textContent = state !== null ? missionDifficultyWarning(state, c) : '';
            chanceLabel.textContent = d === '' ? '' : T('Success Probability');
            assignBtn.disabled = state === null;
            assignBtn.style.display = '';
            cancelBtn.style.display = 'none';
            mTitle.textContent = T('Assign Mission');
        }
    }

    function render(): void {
        renderSummary();
        renderList();
        renderDetail();
        renderMission();
    }

    function select(c: Character | null): void {
        selected = c;
        renderList();
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
    fTime.sel.addEventListener('change', () => {
        form = { ...form, timeIndex: Number(fTime.sel.value) };
        renderMission();
    });

    /** CharacterMission.cs btnAssign/CancelMission_Click: the ControlAgentAssignment automation prompt first. */
    async function automationPrompt(): Promise<void> {
        if (player.controlAgentAssignment === AutomationLevel.FullyAutomated) {
            // C# AutomationLevel.Manual (0). Command log: queued, applied at the next frame boundary.
            if (await confirmAutomationOff(T('Agent Assignment'))) issuePlayerCommand(galaxy, player, 'setEmpireControl', ['controlAgentAssignment', AutomationLevel.Undefined]);
        }
    }
    assignBtn.addEventListener('click', async () => {
        const c = selected;
        if (c === null) return;
        await automationPrompt();
        if (open === null || selected !== c) return;
        const state = buildMissionState(galaxy, player, c, form);
        if (state !== null) issuePlayerCommand(galaxy, player, 'setAgentMission', [c, state], () => render());
    });
    cancelBtn.addEventListener('click', async () => {
        const c = selected;
        if (c === null) return;
        await automationPrompt();
        if (open === null || selected !== c) return;
        issuePlayerCommand(galaxy, player, 'cancelAgentMission', [c], () => render());
    });
    dismissBtn.addEventListener('click', () => {
        const c = selected;
        if (c === null) return;
        if (!canDismissCharacter(c, player)) {
            window.alert(T('You cannot currently dismiss your leader, because your empire already had a recent leadership change'));
            return;
        }
        if (!window.confirm(T('Are you sure that you wish to disband this character?'))) return;
        issuePlayerCommand(galaxy, player, 'dismissCharacter', [c], () => {
            selected = null;
            render();
        });
    });

    const timer = setInterval(render, 1000);

    function close(): void {
        clearInterval(timer);
        document.removeEventListener('keydown', onKeyDown);
        root.remove();
        open = null;
    }
    function onKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            close();
        }
    }
    document.addEventListener('keydown', onKeyDown);
    closeBtn.addEventListener('click', () => close());

    select(selected);
    renderSummary();
    return { close };
}
