// Giantworks: blockades strangle the Great Work (with Blockades that bite on, scenarios/blockades-bite). Not a port.
//   - A founding world or a wonder's extra supplier (the Beacon's corrupted worlds) that is BLOCKADED sends no convoys;
//   - every founding world the empires CONTROL (blockaded by an empire, or owned by one) cuts the work's build speed by
//     giantworksBlockadeCutPct (20%), at most giantworksBlockadeMaxCutPct (60%): all three founders controlled, it builds at 40%
//     from what the remaining suppliers send (the per-freighter progress is scaled so the speed is the cut, not the loss of convoys);
//   - a colony of an empire is blockaded by Blockades that bite's own rule (the orbit held by an empire at war with it or by the
//     initiator of a declared blockade); an INDEPENDENT supplier world (which that rule ignores) is blockaded while a declared
//     blockade of it (a Blockade mission, allowed against these worlds without a war) has its initiator holding the orbit
//     (the orbital superiority measure against the world's own armed ships), for blockadeConfirmDays checks in a row.
// This file holds the pure helpers the build step reads (lifecycle.ts, knowledge.ts, beacon.ts); the daily tracker, the
// messages, the anger and the queries are blockadeDaily.ts. Rnd: none.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { Habitat } from '../../../types';
import { blockadeFor } from '../../../fleets/blockades';
import { getEmpireById } from '../../../logistics/contracts';
import { ORBIT_RANGE, classifyOrbit, firepowerByEmpireNear, orbitalRatio } from '../../orbital/orbitalSuperiority';
import { blockadesBiteOn, biteState, findBlockade } from '../../blockades/blockadesBite';
import { greatWorkKind } from './registry';
import { gwParam, peekGwState, type GreatWorkRecord } from './state';

/** A blockaded supplier world in the tracker (key: habitat index). */
export interface GwBlockadeRecord {
    /** Empire id of the holder, star date it began. */
    by: number;
    since: number;
}

/** True when the Giantworks blockade rules apply (Blockades that bite is on). Pure. */
export function gwBlockadesOn(galaxy: Galaxy): boolean {
    return galaxy.scenario !== null && blockadesBiteOn(galaxy);
}

/** An alive, populated world (a supplier that can still send anything). Pure. */
export function worldAlive(h: Habitat): boolean {
    return !h.hasBeenDestroyed && h.population !== null && h.population !== undefined && h.population.totalAmount > 0;
}

/**
 * The empire holding the orbit of `h` under a declared blockade of an independent world: the initiator of the Blockade of `h`
 * when its armed strength within ORBIT_RANGE beats the world's own by the orbital ratio. Pure.
 */
export function independentHolder(galaxy: Galaxy, h: Habitat): Empire | null {
    if (h.empire !== galaxy.independentEmpire || !h.isBlockaded) return null;
    const init = blockadeFor(galaxy, h)?.initiator ?? null;
    if (init === null || init === galaxy.independentEmpire || init.pirateEmpireBaseHabitat !== null || !init.active) return null;
    const fp = firepowerByEmpireNear(galaxy, h.xpos, h.ypos, ORBIT_RANGE);
    const a = fp.get(init) ?? 0;
    const d = galaxy.independentEmpire === null ? 0 : (fp.get(galaxy.independentEmpire) ?? 0);
    return a > 0 && classifyOrbit(d, a, orbitalRatio(galaxy)) === 'attacker' ? init : null;
}

/** The empire that blockades `h` right now by the rules (not the tracker): Blockades that bite's record for an empire's colony, a held declared blockade for an independent one. Pure. */
export function currentHolder(galaxy: Galaxy, h: Habitat): Empire | null {
    if (h.empire === null) return null;
    if (h.empire === galaxy.independentEmpire) return independentHolder(galaxy, h);
    const rec = findBlockade(biteState(galaxy), h);
    return rec !== null && h.empire.empireId === rec.owner ? getEmpireById(galaxy, rec.by) : null;
}

/** The empire that blockades supplier world `h` (the tracker: confirmed, the rules on), or null. Pure. */
export function blockaderOf(galaxy: Galaxy, h: Habitat): Empire | null {
    if (!gwBlockadesOn(galaxy)) return null;
    const rec = peekGwState(galaxy)?.blockaded?.[String(h.habitatIndex)];
    if (rec === undefined) return null;
    const e = getEmpireById(galaxy, rec.by);
    return e !== null && e.active && worldAlive(h) ? e : null;
}

/** The worlds that send convoys to `work` or could: its founders (the Gathering's list once it began) and the wonder's extra suppliers. Pure. */
export function supplierWorlds(galaxy: Galaxy, work: GreatWorkRecord): Habitat[] {
    const out: Habitat[] = [];
    for (const h of [...(work.suppliers.length > 0 ? work.suppliers : work.founders), ...(greatWorkKind(work.wonder)?.extraSuppliers?.(galaxy, work) ?? [])]) if (!out.includes(h)) out.push(h);
    return out;
}

/** Founding worlds the empires control: blockaded by an empire, or owned by one (alive ones only; a destroyed world is a plain loss). Pure. */
export function controlledFounders(galaxy: Galaxy, work: GreatWorkRecord): Habitat[] {
    if (!gwBlockadesOn(galaxy)) return [];
    const out: Habitat[] = [];
    for (const h of work.suppliers) {
        if (!worldAlive(h)) continue;
        const ownedByEmpire = h.empire !== null && h.empire !== galaxy.independentEmpire;
        if (ownedByEmpire || blockaderOf(galaxy, h) !== null) out.push(h);
    }
    return out;
}

/** The share of its undisturbed speed the work builds at: 1 less giantworksBlockadeCutPct per controlled founder, at most giantworksBlockadeMaxCutPct. Pure. */
export function blockadeSpeedFactor(galaxy: Galaxy, work: GreatWorkRecord): number {
    const n = controlledFounders(galaxy, work).length;
    if (n === 0) return 1;
    return 1 - Math.min(gwParam(galaxy, 'giantworksBlockadeMaxCutPct'), gwParam(galaxy, 'giantworksBlockadeCutPct') * n) / 100;
}

/** The "Build speed 40% ..." note for the work's label and status (null: nothing is held). Pure. */
export function blockadeNote(galaxy: Galaxy, work: GreatWorkRecord): { pct: number; held: number; of: number } | null {
    const held = controlledFounders(galaxy, work).length;
    if (held === 0) return null;
    return { pct: Math.round(blockadeSpeedFactor(galaxy, work) * 100), held, of: work.suppliers.length };
}

/** Wonder-side: the extra suppliers that are not blockaded (a blockaded corrupted world sends nothing and speeds nothing up). Pure. */
export function unblockaded(galaxy: Galaxy, worlds: readonly Habitat[]): Habitat[] {
    return worlds.filter((h) => blockaderOf(galaxy, h) === null);
}
