// Port of Main.Part13.cs LoadTroops (Troop_<i>[.png|_Armored.png|_Artillery.png|_SpecialForces.png|
// _PirateRaider.png], RoboticTroop.png) and Galaxy.8.cs GenerateNewTroop / Habitat.cs GenerateNewTroop(isRobotic)
// (troop.PictureRef = race.PictureRef, or Galaxy.Races.Count for a robotic troop) — src/render/troopImages.ts.
import { describe, expect, it } from 'vitest';
import { TroopType } from '../src/sim/cargo';
import { troopImageBaseUrl, troopImageUrl, TROOP_IMAGE_ICON_RATIO } from '../src/render/troopImages';

describe('troopImageUrl (race index + suffix)', () => {
    it('Infantry: no suffix', () => {
        expect(troopImageUrl({ type: TroopType.Infantry, pictureRef: 4 }, 22)).toBe('/assets/dwu/images/units/troops/Troop_4.png');
    });
    it('Armored suffix', () => {
        expect(troopImageUrl({ type: TroopType.Armored, pictureRef: 4 }, 22)).toBe('/assets/dwu/images/units/troops/Troop_4_Armored.png');
    });
    it('Artillery suffix', () => {
        expect(troopImageUrl({ type: TroopType.Artillery, pictureRef: 4 }, 22)).toBe('/assets/dwu/images/units/troops/Troop_4_Artillery.png');
    });
    it('SpecialForces suffix', () => {
        expect(troopImageUrl({ type: TroopType.SpecialForces, pictureRef: 4 }, 22)).toBe('/assets/dwu/images/units/troops/Troop_4_SpecialForces.png');
    });
    it('PirateRaider suffix', () => {
        expect(troopImageUrl({ type: TroopType.PirateRaider, pictureRef: 4 }, 22)).toBe('/assets/dwu/images/units/troops/Troop_4_PirateRaider.png');
    });
    it('a different race index changes the file, not the suffix', () => {
        expect(troopImageUrl({ type: TroopType.Armored, pictureRef: 20 }, 22)).toBe('/assets/dwu/images/units/troops/Troop_20_Armored.png');
    });
});

describe('troopImageUrl (robotic troop)', () => {
    it('pictureRef === raceCount (Habitat.cs GenerateNewTroop isRobotic: PictureRef = Galaxy.Races.Count) → RoboticTroop.png', () => {
        expect(troopImageUrl({ type: TroopType.Infantry, pictureRef: 22 }, 22)).toBe('/assets/dwu/images/units/troops/RoboticTroop.png');
    });
    it('every type array holds a copy of the robotic image at that slot (LoadTroops bitmap_24..27[num])', () => {
        for (const type of [TroopType.Infantry, TroopType.Armored, TroopType.Artillery, TroopType.SpecialForces, TroopType.PirateRaider]) {
            expect(troopImageUrl({ type, pictureRef: 22 }, 22)).toBe('/assets/dwu/images/units/troops/RoboticTroop.png');
        }
    });
    it('a pictureRef below raceCount is a real race slot, not robotic', () => {
        expect(troopImageUrl({ type: TroopType.Infantry, pictureRef: 21 }, 22)).toBe('/assets/dwu/images/units/troops/Troop_21.png');
    });
});

describe('troopImageUrl (Concord fallback — do not invent art)', () => {
    it('the concordArt option overrides a real race slot (e.g. the Oranthi borrowed PictureIndex 7) to RoboticTroop.png', () => {
        expect(troopImageUrl({ type: TroopType.Armored, pictureRef: 7 }, 22, { concordArt: true })).toBe('/assets/dwu/images/units/troops/RoboticTroop.png');
    });
    it('without the flag, the same pictureRef resolves to the borrowed race file', () => {
        expect(troopImageUrl({ type: TroopType.Armored, pictureRef: 7 }, 22)).toBe('/assets/dwu/images/units/troops/Troop_7_Armored.png');
    });
});

describe('troopImageBaseUrl (LoadTroops variant-file fallback target)', () => {
    it('a real race slot: the base (Infantry, no suffix) file', () => {
        expect(troopImageBaseUrl({ pictureRef: 25 }, 22)).toBe('/assets/dwu/images/units/troops/Troop_25.png');
    });
    it('robotic slot: RoboticTroop.png', () => {
        expect(troopImageBaseUrl({ pictureRef: 22 }, 22)).toBe('/assets/dwu/images/units/troops/RoboticTroop.png');
    });
    it('Concord fallback: RoboticTroop.png', () => {
        expect(troopImageBaseUrl({ pictureRef: 7 }, 22, { concordArt: true })).toBe('/assets/dwu/images/units/troops/RoboticTroop.png');
    });
});

describe('TROOP_IMAGE_ICON_RATIO', () => {
    it('matches InfoPanel.cs _ImageSize (14) over the troop PNGs\' native size (80)', () => {
        expect(TROOP_IMAGE_ICON_RATIO).toBeCloseTo(14 / 80, 10);
    });
});
