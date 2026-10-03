// Task M2e — pure helper tests for the empire ownership layer.

import { beforeAll, describe, expect, it } from 'vitest';
import type { Empire } from '../src/sim/empire';
import { colonyRingRadius, EMPIRE_FALLBACK_COLORS, empireColour, INDEPENDENT_RING_COLOR, toPixiColor } from '../src/render/empireLayer';
import { collectTerritorySources } from '../src/render/territoryField';
import { createGame, type CreateGameOptions } from '../src/sim/game';
import { GalaxyShape } from '../src/sim/types';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';

describe('colonyRingRadius', () => {
    it('is the drawn sprite radius plus 6 px', () => {
        expect(colonyRingRadius(14)).toBe(14 / 2 + 6); // planet minimum
        expect(colonyRingRadius(7)).toBe(7 / 2 + 6); // moon minimum
        expect(colonyRingRadius(100)).toBe(56);
        expect(colonyRingRadius(0)).toBe(6);
    });
    it('pads by max(6, 28/f) px like the original owner ring (MainView.1.cs:794)', () => {
        expect(colonyRingRadius(294, 1)).toBe(147 + 28);
        expect(colonyRingRadius(100, 2)).toBe(50 + 14);
        expect(colonyRingRadius(100, 10)).toBe(50 + 6);
    });
});

describe('toPixiColor', () => {
    it('passes 0xRRGGBB numbers through (masked)', () => {
        expect(toPixiColor(0x1a2b3c)).toBe(0x1a2b3c);
        expect(toPixiColor(0xff0000)).toBe(0xff0000);
        expect(toPixiColor(0x1ff0000)).toBe(0xff0000); // high byte masked off
        expect(toPixiColor(0)).toBe(0xffffff); // 0 is not a usable colour -> white
    });

    it('parses #rrggbb and rrggbb strings', () => {
        expect(toPixiColor('#1a2b3c')).toBe(0x1a2b3c);
        expect(toPixiColor('1A2B3C')).toBe(0x1a2b3c);
        expect(toPixiColor('#abcdef')).toBe(0xabcdef);
    });

    it('parses rgb(r,g,b) strings', () => {
        expect(toPixiColor('rgb(26, 43, 60)')).toBe(0x1a2b3c);
        expect(toPixiColor('rgb(255,0,128)')).toBe(0xff0080);
    });

    it('falls back to white for unknown input', () => {
        expect(toPixiColor('not-a-color')).toBe(0xffffff);
        expect(toPixiColor('#12345')).toBe(0xffffff);
    });

    it('keeps the independent grey as-is', () => {
        expect(toPixiColor(INDEPENDENT_RING_COLOR)).toBe(0x606060);
    });
});

// Task M2e2: empires that share or lack colours get distinct palette colours
// by empire index, in the renderer only.
describe('empireColour', () => {
    function fakeEmpire(mainColor: number): Empire {
        return { mainColor } as unknown as Empire;
    }

    it('returns distinct values for indices 0-11 when empires lack colours', () => {
        const seen = new Set<number>();
        for (let i = 0; i < 12; i++) {
            const c = empireColour(fakeEmpire(0), i);
            expect(seen.has(c)).toBe(false);
            seen.add(c);
        }
        expect(seen.size).toBe(12);
    });

    it('uses the empire\'s own main colour when it has one', () => {
        expect(empireColour(fakeEmpire(0x1a2b3c), 0)).toBe(0x1a2b3c);
    });

    it('accepts hex-string main colours via toPixiColor (sim always stores numbers)', () => {
        // Sim stores mainColor as a number (empire.ts); a non-zero string is
        // never === 0, so empireColour routes it through toPixiColor as the
        // empire's own colour rather than the palette fallback.
        expect(empireColour({ mainColor: '#ff0080' } as unknown as Empire, 5)).toBe(0xff0080);
    });

    it('wraps indices past 12 back into the palette', () => {
        expect(empireColour(fakeEmpire(0), 13)).toBe(empireColour(fakeEmpire(0), 1));
        expect(empireColour(fakeEmpire(0), 26)).toBe(empireColour(fakeEmpire(0), 2));
    });

    it('palette entries are all distinct and non-zero', () => {
        const seen = new Set<number>();
        for (const c of EMPIRE_FALLBACK_COLORS) {
            expect(c).not.toBe(0);
            expect(seen.has(c)).toBe(false);
            seen.add(c);
        }
    });
});

// The territory overlay's sources (territoryField.ts collectTerritorySources, the colony filter of EmpireTerritory.cs
// CalculateEmpireTerritoryGrid 394-437) on a real game: every major empire's colonies, with the influence radius the sim
// keeps, and no independent colony (its radius is 0, Habitat.cs RecalculateColonyInfluenceRadius 1067).
describe('collectTerritorySources on a new game', () => {
    let gameData: GameData;
    beforeAll(async () => { gameData = await loadGameDataFs(); }, 60000);

    // Same options as ?autostart=1 (main.ts buildAutostartGame): seed 1,
    // spiral, 700 stars, 4x4 sectors, Human player + 3 random AI empires.
    function autostartOpts(): CreateGameOptions {
        const ai = { race: '(Random)', homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', age: 1, techLevel: 0 };
        return {
            seed: 1, shape: GalaxyShape.Spiral, starCount: 700, sectorWidth: 4, sectorHeight: 4,
            systemNames: Array.from({ length: 700 }, (_, i) => `S${i}`), gameData,
            player: { race: 'Human', homeSystemFavourability: 'Normal', startLocation: '(Random)', age: 1, techLevel: 0 },
            aiEmpires: [ai, { ...ai }, { ...ai }],
        };
    }

    it('god mode: one or more sources per major empire, radii from the sim; the player sees at least its own', () => {
        const galaxy = createGame(autostartOpts()).galaxy;
        const all = collectTerritorySources(galaxy, null);
        const owners = new Set(all.map((s) => galaxy.empires[s.owner]));
        expect(owners.size).toBe(4);
        expect(owners.has(galaxy.independentEmpire!)).toBe(false);
        for (const s of all) {
            expect(s.r).toBeGreaterThan(0);
            const colony = galaxy.empires[s.owner].colonies.find((c) => c.xpos === s.x && c.ypos === s.y)!;
            expect(colony.colonyInfluenceRadius).toBe(s.r);
        }
        const player = galaxy.playerEmpire!;
        const seen = collectTerritorySources(galaxy, player);
        expect(seen.length).toBeGreaterThan(0);
        expect(seen.length).toBeLessThanOrEqual(all.length);
        expect(seen.some((s) => galaxy.empires[s.owner] === player)).toBe(true);
    }, 60000);
});
