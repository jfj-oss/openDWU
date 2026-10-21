// The Harvest Cycle's corrupted empire (threats/giantworks/corrupted*.ts): the choice (an AI empire, never a human, seeded), the Diet's votes
// against the preparation motions, the wars on the Scar holders and the Severance's builders, the raids on the Severance's freighters, the
// parks at the dormant foundries, the Internal Security lead that exposes it (a confirmed one only), the three endings (exposed, assassinated,
// captured), the Knowledge rows, the save round trip, and the games that must stay untouched (no Age 2, flag off).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Habitat } from '../src/sim/types';
import type { CreateGameOptions, Game } from '../src/sim/game';
import type { BuiltObject } from '../src/sim/builtObject';
import { comboOverlayFs, createScenarioGame } from './helpers/scenarioGame';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import type { StartGameOptions } from '../src/sim/startGameOptions';
import { empireMessages } from '../src/sim/messages';
import { GAME_DAY_LENGTH, scenarioEmit } from '../src/sim/scenario/hooks';
import { scenarioText } from '../src/sim/scenario/messages';
import { CharacterRole, getEmpireCharacters, type Character } from '../src/sim/characters';
import { DiplomaticRelationType, obtainDiplomaticRelation, obtainEmpireEvaluation } from '../src/sim/diplomacy';
import { declareWar } from '../src/sim/diplomacyTick';
import { addHumanSeat, isHumanEmpire, isHumanSeat, setAiSeat, setHumanEmpires } from '../src/sim/humanEmpires';
import { councilState, type Council } from '../src/sim/scenario/emergent/council';
import { dietMotionKindDef, dietState, type DietMotion } from '../src/sim/scenario/charactersVictory/diet/dietState';
import { dietPropose } from '../src/sim/scenario/charactersVictory/diet/diet';
import { dietCouncil } from '../src/sim/scenario/charactersVictory/diet/diet';
import { dietMembership, dietVoteScore } from '../src/sim/scenario/charactersVictory/diet/dietAi';
import { reputationOn } from '../src/sim/scenario/reputation/ledger';
import { securityState, setLeadLevel, securitySlots } from '../src/sim/scenario/security/registry';
import { longNightState, AGE_PREPARATION, type MemoryRecord, type PlaceRec, type ScarRec } from '../src/sim/scenario/threats/giantworks/longNightState';
import { beaconState, type MegaRec } from '../src/sim/scenario/threats/giantworks/beaconState';
import { MOTION_MEGA, MOTION_MEGA_RESUME, peekMega } from '../src/sim/scenario/threats/giantworks/megaStation';
import { MOTION_INSPECT } from '../src/sim/scenario/threats/giantworks/diet';
import { MOTION_EXPOSE, corruptedVoteScore, canExpose } from '../src/sim/scenario/threats/giantworks/corruptedDiet';
import {
    activeCorrupted,
    chooseCorrupted,
    confirmedLeadOf,
    corruptionThing,
    corruptedRowsOf,
    corruptedState,
    corruptedTallyObserver,
    endCorruption,
    isCorrupted,
    leaderOf,
    peekCorrupted,
    pickCorrupted,
    recordAct,
    type CorruptedState,
} from '../src/sim/scenario/threats/giantworks/corrupted';
import { corruptedPass, dormantFoundries, declareCorruptWar, leadRolls, onAssassinated, onCorruptCapitalLost, parkAtFoundries, raidContracts, reviewWars } from '../src/sim/scenario/threats/giantworks/corruptedAi';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { empireShipGroups } from '../src/sim/fleets/shipGroup';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const age3 = (o: CreateGameOptions): CreateGameOptions => ({ ...o, player: { ...o.player, age: 3 }, aiEmpires: o.aiEmpires.map((e) => ({ ...e, age: 3 })) });
const ids = ['threat-framework', 'giantworks', 'characters-victory', 'internal-security'];
const DAY = GAME_DAY_LENGTH;
const FLAGS = { threatGiantworks: true, charactersVictory: true, cvCouncil: true, galacticCouncil: true, internalSecurity: true, gwHarvestCycle: true };

interface Setup {
    game: Game;
    gameData: GameData;
    g: Galaxy;
    me: Empire;
    ais: Empire[];
    /** The corrupted empire (chosen by the module, not the test). */
    corrupt: Empire;
    st: CorruptedState;
}

/** The members of the Diet: every active empire (the galactic council's first sitting, as megaStation's tests). */
function seatDiet(g: Galaxy): void {
    const members = g.empires.filter((e): e is Empire => e !== null && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null && e.active);
    const cs = councilState(g);
    const c: Council = { id: cs.nextId++, name: 'Interstellar Diet', foundedYear: 0, members: [...members], chair: null, motion: null, results: [], blocs: [], coLosses: {}, losses: {}, sanctions: [], threats: [], recognised: [], condemned: {}, splitFrom: 0 };
    cs.councils.push(c);
    dietState(g);
}

/** A seed-1 Giantworks game in Age 2 (the Preparation), the Diet seated, the corrupted empire chosen by the first pass of the Preparation. */
function setup(): Setup {
    const { game, gameData } = createScenarioGame(base, { scenario: comboOverlayFs(ids), flags: FLAGS, options: age3 });
    const g = game.galaxy;
    g.scenario!.flags.gwHarvestCycle = true;
    longNightState(g).age = AGE_PREPARATION;
    seatDiet(g);
    expect(chooseCorrupted(g)).toBe(true);
    const corrupt = activeCorrupted(g)!;
    const me = g.playerEmpire!;
    const ais = g.empires.filter((e): e is Empire => e !== null && e !== g.independentEmpire && e !== me && e.pirateEmpireBaseHabitat === null && e.active && e !== corrupt && !isHumanEmpire(g, e));
    return { game, gameData, g, me, ais, corrupt, st: corruptedState(g) };
}

/** A memory of the Long Night with the given Scar worlds and standing foundries (set before the first pass of a test: the Scar list is read once). */
function remember(g: Galaxy, scars: Habitat[], foundries: PlaceRec[] = []): void {
    const sc: ScarRec[] = scars.map((h) => ({ name: h.name, systemName: g.systems[h.systemIndex]?.systemStar?.name ?? h.name, x: h.xpos, y: h.ypos, fate: 'live', knownToPlayer: false }));
    const mem: MemoryRecord = { age: AGE_PREPARATION, seed: g.randomSeed, fromDate: 0, eliminatedPct: 90, scars: sc, foundries: { located: [], destroyed: [], alive: foundries }, megaStation: { components: {}, blueprintPoints: 0 }, truths: [], player: null, extra: {} };
    longNightState(g).memory = mem;
}

const motion = (g: Galaxy, kind: string, proposer: Empire, target: Empire | null, votes: { empire: Empire; vote: 'yes' | 'no' }[] = []): DietMotion => {
    void g;
    return { id: 1, kind, proposer, target, other: null, colony: null, resourceId: -1, text: 't', votes: votes.map((v) => ({ ...v, weight: 1, score: 0 })), status: 'voting', yes: 0, no: 0 } as DietMotion;
};

/** Makes `human` have met `other` (the pattern is seen only by those who met the empire). */
function meet(human: Empire, other: Empire): void {
    obtainDiplomaticRelation(human, other).type = DiplomaticRelationType.None;
    obtainDiplomaticRelation(other, human).type = DiplomaticRelationType.None;
}

/** The empire among `list` whose capital is nearest to `at`. */
function nearest(s: Setup, at: Habitat, list: Empire[]): Empire {
    const d = (e: Empire): number => (e.capital === null ? Infinity : s.g.calculateDistance(at.xpos, at.ypos, e.capital.xpos, e.capital.ypos));
    return [...list].sort((a, b) => d(a) - d(b) || a.empireId - b.empireId)[0];
}

function atWar(a: Empire, b: Empire): boolean {
    return obtainDiplomaticRelation(a, b).type === DiplomaticRelationType.War;
}

const titlesOf = (e: Empire): string[] => empireMessages(e).map((m) => m.title);

// ---------------------------------------------------------------------------------------------------------------
describe('the choice', () => {
    it('a human is never chosen: with only the players seated in the Diet (and a colony minimum they meet) nothing is corrupted', () => {
        const { game } = createScenarioGame(base, { scenario: comboOverlayFs(ids), flags: FLAGS, options: age3 });
        const g = game.galaxy;
        g.scenario!.flags.gwHarvestCycle = true;
        longNightState(g).age = AGE_PREPARATION;
        g.scenario!.params.corruptMinColonies = 1;
        const humans = g.empires.filter((e): e is Empire => e !== null && isHumanEmpire(g, e) && e.active);
        expect(humans.length).toBeGreaterThan(0);
        const cs = councilState(g);
        cs.councils.push({ id: cs.nextId++, name: 'Interstellar Diet', foundedYear: 0, members: humans, chair: null, motion: null, results: [], blocs: [], coLosses: {}, losses: {}, sanctions: [], threats: [], recognised: [], condemned: {}, splitFrom: 0 });
        dietState(g);
        expect(pickCorrupted(g)).toBeNull();
        expect(chooseCorrupted(g)).toBe(false);
        expect(peekCorrupted(g)!.chosen).toBe(false);
        expect(activeCorrupted(g)).toBeNull();
    }, 600000);

    it('a human seat the AI runs while its player is away is never chosen (the only candidates in the Diet are two such seats)', () => {
        const { game } = createScenarioGame(base, { scenario: comboOverlayFs(ids), flags: FLAGS, options: age3 });
        const g = game.galaxy;
        g.scenario!.flags.gwHarvestCycle = true;
        longNightState(g).age = AGE_PREPARATION;
        g.scenario!.params.corruptMinColonies = 1;
        const me = g.playerEmpire!;
        const other = g.empires.find((e): e is Empire => e !== null && e !== g.independentEmpire && e !== me && e.active && e.pirateEmpireBaseHabitat === null && e.capital !== null && e.colonies.length >= 1)!;
        expect(other).toBeDefined();
        // two human seats, both run by the AI (their players are away): AI branches decide for them, but they stay seats
        setHumanEmpires(g, [me, other]);
        setAiSeat(g, me, true);
        setAiSeat(g, other, true);
        expect(isHumanEmpire(g, other)).toBe(false);
        expect(isHumanSeat(g, other)).toBe(true);
        const cs = councilState(g);
        cs.councils.push({ id: cs.nextId++, name: 'Interstellar Diet', foundedYear: 0, members: [me, other], chair: null, motion: null, results: [], blocs: [], coLosses: {}, losses: {}, sanctions: [], threats: [], recognised: [], condemned: {}, splitFrom: 0 });
        dietState(g);
        expect(pickCorrupted(g)).toBeNull();
        expect(chooseCorrupted(g)).toBe(false);
        expect(peekCorrupted(g)!.chosen).toBe(false);
    }, 600000);

    it('is an AI empire, never a human, and the seed decides it (the same galaxy picks the same empire)', () => {
        const s = setup();
        expect(isHumanEmpire(s.g, s.corrupt)).toBe(false);
        expect(s.corrupt.capital).not.toBeNull();
        expect(s.corrupt.colonies.length).toBeGreaterThanOrEqual(3);
        expect(pickCorrupted(s.g)).toBe(s.corrupt);
        expect(s.st.chosen).toBe(true);
        // a second game of the same seed picks the same empire (the choice draws only its own stream)
        const again = setup();
        expect(again.corrupt.empireId).toBe(s.corrupt.empireId);
        // once chosen it is never chosen again
        expect(chooseCorrupted(s.g)).toBe(false);
    }, 600000);
});

// ---------------------------------------------------------------------------------------------------------------
describe('the Diet votes against the preparation motions', () => {
    it('the corrupted empire scores a preparation motion (the Severance) as a sure no; other empires do not', () => {
        const s = setup();
        const c = dietCouncil(s.g)!;
        const st = dietState(s.g);
        const m = motion(s.g, MOTION_MEGA, s.me, s.me);
        expect(dietVoteScore(s.g, c, st, s.corrupt, m)).toBeLessThanOrEqual(-5);
        expect(dietVoteScore(s.g, c, st, s.corrupt, motion(s.g, MOTION_MEGA_RESUME, s.me, s.me))).toBeLessThanOrEqual(-5);
        // the query is the only change: an unrelated motion is scored as the stock vote
        const inspect = motion(s.g, MOTION_INSPECT, s.me, null);
        expect(corruptedVoteScore(s.g, 37, s.corrupt, MOTION_INSPECT, s.me)).toBe(37);
        void inspect;
        // an AI that is not corrupted is not forced
        expect(corruptedVoteScore(s.g, 37, s.ais[0], MOTION_MEGA, s.me)).toBe(37);
        // the exposure motion too
        expect(corruptedVoteScore(s.g, 80, s.corrupt, MOTION_EXPOSE, s.me)).toBeLessThanOrEqual(-5);
    }, 600000);

    it('a closed session that voted against the preparation motion is a pattern act; a yes is not', () => {
        const s = setup();
        const m = motion(s.g, MOTION_MEGA, s.me, s.me, [{ empire: s.corrupt, vote: 'no' }]);
        corruptedTallyObserver(s.g, m);
        expect(s.st.votes.length).toBe(1);
        expect(s.st.acts).toBe(1);
        corruptedTallyObserver(s.g, motion(s.g, MOTION_MEGA, s.me, s.me, [{ empire: s.corrupt, vote: 'yes' }]));
        expect(s.st.acts).toBe(1);
        corruptedTallyObserver(s.g, motion(s.g, MOTION_INSPECT, s.me, null, [{ empire: s.corrupt, vote: 'no' }]));
        expect(s.st.acts).toBe(1);
    }, 600000);
});

// ---------------------------------------------------------------------------------------------------------------
describe('wars', () => {
    it('declares war on the holder of a Harvest Scar world, with the reason in the news', () => {
        const s = setup();
        const target = s.ais.find((e) => e.colonies.length > 0 && !atWar(e, s.corrupt))!;
        expect(target).toBeDefined();
        remember(s.g, [target.colonies[0]]);
        expect(reviewWars(s.g, s.st, s.corrupt)).toBe(true);
        expect(atWar(s.corrupt, target)).toBe(true);
        expect(s.st.wars.length).toBe(1);
        expect(s.st.wars[0].target).toBe(target.empireId);
        expect(s.st.wars[0].reason.length).toBeGreaterThan(0);
        expect(s.st.acts).toBeGreaterThanOrEqual(1);
    }, 600000);

    it('the daily pass reviews its wars (the first pass of a review month)', () => {
        const s = setup();
        const target = s.ais.find((e) => e.colonies.length > 0 && !atWar(e, s.corrupt))!;
        remember(s.g, [target.colonies[0]]);
        corruptedPass(s.g);
        expect(atWar(s.corrupt, target)).toBe(true);
    }, 600000);

    it('a war on a builder of the Severance is declared the same way; a war already on is not declared again', () => {
        const s = setup();
        const target = s.ais.find((e) => e.colonies.length > 0 && !atWar(e, s.corrupt))!;
        beaconState(s.g).mega = { contributors: [target.empireId], builderName: 'the Test', contracts: [], pool: {}, progress: 0, status: 'building', x: 0, y: 0, builder: s.me.empireId, buildYears: 1, activeDays: 0, since: 0, lastStep: 0, lastArrival: 0, lastSent: 0, starvedDays: 0, delivered: 0, deliveredBy: {}, lastSentBy: {}, base: null } as unknown as MegaRec;
        remember(s.g, []);
        expect(reviewWars(s.g, s.st, s.corrupt)).toBe(true);
        expect(atWar(s.corrupt, target)).toBe(true);
        expect(reviewWars(s.g, s.st, s.corrupt)).toBe(false);
        expect(s.st.wars.length).toBe(1);
    }, 600000);

    it('a human holding a Scar world is a target too (the war is declared on the player)', () => {
        const s = setup();
        remember(s.g, [s.me.capital!]);
        expect(reviewWars(s.g, s.st, s.corrupt)).toBe(true);
        expect(atWar(s.corrupt, s.me)).toBe(true);
    }, 600000);

    it('declareCorruptWar records the war and the pattern act; refused wars are not recorded', () => {
        const s = setup();
        const target = s.ais.find((e) => !atWar(e, s.corrupt))!;
        expect(declareCorruptWar(s.g, s.st, s.corrupt, target, 'a reason')).toBe(true);
        expect(s.st.wars.at(-1)?.reason).toBe('a reason');
    }, 600000);
});

// ---------------------------------------------------------------------------------------------------------------
describe('the raids and the parks', () => {
    it('raids a Severance freighter of an empire it is at war with, with a strike fleet on the ship', () => {
        const s = setup();
        // the nearest rival's ship: a Severance freighter within the raiders' reach
        const owner = nearest(s, s.corrupt.capital!, s.ais.filter((e) => e.builtObjects.some((b) => !b.hasBeenDestroyed)));
        declareWar(s.g, s.corrupt, owner);
        expect(atWar(s.corrupt, owner)).toBe(true);
        // the freighter is on its way to the Severance, which stands in the raiders' reach (the Severance's place is the corrupted empire's own space)
        const ship = owner.builtObjects.find((b) => !b.hasBeenDestroyed)! as BuiltObject;
        ship.xpos = s.corrupt.capital!.xpos + 2000;
        ship.ypos = s.corrupt.capital!.ypos;
        beaconState(s.g).mega = { contributors: [owner.empireId], builderName: 'the Test', contracts: [{ empireId: owner.empireId, ship, sent: galaxyStarDate(s.g) }], pool: {}, progress: 0, status: 'building', x: 0, y: 0, builder: s.me.empireId, buildYears: 1, activeDays: 0, since: 0, lastStep: 0, lastArrival: 0, lastSent: 0, starvedDays: 0, delivered: 0, deliveredBy: {}, lastSentBy: {}, base: null } as unknown as MegaRec;
        expect(raidContracts(s.g, s.st, s.corrupt)).toBe(true);
        expect(s.st.raids).toBe(1);
        const onIt = empireShipGroups(s.corrupt).some((grp) => (grp?.mission as { targetBuiltObject?: unknown } | null | undefined)?.targetBuiltObject === ship);
        expect(onIt).toBe(true);
        // no second raid on the same ship
        expect(raidContracts(s.g, s.st, s.corrupt)).toBe(false);
    }, 600000);

    it('does not raid a freighter whose owner is not at war with it', () => {
        const s = setup();
        const owner = s.ais.find((e) => e.builtObjects.some((b) => !b.hasBeenDestroyed))!;
        obtainDiplomaticRelation(s.corrupt, owner).type = DiplomaticRelationType.None;
        const ship = owner.builtObjects.find((b) => !b.hasBeenDestroyed)!;
        beaconState(s.g).mega = { contributors: [owner.empireId], builderName: 'the Test', contracts: [{ empireId: owner.empireId, ship, sent: 0 }], pool: {}, progress: 0, status: 'building', x: 0, y: 0, builder: s.me.empireId, buildYears: 1, activeDays: 0, since: 0, lastStep: 0, lastArrival: 0, lastSent: 0, starvedDays: 0, delivered: 0, deliveredBy: {}, lastSentBy: {}, base: null } as unknown as MegaRec;
        expect(raidContracts(s.g, s.st, s.corrupt)).toBe(false);
        expect(s.st.raids).toBe(0);
        expect(peekMega(s.g)).not.toBeNull();
    }, 600000);

    it('parks a patrol at a dormant foundry (the Age 1 survivors), one per review, and not at a destroyed one', () => {
        const s = setup();
        const h = s.ais.find((e) => e.colonies.length > 0)!.colonies[0];
        // the foundries lie at the corrupted empire's own world (its fleets are in reach there)
        const home = s.corrupt.capital!;
        void h;
        const place: PlaceRec = { name: 'F1', systemName: 'S', x: home.xpos, y: home.ypos };
        const gone: PlaceRec = { name: 'F2', systemName: 'S', x: home.xpos + 1, y: home.ypos + 1 };
        remember(s.g, [], [place, gone]);
        longNightState(s.g).memory!.foundries.destroyed = [gone];
        expect(dormantFoundries(s.g).map((f) => f.name)).toEqual(['F1']);
        expect(parkAtFoundries(s.g, s.st, s.corrupt)).toBe(true);
        expect(s.st.parks).toBe(1);
        // one per review: the only standing foundry is watched now
        expect(parkAtFoundries(s.g, s.st, s.corrupt)).toBe(false);
    }, 600000);
});

// ---------------------------------------------------------------------------------------------------------------
describe('the Internal Security lead and the exposure motion', () => {
    it('the leader carries the corruption thing, and a human rolls it through Internal Security', () => {
        const s = setup();
        const t = corruptionThing(s.g, s.corrupt);
        expect(t).toBeDefined();
        expect(t!.target).toBe(leaderOf(s.corrupt));
        expect(t!.kind).toBe('corruption');
        // the player's counter-intelligence (its agents, here the strength slot of the 19n court) lets the rolls find it: suspected, then confirmed
        const prev = securitySlots.strengthBonus;
        securitySlots.strengthBonus = (_g, e) => (e === s.me ? 5000 : 0);
        try {
            for (let i = 0; i < 400 && confirmedLeadOf(s.g, s.me) === null; i++) leadRolls(s.g, s.st, s.corrupt);
        } finally {
            securitySlots.strengthBonus = prev;
        }
        expect(confirmedLeadOf(s.g, s.me)).not.toBeNull();
        const leads = securityState(s.g).leads.filter((l) => l.thingId === t!.id && l.empire === s.me);
        expect(leads.length).toBe(1);
        expect(leads[0].source).toBe('roll');
    }, 600000);

    it('a proposal without a confirmed lead on its leader is refused; a suspected one is not enough', () => {
        const s = setup();
        const t = corruptionThing(s.g, s.corrupt)!;
        expect(canExpose(s.g, s.me)).toBe(false);
        expect(dietPropose(s.g, s.me, { kind: MOTION_EXPOSE, target: null, other: null, colony: null, resourceId: -1 })).toBe(false);
        setLeadLevel(s.g, t, s.me, 'suspected', 'roll');
        expect(dietPropose(s.g, s.me, { kind: MOTION_EXPOSE, target: null, other: null, colony: null, resourceId: -1 })).toBe(false);
        // an AI never exposes anyone
        expect(canExpose(s.g, s.ais[0])).toBe(false);
    }, 600000);

    it('with a confirmed lead the proposer may move it; the motion names the corrupted empire; it passes with the members, and ends the corruption', () => {
        const s = setup();
        const t = corruptionThing(s.g, s.corrupt)!;
        setLeadLevel(s.g, t, s.me, 'confirmed', 'roll');
        expect(dietPropose(s.g, s.me, { kind: MOTION_EXPOSE, target: null, other: null, colony: null, resourceId: -1 })).toBe(true);
        const proposal = dietState(s.g).proposals[s.me.empireId];
        expect(proposal?.kind).toBe(MOTION_EXPOSE);
        // the Diet's tally, as the AI members vote it: the corrupted empire says no, the members yes
        const c = dietCouncil(s.g)!;
        const m = motion(s.g, MOTION_EXPOSE, s.me, s.corrupt);
        const votes = dietMembership(s.g, c).map((v) => ({ empire: v, vote: (v === s.corrupt ? 'no' : dietVoteScore(s.g, c, dietState(s.g), v, m) >= 5 ? 'yes' : 'no') as 'yes' | 'no' }));
        const yes = votes.filter((v) => v.vote === 'yes').length;
        const no = votes.length - yes;
        expect(yes).toBeGreaterThan(no);
        const def = dietMotionKindDef(MOTION_EXPOSE)!;
        def.apply(s.g, dietState(s.g), { ...m, votes, yes, no } as DietMotion, (() => undefined) as never);
        expect(activeCorrupted(s.g)).toBeNull();
        expect(peekCorrupted(s.g)!.ended).toBe('exposed');
        expect(peekCorrupted(s.g)!.exposedBy).toBe(s.me.empireId);
        expect(corruptionThing(s.g, s.corrupt)).toBeUndefined();
        // the other AI members treat it as an enemy
        for (const v of votes) if (v.empire !== s.corrupt && !isHumanEmpire(s.g, v.empire) && v.empire.active) expect(atWar(v.empire, s.corrupt)).toBe(true);
        // and it is a normal AI again: no more wars, no more votes against
        const wars = s.st.wars.length;
        corruptedPass(s.g);
        expect(s.st.wars.length).toBe(wars);
        expect(corruptedVoteScore(s.g, 37, s.corrupt, MOTION_MEGA, s.me)).toBe(37);
    }, 600000);
});

// ---------------------------------------------------------------------------------------------------------------
describe('the three endings', () => {
    it('captured: taking its capital ends the corruption (the capitalLost event)', () => {
        const s = setup();
        scenarioEmit(s.g, 'capitalLost', { empire: s.corrupt, colony: s.corrupt.capital!, capturer: s.me });
        expect(peekCorrupted(s.g)!.ended).toBe('captured');
        expect(isCorrupted(s.g, s.corrupt)).toBe(false);
    }, 600000);

    it('a capital lost with no captor is capitalLost, not captured', () => {
        const s = setup();
        scenarioEmit(s.g, 'capitalLost', { empire: s.corrupt, colony: s.corrupt.capital!, capturer: null });
        expect(peekCorrupted(s.g)!.ended).toBe('capitalLost');
        expect(isCorrupted(s.g, s.corrupt)).toBe(false);
    }, 600000);

    it('a destroyed empire ends it as gone, and its hidden thing is retired (as the other endings retire it)', () => {
        const s = setup();
        const t = corruptionThing(s.g, s.corrupt)!;
        s.corrupt.active = false;
        corruptedPass(s.g);
        expect(peekCorrupted(s.g)!.ended).toBe('gone');
        expect(securityState(s.g).things.find((x) => x.id === t.id)!.retired).toBe(true);
        expect(corruptionThing(s.g, s.corrupt)).toBeUndefined();
    }, 600000);

    it('assassinated: an agent killing its leader ends it; killing another character does not', () => {
        const s = setup();
        const other = getEmpireCharacters(s.corrupt).find((c: Character) => c.role !== CharacterRole.Leader && c.active);
        if (other !== undefined) scenarioEmit(s.g, 'characterAssassinated', { character: other, empire: s.corrupt });
        expect(peekCorrupted(s.g)!.ended).toBe('');
        scenarioEmit(s.g, 'characterAssassinated', { character: leaderOf(s.corrupt)!, empire: s.corrupt });
        expect(peekCorrupted(s.g)!.ended).toBe('assassinated');
        expect(activeCorrupted(s.g)).toBeNull();
        // onAssassinated itself is the same rule: a second kill changes nothing
        onAssassinated(s.g, leaderOf(s.corrupt)!, s.corrupt);
        expect(peekCorrupted(s.g)!.ended).toBe('assassinated');
    }, 600000);

    it('exposed: covered above (the Diet motion); the reputation scar lands on every other empire, and the empire is never chosen again', () => {
        const s = setup();
        const x = s.ais[0];
        const before = obtainEmpireEvaluation(s.g, x, s.corrupt).incidentEvaluation;
        endCorruption(s.g, 'exposed', s.me);
        expect(activeCorrupted(s.g)).toBeNull();
        if (!reputationOn(s.g)) expect(obtainEmpireEvaluation(s.g, x, s.corrupt).incidentEvaluation).toBeLessThan(before);
        expect(chooseCorrupted(s.g)).toBe(false);
        expect(peekCorrupted(s.g)!.chosen).toBe(true);
        // a second ending changes nothing
        expect(endCorruption(s.g, 'captured')).toBe(false);
        expect(peekCorrupted(s.g)!.ended).toBe('exposed');
    }, 600000);

    it('the ending closes the leads on the leader (the Internal Security list keeps them)', () => {
        const s = setup();
        const t = corruptionThing(s.g, s.corrupt)!;
        setLeadLevel(s.g, t, s.me, 'confirmed', 'roll');
        onCorruptCapitalLost(s.g, s.corrupt, s.me);
        expect(securityState(s.g).leads.filter((l) => l.thingId === t.id).every((l) => l.closed)).toBe(true);
    }, 600000);
});

// ---------------------------------------------------------------------------------------------------------------
describe('a human takes the corrupted empire', () => {
    it('a player who joins and takes its seat ends the corruption at once (freed): no war for it afterwards, no vote against, the thing retired', () => {
        const s = setup();
        const t = corruptionThing(s.g, s.corrupt)!;
        // a player joins the running game: the seats are the primary human and the AI empire the player takes (a multiplayer game)
        setHumanEmpires(s.g, [s.me, s.ais[0]]);
        expect(addHumanSeat(s.g, s.corrupt)).toBe(true);
        expect(isHumanEmpire(s.g, s.corrupt)).toBe(true);
        // at once, before any pass: no vote against it, and no longer the corrupt empire
        expect(corruptedVoteScore(s.g, 37, s.corrupt, MOTION_MEGA, s.me)).toBe(37);
        expect(activeCorrupted(s.g)).toBeNull();
        corruptedPass(s.g);
        expect(peekCorrupted(s.g)!.ended).toBe('freed');
        expect(securityState(s.g).things.find((x) => x.id === t.id)!.retired).toBe(true);
        // no war for it, however many passes and wherever the Scar lies
        const target = s.ais.find((e) => e !== s.ais[0] && e.colonies.length > 0 && !atWar(e, s.corrupt))!;
        remember(s.g, [target.colonies[0]]);
        for (let i = 0; i < 3; i++) corruptedPass(s.g);
        expect(atWar(s.corrupt, target)).toBe(false);
        expect(s.st.wars.length).toBe(0);
        // its votes against the preparation motions stop applying at once
        expect(corruptedVoteScore(s.g, 37, s.corrupt, MOTION_MEGA, s.me)).toBe(37);
        expect(isCorrupted(s.g, s.corrupt)).toBe(false);
    }, 600000);

    it('after the takeover a Diet vote against a preparation motion is no pattern act (the tally observer reads only the live corruption)', () => {
        const s = setup();
        setHumanEmpires(s.g, [s.me, s.ais[0]]);
        addHumanSeat(s.g, s.corrupt);
        corruptedTallyObserver(s.g, motion(s.g, MOTION_MEGA, s.me, s.me, [{ empire: s.corrupt, vote: 'no' }]));
        expect(s.st.acts).toBe(0);
        expect(s.st.votes.length).toBe(0);
    }, 600000);
});

// ---------------------------------------------------------------------------------------------------------------
describe('what the Knowledge page shows', () => {
    it('nothing until the viewer has seen the pattern; then suspicion; a confirmed lead makes it confirmed', () => {
        const s = setup();
        meet(s.me, s.corrupt);
        expect(corruptedRowsOf(s.g, s.me)).toEqual([]);
        recordAct(s.g, s.st, s.corrupt, 'an act');
        expect(corruptedRowsOf(s.g, s.me)).toEqual([]);
        recordAct(s.g, s.st, s.corrupt, 'another act');
        const rows = corruptedRowsOf(s.g, s.me);
        expect(rows.length).toBe(1);
        expect(rows[0].status).toBe(scenarioText('Corrupt Row Suspected'));
        expect(titlesOf(s.me)).toContain(scenarioText('Corrupt Pattern Title'));
        const t = corruptionThing(s.g, s.corrupt)!;
        setLeadLevel(s.g, t, s.me, 'confirmed', 'roll');
        expect(corruptedRowsOf(s.g, s.me)[0].status).toBe(scenarioText('Corrupt Row Confirmed'));
        // an AI never sees the section
        expect(corruptedRowsOf(s.g, s.ais[0])).toEqual([]);
    }, 600000);

    it('a human who never met the empire does not see it, whatever the pattern', () => {
        const s = setup();
        recordAct(s.g, s.st, s.corrupt, 'an act');
        recordAct(s.g, s.st, s.corrupt, 'another act');
        expect(corruptedRowsOf(s.g, s.me)).toEqual([]);
    }, 600000);

    it('after an ending, only the viewers who knew of it see the row, with how it ended', () => {
        const s = setup();
        meet(s.me, s.corrupt);
        recordAct(s.g, s.st, s.corrupt, 'a');
        recordAct(s.g, s.st, s.corrupt, 'b');
        endCorruption(s.g, 'assassinated');
        expect(corruptedRowsOf(s.g, s.me)[0].status).toBe(scenarioText('Corrupt Row Ended', scenarioText('Corrupt Cause assassinated')));
    }, 600000);
});

// ---------------------------------------------------------------------------------------------------------------
describe('games that must stay untouched, and the save', () => {
    it('no Age 2: the pass creates nothing and no empire is corrupted (age 1, and the flag off)', () => {
        const { game, gameData } = createScenarioGame(base, { scenario: comboOverlayFs(ids), flags: FLAGS, options: age3 });
        const g = game.galaxy;
        seatDiet(g);
        for (let i = 0; i < 40; i++) {
            g.nowMs += DAY;
            corruptedPass(g);
        }
        expect(peekCorrupted(g)).toBeNull();
        expect(gameData).toBeDefined();
        // the flag off in an Age 2 galaxy: nothing either
        const { game: off } = createScenarioGame(base, { scenario: comboOverlayFs(ids), flags: { ...FLAGS, gwHarvestCycle: false }, options: age3 });
        off.galaxy.scenario!.flags.gwHarvestCycle = false;
        longNightState(off.galaxy).age = AGE_PREPARATION;
        seatDiet(off.galaxy);
        for (let i = 0; i < 5; i++) {
            off.galaxy.nowMs += DAY;
            corruptedPass(off.galaxy);
        }
        expect(peekCorrupted(off.galaxy)).toBeNull();
    }, 600000);

    it('the save round trip keeps the corrupted empire, its pattern and its endings', () => {
        const s = setup();
        recordAct(s.g, s.st, s.corrupt, 'an act');
        const text = serializeGame(s.game, new GalaxyTime(), {} as StartGameOptions);
        const { game } = deserializeGame(text, s.gameData);
        const st = peekCorrupted(game.galaxy)!;
        expect(st.empireId).toBe(s.corrupt.empireId);
        expect(st.acts).toBe(1);
        expect(st.chosen).toBe(true);
        expect(activeCorrupted(game.galaxy)?.empireId).toBe(s.corrupt.empireId);
        expect(corruptionThing(game.galaxy, activeCorrupted(game.galaxy)!)).toBeDefined();
    }, 600000);

    it('a joined older save (no corrupted state) reads as no corruption, and the first Preparation pass chooses', () => {
        const s = setup();
        delete s.g.scenario!.state['corruptedEmpire'];
        expect(peekCorrupted(s.g)).toBeNull();
        expect(activeCorrupted(s.g)).toBeNull();
        corruptedPass(s.g);
        expect(peekCorrupted(s.g)!.chosen).toBe(true);
    }, 600000);
});
