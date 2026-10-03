// Empire Policy panel model (task 17d). Pure (no DOM): the rows of the original's Empire Policy window
// (Main.Part3.cs:4488-5341 method_609, fed by method_595 with _Game.PlayerEmpire.Policy) and the apply mapping
// (Main.Part3.cs:3971-4201 method_597 + the control readers method_598-608), so both are unit-tested; the DOM
// panel (empirePolicy.ts) only wires them.
//
// Every value lives in a "control" keyed by the C# control name, holding exactly what the WinForms control holds
// (a ComboBox SelectedIndex + item count, a CheckBox Checked, a NumericUpDown Value). applyPolicyPanel reads the
// controls back the way method_597 does, including the readers' fallbacks for a control the panel does not show
// (pirate empires), and builds a *new* EmpirePolicy from the class defaults exactly like `new EmpirePolicy()`.

import { checkEmpireHasOwnedColonies } from './buildOrder';
import { AutomationLevel, type Empire } from '../../sim/empire';
import {
    ColonyPopulationPolicy,
    ComponentCategoryType,
    defaultEmpirePolicy,
    resolveTechFocus,
    type EmpirePolicy as PolicyData,
} from '../../sim/data/policies';
import { ComponentType } from '../../sim/data/components';
import { BuiltObjectFleeWhen } from '../../sim/data/designTemplates';
import { IndustryType } from '../../sim/types';
import { BuiltObjectSubRole } from '../../sim/builtObjectTypes';
import { resolveSubRoleDescription } from '../../sim/designGeneration';
import { formatNet, tryGetText } from '../../sim/textResolver';
import { AUTOMATION_ROWS, automationFieldValue, setAutomationValue } from './gameOptionsPanel';

// ---------------------------------------------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------------------------------------------

/** TextResolver.GetText(tag) with the tag itself as the fallback (headless tests load no GameText table). WinForms
 * shows "&&" as a literal "&". */
export function policyText(tag: string): string {
    return (tryGetText(tag) ?? tag).replace(/&&/g, '&');
}

// ---------------------------------------------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------------------------------------------

/** How a ComboBox's SelectedIndex is read back (the method_597 reader used for the control). */
export type ComboReader =
    | 'index' // method_605: the SelectedIndex itself
    | 'automation' // (AutomationLevel)method_605
    | 'bool' // Convert.ToBoolean(method_605) — any index but 0 is true
    | 'priority' // method_608
    | 'level' // method_606
    | 'fleeWhen' // method_599
    | 'industry' // method_600
    | 'population' // method_601 (ColonyPopulationPolicyDropDown)
    | 'wonder' // method_598
    | 'techFocus'; // Galaxy.ResolveTechFocus(method_605)

export interface ComboControl {
    kind: 'combo';
    reader: ComboReader;
    options: string[];
    /** WinForms SelectedIndex: -1 when the fill left the combo without a selection. */
    index: number;
}
export interface CheckControl {
    kind: 'check';
    checked: boolean;
}
export interface NumericControl {
    kind: 'numeric';
    min: number;
    max: number;
    value: number;
}
/** DesignDropDown (method_615 / dFwNhteflw): read-only here, see the TODO(port) in buildPolicyPanel. */
export interface DesignControl {
    kind: 'design';
    design: unknown | null;
    label: string;
}
export type PolicyControl = ComboControl | CheckControl | NumericControl | DesignControl;

export interface PolicyRow {
    /** C# control name (the key method_597 reads it back by). */
    name: string;
    label: string;
    /** The small text right of the control (method_626 string_32), '' when none. */
    suffix: string;
    control: PolicyControl;
    /** Shown but not editable (a sim function the change would need is not ported). */
    readOnly?: boolean;
    /** method_612 explanation paragraph shown above this row. */
    note?: string;
}

/** One automation ComboBox on a section header (method_622). */
export interface AutomationRow {
    name: string;
    control: ComboControl;
}

export interface PolicySection {
    title: string;
    automation: AutomationRow[];
    rows: PolicyRow[];
}

export interface PolicyPanelContext {
    /** Galaxy.PlanetaryFacilityDefinitions, in list order (the "Build Special Wonder" combo lists every one). */
    facilities: readonly { facilityId: number; name: string }[];
}

// ---------------------------------------------------------------------------------------------------------------
// Fill: selected index for a value (Main.Part2.cs method_616-621, 624, 625)
// ---------------------------------------------------------------------------------------------------------------

/** WinForms `if (Items.Count > num) SelectedIndex = num` — otherwise the combo keeps no selection (-1). */
function selectIf(count: number, num: number): number {
    return count > num ? num : -1;
}

// Port of Main.Part2.cs:158-173 method_617 (level combos: None/Low/Normal/High).
export function levelIndex(value: number, count: number): number {
    const num = !(value <= 0.0)
        ? value > 0.0 && value <= 0.5
            ? 1
            : value > 0.5 && value <= 1.0
              ? 2
              : !(value > 1.0) || !(value <= 1.5)
                ? 4
                : 3
        : 0;
    return selectIf(count, num);
}

// Port of Main.Part2.cs:175-190 method_618 (priority combos: Low/Normal/High[/Very High]).
export function priorityIndex(value: number, count: number): number {
    const num = !(value <= 0.5)
        ? value > 0.5 && value < 1.5
            ? 1
            : !(value >= 1.5) || !(value < 2.0)
              ? 3
              : 2
        : 0;
    return selectIf(count, num);
}

// Port of Main.Part2.cs:130-156 method_616 (flee-when combo).
export function fleeWhenIndex(value: BuiltObjectFleeWhen, count: number): number {
    let num = 1;
    switch (value) {
        case BuiltObjectFleeWhen.Shields50:
            num = 2;
            break;
        case BuiltObjectFleeWhen.Shields20:
            num = 1;
            break;
        case BuiltObjectFleeWhen.Never:
            num = 0;
            break;
    }
    return selectIf(count, num);
}

// Port of Main.Part2.cs:192-206 method_619 (wonder combo): SelectedIndex = PrioritizeBuildWonderId + 1.
export function wonderIndex(wonderId: number, count: number): number {
    return selectIf(count, wonderId + 1);
}

// Port of Main.Part2.cs:214-227 method_621 (plain index combos; SelectedIndex = value when in range).
export function plainIndex(value: number, count: number): number {
    return count > value ? value : -1;
}

// Port of ColonyPopulationPolicyDropDown.cs:55-61 SetSelectedPolicy (_Policies.IndexOf; GeneratePolicies order).
export const POPULATION_POLICIES: readonly ColonyPopulationPolicy[] = [
    ColonyPopulationPolicy.Assimilate,
    ColonyPopulationPolicy.DoNotAccept,
    ColonyPopulationPolicy.Resettle,
    ColonyPopulationPolicy.Enslave,
    ColonyPopulationPolicy.Exterminate,
];
/** Galaxy.2.cs:2013 ResolveDescription(ColonyPopulationPolicy) tags. */
const POPULATION_POLICY_TEXT = ['Assimilate', 'Do Not Accept', 'Resettle', 'Enslave', 'Exterminate'];

// Port of Main.Part2.cs:281-290 method_625: NumericUpDown Value = Min(max, Max(value, min)).
export function clampNumeric(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(value, min));
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

// ---------------------------------------------------------------------------------------------------------------
// Read back: the method_597 control readers (Main.Part3.cs:4203-4486)
// ---------------------------------------------------------------------------------------------------------------

export type PanelControls = ReadonlyMap<string, PolicyControl>;

function combo(c: PanelControls, name: string): ComboControl | null {
    const x = c.get(name);
    return x !== undefined && x.kind === 'combo' ? x : null;
}

// Port of Main.Part3.cs:4307-4318 method_603 (CheckBox.Checked; false when the control is absent).
export function readCheck(c: PanelControls, name: string): boolean {
    const x = c.get(name);
    return x !== undefined && x.kind === 'check' ? x.checked : false;
}

// Port of Main.Part3.cs:4320-4331 method_604 ((float)NumericUpDown.Value; 0 when absent).
export function readNumeric(c: PanelControls, name: string): number {
    const x = c.get(name);
    return x !== undefined && x.kind === 'numeric' ? Math.fround(x.value) : 0;
}

// Port of Main.Part3.cs:4333-4344 method_605 (ComboBox.SelectedIndex; 0 when absent).
export function readIndex(c: PanelControls, name: string): number {
    return combo(c, name)?.index ?? 0;
}

// Port of Main.Part3.cs:4346-4392 method_606 (level combos of 4 or 5 items; 1.0 otherwise).
export function readLevel(c: PanelControls, name: string): number {
    const x = combo(c, name);
    if (x !== null) {
        const levels4 = [0.0, 0.5, 1.0, 1.5];
        const levels5 = [0.0, 0.5, 1.0, 1.5, 2.0];
        const table = x.options.length === 4 ? levels4 : x.options.length === 5 ? levels5 : null;
        if (table !== null && x.index >= 0 && x.index < table.length) return table[x.index];
    }
    return 1.0;
}

// Port of Main.Part3.cs:4429-4486 method_608 (priority combos of 3, 4 or 5 items; 1.0 otherwise).
export function readPriority(c: PanelControls, name: string): number {
    const x = combo(c, name);
    if (x !== null) {
        const tables: Record<number, number[]> = { 3: [0.5, 1.0, 1.5], 4: [0.5, 1.0, 1.5, 2.0], 5: [0.5, 1.0, 1.5, 2.0, 4.0] };
        const table = tables[x.options.length];
        if (table !== undefined && x.index >= 0 && x.index < table.length) return table[x.index];
    }
    return 1.0;
}

// Port of Main.Part3.cs:4224-4243 method_599.
export function readFleeWhen(c: PanelControls, name: string): BuiltObjectFleeWhen {
    const x = combo(c, name);
    if (x !== null) {
        switch (x.index) {
            case 0: return BuiltObjectFleeWhen.Never;
            case 1: return BuiltObjectFleeWhen.Shields20;
            case 2: return BuiltObjectFleeWhen.Shields50;
        }
    }
    return BuiltObjectFleeWhen.Shields20;
}

// Port of Main.Part3.cs:4245-4266 method_600.
export function readIndustry(c: PanelControls, name: string): IndustryType {
    const x = combo(c, name);
    if (x !== null) {
        switch (x.index) {
            case 0: return IndustryType.Undefined;
            case 1: return IndustryType.Weapon;
            case 2: return IndustryType.Energy;
            case 3: return IndustryType.HighTech;
        }
    }
    return IndustryType.Undefined;
}

// Port of Main.Part3.cs:4268-4279 method_601 + ColonyPopulationPolicyDropDown.cs:46-53 SelectedPolicy.
export function readPopulationPolicy(c: PanelControls, name: string): ColonyPopulationPolicy {
    const x = combo(c, name);
    if (x !== null && x.index >= 0 && x.index < POPULATION_POLICIES.length) return POPULATION_POLICIES[x.index];
    return ColonyPopulationPolicy.Assimilate;
}

// Port of Main.Part3.cs:4203-4222 method_598 (index 0 = None = -1, else the facility's id).
export function readWonder(c: PanelControls, name: string, ctx: PolicyPanelContext): number {
    const x = combo(c, name);
    if (x !== null) {
        const selectedIndex = x.index;
        if (selectedIndex === 0) return -1;
        if (selectedIndex > 0 && selectedIndex <= ctx.facilities.length) return ctx.facilities[selectedIndex - 1].facilityId;
    }
    return -1;
}

// Port of Main.Part3.cs:4281-4292 dFwNhteflw (DesignDropDown.SelectedDesign; null when absent).
export function readDesign(c: PanelControls, name: string): unknown | null {
    const x = c.get(name);
    return x !== undefined && x.kind === 'design' ? x.design : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Build: port of Main.Part3.cs:4488-5341 method_609
// ---------------------------------------------------------------------------------------------------------------

const LOW_NORMAL_HIGH_VERYHIGH = ['Low', 'Normal', 'High', 'Very High'];
const LOW_NORMAL_HIGH = ['Low', 'Normal', 'High'];
const NONE_LOW_NORMAL_HIGH = ['None', 'Low', 'Normal', 'High'];
const WHEN_ESPIONAGE = ['Anytime', 'Disliked', 'No Treaty', 'Trade Sanctions or War', 'At War'];
const TAX_LEVELS = ['Zero', 'Low', 'Normal', 'High'];
const ATTACK_USE = [
    'At every opportunity',
    'Against empires we intensely dislike',
    'Against empires with Diabolical reputation',
    'Never',
];
const ENLIST_SHIP = [
    'Always Enlist',
    'When high tech or larger than we can build',
    'When NOT high tech or larger than we can build',
    'Never Enlist (always disassemble)',
];
const DISASSEMBLE_SHIP = [
    'Always immediately scrap for money',
    'Disassemble at base when high tech or larger than we can build',
    'Always disassemble at base for tech and resources',
];
/** Main.Part3.cs:4825-4861 method_609: the 34 "Tech emphasis" items (index = Galaxy.ResolveTechFocus index). */
export const TECH_FOCUS_OPTIONS = [
    'None', 'Beams', 'Phasers', 'Rail Guns', 'Torpedoes', 'Bombard Weapons', 'Missiles', 'Area Weapons', 'Ion Weapons',
    'Fighters', 'Armor', 'Shields', 'Reactors', 'Main Thrust Engines', 'Vectoring Engines', 'HyperDrives',
    'Hyper Disruption', 'Construction', 'Damage Control', 'Combat Targetting', 'Countermeasures', 'Sensors', 'Medicine',
    'Recreation', 'Tractor Beams', 'Assault Pods', 'Component Type Gravity Beam Weapon',
    'Component Type Gravity Area Weapon', 'Component Type Super Beam Weapon', 'Component Type Super Area Weapon',
    'Component Type Super Torpedo Weapon', 'Component Type Super Missile Weapon', 'Component Type Super RailGun Weapon',
    'Component Type Super Phaser Weapon',
];
/** Main.Part3.cs:5056-5084 method_609 design-upgrade check boxes (control name suffix = BuiltObjectSubRole name). */
export const DESIGN_UPGRADE_SUBROLES: readonly (keyof typeof BuiltObjectSubRole)[] = [
    'Escort', 'Frigate', 'Destroyer', 'Cruiser', 'CapitalShip', 'TroopTransport', 'Carrier', 'ResupplyShip',
    'ExplorationShip', 'ColonyShip', 'ConstructionShip', 'SmallSpacePort', 'MediumSpacePort', 'LargeSpacePort',
    'ResortBase', 'GenericBase', 'EnergyResearchStation', 'WeaponsResearchStation', 'HighTechResearchStation',
    'MonitoringStation', 'DefensiveBase', 'SmallFreighter', 'MediumFreighter', 'LargeFreighter', 'PassengerShip',
    'GasMiningShip', 'MiningShip', 'GasMiningStation', 'MiningStation',
];
/** Main.Part3.cs:4728-4753 / 3992-4004: the ColonyAllowFacility* / ColonyFacilityPopulationThreshold* order of the panel. */
const FACILITY_ROWS: readonly [string, string][] = [
    ['FortifiedBunker', 'Fortified Bunker'],
    ['TroopTrainingCenter', 'Troop Academy'],
    ['MilitaryAcademy', 'Military Academy'],
    ['RoboticTroopFoundry', 'Robotic Troop Foundry'],
    ['CloningFacility', 'Cloning Facility'],
    ['ArmoredFactory', 'Armored Factory'],
    ['PlanetaryShield', 'Planetary Shield'],
    ['GiantIonCannon', 'Giant Ion Cannon'],
    ['NavalAcademy', 'Naval Academy'],
    ['SpyAcademy', 'Spy Academy'],
    ['ScienceAcademy', 'Science Academy'],
    ['TerraformingFacility', 'Terraforming Facility'],
    ['RegionalCapital', 'Regional Capital'],
];

const lcFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/** Empire.3.cs:3577 CheckEmpireHasOwnedColonies: one port, buildOrder.ts. */
export { checkEmpireHasOwnedColonies };

/**
 * Port of Main.Part3.cs:4488-5341 method_609: the panel's sections, rows and each control's initial state, for
 * `empire` and its `policy` (method_595 passes _Game.PlayerEmpire and _Game.PlayerEmpire.Policy). Sections follow
 * the original's header bands (method_611) in order; rows the original hides for a pirate empire (flag) or a pirate
 * without owned colonies (!flag2) are left out, exactly as the C# never creates those controls.
 */
export function buildPolicyPanel(empire: Empire, policy: PolicyData, ctx: PolicyPanelContext): PolicySection[] {
    const flag = empire.pirateEmpireBaseHabitat !== null;
    const flag2 = flag && checkEmpireHasOwnedColonies(empire);
    const sections: PolicySection[] = [];
    let cur: PolicySection | null = null;
    const t = policyText;

    const section = (title: string, automation: AutomationRow[] = []): void => {
        cur = { title: t(title), automation, rows: [] };
        sections.push(cur);
    };
    const push = (row: PolicyRow): void => {
        cur!.rows.push(row);
    };
    // method_622: automation combo on the header band (SelectedIndex = the value when in range).
    const automation = (name: string, options: string[], value: number, reader: ComboReader): AutomationRow => {
        const opts = options.map(t);
        return { name, control: { kind: 'combo', reader, options: opts, index: selectIf(opts.length, value) } };
    };
    // method_624
    const check = (name: string, label: string, value: boolean, suffix = ''): void =>
        push({ name, label: t(label), suffix: suffix === '' ? '' : suffix, control: { kind: 'check', checked: value } });
    // method_625
    const numeric = (name: string, label: string, suffix: string, min: number, max: number, value: number): void =>
        push({ name, label: t(label), suffix, control: { kind: 'numeric', min, max, value: clampNumeric(Math.fround(value), min, max) } });
    // method_618 (priority fill)
    const priority = (name: string, label: string, options: string[], value: number, suffix = ''): void =>
        push({ name, label: t(label), suffix, control: { kind: 'combo', reader: 'priority', options: options.map(t), index: priorityIndex(value, options.length) } });
    // method_617 (level fill)
    const level = (name: string, label: string, value: number): void =>
        push({ name, label: t(label), suffix: '', control: { kind: 'combo', reader: 'level', options: NONE_LOW_NORMAL_HIGH.map(t), index: levelIndex(value, NONE_LOW_NORMAL_HIGH.length) } });
    // method_620 / method_621 (plain index fill)
    const indexed = (name: string, label: string, options: string[], value: number, reader: ComboReader = 'index', suffix = ''): void =>
        push({ name, label, suffix, control: { kind: 'combo', reader, options: options.map(t), index: plainIndex(value, options.length) } });

    const p = policy;
    const e = empire;
    if (!flag) {
        section('Diplomacy - Treaties', [
            automation('AutomationTreaties', ['Control manually', 'Suggest new treaties', 'Fully automate'], e.controlDiplomacyTreaties, 'automation'),
        ]);
        priority('TradePriority', 'Free Trade Agreement Priority', LOW_NORMAL_HIGH_VERYHIGH, p.tradePriority);
        priority('AlliancePriority', 'Mutual Defense Pact Priority', LOW_NORMAL_HIGH_VERYHIGH, p.alliancePriority);
        priority('BreakTreatyWillingness', 'Willingness to Break Treaties', LOW_NORMAL_HIGH_VERYHIGH, p.breakTreatyWillingness);
        section('Diplomacy - War and Trade Sanctions', [
            automation('AutomationWarTradeSanctions', ['Control manually', 'Suggest war and trade sanctions', 'Fully automate'], e.controlDiplomacyOffense, 'automation'),
        ]);
        check('DiplomacyTradeSanctionsUseBlockades', 'Use Blockades when have Trade Sanctions against an empire', p.diplomacyTradeSanctionsUseBlockades);
        priority('SubjugationPriority', 'Subjugation Priority', LOW_NORMAL_HIGH_VERYHIGH, p.subjugationPriority);
        priority('WarWillingness', 'Willingness to Go To War', LOW_NORMAL_HIGH_VERYHIGH, p.warWillingness);
        section('Diplomacy - Gifts', [
            automation('AutomationDiplomacyGifts', ['Control manually', 'Suggest gifts to empires', 'Fully automate'], e.controlDiplomacyGifts, 'automation'),
        ]);
        numeric('DiplomacySendGiftsUpToAmount', 'Send appropriate monetary gifts up to limit of', t('credits'), 0, 100000, p.diplomacySendGiftsUpToAmount);
    }
    section('Economy and Trade');
    check('EconomyTradeWithOtherEmpires', 'Trade with other Empires', p.tradeWithOtherEmpires);
    priority('ControlRestrictedResourcesPriority', 'Control Restricted Resources Priority', LOW_NORMAL_HIGH_VERYHIGH, p.controlRestrictedResourcesPriority);
    check('EconomyEngageInTourism', 'Engage in Tourism', p.engageInTourism);
    priority('TourismPriority', 'Tourism Priority', LOW_NORMAL_HIGH_VERYHIGH, p.tourismPriority);
    priority('ExplorationPriority', 'Exploration Priority', LOW_NORMAL_HIGH_VERYHIGH, p.explorationPriority);

    section('Intelligence - Mission Assignment', [
        automation('AutomationAgentAssignment', ['Control manually', 'Suggest offensive missions', 'Fully automate'], e.controlAgentAssignment, 'automation'),
    ]);
    numeric('IntelligenceCounterIntelligenceProportion', 'Proportion of Agents devoted to Counterintelligence', '%', 0, 100, p.intelligenceCounterIntelligenceProportion);
    check('IntelligenceAllowMissionStealTerritoryMap', 'Allow Espionage mission: Steal Territory Map', p.intelligenceAllowMissionStealTerritoryMap);
    check('IntelligenceAllowMissionStealGalaxyMap', 'Allow Espionage mission: Steal Galaxy Map', p.intelligenceAllowMissionStealGalaxyMap);
    check('IntelligenceAllowMissionStealOperationsMap', 'Allow Espionage mission: Steal Operations Map', p.intelligenceAllowMissionStealOperationsMap);
    check('IntelligenceAllowMissionStealTechData', 'Allow Espionage mission: Steal Tech', p.intelligenceAllowMissionStealTechData);
    check('IntelligenceAllowMissionSabotageColony', 'Allow Sabotage mission: Sabotage Colony', p.intelligenceAllowMissionSabotageColony);
    check('IntelligenceAllowMissionSabotageConstruction', 'Allow Sabotage mission: Sabotage construction', p.intelligenceAllowMissionSabotageConstruction);
    check('IntelligenceAllowMissionDestroyBase', 'Allow Sabotage mission: Destroy Base', p.intelligenceAllowMissionDestroyBase);
    check('IntelligenceAllowMissionInciteRevolution', 'Allow Sabotage mission: Incite Revolution', p.intelligenceAllowMissionInciteRevolution);
    check('IntelligenceAllowMissionAssassinateCharacter', 'Allow Sabotage mission: Assassinate Character', p.intelligenceAllowMissionAssassinateCharacter);
    check('IntelligenceAllowMissionDeepCover', 'Allow Espionage mission: Plant agent in Deep Cover', p.intelligenceAllowMissionDeepCover);
    indexed('IntelligenceUseEspionageAgainstEmpireWhen', t('Assign Espionage missions against empire when'), WHEN_ESPIONAGE, p.intelligenceUseEspionageAgainstEmpireWhen);
    indexed('IntelligenceUseSabotageAgainstEmpireWhen', t('Assign Sabotage missions against empire when'), WHEN_ESPIONAGE, p.intelligenceUseSabotageAgainstEmpireWhen);

    if (!flag || flag2) {
        // The C# passes the literal "Colonization" (no TextResolver) for this header.
        section('Colonization', [
            automation('AutomationColonization', ['Control manually', 'Suggest new colonies', 'Fully automate'], e.controlColonization, 'automation'),
        ]);
        priority('ColonizeContinentalPriority', 'Continental Planet Priority', LOW_NORMAL_HIGH_VERYHIGH, p.colonizeContinentalPriority);
        priority('ColonizeMarshySwampPriority', 'Marshy Swamp Planet Priority', LOW_NORMAL_HIGH_VERYHIGH, p.colonizeMarshySwampPriority);
        priority('ColonizeOceanPriority', 'Ocean Planet Priority', LOW_NORMAL_HIGH_VERYHIGH, p.colonizeOceanPriority);
        priority('ColonizeDesertPriority', 'Desert Planet Priority', LOW_NORMAL_HIGH_VERYHIGH, p.colonizeDesertPriority);
        priority('ColonizeIcePriority', 'Ice Planet Priority', LOW_NORMAL_HIGH_VERYHIGH, p.colonizeIcePriority);
        priority('ColonizeVolcanicPriority', 'Volcanic Planet Priority', LOW_NORMAL_HIGH_VERYHIGH, p.colonizeVolcanicPriority);
        priority('ColonizeRuinsPriority', 'Planets with Ruins Priority', LOW_NORMAL_HIGH_VERYHIGH, p.colonizeRuinsPriority);
        check('ColonyActionForNewTroopRecruitment', 'When establish new colony, always recruit new Troops', p.colonyActionForNewTroopRecruitment);
        // method_615 DesignDropDown of the player's buildable Base designs (Designs.GetDesignsByRoles(Base) +
        // StripUnbuildableDesigns). Read-only: choosing a design makes the colonize mission call
        // Empire.PurchaseNewBuiltObject, which is not ported (cmdTroops.ts throws on it).
        // TODO(port): DesignList.GetDesignsByRoles / StripUnbuildableDesigns + Empire.PurchaseNewBuiltObject — Main.Part3.cs:4710-4716, Empire.6.cs 1991.
        const design = p.colonyActionForNewBuildDesign;
        push({
            name: 'ColonyActionForNewBuildDesign',
            label: t('When establish new colony, immediately build this base'),
            suffix: '',
            control: { kind: 'design', design, label: design === null ? '(' + t('None') + ')' : String((design as { name?: string }).name ?? '') },
            readOnly: true,
        });
        const population = (name: string, label: string, value: ColonyPopulationPolicy): void =>
            push({ name, label: t(label), suffix: '', control: { kind: 'combo', reader: 'population', options: POPULATION_POLICY_TEXT.map(t), index: POPULATION_POLICIES.indexOf(value) } });
        population('NewColonyPopulationPolicyYourRaceFamily', 'Default Population Policy: Your Race Family', p.newColonyPopulationPolicyYourRaceFamily);
        population('NewColonyPopulationPolicyAllRaces', 'Default Population Policy: All Other Races', p.newColonyPopulationPolicyAllRaces);
        check('ImplementEnslavementWithPenalColonies', "Use Penal Colonies to implement 'Enslave' policy", p.implementEnslavementWithPenalColonies);

        section('Colonies - Facility Building', [
            automation('AutomationColonyFacilityBuilding', ['Control manually', 'Suggest new colony facilities', 'Fully automate'], e.controlColonyFacilities, 'automation'),
        ]);
        const pr = p as unknown as Record<string, number | boolean>;
        for (const [key, text] of FACILITY_ROWS) {
            check('ColonyAllowFacility' + key, 'Allow building facility: ' + text, pr[lcFirst('ColonyAllowFacility' + key)] as boolean);
        }
        for (const [key, text] of FACILITY_ROWS) {
            const name = 'ColonyFacilityPopulationThreshold' + key;
            numeric(name, 'Do not build ' + text + ' until population reaches', 'M', 0, 20000, pr[lcFirst(name)] as number);
        }
        const wonders = [t('None'), ...ctx.facilities.map((f) => f.name)];
        push({ name: 'PrioritizeBuildWonderId', label: t('Build Special Wonder'), suffix: '', control: { kind: 'combo', reader: 'wonder', options: wonders, index: wonderIndex(p.prioritizeBuildWonderId, wonders.length) } });

        section('Colonies - Tax Rates', [
            automation('AutomationColonyTaxRates', ['Control manually', 'Fully automate'], e.controlColonyTaxRates ? 1 : 0, 'bool'),
        ]);
        indexed('ColonyTaxRateSmallColony', formatNet(t('Tax Rate policy for small colonies (below X)'), ['200M']), TAX_LEVELS, p.colonyTaxRateSmallColony);
        indexed('ColonyTaxRateMediumColony', formatNet(t('Tax Rate policy for medium colonies (X - Y)'), ['200M', '2000M']), TAX_LEVELS, p.colonyTaxRateMediumColony);
        indexed('ColonyTaxRateLargeColony', formatNet(t('Tax Rate policy for large colonies (above X)'), ['2000M']), TAX_LEVELS, p.colonyTaxRateLargeColony);
        check('ColonyTaxRateIncreaseWhenAtWar', 'Increase colony tax rates when at War', p.colonyTaxRateIncreaseWhenAtWar);
    }

    // The C# passes the literal "Research && Design" (no TextResolver) for this header.
    section('Research && Design', [
        automation('AutomationResearch', ['Control Research manually', 'Fully automate Research'], e.controlResearch ? 1 : 0, 'bool'),
        automation('AutomationDesigns', ['Control Ship Design manually', 'Fully automate Ship Design'], e.controlDesigns ? 1 : 0, 'bool'),
    ]);
    priority('ResearchPriority', 'Research Priority', LOW_NORMAL_HIGH_VERYHIGH, p.researchPriority);
    indexed('ResearchDesignOverallFocus', t('Overall focus'), ['Balanced', 'Speed and Agility', 'Raw Power', 'Energy Efficiency'], p.researchDesignOverallFocus as number);
    indexed('ResearchIndustryFocus', t('Area focus'), ['Balanced', 'Weapons', 'Energy and Construction', 'HighTech and Industrial'], p.researchIndustryFocus as number, 'industry');
    const focusCats = [p.researchDesignTechFocus1, p.researchDesignTechFocus2, p.researchDesignTechFocus3, p.researchDesignTechFocus4, p.researchDesignTechFocus5, p.researchDesignTechFocus6];
    const focusTypes = [p.researchDesignTechFocusType1, p.researchDesignTechFocusType2, p.researchDesignTechFocusType3, p.researchDesignTechFocusType4, p.researchDesignTechFocusType5, p.researchDesignTechFocusType6];
    for (let i = 0; i < 6; i++) {
        // method_620(int_65: category == Undefined ? ResolveTechFocusIndex(type) : ResolveTechFocusIndex(category)).
        const idx = focusCats[i] === ComponentCategoryType.Undefined ? resolveTechFocusIndexType(focusTypes[i]) : resolveTechFocusIndexCategory(focusCats[i]);
        indexed('ResearchDesignTechFocus' + (i + 1), t('Tech emphasis ' + (i + 1)), TECH_FOCUS_OPTIONS, idx, 'techFocus');
    }
    check('ResearchDesignAutoRetrofit', 'Prompt for Retrofit when new tech becomes available', p.researchDesignAutoRetrofit);
    check('ResearchDesignAutoUpgradeFighters', 'Automatically upgrade fighters to latest', p.researchDesignAutoUpgradeFighters, '(' + t('when not in battle') + ')');
    // method_612 explanation, then the design upgrade check boxes (still under the Research & Design band).
    DESIGN_UPGRADE_SUBROLES.forEach((role, i) => {
        const field = lcFirst('DesignUpgrade' + role);
        push({
            name: 'DesignUpgrade' + role,
            label: resolveSubRoleDescription(BuiltObjectSubRole[role]),
            suffix: '',
            control: { kind: 'check', checked: (p as unknown as Record<string, boolean>)[field] },
            ...(i === 0 ? { note: t('Design Upgrade Explanation') } : {}),
        });
    });

    section('Construction', [
        automation('AutomationConstruction', ['Control manually', 'Suggest new ships and bases', 'Fully automate'], e.controlStateConstruction, 'automation'),
    ]);
    indexed('ConstructionMilitary', t('Military Construction Level'), LOW_NORMAL_HIGH, p.constructionMilitary);
    numeric('ConstructionMilitaryEscort', 'Military construction proportion: Escorts', '%', 0, 100, p.constructionMilitaryEscort);
    numeric('ConstructionMilitaryFrigate', 'Military construction proportion: Frigates', '%', 0, 100, p.constructionMilitaryFrigate);
    numeric('ConstructionMilitaryDestroyer', 'Military construction proportion: Destroyers', '%', 0, 100, p.constructionMilitaryDestroyer);
    numeric('ConstructionMilitaryCruiser', 'Military construction proportion: Cruisers', '%', 0, 100, p.constructionMilitaryCruiser);
    numeric('ConstructionMilitaryCapitalShip', 'Military construction proportion: Capital Ships', '%', 0, 100, p.constructionMilitaryCapitalShip);
    numeric('ConstructionMilitaryTroopTransport', 'Military construction proportion: Troop Transports', '%', 0, 100, p.constructionMilitaryTroopTransport);
    numeric('ConstructionMilitaryCarrier', 'Military construction proportion: Carriers', '%', 0, 100, p.constructionMilitaryCarrier);
    numeric('ConstructionSpaceportMinimumDistance', 'Minimum distance between new spaceports', 'K', 0, 2000, p.constructionSpaceportMinimumDistance);
    const spaceports = (): void => {
        numeric('ConstructionSpaceportSmallColonyPopulationThreshold', 'Minimum population for Small spaceport', 'M', 0, 1000, p.constructionSpaceportSmallColonyPopulationThreshold);
        numeric('ConstructionSpaceportMediumColonyPopulationThreshold', 'Minimum population for Medium spaceport', 'M', 0, 5000, p.constructionSpaceportMediumColonyPopulationThreshold);
        numeric('ConstructionSpaceportLargeColonyPopulationThreshold', 'Minimum population for Large spaceport', 'M', 0, 20000, p.constructionSpaceportLargeColonyPopulationThreshold);
    };
    if (!flag) {
        spaceports();
    } else {
        if (flag2) spaceports();
        level('PirateSmugglerFreighterLevel', 'Pirate Smuggler Freighter Construction Level', p.pirateSmugglerFreighterLevel);
        level('PirateSmugglerMiningLevel', 'Pirate Smuggler Miner Construction Level', p.pirateSmugglerMiningLevel);
        level('PirateSmugglerPassengerLevel', 'Pirate Smuggler Passenger Construction Level', p.pirateSmugglerPassengerLevel);
    }

    if (!flag || flag2) {
        section('Troop Recruitment', [
            automation('AutomationTroopRecruitment', ['Control manually', 'Fully automate'], e.controlTroopGeneration ? 1 : 0, 'bool'),
        ]);
        numeric('ColonyPopulationThresholdTroopRecruitment', 'Never recruit Troops until colony population reaches', 'M', 0, 10000, p.colonyPopulationThresholdTroopRecruitment);
        numeric('TroopGarrisonMinimumPerColony', 'Minimum number of Troop Units per Colony', '(' + t('overrides recruitment setting above') + ')', 0, 100, p.troopGarrisonMinimumPerColony);
        level('TroopGarrisonLevel', 'Troop Garrison Level at Colonies', p.troopGarrisonLevel);
        priority('TroopRecruitInfantryLevel', 'Infantry Recruitment Level', LOW_NORMAL_HIGH, p.troopRecruitInfantryLevel);
        priority('TroopRecruitArmorLevel', 'Armor Recruitment Level', LOW_NORMAL_HIGH, p.troopRecruitArmorLevel);
        priority('TroopRecruitArtilleryLevel', 'Artillery Recruitment Level', LOW_NORMAL_HIGH, p.troopRecruitArtilleryLevel);
        priority('TroopRecruitSpecialForcesLevel', 'Special Forces Recruitment Level', LOW_NORMAL_HIGH, p.troopRecruitSpecialForcesLevel);
        check('TroopUseDefaultTransportLoadout', 'Use Default Troop Transport Loadouts', p.troopUseDefaultTransportLoadout);
        numeric('TroopDefaultTransportLoadoutInfantry', 'Default Infantry Loadout', '%', 0, 100, Math.fround(p.troopDefaultTransportLoadoutInfantry * 100));
        numeric('TroopDefaultTransportLoadoutArmor', 'Default Armor Loadout', '%', 0, 100, Math.fround(p.troopDefaultTransportLoadoutArmor * 100));
        numeric('TroopDefaultTransportLoadoutArtillery', 'Default Artillery Loadout', '%', 0, 100, Math.fround(p.troopDefaultTransportLoadoutArtillery * 100));
        numeric('TroopDefaultTransportLoadoutSpecialForces', 'Default Special Forces Loadout', '%', 0, 100, Math.fround(p.troopDefaultTransportLoadoutSpecialForces * 100));
    }

    section('War && Attacks', [
        automation('AutomationAttackTargets', ['Control manually', 'Suggest attack targets', 'Fully automate'], e.controlMilitaryAttacks, 'automation'),
    ]);
    indexed('WarAttacksAllowColonyBombardment', t('Use bombardment against enemy colonies'), ATTACK_USE, p.warAttacksAllowColonyBombardment);
    indexed('WarAttacksAllowPlanetDestroying', t('Use planet destroyers against enemy colonies'), ATTACK_USE, p.warAttacksAllowPlanetDestroying);
    if (!flag) {
        check('WarAttacksHarassEnemies', 'Harass enemies with attacks of opportunity', p.warAttacksHarassEnemies);
        indexed('OfferPirateAttackMissions', t('Offer Pirate Attack Missions'), ['Never', 'When at War with empire', 'When dislike empire', 'Whenever opportune target available'], p.offerPirateAttackMissions);
        indexed('OfferDefensivePirateMissionsSituation', t('When Offer Pirate Defense Missions'), ['Never', 'When at War', 'At any time'], p.offerDefensivePirateMissionsSituation);
        indexed('OfferDefensivePirateMissions', t('Who Offer Pirate Defense Missions To'), ['Never', 'To pirates we trust', 'To any pirates with protection arrangement'], p.offerDefensivePirateMissions);
        indexed('OfferSmugglingPirateMissions', t('Offer Pirate Smuggling Missions'), ['Never', 'When at War', 'At any time'], p.offerSmugglingPirateMissions);
        priority('HomeworldDefensePriority', 'Homeworld Defense Priority', LOW_NORMAL_HIGH_VERYHIGH, p.homeworldDefensePriority);
        check('ProtectLeaderAtAllCosts', 'Protect Leader At All Costs', p.protectLeaderAtAllCosts);
        priority('InvasionOverkillFactor', 'Colony Invasion Overkill Factor', LOW_NORMAL_HIGH_VERYHIGH, p.invasionOverkillFactor, t('Invasion Overkill Explanation'));
    }
    priority('ShipBattleCautionFactor', 'Ship Battle Caution Factor', LOW_NORMAL_HIGH_VERYHIGH, p.shipBattleCautionFactor, t('Ship Battle Caution Explanation'));
    const flee = ['Flee When Never', 'Flee When Shields 20', 'Flee When Shields 50'];
    push({ name: 'DefaultMilitaryFleeWhen', label: t("Default 'Flee When' Stance for Military ships"), suffix: t('Flee When Explanation'), control: { kind: 'combo', reader: 'fleeWhen', options: flee.map(t), index: fleeWhenIndex(p.defaultMilitaryFleeWhen as number as BuiltObjectFleeWhen, flee.length) } });
    check('UseExplorationShipsToScoutEnemySystems', 'Use Exploration Ships to scout enemy systems', p.useExplorationShipsToScoutEnemySystems);
    check('BuildPlanetDestroyers', 'Build Planet Destroyers when able', p.buildPlanetDestroyers);
    if (flag) {
        section('Pirates');
        check('BidOnPirateAttackMissions', 'Bid on Pirate Attack Missions', p.bidOnPirateAttackMissions);
        check('BidOnPirateDefendMissions', 'Bid on Pirate Defend Missions', p.bidOnPirateDefendMissions);
        check('AcceptPirateSmugglingMissions', 'Accept Pirate Smuggling Missions', p.acceptPirateSmugglingMissions);
    }

    section('Boarding && Capture');
    indexed('CaptureTargetConditionShip', t('Capture targeted ships'), ['Never (always destroy)', 'When high tech or larger than we can build', 'When stronger than target', 'Always capture'], p.captureTargetConditionShip);
    indexed('CaptureTargetConditionBase', t('Capture targeted bases'), ['Never (always destroy)', 'When base in own territory', 'When base in own or neutral territory', 'When stronger than target', 'Always capture'], p.captureTargetConditionBase);
    indexed('CaptureEnlistMilitaryShip', t('Enlist captured Military ships'), ENLIST_SHIP, p.captureEnlistMilitaryShip);
    indexed('CaptureDisassembleMilitaryShip', t('How Disassemble captured Military ships'), DISASSEMBLE_SHIP, p.captureDisassembleMilitaryShip);
    check('UpgradeEnlistedMilitaryShips', 'Upgrade enlisted Military ships to latest design', p.upgradeEnlistedMilitaryShips);
    indexed('CaptureEnlistCivilianShip', t('Enlist captured Civilian ships'), ENLIST_SHIP, p.captureEnlistCivilianShip);
    indexed('CaptureDisassembleCivilianShip', t('How Disassemble captured Civilian ships'), DISASSEMBLE_SHIP, p.captureDisassembleCivilianShip);
    check('UpgradeEnlistedCivilianShips', 'Upgrade enlisted Civilian ships to latest design', p.upgradeEnlistedCivilianShips);
    indexed('CaptureEnlistBase', t('Enlist captured Bases'), ['Always Enlist', 'Scrap when not Research Station', 'Always Scrap'], p.captureEnlistBase);

    // The C# passes the literal "Fleet Formation" (no TextResolver) for this header.
    section('Fleet Formation', [
        automation('AutomationFleets', ['Control manually', 'Fully automate'], e.controlMilitaryFleets ? 1 : 0, 'bool'),
    ]);
    numeric('FleetMilitaryProportionForFleets', 'Proportion of Military ships assigned to Fleets && Strike Forces', '%', 20, 80, p.fleetMilitaryProportionForFleets);
    numeric('FleetTypicalSize', 'Typical number of ships in Fleet', '', 2, 50, p.fleetTypicalSize);
    numeric('FleetStrikeForceTypicalSize', 'Typical number of ships in Strike Force', '', 2, 15, p.fleetStrikeForceTypicalSize);
    return sections;
}

/** Every control of the panel by C# name (the WinForms panel's Controls collection). */
export function panelControls(sections: readonly PolicySection[]): Map<string, PolicyControl> {
    const m = new Map<string, PolicyControl>();
    for (const s of sections) {
        for (const a of s.automation) m.set(a.name, a.control);
        for (const r of s.rows) m.set(r.name, r.control);
    }
    return m;
}

/** The Empire Control* fields the panel's automation combos edit. */
export type PolicyAutomationField =
    | 'controlColonization'
    | 'controlColonyFacilities'
    | 'controlColonyTaxRates'
    | 'controlDiplomacyGifts'
    | 'controlDiplomacyOffense'
    | 'controlDiplomacyTreaties'
    | 'controlTroopGeneration'
    | 'controlAgentAssignment'
    | 'controlDesigns'
    | 'controlMilitaryAttacks'
    | 'controlMilitaryFleets'
    | 'controlResearch'
    | 'controlStateConstruction';

/** Main.Part3.cs:3974-3992 method_597, in order: [control name, Empire field, level | bool, only for a non-pirate player]. */
export const POLICY_AUTOMATION_CONTROLS: readonly (readonly [string, PolicyAutomationField, 'level' | 'bool', boolean])[] = [
    ['AutomationColonization', 'controlColonization', 'level', true],
    ['AutomationColonyFacilityBuilding', 'controlColonyFacilities', 'level', true],
    ['AutomationColonyTaxRates', 'controlColonyTaxRates', 'bool', true],
    ['AutomationDiplomacyGifts', 'controlDiplomacyGifts', 'level', true],
    ['AutomationWarTradeSanctions', 'controlDiplomacyOffense', 'level', true],
    ['AutomationTreaties', 'controlDiplomacyTreaties', 'level', true],
    ['AutomationTroopRecruitment', 'controlTroopGeneration', 'bool', true],
    ['AutomationAgentAssignment', 'controlAgentAssignment', 'level', false],
    ['AutomationDesigns', 'controlDesigns', 'bool', false],
    ['AutomationAttackTargets', 'controlMilitaryAttacks', 'level', false],
    ['AutomationFleets', 'controlMilitaryFleets', 'bool', false],
    ['AutomationResearch', 'controlResearch', 'bool', false],
    ['AutomationConstruction', 'controlStateConstruction', 'level', false],
];

/**
 * Write one automation value onto the empire through the Game Options panel's setter (task 16d, Main.Part6.cs:2544
 * method_419), which the coordinator asked the two panels to share. For the indices the combos can hold (0-2) it is
 * the method_597 cast `(AutomationLevel)index` / `Convert.ToBoolean(index)`.
 */
export function setPolicyAutomation(empire: Empire, field: PolicyAutomationField, value: number | boolean): void {
    const row = AUTOMATION_ROWS.find((r) => r.field === field);
    if (row === undefined) throw new Error(`no Game Options automation row for ${field}`);
    setAutomationValue(empire, row, value);
}

/** One Empire Control* change the panel makes (the field and its value as setAutomationValue would write them). */
export interface PolicyAutomationChange {
    field: string;
    value: AutomationLevel | boolean;
}

/**
 * The automation write applyPolicyPanel would make for one control, or null when the empire already has that value.
 * The Empire Policy screen issues these as `setEmpireControl` commands instead of writing the empire (a screen never
 * writes the game: in worker mode it is a read-only replica, and in-thread the write would bypass the command log).
 * `sent`: values already issued for a field and possibly not on the replica yet (a change X → Y → X within one worker
 * round trip must still send the X).
 */
export function policyAutomationChange(empire: Empire, field: PolicyAutomationField, value: number | boolean, sent?: ReadonlyMap<string, unknown>): PolicyAutomationChange | null {
    const row = AUTOMATION_ROWS.find((r) => r.field === field);
    if (row === undefined) throw new Error(`no Game Options automation row for ${field}`);
    const fv = automationFieldValue(row, value);
    const current = sent !== undefined && sent.has(fv.field) ? sent.get(fv.field) : (empire as unknown as Record<string, unknown>)[fv.field];
    return current === fv.value ? null : { field: fv.field, value: fv.value };
}

// ---------------------------------------------------------------------------------------------------------------
// Apply: port of Main.Part3.cs:3971-4201 method_597
// ---------------------------------------------------------------------------------------------------------------

/**
 * Port of Main.Part3.cs:3971-4201 method_597: write the Control* automation settings back onto `empire` (the
 * colony / diplomacy / troop ones only when the *player* is not a pirate — `_Game.PlayerEmpire.PirateEmpireBaseHabitat
 * == null`) and return a new EmpirePolicy built from the class defaults with every panel value read back through the
 * same reader and conversion. The caller assigns it: WqesexberY_Click `_Game.PlayerEmpire.Policy = method_597(...)`.
 * `setAutomation` replaces the automation write (default: setPolicyAutomation on `empire`); the screen passes one that
 * collects policyAutomationChange commands.
 */
export function applyPolicyPanel(
    empire: Empire,
    playerIsPirate: boolean,
    c: PanelControls,
    ctx: PolicyPanelContext,
    setAutomation: (field: PolicyAutomationField, value: number | boolean) => void = (field, value) => setPolicyAutomation(empire, field, value),
): PolicyData {
    const p = defaultEmpirePolicy(); // new EmpirePolicy()
    const idx = (n: string): number => readIndex(c, n);
    for (const [name, field, kind, colonyOnly] of POLICY_AUTOMATION_CONTROLS) {
        // Only when the player is not a pirate: _Game.PlayerEmpire.PirateEmpireBaseHabitat == null (3974).
        if (colonyOnly && playerIsPirate) continue;
        // (AutomationLevel)method_605(...) / Convert.ToBoolean(method_605(...)).
        setAutomation(field, kind === 'bool' ? idx(name) !== 0 : idx(name));
    }

    const num = (n: string): number => readNumeric(c, n);
    const int = (n: string): number => Math.trunc(readNumeric(c, n)); // (int)method_604
    const chk = (n: string): boolean => readCheck(c, n);
    const pri = (n: string): number => readPriority(c, n);
    const lvl = (n: string): number => readLevel(c, n);

    p.intelligenceCounterIntelligenceProportion = num('IntelligenceCounterIntelligenceProportion');
    p.diplomacySendGiftsUpToAmount = int('DiplomacySendGiftsUpToAmount');
    const pr = p as unknown as Record<string, number | boolean>;
    for (const key of ['FortifiedBunker', 'TroopTrainingCenter', 'RoboticTroopFoundry', 'CloningFacility', 'PlanetaryShield', 'GiantIonCannon', 'RegionalCapital', 'TerraformingFacility', 'ArmoredFactory', 'SpyAcademy', 'ScienceAcademy', 'NavalAcademy', 'MilitaryAcademy']) {
        pr[lcFirst('ColonyFacilityPopulationThreshold' + key)] = int('ColonyFacilityPopulationThreshold' + key);
    }
    p.colonyPopulationThresholdTroopRecruitment = int('ColonyPopulationThresholdTroopRecruitment');
    p.constructionMilitaryEscort = num('ConstructionMilitaryEscort');
    p.constructionMilitaryFrigate = num('ConstructionMilitaryFrigate');
    p.constructionMilitaryDestroyer = num('ConstructionMilitaryDestroyer');
    p.constructionMilitaryCruiser = num('ConstructionMilitaryCruiser');
    p.constructionMilitaryCapitalShip = num('ConstructionMilitaryCapitalShip');
    p.constructionMilitaryCarrier = num('ConstructionMilitaryCarrier');
    p.constructionMilitaryTroopTransport = num('ConstructionMilitaryTroopTransport');
    p.constructionSpaceportMinimumDistance = int('ConstructionSpaceportMinimumDistance');
    p.constructionSpaceportSmallColonyPopulationThreshold = int('ConstructionSpaceportSmallColonyPopulationThreshold');
    p.constructionSpaceportMediumColonyPopulationThreshold = int('ConstructionSpaceportMediumColonyPopulationThreshold');
    p.constructionSpaceportLargeColonyPopulationThreshold = int('ConstructionSpaceportLargeColonyPopulationThreshold');
    p.fleetMilitaryProportionForFleets = num('FleetMilitaryProportionForFleets');
    p.fleetTypicalSize = int('FleetTypicalSize');
    p.fleetStrikeForceTypicalSize = int('FleetStrikeForceTypicalSize');
    p.intelligenceAllowMissionStealTerritoryMap = chk('IntelligenceAllowMissionStealTerritoryMap');
    p.intelligenceAllowMissionStealGalaxyMap = chk('IntelligenceAllowMissionStealGalaxyMap');
    p.intelligenceAllowMissionStealOperationsMap = chk('IntelligenceAllowMissionStealOperationsMap');
    p.intelligenceAllowMissionSabotageColony = chk('IntelligenceAllowMissionSabotageColony');
    p.intelligenceAllowMissionSabotageConstruction = chk('IntelligenceAllowMissionSabotageConstruction');
    p.intelligenceAllowMissionStealTechData = chk('IntelligenceAllowMissionStealTechData');
    p.intelligenceAllowMissionInciteRevolution = chk('IntelligenceAllowMissionInciteRevolution');
    p.intelligenceAllowMissionDeepCover = chk('IntelligenceAllowMissionDeepCover');
    p.intelligenceAllowMissionAssassinateCharacter = chk('IntelligenceAllowMissionAssassinateCharacter');
    p.intelligenceAllowMissionDestroyBase = chk('IntelligenceAllowMissionDestroyBase');
    p.diplomacyTradeSanctionsUseBlockades = chk('DiplomacyTradeSanctionsUseBlockades');
    p.colonyActionForNewTroopRecruitment = chk('ColonyActionForNewTroopRecruitment');
    for (const key of ['FortifiedBunker', 'TroopTrainingCenter', 'RoboticTroopFoundry', 'CloningFacility', 'PlanetaryShield', 'GiantIonCannon', 'RegionalCapital', 'TerraformingFacility', 'ArmoredFactory', 'SpyAcademy', 'ScienceAcademy', 'NavalAcademy', 'MilitaryAcademy']) {
        pr[lcFirst('ColonyAllowFacility' + key)] = chk('ColonyAllowFacility' + key);
    }
    p.colonyTaxRateIncreaseWhenAtWar = chk('ColonyTaxRateIncreaseWhenAtWar');
    p.researchDesignAutoRetrofit = chk('ResearchDesignAutoRetrofit');
    p.warAttacksHarassEnemies = chk('WarAttacksHarassEnemies');
    p.researchDesignAutoUpgradeFighters = chk('ResearchDesignAutoUpgradeFighters');
    p.tradeWithOtherEmpires = chk('EconomyTradeWithOtherEmpires');
    p.engageInTourism = chk('EconomyEngageInTourism');
    p.implementEnslavementWithPenalColonies = chk('ImplementEnslavementWithPenalColonies');
    p.intelligenceUseEspionageAgainstEmpireWhen = idx('IntelligenceUseEspionageAgainstEmpireWhen');
    p.intelligenceUseSabotageAgainstEmpireWhen = idx('IntelligenceUseSabotageAgainstEmpireWhen');
    p.colonyActionForNewBuildDesign = readDesign(c, 'ColonyActionForNewBuildDesign');
    p.newColonyPopulationPolicyYourRaceFamily = readPopulationPolicy(c, 'NewColonyPopulationPolicyYourRaceFamily');
    p.newColonyPopulationPolicyAllRaces = readPopulationPolicy(c, 'NewColonyPopulationPolicyAllRaces');
    p.colonyTaxRateSmallColony = idx('ColonyTaxRateSmallColony');
    p.colonyTaxRateMediumColony = idx('ColonyTaxRateMediumColony');
    p.colonyTaxRateLargeColony = idx('ColonyTaxRateLargeColony');
    p.researchDesignOverallFocus = idx('ResearchDesignOverallFocus') as PolicyData['researchDesignOverallFocus'];
    // Galaxy.ResolveTechFocus(method_605(...), out category, out type) per slot; the TS keeps the derived
    // researchDesignTechFocus[] view (read by resolveTechFocuses) in step with the six field pairs.
    for (let slot = 1; slot <= 6; slot++) {
        const { category, type } = resolveTechFocus(idx('ResearchDesignTechFocus' + slot));
        pr['researchDesignTechFocus' + slot] = category;
        pr['researchDesignTechFocusType' + slot] = type;
        p.researchDesignTechFocus[slot - 1] = { category, type };
    }
    p.constructionMilitary = idx('ConstructionMilitary');
    p.warAttacksAllowColonyBombardment = idx('WarAttacksAllowColonyBombardment');
    p.warAttacksAllowPlanetDestroying = idx('WarAttacksAllowPlanetDestroying');
    p.homeworldDefensePriority = pri('HomeworldDefensePriority');
    p.protectLeaderAtAllCosts = chk('ProtectLeaderAtAllCosts');
    p.prioritizeBuildWonderId = readWonder(c, 'PrioritizeBuildWonderId', ctx);
    p.colonizeContinentalPriority = pri('ColonizeContinentalPriority');
    p.colonizeMarshySwampPriority = pri('ColonizeMarshySwampPriority');
    p.colonizeOceanPriority = pri('ColonizeOceanPriority');
    p.colonizeDesertPriority = pri('ColonizeDesertPriority');
    p.colonizeIcePriority = pri('ColonizeIcePriority');
    p.colonizeVolcanicPriority = pri('ColonizeVolcanicPriority');
    p.colonizeRuinsPriority = pri('ColonizeRuinsPriority');
    p.controlRestrictedResourcesPriority = pri('ControlRestrictedResourcesPriority');
    p.researchIndustryFocus = readIndustry(c, 'ResearchIndustryFocus');
    p.researchPriority = pri('ResearchPriority');
    p.tradePriority = pri('TradePriority');
    p.alliancePriority = pri('AlliancePriority');
    p.subjugationPriority = pri('SubjugationPriority');
    p.tourismPriority = pri('TourismPriority');
    p.explorationPriority = pri('ExplorationPriority');
    p.warWillingness = pri('WarWillingness');
    p.breakTreatyWillingness = pri('BreakTreatyWillingness');
    p.invasionOverkillFactor = pri('InvasionOverkillFactor');
    p.shipBattleCautionFactor = pri('ShipBattleCautionFactor');
    p.defaultMilitaryFleeWhen = readFleeWhen(c, 'DefaultMilitaryFleeWhen') as number as PolicyData['defaultMilitaryFleeWhen'];
    for (const role of DESIGN_UPGRADE_SUBROLES) pr[lcFirst('DesignUpgrade' + role)] = chk('DesignUpgrade' + role);
    p.captureTargetConditionShip = idx('CaptureTargetConditionShip');
    p.captureTargetConditionBase = idx('CaptureTargetConditionBase');
    p.offerPirateAttackMissions = idx('OfferPirateAttackMissions');
    p.bidOnPirateAttackMissions = chk('BidOnPirateAttackMissions');
    p.captureEnlistMilitaryShip = idx('CaptureEnlistMilitaryShip');
    p.captureDisassembleMilitaryShip = idx('CaptureDisassembleMilitaryShip');
    p.captureEnlistCivilianShip = idx('CaptureEnlistCivilianShip');
    p.captureDisassembleCivilianShip = idx('CaptureDisassembleCivilianShip');
    p.captureEnlistBase = idx('CaptureEnlistBase');
    p.upgradeEnlistedMilitaryShips = chk('UpgradeEnlistedMilitaryShips');
    p.upgradeEnlistedCivilianShips = chk('UpgradeEnlistedCivilianShips');
    p.bidOnPirateDefendMissions = chk('BidOnPirateDefendMissions');
    p.acceptPirateSmugglingMissions = chk('AcceptPirateSmugglingMissions');
    p.offerDefensivePirateMissionsSituation = idx('OfferDefensivePirateMissionsSituation');
    p.offerSmugglingPirateMissions = idx('OfferSmugglingPirateMissions');
    p.offerDefensivePirateMissions = idx('OfferDefensivePirateMissions');
    p.pirateSmugglerFreighterLevel = lvl('PirateSmugglerFreighterLevel');
    p.pirateSmugglerMiningLevel = lvl('PirateSmugglerMiningLevel');
    p.pirateSmugglerPassengerLevel = lvl('PirateSmugglerPassengerLevel');
    p.troopRecruitInfantryLevel = pri('TroopRecruitInfantryLevel');
    p.troopRecruitArmorLevel = pri('TroopRecruitArmorLevel');
    p.troopRecruitArtilleryLevel = pri('TroopRecruitArtilleryLevel');
    p.troopRecruitSpecialForcesLevel = pri('TroopRecruitSpecialForcesLevel');
    p.troopUseDefaultTransportLoadout = chk('TroopUseDefaultTransportLoadout');
    p.troopDefaultTransportLoadoutInfantry = Math.fround(num('TroopDefaultTransportLoadoutInfantry') / 100);
    p.troopDefaultTransportLoadoutArmor = Math.fround(num('TroopDefaultTransportLoadoutArmor') / 100);
    p.troopDefaultTransportLoadoutArtillery = Math.fround(num('TroopDefaultTransportLoadoutArtillery') / 100);
    p.troopDefaultTransportLoadoutSpecialForces = Math.fround(num('TroopDefaultTransportLoadoutSpecialForces') / 100);
    p.troopGarrisonMinimumPerColony = int('TroopGarrisonMinimumPerColony');
    p.troopGarrisonLevel = lvl('TroopGarrisonLevel');
    p.useExplorationShipsToScoutEnemySystems = chk('UseExplorationShipsToScoutEnemySystems');
    p.buildPlanetDestroyers = chk('BuildPlanetDestroyers');
    // TODO(port): gameOptions_0.Control*Default / ApplyDesignUpgradePoliciesToGameOptions / DefaultEmpirePolicy
    // (Main.Part3.cs:4179-4198) — GameOptions persistence is not ported.
    return p;
}

/** The context for `empire`'s galaxy: Galaxy.PlanetaryFacilityDefinitions (galaxy.researchStatic.facilities). */
export function policyPanelContext(facilities: readonly { facilityId: number; name: string }[]): PolicyPanelContext {
    return { facilities };
}

/** Automation level names (AutomationLevel.cs: Manual, SemiAutomated, FullyAutomated). */
export const AUTOMATION_LEVEL_NAMES: Record<AutomationLevel, string> = {
    [AutomationLevel.Undefined]: 'Manual',
    [AutomationLevel.PartiallyAutomated]: 'SemiAutomated',
    [AutomationLevel.FullyAutomated]: 'FullyAutomated',
};
