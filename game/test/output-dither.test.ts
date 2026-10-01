import { describe, expect, it } from 'vitest';
import { ditherBitGl } from '../src/render/outputDither';

describe('output dither', () => {
    it('adds zero-mean ±1-step noise to the premultiplied output, gated by coverage', () => {
        const end = ditherBitGl.fragment.end;
        expect(end).toContain('finalColor.rgb +=');
        expect(end).toContain('(1.0 / 255.0)');
        expect(end).toContain('- 1.0'); // two uniforms minus one: triangular in (-1, 1)
        expect(end).toContain('dwuCov');
    });
});
