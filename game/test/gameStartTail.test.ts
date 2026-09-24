import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createGame, type CreateGameOptions } from '../src/sim/game';
import { GalaxyShape, HabitatCategoryType } from '../src/sim/types';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { setGovernmentsStatic } from '../src/sim/empire';
import { Random } from '../src/sim/random';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import { DiplomaticRelation, DiplomaticRelationList, DiplomaticRelationType, meetEmpiresAtStart, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { SystemVisibilityStatus } from '../src/sim/visibility';
import { CreatureType } from '../src/sim/creature';
import { RuinType } from '../src/sim/ruins';
import type * as TailModule from '../src/sim/gameStartTail';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { ComponentCategoryType } from '../src/sim/data/policies';

// createGame calls gameStartTail at its end; replace it with a no-op there so the blocks can be
// run one by one below (on the galaxy exactly as createGame leaves it before Start.2.cs 1568).
vi.mock('../src/sim/gameStartTail', async (importOriginal) => {
    const actual = await importOriginal<typeof TailModule>();
    return { ...actual, gameStartTail: () => ({ ageOfShadows: false, playAsAPirate: false, clearPreWarpSendPirateRaid: false }) };
});

let tail: typeof TailModule;
let gameData: GameData;
beforeAll(async () => {
    tail = await vi.importActual<typeof TailModule>('../src/sim/gameStartTail');
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
}, 60000);

function opts(galaxyAge: number): CreateGameOptions {
    const s = (race: string) => ({ race, homeSystemFavourability: 'Normal' as const, proximityDistance: 'Random', startLocation: '(Random)', age: galaxyAge, techLevel: 0.5 });
    return {
        seed: 1, shape: GalaxyShape.Spiral, starCount: 300, sectorWidth: 8, sectorHeight: 8,
        systemNames: Array.from({ length: 300 }, (_, i) => `S${i}`), gameData, galaxyAge,
        player: s('Human'), aiEmpires: [s('(Random)'), s('(Random)'), s('(Random)')],
    };
}

// Counts Galaxy.Rnd draws (Next + NextDouble) made while `fn` runs.
function draws(galaxy: Galaxy, fn: () => void): number {
    const rnd = galaxy.rnd;
    const next = rnd.next.bind(rnd) as (...x: number[]) => number;
    const nextDouble = rnd.nextDouble.bind(rnd);
    let n = 0;
    rnd.next = ((...a: number[]) => { n++; return next(...a); }) as typeof rnd.next;
    rnd.nextDouble = () => { n++; return nextDouble(); };
    try { fn(); } finally { rnd.next = next as typeof rnd.next; rnd.nextDouble = nextDouble; }
    return n;
}

function cloneRandom(r: Random): Random {
    const c = Object.create(Random.prototype) as Random;
    Object.assign(c, structuredClone({ ...(r as unknown as Record<string, unknown>) }));
    return c;
}

const seen = (s: SystemVisibilityStatus) => s === SystemVisibilityStatus.Explored || s === SystemVisibilityStatus.Visible;

// Independent restatement of Start.2.cs 1376-1427 (fresh relation lists): which ordered pairs
// meet, and how many Rnd.Next(0,3) draws are taken.
function expectedMeetings(galaxy: Galaxy, empires: readonly Empire[], rnd: Random): { pairs: Set<string>; draws: number } {
    const pairs = new Set<string>();
    let n = 0;
    for (const a of empires) {
        for (const b of empires) {
            if (a === b) continue;
            for (const sys of galaxy.systems) {
                const i = sys.systemStar.systemIndex;
                const sb = b.systemVisibility[i].status;
                const sa = a.systemVisibility[i].status;
                let met = seen(sa) && sb === SystemVisibilityStatus.Visible;
                if (seen(sb) && seen(sa)) {
                    n++;
                    if (rnd.next(0, 3) === 1) met = true;
                }
                if (!met) continue;
                const key = [a.empireId, b.empireId].sort((x, y) => x - y).join('-');
                pairs.add(key);
                break;
            }
        }
    }
    return { pairs, draws: n };
}

function relationSummary(empires: readonly Empire[]): string[] {
    const out: string[] = [];
    for (const e of empires) {
        for (const r of e.diplomaticRelations) {
            out.push(`${e.empireId}:${r.thisEmpire!.empireId}->${r.otherEmpire!.empireId}:${DiplomaticRelationType[r.type]}:init${r.initiator!.empireId}`);
        }
    }
    return out;
}

describe('DiplomaticRelation / DiplomaticRelationList (DiplomaticRelation.cs, DiplomaticRelationList.cs)', () => {
    it('enum order, ctor defaults, indexer by EmpireId-1, Remove/RemoveAt reindex, InvertEmpireIndexing', () => {
        expect([DiplomaticRelationType.NotMet, DiplomaticRelationType.None, DiplomaticRelationType.War, DiplomaticRelationType.Truce]).toEqual([0, 1, 7, 8]);
        const e = (id: number) => ({ empireId: id }) as unknown as Empire;
        const [a, b, c] = [e(1), e(2), e(5)];
        const r1 = new DiplomaticRelation(DiplomaticRelationType.None, a, a, b, false);
        expect([r1.tradeBonus, r1.strategy, r1.locked, r1.allianceName, r1.lastDiplomacyTradeOfferDate, r1.yearsStored]).toEqual([0, 0, false, '', 0, 3]);
        const r2 = new DiplomaticRelation(DiplomaticRelationType.War, a, a, c, 1234, true);
        expect([r2.lastDiplomacyTradeOfferDate, r2.supplyRestrictedResources]).toEqual([1234, true]);
        const list = new DiplomaticRelationList();
        list.add(r1);
        list.add(r2);
        expect(list.byEmpire(b)).toBe(r1);
        expect(list.byEmpire(c)).toBe(r2);
        expect(list.byEmpire(a)).toBeNull();
        expect(list.countMet()).toBe(2);
        list.remove(r1);
        expect(list.byEmpire(b)).toBeNull();
        expect(list.byEmpire(c)).toBe(r2);
        list.removeAt(0);
        expect(list.count).toBe(0);
        const inv = new DiplomaticRelationList();
        inv.invertEmpireIndexing = true;
        inv.add(new DiplomaticRelation(DiplomaticRelationType.None, b, b, a, false));
        expect(inv.byEmpire(b)).not.toBeNull();
        expect(inv.byEmpire(a)).toBeNull();
    });
});

describe('Start.2.cs 1376-1427 meetEmpiresAtStart', () => {
    for (const age of [0, 1]) {
        it(`galaxy age ${age}: None relations on both sides for every pair per C#, exact Rnd.Next(0,3) draws, deterministic`, () => {
            const run = () => {
                const g = createGame(opts(age)).galaxy;
                const empires = g.empires.slice();
                // createGame already ran the block; restart from fresh lists (the state C# has at 1376).
                for (const e of empires) e.diplomaticRelations = new DiplomaticRelationList();
                const exp = expectedMeetings(g, empires, cloneRandom(g.rnd));
                const n = draws(g, () => meetEmpiresAtStart(g, empires));
                return { g, empires, exp, n, summary: relationSummary(empires) };
            };
            const a = run();
            expect(a.n).toBe(a.exp.draws);
            for (const x of a.empires) {
                for (const y of a.empires) {
                    if (x === y) continue;
                    const key = [x.empireId, y.empireId].sort((p, q) => p - q).join('-');
                    const rx = x.diplomaticRelations.byEmpire(y);
                    const ry = y.diplomaticRelations.byEmpire(x);
                    expect(rx !== null, key).toBe(a.exp.pairs.has(key));
                    expect(ry !== null, key).toBe(a.exp.pairs.has(key));
                    if (rx !== null) {
                        expect(rx.type).toBe(DiplomaticRelationType.None);
                        expect(rx.thisEmpire).toBe(x);
                        expect(rx.otherEmpire).toBe(y);
                        // Initiator: the empire that came first in the outer loop (empireList order).
                        const first = a.empires.indexOf(x) < a.empires.indexOf(y) ? x : y;
                        expect(rx.initiator).toBe(first);
                    }
                }
            }
            // Pairs that share a Visible system always meet (no Rnd needed).
            for (const x of a.empires) {
                for (const y of a.empires) {
                    if (x === y) continue;
                    const shared = a.g.systems.some((s) => seen(x.systemVisibility[s.systemStar.systemIndex].status) && y.systemVisibility[s.systemStar.systemIndex].status === SystemVisibilityStatus.Visible);
                    if (shared) expect(x.diplomaticRelations.byEmpire(y)).not.toBeNull();
                }
            }
            const b = run();
            expect(b.summary).toEqual(a.summary);
            expect(b.n).toBe(a.n);
            console.log(`meetEmpiresAtStart age ${age}: draws=${a.n} pairs=${[...a.exp.pairs].join(',') || '(none)'}`);
        });
    }

    it('overlapping Explored space: one Rnd.Next(0,3) per mutually explored system until the first hit', () => {
        const run = () => {
            const g = createGame(opts(1)).galaxy;
            const empires = g.empires.slice();
            for (const e of empires) e.diplomaticRelations = new DiplomaticRelationList();
            // Synthetic overlap: every empire has explored the first 12 systems (none Visible).
            for (const e of empires) for (const sys of g.systems.slice(0, 12)) {
                const v = e.systemVisibility[sys.systemStar.systemIndex];
                if (v.status !== SystemVisibilityStatus.Visible) v.status = SystemVisibilityStatus.Explored;
            }
            const exp = expectedMeetings(g, empires, cloneRandom(g.rnd));
            const n = draws(g, () => meetEmpiresAtStart(g, empires));
            return { exp, n, summary: relationSummary(empires) };
        };
        const a = run();
        expect(a.n).toBe(a.exp.draws);
        expect(a.n).toBeGreaterThan(0);
        expect(a.summary.length).toBe(a.exp.pairs.size * 2);
        expect(run()).toEqual(a);
        console.log(`meetEmpiresAtStart synthetic overlap: draws=${a.n} pairs=${[...a.exp.pairs].join(',')}`);
    });

    it('ObtainDiplomaticRelation adds a NotMet relation once; the meeting block upgrades NotMet to None', () => {
        const g = createGame(opts(1)).galaxy;
        const [p, q] = g.empires;
        p.diplomaticRelations = new DiplomaticRelationList();
        q.diplomaticRelations = new DiplomaticRelationList();
        const r = obtainDiplomaticRelation(p, q);
        expect(r.type).toBe(DiplomaticRelationType.NotMet);
        expect(obtainDiplomaticRelation(p, q)).toBe(r);
        expect(p.diplomaticRelations.count).toBe(1);
        expect(obtainDiplomaticRelation(p, p).type).toBe(DiplomaticRelationType.None);
        expect(p.diplomaticRelations.count).toBe(1);
        // Make them share a Visible system so they certainly meet.
        const idx = p.capital!.systemIndex;
        q.systemVisibility[idx].status = SystemVisibilityStatus.Visible;
        p.systemVisibility[idx].status = SystemVisibilityStatus.Visible;
        meetEmpiresAtStart(g, [p, q]);
        expect(r.type).toBe(DiplomaticRelationType.None);
        expect(q.diplomaticRelations.byEmpire(p)!.type).toBe(DiplomaticRelationType.None);
    });
});

interface TailRun {
    g: Galaxy;
    newAsteroids: import('../src/sim/types').Habitat[];
    draws: Record<string, number>;
    summary: unknown;
}

function runTail(age: number): TailRun {
    const g = createGame(opts(age)).galaxy;
    const d: Record<string, number> = {};
    const empireList = g.empires.slice();
    const habitatsBefore = g.habitats.length;
    const beforeSet = new Set(g.habitats);
    const creaturesBefore = g.creatures.length;
    d.capitalCreatureTeardown = draws(g, () => tail.capitalCreatureTeardown(g));
    const creaturesAfterTeardown = g.creatures.length;
    d.homeAsteroidFieldsAtStart = draws(g, () => tail.homeAsteroidFieldsAtStart(g));
    const habitatsAfterAsteroids = g.habitats.length;
    const newAsteroids = g.habitats.filter((h) => !beforeSet.has(h));
    const abandonedAfterHome = g.abandonedBuiltObjects.length;
    d.shakturiStoryAtStart = draws(g, () => tail.shakturiStoryAtStart(g, 0.5));
    let locs: ReturnType<typeof tail.distantWorldsStoryCluesAtStart> = [];
    d.distantWorldsStoryCluesAtStart = draws(g, () => { locs = tail.distantWorldsStoryCluesAtStart(g); });
    d.setKnownGalacticHistoryLocationsAtStart = draws(g, () => tail.setKnownGalacticHistoryLocationsAtStart(g, empireList, locs));
    const resBefore = g.habitats.reduce((n, h) => n + h.resources.length, 0);
    d.setRestrictedResources = draws(g, () => tail.setRestrictedResources(g));
    const resAdded = g.habitats.reduce((n, h) => n + h.resources.length, 0) - resBefore;
    d.generateSilverMistRuins = draws(g, () => tail.generateSilverMistRuins(g));
    d.generateSpecialBonusRuins = draws(g, () => tail.generateSpecialBonusRuins(g));
    d.placeSpecialRuinsAtStart = draws(g, () => tail.placeSpecialRuinsAtStart(g, 300, gameData.raceFamilies));
    d.debrisFieldsAtStart = draws(g, () => tail.debrisFieldsAtStart(g));
    const abandonedBefore87 = g.abandonedBuiltObjects.length;
    d.abandonedShipsAtStart = draws(g, () => tail.abandonedShipsAtStart(g));
    const abandoned87 = g.abandonedBuiltObjects.length - abandonedBefore87;
    const abandonedBefore85 = g.abandonedBuiltObjects.length;
    d.asteroidAbandonedShipsAtStart = draws(g, () => tail.asteroidAbandonedShipsAtStart(g));
    const abandoned85 = g.abandonedBuiltObjects.length - abandonedBefore85;
    d.shakturiAbandonedShipsAtStart = draws(g, () => tail.shakturiAbandonedShipsAtStart(g));
    let res: ReturnType<typeof tail.gameObjectAtStart> | null = null;
    d.gameObjectAtStart = draws(g, () => { res = tail.gameObjectAtStart(g, age, false, false); });
    const ruins = (t: RuinType) => g.habitats.filter((h) => h.ruin !== null && h.ruin.type === t).map((h) => `${h.name}:${h.ruin!.name}`);
    return {
        g,
        newAsteroids,
        draws: d,
        summary: {
            creatures: [creaturesBefore, creaturesAfterTeardown, g.creatures.length],
            asteroidsAdded: habitatsAfterAsteroids - habitatsBefore,
            abandonedHome: abandonedAfterHome,
            restrictedResourcesAdded: resAdded,
            silverMist: ruins(RuinType.CreatureSwarmSilverMist),
            empireBonus: ruins(RuinType.EmpireBonus),
            government: ruins(RuinType.Government),
            component: ruins(RuinType.Component),
            refugees: ruins(RuinType.Refugees).length,
            lostBuiltObject: ruins(RuinType.LostBuiltObject).length,
            lostColony: ruins(RuinType.LostColony).length,
            newPopulation: ruins(RuinType.NewPopulation),
            abandoned87,
            abandoned85,
            abandonedNames: g.abandonedBuiltObjects.map((b) => `${b.name}@${b.parentHabitat?.name}:${b.encounterEventType}`),
            res,
        },
    };
}

describe('gameStartTail blocks (Start.2.cs 1568-2038) on a createGame galaxy', () => {
    for (const age of [0, 1]) {
        it(`galaxy age ${age}: every block runs, state per C#, deterministic Rnd use`, () => {
            const a = runTail(age);
            const g = a.g;
            const s = a.summary as Record<string, unknown>;
            // Capital systems hold no creatures after the teardown (slugs come later, on the asteroids).
            // Habitat numbering stays consistent after AddAsteroidField.
            g.habitats.forEach((h, i) => expect(h.habitatIndex).toBe(i));
            if (age === 0) {
                for (const e of g.empires) {
                    const star = g.determineHabitatSystemStar(e.capital!);
                    const fresh = a.newAsteroids.filter((h) => h.systemIndex === star.systemIndex);
                    expect(fresh.length).toBeGreaterThanOrEqual(80);
                    expect(fresh.length).toBeLessThan(150 * g.empires.filter((o) => o.capital!.systemIndex === star.systemIndex).length);
                    for (const h of fresh) expect(h.category).toBe(HabitatCategoryType.Asteroid);
                    // Start.2.cs 1609-1612: the owner does not know the new asteroids' resources.
                    for (const h of fresh) expect(e.resourceMap.checkResourcesKnown(h)).toBe(false);
                    // 2 rock space slugs on the field (creature prevalence 1.0).
                    const slugs = g.creatures.filter((c) => c.type === CreatureType.RockSpaceSlug && fresh.includes(c.parentHabitat!));
                    expect(slugs.length).toBe(2);
                }
                expect(s.asteroidsAdded).toBe(a.newAsteroids.length);
                // Abandoned pre-warp frigates / destroyers: unowned, no hyperdrive (Start.2.cs 1666 / 1680).
                expect(s.abandonedHome as number).toBeGreaterThan(0);
                for (const b of g.abandonedBuiltObjects.slice(0, s.abandonedHome as number)) {
                    expect(b.empire).toBeNull();
                    expect([BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Destroyer]).toContain(b.subRole);
                    expect(b.design.components.some((c) => c.category === ComponentCategoryType.HyperDrive)).toBe(false);
                }
            } else {
                expect(a.draws.homeAsteroidFieldsAtStart).toBe(0);
                expect(s.asteroidsAdded).toBe(0);
            }
            expect(a.draws.capitalCreatureTeardown).toBe(0);
            expect(a.draws.shakturiStoryAtStart).toBe(0);
            expect(a.draws.distantWorldsStoryCluesAtStart).toBe(0);
            expect(a.draws.setKnownGalacticHistoryLocationsAtStart).toBe(0);
            expect(a.draws.debrisFieldsAtStart).toBe(0);
            expect(a.draws.shakturiAbandonedShipsAtStart).toBe(0);
            expect(a.draws.gameObjectAtStart).toBe(0);
            expect((s.silverMist as string[]).length).toBe(1); // max(1, min(3, 300/450))
            // Seven EmpireBonus ruins; GenerateSpecialBonusRuins overwrites Habitat.Ruin, so two landing
            // on the same lonely habitat leave fewer.
            expect((s.empireBonus as string[]).length).toBeGreaterThanOrEqual(1);
            expect((s.empireBonus as string[]).length).toBeLessThanOrEqual(7);
            // num74 = num75 = 1 → two SelectSpecialRuins each; a lonely habitat that already has a
            // ruin returns true without a new one (Galaxy.6.cs 88), so 1 or 2.
            expect((s.government as string[]).length).toBeGreaterThanOrEqual(1);
            expect((s.government as string[]).length).toBeLessThanOrEqual(2);
            expect((s.component as string[]).length).toBeGreaterThanOrEqual(1);
            expect((s.component as string[]).length).toBeLessThanOrEqual(2);
            expect(s.refugees).toBeLessThanOrEqual(1);
            expect(s.lostBuiltObject).toBeLessThanOrEqual(2); // max(1, 300/110)
            expect(s.lostColony).toBeLessThanOrEqual(1);
            expect((s.newPopulation as string[]).length).toBeLessThanOrEqual(2); // max(1, 300/140)
            expect(g.deferEventsForGameStart).toBe(true);
            const b = runTail(age);
            expect(b.draws).toEqual(a.draws);
            expect(b.summary).toEqual(a.summary);
            console.log(`gameStartTail age ${age} draws: ${JSON.stringify(a.draws)}`);
            console.log(`gameStartTail age ${age} summary: ${JSON.stringify({ ...s, abandonedNames: (s.abandonedNames as string[]).length })}`);
        });
    }

    it('story blocks throw TODO(port) when enabled', () => {
        const g = createGame(opts(1)).galaxy;
        g.storyReturnOfTheShakturiEnabled = true;
        expect(() => tail.shakturiStoryAtStart(g, 0.5)).toThrow(/TODO\(port\)/);
        expect(() => tail.shakturiStoryAtStart(g, 0.0)).not.toThrow();
        expect(() => tail.shakturiAbandonedShipsAtStart(g)).toThrow(/TODO\(port\)/);
        g.storyDistantWorldsEnabled = true;
        expect(() => tail.distantWorldsStoryCluesAtStart(g)).toThrow(/TODO\(port\)/);
        expect(() => tail.debrisFieldsAtStart(g)).toThrow(/TODO\(port\)/);
    });
});
