// Hot seat (multiplayer Phase 2, docs/MULTIPLAYER.md §7): several humans take turns at one PC. Not in the original.
//
// - "Switch Player" (a top-bar button, shown only while the game has more than one human, and Ctrl+Shift+H) moves the
//   local viewer (src/localViewer.ts) to the next human in galaxy.humanEmpires order.
// - Between players a full-screen curtain ("Player 2 — <empire> · click to continue") hides the map, so nobody sees
//   another player's empire. The game is paused while the curtain is up and goes back to its own pause state after.
// - Screens that read localViewerEmpire re-render for the new viewer (onLocalViewerChange listeners); the host's
//   onSwitched clears the selection and centres the camera on the new viewer's capital.
// - A save remembers whose turn it is (GameSaveJSON.localViewer, written only with more than one human); a loaded
//   hot-seat game opens on that player's curtain.
//
// Main thread only. The sim never reads any of this.

import type { Empire } from '../sim/empire';
import type { Galaxy } from '../sim/galaxy';
import { humanEmpires, setHumanEmpires } from '../sim/humanEmpires';
import type { GameSaveExtras } from '../sim/save/gameSave';
import { savedLocalViewer } from '../sim/save/gameSave';
import { localViewerEmpire, switchLocalViewerEmpire } from '../localViewer';
import './hotSeat.css';

/** The switch hotkey (not in the key-binding table: no original binding to port). */
export const HOT_SEAT_HOTKEY_LABEL = 'Ctrl+Shift+H';

function isHotkey(e: KeyboardEvent): boolean {
    return e.ctrlKey && e.shiftKey && !e.altKey && (e.code === 'KeyH' || e.key.toLowerCase() === 'h');
}

/** The local viewer's index in galaxy.humanEmpires (-1: not a human, e.g. a spectator). */
export function localViewerIndex(galaxy: Galaxy): number {
    const v = localViewerEmpire(galaxy);
    return v === null ? -1 : humanEmpires(galaxy).indexOf(v);
}

/** The human after the local viewer (wrapping), or null when the game has fewer than two humans. */
export function nextHuman(galaxy: Galaxy): Empire | null {
    const humans = humanEmpires(galaxy);
    if (humans.length < 2) return null;
    const i = localViewerIndex(galaxy);
    return humans[(i + 1) % humans.length];
}

/** What a save of this game carries for the hot seat: the viewer's index, only with more than one human. */
export function hotSeatSaveExtras(galaxy: Galaxy): GameSaveExtras | undefined {
    if (humanEmpires(galaxy).length < 2) return undefined;
    const i = localViewerIndex(galaxy);
    return i < 0 ? undefined : { localViewer: i };
}

/**
 * Dev hook (`?hotSeatDev=1`, in-thread sim only): make the first AI empire (galaxy.empires order, not the player) a
 * second human, so the switch and the curtain can be tried before createGame takes N humans. Not for real games: the
 * empire was set up as an AI one.
 */
export function applyHotSeatDevHumans(galaxy: Galaxy): void {
    const player = galaxy.playerEmpire;
    if (player === null) return;
    const other = galaxy.empires.find((e) => e !== player && e.pirateEmpireBaseHabitat === null);
    if (other !== undefined) setHumanEmpires(galaxy, [player, other]);
}

// A loaded save's viewer index, read from its tail before the game view boots (main.ts loadSaveWithProgress) and
// applied by installHotSeat once the galaxy (and its humanEmpires side table) is in place.
let pendingSavedViewer: number | undefined;

/** Remember the local viewer of the save being loaded (`tail`: the last 4096 characters of its text). */
export function rememberSavedLocalViewer(tail: string): void {
    pendingSavedViewer = savedLocalViewer(tail);
}

export interface HotSeatHost {
    galaxy: Galaxy;
    /** The game clock (GalaxyTime): paused while the curtain is up. */
    clock: { paused: boolean };
    /** The HUD's top-left bar (pnlTopLeftBar), where the Switch Player button goes. */
    topBar: HTMLElement | null | undefined;
    /** After the viewer changed (behind the curtain): drop the selection, centre the camera, ... */
    onSwitched?: (viewer: Empire) => void;
}

export interface HotSeatRefs {
    /** Hand the screen to the next human (curtain + pause). No-op with fewer than two humans. */
    switchToNext: () => void;
    /** Show the curtain for the current viewer (a new or loaded hot-seat game). */
    showCurtain: () => void;
    destroy: () => void;
}

/** Wire the hot seat into a running game view. Harmless in a single-player game (the button stays hidden). */
export function installHotSeat(host: HotSeatHost): HotSeatRefs {
    const { galaxy, clock } = host;
    let curtain: HTMLDivElement | null = null;
    let pausedBefore = false;

    // The top-bar button: right of Play/Pause in the top-left strip (original pixels; the strip scales it).
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sel-glass top-glass top-btn hotseat-switch-btn';
    btn.dataset.ctl = 'btnHotSeatSwitch';
    btn.style.left = '96px';
    btn.style.top = '62px';
    btn.style.width = '118px';
    btn.style.height = '34px';
    btn.style.borderRadius = '7px';
    btn.addEventListener('click', () => switchToNext());
    host.topBar?.appendChild(btn);

    function paintButton(): void {
        const next = nextHuman(galaxy);
        btn.hidden = next === null;
        if (next === null) return;
        const n = humanEmpires(galaxy).indexOf(next) + 1;
        const label = `Switch Player`;
        if (btn.textContent !== label) btn.textContent = label;
        const title = `Hand the screen to player ${n} (${next.name}) — ${HOT_SEAT_HOTKEY_LABEL}`;
        if (btn.title !== title) btn.title = title;
    }
    paintButton();
    // The human set is fixed after the start, but a loaded save / the dev hook can set it after the view booted.
    const paintTimer = setInterval(paintButton, 1000);

    function showCurtain(): void {
        const viewer = localViewerEmpire(galaxy);
        if (viewer === null) return;
        if (curtain === null) {
            pausedBefore = clock.paused;
            curtain = document.createElement('div');
            curtain.className = 'hotseat-curtain';
            curtain.tabIndex = -1;
            curtain.addEventListener('click', () => hideCurtain());
            document.body.appendChild(curtain);
        }
        clock.paused = true;
        const n = humanEmpires(galaxy).indexOf(viewer) + 1;
        const colour = `#${viewer.mainColor.toString(16).padStart(6, '0')}`;
        curtain.replaceChildren();
        const card = document.createElement('div');
        card.className = 'hotseat-curtain-card';
        card.style.borderColor = colour;
        const title = document.createElement('div');
        title.className = 'hotseat-curtain-title';
        title.textContent = `Player ${n} — click to continue`;
        const name = document.createElement('div');
        name.className = 'hotseat-curtain-empire';
        const swatch = document.createElement('span');
        swatch.className = 'hotseat-curtain-swatch';
        swatch.style.background = colour;
        name.append(swatch, document.createTextNode(viewer.name));
        const hint = document.createElement('div');
        hint.className = 'hotseat-curtain-hint';
        hint.textContent = 'The game is paused. Other players: please look away.';
        card.append(title, name, hint);
        curtain.appendChild(card);
        curtain.focus();
    }

    function hideCurtain(): void {
        if (curtain === null) return;
        curtain.remove();
        curtain = null;
        clock.paused = pausedBefore;
    }

    function switchToNext(): void {
        const next = nextHuman(galaxy);
        if (next === null) return;
        // The curtain goes up first, so the new viewer's empire is never drawn in front of the old one.
        showCurtain();
        switchLocalViewerEmpire(galaxy, next);
        host.onSwitched?.(next);
        showCurtain();
        paintButton();
    }

    // Capture phase: the hotkey before the game's key handler; while the curtain is up it swallows every key (Enter
    // or Space lifts it), so no hotkey reaches the hidden game.
    const onKey = (e: KeyboardEvent): void => {
        if (curtain !== null) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (e.type === 'keydown' && (e.key === 'Enter' || e.key === ' ')) hideCurtain();
            return;
        }
        if (e.type === 'keydown' && isHotkey(e) && nextHuman(galaxy) !== null) {
            e.preventDefault();
            e.stopImmediatePropagation();
            switchToNext();
        }
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);

    // A loaded hot-seat save: back to the player whose turn it was, behind their curtain.
    const saved = pendingSavedViewer;
    pendingSavedViewer = undefined;
    const humans = humanEmpires(galaxy);
    if (saved !== undefined && humans.length > 1) {
        const viewer = humans[saved];
        if (viewer !== undefined && viewer !== localViewerEmpire(galaxy)) {
            switchLocalViewerEmpire(galaxy, viewer);
            host.onSwitched?.(viewer);
        }
        showCurtain();
    } else if (humans.length > 1) {
        // A new hot-seat game: player 1's curtain first.
        showCurtain();
    }

    return {
        switchToNext,
        showCurtain,
        destroy: () => {
            clearInterval(paintTimer);
            window.removeEventListener('keydown', onKey, true);
            window.removeEventListener('keyup', onKey, true);
            btn.remove();
            curtain?.remove();
            curtain = null;
        },
    };
}
