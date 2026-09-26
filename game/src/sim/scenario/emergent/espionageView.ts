// 19d3 — pure row / option builders for the UI (tasks/19d3-espionage-consequences.md §6): the Intelligence screen's
// "Blame" select, the diplomacy screen's per-empire "Incidents" block and the research screen's "stolen" marker. No
// DOM, no Rnd, no state changes (reads only; nothing is created when the package state does not exist yet).

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { IntelligenceMission } from '../../characters';
import { IntelligenceMissionType } from '../../espionage';
import { resolveStarDateDescription, YEAR_LENGTH } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { scenarioFlag } from '../state';
import { ESPIONAGE_FLAG } from './espionageHooks';
import { demandText, empireSpyCrises, knowsEmpire, missionFrame, pairExposures, stolenTechsOf } from './espionage';

function frameable(type: number): boolean {
    return [IntelligenceMissionType.SabotageColony, IntelligenceMissionType.SabotageConstruction, IntelligenceMissionType.DestroyBase, IntelligenceMissionType.AssassinateCharacter, IntelligenceMissionType.InciteRevolution].includes(type);
}

export interface BlameOption {
    /** -1 = no false flag. */
    empireId: number;
    label: string;
}

/**
 * The "Blame" select of the mission form: empty when the package is off or the type cannot be framed; else "(none)"
 * plus every normal empire the player and the target both know (not the player, not the target), by empireId.
 */
export function blameOptions(galaxy: Galaxy, player: Empire, missionType: number, target: Empire | null): BlameOption[] {
    if (!scenarioFlag(galaxy, ESPIONAGE_FLAG) || !frameable(missionType) || target === null || target.pirateEmpireBaseHabitat !== null) return [];
    const out: BlameOption[] = [{ empireId: -1, label: '(none)' }];
    for (const e of [...galaxy.empires].sort((x, y) => x.empireId - y.empireId)) {
        if (e === player || e === target || e === galaxy.independentEmpire || e.pirateEmpireBaseHabitat !== null || !e.active) continue;
        if (!knowsEmpire(player, e) || !knowsEmpire(target, e)) continue;
        out.push({ empireId: e.empireId, label: e.name });
    }
    return out;
}

/** "(false flag: EMPIRE)" for a framed mission row, '' otherwise. */
export function missionFrameLabel(galaxy: Galaxy, m: IntelligenceMission | null): string {
    if (m === null || !scenarioFlag(galaxy, ESPIONAGE_FLAG)) return '';
    const f = missionFrame(galaxy, m);
    return f === null ? '' : `(false flag: ${f.name})`;
}

export interface IncidentRow {
    kind: 'crisis' | 'exposure' | 'stolen';
    text: string;
}

const STAGE_LABEL: Record<string, string> = { demand: 'Demand', sanctions: 'Sanctions', war: 'War', resolved: 'Resolved' };

/**
 * The diplomacy screen's "Incidents" block for `self` viewing `other`: open crises between them (stage, demand,
 * deadline), exposures both ways in the last 3 years, stolen techs involving the pair.
 */
export function incidentRows(galaxy: Galaxy, self: Empire, other: Empire): IncidentRow[] {
    if (!scenarioFlag(galaxy, ESPIONAGE_FLAG)) return [];
    const rows: IncidentRow[] = [];
    for (const c of empireSpyCrises(galaxy, self)) {
        if (c.stage === 'resolved' || (c.offender !== other && c.victim !== other)) continue;
        const who = c.victim === self ? `We accuse the ${c.offender.name}` : `The ${c.victim.name} accuse us`;
        rows.push({ kind: 'crisis', text: `${who}: ${STAGE_LABEL[c.stage]} — demand: ${demandText(c)} — deadline ${resolveStarDateDescription(c.deadline)} (${c.cause})` });
    }
    const since = galaxyStarDate(galaxy) - 3 * YEAR_LENGTH;
    for (const x of pairExposures(galaxy, self, other, since)) {
        const dir = x.victim === self ? 'against us' : 'by us';
        rows.push({ kind: 'exposure', text: `${resolveStarDateDescription(x.starDate)} exposed ${dir}: ${x.cause}` });
    }
    for (const s of stolenTechsOf(galaxy, self)) {
        const involves = s.thief === other || s.victim === other || s.holders.includes(other);
        if (!involves) continue;
        const name = self.research.techTree[s.projectId]?.def.name ?? String(s.projectId);
        rows.push({ kind: 'stolen', text: `${name}: stolen by the ${s.thief.name} from the ${s.victim.name}; held by ${s.holders.map((h) => h.name).join(', ')}` });
    }
    return rows;
}

/** The research screen's "stolen" tooltip for a project `e` acquired by theft (as thief or buyer); '' otherwise. */
export function stolenTechMarker(galaxy: Galaxy, e: Empire, projectId: number): string {
    if (!scenarioFlag(galaxy, ESPIONAGE_FLAG)) return '';
    const s = stolenTechsOf(galaxy, e).find((x) => x.projectId === projectId && x.holders.includes(e) && x.victim !== e);
    if (s === undefined) return '';
    return `Stolen from the ${s.victim.name}${s.thief !== e ? ` (via the ${s.thief.name})` : ''}; holders: ${s.holders.map((h) => h.name).join(', ')}`;
}
