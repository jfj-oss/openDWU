// What the empires learn of the harvest cores from the cattle ships they destroy or board (beaconHarvest.ts noteCattleCore): popups, the map's known cores, the AI, saves.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Habitat } from '../src/sim/types';
import type { GameData as _GD } from '../src/sim/data/gameData';
import type { CreateGameOptions, Game } from '../src/sim/game';
import { comboOverlayFs, createScenarioGame } from './helpers/scenarioGame';
import { GAME_DAY_LENGTH } from '../src/sim/scenario/hooks';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { takeOwnershipOfColonyFull } from '../src/sim/combat/ownership';
import type { GreatWorkSite } from '../src/sim/scenario/threats/giantworks/types';
import { BEACON_FINISHED_SPAWN, beaconComplete, beaconRolled } from '../src/sim/scenario/threats/giantworks/beacon';
import { peekBeaconState, type BeaconState } from '../src/sim/scenario/threats/giantworks/beaconState';
import { spawnShip, startWar } from '../src/sim/scenario/threats/giantworks/beaconFleet';
import { cattleDesign, cattleOf, coresOf, harvestPeriodic, knownCores, liveCores, noteCattleCore } from '../src/sim/scenario/threats/giantworks/beaconHarvest';
import { beaconKnownSites, beaconComplete as _bc } from '../src/sim/scenario/threats/giantworks/beacon';
import { empireMessages } from '../src/sim/messages';
import { scenarioEmit } from '../src/sim/scenario/hooks';
import { coreMarkStyle } from '../src/render/threatMarkers';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { GalaxyTime } from '../src/sim/galaxyTime';
import type { StartGameOptions } from '../src/sim/startGameOptions';
void _bc;

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });
const ids = ['threat-framework', 'giantworks'];
const DAY = GAME_DAY_LENGTH;

function beaconGame(): { g: Galaxy; site: GreatWorkSite; game: Game; gameData: GameData } {
    const { game, gameData } = createScenarioGame(base, { scenario: comboOverlayFs(ids), flags: {}, options: age3 });
    const g = game.galaxy;
    g.scenario!.flags.gwBeacon = true;
    let best = null as (typeof g.systems)[number] | null;
    let bd = Infinity;
    for (const sys of g.systems) {
        const s = sys?.systemStar;
        if (!s || sys.habitats.some((h) => h.empire !== null) || g.checkEmpireTerritoryIdAtLocation(s.xpos, s.ypos) >= 0) continue;
        const d = g.calculateDistance(s.xpos, s.ypos, g.sizeX / 2, g.sizeY / 2);
        if (d < bd) {
            bd = d;
            best = sys;
        }
    }
    const site: GreatWorkSite = { id: 0, system: best!, habitat: null, base: null, progress: 0, stage: 0, wonder: 'beacon', founders: [], startDate: galaxyStarDate(g), completeDate: null, destroyedBy: null };
    return { g, site, game, gameData };
}

/** The Beacon finished and the war begun, no season yet; the Reclaimers' funding free (model 1) and the banks of the response full. */
function completed(): { g: Galaxy; st: BeaconState; f: Empire; victim: Empire; held: Habitat[] } {
    const { g, site } = beaconGame();
    beaconRolled(g, site);
    site.progress = 1;
    site.stage = 4;
    site.completeDate = galaxyStarDate(g);
    beaconComplete(g, site);
    const st = peekBeaconState(g)!;
    startWar(g, st);
    st.season = null;
    st.seasons = [];
    st.stats.seasons = 1;
    g.scenario!.params.beaconFundingModel = 1;
    const f = st.faction!;
    const victim = g.empires.find((e): e is Empire => e !== null && e !== g.independentEmpire && e !== f && e.pirateEmpireBaseHabitat === null && e.active && e !== g.playerEmpire)!;
    const held = victim.colonies.filter((c) => c !== victim.capital && c.population.totalAmount > 0).slice(0, 4);
    for (const c of held) takeOwnershipOfColonyFull(g, victim, c, f, false, false);
    return { g, st, f, victim, held };
}


function setup(): { g: Galaxy; st: BeaconState; game: Game; gameData: GameData; me: Empire; ai: Empire } {
    const { g, site, game, gameData } = beaconGame();
    beaconRolled(g, site);
    site.progress = 1;
    site.stage = 4;
    site.completeDate = galaxyStarDate(g);
    beaconComplete(g, site);
    const st = peekBeaconState(g)!;
    startWar(g, st);
    st.season = null;
    st.seasons = [];
    g.scenario!.params.beaconFundingModel = 1;
    g.scenario!.params.beaconCoreWorldsPer = 1;
    g.scenario!.params.beaconCoresSmall = 4;
    const f = st.faction!;
    const normals = g.empires.filter((e): e is Empire => e !== null && e !== g.independentEmpire && e !== f && e.pirateEmpireBaseHabitat === null && e.active);
    const victims = normals.filter((e) => e !== g.playerEmpire);
    const held: Habitat[] = [];
    for (const v of victims) for (const c of v.colonies.filter((x) => x !== v.capital && x.population.totalAmount > 0)) if (held.length < 5) held.push(c);
    for (const c of held) takeOwnershipOfColonyFull(g, c.empire!, c, f, false, false);
    for (let i = 0; i < 4; i++) {
        g.nowMs += 20 * DAY;
        harvestPeriodic(g, st);
    }
    return { g, st, game, gameData, me: g.playerEmpire!, ai: victims[0] };
}

const forced = (e: Empire): number => empireMessages(e).filter((m) => m.scenarioPopup === 'force').length;
const quiet = (e: Empire): number => empireMessages(e).filter((m) => m.scenarioPopup === 'quiet').length;
/** A cattle ship serving `core` (the first of its pool), at a point near the core. */
function shipOf(g: Galaxy, st: BeaconState, core: ReturnType<typeof liveCores>[number]) {
    const ship = spawnShip(g, st.faction!, cattleDesign(g, st.faction!)!, core.colony.xpos + 1000, core.colony.ypos);
    cattleOf(st).push({ ship, from: core.colony, core: core.colony, load: [], total: 0, launched: galaxyStarDate(g), phase: 'idle' });
    return ship;
}

describe('cattle kills reveal the harvest cores', () => {
    it('the first kill reveals its core with popup 1; a kill naming a new core opens popup 2; a known core is a ticker line, throttled; the AI learns silently', () => {
        const { g, st, me, ai } = setup();
        const cores = liveCores(st);
        expect(cores.length).toBeGreaterThanOrEqual(3);
        expect(knownCores(st, me)).toHaveLength(0);
        expect(beaconKnownSites(g, me).some((s) => s.glyph === 'core')).toBe(false);
        const f0 = forced(me);
        expect(noteCattleCore(g, st, shipOf(g, st, cores[0]), me)).toBe(cores[0]);
        expect(forced(me)).toBe(f0 + 1);
        expect(knownCores(st, me)).toEqual([cores[0]]);
        // known core again: a ticker line, no popup
        const q0 = quiet(me);
        noteCattleCore(g, st, shipOf(g, st, cores[0]), me);
        expect(forced(me)).toBe(f0 + 1);
        expect(quiet(me)).toBe(q0 + 1);
        // throttled
        noteCattleCore(g, st, shipOf(g, st, cores[0]), me);
        expect(quiet(me)).toBe(q0 + 1);
        g.nowMs += 31 * DAY;
        noteCattleCore(g, st, shipOf(g, st, cores[0]), me);
        expect(quiet(me)).toBe(q0 + 2);
        // a new core: popup 2
        noteCattleCore(g, st, shipOf(g, st, cores[1]), me);
        expect(forced(me)).toBe(f0 + 2);
        expect(knownCores(st, me)).toHaveLength(2);
        const marks = beaconKnownSites(g, me).filter((s) => s.glyph === 'core');
        expect(marks.map((s) => s.target)).toEqual(expect.arrayContaining([cores[0].colony, cores[1].colony]));
        // the AI learns the same way, with no messages
        const aiMsgs = empireMessages(ai).length;
        noteCattleCore(g, st, shipOf(g, st, cores[2]), ai);
        expect(knownCores(st, ai)).toEqual([cores[2]]);
        expect(empireMessages(ai).length).toBe(aiMsgs);
        expect(coreMarkStyle().colour).toBe(0x5a2a9e);
    }, 600000);

    it('the kill event and a boarding both count; the last unknown core opens the all-known popup once; a lost core drops its mark with a ticker line', () => {
        const { g, st, me } = setup();
        const cores = liveCores(st);
        // the event path: a destroyed cattle ship
        scenarioEmit(g, 'builtObjectKilledBy', { builtObject: shipOf(g, st, cores[0]), destroyer: me });
        expect(knownCores(st, me)).toEqual([cores[0]]);
        expect(st.stats.cattleKilled).toBe(1);
        // the boarding path
        scenarioEmit(g, 'builtObjectOwnerChanged', { builtObject: shipOf(g, st, cores[1]), from: st.faction, to: me });
        expect(knownCores(st, me)).toHaveLength(2);
        expect(st.stats.cattleBoarded).toBe(1);
        const f0 = forced(me);
        for (const c of cores.slice(2)) noteCattleCore(g, st, shipOf(g, st, c), me);
        expect(knownCores(st, me)).toHaveLength(cores.length);
        // the last reveal was the all-known popup, not popup 2: one popup for the whole run of new cores after the first two
        expect(forced(me)).toBe(f0 + cores.length - 2);
        const all = empireMessages(me).filter((m) => m.scenarioPopup === 'force' && m.title.length > 0);
        expect(all[all.length - 1].description).toContain(String(cores.length));
        // a known core retaken: its mark goes and the ticker says so
        const lost = cores[0];
        const q0 = quiet(me);
        takeOwnershipOfColonyFull(g, st.faction!, lost.colony, g.empires.find((e) => e !== null && e !== me && e !== st.faction && e.pirateEmpireBaseHabitat === null && e !== g.independentEmpire && e.active)!, false, false);
        harvestPeriodic(g, st);
        expect(lost.ended).not.toBeNull();
        expect(knownCores(st, me)).not.toContain(lost);
        expect(beaconKnownSites(g, me).some((s) => s.glyph === 'core' && s.target === lost.colony)).toBe(false);
        expect(quiet(me)).toBeGreaterThan(q0);
    }, 600000);

    it('what is known survives a save round trip, and an old record without it reads as nothing known', () => {
        const { g, st, game, gameData, me } = setup();
        const cores = liveCores(st);
        noteCattleCore(g, st, shipOf(g, st, cores[1]), me);
        const time = new GalaxyTime();
        time.bindGalaxy(g);
        const text = serializeGame(game, time, {} as StartGameOptions);
        const { game: lgame } = deserializeGame(text, gameData);
        const lg = lgame.galaxy;
        const ls = peekBeaconState(lg)!;
        const lme = lg.playerEmpire!;
        expect(knownCores(ls, lme).map((c) => c.colony.habitatIndex)).toEqual([cores[1].colony.habitatIndex]);
        expect(knownCores(ls, lme)[0].since).toBe(cores[1].since);
        for (const c of coresOf(ls)) delete c.knownBy;
        expect(knownCores(ls, lme)).toHaveLength(0);
        expect(cattleOf(ls).length).toBeGreaterThan(0);
        void cattleDesign;
    }, 600000);
});
