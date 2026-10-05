// The Empire Comparison window's "Achievements" tab: a port of DistantWorlds.Controls/Controls/GameSummaryPanel.cs
// (pnlGameSummary, bound by Main.Part6.cs method_400: 860 × 660 at (10, 10) of tabAchievements) plus the persisted
// GameSummaryList (Main.cs gameSummaryList_0: Main.Part9.cs 2450 method_255 save / 2470 method_256 load, Main.Part6.cs
// 3998 method_436 adds the finished game's GameSummary and merges its achievements).
//
// Layout (GameSummaryPanel.CalculateDrawAreas, panel pixels): faction detail (10, 10) 240 × 170; the selected
// faction's medals (260, 10) 590 × 170; "Empires in this Game" (10, 190) 840 × 130; the player's achievements across
// games (10, 330) 840 × 80; "Completed Games" (10, 420) 840 × 230. The C# paints everything on one buffered control
// and hit-tests the mouse (DetectHoveredElement); here every element is a DOM node at the same pixels and the hover
// tooltips (DrawTooltips) are DOM boxes at DrawTooltips's rectangles.
//
// Render/UI only. GameSummaryPanel.BindData calls Galaxy.ReviewAchievements() first; that writes the sim (every
// empire's Achievements and Score), so it is skipped here: the sim refreshes both yearly (galaxyTick.ts) and at the
// game end (DoGameEnd / the worker's handler), and this panel reads them as they are. The C# file is a .NET
// BinaryFormatter blob in the game folder; ours is JSON in localStorage (DWU_GAME_SUMMARIES_KEY).

import './gameSummary.css';
import type { Galaxy } from '../../sim/galaxy';
import type { Empire } from '../../sim/empire';
import { empireGovernmentAttributes } from '../../sim/empire';
import {
    Achievement,
    AchievementType,
    achievementListAddIfNotExistsOrBetter,
    calculateEmpireScore,
    determineAchievementLevel,
    determineGameSummary,
    resolveAchievementDescription,
    resolveAchievementMedalImageIndex,
    resolveAchievementTitleComplete,
    type GameSummary,
} from '../../sim/achievements';
import type { Race } from '../../sim/data/races';
import { DiplomaticRelationType } from '../../sim/diplomacy';
import { PirateRelationType } from '../../sim/pirateRelations';
import { identifyMechanoidEmpire } from '../../sim/fleets/militaryAI';
import { identifyShakturiEmpire } from '../../sim/diplomacyTick';
import { formatNet, tryGetText } from '../../sim/textResolver';
import { difficultyTickFor } from '../../sim/startGameOptions';
import { applyEmpireEmblem, racePortraitUrl } from '../empireEmblem';

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers (tested)
// ---------------------------------------------------------------------------------------------------------------

/** GameText value of `key` (the loaded TextResolver table), else the English GameText.txt value given. */
function tx(key: string, fallback: string): string {
    return tryGetText(key) ?? fallback;
}

/**
 * Main.Part12.cs LoadUiAchievements: images/ui/achievements/<file> per ResolveAchievementMedalImageIndex index. The C#
 * asks for "<name>.png" on a case-insensitive Windows file system; these are the on-disk names (several are .PNG),
 * which a case-sensitive server needs.
 */
export const MEDAL_FILES: readonly string[] = [
    'AchieveAllRaceVictoryConditions.png',
    'DestroyEnemyMilitaryShips_1.PNG',
    'DestroyEnemyMilitaryShips_2.PNG',
    'DestroyEnemyMilitaryShips_3.PNG',
    'DestroyEnemyCivilianShips_1.PNG',
    'DestroyEnemyCivilianShips_2.PNG',
    'DestroyEnemyCivilianShips_3.png',
    'DestroyEnemyTroops_1.png',
    'DestroyEnemyTroops_2.png',
    'DestroyEnemyTroops_3.png',
    'DestroySpaceMonsters_1.png',
    'DestroySpaceMonsters_2.png',
    'DestroySpaceMonsters_3.png',
    'DestroySilverMists_1.PNG',
    'DestroySilverMists_2.PNG',
    'DestroySilverMists_3.PNG',
    'ConquerEnemyColonies_1.png',
    'ConquerEnemyColonies_2.png',
    'ConquerEnemyColonies_3.png',
    'StartWars.png',
    'BreakTreaties.png',
    'EliminateEnemyCharacters_1.png',
    'EliminateEnemyCharacters_2.png',
    'EliminateEnemyCharacters_3.png',
    'EliminateEnemyEmpires_1.png',
    'EliminateEnemyEmpires_2.PNG',
    'EliminateEnemyEmpires_3.png',
    'TradeIncome.png',
    'MineResources.png',
    'CaptureEnemyShips_1.png',
    'CaptureEnemyShips_2.png',
    'CaptureEnemyShips_3.png',
    'EliminatePirateFactions_1.png',
    'EliminatePirateFactions_2.png',
    'EliminatePirateFactions_3.png',
    'TimeAtWar.png',
    'TimeAtPeace.png',
    'SuccessfulRaids_1.png',
    'SuccessfulRaids_2.png',
    'SuccessfulRaids_3.png',
    'GovernmentWayOfDarkness.png',
    'GovernmentWayOfAncients.png',
    'EmpireSplits.png',
    'BuildWonders_1.png',
    'BuildWonders_2.png',
    'BuildWonders_3.png',
    'OwnAnOperationalPlanetDestroyer.png',
    'JoinTheFreedomAlliance.png',
    'JoinTheShakturi.png',
    'DefeatAncients.png',
    'DefeatShakturi.png',
    'DefeatLegendaryPirates.png',
    'SuccessfulIntelligenceMissions_1.png',
    'SuccessfulIntelligenceMissions_2.png',
    'SuccessfulIntelligenceMissions_3.png',
];

const ACHIEVEMENTS_DIR = '/assets/dwu/images/ui/achievements/';

/** GameSummaryPanel.ObtainMedalImage: DetermineAchievementLevel → ResolveAchievementMedalImageIndex → the file. */
export function medalImageUrl(type: AchievementType, value: number): string {
    const index = resolveAchievementMedalImageIndex(type, determineAchievementLevel(type, value));
    return ACHIEVEMENTS_DIR + (MEDAL_FILES[index] ?? MEDAL_FILES[0]);
}

/** LoadUiAchievements: galaxy.png (bitmap_216[0], the panel background) and the scroll arrows (bitmap_220-223). */
export const SUMMARY_IMAGES = {
    galaxy: ACHIEVEMENTS_DIR + 'galaxy.png',
    left: ACHIEVEMENTS_DIR + 'left.png',
    right: ACHIEVEMENTS_DIR + 'right.png',
    up: ACHIEVEMENTS_DIR + 'up.png',
    down: ACHIEVEMENTS_DIR + 'down.png',
} as const;

/** ObtainMedalImage: the AchieveAllRaceVictoryConditions medal carries the race image in this fraction of it. */
export const RACE_MEDAL_OVERLAY = { x: 0.375, y: 0.66, w: 0.25, h: 0.25 } as const;

/** An Achievement as persisted (AdditionalData: the Race, kept by name and picture). */
export interface StoredAchievement {
    type: AchievementType;
    value: number;
    raceName: string | null;
    racePictureIndex: number | null;
}

/** GameSummary.cs as persisted (PlayerRace kept by name and picture). */
export interface StoredGameSummary {
    galaxyStarCount: number;
    difficultyLevel: number;
    playerRaceName: string;
    playerRacePictureIndex: number;
    playerGovernmentName: string;
    playerEmpireName: string;
    playerMainColor: number;
    playerScore: number;
    playerVictory: boolean;
    playerAchievements: StoredAchievement[];
}

/** GameSummaryList.cs: List<GameSummary> + PlayerAchievements. */
export interface GameSummaryList {
    summaries: StoredGameSummary[];
    playerAchievements: StoredAchievement[];
}

export function emptyGameSummaryList(): GameSummaryList {
    return { summaries: [], playerAchievements: [] };
}

export function toStoredAchievement(a: Achievement): StoredAchievement {
    const race: Race | null = a.additionalData;
    return { type: a.type, value: a.value, raceName: race?.name ?? null, racePictureIndex: race?.pictureIndex ?? null };
}

export function toStoredGameSummary(s: GameSummary): StoredGameSummary {
    return {
        galaxyStarCount: s.galaxyStarCount,
        difficultyLevel: s.difficultyLevel,
        playerRaceName: s.playerRace?.name ?? '',
        playerRacePictureIndex: s.playerRace?.pictureIndex ?? -1,
        playerGovernmentName: s.playerGovernmentName,
        playerEmpireName: s.playerEmpireName,
        playerMainColor: s.playerMainColor,
        playerScore: s.playerScore,
        playerVictory: s.playerVictory,
        playerAchievements: s.playerAchievements.filter((a) => a != null).map(toStoredAchievement),
    };
}

/** AchievementList.AddIfNotExistsOrBetter for the stored form (same rule: skip when one of the type is >= in value). */
export function storedAchievementsAddIfNotExistsOrBetter(list: StoredAchievement[], a: StoredAchievement): void {
    // The C# rule on Achievements, run on a parallel list of Achievement shells so the port stays the sim's one.
    const shells = list.map((x) => new Achievement(x.type, x.value, null));
    const before = shells.length;
    achievementListAddIfNotExistsOrBetter(shells, new Achievement(a.type, a.value, null));
    if (shells.length > before) list.push(a);
}

/** Main.Part6.cs 4007-4011 (method_436): gameSummaryList_0.Add(summary) and merge its achievements. */
export function addGameSummary(list: GameSummaryList, summary: StoredGameSummary): void {
    list.summaries.push(summary);
    for (const a of summary.playerAchievements) storedAchievementsAddIfNotExistsOrBetter(list.playerAchievements, a);
}

/** GameSummaryPanel.BindData: gameSummaries.Sort() (GameSummary.CompareTo = PlayerScore) then Reverse(). The C#
 *  List.Sort is unstable for ties; this is a stable ascending sort, reversed (ties come out in reverse order). */
export function sortGameSummariesForDisplay(list: readonly StoredGameSummary[]): StoredGameSummary[] {
    return [...list].sort((a, b) => a.playerScore - b.playerScore).reverse();
}

export const DWU_GAME_SUMMARIES_KEY = 'dwu.gameSummaries';

interface StorageLike {
    getItem(k: string): string | null;
    setItem(k: string, v: string): void;
}

function defaultStorage(): StorageLike | null {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
        return null;
    }
}

/** Main.Part9.cs method_256: read the list; anything unreadable gives an empty one. */
export function loadGameSummaryList(storage: StorageLike | null = defaultStorage()): GameSummaryList {
    try {
        const raw = storage?.getItem(DWU_GAME_SUMMARIES_KEY);
        if (!raw) return emptyGameSummaryList();
        const v = JSON.parse(raw) as Partial<GameSummaryList>;
        if (!Array.isArray(v.summaries) || !Array.isArray(v.playerAchievements)) return emptyGameSummaryList();
        return { summaries: v.summaries, playerAchievements: v.playerAchievements };
    } catch {
        return emptyGameSummaryList();
    }
}

/** Main.Part9.cs method_255: write the list (errors ignored, as the C#). */
export function saveGameSummaryList(list: GameSummaryList, storage: StorageLike | null = defaultStorage()): void {
    try {
        storage?.setItem(DWU_GAME_SUMMARIES_KEY, JSON.stringify(list));
    } catch {
        /* storage unavailable */
    }
}

/** Empire.7.cs 4478 GetEmpiresWeHaveMetOfMatchingType: self, then met active pirate factions (pirate) or met active
 *  empires (normal), deduped. Read-only. */
export function empiresWeHaveMetOfMatchingType(self: Empire): Empire[] {
    const list: Empire[] = [self];
    if (self.pirateEmpireBaseHabitat !== null) {
        if (self.pirateRelations != null) {
            for (const r of self.pirateRelations) {
                if (r.type !== PirateRelationType.NotMet && r.otherEmpire != null && r.otherEmpire.active && !list.includes(r.otherEmpire)) list.push(r.otherEmpire);
            }
        }
    } else if (self.diplomaticRelations != null) {
        for (const r of self.diplomaticRelations) {
            if (r.type !== DiplomaticRelationType.NotMet && r.otherEmpire != null && r.otherEmpire.active && !list.includes(r.otherEmpire)) list.push(r.otherEmpire);
        }
    }
    return list;
}

/** GameSummaryPanel.ResolveValidEmpires: every empire (a pirate player: every pirate faction) once the game is
 *  finished, else the met empires of the player's kind; never the Mechanoids or the Shakturi. */
export function resolveValidEmpires(galaxy: Galaxy): Empire[] {
    const player = galaxy.playerEmpire;
    if (player === null) return [];
    const mech = identifyMechanoidEmpire(galaxy);
    const shak = identifyShakturiEmpire(galaxy);
    let list: Empire[];
    if (galaxy.gameIsFinished) {
        list = player.pirateEmpireBaseHabitat !== null ? [...galaxy.pirateEmpires] : [...galaxy.empires];
    } else {
        list = empiresWeHaveMetOfMatchingType(player);
    }
    return list.filter((e) => e !== mech && e !== shak);
}

/** Galaxy.7.cs 4240 ResolveDifficultyDescription. */
export function resolveDifficultyDescription(difficultyLevel: number): string {
    if (difficultyLevel <= 0.7) return tx('Easy', 'Easy');
    if (difficultyLevel <= 1.0) return tx('Normal', 'Normal');
    if (difficultyLevel <= 1.25) return tx('Hard', 'Hard');
    if (difficultyLevel <= 1.6) return tx('Very Hard', 'Very Hard');
    return tx('Extreme', 'Extreme');
}

/** The difficulty as shown: ResolveDifficultyDescription for a slider tick value; a custom difficulty (the wizard's
 *  difficulty box, not a port) as "Custom (1.40)". */
export function difficultyDisplayText(difficultyLevel: number): string {
    return difficultyTickFor(difficultyLevel) >= 0 ? resolveDifficultyDescription(difficultyLevel) : `Custom (${difficultyLevel.toFixed(2)})`;
}

/** .NET ToString("###,###,##0"). */
export function groupedInt(v: number): string {
    const n = Math.round(Number.isFinite(v) ? v : 0);
    return (n < 0 ? '-' : '') + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ---------------------------------------------------------------------------------------------------------------
// Game end (method_436) + module state
// ---------------------------------------------------------------------------------------------------------------

interface SummaryState {
    list: GameSummaryList;
    /** Galaxy.GameSummary of the finished game (the row highlighted in Completed Games). */
    current: StoredGameSummary | null;
    selected: Empire | null;
    overlay: string[];
}

const states = new WeakMap<Galaxy, SummaryState>();

function stateOf(galaxy: Galaxy): SummaryState {
    let s = states.get(galaxy);
    if (s === undefined) {
        s = { list: loadGameSummaryList(), current: null, selected: null, overlay: [] };
        states.set(galaxy, s);
    }
    return s;
}

/** method_400: pnlGameSummary.OverlayTextLines.Clear() on every open of the window. */
export function clearGameSummaryOverlay(galaxy: Galaxy): void {
    stateOf(galaxy).overlay = [];
}

/**
 * Main.Part6.cs method_436 (the summary part): DetermineGameSummary (read-only), PlayerVictory, add it to the list and
 * merge the achievements, persist (method_255), the yellow overlay lines (VICTORY!/DEFEAT!, " ", description) and
 * select the victor. ReviewAchievements (its first line) already ran on the authoritative galaxy (DoGameEnd caller).
 */
export function recordGameEndSummary(galaxy: Galaxy, victory: boolean, outcomeWord: 'Victory' | 'Defeat' | null, description: string, victor: Empire | null): void {
    const st = stateOf(galaxy);
    let summary: StoredGameSummary;
    try {
        const s = determineGameSummary(galaxy);
        if (victory) s.playerVictory = true;
        summary = toStoredGameSummary(s);
    } catch (err) {
        console.warn('[gameSummary] summary unavailable', err);
        return;
    }
    st.list = loadGameSummaryList();
    addGameSummary(st.list, summary);
    saveGameSummaryList(st.list);
    st.current = summary;
    const lines: string[] = [];
    if (outcomeWord !== null) lines.push(tx(outcomeWord, outcomeWord).toUpperCase() + '!');
    lines.push(' ');
    lines.push(description);
    st.overlay = lines;
    if (victor !== null) st.selected = victor;
}

// ---------------------------------------------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------------------------------------------

const GAP = 10;
const MARGIN = 5;
const ARROW = 13;
const MEDAL_LARGE = 140;
const MEDAL_SMALL = 70;
const MEDAL_VERY_SMALL = 20;
const RACE = 80;

/** CalculateDrawAreas for a `w` × `h` panel. */
export function gameSummaryAreas(w: number, h: number): Record<'detail' | 'medals' | 'factions' | 'collection' | 'games', { x: number; y: number; w: number; h: number }> {
    const detail = { x: GAP, y: GAP, w: 240, h: 170 };
    const medals = { x: GAP + detail.w + GAP, y: GAP, w: w - (GAP + detail.w + GAP + GAP), h: detail.h };
    const factions = { x: GAP, y: detail.y + detail.h + GAP, w: w - 2 * GAP, h: RACE + GAP + GAP + MARGIN + MEDAL_VERY_SMALL + MARGIN };
    const collection = { x: GAP, y: factions.y + factions.h + GAP, w: w - 2 * GAP, h: MEDAL_SMALL + 2 * MARGIN };
    const gamesY = collection.y + collection.h + GAP;
    const games = { x: GAP, y: gamesY, w: w - 2 * GAP, h: h - (collection.y + collection.h + GAP + GAP) };
    return { detail, medals, factions, collection, games };
}

function div(cls: string, text?: string): HTMLDivElement {
    const d = document.createElement('div');
    d.className = cls;
    if (text !== undefined) d.textContent = text;
    return d;
}

function at<T extends HTMLElement>(e: T, x: number, y: number, w?: number, h?: number): T {
    e.style.position = 'absolute';
    e.style.left = `${x}px`;
    e.style.top = `${y}px`;
    if (w !== undefined) e.style.width = `${w}px`;
    if (h !== undefined) e.style.height = `${h}px`;
    return e;
}

function img(src: string, cls = 'gs-img'): HTMLImageElement {
    const i = document.createElement('img');
    i.className = cls;
    i.src = src;
    i.alt = '';
    i.draggable = false;
    return i;
}

/** ObtainMedalImage as a DOM node of `size` px (with the race overlay for AchieveAllRaceVictoryConditions). */
function medal(type: AchievementType, value: number, racePictureIndex: number | null, size: number): HTMLDivElement {
    const box = div('gs-medal');
    box.style.width = `${size}px`;
    box.style.height = `${size}px`;
    const m = img(medalImageUrl(type, value));
    m.style.width = `${size}px`;
    m.style.height = `${size}px`;
    box.appendChild(m);
    if (type === AchievementType.AchieveAllRaceVictoryConditions && racePictureIndex !== null) {
        const r = img(racePortraitUrl(racePictureIndex));
        at(r, RACE_MEDAL_OVERLAY.x * size, RACE_MEDAL_OVERLAY.y * size, RACE_MEDAL_OVERLAY.w * size, RACE_MEDAL_OVERLAY.h * size);
        box.appendChild(r);
    }
    return box;
}

/** The "Empire Achievements" / … watermark text centred in an area (24-alpha white, huge font). */
function watermark(area: HTMLElement, text: string, h: number): void {
    const t = div('gs-watermark', text);
    at(t, 0, h / 2 - 20, undefined, 40);
    t.style.width = '100%';
    area.appendChild(t);
}

/** A scroll arrow strip (DetectHoveredElement's 13 px edges); held down it repeats every 100 ms (the _Timer). */
function scrollArrow(area: HTMLElement, src: string, rect: { x: number; y: number; w: number; h: number }, step: () => void): void {
    const strip = at(div('gs-arrow'), rect.x, rect.y, rect.w, rect.h);
    const a = img(src, 'gs-arrow-img');
    strip.appendChild(a);
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = (): void => {
        if (timer !== null) clearInterval(timer);
        timer = null;
    };
    strip.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        step();
        stop();
        timer = setInterval(step, 100);
    });
    strip.addEventListener('pointerup', stop);
    strip.addEventListener('pointerleave', stop);
    area.appendChild(strip);
}

export interface GameSummaryView {
    /** Rebuild from the current sim state (the C# repaints every 100 ms; the window refresh calls this). */
    render(): void;
}

/** GameSummaryPanel.DrawPanel into `host` (860 × 660). */
export function createGameSummaryPanel(host: HTMLElement, galaxy: Galaxy, w = 860, h = 660): GameSummaryView {
    const st = stateOf(galaxy);
    if (st.selected === null) st.selected = galaxy.playerEmpire;
    const A = gameSummaryAreas(w, h);
    const scroll = { medals: 0, factions: 0, collection: 0, games: 0 };
    const root = at(div('gs-panel'), 0, 0, w, h);
    root.style.backgroundImage = `url("${SUMMARY_IMAGES.galaxy}")`;
    host.appendChild(root);
    const tooltipLayer = at(div('gs-tooltips'), 0, 0, w, h);

    const area = (r: { x: number; y: number; w: number; h: number }, cls: string): HTMLDivElement => {
        const a = at(div(`gs-area ${cls}`), r.x, r.y, r.w, r.h);
        root.appendChild(a);
        return a;
    };
    const clearTip = (): void => tooltipLayer.replaceChildren();

    // DrawMedalSummary: background, optional large medal, title (bold yellow), description (yellow).
    const medalTip = (a: StoredAchievement, rect: { x: number; y: number; w: number; h: number }, showMedal: boolean): void => {
        clearTip();
        const box = at(div('gs-tip'), rect.x, rect.y, rect.w, rect.h);
        if (showMedal) {
            const m = medal(a.type, a.value, a.racePictureIndex, MEDAL_LARGE);
            m.classList.add('gs-tip-medal');
            box.appendChild(m);
        }
        const ach = new Achievement(a.type, a.value, a.raceName !== null ? ({ name: a.raceName } as Race) : null);
        box.appendChild(div('gs-tip-title', resolveAchievementTitleComplete(ach)));
        box.appendChild(div('gs-tip-desc', resolveAchievementDescription(ach)));
        tooltipLayer.appendChild(box);
    };

    function render(): void {
        root.replaceChildren();
        clearTip();
        const sel = st.selected;
        // --- DrawFactionDetail ---
        const d = area(A.detail, 'gs-detail');
        if (sel !== null) {
            const tint = div('gs-fill');
            tint.style.background = `rgba(${(sel.mainColor >> 16) & 255}, ${(sel.mainColor >> 8) & 255}, ${sel.mainColor & 255}, ${64 / 255})`;
            d.appendChild(tint);
            const col = at(div('gs-detail-col'), MARGIN, MARGIN, A.detail.w - 2 * MARGIN);
            const race = img('', 'gs-detail-race');
            applyEmpireEmblem(race, galaxy, sel, 'portrait');
            col.appendChild(race);
            col.appendChild(div('gs-heading', sel.name));
            const gov = empireGovernmentAttributes(sel);
            if (gov !== null) col.appendChild(div('gs-normal', gov.name));
            else if (sel.pirateEmpireBaseHabitat !== null) col.appendChild(div('gs-normal', tx('Pirate Faction', 'Pirate Faction')));
            // Galaxy.GameSummary (Galaxy.4.cs 2357: DetermineGameSummary at setup): the galaxy's star count and difficulty.
            col.appendChild(div('gs-normal', formatNet(tx('Game Summary Galaxy Size', 'Galaxy Size: {0} stars'), [String(galaxy.starCount)])));
            col.appendChild(div('gs-normal', formatNet(tx('Game Summary Difficulty', 'Difficulty: {0}'), [difficultyDisplayText(galaxy.difficultyLevel)])));
            col.appendChild(div('gs-normal', formatNet(tx('Game Summary Score', 'Score: {0}'), [groupedInt(sel.score)])));
            d.appendChild(col);
            // DrawTooltips: the score breakdown under the detail area while it is hovered.
            d.addEventListener('mouseenter', () => {
                clearTip();
                let s;
                try {
                    s = calculateEmpireScore(galaxy, sel);
                } catch {
                    return;
                }
                const box = at(div('gs-tip gs-score-tip'), A.detail.x, A.detail.y + A.detail.h, A.detail.w, 130);
                const line = (key: string, fb: string, v: number, bold = false): void => {
                    box.appendChild(div(bold ? 'gs-score-line gs-bold' : 'gs-score-line', formatNet(tx(key, fb), [groupedInt(v)])));
                };
                line('Game Summary Score', 'Score: {0}', s.score, true);
                line('Game Summary Score Population', 'Population: {0}', s.population);
                line('Game Summary Score Economy', 'Economy: {0}', s.economy);
                line('Game Summary Score Colonies', 'Colonies: {0}', s.colonies);
                line('Game Summary Score Military', 'Military: {0}', s.military);
                line('Game Summary Score Research', 'Research: {0}', s.research);
                line('Game Summary Score Wonders', 'Wonders: {0}', s.wonders);
                tooltipLayer.appendChild(box);
            });
            d.addEventListener('mouseleave', clearTip);
        }

        // --- DrawFactionAchievements ---
        const m = area(A.medals, 'gs-medals');
        watermark(m, tx('Empire Achievements', 'Empire Achievements'), A.medals.h);
        const medals = (sel?.achievements ?? []).filter((a): a is Achievement => a != null);
        medals.forEach((a, i) => {
            const x = MARGIN + ARROW + i * MEDAL_LARGE - scroll.medals;
            if (x + MEDAL_LARGE < 0 || x >= A.medals.w) return;
            const node = at(medal(a.type, a.value, a.additionalData?.pictureIndex ?? null, MEDAL_LARGE), x, (A.medals.h - MEDAL_LARGE) / 2);
            node.addEventListener('mouseenter', () => {
                const tw = Math.trunc(MEDAL_LARGE * 1.6);
                let tx0 = A.medals.x + x + MEDAL_LARGE / 2 - tw / 2;
                tx0 = Math.max(0, Math.min(w - tw, tx0));
                medalTip(toStoredAchievement(a), { x: tx0, y: A.medals.y + (A.medals.h - MEDAL_LARGE) / 2 + MEDAL_LARGE, w: tw, h: 40 }, false);
            });
            node.addEventListener('mouseleave', clearTip);
            m.appendChild(node);
        });
        const medalMax = medals.length > 0 ? (medals.length - 1) * MEDAL_LARGE : 0;
        scrollArrow(m, SUMMARY_IMAGES.left, { x: 0, y: 0, w: ARROW, h: A.medals.h }, () => {
            scroll.medals = Math.max(0, scroll.medals - 20);
            render();
        });
        scrollArrow(m, SUMMARY_IMAGES.right, { x: A.medals.w - ARROW, y: 0, w: ARROW, h: A.medals.h }, () => {
            scroll.medals = Math.min(medalMax, scroll.medals + 20);
            render();
        });

        // --- DrawFactionSummaries ---
        const f = area(A.factions, 'gs-factions');
        watermark(f, tx('Empires in this Game', 'Empires in this Game'), A.factions.h);
        const empires = resolveValidEmpires(galaxy);
        empires.forEach((e, i) => {
            const x = MARGIN + ARROW + i * (RACE + GAP) - scroll.factions;
            if (x + RACE < 0 || x >= A.factions.w) return;
            const cell = at(div('gs-faction'), x, MARGIN, RACE, A.factions.h - 2 * MARGIN);
            if (e === sel) cell.classList.add('gs-faction-selected');
            const r = at(img('', 'gs-faction-race'), 0, 0, RACE, RACE);
            applyEmpireEmblem(r, galaxy, e, 'portrait');
            cell.appendChild(r);
            cell.appendChild(at(div('gs-normal gs-center', formatNet(tx('Game Summary Score', 'Score: {0}'), [groupedInt(e.score)])), 0, RACE, RACE, 15));
            let mx = 0;
            for (const a of e.achievements ?? []) {
                if (a == null) continue;
                cell.appendChild(at(medal(a.type, a.value, a.additionalData?.pictureIndex ?? null, MEDAL_VERY_SMALL), mx, 12 + RACE + MARGIN));
                mx += MEDAL_VERY_SMALL;
                if (mx >= RACE) break;
            }
            // MouseClick on an Empire: select it, reset the medal scroll.
            cell.addEventListener('click', () => {
                st.selected = e;
                scroll.medals = 0;
                render();
            });
            f.appendChild(cell);
        });
        const facMax = empires.length > 0 ? (empires.length - 1) * (RACE + GAP) : 0;
        scrollArrow(f, SUMMARY_IMAGES.left, { x: 0, y: 0, w: ARROW, h: A.factions.h }, () => {
            scroll.factions = Math.max(0, scroll.factions - 20);
            render();
        });
        scrollArrow(f, SUMMARY_IMAGES.right, { x: A.factions.w - ARROW, y: 0, w: ARROW, h: A.factions.h }, () => {
            scroll.factions = Math.min(facMax, scroll.factions + 20);
            render();
        });

        // --- DrawAchievementCollection ---
        const c = area(A.collection, 'gs-collection');
        watermark(c, tx("Player's Achievements", "Player's Achievements"), A.collection.h);
        const coll = st.list.playerAchievements;
        coll.forEach((a, i) => {
            const x = MARGIN + ARROW + i * MEDAL_SMALL - scroll.collection;
            if (x + MEDAL_SMALL < 0 || x >= A.collection.w) return;
            const node = at(medal(a.type, a.value, a.racePictureIndex, MEDAL_SMALL), x, MARGIN);
            node.addEventListener('mouseenter', () => {
                const tw = Math.trunc(MEDAL_LARGE * 1.4);
                let tx0 = A.collection.x + x + MEDAL_SMALL / 2 - tw / 2;
                tx0 = Math.max(0, Math.min(w - tw, tx0));
                medalTip(a, { x: tx0, y: A.collection.y + MARGIN + MEDAL_SMALL, w: tw, h: MEDAL_LARGE + 55 }, true);
            });
            node.addEventListener('mouseleave', clearTip);
            c.appendChild(node);
        });
        const collMax = coll.length > 0 ? (coll.length - 1) * MEDAL_SMALL : 0;
        scrollArrow(c, SUMMARY_IMAGES.left, { x: 0, y: 0, w: ARROW, h: A.collection.h }, () => {
            scroll.collection = Math.max(0, scroll.collection - 20);
            render();
        });
        scrollArrow(c, SUMMARY_IMAGES.right, { x: A.collection.w - ARROW, y: 0, w: ARROW, h: A.collection.h }, () => {
            scroll.collection = Math.min(collMax, scroll.collection + 20);
            render();
        });

        // --- DrawGameSummaryCollection ---
        const g = area(A.games, 'gs-games');
        watermark(g, tx('Completed Games', 'Completed Games'), A.games.h);
        const games = sortGameSummariesForDisplay(st.list.summaries);
        games.forEach((s, i) => {
            const y = MARGIN + ARROW + i * MEDAL_VERY_SMALL - scroll.games;
            if (y + MEDAL_VERY_SMALL < 0 || y >= A.games.h) return;
            const row = at(div('gs-game'), 0, y, A.games.w, MEDAL_VERY_SMALL);
            if (s === st.current) row.classList.add('gs-game-current');
            else if (i % 2 === 0) row.classList.add('gs-game-even');
            if (s.playerRacePictureIndex >= 0) row.appendChild(at(img(racePortraitUrl(s.playerRacePictureIndex)), MARGIN, 0, MEDAL_VERY_SMALL, MEDAL_VERY_SMALL));
            const color = `rgb(${(s.playerMainColor >> 16) & 255}, ${(s.playerMainColor >> 8) & 255}, ${s.playerMainColor & 255})`;
            let x = MARGIN + MEDAL_VERY_SMALL + MARGIN;
            const cell = (text: string, dx: number, bold: boolean): void => {
                const t = at(div(bold ? 'gs-game-cell gs-bold' : 'gs-game-cell', text), x, bold ? 0 : 3);
                t.style.color = color;
                row.appendChild(t);
                x += dx;
            };
            cell(s.playerEmpireName, 180, true);
            cell(s.playerGovernmentName, 100, false);
            cell(formatNet(tx('Game Summary Galaxy Size', 'Galaxy Size: {0} stars'), [String(s.galaxyStarCount)]), 120, false);
            cell(formatNet(tx('Game Summary Difficulty', 'Difficulty: {0}'), [difficultyDisplayText(s.difficultyLevel)]), 100, false);
            cell(formatNet(tx('Game Summary Score', 'Score: {0}'), [String(s.playerScore)]), 80, false);
            cell(s.playerVictory ? tx('Game Summary Victory', 'Victory') : tx('Game Summary Defeat', 'Defeat'), 50, false);
            // Medals from x = 670 of the panel (the C# literal), i.e. 660 in the area.
            let mx = 670 - A.games.x;
            for (const a of s.playerAchievements) {
                row.appendChild(at(medal(a.type, a.value, a.racePictureIndex, MEDAL_VERY_SMALL), mx, 0));
                mx += MEDAL_VERY_SMALL;
            }
            g.appendChild(row);
        });
        const gamesMax = games.length > 0 ? (games.length - 1) * MEDAL_VERY_SMALL : 0;
        scrollArrow(g, SUMMARY_IMAGES.up, { x: 0, y: 0, w: A.games.w, h: ARROW }, () => {
            scroll.games = Math.max(0, scroll.games - 20);
            render();
        });
        scrollArrow(g, SUMMARY_IMAGES.down, { x: 0, y: A.games.h - ARROW, w: A.games.w, h: ARROW }, () => {
            scroll.games = Math.min(gamesMax, scroll.games + 20);
            render();
        });

        // OverlayTextLines: centred yellow huge lines over the panel.
        if (st.overlay.length > 0) {
            const ov = at(div('gs-overlay'), 0, 0, w, h);
            for (const l of st.overlay) ov.appendChild(div('gs-overlay-line', l));
            root.appendChild(ov);
        }
        root.appendChild(tooltipLayer);
    }
    render();
    return { render };
}

/** Test hook: forget the per-galaxy panel state. */
export function resetGameSummaryState(galaxy: Galaxy): void {
    states.delete(galaxy);
}
