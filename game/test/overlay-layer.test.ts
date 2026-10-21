// Task M3 — pure helper tests for the map overlay layer (Potential
// Colonies / Scenic Locations / Research Locations markers, Empire
// Territory visibility gate).

import { beforeAll, describe, expect, it } from 'vitest';
import type { Empire } from '../src/sim/empire';
import type { Galaxy } from '../src/sim/galaxy';
import type { Habitat } from '../src/sim/types';
import { HabitatCategoryType, HabitatType } from '../src/sim/types';
import { isPotentialColony, isResearchLocation, isScenicLocation, OVERLAY_MARKER_COLOR, OverlayLayer, potentialColonyKind, setOverlayErrorNotifier } from '../src/render/overlayLayer';
import { Camera } from '../src/render/camera';
import { EmpireLayer } from '../src/render/empireLayer';
import { Container } from 'pixi.js';
import { createMapOverlayState, onOverlayChange, toggleOverlay } from '../src/ui/mapOverlays';
import { createGame, type CreateGameOptions } from '../src/sim/game';
import { isPlayerPotentialColony } from '../src/sim/galaxy';
import { canEmpireColonizeHabitat } from '../src/sim/exploration';
import { identifyColonizationTargetsFull } from '../src/sim/civilianAI';
import { findNewestCanBuild } from '../src/sim/designGeneration';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { colonyTargetScoresFor } from '../src/render/colonyTargets';
import { cachedTickGame } from './helpers/gameCache';
import { checkSystemOwnershipEmpire } from '../src/sim/stationPlacement';
import { GalaxyShape } from '../src/sim/types';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';

function fakeHabitat(overrides: Partial<Habitat> = {}): Habitat {
    return {
        category: HabitatCategoryType.Planet,
        type: HabitatType.Continental,
        owner: null,
        empire: null,
        systemIndex: 0,
        scenicFactor: 0,
        researchBonus: 0,
        quality: 0.6,
        ruin: null,
        ...overrides,
    } as unknown as Habitat;
}

describe('isScenicLocation / isResearchLocation (task M3)', () => {
    it('is true only when the field is positive (Galaxy.1.cs hasScenery/hasResearchBonus)', () => {
        expect(isScenicLocation(fakeHabitat({ scenicFactor: 0 }))).toBe(false);
        expect(isScenicLocation(fakeHabitat({ scenicFactor: 0.5 }))).toBe(true);
        expect(isResearchLocation(fakeHabitat({ researchBonus: 0 }))).toBe(false);
        expect(isResearchLocation(fakeHabitat({ researchBonus: 3 }))).toBe(true);
    });
});

describe('isPotentialColony (task M3)', () => {
    function fakeEmpire(opts: { colonizable: HabitatType[]; explored: boolean }): Empire {
        return {
            colonizableHabitatTypesForEmpire: () => opts.colonizable,
            visibility: { checkSystemExplored: () => opts.explored },
            designs: [],
        } as unknown as Empire;
    }

    function fakeGalaxy(playerEmpire: Empire | null, independentEmpire: Empire | null = null, territoryOk = true): Galaxy {
        return { playerEmpire, independentEmpire, checkEmpireTerritoryCanColonizeHabitat: () => territoryOk } as unknown as Galaxy;
    }

    it('is false without a player empire', () => {
        const h = fakeHabitat();
        expect(isPotentialColony(h, fakeGalaxy(null))).toBe(false);
    });

    it('is false for stars/asteroids/gas clouds (only Planet/Moon)', () => {
        const empire = fakeEmpire({ colonizable: [HabitatType.Continental], explored: true });
        const galaxy = fakeGalaxy(empire);
        expect(isPotentialColony(fakeHabitat({ category: HabitatCategoryType.Star }), galaxy)).toBe(false);
        expect(isPotentialColony(fakeHabitat({ category: HabitatCategoryType.Asteroid }), galaxy)).toBe(false);
    });

    it('is false when owned by another empire', () => {
        const empire = fakeEmpire({ colonizable: [HabitatType.Continental], explored: true });
        const otherOwner = {} as Empire;
        const galaxy = fakeGalaxy(empire);
        expect(isPotentialColony(fakeHabitat({ owner: otherOwner }), galaxy)).toBe(false);
    });

    it('is true when owned by the independent empire (unowned-equivalent)', () => {
        const independent = {} as Empire;
        const empire = fakeEmpire({ colonizable: [HabitatType.Continental], explored: true });
        const galaxy = fakeGalaxy(empire, independent);
        expect(isPotentialColony(fakeHabitat({ owner: independent, quality: 0.6 }), galaxy)).toBe(true);
    });

    it('is false when the system is unexplored', () => {
        const empire = fakeEmpire({ colonizable: [HabitatType.Continental], explored: false });
        const galaxy = fakeGalaxy(empire);
        expect(isPotentialColony(fakeHabitat(), galaxy)).toBe(false);
    });

    it('is false when the habitat type is not colonizable by the player race', () => {
        const empire = fakeEmpire({ colonizable: [HabitatType.Ocean], explored: true });
        const galaxy = fakeGalaxy(empire);
        expect(isPotentialColony(fakeHabitat({ type: HabitatType.Continental }), galaxy)).toBe(false);
    });

    it('is false when quality is below 0.5', () => {
        const empire = fakeEmpire({ colonizable: [HabitatType.Continental], explored: true });
        const galaxy = fakeGalaxy(empire);
        expect(isPotentialColony(fakeHabitat({ quality: 0.2 }), galaxy)).toBe(false);
    });

    it('is true when unowned, explored, colonizable and quality >= 0.5', () => {
        const empire = fakeEmpire({ colonizable: [HabitatType.Continental], explored: true });
        const galaxy = fakeGalaxy(empire);
        expect(isPotentialColony(fakeHabitat({ quality: 0.7 }), galaxy)).toBe(true);
    });

    // Galaxy.1.cs DetermineSystemInfo's flag: CanEmpireColonizeHabitat (territory, range, colony-ship design or type) and
    // quality >= 0.5 / superluxury / a ruin bonus. The Expansion Planner's "colonise now" uses the same CanEmpireColonizeHabitat.
    it('is true through the newest colony-ship design when the habitat type is not colonizable', () => {
        const empire = { ...fakeEmpire({ colonizable: [], explored: true }), canDesignColonizeHabitat: () => true } as unknown as Empire;
        const galaxy = fakeGalaxy(empire);
        expect(potentialColonyKind(fakeHabitat({ type: HabitatType.Continental }), galaxy, [], {} as never)).toBe('now');
    });

    it('is false when the territory does not allow colonizing the habitat (CheckEmpireTerritoryCanColonizeHabitat)', () => {
        const empire = fakeEmpire({ colonizable: [HabitatType.Continental], explored: true });
        expect(isPotentialColony(fakeHabitat(), fakeGalaxy(empire, null, false))).toBe(false);
    });

    it('is true at low quality for a ruin with a bonus or superluxury resources (DetermineSystemInfo flag)', () => {
        const empire = fakeEmpire({ colonizable: [HabitatType.Continental], explored: true });
        const galaxy = fakeGalaxy(empire);
        const ruin = { bonusDefensive: 0, bonusDiplomacy: 0, bonusHappiness: 0, bonusResearchEnergy: 0, bonusResearchHighTech: 0, bonusResearchWeapons: 0, bonusWealth: 2 };
        expect(isPotentialColony(fakeHabitat({ quality: 0.2, ruin } as Partial<Habitat>), galaxy)).toBe(true);
        expect(isPotentialColony(fakeHabitat({ quality: 0.2 }), galaxy)).toBe(false);
    });

    it("is 'future' when the habitat type would be colonizable but the colonisation tech is not known yet", () => {
        const empire = {
            ...fakeEmpire({ colonizable: [], explored: true }),
            research: { techTree: {}, getLowestProjectForColonization: () => ({ def: { name: 'Ocean Colonization' } }) },
        } as unknown as Empire;
        const galaxy = fakeGalaxy(empire);
        expect(potentialColonyKind(fakeHabitat({ type: HabitatType.Ocean }), galaxy, [], null)).toBe('future');
        const noTech = { ...empire, research: { techTree: {}, getLowestProjectForColonization: () => null } } as unknown as Empire;
        expect(potentialColonyKind(fakeHabitat({ type: HabitatType.Ocean }), fakeGalaxy(noTech), [], null)).toBe(null);
    });
});

describe('OVERLAY_MARKER_COLOR (task M3)', () => {
    it('matches the original selection-ring yellow (MainView.cs color_2 default)', () => {
        expect(OVERLAY_MARKER_COLOR).toBe(0xffff00);
    });
});

// Integration: OverlayLayer against a real generated galaxy, mirroring the
// empire-layer test's ?autostart=1-equivalent setup.
describe('OverlayLayer (task M3 integration)', () => {
    let gameData: GameData;
    beforeAll(async () => { gameData = await loadGameDataFs(); }, 60000);

    function autostartOpts(): CreateGameOptions {
        const ai = { race: '(Random)', homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', age: 1, techLevel: 0 };
        return {
            seed: 1, shape: GalaxyShape.Spiral, starCount: 700, sectorWidth: 4, sectorHeight: 4,
            systemNames: Array.from({ length: 700 }, (_, i) => `S${i}`), gameData,
            player: { race: 'Human', homeSystemFavourability: 'Normal', startLocation: '(Random)', age: 1, techLevel: 0 },
            aiEmpires: [ai, { ...ai }, { ...ai }],
        };
    }

    it('constructs without throwing and the Empire Territory toggle reaches EmpireLayer', () => {
        const galaxy = createGame(autostartOpts()).galaxy;
        const world = new Container();
        const empireLayer = new EmpireLayer(galaxy, world);
        const state = createMapOverlayState();
        expect(state.empireTerritory).toBe(true); // task M3 default
        const overlayLayer = new OverlayLayer(galaxy, world, empireLayer, state);

        let notified = 0;
        const unsubscribe = onOverlayChange(() => notified++);
        toggleOverlay(state, 'empireTerritory');
        expect(state.empireTerritory).toBe(false);
        expect(notified).toBe(1);
        unsubscribe();
        overlayLayer.destroy();
    }, 60000);

    it('an Improvements overlay that throws is switched off with a notice; the rest of the update still runs', () => {
        const galaxy = createGame(autostartOpts()).galaxy;
        const world = new Container();
        const empireLayer = new EmpireLayer(galaxy, world);
        const state = createMapOverlayState();
        const overlayLayer = new OverlayLayer(galaxy, world, empireLayer, state);
        const notices: string[] = [];
        setOverlayErrorNotifier((m) => notices.push(m));
        let calls = 0;
        (overlayLayer.colonyScores as unknown as { update: () => void }).update = () => {
            calls++;
            if (state.colonyScores) throw new Error('boom');
        };
        let supplyRan = 0;
        const supply = (overlayLayer as unknown as { supply: { update: () => void } }).supply;
        supply.update = () => void supplyRan++;
        const cam = new Camera();
        cam.setGalaxyBounds(galaxy.sizeX, galaxy.sizeY);
        state.colonyScores = true;
        const errors: unknown[] = [];
        const orig = console.error;
        console.error = (...a: unknown[]) => void errors.push(a);
        try {
            overlayLayer.update(cam.zoom, cam);
            expect(state.colonyScores).toBe(false);
            expect(notices).toEqual(['Colony Target Scores overlay failed and was turned off — see console']);
            expect(errors.length).toBe(1);
            expect(supplyRan).toBe(1);
            // Off: skipped (it already hid itself once); turned back on: retried.
            const before = calls;
            overlayLayer.update(cam.zoom, cam);
            expect(calls).toBe(before);
            state.colonyScores = true;
            overlayLayer.update(cam.zoom, cam);
            expect(calls).toBe(before + 2);
            expect(state.colonyScores).toBe(false);
        } finally {
            console.error = orig;
            setOverlayErrorNotifier(null);
            overlayLayer.destroy();
        }
    }, 60000);
});

// Potential Colonies against the Expansion Planner's "colonise now" targets (Main.Part4.cs method_532 list =
// identifyColonizationTargetsFull; "colonise now" = Empire.4.cs CanEmpireColonizeHabitat, the planner's canColonize).
describe('Potential Colonies rings vs the Expansion Planner (galaxy and system zoom)', () => {
    let gameData: GameData;
    beforeAll(async () => { gameData = await loadGameDataFs(); }, 60000);

    // The standard seed-1 game after 900 s: the planner has colonise-now targets (at the start it has none).
    it('rings the star of each system with a colonise-now target at galaxy zoom, and the planets at system zoom', () => {
        const galaxy = cachedTickGame(gameData, { seconds: 900 }).galaxy;
        const player = galaxy.playerEmpire!;
        const types = player.colonizableHabitatTypesForEmpire();
        const design = findNewestCanBuild(player.designs, BuiltObjectSubRole.ColonyShip, player);
        const planner = identifyColonizationTargetsFull(galaxy, player, false, 0, 5000, true, true)
            .map((t) => t.habitat)
            .filter((h): h is Habitat => h !== null);
        const colonizeNow = planner.filter((h) => canEmpireColonizeHabitat(galaxy, player, player, h, types, design));
        // The original's flag (DetermineSystemInfo): the planner's "colonise now" targets that are worth a ring.
        const flagged = colonizeNow.filter((h) => isPlayerPotentialColony(galaxy, player, h, types, design));
        expect(colonizeNow.length).toBeGreaterThan(0);
        expect(flagged.length).toBeGreaterThan(0);
        // Each planner target the overlay skips is one the original's rule skips too (quality < 0.5, no superluxury / ruin).
        for (const h of colonizeNow) {
            expect(potentialColonyKind(h, galaxy, types, design) === 'now').toBe(flagged.includes(h));
        }

        const state = createMapOverlayState();
        state.potentialColonies = true;
        const world = new Container();
        const layer = new OverlayLayer(galaxy, world, new EmpireLayer(galaxy, world), state);
        // A viewport wide enough that the culling (updateGroup) keeps every ring in view at both zooms.
        const cam = new Camera();
        cam.setViewport(400000, 400000);
        cam.centerOn(galaxy.sizeX / 2, galaxy.sizeY / 2);

        // Galaxy zoom (factor 1200 px per 1 zoom step): one ring per system with a flagged planet (or an unowned system with independent colonies).
        const expectedSystems = new Set(flagged.map((h) => h.systemIndex));
        galaxy.systems.forEach((sys, i) => {
            const owner = checkSystemOwnershipEmpire(galaxy, sys.systemStar);
            if ((sys.independentColonyCount ?? 0) > 0 && (owner === null || owner === player) && player.visibility.checkSystemExplored(i)) expectedSystems.add(i);
        });
        layer.update(1 / 1200, cam);
        expect(layer.potentialColonyMarks()).toEqual({ systems: expectedSystems.size, habitats: 0 });
        expect(expectedSystems.size).toBeGreaterThan(0);

        // Colony Target Scores takes over the ring of each system it scores (galaxy zoom), as it does each habitat at system zoom.
        const scored = colonyTargetScoresFor(galaxy, player).bySystem;
        state.colonyScores = true;
        layer.update(1 / 1200, cam);
        const scoredHere = [...expectedSystems].filter((i) => scored.has(i)).length;
        expect(layer.potentialColonyMarks().systems).toBe(expectedSystems.size - scoredHere);
        state.colonyScores = false;

        // System zoom (factor 60, under the 70 gate): one ring per flagged habitat, none on the stars.
        layer.update(1 / 60, cam);
        expect(layer.potentialColonyMarks()).toEqual({ systems: 0, habitats: flagged.length });
        layer.destroy();
    }, 120000);
});
