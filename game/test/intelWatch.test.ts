// The Intelligence screen's page switching model and "new information" tracking (ui/intelWatch.ts).
import { describe, expect, it } from 'vitest';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { EmpireMessage, EmpireMessageType } from '../src/sim/messages';
import { NOTICE_THROTTLE_MS, intelUnseen, nextIntelPage, pollIntel, setIntelPageOpen, type IntelEntries, type IntelEntry } from '../src/ui/intelWatch';

const g = {} as Galaxy;
const emp = (): Empire => ({ messageHistory: [], messages: [] }) as unknown as Empire;
const e = (key: string, target: unknown = null): IntelEntry => ({ key, target });
const ents = (threats: IntelEntry[], knowledge: IntelEntry[] = []): IntelEntries => ({ threats, knowledge });

describe('page switching', () => {
    it('opens a page from either page and the open page toggles back', () => {
        expect(nextIntelPage('characters', 'threats')).toBe('threats');
        expect(nextIntelPage('threats', 'knowledge')).toBe('knowledge');
        expect(nextIntelPage('knowledge', 'threats')).toBe('threats');
        expect(nextIntelPage('knowledge', 'knowledge')).toBe('characters');
        expect(nextIntelPage('threats', 'threats')).toBe('characters');
    });
});

describe('new information', () => {
    it('baselines on the first poll: a loaded game flashes and notifies nothing', () => {
        const a = emp();
        expect(pollIntel(g, a, 0, ents([e('t1')], [e('k1')]))).toBeNull();
        expect(intelUnseen(a)).toEqual({ threats: 0, knowledge: 0 });
    });

    it('a new row flashes its page until the page is opened, and a level rise is new', () => {
        const a = emp();
        pollIntel(g, a, 0, ents([e('site|suspected')]));
        pollIntel(g, a, 1000, ents([e('site|confirmed')]));
        expect(intelUnseen(a).threats).toBe(2 - 1); // the baseline row is gone; the confirmed one is unseen
        setIntelPageOpen(a, 'threats');
        pollIntel(g, a, 2000, ents([e('site|confirmed')]), false);
        expect(intelUnseen(a)).toEqual({ threats: 0, knowledge: 0 });
        setIntelPageOpen(a, 'characters');
        pollIntel(g, a, 3000, ents([e('site|confirmed')]));
        expect(intelUnseen(a).threats).toBe(0); // stays quiet: flashing stops for good once seen
    });

    it('notifies once per entry and collapses a burst into one line', () => {
        const a = emp();
        pollIntel(g, a, 0, ents([], []));
        const n = pollIntel(g, a, 1000, ents([e('t1'), e('t2')], [e('k1')]));
        expect(n?.text).toBe('2 new entries on the Threats page and 1 new entry on the Knowledge page (Intelligence, F4).');
        expect(pollIntel(g, a, 2000, ents([e('t1'), e('t2')], [e('k1')]))).toBeNull(); // not announced twice
        expect(pollIntel(g, a, 3000, ents([e('t1'), e('t2'), e('t3')], [e('k1')]))).toBeNull(); // throttled
        const later = pollIntel(g, a, 1000 + NOTICE_THROTTLE_MS, ents([e('t1'), e('t2'), e('t3')], [e('k1')]));
        expect(later?.text).toBe('1 new entry on the Threats page (Intelligence, F4).');
    });

    it('a single entry carries its place as the message target, several do not', () => {
        const a = emp();
        const site = { name: 'x' };
        pollIntel(g, a, 0, ents([]));
        expect(pollIntel(g, a, 1000, ents([e('t1', site)]))?.target).toBe(site);
        expect(pollIntel(g, a, 50_000, ents([e('t1', site), e('t2', site), e('t3', site)]))?.target).toBeNull();
    });

    it('is silent for a page that is open, for tips, and for an entry the threat already sent a message about', () => {
        const a = emp();
        pollIntel(g, a, 0, ents([]));
        setIntelPageOpen(a, 'knowledge');
        expect(pollIntel(g, a, 1000, ents([], [e('k1')]))).toBeNull();
        setIntelPageOpen(a, 'characters');
        expect(pollIntel(g, a, 2000, ents([], [e('k1'), e('tip:do it')]))).toBeNull(); // a tip only flashes
        expect(intelUnseen(a).knowledge).toBe(0 + 1); // the tip
        const target = { name: 'Dark Farm' };
        (a.messageHistory as EmpireMessage[]).push(new EmpireMessage(null, EmpireMessageType.GeneralBadEvent, target));
        expect(pollIntel(g, a, 3000, ents([e('t1', target)]))).toBeNull();
    });

    it('keeps each empire apart (hot-seat / multiplayer)', () => {
        const a = emp();
        const b = emp();
        pollIntel(g, a, 0, ents([]));
        pollIntel(g, b, 0, ents([]));
        pollIntel(g, a, 1000, ents([e('t1')]));
        pollIntel(g, b, 1000, ents([]));
        expect(intelUnseen(a).threats).toBe(1);
        expect(intelUnseen(b).threats).toBe(0);
    });
});
