// Characters & Victory: governors on every colony (docs/CHARACTERS_AND_VICTORY.md §5). Not a port. It reads and
// changes the game only through ported paths: the stock generator (Empire.6.cs 4413 GenerateNewCharacter), the stock
// transfer (Character.cs 4418 TransferToNewLocation, which the VIP package turns into a shuttle trip), the colony's
// development level (Habitat.cs SetDevelopmentLevel), its population list, and the mod layer's stability-term and
// tax-revenue channels (the internal-security ledger lists the vacancy term).
//
// Rnd: galaxy.rnd is drawn only in the gated per-empire review (the local-rise delay, the stock generator's own draws
// for trained / risen governors, the shuttle spawns of the moves). Queries and the stability term are pure.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import type { BuiltObject } from '../../builtObject';
import { type Character, CharacterRole, CharacterSkillType, CharacterTraitType, generateNewCharacter, getEmpireCharacters, isBuiltObjectLocation, stellarObjectCharacters } from '../../characters';
import { PlanetaryFacilityType } from '../../researchSystem';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../../diplomacy';
import { EmpireMessageType } from '../../messages';
import { strategicValue } from '../../territory';
import { empireApprovalRating } from '../../taxes';
import { calculateScenicFactorIncludingRuinsWonders } from '../../civilianAI';
import { YEAR_LENGTH } from '../../galaxyTime';
import { galaxyStarDate } from '../../tick/simTime';
import { isHumanEmpire } from '../../humanEmpires';
import { registerScenarioEvent, registerScenarioQuery, registerScenarioYearly } from '../hooks';
import { registerStabilityTerm } from '../stability';
import { scenarioMessage, scenarioText } from '../messages';
import { colonyGovernor, registerGovernorSpawner } from '../governors';
import {
    CV_FLAG,
    CV_GOV_FLAG,
    CV_VIP_FLAG,
    DAY,
    type CvColony,
    type CvState,
    type GovernorSuggestion,
    cvEmpire,
    cvOn,
    cvParam,
    cvState,
    isCvEmpire,
    peekCvState,
    tripOfCharacter,
} from './common';
import { reviewVipDesign } from './shuttleDesign';

// ---------------------------------------------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------------------------------------------

function govOn(galaxy: Galaxy, e: Empire | null): e is Empire {
    return cvOn(galaxy, CV_GOV_FLAG) && isCvEmpire(galaxy, e);
}

const colonyIndex = new WeakMap<CvState, { len: number; map: Map<Habitat, CvColony> }>();

function colonyRecMap(st: CvState): Map<Habitat, CvColony> {
    let ix = colonyIndex.get(st);
    if (ix === undefined || ix.len !== st.colonies.length) {
        ix = { len: st.colonies.length, map: new Map(st.colonies.map((c) => [c.colony, c] as const)) };
        colonyIndex.set(st, ix);
    }
    return ix.map;
}

/** The colony's vacancy record (null: none yet). Pure. */
export function peekColonyRec(galaxy: Galaxy, h: Habitat): CvColony | null {
    const st = peekCvState(galaxy);
    if (st === null || st.colonies.length === 0) return null;
    return colonyRecMap(st).get(h) ?? null;
}

function colonyRec(galaxy: Galaxy, h: Habitat, now: number): CvColony {
    const st = cvState(galaxy);
    const m = colonyRecMap(st);
    let r = m.get(h);
    if (r === undefined) {
        r = { colony: h, vacantSince: -1, neglect: 0, updated: now, riseAt: -1, disrepairCarry: 0, emigrationCarry: 0, warned: false };
        st.colonies.push(r);
        m.set(h, r);
        colonyIndex.get(st)!.len = st.colonies.length;
    }
    return r;
}

/** Active ColonyGovernors of `e`. */
export function empireGovernors(e: Empire): Character[] {
    return getEmpireCharacters(e).filter((c) => c.active && c.role === CharacterRole.ColonyGovernor);
}

/** Governor cap = colonies + the reserve target (§5.1). */
export function governorCap(galaxy: Galaxy, e: Empire): number {
    const n = e.colonies.length;
    return n + Math.max(1, Math.ceil((n * cvParam(galaxy, 'cvReservePct')) / 100));
}

/** The colony a travelling governor is heading to (null: not travelling to one of its empire's colonies). */
function tripTarget(galaxy: Galaxy, c: Character): Habitat | null {
    const t = tripOfCharacter(galaxy, c);
    const d = t !== null ? t.destination : c.transferDestination;
    if (d === null || isBuiltObjectLocation(d)) return null;
    const h = d as Habitat;
    return h.empire === c.empire ? h : null;
}

/** Part 2 duty records (council delegates): character → the post they keep while away. */
interface Duty {
    character: Character;
    post: Habitat;
    reason: string;
}
function duties(st: CvState): Duty[] {
    const s = st as CvState & { duties?: Duty[] };
    return (s.duties ??= []);
}

// ---------------------------------------------------------------------------------------------------------------
// Fit (§5.5)
// ---------------------------------------------------------------------------------------------------------------

interface Needs {
    value: number;
    w: Partial<Record<CharacterSkillType, number>>;
    construction: boolean;
    crisis: boolean;
    war: boolean;
}

function colonyNeeds(galaxy: Galaxy, e: Empire, h: Habitat, warEnemies: Empire[]): Needs {
    const pop = h.population?.totalAmount ?? 0;
    const growth = h.maxPopulation > 0 && pop < h.maxPopulation * 0.5;
    let building = false;
    for (const f of h.facilities ?? []) if (f !== null && f.constructionProgress < 1) building = true;
    const port = e.spacePorts.some((p) => p !== null && !p.hasBeenDestroyed && p.parentHabitat === h);
    const approval = empireApprovalRating(galaxy, h);
    const crisis = approval < 0;
    let war = false;
    if (warEnemies.length > 0) {
        const reach = galaxy.sectorSize * 2;
        outer: for (const en of warEnemies) {
            for (const c of en.colonies) {
                if (galaxy.calculateDistance(c.xpos, c.ypos, h.xpos, h.ypos) < reach) {
                    war = true;
                    break outer;
                }
            }
        }
    }
    let value = Math.sqrt(Math.max(1, strategicValue(h)));
    if (h === e.capital) value *= 2;
    else if ((h.facilities ?? []).some((f) => f !== null && f.type === PlanetaryFacilityType.RegionalCapital && f.constructionProgress >= 1)) value *= 1.5;
    const scenic = Math.min(1, calculateScenicFactorIncludingRuinsWonders(h) / 2);
    const w: Needs['w'] = {
        [CharacterSkillType.ColonyIncome]: 1.0,
        [CharacterSkillType.ColonyCorruption]: 0.5,
        [CharacterSkillType.TradeIncome]: port ? 0.8 : 0.2,
        [CharacterSkillType.TourismIncome]: 0.2 + scenic,
        [CharacterSkillType.PopulationGrowth]: growth ? 1.0 : 0.1,
        [CharacterSkillType.ColonyHappiness]: crisis ? 1.5 : approval < 20 ? 0.8 : 0.3,
        [CharacterSkillType.MiningRate]: 0.3,
        [CharacterSkillType.TroopRecruitment]: war ? 0.8 : 0.1,
        [CharacterSkillType.MilitaryShipConstructionSpeed]: port ? (war ? 0.6 : 0.3) : 0,
        [CharacterSkillType.CivilianShipConstructionSpeed]: port ? 0.3 : 0,
        [CharacterSkillType.ColonyShipConstructionSpeed]: port ? 0.2 : 0,
        [CharacterSkillType.FacilityConstructionSpeed]: building ? 0.8 : 0.1,
    };
    return { value, w, construction: building || port, crisis, war };
}

/** fit(governor, colony) = colony value × (1 + Σ skill × need + traits) / 100 (§5.5). Pure. */
export function governorFit(c: Character, n: Needs): number {
    let score = 0;
    for (const [k, wt] of Object.entries(n.w)) score += c.getSkillLevel(Number(k) as CharacterSkillType) * (wt ?? 0);
    const t = c.traits;
    if (t.includes(CharacterTraitType.GoodAdministrator)) score += 10;
    if (t.includes(CharacterTraitType.Lawful)) score += 5;
    if (t.includes(CharacterTraitType.Corrupt)) score -= 10;
    if (t.includes(CharacterTraitType.Industrialist) && n.construction) score += 5;
    if (t.includes(CharacterTraitType.InspiringPresence)) score += 5;
    if (t.includes(CharacterTraitType.Demoralizing)) score -= 10;
    return n.value * Math.max(0.1, 1 + score / 100);
}

function enemiesAtWar(galaxy: Galaxy, e: Empire): Empire[] {
    const out: Empire[] = [];
    for (const o of galaxy.empires) if (o !== null && o !== e && o.active && obtainDiplomaticRelation(e, o).type === DiplomaticRelationType.War) out.push(o);
    return out;
}

/** UI: a governor's fit at a colony (null: not computable). Pure. */
export function fitAt(galaxy: Galaxy, c: Character, h: Habitat): number | null {
    const e = c.empire;
    if (e === null || h.empire !== e) return null;
    return governorFit(c, colonyNeeds(galaxy, e, h, enemiesAtWar(galaxy, e)));
}

// ---------------------------------------------------------------------------------------------------------------
// Vacancy (§5.3) and its effects
// ---------------------------------------------------------------------------------------------------------------

/** A governor of the colony's own empire is located at it (a travelling or off-duty one is not). */
export function colonyGoverned(h: Habitat): boolean {
    return colonyGovernor(h) !== null;
}

export interface VacancyView {
    vacant: boolean;
    since: number;
    neglect: number;
    graceLeftDays: number;
    enRoute: Character | null;
}

/** UI / Part 2: the colony's vacancy. Pure. */
export function colonyVacancy(galaxy: Galaxy, h: Habitat): VacancyView {
    const r = peekColonyRec(galaxy, h);
    const now = galaxyStarDate(galaxy);
    const vacant = !colonyGoverned(h);
    const since = vacant && r !== null && r.vacantSince >= 0 ? r.vacantSince : vacant ? now : -1;
    const grace = cvParam(galaxy, 'cvGraceDays') * DAY;
    let enRoute: Character | null = null;
    if (vacant && h.empire !== null) for (const c of empireGovernors(h.empire)) if (tripTarget(galaxy, c) === h) enRoute = c;
    return { vacant, since, neglect: r?.neglect ?? 0, graceLeftDays: vacant ? Math.max(0, (since + grace - now) / DAY) : 0, enRoute };
}

/** The neglect of `h` (0 without a record). Pure. */
export function colonyNeglect(galaxy: Galaxy, h: Habitat): number {
    const r = peekColonyRec(galaxy, h);
    return r === null ? 0 : r.neglect;
}

/** Updates one colony's vacancy and applies disrepair / emigration for the time since its last update. Draws (rise delay). */
function updateColony(galaxy: Galaxy, e: Empire, h: Habitat, now: number): CvColony {
    const st = cvState(galaxy);
    const r = colonyRec(galaxy, h, now);
    const dt = Math.max(0, now - r.updated);
    r.updated = now;
    const governed = colonyGoverned(h);
    const away = duties(st).some((d) => d.post === h && d.character.active);
    if (governed) {
        if (r.vacantSince >= 0) {
            st.counters.vacancyDaysTotal += (now - r.vacantSince) / DAY;
            st.counters.vacanciesEnded++;
        }
        r.vacantSince = -1;
        r.riseAt = -1;
        r.warned = false;
        r.neglect = Math.max(0, r.neglect - dt / (cvParam(galaxy, 'cvRecoveryYears') * YEAR_LENGTH));
        return r;
    }
    if (r.vacantSince < 0) {
        r.vacantSince = now;
        // RND(cv): the local rise delay, 1-3 years (§5.4).
        r.riseAt = away ? -1 : now + (360 + galaxy.rnd.next(0, 721)) * DAY;
    }
    const grace = cvParam(galaxy, 'cvGraceDays') * DAY;
    const pop = h.population?.totalAmount ?? 0;
    const declines = pop >= cvParam(galaxy, 'cvMinPopulation') * 1e6;
    const past = now - r.vacantSince - grace;
    if (declines && past > 0) {
        const eff = Math.min(dt, past);
        r.neglect = Math.min(1, r.neglect + eff / (cvParam(galaxy, 'cvDeclineYears') * YEAR_LENGTH));
        if (!r.warned && isHumanEmpire(galaxy, e)) {
            r.warned = true;
            scenarioMessage(galaxy, e, scenarioText('CV Colony Decline Title'), scenarioText('CV Colony Decline', h.name), { type: EmpireMessageType.GeneralWarning, subject: h });
        }
    }
    if (r.neglect >= 0.25) {
        r.disrepairCarry += (dt / YEAR_LENGTH) * cvParam(galaxy, 'cvDisrepairPerYear');
        while (r.disrepairCarry >= 1) {
            r.disrepairCarry -= 1;
            if (h.developmentLevel > 0) h.setDevelopmentLevel(h.developmentLevel - 1);
        }
    }
    if (r.neglect >= 0.5 && h.population !== null && pop > 0) {
        r.emigrationCarry += pop * 0.015 * r.neglect * (dt / YEAR_LENGTH);
        const loss = Math.floor(r.emigrationCarry);
        if (loss > 0) {
            r.emigrationCarry -= loss;
            for (const p of h.population.items) p.amount = Math.max(0, p.amount - Math.floor((loss * p.amount) / pop));
            h.population.recalculateTotalAmount();
        }
    }
    return r;
}

/** The colony's tax revenue × (1 − 0.5 · neglect) (§5.3). Pure. */
function taxRevenueQuery(galaxy: Galaxy, value: number, args: { habitat: Habitat; empire: Empire | null }): number {
    if (!govOn(galaxy, args.empire)) return value;
    const n = colonyNeglect(galaxy, args.habitat);
    return n > 0 ? value * (1 - 0.5 * n) : value;
}

// ---------------------------------------------------------------------------------------------------------------
// Supply: training, local rise, birthplaces (§5.2, §5.4)
// ---------------------------------------------------------------------------------------------------------------

function trainingSites(e: Empire): Habitat[] {
    const out: Habitat[] = [];
    if (e.capital !== null && e.capital.empire === e) out.push(e.capital);
    for (const h of e.colonies) {
        if (h === e.capital) continue;
        if ((h.facilities ?? []).some((f) => f !== null && f.type === PlanetaryFacilityType.RegionalCapital && f.constructionProgress >= 1)) out.push(h);
    }
    return out;
}

function academyType(role: CharacterRole): PlanetaryFacilityType | null {
    switch (role) {
        case CharacterRole.Scientist:
            return PlanetaryFacilityType.ScienceAcademy;
        case CharacterRole.TroopGeneral:
            return PlanetaryFacilityType.MilitaryAcademy;
        case CharacterRole.FleetAdmiral:
        case CharacterRole.ShipCaptain:
            return PlanetaryFacilityType.NavalAcademy;
        case CharacterRole.IntelligenceAgent:
            return PlanetaryFacilityType.SpyAcademy;
        default:
            return null;
    }
}

/** Where a new character of `role` appears (§5.2): the capital, or the matching academy nearest `intended`. Pure. */
export function birthplaceFor(galaxy: Galaxy, e: Empire, role: CharacterRole, intended: BuiltObject | Habitat): BuiltObject | Habitat {
    const capital = e.capital !== null && e.capital.empire === e ? e.capital : null;
    const kind = academyType(role);
    if (kind !== null) {
        let best: Habitat | null = null;
        let bd = Infinity;
        for (const h of e.colonies) {
            if (!(h.facilities ?? []).some((f) => f !== null && f.type === kind && f.constructionProgress >= 1)) continue;
            const d = galaxy.calculateDistance(h.xpos, h.ypos, intended.xpos, intended.ypos);
            if (d < bd) {
                bd = d;
                best = h;
            }
        }
        if (best !== null) return best;
    }
    return capital ?? intended;
}

/** A new governor for `colony` from another package (frontier / corporatecoup): appears at the capital, then travels. Draws. */
function spawnFor(galaxy: Galaxy, e: Empire, colony: Habitat): Character | null {
    if (!govOn(galaxy, e) || !cvOn(galaxy, CV_VIP_FLAG)) return null;
    const at = birthplaceFor(galaxy, e, CharacterRole.ColonyGovernor, colony);
    const c = generateNewCharacter(galaxy, e, CharacterRole.ColonyGovernor, at).character;
    if (at !== colony) c.transferToNewLocation(colony, galaxy);
    return c;
}
registerGovernorSpawner(spawnFor);

function reviewTraining(galaxy: Galaxy, e: Empire, now: number): void {
    const ce = cvEmpire(galaxy, e);
    const st = cvState(galaxy);
    // Finished training: a reserve appears at its site (the stock generator).
    for (const tr of [...ce.training]) {
        if (now < tr.until) continue;
        ce.training.splice(ce.training.indexOf(tr), 1);
        if (tr.site.empire !== e) continue;
        generateNewCharacter(galaxy, e, CharacterRole.ColonyGovernor, tr.site);
        st.counters.trained++;
        ce.stats.trained++;
    }
    const sites = trainingSites(e);
    const cap = governorCap(galaxy, e);
    let total = empireGovernors(e).length + ce.training.length;
    const cost = cvParam(galaxy, 'cvTrainCost');
    for (const s of sites) {
        if (total >= cap) break;
        if (ce.training.some((t) => t.site === s)) continue;
        if (e.stateMoney < cost) break;
        e.stateMoney -= cost;
        ce.training.push({ site: s, until: now + cvParam(galaxy, 'cvTrainDays') * DAY });
        total++;
    }
}

function localRise(galaxy: Galaxy, e: Empire, h: Habitat, r: CvColony, now: number): void {
    if (r.riseAt < 0 || now < r.riseAt) return;
    if (empireGovernors(e).length >= governorCap(galaxy, e)) return;
    r.riseAt = -1;
    const c = generateNewCharacter(galaxy, e, CharacterRole.ColonyGovernor, h).character;
    const st = cvState(galaxy);
    st.counters.localRises++;
    cvEmpire(galaxy, e).stats.risen++;
    if (isHumanEmpire(galaxy, e)) scenarioMessage(galaxy, e, scenarioText('CV Local Governor Title'), scenarioText('CV Local Governor', c.name, h.name), { type: EmpireMessageType.CharacterAppearance, subject: h });
}

// ---------------------------------------------------------------------------------------------------------------
// Placement automation (§5.6)
// ---------------------------------------------------------------------------------------------------------------

interface Holding {
    colony: Habitat;
    holder: Character | null;
    holderFit: number;
    needs: Needs;
    priority: number;
}

/** Governors free to move now: extras at a colony (not its best-fit holder) or stranded off any own colony, not travelling. */
function reserves(galaxy: Galaxy, e: Empire, holdings: Map<Habitat, Holding>): Character[] {
    const out: Character[] = [];
    for (const c of empireGovernors(e)) {
        if (tripOfCharacter(galaxy, c) !== null || c.transferDestination !== null) continue;
        if (duties(cvState(galaxy)).some((d) => d.character === c)) continue;
        const loc = c.location;
        if (loc === null) continue;
        if (isBuiltObjectLocation(loc)) {
            out.push(c);
            continue;
        }
        const hold = holdings.get(loc as Habitat);
        if (hold === undefined || hold.holder !== c) out.push(c);
    }
    return out;
}

function inTransit(galaxy: Galaxy, e: Empire): number {
    let n = 0;
    for (const c of empireGovernors(e)) if (tripOfCharacter(galaxy, c) !== null) n++;
    return n;
}

function travelYears(galaxy: Galaxy, c: Character, h: Habitat): number {
    const loc = c.location;
    if (loc === null) return 0;
    // A shuttle at hyperdrive speed: about 25 days per sector plus 10 days of departure / arrival.
    return (10 + (galaxy.calculateDistance(loc.xpos, loc.ypos, h.xpos, h.ypos) / galaxy.sectorSize) * 25) / 360;
}

/** One move: the stock transfer (a VIP trip), or a suggestion for a human without automation. */
function move(galaxy: Galaxy, e: Empire, c: Character, to: Habitat, from: Habitat | null, gainPct: number, priority: number): boolean {
    const ce = cvEmpire(galaxy, e);
    const human = isHumanEmpire(galaxy, e);
    const served = ce.requests.indexOf(to);
    if (human && !ce.automateGovernors && served < 0) {
        if (ce.suggestions.some((s) => s.character === c && s.to === to)) return false;
        ce.suggestions = ce.suggestions.filter((s) => s.to !== to && s.character !== c);
        const sug: GovernorSuggestion = { character: c, to, from, gainPct, priority, starDate: galaxyStarDate(galaxy) };
        ce.suggestions.push(sug);
        if (ce.suggestions.length > 20) ce.suggestions.shift();
        scenarioMessage(galaxy, e, scenarioText('CV Suggestion Title'), scenarioText(from === null ? 'CV Suggestion Reserve' : 'CV Suggestion Move', c.name, to.name, from?.name ?? '', Math.round(gainPct)), { type: EmpireMessageType.GeneralNeutralEvent, subject: to });
        return false;
    }
    if (served >= 0) ce.requests.splice(served, 1);
    c.transferToNewLocation(to, galaxy);
    cvState(galaxy).counters.governorMoves++;
    ce.stats.moves++;
    return true;
}

/** The empire's governor review: vacancies, effects, supply and placement. Draws. */
export function reviewGovernors(galaxy: Galaxy, e: Empire): void {
    if (!govOn(galaxy, e)) return;
    const now = galaxyStarDate(galaxy);
    const st = cvState(galaxy);
    const ce = cvEmpire(galaxy, e);
    const enemies = enemiesAtWar(galaxy, e);
    // Vacancies and their effects; holdings (the best-fit governor at each colony).
    const holdings = new Map<Habitat, Holding>();
    const colonies = [...e.colonies].sort((a, b) => a.habitatIndex - b.habitatIndex);
    for (const h of colonies) {
        const r = updateColony(galaxy, e, h, now);
        const needs = colonyNeeds(galaxy, e, h, enemies);
        let holder: Character | null = null;
        let holderFit = 0;
        for (const c of stellarObjectCharacters(h) ?? []) {
            if (!c.active || c.role !== CharacterRole.ColonyGovernor || c.empire !== e) continue;
            const f = governorFit(c, needs);
            if (holder === null || f > holderFit) {
                holder = c;
                holderFit = f;
            }
        }
        const priority = (holder === null ? 4 : 0) + (needs.crisis ? 2 : 0) + (needs.war ? 1 : 0);
        holdings.set(h, { colony: h, holder, holderFit, needs, priority });
        if (holder === null) localRise(galaxy, e, h, r, now);
    }
    reviewTraining(galaxy, e, now);
    // Placement.
    const transitCap = Math.max(1, Math.floor(e.colonies.length / cvParam(galaxy, 'cvTransitPerColonies')));
    let budget = Math.min(Math.trunc(cvParam(galaxy, 'cvMovesPerReview')), transitCap - inTransit(galaxy, e));
    const human = isHumanEmpire(galaxy, e);
    const tenure = cvParam(galaxy, 'cvTenureYears') * YEAR_LENGTH;
    const gainNeed = cvParam(galaxy, 'cvGainPct') / 100;
    const targeted = new Set<Habitat>();
    for (const c of empireGovernors(e)) {
        const t = tripTarget(galaxy, c);
        if (t !== null && c.transferDestination !== null) targeted.add(t);
    }
    for (const d of duties(st)) targeted.add(d.post);
    // Requested colonies first, then by priority and value.
    const order = [...holdings.values()].sort((a, b) => {
        const ra = ce.requests.includes(a.colony) ? 1 : 0;
        const rb = ce.requests.includes(b.colony) ? 1 : 0;
        return rb - ra || b.priority - a.priority || b.needs.value - a.needs.value || a.colony.habitatIndex - b.colony.habitatIndex;
    });
    let pool = reserves(galaxy, e, holdings);
    const sendable = (): boolean => budget > 0 || (human && !ce.automateGovernors);
    for (const hold of order) {
        if (!sendable()) break;
        const h = hold.colony;
        if (targeted.has(h)) continue;
        if (hold.holder === null) {
            // 1. A reserve (best fit, then nearest).
            let best: Character | null = null;
            let bestScore = -Infinity;
            for (const c of pool) {
                const s = governorFit(c, hold.needs) * (1 - Math.min(0.5, travelYears(galaxy, c, h)));
                if (s > bestScore) {
                    bestScore = s;
                    best = c;
                }
            }
            if (best !== null) {
                const fromLoc = best.location !== null && !isBuiltObjectLocation(best.location) ? (best.location as Habitat) : null;
                if (move(galaxy, e, best, h, null, 100, hold.priority)) {
                    budget--;
                    pool = pool.filter((x) => x !== best);
                    targeted.add(h);
                } else if (fromLoc !== null) pool = pool.filter((x) => x !== best);
                continue;
            }
            // 2. A promotion: a governor past tenure from a less valuable colony that is not stranded.
            let pick: Holding | null = null;
            let pickGain = 0;
            for (const other of holdings.values()) {
                const c = other.holder;
                if (c === null || other.colony === h || targeted.has(other.colony)) continue;
                if (now - c.transferArrivalDate < tenure && hold.priority < 6) continue;
                if (other.needs.value >= hold.needs.value) continue;
                // No stranding: the colony left behind must be small or reached by a reserve within the grace.
                const small = (other.colony.population?.totalAmount ?? 0) < cvParam(galaxy, 'cvMinPopulation') * 1e6;
                if (!small && other.needs.value * 2 > hold.needs.value) continue;
                const fNew = governorFit(c, hold.needs) * (1 - Math.min(0.5, travelYears(galaxy, c, h)));
                const gain = (fNew - other.holderFit) / Math.max(1e-9, other.holderFit);
                if (gain >= gainNeed && gain > pickGain) {
                    pick = other;
                    pickGain = gain;
                }
            }
            if (pick !== null && pick.holder !== null && move(galaxy, e, pick.holder, h, pick.colony, pickGain * 100, hold.priority)) {
                budget--;
                targeted.add(h);
                targeted.add(pick.colony);
            }
            continue;
        }
        // 3. Optimisation: a better-fit reserve replaces a holder past tenure (the holder becomes a reserve there).
        if (now - hold.holder.transferArrivalDate < tenure) continue;
        let best: Character | null = null;
        let bestGain = 0;
        for (const c of pool) {
            const f = governorFit(c, hold.needs) * (1 - Math.min(0.5, travelYears(galaxy, c, h)));
            const gain = (f - hold.holderFit) / Math.max(1e-9, hold.holderFit);
            if (gain >= gainNeed && gain > bestGain) {
                best = c;
                bestGain = gain;
            }
        }
        if (best !== null && move(galaxy, e, best, h, null, bestGain * 100, hold.priority)) {
            budget--;
            pool = pool.filter((x) => x !== best);
            targeted.add(h);
        }
    }
    // Drop suggestions that no longer apply.
    ce.suggestions = ce.suggestions.filter((s) => s.character.active && s.to.empire === e && tripOfCharacter(galaxy, s.character) === null && now - s.starDate < YEAR_LENGTH);
}

// ---------------------------------------------------------------------------------------------------------------
// Player commands (playerOps.ts) and Part 2 hooks
// ---------------------------------------------------------------------------------------------------------------

/** Player: accept a suggestion (the move happens through the stock transfer, a VIP trip). */
export function acceptGovernorSuggestion(galaxy: Galaxy, e: Empire, character: Character, to: Habitat): boolean {
    if (!govOn(galaxy, e) || character.empire !== e || to.empire !== e || !character.active) return false;
    const ce = cvEmpire(galaxy, e);
    ce.suggestions = ce.suggestions.filter((s) => s.character !== character && s.to !== to);
    character.transferToNewLocation(to, galaxy);
    cvState(galaxy).counters.governorMoves++;
    ce.stats.moves++;
    return true;
}

/** Player: request a governor for a vacant colony (served by the next review even without automation; trains if none). */
export function requestGovernor(galaxy: Galaxy, e: Empire, colony: Habitat): boolean {
    if (!govOn(galaxy, e) || colony.empire !== e) return false;
    const ce = cvEmpire(galaxy, e);
    if (!ce.requests.includes(colony)) ce.requests.push(colony);
    reviewGovernors(galaxy, e);
    return true;
}

/** Player: automation settings. */
export function setCvAutomation(galaxy: Galaxy, e: Empire, opts: { governors?: boolean; escorts?: boolean; escortLevel?: number }): boolean {
    if (!cvOn(galaxy, CV_GOV_FLAG) && !cvOn(galaxy, CV_VIP_FLAG)) return false;
    const ce = cvEmpire(galaxy, e);
    if (opts.governors !== undefined) ce.automateGovernors = opts.governors;
    if (opts.escorts !== undefined) ce.automateEscorts = opts.escorts;
    if (opts.escortLevel !== undefined && [0, 0.5, 1, 2].includes(opts.escortLevel)) ce.escortLevel = opts.escortLevel;
    return true;
}

/** Part 2: the governor of the empire's highest strategic-value colony (ties: skills, then name). Pure. */
export function mostImportantGovernor(galaxy: Galaxy, e: Empire): Character | null {
    void galaxy;
    let best: Character | null = null;
    let bv = -1;
    for (const h of e.colonies) {
        const c = colonyGovernor(h);
        if (c === null) continue;
        const v = strategicValue(h);
        if (v > bv || (v === bv && best !== null && (c.getSkillLevelTotal() > best.getSkillLevelTotal() || (c.getSkillLevelTotal() === best.getSkillLevelTotal() && c.name < best.name)))) {
            best = c;
            bv = v;
        }
    }
    return best;
}

/** Part 2: a governor leaves on duty (`reason`); their post is kept and the colony is vacant meanwhile. */
export function setGovernorDuty(galaxy: Galaxy, c: Character, reason: string): boolean {
    const loc = c.location;
    if (c.role !== CharacterRole.ColonyGovernor || loc === null || isBuiltObjectLocation(loc)) return false;
    const st = cvState(galaxy);
    const list = duties(st);
    if (list.some((d) => d.character === c)) return false;
    list.push({ character: c, post: loc as Habitat, reason });
    return true;
}

/** Part 2: the duty ends; the governor travels home to the kept post (a VIP trip). */
export function endGovernorDuty(galaxy: Galaxy, c: Character): boolean {
    const st = peekCvState(galaxy);
    if (st === null) return false;
    const list = duties(st);
    const d = list.find((x) => x.character === c);
    if (d === undefined) return false;
    list.splice(list.indexOf(d), 1);
    if (c.active && d.post.empire === c.empire && c.location !== d.post) c.transferToNewLocation(d.post, galaxy);
    return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------------------------

registerScenarioQuery({
    id: 'charactersVictory.capExempt',
    flag: CV_FLAG,
    query: 'characterCapExempt',
    run: (g, v, a) => (govOn(g, a.empire) ? v + empireGovernors(a.empire).length : v),
});
registerScenarioQuery({
    id: 'charactersVictory.roleLimit',
    flag: CV_FLAG,
    query: 'characterRoleLimit',
    run: (g, v, a) => (a.role === CharacterRole.ColonyGovernor && govOn(g, a.empire) ? { limit: governorCap(g, a.empire), shareCheck: false } : v),
});
registerScenarioQuery({
    id: 'charactersVictory.colonyGovernorSpawn',
    flag: CV_FLAG,
    query: 'colonyGovernorSpawnAllowed',
    run: (g, v, a) => (govOn(g, a.empire) ? empireGovernors(a.empire).length < governorCap(g, a.empire) : v),
});
registerScenarioQuery({
    id: 'charactersVictory.birthplace',
    flag: CV_FLAG,
    query: 'characterBirthplace',
    run: (g, v, a) => (cvOn(g, CV_VIP_FLAG) && isCvEmpire(g, a.empire) ? birthplaceFor(g, a.empire, a.role as CharacterRole, a.intended) : v),
});
registerScenarioEvent({
    id: 'charactersVictory.appeared',
    flag: CV_FLAG,
    event: 'characterAppeared',
    run: (g, ev) => {
        if (!cvOn(g, CV_VIP_FLAG) || !isCvEmpire(g, ev.empire)) return;
        const c = ev.character;
        // Agents never travel (their missions are abstract); a governor waits as a reserve for the placement review.
        if (c.role === CharacterRole.IntelligenceAgent || ev.intended === null || ev.intended === ev.birthplace) return;
        if (c.role === CharacterRole.ColonyGovernor && govOn(g, ev.empire) && !isBuiltObjectLocation(ev.intended) && colonyGoverned(ev.intended as Habitat) === false && ev.intended !== ev.empire.capital) {
            c.transferToNewLocation(ev.intended, g);
            return;
        }
        if (c.role !== CharacterRole.ColonyGovernor || !govOn(g, ev.empire)) c.transferToNewLocation(ev.intended, g);
    },
});
registerScenarioQuery({
    id: 'charactersVictory.governorPlacement',
    flag: CV_FLAG,
    query: 'characterLocationReviewSkip',
    run: (g, v, a) => v || (a.character.role === CharacterRole.ColonyGovernor && govOn(g, a.empire)),
});
registerScenarioQuery({ id: 'charactersVictory.taxes', flag: CV_FLAG, query: 'colonyTaxRevenue', run: taxRevenueQuery });
registerScenarioQuery({
    id: 'charactersVictory.construction',
    flag: CV_FLAG,
    query: 'colonyFacilityConstructionPaused',
    run: (g, v, a) => v || (govOn(g, a.habitat.empire) && colonyNeglect(g, a.habitat) > 0),
});
registerStabilityTerm({
    id: 'charactersVictory.vacancy',
    order: 90,
    flag: CV_FLAG,
    cause: 'vacancy',
    label: 'No governor',
    run: (g, h, e) => {
        if (!govOn(g, e)) return null;
        const n = colonyNeglect(g, h);
        return n > 0 ? -20 * n : null;
    },
});
registerScenarioEvent({ id: 'charactersVictory.governors', flag: CV_FLAG, event: 'charactersReviewed', run: (g, ev) => reviewGovernors(g, ev.empire) });
registerScenarioEvent({
    id: 'charactersVictory.colonyOwner',
    flag: CV_FLAG,
    event: 'colonyOwnerChanged',
    run: (g, ev) => {
        const st = peekCvState(g);
        if (st === null) return;
        const i = st.colonies.findIndex((r) => r.colony === ev.colony);
        if (i >= 0) st.colonies.splice(i, 1);
        for (const ce of Object.values(st.empires)) {
            ce.requests = ce.requests.filter((h) => h !== ev.colony);
            ce.suggestions = ce.suggestions.filter((s) => s.to !== ev.colony);
        }
    },
});
registerScenarioYearly({
    id: 'charactersVictory.design',
    flag: CV_FLAG,
    run: (g) => {
        if (!cvOn(g, CV_VIP_FLAG)) return;
        const st = peekCvState(g);
        if (st === null) return;
        for (const e of g.empires) if (isCvEmpire(g, e) && st.empires[e.empireId]?.design != null) reviewVipDesign(g, e);
    },
});
