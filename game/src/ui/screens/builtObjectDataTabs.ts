// The data tabs of the original's pnlBuiltObjectInfo (tabBuiltObjectData, 680 × 300 at (10, 385)), shared by the
// Ships and Bases window (shipsAndBasesList.ts) and the Construction Yards screen (constructionYards.ts) — in the
// original both are the same ScreenPanel (the Construction Yards button opens it with cmbBuiltObjectFilter on
// "Construction Yards", Main.Part6.cs 3243 tbtnConstructionYards_Click). The pages and their layouts:
//   - Cargo: ctlBuiltObjectCargo (350 × 275, Main.Part11.cs 4230 method_178; CargoListView.cs BindData);
//   - Components: ctlBuiltObjectComponents (455 × 275, BuiltObjectComponentListView.cs BindData: status picture,
//     Name, Category, Size), "Resources for X" + ctlBuiltObjectComponentsResources (ComponentResourceListView) and the
//     Retrofit Stance combo (Main.Part11.cs 3554 method_170, ctlBuiltObjectComponents_SelectionChanged);
//   - Docking Bays: ctlDockingBays + "Ships waiting for a Docking Bay" + ctlDockingWaitQueue (method_176;
//     DockingBayListView.cs BindData);
//   - Troops: ctlBuiltObjectCharactersTroops (455 × 275, method_178; CharacterTroopListIconView.cs BindData: the
//     character portraits and troop pictures as a LargeIcon list) and the ship's troop loadout group
//     (grpUseTroopLoadouts / chkUseTroopLoadouts / numTroopLoadout*, Main.Part11.cs 4433 method_179 - method_181 and the
//     ValueChanged handlers; the 'setShipTroopLoadout' op);
//   - Weapons: ctlWeapons (600 × 275, method_175; WeaponListView.cs BindData / GenerateDamageGraph).
// The tab captions with their counts are ctlBuiltObjectList_SelectionChanged's (Main.Part11.cs 3865, which method_178
// ends with). The Cargo page has lblBuiltObjectCargoConstructionResourceShortage (ManufacturingQueue.DeficientResources,
// ctlBuiltObjectList_SelectionChanged). Shared with both windows as well: the Set Fleet combo (cmbBuiltObjectSetFleet,
// Main.Part11.cs 4630 method_182, Main.Part6.cs 2898 cmbBuiltObjectSetFleet_SelectedIndexChanged) and the Construction
// Yards tab's manufacturing-plant grids (duExoPvEoA = ctlConstructionYardManufacturers: ManufacturerListView.cs, and
// ctlConstructionYardManufacturerWaitQueue: ComponentListView.cs, bound by Main.Part11.cs 3366 method_169).
// Orders go through the player command queue.

import './builtObjectDataTabs.css';
import type { BuiltObject } from '../../sim/builtObject';
import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import type { Weapon } from '../../sim/weapon';
import type { DockingBay } from '../../sim/dockingBay';
import { Habitat } from '../../sim/types';
import { ComponentStatus, type BuiltObjectComponent } from '../../sim/builtObjectComponent';
import { ComponentType } from '../../sim/data/components';
import { habitatInvadingCharacterList, stellarObjectCharacters, type Character } from '../../sim/characters';
import type { Troop } from '../../sim/cargo';
import { IndustryType } from '../../sim/types';
import { BuiltObjectRole } from '../../sim/data/designSpecifications';
import { empireShipGroups, type ShipGroup } from '../../sim/fleets/shipGroup';
import type { ManufacturedComponent, Manufacturer, ManufacturingQueue } from '../../sim/manufacturingQueue';
import { shipTroopLoadoutSize, type SetFleetTarget, type TroopLoadout } from '../../sim/player/fleetOps';
import { characterMission } from '../../sim/espionage';
import { formatNet0, formatNetPercent0 } from '../../sim/netNumberFormat';
import { BuiltObjectMissionType, CommandAction, builtObjectMission } from '../../sim/missions/mission';
import { isPrivateDesignSubRole } from '../../sim/player/playerOrders';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import { resolveComponentCategoryAbbreviation, resolveComponentCategoryDescription } from '../../sim/player/designEditor';
import { componentDefinitionsStatic } from '../../sim/designGeneration';
import { missionTypeLabel, resourceIconUrl, subRoleLabel } from '../hud';
import { openResourceSupply, resourceSupplyAvailable } from './resourceSupply'; // [improvements] supplyChain
import { shipImageUrl } from '../selectionInfo';
import { empireFlagUrl } from '../selectionInfoView';
import { COLORS, FONT, OwGrid, dropDown, dropText, el, place, rgbCss, scrollPanel, text, type GridColumn } from '../originalWindow';
import { componentImageUrl } from './designPanelsModel';
import { gt } from './researchBenefits';
import { troopStrengthDescription } from './troops';
import { resolveCharacterDescription, resolveMissionTypeDescription, resolveRoleDescription } from './intelligence';
import { characterPortrait } from '../characterPortrait';
import { troopImageUrl, wireTroopImageFallback } from '../../render/troopImages';
import { raceHasConcordArt } from '../../render/concordArt';
import { confirmAutomationOff } from '../orderMenu';
import { PendingValues } from '../pendingCommands';

export type DataTabId = 'cargo' | 'components' | 'docking' | 'troops' | 'weapons';

// -------------------------------------------------------------------------------------------------------------------
// Pure helpers (tested)
// -------------------------------------------------------------------------------------------------------------------

/** The tab captions with ctlBuiltObjectList_SelectionChanged's counts (Main.Part11.cs 3895-3948, which method_178 ends
 *  with, so its own "Troops (n)" never shows): cargo items, damaged components, ships on the slipways, docked ships,
 *  troops + characters ("Troops & Characters"), weapons. */
export function builtObjectTabLabels(o: BuiltObject | Habitat | null): { cargo: string; components: string; yards: string; docking: string; troops: string; weapons: string } {
    const base = { cargo: gt('Cargo'), components: gt('Components'), yards: gt('Construction Yards'), docking: gt('Docking Bays'), troops: gt('Troops & Characters'), weapons: gt('Weapons') };
    if (o === null) return base;
    const n = (v: number, suffix = ''): string => (v > 0 ? ` (${v}${suffix})` : '');
    const bo = o instanceof Habitat ? null : (o as BuiltObject);
    const cargo = (o.cargo as { items?: unknown[] } | null)?.items?.length ?? 0;
    const yards = ((o.constructionQueue as { constructionYards?: ({ shipUnderConstruction: unknown } | null)[] | null } | null)?.constructionYards ?? []).filter((y) => y != null && y.shipUnderConstruction !== null).length;
    const bays = ((o.dockingBays as ({ dockedShip: unknown } | null)[] | null) ?? []).filter((d) => d != null && d.dockedShip !== null).length;
    const troops = ((o.troops as { items?: unknown[] } | null)?.items?.length ?? 0) + (objectCharacters(o)?.length ?? 0);
    return {
        cargo: `${base.cargo}${n(cargo)}`,
        components: `${base.components}${n(bo?.damagedComponentCount ?? 0, ` ${gt('damaged')}`)}`,
        yards: `${base.yards}${n(yards)}`,
        docking: `${base.docking}${n(bays)}`,
        troops: `${base.troops}${n(troops)}`,
        weapons: `${base.weapons}${n(bo?.weapons?.length ?? 0)}`,
    };
}

export interface ComponentRow {
    /** Index in BuiltObject.Components (Cells[2].Tag). */
    index: number;
    component: BuiltObjectComponent;
    /** Cells[0]: the status picture ('unbuilt' / 'damaged') or the component's picture (faded when disabled). */
    picture: 'unbuilt' | 'damaged' | number;
    disabled: boolean;
    /** Cells[0] value / tooltip: "(Under construction) Name", "(Disabled) Name", "(Damaged) Name" or the name. */
    statusText: string;
    /** Cells[1]: the name, "Name  (Disabled)" for a disabled component. */
    name: string;
    /** Cells[2]: Galaxy.ResolveDescription(category). */
    category: string;
    size: number;
}

/** Port of BuiltObjectComponentListView.cs BindData: one row per component, in the ship's component order. */
export function componentRows(bo: BuiltObject | null): ComponentRow[] {
    if (bo === null) return [];
    const items = bo.components?.items ?? [];
    const rows: ComponentRow[] = [];
    for (let index = 0; index < items.length; ++index) {
        const c = items[index];
        if (c == null) continue;
        const disabled = bo.disabledComponentIndexes !== null && bo.disabledComponentIndexes.indexOf(index) >= 0;
        let picture: ComponentRow['picture'] = c.def.pictureRef;
        let statusText = c.def.name;
        switch (c.status) {
            case ComponentStatus.Unbuilt:
                picture = 'unbuilt';
                statusText = `(${gt('Under construction')}) ${c.def.name}`;
                break;
            case ComponentStatus.Normal:
                if (disabled) statusText = `(${gt('Disabled')}) ${c.def.name}`;
                break;
            case ComponentStatus.Damaged:
                picture = 'damaged';
                statusText = `(${gt('Damaged')}) ${c.def.name}`;
                break;
        }
        rows.push({
            index,
            component: c,
            picture,
            disabled: disabled && c.status === ComponentStatus.Normal,
            statusText,
            name: disabled ? `${c.def.name}  (${gt('Disabled')})` : c.def.name,
            category: resolveComponentCategoryDescription(c.def.category),
            size: c.def.size,
        });
    }
    return rows;
}

export interface WeaponRow {
    /** Index in BuiltObject.Weapons (Cells[2].Tag). */
    index: number;
    weapon: Weapon;
    pictureRef: number;
    name: string;
    speed: number;
    energyRequired: number;
    fireRate: number;
    /** RawDamage - DamageLoss × Range / 100, as an int. */
    minimumDamage: number;
    /** Cells[5] tooltip. */
    tooltip: string;
}

/** Port of WeaponListView.cs BindData: every weapon but the assault pods. */
export function weaponRows(weapons: readonly Weapon[] | null): WeaponRow[] {
    const rows: WeaponRow[] = [];
    if (weapons === null) return rows;
    for (let index2 = 0; index2 < weapons.length; ++index2) {
        const w = weapons[index2];
        if (w == null || w.component.def.type === ComponentType.AssaultPod) continue;
        const num1 = w.damageLoss * (w.range / 100.0);
        const num2 = Math.trunc(w.rawDamage - num1);
        rows.push({
            index: index2,
            weapon: w,
            pictureRef: w.component.def.pictureRef,
            name: w.component.def.name,
            speed: w.speed,
            energyRequired: w.energyRequired,
            fireRate: w.fireRate,
            minimumDamage: num2,
            tooltip: `${gt('Range')}: ${w.range}, ${gt('Maximum Damage')}: ${w.rawDamage}, ${gt('Minimum Damage')}: ${num2}`,
        });
    }
    return rows;
}

/** WeaponListView.cs GenerateDamageGraph: the red polygon of a weapon's damage falling over its range, in a
 *  `width` × `height` bitmap (270 × 45). */
export function damageGraphPoints(w: Pick<Weapon, 'damageLoss' | 'range' | 'rawDamage'>, width = 270, height = 45): { x: number; y: number }[] {
    const num1 = w.damageLoss * (w.range / 100.0);
    const num2 = Math.trunc(w.rawDamage - num1);
    const num3 = height / 2.0 / 50.0;
    const num4 = width / 990.0;
    const num5 = Math.trunc(height / 2.0);
    const num6 = (w.rawDamage * num3) / 2.0;
    const num7 = (num2 * num3) / 2.0;
    const x = Math.trunc(w.range * num4);
    return [
        { x: 0, y: Math.trunc(num5 - num6) },
        { x: 0, y: Math.trunc(num5 + num6) },
        { x, y: Math.trunc(num5 + num7) },
        { x, y: Math.trunc(num5 - num7) },
    ];
}

/** DockingBayListView.cs BindData Cells[4]: the docked ship's current command (CommandAction name), '' without one. */
export function dockedShipCommand(ship: BuiltObject | null): string {
    if (ship === null) return '';
    const m = builtObjectMission(ship.mission);
    if (m === null || m.type === BuiltObjectMissionType.Undefined) return '';
    const cmd = m.showCurrentCommand();
    return cmd !== null ? (CommandAction[cmd.action] ?? '') : '';
}

/** StellarObject.Characters of a ship / base or a colony (the colony's side table), null when never assigned. */
export function objectCharacters(o: BuiltObject | Habitat): Character[] | null {
    if (o instanceof Habitat) return stellarObjectCharacters(o);
    return ((o as BuiltObject).characters as Character[] | null | undefined) ?? null;
}

// -------------------------------------------------------------------------------------------------------------------
// Troops tab: CharacterTroopListIconView (ctlBuiltObjectCharactersTroops)
// -------------------------------------------------------------------------------------------------------------------

export interface CharacterTroopIconItem {
    /** ListViewItem.Tag: the item's index over every list (characters, recruits, troops, invaders). */
    index: number;
    character: Character | null;
    troop: Troop | null;
    /** ListViewItem.Text. */
    text: string;
    /** ListViewItem.ToolTipText. */
    tooltip: string;
    /** A character of another empire: ForeColor = its MainColor, bold (null otherwise). */
    foreignColor: number | null;
    /** _FadedTroopsImageOffset: a troop being recruited (FadeImage 0.35). */
    faded: boolean;
    /** A garrisoned troop: BackColor (0, 192, 0). */
    garrisoned: boolean;
}

/** GenerateCharacterItems: "<prefix>Name", tooltip role, a foreign empire's name, ResolveCharacterDescription and the
 *  mission. */
function generateCharacterItems(characters: readonly Character[], indexStart: number, textPrefix: string, locationEmpire: Empire | null): CharacterTroopIconItem[] {
    const items: CharacterTroopIconItem[] = [];
    for (let index = 0; index < characters.length; ++index) {
        const c = characters[index];
        if (c == null) continue;
        const foreign = c.empire !== null && c.empire !== locationEmpire;
        let str1 = `${resolveRoleDescription(c.role)}\n`;
        if (foreign) str1 = `${str1}${c.empire!.name}\n`;
        let str2 = str1 + resolveCharacterDescription(c);
        const mission = characterMission(c);
        if (mission !== null) str2 = `${str2}\n${gt('Mission')}: ${resolveMissionTypeDescription(mission.type)}`;
        items.push({ index: index + indexStart, character: c, troop: null, text: textPrefix + c.name, tooltip: str2, foreignColor: foreign ? c.empire!.mainColor : null, faded: false, garrisoned: false });
    }
    return items;
}

/** GenerateTroopItems: "[* ]<prefix>Name (Strength, OverallAttack, OverallDefend)", the readiness / strength tooltip. */
function generateTroopItems(troops: readonly Troop[], indexStart: number, faded: boolean, textPrefix: string): CharacterTroopIconItem[] {
    const items: CharacterTroopIconItem[] = [];
    for (let index = 0; index < troops.length; ++index) {
        const t = troops[index];
        if (t == null) continue;
        let empty = '';
        if (t.garrisoned) empty += '* ';
        const str1 = `${empty}${textPrefix}${t.name} (${troopStrengthDescription(t)}, ${formatNet0(t.overallAttackStrength)}, ${formatNet0(t.overallDefendStrength)})`;
        let str2 =
            `${gt('Readiness')}: ${formatNet0(t.readiness)}\n${gt('Attack Strength')}: ${formatNet0(t.attackStrength)}\n${gt('Overall Attack Strength')}: ${formatNet0(t.overallAttackStrength)}\n` +
            `${gt('Defend Strength')}: ${formatNet0(t.defendStrength)}\n${gt('Overall Defend Strength')}: ${formatNet0(t.overallDefendStrength)}`;
        if (t.garrisoned) str2 = `${str2}\n${gt('Garrisoned').toUpperCase()}`;
        items.push({ index: index + indexStart, character: null, troop: t, text: str1, tooltip: str2, foreignColor: null, faded, garrisoned: t.garrisoned });
    }
    return items;
}

/** Port of CharacterTroopListIconView.cs BindData: the characters, the troops being recruited ("Recruiting - ", faded),
 *  the troops, the invading troops and the invading characters ("INVADING - "), in that order. */
export function characterTroopIconItems(
    locationEmpire: Empire | null,
    characters: readonly Character[] | null,
    invadingCharacters: readonly Character[] | null,
    troops: readonly Troop[] | null,
    troopsToRecruit: readonly Troop[] | null,
    invadingTroops: readonly Troop[] | null,
): CharacterTroopIconItem[] {
    const invading = `${gt('Invading').toUpperCase()} - `;
    const out: CharacterTroopIconItem[] = [];
    const add = (list: CharacterTroopIconItem[]): void => {
        for (const i of list) out.push(i);
    };
    add(generateCharacterItems(characters ?? [], out.length, '', locationEmpire));
    add(generateTroopItems(troopsToRecruit ?? [], out.length, true, `${gt('Recruiting')} - `));
    add(generateTroopItems(troops ?? [], out.length, false, ''));
    add(generateTroopItems(invadingTroops ?? [], out.length, false, invading));
    add(generateCharacterItems(invadingCharacters ?? [], out.length, invading, locationEmpire));
    return out;
}

/** What ctlBuiltObjectList_SelectionChanged binds ctlBuiltObjectCharactersTroops to: a ship / base's characters and
 *  troops, a colony's characters, invading characters and troops (no recruits, no invading troops in this window). */
export function builtObjectTroopIconItems(o: BuiltObject | Habitat | null): CharacterTroopIconItem[] {
    if (o === null) return [];
    const troops = ((o.troops as { items?: Troop[] } | null)?.items ?? null) as Troop[] | null;
    const invadingCharacters = o instanceof Habitat ? habitatInvadingCharacterList(o) : null;
    return characterTroopIconItems((o.empire as Empire | null) ?? null, objectCharacters(o), invadingCharacters, troops, null, null);
}

// -------------------------------------------------------------------------------------------------------------------
// Troops tab: the ship's troop loadout (grpUseTroopLoadouts, method_179)
// -------------------------------------------------------------------------------------------------------------------

export type LoadoutKey = keyof TroopLoadout;
export const LOADOUT_KEYS: readonly LoadoutKey[] = ['infantry', 'armored', 'artillery', 'specialForces'];

/** method_179: the ship's loadout, null when all four bytes are 255 (chkUseTroopLoadouts unticked). */
export function shipTroopLoadout(bo: BuiltObject): TroopLoadout | null {
    if (bo.troopLoadoutInfantry === 255 && bo.troopLoadoutArmored === 255 && bo.troopLoadoutArtillery === 255 && bo.troopLoadoutSpecialForces === 255) return null;
    return { infantry: bo.troopLoadoutInfantry, armored: bo.troopLoadoutArmored, artillery: bo.troopLoadoutArtillery, specialForces: bo.troopLoadoutSpecialForces };
}

/** chkUseTroopLoadouts_CheckedChanged (ticked): (byte)(TroopCapacity / 100) Infantry, none of the others. The spinner
 *  takes at most 100 (NumericUpDown.Maximum; the C# throws past it). */
export function shipTroopLoadoutOn(troopCapacity: number): TroopLoadout {
    const b = Math.trunc(troopCapacity / 100) & 0xff;
    return { infantry: Math.min(100, b), armored: 0, artillery: 0, specialForces: 0 };
}

/**
 * numTroopLoadout*_ValueChanged: spinner `k` set to `value` (NumericUpDown 0..100) in the loadout `l` shown. Over the
 * ship's TroopCapacity (method_180) the handler backs the spinner off by ceil(excess / 100) units — setting Value again
 * re-enters the handler, which stores it once it fits; a back-off that changes nothing raises no ValueChanged and stores
 * nothing. Returns the loadout to store, or null when nothing is stored.
 */
export function shipTroopLoadoutSpin(l: TroopLoadout, k: LoadoutKey, value: number, troopCapacity: number): TroopLoadout | null {
    const v = Math.max(0, Math.min(100, Math.trunc(value)));
    if (v === l[k]) return null;
    let cur: TroopLoadout = { ...l, [k]: v };
    for (;;) {
        const num = shipTroopLoadoutSize(cur);
        if (troopCapacity >= num) return cur;
        const num2 = num - troopCapacity;
        const num3 = Math.trunc(0.999 + num2 / 100.0);
        const num4 = Math.max(0, cur[k] - num3);
        if (num4 === cur[k]) return null;
        cur = { ...cur, [k]: num4 };
    }
}

/** method_181: lblTroopLoadoutTotal, "Troop Loadout Description" = "{method_180} / {TroopCapacity}". */
export function troopLoadoutTotalText(l: TroopLoadout | null, troopCapacity: number): string {
    const size = shipTroopLoadoutSize(l ?? { infantry: 0, armored: 0, artillery: 0, specialForces: 0 });
    return gt('Troop Loadout Description', formatNet0(size), formatNet0(troopCapacity));
}

export interface ShipTroopLoadoutView {
    /** chkUseTroopLoadouts.Checked (= grpUseTroopLoadouts.Enabled). */
    checked: boolean;
    /** The four spinners (0 when unticked). */
    values: TroopLoadout;
    /** lblTroopLoadoutTotal. */
    total: string;
    /** lblBuiltObjectTroopLoadoutPartOfFleet ("Ship Fleet Troop Loadout override" for a ship in a fleet). */
    fleetNote: string;
}

/** Port of Main.Part11.cs 4433 method_179 for `bo` (null: a colony or nothing selected) showing `loadout`. */
export function shipTroopLoadoutView(bo: BuiltObject | null, loadout: TroopLoadout | null): ShipTroopLoadoutView {
    const zero = { infantry: 0, armored: 0, artillery: 0, specialForces: 0 };
    if (bo === null) return { checked: false, values: zero, total: '', fleetNote: '' };
    return {
        checked: loadout !== null,
        values: loadout ?? zero,
        total: troopLoadoutTotalText(loadout, bo.troopCapacity),
        fleetNote: bo.shipGroup != null ? gt('Ship Fleet Troop Loadout override') : '',
    };
}

/** The loadouts sent per ship until their replies land (quick spinner clicks each count; pendingCommands.ts). */
const pendingShipLoadout = new PendingValues<BuiltObject, TroopLoadout | null>();

/** The loadout the group shows: the one last sent while its reply is on the way, else the ship's. */
export function displayedShipTroopLoadout(bo: BuiltObject): TroopLoadout | null {
    return pendingShipLoadout.value(bo, shipTroopLoadout(bo));
}

function issueShipTroopLoadout(galaxy: Galaxy, empire: Empire, bo: BuiltObject, loadout: TroopLoadout | null, done: () => void): void {
    const settle = pendingShipLoadout.send(bo, loadout === null ? null : { ...loadout });
    issuePlayerCommand(galaxy, empire, 'setShipTroopLoadout', [bo, loadout], () => {
        settle();
        done();
    });
}

// -------------------------------------------------------------------------------------------------------------------
// Cargo tab: lblBuiltObjectCargoConstructionResourceShortage
// -------------------------------------------------------------------------------------------------------------------

/** ctlBuiltObjectList_SelectionChanged (Main.Part11.cs 4020-4047): a ship / base's ManufacturingQueue (else its
 *  RetrofitBaseManufacturingQueue) DeficientResources as "Construction Resource Shortage Message"; '' for a colony. */
export function constructionResourceShortageText(galaxy: Galaxy, o: BuiltObject | Habitat | null): string {
    if (o === null || o instanceof Habitat) return '';
    const bo = o as BuiltObject;
    let list: { resourceId: number }[] | null = null;
    const mq = bo.manufacturingQueue as ManufacturingQueue | null;
    const rq = bo.retrofitBaseManufacturingQueue as ManufacturingQueue | null;
    if (mq != null) list = mq.deficientResources?.items ?? null;
    else if (rq != null) list = rq.deficientResources?.items ?? null;
    if (list === null || list.length <= 0) return '';
    let text7 = '';
    for (let i = 0; i < list.length; i++) {
        if (i > 0) text7 += ', ';
        text7 += galaxy.resourceSystem.byId.get(list[i].resourceId)?.name ?? '';
    }
    return gt('Construction Resource Shortage Message', bo.name, text7);
}

// -------------------------------------------------------------------------------------------------------------------
// Construction Yards tab: the manufacturing plants (method_169)
// -------------------------------------------------------------------------------------------------------------------

/**
 * The ManufacturingQueue method_169 binds in the Ships and Bases / Construction Yards window (bool_28): none for
 * nothing or another empire's object (method_169 returns before binding), a ship / base's queue, and none for a colony
 * (this branch binds a colony's grids to null; the Colonies window shows them).
 */
export function siteManufacturingQueue(o: BuiltObject | Habitat | null, player: Empire): ManufacturingQueue | null {
    if (o === null || o.empire !== player || o instanceof Habitat) return null;
    return ((o as BuiltObject).manufacturingQueue as ManufacturingQueue | null) ?? null;
}

export interface ManufacturerRow {
    /** Cells[0].Tag: the index in the queue's Manufacturers. */
    index: number;
    manufacturer: Manufacturer;
    /** Cells[0]: ParentBuiltObjectComponent's picture, tooltip "Name(Industry)". */
    parentPictureRef: number | null;
    parentTooltip: string;
    /** Cells[1] / [2]: the component being made (null / '' when idle). */
    componentPictureRef: number | null;
    componentName: string;
    /** Cells[3]: Progress / Component.Size in "##0%", or the plain 0 of an idle plant. */
    progress: number;
    progressText: string;
    /** Cells[4]: ManufacturingSpeed. */
    speed: number;
}

/** Port of ManufacturerListView.cs BindData. `componentById` resolves ParentBuiltObjectComponent (the component
 *  definition of _ParentBuiltObjectComponentId; null for -1). */
export function manufacturerRows(manufacturers: readonly Manufacturer[] | null, componentById: (id: number) => ManufacturedComponent | null): ManufacturerRow[] {
    const rows: ManufacturerRow[] = [];
    if (manufacturers === null) return rows;
    for (let index = 0; index < manufacturers.length; ++index) {
        const m = manufacturers[index];
        if (m == null) continue;
        const parent = m.parentBuiltObjectComponentId >= 0 ? componentById(m.parentBuiltObjectComponentId) : null;
        const row: ManufacturerRow = {
            index,
            manufacturer: m,
            parentPictureRef: parent?.pictureRef ?? null,
            parentTooltip: parent !== null ? `${parent.name}(${IndustryType[parent.industry]})` : '',
            componentPictureRef: null,
            componentName: '',
            progress: 0,
            progressText: '0',
            speed: m.manufacturingSpeed,
        };
        if (m.component !== null) {
            row.componentPictureRef = m.component.pictureRef;
            row.componentName = m.component.name;
            const num = m.progress / m.component.size;
            row.progress = num;
            row.progressText = formatNetPercent0(num);
        }
        rows.push(row);
    }
    return rows;
}

export interface ComponentWaitRow {
    /** Cells[2].Tag: the index in the list. */
    index: number;
    component: ManufacturedComponent;
    pictureRef: number;
    name: string;
    /** Cells[3]: ResolveComponentCategoryAbbreviation, tooltip ResolveDescription. */
    category: string;
    categoryTitle: string;
    size: number;
    /** Cells[5]: TechPoints, always 1 in "####K". */
    tech: string;
}

/** Port of ComponentListView.cs BindData (SummarizedMode off; no galaxy, so no missing-resource colouring): one row per
 *  component of ManufacturingQueue.ComponentWaitQueue. */
export function componentWaitRows(components: readonly ManufacturedComponent[] | null): ComponentWaitRow[] {
    const rows: ComponentWaitRow[] = [];
    if (components === null) return rows;
    for (let index4 = 0; index4 < components.length; ++index4) {
        const c = components[index4];
        if (c == null) continue;
        rows.push({
            index: index4,
            component: c,
            pictureRef: c.pictureRef,
            name: c.name,
            category: resolveComponentCategoryAbbreviation(c.category),
            categoryTitle: resolveComponentCategoryDescription(c.category),
            size: c.size,
            tech: '1K',
        });
    }
    return rows;
}

/** method_169 positions in the Construction Yards tab page (below the 270 px the page shows: the C# page has no
 *  AutoScroll, so the grids are cut off there; our page scrolls to them). */
export const MANUFACTURING_LAYOUT = {
    manufacturersLabel: { x: 0, y: 345 },
    manufacturers: { x: 0, y: 360, w: 555, h: 150 },
    waitLabel: { x: 0, y: 520 },
    wait: { x: 0, y: 535, w: 555, h: 150 },
} as const;

export interface ManufacturingGrids {
    /** Bind the grids to the queue method_169 picks for `o` (re-rendered only when the rows changed). */
    bind(o: BuiltObject | Habitat | null): void;
}

/** lblConstructionYardManufacturers + duExoPvEoA (ManufacturerListView, rows 20) and
 *  lblConstructionYardManufacturerWaitQueue + ctlConstructionYardManufacturerWaitQueue (ComponentListView, rows 20) on
 *  `page` at method_169's positions. */
export function manufacturingGrids(page: HTMLElement, galaxy: Galaxy, player: Empire): ManufacturingGrids {
    const L = MANUFACTURING_LAYOUT;
    const defs = componentDefinitionsStatic(galaxy);
    const byId = (id: number): ManufacturedComponent | null => (defs[id]?.componentId === id ? defs[id] : (defs.find((d) => d.componentId === id) ?? null));
    dropText(page, gt('Manufacturing Plants'), L.manufacturersLabel.x, L.manufacturersLabel.y, { size: FONT.header, bold: true, color: COLORS.label });
    const plants = new OwGrid<ManufacturerRow>({
        key: (r) => r.index,
        rowHeight: 20,
        empty: '',
        columns: [
            { id: 'pp', header: '', width: 30, align: 'center', render: (r, c) => imageCell(c, r.parentPictureRef !== null ? componentImageUrl(r.parentPictureRef) : null, 18, 0, r.parentTooltip) },
            { id: 'cp', header: '', width: 30, align: 'center', render: (r, c) => imageCell(c, r.componentPictureRef !== null ? componentImageUrl(r.componentPictureRef) : null, 18) },
            { id: 'n', header: 'Component', width: 150, sort: (r) => r.componentName, render: (r, c) => textCell(c, r.componentName) },
            { id: 'p', header: 'Progress', width: 40, align: 'right', sort: (r) => r.progress, render: (r, c) => textCell(c, r.progressText) },
            { id: 's', header: 'Speed', width: 40, align: 'right', sort: (r) => r.speed, render: (r, c) => textCell(c, String(r.speed)) },
        ],
    });
    page.appendChild(place(plants.el, L.manufacturers.x, L.manufacturers.y, L.manufacturers.w, L.manufacturers.h));
    dropText(page, gt('Components waiting to be manufactured'), L.waitLabel.x, L.waitLabel.y, { size: FONT.header, bold: true, color: COLORS.label });
    const waiting = new OwGrid<ComponentWaitRow>({
        key: (r) => r.index,
        rowHeight: 20,
        empty: '',
        columns: [
            { id: 'p', header: '', width: 30, align: 'center', render: (r, c) => imageCell(c, componentImageUrl(r.pictureRef), 18) },
            {
                id: 'n', header: gt('Name'), width: 130, sort: (r) => r.name,
                render: (r, c) => {
                    textCell(c, r.name);
                    c.classList.add('dt-link-cell');
                },
            },
            { id: 'c', header: gt('Category'), width: 90, sort: (r) => r.category, render: (r, c) => textCell(c, r.category, r.categoryTitle) },
            { id: 's', header: gt('Size'), width: 40, align: 'right', sort: (r) => r.size, render: (r, c) => textCell(c, String(r.size)) },
            { id: 't', header: gt('Tech'), width: 40, align: 'right', render: (r, c) => textCell(c, r.tech) },
        ],
    });
    page.appendChild(place(waiting.el, L.wait.x, L.wait.y, L.wait.w, L.wait.h));
    let plantsKey: string | null = null;
    let waitKey: string | null = null;
    return {
        bind(o) {
            const mq = siteManufacturingQueue(o, player);
            const p = manufacturerRows(mq?.manufacturers ?? null, byId);
            const pk = p.map((r) => `${r.parentPictureRef}|${r.componentName}|${r.progressText}|${r.speed}`).join(',');
            if (pk !== plantsKey) {
                plantsKey = pk;
                plants.setRows(p);
            }
            const w = componentWaitRows(mq?.componentWaitQueue ?? null);
            const wk = w.map((r) => r.component.componentId).join(',');
            if (wk !== waitKey) {
                waitKey = wk;
                waiting.setRows(w);
            }
        },
    };
}

// -------------------------------------------------------------------------------------------------------------------
// The Set Fleet combo (cmbBuiltObjectSetFleet)
// -------------------------------------------------------------------------------------------------------------------

/** Port of Main.Part11.cs 4630 method_182: "Set Fleet...", "(None)", "(New Fleet)", then the empire's fleets. */
export function setFleetItems(empire: Empire): string[] {
    const items = [`${gt('Set Fleet')}...`, `(${gt('None')})`, `(${gt('New Fleet')})`];
    for (const sg of empireShipGroups(empire)) if (sg != null) items.push(sg.name ?? '');
    return items;
}

/** cmbBuiltObjectSetFleet_SelectedIndexChanged: what picking the item `text` orders — nothing ("Set Fleet..."), a new
 *  fleet, the first fleet of that name, or (no fleet has the name: "(None)") leave the fleet. */
export function setFleetChoice(empire: Empire, text: string): { kind: 'nothing' } | { kind: 'order'; target: SetFleetTarget } {
    if (text === `(${gt('New Fleet')})`) return { kind: 'order', target: 'new' };
    if (!(text !== `${gt('Set Fleet')}...`)) return { kind: 'nothing' };
    const fleet = empireShipGroups(empire).find((sg) => sg != null && (sg.name ?? '') === text) ?? null;
    return { kind: 'order', target: fleet };
}

/** The item selected after the order (method_182 re-fills the items): the LAST item after a new fleet (the C# picks
 *  Items.Count - 1, which is the new fleet only when it sorts last), the joined fleet's name, else "Set Fleet...". */
export function setFleetIndexAfter(items: readonly string[], target: SetFleetTarget, joined: ShipGroup | null): number {
    if (target === 'new') return items.length - 1;
    if (target !== null && joined !== null) {
        const i = items.indexOf(joined.name ?? '');
        return i >= 0 ? i : 0;
    }
    return 0;
}

export interface SetFleetCombo {
    readonly el: HTMLSelectElement;
    /** Re-fill the items when the fleets changed (keeping the shown item) and set Enabled. */
    update(enabled: boolean): void;
    /** ctlBuiltObjectList_SelectionChanged_1: back to "Set Fleet...". */
    reset(): void;
}

/** cmbBuiltObjectSetFleet: the combo for the window's selected ships (`ships()`); the order is the 'setShipsFleet'
 *  op after the Fleet Formation automation prompt (GenerateAutomationMessageBox when ControlMilitaryFleets). */
export function createSetFleetCombo(galaxy: Galaxy, empire: Empire, ships: () => BuiltObject[], onApplied: () => void): SetFleetCombo {
    const sel = el('select', 'ow-input ow-select dt-setfleet');
    sel.title = 'Put the selected military ships in a new fleet, an existing fleet, or no fleet';
    sel.addEventListener('keydown', (e) => e.stopPropagation());
    let items: string[] = [];
    const fill = (index: number): void => {
        items = setFleetItems(empire);
        sel.replaceChildren(
            ...items.map((t, i) => {
                const o = el('option', '', t);
                o.value = String(i);
                return o;
            }),
        );
        sel.value = String(Math.max(0, Math.min(items.length - 1, index)));
    };
    fill(0);
    sel.addEventListener('change', () => {
        const text = items[Number(sel.value)] ?? '';
        const list = ships();
        if (list.length <= 0) return;
        const choice = setFleetChoice(empire, text);
        if (choice.kind === 'nothing') return;
        const target = choice.target;
        const run = (): void =>
            issuePlayerCommand(galaxy, empire, 'setShipsFleet', [list, target], (joined) => {
                const next = setFleetItems(empire);
                fill(setFleetIndexAfter(next, target, joined));
                onApplied();
            });
        if (empire.controlMilitaryFleets) {
            void confirmAutomationOff('Fleet Formation').then((off) => {
                if (off) issuePlayerCommand(galaxy, empire, 'automationOff', ['Fleet Formation']);
                run();
            });
        } else run();
    });
    return {
        el: sel,
        update(enabled) {
            const next = setFleetItems(empire);
            if (next.join('\n') !== items.join('\n')) {
                const shown = items[Number(sel.value)] ?? '';
                const i = next.indexOf(shown);
                fill(i >= 0 ? i : 0);
            }
            sel.disabled = !enabled;
        },
        reset() {
            sel.value = '0';
        },
    };
}

/** Content key of a data tab (rebuild the page only when it changed). */
export function dataTabContentKey(tab: DataTabId, o: BuiltObject | Habitat | null, selectedComponent: number | null = null): string {
    if (o === null) return '';
    const len = (v: unknown): number => (Array.isArray(v) ? v.length : ((v as { items?: unknown[] } | null)?.items?.length ?? 0));
    switch (tab) {
        case 'cargo': {
            const deficient = (q: unknown): string => ((q as ManufacturingQueue | null)?.deficientResources?.items ?? []).map((r) => r.resourceId).join('.');
            const shortage = o instanceof Habitat ? '' : `${deficient((o as BuiltObject).manufacturingQueue)}/${deficient((o as BuiltObject).retrofitBaseManufacturingQueue)}`;
            return `${((o.cargo as { items?: { amount: number; reserved: number }[] } | null)?.items ?? []).map((c) => `${c.amount}/${c.reserved}`).join(',')}|${shortage}`;
        }
        case 'components': {
            if (o instanceof Habitat) return '';
            const bo = o as BuiltObject;
            return `${bo.name}:${(bo.components?.items ?? []).map((c) => c.status).join('')}:${(bo.disabledComponentIndexes ?? []).join('.')}:${bo.suppressAutoRetrofit ? 1 : 0}:${selectedComponent ?? ''}`;
        }
        case 'docking':
            return `${((o.dockingBays as ({ dockedShip: BuiltObject | null } | null)[] | null) ?? []).map((d) => `${d?.dockedShip?.name ?? ''}/${dockedShipCommand(d?.dockedShip ?? null)}`).join(',')}|${len((o as { dockingBayWaitQueue?: unknown }).dockingBayWaitQueue)}`;
        case 'troops': {
            const items = builtObjectTroopIconItems(o).map((i) => `${i.text}/${i.garrisoned ? 1 : 0}/${i.foreignColor ?? ''}`).join(',');
            if (o instanceof Habitat) return items;
            const bo = o as BuiltObject;
            const l = displayedShipTroopLoadout(bo);
            return `${items}|${l === null ? 'off' : LOADOUT_KEYS.map((k) => l[k]).join('.')}|${bo.troopCapacity}|${bo.shipGroup != null ? 1 : 0}|${bo.empire === null ? '' : bo.empire.name}`;
        }
        case 'weapons':
            return o instanceof Habitat ? '' : `${(o as BuiltObject).name}:${(o as BuiltObject).weapons.map((w) => `${w.component.componentId}/${w.rawDamage}/${w.range}`).join(',')}`;
    }
}

// -------------------------------------------------------------------------------------------------------------------
// Pages
// -------------------------------------------------------------------------------------------------------------------

export interface DataTabContext {
    galaxy: Galaxy;
    empire: Empire;
    /** The page element (tab page client area, original pixels). */
    page: HTMLElement;
    /** Rebuild the page (after a command, or a selection that changes another control of the page). */
    rebuild: () => void;
    /** Components tab: the selected component's index (kept by the caller across rebuilds). */
    selectedComponent: number | null;
    setSelectedComponent: (index: number | null) => void;
}

/** An image cell (Zoom layout): a picture centred in the cell. */
function imageCell(cell: HTMLElement, url: string | null, size: number, rotate = 0, title = '', opacity = 1): void {
    if (url === null) return;
    const img = el('img', 'dt-img');
    img.src = url;
    img.alt = '';
    img.draggable = false;
    img.style.width = `${size}px`;
    img.style.height = `${size}px`;
    if (rotate !== 0) img.style.transform = `rotate(${rotate}deg)`;
    if (opacity !== 1) img.style.opacity = String(opacity);
    img.onerror = () => img.remove();
    if (title) cell.title = title;
    cell.appendChild(img);
}

/** The empire flag cell (SortableImageCell with SmallFlagPicture). */
function flagCell(galaxy: Galaxy, cell: HTMLElement, empire: Empire | null): void {
    if (empire === null) {
        cell.title = `(${gt('None')})`;
        return;
    }
    cell.title = empire.name;
    const img = el('img', 'dt-flag');
    img.alt = '';
    img.draggable = false;
    cell.appendChild(img);
    void empireFlagUrl(galaxy, empire).then((u) => {
        img.src = u;
    });
}

function textCell(cell: HTMLElement, value: string, title = value): void {
    cell.textContent = value;
    if (title) cell.title = title;
}

/** ui/components/unbuilt.png / damaged.png (Main.Part13.cs LoadUiComponents, bitmap_22). */
function statusImageUrl(kind: 'unbuilt' | 'damaged'): string {
    return `/assets/dwu/images/ui/components/${kind}.png`;
}

function pageGrid<T>(page: HTMLElement, cols: GridColumn<T>[], data: T[], x: number, y: number, w: number, h: number, empty: string, extra: { key?: (r: T) => unknown; rowHeight?: number; onSelect?: (r: T) => void } = {}): OwGrid<T> {
    const g = new OwGrid<T>({ columns: cols, key: extra.key ?? ((r) => r), rowHeight: extra.rowHeight ?? 26, empty, onSelect: extra.onSelect });
    g.setRows(data);
    page.appendChild(place(g.el, x, y, w, h));
    return g;
}

/** Render one data tab's page for `o` (a ship / base, a colony, or nothing). */
export function renderDataTab(tab: DataTabId, o: BuiltObject | Habitat | null, ctx: DataTabContext): void {
    const { galaxy, empire, page } = ctx;
    const bo = o !== null && !(o instanceof Habitat) ? (o as BuiltObject) : null;
    switch (tab) {
        case 'cargo': {
            // ctlBuiltObjectCargo (350 × 275): Empire 30, Picture 40, Name 160, Amount 60, Reserved 60.
            type CargoRow = { empire: Empire | null; url: string | null; name: string; amount: number; reserved: number; resourceId: number | null };
            const items = ((o?.cargo as { items?: { commodity: { resourceId: number }; commodityComponent: { componentId: number } | null; amount: number; reserved: number; empire: unknown }[] } | null)?.items ?? []).map((c): CargoRow => {
                const res = c.commodityComponent === null ? galaxy.resources.find((r) => r.resourceId === c.commodity.resourceId) : undefined;
                const comp = c.commodityComponent !== null ? galaxy.researchStatic?.componentsById.get(c.commodityComponent.componentId) : undefined;
                return {
                    empire: (c.empire as Empire | null) ?? null,
                    url: res ? resourceIconUrl(res.pictureRef) : comp ? componentImageUrl((comp as { pictureRef: number }).pictureRef) : null,
                    name: res?.name ?? (comp as { name?: string } | undefined)?.name ?? '',
                    amount: c.amount,
                    reserved: c.reserved,
                    resourceId: res ? res.resourceId : null,
                };
            });
            pageGrid<CargoRow>(
                page,
                [
                    { id: 'e', header: gt('Empire'), width: 30, render: (r, c) => flagCell(galaxy, c, r.empire) },
                    { id: 'p', header: '', width: 40, align: 'center', render: (r, c) => imageCell(c, r.url, 22) },
                    { id: 'n', header: gt('Name'), width: 160, sort: (r) => r.name, render: (r, c) => {
                        textCell(c, r.name);
                        // [improvements] supplyChain: a resource name opens its supply panel.
                        if (r.resourceId !== null && resourceSupplyAvailable()) {
                            c.classList.add('dt-supply-link');
                            c.title = `${r.name}: where it is produced, held and needed in your empire (click)`;
                        }
                    }, onClick: (r) => {
                        if (r.resourceId !== null && resourceSupplyAvailable()) openResourceSupply(r.resourceId);
                    } },
                    { id: 'a', header: gt('Amount Abbreviation'), width: 60, align: 'right', sort: (r) => r.amount, render: (r, c) => textCell(c, r.amount.toLocaleString('en-US')) },
                    { id: 'r', header: gt('Reserved Abbreviation'), width: 60, align: 'right', sort: (r) => r.reserved, render: (r, c) => textCell(c, r.reserved.toLocaleString('en-US')) },
                ],
                items,
                0, 0, 350, 274, o === null ? '' : gt('No cargo'),
            );
            // lblBuiltObjectCargoConstructionResourceShortage (365, 5), MaximumSize 300 × 200, font_6, (255, 128, 0).
            const shortage = constructionResourceShortageText(galaxy, o);
            if (shortage !== '') {
                const t = text(shortage, { size: FONT.large, color: 'rgb(255, 128, 0)', wrapWidth: 300, shadow: false });
                t.classList.add('dt-shortage');
                page.appendChild(place(t, 365, 5));
            }
            return;
        }
        case 'components': {
            // ctlBuiltObjectComponents (0, 0) 455 × 275, rows 34 px: Picture 40, Name 275, Category 100, Size 40.
            const rows = componentRows(bo);
            const sel = rows.find((r) => r.index === ctx.selectedComponent) ?? null;
            const grid = pageGrid<ComponentRow>(
                page,
                [
                    {
                        id: 'p', header: '', width: 40, align: 'center', sort: (r) => r.statusText,
                        render: (r, c) => imageCell(c, typeof r.picture === 'number' ? componentImageUrl(r.picture) : statusImageUrl(r.picture), 30, 0, r.statusText, r.disabled ? 0.15 : 1),
                    },
                    { id: 'n', header: gt('Name'), width: 275, sort: (r) => r.name, render: (r, c) => textCell(c, r.name) },
                    { id: 'c', header: gt('Category'), width: 100, sort: (r) => r.category, render: (r, c) => textCell(c, r.category) },
                    { id: 's', header: gt('Size'), width: 40, align: 'right', sort: (r) => r.size, render: (r, c) => textCell(c, String(r.size)) },
                ],
                rows,
                0, 0, 455, 274, bo === null ? '' : gt('No components'),
                {
                    key: (r) => r.index,
                    rowHeight: 34,
                    onSelect: (r) => {
                        ctx.setSelectedComponent(r.index);
                        ctx.rebuild();
                    },
                },
            );
            if (sel !== null) grid.select(sel.index, false);
            // lblBuiltObjectComponentsResources (465, 0) 205 × 45, bottom-left, font_7 + ctlBuiltObjectComponentsResources
            // (465, 45) 205 × 165: Picture 40, Type 125, Quantity 40 (ctlBuiltObjectComponents_SelectionChanged).
            const label = text(sel !== null ? gt('Resources for', sel.component.def.name) : gt('Resources'), { size: FONT.large, bold: true, color: COLORS.label, wrapWidth: 205 });
            const labelBox = el('div', 'dt-res-label');
            labelBox.appendChild(label);
            page.appendChild(place(labelBox, 465, 0, 205, 45));
            type ResRow = { resourceId: number; quantity: number };
            const resRows: ResRow[] = sel !== null ? sel.component.def.resourceRequirements.map((q) => ({ resourceId: q.resourceId, quantity: q.amount })) : [];
            pageGrid<ResRow>(
                page,
                [
                    { id: 'p', header: '', width: 40, align: 'center', render: (r, c) => imageCell(c, resourceIconUrl(galaxy.resourceSystem.byId.get(r.resourceId)?.pictureRef ?? 0), 22) },
                    { id: 't', header: gt('Type'), width: 125, render: (r, c) => textCell(c, galaxy.resourceSystem.byId.get(r.resourceId)?.name ?? '') },
                    { id: 'q', header: gt('Quantity Abbreviation'), width: 40, align: 'right', render: (r, c) => textCell(c, String(Math.trunc(r.quantity))) },
                ],
                resRows,
                465, 45, 205, 165, '',
                { key: (r) => r.resourceId, rowHeight: 24 },
            );
            if (bo !== null) {
                // lblBuiltObjectAutoRetrofit (465, 220) font_6; cmbBuiltObjectAutoRetrofit (465, 240) 200 × 21.
                dropText(page, gt('Retrofit Stance'), 465, 220, { size: FONT.large, color: COLORS.label });
                const stance = dropDown(
                    [
                        { value: 'auto', label: gt('Auto Retrofit (including advisor suggestions)') },
                        { value: 'never', label: gt('Only Retrofit When Manually Ordered') },
                    ],
                    bo.suppressAutoRetrofit ? 'never' : 'auto',
                    (v) => issuePlayerCommand(galaxy, empire, 'setShipRetrofitStance', [[bo], v === 'auto'], () => ctx.rebuild()),
                );
                // cmbBuiltObjectAutoRetrofit.Enabled = false for the private sub-roles (and, here, for ships that are not ours).
                stance.disabled = bo.empire !== empire || isPrivateDesignSubRole(bo.subRole);
                page.appendChild(place(stance, 465, 240, 200, 21));
            }
            return;
        }
        case 'docking': {
            // ctlDockingBays (0, 0) 555 × 130: ComponentPicture 40, ShipEmpire 30, ShipPicture 40, ShipName 300, ShipCommand 145.
            const defs = componentDefinitionsStatic(galaxy);
            const bays = ((o?.dockingBays as (DockingBay | null)[] | null) ?? []).filter((b): b is DockingBay => b != null);
            pageGrid<DockingBay>(
                page,
                [
                    {
                        id: 'c', header: '', width: 40, align: 'center',
                        render: (r, c) => {
                            const d = defs[r.parentComponentId] ?? null;
                            if (d !== null) imageCell(c, componentImageUrl(d.pictureRef), 22, 0, d.name);
                        },
                    },
                    { id: 'e', header: '', width: 30, render: (r, c) => (r.dockedShip ? flagCell(galaxy, c, r.dockedShip.empire) : undefined) },
                    { id: 'p', header: '', width: 40, align: 'center', render: (r, c) => (r.dockedShip ? imageCell(c, shipImageUrl(r.dockedShip), 22, -90) : undefined) },
                    { id: 'n', header: gt('Ship'), width: 300, render: (r, c) => textCell(c, r.dockedShip?.name ?? '') },
                    { id: 'm', header: gt('Command'), width: 145, render: (r, c) => textCell(c, dockedShipCommand(r.dockedShip)) },
                ],
                bays,
                0, 0, 555, 130, o === null ? '' : gt('No docking bays'),
            );
            // lblDockingBayWaitQueue (0, 135) font_2; ctlDockingWaitQueue (0, 155) 555 × 120:
            // Empire 30, Picture 40, Name 155, Role 150, Mission 80, System 100.
            dropText(page, gt('Ships waiting for a Docking Bay'), 0, 135, { size: FONT.header, bold: true, color: COLORS.label });
            const queue = ((o as { dockingBayWaitQueue?: (BuiltObject | null)[] | null } | null)?.dockingBayWaitQueue ?? []).filter((b): b is BuiltObject => b != null);
            pageGrid<BuiltObject>(
                page,
                [
                    { id: 'e', header: '', width: 30, render: (r, c) => flagCell(galaxy, c, r.empire) },
                    { id: 'p', header: '', width: 40, align: 'center', render: (r, c) => imageCell(c, shipImageUrl(r), 22, -90) },
                    { id: 'n', header: gt('Name'), width: 155, render: (r, c) => textCell(c, r.name) },
                    { id: 'r', header: gt('Role'), width: 150, render: (r, c) => textCell(c, subRoleLabel(r.subRole)) },
                    {
                        id: 'm', header: gt('Mission'), width: 80,
                        render: (r, c) => {
                            const m = builtObjectMission(r.mission);
                            textCell(c, m !== null && m.type !== BuiltObjectMissionType.Undefined ? missionTypeLabel(m.type) : `(${gt('None')})`);
                        },
                    },
                    { id: 's', header: gt('System'), width: 100, render: (r, c) => textCell(c, r.nearestSystemStar?.name ?? '') },
                ],
                queue,
                0, 155, 555, 119, '',
            );
            return;
        }
        case 'troops': {
            renderTroopsPage(o, ctx);
            return;
        }
        case 'weapons': {
            // ctlWeapons (0, 0) 600 × 275, rows 45 px: Picture 40, Name 135, Speed 50, EnergyRequired 50, FireRate 50,
            // DamageGraph 275 (the 270 × 45 GenerateDamageGraph bitmap, Zoom layout).
            const rows = weaponRows(bo?.weapons ?? null);
            pageGrid<WeaponRow>(
                page,
                [
                    { id: 'p', header: '', width: 40, align: 'center', render: (r, c) => imageCell(c, componentImageUrl(r.pictureRef), 30) },
                    { id: 'n', header: gt('Name'), width: 135, sort: (r) => r.name, render: (r, c) => textCell(c, r.name) },
                    { id: 's', header: gt('Speed'), width: 50, align: 'right', sort: (r) => r.speed, render: (r, c) => textCell(c, String(r.speed)) },
                    { id: 'e', header: gt('Energy'), width: 50, align: 'right', sort: (r) => r.energyRequired, render: (r, c) => textCell(c, String(r.energyRequired)) },
                    { id: 'f', header: gt('Rate'), width: 50, align: 'right', sort: (r) => r.fireRate, render: (r, c) => textCell(c, String(r.fireRate)) },
                    { id: 'd', header: gt('Damage'), width: 275, render: (r, c) => damageGraphCell(c, r) },
                ],
                rows,
                0, 0, 600, 274, bo === null ? '' : gt('No weapons'),
                { key: (r) => r.index, rowHeight: 45 },
            );
            return;
        }
    }
}

/** The Troops page: ctlBuiltObjectCharactersTroops (0, 0) 455 × 275 (CharacterTroopListIconView: 56 px pictures,
 *  ShowItemToolTips) and, for a ship / base, grpUseTroopLoadouts (460, 10) 205 × 175 with chkUseTroopLoadouts over its
 *  caption (470, 7), the spinners (10, 23 + 30 i) and their labels (50, 28 + 30 i), lblTroopLoadoutTotal (10, 148) and
 *  lblBuiltObjectTroopLoadoutPartOfFleet (460, 195) 205 wide in yellow (method_178 / method_179). */
function renderTroopsPage(o: BuiltObject | Habitat | null, ctx: DataTabContext): void {
    const { galaxy, empire, page } = ctx;
    const box = scrollPanel('dt-icons');
    page.appendChild(place(box, 0, 0, 455, 274));
    const raceCount = galaxy.races.length;
    for (const item of builtObjectTroopIconItems(o)) {
        const tile = el('div', `dt-icon${item.faded ? ' dt-icon-faded' : ''}${item.garrisoned ? ' dt-icon-garrisoned' : ''}`);
        if (item.character !== null) {
            const pic = characterPortrait(item.character, 'large', 56);
            pic.classList.add('dt-icon-img');
            tile.appendChild(pic);
        } else if (item.troop !== null) {
            const tr = item.troop;
            const concord = { concordArt: raceHasConcordArt(galaxy, (tr.race as { name?: string } | null)?.name) };
            const i = el('img', 'dt-icon-img');
            i.alt = '';
            i.draggable = false;
            i.src = troopImageUrl(tr, raceCount, concord);
            wireTroopImageFallback(i, tr, raceCount, concord);
            tile.appendChild(i);
        }
        const label = el('div', 'dt-icon-label', item.text);
        if (item.foreignColor !== null) {
            label.style.color = rgbCss(item.foreignColor);
            label.style.fontWeight = 'bold';
        }
        tile.appendChild(label);
        tile.title = item.tooltip;
        tile.addEventListener('click', () => {
            for (const t of box.querySelectorAll('.dt-icon-sel')) if (t !== tile) t.classList.remove('dt-icon-sel');
            tile.classList.toggle('dt-icon-sel');
        });
        box.appendChild(tile);
    }
    const bo = o !== null && !(o instanceof Habitat) ? (o as BuiltObject) : null;
    // method_179(null) for a colony: the group is still there, unticked and disabled.
    const loadout = bo !== null ? displayedShipTroopLoadout(bo) : null;
    const view = shipTroopLoadoutView(bo, loadout);
    const canEdit = bo !== null && bo.empire === empire;
    const group = place(el('div', `dt-group${view.checked ? '' : ' dt-disabled'}`), 460, 10, 205, 175);
    page.appendChild(group);
    const check = el('input');
    check.type = 'checkbox';
    check.checked = view.checked;
    check.disabled = !canEdit;
    const caption = el('label', 'ow-check dt-group-caption');
    caption.style.fontSize = `${FONT.large}px`;
    caption.style.fontWeight = 'bold';
    caption.append(check, el('span', '', gt('Use Troop Loadouts')));
    page.appendChild(place(caption, 470, 2));
    check.addEventListener('change', () => {
        if (bo === null) return;
        issueShipTroopLoadout(galaxy, empire, bo, check.checked ? shipTroopLoadoutOn(bo.troopCapacity) : null, ctx.rebuild);
    });
    const typeText: Record<LoadoutKey, string> = { infantry: gt('TroopType Infantry'), armored: gt('TroopType Armored'), artillery: gt('TroopType Artillery'), specialForces: gt('TroopType SpecialForces') };
    LOADOUT_KEYS.forEach((k, i) => {
        const n = el('input', 'ow-input dt-num');
        n.type = 'number';
        n.min = '0';
        n.max = '100';
        n.step = '1';
        n.value = String(view.values[k]);
        n.disabled = !(canEdit && view.checked);
        n.style.fontSize = `${FONT.large}px`;
        n.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') e.stopPropagation();
        });
        n.addEventListener('change', () => {
            if (bo === null) return;
            const shown = displayedShipTroopLoadout(bo);
            if (shown === null) return;
            const next = shipTroopLoadoutSpin(shown, k, Math.trunc(Number(n.value) || 0), bo.troopCapacity);
            if (next === null) {
                ctx.rebuild();
                return;
            }
            issueShipTroopLoadout(galaxy, empire, bo, next, ctx.rebuild);
        });
        group.appendChild(place(n, 10, 23 + 30 * i, 38, 25));
        dropText(group, typeText[k], 50, 28 + 30 * i, { size: FONT.large, color: COLORS.label, shadow: false });
    });
    dropText(group, view.total, 10, 148, { size: FONT.large, color: COLORS.label, shadow: false });
    if (view.fleetNote !== '') page.appendChild(place(text(view.fleetNote, { size: FONT.large, bold: true, color: 'rgb(255, 255, 0)', wrapWidth: 205, shadow: false }), 460, 195));
}

/** The DamageGraph cell: GenerateDamageGraph's red polygon as SVG, with the Cells[5] tooltip. */
function damageGraphCell(cell: HTMLElement, r: WeaponRow): void {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '270');
    svg.setAttribute('height', '45');
    svg.setAttribute('viewBox', '0 0 270 45');
    svg.classList.add('dt-damage-graph');
    const poly = document.createElementNS(ns, 'polygon');
    poly.setAttribute('points', damageGraphPoints(r.weapon).map((p) => `${p.x},${p.y}`).join(' '));
    poly.setAttribute('fill', 'rgb(255, 0, 0)');
    svg.appendChild(poly);
    cell.appendChild(svg);
    cell.title = r.tooltip;
}
