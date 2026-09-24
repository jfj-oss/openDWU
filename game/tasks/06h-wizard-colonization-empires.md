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
