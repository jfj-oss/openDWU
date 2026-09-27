// Offline level / spectrum measurements for synthesised sounds (19i audio addendum: scripts/rim-voices-render.mjs
// renders each voice with an OfflineAudioContext and prints these numbers so a reviewer can judge the voices
// without listening). Pure: plain Float32Arrays in, numbers out.

export interface SignalStats {
    /** Peak |sample| over all channels, dBFS. */
    peakDb: number;
    /** RMS over the active span (first to last sample above -50 dB re peak), dBFS. */
    rmsDb: number;
    /** Active span in seconds (-50 dB re peak). */
    activeS: number;
    /** Magnitude-weighted spectral centroid of the mono sum, Hz (2048-point Hann frames, hop 1024). */
    centroidHz: number;
    /** RMS of each channel over the active span, dBFS (pan check). */
    channelRmsDb: number[];
}

const db = (x: number): number => (x > 0 ? 20 * Math.log10(x) : -Infinity);

/** In-place iterative radix-2 FFT (re/im of length 2^k). */
export function fft(re: Float64Array, im: Float64Array): void {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            [re[i], re[j]] = [re[j], re[i]];
            [im[i], im[j]] = [im[j], im[i]];
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = (-2 * Math.PI) / len;
        const wr = Math.cos(ang);
        const wi = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
            let cr = 1;
            let ci = 0;
            for (let k = 0; k < len / 2; k++) {
                const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
                const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
                re[i + k + len / 2] = re[i + k] - ar;
                im[i + k + len / 2] = im[i + k] - ai;
                re[i + k] += ar;
                im[i + k] += ai;
                const nr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = nr;
            }
        }
    }
}

/** Magnitude-weighted spectral centroid (Hz) of `x`, averaged over Hann-windowed frames. */
export function spectralCentroid(x: Float32Array | Float64Array, sampleRate: number, frame = 2048): number {
    const hop = frame / 2;
    const re = new Float64Array(frame);
    const im = new Float64Array(frame);
    let num = 0;
    let den = 0;
    for (let start = 0; start + frame <= x.length; start += hop) {
        for (let i = 0; i < frame; i++) {
            re[i] = x[start + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frame - 1)));
            im[i] = 0;
        }
        fft(re, im);
        for (let k = 1; k < frame / 2; k++) {
            const m = Math.hypot(re[k], im[k]);
            num += m * ((k * sampleRate) / frame);
            den += m;
        }
    }
    return den > 0 ? num / den : 0;
}

export function signalStats(channels: readonly (Float32Array | Float64Array)[], sampleRate: number): SignalStats {
    const n = channels[0]?.length ?? 0;
    let peak = 0;
    for (const c of channels) for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(c[i]));
    const floor = peak * Math.pow(10, -50 / 20);
    let first = n;
    let last = -1;
    for (let i = 0; i < n; i++) {
        for (const c of channels) {
            if (Math.abs(c[i]) > floor) {
                if (i < first) first = i;
                last = i;
            }
        }
    }
    if (last < first) return { peakDb: -Infinity, rmsDb: -Infinity, activeS: 0, centroidHz: 0, channelRmsDb: channels.map(() => -Infinity) };
    const channelRmsDb: number[] = [];
    let total = 0;
    for (const c of channels) {
        let s = 0;
        for (let i = first; i <= last; i++) s += c[i] * c[i];
        total += s;
        channelRmsDb.push(db(Math.sqrt(s / (last - first + 1))));
    }
    const mono = new Float64Array(last - first + 1);
    for (const c of channels) for (let i = first; i <= last; i++) mono[i - first] += c[i] / channels.length;
    return {
        peakDb: db(peak),
        rmsDb: db(Math.sqrt(total / (channels.length * (last - first + 1)))),
        activeS: (last - first + 1) / sampleRate,
        centroidHz: spectralCentroid(mono, sampleRate),
        channelRmsDb,
    };
}
