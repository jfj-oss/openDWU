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
//   - Troops: ctlBuiltObjectCharactersTroops (455 × 275, method_178);
//   - Weapons: ctlWeapons (600 × 275, method_175; WeaponListView.cs BindData / GenerateDamageGraph).
// The tab captions with their counts are method_178's. Orders go through the player command queue.
//
// TODO(port): the troop loadout group of the Troops tab (grpUseTroopLoadouts, Main.Part11.cs 4433 method_179) and the
//   icon view of CharacterTroopListIconView (character portraits) — shown as a grid here.
// TODO(port): lblBuiltObjectCargoConstructionResourceShortage (ManufacturingQueue.DeficientResources) — Main.Part11.cs
//   method_178 / ctlBuiltObjectList_SelectionChanged.

import './builtObjectDataTabs.css';
import type { BuiltObject } from '../../sim/builtObject';
import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import type { Weapon } from '../../sim/weapon';
import type { DockingBay } from '../../sim/dockingBay';
import { Habitat } from '../../sim/types';
import { ComponentStatus, type BuiltObjectComponent } from '../../sim/builtObjectComponent';
import { ComponentType } from '../../sim/data/components';
import { CharacterRole } from '../../sim/characters';
import { BuiltObjectMissionType, CommandAction, builtObjectMission } from '../../sim/missions/mission';
import { isPrivateDesignSubRole } from '../../sim/player/playerOrders';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import { resolveComponentCategoryDescription } from '../../sim/player/designEditor';
import { componentDefinitionsStatic } from '../../sim/designGeneration';
import { missionTypeLabel, resourceIconUrl, subRoleLabel } from '../hud';
import { openResourceSupply, resourceSupplyAvailable } from './resourceSupply'; // [improvements] supplyChain
import { shipImageUrl } from '../selectionInfo';
import { empireFlagUrl } from '../selectionInfoView';
import { COLORS, FONT, OwGrid, dropDown, dropText, el, place, text, type GridColumn } from '../originalWindow';
import { componentImageUrl } from './designPanelsModel';
import { gt } from './researchBenefits';
import { troopRows, type TroopRow } from './troops';

export type DataTabId = 'cargo' | 'components' | 'docking' | 'troops' | 'weapons';

// -------------------------------------------------------------------------------------------------------------------
// Pure helpers (tested)
// -------------------------------------------------------------------------------------------------------------------

/** The tab captions with method_178's counts: cargo items, damaged components, ships on the slipways, docked ships,
 *  troops, weapons. */
export function builtObjectTabLabels(o: BuiltObject | Habitat | null): { cargo: string; components: string; yards: string; docking: string; troops: string; weapons: string } {
    const base = { cargo: gt('Cargo'), components: gt('Components'), yards: gt('Construction Yards'), docking: gt('Docking Bays'), troops: gt('Troops'), weapons: gt('Weapons') };
    if (o === null) return base;
    const n = (v: number, suffix = ''): string => (v > 0 ? ` (${v}${suffix})` : '');
    const bo = o instanceof Habitat ? null : (o as BuiltObject);
    const cargo = (o.cargo as { items?: unknown[] } | null)?.items?.length ?? 0;
    const yards = ((o.constructionQueue as { constructionYards?: ({ shipUnderConstruction: unknown } | null)[] | null } | null)?.constructionYards ?? []).filter((y) => y != null && y.shipUnderConstruction !== null).length;
    const bays = ((o.dockingBays as ({ dockedShip: unknown } | null)[] | null) ?? []).filter((d) => d != null && d.dockedShip !== null).length;
    const troops = (o.troops as { items?: unknown[] } | null)?.items?.length ?? 0;
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

/** Content key of a data tab (rebuild the page only when it changed). */
export function dataTabContentKey(tab: DataTabId, o: BuiltObject | Habitat | null, selectedComponent: number | null = null): string {
    if (o === null) return '';
    const len = (v: unknown): number => (Array.isArray(v) ? v.length : ((v as { items?: unknown[] } | null)?.items?.length ?? 0));
    switch (tab) {
        case 'cargo':
            return ((o.cargo as { items?: { amount: number; reserved: number }[] } | null)?.items ?? []).map((c) => `${c.amount}/${c.reserved}`).join(',');
        case 'components': {
            if (o instanceof Habitat) return '';
            const bo = o as BuiltObject;
            return `${bo.name}:${(bo.components?.items ?? []).map((c) => c.status).join('')}:${(bo.disabledComponentIndexes ?? []).join('.')}:${bo.suppressAutoRetrofit ? 1 : 0}:${selectedComponent ?? ''}`;
        }
        case 'docking':
            return `${((o.dockingBays as ({ dockedShip: BuiltObject | null } | null)[] | null) ?? []).map((d) => `${d?.dockedShip?.name ?? ''}/${dockedShipCommand(d?.dockedShip ?? null)}`).join(',')}|${len((o as { dockingBayWaitQueue?: unknown }).dockingBayWaitQueue)}`;
        case 'troops':
            return `${len(o.troops)}|${len((o as { characters?: unknown }).characters)}`;
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
            // ctlBuiltObjectCharactersTroops (0, 0) 455 × 275: the characters, then the troops.
            type TRow = { name: string; type: string; strength: string; troop: TroopRow | null };
            const chars = (((o as { characters?: unknown } | null)?.characters as { name: string; role: CharacterRole }[] | null) ?? []).map((ch): TRow => ({ name: ch.name, type: CharacterRole[ch.role].replace(/([a-z])([A-Z])/g, '$1 $2'), strength: '', troop: null }));
            const troops = troopRows((o?.troops as { items?: never[] } | null)?.items ?? []).map((t): TRow => ({ name: t.name, type: t.type, strength: `${Math.round(t.attack)} / ${Math.round(t.defend)}`, troop: t }));
            pageGrid<TRow>(
                page,
                [
                    { id: 'n', header: gt('Name'), width: 170, sort: (r) => r.name, render: (r, c) => textCell(c, r.name) },
                    { id: 't', header: gt('Type'), width: 130, sort: (r) => r.type, render: (r, c) => textCell(c, r.type) },
                    { id: 'x', header: gt('Experience'), width: 70, render: (r, c) => textCell(c, r.troop?.experience ?? '') },
                    { id: 's', header: 'Att / Def', fill: 1, align: 'right', render: (r, c) => textCell(c, r.strength) },
                ],
                [...chars, ...troops],
                0, 0, 455, 274, o === null ? '' : gt('No troops'),
            );
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
