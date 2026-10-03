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
});
