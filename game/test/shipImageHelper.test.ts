// ShipImageHelper.cs port (src/sim/shipImageHelper.ts): index ranges per family/subRole/aged flag, and that the
// module's own galaxy-seeded stream never touches galaxy.rnd (the Galaxy.Rnd sequence the pins guard).
import { describe, expect, it } from 'vitest';
import type { Galaxy } from '../src/sim/galaxy';
import { Random } from '../src/sim/random';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import {
    AncientHelpersFamily,
    FreedomAllianceFamily,
    ShakturiAlliesFamily,
    ShakturiFamily,
    StandardShipImageStartIndex,
    resolveMajorShipImageIndex,
    resolveMinorShipImageIndex,
    resolveMinorShipImageIndexForFamily,
    resolveNewShipImageIndex,
} from '../src/sim/shipImageHelper';
import { builtObjectImagePath } from '../src/render/builtObjectLayer';
import type { Race } from '../src/sim/data/races';

// Minimal Galaxy stand-in (designNames.test.ts convention): resolveMinorShipImageIndex* only reads
// randomSeed/shipImageClockRnd/rnd.
function makeGalaxy(seed: number): Galaxy {
    return { randomSeed: seed, shipImageClockRnd: null, rnd: new Random(seed) } as unknown as Galaxy;
}

describe('shipImageHelper (ShipImageHelper.cs)', () => {
    describe('resolveMajorShipImageIndex (ShipImageHelper.cs:130)', () => {
        it('places each family in its own 7-wide block starting at 31 (MajorShipStartIndex)', () => {
            for (const family of [ShakturiFamily, ShakturiAlliesFamily, AncientHelpersFamily, FreedomAllianceFamily]) {
                const base = 31 + family * 7;
                expect(resolveMajorShipImageIndex(family, BuiltObjectSubRole.Frigate, false)).toBe(base + 0);
                expect(resolveMajorShipImageIndex(family, BuiltObjectSubRole.Destroyer, false)).toBe(base + 1);
                expect(resolveMajorShipImageIndex(family, BuiltObjectSubRole.Cruiser, false)).toBe(base + 2);
                expect(resolveMajorShipImageIndex(family, BuiltObjectSubRole.CapitalShip, false)).toBe(base + 3);
                expect(resolveMajorShipImageIndex(family, BuiltObjectSubRole.TroopTransport, false)).toBe(base + 4);
                expect(resolveMajorShipImageIndex(family, BuiltObjectSubRole.GasMiningStation, false)).toBe(base + 5);
                expect(resolveMajorShipImageIndex(family, BuiltObjectSubRole.MiningStation, false)).toBe(base + 5);
                expect(resolveMajorShipImageIndex(family, BuiltObjectSubRole.GenericBase, false)).toBe(base + 5);
                expect(resolveMajorShipImageIndex(family, BuiltObjectSubRole.SmallSpacePort, false)).toBe(base + 6);
                expect(resolveMajorShipImageIndex(family, BuiltObjectSubRole.MediumSpacePort, false)).toBe(base + 6);
            }
        });

        it('an unmatched subRole falls back to num2 = 0 (the frigate slot)', () => {
            expect(resolveMajorShipImageIndex(ShakturiFamily, BuiltObjectSubRole.Escort, false)).toBe(31);
        });

        it('aged only shifts FreedomAlliance by 7 (59-63); other families ignore it', () => {
            expect(resolveMajorShipImageIndex(FreedomAllianceFamily, BuiltObjectSubRole.Frigate, true)).toBe(31 + 3 * 7 + 7);
            expect(resolveMajorShipImageIndex(FreedomAllianceFamily, BuiltObjectSubRole.CapitalShip, true)).toBe(31 + 3 * 7 + 3 + 7);
            expect(resolveMajorShipImageIndex(ShakturiFamily, BuiltObjectSubRole.Frigate, true)).toBe(31);
            expect(resolveMajorShipImageIndex(AncientHelpersFamily, BuiltObjectSubRole.Frigate, true)).toBe(31 + 2 * 7);
        });
    });

    describe('resolveMinorShipImageIndexForFamily (ShipImageHelper.cs:187, explicit family)', () => {
        it('non-base subroles: MinorShipStartIndex(3) + family*4 + the subRole slot, no Rnd draw', () => {
            const g = makeGalaxy(1);
            const before = (g.shipImageClockRnd as Random | null)?.drawCount ?? 0;
            expect(resolveMinorShipImageIndexForFamily(g, 0, BuiltObjectSubRole.Escort, false)).toBe(3 + 0);
            expect(resolveMinorShipImageIndexForFamily(g, 0, BuiltObjectSubRole.Frigate, false)).toBe(3 + 1);
            expect(resolveMinorShipImageIndexForFamily(g, 0, BuiltObjectSubRole.Destroyer, false)).toBe(3 + 2); // !largeShips
            expect(resolveMinorShipImageIndexForFamily(g, 0, BuiltObjectSubRole.Destroyer, true)).toBe(3 + 0); // largeShips
            expect(resolveMinorShipImageIndexForFamily(g, 0, BuiltObjectSubRole.Cruiser, false)).toBe(3 + 1);
            expect(resolveMinorShipImageIndexForFamily(g, 0, BuiltObjectSubRole.CapitalShip, false)).toBe(3 + 2);
            expect(resolveMinorShipImageIndexForFamily(g, 0, BuiltObjectSubRole.ColonyShip, false)).toBe(3 + 3);
            expect(resolveMinorShipImageIndexForFamily(g, 6, BuiltObjectSubRole.Escort, false)).toBe(3 + 6 * 4);
            expect((g.shipImageClockRnd as Random | null)?.drawCount ?? 0).toBe(before);
        });

        it('index stays within the 3-30 minor-set range for every family 0-6', () => {
            const g = makeGalaxy(2);
            for (let family = 0; family < 7; family++) {
                for (const subRole of [BuiltObjectSubRole.Escort, BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.CapitalShip, BuiltObjectSubRole.ColonyShip]) {
                    const idx = resolveMinorShipImageIndexForFamily(g, family, subRole, family % 2 === 0);
                    expect(idx).toBeGreaterThanOrEqual(3);
                    expect(idx).toBeLessThanOrEqual(30);
                }
            }
        });

        it('base subroles draw from the galaxy-seeded stream, never from galaxy.rnd', () => {
            const g = makeGalaxy(7);
            const rndBefore = g.rnd.drawCount;
            for (let i = 0; i < 50; i++) {
                const idx = resolveMinorShipImageIndexForFamily(g, 3, BuiltObjectSubRole.GenericBase, false);
                // Either a minor base (1-2) or a major-family base slot (31-63).
                expect(idx === 1 || idx === 2 || (idx >= 31 && idx <= 63)).toBe(true);
            }
            expect(g.rnd.drawCount).toBe(rndBefore); // galaxy.rnd untouched (the pins guard this sequence)
        });
    });

    describe('resolveMinorShipImageIndex (ShipImageHelper.cs:182, no family: draws Next(0, 7))', () => {
        it('draws exactly one shipImageClockRnd sample for the family, stays in range, and never draws galaxy.rnd', () => {
            const g = makeGalaxy(99);
            const rndBefore = g.rnd.drawCount;
            const idx = resolveMinorShipImageIndex(g, BuiltObjectSubRole.Frigate, false);
            expect(idx).toBeGreaterThanOrEqual(3);
            expect(idx).toBeLessThanOrEqual(30);
            expect((g.shipImageClockRnd as Random).drawCount).toBe(1);
            expect(g.rnd.drawCount).toBe(rndBefore);
        });

        it('lazily creates one stream per galaxy, seeded from randomSeed (deterministic given a seed)', () => {
            const g1 = makeGalaxy(123);
            const g2 = makeGalaxy(123);
            const a = resolveMinorShipImageIndex(g1, BuiltObjectSubRole.CapitalShip, true);
            const b = resolveMinorShipImageIndex(g2, BuiltObjectSubRole.CapitalShip, true);
            expect(a).toBe(b); // same seed -> same draw
            expect((g1.shipImageClockRnd as Random).drawCount).toBe(1);
            // The same instance is reused (not re-created) on a second call: two cumulative draws, not one.
            resolveMinorShipImageIndex(g1, BuiltObjectSubRole.Frigate, false);
            expect((g1.shipImageClockRnd as Random).drawCount).toBe(2);
        });
    });

    describe('resolveNewShipImageIndex (ShipImageHelper.cs:80)', () => {
        const race = { designsPictureFamilyIndex: 2, extra: { DesignsPictureFamilyIndexPirates: '5' } } as unknown as Race;

        it('null race: family 0, StandardShipImageStartIndex + (legacySubRole - 1)', () => {
            expect(resolveNewShipImageIndex(BuiltObjectSubRole.Frigate, null, false)).toBe(StandardShipImageStartIndex + 0 * 24 + 1);
        });

        it('a race: StandardShipImageStartIndex + family*24 + (legacySubRole - 1)', () => {
            expect(resolveNewShipImageIndex(BuiltObjectSubRole.Frigate, race, false)).toBe(StandardShipImageStartIndex + 2 * 24 + 1);
        });

        it('isPirates uses DesignsPictureFamilyIndexPirates instead of DesignsPictureFamilyIndex', () => {
            expect(resolveNewShipImageIndex(BuiltObjectSubRole.Frigate, race, true)).toBe(StandardShipImageStartIndex + 5 * 24 + 1);
        });
    });

    it('a Shakturi story design (ResolveMajorShipImageIndex) resolves to a MajorSets art URL', () => {
        const pictureRef = resolveMajorShipImageIndex(ShakturiFamily, BuiltObjectSubRole.CapitalShip, false);
        expect(builtObjectImagePath(pictureRef)).toBe('other/MajorSets/Shakturi/capitalship.png');
    });

    it('a FreedomAlliance aged story design resolves to the aged MajorSets art URL', () => {
        const pictureRef = resolveMajorShipImageIndex(FreedomAllianceFamily, BuiltObjectSubRole.Destroyer, true);
        expect(builtObjectImagePath(pictureRef)).toBe('other/MajorSets/FreedomAlliance/aged/destroyer.png');
    });

    it('ShakturiAllies and AncientHelpers designs resolve to their own MajorSets folders', () => {
        expect(builtObjectImagePath(resolveMajorShipImageIndex(ShakturiAlliesFamily, BuiltObjectSubRole.Frigate, false))).toBe('other/MajorSets/ShakturiAllies/frigate.png');
        expect(builtObjectImagePath(resolveMajorShipImageIndex(AncientHelpersFamily, BuiltObjectSubRole.Cruiser, false))).toBe('other/MajorSets/AncientHelpers/cruiser.png');
    });
});
