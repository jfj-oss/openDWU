// @slow
// The Reclaimers' response fleets and patrols (threats/giantworks/beaconResponse.ts) and the Game Editor's finished Beacon.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Habitat } from '../src/sim/types';
import type { CreateGameOptions, Game } from '../src/sim/game';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectMissionType, builtObjectMission } from '../src/sim/missions/mission';
import { comboOverlayFs, createScenarioGame } from './helpers/scenarioGame';
import { GAME_DAY_LENGTH } from '../src/sim/scenario/hooks';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { takeOwnershipOfColonyFull } from '../src/sim/combat/ownership';
import { spawnableThreats, spawnThreatNow } from '../src/sim/scenario/threats/framework';
import type { GreatWorkSite } from '../src/sim/scenario/threats/giantworks/types';
import { BEACON_FINISHED_SPAWN, beaconComplete, beaconRolled } from '../src/sim/scenario/threats/giantworks/beacon';
import { beaconPosition, isBeamCountdown, peekBeaconState, type BeaconState } from '../src/sim/scenario/threats/giantworks/beaconState';
import { beginSeason, seasonBudget, startWar } from '../src/sim/scenario/threats/giantworks/beaconFleet';
import { driveResponse, fleetCounts, patrolRoute, responseOf, responseShips, responseSummary } from '../src/sim/scenario/threats/giantworks/beaconResponse';
import { greatWorks } from '../src/sim/scenario/threats/giantworks/framework';
import { ComponentType } from '../src/sim/data/components';
import { ComponentCategoryType } from '../src/sim/data/policies';
import { mainWeaponTypes, pierceWeapon, reclaimerRating } from '../src/sim/scenario/threats/giantworks/beaconDesign';
import { liveCores } from '../src/sim/scenario/threats/giantworks/beaconHarvest';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });
const ids = ['threat-framework', 'giantworks'];
const DAY = GAME_DAY_LENGTH;

function beaconGame(): { g: Galaxy; site: GreatWorkSite; game: Game } {
    const { game } = createScenarioGame(base, { scenario: comboOverlayFs(ids), flags: {}, options: age3 });
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
    return { g, site, game };
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


import { raiseFactionTech } from '../src/sim/scenario/threats/robotMutiny';
import { ComponentStatus } from '../src/sim/builtObjectComponent';
import { createNewDesigns } from '../src/sim/designGeneration';
import { designsFindNewestCanBuild } from '../src/sim/forceStructure';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { generateBuiltObjectFromDesign } from '../src/sim/exploration';
import { assignMission } from '../src/sim/missions/assign';
import { BuiltObjectMissionPriority } from '../src/sim/missions/mission';
import { designFor, spawnShip } from '../src/sim/scenario/threats/giantworks/beaconFleet';
import { runGameSeconds } from '../src/sim/tick/harness';
import type { BuiltObject } from '../src/sim/builtObject';

/** Same fleet (n cruisers + n/2 capital ships of the AI empire's newest design) against a Reclaimer strike group, designs made with the Beacon flag off / on. */
function fight(level: number, flagOn: boolean, mult: number): Record<string, number> {
    const { g, st, f } = completed();
    const e = g.empires.find((x): x is Empire => x !== null && x !== f && x !== g.independentEmpire && x !== g.playerEmpire && x.pirateEmpireBaseHabitat === null && x.active)!;
    raiseFactionTech(g, e, level);
    g.scenario!.flags.gwBeacon = flagOn;
    const now = galaxyStarDate(g);
    for (const sub of [BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.CapitalShip]) createNewDesigns(g, e, now, now, true, e.designSpecifications.findIndex((x) => x !== null && x.subRole === sub));
    g.scenario!.flags.gwBeacon = true;
    // an empty spot
    let sx = 0, sy = 0;
    search: for (let x = 200000; x < g.sizeX; x += 100000) for (let y = 200000; y < g.sizeY; y += 100000) if (g.habitats.every((h) => Math.hypot(h.xpos - x, h.ypos - y) > 300000) && g.builtObjects.every((b) => b === null || Math.hypot(b.xpos - x, b.ypos - y) > 300000)) { sx = x; sy = y; break search; }
    const mine: BuiltObject[] = [];
    const theirs: BuiltObject[] = [];
    const designs: string[] = [];
    for (const [sub, n] of [[BuiltObjectSubRole.Frigate, 4 * mult], [BuiltObjectSubRole.Destroyer, 4 * mult], [BuiltObjectSubRole.Cruiser, 4 * mult], [BuiltObjectSubRole.CapitalShip, 2 * mult]] as const) {
        const d = designsFindNewestCanBuild(e.designs, sub);
        if (d === null) continue;
        designs.push(`${sub}:${d.name}`);
        for (let i = 0; i < n; i++) mine.push(generateBuiltObjectFromDesign(g, e, d, `T${sub}${i}`, true, sx - 1500 + i * 40, sy + i * 30));
    }
    for (const [sub, n] of [[BuiltObjectSubRole.Cruiser, 4], [BuiltObjectSubRole.CapitalShip, 2]] as const) {
        const d = designFor(g, f, sub)!;
        for (let i = 0; i < n; i++) theirs.push(spawnShip(g, f, d, sx + 1500 + i * 40, sy + i * 30));
    }
    for (const b of mine) { b.empire && (b.isAutoControlled = false); assignMission(g, b, BuiltObjectMissionType.Attack, theirs[0], null, BuiltObjectMissionPriority.High); }
    const hp = (list: BuiltObject[]): number => list.reduce((s, b) => s + (b.hasBeenDestroyed ? 0 : b.armor > 0 ? 1 : 1), 0);
    const plates = (list: BuiltObject[]): number => list.reduce((s, b) => s + (b.hasBeenDestroyed ? 0 : b.components.items.filter((c) => c.category === ComponentCategoryType.Armor && c.status === ComponentStatus.Damaged).length), 0);
    const out: Record<string, number> = { mine0: mine.length, theirs0: theirs.length, theirPlates0: theirs.reduce((s, b) => s + b.components.items.filter((c) => c.category === ComponentCategoryType.Armor).length, 0) };
    for (let t = 0; t < 12; t++) runGameSeconds(g, 25);
    out.mineAlive = hp(mine);
    out.theirsAlive = hp(theirs);
    out.theirDamagedPlates = plates(theirs);
    out.theirDamagedComps = theirs.reduce((s2, b) => s2 + (b.hasBeenDestroyed ? 0 : b.components.items.filter((c) => c.status === ComponentStatus.Damaged).length), 0);
    out.mineDamagedComps = mine.reduce((s2, b) => s2 + (b.hasBeenDestroyed ? 0 : b.components.items.filter((c) => c.status === ComponentStatus.Damaged).length), 0);
    console.log(`level ${level} flag ${flagOn} ${designs.join(' ')} ::`, JSON.stringify(out));
    return out;
}

describe('experiment: AI fleet vs a Reclaimer strike group', () => {
    for (const level of [4, 5]) {
        it(`level ${level}`, () => {
            fight(level, false, 4);
            fight(level, true, 4);
        }, 900000);
    }
});
