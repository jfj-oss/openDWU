// The Voidbloom War — the legal era (docs/VOIDBLOOM_WAR.md, user decision 15, all ideas kept simple): dependency on
// the rim growers (attitude and war leverage), temperance movements demanding a ban, neural detox research, leaders
// who pick up an addiction, and the pirate syndicates growing rich on the trade. Withdrawal crises live in trade.ts and
// Galactic Prohibition in diet.ts. Most of this runs from the first legalisation (treaty or opening); detox and
// temperance answer addiction whenever it is high.
//
// Rnd: galaxy.rnd only in the yearly handler (the leaders' roll), fixed empire order.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import { CharacterTraitType } from '../../characters';
import { cautionLevel } from '../../diplomacyTick';
import { EmpireMessageType } from '../../messages';
import { galaxyStarDate } from '../../tick/simTime';
import { YEAR_LENGTH } from '../../galaxyTime';
import { empireApprovalRatingStock } from '../../taxes';
import { gameYear, registerScenarioQuery, registerScenarioYearly } from '../hooks';
import { registerScenarioDecision, raiseScenarioDecision, type ScenarioDecision } from '../decisions';
import { registerStabilityTerm } from '../stability';
import { scenarioMessage, scenarioNews, scenarioText } from '../messages';
import { applyReputation } from '../reputation/ledger';
import { rimTraderEmpire } from '../rimTrade/common';
import { growsVoidbloom } from './trade';
import {
    VOIDBLOOM_FLAG,
    addHistory,
    addictionIndex,
    empireById,
    fmt,
    isHuman,
    isNormal,
    normalEmpires,
    peekVbState,
    vbEmpire,
    vbOn,
    vbParam,
    vbState,
} from './common';

export const TEMPERANCE_DECISION = 'voidbloom.temperance';

/** The growers an addicted empire depends on: owners of a growing world that sell Voidbloom. Pure. */
export function dependencyOf(galaxy: Galaxy, e: Empire): Empire[] {
    const st = peekVbState(galaxy);
    if (st === null || st.legalSince < 0 || addictionIndex(galaxy, e) < 0.25) return [];
    const out: Empire[] = [];
    for (const w of st.worlds) {
        const o = w.habitat.empire;
        if (!isNormal(galaxy, o) || o === e || out.includes(o) || (st.empires[o.empireId]?.sold ?? 0) <= 0) continue;
        out.push(o);
    }
    return out.sort((a, b) => a.empireId - b.empireId);
}

/** Starts neural detox research (state money). False when it is done, under way or unaffordable. */
export function startDetox(galaxy: Galaxy, e: Empire): boolean {
    if (!vbOn(galaxy) || !isNormal(galaxy, e)) return false;
    const rec = vbEmpire(galaxy, e);
    const cost = vbParam(galaxy, 'voidbloomDetoxCost');
    if (rec.detoxDone || rec.detoxUntil >= 0 || e.stateMoney < cost) return false;
    e.stateMoney -= cost;
    rec.detoxUntil = galaxyStarDate(galaxy) + vbParam(galaxy, 'voidbloomDetoxYears') * YEAR_LENGTH;
    return true;
}

function legalYear(galaxy: Galaxy): void {
    const st = vbState(galaxy);
    const now = galaxyStarDate(galaxy);
    const r = rimTraderEmpire(galaxy);
    for (const e of normalEmpires(galaxy)) {
        const rec = vbEmpire(galaxy, e);
        const add = addictionIndex(galaxy, e);
        // Neural detox: finishes; the AI starts it once its colonies are hooked.
        if (rec.detoxUntil >= 0 && now >= rec.detoxUntil) {
            rec.detoxUntil = -1;
            rec.detoxDone = true;
            st.stats.detox++;
            scenarioNews(galaxy, e, scenarioText('Voidbloom Detox News', e.name), () => true, null);
        } else if (!isHuman(galaxy, e) && !rec.detoxDone && rec.detoxUntil < 0 && add >= 0.2 && e.stateMoney >= 3 * vbParam(galaxy, 'voidbloomDetoxCost')) startDetox(galaxy, e);
        // Leaders pick up the habit.
        const leader = e.leader;
        if (leader !== null && leader.active && add >= 0.3 && !leader.traits.includes(CharacterTraitType.Addict) && galaxy.rnd.nextDouble() < add * 0.2) {
            leader.addTrait(CharacterTraitType.Addict, false, galaxy);
            st.stats.addictLeaders++;
            if (isHuman(galaxy, e)) scenarioMessage(galaxy, e, scenarioText('Voidbloom Leader Title'), scenarioText('Voidbloom Leader Addict', leader.name), { type: EmpireMessageType.GeneralBadEvent, popup: false });
        }
        // Dependency: the hooked empire warms to its growers (leverage).
        for (const p of dependencyOf(galaxy, e)) applyReputation(galaxy, e, p, 4, { cause: 'voidbloom.dependency', labelKey: 'Voidbloom Reputation Dependency', source: 'voidbloom', term: 'bias' });
        // Temperance movements: a hooked, unhappy colony demands a ban.
        if (rec.policy !== 'ban' && e !== r && !growsVoidbloom(galaxy, e)) temperance(galaxy, e);
    }
    // The pirate syndicates grow rich on the trade.
    const cut = st.stats.smugglerCut;
    const lastCut = st.syndicateNoted ?? 0;
    if (cut - lastCut >= 200_000) {
        st.syndicateNoted = cut;
        scenarioNews(galaxy, null, scenarioText('Voidbloom Syndicate News', fmt(cut)), () => true, null);
    }
}

function temperance(galaxy: Galaxy, e: Empire): void {
    const st = vbState(galaxy);
    const now = galaxyStarDate(galaxy);
    let where: Habitat | null = null;
    for (const h of e.colonies) {
        if (h.hasBeenDestroyed) continue;
        const c = st.colonies[h.habitatIndex];
        if (c === undefined || c.a < 0.4 || (c.temp >= 0 && now - c.temp < 10 * YEAR_LENGTH)) continue;
        if (empireApprovalRatingStock(galaxy, h) >= 40) continue;
        where = h;
        c.temp = now;
        break;
    }
    if (where === null) return;
    st.stats.temperance++;
    raiseScenarioDecision(galaxy, e, {
        kind: TEMPERANCE_DECISION,
        title: scenarioText('Voidbloom Temperance Title'),
        text: scenarioText('Voidbloom Temperance Text', where.name),
        options: [
            { id: 'ban', label: scenarioText('Voidbloom Temperance Ban') },
            { id: 'ignore', label: scenarioText('Voidbloom Temperance Ignore') },
        ],
        defaultOption: 'ignore',
        expiresDays: 120,
        context: { empireId: e.empireId, colony: where.habitatIndex },
    });
}

function resolveTemperance(galaxy: Galaxy, d: ScenarioDecision, option: string): void {
    const e = empireById(galaxy, Number(d.context.empireId));
    if (e === null || !e.active) return;
    const rec = vbEmpire(galaxy, e);
    if (option === 'ban') {
        rec.policy = 'ban';
        if (isHuman(galaxy, e)) rec.auto = false;
        addHistory(galaxy, scenarioText('Voidbloom History Temperance', e.name, gameYear(galaxyStarDate(galaxy))));
    } else {
        const c = vbState(galaxy).colonies[Number(d.context.colony)];
        if (c !== undefined) c.temp = galaxyStarDate(galaxy) + 0.001; // the snub: approval falls for 3 years (term below)
        rec.snubbed = galaxyStarDate(galaxy);
    }
}

/** The snubbed temperance movement: approval −5 at its colony for 3 years. Pure. */
function snubTerm(galaxy: Galaxy, h: Habitat, e: Empire | null): number | null {
    if (e === null) return null;
    const st = peekVbState(galaxy);
    const rec = st?.empires[e.empireId];
    const c = st?.colonies[h.habitatIndex];
    if (rec === undefined || c === undefined || rec.snubbed === undefined || c.temp < 0) return null;
    const now = galaxyStarDate(galaxy);
    return c.temp >= rec.snubbed - 1 && now - rec.snubbed < 3 * YEAR_LENGTH ? -5 : null;
}

/** warReviewAttitudeRelax: a dependent empire hesitates to attack its growers. Pure. */
function leverage(galaxy: Galaxy, v: number, a: { empire: Empire; other: Empire }): number {
    if (!vbOn(galaxy)) return v;
    return dependencyOf(galaxy, a.empire).includes(a.other) ? v - 8 : v;
}

registerScenarioYearly({ id: 'voidbloom.legal', flag: VOIDBLOOM_FLAG, order: 44, run: (g) => legalYear(g) });
registerScenarioDecision({
    id: TEMPERANCE_DECISION,
    kind: TEMPERANCE_DECISION,
    aiPure: true,
    flag: VOIDBLOOM_FLAG,
    resolve: resolveTemperance,
    aiChoose: (g, d) => {
        const e = empireById(g, Number(d.context.empireId));
        return e !== null && (cautionLevel(e) > 100 || addictionIndex(g, e) > 0.25) ? 'ban' : 'ignore';
    },
});
registerStabilityTerm({ id: 'voidbloom.temperance', flag: VOIDBLOOM_FLAG, cause: 'voidbloomTemperance', label: 'Temperance movement snubbed', run: snubTerm });
registerScenarioQuery({ id: 'voidbloom.leverage', flag: VOIDBLOOM_FLAG, query: 'warReviewAttitudeRelax', run: leverage });
