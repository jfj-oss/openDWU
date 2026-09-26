// Contract observation hook (task 19e-9, shared with 19a / 19c). NOT a port: DW:U has no such hook. It is called once
// at the end of logistics/contracts.ts initiateContract ($C/DistantWorlds.Types/Empire.4.cs:1135 InitiateContract),
// the one place the C# moves trade money (seller state + private income, buyer pays, space-port
// PerformFinancialTransaction, per-relation PerformTradeTransaction), after every Rnd draw of that path.
//
// Listener contract: no `galaxy.rnd` / cryptoRnd draws, ever. A listener that changes sim state (19a ledger, 19c
// tariff) must itself be gated by `scenarioFlag` and keep its state in `scenarioState`. With no listener registered
// the call site does nothing (`contractListenersActive()` is false), so plain games are bit-identical.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { StellarObject } from './contracts';

export interface ContractEvent {
    /** galaxyStarDate at initiation. */
    starDate: number;
    /** InitiateContract's `empire` (the seller). */
    seller: Empire;
    /** Trading post (Habitat or BuiltObject). */
    sellingPoint: StellarObject;
    /** requestingEmpire (never null here: initiateContract returns early). */
    buyer: Empire;
    /** order.requestingColony / requestingBuiltObject. */
    destination: StellarObject;
    /** -1 for component contracts. */
    resourceId: number;
    /** -1 for resource contracts. */
    componentId: number;
    /** contract.amountToFulfill (units). */
    amount: number;
    /** transactionAmount (credits the buyer pays). */
    value: number;
    isState: boolean;
    /** contract.freighter. */
    freighter: BuiltObject | null;
}

export interface ContractListener {
    id: string;
    run(galaxy: Galaxy, ev: ContractEvent): void;
}

/** Registered listeners, kept sorted by id (deterministic run order). */
const listeners: ContractListener[] = [];

/** Register (or replace, by id) a contract listener. Returns an unregister function. */
export function registerContractListener(l: ContractListener): () => void {
    const i = listeners.findIndex((x) => x.id === l.id);
    if (i >= 0) listeners[i] = l;
    else {
        listeners.push(l);
        listeners.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }
    return () => {
        const j = listeners.indexOf(l);
        if (j >= 0) listeners.splice(j, 1);
    };
}

/** True when at least one listener is registered (the call site skips building the event otherwise). */
export function contractListenersActive(): boolean {
    return listeners.length > 0;
}

/** Run every listener, in id order. */
export function emitContractInitiated(galaxy: Galaxy, ev: ContractEvent): void {
    for (let i = 0; i < listeners.length; i++) listeners[i].run(galaxy, ev);
}
