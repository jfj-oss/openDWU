// Task 17f: the player's ship design editor, as game logic (no DOM). Ported from the UI-side C# in
// DistantWorlds/Main.Part6.cs (PrepareDesignForEditor 45, btnDesignsSaveDesign_Click 164,
// GetDesignWarningMessages 226, cmbDesignsSubRole_SelectedIndexChanged 882, method_388 908,
// btnDesignsAddNew_Click 1047, btnDesignsCopyAsNew_Click 1060, btnDesignsDelete_Click 1114),
// Main.Part7.cs (btnDesignsEdit_Click 4839, btnDesignsCancel_Click 4889, btnAddComponentToDesign[Multiple]_Click
// 4984 / 5015, btnRemoveComponentFromDesign[Multiple]_Click 5044 / 5089), Main.Part8.cs (btnDesignsUpgradeManual_Click
// 926, ctlDesignsList_CellClick Obsolete / Upgrade columns 1082-1122), Main.Part9.cs method_290 (the component
// toolbox) and DistantWorlds.Types/Empire.10.cs (SetDesignSubRoleShouldBeUpgraded 3124,
// CheckDesignInUseForConstructionOrRetrofits 308).
//
// Messages are GameText keys encoded like colonyTick.ts gameText() ("key|arg0|…"); the screen resolves them with
// textResolver.resolveGameText. Player input only: nothing here draws galaxy.rnd. (BaconDesign.SetPictureRef, the
// Design.PictureRef setter, draws Galaxy.Rnd only for non-player designs; the editor only edits player designs.)
//
// The C# editor pauses the game while it is open (Main.Part8.cs:46 OpenDesignEditor → method_154) and edits the
// selected design object in place; this port edits a working copy (DesignDraft.design) and writes it back on save,
// so the running sim never sees a half-edited design. The saved end state is the same object the C# ends with
// (Empire.Designs[num] stays the same Design instance for Edit / View).

import { Design, BuiltObjectStance } from '../design';
import type { Empire } from '../empire';
import type { Galaxy } from '../galaxy';
import type { ComponentDefinition } from '../componentStatic';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { ComponentType } from '../data/components';
import { ComponentCategoryType } from '../data/policies';
import {
    BattleTactics,
    BuiltObjectFleeWhen,
    BuiltObjectRole,
    InvasionTactics,
    resolveBuiltObjectRole,
} from '../data/designSpecifications';
import { splitString } from '../data/gameText';
import { getText } from '../textResolver';
import { gameText } from '../colonyTick';
import { cloneDesign } from '../gameStartTail';
import { galaxyCurrentStarDate } from '../pirateRelations';
import { checkDesignSubRoleShouldBeUpgraded, resolveLegacySubRole, resolveSubRoleDescription } from '../designGeneration';
import { determineResourcesEmpireSupplies } from '../diplomacyTick';

const S = BuiltObjectSubRole;
const T = ComponentType;
const C = ComponentCategoryType;

/** Main.cs string_16: the editor mode ("addnew", "copyasnew", "edit", "view"). */
export type DesignEditorMode = 'addnew' | 'copyasnew' | 'edit' | 'view';

/** The editor's state: Main.cs design_0 (working design), string_16 (mode), design_2 (design made obsolete on save). */
export interface DesignDraft {
    /** design_0: the design being edited (a working copy for Edit / View). */
    design: Design;
    mode: DesignEditorMode;
    /** Edit / View: the Empire.Designs entry the working copy is written back to (the C# edits it in place). */
    target: Design | null;
    /** design_2: set by btnDesignsUpgradeManual_Click; marked obsolete when the new design is saved. */
    replaces: Design | null;
}

/** Where a new editor session starts from (the Designs panel buttons). */
export type DesignDraftSource =
    /** btnDesignsAddNew_Click; with `subRole`, followed by choosing it in cmbDesignsSubRole. */
    | { kind: 'blank'; subRole?: BuiltObjectSubRole }
    /** btnDesignsCopyAsNew_Click. */
    | { kind: 'copy'; design: Design }
    /** btnDesignsUpgradeManual_Click: copy the template design and obsolete it on save. */
    | { kind: 'upgrade'; design: Design }
    /** btnDesignsEdit_Click (View when the design is in use). */
    | { kind: 'edit'; design: Design };

export interface DesignWarnings {
    /** Red warnings: must be resolved before saving. */
    mustDo: string[];
    /** Advisory warnings. */
    shouldDo: string[];
}

export interface EditorResult {
    ok: boolean;
    /** GameText-encoded message the original shows (message box text). */
    message?: string;
    /** GameText-encoded message box title. */
    title?: string;
}

export interface SaveDesignResult extends EditorResult, DesignWarnings {
    /** The design now in Empire.Designs (on success). */
    design: Design | null;
}

export interface DeleteDesignResult extends EditorResult {
    deleted: Design[];
}

// ---------------------------------------------------------------------------
// Galaxy.ResolveDescription overloads the warnings format in (Galaxy.2.cs).
// ---------------------------------------------------------------------------

// Port of Galaxy.2.cs:2224 ResolveDescription(ComponentCategoryType).
export function resolveComponentCategoryDescription(category: ComponentCategoryType): string {
    switch (category) {
        case C.Armor: return getText('Component Category Armor');
        case C.Computer: return getText('Component Category Computer');
        case C.Construction: return getText('Component Category Construction');
        case C.EnergyCollector: return getText('Component Category EnergyCollector');
        case C.Engine: return getText('Component Category Engine');
        case C.Extractor: return getText('Component Category Extractor');
        case C.Habitation: return getText('Component Category Habitation');
        case C.HyperDrive: return getText('Component Category HyperDrive');
        case C.Labs: return getText('Component Category Labs');
        case C.Manufacturer: return getText('Component Category Manufacturer');
        case C.Reactor: return getText('Component Category Reactor');
        case C.Sensor: return getText('Component Category Sensor');
        case C.Shields: return getText('Component Category Shields');
        case C.Storage: return getText('Component Category Storage');
        case C.WeaponArea: return getText('Component Category WeaponArea');
        case C.WeaponBeam: return getText('Component Category WeaponBeam');
        case C.WeaponSuperArea: return getText('Component Category WeaponSuperArea');
        case C.WeaponSuperBeam: return getText('Component Category WeaponSuperBeam');
        case C.WeaponSuperTorpedo: return getText('Component Category WeaponSuperTorpedo');
        case C.WeaponTorpedo: return getText('Component Category WeaponTorpedo');
        case C.WeaponIon: return getText('Component Category Ion Weapon');
        case C.WeaponPointDefense: return getText('Component Category Point Defense Weapon');
        case C.WeaponGravity: return getText('Component Category WeaponGravity');
        case C.AssaultPod: return getText('Component Category AssaultPod');
        case C.Undefined: return getText('None');
        default: return splitString(C[category] ?? String(category));
    }
}

/** Galaxy.2.cs:2339 ResolveDescription(ComponentType): "Component Type <suffix>" GameText keys. */
const COMPONENT_TYPE_KEYS: Partial<Record<ComponentType, string>> = {
    [T.SensorStealth]: 'Stealth',
    [T.DamageControl]: 'Damage Control',
    [T.ComputerCommandCenter]: 'Command Center',
    [T.ComputerCommerceCenter]: 'Commerce Center',
    [T.ComputerCountermeasures]: 'Countermeasures',
    [T.ComputerTargetting]: 'Targetting',
    [T.ConstructionBuild]: 'Construction Yard',
    [T.EngineMainThrust]: 'Main Thrust Engine',
    [T.EngineVectoring]: 'Vectoring Engine',
    [T.ExtractorGasExtractor]: 'Gas Extractor',
    [T.ExtractorLuxury]: 'Luxury Resource Extractor',
    [T.ExtractorMine]: 'Mine',
    [T.HabitationColonization]: 'Colony',
    [T.HabitationHabModule]: 'Habitation Module',
    [T.HabitationLifeSupport]: 'Life Support',
    [T.HabitationMedicalCenter]: 'Medical Center',
    [T.HabitationRecreationCenter]: 'Recreation Center',
    [T.LabsEnergyLab]: 'Energy Lab',
    [T.LabsHighTechLab]: 'HighTech Lab',
    [T.LabsWeaponsLab]: 'Weapons Lab',
    [T.ManufacturerEnergyPlant]: 'Energy Manufacturer',
    [T.ManufacturerHighTechPlant]: 'HighTech Manufacturer',
    [T.ManufacturerWeaponsPlant]: 'Weapons Manufacturer',
    [T.SensorProximityArray]: 'Proximity Array',
    [T.SensorResourceProfileSensor]: 'Resource Profile Sensor',
    [T.SensorLongRange]: 'Long Range Scanner',
    [T.StorageCargo]: 'Cargo Module',
    [T.StorageDockingBay]: 'Docking Bay',
    [T.StorageFuel]: 'Fuel Storage Cell',
    [T.StorageTroop]: 'Troop Module',
    [T.WeaponAreaDestruction]: 'Area Weapon',
    [T.WeaponSuperArea]: 'Super Area Weapon',
    [T.WeaponSuperBeam]: 'Super Beam Weapon',
    [T.WeaponSuperTorpedo]: 'Super Torpedo Weapon',
    [T.WeaponSuperMissile]: 'Super Missile Weapon',
    [T.WeaponSuperRailGun]: 'Super RailGun Weapon',
    [T.WeaponSuperPhaser]: 'Super Phaser Weapon',
    [T.WeaponMissile]: 'Missile Weapon',
    [T.WeaponPointDefense]: 'Point Defense',
    [T.WeaponIonCannon]: 'Ion Cannon',
    [T.WeaponIonPulse]: 'Ion Pulse',
    [T.WeaponIonDefense]: 'Ion Defense',
    [T.HyperDeny]: 'HyperDeny Weapon',
    [T.HyperStop]: 'HyperStop',
    [T.FighterBay]: 'Fighter Bay',
    [T.SensorTraceScanner]: 'Sensor TraceScanner',
    [T.SensorScannerJammer]: 'Sensor ScannerJammer',
    [T.ComputerTargettingFleet]: 'Targetting Fleet',
    [T.ComputerCountermeasuresFleet]: 'Countermeasures Fleet',
    [T.AssaultPod]: 'Assault Pod',
    [T.WeaponTractorBeam]: 'Tractor Beam Weapon',
    [T.WeaponAreaGravity]: 'Gravity Area Weapon',
    [T.WeaponGravityBeam]: 'Gravity Beam Weapon',
    [T.WeaponBombard]: 'Bombard Weapon',
    [T.WeaponBeam]: 'Beam Weapon',
    [T.WeaponTorpedo]: 'Torpedo Weapon',
    [T.Shields]: 'Shields',
    [T.HyperDrive]: 'HyperDrive',
};

// Port of Galaxy.2.cs:2339 ResolveDescription(ComponentType).
export function resolveComponentTypeDescription(type: ComponentType): string {
    const key = COMPONENT_TYPE_KEYS[type];
    return key !== undefined ? getText(`Component Type ${key}`) : splitString(T[type] ?? String(type));
}

// Port of Galaxy.2.cs ResolveDescription(BattleTactics).
export function resolveBattleTacticsDescription(tactics: BattleTactics): string {
    switch (tactics) {
        case BattleTactics.AllWeapons: return getText('BattleTactics All Weapons');
        case BattleTactics.Evade: return getText('BattleTactics Evade');
        case BattleTactics.PointBlank: return getText('BattleTactics Point Blank');
        case BattleTactics.Standoff: return getText('BattleTactics Standoff');
        case BattleTactics.Undefined: return getText('None');
        default: return splitString(BattleTactics[tactics] ?? String(tactics));
    }
}

// Port of Galaxy.2.cs ResolveDescription(InvasionTactics).
export function resolveInvasionTacticsDescription(tactics: InvasionTactics): string {
    switch (tactics) {
        case InvasionTactics.DoNotInvade: return getText('InvasionTactics Do Not Invade');
        case InvasionTactics.InvadeImmediately: return getText('InvasionTactics Invade Immediately');
        case InvasionTactics.InvadeWhenClear: return getText('InvasionTactics Invade When Clear');
        case InvasionTactics.Undefined: return getText('None');
        default: return splitString(InvasionTactics[tactics] ?? String(tactics));
    }
}

// Port of Galaxy.2.cs:2118 ResolveDescription(BuiltObjectFleeWhen).
export function resolveFleeWhenDescription(fleeWhen: BuiltObjectFleeWhen): string {
    switch (fleeWhen) {
        case BuiltObjectFleeWhen.Attacked: return getText('Flee When Attacked');
        case BuiltObjectFleeWhen.EnemyMilitarySighted: return getText('Flee When Enemy Military Sighted');
        case BuiltObjectFleeWhen.Never: return getText('Flee When Never');
        case BuiltObjectFleeWhen.Shields20: return getText('Flee When Shields 20');
        case BuiltObjectFleeWhen.Armor50: return getText('Flee When Armor 50 or Shields 20');
        case BuiltObjectFleeWhen.Shields50: return getText('Flee When Shields 50');
        case BuiltObjectFleeWhen.Undefined: return getText('None');
        default: return splitString(BuiltObjectFleeWhen[fleeWhen] ?? String(fleeWhen));
    }
}

/** The combo lists of Main.Part8.cs:46 OpenDesignEditor (enum order, Undefined skipped; flee-when in its listed order). */
export const DESIGN_SUBROLE_CHOICES: readonly BuiltObjectSubRole[] = (Object.values(S).filter((v) => typeof v === 'number') as BuiltObjectSubRole[])
    .filter((v) => v !== S.Undefined);
export const BATTLE_TACTICS_CHOICES: readonly BattleTactics[] = [BattleTactics.Evade, BattleTactics.Standoff, BattleTactics.AllWeapons, BattleTactics.PointBlank];
export const INVASION_TACTICS_CHOICES: readonly InvasionTactics[] = [InvasionTactics.DoNotInvade, InvasionTactics.InvadeWhenClear, InvasionTactics.InvadeImmediately];
export const FLEE_WHEN_CHOICES: readonly BuiltObjectFleeWhen[] = [
    BuiltObjectFleeWhen.EnemyMilitarySighted, BuiltObjectFleeWhen.Attacked, BuiltObjectFleeWhen.Shields50,
    BuiltObjectFleeWhen.Shields20, BuiltObjectFleeWhen.Armor50, BuiltObjectFleeWhen.Never,
];

// ---------------------------------------------------------------------------
// Empire helpers
// ---------------------------------------------------------------------------

// Port of Empire.10.cs:3124 SetDesignSubRoleShouldBeUpgraded (a plain Policy setter; no-op without a Policy).
export function setDesignSubRoleShouldBeUpgraded(empire: Empire, subRole: BuiltObjectSubRole, upgrade: boolean): void {
    const p = empire.policy;
    if (p === null) return;
    switch (subRole) {
        case S.Escort: p.designUpgradeEscort = upgrade; break;
        case S.Frigate: p.designUpgradeFrigate = upgrade; break;
        case S.Destroyer: p.designUpgradeDestroyer = upgrade; break;
        case S.Cruiser: p.designUpgradeCruiser = upgrade; break;
        case S.CapitalShip: p.designUpgradeCapitalShip = upgrade; break;
        case S.TroopTransport: p.designUpgradeTroopTransport = upgrade; break;
        case S.Carrier: p.designUpgradeCarrier = upgrade; break;
        case S.ResupplyShip: p.designUpgradeResupplyShip = upgrade; break;
        case S.ExplorationShip: p.designUpgradeExplorationShip = upgrade; break;
        case S.ColonyShip: p.designUpgradeColonyShip = upgrade; break;
        case S.ConstructionShip: p.designUpgradeConstructionShip = upgrade; break;
        case S.SmallSpacePort: p.designUpgradeSmallSpacePort = upgrade; break;
        case S.MediumSpacePort: p.designUpgradeMediumSpacePort = upgrade; break;
        case S.LargeSpacePort: p.designUpgradeLargeSpacePort = upgrade; break;
        case S.ResortBase: p.designUpgradeResortBase = upgrade; break;
        case S.GenericBase: p.designUpgradeGenericBase = upgrade; break;
        case S.EnergyResearchStation: p.designUpgradeEnergyResearchStation = upgrade; break;
        case S.WeaponsResearchStation: p.designUpgradeWeaponsResearchStation = upgrade; break;
        case S.HighTechResearchStation: p.designUpgradeHighTechResearchStation = upgrade; break;
        case S.MonitoringStation: p.designUpgradeMonitoringStation = upgrade; break;
        case S.DefensiveBase: p.designUpgradeDefensiveBase = upgrade; break;
        case S.SmallFreighter: p.designUpgradeSmallFreighter = upgrade; break;
        case S.MediumFreighter: p.designUpgradeMediumFreighter = upgrade; break;
        case S.LargeFreighter: p.designUpgradeLargeFreighter = upgrade; break;
        case S.PassengerShip: p.designUpgradePassengerShip = upgrade; break;
        case S.GasMiningShip: p.designUpgradeGasMiningShip = upgrade; break;
        case S.MiningShip: p.designUpgradeMiningShip = upgrade; break;
        case S.GasMiningStation: p.designUpgradeGasMiningStation = upgrade; break;
        case S.MiningStation: p.designUpgradeMiningStation = upgrade; break;
    }
}

interface DesignHolder { design?: Design | null; retrofitDesign?: Design | null; mission?: unknown }

function missionDesign(bo: DesignHolder): Design | null {
    const m = bo.mission as { design?: Design | null } | null | undefined;
    return m != null ? m.design ?? null : null;
}

// Port of Empire.10.cs:308 CheckDesignInUseForConstructionOrRetrofits.
export function checkDesignInUseForConstructionOrRetrofits(empire: Empire, design: Design | null): boolean {
    if (design === null) return false;
    for (const x of empire.constructionShips) {
        const bo = x as DesignHolder | null;
        if (bo != null && missionDesign(bo) === design) return true;
    }
    for (const y of empire.constructionYards) {
        const yard = y as { constructionQueue?: unknown } | null;
        if (yard == null || yard.constructionQueue == null) continue;
        const queue = yard.constructionQueue as {
            constructionWaitQueue: (DesignHolder | null)[] | null;
            constructionYards: ({ shipUnderConstruction: DesignHolder | null } | null)[] | null;
        };
        if (queue.constructionWaitQueue !== null) {
            for (const w of queue.constructionWaitQueue) {
                if (w == null) continue;
                if (w.design != null && w.design === design) return true;
                if (w.retrofitDesign != null && w.retrofitDesign === design) return true;
            }
        }
        if (queue.constructionYards === null) continue;
        for (const cy of queue.constructionYards) {
            if (cy == null || cy.shipUnderConstruction == null) continue;
            if (cy.shipUnderConstruction.design != null && cy.shipUnderConstruction.design === design) return true;
            if (cy.shipUnderConstruction.retrofitDesign != null && cy.shipUnderConstruction.retrofitDesign === design) return true;
        }
    }
    for (const list of [empire.builtObjects, empire.privateBuiltObjects]) {
        for (const x of list) {
            const bo = x as DesignHolder | null;
            if (bo == null) continue;
            if (bo.retrofitDesign != null && bo.retrofitDesign === design) return true;
            if (missionDesign(bo) === design) return true;
        }
    }
    return false;
}

// Main.Part6.cs:1114 btnDesignsDelete_Click (the in-use loop): a (private) built object of the empire has this
// design or is being retrofitted to it.
export function isDesignInUse(empire: Empire, design: Design): boolean {
    for (const bo of empire.builtObjects) {
        if (bo.design === design || bo.retrofitDesign === design) return true;
    }
    for (const bo of empire.privateBuiltObjects) {
        if (bo.design === design || bo.retrofitDesign === design) return true;
    }
    return false;
}

/**
 * Main.Part6.cs:1047/1060/1114, Main.Part8.cs:926, Main.Part7.cs:4839: when the empire automates ship design
 * (ControlDesigns) the original asks, through GenerateAutomationMessageBox("Ship Design"), whether to turn that
 * automation off before editing. True when that prompt appears. (AddNew and Delete ask whenever ControlDesigns is
 * on; Copy / Upgrade / Edit only when the sub-role is also auto-upgraded.) The caller sets `empire.controlDesigns
 * = false` when the player answers "off".
 */
export function designAutomationPromptApplies(empire: Empire, kind: DesignDraftSource['kind'] | 'delete', source: Design | null): boolean {
    if (!empire.controlDesigns) return false;
    if (kind === 'blank' || kind === 'delete') return true;
    return source !== null && checkDesignSubRoleShouldBeUpgraded(empire, source.subRole);
}


// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

// Port of Main.Part6.cs:1060 btnDesignsCopyAsNew_Click / Main.Part8.cs:926 btnDesignsUpgradeManual_Click name rule:
// "<name> MkN" becomes "<name> Mk(N+1)", anything else gets " Mk2".
export function nextMarkName(name: string): string {
    let text = name;
    if (text.includes(' ')) {
        let flag = false;
        const num = text.lastIndexOf(' ');
        let text2 = '';
        let text3 = '';
        if (num >= 0) {
            text3 = text.substring(0, num);
            text2 = text.substring(num).trim();
        }
        if (text2.includes('Mk') && text2.length > 2) {
            const s = text2.substring(2).trim();
            const result = netIntTryParse(s);
            if (result > 0) {
                text = text3 + ' ' + ('Mk' + (result + 1));
                flag = true;
            }
        }
        if (!flag) text += ' Mk2';
    } else {
        text += ' Mk2';
    }
    return text;
}

/** .NET int.TryParse(s, out result) with NumberStyles.Integer: 0 when the text is not an Int32. */
function netIntTryParse(s: string): number {
    if (!/^\s*[+-]?\d+\s*$/.test(s)) return 0;
    const n = Number(s.trim());
    return n >= -2147483648 && n <= 2147483647 ? n : 0;
}

/**
 * Start an editor session. Ports the Designs panel buttons: btnDesignsAddNew_Click (Main.Part6.cs:1047),
 * btnDesignsCopyAsNew_Click (:1060), btnDesignsUpgradeManual_Click (Main.Part8.cs:926) and btnDesignsEdit_Click
 * (Main.Part7.cs:4839). The ControlDesigns prompt is the caller's (designAutomationPromptApplies).
 */
export function newDesignDraft(galaxy: Galaxy, empire: Empire, source: DesignDraftSource): DesignDraft {
    switch (source.kind) {
        case 'blank': {
            // Main.Part6.cs:1053-1057: design_2 = null; "addnew"; new Design(string.Empty) owned by the player.
            const design = new Design('');
            design.empire = empire;
            const draft: DesignDraft = { design, mode: 'addnew', target: null, replaces: null };
            if (source.subRole !== undefined && source.subRole !== S.Undefined) setDraftSubRole(empire, draft, source.subRole);
            return draft;
        }
        case 'copy':
        case 'upgrade': {
            // Main.Part6.cs:1072-1091 / Main.Part8.cs:937-975.
            const design = cloneDesign(source.design);
            design.isObsolete = false;
            design.buildCount = 0;
            design.dateCreated = galaxyCurrentStarDate(galaxy);
            design.name = nextMarkName(design.name);
            return { design, mode: 'copyasnew', target: null, replaces: source.kind === 'upgrade' ? source.design : null };
        }
        case 'edit': {
            // Main.Part7.cs:4852-4879: View when a (private) built object uses the design or it is queued for
            // construction / retrofits, else Edit. design_1 (the Cancel backup) is the untouched original here.
            const selected = source.design;
            const owner = (selected.empire as Empire | null) ?? empire;
            let num = 0;
            for (const bo of owner.builtObjects) if (bo.design === selected) num++;
            for (const bo of owner.privateBuiltObjects) if (bo.design === selected) num++;
            let mode: DesignEditorMode;
            if (num > 0) mode = 'view';
            else if (selected.empire !== null && checkDesignInUseForConstructionOrRetrofits(owner, selected)) mode = 'view';
            else mode = 'edit';
            const design = cloneDesign(selected);
            // Clone does not copy these (Design.cs:1986); the C# edits the original object, which has them.
            design.size = selected.size;
            design.optimizedDesign = selected.optimizedDesign;
            return { design, mode, target: selected, replaces: null };
        }
    }
}

/** Main.Part7.cs:4881-4886: the message box shown when an in-use design opens in View mode. */
export function viewModeNotice(draft: DesignDraft): EditorResult | null {
    if (draft.mode !== 'view') return null;
    return { ok: false, title: gameText('Cannot edit this design'), message: gameText('You cannot edit this design because it is already in use') };
}

/** Main.Part8.cs:106-116 lblDesignDetailUpgradeRolesExplanation. */
export function designUpgradeExplanation(empire: Empire, design: Design): string {
    return checkDesignSubRoleShouldBeUpgraded(empire, design.subRole)
        ? gameText('Design Upgrade Affirmative Explanation')
        : gameText('Design Upgrade Negative Explanation');
}

// Port of Main.Part6.cs:908 method_388: the default tactics / stance / flee setting for a sub-role.
export function defaultDesignBehaviour(empire: Empire | null, subRole: BuiltObjectSubRole): {
    tacticsStrongerShips: BattleTactics; tacticsWeakerShips: BattleTactics; tacticsInvasion: InvasionTactics;
    stance: BuiltObjectStance; fleeWhen: BuiltObjectFleeWhen;
} {
    let stance = BuiltObjectStance.DoNotAttack;
    let fleeWhen = BuiltObjectFleeWhen.Attacked;
    let stronger = BattleTactics.Standoff;
    let weaker = BattleTactics.AllWeapons;
    let invasion = InvasionTactics.DoNotInvade;
    switch (subRole) {
        default:
            stance = BuiltObjectStance.DoNotAttack;
            fleeWhen = BuiltObjectFleeWhen.Attacked;
            stronger = BattleTactics.Standoff;
            weaker = BattleTactics.AllWeapons;
            invasion = InvasionTactics.DoNotInvade;
            break;
        case S.Escort:
        case S.Frigate:
        case S.Destroyer:
        case S.Cruiser:
        case S.CapitalShip:
            stance = BuiltObjectStance.AttackEnemies;
            fleeWhen = BuiltObjectFleeWhen.Shields20;
            if (empire !== null && empire.policy !== null) fleeWhen = empire.policy.defaultMilitaryFleeWhen;
            stronger = BattleTactics.Standoff;
            weaker = BattleTactics.AllWeapons;
            invasion = InvasionTactics.InvadeWhenClear;
            break;
        case S.TroopTransport:
            stance = BuiltObjectStance.AttackEnemies;
            fleeWhen = BuiltObjectFleeWhen.Shields50;
            stronger = BattleTactics.Evade;
            weaker = BattleTactics.AllWeapons;
            invasion = InvasionTactics.InvadeImmediately;
            break;
        case S.Carrier:
            stance = BuiltObjectStance.AttackEnemies;
            fleeWhen = BuiltObjectFleeWhen.Shields50;
            stronger = BattleTactics.Evade;
            weaker = BattleTactics.AllWeapons;
            invasion = InvasionTactics.InvadeWhenClear;
            break;
        case S.ResupplyShip:
            stance = BuiltObjectStance.AttackIfAttacked;
            fleeWhen = BuiltObjectFleeWhen.Shields50;
            stronger = BattleTactics.Evade;
            weaker = BattleTactics.AllWeapons;
            invasion = InvasionTactics.DoNotInvade;
            break;
        case S.ExplorationShip:
            stance = BuiltObjectStance.AttackIfAttacked;
            fleeWhen = BuiltObjectFleeWhen.EnemyMilitarySighted;
            stronger = BattleTactics.Evade;
            weaker = BattleTactics.Evade;
            invasion = InvasionTactics.DoNotInvade;
            break;
        case S.ColonyShip:
        case S.SmallFreighter:
        case S.MediumFreighter:
        case S.LargeFreighter:
        case S.PassengerShip:
        case S.ConstructionShip:
        case S.GasMiningShip:
        case S.MiningShip:
            stance = BuiltObjectStance.DoNotAttack;
            fleeWhen = BuiltObjectFleeWhen.EnemyMilitarySighted;
            stronger = BattleTactics.Evade;
            weaker = BattleTactics.Evade;
            invasion = InvasionTactics.DoNotInvade;
            break;
        case S.GasMiningStation:
        case S.MiningStation:
        case S.SmallSpacePort:
        case S.MediumSpacePort:
        case S.LargeSpacePort:
        case S.ResortBase:
        case S.GenericBase:
        case S.EnergyResearchStation:
        case S.WeaponsResearchStation:
        case S.HighTechResearchStation:
        case S.MonitoringStation:
        case S.DefensiveBase:
            stance = BuiltObjectStance.AttackEnemies;
            fleeWhen = BuiltObjectFleeWhen.Never;
            stronger = BattleTactics.PointBlank;
            weaker = BattleTactics.PointBlank;
            invasion = InvasionTactics.DoNotInvade;
            break;
    }
    return { tacticsStrongerShips: stronger, tacticsWeakerShips: weaker, tacticsInvasion: invasion, stance, fleeWhen };
}

// ShipImageHelper.cs:25 / :43.
const SHIP_SET_IMAGE_COUNT = 24;
const STANDARD_SHIP_IMAGE_START_INDEX = 72;

// Port of ShipImageHelper.cs:80 ResolveNewShipImageIndex(subRole, empire.DominantRace, isPirates).
// TODO(port): BaconDesign.SetPictureRef (BaconDesign.cs:32, the Design.PictureRef setter) remaps indexes >= 72 to the
// Bacon ship-picture list for the player's family; no Galaxy.Rnd for player designs. Image-only.
export function resolveNewShipImageIndex(subRole: BuiltObjectSubRole, empire: Empire): number {
    const shipSubRole = resolveLegacySubRole(subRole);
    let num = 0;
    const race = empire.dominantRace;
    if (race !== null) {
        num = race.designsPictureFamilyIndex;
        if (empire.pirateEmpireBaseHabitat !== null) {
            const raw = race.extra?.['DesignsPictureFamilyIndexPirates'];
            num = raw !== undefined && /^\s*[+-]?\d+\s*$/.test(raw) ? Number(raw.trim()) : -1;
        }
    }
    return STANDARD_SHIP_IMAGE_START_INDEX + num * SHIP_SET_IMAGE_COUNT + (shipSubRole - 1);
}

// Port of Main.Part6.cs:45 PrepareDesignForEditor on the draft: the editor's controls already live on the draft
// design, so what remains is Role from the sub-role (DesignSpecification.ResolveRole), ReDefine, the stance by
// sub-role, and a second ReDefine.
export function prepareDesignForEditor(design: Design): void {
    if (design.subRole !== S.Undefined) design.role = resolveBuiltObjectRole(design.subRole);
    // Main.Part6.cs:84-91: the Undefined → InvadeWhenClear fallback only runs when cmbDesignTacticsInvasion has a
    // selection, and method_292 binds an Undefined value as no selection (method_282 → -1), so it never fires.
    design.reDefine();
    switch (design.subRole) {
        case S.Escort:
        case S.Frigate:
        case S.Destroyer:
        case S.Cruiser:
        case S.CapitalShip:
        case S.TroopTransport:
        case S.Carrier:
            design.stance = BuiltObjectStance.AttackEnemies;
            break;
        case S.ResupplyShip:
            design.stance = BuiltObjectStance.DoNotAttack;
            break;
        case S.ExplorationShip:
            design.stance = BuiltObjectStance.AttackIfAttacked;
            break;
        case S.SmallFreighter:
        case S.MediumFreighter:
        case S.LargeFreighter:
        case S.ColonyShip:
        case S.PassengerShip:
        case S.ConstructionShip:
        case S.GasMiningShip:
        case S.MiningShip:
            design.stance = design.firepowerRaw > 0 ? BuiltObjectStance.AttackIfAttacked : BuiltObjectStance.DoNotAttack;
            break;
        case S.GasMiningStation:
        case S.MiningStation:
            design.stance = BuiltObjectStance.AttackIfAttacked;
            break;
        case S.SmallSpacePort:
        case S.MediumSpacePort:
        case S.LargeSpacePort:
        case S.ResortBase:
        case S.GenericBase:
        case S.EnergyResearchStation:
        case S.WeaponsResearchStation:
        case S.HighTechResearchStation:
        case S.MonitoringStation:
        case S.DefensiveBase:
            design.stance = BuiltObjectStance.AttackEnemies;
            break;
    }
    design.reDefine();
}

// Port of Main.Part6.cs:882 cmbDesignsSubRole_SelectedIndexChanged: set the sub-role; a design that had none also
// gets method_388's default behaviour and a new picture (ShipImageHelper.ResolveNewShipImageIndex).
export function setDraftSubRole(empire: Empire, draft: DesignDraft, subRole: BuiltObjectSubRole): EditorResult {
    if (draft.mode === 'view') return { ok: false }; // cmbDesignsSubRole.Enabled = false (Main.Part8.cs:338)
    const design = draft.design;
    const flag = design.subRole === S.Undefined;
    design.subRole = subRole;
    prepareDesignForEditor(design);
    if (flag) {
        const b = defaultDesignBehaviour(empire, design.subRole);
        design.tacticsStrongerShips = b.tacticsStrongerShips;
        design.tacticsWeakerShips = b.tacticsWeakerShips;
        design.tacticsInvasion = b.tacticsInvasion;
        design.stance = b.stance;
        design.fleeWhen = b.fleeWhen;
        design.pictureRef = resolveNewShipImageIndex(design.subRole, empire);
    }
    return { ok: true };
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

// Port of Main.Part9.cs:5018 method_290: the component toolbox with "Show latest components only" unchecked — every
// component the empire has researched. (Checked, the toolbox is designTools.ts latestToolboxComponents.)
export function designToolboxComponents(empire: Empire): ComponentDefinition[] {
    return [...empire.research.researchedComponents];
}

/** The toolbox grouped by component family (ComponentCategoryType, enum order), for the editor's list. */
export function toolboxByFamily(components: readonly ComponentDefinition[]): { category: ComponentCategoryType; label: string; components: ComponentDefinition[] }[] {
    const byCat = new Map<ComponentCategoryType, ComponentDefinition[]>();
    for (const c of components) {
        let list = byCat.get(c.category);
        if (list === undefined) byCat.set(c.category, (list = []));
        list.push(c);
    }
    return [...byCat.keys()].sort((a, b) => a - b).map((category) => ({
        category,
        label: resolveComponentCategoryDescription(category),
        components: byCat.get(category)!,
    }));
}

/** ComponentList.LastIndexById (ComponentList.cs:241). */
function lastIndexById(components: ComponentDefinition[], component: ComponentDefinition): number {
    for (let i = components.length - 1; i >= 0; i--) if (components[i].componentId === component.componentId) return i;
    return -1;
}

/**
 * Port of Main.Part7.cs:5015 btnAddComponentToDesign_Click (count 1) / :4984 btnAddComponentToDesignMultiple_Click
 * (count 5): insert after the design's last component of the same id (else append), then ReDefine. The original
 * applies no size / tech / role check here — the toolbox offers only researched components and every rule is a
 * design warning (designWarnings).
 */
export function addComponent(empire: Empire, draft: DesignDraft, component: ComponentDefinition, count: 1 | 5 = 1): EditorResult {
    if (draft.mode === 'view') return { ok: false }; // btnAddComponentToDesign.Enabled = false (Main.Part8.cs:339)
    if (!empire.research.researchedComponents.some((c) => c.componentId === component.componentId)) return { ok: false };
    const design = draft.design;
    const components = design.components.slice();
    for (let i = 0; i < count; i++) {
        const num = lastIndexById(components, component);
        if (num >= 0 && components.length > num + 1) components.splice(num + 1, 0, component);
        else components.push(component);
    }
    design.components = components;
    design.reDefine();
    return { ok: true };
}

/**
 * Port of Main.Part7.cs:5089 btnRemoveComponentFromDesign_Click (count 1: ComponentList.Remove of the selected
 * entry — the first entry with that id, since TS components are the shared definitions) / :5044
 * btnRemoveComponentFromDesignMultiple_Click (count 5: RemoveByComponentId up to five times, stopping once the
 * summarized row's amount is used up), then ReDefine.
 */
export function removeComponent(draft: DesignDraft, component: ComponentDefinition, count: 1 | 5 = 1): EditorResult {
    if (draft.mode === 'view') return { ok: false }; // btnRemoveComponentFromDesign.Enabled = false (Main.Part8.cs:341)
    const design = draft.design;
    const components = design.components.slice();
    if (!components.some((c) => c.componentId === component.componentId)) return { ok: false };
    if (count === 1) {
        const idx = components.indexOf(component);
        components.splice(idx >= 0 ? idx : components.findIndex((c) => c.componentId === component.componentId), 1);
    } else {
        let num = components.filter((c) => c.componentId === component.componentId).length; // SelectedAmount
        for (let i = 0; i < 5; i++) {
            const idx = components.findIndex((c) => c.componentId === component.componentId);
            if (idx >= 0) components.splice(idx, 1);
            num--;
            if (num < 0) break;
        }
    }
    design.components = components;
    design.reDefine();
    return { ok: true };
}

/** The design's components summarized by id in first-seen order (ctlDesignComponents SummarizedMode). */
export function summarizeComponents(design: Design): { component: ComponentDefinition; count: number }[] {
    const out: { component: ComponentDefinition; count: number }[] = [];
    const byId = new Map<number, { component: ComponentDefinition; count: number }>();
    for (const c of design.components) {
        const e = byId.get(c.componentId);
        if (e) e.count++;
        else {
            const n = { component: c, count: 1 };
            byId.set(c.componentId, n);
            out.push(n);
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

// Port of Empire.6.cs:985 ResolveResourcesFromComponents: resource id → summed quantity, first-seen order.
export function resolveResourcesFromComponents(components: readonly ComponentDefinition[]): { resourceId: number; quantity: number }[] {
    const list: { resourceId: number; quantity: number }[] = [];
    for (const component of components) {
        for (const req of component.resourceRequirements) {
            const e = list.find((r) => r.resourceId === req.resourceId);
            if (e) e.quantity += req.amount;
            else list.push({ resourceId: req.resourceId, quantity: req.amount });
        }
    }
    return list;
}

const SUPER_WEAPON_TYPES = new Set<ComponentType>([T.WeaponSuperBeam, T.WeaponSuperArea, T.WeaponSuperTorpedo, T.WeaponSuperMissile, T.WeaponSuperPhaser, T.WeaponSuperRailGun]);

/**
 * Port of Main.Part6.cs:226 GetDesignWarningMessages(objectDesign, out mustDo, out shouldDo) for the player empire.
 * Each warning is its GameText key encoded with its string.Format arguments (colonyTick.ts gameText); the mining-limit
 * lines are the C#'s literal interpolated English (no GameText key).
 */
export function designWarnings(galaxy: Galaxy, empire: Empire, objectDesign: Design): DesignWarnings {
    const mustDo: string[] = [];
    const shouldDo: string[] = [];
    const comps = objectDesign.components;
    const research = empire.research;

    const componentResourceList = resolveResourcesFromComponents(comps);
    const resourceList = determineResourcesEmpireSupplies(empire);
    const resourceList2 = componentResourceList.filter((r) => !resourceList.includes(r.resourceId));
    if (resourceList2.length > 0) {
        let text = '';
        for (let j = 0; j < resourceList2.length; j++) {
            if (j > 0) text += ', ';
            text += galaxy.resourceSystem.resources[resourceList2[j].resourceId]?.name ?? '';
        }
        shouldDo.push(gameText('We do not have a supply of all required resources', '(' + text + ')'));
    }

    const list: ComponentType[] = [];          // must have (type)
    const list2: ComponentCategoryType[] = []; // must have (category)
    const list3: ComponentType[] = [];         // must NOT have (type)
    const list4: ComponentCategoryType[] = []; // must NOT have (category)
    const list5: ComponentType[] = [];         // consider adding (type)
    const list6: ComponentCategoryType[] = []; // consider adding (category)
    list.push(T.ComputerCommandCenter);
    list.push(T.StorageFuel);
    list2.push(C.Reactor);
    if (objectDesign.role !== BuiltObjectRole.Colony) list3.push(T.HabitationColonization);
    switch (objectDesign.role) {
        case BuiltObjectRole.Military:
        case BuiltObjectRole.Exploration:
        case BuiltObjectRole.Freight:
        case BuiltObjectRole.Passenger:
        case BuiltObjectRole.Colony:
        case BuiltObjectRole.Build:
        case BuiltObjectRole.Resource:
            list.push(T.EngineMainThrust);
            list.push(T.EngineVectoring);
            list6.push(C.HyperDrive);
            break;
        case BuiltObjectRole.Base:
            list.push(T.StorageDockingBay);
            list4.push(C.Engine);
            list4.push(C.HyperDrive);
            break;
    }
    switch (objectDesign.role) {
        case BuiltObjectRole.Military:
            list6.push(C.Shields);
            list6.push(C.Armor);
            break;
        case BuiltObjectRole.Exploration:
            list.push(T.SensorResourceProfileSensor);
            break;
        case BuiltObjectRole.Freight:
            list.push(T.StorageCargo);
            break;
        case BuiltObjectRole.Passenger:
            list.push(T.StoragePassenger);
            break;
        case BuiltObjectRole.Colony:
            list.push(T.HabitationColonization);
            break;
        case BuiltObjectRole.Build:
            list.push(T.StorageDockingBay, T.StorageCargo, T.ConstructionBuild, T.ManufacturerEnergyPlant, T.ManufacturerHighTechPlant, T.ManufacturerWeaponsPlant);
            break;
        case BuiltObjectRole.Resource:
            list.push(T.StorageCargo);
            list2.push(C.Extractor);
            break;
    }
    switch (objectDesign.subRole) {
        case S.Destroyer:
        case S.Cruiser:
        case S.CapitalShip:
            list5.push(T.StorageTroop);
            break;
        case S.TroopTransport:
            list.push(T.StorageTroop);
            break;
        case S.Carrier:
            list.push(T.FighterBay);
            break;
        case S.ResupplyShip:
            list.push(T.ExtractorGasExtractor, T.StorageCargo, T.StorageDockingBay);
            list5.push(T.EnergyCollector, T.SensorResourceProfileSensor);
            break;
        case S.GasMiningStation:
            list.push(T.ExtractorGasExtractor, T.ComputerCommerceCenter, T.StorageCargo);
            break;
        case S.MiningStation:
            list.push(T.ExtractorMine, T.ComputerCommerceCenter, T.StorageCargo);
            break;
        case S.SmallSpacePort:
        case S.MediumSpacePort:
        case S.LargeSpacePort:
            list.push(T.ComputerCommerceCenter, T.ConstructionBuild, T.ManufacturerEnergyPlant, T.ManufacturerHighTechPlant, T.ManufacturerWeaponsPlant);
            list5.push(T.EnergyCollector);
            list6.push(C.Labs, C.Shields, C.Armor);
            break;
        case S.ResortBase:
            list.push(T.ComputerCommerceCenter, T.HabitationRecreationCenter, T.StoragePassenger);
            list5.push(T.EnergyCollector, T.StorageCargo);
            list6.push(C.Shields, C.Armor);
            break;
        case S.GenericBase:
            list.push(T.StorageCargo);
            break;
        case S.EnergyResearchStation:
            list.push(T.LabsEnergyLab);
            list5.push(T.EnergyCollector);
            break;
        case S.WeaponsResearchStation:
            list.push(T.LabsWeaponsLab);
            list5.push(T.EnergyCollector);
            break;
        case S.HighTechResearchStation:
            list.push(T.LabsHighTechLab);
            list5.push(T.EnergyCollector);
            break;
        case S.MonitoringStation:
            list.push(T.SensorLongRange);
            list5.push(T.EnergyCollector);
            break;
        case S.DefensiveBase:
            list6.push(C.Shields, C.Armor);
            list5.push(T.EnergyCollector);
            break;
    }
    const hasCategory = (cat: ComponentCategoryType): boolean => comps.some((c) => c.category === cat);
    const hasType = (type: ComponentType): boolean => comps.some((c) => c.type === type);
    for (const cat of list2) if (!hasCategory(cat)) mustDo.push(gameText('Must have a X component', resolveComponentCategoryDescription(cat)));
    for (const type of list) if (!hasType(type)) mustDo.push(gameText('Must have a X component', resolveComponentTypeDescription(type)));
    for (const cat of list4) if (hasCategory(cat)) mustDo.push(gameText('Must NOT have X components', resolveComponentCategoryDescription(cat)));
    for (const type of list3) if (hasType(type)) mustDo.push(gameText('Must NOT have X components', resolveComponentTypeDescription(type)));
    for (const cat of list6) if (!hasCategory(cat)) shouldDo.push(gameText('Consider adding X components', resolveComponentCategoryDescription(cat)));
    for (const type of list5) if (!hasType(type)) shouldDo.push(gameText('Consider adding X components', resolveComponentTypeDescription(type)));

    switch (objectDesign.subRole) {
        case S.Escort:
        case S.Frigate:
        case S.Destroyer:
        case S.Cruiser:
        case S.CapitalShip:
        case S.DefensiveBase: {
            const flag7 = comps.some((c) =>
                c.category === C.WeaponBeam || c.category === C.WeaponTorpedo || c.category === C.WeaponArea || c.category === C.WeaponIon ||
                c.category === C.WeaponSuperArea || c.category === C.WeaponSuperBeam || c.category === C.WeaponSuperTorpedo ||
                c.type === T.WeaponGravityBeam || c.type === T.WeaponAreaGravity || c.type === T.FighterBay);
            if (!flag7) {
                let item11 = gameText('Military ships must have weapons');
                if (objectDesign.subRole === S.DefensiveBase) item11 = gameText('Defensive bases must have weapons');
                mustDo.push(item11);
            }
            break;
        }
        case S.SmallFreighter:
        case S.MediumFreighter:
        case S.LargeFreighter:
        case S.PassengerShip:
        case S.GasMiningShip:
        case S.MiningShip: {
            let num9 = 0;
            let num10 = 0;
            let num11 = 0;
            for (const c of comps) {
                if (c.category === C.WeaponBeam || c.category === C.WeaponTorpedo || c.category === C.WeaponArea) num9++;
                if (c.type === T.WeaponIonCannon || c.type === T.WeaponIonPulse || c.type === T.WeaponAreaGravity || c.type === T.WeaponGravityBeam) num9++;
                if (c.category === C.Fighter) num11++;
                if (c.category === C.WeaponSuperArea || c.category === C.WeaponSuperBeam || c.category === C.WeaponSuperTorpedo) num10++;
            }
            if (num9 > 10) mustDo.push(gameText('Civilian ships may not have more than 10 weapons.'));
            if (num10 > 0) mustDo.push(gameText('Civilian ships cannot have super weapons'));
            if (num11 > 10) mustDo.push(gameText('Civilian ships cannot have fighter bays'));
            break;
        }
    }

    switch (objectDesign.subRole) {
        case S.GasMiningShip:
        case S.MiningShip:
        case S.ResupplyShip:
        case S.MiningStation:
        case S.GasMiningStation: {
            const extractorCol = comps.filter((x) => x.category === C.Extractor);
            if (extractorCol.length > 0) {
                const typesCol = [
                    extractorCol.filter((x) => x.type === T.ExtractorGasExtractor),
                    extractorCol.filter((x) => x.type === T.ExtractorMine),
                    extractorCol.filter((x) => x.type === T.ExtractorLuxury),
                ];
                for (const item of typesCol) {
                    if (item.length > 0) {
                        const max = research.resolveImprovedComponentValues(item[0]).value2;
                        let currentMiningValue = 0;
                        for (const x of item) currentMiningValue += research.resolveImprovedComponentValues(x).value1;
                        if (currentMiningValue > max) {
                            shouldDo.push(`Current amount of ${resolveComponentTypeDescription(item[0].type)} is above mining limit of ${max}`);
                        } else if (currentMiningValue < max) {
                            shouldDo.push(`Current amount of ${resolveComponentTypeDescription(item[0].type)} is below mining limit of ${max}`);
                        }
                    }
                }
            }
            break;
        }
    }

    let num14 = 0;
    for (const c of comps) {
        const componentImprovement = research.resolveImprovedComponentValues(c);
        if (SUPER_WEAPON_TYPES.has(c.type)) {
            num14 += c.energyUsed;
            num14 += componentImprovement.value3;
        }
    }
    if (num14 > 0 && objectDesign.reactorStorageCapacity < objectDesign.staticEnergyConsumption + objectDesign.topSpeedFuelBurn + num14) {
        shouldDo.push(gameText('Superweapon may not fire because total reactor energy output and storage is low'));
    }
    if (objectDesign.subRole === S.Carrier && !empire.canBuildCarriers) {
        shouldDo.push(gameText('Cannot currently build a design of this ship type', resolveSubRoleDescription(objectDesign.subRole)));
    } else if (objectDesign.subRole === S.ResupplyShip && !empire.canBuildResupplyShips) {
        shouldDo.push(gameText('Cannot currently build a design of this ship type', resolveSubRoleDescription(objectDesign.subRole)));
    }
    if (objectDesign.topSpeed > 0) {
        if (objectDesign.role !== BuiltObjectRole.Colony && objectDesign.role !== BuiltObjectRole.Build && objectDesign.subRole !== S.ResupplyShip) {
            let num16 = empire.maximumConstructionSize(objectDesign.subRole);
            if (objectDesign.isPlanetDestroyer) num16 = empire.maximumConstructionSizeBase();
            if (objectDesign.size > num16) {
                shouldDo.push(gameText('Cannot currently build a design of this size maximum size', String(objectDesign.size), String(num16)));
            }
        } else {
            const num17 = empire.maximumConstructionSizeBase(objectDesign.subRole);
            if (objectDesign.size > num17) {
                shouldDo.push(gameText('Cannot currently build a design of this size maximum size', String(objectDesign.size), String(num17)));
            }
        }
    } else {
        switch (objectDesign.subRole) {
            case S.GasMiningStation:
            case S.MiningStation:
                if (objectDesign.size > empire.maximumConstructionSizeBase(objectDesign.subRole)) {
                    shouldDo.push(gameText('Cannot currently build a design of this size', String(objectDesign.size)));
                }
                break;
            case S.ResortBase:
            case S.GenericBase:
            case S.EnergyResearchStation:
            case S.WeaponsResearchStation:
            case S.HighTechResearchStation:
            case S.MonitoringStation:
            case S.DefensiveBase:
                if (objectDesign.size > empire.maximumConstructionSizeBase(objectDesign.subRole)) {
                    shouldDo.push(gameText('Cannot currently build a design of this size unless at colony', String(objectDesign.size)));
                }
                break;
        }
    }

    if (objectDesign.subRole === S.ResupplyShip || objectDesign.subRole === S.ConstructionShip || objectDesign.subRole === S.ColonyShip || objectDesign.subRole === S.Carrier) {
        let num18 = 0; // cargo
        let num19 = 0; // docking bays
        let num20 = 0; // construction + manufacturers
        let num21 = 0; // gas extractors
        let num22 = 0; // colonization
        let num23 = 0; // fighter bays
        for (const c of comps) {
            if (c.type === T.FighterBay) num23 += c.size;
            if (c.type === T.HabitationColonization) num22 += c.size;
            if (c.type === T.StorageCargo) num18 += c.size;
            if (c.type === T.ConstructionBuild || c.category === C.Manufacturer) num20 += c.size;
            if (c.type === T.StorageDockingBay) num19 += c.size;
            if (c.type === T.ExtractorGasExtractor) num21 += c.size;
        }
        if (objectDesign.subRole === S.ResupplyShip) {
            if ((num18 + num19 + num21) / objectDesign.size < 0.2) {
                mustDo.push(gameText('Resupply Ships: min X% cargo storage, docking bays, gas extractors', '20'));
            }
        } else if (objectDesign.subRole === S.Carrier) {
            if (num23 / objectDesign.size < 0.4) mustDo.push(gameText('Carriers: min X% fighter bays', '40'));
        } else if (objectDesign.subRole === S.ConstructionShip) {
            if ((num18 + num20) / objectDesign.size < 0.35) {
                mustDo.push(gameText('Construction Ships: min X% cargo storage, construction, manufacturers', '35'));
            }
        } else if (objectDesign.subRole === S.ColonyShip) {
            if (num22 / objectDesign.size < 0.5) mustDo.push(gameText('Colony Ships: min X% colonization module', '50'));
        }
    }

    let num29 = 0;
    let num30 = 0;
    let num31 = 0;
    for (const c of comps) {
        const componentImprovement2 = research.resolveImprovedComponentValues(c);
        if (c.type === T.HabitationHabModule) num30 += componentImprovement2.value1;
        else if (c.type === T.HabitationLifeSupport) num31 += componentImprovement2.value1;
        else num29 += c.size;
    }
    if (objectDesign.role === BuiltObjectRole.Base) num29 = Math.trunc(num29 / 2);
    if (num29 > num30) mustDo.push(gameText('Need more Habitation Modules'));
    if (num29 > num31) mustDo.push(gameText('Need more Life Support components'));
    if (objectDesign.reactorPowerOutput < objectDesign.staticEnergyConsumption) {
        if (objectDesign.role === BuiltObjectRole.Base) shouldDo.push(gameText('Reactor power output inadequate to supply static energy requirements'));
        else mustDo.push(gameText('Reactor power output inadequate to supply static energy requirements'));
    }
    let num33 = 0;
    for (const c of comps) if (c.category === C.HyperDrive) num33++;
    if (num33 > 1) shouldDo.push(gameText('Only one HyperDrive component is required'));
    if (objectDesign.name === '') mustDo.push(gameText('Design must have a name'));
    if (objectDesign.subRole === S.Undefined) mustDo.push(gameText('Must set Role for Design'));
    if (objectDesign.fleeWhen === BuiltObjectFleeWhen.Undefined) mustDo.push(gameText('Must set FleeWhen for Design'));
    if (objectDesign.tacticsInvasion === InvasionTactics.Undefined) mustDo.push(gameText('Must set Invasion Tactics for Design'));
    if (objectDesign.tacticsStrongerShips === BattleTactics.Undefined) mustDo.push(gameText('Must set Battle Tactics against stronger opponents for this Design'));
    if (objectDesign.tacticsWeakerShips === BattleTactics.Undefined) mustDo.push(gameText('Must set Battle Tactics against weaker opponents for this Design'));
    switch (objectDesign.subRole) {
        case S.SmallFreighter:
        case S.MediumFreighter:
        case S.LargeFreighter:
        case S.PassengerShip:
        case S.GasMiningShip:
        case S.MiningShip:
            if (objectDesign.tacticsStrongerShips !== BattleTactics.Evade || objectDesign.tacticsWeakerShips !== BattleTactics.Evade) {
                mustDo.push(gameText('Battle Tactics for civilian ships must be Evade'));
            }
            if (objectDesign.tacticsInvasion !== InvasionTactics.DoNotInvade) {
                mustDo.push(gameText('Invasion Tactics for civilian ships must be Do Not Invade'));
            }
            break;
    }
    return { mustDo, shouldDo };
}

// ---------------------------------------------------------------------------
// Save / cancel / delete / obsolete
// ---------------------------------------------------------------------------

// Write the working copy back into the edited Empire.Designs entry (the C# edited that object in place).
function writeBack(target: Design, d: Design): void {
    target.name = d.name;
    target.components = d.components.slice();
    target.isObsolete = d.isObsolete;
    target.subRole = d.subRole;
    target.role = d.role;
    target.pictureRef = d.pictureRef;
    target.tacticsStrongerShips = d.tacticsStrongerShips;
    target.tacticsWeakerShips = d.tacticsWeakerShips;
    target.tacticsInvasion = d.tacticsInvasion;
    target.stance = d.stance;
    target.fleeWhen = d.fleeWhen;
    target.imageScalingType = d.imageScalingType;
    target.imageScalingFactor = d.imageScalingFactor;
    target.allowAutoRetrofit = d.allowAutoRetrofit;
    target.isManuallyCreated = d.isManuallyCreated;
}

/**
 * Port of Main.Part6.cs:164 btnDesignsSaveDesign_Click: PrepareDesignForEditor; a non-View save marks the design
 * manually created; any red warning refuses the save ("All warnings in red must be resolved …"); an Upgrade session
 * obsoletes its template (design_2); AddNew / CopyAsNew stamp DateCreated = Galaxy.CurrentStarDate, ReDefine and add
 * the design to Empire.Designs; Edit / View replace the design's Empire.Designs entry and ReDefine it. No Galaxy.Rnd.
 */
export function saveDesign(galaxy: Galaxy, empire: Empire, draft: DesignDraft): SaveDesignResult {
    const design = draft.design;
    prepareDesignForEditor(design);
    if (draft.mode !== 'view') design.isManuallyCreated = true;
    const { mustDo, shouldDo } = designWarnings(galaxy, empire, design);
    if (mustDo.length > 0) {
        return {
            ok: false, design: null, mustDo, shouldDo,
            message: gameText('All warnings in red must be resolved before this design can be saved'),
            title: gameText('Cannot Save Design'),
        };
    }
    if (draft.replaces !== null) draft.replaces.isObsolete = true;
    draft.replaces = null;
    switch (draft.mode) {
        case 'addnew':
        case 'copyasnew':
            design.dateCreated = galaxyCurrentStarDate(galaxy);
            design.reDefine();
            empire.designs.push(design);
            return { ok: true, design, mustDo, shouldDo };
        case 'edit':
        case 'view': {
            // Main.Part6.cs:196-207: Designs.IndexOf(design_0) (the edited object) → Designs[num] = design_0; ReDefine.
            const target = draft.target;
            const num = target !== null ? empire.designs.indexOf(target) : -1;
            if (num >= 0 && target !== null) {
                writeBack(target, design);
                empire.designs[num] = target;
                empire.designs[num].reDefine();
                return { ok: true, design: target, mustDo, shouldDo };
            }
            return { ok: true, design: null, mustDo, shouldDo };
        }
    }
}

/**
 * Main.Part7.cs:4889 btnDesignsCancel_Click: design_2 is cleared and the editor closes. The C# restores the edited
 * design's components / tactics / stance from its backup; here the working copy is simply dropped. (C# oddity: name,
 * sub-role, picture and obsolete changes already pushed by PrepareDesignForEditor survive a C# Cancel.)
 */
export function cancelDesignDraft(draft: DesignDraft): void {
    draft.replaces = null;
}

/** btnDesignsCopyAsNew_Click (Main.Part6.cs:1060): a new draft copying `source`. */
export function copyDesign(galaxy: Galaxy, empire: Empire, source: Design): DesignDraft {
    return newDesignDraft(galaxy, empire, { kind: 'copy', design: source });
}

/**
 * Port of Main.Part6.cs:1114 btnDesignsDelete_Click after the player confirmed ("Are you sure that you want to delete
 * this design?" / "…these designs?"): designs in use by a (private) built object — as its design or retrofit design —
 * are kept. One design in use → "This design is in use and cannot be deleted"; several with some in use → "Some of
 * the selected designs were in use and could not be deleted".
 */
export function deleteDesign(empire: Empire, designs: readonly Design[]): DeleteDesignResult {
    if (designs.length <= 0) return { ok: false, deleted: [] };
    if (designs.length === 1) {
        if (isDesignInUse(empire, designs[0])) {
            return { ok: false, deleted: [], message: gameText('This design is in use and cannot be deleted'), title: gameText('Cannot Delete Design') };
        }
        const num = empire.designs.indexOf(designs[0]);
        if (num >= 0) empire.designs.splice(num, 1);
        return { ok: true, deleted: [designs[0]] };
    }
    const designList: Design[] = [];
    let flag2 = false;
    for (const d of designs) {
        if (!isDesignInUse(empire, d)) designList.push(d);
        else flag2 = true;
    }
    for (const d of designList) {
        const num2 = empire.designs.indexOf(d);
        if (num2 >= 0) empire.designs.splice(num2, 1);
    }
    if (flag2) {
        return {
            ok: designList.length > 0, deleted: designList,
            message: gameText('Some of the selected designs were in use and could not be deleted'),
            title: gameText('Could Not Delete Some Designs'),
        };
    }
    return { ok: true, deleted: designList };
}

/** The confirmation question btnDesignsDelete_Click asks first (Main.Part6.cs:1150 / :1210). */
export function deleteDesignQuestion(count: number): { message: string; title: string } {
    return count === 1
        ? { message: gameText('Are you sure that you want to delete this design?'), title: gameText('Delete Design') }
        : { message: gameText('Are you sure that you want to delete these designs?'), title: gameText('Delete Designs') };
}

// Main.Part8.cs:1091 ctlDesignsList_CellClick "Obsolete" column / ctlDesignsList.SetObsolete.
export function setObsolete(design: Design, obsolete: boolean): void {
    design.isObsolete = obsolete;
}
