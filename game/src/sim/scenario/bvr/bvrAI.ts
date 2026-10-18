// BVR combat, AI part (scenarios/bvr-combat, flag bvrAI). Not a port. AI empires only (never a human, never pirates / the
// independents), so galaxy setup and the player are untouched. No Rnd of its own.
//
// What it does (each piece is a scenario query / handler of the stock AI, answered only with the flag on):
//   - Research (query researchProjectOrder, weapons industry): the next project of the BVR launcher line (372-378) goes first once the
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
import { assignMission } from '../../missions/assign';
import { isAiControlled } from '../../missions/playerOrder';
import { BuiltObjectRole } from '../../data/designSpecifications';

/** The BVR research line (research.txt 375-381) and its root (Missile Weapons). */
// The flag names are literals here, not imports from bvr.ts: the registrations below run when this module loads, which can be
// inside bvr.ts's own import cycle (an imported const would still be uninitialised: 'Cannot access BVR_AI_FLAG before initialization').
const BVR_FLAG = 'bvrCombat';
const BVR_AI_FLAG = 'bvrAI';

export const BVR_PROJECTS: readonly number[] = [372, 373, 374, 375, 376, 377, 378];
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
            if (n.def.industry !== IndustryType.Weapon || n.isResearched || BVR_PROJECTS.includes(n.def.projectId)) continue;
            if (n.def.techLevel < lowest) lowest = n.def.techLevel;
        }
        if (lowest === 99) lowest = 8;
        const root = tree.find((n) => n.def.projectId === MISSILE_ROOT_PROJECT) ?? null;
        for (const id of BVR_PROJECTS) {
            const n = tree.find((x) => x.def.projectId === id) ?? null;
            if (n === null || n.isResearched) continue;
            if (n.def.techLevel > lowest + 1) break;
            const front = root !== null && !root.isResearched ? [MISSILE_ROOT_PROJECT, id] : [id];
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
export function bvrFixLaunchers(empire: Empire, design: Design, maxShipSize: number): Design | null {
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
    if (!changed) return design;
    design.size = design.quickCalculateSize();
    return design.size > maxShipSize ? null : design;
}

/** The chooser for one warship review: the BVR doctrine spec placed by the stock placement (like the Concord AI's chooser). */
export function bvrDesignChooser(galaxy: Galaxy, empire: Empire, spec: DesignSpecification): AIDesignChooser | null {
    if (!isBvrAiEmpire(galaxy, empire) || !WARSHIP_SUB_ROLES.has(spec.subRole)) return null;
    return {
        choose: (place: DesignPlacer, maxShipSize: number) => {
            const s = bvrSpec(galaxy, empire, spec);
            const share = spec.subRole === BuiltObjectSubRole.CapitalShip || spec.subRole === BuiltObjectSubRole.Carrier ? 1 : 0;
            const d = place(s, { spec: s, scaleShare: share, trimOrder: null } as DesignPlacementTweak);
            return d === null ? null : bvrFixLaunchers(empire, d, maxShipSize);
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
