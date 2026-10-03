// Sim worker: the trade-flow ledger across the boundary (docs/sim-worker.md §9 chunk 3).
//
// In-thread, the freight overlay (render/freightOverlay.ts) switches contract recording on and off, and it and the
// Trade Flows panel (ui/screens/tradeFlows.ts) read the ledger, which sim/logistics/tradeFlows.ts keeps in a module
// WeakMap beside the galaxy, outside the object graph. In worker mode the contracts are made in the worker, so:
//
// - **Worker** (TradeFlowSyncSource): the main thread's `tradeFlows` message switches recording on the authoritative
//   galaxy. The ledger is synced as a side table: a view object in the side-tables root (`TRADE_FLOWS_SIDE_KEY`)
//   that shares the ledger's `entries` array (diffed in place, like any synced array) and carries `version`,
//   `startStarDate` and the freighters' contract destinations. The sim keeps those in a WeakMap, which cannot be
//   iterated, so the view holds a Map of the live freighters with contracts (all the overlay's leaders read),
//   refreshed when the ledger changed, at most every REFRESH_TICKS ticks. `index` (only recordContract reads it) stays
//   an empty Map: the replica never records.
// - **Main thread** (ReplicaTradeFlows): registered on the replica galaxy with tradeFlows.ts setRemoteTradeFlows, so
//   enable / disable / tradeFlowLedger on the replica, unchanged callers, post the message and return the synced view
//   (which already has the TradeFlowLedger shape). Until the first sync of a newly enabled ledger it returns an empty
//   placeholder, so the panel does not flash "not recording".
//
// The recorder only observes contracts (no graph write, no Rnd), so recording in the worker moves no digest or pin.
// No DOM / Pixi imports.

import type { Galaxy } from '../sim/galaxy';
import type { BuiltObject } from '../sim/builtObject';
import type { StellarObject } from '../sim/logistics/contracts';
import { createTradeFlowLedger, disableTradeFlowRecording, enableTradeFlowRecording, setRemoteTradeFlows, tradeFlowLedger, type FlowEntry, type TradeFlowLedger } from '../sim/logistics/tradeFlows';
import { galaxyStarDate } from '../sim/tick/simTime';

/** Key of the ledger view in the side-tables root (sync id 1). restoreSideTables ignores unknown keys. */
export const TRADE_FLOWS_SIDE_KEY = 'tradeFlows';

/** Most ticks between two refreshes of the view's version / freighter destinations while contracts keep coming. */
export const REFRESH_TICKS = 15;

/** What travels: the TradeFlowLedger shape, with a Map in place of the freighter WeakMap. */
export interface TradeFlowSyncView {
    entries: FlowEntry[];
    index: Map<StellarObject, Map<StellarObject, Map<number, FlowEntry>>>;
    freighterDestination: Map<BuiltObject, StellarObject>;
    version: number;
    startStarDate: number;
}

/** Worker side: recording on the authoritative galaxy and the side-table view of its ledger. */
export class TradeFlowSyncSource {
    private recording = false;
    private view: TradeFlowSyncView | null = null;
    private viewOf: TradeFlowLedger | null = null;
    private ticksSinceRefresh = 0;

    constructor(
        private readonly galaxy: Galaxy,
        /** Sets (or clears, with null) the view in the side-tables root. */
        private readonly publish: (view: TradeFlowSyncView | null) => void,
    ) {}

    get isRecording(): boolean {
        return this.recording;
    }

    /** The main thread's toggle. The ledger starts at the worker's own star date (in-thread: the overlay's). */
    setRecording(on: boolean): void {
        if (on === this.recording) return;
        this.recording = on;
        if (on) enableTradeFlowRecording(this.galaxy, galaxyStarDate(this.galaxy));
        else disableTradeFlowRecording(this.galaxy);
        this.refresh(true);
    }

    /** Before each delta: keep the view current (cheap unless the ledger changed). */
    refresh(force = false): void {
        this.ticksSinceRefresh++;
        const ledger = this.recording ? tradeFlowLedger(this.galaxy) : null;
        if (ledger === null) {
            if (this.view !== null) {
                this.view = null;
                this.viewOf = null;
                this.publish(null);
            }
            return;
        }
        if (this.viewOf !== ledger || this.view === null) {
            this.view = { entries: ledger.entries, index: new Map(), freighterDestination: new Map(), version: -1, startStarDate: ledger.startStarDate };
            this.viewOf = ledger;
            this.publish(this.view);
            force = true;
        }
        const v = this.view;
        if (v.version === ledger.version) return;
        if (!force && this.ticksSinceRefresh < REFRESH_TICKS) return;
        this.ticksSinceRefresh = 0;
        v.version = ledger.version;
        v.startStarDate = ledger.startStarDate;
        fillFreighterDestinations(this.galaxy, ledger.freighterDestination, v.freighterDestination);
    }

    dispose(): void {
        if (this.recording) disableTradeFlowRecording(this.galaxy);
        this.recording = false;
        this.view = null;
        this.viewOf = null;
    }
}

/**
 * The live freighters with open contracts and their latest contract destination (the overlay's leader set:
 * render/freightOverlay.ts buildLeaders), refilled in place. Destroyed ships and finished contracts drop out, so the
 * synced Map never keeps a dead ship reachable.
 */
export function fillFreighterDestinations(galaxy: Galaxy, dest: WeakMap<BuiltObject, StellarObject>, out: Map<BuiltObject, StellarObject>): void {
    out.clear();
    for (const bo of galaxy.builtObjects) {
        if (bo === null || bo === undefined || bo.hasBeenDestroyed || bo.contractsToFulfill.length === 0) continue;
        const d = dest.get(bo);
        if (d !== undefined) out.set(bo, d);
    }
}

/** Main side: the replica galaxy's ledger hooks. */
export class ReplicaTradeFlows {
    private wanted = false;
    private placeholder: TradeFlowLedger | null = null;
    /** The synced view seen when recording was switched off: ignored until a new one replaces it. */
    private stale: object | null = null;

    constructor(
        private readonly galaxy: Galaxy,
        /** The side-tables root as the replica holds it (null before the snapshot). */
        private readonly sideRoot: () => Record<string, unknown> | null,
        private readonly post: (record: boolean) => void,
    ) {
        setRemoteTradeFlows(galaxy, {
            setRecording: (on, start) => this.setRecording(on, start),
            ledger: () => this.ledger(),
        });
    }

    private synced(): TradeFlowLedger | null {
        const v = this.sideRoot()?.[TRADE_FLOWS_SIDE_KEY];
        if (v === undefined || v === null || typeof v !== 'object' || v === this.stale) return null;
        return v as unknown as TradeFlowLedger;
    }

    setRecording(on: boolean, startStarDate: number): void {
        if (on === this.wanted) return;
        this.wanted = on;
        if (on) {
            this.placeholder = createTradeFlowLedger(startStarDate);
        } else {
            this.stale = this.synced();
            this.placeholder = null;
        }
        this.post(on);
    }

    ledger(): TradeFlowLedger | null {
        if (!this.wanted) return null;
        const s = this.synced();
        if (s !== null) {
            this.placeholder = null;
            this.stale = null;
            return s;
        }
        return this.placeholder;
    }

    dispose(): void {
        setRemoteTradeFlows(this.galaxy, null);
    }
}
