// 19s-1 dev overlay: the local-model queue's metrics (`?llmMetrics=1` with the llmFoundations flag on). Not a port.
// A small fixed box refreshed once a second; read-only.

import type { LlmMetrics } from '../llm/queue';

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

export function showLlmOverlay(metrics: () => LlmMetrics): { dispose: () => void } {
    const box = document.createElement('pre');
    box.className = 'llm-metrics-overlay';
    Object.assign(box.style, {
        position: 'fixed',
        right: '8px',
        bottom: '8px',
        margin: '0',
        padding: '6px 8px',
        font: '11px/1.35 monospace',
        color: '#cfe',
        background: 'rgba(0,0,0,0.72)',
        border: '1px solid #466',
        zIndex: '9000',
        pointerEvents: 'none',
        whiteSpace: 'pre',
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(box);
    const tick = (): void => {
        box.textContent = llmMetricsText(metrics());
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
