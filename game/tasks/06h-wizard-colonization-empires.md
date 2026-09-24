# Task 06h — Wizard: "Colonization and Territory" + "Other Empires" pages

thinking: off
scope: locked

Everything you need is below. Edit `src/ui/screens/newGameWizard.ts` (+css), `src/sim/startGameOptions.ts`, tests. Do not edit `src/sim/galaxy.ts`, `src/sim/empire.ts`, `src/main.ts`. Start editing right away.

Add the two remaining pages in the original order: The Galaxy → **Colonization and Territory** → Your Race → Your Empire → **Other Empires** → Victory Conditions. Build each from the original controls below (labels, defaults, min/max; sliders/checkboxes/numbers). Store raw values in `StartGameOptions` (`colonization`, `otherEmpires` sub-objects). "Other Empires" in the original has a list of AI empires with an auto-generate option: implement the auto-generate settings (number of empires, etc. from the controls) and show a read-only list preview "N empires will be generated"; manual per-empire editing is a TODO.
Tests: defaults from the control values; round-trip; page order.
`npm run typecheck` && `npm test`; save (don't open) `shots/06h-colonization.png` and `shots/06h-empires.png` via `?screen=wizard&page=colonization|empires`. Append `## Worker report`.

## Original controls (Start.InitializeComponent.cs — name = initial value/text)
```
this.btnStartNewGameColonizationTerritoryNext.Text = "Next: Your Race >>"
this.btnStartNewGameColonizationTerritoryPrevious.Text = "<< Previous: The Galaxy"
this.btnStartNewGameOtherEmpiresNext.Text = "Next: Victory Conditions >>"
this.btnStartNewGameOtherEmpiresPrevious.Text = "<< Previous: Your Empire"
this.chkOptionsAllowSameSystemAsOtherEmpires.Text = "Allow colonization and mining stations in other empires systems"
this.chkOtherEmpiresAutogenerate.Text = "Auto-Generate Starting Empires"
this.grpStartNewGameColonizationTerritoryColonizationRange.Text = "     Enforce Colonization Range Limits"
this.lblStartNewGameColonizationTerritoryColonizationRangeTitle.Text = "Colonization Range"
this.lblStartNewGameColonizationTerritoryColonizationRangeValue.Text = "4000K"
this.lblStartNewGameColonizationTerritoryColonyInfluenceRangeSuggestion.Text = "Suggestion"
this.lblStartNewGameColonizationTerritoryColonyInfluenceRangeTitle.Text = "Colony Influence Range"
this.lblStartNewGameColonizationTerritoryColonyInfluenceRangeValue.Text = "100%"
this.lblStartNewGameOtherEmpiresAutoGenNumberDescrip1.Text = "Generate"
this.lblStartNewGameOtherEmpiresAutoGenNumberDescrip2.Text = "starting empires"
this.lblStartNewGameOtherEmpiresOR.Text = "OR specify the starting empires below"
this.sldStartNewGameColonizationTerritoryColonizationRange.Maximum = 5000
this.sldStartNewGameColonizationTerritoryColonizationRange.Minimum = 500
this.sldStartNewGameColonizationTerritoryColonizationRange.Text = "colorSlider2"
this.sldStartNewGameColonizationTerritoryColonizationRange.Value = 1000
this.sldStartNewGameColonizationTerritoryColonyInfluenceRange.Maximum = 200
this.sldStartNewGameColonizationTerritoryColonyInfluenceRange.Minimum = 10
this.sldStartNewGameColonizationTerritoryColonyInfluenceRange.Text = "colorSlider1"
this.sldStartNewGameColonizationTerritoryColonyInfluenceRange.Value = 100
```

## Worker report

**Files changed**
- `src/sim/startGameOptions.ts` — added `colonization: ColonizationOptions` and `otherEmpires: OtherEmpiresOptions` to `StartGameOptions`; new interfaces, `COLONIZATION_RANGE_KLY_MIN/MAX` (500/5000), `COLONY_INFLUENCE_RANGE_PCT_MIN/MAX` (10/200), `OTHER_EMPIRES_COUNT_MIN/MAX` (0/100), `defaultColonizationOptions()`, `clampColonization()`, `defaultOtherEmpiresOptions()`, `clampOtherEmpires()`; wired into `defaultStartGameOptions()`.
- `src/ui/screens/newGameWizard.ts` — page order now The Galaxy → **Colonization and Territory** → Your Race → Your Empire → **Other Empires** → Victory Conditions → Start (`WIZARD_PAGES`, titles, back/forward labels). New `buildColonizationPage` (Enforce Colonization Range Limits group box with Colonization Range slider 500..5000 Kly + value label "4000K", Colony Influence Range slider 10..200 % + "100%" label + Suggestion hint, plus the top-level "Allow colonization and mining stations in other empires systems" checkbox) and `buildOtherEmpiresPage` (Auto-Generate Starting Empires checkbox, "Generate <n> starting empires" number input 0..100, "OR specify the starting empires below" label, read-only preview "N empires will be generated"). Start-page summary gained Colonization / Same-System Colonies / Other Empires rows. Removed the stale "more pages coming later" TODO note from the galaxy page.
- `src/ui/screens/newGameWizard.css` — styles for the new group box, value labels, suggestion hint, empire count row/input, OR label, list preview.
- `test/startGameOptions.test.ts` — defaults from control values (enforcement off, 4000 Kly, 100 %, same-system off; auto-generate on with 10 empires), slider bounds, clamp behaviour, round-trip of the nested sub-objects through deep copies, and wizard page-order/title/back-label/forward-label tests.

**Verification**
- `npm run typecheck` passes; `npm test` passes (347 tests, 29 files).
- Screenshots saved (not opened): `shots/06h-colonization.png` (`?screen=wizard&page=colonization`) and `shots/06h-empires.png` (`?screen=wizard&page=empires`). No console errors printed by the shot tool.

**Left undone**
- Manual per-empire editing on the Other Empires page (list of AI empires with race/government/home-system pickers) — left as `// TODO(port)` citing `Start.InitializeComponent.cs pnlStartNewGameOtherEmpires empStartNewGame* rows`.
- The empire-count control's initial value/bounds are not visible in the pasted excerpt; 10 and 0..100 were chosen as sensible defaults (documented in comments/tests).
- The original's colonisation-range slider shows `Value = 1000` but its visible label reads "4000K"; the default follows the displayed label (4000), matching what a player sees.
