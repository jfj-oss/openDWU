// The Long Night's Age 2 placement (sim/age2Placement.ts, game.ts foundPreWarp): only the empires that survived Age 1 come back, each on one of its
// last worlds; new empires fill the original count; the player starts on its capital, else the surviving colony nearest the centre, else its old
// home; the crashed hull follows the home; the advisors' 50% popup fires once.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { CreateGameOptions, Game } from '../src/sim/game';
import type { Habitat } from '../src/sim/types';
import { comboOverlayFs, createScenarioGame } from './helpers/scenarioGame';
import { empireMessages } from '../src/sim/messages';
import { setGalaxyResetSupported } from '../src/sim/galaxyReset';
import { buildAge2Game } from '../src/sim/longNightReset';
import { captureSurvivors } from '../src/sim/age2Placement';
import { spawnGreatWork } from '../src/sim/scenario/threats/giantworks/framework';
import { BEACON_KIND, isNormalEmpire, peekBeaconState, type BeaconState } from '../src/sim/scenario/threats/giantworks/beaconState';
import { lossCheck } from '../src/sim/scenario/threats/giantworks/beaconFleet';
import { advisorCheck, rimNudgedValue } from '../src/sim/scenario/threats/giantworks/longNight';
import { peekLongNight, type SurvivorRec } from '../src/sim/scenario/threats/giantworks/longNightState';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });
const ids = ['threat-framework', 'giantworks'];

function brink(): { game: Game; gameData: GameData; g: Galaxy; st: BeaconState } {
    const { game, gameData } = createScenarioGame(base, { scenario: comboOverlayFs(ids), flags: {}, options: age3 });
    const g = game.galaxy;
    g.scenario!.flags.gwBeacon = true;
    expect(spawnGreatWork(g, BEACON_KIND)).toBe(true);
    const st = peekBeaconState(g)!;
    st.phase = 'reclamation';
    st.reclamationDate = 1;
    st.popBaseline = 1000;
    st.popEliminated = 900;
    return { game, gameData, g, st };
}

const normal = (g: Galaxy, st: BeaconState): Empire[] => g.empires.filter((e): e is Empire => e !== null && isNormalEmpire(g, e, st));
const dist = (g: Galaxy, h: { xpos: number; ypos: number } | { x: number; y: number }): number => ('xpos' in h ? Math.hypot(h.xpos - g.sizeX / 2, h.ypos - g.sizeY / 2) : Math.hypot(h.x - g.sizeX / 2, h.y - g.sizeY / 2));
const at = (g: Galaxy, p: { x: number; y: number }): Habitat => g.habitats.find((h) => h.xpos === p.x && h.ypos === p.y)!;
const nameOf = (e: Empire | null): string => e?.name ?? '';

describe('capturing the survivors', () => {
    it('records every empire that still owns a colony: capital first, then the most populous (AI) / the most central (player)', () => {
        const { g, st } = brink();
        const recs = captureSurvivors(g, (e) => isNormalEmpire(g, e, st));
        const player = g.playerEmpire!;
        expect(recs[0]).toMatchObject({ human: 0, name: player.name, alive: true, capitalHeld: true });
        expect(recs[0].homes[0]).toMatchObject({ x: player.capital!.xpos, y: player.capital!.ypos });
        const rest = recs[0].homes.slice(1).map((p) => dist(g, p));
        expect([...rest].sort((a, b) => a - b)).toEqual(rest);
        const ais = recs.filter((r) => r.human < 0);
        expect(ais.length).toBe(normal(g, st).filter((e) => e !== player && e.dominantRace !== null && e.colonies.length > 0).length);
        expect(ais.length).toBeGreaterThan(0);
        for (const r of ais) {
            const e = normal(g, st).find((x) => x.name === r.name)!;
            expect(r.race).toBe(e.dominantRace!.name);
            if (r.capitalHeld) expect(r.homes[0]).toMatchObject({ x: e.capital!.xpos, y: e.capital!.ypos });
            expect(r.primaryColor).toBe(e.mainColor);
        }
    }, 600000);

    it('leaves out an AI empire without colonies; a human without any is kept, with its old capital', () => {
        const { g, st } = brink();
        const player = g.playerEmpire!;
        const victim = normal(g, st).find((e) => e !== player)!;
        const keep = [victim.colonies, player.colonies];
        const cap = player.capital!;
        victim.colonies = [];
        player.colonies = [];
        const recs = captureSurvivors(g, (e) => isNormalEmpire(g, e, st));
        victim.colonies = keep[0];
        player.colonies = keep[1];
        expect(recs.some((r) => r.name === victim.name)).toBe(false);
        expect(recs[0]).toMatchObject({ human: 0, alive: false, capitalHeld: false });
        expect(recs[0].homes).toHaveLength(1);
        expect(recs[0].homes[0]).toMatchObject({ x: cap.xpos, y: cap.ypos });
    }, 600000);
});

describe('Age 2 placement', () => {
    let s: ReturnType<typeof brink>;
    let next: Game;
    let recs: SurvivorRec[];
    let origCount: number;
    let movedPlayerFrom: Habitat;
    let colonyHome: Habitat;
    let clash: Habitat;
    beforeAll(() => {
        s = brink();
        const { g, st } = s;
        const player = g.playerEmpire!;
        const ais = normal(g, st).filter((e) => e !== player);
        origCount = normal(g, st).length;
        // the player lost its capital (keeps its colonies); one AI keeps only a colony of its own (its capital fell); another AI's best world is the first AI's system
        movedPlayerFrom = player.capital!;
        const pc = player.colonies.filter((c) => c !== player.capital);
        expect(pc.length).toBeGreaterThan(1);
        const savedP = player.colonies;
        player.colonies = pc;
        const a1 = ais[0];
        const a2 = ais[1];
        colonyHome = a1.colonies.find((c) => c !== a1.capital)!;
        const savedA1 = a1.colonies;
        a1.colonies = [colonyHome];
        clash = colonyHome;
        recs = captureSurvivors(g, (e) => isNormalEmpire(g, e, st));
        player.colonies = savedP;
        a1.colonies = savedA1;
        // a2's best world shares a system with a1's home (two survivors in one system)
        const r2 = recs.find((r) => r.name === a2.name)!;
        const r1 = recs.find((r) => r.name === a1.name)!;
        r2.homes = [{ ...r1.homes[0], name: 'clash' }, ...r2.homes];
        // only these three survive besides the player's rivals: drop the other AIs
        recs = recs.filter((r) => r.human === 0 || r.name === a1.name || r.name === a2.name);
        setGalaxyResetSupported(g, true);
        lossCheck(g, st);
        peekLongNight(g)!.pending!.survivors = recs;
        next = buildAge2Game(s.game, s.gameData);
    }, 1800000);

    it('rebuilds the survivors pre-warp with their identity and fills the empire count with new empires', () => {
        const g = next.galaxy;
        const now = g.empires.filter((e): e is Empire => e !== null && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.capital !== null);
        for (const r of recs) {
            const e = now.find((x) => x.name === r.name);
            expect(e, r.name).toBeDefined();
            expect(e!.dominantRace!.name).toBe(r.race);
            expect(e!.mainColor).toBe(r.primaryColor);
            expect(e!.secondaryColor).toBe(r.secondaryColor);
            expect(e!.flagShape).toBe(r.flagShape);
        }
        // the empire count is the original (the Age 1 list also held the Reclaimers' faction, which is not an empire of the start)
        expect(now.length).toBeGreaterThanOrEqual(origCount - 1);
        expect(now.length).toBeGreaterThan(recs.length);
        for (const e of now) expect(e.builtObjects.filter((b) => b.topSpeed > 0).length).toBe(0);
    });

    it('puts the AI survivor on its last colony (reset to a normal home) and moves the second one out of the shared system', () => {
        const g = next.galaxy;
        const a1 = g.empires.find((e) => e !== null && e.name === recs.find((r) => r.human < 0)!.name)!;
        expect(a1.capital!.xpos).toBe(colonyHome.xpos);
        expect(a1.capital!.ypos).toBe(colonyHome.ypos);
        expect(a1.capital!.type).toBe(a1.dominantRace!.nativeHabitatType);
        expect(a1.capital!.population.totalAmount).toBeGreaterThan(0);
        const second = g.empires.find((e) => e !== null && e.name === recs.filter((r) => r.human < 0)[1].name)!;
        expect(second.capital!.systemIndex).not.toBe(a1.capital!.systemIndex);
        expect(clash.systemIndex).toBeGreaterThanOrEqual(0);
    });

    it('starts the player at its surviving colony closest to the galaxy centre when its capital fell', () => {
        const g = next.galaxy;
        const me = g.playerEmpire!;
        const r = recs.find((x) => x.human === 0)!;
        expect(r.capitalHeld).toBe(false);
        const best = Math.min(...r.homes.map((p) => dist(g, p)));
        expect(dist(g, me.capital!)).toBeCloseTo(best, 3);
        expect(me.capital!.xpos === movedPlayerFrom.xpos && me.capital!.ypos === movedPlayerFrom.ypos).toBe(false);
        expect(me.name).toBe(r.name);
    });

    it('the crashed hull follows each home: it lies in the home system of every placed empire', () => {
        const g = next.galaxy;
        const sites = peekLongNight(g)!.crashSites;
        for (const r of recs) {
            const e = g.empires.find((x) => x !== null && x.name === r.name)!;
            const site = sites.find((x) => x.empireId === e.empireId);
            expect(site, r.name).toBeDefined();
            expect(site!.habitat.systemIndex).toBe(e.capital!.systemIndex);
        }
    });

    it('new empires keep clear of the survivors, the scars and the old Beacon site', () => {
        const g = next.galaxy;
        const names = new Set(recs.map((r) => r.name));
        const survivors = g.empires.filter((e) => e !== null && names.has(e.name));
        const mem = peekLongNight(g)!.memory!;
        const avoid = [...mem.scars, ...(mem.beaconSite ? [mem.beaconSite] : [])];
        for (const e of g.empires) {
            if (e === null || e === g.independentEmpire || e.pirateEmpireBaseHabitat !== null || e.capital === null || names.has(e.name)) continue;
            for (const v of survivors) expect(e.capital.systemIndex, nameOf(e)).not.toBe(v.capital!.systemIndex);
            for (const a of avoid) expect(Math.hypot(e.capital.xpos - a.x, e.capital.ypos - a.y)).toBeGreaterThan(g.sectorSize * 0.75 - 1);
        }
    });
});

describe('Age 2 placement: nothing survived', () => {
    it('the player starts on its Age 1 home world with its old identity', () => {
        const { g, st, game, gameData } = brink();
        const player = g.playerEmpire!;
        const home = player.capital!;
        const saved = player.colonies;
        player.colonies = [];
        setGalaxyResetSupported(g, true);
        lossCheck(g, st);
        player.colonies = saved;
        const mem = peekLongNight(g)!.pending!;
        // (no AI survivor: every other empire is gone)
        mem.survivors = mem.survivors!.filter((r) => r.human === 0);
        expect(mem.survivors).toHaveLength(1);
        const next = buildAge2Game(game, gameData);
        const me = next.galaxy.playerEmpire!;
        expect(me.name).toBe(player.name);
        expect(me.capital!.xpos).toBe(home.xpos);
        expect(me.capital!.ypos).toBe(home.ypos);
        expect(at(next.galaxy, { x: home.xpos, y: home.ypos })).toBe(me.capital);
    }, 1800000);
});

describe('the advisors at half the galaxy\'s people', () => {
    it('"A World Beyond Their Reach" goes to the player once, when 50% is processed; the AI then leans to the rim', () => {
        const { g, st } = brink();
        st.popEliminated = 400;
        advisorCheck(g);
        const title = 'A World Beyond Their Reach';
        const me = g.playerEmpire!;
        expect(empireMessages(me).some((m) => m.title === title)).toBe(false);
        expect(peekLongNight(g)!.rimNudge).toBeFalsy();
        st.popEliminated = 500;
        advisorCheck(g);
        advisorCheck(g);
        const msgs = empireMessages(me).filter((m) => m.title === title);
        expect(msgs).toHaveLength(1);
        expect(msgs[0].scenarioPopup).toBe('force');
        expect(msgs[0].description.startsWith('Half of the galaxy\'s people are gone.')).toBe(true);
        expect(msgs[0].description.endsWith('We are asking you to make sure something of us remains.')).toBe(true);
        expect(peekLongNight(g)!.rimNudge).toBe(true);
        const ai = normal(g, st).find((e) => e !== me)!;
        const rim = g.habitats.reduce((a, b) => (dist(g, b) > dist(g, a) ? b : a));
        const mid = g.habitats.reduce((a, b) => (dist(g, b) < dist(g, a) ? b : a));
        expect(rimNudgedValue(g, ai, rim, 100)).toBeGreaterThan(rimNudgedValue(g, ai, mid, 100));
        expect(rimNudgedValue(g, me, rim, 100)).toBe(100);
        expect(rimNudgedValue(g, ai, rim, 0)).toBe(0);
    }, 600000);
});
