// Seed pins (tasks/M4-plan.md §5.3.4). Exact seed-dependent values (digests, names, counts, draw sequences) live in
// test/pins/seed1.json, keyed '<scenario>.<name>'; a test asserts them with
//
//     expect(actual).toMatchPin('createGameFull.summary');          // value from seed1.json
//     expect(actual).toMatchPin('startingColonies.inhabited', 1);   // literal kept in place (listed in manifest.json)
//
// and `npm run repin -- --reason "<why>"` (scripts/repin.mjs) recomputes every pin by running the pinned tests with
// DWU_PIN_CAPTURE=<dir>: in that mode toMatchPin records the actual value (and passes) instead of asserting, so the
// values come from the tests' own construction code. Keep the reason comment above each pin; repin appends to it.
import { expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const GOLDEN_FILE = join(__dirname, 'seed1.json');

let golden: Record<string, Record<string, unknown>> | null = null;

function lookup(key: string): { found: boolean; value: unknown } {
    golden ??= JSON.parse(readFileSync(GOLDEN_FILE, 'utf8')) as Record<string, Record<string, unknown>>;
    const dot = key.indexOf('.');
    const group = dot < 0 ? undefined : golden[key.slice(0, dot)];
    const name = key.slice(dot + 1);
    if (group === undefined || !Object.prototype.hasOwnProperty.call(group, name)) return { found: false, value: undefined };
    return { found: true, value: group[name] };
}

/** The pinned value for `key` ('<scenario>.<name>') from test/pins/seed1.json. */
export function pin<T = unknown>(key: string): T {
    const r = lookup(key);
    if (!r.found) throw new Error(`seed pin '${key}' is missing from test/pins/seed1.json (run npm run repin -- --reason "<why>")`);
    return r.value as T;
}

const captureDir = process.env.DWU_PIN_CAPTURE;
let captureSeq = 0;

function capture(key: string, actual: unknown, expected: unknown, inline: boolean): void {
    const json = JSON.stringify(actual);
    if (json === undefined || JSON.stringify(JSON.parse(json)) !== json || !deepEqualJson(JSON.parse(json), actual)) {
        throw new Error(`seed pin '${key}': the value does not survive a JSON round trip (NaN, Infinity, -0, Map, class instance?)`);
    }
    mkdirSync(captureDir!, { recursive: true });
    const state = expect.getState();
    writeFileSync(join(captureDir!, `${key}~${process.pid}~${captureSeq++}.json`),
        JSON.stringify({ key, actual, expected, inline, testPath: state.testPath, test: state.currentTestName }));
}

function deepEqualJson(a: unknown, b: unknown): boolean {
    if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b);
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(b) ? false : Object.getPrototypeOf(b) !== Object.prototype) return false;
    const ka = Object.keys(a as object), kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqualJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

expect.extend({
    toMatchPin(received: unknown, key: string, ...inline: unknown[]) {
        const isInline = inline.length > 0;
        const golden = isInline ? { found: true, value: inline[0] } : lookup(key);
        if (captureDir) {
            capture(key, received, golden.value, isInline);
            return { pass: true, message: () => `seed pin '${key}' captured` };
        }
        if (!golden.found) {
            return { pass: false, message: () => `seed pin '${key}' is missing from test/pins/seed1.json (run npm run repin -- --reason "<why>")` };
        }
        const pass = this.equals(received, golden.value);
        return {
            pass,
            message: () => `seed pin '${key}' ${pass ? 'unexpectedly matched' : 'moved'}: if the simulation now legitimately draws Rnd differently, run \`npm run repin -- --reason "<why>"\``,
            actual: received,
            expected: golden.value,
        };
    },
});

declare module 'vitest' {
    interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
        /** Seed pin: `received` equals the value pinned under `key` in test/pins/seed1.json (or the in-place literal `inline`). */
        toMatchPin(key: string, inline?: unknown): R;
    }
}
