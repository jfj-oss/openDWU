// The original's selection circle and list-hover highlights (parity: fighters batch):
// - render/selectionCircle.ts: MainView.2.cs 3132 method_212 / 3140 method_213 (colour, width, boxes);
// - render/mapHighlights.ts: EventLocations pings (Main.Part9.cs 759 / 795, MainView.2.cs 3500 method_232) and
//   SpecialHighlightBuiltObjects (Main.Part9.cs 870 method_246);
// - ui/listHover.ts: ItemListPanel.cs 2291-2389 (the hovered row's ping and red travel vectors);
// - MainView.placePostureLayer: the Fleet Postures discs over the ship art, under the galaxy-pass symbols
//   (MainView.cs 1535-1550, MainView.2.cs 5221 / 5830-6020).
import { describe, expect, it } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import {
    SELECTION_CIRCLE_WIDTH_PX,
    SELECTION_COLOR_FROM,
    SELECTION_COLOR_TO,
    applySelectionTint,
    buildSelectionCircles,
    creatureSelectionBox,
    habitatSelectionBox,
    sameBoxes,
    selectionCircleArgb,
    shipSelectionBox,
    symbolSelectionBox,
    systemSelectionBox,
} from '../src/render/selectionCircle';
import { EVENT_PING_MAX_RADIUS_PX, EventPingClock, MapHighlights, mapHighlightsOf } from '../src/render/mapHighlights';
import { itemListHoverChanged, listItemPingObject } from '../src/ui/listHover';
import { EnemyTargetItem } from '../src/ui/leftSidebar';
import { BuiltObject } from '../src/sim/builtObject';
import { Habitat } from '../src/sim/types';
import { ShipGroup } from '../src/sim/fleets/shipGroup';
import { GalaxyLocation, GalaxyLocationType } from '../src/sim/galaxyLocation';
import { EmpireActivity, EmpireActivityType } from '../src/sim/pirates/empireActivity';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectMissionType } from '../src/sim/missions/mission';
import { MainView } from '../src/render/mainView';

const utc = (s: number, ms: number): Date => new Date(Date.UTC(2026, 0, 1, 0, 0, s, ms));

describe('method_213: the selection colour', () => {
    it('color_8 at an even second, color_7 at the odd second, in between halfway', () => {
        expect(selectionCircleArgb(utc(10, 0))).toBe(SELECTION_COLOR_TO);
        expect(selectionCircleArgb(utc(11, 0))).toBe(SELECTION_COLOR_FROM);
        expect(selectionCircleArgb(utc(12, 0))).toBe(SELECTION_COLOR_TO);
        // :10.500 → num = 0.5: A = 128 - (byte)((128 - 224) * 0.5) = 128 - (byte)(-48) = 128 - 208 → 176 (byte wrap).
        const half = selectionCircleArgb(utc(10, 500));
        expect((half >>> 24) & 0xff).toBe((128 - ((-48 + 256) & 0xff) + 256) & 0xff);
        expect((half >>> 16) & 0xff).toBe((112 - ((-71 + 256) & 0xff) + 256) & 0xff);
    });
    it('the Graphics carries it as tint + alpha over a white 5 px stroke', () => {
        const g = new Graphics();
        buildSelectionCircles(g, [10, 20, 30]);
        applySelectionTint(g, utc(11, 0));
        expect(g.tint).toBe(SELECTION_COLOR_FROM & 0xffffff);
        expect(g.alpha).toBeCloseTo(0x80 / 255, 6);
        expect(SELECTION_CIRCLE_WIDTH_PX).toBe(5);
        expect(g.bounds.width).toBeGreaterThan(30); // radius 15 + half the stroke on each side
    });
    it('boxes: ship / fighter x1.3, creature x1.5, habitat +20, symbol x1.6, system +7 (all truncated)', () => {
        expect(shipSelectionBox(31)).toBe(40);
        expect(creatureSelectionBox(31)).toBe(46);
        expect(habitatSelectionBox(31)).toBe(51);
        expect(symbolSelectionBox(11)).toBe(17);
        expect(systemSelectionBox(31)).toBe(38);
        expect(sameBoxes([1, 2, 3], [1, 2, 3])).toBe(true);
        expect(sameBoxes([1, 2, 3], [1, 2, 4])).toBe(false);
    });
});

function ship(x: number, y: number, extra: Record<string, unknown> = {}): BuiltObject {
    const b = Object.create(BuiltObject.prototype) as BuiltObject;
    Object.assign(b, { xpos: x, ypos: y, hasBeenDestroyed: false, mission: null, role: BuiltObjectRole.Military, builtAt: null, ...extra });
    return b;
}
function habitat(x: number, y: number): Habitat {
    const h = Object.create(Habitat.prototype) as Habitat;
    Object.assign(h, { xpos: x, ypos: y, hasBeenDestroyed: false });
    return h;
}

describe('EventLocations (method_243 / method_245)', () => {
    it('pings a ship, a habitat or a point; removes by object, or by the point\'s coordinates', () => {
        const h = new MapHighlights();
        const s = ship(10, 20);
        const hab = habitat(5, 5);
        h.addEventPing(s);
        h.addEventPing(hab);
        h.addEventPing({ x: 7, y: 9 });
        h.addEventPing('a race'); // anything else adds none
        expect(h.eventLocations.length).toBe(3);
        expect(h.eventLocations[2]).toMatchObject({ x: 7, y: 9 });
        expect(h.eventLocations[0].x).toBeNull(); // placed where drawn, at the first frame
        h.removeEventPings({ x: 7, y: 9 });
        h.removeEventPings(s);
        expect(h.eventLocations.map((p) => p.obj)).toEqual([hab]);
    });
    it('method_232: 1.6 s cycle, radius 1 → 101 px, alpha 255 for the first half then fading to 5', () => {
        const c = new EventPingClock();
        // The first frame after DateTime.MinValue wraps the phase to -1.6: num5 = 1 + (int)(-100) = -99.
        expect(c.advance(100)).toEqual({ radius: -99, alpha: 255 });
        c.phase = 0;
        c.last = 0;
        expect(c.advance(0.8)).toEqual({ radius: 1 + EVENT_PING_MAX_RADIUS_PX / 2, alpha: 255 });
        c.endFrame(0.8);
        const late = c.advance(1.2);
        expect(late.radius).toBe(1 + Math.trunc((c.phase / 1.6) * 100));
        expect(late.alpha).toBe(255 - Math.trunc(((c.phase - 0.8) / 0.8) * 250));
        expect(late.alpha).toBeLessThan(255);
        // Past the period: wrap by one period; past two: back to -1.6.
        c.phase = 1.5;
        c.last = 0;
        expect(c.advance(0.2).radius).toBe(7);
        c.phase = 3.0;
        c.last = 0;
        expect(c.advance(0.5).radius).toBe(-99);
        // Two pings on one frame both add the frame's time (N pings cycle N times as fast, as in the C#).
        c.phase = 0;
        c.last = 0;
        c.advance(0.4);
        expect(c.phase).toBeCloseTo(0.4, 9);
        c.advance(0.4);
        expect(c.phase).toBeCloseTo(0.8, 9);
    });
});

describe('ItemListPanel.cs 2291-2389: the hovered row', () => {
    const galaxy = {} as never;
    function player(builtObjects: BuiltObject[] = []) {
        return { builtObjects, privateBuiltObjects: [] } as never;
    }
    it('ping objects: a fleet → its lead ship, a location → its (int) point, a pirate mission → its target, a target fleet → its lead', () => {
        const lead = ship(1, 2);
        const g = Object.create(ShipGroup.prototype) as ShipGroup;
        Object.assign(g, { leadShip: lead });
        expect(listItemPingObject(g)).toBe(lead);
        const loc = new GalaxyLocation('Nebula', GalaxyLocationType.NebulaCloud, 100.7, 200.2, 10, 10, 0);
        expect(listItemPingObject(loc)).toEqual({ x: 100, y: 200 });
        const tgt = habitat(3, 4);
        const act = new EmpireActivity(null, null, 0, EmpireActivityType.Attack, tgt, 100);
        expect(listItemPingObject(act)).toBe(tgt);
        expect(listItemPingObject(new EnemyTargetItem(g))).toBe(lead);
        expect(listItemPingObject(new EnemyTargetItem(tgt))).toBe(tgt);
    });
    it('hover in: a ping at the row\'s object; out: removed, and the red set falls back to the selection\'s travellers', () => {
        const g = {} as never;
        const target = habitat(50, 50);
        const flying = ship(0, 0, { mission: { type: BuiltObjectMissionType.Move, target, secondaryTarget: null } });
        const p = player([flying]);
        const row = ship(9, 9);
        itemListHoverChanged(g, p, null, row, null);
        const h = mapHighlightsOf(g);
        expect(h.eventLocations.map((e) => e.obj)).toEqual([row]);
        expect(h.specialHighlight.size).toBe(0);
        // Out, with the habitat selected: DetermineShipsMovingToDestination(selection).
        itemListHoverChanged(g, p, row, null, { habitat: target });
        expect(h.eventLocations.length).toBe(0);
        expect([...h.specialHighlight]).toEqual([flying]);
        // Same item again: nothing happens.
        itemListHoverChanged(g, p, null, null, null);
        expect([...h.specialHighlight]).toEqual([flying]);
    });
    it('a pirate mission row highlights the ships flying it (DetermineShipsAssignedToMission)', () => {
        const g = { calculateDistanceSquared: () => 1e12 } as never;
        const target = ship(70, 70, { role: BuiltObjectRole.Base });
        const attacker = ship(0, 0, { mission: { type: BuiltObjectMissionType.Attack, target, secondaryTarget: null } });
        const idle = ship(0, 0);
        const act = new EmpireActivity(null, null, 0, EmpireActivityType.Attack, target, 100);
        itemListHoverChanged(g, player([attacker, idle]), null, act, null);
        expect([...mapHighlightsOf(g).specialHighlight]).toEqual([attacker]);
        expect(mapHighlightsOf(g).eventLocations.map((e) => e.obj)).toEqual([target]);
    });
    void galaxy;
});

describe('MainView.placePostureLayer: the posture discs over the ships, under the galaxy-pass symbols', () => {
    function fakeView() {
        const world = new Container();
        const back = new Container();
        const overlay = new Container();
        const front = new Container();
        const ambientUnder = new Container();
        const ships = new Container();
        const creatures = new Container();
        const posture = new Container();
        const overlayRoot = new Container();
        world.addChild(back, overlay, front, ambientUnder, ships, creatures);
        const view = {
            world,
            overlayLayer: { postureRoot: posture, root: overlayRoot },
            galaxyMarkers: { front },
            builtObjectLayer: { root: ships },
            markersFrontNext: ambientUnder,
        };
        world.addChild(posture, overlayRoot);
        return { view, world, front, posture, ships, ambientUnder, overlayRoot };
    }
    const place = (view: unknown, f: number): void => (MainView.prototype as unknown as { placePostureLayer(this: unknown, f: number): void }).placePostureLayer.call(view, f);
    it('close zoom: the discs then the travel-vector / overlay root last (over ships and creatures), the markers under the ship art; f > 150: markers above the discs, the root above them', () => {
        const { view, world, front, posture, ambientUnder, overlayRoot } = fakeView();
        place(view, 10);
        expect(world.children.at(-1)).toBe(overlayRoot);
        expect(world.children.at(-2)).toBe(posture);
        expect(world.getChildIndex(front)).toBe(world.getChildIndex(ambientUnder) - 1);
        place(view, 400);
        expect(world.children.at(-1)).toBe(overlayRoot);
        expect(world.children.at(-2)).toBe(front);
        expect(world.children.at(-3)).toBe(posture);
        place(view, 10);
        expect(world.children.at(-1)).toBe(overlayRoot);
        expect(world.children.at(-2)).toBe(posture);
        expect(world.getChildIndex(front)).toBe(world.getChildIndex(ambientUnder) - 1);
        // A layer added later (the effects layer) goes under the discs at the next frame.
        const late = new Container();
        world.addChild(late);
        place(view, 10);
        expect(world.children.at(-1)).toBe(overlayRoot);
        expect(world.children.at(-2)).toBe(posture);
        expect(world.children.at(-3)).toBe(late);
    });
});
