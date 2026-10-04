// @slow
// Every installed theme (Customization set) starts a new game headless: its data loads through the original's
// per-file / per-folder customization rules (data/gameData.ts) and createGame runs on it. Skipped per theme when the
// theme (or the install) is absent, so CI without the game files passes.
import { describe, expect, it } from 'vitest';
import { installedThemes, loadGameDataFs, themeIndexFs } from './helpers/loadGameDataFs';
import { createGame } from '../src/sim/game';
import { GalaxyShape } from '../src/sim/types';
import { tickGameOptions } from './helpers/tickGame';
import { setActiveCustomizationSet } from '../src/sim/data/customization';
import { runGameSeconds } from '../src/sim/tick/harness';
import { parseBaconSettings } from '../src/sim/data/baconSettings';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The installed themes this suite covers (every Customization subfolder the original lists, Start.cs method_28). */
const THEMES = [
    "Alvek's Expansion Mod",
    'BaconWorld',
    'Distant Worlds Original',
    'DistantWorldsExpanded-main',
    'DW - Starfall 1.12 - Corrected',
    'DW Comixverse',
    'DW Universe-ST Picard Era',
    'DW Universe-STPE Ver 2',
    'Extended AI Improvement Mod 1.05',
    'Lower Speed and Range',
    'Mass Effect 4 Mod',
    'MassEffect mod 1.00',
    'RetreatUE Bacon',
    'The Ancient Galaxy',
    'Warhammer 40,000 (V14)',
];

const installed = new Set(installedThemes());

describe('new game with each installed theme', () => {
    for (const name of THEMES) {
        it.skipIf(!installed.has(name))(name, async () => {
            const theme = themeIndexFs(name)!;
            setActiveCustomizationSet(theme);
            try {
                const gameData = await loadGameDataFs(theme);
                expect(gameData.races.length).toBeGreaterThan(0);
                const playable = gameData.races.filter((r) => r.playable);
                expect(playable.length).toBeGreaterThan(0);
                const o = tickGameOptions(gameData);
                const s = (race: string) => ({ ...o.player, race });
                const game = createGame({
                    ...o,
                    shape: GalaxyShape.Spiral,
                    starCount: 150,
                    sectorWidth: 6,
                    sectorHeight: 6,
                    systemNames: Array.from({ length: 150 }, (_, i) => `S${i}`),
                    player: s(playable[0].name),
                    aiEmpires: [s('(Random)'), s('(Random)')],
                });
                expect(game.galaxy.empires.length).toBeGreaterThan(0);
                expect(game.playerEmpire.dominantRace?.name).toBe(playable[0].name);
                // and it runs: a game month of ticks on the theme's components, research and designs
                runGameSeconds(game, 120);
                expect(game.galaxy.empires.some((e) => e.builtObjects.length > 0)).toBe(true);
            } finally {
                setActiveCustomizationSet(null);
            }
        }, 600000);
    }
});

// RetreatUE Bacon ships "Das_BaconSettings 1.79.txt", meant to be copied by hand over <install>\BaconSettings.txt
// (the game reads BaconSettings.txt from the install root only, BaconMain.cs 1107). Its options (star gravity wells,
// smallShipsJumpSooner, …) must run once copied.
const DAS = resolve(__dirname, '../public/assets/dwu/Customization/RetreatUE Bacon/Das_BaconSettings 1.79.txt');
describe('RetreatUE Bacon with its Das_BaconSettings copied in', () => {
    it.skipIf(!existsSync(DAS))('starts and runs', async () => {
        const theme = themeIndexFs('RetreatUE Bacon')!;
        setActiveCustomizationSet(theme);
        try {
            const gameData = { ...(await loadGameDataFs(theme)), baconSettings: parseBaconSettings(readFileSync(DAS, 'latin1')) };
            expect(gameData.baconSettings.smallShipsJumpSooner).toBe(true);
            const o = tickGameOptions(gameData);
            const game = createGame({ ...o, starCount: 150, sectorWidth: 6, sectorHeight: 6, systemNames: Array.from({ length: 150 }, (_, i) => `S${i}`) });
            runGameSeconds(game, 240);
            expect(game.galaxy.empires.length).toBeGreaterThan(0);
        } finally {
            setActiveCustomizationSet(null);
        }
    }, 600000);
});
