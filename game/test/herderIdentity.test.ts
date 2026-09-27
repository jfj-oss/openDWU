// 19r item 3: herder identity — camp props over herder stations (render/emblemArt.ts herderCampRgba,
// render/artBundleLayer.ts herderStations) and the Ossuvan emblem override keyed on the race name.
import { describe, expect, it } from 'vitest';
import { herderCampRgba, herderFlag } from '../src/render/emblemArt';
import { herderStations } from '../src/render/artBundleLayer';
import { herderEmblemOverride } from '../src/ui/empireEmblem';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';

describe('19r herder camp props', () => {
    it('deterministic, painted ring of tents / pens, open hub', () => {
        const a = herderCampRgba(128, 3);
        expect(a.data).toEqual(herderCampRgba(128, 3).data);
        expect(a.data).not.toEqual(herderCampRgba(128, 4).data);
        let n = 0;
        for (let i = 3; i < a.data.length; i += 4) if (a.data[i] > 0) n++;
        expect(n).toBeGreaterThan(128 * 128 * 0.03);
        expect(a.data[(64 * 128 + 64) * 4 + 3]).toBe(0);
    });
    it('stations of herder colonies (and only bases) get camps', () => {
        const colony = { name: 'Ossu' };
        const other = { name: 'Elsewhere' };
        const base = { role: BuiltObjectRole.Base, parentHabitat: colony, empire: null, hasBeenDestroyed: false };
        const far = { role: BuiltObjectRole.Base, parentHabitat: other, empire: null, hasBeenDestroyed: false };
        const ship = { role: BuiltObjectRole.Freight, parentHabitat: colony, empire: null, hasBeenDestroyed: false };
        const galaxy = {
            scenario: { state: { rimHerders: { colonies: [{ colony, status: 'free' }] } } },
            builtObjects: [base, far, ship, null],
            independentEmpire: null,
        } as unknown as Galaxy;
        expect(herderStations(galaxy)).toEqual([base]);
        expect(herderStations({ scenario: null } as unknown as Galaxy)).toEqual([]);
    });
    it('the emblem override applies to the Ossuvan race only', () => {
        const g = { scenario: { state: {} } } as unknown as Galaxy;
        expect(herderEmblemOverride(g, { dominantRace: { name: 'Teekan', pictureIndex: 11 } } as unknown as Empire)).toBeNull();
        expect(herderFlag().w).toBe(100);
    });
});
