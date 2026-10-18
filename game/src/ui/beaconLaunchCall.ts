// The Beacon's launch-day call, UI side (Giantworks add-on, the Beacon; presentation only, never sim state): when the
// strike groups are called out (render/beaconLaunch.ts pollBeaconLaunch, from the state every client sees), every
// human player's camera is SENT to the Beacon — a short glide in to the closest zoom — to watch the relay fire its beam
// (render/beaconRelayFx.ts). The game is not paused. The camera is then left there. Any camera input during the glide
// (a pan, a zoom, an edge scroll: the camera moved from where the glide put it) hands control straight back; Escape
// skips the shot and returns the view to where it was. In multiplayer each client does this locally.
//
// ONE MINUTE (real time) after the FIRST call of the game an event pop-up, "The End Times", tells of the Reclamation
// beginning its harvest (the game's own event panel; the texts are the Giantworks GameText's "Beacon End Times"
// lines). Later seasons keep the sim's own news line ("Beacon Offensive News").

import type { Galaxy } from '../sim/galaxy';
import type { Camera } from '../render/camera';
import type { BuiltObject } from '../sim/builtObject';
import { galaxyStarDate } from '../sim/tick/simTime';
import { resolveStarDateDescription } from '../sim/galaxyTime';
import { tryGetText } from '../sim/textResolver';
import { pollBeaconLaunch, beaconLaunchState } from '../render/beaconLaunch';
import { LAUNCH, beaconCoreWorld } from '../render/beaconRelayFx';
import { stopFollow, type FollowState } from '../render/followCamera';
import { showEventMessagePopup } from './messagePopups';
import { BEACON_ART_DIR } from '../render/threatArt';

/** The glide in to the Beacon (s). */
export const CALL_GLIDE_S = 1.4;
/** A call older than this (s) when first seen is not flown to (the shot would miss the beam). */
export const CALL_LATE_S = 3;
/** The pop-up comes this long after the first call (real ms). */
export const END_TIMES_DELAY_MS = 60_000;
export const END_TIMES_TITLE_TAG = 'Beacon End Times Title';
export const END_TIMES_TEXT_TAG = 'Beacon End Times';
const END_TIMES_TITLE = 'The End Times';
const END_TIMES_TEXT =
    'The Beacon has fired. A pillar of light rose from its core into the dark, and every Reclaimer in the galaxy answered at once. Their strike groups are on the move. The Reclamation has begun its harvest: world by world, the living will be gathered and drained. It will not stop until the Beacon falls.';

function ease(t: number): number {
    const k = Math.max(0, Math.min(1, t));
    return k * k * (3 - 2 * k);
}

/** The camera at glide progress u from `from` to `to` (zoom eased in log space). Pure. */
export function glideView(from: { x: number; y: number; zoom: number }, to: { x: number; y: number; zoom: number }, u: number): { x: number; y: number; zoom: number } {
    const e = ease(u);
    return {
        x: from.x + (to.x - from.x) * e,
        y: from.y + (to.y - from.y) * e,
        zoom: Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * e),
    };
}

/** The pop-up's title and text (the Giantworks GameText's, else the built-in English). */
export function endTimesTexts(): { title: string; text: string } {
    return { title: tryGetText(END_TIMES_TITLE_TAG) ?? END_TIMES_TITLE, text: tryGetText(END_TIMES_TEXT_TAG) ?? END_TIMES_TEXT };
}

export interface BeaconLaunchCallDeps {
    galaxy: Galaxy;
    camera: Camera;
    followState?: FollowState;
}

export interface BeaconLaunchCall {
    /** Once per rendered frame. */
    frame(): void;
    /** A key went down: true when it was taken (Escape during the shot). */
    onKey(e: KeyboardEvent): boolean;
}

export function installBeaconLaunchCall(deps: BeaconLaunchCallDeps): BeaconLaunchCall {
    const { galaxy, camera } = deps;
    let heard = -1;
    let shot: { startMs: number; glide: boolean; from: { x: number; y: number; zoom: number }; to: { x: number; y: number; zoom: number }; last: { x: number; y: number; zoom: number } | null; until: number } | null = null;
    let popupAt: number | null = null;
    let popupBeacon: BuiltObject | null = null;
    let clockBeacon: BuiltObject | null = null;
    const endShot = (restore: boolean): void => {
        if (shot !== null && restore) {
            camera.zoomAt(shot.from.zoom, camera.width / 2, camera.height / 2);
            camera.centerOn(shot.from.x, shot.from.y);
        }
        shot = null;
    };
    return {
        frame(): void {
            if (beaconLaunchState(galaxy) === null && shot === null && popupAt === null) return;
            const now = performance.now();
            const clock = pollBeaconLaunch(galaxy, now);
            if (heard < 0) heard = clock.serial; // nothing replayed on install (pollBeaconLaunch already skips old launches)
            if (clock.serial > heard) {
                heard = clock.serial;
                const t = (now - clock.atMs) / 1000;
                const b = clock.beacon;
                clockBeacon = b;
                if (b !== null && !b.hasBeenDestroyed && t < CALL_LATE_S) {
                    if (deps.followState !== undefined) stopFollow(deps.followState);
                    const from = { x: camera.x, y: camera.y, zoom: camera.zoom };
                    shot = { startMs: now, glide: true, from, to: { x: b.xpos, y: b.ypos, zoom: camera.clampZoom(camera.maxZoom) }, last: null, until: clock.atMs + LAUNCH.end * 1000 };
                }
                if (clock.first) {
                    popupAt = clock.atMs + END_TIMES_DELAY_MS;
                    popupBeacon = b;
                }
            }
            if (shot !== null) {
                const s = shot;
                if (!s.glide) {
                    // arrived: the camera is the player's again; Escape still skips back until the beam is done
                    if (now > s.until) shot = null;
                } else if (s.last !== null && (Math.abs(camera.x - s.last.x) > 1e-3 || Math.abs(camera.y - s.last.y) > 1e-3 || Math.abs(camera.zoom - s.last.zoom) > 1e-9)) {
                    // camera input since the last frame: the player has taken control
                    shot = null;
                } else {
                    // aim at the core once the relay has been drawn (its frame centre until then)
                    const core = clockBeacon !== null ? beaconCoreWorld(clockBeacon) : null;
                    if (core !== null) {
                        s.to.x = core.x;
                        s.to.y = core.y;
                    }
                    const v = glideView(s.from, s.to, (now - s.startMs) / (CALL_GLIDE_S * 1000));
                    camera.zoomAt(v.zoom, camera.width / 2, camera.height / 2);
                    camera.centerOn(v.x, v.y);
                    s.last = { x: camera.x, y: camera.y, zoom: camera.zoom };
                    if (now - s.startMs >= CALL_GLIDE_S * 1000) s.glide = false;
                }
            }
            if (popupAt !== null && now >= popupAt) {
                popupAt = null;
                const { title, text } = endTimesTexts();
                const b = popupBeacon;
                popupBeacon = null;
                showEventMessagePopup({
                    title,
                    text,
                    imageUrl: `${BEACON_ART_DIR}beacon.png`,
                    footer: resolveStarDateDescription(galaxyStarDate(galaxy)),
                    onGoTo: b !== null && !b.hasBeenDestroyed ? () => camera.centerOn(b.xpos, b.ypos) : null,
                });
            }
        },
        onKey(e: KeyboardEvent): boolean {
            if (shot === null || e.key !== 'Escape') return false;
            endShot(true);
            return true;
        },
    };
}
