// 19s-1 dev overlay: the local-model queue's metrics (`?llmMetrics=1` with the llmFoundations flag on). Not a port.
// A small fixed box refreshed once a second; read-only, drawn as an original BorderPanel (llmOverlay.css). 19s-3: with llmStrategic on, the last rows of the strategic
// decision log (empire, year, options offered, choice, the model's reason, applied / blocked / refused).

import './llmOverlay.css';
import type { LlmMetrics } from '../llm/queue';
import type { StrategicLogEntry } from '../sim/scenario/llm/strategic';

/** Rows of the strategic decision log shown. */
export const OVERLAY_LOG_ROWS = 6;

/** The decision-log lines (pure; tests): newest last. */
export function strategicLogText(log: readonly StrategicLogEntry[], rows = OVERLAY_LOG_ROWS): string {
    if (log.length === 0) return 'strategic: no decisions yet';
    const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
    const counts = { applied: 0, blocked: 0, refused: 0, none: 0 };
    for (const e of log) counts[e.status]++;
    const head = `strategic ${log.length}: applied ${counts.applied}  blocked ${counts.blocked}  refused ${counts.refused}  none ${counts.none}`;
    return [
        head,
        ...log.slice(-rows).map((e) => `${e.year} ${clip(e.empireName, 18)} [${e.offered.length}] ${e.choice ?? '-'} ${e.status}: ${clip(e.reason !== '' ? e.reason : e.text, 70)}`),
    ].join('\n');
}

/** The overlay's text for a metrics snapshot (pure; tests). */
export function llmMetricsText(m: LlmMetrics): string {
    return [
        `LLM ${m.endpoint}  queue ${m.queued}  in flight ${m.inFlight}`,
        `requests ${m.submitted}  sent ${m.sent}  ok ${m.ok}  cache ${m.cacheHits}  shared ${m.shared}`,
        `silent ${m.silent}  budget ${m.budgetRefused}  timeout ${m.timeouts}  error ${m.errors}`,
        `tokens in ${m.tokensIn}  out ${m.tokensOut}  last ${m.lastLatencyMs} ms`,
        `year ${m.year}: ${m.yearRequests} req / ${m.yearTokens} tok`,
        Object.entries(m.byPurpose)
            .map(([k, v]) => `${k} ${v}`)
            .join('  '),
    ].join('\n');
}

export function showLlmOverlay(metrics: () => LlmMetrics, strategic?: () => readonly StrategicLogEntry[]): { dispose: () => void } {
    const box = document.createElement('pre');
    box.className = 'llm-metrics-overlay';
    document.body.appendChild(box);
    const tick = (): void => {
        box.textContent = llmMetricsText(metrics()) + (strategic !== undefined ? `\n${strategicLogText(strategic())}` : '');
    };
    tick();
    const t = setInterval(tick, 1000);
    return {
        dispose: () => {
            clearInterval(t);
            box.remove();
        },
    };
}
