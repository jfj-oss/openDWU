#!/usr/bin/env python3
"""The Beacon's launch-day blast (Giantworks add-on, the Beacon): the sound of the call, when the strike groups are
sent out and the relay fires its beam. Our own synthesis, built from scratch here (no samples, nothing copied from a
film or a game): deeper, longer and more apocalyptic than the Watcher's horn (scripts/beacon-horn.py).

    python3 -I scripts/beacon-blast.py [--out public/audio/beacon/beacon-blast.ogg] [--wav <path>]

Needs Python 3 with numpy; ffmpeg (libvorbis) for the .ogg (without it only the .wav is written). Deterministic (a
fixed seed; ffmpeg runs bit-exact with no metadata). src/audio/beaconBlast.ts plays it, BLAST_AT_S into the launch
sequence (src/render/beaconRelayFx.ts LAUNCH: the file starts with the charge pulses, its blast lands on the ignition).

The sound (44.1 kHz stereo, 17.6 s with the tail, ending with the visuals at LAUNCH.end):
- The charge (0 - 2.9 s): a sub rumble swelling up from 28 Hz, a cluster of detuned buzzing partials sweeping up from
  70 Hz under a tremolo that speeds up, four heavy mechanical slams on the charge pulses (0, 0.5, 1.0, 1.5 s: a deep
  thump, a metal-plate ring, a hiss of venting gas, each heavier), crackle growing denser, a rising hiss sucked in,
  then 70 ms of near silence before the hit.
- The blast (2.9 s): a wideband crack, a noise burst and a kick that drops from 90 Hz to 28 Hz; the blare, a low
  distorted brass chord on D1 / A1 / D2 that holds and sags as the beam burns, a darker scream on D2 / A2 / D3 above it,
  a sizzle and a lowpassed roar turning at about 3 Hz (the vortex), inharmonic metal ringing; it all decays from about
  8.8 s.
- Digital corruption across the charge and the burn: 2-bit sample-held noise in stutter bursts, square-wave data blips
  and dense crackle, densest at the hit, thinning as the beam decays.
- A soft clip, a shorter dark convolution reverb, a 32 Hz highpass and a soft limiter (user, 2026-10-19: "more
  intense", "not gamey or high pitched", "add digital noise/crackling", charge pulses as mechanical slams).
"""
import argparse
import math
import os
import shutil
import subprocess
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
SR = 44100
F64 = np.float64
DUR = 14.6          # the dry sound (s); the reverb's tail follows
HIT = 2.9           # the blast (s into the file)


def env(t, pts):
    xs = np.array([p[0] for p in pts], F64)
    ys = np.array([p[1] for p in pts], F64)
    return np.interp(t, xs, ys)


def smooth(x, n):
    if n < 2:
        return x
    return np.convolve(x, np.ones(n) / n, mode='same')


def fft_convolve(a, b):
    n = len(a) + len(b) - 1
    m = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(a, m) * np.fft.rfft(b, m), m)[:n]


def spectral(x, gain_of_f):
    """Filter x by a gain curve over frequency (Hz) in the spectrum."""
    n = len(x)
    m = 1 << (n - 1).bit_length()
    X = np.fft.rfft(x, m)
    f = np.fft.rfftfreq(m, 1 / SR)
    return np.fft.irfft(X * gain_of_f(f), m)[:n]


def lowpass(x, fc, order=2):
    return spectral(x, lambda f: 1 / (1 + (f / fc) ** (2 * order)) ** 0.5)


def highpass(x, fc, order=2):
    return spectral(x, lambda f: 1 - 1 / (1 + (np.maximum(f, 1e-3) / fc) ** (2 * order)) ** 0.5)


def bandpass(x, lo, hi):
    return highpass(lowpass(x, hi), lo)


def one_pole_lp(x, fc):
    a = math.exp(-2 * math.pi * fc / SR)
    h = (1 - a) * a ** np.arange(min(len(x), int(SR * 0.3)))
    return fft_convolve(x, h)[:len(x)]


def saw(ph, f, nh=48, tilt=1.0):
    """A band-limited sawtooth by additive synthesis (phase ph, instantaneous frequency f for the band limit)."""
    v = np.zeros_like(ph)
    for k in range(1, nh + 1):
        live = f * k < SR * 0.45
        if not live.any():
            break
        v += np.where(live, np.sin(k * ph) / k ** tilt, 0.0)
    return v


def bell(f):
    g = 0.3
    for (fc, bw, amp) in ((300.0, 220.0, 1.0), (820.0, 480.0, 0.6)):
        g = g + amp / (1 + ((f - fc) / (bw / 2)) ** 2)
    return g


def charge(rng, t, side):
    """The charge before the hit."""
    pre = t < HIT
    k = np.clip(t / HIT, 0, 1)
    # sub rumble
    fsub = 28 + 17 * k ** 1.5
    sub = np.sin(2 * math.pi * np.cumsum(fsub) / SR) * (0.15 + 0.6 * k ** 2)
    rum = lowpass(rng.standard_normal(len(t)), 120) * (0.2 + 1.4 * k ** 2) * 0.6
    # the sweep: detuned buzzing partials, 110 Hz -> 880 Hz
    f0 = 70 * 2 ** (2.3 * k ** 1.6)
    sweep = np.zeros(len(t))
    for dc in (-18.0, -7.0, 0.0, 6.0, 13.0, 21.0):
        f = f0 * 2 ** ((dc + side * 3) / 1200)
        ph = 2 * math.pi * np.cumsum(f) / SR + rng.uniform(0, 6.28)
        sweep += saw(ph, f, nh=24, tilt=1.3) / 6
    trem_rate = 4 + 26 * k ** 2
    trem = 0.55 + 0.45 * np.sin(2 * math.pi * np.cumsum(trem_rate) / SR)
    sweep *= trem * (0.05 + 0.5 * k ** 2.2)
    # crackle: clicks, denser and denser
    clicks = np.zeros(len(t))
    dens = 6 + 140 * k ** 2
    p = dens / SR
    hits = rng.random(len(t)) < p
    clicks[hits] = rng.uniform(-1, 1, hits.sum())
    crackle = bandpass(clicks, 2000, 6500) * 1.6 * (0.2 + k)
    # the suck: a hiss rising over the last 0.4 s
    hk = np.clip((t - (HIT - 0.45)) / 0.38, 0, 1)
    hiss = highpass(rng.standard_normal(len(t)), 1500) * hk ** 2 * 0.35
    # the four charge pulses racing down the prongs (0, 0.5, 1.0, 1.5 s into the file): rising zaps, each brighter
    # the four charge pulses (0, 0.5, 1.0, 1.5 s): heavy mechanical slams, a capacitor bank locking in: a deep thump, a
    # short metal-plate resonance and a hiss of venting gas, each heavier than the last
    zap = np.zeros(len(t))
    for i in range(4):
        uz = t - 0.5 * i
        onz = uz >= 0
        uzc = np.maximum(uz, 0)
        g = 0.6 + 0.18 * i
        fk = 38 + 70 * np.exp(-uzc / 0.05)
        thump = np.sin(2 * math.pi * np.cumsum(fk * onz) / SR) * np.exp(-uzc / 0.22) * onz
        plate = np.zeros(len(t))
        for (f, d) in ((97.0, 0.35), (163.0, 0.25), (251.0, 0.18), (389.0, 0.12)):
            plate += np.sin(2 * math.pi * (f * (1 - 0.04 * i)) * uzc + rng.uniform(0, 6.28)) * np.exp(-uzc / d)
        plate *= onz * np.clip(uzc / 0.003, 0, 1) * 0.28
        vent = bandpass(rng.standard_normal(len(t)), 500, 2800) * np.exp(-np.maximum(uzc - 0.03, 0) / 0.18) * np.clip((uzc - 0.02) / 0.03, 0, 1) * onz * 0.22
        zap += (thump * 1.3 + plate + vent) * g
    out = (sub * 0.7 + rum * 0.6 + sweep * 2.2 + crackle * 1.4 + hiss * 2.0 + zap) * pre
    # the gap before the hit
    gap = np.clip((HIT - 0.07 - t) / 0.02, 0, 1)
    return out * gap


def blast(rng, t, side):
    """The hit and the blare after it."""
    u = t - HIT
    on = u >= 0
    uu = np.maximum(u, 0)
    # the hit: a noise burst and a dropping kick
    burst = lowpass(rng.standard_normal(len(t)), 3000) * np.exp(-uu / 0.35) * np.clip(uu / 0.004, 0, 1) * 1.3
    fk = 28 + 62 * np.exp(-uu / 0.18)
    kick = np.sin(2 * math.pi * np.cumsum(fk * on) / SR) * np.exp(-uu / 0.9) * 1.6
    # the blare: a low chord, sagging; the brightness follows its loudness
    amp = env(u, [(-1, 0), (0, 0), (0.08, 0.85), (0.6, 1.0), (5.9, 0.92), (7.6, 0.55), (9.2, 0.12), (9.6, 0.0)]) * on
    amp = smooth(amp, int(SR * 0.02))
    sag = env(u, [(0, 0), (2, -10), (5.9, -30), (9.6, -140)])
    blare = np.zeros(len(t))
    for (f, g) in ((36.71, 1.0), (55.0, 0.7), (73.42, 0.55)):
        for dc in (-11.0, 0.0, 9.0):
            fi = f * 2 ** ((sag + dc + side * 2) / 1200)
            ph = 2 * math.pi * np.cumsum(fi) / SR + rng.uniform(0, 6.28)
            v = np.zeros(len(t))
            for k in range(1, 60):
                fk_ = fi * k
                live = fk_ < SR * 0.45
                if not live.any():
                    break
                v += np.where(live, np.sin(k * ph) * k ** -1.15 * bell(fk_), 0.0)
            blare += v * g / 3
    blare *= amp
    # the roar: lowpassed noise turning (the vortex)
    roar = lowpass(rng.standard_normal(len(t)), 420) * amp * (0.75 + 0.25 * np.sin(2 * math.pi * 3.1 * u + side)) * 1.4
    # metal ringing: inharmonic partials, decaying
    metal = np.zeros(len(t))
    for (f, d) in ((36.71 * 3.17, 2.5), (36.71 * 5.43, 1.6), (36.71 * 8.9, 1.1)):
        metal += np.sin(2 * math.pi * f * uu + rng.uniform(0, 6.28)) * np.exp(-uu / d)
    metal *= on * 0.12
    # the crack: a wideband transient on the ignition, and the beam's sizzle while it burns
    crack = highpass(rng.standard_normal(len(t)), 1800) * np.exp(-uu / 0.09) * np.clip(uu / 0.002, 0, 1) * on * 1.8
    hold = env(u, [(-1, 0), (0, 0), (0.15, 1.0), (5.9, 0.85), (8.9, 0.2), (9.6, 0.0)]) * on
    sizzle = bandpass(rng.standard_normal(len(t)), 900, 3800) * hold * (0.7 + 0.3 * np.sin(2 * math.pi * 7.3 * u + side)) * 0.3
    # a scream an octave and two above the blare (D3 / A3), distorted: the beam's voice, audible on small speakers
    scream = np.zeros(len(t))
    for (f, g) in ((73.42, 1.0), (110.0, 0.75), (146.83, 0.4)):
        for dc in (-14.0, 0.0, 12.0):
            fi = f * 2 ** ((sag + dc + side * 4) / 1200)
            ph = 2 * math.pi * np.cumsum(fi) / SR + rng.uniform(0, 6.28)
            scream += saw(ph, fi, nh=40, tilt=1.25) * g / 3
    scream = lowpass(np.tanh(1.8 * scream), 1600) * hold * 0.6
    # digital corruption: bit-crushed, sample-held noise in bursts, data blips and stutter gates, densest at the hit and
    # through the burn, thinning as the beam decays; across the charge it grows with it
    dk = np.where(on, hold, np.clip(t / HIT, 0, 1) ** 2 * 0.45)
    held = np.repeat(rng.uniform(-1, 1, len(t) // 37 + 1), 37)[:len(t)]          # ~1.2 kHz sample-and-hold
    crushed = np.round(held * 3) / 3                                             # 2-bit
    gate = np.repeat(rng.random(len(t) // 1100 + 1) < 0.35, 1100)[:len(t)]       # 25 ms stutter cells
    glitch = crushed * gate * dk
    blips = np.zeros(len(t))
    for _ in range(140):
        t0 = rng.uniform(0.3, HIT + 8.5)
        i0 = int(t0 * SR); n0 = int(rng.uniform(0.004, 0.03) * SR)
        f = rng.choice([180.0, 240.0, 330.0, 470.0, 620.0])
        seg = np.sign(np.sin(2 * math.pi * f * np.arange(n0) / SR)) * rng.uniform(0.3, 1.0)
        if i0 + n0 < len(t): blips[i0:i0 + n0] += seg
    blips = lowpass(blips, 3500) * dk
    dcrack = np.zeros(len(t))
    hits = rng.random(len(t)) < (40 + 900 * dk) / SR
    dcrack[hits] = rng.choice([-1.0, 1.0], hits.sum())
    dcrack = bandpass(dcrack, 700, 5000) * 2.2 * (0.3 + dk)
    digital = lowpass(glitch, 5000) * 0.32 + blips * 0.18 + dcrack * 0.5
    return burst * 1.3 + kick * 1.3 + blare * 1.0 + roar * 0.75 + metal * 1.6 + crack * 0.8 + sizzle + scream + digital


def impulse(rng, length_s=5.5, rt60=5.0):
    n = int(SR * length_s)
    t = np.arange(n) / SR
    decay = 10 ** (-3 * t / rt60)
    chans = []
    for c in range(2):
        noise = rng.standard_normal(n)
        lo = one_pole_lp(noise, 1400)
        lo2 = one_pole_lp(noise, 300)
        mix = np.clip(t / length_s, 0, 1)
        ir = (lo * (1 - mix) + lo2 * mix * 1.8) * decay
        for (dt, g) in ((0.031 + 0.005 * c, 0.6), (0.057 - 0.004 * c, 0.45), (0.089 + 0.006 * c, 0.35)):
            ir[int(dt * SR)] += g * 4
        ir[:int(0.015 * SR)] *= np.linspace(0, 1, int(0.015 * SR))
        chans.append(ir / np.sqrt(np.sum(ir ** 2)))
    return chans


def build():
    rng = np.random.default_rng(20261017)
    n = int(SR * DUR)
    t = np.arange(n) / SR
    dry = []
    for side in (-1, 1):
        x = charge(rng, t, side) + blast(rng, t, side)
        drive = 2.6
        x = np.tanh(drive * x * 0.6 + 0.05 * x * x) / math.tanh(drive)
        dry.append(x)
    irs = impulse(rng)
    tail = int(SR * 3.0)
    out = []
    for c in range(2):
        d = np.concatenate([dry[c], np.zeros(tail)])
        wet = fft_convolve(d, irs[c])[:len(d)]
        out.append(d * 0.85 + wet * 0.4)
    st = np.stack(out, -1)
    m = st.shape[0]
    fade = np.ones(m)
    k = int(SR * 1.0)
    fade[-k:] = np.linspace(1, 0, k) ** 2
    st *= fade[:, None]
    st = np.stack([one_pole_lp(st[:, c], 14000) for c in range(2)], -1)
    # tame the sub mud under 35 Hz, keep it loud: a gentle highpass then a soft limiter
    st = np.stack([highpass(st[:, c], 32, order=1) for c in range(2)], -1)
    st = np.tanh(1.6 * st / np.max(np.abs(st))) / math.tanh(1.6)
    st *= 10 ** (-1 / 20) / np.max(np.abs(st))
    return st


def write_wav(path, st):
    pcm = np.round(np.clip(st, -1, 1) * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(GAME, 'public', 'audio', 'beacon', 'beacon-blast.ogg'))
    ap.add_argument('--wav', default=None, help='also keep the .wav here')
    args = ap.parse_args()
    st = build()
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    wav = args.wav or os.path.splitext(args.out)[0] + '.wav'
    write_wav(wav, st)
    print('wav', wav, '%.2f s' % (st.shape[0] / SR))
    ff = shutil.which('ffmpeg')
    if ff is None:
        print('ffmpeg not found: only the .wav is written')
        return
    subprocess.run([ff, '-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libvorbis', '-q:a', '4', '-map_metadata', '-1',
                    '-fflags', '+bitexact', '-flags:a', '+bitexact', args.out], check=True)
    if args.wav is None:
        os.remove(wav)
    print('ogg', args.out, os.path.getsize(args.out), 'bytes')


if __name__ == '__main__':
    main()
