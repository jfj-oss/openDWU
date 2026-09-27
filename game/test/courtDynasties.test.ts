// 19n court & dynasties, package 1 (tasks/19-mod-layer-scenarios.md §19n): houses and prestige, each council seat's
// effect, seatless ambition, a faction's ultimatum conceded / refused, election / primogeniture-with-regency / crisis
// successions, legitimacy scaling the 19d1 plot chance, flags-off byte identity and a save round trip.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGameRun } from './helpers/gameCache';
import { createScenarioGame } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Character } from '../src/sim/characters';
import { CharacterRole, captainBonuses, generateNewCharacter, getEmpireCharacters, reviewCaptainBonuses } from '../src/sim/characters';
import { performChangeLeader } from '../src/sim/characterRuntime';
import { runGameSeconds } from '../src/sim/tick/harness';
import { stateDigest } from '../src/sim/tick/digest';
import { scenarioEmit, scenarioQuery } from '../src/sim/scenario/hooks';
import { pendingScenarioDecisions } from '../src/sim/scenario/decisions';
import { runPlayerCommand } from '../src/sim/player/playerCommands';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { DiplomaticRelationType, obtainEmpireEvaluation } from '../src/sim/diplomacy';
import { recalculateAnnualTaxRevenue } from '../src/sim/forceStructure';
import { canPlot, plotScore, politicsEntry, politicsState, politicsYear, reviewEmpirePlots, empireInstability, isPoliticalEmpire } from '../src/sim/scenario/emergent/politics';
import { colonyLedger, empireSecurityStrength, securityStrength } from '../src/sim/scenario/security/security';
import {
    applyChancellor,
    appointToSeat,
    chancellorAttitudeBonus,
    claimScore,
    courtState,
    designateHeir,
    ensureHouse,
    feudIncident,
    formFaction,
    houseIndexFor,
    houseOf,
    leaderLegitimacy,
    legitimacyFactorOf,
    marshalBonusPoints,
    peekCourtState,
    plotChanceFactor,
    plotScoreFactor,
    reviewRegency,
    rulingHouse,
    seatlessAmbition,
    seatSkill,
    spymasterStrengthBonus,
    stewardTaxFactor,
    successionLaw,
    yearlyPrestige,
    empireHouses,
    type Faction,
} from '../src/sim/scenario/court/court';
import { successionLawFor } from '../src/sim/scenario/court/courtData';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const SC = 'court-dynasties';
/** Every flag the scenario (with its includes) carries, off. */
const ALL_OFF: Record<string, boolean> = {
    courtDynasties: false,
    courtIntrigue: false,
    internalSecurity: false,
    internalPolitics: false,
    livingCharacters: false,
    resourceCrises: false,
    espionageConsequences: false,
    refugees: false,
    rimFauna: false,
    cult: false,
    doppelgangers: false,
    hive: false,
    greyTide: false,
    threatCorporateCoup: false,
};
const ON = { ...ALL_OFF, courtDynasties: true, internalPolitics: true, internalSecurity: true };

function courtGame(params: Record<string, number> = {}): { game: Game; gameData: GameData } {
    return createScenarioGame(base, { scenario: SC, flags: ON, params: { cultSeedYear: 200, ...params } });
}

function newChar(g: Galaxy, e: Empire, role: CharacterRole): Character {
    return generateNewCharacter(g, e, role, e.capital!).character;
}

function courtiers(e: Empire): Character[] {
    return getEmpireCharacters(e).filter((c) => c.active && c.role !== CharacterRole.Leader);
}

function politicalEmpires(g: Galaxy): Empire[] {
    return g.empires.filter((e) => isPoliticalEmpire(g, e));
}

describe('flags off = faithful game', () => {
    it('the scenario with every flag off runs byte-identical to the plain seed-1 game', () => {
        const ref = cachedTickGameRun(base, { seconds: 900 });
        const { game } = createScenarioGame(base, { scenario: SC, flags: ALL_OFF });
        expect(Object.keys(game.galaxy.scenario!.flags).sort()).toEqual(Object.keys(ALL_OFF).sort());
        runGameSeconds(game, 900);
        expect(stateDigest(game.galaxy)).toBe(stateDigest(ref.game.galaxy));
        expect(game.galaxy.rnd.drawCount).toBe(ref.game.galaxy.rnd.drawCount);
        expect('court' in game.galaxy.scenario!.state).toBe(false);
    }, 1200000);
});

describe('1. houses', () => {
    it('every character gets a house (deterministic by name); the leader founds the ruling house; prestige moves', () => {
        const g = courtGame().game.galaxy;
        const st = peekCourtState(g)!;
        expect(st.seeded).toBe(true);
        for (const e of politicalEmpires(g)) {
            const houses = empireHouses(g, e);
            expect(houses.length).toBe(4);
            const ruling = rulingHouse(g, e)!;
            expect(ruling.founder).toBe(e.leader);
            expect(houseOf(g, e.leader!)).toBe(ruling);
            expect(ruling.name).toBe(e.leader!.name.trim().split(/\s+/).pop());
            expect(ruling.rivals.length).toBe(1);
            for (const c of courtiers(e)) {
                const h = houseOf(g, c)!;
                expect(h).not.toBeNull();
                if (c !== ruling.founder) expect(h).toBe(houses.sort((a, b) => a.id - b.id)[houseIndexFor(c, e, houses.length)]);
            }
        }
        const e = g.playerEmpire!;
        const ruling = rulingHouse(g, e)!;
        const p0 = ruling.prestige;
        expect(p0).toBe(50);
        // A lost colony: −5.
        const other = politicalEmpires(g).find((x) => x !== e)!;
        scenarioEmit(g, 'colonyOwnerChanged', { colony: e.colonies[0], from: e, to: other });
        expect(ruling.prestige).toBe(p0 - 5);
        // A war won (net colonies taken during the war): +10 for the winner's ruling house, −5 for the loser's.
        const otherRuling = rulingHouse(g, other)!;
        const o0 = otherRuling.prestige;
        courtState(g).wars.push({ a: e, b: other, net: 2 });
        scenarioEmit(g, 'diplomaticRelationChanged', { empire: e, other, from: DiplomaticRelationType.War, to: DiplomaticRelationType.None });
        expect(ruling.prestige).toBe(p0 + 5);
        expect(otherRuling.prestige).toBe(o0 - 5);
        // A wonder completed and a long reign: +5 and +2.
        e.trackedWonders = [...(e.trackedWonders ?? []), { colony: e.capital!, facilityId: 999, buildDate: galaxyStarDate(g) + 1 }];
        const year = politicsYear(g);
        courtState(g).reignStart.set(e, year - 5);
        yearlyPrestige(g, e, year);
        expect(ruling.prestige).toBe(p0 + 5 + 5 + 2);
        // Counted once.
        courtState(g).reignStart.set(e, year);
        yearlyPrestige(g, e, year);
        expect(ruling.prestige).toBe(p0 + 12);
    }, 600000);

    it('a feud incident costs loyalty and puts a "feud" term into the stability ledger', () => {
        const g = courtGame().game.galaxy;
        const e = g.playerEmpire!;
        const gov = newChar(g, e, CharacterRole.ColonyGovernor);
        const h = houseOf(g, gov)!;
        const other = empireHouses(g, e).find((x) => x !== h)!;
        expect(gov.location).toBe(e.capital);
        const loyal0 = politicsEntry(g, gov).loyalty;
        feudIncident(g, e, h, other, politicsYear(g));
        expect(politicsEntry(g, gov).loyalty).toBe(loyal0 - 5);
        const feud = colonyLedger(g, e.capital!).entries.find((x) => x.cause === 'feud');
        expect(feud?.value).toBe(-3);
    }, 600000);
});

describe('2. council', () => {
    it('each seat has its number: spymaster, chancellor, marshal, steward, magistrate', () => {
        const g = courtGame().game.galaxy;
        const e = g.playerEmpire!;
        // Spymaster → the 19m counter-intelligence strength.
        const agent = getEmpireCharacters(e).find((c) => c.active && c.role === CharacterRole.IntelligenceAgent)!;
        expect(empireSecurityStrength(g, e)).toBe(securityStrength(e));
        expect(runPlayerCommand(g, e, 'courtAppoint', ['spymaster', agent])).toEqual({ ok: true });
        expect(spymasterStrengthBonus(g, e)).toBe(agent.counterEspionageFactored * 0.5);
        expect(empireSecurityStrength(g, e)).toBe(securityStrength(e) + agent.counterEspionageFactored * 0.5);
        // An agent only: a governor is refused.
        const gov = newChar(g, e, CharacterRole.ColonyGovernor);
        expect(appointToSeat(g, e, 'spymaster', gov).ok).toBe(false);

        // Chancellor → other empires' IncidentEvaluation of us, yearly.
        const amb = newChar(g, e, CharacterRole.Ambassador);
        appointToSeat(g, e, 'chancellor', amb);
        const bonus = 2 * (1 + Math.max(0, amb.diplomacy) / 20);
        expect(chancellorAttitudeBonus(g, e)).toBeCloseTo(bonus, 10);
        let other = politicalEmpires(g).find((x) => x !== e && e.diplomaticRelations.byEmpire(x) !== null && e.diplomaticRelations.byEmpire(x)!.type !== DiplomaticRelationType.NotMet);
        if (other === undefined) {
            other = politicalEmpires(g).find((x) => x !== e)!;
            e.diplomaticRelations.byEmpire(other)!.type = DiplomaticRelationType.None;
        }
        const ev = obtainEmpireEvaluation(g, other, e);
        const before = ev.incidentEvaluationRaw;
        applyChancellor(g, e);
        expect(ev.incidentEvaluationRaw).toBeCloseTo(Math.min(80, before + bonus), 10);

        // Marshal → captain repair / damage control of fleet ships.
        const adm = newChar(g, e, CharacterRole.FleetAdmiral);
        appointToSeat(g, e, 'marshal', adm);
        const pts = Math.round(10 * (1 + Math.max(0, Math.min(100, seatSkill(adm, 'marshal'))) / 100));
        expect(marshalBonusPoints(g, e)).toBe(pts);
        const ship = e.builtObjects.find((b) => (b.characters === null || b.characters.length === 0) && !b.shipGroup)!;
        reviewCaptainBonuses(ship);
        expect(captainBonuses(ship)!.repair).toBe(100);
        ship.shipGroup = {} as never;
        reviewCaptainBonuses(ship);
        expect(captainBonuses(ship)!.repair).toBe(100 + pts);
        expect(captainBonuses(ship)!.damageControl).toBe(100 + pts);
        ship.shipGroup = null as never;
        reviewCaptainBonuses(ship);

        // Steward → the ported tax revenue (Habitat.cs 6083 RecalculateAnnualTaxRevenue).
        const cap = e.capital!;
        recalculateAnnualTaxRevenue(g, cap);
        const rev0 = cap.annualTaxRevenue;
        appointToSeat(g, e, 'steward', gov);
        const f = 1 + 0.05 * (1 + Math.max(0, gov.colonyIncome + gov.tradeIncome) / 20);
        expect(stewardTaxFactor(g, e)).toBeCloseTo(f, 12);
        expect(scenarioQuery(g, 'colonyTaxRevenue', 1000, { habitat: cap, empire: e })).toBeCloseTo(1000 * f, 9);
        recalculateAnnualTaxRevenue(g, cap);
        if (rev0 > 0) expect(cap.annualTaxRevenue).toBeGreaterThan(rev0);

        // Magistrate → a stability term on every colony.
        const mag = newChar(g, e, CharacterRole.Scientist);
        appointToSeat(g, e, 'magistrate', mag);
        const term = colonyLedger(g, cap).entries.find((x) => x.cause === 'magistrate');
        expect(term?.value).toBeCloseTo(2 * (1 + Math.max(0, seatSkill(mag, 'magistrate')) / 20), 10);
        // One seat per character: the steward moved to magistrate vacates the steward seat.
        appointToSeat(g, e, 'magistrate', gov);
        expect(stewardTaxFactor(g, e)).toBe(1);
    }, 600000);

    it('a powerful noble without a seat gains ambition yearly; a seated one does not', () => {
        const g = courtGame().game.galaxy;
        const e = g.playerEmpire!;
        const a = newChar(g, e, CharacterRole.ColonyGovernor);
        const b = newChar(g, e, CharacterRole.Ambassador);
        politicsEntry(g, a).ambition = 60;
        politicsEntry(g, b).ambition = 60;
        appointToSeat(g, e, 'chancellor', b);
        seatlessAmbition(g, e);
        expect(politicsEntry(g, a).ambition).toBe(65);
        expect(politicsEntry(g, b).ambition).toBe(60);
    }, 600000);
});

describe('3. character factions', () => {
    function faction(g: Galaxy, e: Empire): Faction {
        const ruling = rulingHouse(g, e)!;
        const other = empireHouses(g, e).find((h) => h !== ruling)!;
        const members = [newChar(g, e, CharacterRole.ColonyGovernor), newChar(g, e, CharacterRole.Scientist)];
        for (const c of members) {
            courtState(g).members.set(c, other.id);
            politicsEntry(g, c).loyalty = 10;
            politicsEntry(g, c).ambition = 70;
        }
        return formFaction(g, e, members);
    }

    it('conceded: the demand is applied (a seat for its leader) and its members regain loyalty', () => {
        const g = courtGame().game.galaxy;
        const e = g.playerEmpire!;
        const f = faction(g, e);
        const d = pendingScenarioDecisions(g, e).find((x) => x.kind === 'court.faction')!;
        expect(d).toBeDefined();
        f.demand = { kind: 'seat', seat: 'steward' };
        expect(runPlayerCommand(g, e, 'answerScenarioDecision', [d.id, 'concede'])).toBe(true);
        expect(courtState(g).seats.get(e)!.steward).toBe(f.leader);
        for (const c of f.members) expect(politicsEntry(g, c).loyalty).toBe(25);
        expect(courtState(g).factions.length).toBe(0);
    }, 600000);

    it('refused: the faction backs a plot — its members weigh more and the plot chance rises', () => {
        const g = courtGame().game.galaxy;
        const e = g.playerEmpire!;
        const f = faction(g, e);
        const chance0 = plotChanceFactor(g, e);
        const score0 = plotScoreFactor(g, e, f.leader);
        const d = pendingScenarioDecisions(g, e).find((x) => x.kind === 'court.faction')!;
        expect(runPlayerCommand(g, e, 'answerScenarioDecision', [d.id, 'refuse'])).toBe(true);
        expect(f.state).toBe('backing');
        expect(plotChanceFactor(g, e)).toBeCloseTo(chance0 * 1.5, 12);
        expect(plotScoreFactor(g, e, f.leader)).toBeCloseTo(score0 * 1.5, 12);
        for (const c of f.members) expect(politicsEntry(g, c).loyalty).toBe(5);
    }, 600000);

    it('an AI empire answers at once by its leader\'s traits', () => {
        const g = courtGame().game.galaxy;
        const e = politicalEmpires(g).find((x) => x !== g.playerEmpire)!;
        const f = faction(g, e);
        expect(pendingScenarioDecisions(g, e).length).toBe(0);
        const leader = e.leader!;
        const conceded = !courtState(g).factions.includes(f);
        expect(conceded || f.state === 'backing').toBe(true);
        void leader;
    }, 600000);
});

describe('4. succession', () => {
    it('the law table follows governments.txt', () => {
        expect(successionLawFor(2, 0)).toBe('election'); // Republic / Democracy
        expect(successionLawFor(1, 2)).toBe('acclamation'); // Military Dictatorship
        expect(successionLawFor(1, 1)).toBe('primogeniture'); // Monarchy / Feudalism
        expect(successionLawFor(0, 3)).toBe('election'); // Technocracy
        expect(successionLawFor(0, 0)).toBe('primogeniture'); // Hive Mind
    });

    it('an election: the best claim takes the throne, lawful legitimacy', () => {
        const g = courtGame({ courtSuccessionLaw: 2, courtCrisisPct: 1000 }).game.galaxy;
        const e = g.playerEmpire!;
        newChar(g, e, CharacterRole.ColonyGovernor);
        newChar(g, e, CharacterRole.Ambassador);
        expect(successionLaw(g, e)).toBe('election');
        let best: Character | null = null;
        for (const c of courtiers(e).filter((x) => canPlot(x))) if (best === null || claimScore(g, c) > claimScore(g, best)) best = c;
        const old = e.leader;
        const leader = performChangeLeader(g, e);
        expect(leader).toBe(best);
        expect(e.leader).toBe(best);
        expect(old!.active).toBe(false);
        const ev = courtState(g).events.at(-1)!;
        expect(ev.kind).toBe('succession');
        expect(leaderLegitimacy(g, e)).toBeCloseTo(Math.min(100, 50 + houseOf(g, best!)!.prestige / 5 + 10), 10);
    }, 600000);

    it('primogeniture with a young heir: a regent rules, then the heir comes of age', () => {
        const g = courtGame({ courtSuccessionLaw: 1, courtCrisisPct: 1000 }).game.galaxy;
        const e = g.playerEmpire!;
        const ruling = rulingHouse(g, e)!;
        const heir = newChar(g, e, CharacterRole.Scientist);
        courtState(g).members.set(heir, ruling.id);
        designateHeir(g, e, heir);
        const regent = newChar(g, e, CharacterRole.Ambassador);
        appointToSeat(g, e, 'chancellor', regent);
        const leader = performChangeLeader(g, e);
        expect(leader).toBe(regent);
        const r = courtState(g).regencies.get(e)!;
        expect(r.heir).toBe(heir);
        expect(r.regent).toBe(regent);
        const lawful = Math.min(100, 50 + ruling.prestige / 5 + 10);
        expect(leaderLegitimacy(g, e)).toBeCloseTo(lawful - 20, 10);
        expect(courtState(g).events.at(-1)!.kind).toBe('regency');
        // Not yet of age; then of age: the heir is crowned.
        reviewRegency(g, e, r.until - 1);
        expect(e.leader).toBe(regent);
        reviewRegency(g, e, r.until);
        expect(e.leader).toBe(heir);
        expect(heir.role).toBe(CharacterRole.Leader);
        expect(courtState(g).regencies.has(e)).toBe(false);
        expect(leaderLegitimacy(g, e)).toBeGreaterThan(lawful - 20);
    }, 600000);

    it('a succession crisis: two houses back rival claimants; the loser\'s house feuds with the winner\'s', () => {
        const g = courtGame({ courtSuccessionLaw: 1, courtCrisisPct: 0 }).game.galaxy;
        const e = g.playerEmpire!;
        const ruling = rulingHouse(g, e)!;
        const other = empireHouses(g, e).find((h) => h !== ruling && !h.rivals.includes(ruling.id))!;
        const heir = newChar(g, e, CharacterRole.Scientist);
        const rival = newChar(g, e, CharacterRole.ColonyGovernor);
        // Every other courtier sits in the ruling house: the rival claimant is the only one of another house.
        for (const c of courtiers(e)) courtState(g).members.set(c, ruling.id);
        courtState(g).members.set(rival, other.id);
        courtState(g).born.clear(); // adults: no regency
        designateHeir(g, e, heir);
        const feuds0 = courtState(g).feuds.length;
        const leader = performChangeLeader(g, e)!;
        const ev = courtState(g).events.at(-1)!;
        expect(ev.kind).toBe('crisis');
        expect([heir, rival]).toContain(leader);
        expect(other.rivals).toContain(ruling.id);
        expect(courtState(g).feuds.length).toBe(feuds0 + 1);
        const wh = houseOf(g, leader)!;
        expect(rulingHouse(g, e)).toBe(wh);
        expect(leaderLegitimacy(g, e)).toBeCloseTo(Math.min(100, 50 + wh.prestige / 5 + 10) - 15, 10);
    }, 600000);
});

describe('9. legitimacy', () => {
    it('multiplies the 19d1 plot chance (the same roll fires at legitimacy 0, not at 100)', () => {
        expect(legitimacyFactorOf(0)).toBe(1.5);
        expect(legitimacyFactorOf(50)).toBe(1);
        expect(legitimacyFactorOf(100)).toBe(0.5);
        const run = (legit: number): string | null => {
            const g = courtGame().game.galaxy;
            const e = g.playerEmpire!;
            const c = newChar(g, e, CharacterRole.Scientist);
            ensureHouse(g, c);
            for (const x of courtiers(e)) politicsEntry(g, x).ambition = 0;
            const entry = politicsEntry(g, c);
            entry.ambition = 100;
            entry.loyalty = 0;
            e.leaderChangeInfluence = -1;
            politicsState(g).lastPlotYear.delete(e);
            courtState(g).legitimacy.set(e.leader!, legit);
            const inst = empireInstability(g, e);
            expect(inst).toBeGreaterThan(0);
            const p = plotScore(entry, inst, 1) * plotScoreFactor(g, e, c);
            // A roll just above the chance at legitimacy 50: fails at 100 (×0.5), succeeds at 0 (×1.5).
            const r = p * 0.35 * 1.2;
            (g.rnd as unknown as { nextDouble: () => number }).nextDouble = () => r;
            expect(plotChanceFactor(g, e)).toBe(legitimacyFactorOf(legit));
            return reviewEmpirePlots(g, e, politicsYear(g));
        };
        expect(run(100)).toBeNull();
        expect(run(0)).not.toBeNull();
    }, 900000);
});

describe('save round trip', () => {
    function saveText(game: Game): string {
        const time = new GalaxyTime();
        time.togglePause();
        time.advance(game.galaxy.nowMs);
        return serializeGame(game as never, time, { ...defaultStartGameOptions(), seed: 1, scenario: { id: SC, flags: ON, params: {} } });
    }

    it('houses, seats, heirs, legitimacy and factions survive save / load and the runs match', () => {
        const a = courtGame();
        const g = a.game.galaxy;
        const e = g.playerEmpire!;
        const agent = getEmpireCharacters(e).find((c) => c.active && c.role === CharacterRole.IntelligenceAgent)!;
        appointToSeat(g, e, 'spymaster', agent);
        designateHeir(g, e);
        const text = saveText(a.game);
        const loaded = deserializeGame(text, a.gameData);
        const g2 = loaded.game.galaxy;
        const st1 = courtState(g);
        const st2 = peekCourtState(g2)!;
        expect(st2.houses.map((h) => `${h.id}:${h.name}:${h.prestige}:${h.rivals.join(',')}`)).toEqual(st1.houses.map((h) => `${h.id}:${h.name}:${h.prestige}:${h.rivals.join(',')}`));
        expect(st2.members.size).toBe(st1.members.size);
        expect(st2.seats.get(g2.playerEmpire!)!.spymaster?.name).toBe(agent.name);
        expect(leaderLegitimacy(g2, g2.playerEmpire!)).toBe(leaderLegitimacy(g, e));
        runGameSeconds(a.game, 700);
        runGameSeconds(loaded.game, 700);
        expect(stateDigest(loaded.game.galaxy)).toBe(stateDigest(a.game.galaxy));
        expect(saveText(loaded.game)).toBe(saveText(a.game));
    }, 1200000);
});
