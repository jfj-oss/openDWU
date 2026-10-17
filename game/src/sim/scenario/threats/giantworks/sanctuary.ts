// Giantworks: The Leviathan Sanctuary, a void aquarium (flag gwSanctuary). Not a port; composed from the stock resort income
// (treasury.ts addResortIncome), the colony growth wonder path (colonyWonderBonus), the research grant (archiveCores.ts), the Void
// Whale threat (voidWhale.ts: the Leviathan) and New Fauna (newFauna.ts: void whales). Registered from scenario/packages.ts; every
// handler is gated by the `threatGiantworks` flag, so with the add-on off nothing here runs, draws or is saved.
//
//   WHILE WHOLE  resort income (about 70% of the Gilded Orbit's, sanctuaryIncomePerYear) paid through the wonder's shares (the
//                territory owner, the Compact's cut, the Diet's members once internationalised) and booked as resort income;
//                +sanctuaryGrowthPct % population growth on the beneficiary's colonies within three sectors ("whale-song
//                therapy", the colonyWonderBonus path of a ColonyPopulationGrowth wonder); a small research trickle (biology) for
//                the beneficiary; the whales breed (site.whales 4 -> 7, which the station art draws).
//   BREACH       about 2% a year, and far more while the sphere is under stress: shots at the sphere, fighting within about 100,000 units of it (a few systems),
//                sabotage. A breach lets out the Leviathan (the Void Whale threat, once; switched on if the add-on is off) and 3-6
//                enraged void whales (New Fauna's species; stock creatures if New Fauna is off) that hyper-travel to the nearest colony
//                (the owner's first) and hunt there for sanctuaryRageDays. Every bonus is lost for a year of repairs paid by the owner, and the whales left inside are
//                few. The sanctuary is not hostile (destroying it is still the crime it always was); the whales are the crisis.
// Rnd: the add-on's own Random (nextRandom) for every choice of its own; the stock creature generation draws galaxy.rnd inside this
// module's gated handlers only.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { BuiltObject } from '../../../builtObject';
import type { Habitat } from '../../../types';
import { Creature, CreatureType } from '../../../creature';
import { militaryPotency } from '../../../diplomacyTick';
import { WonderType } from '../../../researchSystem';
import { calculateResearchOutputBonuses, calculateResearchTotal } from '../../../researchTick';
import { IndustryType } from '../../../types';
import { IntelligenceMissionType, intelligenceMissionTarget } from '../../../espionage';
import type { IntelligenceMission } from '../../../characters';
import { generateCreaturesAtLocation } from '../../../story/storyStart';
import { addResortIncome } from '../../../treasury';
import { EmpireMessageType } from '../../../messages';
import { isHumanEmpire } from '../../../humanEmpires';
import { YEAR_LENGTH } from '../../../galaxyTime';
import { galaxyStarDate, REAL_SECONDS_IN_GALACTIC_YEAR } from '../../../tick/simTime';
import { GAME_DAY_LENGTH, registerScenarioEvent, registerScenarioFramePeriodic, registerScenarioQuery } from '../../hooks';
import { scenarioMessage, scenarioNews, scenarioText } from '../../messages';
import { scenarioFlag, scenarioParam } from '../../state';
import { BuiltObjectRole } from '../../../data/designSpecifications';
import { enableThreat, peekThreatState, threatState } from '../framework';
import { isActor, shipsWithin } from './actions';
import { grantResearchPoints } from '../archiveCores';
import { VOID_WHALE_KEY, peekVoidWhaleState, voidWhaleState, voidWhaleWake } from '../voidWhale';
import { NEW_FAUNA_FLAG, FaunaVariant } from '../../newFauna/common';
import { spawnVariantHerd } from '../../newFauna/newFauna';
import { herdMembers, rimHerdOfCreature } from '../../rimFauna/common';
import { startRimHerdMigration } from '../../rimFauna/rimFauna';
import {
    compactFaction,
    greatWorkBeneficiary,
    greatWorkPay,
    greatWorkShares,
    kindName,
    ordinaryEmpires,
    registerGreatWork,
    type GreatWorkRecord,
} from './framework';
import { GW_FLAG, logGw, nextRandom } from './state';

export const SANCTUARY_KEY = 'gwSanctuary';
export const SANCTUARY_FLAG = 'gwSanctuary';
const STAG = 'Giantworks Sanctuary';

// ---------------------------------------------------------------------------------------------------------------
// Parameters (scenarios/giantworks/scenario.json; the fallbacks here are the same values)
// ---------------------------------------------------------------------------------------------------------------

function p(galaxy: Galaxy, name: string, fallback: number): number {
    return scenarioParam(galaxy, name, fallback);
}
export const SP = {
    incomePerYear: (g: Galaxy) => p(g, 'sanctuaryIncomePerYear', 1000000),
    growthPct: (g: Galaxy) => p(g, 'sanctuaryGrowthPct', 25),
    growthSectors: (g: Galaxy) => p(g, 'sanctuaryGrowthSectors', 3),
    researchPct: (g: Galaxy) => p(g, 'sanctuaryResearchPct', 4),
    startWhales: (g: Galaxy) => Math.trunc(p(g, 'sanctuaryStartWhales', 4)),
    maxWhales: (g: Galaxy) => Math.trunc(p(g, 'sanctuaryMaxWhales', 7)),
    whalesPerYear: (g: Galaxy) => p(g, 'sanctuaryWhalesPerYear', 0.5),
    breachPctPerYear: (g: Galaxy) => p(g, 'sanctuaryBreachPctPerYear', 2),
    stressPctPerYear: (g: Galaxy) => p(g, 'sanctuaryStressPctPerYear', 0.9),
    stressHalfLifeDays: (g: Galaxy) => p(g, 'sanctuaryStressHalfLifeDays', 60),
    stressSphere: (g: Galaxy) => p(g, 'sanctuaryStressSphere', 5),
    stressNearby: (g: Galaxy) => p(g, 'sanctuaryStressNearby', 1.5),
    nearbyRange: (g: Galaxy) => p(g, 'sanctuaryNearbyRange', 100000),
    stressSabotage: (g: Galaxy) => p(g, 'sanctuaryStressSabotage', 30),
    repairYears: (g: Galaxy) => p(g, 'sanctuaryRepairYears', 1),
    repairCost: (g: Galaxy) => p(g, 'sanctuaryRepairCost', 1000000),
    whalesMin: (g: Galaxy) => Math.trunc(p(g, 'sanctuaryReleaseMin', 3)),
    whalesMax: (g: Galaxy) => Math.trunc(p(g, 'sanctuaryReleaseMax', 6)),
    rageDays: (g: Galaxy) => p(g, 'sanctuaryRageDays', 360),
    rageSpeed: (g: Galaxy) => p(g, 'sanctuaryRageSpeed', 45),
    rageHunt: (g: Galaxy) => p(g, 'sanctuaryRageHuntRange', 30000),
    refPotency: (g: Galaxy) => Math.max(1, p(g, 'sanctuaryRageRefPotency', 600)),
    maxScale: (g: Galaxy) => Math.max(1, p(g, 'sanctuaryRageMaxScale', 6)),
    rageDiv: (g: Galaxy) => Math.max(1, p(g, 'sanctuaryRageAttackDiv', 12)),
    rageRange: (g: Galaxy) => p(g, 'sanctuaryRageRange', 6000),
    rageSectors: (g: Galaxy) => p(g, 'sanctuaryRageSectors', 4),
    rageHyper: (g: Galaxy) => p(g, 'sanctuaryRageHyper', 10000),
};

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------

export interface AngryWhale {
    creature: Creature;
    until: number;
    /** The multiplier of its attack and health set by the galaxy's navies when it got out (absent: 1). */
    scale?: number;
    /** Plain creatures (no New Fauna herd): the point they hyper-travel to; the daily step stops the hyperdrive on arrival. */
    dest: { x: number; y: number } | null;
}

export interface Sanctum {
    site: GreatWorkRecord;
    lastTick: number;
    /** The whales inside (fractional: they breed slowly); site.whales is its whole part. */
    whales: number;
    /** 0..100: how hard the sphere has been shaken lately. */
    stress: number;
    lastStressHit: number;
    breached: boolean;
    repairUntil: number;
    breaches: number;
    leviathanReleased: boolean;
    angry: AngryWhale[];
    stats: { income: number; research: number; repairPaid: number; released: number; stressPeak: number; hits: number };
}

export interface SanctuaryState {
    sanctums: Sanctum[];
}

export function sanctuaryState(galaxy: Galaxy): SanctuaryState {
    return threatState<SanctuaryState>(galaxy, SANCTUARY_KEY, () => ({ sanctums: [] }));
}

export function peekSanctuaryState(galaxy: Galaxy): SanctuaryState | null {
    return peekThreatState<SanctuaryState>(galaxy, SANCTUARY_KEY);
}

export function sanctumOfSite(galaxy: Galaxy, site: GreatWorkRecord): Sanctum | null {
    return peekSanctuaryState(galaxy)?.sanctums.find((s) => s.site === site) ?? null;
}

function sanctumOfBase(galaxy: Galaxy, bo: unknown): Sanctum | null {
    const st = peekSanctuaryState(galaxy);
    if (st === null || bo === null || bo === undefined) return null;
    return st.sanctums.find((s) => s.site.base === bo) ?? null;
}

function newSanctum(galaxy: Galaxy, site: GreatWorkRecord): Sanctum {
    return {
        site,
        lastTick: galaxyStarDate(galaxy),
        whales: SP.startWhales(galaxy),
        stress: 0,
        lastStressHit: -1,
        breached: false,
        repairUntil: 0,
        breaches: 0,
        leviathanReleased: false,
        angry: [],
        stats: { income: 0, research: 0, repairPaid: 0, released: 0, stressPeak: 0, hits: 0 },
    };
}

/** The Sanctuary of `site`, created on first use. */
export function ensureSanctum(galaxy: Galaxy, site: GreatWorkRecord): Sanctum {
    const st = sanctuaryState(galaxy);
    let s = st.sanctums.find((x) => x.site === site);
    if (s === undefined) {
        s = newSanctum(galaxy, site);
        st.sanctums.push(s);
    }
    return s;
}

/** The sanctuaries that stand (finished, not destroyed). */
function live(galaxy: Galaxy): Sanctum[] {
    const st = peekSanctuaryState(galaxy);
    return st === null ? [] : st.sanctums.filter((s) => s.site.phase === 'complete');
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------

function human(galaxy: Galaxy, e: Empire): boolean {
    return isHumanEmpire(galaxy, e);
}

function fmt(n: number): string {
    return Math.round(n).toLocaleString('en-US');
}

function siteStar(s: Sanctum): { xpos: number; ypos: number } {
    return s.site.system.systemStar;
}

/** The base carries the whale count / state in its name (the selection panel and the map show it; no menus). */
function renameBase(s: Sanctum): void {
    const b = s.site.base;
    if (b === null || b.hasBeenDestroyed) return;
    const name = kindName('sanctuary');
    b.name = s.breached ? scenarioText(`${STAG} Name Breached`, name) : scenarioText(`${STAG} Name Whales`, name, s.site.whales ?? Math.floor(s.whales));
}

function syncWhales(s: Sanctum): void {
    s.site.whales = Math.max(0, Math.floor(s.whales + 1e-9));
}

function tellBeneficiary(galaxy: Galaxy, s: Sanctum, title: string, text: string, type: EmpireMessageType, popup = false): void {
    const e = greatWorkBeneficiary(galaxy, s.site);
    if (e === null || !e.active || !human(galaxy, e)) return;
    scenarioMessage(galaxy, e, title, text, { type, subject: s.site.base ?? s.site.system.systemStar, popup });
}

// ---------------------------------------------------------------------------------------------------------------
// While whole: income, growth, research, whales
// ---------------------------------------------------------------------------------------------------------------

/** Pays `amount` through the wonder's shares and books each empire's part as resort income. Returns what the empires received. */
function payResort(galaxy: Galaxy, s: Sanctum, amount: number): number {
    if (!(amount > 0)) return 0;
    const shares = greatWorkShares(galaxy, s.site);
    const paid = greatWorkPay(galaxy, s.site, amount);
    const compact = compactFaction(galaxy);
    for (const sh of shares) if (sh.empire !== null && sh.empire.active && sh.empire !== compact) addResortIncome(galaxy, sh.empire, amount * sh.share);
    return paid;
}

function whaleBreeding(galaxy: Galaxy, s: Sanctum, years: number): void {
    const max = SP.maxWhales(galaxy);
    if (s.whales >= max) return;
    s.whales = Math.min(max, s.whales + SP.whalesPerYear(galaxy) * years);
    syncWhales(s);
}

function runWhole(galaxy: Galaxy, s: Sanctum, years: number): void {
    s.stats.income += payResort(galaxy, s, SP.incomePerYear(galaxy) * years);
    const e = greatWorkBeneficiary(galaxy, s.site);
    if (e !== null && e.active && e.research != null) {
        const pct = SP.researchPct(galaxy) / 100;
        if (pct > 0) {
            // Biology: a trickle of a year's research output, in proportion to the time passed (the same measure as the Ultramind's).
            s.stats.research += grantResearchPoints(galaxy, e, pct * researchOutput(galaxy, e) * years);
        }
    }
    whaleBreeding(galaxy, s, years);
}

function researchOutput(galaxy: Galaxy, e: Empire): number {
    const t = calculateResearchTotal(e);
    return (t.researchEnergy * calculateResearchOutputBonuses(e, IndustryType.Energy) + t.researchHighTech * calculateResearchOutputBonuses(e, IndustryType.HighTech) + t.researchWeapons * calculateResearchOutputBonuses(e, IndustryType.Weapon)) * galaxy.researchSpeedModifier;
}

/** The population growth bonus (percent) of a colony: the beneficiary's own, within growthSectors of a whole sanctuary. Pure. */
export function growthBonusAt(galaxy: Galaxy, x: number, y: number, owner: Empire | null): number {
    if (owner === null) return 0;
    let best = 0;
    for (const s of live(galaxy)) {
        if (s.breached || greatWorkBeneficiary(galaxy, s.site) !== owner) continue;
        const star = siteStar(s);
        if (galaxy.calculateDistance(star.xpos, star.ypos, x, y) <= SP.growthSectors(galaxy) * galaxy.sectorSize) best = Math.max(best, SP.growthPct(galaxy));
    }
    return best;
}

// ---------------------------------------------------------------------------------------------------------------
// Stress and the breach
// ---------------------------------------------------------------------------------------------------------------

/** The sphere is shaken: stress rises (at most once per game day for the small knocks). */
export function addStress(galaxy: Galaxy, s: Sanctum, amount: number, big: boolean): void {
    if (s.breached || amount <= 0) return;
    const now = galaxyStarDate(galaxy);
    if (!big && s.lastStressHit >= 0 && now - s.lastStressHit < GAME_DAY_LENGTH) return;
    s.lastStressHit = now;
    s.stress = Math.min(100, s.stress + amount);
    s.stats.hits++;
    if (s.stress > s.stats.stressPeak) s.stats.stressPeak = s.stress;
}

/** The chance (0..1) of a breach per year at the current stress. Pure. */
export function breachChancePerYear(galaxy: Galaxy, s: Sanctum): number {
    return Math.min(0.95, (SP.breachPctPerYear(galaxy) + SP.stressPctPerYear(galaxy) * s.stress) / 100);
}

/**
 * How much stronger than a plain void whale the unleashed ones are: the square root of the three strongest empires' mean military
 * strength over sanctuaryRageRefPotency, from 1 (a young galaxy) to sanctuaryRageMaxScale. Their attack and health, and the
 * Leviathan's, are multiplied by it, so in a mature galaxy they are a threat to a fleet and not to a lone freighter. Pure.
 */
export function unleashedScale(galaxy: Galaxy): number {
    const top = ordinaryEmpires(galaxy)
        .map((e) => militaryPotency(e))
        .sort((a, b) => b - a)
        .slice(0, 3);
    if (top.length === 0) return 1;
    const mean = top.reduce((a, b) => a + b, 0) / top.length;
    return Math.min(SP.maxScale(galaxy), Math.max(1, Math.sqrt(mean / SP.refPotency(galaxy))));
}

function pointNearSite(galaxy: Galaxy, s: Sanctum, i: number): { x: number; y: number } {
    const star = siteStar(s);
    const a = (i * 2.399963) % (Math.PI * 2);
    return { x: star.xpos + Math.cos(a) * 9000, y: star.ypos + Math.sin(a) * 9000 };
}

function rageStats(galaxy: Galaxy, s: Sanctum, c: Creature, scale: number): void {
    c.attackStrength = Math.trunc((c.size / SP.rageDiv(galaxy)) * scale);
    c.damageKillThreshold = Math.trunc(c.damageKillThreshold * scale);
    c.attackRange = SP.rageRange(galaxy);
    c.movementSpeed = Math.fround(SP.rageSpeed(galaxy));
    c.movementSpeedBase = c.movementSpeed;
    c.locationLocked = true;
    c.canHide = false;
    c.isVisible = true;
    c.name = scenarioText(`${STAG} Whale Name`, c.name);
}

/** The colony the enraged whales head for: the beneficiary's nearest, else the nearest of any empire's within sanctuaryRageSectors; null when it is in the sphere's own system (they are there already) or none is in range. Pure. */
export function rageTarget(galaxy: Galaxy, s: Sanctum): Habitat | null {
    const star = siteStar(s);
    const range = SP.rageSectors(galaxy) * galaxy.sectorSize;
    const nearest = (list: readonly Empire[]): Habitat | null => {
        let best: Habitat | null = null;
        let bd = range;
        for (const e of list) {
            for (const h of e.colonies) {
                if (h === null || h.hasBeenDestroyed || h.empire !== e || h.population.totalAmount <= 0) continue;
                const d = galaxy.calculateDistance(star.xpos, star.ypos, h.xpos, h.ypos);
                if (d < bd || (d === bd && best !== null && h.habitatIndex < best.habitatIndex)) {
                    bd = d;
                    best = h;
                }
            }
        }
        return best;
    };
    const ben = greatWorkBeneficiary(galaxy, s.site);
    const t = (ben !== null && ben.active ? nearest([ben]) : null) ?? nearest(ordinaryEmpires(galaxy));
    if (t === null || t.systemIndex === s.site.system.systemStar.systemIndex) return null;
    return t;
}

/** Lets out the enraged whales (New Fauna's void whales when that add-on is on, else plain creatures) and sends them hyper-travelling to the nearest colony. Returns how many. */
function releaseWhales(galaxy: Galaxy, s: Sanctum, n: number, now: number): number {
    const at = pointNearSite(galaxy, s, s.breaches);
    const target = rageTarget(galaxy, s);
    let creatures: Creature[] = [];
    let dest: { x: number; y: number } | null = null;
    if (scenarioFlag(galaxy, NEW_FAUNA_FLAG)) {
        const herd = spawnVariantHerd(galaxy, FaunaVariant.VoidWhale, s.site.system.systemStar.systemIndex, n, at);
        if (herd !== null) {
            creatures = herdMembers(herd);
            if (target !== null) {
                startRimHerdMigration(galaxy, herd, target.systemIndex, false);
                for (const c of creatures) c.hyperSpeed = SP.rageHyper(galaxy);
            }
        }
    } else {
        creatures = generateCreaturesAtLocation(galaxy, CreatureType.Kaltor, n, at.x, at.y, 20000, 800);
        for (const c of creatures) {
            c.size = 1000 + galaxy.rnd.next(0, 400);
            c.maxSize = 1800;
            c.damageKillThreshold = Math.trunc(c.size * 3);
            c.movementSpeed = 14;
            c.movementSpeedBase = 14;
            c.name = 'Void Whale';
        }
        if (target !== null) {
            dest = { x: Math.trunc(target.xpos + 9000), y: Math.trunc(target.ypos) };
            for (const c of creatures) {
                c.anchorPoint = { x: dest.x, y: dest.y };
                c.anchorRange = 20000;
                c.anchorHabitat = null;
                c.parentHabitat = null;
                c.parentOffsetX = 0;
                c.parentOffsetY = 0;
                c.hyperSpeed = SP.rageHyper(galaxy);
                c.targetSpeed = c.movementSpeed;
            }
        }
    }
    // The rage lasts rageDays after the journey: a game day is hyper x (600 s / 360) units of travel.
    const star = siteStar(s);
    const travelDays = target === null ? 0 : (1.1 * galaxy.calculateDistance(star.xpos, star.ypos, target.xpos, target.ypos)) / (SP.rageHyper(galaxy) * (REAL_SECONDS_IN_GALACTIC_YEAR / 360));
    const scale = unleashedScale(galaxy);
    for (const c of creatures) {
        rageStats(galaxy, s, c, scale);
        s.angry.push({ creature: c, until: now + (travelDays + SP.rageDays(galaxy)) * GAME_DAY_LENGTH, scale, dest });
    }
    if (target !== null && creatures.length > 0) logGw(galaxy, now, `sanctuary ${s.site.id}: ${creatures.length} enraged whales head for ${target.name} (${target.empire?.name ?? '-'})`);
    return creatures.length;
}

/** The Leviathan comes out with the whales, once (the Void Whale threat is switched on if it was off; if it already hunts, nothing). */
function releaseLeviathan(galaxy: Galaxy, s: Sanctum): boolean {
    const known = peekVoidWhaleState(galaxy);
    if (known !== null && known.phase !== 'waiting') return false;
    enableThreat(galaxy, VOID_WHALE_KEY);
    const st = voidWhaleState(galaxy);
    if (st.phase !== 'waiting') return false;
    st.strengthMul = unleashedScale(galaxy); // before it wakes: its stats are laid down then and at each meal
    const ok = voidWhaleWake(galaxy, st, s.site.system.systemStar);
    if (ok) s.leviathanReleased = true;
    return ok;
}

/** Lets the whales (and, once, the Leviathan) out; news and a message for the beneficiary. Returns how many whales and whether the Leviathan came. */
function spill(galaxy: Galaxy, s: Sanctum, now: number, destroyed: boolean): { whales: number; leviathan: boolean } {
    const rnd = nextRandom(galaxy);
    const lo = SP.whalesMin(galaxy);
    const hi = Math.max(lo, SP.whalesMax(galaxy));
    const n = lo + rnd.next(0, hi - lo + 1);
    const whales = releaseWhales(galaxy, s, n, now);
    const leviathan = releaseLeviathan(galaxy, s);
    s.stats.released += whales;
    s.whales = destroyed ? 0 : Math.max(1, s.whales - n);
    syncWhales(s);
    const where = s.site.system.systemStar.name;
    const tag = destroyed ? 'Spill' : 'Breach';
    scenarioNews(galaxy, null, scenarioText(leviathan ? `${STAG} ${tag} News Leviathan` : `${STAG} ${tag} News`, where, whales), () => true, s.site.base ?? s.site.system.systemStar);
    return { whales, leviathan };
}

/** The sphere breaks: whales (and, once, the Leviathan) get out, the bonuses stop, the owner repairs for a year. */
export function breachSanctuary(galaxy: Galaxy, s: Sanctum, now: number): void {
    s.breached = true;
    s.site.breached = true; // the station art cracks the glass
    s.breaches++;
    s.stress = 0;
    s.repairUntil = now + SP.repairYears(galaxy) * YEAR_LENGTH;
    const out = spill(galaxy, s, now, false);
    renameBase(s);
    logGw(galaxy, now, `sanctuary ${s.site.id} BREACHED (${s.breaches}): ${out.whales} whales${out.leviathan ? ' and the Leviathan' : ''} out, repairs until y${(s.repairUntil / YEAR_LENGTH).toFixed(2)}`);
    tellBeneficiary(galaxy, s, scenarioText(`${STAG} Breach Title`), scenarioText(`${STAG} Breach`, s.site.system.systemStar.name, out.whales, fmt(SP.repairCost(galaxy))), EmpireMessageType.GeneralBadEvent, true);
}

function repaired(galaxy: Galaxy, s: Sanctum, now: number): void {
    s.breached = false;
    s.site.breached = false;
    s.stress = 0;
    s.repairUntil = 0;
    renameBase(s);
    logGw(galaxy, now, `sanctuary ${s.site.id} repaired: ${s.site.whales ?? 0} whales inside`);
    tellBeneficiary(galaxy, s, scenarioText(`${STAG} Repaired Title`), scenarioText(`${STAG} Repaired`, s.site.system.systemStar.name), EmpireMessageType.GeneralGoodEvent);
}

/** The owner pays the repairs by the month (the Compact's own part is free). */
function payRepairs(galaxy: Galaxy, s: Sanctum, years: number): void {
    const total = SP.repairCost(galaxy);
    const per = SP.repairYears(galaxy) > 0 ? (total * years) / SP.repairYears(galaxy) : 0;
    const e = greatWorkBeneficiary(galaxy, s.site);
    if (e === null || !e.active) return;
    e.stateMoney -= per;
    s.stats.repairPaid += per;
}

// ---------------------------------------------------------------------------------------------------------------
// The periodic step (kind.periodic)
// ---------------------------------------------------------------------------------------------------------------

export function sanctuaryPeriodic(galaxy: Galaxy, site: GreatWorkRecord): void {
    const s = ensureSanctum(galaxy, site);
    const now = galaxyStarDate(galaxy);
    const dt = now - s.lastTick;
    if (dt <= 0) return;
    s.lastTick = now;
    const years = dt / YEAR_LENGTH;
    s.stress *= Math.pow(0.5, dt / (SP.stressHalfLifeDays(galaxy) * GAME_DAY_LENGTH));
    if (s.stress < 0.05) s.stress = 0;
    if (s.breached) {
        payRepairs(galaxy, s, years);
        if (now >= s.repairUntil) {
            repaired(galaxy, s, now);
            whaleBreeding(galaxy, s, 0);
        } else {
            // The few whales that stayed behind breed even now, slowly.
            whaleBreeding(galaxy, s, years * 0.5);
        }
        return;
    }
    runWhole(galaxy, s, years);
    const pBreach = 1 - Math.pow(1 - breachChancePerYear(galaxy, s), years);
    if (nextRandom(galaxy).nextDouble() < pBreach) breachSanctuary(galaxy, s, now);
    else renameBase(s);
}

function sanctuaryComplete(galaxy: Galaxy, site: GreatWorkRecord): void {
    const s = ensureSanctum(galaxy, site);
    syncWhales(s);
    renameBase(s);
    logGw(galaxy, galaxyStarDate(galaxy), `sanctuary ${site.id} complete: ${site.whales ?? 0} whales`);
}

function sanctuaryDestroyed(galaxy: Galaxy, site: GreatWorkRecord): void {
    const s = sanctumOfSite(galaxy, site);
    if (s === null) return;
    // The glass goes with it: the whales it held, if it still held them, are loose like those of a breach (no repairs to pay).
    if (!s.breached && s.whales >= 1) {
        const out = spill(galaxy, s, galaxyStarDate(galaxy), true);
        logGw(galaxy, galaxyStarDate(galaxy), `sanctuary ${site.id} destroyed: ${out.whales} whales${out.leviathan ? ' and the Leviathan' : ''} out`);
    }
    s.whales = 0;
    s.site.breached = false;
    syncWhales(s);
}

// ---------------------------------------------------------------------------------------------------------------
// Events, queries and the daily rage
// ---------------------------------------------------------------------------------------------------------------

function onAttacked(galaxy: Galaxy, bo: BuiltObject): void {
    const st = peekSanctuaryState(galaxy);
    if (st === null) return;
    for (const s of st.sanctums) {
        if (s.site.phase !== 'complete' || s.breached) continue;
        if (s.site.base === bo) {
            addStress(galaxy, s, SP.stressSphere(galaxy), false);
            continue;
        }
        const star = siteStar(s);
        if (galaxy.calculateDistance(star.xpos, star.ypos, bo.xpos, bo.ypos) <= SP.nearbyRange(galaxy)) addStress(galaxy, s, SP.stressNearby(galaxy), false);
    }
}

function onIntel(galaxy: Galaxy, mission: IntelligenceMission): void {
    const T = IntelligenceMissionType;
    if (mission.type !== T.SabotageConstruction && mission.type !== T.DestroyBase) return;
    const s = sanctumOfBase(galaxy, intelligenceMissionTarget(mission));
    if (s === null || s.site.phase !== 'complete') return;
    addStress(galaxy, s, SP.stressSabotage(galaxy), true);
}

function angryOf(galaxy: Galaxy, c: Creature): Sanctum | null {
    const st = peekSanctuaryState(galaxy);
    if (st === null) return null;
    for (const s of st.sanctums) if (s.angry.some((a) => a.creature === c)) return s;
    return null;
}

/** The enraged whales leave the Compact's own alone (they do not pound the sphere they came out of). */
function ragingIgnores(galaxy: Galaxy, c: Creature, target: unknown, v: boolean): boolean {
    const s = angryOf(galaxy, c);
    if (s === null) return v;
    const t = target as { builtObjectID?: number; actualEmpire?: Empire | null } | null;
    if (t === null || t === undefined) return v;
    if (t === (s.site.base as unknown)) return true;
    const owner = t.actualEmpire ?? null;
    const compact = compactFaction(galaxy);
    if (owner !== null && owner === compact) return true;
    return false;
}

/**
 * An enraged whale with nothing to fight turns toward the nearest station or ship at rest of an empire within sanctuaryRageHuntRange
 * (about a system: it swims at 45), by moving its anchor onto it; the stock creature code attacks what it reaches. Pure but for the anchor.
 */
function huntNearby(galaxy: Galaxy, c: Creature): void {
    const range = SP.rageHunt(galaxy);
    const compact = compactFaction(galaxy);
    let best: BuiltObject | null = null;
    let bd = Number.MAX_VALUE;
    for (const b of shipsWithin(galaxy, c.xpos, c.ypos, range)) {
        const e = b.actualEmpire;
        if (!isActor(galaxy, e) || e === compact) continue;
        if (b.role !== BuiltObjectRole.Base && b.currentSpeed > 5) continue;
        const d = galaxy.calculateDistance(c.xpos, c.ypos, b.xpos, b.ypos);
        if (d < bd || (d === bd && best !== null && b.builtObjectID < best.builtObjectID)) {
            bd = d;
            best = b;
        }
    }
    if (best === null) return;
    c.anchorPoint = { x: Math.trunc(best.xpos), y: Math.trunc(best.ypos) };
    c.anchorRange = 1500;
    c.anchorHabitat = null;
    c.parentHabitat = null;
    c.parentOffsetX = 0;
    c.parentOffsetY = 0;
    c.targetSpeed = c.movementSpeed;
}

/** Daily: the enraged whales keep their reach and strength (New Fauna re-applies its own each day), and calm down when their rage is over. */
export function rageStep(galaxy: Galaxy): void {
    const st = peekSanctuaryState(galaxy);
    if (st === null) return;
    const now = galaxyStarDate(galaxy);
    for (const s of st.sanctums) {
        if (s.angry.length === 0) continue;
        const keep: AngryWhale[] = [];
        for (const a of s.angry) {
            const c = a.creature;
            if (c.hasBeenDestroyed || !galaxy.creatures.includes(c)) continue;
            if (now >= a.until) {
                if (!scenarioFlag(galaxy, NEW_FAUNA_FLAG)) {
                    c.attackStrength = 0; // plain creatures: harmless wildlife from now on
                    c.hyperSpeed = 0;
                }
                continue;
            }
            c.attackRange = SP.rageRange(galaxy);
            c.attackStrength = Math.max(c.attackStrength, Math.trunc((c.size / SP.rageDiv(galaxy)) * (a.scale ?? 1)));
            c.movementSpeed = Math.fround(SP.rageSpeed(galaxy));
            c.movementSpeedBase = c.movementSpeed;
            if (a.dest !== null && c.hyperSpeed > 0 && galaxy.calculateDistance(c.xpos, c.ypos, a.dest.x, a.dest.y) < 15000 && c.currentSpeed <= c.movementSpeed) c.hyperSpeed = 0;
            // Arrived (the herd's migration over / the plain creature's hyperdrive off) with nothing to fight: go after the nearest station.
            const arrived = a.dest !== null ? c.hyperSpeed === 0 : (rimHerdOfCreature(galaxy, c)?.migration ?? null) === null;
            if (arrived && c.currentTarget === null) huntNearby(galaxy, c);
            keep.push(a);
        }
        s.angry = keep;
    }
}

export const SANCTUARY_HANDLER_IDS = ['gwSanctuary.attacked', 'gwSanctuary.intel'] as const;
export const SANCTUARY_QUERY_IDS = ['gwSanctuary.growth', 'gwSanctuary.rage'] as const;

export function registerSanctuary(): void {
    registerGreatWork({
        id: 'sanctuary',
        flag: SANCTUARY_FLAG,
        weight: 15,
        hintTags: ['glass-ice', 'plankton', 'containment'],
        onComplete: (g, site) => sanctuaryComplete(g, site as GreatWorkRecord),
        onDestroyed: (g, site) => sanctuaryDestroyed(g, site as GreatWorkRecord),
        periodic: (g, site) => sanctuaryPeriodic(g, site as GreatWorkRecord),
    });
    registerScenarioEvent({ id: 'gwSanctuary.attacked', flag: GW_FLAG, event: 'builtObjectAttacked', run: (g, e) => onAttacked(g, e.builtObject) });
    registerScenarioEvent({ id: 'gwSanctuary.intel', flag: GW_FLAG, event: 'intelMissionCompleted', run: (g, e) => onIntel(g, e.mission as IntelligenceMission) });
    registerScenarioQuery({
        id: 'gwSanctuary.growth',
        flag: GW_FLAG,
        query: 'colonyWonderBonus',
        run: (g, v, a) => (a.wonderType === WonderType.ColonyPopulationGrowth && peekSanctuaryState(g) !== null ? Math.max(v, growthBonusAt(g, a.habitat.xpos, a.habitat.ypos, a.habitat.empire)) : v),
    });
    registerScenarioQuery({
        id: 'gwSanctuary.rage',
        flag: GW_FLAG,
        order: 100,
        query: 'creatureIgnoresTarget',
        run: (g, v, a) => (peekSanctuaryState(g) !== null ? ragingIgnores(g, a.creature, a.target, v) : v),
    });
    registerScenarioFramePeriodic({ id: 'gwSanctuary.rage', flag: GW_FLAG, order: 50, periodDays: 1, run: (g) => rageStep(g) });
}

registerSanctuary();
