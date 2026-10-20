// The Intelligence screen's Knowledge page model (knowledgeView.ts): what shows for an empire that knows X versus one that does not.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Habitat } from '../src/sim/types';
import type { CreateGameOptions, Game } from '../src/sim/game';
import { comboOverlayFs, createScenarioGame } from './helpers/scenarioGame';
import { GAME_DAY_LENGTH } from '../src/sim/scenario/hooks';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { takeOwnershipOfColonyFull } from '../src/sim/combat/ownership';
import type { GreatWorkSite } from '../src/sim/scenario/threats/giantworks/types';
import { beaconComplete, beaconRolled } from '../src/sim/scenario/threats/giantworks/beacon';
import { peekBeaconState, type BeaconState } from '../src/sim/scenario/threats/giantworks/beaconState';
import { spawnShip, startWar } from '../src/sim/scenario/threats/giantworks/beaconFleet';
import { cattleDesign, cattleOf, harvestPeriodic, liveCores, noteCattleCore } from '../src/sim/scenario/threats/giantworks/beaconHarvest';
import { watcherSightings } from '../src/render/beaconCloakFx';
import { knowledgeRow, knowledgeView, knowledgeVisible, registerKnowledgeSection } from '../src/ui/knowledgeView';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });
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


const ids = ['threat-framework', 'giantworks'];
function shipOf(g: Galaxy, st: BeaconState, core: ReturnType<typeof liveCores>[number]) {
    const ship = spawnShip(g, st.faction!, cattleDesign(g, st.faction!)!, core.colony.xpos + 1000, core.colony.ypos);
    cattleOf(st).push({ ship, from: core.colony, core: core.colony, load: [], total: 0, launched: galaxyStarDate(g), phase: 'idle' });
    return ship;
}

describe('Knowledge page model', () => {
    it('shows only what the viewer has found; tips unlock with knowledge; hooks are hidden when empty', () => {
        const { g, st, me, ai } = setup();
        expect(knowledgeVisible(g)).toBe(true);
        const before = knowledgeView(g, me);
        // nothing learned of the cores: no core, harvester or cattle tip for the viewer
        expect(before.sections.some((s) => s.id === 'cores' || s.id === 'harvesters')).toBe(false);
        expect(before.tips.length).toBe(before.tips.filter((t) => !t.includes('cattle ships')).length);
        // the Beacon and the war are public
        expect(before.sections.some((s) => s.id === 'beacon')).toBe(true);
        expect(before.war.length).toBeGreaterThan(2);
        expect(before.article).not.toBeNull();
        // empty hook sections stay hidden
        for (const id of ['megaStation', 'foundries', 'sleepers', 'ageMemory']) expect(before.sections.some((s) => s.id === id)).toBe(false);
        // a cattle kill reveals one core to the viewer only
        const core = liveCores(st)[0];
        noteCattleCore(g, st, shipOf(g, st, core), me);
        const after = knowledgeView(g, me);
        const cores = after.sections.find((s) => s.id === 'cores')!;
        expect(cores.rows).toHaveLength(1);
        expect(cores.rows[0].goTo).toBe(core.colony);
        expect(after.sections.some((s) => s.id === 'harvesters')).toBe(core.harvester !== null);
        expect(after.tips.length).toBeGreaterThan(before.tips.length);
        expect(knowledgeView(g, ai).sections.some((s) => s.id === 'cores')).toBe(false);
    }, 600000);

    it('a hook section appears when its provider returns rows, and is hidden again on null', () => {
        const { g, me } = setup();
        let rows: ReturnType<typeof knowledgeRow>[] | null = [knowledgeRow('x', 'A foundry', 'Somewhere')];
        registerKnowledgeSection('foundries', 'Foundries', () => rows);
        const shown = knowledgeView(g, me).sections.find((s) => s.id === 'foundries');
        expect(shown?.rows.map((r) => r.what)).toEqual(['A foundry']);
        rows = null;
        expect(knowledgeView(g, me).sections.some((s) => s.id === 'foundries')).toBe(false);
    }, 600000);

    it('the Age 2 memory record reads the Long Night state defensively', () => {
        const { g, me } = setup();
        expect(knowledgeView(g, me).sections.some((s) => s.id === 'ageMemory')).toBe(false);
        // the Long Night's memory record (longNightState.ts): the age, the harvest worlds, the foundries found or destroyed
        g.scenario!.state.longNight = { memory: { age: 2, eliminatedPct: 81.4, scars: [{ name: 'Aporak', systemName: 'Nugdra', x: 1, y: 2, fate: 'live', knownToPlayer: true }], foundries: { located: [{ name: 'Foundry 3', systemName: '', x: 5, y: 6 }], destroyed: [] }, truths: [], extra: {} } };
        const rows = knowledgeView(g, me).sections.find((s) => s.id === 'ageMemory')!.rows;
        expect(rows.map((r) => r.what)).toEqual(['Age 2', 'Aporak', 'Foundry 3']);
        expect(rows[1].point).toEqual({ x: 1, y: 2 });
        g.scenario!.state.longNight = {};
        expect(knowledgeView(g, me).sections.some((s) => s.id === 'ageMemory')).toBe(false);
    }, 600000);

    it('a Watcher sighting is logged by the render pass (no page needed) and listed, only for the viewer who made it', () => {
        const { g, st, me, ai } = setup();
        const w = st.watchers.find((x) => x.ship !== null && !x.ship.hasBeenDestroyed)!.ship!;
        const now = galaxyStarDate(g);
        expect(knowledgeView(g, me).sections.some((s) => s.id === 'watchers' && s.rows.some((r) => r.key.startsWith('sighting')))).toBe(false);
        w.cloakSeenBy = [{ empireId: me.empireId, until: now + 10 * GAME_DAY_LENGTH }];
        watcherSightings([w], me, now, []);
        w.cloakSeenBy = undefined;
        watcherSightings([w], me, now + 50 * GAME_DAY_LENGTH, []);
        const rows = knowledgeView(g, me).sections.find((s) => s.id === 'watchers')!.rows.filter((r) => r.key.startsWith('sighting'));
        expect(rows).toHaveLength(1);
        expect(rows[0].point).toEqual({ x: w.xpos, y: w.ypos });
        expect(knowledgeView(g, ai).sections.some((s) => s.id === 'watchers' && s.rows.some((r) => r.key.startsWith('sighting')))).toBe(false);
    }, 600000);
});
