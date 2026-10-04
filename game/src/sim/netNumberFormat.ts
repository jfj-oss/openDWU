// .NET Framework custom numeric format strings for doubles, the subset message texts use: "0", "0.0", "0.00", …
// and "0%" (System.Number.FormatDouble → NumberToStringFormat). Headless: no DOM imports.
//
// How .NET Framework formats a double with a custom format: the value is first converted to its 15 significant
// decimal digits (DoubleToNumber, precision 15 — so 0.010000000000000002 is "1.00000000000000E-2"); a '%' in the
// format moves the decimal point two places right (in the digit string, not by a binary multiply); the digits are
// then rounded half away from zero at the format's last digit (RoundNumber: digit >= 5 rounds up). A value that
// rounds to zero prints without its minus sign.

/** The 15 significant digits of |value| and the decimal exponent of the first one (`d.dddd… × 10^exp`). */
function digits15(value: number): { digits: string; exp: number } {
    const s = Math.abs(value).toExponential(14); // "d.dddddddddddddde±x": correctly rounded to 15 significant digits
    const e = s.indexOf('e');
    return { digits: s.charAt(0) + s.substring(2, e), exp: Number(s.substring(e + 1)) };
}

/**
 * `value.ToString(format)` for a fixed-decimals custom format ("0" with `decimals` = 0, "0.0" with 1, …), the value
 * scaled by 10^`scalePow10` first ("0%" = decimals 0, scale 2, then the '%' appended by the caller).
 */
export function formatNetFixed(value: number, decimals: number, scalePow10 = 0): string {
    if (!Number.isFinite(value)) return Number.isNaN(value) ? 'NaN' : value > 0 ? 'Infinity' : '-Infinity';
    let out: string;
    if (value === 0) {
        out = '0'.repeat(decimals + 1);
    } else {
        const { digits, exp } = digits15(value);
        const pointAt = exp + scalePow10 + 1; // digits before the decimal point
        const keep = pointAt + decimals; // digits kept after rounding
        let kept: number[];
        if (keep < 0) {
            kept = [];
        } else {
            kept = digits.substring(0, keep).padEnd(keep, '0').split('').map(Number);
            if (keep < digits.length && digits.charCodeAt(keep) >= 53 /* '5' */) {
                let i = kept.length - 1;
                for (; i >= 0; i--) {
                    if (kept[i] < 9) {
                        kept[i]++;
                        break;
                    }
                    kept[i] = 0;
                }
                if (i < 0) kept.unshift(1);
            }
        }
        // The kept digits as an integer string of the value × 10^(scale + decimals), at least decimals + 1 digits long.
        out = kept.join('').replace(/^0+/, '').padStart(decimals + 1, '0');
        if (/[1-9]/.test(out) && value < 0) out = '-' + out;
    }
    if (decimals === 0) return out;
    const neg = out.startsWith('-') ? '-' : '';
    const body = neg ? out.substring(1) : out;
    return `${neg}${body.substring(0, body.length - decimals)}.${body.substring(body.length - decimals)}`;
}

/** `value.ToString("0")`. */
export function formatNet0(value: number): string {
    return formatNetFixed(value, 0);
}

/** `value.ToString("0%")`: the percent rounded half away from zero, e.g. 0.010000000000000002 → "1%", 0.145 → "15%". */
export function formatNetPercent0(value: number): string {
    return formatNetFixed(value, 0, 2) + '%';
}
