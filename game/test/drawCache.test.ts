import { describe, expect, it } from 'vitest';
import { boundsOnScreen, DrawKey, setTextIfChanged } from '../src/render/drawCache';

describe('DrawKey', () => {
    it('reports a change on the first call and whenever any value differs', () => {
        const k = new DrawKey();
        expect(k.changed(1, 2, 3, 4, 5)).toBe(true);
        expect(k.changed(1, 2, 3, 4, 5)).toBe(false);
        expect(k.changed(1, 2, 3, 4, 6)).toBe(true);
        expect(k.changed(0, 2, 3, 4, 6)).toBe(true);
        expect(k.changed(0, 2, 3, 4, 6)).toBe(false);
    });
    it('defaults unused trailing values to 0 and redraws after reset or on NaN', () => {
        const k = new DrawKey();
        expect(k.changed(7)).toBe(true);
        expect(k.changed(7, 0, 0)).toBe(false);
        k.reset();
        expect(k.changed(7)).toBe(true);
        expect(k.changed(NaN)).toBe(true);
        expect(k.changed(NaN)).toBe(true);
    });
});

describe('boundsOnScreen', () => {
    // Camera at (0, 0), 1000 x 500 px at zoom 0.1 px per unit: the screen spans x in [-5000, 5000], y in [-2500, 2500].
    const on = (x: number, y: number, r: number, m: number) => boundsOnScreen(x, y, r, m, 0, 0, 1000, 500, 0.1);
    it('keeps objects whose drawn extent touches the screen', () => {
        expect(on(0, 0, 0, 0)).toBe(true);
        expect(on(5000, 2500, 0, 0)).toBe(true);
        expect(on(6000, 0, 1000, 0)).toBe(true); // world radius reaches the edge
        expect(on(0, -2600, 0, 10)).toBe(true); // 10 px margin = 100 units
    });
    it('culls objects entirely off screen', () => {
        expect(on(5001, 0, 0, 0)).toBe(false);
        expect(on(0, 2701, 100, 10)).toBe(false);
        expect(on(-7000, 0, 1000, 50)).toBe(false);
    });
});

describe('setTextIfChanged', () => {
    it('writes only when the text differs', () => {
        let writes = 0;
        let value: string | null = 'a';
        const el = {
            get textContent() {
                return value;
            },
            set textContent(v: string | null) {
                writes++;
                value = v;
            },
        };
        expect(setTextIfChanged(el, 'a')).toBe(false);
        expect(writes).toBe(0);
        expect(setTextIfChanged(el, 'b')).toBe(true);
        expect(value).toBe('b');
        expect(writes).toBe(1);
    });
});
