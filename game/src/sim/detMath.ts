// Platform-independent Math.pow for the sim (docs/MULTIPLAYER.md "Cross-platform determinism check").
//
// Lockstep multiplayer needs every client to compute the same bits. JS + - * / and Math.sqrt are exactly rounded, but
// Math.pow is whatever the engine's C++ library does: the same Electron (V8 15.2) gives results 1 ulp apart on Linux
// x64 and macOS arm64 for ~0.1-3% of non-trivial inputs (pow(d, 1.8), pow(x, 0.75), pow(x, 4), pow(1.25, k); measured
// with scripts/determinism-check.mjs). This is a plain-JS port of V8 12's fdlibm-derived pow (v8 src/base/ieee754.cc
// pow at 12.4.254, from fdlibm e_pow.c), so it gives the same result on every engine and CPU and equals Node 22's
// Math.pow bit for bit (the pins were recorded with it). (V8 15 replaced it with LLVM libc's pow, which is why the
// Electron 44 app's Math.pow differs from Node 22's, and which still differs between x64 and arm64.)
// The sim calls detPow, never Math.pow; `x ** 2` (exact: x * x) is fine.

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
// Index of the high word (sign / exponent) in u32: 1 on little-endian hosts.
const HI = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 1 : 0;
const LO = 1 - HI;

function hiWord(x: number): number {
    f64[0] = x;
    return u32[HI] | 0;
}
function loWord(x: number): number {
    f64[0] = x;
    return u32[LO] >>> 0;
}
/** x with its low word zeroed. */
function clearLo(x: number): number {
    f64[0] = x;
    u32[LO] = 0;
    return f64[0];
}
function withHi(x: number, hi: number): number {
    f64[0] = x;
    u32[HI] = hi >>> 0;
    return f64[0];
}
function fromHi(hi: number): number {
    u32[HI] = hi >>> 0;
    u32[LO] = 0;
    return f64[0];
}

const two54 = 1.80143985094819840000e16;
const twom54 = 5.55111512312578270212e-17;
// fdlibm s_scalbn.c
function scalbn(x: number, n: number): number {
    let k = (hiWord(x) & 0x7ff00000) >> 20;
    if (k === 0) {
        if (((hiWord(x) & 0x7fffffff) | loWord(x)) === 0) return x;
        x *= two54;
        k = ((hiWord(x) & 0x7ff00000) >> 20) - 54;
        if (n < -50000) return 1.0e-300 * x;
    }
    if (k === 0x7ff) return x + x;
    k = k + n;
    if (k > 0x7fe) return 1.0e300 * (x < 0 ? -1.0e300 : 1.0e300);
    if (k > 0) return withHi(x, (hiWord(x) & 0x800fffff) | (k << 20));
    if (k <= -54) {
        if (n > 50000) return 1.0e300 * (x < 0 ? -1.0e300 : 1.0e300);
        return 1.0e-300 * (x < 0 ? -1.0e-300 : 1.0e-300);
    }
    k += 54;
    return withHi(x, (hiWord(x) & 0x800fffff) | (k << 20)) * twom54;
}

const bp = [1.0, 1.5];
const dp_h = [0.0, 5.84962487220764160156e-01];
const dp_l = [0.0, 1.35003920212974897128e-08];
const two53 = 9007199254740992.0;
const huge = 1.0e300;
const tiny = 1.0e-300;
const L1 = 5.99999999999994648725e-01;
const L2 = 4.28571428578550184252e-01;
const L3 = 3.33333329818377432918e-01;
const L4 = 2.72728123808534006489e-01;
const L5 = 2.30660745775561754067e-01;
const L6 = 2.06975017800338417784e-01;
const P1 = 1.66666666666666019037e-01;
const P2 = -2.77777777770155933842e-03;
const P3 = 6.61375632143793436117e-05;
const P4 = -1.65339022054652515390e-06;
const P5 = 4.13813679705723846039e-08;
const lg2 = 6.93147180559945286227e-01;
const lg2_h = 6.93147182464599609375e-01;
const lg2_l = -1.90465429995776804525e-09;
const ovt = 8.0085662595372944372e-17;
const cp = 9.61796693925975554329e-01;
const cp_h = 9.61796700954437255859e-01;
const cp_l = -7.02846165095275826516e-09;
const ivln2 = 1.44269504088896338700e+00;
const ivln2_h = 1.44269502162933349609e+00;
const ivln2_l = 1.92596299112661746887e-08;

/** Math.pow(x, y), bit-identical on every platform (fdlibm e_pow.c with the ECMAScript special cases). */
export function detPow(x: number, y: number): number {
    // ECMAScript Number::exponentiate differs from C pow here: y NaN → NaN; |x| = 1 with y ±Infinity → NaN.
    if (y !== y) return NaN;
    if ((x === 1 || x === -1) && (y === Infinity || y === -Infinity)) return NaN;

    const hx = hiWord(x), lx = loWord(x);
    const hy = hiWord(y), ly = loWord(y);
    let ix = hx & 0x7fffffff;
    const iy = hy & 0x7fffffff;

    if ((iy | ly) === 0) return 1.0;
    if (ix > 0x7ff00000 || (ix === 0x7ff00000 && lx !== 0) || iy > 0x7ff00000 || (iy === 0x7ff00000 && ly !== 0)) return x + y;

    // yisint: 0 = y not an integer, 1 = odd integer, 2 = even integer (only needed for x < 0).
    let yisint = 0;
    let j: number, k: number;
    if (hx < 0) {
        if (iy >= 0x43400000) yisint = 2;
        else if (iy >= 0x3ff00000) {
            k = (iy >> 20) - 0x3ff;
            if (k > 20) {
                j = ly >>> (52 - k);
                if (((j << (52 - k)) >>> 0) === ly) yisint = 2 - (j & 1);
            } else if (ly === 0) {
                j = iy >> (20 - k);
                if ((j << (20 - k)) === iy) yisint = 2 - (j & 1);
            }
        }
    }

    if (ly === 0) {
        if (iy === 0x7ff00000) {
            if (((ix - 0x3ff00000) | lx) === 0) return y - y;
            else if (ix >= 0x3ff00000) return hy >= 0 ? y : 0.0;
            else return hy < 0 ? -y : 0.0;
        }
        if (iy === 0x3ff00000) return hy < 0 ? 1.0 / x : x;
        if (hy === 0x40000000) return x * x;
        if (hy === 0x3fe00000 && hx >= 0) return Math.sqrt(x);
    }

    let ax = Math.abs(x);
    if (lx === 0) {
        if (ix === 0x7ff00000 || ix === 0 || ix === 0x3ff00000) {
            let z = ax;
            if (hy < 0) z = 1.0 / z;
            if (hx < 0) {
                if (((ix - 0x3ff00000) | yisint) === 0) z = (z - z) / (z - z);
                else if (yisint === 1) z = -z;
            }
            return z;
        }
    }

    let n = (hx >> 31) + 1;
    if ((n | yisint) === 0) return (x - x) / (x - x);

    let s = 1.0;
    if ((n | (yisint - 1)) === 0) s = -1.0;

    let t: number, t1: number, t2: number, u: number, v: number, w: number;
    if (iy > 0x41e00000) {
        if (iy > 0x43f00000) {
            if (ix <= 0x3fefffff) return hy < 0 ? huge * huge : tiny * tiny;
            if (ix >= 0x3ff00000) return hy > 0 ? huge * huge : tiny * tiny;
        }
        if (ix < 0x3fefffff) return hy < 0 ? s * huge * huge : s * tiny * tiny;
        if (ix > 0x3ff00000) return hy > 0 ? s * huge * huge : s * tiny * tiny;
        t = ax - 1.0;
        w = (t * t) * (0.5 - t * (0.3333333333333333333333 - t * 0.25));
        u = ivln2_h * t;
        v = t * ivln2_l - w * ivln2;
        t1 = clearLo(u + v);
        t2 = v - (t1 - u);
    } else {
        n = 0;
        if (ix < 0x00100000) {
            ax *= two53;
            n -= 53;
            ix = hiWord(ax);
        }
        n += (ix >> 20) - 0x3ff;
        j = ix & 0x000fffff;
        ix = j | 0x3ff00000;
        if (j <= 0x3988e) k = 0;
        else if (j < 0xbb67a) k = 1;
        else {
            k = 0;
            n += 1;
            ix -= 0x00100000;
        }
        ax = withHi(ax, ix);

        u = ax - bp[k];
        v = 1.0 / (ax + bp[k]);
        const ss = u * v;
        const s_h = clearLo(ss);
        let t_h = fromHi(((ix >> 1) | 0x20000000) + 0x00080000 + (k << 18));
        let t_l = ax - (t_h - bp[k]);
        const s_l = v * ((u - s_h * t_h) - s_h * t_l);
        let s2 = ss * ss;
        let r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))));
        r += s_l * (s_h + ss);
        s2 = s_h * s_h;
        t_h = clearLo(3.0 + s2 + r);
        t_l = r - ((t_h - 3.0) - s2);
        u = s_h * t_h;
        v = s_l * t_h + t_l * ss;
        const p_h = clearLo(u + v);
        const p_l = v - (p_h - u);
        const z_h = cp_h * p_h;
        const z_l = cp_l * p_h + p_l * cp + dp_l[k];
        t = n;
        t1 = clearLo(((z_h + z_l) + dp_h[k]) + t);
        t2 = z_l - (((t1 - t) - dp_h[k]) - z_h);
    }

    const y1 = clearLo(y);
    const p_l = (y - y1) * t1 + y * t2;
    let p_h = y1 * t1;
    let z = p_l + p_h;
    j = hiWord(z);
    let i = loWord(z) | 0;
    if (j >= 0x40900000) {
        if (((j - 0x40900000) | i) !== 0) return s * huge * huge;
        if (p_l + ovt > z - p_h) return s * huge * huge;
    } else if ((j & 0x7fffffff) >= 0x4090cc00) {
        if (((j - (0xc090cc00 | 0)) | i) !== 0) return s * tiny * tiny;
        if (p_l <= z - p_h) return s * tiny * tiny;
    }

    i = j & 0x7fffffff;
    k = (i >> 20) - 0x3ff;
    n = 0;
    if (i > 0x3fe00000) {
        n = j + (0x00100000 >> (k + 1));
        k = ((n & 0x7fffffff) >> 20) - 0x3ff;
        t = fromHi(n & ~(0x000fffff >> k));
        n = ((n & 0x000fffff) | 0x00100000) >> (20 - k);
        if (j < 0) n = -n;
        p_h -= t;
    }
    t = clearLo(p_l + p_h);
    u = t * lg2_h;
    v = (p_l - (t - p_h)) * lg2 + t * lg2_l;
    z = u + v;
    w = v - (z - u);
    t = z * z;
    t1 = z - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
    // V8's port divides by ((t1 - 2) - (w + z * w)); fdlibm's e_pow.c has (z * t1) / (t1 - 2) - (w + z * w).
    const r = (z * t1) / ((t1 - 2.0) - (w + z * w));
    z = 1.0 - (r - z);
    j = hiWord(z);
    j += n << 20;
    if (j >> 20 <= 0) z = scalbn(z, n);
    else z = withHi(z, hiWord(z) + (n << 20));
    return s * z;
}
