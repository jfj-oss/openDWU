import { describe, expect, it } from 'vitest';
import { EmpireMessage, EmpireMessageType } from '../src/sim/messages';
import { DiplomaticRelationType } from '../src/sim/diplomacy';
import type { Empire } from '../src/sim/empire';
import { createEmpireMessageFeed, formatEmpireMessage } from '../src/ui/empireMessageFeed';

function msg(sender: Empire | null, type: EmpireMessageType, description: string, subject: unknown = null): EmpireMessage {
    const m = new EmpireMessage(sender, type, subject);
    m.description = description;
    return m;
}

describe('formatEmpireMessage', () => {
    const player = { name: 'Us', messages: [] } as unknown as Empire;
    const zorg = { name: 'Zorg', messages: [] } as unknown as Empire;
    const f = (m: EmpireMessage): string | null => formatEmpireMessage(m, player);

    it('ports method_250 and the ReceiveMessageInternal ticker cases', () => {
        expect(f(msg(player, EmpireMessageType.ShipBaseCompleted, 'Frigate built'))).toBe('Frigate built');
        expect(f(msg(zorg, EmpireMessageType.Informational, 'Hello'))).toBe('Zorg says: Hello');
        expect(f(msg(zorg, EmpireMessageType.GalacticNewsNet, 'News'))).toBe('News');
        expect(f(msg(zorg, EmpireMessageType.Undefined, 'Raw'))).toBe('Raw');
        expect(f(msg(zorg, EmpireMessageType.Revolution, 'Uprising'))).toBe('Uprising');
        expect(f(msg(null, EmpireMessageType.Informational, 'Anon'))).toBe('Anon');
        expect(f(msg(player, EmpireMessageType.AdvisorSuggestion, 'Advice'))).toBeNull();
    });

    it('shows diplomatic messages only with a DiplomaticRelationType subject', () => {
        expect(f(msg(zorg, EmpireMessageType.DiplomaticRelationChange, 'War!', DiplomaticRelationType.War))).toBe('Zorg says: War!');
        expect(f(msg(zorg, EmpireMessageType.DiplomaticRelationChange, 'x', null))).toBeNull();
        expect(f(msg(zorg, EmpireMessageType.DiplomaticRelationChange, 'y', DiplomaticRelationType.NotMet))).toBe('Zorg says: y');
    });

    it('flattens newlines and drops empty text', () => {
        expect(f(msg(player, EmpireMessageType.Informational, 'Line one\nLine two'))).toBe('Line one Line two');
        expect(f(msg(player, EmpireMessageType.Informational, ''))).toBeNull();
    });
});

describe('createEmpireMessageFeed().poll', () => {
    it('returns [] for no empire', () => {
        expect(createEmpireMessageFeed().poll(null)).toEqual([]);
    });

    it('shows each message once, in queue order', () => {
        const player = { name: 'Us', messages: [] } as unknown as Empire;
        const zorg = { name: 'Zorg', messages: [] } as unknown as Empire;
        const queue = player.messages as unknown[];
        const feed = createEmpireMessageFeed();
        const m1 = msg(player, EmpireMessageType.Informational, 'A');
        const m2 = msg(zorg, EmpireMessageType.Informational, 'B');
        queue.push(m1, m2);
        expect(feed.poll(player)).toEqual(['A', 'Zorg says: B']);
        expect(feed.poll(player)).toEqual([]);

        queue.push(msg(player, EmpireMessageType.Informational, 'C'));
        expect(feed.poll(player)).toEqual(['C']);

        queue.length = 0;
        queue.push(m1);
        expect(feed.poll(player)).toEqual([]);

        queue.push(msg(player, EmpireMessageType.AdvisorSuggestion, 'Advice'));
        expect(feed.poll(player)).toEqual([]);
        expect(feed.poll(player)).toEqual([]);
    });

    it('does not share the seen set between feeds', () => {
        const player = { name: 'Us', messages: [] } as unknown as Empire;
        const queue = player.messages as unknown[];
        queue.push(msg(player, EmpireMessageType.Informational, 'A'));
        expect(createEmpireMessageFeed().poll(player)).toEqual(['A']);
        expect(createEmpireMessageFeed().poll(player)).toEqual(['A']);
    });
});
