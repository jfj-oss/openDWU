// BaconSettings.txt: the reader (BaconMain.cs 1101 ReadBaconSettings), the per-key parse onto the C# defaults
// (BaconMain.cs 605-1062), loading through loadGameData, and the game-start application (sim/baconInitialize.ts).

import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { baconSettings, defaultBaconSettings, parseBaconSettings, readBaconSettings, setBaconSettings } from '../src/sim/data/baconSettings';
import { loadGameData, type FetchText, type GameData } from '../src/sim/data/gameData';
import { baconInitializeSettings, resetBaconSettingsToDefaults } from '../src/sim/baconInitialize';
import { baconMovementSettings } from '../src/sim/movement';
import { createGame, type CreateGameOptions } from '../src/sim/game';
import { GalaxyShape } from '../src/sim/types';
import { resolveTradeableItemsColoniesBases } from '../src/sim/tradeItems';
import { loadGameDataFs } from './helpers/loadGameDataFs';

const dwuRoot = resolve(__dirname, '..', 'public', 'assets', 'dwu');
const installedPath = resolve(dwuRoot, 'BaconSettings.txt');
const installed = existsSync(installedPath);
const f = Math.fround;

describe('readBaconSettings (BaconMain.cs 1101)', () => {
    it('skips // comments and empty lines, splits CRLF / CR / LF, keeps the text around "=" untrimmed', () => {
        const d = readBaconSettings('// comment\r\n\r\nA=1\rB = 2 \n  // indented comment=x\nC=3');
        expect([...d.entries()]).toEqual([
            ['A', '1'],
            ['B ', ' 2 '],
            ['  // indented comment', 'x'], // only a line *starting* with "//" is a comment
            ['C', '3'],
        ]);
    });

    it('takes the first and the last "=" fields; a line without "=" is its own key and value', () => {
        const d = readBaconSettings('a=b=c\nnoequals\n');
        expect(d.get('a')).toBe('c');
        expect(d.get('noequals')).toBe('noequals');
    });

    it('a whitespace-only line is not empty (it becomes a key)', () => {
        expect(readBaconSettings('   \nX=1').get('   ')).toBe('   ');
    });

    it('replaces every "," in a value with "." (european decimals)', () => {
        expect(readBaconSettings('tradeTax=0,3\nfighterBayLabel=a,b').get('tradeTax')).toBe('0.3');
        expect(readBaconSettings('fighterBayLabel=a,b').get('fighterBayLabel')).toBe('a.b');
    });

    it('stops at a repeated key (Dictionary.Add throws; the catch returns what was read)', () => {
        const d = readBaconSettings('A=1\nB=2\nA=3\nC=4');
        expect([...d.keys()]).toEqual(['A', 'B']);
        expect(d.get('A')).toBe('1');
    });

    it('drops a byte-order mark; null (no file) gives an empty dictionary', () => {
        expect(readBaconSettings('﻿A=1').get('A')).toBe('1');
        expect(readBaconSettings(null).size).toBe(0);
    });
});

describe('parseBaconSettings (BaconMain.cs 605-1062)', () => {
    it('a missing file leaves every setting at the C# default', () => {
        expect(parseBaconSettings(null)).toEqual(defaultBaconSettings());
        expect(parseBaconSettings('')).toEqual(defaultBaconSettings());
        const d = defaultBaconSettings();
        expect(d.hyperJumpThreshhold).toBe(12000);
        expect(d.baseHyperJumpAccuracy).toBe(3000);
        expect(d.tradeEverything).toBe(false);
        expect(d.shipMarkupFactor).toBe(5.0);
        expect(d.troopGarrisonMinimumPerColony).toBeNull();
    });

    it('int keys use int.TryParse: sign and surrounding white space ok, anything else keeps the default', () => {
        const s = parseBaconSettings('HyperJumpThreshhold= +4000 \npirateFortressTroops=10F\nspyBaseValue=1,000\nasteroidColonyCost=99999999999');
        expect(s.hyperJumpThreshhold).toBe(4000);
        expect(s.pirateFortressTroops).toBe(12); // "10F" fails
        expect(s.spyBaseValue).toBe(25000); // "1,000" → "1.000" fails int.TryParse
        expect(s.asteroidColonyCost).toBe(50000); // Int32 overflow fails
    });

    it('float keys keep float rounding; european commas read as decimal points', () => {
        const s = parseBaconSettings('ammoExhaustChanceMissile=0,33\nspyCaptureChance=0.3\ncapturedSpyEscapeChance=0.05\ntradeTax=0.3');
        expect(s.ammoExhaustChanceMissile).toBe(f(0.33));
        expect(s.spyCaptureChance).toBe(f(0.3));
        expect(s.spyBaseEscapeChance).toBe(f(0.05)); // float.TryParse into a double field
        expect(s.tradeTax).toBe(0.3); // double.TryParse
    });

    it('bool keys: `Trim() == "true" || == "false"` gate, then bool.TryParse', () => {
        expect(parseBaconSettings('tradeEverything=true ').tradeEverything).toBe(true);
        expect(parseBaconSettings('tradeEverything=True').tradeEverything).toBe(false);
        expect(parseBaconSettings('useStarGravityWells=false').useStarGravityWells).toBe(false);
        expect(parseBaconSettings('useStarGravityWells= false').useStarGravityWells).toBe(true);
    });

    it('applies the C# clamps', () => {
        const s = parseBaconSettings(
            [
                'lowStarCount=550',
                'infrastructureSpendingPerDevelopmentLevel=500',
                'infrastuctureDurability=3',
                'noFuelCruiseSpeedMultiplier=0.8',
                'noFuelTopSpeedMultiplier=0.5',
                'privateBuildCostToStateMoney=-1',
                'saveInterval=3',
                'customDifficultyMiningRate=50',
                'showRangeCircles=false',
            ].join('\n'),
        );
        expect(s.lowStarCount).toBe(100);
        expect(s.infrastructureSpendingPerDevelopmentLevel).toBe(10000);
        expect(s.infrasetuctureDurability).toBe(1);
        expect(s.noFuelCruiseSpeedMultiplier).toBe(f(0.8));
        expect(s.noFuelTopSpeedMultiplier).toBe(f(0.8)); // never below the cruise multiplier
        expect(s.privateBuildCostToStateMoney).toBe(0);
        expect(s.statSaveIntervalInGameDays).toBe(10);
        expect(s.customDifficultyMiningRate).toBe(10);
        expect(s.drawWeaponRangeCircles).toBe(false);
        expect(s.minZoomLevelForWeaponsCircles).toBe(5.0);
    });

    (installed ? it : it.skip)("the installed BaconSettings.txt's values", () => {
        const s = parseBaconSettings(readFileSync(installedPath, 'utf-8'));
        expect(s.hyperJumpThreshhold).toBe(4000);
        expect(s.baseHyperJumpAccuracy).toBe(666);
        expect(s.troopGarrisonMinimumPerColony).toBe(20);
        expect(s.useStarGravityWells).toBe(false);
        expect(s.tradeEverything).toBe(true);
        expect(s.shipMarkupFactor).toBe(9);
        expect(s.shipMarkupFactorPirates).toBe(2.5);
        expect(s.shipMaintenanceCostPerSizeUnit).toBe(2);
        expect(s.allowAsteroidColonies).toBe(true);
        expect(s.allowInfrastructureImprovements).toBe(true);
        expect(s.marketPriceUpdateChance).toBe(0.25);
        expect(s.privateBuildCostToStateMoney).toBe(0.3);
        expect(s.quartersOfCashAvailable).toBe(20);
        expect(s.noFuelCruiseSpeedMultiplier).toBe(f(0.9));
        expect(s.noFuelHyperSpeedMultiplier).toBe(f(0.5));
        expect(s.pirateBaseTroops).toBe(5);
        expect(s.pirateFortressTroops).toBe(12); // "10F"
        expect(s.pirateCriminalNetworkTroops).toBe(20);
        expect(s.pirateMaxPopulationInfluence).toBe(45000000000);
        expect(s.lowStarCount).toBe(100); // 550 clamped
        expect(s.researchPerLab).toBe(1000);
        expect(s.weaponRangeMultiplierForBases).toBe(2);
        expect(s.sublightFuelBurnDivisor).toBe(20);
        expect(s.fighterBuildCost).toBe(6);
        expect(s.tailGunnerResearch).toBe('Point Defense Weapons');
    });
});

describe('loadGameData: BaconSettings.txt', () => {
    const serve = (files: Record<string, string>): { fetch: FetchText; requested: string[] } => {
        const requested: string[] = [];
        return {
            requested,
            fetch: async (candidates) => {
                for (const c of candidates) {
                    requested.push(c);
                    if (c in files) return files[c];
                }
                throw new Error(`404 ${candidates.join(', ')}`);
            },
        };
    };
    const minimal: Record<string, string> = {
        '/assets/dwu/raceFamilies.txt': '',
        '/assets/dwu/raceBiases.txt': '',
        '/assets/dwu/raceFamilyBiases.txt': '',
        '/assets/dwu/governments.txt': '',
        '/assets/dwu/governmentBiases.txt': '',
        '/assets/dwu/resources.txt': '',
        '/assets/dwu/components.txt': '',
        '/assets/dwu/fighters.txt': '',
        '/assets/dwu/facilities.txt': '',
        '/assets/dwu/plagues.txt': '',
        '/assets/dwu/research.txt': '',
        '/assets/dwu/characterNames.txt': '',
        '/assets/dwu/designNames.txt': '',
    };

    it('a missing file gives the C# defaults; it is looked up in the install root only', async () => {
        const { fetch, requested } = serve(minimal);
        const data = await loadGameData(fetch, 'SomeSet', [], [], []);
        expect(data.baconSettings).toEqual(defaultBaconSettings());
        expect(requested.filter((r) => r.includes('BaconSettings'))).toEqual(['/assets/dwu/BaconSettings.txt']);
    });

    it('a served file is parsed', async () => {
        const { fetch } = serve({ ...minimal, '/assets/dwu/BaconSettings.txt': 'tradeEverything=true\r\nHyperJumpThreshhold=4000\r\n' });
        const data = await loadGameData(fetch, undefined, [], [], []);
        expect(data.baconSettings?.tradeEverything).toBe(true);
        expect(data.baconSettings?.hyperJumpThreshhold).toBe(4000);
    });
});

describe('game start applies the settings (BaconInitialize)', () => {
    let gameData: GameData;
    beforeAll(async () => {
        gameData = await loadGameDataFs();
    }, 60000);

    function opts(gd: GameData): CreateGameOptions {
        const s = (race: string) => ({ race, homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', startLocation: '(Random)', age: 0, techLevel: 2 });
        return {
            seed: 1, shape: GalaxyShape.Spiral, starCount: 120, sectorWidth: 6, sectorHeight: 6,
            systemNames: Array.from({ length: 120 }, (_, i) => `S${i}`), gameData: gd,
            player: s('Human'), aiEmpires: [s('(Random)'), s('(Random)')],
        };
    }

    (installed ? it : it.skip)('createGame generates with the defaults and applies the installed file at the end', () => {
        setBaconSettings({ ...defaultBaconSettings(), tradeEverything: true, hyperJumpThreshhold: 1 });
        const game = createGame(opts(gameData));
        expect(baconSettings.tradeEverything).toBe(true);
        expect(baconSettings.hyperJumpThreshhold).toBe(4000);
        expect(baconMovementSettings.hyperJumpThreshhold).toBe(4000);
        expect(baconMovementSettings.baseHyperJumpAccuracy).toBe(666);
        expect(baconMovementSettings.useStarGravityWells).toBe(false);
        expect(game.galaxy.independentEmpire!.policy!.troopGarrisonMinimumPerColony).toBe(20);
    });

    (installed ? it : it.skip)('no settings in GameData → C# defaults after createGame', () => {
        const game = createGame(opts({ ...gameData, baconSettings: undefined }));
        expect(baconSettings).toEqual(defaultBaconSettings());
        expect(baconMovementSettings.hyperJumpThreshhold).toBe(12000);
        expect(game.galaxy.independentEmpire!.policy!.troopGarrisonMinimumPerColony).toBe(0);
    });

    (installed ? it : it.skip)('tradeEverything is read at use time by ResolveTradeableItemsColoniesBases (BaconGalaxy.cs 165)', () => {
        const game = createGame(opts({ ...gameData, baconSettings: undefined }));
        const g = game.galaxy;
        const giver = g.empires.find((e) => e !== g.playerEmpire && e.colonies.length > 0)!;
        const receiver = giver;
        resetBaconSettingsToDefaults();
        const off = resolveTradeableItemsColoniesBases(g, giver, receiver, false);
        baconInitializeSettings(g, { ...defaultBaconSettings(), tradeEverything: true });
        const on = resolveTradeableItemsColoniesBases(g, giver, receiver, false);
        resetBaconSettingsToDefaults();
        expect(on.length).toBeGreaterThan(off.length);
        expect(off.length).toBe(resolveTradeableItemsColoniesBases(g, giver, receiver, false).length);
    });
});
