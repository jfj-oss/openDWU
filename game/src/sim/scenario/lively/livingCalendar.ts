// Scenario package "lively-galaxy" (task 19l item 5, `livingCalendar`). Not a port: a yearly per-empire roll of small
// texture events — festivals, elections, coronations, war/wonder anniversaries — so the feed has beats between the
// crises the rest of the package (and 19d3) produces. Flag off = the stock game (no state, no event, no query).
//
// Every effect goes through an existing ported hook, per empire:
//   - Festival: taxes.ts empireApprovalRating(habitat) (Habitat.cs approval), the mod-layer's own additive query —
//     a temporary state entry (one month, GAME_DAY_LENGTH * 30) the query reads; no core field is touched.
//   - Election / coronation: Empire.6.cs 4873/4878 PerformChangeLeader(changeTypeOverride) (characterRuntime.ts
//     performChangeLeader) — the same path a natural leader change already goes through (characterRuntime.ts
//     reviewLeaderChange calling it around line 1054), which itself resolves the new leader via Empire.6.cs 4927
//     ChangeLeader and sends its own gametext-backed message (its `changeType` chooses "Election" for governments
//     whose LeaderReplacementTypicalManner is 2 — election governments already map to changeType 1 with no override
//     needed; a scenario-invented "coronation" for the Monarchy government overrides changeType to 0, the
//     "Replaced"/orderly bucket, since stock Monarchy's own manner (1, "coup d'état") reads too violent for a
//     succession). Empire.6.cs 4757 NextAllowableLeaderChangeDate's own cooldown is honoured so this never fights a
//     natural leader change.
//   - Anniversaries: a per-empire "ally" (Empire.9.cs DiplomaticRelationType.MutualDefensePact partner) gets a
//     prestige-style EmpireEvaluation.bias bump (diplomacy.ts, the same evaluation field empireMidGame.ts's
//     `relationBias` and the vanilla review logic already read); a FreeTradeAgreement partner may instead be deepened
//     one step, with the ported Empire.8.cs 2635 ChangeDiplomaticRelation (diplomacyTick.ts changeDiplomaticRelation),
//     into a MutualDefensePact — a concrete "relation change" rather than a bare number.
//
// Rnd: only the yearly handler draws (festival / election / coronation / anniversary rolls, plus whatever
// performChangeLeader / changeDiplomaticRelation draw internally); the query never draws.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import { empireGovernmentAttributes } from '../../empire';
import { performChangeLeader } from '../../characterRuntime';
import { nextAllowableLeaderChangeDate } from '../../characterRuntime';
import { DiplomaticRelationType, obtainDiplomaticRelation, obtainEmpireEvaluation } from '../../diplomacy';
import { changeDiplomaticRelation } from '../../diplomacyTick';
import { YEAR_LENGTH } from '../../galaxyTime';
import { EmpireMessageType } from '../../messages';
import { galaxyStarDate } from '../../tick/simTime';
import { gameYear, registerScenarioEvent, registerScenarioQuery, registerScenarioYearly } from '../hooks';
import { scenarioParam, scenarioState } from '../state';
import { scenarioMessage, scenarioNews, scenarioText } from '../messages';
import { LIVELY_GALAXY_ID, majorEmpires } from './livelyGalaxy';
import { isHumanEmpire } from '../../humanEmpires';

const MONTH_LENGTH = YEAR_LENGTH / 12;

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------

interface FestivalEntry {
    /** Star date the approval bonus expires. */
    until: number;
    bonus: number;
}

/** Active festival bonuses (key: empireId). */
export function festivalState(galaxy: Galaxy): Record<string, FestivalEntry> {
    return scenarioState(galaxy, 'lively.calendar.festivals', () => ({}) as Record<string, FestivalEntry>);
}

interface WarAnniversaryEntry {
    a: number;
    b: number;
    year: number;
}

/** Wars recorded for their anniversary (one entry per declaration; lower empireId first). */
export function warAnniversaryState(galaxy: Galaxy): WarAnniversaryEntry[] {
    return scenarioState(galaxy, 'lively.calendar.wars', () => [] as WarAnniversaryEntry[]);
}

/** The game year each empire was first seen holding a wonder bonus (key: empireId). */
export function wonderAnniversaryState(galaxy: Galaxy): Record<string, number> {
    return scenarioState(galaxy, 'lively.calendar.wonders', () => ({}) as Record<string, number>);
}

function empireHasWonderBonus(empire: Empire): boolean {
    return (
        empire.specialBonusHappinessWonder !== null ||
        empire.specialBonusPopulationGrowthWonder !== null ||
        empire.specialBonusResearchEnergyWonder !== null ||
        empire.specialBonusResearchHighTechWonder !== null ||
        empire.specialBonusResearchWeaponsWonder !== null ||
        empire.specialBonusWealthWonder !== null
    );
}

// ---------------------------------------------------------------------------------------------------------------
// Festival: empireApprovalRating query
// ---------------------------------------------------------------------------------------------------------------

registerScenarioQuery({
    id: 'lively.calendar.festivalApproval',
    scenarioId: LIVELY_GALAXY_ID,
    flag: 'livingCalendar',
    query: 'empireApprovalRating',
    run: (g, value, args) => {
        if (args.empire === null) return value;
        const f = festivalState(g)[String(args.empire.empireId)];
        if (f === undefined || galaxyStarDate(g) >= f.until) return value;
        return value + f.bonus;
    },
});

// ---------------------------------------------------------------------------------------------------------------
// War anniversaries: record every declaration (a peaceable colonial life has nothing to celebrate)
// ---------------------------------------------------------------------------------------------------------------

registerScenarioEvent({
    id: 'lively.calendar.warRecord',
    scenarioId: LIVELY_GALAXY_ID,
    flag: 'livingCalendar',
    event: 'diplomaticRelationChanged',
    run: (g, p) => {
        if (p.to !== DiplomaticRelationType.War || p.from === DiplomaticRelationType.War) return;
        if (p.empire === g.independentEmpire || p.other === g.independentEmpire) return;
        if (p.empire.pirateEmpireBaseHabitat !== null || p.other.pirateEmpireBaseHabitat !== null) return;
        const list = warAnniversaryState(g);
        const year = gameYear(galaxyStarDate(g));
        const a = Math.min(p.empire.empireId, p.other.empireId);
        const b = Math.max(p.empire.empireId, p.other.empireId);
        if (list.some((w) => w.a === a && w.b === b && w.year === year)) return;
        list.push({ a, b, year });
    },
});

// ---------------------------------------------------------------------------------------------------------------
// Anniversary effect: a prestige-style bump with allies, or ChangeDiplomaticRelation deepening a treaty partner
// ---------------------------------------------------------------------------------------------------------------

function celebrateAnniversary(galaxy: Galaxy, empire: Empire, titleTag: string, descriptionTag: string, newsTag: string): void {
    const bias = scenarioParam(galaxy, 'anniversaryAllyBias', 3);
    const treatyChance = scenarioParam(galaxy, 'anniversaryTreatyChance', 0.15);
    for (const other of majorEmpires(galaxy)) {
        if (other === empire) continue;
        const rel = obtainDiplomaticRelation(empire, other);
        if (rel.type === DiplomaticRelationType.MutualDefensePact) {
            const ev1 = obtainEmpireEvaluation(galaxy, empire, other);
            ev1.bias = ev1.bias + bias;
            const ev2 = obtainEmpireEvaluation(galaxy, other, empire);
            ev2.bias = ev2.bias + bias;
        } else if (rel.type === DiplomaticRelationType.FreeTradeAgreement && galaxy.rnd.nextDouble() < treatyChance) {
            // Empire.8.cs 2635 ChangeDiplomaticRelation (diplomacyTick.ts): a prestige-driven deepening of an existing
            // free-trade partner into a mutual defense pact, rather than a bare evaluation number.
            changeDiplomaticRelation(galaxy, empire, rel, DiplomaticRelationType.MutualDefensePact);
        }
    }
    scenarioMessage(galaxy, empire, scenarioText(titleTag), scenarioText(descriptionTag), { type: EmpireMessageType.GeneralGoodEvent });
    scenarioNews(galaxy, null, scenarioText(newsTag, empire.name), (e) => e !== empire);
}

// ---------------------------------------------------------------------------------------------------------------
// The yearly roll
// ---------------------------------------------------------------------------------------------------------------

/** The yearly living-calendar pass (exported for tests). Draws galaxy.rnd. */
export function livingCalendarYearly(galaxy: Galaxy): void {
    const now = galaxyStarDate(galaxy);
    const year = gameYear(now);
    const festivalChance = scenarioParam(galaxy, 'festivalChance', 0.25);
    const festivalBonus = scenarioParam(galaxy, 'festivalApprovalBonus', 10);
    const electionChance = scenarioParam(galaxy, 'electionChance', 0.2);
    const coronationChance = scenarioParam(galaxy, 'coronationChance', 0.15);
    const anniversaryPeriod = Math.max(1, Math.trunc(scenarioParam(galaxy, 'anniversaryPeriodYears', 5)));
    const anniversaryChance = scenarioParam(galaxy, 'anniversaryChance', 0.3);

    for (const empire of majorEmpires(galaxy)) {
        // Festival: any government. A month-long approval bump (empireApprovalRating query above).
        if (galaxy.rnd.nextDouble() < festivalChance) {
            festivalState(galaxy)[String(empire.empireId)] = { until: now + MONTH_LENGTH, bonus: festivalBonus };
            if (!isHumanEmpire(galaxy, empire)) {
                scenarioMessage(galaxy, empire, scenarioText('Lively Festival Title'), scenarioText('Lively Festival Own'), { type: EmpireMessageType.GeneralGoodEvent });
            }
        }

        // Election (democratic-manner governments) / coronation (Monarchy): at most one leader-change roll per year,
        // honouring the same cooldown a natural leader change would (Empire.6.cs 4757 NextAllowableLeaderChangeDate).
        if (empire.capital !== null && now > nextAllowableLeaderChangeDate(empire)) {
            const gov = empireGovernmentAttributes(empire);
            if (gov !== null && gov.leaderReplacementTypicalManner === 2 && galaxy.rnd.nextDouble() < electionChance) {
                // No override: an election-manner government already resolves to PerformChangeLeader's own "Election" message.
                performChangeLeader(galaxy, empire);
                scenarioNews(galaxy, null, scenarioText('Lively Election News', empire.name), (e) => e !== empire);
            } else if (gov !== null && gov.name === 'Monarchy' && galaxy.rnd.nextDouble() < coronationChance) {
                // changeType 0 ("Replaced"): an orderly succession message, not stock Monarchy's own "coup d'état" one.
                performChangeLeader(galaxy, empire, 0);
                scenarioNews(galaxy, null, scenarioText('Lively Coronation News', empire.name), (e) => e !== empire);
            }
        }

        // Wonder anniversaries: record the first year a wonder bonus is seen (an approximation of its dedication date).
        const wonders = wonderAnniversaryState(galaxy);
        const wKey = String(empire.empireId);
        if (wonders[wKey] === undefined && empireHasWonderBonus(empire)) wonders[wKey] = year;
    }

    // War anniversaries.
    for (const w of warAnniversaryState(galaxy)) {
        const age = year - w.year;
        if (age <= 0 || age % anniversaryPeriod !== 0) continue;
        for (const empireId of [w.a, w.b]) {
            const empire = galaxy.empires.find((e) => e !== null && e.active && e.empireId === empireId) ?? null;
            if (empire === null) continue;
            if (!(galaxy.rnd.nextDouble() < anniversaryChance)) continue;
            celebrateAnniversary(galaxy, empire, 'Lively Anniversary War Title', 'Lively Anniversary War Own', 'Lively Anniversary War News');
        }
    }

    // Wonder anniversaries.
    for (const [wKey, wYear] of Object.entries(wonderAnniversaryState(galaxy))) {
        const age = year - wYear;
        if (age <= 0 || age % anniversaryPeriod !== 0) continue;
        const empire = galaxy.empires.find((e) => e !== null && e.active && e.empireId === Number(wKey)) ?? null;
        if (empire === null) continue;
        if (!(galaxy.rnd.nextDouble() < anniversaryChance)) continue;
        celebrateAnniversary(galaxy, empire, 'Lively Anniversary Wonder Title', 'Lively Anniversary Wonder Own', 'Lively Anniversary Wonder News');
    }
}

registerScenarioYearly({ id: 'lively.calendar', scenarioId: LIVELY_GALAXY_ID, flag: 'livingCalendar', order: 40, run: (g) => livingCalendarYearly(g) });
