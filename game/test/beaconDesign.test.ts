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
import { expectedHit, forceReviews, isBeaconAiEmpire, pierceWeapon, reclaimerRating } from '../src/sim/scenario/threats/giantworks/beaconDesign';
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
import { createNewDesigns } from '../src/sim/designGeneration';
import { designsFindNewestCanBuild } from '../src/sim/forceStructure';
import { DiplomaticRelationType } from '../src/sim/diplomacy';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';

const count = (d: import('../src/sim/design').Design, t: ComponentType): number => d.components.filter((c) => c !== null && c.type === t).length;
const review = (g: Galaxy, e: Empire, sub: BuiltObjectSubRole, on: boolean, at: number) => {
    g.scenario!.flags.gwBeacon = on;
    createNewDesigns(g, e, at, at, true, e.designSpecifications.findIndex((x) => x !== null && x.subRole === sub));
    g.scenario!.flags.gwBeacon = true;
    return designsFindNewestCanBuild(e.designs, sub)!;
};

describe('AI designs against the Reclaimers plates', () => {
    it('scores weapons by the hit that lands at the engagement range (missiles keep it, beams lose it)', () => {
        expect(expectedHit(ComponentType.WeaponMissile, 20, 0.55, false)).toBe(20);
        expect(expectedHit(ComponentType.WeaponBeam, 20, 0.5, false)).toBe(10);
        expect(expectedHit(ComponentType.WeaponTorpedo, 20, 0.5, false)).toBe(10);
        expect(expectedHit(ComponentType.WeaponTorpedo, 20, 0.5, true)).toBe(20);
    });

    it('a mid-tech AI empire at war with the Reclaimers swaps weak guns for launchers whose hits clear the plates; peace, the flag off and a human seat change nothing', () => {
        const { g, st, f } = completed();
        const e = g.empires.find((x): x is Empire => x !== null && x !== f && x !== g.independentEmpire && x !== g.playerEmpire && x.pirateEmpireBaseHabitat === null && x.active)!;
        raiseFactionTech(g, e, 4);
        const rating = reclaimerRating(g, st);
        expect(rating).toBe(6);
        const to = pierceWeapon(g, e, rating)!;
        expect(to).toBe(ComponentType.WeaponPhaser); // the armour pass halves a phaser's plate rating: the most net damage per space
        const now = galaxyStarDate(g);
        const off = review(g, e, BuiltObjectSubRole.Cruiser, false, now);
        const on = review(g, e, BuiltObjectSubRole.Cruiser, true, now + 1);
        expect(on).not.toBe(off);
        expect(count(on, ComponentType.WeaponBeam)).toBeLessThanOrEqual(count(off, ComponentType.WeaponBeam));
        expect(count(on, to)).toBeGreaterThan(count(off, to));
        // peace with the Reclaimers: the stock design again
        e.diplomaticRelations.byEmpire(f)!.type = DiplomaticRelationType.None;
        st.phase = 'watching';
        const calm = review(g, e, BuiltObjectSubRole.Cruiser, true, now + 2);
        expect(count(calm, to)).toBe(count(off, to));
        // a human seat is left alone
        expect(isBeaconAiEmpire(g, g.playerEmpire, st)).toBe(false);
    });

    it('forceReviews makes one warship design review per empire at war, once per redesign period', () => {
        const { g, f } = completed();
        const e = g.empires.find((x): x is Empire => x !== null && x !== f && x !== g.independentEmpire && x !== g.playerEmpire && x.pirateEmpireBaseHabitat === null && x.active)!;
        raiseFactionTech(g, e, 4);
        const n = forceReviews(g);
        expect(n).toBeGreaterThan(0);
        expect(forceReviews(g)).toBe(0);
        const d = designsFindNewestCanBuild(e.designs, BuiltObjectSubRole.Cruiser)!;
        expect(d.dateCreated).toBe(galaxyStarDate(g));
    });
});
