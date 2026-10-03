// Parity batch C4: the pirate player's UI — a Custom Pirate new game (Start.cs nVkoJxpyvO → CreateGameFromSettings) and
// its panels: the left sidebar's Pirate Missions panel (Main.Part11.cs method_163, BaconMain.cs PopulateListsOnLefthandSide,
// ItemListPanel.cs method_7, Main.Part12.cs 2591-2678), the controlled-colony rows (ItemListPanel.cs 728-848), the
// smuggling resource picker's Assign Mission (Main.Part8.cs 5094) and the construction purchaser binding at pirate bases /
// controlled colonies (Main.Part11.cs method_169). Plus the Introductory Game preset (Start.cs 5374).
import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, type Game } from '../src/sim/game';
import { defaultStartGameOptions, toCreateGameOptions, introductoryVictoryConditions, type StartGameOptions } from '../src/sim/startGameOptions';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Empire } from '../src/sim/empire';
import type { Habitat } from '../src/sim/types';
import { GalaxyShape } from '../src/sim/types';
import { SystemVisibilityStatus } from '../src/sim/visibility';
import { runPlayerCommand } from '../src/sim/player/playerCommands';
import { EmpireActivityType } from '../src/sim/pirates/empireActivity';
import { pirateMissionsPanelData, pirateMissionButtonKind } from '../src/sim/pirates/pirateMissionsPanel';
import { PirateColonyControl } from '../src/sim/pirates/pirateColonyControl';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { itemPanelDefs, itemRowModel, panelItems, type RowContext, type RowSeg } from '../src/ui/leftSidebar';
import { purchaserBinding, purchaserDesigns, purchaserChecks } from '../src/ui/screens/constructionYards';
import { smugglingResourceChoices, formatHashDot0 } from '../src/ui/pirateSmugglingPicker';

let gameData: GameData;
let game: Game;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    const o: StartGameOptions = { ...defaultStartGameOptions(), seed: 11, raceName: 'Human', empireType: 'CustomPirate', starCountIndex: 1, dimensionIndex: 1, otherEmpires: { autogenerate: true, empireCount: 4, manual: [] } };
    game = createGame(toCreateGameOptions(o, gameData, Array.from({ length: 1500 }, (_, i) => `N${i}`)));
}, 180000);

function ctx(player: Empire, considering?: ReadonlyMap<never, number>): RowContext {
    return {
        galaxy: game.galaxy,
        player,
        sizeFactor: 1,
        resource: (id) => {
            const r = gameData.resources.find((x) => x.resourceId === id);
            return r ? { name: r.name, pictureRef: r.pictureRef } : null;
        },
        pirateMissionsConsidering: considering,
    };
}

function texts(segs: RowSeg[]): string[] {
    return segs.filter((s): s is Extract<RowSeg, { kind: 'text' }> => s.kind === 'text').map((s) => s.text);
}

/** An AI colony the pirate player knows (its system explored). */
function knownAiColony(player: Empire): { ai: Empire; colony: Habitat } {
    const g = game.galaxy;
    const ai = g.empires.find((e) => e !== player && e.colonies.length > 0)!;
    const colony = ai.colonies[0];
    player.visibility.systemVisibility[colony.systemIndex].status = SystemVisibilityStatus.Explored;
    return { ai, colony };
}

describe('pirate player new game', () => {
    it('starts as a pirate faction with a base and the pirate panel set', () => {
        const p = game.playerEmpire;
        expect(p.pirateEmpireBaseHabitat).not.toBeNull();
        const ids = itemPanelDefs(true).map((d) => d.id);
        expect(ids).toContain('pirateMissions');
        expect(ids).not.toContain('potentialColonies');
        // Original order: ... Military Ships, (Potential Colonies), Pirate Missions, Potential Mining Locations ...
        expect(ids.indexOf('pirateMissions')).toBe(ids.indexOf('militaryShips') + 1);
        expect(itemPanelDefs(false).map((d) => d.id)).toContain('pirateMissions');
        const def = itemPanelDefs(true).find((d) => d.id === 'pirateMissions')!;
        expect(def.itemHeightFactor).toBe(3.3175);
        expect(def.toggles.map((t) => t.length)).toEqual([3, 4]);
    });

    it('Pirate Missions: an AI smuggling request is listed, accepted with the row button, then shows the faction as accepted', () => {
        const g = game.galaxy;
        const p = game.playerEmpire;
        const { ai, colony } = knownAiColony(p);
        // The standard empire's picker (Main.Part8.cs 5094): all resources (no order, price 1.0).
        expect(runPlayerCommand(g, ai, 'assignPirateSmugglingMission', [colony, null])).toBe(true);
        expect(runPlayerCommand(g, ai, 'assignPirateSmugglingMission', [colony, null])).toBe(false); // equivalent already there
        const mission = ai.pirateMissions.items.find((a) => a!.target === colony)!;
        expect([mission.type, mission.resourceId, mission.price, mission.relatedOrder]).toEqual([EmpireActivityType.Smuggle, 255, 1.0, null]);
        expect(g.pirateMissions.contains(mission)).toBe(true);

        const data = pirateMissionsPanelData(g, p, 0, 0);
        expect(data.items).toContain(mission);
        expect(data.considering).toHaveLength(data.items.length);
        // Type filter: Attack only → not listed; Smuggling → listed.
        expect(pirateMissionsPanelData(g, p, 0, 2).items).not.toContain(mission);
        expect(panelItems('pirateMissions', g, p, { toggles: [0, 1], pirateMissions: pirateMissionsPanelData(g, p, 0, 1) })).toContain(mission);
        expect(panelItems('pirateMissions', g, p, { toggles: [0, 0] })).toEqual([]);

        expect(pirateMissionButtonKind(g, p, mission)).toBe('bid');
        let row = itemRowModel(ctx(p), 'pirateMissions', mission);
        expect(row.button?.text).toBe('Accept Mission');
        const free = texts((row.free ?? []).map((f) => f.seg));
        expect(free).toContain(colony.name);
        expect(free).toContain(`Smuggle resources for ${ai.name}`);
        expect(free).toContain('0 pirate factions accepted');

        expect(runPlayerCommand(g, p, 'pirateMissionButton', [colony, EmpireActivityType.Smuggle, ai, colony.empire])).toBe(true);
        expect(p.pirateMissions.containsEquivalent(mission)).toBe(true);
        expect(pirateMissionButtonKind(g, p, mission)).toBe('none');
        row = itemRowModel(ctx(p), 'pirateMissions', mission);
        expect(row.button).toBeUndefined();
        expect(texts((row.free ?? []).map((f) => f.seg))).toContain('You and 0 other pirate factions accepted');
        // Accepted list (status 1) holds it now.
        expect(pirateMissionsPanelData(g, p, 1, 0).items).toContain(mission);

        // The requester cancels it (its own request: the Cancel button) — off every list.
        expect(pirateMissionButtonKind(g, ai, mission)).toBe('cancel');
        expect(runPlayerCommand(g, ai, 'pirateMissionButton', [colony, EmpireActivityType.Smuggle, ai, colony.empire])).toBe(true);
        expect(ai.pirateMissions.containsEquivalent(mission)).toBe(false);
        expect(p.pirateMissions.containsEquivalent(mission)).toBe(false);
        expect(g.pirateMissions.contains(mission)).toBe(false);
    });

    it('Pirate Missions: bidding on a defend request starts the 60 s auction, a second bid cuts the price', () => {
        const g = game.galaxy;
        const p = game.playerEmpire;
        const { ai, colony } = knownAiColony(p);
        // The AI's own defend request (ShipActionType.GeneratePirateMissionDefend shape).
        runPlayerCommand(g, ai, 'assignPirateSmugglingMission', [colony, null]); // a second request kind on the same target
        const smuggle = ai.pirateMissions.items.find((a) => a!.target === colony && a!.type === EmpireActivityType.Smuggle)!;
        smuggle.type = EmpireActivityType.Defend;
        smuggle.price = 1000;
        expect(runPlayerCommand(g, p, 'pirateMissionButton', [colony, EmpireActivityType.Defend, ai, colony.empire])).toBe(true);
        expect([smuggle.assignedEmpire, smuggle.bidTimeRemaining, smuggle.price]).toEqual([p, 60000, 1000]);
        expect(pirateMissionButtonKind(g, p, smuggle)).toBe('alreadyBid');
        runPlayerCommand(g, p, 'pirateMissionButton', [colony, EmpireActivityType.Defend, ai, colony.empire]);
        expect(smuggle.price).toBeCloseTo(900, 6);
        const row = itemRowModel(ctx(p), 'pirateMissions', smuggle);
        expect(row.button?.text).toBe('(Already Bid)');
        expect(row.button?.sub).toBe('(60 seconds)');
        // Clean up.
        runPlayerCommand(g, ai, 'pirateMissionButton', [colony, EmpireActivityType.Defend, ai, colony.empire]);
        expect(g.pirateMissions.contains(smuggle)).toBe(false);
    });

    it('a controlled colony (not owned) gets the pirate row with the control level; the purchaser binds the pirate there', () => {
        const g = game.galaxy;
        const p = game.playerEmpire;
        const { colony } = knownAiColony(p);
        colony.pirateColonyControl.add(new PirateColonyControl(p.empireId, 0.4, false));
        if (!p.colonies.includes(colony)) p.colonies.push(colony);
        const row = itemRowModel(ctx(p), 'colonies', colony);
        expect(texts(row.line2)).toContain('Control: 40%');
        expect(row.line1[0]).toMatchObject({ kind: 'text', text: colony.name, color: colony.empire!.mainColor });
        // Colonies window (method_169 bool_28 false): controlled → bound to the pirate player.
        const ctlBind = purchaserBinding(p, { kind: 'colony', habitat: colony }, false);
        expect(ctlBind?.empire).toBe(p);
        expect(ctlBind?.stateConstructionOnly).toBe(true);
        // Ships and Bases window (bool_28 true): not the player's habitat → not bound.
        expect(purchaserBinding(p, { kind: 'colony', habitat: colony }, true)).toBeNull();
    });

    it('pirate bases allow private construction (allowPrivateConstruction)', () => {
        const p = game.playerEmpire;
        const base = [...p.builtObjects, ...p.privateBuiltObjects].find((b) => b.role === BuiltObjectRole.Base && b.isShipYard)!;
        expect(base).toBeDefined();
        const site = { kind: 'builtObject' as const, builtObject: base };
        const b = purchaserBinding(p, site, true)!;
        expect(b.empire).toBe(p);
        expect(b.stateConstructionOnly).toBe(false);
        const privateRoles = [BuiltObjectSubRole.SmallFreighter, BuiltObjectSubRole.MediumFreighter, BuiltObjectSubRole.LargeFreighter, BuiltObjectSubRole.MiningShip, BuiltObjectSubRole.GasMiningShip, BuiltObjectSubRole.PassengerShip];
        const withPrivate = purchaserDesigns(p.designs, site, purchaserChecks(p), b.stateConstructionOnly);
        const stateOnly = purchaserDesigns(p.designs, site, purchaserChecks(p), true);
        expect(stateOnly.some((d) => privateRoles.includes(d.subRole))).toBe(false);
        expect(withPrivate.length).toBeGreaterThanOrEqual(stateOnly.length);
        // A standard empire's base: state only.
        const ai = game.galaxy.empires.find((e) => e !== p && e.spacePorts.length > 0);
        if (ai) expect(purchaserBinding(ai, { kind: 'builtObject', builtObject: ai.spacePorts[0] }, true)?.stateConstructionOnly).toBe(true);
    });

    it('smuggling picker: "All Resources" first, then the resources by name; the price per 100 units', () => {
        const c = smugglingResourceChoices([{ resourceId: 3, name: 'Zirconium' }, { resourceId: 1, name: 'Aculon' }]);
        expect(c.map((x) => x.resourceId)).toEqual([null, 1, 3]);
        expect(formatHashDot0(100)).toBe('100.0');
        expect(formatHashDot0(0.5)).toBe('.5');
    });
});

describe('Introductory Game (Start.cs 5374 btnStartNewGameIntroductory_Click)', () => {
    it('the preset: Elliptical, 700 stars, 15-19 intelligent-race AIs, difficulty 0.7, the stories on', () => {
        const o: StartGameOptions = { ...defaultStartGameOptions(), seed: 3, empireType: 'Introductory' };
        const c = toCreateGameOptions(o, gameData, []);
        expect([c.shape, c.starCount, c.maximumEmpireAmount, c.sectorWidth, c.sectorHeight]).toEqual([GalaxyShape.Elliptical, 700, 20, 10, 10]);
        expect([c.colonyPrevalence, c.lifePrevalence, c.creaturePrevalence, c.piratePrevalence, c.pirateProximity, c.aggressionLevel, c.difficultyLevel, c.baseTechCost]).toEqual([1.0, 700, 0.3, 0.2, 1, 1.1, 0.7, 120000]);
        expect(c.aiEmpires.length).toBeGreaterThanOrEqual(15);
        expect(c.aiEmpires.length).toBeLessThan(20);
        const races = [c.player.race, ...c.aiEmpires.map((e) => e.race)];
        expect(new Set(races).size).toBe(races.length);
        for (const r of races) expect(gameData.races.find((x) => x.name === r)!.intelligence).toBeGreaterThanOrEqual(70);
        expect(c.player.homeSystemFavourability).toBe('Agreeable');
        expect(c.storyDistantWorldsEnabled).toBe(true);
        expect(c.victoryConditions!.enableStoryEvents).toBe(true);
        expect(c.victoryConditions!.economyPercent).toBe(25);
        expect(introductoryVictoryConditions(3).economyPercent).toBe(66);
        expect(introductoryVictoryConditions(100).economyPercent).toBe(15);
    });
});
