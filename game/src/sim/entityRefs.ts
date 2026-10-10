// Stable ids for the sim objects a player command names (not in the C#: its UI holds the objects). The command-log codec
// (player/commandCodec.ts) used to name a fleet, a design, a character, a troop or a habitat by its position in a list;
// a command applied later (the next frame boundary, or `inputDelay` frames later under lockstep, docs/MULTIPLAYER.md §8)
// could then hit another object when the list changed in between. These objects now carry `refId`, unique in the galaxy,
// from one counter on the galaxy (Galaxy.nextEntityRefId); the codec names them by it.
//
// Ids are assigned by a deterministic sweep, never in a constructor (the UI builds drafts — a design being edited — that
// must not move the counter): every object in the swept lists that has no id gets the next one, in list order. The sweep
// runs at fixed sim points only, the same in live play, replays and on every lockstep peer:
// - the end of every sim frame (tick/scheduler.ts runSimFrame) and after every applied player command
//   (player/playerCommands.ts applyOp): fleets, designs, characters and troops of every empire (flatEmpireList order);
// - habitats, which are created only at galaxy generation and by AddHabitat / AddAsteroidField: at the end of createGame,
//   at those two calls (galaxy.ts), at load, and by the sweep above when galaxy.habitats changed length (a galaxy built
//   without createGame).
// The player-command path also sweeps before it encodes or decodes a journaled command (playerCommands.ts), the same
// live and in a replay.
// A save keeps the ids and the counter. A save from before the ids gets them at load, in sweep order (galaxySave.ts),
// and its command log gets a 'refids' entry so that a replay from the seed renumbers at that boundary the same way
// (resetEntityRefIds).
//
// The ids are not read by the sim and are not in the state digest. Headless: no DOM / Pixi. Never touches galaxy.rnd.

import type { Galaxy } from './galaxy';
import type { Empire } from './empire';

/** An object that can carry a stable ref id (ShipGroup, Design, Character, Troop, Habitat). */
export interface RefIdHolder {
    refId?: number;
}

/** The object's ref id, or -1 when it has none (a draft, or created since the last sweep). */
export function entityRefId(o: object): number {
    const id = (o as RefIdHolder).refId;
    return typeof id === 'number' && id > 0 ? id : -1;
}

function nextId(galaxy: Galaxy): number {
    if (typeof galaxy.nextEntityRefId !== 'number' || !(galaxy.nextEntityRefId >= 1)) galaxy.nextEntityRefId = 1;
    return galaxy.nextEntityRefId++;
}

/** Give `o` the next ref id unless it has one. */
export function assignEntityRefId(galaxy: Galaxy, o: object): void {
    if (entityRefId(o) < 0) (o as RefIdHolder).refId = nextId(galaxy);
}

function sweepList(galaxy: Galaxy, list: readonly unknown[] | null | undefined): void {
    if (list == null) return;
    for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (o == null || typeof o !== 'object') continue;
        const id = (o as RefIdHolder).refId;
        if (!(typeof id === 'number' && id > 0)) (o as RefIdHolder).refId = nextId(galaxy);
    }
}

function empireLists(e: Empire): (readonly unknown[] | null | undefined)[] {
    return [e.shipGroups, e.designs, e.characters, e.troops?.items];
}

function flatEmpires(galaxy: Galaxy): Empire[] {
    // save/galaxySave.ts flatEmpireList (not imported: the tick path must not pull in the save module).
    const list = [...galaxy.empires, ...galaxy.pirateEmpires];
    if (galaxy.independentEmpire !== null) list.push(galaxy.independentEmpire);
    return list;
}

const sweptHabitatCount = new WeakMap<Galaxy, number>();

/**
 * Fleets, designs, characters and troops of every empire without an id get one (see the file header); habitats too when
 * galaxy.habitats changed length since the last sweep (a galaxy built without createGame, e.g. a test's).
 */
export function assignEntityRefIds(galaxy: Galaxy): void {
    if (sweptHabitatCount.get(galaxy) !== galaxy.habitats.length) assignHabitatRefIds(galaxy);
    for (const e of flatEmpires(galaxy)) {
        sweepList(galaxy, e.shipGroups);
        sweepList(galaxy, e.designs);
        sweepList(galaxy, e.characters);
        sweepList(galaxy, e.troops?.items);
    }
}

/** Every habitat without an id gets one, in galaxy.habitats order. */
export function assignHabitatRefIds(galaxy: Galaxy): void {
    sweepList(galaxy, galaxy.habitats);
    sweptHabitatCount.set(galaxy, galaxy.habitats.length);
}

/** Both sweeps (end of createGame, load). */
export function assignAllEntityRefIds(galaxy: Galaxy): void {
    assignHabitatRefIds(galaxy);
    assignEntityRefIds(galaxy);
}

/** Whether no object in the swept lists has an id and the counter is unset (a save from before the ids). */
export function lacksEntityRefIds(galaxy: Galaxy): boolean {
    if (typeof galaxy.nextEntityRefId === 'number' && galaxy.nextEntityRefId >= 1) return false;
    for (const h of galaxy.habitats) if (h != null && entityRefId(h) > 0) return false;
    for (const e of flatEmpires(galaxy)) for (const l of empireLists(e)) if (l != null) for (const o of l) if (o != null && typeof o === 'object' && entityRefId(o) > 0) return false;
    return true;
}

/**
 * Renumber as a load of a save from before the ids does ('refids' command-log entry): drop every id in the swept lists,
 * restart the counter and run both sweeps.
 */
export function resetEntityRefIds(galaxy: Galaxy): void {
    const drop = (l: readonly unknown[] | null | undefined): void => {
        if (l != null) for (const o of l) if (o != null && typeof o === 'object') delete (o as RefIdHolder).refId;
    };
    drop(galaxy.habitats);
    for (const e of flatEmpires(galaxy)) for (const l of empireLists(e)) drop(l);
    galaxy.nextEntityRefId = 1;
    assignAllEntityRefIds(galaxy);
}
