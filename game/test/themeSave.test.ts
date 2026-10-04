// Saves record the theme (Game.CustomizationSetName → the save header's ThemeName, Main.Part7.cs 3721) and a themed
// game round-trips on that theme's data. The stock game's save carries no theme key (unchanged format).
import { afterEach, describe, expect, it } from 'vitest';
import { createGame } from '../src/sim/game';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { GalaxyShape } from '../src/sim/types';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { deserializeGame, savedCustomizationSet, serializeGame } from '../src/sim/save/gameSave';
import { setActiveCustomizationSet } from '../src/sim/data/customization';
import { runGameSeconds } from '../src/sim/tick/harness';
import { installedThemes, loadGameDataFs, themeIndexFs } from './helpers/loadGameDataFs';
import { tickGameOptions } from './helpers/tickGame';

const THEME = 'RetreatUE Bacon';

afterEach(() => setActiveCustomizationSet(null));

describe('save round trip with a theme', () => {
    it.skipIf(!installedThemes().includes(THEME))(`${THEME}: the save names the theme and reloads byte-identical`, async () => {
        const theme = themeIndexFs(THEME)!;
        setActiveCustomizationSet(theme);
        const gameData = await loadGameDataFs(theme);
        const o = tickGameOptions(gameData);
        const game = createGame({ ...o, starCount: 120, sectorWidth: 5, sectorHeight: 5, systemNames: Array.from({ length: 120 }, (_, i) => `S${i}`) });
        runGameSeconds(game, 10);
        const time = new GalaxyTime();
        const startOptions = { ...defaultStartGameOptions(), seed: 1 };
        const text1 = serializeGame(game, time, startOptions);
        expect(savedCustomizationSet(text1)).toBe(THEME);
        expect(JSON.parse(text1).customizationSet).toBe(THEME);
        const restored = deserializeGame(text1, gameData);
        expect(restored.game.galaxy.races.length).toBe(gameData.races.length);
        const text2 = serializeGame(restored.game, restored.time, restored.startOptions);
        expect(text2).toBe(text1);
    }, 600000);

    it('the stock game writes no theme key', async () => {
        const gameData = await loadGameDataFs();
        const o = tickGameOptions(gameData);
        const game = createGame({ ...o, starCount: 100, sectorWidth: 4, sectorHeight: 4, systemNames: Array.from({ length: 100 }, (_, i) => `S${i}`), aiEmpires: [] });
        const text = serializeGame(game, new GalaxyTime(), { ...defaultStartGameOptions(), seed: 1 });
        expect(text.includes('"customizationSet"')).toBe(false);
        expect(savedCustomizationSet(text)).toBe('');
    }, 600000);
});
