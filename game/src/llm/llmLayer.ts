// 19s-1 app wiring of the local-model layer (tasks/19-mod-layer-scenarios.md §19s item 1). Not a port.
// With the scenario flag llmFoundations off this creates nothing (no queue, no timer, no probe). On: one LlmQueue over
// the advisor endpoint (Settings: advisorEndpoint / advisorModel / advisorApi), the yearly ChronicleJob polled every
// `pollMs` of real time between frames, and the metrics overlay with `?llmMetrics=1`. Disposed with the game view.
// 19s-4: the running layer is registered (currentLlmLayer) so the Galactic History Ask / Orders tabs reach its queue.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { llmOn, type ChronicleYear } from '../sim/scenario/llm/chronicle';
import { advisorTransport, galaxyLlmClock, llmPolicyFromGalaxy, LlmQueue, type EndpointSettings, type LlmTransport } from './queue';
import { ChronicleJob } from './chronicleJob';

export interface LlmLayerOptions {
    galaxy: Galaxy;
    player: Empire | null;
    settings: () => EndpointSettings;
    /** window.location.search (dev switches). */
    search?: string;
    /** Test / dev override of the wire. */
    transport?: LlmTransport;
    onChronicle?: (entry: ChronicleYear) => void;
    pollMs?: number;
}

export interface LlmLayer {
    readonly on: boolean;
    queue: LlmQueue | null;
    chronicle: ChronicleJob | null;
    dispose: () => void;
}

/** The layer of the game on screen (null with the flag off / no game): the 19s-4 archivist and order box read its queue. */
let current: LlmLayer | null = null;

export function currentLlmLayer(): LlmLayer | null {
    return current;
}

export function startLlmLayer(opts: LlmLayerOptions): LlmLayer {
    if (!llmOn(opts.galaxy)) return { on: false, queue: null, chronicle: null, dispose: () => {} };
    const transport = opts.transport ?? advisorTransport(opts.settings);
    const queue = new LlmQueue({ transport, clock: galaxyLlmClock(opts.galaxy), policy: () => llmPolicyFromGalaxy(opts.galaxy) });
    const chronicle = new ChronicleJob({ galaxy: opts.galaxy, empire: opts.player, queue, model: () => transport.model(), onStored: opts.onChronicle });
    const timer = setInterval(() => chronicle.poll(), opts.pollMs ?? 2000);
    let overlay: { dispose: () => void } | null = null;
    if (new URLSearchParams(opts.search ?? '').get('llmMetrics') === '1' && typeof document !== 'undefined') {
        void import('../ui/llmOverlay').then((m) => {
            overlay = m.showLlmOverlay(() => queue.metrics());
        });
    }
    const layer: LlmLayer = {
        on: true,
        queue,
        chronicle,
        dispose: () => {
            if (current === layer) current = null;
            clearInterval(timer);
            chronicle.dispose();
            queue.dispose();
            overlay?.dispose();
        },
    };
    current = layer;
    return layer;
}
