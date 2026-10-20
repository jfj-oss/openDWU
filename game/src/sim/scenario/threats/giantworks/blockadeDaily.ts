// Giantworks: the daily tracker of blockaded supplier worlds, its messages and anger, and the queries that let blockaders shoot the
// Compact's convoys and let the player blockade an independent supplier world (blockade.ts has the rules; the shooting is
// blockades/blockadesBite.ts blockadesBiteShoot). Only with Blockades that bite on. Not a port. Rnd: none.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { Habitat } from '../../../types';
import { EmpireMessageType } from '../../../messages';
import { isHumanEmpire } from '../../../humanEmpires';
import { getEmpireById } from '../../../logistics/contracts';
import { galaxyStarDate } from '../../../tick/simTime';
import { registerScenarioPeriodic, registerScenarioQuery } from '../../hooks';
import { scenarioMessage, scenarioText } from '../../messages';
import { scenarioParam } from '../../state';
import { knowledgeLevel } from '../framework';
import { addAnger, compactRegard, isActor } from './actions';
import { blockadeNote, currentHolder, gwBlockadesOn, supplierWorlds, worldAlive } from './blockade';
import { buildingWorks, greatWorks, GW_FLAG, gwParam, logGw, peekGwState, TAG, type GreatWorkRecord } from './state';

function worksOf(galaxy: Galaxy, h: Habitat): GreatWorkRecord | null {
    for (const w of buildingWorks(galaxy)) if (supplierWorlds(galaxy, w).includes(h)) return w;
    return null;
}

/** Messages of a blockade starting / ending at supplier world `h`: the blockader and every human empire that has heard of the Great Work. */
function tell(galaxy: Galaxy, work: GreatWorkRecord, h: Habitat, by: Empire, started: boolean): void {
    const note = started && work.suppliers.includes(h) ? blockadeNote(galaxy, work) : null;
    const text = scenarioText(started ? `${TAG} Blockade Started` : `${TAG} Blockade Lifted`, h.name, by.name, note === null ? '' : scenarioText(`${TAG} Blockade Speed Note`, note.pct));
    for (const e of galaxy.empires) {
        if (e === null || !e.active || !isHumanEmpire(galaxy, e)) continue;
        if (e !== by && knowledgeLevel(work, e) < 1) continue;
        scenarioMessage(galaxy, e, scenarioText(started ? `${TAG} Blockade Title` : `${TAG} Blockade Lifted Title`, h.name), text, {
            type: started ? EmpireMessageType.GeneralWarning : EmpireMessageType.GeneralNeutralEvent,
            subject: h,
            popup: false,
        });
    }
}

/** Daily: confirms (for an independent world, blockadeConfirmDays in a row) and records which supplier worlds are blockaded; tells the players. */
export function blockadeDaily(galaxy: Galaxy): void {
    if (!gwBlockadesOn(galaxy)) return;
    const st = peekGwState(galaxy);
    if (st === null) return;
    const worlds: { h: Habitat; w: GreatWorkRecord }[] = [];
    for (const w of buildingWorks(galaxy)) for (const h of supplierWorlds(galaxy, w)) if (!worlds.some((x) => x.h === h)) worlds.push({ h, w });
    if (worlds.length === 0 && st.blockaded === undefined) return;
    const rec = (st.blockaded ??= {});
    const pend = (st.blockadePending ??= {});
    const confirm = Math.max(1, Math.round(scenarioParam(galaxy, 'blockadeConfirmDays', 2)));
    const live = new Set<string>();
    const now = galaxyStarDate(galaxy);
    for (const { h, w } of worlds) {
        const key = String(h.habitatIndex);
        live.add(key);
        const holder = worldAlive(h) ? currentHolder(galaxy, h) : null;
        const cur = rec[key];
        const indep = h.empire === galaxy.independentEmpire;
        if (holder !== null) {
            if (cur !== undefined) {
                cur.by = holder.empireId;
                delete pend[key];
                continue;
            }
            const n = indep ? (pend[key]?.by === holder.empireId ? pend[key].n : 0) + 1 : confirm;
            if (n < confirm) {
                pend[key] = { by: holder.empireId, n };
                continue;
            }
            delete pend[key];
            rec[key] = { by: holder.empireId, since: now };
            logGw(galaxy, now, `work ${w.id}: ${h.name} blockaded by ${holder.name}`);
            if (indep && isActor(galaxy, holder)) {
                addAnger(w, holder, gwParam(galaxy, 'giantworksAngerAttack'));
                compactRegard(galaxy, holder, -1, 'giantworks.attack');
            }
            tell(galaxy, w, h, holder, true);
        } else if (cur !== undefined) {
            const n = (pend[key]?.by === -1 ? pend[key].n : 0) + 1;
            if (indep && n < confirm) {
                pend[key] = { by: -1, n };
                continue;
            }
            delete pend[key];
            delete rec[key];
            logGw(galaxy, now, `work ${w.id}: blockade of ${h.name} lifted`);
            const by = getEmpireById(galaxy, cur.by);
            if (by !== null) tell(galaxy, w, h, by, false);
        } else delete pend[key];
    }
    for (const key of Object.keys(rec)) if (!live.has(key)) delete rec[key]; // the work is over
    for (const key of Object.keys(pend)) if (!live.has(key)) delete pend[key];
}

/** Independent supplier worlds a blockade would strangle: the founders and extra suppliers of a work not yet over. Pure. */
export function blockadableIndependent(galaxy: Galaxy, h: Habitat): boolean {
    if (!gwBlockadesOn(galaxy) || h.empire !== galaxy.independentEmpire || !worldAlive(h)) return false;
    for (const w of greatWorks(galaxy)) {
        if (w.phase !== 'seeded' && w.phase !== 'building') continue;
        if (w.founders.includes(h) || supplierWorlds(galaxy, w).includes(h)) return true;
    }
    return false;
}

export const BLOCKADE_HANDLER_IDS = ['giantworks.blockadeDaily'] as const;
export const BLOCKADE_QUERY_IDS = ['giantworks.blockadeSites', 'giantworks.blockadeVictim', 'giantworks.blockadeTarget'] as const;

export function registerBlockadeHooks(): void {
    registerScenarioPeriodic({ id: 'giantworks.blockadeDaily', flag: GW_FLAG, periodDays: 1, order: 10, run: (g) => blockadeDaily(g) });
    registerScenarioQuery({
        id: 'giantworks.blockadeSites',
        flag: GW_FLAG,
        query: 'blockadeSites',
        run: (g, v) => {
            const rec = peekGwState(g)?.blockaded;
            if (!gwBlockadesOn(g) || rec === undefined) return v;
            const out = v.slice();
            for (const w of buildingWorks(g)) {
                for (const h of supplierWorlds(g, w)) {
                    const r = rec[String(h.habitatIndex)];
                    const by = r === undefined ? null : getEmpireById(g, r.by);
                    if (by !== null && h.empire === g.independentEmpire && !out.some((s) => s.habitat === h)) out.push({ habitat: h, by, victim: null });
                }
            }
            return out;
        },
    });
    registerScenarioQuery({
        id: 'giantworks.blockadeVictim',
        flag: GW_FLAG,
        query: 'blockadeVictimShip',
        run: (g, v, a) => {
            if (v) return v;
            for (const w of buildingWorks(g)) {
                for (const c of w.convoys) if (c.origin === a.habitat && (c.ships.includes(a.builtObject) || c.escorts.includes(a.builtObject))) return true;
            }
            return false;
        },
    });
    registerScenarioQuery({ id: 'giantworks.blockadeTarget', flag: GW_FLAG, query: 'blockadeIndependentTarget', run: (g, v, a) => v || blockadableIndependent(g, a.habitat) });
}

