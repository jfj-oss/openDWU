// Empire elimination on last colony loss through the stock ownership path: Empire.1.cs 54/59/64 TakeOwnershipOfColony
// (combat/ownership.ts takeOwnershipOfColonyFull, reached through Empire.takeOwnershipOfColony) → 184-218 "You have been
// defeated!" + Empire.cs 4874/4879 CompleteTeardown (events.ts empireCompleteTeardown); Habitat.cs 5988 LeaveEmpire's
// independent branch (destroyAllBuiltObjectsAndTroopsAtColony: true); Main.Part9.cs 1994-2020 the player's own
// EmpireDefeated → Galaxy_GameEnd(Defeat) (ui/messageRouting.ts playerDefeatGameEnd).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { Galaxy } from '../src/sim/galaxy';
import type { GameData } from '../src/sim/data/gameData';
import type { Empire } from '../src/sim/empire';
import type { Habitat } from '../src/sim/types';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { determineEmpiresAtWarWith } from '../src/sim/diplomacyTick';
import { EmpireMessageType, empireMessages } from '../src/sim/messages';
import { getText } from '../src/sim/textResolver';
import { runGameSeconds } from '../src/sim/tick/harness';
import { Troop, TroopType } from '../src/sim/cargo';
import { GameEndOutcome } from '../src/sim/victory';
import { playerDefeatGameEnd } from '../src/ui/messageRouting';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function newGalaxy(): Galaxy {
    return cachedTickGame(gameData).galaxy;
}

function setWar(a: Empire, b: Empire): void {
    obtainDiplomaticRelation(a, b).type = DiplomaticRelationType.War;
    obtainDiplomaticRelation(b, a).type = DiplomaticRelationType.War;
}

/** An independent colony to hand to the victim as its second colony. */
function independentColony(galaxy: Galaxy): Habitat {
    const h = galaxy.habitats.find((x) => x.empire === galaxy.independentEmpire && x.population != null && x.population.totalAmount > 0);
    expect(h).toBeDefined();
    return h!;
}

/** Every trace of `dead` left in the living empires' diplomacy / war state (should be none). */
function warAndDiplomacyReferences(galaxy: Galaxy, dead: Empire): string[] {
    const out: string[] = [];
    for (const e of [...galaxy.empires, ...galaxy.pirateEmpires, galaxy.independentEmpire!]) {
        if (e === dead) continue;
        if (e.diplomaticRelations.toArray().some((r) => r.otherEmpire === dead)) out.push(`${e.name} diplomaticRelations`);
        if ((e.empireEvaluations as { empire: Empire | null }[]).some((v) => v.empire === dead)) out.push(`${e.name} empireEvaluations`);
        if (e.pirateRelations.toArray().some((r) => r.otherEmpire === dead)) out.push(`${e.name} pirateRelations`);
        if (determineEmpiresAtWarWith(e).includes(dead)) out.push(`${e.name} war list`);
        if (e.empiresToAttack != null && (e.empiresToAttack as unknown[]).includes(dead)) out.push(`${e.name} empiresToAttack`);
    }
    if (galaxy.empires.includes(dead)) out.push('galaxy.empires');
    for (const h of galaxy.habitats) if (h.empire === dead) out.push(`colony ${h.name}`);
    return out;
}

describe('Empire.1.cs TakeOwnershipOfColony — last colony lost → elimination (184-218, Empire.cs 4879 CompleteTeardown)', () => {
    it('a two-colony empire conquered colony by colony is torn down on the second loss only', () => {
        const galaxy = newGalaxy();
        const conqueror = galaxy.empires[1];
        const victim = galaxy.empires[3];
        const bystander = galaxy.empires[2];
        expect(galaxy.playerEmpire).not.toBe(victim);
        // Build the two-colony empire: its capital plus an independent colony (stock ownership path).
        const second = independentColony(galaxy);
        victim.takeOwnershipOfColony(second, victim);
        expect(victim.colonies.length).toBe(2);
        const first = victim.capital!;
        setWar(conqueror, victim);
        setWar(bystander, victim);
        const ships = [...victim.builtObjects, ...victim.privateBuiltObjects];
        expect(ships.length).toBeGreaterThan(0);
        const troops = victim.troops.items.slice();
        const bystanderInbox = empireMessages(bystander).length;

        conqueror.takeOwnershipOfColony(first, conqueror);
        // One colony left: still alive, still at war, capital moved to the remaining colony (SelectBestCandidateForCapital).
        expect(victim.active).toBe(true);
        expect(galaxy.empires.includes(victim)).toBe(true);
        expect(victim.capital).toBe(second);
        expect(determineEmpiresAtWarWith(conqueror)).toContain(victim);

        conqueror.takeOwnershipOfColony(second, conqueror);
        expect(victim.colonies.length).toBe(0);
        expect(victim.capital).toBe(null);
        expect(victim.active).toBe(false);
        expect(galaxy.empires.includes(victim)).toBe(false);
        expect(galaxy.defeatedEmpires).toContain(victim);
        expect(conqueror.counters.eliminateEmpireCount).toBe(1);
        // No relation / evaluation / war left in any other empire.
        expect(warAndDiplomacyReferences(galaxy, victim)).toEqual([]);
        for (const e of galaxy.empires) {
            for (const w of determineEmpiresAtWarWith(e)) expect(w.capital).not.toBe(null);
        }
        // Empire.cs 5046-5094: conqueror != null → every ship and base is handed over (TakeOwnershipOfBuiltObject).
        expect(victim.builtObjects.length).toBe(0);
        expect(victim.privateBuiltObjects.length).toBe(0);
        expect(victim.shipGroups.length).toBe(0);
        for (const b of ships) expect(b.actualEmpire === conqueror || b.empire === conqueror || b.empire === galaxy.independentEmpire || b.hasBeenDestroyed).toBe(true);
        // Empire.cs 5175-5205: the victim's troops are dropped.
        expect(victim.troops.count).toBe(0);
        for (const t of troops) expect(t.empire === null || t.empire === conqueror).toBe(true);
        // Messages: Empire.1.cs 206 newEmpire.SendMessageToEmpire(empire, EmpireDefeated, empire, "You have been defeated!")…
        const defeated = empireMessages(victim).filter((m) => m.messageType === EmpireMessageType.EmpireDefeated);
        expect(defeated.length).toBe(1);
        expect(defeated[0].sender).toBe(conqueror);
        expect(defeated[0].subject).toBe(victim);
        expect(defeated[0].description).toBe(getText('You have been defeated!'));
        // …and Empire.cs 4908-4913: the bystander at war with the victim hears "We have wiped out your enemy, the X".
        const news = empireMessages(bystander).slice(bystanderInbox).filter((m) => m.messageType === EmpireMessageType.EmpireDefeated);
        expect(news.length).toBe(1);
        expect(news[0].sender).toBe(conqueror);
        expect(news[0].subject).toBe(victim);
        expect(news[0].description).toContain(victim.name);
    }, 300000);

    it('lost to the independents (LeaveEmpire, destroyAll: true): troops dropped, ships torn down, messages from the independents', () => {
        const galaxy = newGalaxy();
        const victim = galaxy.empires[2];
        const other = galaxy.empires[1];
        setWar(other, victim);
        const colony = victim.capital!;
        expect(victim.colonies).toEqual([colony]);
        const troop = new Troop('Defenders', TroopType.Infantry, 50, 50, 100, 100, victim, victim.dominantRace);
        colony.troops!.add(troop);
        victim.troops.add(troop);
        const ships = [...victim.builtObjects, ...victim.privateBuiltObjects];
        // Habitat.cs 5988 → Empire.1.cs 59 (destroyBases = destroyTroops = true).
        galaxy.independentEmpire!.takeOwnershipOfColony(colony, galaxy.independentEmpire, true);
        expect(colony.empire).toBe(galaxy.independentEmpire);
        expect(colony.troops!.count).toBe(0); // destroyTroops → colony.Troops.Clear()
        expect(victim.active).toBe(false);
        expect(galaxy.empires.includes(victim)).toBe(false);
        // CompleteTeardown(IndependentEmpire): conqueror == IndependentEmpire → ships torn down and dropped from Galaxy.BuiltObjects.
        for (const b of ships) {
            expect(b.hasBeenDestroyed).toBe(true);
            expect(galaxy.builtObjects.includes(b)).toBe(false);
        }
        const defeated = empireMessages(victim).filter((m) => m.messageType === EmpireMessageType.EmpireDefeated);
        expect(defeated.length).toBe(1);
        expect(defeated[0].sender).toBe(galaxy.independentEmpire);
        expect(warAndDiplomacyReferences(galaxy, victim)).toEqual([]);
    }, 300000);

    it('an eliminated empire never shows up again in war lists or diplomacy while the game runs', () => {
        const galaxy = newGalaxy();
        const conqueror = galaxy.empires[1];
        const victim = galaxy.empires[3];
        for (const e of galaxy.empires) if (e !== victim) setWar(e, victim);
        for (const c of victim.colonies.slice()) conqueror.takeOwnershipOfColony(c, conqueror);
        expect(victim.active).toBe(false);
        for (let i = 0; i < 6; i++) {
            runGameSeconds(galaxy, 20);
            expect(warAndDiplomacyReferences(galaxy, victim)).toEqual([]);
            for (const e of galaxy.empires) for (const w of determineEmpiresAtWarWith(e)) expect(w.capital).not.toBe(null);
        }
    }, 300000);
});

describe('Main.Part9.cs 1994-2020 — the player\'s own EmpireDefeated ends the game', () => {
    it('the player losing the last colony yields GameEnd(Defeat) with the top-strategic-value empire as victor', () => {
        const galaxy = newGalaxy();
        const player = galaxy.playerEmpire!;
        const conqueror = galaxy.empires.find((e) => e !== player)!;
        for (const c of player.colonies.slice()) conqueror.takeOwnershipOfColony(c, conqueror);
        expect(player.active).toBe(false);
        const msg = empireMessages(player).find((m) => m.messageType === EmpireMessageType.EmpireDefeated && m.subject === player);
        expect(msg).toBeDefined();
        const e = playerDefeatGameEnd(msg!, player, galaxy.empires);
        expect(e).not.toBe(null);
        expect(e!.outcomeForPlayer).toBe(GameEndOutcome.Defeat);
        expect(e!.description).toBe(getText('Your empire has been completely wiped out!'));
        expect(e!.victorEmpire).not.toBe(null);
        expect(galaxy.empires.includes(e!.victorEmpire!)).toBe(true);
        // An AI's defeat (subject is not the player) ends nothing.
        expect(playerDefeatGameEnd(msg!, conqueror, galaxy.empires)).toBe(null);
    }, 300000);
});
