// Parity batch C4: the Return of the Shakturi climax — a scripted story game reaches the Freedom Alliance (Galaxy.8.cs 2058
// GenerateFreedomAlliance, offered by the "Ancient Guardians Reveal All" story panel at level 2: Main.Part10.cs 5013 →
// Main.Part4.cs 4899 method_572 / 5006 btnStoryEventAction_Click) and the story victory (Galaxy.1.cs 425-478:
// DecimateEmpire, GuardiansDepart, Code 1), all through journaled player commands.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { tickGameOptions } from './helpers/tickGame';
import { createGame, type CreateGameOptions } from '../src/sim/game';
import type { GameData } from '../src/sim/data/gameData';
import { galaxyRaceByName, generateShakturiReturnTriggerRuins, identifyShakturiEmpire, investigateRuinsStoryEvent } from '../src/sim/story/storyEvents';
import { identifyMechanoidEmpire } from '../src/sim/fleets/militaryAI';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { runPlayerCommand } from '../src/sim/player/playerCommands';
import { commandLog } from '../src/sim/player/commandLog';
import { ShipGroup } from '../src/sim/fleets/shipGroup';
import { VictoryConditions, GameEndOutcome, checkVictoryConditions, gameVictoryArgs, setGameEndHandler, type GameEndEventArgs } from '../src/sim/victory';
import { takeOwnershipOfColonyFull } from '../src/sim/combat/ownership';
import { storyPanelSpec } from '../src/ui/messagePopups';
import { shakturiEndingStory } from '../src/ui/screens/empireComparison';
import { generateMajorStoryVictoryMessage } from '../src/sim/story/storyEvents';
import { decimateEmpire } from '../src/sim/story/freedomAlliance';
import { Random } from '../src/sim/random';

let gameData: GameData;

beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 180000);

function storyGame(over: Partial<CreateGameOptions> = {}) {
    const vc = new VictoryConditions();
    vc.enableStoryEvents = true;
    return createGame({ ...tickGameOptions(gameData), storyReturnOfTheShakturiEnabled: true, victoryConditions: vc, ...over });
}

/** GenerateShakturi re-levels the galaxy's Shakturi race instance; keep the shared GameData race intact anyway. */
function withRaceRestored<T>(fn: () => T): T {
    const race = gameData.races.find((r) => r.name === 'Shakturi')!;
    const snap = { ...race };
    try {
        return fn();
    } finally {
        Object.assign(race, snap);
    }
}

describe('Freedom Alliance and the Shakturi story victory', () => {
    it('level 2 story message → Join the Freedom Alliance → take the Shakturi capital → story victory (Code 1)', () => {
        withRaceRestored(() => {
            const game = storyGame();
            const g = game.galaxy;
            const player = g.playerEmpire!;
            const mech = identifyMechanoidEmpire(g)!;
            expect(mech).not.toBeNull();
            // The Beacon of Shaktur and the Erutkah refugees (the disguised Shakturi).
            generateShakturiReturnTriggerRuins(g);
            investigateRuinsStoryEvent(g, player, g.shakturiTriggerHabitat!, '');
            const shakturi = identifyShakturiEmpire(g)!;
            expect(shakturi).not.toBeNull();
            expect(galaxyRaceByName(g, 'Erutkah')).toBe(g.shakturiActualRace);
            // The Guardians have revealed all (Empire.2.cs 3666: level 2); the player accepts their story message.
            g.storyReturnOfTheShakturiEventLevel = 2;
            obtainDiplomaticRelation(player, mech).type = DiplomaticRelationType.None;
            obtainDiplomaticRelation(mech, player).type = DiplomaticRelationType.None;
            const reply = runPlayerCommand(g, player, 'answerConversation', [mech, 'HISTORY_OFFER_STORYMESSAGE_ACCEPT', null, 0]);
            expect(reply.ok).toBe(true);
            expect(reply.history?.storyLevel).toBe(2);
            expect(g.storyReturnOfTheShakturiEventLevel).toBe(2); // level 2 waits for the answer
            const spec = storyPanelSpec(reply.history!.storyLevel!);
            expect(spec.pictureUrl).toMatch(/guardians\.jpg$/);
            expect(spec.choice?.actionText).toBe('Yes, we will unite to fight the Shakturi!');

            // btnStoryEventAction_Click: join the alliance.
            const fleet = runPlayerCommand(g, player, 'storyEventAction', [2]);
            expect(fleet).toBeInstanceOf(ShipGroup);
            const sg = fleet as ShipGroup;
            expect(sg.name).toBe('Guardian Fleet');
            expect(sg.empire).toBe(player);
            expect(sg.ships.length).toBeGreaterThan(0);
            for (const s of sg.ships) expect(s.empire).toBe(player);
            expect(sg.gatherPoint).toBe(mech.capital);
            expect(mech.reclusive).toBe(false);
            expect(obtainDiplomaticRelation(player, mech).type).toBe(DiplomaticRelationType.MutualDefensePact);
            const war = obtainDiplomaticRelation(player, shakturi);
            expect(war.type).toBe(DiplomaticRelationType.War);
            expect(war.locked).toBe(true);
            const gvc = g.globalVictoryConditions!;
            expect(gvc.targetHabitat).toBe(shakturi.capital);
            expect(gvc.targetHabitatEmpire).toBe(shakturi);
            expect(gvc.defendHabitat).toBe(mech.capital);
            expect(gvc.defendHabitatEmpire).toBe(mech);
            expect(commandLog(g).filter((e) => e.source === 'player').map((e) => (e as { op: string; error?: string }).error ?? (e as { op: string }).op)).toEqual(['answerConversation', 'storyEventAction']);

            // The alliance takes the Shakturi capital.
            const target = gvc.targetHabitat!;
            takeOwnershipOfColonyFull(g, shakturi, target, player, false, false);
            const ends: GameEndEventArgs[] = [];
            setGameEndHandler(g, (e) => ends.push(e));
            checkVictoryConditions(g, player, gameVictoryArgs(g));
            expect(ends).toHaveLength(1);
            expect(ends[0].victorEmpire).toBe(player);
            expect(ends[0].outcomeForPlayer).toBe(GameEndOutcome.Victory);
            expect(ends[0].code).toBe(1);
            expect(g.shakturiDefeated).toBe(true);
            expect(player.haveDefeatedShakturi).toBe(true);
            // GuardiansDepart: the Guardians join the player; every relation unlocked.
            expect(mech.active).toBe(false);
            for (const e of g.empires) for (const r of e.diplomaticRelations) expect(r.locked).toBe(false);
            // The Code 1 ending story panel (Main.Part12.cs 3429).
            const story = shakturiEndingStory(ends[0])!;
            expect(story.title).toBe('You have Defeated the Shakturi!');
            expect(story.text).toBe(generateMajorStoryVictoryMessage(GameEndOutcome.Victory));
            expect(story.text).not.toBe('');
            setGameEndHandler(g, null);
        });
    }, 300000);

    it('refusing the alliance forms it without the player, launches the invasion and moves the story to level 3', () => {
        withRaceRestored(() => {
            const g = storyGame().galaxy;
            const player = g.playerEmpire!;
            const mech = identifyMechanoidEmpire(g)!;
            generateShakturiReturnTriggerRuins(g);
            investigateRuinsStoryEvent(g, player, g.shakturiTriggerHabitat!, '');
            const shakturi = identifyShakturiEmpire(g)!;
            g.storyReturnOfTheShakturiEventLevel = 2;
            runPlayerCommand(g, player, 'storyEventClose', [2]);
            expect(g.storyReturnOfTheShakturiEventLevel).toBe(3);
            expect(shakturi.name).toBe('Shaktur Supremacy');
            expect(g.globalVictoryConditions!.targetHabitat).toBeNull(); // the player is not in the alliance
            expect(obtainDiplomaticRelation(mech, shakturi).type).toBe(DiplomaticRelationType.War);
            // Any other level: nothing.
            expect(runPlayerCommand(g, player, 'storyEventAction', [3])).toBeNull();
        });
    }, 300000);

    it('DecimateEmpire draws Next(0, 100) per ship / base (NextDouble for a damaged one) and Next(0, 10) per colony', () => {
        withRaceRestored(() => {
            const g = storyGame().galaxy;
            const player = g.playerEmpire!;
            generateShakturiReturnTriggerRuins(g);
            investigateRuinsStoryEvent(g, player, g.shakturiTriggerHabitat!, '');
            const shakturi = identifyShakturiEmpire(g)!;
            const objects = [...shakturi.privateBuiltObjects, ...shakturi.builtObjects];
            const colonies = shakturi.colonies.slice();
            expect(objects.length).toBeGreaterThan(0);
            // Predict the sequence on a copy of the generator.
            const r = new Random(0);
            r.setState(g.rnd.getState());
            const fate = objects.map(() => {
                const n = r.next(0, 100);
                if (n > 5 && n <= 20) r.nextDouble();
                return n > 20 ? 'torn' : 'kept';
            });
            decimateEmpire(g, shakturi, player);
            objects.forEach((b, i) => {
                if (fate[i] === 'torn') expect(b.hasBeenDestroyed).toBe(true);
            });
            for (let j = 0; j < colonies.length; j++) r.next(0, 10);
            expect(JSON.stringify(g.rnd.getState())).toBe(JSON.stringify(r.getState()));
        });
    }, 300000);
});
