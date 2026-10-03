// Worker mode (docs/sim-worker.md §9 chunk 4): the main thread's end of the player's message pipeline
// (messagePipeline.ts). The worker is the player's message and event recipient and does the UI's sim writes; this
// turns its events into what the in-thread UI reads:
//
// - 'playerMessages': each message the player received (once) joins the replica player's PlayerMessageStream, which
//   the ticker (empireMessageFeed.ts), the popups and stubs (messagePopups.ts) read instead of Empire.Messages; each
//   event message goes to the replica player's event recipient (eventMessages.ts, and the audio stings that chain
//   on it), as the sim would call it in-thread;
// - 'gameEnd': the music and the banner (screens/empireComparison.ts presentGameEnd) — the worker already paused,
//   ended the game and reviewed the achievements;
// - the Game Options message filters, which decide what the worker records, are mirrored to it (sent now and on
//   every change).
//
// No Pixi; the DOM only through presentGameEnd.

import type { Empire } from '../sim/empire';
import type { EmpireMessage } from '../sim/messages';
import type { Galaxy } from '../sim/galaxy';
import { GameEndEventArgs, type GameEndOutcome } from '../sim/victory';
import { getMessageOptions } from './messageRouting';
import { PlayerMessageStream, setPlayerMessageStream, type PlayerMessageUiOp } from './messagePipeline';
import { presentGameEnd } from './screens/empireComparison';
import type { WorkerEvent } from '../simworker/protocol';

export interface WorkerMessageUi {
    readonly stream: PlayerMessageStream;
    /** Handle a worker event; false when it is not one of this module's. */
    onEvent(e: WorkerEvent, resolve: (a: unknown) => unknown): boolean;
    /** Send the message options now if they changed since the last send. */
    syncOptions(): void;
    dispose(): void;
}

export interface WorkerMessageUiOptions {
    /** The replica's player empire and galaxy. */
    player: Empire;
    galaxy: Galaxy;
    /** The HUD clock (the banner's Continue unpauses it; the worker adopts it). */
    time: { paused: boolean };
    /** Send a UI op to the worker (SimClientCore.postUiOp). */
    post: (op: PlayerMessageUiOp, args: unknown[]) => void;
    now?: () => number;
    /** Options re-check period (ms; 0: only at install and on syncOptions()). Default 250, the UI timers' rate. */
    optionsPollMs?: number;
}

export function installWorkerMessageUi(opts: WorkerMessageUiOptions): WorkerMessageUi {
    const { player, galaxy, time, post } = opts;
    const stream = new PlayerMessageStream(post, opts.now);
    setPlayerMessageStream(player, stream);
    let sentOptions = '';
    const syncOptions = (): void => {
        const o = getMessageOptions();
        const key = JSON.stringify(o);
        if (key === sentOptions) return;
        sentOptions = key;
        post('messageOptions', [JSON.parse(key) as unknown]);
    };
    syncOptions();
    const pollMs = opts.optionsPollMs ?? 250;
    const timer = pollMs > 0 ? setInterval(syncOptions, pollMs) : null;
    const tryResolve = (resolve: (a: unknown) => unknown, a: unknown): unknown => {
        try {
            return resolve(a);
        } catch {
            return null; // dropped from the game since (the replica no longer knows it)
        }
    };
    let disposed = false;
    return {
        stream,
        syncOptions,
        onEvent(e, resolve) {
            if (disposed) return false;
            if (e.kind === 'playerMessages') {
                for (const r of e.receipts) {
                    const message = tryResolve(resolve, r.m) as EmpireMessage | null;
                    if (message === null || message === undefined) continue;
                    stream.push({ message, ticker: r.ticker, popupPass: r.popupPass, advisor: r.advisor, route: r.route, action: r.action });
                }
                for (const ev of e.events) {
                    // Main.Part4.cs:481 ReceiveEventMessage: the UI's recipient (eventMessages.ts → the event panel; the
                    // audio stings chain on it) gets the call the sim made in the worker.
                    const recipient = player.eventMessageRecipient;
                    if (recipient == null) continue;
                    recipient.receiveEventMessage(ev.type, ev.title, ev.message, tryResolve(resolve, ev.data), tryResolve(resolve, ev.location));
                }
                return true;
            }
            if (e.kind === 'gameEnd') {
                const a = e.args;
                if (a !== undefined) {
                    const victor = tryResolve(resolve, a.victor) as Empire | null;
                    presentGameEnd(galaxy, time, new GameEndEventArgs(victor ?? null, a.outcome as GameEndOutcome, a.description, a.code));
                }
                return true;
            }
            return false;
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            if (timer !== null) clearInterval(timer);
            setPlayerMessageStream(player, null);
        },
    };
}
