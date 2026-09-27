// 19i audio addendum — game glue for the synthesised creature calls and hull creaks. Reads the camera, the galaxy's
// creatures, the selected / nearest own ship and the rim weight (rimAtmosphereGeometry.ts rimWeightAt), feeds the
// pure scheduler (rimCreatureCalls.ts) and plays its events on a lazily-created synth bus (rimCreatureSynth.ts).
// Flag `rimAtmosphere` off or no scenario: step() returns before touching anything — no AudioContext is created.
// Presentation only: never draws Galaxy randomness, never writes sim state.

import type { Galaxy } from '../sim/galaxy';
import type { BuiltObject } from '../sim/builtObject';
import { scenarioFlag, scenarioParam } from '../sim/scenario/state';
import { checkInStorm } from '../sim/resourceTargets';
import { rimWeightAt } from './rimAtmosphereGeometry';
import {
    CREATURE_CALL_RANGE,
    creakNearRange,
    RIM_SOUND_DEFAULTS,
    RimSoundScheduler,
    type CallCandidate,
    type CreakCandidate,
    type RimSoundEvent,
    type RimSoundParams,
} from './rimCreatureCalls';
import { createRimSynthBus, playCreak, playCreatureCall, type RimSynthBus } from './rimCreatureSynth';

/** The camera as this module needs it (same shape as mainViewSounds.ts SoundView). */
export interface RimSoundView {
    x: number;
    y: number;
    zoom: number;
    width: number;
    height: number;
}

export function rimSoundParams(galaxy: Galaxy): RimSoundParams {
    return {
        creatureCallRate: scenarioParam(galaxy, 'creatureCallRate', RIM_SOUND_DEFAULTS.creatureCallRate),
        creakRate: scenarioParam(galaxy, 'creakRate', RIM_SOUND_DEFAULTS.creakRate),
        creatureCallGain: scenarioParam(galaxy, 'creatureCallGain', RIM_SOUND_DEFAULTS.creatureCallGain),
        creakGain: scenarioParam(galaxy, 'creakGain', RIM_SOUND_DEFAULTS.creakGain),
    };
}

/** BaconMainView travel-vector test (overlayLayer.ts travelVectorFor): a ship at warp or preparing to jump. */
export function isHyperjumping(bo: BuiltObject): boolean {
    return bo.warpSpeed > 0 && (bo.currentSpeed > bo.topSpeed || bo.hyperjumpPrepare || bo.hyperjumpAboutToEnter);
}

/** Creatures within CREATURE_CALL_RANGE of the camera centre (herds included: they are Creatures on the galaxy). */
export function callCandidates(galaxy: Galaxy, view: RimSoundView): CallCandidate[] {
    const out: CallCandidate[] = [];
    const r2 = CREATURE_CALL_RANGE * CREATURE_CALL_RANGE;
    for (const c of galaxy.creatures) {
        if (c.hasBeenDestroyed) continue;
        const dx = c.xpos - view.x;
        const dy = c.ypos - view.y;
        if (dx * dx + dy * dy >= r2) continue;
        out.push({ key: c, type: c.type, dx, dy, rimWeight: rimWeightAt(galaxy, c.xpos, c.ypos) });
    }
    return out;
}

/** The ship whose hull may creak: the selected ship if it is near the camera, else the nearest own ship that is. */
export function creakCandidate(galaxy: Galaxy, view: RimSoundView, selected: BuiltObject | null): CreakCandidate | null {
    const halfDiag = Math.sqrt((view.width / 2) ** 2 + (view.height / 2) ** 2) / view.zoom;
    const near = creakNearRange(halfDiag);
    const near2 = near * near;
    const d2 = (bo: BuiltObject): number => (bo.xpos - view.x) ** 2 + (bo.ypos - view.y) ** 2;
    let ship: BuiltObject | null = null;
    if (selected !== null && !selected.hasBeenDestroyed && d2(selected) <= near2) ship = selected;
    const player = galaxy.playerEmpire;
    if (ship === null && player !== null) {
        let best = near2;
        for (const bo of galaxy.builtObjects) {
            if (bo === null || bo === undefined || bo.hasBeenDestroyed || bo.empire !== player) continue;
            const d = d2(bo);
            if (d <= best) {
                best = d;
                ship = bo;
            }
        }
    }
    if (ship === null) return null;
    return {
        key: ship,
        dx: ship.xpos - view.x,
        dy: ship.ypos - view.y,
        nearRange: near,
        conditions: { inStorm: checkInStorm(galaxy, ship.xpos, ship.ypos), hyperjumping: isHyperjumping(ship), rimWeight: rimWeightAt(galaxy, ship.xpos, ship.ypos) },
    };
}

/** How often the (galaxy-walking) creak candidate is re-evaluated. */
const CREAK_REFRESH_S = 0.5;

export interface RimCreatureAudioDeps {
    galaxy: Galaxy;
    view: RimSoundView;
    /** The selected ship (Main View selection), or null. */
    selectedShip: () => BuiltObject | null;
    /** The effects volume 0..1 (0 when muted). */
    effectsVolume: () => number;
    /** The shared rim audio context, created on first call (the ambient bed shares it). */
    context: () => AudioContext;
    rand?: () => number;
}

/** One per game view: step() once per rendered frame, dispose() with the audio graph. */
export class RimCreatureAudio {
    private readonly scheduler = new RimSoundScheduler();
    private bus: RimSynthBus | null = null;
    private lastNowS: number | null = null;
    private creakCache: { at: number; value: CreakCandidate | null } | null = null;
    private readonly rand: () => number;

    constructor(private readonly deps: RimCreatureAudioDeps) {
        this.rand = deps.rand ?? Math.random;
    }

    /** `nowS`: a monotonic wall clock in seconds; `cameraRimWeight`: rimWeightAt at the camera centre. */
    step(nowS: number, cameraRimWeight: number): RimSoundEvent[] {
        const { galaxy, view } = this.deps;
        if (!scenarioFlag(galaxy, 'rimAtmosphere')) return [];
        const dt = this.lastNowS === null ? 0 : nowS - this.lastNowS;
        this.lastNowS = nowS;
        const events = this.scheduler.step(
            {
                enabled: true,
                zoomFactor: 1 / view.zoom,
                cameraRimWeight,
                effectsVolume: this.deps.effectsVolume(),
                params: rimSoundParams(galaxy),
                candidates: () => callCandidates(galaxy, view),
                creak: () => {
                    if (this.creakCache === null || nowS - this.creakCache.at >= CREAK_REFRESH_S) {
                        this.creakCache = { at: nowS, value: creakCandidate(galaxy, view, this.deps.selectedShip()) };
                    }
                    return this.creakCache.value;
                },
            },
            nowS,
            dt,
            this.rand,
        );
        for (const e of events) this.play(e);
        return events;
    }

    private play(e: RimSoundEvent): void {
        try {
            if (this.bus === null) {
                const ctx = this.deps.context();
                this.bus = createRimSynthBus(ctx, ctx.destination, this.rand);
            }
            const ctx = this.bus.ctx as AudioContext;
            if (ctx.state === 'suspended') void ctx.resume();
            const t0 = ctx.currentTime + 0.02 + e.delayS;
            if (e.kind === 'call') playCreatureCall(this.bus, e.type, t0, e.pan, e.gain, this.rand);
            else playCreak(this.bus, t0, e.pan, e.gain, this.rand);
        } catch {
            // no Web Audio (tests / unsupported)
        }
    }

    dispose(): void {
        this.bus?.dispose();
        this.bus = null;
    }
}
