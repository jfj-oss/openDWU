import { beforeAll, describe, expect, it } from 'vitest';
import { generateGalaxy, type Galaxy } from '../src/sim/galaxy';
import { Empire, setGovernmentsStatic } from '../src/sim/empire';
import { makeHabitatIntoColony } from '../src/sim/colony';
import { GalaxyShape, HabitatCategoryType, type Habitat } from '../src/sim/types';
import { Troop, TroopType } from '../src/sim/cargo';
import type { Race } from '../src/sim/data/races';
import { PlanetaryFacilityType } from '../src/sim/researchSystem';
import { queueFacilityConstruction } from '../src/sim/construction/facilities';
import { executeShipAction } from '../src/sim/player/executeShipAction';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import {
    disbandTroops,
    recruitOptions,
    renameTroop,
    setTroopsGarrisoned,
    sortTroopRows,
    troopCompositionDescription,
    troopCountsByType,
    troopFilterLabel,
    troopFilterOptions,
    troopLocation,
    troopRow,
    troopRowMaintenance,
    troopRows,
    troopsForFilter,
    troopStrengthDescription,
    troopSummaryLines,
    troopTypeDescription,
} from '../src/ui/screens/troops';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
}, 60000);

function race100(): Race {
    return { troopStrength: 100 } as unknown as Race;
}
function mk(type: TroopType, attack: number, defend: number, readiness = 100, race: Race | null = race100()): Troop {
    return new Troop('T', type, attack, defend, 100, readiness, null, race);
}

describe('Galaxy.7.cs:5430 ResolveTroopStrengthDescription (Experience column)', () => {
    it('Infantry uses DefendStrength against TroopStrength ×1 / ×1.5 / ×2.5', () => {
        expect(troopStrengthDescription(mk(TroopType.Infantry, 999, 100))).toBe('Green');
        expect(troopStrengthDescription(mk(TroopType.Infantry, 0, 101))).toBe('Experienced');
        expect(troopStrengthDescription(mk(TroopType.Infantry, 0, 150))).toBe('Experienced');
        expect(troopStrengthDescription(mk(TroopType.Infantry, 0, 250))).toBe('Veteran');
        expect(troopStrengthDescription(mk(TroopType.Infantry, 0, 251))).toBe('Elite');
    });
    it('Artillery scales the thresholds by 0.75; Armored by 3 on attack; Special Forces by 2 on attack', () => {
        expect(troopStrengthDescription(mk(TroopType.Artillery, 0, 75))).toBe('Green');
        expect(troopStrengthDescription(mk(TroopType.Artillery, 0, 76))).toBe('Experienced');
        expect(troopStrengthDescription(mk(TroopType.Armored, 300, 0))).toBe('Green');
        expect(troopStrengthDescription(mk(TroopType.Armored, 451, 0))).toBe('Veteran');
        expect(troopStrengthDescription(mk(TroopType.SpecialForces, 501, 0))).toBe('Elite');
        expect(troopStrengthDescription(mk(TroopType.PirateRaider, 101, 0))).toBe('Experienced');
    });
    it('is empty for a troop without a race', () => {
        expect(troopStrengthDescription(mk(TroopType.Infantry, 100, 100, 100, null))).toBe('');
    });
});

describe('summary (Main.Part11.cs:3611 method_171)', () => {
    it('composition counts and text in Inf, PDU, Arm, SF order', () => {
        const troops = [mk(TroopType.Armored, 1, 1), mk(TroopType.Infantry, 1, 1), mk(TroopType.Infantry, 1, 1), mk(TroopType.Artillery, 1, 1), mk(TroopType.PirateRaider, 1, 1)];
        expect(troopCountsByType(troops)).toEqual({ infantry: 2, artillery: 1, armor: 1, specialForces: 0 });
        expect(troopCompositionDescription(2, 1, 1, 0)).toBe('2 Inf, 1 PDU, 1 Arm');
        expect(troopCompositionDescription(0, 0, 0, 3)).toBe('3 SF');
        expect(troopCompositionDescription(0, 0, 0, 0)).toBe('');
    });
    it('totals are (int) readiness-weighted sums shown as "0,K"; maintenance skips troops without an empire factor', () => {
        // Attack 120×100 + 300×50 = 27000 → "27K"; defend 80×100 + 150×50 = 15500 → "16K" (rounded).
        const troops = [mk(TroopType.Infantry, 120, 80, 100), mk(TroopType.Armored, 300, 150, 50)];
        troops.forEach((t) => (t.maintenanceMultiplier = t.type === TroopType.Armored ? 2 : 1));
        const lines = troopSummaryLines(troops, null);
        expect(lines[0]).toBe('2 troops: 1 Inf, 1 Arm');
        expect(lines[1]).toBe('Total Attack Strength: 27K');
        expect(lines[2]).toBe('Total Defend Strength: 16K');
        // TroopList.AnnualTroopMaintenance(null): 1000 × 1 + 1000 × 2 = 3000 → "3K".
        expect(lines[3]).toBe('Annual Maintenance Costs: 3K');
        expect(troopSummaryLines([], null)[0]).toBe('0 troops');
    });
});

describe('rows and sorts (TroopListView.cs BindData)', () => {
    it('row cells: type text, readiness, overall strengths, empty location', () => {
        const t = mk(TroopType.Artillery, 40, 200, 50);
        const r = troopRow(t);
        expect(r.type).toBe('Planetary Defense Unit');
        expect(r.readiness).toBe(50);
        expect(r.attack).toBe(2000);
        expect(r.defend).toBe(10000);
        expect(r.location).toBe('');
        expect(r.empireName).toBe('(None)');
        expect(troopTypeDescription(TroopType.Undefined)).toBe('');
    });
    it('sorts strings and numbers both ways, ties in bound order; null key keeps bound order', () => {
        const a = mk(TroopType.Infantry, 10, 10, 100);
        a.name = 'Bravo';
        const b = mk(TroopType.Armored, 30, 10, 100);
        b.name = 'alpha';
        const c = mk(TroopType.Infantry, 10, 10, 100);
        c.name = 'Charlie';
        const rows = troopRows([a, b, c]);
        expect(sortTroopRows(rows, null, false).map((r) => r.name)).toEqual(['Bravo', 'alpha', 'Charlie']);
        expect(sortTroopRows(rows, 'name', false).map((r) => r.name)).toEqual(['alpha', 'Bravo', 'Charlie']);
        expect(sortTroopRows(rows, 'name', true).map((r) => r.name)).toEqual(['Charlie', 'Bravo', 'alpha']);
        expect(sortTroopRows(rows, 'attack', true).map((r) => r.name)).toEqual(['alpha', 'Bravo', 'Charlie']);
        expect(sortTroopRows(rows, 'attack', false).map((r) => r.name)).toEqual(['Bravo', 'Charlie', 'alpha']);
        expect(sortTroopRows(rows, 'type', false).map((r) => r.type)).toEqual(['Armored Forces', 'Infantry', 'Infantry']);
    });
});

describe('with a colony (fixture galaxy)', () => {
    function setup(): { g: Galaxy; e: Empire; colony: Habitat; race: Race } {
        const g = generateGalaxy({ seed: 5, shape: GalaxyShape.Spiral, starCount: 200, sectorWidth: 6, sectorHeight: 6, systemNames: Array.from({ length: 200 }, (_, i) => `S${i}`), gameData });
        const race = gameData.races.find((r) => r.name === 'Human') ?? gameData.races[0];
        const [capital, target] = g.habitats.filter((h) => h.category === HabitatCategoryType.Planet && h.population.totalAmount === 0);
        const e = new Empire(g, 'Test Empire', capital, race, 0, 1.0, null);
        makeHabitatIntoColony(g, target, e, 0, race, 1.0, false);
        e.troopCanRecruitInfantry = false;
        e.troopCanRecruitArmored = false;
        e.troopCanRecruitArtillery = false;
        e.troopCanRecruitSpecialForces = false;
        return { g, e, colony: target, race };
    }

    it('recruitable types follow Habitat.cs:6900 gating: flags, Armored Factory / Military Academy, facility templates', () => {
        const { g, e, colony } = setup();
        expect(colony.owner).toBe(e);
        expect(recruitOptions(g, e, colony)).toEqual([]);
        e.troopCanRecruitInfantry = true;
        e.troopCanRecruitArtillery = true;
        e.troopCanRecruitArmored = true; // researched, but no Armored Factory at the colony
        e.troopCanRecruitSpecialForces = true; // no Military Academy
        expect(recruitOptions(g, e, colony).map((o) => o.troop.type)).toEqual([TroopType.Infantry, TroopType.Artillery]);
        queueFacilityConstruction(g, colony, PlanetaryFacilityType.ArmoredFactory, false); // under construction: not yet
        expect(recruitOptions(g, e, colony).length).toBe(2);
        colony.facilities!.find((f) => f.type === PlanetaryFacilityType.ArmoredFactory)!.constructionProgress = 1;
        queueFacilityConstruction(g, colony, PlanetaryFacilityType.MilitaryAcademy, true);
        const four = recruitOptions(g, e, colony);
        expect(four.map((o) => o.troop.type)).toEqual([TroopType.Infantry, TroopType.Armored, TroopType.Artillery, TroopType.SpecialForces]);
        expect(four.every((o) => o.extra === '')).toBe(true);
        expect(four[0].label).toBe(`Recruit Troops (${four[0].troop.name}, Infantry)`);
        // Troop Training Center appends the elite template (5th, index 4 → ExtraData "elite").
        queueFacilityConstruction(g, colony, PlanetaryFacilityType.TroopTrainingCenter, true);
        const five = recruitOptions(g, e, colony);
        expect(five.length).toBe(5);
        expect(five[4].extra).toBe('elite');
        expect(five[4].action.extraData).toBe('elite');
        // Robotic foundry adds a 6th template: the selection panel has only five buttons (Main.Part3.cs:2776 m 0-4).
        queueFacilityConstruction(g, colony, PlanetaryFacilityType.RoboticTroopFoundry, true);
        expect(recruitOptions(g, e, colony).length).toBe(5);
    });

    it('recruitable only at a colony the player owns (Main.Part3.cs:2759 Owner == PlayerEmpire)', () => {
        const { g, e, colony, race } = setup();
        e.troopCanRecruitInfantry = true;
        const other = new Empire(g, 'Other', g.habitats.find((h) => h.category === HabitatCategoryType.Planet && h.population.totalAmount === 0)!, race, 0, 1.0, null);
        expect(recruitOptions(g, other, colony)).toEqual([]);
    });

    it('recruit via RecruitTroops adds a Readiness-0 troop to TroopsToRecruit and the empire; it shows in the colony filter with 0 maintenance', () => {
        const { g, e, colony } = setup();
        e.troopCanRecruitInfantry = true;
        const before = e.troops.count;
        const [inf] = recruitOptions(g, e, colony);
        const r = executeShipAction(g, e, colony, inf.action, false, {});
        expect(r.ok).toBe(true);
        expect(e.troops.count).toBe(before + 1);
        const added = e.troops.items[e.troops.count - 1];
        expect(colony.troopsToRecruit!.contains(added)).toBe(true);
        expect(added.readiness).toBe(0);
        expect(added.beingRecruited).toBe(true);
        expect(troopRowMaintenance(added)).toBe(0);
        expect(troopLocation(added)).toBe(colony.name);
        expect(troopsForFilter(e, { kind: 'all' })).toContain(added);
        // cmbTroopFilter: the colony's lists show only when ResolveInvasionEmpires names the player defender, which
        // needs a troop in Troops (or a character) — with an empty garrison the C# lists nothing.
        colony.troops!.clear();
        expect(troopsForFilter(e, { kind: 'colony', colony })).toEqual([]);
        const garrison = new Troop('G', TroopType.Infantry, 100, 100, 100, 100, e, null);
        garrison.colony = colony;
        colony.troops!.add(garrison);
        expect(troopsForFilter(e, { kind: 'colony', colony })).toEqual([garrison, ...colony.troopsToRecruit!.items]);
    });

    it('filter options: (None), fleets, colonies by name; disband / garrison / rename (Main.Part9.cs:4070, Main.Part11.cs:3684/3707)', () => {
        const { g, e, colony } = setup();
        const opts = troopFilterOptions(e);
        expect(opts[0]).toEqual({ kind: 'all' });
        expect(troopFilterLabel(opts[0])).toBe('(None)');
        const names = opts.filter((o) => o.kind === 'colony').map((o) => troopFilterLabel(o));
        expect(names).toEqual([...names].sort((a, b) => new Intl.Collator('en-US').compare(a, b)));

        e.troopCanRecruitInfantry = true;
        const [inf] = recruitOptions(g, e, colony);
        executeShipAction(g, e, colony, inf.action, false, {});
        executeShipAction(g, e, colony, inf.action, false, {});
        const t1 = e.troops.items[e.troops.count - 2];
        const t2 = e.troops.items[e.troops.count - 1];
        expect(setTroopsGarrisoned(e, [t1], true)).toBe(1);
        expect(t1.garrisoned).toBe(true);
        expect(troopRow(t1).garrisoned).toBe(true);
        expect(renameTroop(t1, '   ')).toBe(false);
        expect(renameTroop(t1, 'Home Guard')).toBe(true);
        expect(t1.name).toBe('Home Guard');

        const idx = e.troops.items.indexOf(t1);
        const count = e.troops.count;
        expect(disbandTroops(e, [t1, t2])).toBe(idx - 1);
        expect(e.troops.count).toBe(count - 2);
        expect(colony.troopsToRecruit!.contains(t1)).toBe(false);
        expect(t1.empire).toBe(null);
        expect(t1.colony).toBe(null);
        expect(t1.awaitingPickup).toBe(false);
    });
});
