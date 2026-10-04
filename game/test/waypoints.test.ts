// Waypoints & Known Locations (an Improvement; sim/player/waypoints.ts, sim/player/knownLocations.ts,
// render/locationMarkers.ts, ui/waypoints.ts): the journaled add / rename / delete ops and their replay, the save side
// table (absent when empty, no digest or Rnd effect), the known-location listing, the original's hint pulse, the keys,
// and worker parity (the commands issued on the replica reach the worker and come back to the replica at once).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import { expectSameGame, inThread, inWorker } from './helpers/simWorkerSides';
import type { GameData } from '../src/sim/data/gameData';
import { galaxyFromJSON, galaxyToJSON } from '../src/sim/save/galaxySave';
import { commandLog } from '../src/sim/player/commandLog';
import { issuePlayerCommand, runScheduledUntil, scheduleCommandLog } from '../src/sim/player/playerCommands';
import { stateDigest } from '../src/sim/tick/digest';
import {
    WAYPOINT_NAME_MAX,
    addWaypoint,
    defaultWaypointName,
    deleteWaypoint,
    dismissMarker,
    renameWaypoint,
    sanitizeWaypointName,
    waypointState,
    waypoints,
} from '../src/sim/player/waypoints';
import { MARKED_LOCATION_TYPES, hintPlaceName, knownLocationTooltip, knownLocations } from '../src/sim/player/knownLocations';
import { GalaxyLocationType } from '../src/sim/galaxyLocation';
import { HabitatCategoryType } from '../src/sim/types';
import { addLocationHint } from '../src/sim/tradeItems';
import { HintPulseClock, HINT_PULSE_PERIOD_S, labelAllowed, mapMarkers, markerTooltip } from '../src/render/locationMarkers';
import { commandFailureValue } from '../src/simworker/commandFailure';
import { KEY_BINDINGS, dispatchKey, findBinding, setWaypointKeyHandler, type WaypointKeyAction } from '../src/ui/keyboard';
import { bindingId, findConflicts } from '../src/ui/keyBindingModel';
import { OVERLAY_ROWS, createMapOverlayState, overlayActive } from '../src/ui/mapOverlays';
import { improvementById } from '../src/ui/improvements';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 1_800_000);

const summary = (list: readonly { id: number; x: number; y: number; name: string; empireId: number }[]) => list.map((w) => ({ id: w.id, x: w.x, y: w.y, name: w.name, empireId: w.empireId }));

describe('waypoints: the model', () => {
    it('names are one line, trimmed, cut at WAYPOINT_NAME_MAX; empty gets "Waypoint N"', () => {
        expect(sanitizeWaypointName('  Home \n base\t ')).toBe('Home base');
        expect(sanitizeWaypointName('x'.repeat(100))).toHaveLength(WAYPOINT_NAME_MAX);
        expect(sanitizeWaypointName(42)).toBe('');
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        expect(waypointState(g)).toBeUndefined();
        expect(defaultWaypointName(g)).toBe('Waypoint 1');
        expect(addWaypoint(g, p, 100.7, 200.2, '   ')).toBe(1);
        expect(waypoints(g, p)[0]).toMatchObject({ id: 1, x: 100, y: 200, name: 'Waypoint 1', empireId: p.empireId });
        // Clamped into the galaxy; refused when not finite.
        expect(addWaypoint(g, p, -50, g.sizeY + 999, 'Edge')).toBe(2);
        expect(waypoints(g, p)[1]).toMatchObject({ x: 0, y: g.sizeY });
        expect(addWaypoint(g, p, Number.NaN, 0, 'x')).toBe(0);
        // Another empire cannot rename / delete the player's pins.
        const other = g.empires.find((e) => e !== null && e !== p && e !== g.independentEmpire)!;
        expect(renameWaypoint(g, other, 1, 'Mine')).toBe(false);
        expect(deleteWaypoint(g, other, 1)).toBe(false);
        expect(renameWaypoint(g, p, 1, '  ')).toBe(false);
        expect(renameWaypoint(g, p, 1, 'Rally point')).toBe(true);
        expect(waypoints(g, p)[0].name).toBe('Rally point');
        expect(deleteWaypoint(g, p, 99)).toBe(false);
        expect(deleteWaypoint(g, p, 1)).toBe(true);
        expect(deleteWaypoint(g, p, 2)).toBe(true);
        // Deleting the last one restarts the ids (an unsaved empty table and a reloaded game agree).
        expect(addWaypoint(g, p, 5, 5, 'Again')).toBe(1);
        expect(waypoints(g, other)).toEqual([]);
        expect(commandFailureValue('addWaypoint', 'x', [0, 0, ''])).toBe(0);
        expect(commandFailureValue('renameWaypoint', 'x', [1, 'a'])).toBe(false);
        expect(commandFailureValue('deleteWaypoint', 'x', [1])).toBe(false);
    }, 600000);
});

describe('waypoints: saved with the game, outside the sim', () => {
    it('no side table without waypoints (also after the last one is deleted); the table round-trips; digest and Rnd untouched', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        const before = JSON.stringify(galaxyToJSON(g));
        expect(before).not.toContain('"waypoints"');
        const digest = stateDigest(g);
        const draws = g.rnd.drawCount;
        addWaypoint(g, p, 1234, 5678, 'Nebula edge');
        addWaypoint(g, p, 4321, 8765, 'Ambush');
        renameWaypoint(g, p, 2, 'Ambush point');
        expect(stateDigest(g)).toBe(digest);
        expect(g.rnd.drawCount).toBe(draws);
        const text = JSON.stringify(galaxyToJSON(g));
        expect(text).toContain('Nebula edge');
        const loaded = galaxyFromJSON(JSON.parse(text), gameData);
        expect(summary(waypoints(loaded))).toEqual(summary(waypoints(g)));
        expect(waypointState(loaded)!.nextId).toBe(3);
        expect(stateDigest(loaded)).toBe(stateDigest(g));
        // The loaded game keeps issuing the same ids.
        expect(addWaypoint(loaded, loaded.playerEmpire!, 1, 1, 'c')).toBe(addWaypoint(g, p, 1, 1, 'c'));
        for (const w of [...waypoints(g)]) deleteWaypoint(g, p, w.id);
        expect(JSON.stringify(galaxyToJSON(g))).toBe(before);
        // A save without the table loads with no waypoints.
        expect(waypointState(galaxyFromJSON(JSON.parse(before), gameData))).toBeUndefined();
    }, 600000);
});

describe('waypoints: journaled player commands', () => {
    it('add, rename and delete are journaled and replay to the same waypoints', () => {
        const game = cachedTickGame(gameData);
        const side = inThread(game);
        const p = game.playerEmpire;
        const ids: number[] = [];
        side.tick();
        issuePlayerCommand(game.galaxy, p, 'addWaypoint', [1000, 2000, 'Alpha'], (id) => ids.push(id));
        issuePlayerCommand(game.galaxy, p, 'addWaypoint', [3000, 4000, 'Beta'], (id) => ids.push(id));
        // Not applied before the frame boundary.
        expect(waypoints(game.galaxy)).toEqual([]);
        side.tick();
        expect(ids).toEqual([1, 2]);
        issuePlayerCommand(game.galaxy, p, 'renameWaypoint', [1, 'Alpha Prime']);
        side.tick();
        issuePlayerCommand(game.galaxy, p, 'deleteWaypoint', [2]);
        issuePlayerCommand(game.galaxy, p, 'addWaypoint', [5000, 6000, 'Gamma']);
        side.tick();
        side.tick();
        const ops = commandLog(game.galaxy).filter((e) => e.source === 'player').map((e) => (e.source === 'player' ? [e.op, e.args] : null));
        expect(ops).toEqual([
            ['addWaypoint', [1000, 2000, 'Alpha']],
            ['addWaypoint', [3000, 4000, 'Beta']],
            ['renameWaypoint', [1, 'Alpha Prime']],
            ['deleteWaypoint', [2]],
            ['addWaypoint', [5000, 6000, 'Gamma']],
        ]);
        expect(summary(waypoints(game.galaxy)).map((w) => [w.id, w.name])).toEqual([
            [1, 'Alpha Prime'],
            [3, 'Gamma'],
        ]);
        const fresh = cachedTickGame(gameData);
        scheduleCommandLog(fresh.galaxy, commandLog(game.galaxy));
        runScheduledUntil(fresh.galaxy, game.galaxy.nowMs);
        expect(summary(waypoints(fresh.galaxy))).toEqual(summary(waypoints(game.galaxy)));
        expect(stateDigest(fresh.galaxy)).toBe(stateDigest(game.galaxy));
        side.dispose();
    }, 600000);
});

describe('waypoints: worker mode', () => {
    it('commands issued on the replica: same game as in-thread, and the replica shows the change without a full settle', () => {
        const a = inThread(cachedTickGame(gameData));
        const w = inWorker(cachedTickGame(gameData), gameData);
        const sides = [a, w];
        const results: Record<string, number[]> = { a: [], w: [] };
        for (const s of sides) s.tick();
        for (const s of sides) issuePlayerCommand(s.galaxy, s.player, 'addWaypoint', [7000, 8000, 'Outpost'], (id) => results[s.worker ? 'w' : 'a'].push(id));
        for (let i = 0; i < 3; i++) for (const s of sides) s.tick();
        expect(results).toEqual({ a: [1], w: [1] });
        // The replica reads the synced side table (no settle: the worker freshened it with the command's delta).
        expect(summary(waypoints(w.galaxy))).toEqual(summary(waypoints(a.galaxy)));
        expect(summary(waypoints(w.real))).toEqual(summary(waypoints(a.galaxy)));
        for (const s of sides) issuePlayerCommand(s.galaxy, s.player, 'renameWaypoint', [1, 'Forward base']);
        for (let i = 0; i < 3; i++) for (const s of sides) s.tick();
        expect(waypoints(w.galaxy)[0].name).toBe('Forward base');
        for (const s of sides) issuePlayerCommand(s.galaxy, s.player, 'deleteWaypoint', [1]);
        for (let i = 0; i < 3; i++) for (const s of sides) s.tick();
        expect(waypoints(w.galaxy)).toEqual([]);
        expect(waypoints(w.real)).toEqual([]);
        expectSameGame(a, w);
        expect(w.replicaWrites()).toEqual([]);
        a.dispose();
        w.dispose();
    }, 900000);
});

describe('known locations', () => {
    it('lists the hints and the point-like known locations, with names and where they came from', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        p.locationHints.length = 0;
        p.visibility.knownGalaxyLocations.length = 0;
        expect(knownLocations(g, p)).toEqual([]);
        // A habitat far from home as a hint (a pirate's "buy information" reply adds such a point).
        const home = p.capital?.systemIndex ?? -1;
        const far = g.habitats.find((h) => h !== null && h.category === HabitatCategoryType.Planet && h.systemIndex !== home && h.name !== '')!;
        addLocationHint(p, { x: Math.trunc(far.xpos), y: Math.trunc(far.ypos) });
        let list = knownLocations(g, p);
        expect(list).toHaveLength(1);
        expect(list[0]).toMatchObject({ kind: 'hint', typeLabel: 'Location hint', name: far.name, location: null });
        expect(hintPlaceName(g, far.xpos, far.ypos)).toBe(far.name);
        expect(knownLocationTooltip(g, p, list[0])).toMatch(/Location hint/);
        expect(knownLocationTooltip(g, p, list[0])).toMatch(/From: /);
        // A known point-like location (and a region, which the region labels name instead).
        const marked = g.galaxyLocations.find((l) => MARKED_LOCATION_TYPES.has(l.type));
        const region = g.galaxyLocations.find((l) => l.type === GalaxyLocationType.NebulaCloud);
        if (region !== undefined) p.visibility.knownGalaxyLocations.push(region);
        if (marked !== undefined) {
            p.visibility.knownGalaxyLocations.push(marked);
            const c = marked.resolveLocationCenter();
            // A hint at the location points at it (drawn as its pulse only).
            p.locationHints.push({ x: Math.trunc(c.x), y: Math.trunc(c.y) });
            list = knownLocations(g, p);
            const loc = list.find((k) => k.kind === 'location')!;
            expect(loc.location).toBe(marked);
            expect(loc.name).toBe(marked.name !== '' ? marked.name : loc.typeLabel);
            const atLoc = list.find((k) => k.kind === 'hint' && k.location === marked);
            expect(atLoc).toBeDefined();
            const markers = mapMarkers(g, p, true, true);
            expect(markers.filter((m) => m.kind === 'hint')).toHaveLength(1);
            expect(markers.some((m) => m.kind === 'location' && m.known?.location === marked)).toBe(true);
        }
        expect(list.every((k) => k.location === null || k.location !== region)).toBe(true);
        // GodMode lists every point-like location.
        expect(knownLocations(g, p, true).filter((k) => k.kind === 'location').length).toBe(g.galaxyLocations.filter((l) => MARKED_LOCATION_TYPES.has(l.type)).length);
        // Waypoints come first, then the known ones; the sub-toggles filter.
        addWaypoint(g, p, 10, 10, 'Pin');
        const ms = mapMarkers(g, p, true, true);
        expect(ms[0]).toMatchObject({ kind: 'waypoint', name: 'Pin' });
        expect(markerTooltip(g, p, ms[0])).toMatch(/^Pin\nYour waypoint/);
        expect(mapMarkers(g, p, false, true).some((m) => m.kind === 'waypoint')).toBe(false);
        expect(mapMarkers(g, p, true, false).every((m) => m.kind === 'waypoint')).toBe(true);
    }, 600000);
});

describe('the location-hint pulse (MainView.2.cs method_229 / method_230)', () => {
    it('grows 1 → 40 px over 2.4 s, fades from 47 % of the period, one phase per frame', () => {
        const c = new HintPulseClock();
        c.advance(0); // dateTime_4 = MinValue: wraps to -2.4
        expect(c.phase).toBeCloseTo(-HINT_PULSE_PERIOD_S, 9);
        expect(c.circle()).toEqual({ radius: -39, alpha: 255 });
        c.advance(2.4); // phase 0
        expect(c.circle()).toEqual({ radius: 1, alpha: 255 });
        c.advance(3.6); // phase 1.2: radius 1 + 20, fading past 2.4 * 0.47
        const num3 = HINT_PULSE_PERIOD_S * 0.47;
        expect(c.circle()).toEqual({ radius: 21, alpha: 255 - Math.trunc(((c.phase - num3) / num3) * 250) });
        c.advance(4.79);
        expect(c.circle().alpha).toBe(5);
        c.advance(4.9); // past the period: wraps
        expect(c.phase).toBeCloseTo(0.1, 9);
    });
    it('labels: the system names\' greedy 80 px rule', () => {
        expect(labelAllowed([], 0, 0)).toBe(true);
        expect(labelAllowed([0, 0], 79, 0)).toBe(false);
        expect(labelAllowed([0, 0], 80, 0)).toBe(true);
    });
});

describe('waypoint keys and the overlay row', () => {
    const ev = (key: string, shift = false) => ({ key, code: 'KeyW', ctrlKey: false, altKey: false, shiftKey: shift, target: null });
    it('W adds at the cursor, Shift+W toggles the overlay; both remappable and free', () => {
        const seen: WaypointKeyAction[] = [];
        setWaypointKeyHandler((a) => seen.push(a));
        expect(dispatchKey(ev('w'), {})).toBe('addWaypoint');
        expect(dispatchKey(ev('W', true), {})).toBe('toggleWaypointsOverlay');
        setWaypointKeyHandler(null);
        expect(seen).toEqual(['addWaypoint', 'toggleWaypointsOverlay']);
        const rows = KEY_BINDINGS.filter((b) => b.improvement === 'waypoints');
        expect(rows.map(bindingId)).toEqual(['addWaypoint:W', 'toggleWaypointsOverlay:Shift+W']);
        const conflicts = findConflicts(KEY_BINDINGS, KEY_BINDINGS);
        for (const r of rows) expect(conflicts.has(bindingId(r))).toBe(false);
        expect(findBinding('W', { ctrl: true, alt: false, shift: false })).toBeNull();
    });
    it('the row is in the Improvements section, on by default; the improvement is registered', () => {
        const row = OVERLAY_ROWS.find((r) => r.key === 'waypoints')!;
        expect(row).toMatchObject({ label: 'Waypoints & Known Locations', improvement: 'waypoints', panel: 'waypoints' });
        expect(improvementById('waypoints')?.default).toBe(true);
        const st = createMapOverlayState();
        expect(st.waypoints).toBe(true);
        expect(overlayActive(st, 'waypoints')).toBe(true);
    });
});

describe('waypoints: dismissed hint / known-location markers', () => {
    it('hidden from markers and the list, restorable, saved, journaled, replayed; the original hints untouched; no digest effect', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        const p = game.playerEmpire;
        const side = inThread(game);
        addLocationHint(p, { x: 3000, y: 4000 });
        addLocationHint(p, { x: 9000, y: 1000 });
        const hintsBefore = JSON.stringify(p.locationHints);
        const before = JSON.stringify(galaxyToJSON(g));
        expect(before).not.toContain('"dismissed"');
        const digest = stateDigest(g);
        const draws = g.rnd.drawCount;
        // The op itself changes neither the digest nor the Rnd (checked before any tick runs).
        expect(dismissMarker(g, p, 'h:1,1', true)).toBe(true);
        expect(stateDigest(g)).toBe(digest);
        expect(g.rnd.drawCount).toBe(draws);
        expect(dismissMarker(g, p, 'h:1,1', false)).toBe(true);
        const hints = () => mapMarkers(g, p, true, true).filter((m) => m.key.startsWith('h:'));
        const n = hints().length;
        expect(n).toBeGreaterThanOrEqual(1);
        side.tick();
        issuePlayerCommand(g, p, 'dismissMarker', ['h:3000,4000', true]);
        issuePlayerCommand(g, p, 'dismissMarker', ['bogus', true]);
        side.tick();
        side.tick();
        expect(hints().map((m) => m.key)).not.toContain('h:3000,4000');
        expect(hints()).toHaveLength(n - 1); expect(p.locationHints.length).toBeGreaterThanOrEqual(1);
        expect(knownLocations(g, p).some((k) => k.key === 'h:3000,4000')).toBe(false);
        expect(knownLocations(g, p, false, true).find((k) => k.key === 'h:3000,4000')?.dismissed).toBe(true);
        expect(JSON.stringify(p.locationHints)).toBe(hintsBefore);
        // Saved with the game (table written although no waypoint exists).
        const loaded = galaxyFromJSON(JSON.parse(JSON.stringify(galaxyToJSON(g))), gameData);
        expect(waypointState(loaded)?.dismissed).toEqual(['h:3000,4000']);
        // Journaled and replayed.
        const ops = commandLog(g).filter((e) => e.source === 'player').map((e) => (e.source === 'player' ? e.op : null));
        expect(ops.filter((o) => o === 'dismissMarker')).toHaveLength(2);
        const fresh = cachedTickGame(gameData);
        addLocationHint(fresh.playerEmpire, { x: 3000, y: 4000 });
        addLocationHint(fresh.playerEmpire, { x: 9000, y: 1000 });
        scheduleCommandLog(fresh.galaxy, commandLog(g));
        runScheduledUntil(fresh.galaxy, g.nowMs);
        expect(waypointState(fresh.galaxy)?.dismissed).toEqual(['h:3000,4000']);
        // Restore: back on the map, and the save is as before.
        issuePlayerCommand(g, p, 'dismissMarker', ['h:3000,4000', false]);
        side.tick();
        side.tick();
        expect(hints()).toHaveLength(n);
        expect(JSON.stringify(galaxyToJSON(g))).not.toContain('"dismissed"'); // nothing dismissed: nothing written
        side.dispose();
    }, 600000);
});
