// Task M3 — pure helper tests for the map overlay layer (Potential
// Colonies / Scenic Locations / Research Locations markers, Empire
// Territory visibility gate).

import { beforeAll, describe, expect, it } from 'vitest';
import type { Empire } from '../src/sim/empire';
import type { Galaxy } from '../src/sim/galaxy';
import type { Habitat } from '../src/sim/types';
import { HabitatCategoryType, HabitatType } from '../src/sim/types';
import { isPotentialColony, isResearchLocation, isScenicLocation, OVERLAY_MARKER_COLOR, OverlayLayer, setOverlayErrorNotifier } from '../src/render/overlayLayer';
import { Camera } from '../src/render/camera';
import { EmpireLayer } from '../src/render/empireLayer';
import { Container } from 'pixi.js';
import { createMapOverlayState, onOverlayChange, toggleOverlay } from '../src/ui/mapOverlays';
import { createGame, type CreateGameOptions } from '../src/sim/game';
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
        } as unknown as Empire;
    }

    function fakeGalaxy(playerEmpire: Empire | null, independentEmpire: Empire | null = null): Galaxy {
        return { playerEmpire, independentEmpire } as unknown as Galaxy;
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
