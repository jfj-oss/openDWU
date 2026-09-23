// Port of the .NET Framework System.Random legacy seeded algorithm
// (.NET reference source, System.Random). All sim randomness must go
// through this class (see CLAUDE.md).

const MBIG = 2147483647; // int.MaxValue
const MSEED = 161803398;
const INT_MAX = 2147483647;
const INT_MIN = -2147483648;

export class Random {
    private seedArray: number[];
    private inext: number;
    private inextp: number;

    constructor(seed: number) {
        this.seedArray = new Array<number>(56).fill(0);
        const subtraction = seed === INT_MIN ? INT_MAX : Math.abs(seed);
        let mj = MSEED - subtraction;
        this.seedArray[55] = mj;
        let mk = 1;
        for (let i = 1; i < 55; i++) {
            const ii = (21 * i) % 55;
            this.seedArray[ii] = mk;
            mk = mj - mk;
            if (mk < 0) {
                mk += MBIG;
            }
            mj = this.seedArray[ii];
        }
        for (let k = 1; k < 5; k++) {
            for (let i = 1; i < 56; i++) {
                // int32 wrap, like C# int arithmetic.
                this.seedArray[i] = (this.seedArray[i] - this.seedArray[1 + ((i + 30) % 55)]) | 0;
                if (this.seedArray[i] < 0) {
                    this.seedArray[i] += MBIG;
                }
            }
        }
        this.inext = 0;
        this.inextp = 21;
    }

    private internalSample(): number {
        if (++this.inext >= 56) {
            this.inext = 1;
        }
        if (++this.inextp >= 56) {
            this.inextp = 1;
        }
        let ret = this.seedArray[this.inext] - this.seedArray[this.inextp];
        if (ret === MBIG) {
            ret--;
        }
        if (ret < 0) {
            ret += MBIG;
        }
        this.seedArray[this.inext] = ret;
        return ret;
    }

    /** Sample() = InternalSample() * (1.0 / MBIG) */
    private sample(): number {
        return this.internalSample() * (1.0 / MBIG);
    }

    next(): number;
    next(maxValue: number): number;
    next(minValue: number, maxValue: number): number;
    next(...args: number[]): number {
        if (args.length === 0) {
            // Next() = InternalSample()
            return this.internalSample();
        }
        if (args.length === 1) {
            // Next(max) = (int)(Sample() * max)
            const maxValue = args[0];
            return Math.trunc(this.sample() * maxValue);
        }
        // Next(min, max): range = (long)max - min
        const minValue = args[0];
        const maxValue = args[1];
        const range = maxValue - minValue;
        if (range <= INT_MAX) {
            return Math.trunc(this.sample() * range) + minValue;
        }
        return Math.trunc(this.getSampleForLargeRange() * range) + minValue;
    }

    // GetSampleForLargeRange(): result = InternalSample(); negative = InternalSample() % 2 == 0;
    // if (negative) result = -result; d = result + (int.MaxValue - 1); d /= 2 * (uint)int.MaxValue - 1
    private getSampleForLargeRange(): number {
        let result = this.internalSample();
        const negative = this.internalSample() % 2 === 0;
        if (negative) {
            result = -result;
        }
        let d = result;
        d += INT_MAX - 1;
        d /= 2 * INT_MAX - 1;
        return d;
    }

    // NextDouble() = Sample()
    nextDouble(): number {
        return this.sample();
    }
}