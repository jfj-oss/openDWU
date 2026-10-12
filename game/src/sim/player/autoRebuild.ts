// [auto-rebuild] Optional "Auto-rebuild lost ships / stations" for the human empires (Build Order screen). Both switches
// are off until the player turns them on (journaled command `setAutoRebuild`, per empire); with both off nothing here
// touches the game, so it plays exactly as the original.
//   - A state ship or base of a switched-on empire that is DESTROYED (combat; hasBeenDestroyed set before its teardown, not
//     scrapped, retired or unbuilt) is recorded as a loss (recordAutoRebuildLoss, called from builtObjectCompleteTeardown).
//     A ship or base the empire acquired from someone else (captured, traded, found) carries noAutoRebuild and is never
//     rebuilt, so a ship captured from us and recaptured is not "our" loss; a ship given away dies under another empire.
//   - processAutoRebuild (intermediate empire tick, ordered by loss order, no randomness of its own) replaces each loss:
//     ships through the stock BuildNewShips (Empire.6.cs 3017: shortest-wait space port / colony), stations by a free
//     automated construction ship with the stock AI Build mission (civilianAI.ts). The design is the lost one, or its
//     newest line upgrade (designLineUpgrade.ts), or the newest buildable of its sub-role. Unaffordable or not yet
//     possible: wait and retry; an invalid site (planet destroyed or lost, owned by another empire): skip with a message.
// Headless: no DOM / Pixi.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { Design } from '../design';
import type { BuiltObject } from '../builtObject';
import type { Habitat } from '../types';
import { BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { isHumanEmpire } from '../humanEmpires';

export interface AutoRebuildLoss {
    /** BuiltObjectID of the destroyed object (a second teardown of it is ignored). */
    id: number;
    station: boolean;
    design: Design;
    subRole: BuiltObjectSubRole;
    /** The habitat a base orbited (null: a free-space station such as a monitoring station). */
    habitat: Habitat | null;
    /** The habitat was the empire's own colony when the base was lost. */
    ownColony: boolean;
    offsetX: number;
    offsetY: number;
    x: number;
    y: number;
    lostAt: number;
    nextTry: number;
    attempts: number;
    /** The construction ship ordered to rebuild the station, and how many such bases the site had before. */
    builder: BuiltObject | null;
    basesBefore: number;
    waitNoted: boolean;
}

export interface AutoRebuildState {
    ships: boolean;
    stations: boolean;
    losses: AutoRebuildLoss[];
}

declare module '../empire' {
    interface Empire {
        /** [auto-rebuild] absent = both switches off (the original). */
        autoRebuild?: AutoRebuildState;
    }
}
declare module '../builtObject' {
    interface BuiltObject {
        /** [auto-rebuild] acquired by a human empire from elsewhere (capture, trade, find): never rebuilt as a loss. */
        noAutoRebuild?: boolean;
    }
}

const UNSET = -2000000000;

/** The `setAutoRebuild` player op. Turning a kind off forgets its pending losses. */
export function setAutoRebuild(galaxy: Galaxy, empire: Empire, kind: 'ships' | 'stations', on: boolean): boolean {
    if (!isHumanEmpire(galaxy, empire) || (kind !== 'ships' && kind !== 'stations')) return false;
    const st = (empire.autoRebuild ??= { ships: false, stations: false, losses: [] });
    st[kind] = on === true;
    if (!st[kind]) st.losses = st.losses.filter((l) => l.station !== (kind === 'stations'));
    return true;
}

/** Called at the start of builtObjectCompleteTeardown, before hasBeenDestroyed is set by the teardown itself. */
export function recordAutoRebuildLoss(galaxy: Galaxy, bo: BuiltObject): void {
    const empire = bo.empire;
    const st = empire?.autoRebuild;
    if (empire == null || st === undefined) return;
    if (!bo.hasBeenDestroyed || bo.scrap || bo.noAutoRebuild === true || bo.owner !== empire || bo.design === null || bo.unbuiltComponentCount > 0) return;
    if (!isHumanEmpire(galaxy, empire)) return;
    const station = bo.role === BuiltObjectRole.Base;
    if (station ? !st.stations : !st.ships) return;
    if (station && bo.parentBuiltObject !== null) return;
    if (st.losses.some((l) => l.id === bo.builtObjectID)) return;
    const habitat = station ? bo.parentHabitat : null;
    st.losses.push({
        id: bo.builtObjectID,
        station,
        design: bo.design,
        subRole: bo.subRole,
        habitat,
        ownColony: habitat !== null && habitat.empire === empire,
        offsetX: bo.parentOffsetX > UNSET ? bo.parentOffsetX : 0,
        offsetY: bo.parentOffsetY > UNSET ? bo.parentOffsetY : 0,
        x: bo.xpos,
        y: bo.ypos,
        lostAt: galaxy.nowMs,
        nextTry: 0,
        attempts: 0,
        builder: null,
        basesBefore: 0,
        waitNoted: false,
    });
}
