// Fleet Settings panel, the model (an Improvement, ui/improvements.ts 'fleetSettings'; not a window of the original).
// Distant Worlds 2 has a per-fleet behaviour panel. DW:U spreads the same kind of settings over the selection panel's
// fleet buttons (Main.Part3.cs fleetSlots), the Fleets window (Main.Part9.cs method_268), the `,` key and Game Options →
// Empire Settings (Main.Part4.cs method_556). This panel puts them in one window. It adds no mechanics: every control
// issues an existing journaled player op (sim/player/playerOps.ts) that the original's own control issues:
//   posture                shipAction SetFleetPosture      Main.Part7.cs 1274 (toggle Attack / Defend)
//   posture range          shipAction SetFleetRange        Main.Part7.cs 1284 (cycles the five steps)
//   home base              setFleetHomeColony              Main.Part6.cs btnShipGroupInfoSetHomeColony_Click
//                          fleetPoint SetFleetHomeBase      Main.Part10.cs 3063-3125 (map pick; empty space clears)
//   attack point           fleetPoint SetFleetAttackPoint   Main.Part10.cs 3063-3125
//   engagement stance      shipOrderKey cycleEngagementStance  Main.Part7.cs 2053 RrhupiLdOr (the `,` key)
//   default stances, overmatch, gather / refuel portions
//                          setEmpireSetting                 Main.Part4.cs 4271 method_558 (empire-wide)
//   automation             shipAction Automate / UnautomateShip  Main.Part7.cs 1855 method_348
//   troop loadout          setFleetTroopLoadout             Main.Part9.cs uuGypgjgrb + numShipGroupTroopLoadout*
//   load troops            fleetLoadTroops                  Main.Part3.cs XxYlcNpSu4_Click
//   repair and refuel      fleetRepairAndRefuel             Main.Part3.cs btnShipGroupRepairAndRefuel_Click
//   retrofit               fleetRetrofit                    Main.Part3.cs btnShipGroupRetrofit_Click
//   resupply ship in / out setShipsFleet                    Main.Part6.cs cmbBuiltObjectSetFleet_SelectedIndexChanged
//   fleet design order     fleetTemplateCancelOrder         (Fleet Designs tab, player/fleetTemplates.ts)
// Battle tactics, invasion tactics and "flee when" are Design fields in DW:U (Design.cs TacticsStrongerShips /
// TacticsWeakerShips / TacticsInvasion / FleeWhen; read by BuiltObject.1.cs DetermineTacticsAgainstTarget /
// ShouldFleeFrom and BuiltObject.2.cs ShouldInvadeColony through `Design.`), and a design in use cannot be edited
// (Main.Part7.cs 4852-4886 "You cannot edit this design because it is already in use"). So the panel shows them per
// design, read-only, beside Retrofit.
// A setting computed from what the game shows (a toggle, a cycle, a spinner) computes from the value last sent until
// its reply lands (ui/pendingCommands.ts), so quick clicks are not lost in sim-worker mode.
// No DOM / Pixi: the window is fleetSettings.ts.

import type { Galaxy } from '../../sim/galaxy';
import type { Empire } from '../../sim/empire';
import type { BuiltObject } from '../../sim/builtObject';
import type { Habitat } from '../../sim/types';
import type { Design } from '../../sim/design';
import type { StellarObject } from '../../sim/missions/mission';
import { empireShipGroups, type ShipGroup } from '../../sim/fleets/shipGroup';
import { FleetPosture } from '../../sim/diplomacyTick';
import { BuiltObjectSubRole } from '../../sim/builtObjectTypes';
import { BuiltObjectRole } from '../../sim/data/designSpecifications';
import { ShipAction, ShipActionType } from '../../sim/player/shipAction';
import { issuePlayerCommand } from '../../sim/player/playerCommands';
import { nextAttackRangeSquared } from '../../sim/player/shipHotkeys';
import { fastFindNearestRefuellingPoint } from '../../sim/movement';
import { shipGroupCalculateRequiredFuel, shipGroupTotalDamage } from '../../sim/fleets/shipGroupTasks';
import { findNearestShipYard } from '../../sim/construction/empireConstruction';
import { fleetBuildProgress, type FleetBuildOrder, type FleetBuildProgress } from '../../sim/player/fleetTemplates';
import { resolveBattleTacticsDescription, resolveFleeWhenDescription, resolveInvasionTacticsDescription } from '../../sim/player/designEditor';
import { ENGAGEMENT_STANCE_ITEMS, type AttackRangeField, type EmpireSettingField } from '../../sim/player/empireSettings';
import { PendingOnce, PendingValues } from '../pendingCommands';
import { registerImprovement } from '../improvements';

/** The Improvements switch (ui/improvements.ts): off hides the panel's buttons and its Q key. */
export const FLEET_SETTINGS_IMPROVEMENT = registerImprovement({
    id: 'fleetSettings',
    label: 'Fleet Settings panel',
    description: "A fleet's behaviour settings in one window: posture, engagement, retreat, fuel, troops, resupply (Q).",
    default: true,
});

// -------------------------------------------------------------------------------------------------------------------
// Posture range (ShipGroup.PostureRangeSquared)
// -------------------------------------------------------------------------------------------------------------------

/** The five values Main.Part7.cs 1284 SetFleetRange cycles through (2250000 → 2.304E9 → 2.5E11 → 1E12 → float.MaxValue). */
export const FLEET_RANGE_LADDER: readonly number[] = [2250000.0, 2304000000.0, 250000000000.0, 1000000000000.0, 3.4028234663852886e38];

/** The step a PostureRangeSquared is on (the thresholds of SetFleetRange / Galaxy.2.cs ResolveDescriptionFleetPosture). */
export function fleetRangeStep(rangeSquared: number): number {
    if (rangeSquared <= 2250000.0) return 0;
    if (rangeSquared <= 2304000000.0) return 1;
    if (rangeSquared <= 250000000000.0) return 2;
    if (rangeSquared <= 1000000000000.0) return 3;
    return 4;
}

/** Main.Part3.cs 1887-1900 (the Set Range button's "Currently …" text): step 0 is "Target" when attacking, "Home Base"
 *  when defending. */
export function fleetRangeStepLabel(step: number, posture: FleetPosture): string {
    switch (step) {
        case 0: return posture === FleetPosture.Defend ? 'Home Base' : 'Target';
        case 1: return 'System';
        case 2: return 'Nearby Systems';
        case 3: return 'Sector';
        default: return 'Anywhere';
    }
}

/** How many SetFleetRange clicks take a fleet from `rangeSquared` to step `to` (each moves one step on, wrapping). */
export function fleetRangeCycles(rangeSquared: number, to: number): number {
    return (((to - fleetRangeStep(rangeSquared)) % 5) + 5) % 5;
}

// -------------------------------------------------------------------------------------------------------------------
// Engagement stance (ShipGroup.AttackRangeSquared, the `,` key)
// -------------------------------------------------------------------------------------------------------------------

/** The three stances RrhupiLdOr cycles (0 → 2000² → 48000² → 0), with the selection panel's suffix texts. */
export const FLEET_STANCE_LADDER: readonly number[] = [0, 4000000, 2304000000];
export const FLEET_STANCE_LABELS: readonly string[] = ['When attacked', 'Nearby targets', 'System targets'];

/** The stance index of an AttackRangeSquared, or -1 for another value ("Engage detected targets", e.g. the sensor
 *  range ShipGroup.cs 2748 gives a fleet whose empire has no default stance). */
export function fleetStanceIndex(attackRangeSquared: number): number {
    return FLEET_STANCE_LADDER.indexOf(attackRangeSquared);
}

/** Presses of `,` that take `attackRangeSquared` to stance `to` (Main.Part7.cs 2053: any other value goes to 48000²). */
export function fleetStanceCycles(attackRangeSquared: number, to: number): number {
    const want = FLEET_STANCE_LADDER[to];
    let v = attackRangeSquared;
    for (let n = 0; n <= 4; n++) {
        if (v === want) return n;
        v = nextAttackRangeSquared(v);
    }
    return 0;
}

/** The stance after `n` presses of `,` (to show what was sent). */
export function fleetStanceAfter(attackRangeSquared: number, n: number): number {
    let v = attackRangeSquared;
    for (let i = 0; i < n; i++) v = nextAttackRangeSquared(v);
    return v;
}

// -------------------------------------------------------------------------------------------------------------------
// Explanations (one line each; the C# behaviour they come from is in `ref`, shown as the tooltip)
// -------------------------------------------------------------------------------------------------------------------

export interface Explanation {
    text: string;
    ref: string;
}

export const EXPLAIN = {
    postureAttack: {
        text: 'Attacks its attack point when idle and at war with its owner; then seeks war targets.',
        ref: 'ShipGroup.cs 170 CheckSendForAttack (Attack / Bombard the AttackPoint when the fleet is idle, at war with its owner and in fuel range); ShipGroup.cs 1727 CheckRefuelRepairAttack (after an attack: the next war target). A manual Attack fleet is never a response fleet (Empire.3.cs 5182 IdentifyNearestResponseFleet).',
    },
    postureDefend: {
        text: 'Guards its home base: answers threats within range of it, first among response fleets.',
        ref: 'Empire.3.cs 5153 CheckFleetDefenseReponse (a Defend fleet responds to attacks within PostureRange of its GatherPoint); Empire.3.cs 5182 IdentifyNearestResponseFleet (a Defend fleet is chosen first).',
    },
    range: {
        text: 'How far from its home base (Defend) or attack point (Attack) it takes missions.',
        ref: 'Empire.9.cs fleet selection with mustBeWithinPostureRange (distance² to GatherPoint / AttackPoint ≤ PostureRangeSquared); Empire.3.cs 5153 CheckFleetDefenseReponse. Main.Part7.cs 1284 SetFleetRange.',
    },
    homeBase: {
        text: 'Where it returns, refuels and waits when idle; a Defend fleet guards around it.',
        ref: 'ShipGroup.cs 1777-1810 (an idle fleet away from its GatherPoint moves back to it); Empire.3.cs 5153 CheckFleetDefenseReponse. Main.Part6.cs btnShipGroupInfoSetHomeColony_Click, Main.Part10.cs 3063-3125 SetFleetHomeBase.',
    },
    attackPoint: {
        text: 'With Attack posture: the enemy colony or base it attacks when idle and at war.',
        ref: 'ShipGroup.cs 170 CheckSendForAttack (Bombard when CheckBombardEnemyColony, else Attack; needs war with the owner and fuel range 0.1). Main.Part10.cs 3063-3125 SetFleetAttackPoint (empty space clears it).',
    },
    stance: {
        text: 'How far its ships go to engage enemies; a new mission resets it to the default below.',
        ref: 'Main.Part7.cs 2053 RrhupiLdOr (the `,` key: 0 → 2000² → 48000² on the fleet and each ship); ShipGroup.cs 2321 SetAttackRange (each assigned mission sets it from the empire stance, unless that is "No default stance").',
    },
    defaults: {
        text: 'Empire-wide: the stance a fleet takes for each mission type it is given.',
        ref: 'ShipGroup.cs 2321 SetAttackRange: AttackRangePatrol / Escort / Attack / Other, or the *Manual set for a manual fleet or a manually assigned mission (Game Options → Empire Settings, Main.Part4.cs 4271 method_558).',
    },
    tactics: {
        text: 'Set per design: a target over 1.3× a ship\'s firepower gets the "stronger" tactic.',
        ref: 'BuiltObject.1.cs DetermineTacticsAgainstTarget (Design.TacticsStrongerShips when target firepower / own > 1.3, else TacticsWeakerShips; colonies always "weaker"); BuiltObject.2.cs ShouldInvadeColony (Design.TacticsInvasion). A design in use cannot be edited (Main.Part7.cs 4852-4886): copy it as new and retrofit.',
    },
    fleeWhen: {
        text: 'Set per design: when a ship escapes a fight (damaged or out of fuel ones flee too).',
        ref: 'BuiltObject.1.cs 1520 ShouldFleeFrom (Design.FleeWhen; a damaged or fuel-less ship flees unless Never / Armor 50).',
    },
    overmatch: {
        text: 'Empire-wide: strength sent against a target, as a multiple of the target\'s.',
        ref: 'BuiltObject.1.cs 924 EvaluateAdequateAttackers ((int)(target strength × AttackOvermatchFactor) + 1); Main.Part4.cs 4321 method_561.',
    },
    gather: {
        text: 'Empire-wide: gathers first when more than this share is over 48,000 from the lead.',
        ref: 'ShipGroup.cs 2161 CheckNeedGatherBeforeAttack (ships > 48000 from the lead ship / all > FleetAttackGatherPortion and the nearby strength < the target\'s).',
    },
    refuelFirst: {
        text: 'Empire-wide: refuels first when more than this share cannot reach the target.',
        ref: 'ShipGroup.cs 2268 CheckNeedRefuelBeforeAttack (ships out of fuel range / all > FleetAttackRefuelPortion and the rest weaker than the target, or the target is out of range).',
    },
    refuelAuto: {
        text: 'Automated: refuels when its ships run low; damaged ships leave for repair.',
        ref: 'ShipGroup.cs 1670 CheckRefuelRepairAttack (with Fleet Formation automation damaged ships go to repair; CalculateRefuellingPortion margin → AssignFleetRefuelling).',
    },
    refuelManual: {
        text: 'Manual: refuels by itself only when idle and a refuel point is in this system.',
        ref: 'ShipGroup.cs 1595 CheckRefuelManual (idle / patrol / escort / blockade / hold, a ship below Max(0.3, margin) fuel, the nearest point in the lead ship\'s system).',
    },
    refuelPoint: {
        text: 'Repair and Refuel: to the nearest ship yard if damaged, else to this point.',
        ref: 'Main.Part3.cs btnShipGroupRepairAndRefuel_Click (FindNearestShipYard / FastFindNearestRefuellingPoint including deployed resupply ships).',
    },
    automatedOn: {
        text: 'The AI chooses its missions, refuelling, repairs and troop loading.',
        ref: 'ShipGroup.cs 97 DoTasks (CheckRefuelRepairAttack, LoadTroopsIfNecessaryAndPossible when the lead ship IsAutoControlled); Main.Part7.cs 1855 method_348.',
    },
    automatedOff: {
        text: 'It follows only your orders (it still refuels nearby when idle).',
        ref: 'ShipGroup.cs 1595 CheckRefuelManual; Main.Part7.cs 1855 method_348 (IsAutoControlled off on every ship).',
    },
    troops: {
        text: 'Load Troops fills each troop type up to its share of the fleet\'s capacity.',
        ref: 'ShipGroup.cs 2799 GetTroopLoadoutTargetAmounts (off = 255 each: any troops); Main.Part9.cs uuGypgjgrb / numShipGroupTroopLoadout*; Main.Part3.cs XxYlcNpSu4_Click (Load Troops).',
    },
    resupply: {
        text: 'Deployed resupply ships are refuel points; in a fleet one travels with it.',
        ref: 'Galaxy.6.cs 3075 FastFindNearestRefuellingPoint (includeResupplyShips: deployed ones); Empire.9.cs 52 TaskResupplyShips (automated ones deploy near enemy targets); Main.Part6.cs cmbBuiltObjectSetFleet (Military ships, resupply ships included, join a fleet).',
    },
    template: {
        text: 'Not in the original: the Fleets window\'s Fleet Designs tab builds and forms fleets.',
        ref: 'player/fleetTemplates.ts (a documented deviation); a formed fleet is an ordinary fleet.',
    },
} as const satisfies Record<string, Explanation>;

// -------------------------------------------------------------------------------------------------------------------
// Reads
// -------------------------------------------------------------------------------------------------------------------

/** The fleet is automated (Main.Part3.cs fleetSlots: the lead ship's IsAutoControlled). */
export function fleetIsAutomated(sg: ShipGroup): boolean {
    return sg.leadShip?.isAutoControlled === true;
}

/** The player's fleets the panel can show (Empire.ShipGroups, list order). */
export function playerFleets(empire: Empire): ShipGroup[] {
    return empireShipGroups(empire).filter((sg): sg is ShipGroup => sg != null && sg.empire === empire);
}

/** The fleet the panel opens on for a selection: the fleet, or the fleet of a selected own ship. */
export function fleetForSelection(empire: Empire, sel: { shipGroup?: ShipGroup | null; builtObject?: BuiltObject | null } | null): ShipGroup | null {
    if (sel === null) return null;
    const sg = sel.shipGroup ?? ((sel.builtObject?.shipGroup ?? null) as ShipGroup | null);
    return sg !== null && sg.empire === empire && empireShipGroups(empire).includes(sg) ? sg : null;
}

/** One design of the fleet with its tactics (Design fields, read-only here). */
export interface FleetDesignBehaviour {
    design: Design;
    count: number;
    stronger: string;
    weaker: string;
    invasion: string;
    fleeWhen: string;
}

/** The fleet's designs (first-seen order) with their battle / invasion tactics and flee setting. */
export function fleetDesignBehaviours(sg: ShipGroup): FleetDesignBehaviour[] {
    const out: FleetDesignBehaviour[] = [];
    for (const ship of sg.ships) {
        const d = ship?.design ?? null;
        if (d === null) continue;
        const row = out.find((r) => r.design === d);
        if (row !== undefined) {
            row.count++;
            continue;
        }
        out.push({
            design: d,
            count: 1,
            stronger: resolveBattleTacticsDescription(d.tacticsStrongerShips),
            weaker: resolveBattleTacticsDescription(d.tacticsWeakerShips),
            invasion: resolveInvasionTacticsDescription(d.tacticsInvasion),
            fleeWhen: resolveFleeWhenDescription(d.fleeWhen),
        });
    }
    return out;
}

/** The lowest fuel level among the fleet's ships, 0..1 (1 when no ship carries fuel). */
export function fleetLowestFuel(sg: ShipGroup): number {
    let low = 1;
    for (const s of sg.ships) if (s != null && s.fuelCapacity > 0) low = Math.min(low, s.currentFuel / s.fuelCapacity);
    return Math.max(0, low);
}

/** Where Repair and Refuel sends the fleet (fleetOps.ts fleetRepairAndRefuel): a ship yard when damaged, else the
 *  nearest refuelling point including deployed resupply ships. A read (no Rnd), like the selection panel's buttons. */
export function fleetRepairRefuelTarget(galaxy: Galaxy, empire: Empire, sg: ShipGroup): { kind: 'repair' | 'refuel'; target: StellarObject | null } {
    const lead = sg.leadShip;
    if (lead === null) return { kind: 'refuel', target: null };
    if (shipGroupTotalDamage(sg) > 0) return { kind: 'repair', target: findNearestShipYard(galaxy, empire, lead, true, false) };
    const fuel = shipGroupCalculateRequiredFuel(sg);
    return { kind: 'refuel', target: fastFindNearestRefuellingPoint(galaxy, lead.xpos, lead.ypos, fuel, sg.empire, lead, true, null, sg.ships.length) };
}

/** The resupply ships in the fleet. */
export function fleetResupplyShips(sg: ShipGroup): BuiltObject[] {
    return sg.ships.filter((s) => s != null && s.subRole === BuiltObjectSubRole.ResupplyShip);
}

/** The empire's finished resupply ships that are in no fleet (what "Add to fleet" offers). */
export function unassignedResupplyShips(empire: Empire): BuiltObject[] {
    return empire.builtObjects.filter(
        (b) => b != null && b.subRole === BuiltObjectSubRole.ResupplyShip && b.role === BuiltObjectRole.Military && b.shipGroup === null && b.builtAt === null && !b.hasBeenDestroyed,
    );
}

/** "Deployed", "Deploying" / "Undeploying" (DeployProgress running) or "Mobile". */
export function resupplyShipState(b: BuiltObject): string {
    if (b.deployProgress !== 0) return b.isDeployed ? 'Undeploying' : 'Deploying';
    return b.isDeployed ? 'Deployed' : 'Mobile';
}

/** The Fleet Designs build order forming this fleet, if any (read without creating the book on the empire). */
export function fleetBuildOrderOf(empire: Empire, sg: ShipGroup): { order: FleetBuildOrder; progress: FleetBuildProgress } | null {
    const order = empire.fleetDesigns?.orders.find((o) => o.fleet === sg) ?? null;
    return order === null ? null : { order, progress: fleetBuildProgress(empire, order) };
}

/** The empire stance fields this fleet's missions read (ShipGroup.cs 2321: the *Manual set for a manual fleet). */
export function fleetStanceFields(automated: boolean): { label: string; field: AttackRangeField }[] {
    const m = automated ? '' : 'Manual';
    return [
        { label: 'Attack', field: `attackRangeAttack${m}` as AttackRangeField },
        { label: 'Patrol', field: `attackRangePatrol${m}` as AttackRangeField },
        { label: 'Escort', field: `attackRangeEscort${m}` as AttackRangeField },
        { label: 'Other', field: `attackRangeOther${m}` as AttackRangeField },
    ];
}

/** The default-stance combo items (Main.Part3.cs:1100 method_583). */
export const DEFAULT_STANCE_ITEMS = ENGAGEMENT_STANCE_ITEMS;

// -------------------------------------------------------------------------------------------------------------------
// The panel's pending values (pendingCommands.ts) and its commands
// -------------------------------------------------------------------------------------------------------------------

/** What the panel has sent and not yet seen replied, per control. One per open panel. */
export class FleetSettingsPending {
    readonly posture = new PendingValues<ShipGroup, FleetPosture>();
    readonly range = new PendingValues<ShipGroup, number>();
    readonly stance = new PendingValues<ShipGroup, number>();
    readonly automated = new PendingValues<ShipGroup, boolean>();
    readonly home = new PendingValues<ShipGroup, StellarObject | null>();
    readonly attack = new PendingValues<ShipGroup, StellarObject | null>();
    readonly empire = new PendingValues<EmpireSettingField, number>();
    readonly member = new PendingValues<BuiltObject, ShipGroup | null>();
    readonly once = new PendingOnce<string>();

    clear(): void {
        for (const p of [this.posture, this.range, this.stance, this.automated, this.home, this.attack, this.empire, this.member]) p.clear();
        this.once.clear();
    }
}

/** What the panel shows for the fleet: the last value sent while its reply is on the way, else the fleet's. */
export interface FleetSettingsView {
    posture: FleetPosture;
    rangeSquared: number;
    attackRangeSquared: number;
    automated: boolean;
    homeBase: StellarObject | null;
    attackPoint: StellarObject | null;
}

export function fleetSettingsView(sg: ShipGroup, p: FleetSettingsPending): FleetSettingsView {
    return {
        posture: p.posture.value(sg, sg.posture),
        rangeSquared: p.range.value(sg, sg.postureRangeSquared),
        attackRangeSquared: p.stance.value(sg, sg.attackRangeSquared),
        automated: p.automated.value(sg, fleetIsAutomated(sg)),
        homeBase: p.home.value(sg, sg.gatherPoint),
        attackPoint: p.attack.value(sg, sg.attackPoint),
    };
}

/** An empire setting as shown (the last value sent, else the empire's). */
export function displayedEmpireSetting(empire: Empire, field: EmpireSettingField, p: FleetSettingsPending): number {
    return p.empire.value(field, (empire as unknown as Record<string, number>)[field]);
}

/** Issue `n` commands in a row; `done` after the last reply. */
function issueRepeated(n: number, issue: (replied: (() => void) | undefined) => void, done: () => void): void {
    for (let i = 0; i < n; i++) issue(i === n - 1 ? done : undefined);
}

/** The fleet's shipAction (the Fleets window's orders row and the selection panel's fleet buttons issue the same). */
function fleetAction(galaxy: Galaxy, empire: Empire, sg: ShipGroup, type: ShipActionType, replied?: () => void): void {
    issuePlayerCommand(galaxy, empire, 'shipAction', [sg, ShipAction.forAction(type, sg), false], replied);
}

/** Posture button: SetFleetPosture (a toggle) when `posture` is not what the panel shows. False when nothing to send. */
export function issueFleetPosture(galaxy: Galaxy, empire: Empire, sg: ShipGroup, posture: FleetPosture, p: FleetSettingsPending, done?: () => void): boolean {
    if (p.posture.value(sg, sg.posture) === posture) return false;
    const settle = p.posture.send(sg, posture);
    fleetAction(galaxy, empire, sg, ShipActionType.SetFleetPosture, () => {
        settle();
        done?.();
    });
    return true;
}

/** Range step button: as many SetFleetRange cycles as take the shown range to step `step`. */
export function issueFleetRange(galaxy: Galaxy, empire: Empire, sg: ShipGroup, step: number, p: FleetSettingsPending, done?: () => void): boolean {
    const n = fleetRangeCycles(p.range.value(sg, sg.postureRangeSquared), step);
    if (n === 0) return false;
    const settle = p.range.send(sg, FLEET_RANGE_LADDER[step]);
    issueRepeated(n, (r) => fleetAction(galaxy, empire, sg, ShipActionType.SetFleetRange, r), () => {
        settle();
        done?.();
    });
    return true;
}

/** Stance button: as many `,` presses (shipOrderKey cycleEngagementStance) as take the shown stance to `index`. */
export function issueFleetStance(galaxy: Galaxy, empire: Empire, sg: ShipGroup, index: number, p: FleetSettingsPending, done?: () => void): boolean {
    const n = fleetStanceCycles(p.stance.value(sg, sg.attackRangeSquared), index);
    if (n === 0) return false;
    const settle = p.stance.send(sg, FLEET_STANCE_LADDER[index]);
    issueRepeated(n, (r) => issuePlayerCommand(galaxy, empire, 'shipOrderKey', [sg, 'cycleEngagementStance'], r), () => {
        settle();
        done?.();
    });
    return true;
}

/** Automation: AutomateShip / UnautomateShip on the fleet when `on` differs from what the panel shows. */
export function issueFleetAutomated(galaxy: Galaxy, empire: Empire, sg: ShipGroup, on: boolean, p: FleetSettingsPending, done?: () => void): boolean {
    if (p.automated.value(sg, fleetIsAutomated(sg)) === on) return false;
    const settle = p.automated.send(sg, on);
    fleetAction(galaxy, empire, sg, on ? ShipActionType.AutomateShip : ShipActionType.UnautomateShip, () => {
        settle();
        done?.();
    });
    return true;
}

/** Home base from the colony combo (setFleetHomeColony), or cleared (fleetPoint SetFleetHomeBase with no target). */
export function issueFleetHomeBase(galaxy: Galaxy, empire: Empire, sg: ShipGroup, colony: Habitat | null, p: FleetSettingsPending, done?: () => void): boolean {
    if (p.home.value(sg, sg.gatherPoint) === colony) return false;
    const settle = p.home.send(sg, colony);
    const replied = (): void => {
        settle();
        done?.();
    };
    if (colony === null) issuePlayerCommand(galaxy, empire, 'fleetPoint', [sg, 'SetFleetHomeBase', null], replied);
    else issuePlayerCommand(galaxy, empire, 'setFleetHomeColony', [sg, colony], replied);
    return true;
}

/** Clear the attack point (fleetPoint SetFleetAttackPoint with no target: the original's click on empty space). */
export function issueClearAttackPoint(galaxy: Galaxy, empire: Empire, sg: ShipGroup, p: FleetSettingsPending, done?: () => void): boolean {
    if (p.attack.value(sg, sg.attackPoint) === null) return false;
    const settle = p.attack.send(sg, null);
    issuePlayerCommand(galaxy, empire, 'fleetPoint', [sg, 'SetFleetAttackPoint', null], () => {
        settle();
        done?.();
    });
    return true;
}

/** An empire-wide setting (setEmpireSetting), when it differs from what the panel shows. */
export function issueEmpireSetting(galaxy: Galaxy, empire: Empire, field: EmpireSettingField, value: number, p: FleetSettingsPending, done?: () => void): boolean {
    if (displayedEmpireSetting(empire, field, p) === value) return false;
    const settle = p.empire.send(field, value);
    issuePlayerCommand(galaxy, empire, 'setEmpireSetting', [field, value], () => {
        settle();
        done?.();
    });
    return true;
}

/** Put a resupply ship into the fleet, or (fleet null) take it out (setShipsFleet). */
export function issueResupplyMembership(galaxy: Galaxy, empire: Empire, ship: BuiltObject, fleet: ShipGroup | null, p: FleetSettingsPending, done?: () => void): boolean {
    if (p.member.value(ship, ship.shipGroup as ShipGroup | null) === fleet) return false;
    const settle = p.member.send(ship, fleet);
    issuePlayerCommand(galaxy, empire, 'setShipsFleet', [[ship], fleet], () => {
        settle();
        done?.();
    });
    return true;
}

/** One-shot fleet buttons (Load Troops, Repair and Refuel, Retrofit): ignored while the last click waits for its reply. */
export function issueFleetOnce(galaxy: Galaxy, empire: Empire, sg: ShipGroup, op: 'fleetLoadTroops' | 'fleetRepairAndRefuel' | 'fleetRetrofit', p: FleetSettingsPending, done?: () => void): boolean {
    const end = p.once.start(`${op}:${fleetKey(sg)}`);
    if (end === null) return false;
    issuePlayerCommand(galaxy, empire, op, [sg], () => {
        end();
        done?.();
    }, end);
    return true;
}

/** Cancel the fleet's Fleet Designs build order (fleetTemplateCancelOrder), once. */
export function issueCancelBuildOrder(galaxy: Galaxy, empire: Empire, orderId: number, p: FleetSettingsPending, done?: () => void): boolean {
    const end = p.once.start(`cancelOrder:${orderId}`);
    if (end === null) return false;
    issuePlayerCommand(galaxy, empire, 'fleetTemplateCancelOrder', [orderId], () => {
        end();
        done?.();
    }, end);
    return true;
}

let fleetKeys = new WeakMap<ShipGroup, number>();
let nextFleetKey = 1;
function fleetKey(sg: ShipGroup): number {
    let k = fleetKeys.get(sg);
    if (k === undefined) {
        k = nextFleetKey++;
        fleetKeys.set(sg, k);
    }
    return k;
}
/** Tests: forget the one-shot keys. */
export function resetFleetKeys(): void {
    fleetKeys = new WeakMap();
    nextFleetKey = 1;
}
