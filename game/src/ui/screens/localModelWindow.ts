// Options → "Local model..." (ours, not in the original): where the local LLM server is, which model, thinking on/off,
// the AI voice toggle, and a [Test] button. All UI settings (ui/settings.ts, never sim state); [Apply] saves them and
// makes the running LLM layer probe the new address on its next poll.
import { checkBox, dropDown, glassButton, openOriginalWindow, place, text, textBox, type OriginalWindow } from '../originalWindow';
import { groupBox } from '../originalWindowControls';
import { getSettings, updateSettings, type UiSettings } from '../settings';
import { listAdvisorModels, testAdvisorEndpoint, type AdvisorTestResult } from '../advisorClient';
import { resetDiplomatVoiceProbe } from '../diplomatVoice';
import { currentLlmLayer } from '../../llm/llmLayer';
import { scenarioFlag } from '../../sim/scenario/state';
import type { Galaxy } from '../../sim/galaxy';

export const LOCAL_MODEL_TITLE = 'Local model';

export const ENDPOINT_PRESETS: readonly { value: string; label: string }[] = [
    { value: 'http://127.0.0.1:11434', label: 'Ollama (11434)' },
    { value: 'http://127.0.0.1:1234', label: 'LM Studio (1234)' },
    { value: 'http://127.0.0.1:8080', label: 'llama-server (8080)' },
];

export type LocalModelDraft = Pick<UiSettings, 'advisorEndpoint' | 'advisorModel' | 'advisorApi' | 'advisorThink' | 'diplomatVoice'>;

export function localModelDraft(s: UiSettings = getSettings()): LocalModelDraft {
    return { advisorEndpoint: s.advisorEndpoint, advisorModel: s.advisorModel, advisorApi: s.advisorApi, advisorThink: s.advisorThink, diplomatVoice: s.diplomatVoice };
}

/** Save the draft and make everything that cached the old endpoint start over (voice probe, running LLM queue). */
export function applyLocalModelSettings(d: LocalModelDraft): void {
    updateSettings({ ...d, advisorEndpoint: d.advisorEndpoint.trim(), advisorModel: d.advisorModel.trim() });
    resetDiplomatVoiceProbe();
    currentLlmLayer()?.queue?.resetEndpoint();
}

/** The ✓/✗ line the [Test] button shows. */
export function testResultText(r: AdvisorTestResult): string {
    if (!r.ok) return `✗ ${r.error ?? 'failed'}`;
    const warn = r.alwaysThinks ? '\nThis model always thinks; answers will be slow.' : '';
    return `✓ ${r.model} (${r.api}) answered in ${r.latencyMs} ms${warn}`;
}

/** Read-only: which LLM add-on flags this game has. */
export function llmFlagsLine(galaxy: Galaxy | null): string {
    if (galaxy === null || galaxy.scenario == null) return 'No game loaded: the LLM add-ons are chosen when a game is created.';
    const on = ['llmFoundations', 'llmStrategic', 'llmVoices', 'llmMemory', 'llmNegotiation'].filter((f) => scenarioFlag(galaxy, f));
    return `This game's LLM add-ons: ${on.length > 0 ? on.join(', ') : 'none'}`;
}

const W = 520;
const H = 420;

export function openLocalModelWindow(galaxy: Galaxy | null, onClose: () => void): OriginalWindow {
    const win = openOriginalWindow({ id: 'gameoptions-localmodel', title: LOCAL_MODEL_TITLE, width: W, height: H, onClose });
    const body = win.body;
    body.classList.add('go-body');
    const d = localModelDraft();
    const label = (c: string, x: number, y: number): void => {
        body.appendChild(place(text(c, { size: 18.67 }), x, y));
    };
    const g = place(groupBox('Server', W - 40, 250, 18.67), 12, 8);
    body.appendChild(g);
    const put = (e: HTMLElement, x: number, y: number, w: number, h = 21): void => {
        e.classList.add('go-combo');
        g.appendChild(place(e, x, y, w, h));
    };
    const lab = (c: string, y: number): void => {
        g.appendChild(place(text(c, { size: 18.67 }), 12, y));
    };

    lab('Address', 26);
    const endpoint = textBox(d.advisorEndpoint, 'http://127.0.0.1:11434', (v) => (d.advisorEndpoint = v));
    endpoint.dataset.id = 'endpoint';
    put(endpoint, 100, 24, 380);
    lab('Preset', 56);
    const preset = dropDown([{ value: '', label: '(choose)' }, ...ENDPOINT_PRESETS], '', (v) => {
        if (v === '') return;
        endpoint.value = v;
        d.advisorEndpoint = v;
    });
    preset.dataset.id = 'preset';
    put(preset, 100, 54, 380);
    lab('API', 86);
    const api = dropDown(
        [
            { value: 'auto', label: 'Auto-detect' },
            { value: 'ollama', label: 'Ollama' },
            { value: 'openai', label: 'OpenAI-compatible (LM Studio, llama-server)' },
        ],
        d.advisorApi,
        (v) => (d.advisorApi = v as LocalModelDraft['advisorApi']),
    );
    api.dataset.id = 'api';
    put(api, 100, 84, 380);
    lab('Model', 116);
    const model = textBox(d.advisorModel, 'qwen3:4b', (v) => (d.advisorModel = v));
    model.dataset.id = 'model';
    put(model, 100, 114, 380);
    lab('Installed', 146);
    const installed = dropDown([{ value: '', label: '(press Refresh)' }], '', (v) => {
        if (v === '') return;
        model.value = v;
        d.advisorModel = v;
    });
    installed.dataset.id = 'installed';
    put(installed, 100, 144, 290);
    const refresh = glassButton('Refresh', {
        size: 15.83,
        className: 'go-button',
        onClick: () => {
            void listAdvisorModels({ endpoint: d.advisorEndpoint, api: d.advisorApi }).then((ids) => {
                if (win.closed) return;
                installed.replaceChildren(...[{ value: '', label: ids.length > 0 ? '(choose)' : '(none found)' }, ...ids.map((v) => ({ value: v, label: v }))].map((o) => Object.assign(document.createElement('option'), { value: o.value, textContent: o.label })));
            });
        },
    });
    refresh.dataset.id = 'refresh';
    g.appendChild(place(refresh, 400, 143, 80, 24));
    const think = checkBox('Thinking (slower; off is recommended)', d.advisorThink, (v) => (d.advisorThink = v), 18.67);
    g.appendChild(place(think, 12, 178));
    const voice = checkBox('AI voice (diplomats and councils speak in character)', d.diplomatVoice, (v) => (d.diplomatVoice = v), 18.67);
    g.appendChild(place(voice, 12, 206));

    label(llmFlagsLine(galaxy), 16, 268);
    const result = place(text('', { size: 16.67, wrapWidth: W - 60 }), 16, 300);
    result.dataset.id = 'result';
    body.appendChild(result);

    const test = glassButton('Test', {
        size: 15.83,
        className: 'go-button',
        onClick: () => {
            result.textContent = 'Testing...';
            void testAdvisorEndpoint({ endpoint: d.advisorEndpoint, model: d.advisorModel, api: d.advisorApi, think: d.advisorThink }).then((r) => {
                if (!win.closed) result.textContent = testResultText(r);
            });
        },
    });
    test.dataset.id = 'test';
    body.appendChild(place(test, 16, 380, 90, 26));
    const apply = glassButton('Apply', {
        size: 15.83,
        className: 'go-button',
        onClick: () => {
            applyLocalModelSettings(d);
            result.textContent = 'Saved. The game probes the server again on its next poll.';
        },
    });
    apply.dataset.id = 'apply';
    body.appendChild(place(apply, 116, 380, 90, 26));
    return win;
}
