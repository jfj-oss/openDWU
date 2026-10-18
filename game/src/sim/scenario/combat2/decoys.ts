// Decoys and chaff (scenarios/decoys-chaff, flag decoys). Not a port.
//
// The original lets a ship's countermeasures (ECM) component spoil every seeking shot a little (weapons.ts determineHitTarget:
// the hit roll is lowered by the target's countermeasures), and Bacon's point defence shoots missiles down. With the flag on a
// ship with a working ECM component also carries decoy charges (decoyCharges, one more for each further ECM component, up
// to two more). When a missile or torpedo (the BVR launchers' and the stock ones: weapon types missile, super missile, torpedo,
// super torpedo) is in flight at it within decoyRange, it launches a decoy (at most one every decoyCooldownSeconds): every such
// round that was going to hit has decoyChancePct to be pulled off (torpedoes at decoyTorpedoPct of that): it is turned from a hit
// into a miss and veers off. The charges spent are kept per ship (scenario.state.combat2.decoys, only ships that have spent one:
// a ship without an entry is full, so new ships and older saves start full), reloaded for a small price at the same
// rearm points as BVR magazines (own and allied space ports and bases with a dock, deployed resupply ships), decoyRestockSeconds
// a decoy, paid by the ship's owner. The scan runs on a time slice of the ship's id (a fifth of the frames), never every frame.
// Rnd: one draw per inbound round of a launch, plus one for the side it veers to (galaxy.rnd). AI (flag decoysAI): see decoysAI.ts.

import type { Galaxy } from '../../galaxy';
import type { BuiltObject } from '../../builtObject';
import type { Weapon } from '../../weapon';
import type { Empire } from '../../empire';
import { isBuiltObject } from '../../missions/mission';
import { ComponentType } from '../../data/components';
import { ComponentStatus } from '../../builtObjectComponent';
import { galaxyComponentCurrentPrices } from '../../design';
import { baconSettings } from '../../data/baconSettings';
import { registerScenarioFramePeriodic } from '../hooks';
import { nearestRearmPoint, sourcesFor } from '../bvr/bvr';
import { c2Param, c2State, decoysOn, peekC2State, type DecoyPool } from './common';

/** Restock range around a port, base or resupply ship (the same as a BVR rearm, bvr.ts bvrRearmRange). */
const RESTOCK_RANGE = 1500;

/** Seeking rounds: what a decoy can pull off. */
function isSeeking(type: ComponentType): boolean {
    return type === ComponentType.WeaponMissile || type === ComponentType.WeaponSuperMissile || type === ComponentType.WeaponTorpedo || type === ComponentType.WeaponSuperTorpedo;
}

/** Working countermeasures components of the ship (a damaged one launches nothing). */
export function ecmCount(bo: BuiltObject): number {
    let n = 0;
    const items = bo.components.items;
    for (let i = 0; i < items.length; i++) {
        const c = items[i];
        if (c.type === ComponentType.ComputerCountermeasures && c.status === ComponentStatus.Normal) n++;
    }
    return n;
}

/** Decoy charges a full ship carries (0 without a working ECM component). */
export function decoyCapacity(galaxy: Galaxy, bo: BuiltObject): number {
    const n = ecmCount(bo);
    return n <= 0 ? 0 : c2Param(galaxy, 'decoyCharges') + Math.min(2, n - 1);
}

/** Charges the ship holds now. */
export function decoysLeft(galaxy: Galaxy, bo: BuiltObject): number {
    const cap = decoyCapacity(galaxy, bo);
    if (cap <= 0) return 0;
    const pool = peekC2State(galaxy)?.decoys.get(bo);
    return Math.max(0, cap - (pool === undefined ? 0 : pool.spent));
}

/** "Decoys 2/3" for the ship panel, or null (no ECM, or the flag is off). */
export function decoyText(galaxy: Galaxy, bo: BuiltObject): string | null {
    if (!decoysOn(galaxy)) return null;
    const cap = decoyCapacity(galaxy, bo);
    if (cap <= 0) return null;
    return `Decoys ${decoysLeft(galaxy, bo)}/${cap}`;
}

/**
 * Called from weapons.ts interceptMissiles (every frame for every ship of an empire, flag-gated): a ship under missile attack
 * launches a decoy when a round that will hit is within decoyRange. Cheap exits first (no attackers, no ECM, not this ship's time slice).
 */
export function decoyDefend(galaxy: Galaxy, ship: BuiltObject): void {
    const attackers = ship.attackers;
    if (attackers === null || attackers.length === 0 || ship.empire === null) return;
    if ((((galaxy.nowMs / 100) | 0) + ship.builtObjectID) % 5 !== 0) return;
    const cap = decoyCapacity(galaxy, ship);
    if (cap <= 0) return;
    const peek = peekC2State(galaxy)?.decoys.get(ship);
    if (peek !== undefined && (peek.spent >= cap || galaxy.nowMs < peek.nextMs)) return;
    const range = c2Param(galaxy, 'decoyRange');
    const r2 = range * range;
    const inbound: Weapon[] = [];
    for (let a = 0; a < attackers.length; a++) {
        const attacker = attackers[a];
        if (attacker == null || !isBuiltObject(attacker) || attacker.weapons == null) continue;
        for (let i = 0; i < attacker.weapons.length; i++) {
            const w = attacker.weapons[i];
            if (w == null || w.target !== ship || !w.willHitTarget || w.hasMissed || !(w.distanceTravelled > 1) || !isSeeking(w.component.type)) continue;
            const dx = w.x - ship.xpos;
            const dy = w.y - ship.ypos;
            if (dx * dx + dy * dy <= r2) inbound.push(w);
        }
    }
    if (inbound.length === 0) return;
    const st = c2State(galaxy);
    let pool = st.decoys.get(ship);
    if (pool === undefined) {
        pool = { spent: 0, nextMs: 0, progress: 0 };
        st.decoys.set(ship, pool);
    }
    pool.spent++;
    pool.nextMs = galaxy.nowMs + c2Param(galaxy, 'decoyCooldownSeconds') * 1000;
    pool.progress = 0;
    st.stats.decoysLaunched++;
    const chance = c2Param(galaxy, 'decoyChancePct') / 100;
    const torpedoChance = (chance * c2Param(galaxy, 'decoyTorpedoPct')) / 100;
    for (const w of inbound) {
        const t = w.component.type;
        const c = t === ComponentType.WeaponTorpedo || t === ComponentType.WeaponSuperTorpedo ? torpedoChance : chance;
        if (!(galaxy.rnd.nextDouble() < c)) continue;
        // Pulled off target: it turns from a hit into a miss and veers away from the ship.
        w.willHitTarget = false;
        let miss = 0.25 + galaxy.rnd.nextDouble() * 0.15;
        if (galaxy.rnd.next(0, 2) === 0) miss *= -1;
        w.headingMissFactor = Math.fround(miss);
        st.stats.decoysDiverted++;
    }
}

/** Reloads the decoys of ships beside a rearm point (frame-periodic, every other game day). */
export function decoyRestockTick(galaxy: Galaxy): void {
    const st = peekC2State(galaxy);
    if (st === undefined) return;
    const now = galaxy.nowMs;
    const dt = st.decoyTickMs !== undefined && st.decoyTickMs > 0 ? Math.min(60, (now - st.decoyTickMs) / 1000) : 0;
    st.decoyTickMs = now;
    if (st.decoys.size === 0) return;
    const secEach = c2Param(galaxy, 'decoyRestockSeconds');
    const costPct = c2Param(galaxy, 'decoyCostPct');
    const prices = galaxyComponentCurrentPrices(galaxy);
    const cache = new Map<Empire, BuiltObject[]>();
    for (const [bo, pool] of st.decoys) {
        if (bo.hasBeenDestroyed || bo.empire === null) {
            st.decoys.delete(bo);
            continue;
        }
        if (pool.spent <= 0) {
            st.decoys.delete(bo);
            continue;
        }
        // A ship in a fight, or one that just launched, is not reloaded.
        if (now < pool.nextMs) continue;
        const src = nearestRearmPoint(galaxy, bo, RESTOCK_RANGE, sourcesFor(galaxy, bo.empire, cache));
        if (src === null) {
            pool.progress = 0;
            continue;
        }
        pool.progress += dt * src.factor;
        const ecm = bo.components.items.find((c) => c.type === ComponentType.ComputerCountermeasures && c.status === ComponentStatus.Normal);
        const markup = bo.empire.pirateEmpireBaseHabitat !== null ? baconSettings.shipMarkupFactorPirates : baconSettings.shipMarkupFactor;
        const cost = ecm === undefined ? 0 : ((prices[ecm.componentId] ?? 0) * markup * costPct) / 100;
        while (pool.spent > 0 && (secEach <= 0 || pool.progress >= secEach)) {
            pool.spent--;
            const payer = bo.owner ?? bo.empire;
            if (cost > 0 && payer !== null) payer.stateMoney -= cost;
            const owner = src.point.owner ?? src.point.empire;
            if (cost > 0 && owner !== null && payer !== null && owner !== payer) owner.stateMoney += cost;
            st.stats.decoysRestocked++;
            st.stats.decoysRestockCost += cost;
            if (secEach > 0) pool.progress -= secEach;
        }
        if (pool.spent <= 0) st.decoys.delete(bo);
    }
}

registerScenarioFramePeriodic({
    id: 'decoys.restock',
    flag: 'decoys',
    periodDays: 2,
    run: (galaxy) => decoyRestockTick(galaxy),
});

export type { DecoyPool };
