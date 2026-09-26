// Empire Comparisons and Victory Conditions panel (task 15d), opened by V,
// plus the game-end banner.
//
// Ports:
// - DistantWorlds.Controls/Controls/GameVictoryConditions.cs 90-230, 331-348
//   (the Victory Conditions text) -> globalConditionLines.
// - EmpireComparison.cs 98-141 (titles / value formats) + Galaxy.5.cs 3331
//   DetermineOrderedKnownEmpires -> knownEmpires / rankDescending /
//   formatComparisonValue.
// - Main.Part12.cs 3423 DoGameEnd and Main.Part6.cs 3998 method_436 (the
//   game-end screen) -> installGameEndHandler / gameEndBannerLines /
//   canContinueAfterGameEnd.
//
// Streamlined: one DOM panel with three tabs (Victory, Comparison,
// Achievements) instead of the original's multi-panel window.
//
// TODO(port): scenario PlayerVictoryConditionsToAchieve/ToPrevent lists, race-condition detail panel (RaceVictoryConditionsPanel.cs), comparison bar graphs + history charts, Shakturi story message (Code 1), pirate-player comparison (pirate relations)

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
    calculateEmpireScore,
    determineAchievementLevel,
    determineAchievementValueForLevel,
    resolveAchievementLevelDescription,
    reviewAchievements,
} from '../../sim/achievements';
import type { Achievement, EmpireScore } from '../../sim/achievements';
import { privateAnnualRevenue, totalColonyStrategicValue } from '../../sim/forceStructure';
import { musicGameEnded } from '../../audio/musicPlayer'; // [audio]
import { militaryPotency } from '../../sim/diplomacyTick';
import { DiplomaticRelationType } from '../../sim/diplomacy';
import { resolveStarDateDescription } from '../../sim/galaxyTime';
import { parseGameText } from '../../sim/data/gameText';
import type { GameText } from '../../sim/data/gameText';
import { countLabel } from '../plural';

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
        // [audio] begin — Main.Part12.cs:3428 DoGameEnd → musicPlayer_0.StartTheme().
        if (typeof document !== 'undefined') musicGameEnded();
        // [audio] end
        if (typeof document !== 'undefined') showGameEndBanner(galaxy, time, e);
    });
}

export function removeGameEndHandler(galaxy: Galaxy): void {
    setGameEndHandler(galaxy, null);
}

let banner: HTMLElement | null = null;

function showGameEndBanner(galaxy: Galaxy, time: { paused: boolean }, e: GameEndEventArgs): void {
    closeGameEndBanner();
    const root = document.createElement('div');
    root.className = 'empire-comparison-banner';
    const panel = document.createElement('div');
    panel.className = 'empire-comparison-banner-panel';
    gameEndBannerLines(e).forEach((line, i, all) => {
        const div = document.createElement('div');
        const isHeadline = i === 0 && all.length === 3;
        div.className = isHeadline ? 'empire-comparison-banner-headline' : 'empire-comparison-banner-line';
        div.textContent = line;
        panel.appendChild(div);
    });
    const buttons = document.createElement('div');
    buttons.className = 'empire-comparison-banner-buttons';
    const cont = document.createElement('button');
    cont.type = 'button';
    cont.className = 'empire-comparison-button';
    cont.textContent = 'Continue';
    cont.disabled = !canContinueAfterGameEnd(e, galaxy.playerEmpire);
    cont.addEventListener('click', () => {
        closeGameEndBanner();
        time.paused = false; // method_155
    });
    const vc = document.createElement('button');
    vc.type = 'button';
    vc.className = 'empire-comparison-button';
    vc.textContent = 'Victory Conditions';
    vc.addEventListener('click', () => {
        const player = galaxy.playerEmpire;
        if (!player) return;
        selectedTab = 'victory';
        if (open) open.render();
        else toggleEmpireComparison({ player });
    });
    buttons.append(cont, vc);
    panel.appendChild(buttons);
    root.appendChild(panel);
    document.body.appendChild(root);
    banner = root;
}

export function closeGameEndBanner(): void {
    banner?.remove();
    banner = null;
}

// ---------------------------------------------------------------------------
// Panel DOM
// ---------------------------------------------------------------------------

export interface EmpireComparisonOptions {
    player: Empire;
}

type Tab = 'victory' | 'comparison' | 'achievements';
const TABS: readonly [Tab, string][] = [['victory', 'Victory'], ['comparison', 'Comparison'], ['achievements', 'Achievements']];

let selectedTab: Tab = 'victory';

interface OpenState {
    root: HTMLElement;
    close: () => void;
    render: () => void;
}

let open: OpenState | null = null;

/** Open the panel, or close it if it is already open. */
export function toggleEmpireComparison(opts: EmpireComparisonOptions): void {
    if (open) {
        open.close();
    } else {
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

function conditionInput(player: Empire): ConditionInput {
    const galaxy = player.galaxy;
    const gvc = galaxy.globalVictoryConditions;
    const safe = (f: () => number): number => {
        try {
            const v = f();
            return Number.isFinite(v) ? v : 0;
        } catch {
            return 0;
        }
    };
    return {
        conditions: gvc,
        finished: galaxy.gameIsFinished,
        victorName: galaxy.gameVictor?.name ?? null,
        raceSpecificEnabled: galaxy.gameRaceSpecificVictoryConditionsEnabled,
        scenarioConditions: galaxy.playerVictoryConditionsToAchieve != null || galaxy.playerVictoryConditionsToPrevent != null,
        empires: galaxy.empires.map((e) => ({
            name: e.name,
            playable: e.dominantRace?.playable ?? false,
            known: isKnownEmpire(player, e),
            isPlayer: e === player,
            revenue: safe(() => privateAnnualRevenue(galaxy, e)),
            population: e.totalPopulation,
            colonies: e.colonies.length,
        })),
        defend: gvc?.defendHabitat && gvc.defendHabitatEmpire
            ? { category: categoryWords(gvc.defendHabitat), name: gvc.defendHabitat.name, empireName: gvc.defendHabitatEmpire.name }
            : null,
        target: gvc?.targetHabitat && gvc.targetHabitatEmpire
            ? { category: categoryWords(gvc.targetHabitat), name: gvc.targetHabitat.name, empireName: gvc.targetHabitatEmpire.name }
            : null,
        starDateText: resolveStarDateDescription,
    };
}

function tableRow(cells: string[], cls: string, template: string): HTMLElement {
    const row = el('div', cls);
    row.style.gridTemplateColumns = template;
    cells.forEach((c, i) => row.appendChild(el('span', i === 0 ? 'empire-comparison-cell' : 'empire-comparison-cell empire-comparison-number', c)));
    return row;
}

function renderVictoryTab(body: HTMLElement, player: Empire): void {
    const galaxy = player.galaxy;
    const lines = el('div', 'empire-comparison-lines');
    for (const l of globalConditionLines(conditionInput(player))) {
        lines.appendChild(el('div', l.emphasis ? 'empire-comparison-line empire-comparison-emphasis' : 'empire-comparison-line', l.text));
    }
    body.appendChild(lines);
    const gvc = galaxy.globalVictoryConditions;
    if (gvc === null) return;
    body.appendChild(el('div', 'empire-comparison-subtle', `Victory threshold: ${percent0(gvc.victoryThresholdPercentage)}`));
    // filterOutUnmetEmpires = false: the true path calls obtainDiplomaticRelation, which adds relations. The
    // race-condition part still calls obtainDiplomaticRelation for a few condition types, exactly as the sim's own
    // victory check does.
    let rows: VictoryProgressRow[] = [];
    try {
        rows = victoryProgressRows(generateVictoryConditionProgresses(galaxy, gvc, false), player, (e) => isKnownEmpire(player, e));
    } catch (err) {
        console.warn('[15d] victory progress unavailable', err);
    }
    const template = 'minmax(0, 1fr) 4em 5em 5em 6em 4em 4em';
    body.appendChild(tableRow(['Empire', 'Total', 'Territory', 'Economy', 'Population', 'Race', 'Bonus'], 'empire-comparison-header', template));
    const part = (v: number | null): string => (v === null ? '—' : percent0(v));
    for (const r of rows) {
        const row = tableRow([r.name, percent0(r.total), part(r.territory), part(r.economy), part(r.population), part(r.race), percent0(r.bonus)], 'empire-comparison-row', template);
        if (r.isPlayer) row.classList.add('empire-comparison-player');
        body.appendChild(row);
    }
}

function renderComparisonTab(body: HTMLElement, player: Empire): void {
    const galaxy = player.galaxy;
    const known = knownEmpires(player);

    body.appendChild(el('div', 'empire-comparison-section', 'Score'));
    const template = 'minmax(0, 1fr) 4.5em 4em 4em 4em 4em 4em 4em';
    body.appendChild(tableRow(['Empire', 'Score', 'Pop', 'Econ', 'Colonies', 'Military', 'Research', 'Wonders'], 'empire-comparison-header', template));
    const scores: { item: { e: Empire; s: EmpireScore }; value: number }[] = [];
    for (const e of known) {
        try {
            const s = calculateEmpireScore(galaxy, e);
            scores.push({ item: { e, s }, value: s.score });
        } catch (err) {
            console.warn('[15d] score unavailable', err);
        }
    }
    const r0 = (v: number): string => String(Math.round(v));
    for (const r of rankDescending(scores)) {
        const { e, s } = r.item;
        const row = tableRow([`${r.rank}. ${e.name}`, r0(s.score), r0(s.population), r0(s.economy), r0(s.colonies), r0(s.military), r0(s.research), r0(s.wonders)], 'empire-comparison-row', template);
        if (e === player) row.classList.add('empire-comparison-player');
        body.appendChild(row);
    }

    for (const kind of COMPARISON_KINDS) {
        body.appendChild(el('div', 'empire-comparison-section', COMPARISON_TITLES[kind]));
        const items = known.map((e) => {
            let value = 0;
            try {
                value = comparisonValue(galaxy, e, kind);
            } catch {
                value = 0;
            }
            return { item: e, value: Number.isFinite(value) ? value : 0 };
        });
        const ranked = rankDescending(items);
        const top = ranked.length > 0 ? ranked[0].value : 0;
        for (const r of ranked) {
            const row = el('div', 'empire-comparison-bar-row');
            if (r.item === player) row.classList.add('empire-comparison-player');
            row.appendChild(el('span', 'empire-comparison-cell', `${r.rank}. ${r.item.name}`));
            const track = el('div', 'empire-comparison-bar-track');
            const bar = el('div', 'empire-comparison-bar');
            bar.style.width = `${top > 0 ? Math.max(0, Math.min(1, r.value / top)) * 100 : 0}%`;
            track.appendChild(bar);
            row.appendChild(track);
            row.appendChild(el('span', 'empire-comparison-cell empire-comparison-number', formatComparisonValue(kind, r.value)));
            body.appendChild(row);
        }
    }
}

let loadedText: GameText | null = null;

function renderAchievementsTab(body: HTMLElement, player: Empire, rerender: () => void): void {
    if (loadedText === null) {
        void loadGameText().then((t) => {
            if (t !== null && loadedText === null) {
                loadedText = t;
                rerender();
            }
        });
    }
    const rows = achievementRows(player.achievements ?? [], loadedText);
    if (rows.length === 0) {
        body.appendChild(el('div', 'empire-comparison-subtle', 'No achievements yet'));
        return;
    }
    for (const r of rows) {
        const row = el('div', 'empire-comparison-achievement');
        const head = el('div', 'empire-comparison-achievement-title', r.title);
        if (r.level !== '') head.appendChild(el('span', 'empire-comparison-level-tag', r.level));
        row.appendChild(head);
        row.appendChild(el('div', 'empire-comparison-achievement-desc', r.description));
        body.appendChild(row);
    }
}

function createEmpireComparison(opts: EmpireComparisonOptions): OpenState {
    const { player } = opts;
    const root = el('div', 'empire-comparison-wrap');
    const win = el('div', 'empire-comparison-window');

    const titlebar = el('div', 'empire-comparison-titlebar');
    titlebar.appendChild(el('div', 'empire-comparison-heading', 'Empire Comparisons and Victory Conditions'));
    const closeBtn = el('button', 'empire-comparison-close', '✕');
    closeBtn.type = 'button';
    closeBtn.title = 'Close';
    titlebar.appendChild(closeBtn);
    win.appendChild(titlebar);

    const gameOver = el('div', 'empire-comparison-gameover');
    win.appendChild(gameOver);

    const tabs = el('div', 'empire-comparison-tabs');
    const tabButtons = new Map<Tab, HTMLButtonElement>();
    for (const [tab, label] of TABS) {
        const b = el('button', 'empire-comparison-tab', label);
        b.type = 'button';
        b.addEventListener('click', () => {
            selectedTab = tab;
            render();
        });
        tabButtons.set(tab, b);
        tabs.appendChild(b);
    }
    win.appendChild(tabs);

    const body = el('div', 'empire-comparison-body');
    win.appendChild(body);
    root.appendChild(win);
    document.body.appendChild(root);

    function render(): void {
        const galaxy = player.galaxy;
        if (galaxy.gameIsFinished) {
            gameOver.textContent = `GAME OVER — Winner: ${galaxy.gameVictor?.name ?? '—'}`;
            gameOver.style.display = '';
        } else {
            gameOver.style.display = 'none';
        }
        for (const [tab, b] of tabButtons) b.classList.toggle('empire-comparison-tab-active', tab === selectedTab);
        const scroll = body.scrollTop;
        body.replaceChildren();
        if (selectedTab === 'victory') renderVictoryTab(body, player);
        else if (selectedTab === 'comparison') renderComparisonTab(body, player);
        else renderAchievementsTab(body, player, render);
        body.scrollTop = scroll;
    }
    render();

    // generateVictoryConditionProgresses is not cheap: refresh every 5 s only.
    const timer = setInterval(render, 5000);

    function close(): void {
        clearInterval(timer);
        document.removeEventListener('keydown', onKeyDown);
        root.remove();
        open = null;
    }

    // Escape closes the panel; stopImmediatePropagation keeps the global game-menu (and other open panels)
    // Escape handler (registered in createHud) from opening as well.
    function onKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            close();
        }
    }
    document.addEventListener('keydown', onKeyDown);
    closeBtn.addEventListener('click', () => close());

    return { root, close, render };
}
