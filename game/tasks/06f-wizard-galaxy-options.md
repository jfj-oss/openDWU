# Task 06f — Wizard: galaxy options (expansion, aggression, difficulty, creatures, pirates, colonies, alien life)

thinking: off
scope: locked

Everything you need is below. Edit `src/ui/screens/newGameWizard.ts` (+css), `src/sim/startGameOptions.ts`, tests. Do not edit `src/sim/galaxy.ts`, `src/sim/empire.ts`, `src/main.ts`. Start editing right away.

Add to "The Galaxy" page (below Star Amount / Physical Size, as in the original) sliders for: **Colony Prevalence**, **Alien Life**, **Space Creatures**, **Pirates**, **Aggression**, **Difficulty** (+ checkbox "Difficulty scales as player nears victory"). Tick labels from the original UI (gameplay frame): Aggression *Peaceful · Normal · Restless · Unstable · Chaos*, Difficulty *Easy · Normal · Hard · Very Hard · Extreme*, Space Creatures *None · Few · Normal · Many*, Pirates *None · Very Few · Few · Normal · Many · Very Many*; for Colony Prevalence / Alien Life use the number of cases in their conversion method below and label them *Rare … Common* evenly.
Store raw slider indices in `StartGameOptions` and export pure converters ported **exactly** from the C# methods below (`colonyPrevalenceFor`, `alienLifeFor`, `spaceCreaturesFor`, `piratesFor`, `aggressionFor`, `difficultyFor`). Where `BaconStart` overrides a vanilla value, use the vanilla value and comment it.
Tests: every converter's full table; defaults = the C# default slider positions if visible in the context below, else the middle tick.
`npm run typecheck` && `npm test`. Append `## Worker report`.

## Where the sliders are converted (Start.1.cs 3681–3745)
```csharp
            main_0.method_257();
            method_46();
            Random random_ = new Random((int)DateTime.Now.Ticks);
            GalaxyShape galaxyShape = method_59(method_96());
            int num = method_60(tbarStartNewGameTheGalaxyStarDensity.Value);
            int num2 = method_61(tbarStartNewGameTheGalaxyStarDensity.Value, raceList_0);
            bool @checked = chkGalaxyNewEmpiresDuringGame.Checked;
            double num3 = method_64(tbarStartNewGameTheGalaxyColonyPrevalence.Value);
            int num4 = method_67(tbarStartNewGameTheGalaxyAlienLife.Value);
            double num5 = method_62(tbarStartNewGameTheGalaxySpaceCreatures.Value);
            double num6 = method_66(tbarStartNewGameTheGalaxyPirates.Value);
            int num7 = method_190();
            double num8 = (double)(numStartNewGameTheGalaxyResearchBaseTech.Value * 1000m);
            double num9 = method_71(tbarStartNewGameTheGalaxyAggression.Value);
            int value = tbarStartNewGameTheGalaxyExpansion.Value;
            string string_ = method_58(value);
            EmpireStart empireStart = new EmpireStart();
            empireStart.Name = txtYourEmpireName.Text;
            if (cmbStartNewGameYourEmpireRace.SelectedRace != null)
            {
                empireStart.Race = cmbStartNewGameYourEmpireRace.SelectedRace.Name;
            }
            else
            {
                empireStart.Race = "(" + TextResolver.GetText("Random") + ")";
            }
            empireStart.GovernmentStyle = method_72();
            empireStart.StartLocation = cmbYourEmpireStartLocation.SelectedItem.ToString();
            empireStart.HomeSystemFavourability = ahrJhtHrDu();
            string text = method_74();
            if (text == TextResolver.GetText("Starting") && value == 0)
            {
                text = TextResolver.GetText("PreWarp");
            }
            empireStart.Age = method_57(text);
            empireStart.TechLevel = method_54(method_75());
            empireStart.PrimaryColor = cmbPrimaryColor.SelectedColor;
            empireStart.SecondaryColor = cmbSecondaryColor.SelectedColor;
            empireStart.FlagShape = cmbFlagShape.SelectedIndex;
            empireStart.CorruptionMultiplier = method_63(tbarStartNewGameYourEmpireCorruption.Value);
            empireStart.PiratePlayStyle = method_191();
            switch (tbarStartNewGameTheGalaxyPirateStrength.Value)
            {
                case 0:
                    empireStart.PirateShipMaintenanceFactor = 1.0;
                    break;
                case 1:
                    empireStart.PirateShipMaintenanceFactor = 0.7;
                    break;
                case 2:
                    empireStart.PirateShipMaintenanceFactor = 0.4;
                    break;
                case 3:
                    empireStart.PirateShipMaintenanceFactor = 0.25;
                    break;
            }
            empireStart.AllowTechTrading = chkStartNewGameEnableTechTrading.Checked;
            empireStart.AllowGiantKaltorGeneration = chkStartNewGameEnableGiantKaltors.Checked;
            empireStart.DifficultyLevel = method_201(tbarStartNewGameTheGalaxyDifficulty.Value);
            empireStart.DifficultyScaling = chkStartNewGameTheGalaxyDifficultyScaling.Checked;
            empireStart.DestroyedPiratesDoNotRespawn = chkStartNewGameTheGalaxyPiratesRespawn.Checked;
            Size size = method_69(tbarStartNewGameTheGalaxyDimensions.Value);
            empireStart.GalaxySectorX = size.Width;
            empireStart.GalaxySectorY = size.Height;
            empireStart.EmpireTerritoryColonyInfluenceRangeFactor = (float)sldStartNewGameColonizationTerritoryColonyInfluenceRange.Value / 100f;
```
## Conversion methods
```csharp

// ---- method_71
Start.cs:4609
        private double method_71(int int_1)
        {
            double result = 0.0;
            switch (int_1)
            {
                case 0:
                    result = 0.9;
                    break;
                case 1:
                    result = 1.1;
                    break;
                case 2:
                    result = 1.3;
                    break;
                case 3:
                    result = 1.5;
                    break;
                case 4:
                    result = 1.7;
                    break;
            }
            return result;
        }


// ---- method_67
Start.cs:4532
        private int method_67(int int_1)
        {
            return BaconStart.OverrideLowIndependentLifeValue(int_1);
        }


// ---- method_64
Start.cs:4457
        private double method_64(int int_1)
        {
            double result = 0.75;
            switch (int_1)
            {
                case 0:
                    result = 0.35;
                    break;
                case 1:
                    result = 0.5;
                    break;
                case 2:
                    result = 0.65;
                    break;
                case 3:
                    result = 0.82;
                    break;
                case 4:
                    result = 1.0;
                    break;
            }
            return result;
        }


// ---- method_201
Start.1.cs:3617
        private double method_201(int int_1)
        {
            double result = 1.0;
            switch (int_1)
            {
                case 0:
                    result = 0.7;
                    break;
                case 1:
                    result = 1.0;
                    break;
                case 2:
                    result = 1.25;
                    break;
                case 3:
                    result = 1.6;
                    break;
                case 4:
                    result = 2.0;
                    break;
            }
            return result;
        }


// ---- method_66
Start.cs:4505
        private double method_66(int int_1)
        {
            double result = 0.0;
            switch (int_1)
            {
                case 0:
                    result = 0.0;
                    break;
                case 1:
                    result = 0.07;
                    break;
                case 2:
                    result = 0.2;
                    break;
                case 3:
                    result = 0.4;
                    break;
                case 4:
                    result = 0.7;
                    break;
                case 5:
                    result = 1.0;
                    break;
            }
            return result;
        }


// ---- method_62
Start.cs:4415
        private double method_62(int int_1)
        {
            double result = 0.0;
            switch (int_1)
            {
                case 0:
                    result = 0.0;
                    break;
                case 1:
                    result = 0.3;
                    break;
                case 2:
                    result = 0.6;
                    break;
                case 3:
                    result = 1.0;
                    break;
            }
            return result;
        }


// ---- OverrideLowIndependentLifeValue: NOT FOUND
```
