// BVR combat, AI part (scenarios/bvr-combat, flag bvrAI). Not a port. AI empires only (never a human, never pirates / the
// independents), so galaxy setup and the player are untouched. No Rnd of its own.
//
// What it does (each piece is a scenario query / handler of the stock AI, answered only with the flag on):
//   - Research (query researchProjectOrder, weapons industry): the next project of the BVR launcher line (seven projects, found by name) goes first once the
//     empire's weapons research is within one tech level of it, so the AI gets launchers at about the pace of its other weapons.
//   - Ship design (query aiDesignTweak, before Smarter AI's chooser, which it replaces for warships: Smarter AI's one-weapon-type merge
//     and fill passes were built for beams and torpedoes and would trade the guns away): warship templates are rewritten for the BVR
//     doctrine (bvrSpec): missile launchers and torpedo launchers by hull (escorts none and more point defence, frigates two launchers,
//     destroyers up three launchers and a torpedo ...), the stock missile / torpedo counts replaced, beams cut back to make room,
//     point defence and countermeasures raised when enemies field missiles (bvrEnemyMissileThreat), and the stock missile pick
//     replaced by the best BVR launcher (bvrFixLaunchers).
//   - Rearming (aiRearmTick, every third game day): an idle AI fleet (or loose warship) whose magazines are below bvrDryPct goes to the
//     nearest own or allied space port / base with a dock or deployed resupply ship on a Refuel order (stock order; the ship stays docked
//     until it is loaded, cmdDocking.ts); one already beside such a point is held there until full. A fleet in a fight is never pulled out.
//   - Resupply ships (aiResupplyTick, every sixth game day): a major fleet (6 or more ships; a second ship from 14) on a strike or
//     patrol mission gets an idle resupply ship sent to deploy at the nearest star to it, a field rearm point; the ship follows the
//     fleet (undeploys and redeploys) while the fleet stays in the empire's war, and is released when the fleet is gone.
//   - Tactics (kite / rush) and the strength valuation of a half-empty magazine are in bvrTactics.ts.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Design } from '../../design';
import { BuiltObjectSubRole } from '../../builtObjectTypes';
import { ComponentType } from '../../data/components';
import { ComponentCategoryType } from '../../data/policies';
import { DesignSpecificationComponentRuleType, newComponentRuleByType, type DesignSpecification } from '../../data/designSpecifications';
import type { AIDesignChooser, DesignPlacementTweak, DesignPlacer } from '../../designPlacement';
import { IndustryType } from '../../types';
import { isHumanEmpire } from '../../humanEmpires';
import { DiplomaticRelationType } from '../../diplomacy';
import { registerScenarioFramePeriodic, registerScenarioQuery } from '../hooks';
import { bvrAiOn, bvrAmmoSummary, bvrParam, bvrState, isBvrMissile, nearestRearmPoint, sourcesFor } from './bvr';
import type { BuiltObject } from '../../builtObject';
import type { ShipGroup } from '../../fleets/shipGroup';
import { shipGroupAssignMission } from '../../fleets/shipGroup';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../missions/mission';
import { assignMission, initiateUndeploy } from '../../missions/assign';
import { isAiControlled } from '../../missions/playerOrder';
import { BuiltObjectRole } from '../../data/designSpecifications';

/** The BVR research line (research.txt 375-381) and its root (Missile Weapons). */
// The flag names are literals here, not imports from bvr.ts: the registrations below run when this module loads, which can be
// inside bvr.ts's own import cycle (an imported const would still be uninitialised: 'Cannot access BVR_AI_FLAG before initialization').
const BVR_FLAG = 'bvrCombat';
const BVR_AI_FLAG = 'bvrAI';

export const BVR_PROJECT_NAMES: readonly string[] = [
    'Long-Range Missile Launchers',
    'Terminal Seekers',
    'Extended-Range Missile Launchers',
    'Multi-Spectral Seekers',
    'Hypersonic Missile Launchers',
    'Adaptive Seekers',
    'Orbital-Range Missile Launchers',
];
/** The line's nodes in a tech tree, in order (found by name: the project ids are allocated when the game starts). */
export function bvrProjectNodes<T extends { def: { name: string } }>(tree: readonly T[]): T[] {
    const out: T[] = [];
    for (const name of BVR_PROJECT_NAMES) {
        const n = tree.find((x) => x.def.name === name);
        if (n !== undefined) out.push(n);
    }
    return out;
}

const MISSILE_ROOT_PROJECT = 369;

/** An AI empire this package acts for: not a human seat, not a pirate faction, not the independents. */
export function isBvrAiEmpire(galaxy: Galaxy, empire: Empire | null): empire is Empire {
    return empire !== null && bvrAiOn(galaxy) && empire !== galaxy.independentEmpire && empire.pirateEmpireBaseHabitat === null && !isHumanEmpire(galaxy, empire);
}

// ---------------------------------------------------------------------------------------------------------------
// Research
// ---------------------------------------------------------------------------------------------------------------

registerScenarioQuery({
    id: 'bvr.researchOrder',
    query: 'researchProjectOrder',
    flag: BVR_AI_FLAG,
    // After Smarter AI's order (which replaces the race's list).
    order: 20,
    run: (galaxy, value, { empire, industry }) => {
        if (industry !== IndustryType.Weapon || !isBvrAiEmpire(galaxy, empire)) return value;
        const rs = empire.research;
        const tree = rs.techTree;
        if (rs.nextProjects === null) return value;
        // The weapons-industry level the empire is working at: the lowest tech level among its other available projects.
        let lowest = 99;
        for (const n of rs.nextProjects) {
            if (n.def.industry !== IndustryType.Weapon || n.isResearched || BVR_PROJECT_NAMES.includes(n.def.name)) continue;
            if (n.def.techLevel < lowest) lowest = n.def.techLevel;
        }
        if (lowest === 99) lowest = 8;
        const root = tree.find((n) => n.def.projectId === MISSILE_ROOT_PROJECT) ?? null;
        for (const n of bvrProjectNodes(tree)) {
            if (n.isResearched) continue;
            if (n.def.techLevel > lowest + 1) break;
            const front = root !== null && !root.isResearched ? [MISSILE_ROOT_PROJECT, n.def.projectId] : [n.def.projectId];
            return [...front, ...value];
        }
        return value;
    },
});

// ---------------------------------------------------------------------------------------------------------------
// Ship design
// ---------------------------------------------------------------------------------------------------------------

const WARSHIP_SUB_ROLES: ReadonlySet<BuiltObjectSubRole> = new Set([
    BuiltObjectSubRole.Escort,
    BuiltObjectSubRole.Frigate,
    BuiltObjectSubRole.Destroyer,
    BuiltObjectSubRole.Cruiser,
    BuiltObjectSubRole.CapitalShip,
    BuiltObjectSubRole.Carrier,
]);

/** The BVR doctrine by hull: BVR missile launchers, torpedo launchers, and the share of the template's guns kept. */
interface Doctrine {
    missiles: number;
    torpedoes: number;
    gunShare: number;
    pointDefence: number;
    countermeasures: number;
}
const DOCTRINE: Readonly<Partial<Record<BuiltObjectSubRole, Doctrine>>> = {
    // Escorts are the fleet's point-defence screen: guns kept, PD tripled, no launchers.
    [BuiltObjectSubRole.Escort]: { missiles: 0, torpedoes: 0, gunShare: 0.7, pointDefence: 3, countermeasures: 2 },
    [BuiltObjectSubRole.Frigate]: { missiles: 2, torpedoes: 0, gunShare: 0.6, pointDefence: 1, countermeasures: 1 },
    [BuiltObjectSubRole.Destroyer]: { missiles: 3, torpedoes: 1, gunShare: 0.6, pointDefence: 2, countermeasures: 1 },
    [BuiltObjectSubRole.Cruiser]: { missiles: 4, torpedoes: 2, gunShare: 0.6, pointDefence: 3, countermeasures: 2 },
    [BuiltObjectSubRole.CapitalShip]: { missiles: 5, torpedoes: 3, gunShare: 0.6, pointDefence: 4, countermeasures: 2 },
    [BuiltObjectSubRole.Carrier]: { missiles: 2, torpedoes: 0, gunShare: 0.8, pointDefence: 6, countermeasures: 2 },
};

const GUN_TYPES: readonly ComponentType[] = [ComponentType.WeaponBeam, ComponentType.WeaponPhaser, ComponentType.WeaponRailGun];

/** Launchers of hostile ships (empires at war with `empire`, pirates, the independents' warships are ignored) across the galaxy, a threat 0..2. */
export function bvrEnemyMissileThreat(galaxy: Galaxy, empire: Empire): number {
    let launchers = 0;
    for (const e of galaxy.empires) {
        if (e === null || e === empire || e === galaxy.independentEmpire || !e.active) continue;
        const rel = empire.diplomaticRelations.byEmpire(e)?.type;
        if (rel !== DiplomaticRelationType.War) continue;
        for (const d of e.designs) {
            if (d.isObsolete || d.buildCount <= 0) continue;
            for (const c of d.components) if (isBvrMissile(c)) launchers += d.buildCount;
        }
    }
    return launchers >= 24 ? 2 : launchers >= 6 ? 1 : 0;
}

function setRule(rules: DesignSpecification['componentRules'], type: ComponentType, amount: number, ruleType = DesignSpecificationComponentRuleType.MustHave): void {
    const r = rules.find((x) => x.componentType === type);
    if (r === undefined) {
        if (amount > 0) rules.push(newComponentRuleByType(ruleType, type, amount));
        return;
    }
    r.amount = amount;
    r.componentRuleType = amount > 0 ? ruleType : DesignSpecificationComponentRuleType.MustNotHave;
}

/** The warship template rewritten for the BVR doctrine (a copy; the empire's template is never mutated). */
export function bvrSpec(galaxy: Galaxy, empire: Empire, spec: DesignSpecification): DesignSpecification {
    const doctrine = DOCTRINE[spec.subRole];
    if (doctrine === undefined) return spec;
    const threat = bvrEnemyMissileThreat(galaxy, empire);
    const rules = spec.componentRules.map((r) => ({ ...r }));
    // Templates give the guns and the torpedo family either by type or by category (rule.componentType Undefined): the guns are cut to
    // the doctrine's share (never below 2 on a hull that had that many), the torpedo family (torpedoes and stock missiles) is replaced by ours.
    for (const r of rules) {
        if (r.componentRuleType === DesignSpecificationComponentRuleType.MustNotHave || r.amount <= 0) continue;
        const gunRule = GUN_TYPES.includes(r.componentType) || (r.componentType === ComponentType.Undefined && r.componentCategory === ComponentCategoryType.WeaponBeam);
        const torpedoFamily = r.componentType === ComponentType.Undefined && r.componentCategory === ComponentCategoryType.WeaponTorpedo;
        if (gunRule && r.componentRuleType === DesignSpecificationComponentRuleType.MustHave) {
            r.amount = Math.max(Math.min(2, r.amount), Math.ceil(r.amount * doctrine.gunShare));
        } else if (torpedoFamily) {
            r.amount = 0;
            r.componentRuleType = DesignSpecificationComponentRuleType.MustNotHave;
        }
    }
    setRule(rules, ComponentType.WeaponMissile, doctrine.missiles);
    setRule(rules, ComponentType.WeaponTorpedo, doctrine.torpedoes);
    const pd = rules.find((r) => r.componentType === ComponentType.WeaponPointDefense);
    setRule(rules, ComponentType.WeaponPointDefense, Math.max(pd?.amount ?? 0, doctrine.pointDefence) + threat);
    const cm = rules.find((r) => r.componentType === ComponentType.ComputerCountermeasures);
    setRule(rules, ComponentType.ComputerCountermeasures, Math.max(cm?.amount ?? 0, doctrine.countermeasures) + (threat >= 2 ? 1 : 0));
    // A proximity array on every warship: it extends the missile lock range (bvr.ts bvrTracked).
    const prox = rules.find((r) => r.componentType === ComponentType.SensorProximityArray);
    setRule(rules, ComponentType.SensorProximityArray, Math.max(prox?.amount ?? 0, 1));
    return { ...spec, componentRules: rules };
}

/**
 * The stock placement may pick a stock missile for a "missile" rule (the original's quality order, not ours): every WeaponMissile
 * component that is not a BVR launcher is swapped for the empire's best researched BVR launcher, every torpedo for its best torpedo.
 * Returns the design (changed in place) or null when the swap does not fit `maxShipSize`.
 */
export function bvrFixLaunchers(galaxy: Galaxy, empire: Empire, design: Design, maxShipSize: number): Design | null {
    const researched = empire.research.researchedComponents;
    let bestMissile = null as (typeof researched)[number] | null;
    let bestTorpedo = null as (typeof researched)[number] | null;
    let bestTorpedoDamage = -1;
    for (const c of researched) {
        if (isBvrMissile(c) && (bestMissile === null || c.techLevel > bestMissile.techLevel)) bestMissile = c;
        if (c.type === ComponentType.WeaponTorpedo) {
            const dmg = empire.research.resolveImprovedComponentValues(c).value1;
            if (dmg > bestTorpedoDamage) {
                bestTorpedoDamage = dmg;
                bestTorpedo = c;
            }
        }
    }
    let changed = false;
    for (let i = 0; i < design.components.length; i++) {
        const c = design.components[i];
        if (c.type === ComponentType.WeaponMissile && !isBvrMissile(c) && bestMissile !== null) {
            design.components[i] = bestMissile;
            changed = true;
        } else if (c.type === ComponentType.WeaponTorpedo && bestTorpedo !== null && c !== bestTorpedo) {
            design.components[i] = bestTorpedo;
            changed = true;
        }
    }
    if (capLaunchers(galaxy, empire, design)) changed = true;
    if (!changed) return design;
    design.size = design.quickCalculateSize();
    return design.size > maxShipSize ? null : design;
}

/** The most BVR launchers a hull carries (params bvrCap*; the size-up pass of capital ships and carriers would multiply them), and torpedo launchers (60% of that, at least 1 above frigates). */
export function launcherCap(galaxy: Galaxy, subRole: BuiltObjectSubRole): { missiles: number; torpedoes: number } | null {
    let m: number;
    switch (subRole) {
        case BuiltObjectSubRole.Escort: return { missiles: 0, torpedoes: 0 };
        case BuiltObjectSubRole.Frigate: m = bvrParam(galaxy, 'bvrCapFrigate'); return { missiles: m, torpedoes: 0 };
        case BuiltObjectSubRole.Destroyer: m = bvrParam(galaxy, 'bvrCapDestroyer'); break;
        case BuiltObjectSubRole.Cruiser: m = bvrParam(galaxy, 'bvrCapCruiser'); break;
        case BuiltObjectSubRole.CapitalShip: m = bvrParam(galaxy, 'bvrCapCapital'); break;
        case BuiltObjectSubRole.Carrier: m = bvrParam(galaxy, 'bvrCapFrigate'); break;
        default: return null;
    }
    return { missiles: m, torpedoes: Math.max(1, Math.round(m * 0.6)) };
}

/**
 * Takes the launchers and torpedo launchers above the hull's cap out of the design and puts the freed space into armour, point defence and
 * guns (the design's own gun type), in turn, one component at a time while it fits. Returns true when anything changed.
 */
function capLaunchers(galaxy: Galaxy, empire: Empire, design: Design): boolean {
    const cap = launcherCap(galaxy, design.subRole);
    if (cap === null) return false;
    let missiles = 0;
    let torpedoes = 0;
    for (const c of design.components) {
        if (isBvrMissile(c)) missiles++;
        else if (c.type === ComponentType.WeaponTorpedo) torpedoes++;
    }
    let dropM = Math.max(0, missiles - cap.missiles);
    let dropT = Math.max(0, torpedoes - cap.torpedoes);
    if (dropM === 0 && dropT === 0) return false;
    let freed = 0;
    for (let i = design.components.length - 1; i >= 0 && (dropM > 0 || dropT > 0); i--) {
        const c = design.components[i];
        if (dropM > 0 && isBvrMissile(c)) {
            design.components.splice(i, 1);
            dropM--;
            freed += c.size;
        } else if (dropT > 0 && c.type === ComponentType.WeaponTorpedo) {
            design.components.splice(i, 1);
            dropT--;
            freed += c.size;
        }
    }
    const research = empire.research;
    let armor = null as (typeof design.components)[number] | null;
    let pd = null as (typeof design.components)[number] | null;
    for (const c of research.researchedComponents) {
        if (c.type === ComponentType.Armor && (armor === null || research.resolveImprovedComponentValues(c).value1 / c.size > research.resolveImprovedComponentValues(armor).value1 / armor.size)) armor = c;
        if (c.type === ComponentType.WeaponPointDefense && (pd === null || research.resolveImprovedComponentValues(c).value1 > research.resolveImprovedComponentValues(pd).value1)) pd = c;
    }
    const gunCount = new Map<(typeof design.components)[number], number>();
    for (const c of design.components) if (GUN_TYPES.includes(c.type)) gunCount.set(c, (gunCount.get(c) ?? 0) + 1);
    let gun = null as (typeof design.components)[number] | null;
    let best = 0;
    for (const [c, n] of gunCount) if (n > best) { best = n; gun = c; }
    const order = [armor, pd, gun, armor].filter((c): c is NonNullable<typeof c> => c !== null);
    for (let guard = 0; guard < 200 && order.length > 0; guard++) {
        const c = order[guard % order.length];
        if (c.size > freed) {
            const smallest = Math.min(...order.map((x) => x.size));
            if (smallest > freed) break;
            continue;
        }
        design.components.push(c);
        freed -= c.size;
    }
    return true;
}

/** The chooser for one warship review: the BVR doctrine spec placed by the stock placement (like the Concord AI's chooser). */
export function bvrDesignChooser(galaxy: Galaxy, empire: Empire, spec: DesignSpecification): AIDesignChooser | null {
    if (!isBvrAiEmpire(galaxy, empire) || !WARSHIP_SUB_ROLES.has(spec.subRole)) return null;
    return {
        choose: (place: DesignPlacer, maxShipSize: number) => {
            const s = bvrSpec(galaxy, empire, spec);
            const share = spec.subRole === BuiltObjectSubRole.CapitalShip || spec.subRole === BuiltObjectSubRole.Carrier ? 1 : 0;
            const d = place(s, { spec: s, scaleShare: share, trimOrder: null } as DesignPlacementTweak);
            return d === null ? null : bvrFixLaunchers(galaxy, empire, d, maxShipSize);
        },
    };
}

registerScenarioQuery({
    id: 'bvr.design',
    query: 'aiDesignTweak',
    flag: BVR_FLAG,
    // After the Concord's chooser (-10), before Smarter AI's (0), which leaves a chosen value alone.
    order: -5,
    run: (galaxy, value, { empire, spec }) => (value !== null ? value : bvrDesignChooser(galaxy, empire, spec)),
});

// ---------------------------------------------------------------------------------------------------------------
// Rearming
// ---------------------------------------------------------------------------------------------------------------

/** Missions an AI fleet can be pulled off for a rearm trip (it is not fighting, travelling to a fight or on an errand of its own). Built on first use: a module-level Set of enum values would run before the missions module is initialised (import cycle). */
let idleTypes: ReadonlySet<BuiltObjectMissionType> | null = null;

function idleMission(type: BuiltObjectMissionType | null, priority: BuiltObjectMissionPriority | null, ordered: boolean): boolean {
    if (type === null) return true;
    if (ordered) return false;
    idleTypes ??= new Set([BuiltObjectMissionType.Undefined, BuiltObjectMissionType.Hold, BuiltObjectMissionType.MoveAndWait, BuiltObjectMissionType.Patrol, BuiltObjectMissionType.Waypoint]);
    if (idleTypes.has(type)) return priority === null || priority <= BuiltObjectMissionPriority.Normal;
    return false;
}

function rearmTrip(galaxy: Galaxy, ships: readonly BuiltObject[], fleet: ShipGroup | null, lead: BuiltObject, sources: readonly BuiltObject[], dry: number): void {
    let have = 0;
    let cap = 0;
    for (const s of ships) {
        if (s.hasBeenDestroyed) return;
        const a = bvrAmmoSummary(galaxy, s);
        if (a === null) continue;
        have += a.missiles.have + a.torpedoes.have;
        cap += a.missiles.cap + a.torpedoes.cap;
    }
    if (cap <= 0 || have >= cap) return;
    for (const s of ships) if (s.inBattle || (s.attackers !== null && s.attackers.length > 0)) return;
    const m = fleet !== null ? fleet.mission : builtObjectMission(lead.mission);
    if (!idleMission(m === null ? null : m.type, m === null ? null : m.priority, m !== null && m.playerOrdered === true)) return;
    const near = nearestRearmPoint(galaxy, lead, bvrParam(galaxy, 'bvrRearmRange') * 0.6, sources);
    let point: BuiltObject | null = null;
    if (near !== null) {
        point = near.point; // beside a rearm point: dock and wait for the rounds
    } else if (have / cap < dry) {
        let bd = Number.MAX_VALUE;
        for (const src of sources) {
            const dx = src.xpos - lead.xpos;
            const dy = src.ypos - lead.ypos;
            const d = dx * dx + dy * dy;
            if (d < bd) {
                bd = d;
                point = src;
            }
        }
    }
    if (point === null || point === lead) return;
    const ok = fleet !== null
        ? shipGroupAssignMission(galaxy, fleet, BuiltObjectMissionType.Refuel, point, null, BuiltObjectMissionPriority.Unavailable, false)
        : (assignMission(galaxy, lead, BuiltObjectMissionType.Refuel, point, null, BuiltObjectMissionPriority.Unavailable), true);
    if (ok) bvrState(galaxy).aiRearmTrips++;
}

/**
 * Force structure (forceStructure.ts): the escort target is multiplied by 1.15 with BVR combat, plus 0.35 for each step of
 * bvrEnemyMissileThreat (1.0 for anyone but a BVR AI empire): escorts carry the point defence that covers the fleet.
 */
export function bvrEscortFactor(galaxy: Galaxy, empire: Empire): number {
    if (!isBvrAiEmpire(galaxy, empire)) return 1.0;
    return 1.15 + 0.35 * bvrEnemyMissileThreat(galaxy, empire);
}

/** Force structure: the resupply ship target (rearm points in the field) is half as big again with BVR combat. */
export function bvrResupplyShips(galaxy: Galaxy, empire: Empire, stock: number): number {
    if (!isBvrAiEmpire(galaxy, empire) || stock <= 0) return stock;
    return Math.min(30, stock * 1.5);
}

/** Sends idle, short-of-rounds AI fleets and warships to rearm (see the header). */
export function aiRearmTick(galaxy: Galaxy): void {
    const dry = bvrParam(galaxy, 'bvrDryPct') / 100;
    const cache = new Map<Empire, BuiltObject[]>();
    for (const e of galaxy.empires) {
        // AI empires (flag bvrAI) and the automated ships of human empires, which seek a rearm like they seek fuel.
        if (e === null || !e.active || e === galaxy.independentEmpire || e.pirateEmpireBaseHabitat !== null || !(isHumanEmpire(galaxy, e) || bvrAiOn(galaxy))) continue;
        const sources = sourcesFor(galaxy, e, cache);
        if (sources.length === 0) continue;
        const inFleet = new Set<BuiltObject>();
        for (const fg of e.shipGroups as (ShipGroup | null)[]) {
            if (fg == null || fg.leadShip === null || fg.ships.length === 0) continue;
            const ships = (fg.ships as (BuiltObject | null)[]).filter((s): s is BuiltObject => s != null && !s.hasBeenDestroyed);
            for (const s of ships) inFleet.add(s);
            if (!isAiControlled(fg.leadShip)) continue;
            rearmTrip(galaxy, ships, fg, fg.leadShip, sources, dry);
        }
        for (const b of e.builtObjects as (BuiltObject | null)[]) {
            if (b == null || b.hasBeenDestroyed || b.role !== BuiltObjectRole.Military || b.shipGroup !== null || inFleet.has(b) || !(b.topSpeed > 0) || b.builtAt !== null) continue;
            if (!isAiControlled(b)) continue;
            rearmTrip(galaxy, [b], null, b, sources, dry);
        }
    }
}

registerScenarioFramePeriodic({
    id: 'bvr.aiRearm',
    flag: BVR_FLAG,
    periodDays: 3,
    run: (galaxy) => aiRearmTick(galaxy),
});

registerScenarioQuery({
    id: 'bvr.forceEscorts',
    query: 'forceStructureEscorts',
    flag: BVR_AI_FLAG,
    run: (galaxy, value, { empire }) => value * bvrEscortFactor(galaxy, empire),
});

registerScenarioQuery({
    id: 'bvr.forceResupply',
    query: 'forceStructureResupply',
    flag: BVR_AI_FLAG,
    run: (galaxy, value, { empire }) => bvrResupplyShips(galaxy, empire, value),
});

// ---------------------------------------------------------------------------------------------------------------
// Resupply ships with the fleets
// ---------------------------------------------------------------------------------------------------------------

const MAJOR_FLEET_SHIPS = 6;
const SECOND_SUPPLY_FLEET_SHIPS = 14;
/** A deployed resupply ship further than this from the fleet it serves packs up and follows. */
const FOLLOW_RANGE = 9000;

let fieldTypes: ReadonlySet<BuiltObjectMissionType> | null = null;

function onField(fleet: ShipGroup): boolean {
    fieldTypes ??= new Set([BuiltObjectMissionType.Attack, BuiltObjectMissionType.WaitAndAttack, BuiltObjectMissionType.Bombard, BuiltObjectMissionType.WaitAndBombard, BuiltObjectMissionType.Capture, BuiltObjectMissionType.Blockade, BuiltObjectMissionType.Patrol, BuiltObjectMissionType.Raid]);
    return fleet.mission !== null && fieldTypes.has(fleet.mission.type);
}

function launcherFleet(galaxy: Galaxy, ships: readonly BuiltObject[]): boolean {
    for (const s of ships) if (bvrAmmoSummary(galaxy, s) !== null) return true;
    return false;
}

/** Sends the empire's idle resupply ships to deploy with its major launcher fleets and keeps them with them (see the header). */
export function aiResupplyTick(galaxy: Galaxy): void {
    const st = bvrState(galaxy);
    st.escorts ??= new Map();
    const escorts = st.escorts as Map<BuiltObject, ShipGroup>;
    for (const [ship, fleet] of escorts) {
        if (ship.hasBeenDestroyed || !(ship.empire?.shipGroups as (ShipGroup | null)[] | undefined)?.includes(fleet) || fleet.ships.length < MAJOR_FLEET_SHIPS - 2 || fleet.leadShip === null) escorts.delete(ship);
    }
    for (const e of galaxy.empires) {
        if (e === null || !e.active || !isBvrAiEmpire(galaxy, e)) continue;
        const supplies = (e.resupplyShips as BuiltObject[]).filter((r) => r != null && !r.hasBeenDestroyed && r.isFunctional && r.builtAt === null && isAiControlled(r) && r.unbuiltOrDamagedComponentCount === 0);
        if (supplies.length === 0) continue;
        const fleets = (e.shipGroups as (ShipGroup | null)[]).filter((f): f is ShipGroup => f != null && f.leadShip !== null && f.ships.length >= MAJOR_FLEET_SHIPS && onField(f) && isAiControlled(f.leadShip));
        const served = new Map<ShipGroup, number>();
        for (const [r, f] of escorts) if (r.empire === e) served.set(f, (served.get(f) ?? 0) + 1);
        // Escorting ships follow their fleet.
        for (const [r, f] of escorts) {
            if (r.empire !== e || f.leadShip === null) continue;
            const dx = r.xpos - f.leadShip.xpos;
            const dy = r.ypos - f.leadShip.ypos;
            const far = dx * dx + dy * dy > FOLLOW_RANGE * FOLLOW_RANGE;
            const m = builtObjectMission(r.mission);
            if (!far || (m !== null && m.type !== BuiltObjectMissionType.Undefined)) continue;
            if (r.isDeployed) {
                if (r.attackers === null || r.attackers.length === 0) initiateUndeploy(galaxy, r);
            } else if (r.deployProgress === 0) {
                const star = galaxy.fastFindNearestSystem(f.leadShip.xpos, f.leadShip.ypos);
                if (star !== null) assignMission(galaxy, r, BuiltObjectMissionType.Deploy, star, null, BuiltObjectMissionPriority.High);
            }
        }
        // Idle ships go to fleets that have none (a second one for the biggest).
        for (const r of supplies) {
            if (escorts.has(r) || r.isDeployed || r.deployProgress !== 0) continue;
            const m = builtObjectMission(r.mission);
            if (m !== null && m.type !== BuiltObjectMissionType.Undefined) continue;
            let best: ShipGroup | null = null;
            let bd = Number.MAX_VALUE;
            for (const f of fleets) {
                const have = served.get(f) ?? 0;
                if (have >= (f.ships.length >= SECOND_SUPPLY_FLEET_SHIPS ? 2 : 1) || !launcherFleet(galaxy, f.ships as BuiltObject[])) continue;
                const dx = f.leadShip!.xpos - r.xpos;
                const dy = f.leadShip!.ypos - r.ypos;
                const d = dx * dx + dy * dy;
                if (d < bd) {
                    bd = d;
                    best = f;
                }
            }
            if (best === null) continue;
            const star = galaxy.fastFindNearestSystem(best.leadShip!.xpos, best.leadShip!.ypos);
            if (star === null) continue;
            assignMission(galaxy, r, BuiltObjectMissionType.Deploy, star, null, BuiltObjectMissionPriority.High);
            escorts.set(r, best);
            served.set(best, (served.get(best) ?? 0) + 1);
            st.aiResupplyDeploys = (st.aiResupplyDeploys ?? 0) + 1;
        }
    }
}

registerScenarioFramePeriodic({
    id: 'bvr.aiResupply',
    flag: BVR_AI_FLAG,
    periodDays: 6,
    run: (galaxy) => aiResupplyTick(galaxy),
});
