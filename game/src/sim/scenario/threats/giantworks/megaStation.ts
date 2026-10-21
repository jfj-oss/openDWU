// The Beacon, part 7: building the mega-station (the "Severance"; Giantworks wonder, flag gwBeacon, Characters & Victory's Diet on). Not a port.
//
//   START      the Galactic Diet's motion "Build the Severance": only a HUMAN empire that holds the finished blueprint may move it, and names the place
//              (the Diet screen asks for a map click; the place is snapped to the nearest empty void). One mega-station per galaxy. When the vote passes
//              the builder's parts and those of every yes-voter on good terms with it (partTradeAllowed; a human voter consents by voting) are handed over
//              and pooled in the structure; the holders that refuse keep theirs (capital capture still moves them: beaconComponents.ts transferParts).
//   PARTS CAP  progress is capped by the pooled parts: beam lens 20%, link conduit 15%, cloak lattice 15%, mind fragments 25% x (count / needed),
//              void frames 25% x (count / needed). It stalls at the cap (a stall for missing parts never decays); the pledged empires hand over
//              whatever they win later at the next daily step.
//   BUILDING   a Founders' Compact base at the place (the Great Work scaffold design: lifecycle.ts factionDesign, no new art), unarmed and indestructible
//              (the builtObjectInvulnerable query: no damage from any weapon). Contributors (the builder and the pledged) send up to megaFreighterPct
//              (20%) of their PRIVATE freighters as construction contracts: an idle private freighter is redirected to the structure, delivers on arrival
//              and goes back to the private sector. Active construction takes megaBuildMinYears..MaxYears (60-70) of game time: days with a delivery in the
//              last megaActiveWindowDays count; days stalled (parts) or with a holder shooting do not.
//   DEFENCE    a hostile armed force (a pirate, the Reclaimers, an empire at war with a contributor) near it that outweighs the contributors' by the orbit
//              ratio holds the space: it shoots the arriving freighters (the Blockades that bite rule, blockadeShoot, used even with that add-on off).
//              A freighter shot down is one sent that did not arrive. Freighters sent with none arriving for megaDecayAfterDays (2 years) cost it megaDecayPct (1%) of the whole
//              per megaDecayPerDays (2 years) from then on. It cannot be a base for fleets (the Compact is nobody's friend: no war, no pact, no docking rights).
//   LONG NIGHT the half-built structure survives at the same place in the memory record (megaMemory: progress, place, pooled parts by empire name) and
//              is dormant in the next age: it must be found (a ship within megaReach of it) and a new Diet vote ("Resume the Severance") continues it.
//   FIRING     at 100% it fires: a popup, fireMegaStation (the Beacon's victory check ends the game), or, in the next age, the game ends here.
// Rnd: the private beaconRandom (the build time); the stock base creation draws galaxy.rnd inside this handler only.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { BuiltObject } from '../../../builtObject';
import type { Race } from '../../../data/races';
import { BuiltObjectRole } from '../../../data/designSpecifications';
import { BuiltObjectSubRole } from '../../../builtObjectTypes';
import { ComponentType } from '../../../data/components';
import { EmpireMessageType } from '../../../messages';
import { DiplomaticRelationType, obtainDiplomaticRelation, obtainEmpireEvaluation } from '../../../diplomacy';
import { aggressionLevel, friendlinessLevel } from '../../../diplomacyTick';
import { GameEndOutcome } from '../../../victory';
import { galaxyStarDate } from '../../../tick/simTime';
import { isHumanEmpire } from '../../../humanEmpires';
import { getEmpireById } from '../../../logistics/contracts';
import { determineAvailableFreighters } from '../../../logistics/freight';
import { resolveSectorDescription } from '../../../empireEvents';
import { assignMission } from '../../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../../../missions/mission';
import { getNearbyBuiltObjects } from '../../../pirates/pirateAI';
import { GAME_DAY_LENGTH, registerScenarioFramePeriodic, registerScenarioQuery } from '../../hooks';
import { scenarioMessage, scenarioNews, scenarioText as T } from '../../messages';
import { scenarioFlag, scenarioParam } from '../../state';
import { ORBIT_RANGE, classifyOrbit, firepowerByEmpireNear, orbitalRatio } from '../../orbital/orbitalSuperiority';
import { blockadeShoot } from '../../blockades/blockadesBite';
import { dietCouncil } from '../../charactersVictory/diet/diet';
import { dietMembership } from '../../charactersVictory/diet/dietAi';
import { dietOn, registerDietMotionKind, type DietMotion, type DietState } from '../../charactersVictory/diet/dietState';
import { threatGameEnd } from '../framework';
import { BEACON_CODE_MEGA, BEACON_FLAG, P, beaconRandom, beaconState, peekBeaconState, type BeaconState, type EmpireParts, type MegaRec } from './beaconState';
import { PART_KINDS, fireMegaStation, heldParts, partCount, partLabel, partNeeded, partTradeAllowed, type PartKind } from './beaconComponents';
import { ensureCompactFor, factionDesign } from './lifecycle';
import { spawnShip } from './beaconFleet';
import { compactFaction } from './state';
import { galaxyAgeOf } from './longNightState';
import { harvestPledges, severanceVoteBonus } from './agePrep';
import { escortAtArrival, escortStep, escortsFreight, releaseEscorts, supplyEscorts } from './megaEscort';
import { warCreditEscort } from './beaconWarCredit';

export const MOTION_MEGA = 'megaBuild';
export const MOTION_MEGA_RESUME = 'megaResume';
export const MEGA_HANDLER_IDS = ['beacon.megaStep'] as const;
export const MEGA_QUERY_IDS = ['beacon.megaInvulnerable', 'beacon.escortRefuel'] as const;
const TAG = 'Mega';
/** A freighter within this distance of the structure has delivered. */
export const MEGA_DELIVER_RANGE = 9000;

const DAY = GAME_DAY_LENGTH;
/** Every weapon component type (the enum names them Weapon...). */
function isWeaponType(t: ComponentType): boolean {
    return String(ComponentType[t]).startsWith('Weapon');
}

function on(galaxy: Galaxy): boolean {
    return scenarioFlag(galaxy, BEACON_FLAG) && dietOn(galaxy);
}

/** The mega-station record, if one was voted (never creates it). */
export function peekMega(galaxy: Galaxy): MegaRec | null {
    return peekBeaconState(galaxy)?.mega ?? null;
}

function humansIn(galaxy: Galaxy, ids: readonly number[]): Empire[] {
    const out: Empire[] = [];
    for (const id of ids) {
        const e = getEmpireById(galaxy, id);
        if (e !== null && e.active && isHumanEmpire(galaxy, e)) out.push(e);
    }
    return out;
}

function allHumans(galaxy: Galaxy): Empire[] {
    return galaxy.empires.filter((e): e is Empire => e !== null && e.active && isHumanEmpire(galaxy, e));
}

function tellHumans(galaxy: Galaxy, to: readonly Empire[], title: string, body: string, opts: { good?: boolean; bad?: boolean; popup?: boolean; subject?: unknown } = {}): void {
    for (const e of to) {
        scenarioMessage(galaxy, e, title, body, {
            type: opts.good === true ? EmpireMessageType.GeneralGoodEvent : opts.bad === true ? EmpireMessageType.GeneralBadEvent : EmpireMessageType.GeneralNeutralEvent,
            ...(opts.popup === true ? { popupMode: 'force' as const } : {}),
            ...(opts.subject !== undefined ? { subject: opts.subject } : {}),
        });
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Parts: the pool and the cap
// ---------------------------------------------------------------------------------------------------------------

/** What the structure holds in all (flags are held once, counts add). Pure. */
export function poolTotals(mega: MegaRec): { beamLens: boolean; linkConduit: boolean; cloakLattice: boolean; mindFragments: number; voidFrames: number } {
    const t = { beamLens: false, linkConduit: false, cloakLattice: false, mindFragments: 0, voidFrames: 0 };
    for (const p of Object.values(mega.pool)) {
        if (p.beamLens === true) t.beamLens = true;
        if (p.linkConduit === true) t.linkConduit = true;
        if (p.cloakLattice === true) t.cloakLattice = true;
        t.mindFragments += p.mindFragments ?? 0;
        t.voidFrames += p.voidFrames ?? 0;
    }
    return t;
}

/** The most progress (0..1) the pooled parts allow. Pure. */
export function partsCap(galaxy: Galaxy, mega: MegaRec): number {
    const t = poolTotals(mega);
    const cap =
        (t.beamLens ? P.megaCapLens(galaxy) : 0) +
        (t.linkConduit ? P.megaCapConduit(galaxy) : 0) +
        (t.cloakLattice ? P.megaCapLattice(galaxy) : 0) +
        P.megaCapFragments(galaxy) * Math.min(1, t.mindFragments / partNeeded(galaxy, 'mindFragments')) +
        P.megaCapFrames(galaxy) * Math.min(1, t.voidFrames / partNeeded(galaxy, 'voidFrames'));
    return Math.max(0, Math.min(1, cap));
}

/** `e` holds some part (a flag part, or at least one fragment / frame) that it could hand over. Pure. */
export function holdsParts(st: BeaconState, e: Empire): boolean {
    const h = heldParts(st, e);
    return h !== undefined && (h.beamLens === true || h.linkConduit === true || h.cloakLattice === true || (h.mindFragments ?? 0) > 0 || (h.voidFrames ?? 0) > 0);
}

/** Moves everything `e` holds (not its blueprint) into the pool under its name. Returns whether anything moved. */
function pool(st: BeaconState, mega: MegaRec, e: Empire): boolean {
    const h = heldParts(st, e);
    if (h === undefined) return false;
    const into = (mega.pool[e.name] ??= {});
    let any = false;
    for (const k of ['beamLens', 'linkConduit', 'cloakLattice'] as const) {
        if (h[k] === true) {
            into[k] = true;
            h[k] = false;
            any = true;
        }
    }
    for (const k of ['mindFragments', 'voidFrames'] as const) {
        const n = h[k] ?? 0;
        if (n > 0) {
            into[k] = (into[k] ?? 0) + n;
            h[k] = 0;
            any = true;
        }
    }
    if (Object.keys(into).length === 0) delete mega.pool[e.name];
    return any;
}

// ---------------------------------------------------------------------------------------------------------------
// The place
// ---------------------------------------------------------------------------------------------------------------

/**
 * The empty void nearest to (x, y): the point itself when it lies at least megaVoidClear from every star and inside the galaxy's margin, else
 * the nearest such point on growing rings round it (null when the galaxy has none). Pure; no Rnd.
 */
export function voidPointNear(galaxy: Galaxy, x: number, y: number): { x: number; y: number } | null {
    const clear = P.megaVoidClear(galaxy);
    const stars: { x: number; y: number }[] = [];
    for (const s of galaxy.systems) {
        const star = s?.systemStar ?? null;
        if (star !== null) stars.push({ x: star.xpos, y: star.ypos });
    }
    const mx = galaxy.sizeX * 0.03;
    const my = galaxy.sizeY * 0.03;
    const free = (px: number, py: number): boolean => {
        if (px < mx || py < my || px > galaxy.sizeX - mx || py > galaxy.sizeY - my) return false;
        for (const s of stars) if (Math.abs(s.x - px) < clear + 1 && Math.abs(s.y - py) < clear + 1 && Math.hypot(s.x - px, s.y - py) < clear + 1) return false;
        return true;
    };
    const x0 = Math.max(mx, Math.min(galaxy.sizeX - mx, x));
    const y0 = Math.max(my, Math.min(galaxy.sizeY - my, y));
    if (free(x0, y0)) return { x: Math.round(x0), y: Math.round(y0) };
    const step = clear / 3;
    const reach = Math.max(galaxy.sizeX, galaxy.sizeY);
    for (let r = step; r <= reach; r += step) {
        const n = Math.max(12, Math.ceil((2 * Math.PI * r) / step));
        for (let i = 0; i < n; i++) {
            const a = (2 * Math.PI * i) / n;
            const px = x0 + r * Math.cos(a);
            const py = y0 + r * Math.sin(a);
            if (free(px, py)) return { x: Math.round(px), y: Math.round(py) };
        }
    }
    return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Who may move it
// ---------------------------------------------------------------------------------------------------------------

/** `e` holds the finished blueprint. Pure. */
export function blueprintDone(st: BeaconState, e: Empire): boolean {
    return heldParts(st, e)?.blueprint?.done === true;
}

/** `e` may move "Build the Severance": a human with the finished blueprint, no mega-station voted yet, the Diet on. Pure. */
export function canStartMega(galaxy: Galaxy, e: Empire): boolean {
    const st = peekBeaconState(galaxy);
    return on(galaxy) && st !== null && st.mega === undefined && e.active && isHumanEmpire(galaxy, e) && blueprintDone(st, e);
}

/** `e` may move "Resume the Severance": a human with the finished blueprint whose ships found the dormant structure. Pure. */
export function canResumeMega(galaxy: Galaxy, e: Empire): boolean {
    const st = peekBeaconState(galaxy);
    const m = st?.mega;
    return on(galaxy) && st !== null && m !== undefined && m.status === 'dormant' && e.active && isHumanEmpire(galaxy, e) && blueprintDone(st, e) && m.foundBy.includes(e.empireId);
}

// ---------------------------------------------------------------------------------------------------------------
// The structure
// ---------------------------------------------------------------------------------------------------------------

/** The structure's position: its base when it stands, else the place. Pure. */
export function megaPosition(mega: MegaRec): { x: number; y: number } {
    const b = mega.base;
    return b !== undefined && b !== null && !b.hasBeenDestroyed ? { x: b.xpos, y: b.ypos } : { x: mega.x, y: mega.y };
}

function standInFor(galaxy: Galaxy, mega: MegaRec): { race: Race | null; habitat: import('../../../types').Habitat | null } {
    const builder = getEmpireById(galaxy, mega.builder);
    const cands = [builder, ...galaxy.empires].filter((e): e is Empire => e !== null && e !== undefined && e.active && e.capital !== null && e.dominantRace !== null && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null);
    const e = cands[0];
    return e === undefined ? { race: null, habitat: null } : { race: e.dominantRace as Race, habitat: e.capital };
}

/** An unarmed copy of the Great Work scaffold design (a fresh generation each time, so stripping its guns touches nothing else). */
function scaffoldDesign(galaxy: Galaxy, faction: Empire): ReturnType<typeof factionDesign> {
    const d = factionDesign(galaxy, faction, BuiltObjectSubRole.LargeSpacePort, true);
    if (d === null) return null;
    d.name = T('Giantworks Scaffold Design');
    const unarmed = d.components.filter((c) => !isWeaponType(c.type));
    if (unarmed.length !== d.components.length) {
        d.components = unarmed;
        d.reDefine();
    }
    return d;
}

function stageName(progress: number): string {
    return T(`Giantworks Stage ${Math.min(3, Math.max(0, Math.floor(progress * 4)))}`);
}

function baseName(mega: MegaRec): string {
    return T(`${TAG} Base Name`, stageName(mega.progress));
}

/** The structure stands: makes its base at the place when it does not (the first time, or the next age's first find). */
export function ensureBase(galaxy: Galaxy, mega: MegaRec): BuiltObject | null {
    if (mega.base !== undefined && mega.base !== null && !mega.base.hasBeenDestroyed) return mega.base;
    const who = standInFor(galaxy, mega);
    const faction = ensureCompactFor(galaxy, who.race, who.habitat);
    if (faction === null) return null;
    const design = scaffoldDesign(galaxy, faction);
    if (design === null) return null;
    const bo = spawnShip(galaxy, faction, design, mega.x, mega.y);
    bo.name = baseName(mega);
    mega.base = bo;
    return bo;
}

/** The structure takes no damage from any weapon (inflictDamageFull's builtObjectInvulnerable query). Pure. */
export function isMegaBase(galaxy: Galaxy, bo: BuiltObject): boolean {
    const m = peekMega(galaxy);
    return m !== null && m.base === bo;
}

// ---------------------------------------------------------------------------------------------------------------
// The vote
// ---------------------------------------------------------------------------------------------------------------

function voteYes(m: DietMotion, e: Empire): boolean {
    return m.votes.some((v) => v.empire === e && v.vote === 'yes');
}

/**
 * The pledges: the builder's parts are pooled, and every yes-voter on good terms with the builder (a human consents by voting yes) joins the
 * contributors and hands over what it holds. Part holders that did not (voted no / abstained, bad terms) are recorded as refusing.
 */
function pledge(galaxy: Galaxy, st: BeaconState, mega: MegaRec, m: DietMotion, builder: Empire): { handed: string[]; refused: string[] } {
    const handed: string[] = [];
    const refused: string[] = [];
    if (!mega.contributors.includes(builder.empireId)) mega.contributors.push(builder.empireId);
    if (pool(st, mega, builder)) handed.push(builder.name);
    const c = dietCouncil(galaxy);
    const members = c === null ? [] : dietMembership(galaxy, c);
    for (const v of members) {
        if (v === builder || !v.active) continue;
        const holds = holdsParts(st, v);
        if (voteYes(m, v) && (isHumanEmpire(galaxy, v) || partTradeAllowed(galaxy, v, builder) || harvestPledges(galaxy, v, builder))) {
            if (!mega.contributors.includes(v.empireId)) mega.contributors.push(v.empireId);
            if (pool(st, mega, v)) handed.push(v.name);
        } else if (holds) refused.push(v.name);
    }
    mega.refused = refused;
    return { handed, refused };
}

function rollYears(galaxy: Galaxy, st: BeaconState): number {
    const lo = P.megaBuildMinYears(galaxy);
    const hi = Math.max(lo, P.megaBuildMaxYears(galaxy));
    return lo + beaconRandom(galaxy, st, 71).nextDouble() * (hi - lo);
}

function startMega(galaxy: Galaxy, st: DietState, m: DietMotion): void {
    void st;
    const bs = peekBeaconState(galaxy);
    const builder = m.proposer;
    if (bs === null || !on(galaxy) || bs.mega !== undefined || m.place === undefined || !canStartMega(galaxy, builder)) return;
    const place = voidPointNear(galaxy, m.place.x, m.place.y);
    if (place === null) return;
    const now = galaxyStarDate(galaxy);
    const mega: MegaRec = {
        x: place.x,
        y: place.y,
        builder: builder.empireId,
        builderName: builder.name,
        contributors: [],
        pool: {},
        progress: 0,
        activeDays: 0,
        buildYears: rollYears(galaxy, bs),
        status: 'building',
        since: now,
        lastStep: now,
        lastArrival: now,
        lastSent: 0,
        starvedDays: 0,
        base: null,
        contracts: [],
        delivered: 0,
        deliveredBy: {},
        foundBy: [],
        voted: true,
        refused: [],
    };
    bs.mega = mega;
    const { handed, refused } = pledge(galaxy, bs, mega, m, builder);
    ensureBase(galaxy, mega);
    const sector = resolveSectorDescription(galaxy, mega.x, mega.y);
    scenarioNews(galaxy, null, T(`${TAG} Started News`, builder.name, sector), () => true, mega.base ?? null);
    tellHumans(galaxy, humansIn(galaxy, mega.contributors), T(`${TAG} Started Title`), T(`${TAG} Started`, sector, Math.round(partsCap(galaxy, mega) * 100), handed.join(', ') || '-', refused.join(', ') || '-', Math.round(mega.buildYears)), { good: true, popup: true, subject: mega.base ?? undefined });
}

function resumeMega(galaxy: Galaxy, st: DietState, m: DietMotion): void {
    void st;
    const bs = peekBeaconState(galaxy);
    const mega = bs?.mega;
    const builder = m.proposer;
    if (bs === null || mega === undefined || !on(galaxy) || mega.status !== 'dormant' || !canResumeMega(galaxy, builder)) return;
    const now = galaxyStarDate(galaxy);
    mega.builder = builder.empireId;
    mega.builderName = builder.name;
    mega.contributors = [];
    mega.voted = true;
    mega.status = 'building';
    mega.lastStep = now;
    mega.lastArrival = now;
    mega.starvedDays = 0;
    const { handed, refused } = pledge(galaxy, bs, mega, m, builder);
    ensureBase(galaxy, mega);
    const sector = resolveSectorDescription(galaxy, mega.x, mega.y);
    scenarioNews(galaxy, null, T(`${TAG} Resumed News`, builder.name, sector), () => true, mega.base ?? null);
    tellHumans(galaxy, humansIn(galaxy, mega.contributors), T(`${TAG} Resumed Title`), T(`${TAG} Resumed`, sector, Math.round(mega.progress * 100), Math.round(partsCap(galaxy, mega) * 100), handed.join(', ') || '-', refused.join(', ') || '-'), { good: true, popup: true, subject: mega.base ?? undefined });
}

function voteScore(galaxy: Galaxy, voter: Empire, m: DietMotion): number {
    if (voter === m.proposer) return 100;
    const attitude = obtainEmpireEvaluation(galaxy, voter, m.proposer).overallAttitude;
    return 4 + 0.5 * attitude + 8 * ((friendlinessLevel(voter) - 100) / 50) - 6 * ((aggressionLevel(voter) - 100) / 50) + severanceVoteBonus(galaxy, voter); // "Recognise the Harvest" (agePrep.ts): the AI members contribute
}

function failedNews(galaxy: Galaxy, m: DietMotion): void {
    scenarioNews(galaxy, null, T(`${TAG} Refused News`, m.proposer.name), (e) => isHumanEmpire(galaxy, e));
}

registerDietMotionKind({
    kind: MOTION_MEGA,
    label: 'Build the Severance',
    needs: 'point',
    proposable: (g) => on(g) && peekMega(g) === null && allHumans(g).some((e) => canStartMega(g, e)),
    proposableBy: (g, e) => canStartMega(g, e),
    prepare: (g, e, p) => {
        if (!canStartMega(g, e) || p.place === undefined) return null;
        const place = voidPointNear(g, p.place.x, p.place.y);
        return place === null ? null : { target: e, other: null, colony: null, resourceId: -1, place };
    },
    text: (g, _st, m) => T(`${TAG} Motion Text`, m.place === undefined ? '' : resolveSectorDescription(g, m.place.x, m.place.y), m.target?.name ?? ''),
    effect: () => T(`${TAG} Motion Effect`),
    apply: (g, st, m) => startMega(g, st, m),
    voteScore: (g, _st, voter, m) => voteScore(g, voter, m),
    failed: (g, _st, m) => failedNews(g, m),
});

registerDietMotionKind({
    kind: MOTION_MEGA_RESUME,
    label: 'Resume the Severance',
    needs: 'none',
    proposable: (g) => on(g) && peekMega(g)?.status === 'dormant' && allHumans(g).some((e) => canResumeMega(g, e)),
    proposableBy: (g, e) => canResumeMega(g, e),
    prepare: (_g, e) => ({ target: e, other: null, colony: null, resourceId: -1 }),
    text: (_g, _st, m) => T(`${TAG} Resume Text`, m.target?.name ?? ''),
    effect: () => T(`${TAG} Resume Effect`),
    apply: (g, st, m) => resumeMega(g, st, m),
    voteScore: (g, _st, voter, m) => voteScore(g, voter, m),
    failed: (g, _st, m) => failedNews(g, m),
});

// ---------------------------------------------------------------------------------------------------------------
// Convoys: the contracts the private sector fulfils
// ---------------------------------------------------------------------------------------------------------------

function isIdleMission(b: BuiltObject): boolean {
    const m = builtObjectMission(b.mission);
    return m === null || m.type === BuiltObjectMissionType.Undefined;
}

function sendTo(galaxy: Galaxy, b: BuiltObject, base: BuiltObject): void {
    b.currentFuel = b.fuelCapacity;
    assignMission(galaxy, b, BuiltObjectMissionType.Move, base, null, BuiltObjectMissionPriority.Normal, { manuallyAssigned: true });
}

/** Frees a contract freighter: its mission is cleared and it is the private sector's again. */
function release(b: BuiltObject): void {
    if (b.hasBeenDestroyed) return;
    builtObjectMission(b.mission)?.clear();
}

function distance(galaxy: Galaxy, a: { xpos: number; ypos: number }, b: { xpos: number; ypos: number }): number {
    return galaxy.calculateDistance(a.xpos, a.ypos, b.xpos, b.ypos);
}

/** Arrivals: a freighter within range delivers (an escort within megaEscortNear makes it an escorted one), the lost (shot down) and stale ones are dropped, idle ones are sent on. Returns the deliveries. */
function stepContracts(galaxy: Galaxy, st: BeaconState, mega: MegaRec, base: BuiltObject, now: number): number {
    let delivered = 0;
    const keep: typeof mega.contracts = [];
    for (const c of mega.contracts) {
        const b = c.ship;
        const owner = getEmpireById(galaxy, c.empireId);
        if (b.hasBeenDestroyed || owner === null || b.actualEmpire !== owner) continue; // lost (shot down) or taken
        if (distance(galaxy, b, base) <= MEGA_DELIVER_RANGE) {
            const escort = escortAtArrival(galaxy, b);
            release(b);
            delivered++;
            mega.delivered++;
            mega.deliveredBy[String(c.empireId)] = (mega.deliveredBy[String(c.empireId)] ?? 0) + 1;
            if (escort !== null) {
                mega.escorted = (mega.escorted ?? 0) + 1;
                warCreditEscort(galaxy, st, escort);
            }
            continue;
        }
        if (now - c.sent > 2 * P.megaDecayAfterDays(galaxy) * DAY) {
            release(b); // never arrived: back to the private sector
            continue;
        }
        const m = builtObjectMission(b.mission) as { targetBuiltObject?: BuiltObject | null } | null;
        if (isIdleMission(b) || m?.targetBuiltObject !== base) sendTo(galaxy, b, base);
        else b.currentFuel = b.fuelCapacity;
        keep.push(c);
    }
    mega.contracts = keep;
    return delivered;
}

/** Contributors send one idle private freighter each megaDispatchDays, never more than megaFreighterPct of their private freighters at a time. */
function dispatch(galaxy: Galaxy, mega: MegaRec, base: BuiltObject, now: number): void {
    const sentBy = (mega.lastSentBy ??= {});
    for (const id of mega.contributors) {
        const e = getEmpireById(galaxy, id);
        if (e === null || !e.active || e.pirateEmpireBaseHabitat !== null) continue;
        if (now - (sentBy[String(id)] ?? 0) < P.megaDispatchDays(galaxy) * DAY) continue;
        const { available, totalFreighters } = determineAvailableFreighters(e);
        const privateShips = new Set<BuiltObject>(e.privateBuiltObjects);
        let total = 0;
        for (const f of e.freighters as BuiltObject[]) if (!f.hasBeenDestroyed && privateShips.has(f)) total++;
        void totalFreighters;
        const cap = Math.floor((total * P.megaFreighterPct(galaxy)) / 100);
        const flying = mega.contracts.filter((c) => c.empireId === id).length;
        if (flying >= cap) continue;
        let best: BuiltObject | null = null;
        let bd = Infinity;
        for (const f of available) {
            if (f.role !== BuiltObjectRole.Freight || !privateShips.has(f) || mega.contracts.some((c) => c.ship === f)) continue;
            const d = distance(galaxy, f, base);
            if (d <= 2 * MEGA_DELIVER_RANGE) continue; // one that has just delivered idles here: it is not sent back to "arrive" again
            if (d < bd) {
                bd = d;
                best = f;
            }
        }
        if (best === null) continue;
        sendTo(galaxy, best, base);
        mega.contracts.push({ empireId: id, ship: best, sent: now });
        sentBy[String(id)] = now;
        mega.lastSent = now;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The blockade: the holder shoots the freighters (the Great Work's rule, blockades/blockadesBite.ts blockadeShoot)
// ---------------------------------------------------------------------------------------------------------------

/** The hostile force that holds the structure's orbit (a pirate, the Reclaimers or an empire at war with a contributor, outweighing the contributors' armed ships there by the orbit ratio), or null. */
export function megaBlockader(galaxy: Galaxy, st: BeaconState, mega: MegaRec): Empire | null {
    if (mega.base === undefined || mega.base === null || mega.base.hasBeenDestroyed) return null;
    const fp = firepowerByEmpireNear(galaxy, mega.base.xpos, mega.base.ypos, P.megaOrbitRange(galaxy));
    if (fp.size === 0) return null;
    const mine = new Set<Empire>();
    for (const id of mega.contributors) {
        const e = getEmpireById(galaxy, id);
        if (e !== null) mine.add(e);
    }
    let defend = 0;
    for (const [e, v] of fp) if (mine.has(e)) defend += v;
    let best: Empire | null = null;
    let bv = 0;
    for (const [e, v] of fp) {
        if (mine.has(e) || e === compactFaction(galaxy) || !e.active) continue;
        const hostile = e.pirateEmpireBaseHabitat !== null || e === st.faction || [...mine].some((c) => obtainDiplomaticRelation(c, e).type === DiplomaticRelationType.War);
        if (hostile && v > bv) {
            bv = v;
            best = e;
        }
    }
    return best !== null && classifyOrbit(defend, bv, orbitalRatio(galaxy)) === 'attacker' ? best : null;
}

// ---------------------------------------------------------------------------------------------------------------
// The daily step
// ---------------------------------------------------------------------------------------------------------------

function setStatus(galaxy: Galaxy, mega: MegaRec, status: MegaRec['status']): void {
    const was = mega.status;
    mega.status = status;
    if (was === status) return;
    if (status === 'stalled') tellHumans(galaxy, humansIn(galaxy, mega.contributors), T(`${TAG} Stalled Title`), T(`${TAG} Stalled`, Math.round(mega.progress * 100), missingParts(galaxy, mega)));
}

/** The holder shoots the contributors' freighters near the structure (blockadeShoot: its armed ships there attack them). */
function shootFreighters(galaxy: Galaxy, holder: Empire, mega: MegaRec, base: BuiltObject): void {
    const range = Math.max(ORBIT_RANGE, scenarioParam(galaxy, 'blockadeShootRange', 6000));
    const victims = mega.contracts.map((c) => c.ship).filter((b) => !b.hasBeenDestroyed && distance(galaxy, b, base) <= range);
    blockadeShoot(galaxy, holder, base, victims, Math.max(1, Math.round(scenarioParam(galaxy, 'blockadeShooters', 2))));
}

/** The parts the pool still lacks, as a short list (empty: none). Pure. */
export function missingParts(galaxy: Galaxy, mega: MegaRec): string {
    const t = poolTotals(mega);
    const out: string[] = [];
    if (!t.beamLens) out.push(partLabel('beamLens'));
    if (!t.linkConduit) out.push(partLabel('linkConduit'));
    if (!t.cloakLattice) out.push(partLabel('cloakLattice'));
    if (t.mindFragments < partNeeded(galaxy, 'mindFragments')) out.push(`${partLabel('mindFragments')} (${t.mindFragments}/${partNeeded(galaxy, 'mindFragments')})`);
    if (t.voidFrames < partNeeded(galaxy, 'voidFrames')) out.push(`${partLabel('voidFrames')} (${t.voidFrames}/${partNeeded(galaxy, 'voidFrames')})`);
    return out.join(', ');
}

/** Daily in the next age: a dormant structure is found when an empire's ship comes within megaReach of its place; its base is raised then. */
function findCheck(galaxy: Galaxy, mega: MegaRec): void {
    const near = getNearbyBuiltObjects(galaxy, mega.x, mega.y, P.megaReach(galaxy));
    const found: Empire[] = [];
    for (const b of near) {
        if (b == null || b.hasBeenDestroyed || b.role === BuiltObjectRole.Base) continue;
        const e = b.actualEmpire;
        if (e === null || !e.active || e === galaxy.independentEmpire || e.pirateEmpireBaseHabitat !== null || mega.foundBy.includes(e.empireId) || e === compactFaction(galaxy)) continue;
        mega.foundBy.push(e.empireId);
        found.push(e);
    }
    if (found.length === 0) return;
    ensureBase(galaxy, mega);
    for (const e of found) {
        if (isHumanEmpire(galaxy, e)) tellHumans(galaxy, [e], T(`${TAG} Found Title`), T(`${TAG} Found`, resolveSectorDescription(galaxy, mega.x, mega.y), Math.round(mega.progress * 100)), { good: true, popup: true, subject: mega.base ?? undefined });
    }
}

/** The pledged empires hand over whatever parts they hold now (won after the vote). */
function sweepPledges(galaxy: Galaxy, st: BeaconState, mega: MegaRec): void {
    for (const id of mega.contributors) {
        const e = getEmpireById(galaxy, id);
        if (e !== null && holdsParts(st, e)) pool(st, mega, e);
    }
}

/** One day's step (a frame periodic; the elapsed days since the last one are credited, so a slow frame loses nothing). */
export function megaStep(galaxy: Galaxy): void {
    const st = peekBeaconState(galaxy);
    const mega = st?.mega;
    if (st === null || mega === undefined || mega.status === 'fired') return;
    const now = galaxyStarDate(galaxy);
    const dt = Math.max(0, Math.min(60, (now - mega.lastStep) / DAY));
    mega.lastStep = now;
    if (mega.status === 'dormant') {
        releaseEscorts(galaxy, mega);
        findCheck(galaxy, mega);
        return;
    }
    sweepPledges(galaxy, st, mega);
    const base = ensureBase(galaxy, mega);
    if (base === null) return;
    const holder = megaBlockader(galaxy, st, mega);
    if (holder !== null) shootFreighters(galaxy, holder, mega, base);
    const delivered = stepContracts(galaxy, st, mega, base, now);
    if (delivered > 0) {
        mega.lastArrival = now;
        mega.starvedDays = 0;
    }
    const cap = partsCap(galaxy, mega);
    const window = P.megaActiveWindowDays(galaxy) * DAY;
    const arrivedRecently = now - mega.lastArrival <= window;
    const sentRecently = mega.contracts.length > 0 || (mega.lastSent > 0 && now - mega.lastSent <= window);
    if (mega.progress >= cap - 1e-9 && cap < 1) {
        setStatus(galaxy, mega, 'stalled'); // missing parts: no progress, no decay, nothing more sent
        mega.starvedDays = 0;
    } else if (arrivedRecently) {
        setStatus(galaxy, mega, 'building');
        mega.progress = Math.min(cap, mega.progress + dt / (mega.buildYears * 360));
        mega.activeDays += dt;
        mega.starvedDays = 0;
    } else {
        setStatus(galaxy, mega, 'idle');
        if (sentRecently) mega.starvedDays += dt;
    }
    if (mega.starvedDays >= P.megaDecayAfterDays(galaxy) && sentRecently) mega.progress = Math.max(0, mega.progress - (P.megaDecayPct(galaxy) * dt) / P.megaDecayPerDays(galaxy));
    if (!base.hasBeenDestroyed) {
        const name = baseName(mega);
        if (base.name !== name) base.name = name;
    }
    escortStep(galaxy, mega, base, now, holder !== null);
    if (mega.progress >= 1 - 1e-9) {
        fire(galaxy, st, mega);
        return;
    }
    if (mega.status !== 'stalled') dispatch(galaxy, mega, base, now);
}

// ---------------------------------------------------------------------------------------------------------------
// Firing
// ---------------------------------------------------------------------------------------------------------------

/** The structure is whole: it fires (a popup for every human, then the victory: the Beacon's check ends the game while the Reclamation runs, else here). */
export function fire(galaxy: Galaxy, st: BeaconState, mega: MegaRec): void {
    if (mega.status === 'fired') return;
    mega.status = 'fired';
    mega.progress = 1;
    for (const c of mega.contracts) release(c.ship);
    mega.contracts = [];
    releaseEscorts(galaxy, mega);
    if (mega.announced !== true) {
        mega.announced = true;
        tellHumans(galaxy, allHumans(galaxy), T(`${TAG} Fired Title`), T(`${TAG} Fired`, mega.builderName), { good: true, popup: true, subject: mega.base ?? undefined });
    }
    fireMegaStation(galaxy);
    if (st.phase !== 'reclamation' || st.ended) {
        st.ended = true;
        threatGameEnd(galaxy, galaxy.playerEmpire, GameEndOutcome.Victory, T('Beacon Mega Title'), BEACON_CODE_MEGA, true);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The Long Night
// ---------------------------------------------------------------------------------------------------------------

/** What crosses the Long Night: the place, the progress and the pooled parts by empire name (plain data). Undefined: no mega-station. */
export interface MegaMemory {
    x: number;
    y: number;
    builderName: string;
    progress: number;
    activeDays: number;
    buildYears: number;
    pool: Record<string, EmpireParts>;
    delivered: number;
}

export function captureMega(galaxy: Galaxy): MegaMemory | undefined {
    const m = peekMega(galaxy);
    if (m === null || m.status === 'fired') return undefined;
    return { x: m.x, y: m.y, builderName: m.builderName, progress: m.progress, activeDays: m.activeDays, buildYears: m.buildYears, pool: JSON.parse(JSON.stringify(m.pool)) as Record<string, EmpireParts>, delivered: m.delivered };
}

/** The next age: the structure is at the same place, dormant, with its progress and pool; no base until an empire finds it, no vote until then. */
export function restoreMega(galaxy: Galaxy, data: unknown): void {
    if (data === null || typeof data !== 'object') return;
    const d = data as MegaMemory;
    if (typeof d.x !== 'number' || typeof d.y !== 'number') return;
    const st = beaconState(galaxy);
    const now = galaxyStarDate(galaxy);
    st.mega = {
        x: d.x,
        y: d.y,
        builder: -1,
        builderName: d.builderName,
        contributors: [],
        pool: d.pool ?? {},
        progress: d.progress ?? 0,
        activeDays: d.activeDays ?? 0,
        buildYears: d.buildYears ?? P.megaBuildMinYears(galaxy),
        status: 'dormant',
        since: now,
        lastStep: now,
        lastArrival: now,
        lastSent: 0,
        starvedDays: 0,
        base: null,
        contracts: [],
        delivered: d.delivered ?? 0,
        deliveredBy: {},
        foundBy: [],
        voted: false,
        refused: [],
    };
}

// ---------------------------------------------------------------------------------------------------------------
// The Knowledge page
// ---------------------------------------------------------------------------------------------------------------

/** A row of the Knowledge page's "Mega-station" section (the same shape as ui/knowledgeView.ts KnowledgeRow). */
export interface MegaKnowledgeRow {
    key: string;
    what: string;
    where: string;
    status: string;
    goTo: BuiltObject | null;
    point: { x: number; y: number } | null;
    fade: number;
}

function row(key: string, what: string, where: string, status: string, goTo: BuiltObject | null = null, point: { x: number; y: number } | null = null): MegaKnowledgeRow {
    return { key, what, where, status, goTo, point, fade: 1 };
}

/** Who holds what, in empire order, as "Name (n)" for the counted parts. Pure. */
function holders(galaxy: Galaxy, st: BeaconState, kind: PartKind): string[] {
    const out: string[] = [];
    for (const e of galaxy.empires) {
        if (e === null || e === galaxy.independentEmpire || e.pirateEmpireBaseHabitat !== null) continue;
        const n = partCount(st, e, kind);
        if (n > 0) out.push(kind === 'mindFragments' || kind === 'voidFrames' ? `${e.name} (${n})` : e.name);
    }
    return out;
}

/**
 * The rows of the Knowledge page's "Mega-station" section for `viewer`: who holds each unique piece (and the fragment / frame counts), the viewer's
 * blueprint, and the structure's place, progress, cap and status. Null: nothing to show yet (no parts, no blueprint, no structure). Pure.
 */
export function megaKnowledgeRows(galaxy: Galaxy, viewer: Empire): MegaKnowledgeRow[] | null {
    const st = peekBeaconState(galaxy);
    if (st === null || (st.parts === undefined && st.mega === undefined)) return null;
    const mega = st.mega ?? null;
    const t = mega === null ? null : poolTotals(mega);
    const rows: MegaKnowledgeRow[] = [];
    for (const kind of PART_KINDS) {
        const held = holders(galaxy, st, kind);
        const pooled = mega === null || t === null ? [] : Object.entries(mega.pool).filter(([, p]) => (kind === 'mindFragments' || kind === 'voidFrames' ? (p[kind] ?? 0) > 0 : p[kind] === true)).map(([n, p]) => (kind === 'mindFragments' || kind === 'voidFrames' ? `${n} (${p[kind] ?? 0})` : n));
        const need = partNeeded(galaxy, kind);
        const counted = kind === 'mindFragments' || kind === 'voidFrames';
        const total = counted ? (t === null ? 0 : t[kind]) + held.reduce((a, h) => a + Number(/\((\d+)\)$/.exec(h)?.[1] ?? 0), 0) : 0;
        const where = held.length === 0 && pooled.length === 0 ? T(`${TAG} Know Nobody`) : [held.length > 0 ? T(`${TAG} Know Held`, held.join(', ')) : '', pooled.length > 0 ? T(`${TAG} Know Pooled`, pooled.join(', ')) : ''].filter((s) => s !== '').join(' ');
        rows.push(row(`mega:${kind}`, partLabel(kind), where, counted ? T(`${TAG} Know Count`, total, need) : ''));
    }
    const bp = heldParts(st, viewer)?.blueprint;
    rows.push(row('mega:blueprint', T(`${TAG} Know Blueprint`), '', bp === undefined ? T(`${TAG} Know No Blueprint`) : bp.done === true ? T(`${TAG} Know Blueprint Done`) : T(`${TAG} Know Blueprint Pct`, Math.min(100, Math.round((100 * bp.progress) / P.blueprintCost(galaxy))))));
    if (mega !== null) {
        const pos = megaPosition(mega);
        const known = mega.voted || mega.foundBy.includes(viewer.empireId) || mega.contributors.includes(viewer.empireId) || galaxyAgeOf(galaxy) < 2;
        rows.push(
            row(
                'mega:structure',
                T(`${TAG} Know Structure`),
                known ? resolveSectorDescription(galaxy, pos.x, pos.y) : T(`${TAG} Know Unknown Place`),
                T(`${TAG} Know Status ${mega.status}`, Math.round(mega.progress * 100), Math.round(partsCap(galaxy, mega) * 100), Math.round(mega.buildYears), missingParts(galaxy, mega) || '-'),
                mega.base ?? null,
                known ? pos : null,
            ),
        );
    }
    return rows;
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

export function registerMega(): void {
    registerScenarioFramePeriodic({ id: 'beacon.megaStep', flag: BEACON_FLAG, order: 26, periodDays: 1, run: (g) => megaStep(g) });
    // the escorts' fuel is kept full several times a day, between the daily steps (megaEscort.ts supplyEscorts)
    registerScenarioFramePeriodic({ id: 'beacon.escortSupply', flag: BEACON_FLAG, order: 26, periodDays: 0.05, run: (g) => { const mega = peekMega(g); if (mega !== null && mega.status !== 'dormant' && mega.status !== 'fired') supplyEscorts(g, mega); } });
    registerScenarioQuery({ id: 'beacon.megaInvulnerable', flag: BEACON_FLAG, query: 'builtObjectInvulnerable', run: (g, v, a) => v || isMegaBase(g, a.builtObject) });
    registerScenarioQuery({ id: 'beacon.escortRefuel', flag: BEACON_FLAG, query: 'shipRefuelExempt', run: (g, v, a) => v || escortsFreight(g, a.builtObject) });
}
