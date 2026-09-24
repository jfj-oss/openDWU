// Unit tests for the pure helpers in src/audio/effectsPlayer.ts (no audio).

import { describe, expect, it } from 'vitest';
import { ComponentType } from '../src/sim/data/components';
import { HabitatType } from '../src/sim/types';
import {
    MAX_CONCURRENT_VOICES,
    UI_CLICK_FILE,
    attenuationFactor,
    attenuationFromOffset,
    resolveAmbientEffect,
    resolveAttackClick,
    resolveConstruction,
    resolveExplosion,
    resolveFighterWeapon,
    resolveGasMining,
    resolveHyperjumpEntry,
    resolveHyperjumpExit,
    resolveImportantMessage,
    resolveIonStrike,
    resolveMessage,
    resolveMining,
    resolvePlanetExplosion,
    resolveStar,
    resolveThunder,
    resolveWeapon,
    shouldReplaceOldestVoice,
} from '../src/audio/effectsPlayer';

/** A rand stub returning a fixed value in [0, 1). */
const randOf = (v: number) => (): number => v;

describe('attenuationFactor', () => {
    it('is 1 at the view centre (zero or negative distance)', () => {
        expect(attenuationFactor(0)).toBe(1);
        expect(attenuationFactor(-3)).toBe(1);
    });

    it('falls linearly from 1 to 0 over [0, 1] and clamps above one', () => {
        expect(attenuationFactor(0.5)).toBeCloseTo(0.5, 10);
        expect(attenuationFactor(1)).toBe(1);
        expect(attenuationFactor(2.5)).toBe(1);
    });
});

describe('attenuationFromOffset', () => {
    it('is 1 at zero offset regardless of zoom', () => {
        expect(attenuationFromOffset(0, 0, 42, 450)).toBe(1);
    });

    it('scales with on-screen distance (hypot * zoom / screenRadius)', () => {
        // 3-4-5 triangle: hypot(3, 4) = 5 world units; zoom 10 → 50 px;
        // radius 500 → factor 0.1.
        expect(attenuationFromOffset(3, 4, 10, 500)).toBeCloseTo(0.1, 10);
    });

    it('clamps beyond the full screen radius', () => {
        expect(attenuationFromOffset(100, 0, 10, 500)).toBe(1);
    });

    it('returns 1 when the screen radius is non-positive (no reference)', () => {
        expect(attenuationFromOffset(10, 10, 10, 0)).toBe(1);
    });
});

describe('shouldReplaceOldestVoice', () => {
    it('is false below the cap', () => {
        expect(shouldReplaceOldestVoice(MAX_CONCURRENT_VOICES - 1, MAX_CONCURRENT_VOICES)).toBe(false);
        expect(shouldReplaceOldestVoice(0, MAX_CONCURRENT_VOICES)).toBe(false);
    });

    it('is true at and above the cap', () => {
        expect(shouldReplaceOldestVoice(MAX_CONCURRENT_VOICES, MAX_CONCURRENT_VOICES)).toBe(true);
        expect(shouldReplaceOldestVoice(MAX_CONCURRENT_VOICES + 5, MAX_CONCURRENT_VOICES)).toBe(true);
    });
});

describe('resolveIonStrike', () => {
    it('uses ion_strike.wav at masterVolume * 1.8, clamped by distance', () => {
        const r = resolveIonStrike(0.7, -0.4, 0.5);
        expect(r.filename).toBe('ion_strike.wav');
        expect(r.balance).toBe(-0.4);
        expect(r.volume).toBeCloseTo(0.7 * 1.8 * 0.5, 10);
        expect(r.frequency).toBe(0);
    });

    it('clamps distances above 1', () => {
        expect(resolveIonStrike(0.7, 0, 5).volume).toBeCloseTo(0.7 * 1.8, 10);
    });
});

describe('resolveWeapon', () => {
    it('falls back to an empty filename for null and scales by 0.23', () => {
        const r = resolveWeapon(0.7, null, 0.2, 1);
        expect(r.filename).toBe('');
        expect(r.volume).toBeCloseTo(0.7 * 0.23, 10);
    });

    it('keeps the component-provided filename', () => {
        const r = resolveWeapon(0.7, 'beam_laser.wav', 0, 0.5);
        expect(r.filename).toBe('beam_laser.wav');
        expect(r.volume).toBeCloseTo(0.7 * 0.23 * 0.5, 10);
    });
});

describe('resolveFighterWeapon', () => {
    it('uses the file at 0.19 for beams', () => {
        const r = resolveFighterWeapon(0.7, 'fighter_beam.wav', ComponentType.WeaponBeam, 0, 1);
        expect(r.filename).toBe('fighter_beam.wav');
        expect(r.volume).toBeCloseTo(0.7 * 0.19, 10);
    });

    it('uses the file at 0.25 for torpedoes and missiles', () => {
        for (const type of [ComponentType.WeaponTorpedo, ComponentType.WeaponMissile]) {
            const r = resolveFighterWeapon(0.7, 'fighter_torpedo.wav', type, 0, 1);
            expect(r.filename).toBe('fighter_torpedo.wav');
            expect(r.volume).toBeCloseTo(0.7 * 0.25, 10);
        }
    });

    it('plays nothing for other component types', () => {
        const r = resolveFighterWeapon(0.7, 'whatever.wav', ComponentType.WeaponBombard, 0, 1);
        expect(r.filename).toBe('');
        expect(r.volume).toBeCloseTo(0.7 * 0.19, 10);
    });
});

describe('resolveAmbientEffect', () => {
    it('scheme 0 picks voice1/2/3 with offsets 5500/10800/6600', () => {
        const cases: Array<[number, string, number]> = [
            [0, 'ambient1_voice1.wav', 5500],
            [0.4, 'ambient1_voice2.wav', 10800],
            [0.8, 'ambient1_voice3.wav', 6600],
        ];
        for (const [v, file, offset] of cases) {
            const out = { value: -1 };
            const r = resolveAmbientEffect(0.7, 0, 0, 1, out, randOf(v));
            expect(r.filename).toBe(file);
            expect(out.value).toBe(offset);
            expect(r.volume).toBeCloseTo(0.7 * 0.7, 10);
        }
    });

    it('scheme 1 picks voice1..4 with offsets 9200/9200/8200/9200', () => {
        const cases: Array<[number, string, number]> = [
            [0, 'ambient2_voice1.wav', 9200],
            [0.3, 'ambient2_voice2.wav', 9200],
            [0.6, 'ambient2_voice3.wav', 8200],
            [0.9, 'ambient2_voice4.wav', 9200],
        ];
        for (const [v, file, offset] of cases) {
            const out = { value: -1 };
            const r = resolveAmbientEffect(0.7, 1, 0, 1, out, randOf(v));
            expect(r.filename).toBe(file);
            expect(out.value).toBe(offset);
        }
    });

    it('scheme 2 picks energy1/2/3 with offsets 8400/8400/11400', () => {
        const cases: Array<[number, string, number]> = [
            [0, 'ambient3_energy1.wav', 8400],
            [0.5, 'ambient3_energy2.wav', 8400],
            [0.9, 'ambient3_energy3.wav', 11400],
        ];
        for (const [v, file, offset] of cases) {
            const out = { value: -1 };
            const r = resolveAmbientEffect(0.7, 2, 0, 1, out, randOf(v));
            expect(r.filename).toBe(file);
            expect(out.value).toBe(offset);
        }
    });

    it('scheme 3 maps rand buckets to boom1/boom2/boom3', () => {
        const cases: Array<[number, string, number]> = [
            [0, 'ambient4_boom1.wav', 5500],
            [0.2, 'ambient4_boom1.wav', 5500],
            [0.4, 'ambient4_boom2.wav', 6500],
            [0.6, 'ambient4_boom2.wav', 6500],
            [0.9, 'ambient4_boom3.wav', 8500],
        ];
        for (const [v, file, offset] of cases) {
            const out = { value: -1 };
            const r = resolveAmbientEffect(0.7, 3, 0, 1, out, randOf(v));
            expect(r.filename).toBe(file);
            expect(out.value).toBe(offset);
        }
    });

    it('unknown schemes play nothing and keep the default 4000 offset', () => {
        const out = { value: -1 };
        const r = resolveAmbientEffect(0.7, 9, 0, 1, out, randOf(0.5));
        expect(r.filename).toBe('');
        expect(out.value).toBe(4000);
    });
});

describe('resolveAttackClick / UI click sound', () => {
    it('plays attack_click.wav at full master volume', () => {
        const r = resolveAttackClick(0.7);
        expect(r.filename).toBe(UI_CLICK_FILE);
        expect(r.filename).toBe('attack_click.wav');
        expect(r.balance).toBe(0);
        expect(r.volume).toBeCloseTo(0.7, 10);
    });
});

describe('resolveImportantMessage / resolveMessage', () => {
    it('important messages use message_major.wav at 0.7', () => {
        const r = resolveImportantMessage(0.7);
        expect(r.filename).toBe('message_major.wav');
        expect(r.volume).toBeCloseTo(0.7 * 0.7, 10);
    });

    it('routes minor types (14/55/56) to message_minor.wav', () => {
        for (const t of [14, 55, 56]) {
            const r = resolveMessage(0.7, t);
            expect(r.filename).toBe('message_minor.wav');
            expect(r.volume).toBeCloseTo(0.7 * 0.7, 10);
        }
    });

    it('routes alarm types (20/22) to message_alarm.wav at 0.4', () => {
        for (const t of [20, 22]) {
            const r = resolveMessage(0.7, t);
            expect(r.filename).toBe('message_alarm.wav');
            expect(r.volume).toBeCloseTo(0.7 * 0.4, 10);
        }
    });

    it('routes major types to message_major.wav at 0.7', () => {
        for (const t of [24, 26, 29, 31, 33, 34, 50, 59, 60, 63, 67, 68, 72, 78, 79, 82, 91, 92, 96]) {
            const r = resolveMessage(0.7, t);
            expect(r.filename).toBe('message_major.wav');
            expect(r.volume).toBeCloseTo(0.7 * 0.7, 10);
        }
    });

    it('routes remaining in-range types to message_standard.wav', () => {
        for (const t of [1, 5, 13, 15, 21, 25, 35, 49, 51, 57, 61, 69, 73, 80, 83, 90, 93, 97]) {
            const r = resolveMessage(0.7, t);
            expect(r.filename).toBe('message_standard.wav');
            expect(r.volume).toBeCloseTo(0.7 * 0.7, 10);
        }
    });

    it('plays nothing for out-of-range types', () => {
        for (const t of [0, 98, 100, -1]) {
            const r = resolveMessage(0.7, t);
            expect(r.filename).toBe('');
        }
    });
});

describe('resolveHyperjumpEntry / Exit', () => {
    it('entry uses Hyperjump_Enter.wav at 0.45', () => {
        const r = resolveHyperjumpEntry(0.7, 0.3, 0.5);
        expect(r.filename).toBe('Hyperjump_Enter.wav');
        expect(r.balance).toBe(0.3);
        expect(r.volume).toBeCloseTo(0.7 * 0.45 * 0.5, 10);
    });

    it('exit uses Hyperjump_Exit.wav at 0.5', () => {
        const r = resolveHyperjumpExit(0.7, -0.3, 1);
        expect(r.filename).toBe('Hyperjump_Exit.wav');
        expect(r.volume).toBeCloseTo(0.7 * 0.5, 10);
    });
});

describe('resolveStar', () => {
    it('returns null for non-star habitat types', () => {
        for (const t of [HabitatType.Undefined, HabitatType.Ocean, HabitatType.GasGiant, HabitatType.Metal]) {
            expect(resolveStar(0.7, t, 0, 1, randOf(0.5))).toBeNull();
        }
    });

    it('picks the two star variants per type (rand < 0.5 → variant 1)', () => {
        const cases: Array<[HabitatType, string, number]> = [
            [HabitatType.MainSequence, 'star_basic1.wav', 0.7],
            [HabitatType.RedGiant, 'star_bass1.wav', 0.7],
            [HabitatType.SuperGiant, 'star_bass1.wav', 0.7],
            [HabitatType.WhiteDwarf, 'star_hollow1.wav', 0.5],
            [HabitatType.Neutron, 'star_ring1.wav', 1.2],
            [HabitatType.BlackHole, 'star_intense1.wav', 1.0],
        ];
        for (const [type, file, num2] of cases) {
            const r = resolveStar(0.7, type, 0, 1, randOf(0.1));
            expect(r).not.toBeNull();
            expect(r!.filename).toBe(file);
            expect(r!.volume).toBeCloseTo(0.7 * 1.2 * num2, 10);
        }
    });

    it('picks variant 2 when rand >= 0.5', () => {
        const r = resolveStar(0.7, HabitatType.MainSequence, 0, 1, randOf(0.9));
        expect(r!.filename).toBe('star_basic2.wav');
    });

    it('scales volume by the distance clamp', () => {
        const r = resolveStar(0.7, HabitatType.Neutron, 0, 0.5, randOf(0.1));
        expect(r!.volume).toBeCloseTo(0.7 * 1.2 * 1.2 * 0.5, 10);
    });
});

describe('resolveMining', () => {
    it('files 1-3 use 0.22 and file 4 uses 0.5', () => {
        const cases: Array<[number, string, number]> = [
            [0, 'mining_1.wav', 0.22],
            [0.3, 'mining_2.wav', 0.22],
            [0.6, 'mining_3.wav', 0.22],
            [0.9, 'mining_4.wav', 0.5],
        ];
        for (const [v, file, f] of cases) {
            const r = resolveMining(0.7, 0, 1, randOf(v));
            expect(r.filename).toBe(file);
            expect(r.volume).toBeCloseTo(0.7 * f, 10);
        }
    });
});

describe('resolveThunder', () => {
    it('cycles thunder1/2/3 at 1.3', () => {
        const cases: Array<[number, string]> = [
            [0, 'thunder1.wav'],
            [0.4, 'thunder2.wav'],
            [0.8, 'thunder3.wav'],
        ];
        for (const [v, file] of cases) {
            const r = resolveThunder(0.7, 0, 1, randOf(v));
            expect(r.filename).toBe(file);
            expect(r.volume).toBeCloseTo(0.7 * 1.3, 10);
        }
    });
});

describe('resolveConstruction', () => {
    it('cycles construction..construction_5 at 0.7', () => {
        const files = ['construction.wav', 'construction_2.wav', 'construction_3.wav', 'construction_4.wav', 'construction_5.wav'];
        for (let i = 0; i < 5; i++) {
            const r = resolveConstruction(0.7, 0, 1, randOf(i / 5));
            expect(r.filename).toBe(files[i]);
            expect(r.volume).toBeCloseTo(0.7 * 0.7, 10);
        }
    });
});

describe('resolveGasMining', () => {
    it('cycles GasMining1/GasMining2/gasmining3 at 0.5', () => {
        const cases: Array<[number, string]> = [
            [0, 'GasMining1.wav'],
            [0.4, 'GasMining2.wav'],
            [0.8, 'gasmining3.wav'],
        ];
        for (const [v, file] of cases) {
            const r = resolveGasMining(0.7, 0, 1, randOf(v));
            expect(r.filename).toBe(file);
            expect(r.volume).toBeCloseTo(0.7 * 0.5, 10);
        }
    });
});

describe('resolvePlanetExplosion', () => {
    it('always plays planetExplosion.wav at 2.1 (size unused)', () => {
        for (const size of [10, 100, 500]) {
            const r = resolvePlanetExplosion(0.7, size, 0, 1);
            expect(r.filename).toBe('planetExplosion.wav');
            expect(r.volume).toBeCloseTo(0.7 * 2.1, 10);
        }
    });
});

describe('resolveExplosion', () => {
    it('small explosions (<100) cycle explosion_small* at 0.75', () => {
        const cases: Array<[number, string]> = [
            [0, 'explosion_small.wav'],
            [0.4, 'explosion_small2.wav'],
            [0.8, 'explosion_small3.wav'],
        ];
        for (const [v, file] of cases) {
            const r = resolveExplosion(0.7, 50, 0, 1, randOf(v));
            expect(r.filename).toBe(file);
            expect(r.volume).toBeCloseTo(0.7 * 0.75, 10);
        }
    });

    it('large explosions (100..110) cycle explosion* at 0.9', () => {
        const cases: Array<[number, string]> = [
            [0, 'explosion.wav'],
            [0.4, 'explosion2.wav'],
            [0.8, 'explosion3.wav'],
        ];
        for (const [v, file] of cases) {
            const r = resolveExplosion(0.7, 105, 0, 1, randOf(v));
            expect(r.filename).toBe(file);
            expect(r.volume).toBeCloseTo(0.7 * 0.9, 10);
        }
    });

    it('very large explosions (>110) pick the 2.5 factor but the faithful Min(1.0, ...) clamp caps it at 1.0', () => {
        const r = resolveExplosion(0.7, 120, 0, 1, randOf(0.1));
        expect(r.filename).toBe('explosion.wav');
        expect(r.volume).toBeCloseTo(0.7 * 1.0, 10);
    });
});