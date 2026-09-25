# Task 15b — Research screen (F7 / top-bar "Research")

thinking: off
scope: locked

Edit only these files:
- new `src/ui/screens/researchScreen.ts` and `src/ui/screens/researchScreen.css`
- `src/ui/keyboard.ts`: only the three `[15b]` hook blocks below (one import line, one `dispatchKey` case, one `IMPLEMENTED_KEY_ACTIONS` line)
- `src/ui/hud.ts`: only the two `[15b]` hook blocks below (one import line and one block at the top of `buildTopBarButton`'s click listener)
- `src/main.ts`: only the two `[15b]` lines below (one import, one close call)
- `test/keyboard.test.ts`: only the two assertions named in step 6
- a new `test/researchScreen.test.ts`

Do not edit anything under `src/sim/`; only import from it.

Three other agents (15a, 15c and 15d) are editing `keyboard.ts`, `hud.ts` and `main.ts` at the same time. Put each hook exactly at the anchor given below and wrap it in its `[15b]` marker comments. Do not reformat, reorder or "tidy" neighbouring lines, so the four branches merge cleanly. Start editing right away.

After this task, F7 and the top-bar **Research** text button both open a streamlined Research panel:
- One tab per industry: Weapons, Energy & Construction, HighTech & Industrial.
- Header: completed-project counts, plus each industry's current project and progress.
- Per tab: the queue in order, with progress bars. The current project gets a **Crash program** button when the original allows one. Each queued, non-crashing project gets a **✕** remove button.
- The industry's tree, grouped by tech level, with every node coloured by status (completed / researching / queued / available / locked / disabled / restricted). Clicking an available node queues it.

House style: copy the structure of `src/ui/screens/coloniesList.ts` / `empiresList.ts`:
- module-level `open` state;
- `toggle…` / `close…` exports;
- a document `keydown` Escape handler with `stopImmediatePropagation`;
- pure row functions.

This is a streamlined panel. It leaves out the original's scrolling node-graph canvas, node art, hover info panel and edit mode.

## Existing code you use (read-only; verified at HEAD a399da7)

- `src/sim/researchSystem.ts`:
  - `interface TechNode`:
    - `def: ResearchNodeDefinition`, i.e. src/sim/data/research.ts `ResearchNode` with `projectId`, `name`, `techLevel`, `row`, `industry` (0/1/2), `category`, `specialFunctionCode`, …
    - `isResearched`, `isEnabled`, `progress` (float), `cost` (float), `isRushing`, `parentNodes: TechNode[]`, `parentIsRequired: boolean[]`, `sortTag`.
  - `class ResearchSystem`:
    - `techTree: TechNode[]`, `researchQueueWeapons`, `researchQueueEnergy`, `researchQueueHighTech: TechNode[]`;
    - `researchQueueFor(industry): TechNode[] | null`;
    - `canResearchNode(node): boolean` (port of ResearchSystem.cs CanResearchNode);
    - `allowedRacesCount(node)`, `allowedRacesContains(node, race)`.
    - `new ResearchSystem(null)` works in tests (no static data → no race restriction).
  - `nodeIndustry(n): IndustryType`.
- `src/sim/types.ts`: `enum IndustryType { Undefined, Weapon, Energy, HighTech }`.
- `src/sim/researchTick.ts`:
  - `calculateResearchTotal(empire): { researchEnergy, researchHighTech, researchWeapons }`: pure reads; the per-year output of Empire.3.cs CalculateResearchTotal.
  - `calculateCrashResearchProgramCost(empire, project): number`, which is `fround(cost − progress) / 4` (Galaxy.6.cs:848).
  - `initiateCrashResearchProgram(galaxy, empire, project, cost)` (Empire.3.cs:3204):
    - When `stateMoney >= cost`, it sets `isRushing = true`, subtracts `stateMoney`, and records the pirate-economy expense.
    - This is exactly what the original research tree's click does. It is the sim's player API for crash research.
  - The sim has **no** player API for editing the queue. The original edits the three `ResearchQueue*` lists directly from the UI (ResearchTree.cs OnMouseClick, below), so this task ports that click logic as UI code over the same lists.
- `Empire` (src/sim/empire.ts): `research: ResearchSystem`, `dominantRace: Race | null`, `stateMoney`, `galaxy`, `controlResearch`.
  - The player's `controlResearch` is `true` at HEAD, so `performResearchProjects` auto-picks a project when a queue is empty (researchTick.ts:1462). Say so in the panel header comment.
- `src/ui/screens/empireSummary.ts`: `getEmpireSummarySource(): { empire } | null`. It is already imported by keyboard.ts and hud.ts.
- `src/ui/hud.ts`: `formatMoney(n)` (exported) and `TOP_BAR_TEXT_LABELS.tbtnResearch = 'Research'` (the button is a text button). In `buildTopBarButton` the click listener begins:
  ```ts
      btn.addEventListener('click', () => {
          const screen = topBarScreen(name);
  ```
  `topBarScreen('tbtnResearch')` must stay `null` (test/hudTopBar.test.ts:17), so the hook tests `name` directly.
- `src/ui/toast.ts`: `showToast(text)`.

## C# source (verbatim, trimmed)

DistantWorlds/Main.Part6.cs:1582 `method_398(IndustryType)` gives the per-industry button label and the current project:
```cs
case IndustryType.Weapon:   empty = TextResolver.GetText("Weapons");               researchNode = ResearchQueueWeapons.Count > 0 ? ResearchQueueWeapons[0] : null; break;
case IndustryType.Energy:   empty = TextResolver.GetText("Energy & Construction"); researchNode = ResearchQueueEnergy[0] …; break;
case IndustryType.HighTech: empty = TextResolver.GetText("HighTech & Industrial"); researchNode = ResearchQueueHighTech[0] …; break;
…
if (researchNode == null) glassButton.MinorText = "(" + TextResolver.GetText("No project") + ")";
else glassButton.MinorText = "(" + researchNode.Name + "  " + (researchNode.Progress / researchNode.Cost).ToString("0%") + ")";
```
The industry colours come from the same method (`glowColor`): Weapon `(255,64,96)`, Energy `(96,64,255)`, HighTech `(64,255,96)`.

DistantWorlds.Controls/Controls/ResearchTree.cs:1287-1301, `DrawNode`, the node state:
```cs
bool flag1 = this._Research.CanResearchNode(researchNode);
bool restricted = this._Research.CheckNodeValidForRace(researchNode, this._Empire.DominantRace);   // true = valid for our race
bool enabled = restricted;
if (!researchNode.IsResearched && researchQueueIndex != 0) enabled = false;
if (researchNode.IsResearched) enabled = true;
bool ghosted = false;
if (!researchNode.IsResearched && !flag1) ghosted = true;
if (researchQueueIndex == 0) isHovered = true;           // current project drawn highlighted
…
string s = researchNode.Name; if (researchQueueIndex >= 0) s = s + " (" + (researchQueueIndex + 1).ToString() + ")";
if (researchNode.IsRushing && !researchNode.IsResearched) DrawImage(this._CrashImage, …);
if ((double) researchNode.Progress <= 0.0 || researchNode.IsResearched) return; DrawBarGraph((int) Cost, (int) Progress, …);
```
DistantWorlds.Types/ResearchSystem.cs:1635 `CheckNodeValidForRace`:
```cs
bool flag = true;
if (node.AllowedRaces != null && node.AllowedRaces.Count > 0) flag = race != null && node.AllowedRaces.Contains(race);
if (node.DisallowedRaces != null && node.DisallowedRaces.Count > 0 && race != null && node.DisallowedRaces.Contains(race)) flag = false;
return flag;
```
The TS `ResearchSystem` exposes only the allowed-race lookup. Leave the disallowed-race half as a `TODO(port)`.

ResearchTree.cs:1171-1230, `OnMouseClick` outside edit mode. Here `items` is the current industry's queue:
```cs
else if (researchNode != null && !researchNode.IsResearched) {
    if (e.Button == MouseButtons.Left && !items.Contains(researchNode)) {
        if (this._Research.CheckNodeValidForRace(researchNode, this._Empire.DominantRace) && this._Research.CanResearchNode(researchNode))
            items.Add(researchNode);
    } else if (e.Button == MouseButtons.Left && items.Contains(researchNode)) {
        if (items.IndexOf(researchNode) == 0 && !researchNode.IsRushing) {
            double researchProgramCost = Galaxy.CalculateCrashResearchProgramCost(this._Empire, researchNode);
            if (this._Empire.StateMoney >= researchProgramCost) {
                if (MessageBox(string.Format(GetText("Crash Research Initiate Question"), researchNode.Name, researchProgramCost.ToString("###,###,###,##0")), GetText("Initiate Crash Research Program?")) == "yes") {
                    this._Empire.StateMoney -= researchProgramCost;
                    this._Empire.PirateEconomy.PerformExpense(researchProgramCost, PirateExpenseType.CrashResearch, this._Galaxy.CurrentStarDate);
                    researchNode.IsRushing = true;
                }
            } else MessageBox(string.Format(GetText("Crash Research Cannot Afford"), …), GetText("Not enough money for Crash Research Program"));
        }
    } else if (e.Button == MouseButtons.Right && items.Contains(researchNode)) {
        bool flag = true;
        if (researchNode.IsRushing) flag = false;           // "Cannot cancel crash programs"
        if (flag) {
            int index1 = items.IndexOf(researchNode);
            items.RemoveAt(index1);
            ResearchNodeList researchNodeList = new ResearchNodeList();
            researchNodeList.AddRange(items);
            if (index1 < researchNodeList.Count)
                for (int index2 = index1; index2 < researchNodeList.Count; ++index2)
                    if (!this._Research.CanResearchNode(researchNodeList[index2])) items.Remove(researchNodeList[index2]);
        }
    }
}
```
GameText.txt strings:
- 3128 `Crash Research Initiate Question`: "Would you like to initiate a crash program to research {0}?\n\nThis would triple our research speed for this project, but would cost us {1} credits.\n\nShould we spend {1} credits on this crash research program?"
- 2497 `Initiate Crash Research Program?`
- 2495 `Crash Program` = "CRASH PROGRAM"
- 3120 `Click to queue research`
- 3123 `Cannot cancel crash programs`

The `Crash Research Cannot Afford` key is missing from GameText.txt. Use its dialog title, "Not enough money for Crash Research Program", as the toast.

## Steps

1. `src/ui/screens/researchScreen.ts`
   - Header comment: say this is task 15b, a streamlined Research panel. Cite Main.Part6.cs method_398, and ResearchTree.cs DrawNode / OnMouseClick. Note that the player's `controlResearch` auto-refills empty queues.
   - Imports:
     - `import './researchScreen.css';`
     - `ResearchSystem`, `nodeIndustry`, and `type TechNode` from `../../sim/researchSystem`
     - `IndustryType` from `../../sim/types`
     - `calculateResearchTotal`, `calculateCrashResearchProgramCost`, `initiateCrashResearchProgram` from `../../sim/researchTick`
     - `type Empire`, and `type Race` from `../../sim/data/races`
     - `formatMoney` from `../hud`
     - `showToast` from `../toast`
   - `export const RESEARCH_INDUSTRIES = [IndustryType.Weapon, IndustryType.Energy, IndustryType.HighTech] as const;`
   - `export function researchIndustryLabel(industry: IndustryType): string` returns `'Weapons'`, `'Energy & Construction'` or `'HighTech & Industrial'`, and `''` otherwise.
   - `export const INDUSTRY_COLORS: Record<number, number>` maps Weapon `0xff4060`, Energy `0x6040ff`, HighTech `0x40ff60`.
   - `export function formatPercent0(v: number): string`: C# `ToString("0%")`, i.e. `${Math.round(v * 100)}%`. Guard NaN/Infinity to `'0%'`.
   - `export function currentProjectText(rs: ResearchSystem, industry: IndustryType): string`: method_398's MinorText. Return `'(No project)'` or `` `(${name}  ${formatPercent0(progress / cost)})` `` (two spaces, as in the C#).
   - `export function checkNodeValidForRace(rs: ResearchSystem, node: TechNode, race: Race | null): boolean`: the allowed-races half of ResearchSystem.cs:1635. If `rs.allowedRacesCount(node) > 0`, return `race !== null && rs.allowedRacesContains(node, race)`; otherwise return true. Add `// TODO(port): DisallowedRaces — ResearchSystem.cs:1640 (not exposed by researchSystem.ts)`.
   - `export type ResearchNodeStatus = 'completed' | 'researching' | 'queued' | 'restricted' | 'available' | 'disabled' | 'locked';`
   - `export function researchNodeStatus(rs: ResearchSystem, node: TechNode, race: Race | null): ResearchNodeStatus`. Let `idx = rs.researchQueueFor(nodeIndustry(node))?.indexOf(node) ?? -1`. Check in this order:
     - `isResearched` → `'completed'`
     - `idx === 0` → `'researching'`
     - `idx > 0` → `'queued'`
     - not valid for race → `'restricted'`
     - `rs.canResearchNode(node)` → `'available'`
     - `!node.isEnabled` → `'disabled'`
     - otherwise `'locked'` (DrawNode's `ghosted`)
   - `export interface ResearchQueueRow { node: TechNode; label: string; percent: number; isRushing: boolean; index: number }`
     - `label` is `name (index+1)`, as in DrawNode.
     - `percent` is `progress / cost`, clamped to [0, 1]; use 0 when `cost <= 0`.
   - `export function researchQueueRows(rs: ResearchSystem, industry: IndustryType): ResearchQueueRow[]`.
   - `export interface ResearchCounts { completed: number; total: number; byIndustry: Map<IndustryType, { completed: number; total: number }> }` and `export function researchCounts(rs: ResearchSystem): ResearchCounts`. Count over `rs.techTree`, grouped by `nodeIndustry`; nodes with an Undefined industry count only in the totals.
   - `export interface ResearchTreeColumn { techLevel: number; nodes: { node: TechNode; status: ResearchNodeStatus }[] }` and `export function researchTreeColumns(rs: ResearchSystem, industry: IndustryType, race: Race | null): ResearchTreeColumn[]`. Take the tech-tree nodes of `industry`, group them by `def.techLevel` ascending, and sort within a column by `def.row` ascending, then `def.projectId`.
   - `export function queueResearchProject(rs: ResearchSystem, node: TechNode, race: Race | null): boolean`: the left-click add branch. Return false when the node is researched, already queued, has no queue (Undefined industry), fails the race check, or fails `canResearchNode`. Otherwise push it and return true. Comment: `// Port of ResearchTree.cs:1185-1189 OnMouseClick (left click, not queued)`.
   - `export function dequeueResearchProject(rs: ResearchSystem, node: TechNode): boolean`: the right-click branch, verbatim. Return false when the node is not queued or `isRushing`. Otherwise:
     - remove it at `index1`;
     - copy the queue;
     - for `index2` from `index1` to the end of the copy, remove from the real queue every entry that `!rs.canResearchNode(...)` (evaluated as you go, as in the C#);
     - return true.
   - `export interface CrashOffer { node: TechNode; cost: number; affordable: boolean }` and `export function crashResearchOffer(empire: Empire, node: TechNode): CrashOffer | null`. Return null unless the node is `queue[0]` of its industry and `!isRushing`. Otherwise:
     - `cost = calculateCrashResearchProgramCost(empire, node)`;
     - `affordable = empire.stateMoney >= cost`.
   - `export function crashQuestion(name: string, cost: number): string`: the GameText 3128 text with `{0}` = name and `{1}` = `formatMoney(cost)`.
   - DOM:
     - `export interface ResearchScreenOptions { empire: Empire }`, plus `toggleResearchScreen(opts)` and `closeResearchScreen()`.
     - Remember the selected tab in a module variable (default Weapon).
     - Window title `Research`. Under it, a header line `Completed: ${completed} / ${total}`, then three tab buttons. Each tab shows `researchIndustryLabel(i)`, `currentProjectText(rs, i)` in smaller text, and a 3px bottom border in `INDUSTRY_COLORS[i]`.
     - Under the tabs, the tab's output: `Output: ${formatMoney(total)} / yr`, from `calculateResearchTotal(empire)`. Weapon → `researchWeapons`, Energy → `researchEnergy`, HighTech → `researchHighTech`.
     - **Queue** section: one row per `researchQueueRows` entry: label, a progress bar (`percent`), and `formatPercent0`.
       - The row with index 0 that has `crashResearchOffer(...) !== null` gets a `Crash program` button. If it is not affordable: `showToast('Not enough money for Crash Research Program')`. Otherwise, if `window.confirm(crashQuestion(name, cost))`, call `initiateCrashResearchProgram(empire.galaxy, empire, node, cost)`, then re-render.
       - A rushing row shows a `CRASH PROGRAM` tag instead.
       - Every non-rushing row gets a `✕` button (title `Remove from queue`) → `dequeueResearchProject`, then re-render.
       - A rushing row's ✕ is disabled, with title `Cannot cancel crash programs`.
     - **Tree** section: one column per `ResearchTreeColumn` (flex row, horizontal scroll), headed `Level ${techLevel}`, with one chip per node and a `research-node-${status}` class.
       - An `available` chip has title `Click to queue research`; clicking it runs `queueResearchProject(rs, node, empire.dominantRace)`, then re-renders.
       - Nodes with `progress > 0 && !isResearched` get a thin progress underline.
     - While open, re-render every 1000 ms (progress moves). Clear the interval in `close()`.
2. `src/ui/screens/researchScreen.css`: copy `coloniesList.css` with the prefix `research-` in place of `colonies-list-`.
   - `.research-window` width is `min(980px, calc(100vw - 32px))`.
   - The tree area is `display: flex; gap: 8px; overflow-x: auto`, and each column is `flex: 0 0 150px`.
   - Chips are `font-size: 11px; border-radius: 3px; padding: 3px 5px; margin-bottom: 3px`, with these status colours:
     - completed: background `rgba(255,255,255,0.12)`, colour `#fff`;
     - researching: 1px border `#ffff00`, colour `#fff`;
     - queued: border `#e8d24a` dashed;
     - available: colour `#aaa`, cursor pointer, hover background `rgba(255,255,255,0.1)`;
     - locked: colour `#555`;
     - disabled and restricted: colour `#555`, `text-decoration: line-through`.
   - Progress bars are 4px high, with a yellow `#ffff00` fill on `rgba(48,48,0,1)` (DrawBarGraph colours).
3. `src/ui/keyboard.ts`: three blocks, nothing else.
   - Import, right after `import { helpTopicKeyForHabitat, toggleGalactopedia } from './screens/galactopedia';`:
     ```ts
     import { toggleResearchScreen } from './screens/researchScreen'; // [15b]
     ```
   - In the `dispatchKey` switch, insert immediately **before** `case 'coloniesScreen':`, i.e. after the `empireSummaryScreen` case's `break;`:
     ```ts
         // [15b] F7: Research screen (task 15b).
         case 'researchScreen': {
             const src = getEmpireSummarySource();
             if (src) toggleResearchScreen({ empire: src.empire });
             break;
         }
         // [/15b]
     ```
   - In `IMPLEMENTED_KEY_ACTIONS`, add a new line right after `'zoomSystemLevel', 'zoomSectorLevel', 'zoomGalaxyLevel', 'zoomPlanetLevel',`:
     ```ts
         'researchScreen', // [15b]
     ```
4. `src/ui/hud.ts`: two blocks, nothing else.
   - Import, right after `import { toggleMessageHistory } from './screens/messageHistory';`:
     ```ts
     import { toggleResearchScreen } from './screens/researchScreen'; // [15b]
     ```
   - In `buildTopBarButton` (not `buildEmpireFlagButton` or the chrome-less helper), insert between `btn.addEventListener('click', () => {` and `const screen = topBarScreen(name);`:
     ```ts
             // [15b] tbtnResearch → Research screen (Main.Part9.cs tbtnResearch_Click; task 15b).
             if (name === 'tbtnResearch') {
                 const src = getEmpireSummarySource();
                 if (src) toggleResearchScreen({ empire: src.empire });
                 return;
             }
             // [/15b]
     ```
   - Do not touch `TopBarScreen`, `topBarScreen` or the listener's other branches. 15c inserts its own block inside the final `else`.
5. `src/main.ts`: two lines.
   - After `import { closeShipsAndBasesList } from './ui/screens/shipsAndBasesList';`, add `import { closeResearchScreen } from './ui/screens/researchScreen'; // [15b]`.
   - In `activeGameViewCleanup`, right after `closeShipsAndBasesList();`, add `closeResearchScreen(); // [15b]`.
6. `test/keyboard.test.ts`: F7 is now implemented, so change only these two places.
   - In `'marks unimplemented actions as unavailable'`, replace `expect(isKeyActionAvailable('researchScreen')).toBe(false);` with `expect(isKeyActionAvailable('shipDesignsScreen')).toBe(false);`.
   - In `'unavailable actions fall through to dispatchKey default branch'`, change `key: 'F7'` to `key: 'F8'` and `toBe('researchScreen')` to `toBe('shipDesignsScreen')`.

## Tests (`test/researchScreen.test.ts`, no jsdom)

Use a helper `node(id, industry, techLevel, row, extra = {})` that returns a `TechNode`-shaped object:
```ts
{ def: { projectId: id, name: `P${id}`, techLevel, row, industry, category: 0, specialFunctionCode: 0, components: [], componentImprovements: [], abilities: [], fighters: [], parents: [], allowedRaces: [] },
  isResearched: false, isEnabled: true, progress: 0, selfResearched: false, cost: 100, isRushing: false,
  parentNodes: [], parentIsRequired: [], sortTag: 0, ...extra }
```
Cast it `as unknown as TechNode`. Build `rs = new ResearchSystem(null)` and set `rs.techTree`. Industry 0 means Weapon, 1 Energy, 2 HighTech.

- `researchIndustryLabel`: returns the three labels, and `''` for Undefined.
- `formatPercent0`: 0.425 → '43%' (rounded), 1 → '100%', NaN → '0%'.
- `currentProjectText`: an empty queue → '(No project)'. Queue `[a]` with progress 25 and cost 100 → '(P1  25%)'.
- `researchNodeStatus`. Setup: `a` researched; `b` has `a` as a required parent; `c` has `b` as a required parent; `d` is `isEnabled: false`.
  - With the Weapon queue empty: a 'completed', b 'available', c 'locked', d 'disabled'.
  - After `queueResearchProject(rs, b, null)` (true): b 'researching', and c becomes 'available' (its parent is queued: `canResearchNode`).
  - After queuing c: c 'queued'.
- `queueResearchProject`: false for `a` (researched), false for `b` again (already queued), and false for `d`.
- `dequeueResearchProject`, with queue `[b, c]`:
  - Removing `b` also drops `c`: its required parent is neither researched nor queued any more. The queue becomes `[]` and the call returns true.
  - With `b.isRushing = true`, it returns false and the queue is unchanged.
  - A node that is not queued returns false.
- `researchQueueRows`: queue `[b, c]` with b.progress 50 → labels `['P2 (1)', 'P3 (2)']`, percents `[0.5, 0]`. A node with `cost: 0` → percent 0.
- `researchCounts`: 1 of 4 completed; byIndustry Weapon `{ completed: 1, total: 4 }`. Add an Energy node → total 5, and Energy `{ 0, 1 }`.
- `researchTreeColumns`: nodes at levels 2/1/1 and rows 3/5/1 → columns `[1, 2]`, and column 1 is ordered row 1 then row 5.
- `crashResearchOffer`, with `empire = { stateMoney: 100 }` and queue `[b]` where b has cost 100 and progress 20:
  - The offer has cost `20` (`(100 − 20) / 4`) and `affordable: true`.
  - With `stateMoney: 10`, `affordable` is false.
  - When `b.isRushing` → null. For the second queue entry → null.
- `crashQuestion('Ion Cannon', 1234)` contains 'Ion Cannon' and `formatMoney(1234)`.
- `isKeyActionAvailable('researchScreen')` → true.

Run `npm run typecheck && npm test`. keyboard.test.ts (with the step-6 edits), hudTopBar.test.ts and hud.test.ts must pass.

With `npm run dev` on a private port (other agents share 5173), save a screenshot: `node scripts/shot.mjs 'http://localhost:<port>/?autostart=1' shots/15b-research.png`. Do not open it.

Then append `## Worker report`: files changed, the shot.mjs console output, and anything left undone.
