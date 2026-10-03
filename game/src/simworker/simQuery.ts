// Sim queries the UI runs on input that are not commands but still touch sim state: building the order menus and the
// selection panel's buttons draws galaxy.rnd (sim/player/orderMenu.ts: Galaxy.SelectRelativePoint and friends for the
// "Build here" designs, SelectRelativeHabitatSurfacePoint / SelectRelativeParkingPoint / DetermineOrbitalBaseLocation
// for the build buttons), exactly where the C# does (docs/sim-worker.md §9 chunk 5).
//
// In-thread the UI calls simQuery and gets the result at once (the callback runs synchronously, inside the call), so
// the draws happen where they always did. On a sim-worker replica the query goes to the worker (a remote query sink,
// clientCore.ts), which runs the same function on the authoritative galaxy in message order with the player's
// commands — so the authoritative galaxy.rnd draws the same values in the same order as in-thread play, and the
// command log and state stay the in-thread ones. The callback then runs on the main thread one round trip later, with
// the result's objects resolved to replica objects (by sync id).
//
// What belongs here: the UI-side sim calls that change sim state the way the C# UI does — galaxy.rnd draws, the
// Empire.latestDesigns cache the design lookups of the menus fill, the money panel's CheckAgeVariableIncome
// (treasury.ts moneyPanelIncome: Empire.useAveragedVariableIncome, the variable income ageing). On a replica those
// writes would be lost (the sync overwrites them, the worker never sees them). Like in-thread, a query is not journaled.
//
// No DOM / Pixi imports.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { Habitat } from '../sim/types';
import type { ShipAction } from '../sim/player/shipAction';
import type { ShipActionSelection } from '../sim/player/executeShipAction';
import { openActionMenu, selectionButtons } from '../sim/player/orderMenu';
import { habitatDispatchOptions } from '../sim/player/habitatDispatch';
import { moneyPanelIncome } from '../sim/treasury';
import { listProposals } from '../sim/player/diplomacyProposals';
import { calculatePirateProtectionPricePerMonth } from '../sim/pirates/pirateRelationsAI';
import { pirateMissionsPanelData } from '../sim/pirates/pirateMissionsPanel';

export const SIM_QUERIES = {
    /**
     * The right-click action menu (orderMenu.ts openActionMenu): `target` is what the view picked under the cursor (the
     * menu's pickAt), `hoverOrder` the default order there (resolveHoverOrder), `ctrl` Ctrl held.
     */
    actionMenu: (galaxy: Galaxy, empire: Empire, selected: ShipActionSelection, cursorX: number, cursorY: number, zoomFactor: number, target: unknown, hoverOrder: ShipAction | null, ctrl: boolean) =>
        openActionMenu({ galaxy, empire, selected, cursorX, cursorY, zoomFactor, pickAt: () => target }, hoverOrder, ctrl),
    /** The selection panel's eight action buttons for a page (orderMenu.ts selectionButtons). */
    selectionButtons: (galaxy: Galaxy, empire: Empire, selected: ShipActionSelection, page: ShipAction | null) => selectionButtons({ galaxy, empire, selected }, page),
    /** A selected habitat's dispatch buttons (habitatDispatch.ts habitatDispatchOptions). */
    habitatDispatch: (galaxy: Galaxy, empire: Empire, habitat: Habitat) => habitatDispatchOptions(galaxy, empire, habitat),
    /** The top-right money panel's Cashflow / Bonus Income (treasury.ts moneyPanelIncome; Main.Part11.cs 832 method_126,
     *  which runs CheckAgeVariableIncome on the empire). */
    moneyPanel: (galaxy: Galaxy, empire: Empire) => moneyPanelIncome(galaxy, empire),
    // [chunk 7] diplomacy (docs/sim-worker.md §9 chunk 7): sim reads the diplomacy screen shows that obtain records.
    /** The talk panel's conversation options (diplomacyProposals.ts listProposals; Main.Part9.cs:46 method_238 obtains
     *  the diplomatic / pirate relations it lists — Obtain* adds a NotMet record). */
    listProposals: (galaxy: Galaxy, empire: Empire, other: Empire) => listProposals(galaxy, empire, other),
    /** A pirate faction's price per month to protect `empire` (Empire.2.cs 2649 CalculatePirateProtectionPricePerMonth,
     *  which obtains the pirate's relation with the empire — ObtainPirateRelation adds a NotMet record). */
    pirateProtectionPrice: (galaxy: Galaxy, empire: Empire, pirate: Empire) => calculatePirateProtectionPricePerMonth(galaxy, pirate, empire).price,
    /** The left sidebar's Pirate Missions list and each row's "considering" count (pirates/pirateMissionsPanel.ts;
     *  BaconMain.cs PopulateListsOnLefthandSide and Galaxy.9.cs CountPirateEmpiresConsideringMission obtain pirate
     *  relations — ObtainPirateRelation adds a NotMet record). */
    pirateMissionsPanel: (galaxy: Galaxy, empire: Empire, statusToggle: number, typeToggle: number) => pirateMissionsPanelData(galaxy, empire, statusToggle, typeToggle),
};

type Queries = typeof SIM_QUERIES;
export type SimQueryName = keyof Queries;
type Tail<T extends unknown[]> = T extends [unknown, unknown, ...infer R] ? R : never;
/** The query's arguments after (galaxy, empire). */
export type SimQueryArgs<K extends SimQueryName> = Tail<Parameters<Queries[K]>>;
export type SimQueryResult<K extends SimQueryName> = ReturnType<Queries[K]>;

/** Where a replica galaxy's queries go (the sim worker); `done` gets the result once the worker answered. */
export type RemoteQuerySink = (empire: Empire, op: SimQueryName, args: unknown[], done: (result: unknown) => void) => void;
const sinks = new WeakMap<Galaxy, RemoteQuerySink>();

/** Route `galaxy`'s queries to `sink` (a sim-worker replica), or back to running them here (null). */
export function setRemoteQuerySink(galaxy: Galaxy, sink: RemoteQuerySink | null): void {
    if (sink === null) sinks.delete(galaxy);
    else sinks.set(galaxy, sink);
}

/** Whether `galaxy`'s queries answer later (a sim-worker replica) rather than inside the simQuery call. */
export function isRemoteQueryGalaxy(galaxy: Galaxy): boolean {
    return sinks.has(galaxy);
}

/** Run a query directly on `galaxy` (in-thread, or in the worker on the authoritative galaxy). */
export function runSimQuery<K extends SimQueryName>(galaxy: Galaxy, empire: Empire, op: K, args: SimQueryArgs<K>): SimQueryResult<K> {
    const fn = SIM_QUERIES[op] as unknown as (g: Galaxy, e: Empire, ...a: unknown[]) => SimQueryResult<K>;
    if (fn === undefined) throw new Error(`sim query: unknown op ${String(op)}`);
    return fn(galaxy, empire, ...(args as unknown[]));
}

/**
 * Run a query for the UI. In-thread `done` runs synchronously, inside this call (the code after the call runs after
 * it); on a sim-worker replica it runs later on the main thread, once the worker answered (not at all when the worker
 * could not run it, e.g. an argument left the game).
 */
export function simQuery<K extends SimQueryName>(galaxy: Galaxy, empire: Empire, op: K, args: SimQueryArgs<K>, done: (result: SimQueryResult<K>) => void): void {
    const remote = sinks.get(galaxy);
    if (remote !== undefined) {
        remote(empire, op, args as unknown[], done as (r: unknown) => void);
        return;
    }
    done(runSimQuery(galaxy, empire, op, args));
}
