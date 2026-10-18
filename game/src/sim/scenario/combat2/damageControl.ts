// Damage control in battle (scenarios/damage-control, flag damageControl). Not a port.
//
// The original repairs a ship in the field only through its damage control components (BaconBuiltObject.DoRepairs: a component every
// 160 seconds for an average crew, quicker for veteran ones) or at a dock. With the flag on a crew also repairs, while the ship is in
// a battle, one damaged component every dcSecondsPerRepair game seconds (60): a ship tick every 3 seconds adds the elapsed seconds
// times the crew's speed (1 + dcCrewBonusPct for each of Bacon's crew levels above average, + dcVeteranBonusPct for each Veterans rank
// when that change is on, times the captain's repair bonus) to the ship's progress (scenario.state.combat2.dc); each full interval
// repairs one part: engines, reactor and command parts first (which also ends their critical effects, criticals.ts), then the
// rest in order. A ship with more than dcMaxDamagedPct of its components damaged is past saving by its crew; unbuilt components
// are not repaired. No Rnd (the pick is by order).

import type { Galaxy } from '../../galaxy';
import type { BuiltObject } from '../../builtObject';
import { ComponentStatus } from '../../builtObjectComponent';
import { BuiltObjectRole } from '../../data/designSpecifications';
import { captainBonuses } from '../../characters';
import { calculateCrewLevel } from '../../construction/repair';
import { battleStatsDamageRepairedUs, type SpaceBattleStats } from '../../combat/damage';
import { veteranShipRecord, veteransOn } from '../veterans/veterans';
import { critKindOf } from './criticals';
import { c2Param, c2State, damageControlOn, peekC2State } from './common';

/** Crew levels above average (Bacon's career-damage levels). */
const CREW_STEP: Readonly<Record<string, number>> = { experienced: 1, veteran: 2, elite: 3, legendary: 4 };

/** The crew's repair speed (1 = an average crew). */
export function crewRepairSpeed(galaxy: Galaxy, bo: BuiltObject): number {
    let k = 1 + ((CREW_STEP[calculateCrewLevel(bo)] ?? 0) * c2Param(galaxy, 'dcCrewBonusPct')) / 100;
    if (veteransOn(galaxy)) {
        const r = veteranShipRecord(galaxy, bo);
        if (r !== undefined) k += (r.rank * c2Param(galaxy, 'dcVeteranBonusPct')) / 100;
    }
    const cb = captainBonuses(bo);
    return (k * (cb !== null ? cb.repair : 100)) / 100;
}

/** Repairs one damaged component, the critical kinds first. Returns false when nothing was damaged. */
function repairOne(bo: BuiltObject): boolean {
    const items = bo.components.items;
    let pick = -1;
    for (let i = 0; i < items.length; i++) {
        const c = items[i];
        if (c.status !== ComponentStatus.Damaged) continue;
        if (critKindOf(c.type) !== null) {
            pick = i;
            break;
        }
        if (pick < 0) pick = i;
    }
    if (pick < 0) return false;
    items[pick].status = ComponentStatus.Normal;
    return true;
}

/** One 3-second pass for a ship (called from the ship tick with the seconds since the last pass). */
export function damageControlTick(galaxy: Galaxy, bo: BuiltObject, dt: number): void {
    if (!bo.inBattle || bo.role === BuiltObjectRole.Base || bo.empire === null || bo.damagedComponentCount <= 0) {
        peekC2State(galaxy)?.dc.delete(bo);
        return;
    }
    const total = bo.components.count - bo.unbuiltComponentCount;
    if (total <= 0 || (bo.damagedComponentCount * 100) / total > c2Param(galaxy, 'dcMaxDamagedPct')) return;
    const st = c2State(galaxy);
    const interval = Math.max(0.5, c2Param(galaxy, 'dcSecondsPerRepair'));
    let progress = (st.dc.get(bo) ?? 0) + dt * crewRepairSpeed(galaxy, bo);
    let repaired = 0;
    while (progress >= interval && repairOne(bo)) {
        progress -= interval;
        repaired++;
    }
    if (progress >= interval) progress = 0;
    if (repaired > 0) {
        st.stats.dcRepairs += repaired;
        bo.reDefine();
        if (bo.battleStats !== null) battleStatsDamageRepairedUs(bo.battleStats as SpaceBattleStats, repaired);
    }
    if (bo.damagedComponentCount <= 0) st.dc.delete(bo);
    else st.dc.set(bo, progress);
}

export { damageControlOn };
