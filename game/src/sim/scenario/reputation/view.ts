// 19o — pure row builder for the diplomacy screen's "Why they feel this way" block (tasks/19-mod-layer-scenarios.md
// §19o). No DOM, no Rnd, no state changes (never creates the ledger state).

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import { resolveStarDateDescription } from '../../galaxyTime';
import { scenarioText } from '../messages';
import { reputationCauses, reputationOn } from './ledger';

export interface ReputationRow {
    cause: string;
    label: string;
    value: number;
    decayPerYear: number;
    source: string;
    /** "+12 Apology accepted — fades 3/yr (19d3, <date>)" */
    text: string;
}

function signed(v: number): string {
    const r = Math.round(v * 10) / 10;
    return r > 0 ? `+${r}` : String(r);
}

/** How `other` feels about `self`, cause by cause (other's ledger entries about self), largest first. */
export function reputationRows(galaxy: Galaxy, self: Empire, other: Empire): ReputationRow[] {
    if (!reputationOn(galaxy)) return [];
    return reputationCauses(galaxy, other, self).map((e) => {
        const label = scenarioText(e.labelKey);
        const fade = e.decayPerYear > 0 ? `fades ${signed(e.decayPerYear).replace('+', '')}/yr` : 'permanent';
        return { cause: e.cause, label, value: e.value, decayPerYear: e.decayPerYear, source: e.source, text: `${signed(e.value)} ${label} — ${fade} (${e.source}, ${resolveStarDateDescription(e.date)})` };
    });
}
