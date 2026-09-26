// 18a — chat advisor: the brief (src/sim/player/advisorBrief.ts) built from the seed-1 harness game, and the response
// validation / execution (src/sim/player/advisorCommands.ts) with scripted model replies (no network).
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { GameData } from '../src/sim/data/gameData';
import type { BuiltObject } from '../src/sim/builtObject';
import { Habitat } from '../src/sim/types';
import { BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { ShipGroup } from '../src/sim/fleets/shipGroup';
import { DiplomaticRelationType } from '../src/sim/diplomacy';
import { stateDigest } from '../src/sim/tick/digest';
import { executeShipAction } from '../src/sim/player/executeShipAction';
import { createMissionShipAction } from '../src/sim/player/shipAction';
import { ShipActionType } from '../src/sim/player/shipAction';
import {
    type AdvisorBrief,
    briefTokenEstimate,
    buildAdvisorBrief,
    nearestUnexploredSystemStar,
    resolveRef,
    shipRef,
} from '../src/sim/player/advisorBrief';
import { allowedTargets, executeAdvisorCommands, validateAdvisorResponse } from '../src/sim/player/advisorCommands';

let gameData: GameData;
let galaxy: Galaxy;
let player: Empire;

beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

beforeEach(() => {
    galaxy = createTickGame(gameData).galaxy;
    player = galaxy.playerEmpire!;
});

function explorer(): BuiltObject {
    return player.builtObjects.find((b) => b.name === 'Sublime Fantasy')!;
}

function commandFor(brief: AdvisorBrief, who: string, verb: string, note?: string): string {
    const c = brief.commands.find((x) => x.who === who && x.do === verb && (note === undefined || x.note === note));
    expect(c, `${who} ${verb}`).toBeDefined();
    return c!.id;
}

describe('buildAdvisorBrief (seed-1 harness game)', () => {
    it('is compact, lists ships / places / orders, and does not touch the sim state', () => {
        const before = stateDigest(galaxy);
        const brief = buildAdvisorBrief(galaxy, player, null);
        expect(stateDigest(galaxy)).toBe(before);
        expect(briefTokenEstimate(brief)).toBeLessThan(4000);
        expect(brief.empire.name).toBe(player.name);
        expect(brief.admiral).toEqual({ name: 'Gerrin Walkin', role: 'Leader' });
        // 13 mobile ships, none in a fleet; bases are not ships.
        expect(brief.ships.length).toBe(13);
        expect(brief.ships.every((s) => s.ref.startsWith('s'))).toBe(true);
        expect(brief.ships.find((s) => s.name === 'Sublime Fantasy')).toMatchObject({ type: 'ExplorationShip', fuel: 100, at: 'Sol', mission: 'Explore' });
        // fix7: the start explorer has an Explore mission (FastFindNearestUnexploredHabitat finds star-only systems, Galaxy.6.cs 4611).
        expect(brief.ships.find((s) => s.name === 'Sublime Fantasy')!.idle).toBeFalsy();
        expect(brief.places.find((p) => p.name === 'Sol')).toMatchObject({ kind: 'System', explored: true, owner: 'you' });
        expect(brief.places.find((p) => p.name === 'Sol 2 Space Port')).toMatchObject({ kind: 'MediumSpacePort', refuel: true });
        // Ids are unique and every ref in the orders resolves.
        expect(new Set(brief.commands.map((c) => c.id)).size).toBe(brief.commands.length);
        for (const c of brief.commands) {
            if (c.who !== 'you') expect(resolveRef(galaxy, player, c.who), c.who).not.toBeNull();
            for (const t of typeof c.to === 'string' && !['*', 'places', 'systems', 'ships'].includes(c.to) ? [c.to] : allowedTargets(brief, c)) {
                expect(resolveRef(galaxy, player, t), `${c.id} → ${t}`).not.toBeNull();
            }
        }
    });

    it('offers Explore > nearest unexplored system only to ships with sensors (Main.Part8.cs 4400), Refuel at the nearest point to all', () => {
        const brief = buildAdvisorBrief(galaxy, player, explorer());
        expect(brief.selection).toBe(shipRef(explorer()));
        const star = nearestUnexploredSystemStar(galaxy, explorer())!;
        const c = brief.commands.find((x) => x.who === shipRef(explorer()) && x.do === 'Explore' && x.note === 'nearest unexplored system')!;
        expect(c.to).toBe(`h${star.habitatIndex}`);
        expect(brief.places.find((p) => p.ref === c.to)).toMatchObject({ kind: 'System', explored: false });
        const frigate = player.builtObjects.find((b) => b.name === 'Enforcer 001')!;
        expect(brief.commands.some((x) => x.who === shipRef(frigate) && x.do === 'Explore')).toBe(false);
        expect(brief.commands.some((x) => x.who === shipRef(frigate) && x.do === 'Patrol')).toBe(true);
        expect(brief.commands.some((x) => x.who === shipRef(explorer()) && x.do === 'Patrol')).toBe(false);
        for (const s of brief.ships) expect(brief.commands.some((x) => x.who === s.ref && x.do === 'Refuel' && x.note === 'at nearest refuelling point')).toBe(true);
        // Nobody is met at the start: no diplomacy orders; the Build Order rows are there.
        expect(brief.empires).toEqual([]);
        expect(brief.commands.filter((x) => x.who === 'you').map((x) => x.note)).toContain('Escort');
    });
});

describe('validateAdvisorResponse', () => {
    it('rejects unknown ids and invalid targets, accepts a target given by name', () => {
        const brief = buildAdvisorBrief(galaxy, player, null);
        const move = commandFor(brief, shipRef(explorer()), 'Move');
        const patrolFrigate = commandFor(brief, brief.ships.find((s) => s.name === 'Enforcer 001')!.ref, 'Patrol');
        const v = validateAdvisorResponse(brief, {
            reply: 'At once.',
            commands: [{ id: 'c9999' }, { id: move, targetId: 'S96' }, { id: patrolFrigate, targetId: 'h999999' }],
        });
        expect(v.reply).toBe('At once.');
        expect(v.clarify).toBeUndefined();
        expect(v.rejected.map((r) => r.reason)).toEqual(['unknown command id c9999', expect.stringContaining('not a valid Patrol target')]);
        expect(v.commands).toHaveLength(1);
        expect(v.commands[0].target).toBe(brief.places.find((p) => p.name === 'S96')!.ref);
    });

    it('asks instead of acting when a target is missing or one ship gets two immediate orders', () => {
        const brief = buildAdvisorBrief(galaxy, player, null);
        const who = shipRef(explorer());
        const noTarget = validateAdvisorResponse(brief, JSON.stringify({ reply: 'Where to?', commands: [{ id: commandFor(brief, who, 'Move') }] }));
        expect(noTarget.commands).toEqual([]);
        expect(noTarget.clarify).toMatch(/^Sublime Fantasy — Move where\?/);
        const two = validateAdvisorResponse(brief, {
            reply: '',
            commands: [{ id: commandFor(brief, who, 'Explore', 'nearest unexplored system') }, { id: commandFor(brief, who, 'Refuel', 'at nearest refuelling point') }],
        });
        expect(two.commands).toEqual([]);
        expect(two.clarify).toContain('can only do one thing now');
        // The second one queued is fine.
        const queued = validateAdvisorResponse(brief, {
            reply: '',
            commands: [{ id: commandFor(brief, who, 'Explore', 'nearest unexplored system') }, { id: commandFor(brief, who, 'Refuel', 'at nearest refuelling point'), queue: true }],
        });
        expect(queued.clarify).toBeUndefined();
        expect(queued.commands).toHaveLength(2);
    });

    it('reports a non-JSON answer as an error', () => {
        const brief = buildAdvisorBrief(galaxy, player, null);
        expect(validateAdvisorResponse(brief, 'Aye captain').error).toBe('The answer was not valid JSON');
        expect(validateAdvisorResponse(brief, { reply: 'x', commands: 3 }).error).toBe('`commands` is not an array');
    });
});

describe('executeAdvisorCommands (scripted model replies)', () => {
    it('"send my explorer to the nearest unexplored system": Explore mission on the system star, ship no longer automated', () => {
        const ship = explorer();
        const brief = buildAdvisorBrief(galaxy, player, ship);
        const star = nearestUnexploredSystemStar(galaxy, ship)!;
        const reply = { reply: 'Sublime Fantasy will chart it.', commands: [{ id: commandFor(brief, shipRef(ship), 'Explore', 'nearest unexplored system') }] };
        const v = validateAdvisorResponse(brief, reply);
        const [r] = executeAdvisorCommands(galaxy, player, brief, v.commands);
        expect(r).toMatchObject({ ok: true, status: 'done', text: `Sublime Fantasy: Explore → ${star.name}`, message: 'mission Explore' });
        const m = builtObjectMission(ship.mission)!;
        expect(m.type).toBe(BuiltObjectMissionType.Explore);
        expect(m.targetHabitat).toBe(star);
        expect(ship.isAutoControlled).toBe(false);
    });

    it('"refuel the fleet": the fleet gets a Refuel mission at its nearest refuelling point', () => {
        const ships = player.builtObjects.filter((b) => b.name.startsWith('Colossia'));
        const join = createMissionShipAction(BuiltObjectMissionType.Undefined);
        join.actionType = ShipActionType.JoinShipGroup;
        const r0 = executeShipAction(galaxy, player, ships[0], join, true);
        const fleet = r0.select as ShipGroup;
        expect(fleet).toBeInstanceOf(ShipGroup);
        for (const s of ships) s.currentFuel = s.fuelCapacity * 0.2;
        const brief = buildAdvisorBrief(galaxy, player, fleet);
        expect(brief.fleets).toHaveLength(1);
        expect(brief.fleets[0]).toMatchObject({ ref: 'f0', ships: 1, fuel: 20, selected: true });
        const id = commandFor(brief, 'f0', 'Refuel', 'all ships, at nearest refuelling point');
        const v = validateAdvisorResponse(brief, { reply: 'Refuelling.', commands: [{ id }] });
        const [r] = executeAdvisorCommands(galaxy, player, brief, v.commands);
        expect(r.ok).toBe(true);
        expect(fleet.mission?.type).toBe(BuiltObjectMissionType.Refuel);
    });

    it('re-checks the live state: an order for a ship that is gone fails without touching anything', () => {
        const brief = buildAdvisorBrief(galaxy, player, null);
        const ship = explorer();
        const v = validateAdvisorResponse(brief, { reply: '', commands: [{ id: commandFor(brief, shipRef(ship), 'Explore', 'nearest unexplored system') }] });
        const missionBefore = builtObjectMission(ship.mission);
        const typeBefore = missionBefore?.type ?? BuiltObjectMissionType.Undefined;
        ship.owner = null; // e.g. captured between the brief and the answer
        const [r] = executeAdvisorCommands(galaxy, player, brief, v.commands);
        expect(r).toMatchObject({ ok: false, status: 'failed', message: 'Sublime Fantasy can no longer take orders' });
        expect(builtObjectMission(ship.mission)).toBe(missionBefore);
        expect(builtObjectMission(ship.mission)?.type ?? BuiltObjectMissionType.Undefined).toBe(typeBefore);
    });

    it('Build goes through buildNewShips (affordability, yards) and charges the order', () => {
        const brief = buildAdvisorBrief(galaxy, player, null);
        const id = brief.commands.find((c) => c.who === 'you' && c.do === 'Build' && c.note === 'Escort')!.id;
        const before = player.builtObjects.length;
        const [r] = executeAdvisorCommands(galaxy, player, brief, [{ id, count: 2 }]);
        expect(r.ok).toBe(true);
        expect(r.text).toBe('Sol Commonwealth: Build 2× Javelin');
        expect(player.builtObjects.length).toBe(before + 2);
        player.stateMoney = 0;
        const [r2] = executeAdvisorCommands(galaxy, player, brief, [{ id }]);
        expect(r2.ok).toBe(false);
    });

    it('a war declaration needs confirm: true (needs-confirm otherwise, relation unchanged)', () => {
        const other = galaxy.empires.find((e) => e !== player && e.active && e !== galaxy.independentEmpire)!;
        player.diplomaticRelations.byEmpire(other)!.type = DiplomaticRelationType.None;
        other.diplomaticRelations.byEmpire(player)!.type = DiplomaticRelationType.None;
        const brief = buildAdvisorBrief(galaxy, player, null);
        expect(brief.empires).toEqual([{ ref: `e${other.empireId}`, name: other.name, relation: 'None' }]);
        const war = brief.commands.find((c) => c.who === `e${other.empireId}` && c.do === 'WAR_DECLARE')!;
        expect(war.confirm).toBe(true);
        const [r] = executeAdvisorCommands(galaxy, player, brief, [{ id: war.id }]);
        expect(r.status).toBe('needs-confirm');
        expect(player.diplomaticRelations.byEmpire(other)!.type).toBe(DiplomaticRelationType.None);
        const [r2] = executeAdvisorCommands(galaxy, player, brief, [{ id: war.id, confirm: true }]);
        expect(r2.ok).toBe(true);
        expect(player.diplomaticRelations.byEmpire(other)!.type).toBe(DiplomaticRelationType.War);
    });

    it('a Move to a place targets the habitat itself (method_315 offset 0)', () => {
        const brief = buildAdvisorBrief(galaxy, player, null);
        const ship = explorer();
        const s96 = brief.places.find((p) => p.name === 'S96')!;
        const [r] = executeAdvisorCommands(galaxy, player, brief, [{ id: commandFor(brief, shipRef(ship), 'Move'), targetId: s96.ref }]);
        expect(r.ok).toBe(true);
        const m = builtObjectMission(ship.mission)!;
        expect(m.type).toBe(BuiltObjectMissionType.Move);
        expect(m.targetHabitat).toBeInstanceOf(Habitat);
        expect(m.targetHabitat!.name).toBe('S96');
    });
});
