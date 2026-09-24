// Port of .NET's List<T>.Sort() / Array.Sort (System.Collections.Generic.
// ArraySortHelper<T>.IntrospectiveSort, .NET Core 3+/5+ — the runtime the
// DistantWorldsExpanded decompile targets). The sort is unstable, so ports
// that sort items with equal keys (e.g. ResourceDefinitionList.
// SortByRelativeImportance) must use this to get the same order as the C#.

const INTROSORT_SIZE_THRESHOLD = 16;

function log2(n: number): number {
    return 31 - Math.clz32(n);
}

/** In-place .NET-compatible introsort over `keys` with `compare`. */
export function netSort<T>(keys: T[], compare: (a: T, b: T) => number): void {
    if (keys.length > 1) {
        introSort(keys, 0, keys.length - 1, 2 * (log2(keys.length) + 1), compare);
    }
}

function swapIfGreater<T>(keys: T[], compare: (a: T, b: T) => number, i: number, j: number): void {
    if (compare(keys[i], keys[j]) > 0) {
        const t = keys[i];
        keys[i] = keys[j];
        keys[j] = t;
    }
}

function swap<T>(a: T[], i: number, j: number): void {
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
}

function introSort<T>(keys: T[], lo: number, hi: number, depthLimit: number, compare: (a: T, b: T) => number): void {
    while (hi > lo) {
        const partitionSize = hi - lo + 1;
        if (partitionSize <= INTROSORT_SIZE_THRESHOLD) {
            if (partitionSize === 1) return;
            if (partitionSize === 2) {
                swapIfGreater(keys, compare, lo, hi);
                return;
            }
            if (partitionSize === 3) {
                swapIfGreater(keys, compare, lo, hi - 1);
                swapIfGreater(keys, compare, lo, hi);
                swapIfGreater(keys, compare, hi - 1, hi);
                return;
            }
            insertionSort(keys, lo, hi, compare);
            return;
        }
        if (depthLimit === 0) {
            heapSort(keys, lo, hi, compare);
            return;
        }
        depthLimit--;
        const p = pickPivotAndPartition(keys, lo, hi, compare);
        introSort(keys, p + 1, hi, depthLimit, compare);
        hi = p - 1;
    }
}

function pickPivotAndPartition<T>(keys: T[], lo: number, hi: number, compare: (a: T, b: T) => number): number {
    const middle = lo + ((hi - lo) >> 1);
    swapIfGreater(keys, compare, lo, middle);
    swapIfGreater(keys, compare, lo, hi);
    swapIfGreater(keys, compare, middle, hi);
    const pivot = keys[middle];
    swap(keys, middle, hi - 1);
    let left = lo;
    let right = hi - 1;
    while (left < right) {
        while (compare(keys[++left], pivot) < 0) {
            // advance
        }
        while (compare(pivot, keys[--right]) < 0) {
            // retreat
        }
        if (left >= right) break;
        swap(keys, left, right);
    }
    if (left !== hi - 1) swap(keys, left, hi - 1);
    return left;
}

function heapSort<T>(keys: T[], lo: number, hi: number, compare: (a: T, b: T) => number): void {
    const n = hi - lo + 1;
    for (let i = n >> 1; i >= 1; i--) downHeap(keys, i, n, lo, compare);
    for (let i = n; i > 1; i--) {
        swap(keys, lo, lo + i - 1);
        downHeap(keys, 1, i - 1, lo, compare);
    }
}

function downHeap<T>(keys: T[], i: number, n: number, lo: number, compare: (a: T, b: T) => number): void {
    const d = keys[lo + i - 1];
    while (i <= n >> 1) {
        let child = 2 * i;
        if (child < n && compare(keys[lo + child - 1], keys[lo + child]) < 0) child++;
        if (!(compare(d, keys[lo + child - 1]) < 0)) break;
        keys[lo + i - 1] = keys[lo + child - 1];
        i = child;
    }
    keys[lo + i - 1] = d;
}

function insertionSort<T>(keys: T[], lo: number, hi: number, compare: (a: T, b: T) => number): void {
    for (let i = lo; i < hi; i++) {
        let j = i;
        const t = keys[i + 1];
        while (j >= lo && compare(t, keys[j]) < 0) {
            keys[j + 1] = keys[j];
            j--;
        }
        keys[j + 1] = t;
    }
}
