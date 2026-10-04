import { describe, expect, it } from 'vitest';
import { EmpireMessage, EmpireMessageType } from '../src/sim/messages';
import { DiplomaticRelationType } from '../src/sim/diplomacy';
import type { Empire } from '../src/sim/empire';
import { createEmpireMessageFeed, formatEmpireMessage } from '../src/ui/empireMessageFeed';
import { PlayerMessageStream, setPlayerMessageStream } from '../src/ui/messagePipeline';
import { defaultMessageOptions, routeEmpireMessage, tickerShown } from '../src/sim/messageRouting';

function msg(sender: Empire | null, type: EmpireMessageType, description: string, subject: unknown = null): EmpireMessage {
    const m = new EmpireMessage(sender, type, subject);
    m.description = description;
    return m;
}

describe('formatEmpireMessage', () => {
    const player = { name: 'Us', messages: [], messageHistory: [] } as unknown as Empire;
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

/** The game view's stream for `player`, fed as the pipeline would (sim/playerMessages.ts receipts). */
function streamFor(player: Empire): (m: EmpireMessage) => void {
    const stream = new PlayerMessageStream(() => 0);
    setPlayerMessageStream(player, stream);
    return (m) => {
        const route = routeEmpireMessage(m, player, defaultMessageOptions());
        const advisor = m.messageType === EmpireMessageType.AdvisorSuggestion;
        stream.push({ message: m, advisor, route: advisor ? null : route, action: 'none', ticker: tickerShown(m, route) });
    };
}

describe('createEmpireMessageFeed().poll', () => {
    it('returns [] for no empire, and without a stream', () => {
        expect(createEmpireMessageFeed().poll(null)).toEqual([]);
        expect(createEmpireMessageFeed().poll({ name: 'No view' } as unknown as Empire)).toEqual([]);
    });

    it('shows each handled message once, in the pipeline order; no line for advice; it reads, never writes', () => {
        const player = { name: 'Us', messages: [], messageHistory: [] } as unknown as Empire;
        const zorg = { name: 'Zorg', messages: [] } as unknown as Empire;
        const deliver = streamFor(player);
        const feed = createEmpireMessageFeed();
        const m1 = msg(player, EmpireMessageType.Informational, 'A');
        const m2 = msg(zorg, EmpireMessageType.Informational, 'B');
        deliver(m1);
        deliver(m2);
        expect(feed.poll(player)).toEqual(['A', 'Zorg says: B']);
        expect(feed.poll(player)).toEqual([]);

        deliver(msg(player, EmpireMessageType.Informational, 'C'));
        expect(feed.poll(player)).toEqual(['C']);

        deliver(m1);
        expect(feed.poll(player)).toEqual([]);

        deliver(msg(player, EmpireMessageType.AdvisorSuggestion, 'Advice'));
        expect(feed.poll(player)).toEqual([]);
        expect(feed.poll(player)).toEqual([]);
        expect(m1.starDate).toBe(0);
        expect((player as unknown as { messageHistory: unknown[] }).messageHistory).toEqual([]);
        setPlayerMessageStream(player, null);
    });

    it('does not share the seen set between feeds', () => {
        const player = { name: 'Us', messages: [], messageHistory: [] } as unknown as Empire;
        streamFor(player)(msg(player, EmpireMessageType.Informational, 'A'));
        expect(createEmpireMessageFeed().poll(player)).toEqual(['A']);
        expect(createEmpireMessageFeed().poll(player)).toEqual(['A']);
        setPlayerMessageStream(player, null);
    });
});
