// M4z6 — pirate-control readers & C# leftovers (tasks/M4-deferred-plan.md M4z6): unit tests against the C# sources.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { PlanetaryFacilityType } from '../src/sim/researchSystem';
import { PlanetaryFacility, definitionsFindFacilityByType, planetaryFacilityDefinitionsStatic } from '../src/sim/construction/facilities';
import { inflictBombardDamage, selectRandomFacility } from '../src/sim/combat/damage';
import { PirateColonyControl, checkColonyRevenueFromPirateControl } from '../src/sim/pirates/pirateColonyControl';
import { Fighter, identifyLatestFighterSpecification } from '../src/sim/combat/fighters';
import { TradeableItem, TradeableItemType, giveTradeableItem } from '../src/sim/tradeItems';
import { stellarCurrentSpeed, stellarFirepowerRaw, stellarIsFunctional, stellarTopSpeed } from '../src/sim/combat/threats';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function aiEmpire(g: Galaxy): Empire {
    return g.empires.find((e) => e !== g.playerEmpire)!;
}
function facility(g: Galaxy, type: PlanetaryFacilityType, progress = 1): PlanetaryFacility {
    return new PlanetaryFacility(definitionsFindFacilityByType(planetaryFacilityDefinitionsStatic(g), type)!, progress);
}
/** Replace Galaxy.Rnd with a deterministic stub: Next(min, max) → min, NextDouble → 0. */
function stubRnd(g: Galaxy): void {
    const r = g.rnd as unknown as { next: (a?: number, b?: number) => number; nextDouble: () => number };
    r.next = (a?: number, b?: number) => (b === undefined ? 0 : (a ?? 0));
    r.nextDouble = () => 0;
}

describe('M4z6 (2) InflictBombardDamage facility types (BuiltObject.2.cs 5877-5911)', () => {
    it('SelectRandomFacility(PirateCriminalNetwork) excludes the criminal network by PlanetaryFacilityType (PlanetaryFacilityList.cs 214)', () => {
        const g = createTickGame(gameData).galaxy;
        const net = facility(g, PlanetaryFacilityType.PirateCriminalNetwork);
        expect(selectRandomFacility(g, [net], PlanetaryFacilityType.PirateCriminalNetwork)).toBeNull();
        const base = facility(g, PlanetaryFacilityType.PirateBase);
        for (let i = 0; i < 20; i++) {
            const got = selectRandomFacility(g, [net, base], PlanetaryFacilityType.PirateCriminalNetwork);
            expect(got === null || got === base).toBe(true);
        }
    });

    it('a bombarded pirate base clears the facility control (control − 0.2 clamped to [0.01, 0.49])', () => {
        const g = createTickGame(gameData).galaxy;
        const e = aiEmpire(g);
        const cap = e.capital!;
        cap.planetaryShieldPresent = false;
        const pirate = g.pirateEmpires[0];
        const self = pirate.builtObjects[0];
        const base = facility(g, PlanetaryFacilityType.PirateBase);
        cap.facilities = [base];
        cap.pirateColonyControl.items = [];
        const control = new PirateColonyControl(pirate.empireId, 0.8, true);
        cap.pirateColonyControl.add(control);
        stubRnd(g); // Next(0, 2) == 0 → the pirate facility is destroyed
        inflictBombardDamage(g, self, cap, 5000);
        expect(cap.facilities).toEqual([]);
        expect(control.hasFacilityControl).toBe(false);
        expect(control.controlLevel).toBe(Math.min(Math.fround(0.49), Math.max(Math.fround(0.01), Math.fround(Math.fround(0.8) - Math.fround(0.2)))));
    });
});

describe('M4z6 (4) StellarObject readers on a Fighter (StellarObject.cs 37-41)', () => {
    it('FirepowerRaw / TopSpeed / CurrentSpeed are the fighter\'s own fields; IsFunctional is never set (false)', () => {
        const g = createTickGame(gameData).galaxy;
        const carrier = g.builtObjects.find((b) => b !== null && b.empire === g.playerEmpire)!;
        if (carrier.fighters === null) carrier.fighters = [];
        const f = new Fighter(g, identifyLatestFighterSpecification(g.playerEmpire!)!, carrier);
        expect(f.firepowerRaw).toBeGreaterThan(0);
        expect(stellarFirepowerRaw(f)).toBe(f.firepowerRaw);
        expect(stellarTopSpeed(f)).toBe(f.topSpeed);
        f.currentSpeed = 12;
        expect(stellarCurrentSpeed(f)).toBe(12);
        expect(stellarIsFunctional(f)).toBe(false);
    });
});

describe('M4z6 (5) PirateEconomy.PerformIncome through the one pirateAI entry point', () => {
    it('GiveTradeableItem Money books SellInfo when contacts / maps are exchanged, otherwise Undefined (Galaxy.4.cs 3864-3886)', () => {
        const g = createTickGame(gameData).galaxy;
        const giver = aiEmpire(g);
        const pirate = g.pirateEmpires[0];
        const other = g.empires.find((e) => e !== giver)!;
        const sell0 = pirate.pirateEconomy.thisYear.sellInfoIncome;
        const other0 = pirate.pirateEconomy.thisYear.otherIncome;
        const exp0 = giver.pirateEconomy.thisYear.otherExpenses;
        giveTradeableItem(g, giver, pirate, new TradeableItem(TradeableItemType.Money, 1000, 1000), [new TradeableItem(TradeableItemType.ContactEmpire, other, 0)]);
        expect(pirate.pirateEconomy.thisYear.sellInfoIncome).toBe(sell0 + 1000);
        expect(giver.pirateEconomy.thisYear.otherExpenses).toBe(exp0 + 1000);
        giveTradeableItem(g, giver, pirate, new TradeableItem(TradeableItemType.Money, 500, 500), null);
        expect(pirate.pirateEconomy.thisYear.otherIncome).toBe(other0 + 500);
    });
});

describe('M4z6 (1) Habitat.cs 6070 CheckColonyRevenueFromPirateControl', () => {
    it('true only for a pirate faction on a colony it does not own', () => {
        const g = createTickGame(gameData).galaxy;
        const e = aiEmpire(g);
        const pirate = g.pirateEmpires[0];
        const cap = e.capital!;
        expect(checkColonyRevenueFromPirateControl(cap, e)).toBe(false);
        expect(checkColonyRevenueFromPirateControl(cap, null)).toBe(false);
        expect(checkColonyRevenueFromPirateControl(cap, pirate)).toBe(true);
        expect(checkColonyRevenueFromPirateControl({ empire: pirate }, pirate)).toBe(false);
    });
});
