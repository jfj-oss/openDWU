import { beforeAll, describe, expect, it } from 'vitest';
import { setGovernmentsStatic } from '../src/sim/empire';
import type { GameData } from '../src/sim/data/gameData';
import { generateGalaxy } from '../src/sim/galaxy';
import { GalaxyShape } from '../src/sim/types';
import { researchComponentTechPoints } from '../src/sim/designGeneration';
import { canEmpireColonizeHabitatRange } from '../src/sim/exploration';
import { galaxyFromJSON, galaxyToJSON } from '../src/sim/save/galaxySave';
import {
    baseTechCostFor,
    colonizationRangeFor,
    defaultStartGameOptions,
    researchBaseTechCostForSliderIndex,
    researchSpeedSliderIndexFor,
    toCreateGameOptions,
} from '../src/sim/startGameOptions';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';

// Sweep 2: the wizard's BaseTechCost / ColonizationRange options through createGame (Start.1.cs 3693 / 3746-3747 →
// Start.2.cs 485 Galaxy ctor, 508-509) to their C# readers.
let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
}, 60000);

describe('wizard research cost (numStartNewGameTheGalaxyResearchBaseTech)', () => {
    it('slider ↔ box mappings (Start.1.cs 4394 meEawywtba / 4372 method_209)', () => {
        expect([0, 1, 2, 3, 4, 9].map(researchBaseTechCostForSliderIndex)).toEqual([480000, 240000, 120000, 60000, 30000, 120000]);
        expect([30000, 30001, 60000, 120000, 120001, 240000, 999000].map(researchSpeedSliderIndexFor)).toEqual([4, 3, 3, 2, 1, 1, 0]);
        // Start.1.cs 3693: box × 1000; the box is clamped 1..999 (Start.cs 3140-3141); unset = 120 (Main.Part9.cs 2668).
        expect(baseTechCostFor(undefined)).toBe(120000);
        expect(baseTechCostFor(45)).toBe(45000);
        expect(baseTechCostFor(0)).toBe(1000);
        expect(baseTechCostFor(5000)).toBe(999000);
    });

    it('toCreateGameOptions passes baseTechCost and the colonization range (float sectors × SectorSize)', () => {
        const o = defaultStartGameOptions();
        o.galaxyResearchSpeed = 60;
        o.colonization.enforceRangeLimits = true;
        o.colonization.colonizationRangeKly = 1500;
        const c = toCreateGameOptions(o, gameData, []);
        expect(c.baseTechCost).toBe(60000);
        expect(c.colonizationRangeEnforceLimit).toBe(true);
        // (float)1500 / 1000f * (float)2000000 = 3000000.
        expect(c.colonizationRange).toBe(3000000);
        expect(colonizationRangeFor(2333)).toBe(Math.fround(Math.fround(2.333) * 2000000));
        // wizdefaults: default StartGameOptions now matches Main.Part9.cs 2674-2675 (method_259): enforcement
        // on, 2 sectors -> (float)2000 / 1000f * (float)2000000 = 4000000.
        const d = toCreateGameOptions(defaultStartGameOptions(), gameData, []);
        expect(d.baseTechCost).toBe(120000);
        expect(d.colonizationRangeEnforceLimit).toBe(true);
        expect(d.colonizationRange).toBe(4000000);
    });
});

describe('Galaxy ctor baseTechCost (Galaxy.4.cs 2136 / 2148, Start.2.cs 485-489)', () => {
    const small = (baseTechCost?: number) =>
        generateGalaxy({ seed: 3, shape: GalaxyShape.Elliptical, starCount: 12, sectorWidth: 4, sectorHeight: 4, systemNames: [], gameData, baseTechCost });

    it('scales research costs (SetResearchCosts) and component tech points, and sets Galaxy.BaseTechCost', () => {
        const a = small();
        const b = small(60000);
        expect(a.baseTechCost).toBe(120000);
        expect(b.baseTechCost).toBe(60000);
        const ca = a.researchStatic!.componentStatic!.researchProjects;
        const cb = b.researchStatic!.componentStatic!.researchProjects;
        let compared = 0;
        for (let i = 0; i < ca.length; i++) {
            if (ca[i].cost <= 0) continue;
            // Galaxy.3.cs 5777 Cost = (float)(num * baseTechCost): exactly half.
            expect(cb[i].cost).toBe(Math.fround(ca[i].cost / 2));
            compared++;
        }
        expect(compared).toBeGreaterThan(100);
        const ta = researchComponentTechPoints(a).max;
        const tb = researchComponentTechPoints(b).max;
        expect(tb.some((v, i) => v !== ta[i])).toBe(true);
    });

    it('a save rebuilds the static research costs with the saved BaseTechCost (Main.Part12.cs 2869-2872)', () => {
        const b = small(60000);
        const json = JSON.parse(JSON.stringify(galaxyToJSON(b)));
        expect(json.baseTechCost).toBe(60000);
        const back = galaxyFromJSON(json, gameData);
        expect(back.baseTechCost).toBe(60000);
        expect(back.researchStatic!.componentStatic!.researchProjects.map((p) => p.cost)).toEqual(b.researchStatic!.componentStatic!.researchProjects.map((p) => p.cost));
    });
});

describe('Empire.4.cs 4408 CanEmpireColonizeHabitatRange reads Galaxy.ColonizationRange(EnforceLimit)', () => {
    it('limits by the distance to the nearest own colony only when enforced', () => {
        const game = cachedTickGame(gameData);
        const galaxy = game.galaxy;
        const empire = game.playerEmpire;
        const capital = empire.capital!;
        // A planet between 3M and 6M units from every colony of the player.
        const target = galaxy.habitats.find((h) => {
            if (h.parent === null) return false;
            let best = Infinity;
            for (const c of empire.colonies) best = Math.min(best, galaxy.calculateDistance(h.xpos, h.ypos, c.xpos, c.ypos));
            return best > 3100000 && best < 6000000;
        })!;
        expect(target).toBeDefined();
        expect(capital).not.toBeNull();
        expect(galaxy.colonizationRangeEnforceLimit).toBe(true);
        expect(galaxy.colonizationRange).toBe(3000000);
        expect(canEmpireColonizeHabitatRange(galaxy, empire, target)).toBe(false);
        galaxy.colonizationRange = 6000000;
        expect(canEmpireColonizeHabitatRange(galaxy, empire, target)).toBe(true);
        galaxy.colonizationRange = 3000000;
        galaxy.colonizationRangeEnforceLimit = false;
        expect(canEmpireColonizeHabitatRange(galaxy, empire, target)).toBe(true);
    });
});
