import { describe, expect, it } from 'vitest';
import { collectHitsUnderPoint, needsPickMenu, type PickCandidate } from '../src/render/pickStack';

const c = (item: string, x: number, y: number, sizePx: number, kind: PickCandidate<string>['kind'] = 'ship'): PickCandidate<string> => ({ item, kind, x, y, sizePx });

describe('collectHitsUnderPoint', () => {
    it('returns nothing for empty space', () => {
        expect(collectHitsUnderPoint([c('a', 100, 100, 20)], 0, 0, 1)).toEqual([]);
    });
    it('a single hit does not need the popup', () => {
        const hits = collectHitsUnderPoint([c('a', 0, 0, 20), c('b', 500, 0, 20)], 1, 1, 1);
        expect(hits.map((h) => h.item)).toEqual(['a']);
        expect(needsPickMenu(hits)).toBe(false);
    });
    it('collects overlapping objects, smallest drawn first, then kind rank', () => {
        const hits = collectHitsUnderPoint([c('planet', 0, 0, 80, 'planet'), c('ship', 2, 0, 10), c('base', 0, 0, 10, 'base'), c('moon', 0, 0, 30, 'moon')], 0, 0, 1);
        expect(hits.map((h) => h.item)).toEqual(['ship', 'base', 'moon', 'planet']);
        expect(needsPickMenu(hits)).toBe(true);
    });
    it('respects the zoom when converting world distance to px', () => {
        const list = [c('a', 0, 0, 20), c('b', 0, 0, 20)];
        expect(collectHitsUnderPoint(list, 15, 0, 1)).toHaveLength(0); // 15 px > radius 10
        expect(collectHitsUnderPoint(list, 15, 0, 0.5)).toHaveLength(2); // 7.5 px
    });
    it('uses the minimum radius for tiny objects and skips undrawn ones', () => {
        const list = [c('tiny', 0, 0, 2), c('hidden', 0, 0, 0)];
        expect(collectHitsUnderPoint(list, 5, 0, 1).map((h) => h.item)).toEqual(['tiny']);
        expect(collectHitsUnderPoint(list, 7, 0, 1)).toEqual([]);
    });
    it('deduplicates by item and caps the list', () => {
        const dup = collectHitsUnderPoint([c('a', 0, 0, 20), c('a', 0, 0, 20, 'base')], 0, 0, 1);
        expect(dup).toHaveLength(1);
        const many = Array.from({ length: 30 }, (_, i) => c(`s${i}`, 0, 0, 10 + i));
        expect(collectHitsUnderPoint(many, 0, 0, 1, 6, 12)).toHaveLength(12);
    });
});
