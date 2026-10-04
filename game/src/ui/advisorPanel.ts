// 18a — the chat advisor panel (K; T until parC1): talk to the empire's fleet admiral, backed by a local model server
// (advisorClient.ts). Orders the admiral agrees to go through the player command layer and are echoed with ✓ / ✗ and
// the sim's message; clarifying questions appear inline; a war declaration shows a Confirm chip. The panel stays
// read-only (input disabled) until the configured endpoint (settings.ts advisorEndpoint / advisorModel) answers.
// No original counterpart (the original has no advisor chat); styling follows the house dark panels.

import './advisorPanel.css';
import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { AdvisorBrief, AdvisorSelection } from '../sim/player/advisorBrief';
import { advisorCharacter } from '../sim/player/advisorBrief';
import { type AdvisorCommandResult } from '../sim/player/advisorCommands';
import { issuePlayerCommand } from '../sim/player/playerCommands';
import { probeAdvisorEndpoint, runAdvisorTurn, type AdvisorApi, type ChatMessage } from './advisorClient';
import { getSettings } from './settings';
import { getSelection } from './hud';
import { FONT, el, glassButton, openOriginalWindow, place, scrollPanel, textBox } from './originalWindow';

export interface AdvisorPanelOptions {
    galaxy: Galaxy;
    player: Empire;
}

/** One rendered line of the conversation (pure, for tests). */
export interface AdvisorLine {
    kind: 'user' | 'advisor' | 'question' | 'ok' | 'fail' | 'confirm' | 'error' | 'system';
    text: string;
    /** Confirm chip: the command id to re-run with confirm: true. */
    confirmId?: string;
}

/** The ✓ / ✗ / confirm lines for executed commands. */
export function resultLines(results: readonly AdvisorCommandResult[]): AdvisorLine[] {
    return results.map((r): AdvisorLine => {
        if (r.status === 'needs-confirm') return { kind: 'confirm', text: `${r.text} — ${r.message}`, confirmId: r.id };
        return { kind: r.ok ? 'ok' : 'fail', text: `${r.ok ? '✓' : '✗'} ${r.text}${r.message ? ` — ${r.message}` : ''}` };
    });
}

/** The HUD selection as the brief's selection (fleet, else ship/base, else the selected habitat). */
export function advisorSelectionFromHud(): AdvisorSelection {
    const sel = getSelection();
    if (sel === null) return null;
    return sel.shipGroup ?? sel.builtObject ?? sel.builtObjects?.[0] ?? sel.habitat;
}

interface OpenState {
    root: HTMLElement;
    close: () => void;
}

let open: OpenState | null = null;

/** Open the advisor chat, or close it if it is open. */
export function toggleAdvisorPanel(opts: AdvisorPanelOptions): void {
    if (open) open.close();
    else open = createAdvisorPanel(opts);
}

/** Close the advisor chat (no-op when closed; game teardown). */
export function closeAdvisorPanel(): void {
    open?.close();
}

// The conversation survives closing / reopening the panel within one game (cleared when the player changes).
let history: ChatMessage[] = [];
let lines: AdvisorLine[] = [];
let historyOwner: Empire | null = null;

function createAdvisorPanel(opts: AdvisorPanelOptions): OpenState {
    if (historyOwner !== opts.player) {
        history = [];
        lines = [];
        historyOwner = opts.player;
    }
    const settings = getSettings();
    const admiral = advisorCharacter(opts.player);
    let api: AdvisorApi | null = null;
    let busy = false;
    let lastBrief: AdvisorBrief | null = null;
    const abort = new AbortController();

    // Original-style ScreenPanel (ui/originalWindow.ts); the chat does not pause the game.
    const W = 560;
    const H = 640;
    const owin = openOriginalWindow({
        id: 'advisor',
        title: admiral !== null ? `Advisor — ${admiral.name}` : 'Advisor — Fleet Admiral',
        icon: 'diplomacy.png',
        width: W,
        height: H,
        noAutoPause: true,
        escapeCloses: true,
        onClose: () => close(),
    });
    const root = owin.root;
    root.classList.add('advisor-wrap');
    const body = owin.body;
    const bw = owin.bodySize.w;
    const bh = owin.bodySize.h;

    const status = place(el('div', 'advisor-status'), 12, 8);
    status.textContent = 'connecting…';
    body.appendChild(status);

    const list = scrollPanel('advisor-messages');
    place(list, 8, 34, bw - 16, bh - 34 - 50);
    body.appendChild(list);

    const form = el('form', 'advisor-input-row');
    place(form, 8, bh - 42, bw - 16, 34);
    const input = textBox('', 'Give an order…', () => {});
    input.classList.add('advisor-input');
    place(input, 0, 0, bw - 16 - 98, 34);
    input.style.fontSize = `${FONT.normal}px`;
    input.disabled = true;
    const send = glassButton('Send', { size: FONT.normal });
    send.type = 'submit';
    send.classList.add('advisor-send');
    place(send, bw - 16 - 90, 0, 90, 34);
    send.disabled = true;
    form.append(input, send);
    body.appendChild(form);

    function renderLine(l: AdvisorLine): HTMLElement {
        const row = document.createElement('div');
        row.className = `advisor-line advisor-${l.kind}`;
        row.textContent = l.text;
        if (l.kind === 'confirm' && l.confirmId !== undefined) {
            const id = l.confirmId;
            const chip = glassButton('Confirm', {
                size: FONT.tiny,
                className: 'ow-flow advisor-confirm-chip',
                colors: { outer: 0x601810, shine: 0xc04030, glow: 0xc04030 },
                onClick: () => {
                    chip.disabled = true;
                    if (lastBrief === null) return;
                    // Command log: queued, applied at the next frame boundary.
                    issuePlayerCommand(opts.galaxy, opts.player, 'advisorCommands', [lastBrief, [{ id, confirm: true }]], (results) => {
                        history.push({ role: 'user', content: 'Confirmed.' });
                        history.push({ role: 'assistant', content: results.map((r) => `[${r.ok ? 'done' : 'failed'}: ${r.text}]`).join(' ') });
                        add(...resultLines(results));
                    });
                },
            });
            row.appendChild(chip);
        }
        return row;
    }
    function add(...ls: AdvisorLine[]): void {
        for (const l of ls) {
            lines.push(l);
            list.appendChild(renderLine(l));
        }
        list.scrollTop = list.scrollHeight;
    }
    for (const l of lines) list.appendChild(renderLine(l));

    function setReady(ready: boolean, text: string): void {
        status.textContent = text;
        status.classList.toggle('advisor-status-on', ready);
        input.disabled = !ready || busy;
        send.disabled = !ready || busy;
        if (ready && !busy) input.focus();
    }

    async function connect(): Promise<void> {
        setReady(false, 'connecting…');
        api = await probeAdvisorEndpoint({ endpoint: settings.advisorEndpoint, model: settings.advisorModel, api: settings.advisorApi });
        if (open === null || open.root !== root) return;
        if (api === null) {
            setReady(false, 'offline');
            add({ kind: 'system', text: `No model server at ${settings.advisorEndpoint}. Start Ollama (ollama serve; ollama pull ${settings.advisorModel}) or a llama-server, then reopen (K).` });
            return;
        }
        setReady(true, `${settings.advisorModel}`);
        if (lines.length === 0) add({ kind: 'system', text: 'Orders: e.g. "send my explorer to the nearest unexplored system", "refuel the fleet".' });
    }

    async function submit(text: string): Promise<void> {
        if (api === null || busy || text.trim() === '') return;
        busy = true;
        setReady(true, 'thinking…');
        add({ kind: 'user', text });
        let turn: Awaited<ReturnType<typeof runAdvisorTurn>>;
        try {
            turn = await runAdvisorTurn({
                galaxy: opts.galaxy,
                player: opts.player,
                selection: advisorSelectionFromHud(),
                history,
                text,
                cfg: { endpoint: settings.advisorEndpoint, model: settings.advisorModel, api, think: settings.advisorThink },
                signal: abort.signal,
            });
        } finally {
            // Not left busy (the input disabled) when the turn throws (in-thread: an executor that throws).
            busy = false;
        }
        if (open === null || open.root !== root) return;
        lastBrief = turn.brief;
        history.push(...turn.history);
        const secs = `${(turn.latencyMs / 1000).toFixed(1)} s`;
        if (turn.reply !== '') add({ kind: 'advisor', text: turn.reply });
        if (turn.clarify !== undefined) add({ kind: 'question', text: turn.clarify });
        add(...resultLines(turn.results));
        for (const r of turn.rejected) add({ kind: 'fail', text: `✗ ${r.reason}` });
        if (turn.error !== undefined) add({ kind: 'error', text: turn.error });
        root.dataset.lastLatencyMs = String(turn.latencyMs);
        root.dataset.lastRaw = turn.raw;
        setReady(true, `${settings.advisorModel} · ${secs}`);
    }

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = input.value;
        input.value = '';
        void submit(text);
    });
    // Keep typing out of the game's key bindings ('?', Space …); Escape still reaches the document handler below.
    input.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') e.stopPropagation();
    });

    let closing = false;
    function close(): void {
        if (closing) return;
        closing = true;
        abort.abort();
        if (!owin.closed) owin.close();
        open = null;
    }

    const state: OpenState = { root, close };
    open = state;
    void connect();
    return state;
}
