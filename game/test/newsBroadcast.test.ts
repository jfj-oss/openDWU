// Galactic NewsNet — Empire.7.cs 2961-3398 SendNewsBroadcast / SendNewsBroadcastWarStartEnd / SendNewsBroadcastCore
// (events.ts sendNewsBroadcast*, run synchronously at the call site). Recipients are the empires in the broadcaster's
// DiplomaticRelations that it has met (Type != NotMet, not pirates; disaster news also needs the recipient to have
// explored the colony's system) plus active pirate factions by pirate relation. The texts are gameText() encodings of the
// C# GameText keys. createGame galaxy (seed 1, Human + 3 AIs, pirates on).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createTickGame } from './helpers/tickGame';
import type { Galaxy } from '../src/sim/galaxy';
import type { GameData } from '../src/sim/data/gameData';
import type { Empire } from '../src/sim/empire';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { declareWar } from '../src/sim/diplomacyTick';
import { empireEventColonyNaturalDisaster } from '../src/sim/empireEvents';
import { DisasterEventType, EventMessageType, resolveDisasterDescription, sendNewsBroadcast } from '../src/sim/events';
import { EmpireMessageType, empireMessages, type EmpireMessage } from '../src/sim/messages';
import { gameText } from '../src/sim/colonyTick';
import { SystemVisibilityStatus } from '../src/sim/visibility';
import { PirateRelationType, obtainPirateRelation } from '../src/sim/pirateRelations';
import { getText, isTextLoaded, resolveGameText } from '../src/sim/textResolver';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function news(e: Empire): EmpireMessage[] {
    return empireMessages(e).filter((m) => m.messageType === EmpireMessageType.GalacticNewsNet);
}

/** Make `a` and `b` know each other (relation None both ways) or not (NotMet both ways). */
function setMet(a: Empire, b: Empire, met: boolean): void {
    const t = met ? DiplomaticRelationType.None : DiplomaticRelationType.NotMet;
    obtainDiplomaticRelation(a, b).type = t;
    obtainDiplomaticRelation(b, a).type = t;
}

function setup(): { galaxy: Galaxy; player: Empire; a: Empire; b: Empire; c: Empire } {
    const galaxy = createTickGame(gameData).galaxy;
    const player = galaxy.playerEmpire!;
    const [a, b, c] = galaxy.empires.filter((e) => e !== player && e.pirateEmpireBaseHabitat === null);
    // player and B know A (and each other); C knows neither A nor B.
    setMet(a, player, true);
    setMet(a, b, true);
    setMet(b, player, true);
    setMet(a, c, false);
    setMet(b, c, false);
    for (const e of galaxy.empires) empireMessages(e).length = 0;
    for (const p of galaxy.pirateEmpires) empireMessages(p).length = 0;
    return { galaxy, player, a, b, c };
}

describe('Empire.7.cs 4909 DeclareWar → SendNewsBroadcastWarStartEnd → SendNewsBroadcastCore 3049-3066', () => {
    it('sends "X has declared war on Y" to every empire the declarer has met, none to an empire that knows neither', () => {
        const { galaxy, player, a, b, c } = setup();
        const pirates = galaxy.pirateEmpires.filter((p) => p.active && p.pirateEmpireBaseHabitat !== null);
        expect(pirates.length).toBeGreaterThanOrEqual(2);
        obtainPirateRelation(a, pirates[0]).type = PirateRelationType.None; // met → gets the news (3356-3362)
        obtainPirateRelation(a, pirates[1]).type = PirateRelationType.NotMet; // not met → none
        declareWar(galaxy, a, b);
        const expected = gameText('X has declared war on Y', a.name, b.name);
        expect(expected).toBe(`X has declared war on Y|${a.name}|${b.name}`);
        const header = gameText('Galactic NewsNet').toUpperCase() + ': ' + a.name;
        for (const r of [player, b, pirates[0]]) {
            const n = news(r);
            expect(n.length).toBe(1);
            expect(n[0].description).toBe(header + ' - ' + expected);
            expect(n[0].title).toBe(header);
            expect(n[0].sender).toBe(a);
        }
        expect(news(c)).toEqual([]);
        expect(news(pirates[1])).toEqual([]);
        expect(news(a)).toEqual([]); // never to itself
        // The player's message list carries it (what the ticker / popups read), decoded to the C# text.
        expect(isTextLoaded()).toBe(true);
        const shown = empireMessages(player).find((m) => m.messageType === EmpireMessageType.GalacticNewsNet)!;
        expect(resolveGameText(shown.description)).toBe(`GALACTIC NEWSNET: ${a.name} - ${a.name} has declared war on ${b.name}`);
    });

    it('the war-end broadcast uses "The war between X and Y has ended"', () => {
        const { player, a, b } = setup();
        const dr = obtainDiplomaticRelation(a, b);
        dr.type = DiplomaticRelationType.None;
        dr.initiator = a;
        sendNewsBroadcast(a, EventMessageType.Undefined, dr, DisasterEventType.Undefined, true, false);
        expect(news(player).map((m) => m.description)).toEqual([gameText('Galactic NewsNet').toUpperCase() + ': ' + a.name + ' - ' + gameText('The war between X and Y has ended', a.name, b.name)]);
    });
});

describe('Empire.1.cs 2090 colony disaster → SendNewsBroadcastCore 3120-3153', () => {
    it('carries "Disaster at COLONY" with the disaster type text, to met empires that explored the system', () => {
        const { galaxy, player, a, b } = setup();
        const colony = a.capital!;
        player.visibility.systemVisibility[colony.systemIndex].status = SystemVisibilityStatus.Explored;
        b.visibility.systemVisibility[colony.systemIndex].status = SystemVisibilityStatus.Unexplored;
        b.visibility.empiresSharedVisibility.length = 0;
        empireEventColonyNaturalDisaster(galaxy, a, colony);
        const n = news(player);
        expect(n.length).toBe(1);
        const disasterText = n[0].description.split(' - ').slice(1).join(' - ');
        const parts = disasterText.split('|');
        expect(parts[0]).toBe('Disaster at COLONY');
        const colonyDisasters = [DisasterEventType.Earthquake, DisasterEventType.Sinkhole, DisasterEventType.Tsunami, DisasterEventType.Sandstorm, DisasterEventType.Blizzard, DisasterEventType.Eruption, DisasterEventType.Plague];
        expect(colonyDisasters.map((t) => resolveDisasterDescription(t))).toContain(parts[1]);
        expect(parts[1]).not.toBe('');
        expect(parts[2]).toBe(colony.name);
        expect(news(b)).toEqual([]); // met but has not explored the system (3294-3299)
    });

    it('economic crisis news is ResolveDescription(EconomicCrisis) and goes to every met empire', () => {
        const { player, a, b } = setup();
        sendNewsBroadcast(a, EventMessageType.DisasterEvent, null, DisasterEventType.EconomicCrisis, false, false);
        // Galaxy.2.cs 2478: GameText 'Empire Disaster Economic Crisis' ("Economic Crisis" with the table loaded).
        expect(resolveDisasterDescription(DisasterEventType.EconomicCrisis)).toBe(isTextLoaded() ? getText('Empire Disaster Economic Crisis') : 'Empire Disaster Economic Crisis');
        for (const r of [player, b]) expect(news(r).map((m) => m.description)).toEqual([gameText('Galactic NewsNet').toUpperCase() + ': ' + a.name + ' - ' + resolveDisasterDescription(DisasterEventType.EconomicCrisis)]);
    });
});
