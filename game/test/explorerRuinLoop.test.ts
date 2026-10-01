// Explorer stuck on an already-explored planet (playtest 2026-10-01): a player explorer that finds beneficial ruins it may
// not investigate on its own (Empire.DiscoveryActionRuin 0 = "Ask what to do") kept picking that planet as its nearest
// "unexplored" target — FindNextSystemToScout / FindNearestUnexploredHabitatInSystem / FindUnexploredRuinsOrLocations —
// parking on its centre and being re-sent to it every frame (turning on the spot). exploration.ts ruinAwaitsPlayerDecision
// (deviation) drops such a ruin from the explorer searches; the encounter now sends the EncounterRuins event (the
// "Should we investigate the ruins?" prompt) as in Habitat.cs 2553-2563.
import { beforeAll, describe, expect, it } from 'vitest';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Habitat } from '../src/sim/types';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { builtObjectMission, BuiltObjectMissionPriority, BuiltObjectMissionType } from '../src/sim/missions/mission';
import { assignMission } from '../src/sim/missions/assign';
import { checkRuinsHaveBenefit, ruinAwaitsPlayerDecision } from '../src/sim/exploration';
import { findNextHabitatToExplore, findNextSystemToScout, findUnexploredRuinsOrLocations } from '../src/sim/civilianAI';
import { updatePosition } from '../src/sim/movement';
import { EventMessageType } from '../src/sim/eventTypes';
import { RuinType } from '../src/sim/ruins';
import { MAX_SOLAR_SYSTEM_SIZE } from '../src/sim/visibility';
import { runGameSeconds } from '../src/sim/tick/harness';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

/** The player's first explorer parked 3000 from the beneficial ruin nearest the player's capital, its system fully surveyed. */
function setup(game: Game) {
    const g = game.galaxy;
    const player = g.playerEmpire!;
    const ship = player.builtObjects.find((b) => b.subRole === BuiltObjectSubRole.ExplorationShip)!;
    const cap = player.capital!;
    // A plain beneficial ruin (not UnlockResearchProject, whose search test differs) in a system with no space monsters
    // (an attack would send the explorer away on its own).
    const ruins = g.habitats.filter((h): h is Habitat =>
        h != null && h.ruin !== null && h.ruin.type !== RuinType.UnlockResearchProject && checkRuinsHaveBenefit(g, h.ruin, player) &&
        !g.creatures.some((c) => c != null && !c.hasBeenDestroyed && Math.hypot(c.xpos - h.xpos, c.ypos - h.ypos) < 2 * MAX_SOLAR_SYSTEM_SIZE));
    ruins.sort((a, b) => Math.hypot(a.xpos - cap.xpos, a.ypos - cap.ypos) - Math.hypot(b.xpos - cap.xpos, b.ypos - cap.ypos));
    const hab = ruins[0];
    const star = g.determineHabitatSystemStar(hab)!;
    for (const h of g.systemHabitatsOf(star.systemIndex)) player.resourceMap!.setResourcesKnown(h, true);
    player.resourceMap!.setResourcesKnown(star, true);
    ship.xpos = hab.xpos + 3000;
    ship.ypos = hab.ypos + 3000;
    updatePosition(g, ship);
    return { g, player, ship, hab };
}

describe('explorer does not hang on found-but-uninvestigated ruins', () => {
    it('the explorer searches skip a ruin the player has already encountered (AI empires unaffected)', () => {
        const game = cachedTickGame(gameData, {});
        const { g, player, ship, hab } = setup(game);
        ship.xpos = hab.xpos;
        ship.ypos = hab.ypos;
        updatePosition(g, ship);
        expect(player.discoveryActionRuin).toBe(0);
        // Not found yet: still the explorer's target (the C# behaviour).
        expect(findNextHabitatToExplore(g, ship.xpos, ship.ypos, player, ship).habitat).toBe(hab);
        expect(findUnexploredRuinsOrLocations(g, ship.xpos, ship.ypos, player).habitat).toBe(hab);
        hab.ruin!.playerEmpireEncountered = true;
        expect(ruinAwaitsPlayerDecision(g, hab.ruin!, player)).toBe(true);
        expect(checkRuinsHaveBenefit(g, hab.ruin!, player)).toBe(true);
        expect(findNextHabitatToExplore(g, ship.xpos, ship.ypos, player, ship).habitat).not.toBe(hab);
        expect(findNextSystemToScout(g, player, ship).habitat).not.toBe(hab);
        expect(findUnexploredRuinsOrLocations(g, ship.xpos, ship.ypos, player).habitat).not.toBe(hab);
        const ai = g.empires.find((e) => e !== player && e.pirateEmpireBaseHabitat === null && e !== g.independentEmpire)!;
        expect(ruinAwaitsPlayerDecision(g, hab.ruin!, ai)).toBe(false);
    });

    it('an automated player explorer sent to the ruins asks once and moves on instead of turning on the planet', () => {
        const game = cachedTickGame(gameData, {});
        const { g, player, ship, hab } = setup(game);
        const events: number[] = [];
        player.eventMessageRecipient = { receiveEventMessage: (type) => events.push(type) };
        assignMission(g, ship, BuiltObjectMissionType.Explore, hab, null, BuiltObjectMissionPriority.Normal);
        expect(ship.isAutoControlled).toBe(true);
        let parkedSeconds = 0;
        for (let t = 0; t < 240; t += 5) {
            runGameSeconds(game, 5);
            const m = builtObjectMission(ship.mission);
            const parked = Math.hypot(ship.xpos - hab.xpos, ship.ypos - hab.ypos) < 100 && m !== null && m.target === hab;
            parkedSeconds = parked ? parkedSeconds + 5 : 0;
            expect(parkedSeconds).toBeLessThan(60);
        }
        expect(hab.ruin!.playerEmpireEncountered).toBe(true);
        expect(events).toContain(EventMessageType.EncounterRuins);
        expect(builtObjectMission(ship.mission)?.target).not.toBe(hab);
    }, 300000);
});
