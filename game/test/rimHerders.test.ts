// Scenario 19j "rim herders" (tasks/19-mod-layer-scenarios.md §19j): herder colonies + docile / defending herds (1),
// tamed storm-immune self-fuelling freighters (2), harvest + kill drop + 19a rim-good plug (3), drovers and guides (4),
// protectorate / conquest / espionage paths (5), migration-season warnings (6), AI path choice (7), flag off = no package
// code (same run as the overlay without the flag), save round trip. Short runs; handlers are driven directly.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame, loadScenarioOverlayFs, scenarioGameData } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { BuiltObject } from '../src/sim/builtObject';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { radiusFraction, scenarioEmit, scenarioQuery } from '../src/sim/scenario';
import type { ScenarioOverlay } from '../src/sim/scenario';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateCounts, stateDigest } from '../src/sim/tick/digest';
import { GalaxyTime, YEAR_LENGTH } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { EmpireMessageType, empireMessages } from '../src/sim/messages';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { takeOwnershipOfColonyFull } from '../src/sim/combat/ownership';
import { rechargeReactors } from '../src/sim/movement';
import { IntelligenceMissionType } from '../src/sim/espionage';
import { raceAggressionLevel, raceCautionLevel } from '../src/sim/colonyTick';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { gameYear } from '../src/sim/scenario/hooks';
import { answerScenarioDecision, pendingScenarioDecisions } from '../src/sim/scenario/decisions';
import { herdMembers, rimFaunaState } from '../src/sim/scenario/rimFauna/common';
import { rimGoodIds } from '../src/sim/scenario/rimTrade/common';
import {
    HERDER_RACE,
    type HerderColony,
    droverWithShip,
    harvestResourceIds,
    herderColonyHerds,
    herderStanding,
    isTamedCreatureShip,
    raceHasTrait,
    rimGuideAboard,
    herderParam,
    rimHerdersState,
} from '../src/sim/scenario/rimHerders/common';
import {
    empireHasHerding,
    empirePrefersProtectorate,
    formProtectorate,
    offerCharacters,
    reviewCharactersLeave,
    rimHerdersAiConquest,
    rimHerdersDomesticate,
    rimHerdersHarvest,
    rimHerdersProtectorateOffers,
    rimHerdersSeasonCheck,
    rimHerdersTribute,
    rimHerdersWarn,
    tagTamedShips,
    herderColonyAttacked,
} from '../src/sim/scenario/rimHerders/rimHerders';
import { HEAL_RATE, HERD_YOUNG_SIZE, herderArmorPierce, matureHerd, rimHerdersHusbandryYear } from '../src/sim/scenario/rimHerders/husbandry';

import { processMessages } from '../src/sim/diplomacyTick';

let base: GameData;
/** Shared flag-on game: every rim independent is a herder, migration season on the last day (tests drive it). */
let shared: Game;
/** rimHerdersCount 3 ≥ every rim independent colony on seed 1 (radius fraction ≥ rimHerdersRimInner; 2 since SetupSun's
 *  SelectHabitatPictures draws moved the galaxy), so `shared` keeps the pre-count "all rim independents are herders"
 *  behaviour the other (2)-(6) tests rely on. */
const PARAMS = { rimHerdersCount: 3, rimFaunaMigrationDay: 359, rimHerdersConquestChance: 1 };

beforeAll(async () => {
    base = await loadGameDataFs();
    shared = createScenarioGame(base, { scenario: 'rim-herders', params: PARAMS }).game;
}, 600000);

function aiEmpires(g: Galaxy): Empire[] {
    return g.empires.filter((e): e is Empire => e !== null && e.active && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e !== g.playerEmpire && e.dominantRace?.name !== HERDER_RACE);
}

function freeColonies(g: Galaxy): HerderColony[] {
    return rimHerdersState(g).colonies.filter((c) => c.status === 'free');
}

function militaryShip(e: Empire): BuiltObject | null {
    return e.builtObjects.find((b) => b != null && !b.hasBeenDestroyed && b.role === BuiltObjectRole.Military) ?? null;
}

describe('19j rim herders — (1) herder colonies and their herds', () => {
    it('rim independents become symbiotic Ossuvan colonies whose herds are docile to them and defend them', () => {
        const g = shared.galaxy;
        const st = rimHerdersState(g);
        expect(st.colonies.length).toBeGreaterThanOrEqual(2);
        for (const hc of st.colonies) {
            expect(radiusFraction(g, hc.colony.xpos, hc.colony.ypos)).toBeGreaterThanOrEqual(0.72);
            expect(hc.colony.population.dominantRace?.name).toBe(HERDER_RACE);
            expect(raceHasTrait(hc.colony.population.dominantRace, 'symbiotic')).toBe(true);
            const herds = herderColonyHerds(g, hc);
            expect(herds.length).toBeGreaterThanOrEqual(1);
            for (const h of herds) expect(h.docileEmpireIds).toContain(g.independentEmpire!.empireId);
        }
        // Docile: a herd creature ignores an independent ship.
        const herd = herderColonyHerds(g, st.colonies[0])[0];
        const indShip = g.independentEmpire!.privateBuiltObjects[0];
        expect(scenarioQuery(g, 'creatureIgnoresTarget', false, { creature: herd.leader!, target: indShip })).toBe(true);
        // Leave them alone: the herd ignores an empire's ships and they spare it, while the empire leaves the colony alone.
        const e = aiEmpires(g)[0];
        const ship = militaryShip(e) ?? e.builtObjects[0];
        expect(scenarioQuery(g, 'creatureIgnoresTarget', false, { creature: herd.leader!, target: ship })).toBe(true);
        expect(scenarioQuery(g, 'builtObjectSparesCreature', false, { builtObject: ship, creature: herd.leader! })).toBe(true);
        // A wild herd is no one's livestock.
        const wild = rimFaunaState(g).herds.find((h) => h.leader !== null && h.docileEmpireIds.length === 0)!;
        expect(scenarioQuery(g, 'builtObjectSparesCreature', false, { builtObject: ship, creature: wild.leader! })).toBe(false);
        // Defence: an attack on the colony turns its herd on the attacker, and the attacker's ships may fight it.
        const before = herderStanding(g, e.empireId);
        scenarioEmit(g, 'habitatAttacked', { habitat: st.colonies[0].colony, attacker: ship, attackingEmpire: e, bombarded: false });
        for (const c of herdMembers(herd)) expect(c.currentTarget).toBe(ship);
        expect(herderStanding(g, e.empireId)).toBeLessThan(before);
        expect(st.stats.defences).toBe(1);
        expect(scenarioQuery(g, 'creatureIgnoresTarget', false, { creature: herd.leader!, target: ship })).toBe(false);
        expect(scenarioQuery(g, 'builtObjectSparesCreature', false, { builtObject: ship, creature: herd.leader! })).toBe(false);
    });

    it('rimHerdersCount picks exactly N herder colonies (Fisher-Yates shuffle of the rim independents, galaxy.rnd)', () => {
        // The rim independents of this galaxy (rimHerdersGameStart's own rule: populated independent colonies at radius
        // fraction ≥ rimHerdersRimInner); how many there are is a property of the galaxy layout.
        const g0 = createScenarioGame(base, { scenario: 'rim-herders', params: { ...PARAMS, rimHerdersCount: 0 } }).game.galaxy;
        expect(rimHerdersState(g0).colonies.length).toBe(0);
        const rim = g0.independentColonies.filter((c) => c.empire === g0.independentEmpire && c.population.items.length > 0 && radiusFraction(g0, c.xpos, c.ypos) >= herderParam(g0, 'rimHerdersRimInner'));
        expect(rim.length).toBeGreaterThanOrEqual(2);

        // Fewer than there are: exactly N of them.
        const n = rim.length - 1;
        const gN = createScenarioGame(base, { scenario: 'rim-herders', params: { ...PARAMS, rimHerdersCount: n } }).game.galaxy;
        expect(rimHerdersState(gN).colonies.length).toBe(n);
        for (const hc of rimHerdersState(gN).colonies) expect(rim.map((c) => c.habitatIndex)).toContain(hc.colony.habitatIndex);

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const gAll = createScenarioGame(base, { scenario: 'rim-herders', params: { ...PARAMS, rimHerdersCount: 20 } }).game.galaxy;
        // Fewer rim independent colonies than the requested 20: all of them become herders, with one warning.
        expect(rimHerdersState(gAll).colonies.length).toBe(rim.length);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain('20');
        expect(warn.mock.calls[0][0]).toContain(String(rim.length));
        warn.mockRestore();
    });
});

describe('19j rim herders — (2) living infrastructure', () => {
    it('herder freighters are tamed creatures: storm-immune and self-fuelling', () => {
        const g = shared.galaxy;
        const hc = rimHerdersState(g).colonies[0];
        const bo = g.independentEmpire!.privateBuiltObjects.find((b) => b.subRole === BuiltObjectSubRole.SmallFreighter || b.subRole === BuiltObjectSubRole.MediumFreighter)!;
        expect(bo).toBeDefined();
        if (!isTamedCreatureShip(g, bo)) {
            bo.parentHabitat = hc.colony;
            tagTamedShips(g);
        }
        expect(isTamedCreatureShip(g, bo)).toBe(true);
        expect(scenarioQuery(g, 'builtObjectStormImmune', false, { builtObject: bo })).toBe(true);
        expect(scenarioQuery(g, 'builtObjectSelfFuelling', false, { builtObject: bo })).toBe(true);
        const other = aiEmpires(g)[0].builtObjects[0];
        expect(scenarioQuery(g, 'builtObjectStormImmune', false, { builtObject: other })).toBe(false);
        // RechargeReactors burns no fuel on a tamed ship.
        bo.currentEnergy = 0;
        const fuel = bo.currentFuel;
        rechargeReactors(g, bo, 1);
        expect(bo.currentEnergy).toBeGreaterThan(0);
        expect(bo.currentFuel).toBe(fuel);
    });
});

describe('19j rim herders — (3) sustainable harvest', () => {
    it('docile herds deposit herd goods at the colony; a kill drops the same goods and costs standing; 19a plug', () => {
        const g = shared.galaxy;
        const ids = harvestResourceIds(g);
        expect(ids.length).toBe(2);
        const hc = rimHerdersState(g).colonies[1];
        const stock = (id: number): number => hc.colony.cargo?.items.find((c) => c.commodity.resourceId === id && c.empire === hc.colony.empire)?.amount ?? 0;
        const before = ids.map(stock);
        const n = herderColonyHerds(g, hc).reduce((a, h) => a + (h.migration === null ? herdMembers(h).length : 0), 0);
        expect(rimHerdersHarvest(g)).toBeGreaterThan(0);
        ids.forEach((id, i) => expect(stock(id) - before[i]).toBe(4 * n));
        // Kill drop: a herd creature killed by an empire freighter.
        const e = aiEmpires(g)[1] ?? aiEmpires(g)[0];
        const killer = [...e.builtObjects, ...e.privateBuiltObjects].find((b) => b != null && b.cargo !== null)!;
        const herd = herderColonyHerds(g, hc)[0];
        const standing = herderStanding(g, e.empireId);
        scenarioEmit(g, 'creatureKilled', { creature: herd.followers[0] ?? herd.leader!, killer, empire: e });
        for (const id of ids) expect(killer.cargo!.items.some((c) => c.commodity.resourceId === id && c.amount >= 10)).toBe(true);
        expect(herderStanding(g, e.empireId)).toBe(standing - 8);
        expect(rimHerdersState(g).kills.some((k) => k.empireId === e.empireId && k.herdId === herd.id)).toBe(true);
        // Herd goods count as rim goods only with the rim trader flag.
        expect(rimGoodIds(g).some((id) => ids.includes(id))).toBe(false);
        g.scenario!.flags.rimTrader = true;
        try {
            for (const id of ids) expect(rimGoodIds(g)).toContain(id);
        } finally {
            delete g.scenario!.flags.rimTrader;
        }
    });
});

describe('19j rim herders — (4) drovers and guides', () => {
    it('good standing brings a drover (herds let its fleet pass) and a guide (rimGuideAboard); they leave when it collapses', () => {
        const g = shared.galaxy;
        const st = rimHerdersState(g);
        const e = aiEmpires(g)[0];
        st.standing[e.empireId] = 30;
        offerCharacters(g);
        const mine = st.characters.filter((c) => c.empireId === e.empireId);
        expect(mine.map((c) => c.kind).sort()).toEqual(['drover', 'guide']);
        const drover = mine.find((c) => c.kind === 'drover')!.character;
        const guide = mine.find((c) => c.kind === 'guide')!.character;
        expect(drover.empire).toBe(e);
        expect(empireMessages(e).some((m) => m.messageType === EmpireMessageType.CharacterAppearance)).toBe(true);
        // Put both on ships: a herd that is not docile to e ignores the drover's ship.
        const ship = militaryShip(e) ?? e.builtObjects[0];
        drover.completeLocationTransfer(ship, g);
        guide.completeLocationTransfer(ship, g);
        const wild = rimFaunaState(g).herds.find((h) => h.leader !== null && !h.docileEmpireIds.includes(e.empireId))!;
        expect(droverWithShip(g, ship)).toBe(true);
        expect(scenarioQuery(g, 'creatureIgnoresTarget', false, { creature: wild.leader!, target: ship })).toBe(true);
        expect(rimGuideAboard(g, ship)).toBe(true);
        st.standing[e.empireId] = -5;
        reviewCharactersLeave(g);
        expect(st.characters.some((c) => c.empireId === e.empireId)).toBe(false);
        expect(drover.empire).toBeNull();
        expect(rimGuideAboard(g, ship)).toBe(false);
        expect(scenarioQuery(g, 'creatureIgnoresTarget', false, { creature: wild.leader!, target: ship })).toBe(false);
    });
});

describe('19j rim herders — (5) protectorate, conquest, espionage; (7) AI path', () => {
    it('protecting a range brings the offer; a cautious AI accepts, an aggressive one declines; tribute in herd goods', () => {
        const g = shared.galaxy;
        const st = rimHerdersState(g);
        const now = galaxyStarDate(g);
        const hc = freeColonies(g)[0];
        const idx = st.colonies.indexOf(hc);
        const ais = aiEmpires(g);
        for (const e of ais) {
            hc.neighbourSince[e.empireId] = now - 4 * YEAR_LENGTH;
            st.kills = st.kills.filter((k) => k.empireId !== e.empireId);
        }
        const offers = rimHerdersProtectorateOffers(g);
        expect(offers).toBe(1);
        const offeredTo = ais.find((e) => hc.offered.includes(e.empireId))!;
        const prefers = empirePrefersProtectorate(g, offeredTo);
        expect(prefers).toBe(raceCautionLevel(g, offeredTo.dominantRace!) >= raceAggressionLevel(g, offeredTo.dominantRace!));
        let protector = offeredTo;
        if (!prefers) {
            expect(hc.status).toBe('free');
            // The player accepts through the decision popup instead.
            protector = g.playerEmpire!;
            hc.neighbourSince[protector.empireId] = now - 4 * YEAR_LENGTH;
            hc.offered = ais.map((e) => e.empireId);
            rimHerdersProtectorateOffers(g);
            const d = pendingScenarioDecisions(g, protector).find((x) => x.context.colonyIndex === idx)!;
            expect(answerScenarioDecision(g, d.id, 'accept')).toBe(true);
        }
        expect(hc.status).toBe('protectorate');
        const herder = hc.colony.empire!;
        expect(herder.dominantRace?.name).toBe(HERDER_RACE);
        expect(herder.empireId).toBe(hc.herderEmpireId);
        expect(obtainDiplomaticRelation(protector, herder).type).toBe(DiplomaticRelationType.Protectorate);
        for (const h of herderColonyHerds(g, hc)) {
            expect(h.docileEmpireIds).toContain(herder.empireId);
            expect(h.docileEmpireIds).toContain(protector.empireId);
        }
        expect(empireHasHerding(g, herder)).toBe(true);
        // Harvest now fills the herder empire's stock; tribute moves half of it to the protector's space port nearest
        // the herders (its capital without a port), where it enters normal trade.
        rimHerdersHarvest(g);
        const id = harvestResourceIds(g)[0];
        const ports = protector.spacePorts.filter((p) => !p.hasBeenDestroyed && p.isSpacePort && p.cargo !== null);
        const near = ports.sort((a, b) => g.calculateDistanceSquared(hc.colony.xpos, hc.colony.ypos, a.xpos, a.ypos) - g.calculateDistanceSquared(hc.colony.xpos, hc.colony.ypos, b.xpos, b.ypos))[0];
        const destCargo = near !== undefined ? near.cargo! : protector.capital!.cargo!;
        const held = destCargo.items.find((c) => c.commodity.resourceId === id && c.empire === protector)?.amount ?? 0;
        expect(rimHerdersTribute(g)).toBeGreaterThan(0);
        // A herder colony is never handed over without conquest (ruins' lost colony, colony ships, AcquireHabitat).
        expect(scenarioQuery(g, 'peacefulColonyTakeoverAllowed', true, { habitat: hc.colony, empire: protector })).toBe(false);
        expect(destCargo.items.find((c) => c.commodity.resourceId === id && c.empire === protector)!.amount).toBeGreaterThan(held);
    });

    it('conquest turns the herds feral toward the conqueror; stolen herding domesticates one herd a year', () => {
        const g = shared.galaxy;
        const hc = freeColonies(g)[0];
        expect(hc).toBeDefined();
        const conqueror = aiEmpires(g).find((e) => !empirePrefersProtectorate(g, e)) ?? aiEmpires(g)[0];
        const herds = herderColonyHerds(g, hc);
        takeOwnershipOfColonyFull(g, conqueror, hc.colony, conqueror, false, false);
        expect(hc.status).toBe('conquered');
        expect(hc.conquerorId).toBe(conqueror.empireId);
        expect(hc.feralUntil).toBeGreaterThan(galaxyStarDate(g));
        for (const h of herds) {
            expect(h.docileEmpireIds).toEqual([]);
            if (h.leader !== null) expect(h.leader.attackRange).toBeGreaterThan(1500);
        }
        expect(herds.some((h) => h.migration !== null && conqueror.colonies.some((c) => c.systemIndex === h.migration!.toSystemIndex))).toBe(true);
        expect(herderStanding(g, conqueror.empireId)).toBeLessThan(-50);
        // Feral herds ignore drovers of the conqueror (hostility overrides).
        const ship = militaryShip(conqueror) ?? conqueror.builtObjects[0];
        expect(scenarioQuery(g, 'creatureIgnoresTarget', true, { creature: herds[0].leader!, target: ship })).toBe(false);
        // Espionage: StealTechData against the herder protectorate grants herding.
        const herderEmpire = g.empires.find((e) => e !== null && e.dominantRace?.name === HERDER_RACE)!;
        const thief = aiEmpires(g).find((e) => e !== conqueror) ?? conqueror;
        expect(empireHasHerding(g, thief)).toBe(false);
        scenarioEmit(g, 'intelMissionCompleted', { empire: thief, mission: { type: IntelligenceMissionType.StealTechData, targetEmpire: herderEmpire }, outcome: null });
        expect(empireHasHerding(g, thief)).toBe(true);
        const year = gameYear(galaxyStarDate(g));
        const docileBefore = rimFaunaState(g).herds.filter((h) => h.docileEmpireIds.includes(thief.empireId)).length;
        rimHerdersDomesticate(g, year);
        rimHerdersDomesticate(g, year); // once per year
        expect(rimFaunaState(g).herds.filter((h) => h.docileEmpireIds.includes(thief.empireId)).length).toBe(docileBefore + 1);
    });

    it('AI: aggressive neighbours move on free herder colonies (attack mission), cautious ones do not', () => {
        const game = createScenarioGame(base, { scenario: 'rim-herders', params: PARAMS }).game;
        const g = game.galaxy;
        const hc = freeColonies(g)[0];
        const ais = aiEmpires(g);
        for (const e of ais) hc.neighbourSince[e.empireId] = galaxyStarDate(g);
        const aggressive = ais.filter((e) => !empirePrefersProtectorate(g, e));
        const orders = rimHerdersAiConquest(g);
        expect(orders).toBeLessThanOrEqual(1);
        if (aggressive.length === 0) expect(orders).toBe(0);
        expect(rimHerdersState(g).stats.conquestOrders).toBe(orders);
    }, 600000);
});

describe('19j rim herders — (6) migration-season warnings', () => {
    it('friendly empires are warned; warships left in the corridor cost standing and turn the herds on them', () => {
        const game = createScenarioGame(base, { scenario: 'rim-herders', params: PARAMS }).game;
        const g = game.galaxy;
        const st = rimHerdersState(g);
        const hc = freeColonies(g)[0];
        const e = aiEmpires(g).find((x) => militaryShip(x) !== null)!;
        st.standing[e.empireId] = 5;
        hc.neighbourSince[e.empireId] = galaxyStarDate(g);
        const year = gameYear(galaxyStarDate(g));
        expect(rimHerdersWarn(g, year)).toBeGreaterThanOrEqual(1);
        expect(hc.warned).toContain(e.empireId);
        const warning = empireMessages(e).find((m) => m.messageType === EmpireMessageType.RemoveForcesFromSystem);
        expect(warning).toBeDefined();
        // Sent by the herders' empire, so the AI's faithful RemoveMilitaryForcesFromSystem can weigh the requester.
        expect(warning!.sender).toBe(hc.colony.empire);
        const herd = herderColonyHerds(g, hc)[0];
        const ship = militaryShip(e)!;
        ship.xpos = herd.leader!.xpos + 800;
        ship.ypos = herd.leader!.ypos;
        expect(rimHerdersSeasonCheck(g, year)).toBe(1);
        expect(herderStanding(g, e.empireId)).toBe(5 - 15);
        expect(hc.hostile.some((h) => h.empireId === e.empireId)).toBe(true);
        expect(scenarioQuery(g, 'creatureIgnoresTarget', true, { creature: herd.leader!, target: ship })).toBe(false);
        // The leader (raised attack range) hunts the violator's warship.
        expect(herd.leader!.attackRange).toBeGreaterThan(1500);
        expect(herdMembers(herd).some((c) => c.currentTarget === ship)).toBe(true);
        // The AI answers the warning in its message pass (this crashed with a null sender).
        expect(() => processMessages(g, e)).not.toThrow();
    }, 600000);
});

function saveText(game: Game): string {
    const time = new GalaxyTime();
    time.togglePause();
    time.advance(game.galaxy.nowMs);
    return serializeGame(game as never, time, { ...defaultStartGameOptions(), seed: 1, scenario: { id: 'rim-herders', flags: { rimHerders: true, rimFauna: true }, params: PARAMS } });
}

describe('19j rim herders — faithful path, save', () => {
    it('flag off: no package code runs (the same run as the overlay without the flag)', () => {
        const withFlag = createScenarioGame(base, { scenario: 'rim-herders', flags: { rimHerders: false } }).game;
        const full = loadScenarioOverlayFs('rim-herders');
        const noFlag: ScenarioOverlay = { ...full, manifest: { ...full.manifest, flags: full.manifest.flags.filter((f) => f.name !== 'rimHerders') } };
        const ref = createScenarioGame(base, { scenario: noFlag }).game;
        runGameSeconds(withFlag.galaxy, 60);
        runGameSeconds(ref.galaxy, 60);
        expect('rimHerders' in withFlag.galaxy.scenario!.state).toBe(false);
        expect(withFlag.galaxy.independentColonies.some((h) => h.population.dominantRace?.name === HERDER_RACE)).toBe(false);
        expect(stateDigest(withFlag.galaxy)).toBe(stateDigest(ref.galaxy));
        expect(stateCounts(withFlag.galaxy)).toEqual(stateCounts(ref.galaxy));
        expect(withFlag.galaxy.rnd.drawCount).toBe(ref.galaxy.rnd.drawCount);
    }, 600000);

    it('a save with herder state (tamed ships, kills, characters) resumes identically', () => {
        const a = createScenarioGame(base, { scenario: 'rim-herders', params: PARAMS }).game;
        runGameSeconds(a.galaxy, 20);
        const st = rimHerdersState(a.galaxy);
        const e = aiEmpires(a.galaxy)[0];
        st.standing[e.empireId] = 30;
        offerCharacters(a.galaxy);
        const herd = herderColonyHerds(a.galaxy, st.colonies[0])[0];
        scenarioEmit(a.galaxy, 'creatureKilled', { creature: herd.followers[0] ?? herd.leader!, killer: null, empire: e });
        const text = saveText(a);
        const loaded = deserializeGame(text, scenarioGameData(base, 'rim-herders')).game;
        const lst = rimHerdersState(loaded.galaxy);
        expect(lst.colonies.length).toBe(st.colonies.length);
        expect(lst.colonies[0].colony.name).toBe(st.colonies[0].colony.name);
        expect(lst.characters.map((c) => [c.kind, c.character.name])).toEqual(st.characters.map((c) => [c.kind, c.character.name]));
        expect(lst.kills).toEqual(st.kills);
        expect(lst.tamed.length).toBe(st.tamed.length);
        runGameSeconds(a.galaxy, 120);
        runGameSeconds(loaded.galaxy, 120);
        expect(stateDigest(loaded.galaxy)).toBe(stateDigest(a.galaxy));
        const summary = (g: Galaxy): string =>
            JSON.stringify([rimHerdersState(g).stats, rimHerdersState(g).standing, rimHerdersState(g).colonies.map((c) => [c.status, c.herdIds, c.colony.cargo?.items.map((x) => [x.commodity.resourceId, x.amount])])]);
        expect(summary(loaded.galaxy)).toBe(summary(a.galaxy));
    }, 600000);
});

describe('19j rim herders — husbandry: regrowth, maturity, bred traits, stampede, herd-good demand', () => {
    it('a herdless colony regrows a young herd; herds mature yearly; bred traits unlock with maturity', () => {
        const game = createScenarioGame(base, { scenario: 'rim-herders', params: PARAMS }).game;
        const g = game.galaxy;
        const st = rimHerdersState(g);
        const hc = freeColonies(g)[0];
        // Wipe the colony's herds: the next yearly pass marks it herdless, rimHerdersRegrowYears later it regrows.
        for (const h of herderColonyHerds(g, hc)) for (const c of herdMembers(h)) c.completeTeardown();
        hc.herdIds = [];
        rimHerdersHusbandryYear(g);
        expect(hc.herdlessSince).toBeDefined();
        hc.herdlessSince = galaxyStarDate(g) - herderParam(g, 'rimHerdersRegrowYears') * YEAR_LENGTH;
        rimHerdersHusbandryYear(g);
        const herds = herderColonyHerds(g, hc);
        expect(herds.length).toBe(1);
        expect(st.stats.regrown).toBe(1);
        const herd = herds[0];
        expect(herd.docileEmpireIds).toContain(hc.colony.empire!.empireId);
        for (const c of herdMembers(herd)) expect(c.size).toBe(HERD_YOUNG_SIZE);
        // Maturity: Size grows, AttackStrength = Size / 20 and DamageKillThreshhold = Size × 1.4 follow.
        const leader = herd.leader!;
        matureHerd(g, herd, false);
        expect(leader.size).toBeGreaterThan(HERD_YOUNG_SIZE);
        expect(leader.attackStrength).toBe(Math.trunc(leader.size / 20));
        expect(leader.damageKillThreshold).toBe(Math.trunc(leader.size * 1.4));
        expect(herderArmorPierce(g, leader)).toBe(0);
        for (let i = 0; i < 40; i++) matureHerd(g, herd, false);
        expect(leader.size).toBe(600);
        expect(leader.attackStrength).toBe(30);
        expect(leader.damageKillThreshold).toBe(840);
        expect(leader.healRate).toBeCloseTo(HEAL_RATE, 5);
        expect(herderArmorPierce(g, leader)).toBe(herderParam(g, 'rimHerdersPierceShare'));
        // The armour-pierce hook: a mature herd member's hit partly skips the armour pass.
        const e = aiEmpires(g)[0];
        const ship = militaryShip(e) ?? e.builtObjects[0];
        expect(scenarioQuery(g, 'creatureArmorPierce', 0, { creature: leader, target: ship })).toBe(herderParam(g, 'rimHerdersPierceShare'));
        // Conquered herds do not mature.
        hc.status = 'conquered';
        const before = herdMembers(herd).map((c) => c.size);
        rimHerdersHusbandryYear(g);
        expect(herdMembers(herd).map((c) => c.size)).toEqual(before);
        expect(herderArmorPierce(g, leader)).toBe(0);
    }, 600000);

    it('an attack on a herder colony rallies wild herds nearby (cooldown; never the protector); herd goods get their own luxury slot', () => {
        const game = createScenarioGame(base, { scenario: 'rim-herders', params: { ...PARAMS, rimHerdersStampedeRange: 1e9 } }).game;
        const g = game.galaxy;
        const st = rimHerdersState(g);
        const hc = freeColonies(g)[0];
        const e = aiEmpires(g).find((x) => militaryShip(x) !== null)!;
        const ship = militaryShip(e)!;
        herderColonyAttacked(g, hc, ship);
        expect(st.stats.stampedes).toBe(1);
        const rallied = (st as { rallies?: { herdId: number; attackerId: number }[] }).rallies ?? [];
        expect(rallied.length).toBeGreaterThan(0);
        expect(rallied.every((r) => r.attackerId === e.empireId)).toBe(true);
        for (const r of rallied) expect(rimHerdersState(g).colonies.some((c) => c.herdIds.includes(r.herdId))).toBe(false);
        // Cooldown: a second attack right away rallies no one new.
        herderColonyAttacked(g, hc, ship);
        expect(st.stats.stampedes).toBe(1);
        // Never against a friendly empire.
        const hc2 = freeColonies(g)[1] ?? hc;
        hc2.stampedeReadyAt = 0;
        st.standing[e.empireId] = 30;
        hc2.neighbourSince[e.empireId] = galaxyStarDate(g);
        const n = st.stats.stampedes;
        herderColonyAttacked(g, hc2, ship);
        expect(st.stats.stampedes).toBe(n);
        // The rally steers the wild herds toward the colony (hyper travel on while far).
        runGameSeconds(g, 30);
        // Herd goods: ordered on their own slot by colonies of empires that explored a herder colony.
        const ids = harvestResourceIds(g);
        const knows = aiEmpires(g).find((x) => st.colonies.some((c) => x.visibility.checkSystemExplored(c.colony.systemIndex)));
        if (knows !== undefined) expect(scenarioQuery(g, 'extraLuxuryOrders', [], { empire: knows, habitat: knows.capital! })).toEqual(ids);
        st.standing[e.empireId] = -1;
        expect(scenarioQuery(g, 'extraLuxuryOrders', [], { empire: e, habitat: e.capital! })).toEqual([]);
    }, 600000);
});
