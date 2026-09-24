// Task M2e2: `startGameView` sets `window.__dwu.game`. The view wiring is
// browser-only (PixiJS), so this tests the pure function that builds the
// debug object startGameView assigns to window.__dwu.

import { describe, expect, it } from 'vitest';
import type { Game } from '../src/sim/game';
import { buildDwuDebugObject } from '../src/main';

describe('buildDwuDebugObject (task M2e2)', () => {
    it('includes camera, galaxy, view and app', () => {
        const obj = buildDwuDebugObject({ camera: {}, galaxy: {}, view: {}, app: {} });
        expect(obj.camera).toEqual({});
        expect(obj.galaxy).toEqual({});
        expect(obj.view).toEqual({});
        expect(obj.app).toEqual({});
        expect('game' in obj).toBe(false);
    });

    it('includes game when a full game was started (wizard / autostart path)', () => {
        const game = { galaxy: { sizeX: 1 }, playerEmpire: {}, viewX: 10, viewY: 20 } as unknown as Game;
        const obj = buildDwuDebugObject({ camera: {}, galaxy: game.galaxy, view: {}, app: {}, game });
        expect(obj.game).toBe(game);
    });
});