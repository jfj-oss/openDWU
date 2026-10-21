// The Intelligence screen's quiet notice (ui/intelWatch.ts) as sim state: a stock message (ticker and history, no popup) to
// the issuing empire. The UI never writes a message itself: it issues the journaled player command intelNotice, so the
// worker / multiplayer copies of the galaxy stay identical (a UI-side sendEmpireMessage stalled the sim worker).

import { BuiltObject } from '../builtObject';
import type { Empire } from '../empire';
import type { Galaxy } from '../galaxy';
import { EmpireMessage, EmpireMessageType, sendEmpireMessage } from '../messages';
import { galaxyStarDate } from '../tick/simTime';
import { Habitat } from '../types';

/** The go-to subject a notice may carry: a world or a ship (anything else is dropped: the command log cannot carry it). */
export function intelNoticeTarget(target: unknown): Habitat | BuiltObject | null {
    return target instanceof Habitat || target instanceof BuiltObject ? target : null;
}

export function sendIntelNoticeMessage(galaxy: Galaxy, empire: Empire, text: string, target: Habitat | BuiltObject | null): boolean {
    const m = new EmpireMessage(null, EmpireMessageType.GeneralNeutralEvent, target);
    m.title = 'Intelligence';
    m.description = text;
    m.starDate = galaxyStarDate(galaxy);
    m.supressPopup = true;
    sendEmpireMessage(m, empire);
    return true;
}
