// Ticker line click-to-jump: a line pushed with a go-to runs it; lines without one fall through (message history).
import { beforeEach, describe, expect, it } from 'vitest';
import { clearHudMessages, getHudMessages, pushHudMessage, tickerLineGoto } from '../src/ui/hud';

describe('message ticker go-to', () => {
    beforeEach(() => clearHudMessages());

    it('runs the go-to of the clicked line and reports lines without one', () => {
        const calls: string[] = [];
        pushHudMessage('no place');
        pushHudMessage('colony founded', '', () => {
            calls.push('colony');
            return true;
        });
        // 5 slots filled from the top (renderMessages): the two messages sit in slots 0 and 1.
        expect(tickerLineGoto(1, 5)).toBe(true);
        expect(calls).toEqual(['colony']);
        expect(tickerLineGoto(0, 5)).toBe(false);
        expect(tickerLineGoto(4, 5)).toBe(false);
    });

    it('keeps each go-to aligned with its line as old lines scroll out', () => {
        const hit: number[] = [];
        for (let i = 0; i < 7; i++) {
            pushHudMessage(`m${i}`, '', i % 2 === 0 ? () => (hit.push(i), true) : null);
        }
        expect(getHudMessages()).toEqual(['m2', 'm3', 'm4', 'm5', 'm6']);
        expect(tickerLineGoto(0, 5)).toBe(true); // m2
        expect(tickerLineGoto(1, 5)).toBe(false); // m3
        expect(tickerLineGoto(4, 5)).toBe(true); // m6
        expect(hit).toEqual([2, 6]);
    });
});
