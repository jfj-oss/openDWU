# Task 13b — Empire Summary + Colonies panels show the real M3 colony/economy fields

thinking: off
scope: locked

Edit only these files:
- `src/ui/screens/empireSummary.ts`
- `src/ui/screens/coloniesList.ts` and `coloniesList.css`
- `test/empireSummary.test.ts` and `test/coloniesList.test.ts`: add tests only; the existing tests must keep passing unchanged.

Do NOT edit anything under `src/sim/`, and do not edit `src/ui/hud.ts`. Start editing right away.

Both panels call sim getters read-only. Every sim call goes through a small impure wrapper that catches exceptions: some sim paths still `throw new Error('TODO(port) …')`. The row functions stay pure, so the existing fake-object tests still work.

## Sim data (read-only; verified to exist)

- `Empire` (src/sim/empire.ts):
  - `galaxy: Galaxy`, `stateMoney`
  - `leader: Character | null` (Character has `name`)
  - `characters: unknown[]` (Character objects)
  - `builtObjects: BuiltObject[]` (state-owned), `privateBuiltObjects: BuiltObject[]`
  - `spacePorts: BuiltObject[]`, `miningStations: BuiltObject[]`
  - `colonies: Habitat[]`, `capital`.
- `Habitat` (src/sim/types.ts):
  - `taxRate: number` (a fraction; taxes.ts uses `(0.15 - taxRate) * 100`)
  - `annualTaxRevenue: number`
  - `troops: TroopList | null` (TroopList has `count`)
  - `population.totalAmount`.
- From `src/sim/forceStructure.ts`:
  - `annualTaxRevenue(galaxy, empire): number` ports Empire.cs AnnualTaxRevenue.
  - `annualStateMaintenance(empire): number` ports Empire.cs AnnualStateMaintenance.
  - `habitatAnnualRevenue(galaxy, h): number` ports Habitat.cs AnnualRevenue (the C# "GDP").
- From `src/sim/taxes.ts`: `empireApprovalRating(galaxy, h): number` ports Habitat.cs EmpireApprovalRating.
- From `src/sim/developmentLevel.ts`: `habitatDevelopmentLevel(h): number` ports the Habitat.cs DevelopmentLevel property.

## C# source (verbatim, trimmed)

ItemListPanel.cs:895-906 draws the original's colony list row:
```cs
string string_2 = habitat2.Population.TotalAmount.ToString("0,,M");
string string_3 = habitat2.DevelopmentLevel.ToString("0") + "%";
bitmap4 = ((habitat2.EmpireApprovalRating > 15.0) ? Container.ApprovalSmileImage
        : ((habitat2.EmpireApprovalRating > 0.0) ? Container.ApprovalNeutralImage
        : ((!(habitat2.EmpireApprovalRating > -15.0)) ? Container.ApprovalAngryImage : Container.ApprovalSadImage)));
if (habitat2.Rebelling) bitmap4 = Container.ApprovalAngryImage;
string string_4 = TextResolver.GetText("GDP") + ": " + habitat2.AnnualRevenue.ToString("0,K");
```
Main.Part12.cs:621-625 gives the icon files: `images\ui\chrome\` + `happy.png`, `neutral.png`, `sad.png`, `angry.png`. These exist in the install, served as `/assets/dwu/images/ui/chrome/happy.png` etc. `Rebelling` is not ported: forceStructure.ts has it as a stub returning false, so ignore it.

`.ToString("0,K")` divides by 1000 and rounds (the scaling comma), then appends a literal `K`: 1234567 → `1235K`, 0 → `0K`.

EmpireSummaryEconomy.cs:343-381 lists the original Economy rows ("STATE" column):
```cs
"Colony Tax Revenue"        empire_0.AnnualTaxRevenue.ToString("0,K")
"Ship & Base Maintenance"   empire_0.AnnualStateMaintenanceExcludingUnderConstruction.ToString("0,K")
// Troop Maintenance, Fuel Costs, Cashflow: NOT ported in the sim -> do not show them.
```

## Steps

1. `coloniesList.ts`:
   - Add `export type ApprovalMood = 'happy' | 'neutral' | 'sad' | 'angry';` and `export function approvalMood(rating: number): ApprovalMood`, using the exact thresholds above (`> 15` happy, `> 0` neutral, `> -15` sad, else angry).
   - Add `export function formatThousandsK(v: number): string { return `${Math.round(v / 1000)}K`; }`.
   - Add `export interface ColonyMetrics { development: number; approval: number; revenue: number }`.
   - Add `export function colonyMetrics(galaxy: Galaxy, h: Habitat): ColonyMetrics | null`. In a try block it returns `{ development: habitatDevelopmentLevel(h), approval: empireApprovalRating(galaxy, h), revenue: habitatAnnualRevenue(galaxy, h) }`. It returns null on any exception or when a value is not finite. Add a short comment naming the three C# members.
   - Extend `ColonyRow` with these fields:
     - `development: string` (`${Math.trunc(d)}%` or `'—'`)
     - `approval: ApprovalMood | null`
     - `gdp: string` (`formatThousandsK(revenue)` or `'—'`)
     - `tax: string` (`${Math.round((h.taxRate ?? 0) * 100)}%`)
     - `troops: string` (`String(h.troops?.count ?? 0)`)
   - Change the signature to `colonyRows(empire: Empire, metrics?: (h: Habitat) => ColonyMetrics | null)`. With no `metrics`, development/gdp are '—' and approval is null. The sort order is unchanged.
2. The panel in `createColoniesList`:
   - Call `colonyRows(opts.empire, (h) => colonyMetrics(opts.empire.galaxy, h))`.
   - The columns become Name | Population | Dev. | Approval | GDP | Tax | Troops, in both the header and the rows.
   - The Approval cell is a 16×16 `<img>` with `src = /assets/dwu/images/ui/chrome/${mood}.png`, `alt`/`title` = the mood word, and `draggable = false`. It is an empty cell when approval is null.
   - Numbers are right-aligned.
   - In `coloniesList.css`, change both `grid-template-columns` (header and row, ~lines 69 and 91) to `minmax(0, 1fr) 5em 3.5em 4em 4.5em 3em 3.5em`. Widen `.colonies-list-window` from 380px to 560px.
3. `empireSummary.ts`:
   - Add:
     ```ts
     export interface EmpireSummaryExtra {
       leaderName: string | null; taxRevenue: number | null; maintenance: number | null;
       stateShipsAndBases: number; privateShipsAndBases: number; spacePorts: number; miningStations: number; characters: number;
     }
     ```
   - Add `export function empireSummaryExtra(e: Empire): EmpireSummaryExtra`. It reads the fields listed above. `taxRevenue = annualTaxRevenue(e.galaxy, e)` and `maintenance = annualStateMaintenance(e)`, each in its own try/catch that falls back to null. Array lengths use `?.length ?? 0`.
   - Change the signature to `empireSummaryRows(src, extra?: EmpireSummaryExtra)`. With no `extra`, the output is exactly as today. With `extra`, append these rows after Treasury, in this order:
     - `Leader` (name or '—')
     - `Colony tax revenue` (`formatThousandsK` imported from `./coloniesList`, or '—' when null)
     - `Ship & base maintenance` (same formatting)
     - `Space ports`
     - `Mining stations`
     - `State ships & bases`
     - `Private ships & bases`
     - `Characters`
   - In `createEmpireSummary`, call `empireSummaryRows(src, empireSummaryExtra(src.empire))`.
   - Update the header comment to mention the new rows. Add one line: `// TODO(sim): Troop maintenance, fuel costs and Cashflow (EmpireSummaryEconomy.cs 356-381) need Empire fields not yet ported.`

## Tests (no jsdom; fake objects only)

- `test/coloniesList.test.ts`, new cases:
  - `approvalMood`: 16 → happy, 15 → neutral, 0.1 → neutral, 0 → sad, -14.9 → sad, -15 → angry.
  - `formatThousandsK`: 1234567 → '1235K', 0 → '0K'.
  - `colonyRows` with a `metrics` callback returning `{ development: 37.9, approval: 20, revenue: 45600 }`, on a colony faked with `taxRate = 0.25` and `troops = { count: 3 }`, gives `development '37%'`, approval 'happy', gdp '46K', tax '25%', troops '3'.
  - `colonyRows` without metrics gives `'—'` / null / `'0%'` / `'0'` on the existing bare fakes.
- `test/empireSummary.test.ts`, new cases:
  - With an `EmpireSummaryExtra` literal (leaderName 'Ada', taxRevenue 12_345, maintenance null, counts 3/10/1/6/4), the labels after 'Treasury' are exactly the 8 above, and the values are 'Ada', '12K', '—', '1', '6', '3', '10', '4'.
  - The existing no-extra test is unchanged. This proves the rows are unchanged when `extra` is omitted.

Run `npm run typecheck && npm test`, then append `## Worker report`.

## Worker report

Files changed:
- `src/ui/screens/coloniesList.ts` — added `ApprovalMood` / `approvalMood()` (ItemListPanel.cs 895-898 thresholds), `formatThousandsK()`, `ColonyMetrics` + impure `colonyMetrics(galaxy, h)` wrapper (try/catch around `habitatDevelopmentLevel`, `empireApprovalRating`, `habitatAnnualRevenue`; null on exception or non-finite); extended `ColonyRow` with `development` / `approval` / `gdp` / `tax` / `troops`; `colonyRows(empire, metrics?)` fills them from the callback ('—' / null without one); `createColoniesList` now renders Name | Population | Dev. | Approval | GDP | Tax | Troops, with the approval cell as a 16×16 `<img>` from `/assets/dwu/images/ui/chrome/<mood>.png` (`alt`/`title` = mood, `draggable = false`, empty when null) and numbers right-aligned.
- `src/ui/screens/coloniesList.css` — both `grid-template-columns` (header + row) set to `minmax(0, 1fr) 5em 3.5em 4em 4.5em 3em 3.5em`; window width 380px → 560px; added `.colonies-list-number` (right-aligned), `.colonies-list-header-number` / `-approval` header alignment, `.colonies-list-approval(-icon)` styles.
- `src/ui/screens/empireSummary.ts` — added `EmpireSummaryExtra` interface and `empireSummaryExtra(e)` (leader name, `annualTaxRevenue` / `annualStateMaintenance` each in their own try/catch falling back to null, array lengths via `?.length ?? 0`); `empireSummaryRows(src, extra?)` appends Leader / Colony tax revenue / Ship & base maintenance / Space ports / Mining stations / State ships & bases / Private ships & bases / Characters after Treasury when `extra` is given (output unchanged otherwise); `createEmpireSummary` passes `empireSummaryExtra(src.empire)`; header comment updated and the TODO(sim) line for troop maintenance / fuel costs / Cashflow added.
- `test/coloniesList.test.ts` — new cases: `approvalMood` boundary values (16/15/0.1/0/-14.9/-15), `formatThousandsK` (1234567 → '1235K', 0 → '0K'), `colonyRows` with a metrics callback (dev '37%', happy, gdp '46K', tax '25%', troops '3') and without metrics ('—' / null / '0%' / '0'). Existing tests untouched.
- `test/empireSummary.test.ts` — new case asserting the 8 Economy labels after 'Treasury' and values 'Ada', '12K', '—', '1', '6', '3', '10', '4'. Existing tests untouched.

Done: all steps 1–3 plus the listed tests; `npm run typecheck` clean, `npm test` 836/836 passing (84 files).

Left undone / notes: nothing functionally. Could not visually verify the panel (no browser screenshot taken this session) nor confirm the four `ui/chrome/*.png` icons exist in the local asset symlink (the assets dir is inaccessible from this worktree); the paths follow Main.Part12.cs 621-625 as stated in the task.
