import { describe, expect, it } from 'vitest';
import { SIM_WORKER_MIN_MEMORY_GIB, simWorkerDefault, systemMemoryGiB } from '../src/systemMemory';

function doc(content: string | null) {
    return { querySelector: () => (content === null ? null : { getAttribute: () => content }) };
}

describe('sim worker default by system RAM', () => {
    it('reads the page meta written by the dev server / desktop shell', () => {
        expect(systemMemoryGiB(doc('31.2'))).toBe(31.2);
        expect(systemMemoryGiB(doc('garbage'))).toBe(null);
        expect(systemMemoryGiB(doc(null))).toBe(null);
    });
    it('is on only with 16 GB+ (a 16 GB machine reports a little under 16 GiB)', () => {
        expect(simWorkerDefault(7.7)).toBe(false); // 8 GB Mac
        expect(simWorkerDefault(15.5)).toBe(true); // 16 GB with reserved memory
        expect(simWorkerDefault(32)).toBe(true);
        expect(simWorkerDefault(null)).toBe(false); // unknown: in-thread
        expect(SIM_WORKER_MIN_MEMORY_GIB).toBeLessThan(15.5);
    });
});
