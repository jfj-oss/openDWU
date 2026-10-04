// The UI's copy of this game's message options (Game.DisplayPopup* / DisplayMessage* / SuppressAllPopups) and the
// routing rules it draws with. The rules and the game's own options are sim state now (sim/messageRouting.ts,
// Galaxy.messageOptions): the player's message pipeline runs in the sim tick (sim/playerMessages.ts) and decides from
// the game's options what is stamped and recorded. This mirror is what the Game Options window edits and what the UI
// reads for what it shows (popup sounds, the suppress-all flag); every change also goes to the game as the journaled
// setMessageOptions command (ui/screens/gameOptionsPanel.ts), and a game view adopts its game's options when it starts
// (adoptGameMessageOptions). No DOM.

import { copyMessageOptions, defaultMessageOptions, galaxyMessageOptions, type MessageCategory, type MessageOptions } from '../sim/messageRouting';
import type { Galaxy } from '../sim/galaxy';

export * from '../sim/messageRouting';

let options: MessageOptions = defaultMessageOptions();

/** The UI's message options (the game's, once a game view adopted them; edits in the Game Options window). */
export function getMessageOptions(): MessageOptions {
    return options;
}

export function setMessageOption(kind: 'popup' | 'ticker', category: MessageCategory, value: boolean): void {
    options[kind][category] = value;
}

export function setSuppressAllPopups(v: boolean): void {
    options.suppressAllPopups = v;
}

export function resetMessageOptions(): void {
    options = defaultMessageOptions();
}

/** Take over another copy of the options (a copy is kept). */
export function replaceMessageOptions(o: MessageOptions): void {
    options = copyMessageOptions(o);
}

/** A game view starts: the UI shows and edits that game's options (C#: the Game object's Display* fields). */
export function adoptGameMessageOptions(galaxy: Galaxy): void {
    replaceMessageOptions(galaxyMessageOptions(galaxy));
}
