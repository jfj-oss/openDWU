// Task 19k-1 (Big Galaxies: 60-empire games). Two checks against a real generated 60-empire galaxy (createGame, not
// the harness game cache — scenario games build their own galaxy):
// (b) extended palette: with the big-galaxies scenario's extendedPalette flag on, every one of 60 empires gets a
//     distinct display colour (src/sim/empireColors.ts displayColorForEmpire) instead of the original's colours
//     repeating / collapsing into similar random fallback colours past the 20 key colours.
// (c) duplicate races: with 22 playable races and 60 empires, most races are reused by more than one empire.
//     Empire.cs GenerateEmpireName dedupes names against every existing empire.name (empire.ts generateEmpireName,
//     retried up to 50 times), so names are already guaranteed distinct; flags are NOT distinct per empire in the
//     original — every empire of a race gets that race's DefaultFlagShape (Empire.cs 3862 FlagShape =
//     _DominantRace.DefaultFlagShape, ported verbatim in empire.ts as `dominantRace.defaultFlagDesign`) — so two
//     same-race empires normally share a flag shape and are told apart only by name/colour. This asserts what the
//     task actually needs: no two of the 60 empires share the full (name, flagShape, colour) triple.
//
// Two galaxies are built once (beforeAll) and reused by every assertion below (each createGame at 60 empires runs
// the full Start.2.cs game-start sequence, so building it once per flag value keeps this file well within test:fast).
import { beforeAll, describe, expect, it } from 'vitest';
import type { GameData } from '../src/sim/data/gameData';
import type { Empire } from '../src/sim/empire';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame } from './helpers/scenarioGame';
import { tickGameOptions } from './helpers/tickGame';
import { displayColorForEmpire } from '../src/sim/empireColors';

let gameData: GameData;
let empiresOn: Empire[]; // extendedPalette on
let empiresOff: Empire[]; // extendedPalette off

const EMPIRE_COUNT = 60; // "Big galaxies" cap (task 19k): 1 player + 59 AI empires.
// A star count generous enough for 60 home systems without the 1400-star soak's runtime (that count is verified
// separately by the sim-run.mjs speed measurement, task 19k-1a); this test only checks generation, not ticking.
const STAR_COUNT = 900;

function sixtyEmpireEmpires(extendedPalette: boolean): Empire[] {
    const { game } = createScenarioGame(gameData, {
        scenario: 'big-galaxies',
        flags: { extendedPalette },
        options: (o) => ({
            ...o,
            starCount: STAR_COUNT,
            sectorWidth: 12,
            sectorHeight: 12,
            systemNames: Array.from({ length: STAR_COUNT }, (_, i) => `S${i}`),
            aiEmpires: Array.from({ length: EMPIRE_COUNT - 1 }, () => o.aiEmpires[0]),
        }),
    });
    return game.galaxy.empires;
}

beforeAll(async () => {
    gameData = await loadGameDataFs();
    empiresOn = sixtyEmpireEmpires(true);
    empiresOff = sixtyEmpireEmpires(false);
}, 120000);

describe('60-empire games (task 19k-1)', () => {
    it('generates all 60 empires (galaxy.empires never holds the independent empire)', () => {
        expect(empiresOn).toHaveLength(EMPIRE_COUNT);
    });

    it('(b) gives every one of 60 empires a distinct display colour with extendedPalette on', () => {
        const colors = empiresOn.map((e) => displayColorForEmpire(e));
        expect(new Set(colors).size).toBe(empiresOn.length);
    });

    it('(b) is a pure pass-through of mainColor with extendedPalette off', () => {
        for (const e of empiresOff) expect(displayColorForEmpire(e)).toBe(e.mainColor);
    });

    it('(c) duplicate races occur (>20 empires, 22 playable races): confirms this is a real test of the duplicate case', () => {
        const byRace = new Map<string, number>();
        for (const e of empiresOn) {
            const race = e.dominantRace?.name ?? '(none)';
            byRace.set(race, (byRace.get(race) ?? 0) + 1);
        }
        expect(empiresOn.length).toBeGreaterThan(20);
        expect([...byRace.values()].some((n) => n > 1)).toBe(true);
    });

    it('(c) no two of the 60 empires share the same (name, flagShape, colour) triple, with extendedPalette on', () => {
        const triples = empiresOn.map((e) => `${e.name}|${e.flagShape}|${displayColorForEmpire(e)}`);
        expect(new Set(triples).size).toBe(triples.length);
    });

    it('(c) names alone are already distinct (Empire.cs GenerateEmpireName dedupes against every empire.name)', () => {
        const names = empiresOn.map((e) => e.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('(c) duplicate-race empires do share a flag shape (original behaviour, not a bug): confirms the triple test above is not trivially passing only because flags already differ', () => {
        const byRace = new Map<string, number[]>();
        for (const e of empiresOn) {
            const race = e.dominantRace?.name ?? '(none)';
            (byRace.get(race) ?? byRace.set(race, []).get(race)!).push(e.flagShape);
        }
        const aDuplicateRaceSharesAFlag = [...byRace.values()].some((shapes) => shapes.length > 1 && new Set(shapes).size === 1);
        expect(aDuplicateRaceSharesAFlag).toBe(true);
    });
});
