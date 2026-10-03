// Parity batch D2 on the seed-1 harness game: Scrap selected ships and bases (Main.Part3.cs 403
// btnBuiltObjectScrapSelected_Click → 'scrapShips'), the Enemy Targets panel (Main.Part11.cs 5081 method_205,
// ItemListCollectionPanel.cs 822 ResolveAssignedFleet, Main.Part12.cs 2469 method_78, ItemListPanel.cs method_8),
// Galaxy.6.cs 20 GenerateRuinAbilitiesSummary + the Ruin Detail text (Main.Part4.cs 3978 method_550),
// Galaxy.3.cs 334 ResolveComponentsThatUseResource (the Resource Components panel, method_552) and the shared
// Ships and Bases data tabs (BuiltObjectComponentListView / WeaponListView BindData, method_178 tab captions).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { BuiltObject } from '../src/sim/builtObject';
import type { Habitat } from '../src/sim/types';
import type { ShipGroup } from '../src/sim/fleets/shipGroup';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { ComponentType } from '../src/sim/data/components';
import { DiplomaticRelationType } from '../src/sim/diplomacy';
import { BuiltObjectMissionType } from '../src/sim/missions/mission';
import { flushPlayerCommands, issuePlayerCommand, runPlayerCommand } from '../src/sim/player/playerCommands';
import { enemyTargetList, enemyTargetListDrawsRandom, enemyTargetObjects, resolveAssignedFleet } from '../src/sim/player/enemyTargets';
import { Ruin, RuinType } from '../src/sim/ruins';
import { formatNetPercentHash, generateRuinAbilitiesSummary } from '../src/sim/exploration';
import { resolveComponentsThatUseResource } from '../src/sim/componentStatic';
import { componentDefinitionsStatic } from '../src/sim/designGeneration';
import { isLuxuryResource } from '../src/sim/logistics/orders';
import { builtObjectTabLabels, componentRows, damageGraphPoints, weaponRows } from '../src/ui/screens/builtObjectDataTabs';
import { ruinDetailDescription } from '../src/ui/screens/ruinDetail';
import { resourceComponentRows, TECH_CELL_TEXT } from '../src/ui/screens/resourceComponents';
import { EnemyTargetItem, enemyTargetDescription, enemyTargetItems, itemPanelDefs, itemRowModel } from '../src/ui/leftSidebar';
import { TAB_ORDER, purchaserChecks, purchaserDesigns } from '../src/ui/screens/constructionYards';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

describe('scrapShips (btnBuiltObjectScrapSelected_Click)', () => {
    it('tears the selected ship down and takes it off the empire; refuses other empires\' ships', () => {
        const g = cachedTickGame(gameData);
        const p = g.playerEmpire;
        const ship = p.builtObjects.find((b) => b != null && b.role !== BuiltObjectRole.Base && !b.hasBeenDestroyed)!;
        expect(ship).toBeTruthy();
        const other = g.galaxy.empires.find((e) => e !== p && e.builtObjects.length > 0)!;
        const foreign = other.builtObjects[0];
        let n = -1;
        issuePlayerCommand(g.galaxy, p, 'scrapShips', [[ship, foreign]], (r) => (n = r));
        flushPlayerCommands(g.galaxy);
        expect(n).toBe(1);
        expect(ship.hasBeenDestroyed).toBe(true);
        expect(p.builtObjects).not.toContain(ship);
        expect(foreign.hasBeenDestroyed).toBe(false);
    }, 300000);

    it('scrapping a base with a construction queue tears down its slipway and waiting ships', () => {
        const g = cachedTickGame(gameData);
        const p = g.playerEmpire;
        const yard = p.builtObjects.find((b) => b != null && b.isShipYard && b.constructionQueue != null)!;
        expect(yard).toBeTruthy();
        const d = purchaserDesigns(p.designs, { kind: 'builtObject', builtObject: yard }, purchaserChecks(p))[0];
        expect(d).toBeTruthy();
        p.stateMoney += d.calculateCurrentPurchasePrice(g.galaxy) * 10;
        const bought: BuiltObject[] = [];
        for (let i = 0; i < 3; i++) issuePlayerCommand(g.galaxy, p, 'yardPurchase', [d, yard], (bo) => bo && bought.push(bo));
        flushPlayerCommands(g.galaxy);
        expect(bought.length).toBeGreaterThan(0);
        expect(runPlayerCommand(g.galaxy, p, 'scrapShips', [[yard]])).toBe(1);
        expect(yard.hasBeenDestroyed).toBe(true);
        for (const b of bought) expect(b.hasBeenDestroyed).toBe(true);
    }, 300000);
});

describe('Enemy Targets (method_205, ResolveAssignedFleet, method_78)', () => {
    it('lists the war enemy\'s strike points, highest weighted priority first; none without a war', () => {
        const g = cachedTickGame(gameData);
        const p = g.playerEmpire;
        for (let i = 0; i < p.diplomaticRelations.count; i++) p.diplomaticRelations.at(i).type = DiplomaticRelationType.None;
        expect(enemyTargetListDrawsRandom(p)).toBe(false);
        const peace = enemyTargetObjects(g.galaxy, p);
        // Only pirate bases (relation None with a pirate faction) can be listed in peace.
        for (const t of peace) expect((t as BuiltObject).role).toBe(BuiltObjectRole.Base);
        const rel = p.diplomaticRelations.at(0);
        rel.type = DiplomaticRelationType.War;
        const list = enemyTargetList(g.galaxy, p);
        for (let i = 1; i < list.length; i++) expect(list[i - 1].weightedPriority).toBeGreaterThanOrEqual(list[i].weightedPriority);
        const objs = enemyTargetObjects(g.galaxy, p);
        expect(objs.length).toBe(list.length);
        // The panel items and the row model.
        const items = enemyTargetItems(objs);
        expect(items.every((x) => x instanceof EnemyTargetItem)).toBe(true);
        if (items.length > 0) {
            const row = itemRowModel({ galaxy: g.galaxy, player: p, sizeFactor: 1, resource: () => null }, 'enemyTargets', items[0]);
            expect(row.line2[0].kind === 'text' && /firepower/.test(row.line2[0].text)).toBe(true);
            expect(row.textAlpha).toBe(255);
        }
    }, 300000);

    it('the attack order sends the selected fleet; the fleet then shows as assigned; a right click cancels it', () => {
        const g = cachedTickGame(gameData);
        const p = g.playerEmpire;
        let fleet = (p.shipGroups as (ShipGroup | null)[]).find((s) => s != null && s.ships.length > 0) ?? null;
        if (fleet === null) {
            const mil = p.builtObjects.filter((b) => b != null && b.role === BuiltObjectRole.Military).slice(0, 2);
            expect(mil.length).toBeGreaterThan(0);
            runPlayerCommand(g.galaxy, p, 'setShipsFleet', [mil, 'new']);
            fleet = (p.shipGroups as (ShipGroup | null)[]).find((s) => s != null && s.ships.length > 0)!;
        }
        const other = g.galaxy.empires.find((e) => e !== p && e !== g.galaxy.independentEmpire && e.colonies.length > 0 && e.pirateEmpireBaseHabitat === null)!;
        const target: Habitat = other.colonies[0];
        expect(resolveAssignedFleet(p, target)).toBeNull();
        expect(runPlayerCommand(g.galaxy, p, 'enemyTargetAttack', [target, fleet])).toBe(fleet);
        expect(fleet.mission?.type).toBe(BuiltObjectMissionType.Attack);
        expect(fleet.mission?.target).toBe(target);
        expect(resolveAssignedFleet(p, target)).toEqual({ fleet, missionQueueIndex: 0 });
        // A second click on an assigned target sends nothing (the UI selects the fleet instead).
        expect(runPlayerCommand(g.galaxy, p, 'enemyTargetAttack', [target, fleet])).toBeNull();
        const row = itemRowModel({ galaxy: g.galaxy, player: p, sizeFactor: 1, resource: () => null }, 'enemyTargets', new EnemyTargetItem(target));
        expect(row.textAlpha).toBe(72);
        expect(row.centre?.large).toContain(fleet.name ?? '');
        expect(enemyTargetDescription(g.galaxy, p, target)).toMatch(/firepower/);
        expect(runPlayerCommand(g.galaxy, p, 'enemyTargetCancel', [target])).toBe(true);
        expect(resolveAssignedFleet(p, target)).toBeNull();
    }, 300000);

    it('the panel sits after Exploration Ships (method_163 AddPanel order)', () => {
        const ids = itemPanelDefs(false).map((d) => d.id);
        expect(ids.indexOf('enemyTargets')).toBe(ids.indexOf('explorationShips') + 1);
    });
});

describe('Ruin Detail (GenerateRuinAbilitiesSummary, method_550)', () => {
    it('formats .NET "#%" / "+#%"', () => {
        expect(formatNetPercentHash(0.15, true)).toBe('+15%');
        expect(formatNetPercentHash(0.145, false)).toBe('15%');
        expect(formatNetPercentHash(0, true)).toBe('+%');
        expect(formatNetPercentHash(0.25, false)).toBe('25%');
    });

    it('is unknown until investigated; then the development and empire-wide bonuses', () => {
        const g = cachedTickGame(gameData);
        const ruin = new Ruin('Old Place', 1, 0.2, 0, 0, 0, 0, 0);
        ruin.bonusHappiness = 0.1;
        expect(generateRuinAbilitiesSummary(g.galaxy, ruin)).toBe('(Not Investigated - Details Unknown)');
        expect(ruinDetailDescription(g.galaxy, ruin)).toBe('');
        ruin.playerEmpireEncountered = true;
        ruin.description = 'Ancient';
        const text = generateRuinAbilitiesSummary(g.galaxy, ruin);
        expect(text).toBe('+20% Development bonus for colony\n\nEmpire-wide Happiness bonus of +10%');
        expect(ruinDetailDescription(g.galaxy, ruin)).toBe('Ancient');
        const def = new Ruin('Fort', 1, 0.1, 0, 0, 0, 0, 0);
        def.playerEmpireEncountered = true;
        def.bonusDefensive = 0.3;
        def.bonusWealth = 0.05;
        // The defensive text loses its trailing "\n\n"; the next bonus follows it directly.
        expect(generateRuinAbilitiesSummary(g.galaxy, def)).toMatch(/combat bonus\.Empire-wide Colony Income bonus of \+5%$/);
        const unlock = new Ruin('Lab', 1, 0.1, 0, 0, 5, 0, 0);
        unlock.type = RuinType.UnlockResearchProject;
        unlock.playerEmpireEncountered = true;
        expect(generateRuinAbilitiesSummary(g.galaxy, unlock)).toMatch(/^\+10% Development bonus for colony/);
    }, 300000);
});

describe('Resource Components (ResolveComponentsThatUseResource, method_552)', () => {
    it('lists every component needing the resource (but 106), in definition order', () => {
        const g = cachedTickGame(gameData);
        const res = g.galaxy.resourceSystem.resources.find((r) => !isLuxuryResource(g.galaxy, r.resourceId) && resolveComponentsThatUseResource(componentDefinitionsStatic(g.galaxy), r.resourceId).length > 0)!;
        expect(res).toBeTruthy();
        const comps = resolveComponentsThatUseResource(componentDefinitionsStatic(g.galaxy), res.resourceId);
        for (const c of comps) {
            expect(c.componentId).not.toBe(106);
            expect(c.resourceRequirements.some((q) => q.resourceId === res.resourceId)).toBe(true);
        }
        const all = componentDefinitionsStatic(g.galaxy);
        const idx = comps.map((c) => all.indexOf(c));
        expect([...idx].sort((a, b) => a - b)).toEqual(idx);
        const rows = resourceComponentRows(g.galaxy, res.resourceId);
        expect(rows.map((r) => r.name)).toEqual(comps.map((c) => c.name));
        expect(rows[0].category).toMatch(/^[A-Z]{3}$/);
        expect(TECH_CELL_TEXT).toBe('1K');
    }, 300000);
});

describe('shared data tabs (BuiltObjectComponentListView, WeaponListView, method_178)', () => {
    it('component rows, weapon rows without assault pods, the damage polygon and the tab captions', () => {
        const g = cachedTickGame(gameData);
        const p = g.playerEmpire;
        const ship = p.builtObjects.find((b) => b != null && b.weapons.length > 0)!;
        expect(ship).toBeTruthy();
        const rows = componentRows(ship);
        expect(rows.length).toBe(ship.components.items.length);
        expect(rows[0].name).toBe(ship.components.items[0].def.name);
        const w = weaponRows(ship.weapons);
        expect(w.length).toBe(ship.weapons.filter((x) => x.component.def.type !== ComponentType.AssaultPod).length);
        const pts = damageGraphPoints({ damageLoss: 10, range: 500, rawDamage: 20 });
        // num3 = 45 / 2 / 50 = 0.45; num6 = 20 × 0.45 / 2 = 4.5; min damage 20 - 50 = -30 → num7 = -6.75; x = 500 × 270 / 990.
        expect(pts).toEqual([
            { x: 0, y: 17 },
            { x: 0, y: 26 },
            { x: 136, y: 15 },
            { x: 136, y: 28 },
        ]);
        const labels = builtObjectTabLabels(ship);
        expect(labels.weapons).toBe(`Weapons (${ship.weapons.length})`);
        expect(builtObjectTabLabels(null).troops).toBe('Troops');
        expect(TAB_ORDER.slice(0, 6)).toEqual(['cargo', 'components', 'yards', 'docking', 'troops', 'weapons']);
    }, 300000);
});
