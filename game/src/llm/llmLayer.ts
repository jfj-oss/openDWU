// 19s-1 app wiring of the local-model layer (tasks/19-mod-layer-scenarios.md §19s item 1). Not a port.
// With the scenario flag llmFoundations off this creates nothing (no queue, no timer, no probe). On: one LlmQueue over
// the advisor endpoint (Settings: advisorEndpoint / advisorModel / advisorApi), the yearly ChronicleJob polled every
// `pollMs` of real time between frames, and the metrics overlay with `?llmMetrics=1`. Disposed with the game view.
// 19s-3: with the flag llmStrategic also on, the StrategicJob (llm/strategicJob.ts) is polled on the same timer and the
// overlay lists the strategic decision log.
// 19s-4: the running layer is registered (currentLlmLayer) so the Galactic History Ask / Orders tabs reach its queue.
// 19s-2: with llmVoices also on, the VoiceJob (llm/voiceJob.ts) is polled by the same timer and registered as the
// active job (the council screen reads its speeches); off → no job.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { llmOn, type ChronicleYear } from '../sim/scenario/llm/chronicle';
import { advisorTransport, galaxyLlmClock, llmPolicyFromGalaxy, LlmQueue, type EndpointSettings, type LlmTransport } from './queue';
import { ChronicleJob } from './chronicleJob';
import { StrategicJob } from './strategicJob';
import { strategicLog, strategicOn } from '../sim/scenario/llm/strategic';
import { VoiceJob, setActiveVoiceJob, activeVoiceJob, type VoiceJobOptions } from './voiceJob';
import { voicesOn } from '../sim/scenario/llm/voiceCues';

export interface LlmLayerOptions {
    galaxy: Galaxy;
    player: Empire | null;
    settings: () => EndpointSettings;
    /** window.location.search (dev switches). */
    search?: string;
    /** Test / dev override of the wire. */
    transport?: LlmTransport;
    onChronicle?: (entry: ChronicleYear) => void;
    /** 19s-2: a surface was upgraded by a voice. */
    onVoiced?: VoiceJobOptions['onVoiced'];
    pollMs?: number;
}

export interface LlmLayer {
    readonly on: boolean;
    queue: LlmQueue | null;
    chronicle: ChronicleJob | null;
    /** 19s-3 (flag llmStrategic): the yearly strategic pass. */
    strategic: StrategicJob | null;
    /** 19s-2 voices (null with llmVoices off). */
    voices: VoiceJob | null;
    dispose: () => void;
}

/** The layer of the game on screen (null with the flag off / no game): the 19s-4 archivist and order box read its queue. */
let current: LlmLayer | null = null;

export function currentLlmLayer(): LlmLayer | null {
    return current;
}

export function startLlmLayer(opts: LlmLayerOptions): LlmLayer {
    if (!llmOn(opts.galaxy)) return { on: false, queue: null, chronicle: null, strategic: null, voices: null, dispose: () => {} };
    const transport = opts.transport ?? advisorTransport(opts.settings);
    const queue = new LlmQueue({ transport, clock: galaxyLlmClock(opts.galaxy), policy: () => llmPolicyFromGalaxy(opts.galaxy) });
    const chronicle = new ChronicleJob({ galaxy: opts.galaxy, empire: opts.player, queue, model: () => transport.model(), onStored: opts.onChronicle });
    const strategic = strategicOn(opts.galaxy) ? new StrategicJob({ galaxy: opts.galaxy, player: opts.player, queue }) : null;
    const voices = voicesOn(opts.galaxy) ? new VoiceJob({ galaxy: opts.galaxy, player: opts.player, queue, onVoiced: opts.onVoiced }) : null;
    if (voices !== null) setActiveVoiceJob(voices);
    const timer = setInterval(() => {
        chronicle.poll();
        strategic?.poll();
        voices?.poll();
    }, opts.pollMs ?? 2000);
    let overlay: { dispose: () => void } | null = null;
    if (new URLSearchParams(opts.search ?? '').get('llmMetrics') === '1' && typeof document !== 'undefined') {
        void import('../ui/llmOverlay').then((m) => {
            overlay = m.showLlmOverlay(() => queue.metrics(), strategic !== null ? () => strategicLog(opts.galaxy) : undefined);
        });
    }
    const layer: LlmLayer = {
        on: true,
        queue,
        chronicle,
        strategic,
        voices,
        dispose: () => {
            if (current === layer) current = null;
            clearInterval(timer);
            chronicle.dispose();
            strategic?.dispose();
            if (voices !== null) {
                voices.dispose();
                if (activeVoiceJob() === voices) setActiveVoiceJob(null);
            }
            queue.dispose();
            overlay?.dispose();
        },
    };
    current = layer;
    return layer;
}
