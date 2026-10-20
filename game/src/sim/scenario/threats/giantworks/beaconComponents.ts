// The Beacon, part 6: the mega-station path, Age 1 (beaconState.ts PartsRec). Not a port.
//
//   PARTS      per empire, saved in the Beacon state (so later ages carry them): the beam lens (the Beacon destroyed after it fired), the link conduit
//              (a harvester destroyed), the cloak lattice (a Watcher destroyed), mind fragments (Reclaimer capital ships destroyed; 30 needed) and void
//              frames (foundries destroyed; 4 needed; foundries do not exist yet: creditFoundry is the hook). CREDIT: the empire whose ship made the kill
//              (builtObjectKilledBy's destroyer; for the Beacon, its destroyer). Allies get nothing by the kill: parts are traded (a trade item type,
//              tradeItems.ts ScenarioPart) between empires on good terms and pass to the captor with a captured capital (capitalLost).
//   THE ASSETS the Reclaimers' ships, bases (by strength) and held worlds (each worth beaconAssetWorldShips average ships), against their peak. The
//              threat's victory (beacon.ts beaconEndCheck): 95% of the peak destroyed. The Beacon's own destruction no longer wins: the Reclamation goes on.
//   THE YARD   with the Beacon gone the Reclaimers' ships are made at, and gather round, their biggest held world (beaconPosition).
//   THE PLANET one year after the first mega beam every empire learns of a precursor world adrift in the void between systems (a map marker: a point
//              in deep space). An empire whose ship comes within beaconPlanetReach of it gets the mega-station BLUEPRINT: a research project of
//              beaconBlueprintCost points that takes a share of the empire's research output (researchSinkShare / researchSunk), its progress saved. Every
//              empire that reaches the planet gets its own blueprint, so the AIs race for it: each sends one ship some weeks after the reveal.
// Rnd: only the private beaconRandom (the planet's place); no galaxy.rnd.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { BuiltObject } from '../../../builtObject';
import { BuiltObjectSubRole } from '../../../builtObjectTypes';
import { BuiltObjectRole } from '../../../data/designSpecifications';
import { EmpireMessageType } from '../../../messages';
import { galaxyStarDate } from '../../../tick/simTime';
import { isHumanEmpire } from '../../../humanEmpires';
import { resolveSectorDescription } from '../../../empireEvents';
import { assignMission } from '../../../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType } from '../../../missions/mission';
import { obtainEmpireEvaluation } from '../../../diplomacy';
import { obtainDiplomaticRelation, DiplomaticRelationType } from '../../../diplomacy';
import { GAME_DAY_LENGTH, registerScenarioEvent, registerScenarioFramePeriodic, registerScenarioQuery } from '../../hooks';
import { scenarioMessage, scenarioNews, scenarioText as T } from '../../messages';
import { reputationSum } from '../../reputation/ledger';
import { arcMessage, arcNews, guardiansOf, normalEmpires } from '../framework';
import { BEACON_FLAG, P, beaconRandom, peekBeaconState, warOn, type BeaconState, type EmpireParts, type PartsRec } from './beaconState';
import { liveCores } from './beaconHarvest';
import { processingWorlds, strengthOf } from './beaconFleet';
import { dietOn } from '../../charactersVictory/diet/dietState';
import { scenarioFlag } from '../../state';

const TAG = 'Beacon';

function days(n: number): number {
    return n * GAME_DAY_LENGTH;
}

// ---------------------------------------------------------------------------------------------------------------
// The parts
// ---------------------------------------------------------------------------------------------------------------

export type PartKind = 'beamLens' | 'linkConduit' | 'cloakLattice' | 'mindFragments' | 'voidFrames';
export const PART_KINDS: readonly PartKind[] = ['beamLens', 'linkConduit', 'cloakLattice', 'mindFragments', 'voidFrames'];

const PART_LABEL: Record<PartKind, string> = {
    beamLens: 'Beacon Part Beam Lens',
    linkConduit: 'Beacon Part Link Conduit',
    cloakLattice: 'Beacon Part Cloak Lattice',
    mindFragments: 'Beacon Part Mind Fragments',
    voidFrames: 'Beacon Part Void Frames',
};

export function partLabel(kind: PartKind): string {
    return T(PART_LABEL[kind]);
}

/** The record (created on first use). */
export function partsOf(st: BeaconState): PartsRec {
    return (st.parts ??= { held: {}, peakAssets: 0, lastAssets: 0, shipUnit: 0, firstBeam: 0, revealDate: 0, visited: [] });
}

/** What `e` holds, read only. */
export function heldParts(st: BeaconState, e: Empire): EmpireParts | undefined {
    return st.parts?.held[String(e.empireId)];
}

function mine(st: BeaconState, e: Empire): EmpireParts {
    return (partsOf(st).held[String(e.empireId)] ??= {});
}

/** How many of a part `e` holds (a flag part is 0 or 1). Pure. */
export function partCount(st: BeaconState, e: Empire, kind: PartKind): number {
    const h = heldParts(st, e);
    if (h === undefined) return 0;
    const v = h[kind];
    return typeof v === 'number' ? v : v === true ? 1 : 0;
}

/** How many of a part the mega-station needs. */
export function partNeeded(galaxy: Galaxy, kind: PartKind): number {
    return kind === 'mindFragments' ? P.mindFragmentsNeeded(galaxy) : kind === 'voidFrames' ? P.voidFramesNeeded(galaxy) : 1;
}

/** `e` holds every part the mega-station needs and its blueprint is done. Pure. */
export function hasAllParts(galaxy: Galaxy, st: BeaconState, e: Empire): boolean {
    return PART_KINDS.every((k) => partCount(st, e, k) >= partNeeded(galaxy, k));
}

function humans(galaxy: Galaxy, es: readonly Empire[]): Empire[] {
    return es.filter((e) => e.active && isHumanEmpire(galaxy, e));
}

/** Gives `e` one of `kind` (a flag part once). Returns whether anything was added. A human gets a ticker message (mind fragments: the first, every tenth, the last). */
export function awardPart(galaxy: Galaxy, st: BeaconState, e: Empire, kind: PartKind, quiet = false): boolean {
    const h = mine(st, e);
    let count: number;
    if (kind === 'mindFragments' || kind === 'voidFrames') {
        count = (h[kind] = (h[kind] ?? 0) + 1);
    } else {
        if (h[kind] === true) return false;
        h[kind] = true;
        count = 1;
    }
    const need = partNeeded(galaxy, kind);
    const note = kind === 'mindFragments' ? count === 1 || count % 10 === 0 || count === need : true;
    if (!quiet && note && isHumanEmpire(galaxy, e)) {
        scenarioMessage(galaxy, e, T(`${TAG} Part Gained Title`), T(`${TAG} Part Gained`, partLabel(kind), count, need), { type: EmpireMessageType.GeneralGoodEvent });
    }
    return true;
}

// Credit hooks (beacon.ts onKilledBy). `destroyer`: the empire whose ship made the kill (null / a pirate / the independents: no credit).

function isCreditable(galaxy: Galaxy, st: BeaconState, e: Empire | null): e is Empire {
    return e !== null && e !== st.faction && e.active && e !== galaxy.independentEmpire && e.pirateEmpireBaseHabitat === null;
}

/** The Beacon was destroyed by `destroyer` after it had fired: the BEAM LENS. A human gets the vague warning; the Diet hails the end of the Reclamation. */
export function creditBeaconKill(galaxy: Galaxy, st: BeaconState, destroyer: Empire | null): void {
    if ((st.launches ?? 0) <= 0) return;
    if (isCreditable(galaxy, st, destroyer) && awardPart(galaxy, st, destroyer, 'beamLens', true) && isHumanEmpire(galaxy, destroyer)) {
        scenarioMessage(galaxy, destroyer, T(`${TAG} Lens Title`), T(`${TAG} Lens`, destroyer.name), { type: EmpireMessageType.GeneralNeutralEvent, popupMode: 'force' });
    }
    dietLine(galaxy, st, 'Hail', destroyer?.name ?? '');
}

/** A harvester was destroyed by `destroyer`: the LINK CONDUIT. */
export function creditHarvesterKill(galaxy: Galaxy, st: BeaconState, destroyer: Empire | null): void {
    if (isCreditable(galaxy, st, destroyer)) awardPart(galaxy, st, destroyer, 'linkConduit');
}

/** A Watcher was destroyed by `destroyer`: the CLOAK LATTICE. */
export function creditWatcherKill(galaxy: Galaxy, st: BeaconState, destroyer: Empire | null): void {
    if (isCreditable(galaxy, st, destroyer)) awardPart(galaxy, st, destroyer, 'cloakLattice');
}

/** A Reclaimer capital ship was destroyed by `destroyer`: one MIND FRAGMENT. */
export function creditCapitalKill(galaxy: Galaxy, st: BeaconState, destroyer: Empire | null): void {
    if (isCreditable(galaxy, st, destroyer)) awardPart(galaxy, st, destroyer, 'mindFragments');
}

/** A foundry was destroyed by `destroyer`: one VOID FRAME. (The hook for the later ages: foundries do not exist yet.) */
export function creditFoundryKill(galaxy: Galaxy, st: BeaconState, destroyer: Empire | null): void {
    if (isCreditable(galaxy, st, destroyer)) awardPart(galaxy, st, destroyer, 'voidFrames');
}

/** Everything `from` holds goes to `to` (a captured capital): flags join, counts add; the blueprint stays with its owner. A human captor / victim is told. */
export function transferParts(galaxy: Galaxy, st: BeaconState, from: Empire, to: Empire): boolean {
    const a = heldParts(st, from);
    if (a === undefined || from === to) return false;
    const b = mine(st, to);
    let any = false;
    for (const k of ['beamLens', 'linkConduit', 'cloakLattice'] as const) {
        if (a[k] === true) {
            b[k] = true;
            delete a[k];
            any = true;
        }
    }
    for (const k of ['mindFragments', 'voidFrames'] as const) {
        if ((a[k] ?? 0) > 0) {
            b[k] = (b[k] ?? 0) + (a[k] ?? 0);
            delete a[k];
            any = true;
        }
    }
    if (any) for (const e of humans(galaxy, [from, to])) scenarioMessage(galaxy, e, T(`${TAG} Parts Captured Title`), T(`${TAG} Parts Captured`, from.name, to.name), { type: e === to ? EmpireMessageType.GeneralGoodEvent : EmpireMessageType.GeneralBadEvent });
    return any;
}

/** One part given in a trade (tradeItems.ts ScenarioPart): moved from `giver` to `receiver`. `part` is the PartKind. */
export function tradePart(galaxy: Galaxy, st: BeaconState, giver: Empire, receiver: Empire, part: string): boolean {
    const kind = PART_KINDS.find((k) => k === part);
    if (kind === undefined) return false;
    const a = heldParts(st, giver);
    if (a === undefined) return false;
    const b = mine(st, receiver);
    if (kind === 'mindFragments' || kind === 'voidFrames') {
        const n = a[kind] ?? 0;
        if (n <= 0) return false;
        a[kind] = 0;
        b[kind] = (b[kind] ?? 0) + n;
    } else {
        if (a[kind] !== true) return false;
        a[kind] = false;
        b[kind] = true;
    }
    return true;
}

/** `giver` will hand parts to `receiver`: not at war, an attitude of at least beaconPartTradeAttitude (+10) toward it and a reputation ledger not worse than -25. Pure. */
export function partTradeAllowed(galaxy: Galaxy, giver: Empire, receiver: Empire): boolean {
    if (giver === receiver || giver.pirateEmpireBaseHabitat !== null || receiver.pirateEmpireBaseHabitat !== null) return false;
    const dr = obtainDiplomaticRelation(giver, receiver);
    if (dr.type === DiplomaticRelationType.War || dr.type === DiplomaticRelationType.TradeSanctions) return false;
    if (obtainEmpireEvaluation(galaxy, giver, receiver).overallAttitude < P.partTradeAttitude(galaxy)) return false;
    return reputationSum(galaxy, { empireId: giver.empireId }, { empireId: receiver.empireId }) >= -25;
}

/** The part items `giver` can hand `receiver` (an empire on good terms with it), for the trade lists. */
export function tradeablePartItems(galaxy: Galaxy, giver: Empire, receiver: Empire): { part: string; label: string; value: number }[] {
    const st = peekBeaconState(galaxy);
    if (st === null || st.parts === undefined || heldParts(st, giver) === undefined || !partTradeAllowed(galaxy, giver, receiver)) return [];
    const out: { part: string; label: string; value: number }[] = [];
    for (const k of PART_KINDS) {
        const n = partCount(st, giver, k);
        if (n > 0) out.push({ part: k, label: n > 1 ? `${partLabel(k)} (${n})` : partLabel(k), value: P.partTradeValue(galaxy) * n });
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The Diet's line (the fake-out)
// ---------------------------------------------------------------------------------------------------------------

/** A Galactic Diet news line that presents destroying the Beacon as the way to end the Reclaimers ('Hope': when the Beacon first fires; 'Hail': when it falls). Once each. */
export function dietLine(galaxy: Galaxy, st: BeaconState, kind: 'Hope' | 'Hail', arg: string): void {
    if (!dietOn(galaxy)) return;
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: `Diet ${kind}`, textTag: `${TAG} Diet ${kind} News`, args: [arg] });
}

// ---------------------------------------------------------------------------------------------------------------
// The assets and the victory
// ---------------------------------------------------------------------------------------------------------------

/** The Reclaimers' assets now: their ships and bases by strength plus each held world as beaconAssetWorldShips average ships. Updates the peak and the ship unit. */
export function measureAssets(galaxy: Galaxy, st: BeaconState): number {
    const faction = st.faction;
    if (faction === null) return 0;
    const rec = partsOf(st);
    let total = 0;
    let ships = 0;
    let shipTotal = 0;
    for (const b of faction.builtObjects) {
        if (b.hasBeenDestroyed) continue;
        const s = strengthOf(b);
        total += s;
        if (b.role !== BuiltObjectRole.Base && s > 0) {
            ships++;
            shipTotal += s;
        }
    }
    if (ships > 0) rec.shipUnit = Math.max(rec.shipUnit, shipTotal / ships);
    total += processingWorlds(st).length * P.assetWorldShips(galaxy) * rec.shipUnit;
    rec.lastAssets = total;
    rec.peakAssets = Math.max(rec.peakAssets, total);
    return total;
}

/** The share (0-100) of the Reclaimers' peak assets still standing at the last measure. Pure. */
export function assetsLeftPct(st: BeaconState): number {
    const r = st.parts;
    return r === undefined || r.peakAssets <= 0 ? 100 : Math.max(0, Math.min(100, (100 * r.lastAssets) / r.peakAssets));
}

/** True when the Reclaimers' assets are down to the victory share of their peak (and the peak was a real force). Pure. */
export function assetsBroken(galaxy: Galaxy, st: BeaconState): boolean {
    const r = st.parts;
    if (r === undefined || (st.launches ?? 0) <= 0 || r.peakAssets <= 0) return false;
    if (r.peakAssets < P.assetMinPeakShips(galaxy) * r.shipUnit) return false;
    return r.lastAssets <= (r.peakAssets * (100 - P.assetVictoryPct(galaxy))) / 100;
}

/** The mega-station fired (placeholder for the later ages: the threat's other victory; beacon.ts beaconEndCheck declares it). */
export function fireMegaStation(galaxy: Galaxy): void {
    const st = peekBeaconState(galaxy);
    if (st !== null) st.megaFired = true;
}

/** The Reclaimers' yard once the Beacon is gone: their most populous held world (a core first). Cleared while they hold none (they then use the site). */
export function refreshYard(st: BeaconState): void {
    const gone = st.beacon === null || st.beacon.hasBeenDestroyed || st.beaconDestroyed;
    if (!gone || st.faction === null) {
        delete st.yard;
        return;
    }
    let best: { x: number; y: number } | null = null;
    let bv = -1;
    for (const c of liveCores(st)) {
        const v = 1e12 + (c.colony.population?.totalAmount ?? 0);
        if (c.colony.empire === st.faction && !c.colony.hasBeenDestroyed && v > bv) {
            bv = v;
            best = { x: c.colony.xpos, y: c.colony.ypos };
        }
    }
    for (const r of processingWorlds(st)) {
        const v = r.colony.population?.totalAmount ?? 0;
        if (v > bv) {
            bv = v;
            best = { x: r.colony.xpos, y: r.colony.ypos };
        }
    }
    if (best === null) delete st.yard;
    else st.yard = best;
}

// ---------------------------------------------------------------------------------------------------------------
// The drifting planet and the blueprint
// ---------------------------------------------------------------------------------------------------------------

/** The first mega beam fired: the reveal's clock starts. */
export function noteFirstBeam(galaxy: Galaxy, st: BeaconState): void {
    const r = partsOf(st);
    if (r.firstBeam === 0) r.firstBeam = galaxyStarDate(galaxy);
    dietLine(galaxy, st, 'Hope', '');
}

/** A point in deep space between systems, well inland (a private draw): the most isolated of a few hundred samples of the galaxy's middle. */
function pickPlanetPlace(galaxy: Galaxy, st: BeaconState): { x: number; y: number } {
    const rnd = beaconRandom(galaxy, st, 61);
    const stars: { x: number; y: number }[] = [];
    for (const sys of galaxy.systems) {
        const s = sys?.systemStar;
        if (s !== undefined && s !== null) stars.push({ x: s.xpos, y: s.ypos });
    }
    let best = { x: galaxy.sizeX / 2, y: galaxy.sizeY / 2 };
    let bd = -1;
    for (let i = 0; i < 300; i++) {
        const x = galaxy.sizeX * (0.2 + 0.6 * rnd.nextDouble());
        const y = galaxy.sizeY * (0.2 + 0.6 * rnd.nextDouble());
        let nearest = Infinity;
        for (const s of stars) {
            const d = (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y);
            if (d < nearest) nearest = d;
        }
        if (nearest > bd) {
            bd = nearest;
            best = { x, y };
        }
    }
    return best;
}

/** The place is known to every empire: a popup for each human, a ticker line for all. */
function revealPlanet(galaxy: Galaxy, st: BeaconState, now: number): void {
    const r = partsOf(st);
    r.planet = pickPlanetPlace(galaxy, st);
    r.revealDate = now;
    const sector = resolveSectorDescription(galaxy, r.planet.x, r.planet.y);
    arcMessage(galaxy, st.sentStages, humans(galaxy, normalEmpires(galaxy, st.faction)), { prefix: TAG, stage: 'Reveal', type: EmpireMessageType.GeneralNeutralEvent, args: [sector] });
    arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Reveal', textTag: `${TAG} Reveal News`, args: [sector] });
}

/** The planet is where the Guardians' word put it: known to every empire from the reveal on. */
export function planetKnown(st: BeaconState): { x: number; y: number } | null {
    return st.parts !== undefined && st.parts.revealDate > 0 && st.parts.planet !== undefined ? st.parts.planet : null;
}

function reachers(galaxy: Galaxy, st: BeaconState): Empire[] {
    const g = guardiansOf(galaxy);
    return normalEmpires(galaxy, st.faction).filter((e) => e !== g && !st.parts!.visited.includes(e.empireId));
}

/** An empire's ship reached the planet: it gets its own blueprint (a human is told). */
function onReached(galaxy: Galaxy, st: BeaconState, e: Empire, now: number): void {
    const r = partsOf(st);
    if (r.visited.includes(e.empireId)) return;
    const first = r.visited.length === 0;
    r.visited.push(e.empireId);
    mine(st, e).blueprint = { since: now, progress: 0, sharePct: P.blueprintSharePct(galaxy) };
    if (isHumanEmpire(galaxy, e)) {
        scenarioMessage(galaxy, e, T(`${TAG} Blueprint Title`), T(`${TAG} Blueprint`, Math.round(P.blueprintCost(galaxy)).toLocaleString('en-US'), P.blueprintSharePct(galaxy)), { type: EmpireMessageType.GeneralGoodEvent, popupMode: 'force' });
    }
    if (first) arcNews(galaxy, st.sentStages, { prefix: TAG, stage: 'Blueprint', textTag: `${TAG} Blueprint News`, args: [e.name] });
}

/** Daily after the reveal: ships within reach of the planet (an empire's own first), the AIs' dispatch. */
export function planetWatch(galaxy: Galaxy): void {
    const st = peekBeaconState(galaxy);
    const place = st === null ? null : planetKnown(st);
    if (st === null || place === null) return;
    const now = galaxyStarDate(galaxy);
    const reach = P.planetReach(galaxy);
    const r2 = reach * reach;
    for (const e of reachers(galaxy, st)) {
        for (const b of e.builtObjects) {
            if (b.hasBeenDestroyed || b.role === BuiltObjectRole.Base) continue;
            const dx = b.xpos - place.x;
            const dy = b.ypos - place.y;
            if (dx * dx + dy * dy <= r2) {
                onReached(galaxy, st, e, now);
                break;
            }
        }
    }
}

const AI_SENDERS = [BuiltObjectSubRole.ExplorationShip, BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Cruiser];

/** Every 5 days: the AIs that have not reached the planet send one ship (some weeks after the reveal, each at its own delay); a lost or stuck one is replaced. */
function dispatchAi(galaxy: Galaxy, st: BeaconState, now: number): void {
    const place = planetKnown(st);
    if (place === null) return;
    const r = partsOf(st);
    const sent = (r.sent ??= {});
    for (const e of reachers(galaxy, st)) {
        if (isHumanEmpire(galaxy, e)) continue;
        if (now < r.revealDate + days(20 + ((e.empireId * 37) % 180))) continue;
        const rec = sent[String(e.empireId)];
        const ship = rec === undefined ? undefined : e.builtObjects.find((b) => b.builtObjectID === rec.id && !b.hasBeenDestroyed);
        if (ship !== undefined && now - rec!.date < days(300)) continue;
        let best: BuiltObject | null = null;
        let bd = Infinity;
        for (const b of e.builtObjects) {
            if (b.hasBeenDestroyed || b.topSpeed <= 0 || !AI_SENDERS.includes(b.subRole) || b.shipGroup !== null) continue;
            if (rec !== undefined && b.builtObjectID === rec.id) continue;
            const d = (b.xpos - place.x) * (b.xpos - place.x) + (b.ypos - place.y) * (b.ypos - place.y);
            if (d < bd) {
                bd = d;
                best = b;
            }
        }
        if (best === null) continue;
        best.isAutoControlled = false;
        assignMission(galaxy, best, BuiltObjectMissionType.Move, null, null, BuiltObjectMissionPriority.High, { x: place.x, y: place.y, manuallyAssigned: true });
        sent[String(e.empireId)] = { id: best.builtObjectID, date: now };
    }
}

/** The share of `e`'s research a blueprint takes now (0..1; 0 when it has none, it is paused or done). Pure. */
export function blueprintShare(st: BeaconState, e: Empire): number {
    const bp = heldParts(st, e)?.blueprint;
    return bp === undefined || bp.done === true ? 0 : Math.max(0, Math.min(100, bp.sharePct)) / 100;
}

/** Sets the share (%) of `e`'s research its blueprint takes (0 pauses it). For the Knowledge page. */
export function setBlueprintShare(galaxy: Galaxy, e: Empire, pct: number): boolean {
    const st = peekBeaconState(galaxy);
    const bp = st === null ? undefined : heldParts(st, e)?.blueprint;
    if (bp === undefined) return false;
    bp.sharePct = Math.max(0, Math.min(100, pct));
    return true;
}

function onResearchSunk(galaxy: Galaxy, e: Empire, points: number): void {
    const st = peekBeaconState(galaxy);
    const bp = st === null ? undefined : heldParts(st, e)?.blueprint;
    if (st === null || bp === undefined || bp.done === true || !(points > 0)) return;
    bp.progress += points;
    const cost = P.blueprintCost(galaxy);
    if (bp.progress >= cost) {
        bp.progress = cost;
        bp.done = true;
        if (isHumanEmpire(galaxy, e)) scenarioMessage(galaxy, e, T(`${TAG} Blueprint Done Title`), T(`${TAG} Blueprint Done`), { type: EmpireMessageType.GeneralGoodEvent, popupMode: 'force' });
    }
}

/** The blueprint's progress (0-1) for `e`; null without one. Pure. */
export function blueprintProgress(galaxy: Galaxy, st: BeaconState, e: Empire): number | null {
    const bp = heldParts(st, e)?.blueprint;
    return bp === undefined ? null : Math.min(1, bp.progress / P.blueprintCost(galaxy));
}

// ---------------------------------------------------------------------------------------------------------------
// The pass (every reclamation pass) and registration
// ---------------------------------------------------------------------------------------------------------------

/** Every reclamation pass: the yard, the asset measure, the reveal, the AIs' dispatch. */
export function partsPass(galaxy: Galaxy, st: BeaconState, now: number): void {
    refreshYard(st);
    measureAssets(galaxy, st);
    const r = partsOf(st);
    if (r.firstBeam === 0 && warOn(st)) r.firstBeam = st.lastLaunchDate ?? now; // (the Beacon fell before it fired, or a save from before this record: the war's start stands for the beam)
    if (r.firstBeam > 0 && r.revealDate === 0 && now >= r.firstBeam + days(P.revealDays(galaxy))) revealPlanet(galaxy, st, now);
    dispatchAi(galaxy, st, now);
}

/** The Diet's line and the map marker use these. The marker label of the drifting planet. */
export function planetMarkerLabel(): string {
    return T(`${TAG} Planet Marker`);
}


export function registerComponents(): void {
    registerScenarioFramePeriodic({ id: 'beacon.planet', flag: BEACON_FLAG, order: 24, periodDays: 1, run: (g) => planetWatch(g) });
    registerScenarioQuery({ id: 'beacon.blueprintSink', flag: BEACON_FLAG, query: 'researchSinkShare', run: (g, v, a) => {
        const st = peekBeaconState(g);
        return st === null || st.parts === undefined ? v : Math.max(v, blueprintShare(st, a.empire));
    } });
    registerScenarioEvent({ id: 'beacon.blueprintSunk', flag: BEACON_FLAG, event: 'researchSunk', run: (g, e) => onResearchSunk(g, e.empire, e.points) });
    registerScenarioEvent({ id: 'beacon.capitalLost', flag: BEACON_FLAG, event: 'capitalLost', run: (g, e) => {
        const st = peekBeaconState(g);
        if (st !== null && e.capturer !== null && e.capturer !== st.faction && e.empire !== st.faction) transferParts(g, st, e.empire, e.capturer);
    } });
    registerScenarioQuery({ id: 'beacon.partItems', flag: BEACON_FLAG, query: 'tradeablePartItems', run: (g, v, a) => [...v, ...tradeablePartItems(g, a.giver, a.receiver)] });
    registerScenarioQuery({ id: 'beacon.partTrade', flag: BEACON_FLAG, query: 'partTradeAllowed', run: (g, v, a) => v && partTradeAllowed(g, a.giver, a.receiver) });
    // A destroyed Reclaimer foundry (beaconFoundry.ts) is a void frame for the empire that destroyed it.
    registerScenarioEvent({ id: 'beacon.foundryFrame', flag: BEACON_FLAG, event: 'foundryDestroyed', run: (g, e) => {
        const st = peekBeaconState(g);
        if (st !== null && e.empire !== null) creditFoundryKill(g, st, e.empire);
    } });
    registerScenarioEvent({ id: 'beacon.partTraded', flag: BEACON_FLAG, event: 'partTraded', run: (g, e) => {
        const st = peekBeaconState(g);
        if (st !== null) tradePart(g, st, e.giver, e.receiver, e.part);
    } });
}

void scenarioFlag;
void scenarioNews;
