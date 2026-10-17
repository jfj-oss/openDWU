#!/usr/bin/env python3
"""The Watcher's horn (Giantworks add-on, the Beacon): the call a Watcher sounds as it opens. Our own synthesis, built
from scratch here (no samples): a long, low, distorted brass blare whose pitch rises, then falls, with a metallic
rasp and a big reverb tail.

    python3 -I scripts/beacon-horn.py [--out public/audio/beacon/watcher-horn.ogg] [--wav <path>]

Needs Python 3 with numpy; ffmpeg (libvorbis) for the .ogg (without it only the .wav is written). Deterministic (a
fixed seed; ffmpeg runs bit-exact with no metadata). src/audio/beaconHorn.ts plays it.

The sound, layer by layer (44.1 kHz stereo, about 6 s with the tail):
- The pitch: a two-step brass call on a low D (73 Hz): it swells in a little flat, climbs to the note, then a
  semitone and a half above it, holds with a slow vibrato, and sags a fifth down as it dies away.
- The brass: five detuned voices per channel, each a band-limited sawtooth by additive synthesis (60 harmonics),
  brighter as it gets louder (its spectral tilt follows the swell, as a horn's does) through two fixed formants (450 Hz
  and 1.1 kHz, the body of a big brass bell); a sine an octave down under it.
- The rasp: noise gated by each cycle of the waveform (a buzz locked to the pitch), band-passed high, and a ring of an
  inharmonic partial (3.17 x) for the metal.
- Soft clipping (tanh drive), then a convolution reverb: an impulse of decaying, darkening, decorrelated noise
  (about 3.5 s to -60 dB), mixed wet.
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


def env_points(t, pts):
    """A piecewise-linear envelope through (time, value) points."""
    xs = np.array([p[0] for p in pts], F64)
    ys = np.array([p[1] for p in pts], F64)
    return np.interp(t, xs, ys)


def smooth(x, n):
    if n < 2:
        return x
    k = np.ones(n) / n
    return np.convolve(x, k, mode='same')


def one_pole_lp(x, fc):
    """A one-pole low-pass (vectorised by a recursive-filter trick: via FFT of its impulse response)."""
    a = math.exp(-2 * math.pi * fc / SR)
    n = len(x)
    h = (1 - a) * a ** np.arange(min(n, int(SR * 0.2)))
    return fft_convolve(x, h)[:n]


def fft_convolve(a, b):
    n = len(a) + len(b) - 1
    m = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(a, m) * np.fft.rfft(b, m), m)[:n]


def bandpass(x, lo, hi):
    """A brick-free band-pass: a smooth spectral window (raised-cosine skirts an octave wide)."""
    n = len(x)
    m = 1 << (n - 1).bit_length()
    X = np.fft.rfft(x, m)
    f = np.fft.rfftfreq(m, 1 / SR)
    lf, hf = np.log2(np.maximum(f, 1)), (np.log2(lo), np.log2(hi))
    w = np.clip((lf - (hf[0] - 1)) / 1.0, 0, 1) * np.clip(((hf[1] + 1) - lf) / 1.0, 0, 1)
    w = 0.5 - 0.5 * np.cos(np.pi * w)
    return np.fft.irfft(X * w, m)[:n]


def formant(f):
    """The bell's resonances: gain at frequency f (Hz)."""
    g = 0.35
    for (fc, bw, amp) in ((450.0, 260.0, 1.0), (1100.0, 520.0, 0.7), (2600.0, 900.0, 0.25)):
        g = g + amp / (1 + ((f - fc) / (bw / 2)) ** 2)
    return g


def horn(rng, side):
    """One channel of the dry horn."""
    dur = 4.3
    n = int(SR * dur)
    t = np.arange(n) / SR
    # the pitch (cents round D2 = 73.42 Hz): swell in flat, climb to the note, step up, hold, sag away
    cents = env_points(t, [(0.0, -320), (0.35, -60), (0.7, 0), (1.25, 10), (1.55, 150), (1.9, 160), (2.7, 140),
                           (3.3, -150), (4.3, -700)])
    cents = smooth(cents, int(SR * 0.09))
    vib = 9 * np.sin(2 * math.pi * 5.1 * t + side * 0.7) * env_points(t, [(0, 0), (0.9, 0), (1.6, 1), (3.0, 1), (3.6, 0.3), (4.3, 0)])
    f0 = 73.42 * 2 ** ((cents + vib) / 1200)
    # the loudness and the brightness (a horn brightens as it is blown harder)
    amp = env_points(t, [(0.0, 0.0), (0.18, 0.55), (0.6, 0.85), (1.5, 1.0), (2.6, 0.95), (3.3, 0.7), (3.9, 0.25), (4.3, 0.0)])
    amp = smooth(amp, int(SR * 0.03)) ** 1.2
    bright = 0.25 + 0.75 * amp
    out = np.zeros(n)
    detunes = np.array([-14.0, -6.0, 0.0, 7.0, 15.0]) + side * 2.5
    for dc in detunes:
        f = f0 * 2 ** (dc / 1200) * (1 + 0.0015 * smooth(rng.standard_normal(n), int(SR * 0.05)))
        ph = 2 * math.pi * np.cumsum(f) / SR + rng.uniform(0, 2 * math.pi)
        v = np.zeros(n)
        for k in range(1, 61):
            fk = f * k
            live = fk < SR * 0.45
            if not live.any():
                break
            tilt = k ** (-(1.9 - 1.2 * bright))
            v += np.where(live, np.sin(k * ph) * tilt * formant(fk), 0.0)
        out += v / len(detunes)
    sub = np.sin(2 * math.pi * np.cumsum(f0 * 0.5) / SR) * 0.55
    out = (out + sub) * amp
    # the rasp: noise gated by the cycle (a buzz locked to the pitch), high band; an inharmonic metal partial
    cyc = (np.cumsum(f0) / SR) % 1.0
    gate = np.exp(-cyc * 9.0)
    rasp = bandpass(rng.standard_normal(n), 1600, 4800) * gate * amp ** 1.5 * 0.3
    metal = np.sin(2 * math.pi * np.cumsum(f0 * 3.17) / SR) * np.sin(2 * math.pi * np.cumsum(f0) / SR) * 0.12 * amp ** 2
    out = out + rasp + metal
    # distortion: drive it into a soft clip, a touch of asymmetry (a growl)
    drive = 2.2
    out = np.tanh(drive * out + 0.08 * out * out) / math.tanh(drive)
    return out


def impulse(rng, length_s=3.6, rt60=3.4):
    """A big dark hall: decaying noise, darkening as it decays, decorrelated per channel, an early cluster."""
    n = int(SR * length_s)
    t = np.arange(n) / SR
    decay = 10 ** (-3 * t / rt60)
    chans = []
    for c in range(2):
        noise = rng.standard_normal(n)
        lo = one_pole_lp(noise, 1800)
        lo2 = one_pole_lp(noise, 450)
        mix = np.clip(t / length_s, 0, 1)
        ir = (lo * (1 - mix) + lo2 * mix * 1.6) * decay
        for (dt, g) in ((0.023 + 0.004 * c, 0.6), (0.041 - 0.003 * c, 0.45), (0.067 + 0.005 * c, 0.35), (0.093, 0.25)):
            i = int(dt * SR)
            ir[i] += g * 4
        ir[:int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))
        chans.append(ir / np.sqrt(np.sum(ir ** 2)))
    return chans


def build():
    rng = np.random.default_rng(20261017)
    dry = [horn(rng, s) for s in (-1, 1)]
    irs = impulse(rng)
    tail = int(SR * 2.0)
    out = []
    for c in range(2):
        d = np.concatenate([dry[c], np.zeros(tail)])
        wet = fft_convolve(d, irs[c])[:len(d)]
        x = d * 0.72 + wet * 0.55
        out.append(x)
    st = np.stack(out, -1)
    # a fade on the last half second of the tail, a gentle high cut, normalised to -1 dBFS
    n = st.shape[0]
    fade = np.ones(n)
    k = int(SR * 0.5)
    fade[-k:] = np.linspace(1, 0, k) ** 2
    st *= fade[:, None]
    st = np.stack([one_pole_lp(st[:, c], 9000) for c in range(2)], -1)
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
    ap.add_argument('--out', default=os.path.join(GAME, 'public', 'audio', 'beacon', 'watcher-horn.ogg'))
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
