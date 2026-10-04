// [uiwp6] The shared ToolStrip menu look (originalWindow.ts toolStripMenu / originalWindow.css .ow-toolstrip): the
// CustomToolStripRenderer.cs colours, and the map HUD popups built on it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string): string => readFileSync(new URL(`../src/ui/${p}`, import.meta.url), 'utf8');
/** The body of the first rule whose selector list is exactly `selector`. */
function rule(css: string, selector: string): string {
    const i = css.indexOf(`\n${selector} {`);
    expect(i, selector).toBeGreaterThanOrEqual(0);
    return css.slice(i, css.indexOf('}', i));
}

describe('ToolStrip menu look (CustomToolStripRenderer.cs)', () => {
    const css = read('originalWindow.css');

    it('background: horizontal (16,16,24) → (56,56,72), no border, font_3 15.33 px', () => {
        const r = rule(css, '.ow-toolstrip');
        expect(r).toContain('linear-gradient(to right, rgb(16, 16, 24), rgb(56, 56, 72))');
        expect(r).toContain('border: 0');
        expect(r).toContain('calc(15.33px * var(--ow-ts-k))');
    });

    it('items: (170,170,170) text; selected (64,64,80) → (128,128,144) with Yellow text', () => {
        expect(rule(css, '.ow-ts-item')).toContain('color: rgb(170, 170, 170)');
        const sel = css.slice(css.indexOf('.ow-ts-item:hover:not(.ow-ts-disabled)'));
        const body = sel.slice(0, sel.indexOf('}'));
        expect(body).toContain('rgb(255, 255, 0)');
        expect(body).toContain('linear-gradient(to right, rgb(64, 64, 80), rgb(128, 128, 144))');
    });

    it('separator: a Gray line', () => {
        expect(rule(css, '.ow-ts-sep')).toContain('rgb(128, 128, 128)');
    });

    it('the order menu, pick menu, top-bar ••• menu and View popup are built with it', () => {
        expect(read('orderMenu.ts')).toContain("toolStripMenu('order-menu-panel')");
        expect(read('pickMenu.ts')).toContain("toolStripMenu('pick-menu')");
        const hud = read('hud.ts');
        expect(hud).toContain("toolStripMenu('top-more-menu')");
        expect(hud).toContain("toolStripMenu('hud-options')");
    });
});
