// Fleet Settings panel (an Improvement: ui/improvements.ts 'fleetSettings', default on; not a window of the original).
// One original-style window (originalWindow.ts) with a fleet's behaviour settings, each with a one-line explanation of
// what it does in the C# (the source in the tooltip). The model, the C# sources and the op each control issues are in
// fleetSettingsModel.ts. Opened from the selection panel's fleet "Settings" button, the Fleets window's orders row and
// the Q key (hud.ts openFleetSettingsFor / keyboard.ts 'fleetSettings').
// Works on whatever galaxy it is given: the in-thread game, or the sim-worker replica (commands reach the worker; the
// pending values keep quick clicks right until the replies land).

import './fleetSettings.css';
import type { Galaxy } from '../../sim/galaxy';
import type { Empire } from '../../sim/empire';
import type { Habitat } from '../../sim/types';
import type { BuiltObject } from '../../sim/builtObject';
import type { StellarObject } from '../../sim/missions/mission';
import { empireShipGroups, type ShipGroup } from '../../sim/fleets/shipGroup';
import { FleetPosture } from '../../sim/diplomacyTick';
import {
    ATTACK_OVERMATCH_LABELS,
    attackRangeToStanceIndex,
    overmatchFactorToIndex,
    overmatchIndexToFactor,
    percentToPortion,
    portionToPercent,
    stanceIndexToAttackRange,
} from '../../sim/player/empireSettings';
import { shipGroupTotalTroopCapacity } from '../../sim/fleets/shipGroupTasks';
import type { TroopLoadout } from '../../sim/player/fleetOps';
import { PendingValues } from '../pendingCommands';
import { displayedFleetTroopLoadout, fleetLoadoutSpin, fleetName, issueFleetTroopLoadout, troopLoadoutLabels } from './fleetsList';
import { missionDescription } from '../selectionInfo';
import {
    COLORS,
    FONT,
    checkBox,
    dropDown,
    el,
    glassButton,
    linkLabel,
    numericUpDown,
    openOriginalWindow,
    place,
    setButtonLabel,
    setText,
    text,
    type NumericUpDown,
    type OriginalWindow,
} from '../originalWindow';
import { groupBox } from '../originalWindowControls';
import { requestSimRefresh } from '../../simworker/refresh';
import { createFleetMoveTogetherControl } from '../fleetMoveTogetherControl';
import {
    DEFAULT_STANCE_ITEMS,
    EXPLAIN,
    FLEET_STANCE_LABELS,
    FleetSettingsPending,
    displayedEmpireSetting,
    fleetBuildOrderOf,
    fleetDesignBehaviours,
    fleetLowestFuel,
    fleetRangeStep,
    fleetRangeStepLabel,
    fleetRepairRefuelTarget,
    fleetResupplyShips,
    fleetSettingsView,
    fleetStanceFields,
    fleetStanceIndex,
    issueCancelBuildOrder,
    issueClearAttackPoint,
    issueEmpireSetting,
    issueFleetAutomated,
    issueFleetHomeBase,
    issueFleetOnce,
    issueFleetPosture,
    issueFleetRange,
    issueFleetStance,
    issueResupplyMembership,
    playerFleets,
    resupplyShipState,
    unassignedResupplyShips,
    type Explanation,
} from './fleetSettingsModel';

export interface FleetSettingsOptions {
    empire: Empire;
    /** The fleet to show (else the first fleet). */
    fleet?: ShipGroup | null;
    /** Pick on Map: the fleet becomes the selection and the next map click picks the point (the window closes). */
    onPickPoint?: (sg: ShipGroup, mode: 'homeBase' | 'attackPoint') => void;
    /** A ship clicked in the panel (a resupply ship). */
    onSelectShip?: (ship: BuiltObject) => void;
    /** Ship Designs… (F8). */
    onOpenDesigns?: () => void;
    /** Fleet Designs… (the Fleets window's Fleet Designs tab). */
    onOpenFleetDesigns?: () => void;
}

/** Window size in the original's pixels (two columns of groups). */
export const FLEET_SETTINGS_WINDOW = { w: 1000, h: 892 + 70 } as const;
const COL_W = 476;
const COL_L = 10;
const COL_R = 498;

interface OpenState {
    win: OriginalWindow;
    close: () => void;
    show: (sg: ShipGroup | null) => void;
}

let open: OpenState | null = null;

/** Open the panel on `opts.fleet`; when open already, switch it to that fleet (or close it for the same fleet). */
export function toggleFleetSettings(opts: FleetSettingsOptions): void {
    if (open !== null && !open.win.closed) {
        open.close();
        return;
    }
    open = createFleetSettings(opts);
}

/** Open (or bring to the front, on `opts.fleet`). */
export function openFleetSettings(opts: FleetSettingsOptions): void {
    if (open !== null && !open.win.closed) {
        document.body.appendChild(open.win.root);
        if (opts.fleet) open.show(opts.fleet);
        return;
    }
    open = createFleetSettings(opts);
}

export function closeFleetSettings(): void {
    open?.close();
}

export function isFleetSettingsOpen(): boolean {
    return open !== null && !open.win.closed;
}

const F_LABEL = FONT.large;
const F_EXPLAIN = FONT.tiny;

function createFleetSettings(opts: FleetSettingsOptions): OpenState {
    const { empire } = opts;
    const galaxy = empire.galaxy as Galaxy;
    const pending = new FleetSettingsPending();
    const pendingLoadout = new PendingValues<ShipGroup, TroopLoadout | null>();
    let current: ShipGroup | null = opts.fleet ?? playerFleets(empire)[0] ?? null;
    let timer = 0;

    const win = openOriginalWindow({
        id: 'fleetsettings',
        title: 'Fleet Settings',
        icon: 'fleets.png',
        width: FLEET_SETTINGS_WINDOW.w,
        height: FLEET_SETTINGS_WINDOW.h,
        onClose: () => {
            window.clearInterval(timer);
            pending.clear();
            pendingLoadout.clear();
            if (open?.win === win) open = null;
        },
    });
    const body = win.body;
    body.classList.add('fs-body');
    const close = (): void => win.close();

    // ---------------------------------------------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------------------------------------------
    const fleet = (): ShipGroup | null => {
        if (current !== null && !empireShipGroups(empire).includes(current)) current = null;
        return current;
    };
    const withFleet = (fn: (sg: ShipGroup) => void): void => {
        const sg = fleet();
        if (sg !== null) fn(sg);
    };
    const done = (): void => refresh();
    const group = (title: string, x: number, y: number, h: number): HTMLDivElement => {
        const g = place(groupBox(title, COL_W, h, FONT.header), x, y);
        body.appendChild(g);
        return g;
    };
    const label = (g: HTMLElement, s: string, x: number, y: number): HTMLDivElement => {
        const t = text(s, { size: F_LABEL, bold: true, color: COLORS.label, shadow: false, className: 'fs-label' });
        g.appendChild(place(t, x, y));
        return t;
    };
    const value = (g: HTMLElement, x: number, y: number, w: number): HTMLDivElement => {
        const t = text('', { size: F_LABEL, color: COLORS.text, shadow: false, className: 'fs-value' });
        g.appendChild(place(t, x, y, w));
        return t;
    };
    const explain = (g: HTMLElement, y: number, e: Explanation, x = 10): HTMLDivElement => {
        const t = text(e.text, { size: F_EXPLAIN, color: 'rgb(140, 140, 150)', shadow: false, className: 'fs-explain' });
        t.title = e.ref;
        g.appendChild(place(t, x, y, COL_W - x - 10));
        return t;
    };
    const setExplain = (t: HTMLDivElement, e: Explanation): void => {
        setText(t, e.text);
        t.title = e.ref;
    };
    const button = (g: HTMLElement, s: string, x: number, y: number, w: number, h: number, onClick: () => void, title = ''): HTMLButtonElement => {
        const b = glassButton(s, { onClick, size: FONT.small, title, className: 'fs-btn' });
        g.appendChild(place(b, x, y, w, h));
        return b;
    };
    /** A row of mutually exclusive buttons (the active one lit). */
    const segments = (g: HTMLElement, labels: readonly string[], x: number, y: number, w: number, onPick: (i: number) => void): { buttons: HTMLButtonElement[]; set: (i: number) => void } => {
        const gap = 4;
        const bw = Math.floor((w - gap * (labels.length - 1)) / labels.length);
        const buttons = labels.map((s, i) => {
            const b = button(g, s, x + i * (bw + gap), y, bw, 24, () => withFleet(() => onPick(i)));
            b.classList.add('fs-seg');
            return b;
        });
        return {
            buttons,
            set: (i) => buttons.forEach((b, j) => b.classList.toggle('fs-on', i === j)),
        };
    };
    const nameOf = (o: StellarObject | null): string => (o === null ? '(None)' : ((o as { name?: string }).name ?? '(None)'));

    // ---------------------------------------------------------------------------------------------------------------
    // Top: the fleet picker and its status line.
    // ---------------------------------------------------------------------------------------------------------------
    body.appendChild(place(text('Fleet', { size: FONT.header, bold: true, color: 'rgb(120, 120, 120)', shadow: false }), 10, 8));
    const fleetCombo = dropDown([], '', (v) => {
        show(playerFleets(empire)[Number(v)] ?? null);
    });
    fleetCombo.classList.add('fs-combo');
    body.appendChild(place(fleetCombo, 70, 6, 300, 24));
    const status = text('', { size: FONT.normal, color: COLORS.label, shadow: false, className: 'fs-status' });
    body.appendChild(place(status, 384, 9, 590));
    let fleetListKey = '';
    const fillFleetCombo = (): void => {
        const list = playerFleets(empire);
        const key = list.map((sg) => fleetName(sg)).join('\n');
        if (key !== fleetListKey) {
            fleetListKey = key;
            fleetCombo.replaceChildren(
                ...list.map((sg, i) => {
                    const o = el('option', '', fleetName(sg));
                    o.value = String(i);
                    return o;
                }),
            );
        }
        const i = current === null ? -1 : list.indexOf(current);
        fleetCombo.selectedIndex = i;
    };

    // ===============================================================================================================
    // Left column
    // ===============================================================================================================
    // --- Posture & Range (y 40, 286 tall).
    const gPosture = group('Posture and Range', COL_L, 40, 286);
    label(gPosture, 'Posture', 10, 24);
    const posture = segments(gPosture, ['Attack', 'Defend'], 150, 22, 316, (i) =>
        withFleet((sg) => issueFleetPosture(galaxy, empire, sg, i === 0 ? FleetPosture.Attack : FleetPosture.Defend, pending, done) && refresh()),
    );
    const postureExplain = explain(gPosture, 50, EXPLAIN.postureAttack);

    label(gPosture, 'Range', 10, 76);
    const range = segments(gPosture, ['Target', 'System', 'Nearby', 'Sector', 'Anywhere'], 150, 74, 316, (i) =>
        withFleet((sg) => issueFleetRange(galaxy, empire, sg, i, pending, done) && refresh()),
    );
    for (const b of range.buttons) b.classList.add('fs-seg-small');
    explain(gPosture, 102, EXPLAIN.range);

    label(gPosture, 'Home base', 10, 128);
    const homeValue = value(gPosture, 150, 128, 140);
    button(gPosture, 'Pick on Map', 296, 126, 92, 24, () => withFleet((sg) => pick(sg, 'homeBase')), 'Click a friendly colony or base on the map (empty space clears)');
    const homeClear = button(gPosture, 'Clear', 394, 126, 72, 24, () => withFleet((sg) => issueFleetHomeBase(galaxy, empire, sg, null, pending, done) && refresh()));
    const colonies = (): Habitat[] => [...empire.colonies].filter((c) => c != null).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    let colonyList: Habitat[] = [];
    const homeCombo = dropDown([], '', () => {});
    homeCombo.classList.add('fs-combo');
    gPosture.appendChild(place(homeCombo, 150, 156, 238, 24));
    button(gPosture, 'Set', 394, 156, 72, 24, () =>
        withFleet((sg) => {
            const c = colonyList[Number(homeCombo.value)];
            if (homeCombo.value !== '' && c !== undefined) {
                issueFleetHomeBase(galaxy, empire, sg, c, pending, done);
                homeCombo.value = '';
                refresh();
            }
        }),
    'Main.Part6.cs btnShipGroupInfoSetHomeColony_Click');
    explain(gPosture, 184, EXPLAIN.homeBase);
    let colonyKey = '';
    const fillColonies = (): void => {
        colonyList = colonies();
        const key = colonyList.map((c) => c.name).join('\n');
        if (key === colonyKey) return;
        colonyKey = key;
        const keep = homeCombo.value;
        homeCombo.replaceChildren(
            ...[{ value: '', label: '(Select new home colony)' }, ...colonyList.map((c, i) => ({ value: String(i), label: c.name }))].map((o) => {
                const opt = el('option', '', o.label);
                opt.value = o.value;
                return opt;
            }),
        );
        homeCombo.value = keep;
    };

    label(gPosture, 'Attack point', 10, 212);
    const attackValue = value(gPosture, 150, 212, 140);
    button(gPosture, 'Pick on Map', 296, 210, 92, 24, () => withFleet((sg) => pick(sg, 'attackPoint')), 'Click an enemy colony or base on the map (empty space clears)');
    const attackClear = button(gPosture, 'Clear', 394, 210, 72, 24, () => withFleet((sg) => issueClearAttackPoint(galaxy, empire, sg, pending, done) && refresh()));
    explain(gPosture, 240, EXPLAIN.attackPoint);

    // --- Engagement (y 334, 300 tall).
    const gEngage = group('Engagement', COL_L, 334, 300);
    label(gEngage, 'Stance', 10, 24);
    const stance = segments(gEngage, FLEET_STANCE_LABELS, 150, 22, 316, (i) => withFleet((sg) => issueFleetStance(galaxy, empire, sg, i, pending, done) && refresh()));
    explain(gEngage, 50, EXPLAIN.stance);
    const defaultsLabel = label(gEngage, 'Defaults', 10, 76);
    const defaultCombos: { label: HTMLDivElement; combo: HTMLSelectElement }[] = [];
    for (let i = 0; i < 4; i++) {
        const x = 150 + (i % 2) * 160;
        const y = 76 + Math.floor(i / 2) * 28;
        const l = text('', { size: FONT.small, color: COLORS.label, shadow: false, className: 'fs-mini' });
        gEngage.appendChild(place(l, x, y + 3, 52));
        const c = dropDown(DEFAULT_STANCE_ITEMS.map((s, j) => ({ value: String(j), label: s.replace('No default stance (no change)', 'No default') })), '0', (v) =>
            withFleet((sg) => {
                const f = fleetStanceFields(fleetSettingsView(sg, pending).automated)[i].field;
                issueEmpireSetting(galaxy, empire, f, stanceIndexToAttackRange(Number(v)), pending, done);
                refresh();
            }),
        );
        c.classList.add('fs-combo', 'fs-combo-small');
        gEngage.appendChild(place(c, x + 52, y, 104, 24));
        defaultCombos.push({ label: l, combo: c });
    }
    explain(gEngage, 132, EXPLAIN.defaults);
    label(gEngage, 'Tactics', 10, 158);
    const tacticsList = place(el('div', 'fs-list'), 150, 158, 316, 76);
    gEngage.appendChild(tacticsList);
    const retrofit = button(gEngage, 'Retrofit to latest designs', 150, 238, 200, 24, () => withFleet((sg) => issueFleetOnce(galaxy, empire, sg, 'fleetRetrofit', pending, done) && refresh()), 'Main.Part3.cs btnShipGroupRetrofit_Click');
    if (opts.onOpenDesigns) gEngage.appendChild(place(linkLabel('Ship Designs...', () => opts.onOpenDesigns?.(), FONT.small), 362, 242));
    explain(gEngage, 268, EXPLAIN.tactics);

    // --- Automation (y 642, 84 tall).
    const gAuto = group('Automation', COL_L, 642, 84);
    label(gAuto, 'Control', 10, 24);
    const auto = segments(gAuto, ['Automated', 'Manual'], 150, 22, 316, (i) => withFleet((sg) => issueFleetAutomated(galaxy, empire, sg, i === 0, pending, done) && refresh()));
    const autoExplain = explain(gAuto, 52, EXPLAIN.automatedOn);

    // --- Fleet Design (y 734, 50 + explain).
    const gTemplate = group('Fleet Design', COL_L, 734, 82);
    const templateValue = value(gTemplate, 10, 24, 258);
    const cancelOrder = button(gTemplate, 'Cancel Order', 274, 22, 96, 24, () =>
        withFleet((sg) => {
            const o = fleetBuildOrderOf(empire, sg);
            if (o !== null) issueCancelBuildOrder(galaxy, empire, o.order.id, pending, done);
        }),
    );
    if (opts.onOpenFleetDesigns) gTemplate.appendChild(place(linkLabel('Fleet Designs...', () => opts.onOpenFleetDesigns?.(), FONT.tiny), 380, 27));
    explain(gTemplate, 52, EXPLAIN.template);

    // --- Movement (y 824): "Move together" (an openDWU rule, not in the original; fleetMoveTogetherControl.ts).
    const gMove = group('Movement', COL_L, 824, 62);
    const moveTogether = createFleetMoveTogetherControl(empire, COL_W - 20, () => refresh(), F_LABEL);
    gMove.appendChild(place(moveTogether.el, 10, 20));
    explain(gMove, 44, { text: 'Gather first, then travel as one at the slowest speed and jump together (openDWU rule).', ref: 'sim/fleets/moveTogether.ts (not in the original: each member flies alone, ShipGroup.cs AssignMissionToShips)' });

    // ===============================================================================================================
    // Right column
    // ===============================================================================================================
    // --- Retreat & Attack Readiness (y 40, 260 tall).
    const gRetreat = group('Retreat and Attack Readiness', COL_R, 40, 286);
    label(gRetreat, 'Flee when', 10, 24);
    const fleeList = place(el('div', 'fs-list'), 150, 24, 316, 50);
    gRetreat.appendChild(fleeList);
    explain(gRetreat, 78, EXPLAIN.fleeWhen);
    label(gRetreat, 'Overmatch', 10, 104);
    const overmatch = segments(gRetreat, ATTACK_OVERMATCH_LABELS, 150, 102, 316, (i) => {
        issueEmpireSetting(galaxy, empire, 'attackOvermatchFactor', overmatchIndexToFactor(i), pending, done);
        refresh();
    });
    explain(gRetreat, 130, EXPLAIN.overmatch);
    const percentRow = (y: number, title: string, field: 'fleetAttackGatherPortion' | 'fleetAttackRefuelPortion', e: Explanation): NumericUpDown => {
        label(gRetreat, title, 10, y);
        const n = numericUpDown({
            value: 0,
            min: 0,
            max: 100,
            size: FONT.normal,
            onChange: (v) => {
                issueEmpireSetting(galaxy, empire, field, percentToPortion(v), pending, done);
            },
        });
        gRetreat.appendChild(place(n.el, 150, y - 2, 70, 24));
        gRetreat.appendChild(place(text('% of the fleet  (empire-wide)', { size: FONT.small, color: COLORS.label, shadow: false }), 228, y + 1));
        explain(gRetreat, y + 26, e);
        return n;
    };
    const gather = percentRow(156, 'Gather first', 'fleetAttackGatherPortion', EXPLAIN.gather);
    const refuelFirst = percentRow(208, 'Refuel first', 'fleetAttackRefuelPortion', EXPLAIN.refuelFirst);

    // --- Fuel & Refuelling (y 334, 136 tall).
    const gFuel = group('Fuel and Refuelling', COL_R, 334, 136);
    label(gFuel, 'Auto refuel', 10, 24);
    const fuelValue = value(gFuel, 150, 24, 316);
    const fuelExplain = explain(gFuel, 50, EXPLAIN.refuelAuto);
    label(gFuel, 'Refuel point', 10, 76);
    const refuelValue = value(gFuel, 150, 76, 170);
    const repair = button(gFuel, 'Repair and Refuel', 326, 74, 140, 24, () => withFleet((sg) => issueFleetOnce(galaxy, empire, sg, 'fleetRepairAndRefuel', pending, done) && refresh()));
    explain(gFuel, 102, EXPLAIN.refuelPoint);

    // --- Troops (y 478, 160 tall).
    const gTroops = group('Troops', COL_R, 478, 160);
    const useInput = checkBox('Use Troop Loadouts', false, (v) =>
        withFleet((sg) => issueFleetTroopLoadout(galaxy, empire, sg, v ? { infantry: 100, armored: 0, artillery: 0, specialForces: 0 } : null, pendingLoadout, done)),
    FONT.normal);
    gTroops.appendChild(place(useInput, 10, 22));
    const useCheck = useInput.querySelector('input')!;
    const keys: (keyof TroopLoadout)[] = ['infantry', 'armored', 'artillery', 'specialForces'];
    const spins = {} as Record<keyof TroopLoadout, NumericUpDown>;
    const spinLabels = {} as Record<keyof TroopLoadout, HTMLDivElement>;
    keys.forEach((k, i) => {
        const x = 10 + (i % 2) * 232;
        const y = 50 + Math.floor(i / 2) * 28;
        const n = numericUpDown({
            value: 0,
            min: 0,
            max: 100,
            size: FONT.normal,
            onChange: (v) =>
                withFleet((sg) => {
                    const l = displayedFleetTroopLoadout(sg, pendingLoadout);
                    if (l === null) return;
                    issueFleetTroopLoadout(galaxy, empire, sg, fleetLoadoutSpin(l, k, v), pendingLoadout, done);
                }),
        });
        gTroops.appendChild(place(n.el, x, y, 54, 24));
        spins[k] = n;
        spinLabels[k] = text('', { size: FONT.small, color: COLORS.label, shadow: false, className: 'fs-mini' });
        gTroops.appendChild(place(spinLabels[k], x + 58, y + 3, 170));
    });
    const capacity = value(gTroops, 10, 108, 300);
    const loadTroops = button(gTroops, 'Load Troops', 346, 106, 120, 24, () => withFleet((sg) => issueFleetOnce(galaxy, empire, sg, 'fleetLoadTroops', pending, done) && refresh()));
    explain(gTroops, 134, EXPLAIN.troops);

    // --- Resupply Ships (y 646, 170 tall).
    const gSupply = group('Resupply Ships', COL_R, 646, 170);
    label(gSupply, 'In fleet', 10, 24);
    const supplyList = place(el('div', 'fs-list fs-supply'), 150, 24, 316, 52);
    gSupply.appendChild(supplyList);
    label(gSupply, 'Add', 10, 86);
    let supplyChoices: BuiltObject[] = [];
    const supplyCombo = dropDown([], '', () => {});
    supplyCombo.classList.add('fs-combo');
    gSupply.appendChild(place(supplyCombo, 150, 84, 210, 24));
    const supplyAdd = button(gSupply, 'Add to Fleet', 366, 84, 100, 24, () =>
        withFleet((sg) => {
            const ship = supplyChoices[Number(supplyCombo.value)];
            if (supplyCombo.value !== '' && ship !== undefined) {
                issueResupplyMembership(galaxy, empire, ship, sg, pending, done);
                refresh();
            }
        }),
    'Main.Part6.cs cmbBuiltObjectSetFleet: the ship joins this fleet');
    const supplyPoint = value(gSupply, 150, 114, 316);
    supplyPoint.classList.add('fs-small');
    explain(gSupply, 144, EXPLAIN.resupply);

    // ---------------------------------------------------------------------------------------------------------------
    // Refresh
    // ---------------------------------------------------------------------------------------------------------------
    let tacticsKey = '';
    let supplyKey = '';
    let supplyChoiceKey = '';
    const allControls = (): (HTMLButtonElement | HTMLSelectElement | HTMLInputElement)[] =>
        [...body.querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLInputElement>('button.fs-btn, select.fs-combo:not([data-fleet]), input')];
    fleetCombo.dataset.fleet = '1';

    function refresh(): void {
        if (win.closed) return;
        fillFleetCombo();
        fillColonies();
        const sg = fleet();
        for (const c of allControls()) c.disabled = sg === null;
        moveTogether.update(sg);
        if (sg === null) {
            setText(status, playerFleets(empire).length === 0 ? 'You have no fleets.' : 'No fleet selected.');
            return;
        }
        const v = fleetSettingsView(sg, pending);
        const lead = sg.leadShip;
        setText(status, `${sg.ships.length} ships · ${missionDescription(sg.mission, empire)}${lead?.nearestSystemStar ? ` · ${lead.nearestSystemStar.name}` : ''}`);

        // Posture and range.
        posture.set(v.posture === FleetPosture.Attack ? 0 : v.posture === FleetPosture.Defend ? 1 : -1);
        setExplain(postureExplain, v.posture === FleetPosture.Defend ? EXPLAIN.postureDefend : EXPLAIN.postureAttack);
        const step = fleetRangeStep(v.rangeSquared);
        range.set(step);
        range.buttons.forEach((b, i) => {
            const t = fleetRangeStepLabel(i, v.posture);
            setButtonLabel(b, i === 2 ? 'Nearby' : t);
            b.title = t;
        });
        setText(homeValue, nameOf(v.homeBase));
        homeValue.title = nameOf(v.homeBase);
        homeClear.disabled = v.homeBase === null;
        setText(attackValue, nameOf(v.attackPoint));
        attackValue.title = nameOf(v.attackPoint);
        attackClear.disabled = v.attackPoint === null;

        // Engagement.
        stance.set(fleetStanceIndex(v.attackRangeSquared));
        const fields = fleetStanceFields(v.automated);
        setText(defaultsLabel, v.automated ? 'Defaults (auto)' : 'Defaults (manual)');
        defaultsLabel.title = v.automated ? 'Empire default stances for automated fleets' : 'Empire default stances for manual fleets and manually assigned missions';
        fields.forEach((f, i) => {
            setText(defaultCombos[i].label, f.label);
            const idx = attackRangeToStanceIndex(displayedEmpireSetting(empire, f.field, pending));
            const c = defaultCombos[i].combo;
            if (document.activeElement !== c) {
                if (idx < 0) c.selectedIndex = -1;
                else c.value = String(idx);
            }
        });
        const behaviours = fleetDesignBehaviours(sg);
        const tKey = behaviours.map((b) => `${b.design.name}|${b.count}|${b.stronger}|${b.weaker}|${b.invasion}|${b.fleeWhen}`).join('\n');
        if (tKey !== tacticsKey) {
            tacticsKey = tKey;
            tacticsList.replaceChildren(
                ...behaviours.flatMap((b) => {
                    const head = el('div', 'fs-list-row fs-list-head', `${b.design.name} ×${b.count}`);
                    const r = el('div', 'fs-list-row fs-list-sub', `Stronger: ${b.stronger} · Weaker: ${b.weaker} · ${b.invasion}`);
                    head.title = r.title = `${b.design.name} ×${b.count}: vs stronger targets ${b.stronger}, vs weaker targets ${b.weaker}, invasion ${b.invasion}`;
                    return [head, r];
                }),
            );
            fleeList.replaceChildren(
                ...behaviours.map((b) => {
                    const r = el('div', 'fs-list-row', `${b.design.name} ×${b.count}: ${b.fleeWhen}`);
                    r.title = r.textContent ?? '';
                    return r;
                }),
            );
        }

        // Automation.
        auto.set(v.automated ? 0 : 1);
        setExplain(autoExplain, v.automated ? EXPLAIN.automatedOn : EXPLAIN.automatedOff);

        // Fleet design.
        const order = fleetBuildOrderOf(empire, sg);
        setText(templateValue, order === null ? '(Not formed by a fleet design)' : `Forming: ${order.order.name} (${order.progress.built} / ${order.progress.total} ships)`);
        cancelOrder.disabled = order === null;

        // Retreat and attack readiness (empire-wide).
        overmatch.set(overmatchFactorToIndex(displayedEmpireSetting(empire, 'attackOvermatchFactor', pending)));
        if (document.activeElement !== gather.input) gather.setValue(portionToPercent(displayedEmpireSetting(empire, 'fleetAttackGatherPortion', pending)));
        if (document.activeElement !== refuelFirst.input) refuelFirst.setValue(portionToPercent(displayedEmpireSetting(empire, 'fleetAttackRefuelPortion', pending)));

        // Fuel.
        setText(fuelValue, `${v.automated ? 'Automated' : 'Manual'} · lowest ship fuel ${Math.round(fleetLowestFuel(sg) * 100)}%`);
        setExplain(fuelExplain, v.automated ? EXPLAIN.refuelAuto : EXPLAIN.refuelManual);
        const t = fleetRepairRefuelTarget(galaxy, empire, sg);
        const where = t.target === null ? '(None in reach)' : nameOf(t.target);
        setText(refuelValue, t.kind === 'repair' ? `Repair at ${where}` : where);
        refuelValue.title = refuelValue.textContent ?? '';
        repair.disabled = t.target === null;

        // Troops.
        const loadout = displayedFleetTroopLoadout(sg, pendingLoadout);
        useCheck.checked = loadout !== null;
        const labels = troopLoadoutLabels(sg);
        for (const k of keys) {
            spins[k].setEnabled(loadout !== null);
            if (document.activeElement !== spins[k].input) spins[k].setValue(loadout?.[k] ?? 0);
            setText(spinLabels[k], labels[k]);
        }
        setText(capacity, `Troop capacity ${shipGroupTotalTroopCapacity(sg).toFixed(0)}`);
        loadTroops.disabled = shipGroupTotalTroopCapacity(sg) <= 0;

        // Resupply ships.
        const members = fleetResupplyShips(sg).filter((s) => pending.member.value(s, sg) === sg);
        const sKey = members.map((s) => `${s.builtObjectID}|${s.name}|${resupplyShipState(s)}`).join('\n');
        if (sKey !== supplyKey) {
            supplyKey = sKey;
            supplyList.replaceChildren(
                ...(members.length === 0
                    ? [el('div', 'fs-list-row fs-dim', '(None)')]
                    : members.map((s) => {
                          const r = el('div', 'fs-list-row fs-supply-row');
                          const n = linkLabel(`${s.name} (${resupplyShipState(s)})`, () => opts.onSelectShip?.(s), FONT.small);
                          const rm = glassButton('Remove', { size: FONT.tiny, className: 'fs-btn fs-remove', onClick: () => withFleet((g) => issueResupplyMembership(galaxy, empire, s, null, pending, done) && refresh()) });
                          r.append(n, rm);
                          return r;
                      })),
            );
        }
        supplyChoices = unassignedResupplyShips(empire).filter((s) => pending.member.value(s, null) === null);
        const cKey = supplyChoices.map((s) => `${s.builtObjectID}|${s.name}`).join('\n');
        if (cKey !== supplyChoiceKey) {
            supplyChoiceKey = cKey;
            supplyCombo.replaceChildren(
                ...[{ value: '', label: supplyChoices.length === 0 ? '(No free resupply ships)' : '(Select a resupply ship)' }, ...supplyChoices.map((s, i) => ({ value: String(i), label: s.name }))].map((o) => {
                    const opt = el('option', '', o.label);
                    opt.value = o.value;
                    return opt;
                }),
            );
        }
        supplyAdd.disabled = supplyChoices.length === 0;
        setText(supplyPoint, t.kind === 'refuel' && t.target !== null ? `Nearest refuel point (incl. deployed resupply ships): ${nameOf(t.target)}` : '');
    }

    function show(sg: ShipGroup | null): void {
        current = sg;
        tacticsKey = '';
        supplyKey = '';
        refresh();
    }

    function pick(sg: ShipGroup, mode: 'homeBase' | 'attackPoint'): void {
        close();
        opts.onPickPoint?.(sg, mode);
    }

    refresh();
    // Worker mode: bring the replica's fleets and empire up to date now (no-op in-thread).
    requestSimRefresh(galaxy, [empire, empire.shipGroups], () => refresh());
    timer = window.setInterval(() => refresh(), 1000);
    return { win, close, show };
}
