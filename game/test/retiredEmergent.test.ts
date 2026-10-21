import { describe, expect, it } from 'vitest';
import { migrateRetiredAddonState } from '../src/sim/scenario/retired';
import type { Galaxy } from '../src/sim/galaxy';

describe('Emergent Galaxy is removed from a loaded save (off while reworked)', () => {
    it('clears its flag and state and withdraws its pending plot decisions, leaving other decisions', () => {
        const plot = { id: 1, kind: 'politics.plot' };
        const other = { id: 2, kind: 'exchange.buyIntel' };
        const g = { scenario: { flags: { internalPolitics: true }, params: {}, state: { politics: { entries: [] }, decisions: { pending: [plot, other], history: [], nextId: 3 } } } } as unknown as Galaxy;
        migrateRetiredAddonState(g);
        const s = g.scenario!;
        expect(s.flags['internalPolitics']).toBe(false);
        expect('politics' in s.state).toBe(false);
        expect((s.state['decisions'] as { pending: unknown[] }).pending).toEqual([other]);
    });
    it('leaves a save without it untouched', () => {
        const g = { scenario: { flags: { reputation: true }, params: {}, state: { reputation: {} } } } as unknown as Galaxy;
        migrateRetiredAddonState(g);
        expect(g.scenario!.flags).toEqual({ reputation: true });
        expect(Object.keys(g.scenario!.state)).toEqual(['reputation']);
    });
});
