// Empire Comparisons and Victory Conditions window (task 15d, parity #14), opened by V, plus the game-end screen (this window on
// Achievements with the outcome overlay; the Continue / Exit panel is gameEndPanel.ts).
//
// The window is Main.Part6.cs method_400 (vHfFsoqMev "Empire Comparison", 925 × 785; tabEmpireComparisonGraphs
// 890 × 705 at (10, 10); every tab's panel 860 × 660 at (10, 10) of its page), with the tabs in the original's order:
// - Victory Conditions: RaceVictoryConditionsPanel.cs (header lines, the per-empire stacked progress bars with the
//   threshold line, the hover detail DrawEmpireConditionsDetail incl. the race / pirate play-style conditions and the
//   bonus footers) + the scenario lists of GameVictoryConditions.cs (hidden in 1.9.5; see scenarioConditionLines);
// - Achievements: GameSummaryPanel.cs (gameSummary.ts), with the persisted GameSummaryList;
// - Population / Territory / Economy / Strategic Value / Military Strength: EmpireComparison.cs bar graphs
//   (DetermineOrderedKnownEmpires, Galaxy.5.cs 3331);
// - Top Colonies: TopColonies.cs.
// The original has no history charts in this window (EmpireComparison.cs draws the current values only), so there is
// no "history" to port.
//
// Other ports here: GameVictoryConditions.cs 90-230 / 331-348 → globalConditionLines (the older text summary, kept
// for its tests and callers); Main.Part12.cs 3423 DoGameEnd and Main.Part6.cs 3998 method_436 → installGameEndHandler
// / presentGameEnd / gameEndBannerLines / canContinueAfterGameEnd.
//
// Render/UI only: every lookup is read-only (the C# BindData's GenerateVictoryConditionProgresses(…, true) and the
// detail's ObtainDiplomaticRelation add relations; here the progresses are generated with filterOutUnmetEmpires =
// false and filtered with read-only lookups — isVictoryProgressVisible / diplomaticRelationTypeReadOnly). It reads
// the read-only replica under ?simWorker=1.
//
// TODO(port): Shakturi story message (Code 1) — Main.Part12.cs 3428 DoGameEnd.

import './empireComparison.css';
import type { Empire } from '../../sim/empire';
import type { Galaxy } from '../../sim/galaxy';
import type { Habitat } from '../../sim/types';
import { HabitatCategoryType } from '../../sim/types';
import {
    doGameEnd,
    GameEndOutcome,
    generateVictoryConditionProgresses,
    setGameEndHandler,
} from '../../sim/victory';
import type { GameEndEventArgs, VictoryConditionProgress, VictoryConditions } from '../../sim/victory';
import {
    AchievementType,
    determineAchievementLevel,
    determineAchievementValueForLevel,
    resolveAchievementLevelDescription,
    reviewAchievements,
} from '../../sim/achievements';
import type { Achievement } from '../../sim/achievements';
import { privateAnnualRevenue, totalColonyStrategicValue } from '../../sim/forceStructure';
import { musicGameEnded } from '../../audio/musicPlayer'; // [audio]
import { militaryPotency } from '../../sim/diplomacyTick';
import { DiplomaticRelationType } from '../../sim/diplomacy';
import { resolveStarDateDescription } from '../../sim/galaxyTime';
import { parseGameText } from '../../sim/data/gameText';
import type { GameText } from '../../sim/data/gameText';
import { countLabel } from '../plural';
import { formatNet, tryGetText } from '../../sim/textResolver';
import type { EmpireVictoryConditions, RaceVictoryConditionProgress } from '../../sim/victory';
import {
    habitatListCountPirateControlledColonies,
    habitatListGetPirateControlledColonies,
    habitatListTotalPopulation,
    habitatListTotalPopulationOwnedColonies,
} from '../../sim/victory';
import { PirateRelationType } from '../../sim/pirateRelations';
import { PiratePlayStyle } from '../../sim/pirates';
import { calculateAccurateAnnualIncome, habitatAnnualRevenue } from '../../sim/forceStructure';
import { strategicValue } from '../../sim/territory';
import { habitatDevelopmentLevel } from '../../sim/developmentLevel';
import { planetaryFacilityDefinitionsStatic } from '../../sim/construction/facilities';
import type { RaceVictoryCondition } from '../../sim/data/races';
import { asteroidUrls, planetUrls } from '../../render/assets';
import { applyEmpireEmblem } from '../empireEmblem';
import { openOriginalWindow, place, tabStrip } from '../originalWindow';
import { victoryConditionDescription } from './galactopedia';
import { clearGameSummaryOverlay, createGameSummaryPanel, recordGameEndSummary, type GameSummaryView } from './gameSummary';
import { closeGameEndPanel, openGameEndPanel } from './gameEndPanel';

// ---------------------------------------------------------------------------
// Formatting helpers (pure)
// ---------------------------------------------------------------------------

/** C# ToString("0%"): '76%'; non-finite values show '0%'. */
export function percent0(v: number): string {
    if (!Number.isFinite(v)) return '0%';
    return `${Math.round(v * 100)}%`;
}

export type ComparisonKind = 'population' | 'territory' | 'economy' | 'strategicValue' | 'military';

/** EmpireComparison.cs 98-141 titles. */
export const COMPARISON_TITLES: Record<ComparisonKind, string> = {
    population: 'Population',
    territory: 'Territory - Colonies',
    economy: 'Economy - Annual GDP',
    strategicValue: 'Strategic Value',
    military: 'Military Strength',
};

const COMPARISON_KINDS: readonly ComparisonKind[] = ['population', 'territory', 'economy', 'strategicValue', 'military'];

/** EmpireComparison.cs value formats. No digit grouping: in .NET `0,K` /
 * `0,,M` only scale by 1000 / 1e6. */
export function formatComparisonValue(kind: ComparisonKind, v: number): string {
    switch (kind) {
        case 'population': return `${Math.round(v / 1e6)}M`;
        // GameText "colonies format" is '#0 colonies'; singular for exactly 1.
        case 'territory': return countLabel(Math.round(v), 'colony', 'colonies');
        case 'economy': return `${Math.round(v / 1000)}K credits`;
        case 'strategicValue': return `${Math.round(v / 1000)}K`;
        case 'military': return `${Math.round(v)} firepower`;
    }
}

// ---------------------------------------------------------------------------
// Victory Conditions text (GameVictoryConditions.cs)
// ---------------------------------------------------------------------------

export interface ConditionEmpireStat {
    name: string;
    playable: boolean;
    known: boolean;
    isPlayer: boolean;
    revenue: number;
    population: number;
    colonies: number;
}

export interface ConditionLine {
    text: string;
    emphasis: boolean;
}

export interface ConditionInput {
    conditions: VictoryConditions | null;
    finished: boolean;
    victorName: string | null;
    raceSpecificEnabled: boolean;
    scenarioConditions: boolean;
    empires: ConditionEmpireStat[];
    defend: { category: string; name: string; empireName: string } | null;
    target: { category: string; name: string; empireName: string } | null;
    starDateText: (d: number) => string;
}

/** The "Closest Empire" line of GameVictoryConditions.cs: the first playable
 * empire with a strictly greater value than the running max (from 0); the sum
 * runs over all empires. Unknown non-player empires are hidden. */
function closestEmpireText(empires: readonly ConditionEmpireStat[], value: (e: ConditionEmpireStat) => number): string {
    let closest: ConditionEmpireStat | null = null;
    let max = 0.0;
    let sum = 0.0;
    for (const e of empires) {
        const v = value(e);
        sum += v;
        if (e.playable && v > max) {
            closest = e;
            max = v;
        }
    }
    let str = '(None)';
    if (closest !== null) {
        str = `${closest.name} (${percent0(max / sum)})`;
        if (!closest.isPlayer && !closest.known) str = '(Unknown empire)';
    }
    return `Closest Empire: ${str}`;
}

/** Port of GameVictoryConditions.cs 90-230 / 331-348 with the GameText.txt values. */
export function globalConditionLines(input: ConditionInput): ConditionLine[] {
    const lines: ConditionLine[] = [];
    const draw = (text: string, emphasis = false): void => {
        lines.push({ text, emphasis });
    };
    if (input.finished) {
        draw('GAME OVER', true);
        if (input.victorName !== null) draw(`Winner: ${input.victorName}`, true);
    }
    let flag = false;
    const c = input.conditions;
    if (c !== null) {
        if (c.economy || c.population || c.territory || c.timeLimit || c.targetHabitat != null || c.defendHabitat != null) {
            flag = true;
            draw('Global Conditions', true);
        }
        if (c.timeLimit) {
            draw(`Game finishes at ${input.starDateText(c.timeLimitDate)}`);
            draw('(Winner is the empire with the greatest strategic value at this time)');
        }
        if (c.startDate > 0) draw(`Victory Conditions do not apply until ${input.starDateText(c.startDate)}`);
        if (c.economy) {
            draw(`Empire's private economy (GDP) generates ${Math.round(c.economyPercent)}% of galaxy total`);
            draw(closestEmpireText(input.empires, (e) => e.revenue));
        }
        if (c.population) {
            draw(`Control ${Math.round(c.populationPercent)}% of the galaxy's population`);
            draw(closestEmpireText(input.empires, (e) => e.population));
        }
        if (c.territory) {
            draw(`Control ${Math.round(c.territoryPercent)}% of colonies in the galaxy`);
            draw(closestEmpireText(input.empires, (e) => e.colonies));
        }
        if (input.defend !== null) {
            draw(`You must prevent the ${input.defend.category} ${input.defend.name} of the ${input.defend.empireName} from being taken over or destroyed`, true);
        }
        if (input.target !== null) {
            draw(`You must take over or destroy the ${input.target.category} ${input.target.name} of the ${input.target.empireName}`, true);
        }
    }
    if (input.raceSpecificEnabled) draw('Race-specific Victory Conditions are Active', true);
    if (flag || input.scenarioConditions) return lines;
    draw('SANDBOX MODE (Open Play - No victory conditions)', true);
    return lines;
}

// ---------------------------------------------------------------------------
// Comparison rankings (EmpireComparison.cs, Galaxy.5.cs DetermineOrderedKnownEmpires)
// ---------------------------------------------------------------------------

export interface RankedValue<T> {
    rank: number;
    item: T;
    value: number;
}

/** Descending by value, rank from 1. The C# `Sort()` + `Reverse()` is
 * unstable for ties; this is a stable sort (ties keep input order). */
export function rankDescending<T>(items: { item: T; value: number }[]): RankedValue<T>[] {
    return items
        .map((x, i) => ({ ...x, i }))
        .sort((a, b) => (b.value !== a.value ? (b.value > a.value ? 1 : -1) : a.i - b.i))
        .map((x, idx) => ({ rank: idx + 1, item: x.item, value: x.value }));
}

/** Galaxy.5.cs 3331: the empire itself plus every other empire it has met.
 * No `active` filter, as in the C#. */
export function knownEmpires(player: Empire): Empire[] {
    const list: Empire[] = [player];
    for (const rel of player.diplomaticRelations) {
        if (rel.type !== DiplomaticRelationType.NotMet && rel.otherEmpire != null) list.push(rel.otherEmpire);
    }
    return list;
}

/** True for the player itself or any empire the player has met. */
export function isKnownEmpire(player: Empire, e: Empire): boolean {
    return e === player || (player.diplomaticRelations.byEmpire(e)?.type ?? DiplomaticRelationType.NotMet) !== DiplomaticRelationType.NotMet;
}

/** The per-kind value read from the sim (DetermineOrderedKnownEmpires switch). */
export function comparisonValue(galaxy: Galaxy, e: Empire, kind: ComparisonKind): number {
    switch (kind) {
        case 'population': return e.totalPopulation;
        case 'territory': return e.colonies.length;
        case 'economy': return privateAnnualRevenue(galaxy, e);
        case 'strategicValue': return totalColonyStrategicValue(e);
        case 'military': return militaryPotency(e);
    }
}

// ---------------------------------------------------------------------------
// Victory progress table
// ---------------------------------------------------------------------------

export interface VictoryProgressRow {
    empire: Empire;
    name: string;
    isPlayer: boolean;
    total: number;
    territory: number | null;
    economy: number | null;
    population: number | null;
    race: number | null;
    bonus: number;
}

export function victoryProgressRows(
    progresses: VictoryConditionProgress[],
    player: Empire,
    isKnown: (e: Empire) => boolean,
): VictoryProgressRow[] {
    return progresses
        .filter((p) => p.empire === player || isKnown(p.empire))
        .sort((a, b) => b.compareTo(a))
        .map((p) => {
            const parts = p.getProgressAll();
            const hasRace = p.raceVictoryConditionsProgress != null && p.raceVictoryConditionsProgress.length > 0;
            return {
                empire: p.empire,
                name: p.empire.name,
                isPlayer: p.empire === player,
                total: p.totalProgress,
                territory: p.territoryEnabled ? parts.territoryProgress : null,
                economy: p.economyEnabled ? parts.economyProgress : null,
                population: p.populationEnabled ? parts.populationProgress : null,
                race: hasRace ? parts.raceProgress : null,
                bonus: p.bonusAmount + p.pirateBonusAmount,
            };
        });
}

// ---------------------------------------------------------------------------
// Achievements (Galaxy.1.cs 3465 / 3526 / 3624)
// ---------------------------------------------------------------------------

export interface AchievementRow {
    title: string;
    level: string;
    description: string;
}

export function achievementRows(list: readonly (Achievement | null)[], text: GameText | null): AchievementRow[] {
    const lookup = (k: string): string => text?.get(k) ?? k;
    const rows: AchievementRow[] = [];
    for (const a of list) {
        if (a === null || a.type === AchievementType.Undefined) continue;
        const level = determineAchievementLevel(a.type, a.value);
        const title = a.type === AchievementType.AchieveAllRaceVictoryConditions
            ? lookup('AchievementTitle AchieveAllRaceVictoryConditions').replace('{0}', a.additionalData?.name ?? '')
            : lookup('AchievementTitle ' + AchievementType[a.type]);
        const k = resolveAchievementLevelDescription(a.type, level);
        rows.push({
            title,
            level: k === '' ? '' : lookup(k),
            description: lookup('AchievementType ' + AchievementType[a.type]).replace('{0}', String(determineAchievementValueForLevel(a.type, level))),
        });
    }
    return rows;
}

let gameTextCache: Promise<GameText | null> | null = null;

/** GameText.txt once loaded (tx() falls back to the sim's TextResolver table). */
let loadedText: GameText | null = null;

/** GameText.txt, fetched once; null on any error. */
export function loadGameText(): Promise<GameText | null> {
    if (gameTextCache === null) {
        gameTextCache = fetch('/assets/dwu/GameText.txt')
            .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then((src) => parseGameText(src).text)
            .catch(() => null);
    }
    return gameTextCache;
}

// ---------------------------------------------------------------------------
// Game end (Main.Part12.cs DoGameEnd, Main.Part6.cs method_436)
// ---------------------------------------------------------------------------

/** method_436's overlay `list`. */
export function gameEndBannerLines(e: GameEndEventArgs): string[] {
    // TODO(port) M9: e.description is still a GameText key from the sim's getText stub
    if (e.outcomeForPlayer === GameEndOutcome.Victory) return ['VICTORY!', ' ', e.description];
    if (e.outcomeForPlayer === GameEndOutcome.Defeat) return ['DEFEAT!', ' ', e.description];
    return [' ', e.description];
}

/** method_436: Continue is disabled after a defeat that left the player with
 * no colonies or an inactive empire. */
export function canContinueAfterGameEnd(e: GameEndEventArgs, player: Empire | null): boolean {
    return !(e.outcomeForPlayer === GameEndOutcome.Defeat && player !== null && (player.colonies.length <= 0 || !player.active));
}

/** Subscribe Main.Galaxy_GameEnd → DoGameEnd. A second GameEnd in the same
 * check replaces the banner (the C# DoGameEnd would also run twice). */
export function installGameEndHandler(galaxy: Galaxy, time: { paused: boolean }): void {
    setGameEndHandler(galaxy, (e) => {
        time.paused = true; // method_154
        doGameEnd(galaxy, e);
        reviewAchievements(galaxy); // method_436's first line
        presentGameEnd(galaxy, time, e);
    });
}

/**
 * DoGameEnd's UI part: the music and the banner. In-thread the handler above runs it; with the sim in a worker
 * (docs/sim-worker.md §9 chunk 4) the worker's handler did the pause, DoGameEnd and the achievements on the
 * authoritative game, and its gameEnd event brings the args here (resolved to replica objects).
 */
export function presentGameEnd(galaxy: Galaxy, time: { paused: boolean }, e: GameEndEventArgs): void {
    // [audio] begin — Main.Part12.cs:3428 DoGameEnd → musicPlayer_0.StartTheme().
    if (typeof document !== 'undefined') musicGameEnded();
    // [audio] end
    if (typeof document === 'undefined') return;
    // method_436: the GameSummary of this game into the persisted list, the overlay lines, the victor selected.
    recordGameEndSummary(
        galaxy,
        e.outcomeForPlayer === GameEndOutcome.Victory,
        e.outcomeForPlayer === GameEndOutcome.Victory ? 'Victory' : e.outcomeForPlayer === GameEndOutcome.Defeat ? 'Defeat' : null,
        e.description,
        e.victorEmpire,
    );
    // Main.Part6.cs:4013-4026 method_436: method_400 (open the Empire Comparison window), tabEmpireComparisonGraphs
    // .SelectedIndex = 1 (Achievements, the Game Summary) with the outcome overlay (gameSummary.ts).
    const player = galaxy.playerEmpire;
    if (player) {
        if (open) open.close();
        selectedTab = 'achievements';
        open = createEmpireComparison({ player });
    }
    // pnlGameEnd: the outcome with Continue Playing / Exit to main menu (gameEndPanel.ts).
    openGameEndPanel(galaxy, time, e);
}

export function removeGameEndHandler(galaxy: Galaxy): void {
    setGameEndHandler(galaxy, null);
}

/** Hide the Game End panel (leaving the game). */
export function closeGameEndBanner(): void {
    closeGameEndPanel();
}

// ---------------------------------------------------------------------------
// Text + number formats
// ---------------------------------------------------------------------------

/** GameText value of `key`: the GameText.txt loaded here, else the sim's TextResolver table, else `fallback`
 *  (the English GameText.txt value). */
function tx(key: string, fallback: string): string {
    return loadedText?.get(key) ?? tryGetText(key) ?? fallback;
}

function txf(key: string, fallback: string, ...args: unknown[]): string {
    return formatNet(tx(key, fallback), args);
}

/** A GameText view of tx() for the galactopedia port (getText(text, key) only calls get). */
const TEXT_VIEW = { get: (k: string): string | undefined => loadedText?.get(k) ?? tryGetText(k) ?? undefined } as unknown as GameText;

/** .NET "0" / "#0" (half away from zero). */
function n0(v: number): string {
    if (!Number.isFinite(v)) return '0';
    return String(Math.sign(v) * Math.round(Math.abs(v)));
}

/** .NET "0,,M". */
function millions(v: number): string {
    return `${n0(v / 1e6)}M`;
}

/** .NET "0,K". */
function thousandsK(v: number): string {
    return `${n0(v / 1000)}K`;
}

/** .NET "###,###,###,###,##0". */
function grouped(v: number): string {
    const n = Math.round(Number.isFinite(v) ? Math.abs(v) : 0);
    return (v < 0 && n !== 0 ? '-' : '') + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** .NET "+0.0%;-0.0%" (and "+0.0%" for the positive amounts it is used with). */
function signedPercent1(v: number): string {
    const p = (Math.abs(v) * 100).toFixed(1);
    return `${v < 0 ? '-' : '+'}${p}%`;
}

// ---------------------------------------------------------------------------
// Read-only relation lookups (the C# Obtain* calls without their side effects)
// ---------------------------------------------------------------------------

/** Empire.4.cs 137 ObtainDiplomaticRelation(empire).Type, read-only: a missing relation reads as NotMet (the C#
 *  would add it). */
export function diplomaticRelationTypeReadOnly(self: Empire, other: Empire | null): DiplomaticRelationType {
    if (other == null || other === self.galaxy?.independentEmpire) return DiplomaticRelationType.None;
    if (other.pirateEmpireBaseHabitat !== null || self.pirateEmpireBaseHabitat !== null) return DiplomaticRelationType.None;
    if (other === self) return DiplomaticRelationType.None;
    if (self.diplomaticRelations == null) return DiplomaticRelationType.None;
    return self.diplomaticRelations.byEmpire(other)?.type ?? DiplomaticRelationType.NotMet;
}

/** Empire.8.cs 2351 ObtainPirateRelation(otherEmpire).Type, read-only (a missing relation is NotMet). */
export function pirateRelationTypeReadOnly(self: Empire, other: Empire | null): PirateRelationType {
    if (other == null) return PirateRelationType.None;
    if (other === self) return PirateRelationType.Protection;
    return self.pirateRelations?.getRelationByOtherEmpire(other)?.type ?? PirateRelationType.NotMet;
}

/** Galaxy.1.cs 241-253 (GenerateVictoryConditionProgresses, filterOutUnmetEmpires = true — the panel's BindData):
 *  the player, or an empire met by diplomatic relation (both normal) / pirate relation (either a pirate). */
export function isVictoryProgressVisible(player: Empire, e: Empire): boolean {
    if (e === player) return true;
    if (e.pirateEmpireBaseHabitat === null && player.pirateEmpireBaseHabitat === null) {
        return diplomaticRelationTypeReadOnly(player, e) !== DiplomaticRelationType.NotMet;
    }
    return pirateRelationTypeReadOnly(player, e) !== PirateRelationType.NotMet;
}

// ---------------------------------------------------------------------------
// Victory Conditions tab (RaceVictoryConditionsPanel.cs + GameVictoryConditions.cs scenario lists)
// ---------------------------------------------------------------------------

export interface PanelLine {
    text: string;
    x: number;
    y: number;
    bold: boolean;
    /** Text colour; default (170, 170, 170). */
    color?: string;
}

export interface VictoryHeaderInput {
    finished: boolean;
    victorName: string | null;
    conditions: VictoryConditions | null;
    scenarioConditions: boolean;
    defend: { category: string; name: string; empireName: string } | null;
    target: { category: string; name: string; empireName: string } | null;
    starDateText: (d: number) => string;
}

/** RaceVictoryConditionsPanel.cs 88 DrawVictoryConditions: the lines above the bars and the y they end at (the
 *  bars' startY). Row height 14, top 10, left 10, indent 40. */
export function victoryHeaderLines(input: VictoryHeaderInput): { lines: PanelLine[]; endY: number } {
    const rh = 14;
    const x = 10;
    const indent = 40;
    let y = 10;
    const lines: PanelLine[] = [];
    let flag = false;
    if (input.finished) {
        lines.push({ text: tx('GAME OVER', 'GAME OVER'), x, y, bold: true, color: 'rgb(255, 255, 0)' });
        if (input.victorName !== null) {
            y += rh;
            lines.push({ text: `${tx('Winner', 'Winner')}: ${input.victorName}`, x: x + indent, y, bold: true, color: 'rgb(255, 255, 0)' });
        }
        y += rh + rh;
    }
    const c = input.conditions;
    if (c !== null) {
        if (c.economy || c.population || c.territory || c.timeLimit || c.targetHabitat != null || c.defendHabitat != null || c.enableRaceSpecificVictoryConditions) flag = true;
        if (c.timeLimit) {
            lines.push({ text: txf('To win - Time Limit', ' Game finishes at {0}', input.starDateText(c.timeLimitDate)), x, y, bold: true });
            y += rh;
            lines.push({ text: `(${tx('To win - Time Limit explanation', 'Winner is the empire with the greatest strategic value at this time')})`, x: x + indent, y, bold: false });
            y += rh + rh;
        }
        if (c.startDate > 0) {
            lines.push({ text: txf('To win - Start Date', ' Victory Conditions do not apply until {0}', input.starDateText(c.startDate)), x, y, bold: true });
            y += rh + rh;
        }
        if (input.defend !== null) {
            lines.push({ text: txf('Victory Conditions Defend Colony', 'You must prevent the {0} {1} of the {2} from being taken over or destroyed', input.defend.category, input.defend.name, input.defend.empireName), x, y, bold: true });
            y += rh + rh;
        }
        if (input.target !== null) {
            lines.push({ text: txf('Victory Conditions Conquer Colony', 'You must take over or destroy the {0} {1} of the {2}', input.target.category, input.target.name, input.target.empireName), x, y, bold: true });
            y += rh + rh;
        }
    }
    if (!flag && !input.scenarioConditions) {
        lines.push({ text: tx('SANDBOX MODE', 'SANDBOX MODE (Open Play - No victory conditions)'), x, y, bold: true });
        y += rh + rh;
    }
    return { lines, endY: y };
}

export interface ScenarioConditionsText {
    captureColonies: string[];
    destroyBuiltObjects: string[];
    eliminateEmpires: string[];
}

/** EmpireVictoryConditions → the names GameVictoryConditions.cs draws (a captured colony that is its empire's capital
 *  reads "<empire> capital" in the Achieve list only). */
export function scenarioConditionsText(c: EmpireVictoryConditions | null, achieve: boolean): ScenarioConditionsText | null {
    if (c === null) return null;
    return {
        captureColonies: c.captureColonies.map((h) => (achieve && h.empire !== null && h.empire.capital === h ? `${h.empire.name} capital` : h.name)),
        destroyBuiltObjects: c.destroyBuiltObjects.map((b) => b.name),
        eliminateEmpires: c.eliminateEmpires.map((e) => e.name),
    };
}

/**
 * GameVictoryConditions.cs 278-371: "Your Conditions to Achieve" / "Your Conditions to Prevent" with their lists
 * (left margin 30, label indent 40, names at 280, row 14). The 1.9.5 window hides that control (method_400:
 * pnlGameVictoryConditions.Visible = false) and shows only the race panel, which never lists a scenario's conditions;
 * they are drawn here under the race panel's header so a scenario game shows them.
 */
export function scenarioConditionLines(achieve: ScenarioConditionsText | null, prevent: ScenarioConditionsText | null, startY: number): { lines: PanelLine[]; endY: number } {
    const rh = 14;
    const left = 30;
    const lines: PanelLine[] = [];
    let y = startY;
    const block = (label: string, names: readonly string[]): void => {
        if (names.length === 0) return;
        lines.push({ text: label, x: left + 40, y, bold: false });
        for (const n of names) {
            lines.push({ text: n, x: left + 280, y, bold: true });
            y += rh;
        }
        y += rh;
    };
    if (achieve !== null) {
        lines.push({ text: 'Your Conditions to Achieve', x: left, y, bold: true });
        y += rh + rh;
        block('Capture the following colonies: ', achieve.captureColonies);
        block('Destroy the following ships or bases: ', achieve.destroyBuiltObjects);
        block('Eliminate the following empires: ', achieve.eliminateEmpires);
    }
    if (prevent !== null) {
        lines.push({ text: 'Your Conditions to Prevent', x: left, y, bold: true });
        y += rh + rh;
        block('Loss of the following colonies: ', prevent.captureColonies);
        block('Destruction of the following ships or bases: ', prevent.destroyBuiltObjects);
        block('Elimination of the following empires: ', prevent.eliminateEmpires);
    }
    return { lines, endY: y };
}

/** RaceVictoryConditionsPanel.cs _RowHeight / _RowSpacing. */
export const VICTORY_ROW_HEIGHT = 22;
export const VICTORY_ROW_SPACING = 6;

/** The segment colours (RaceVictoryConditionsPanel.cs _EconomyColor … _BonusColor2): dark → bright gradients. */
export const VICTORY_SEGMENT_COLORS = {
    economy: ['rgb(0, 0, 80)', 'rgb(0, 0, 255)'],
    population: ['rgb(0, 80, 0)', 'rgb(0, 255, 0)'],
    territory: ['rgb(80, 80, 0)', 'rgb(255, 255, 0)'],
    race: ['rgb(80, 0, 0)', 'rgb(255, 0, 0)'],
    bonus: ['rgb(80, 40, 0)', 'rgb(255, 128, 0)'],
} as const;

export type VictorySegmentKind = keyof typeof VICTORY_SEGMENT_COLORS;

/** DrawConditions geometry for a `panelWidth` panel: the 36 × 22 flag, the 22 × 22 race image after 3 px, the bar
 *  from x = 64 to the panel's right edge, and the red threshold line. */
export function victoryBarGeometry(panelWidth: number, threshold: number): { flagW: number; raceX: number; barX: number; barW: number; thresholdX: number } {
    const flagW = Math.trunc(VICTORY_ROW_HEIGHT / 0.6);
    const barX = flagW + 3 + VICTORY_ROW_HEIGHT + 3;
    const barW = panelWidth - barX;
    return { flagW, raceX: flagW + 3, barX, barW, thresholdX: barX + Math.trunc(barW * threshold) };
}

/** DrawConditions 549-617: the stacked segments of one row (panel x, width; only those >= 1 px are drawn, but each
 *  width still advances x). */
export function victoryBarSegments(p: VictoryConditionProgress, gvc: VictoryConditions, barX: number, barW: number): { kind: VictorySegmentKind; x: number; w: number }[] {
    const parts = p.getProgressAll();
    const widths: [VictorySegmentKind, number][] = [
        ['economy', gvc.economy && parts.economyProgress > 0 ? parts.economyProgress * barW : 0],
        ['population', gvc.population && parts.populationProgress > 0 ? parts.populationProgress * barW : 0],
        ['territory', gvc.territory && parts.territoryProgress > 0 ? parts.territoryProgress * barW : 0],
        ['race', gvc.enableRaceSpecificVictoryConditions && parts.raceProgress > 0 ? parts.raceProgress * barW : 0],
        ['bonus', p.bonusAmount > 0 || p.pirateBonusAmount > 0 ? (p.bonusAmount + p.pirateBonusAmount) * barW : 0],
    ];
    const out: { kind: VictorySegmentKind; x: number; w: number }[] = [];
    let x = barX;
    for (const [kind, w] of widths) {
        if (w >= 1) out.push({ kind, x: Math.trunc(x), w: Math.trunc(w) });
        x += w;
    }
    return out;
}

/** ShowVictoryConditionDetail: the detail box's top for row `index` (below the row when it fits, else above). */
export function victoryDetailTop(index: number, startY: number, panelHeight: number, height = 300): number {
    const num2 = 5 + index * (VICTORY_ROW_HEIGHT + VICTORY_ROW_SPACING);
    return num2 + VICTORY_ROW_HEIGHT + height + startY <= panelHeight ? num2 + VICTORY_ROW_HEIGHT + startY : num2 - height + startY;
}

export interface VictoryDetailColumn {
    kind: 'economy' | 'population' | 'territory';
    x: number;
    width: number;
    heading: string;
    color: string;
    target: string;
    who: string;
    value: string;
}

export interface VictoryDetailRaceRow {
    portion: string;
    description: string;
    progress: string;
    extra: string | null;
}

export interface VictoryDetailModel {
    title: string;
    threshold: string;
    height: number;
    columnWidth: number;
    separators: number[];
    columns: VictoryDetailColumn[];
    race: { x: number; width: number; descriptionWidth: number; heading: string; rows: VictoryDetailRaceRow[] } | null;
    bonus: { title: string; detail: string } | null;
}

/** What DrawEmpireConditionsDetail reads off the empire / galaxy, gathered read-only by the caller. */
export interface VictoryDetailContext {
    isPlayer: boolean;
    isPirate: boolean;
    /** PrivateAnnualRevenue, or CalculateAccurateAnnualIncome for a pirate. */
    economyValue: number;
    /** TotalPopulation, or owned + controlled / 2 for a pirate. */
    populationValue: number;
    colonyCount: number;
    /** CountPirateControlledColonies (pirates only). */
    pirateColonies: { controlled: number; owned: number } | null;
    /** TotalPopulationOwnedColonies (the pirate bonus detail). */
    ownedColonyPopulation: number;
    raceName: string;
    piratePlayStyle: string;
    describe: (c: RaceVictoryConditionProgress) => string;
    /** The best empire's name when the player has met it and it is not this empire, else null. */
    bestEmpireName: (c: RaceVictoryConditionProgress) => string | null;
}

/** RaceVictoryConditionsPanel.cs 161 DrawEmpireConditionsDetail for a `width` wide box. */
export function victoryDetailModel(p: VictoryConditionProgress, gvc: VictoryConditions, ctx: VictoryDetailContext, width: number): VictoryDetailModel {
    const name = p.empire.name;
    const hasBonus = p.bonusAmount > 0 || p.pirateBonusAmount > 0;
    const height = 300 + (hasBonus ? 60 : 0);
    const margin = 5;
    const portionCount = p.getPortionCount();
    const hasRace = p.raceVictoryConditionsProgress != null && p.raceVictoryConditionsProgress.length > 0;
    let num5 = width;
    if (portionCount > 0) num5 = width / (portionCount + 1);
    if (portionCount === 1 && hasRace) num5 = width;
    const width2 = num5 - margin * 2;
    const separators: number[] = [];
    if (portionCount > 1) for (let i = 1; i < portionCount; i++) separators.push(Math.trunc(i * num5));
    const num7 = 1.0 / portionCount;
    const parts = p.getProgressAll();
    const who = ctx.isPlayer ? tx('Your Empire', 'Your Empire') : name;
    const columns: VictoryDetailColumn[] = [];
    let num8 = 0;
    const col = (kind: VictoryDetailColumn['kind'], heading: string, color: string, target: string, value: string): void => {
        columns.push({ kind, x: Math.trunc(num8 * num5) + margin, width: width2, heading, color, target, who: `${who}:`, value });
        num8++;
    };
    if (p.economyEnabled) {
        col('economy', `${tx('Economy', 'Economy')}  ${n0(parts.economyProgress * 100)}/${percent0(num7)}`, VICTORY_SEGMENT_COLORS.economy[1],
            txf('Victory Conditions Economy', "Empire's private economy (GDP) generates {0}% of galaxy total", n0(gvc.economyPercent)),
            `${txf('Victory Conditions Economy', "Empire's private economy (GDP) generates {0}% of galaxy total", n0(p.economyPercent * 100))}  (${txf('Trade Description Money', '{0} credits', grouped(ctx.economyValue))})`);
    }
    if (p.populationEnabled) {
        col('population', `${tx('Population', 'Population')}  ${n0(parts.populationProgress * 100)}/${percent0(num7)}`, VICTORY_SEGMENT_COLORS.population[1],
            txf('Victory Conditions Population', "Control {0}% of the galaxy's population", n0(gvc.populationPercent)),
            `${txf('Victory Conditions Population', "Control {0}% of the galaxy's population", n0(p.populationPercent * 100))}  (${tx('Population', 'Population')}: ${millions(ctx.populationValue)})`);
    }
    if (p.territoryEnabled) {
        const str6 = txf('Victory Conditions Territory', 'Control {0}% of colonies in the galaxy', n0(p.territoryPercent * 100));
        let value: string;
        if (ctx.isPirate && ctx.pirateColonies !== null) {
            const pc = ctx.pirateColonies;
            const str7 = txf('Pirate Territory Colonies Controlled vs Owned', '{0} controlled, {1} owned', n0(pc.controlled), n0(pc.owned));
            value = `${str6}  (${(pc.owned + pc.controlled / 2.0).toFixed(1)} ${tx('colonies', 'colonies')}:  ${str7})`;
        } else {
            value = `${str6}  (${n0(ctx.colonyCount)} ${tx('colonies', 'colonies')})`;
        }
        col('territory', `${tx('Territory', 'Territory')}  ${n0(parts.territoryProgress * 100)}/${percent0(num7)}`, VICTORY_SEGMENT_COLORS.territory[1],
            txf('Victory Conditions Territory', 'Control {0}% of colonies in the galaxy', n0(gvc.territoryPercent)), value);
    }
    let race: VictoryDetailModel['race'] = null;
    if (hasRace) {
        const x = Math.trunc(num8 * num5) + margin;
        const num13 = portionCount === 1 ? width : num5 * 2.0;
        const width4 = Math.min(num13 - margin * 2, 840.0);
        const width5 = Math.trunc(width4 - 60.0);
        const progressText = `${n0(parts.raceProgress * 100)}/${percent0(num7)}`;
        const heading = ctx.isPirate
            ? `${ctx.piratePlayStyle} ${tx('Victory Conditions', 'Victory Conditions')}  ${progressText}`
            : `${ctx.raceName} ${tx('Race Victory Conditions', 'Race Victory Conditions')}  ${progressText}`;
        const rows: VictoryDetailRaceRow[] = [];
        for (const rp of p.raceVictoryConditionsProgress!) {
            if (rp == null) continue;
            let extra: string | null = null;
            const best = ctx.bestEmpireName(rp);
            if ((rp.bestEmpire != null && rp.bestEmpire !== p.empire) || rp.detail !== '') {
                let s = '';
                if (best !== null) {
                    s += best;
                    if (rp.detail !== '') s += ': ';
                }
                extra = s + rp.detail;
            }
            rows.push({ portion: `${n0(rp.condition.proportion)}%`, description: ctx.describe(rp), progress: percent0(rp.thisProgress), extra });
        }
        race = { x, width: width4, descriptionWidth: width5, heading, rows };
    }
    let bonus: VictoryDetailModel['bonus'] = null;
    if (p.pirateBonusAmount > 0) {
        if (ctx.isPirate) {
            const pop = millions(ctx.ownedColonyPopulation);
            if (p.bonusAmount > 0) {
                const total = signedPercent1(p.pirateBonusAmount + p.bonusAmount);
                bonus = p.standingWonderBonusAmount <= 0
                    ? {
                        title: txf('Pirate Owned Colony Population Victory Condition Bonus Plus Others Description', 'Pirate Colonized Population Bonus (plus other game events): {0}', total),
                        detail: txf('Pirate Owned Colony Population Victory Condition Bonus Plus Others Detail', '{0} population at colonies owned by {1}, and bonus from other game events', pop, name),
                    }
                    : {
                        title: txf('Pirate Owned Colony Population Victory Condition Bonus Plus Others Standing Wonders Description', 'Pirate Colonized Population Bonus (plus other game events and standing wonders): {0}', total),
                        detail: txf('Pirate Owned Colony Population Victory Condition Bonus Plus Others Standing Wonders Detail', '{0} population at colonies owned by {1}, and bonus from other game events and standing wonders', pop, name),
                    };
            } else {
                bonus = {
                    title: txf('Pirate Owned Colony Population Victory Condition Bonus Description', 'Pirate Colonized Population Bonus: {0}', signedPercent1(p.pirateBonusAmount)),
                    detail: txf('Pirate Owned Colony Population Victory Condition Bonus Detail', '{0} population at colonies owned by {1}', pop, name),
                };
            }
        }
    } else if (p.bonusAmount > 0) {
        const b = signedPercent1(p.bonusAmount);
        bonus = p.standingWonderBonusAmount <= 0
            ? { title: txf('Victory Condition Bonus Description', 'Game Events Bonus: {0}', b), detail: txf('Victory Condition Bonus Detail', '{0} total bonuses from game events', b) }
            : {
                title: txf('Victory Condition Bonus Description Standing Wonders', 'Game Events and Standing Wonders Bonus: {0}', b),
                detail: txf('Victory Condition Bonus Detail Standing Wonders', '{0} total bonuses from game events and standing wonders', b),
            };
    }
    return {
        title: `${name}  (${percent0(p.totalProgress)})`,
        threshold: `${tx('Victory Threshold', 'Victory Threshold')}: ${percent0(gvc.victoryThresholdPercentage)}`,
        height,
        columnWidth: num5,
        separators,
        columns,
        race,
        bonus,
    };
}

/** Galaxy.2.cs 2618 ResolveDescription(PiratePlayStyle). */
export function piratePlayStyleDescription(s: PiratePlayStyle): string {
    switch (s) {
        case PiratePlayStyle.Balanced: return tx('PiratePlayStyle Balanced', 'Balanced');
        case PiratePlayStyle.Pirate: return tx('PiratePlayStyle Pirate', 'Raider');
        case PiratePlayStyle.Mercenary: return tx('PiratePlayStyle Mercenary', 'Mercenary');
        case PiratePlayStyle.Smuggler: return tx('PiratePlayStyle Smuggler', 'Smuggler');
        default: return tx('None', 'None');
    }
}

/** The read-only VictoryDetailContext of a progress (the values DrawEmpireConditionsDetail reads). */
function victoryDetailContext(galaxy: Galaxy, player: Empire, p: VictoryConditionProgress): VictoryDetailContext {
    const e = p.empire;
    const isPirate = e.pirateEmpireBaseHabitat !== null;
    const safe = (f: () => number): number => {
        try {
            const v = f();
            return Number.isFinite(v) ? v : 0;
        } catch {
            return 0;
        }
    };
    let populationValue = e.totalPopulation;
    let pirateColonies: VictoryDetailContext['pirateColonies'] = null;
    if (isPirate) {
        const pc = habitatListGetPirateControlledColonies(e.colonies, e);
        populationValue = habitatListTotalPopulation(pc.ownedColonies) + Math.trunc(habitatListTotalPopulation(pc.controlledColonies) / 2);
        const c = habitatListCountPirateControlledColonies(e.colonies, e);
        pirateColonies = { controlled: c.count, owned: c.ownedColonyCount };
    }
    const facilities = planetaryFacilityDefinitionsStatic(galaxy);
    return {
        isPlayer: e === galaxy.playerEmpire,
        isPirate,
        economyValue: safe(() => (isPirate ? calculateAccurateAnnualIncome(galaxy, e) : privateAnnualRevenue(galaxy, e))),
        populationValue,
        colonyCount: e.colonies.length,
        pirateColonies,
        ownedColonyPopulation: isPirate ? habitatListTotalPopulationOwnedColonies(e.colonies, e) : 0,
        raceName: e.dominantRace?.name ?? '',
        piratePlayStyle: piratePlayStyleDescription(e.piratePlayStyle),
        describe: (rp) => victoryConditionDescription(TEXT_VIEW, rp.condition as unknown as RaceVictoryCondition, facilities, e.homeWorld?.name ?? null),
        // 394-401: ObtainDiplomaticRelation(BestEmpire).Type != NotMet (read-only here).
        bestEmpireName: (rp) => (rp.bestEmpire != null && rp.bestEmpire !== e && diplomaticRelationTypeReadOnly(player, rp.bestEmpire) !== DiplomaticRelationType.NotMet ? rp.bestEmpire.name : null),
    };
}

// ---------------------------------------------------------------------------
// Comparison graph tabs (EmpireComparison.cs DrawEmpireComparison)
// ---------------------------------------------------------------------------

export interface ComparisonGraphRow<T> {
    rank: number;
    item: T;
    value: number;
    y: number;
    fillWidth: number;
}

/** DrawEmpireComparison layout constants (top margin 10, left margin 10, num1 = 40, num2 = 50, 800 px bars). */
export const COMPARISON_GRAPH = { top: 10, left: 10, axisY: 40, barX: 50, barW: 800, rowH: 20, pitch: 25 } as const;

/**
 * EmpireComparison.cs DrawEmpireComparison: the rows of a `height` px panel, descending (DetermineOrderedKnownEmpires:
 * Sort + Reverse), from y = 47 every 25 px; the loop stops after row num4 + 1, num4 = (height - 50) / 25. Each bar's
 * fill is DrawBarGraph's (int)((int)(v · k) / (int)(top · k) · 800), k = 800 / top.
 */
export function comparisonGraphRows<T>(items: { item: T; value: number }[], height: number): { top: number; rows: ComparisonGraphRow<T>[] } {
    const G = COMPARISON_GRAPH;
    const ranked = rankDescending(items);
    const top = ranked.length > 0 ? ranked[0].value : 0;
    const num3 = height - (G.top + G.axisY);
    const num4 = Math.trunc(num3 / G.pitch);
    const rows: ComparisonGraphRow<T>[] = [];
    const k = top > 0 ? G.barW / top : 0;
    const maximum = Math.trunc(top * k);
    let y = G.axisY + 7;
    let n = 0;
    for (const r of ranked) {
        const current = Math.trunc(r.value * k);
        let fill = maximum > 0 ? Math.trunc((current / maximum) * G.barW) : 0;
        fill = Math.max(0, Math.min(G.barW, fill));
        rows.push({ rank: r.rank, item: r.item, value: r.value, y, fillWidth: fill });
        y += G.pitch;
        n++;
        if (n > num4) break;
    }
    return { top, rows };
}

// ---------------------------------------------------------------------------
// Top Colonies tab (TopColonies.cs DrawColonies)
// ---------------------------------------------------------------------------

/**
 * TopColonies.cs DrawColonies 102-138: the player's colonies, then each met empire's colonies it owns in systems the
 * player has explored, then each met pirate faction's (PirateRelations), deduped; HabitatList.Sort (Habitat.CompareTo:
 * StrategicValue, then population when both are populated) + Reverse. Read-only.
 */
export function topColonies(player: Empire, value: (h: Habitat) => number = strategicValue): Habitat[] {
    const seen = new Set<Habitat>();
    const list: Habitat[] = [];
    const add = (h: Habitat): void => {
        if (!seen.has(h)) {
            seen.add(h);
            list.push(h);
        }
    };
    for (const c of player.colonies) add(c);
    const explored = (i: number): boolean => {
        try {
            return player.visibility.checkSystemExplored(i);
        } catch {
            return false;
        }
    };
    if (player.diplomaticRelations != null) {
        for (const r of player.diplomaticRelations) {
            if (r.type === DiplomaticRelationType.NotMet || r.otherEmpire == null) continue;
            for (const c of r.otherEmpire.colonies) if (c.owner === r.otherEmpire && explored(c.systemIndex)) add(c);
        }
    }
    if (player.pirateRelations != null) {
        for (const r of player.pirateRelations) {
            if (r.type === PirateRelationType.NotMet || r.otherEmpire == null) continue;
            for (const c of r.otherEmpire.colonies) if (c.owner === r.otherEmpire && explored(c.systemIndex)) add(c);
        }
    }
    // Habitat.CompareTo with the strategic value computed once per habitat.
    const sv = new Map<Habitat, number>();
    for (const h of list) sv.set(h, value(h));
    list.sort((a, b) => {
        const sa = sv.get(a)!;
        const sb = sv.get(b)!;
        if (sa === sb) {
            if (a.population != null && a.population.items.length > 0 && b.population != null && b.population.items.length > 0) {
                const x = a.population.totalAmount;
                const y = b.population.totalAmount;
                return x < y ? -1 : x > y ? 1 : 0;
            }
            return 0;
        }
        return sa < sb ? -1 : 1;
    });
    list.reverse();
    return list;
}

/** DrawColonies: rows of 60 px from y = 42; the loop draws num2 = (height - 45) / 60 of them. */
export function topColonyRowCap(height: number): number {
    return Math.trunc((height - (10 + 25 + 10)) / 60);
}

/** DrawColonies 160: "Population: xM,   Development Level: n%,   GDP: xK credits". */
export function topColonyStatsLine(population: number, developmentLevel: number, annualRevenue: number): string {
    return `${tx('Population', 'Population')}: ${millions(population)},   ${tx('Development Level', 'Development Level')}: ${n0(developmentLevel)}%,   ${tx('GDP', 'GDP')}: ${thousandsK(annualRevenue)} ${tx('credits', 'credits')}`;
}

// ---------------------------------------------------------------------------
// Panel DOM (Main.Part6.cs method_400: vHfFsoqMev 925 × 785, tabEmpireComparisonGraphs 890 × 705 at (10, 10),
// every tab's panel 860 × 660 at (10, 10) of its page)
// ---------------------------------------------------------------------------

export interface EmpireComparisonOptions {
    player: Empire;
}

type Tab = 'victory' | 'achievements' | 'population' | 'territory' | 'economy' | 'strategicValue' | 'military' | 'topColonies';

/** Main.InitializeComponent.cs 8734-8741 tab order; Main.Part6.cs method_400 tab texts. */
const TABS: readonly { id: Tab; key: string }[] = [
    { id: 'victory', key: 'Victory Conditions' },
    { id: 'achievements', key: 'Achievements' },
    { id: 'population', key: 'Population' },
    { id: 'territory', key: 'Territory' },
    { id: 'economy', key: 'Economy' },
    { id: 'strategicValue', key: 'Strategic Value' },
    { id: 'military', key: 'Military Strength' },
    { id: 'topColonies', key: 'Top Colonies' },
];

const WINDOW_W = 925;
const WINDOW_H = 785;
const TAB_CONTROL = { x: 10, y: 10, w: 890, h: 705 };
const PANEL = { x: 10, y: 10, w: 860, h: 660 };

let selectedTab: Tab = 'victory';

interface OpenState {
    close: () => void;
    render: () => void;
    showTab: (t: Tab) => void;
}

let open: OpenState | null = null;

/** Open the panel, or close it if it is already open. */
export function toggleEmpireComparison(opts: EmpireComparisonOptions): void {
    if (open) {
        open.close();
    } else {
        clearGameSummaryOverlay(opts.player.galaxy); // method_400: pnlGameSummary.OverlayTextLines.Clear()
        open = createEmpireComparison(opts);
    }
}

/** Close the panel (no-op when closed). */
export function closeEmpireComparison(): void {
    open?.close();
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

function categoryWords(h: Habitat): string {
    return HabitatCategoryType[h.category].replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

function headerInput(player: Empire): VictoryHeaderInput {
    const galaxy = player.galaxy;
    const gvc = galaxy.globalVictoryConditions;
    return {
        finished: galaxy.gameIsFinished,
        victorName: galaxy.gameVictor?.name ?? null,
        conditions: gvc,
        scenarioConditions: galaxy.playerVictoryConditionsToAchieve != null || galaxy.playerVictoryConditionsToPrevent != null,
        defend: gvc?.defendHabitat && gvc.defendHabitatEmpire
            ? { category: categoryWords(gvc.defendHabitat), name: gvc.defendHabitat.name, empireName: gvc.defendHabitatEmpire.name }
            : null,
        target: gvc?.targetHabitat && gvc.targetHabitatEmpire
            ? { category: categoryWords(gvc.targetHabitat), name: gvc.targetHabitat.name, empireName: gvc.targetHabitatEmpire.name }
            : null,
        starDateText: resolveStarDateDescription,
    };
}

function placeAt<T extends HTMLElement>(e: T, x: number, y: number, w?: number, h?: number): T {
    return place(e, x, y, w, h);
}

function shadowText(parent: HTMLElement, text: string, x: number, y: number, cls: string, color?: string): HTMLDivElement {
    const d = placeAt(el('div', `ec-text ${cls}`, text), x, y);
    if (color) d.style.color = color;
    parent.appendChild(d);
    return d;
}

function flagImg(galaxy: Galaxy, e: Empire, x: number, y: number, w: number, h: number): HTMLImageElement {
    const i = placeAt(el('img', 'ec-flag'), x, y, w, h);
    i.alt = '';
    i.draggable = false;
    applyEmpireEmblem(i, galaxy, e, 'flag');
    return i;
}

function raceImg(galaxy: Galaxy, e: Empire, x: number, y: number, size: number): HTMLImageElement {
    const i = placeAt(el('img', 'ec-race'), x, y, size, size);
    i.alt = '';
    i.draggable = false;
    applyEmpireEmblem(i, galaxy, e, 'portrait');
    return i;
}

/** RaceVictoryConditionsPanel OnPaint: header lines, (our) scenario lists, the bars, and the hover detail. */
function renderVictoryTab(panel: HTMLElement, player: Empire, state: { hovered: Empire | null }): void {
    const galaxy = player.galaxy;
    const content = placeAt(el('div', 'ec-victory'), 0, 0, PANEL.w - 20);
    panel.appendChild(content);
    const header = victoryHeaderLines(headerInput(player));
    const scen = scenarioConditionLines(
        scenarioConditionsText(galaxy.playerVictoryConditionsToAchieve, true),
        scenarioConditionsText(galaxy.playerVictoryConditionsToPrevent, false),
        header.endY,
    );
    for (const l of [...header.lines, ...scen.lines]) shadowText(content, l.text, l.x, l.y, l.bold ? 'ec-bold' : 'ec-normal', l.color);
    const startY = scen.endY;
    const gvc = galaxy.globalVictoryConditions;
    let height = Math.max(PANEL.h, startY);
    if (gvc !== null) {
        let progresses: VictoryConditionProgress[] = [];
        try {
            // filterOutUnmetEmpires = false + the read-only visibility filter (the C# true path adds relations).
            progresses = generateVictoryConditionProgresses(galaxy, gvc, false).filter((p) => isVictoryProgressVisible(player, p.empire));
        } catch (err) {
            console.warn('[15d] victory progress unavailable', err);
        }
        progresses.sort((a, b) => b.compareTo(a));
        const W = PANEL.w - 20; // pnlGameRaceVictoryConditions is 840 wide inside the 860 container.
        const geo = victoryBarGeometry(W, gvc.victoryThresholdPercentage);
        const pitch = VICTORY_ROW_HEIGHT + VICTORY_ROW_SPACING;
        progresses.forEach((p, index) => {
            const y = 5 + startY + index * pitch;
            const row = placeAt(el('div', 'ec-vrow'), 0, y, W, VICTORY_ROW_HEIGHT);
            row.dataset.empire = p.empire.name;
            row.appendChild(flagImg(galaxy, p.empire, 0, 0, geo.flagW, VICTORY_ROW_HEIGHT));
            row.appendChild(raceImg(galaxy, p.empire, geo.raceX, 0, VICTORY_ROW_HEIGHT));
            row.appendChild(placeAt(el('div', 'ec-vbar-back'), geo.barX, 0, geo.barW, VICTORY_ROW_HEIGHT));
            for (const s of victoryBarSegments(p, gvc, geo.barX, geo.barW)) {
                const seg = placeAt(el('div', 'ec-vseg'), s.x, 0, s.w, VICTORY_ROW_HEIGHT);
                const [c0, c1] = VICTORY_SEGMENT_COLORS[s.kind];
                seg.style.background = `linear-gradient(to right, ${c0}, ${c1})`;
                row.appendChild(seg);
            }
            row.appendChild(placeAt(el('div', 'ec-vthreshold'), geo.thresholdX, 0, 1, VICTORY_ROW_HEIGHT));
            // The name is centred on (0, width2): the C# centres it over the bar's width from the panel's left edge.
            const label = placeAt(el('div', 'ec-text ec-bold ec-vlabel', `${index + 1}. ${p.empire.name}`), 0, 0, geo.barW, VICTORY_ROW_HEIGHT);
            row.appendChild(label);
            if (p.empire === galaxy.playerEmpire) {
                // Yellow 2 px rectangle (0, y - 2, Width, 26).
                row.appendChild(placeAt(el('div', 'ec-vplayer'), 0, -2, W, VICTORY_ROW_HEIGHT + 4));
            }
            row.addEventListener('mouseenter', () => {
                state.hovered = p.empire;
                showDetail(p, index);
            });
            row.addEventListener('mouseleave', () => {
                if (state.hovered === p.empire) state.hovered = null;
                detailHost.replaceChildren();
            });
            content.appendChild(row);
            height = Math.max(height, y + pitch);
        });
        const detailHost = placeAt(el('div', 'ec-vdetail-host'), 0, 0, W, 0);
        content.appendChild(detailHost);
        const showDetail = (p: VictoryConditionProgress, index: number): void => {
            detailHost.replaceChildren();
            const m = victoryDetailModel(p, gvc, victoryDetailContext(galaxy, player, p), W);
            const top = victoryDetailTop(index, startY, Math.max(PANEL.h, height), 300);
            const box = placeAt(el('div', 'ec-vdetail'), 0, top, W, m.height);
            const margin = 5;
            const flagH = 30;
            box.appendChild(flagImg(galaxy, p.empire, margin, margin, Math.trunc(flagH / 0.6), flagH));
            box.appendChild(raceImg(galaxy, p.empire, margin + Math.trunc(flagH / 0.6) + margin, margin, flagH));
            shadowText(box, m.title, margin + Math.trunc(flagH / 0.6) + margin + flagH + margin, margin + 6, 'ec-title');
            const th = shadowText(box, m.threshold, 0, margin + 6, 'ec-title ec-right');
            th.style.left = '';
            th.style.right = '0px';
            box.appendChild(placeAt(el('div', 'ec-dotted-h'), 0, margin + flagH + margin, W, 0));
            const colTop = margin + flagH + margin + margin;
            for (const x of m.separators) box.appendChild(placeAt(el('div', 'ec-dotted-v'), x, colTop - margin, 0, m.height - (colTop - margin)));
            for (const c of m.columns) {
                const col = placeAt(el('div', 'ec-vcol'), c.x, colTop, c.width);
                col.dataset.kind = c.kind;
                const head = el('div', 'ec-bold', c.heading);
                head.style.color = c.color;
                col.append(head, el('div', 'ec-bold ec-gap', `${tx('Target', 'Target')}:`), el('div', 'ec-normal ec-indent', c.target), el('div', 'ec-bold ec-gap', c.who), el('div', 'ec-normal ec-indent', c.value));
                box.appendChild(col);
            }
            if (m.race !== null) {
                const r = m.race;
                const col = placeAt(el('div', 'ec-vcol ec-vrace'), r.x, colTop, Math.min(r.width, W - r.x));
                const head = el('div', 'ec-bold', r.heading);
                head.style.color = VICTORY_SEGMENT_COLORS.race[1];
                col.appendChild(head);
                const hdr = el('div', 'ec-vrace-hdr ec-gap');
                hdr.append(el('span', 'ec-bold', tx('Portion', 'Portion')), el('span', 'ec-bold ec-vrace-prog-h', tx('Progress', 'Progress')));
                col.appendChild(hdr);
                for (const row of r.rows) {
                    const line = el('div', 'ec-vrace-row');
                    line.style.gridTemplateColumns = `30px ${r.descriptionWidth}px auto`;
                    line.append(el('span', 'ec-normal', row.portion), el('span', 'ec-normal', row.description), el('span', 'ec-normal', row.progress));
                    col.appendChild(line);
                    if (row.extra !== null) col.appendChild(el('div', 'ec-normal ec-vrace-extra', row.extra));
                }
                box.appendChild(col);
            }
            if (m.bonus !== null) {
                // The C# fills from below the columns' text to the bottom; the 60 px added for it hold the two lines.
                const foot = placeAt(el('div', 'ec-vbonus'), 0, m.height - 60, W, 60);
                foot.append(el('div', 'ec-bold', m.bonus.title), el('div', 'ec-normal ec-vbonus-detail', m.bonus.detail));
                box.appendChild(foot);
            }
            detailHost.appendChild(box);
        };
        if (state.hovered !== null) {
            const i = progresses.findIndex((p) => p.empire === state.hovered);
            if (i >= 0) showDetail(progresses[i], i);
        }
    }
    content.style.height = `${Math.min(1000, height)}px`;
}

/** EmpireComparison.cs DrawEmpireComparison. */
function renderComparisonTab(panel: HTMLElement, player: Empire, kind: ComparisonKind): void {
    const galaxy = player.galaxy;
    const G = COMPARISON_GRAPH;
    shadowText(panel, tx(COMPARISON_TITLE_KEYS[kind], COMPARISON_TITLES[kind]), G.left, G.top, 'ec-title');
    const items = knownEmpires(player).map((e) => {
        let value = 0;
        try {
            value = comparisonValue(galaxy, e, kind);
        } catch {
            value = 0;
        }
        return { item: e, value: Number.isFinite(value) ? value : 0 };
    });
    const { top, rows } = comparisonGraphRows(items, PANEL.h);
    // White axis lines (num2, num1) → (num2 + 800, num1) and down to num1 + num3.
    panel.appendChild(placeAt(el('div', 'ec-axis'), G.barX, G.axisY, G.barW, 1));
    panel.appendChild(placeAt(el('div', 'ec-axis'), G.barX, G.axisY, 1, PANEL.h - (G.top + G.axisY)));
    if (rows.length > 0) {
        const t = shadowText(panel, formatComparisonValue(kind, top), 0, G.axisY - 14, 'ec-bold ec-right');
        t.style.left = '';
        t.style.right = `${PANEL.w - (G.barX + G.barW)}px`;
    }
    for (const r of rows) {
        const e = r.item;
        panel.appendChild(flagImg(galaxy, e, G.left, r.y, 33, 20));
        const back = placeAt(el('div', 'ec-gbar'), G.barX + 1, r.y, G.barW, G.rowH);
        back.dataset.empire = e.name;
        if (r.fillWidth > 0) {
            const fill = placeAt(el('div', e === player ? 'ec-gfill ec-gfill-player' : 'ec-gfill'), 0, 0, r.fillWidth, G.rowH);
            back.appendChild(fill);
        }
        const label = placeAt(el('div', 'ec-text ec-normal ec-glabel', `${r.rank}. ${e.name}`), 0, 3, G.barW, G.rowH - 3);
        back.appendChild(label);
        panel.appendChild(back);
    }
}

/** EmpireComparison.cs 101-118: the GameText keys of the titles. */
const COMPARISON_TITLE_KEYS: Record<ComparisonKind, string> = {
    population: 'Population',
    territory: 'Territory - Colonies',
    economy: 'Economy - Annual GDP',
    strategicValue: 'Strategic Value',
    military: 'Military Strength',
};

/** The small habitat picture (habitatImageCache GetImagesSmall[PictureRef]): colonies are planets, moons or asteroids. */
function colonyImageUrl(h: Habitat): string | null {
    const urls = h.category === HabitatCategoryType.Asteroid ? asteroidUrls(h) : planetUrls(h);
    return urls[0] ?? null;
}

/** TopColonies.cs DrawColonies. */
function renderTopColoniesTab(panel: HTMLElement, player: Empire): void {
    const galaxy = player.galaxy;
    shadowText(panel, tx('Top Colonies', 'Top Colonies'), 10, 10, 'ec-title');
    const cap = topColonyRowCap(PANEL.h);
    const list = topColonies(player).slice(0, cap);
    let y = 10 + 25 + 7;
    list.forEach((h, i) => {
        const rank = i + 1;
        const row = placeAt(el('div', rank % 2 !== 0 ? 'ec-crow ec-crow-odd' : 'ec-crow'), 10, y, 840, 60);
        row.dataset.colony = h.name;
        shadowText(row, String(rank), 20, 22, 'ec-title');
        const url = colonyImageUrl(h);
        if (url !== null) {
            const im = placeAt(el('img', 'ec-cimg'), 62, 2, 55, 55);
            im.src = url;
            im.alt = '';
            im.draggable = false;
            row.appendChild(im);
        }
        const star = galaxy.determineHabitatSystemStar(h);
        shadowText(row, `${h.name}, ${star?.name ?? ''} ${tx('System', 'System').toLowerCase()}`, 136, 4, 'ec-bold');
        if (h.empire !== null) {
            row.appendChild(flagImg(galaxy, h.empire, 136, 20, 30, 18));
            shadowText(row, h.empire.name, 172, 22, 'ec-normal');
        }
        let revenue = 0;
        try {
            revenue = habitatAnnualRevenue(galaxy, h);
        } catch {
            revenue = 0;
        }
        shadowText(row, topColonyStatsLine(h.population.totalAmount, habitatDevelopmentLevel(h), revenue), 136, 40, 'ec-normal');
        panel.appendChild(row);
        y += 60;
    });
}

function createEmpireComparison(opts: EmpireComparisonOptions): OpenState {
    const { player } = opts;
    const galaxy = player.galaxy;
    // vHfFsoqMev.HeaderTitle "Empire Comparison", HeaderIcon pnlEmpireGraphs.HeaderIcon (the empireGraphs chrome image).
    const win = openOriginalWindow({
        id: 'empireComparison',
        title: tx('Empire Comparison', 'Empire Comparison'),
        icon: 'empireGraphs.png',
        width: WINDOW_W,
        height: WINDOW_H,
        onClose: () => {
            clearInterval(timer);
            open = null;
        },
    });
    win.frame.classList.add('empire-comparison-window');
    const tabsHost = place(el('div', 'ec-tabs'), TAB_CONTROL.x, TAB_CONTROL.y, TAB_CONTROL.w, TAB_CONTROL.h);
    win.body.appendChild(tabsHost);
    const page = place(el('div', 'ec-page'), 0, 26, TAB_CONTROL.w, TAB_CONTROL.h - 26);
    tabsHost.appendChild(page);
    const panel = place(el('div', 'ec-panel'), PANEL.x, PANEL.y, PANEL.w, PANEL.h);
    page.appendChild(panel);
    let strip: HTMLDivElement | null = null;
    const victoryState = { hovered: null as Empire | null };
    let summary: GameSummaryView | null = null;

    const renderStrip = (): void => {
        const s = tabStrip(TABS.map((t) => ({ id: t.id, label: tx(t.key, t.key) })), selectedTab, (id) => showTab(id as Tab));
        place(s, 0, 0, TAB_CONTROL.w);
        if (strip) strip.replaceWith(s);
        else tabsHost.prepend(s);
        strip = s;
    };

    // Every query is read-only: outside sim code the UI galaxy answers the lazy lookups without writing
    // (sim/readOnlyQuery.ts markUiGalaxy; the replica under ?simWorker=1).
    function render(): void {
        const scroll = panel.scrollTop;
        if (selectedTab === 'achievements') {
            if (summary === null) {
                panel.replaceChildren();
                summary = createGameSummaryPanel(panel, galaxy, PANEL.w, PANEL.h);
            } else summary.render();
            return;
        }
        summary = null;
        panel.replaceChildren();
        panel.classList.toggle('ec-panel-scroll', selectedTab === 'victory');
        try {
            if (selectedTab === 'victory') renderVictoryTab(panel, player, victoryState);
            else if (selectedTab === 'topColonies') renderTopColoniesTab(panel, player);
            else renderComparisonTab(panel, player, selectedTab);
        } catch (err) {
            console.warn('[15d] empire comparison tab failed', err);
        }
        panel.scrollTop = scroll;
    }

    function showTab(t: Tab): void {
        selectedTab = t;
        summary = null;
        panel.scrollTop = 0;
        renderStrip();
        render();
    }

    if (loadedText === null) {
        void loadGameText().then((t) => {
            if (t !== null && loadedText === null) {
                loadedText = t;
                if (!win.closed) {
                    renderStrip();
                    render();
                }
            }
        });
    }
    renderStrip();
    render();

    // generateVictoryConditionProgresses is not cheap: refresh every 5 s only.
    const timer = setInterval(render, 5000);

    return { close: () => win.close(), render, showTab };
}
