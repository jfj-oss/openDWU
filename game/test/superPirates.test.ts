import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, type CreateGameOptions } from '../src/sim/game';
import { setGovernmentsStatic } from '../src/sim/empire';
import { GalaxyShape, HabitatCategoryType, type Habitat } from '../src/sim/types';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import { generateSuperPirateFaction } from '../src/sim/pirates';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
}, 60000);

function opts(): CreateGameOptions {
    const ai = (race: string) => ({ race, homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', age: 1, techLevel: 0.5 });
    return {
        seed: 1, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8,
        systemNames: Array.from({ length: 300 }, (_, i) => `S${i}`), gameData,
        player: { race: 'Human', homeSystemFavourability: 'Normal', startLocation: '(Random)', age: 1, techLevel: 0.5 },
        aiEmpires: [ai('(Random)'), ai('(Random)'), ai('(Random)')],
        piratePrevalence: 1.0,
    };
}

function spyRnd(g: Galaxy): { k: string; v: number }[] {
    const log: { k: string; v: number }[] = [];
    const rnd = g.rnd as unknown as { next: (...a: number[]) => number; nextDouble: () => number };
    const next = rnd.next.bind(rnd);
    const nextDouble = rnd.nextDouble.bind(rnd);
    rnd.next = (...a: number[]) => { const v = next(...a); log.push({ k: 'n' + a.join(','), v }); return v; };
    rnd.nextDouble = () => { const v = nextDouble(); log.push({ k: 'd', v }); return v; };
    return log;
}

function run() {
    const g = createGame(opts()).galaxy;
    const fuel = g.resourceSystem.fuelResources[0].resourceId;
    const home = g.habitats.find((x) => x.category !== HabitatCategoryType.GasCloud && x.category !== HabitatCategoryType.Star && x.empire === null && x.basesAtHabitat.length === 0 && x.resources.some((r) => r.resourceId === fuel)) as Habitat;
    const independent = g.habitats.filter((x) => x.empire === g.independentEmpire && x.population.totalAmount > 0);
    const log = spyRnd(g);
    const p = generateSuperPirateFaction(g, { independentColonies: independent, startingAge: 1, difficultyLevel: 1.0 }, home, 'Deadly Phantoms', null, 4);
    return { g, p, home, log };
}

describe('explore', () => {
    it('runs', () => {
        const { p, log } = run();
        console.log(p.designs.map((d) => `${BuiltObjectSubRole[d.subRole]}:${d.name}:${d.components.length}:${d.pictureRef}`).join('\n'));
        console.log(p.builtObjects.map((b) => `${BuiltObjectSubRole[b.subRole]}:${b.name}`).join('\n'));
        console.log(log.map((e) => e.k + '=' + (e.k === 'd' ? e.v.toFixed(4) : e.v)).join(' '));
        expect(p).toBeTruthy();
    }, 60000);
});
