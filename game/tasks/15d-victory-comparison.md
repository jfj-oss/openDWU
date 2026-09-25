# Task 15d — Empire comparison, victory conditions and achievements (V), plus the game-end banner

thinking: off
scope: locked

Edit only these files:
- a new `src/ui/screens/empireComparison.ts` and a new `src/ui/screens/empireComparison.css`
- `src/ui/keyboard.ts`: only the three `[15d]` hook blocks below (one import line, one `dispatchKey` case, one `IMPLEMENTED_KEY_ACTIONS` line)
- `src/main.ts`: only the three `[15d]` blocks below (one import, one registration in `startGameView`, one cleanup block)
- a new `test/empireComparison.test.ts`

Do NOT edit anything under `src/sim/`; only import from it. Three other agents (15a, 15b, 15c) edit `keyboard.ts`, `hud.ts` and `main.ts` at the same time. Put each hook exactly at the anchor given, wrapped in its `[15d]` marker comments. Do not reformat, reorder or "tidy" any neighbouring line, so the four branches merge. This task does not touch `src/ui/hud.ts`. Start editing right away.

After this task:
- **V** opens a streamlined "Empire Comparisons and Victory Conditions" panel with three tabs:
  - **Victory**: the global conditions text (GameVictoryConditions.cs), then a per-empire progress table.
  - **Comparison**: the score ranking, then the five original comparison rankings (Population, Territory, Economy, Strategic Value, Military Strength) over the empires the player knows.
  - **Achievements**: the player's unlocked achievements.
- When the sim raises `GameEnd`, the game pauses, `galaxy.gameIsFinished` / `gameVictor` are set, and a centred banner shows VICTORY! / DEFEAT! and the description. The banner has a **Continue** button (resume) and a **Victory Conditions** button (opens the panel).

Why the handler matters: at HEAD nobody subscribes to `GameEnd`. `onGameEnd` (victory.ts:235) is a no-op without a handler, so `gameIsFinished` can never become true. In the original, `Main.Galaxy_GameEnd → DoGameEnd` sets it (Main.Part12.cs:3418-3427). This task registers that handler.

House style: copy the structure of `src/ui/screens/empiresList.ts` / `coloniesList.ts`:
- module-level `open` state;
- `toggle…` / `close…` exports;
- a document `keydown` Escape handler with `stopImmediatePropagation`;
- pure functions that take plain data, so tests need no DOM and no real galaxy.

## Existing code you use (read-only; verified at HEAD a399da7)

- `src/sim/victory.ts`:
  - `class VictoryConditions` fields:
    - `territory`, `territoryPercent`, `population`, `populationPercent`, `economy`, `economyPercent`
    - `timeLimit`, `timeLimitDate`, `startDate`
    - `defendHabitat`, `defendHabitatEmpire`, `targetHabitat`, `targetHabitatEmpire`
    - `enableRaceSpecificVictoryConditions`, `victoryThresholdPercentage`
  - `class VictoryConditionProgress`:
    - `empire`, `territoryEnabled`, `economyEnabled`, `populationEnabled`, `territoryProgress`, `economyProgress`, `populationProgress`, `raceVictoryConditionsProgress`, `bonusAmount`
    - getter `totalProgress`
    - `getProgressAll(): { territoryProgress, economyProgress, populationProgress, raceProgress }`
    - `compareTo(other)`. On ties it reads `totalColonyStrategicValue(empire)`, which loops `empire.colonies`.
    - constructor `(empire, territoryEnabled, economyEnabled, populationEnabled, territoryProgress, economyProgress, populationProgress, raceProgresses | null)`
  - `generateVictoryConditionProgresses(galaxy, gvc, filterOutUnmetEmpires)` returns `[]` when `gvc` is null. Pass `false` and filter unknown empires yourself: `filterOutUnmetEmpires = true` calls `obtainDiplomaticRelation`, which adds relations. The race-condition part still calls `obtainDiplomaticRelation` for a few condition types, exactly as the sim's own victory check does. Note that in a comment.
  - `enum GameEndOutcome { Undefined, Victory, Defeat, Stalemate }`
  - `class GameEndEventArgs(victorEmpire, outcomeForPlayer, description, code)`
  - `setGameEndHandler(galaxy, handler | null)` stores the handler in a WeakMap keyed by galaxy, so nothing is saved.
  - `onGameEnd(galaxy, e)` calls the handler.
  - `doGameEnd(galaxy, e)` is the model part of DoGameEnd: it sets `galaxy.gameIsFinished = true` and `galaxy.gameVictor = e.victorEmpire`.
  - The tick checks victory only while `!galaxy.gameIsFinished` (tick/galaxyTick.ts:196).
- `src/sim/achievements.ts`:
  - `enum AchievementType`
  - `class Achievement { type; value; additionalData: Race | null }`
  - `interface EmpireScore { score, population, economy, colonies, military, research, wonders }`
  - `calculateEmpireScore(galaxy, empire): EmpireScore`
  - `determineAchievementLevel(type, value)`, `determineAchievementValueForLevel(type, level)`
  - `resolveAchievementLevelDescription(type, level)` returns a **GameText key** such as 'Achievement Level I' (the sim's `getText` returns keys), or `''`.
  - `reviewAchievements(galaxy)` refreshes every empire's `achievements` / `score`.
  - `Empire.achievements: Achievement[]` and `Empire.score` are updated in the long galaxy block.
- `src/sim/forceStructure.ts`: `totalColonyStrategicValue(empire)` and `privateAnnualRevenue(galaxy, empire)`.
- `src/sim/diplomacyTick.ts`: `militaryPotency(empire)`.
- `src/sim/diplomacy.ts`: `DiplomaticRelationType` (`NotMet` = 0). `Empire.diplomaticRelations` is an iterable `DiplomaticRelationList` with `byEmpire(e)`.
- `src/sim/galaxyTime.ts`: `resolveStarDateDescription(starDate): string`.
- `src/sim/data/gameText.ts`: `parseGameText(source): { text: GameText }`, where `type GameText = Map<string, string>`.
- `Galaxy` fields:
  - `empires`, `playerEmpire`
  - `globalVictoryConditions: VictoryConditions | null`
  - `gameRaceSpecificVictoryConditionsEnabled`
  - `gameIsFinished`, `gameVictor`
  - `playerVictoryConditionsToAchieve` / `ToPrevent` (scenario only; null in a normal game)
- `Empire` fields: `name`, `active`, `colonies`, `totalPopulation`, `dominantRace` (a `Race` with `name` and `playable`), `achievements`, `galaxy`, `diplomaticRelations`.
- `Habitat` fields: `name`, `category: HabitatCategoryType` (src/sim/types.ts).
- `src/sim/galaxyTime.ts` `GalaxyTime` has a public `paused: boolean` field. main.ts passes the same `time` to the HUD, whose pause button follows `time.paused`.
- `src/ui/screens/empireSummary.ts`: `getEmpireSummarySource(): { empire } | null`. keyboard.ts already imports it.
- main.ts `startGameView` has `galaxy`, `game`, `time`, and the line `const refreshClockTimer = setInterval(refreshClockLabel, 250);` (~line 364). `activeGameViewCleanup` ends with:
  ```ts
          setEmpireSummarySource(null);
          // The ticker buffer is module-level; the next game starts fresh.
          clearHudMessages();
      };
  ```

## C# source (verbatim, trimmed)

DistantWorlds.Controls/Controls/GameVictoryConditions.cs:90-230 and 331-348, the Victory Conditions text. `num1` / `num2` are indents.
```cs
if (this._Game.IsFinished) {
    Draw(GetText("GAME OVER"), Color.Yellow);
    if (this._Game.Victor != null) Draw(GetText("Winner") + ": " + this._Game.Victor.Name, Color.Yellow);
}
if (this._Game.GlobalVictoryConditions != null) {
    if (Economy || Population || Territory || TimeLimit || TargetHabitat != null || DefendHabitat != null) { flag = true; Draw(GetText("Global Conditions")); }
    if (TimeLimit) { Draw(string.Format(GetText("To win - Time Limit"), Galaxy.ResolveStarDateDescription(TimeLimitDate)));
                     Draw("(" + GetText("To win - Time Limit explanation") + ")"); }
    if (StartDate > 0L) Draw(string.Format(GetText("To win - Start Date"), Galaxy.ResolveStarDateDescription(StartDate)));
    if (Economy) {
        string text = string.Format(GetText("Victory Conditions Economy"), EconomyPercent.ToString("#0"));
        Empire otherEmpire = null; double num4 = 0.0; double num5 = 0.0;
        foreach (Empire empire in Galaxy.Empires) {
            num5 += empire.PrivateAnnualRevenue;
            if (empire.DominantRace != null && empire.DominantRace.Playable && empire.PrivateAnnualRevenue > num4) { otherEmpire = empire; num4 = empire.PrivateAnnualRevenue; }
        }
        string str = "(" + GetText("None") + ")";
        if (otherEmpire != null) {
            double num6 = num4 / num5;
            str = otherEmpire.Name + " (" + num6.ToString("0%") + ")";
            if (otherEmpire != PlayerEmpire) {
                DiplomaticRelation diplomaticRelation = PlayerEmpire.DiplomaticRelations[otherEmpire];
                if (diplomaticRelation == null || diplomaticRelation.Type == DiplomaticRelationType.NotMet) str = "(" + GetText("Unknown empire") + ")";
            }
        }
        Draw(text); Draw(GetText("Closest Empire") + ": " + str);
    }
    if (Population) { /* same with Empire.TotalPopulation (long) and "Victory Conditions Population" */ }
    if (Territory)  { /* same with Empire.Colonies.Count (int) and "Victory Conditions Territory" */ }
    if (DefendHabitat != null && DefendHabitatEmpire != null)
        Draw(string.Format(GetText("Victory Conditions Defend Colony"), Galaxy.ResolveDescription(DefendHabitat.Category).ToLower(), DefendHabitat.Name, DefendHabitatEmpire.Name));
    if (TargetHabitat != null && TargetHabitatEmpire != null)
        Draw(string.Format(GetText("Victory Conditions Conquer Colony"), Galaxy.ResolveDescription(TargetHabitat.Category).ToLower(), TargetHabitat.Name, TargetHabitatEmpire.Name));
}
/* PlayerVictoryConditionsToAchieve / ToPrevent: scenario lists — TODO(port) */
if (this._Game.Galaxy.GameRaceSpecificVictoryConditionsEnabled) Draw(GetText("Race-specific Victory Conditions are Active"));
if (flag || PlayerVictoryConditionsToAchieve != null || PlayerVictoryConditionsToPrevent != null) return;
Draw(GetText("SANDBOX MODE"));
```
GameText.txt values:
- `GAME OVER` → "GAME OVER"
- `Winner` → "Winner"
- `Global Conditions` → "Global Conditions"
- `To win - Time Limit` → " Game finishes at {0}" (trim the leading space)
- `To win - Time Limit explanation` → "Winner is the empire with the greatest strategic value at this time"
- `To win - Start Date` → " Victory Conditions do not apply until {0}" (trim)
- `Victory Conditions Economy` → "Empire's private economy (GDP) generates {0}% of galaxy total"
- `Victory Conditions Population` → "Control {0}% of the galaxy's population"
- `Victory Conditions Territory` → "Control {0}% of colonies in the galaxy"
- `Closest Empire` → "Closest Empire"
- `Unknown empire` → "Unknown empire"
- `None` → "None"
- `Victory Conditions Defend Colony` → "You must prevent the {0} {1} of the {2} from being taken over or destroyed"
- `Victory Conditions Conquer Colony` → "You must take over or destroy the {0} {1} of the {2}"
- `Race-specific Victory Conditions are Active` → same text
- `SANDBOX MODE` → "SANDBOX MODE (Open Play - No victory conditions)"
- `Empire Comparisons and Victory Conditions` → same text (the window title)

`ResolveDescription(HabitatCategoryType)` → "Star" / "Planet" / "Moon" / "Asteroid" / "Gas Cloud" (lower-cased here).

DistantWorlds.Types/Galaxy.5.cs:3331 `DetermineOrderedKnownEmpires(empire, comparisonType)`:
```cs
EmpireList empireList = new EmpireList();
empireList.Add(empire);
foreach (DiplomaticRelation diplomaticRelation in empire.DiplomaticRelations)
    if (diplomaticRelation.Type != 0) empireList.Add(diplomaticRelation.OtherEmpire);
foreach (Empire item2 in empireList) {
    switch (comparisonType) {
        case Population: priority = item2.TotalPopulation; break;
        case Territory: priority = item2.Colonies.Count; break;
        case Economy: priority = item2.PrivateAnnualRevenue; break;
        case StrategicValue: priority = item2.TotalColonyStrategicValue; break;
        case MilitaryStrength: priority = item2.MilitaryPotency; break;
    }
    empirePriorityList.Add(new EmpirePriority(item2, priority));
}
empirePriorityList.Sort(); empirePriorityList.Reverse();     // descending by priority
```
EmpireComparison.cs:98-141 gives the titles and value formats:
- Population: "Population", format `0,,M` (value ÷ 1e6 rounded, then "M")
- Territory: "Territory - Colonies", format `#0 colonies`
- Economy: "Economy - Annual GDP", format `0,K credits`
- StrategicValue: "Strategic Value", format `0,K`
- MilitaryStrength: "Military Strength", format `#0 firepower`

Each row is labelled `(rank + 1) + ". " + Empire.Name`.

DistantWorlds/Main.Part12.cs:3423 `DoGameEnd` and Main.Part6.cs:3998 `method_436`, the game-end screen:
```cs
public void DoGameEnd(GameEndEventArgs e) {
    method_154();                 // pause: _Game.Galaxy.Pause()
    _Game.IsFinished = true;
    _Game.Victor = e.VictorEmpire;
    musicPlayer_0.StartTheme();
    method_436(e);
    if (e.Code == 1) { /* Shakturi story message — TODO(port) */ }
}
private void method_436(GameEndEventArgs gameEndEventArgs_0) {
    _Game.Galaxy.ReviewAchievements();
    GameSummary gameSummary = _Game.Galaxy.DetermineGameSummary(); …
    List<string> list = new List<string>();
    if (OutcomeForPlayer == GameEndOutcome.Victory) list.Add(GetText("Victory").ToUpper() + "!");
    else if (OutcomeForPlayer == GameEndOutcome.Defeat) list.Add(GetText("Defeat").ToUpper() + "!");
    list.Add(" ");
    list.Add(gameEndEventArgs_0.Description);
    pnlGameSummary.OverlayTextLines = list;
    …
    if (OutcomeForPlayer == GameEndOutcome.Defeat && (_Game.PlayerEmpire.Colonies.Count <= 0 || !_Game.PlayerEmpire.Active)) btnGameEndContinue.Enabled = false;
}
private void btnGameEndContinue_Click(…) { method_437(); /* hide */ method_155(); /* resume */ }
```
Achievement text keys: Galaxy.1.cs:3465 ResolveAchievementTitleComplete, 3526 ResolveDescription(Achievement), 3624 ResolveTitle. The GameText values include:
- `AchievementTitle ConquerEnemyColonies` = "Conqueror"
- `AchievementType ConquerEnemyColonies` = "Conquer {0} Enemy Colonies"
- `AchievementType StartWars` = "Start 20 Wars"
- `AchievementTitle AchieveAllRaceVictoryConditions` = "Paragon of the {0}s"
- `Achievement Level I` / `II` / `III` / `L` / `C` / `M` = the key's last token

## Steps

1. `src/ui/screens/empireComparison.ts`
   - Header comment:
     - task 15d;
     - cite GameVictoryConditions.cs, EmpireComparison.cs + Galaxy.5.cs DetermineOrderedKnownEmpires, Main.Part12.cs DoGameEnd and Main.Part6.cs method_436;
     - add `// TODO(port): scenario PlayerVictoryConditionsToAchieve/ToPrevent lists, race-condition detail panel (RaceVictoryConditionsPanel.cs), comparison bar graphs + history charts, Shakturi story message (Code 1), pirate-player comparison (pirate relations)`.
   - `import './empireComparison.css';` plus the sim imports listed above (use `import type` where only types are used).
   - Formatting helpers, all exported and pure:
     - `percent0(v)`: `${Math.round(v * 100)}%`, and '0%' for non-finite values.
     - `formatComparisonValue(kind, v)`:
       - population → `${Math.round(v / 1e6)}M`
       - territory → `${Math.round(v)} colonies`
       - economy → `${Math.round(v / 1000)}K credits`
       - strategicValue → `${Math.round(v / 1000)}K`
       - military → `${Math.round(v)} firepower`
       - There is no digit grouping: in .NET, `0,K` / `0,,M` only scale.
   - `export type ComparisonKind = 'population' | 'territory' | 'economy' | 'strategicValue' | 'military';` and `export const COMPARISON_TITLES: Record<ComparisonKind, string>` with the five titles above.
   - `export interface ConditionEmpireStat { name: string; playable: boolean; known: boolean; isPlayer: boolean; revenue: number; population: number; colonies: number }`.
   - `export interface ConditionLine { text: string; emphasis: boolean }`.
   - `export interface ConditionInput`:
     ```ts
     {
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
     ```
   - `export function globalConditionLines(input: ConditionInput): ConditionLine[]`: port GameVictoryConditions.cs line by line, with the GameText values above. Rules:
     - The emphasis lines are GAME OVER, Winner, Global Conditions, the defend/target lines, the race-specific line and the sandbox line.
     - "Closest Empire": pick the first `playable` empire whose value is strictly greater than the running max. The max starts at 0, and the sum runs over **all** empires.
     - When the closest is not the player and not `known`, show `(Unknown empire)`. When there is no closest, show `(None)`.
     - Percent values use `Math.round(percent)` (`ToString("#0")`).
     - The closest share uses `percent0(max / sum)`.
   - `export interface RankedValue<T> { rank: number; item: T; value: number }` and `export function rankDescending<T>(items: { item: T; value: number }[]): RankedValue<T>[]`. Use a stable sort descending by value, with `rank` starting at 1. Add a comment that the C# `Sort()` + `Reverse()` is unstable for ties.
   - `export function knownEmpires(player: Empire): Empire[]`: `[player]`, plus `rel.otherEmpire` for every relation in `player.diplomaticRelations` with `type !== DiplomaticRelationType.NotMet` and a non-null other (Galaxy.5.cs:3331). There is no `active` filter, as in the C#.
   - `export function comparisonValue(galaxy: Galaxy, e: Empire, kind: ComparisonKind): number` (the adapter; not unit-tested):
     - population → `totalPopulation`
     - territory → `colonies.length`
     - economy → `privateAnnualRevenue(galaxy, e)`
     - strategicValue → `totalColonyStrategicValue(e)`
     - military → `militaryPotency(e)`
   - `export interface VictoryProgressRow { empire: Empire; name: string; isPlayer: boolean; total: number; territory: number | null; economy: number | null; population: number | null; race: number | null; bonus: number }`.
   - `export function victoryProgressRows(progresses: VictoryConditionProgress[], player: Empire, isKnown: (e: Empire) => boolean): VictoryProgressRow[]`:
     - Keep only `p.empire === player || isKnown(p.empire)`.
     - Sort with `(a, b) => b.compareTo(a)`, i.e. descending.
     - Per row:
       - `total = p.totalProgress`;
       - take the parts from `p.getProgressAll()`. A part is `null` when that condition is disabled; `race` is null when `raceVictoryConditionsProgress` is null or empty;
       - `bonus = p.bonusAmount + p.pirateBonusAmount`.
   - `export function isKnownEmpire(player: Empire, e: Empire): boolean`: `e === player || (player.diplomaticRelations.byEmpire(e)?.type ?? DiplomaticRelationType.NotMet) !== DiplomaticRelationType.NotMet`.
   - `export interface AchievementRow { title: string; level: string; description: string }` and `export function achievementRows(list: readonly (Achievement | null)[], text: GameText | null): AchievementRow[]`. Skip null entries and `Undefined`. Use `lookup(k) = text?.get(k) ?? k`.
     - `level = determineAchievementLevel(type, value)`.
     - `title`:
       - for AchieveAllRaceVictoryConditions: `lookup('AchievementTitle AchieveAllRaceVictoryConditions')` with `{0}` replaced by `additionalData?.name ?? ''`;
       - otherwise: `lookup('AchievementTitle ' + AchievementType[type])`.
     - `level` text: `k = resolveAchievementLevelDescription(type, level)`, then `k === '' ? '' : lookup(k)`.
     - `description`: `lookup('AchievementType ' + AchievementType[type])` with `{0}` replaced by `String(determineAchievementValueForLevel(type, level))`. Texts without `{0}` are unchanged, which matches Galaxy.1.cs:3526.
   - `let gameTextCache: Promise<GameText | null> | null = null;` and `export function loadGameText(): Promise<GameText | null>`. Fetch `/assets/dwu/GameText.txt` once, then `parseGameText(src).text`. Resolve `null` on any error.
   - `export function gameEndBannerLines(e: GameEndEventArgs): string[]`: method_436's `list`.
     - Victory → `['VICTORY!', ' ', e.description]`.
     - Defeat → `['DEFEAT!', ' ', e.description]`.
     - Otherwise `[' ', e.description]`.
     - Add `// TODO(port) M9: e.description is still a GameText key from the sim's getText stub`.
   - `export function canContinueAfterGameEnd(e: GameEndEventArgs, player: Empire | null): boolean`: returns `!(e.outcomeForPlayer === GameEndOutcome.Defeat && player !== null && (player.colonies.length <= 0 || !player.active))`.
   - `export function installGameEndHandler(galaxy: Galaxy, time: { paused: boolean }): void`. Port DoGameEnd with `setGameEndHandler(galaxy, (e) => { … })`:
     1. `time.paused = true;` (method_154)
     2. `doGameEnd(galaxy, e);`
     3. `reviewAchievements(galaxy);` (method_436's first line)
     4. `if (typeof document !== 'undefined') showGameEndBanner(galaxy, time, e);`
     - A second GameEnd in the same check replaces the banner, since the C# DoGameEnd would also run twice.
   - `export function removeGameEndHandler(galaxy: Galaxy): void`: `setGameEndHandler(galaxy, null)`.
   - `showGameEndBanner` (not exported) / `export function closeGameEndBanner()`:
     - Show a fixed, centred panel (z-index 1600) with the lines. The first line is large and yellow; the description is plain.
     - Button `Continue` is disabled when `!canContinueAfterGameEnd(e, galaxy.playerEmpire)`. On click: close the banner, then set `time.paused = false` (method_155).
     - Button `Victory Conditions` opens the V panel on the Victory tab: `toggleEmpireComparison({ player })` if it is not open.
   - Panel DOM:
     - `export interface EmpireComparisonOptions { player: Empire }`, `toggleEmpireComparison(opts)`, `closeEmpireComparison()`.
     - Title: `Empire Comparisons and Victory Conditions`. Three tab buttons (`Victory`, `Comparison`, `Achievements`); the selected tab is kept in a module variable.
     - **Victory tab**:
       - The `globalConditionLines` output. Build `ConditionInput` from `player.galaxy`:
         - each empire's `name`, `dominantRace?.playable ?? false`, `known = isKnownEmpire(player, e)`, `isPlayer`, `revenue = privateAnnualRevenue(galaxy, e)`, `population = totalPopulation`, `colonies = colonies.length`;
         - `scenarioConditions` = either of the scenario lists non-null;
         - `defend` / `target` categories = `HabitatCategoryType[h.category]`, split into words and lower-cased ('gas cloud');
         - `starDateText = resolveStarDateDescription`.
       - Below the lines:
         - `Victory threshold: ${percent0(gvc.victoryThresholdPercentage)}`, when `gvc` is non-null;
         - a table: Empire | Total | Territory | Economy | Population | Race | Bonus.
       - The table comes from `victoryProgressRows(generateVictoryConditionProgresses(galaxy, gvc, false), player, (e) => isKnownEmpire(player, e))`.
       - `null` parts show '—'. The player row is bold.
     - **Comparison tab**:
       - First a `Score` table: rank, name, score, and the six parts (Pop, Econ, Colonies, Military, Research, Wonders), from `calculateEmpireScore(galaxy, e)` over `knownEmpires(player)`, ranked with `rankDescending` on `score`.
       - Then, for each `ComparisonKind`:
         - a heading `COMPARISON_TITLES[kind]`;
         - rows `${rank}. ${name}`, a horizontal bar (width = value / top value; 0 when the top value is ≤ 0), and `formatComparisonValue(kind, value)`.
     - **Achievements tab**:
       - `achievementRows(player.achievements, text)`, one row each: `title`, then the level (if any) as a small tag, then the description.
       - The empty state is `No achievements yet`.
       - Call `loadGameText()` when the tab first renders; re-render when it resolves. Until then, keys are shown.
     - If `galaxy.gameIsFinished`, a yellow banner line `GAME OVER — Winner: X` sits above the tabs. The Victory tab already shows GAME OVER.
     - While open, re-render every 5000 ms. `generateVictoryConditionProgresses` is not cheap. Clear the interval in `close()`.
2. `src/ui/screens/empireComparison.css`: copy `coloniesList.css` with the prefix `empire-comparison-`.
   - `.empire-comparison-window` is `width: min(900px, calc(100vw - 32px))`.
   - Tables use `display: grid` rows like the colonies list, with numeric cells right-aligned.
   - Bars: `height: 10px; background: rgba(255,0,128,0.6)` on a `rgba(32,32,128,0.5)` track (EmpireComparison.cs:155 colours).
   - `.empire-comparison-banner` is the game-end panel: `position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 1600; pointer-events: none;`. The inner panel is `pointer-events: auto` and uses the dark-panel look; the first line is `font-size: 28px; color: #ffff00`.
3. `src/ui/keyboard.ts`: three blocks, nothing else.
   - Import, right after `import { toggleMessageHistory } from './screens/messageHistory';`:
     ```ts
     import { toggleEmpireComparison } from './screens/empireComparison'; // [15d]
     ```
   - `dispatchKey` switch: insert immediately **before** `default:`, i.e. after the `galactopediaHelp` case's `break;`:
     ```ts
         // [15d] V: Empire Comparison and Victory Conditions (task 15d).
         case 'empireComparisonScreen': {
             const src = getEmpireSummarySource();
             if (src) toggleEmpireComparison({ player: src.empire });
             break;
         }
         // [/15d]
     ```
   - `IMPLEMENTED_KEY_ACTIONS`: a new line right after `'cycleColonies', 'cycleColoniesBackward', 'cycleColoniesMoveView',`:
     ```ts
         'empireComparisonScreen', // [15d]
     ```
4. `src/main.ts`: three blocks.
   - Import, right after `import { hideMapTooltip } from './ui/mapTooltip';`:
     ```ts
     import { closeEmpireComparison, closeGameEndBanner, installGameEndHandler, removeGameEndHandler } from './ui/screens/empireComparison'; // [15d]
     ```
   - In `startGameView`, right after `const refreshClockTimer = setInterval(refreshClockLabel, 250);`:
     ```ts
         // [15d] Galaxy.GameEnd → Main.Part12.cs Galaxy_GameEnd / DoGameEnd (pause, IsFinished/Victor, banner).
         installGameEndHandler(galaxy, time);
         // [/15d]
     ```
   - In `activeGameViewCleanup`, right after `clearHudMessages();` (its last statement):
     ```ts
             // [15d]
             removeGameEndHandler(galaxy);
             closeEmpireComparison();
             closeGameEndBanner();
             // [/15d]
     ```
   - Nothing else. Do not touch the generateGalaxy-only boot path.

## Tests (`test/empireComparison.test.ts`, no jsdom)

Importing the module pulls in its `.css`; vitest handles that.

- `percent0`: 0.756 → '76%', NaN → '0%'. `formatComparisonValue`:
  - population 2_600_000_000 → '2600M'
  - territory 7 → '7 colonies'
  - economy 12_345 → '12K credits'
  - strategicValue 250_000 → '250K'
  - military 42 → '42 firepower'
- `globalConditionLines`. Base input: `conditions = new VictoryConditions()` with `economy = true, economyPercent = 40`; `finished = false`; `raceSpecificEnabled = false`; `scenarioConditions = false`; `defend = target = null`; `starDateText = (d) => \`SD${d}\``. Empires:
  - `Us` (player, playable, known, revenue 100)
  - `Zorg` (playable, known false, revenue 300)
  - `Mech` (playable false, revenue 1000)

  Every stat not given here is 0.

  Expect:
  - Texts `['Global Conditions', "Empire's private economy (GDP) generates 40% of galaxy total", 'Closest Empire: (Unknown empire)']`.
  - Zorg `known = true` → 'Closest Empire: Zorg (21%)' (300 / 1400).
  - Every revenue 0 → 'Closest Empire: (None)'.
  - `timeLimit = true, timeLimitDate = 5` adds 'Game finishes at SD5' and '(Winner is the empire with the greatest strategic value at this time)' right after 'Global Conditions'.
  - `startDate = 9` adds 'Victory Conditions do not apply until SD9'.
  - `finished = true, victorName = 'Zorg'` puts 'GAME OVER' then 'Winner: Zorg' first, both with `emphasis: true`.
  - `defend = { category: 'planet', name: 'Terra', empireName: 'Us' }` → 'You must prevent the planet Terra of the Us from being taken over or destroyed'.
  - All conditions off and no scenario → the last line is 'SANDBOX MODE (Open Play - No victory conditions)'. With `raceSpecificEnabled` it is preceded by 'Race-specific Victory Conditions are Active'. With `conditions = null` → sandbox as well.
  - With territory on (`territoryPercent = 25`), and colonies Us 3 / Zorg 1 (known) → 'Control 25% of colonies in the galaxy', 'Closest Empire: Us (75%)'.
- `rankDescending`: values [5, 9, 5] → ranks 1..3, items in order [9, 5 (first), 5 (second)].
- `knownEmpires`: a player with a real `DiplomaticRelationList` holding War with A and NotMet with B → `[player, A]`. Use fake empires `{ empireId, name }` cast `as unknown as Empire`, with ids ≥ 1.
- `isKnownEmpire`: player → true, A → true, B → false, C (no relation) → false.
- `victoryProgressRows`:
  - Build `new VictoryConditionProgress(e, true, false, true, 0.5, 0, 0.2, null)` for player P and for A (known), and `(…, 0.9, 0, 0.9, null)` for B (unknown). Fake empires need `colonies: []` for `compareTo`.
  - Result: B filtered out. P and A have equal totals, so order by name, descending: `compareTo` gives name order ascending, which is reversed. Assert the exact order your stable sort produces for names 'Alpha' (A) and 'Player' (P): `['Player', 'Alpha']`.
  - `territory = 0.25`, `economy = null`, `population = 0.1`, `race = null`, `total = 0.35`.
- `achievementRows`, with `text = new Map([['AchievementTitle ConquerEnemyColonies', 'Conqueror'], ['AchievementType ConquerEnemyColonies', 'Conquer {0} Enemy Colonies'], ['Achievement Level II', 'II']])`:
  - `new Achievement(AchievementType.ConquerEnemyColonies, 60, null)` → `{ title: 'Conqueror', level: 'II', description: 'Conquer 50 Enemy Colonies' }`.
  - With `text = null` → `{ title: 'AchievementTitle ConquerEnemyColonies', level: 'Achievement Level II', description: 'AchievementType ConquerEnemyColonies' }`.
  - `AchievementType.StartWars`, value 20, text null → level ''.
  - Null entries and `Undefined` are skipped.
- `gameEndBannerLines`: Victory → `['VICTORY!', ' ', 'd']`, Defeat → `['DEFEAT!', ' ', 'd']`, Stalemate → `[' ', 'd']`.
- `canContinueAfterGameEnd`:
  - Defeat with player `{ colonies: [], active: true }` → false.
  - Defeat with `{ colonies: [{}], active: true }` → true.
  - Victory → true.
- `installGameEndHandler`:
  - Setup: `galaxy = { empires: [], pirateEmpires: [], gameIsFinished: false, gameVictor: null, playerEmpire: null } as unknown as Galaxy`, `time = { paused: false }`.
  - Install, then `onGameEnd(galaxy, new GameEndEventArgs(victor, GameEndOutcome.Defeat, 'x', 0))`. Afterwards `galaxy.gameIsFinished === true`, `galaxy.gameVictor === victor`, `time.paused === true`. There is no DOM, so no banner.
  - Then reset `galaxy.gameIsFinished = false`, call `removeGameEndHandler(galaxy)` and `onGameEnd(galaxy, …)` again: it stays `false` (no handler).
- `isKeyActionAvailable('empireComparisonScreen')` → true.

Run `npm run typecheck && npm test`. keyboard.test.ts must still pass unchanged. With `npm run dev` on a private port (other agents share 5173), save `node scripts/shot.mjs 'http://localhost:<port>/?autostart=1' shots/15d-victory.png`. Do not open it. Then append `## Worker report` with: files changed, the shot.mjs console output, and anything left undone.

## Worker report

Files changed:
- new `src/ui/screens/empireComparison.ts`, `src/ui/screens/empireComparison.css`, `test/empireComparison.test.ts`
- `src/ui/keyboard.ts`: the three `[15d]` blocks
- `src/main.ts`: the three `[15d]` blocks

shot.mjs console output (`?autostart=1`, dev server on port 5463): `[debug] [vite] connecting...`, `[debug] [vite] connected.`, `saved shots/15d-victory.png`. There were no errors. A playwright script also pressed V, opened each tab, fired `onGameEnd` (Victory) through `/src/sim/victory.ts`, and clicked Victory Conditions, then Continue. It checked that `gameIsFinished` is true, the victor is the player, the game paused then resumed, and the banner closed. Escape closes the panel.

Suite: `npx vitest run --testTimeout=300000 --maxWorkers=2`: 128 files, 1403 tests passed, exit 0.

Left undone / notes:
- `npm run typecheck` fails at HEAD 0bf6879 with a pre-existing error that is not from this task: `src/sim/galaxy.ts(4501/4541)` declares `shakturiDefeated` twice, from the m4z3 merge. src/sim is out of scope, so I did not fix it. No other type errors.
- The autostart galaxy has `globalVictoryConditions = null`, so the Victory tab shows the race-specific + SANDBOX lines and no progress table, which is faithful to the original.
