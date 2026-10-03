// Empire lifecycle extras: the split with a caller-chosen seed colony (empireEvents.ts initiateEmpireSplitAt /
// splinterEmpireAt, Empire.1.cs 1102 / 2883 split for 19d1 targeted secession) and the absorb path (empireAbsorb.ts
// absorbEmpire, Galaxy.1.cs 688 GuardiansDepart generalised) used by 19c nationalisation.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { Galaxy } from '../src/sim/galaxy';
import type { GameData } from '../src/sim/data/gameData';
import type { Empire } from '../src/sim/empire';
import type { Habitat } from '../src/sim/types';
import { initiateEmpireSplit, initiateEmpireSplitAt } from '../src/sim/empireEvents';
import { absorbEmpire } from '../src/sim/empireAbsorb';
import { takeOwnershipOfColonyFull } from '../src/sim/combat/ownership';
import { CharacterRole, generateNewCharacter, getEmpireCharacters } from '../src/sim/characters';
import { DiplomaticRelationType } from '../src/sim/diplomacy';
import { EmpireMessageType, type EmpireMessage } from '../src/sim/messages';
import { stateDigest } from '../src/sim/tick/digest';
import { runGameSeconds } from '../src/sim/tick/harness';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function newGalaxy(): Galaxy {
    return cachedTickGame(gameData).galaxy;
}

/** As m4z1Lifecycle.test.ts: give `empire` `count` populated independent colonies, developed and crowded. */
function growEmpire(galaxy: Galaxy, empire: Empire, count: number): Habitat[] {
    const picked = galaxy.independentColonies.filter((h) => h.population.items.length > 0).slice(0, count);
    for (const h of picked) {
        takeOwnershipOfColonyFull(galaxy, galaxy.independentEmpire!, h, empire, false, false);
        h.setDevelopmentLevel(100);
        h.population.items[0].amount = 2000000000;
        h.population.recalculateTotalAmount();
    }
    return picked;
}

describe('initiateEmpireSplitAt (Empire.1.cs 1102 / 2883, split for targeted secession)', () => {
    it('the random (C#) path is unchanged: same state and Rnd as before the refactor', () => {
        const galaxy = newGalaxy();
        const source = galaxy.empires[1];
        growEmpire(galaxy, source, 6);
        initiateEmpireSplit(galaxy, source, 0.4, true);
        // stateDigest + Galaxy.Rnd draw count right after the faithful split on seed 1 (recorded before the split into
        // splinterEmpireAt / initiateEmpireSplitAt; must never move with that refactor).
        // Moved (new) → "a8b312e8d6f7df18:288951": new pin: empireLifecycle.aiSplitDigest (faithful InitiateEmpireSplit on seed 1, recorded on the pre-refactor code) (2026-09-26)
        // Moved "a8b312e8d6f7df18:288951" → "82600a40b8a35771:289000": merge: todosweep2 (planet DoTasks, ProcessEmpireScienceShips scheduling) on top of the integration branch's todosweep/combattest pins (2026-09-26)
        // Moved "82600a40b8a35771:289000" → "42159d821d5440d8:288980": BaconMain.cs 686-697 BaconInitialize queues the SaveStats delayed action (1 day; BaconGalaxy.cs 319 re-queues it every statSaveIntervalInGameDays) and BaconMain.cs 1069/1075-1087 AddOtherDelayedEvents queues ClearShipsAboutToBeDestroyed with Galaxy.Rnd.Next(10, 12) after the 700-715 science-ship Next(26, 35) (2026-09-26)
        // Moved "42159d821d5440d8:288980" → "df5e591362688597:288980": Habitat.cs 924-935/986-998 OrbitDistance/OrbitSpeed property setters recompute _AnglePerSecond on every reassignment; Galaxy.5.cs 1689/1730 sets a moon's real OrbitDistance well after construction (ctor gets a placeholder Rnd.Next(5,32)) relying on that recompute -- types.ts previously had these as plain fields, so moons kept the angular speed implied by the tiny placeholder radius applied to their real, much larger orbit (up to ~240x too fast); fixed by making orbitDistance/orbitSpeed real accessor properties (2026-09-28)
        // Moved "df5e591362688597:288980" → "4985362bf65f2a5a:288778": orbits spaced so planets/moons never overlap (user deviation) (2026-10-03)
        // Moved "4985362bf65f2a5a:288778" → "4a8493f807d8696f:288778": parity A2: spaceport threat check, race periodic traits, wonders scenic, race wonders, garrisons, maintenance, retrofit design (2026-10-03)
        expect(`${stateDigest(galaxy)}:${galaxy.rnd.drawCount}`).toMatchPin('empireLifecycle.aiSplitDigest');
    }, 300000);

    it('an explicit seed colony founds the new empire there, with the given ships and characters, and draws no coordinates', () => {
        const galaxy = newGalaxy();
        const source = galaxy.empires[1];
        const grown = growEmpire(galaxy, source, 6);
        const seed = grown[3];
        const ship = source.privateBuiltObjects.find((b) => b != null && !b.hasBeenDestroyed) ?? source.builtObjects.find((b) => b != null && b.shipGroup === null && !b.hasBeenDestroyed)!;
        expect(ship).toBeTruthy();
        const character = generateNewCharacter(galaxy, source, CharacterRole.ColonyGovernor, source.capital).character;
        const empiresBefore = galaxy.empires.length;
        const splinter = initiateEmpireSplitAt(galaxy, source, 0.2, true, seed, { ships: [ship], characters: [character] })!;
        expect(splinter).not.toBeNull();
        expect(galaxy.empires.length).toBe(empiresBefore + 1);
        expect(galaxy.empires[galaxy.empires.length - 1]).toBe(splinter);
        expect(source.empireSplitCount).toBe(1);
        // The seed is the new empire's first colony and capital.
        expect(splinter.colonies[0]).toBe(seed);
        expect(splinter.capital).toBe(seed);
        expect(seed.empire).toBe(splinter);
        expect(source.colonies.includes(seed)).toBe(false);
        // num = max(1, (int)(0.2 * 7)) = 1: only the seed.
        expect(splinter.colonies.length).toBe(1);
        expect(ship.empire).toBe(splinter);
        expect(splinter.privateBuiltObjects.includes(ship) || splinter.builtObjects.includes(ship)).toBe(true);
        expect(character.empire).toBe(splinter);
        expect(character.location).toBe(seed);
        expect(getEmpireCharacters(splinter).includes(character)).toBe(true);
        expect(getEmpireCharacters(source).includes(character)).toBe(false);
        expect(source.diplomaticRelations.byEmpire(splinter)!.type).toBe(DiplomaticRelationType.War);
        runGameSeconds(galaxy, 60);
        expect(galaxy.empires.includes(splinter)).toBe(true);
    }, 300000);

    it('refuses the capital or a foreign colony (no split, no draw)', () => {
        const galaxy = newGalaxy();
        const source = galaxy.empires[1];
        growEmpire(galaxy, source, 6);
        const draws = galaxy.rnd.drawCount;
        const empiresBefore = galaxy.empires.length;
        expect(initiateEmpireSplitAt(galaxy, source, 0.3, false, source.capital)).toBeNull();
        expect(initiateEmpireSplitAt(galaxy, source, 0.3, false, galaxy.empires[2].capital)).toBeNull();
        expect(galaxy.empires.length).toBe(empiresBefore);
        expect(galaxy.rnd.drawCount).toBe(draws);
    }, 300000);
});

describe('absorbEmpire (Galaxy.1.cs 688 GuardiansDepart body)', () => {
    it('moves colonies, ships, colony characters and techs to the absorber, then tears the absorbed empire down', () => {
        const galaxy = newGalaxy();
        const into = galaxy.empires[1];
        const absorbed = galaxy.empires[2];
        growEmpire(galaxy, absorbed, 2);
        const colonies = absorbed.colonies.slice();
        const ships = [...absorbed.privateBuiltObjects, ...absorbed.builtObjects].filter((b) => b != null && !b.hasBeenDestroyed);
        expect(ships.length).toBeGreaterThan(0);
        const governor = generateNewCharacter(galaxy, absorbed, CharacterRole.ColonyGovernor, absorbed.capital).character;
        const offColony = getEmpireCharacters(absorbed).filter((c) => !colonies.includes(c.location as Habitat));
        const researched = (e: Empire) => new Set(e.research.techTree.filter((n) => n.isResearched).map((n) => n.def.projectId));
        const absorbedTech = researched(absorbed);
        const intoColoniesBefore = into.colonies.length;
        const messagesBefore = (absorbed.messages as EmpireMessage[]).length;

        absorbEmpire(galaxy, into, absorbed);

        // Colonies: every one now the absorber's (Empire.1.cs 64 TakeOwnershipOfColony).
        for (const h of colonies) {
            expect(h.empire).toBe(into);
            expect(into.colonies.includes(h)).toBe(true);
        }
        expect(into.colonies.length).toBe(intoColoniesBefore + colonies.length);
        expect(absorbed.colonies.length).toBe(0);
        // Ships: the teardown hands them to the conqueror (Empire.cs 4879).
        for (const b of ships) {
            if (b.hasBeenDestroyed) continue;
            expect(b.empire).toBe(into);
        }
        // Characters: those at a colony change sides with it (Character.CompleteEmpireChange); the rest die in the teardown.
        expect(governor.empire).toBe(into);
        expect(getEmpireCharacters(into).includes(governor)).toBe(true);
        for (const c of offColony) expect(c.empire).not.toBe(into);
        expect(getEmpireCharacters(absorbed).length).toBe(0);
        // Techs: the absorber knows everything the absorbed empire had researched.
        const intoTech = researched(into);
        for (const id of absorbedTech) expect(intoTech.has(id)).toBe(true);
        // Relations: no live empire keeps a relation / evaluation with the absorbed one; it is defeated and gone.
        expect(absorbed.active).toBe(false);
        expect(galaxy.empires.includes(absorbed)).toBe(false);
        expect(galaxy.defeatedEmpires.includes(absorbed)).toBe(true);
        for (const e of galaxy.empires) {
            expect(e.diplomaticRelations.toArray().some((r) => r.otherEmpire === absorbed)).toBe(false);
            expect((e.empireEvaluations as { empire: Empire | null }[]).some((v) => v.empire === absorbed)).toBe(false);
        }
        // Messages: the last colony's transfer sends "You have been defeated!" from the absorber (Empire.1.cs 215).
        const newMessages = (absorbed.messages as EmpireMessage[]).slice(messagesBefore);
        expect(newMessages.some((m) => m.messageType === EmpireMessageType.EmpireDefeated)).toBe(true);
        runGameSeconds(galaxy, 60);
        expect(galaxy.empires.includes(into)).toBe(true);
    }, 300000);
});
