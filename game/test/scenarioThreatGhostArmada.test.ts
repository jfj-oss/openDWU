// 19f #7 Ghost Armada (tasks/19f-hidden-threats.md §7): flag off, wreck recording, a forced rise (state seeded
// directly rather than waiting for a real empire elimination), targeting, and containment. Short, direct-call tests.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game, CreateGameOptions } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import { runGameSeconds } from '../src/sim/tick/harness';
import { setGameEndHandler, type GameEndEventArgs } from '../src/sim/victory';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { builtObjectCompleteTeardown } from '../src/sim/combat/teardown';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import {
    GHOST_ARMADA_CODE_CONTAINED,
    ghostArmadaKnownSites,
    ghostArmadaPeriodic,
    ghostArmadaState,
    ghostArmadaYearly,
    peekGhostArmadaState,
} from '../src/sim/scenario/threats/ghostArmada';
import { KNOWLEDGE_RUMOUR } from '../src/sim/scenario/threats/framework';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });

function gaGame(flags: Record<string, boolean> = {}): { game: Game; g: Galaxy } {
    const { game } = createScenarioGame(base, {
        scenario: 'ghostarmada',
        flags: { threatGhostArmada: true, ...flags },
        params: { ghostDelayYears: 1, ghostRaidRange: 1e8, ghostArmadaExistChancePct: 100, ghostArmadaMinYear: 0 },
        options: age3,
    });
    return { game, g: game.galaxy };
}

describe('Ghost Armada: flag off', () => {
    it('no state with the flag off', () => {
        const { game, g } = gaGame({ threatGhostArmada: false });
        runGameSeconds(game, 65);
        expect(peekGhostArmadaState(g)).toBeNull();
    }, 300000);
});

describe('Ghost Armada: forced rise, targeting, containment', () => {
    it('rise: a pending dead empire past its delay rises as a faction at locked war with its conqueror', () => {
        const { game, g } = gaGame();
        const dead = g.empires.find((e) => e !== g.playerEmpire && e.pirateEmpireBaseHabitat === null)!;
        const conqueror = g.empires.find((e) => e !== dead && e.pirateEmpireBaseHabitat === null)!;
        const design = dead.designs.find((d) => d.role === BuiltObjectRole.Military)!;
        const st = ghostArmadaState(g);
        st.wrecks.push({ design, x: dead.capital!.xpos, y: dead.capital!.ypos, empireId: dead.empireId, date: 0 });
        st.wrecks.push({ design, x: dead.capital!.xpos + 100, y: dead.capital!.ypos, empireId: dead.empireId, date: 0 });
        st.pending.push({ deadEmpireId: dead.empireId, deadEmpireName: dead.name, race: dead.dominantRace, conqueror, date: -1000000000 });
        const nBefore = g.empires.length;
        ghostArmadaYearly(g);
        expect(g.empires.length).toBe(nBefore + 1);
        expect(st.pending).toHaveLength(0);
        expect(st.risen).toHaveLength(1);
        const faction = st.risen[0].faction;
        expect(faction.dominantRace).toBe(dead.dominantRace);
        expect(faction.builtObjects.length).toBeGreaterThan(0);
        expect(obtainDiplomaticRelation(faction, conqueror).type).toBe(DiplomaticRelationType.War);
        expect(obtainDiplomaticRelation(faction, conqueror).locked).toBe(true);
        expect(ghostArmadaKnownSites(g, conqueror).some((s) => s.level >= KNOWLEDGE_RUMOUR)).toBe(true);
    }, 600000);

    it('targeting: an idle ghost ship is sent against the conqueror\'s nearest colony', () => {
        const { game, g } = gaGame();
        const dead = g.empires.find((e) => e !== g.playerEmpire && e.pirateEmpireBaseHabitat === null)!;
        const conqueror = g.empires.find((e) => e !== dead && e.pirateEmpireBaseHabitat === null)!;
        const design = dead.designs.find((d) => d.role === BuiltObjectRole.Military)!;
        const st = ghostArmadaState(g);
        st.wrecks.push({ design, x: dead.capital!.xpos, y: dead.capital!.ypos, empireId: dead.empireId, date: 0 });
        st.pending.push({ deadEmpireId: dead.empireId, deadEmpireName: dead.name, race: dead.dominantRace, conqueror, date: -1000000000 });
        ghostArmadaYearly(g);
        const faction = st.risen[0].faction;
        const bo = faction.builtObjects[0];
        ghostArmadaPeriodic(g);
        expect(bo.mission).not.toBeNull();
    }, 600000);

    it('containment: once the faction has no ships left it is torn down and the game ends (2017)', () => {
        const { game, g } = gaGame();
        const dead = g.empires.find((e) => e !== g.playerEmpire && e.pirateEmpireBaseHabitat === null)!;
        const conqueror = g.empires.find((e) => e !== dead && e.pirateEmpireBaseHabitat === null)!;
        const design = dead.designs.find((d) => d.role === BuiltObjectRole.Military)!;
        const st = ghostArmadaState(g);
        st.wrecks.push({ design, x: dead.capital!.xpos, y: dead.capital!.ypos, empireId: dead.empireId, date: 0 });
        st.pending.push({ deadEmpireId: dead.empireId, deadEmpireName: dead.name, race: dead.dominantRace, conqueror, date: -1000000000 });
        ghostArmadaYearly(g);
        const faction = st.risen[0].faction;
        for (const bo of [...faction.builtObjects]) builtObjectCompleteTeardown(g, bo);
        const ends: GameEndEventArgs[] = [];
        setGameEndHandler(g, (e) => ends.push(e));
        ghostArmadaPeriodic(g);
        expect(faction.active).toBe(false);
        expect(ends.map((e) => e.code)).toEqual([GHOST_ARMADA_CODE_CONTAINED]);
        setGameEndHandler(g, null);
    }, 600000);
});
