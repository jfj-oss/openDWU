// Playtest 2026-09-25 sim fixes (fix4sim): bug 1 (null galaxy.builtObjects holes), bug 16 (BaconSettings.txt: no star
// gravity wells, explorers leave the home system), the Galaxy.5.cs populated-habitat troop lists, bug 7 (money panel
// Cashflow / Bonus Income), bug 15 (saved Empire.MessageHistory).
import { beforeAll, describe, expect, it } from 'vitest';
import type { GameData } from '../src/sim/data/gameData';
import type { BuiltObject } from '../src/sim/builtObject';
import type { Game } from '../src/sim/game';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { builtObjectCompleteTeardown } from '../src/sim/combat/teardown';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { baconInitializeSettings, resetBaconSettings } from '../src/sim/baconSettings';
import { parseBaconSettings } from '../src/sim/data/baconSettings';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BACON_MOVEMENT_SETTINGS_DEFAULTS, baconMovementSettings, isOutsideStarGravityWell } from '../src/sim/movement';
import { HabitatCategoryType } from '../src/sim/types';
import { checkAgeVariableIncome, moneyPanelIncome, obtainAveragedVariableIncome, thisYearsForeignTradeBonuses, thisYearsResortIncome, thisYearsSpacePortIncome, annualStateMaintenanceExcludingUnderConstruction } from '../src/sim/treasury';
import { annualFacilityMaintenance, annualPirateProtection, annualSubjugationTribute, annualTaxRevenue, calculateAnnualSubjugationTributeIncome } from '../src/sim/forceStructure';
import { annualTroopMaintenance } from '../src/sim/troops';
import { REAL_SECONDS_IN_GALACTIC_YEAR } from '../src/sim/tick/simTime';
import { EmpireMessage, EmpireMessageType, addHistoryMessage, empireMessageHistory, removeOldHistoryMessages } from '../src/sim/messages';
import { createEmpireMessageFeed } from '../src/ui/empireMessageFeed';
import { formatSignedMoney } from '../src/ui/hud';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

const startOptions = { ...defaultStartGameOptions(), seed: 1 };

function timeOf(game: Game): GalaxyTime {
    const time = new GalaxyTime();
    time.togglePause();
    time.advance(game.galaxy.nowMs);
    return time;
}

describe('bug 1: a torn-down ship leaves a null hole in galaxy.builtObjects (BuiltObject.2.cs 5519-5523)', { timeout: 600000 }, () => {
    it('keeps the index as null like the C#, and digest, save/load and further ticks tolerate it', () => {
        const game = createTickGame(gameData);
        runGameSeconds(game, 5);
        const g = game.galaxy;
        const list = g.builtObjects;
        const ship = list.find((b): b is BuiltObject => b !== null && b.role !== BuiltObjectRole.Base && b.empire === g.playerEmpire)!;
        const index = list.indexOf(ship);
        const length = list.length;
        builtObjectCompleteTeardown(g, ship, true);
        // C#: `_Galaxy.BuiltObjects[num15] = null` — only RemoveNullBuiltObjects (Galaxy.9.cs 2862, habitat / system
        // removal) compacts the list, and Main.Part11.cs 778 counts "BuiltObjects (incl dest)".
        expect(list.length).toBe(length);
        expect(list[index]).toBeNull();
        expect(g.playerEmpire!.builtObjects).not.toContain(ship);
        expect(() => stateDigest(g)).not.toThrow();
        // Save → load keeps the hole at the same index (the scheduler's round-robin cursor counts it), byte-identically.
        const text = serializeGame(game, timeOf(game), startOptions);
        const restored = deserializeGame(text, gameData);
        expect(serializeGame(restored.game, restored.time, restored.startOptions)).toBe(text);
        const list2 = restored.game.galaxy.builtObjects;
        expect(list2.length).toBe(length);
        expect(list2[index]).toBeNull();
        expect(list2.map((b) => b === null)).toEqual(list.map((b) => b === null));
        // The original and the restored game run on identically across the hole.
        runGameSeconds(game, 10);
        runGameSeconds(restored.game, 10);
        expect(stateDigest(restored.game.galaxy)).toBe(stateDigest(g));
    });
});

/** The installed BaconSettings.txt lines the movement statics come from (lines 11, 14, 22, 25, 29, 137-139). */
const STOCK_BACON_SETTINGS: ReadonlyMap<string, string> = new Map([
    ['HyperJumpThreshhold', '4000'],
    ['BaseHyperJumpAccuracy', '666'],
    ['useStarGravityWells', 'false'],
    ['smallShipsJumpSooner', 'false'],
    ['sublightFuelBurnDivisor', '20'],
    ['noFuelCruiseSpeedMultiplier', '0.90'],
    ['noFuelTopSpeedMultiplier', '0.90'],
    ['noFuelHyperSpeedMultiplier', '0.50'],
]);
const settingsText = (m: ReadonlyMap<string, string>): string => [...m].map(([k, v]) => `${k}=${v}`).join('\r\n');

describe('bug 16: BaconSettings.txt overrides (BaconMain.cs 551 BaconInitialize)', { timeout: 600000 }, () => {
    it('STOCK_BACON_SETTINGS matches the installed BaconSettings.txt lines it cites', () => {
        const text = readFileSync(resolve(__dirname, '../public/assets/dwu/BaconSettings.txt'), 'utf-8');
        for (const [k, v] of STOCK_BACON_SETTINGS) expect(text.split(/\r?\n/)).toContain(`${k}=${v}`);
    });

    it('the stock file turns the star gravity wells off and sets the hyperjump / fuel statics', () => {
        resetBaconSettings();
        expect(baconMovementSettings.useStarGravityWells).toBe(true);
        baconInitializeSettings(null, parseBaconSettings(settingsText(STOCK_BACON_SETTINGS)));
        expect(baconMovementSettings.useStarGravityWells).toBe(false); // BaconSettings.txt useStarGravityWells=false
        expect(baconMovementSettings.hyperJumpThreshhold).toBe(4000);
        expect(baconMovementSettings.baseHyperJumpAccuracy).toBe(666);
        expect(baconMovementSettings.smallShipsJumpSooner).toBe(false);
        expect(baconMovementSettings.sublightFuelBurnDivisor).toBe(20);
        expect(baconMovementSettings.noFuelCruiseSpeedMultiplier).toBe(Math.fround(0.9));
        expect(baconMovementSettings.noFuelTopSpeedMultiplier).toBe(Math.fround(0.9));
        expect(baconMovementSettings.noFuelHyperSpeedMultiplier).toBe(Math.fround(0.5));
        // noFuelTopSpeedMultiplier is clamped to [0.1, 1] and never below the cruise multiplier (BaconMain.cs 863-870).
        resetBaconSettings();
        baconInitializeSettings(null, parseBaconSettings('noFuelCruiseSpeedMultiplier=0.8\nnoFuelTopSpeedMultiplier=0.05\nuseStarGravityWells=TRUE'));
        expect(baconMovementSettings.noFuelTopSpeedMultiplier).toBe(Math.fround(0.8));
        expect(baconMovementSettings.useStarGravityWells).toBe(true); // "TRUE" fails `value.Trim() == "true"`
        resetBaconSettings();
        expect({ ...baconMovementSettings }).toEqual({ ...BACON_MOVEMENT_SETTINGS_DEFAULTS });
    });

    it('createGame applies the file once the game exists; starting explorers are outside the gravity-well rule and jump out', () => {
        const game = createTickGame(gameData);
        const g = game.galaxy;
        expect(baconMovementSettings.useStarGravityWells).toBe(false);
        const explorers = g.playerEmpire!.builtObjects.filter((b) => b.subRole === BuiltObjectSubRole.ExplorationShip && b.warpSpeed > 0);
        expect(explorers.length).toBeGreaterThan(0);
        for (const b of explorers) expect(isOutsideStarGravityWell(g, b)).toBe(true);
        const capitalStar = g.systems[g.playerEmpire!.capital!.systemIndex].systemStar;
        // BuiltObject.2.cs 3020 HyperTo: HyperjumpInitiate (15 s for the starting Gerax drive) ± 1 s, then warp speed.
        runGameSeconds(game, 30);
        const away = explorers.filter((b) => Math.hypot(b.xpos - capitalStar.xpos, b.ypos - capitalStar.ypos) > 23000);
        expect(away.length).toBeGreaterThan(0);
    });

    it('Galaxy.5.cs 1609-1616 / 1747-1752: every populated generated planet and moon has its troop lists', () => {
        const g = createTickGame(gameData).galaxy;
        const populated = g.habitats.filter((h) => h.population.items.length > 0 && (h.category === HabitatCategoryType.Planet || h.category === HabitatCategoryType.Moon));
        expect(populated.some((h) => h.category === HabitatCategoryType.Moon)).toBe(true);
        for (const h of populated) {
            expect(h.troops, h.name).not.toBeNull();
            expect(h.troopsToRecruit, h.name).not.toBeNull();
            expect(h.invadingTroops, h.name).not.toBeNull();
            expect(h.cargo, h.name).not.toBeNull();
        }
    });
});

describe('bug 7: money panel Cashflow / Bonus Income (Main.Part11.cs 832 method_126)', { timeout: 600000 }, () => {
    it('cashflow = tax + tribute income − maintenance terms; bonus = trade + resort + space port; finite numbers', () => {
        const game = createTickGame(gameData);
        runGameSeconds(game, 20);
        const g = game.galaxy;
        const e = g.playerEmpire!;
        expect(e.useAveragedVariableIncome).toBe(false);
        const r = moneyPanelIncome(g, e)!;
        expect(e.useAveragedVariableIncome).toBe(true);
        const income = annualTaxRevenue(g, e) + calculateAnnualSubjugationTributeIncome(g, e);
        const costs = annualStateMaintenanceExcludingUnderConstruction(e) + annualTroopMaintenance(e) + annualFacilityMaintenance(e) + annualSubjugationTribute(g, e) + e.thisYearsStateFuelCosts + annualPirateProtection(e);
        expect(r.cashflow).toBe(income - costs);
        expect(r.bonusIncome).toBe(thisYearsForeignTradeBonuses(e) + thisYearsResortIncome(g, e) + thisYearsSpacePortIncome(g, e));
        expect(Number.isFinite(r.cashflow) && Number.isFinite(r.bonusIncome)).toBe(true);
        expect(annualTaxRevenue(g, e)).toBeGreaterThan(0);
    });

    it('CheckAgeVariableIncome ages the variable income once per galactic year (Empire.6.cs 2196-2250)', () => {
        const game = createTickGame(gameData);
        const g = game.galaxy;
        const e = g.playerEmpire!;
        checkAgeVariableIncome(g, e);
        expect(e.variableIncome!.length).toBe(1);
        const year = REAL_SECONDS_IN_GALACTIC_YEAR * 1000;
        expect(e.lastVariableIncomeUpdate % year).toBe(0);
        checkAgeVariableIncome(g, e);
        expect(e.variableIncome!.length).toBe(1);
        e.variableIncome = [100, 200, 300];
        expect(obtainAveragedVariableIncome(e)).toBeCloseTo((100 * 0.7 + 200 * 0.49 + 300 * 0.343) / (0.7 + 0.49 + 0.343), 10);
    });

    it('formats like .NET "+##,###,##0;-##,###,##0"', () => {
        expect(formatSignedMoney(213959.4)).toBe('+213,959');
        expect(formatSignedMoney(-5000.5)).toBe('-5,001');
        expect(formatSignedMoney(0)).toBe('+0');
        expect(formatSignedMoney(0.4)).toBe('+0');
        expect(formatSignedMoney(1234567)).toBe('+1,234,567');
    });
});

describe('bug 15: Empire.MessageHistory is kept and saved (Empire.cs 82, 4697 AddHistoryMessage, 4708 RemoveOldHistoryMessages)', { timeout: 600000 }, () => {
    it('the feed adds every shown message except Informational, once; the history survives save/load', () => {
        const game = createTickGame(gameData);
        const g = game.galaxy;
        const e = g.playerEmpire!;
        const m1 = new EmpireMessage(null, EmpireMessageType.NewColony, null);
        m1.description = 'first';
        m1.starDate = 1000;
        const m2 = new EmpireMessage(null, EmpireMessageType.Informational, null);
        m2.description = 'info';
        (e.messages as EmpireMessage[]).push(m1, m2);
        const feed = createEmpireMessageFeed();
        feed.poll(e);
        feed.poll(e);
        addHistoryMessage(e, m1);
        expect(empireMessageHistory(e)).toEqual([m1]);
        const text = serializeGame(game, timeOf(game), startOptions);
        const restored = deserializeGame(text, gameData).game.galaxy.playerEmpire!;
        const h = empireMessageHistory(restored);
        expect(h.length).toBe(1);
        expect(h[0]).toBeInstanceOf(EmpireMessage);
        expect(h[0].description).toBe('first');
        expect(h[0].starDate).toBe(1000);
        expect(h[0].messageType).toBe(EmpireMessageType.NewColony);
    });

    it('RemoveOldHistoryMessages keeps the newest MaximumHistoryMessages plus every GalacticHistory message', () => {
        const e = createTickGame(gameData).galaxy.playerEmpire!;
        e.maximumHistoryMessages = 3;
        const mk = (date: number, type = EmpireMessageType.NewColony) => {
            const m = new EmpireMessage(null, type, null);
            m.starDate = date;
            addHistoryMessage(e, m);
            return m;
        };
        mk(1);
        const old = mk(2, EmpireMessageType.GalacticHistory);
        mk(3);
        mk(4);
        mk(5);
        removeOldHistoryMessages(e);
        expect(empireMessageHistory(e).map((m) => m.starDate)).toEqual([5, 4, 3, 2]);
        expect(empireMessageHistory(e)).toContain(old);
    });
});
