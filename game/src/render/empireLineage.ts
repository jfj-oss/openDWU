// 19r item 6 — which empire a mid-game empire derives from, read from the scenario packages that create them. Pure
// over the galaxy; each source is a scenario state bag read by key through a local structural shape (the packages live
// on other branches — 19c chartered companies, 19d1 politics, 19d4 demographics, 19f-7 Ghost Armada — so nothing is
// imported: absent state = no lineage).
//
//   company  scenario.state['charteredCompanies.charters'].charters[] { companyId, founderId }  (19c charters.ts 117)
//   seceded  scenario.state['politics'].events[] { kind: 'secession', success, empire, other }  (19d1 politics.ts 75)
//   exile    scenario.state['demographics'].exileFounded: Set<old owner id>, the exile named by GameText
//            "Emergent Exile Empire NAME" = "{0} Government in Exile" (19d4 demographics.ts 575 tryFoundExileEmpire)
//   ghost    scenario.state['ghostArmada'].risen[] { deadEmpireId, deadEmpireName, faction }   (19f-7 ghostArmada.ts 84)

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { scenarioText } from '../sim/scenario/messages';

export type LineageKind = 'company' | 'seceded' | 'exile' | 'ghost';

export interface EmpireLineage {
    kind: LineageKind;
    /** The parent (founder / empire seceded from / lost empire / dead empire); null when it is gone from the galaxy. */
    parent: Empire | null;
    /** Name of the parent (kept by the ghost record even after teardown). */
    parentName: string;
}

interface ChartersShape {
    charters?: { companyId: number; founderId: number }[];
}
interface PoliticsShape {
    events?: { kind: string; success: boolean; empire: Empire | null; other: Empire | null }[];
}
interface DemographicsShape {
    exileFounded?: Set<number> | number[];
}
interface GhostShape {
    risen?: { deadEmpireId: number; deadEmpireName: string; faction: Empire | null }[];
}

function stateOf<T>(galaxy: Galaxy, key: string): T | null {
    const s = galaxy.scenario;
    if (s === null || !(key in s.state)) return null;
    return s.state[key] as T;
}

function empireById(galaxy: Galaxy, id: number): Empire | null {
    return galaxy.empires.find((e) => e !== null && e.empireId === id) ?? galaxy.pirateEmpires.find((e) => e.empireId === id) ?? null;
}

/** The lineage of `empire` (null for an ordinary empire or when no deriving package has state). */
export function empireLineage(galaxy: Galaxy, empire: Empire): EmpireLineage | null {
    if (galaxy.scenario === null) return null;
    const ch = stateOf<ChartersShape>(galaxy, 'charteredCompanies.charters');
    const c = ch?.charters?.find((x) => x.companyId === empire.empireId);
    if (c !== undefined) {
        const p = empireById(galaxy, c.founderId);
        return { kind: 'company', parent: p, parentName: p?.name ?? '' };
    }
    const pol = stateOf<PoliticsShape>(galaxy, 'politics');
    const ev = pol?.events?.find((e) => e.kind === 'secession' && e.success && e.other === empire);
    if (ev !== undefined) return { kind: 'seceded', parent: ev.empire, parentName: ev.empire?.name ?? '' };
    const gh = stateOf<GhostShape>(galaxy, 'ghostArmada');
    const r = gh?.risen?.find((x) => x.faction === empire);
    if (r !== undefined) return { kind: 'ghost', parent: empireById(galaxy, r.deadEmpireId), parentName: r.deadEmpireName };
    const dem = stateOf<DemographicsShape>(galaxy, 'demographics');
    if (dem?.exileFounded !== undefined) {
        for (const id of dem.exileFounded) {
            const p = empireById(galaxy, id);
            if (p === null || p === empire) continue;
            const expected = scenarioText('Emergent Exile Empire NAME', p.name);
            const named = expected !== 'Emergent Exile Empire NAME' ? empire.name === expected : empire.name.startsWith(p.name) && /exile/i.test(empire.name);
            if (named) return { kind: 'exile', parent: p, parentName: p.name };
        }
    }
    return null;
}
