import { describe, expect, it } from 'vitest';
import { AutoPauseState } from '../src/ui/autoPause';

describe('AutoPauseState', () => {
    it('pauses on first open and resumes on last close', () => {
        const c = { paused: false };
        const s = new AutoPauseState();
        s.open(c);
        expect(c.paused).toBe(true);
        s.open(c); // nested message box
        s.close(c);
        expect(c.paused).toBe(true);
        s.close(c);
        expect(c.paused).toBe(false);
    });
    it('stays paused when the player had paused', () => {
        const c = { paused: true };
        const s = new AutoPauseState();
        s.open(c);
        s.open(c);
        s.close(c);
        s.close(c);
        expect(c.paused).toBe(true);
    });
    it('a forced open (the event panel, method_508 → method_154) pauses with the setting off, and resumes on close', () => {
        const c = { paused: false };
        const s = new AutoPauseState(() => false);
        s.open(c, true);
        expect(c.paused).toBe(true);
        s.close(c);
        expect(c.paused).toBe(false);
        // Nested inside an unpaused window (setting off): the forced one still pauses, and the last close resumes.
        s.open(c);
        expect(c.paused).toBe(false);
        s.open(c, true);
        expect(c.paused).toBe(true);
        s.close(c);
        s.close(c);
        expect(c.paused).toBe(false);
    });
    it('does nothing when the setting is off', () => {
        const c = { paused: false };
        const s = new AutoPauseState(() => false);
        s.open(c);
        expect(c.paused).toBe(false);
        s.close(c);
        expect(c.paused).toBe(false);
    });
    it('setting toggled mid-window does not strand the pause', () => {
        let on = true;
        const c = { paused: false };
        const s = new AutoPauseState(() => on);
        s.open(c);
        on = false;
        s.close(c);
        expect(c.paused).toBe(false);
    });
    it('ignores unbalanced closes', () => {
        const c = { paused: false };
        const s = new AutoPauseState();
        s.close(c);
        s.open(c);
        s.close(c);
        s.close(c);
        expect(c.paused).toBe(false);
    });
    it('screen, then a message popup on top, then both closing', () => {
        const c = { paused: false };
        const s = new AutoPauseState();
        s.open(c); // screen
        s.open(c); // talk / event popup
        s.close(c); // popup closes first: still paused
        expect(c.paused).toBe(true);
        s.close(c);
        expect(c.paused).toBe(false);
        // screen closes first while the popup stays: no early resume
        s.open(c);
        s.open(c);
        s.close(c);
        expect(c.paused).toBe(true);
        s.close(c);
        expect(c.paused).toBe(false);
    });
});
