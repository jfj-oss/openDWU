import { describe, expect, it } from 'vitest';
import { CharacterRole } from '../src/sim/characters';
import { roleIconOverlayRect, roleIconRectForSize, roleIconUrl } from '../src/ui/characterPortrait';

describe('characterPortrait (CharacterImageCache.cs OverlayRoleIcon)', () => {
    it('role icon files', () => {
        expect(roleIconUrl(CharacterRole.TroopGeneral)).toBe('/assets/dwu/images/ui/chrome/characterRole_TroopGeneral.png');
    });
    it('large / small / very small overlay geometry', () => {
        expect(roleIconOverlayRect(300, 0.2, 20)).toEqual({ x: 220, y: 220, w: 60, h: 60 });
        expect(roleIconOverlayRect(38, 0.35, 1)).toEqual({ x: 24, y: 24, w: 13, h: 13 });
        expect(roleIconOverlayRect(13, 0.48, 0)).toEqual({ x: 7, y: 7, w: 6, h: 6 });
        expect(roleIconRectForSize('small', 76)).toEqual({ x: 48, y: 48, w: 26, h: 26 });
    });
});
