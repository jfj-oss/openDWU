// Sim worker: the replica encoder's packed shadow store (docs/sim-worker.md §3.1 "Identity and the shadow").
//
// The encoder keeps, for every synced object, the values it last sent (its SHADOW), and compares the live object with
// it after each step. One JS array per object (2-3 M of them on a 100k-habitat galaxy, most fields boxed doubles) took
// ~340 MB of the worker's heap — which shares V8's pointer-compression cage with the page. Here the shadows are packed:
//
// - FieldTable: the class / plain-object instances of one shape, one ROW each (a stable slot, reused once freed), one
//   COLUMN per field. A column is a Uint8Array (the field has only held true / false / null / undefined), an Int32Array
//   (only int32 numbers), a Float64Array (only numbers) or a JS array (anything else: references, strings, mixed — the
//   only lane that can hold an object). A field starts in the lane of its first instance's value and WIDENS (Imm → Ref,
//   I32 → F64 → Ref, for the whole shape) the first time a value does not fit; the encoder then regenerates the shape's
//   compare functions. Numbers in the typed lanes are exact (−0 and NaN included: −0 never goes to the I32 lane), so a
//   compare against the store is the same SameValue compare as before.
// - ListTable: arrays, Maps (k, v, k, v, …), Sets and typed-array copies, a row each: the shadow's values as a JS array,
//   or null while empty (most of a galaxy's arrays are empty lists).
//
// Columns and lists grow by doubling; rows of dropped objects go to a free list. Only the Ref lane and the lists hold
// references, so only they are scanned by the encoder's reachability mark. No DOM / Pixi imports.

/** The storage lane of a shape slot. */
export const enum Lane {
    /** Uint8Array: true / false / null / undefined, as their ImmCode. */
    Imm = 3,
    /** Int32Array: int32 numbers (not −0). */
    I32 = 0,
    /** Float64Array: any number. */
    F64 = 1,
    /** JS array: any value. */
    Ref = 2,
}

export type Column = Uint8Array | Int32Array | Float64Array | unknown[];

/** The Imm lane's codes (the index of the value in IMM_VALUES); NOT_IMM: any other value. */
export const enum ImmCode {
    False = 0,
    True = 1,
    Null = 2,
    Undefined = 3,
    NotImm = 4,
}

const IMM_VALUES: readonly unknown[] = [false, true, null, undefined];

/** The Imm lane's code for `v`. */
export function immCode(v: unknown): ImmCode {
    return v === false ? ImmCode.False : v === true ? ImmCode.True : v === null ? ImmCode.Null : v === undefined ? ImmCode.Undefined : ImmCode.NotImm;
}

/** The value of an Imm lane code. */
export function immValue(code: number): unknown {
    return IMM_VALUES[code];
}

/** Whether `v` is an int32 the I32 lane stores exactly (−0 is not: the sign bit is state). */
function isInt32(v: unknown): boolean {
    return typeof v === 'number' && (v | 0) === v && (v !== 0 || 1 / v > 0);
}

/** The lane a slot starts in, from its first value. */
export function laneOf(v: unknown): Lane {
    if (isInt32(v)) return Lane.I32;
    if (typeof v === 'number') return Lane.F64;
    return immCode(v) === ImmCode.NotImm ? Lane.Ref : Lane.Imm;
}

/** Whether `lane` stores `v` exactly. */
function fits(lane: Lane, v: unknown): boolean {
    switch (lane) {
        case Lane.Ref:
            return true;
        case Lane.F64:
            return typeof v === 'number';
        case Lane.I32:
            return isInt32(v);
        case Lane.Imm:
            return immCode(v) !== ImmCode.NotImm;
    }
}

/** The lane a slot of `lane` widens to for a value `v` it does not store. */
function widerLane(lane: Lane, v: unknown): Lane {
    return lane === Lane.I32 && typeof v === 'number' ? Lane.F64 : Lane.Ref;
}

function newColumn(lane: Lane, cap: number): Column {
    if (lane === Lane.Imm) return new Uint8Array(cap);
    if (lane === Lane.I32) return new Int32Array(cap);
    if (lane === Lane.F64) return new Float64Array(cap);
    return new Array<unknown>(cap).fill(undefined);
}

/** A copy of `col` (in lane `from`)'s first `n` rows in a new column of lane `to` with capacity `cap`. */
function copyColumn(col: Column, from: Lane, to: Lane, cap: number, n: number): Column {
    const out = newColumn(to, cap);
    if (from === Lane.Imm && to === Lane.Ref) for (let r = 0; r < n; r++) out[r] = immValue(col[r] as number);
    else if (to !== Lane.Ref) (out as Int32Array).set((col as Int32Array).subarray(0, n));
    else for (let r = 0; r < n; r++) out[r] = col[r];
    return out;
}

/** Rows a new table starts with (most shapes have a handful of instances: plain objects, rare classes). */
const MIN_ROWS = 4;

/** The shadows of one shape's instances: a row per object, a column per field (see the file header). */
export class FieldTable {
    readonly lanes: Uint8Array;
    /**
     * Column per slot. The array itself is never replaced (generated compares hold it across a call), only its
     * elements, when the table grows or a slot widens.
     */
    readonly cols: Column[];
    /** Slots in the Ref lane, ascending (the only ones that can hold an object). */
    readonly refSlots: number[] = [];
    private cap = 0;
    /** Rows handed out so far (high-water mark); rows below it not in use are in `free`. */
    private top = 0;
    private readonly free: number[] = [];

    constructor(lanes: readonly Lane[]) {
        this.lanes = Uint8Array.from(lanes);
        this.cols = lanes.map((l) => newColumn(l, 0));
        lanes.forEach((l, i) => {
            if (l === Lane.Ref) this.refSlots.push(i);
        });
    }

    /** A row for a new shadow (its values are set by the caller). */
    alloc(): number {
        if (this.free.length > 0) return this.free.pop()!;
        if (this.top === this.cap) this.grow();
        return this.top++;
    }

    /** Free a row (its references are cleared, so the store keeps nothing alive). */
    release(row: number): void {
        for (const s of this.refSlots) (this.cols[s] as unknown[])[row] = undefined;
        this.free.push(row);
    }

    get(row: number, slot: number): unknown {
        const v = this.cols[slot][row];
        return this.lanes[slot] === Lane.Imm ? immValue(v as number) : v;
    }

    /** Store `v` at (row, slot), widening the slot's lane when `v` does not fit. Returns whether it widened. */
    set(row: number, slot: number, v: unknown): boolean {
        let widened = false;
        if (!fits(this.lanes[slot] as Lane, v)) {
            this.widen(slot, v);
            widened = true;
        }
        this.cols[slot][row] = (this.lanes[slot] === Lane.Imm ? immCode(v) : v) as number;
        return widened;
    }

    /** Move `slot` to the narrowest wider lane that holds `v` (I32 → F64 for a number, else → Ref), every row. */
    private widen(slot: number, v: unknown): void {
        const from = this.lanes[slot] as Lane;
        const lane = widerLane(from, v);
        this.cols[slot] = copyColumn(this.cols[slot], from, lane, this.cap, this.top);
        this.lanes[slot] = lane;
        if (lane === Lane.Ref) {
            let at = this.refSlots.length;
            while (at > 0 && this.refSlots[at - 1] > slot) at--;
            this.refSlots.splice(at, 0, slot);
        }
    }

    private grow(): void {
        this.cap = Math.max(MIN_ROWS, this.cap * 2);
        for (let s = 0; s < this.cols.length; s++) this.cols[s] = copyColumn(this.cols[s], this.lanes[s] as Lane, this.lanes[s] as Lane, this.cap, this.top);
    }
}

/** The shadows of arrays, Maps, Sets and typed arrays: a row each, its values (null: none). */
export class ListTable {
    readonly vals: (unknown[] | null)[] = [];
    private readonly free: number[] = [];

    alloc(): number {
        if (this.free.length > 0) return this.free.pop()!;
        this.vals.push(null);
        return this.vals.length - 1;
    }

    release(row: number): void {
        this.vals[row] = null;
        this.free.push(row);
    }
}
