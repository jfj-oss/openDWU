// Scenario package 19a — the Concord's passive posture (flag rimTraderPassive) and its colony cap on every expansion
// path (flag rimTrader). Not a port: a layer over the faithful AI, written against the ported hook sites.
//
//   Passive posture: the Concord AI's warships (role Military: warships, troop ships, carriers) take missions only inside
//     the systems it has colonised (query `assignMissionAllowed`, BuiltObject.2.cs 7620 AssignMission) — patrol, defend,
//     escort, attack intruders there; no raid / bombard / invade / blockade / capture of anyone who has not provoked it.
//     The treasure fleet's ships (treasureFleet.ts) are exempt: its escorts sail with the convoy. Civilian ships are not
//     escorted (they leave Concord space). A leash (periodic, once per long block) sends home any warship whose current
//     mission the posture would now refuse (a pursuit that left, a mission given before the scenario took over at game
//     start) or that idles outside Concord space.
//   Anger: every aggressive action against the Concord is recorded per empire in `rimAnger` (common.ts RimAggression):
//     declared war on it (event warDeclared, Empire.7.cs 4883 DeclareWar); attacked a Concord ship or base (Galaxy.7.cs
//     2987 NotifyOfAttack → builtObjectAttacked) or destroyed one (builtObjectKilledBy, warDamageInflicted); attacked /
//     bombarded a Concord colony (Galaxy.7.cs 3058 NotifyOfAttack → habitatAttacked); blockaded a Concord colony or base
//     (Galaxy.Blockades, BlockadeList.cs, sampled every 10 days); invaded or destroyed a Concord colony
//     (warDamageInflicted, Galaxy.3.cs 541 InflictWarDamage); sank a treasure ship (the treasureRaidPenalty kill);
//     sabotage / assassination / incited revolution by an agent the Concord caught or detected (intelMissionExposed,
//     Empire.5.cs 5890-5990 — the blamed empire); or rim-trade standing below rimTraderAngerStanding. An action sets the
//     anger to 1; each year of peace takes rimTraderAngerDecay off (no decay while at war with it); at 0 it has calmed.
//   While angered at X the Concord may declare war on X (common.ts scenarioWarBlocked lifts R1; the stock war review
//     decides, its attitude gate relaxed by RIM_ANGER_WAR_RELAX through query `warReviewAttitudeRelax`, Empire.8.cs
//     100/139) and its warships may take missions against X's assets within rimTraderRetaliationRange sectors of its
//     colonised systems.
//   Colony cap (R2 on every path): at the cap the Concord AI's ships take no Colonize mission and unload no troops on a
//     colony not its own (the invasion step, Empire.9.cs 525 AssignFleetUnloadTroops / invasion.ts); cmdTroops.ts
//     cmdColonize founds nothing (the mission is cancelled); and a colony it gains any other way past the cap (a lost
//     colony found, a story event, a conquest already under way) is released to the independents at the next 10-day
//     review (Empire.1.cs TakeOwnershipOfColony, combat/ownership.ts). The stock game has no protectorate absorption
//     (empireAbsorb.ts header): protectorates stay separate empires, and the Concord refuses Protectorate treaties (R7).
// Rnd: the queries and the anger handlers draw none; the leash's recall draws what the ported mission assignment draws
// (only with the passive flag on); the released colony's ownership transfer draws none.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission, isBuiltObject, isHabitat, isShipGroup } from '../../missions/mission';
import { assignMission } from '../../missions/assign';
import { shipGroupAssignMission } from '../../fleets/shipGroup';
import type { ShipGroup } from '../../fleets/shipGroup';
import type { BuiltObject } from '../../builtObject';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../../diplomacy';
import { galaxyBlockades } from '../../fleets/blockades';
import { IntelligenceMissionType } from '../../espionage';
import { takeOwnershipOfColonyFull } from '../../combat/ownership';
import { EmpireMessageType } from '../../messages';
import { galaxyStarDate } from '../../tick/simTime';
import { registerScenarioEvent, registerScenarioPeriodic, registerScenarioQuery, registerScenarioYearly } from '../hooks';
import { scenarioFlag, scenarioState } from '../state';
import { scenarioMessage, scenarioNews, scenarioText } from '../messages';
import { treasureState } from './treasureFleet';
import {
    type RimAggression,
    isRimTraderAI,
    rimAngerState,
    rimAngeredAt,
    rimAngeredAtAnyone,
    rimParam,
    rimTradeState,
    rimTraderColonyCapReached,
    rimTraderEmpire,
    rimTraderStanding,
} from './common';

export const PASSIVE_FLAG = 'rimTraderPassive';
/** Attitude points the stock war review is relaxed by toward an empire the Concord is angered at. */
export const RIM_ANGER_WAR_RELAX = 10;

/** The Concord when the AI runs it with the passive posture on; null otherwise. Pure. */
function passiveConcord(galaxy: Galaxy): Empire | null {
    if (!scenarioFlag(galaxy, 'rimTrader') || !scenarioFlag(galaxy, PASSIVE_FLAG)) return null;
    const r = rimTraderEmpire(galaxy);
    return r !== null && isRimTraderAI(galaxy, r) ? r : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Concord space
// ---------------------------------------------------------------------------------------------------------------

/** The system stars of the Concord's colonies (its "own systems"). Pure. */
export function concordSystemStars(galaxy: Galaxy, r: Empire): Habitat[] {
    const out: Habitat[] = [];
    for (const c of r.colonies) {
        if (c.hasBeenDestroyed) continue;
        const star = galaxy.determineHabitatSystemStar(c);
        if (!out.includes(star)) out.push(star);
    }
    return out;
}

/** Distance from (x, y) to the nearest Concord system star (Infinity with none). Pure. */
export function distanceToConcordSpace(galaxy: Galaxy, r: Empire, x: number, y: number): number {
    let best = Number.POSITIVE_INFINITY;
    for (const s of concordSystemStars(galaxy, r)) best = Math.min(best, galaxy.calculateDistance(x, y, s.xpos, s.ypos));
    return best;
}

/** (x, y) lies inside one of the Concord's colonised systems (MaxSolarSystemSize of its star). Pure. */
export function inConcordSpace(galaxy: Galaxy, r: Empire, x: number, y: number): boolean {
    return distanceToConcordSpace(galaxy, r, x, y) <= galaxy.maxSolarSystemSize;
}

/** (x, y) lies within rimTraderRetaliationRange sectors of the Concord's colonised systems. Pure. */
export function inRetaliationRange(galaxy: Galaxy, r: Empire, x: number, y: number): boolean {
    return distanceToConcordSpace(galaxy, r, x, y) <= galaxy.maxSolarSystemSize + rimParam(galaxy, 'rimTraderRetaliationRange') * galaxy.sectorSize;
}

const COORD_UNSET = -2000000000;

/** Where a mission sends the ship: its target's position (a fleet: the lead ship), else the explicit point. Pure. */
export function missionPoint(target: unknown, x: number, y: number): { x: number; y: number } | null {
    if (isShipGroup(target)) {
        const l = target.leadShip ?? target.ships[0] ?? null;
        if (l !== null) return { x: l.xpos, y: l.ypos };
    } else if (target !== null && typeof target === 'object') {
        const t = target as { xpos?: unknown; ypos?: unknown };
        if (typeof t.xpos === 'number' && typeof t.ypos === 'number') return { x: t.xpos, y: t.ypos };
    }
    if (x > COORD_UNSET && y > COORD_UNSET) return { x, y };
    return null;
}

/** The empire a mission target belongs to (ship / base: its actual empire; colony; fleet), or null. Pure. */
export function missionTargetOwner(target: unknown): Empire | null {
    if (isBuiltObject(target)) return target.actualEmpire;
    if (isHabitat(target)) return target.empire;
    if (isShipGroup(target)) return target.empire;
    return null;
}

/**
 * Hostile mission types: the passive Concord flies them only against an empire that provoked it. Built on first use:
 * this module sits in import cycles (packages.ts ↔ missions), so enum members are not read at module load.
 */
let offensiveTypes: Set<number> | null = null;
const offensive = (): Set<number> => (offensiveTypes ??= new Set<number>([
    BuiltObjectMissionType.Attack,
    BuiltObjectMissionType.WaitAndAttack,
    BuiltObjectMissionType.Bombard,
    BuiltObjectMissionType.WaitAndBombard,
    BuiltObjectMissionType.Capture,
    BuiltObjectMissionType.Raid,
    BuiltObjectMissionType.Blockade,
    BuiltObjectMissionType.UnloadTroops,
]));

function isTreasureShip(galaxy: Galaxy, bo: unknown): boolean {
    return galaxy.scenario !== null && 'rimTreasure' in galaxy.scenario.state && treasureState(galaxy).ships.includes(bo as never);
}

/**
 * assignMissionAllowed query (BuiltObject.2.cs 7620 AssignMission): the colony cap on colony ships and invasions (flag
 * rimTrader) and the passive posture of the Concord's warships (flag rimTraderPassive). Pure. Exported for tests.
 */
export function concordMissionAllowed(galaxy: Galaxy, value: boolean, args: { builtObject: BuiltObject; missionType: number; target: unknown; x: number; y: number }): boolean {
    if (!value) return value;
    const bo = args.builtObject;
    const r = rimTraderEmpire(galaxy);
    if (r === null || bo.actualEmpire !== r || !isRimTraderAI(galaxy, r)) return value;
    const type = args.missionType;
    const target = args.target;
    const owner = missionTargetOwner(target);
    // R2 on every path: no colony founding, no invasion past the cap.
    if (rimTraderColonyCapReached(galaxy, r)) {
        if (type === BuiltObjectMissionType.Colonize) return false;
        if (type === BuiltObjectMissionType.UnloadTroops && isHabitat(target) && target.empire !== r) return false;
    }
    if (!scenarioFlag(galaxy, PASSIVE_FLAG)) return value;
    if (bo.role !== BuiltObjectRole.Military || isTreasureShip(galaxy, bo)) return value;
    // No escorting of civilian ships: freighters, miners and explorers leave Concord space, and the escort would follow.
    if (type === BuiltObjectMissionType.Escort && isBuiltObject(target) && target.role !== BuiltObjectRole.Military && target.role !== BuiltObjectRole.Base) return false;
    const angered = owner !== null && owner !== r && rimAngeredAt(galaxy, owner);
    const p = missionPoint(target, args.x, args.y);
    const home = p === null || inConcordSpace(galaxy, r, p.x, p.y);
    if (offensive().has(type) && owner !== null && owner !== r && !angered) {
        // Defence: attacking a ship (not a base) inside Concord space is allowed; nothing else against the unprovoked.
        const intruder = home && isBuiltObject(target) && target.role !== BuiltObjectRole.Base && (type === BuiltObjectMissionType.Attack || type === BuiltObjectMissionType.WaitAndAttack);
        if (!intruder) return false;
    }
    if (home) return value;
    // Beyond its own systems: only retaliation, within range.
    if (!inRetaliationRange(galaxy, r, p!.x, p!.y)) return false;
    if (owner !== null) return angered;
    // An unowned target (a star, an empty world, a point): only as the approach to an angered empire's colony or base.
    return angeredAssetNear(galaxy, p!.x, p!.y);
}

/** A colony or base of an empire the Concord is angered at lies within MaxSolarSystemSize of (x, y). Pure. */
export function angeredAssetNear(galaxy: Galaxy, x: number, y: number): boolean {
    if (!rimAngeredAtAnyone(galaxy)) return false;
    const range = galaxy.maxSolarSystemSize;
    for (const e of [...galaxy.empires, ...galaxy.pirateEmpires]) {
        if (e === null || !e.active || !rimAngeredAt(galaxy, e)) continue;
        for (const c of e.colonies) if (!c.hasBeenDestroyed && galaxy.calculateDistance(x, y, c.xpos, c.ypos) <= range) return true;
        for (const b of e.builtObjects) if (b !== null && !b.hasBeenDestroyed && b.role === BuiltObjectRole.Base && galaxy.calculateDistance(x, y, b.xpos, b.ypos) <= range) return true;
    }
    return false;
}

/** The Concord colony nearest (x, y) (its capital first on ties), or null. Pure. */
function nearestConcordColony(galaxy: Galaxy, r: Empire, x: number, y: number): Habitat | null {
    let best: Habitat | null = null;
    let bd = Number.POSITIVE_INFINITY;
    for (const c of r.colonies) {
        if (c.hasBeenDestroyed) continue;
        const d = galaxy.calculateDistance(x, y, c.xpos, c.ypos);
        if (d < bd) {
            bd = d;
            best = c;
        }
    }
    return best;
}

/**
 * The leash (every 5 days: once per Galaxy.DoTasks long block): a Concord warship whose current mission the posture
 * would refuse now (its target moved out of Concord space, an escorted freighter left, a mission given before the
 * scenario took over at game start) or that idles outside Concord space is sent home — a Move to the nearest Concord
 * colony, fleet-wide for a fleet (ShipGroup.cs 2097 AssignMission), else for the ship (BuiltObject.2.cs 7620). Ships in
 * transit to an allowed destination are left alone. Draws what the mission assignment draws. Returns ships recalled.
 */
export function rimPassiveLeash(galaxy: Galaxy): number {
    const r = passiveConcord(galaxy);
    if (r === null || r.colonies.length === 0) return 0;
    const fleets: ShipGroup[] = [];
    let n = 0;
    for (const b of [...r.builtObjects]) {
        if (b === null || b.hasBeenDestroyed || b.role !== BuiltObjectRole.Military || isTreasureShip(galaxy, b)) continue;
        const m = builtObjectMission(b.mission);
        const here = inConcordSpace(galaxy, r, b.xpos, b.ypos);
        if (m === null || m.type === BuiltObjectMissionType.Undefined) {
            if (here) continue;
        } else {
            const target = m.targetBuiltObject ?? m.targetHabitat ?? m.targetCreature ?? m.targetShipGroup;
            if (concordMissionAllowed(galaxy, true, { builtObject: b, missionType: m.type, target, x: m.x, y: m.y }) && (here || missionPoint(target, m.x, m.y) !== null)) continue;
        }
        const home = nearestConcordColony(galaxy, r, b.xpos, b.ypos);
        if (home === null) continue;
        const group = b.shipGroup as ShipGroup | null;
        if (group !== null) {
            if (fleets.includes(group)) continue;
            fleets.push(group);
            shipGroupAssignMission(galaxy, group, BuiltObjectMissionType.Move, home, null, BuiltObjectMissionPriority.Normal, false);
            n += group.ships.length;
        } else {
            assignMission(galaxy, b, BuiltObjectMissionType.Move, home, null, BuiltObjectMissionPriority.Normal);
            n++;
        }
    }
    return n;
}

// ---------------------------------------------------------------------------------------------------------------
// Anger
// ---------------------------------------------------------------------------------------------------------------

function isNormalEmpire(galaxy: Galaxy, e: Empire): boolean {
    return e.pirateEmpireBaseHabitat === null && e !== galaxy.independentEmpire;
}

function actionText(galaxy: Galaxy, kind: RimAggression): string {
    switch (kind) {
        case 'declaredWar':
            return scenarioText('Scenario RimTrade Action War');
        case 'attackedShip':
            return scenarioText('Scenario RimTrade Action Attack');
        case 'destroyedShip':
            return scenarioText('Scenario RimTrade Action Destroy');
        case 'attackedColony':
            return scenarioText('Scenario RimTrade Action Colony');
        case 'blockade':
            return scenarioText('Scenario RimTrade Action Blockade');
        case 'invasion':
            return scenarioText('Scenario RimTrade Action Invasion');
        case 'treasureRaid':
            return scenarioText('Scenario RimTrade Action Treasure');
        case 'espionage':
            return scenarioText('Scenario RimTrade Action Espionage');
        case 'lowStanding':
            return scenarioText('Scenario RimTrade Action Standing', String(rimParam(galaxy, 'rimTraderAngerStanding')));
    }
}

/**
 * Records an aggressive action by `offender` against the Concord (passive flag on, AI Concord): anger back to 1, the
 * action counted; a calm → angered change sends the offender a message and NewsNet a report. No Rnd. Exported for tests.
 */
export function recordRimAggression(galaxy: Galaxy, offender: Empire | null, kind: RimAggression): void {
    const r = passiveConcord(galaxy);
    if (r === null || offender === null || offender === r || offender === galaxy.independentEmpire || !offender.active) return;
    const st = rimAngerState(galaxy);
    let e = st.byEmpire[offender.empireId];
    const wasCalm = e === undefined || !(e.anger > 0);
    if (e === undefined) e = st.byEmpire[offender.empireId] = { anger: 0, last: 0, lastAction: kind, counts: {} };
    e.anger = 1;
    e.last = galaxyStarDate(galaxy);
    e.lastAction = kind;
    e.counts[kind] = (e.counts[kind] ?? 0) + 1;
    if (!wasCalm) return;
    st.stats.provoked++;
    if (!isNormalEmpire(galaxy, offender)) return; // pirates: remembered, not announced
    const what = actionText(galaxy, kind);
    const range = String(rimParam(galaxy, 'rimTraderRetaliationRange'));
    scenarioMessage(galaxy, offender, scenarioText('Scenario RimTrade Angered Title'), scenarioText('Scenario RimTrade Angered You', r.name, what, range), { type: EmpireMessageType.GeneralBadEvent, sender: r, subject: r.capital });
    scenarioNews(galaxy, r, scenarioText('Scenario RimTrade Angered', r.name, offender.name, what, range), (x) => x !== offender, r.capital);
}

/** Yearly (order 12): anger decays by rimTraderAngerDecay toward every empire not at war with the Concord. No Rnd. */
export function rimAngerYear(galaxy: Galaxy): void {
    const r = passiveConcord(galaxy);
    if (r === null || galaxy.scenario === null || !('rimAnger' in galaxy.scenario.state)) return;
    const st = rimAngerState(galaxy);
    const decay = rimParam(galaxy, 'rimTraderAngerDecay');
    for (const key of Object.keys(st.byEmpire)) {
        const id = Number(key);
        const e = st.byEmpire[id];
        if (!(e.anger > 0)) continue;
        const other = galaxy.empires.find((x) => x !== null && x.empireId === id) ?? galaxy.pirateEmpires.find((x) => x !== null && x.empireId === id) ?? null;
        if (other !== null && other.active && isNormalEmpire(galaxy, other) && obtainDiplomaticRelation(r, other).type === DiplomaticRelationType.War) continue;
        e.anger = Math.max(0, e.anger - decay);
        if (e.anger > 0) continue;
        st.stats.calmed++;
        if (other === null || !other.active || !isNormalEmpire(galaxy, other)) continue;
        scenarioMessage(galaxy, other, scenarioText('Scenario RimTrade Angered Title'), scenarioText('Scenario RimTrade Calmed You', r.name), { type: EmpireMessageType.GeneralNeutralEvent, sender: r, subject: r.capital });
        scenarioNews(galaxy, r, scenarioText('Scenario RimTrade Calmed', r.name, other.name), (x) => x !== other, r.capital);
    }
}

/** Every 10 days: blockades of Concord colonies / bases and standing below rimTraderAngerStanding. No Rnd. */
export function rimAngerReview(galaxy: Galaxy): void {
    const r = passiveConcord(galaxy);
    if (r === null) return;
    for (const b of galaxyBlockades(galaxy)) {
        if (b.blockadedEmpire === r && b.initiator !== null && b.initiator !== r) recordRimAggression(galaxy, b.initiator, 'blockade');
    }
    const threshold = rimParam(galaxy, 'rimTraderAngerStanding');
    const ledger = rimTradeState(galaxy).ledger;
    for (const key of Object.keys(ledger)) {
        const id = Number(key);
        const other = galaxy.empires.find((x) => x !== null && x.empireId === id) ?? null;
        if (other === null || other === r || !other.active || !isNormalEmpire(galaxy, other)) continue;
        if (rimTraderStanding(galaxy, id) < threshold) recordRimAggression(galaxy, other, 'lowStanding');
    }
}

/** Sabotage-type missions (Empire.5.cs IsSabotageType); built on first use (import cycles, see offensive()). */
let sabotageTypes: Set<number> | null = null;
const sabotage = (): Set<number> => (sabotageTypes ??= new Set<number>([
    IntelligenceMissionType.SabotageConstruction,
    IntelligenceMissionType.SabotageColony,
    IntelligenceMissionType.InciteRevolution,
    IntelligenceMissionType.AssassinateCharacter,
    IntelligenceMissionType.DestroyBase,
]));

registerScenarioEvent({
    id: 'rimTrade.anger.war',
    flag: PASSIVE_FLAG,
    event: 'warDeclared',
    run: (g, p) => {
        if (p.target === rimTraderEmpire(g)) recordRimAggression(g, p.empire, 'declaredWar');
    },
});
registerScenarioEvent({
    id: 'rimTrade.anger.attacked',
    flag: PASSIVE_FLAG,
    event: 'builtObjectAttacked',
    run: (g, p) => {
        const r = rimTraderEmpire(g);
        if (r !== null && p.builtObject.actualEmpire === r) recordRimAggression(g, p.attackingEmpire, 'attackedShip');
    },
});
registerScenarioEvent({
    id: 'rimTrade.anger.killed',
    flag: PASSIVE_FLAG,
    event: 'builtObjectKilledBy',
    run: (g, p) => {
        const r = rimTraderEmpire(g);
        if (r === null || p.builtObject.actualEmpire !== r) return;
        const treasure = 'rimTreasure' in g.scenario!.state && treasureState(g).treasure.includes(p.builtObject);
        recordRimAggression(g, p.destroyer, treasure ? 'treasureRaid' : 'destroyedShip');
    },
});
registerScenarioEvent({
    id: 'rimTrade.anger.colony',
    flag: PASSIVE_FLAG,
    event: 'habitatAttacked',
    run: (g, p) => {
        const r = rimTraderEmpire(g);
        if (r !== null && p.habitat.empire === r) recordRimAggression(g, p.attackingEmpire, 'attackedColony');
    },
});
registerScenarioEvent({
    id: 'rimTrade.anger.damage',
    flag: PASSIVE_FLAG,
    event: 'warDamageInflicted',
    run: (g, p) => {
        if (p.victim !== rimTraderEmpire(g)) return;
        recordRimAggression(g, p.inflictor, p.habitat !== null ? 'invasion' : 'destroyedShip');
    },
});
registerScenarioEvent({
    id: 'rimTrade.anger.intel',
    flag: PASSIVE_FLAG,
    event: 'intelMissionExposed',
    run: (g, p) => {
        if (p.target === rimTraderEmpire(g) && sabotage().has(p.missionType)) recordRimAggression(g, p.blamed, 'espionage');
    },
});
registerScenarioPeriodic({ id: 'rimTrade.anger.review', flag: PASSIVE_FLAG, periodDays: 10, run: (g) => rimAngerReview(g) });
registerScenarioYearly({ id: 'rimTrade.anger.year', flag: PASSIVE_FLAG, order: 12, run: (g) => rimAngerYear(g) });
registerScenarioQuery({
    id: 'rimTrade.anger.warReview',
    flag: PASSIVE_FLAG,
    query: 'warReviewAttitudeRelax',
    run: (g, value, args) => (passiveConcord(g) === args.empire && rimAngeredAt(g, args.other) ? value + RIM_ANGER_WAR_RELAX : value),
});
registerScenarioQuery({ id: 'rimTrade.missions', flag: 'rimTrader', query: 'assignMissionAllowed', run: concordMissionAllowed });
registerScenarioPeriodic({ id: 'rimTrade.passive.leash', flag: PASSIVE_FLAG, periodDays: 5, run: (g) => void rimPassiveLeash(g) });

// ---------------------------------------------------------------------------------------------------------------
// Colony cap backstop
// ---------------------------------------------------------------------------------------------------------------

/** Saved state (`scenarioState(galaxy, 'rimCap')`, created on the first colony gained past the cap). */
export interface RimCapState {
    /** Colonies the Concord gained past its cap, to release. */
    overCap: Habitat[];
    released: number;
}

function rimCapState(galaxy: Galaxy): RimCapState {
    return scenarioState<RimCapState>(galaxy, 'rimCap', () => ({ overCap: [], released: 0 }));
}

/** colonyOwnerChanged: a colony the AI Concord gained past its cap is queued for release. No Rnd. */
export function rimCapColonyGained(galaxy: Galaxy, p: { colony: Habitat; from: Empire | null; to: Empire | null }): void {
    const r = rimTraderEmpire(galaxy);
    if (r === null || p.to !== r || p.from === r || !isRimTraderAI(galaxy, r)) return;
    if (r.colonies.length <= rimParam(galaxy, 'rimTraderMaxColonies')) return;
    const st = rimCapState(galaxy);
    if (!st.overCap.includes(p.colony)) st.overCap.push(p.colony);
}

/** Every 10 days: queued over-cap colonies still the Concord's (never its capital) go to the independents. No Rnd. */
export function rimCapReview(galaxy: Galaxy): void {
    if (galaxy.scenario === null || !('rimCap' in galaxy.scenario.state)) return;
    const st = rimCapState(galaxy);
    const r = rimTraderEmpire(galaxy);
    const ind = galaxy.independentEmpire;
    const queue = st.overCap;
    st.overCap = [];
    if (r === null || ind === null || !isRimTraderAI(galaxy, r)) return;
    for (const c of queue) {
        if (c.hasBeenDestroyed || c.empire !== r || c === r.capital || r.colonies.length <= rimParam(galaxy, 'rimTraderMaxColonies')) continue;
        takeOwnershipOfColonyFull(galaxy, ind, c, ind, false, false);
        st.released++;
    }
}

registerScenarioEvent({ id: 'rimTrade.cap.gained', flag: 'rimTrader', event: 'colonyOwnerChanged', run: rimCapColonyGained });
registerScenarioPeriodic({ id: 'rimTrade.cap.review', flag: 'rimTrader', periodDays: 10, run: (g) => rimCapReview(g) });
