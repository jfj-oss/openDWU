// Critical hits (scenarios/critical-hits, flag criticalHits). Not a port.
//
// In the original a hit that gets past the armour damages components at random and a damaged engine, reactor or command part
// just stops working (BuiltObject.ReDefine drops its contribution). With the flag on, the first time a hit damages an engine
// (main thrust or vectoring), a reactor or a command part (command centre, targeting computer) of a ship it has critChancePct to be
// critical (one galaxy.rnd draw), which stacks (up to critMaxStack of each kind) a lasting effect on the ship:
//   - engines: top and cruise speed are cut by critEngineSlowPct a stack (never below 15% of the base): applied at the end of
//     BuiltObject.reDefine (builtObject.ts reDefineHooks) and re-applied every 3 seconds, so a slowed-zone reset cannot undo it;
//   - reactor: every weapon's time between shots is longer by critReactorSlowPct a stack (weapons.ts fireInterval);
//   - command: a fraction critCommandMissPct a stack of the ship's hits turn into misses (hits.ts c2AdjustHit; one draw per hit).
// The effects last while a damaged part of that kind is still damaged: when the engines (reactor, command parts) are repaired, by the
// crew (damageControl.ts), a damage control component or a dock, reDefine clears it. State: scenario.state.combat2.crits.
// AI (no flag of its own): a ship carrying critical effects weighs a losing fight more heavily (critWithdrawFactor, threats.ts
// checkBattleOverwhelming: crippled ships withdraw sooner) and is marked for repair (repairForNextMission).

import type { Galaxy } from '../../galaxy';
import type { BuiltObject } from '../../builtObject';
import { reDefineHooks } from '../../reDefineHooks';
import type { BuiltObjectComponent } from '../../builtObjectComponent';
import { ComponentStatus } from '../../builtObjectComponent';
import { ComponentType } from '../../data/components';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { c2Param, c2State, criticalsOn, peekC2State, type CritRec } from './common';

export type CritKind = 'engine' | 'reactor' | 'command';

/** Which critical kind a component belongs to (null: none). */
export function critKindOf(type: ComponentType): CritKind | null {
    switch (type) {
        case ComponentType.EngineMainThrust:
        case ComponentType.EngineVectoring:
            return 'engine';
        case ComponentType.Reactor:
            return 'reactor';
        case ComponentType.ComputerCommandCenter:
        case ComponentType.ComputerTargetting:
        case ComponentType.ComputerTargettingFleet:
            return 'command';
        default:
            return null;
    }
}

/** damage.ts hook: a component of `ship` has just gone from working to damaged. May draw one galaxy.rnd number. */
export function critComponentDamaged(galaxy: Galaxy, ship: BuiltObject, comp: BuiltObjectComponent): void {
    if (ship.role === BuiltObjectRole.Base || !criticalsOn(galaxy)) return;
    const kind = critKindOf(comp.type);
    if (kind === null) return;
    if (!(galaxy.rnd.nextDouble() < c2Param(galaxy, 'critChancePct') / 100)) return;
    const st = c2State(galaxy);
    let rec = st.crits.get(ship);
    if (rec === undefined) {
        rec = { engine: 0, reactor: 0, command: 0 };
        st.crits.set(ship, rec);
    }
    const max = Math.max(1, Math.trunc(c2Param(galaxy, 'critMaxStack')));
    rec[kind] = Math.min(max, rec[kind] + 1);
    if (kind === 'engine') st.stats.critEngine++;
    else if (kind === 'reactor') st.stats.critReactor++;
    else st.stats.critCommand++;
    ship.repairForNextMission = true;
}

/** The ship's critical record (undefined: none). */
export function critRecordOf(galaxy: Galaxy, ship: BuiltObject): CritRec | undefined {
    return peekC2State(galaxy)?.crits.get(ship);
}

/** Total stacks of critical effects on the ship. */
export function critTotal(galaxy: Galaxy, ship: BuiltObject): number {
    const r = critRecordOf(galaxy, ship);
    return r === undefined ? 0 : r.engine + r.reactor + r.command;
}

/** True when at least one component of the kind is damaged. */
function kindDamaged(ship: BuiltObject, kind: CritKind): boolean {
    const items = ship.components.items;
    for (let i = 0; i < items.length; i++) {
        const c = items[i];
        if (c.status === ComponentStatus.Damaged && critKindOf(c.type) === kind) return true;
    }
    return false;
}

/** Speed fraction left by the engine stacks (1 = none). */
export function critSpeedFactor(galaxy: Galaxy, rec: CritRec): number {
    return rec.engine <= 0 ? 1 : Math.max(0.15, 1 - (rec.engine * c2Param(galaxy, 'critEngineSlowPct')) / 100);
}

/** Cuts the ship's speeds to its critical engine limit (idempotent: a cap on the base speeds). */
export function critApplySpeed(galaxy: Galaxy, ship: BuiltObject, rec: CritRec): void {
    if (rec.engine <= 0) return;
    const k = critSpeedFactor(galaxy, rec);
    const top = Math.trunc(ship.topSpeedBase * k);
    const cruise = Math.trunc(ship.cruiseSpeedBase * k);
    if (ship.topSpeed > top) ship.topSpeed = top;
    if (ship.cruiseSpeed > cruise) ship.cruiseSpeed = Math.min(cruise, ship.topSpeed);
    if (ship.targetSpeed > ship.topSpeed) ship.targetSpeed = ship.topSpeed;
    if (ship.preferredSpeed > ship.topSpeed) ship.preferredSpeed = ship.topSpeed;
    if (ship.accelerationRate > ship.topSpeed && ship.topSpeed > 0) ship.accelerationRate = Math.max(1, ship.topSpeed);
}

/**
 * End of BuiltObject.reDefine (installed in reDefineHooks): clears the effects whose damaged parts are repaired and applies the engine
 * limit. Only ships with a record cost anything.
 */
export function critReDefine(ship: BuiltObject): void {
    const g = ship._galaxy;
    if (!criticalsOn(g)) return;
    const st = peekC2State(g);
    if (st === undefined || st.crits.size === 0) return;
    const rec = st.crits.get(ship);
    if (rec === undefined) return;
    if (rec.engine > 0 && !kindDamaged(ship, 'engine')) rec.engine = 0;
    if (rec.reactor > 0 && !kindDamaged(ship, 'reactor')) rec.reactor = 0;
    if (rec.command > 0 && !kindDamaged(ship, 'command')) rec.command = 0;
    if (rec.engine + rec.reactor + rec.command === 0) {
        st.crits.delete(ship);
        return;
    }
    critApplySpeed(g, ship, rec);
}

reDefineHooks.after = critReDefine;

/** Time-between-shots factor of the ship (1 = none): weapons.ts multiplies the fire rate by it. */
export function critFireFactor(galaxy: Galaxy, ship: BuiltObject): number {
    const st = peekC2State(galaxy);
    if (st === undefined || st.crits.size === 0) return 1;
    const rec = st.crits.get(ship);
    if (rec === undefined || rec.reactor <= 0) return 1;
    return 1 + (rec.reactor * c2Param(galaxy, 'critReactorSlowPct')) / 100;
}

/** Chance (0..1) that a hit of the ship turns into a miss (0 = none). */
export function critMissChance(galaxy: Galaxy, ship: BuiltObject): number {
    const st = peekC2State(galaxy);
    if (st === undefined || st.crits.size === 0) return 0;
    const rec = st.crits.get(ship);
    if (rec === undefined || rec.command <= 0) return 0;
    return Math.min(0.9, (rec.command * c2Param(galaxy, 'critCommandMissPct')) / 100);
}

/** AI: the factor a ship's critical effects put on how heavily it weighs a losing fight (1 = none; at most 1.6). */
export function critWithdrawFactor(galaxy: Galaxy, ship: BuiltObject): number {
    if (!criticalsOn(galaxy)) return 1;
    const n = critTotal(galaxy, ship);
    return n <= 0 ? 1 : Math.min(1.6, 1 + (n * c2Param(galaxy, 'critAiCautionPct')) / 100);
}

/** "engines, reactor" for the ship panel (null: no critical effect). */
export function critText(galaxy: Galaxy, ship: BuiltObject): string | null {
    if (!criticalsOn(galaxy)) return null;
    const rec = critRecordOf(galaxy, ship);
    if (rec === undefined) return null;
    const parts: string[] = [];
    const add = (name: string, n: number): void => {
        if (n > 0) parts.push(n > 1 ? `${name} x${n}` : name);
    };
    add('engines', rec.engine);
    add('reactor', rec.reactor);
    add('command', rec.command);
    return parts.length === 0 ? null : parts.join(', ');
}
