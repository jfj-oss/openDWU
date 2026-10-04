// Worker mode (docs/sim-worker.md §4.5): the main thread's end of the player's message pipeline. The pipeline is sim
// code (sim/playerMessages.ts) and runs in the worker's tick, as it runs in the in-thread tick; this turns the worker's
// events into what the UI reads:
//
// - 'playerMessages': each message the pipeline handled (once) joins the replica player's PlayerMessageStream, which
//   the ticker (empireMessageFeed.ts), the popups and stubs (messagePopups.ts) read; each event goes to the replica
//   player's event recipient (eventMessages.ts, and the audio stings that chain on it), as the sim calls it in-thread;
// - 'gameEnd': the music, the comparison window's outcome overlay and the Game End panel (screens/empireComparison.ts
//   presentGameEnd) — the worker already paused, ended the game and reviewed the achievements.
//
// Nothing here writes the game: the message options are the game's (Galaxy.messageOptions, changed by the journaled
// setMessageOptions command), and the history trim and the advisor expiry are commands too.
//
// No Pixi; the DOM only through presentGameEnd.

import type { Empire } from '../sim/empire';
import type { EmpireMessage } from '../sim/messages';
import type { Galaxy } from '../sim/galaxy';
import { GameEndEventArgs, type GameEndOutcome } from '../sim/victory';
import { PlayerMessageStream, setPlayerMessageStream } from './messagePipeline';
import { presentGameEnd } from './screens/empireComparison';
import type { WorkerEvent } from '../simworker/protocol';

export interface WorkerMessageUi {
    readonly stream: PlayerMessageStream;
    /** Handle a worker event; false when it is not one of this module's. */
    onEvent(e: WorkerEvent, resolve: (a: unknown) => unknown): boolean;
    dispose(): void;
}

export interface WorkerMessageUiOptions {
    /** The replica's player empire and galaxy. */
    player: Empire;
    galaxy: Galaxy;
    /** The HUD clock (the banner's Continue unpauses it; the worker adopts it). */
    time: { paused: boolean };
    now?: () => number;
}

export function installWorkerMessageUi(opts: WorkerMessageUiOptions): WorkerMessageUi {
    const { player, galaxy, time } = opts;
    const stream = new PlayerMessageStream(opts.now);
    setPlayerMessageStream(player, stream);
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
        onEvent(e, resolve) {
            if (disposed) return false;
            if (e.kind === 'playerMessages') {
                for (const r of e.receipts) {
                    const message = tryResolve(resolve, r.m) as EmpireMessage | null;
                    if (message === null || message === undefined) continue;
                    stream.push({ message, ticker: r.ticker, advisor: r.advisor, route: r.route, action: r.action });
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
            setPlayerMessageStream(player, null);
        },
    };
}
