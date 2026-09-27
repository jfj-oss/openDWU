// 19i audio addendum: synthesised creature calls + hull creaks. Pure functions only (no AudioContext): the voice
// parameter tables, the trigger-rate / cooldown logic, the distance / pan / gain maths, and a flags-off no-op check
// through the game glue (rimCreatureAudio.ts) with a context factory that fails the test if it is ever called.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Galaxy } from '../src/sim/galaxy';
import { CreatureType } from '../src/sim/creature';
import { GalaxyScenario } from '../src/sim/scenario/state';
import { parseScenarioManifest } from '../src/sim/scenario/manifest';
import {
    CALL_CORE_RATE_FRACTION,
    CALL_MIN_GAP_S,
    CREAK_MIN_GAP_S,
    CREATURE_CALL_RANGE,
    CREATURE_COOLDOWN_S,
    CREAK_VOICE,
    RIM_SOUND_DEFAULTS,
    RimSoundScheduler,
    TYPE_COOLDOWN_S,
    callRatePerSecond,
    creakGainFor,
    creakIntensity,
    creakRatePerSecond,
    creatureCallGain,
    creatureVoice,
    directionPan,
    distanceGain,
    pickCallCandidate,
    seededRandom,
    triggerProbability,
    zoomAudibility,
    type CallCandidate,
    type CreakCandidate,
    type RimSoundFrame,
} from '../src/audio/rimCreatureCalls';
import { RimCreatureAudio, rimSoundParams } from '../src/audio/rimCreatureAudio';
import { signalStats } from '../src/audio/signalStats';

const ALL_TYPES = [CreatureType.Kaltor, CreatureType.RockSpaceSlug, CreatureType.DesertSpaceSlug, CreatureType.Ardilus, CreatureType.SilverMist];

describe('19i audio: per-type voice tables', () => {
    it('every creature type has its own voice kind; Undefined is silent', () => {
        expect(creatureVoice(CreatureType.Kaltor)?.kind).toBe('bellow');
        expect(creatureVoice(CreatureType.RockSpaceSlug)?.kind).toBe('clickChirp');
        expect(creatureVoice(CreatureType.DesertSpaceSlug)?.kind).toBe('clickChirp');
        expect(creatureVoice(CreatureType.Ardilus)?.kind).toBe('keen');
        expect(creatureVoice(CreatureType.SilverMist)?.kind).toBe('shimmer');
        expect(creatureVoice(CreatureType.Undefined)).toBeNull();
    });

    it('durations match the design (kaltor 1.5–3 s, creak 0.4–1.5 s) and ranges are ordered', () => {
        expect(creatureVoice(CreatureType.Kaltor)!.durationS).toEqual([1.5, 3.0]);
        expect(CREAK_VOICE.durationS).toEqual([0.4, 1.5]);
        for (const t of ALL_TYPES) {
            const v = creatureVoice(t)!;
            expect(v.durationS[0]).toBeGreaterThan(0);
            expect(v.durationS[1]).toBeGreaterThanOrEqual(v.durationS[0]);
            expect(v.level).toBeGreaterThan(0);
            expect(v.level).toBeLessThanOrEqual(1);
            expect(v.reverbSend).toBeGreaterThanOrEqual(0);
            expect(v.reverbSend).toBeLessThanOrEqual(1);
        }
    });

    it('pitch registers: kaltor low, ardilus high, mist highest; slugs differ rock vs desert', () => {
        const k = creatureVoice(CreatureType.Kaltor)!;
        const a = creatureVoice(CreatureType.Ardilus)!;
        const m = creatureVoice(CreatureType.SilverMist)!;
        const rock = creatureVoice(CreatureType.RockSpaceSlug)!;
        const desert = creatureVoice(CreatureType.DesertSpaceSlug)!;
        if (k.kind !== 'bellow' || a.kind !== 'keen' || m.kind !== 'shimmer' || rock.kind !== 'clickChirp' || desert.kind !== 'clickChirp') throw new Error('kind');
        expect(k.baseHz[1]).toBeLessThan(100);
        expect(k.formantsStartHz.length).toBe(k.formantQ.length);
        expect(k.formantsPeakHz.length).toBe(k.formantGain.length);
        expect(a.startHz[0]).toBeGreaterThan(500);
        expect(a.peakRatio[0]).toBeGreaterThan(1);
        expect(m.baseHz[0] * Math.min(...m.ratios)).toBeGreaterThan(a.startHz[0]);
        expect(m.partials[0]).toBeGreaterThanOrEqual(16);
        expect(desert.tickHz[0]).toBeGreaterThan(rock.tickHz[0]);
        expect(desert.gloopChance).toBeLessThan(rock.gloopChance);
        expect(CREAK_VOICE.bodyStartHz[1]).toBeLessThan(300);
        expect(CREAK_VOICE.dropRatio[1]).toBeLessThan(1);
        // Inharmonic ring (a free bar, not a harmonic series).
        expect(CREAK_VOICE.ringRatios.some((r) => Math.abs(r - Math.round(r)) > 0.2)).toBe(true);
    });
});

describe('19i audio: distance / pan / gain maths', () => {
    it('zoomAudibility: full at system zoom, silent at galaxy zoom, monotone between', () => {
        expect(zoomAudibility(1)).toBe(1);
        expect(zoomAudibility(30)).toBe(1);
        expect(zoomAudibility(65)).toBeCloseTo(0.5, 5);
        expect(zoomAudibility(100)).toBe(0);
        expect(zoomAudibility(1000)).toBe(0);
        expect(zoomAudibility(0)).toBe(0);
    });

    it('distanceGain: 1 at the centre, 0 at and past the range, decreasing', () => {
        expect(distanceGain(0, 1000)).toBe(1);
        expect(distanceGain(500, 1000)).toBeCloseTo(0.25, 10);
        expect(distanceGain(1000, 1000)).toBe(0);
        expect(distanceGain(5000, 1000)).toBe(0);
        expect(distanceGain(100, 0)).toBe(0);
    });

    it('directionPan: sign follows dx, near sources stay central, clamped to ±0.85', () => {
        expect(directionPan(0, 0, 1000)).toBe(0);
        expect(directionPan(1000, 0, 1000)).toBeCloseTo(0.85, 10);
        expect(directionPan(-1000, 0, 1000)).toBeCloseTo(-0.85, 10);
        expect(directionPan(0, 900, 1000)).toBeCloseTo(0, 10);
        expect(Math.abs(directionPan(30, 0, 1000))).toBeLessThan(0.1);
    });

    it('creatureCallGain: product of the terms, louder in the rim but not silent in the core', () => {
        const core = creatureCallGain(0.5, 0.7, 1, 1, 0);
        const rim = creatureCallGain(0.5, 0.7, 1, 1, 1);
        expect(rim).toBeCloseTo(0.35, 10);
        expect(core).toBeCloseTo(0.35 * 0.45, 10);
        expect(creatureCallGain(0.5, 0, 1, 1, 1)).toBe(0);
        expect(creatureCallGain(0.5, 0.7, 0, 1, 1)).toBe(0);
    });

    it('creakIntensity: storm > hyperjump > deep rim; nothing in the core', () => {
        expect(creakIntensity({ inStorm: false, hyperjumping: false, rimWeight: 0 })).toBe(0);
        expect(creakIntensity({ inStorm: false, hyperjumping: false, rimWeight: 0.5 })).toBe(0);
        expect(creakIntensity({ inStorm: false, hyperjumping: false, rimWeight: 0.75 })).toBeCloseTo(0.5, 10);
        expect(creakIntensity({ inStorm: false, hyperjumping: true, rimWeight: 0 })).toBe(0.8);
        expect(creakIntensity({ inStorm: true, hyperjumping: false, rimWeight: 0 })).toBe(1);
        expect(creakGainFor(0.4, 1, 1, 1, 1)).toBeCloseTo(0.4, 10);
        expect(creakGainFor(0.4, 1, 1, 1, 0)).toBeCloseTo(0.24, 10);
    });
});

describe('19i audio: trigger rates and cooldowns', () => {
    it('rates scale with the params and the rim weight; core keeps a small fraction', () => {
        expect(callRatePerSecond(0.3, 1)).toBeCloseTo(0.3 / 12, 10);
        expect(callRatePerSecond(0.3, 0) / callRatePerSecond(0.3, 1)).toBeCloseTo(CALL_CORE_RATE_FRACTION, 10);
        expect(callRatePerSecond(0, 1)).toBe(0);
        expect(creakRatePerSecond(0.4, 1)).toBeCloseTo(0.4 / 6, 10);
        expect(creakRatePerSecond(0.4, 0)).toBe(0);
        expect(triggerProbability(0, 1)).toBe(0);
        expect(triggerProbability(1, 0)).toBe(0);
        expect(triggerProbability(0.5, 0.016)).toBeCloseTo(1 - Math.exp(-0.008), 12);
    });

    it('pickCallCandidate skips cooling-down and silent candidates', () => {
        const a: CallCandidate = { key: 'a', type: CreatureType.Kaltor, dx: 0, dy: 0, rimWeight: 1 };
        const b: CallCandidate = { key: 'b', type: CreatureType.Ardilus, dx: 100, dy: 0, rimWeight: 1 };
        const u: CallCandidate = { key: 'u', type: CreatureType.Undefined, dx: 0, dy: 0, rimWeight: 1 };
        const far: CallCandidate = { key: 'f', type: CreatureType.Kaltor, dx: CREATURE_CALL_RANGE * 2, dy: 0, rimWeight: 1 };
        expect(pickCallCandidate([a, b], (c) => c.key === 'a', () => 0.0)).toBe(b);
        expect(pickCallCandidate([u, far], () => false, () => 0.5)).toBeNull();
        expect(pickCallCandidate([], () => false, () => 0.5)).toBeNull();
    });

    function frame(over: Partial<RimSoundFrame> = {}, candidates: CallCandidate[] = [], creak: CreakCandidate | null = null): RimSoundFrame {
        return { enabled: true, zoomFactor: 10, cameraRimWeight: 1, effectsVolume: 0.7, params: RIM_SOUND_DEFAULTS, candidates: () => candidates, creak: () => creak, ...over };
    }

    it('long-run call rate matches callRatePerSecond, and one creature never calls twice within its cooldown', () => {
        const s = new RimSoundScheduler();
        const rand = seededRandom(7);
        const creatures: CallCandidate[] = [
            { key: 1, type: CreatureType.Kaltor, dx: 1000, dy: 0, rimWeight: 1 },
            { key: 2, type: CreatureType.Ardilus, dx: -2000, dy: 500, rimWeight: 1 },
            { key: 3, type: CreatureType.SilverMist, dx: 0, dy: 3000, rimWeight: 1 },
            { key: 4, type: CreatureType.RockSpaceSlug, dx: 500, dy: 500, rimWeight: 1 },
        ];
        const f = frame({ params: { ...RIM_SOUND_DEFAULTS, creatureCallRate: 1 } }, creatures);
        const lastByKey = new Map<unknown, number>();
        const lastByType = new Map<CreatureType, number>();
        let lastAny = -Infinity;
        let calls = 0;
        const dt = 1 / 60;
        const seconds = 3600;
        for (let i = 0; i < seconds * 60; i++) {
            const now = i * dt;
            for (const e of s.step(f, now, dt, rand)) {
                if (e.kind !== 'call') continue;
                calls++;
                const k = lastByKey.get(e.key);
                if (k !== undefined) expect(now - k).toBeGreaterThanOrEqual(CREATURE_COOLDOWN_S);
                const t = lastByType.get(e.type);
                if (t !== undefined) expect(now - t).toBeGreaterThanOrEqual(TYPE_COOLDOWN_S);
                expect(now - lastAny).toBeGreaterThanOrEqual(CALL_MIN_GAP_S);
                expect(e.gain).toBeGreaterThan(0);
                expect(Math.abs(e.pan)).toBeLessThanOrEqual(0.85);
                lastByKey.set(e.key, now);
                lastByType.set(e.type, now);
                lastAny = now;
            }
        }
        // 1 / 12 s at full rim weight → ~300/hour, minus the min-gap dead time.
        expect(calls).toBeGreaterThan(220);
        expect(calls).toBeLessThan(340);
    });

    it('core calls are rarer than rim calls', () => {
        const count = (w: number): number => {
            const s = new RimSoundScheduler();
            const rand = seededRandom(3);
            const c: CallCandidate[] = [1, 2, 3, 4, 5, 6].map((k) => ({ key: k, type: ALL_TYPES[k % ALL_TYPES.length], dx: 100 * k, dy: 0, rimWeight: w }));
            let n = 0;
            for (let i = 0; i < 3600 * 30; i++) n += s.step(frame({ cameraRimWeight: w }, c), i / 30, 1 / 30, rand).length;
            return n;
        };
        const core = count(0);
        const rim = count(1);
        expect(core).toBeGreaterThan(0);
        expect(core).toBeLessThan(rim * 0.3);
    });

    it('creaks: only with a condition, min gap between events, some double creaks with a delay', () => {
        const ship = (inStorm: boolean): CreakCandidate => ({ key: 's', dx: 200, dy: 0, nearRange: 5000, conditions: { inStorm, hyperjumping: false, rimWeight: 0 } });
        const s = new RimSoundScheduler();
        const rand = seededRandom(11);
        let calm = 0;
        for (let i = 0; i < 600 * 30; i++) calm += s.step(frame({}, [], ship(false)), i / 30, 1 / 30, rand).length;
        expect(calm).toBe(0);
        let singles = 0;
        let doubles = 0;
        let last = -Infinity;
        for (let i = 0; i < 3600 * 30; i++) {
            const now = 600 + i / 30;
            const ev = s.step(frame({}, [], ship(true)), now, 1 / 30, rand);
            if (ev.length === 0) continue;
            expect(now - last).toBeGreaterThanOrEqual(CREAK_MIN_GAP_S);
            last = now;
            expect(ev[0].kind).toBe('creak');
            expect(ev[0].delayS).toBe(0);
            if (ev.length === 2) {
                doubles++;
                expect(ev[1].delayS).toBeGreaterThanOrEqual(0.3);
                expect(ev[1].delayS).toBeLessThanOrEqual(0.9);
                expect(ev[1].gain).toBeLessThan(ev[0].gain);
            } else singles++;
        }
        // 0.4 / 6 s → ~240/hour in a storm (minus the min gap); ~30 % doubles.
        expect(singles + doubles).toBeGreaterThan(160);
        expect(singles + doubles).toBeLessThan(260);
        expect(doubles / (singles + doubles)).toBeGreaterThan(0.18);
        expect(doubles / (singles + doubles)).toBeLessThan(0.42);
    });

    it('nothing at galaxy zoom, when muted, or with zero gains', () => {
        const c: CallCandidate[] = [{ key: 1, type: CreatureType.Kaltor, dx: 0, dy: 0, rimWeight: 1 }];
        const storm: CreakCandidate = { key: 's', dx: 0, dy: 0, nearRange: 5000, conditions: { inStorm: true, hyperjumping: false, rimWeight: 1 } };
        const rates = { ...RIM_SOUND_DEFAULTS, creatureCallRate: 2, creakRate: 2 };
        for (const over of [
            { zoomFactor: 500 },
            { effectsVolume: 0 },
            { params: { ...rates, creatureCallGain: 0, creakGain: 0 } },
            { enabled: false },
        ] as Partial<RimSoundFrame>[]) {
            const s = new RimSoundScheduler();
            const rand = seededRandom(5);
            let n = 0;
            for (let i = 0; i < 600 * 30; i++) n += s.step(frame({ params: rates, ...over }, c, storm), i / 30, 1 / 30, rand).length;
            expect(n).toBe(0);
        }
    });
});

describe('19i audio: flags-off no-op through the game glue', () => {
    const SYSTEMS = [{ systemStar: { xpos: 500, ypos: 500, systemIndex: 0 } }];
    const kaltor = { type: CreatureType.Kaltor, xpos: 500, ypos: 500, hasBeenDestroyed: false };
    for (const [name, scenario] of [
        ['no scenario', null],
        ['scenario without the flag', (() => {
            const s = new GalaxyScenario();
            s.flags = { rimAtmosphere: false };
            s.params = { creatureCallRate: 2, creakRate: 2 };
            return s;
        })()],
    ] as const) {
        it(`never creates an AudioContext or schedules anything (${name})`, () => {
            const galaxy = { scenario, systems: SYSTEMS, sizeX: 1000, sizeY: 1000, creatures: [kaltor], builtObjects: [], playerEmpire: null } as unknown as Galaxy;
            let asked = 0;
            const audio = new RimCreatureAudio({
                galaxy,
                view: { x: 500, y: 500, zoom: 0.1, width: 1600, height: 900 },
                selectedShip: () => null,
                effectsVolume: () => 1,
                context: () => {
                    asked++;
                    throw new Error('no AudioContext with the flag off');
                },
                rand: () => 0,
            });
            for (let i = 0; i < 3000; i++) expect(audio.step(i / 30, 1)).toEqual([]);
            audio.dispose();
            expect(asked).toBe(0);
            if (scenario !== null) expect(scenario.state).toEqual({});
        });
    }

    it('rimSoundParams falls back to the defaults; the manifest declares the four params with those defaults', () => {
        const galaxy = { scenario: null } as unknown as Galaxy;
        expect(rimSoundParams(galaxy)).toEqual(RIM_SOUND_DEFAULTS);
        const m = parseScenarioManifest(JSON.parse(readFileSync('scenarios/rim-atmosphere/scenario.json', 'utf8')));
        const byName = new Map(m.params.map((p) => [p.name, p.default]));
        expect(byName.get('creatureCallRate')).toBe(0.3);
        expect(byName.get('creakRate')).toBe(0.4);
        expect(byName.get('creatureCallGain')).toBe(0.5);
        expect(byName.get('creakGain')).toBe(0.4);
    });
});

describe('19i audio: offline measurement helpers (scripts/rim-voices-render.mjs)', () => {
    it('signalStats: a 0.5-amplitude 1 kHz sine reads -6 dBFS peak, -9 dBFS RMS, ~1 kHz centroid; silence reads -inf', () => {
        const sr = 48000;
        const x = new Float32Array(sr);
        for (let i = 0; i < sr; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / sr);
        const s = signalStats([x, x], sr);
        expect(s.peakDb).toBeCloseTo(-6.02, 1);
        expect(s.rmsDb).toBeCloseTo(-9.03, 1);
        expect(s.activeS).toBeCloseTo(1, 2);
        expect(Math.abs(s.centroidHz - 1000)).toBeLessThan(60);
        expect(signalStats([new Float32Array(100)], sr).peakDb).toBe(-Infinity);
    });
});
