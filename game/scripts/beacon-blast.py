#!/usr/bin/env python3
"""The Beacon's launch-day blast (Giantworks add-on, the Beacon): the sound of the call, when the strike groups are
sent out and the relay fires its beam. Our own synthesis, built from scratch here (no samples, nothing copied from a
film or a game): deeper, longer and more apocalyptic than the Watcher's horn (scripts/beacon-horn.py).

    python3 -I scripts/beacon-blast.py [--out public/audio/beacon/beacon-blast.ogg] [--wav <path>]

Needs Python 3 with numpy; ffmpeg (libvorbis) for the .ogg (without it only the .wav is written). Deterministic (a
fixed seed; ffmpeg runs bit-exact with no metadata). src/audio/beaconBlast.ts plays it, BLAST_AT_S into the launch
sequence (src/render/beaconRelayFx.ts LAUNCH: the file starts with the charge pulses, its blast lands on the ignition).

The sound (44.1 kHz stereo, about 15 s with the tail):
- The charge (0 - 2.9 s): a sub rumble swelling up from 28 Hz, a cluster of detuned buzzing partials sweeping up from
  110 Hz to 880 Hz under a tremolo that speeds up (the pulses racing down the prongs), crackle growing denser, a last
  rising hiss sucked in, then 70 ms of near silence before the hit.
- The blast (2.9 s): a noise burst and a kick that drops from 90 Hz to 28 Hz; then the blare, a low distorted brass
  chord on D1 / A1 / D2 (36.7, 55, 73.4 Hz; additive saws through two bell formants) that holds and sags as the beam
  burns, a lowpassed roar turning at about 3 Hz (the vortex), inharmonic metal ringing; it all decays from about 8.8 s.
- A soft clip, then a long, dark convolution reverb (about 5 s to -60 dB).
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
DUR = 12.5          # the dry sound (s); the reverb's tail follows
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
    f0 = 110 * 2 ** (3 * k ** 1.6)
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
    out = (sub + rum + sweep + crackle + hiss) * pre
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
    return burst + kick + blare + roar + metal


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
        drive = 1.8
        x = np.tanh(drive * x * 0.6 + 0.05 * x * x) / math.tanh(drive)
        dry.append(x)
    irs = impulse(rng)
    tail = int(SR * 3.0)
    out = []
    for c in range(2):
        d = np.concatenate([dry[c], np.zeros(tail)])
        wet = fft_convolve(d, irs[c])[:len(d)]
        out.append(d * 0.7 + wet * 0.6)
    st = np.stack(out, -1)
    m = st.shape[0]
    fade = np.ones(m)
    k = int(SR * 1.0)
    fade[-k:] = np.linspace(1, 0, k) ** 2
    st *= fade[:, None]
    st = np.stack([one_pole_lp(st[:, c], 11000) for c in range(2)], -1)
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
